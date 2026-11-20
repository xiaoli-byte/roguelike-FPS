/**
 * 玩家身上的减益（Unity Player/PlayerStatus.cs + Combat/Status/ChillStatus / IgniteStatus / SunburnStatus）：
 *   寒意 ChillInstance：移速降低，取此刻最强的一条，上限 70%；每次命中各记一条（最多 4 条，各自计时；满了替换「比例 × 剩余时间」最小的一条），
 *     所以重复命中只刷新、不越叠越慢，强的那条到期后回落到次强的。只影响走路速度（PlayerController 的最大移速 × speedMult），
 *     不改属性表、不影响冲刺。来源：雪狌狌冰块（35% 1.5 s）、狐巫镜像（70% 1.5 s）、灯水母电击（40% 1 s）…
 *   点燃 IgniteInstance：每 0.5 s 一跳火伤，默认 2 s；已在燃烧时只刷新时长（取更晚的到期）并取较大的跳伤，多只敌人同时点燃不叠加。
 *     来源：毕方火矛（2 s × 3 / 跳 × 敌人伤害倍率）。
 *   日晒 SunburnInstance：旱魃「烈日」——暴露叠层、离开消退、按层数跳火伤（逐行移植在 enemies/bosses/HanbaSunburn.ts，这里持有一份；
 *     旱魃的 SunExposure 有玩家状态时就往这一份里叠，不再自己持有 / 推进）。
 * 跳伤一律经 ctx.combat.damagePlayer（冲刺无敌帧、减伤、受伤修饰器照常）。阵亡时清空，新开一局 / 换关时清空。
 * 敌人那边的入口（chillPlayer / ignitePlayer）按 `ctx.player.status` 鸭子类型找到这里，没有时（测试桩）走它们原来的路径。
 */
import { SunburnInstance, sunExposure } from '../enemies/bosses/HanbaSunburn';

/** 寒意常数（Unity ChillStatus） */
export const CHILL = { MaxSlow: 0.7, DefaultSeconds: 1.5, MaxEntries: 4 } as const;
/** 点燃常数（Unity IgniteStatus）：默认时长、跳伤间隔、到期后 0.05 s 内还能补上最后一跳 */
export const IGNITE = { DefaultSeconds: 2, TickInterval: 0.5, EndGrace: 0.05, LastTickGrace: 0.02 } as const;

export type PlayerStatusId = 'chill' | 'ignite' | 'sunburn';

/** 某个状态此刻的读数（Unity StatusView） */
export interface PlayerStatusView {
  id: PlayerStatusId;
  stacks: number;
  remaining: number;
  power: number;
}

/** 比例口径：> 1 按百分数解释，钳到 [0, 1]（生效时再封顶 70%） */
export function chillFraction(power: number): number {
  let s = Number.isNaN(power) ? 0 : power;
  if (s > 1) s /= 100;
  return Math.max(0, Math.min(1, s));
}

export class ChillInstance {
  private readonly entries: { frac: number; remaining: number }[] = [];
  private strongest = 0;

  get active(): boolean { return this.entries.length > 0; }
  get count(): number { return this.entries.length; }
  /** 此刻的减速比例（最强的一条，封顶 70%） */
  get slow(): number { return Math.min(CHILL.MaxSlow, this.strongest); }
  get speedMult(): number { return this.entries.length > 0 ? 1 - this.slow : 1; }

  apply(power: number, duration = 0): boolean {
    const f = chillFraction(power);
    if (f <= 0) return false;
    const e = { frac: f, remaining: duration > 0 ? duration : CHILL.DefaultSeconds };
    if (this.entries.length < CHILL.MaxEntries) this.entries.push(e);
    else {
      let weakest = 0;
      for (let i = 1; i < this.entries.length; i++) {
        const a = this.entries[i], b = this.entries[weakest];
        if (a.frac * a.remaining < b.frac * b.remaining) weakest = i;
      }
      this.entries[weakest] = e;
    }
    this.recompute();
    return true;
  }

  tick(dt: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.remaining -= dt;
      if (e.remaining <= 0) this.entries.splice(i, 1);
    }
    this.recompute();
  }

  private recompute(): void {
    this.strongest = 0;
    for (const e of this.entries) this.strongest = Math.max(this.strongest, e.frac);
  }

  view(): PlayerStatusView | null {
    if (this.entries.length === 0) return null;
    let remaining = 0;
    for (const e of this.entries) remaining = Math.max(remaining, e.remaining);
    return { id: 'chill', stacks: this.entries.length, remaining, power: this.slow };
  }

  clear(): void {
    this.entries.length = 0;
    this.strongest = 0;
  }
}

export class IgniteInstance {
  private clock = 0;
  private until = 0;
  private next = 0;
  private dmg = 0;
  private running = false;

  constructor(private readonly hurt: ((amount: number) => void) | null = null) {}

  get active(): boolean { return this.running; }
  /** 每跳伤害 */
  get tickDamage(): number { return this.running ? this.dmg : 0; }

