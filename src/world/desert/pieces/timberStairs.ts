import * as THREE from 'three';
import type { PieceRequest } from '../redo/compile';
import { buildTerrain } from '../whitebox/terrain';
import { WB_COLORS, type WhiteboxSpec } from '../whitebox/types';
import { WB_1_4 } from '../whitebox/maps/1-4';
import { WB_1_A } from '../whitebox/maps/1-A';
import { Kit, PAL, railing, stairRun, type RGB } from './timber';
import type { BuiltPiece, LabPiece, PieceContext, V2, V3 } from './types';

/**
 * 木栈梯 / 木栈道（通用）：白盒里 mat 'timber'、piece 有名字的坡道（折线 + 各顶点高度 + 半宽）照原样做成立在木柱上的木构：
 *   高度变的段 = 一跑梯（踏板骑在坡线上、两侧梯梁、斜 OBB 碰撞），高度不变的段 = 平台 / 栈道（木板面 + 边枋 + 搁栅，平 OBB 碰撞）；
 *   拐角处两段平台一段缩、一段伸，拼成方角平台不重叠。台面下面立柱落到 ctx.ground（地形不含这条坡道），高的加剪刀撑。
 *   扶手按「这条边外面是什么」逐段（≤ 3 m 一段）定：接着别的段 / 平地（高差 < 0.5）就敞开，贴着高出 1 m 以上的崖壁不用，其余都装勾栏。
 * 用在：1-A 贴崖木栈梯（两跑一平台，宽 8 m）、1-4 之字木栈道（三跑，宽 5 m）。
 */

export interface StairSpec {
  name: string;
  pts: V2[];
  hs: number[];
  half: number;
}

interface Seg {
  a: V2;
  b: V2;
  ha: number;
  hb: number;
  len: number;
  dir: V2;
  /** 右手侧（俯视，面朝前进方向） */
  lat: V2;
  /** 平台段往回伸（≤ 0）/ 到哪为止 */
  s0: number;
  s1: number;
  run: boolean;
}

function segments(req: StairSpec): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < req.pts.length - 1; i++) {
    const a = req.pts[i], b = req.pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    out.push({ a, b, ha: req.hs[i], hb: req.hs[i + 1], len, dir, lat: [-dir[1], dir[0]], s0: 0, s1: len, run: Math.abs(req.hs[i + 1] - req.hs[i]) > 0.05 });
  }
  // 拐角：前后两段都是平台且转了弯 → 前一段在拐点前 half 处截住，后一段往回伸 half，拼成方角
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1], q = out[i];
    if (p.run || q.run) continue;
    const turn = Math.abs(p.dir[0] * q.dir[1] - p.dir[1] * q.dir[0]);
    if (turn < 0.2) continue;
    p.s1 -= req.half;
    q.s0 -= req.half;
  }
  return out;
}

const hAt = (s: Seg, d: number): number => (s.run ? s.ha + (s.hb - s.ha) * Math.min(1, Math.max(0, d / s.len)) : s.ha);
const at = (s: Seg, d: number, l: number, y: number): V3 => [s.a[0] + s.dir[0] * d + s.lat[0] * l, y, s.a[1] + s.dir[1] * d + s.lat[1] * l];

/** 点 (x, z) 落在哪一段的板面上（返回那里的面高），都不在就 null */
function deckHeight(segs: Seg[], x: number, z: number, half: number, skip: number): number | null {
  for (let j = 0; j < segs.length; j++) {
    if (j === skip) continue;
    const s = segs[j], dx = x - s.a[0], dz = z - s.a[1];
    const d = dx * s.dir[0] + dz * s.dir[1], l = dx * s.lat[0] + dz * s.lat[1];
    if (d >= s.s0 - 0.05 && d <= s.s1 + 0.05 && Math.abs(l) <= half + 0.05) return hAt(s, d);
  }
  return null;
}

/**
 * 板面比白盒坡道高出的量：白盒里栈道下面常常垫着同高的沙埂（1-4 之字栈道），地形网格的线性插值在坡底的凹折处会顶出几厘米，
 * 板面整体抬 0.1 m 就不和地面打架；两头多出的 0.1 m 一级远小于能迈的 0.45 m。
 */
export const STAIR_LIFT = 0.1;

