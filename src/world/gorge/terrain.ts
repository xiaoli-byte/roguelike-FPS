/**
 * 4-2 峡谷的高度场（docs/level-design/chuanzang-v1.md 第 3 节）。
 * 顺序：三条河的距离场 → 按岸地取横断面（两条河各算一次取低的，汇口之间自然隆起成山脊）→ 噪声与崖面纹理
 * → 平台（据点、桥头、溜索架）→ 凿骡道 → 给栈道让出位置 → 上色。
 * 每格记下属于哪块岸地、离哪条河最近、沿程多远，水面、涨水、平面图、自动验收都用它。
 */
import * as THREE from 'three';
import { HeightGrid } from '../plateau/grid';
import { fbm, ridged, smoothstep } from '../plateau/terrain';
import {
  BANK_RIVERS, EDGE_PINCH, E_CLIFF_TO_BENCH, FIELDS, FORD, MAP, PADS, PLANKS, PROFILES, RIVERS, SPANS, TRAILS,
  type BankId, type PathNode, type Profile, type RiverId, type V2,
} from './spec';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// ───────────────────────────── 河的中线 ─────────────────────────────

export interface RiverPath {
  id: RiverId; half: number; depth: number;
  x: Float32Array; z: Float32Array;
  /** 每段的包围盒（最近点搜索剪枝用） */
  bx0: Float32Array; bx1: Float32Array; bz0: Float32Array; bz1: Float32Array;
  /** 上一次查询的最近段（相邻格子的最近段几乎一样，从它开始找，剪枝更快） */
  hint: number;
  /** 每点沿程（米）与该点到下一点的单位方向 */
  s: Float32Array; tx: Float32Array; tz: Float32Array;
  length: number;
  water: [number, number];
}

