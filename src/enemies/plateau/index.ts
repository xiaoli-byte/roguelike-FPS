import type { ScaledEnemyDef } from '../EnemyBase';
import { registerEnemy } from '../Registry';
import type { MonsterKind } from '../../world/plateau/spec';
import { MONSTER_NAMES } from '../../world/plateau/spec';
import { PlateauFoeAdapter } from './PlateauFoeAdapter';
import { LEIZE_DEF, PlateauBossAdapter } from './PlateauBossAdapter';

/**
 * 第四章九种雷魅的名册（M2：照 Unity 冻结的 EnemyRoster，tests/fixtures/gameplay-defs.json；tests/unity-defs-parity.test.mjs 对照）。
 * 行为、模型、命中球仍由 world/plateau/play/foes.ts 的 FOE_SPECS 与各 Foe 类驱动（PlateauFoeAdapter 包一层），
 * 这里的 hp 经 EnemyBase 按难度 / 精英缩放后写回 foe；poise / staggerSeconds / hitch 与 FOE_SPECS 同值（对照测试一并检查）。
 * 尺寸是设计尺寸（放大前），生成时乘 scale；穷奇名册即精英（rank elite：生命按 ×2.6 折算 1100 / 2.6，体型按 ×1.25 折算），EnemyManager 总按精英生成。
 */
export const PLATEAU_ENEMY_DEFS: readonly ScaledEnemyDef[] = [
  {
    id: 'marmot', name: MONSTER_NAMES.marmot, scale: 1.3, hp: 40, speed: 6.5, damage: 6, knockbackResist: 0,
    radius: 0.26, height: 0.75, headY: 0.55, headRadius: 0.16, coins: [1, 2], essence: 1, color: 0xff4fd8,
    weakBone: 'head', role: 'melee', placement: 'assault', groundOnly: true, element: 'shock', poise: 18, staggerSeconds: 0.4, hitch: 0.12,
  },
  {
    id: 'tiangou', name: MONSTER_NAMES.tiangou, scale: 1.1, hp: 80, speed: 9.5, damage: 9, knockbackResist: 0.1,
    radius: 0.35, height: 1.4, headY: 1.15, headRadius: 0.18, coins: [2, 3], essence: 1, color: 0xff4fd8,
    weakBone: 'rune', role: 'melee', placement: 'flank', groundOnly: true, element: 'shock', poise: 30, staggerSeconds: 0.45,
  },
  {
    id: 'aoyin', name: MONSTER_NAMES.aoyin, scale: 1, hp: 900, speed: 3.5, damage: 24, knockbackResist: 1,
    radius: 0.9, height: 3, headY: 2.3, headRadius: 0.45, coins: [10, 14], essence: 3, color: 0xe8dcc8,
    weakBone: 'orb', role: 'heavy', placement: 'assault', groundOnly: true, charger: true, element: 'shock', affixExclusions: ['shielded'],
    poise: 220, staggerSeconds: 0.8,
  },
  {
    // 雷牦：獓狠的小号（同一个模型缩到 0.72），成群跟着獓狠踩踏
    id: 'leiyak', name: MONSTER_NAMES.leiyak, scale: 0.72, hp: 260, speed: 4.5, damage: 16, knockbackResist: 0.8,
    radius: 0.9, height: 3, headY: 2.2, headRadius: 0.32, coins: [4, 6], essence: 2, color: 0x9a8a7a,
    weakBone: 'head', role: 'heavy', placement: 'assault', groundOnly: true, charger: true, element: 'shock', poise: 90,
  },
  {
    id: 'jufu', name: MONSTER_NAMES.jufu, scale: 1, hp: 240, speed: 5, damage: 18, knockbackResist: 0.3,
    radius: 0.45, height: 1.9, headY: 1.25, headRadius: 0.22, coins: [3, 5], essence: 2, color: 0xa08868,
    weakBone: 'palm', role: 'ranged', placement: 'artillery', element: 'shock', poise: 60,
  },
  {
    id: 'manman', name: MONSTER_NAMES.manman, scale: 1.4, hp: 70, speed: 9, damage: 10, knockbackResist: 0.2, flying: true,
    radius: 0.35, height: 0.9, headY: 0.62, headRadius: 0.15, coins: [2, 3], essence: 1, color: 0xe9e4da,
    weakBone: 'eye', role: 'ranged', placement: 'flank', element: 'shock', affixExclusions: ['volatile'], poise: 25, staggerSeconds: 0.5,
  },
  {
    // 连鼓灵没有单一弱点骨骼：核心与六面鼓各自是命中球
    id: 'liangu', name: MONSTER_NAMES.liangu, scale: 1, hp: 220, speed: 4, damage: 10, knockbackResist: 0.6, flying: true,
    radius: 1.2, height: 1, headY: 0.5, headRadius: 0.3, coins: [4, 6], essence: 2, color: 0xc79bff,
    weakBone: null, role: 'ranged', placement: 'support', element: 'shock', affixExclusions: ['shielded'], poise: 80, staggerSeconds: 0.5,
  },
  {
    // 帝江不硬直（韧性 +∞），每挨一枪顿 0.12 秒
    id: 'dijiang', name: MONSTER_NAMES.dijiang, scale: 1.2, hp: 50, speed: 8, damage: 22, knockbackResist: 0,
    radius: 0.45, height: 1, headY: 0.6, headRadius: 0.22, coins: [1, 2], essence: 1, color: 0xc0402a,
    weakBone: 'core', role: 'melee', placement: 'assault', groundOnly: true, element: 'shock', affixExclusions: ['volatile'],
    poise: Infinity, staggerSeconds: 0, hitch: 0.12,
  },
  {
    // 名册即精英：423 × 2.6 ≈ 1100 生命，scale 1 × 精英 1.25 = FOE_SPECS 的 1.25
    id: 'qiongqi', name: MONSTER_NAMES.qiongqi, scale: 1, hp: 423, speed: 5.5, damage: 22, rank: 'elite', knockbackResist: 0.5,
    radius: 0.9, height: 2, headY: 1.5, headRadius: 0.3, coins: [18, 24], essence: 5, color: 0xff4fd8,
    weakBone: 'crown', role: 'heavy', placement: 'flank', groundOnly: true, element: 'shock', poise: 150, staggerSeconds: 0.7,
  },
];

export const PLATEAU_ENEMY_IDS = PLATEAU_ENEMY_DEFS.map(def => def.id as MonsterKind);

let registered = false;
export function registerPlateauEnemies(): void {
  if (registered) return;
  registered = true;
  for (const def of PLATEAU_ENEMY_DEFS) registerEnemy(def, (ctx, opts) => new PlateauFoeAdapter(ctx, def, opts));
  // 4-4 终局首领雷泽雷神（第四章网页原生高原场景，plateau=1）
  registerEnemy(LEIZE_DEF, (ctx, opts) => new PlateauBossAdapter(ctx, LEIZE_DEF, opts));
}