export function buildTimberStair(ctx: PieceContext, spec: StairSpec): BuiltPiece {
  const req: StairSpec = { ...spec, hs: spec.hs.map(h => h + STAIR_LIFT) };
  const kit = new Kit(ctx, req.name);
  const segs = segments(req);
  const half = req.half, W = half * 2;
  const name = req.name;

  /** 这一处边外要不要勾栏：p1 = 边外 0.5 m、p2 = 边外 2 m */
  const needsRail = (i: number, h: number, p1: [number, number], p2: [number, number]): boolean => {
    const other = deckHeight(segs, p1[0], p1[1], half, i);
    if (other !== null && Math.abs(other - h) < 0.6) return false;
    const g1 = ctx.ground(p1[0], p1[1]), g2 = ctx.ground(p2[0], p2[1]);
    if (g1 > h + 1.0) return false;
    if (Math.abs(g1 - h) < 0.5 && Math.abs(g2 - h) < 0.7) return false;
    return true;
  };
  /** 沿一条边（从 A 到 B，外法线 n）逐段定勾栏；hy(t) = t∈[0,1] 处的扶手基高 */
  const edgeRails = (i: number, A: [number, number], B: [number, number], n: [number, number], hy: (t: number) => number): void => {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 0.3) return;
    const k = Math.max(1, Math.ceil(len / 3));
    let runStart = -1;
    const flush = (t0: number, t1: number): void => {
      const pa: V3 = [A[0] + (B[0] - A[0]) * t0 - n[0] * 0.07, hy(t0), A[1] + (B[1] - A[1]) * t0 - n[1] * 0.07];
      const pb: V3 = [A[0] + (B[0] - A[0]) * t1 - n[0] * 0.07, hy(t1), A[1] + (B[1] - A[1]) * t1 - n[1] * 0.07];
      // 栈道 / 栈梯是素木栏杆（概念图里是风吹日晒的灰褐木，不是朱漆）
      railing(kit, pa, pb, { h: 1.05, col: PAL.weathered, panel: PAL.timberDark, cap: PAL.weathered, collide: `${name} 勾栏` });
    };
    for (let c = 0; c < k; c++) {
      const t = (c + 0.5) / k;
      const m: [number, number] = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      const rail = needsRail(i, hy(t), [m[0] + n[0] * 0.5, m[1] + n[1] * 0.5], [m[0] + n[0] * 2, m[1] + n[1] * 2]);
      if (rail && runStart < 0) runStart = c;
      if (!rail && runStart >= 0) {
        flush(runStart / k, c / k);
        runStart = -1;
      }
    }
    if (runStart >= 0) flush(runStart / k, 1);
  };

  segs.forEach((s, i) => {
    if (s.s1 - s.s0 < 0.02) return;
    if (s.run) {
      const up = s.hb > s.ha;
      const A = at(s, up ? 0 : s.len, 0, up ? s.ha : s.hb), B = at(s, up ? s.len : 0, 0, up ? s.hb : s.ha);
      stairRun(kit, A, B, { width: W, posts: true, collide: `${name} 梯段` });
      const D = Math.abs(s.hb - s.ha) / Math.max(2, Math.round(Math.abs(s.hb - s.ha) / 0.16));
      const hy = (t: number): number => hAt(s, s.len * t) + D / 2;
      for (const side of [1, -1] as const) {
        const A2 = at(s, 0, side * half, 0), B2 = at(s, s.len, side * half, 0);
        edgeRails(i, [A2[0], A2[2]], [B2[0], B2[2]], [s.lat[0] * side, s.lat[1] * side], hy);
      }
    } else {
      flatDeck(kit, s, half, `${name} 平台`);
      for (const side of [1, -1] as const) {
        const A2 = at(s, s.s0, side * half, 0), B2 = at(s, s.s1, side * half, 0);
        edgeRails(i, [A2[0], A2[2]], [B2[0], B2[2]], [s.lat[0] * side, s.lat[1] * side], () => s.ha);
      }
    }
    // 两头的边（拐角 / 起止）
    for (const end of [0, 1] as const) {
      const d = end === 0 ? s.s0 : s.s1, h = hAt(s, end === 0 ? 0 : s.len);
      const A2 = at(s, d, -half, 0), B2 = at(s, d, half, 0);
      const n: [number, number] = end === 0 ? [-s.dir[0], -s.dir[1]] : [s.dir[0], s.dir[1]];
      edgeRails(i, [A2[0], A2[2]], [B2[0], B2[2]], n, () => h + (s.run ? 0.08 : 0));
    }
  });
  return kit.build();
}

