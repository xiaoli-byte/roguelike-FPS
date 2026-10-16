/**
 * 第三章 · 祝融火狱：群怪组的注册（由 registerInfernoEnemies 统一调用）。
 * - 炭童 tantong（炉宫）：成群扑抓、抛炭；死后碎成余烬炭堆 tantong_ember，不补刀 4 秒后复燃成 tantong_reborn（半血、不掉落），
 *   同伴会蹲下吹火让炭堆提前复燃。tantong_ember / tantong_reborn 不进阵容，只由炭童生成。
 * - 祸斗 huodou（火坛）：三四只包抄扑咬；吃掉地上的火（炭堆、地火、熔岩边）变大变亮，吃过火才会吐扇形火。
 * 两者共用的「地上的火」登记表见 ./FireFeed（其他敌人留下的地火也可以登记进去给祸斗吃）。
 */
import { registerEnemy } from '../Registry';
import { HUODOU_DEF, Huodou } from '../types/Huodou';
import { TANTONG_DEF, TANTONG_EMBER_DEF, TANTONG_REBORN_DEF, Tantong, TantongEmber, TantongReborn } from '../types/Tantong';

export function registerInfernoPack(): void {
  registerEnemy(TANTONG_DEF, (ctx, opts) => new Tantong(ctx, opts));
  registerEnemy(TANTONG_EMBER_DEF, (ctx, opts) => new TantongEmber(ctx, opts));
  registerEnemy(TANTONG_REBORN_DEF, (ctx, opts) => new TantongReborn(ctx, opts));
  registerEnemy(HUODOU_DEF, (ctx, opts) => new Huodou(ctx, opts));
}
