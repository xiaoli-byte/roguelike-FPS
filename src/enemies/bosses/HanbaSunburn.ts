/**
 * 日晒灼烧（玩家减益，旱魃「烈日」；Unity Combat/Status/SunburnStatus.cs 的 SunburnInstance 逐行移植）：
 *   暴露在日光 / 日轮直射下持续叠层——每暴露 0.5 s 叠一层，最多 10 层；每 0.5 s 跳 层数 × 0.6 火伤（满层 12 / s）。
 *   离开日晒（0.3 s 内没有再暴露）后每秒消退 3 层，躲进影子约 3 s 清空。踩浅水时由调用方把增益调低（gain < 1）。
 * 网页没有玩家状态系统（src/combat/Status.ts 只管敌人），这一层由旱魃自己持有、每帧推进、跳伤经 hurt 回调走 ctx.combat.damagePlayer。
 * 纯逻辑（不碰场景）。
 */

export const SUNBURN_STACK_SECONDS = 0.5;
export const SUNBURN_TICK_INTERVAL = 0.5;
export const SUNBURN_DAMAGE_PER_STACK = 0.6;
export const SUNBURN_DECAY_DELAY = 0.3;
export const SUNBURN_DECAY_PER_SECOND = 3;
export const SUNBURN_MAX_STACKS = 10;
/** Unity StatusTiming.TickEps */
const TICK_EPS = 1e-4;

export type SunburnHurt = (damage: number, from: { x: number; y: number; z: number } | null) => void;

export class SunburnInstance {
  private level = 0;
  private clock = 0;
  private lastExposed = 0;
  private tickTimer = SUNBURN_TICK_INTERVAL;
  /** 每层每跳的伤害（首领按难度改） */
  damagePerStack = SUNBURN_DAMAGE_PER_STACK;
  /** 日光来自哪里（受击方向；null = 玩家自己的位置） */
  sun: { x: number; y: number; z: number } | null = null;
  /** 层数变了（新层数） */
  onStacks: ((stacks: number) => void) | null = null;

  constructor(private readonly hurt: SunburnHurt | null = null) {}

  get active(): boolean {
    return this.level > 0;
  }

  /** 生效的层数 */
  get stacks(): number {
    return Math.min(SUNBURN_MAX_STACKS, Math.floor(this.level + TICK_EPS));
  }

  /** 此刻每跳伤害 */
  get tickDamage(): number {
    return this.stacks * this.damagePerStack;
  }

  /** 不再暴露时还要多久消退完 */
  get remaining(): number {
    return this.level > 0 ? SUNBURN_DECAY_DELAY + this.level / SUNBURN_DECAY_PER_SECOND : 0;
  }

  /** 暴露了 seconds 秒（已乘增益）：叠层并重置消退 */
  apply(seconds: number): boolean {
    const s = Number.isNaN(seconds) ? 0 : seconds;
    if (s <= 0) return false;
    const before = this.stacks;
    if (this.level <= 0) this.tickTimer = SUNBURN_TICK_INTERVAL;
    this.level = Math.min(SUNBURN_MAX_STACKS, this.level + s / SUNBURN_STACK_SECONDS);
    this.lastExposed = this.clock;
    const now = this.stacks;
    if (now !== before) this.onStacks?.(now);
    return true;
  }

  tick(dt: number): void {
    this.clock += dt;
    if (this.clock - this.lastExposed > SUNBURN_DECAY_DELAY) {
      this.level -= SUNBURN_DECAY_PER_SECOND * dt;
      if (this.level <= 0) {
        this.clear();
        return;
      }
    }
    if (this.stacks <= 0) {
      this.tickTimer = SUNBURN_TICK_INTERVAL;
      return;
    }
    this.tickTimer -= dt;
    if (this.tickTimer > TICK_EPS) return;
    this.tickTimer = Math.max(this.tickTimer + SUNBURN_TICK_INTERVAL, TICK_EPS * 2);
    const dmg = this.tickDamage;
    if (dmg > 0) this.hurt?.(dmg, this.sun);
  }

  clear(): void {
    const had = this.stacks;
    this.level = 0;
    this.tickTimer = SUNBURN_TICK_INTERVAL;
    if (had > 0) this.onStacks?.(0);
  }
}

/** PlayerStatus.SunExposure：暴露 seconds 秒 × 增益，带上每层伤害与日光来向 */
export function sunExposure(inst: SunburnInstance, seconds: number, gain = 1, damagePerStack = 0, sun: { x: number; y: number; z: number } | null = null): boolean {
  if (!(seconds > 0) || !(gain > 0)) return false;
  if (!inst.apply(seconds * gain)) return false;
  if (damagePerStack > 0) inst.damagePerStack = damagePerStack;
  if (sun) inst.sun = sun;
  return true;
}
