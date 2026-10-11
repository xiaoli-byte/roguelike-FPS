/**
 * 第二章 · 昆仑雪墟新阵容：游击组的注册（由 registerFrostEnemies 统一调用）。
 * - 三青鸟 qingniao：远程（飞行），盘旋扇射冰羽、掉血后俯冲换位、定时落到柱顶歇脚。
 * - 冰河豚 ice_puffer：自爆（飞行），飘近俯冲、鼓气炸开、留下减速冻雾。
 * - 冰棘豪彘 haozhi：自爆（地面），刨地冲锋、急停竖刺、炸出一圈水平冰刺。
 */
import { registerEnemy } from '../Registry';
import { HAOZHI_DEF, Haozhi } from '../types/Haozhi';
import { ICE_PUFFER_DEF, IcePuffer } from '../types/IcePuffer';
import { QINGNIAO_DEF, Qingniao } from '../types/Qingniao';

export function registerFrostSkirmishers(): void {
  registerEnemy(QINGNIAO_DEF, (ctx, opts) => new Qingniao(ctx, opts));
  registerEnemy(ICE_PUFFER_DEF, (ctx, opts) => new IcePuffer(ctx, opts));
  registerEnemy(HAOZHI_DEF, (ctx, opts) => new Haozhi(ctx, opts));
}
