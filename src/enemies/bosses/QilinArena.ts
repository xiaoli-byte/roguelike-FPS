/**
 * 火麒麟的场地识别：从关卡数据里找出祝融炉心殿（inferno-5「圆形炉心殿」）的几何，不写死世界坐标。
 *
 * 首领只能拿到公开接口：ctx.stage.arena、ctx.nav，以及关卡导演挂出来的熔岩系统（StageDirector.lavaSystem，
 * 它的 lava 就是白盒熔岩掩码，世界坐标、0.5 米一格）。按熔岩掩码反推：
 *  - 中央熔池：熔岩格按 8 邻接分块，取「够大、够圆」的最大一块（护城渠是长条，圆度过不了）：
 *    圆心 = 质心，半径 = 64 个方向上走出熔岩的距离的中位数（四条渠只占 4 个方向，不影响中位数）；
 *  - 殿墙半径：从圆心沿 64 个方向往外走，熔岩当作可走，走到第一个导航不可走处，取中位数（8 根石柱只挡住少数方向）；
 *  - 四条放射状熔岩渠：在熔池与殿墙之间取一圈采样，连续的熔岩段就是一条渠，段中点是渠的方位；
 *  - 渠上的窄桥：沿每条渠从池边往外走，第一段连续的非熔岩就是桥（取各渠平均）；
 *  - 四个象限 = 相邻两条渠的中线；外墙上的四个吊鼎锁扣在象限中线上（平面图 notes：东南西北四面外墙，离地 3–4 米）。
 * 没有熔岩数据（旧关卡、程序化竞技场、测试）时退回导航网格的冰窟式识别（KunPengArena.locateIceHole），渠按对角线假设，
 * found = false 时首领照常出招，只是没有熔流轮转。
 */
import * as THREE from 'three';
import type { ArenaInfo, INavGrid } from '../../core/types';
import type { WhiteboxLava } from '../../world/WhiteboxTypes';
import { locateIceHole } from './KunPengArena';

export interface Furnace {
  /** 熔池圆心（世界坐标，y = 地面高度） */
  readonly center: THREE.Vector3;
  /** 熔池半径（米） */
  readonly pool: number;
  /** 殿墙内侧可走到的半径（米，导航余量以内） */
  readonly wall: number;
  /** 放射状熔岩渠的方位（facing 约定 atan2(dx, dz)，升序，[-π, π)） */
  readonly channels: readonly number[];
  /** 渠上窄桥的内外半径 */
  readonly bridge: readonly [number, number];
  /** 象限中线方位：quadrants[i] 在 channels[i] 与 channels[i+1] 之间（锁扣、饮熔点都在这里） */
  readonly quadrants: readonly number[];
  /** 是否真的从熔岩数据里找到了炉心殿 */
  readonly found: boolean;
}

/** 渠的原始半宽（平面图 1.6 米宽） */
export const CHANNEL_HALF = 0.8;
/** 熔流轮转时渠涨到的宽度：从原渠的远侧边算起 4 米（全部涨向被淹的象限） */
export const FLOOD_WIDTH = 4;

const TAU = Math.PI * 2;
const wrap = (a: number): number => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

function lavaAt(L: WhiteboxLava, x: number, z: number): boolean {
  const ix = Math.floor((x - L.minX) / L.cell), iz = Math.floor((z - L.minZ) / L.cell);
  return ix >= 0 && iz >= 0 && ix < L.cols && iz < L.rows && L.mask[iz * L.cols + ix] === 1;
}

