/**
 * 时间缩放仲裁（Unity TimeScaleArbiter 的网页版，docs/threejs-migration.md 第 5 节「ctx.time.timeScale 仲裁」）：
 * 慢动作 / 顿帧都经这里申请，优先级高的生效（同级取最近申请的），按真实时间撤销（慢动作本身不会把自己拖长）。
 *   · 只写 target.timeScale；别处直接写过（玩家阵亡的 0.3、开局 / 换关复位 1）时视为外部接管：本仲裁不再写，等手上的申请全部撤销后也不去改回。
 *   · 一个 ctx.time 一份（{@link arbiterFor}），首领、登场演出共用。
 * 纯逻辑（时钟可注入），node --test 直接测。
 */

export const TimePriority = {
  /** 顿帧 */
  HitStop: 100,
  /** 首领演出慢动作（顿帧 + 50） */
  BossCinematic: 150,
  /** 登场演出慢动作（顿帧 + 60） */
  BossIntro: 160,
  /** 阵亡 / 首领倒下的慢动作 */
  DeathSlowMo: 200,
  /** 场景过渡 */
  SceneTransition: 300,
} as const;

export interface TimeScaleHandle {
  readonly scale: number;
  readonly priority: number;
  readonly live: boolean;
  /** 撤销（可重复调用） */
  dispose(): void;
}

interface Entry extends TimeScaleHandle {
  owner: unknown;
  seq: number;
  until: number;
  alive: boolean;
}

export class TimeScaleArbiter {
  private readonly entries: Entry[] = [];
  private seq = 0;
  private lastWritten = NaN;
  private external = false;

  constructor(
    private readonly target: { timeScale: number },
    private readonly clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  ) {}

  /** 申请 scale 倍速（0 < scale），realSeconds 秒后（真实时间）自动撤销；≤ 0 = 直到 dispose */
  request(owner: unknown, scale: number, priority: number, realSeconds = 0): TimeScaleHandle {
    const self = this;
    const e: Entry = {
      owner, scale: Math.max(0, scale), priority, seq: ++this.seq, alive: true,
      until: realSeconds > 0 ? this.clock() + realSeconds : Infinity,
      get live() { return e.alive; },
      dispose() {
        if (!e.alive) return;
        e.alive = false;
        self.apply();
      },
    };
    if (this.entries.every(x => !x.alive)) this.external = false;
    this.entries.push(e);
    this.apply();
    return e;
  }

  /** 撤销某个申请者的全部申请 */
  releaseOwner(owner: unknown): void {
    for (const e of this.entries) if (e.owner === owner) e.alive = false;
    this.apply();
  }

  /** 每帧调：撤销到期的，写当前生效的倍率 */
  tick(): void {
    const now = this.clock();
    for (const e of this.entries) if (e.alive && now >= e.until) e.alive = false;
    this.apply();
  }

  /** 当前生效的申请（没有为 null） */
  get winner(): TimeScaleHandle | null {
    let best: Entry | null = null;
    for (const e of this.entries) {
      if (!e.alive) continue;
      if (!best || e.priority > best.priority || (e.priority === best.priority && e.seq > best.seq)) best = e;
    }
    return best;
  }

  get active(): boolean {
    return this.entries.some(e => e.alive);
  }

  private apply(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) if (!this.entries[i].alive) this.entries.splice(i, 1);
    if (!Number.isNaN(this.lastWritten) && Math.abs(this.target.timeScale - this.lastWritten) > 1e-6) this.external = true;
    const w = this.winner;
    if (this.external) {
      if (!w) this.lastWritten = NaN;
      return;
    }
    if (w) {
      this.target.timeScale = this.lastWritten = w.scale;
      return;
    }
    if (!Number.isNaN(this.lastWritten)) this.target.timeScale = 1;
    this.lastWritten = NaN;
  }
}

const arbiters = new WeakMap<object, TimeScaleArbiter>();

/** 某个 ctx.time 的仲裁器（第一次要的时候建） */
export function arbiterFor(time: { timeScale: number }): TimeScaleArbiter {
  let a = arbiters.get(time);
  if (!a) {
    a = new TimeScaleArbiter(time);
    arbiters.set(time, a);
  }
  return a;
}
