/**
 * 布局后处理：整体旋转 k·90°、连通性校验与修复（与 NavGrid 相同的光栅化规则）、点光源整理。
 */
import type { DecoKind, LevelLayout, P2 } from './LevelTypes';
import { NAV_FOOT, labelComponents, rasterizeBlocked } from './NavGrid';

/** 点光源数量恒定，避免换关时灯光数量变化导致着色器重编译 */
const LIGHT_COUNT = 4;
const LIGHT_Y: Partial<Record<DecoKind, number>> = { brazier: 1.6, stoneLantern: 1.55, lanternPost: 2.5 };

function pointRectDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

function rotXZ(k: number, x: number, z: number): [number, number] {
  switch (k & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

/** 整体绕 Y 轴旋转 k·90°（与 three.js rotation.y 同向，yaw 相应 + k·π/2） */
export function rotateLayout(L: LevelLayout, k: number): void {
  k &= 3;
  if (k === 0) return;
  const dyaw = (k * Math.PI) / 2;
  const rp = (p: P2): void => {
    const [x, z] = rotXZ(k, p.x, p.z);
    p.x = x;
    p.z = z;
  };
  for (const b of L.boxes) {
    const [ax, az] = rotXZ(k, b.minX, b.minZ);
    const [bx, bz] = rotXZ(k, b.maxX, b.maxZ);
    b.minX = Math.min(ax, bx);
    b.maxX = Math.max(ax, bx);
    b.minZ = Math.min(az, bz);
    b.maxZ = Math.max(az, bz);
  }
  for (const d of L.decos) {
    const [x, z] = rotXZ(k, d.x, d.z);
    d.x = x;
    d.z = z;
    d.yaw += dyaw;
  }
  for (const r of L.runes) rp(r);
  for (const p of L.spawnPoints) rp(p);
  for (const p of L.portalPoints) rp(p);
  for (const c of L.checks) rp(c);
  rp(L.playerSpawn);
  rp(L.rewardPoint);
  rp(L.shopPoint);
  rp(L.bossPoint);
  L.playerYaw += dyaw;
}

export function removeGroup(L: LevelLayout, g: number): void {
  L.boxes = L.boxes.filter((b) => b.group !== g);
  L.decos = L.decos.filter((d) => d.group !== g);
  L.checks = L.checks.filter((c) => c.g !== g);
}

/**
 * 连通性校验：与 NavGrid 完全相同的光栅化规则（1 米格、同一原点），从出生点泛洪。
 * 奖励点 / 传送门 / 商店 / Boss 点 / 台阶口不可达时，移除离它最近的障碍组再试；
 * 不可达的刷怪点直接丢弃。成功返回 true。
 */
export function validateAndRepair(L: LevelLayout): boolean {
  const H = L.half;
  const cols = 2 * H;
  const rows = 2 * H;
  const n = cols * rows;
  const blocked = new Uint8Array(n);
  const comp = new Int32Array(n);
  const queue = new Int32Array(n);
  const cellAt = (p: P2): number => {
    const ix = Math.floor(p.x + H);
    const iz = Math.floor(p.z + H);
    if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return -1;
    return iz * cols + ix;
  };

  for (let iter = 0; iter < 16; iter++) {
    rasterizeBlocked(L.boxes, -H, -H, cols, rows, 1, L.floorY, NAV_FOOT, blocked);
    labelComponents(blocked, cols, rows, comp, queue);
    const sc = cellAt(L.playerSpawn);
    if (sc < 0 || blocked[sc]) return false;
    const home = comp[sc];
    const ok = (p: P2): boolean => {
      const c = cellAt(p);
      return c >= 0 && !blocked[c] && comp[c] === home;
    };
    const keys: P2[] = [L.rewardPoint, ...L.portalPoints, L.shopPoint, ...L.checks];
    if (L.type === 'boss') keys.push(L.bossPoint);
    const bad = keys.find((p) => !ok(p));
    if (!bad) {
      L.spawnPoints = L.spawnPoints.filter(ok);
      const needSpawns = L.type === 'combat' || L.type === 'elite' || L.type === 'boss';
      return !needSpawns || L.spawnPoints.length >= 8;
    }
    // 移除离不可达点最近的障碍组
    let bestG = -1;
    let bestD = Infinity;
    for (const b of L.boxes) {
      if (b.group <= 0) continue;
      const d = pointRectDist(bad.x, bad.z, b.minX, b.minZ, b.maxX, b.maxZ);
      if (d < bestD) {
        bestD = d;
        bestG = b.group;
      }
    }
    if (bestG < 0) return false;
    removeGroup(L, bestG);
  }
  return false;
}

/** 由带灯装饰得出恒为 4 个的点光源位置 */
export function finalizeLights(L: LevelLayout): void {
  const lights: LevelLayout['lights'] = [];
  for (const d of L.decos) {
    if (!d.lit || lights.length >= LIGHT_COUNT) continue;
    lights.push({ x: d.x, y: LIGHT_Y[d.kind] ?? 1.6, z: d.z });
  }
  const H = L.half;
  const fill: P2[] = [{ x: -H * 0.5, z: -H * 0.5 }, { x: H * 0.5, z: H * 0.5 }, { x: -H * 0.5, z: H * 0.5 }, { x: H * 0.5, z: -H * 0.5 }];
  for (let i = 0; lights.length < LIGHT_COUNT; i++) lights.push({ x: fill[i].x, y: 3.5, z: fill[i].z });
  L.lights = lights;
}
