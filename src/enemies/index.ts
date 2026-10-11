/**
 * 注册全部 8 种普通敌人（grunt / archer / brute / bomber / wisp / shaman / mortar / marksman）。
 * Game 在构造时调用一次；Boss 由 bosses/index.ts 另行注册。
 */
import { registerEnemy } from './Registry';
import { APSARA_DEF, Apsara } from './types/Apsara';
import { ARCHER_DEF, Archer } from './types/Archer';
import { BOMBER_DEF, Bomber } from './types/Bomber';
import { BRUTE_DEF, Brute } from './types/Brute';
import { FIRE_RAT_DEF, FireRat } from './types/FireRat';
import { GRUNT_DEF, Grunt } from './types/Grunt';
import { JERBOA_BLADE_DEF, JerboaBlade } from './types/JerboaBlade';
import { SCORPION_ARCHER_DEF, ScorpionArcher } from './types/ScorpionArcher';
import { TOMB_BEAST_DEF, TombBeast } from './types/TombBeast';
import { MARKSMAN_DEF, Marksman } from './types/Marksman';
import { MIRAGE_TOAD_DECOY_DEF, MIRAGE_TOAD_DEF, MirageToad, MirageToadDecoy } from './types/MirageToad';
import { MORTAR_DEF, Mortar } from './types/Mortar';
import { SHAMAN_DEF, Shaman } from './types/Shaman';
import { WISP_DEF, Wisp } from './types/Wisp';
import { registerFrostEnemies } from './frost';

/** 普通敌人 id（与 DESIGN.md 第 8 节一致） */
export const STANDARD_ENEMY_IDS = ['grunt', 'archer', 'brute', 'bomber', 'wisp', 'shaman', 'mortar', 'marksman'] as const;
export type StandardEnemyId = (typeof STANDARD_ENEMY_IDS)[number];

let registered = false;

export function registerStandardEnemies(): void {
  if (registered) return;
  registered = true;
  registerEnemy(GRUNT_DEF, (ctx, opts) => new Grunt(ctx, opts));
  registerEnemy(ARCHER_DEF, (ctx, opts) => new Archer(ctx, opts));
  registerEnemy(BRUTE_DEF, (ctx, opts) => new Brute(ctx, opts));
  registerEnemy(BOMBER_DEF, (ctx, opts) => new Bomber(ctx, opts));
  registerEnemy(WISP_DEF, (ctx, opts) => new Wisp(ctx, opts));
  registerEnemy(SHAMAN_DEF, (ctx, opts) => new Shaman(ctx, opts));
  registerEnemy(MORTAR_DEF, (ctx, opts) => new Mortar(ctx, opts));
  registerEnemy(MARKSMAN_DEF, (ctx, opts) => new Marksman(ctx, opts));
  // 第一章新阵容（docs/art/enemy-roster-v2.md）：跳鼠刀兵已进第一章波次（Waves.ts / WhiteboxEncounters.ts），其余逐个实装中
  registerEnemy(MIRAGE_TOAD_DEF, (ctx, opts) => new MirageToad(ctx, opts));
  registerEnemy(MIRAGE_TOAD_DECOY_DEF, (ctx, opts) => new MirageToadDecoy(ctx, opts));
  registerEnemy(JERBOA_BLADE_DEF, (ctx, opts) => new JerboaBlade(ctx, opts));
  registerEnemy(SCORPION_ARCHER_DEF, (ctx, opts) => new ScorpionArcher(ctx, opts));
  registerEnemy(FIRE_RAT_DEF, (ctx, opts) => new FireRat(ctx, opts));
  // 坦克位：三彩镇墓兽（2026-10-07 替换驼碑力士）
  registerEnemy(TOMB_BEAST_DEF, (ctx, opts) => new TombBeast(ctx, opts));
  // 辅助位：邪飞天（悬浮琵琶单独建模）
  registerEnemy(APSARA_DEF, (ctx, opts) => new Apsara(ctx, opts));
  // 第二章新阵容：分组注册（src/enemies/frost/）
  registerFrostEnemies();
}
