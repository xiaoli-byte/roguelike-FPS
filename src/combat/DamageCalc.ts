/**
 * 伤害计算的纯函数部分：元素分层倍率表、属性倍率、护盾 → 护甲 → 生命的分层结算。
 * 不产生任何副作用（除了 applyLayers 原地修改敌人的三层数值），便于 Combat 与 UI 预览复用。
 */
import type { DamageLayer, DamageRequest, Element, IEnemy, StatKey, StatusId } from '../core/types';
import { REACTION_TAG } from '../core/types';
import type { Stats } from '../core/Stats';

export { REACTION_TAG };

/** 元素 × 层 的伤害倍率（DESIGN.md 第 5 节） */
export const LAYER_MULT: Readonly<Record<Element, Readonly<Record<DamageLayer, number>>>> = {
  none: { shield: 1.0, armor: 0.75, health: 1.0 },
  fire: { shield: 0.8, armor: 1.0, health: 1.25 },
  shock: { shield: 1.6, armor: 0.8, health: 1.0 },
  corrode: { shield: 1.0, armor: 1.6, health: 1.0 },
};

/** 元素 → 专属伤害属性 */
export const ELEMENT_DAMAGE_STAT: Readonly<Record<Exclude<Element, 'none'>, StatKey>> = {
  fire: 'fireDamagePct',
  shock: 'shockDamagePct',
  corrode: 'corrodeDamagePct',
};

/** 元素 → 附着状态 */
export const ELEMENT_STATUS: Readonly<Record<Element, StatusId | null>> = {
  none: null,
  fire: 'burn',
  shock: 'shock',
  corrode: 'corrode',
};

/** 各层受击颜色（命中火花 / 伤害数字辅助色） */
export const LAYER_COLORS: Readonly<Record<DamageLayer, number>> = {
  shield: 0x7cc8ff,
  armor: 0xffd060,
  health: 0xff5a44,
};

/** 雷殛标记期间受到雷电伤害的额外倍率 */
export const SHOCK_MARK_BONUS = 1.15;

export function hasTag(req: DamageRequest, tag: string): boolean {
  const t = req.tags;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === tag) return true;
  return false;
}

/** 返回带有 tag 的标签数组（已有则原样返回，否则新建，不修改原数组） */
export function withTag(tags: readonly string[] | undefined, tag: string): string[] {
  if (!tags || tags.length === 0) return [tag];
  for (let i = 0; i < tags.length; i++) if (tags[i] === tag) return tags as string[];
  return [...tags, tag];
}

/**
 * 持续伤害（灼烧 / 蚀化跳伤）。雷殛弹射同样是 source 'status'（不暴击、只吃元素加成），
 * 但带 'chain' 标签，按直接命中处理（有命中火花与音效）。
 * 元素反应伤害（'reaction' 标签）也按直接命中处理，只有熔池跳伤（再带 'dot'）算持续伤害。
 */
export function isDot(req: DamageRequest): boolean {
  return req.source === 'status' && !hasTag(req, 'chain') && (!hasTag(req, REACTION_TAG) || hasTag(req, 'dot'));
}

/**
 * 属性带来的输出倍率（不含暴击、修饰器、分层）。
 *  - weapon / melee 或带 'weapon' 标签：× damagePct
 *  - skill 或带 'skill' 标签：× skillDamagePct
 *  - explosion 或带 'explosion' 标签：× explosionDamagePct
 *  - status（DOT / 链式）：强度已由触发的那一击决定，只再吃元素类加成
 *  - 元素非 none：× elementDamagePct × 对应元素 Pct
 *  - 精英 × eliteDamagePct，首领 × bossDamagePct
 *  - 元素反应（'reaction' 标签）：只乘 reactionDamagePct——反应威力取自附着强度，已含上面这些加成，避免二次相乘
 */
export function statMultiplier(stats: Stats, enemy: IEnemy, req: DamageRequest): number {
  if (hasTag(req, REACTION_TAG)) return stats.mult('reactionDamagePct');
  let m = 1;
  if (req.source !== 'status') {
    if (req.source === 'weapon' || req.source === 'melee' || hasTag(req, 'weapon')) m *= stats.mult('damagePct');
    if (req.source === 'skill' || hasTag(req, 'skill')) m *= stats.mult('skillDamagePct');
    if (req.source === 'explosion' || hasTag(req, 'explosion')) m *= stats.mult('explosionDamagePct');
  }
  if (req.element !== 'none') {
    m *= stats.mult('elementDamagePct') * stats.mult(ELEMENT_DAMAGE_STAT[req.element]);
  }
  if (enemy.isElite) m *= stats.mult('eliteDamagePct');
  if (enemy.isBoss) m *= stats.mult('bossDamagePct');
  return m;
}

/**
 * 状态伤害（DOT / 雷殛弹射，source 'status'）每一跳会吃到的属性倍率：元素类 Pct × 精英 / 首领 Pct。
 *
 * 状态的 power 取自触发那一击的最终伤害，其中已经含有这些倍率；施加状态时先把它们除掉，
 * 结算每一跳时再乘回来，保证同一份属性加成只计算一次（DESIGN 第 5 节：元素伤害类属性作用于 DOT）。
 */
