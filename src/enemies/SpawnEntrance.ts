/**
 * 出场方式的脚本位移（Unity G/Encounters/SpawnModes/SpawnEntrance.cs）——敌人生成之后、交给 AI 之前的那一段：
 *   hop  熔岩爬出：从熔岩面一跃上岸，1.2 s，上岸前不可选中；
 *   fly  飞临：从入场点沿弧线飞到站位（12 m/s，1.2–3 s），一路拖尾焰；
 *   jump 跃下：先在墙头 / 台沿露头 0.6 s（面朝场地），再抛物线跳到落点（0.75 s），落地一震。
 * 位移期间 AI 不思考、不吃击退、不可选中（Unity：AI 停用，出生时的不可选中一直留着）；落地后 AI 照常还有 0.7 s 的出生站稳，
 * 这期间已经能打（Unity：Finish 提前撤掉不可选中）。生成器把敌人生成在落点上（导航网格上），这里在同一帧把它挪到起点。
 * 纯数学部分（entrancePlan / entranceAt）不依赖引擎，tests/enemy-framework.test.mjs 直接对照 Unity 的数。
 */

export type EntranceKind = 'hop' | 'fly' | 'jump';

/** Unity SpawnEntrance 常量 + 落地后的出生站稳（EnemyAI 的 spawn 状态 0.7 s） */
export const ENTRANCE = { hopTime: 1.2, peekTime: 0.6, jumpTime: 0.75, flySpeed: 12, settle: 0.7 } as const;

export interface Vec3Like { x: number; y: number; z: number }

/** 一段出场：先停 delay 秒（跃下的露头），再用 duration 秒走完，弧高 height */
export interface EntrancePlan {
  kind: EntranceKind;
  delay: number;
  duration: number;
  height: number;
}

/** 出场的时长与弧高（Unity SpawnEntrance.Init） */
export function entrancePlan(kind: EntranceKind, from: Vec3Like, to: Vec3Like): EntrancePlan {
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  switch (kind) {
    case 'hop':
      return { kind, delay: 0, duration: ENTRANCE.hopTime, height: 1.2 + Math.max(0, to.y - from.y) * 0.5 };
    case 'fly':
      return { kind, delay: 0, duration: Math.min(3, Math.max(1.2, dist / ENTRANCE.flySpeed)), height: Math.min(6, Math.max(1, dist * 0.12)) };
    default:
      return { kind, delay: ENTRANCE.peekTime, duration: ENTRANCE.jumpTime, height: 1.2 };
  }
}

/**
 * 出场开始 t 秒时的位置（写进 out）；返回进度 u（0..1，露头期间为 0）。
 * 跃下按线性插值（抛物线落地干脆），其余按 SmoothStep；弧线 = height × 4u(1 − u)（Unity SpawnEntrance.Update）
 */
export function entranceAt(plan: EntrancePlan, from: Vec3Like, to: Vec3Like, t: number, out: Vec3Like): number {
  if (t < plan.delay) {
    out.x = from.x;
    out.y = from.y;
    out.z = from.z;
    return 0;
  }
  const u = Math.min(1, Math.max(0, (t - plan.delay) / plan.duration));
  const e = plan.kind === 'jump' ? u : u * u * (3 - 2 * u);
  out.x = from.x + (to.x - from.x) * e;
  out.y = from.y + (to.y - from.y) * e + plan.height * 4 * u * (1 - u);
  out.z = from.z + (to.z - from.z) * e;
  return u;
}
