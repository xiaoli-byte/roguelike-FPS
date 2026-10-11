/**
 * 武器描述（UI 交互提示 / 商店 / 结算用），全部为简体中文。
 * 伤害显示武器自身数值（稀有度 × 强化 × 词条），不含玩家的武器伤害加成；
 * 射速 / 弹匣 / 换弹等显示计入玩家属性后的实际值。
 * 蓄力武器显示伤害区间、蓄力时长与满蓄秒伤；元素轮转武器的元素行显示「三相轮转」并给出 elementLabel。
 * 魔刀千刃（docs/demon-blade-v2.md）列出斩、千刃出窍、刃气、屏障与武器技能。
 */
import type { WeaponDescription, WeaponInstance } from '../core/types';
import { ELEMENT_NAMES, RARITY_CSS, RARITY_NAMES } from '../core/types';
import { describeAffix, isLegendaryId, legendaryName } from './Affixes';
import { comboCycleTime, MAX_LEVEL } from './WeaponDefs';

/** 武器技能按键提示 */
const SKILL_KEY = 'V';
import type { ResolvedWeapon } from './WeaponStats';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function num(v: number): string {
  if (v >= 10) return `${Math.round(v)}`;
  return `${Math.round(v * 10) / 10}`;
}

/**
 * 武器显示名：传说前缀 + 名称。
 * 不含强化等级——HUD、Tab 面板、强化台、拾取提示、强化奖励提示都会自己在名字后面拼 `+等级`，
 * 这里再带上就会显示成「裂风步枪 +2 +2」。强化等级另见 stats 里的「强化」一行。
 */
export function weaponDisplayName(R: ResolvedWeapon): string {
  const lg = R.legendary ? legendaryName(R.legendary) : null;
  return `${lg ? `${lg}·` : ''}${R.def.name}`;
}

export function describeWeapon(inst: WeaponInstance, R: ResolvedWeapon): WeaponDescription {
  if (R.def.blade) return describeBlade(inst, R);
  const def = R.def;
  const count = def.projectile ? def.projectile.count : 1;
  const stats: { label: string; value: string }[] = [];

  const charge = def.mode === 'charge';
  let dmg: string;
  if (charge) {
    // 蓄力：最低（点按）– 满蓄
    dmg = `${num(R.damage * def.chargeMinMult)}–${num(R.damage)}`;
  } else {
    dmg = num(R.damage);
    if (def.pellets > 1) dmg += ` ×${def.pellets}`;
    else if (count > 1) dmg += ` ×${count}`;
    else if (def.mode === 'beam') dmg += ' /跳';
  }
  stats.push({ label: '伤害', value: dmg });
  if (R.explosionRadius > 0) stats.push({ label: '爆炸范围', value: `${R.explosionRadius.toFixed(1)} 米` });

  // 蓄力时长随射速加成缩短（与 WeaponSystem 的蓄力速度一致）
  const chargeSec = charge ? def.chargeTime / Math.max(0.01, R.fireRateMult) : 0;
  let rate: string;
  if (def.mode === 'burst') rate = `${R.fireRate.toFixed(1)} 轮/秒（${def.burstCount} 连发）`;
  else if (def.mode === 'beam') rate = `${Math.round(R.fireRate)} 跳/秒`;
  else if (charge) rate = `蓄力 ${chargeSec.toFixed(2)} 秒`;
  else if (count > 1) rate = `${R.fireRate.toFixed(2)} 轮/秒`;
  else rate = `${R.fireRate.toFixed(1)} 发/秒`;
  stats.push({ label: '射速', value: rate });
  // 蓄力武器的理论秒伤（每发满蓄 = 蓄力时长 + 松手冷却）已在 WeaponStats 里按蓄力计算
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
  const cycling = !!def.cycle && def.cycle.length > 0;
  let elemText: string;
  if (cycling) elemText = `三相轮转 ${pct(R.elementChance)}${per}`;
  else if (inst.element === 'none') elemText = ELEMENT_NAMES.none;
  else elemText = `${ELEMENT_NAMES[inst.element]} ${pct(R.elementChance)}${per}`;
  stats.push({ label: '元素', value: elemText });
  if (R.pierce > 0 || def.chargeFullPierce > 0) {
    stats.push({ label: '穿透', value: def.chargeFullPierce > 0 ? `${R.pierce}（满蓄 +${def.chargeFullPierce}）` : `${R.pierce}` });
  }
  stats.push({ label: '强化', value: `${inst.level}/${MAX_LEVEL}` });

  const desc: WeaponDescription = {
    name: weaponDisplayName(R),
    category: def.category,
    rarity: inst.rarity,
    rarityName: RARITY_NAMES[inst.rarity] ?? RARITY_NAMES[0],
    color: RARITY_CSS[inst.rarity] ?? RARITY_CSS[0],
    element: inst.element,
    stats,
    traits: traitLines(inst, R),
  };
  // 元素轮转：UI 用「三相」代替元素单字（inst.element 固定为第一种元素）
  if (cycling) desc.elementLabel = '三相';
  return desc;
}

