/**
 * 把「武器定义 + 实例（稀有度 / 强化 / 词条）+ 玩家属性」合成为实际数值。
 * 结果按实例缓存（WeakMap），玩家属性版本号、强化等级、稀有度、词条数、元素任一变化时重算。
 */
import type { Stats } from '../core/Stats';
import type { WeaponInstance } from '../core/types';
import { isLegendaryId, type LegendaryId } from './Affixes';
import { clamp } from '../core/math';
import { comboCycleTime, getWeaponDef, hitsPerShot, LEVEL_DAMAGE, RARITY_DAMAGE, shotsPerSecond, type WeaponDef } from './WeaponDefs';

export interface ResolvedWeapon {
  def: WeaponDef;
  /** 单发 / 单弹丸 / 单跳伤害（稀有度 × 强化 × 词条；不含玩家 damagePct，Combat 会乘） */
  damage: number;
  /**
   * 本武器伤害倍率 = 稀有度倍率 × 强化倍率 × (1 + 伤害词条)（damage = def.damage × damageMult）。
   * 魔刀千刃的斩击 / 武器技能伤害 = 基础值 × damageMult（docs/demon-blade.md 第 6、10 节）
   */
  damageMult: number;
  /** 每秒射击次数（不含「狂热」层数） */
  fireRate: number;
  /** 相对定义射速的倍率（用于点射间隔、机炮预热） */
  fireRateMult: number;
  magCap: number;
  reserveCap: number;
  reloadTime: number;
  shellTime: number;
  reloadStart: number;
  spreadMult: number;
  recoilMult: number;
  critMult: number;
  /** 词条额外暴击率（武器系统自行掷骰后设置 forceCrit） */
  critChance: number;
  elementChance: number;
  /** 双形态武器斩击的元素附着概率（def.melee.elementChance + 词条；无元素为 0）；普通武器同 elementChance */
  meleeElementChance: number;
  pierce: number;
  projSpeedMult: number;
  /** 已乘玩家 explosionRadiusPct 与词条 */
  explosionRadius: number;
  /** 玩家爆炸范围倍率（特性爆炸用） */
  blastMult: number;
  headBlast: number;
  killRefill: number;
  hitShield: number;
  ricochet: number;
  hunter: number;
  swift: number;
  // ───── 元素反应类词条（触发见 AffixEffects） ─────
  /** 「副·焚 / 副·雷 / 副·蚀」每次命中的附着几率 */
  subFire: number;
  subShock: number;
  subCorrode: number;
  /** 「化合」本武器引发的反应伤害加成 */
  rxnDmg: number;
  /** 「回元」引发反应时回填弹匣的比例 */
  rxnRefill: number;
  /** 「疾化」射速加成（AffixEffects 写 rt.rxnHasteUntil，WeaponSystem 读取） */
  rxnHaste: number;
  /** 「乘隙」目标每带一种元素状态的伤害加成 */
  statusHunter: number;
  /** 「化盾」引发反应时获得的护盾 */
  rxnShield: number;
  /** 「破势」引爆强度倍率（0 = 无） */
  detonate: number;
  /** 「蛊种」传染威力比例（0 = 无） */
  seed: number;
  legendary: LegendaryId | null;
  legendaryValue: number;
  /** 每次扣扳机的总伤害（弹丸 × 弹体） */
  perShot: number;
  /** 理论秒伤（不含换弹；蓄力武器按每发满蓄计；双形态武器为远程形态） */
  dps: number;
  /** 双形态武器近战形态的单体理论秒伤（一轮连段伤害 / 一轮时长，射速加成 = 攻速）；普通武器 0 */
  meleeDps: number;
  /**
   * 斩击命中的「每次命中几率」归一化系数 = 远程形态每秒命中数 / 近战每秒挥砍段数，钳制在 [0.5, 3]
   * （魔刀 = 6 / 2.83 ≈ 2.12；普通武器 1）。副元素 / 万象等几率按远程形态的命中频率抽取，斩击命中时乘上它
   */
  meleeHitScale: number;
  // 缓存键
  kVersion: number;
  kLevel: number;
  kRarity: number;
  kAffixes: number;
  kElement: string;
}