function chaikin2(points: readonly V2[], iters: number): V2[] {
  let pts = points.map(p => [p[0], p[1]] as V2);
  for (let k = 0; k < iters; k++) {
    const out: V2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function riverPath(r: (typeof RIVERS)[number]): RiverPath {
  const pts = chaikin2(r.points, 2);
  const n = pts.length;
  const x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0]; z[i] = pts[i][1]; s[i] = acc;
    const j = Math.min(n - 1, i + 1), k = j === i ? i - 1 : i;
    const dx = pts[j][0] - pts[k][0], dz = pts[j][1] - pts[k][1], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
    if (i < n - 1) acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  const bx0 = new Float32Array(n), bx1 = new Float32Array(n), bz0 = new Float32Array(n), bz1 = new Float32Array(n);
  for (let i = 0; i < n - 1; i++) {
    bx0[i] = Math.min(x[i], x[i + 1]); bx1[i] = Math.max(x[i], x[i + 1]);
    bz0[i] = Math.min(z[i], z[i + 1]); bz1[i] = Math.max(z[i], z[i + 1]);
  }
  // 沿程：大渡河从汇口起算（桥、河滩的位置都按它）；两条支流从图外的上游起算
  return { id: r.id, half: r.half, depth: r.depth, x, z, bx0, bx1, bz0, bz1, hint: 0, s, tx, tz, length: acc, water: r.water };
}

export const PATHS: RiverPath[] = RIVERS.map(riverPath);
export const PATH: Record<RiverId, RiverPath> = { dj: PATHS[0], xj: PATHS[1], dd: PATHS[2] };

export interface Near { d: number; s: number; side: number; px: number; pz: number }

/** 点到河中线的最近点：距离、沿程、在哪一侧（顺水流方向右手为正） */
export function nearest(p: RiverPath, x: number, z: number, out: Near = { d: 0, s: 0, side: 0, px: 0, pz: 0 }): Near {
  let best = Infinity, bi = p.hint;
  const m = p.x.length - 1;
  for (let q = 0; q < m; q++) {
    const i = (p.hint + q) % m;
    const ex = Math.max(p.bx0[i] - x, 0, x - p.bx1[i]), ez = Math.max(p.bz0[i] - z, 0, z - p.bz1[i]);
    if (ex * ex + ez * ez >= best) continue;
    const ax = p.x[i], az = p.z[i], bx = p.x[i + 1], bz = p.z[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0;
    const cx = ax + dx * t, cz = az + dz * t;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 < best) {
      best = d2; bi = i;
      out.s = p.s[i] + t * (p.s[i + 1] - p.s[i]);
      out.side = dx * (z - az) - dz * (x - ax) >= 0 ? 1 : -1;
      out.px = cx; out.pz = cz;
    }
  }
  p.hint = bi;
  out.d = Math.sqrt(best);
  return out;
}

export function waterAt(p: RiverPath, s: number): number {
  return p.water[0] + (p.water[1] - p.water[0]) * (s / p.length);
}

/** 下游河滩的权重（只在大渡河上） */
export function fordWeight(s: number): number {
  return smoothstep(FORD.from - FORD.blend, FORD.from, s) * (1 - smoothstep(FORD.to, FORD.to + FORD.blend, s));
}

export function halfAt(p: RiverPath, s: number): number {
  return p.id === 'dd' ? p.half + (FORD.half - p.half) * fordWeight(s) : p.half;
}

// ───────────────────────────── 横断面 ─────────────────────────────

function knotsAt(knots: readonly V2[], d: number): { h: number; k: number } {
  if (d <= knots[0][0]) return { h: knots[0][1], k: 0 };
  for (let i = 0; i < knots.length - 1; i++) {
    const [d0, h0] = knots[i], [d1, h1] = knots[i + 1];
    if (d <= d1) return { h: h0 + (h1 - h0) * ((d - d0) / (d1 - d0)), k: (h1 - h0) / (d1 - d0) };
  }
  const [d0, h0] = knots[knots.length - 2], [d1, h1] = knots[knots.length - 1];
  const k = (h1 - h0) / (d1 - d0);
  return { h: h1 + k * (d - d1), k };
}

/** 岸地 bank 对河 river 的横断面（沿程 s 处），可能是两条断面按权重混合 */
function profilesFor(bank: BankId, river: RiverId, s: number): { a: Profile; b: Profile; w: number } {
  if (bank === 'N') return { a: PROFILES.N, b: PROFILES.N, w: 0 };
  if (bank === 'W') return river === 'dj' ? { a: PROFILES.W_dj, b: PROFILES.W_dj, w: 0 } : { a: PROFILES.W_dd, b: PROFILES.W_dd, w: 0 };
  if (river === 'xj') return { a: PROFILES.E_xj, b: PROFILES.E_xj, w: 0 };
  return { a: PROFILES.E_dd_cliff, b: PROFILES.E_dd_bench, w: smoothstep(E_CLIFF_TO_BENCH[0], E_CLIFF_TO_BENCH[1], s) };
}

/** 离地图边缘多近（图外为负） */
export function edgeDist(x: number, z: number): number {
  const B = MAP.bounds;
  return Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
}

export interface Macro {
  h: number; bank: BankId; river: RiverId; d: number; s: number; side: number;
  /** 离岸线多远（河槽内为负） */
  off: number;
  /** 最近那条河的水面与该处河槽半宽 */
  water: number; half: number;
  /** 到坡顶的有符号距离（坡内为负，含地图边缘） */
  bound: number;
  /** 横断面在这里的陡度（高 / 宽），> 1.2 大约就是崖 */
  steep: number;
}

const NEAR: Record<RiverId, Near> = { dj: { d: 0, s: 0, side: 0, px: 0, pz: 0 }, xj: { d: 0, s: 0, side: 0, px: 0, pz: 0 }, dd: { d: 0, s: 0, side: 0, px: 0, pz: 0 } };

/** 哪块岸地：看离哪条河最近、在它哪一侧 */
function bankOf(river: RiverId, side: number): BankId {
  if (river === 'dd') return side > 0 ? 'W' : 'E';
  if (river === 'dj') return side > 0 ? 'W' : 'N';
  return side > 0 ? 'N' : 'E';
}

/** 宏观地形（没有平台、骡道）：远景地形和自动验收也用它 */
export function macroAt(x: number, z: number): Macro {
  let river: RiverId = 'dd', best = Infinity;
  for (const p of PATHS) {
    const n = nearest(p, x, z, NEAR[p.id]);
    if (n.d < best) { best = n.d; river = p.id; }
  }
  const bank = bankOf(river, NEAR[river].side);
  let h = Infinity, bound = Infinity, steep = 0;
  for (const rid of BANK_RIVERS[bank]) {
    const n = NEAR[rid], P = PATH[rid];
    // 河流出图的地方横断面收紧（按河上的最近点算，整条横断面一起收，不会沿图框起一圈棱）
    const pinch = smoothstep(EDGE_PINCH, 0, edgeDist(n.px, n.pz));
    // 横断面从原河槽边量起（河滩段河槽变宽只影响河里，不把整面坡往外推）
    const half = halfAt(P, n.s), off = n.d - P.half;
    // 离河远了，高度不再跟着水面走：河一拐弯，远处的最近点会跳到另一段，水面高度跟着跳就会在坡上留一道棱
    const wl = waterAt(P, n.s) * (1 - smoothstep(30, 90, off));
    let rel: number, k = 0;
    if (n.d < half) {
      // 河槽：碗形河床；河滩段很浅，还有露出水面的卵石滩
      const f = rid === 'dd' ? fordWeight(n.s) : 0;
      const depth = P.depth + (FORD.depth - P.depth) * f;
      rel = -depth * Math.pow(1 - (n.d / half) ** 2, 0.6) + (fbm(x * 0.15, z * 0.15, 2, 3) - 0.5) * 0.9 * (1 - f);
      if (f > 0) rel += f * 1.25 * smoothstep(0.52, 0.74, fbm(x * 0.045 + 3, z * 0.03, 3, 4)) * smoothstep(0, 6, half - n.d);
    } else {
      const { a, b, w } = profilesFor(bank, rid, n.s);
      // 上下游地图边缘：河边的台地收窄、河谷收成深槽（坡脚 40 m 压成崖，再往外整体平移，保持单调）
      // 沿河的台地宽窄不一：按沿程的噪声把横断面整体拉宽 / 压窄（岸线本身不动）
      // （同样只在河边起作用，坡上不跟着沿程跳）
      const warp = 1 + 0.38 * (fbm(n.s * 0.011 + RIVER_INDEX[rid] * 7.3, 0.5, 2, 21) - 0.5) * smoothstep(2, 10, off) * (1 - smoothstep(50, 130, off));
      // 收紧只作用在河边：离河远了，最近点会在河的两段之间跳，收紧量跟着跳就会在坡上留一道陡棱
      const pk = pinch * (1 - smoothstep(40, 160, off));
      const o = off * warp + pk * (1.6 * Math.min(off, 40) + 10 * smoothstep(0, 8, off));
      const pa = knotsAt(a.knots, o), pb = knotsAt(b.knots, o);
      rel = pa.h + (pb.h - pa.h) * w;
      k = pa.k + (pb.k - pa.k) * w;
      // 下游河滩：岸边换成卵石滩和缓坡（和原断面取低的，坡上不受影响）
      const f = rid === 'dd' ? fordWeight(n.s) : 0;
      if (f > 0) {
        const pf = knotsAt(PROFILES.ford.knots, o);
        if (pf.h < rel) { rel += (pf.h - rel) * f; k += (pf.k - k) * f; }
      }
      const rim = a.rim + (b.rim - a.rim) * w;
      bound = Math.min(bound, o - rim);
    }
    const hh = wl + rel;
    if (hh < h) { h = hh; steep = k; }
    if (n.d < half) bound = Math.min(bound, off - 200);
  }
  const n = NEAR[river], P = PATH[river];
  const half = halfAt(P, n.s), off = n.d - half;
  // 噪声：岸边不动，越往坡上起伏越大；崖面加岩层纹理
  const up = smoothstep(20, 110, off), mid = smoothstep(6, 40, off);
  h += (fbm(x * 0.011, z * 0.011, 3, 7) - 0.5) * 16 * up + (fbm(x * 0.03, z * 0.03, 2, 8) - 0.5) * 4 * mid
    + (fbm(x * 0.06, z * 0.06, 2, 10) - 0.5) * 2.2 * up;
  const cliff = smoothstep(1.0, 2.4, steep);
  if (cliff > 0) h += (ridged(x * 0.07, z * 0.07, 2, 9) - 0.45) * 3.2 * cliff * mid;
  bound = Math.max(bound, MAP.edgeMargin - edgeDist(x, z));
  return { h, bank, river, d: n.d, s: n.s, side: n.side, off, water: waterAt(P, n.s), half, bound, steep };
}

// ───────────────────────────── 贴河节点 ─────────────────────────────

/** 岸地在河的哪一侧（nearest().side 的符号） */
const BANK_SIDE: Record<RiverId, Partial<Record<BankId, number>>> = { dd: { W: 1, E: -1 }, dj: { W: 1, N: -1 }, xj: { N: 1, E: -1 } };

/** 河 r 沿程 s 处的中线点与单位方向 */
export function riverAt(P: RiverPath, s: number): { x: number; z: number; tx: number; tz: number } {
  let i = 0;
  while (i < P.s.length - 2 && P.s[i + 1] < s) i++;
  const t = clamp01((s - P.s[i]) / Math.max(1e-6, P.s[i + 1] - P.s[i]));
  const x = P.x[i] + (P.x[i + 1] - P.x[i]) * t, z = P.z[i] + (P.z[i + 1] - P.z[i]) * t;
  const dx = P.x[i + 1] - P.x[i], dz = P.z[i + 1] - P.z[i], l = Math.hypot(dx, dz) || 1;
  return { x, z, tx: dx / l, tz: dz / l };
}

/**
 * 把路径节点换成 [x, z, y?]。贴河节点：岸线外 off 米；没给 off 的（栈道）沿横断面往外找，
 * 找到原地形刚好高过 y − 1 的地方——桥面一半悬在崖外，一半凿进崖里。
 */
export function resolveNode(n: PathNode): [number, number, number | undefined] {
  if (Array.isArray(n)) return [n[0], n[1], n[2]];
  const r = n as Exclude<PathNode, readonly number[]>;
  const P = PATH[r.r], c = riverAt(P, r.s), side = BANK_SIDE[r.r][r.bank] ?? 1;
  const nx = -c.tz * side, nz = c.tx * side, half = halfAt(P, r.s);
  let off = r.off;
  if (off === undefined) {
    off = 0;
    while (off < 80 && macroAt(c.x + nx * (half + off), c.z + nz * (half + off)).h < (r.y ?? 0) - 1) off += 0.25;
  }
  return [c.x + nx * (half + off), c.z + nz * (half + off), r.y];
}

// ───────────────────────────── 骡道 ─────────────────────────────

export interface TrailSample { x: number; z: number; y: number; s: number }

function chaikin3(points: readonly [number, number, number][], iters: number): [number, number, number][] {
  let pts = points.map(p => [...p] as [number, number, number]);
  for (let k = 0; k < iters; k++) {
    const out: [number, number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function resample3(pts: [number, number, number][], step: number): TrailSample[] {
  const out: TrailSample[] = [];
  let s = 0, carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, ay] = pts[i], [bx, bz, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: ay + (by - ay) * t, s: s + d });
      d += step;
    }
    carry = d - len;
    s += len;
  }
  const [lx, lz, ly] = pts[pts.length - 1];
  out.push({ x: lx, z: lz, y: ly, s });
  return out;
}

