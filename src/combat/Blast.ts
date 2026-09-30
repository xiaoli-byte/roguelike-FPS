/**
 * 爆炸共用工具：遮挡判定、按距离震屏、爆炸对玩家的伤害与冲击。
 * Combat.explode（玩家方爆炸）与 ProjectileSystem（敌方爆炸弹）共用。
 */
import * as THREE from 'three';
import type { Element, GameContext, IEnemy } from '../core/types';
import type { CollisionWorld, StaticBox, WorldRayHit } from '../world/Collision';
import { clamp, clamp01 } from '../core/math';

const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _hit: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };

/**
 * from → to 之间是否没有静态遮挡。
 * 射线从 from 出发、在 to 前 margin 米停下，所以 to 贴在墙面 / 地面上（爆炸点常见情况）也不会被误判为遮挡。
 */
export function lineClear(world: CollisionWorld, from: THREE.Vector3, to: THREE.Vector3, margin = 0.15): boolean {
  _d.subVectors(to, from);
  const len = _d.length();
  if (len <= margin + 0.05) return true;
  _d.multiplyScalar(1 / len);
  return world.raycast(from, _d, len - margin, _hit) === null;
}

/** 按与玩家的距离震屏（scale 用于放大 / 缩小整体强度） */
export function explosionShake(ctx: GameContext, center: THREE.Vector3, radius: number, scale = 1): void {
  const d = ctx.player.eye.distanceTo(center);
  const reach = radius * 3 + 8;
  const k = clamp01(1 - d / reach);
  if (k <= 0) return;
  const intensity = Math.min(0.75, (0.1 + radius * 0.055) * k * k * scale);
  if (intensity < 0.01) return;
  ctx.fx.shake(intensity, 0.2 + Math.min(0.3, radius * 0.03));
}

/**
 * 爆炸波及玩家：按爆心到玩家胶囊（脚底到头顶）表面的距离衰减到边缘 falloff 比例；
 * 胸口与眼睛都被墙挡住时不受伤。命中时附带一个向外的冲击。返回实际扣除量。
 */
export function blastPlayer(
  ctx: GameContext,
  center: THREE.Vector3,
  radius: number,
  damage: number,
  falloff: number,
  element: Element,
  source: IEnemy | null,
): number {
  const p = ctx.player;
  if (!p.alive || !(damage > 0) || !(radius > 0)) return 0;
  const lo = p.position.y + p.radius;
  const hi = p.position.y + Math.max(p.radius, p.height - p.radius);
  _a.set(p.position.x, clamp(center.y, lo, hi), p.position.z);
  const surf = Math.max(0, _a.distanceTo(center) - p.radius);
  if (surf > radius) return 0;

  _b.set(p.position.x, p.position.y + p.height * 0.55, p.position.z);
  if (!lineClear(ctx.world, _b, center) && !lineClear(ctx.world, p.eye, center)) return 0;

  const k = 1 - (1 - clamp01(falloff)) * clamp01(surf / radius);
  // from 交给玩家 / UI（受击方向指示可能会保留引用），传副本
  const dealt = ctx.combat.damagePlayer(damage * k, element, source, center.clone());

  // 冲击：水平向外 + 少量上抛（火箭跳也靠它）
  _imp.set(_a.x - center.x, 0, _a.z - center.z);
  const h = _imp.length();
  if (h > 1e-3) _imp.multiplyScalar(1 / h);
  _imp.multiplyScalar(6.5 * k);
  _imp.y = 3.2 * k;
  p.applyImpulse(_imp);
  return dealt;
}
