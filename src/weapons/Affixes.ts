/**
 * 武器词条与传说特性：定义、随机抽取、描述文本。
 *
 * 词条存放在 WeaponInstance.affixes（{ id, value }）；传说特性也作为一条词条存放，id 以 `lg_` 开头。
 * 武器定义的固有词条（def.innate）在生成实例时原样放在 affixes 最前面。
 * 数值的实际生效见 WeaponStats.ts（数值类）、AffixEffects.ts（触发类）与 WeaponSystem.ts（开火类）。
 */
import type { Element, Rarity, WeaponAffix } from '../core/types';
import type { Rng } from '../core/Rng';
import { clamp } from '../core/math';
import { isDualForm, isExplosive, isHitscan, shotsPerSecond, hitsPerShot, type WeaponDef } from './WeaponDefs';

export type AffixId =
  | 'dmg' | 'rate' | 'mag' | 'reload' | 'critDmg' | 'critChance' | 'elemChance' | 'spread' | 'recoil'
  | 'headBlast' | 'killRefill' | 'hitShield' | 'ricochet' | 'pierce' | 'blast' | 'projSpeed' | 'reserve'
  | 'hunter' | 'swift'
  // 元素反应类（docs/arsenal-expansion.md 第 4 节）
  | 'subFire' | 'subShock' | 'subCorrode' | 'rxnDmg' | 'rxnRefill' | 'rxnHaste' | 'statusHunter'
  | 'rxnShield' | 'detonate' | 'seed';

export type LegendaryId =
  | 'lg_nth' | 'lg_nova' | 'lg_last' | 'lg_prism' | 'lg_frenzy' | 'lg_endless'
  | 'lg_bond' | 'lg_lunhui' | 'lg_nirvana' | 'lg_boil';

interface AffixDef {
  id: AffixId;
  /** 普通数值区间（精良基准），更高稀有度会放大 */
  min: number;
  max: number;
  /** 固定数值（如穿透 +1），不随稀有度放大 */
  fixed?: boolean;
  /**
   * 「命中时几率附加」类：区间是原始值 raw（约等于每秒附着 raw × 3.5 次），
   * 抽取时乘稀有度后再按武器每秒命中数归一化为每次命中几率（与射速无关），见 perHitChance
   */
  perHit?: boolean;
  weight: number;
  text(v: number): string;
  /** picked = 本次已抽到的词条 id（含固有词条）；每抽一个词条都会用最新的 picked 重新过滤一次 */
  allow(def: WeaponDef, element: Element, picked: readonly string[]): boolean;
}