/** 熔岩格里「够大、够圆」的最大一块的质心（世界坐标），没有就返回 null */
function findPool(L: WhiteboxLava, arena: ArenaInfo | null | undefined): { x: number; z: number } | null {
  const { cols, rows, mask, cell } = L;
  const n = cols * rows;
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best: { x: number; z: number; n: number } | null = null;
  for (let s = 0; s < n; s++) {
    if (mask[s] !== 1 || comp[s] >= 0) continue;
    let head = 0, tail = 0, sx = 0, sz = 0;
    queue[tail++] = s;
    comp[s] = s;
    while (head < tail) {
      const c = queue[head++];
      const i = c % cols, j = (c - i) / cols;
      sx += i; sz += j;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const k = nj * cols + ni;
        if (mask[k] !== 1 || comp[k] >= 0) continue;
        comp[k] = s;
        queue[tail++] = k;
      }
    }
    const area = tail * cell * cell;
    if (area < 60) continue;
    const ci = sx / tail, cj = sz / tail;
    // 圆度：从质心沿 32 个方向走到本块边缘，四分位距之比（圆 ≈ 1；四条渠的残段只占 4 个方向；
    // 护城渠被桥口截成的两段是矩形，≈ 0.6）
    const reach: number[] = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * TAU, dx = Math.sin(a), dz = Math.cos(a);
      let r = 0;
      for (;;) {
        const i = Math.floor(ci + 0.5 + dx * (r + 0.5)), j = Math.floor(cj + 0.5 + dz * (r + 0.5));
        if (i < 0 || j < 0 || i >= cols || j >= rows || comp[j * cols + i] !== s) break;
        r += 0.5;
      }
      reach.push(r);
    }
    reach.sort((a, b) => a - b);
    if (reach[8] < 0.85 * reach[24] || reach[8] < 2) continue;
    const x = L.minX + (ci + 0.5) * cell, z = L.minZ + (cj + 0.5) * cell;
    if (arena && (x < arena.minX || x > arena.maxX || z < arena.minZ || z > arena.maxZ)) continue;
    if (!best || tail > best.n) best = { x, z, n: tail };
  }
  return best;
}

/** 找炉心殿；lava 为关卡的熔岩掩码（没有时退回导航网格识别） */
export function locateFurnace(
  nav: INavGrid | null | undefined, arena: ArenaInfo | null | undefined, lava: WhiteboxLava | null | undefined, near?: THREE.Vector3,
): Furnace {
  const floorY = arena?.floorY ?? 0;
  const diagonal = (center: THREE.Vector3, pool: number, wall: number, found: boolean): Furnace => {
    const channels = [-3, -1, 1, 3].map((k) => (k * Math.PI) / 4);
    return { center, pool, wall, channels, bridge: [pool + 3, pool + 7], quadrants: quadrantsOf(channels), found };
  };
  const pool = lava ? findPool(lava, arena) : null;
  if (!lava || !pool) {
    const hole = locateIceHole(nav, arena, near);
    return diagonal(hole.center.clone().setY(floorY), hole.radius, hole.outer, false);
  }
  const center = new THREE.Vector3(pool.x, floorY, pool.z);
  // 熔池半径：64 个方向走出熔岩的距离的中位数
  const reach: number[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * TAU, dx = Math.sin(a), dz = Math.cos(a);
    let r = 0;
    while (r < 60 && lavaAt(lava, center.x + dx * r, center.z + dz * r)) r += 0.25;
    reach.push(r);
  }
  const poolR = Math.max(2, median(reach));
  // 殿墙：熔岩当可走，走到导航不可走处
  const walls: number[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * TAU, dx = Math.sin(a), dz = Math.cos(a);
    let r = poolR + 0.5;
    while (r < 90) {
      const x = center.x + dx * r, z = center.z + dz * r;
      if (!(lavaAt(lava, x, z) || (nav ? nav.isWalkable(x, z) : true))) break;
      r += 0.5;
    }
    walls.push(r);
  }
  const wall = Math.max(poolR + 8, median(walls));
  // 熔岩渠：熔池与殿墙之间的一圈采样
  const ringR = Math.min(wall - 2, poolR + (wall - poolR) * 0.62);
  const N = 720;
  const hit = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU - Math.PI;
    hit[k] = lavaAt(lava, center.x + Math.sin(a) * ringR, center.z + Math.cos(a) * ringR) ? 1 : 0;
  }
  const channels: number[] = [];
  let start = 0;
  while (start < N && hit[start]) start++;
  if (start < N) {
    for (let s = 0; s < N; s++) {
      const k = (start + s) % N;
      if (!hit[k]) continue;
      let len = 0;
      while (len < N && hit[(k + len) % N]) len++;
      const mid = k + (len - 1) / 2;
      // 太宽的段不是渠（护城渠之类）
      if ((len / N) * TAU * ringR < 6) channels.push(wrap((mid / N) * TAU - Math.PI));
      s += len - 1;
    }
  }
  channels.sort((a, b) => a - b);
  if (channels.length < 2) return diagonal(center, poolR, wall, true);
  // 窄桥：沿每条渠从池边往外走，第一段 ≥ 1.5 米的非熔岩
  const b0: number[] = [], b1: number[] = [];
  for (const a of channels) {
    const dx = Math.sin(a), dz = Math.cos(a);
    let r = poolR + 0.25, from = -1;
    for (; r < wall; r += 0.25) {
      const on = lavaAt(lava, center.x + dx * r, center.z + dz * r);
      if (!on && from < 0) from = r;
      if (on && from >= 0) {
        if (r - from >= 1.5) break;
        from = -1;
      }
    }
    if (from >= 0 && r < wall) { b0.push(from); b1.push(r); }
  }
  const bridge: [number, number] = b0.length
    ? [b0.reduce((s, x) => s + x, 0) / b0.length, b1.reduce((s, x) => s + x, 0) / b1.length]
    : [poolR + 3, poolR + 7];
  return { center, pool: poolR, wall, channels, bridge, quadrants: quadrantsOf(channels), found: true };
}

