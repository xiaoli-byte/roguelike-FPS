/**
 * 敌方范围伤害的公共结算（爆骸虫自爆、爆裂词缀、法阵等）。
 * 伤害一律走 ctx.combat.damagePlayer；遮挡用 ctx.world.segmentBlocked 判定。
 */
import * as THREE from 'three';
import type { Element, GameContext, IEnemy } from '../core/types';
import { clamp01 } from '../core/math';

const _chest = new THREE.Vector3();

/**
 * 以 center 为中心的球形爆炸对玩家结算（按距离线性衰减到边缘的 1 - falloff）。
 * @returns 是否命中玩家
 */
export function blastPlayer(
  ctx: GameContext, center: THREE.Vector3, radius: number, damage: number,
  element: Element, source: IEnemy | null, falloff = 0.5, shake = 0.6,
): boolean {
  const p = ctx.player;
  _chest.set(p.position.x, p.position.y + Math.min(1.1, p.height * 0.6), p.position.z);
  const d = center.distanceTo(_chest);
  // 远处也给一点震动，增强临场感
  if (shake > 0) ctx.fx.shake(shake * clamp01(1 - d / (radius * 3.2)), 0.35);
  if (!p.alive || d > radius + p.radius) return false;
  if (ctx.world.segmentBlocked(center, _chest)) return false;
  const k = 1 - falloff * clamp01(d / radius);
  ctx.combat.damagePlayer(damage * k, element, source, center);
  return true;
}

/**
 * 地面圆形区域对玩家结算（法阵类）：水平距离在半径内、且高度差在 [-0.6, maxRise] 内。
 */
export function zonePlayer(
  ctx: GameContext, center: THREE.Vector3, radius: number, damage: number,
  element: Element, source: IEnemy | null, maxRise = 2.2,
): boolean {
  const p = ctx.player;
  if (!p.alive) return false;
  const dx = p.position.x - center.x;
  const dz = p.position.z - center.z;
  const dy = p.position.y - center.y;
  if (dx * dx + dz * dz > (radius + p.radius * 0.5) ** 2) return false;
  if (dy < -0.6 || dy > maxRise) return false;
  ctx.combat.damagePlayer(damage, element, source, center);
  return true;
}