  apply(tickDamage: number, seconds = 0): boolean {
    const s = seconds > 0 ? seconds : IGNITE.DefaultSeconds;
    const d = Number.isNaN(tickDamage) ? 0 : Math.max(0, tickDamage);
    if (!this.running) {
      this.running = true;
      this.clock = 0;
      this.until = s;
      this.next = IGNITE.TickInterval;
      this.dmg = d;
    } else {
      this.until = Math.max(this.until, this.clock + s);
      this.dmg = Math.max(this.dmg, d);
    }
    return true;
  }

  /** 推进；返回这一帧是否跳了一下伤害 */
  tick(dt: number): boolean {
    if (!this.running) return false;
    this.clock += dt;
    if (this.clock > this.until + IGNITE.EndGrace) {
      this.clear();
      return false;
    }
    if (this.clock >= this.next && this.next <= this.until + IGNITE.LastTickGrace) {
      this.next += IGNITE.TickInterval;
      if (this.dmg > 0) {
        this.hurt?.(this.dmg);
        return true;
      }
    }
    return false;
  }

  /** 剩下还会跳的伤害（不含减伤与修饰器） */
  get remainingDotRaw(): number {
    if (!this.running || !(this.dmg > 0)) return 0;
    let n = 0;
    for (let t = this.next; t <= this.until + IGNITE.LastTickGrace; t += IGNITE.TickInterval) n++;
    return n * this.dmg;
  }

  view(): PlayerStatusView | null {
    if (!this.running) return null;
    return { id: 'ignite', stacks: 1, remaining: Math.max(0, this.until - this.clock), power: this.dmg };
  }

  clear(): void {
    this.running = false;
    this.dmg = 0;
  }
}

export interface PlayerStatusHost {
  /** 一跳伤害（Combat.damagePlayer，元素、来向；from 缺省为玩家自己的位置） */
  hurt(amount: number, element: 'fire' | 'none', from: { x: number; y: number; z: number } | null): void;
  alive(): boolean;
  /** 挂上 / 刷新一个状态时（燃烧的火星、音效…） */
  onApplied?(id: PlayerStatusId, stacks: number): void;
  /** 点燃跳了一下（音效 / 火星） */
  onIgniteTick?(): void;
}

export class PlayerStatus {
  readonly chillState = new ChillInstance();
  readonly igniteState: IgniteInstance;
  readonly sunburn: SunburnInstance;
  /** 移速倍率（寒意等，取所有状态里最小的）：PlayerController 乘到走路的最大速度上 */
  speedMult = 1;

  constructor(private readonly host: PlayerStatusHost) {
    this.igniteState = new IgniteInstance(amount => {
      host.hurt(amount, 'fire', null);
      host.onIgniteTick?.();
    });
    this.sunburn = new SunburnInstance((dmg, from) => host.hurt(dmg, 'fire', from));
  }

  /** 寒意：移速降低 slow（0.35 = −35%，> 1 按百分数），持续 seconds 秒；取最强的一条，上限 70% */
  chill(slow: number, seconds: number): boolean {
    if (!this.host.alive()) return false;
    if (!this.chillState.apply(slow, seconds)) return false;
    this.refreshSpeed();
    this.host.onApplied?.('chill', this.chillState.count);
    return true;
  }

  /** 点燃：seconds 秒内每 0.5 s 一跳 tickDamage 火伤；已在燃烧时只刷新时长并取较大跳伤 */
  ignite(seconds: number, tickDamage: number): boolean {
    if (!this.host.alive()) return false;
    this.igniteState.apply(tickDamage, seconds);
    this.host.onApplied?.('ignite', 1);
    return true;
  }

  /** 日晒：这一段暴露了 seconds 秒（× gain）；damagePerStack > 0 时改写每层每跳的伤害；sun = 日光来自哪里 */
  sunExposure(seconds: number, gain = 1, damagePerStack = 0, sun: { x: number; y: number; z: number } | null = null): boolean {
    if (!this.host.alive()) return false;
    return sunExposure(this.sunburn, seconds, gain, damagePerStack, sun);
  }

  has(id: PlayerStatusId): boolean {
    return id === 'chill' ? this.chillState.active : id === 'ignite' ? this.igniteState.active : this.sunburn.active;
  }

  view(id: PlayerStatusId): PlayerStatusView | null {
    if (id === 'chill') return this.chillState.view();
    if (id === 'ignite') return this.igniteState.view();
    const s = this.sunburn;
    return s.active ? { id: 'sunburn', stacks: s.stacks, remaining: s.remaining, power: s.tickDamage } : null;
  }

  /** 清掉全部减益（阵亡、新开一局、换关） */
  clearAll(): void {
    this.chillState.clear();
    this.igniteState.clear();
    this.sunburn.clear();
    this.refreshSpeed();
  }

  update(dt: number): void {
    if (!this.host.alive()) {
      if (this.has('chill') || this.has('ignite') || this.has('sunburn')) this.clearAll();
      return;
    }
    if (this.chillState.active) this.chillState.tick(dt);
    if (this.igniteState.active) this.igniteState.tick(dt);
    if (this.host.alive() && this.sunburn.active) this.sunburn.tick(dt);
    this.refreshSpeed();
  }

  private refreshSpeed(): void {
    this.speedMult = Math.max(0, Math.min(1, this.chillState.speedMult));
  }
}