function quadrantsOf(channels: readonly number[]): number[] {
  return channels.map((a, i) => {
    const b = i + 1 < channels.length ? channels[i + 1] : channels[0] + TAU;
    return wrap((a + b) / 2);
  });
}

/** 炉心殿圆心朝 angle（facing 约定）方向、离圆心 dist 米的点 */
export function furnacePoint(f: Furnace, angle: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(f.center.x + Math.sin(angle) * dist, f.center.y, f.center.z + Math.cos(angle) * dist);
}

/** 点 (x, z) 相对炉心殿圆心的方位角（facing 约定） */
export function furnaceAngle(f: Furnace, x: number, z: number): number {
  return Math.atan2(x - f.center.x, z - f.center.z);
}

/** 点 (x, z) 落在哪个象限（quadrants 的下标） */
export function quadrantOf(f: Furnace, x: number, z: number): number {
  const a = furnaceAngle(f, x, z);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < f.quadrants.length; i++) {
    const d = Math.abs(wrap(a - f.quadrants[i]));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** 顺时针（俯视、北 = −Z 朝上）的下一个象限：方位角递减 */
export function clockwiseNext(f: Furnace, q: number): number {
  const n = f.quadrants.length;
  let best = q, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (i === q) continue;
    const d = wrap(f.quadrants[q] - f.quadrants[i]);
    const dd = d <= 0 ? d + TAU : d;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return best;
}

/**
 * 熔流轮转淹没象限 q 的外侧：象限两侧那两条渠从桥外端到殿墙，各自朝象限一侧涨宽到 FLOOD_WIDTH。
 * 返回两个多边形（世界 [x, z]，交给 LavaSystem.addLavaArea），以及画预警用的条带（起点、方位、长度、半宽）。
 */
export function floodShapes(f: Furnace, q: number): { polygons: [number, number][][]; strips: { x: number; z: number; yaw: number; length: number; half: number }[] } {
  const n = f.channels.length;
  const sides: [number, number][] = [[f.channels[q], 1], [f.channels[(q + 1) % n], -1]];
  const r0 = f.bridge[1] + 0.15, r1 = f.wall + 0.8;
  const near = CHANNEL_HALF - 0.3, far = FLOOD_WIDTH - CHANNEL_HALF;
  const polygons: [number, number][][] = [];
  const strips: { x: number; z: number; yaw: number; length: number; half: number }[] = [];
  for (const [a, s] of sides) {
    const dx = Math.sin(a), dz = Math.cos(a);
    // 方位角增大的切向：(cos a, −sin a)；s = +1 朝象限（渠在象限的低角度一侧），−1 反之
    const tx = Math.cos(a) * s, tz = -Math.sin(a) * s;
    const P = (r: number, off: number): [number, number] => [f.center.x + dx * r + tx * off, f.center.z + dz * r + tz * off];
    polygons.push([P(r0, near), P(r1, near), P(r1, far), P(r0, far)]);
    const mid = (near + far) / 2;
    const [sx, sz] = P(r0, mid);
    strips.push({ x: sx, z: sz, yaw: a, length: f.wall - r0, half: (far - near) / 2 });
  }
  return { polygons, strips };
}
