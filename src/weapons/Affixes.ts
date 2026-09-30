/**
 * 武器词条与传说特性：定义、随机抽取、描述文本。
 *
 * 词条存放在 WeaponInstance.affixes（{ id, value }）；传说特性也作为一条词条存放，id 以 `lg_` 开头。
 * 数值的实际生效见 WeaponStats.ts（数值类）、AffixEffects.ts（触发类）与 WeaponSystem.ts（开火类）。
 */
import type { Element, Rarity, WeaponAffix } from '../core/types';
import type { Rng } from '../core/Rng';
import { isExplosive, isHitscan, shotsPerSecond, hitsPerShot, type WeaponDef } from './WeaponDefs';

export type AffixId =
  | 'dmg' | 'rate' | 'mag' | 'reload' | 'critDmg' | 'critChance' | 'elemChance' | 'spread' | 'recoil'
  | 'headBlast' | 'killRefill' | 'hitShield' | 'ricochet' | 'pierce' | 'blast' | 'projSpeed' | 'reserve'
  | 'hunter' | 'swift';

export type LegendaryId = 'lg_nth' | 'lg_nova' | 'lg_last' | 'lg_prism' | 'lg_frenzy' | 'lg_endless';

interface AffixDef {
  id: AffixId;
  /** 普通数值区间（精良基准），更高稀有度会放大 */
  min: number;
  max: number;
  /** 固定数值（如穿透 +1），不随稀有度放大 */
  fixed?: boolean;
  weight: number;
  text(v: number): string;
  allow(def: WeaponDef, element: Element): boolean;
}

interface LegendaryDef {
  id: LegendaryId;
  name: string;
  allow(def: WeaponDef): boolean;
  /** 特性数值（例如第 N 发、概率） */
  value(def: WeaponDef): number;
  text(def: WeaponDef, v: number): string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const any = (): boolean => true;
/** 命中扫描（不含光束）或弩：可以穿透 / 弹射 / 爆头 */
const directHit = (d: WeaponDef): boolean => isHitscan(d) || d.kind === 'crossbow';

export const AFFIXES: readonly AffixDef[] = [
  { id: 'dmg', min: 0.08, max: 0.15, weight: 12, text: (v) => `伤害 +${pct(v)}`, allow: any },
  { id: 'rate', min: 0.08, max: 0.15, weight: 10, text: (v) => `射速 +${pct(v)}`, allow: any },
  { id: 'mag', min: 0.2, max: 0.4, weight: 9, text: (v) => `弹匣容量 +${pct(v)}`, allow: any },
  { id: 'reload', min: 0.15, max: 0.3, weight: 9, text: (v) => `换弹速度 +${pct(v)}`, allow: any },
  { id: 'critDmg', min: 0.15, max: 0.35, weight: 8, text: (v) => `暴击伤害 +${pct(v)}`, allow: any },
  { id: 'critChance', min: 0.04, max: 0.08, weight: 7, text: (v) => `暴击率 +${pct(v)}`, allow: any },
  { id: 'elemChance', min: 0.06, max: 0.14, weight: 8, text: (v) => `元素触发率 +${pct(v)}`, allow: (_d, e) => e !== 'none' },
  { id: 'spread', min: 0.2, max: 0.35, weight: 6, text: (v) => `散布 −${pct(v)}`, allow: (d) => isHitscan(d) },
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
  { id: 'reserve', min: 0.25, max: 0.5, weight: 6, text: (v) => `备弹上限 +${pct(v)}`, allow: any },
  { id: 'hunter', min: 0.12, max: 0.25, weight: 6, text: (v) => `对首领与精英伤害 +${pct(v)}`, allow: any },
  { id: 'swift', min: 0.4, max: 0.8, weight: 4, text: (v) => `持握时移动速度 +${v.toFixed(1)}`, allow: any },
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
    text: (d, v) => `每第 ${Math.round(v)} ${shotUnit(d)}必定暴击`,
  },
  {
    id: 'lg_nova', name: '连环爆',
    allow: any,
    value: () => 4,
    text: (_d, v) => `击杀敌人时引发同元素爆炸（${v} 米），可连锁`,
  },
  {
    id: 'lg_last', name: '终焉',
    allow: (d) => d.mode !== 'beam',
    value: () => 3,
    text: (d, v) => `弹匣最后一${shotUnit(d)}伤害 ×${v}`,
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
    text: (_d, v) => `开火时 ${pct(v)} 几率不消耗弹药`,
  },
];

/** 各稀有度的词条数量：普通 0 / 精良 1 / 稀有 1 / 史诗 2 / 传说 3（+1 传说特性） */
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
  return Math.round(v * 100) / 100;
}

/** 为一把武器随机抽取词条（含传说特性）。结果按抽取顺序排列，传说特性在最后。 */
export function rollAffixes(def: WeaponDef, rarity: Rarity, element: Element, rng: Rng): WeaponAffix[] {
  const out: WeaponAffix[] = [];
  const count = AFFIX_COUNT[rarity] ?? 0;
  const pool = AFFIXES.filter((a) => a.allow(def, element));
  for (let i = 0; i < count && pool.length > 0; i++) {
    const a = rng.weighted(pool, (x) => x.weight);
    pool.splice(pool.indexOf(a), 1);
    const raw = rng.range(a.min, a.max) * (a.fixed ? 1 : rarityScale(rarity));
    out.push({ id: a.id, value: roundValue(a, raw) });
  }
  if (rarity >= 4) {
    const lg = LEGENDARIES.filter((l) => l.allow(def));
    if (lg.length > 0) {
      const l = rng.pick(lg);
      out.push({ id: l.id, value: l.value(def) });
    }
  }
  return out;
}

/** 词条 / 特性的中文描述；未知词条返回 null */
export function describeAffix(def: WeaponDef, a: WeaponAffix): string | null {
  const ad = AFFIX_BY_ID.get(a.id);
  if (ad) return ad.text(a.value);
  const l = LEGENDARY_BY_ID.get(a.id);
  if (l) return `【传说·${l.name}】${l.text(def, a.value)}`;
  return null;
}

/** 传说特性名（用作武器名前缀） */
export function legendaryName(id: string): string | null {
  return LEGENDARY_BY_ID.get(id)?.name ?? null;
}
