/**
 * 第二章 · 昆仑雪墟新阵容：群怪组的注册（由 registerFrostEnemies 统一调用）。
 * - 冻鲛人 jiaoren（北冥）：先远投骨矛，再成群突刺，死后掉鲛珠（小回复）。
 * - 雪狌狌 xingxing（昆仑）：四足狂奔、跳砸冰环、攀上高台，够不着就抛冰块。
 */
import { registerEnemy } from '../Registry';
import { JIAOREN_DEF, Jiaoren } from '../types/Jiaoren';
import { XINGXING_DEF, Xingxing } from '../types/Xingxing';

export function registerFrostPack(): void {
  registerEnemy(JIAOREN_DEF, (ctx, opts) => new Jiaoren(ctx, opts));
  registerEnemy(XINGXING_DEF, (ctx, opts) => new Xingxing(ctx, opts));
}
