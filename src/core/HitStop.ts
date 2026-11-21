import type { DamageSource } from './types';
import { FEEL, type FeelProfile } from './FeelProfile';
import { TimePriority, type TimeScaleArbiter, type TimeScaleHandle } from './TimeScaleArbiter';

/**
 * 顿帧（Unity G/Core/HitStop.cs 照译，docs/unity-parity.md 3.2 / 3.13，F3）：
 * 命中的一瞬间把时间压到 ×0.05 几十毫秒，让暴击、击杀、反应「咬」一下。
 * 只走 {@link TimeScaleArbiter}（优先级 HitStop：暂停、模态、过渡、阵亡慢动作、首领演出都压得过它）；计时用不受缩放的真实时间。
 * 频率上限（不能把战斗打成幻灯片）：
 *   · 不叠加：进行中再来一个只把结束时刻延到两者中较晚的那个，单次最长 0.2 s，缩放取较低的；
 *   · 两次开始至少隔 0.12 s（明显更重的——长度至少是上一次的两倍，如精英 / 首领击杀——可以插队）；
 *   · 预算桶：最多攒 0.15 s，每秒回 0.075 s——连续作战时顿帧最多占真实时间的 7.5%；预算不够 12 ms 就不顿（太短的只像卡了一下）。
 *   · 只在正常游玩、时间没被别人压着、玩家活着的时候开始。
 * 内置来源（玩家造成的：武器、技能、近战、爆炸、秘卷；不含持续伤害）：
 *   击杀 普通 0.035 s / 精英 0.07 s / 首领 0.18 s；重暴击（这一下打掉目标护盾 + 护甲 + 生命总量的 18% 以上，冲锋枪的暴击不算）0.025 s；
 *   元素反应（直接命中引发的）0.045 s。别的单元（斩击命中、技能落地）直接调 {@link HitStop.request}。
 * 时长 / 缩放读 {@link FeelProfile}（下面的常数是它的默认值）。纯逻辑（时钟、状态可注入），Game 接事件并每帧 update。
 */
export const HIT_STOP = {
  /** 顿帧时的时间缩放（不用 0：dt 为 0 时一些系统会跳过这一帧的结算） */
  DefaultScale: 0.05,
  MaxStop: 0.2, MinGap: 0.12, BudgetMax: 0.15, BudgetRate: 0.075, MinUseful: 0.012,
  /** 内置来源的时长（秒，真实时间） */
  KillStop: 0.035, EliteKillStop: 0.07, BossKillStop: 0.18, CritStop: 0.025, ReactionStop: 0.045,
  /** 重暴击：这一下打掉目标总量（护盾 + 护甲 + 生命上限）的比例 */
  HeavyCritFraction: 0.18,
} as const;

export type HitStopRank = 'normal' | 'elite' | 'boss';

export interface HitStopHost {
  /** 真实时间（秒） */
  clock(): number;
  /** 正在正常游玩（Unity GameStateMachine.IsPlaying） */
  isPlaying(): boolean;
  /** 玩家已阵亡 */
  playerDead(): boolean;
}

/** 玩家造成的（Unity ByPlayer：Weapon / Skill / Melee / Explosion / Scroll；持续伤害不算） */
export function hitStopByPlayer(source: DamageSource | string | undefined): boolean {
  return source === 'weapon' || source === 'skill' || source === 'melee' || source === 'explosion' || source === 'scroll';
}

export class HitStop {
  private handle: TimeScaleHandle | null = null;
  private on = true;
  private stopStart = 0;
  private stopUntil = 0;
  private lastStart = -10;
  private lastLength = 0;
  private bucket: number = HIT_STOP.BudgetMax;
  private budgetAt = 0;

  constructor(private readonly arbiter: TimeScaleArbiter, private readonly host: HitStopHost, private readonly feel: FeelProfile = FEEL) {}

  /** 总开关（测试、以后的设置项）；关掉时进行中的顿帧立刻结束 */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    if (!value) this.release();
  }

  /** 正在顿帧 */
  get active(): boolean {
    return !!this.handle && this.handle.live;
  }

  /** 剩余预算（秒） */
  get budget(): number {
    return this.bucket;
  }

  /**
   * 申请一次顿帧：seconds 秒（真实时间，≤ 0.2），期间时间缩放 = scale。按上面的规则可能被延长合并、截短或忽略；返回是否生效
   */
  request(seconds: number, scale: number = HIT_STOP.DefaultScale): boolean {
    if (!this.on || !(seconds > 0)) return false;
    seconds = Math.min(seconds, HIT_STOP.MaxStop);
    scale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : HIT_STOP.DefaultScale;
    const now = this.host.clock();
    this.refill(now);

    // 进行中：不叠加，只延长到较晚的结束（受单次上限与预算限制）
    if (this.handle && this.handle.live) {
      const end = Math.min(this.stopStart + HIT_STOP.MaxStop, now + seconds);
      const extra = Math.min(end - this.stopUntil, this.bucket);
      if (scale < this.handle.scale) this.handle.scale = scale;
      if (extra <= 0.002) return false;
      this.bucket -= extra;
      this.stopUntil += extra;
      return true;
    }

    if (!this.host.isPlaying() || this.arbiter.current < 0.999) return false;
    if (this.host.playerDead()) return false;
    if (now - this.lastStart < HIT_STOP.MinGap && seconds < this.lastLength * 2) return false;
    seconds = Math.min(seconds, this.bucket);
    if (seconds < HIT_STOP.MinUseful) return false;
    this.bucket -= seconds;
    this.stopStart = this.lastStart = now;
    this.stopUntil = now + seconds;
    this.lastLength = seconds;
    this.handle = this.arbiter.request(this, scale, TimePriority.HitStop);
    return true;
  }

  /** 每帧调（真实时间）：被仲裁器整体清掉（换关 / 重开）或到点就撤销 */
  update(): void {
    if (!this.handle) return;
    if (!this.handle.live || this.host.clock() >= this.stopUntil) this.release();
  }

  /** 换关 / 重开：结束进行中的顿帧（预算、间隔照旧） */
  release(): void {
    this.handle?.dispose();
    this.handle = null;
  }

  // ───────────── 内置来源（Game 接 enemy:killed / enemy:damaged / enemy:reaction）─────────────

  onKilled(rank: HitStopRank, source: DamageSource | string | undefined): boolean {
    if (!hitStopByPlayer(source)) return false;
    const f = this.feel;
    return this.request(rank === 'boss' ? f.bossKillStop : rank === 'elite' ? f.eliteKillStop : f.killStop, f.hitStopScale);
  }

  /** total = 这一下实际打掉的量；pool = 目标生命上限 + 护甲上限 + 护盾上限 */
  onDamaged(crit: boolean, killed: boolean, source: DamageSource | string | undefined, total: number, pool: number): boolean {
    if (!crit || killed) return false;
    if (source !== 'weapon' && source !== 'melee') return false;
    if (total < Math.max(1, pool) * HIT_STOP.HeavyCritFraction) return false;
    return this.request(this.feel.critStop, this.feel.hitStopScale);
  }

  onReacted(depth: number, hits: number): boolean {
    return depth === 0 && hits > 0 ? this.request(this.feel.reactionStop, this.feel.hitStopScale) : false;
  }

  private refill(now: number): void {
    if (now > this.budgetAt) this.bucket = Math.min(HIT_STOP.BudgetMax, this.bucket + (now - this.budgetAt) * HIT_STOP.BudgetRate);
    this.budgetAt = now;
  }
}
