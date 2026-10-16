/**
 * 第三章 · 祝融火狱：炮击 / 自爆组的注册（由 registerInfernoEnemies 统一调用）。
 * - 炮仗傀儡 firecracker：炮击，扎马弹盖、引信烧到箱底后「一窝蜂」齐射 8 支火箭；近身撒地老鼠；打中燃烧的引信哑炸；死时连环爆。
 * - 神火飞鸦 fire_crow：自爆（飞行），成群盘旋、轮流尖啸点火，沿地面朱红线直线俯冲撞地爆；空中打爆会连环炸到同伴。
 * 两者共用 inferno/ExplosiveChain.ts 的爆炸连锁、fx/InfernoBlastFx.ts 的火药特效。
 */
import { registerEnemy } from '../Registry';
import { FIRECRACKER_DEF, Firecracker } from '../types/Firecracker';
import { FIRE_CROW_DEF, FireCrow } from '../types/FireCrow';

export function registerInfernoBlasters(): void {
  registerEnemy(FIRECRACKER_DEF, (ctx, opts) => new Firecracker(ctx, opts));
  registerEnemy(FIRE_CROW_DEF, (ctx, opts) => new FireCrow(ctx, opts));
}
