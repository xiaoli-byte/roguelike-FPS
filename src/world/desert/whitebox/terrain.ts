import { WB_METRICS, type TerrainOp, type V2, type WbBlock, type WbMat, type WhiteboxSpec } from './types';

/**
 * 白盒地形：把规格里的图章按顺序盖到一张 0.5 m 的高度场上，再把实心体块的顶面压进「行走面」。
 * 纯数据（不依赖 three），node 里直接跑：探针、测试和检视页用的是同一份结果。
 */
export const WB_MATS: WbMat[] = ['sand', 'dune', 'gravel', 'road', 'mud', 'rock', 'earth', 'timber', 'roof', 'stone', 'water', 'plant'];

export interface ResolvedBlock extends WbBlock {
  /** 底面 / 顶面的绝对高度 */
  y0: number;
  y1: number;
}

export interface WbTerrain {
  spec: WhiteboxSpec;
  cell: number;
  nx: number;
  nz: number;
  /** 地形高度（不含体块），行优先：i = iz * nx + ix */
  ground: Float32Array;
  /** 行走面 = 地形 + 实心体块顶面 */
  walk: Float32Array;
  /** 地形材质（WB_MATS 的下标） */
  mat: Uint8Array;
  blocks: ResolvedBlock[];
  groundAt(x: number, z: number): number;
  walkAt(x: number, z: number): number;
  matAt(x: number, z: number): WbMat;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number): number => {
  if (a === b) return v < a ? 0 : 1;
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash(ix, iz, seed), hash(ix + 1, iz, seed), ux), lerp(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), ux), uz);
}

/** 三层分形噪声，0..1 */
export function fbm(x: number, z: number, seed = 1): number {
  return (valueNoise(x, z, seed) + valueNoise(x * 2.03, z * 2.03, seed + 17) * 0.5 + valueNoise(x * 4.1, z * 4.1, seed + 41) * 0.25) / 1.75;
}

interface Nearest {
  /** 到折线的距离 */
  d: number;
  /** 最近点处的弧长 */
  s: number;
  /** > 0 = 在折线前进方向的右侧（俯视，北在上） */
  cross: number;
  /** 最近点落在首段起点之前 / 末段终点之后（坡道据此把两头切平） */
  beyond: boolean;
}

const _near: Nearest = { d: 0, s: 0, cross: 0, beyond: false };

function nearestOnPolyline(px: number, pz: number, pts: V2[], lens: number[]): Nearest {
  let best = Infinity, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az, len = lens[i];
    const raw = len > 0 ? ((px - ax) * dx + (pz - az) * dz) / (len * len) : 0;
    const t = clamp01(raw);
    const qx = ax + dx * t, qz = az + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < best) {
      best = d;
      _near.d = d;
      _near.s = acc + len * t;
      _near.cross = dx * (pz - az) - dz * (px - ax);
      _near.beyond = (i === 0 && raw < 0) || (i === pts.length - 2 && raw > 1);
    }
    acc += len;
  }
  return _near;
}

function segmentLengths(pts: V2[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  return out;
}

/** 沿弧长在各顶点的值之间线性插值 */
function alongVertices(values: number[], lens: number[], s: number): number {
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (s <= acc + lens[i] || i === lens.length - 1) return lerp(values[i], values[i + 1], lens[i] > 0 ? clamp01((s - acc) / lens[i]) : 0);
    acc += lens[i];
  }
  return values[values.length - 1];
}

export function pointInPolygon(px: number, pz: number, pts: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 到多边形边界的有符号距离（内部为负） */
function polygonDistance(px: number, pz: number, pts: V2[]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0], az = pts[j][1], dx = pts[i][0] - ax, dz = pts[i][1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / len2) : 0;
    best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
  }
  return pointInPolygon(px, pz, pts) ? -best : best;
}

function bounds(pts: V2[], margin: number): [number, number, number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return [x0 - margin, x1 + margin, z0 - margin, z1 + margin];
}

