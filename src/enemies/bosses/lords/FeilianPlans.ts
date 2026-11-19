/**
 * 飞廉七招的纯数据（Unity Feilian/Moves/FeilianMoves.cs 的常量与构造函数里的调度参数；时间轴照 docs/art/ch4-move-events.json）。
 * 不碰场景：FeilianDef、node 测试、运行时招式（FeilianMoves.ts）都读这里，一处改数。
 */
import { bossMove } from '../framework/BossDef';

/** 风伯的色板（Unity FeilianPalette） */
export const FeilianPalette = {
  WindCore: 0xf4fbff, Wind: 0xbfe6f5, WindEdge: 0x6f8fa8,
  OrbCore: 0xfbf6ff, Orb: 0xb48cff, OrbEdge: 0x4a3a8a,
  FireCore: 0xffe08a, Fire: 0xff8a3a, FireEdge: 0xa8381a,
  Snow: 0xe6f0f8, SnowShade: 0x9fb4c8,
} as const;

/** 蓄风狂风：50° 锥 40 m，挨 6 并被顺风猛推 0.6 s */
export const FeilianGustPlan = {
  id: 'gust', name: '蓄风狂风', Range: 40, HalfAngle: 25, WebDamage: 6, PushSeconds: 0.6,
  spec: bossMove({ id: 'gust', name: '蓄风狂风', windup: 1.0, active: 0.6, recover: 0.8, cooldown: 4, recovery: 0.8, weight: 1 }),
};

/** 低头冲撞：24 m/s、冲撞线 30 × 3 m，撞人 22，撞上冰脊 / 巨石晕 2 s；8 m 内权重 × 0.3 */
export const FeilianChargePlan = {
  id: 'charge', name: '低头冲撞', Speed: 24, Length: 30, Width: 3, HitRadius: 2.8, WebDamage: 22, CrashStun: 2,
  spec: bossMove({ id: 'charge', name: '低头冲撞', windup: 0.8, active: 1.4, recover: 1.0, cooldown: 3, recovery: 0.8, weight: 1 }),
  weight(distance: number): number {
    return distance > 8 ? 1 : 0.3;
  },
};

/** 回旋冲撞（二阶段起）：同冲撞，出手段一共转 2.6 rad */
export const FeilianWheelPlan = {
  id: 'wheel', name: '回旋冲撞', Sweep: 2.6,
  spec: bossMove({ id: 'wheel', name: '回旋冲撞', windup: 0.8, active: 2.2, recover: 1.2, cooldown: 6, recovery: 0.8, weight: 1, minPhase: 1 }),
};

/** 风刃：三道月牙风刃（±15°，20 m/s，各 10，射程 32 m）；可被眩晕 */
export const FeilianBladesPlan = {
  id: 'blades', name: '风刃', Speed: 20, Spread: 15, WebDamage: 10, Range: 32,
  spec: bossMove({ id: 'blades', name: '风刃', windup: 0.6, active: 0.1, recover: 0.6, cooldown: 2.5, recovery: 0.6, weight: 1, stunnable: true }),
  weight(distance: number): number {
    return distance > 10 ? 1.2 : 0.4;
  },
};

/** 侧跃：2 s 内挨打超过 700（网页值 × 耐久比例）就往侧面跳 10 m */
export const FeilianSidestepPlan = {
  id: 'sidestep', name: '侧跃', Distance: 10,
  spec: bossMove({ id: 'sidestep', name: '侧跃', windup: 0.1, active: 0.6, recover: 0.2, cooldown: 4, recovery: 0.4, weight: 100, stunnable: true }),
};

/** 龙卷风柱（二阶段起）：两根（三阶段三根）落在玩家两侧 12 m；场上已有两根时不出 */
export const FeilianTornadoPlan = {
  id: 'tornado', name: '龙卷风柱', Offset: 12,
  spec: bossMove({ id: 'tornado', name: '龙卷风柱', windup: 1.0, active: 0.2, recover: 0.6, cooldown: 9, recovery: 0.8, weight: 1.2, minPhase: 1 }),
};

/** 风雷爆（三阶段，霸体）：危险圈 12 m，35 + 雷殛 + 击退；珠子在才出 */
export const FeilianStormBurstPlan = {
  id: 'stormburst', name: '风雷爆', Radius: 12, WebDamage: 35,
  spec: bossMove({ id: 'stormburst', name: '风雷爆', windup: 4.0, active: 0.3, recover: 1.5, cooldown: 14, recovery: 1, weight: 2, minPhase: 2, stunnable: false, firstDelay: 3 }),
};

/** 龙卷风柱本体（Unity FeilianTornado）：半径、高、卷人半径 / 间隔、伤害（网页值） */
export const FeilianTornadoBody = { Radius: 2.4, Height: 12, HitRadius: 2.4, HitTick: 0.6, WebDamage: 8 } as const;

export const FEILIAN_PLANS = [FeilianGustPlan, FeilianChargePlan, FeilianWheelPlan, FeilianBladesPlan, FeilianSidestepPlan, FeilianTornadoPlan, FeilianStormBurstPlan];
