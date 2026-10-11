/** 第二章 · 昆仑雪墟新阵容：本组敌人的注册（由 registerFrostEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { FOX_WITCH_DEF, FoxIceWall, FoxWitch, ICE_WALL_DEF } from '../types/FoxWitch';
import { LANTERN_JELLY_DEF, LanternJelly } from '../types/LanternJelly';

export function registerFrostSupport(): void {
  // 九尾狐巫（铜镜单独建模，挂在 mirror 挂点上）与她召出的冰壁（不进阵容，只由狐巫生成）
  registerEnemy(FOX_WITCH_DEF, (ctx, opts) => new FoxWitch(ctx, opts));
  registerEnemy(ICE_WALL_DEF, (ctx, opts) => new FoxIceWall(ctx, opts));
  // 冰灯水母（漂浮，光触须给同伴回血）
  registerEnemy(LANTERN_JELLY_DEF, (ctx, opts) => new LanternJelly(ctx, opts));
}
