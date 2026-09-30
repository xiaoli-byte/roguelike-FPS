/**
 * Boss 注册：三章 Boss（boss_colossus / boss_matriarch / boss_warlord）
 * 以及妖后召唤的寒霜冰晶（boss_ice_crystal，非 Boss，仅由妖后召唤）。
 */
import { registerEnemy } from '../Registry';
import { Colossus, COLOSSUS_DEF } from './Colossus';
import { CRYSTAL_DEF, IceCrystal } from './IceCrystal';
import { Matriarch, MATRIARCH_DEF } from './Matriarch';
import { Warlord, WARLORD_DEF } from './Warlord';

export function registerBosses(): void {
  registerEnemy(COLOSSUS_DEF, (ctx, opts) => new Colossus(ctx, opts));
  registerEnemy(MATRIARCH_DEF, (ctx, opts) => new Matriarch(ctx, opts));
  registerEnemy(WARLORD_DEF, (ctx, opts) => new Warlord(ctx, opts));
  registerEnemy(CRYSTAL_DEF, (ctx, opts) => new IceCrystal(ctx, opts));
}

/** 第 chapter 章（0-based）的 Boss 敌人 id */
export function bossIdForChapter(chapter: number): string {
  return ['boss_colossus', 'boss_matriarch', 'boss_warlord'][Math.min(2, Math.max(0, chapter))];
}
