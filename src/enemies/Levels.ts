/**
 * 高台与台阶识别（供地面近战敌人上下高台）。
 *
 * 导航网格只覆盖地面层：高台和台阶在网格里都是阻挡格，所以玩家站上高台后，近战敌人原本只能在台下徘徊。
 * 这里从碰撞世界里按标签（'platform' / 'stair'，由关卡生成写入）找出每座高台的整段台阶，
 * 算出台阶外侧的「台阶口」（地面，可导航）与台阶顶端进入台面的「台顶入口」：
 * 敌人先用导航网格走到台阶口，再沿台阶直线走上去（台阶每级 ≤ 0.47 米，EnemyBase 的自动抬升可以跨过）。
 *
 * 结果按 CollisionWorld 实例 + version 缓存，换关或增删盒子后自动重算；没有台阶的高台不生成路线。
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { CollisionWorld, StaticBox } from '../world/Collision';

export interface PlatformRoute {
  readonly box: StaticBox;
  /** 台阶外侧的地面落脚点（离最外一级约 1.1 米） */
  readonly foot: THREE.Vector3;
  /** 走完台阶后台面上的点（离台边约 0.9 米，正对台阶中线） */
  readonly top: THREE.Vector3;
  /** 整段台阶在 XZ 上的范围 */
  readonly sx0: number;
  readonly sx1: number;
  readonly sz0: number;
  readonly sz1: number;
}

/** 某个位置所处的高台区域：route 为 null 表示在地面（或不在任何带台阶的高台上） */
export interface LevelSpot {
  route: PlatformRoute | null;
  /** true = 站在台面上；false = 在台阶上 */
  onTop: boolean;
}

const EPS = 0.03;
const FOOT_OUT = 1.1;
const TOP_IN = 0.9;
/** 判定「在台面上」：脚底不低于台面 0.4 米，且不高于台面 4 米（跳跃 / 滑翔） */
const TOP_BELOW = 0.4;
const TOP_ABOVE = 4;
/** 判定「在台阶上」：离地至少这么高 */
const STAIR_MIN_RISE = 0.12;

let cacheWorld: CollisionWorld | null = null;
let cacheVersion = -1;
let routes: PlatformRoute[] = [];

/** 当前碰撞世界里所有带台阶的高台路线 */
export function platformRoutes(world: CollisionWorld): readonly PlatformRoute[] {
  if (world === cacheWorld && world.version === cacheVersion) return routes;
  cacheWorld = world;
  cacheVersion = world.version;
  const plats: StaticBox[] = [];
  const stairs: StaticBox[] = [];
  for (const b of world.boxes) {
    if (b.tag === 'platform') plats.push(b);
    else if (b.tag === 'stair') stairs.push(b);
  }
  const next: PlatformRoute[] = [];
  if (stairs.length > 0) {
    for (const p of plats) {
      const r = buildRoute(p, stairs);
      if (r) next.push(r);
    }
  }
  routes = next;
  return routes;
}

