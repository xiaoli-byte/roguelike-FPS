/** 第三章 · 祝融火狱：坦克组（熔炉铁牛、火鼍）的注册（由 registerInfernoEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { IRON_OX_DEF, IronOx } from '../types/IronOx';
import { TUO_DEF, Tuo } from '../types/Tuo';

export function registerInfernoTanks(): void {
  registerEnemy(IRON_OX_DEF, (ctx, opts) => new IronOx(ctx, opts));
  registerEnemy(TUO_DEF, (ctx, opts) => new Tuo(ctx, opts));
}
