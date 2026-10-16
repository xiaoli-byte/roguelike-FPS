/**
 * 第三章 · 祝融火狱阵容（2026-10-11 用户确认设计稿，docs/art/enemy-roster-v2.md 第三章）。
 * 每组一个注册文件；首领火麒麟在 bosses/index.ts 注册。
 */
import { registerInfernoBlasters } from './registerBlasters';
import { registerInfernoPack } from './registerPack';
import { registerInfernoRanged } from './registerRanged';
import { registerInfernoSupport } from './registerSupport';
import { registerInfernoTanks } from './registerTanks';

export function registerInfernoEnemies(): void {
  registerInfernoPack();     // 炭童、祸斗
  registerInfernoTanks();    // 熔炉铁牛、火鼍
  registerInfernoRanged();   // 毕方、马面狱卒
  registerInfernoBlasters(); // 炮仗傀儡、神火飞鸦
  registerInfernoSupport();  // 熔铜匠、变脸傩巫
}