/** 固有特性 + 词条 + 武器技能 + 传说（传说放最后） */
function traitLines(inst: WeaponInstance, R: ResolvedWeapon): string[] {
  const def = R.def;
  const traits: string[] = [...def.notes];
  const legendary: string[] = [];
  for (const a of inst.affixes) {
    const t = describeAffix(def, a);
    if (!t) continue;
    if (isLegendaryId(a.id)) legendary.push(t);
    else traits.push(t);
  }
  const b = def.blade;
  if (b) {
    traits.push(`【武器技能·杀气爆发】${SKILL_KEY} / 鼠标中键：碎片聚于准星落点后炸开，半径 ${num(b.burst.radius)} 米，伤害 ${num(b.burst.damage * R.damageMult)}。冷却 ${num(b.burst.cooldown)} 秒。`);
    traits.push(`【人刀合一】杀意满时 ${SKILL_KEY} 变为人刀合一：强化爆发后 ${num(b.union.duration)} 秒内斩击放出碎刃斩波，千刃出窍不耗刃气。`);
  }
  traits.push(...legendary);
  return traits;
}

/**
 * 魔刀千刃：三段斩伤害、攻速、千刃出窍伤害与结算频率、两种秒伤、刃气、屏障、暴击、元素、强化。
 */
function describeBlade(inst: WeaponInstance, R: ResolvedWeapon): WeaponDescription {
  const def = R.def;
  const b = def.blade!;
  const stats: { label: string; value: string }[] = [];
  stats.push({ label: '斩', value: b.combo.map((s) => num(s.damage * R.damageMult)).join(' / ') });
  const cycle = comboCycleTime(def) / Math.max(0.01, R.fireRateMult);
  stats.push({ label: '攻速', value: `一轮 ${cycle.toFixed(2)} 秒` });
  stats.push({ label: '千刃出窍', value: `${num(b.swarm.damage * R.damageMult)} ×${num(1 / b.swarm.tick)}/秒 · 半径 ${num(b.swarm.radius)} 米` });
  stats.push({ label: '秒伤', value: `斩 约 ${Math.round(R.meleeDps)} · 千刃 约 ${Math.round(R.dps)}` });
  stats.push({ label: '刃气', value: `${b.qi.max}（出窍 −${b.swarm.drain}/秒 · 屏障 −${b.shield.drain}/秒）` });
  stats.push({
    label: '暴击',
    value: `×${R.critMult.toFixed(1)}${R.critChance > 0 ? `（+${pct(R.critChance)} 暴击率）` : ''}`,
  });
  stats.push({ label: '元素', value: inst.element === 'none' ? ELEMENT_NAMES.none : `${ELEMENT_NAMES[inst.element]} ${pct(R.elementChance)}` });
  stats.push({ label: '强化', value: `${inst.level}/${MAX_LEVEL}` });

  return {
    name: weaponDisplayName(R),
    category: def.category,
    rarity: inst.rarity,
    rarityName: RARITY_NAMES[inst.rarity] ?? RARITY_NAMES[0],
    color: RARITY_CSS[inst.rarity] ?? RARITY_CSS[0],
    element: inst.element,
    stats,
    traits: traitLines(inst, R),
    skill: {
      name: '杀气爆发', key: SKILL_KEY,
      description: `碎片聚于准星落点后炸开，半径 ${num(b.burst.radius)} 米；杀意满时变为人刀合一。`,
      cooldown: b.burst.cooldown,
    },
  };
}