export function dotStatMultiplier(stats: Stats, enemy: IEnemy, element: Element): number {
  let m = 1;
  if (element !== 'none') m *= stats.mult('elementDamagePct') * stats.mult(ELEMENT_DAMAGE_STAT[element]);
  if (enemy.isElite) m *= stats.mult('eliteDamagePct');
  if (enemy.isBoss) m *= stats.mult('bossDamagePct');
  return m > 0 && Number.isFinite(m) ? m : 1;
}

/** 元素状态对应的元素（持续伤害每一跳按它取属性加成） */
const DOT_ELEMENT = { burn: 'fire', shock: 'shock', corrode: 'corrode' } as const;

/**
 * 把「已含元素 / 精英 / 首领加成」的强度（命中伤害、反应伤害）折算成 applyStatus 的状态强度：
 * 先钳到最大生命 × 0.5，再除掉每一跳结算时会再乘回的属性倍率，免得加成算两次。
 */
export function statusPowerFromDealt(stats: Stats, enemy: IEnemy, status: 'burn' | 'shock' | 'corrode', dealt: number): number {
  const p = Math.min(Math.max(0, dealt), enemy.maxHp * 0.5) / dotStatMultiplier(stats, enemy, DOT_ELEMENT[status]);
  return Number.isFinite(p) ? p : 0;
}

/** 状态强度（不含加成）对应的反应强度：乘回属性倍率 */
export function reactionPowerFromStatus(stats: Stats, enemy: IEnemy, status: 'burn' | 'shock' | 'corrode', power: number): number {
  const p = power * dotStatMultiplier(stats, enemy, DOT_ELEMENT[status]);
  return Number.isFinite(p) ? Math.max(0, p) : 0;
}

/** 某元素打在某层上的最终倍率（含 shieldDamagePct / armorDamagePct） */
export function layerMultiplier(stats: Stats, element: Element, layer: DamageLayer): number {
  let m = LAYER_MULT[element][layer];
  if (layer === 'shield') m *= stats.mult('shieldDamagePct');
  else if (layer === 'armor') m *= stats.mult('armorDamagePct');
  return m;
}

/** 敌人当前最外层 */
export function topLayer(enemy: IEnemy): DamageLayer {
  return enemy.shield > 0 ? 'shield' : enemy.armor > 0 ? 'armor' : 'health';
}

export interface LayerOutcome {
  /** 实际扣除的总量（不含溢出） */
  dealt: number;
  /** 展示用总量：实际扣除 + 生命层的溢出（击杀时的「过量伤害」） */
  effective: number;
  /** 最先打到的层 */
  firstLayer: DamageLayer;
  /** 承受份额最大的层（伤害数字配色用） */
  mainLayer: DamageLayer;
  shieldBroken: boolean;
  armorBroken: boolean;
}

export function newLayerOutcome(): LayerOutcome {
  return { dealt: 0, effective: 0, firstLayer: 'health', mainLayer: 'health', shieldBroken: false, armorBroken: false };
}

/**
 * 把「层前伤害」raw 依次打在 护盾 → 护甲 → 生命 上（原地修改 enemy）。
 * 每层按「元素 × 层」倍率换算；打穿后剩余的层前伤害按下一层倍率重新换算。
 */
export function applyLayers(stats: Stats, enemy: IEnemy, raw: number, element: Element, out: LayerOutcome): LayerOutcome {
  out.dealt = 0;
  out.effective = 0;
  out.shieldBroken = false;
  out.armorBroken = false;
  out.firstLayer = topLayer(enemy);
  out.mainLayer = out.firstLayer;
  let best = 0;
  let remaining = raw;

  if (remaining > 0 && enemy.shield > 0) {
    const m = layerMultiplier(stats, element, 'shield');
    const eff = remaining * m;
    let took: number;
    if (eff >= enemy.shield) {
      took = enemy.shield;
      enemy.shield = 0;
      out.shieldBroken = true;
      remaining -= took / m;
    } else {
      took = eff;
      enemy.shield -= eff;
      remaining = 0;
    }
    out.dealt += took;
    out.effective += took;
    if (took > best) {
      best = took;
      out.mainLayer = 'shield';
    }
  }

  if (remaining > 1e-6 && enemy.armor > 0) {
    const m = layerMultiplier(stats, element, 'armor');
    const eff = remaining * m;
    let took: number;
    if (eff >= enemy.armor) {
      took = enemy.armor;
      enemy.armor = 0;
      out.armorBroken = true;
      remaining -= took / m;
    } else {
      took = eff;
      enemy.armor -= eff;
      remaining = 0;
    }
    out.dealt += took;
    out.effective += took;
    if (took > best) {
      best = took;
      out.mainLayer = 'armor';
    }
  }

  if (remaining > 1e-6) {
    const m = layerMultiplier(stats, element, 'health');
    const eff = remaining * m;
    const took = Math.min(eff, Math.max(0, enemy.hp));
    enemy.hp = Math.max(0, enemy.hp - eff);
    out.dealt += took;
    out.effective += eff;
    if (eff > best) out.mainLayer = 'health';
  }
  return out;
}
