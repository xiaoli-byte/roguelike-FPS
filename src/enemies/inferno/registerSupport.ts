/** 第三章 · 祝融火狱：本组敌人的注册（由 registerInfernoEnemies 统一调用）。 */
import { registerEnemy } from '../Registry';
import { FOUNDER_DEF, Founder } from '../types/Founder';
import { NUO_DEF, Nuo } from '../types/Nuo';

export function registerInfernoSupport(): void {
  // 熔铜匠（坩埚长在背上，流嘴弯过右肩；往同伴身上浇铜甲：刚浇上通红、受伤 ×2，冷了成青铜、受伤 ×0.5）
  registerEnemy(FOUNDER_DEF, (ctx, opts) => new Founder(ctx, opts));
  // 变脸傩巫（跳火傩给同伴加光环，约每 8 秒变脸换一种加成；面具是头部的一部分）
  registerEnemy(NUO_DEF, (ctx, opts) => new Nuo(ctx, opts));
}
