/**
 * 破防条（Unity BreakBar.cs；第四章领主通用，旱魃没有——定义里 breakBar 为 null）。纯逻辑：首领持有一份、按伤害喂它、到点调硬直。
 *   · 填：打弱点、反应伤害往里填（fillFrom）；场地机关直接 add。
 *   · 满了 = 破防：倒地 seconds 秒、受伤 × takenMult；之后清空，下一次多要 growth。
 *   · 破防期间不再填；登场、转阶段时不填（locked）。
 */
import { breakBarDef, type BreakBarDef } from './BossDef';

export class BreakBar {
  readonly def: BreakBarDef;
  private value = 0;
  private brokenLeft = 0;
  breaks = 0;
  /** 暂停填充（登场、转阶段、演出中） */
  locked = false;
  /** 破防了（第几次，从 1 起） */
  onBroke: ((bar: BreakBar, count: number) => void) | null = null;
  /** 破防结束（站起来了） */
  onRecovered: ((bar: BreakBar) => void) | null = null;

  constructor(def: BreakBarDef | null) {
    this.def = def ?? breakBarDef();
  }

  get current(): number {
    return this.value;
  }

  /** 这一次要填满多少：max × (1 + growth × 已破次数) */
  get threshold(): number {
    return Math.max(1, this.def.max * (1 + this.def.growth * this.breaks));
  }

  /** 填充比例 0..1（破防中为 1） */
  get fill(): number {
    return this.broken ? 1 : Math.min(1, Math.max(0, this.value / this.threshold));
  }

  get broken(): boolean {
    return this.brokenLeft > 0;
  }

  get remaining(): number {
    return this.brokenLeft;
  }

  /** 加 amount；满了就破防并返回 true（破防中 / 锁着 / amount 非法时什么都不做） */
  add(amount: number): boolean {
    if (this.broken || this.locked || !(amount > 0) || !Number.isFinite(amount)) return false;
    this.value += amount;
    if (this.value < this.threshold) return false;
    this.break();
    return true;
  }

  /** 直接破防（调试；锁着时也破） */
  break(): void {
    this.value = 0;
    this.breaks++;
    this.brokenLeft = Math.max(0.01, this.def.seconds);
    try {
      this.onBroke?.(this, this.breaks);
    } catch (err) {
      console.error('[BreakBar] onBroke threw', err);
    }
  }

  tick(dt: number): void {
    if (this.brokenLeft <= 0 || !(dt > 0)) return;
    this.brokenLeft -= dt;
    if (this.brokenLeft > 0) return;
    this.brokenLeft = 0;
    try {
      this.onRecovered?.(this);
    } catch (err) {
      console.error('[BreakBar] onRecovered threw', err);
    }
  }

  /** 提前结束破防（转阶段、倒下）：不发 onRecovered */
  cancel(): void {
    this.brokenLeft = 0;
  }

  reset(): void {
    this.value = 0;
    this.brokenLeft = 0;
    this.breaks = 0;
  }

  /** 一次伤害该往条里填多少：反应伤害 × reactionFill，打中弱点 × weakFill，其余 0 */
  fillFrom(hit: { reaction?: boolean; weakpoint?: boolean }, dealt: number): number {
    if (!(dealt > 0)) return 0;
    if (hit.reaction) return dealt * this.def.reactionFill;
    if (hit.weakpoint) return dealt * this.def.weakFill;
    return 0;
  }
}
