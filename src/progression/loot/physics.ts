import * as THREE from 'three';
import type { GameContext } from '../../core/types';

/** 掉落物的简易抛体物理：重力、撞墙反弹、落地弹跳（基于 ctx.world.groundHeight） */

export const LOOT_GRAVITY = 22;
const PROBE_R = 0.14;
const _probe = new THREE.Vector3();

/** (x, z) 处不高于 fromY 的地面高度；没有地面时退回竞技场地面 */
export function groundAt(ctx: GameContext, x: number, z: number, fromY: number): number {
  const g = ctx.world.groundHeight(x, z, fromY);
  return g > -Infinity ? g : (ctx.stage.arena?.floorY ?? 0);
}

/**
 * 关卡物体（宝箱、商店）应当朝向的点：关卡加载期间（非 playing）玩家可能尚未就位，朝向出生点；
 * 否则朝向玩家当前位置。
 */
export function facingTarget(ctx: GameContext): THREE.Vector3 {
  const arena = ctx.stage.arena;
  if (arena && ctx.game.state !== 'playing') return arena.playerSpawn;
  return ctx.player.position;
}

/** 从 from 看向 target 的模型朝向（facing = atan2(dx, dz)）；重合时返回 fallback */
export function facingToward(from: THREE.Vector3, target: THREE.Vector3, fallback = 0): number {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  return dx * dx + dz * dz > 0.01 ? Math.atan2(dx, dz) : fallback;
}

/** 把点限制在竞技场内（margin 米） */
export function clampToArena(ctx: GameContext, p: THREE.Vector3, margin: number): void {
  const a = ctx.stage.arena;
  if (!a) return;
  if (p.x < a.minX + margin) p.x = a.minX + margin;
  else if (p.x > a.maxX - margin) p.x = a.maxX - margin;
  if (p.z < a.minZ + margin) p.z = a.minZ + margin;
  else if (p.z > a.maxZ - margin) p.z = a.maxZ - margin;
}

export interface TossState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** 物体中心离地的静止高度 */
  rest: number;
}

/**
 * 推进一步抛体运动。返回落地后的地面高度（静止时），仍在运动返回 NaN。
 * 弹跳：竖直速度足够大时以 0.42 的恢复系数反弹，并衰减水平速度。
 */
export function stepToss(ctx: GameContext, s: TossState, dt: number): number {
  const { pos, vel, rest } = s;
  vel.y -= LOOT_GRAVITY * dt;
  const prevFeet = pos.y - rest;

  const nx = pos.x + vel.x * dt;
  const nz = pos.z + vel.z * dt;
  _probe.set(nx, pos.y, nz);
  if (ctx.world.sphereOverlaps(_probe, PROBE_R)) {
    vel.x *= -0.3;
    vel.z *= -0.3;
  } else {
    pos.x = nx;
    pos.z = nz;
  }
  clampToArena(ctx, pos, 0.6);

  pos.y += vel.y * dt;
  const g = groundAt(ctx, pos.x, pos.z, prevFeet + 0.05);
  const restY = g + rest;
  if (pos.y <= restY) {
    pos.y = restY;
    if (vel.y < -2.4) {
      vel.y = -vel.y * 0.42;
      vel.x *= 0.62;
      vel.z *= 0.62;
    } else {
      vel.set(0, 0, 0);
      return g;
    }
  }
  return NaN;
}
