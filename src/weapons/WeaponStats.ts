/**
 * 把「武器定义 + 实例（稀有度 / 强化 / 词条）+ 玩家属性」合成为实际数值。
 * 结果按实例缓存（WeakMap），玩家属性版本号、强化等级、稀有度、词条数、元素任一变化时重算。
 */
import type { Stats } from '../core/Stats';
import type { WeaponInstance } from '../core/types';
import { isLegendaryId, type LegendaryId } from './Affixes';
import { getWeaponDef, hitsPerShot, LEVEL_DAMAGE, RARITY_DAMAGE, shotsPerSecond, type WeaponDef } from './WeaponDefs';

export interface ResolvedWeapon {
  def: WeaponDef;
  /** 单发 / 单弹丸 / 单跳伤害（稀有度 × 强化 × 词条；不含玩家 damagePct，Combat 会乘） */
  damage: number;
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
  legendary: LegendaryId | null;
  legendaryValue: number;
  /** 每次扣扳机的总伤害（弹丸 × 弹体） */
  perShot: number;
  /** 理论秒伤（不含换弹） */
  dps: number;
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
}

const _t: Totals = {
  dmg: 0, rate: 0, mag: 0, reload: 0, critDmg: 0, critChance: 0, elemChance: 0, spread: 0, recoil: 0,
  headBlast: 0, killRefill: 0, hitShield: 0, ricochet: 0, pierce: 0, blast: 0, projSpeed: 0, reserve: 0, hunter: 0, swift: 0,
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
    def, damage: 0, fireRate: 0, fireRateMult: 1, magCap: 1, reserveCap: 0, reloadTime: 1, shellTime: 0, reloadStart: 0,
    spreadMult: 1, recoilMult: 1, critMult: 2, critChance: 0, elementChance: 0, pierce: 0, projSpeedMult: 1,
    explosionRadius: 0, blastMult: 1, headBlast: 0, killRefill: 0, hitShield: 0, ricochet: 0, hunter: 0, swift: 0,
    legendary: null, legendaryValue: 0, perShot: 0, dps: 0,
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
  r.damage = def.damage * rarityMult * (1 + LEVEL_DAMAGE * inst.level) * (1 + t.dmg);
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
  r.legendary = lg;
  r.legendaryValue = lgValue;
  r.perShot = r.damage * hitsPerShot(def);
  r.dps = r.perShot * shotsPerSecond(def, r.fireRate);

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
