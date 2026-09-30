/**
 * 英雄定义表（id 固定：fox / falcon / bear）。
 * 数值与技能实现分别位于 skills/fox.ts、skills/falcon.ts、skills/bear.ts。
 *
 * 基础属性（未列出的沿用 core/Stats.ts 的 BASE_STATS）：
 *  - 赤狐：生命 100 / 护盾 60 / 移速 7.8，初始 蜂鸣冲锋枪
 *  - 雷隼：生命 90 / 护盾 70 / 额外跳跃 1，初始 赤铜左轮
 *  - 岩熊：生命 140 / 护盾 80 / 移速 7.0 / 减伤 10%，初始 碎岩霰弹
 */
import type { HeroDef } from '../core/types';
import { FOX } from './skills/fox';
import { FALCON } from './skills/falcon';
import { BEAR } from './skills/bear';

export const HEROES: HeroDef[] = [FOX, FALCON, BEAR];
