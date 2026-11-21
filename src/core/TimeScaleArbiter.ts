/**
 * 时间缩放仲裁（Unity G/Core/TimeScaleArbiter.cs 的网页版，docs/threejs-migration.md 4.7）：**只有它写 ctx.time.timeScale**。
 * 想改时间的地方 {@link TimeScaleArbiter.request} 一个申请（拿到句柄，结束时 dispose）；同时有多个申请时优先级最高的生效，
 * 同优先级取最后一个；没有申请 = 1。优先级：暂停 > 模态 > 场景过渡 > 阵亡慢动作 > 首领演出 > 顿帧 > 清场慢动作。
 * 申请和撤销都立刻生效。
 *
 * 比 Unity 多的两点（M6 首领框架那一版就有，原样保留）：
 *   · 申请可以带 realSeconds：按真实时间自动撤销（慢动作本身不会把自己拖长），要每帧 {@link TimeScaleArbiter.tick}；
 *   · 外部接管：别处直接写过 target.timeScale（白盒检视页的俯视暂停）时本仲裁不再写，等手上的申请全部撤销后也不去改回。
 *     主游戏自己已经不直接写了（Game 的阵亡慢动作、暂停、模态都走这里）；{@link TimeScaleArbiter.clear} 收回接管并回到 1。
 * 一个 ctx.time 一份（{@link arbiterFor}）。纯逻辑（时钟可注入），node --test 直接测。
 */

/** 优先级（数值大的压过小的；HitStop … Pause 五档 = Unity TimeScaleArbiter.Priority） */
export const TimePriority = {
  /** 清场慢动作（Unity ClearSlowMo.Priority = HitStop − 10：最后一击的顿帧先「咬」一下，再接着慢放） */
  ClearSlowMo: 90,
  /** 顿帧 */
  HitStop: 100,
  /** 首领演出慢动作（顿帧 + 50） */
  BossCinematic: 150,
  /** 登场演出慢动作（顿帧 + 60） */
  BossIntro: 160,
  /** 阵亡 / 首领倒下的慢动作 */
  DeathSlowMo: 200,
  /** 场景过渡（Unity Priority.Transition） */
  SceneTransition: 300,
  /** 模态界面（秘卷三选一、商店…） */
  Modal: 400,
  /** 暂停 */
  Pause: 500,
} as const;

export interface TimeScaleHandle {
  /** 改它立即重新结算（Unity Handle.Scale） */
  scale: number;
  readonly priority: number;
  readonly owner: unknown;
  readonly live: boolean;
  /** 撤销（可重复调用） */
  dispose(): void;
}

interface Entry extends TimeScaleHandle {
  seq: number;
  until: number;
  alive: boolean;
  value: number;
}

/** NaN / 负数当 0，上限 100（Unity Sanitize） */
function sanitize(s: number): number {
  return Number.isNaN(s) || s < 0 ? 0 : Math.min(s, 100);
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

  /** 申请 scale 倍速（0 = 停住），realSeconds 秒后（真实时间）自动撤销；≤ 0 = 直到 dispose */
  request(owner: unknown, scale: number, priority: number, realSeconds = 0): TimeScaleHandle {
    const self = this;
    const e: Entry = {
      owner, value: sanitize(scale), priority, seq: ++this.seq, alive: true,
      until: realSeconds > 0 ? this.clock() + realSeconds : Infinity,
      get scale() { return e.value; },
      set scale(v: number) {
        v = sanitize(v);
        if (e.value === v) return;
        e.value = v;
        if (e.alive) self.apply();
      },
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

  /** 撤销某个申请者的全部申请（Unity ReleaseAll） */
  releaseOwner(owner: unknown): void {
    for (const e of this.entries) if (e.owner === owner) e.alive = false;
    this.apply();
  }

  /** 全部撤销，时间回到 1（开局 / 重开 / 回主菜单；Unity Clear）。外部接管也一并收回 */
  clear(): void {
    for (const e of this.entries) e.alive = false;
    this.entries.length = 0;
    this.external = false;
    this.lastWritten = NaN;
    this.target.timeScale = 1;
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

  /** 当前结算出的时间缩放（没有申请 = 1；Unity Current） */
  get current(): number {
    return this.winner?.scale ?? 1;
  }

  /** 生效的那个申请的优先级（没有申请 = −1；Unity ActivePriority）：屏效据此区分慢动作和顿帧 / 暂停 */
  get activePriority(): number {
    return this.winner?.priority ?? -1;
  }

  /** 生效中的申请数（Unity Count） */
  get count(): number {
    let n = 0;
    for (const e of this.entries) if (e.alive) n++;
    return n;
  }

  /** 有人绕过仲裁直接写了 timeScale（调试检查用；Unity Tampered） */
  get tampered(): boolean {
    return this.external || Math.abs(this.target.timeScale - this.current) > 1e-6;
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
