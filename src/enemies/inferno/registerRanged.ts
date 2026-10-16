/** 第三章 · 祝融火狱：远程组（毕方、马面狱卒）的注册（由 registerInfernoEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { BIFANG_DEF, Bifang } from '../types/Bifang';
import { MAMIAN_DEF, Mamian } from '../types/Mamian';

export function registerInfernoRanged(): void {
  registerEnemy(BIFANG_DEF, (ctx, opts) => new Bifang(ctx, opts));
  registerEnemy(MAMIAN_DEF, (ctx, opts) => new Mamian(ctx, opts));
}
