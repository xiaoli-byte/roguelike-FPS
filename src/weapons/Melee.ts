/**
 * 近战判定（魔刀千刃，docs/demon-blade.md 第 10.4.5 节）：纯函数 + 模块级临时量，热路径零分配。
 *
 * - sweepSector：一段斩击的判定帧——玩家前方水平扇形（按敌人胶囊表面计距离、按角半径放宽角度）
 *   + 高度带（脚下 reachBelow 到头顶上方 reachAbove）+ 视线（眼睛到身体中心或头部中心任一可见）。
 * - sweepPath：武器技能突进的路径判定——本帧脚底位移线段 a → b 两侧 radius 内的敌人（水平距离按胶囊表面计）。
 *
 * 两个函数都只遍历一次 ctx.enemies.list，把命中的敌人写进调用方持有、复用的 out 数组（先清空）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp01 } from '../core/math';
import type { MeleeParams, MeleeSegment, WeaponDef } from './WeaponDefs';

/** 敌人胶囊表面距玩家 ≤ 此值时不判扇形角度（贴身），只排除正后方 */
export const MELEE_CLOSE = 0.35;
/** 贴身时「正后方」的水平点积阈值 */
const BEHIND_DOT = -0.3;
/** 魔刀无元素时的默认颜色（朱红，与飞刃 projectile.color 一致） */
const BLADE_RED = 0xff3a24;

/** 判定高度带（MeleeParams 的子集；技能路径判定也用它） */
export type MeleeReach = Pick<MeleeParams, 'reachBelow' | 'reachAbove'>;
/** 扇形参数（MeleeSegment 的子集；连段追击用加长的临时扇形） */
export type MeleeSector = Pick<MeleeSegment, 'range' | 'halfAngle'>;

const _f = new THREE.Vector3();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _e = new THREE.Vector3();

/** 斩击 / 飞刃 / 刃印共用的颜色：无元素为朱红（def.projectile.color），否则为元素色 */
export function bladeColor(inst: WeaponInstance, def: WeaponDef): number {
  if (inst.element !== 'none') return ELEMENT_COLORS[inst.element];
  return def.projectile ? def.projectile.color : BLADE_RED;
}

/** 从 from 看敌人：身体中心或头部中心任一不被墙挡住即可见 */
function visible(ctx: GameContext, from: THREE.Vector3, e: IEnemy): boolean {
  const world = ctx.world;
  if (!world.segmentBlocked(from, e.getBodyCenter(_c))) return true;
  return !world.segmentBlocked(from, e.getHeadCenter(_h));
}

/**
 * 一段斩击的扇形判定。out 先清空再写入命中的敌人（每名敌人最多一次）并返回 out。
 * 扇形朝向只看玩家 yaw（水平），角度按敌人的角半径放宽：allow = halfAngle + asin(r / d)，
 * cos(allow) 用和角公式由预先算好的 cos / sin(halfAngle) 求出，不必每名敌人调用三角函数。
 */
export function sweepSector(ctx: GameContext, seg: MeleeSector, reach: MeleeReach, out: IEnemy[]): IEnemy[] {
  out.length = 0;
  const player = ctx.player;
  const p = player.position;
  const eye = player.eye;
  const f = player.getForward(_f);
  const yLo = p.y - reach.reachBelow;
  const yHi = p.y + player.height + reach.reachAbove;
  const cosH = Math.cos(seg.halfAngle);
  const sinH = Math.sin(seg.halfAngle);
  const list = ctx.enemies.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    const ep = e.position;
    // 高度：脚下 reachBelow 到头顶上方 reachAbove
    if (ep.y > yHi || ep.y + e.height < yLo) continue;
    const dx = ep.x - p.x;
    const dz = ep.z - p.z;
    const d = Math.hypot(dx, dz);
    const surf = d - e.radius;
    // 距离按胶囊表面
    if (surf > seg.range) continue;
    const dot = (dx * f.x + dz * f.z) / Math.max(d, 1e-4);
    if (surf > MELEE_CLOSE) {
      // surf > 0 ⇒ d > radius，s < 1；放宽后超过 180°（sin(allow) < 0）时不判角度
      const s = e.radius / d;
      const c = Math.sqrt(1 - s * s);
      if (sinH * c + cosH * s >= 0 && dot < cosH * c - sinH * s) continue;
    } else if (dot < BEHIND_DOT) {
      continue;
    }
    if (!visible(ctx, eye, e)) continue;
    out.push(e);
  }
  return out;
}

/** 敌人胶囊表面到玩家的水平距离（与 sweepSector 的距离口径一致） */
export function surfaceDistance(ctx: GameContext, e: IEnemy): number {
  const p = ctx.player.position;
  return Math.hypot(e.position.x - p.x, e.position.z - p.z) - e.radius;
}

/** 点 q 到线段 ab 的水平最近点写入 out（y 按参数 t 在 a.y 与 b.y 之间插值），返回 out */
export function pathClosest(a: THREE.Vector3, b: THREE.Vector3, q: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 1e-8 ? clamp01(((q.x - a.x) * abx + (q.z - a.z) * abz) / len2) : 0;
  return out.set(a.x + abx * t, a.y + (b.y - a.y) * t, a.z + abz * t);
}

/**
 * 突进路径判定：线段 a → b（本帧脚底位移）两侧 radius 内、未在 exclude 中的敌人。
 * 高度带 [min(a.y, b.y) − reachBelow, max(a.y, b.y) + 身高 + reachAbove]；视线从「线段最近点 + 眼高」到身体中心或头部。
 * out 先清空再写入，返回 out。
 */
export function sweepPath(
  ctx: GameContext, a: THREE.Vector3, b: THREE.Vector3, radius: number, reach: MeleeReach,
  exclude: ReadonlySet<IEnemy>, out: IEnemy[],
): IEnemy[] {
  out.length = 0;
  const player = ctx.player;
  const eyeH = player.eye.y - player.position.y;
  const yLo = Math.min(a.y, b.y) - reach.reachBelow;
  const yHi = Math.max(a.y, b.y) + player.height + reach.reachAbove;
  const list = ctx.enemies.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive || exclude.has(e)) continue;
    const ep = e.position;
    if (ep.y > yHi || ep.y + e.height < yLo) continue;
    pathClosest(a, b, ep, _e);
    if (Math.hypot(ep.x - _e.x, ep.z - _e.z) - e.radius > radius) continue;
    _e.y += eyeH;
    if (!visible(ctx, _e, e)) continue;
    out.push(e);
  }
  return out;
}