export function buildTerrain(spec: WhiteboxSpec): WbTerrain {
  const cell = WB_METRICS.cell;
  const nx = Math.round(spec.size[0] / cell) + 1, nz = Math.round(spec.size[1] / cell) + 1;
  const ground = new Float32Array(nx * nz);
  const mat = new Uint8Array(nx * nz);
  const matIndex = (m: WbMat): number => WB_MATS.indexOf(m);

  /** 在包围盒里逐格跑 fn(x, z, i) */
  const each = (box: [number, number, number, number], fn: (x: number, z: number, i: number) => void): void => {
    const ix0 = Math.max(0, Math.floor(box[0] / cell)), ix1 = Math.min(nx - 1, Math.ceil(box[1] / cell));
    const iz0 = Math.max(0, Math.floor(box[2] / cell)), iz1 = Math.min(nz - 1, Math.ceil(box[3] / cell));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) fn(ix * cell, iz * cell, iz * nx + ix);
  };
  const all: [number, number, number, number] = [0, spec.size[0], 0, spec.size[1]];
  const combine = (mode: 'set' | 'max' | 'min' | 'add' | undefined, old: number, target: number): number =>
    mode === 'max' ? Math.max(old, target) : mode === 'min' ? Math.min(old, target) : mode === 'add' ? old + target : target;

  const apply = (o: TerrainOp): void => {
    switch (o.op) {
      case 'base': {
        ground.fill(o.h);
        if (o.mat) mat.fill(matIndex(o.mat));
        break;
      }
      case 'noise': {
        const seed = o.seed ?? 7;
        each(all, (x, z, i) => {
          let k = 1;
          for (const c of o.keep ?? []) k = Math.min(k, smoothstep(c.r, c.r + 10, Math.hypot(x - c.at[0], z - c.at[1])));
          ground[i] += (fbm(x / o.scale, z / o.scale, seed) - 0.5) * o.amp * k;
        });
        break;
      }
      case 'ridge': {
        const lens = segmentLengths(o.pts), total = lens.reduce((a, b) => a + b, 0);
        const hs = typeof o.h === 'number' ? o.pts.map(() => o.h as number) : o.h;
        const hMax = Math.max(...hs), taper = o.taper ?? Math.min(24, total * 0.25), base = o.base ?? 0;
        const slipMax = o.slip ?? hMax * 1.6;
        const m = o.mat ? matIndex(o.mat) : -1;
        each(bounds(o.pts, Math.max(o.stoss, slipMax) + 2), (x, z, i) => {
          const n = nearestOnPolyline(x, z, o.pts, lens);
          const h = alongVertices(hs, lens, n.s) * smoothstep(0, taper, n.s) * smoothstep(0, taper, total - n.s);
          if (h <= 0.01) return;
          const signed = (n.cross >= 0 ? 1 : -1) * o.side * n.d;
          let f: number;
          if (signed >= 0) f = Math.max(0, 1 - signed / (o.slip ?? h * 1.6));
          else {
            const u = 1 + signed / o.stoss;
            f = u <= 0 ? 0 : u * (2 - u);
          }
          if (f <= 0) return;
          ground[i] = o.mode === 'add' ? ground[i] + h * f : Math.max(ground[i], base + h * f);
          if (m >= 0 && h * f > 0.4) mat[i] = m;
        });
        break;
      }
      case 'mound': {
        const rot = (o.rot ?? 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
        const shape = o.shape ?? 'dome', flat = o.flat ?? (shape === 'mesa' ? 0.7 : 0.5), base = o.base ?? 0;
        const m = o.mat ? matIndex(o.mat) : -1;
        const reach = Math.max(o.r[0], o.r[1]) + 1;
        each([o.at[0] - reach, o.at[0] + reach, o.at[1] - reach, o.at[1] + reach], (x, z, i) => {
          const dx = x - o.at[0], dz = z - o.at[1];
          const u = dx * c - dz * s, v = dx * s + dz * c;
          let f: number;
          if (shape === 'yardang') {
            // 鲸背：迎风头（长轴负方向）钝，背风尾拖长、越往后越低
            const ru = u < 0 ? o.r[0] * 0.4 : o.r[0];
            const q = Math.hypot(u / ru, v / o.r[1]);
            if (q >= 1) return;
            f = (1 - smoothstep(flat, 1, q)) * (u > 0 ? 1 - 0.55 * Math.pow(u / o.r[0], 1.5) : 1);
          } else {
            const q = Math.hypot(u / o.r[0], v / o.r[1]);
            if (q >= 1) return;
            f = shape === 'mesa' ? 1 - smoothstep(flat, 1, q) : Math.cos(q * Math.PI) * 0.5 + 0.5;
          }
          ground[i] = combine(o.mode ?? 'max', ground[i], o.mode === 'add' ? o.h * f : base + o.h * f);
          if (m >= 0 && f > 0.15) mat[i] = m;
        });
        break;
      }
      case 'poly':
      case 'disc': {
        const m = o.mat ? matIndex(o.mat) : -1;
        const box: [number, number, number, number] = o.op === 'poly' ? bounds(o.pts, o.edge + 1)
          : [o.at[0] - o.r - o.edge - 1, o.at[0] + o.r + o.edge + 1, o.at[1] - o.r - o.edge - 1, o.at[1] + o.r + o.edge + 1];
        each(box, (x, z, i) => {
          const sd = o.op === 'poly' ? polygonDistance(x, z, o.pts) : Math.hypot(x - o.at[0], z - o.at[1]) - o.r;
          const w = sd <= 0 ? 1 : o.edge > 0 ? 1 - smoothstep(0, o.edge, sd) : 0;
          if (w <= 0) return;
          ground[i] = combine(o.mode, ground[i], lerp(ground[i], o.h, w));
          if (m >= 0 && w > 0.5) mat[i] = m;
        });
        break;
      }
      case 'channel': {
        const lens = segmentLengths(o.pts);
        const m = o.mat ? matIndex(o.mat) : -1;
        each(bounds(o.pts, o.half + o.bank + 1), (x, z, i) => {
          const n = nearestOnPolyline(x, z, o.pts, lens);
          const w = 1 - smoothstep(o.half, o.half + o.bank, n.d);
          if (w <= 0) return;
          ground[i] = Math.min(ground[i], lerp(ground[i], o.h, w));
          if (m >= 0 && n.d < o.half + o.bank * 0.35) mat[i] = m;
        });
        break;
      }
      case 'ramp': {
        const lens = segmentLengths(o.pts), edge = o.edge ?? 0;
        const m = o.mat ? matIndex(o.mat) : -1;
        each(bounds(o.pts, o.half + edge + 1), (x, z, i) => {
          const n = nearestOnPolyline(x, z, o.pts, lens);
          if (n.beyond || n.d > o.half + edge) return;
          const w = n.d <= o.half ? 1 : 1 - smoothstep(o.half, o.half + edge, n.d);
          ground[i] = combine(o.mode ?? 'set', ground[i], lerp(ground[i], alongVertices(o.hs, lens, n.s), w));
          if (m >= 0 && n.d <= o.half) mat[i] = m;
        });
        break;
      }
      case 'paint': {
        const m = matIndex(o.mat);
        if (o.at && o.r !== undefined) {
          const at = o.at, r = o.r;
          each([at[0] - r, at[0] + r, at[1] - r, at[1] + r], (x, z, i) => { if (Math.hypot(x - at[0], z - at[1]) <= r) mat[i] = m; });
        } else if (o.pts && o.closed) {
          const pts = o.pts;
          each(bounds(pts, 1), (x, z, i) => { if (pointInPolygon(x, z, pts)) mat[i] = m; });
        } else if (o.pts) {
          const pts = o.pts, lens = segmentLengths(pts), half = o.half ?? 2;
          each(bounds(pts, half + 1), (x, z, i) => { if (nearestOnPolyline(x, z, pts, lens).d <= half) mat[i] = m; });
        }
        break;
      }
    }
  };
  for (const o of spec.terrain) apply(o);

  const sample = (field: Float32Array, x: number, z: number): number => {
    const fx = Math.min(nx - 1, Math.max(0, x / cell)), fz = Math.min(nz - 1, Math.max(0, z / cell));
    const ix = Math.min(nx - 2, Math.floor(fx)), iz = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - ix, tz = fz - iz, i = iz * nx + ix;
    return lerp(lerp(field[i], field[i + 1], tx), lerp(field[i + nx], field[i + nx + 1], tx), tz);
  };

  // 体块：实心的把顶面压进行走面；悬空的（canopy）只留给画面
  const walk = ground.slice();
  const blocks: ResolvedBlock[] = [];
  for (const b of spec.blocks) {
    const rot = (b.rot ?? 0) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    const reach = b.kind === 'cyl' ? b.size[0] : Math.hypot(b.size[0], b.size[1]) / 2;
    const y1 = b.top ?? sample(ground, b.at[0], b.at[1]) + (b.h ?? 1);
    let low = Infinity;
    const cells: number[] = [];
    each([b.at[0] - reach, b.at[0] + reach, b.at[1] - reach, b.at[1] + reach], (x, z, i) => {
      const dx = x - b.at[0], dz = z - b.at[1];
      const inside = b.kind === 'cyl' ? Math.hypot(dx, dz) <= b.size[0]
        : Math.abs(dx * c - dz * s) <= b.size[0] / 2 && Math.abs(dx * s + dz * c) <= b.size[1] / 2;
      if (!inside) return;
      cells.push(i);
      low = Math.min(low, ground[i]);
    });
    if (!Number.isFinite(low)) low = sample(ground, b.at[0], b.at[1]);
    if (!b.canopy) for (const i of cells) walk[i] = Math.max(walk[i], y1);
    blocks.push({ ...b, y0: b.canopy ? b.clear ?? y1 - 0.6 : low - 0.6, y1 });
  }

  return {
    spec, cell, nx, nz, ground, walk, mat, blocks,
    groundAt: (x, z) => sample(ground, x, z),
    walkAt: (x, z) => sample(walk, x, z),
    matAt: (x, z) => WB_MATS[mat[Math.min(nz - 1, Math.max(0, Math.round(z / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.round(x / cell)))]],
  };
}

/** 朝太阳的单位向量（azimuth 从北顺时针，北 = −z） */
export function sunVector(spec: WhiteboxSpec): [number, number, number] {
  const az = spec.sun.azimuth * Math.PI / 180, el = spec.sun.elevation * Math.PI / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** 规格里所有点位（出生 / 据点 / 驻守 / 入场 / 藏宝 / 出口 / 其它），带类别 */
export function allSites(spec: WhiteboxSpec): { kind: string; site: WhiteboxSpec['spawn'] | WhiteboxSpec['exit'] }[] {
  return [
    { kind: 'spawn', site: spec.spawn },
    ...spec.strongholds.map(site => ({ kind: 'stronghold', site })),
    ...spec.guards.map(site => ({ kind: 'guard', site })),
    ...spec.entries.map(site => ({ kind: 'entry', site })),
    ...spec.caches.map(site => ({ kind: 'cache', site })),
    { kind: 'exit', site: spec.exit },
    ...(spec.extras ?? []).map(site => ({ kind: site.kind, site })),
  ];
}