interface LegendaryDef {
  id: LegendaryId;
  name: string;
  allow(def: WeaponDef, element: Element, picked: readonly string[]): boolean;
  /** 特性数值（例如第 N 发、概率） */
  value(def: WeaponDef): number;
  text(def: WeaponDef, v: number): string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const any = (): boolean => true;
/**
 * 命中扫描（不含光束）、弩或双形态武器（魔刀千刃）：可以穿透 / 弹射 / 爆头。
 * 魔刀：爆头爆炸只在飞刃爆头时触发（斩击没有 headshot），穿透只作用于飞刃，弹射 / 破势两形态都生效
 */
const directHit = (d: WeaponDef): boolean => isHitscan(d) || d.kind === 'crossbow' || isDualForm(d);
/** 这把武器自己能否引发元素反应：带元素 / 元素轮转 / 满蓄引爆 / 已抽到副元素词条 */
const canReact = (d: WeaponDef, e: Element, picked: readonly string[]): boolean =>
  e !== 'none' || !!d.cycle || d.chargeDetonate || picked.some((id) => id.startsWith('sub'));

/** 副元素归一化基数：每秒附着约 raw × 3.5 次 */
const PER_HIT_BASE = 3.5;

/** 每秒命中数（蓄力武器按「射击冷却 + 满蓄时间」算一发） */
function hps(d: WeaponDef): number {
  const sps = d.mode === 'charge' ? 1 / (1 / d.fireRate + d.chargeTime) : shotsPerSecond(d);
  return sps * hitsPerShot(d);
}

/** 原始值 → 每次命中几率，钳制在 [2%, 75%] */
function perHitChance(d: WeaponDef, raw: number): number {
  return clamp((raw * PER_HIT_BASE) / hps(d), 0.02, 0.75);
}

export const AFFIXES: readonly AffixDef[] = [
  { id: 'dmg', min: 0.08, max: 0.15, weight: 12, text: (v) => `伤害 +${pct(v)}`, allow: any },
  { id: 'rate', min: 0.08, max: 0.15, weight: 10, text: (v) => `射速 +${pct(v)}`, allow: any },
  { id: 'mag', min: 0.2, max: 0.4, weight: 9, text: (v) => `弹匣容量 +${pct(v)}`, allow: any },
  { id: 'reload', min: 0.15, max: 0.3, weight: 9, text: (v) => `换弹速度 +${pct(v)}`, allow: any },
  { id: 'critDmg', min: 0.15, max: 0.35, weight: 8, text: (v) => `暴击伤害 +${pct(v)}`, allow: any },
  { id: 'critChance', min: 0.04, max: 0.08, weight: 7, text: (v) => `暴击率 +${pct(v)}`, allow: any },
  { id: 'elemChance', min: 0.06, max: 0.14, weight: 8, text: (v) => `元素触发率 +${pct(v)}`, allow: (_d, e) => e !== 'none' },
  { id: 'spread', min: 0.2, max: 0.35, weight: 6, text: (v) => `散布 −${pct(v)}`, allow: (d) => isHitscan(d) || isDualForm(d) },
  { id: 'recoil', min: 0.25, max: 0.4, weight: 5, text: (v) => `后坐力 −${pct(v)}`, allow: (d) => d.mode !== 'beam' },
  {
    id: 'headBlast', min: 0.5, max: 0.8, weight: 5,
    text: (v) => `爆头时引发小范围爆炸（${pct(v)} 单发伤害）`,
    allow: directHit,
  },
  { id: 'killRefill', min: 0.12, max: 0.25, weight: 6, text: (v) => `击杀时回填 ${pct(v)} 弹匣`, allow: any },
  { id: 'hitShield', min: 0.03, max: 0.06, weight: 6, text: (v) => `命中时将 ${pct(v)} 伤害转化为护盾`, allow: any },
  {
    id: 'ricochet', min: 0.25, max: 0.45, weight: 5,
    text: (v) => `命中时 ${pct(v)} 几率弹射至附近敌人（50% 伤害）`,
    allow: directHit,
  },
  { id: 'pierce', min: 1, max: 1, fixed: true, weight: 4, text: (v) => `穿透 +${Math.round(v)}`, allow: directHit },
  { id: 'blast', min: 0.15, max: 0.3, weight: 7, text: (v) => `爆炸范围 +${pct(v)}`, allow: (d) => isExplosive(d) },
  { id: 'projSpeed', min: 0.2, max: 0.4, weight: 5, text: (v) => `弹速 +${pct(v)}`, allow: (d) => !!d.projectile },
  // 召回式换弹（魔刀千刃）没有备弹
  { id: 'reserve', min: 0.25, max: 0.5, weight: 6, text: (v) => `备弹上限 +${pct(v)}`, allow: (d) => !d.recall },
  { id: 'hunter', min: 0.12, max: 0.25, weight: 6, text: (v) => `对首领与精英伤害 +${pct(v)}`, allow: any },
  { id: 'swift', min: 0.4, max: 0.8, weight: 4, text: (v) => `持握时移动速度 +${v.toFixed(1)}`, allow: any },

  // ───── 元素反应类（生效见 AffixEffects） ─────
  {
    id: 'subFire', min: 0.1, max: 0.18, perHit: true, weight: 4,
    text: (v) => `命中时 ${pct(v)} 几率附加灼烧`,
    allow: (d, e) => e !== 'fire' && !d.cycle,
  },
  {
    id: 'subShock', min: 0.1, max: 0.18, perHit: true, weight: 4,
    text: (v) => `命中时 ${pct(v)} 几率附加雷殛`,
    allow: (d, e) => e !== 'shock' && !d.cycle,
  },
  {
    id: 'subCorrode', min: 0.1, max: 0.18, perHit: true, weight: 4,
    text: (v) => `命中时 ${pct(v)} 几率附加蚀化`,
    allow: (d, e) => e !== 'corrode' && !d.cycle,
  },
  { id: 'rxnDmg', min: 0.18, max: 0.35, weight: 6, text: (v) => `本武器引发的元素反应伤害 +${pct(v)}`, allow: canReact },
  { id: 'rxnRefill', min: 0.08, max: 0.15, weight: 4, text: (v) => `本武器引发元素反应时回填 ${pct(v)} 弹匣`, allow: canReact },
  { id: 'rxnHaste', min: 0.12, max: 0.22, weight: 4, text: (v) => `本武器引发元素反应后 3 秒内射速 +${pct(v)}`, allow: canReact },
  { id: 'statusHunter', min: 0.05, max: 0.09, weight: 5, text: (v) => `目标每带有一种元素状态，伤害 +${pct(v)}`, allow: any },
  { id: 'rxnShield', min: 4, max: 8, weight: 4, text: (v) => `本武器引发元素反应时获得 ${Math.round(v)} 点护盾`, allow: canReact },
  {
    id: 'detonate', min: 0.6, max: 0.9, weight: 4,
    text: (v) => `暴击或爆头时引爆目标的元素状态（强度 ${pct(v)}，每 1.5 秒一次）`,
    allow: (d) => directHit(d) && d.mode !== 'charge',
  },
  {
    id: 'seed', min: 0.3, max: 0.45, weight: 2,
    text: (v) => `命中种下蛊种：其发生元素反应时，以 ${pct(v)} 威力传染给附近 1 名敌人`,
    allow: (d) => !!d.projectile && !isExplosive(d),
  },
];

/** 「万象」每次命中的附着概率：约每秒 1.6 次（对每种元素），钳制在 [5%, 75%] */
function prismChance(d: WeaponDef): number {
  const hitsPerSec = shotsPerSecond(d) * hitsPerShot(d);
  return Math.min(0.75, Math.max(0.05, 1.6 / Math.max(0.1, hitsPerSec)));
}

function shotUnit(d: WeaponDef): string {
  if (d.mode === 'beam') return '跳';
  if (d.projectile && d.projectile.count > 1) return '轮';
  return '发';
}

export const LEGENDARIES: readonly LegendaryDef[] = [
  {
    id: 'lg_nth', name: '天命',
    allow: any,
    value: (d) => {
      const sps = shotsPerSecond(d);
      return sps >= 8 ? 6 : sps >= 2.5 ? 5 : 4;
    },
    // 双形态：斩击按段（判定帧，命中与否都算）、飞刃按轮，共用计数
    text: (d, v) => (isDualForm(d) ? `每第 ${Math.round(v)} 次攻击必定暴击（斩击按段、飞刃按轮计）` : `每第 ${Math.round(v)} ${shotUnit(d)}必定暴击`),
  },
  {
    id: 'lg_nova', name: '殉爆',
    allow: any,
    value: () => 4,
    text: (_d, v) => `击杀敌人时引发同元素爆炸（${v} 米），可连锁`,
  },
  {
    id: 'lg_last', name: '终焉',
    allow: (d) => d.mode !== 'beam',
    value: () => 3,
    // 双形态：只作用于飞刃（斩击不耗弹），按「本轮打空弹匣」判定
    text: (d, v) => (isDualForm(d) ? `最后一轮飞刃伤害 ×${v}` : `弹匣最后一${shotUnit(d)}伤害 ×${v}`),
  },
  {
    id: 'lg_prism', name: '万象',
    allow: any,
    value: prismChance,
    text: (_d, v) => `命中时各有 ${pct(v)} 几率附加灼烧、雷殛、蚀化`,
  },
  {
    id: 'lg_frenzy', name: '狂热',
    allow: any,
    value: () => 0.04,
    text: (_d, v) => `命中叠加 ${pct(v)} 射速（最多 10 层），2 秒未命中清空`,
  },
  {
    id: 'lg_endless', name: '无尽',
    allow: any,
    value: () => 0.3,
    // 双形态：只作用于飞刃（斩击本来不耗弹），免耗时整轮不扣
    text: (d, v) => (isDualForm(d) ? `飞刃齐射时 ${pct(v)} 几率不消耗飞刃` : `开火时 ${pct(v)} 几率不消耗弹药`),
  },

  // ───── 元素反应类（docs/arsenal-expansion.md 第 5 节；数值不随稀有度放大） ─────
  {
    // 附加的是「本发实际元素」：物理弹（即使有副元素词条 / 满蓄引爆）没有可附加的元素，
    // 因此只允许带元素或元素轮转的武器（比 canReact 更窄，避免出现完全无效的传说）
    id: 'lg_bond', name: '合璧',
    allow: (d, e) => e !== 'none' || !!d.cycle,
    value: () => 1,
    text: () => '命中带有其他元素状态的敌人时，必定附加本武器的元素',
  },
  {
    id: 'lg_lunhui', name: '轮回',
    allow: (d) => !d.cycle,
    value: () => 0.6,
    text: (_d, v) => `命中时依次附加灼烧、雷殛、蚀化（每 ${v} 秒一次）；本武器引发的「归墟」伤害 +50%`,
  },
  {
    id: 'lg_nirvana', name: '涅槃',
    allow: any,
    value: () => 0.25,
    text: (_d, v) => `击杀身负两种以上元素状态的敌人时，于其尸身引发对应反应（威力为其最大生命的 ${pct(v)}）`,
  },
  {
    id: 'lg_boil', name: '鼎沸',
    allow: any,
    value: () => 0.06,
    text: (_d, v) => `本武器每引发一次元素反应，武器与反应伤害 +${pct(v)}（最多 8 层，4 秒未触发则清空）`,
  },
];

/** 各稀有度的词条数量：普通 0 / 精良 1 / 稀有 1 / 史诗 2 / 传说 3（+1 传说特性）；固有词条另计 */
export const AFFIX_COUNT: readonly number[] = [0, 1, 1, 2, 3];

const AFFIX_BY_ID = new Map<string, AffixDef>(AFFIXES.map((a) => [a.id, a]));
const LEGENDARY_BY_ID = new Map<string, LegendaryDef>(LEGENDARIES.map((l) => [l.id, l]));

export function isLegendaryId(id: string): id is LegendaryId {
  return LEGENDARY_BY_ID.has(id);
}

/** 按稀有度放大词条数值：精良 ×1，稀有 ×1.15，史诗 ×1.3，传说 ×1.45 */
function rarityScale(rarity: Rarity): number {
  return 1 + 0.15 * Math.max(0, rarity - 1);
}

function roundValue(a: AffixDef, v: number): number {
  if (a.fixed) return a.min;
  if (a.id === 'swift') return Math.round(v * 10) / 10;
  if (a.id === 'rxnShield') return Math.round(v);
  if (a.perHit) return Math.max(0.02, Math.round(v * 100) / 100);
  return Math.round(v * 100) / 100;
}

/**
 * 为一把武器随机抽取词条（含传说特性）。
 * 结果顺序：固有词条（def.innate 原样拷贝：不占名额、不随稀有度放大、同 id 不会再被抽到）→ 按抽取顺序的词条 → 传说特性。
 */
export function rollAffixes(def: WeaponDef, rarity: Rarity, element: Element, rng: Rng): WeaponAffix[] {
  const out: WeaponAffix[] = [];
  const picked: string[] = [];
  for (const a of def.innate) {
    out.push({ id: a.id, value: a.value });
    picked.push(a.id);
  }
  const count = AFFIX_COUNT[rarity] ?? 0;
  const scale = rarityScale(rarity);
  for (let i = 0; i < count; i++) {
    // 每抽一个词条都按当前 picked 重新过滤（抽到副元素词条后会解锁「化合」等反应类词条）
    const pool = AFFIXES.filter((x) => !picked.includes(x.id) && x.allow(def, element, picked));
    if (pool.length === 0) break;
    const a = rng.weighted(pool, (x) => x.weight);
    picked.push(a.id);
    let v = rng.range(a.min, a.max) * (a.fixed ? 1 : scale);
    if (a.perHit) v = perHitChance(def, v);
    out.push({ id: a.id, value: roundValue(a, v) });
  }
  if (rarity >= 4) {
    const lg = LEGENDARIES.filter((l) => l.allow(def, element, picked));
    if (lg.length > 0) {
      const l = rng.pick(lg);
      out.push({ id: l.id, value: l.value(def) });
    }
  }
  return out;
}

/** 双形态武器上只作用于远程形态「千刃」的词条（描述末尾加「（千刃）」） */
const RANGED_ONLY: ReadonlySet<string> = new Set<AffixId>(['mag', 'reload', 'spread', 'recoil', 'projSpeed', 'pierce', 'headBlast']);

/** 词条 / 特性的中文描述；未知词条返回 null */
export function describeAffix(def: WeaponDef, a: WeaponAffix): string | null {
  const ad = AFFIX_BY_ID.get(a.id);
  if (ad) {
    const t = ad.text(a.value);
    if (def.melee && RANGED_ONLY.has(a.id)) return `${t}（${def.melee.formNames[1]}）`;
    return t;
  }
  const l = LEGENDARY_BY_ID.get(a.id);
  if (l) return `【传说·${l.name}】${l.text(def, a.value)}`;
  return null;
}

/** 传说特性名（用作武器名前缀） */
export function legendaryName(id: string): string | null {
  return LEGENDARY_BY_ID.get(id)?.name ?? null;
}
