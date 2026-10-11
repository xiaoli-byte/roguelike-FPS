/**
 * 鲲鹏的场地识别：从关卡导航网格里找出中央冰窟（北冥冰台「环台中央不可通行的冰窟」）。
 *
 * 首领只能拿到公开接口（ctx.stage.arena 与 ctx.nav），拿不到平面图，所以按导航格反推：
 *  - 以 1 米步长采样整个竞技场的 nav.isWalkable，把不可通行的格子按 4 邻接分块；
 *  - 碰到采样边界的块是外围山体 / 围墙，剩下被可通行地面完全围住的块才可能是冰窟；
 *  - 取面积最大、且接近圆形的那一块（冰柱 3×3 米、祭台不到 120 平方米，远小于冰窟的约 700 平方米）：
 *    圆心 = 质心，半径 = 等面积圆半径；
 *  - 外缘半径：从圆心沿 32 个方向向外走到第一个不可通行格，取中位数（通道口只占少数方向，不影响中位数）。
 * 找不到（旧版关卡、程序化竞技场）时退回：以竞技场中心为圆心、半径 6 米的「虚拟冰窟」，found = false，
 * 首领照常出招，只是冰窟没有碰撞（玩家能走进去，吞吸咬到的就是站在冰窟上的人）。
 */
import * as THREE from 'three';
import type { ArenaInfo, INavGrid } from '../../core/types';

export interface IceHole {
  /** 冰窟圆心（世界坐标，y = 地面高度） */
  readonly center: THREE.Vector3;
  /** 冰窟半径（米，含导航网格的落脚余量） */
  readonly radius: number;
  /** 环台外缘半径（米） */
  readonly outer: number;
  /** 是否真的在导航网格里找到了冰窟（false = 退回虚拟冰窟） */
  readonly found: boolean;
}

/** 冰窟至少多大才算（平方米）：冰柱、矮墙、祭台都比它小得多 */
const MIN_AREA = 120;
/** 等面积圆半径的倍数：块内最远点超过它就不是「圆窟」（细长的墙体、走廊尽头的山体） */
const ROUNDNESS = 1.45;
const FALLBACK_RADIUS = 6;

export function locateIceHole(nav: INavGrid | null | undefined, arena: ArenaInfo | null | undefined, near?: THREE.Vector3): IceHole {
  const floorY = arena?.floorY ?? 0;
  const fallback = (): IceHole => {
    const c = arena ? arena.center.clone() : (near ? near.clone() : new THREE.Vector3());
    c.y = floorY;
    const half = arena ? Math.min(arena.maxX - arena.minX, arena.maxZ - arena.minZ) / 2 : 30;
    return { center: c, radius: FALLBACK_RADIUS, outer: Math.max(FALLBACK_RADIUS + 8, half - 3), found: false };
  };
  if (!nav || !arena) return fallback();
  const step = 1;
  const x0 = arena.minX + step / 2;
  const z0 = arena.minZ + step / 2;
  const cols = Math.max(1, Math.floor((arena.maxX - arena.minX) / step));
  const rows = Math.max(1, Math.floor((arena.maxZ - arena.minZ) / step));
  if (cols * rows > 400 * 400) return fallback();
  const open = new Uint8Array(cols * rows);
  let anyOpen = false;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const w = nav.isWalkable(x0 + i * step, z0 + j * step);
      open[j * cols + i] = w ? 1 : 0;
      if (w) anyOpen = true;
    }
  }
  if (!anyOpen) return fallback();

  // 不可通行块的 4 邻接分量
  const comp = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let best: { area: number; cx: number; cz: number; far: number } | null = null;
  let id = 0;
  for (let s = 0; s < cols * rows; s++) {
    if (open[s] || comp[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    let touches = false;
    let sx = 0;
    let sz = 0;
    let n = 0;
    while (head < tail) {
      const c = queue[head++];
      const i = c % cols;
      const j = (c - i) / cols;
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) touches = true;
      sx += i;
      sz += j;
      n++;
      const nb = [i > 0 ? c - 1 : -1, i < cols - 1 ? c + 1 : -1, j > 0 ? c - cols : -1, j < rows - 1 ? c + cols : -1];
      for (const k of nb) {
        if (k < 0 || open[k] || comp[k] >= 0) continue;
        comp[k] = id;
        queue[tail++] = k;
      }
    }
    if (!touches && n * step * step >= MIN_AREA && (!best || n > best.area)) {
      const ci = sx / n;
      const cj = sz / n;
      // 块内离质心最远的格子（圆度判定）
      let far = 0;
      for (let q = 0; q < tail; q++) {
        const c = queue[q];
        const i = c % cols;
        const j = (c - i) / cols;
        far = Math.max(far, Math.hypot(i - ci, j - cj));
      }
      const req = Math.sqrt(n / Math.PI);
      if (far <= req * ROUNDNESS + 1) best = { area: n, cx: ci, cz: cj, far };
    }
    id++;
  }
  if (!best) return fallback();
  const center = new THREE.Vector3(x0 + best.cx * step, floorY, z0 + best.cz * step);
  const radius = Math.sqrt((best.area * step * step) / Math.PI);

  // 外缘：沿 32 个方向走到第一个不可通行处，取中位数
  const reach: number[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let r = radius + 1.5;
    while (r < 120 && nav.isWalkable(center.x + dx * r, center.z + dz * r)) r += 0.5;
    reach.push(r);
  }
  reach.sort((a, b) => a - b);
  const outer = Math.max(radius + 6, reach[reach.length >> 1]);
  return { center, radius, outer, found: true };
}

/** 冰窟边缘朝 angle（facing 约定：atan2(dx, dz)）方向、离圆心 dist 米的点 */
export function holePoint(hole: IceHole, angle: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(hole.center.x + Math.sin(angle) * dist, hole.center.y, hole.center.z + Math.cos(angle) * dist);
}

/** 点 (x, z) 相对冰窟圆心的方位角（facing 约定） */
export function holeAngle(hole: IceHole, x: number, z: number): number {
  return Math.atan2(x - hole.center.x, z - hole.center.z);
}