/** 从紧贴高台一侧的最高一级台阶出发，收集同一侧、同宽度的整段台阶 */
function buildRoute(P: StaticBox, stairs: readonly StaticBox[]): PlatformRoute | null {
  for (const s of stairs) {
    if (s.maxY >= P.maxY - 0.01 || Math.abs(s.minY - P.minY) > 0.15) continue;
    const inZ = s.minZ >= P.minZ - EPS && s.maxZ <= P.maxZ + EPS;
    const inX = s.minX >= P.minX - EPS && s.maxX <= P.maxX + EPS;
    let side = -1;
    if (inZ && Math.abs(s.minX - P.maxX) < EPS) side = 0;
    else if (inZ && Math.abs(s.maxX - P.minX) < EPS) side = 1;
    else if (inX && Math.abs(s.minZ - P.maxZ) < EPS) side = 2;
    else if (inX && Math.abs(s.maxZ - P.minZ) < EPS) side = 3;
    if (side < 0) continue;

    const alongX = side < 2;
    let outer = side === 0 ? s.maxX : side === 1 ? s.minX : side === 2 ? s.maxZ : s.minZ;
    for (const t of stairs) {
      if (alongX) {
        if (Math.abs(t.minZ - s.minZ) > EPS || Math.abs(t.maxZ - s.maxZ) > EPS) continue;
        if (side === 0 && t.minX >= P.maxX - EPS && t.maxX <= P.maxX + 8) outer = Math.max(outer, t.maxX);
        if (side === 1 && t.maxX <= P.minX + EPS && t.minX >= P.minX - 8) outer = Math.min(outer, t.minX);
      } else {
        if (Math.abs(t.minX - s.minX) > EPS || Math.abs(t.maxX - s.maxX) > EPS) continue;
        if (side === 2 && t.minZ >= P.maxZ - EPS && t.maxZ <= P.maxZ + 8) outer = Math.max(outer, t.maxZ);
        if (side === 3 && t.maxZ <= P.minZ + EPS && t.minZ >= P.minZ - 8) outer = Math.min(outer, t.minZ);
      }
    }

    const y0 = P.minY;
    const y1 = P.maxY;
    if (alongX) {
      const cz = (s.minZ + s.maxZ) / 2;
      const sgn = side === 0 ? 1 : -1;
      const edge = side === 0 ? P.maxX : P.minX;
      return {
        box: P,
        foot: new THREE.Vector3(outer + sgn * FOOT_OUT, y0, cz),
        top: new THREE.Vector3(edge - sgn * TOP_IN, y1, cz),
        sx0: Math.min(edge, outer), sx1: Math.max(edge, outer), sz0: s.minZ, sz1: s.maxZ,
      };
    }
    const cx = (s.minX + s.maxX) / 2;
    const sgn = side === 2 ? 1 : -1;
    const edge = side === 2 ? P.maxZ : P.minZ;
    return {
      box: P,
      foot: new THREE.Vector3(cx, y0, outer + sgn * FOOT_OUT),
      top: new THREE.Vector3(cx, y1, edge - sgn * TOP_IN),
      sx0: s.minX, sx1: s.maxX, sz0: Math.min(edge, outer), sz1: Math.max(edge, outer),
    };
  }
  return null;
}

/**
 * pos（脚底）位于哪座高台的台面或台阶上。结果写入 out，返回是否在高台区域内。
 */
export function levelAt(world: CollisionWorld, pos: THREE.Vector3, floorY: number, out: LevelSpot): boolean {
  out.route = null;
  out.onTop = false;
  if (!(pos.y >= floorY + STAIR_MIN_RISE)) return false;
  const rs = platformRoutes(world);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const b = r.box;
    if (pos.y > b.maxY + TOP_ABOVE) continue;
    if (pos.y >= b.maxY - TOP_BELOW
      && pos.x >= b.minX - 0.05 && pos.x <= b.maxX + 0.05 && pos.z >= b.minZ - 0.05 && pos.z <= b.maxZ + 0.05) {
      out.route = r;
      out.onTop = true;
      return true;
    }
    if (pos.x >= r.sx0 - 0.1 && pos.x <= r.sx1 + 0.1 && pos.z >= r.sz0 - 0.1 && pos.z <= r.sz1 + 0.1 && pos.y <= b.maxY + 0.3) {
      out.route = r;
      out.onTop = false;
      return true;
    }
  }
  return false;
}

// 玩家所在区域：每帧只算一次，所有敌人共用
const playerSpot: LevelSpot = { route: null, onTop: false };
let playerFrame = -1;
let playerWorldVersion = -1;

export function playerLevel(ctx: GameContext, floorY: number): LevelSpot {
  const frame = ctx.time.frame;
  if (frame !== playerFrame || ctx.world.version !== playerWorldVersion) {
    playerFrame = frame;
    playerWorldVersion = ctx.world.version;
    levelAt(ctx.world, ctx.player.position, floorY, playerSpot);
  }
  return playerSpot;
}
