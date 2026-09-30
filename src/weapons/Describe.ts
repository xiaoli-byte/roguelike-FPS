/**
 * 武器描述（UI 交互提示 / 商店 / 结算用），全部为简体中文。
 * 伤害显示武器自身数值（稀有度 × 强化 × 词条），不含玩家的武器伤害加成；
 * 射速 / 弹匣 / 换弹等显示计入玩家属性后的实际值。
 */
import type { WeaponDescription, WeaponInstance } from '../core/types';
import { ELEMENT_NAMES, RARITY_CSS, RARITY_NAMES } from '../core/types';
import { describeAffix, isLegendaryId, legendaryName } from './Affixes';
import { MAX_LEVEL } from './WeaponDefs';
import type { ResolvedWeapon } from './WeaponStats';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function num(v: number): string {
  if (v >= 10) return `${Math.round(v)}`;
  return `${Math.round(v * 10) / 10}`;
}

/** 武器显示名：传说前缀 + 名称 + 强化等级 */
export function weaponDisplayName(inst: WeaponInstance, R: ResolvedWeapon): string {
  const lg = R.legendary ? legendaryName(R.legendary) : null;
  return `${lg ? `${lg}·` : ''}${R.def.name}${inst.level > 0 ? ` +${inst.level}` : ''}`;
}

export function describeWeapon(inst: WeaponInstance, R: ResolvedWeapon): WeaponDescription {
  const def = R.def;
  const count = def.projectile ? def.projectile.count : 1;
  const stats: { label: string; value: string }[] = [];

  let dmg = num(R.damage);
  if (def.pellets > 1) dmg += ` ×${def.pellets}`;
  else if (count > 1) dmg += ` ×${count}`;
  else if (def.mode === 'beam') dmg += ' /跳';
  stats.push({ label: '伤害', value: dmg });
  if (R.explosionRadius > 0) stats.push({ label: '爆炸范围', value: `${R.explosionRadius.toFixed(1)} 米` });

  let rate: string;
  if (def.mode === 'burst') rate = `${R.fireRate.toFixed(1)} 轮/秒（${def.burstCount} 连发）`;
  else if (def.mode === 'beam') rate = `${Math.round(R.fireRate)} 跳/秒`;
  else if (count > 1) rate = `${R.fireRate.toFixed(2)} 轮/秒`;
  else rate = `${R.fireRate.toFixed(1)} 发/秒`;
  stats.push({ label: '射速', value: rate });
  stats.push({ label: '秒伤', value: `约 ${Math.round(R.dps)}` });
  stats.push({ label: '弹匣', value: def.mode === 'beam' ? `${R.magCap} 能量` : `${R.magCap}` });
  stats.push({ label: '备弹', value: `${R.reserveCap}` });
  stats.push({
    label: '换弹',
    value: def.shellTime > 0 ? `${R.shellTime.toFixed(2)} 秒/发` : `${R.reloadTime.toFixed(1)} 秒`,
  });
  stats.push({
    label: '暴击',
    value: `×${R.critMult.toFixed(1)}${R.critChance > 0 ? `（+${pct(R.critChance)} 暴击率）` : ''}`,
  });
  const per = def.pellets > 1 ? '（每弹丸）' : def.mode === 'beam' ? '（每跳）' : '';
  stats.push({
    label: '元素',
    value: inst.element === 'none' ? ELEMENT_NAMES.none : `${ELEMENT_NAMES[inst.element]} ${pct(R.elementChance)}${per}`,
  });
  if (R.pierce > 0) stats.push({ label: '穿透', value: `${R.pierce}` });
  stats.push({ label: '强化', value: `${inst.level}/${MAX_LEVEL}` });

  const traits: string[] = [...def.notes];
  const legendary: string[] = [];
  for (const a of inst.affixes) {
    const t = describeAffix(def, a);
    if (!t) continue;
    if (isLegendaryId(a.id)) legendary.push(t);
    else traits.push(t);
  }
  traits.push(...legendary);

  return {
    name: weaponDisplayName(inst, R),
    category: def.category,
    rarity: inst.rarity,
    rarityName: RARITY_NAMES[inst.rarity] ?? RARITY_NAMES[0],
    color: RARITY_CSS[inst.rarity] ?? RARITY_CSS[0],
    element: inst.element,
    stats,
    traits,
  };
}
