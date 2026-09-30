/**
 * 英雄技能槽：Q（主技能）/ E（副技能）的充能、逐格冷却、释放与持续更新。
 *
 *  - 冷却 = def.cooldown / (1 + skillHaste)；急速变化时按比例换算正在恢复的那一格。
 *  - 副技能最大充能 = def.charges + secondaryCharges；上限提高时立即获得新增的充能。
 *  - 按键时 def.activate(ctx) 返回 true 才消耗充能并广播 skill:used。
 *  - 持续型技能处于激活状态（isActive）时不能重复释放。
 */
import type { GameContext, HeroDef, SkillDef, SkillState } from '../core/types';
import type { Stats } from '../core/Stats';
import type { HeroSkillDef } from './skills/common';

export type SkillSlot = 'primary' | 'secondary';

const DENY_INTERVAL = 0.35;

export class SkillController {
  readonly states: { primary: SkillState | null; secondary: SkillState | null } = { primary: null, secondary: null };
  private lastDeny = -999;

  constructor(private readonly ctx: GameContext, private readonly stats: Stats) {}

  /** 按英雄重建技能状态（满充能、无冷却）。会先终止旧英雄仍在持续的技能效果。 */
  setup(hero: HeroDef | null): void {
    this.teardown();
    if (!hero) return;
    this.states.primary = this.createState(hero.primary, 'primary');
    this.states.secondary = this.createState(hero.secondary, 'secondary');
  }

  /** 终止持续效果并清空技能槽 */
  teardown(): void {
    for (const slot of SLOTS) {
      const s = this.states[slot];
      if (!s) continue;
      try {
        (s.def as HeroSkillDef).reset?.(this.ctx);
      } catch (err) {
        console.error('[Skill] reset threw', err);
      }
      this.states[slot] = null;
    }
  }

  /** 每帧：恢复充能、处理按键、驱动持续型技能 */
  update(dt: number, acceptInput: boolean): void {
    const input = this.ctx.input;
    for (const slot of SLOTS) {
      const s = this.states[slot];
      if (!s) continue;
      this.recharge(s, slot, dt);
      if (acceptInput && input.pressed(slot === 'primary' ? 'skillPrimary' : 'skillSecondary')) this.tryUse(s, slot);
    }
    for (const slot of SLOTS) {
      const s = this.states[slot];
      if (!s || !s.def.update) continue;
      try {
        s.def.update(this.ctx, dt);
      } catch (err) {
        console.error('[Skill] update threw', s.def.id, err);
      }
    }
  }

  /** 立即回复冷却秒数（可跨越多格充能） */
  reduce(seconds: number, which: SkillSlot | 'both' = 'both'): void {
    if (!(seconds > 0)) return;
    for (const slot of SLOTS) {
      if (which !== 'both' && which !== slot) continue;
      const s = this.states[slot];
      if (!s || s.charges >= s.maxCharges) continue;
      if (s.cooldownRemaining <= 0) s.cooldownRemaining = s.cooldownTotal;
      s.cooldownRemaining -= seconds;
      this.settle(s);
    }
  }

  // ───────────── 内部 ─────────────

  private createState(def: SkillDef, slot: SkillSlot): SkillState {
    const max = this.maxChargesFor(def, slot);
    return { def, charges: max, maxCharges: max, cooldownRemaining: 0, cooldownTotal: this.cooldownFor(def) };
  }

  private cooldownFor(def: SkillDef): number {
    return Math.max(0.1, def.cooldown / Math.max(0.2, 1 + this.stats.get('skillHaste')));
  }

  private maxChargesFor(def: SkillDef, slot: SkillSlot): number {
    const extra = slot === 'secondary' ? Math.round(this.stats.get('secondaryCharges')) : 0;
    return Math.max(1, Math.round(def.charges) + extra);
  }

  private recharge(s: SkillState, slot: SkillSlot, dt: number): void {
    // 急速变化：按比例换算剩余时间
    const total = this.cooldownFor(s.def);
    if (total !== s.cooldownTotal) {
      if (s.cooldownRemaining > 0 && s.cooldownTotal > 0) s.cooldownRemaining *= total / s.cooldownTotal;
      s.cooldownTotal = total;
    }
    // 充能上限变化
    const max = this.maxChargesFor(s.def, slot);
    if (max !== s.maxCharges) {
      if (max > s.maxCharges) s.charges += max - s.maxCharges;
      s.maxCharges = max;
      if (s.charges > max) s.charges = max;
    }
    if (s.charges >= s.maxCharges) {
      s.cooldownRemaining = 0;
      return;
    }
    if (s.cooldownRemaining <= 0) s.cooldownRemaining = s.cooldownTotal;
    s.cooldownRemaining -= dt;
    this.settle(s);
  }

  /** 把 <=0 的剩余时间结算成充能（溢出时间顺延到下一格） */
  private settle(s: SkillState): void {
    while (s.cooldownRemaining <= 0 && s.charges < s.maxCharges) {
      s.charges++;
      if (s.charges < s.maxCharges) s.cooldownRemaining += s.cooldownTotal;
      else s.cooldownRemaining = 0;
    }
  }

  private tryUse(s: SkillState, slot: SkillSlot): void {
    const ctx = this.ctx;
    if (s.charges < 1 || s.def.isActive?.(ctx)) {
      this.deny();
      return;
    }
    let ok = false;
    try {
      ok = s.def.activate(ctx);
    } catch (err) {
      console.error('[Skill] activate threw', s.def.id, err);
    }
    if (!ok) {
      this.deny();
      return;
    }
    const wasFull = s.charges >= s.maxCharges;
    s.charges--;
    if (wasFull || s.cooldownRemaining <= 0) s.cooldownRemaining = s.cooldownTotal;
    ctx.events.emit('skill:used', { slot, skillId: s.def.id });
  }

  private deny(): void {
    const now = this.ctx.time.now;
    if (now - this.lastDeny < DENY_INTERVAL) return;
    this.lastDeny = now;
    this.ctx.audio.play('ui_deny', { volume: 0.4 });
  }
}

const SLOTS: readonly SkillSlot[] = ['primary', 'secondary'];