const cache = new WeakMap<WeaponInstance, ResolvedWeapon>();

/** 词条累计（同 id 叠加） */
interface Totals {
  dmg: number; rate: number; mag: number; reload: number; critDmg: number; critChance: number; elemChance: number;
  spread: number; recoil: number; headBlast: number; killRefill: number; hitShield: number; ricochet: number;
  pierce: number; blast: number; projSpeed: number; reserve: number; hunter: number; swift: number;
  subFire: number; subShock: number; subCorrode: number; rxnDmg: number; rxnRefill: number; rxnHaste: number;
  statusHunter: number; rxnShield: number; detonate: number; seed: number;
}

const _t: Totals = {
  dmg: 0, rate: 0, mag: 0, reload: 0, critDmg: 0, critChance: 0, elemChance: 0, spread: 0, recoil: 0,
  headBlast: 0, killRefill: 0, hitShield: 0, ricochet: 0, pierce: 0, blast: 0, projSpeed: 0, reserve: 0, hunter: 0, swift: 0,
  subFire: 0, subShock: 0, subCorrode: 0, rxnDmg: 0, rxnRefill: 0, rxnHaste: 0, statusHunter: 0, rxnShield: 0, detonate: 0, seed: 0,
};

function sumAffixes(inst: WeaponInstance): { lg: LegendaryId | null; lgValue: number } {
  for (const k in _t) (_t as unknown as Record<string, number>)[k] = 0;
  let lg: LegendaryId | null = null;
  let lgValue = 0;
  for (const a of inst.affixes) {
    if (isLegendaryId(a.id)) {
      lg = a.id;
      lgValue = a.value;
    } else if (a.id in _t) {
      (_t as unknown as Record<string, number>)[a.id] += a.value;
    }
  }
  return { lg, lgValue };
}

function blank(def: WeaponDef): ResolvedWeapon {
  return {
    def, damage: 0, damageMult: 1, fireRate: 0, fireRateMult: 1, magCap: 1, reserveCap: 0, reloadTime: 1, shellTime: 0, reloadStart: 0,
    spreadMult: 1, recoilMult: 1, critMult: 2, critChance: 0, elementChance: 0, meleeElementChance: 0, pierce: 0, projSpeedMult: 1,
    explosionRadius: 0, blastMult: 1, headBlast: 0, killRefill: 0, hitShield: 0, ricochet: 0, hunter: 0, swift: 0,
    subFire: 0, subShock: 0, subCorrode: 0, rxnDmg: 0, rxnRefill: 0, rxnHaste: 0, statusHunter: 0, rxnShield: 0, detonate: 0, seed: 0,
    legendary: null, legendaryValue: 0, perShot: 0, dps: 0, meleeDps: 0, meleeHitScale: 1,
    kVersion: -1, kLevel: -1, kRarity: -1, kAffixes: -1, kElement: '',
  };
}

