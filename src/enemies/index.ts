/**
 * 注册全部 8 种普通敌人（grunt / archer / brute / bomber / wisp / shaman / mortar / marksman）。
 * Game 在构造时调用一次；Boss 由 bosses/index.ts 另行注册。
 */
import { registerEnemy } from './Registry';
import { ARCHER_DEF, Archer } from './types/Archer';
import { BOMBER_DEF, Bomber } from './types/Bomber';
import { BRUTE_DEF, Brute } from './types/Brute';
import { GRUNT_DEF, Grunt } from './types/Grunt';
import { MARKSMAN_DEF, Marksman } from './types/Marksman';
import { MORTAR_DEF, Mortar } from './types/Mortar';
import { SHAMAN_DEF, Shaman } from './types/Shaman';
import { WISP_DEF, Wisp } from './types/Wisp';

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
}
