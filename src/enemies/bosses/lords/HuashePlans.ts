/**
 * 化蛇六招的纯数据（Unity Huashe/Moves/HuasheMoves.cs 的常量与构造函数里的调度参数；时间轴照 docs/art/ch4-move-events.json）。
 */
import { bossMove } from '../framework/BossDef';

/** 圣湖的色板（Unity HuashePalette） */
export const HuashePalette = {
  Foam: 0xf4fffc, Water: 0x38c6c0, Deep: 0x16596a,
  MouthCore: 0xfff2fb, Mouth: 0xff5ad8, MouthEdge: 0x4a2a7a,
  Shallow: 0x7fdcd6, Mud: 0x6a5a48,
} as const;

/** 吐水弹：连吐三发（0.6 / 1.05 / 1.5 s），飞 1.1 s、落地 2.6 m 溅射 12；60 m 内才出 */
export const HuasheSpitPlan = {
  id: 'spit', name: '吐水弹', Flight: 1.1, Splash: 2.6, WebDamage: 12, Gravity: 20, Releases: [0.6, 1.05, 1.5] as const,
  spec: bossMove({ id: 'spit', name: '吐水弹', windup: 0.6, active: 1.35, recover: 0.6, cooldown: 3, recovery: 0.7, weight: 1 }),
};

/** 扑岸：玩家在岸边 9 m 内；冲上岸 8 m（最多 10），咬 20 + 击退；搁浅 1.2 s（头离玩家 10 m 内才出） */
export const HuasheLungePlan = {
  id: 'lunge', name: '扑岸', Reach: 10, Width: 3.4, BiteRadius: 4.5, WebDamage: 20,
  spec: bossMove({ id: 'lunge', name: '扑岸', windup: 0.7, active: 0.35, recover: 1.2, cooldown: 4, recovery: 0.6, weight: 3 }),
};

/** 潜游突袭（二阶段起）：玩家离 10–30 m 时出，之后同扑岸 */
export const HuasheDivePlan = {
  id: 'dive', name: '潜游突袭',
  spec: bossMove({ id: 'dive', name: '潜游突袭', windup: 1.5, active: 0.35, recover: 1.2, cooldown: 7, recovery: 0.6, weight: 1.2, minPhase: 1 }),
};

/** 翼拍浪：脚下 6 m 危险圈；一圈 1 m 高的浪推到 30 m（1.6 s），在地上就挨 10 + 推开 */
export const HuasheWingSlapPlan = {
  id: 'wingslap', name: '翼拍浪', Range: 30, Seconds: 1.6, WebDamage: 10, Warn: 6,
  spec: bossMove({ id: 'wingslap', name: '翼拍浪', windup: 0.8, active: 0.4, recover: 0.6, cooldown: 5, recovery: 0.7, weight: 1 }),
};

/** 吼叫涨水（二阶段起，霸体）：湖水 2.4 s 内再涨 0.8 m，6 s 后退回 */
export const HuasheRoarPlan = {
  id: 'roar', name: '吼叫涨水',
  spec: bossMove({ id: 'roar', name: '吼叫涨水', windup: 0.6, active: 2.4, recover: 0.8, cooldown: 12, recovery: 0.8, weight: 1, minPhase: 1, stunnable: false }),
};

/** 尾扫（三阶段）：120° / 14 m 扇形，站在地上的人挨 14 + 推开 */
export const HuasheTailSweepPlan = {
  id: 'tailsweep', name: '尾扫', Range: 14, HalfAngle: 60, WebDamage: 14,
  spec: bossMove({ id: 'tailsweep', name: '尾扫', windup: 0.7, active: 0.5, recover: 0.8, cooldown: 5, recovery: 0.7, weight: 1.2, minPhase: 2 }),
};

export const HUASHE_PLANS = [HuasheSpitPlan, HuasheLungePlan, HuasheDivePlan, HuasheWingSlapPlan, HuasheRoarPlan, HuasheTailSweepPlan];