/** 一段平台 / 栈道：木板面（板横着铺）+ 两侧边枋 + 搁栅；下面立柱落地、高的加剪刀撑 */
function flatDeck(kit: Kit, s: Seg, half: number, name: string): void {
  const yaw = (Math.atan2(-s.dir[1], s.dir[0]) * 180) / Math.PI;
  const L = s.s1 - s.s0, mid = (s.s0 + s.s1) / 2, h = s.ha, th = 0.12, W = half * 2;
  const c = at(s, mid, 0, h - th / 2);
  kit.boxYaw(c, [L, th, W], yaw, PAL.plank, 'wood', { grain: 2, bottom: PAL.timberDark });
  for (const side of [1, -1]) kit.boxYaw(at(s, mid, side * (half - 0.08), h - th - 0.17), [L, 0.34, 0.16], yaw, PAL.beam);
  for (let d = s.s0 + 0.6; d < s.s1 - 0.3; d += 1.2) kit.boxYaw(at(s, d, 0, h - th - 0.12), [0.14, 0.24, W - 0.3], yaw, PAL.timberDark);
  kit.collide(at(s, mid, 0, h - 0.2), [L, 0.4, W], name, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (yaw * Math.PI) / 180));
  // 立柱：两侧 + 宽的再加中线
  const lines = W > 5.5 ? [-(half - 0.2), 0, half - 0.2] : [-(half - 0.2), half - 0.2];
  const ds: number[] = [];
  for (let d = s.s0 + 0.3; d <= s.s1 - 0.3 + 1e-6; d += Math.max(1.2, Math.min(2.4, (L - 0.6) / Math.max(1, Math.round((L - 0.6) / 2.4))))) ds.push(d);
  if (!ds.length) ds.push(mid);
  for (const d of ds) {
    const tops: number[] = [], bots: number[] = [];
    for (const l of lines) {
      const p = at(s, d, l, 0);
      const yTop = h - th - 0.34, yBot = kit.ctx.ground(p[0], p[2]);
      tops.push(yTop);
      bots.push(yBot);
      if (yTop - yBot < 0.3) continue;
      kit.box([p[0], (yTop + yBot - 0.3) / 2, p[2]], [0.22, yTop - yBot + 0.3, 0.22], PAL.beam, 'paint', { dust: 1 });
      if (yTop - yBot > 1.8) kit.collide([p[0], (yTop + yBot) / 2, p[2]], [0.22, yTop - yBot, 0.22], `${name} 柱`);
    }
    for (let k = 0; k + 1 < lines.length; k++) {
      const top = Math.min(tops[k], tops[k + 1]) - 0.15, bot = Math.max(bots[k], bots[k + 1]) + 0.35;
      if (top - bot < 1.2) continue;
      kit.beam(at(s, d, lines[k], bot), at(s, d, lines[k + 1], top), 0.09, 0.12, PAL.timberDark);
      kit.beam(at(s, d, lines[k], top), at(s, d, lines[k + 1], bot), 0.09, 0.12, PAL.timberDark);
    }
  }
}

// ───────────── 运行时 ─────────────

const fromReq = (req: PieceRequest): StairSpec => {
  if (req.kind !== 'stair') throw new Error(`[timberStairs] 要的是坡道件，拿到 ${req.kind}`);
  return { name: req.name, pts: req.pts, hs: req.hs, half: req.half };
};

export const REDO_BUILDERS: Record<string, (ctx: PieceContext, req: PieceRequest) => BuiltPiece> = {
  贴崖木栈梯: (ctx, req) => buildTimberStair(ctx, fromReq(req)),
  之字木栈道: (ctx, req) => buildTimberStair(ctx, fromReq(req)),
  木栈梯: (ctx, req) => buildTimberStair(ctx, fromReq(req)),
};

// ───────────── 检视页：从白盒取坡道 + 占位地形 ─────────────

/** 白盒里 piece = name 的坡道 */
export function stairFromWhitebox(spec: WhiteboxSpec, piece: string): StairSpec {
  for (const o of spec.terrain) if (o.op === 'ramp' && 'piece' in o && o.piece === piece) return { name: piece, pts: o.pts, hs: o.hs, half: o.half };
  throw new Error(`[timberStairs] ${spec.id} 里没有 ${piece}`);
}