// ───────────────────────────── 地形 ─────────────────────────────

const PAL = {
  grassLush: new THREE.Color('#5d9a38'),
  grassSun: new THREE.Color('#a2a752'),
  grassDeep: new THREE.Color('#3d6f31'),
  barley: new THREE.Color('#c9b85c'),
  barleyGreen: new THREE.Color('#8fae46'),
  dirt: new THREE.Color('#8c7455'),
  trail: new THREE.Color('#9b815e'),
  rock: new THREE.Color('#8a8379'),
  rockDark: new THREE.Color('#5f5a54'),
  rockWarm: new THREE.Color('#957d63'),
  rockWet: new THREE.Color('#4c4a45'),
  scree: new THREE.Color('#a39b8f'),
  gravel: new THREE.Color('#b3a891'),
  sand: new THREE.Color('#c8bb9c'),
  bed: new THREE.Color('#6d695f'),
};

export const BANK_INDEX: Record<BankId, number> = { W: 0, N: 1, E: 2 };
export const RIVER_INDEX: Record<RiverId, number> = { dj: 0, xj: 1, dd: 2 };

export class GorgeTerrain extends HeightGrid {
  /** 每格：岸地（0 西 1 江嘴 2 东）、最近的河（0 大金川 1 小金川 2 大渡河）、沿程、离岸线多远 */
  readonly bank: Int8Array;
  readonly river: Int8Array;
  readonly riverS: Float32Array;
  readonly riverOff: Float32Array;
  readonly trails: { id: string; name: string; pts: TrailSample[] }[];
  /** 栈道：解析后的节点 [x, z, 桥面高度] */
  readonly planks: { id: string; name: string; pts: [number, number, number][]; breakable: [number, number][] }[];
  /** 涨水：所有河面统一抬高的米数（检视页的涨水演示改它） */
  flood = 0;
  private trailDist!: Float32Array;
  private readonly steep: Float32Array;

