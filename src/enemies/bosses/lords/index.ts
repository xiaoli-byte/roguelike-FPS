/**
 * 第四章 4-1 三领主（夔 boss_kui、飞廉 boss_feilian、化蛇 boss_huashe）与飞廉的龙卷风柱（boss_feilian_tornado，非首领）的注册。
 * 首领框架版本（docs/threejs-migration.md M6）；旧的独立实现 src/world/plateau/play/bosses.ts 只留给 plateau 试玩页。
 */
import { registerEnemy } from '../../Registry';
import { Feilian, FEILIAN_DEF } from './Feilian';
import { FEILIAN_TORNADO_DEF, FeilianTornado } from './FeilianTornado';
import { Huashe, HUASHE_DEF } from './Huashe';
import { Kui, KUI_DEF } from './Kui';

export function registerLords(): void {
  registerEnemy(KUI_DEF, (ctx, opts) => new Kui(ctx, opts));
  registerEnemy(FEILIAN_DEF, (ctx, opts) => new Feilian(ctx, opts));
  registerEnemy(HUASHE_DEF, (ctx, opts) => new Huashe(ctx, opts));
  registerEnemy(FEILIAN_TORNADO_DEF, (ctx, opts) => new FeilianTornado(ctx, opts));
}

export { bindKuiStorm, kuiStorm, type KuiStormHooks } from './KuiStorm';