/** 检视页的地面：白盒地形去掉由新件代替的坡道（和游戏编译时同一个做法） */
export function labGround(spec: WhiteboxSpec): (x: number, z: number) => number {
  const t = buildTerrain({ ...spec, terrain: spec.terrain.filter(o => !('piece' in o && o.piece)), blocks: [] });
  return (x, z) => t.groundAt(x, z);
}

/** 检视页占位地形（只在检视页建）：白盒地形的一块高度场，按白盒材质平涂（砂岩崖、窟檐台、沙） */
export function labTerrainPatch(spec: WhiteboxSpec, x0: number, x1: number, z0: number, z1: number, cell = 1): THREE.Mesh {
  const t = buildTerrain({ ...spec, terrain: spec.terrain.filter(o => !('piece' in o && o.piece)), blocks: [] });
  const nx = Math.round((x1 - x0) / cell) + 1, nz = Math.round((z1 - z0) / cell) + 1;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, y = t.groundAt(x, z);
    pos.push(x, y, z);
    const m = t.matAt(x, z);
    const base: RGB = m === 'rock' ? PAL.sandstone : (WB_COLORS[m] as unknown as RGB);
    c.setRGB(base[0], base[1], base[2], THREE.SRGBColorSpace);
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = '检视页占位地形';
  return mesh;
}

async function labStair(ctx: PieceContext, spec: WhiteboxSpec, piece: string, patch: [number, number, number, number]): Promise<BuiltPiece> {
  const req = stairFromWhitebox(spec, piece);
  const built = buildTimberStair({ ...ctx, ground: labGround(spec) }, req);
  built.object.add(labTerrainPatch(spec, ...patch));
  return built;
}

const A_STAIR = stairFromWhitebox(WB_1_A, '贴崖木栈梯');
const mid = (pts: V2[]): V2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const AC = mid(A_STAIR.pts);

export const LAB: LabPiece[] = [
  {
    id: 'cliff-stair',
    title: '贴崖木栈梯',
    note: '1-A 九层楼左侧：两跑一平台（0 → 4 → 8 m，宽 8 m），立在木柱上贴着窟檐层；检视页垫了白盒地形当崖',
    build: ctx => labStair(ctx, WB_1_A, '贴崖木栈梯', [AC[0] - 45, AC[0] + 45, AC[1] - 40, AC[1] + 30]),
    views: [
      { name: 'foot', eye: [A_STAIR.pts[0][0] + 9, 1.6, A_STAIR.pts[0][1] + 6], look: [A_STAIR.pts[1][0], 3, A_STAIR.pts[1][1]], fov: 65 },
      { name: 'on-lower', eye: [(A_STAIR.pts[0][0] + A_STAIR.pts[1][0]) / 2, 3.6, (A_STAIR.pts[0][1] + A_STAIR.pts[1][1]) / 2], look: [A_STAIR.pts[2][0], 4.5, A_STAIR.pts[2][1]], fov: 70 },
      { name: 'landing', eye: [A_STAIR.pts[2][0] + 1, 5.6, A_STAIR.pts[2][1] + 2], look: [A_STAIR.pts[5][0], 8, A_STAIR.pts[5][1]], fov: 70 },
      { name: 'mid', eye: [AC[0] + 10, 10, AC[1] + 38], look: [AC[0], 4, AC[1]], fov: 55 },
      { name: 'under', eye: [A_STAIR.pts[1][0] + 2, 1.6, A_STAIR.pts[1][1] + 6], look: [A_STAIR.pts[4][0], 3, A_STAIR.pts[4][1]], fov: 75 },
      { name: 'far', eye: [AC[0] + 40, 20, AC[1] + 110], look: [AC[0] + 10, 8, AC[1]], fov: 45 },
    ],
  },
  {
    id: 'zigzag-boardwalk',
    title: '之字木栈道',
    note: '1-4 西北观景台（16 m）三跑下到北岸，宽 5 m；检视页垫了白盒地形（沙山 + 栈道下的沙埂）',
    build: ctx => labStair(ctx, WB_1_4, '之字木栈道', [80, 135, 62, 112]),
    views: [
      { name: 'top', eye: [99, 17.6, 80], look: [118, 12, 86], fov: 70 },
      { name: 'side', eye: [112, 6, 118], look: [110, 8, 86], fov: 60 },
      { name: 'bottom', eye: [124, 1.6, 100], look: [108, 6, 88], fov: 65 },
      { name: 'far', eye: [150, 22, 140], look: [108, 8, 86], fov: 45 },
    ],
  },
];
