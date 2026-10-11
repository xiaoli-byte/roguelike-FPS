/** 第二章 · 昆仑雪墟新阵容：远程组（夫诸、冰鲸）的注册（由 registerFrostEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { FUZHU_DEF, Fuzhu } from '../types/Fuzhu';
import { ICE_WHALE_DEF, IceWhale } from '../types/IceWhale';

export function registerFrostRanged(): void {
  registerEnemy(FUZHU_DEF, (ctx, opts) => new Fuzhu(ctx, opts));
  registerEnemy(ICE_WHALE_DEF, (ctx, opts) => new IceWhale(ctx, opts));
}
