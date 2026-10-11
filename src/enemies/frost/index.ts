/**
 * 第二章 · 昆仑雪墟定稿阵容（2026-10-10 用户选定 A + C，docs/art/enemy-roster-v2.md 第二章）。
 * 每组一个注册文件，各自登记本组敌人；首领鲲鹏在 bosses/index.ts 注册。
 */
import { registerFrostPack } from './registerPack';
import { registerFrostRanged } from './registerRanged';
import { registerFrostSkirmishers } from './registerSkirmishers';
import { registerFrostSupport } from './registerSupport';
import { registerFrostTanks } from './registerTanks';

export function registerFrostEnemies(): void {
  registerFrostPack();       // 冻鲛人、雪狌狌
  registerFrostTanks();      // 冰甲旋龟（+ 旋壳）、玄冰巨蟹
  registerFrostSkirmishers(); // 三青鸟、冰河豚、冰棘豪彘
  registerFrostSupport();    // 九尾狐巫（+ 铜镜）、冰灯水母
  registerFrostRanged();     // 夫诸、冰鲸
}
