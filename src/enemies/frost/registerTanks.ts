/** 第二章 · 昆仑雪墟新阵容：坦克组（冰甲旋龟 + 旋壳、玄冰巨蟹）的注册（由 registerFrostEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { XUANGUI_DEF, XuanGui } from '../types/XuanGui';
import { FROST_CRAB_DEF, FrostCrab } from '../types/FrostCrab';

export function registerFrostTanks(): void {
  registerEnemy(XUANGUI_DEF, (ctx, opts) => new XuanGui(ctx, opts));
  registerEnemy(FROST_CRAB_DEF, (ctx, opts) => new FrostCrab(ctx, opts));
}
