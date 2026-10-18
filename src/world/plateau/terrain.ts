/**
 * 开放盆地的高度场（docs/level-design/chuanzang-v1.md 第 2–3 节）。
 * 顺序：宏观地貌（倾斜面 + 低频起伏 + 山丘 / 山脊 / 冰川谷 + 盆地外的环山）→ 湖盆 → 河谷与河床（顺流单调）
 * → 天路（贴地形平滑，坡度 ≤ 10%，盘山段靠山一侧抬出台地成挡土墙）→ 牧道 → 上色。
 * 地形不再由道路决定：道路跟着地形走。网格三角化方向固定，heightAt() 与渲染网格逐三角形一致。
 */
import * as THREE from 'three';
import {
  BASIN, DIRT_SPOTS, FIELDS, GLACIER, GONGGA, HILLS, LAKES, MAP, RIDGES, RING_NOTCHES, RIVER, ROAD, TILT, TRAILS,
  type RoadNode, type V2,
} from './spec';
import { windAt } from './wind';

// ───────────────────────────── 噪声 ─────────────────────────────

function hash2(ix: number, iz: number, seed = 0): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number, oct = 4, seed = 0): number {
  let v = 0, amp = 0.5, sum = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x, z, seed + i * 17);
    sum += amp;
    x = x * 2.03 + 5.3; z = z * 2.03 - 1.7; amp *= 0.5;
  }
  return v / sum;
}

/** 山脊噪声：峰线尖、谷底圆 */
export function ridged(x: number, z: number, oct = 4, seed = 0): number {
  let v = 0, amp = 0.5, sum = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x, z, seed + i * 31) * 2 - 1);
    v += amp * n * n;
    sum += amp;
    x = x * 2.1 + 3.1; z = z * 2.1 + 7.7; amp *= 0.5;
  }
  return v / sum;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// ───────────────────────────── 折线 ─────────────────────────────

export interface PathSample {
  x: number; z: number; e: number; s: number;
  /** 单位切向 */
  tx: number; tz: number;
  /** 从本点到下一点是否属于盘山路的一折 */
  terrace: boolean;
}

interface PathPoint { x: number; z: number }

function chaikin(points: PathPoint[], iters: number): PathPoint[] {
  let pts = points;
  for (let k = 0; k < iters; k++) {
    const out: PathPoint[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function resample(points: PathPoint[], step: number): PathSample[] {
  const out: PathSample[] = [];
  let s = 0, carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, e: 0, s: s + d, tx, tz, terrace: false });
      d += step;
    }
    carry = d - len;
    s += len;
  }
  const a = points[points.length - 2], b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.push({ x: b.x, z: b.z, e: 0, s, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len, terrace: false });
  return out;
}

export function smoothLine(points: readonly V2[], step = 1.5): PathSample[] {
  return resample(chaikin(points.map(([x, z]) => ({ x, z })), 3), step);
}

/** 天路：盘山段标记按「离哪段原始折线最近」判定（割角时逐次传递会让每折两头各缩掉四分之一） */
export function smoothRoad(nodes: RoadNode[] = ROAD): PathSample[] {
  const out = resample(chaikin(nodes.map(n => ({ x: n.x, z: n.z })), 3), 1.5);
  for (const p of out) {
    let best = Infinity, terrace = false;
    for (let i = 0; i < nodes.length - 1; i++) {
      const d = segDist(p.x, p.z, nodes[i].x, nodes[i].z, nodes[i + 1].x, nodes[i + 1].z).d;
      if (d < best) { best = d; terrace = !!nodes[i].terrace; }
    }
    p.terrace = terrace;
  }
  return out;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / l2) : 0;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return { d: Math.sqrt(cx * cx + cz * cz), t };
}

// ───────────────────────────── 盆地与环山 ─────────────────────────────

