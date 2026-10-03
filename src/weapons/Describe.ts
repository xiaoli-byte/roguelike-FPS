/**
 * 武器描述（UI 交互提示 / 商店 / 结算用），全部为简体中文。
 * 伤害显示武器自身数值（稀有度 × 强化 × 词条），不含玩家的武器伤害加成；
 * 射速 / 弹匣 / 换弹等显示计入玩家属性后的实际值。
 * 蓄力武器显示伤害区间、蓄力时长与满蓄秒伤；元素轮转武器的元素行显示「三相轮转」并给出 elementLabel。
 * 双形态武器（魔刀千刃）分别列出两种形态的数值（docs/demon-blade.md 10.11.3），并给出 formNames 与武器技能。
 */
import type { WeaponDescription, WeaponInstance } from '../core/types';
import { ELEMENT_NAMES, RARITY_CSS, RARITY_NAMES } from '../core/types';
import { describeAffix, isLegendaryId, legendaryName } from './Affixes';
import { WEAPON_SKILL_KEY as SKILL_KEY } from './BladeSkill';
import { comboCycleTime, MAX_LEVEL } from './WeaponDefs';
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
  if (R.def.melee) return describeDualForm(inst, R);
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
  const sk = def.skill;
  if (sk) {
    const end = /[。！？]$/.test(sk.description) ? '' : '。';
    traits.push(`【武器技能·${sk.name}】${SKILL_KEY} / 鼠标中键：${sk.description}${end}冷却 ${num(sk.cooldown)} 秒。`);
  }
  traits.push(...legendary);
  return traits;
}

/**
 * 双形态武器：斩击各段伤害、飞刃伤害 × 枚数、攻速（一轮连段时长，射速加成 = 攻速）、射速、两形态秒伤、
 * 弹匣（飞刃）、召回（代替「备弹」「换弹」）、暴击、两形态元素几率、穿透（飞刃）、强化。
 */
function describeDualForm(inst: WeaponInstance, R: ResolvedWeapon): WeaponDescription {
  const def = R.def;
  const m = def.melee!;
  const [meleeName, rangedName] = m.formNames;
  const count = def.projectile ? def.projectile.count : 1;
  const stats: { label: string; value: string }[] = [];

  stats.push({ label: `${meleeName}击`, value: m.combo.map((s) => num(s.damage * R.damageMult)).join(' / ') });
  stats.push({ label: '飞刃', value: count > 1 ? `${num(R.damage)} ×${count}` : num(R.damage) });
  const cycle = comboCycleTime(def) / Math.max(0.01, R.fireRateMult);
  stats.push({ label: '攻速', value: `一轮 ${cycle.toFixed(2)} 秒` });
  stats.push({ label: '射速', value: `${R.fireRate.toFixed(1)} 轮/秒` });
  stats.push({ label: '秒伤', value: `${meleeName} 约 ${Math.round(R.meleeDps)} · ${rangedName} 约 ${Math.round(R.dps)}` });
  stats.push({ label: '弹匣', value: `${R.magCap} 柄飞刃` });
  if (def.recall) {
    stats.push({ label: '召回', value: `${R.reloadTime.toFixed(1)} 秒` });
  } else {
    stats.push({ label: '备弹', value: `${R.reserveCap}` });
    stats.push({ label: '换弹', value: `${R.reloadTime.toFixed(1)} 秒` });
  }
  stats.push({
    label: '暴击',
    value: `×${R.critMult.toFixed(1)}${R.critChance > 0 ? `（+${pct(R.critChance)} 暴击率）` : ''}`,
  });
  const elemText = inst.element === 'none'
    ? ELEMENT_NAMES.none
    : `${ELEMENT_NAMES[inst.element]} ${meleeName} ${pct(R.meleeElementChance)} · 飞刃 ${pct(R.elementChance)}`;
  stats.push({ label: '元素', value: elemText });
  if (R.pierce > 0) stats.push({ label: '穿透', value: `${R.pierce}（飞刃）` });
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
    formNames: [meleeName, rangedName],
  };
  const sk = def.skill;
  if (sk) desc.skill = { name: sk.name, key: SKILL_KEY, description: sk.description, cooldown: sk.cooldown };
  return desc;
}
