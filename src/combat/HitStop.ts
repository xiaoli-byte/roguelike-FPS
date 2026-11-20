/**
 * 顿帧（Unity Core/HitStop.cs + FeelProfile 的顿帧项；docs/feel.md）：命中的一瞬间把时间压到 ×0.05 几十毫秒，让暴击、击杀、反应「咬」一下。
 * 只经时间缩放仲裁（enemies/bosses/framework/TimeScaleArbiter.ts，优先级最低的 HitStop：暂停、过渡、阵亡 / 首领演出慢动作都压得过它），
 * 计时用不受缩放的真实时间。频率上限（不能把战斗打成幻灯片）：
 *   · 不叠加：进行中再来一个只把结束时刻延到两者中较晚的那个，单次最长 0.2 s，缩放取较低的；
 *   · 两次开始至少隔 0.12 s（明显更重的——长度至少是上一次的两倍，如精英 / 首领击杀——可以插队）；
 *   · 预算桶：最多攒 0.15 s，每秒回 0.075 s——连续作战时顿帧最多占真实时间的 7.5%；预算不够 12 ms 就不顿；
 *   · 只在游戏进行中、时间没被别人压着、玩家活着的时候开始。
 * 内置来源（玩家造成的：武器、技能、近战、爆炸、秘卷；不含持续伤害、灵宠、环境）：
 *   击杀 普通 0.035 s / 精英 0.07 s / 首领 0.18 s；重暴击（武器 / 近战这一下打掉目标护盾 + 护甲 + 生命上限总量的 18% 以上）0.025 s；
 *   元素反应（直接命中引发的，depth 0 且打中了东西）0.045 s。别的系统（斩击命中、技能落地）直接调 request。
 */
import type { DamageSource, GameContext } from '../core/types';
import { arbiterFor, TimePriority, type TimeScaleHandle } from '../enemies/bosses/framework/TimeScaleArbiter';

export const HITSTOP = {
  /** 顿帧时的时间缩放（不用 0：dt 为 0 时一些系统会跳过这一帧的结算） */
  DefaultScale: 0.05,
  MaxStop: 0.2,
  MinGap: 0.12,
  BudgetMax: 0.15,
  BudgetRate: 0.075,
  MinUseful: 0.012,
  KillStop: 0.035,
  EliteKillStop: 0.07,
  BossKillStop: 0.18,
  CritStop: 0.025,
  ReactionStop: 0.045,
  /** 重暴击：这一下打掉目标总量（护盾 + 护甲 + 生命上限）的比例 */
  HeavyCritFraction: 0.18,
} as const;

/** 时间缩放申请（TimeScaleArbiter 的子集，测试可以换成假的） */
export interface HitStopArbiter {
  request(owner: unknown, scale: number, priority: number, realSeconds?: number): TimeScaleHandle;
}

/** 玩家造成的（Unity HitStop.ByPlayer） */
export function byPlayer(source: DamageSource): boolean {
  return source === 'weapon' || source === 'skill' || source === 'melee' || source === 'explosion' || source === 'scroll';
}

/** 纯逻辑：频率上限、预算、延长合并（时钟、仲裁、能不能开始都注入） */
export class HitStopCore {
  enabled = true;
  private handle: TimeScaleHandle | null = null;
  private stopStart = 0;
  private stopUntil = 0;
  private lastStart = -10;
  private lastLength = 0;
  private budgetLeft: number = HITSTOP.BudgetMax;
  private budgetAt = 0;

  constructor(
    private readonly arbiter: HitStopArbiter,
    private readonly clock: () => number,
    /** 现在能开始（游戏进行中、时间没被别人压着、玩家活着） */
    private readonly canStart: () => boolean = () => true,
  ) {
    this.budgetAt = clock();
  }

  get active(): boolean {
    return this.handle !== null && this.handle.live;
  }

  /** 剩余预算（秒；先按真实时间回填） */
  get budget(): number {
    this.refill(this.clock());
    return this.budgetLeft;
  }

  get scale(): number {
    return this.handle?.scale ?? 1;
  }

  /** 申请一次顿帧：seconds 秒（真实时间，≤ 0.2），期间时间缩放 = scale。可能被延长合并、截短或忽略；返回是否生效 */
  request(seconds: number, scale: number = HITSTOP.DefaultScale): boolean {
    if (!this.enabled || !(seconds > 0)) return false;
    seconds = Math.min(seconds, HITSTOP.MaxStop);
    scale = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : HITSTOP.DefaultScale;
    const now = this.clock();
    this.refill(now);

    // 进行中：不叠加，只延长到较晚的结束（受单次上限与预算限制）
    if (this.active) {
      const end = Math.min(this.stopStart + HITSTOP.MaxStop, now + seconds);
      const extra = Math.min(end - this.stopUntil, this.budgetLeft);
      if (scale < this.handle!.scale) {
        this.handle!.dispose();
        this.handle = this.arbiter.request(this, scale, TimePriority.HitStop, 0);
      }
      if (extra <= 0.002) return false;
      this.budgetLeft -= extra;
      this.stopUntil += extra;
      return true;
    }

    if (!this.canStart()) return false;
    if (now - this.lastStart < HITSTOP.MinGap && seconds < this.lastLength * 2) return false;
    seconds = Math.min(seconds, this.budgetLeft);
    if (seconds < HITSTOP.MinUseful) return false;
    this.budgetLeft -= seconds;
    this.stopStart = this.lastStart = now;
    this.stopUntil = now + seconds;
    this.lastLength = seconds;
    this.handle = this.arbiter.request(this, scale, TimePriority.HitStop, 0);
    return true;
  }

  /** 每帧：到点（真实时间）或被仲裁器整体清掉时撤销 */
  update(): void {
    if (!this.handle) return;
    if (!this.handle.live || this.clock() >= this.stopUntil) this.release();
  }

  release(): void {
    this.handle?.dispose();
    this.handle = null;
  }

  private refill(now: number): void {
    if (now > this.budgetAt) this.budgetLeft = Math.min(HITSTOP.BudgetMax, this.budgetLeft + (now - this.budgetAt) * HITSTOP.BudgetRate);
    this.budgetAt = now;
  }
}

const realClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** 运行时：接 ctx 的仲裁器与战斗事件 */
export class HitStop extends HitStopCore {
  constructor(private readonly ctx: GameContext) {
    super(
      ctx.time ? arbiterFor(ctx.time) : { request: () => ({ scale: 1, priority: 0, live: false, dispose() {} }) },
      realClock,
      () => ctx.game?.state === 'playing' && ctx.time.timeScale >= 0.999 && ctx.player?.alive !== false,
    );
    const ev = ctx.events;
    if (!ev) return;
    ev.on('enemy:killed', ({ enemy, result }) => {
      if (!byPlayer(result.request.source)) return;
      this.request(enemy.isBoss ? HITSTOP.BossKillStop : enemy.isElite ? HITSTOP.EliteKillStop : HITSTOP.KillStop);
    });
    ev.on('enemy:damaged', ({ enemy, result }) => {
      if (!result.isCrit || result.killed) return;
      const src = result.request.source;
      if (src !== 'weapon' && src !== 'melee') return;
      const pool = Math.max(1, enemy.maxHp + (enemy.maxArmor ?? 0) + (enemy.maxShield ?? 0));
      if (result.dealt >= pool * HITSTOP.HeavyCritFraction) this.request(HITSTOP.CritStop);
    });
    ev.on('enemy:reaction', e => {
      if (e.depth === 0 && e.hits > 0) this.request(HITSTOP.ReactionStop);
    });
  }
}
