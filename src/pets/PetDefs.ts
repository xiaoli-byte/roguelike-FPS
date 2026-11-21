/**
 * 灵宠定义（照译 Unity G/Pets/PetDefs.cs：PetRarities、PetDef、PetLibrary）。
 * 八只灵宠的数据由 scripts/web/export-pet-defs.mjs 从 C# 导出到 PetDefsData.ts（不手抄）；这里只加查表、抽取与颜色换算。
 * 具体数值（伤害、范围、间隔）写在各自的行为里（PetBehaviours.ts，常量与 C# 同名，对照测试逐个比）。
 * 本文件不 import 运行时模块（测试按 data: URL 直接加载）。
 */
import type { PetDefView } from '../ui/PetData';
import { PET_DEF_DATA, PET_RARITY_DATA, type PetDefData } from './PetDefsData';

/** 品阶：0 凡灵 / 1 灵兽 / 2 神兽（Unity PetRarity） */
export type PetRarity = 0 | 1 | 2;
export type RGB = readonly [number, number, number];

export const PET_RARITY_NAMES: readonly string[] = PET_RARITY_DATA.names;
export const PET_RARITY_COLORS: readonly RGB[] = PET_RARITY_DATA.colors as unknown as RGB[];
export const PET_RARITY_WEIGHTS: readonly number[] = PET_RARITY_DATA.weights;
/** 神兽的金色（光柱、横幅、金光三连射；Unity PetRarities.Gold） */
export const PET_GOLD: RGB = PET_RARITY_DATA.gold as unknown as RGB;

/** 0–1 分量 → 0xRRGGBB */
export function rgbHex(c: RGB): number {
  const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (b(c[0]) << 16) | (b(c[1]) << 8) | b(c[2]);
}

/** CSS 颜色 #rrggbb */
export function rgbCss(c: RGB): string {
  return '#' + rgbHex(c).toString(16).padStart(6, '0');
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rarityName(r: PetRarity): string {
  return PET_RARITY_NAMES[r] ?? '';
}

export function rarityColor(r: PetRarity): RGB {
  return PET_RARITY_COLORS[r] ?? PET_RARITY_COLORS[0];
}

/** 按权重抽品阶（Unity PetRarities.Roll：72 / 25 / 3） */
export function rollRarity(rand: () => number): PetRarity {
  let total = 0;
  for (const w of PET_RARITY_WEIGHTS) total += w;
  let x = rand() * total;
  for (let i = 0; i < PET_RARITY_WEIGHTS.length; i++) {
    if (x < PET_RARITY_WEIGHTS[i]) return i as PetRarity;
    x -= PET_RARITY_WEIGHTS[i];
  }
  return 0;
}

/** 一只灵宠的静态数据（Unity PetDef） */
export interface PetDef extends PetDefData {
  rarity: PetRarity;
  /** 「神兽 · 白泽」 */
  readonly label: string;
  /** 品阶色 */
  readonly rarityColor: RGB;
}

/** 八只灵宠（docs/pet-system.md 第 4 节；PetLibrary.All 的顺序） */
export const PET_LIBRARY: readonly PetDef[] = PET_DEF_DATA.map((d) => ({
  ...d,
  label: `${rarityName(d.rarity)} · ${d.name}`,
  rarityColor: rarityColor(d.rarity),
}));

const byId = new Map<string, PetDef>();
for (const d of PET_LIBRARY) {
  byId.set(d.id, d);
  byId.set(d.assetId, d);
}

/** 按 id 或资产 id 找（Unity PetLibrary.Get）；没有为 null */
export function getPetDef(id: string | null | undefined): PetDef | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}

/** 抽一只：先按权重抽品阶（forced 时固定品阶），再在该品阶里平均抽（Unity PetLibrary.Roll） */
export function rollPet(rand: () => number, forced?: PetRarity | null): PetDef {
  const rarity = forced ?? rollRarity(rand);
  const pool = PET_LIBRARY.filter((d) => d.rarity === rarity);
  return pool.length > 0 ? pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] : PET_LIBRARY[0];
}

/** 奖励串（Unity PetReward）："pet"（按权重抽）/ "pet:<id>" / "pet:rarity=<0–2>" → 抽到的定义 */
export function petForReward(reward: string, rand: () => number): PetDef {
  const args = reward.split(':');
  const arg = args.length > 1 ? args[1] : '';
  // C# int.TryParse：整串是整数（前后空白、正负号）才算
  if (arg.startsWith('rarity=') && /^\s*[+-]?\d+\s*$/.test(arg.slice(7))) {
    return rollPet(rand, Math.max(0, Math.min(2, Number(arg.slice(7)))) as PetRarity);
  }
  return getPetDef(arg) ?? rollPet(rand);
}

/** 定义 → 界面视图（HUD 灵宠面板、行囊灵宠页、图鉴灵宠页签读的那些；图鉴副标题「品阶 · 称号」同 Unity CodexCatalog） */
export function defView(d: PetDef): PetDefView {
  return {
    id: d.id, name: d.name, title: d.title, rarityName: rarityName(d.rarity), rarityColor: rgbHex(d.rarityColor), role: d.role,
    element: d.element, lore: d.lore, attackDesc: d.attackDesc, passiveName: d.passiveName || undefined, passiveDesc: d.passiveDesc || undefined,
    skillName: d.skillName, skillDesc: d.skillDesc, skillCooldown: d.skillCooldown, awakenDesc: d.awakenDesc,
  };
}