/** 到盆地轮廓的有符号距离（盆地内为负） */
export function basinDistance(x: number, z: number, poly: readonly V2[] = BASIN): number {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    d = Math.min(d, segDist(x, z, xj, zj, xi, zi).d);
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

/** 从 (ox, oz) 望向贡嘎的视窗（0..1）：沿视线逐渐变宽的扇区，山在这个方向压低 */
export function gonggaWindow(x: number, z: number, ox = 0, oz = 0, near = 200, width = 60, spread = 0.28, ramp = 250): number {
  const L = Math.hypot(GONGGA.x - ox, GONGGA.z - oz);
  const ux = (GONGGA.x - ox) / L, uz = (GONGGA.z - oz) / L;
  const vx = x - ox, vz = z - oz;
  const along = vx * ux + vz * uz;
  if (along <= near) return 0;
  const perp = Math.abs(vx * uz - vz * ux);
  return Math.exp(-((perp / (width + along * spread)) ** 2)) * smoothstep(near, near + ramp, along);
}

/** 垭口望贡嘎的视窗：从垭口出发，紧挨着就开始压低 */
export const PASS_VIEW = { x: 252, z: -178 };
export function passWindow(x: number, z: number): number {
  return gonggaWindow(x, z, PASS_VIEW.x, PASS_VIEW.z, -6, 24, 0.32, 30);
}

/** 环山高度系数：北面雪山最高，西面次之，南面绿丘最低；垭口和河流出口是缺口 */
function ringAmp(x: number, z: number): number {
  const a = Math.atan2(z, x);
  const north = Math.max(0, -Math.sin(a)), south = Math.max(0, Math.sin(a)), west = Math.max(0, -Math.cos(a));
  let A = 0.85 + 0.85 * Math.pow(north, 1.5) + 0.25 * west - 0.15 * south;
  for (const n of RING_NOTCHES) A *= 1 - n.k * Math.exp(-((x - n.x) ** 2 + (z - n.z) ** 2) / (n.r * n.r));
  A *= 1 - 0.75 * passWindow(x, z);
  return A * (1 + 0.3 * (fbm(x * 0.01, z * 0.01, 3, 9) - 0.5));
}

/**
 * 离开盆地后的抬升分两段：
 * 山脚——26 m 宽的缓草坡（≤ 27°，各方向一样；软边界在 24 m，能走到的地方都是草坡）；
 * 主山坡——再往外才按方向放大的陡岩石雪山。
 */
function ringFoot(d: number): number {
  const s = (d * d) / (d + 6);
  return 16 * (1 - Math.exp(-s / 18));
}

function ringMain(d: number): number {
  return 78 * (1 - Math.exp(-Math.max(0, d - 26) / 45)) + 0.15 * Math.max(0, d - 50);
}

function tilt(x: number, z: number): number {
  return TILT.ax * (x - TILT.x0) + TILT.az * (z - TILT.z0) + TILT.c;
}

function hillsAt(x: number, z: number): number {
  let h = 0;
  for (const hl of HILLS) {
    const dx = x - hl.x, dz = z - hl.z;
    const c = Math.cos(hl.rot), s = Math.sin(hl.rot);
    const lx = (dx * c + dz * s) / hl.rx, lz = (-dx * s + dz * c) / hl.rz;
    let r = Math.hypot(lx, lz);
    if (hl.ramp && hl.rampDir !== undefined) {
      const f = Math.max(0, Math.cos(Math.atan2(dz, dx) - hl.rampDir));
      r /= 1 + (hl.ramp - 1) * f * f;
    }
    if (r >= 1) continue;
    h += hl.kind === 'dome' ? hl.h * Math.pow(1 - r * r, 1.6) : hl.h * (1 - smoothstep(hl.top ?? 0.5, 1, r));
  }
  return h;
}

/** 线状山脊取最大值（两条山脊在垭口交汇时不叠高）；垭口望贡嘎的方向压低，成为垭口另一侧的下坡 */
function ridgesAt(x: number, z: number): number {
  let h = 0;
  for (const rg of RIDGES) {
    const { d, t } = segDist(x, z, rg.a[0], rg.a[1], rg.b[0], rg.b[1]);
    if (d >= rg.halfWidth) continue;
    h = Math.max(h, (rg.hA + (rg.hB - rg.hA) * t) * (1 - smoothstep(rg.halfWidth * rg.core, rg.halfWidth, d)));
  }
  return h * (1 - 0.85 * passWindow(x, z));
}

/** 宏观地貌（没有湖、河、路）；ice = 冰川冰面权重 */
export function macroHeight(x: number, z: number): { h: number; ice: number; dOut: number } {
  // 低频大起伏 + 中频小丘（草甸本身就该是起起伏伏的，不是一块平板）
  const base = tilt(x, z) + (fbm(x * 0.007, z * 0.007, 3, 3) - 0.5) * 18 + (fbm(x * 0.016, z * 0.016, 3, 6) - 0.5) * 7
    + (fbm(x * 0.03, z * 0.03, 2, 4) - 0.5) * 2.5;
  let h = base + hillsAt(x, z) + ridgesAt(x, z);
  const dOut = basinDistance(x, z);
  let ring = 0;
  if (dOut > 0) {
    const A = ringAmp(x, z);
    const footK = (0.8 + 0.3 * fbm(x * 0.02, z * 0.02, 2, 8)) * (1 - 0.6 * passWindow(x, z));
    // 主山坡沿山脊方向起伏出峰和鞍部（不是一样高的一道墙），坡面上叠一层冲沟
    const spur = 0.65 + 0.7 * ridged(x * 0.009 + 13, z * 0.009 - 7, 3, 41);
    const gully = Math.pow(1 - ridged(x * 0.03 + 5, z * 0.03 - 9, 2, 42), 2) * 9 * smoothstep(28, 60, dOut);
    ring = footK * ringFoot(dOut) + A * (ringMain(dOut) * spur - gully) + A * (ridged(x * 0.018, z * 0.018, 4, 5) - 0.45) * 22 * smoothstep(20, 60, dOut);
  }
  // 冰川谷：谷里的环山换成向北抬升的冰面，冰舌末端是一道冰崖
  const [sx, sz] = GLACIER.snout, [tx, tz] = GLACIER.top;
  const L = Math.hypot(tx - sx, tz - sz);
  const ux = (tx - sx) / L, uz = (tz - sz) / L;
  const along = (x - sx) * ux + (z - sz) * uz;
  const dg = Math.abs((x - sx) * uz - (z - sz) * ux);
  let ice = 0;
  if (along > -4 && dg < GLACIER.halfWidth + 24) {
    const w = 1 - smoothstep(GLACIER.halfWidth * 0.7, GLACIER.halfWidth + 24, dg);
    const iceH = base + GLACIER.cliff * smoothstep(0, 3, along) + GLACIER.rise * Math.max(0, along);
    const withRing = h + ring;
    h = withRing + (Math.max(iceH, h) - withRing) * w * smoothstep(-4, 0, along);
    ice = w * smoothstep(0, 2.5, along) * (1 - smoothstep(GLACIER.halfWidth * 0.75, GLACIER.halfWidth, dg));
    return { h, ice, dOut };
  }
  return { h: h + ring, ice, dOut };
}

// ───────────────────────────── 地形 ─────────────────────────────

export interface WallSeg {
  x: number; z: number; yaw: number; len: number; bottom: number; top: number; thick: number;
  /** cut = 内侧挡土墙（山体），fill = 外侧护墙（路基） */
  kind: 'cut' | 'fill';
}

export interface Bridge { x: number; z: number; yaw: number; deckY: number; len: number; width: number; road: boolean }

const PAL = {
  grassLush: new THREE.Color('#5c9a34'),
  grassYellow: new THREE.Color('#9db04a'),
  grassDeep: new THREE.Color('#3d7531'),
  flowerPink: new THREE.Color('#b47fae'),
  flowerYellow: new THREE.Color('#d8c24c'),
  barley: new THREE.Color('#c4b75a'),
  barleyGreen: new THREE.Color('#8fae46'),
  dirt: new THREE.Color('#8c7455'),
  road: new THREE.Color('#a68a64'),
  trail: new THREE.Color('#9b815e'),
  rut: new THREE.Color('#7f6647'),
  gravel: new THREE.Color('#aa9e88'),
  rock: new THREE.Color('#8b867d'),
  rockDark: new THREE.Color('#67625b'),
  rockWarm: new THREE.Color('#8f7b66'),
  scree: new THREE.Color('#a39b8f'),
  snow: new THREE.Color('#f4f7fb'),
  snowShade: new THREE.Color('#d4e0ee'),
  ice: new THREE.Color('#d9ecf5'),
  iceBlue: new THREE.Color('#9ccbe0'),
  bed: new THREE.Color('#7b786e'),
  wet: new THREE.Color('#5b5d55'),
  shore: new THREE.Color('#b7ae98'),
  lakeBed: new THREE.Color('#5f7a6a'),
};

export class Terrain {
  readonly minX = MAP.bounds.minX;
  readonly maxX = MAP.bounds.maxX;
  readonly minZ = MAP.bounds.minZ;
  readonly maxZ = MAP.bounds.maxZ;
  readonly step = 1;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  /** 每个顶点：适合长草的程度 0..1 */
  readonly grass: Float32Array;
  /** 每个顶点：到盆地轮廓的有符号距离 */
  readonly basin: Float32Array;
  readonly colors: Float32Array;
  /** 每个顶点的地表材质权重（草、岩、雪 / 冰、土 / 碎石），着色器按它混合细节贴图 */
  readonly mat: Float32Array;
  private readonly ice: Float32Array;
  readonly road: PathSample[];
  readonly trails: PathSample[][];
  readonly river: PathSample[];
  /** 河床与水面（沿河采样点） */
  readonly riverBed: Float32Array;
  readonly riverWater: Float32Array;
  readonly lakeLevel: number[] = [];
  readonly walls: WallSeg[] = [];
  readonly bridges: Bridge[] = [];
  private roadDist!: Float32Array;
  private roadIdx!: Int32Array;
  private roadT!: Float32Array;
  private trailDist!: Float32Array;
  private trailE!: Float32Array;
  private riverDist!: Float32Array;
  private riverIdx!: Int32Array;
  private upSide!: Int8Array;
  private shelf!: Float32Array;
  private valleyFloor!: Float32Array;

  constructor() {
    this.nx = Math.round((this.maxX - this.minX) / this.step) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / this.step) + 1;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.grass = new Float32Array(n);
    this.basin = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.mat = new Float32Array(n * 4);
    this.ice = new Float32Array(n);
    this.road = smoothRoad();
    this.trails = TRAILS.map(t => smoothLine(t.points, 1.5));
    this.river = smoothLine(RIVER.points, 2);
    this.riverBed = new Float32Array(this.river.length);
    this.riverWater = new Float32Array(this.river.length);
    this.stampPaths();
    this.generateMacro();
    this.carveLakes();
    this.carveRiver();
    this.profileRoad();
    this.terraceInfo();
    this.carveRoad();
    this.carveTrails();
    this.computeWalls();
    this.findBridges();
    this.paint();
  }

  private idx(i: number, j: number): number { return j * this.nx + i; }
  private X(i: number): number { return this.minX + i * this.step; }
  private Z(j: number): number { return this.minZ + j * this.step; }

  /** 把平滑后的折线「盖章」到网格上：每个顶点记住最近的段 */
  private stamp(path: PathSample[], R: number, onHit: (k: number, d: number, s: number, t: number) => void): void {
    for (let s = 0; s < path.length - 1; s++) {
      const a = path[s], b = path[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - this.minX) / this.step));
      const i1 = Math.min(this.nx - 1, Math.ceil((Math.max(a.x, b.x) + R - this.minX) / this.step));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R - this.minZ) / this.step));
      const j1 = Math.min(this.nz - 1, Math.ceil((Math.max(a.z, b.z) + R - this.minZ) / this.step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const { d, t } = segDist(this.X(i), this.Z(j), a.x, a.z, b.x, b.z);
        if (d <= R) onHit(this.idx(i, j), d, s, t);
      }
    }
  }

  private stampPaths(): void {
    const n = this.nx * this.nz;
    this.roadDist = new Float32Array(n).fill(Infinity);
    this.roadIdx = new Int32Array(n).fill(-1);
    this.roadT = new Float32Array(n);
    this.stamp(this.road, 16, (k, d, s, t) => {
      if (d < this.roadDist[k]) { this.roadDist[k] = d; this.roadIdx[k] = s; this.roadT[k] = t; }
    });
    this.riverDist = new Float32Array(n).fill(Infinity);
    this.riverIdx = new Int32Array(n).fill(-1);
    this.stamp(this.river, 60, (k, d, s, t) => {
      if (d < this.riverDist[k]) { this.riverDist[k] = d; this.riverIdx[k] = s + (t > 0.5 ? 1 : 0); }
    });
    this.trailDist = new Float32Array(n).fill(Infinity);
  }

  private generateMacro(): void {
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = this.idx(i, j);
      const x = this.X(i), z = this.Z(j);
      const m = macroHeight(x, z);
      this.h[k] = m.h;
      this.ice[k] = m.ice;
      this.basin[k] = m.dOut;
    }
  }

  /** 湖面高度 = 湖岸一圈最低点再低 0.6 m（水不会漫出去）；湖盆是碗形，湖心岛另外抬起 */
  private carveLakes(): void {
    for (const L of LAKES) {
      const c = Math.cos(L.rot), s = Math.sin(L.rot);
      let level = Infinity;
      for (let a = 0; a < 40; a++) {
        const ang = (a / 40) * Math.PI * 2;
        const lx = Math.cos(ang) * L.rx * 1.12, lz = Math.sin(ang) * L.rz * 1.12;
        level = Math.min(level, this.heightAt(L.x + lx * c - lz * s, L.z + lx * s + lz * c));
      }
      level -= 0.6;
      this.lakeLevel.push(level);
      const R = Math.max(L.rx, L.rz) * 1.35;
      const i0 = Math.max(0, Math.floor(L.x - R - this.minX)), i1 = Math.min(this.nx - 1, Math.ceil(L.x + R - this.minX));
      const j0 = Math.max(0, Math.floor(L.z - R - this.minZ)), j1 = Math.min(this.nz - 1, Math.ceil(L.z + R - this.minZ));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = this.X(i) - L.x, dz = this.Z(j) - L.z;
        const r = Math.hypot((dx * c + dz * s) / L.rx, (-dx * s + dz * c) / L.rz);
        if (r > 1.3) continue;
        const k = this.idx(i, j);
        const target = r < 1 ? level - L.depth * Math.pow(1 - r * r, 0.7) : level + ((r - 1) / 0.3) * 2.5;
        this.h[k] = Math.min(this.h[k], target);
        if (L.island) {
          const d = Math.hypot(this.X(i) - L.island.x, this.Z(j) - L.island.z);
          if (d < L.island.r) this.h[k] = Math.max(this.h[k], level + L.island.h * (1 - (d / L.island.r) ** 2) - 0.2);
        }
      }
    }
  }

  /** 河谷：谷底沿程单调下降，两侧 0.55 坡度接回草甸；河床再下沉 1.3 m */
  private carveRiver(): void {
    const S = this.river, R = RIVER;
    const vf = new Float32Array(S.length);
    for (let i = 0; i < S.length; i++) {
      const p = S[i], nx = -p.tz, nz = p.tx;
      vf[i] = Math.min(this.heightAt(p.x, p.z), this.heightAt(p.x + nx * 10, p.z + nz * 10), this.heightAt(p.x - nx * 10, p.z - nz * 10)) - R.valleyDepth;
    }
    const glacial = LAKES.findIndex(l => l.id === 'glacial');
    if (glacial >= 0) vf[0] = Math.min(vf[0], this.lakeLevel[glacial] - 0.2);
    for (let i = 1; i < vf.length; i++) vf[i] = Math.min(vf[i], vf[i - 1] - 0.006);
    // 平滑一遍，去掉单调化留下的台阶，再单调化
    const sm = Float32Array.from(vf);
    for (let i = 2; i < vf.length - 2; i++) sm[i] = (vf[i - 2] + vf[i - 1] + vf[i] + vf[i + 1] + vf[i + 2]) / 5;
    for (let i = 1; i < sm.length; i++) sm[i] = Math.min(sm[i], sm[i - 1] - 0.004);
    this.valleyFloor = sm;
    for (let i = 0; i < S.length; i++) {
      this.riverBed[i] = sm[i] - R.channelDepth;
      this.riverWater[i] = this.riverBed[i] + 0.85;
    }
    for (let k = 0; k < this.h.length; k++) {
      const d = this.riverDist[k];
      if (!Number.isFinite(d) || this.riverIdx[k] < 0) continue;
      const i = Math.min(S.length - 1, this.riverIdx[k]);
      const valley = sm[i] + Math.max(0, d - R.valleyFloorHalf) * R.valleySide;
      const channel = this.riverBed[i] + Math.max(0, d - R.channelHalf) * 0.5;
      this.h[k] = Math.min(this.h[k], valley, channel);
    }
  }

  /** 天路高程：沿线地形做滑动平均，再双向限坡 10% */
  private profileRoad(): void {
    const R = this.road;
    const raw = R.map(p => this.heightAt(p.x, p.z));
    const avg = raw.map((_, i) => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - 8); k <= Math.min(raw.length - 1, i + 8); k++) { s += raw[k]; n++; }
      return s / n;
    });
    const g = 0.1;
    for (let i = 1; i < avg.length; i++) {
      const ds = R[i].s - R[i - 1].s;
      avg[i] = Math.min(Math.max(avg[i], avg[i - 1] - g * ds), avg[i - 1] + g * ds);
    }
    for (let i = avg.length - 2; i >= 0; i--) {
      const ds = R[i + 1].s - R[i].s;
      avg[i] = Math.min(Math.max(avg[i], avg[i + 1] - g * ds), avg[i + 1] + g * ds);
    }
    R.forEach((p, i) => { p.e = avg[i]; });
  }

  /**
   * 盘山路：找出每个采样点的靠山一侧和上一折的高程，内侧台地抬高「两折高差的一半」（最多 2.4 m），
   * 路边就是一道挡土墙——单跳（1.42 m）上不去，二段跳可以抄近路；靠近回头弯高差小，墙也矮。
   */
  private terraceInfo(): void {
    const R = this.road;
    this.upSide = new Int8Array(R.length);
    this.shelf = new Float32Array(R.length);
    for (let i = 0; i < R.length; i++) {
      const p = R[i];
      if (!p.terrace) continue;
      const nx = -p.tz, nz = p.tx;
      const side = this.heightAt(p.x + nx * 7, p.z + nz * 7) > this.heightAt(p.x - nx * 7, p.z - nz * 7) ? 1 : -1;
      const qx = p.x + nx * side * 16, qz = p.z + nz * side * 16;
      let best = Infinity, upE = p.e;
      for (const r of R) {
        if (Math.abs(r.s - p.s) < 25) continue;
        const d = Math.hypot(r.x - qx, r.z - qz);
        if (d < best) { best = d; upE = r.e; }
      }
      if (best > 9) continue;
      this.upSide[i] = side;
      this.shelf[i] = Math.min(2.4, Math.max(0, (upE - p.e) * 0.5));
    }
  }

  private roadEAt(k: number): number {
    const s = this.roadIdx[k], R = this.road;
    const a = R[s], b = R[Math.min(R.length - 1, s + 1)];
    return a.e + (b.e - a.e) * this.roadT[k];
  }

  private carveRoad(): void {
    const hw = MAP.roadHalfWidth;
    for (let k = 0; k < this.h.length; k++) {
      const rd = this.roadDist[k];
      if (rd >= hw + 7.5) continue;
      const si = this.roadIdx[k];
      const p = this.road[si];
      const e = this.roadEAt(k) - 0.06;
      const terrace = p.terrace;
      const flat = hw + (terrace ? 0.8 : 0), end = terrace ? hw + 1.6 : hw + 3.5;
      let h = this.h[k];
      if (rd <= flat) h = e;
      else if (rd < end) h = e + (h - e) * smoothstep(flat, end, rd);
      if (terrace && rd > flat) {
        const wh = this.shelf[si];
        const side = (this.X(k % this.nx) - p.x) * -p.tz + (this.Z(Math.floor(k / this.nx)) - p.z) * p.tx >= 0 ? 1 : -1;
        if (wh > 0.3 && side === this.upSide[si]) h = Math.max(h, e + wh * (1 - smoothstep(hw + 3.5, hw + 7, rd)));
      }
      this.h[k] = h;
    }
  }

  /** 牧道：沿线地形滑动平均后轻压（只削掉横坡），河槽和湖里不压 */
  private carveTrails(): void {
    const hw = MAP.trailHalfWidth;
    this.trailE = new Float32Array(this.h.length);
    for (const T of this.trails) {
      const raw = T.map(p => this.heightAt(p.x, p.z));
      T.forEach((p, i) => {
        let s = 0, n = 0;
        for (let k = Math.max(0, i - 5); k <= Math.min(raw.length - 1, i + 5); k++) { s += raw[k]; n++; }
        p.e = s / n;
      });
      this.stamp(T, hw + 2.6, (k, d, s, t) => {
        if (d < this.trailDist[k]) {
          this.trailDist[k] = d;
          this.trailE[k] = T[s].e + (T[Math.min(T.length - 1, s + 1)].e - T[s].e) * t;
        }
      });
    }
    for (let k = 0; k < this.h.length; k++) {
      const d = this.trailDist[k];
      if (d >= hw + 2.6 || this.riverDist[k] < 7 || this.roadDist[k] < MAP.roadHalfWidth + 1) continue;
      if (this.waterLevelAtIndex(k) > this.h[k]) continue;
      const w = d <= hw ? 0.85 : 0.85 * (1 - smoothstep(hw, hw + 2.6, d));
      this.h[k] += (this.trailE[k] - 0.04 - this.h[k]) * w;
    }
  }

  private computeWalls(): void {
    const hw = MAP.roadHalfWidth;
    const R = this.road;
    for (let i = 0; i < R.length - 1; i++) {
      const a = R[i], b = R[i + 1];
      if (!a.terrace) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, e = (a.e + b.e) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.04;
      const nx = -a.tz, nz = a.tx;
      const yaw = Math.atan2(a.tx, a.tz);
      for (const side of [1, -1]) {
        const hp = this.heightAt(mx + nx * side * (hw + 1.7), mz + nz * side * (hw + 1.7));
        const diff = hp - e;
        if (diff > 0.7) {
          this.walls.push({ x: mx + nx * side * (hw + 0.35), z: mz + nz * side * (hw + 0.35), yaw, len, bottom: e - 0.4, top: Math.min(hp + 0.15, e + 4.5), thick: 1.9, kind: 'cut' });
        } else if (diff < -0.8) {
          this.walls.push({ x: mx + nx * side * (hw + 0.2), z: mz + nz * side * (hw + 0.2), yaw, len, bottom: hp - 0.6, top: e + 0.6, thick: 0.6, kind: 'fill' });
        }
      }
    }
  }

  /** 天路 / 牧道与河的交点：木桥，桥面在河谷底上 0.3 m */
  private findBridges(): void {
    const S = this.river;
    const paths: { P: PathSample[]; road: boolean }[] = [{ P: this.road, road: true }, ...this.trails.map(P => ({ P, road: false }))];
    for (const { P, road } of paths) {
      for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < S.length - 1; j++) {
        const a = P[i], b = P[i + 1], c = S[j], d = S[j + 1];
        const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        this.bridges.push({
          x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(a.tx, a.tz),
          deckY: this.valleyFloor[j] + 0.3, len: 13, width: road ? 6.5 : 3.2, road,
        });
      }
    }
  }

  /** 网格三角形内插（与网格的三角化方向一致） */
  heightAt(x: number, z: number): number {
    const gx = Math.min(this.nx - 1.0001, Math.max(0, (x - this.minX) / this.step));
    const gz = Math.min(this.nz - 1.0001, Math.max(0, (z - this.minZ) / this.step));
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const ha = this.h[this.idx(i, j)], hb = this.h[this.idx(i + 1, j)];
    const hc = this.h[this.idx(i + 1, j + 1)], hd = this.h[this.idx(i, j + 1)];
    return fx >= fz ? ha + (hb - ha) * fx + (hc - hb) * fz : ha + (hc - hd) * fx + (hd - ha) * fz;
  }

  /** 坡度角（弧度），中心差分 */
  slopeAt(x: number, z: number): number {
    const e = 0.75;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(gx, gz));
  }

  /** 一块矩形地基下的最低地形高度（建筑用它落地，避免悬空） */
  footprintMin(x: number, z: number, hx: number, hz: number, yaw: number): number {
    let m = Infinity;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
      const lx = a * hx, lz = b * hz;
      m = Math.min(m, this.heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    return m;
  }

  roadNearest(x: number, z: number): { d: number; e: number; i: number } {
    let best = { d: Infinity, e: 0, i: 0 };
    for (let i = 0; i < this.road.length - 1; i++) {
      const a = this.road[i], b = this.road[i + 1];
      const { d, t } = segDist(x, z, a.x, a.z, b.x, b.z);
      if (d < best.d) best = { d, e: a.e + (b.e - a.e) * t, i };
    }
    return best;
  }

  /** 水面高度（湖或河）；没有水返回 −∞ */
  waterLevelAt(x: number, z: number): number {
    for (let n = 0; n < LAKES.length; n++) {
      const L = LAKES[n];
      const dx = x - L.x, dz = z - L.z, c = Math.cos(L.rot), s = Math.sin(L.rot);
      if (Math.hypot((dx * c + dz * s) / L.rx, (-dx * s + dz * c) / L.rz) < 1.15) return this.lakeLevel[n];
    }
    const gi = Math.round((x - this.minX) / this.step), gj = Math.round((z - this.minZ) / this.step);
    if (gi < 0 || gj < 0 || gi >= this.nx || gj >= this.nz) return -Infinity;
    const k = this.idx(gi, gj);
    if (this.riverDist[k] < RIVER.channelHalf + 2.2 && this.riverIdx[k] >= 0) return this.riverWater[Math.min(this.river.length - 1, this.riverIdx[k])];
    return -Infinity;
  }

  private waterLevelAtIndex(k: number): number {
    return this.waterLevelAt(this.X(k % this.nx), this.Z(Math.floor(k / this.nx)));
  }

  /** 水深（没有水为 0） */
  waterDepthAt(x: number, z: number): number {
    return Math.max(0, this.waterLevelAt(x, z) - this.heightAt(x, z));
  }

  private paint(): void {
    const hw = MAP.roadHalfWidth, tw = MAP.trailHalfWidth;
    const c = new THREE.Color(), tmp = new THREE.Color();
    const { nx, nz } = this;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      const x = this.X(i), z = this.Z(j);
      const h = this.h[k];
      const gx = (this.h[this.idx(Math.min(nx - 1, i + 1), j)] - this.h[this.idx(Math.max(0, i - 1), j)]) / 2;
      const gz = (this.h[this.idx(i, Math.min(nz - 1, j + 1))] - this.h[this.idx(i, Math.max(0, j - 1))]) / 2;
      const slope = Math.atan(Math.hypot(gx, gz));
      const dOut = this.basin[k];
      const n1 = fbm(x * 0.02, z * 0.02, 3, 11), n2 = fbm(x * 0.09, z * 0.09, 2, 12);
      // 草甸：大块冷暖变化 + 野花色斑
      c.copy(PAL.grassLush).lerp(PAL.grassYellow, smoothstep(0.42, 0.72, n1) * 0.85);
      c.lerp(PAL.grassDeep, smoothstep(0.55, 0.85, n2) * 0.45 + smoothstep(10, 50, dOut) * 0.25);
      c.lerp(PAL.flowerPink, smoothstep(0.66, 0.8, fbm(x * 0.06 + 40, z * 0.06, 2, 13)) * 0.32);
      c.lerp(PAL.flowerYellow, smoothstep(0.68, 0.82, fbm(x * 0.07 - 20, z * 0.07, 2, 14)) * 0.3);
      let grass = 1, dirt = 0;
      // 梯田
      for (const f of FIELDS) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.r) {
          const t = 1 - smoothstep(f.r * 0.7, f.r, d);
          const stripe = Math.sin((x - f.x + z - f.z) * 0.9) > 0 ? PAL.barley : PAL.barleyGreen;
          c.lerp(stripe, t * 0.85); grass *= 1 - t * 0.6; dirt = Math.max(dirt, t * 0.4);
        }
      }
      for (const s of DIRT_SPOTS) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < s.r) {
          const t = (1 - smoothstep(s.r * 0.35, s.r, d)) * (0.55 + 0.45 * n2);
          c.lerp(PAL.dirt, t * 0.8); grass *= 1 - t * 0.8; dirt = Math.max(dirt, t * 0.8);
        }
      }
      // 岩：陡坡、岩石露头、环山碎石坡
      let rock = smoothstep(0.72, 0.95, slope);
      if (slope > 0.5) rock = Math.max(rock, smoothstep(0.6, 0.74, fbm(x * 0.05 + 3, z * 0.05, 3, 18)) * smoothstep(0.5, 0.75, slope));
      if (dOut > 12) rock = Math.max(rock, smoothstep(0.64, 0.8, fbm(x * 0.04, z * 0.04, 3, 15)) * smoothstep(12, 35, dOut) * 0.85);
      if (rock > 0) {
        tmp.copy(PAL.rock).lerp(PAL.rockDark, smoothstep(0.4, 0.7, n2)).lerp(PAL.rockWarm, smoothstep(0.5, 0.8, n1) * 0.5);
        if (slope < 0.7) tmp.lerp(PAL.scree, 0.4);
        c.lerp(tmp, rock); grass *= 1 - rock;
      }
      // 雪：雪线以上、北坡更低；太陡的岩壁挂不住雪
      const north = clamp01(-gz * 0.5);
      const line = MAP.snowLine + (fbm(x * 0.012, z * 0.012, 3, 16) - 0.5) * 22 - north * 10;
      const snow = smoothstep(line - 3, line + 5, h) * (1 - smoothstep(0.9, 1.2, slope));
      if (snow > 0) {
        tmp.copy(PAL.snow).lerp(PAL.snowShade, smoothstep(0.5, 0.9, slope) * 0.8);
        c.lerp(tmp, snow); grass *= 1 - snow;
      }
      // 冰川：青白冰面 + 横向裂隙
      const ice = this.ice[k];
      if (ice > 0) {
        const crev = smoothstep(0.75, 0.95, Math.abs(Math.sin(z * 0.45 + fbm(x * 0.05, z * 0.05, 2, 19) * 6)));
        tmp.copy(PAL.ice).lerp(PAL.iceBlue, crev * 0.7 + smoothstep(0.6, 1, slope) * 0.3);
        c.lerp(tmp, ice); grass *= 1 - ice;
      }
      // 风神飞廉附近：地面被风刮出顺风的条纹（雪面上是白痕，草地上是露出的碎石），越近越明显
      const ws = windAt(x, z);
      if (ws.strength > 0.25) {
        const across = x * -ws.dz + z * ws.dx;
        const streak = smoothstep(0.55, 0.95, Math.sin(across * 1.1 + fbm(x * 0.08, z * 0.08, 2, 23) * 5) * 0.5 + 0.5);
        const kk = streak * smoothstep(0.25, 0.9, ws.strength) * 0.55;
        tmp.copy(snow > 0.3 || ice > 0.3 ? PAL.snow : PAL.scree);
        c.lerp(tmp, kk); grass *= 1 - kk * 0.8;
      }
      // 天路：车辙两道、路肩碎石
      const rd = this.roadDist[k];
      if (rd < hw + 1.4) {
        const edge = smoothstep(hw + 1.4, hw - 0.4, rd);
        tmp.copy(PAL.road).lerp(PAL.gravel, smoothstep(hw - 0.9, hw + 0.6, rd) * 0.7);
        tmp.lerp(PAL.rut, Math.max(0, 1 - Math.abs(rd - 1.15) / 0.38) * 0.55 * (0.6 + 0.4 * n2));
        c.lerp(tmp, edge); grass *= 1 - edge; dirt = Math.max(dirt, edge);
      }
      // 牧道：草里踩出来的土路，边缘不齐
      const td = this.trailDist[k];
      if (td < tw + 0.8) {
        const edge = smoothstep(tw + 0.8, tw - 0.5, td + (n2 - 0.5) * 0.8) * 0.85;
        c.lerp(PAL.trail, edge); grass *= 1 - edge * 0.9; dirt = Math.max(dirt, edge);
      }
      // 河床与湖
      const water = this.waterLevelAt(x, z);
      const rvd = this.riverDist[k];
      if (rvd < RIVER.channelHalf + 2.2) {
        const t = smoothstep(RIVER.channelHalf + 2.2, RIVER.channelHalf - 0.5, rvd);
        tmp.copy(PAL.bed).lerp(PAL.wet, smoothstep(RIVER.channelHalf, 0, rvd) * 0.6);
        c.lerp(tmp, t); grass *= 1 - t; dirt = Math.max(dirt, t);
      }
      if (water > -Infinity && rvd >= RIVER.channelHalf + 2.2) {
        const depth = water - h;
        if (depth > -0.6) {
          const t = smoothstep(-0.6, 0.2, depth);
          c.lerp(depth > 0.4 ? PAL.lakeBed : PAL.shore, t); grass *= 1 - t; dirt = Math.max(dirt, t);
        }
      }
      grass *= 1 - smoothstep(0.6, 0.85, slope);
      this.grass[k] = clamp01(grass);
      this.mat[k * 4] = clamp01(grass) + 0.05; this.mat[k * 4 + 1] = rock;
      this.mat[k * 4 + 2] = Math.max(snow, ice); this.mat[k * 4 + 3] = dirt;
      this.colors[k * 3] = c.r; this.colors[k * 3 + 1] = c.g; this.colors[k * 3 + 2] = c.b;
    }
  }

  /**
   * 地形网格切成 tile × tile 米的瓦片（共用顶点属性，只分索引），做视锥剔除；
   * 外圈再加 40 m 的下垂裙边，和外围远景地形接不严时不露缝。
   */
  buildTiles(tile = 96): THREE.BufferGeometry[] {
    const { nx, nz } = this;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      pos[k * 3] = this.X(i); pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = this.Z(j);
    }
    // 法线（与三角化无关的中心差分足够）
    const nrm = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      const gx = (this.h[this.idx(Math.min(nx - 1, i + 1), j)] - this.h[this.idx(Math.max(0, i - 1), j)]) / 2;
      const gz = (this.h[this.idx(i, Math.min(nz - 1, j + 1))] - this.h[this.idx(i, Math.max(0, j - 1))]) / 2;
      const l = Math.hypot(gx, 1, gz);
      nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -gz / l;
    }
    // 裙边顶点
    const ring: number[] = [];
    for (let i = 0; i < nx; i++) ring.push(this.idx(i, 0));
    for (let j = 1; j < nz; j++) ring.push(this.idx(nx - 1, j));
    for (let i = nx - 2; i >= 0; i--) ring.push(this.idx(i, nz - 1));
    for (let j = nz - 2; j > 0; j--) ring.push(this.idx(0, j));
    const base = nx * nz, total = base + ring.length;
    const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3), M = new Float32Array(total * 4);
    P.set(pos); N.set(nrm); C.set(this.colors); M.set(this.mat);
    ring.forEach((v, r) => {
      const o = (base + r) * 3;
      for (let q = 0; q < 3; q++) {
        P[o + q] = pos[v * 3 + q] - (q === 1 ? 40 : 0);
        N[o + q] = nrm[v * 3 + q];
        C[o + q] = this.colors[v * 3 + q] * 0.7;
      }
      for (let q = 0; q < 4; q++) M[(base + r) * 4 + q] = this.mat[v * 4 + q];
    });
    const posAttr = new THREE.BufferAttribute(P, 3), nrmAttr = new THREE.BufferAttribute(N, 3), colAttr = new THREE.BufferAttribute(C, 3);
    const matAttr = new THREE.BufferAttribute(M, 4);
    const out: THREE.BufferGeometry[] = [];
    const make = (index: number[], box: THREE.Box3): void => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr); g.setAttribute('normal', nrmAttr); g.setAttribute('color', colAttr); g.setAttribute('aMat', matAttr);
      g.setIndex(index);
      g.boundingBox = box;
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      out.push(g);
    };
    const tilesX = Math.ceil((nx - 1) / tile), tilesZ = Math.ceil((nz - 1) / tile);
    for (let tz = 0; tz < tilesZ; tz++) for (let tx = 0; tx < tilesX; tx++) {
      const index: number[] = [];
      const box = new THREE.Box3();
      const i0 = tx * tile, i1 = Math.min(nx - 1, i0 + tile), j0 = tz * tile, j1 = Math.min(nz - 1, j0 + tile);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const a = this.idx(i, j), b = this.idx(i + 1, j), cc = this.idx(i + 1, j + 1), d = this.idx(i, j + 1);
        index.push(a, cc, b, a, d, cc);
      }
      let lo = Infinity, hi = -Infinity;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = this.h[this.idx(i, j)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      box.min.set(this.X(i0), lo - 40, this.Z(j0)); box.max.set(this.X(i1), hi, this.Z(j1));
      make(index, box);
    }
    const skirt: number[] = [];
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r], b = ring[(r + 1) % ring.length], cc = base + r, d = base + ((r + 1) % ring.length);
      skirt.push(a, cc, b, b, cc, d);
    }
    make(skirt, new THREE.Box3(new THREE.Vector3(this.minX, -100, this.minZ), new THREE.Vector3(this.maxX, 300, this.maxZ)));
    return out;
  }

  /** 视线检查：沿线段步进，任何一点被地形挡住就算不可见（出了高度图就不再检查） */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return true;
      if (this.heightAt(x, z) > ay + (by - ay) * t) return false;
    }
    return true;
  }
}