/** 取实例的实际数值（带缓存，热路径可每帧调用） */
export function resolveWeapon(inst: WeaponInstance, stats: Stats): ResolvedWeapon {
  let r = cache.get(inst);
  const def = getWeaponDef(inst.defId);
  if (!r || r.def !== def) {
    r = blank(def);
    cache.set(inst, r);
  }
  if (r.kVersion === stats.version && r.kLevel === inst.level && r.kRarity === inst.rarity && r.kAffixes === inst.affixes.length && r.kElement === inst.element) {
    return r;
  }
  const { lg, lgValue } = sumAffixes(inst);
  const t = _t;

  const rarityMult = RARITY_DAMAGE[inst.rarity] ?? 1;
  r.damageMult = rarityMult * (1 + LEVEL_DAMAGE * inst.level) * (1 + t.dmg);
  r.damage = def.damage * r.damageMult;
  r.fireRateMult = stats.mult('fireRatePct') * (1 + t.rate);
  r.fireRate = def.fireRate * r.fireRateMult;
  r.magCap = Math.max(1, Math.round(def.mag * stats.mult('magSizePct') * (1 + t.mag)));
  r.reserveCap = Math.max(0, Math.round(def.reserve * stats.mult('ammoReservePct') * (1 + t.reserve)));
  const reloadMult = Math.max(0.25, 1 + stats.get('reloadSpeedPct') + t.reload);
  r.reloadTime = def.reloadTime / reloadMult;
  r.shellTime = def.shellTime / reloadMult;
  r.reloadStart = def.reloadStart / reloadMult;
  r.spreadMult = Math.max(0.1, (1 + stats.get('spreadPct')) * (1 - t.spread));
  r.recoilMult = Math.max(0, (1 + stats.get('recoilPct')) * (1 - t.recoil));
  r.critMult = def.critMult * (1 + t.critDmg);
  r.critChance = t.critChance;
  r.elementChance = inst.element === 'none' ? 0 : Math.min(1, def.elementChance + t.elemChance);
  r.meleeElementChance = !def.melee ? r.elementChance : inst.element === 'none' ? 0 : Math.min(1, def.melee.elementChance + t.elemChance);
  r.pierce = def.pierce + Math.round(t.pierce);
  r.projSpeedMult = stats.mult('projectileSpeedPct') * (1 + t.projSpeed);
  r.blastMult = stats.mult('explosionRadiusPct');
  r.explosionRadius = def.projectile && def.projectile.explosionRadius > 0 ? def.projectile.explosionRadius * r.blastMult * (1 + t.blast) : 0;
  r.headBlast = t.headBlast;
  r.killRefill = t.killRefill;
  r.hitShield = t.hitShield;
  r.ricochet = t.ricochet;
  r.hunter = t.hunter;
  r.swift = t.swift;
  r.subFire = t.subFire;
  r.subShock = t.subShock;
  r.subCorrode = t.subCorrode;
  r.rxnDmg = t.rxnDmg;
  r.rxnRefill = t.rxnRefill;
  r.rxnHaste = t.rxnHaste;
  r.statusHunter = t.statusHunter;
  r.rxnShield = t.rxnShield;
  r.detonate = t.detonate;
  r.seed = t.seed;
  r.legendary = lg;
  r.legendaryValue = lgValue;
  r.perShot = r.damage * hitsPerShot(def);
  // 蓄力武器：每发满蓄 = 蓄力时长（随射速加成缩短）+ 松手冷却
  r.dps = def.mode === 'charge'
    ? r.perShot / (1 / Math.max(0.01, r.fireRate) + def.chargeTime / Math.max(0.01, r.fireRateMult))
    : r.perShot * shotsPerSecond(def, r.fireRate);
  const m = def.melee;
  const cycle = comboCycleTime(def);
  if (m && m.combo.length > 0 && cycle > 0) {
    let sum = 0;
    for (const seg of m.combo) sum += seg.damage;
    r.meleeDps = (sum * r.damageMult) / (cycle / Math.max(0.01, r.fireRateMult));
    r.meleeHitScale = clamp((shotsPerSecond(def) * hitsPerShot(def)) / (m.combo.length / cycle), 0.5, 3);
  } else {
    r.meleeDps = 0;
    r.meleeHitScale = 1;
  }

  r.kVersion = stats.version;
  r.kLevel = inst.level;
  r.kRarity = inst.rarity;
  r.kAffixes = inst.affixes.length;
  r.kElement = inst.element;
  return r;
}

/** 「连环爆」爆炸基础伤害：随武器秒伤与单发伤害增长，钳制在 [35, 220]（再乘稀有度等已含在 damage 中） */
export function novaDamage(r: ResolvedWeapon): number {
  return Math.min(220, Math.max(35, 0.35 * r.dps + 0.5 * r.perShot));
}