  constructor() {
    super(MAP.bounds);
    const n = this.nx * this.nz;
    this.bank = new Int8Array(n);
    this.river = new Int8Array(n);
    this.riverS = new Float32Array(n);
    this.riverOff = new Float32Array(n);
    this.steep = new Float32Array(n);
    this.generateMacro();
    this.planks = PLANKS.map(pl => ({
      id: pl.id, name: pl.name, breakable: pl.breakable ?? [],
      pts: pl.pts.map(n => { const [x, z, y] = resolveNode(n); return [x, z, y ?? this.heightAt(x, z)] as [number, number, number]; }),
    }));
    this.applyPads();
    this.trails = TRAILS.map(t => ({ id: t.id, name: t.name, pts: this.trailSamples(t.pts) }));
    this.carveTrails();
    this.notchPlanks();
    this.notchSpans();
    this.paint();
  }

  private generateMacro(): void {
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = this.idx(i, j);
      const m = macroAt(this.X(i), this.Z(j));
      this.h[k] = m.h;
      this.basin[k] = m.bound;
      this.bank[k] = BANK_INDEX[m.bank];
      this.river[k] = RIVER_INDEX[m.river];
      this.riverS[k] = m.s;
      this.riverOff[k] = m.off;
      this.steep[k] = m.steep;
    }
  }

  /** 平台：半径内压平到给定高度（没给就取中心的地形高度），外圈 fall 米内平滑接回去 */
  private applyPads(): void {
    for (const p of PADS) {
      const y = p.y ?? this.heightAt(p.x, p.z);
      const fall = p.fall ?? 6;
      const R = p.r + fall;
      this.forDisc(p.x, p.z, R, (k, d) => {
        const w = d <= p.r ? 1 : 1 - smoothstep(p.r, R, d);
        this.h[k] += (y - this.h[k]) * w;
      });
    }
  }

  private forDisc(cx: number, cz: number, R: number, fn: (k: number, d: number) => void): void {
    const i0 = Math.max(0, Math.floor(cx - R - this.minX)), i1 = Math.min(this.nx - 1, Math.ceil(cx + R - this.minX));
    const j0 = Math.max(0, Math.floor(cz - R - this.minZ)), j1 = Math.min(this.nz - 1, Math.ceil(cz + R - this.minZ));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(this.X(i) - cx, this.Z(j) - cz);
      if (d <= R) fn(this.idx(i, j), d);
    }
  }

  /** 骡道节点没给高度的，取（平台之后的）地形高度；割角平滑后每米一个采样 */
  private trailSamples(nodes: readonly PathNode[]): TrailSample[] {
    const pts = nodes.map(n => { const [x, z, y] = resolveNode(n); return [x, z, y ?? this.heightAt(x, z)] as [number, number, number]; });
    return resample3(chaikin3(pts, 2), 1);
  }

  /** 凿路：路面压到路的高度，两侧 3 m 内接回原地形（上坡一侧是凿出来的岩壁，下坡一侧是垫出来的路基） */
  private carveTrails(): void {
    const hw = MAP.trailHalfWidth, band = 3;
    const n = this.nx * this.nz;
    this.trailDist = new Float32Array(n).fill(Infinity);
    const trailY = new Float32Array(n);
    for (const T of this.trails) {
      const P = T.pts;
      for (let s = 0; s < P.length - 1; s++) {
        const a = P[s], b = P[s + 1];
        const R = hw + band;
        const i0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - R - this.minX)), i1 = Math.min(this.nx - 1, Math.ceil(Math.max(a.x, b.x) + R - this.minX));
        const j0 = Math.max(0, Math.floor(Math.min(a.z, b.z) - R - this.minZ)), j1 = Math.min(this.nz - 1, Math.ceil(Math.max(a.z, b.z) + R - this.minZ));
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = this.X(i), z = this.Z(j);
          const t = l2 > 0 ? clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2) : 0;
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          const k = this.idx(i, j);
          if (d < this.trailDist[k]) { this.trailDist[k] = d; trailY[k] = a.y + (b.y - a.y) * t; }
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const d = this.trailDist[k];
      if (d >= hw + band) continue;
      const w = d <= hw ? 1 : 1 - smoothstep(hw, hw + band, d);
      this.h[k] += (trailY[k] - 0.05 - this.h[k]) * w;
    }
  }

  /** 栈道下面的地形压到桥面以下，栈道不会埋进崖里（靠山一侧的崖照样立着）；两头 2.5 m 接地，不压 */
  private notchPlanks(): void {
    for (const pl of this.planks) {
      const [fx, fz] = pl.pts[0], [lx, lz] = pl.pts[pl.pts.length - 1];
      for (let i = 0; i < pl.pts.length - 1; i++) {
        const [ax, az, ay] = pl.pts[i], [bx, bz, by] = pl.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
          if (Math.hypot(x - fx, z - fz) < 2.5 || Math.hypot(x - lx, z - lz) < 2.5) continue;
          this.forDisc(x, z, 1.8, k => { this.h[k] = Math.min(this.h[k], y - 1.1); });
        }
      }
    }
  }

  /** 桥面下面的地形压到桥面以下（吊桥、铁索桥中间下垂，桥头那段不会埋进崖边）；两头 2.5 m 接地，不压 */
  private notchSpans(): void {
    for (const sp of SPANS) {
      const L = Math.hypot(sp.b[0] - sp.a[0], sp.b[2] - sp.a[2]);
      for (let d = 2.5; d <= L - 2.5; d += 0.7) {
        const t = d / L;
        const x = sp.a[0] + (sp.b[0] - sp.a[0]) * t, z = sp.a[2] + (sp.b[2] - sp.a[2]) * t;
        const y = sp.a[1] + (sp.b[1] - sp.a[1]) * t - sp.sag * 4 * t * (1 - t);
        this.forDisc(x, z, sp.width / 2 + 1, k => { this.h[k] = Math.min(this.h[k], y - 0.7); });
      }
    }
  }

  /** 水面高度（河，含涨水）；没有水返回 −∞ */
  waterLevelAt(x: number, z: number): number {
    const gi = Math.round((x - this.minX) / this.step), gj = Math.round((z - this.minZ) / this.step);
    if (gi < 0 || gj < 0 || gi >= this.nx || gj >= this.nz) return -Infinity;
    const k = this.idx(gi, gj);
    if (this.riverOff[k] > 2.5 + this.flood * 1.5) return -Infinity;
    const P = PATHS[this.river[k]];
    return waterAt(P, this.riverS[k]) + this.flood;
  }

  /** 正常水位（不含涨水） */
  baseWaterAt(x: number, z: number): number {
    const gi = Math.round((x - this.minX) / this.step), gj = Math.round((z - this.minZ) / this.step);
    const k = this.idx(Math.max(0, Math.min(this.nx - 1, gi)), Math.max(0, Math.min(this.nz - 1, gj)));
    return waterAt(PATHS[this.river[k]], this.riverS[k]);
  }

  /** 离最近骡道多远（地标避开路面用） */
  roadNearest(x: number, z: number): { d: number } {
    const gi = Math.round((x - this.minX) / this.step), gj = Math.round((z - this.minZ) / this.step);
    if (gi < 0 || gj < 0 || gi >= this.nx || gj >= this.nz) return { d: Infinity };
    return { d: this.trailDist[this.idx(gi, gj)] };
  }

  /** 这一格属于哪块岸地、在第几层（L0 河面 / L1 中层 / L2 高台 / L3 坡顶），按比水面高多少分 */
  layerAt(x: number, z: number): { bank: BankId; layer: 0 | 1 | 2 | 3 } {
    const gi = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.minX) / this.step)));
    const gj = Math.max(0, Math.min(this.nz - 1, Math.round((z - this.minZ) / this.step)));
    const k = this.idx(gi, gj);
    const rel = this.h[k] - waterAt(PATHS[this.river[k]], this.riverS[k]);
    const bank = (['W', 'N', 'E'] as const)[this.bank[k]];
    return { bank, layer: rel < 8 ? 0 : rel < 32 ? 1 : rel < 64 ? 2 : 3 };
  }

  private paint(): void {
    const hw = MAP.trailHalfWidth;
    const c = new THREE.Color(), tmp = new THREE.Color();
    const { nx, nz } = this;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      const x = this.X(i), z = this.Z(j);
      const h = this.h[k];
      const gx = (this.h[this.idx(Math.min(nx - 1, i + 1), j)] - this.h[this.idx(Math.max(0, i - 1), j)]) / 2;
      const gz = (this.h[this.idx(i, Math.min(nz - 1, j + 1))] - this.h[this.idx(i, Math.max(0, j - 1))]) / 2;
      const slope = Math.atan(Math.hypot(gx, gz));
      const P = PATHS[this.river[k]];
      const wl = waterAt(P, this.riverS[k]);
      const rel = h - wl, off = this.riverOff[k];
      const n1 = fbm(x * 0.02, z * 0.02, 3, 11), n2 = fbm(x * 0.09, z * 0.09, 2, 12);
      const bank = this.bank[k];
      // 草：西岸向阳偏黄，东岸背阴偏深；越高越干
      c.copy(PAL.grassLush).lerp(PAL.grassSun, (bank === 0 ? 0.45 : 0.15) * smoothstep(0.35, 0.75, n1) + smoothstep(50, 90, rel) * 0.35);
      c.lerp(PAL.grassDeep, smoothstep(0.55, 0.85, n2) * 0.4 + (bank === 2 ? 0.25 : 0));
      let grass = 1, dirt = 0;
      // 甲居寨坡的青稞梯田：沿等高线的条带
      for (const f of FIELDS) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.r) {
          const t = 1 - smoothstep(f.r * 0.7, f.r, d);
          const stripe = Math.sin(h * 1.4) > 0 ? PAL.barley : PAL.barleyGreen;
          c.lerp(stripe, t * 0.8 * (slope < 0.6 ? 1 : 0.3)); grass *= 1 - t * 0.6; dirt = Math.max(dirt, t * 0.3);
        }
      }
      // 岩：陡坡、崖面
      let rock = smoothstep(0.62, 0.9, slope);
      if (slope > 0.45) rock = Math.max(rock, smoothstep(0.6, 0.74, fbm(x * 0.05 + 3, z * 0.05, 3, 18)) * smoothstep(0.45, 0.7, slope));
      if (this.basin[k] > 10) rock = Math.max(rock, smoothstep(0.62, 0.8, fbm(x * 0.04, z * 0.04, 3, 15)) * 0.7);
      if (rock > 0) {
        tmp.copy(PAL.rock).lerp(PAL.rockDark, smoothstep(0.4, 0.7, n2)).lerp(PAL.rockWarm, smoothstep(0.5, 0.8, n1) * 0.5);
        // 崖脚常年被水打湿，颜色发暗
        tmp.lerp(PAL.rockWet, (1 - smoothstep(1.5, 6, rel)) * 0.7);
        if (slope < 0.7) tmp.lerp(PAL.scree, 0.35);
        c.lerp(tmp, rock); grass *= 1 - rock;
      }
      // 河岸：卵石、河滩上的沙洲
      if (off < 5 && rel < 3.5) {
        const t = smoothstep(5, 1, off) * (1 - smoothstep(1.5, 3.5, rel));
        tmp.copy(PAL.gravel).lerp(PAL.sand, smoothstep(0.4, 0.7, n2) * 0.6);
        c.lerp(tmp, t); grass *= 1 - t; dirt = Math.max(dirt, t);
      }
      if (off < 0) {
        const t = smoothstep(0, -2, off);
        c.lerp(rel > -0.2 ? PAL.sand : PAL.bed, t); grass *= 1 - t; dirt = Math.max(dirt, t);
      }
      // 平台：踩出来的土地面
      for (const p of PADS) {
        if (!p.dirt) continue;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r + 2) {
          const t = (1 - smoothstep(p.r * 0.5, p.r + 2, d)) * (0.6 + 0.4 * n2);
          c.lerp(PAL.dirt, t * 0.75); grass *= 1 - t * 0.75; dirt = Math.max(dirt, t * 0.7);
        }
      }
      // 骡道
      const td = this.trailDist[k];
      if (td < hw + 0.8) {
        const edge = smoothstep(hw + 0.8, hw - 0.5, td + (n2 - 0.5) * 0.8) * 0.85;
        c.lerp(PAL.trail, edge); grass *= 1 - edge * 0.9; dirt = Math.max(dirt, edge);
      }
      grass *= 1 - smoothstep(0.6, 0.85, slope);
      this.grass[k] = clamp01(grass);
      this.mat[k * 4] = clamp01(grass) + 0.05; this.mat[k * 4 + 1] = rock;
      this.mat[k * 4 + 2] = 0; this.mat[k * 4 + 3] = dirt;
      this.colors[k * 3] = c.r; this.colors[k * 3 + 1] = c.g; this.colors[k * 3 + 2] = c.b;
    }
  }
}
