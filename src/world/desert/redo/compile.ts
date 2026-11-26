import type { UnityEncounter, UnityMonsterEntry, UnityRenderer, UnitySceneDocument } from '../../UnityLevelLibrary';
import type { MechanismBase, SceneMechanisms } from '../../mechanisms/MechanismData';
import { WB_ASSETS } from '../whitebox/assets';
import { buildTerrain, fbm, pointInPolygon, type ResolvedBlock, type WbTerrain } from '../whitebox/terrain';
import { WhiteboxProbe, probeWhitebox, type ProbeReport } from '../whitebox/probe';
import { WB_METRICS, type TerrainOp, type V2, type WbBlock, type WbMat, type WbSite, type WhiteboxSpec } from '../whitebox/types';
import { REDO_MAPS, type RedoMapConfig } from './maps';
import { PLAY, type MapPlay, type PlayEncounter } from './play';
import { applyDesertLight } from '../document';
import type { DesertLight } from '../spec';

/**
 * 第一章重做：白盒 → 游戏的场景文档（UnitySceneDocument）。纯数据，node 里也能跑（测试 / 离线检查用）。
 * 游戏的所有玩法系统（据点波次、入场点、藏宝、出口、首领、碰撞、导航、机关）读的都是这份文档，
 * 所以把白盒编成同一种格式；玩法数据（波次编制、奖励、先后关系、调色）读 play.ts（2026-11-26 从 Unity 导出一次性搬来，
 * 用户：「以后unity是要删除的」——编译不再读 public/assets/unity-levels 的任何东西），按据点名对上，版面全是白盒的：
 *   - 地形：白盒地面（不含体块、不含由新件代替的坡道）+ 图外一圈续出来的沙丘 → 一张 1025² 的高度场；材质 → 旧地形的四层贴图权重；
 *   - 体块：标了 asset 的换成 public/assets/props 里的已有件（按体块的真实尺寸缩放、连排），碰撞用体块本身（简化形状）；
 *     标了 needs 的是新做的件（src/world/desert/pieces/），运行时建好再把它们的碰撞并进来；
 *   - 导航网格：探针的行走面按 1 m 网格三角化（离墙 ≥ 0.45 m、从出生点走得到、相邻点高差迈得过去）；
 *   - 点位：出生、据点（波次按名字搬旧场景的）、驻守点（旧场景的小遭遇）、入场点、藏宝、出口、补给营、首领。
 * 坐标：白盒的 x 向东、z 向南就是网页坐标，原样用。
 */

export type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Collider = UnitySceneDocument['colliders'][number];

/** 图外续多宽（m） */
export const MARGIN = 120;
/** 高度场分辨率（同旧场景 1025²） */
export const FIELD_N = 1025;

/** 运行时要建的新件 */
export type PieceRequest =
  | { kind: 'poplars'; trees: { at: V2; y: number; height: number; seed: number }[]; tint: 'green' | 'gold' }
  | { kind: 'deadPoplars'; trees: { at: V2; y: number; height: number; seed: number }[] }
  | { kind: 'camelBones'; at: V2; y: number; rot: number }
  | { kind: 'named'; name: string }
  | { kind: 'stair'; name: string; pts: V2[]; hs: number[]; half: number };

export interface CompiledMap {
  doc: UnitySceneDocument;
  spec: WhiteboxSpec;
  config: RedoMapConfig;
  /** 白盒地形（含全部图章、体块顶面：探针 / 导航用） */
  terrain: WbTerrain;
  probe: WhiteboxProbe;
  report: ProbeReport;
  /** 高度场（世界高度，n × n，行 = z）；baseY = 远景地面的高度（图外地形最外一圈收回到它） */
  field: { origin: Vec3; scale: Vec3; n: number; heights: Float32Array; baseY: number };
  /** 地形四层贴图权重（RGBA，n × n，行 = z；和高度场同一网格） */
  control: Uint8Array;
  /** 软边界距离场（Unity 坐标：网页点按 (−x, z) 采样；区内为负） */
  boundary: { width: number; height: number; origin: [number, number]; cell: number; field: Float32Array };
  pieces: PieceRequest[];
  /** 机关数据（软边界、天气、流沙、补给营 / 安全区）：MechanismSystem 直接读这份，不读 Unity 导出的 mechanisms.json */
  mechanisms: SceneMechanisms;
  /** 后期调色（play.ts 里旧场景 Volume 的结果） */
  grade: MapPlay['grade'];
  /** 编译时的提醒（缩放拉得太狠、对不上旧场景的据点……） */
  notes: string[];
}

const DEG = Math.PI / 180;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const qyaw = (deg: number): Quat => [0, Math.sin(deg * DEG / 2), 0, Math.cos(deg * DEG / 2)];
/** 体块本地 (dx, dz) → 世界（rot = 俯视逆时针，同 WbBlock.rot / THREE rotation.y） */
const toWorld = (at: V2, rot: number, dx: number, dz: number): V2 => {
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG);
  return [at[0] + dx * c + dz * s, at[1] - dx * s + dz * c];
};
const toLocal = (at: V2, rot: number, x: number, z: number): V2 => {
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG), dx = x - at[0], dz = z - at[1];
  return [dx * c - dz * s, dx * s + dz * c];
};

/** 绕 y 转的盒子碰撞（世界坐标） */
function obb(name: string, center: Vec3, size: Vec3, yaw: number, scenePath: string): Collider {
  const c = Math.abs(Math.cos(yaw * DEG)), s = Math.abs(Math.sin(yaw * DEG));
  const ex = c * size[0] / 2 + s * size[2] / 2, ez = s * size[0] / 2 + c * size[2] / 2, ey = size[1] / 2;
  return {
    kind: 'box', name, scenePath, center: center.map(r3) as Vec3, size: size.map(r3) as Vec3, rotation: qyaw(yaw).map(r3) as Quat,
    min: [r3(center[0] - ex), r3(center[1] - ey), r3(center[2] - ez)], max: [r3(center[0] + ex), r3(center[1] + ey), r3(center[2] + ez)],
  };
}

const needName = (b: { needs?: string }): string => (b.needs ?? '').split('：')[0];

// ───────────── 地形：高度场 + 材质 ─────────────

/** 材质 → 旧地形四层（0 起伏沙、1 黑戈壁砾石、2 龟裂土 / 夯土地、3 赭红岩层）的权重 */
const LAYER: Record<WbMat, [number, number, number, number]> = {
  sand: [1, 0, 0, 0], dune: [1, 0, 0, 0], gravel: [0, 1, 0, 0], road: [0.15, 0, 0.85, 0], mud: [0, 0.15, 0.85, 0],
  rock: [0, 0, 0, 1], earth: [0, 0, 0.45, 0.55], timber: [0, 0, 1, 0], roof: [0, 0, 1, 0], stone: [0, 0, 1, 0],
  water: [0, 0.3, 0.7, 0], plant: [0.35, 0, 0.65, 0],
};

function buildField(spec: WhiteboxSpec, ground: WbTerrain, config: RedoMapConfig): CompiledMap['field'] & { mats: Uint8Array } {
  const [W, D] = spec.size, n = FIELD_N;
  const sx = (W + MARGIN * 2) / (n - 1), sz = (D + MARGIN * 2) / (n - 1);
  const world = new Float32Array(n * n);
  const mats = new Uint8Array(n * n);
  // 图边的平均高度（沿边 ±12 m 取平均：续出去的沙丘不带图边上的小细节）
  const edgeHeight = (x: number, z: number): number => {
    const cx = Math.min(W, Math.max(0, x)), cz = Math.min(D, Math.max(0, z));
    let sum = 0, k = 0;
    for (let o = -12; o <= 12; o += 4) {
      const px = cx === 0 || cx === W ? cx : Math.min(W, Math.max(0, cx + o));
      const pz = cz === 0 || cz === D ? cz : Math.min(D, Math.max(0, cz + o));
      sum += ground.groundAt(px, pz);
      k++;
    }
    return sum / k;
  };
  const far = config.far ?? [];
  // 远景地面的基准高度 = 图边一圈高度的中位数：图外地形在最外 40 m 收回到它，接上运行时铺的远景地面（不留断边）
  const border: number[] = [];
  for (let t = 0; t <= 1; t += 0.01) border.push(edgeHeight(t * W, 0), edgeHeight(t * W, D), edgeHeight(0, t * D), edgeHeight(W, t * D));
  border.sort((a, b) => a - b);
  const baseY = config.farBase ?? border[Math.floor(border.length / 2)];
  for (let j = 0; j < n; j++) {
    const z = -MARGIN + j * sz;
    for (let i = 0; i < n; i++) {
      const x = -MARGIN + i * sx, k = j * n + i;
      const inside = x >= 0 && x <= W && z >= 0 && z <= D;
      if (inside) {
        world[k] = ground.groundAt(x, z);
        mats[k] = ['sand', 'dune', 'gravel', 'road', 'mud', 'rock', 'earth', 'timber', 'roof', 'stone', 'water', 'plant'].indexOf(ground.matAt(x, z));
      } else {
        const d = Math.hypot(x - Math.min(W, Math.max(0, x)), z - Math.min(D, Math.max(0, z)));
        const t = Math.min(1, d / 60), ease = t * t * (3 - 2 * t);
        // 图边高度 → 慢慢抬起来 + 越来越大的沙丘（两层噪声：长垄 + 小起伏）
        const dunes = (fbm(x / 70, z / 45, 91) - 0.45) * 2 + (fbm(x / 22, z / 22, 93) - 0.5) * 0.5;
        let h = edgeHeight(x, z) + config.margin.rise * d / 100 + config.margin.dunes * ease * dunes;
        for (const f of far) if (f.mound) {
          const r = Math.hypot(x - f.at[0], z - f.at[1]) / f.mound.r;
          if (r < 1) h = Math.max(h, edgeHeight(x, z) + config.margin.rise * d / 100 + f.mound.h * 0.5 * (1 + Math.cos(Math.PI * r)));
        }
        const e = Math.min(x + MARGIN, W + MARGIN - x, z + MARGIN, D + MARGIN - z), f = Math.min(1, Math.max(0, e / 40));
        world[k] = baseY + (h - baseY) * f * f * (3 - 2 * f);
        mats[k] = 1;   // dune
      }
    }
  }
  return { origin: [-MARGIN, 0, -MARGIN], scale: [sx, 1, sz], n, heights: world, mats, baseY };
}

/** 材质下标 → 四层权重，再糊开 ~1.5 m（交界做过渡带），行序同高度场（行 = z） */
function buildControl(mats: Uint8Array, n: number): Uint8Array {
  const order: WbMat[] = ['sand', 'dune', 'gravel', 'road', 'mud', 'rock', 'earth', 'timber', 'roof', 'stone', 'water', 'plant'];
  let w = new Float32Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const l = LAYER[order[mats[k]] ?? 'sand'];
    w.set(l, k * 4);
  }
  // 两遍 3 × 3 盒式模糊
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(w.length);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      for (let c = 0; c < 4; c++) {
        let s = 0, m = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || ii < 0 || jj >= n || ii >= n) continue;
          s += w[(jj * n + ii) * 4 + c];
          m++;
        }
        out[(j * n + i) * 4 + c] = s / m;
      }
    }
    w = out;
  }
  const control = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const a = w[k * 4], b = w[k * 4 + 1], c = w[k * 4 + 2], d = w[k * 4 + 3], sum = a + b + c + d || 1;
    control[k * 4] = Math.round(a / sum * 255);
    control[k * 4 + 1] = Math.round(b / sum * 255);
    control[k * 4 + 2] = Math.round(c / sum * 255);
    control[k * 4 + 3] = Math.round(d / sum * 255);
  }
  return control;
}

export function encodeFloats(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ───────────── 软边界距离场 ─────────────

function buildBoundary(spec: WhiteboxSpec): CompiledMap['boundary'] {
  const [W, D] = spec.size, cell = 2;
  const play: V2[] = spec.play ?? [[2, 2], [W - 2, 2], [W - 2, D - 2], [2, D - 2]];
  // 网页 x ∈ [−M, W + M] → Unity x = −网页 x ∈ [−W − M, M]
  const width = Math.ceil((W + MARGIN * 2) / cell) + 1, height = Math.ceil((D + MARGIN * 2) / cell) + 1;
  const origin: [number, number] = [-(W + MARGIN), -MARGIN];
  const field = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = -(origin[0] + i * cell), z = origin[1] + j * cell;
    let best = Infinity;
    for (let e = 0; e < play.length; e++) {
      const a = play[e], b = play[(e + 1) % play.length];
      const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2));
      best = Math.min(best, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t));
    }
    field[j * width + i] = pointInPolygon(x, z, play) ? -best : best;
  }
  return { width, height, origin, cell, field };
}

// ───────────── 导航网格 ─────────────

/**
 * 1 m 网格上「能走的小格」（四角都能站、离墙 ≥ 0.45 m、从出生点走得到、相邻角高差迈得过去）合并成最大 NAV_RECT 米的矩形
 * （矩形里高差 ≤ 1.5 m），每个矩形把落在它边上的别的矩形的角点也串进来再按扇形三角化——相邻矩形的公共边切得一模一样，
 * 游戏的导航网格（按共边连三角形）不会在 T 形接缝处断开。三角形比逐格少一个数量级，寻路快得多。
 */
const NAV_RECT = 32;
function buildNavigation(terrain: WbTerrain, probe: WhiteboxProbe): UnitySceneDocument['navigation'] {
  const step = 2;   // 隔 2 格（1 m）取一个点
  const ok = probe.flood(terrain.spec.spawn.at, 0.45);
  const gx = Math.floor((probe.nx - 1) / step) + 1, gz = Math.floor((probe.nz - 1) / step) + 1;
  const at = (I: number, J: number): number => (J * step) * probe.nx + I * step;
  const hAt = (I: number, J: number): number => terrain.walk[at(I, J)];
  const good = (I: number, J: number): boolean => I >= 0 && J >= 0 && I < gx && J < gz && ok[at(I, J)] === 1;
  const climb = Math.max(WB_METRICS.step, Math.tan(WB_METRICS.maxSlope * DEG) * terrain.cell * step);
  const qx = gx - 1, qz = gz - 1;
  const quad = new Uint8Array(qx * qz);
  for (let J = 0; J < qz; J++) for (let I = 0; I < qx; I++) {
    if (!good(I, J) || !good(I + 1, J) || !good(I, J + 1) || !good(I + 1, J + 1)) continue;
    const a = hAt(I, J), b = hAt(I + 1, J), c = hAt(I, J + 1), d = hAt(I + 1, J + 1);
    if (Math.abs(a - b) > climb || Math.abs(a - c) > climb || Math.abs(d - b) > climb || Math.abs(d - c) > climb) continue;
    quad[J * qx + I] = 1;
  }
  // 贪心合并成矩形（按行扫：先往右长，再往下长）
  const owner = new Int32Array(qx * qz).fill(-1);
  const rects: { I0: number; J0: number; I1: number; J1: number }[] = [];
  const quadRange = (I: number, J: number): [number, number] => {
    const hs = [hAt(I, J), hAt(I + 1, J), hAt(I, J + 1), hAt(I + 1, J + 1)];
    return [Math.min(...hs), Math.max(...hs)];
  };
  for (let J = 0; J < qz; J++) for (let I = 0; I < qx; I++) {
    if (!quad[J * qx + I] || owner[J * qx + I] >= 0) continue;
    let [lo, hi] = quadRange(I, J);
    let I1 = I + 1;
    while (I1 < qx && I1 - I < NAV_RECT && quad[J * qx + I1] && owner[J * qx + I1] < 0) {
      const [a, b] = quadRange(I1, J);
      if (Math.max(hi, b) - Math.min(lo, a) > 2.5) break;
      lo = Math.min(lo, a); hi = Math.max(hi, b);
      I1++;
    }
    let J1 = J + 1;
    grow: while (J1 < qz && J1 - J < NAV_RECT) {
      let l2 = lo, h2 = hi;
      for (let x = I; x < I1; x++) {
        if (!quad[J1 * qx + x] || owner[J1 * qx + x] >= 0) break grow;
        const [a, b] = quadRange(x, J1);
        l2 = Math.min(l2, a); h2 = Math.max(h2, b);
      }
      if (h2 - l2 > 2.5) break;
      lo = l2; hi = h2;
      J1++;
    }
    const id = rects.length;
    rects.push({ I0: I, J0: J, I1, J1 });
    for (let y = J; y < J1; y++) for (let x = I; x < I1; x++) owner[y * qx + x] = id;
  }
  // 所有矩形的角点
  const corner = new Uint8Array(gx * gz);
  for (const r of rects) for (const [I, J] of [[r.I0, r.J0], [r.I1, r.J0], [r.I0, r.J1], [r.I1, r.J1]]) corner[J * gx + I] = 1;
  const index = new Int32Array(gx * gz).fill(-1);
  const vertices: Vec3[] = [], indices: number[] = [];
  const cell = terrain.cell * step;
  const vert = (I: number, J: number): number => {
    const k = J * gx + I;
    if (index[k] < 0) {
      index[k] = vertices.length;
      vertices.push([I * cell, r3(hAt(I, J)), J * cell]);
    }
    return index[k];
  };
  for (const r of rects) {
    // 边界一圈（逆时针看俯视：上边 → 右边 → 下边 → 左边），只收角点
    const ring: number[] = [];
    for (let I = r.I0; I < r.I1; I++) if (corner[r.J0 * gx + I]) ring.push(vert(I, r.J0));
    for (let J = r.J0; J < r.J1; J++) if (corner[J * gx + r.I1]) ring.push(vert(r.I1, J));
    for (let I = r.I1; I > r.I0; I--) if (corner[r.J1 * gx + I]) ring.push(vert(I, r.J1));
    for (let J = r.J1; J > r.J0; J--) if (corner[J * gx + r.I0]) ring.push(vert(r.I0, J));
    if (ring.length === 4) {
      // 只有四个角：两个三角形（和逐格的绕向一致：a c b / b c d）
      const [a, b, d, c] = ring;
      indices.push(a, c, b, b, c, d);
      continue;
    }
    const cx = (r.I0 + r.I1) / 2 * cell, cz = (r.J0 + r.J1) / 2 * cell;
    const center = vertices.length;
    vertices.push([cx, r3(terrain.walkAt(cx, cz)), cz]);
    for (let k = 0; k < ring.length; k++) indices.push(center, ring[(k + 1) % ring.length], ring[k]);
  }
  return { vertices, indices, areas: new Array(indices.length / 3).fill(0) };
}

// ───────────── 体块 → 已有件 + 碰撞 ─────────────

interface PropFit { renderers: UnityRenderer[]; note?: string }

/** 资产包围盒（public/assets/props 的网页 PBR 件，GLB 根空间：底面在 0，正面 +Z） */
function assetBox(asset: string): { min: Vec3; max: Vec3 } | null {
  const a = WB_ASSETS[asset];
  return a ? { min: a.min, max: a.max } : null;
}

/**
 * 一件（或连排 n 件）已有资产填进一个占地矩形：frame 中心 at、转角 rot、占地 [a 沿本地 x, b 沿本地 z]、底面 bottom、总高 height。
 * 资产的长边对哪根轴、连排几件，按缩放最不变形来挑；返回渲染件。
 */
function fitAsset(asset: string, at: V2, rot: number, a: number, b: number, bottom: number, height: number, tag: string): PropFit {
  const box = assetBox(asset);
  if (!box) return { renderers: [], note: `${tag}：资产 ${asset} 没有包围盒` };
  const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1], d = box.max[2] - box.min[2];
  const sy = Math.max(0.05, height / h);
  const option = (along: number, across: number) => {
    const count = Math.max(1, Math.round(along / (w * sy)));
    const sx = along / (count * w), sz = across / d;
    return { count, sx, sz, err: Math.abs(Math.log(sx / sy)) + Math.abs(Math.log(sz / sy)) };
  };
  const o0 = option(a, b), o1 = option(b, a);
  const swap = o1.err < o0.err;
  const o = swap ? o1 : o0;
  const yaw = swap ? rot + 90 : rot;
  const along = swap ? b : a;
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const renderers: UnityRenderer[] = [];
  for (let k = 0; k < o.count; k++) {
    const t = (k - (o.count - 1) / 2) * along / o.count;
    const p = swap ? toWorld(at, rot, 0, t) : toWorld(at, rot, t, 0);
    // 资产包围盒中心对到 p：先减去缩放后的本地偏移（绕 yaw 转）
    const off = toWorld([0, 0], yaw, cx * o.sx, cz * o.sz);
    renderers.push({
      name: asset, url: `assets/props/${asset}.glb`,
      position: [r3(p[0] - off[0]), r3(bottom - box.min[1] * sy), r3(p[1] - off[1])],
      rotation: qyaw(yaw).map(r3) as Quat, scale: [r3(o.sx), r3(sy), r3(o.sz)],
      scenePath: `Redo/${tag}#${k + 1}`,
    });
  }
  const stretch = Math.max(o.sx / sy, sy / o.sx, o.sz / sy, sy / o.sz);
  return { renderers, note: stretch > 1.7 ? `${tag}：${asset} 拉伸 ${stretch.toFixed(2)} 倍` : undefined };
}

/** 一组体块（同名同资产 = 同一件）在第一块的转角系里的占地并集 */
function groupFrame(parts: ResolvedBlock[]): { at: V2; rot: number; a: number; b: number } {
  const rot = parts.find(p => p.kind === 'box')?.rot ?? 0;
  const origin = parts[0].at;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    const pts: V2[] = p.kind === 'cyl'
      ? [[p.at[0] - p.size[0], p.at[1] - p.size[0]], [p.at[0] + p.size[0], p.at[1] - p.size[0]], [p.at[0] - p.size[0], p.at[1] + p.size[0]], [p.at[0] + p.size[0], p.at[1] + p.size[0]]]
      : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => toWorld(p.at, p.rot ?? 0, u * p.size[0] / 2, v * p.size[1] / 2));
    for (const q of pts) {
      const l = toLocal(origin, rot, q[0], q[1]);
      x0 = Math.min(x0, l[0]); x1 = Math.max(x1, l[0]); z0 = Math.min(z0, l[1]); z1 = Math.max(z1, l[1]);
    }
  }
  return { at: toWorld(origin, rot, (x0 + x1) / 2, (z0 + z1) / 2), rot, a: x1 - x0, b: z1 - z0 };
}

function blockCollider(b: ResolvedBlock, groundUnder: number, path: string): Collider {
  const bottom = b.canopy ? b.y0 : groundUnder - 0.3, top = b.y1;
  const size: Vec3 = b.kind === 'cyl' ? [b.size[0] * 2, top - bottom, b.size[0] * 2] : [b.size[0], top - bottom, b.size[1]];
  return obb(b.name ?? b.asset ?? 'block', [b.at[0], (bottom + top) / 2, b.at[1]], size, b.kind === 'cyl' ? 0 : b.rot ?? 0, path);
}

// ───────────── 点位 ─────────────

const fuzzy = (a: string, b: string): boolean => a === b || a.includes(b) || b.includes(a);

/** 玩法数据里的遭遇按名字对上（据点 → 必清遭遇，驻守点 → 可选小遭遇） */
function matchEncounter(play: MapPlay | null, name: string, optional: boolean): PlayEncounter | undefined {
  return play?.encounters.find(e => e.optional === optional && fuzzy(e.title, name));
}

/** 机关的公共字段（位置、朝向、矩阵） */
function mechBase(scenePath: string, position: Vec3, yaw = 0): MechanismBase {
  const q = qyaw(yaw), c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG);
  return { scenePath, position, rotation: q, scale: [1, 1, 1], yaw, matrix: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, position[0], position[1], position[2], 1] };
}

/** 场地里的站位锚点：按旧场景的角色序列，正面朝来路、侧袭在两侧、远程 / 狙击 / 炮手往后并优先高处 */
function anchorsFor(site: WbSite, radius: number, roles: number[], lanes: number[], approach: V2, terrain: WbTerrain, probe: WhiteboxProbe): UnityEncounter['anchors'] {
  const base = terrain.walkAt(site.at[0], site.at[1]);
  const len = Math.hypot(approach[0], approach[1]) || 1, ax = approach[0] / len, az = approach[1] / len;
  const used: V2[] = [];
  const pick = (angle: number, dist: number, preferHigh: boolean): { p: V2; y: number } => {
    let best: { p: V2; y: number; score: number } | null = null;
    for (let k = 0; k < 40; k++) {
      const a = angle + (k % 8 - 3.5) * 0.12, r = dist * (0.75 + Math.floor(k / 8) * 0.12);
      // 朝向：approach 是从场地指向来路的方向；angle 0 = 来路那边
      const c = Math.cos(a), s = Math.sin(a), dx = ax * c - az * s, dz = ax * s + az * c;
      const p: V2 = [site.at[0] + dx * r * radius, site.at[1] + dz * r * radius];
      const i = probe.snap(p, 1.1, 3);
      if (i < 0 || !probe.reach[i]) continue;
      const q = probe.point(i), y = terrain.walk[i];
      const crowd = used.reduce((m, u) => Math.min(m, Math.hypot(u[0] - q[0], u[1] - q[1])), Infinity);
      const score = (preferHigh ? (y - base) * 2 : -Math.abs(y - base)) + Math.min(crowd, 6) - Math.abs(r - dist) * 3;
      if (!best || score > best.score) best = { p: q, y, score };
    }
    return best ?? { p: site.at, y: base };
  };
  return roles.map((role, k) => {
    // 0 auto / 1 正面 / 2 侧袭 / 3 远程 / 4 狙击 / 5 炮手 / 6 辅助
    const side = k % 2 ? 1 : -1;
    const [angle, dist, high] = role === 1 ? [side * 0.35, 0.45, false]
      : role === 2 ? [side * 1.5, 0.6, false]
      : role === 3 ? [Math.PI + side * 0.5, 0.75, true]
      : role === 4 || role === 5 ? [Math.PI + side * 0.25, 0.85, true]
      : role === 6 ? [Math.PI, 0.6, false]
      : [k * 2.4, 0.55, false];
    const { p, y } = pick(angle as number, dist as number, high as boolean);
    used.push(p);
    return { position: [r3(p[0]), r3(y), r3(p[1])] as Vec3, lane: lanes[k] ?? k % 3, role, elevated: y - base > 2 || undefined };
  });
}

// ───────────── 编译 ─────────────

export function compileWhitebox(spec: WhiteboxSpec, play: MapPlay | null = PLAY[spec.id] ?? null): CompiledMap {
  const config = REDO_MAPS[spec.id] ?? { margin: { rise: 5, dunes: 6 } };
  const notes: string[] = [];
  const terrain = buildTerrain(spec);
  const probe = new WhiteboxProbe(terrain);
  const report = probeWhitebox(terrain);
  // 地面：去掉由新件代替的坡道（件自己有踏板和碰撞）
  const groundSpec: WhiteboxSpec = { ...spec, terrain: spec.terrain.filter(o => !('piece' in o && o.piece)), blocks: [] };
  const ground = buildTerrain(groundSpec);
  const fieldData = buildField(spec, ground, config);
  const control = buildControl(fieldData.mats, fieldData.n);
  const { mats: _mats, ...field } = fieldData;
  let minY = Infinity, maxY = -Infinity;
  for (const v of field.heights) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
  minY -= 1;
  maxY += 1;
  const norm = new Float32Array(field.heights.length);
  for (let k = 0; k < norm.length; k++) norm[k] = (field.heights[k] - minY) / (maxY - minY);
  const heightfield = { origin: [-MARGIN, minY, -MARGIN] as Vec3, scale: [field.scale[0], maxY - minY, field.scale[2]] as Vec3, resolution: field.n, heights: encodeFloats(norm) };

  // ── 体块 ──
  const renderers: UnityRenderer[] = [];
  const colliders: Collider[] = [];
  const pieces: PieceRequest[] = [];
  const groundUnder = (b: ResolvedBlock): number => b.canopy ? ground.groundAt(b.at[0], b.at[1]) : b.y0 + 0.6;
  const groups = new Map<string, ResolvedBlock[]>();
  terrain.blocks.forEach((b, k) => {
    if (b.needs) return;
    const key = b.name ? `${b.name}|${b.asset ?? ''}` : `#${k}`;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  });
  let serial = 0;
  for (const [key, parts] of groups) {
    const tag = `${parts[0].name ?? parts[0].asset ?? 'block'}_${++serial}`;
    for (const b of parts) colliders.push(blockCollider(b, groundUnder(b), `Redo/${tag}/collider`));
    const asset = parts[0].asset;
    if (!asset) { notes.push(`体块 ${key} 没标资产，只有碰撞`); continue; }
    const frame = groupFrame(parts);
    const bottomGround = Math.min(...parts.map(groundUnder));
    const sink = Math.max(0, ...parts.map(p => p.sink ?? 0));
    const top = Math.max(...parts.map(p => p.y1));
    const fit = fitAsset(asset, frame.at, frame.rot, frame.a, frame.b, bottomGround - sink - 0.05, top - (bottomGround - sink - 0.05), tag);
    renderers.push(...fit.renderers);
    if (fit.note) notes.push(fit.note);
  }

  // ── 地形图章上标的已有件（雅丹丘、台基块、城墙）：只是画面，碰撞是地形本身 ──
  spec.terrain.forEach((o: TerrainOp, k) => {
    if (o.op === 'paint' || !o.asset || ('piece' in o && o.piece)) return;
    const tag = `${o.asset}_terrain${k}`;
    if (o.op === 'mound') {
      // 岩丘的网格罩在地形鼓包上（比鼓包略窄、底埋 0.4 m）：碰撞还是平滑的地形
      const top = ground.groundAt(o.at[0], o.at[1]);
      const fit = fitAsset(o.asset, o.at, o.rot ?? 0, o.r[0] * 1.7, o.r[1] * 1.7, top - o.h - 0.4, o.h + 0.6, tag);
      renderers.push(...fit.renderers);
    } else if (o.op === 'ramp') {
      // 沿折线一段一段铺
      for (let s = 0; s < o.pts.length - 1; s++) {
        const a = o.pts[s], b = o.pts[s + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1) continue;
        const rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) / DEG;
        const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const floor = Math.min(ground.groundAt(a[0], a[1]), ground.groundAt(b[0], b[1]));
        const fit = fitAsset(o.asset, mid, rot, len, o.half * 2, floor - 3, Math.max(...o.hs) - floor + 3 + 0.2, `${tag}_${s}`);
        renderers.push(...fit.renderers);
      }
    } else if (o.op === 'poly' || o.op === 'disc') {
      const box = assetBox(o.asset);
      if (!box) return;
      const pts: V2[] = o.op === 'poly' ? o.pts : Array.from({ length: 24 }, (_, i): V2 => [o.at[0] + Math.cos(i / 24 * Math.PI * 2) * o.r, o.at[1] + Math.sin(i / 24 * Math.PI * 2) * o.r]);
      const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const w = box.max[0] - box.min[0], d = box.max[2] - box.min[2], h = box.max[1] - box.min[1];
      const s = Math.max(0.4, Math.min(1.2, o.h / h * 1.1));
      const nx = Math.max(1, Math.round((x1 - x0) / (w * s))), nz = Math.max(1, Math.round((z1 - z0) / (d * s)));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const p: V2 = [x0 + (i + 0.5) * (x1 - x0) / nx, z0 + (j + 0.5) * (z1 - z0) / nz];
        if (!pointInPolygon(p[0], p[1], pts)) continue;
        // 顶面压到地面下 3 cm：台面看到的是地形的铺地，台沿露出台基块的侧面（顶面的花纹在近景里会显成一个个暗洞）
        const top = ground.groundAt(p[0], p[1]);
        const fit = fitAsset(o.asset, p, 0, (x1 - x0) / nx, (z1 - z0) / nz, top - h * s - 0.03, h * s, `${tag}_${i}_${j}`);
        renderers.push(...fit.renderers);
      }
    }
  });

  // ── 新做的件 ──
  const trees = (needle: string) => terrain.blocks.filter(b => needName(b) === needle && !b.canopy).map((b, k) => {
    const crown = terrain.blocks.find(c => c.canopy && needName(c) === needle && c.at[0] === b.at[0] && c.at[1] === b.at[1]);
    const y = ground.groundAt(b.at[0], b.at[1]);
    return { at: b.at, y: r3(y), height: r3(Math.max(b.y1, crown?.y1 ?? 0) - y), seed: k * 7 + 3 };
  });
  const poplars = trees('白杨');
  if (poplars.length) pieces.push({ kind: 'poplars', trees: poplars, tint: config.poplar ?? 'green' });
  const dead = trees('胡杨枯木');
  if (dead.length) pieces.push({ kind: 'deadPoplars', trees: dead });
  for (const b of terrain.blocks.filter(x => needName(x) === '半埋驼骨')) pieces.push({ kind: 'camelBones', at: b.at, y: r3(ground.groundAt(b.at[0], b.at[1])), rot: b.rot ?? 0 });
  for (const name of new Set(terrain.blocks.map(needName).filter(n => n && !['白杨', '胡杨枯木', '半埋驼骨', '贴崖木栈梯'].includes(n)))) pieces.push({ kind: 'named', name });
  for (const o of spec.terrain) if (o.op === 'ramp' && o.piece && o.piece !== '月泉阁') pieces.push({ kind: 'stair', name: o.piece, pts: o.pts, hs: o.hs, half: o.half });

  // ── 远景地标 ──
  for (const f of config.far ?? []) {
    const box = assetBox(f.asset);
    if (!box) continue;
    const i = Math.round((f.at[0] + MARGIN) / field.scale[0]), j = Math.round((f.at[1] + MARGIN) / field.scale[2]);
    const y = field.heights[Math.min(field.n - 1, Math.max(0, j)) * field.n + Math.min(field.n - 1, Math.max(0, i))];
    renderers.push({
      name: f.asset, url: `assets/props/${f.asset}.glb`, position: [f.at[0], r3(y - (f.sink ?? 0)), f.at[1]],
      rotation: qyaw(f.yaw).map(r3) as Quat, scale: [f.scale, f.scale, f.scale], scenePath: `Redo/Far/${f.name}`,
    });
  }

  // ── 点位 ──
  const walk = (p: V2): number => r3(terrain.walkAt(p[0], p[1]));
  const v3 = (p: V2, up = 0): Vec3 => [r3(p[0]), r3(walk(p) + up), r3(p[1])];
  const mainRoute = report.routes.find(r => r.kind === 'main');
  /** 主线走进场地时从哪边来（场地 → 来路的方向） */
  const approachOf = (site: WbSite): V2 => {
    const pts = mainRoute?.pts ?? [];
    const r = (site.r ?? 24) * 1.4;
    let enter = -1;
    for (let k = 0; k < pts.length; k++) if (Math.hypot(pts[k][0] - site.at[0], pts[k][1] - site.at[1]) <= r) { enter = k; break; }
    const p = enter > 0 ? pts[Math.max(0, enter - 3)] : spec.spawn.at;
    return [p[0] - site.at[0], p[1] - site.at[1]];
  };
  const encounters: UnityEncounter[] = [];
  const usedTitles = new Set<string>();
  const addEncounter = (site: WbSite, optional: boolean): void => {
    let src = matchEncounter(play, site.name, optional);
    if (src && usedTitles.has(src.title)) src = undefined;
    // 驻守点是新加的、旧场景没有同名的：借一个还没用上的旧小遭遇的编制（只借波次，名字用新的）
    if (!src && optional) {
      const spare = play?.encounters.find(e => e.optional && !usedTitles.has(e.title) && !spec.guards.some(g => fuzzy(e.title, g.name)));
      if (spare) {
        src = { ...spare, title: site.name, waves: spare.waves.map(w => ({ ...w, label: site.name })) };
        notes.push(`驻守点 ${site.id} ${site.name}：旧场景没有同名遭遇，借「${spare.title}」的编制`);
        usedTitles.add(spare.title);
      }
    }
    if (!src) { notes.push(`${optional ? '驻守点' : '据点'} ${site.id} ${site.name}：旧场景里没有同名遭遇，不编`); return; }
    usedTitles.add(src.title);
    const radius = site.r ?? (optional ? 14 : 26);
    const k = radius / Math.max(1, src.arenaRadius);
    const { roles, lanes, ...rest } = structuredClone(src);
    encounters.push({
      ...rest,
      position: v3(site.at), triggerRadius: r3(src.triggerRadius * k), arenaRadius: radius,
      anchors: anchorsFor(site, radius, roles, lanes, approachOf(site), terrain, probe),
      scenePath: `Redo/Sites/${site.id}`,
    });
  };
  for (const s of spec.strongholds) addEncounter(s, false);
  for (const g of spec.guards) addEncounter(g, true);
  const titles = new Set(encounters.map(e => e.title));
  for (const e of encounters) e.requires = e.requires.filter(t => titles.has(t));

  const nearestStronghold = (p: V2): V2 => spec.strongholds.reduce((best, s) => Math.hypot(s.at[0] - p[0], s.at[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? s.at : best, spec.strongholds[0]?.at ?? spec.exit.at);
  const entries: UnityMonsterEntry[] = spec.entries.map(e => {
    const to = nearestStronghold(e.at), dx = to[0] - e.at[0], dz = to[1] - e.at[1], l = Math.hypot(dx, dz) || 1;
    return {
      scenePath: `Redo/Entries/${e.id}`, position: v3(e.at), forward: [r3(dx / l), 0, r3(dz / l)],
      mode: e.mode === 'jump' ? 5 : e.mode === 'fly' ? 4 : 0, spread: 4, label: e.name,
      from: e.from ? v3(e.from) : null, flyersOnly: e.mode === 'fly',
    };
  });

  const caches = spec.caches.map((c, k) => {
    const src = play?.caches.find(o => fuzzy(o.title, c.name)) ?? play?.caches[k];
    // 有守军的藏宝：旧场景的守军遭遇名，对上新编的驻守点
    const guard = src?.guard && titles.has(src.guard) ? src.guard : null;
    return { title: c.name, position: v3(c.at), reward: src?.reward ?? 'coins', discoverRadius: c.r ?? 12, guard, scenePath: `Redo/Caches/${c.id}` };
  });

  const exitFrom = mainRoute?.pts.length ? mainRoute.pts[Math.max(0, mainRoute.pts.length - 12)] : spec.spawn.at;
  const exitYaw = Math.atan2(exitFrom[0] - spec.exit.at[0], exitFrom[1] - spec.exit.at[1]) / DEG;
  const exits = [{ position: v3(spec.exit.at), rotation: qyaw(exitYaw).map(r3) as Quat, reward: '', requires: [] as string[], scenePath: 'Redo/Exit' }];

  const center: V2 = [spec.size[0] / 2, spec.size[1] / 2];
  const camps = (spec.extras ?? []).filter(e => e.kind === 'camp').map(c => ({
    title: c.name, position: v3(c.at), yaw: r3(Math.atan2(center[0] - c.at[0], center[1] - c.at[1]) / DEG), safeRadius: c.r ?? 10, openShop: true, scenePath: `Redo/Camps/${c.id}`,
  }));
  const bosses = (spec.extras ?? []).filter(e => e.kind === 'boss').map((b, k) => {
    const src = play?.bosses[k];
    const loop = mainRoute?.pts ?? [];
    const radius = Math.max(src?.radius ?? 30, ...loop.map(p => Math.hypot(p[0] - b.at[0], p[1] - b.at[1]) + 6));
    return {
      id: src?.id ?? 'boss', position: v3(b.at), center: [b.at[0], 0, b.at[1]] as Vec3, floorY: r3(terrain.walkAt(spec.strongholds[0]?.at[0] ?? b.at[0], spec.strongholds[0]?.at[1] ?? b.at[1])),
      radius: r3(radius), reward: v3([spec.exit.at[0] - 3, spec.exit.at[1]]), stronghold: false,
    };
  });

  // ── 环境：玩法数据里的光 / 雾打底，太阳方向换成白盒的（影子是构图的一部分） ──
  const environment = structuredClone(play?.environment) ?? {
    fog: { enabled: true, mode: 1, color: [0.88, 0.76, 0.6, 1], start: 40, end: 400, density: 0.01 },
    ambient: { mode: 1, sky: [0.6, 0.66, 0.75, 1], equator: [0.75, 0.66, 0.55, 1], ground: [0.5, 0.4, 0.3, 1], light: [0.5, 0.5, 0.5, 1], intensity: 1 },
    sun: null, sky: null, lights: [],
  } as UnitySceneDocument['environment'];
  {
    const az = spec.sun.azimuth * DEG, el = spec.sun.elevation * DEG;
    const toSun: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    const sun = environment.sun ?? { forward: [0, -1, 0], color: [1, 0.92, 0.8, 1], intensity: 1.4, shadows: 2, shadowStrength: 0.9 };
    environment.sun = { ...sun, forward: [r3(-toSun[0]), r3(-toSun[1]), r3(-toSun[2])] };
    // 这张图的光影雾（maps.ts 的 look）：主光颜色 / 强度、三色环境光、雾、渐变天空
    const light = redoLight(spec, config);
    if (light) applyDesertLight(environment, light);
  }

  const area = spec.play ?? [[0, 0], [spec.size[0], 0], [spec.size[0], spec.size[1]], [0, spec.size[1]]];
  const bx = area.map(p => p[0]), bz = area.map(p => p[1]);
  let wmin = Infinity, wmax = -Infinity;
  for (const v of terrain.walk) { wmin = Math.min(wmin, v); wmax = Math.max(wmax, v); }
  const yawRad = spec.spawn.yaw * DEG;
  const doc: UnitySceneDocument = {
    schema: 1, id: spec.id, title: play?.title ?? spec.name, scene: `Redo/${spec.id}`,
    spawn: { position: v3(spec.spawn.at), forward: [r3(Math.sin(yawRad)), 0, r3(-Math.cos(yawRad))] },
    bounds: { min: [Math.min(...bx), r3(wmin - 5), Math.min(...bz)], max: [Math.max(...bx), r3(wmax + 60), Math.max(...bz)] },
    visualBounds: { min: [-MARGIN, minY, -MARGIN], max: [spec.size[0] + MARGIN, maxY, spec.size[1] + MARGIN] },
    renderers, colliders, platforms: [], water: buildWater(spec, ground, play), activators: [],
    heightfields: [heightfield],
    navigation: buildNavigation(terrain, probe),
    environment,
    encounters, exits, caches, camps, bosses, entries, layout: null,
  };
  const boundary = buildBoundary(spec);
  const mechanisms = buildMechanisms(spec, config, play, terrain, boundary, doc.camps);
  return { doc, spec, config, terrain, probe, report, field, control, boundary, pieces, mechanisms, grade: play?.grade ?? null, notes };
}

/**
 * 水体：白盒的水面多边形切成 6 m 见方的水体盒（玩法的水深 / 蹚水减速 / 首领吸干泉水都按盒子算），盒底 = 格子里最低的泉床，盒顶 = 水位。
 * 1-4 的月牙泉叫 CrescentSpring（旱魃认这个名字吸干 / 复涌）；画面上的水面网格在运行时按多边形铺（redo/runtime.ts）。
 */
function buildWater(spec: WhiteboxSpec, ground: WbTerrain, play: MapPlay | null): UnitySceneDocument['water'] {
  const tpl = play?.water ?? { shallow: 0.15, deep: 1.3, wadeSlow: 0.55, deepIsHazard: true, drownBurst: 0.05 };
  const spring = spec.id === '1-4';
  const out: UnitySceneDocument['water'] = [];
  const cell = 6;
  for (const w of spec.water ?? []) {
    const xs = w.pts.map(p => p[0]), zs = w.pts.map(p => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += cell) for (let z = Math.min(...zs); z < Math.max(...zs); z += cell) {
      let bed = Infinity;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const px = x + cell * i / 4, pz = z + cell * j / 4;
        if (pointInPolygon(px, pz, w.pts)) bed = Math.min(bed, ground.groundAt(px, pz));
      }
      if (!Number.isFinite(bed) || bed >= w.level - 0.05) continue;
      const k = out.length + 1;
      out.push({
        id: `redo-water-${k}`, name: spring ? `CrescentSpring Water ${k}` : `Water ${k}`, scenePath: `Redo/Water/${k}`,
        center: [r3(x + cell / 2), r3((bed + w.level) / 2), r3(z + cell / 2)], scale: [cell, r3(w.level - bed), cell], rotation: [0, 0, 0, 1],
        ...tpl, spring, beds: [],
      });
    }
  }
  return out;
}

/**
 * maps.ts 的 look.light 补上太阳方位：白盒的 azimuth 是俯视从北顺时针（北 = −z），DesertLight 的是网页 XZ 里从 +Z 起（90 = +X）。
 * 朝太阳的向量 白盒 = (sin a, ·, −cos a)，DesertLight = (sin b, ·, cos b) → b = 180 − a。
 */
export function redoLight(spec: WhiteboxSpec, config: RedoMapConfig): DesertLight | undefined {
  const l = config.look?.light;
  if (!l) return undefined;
  return { ...l, sun: { ...l.sun, azimuth: 180 - spec.sun.azimuth, elevation: spec.sun.elevation } };
}

/** 运行时生成的软边界距离场的地址（MechanismData.provideBoundaryField 按它登记） */
export const boundaryUrl = (id: string): string => `redo/boundary/${id}.f32`;

/** 机关数据：软边界（可玩区）、天气（沙暴挪到新据点）、流沙（白盒标的位置）、补给营 + 安全区（白盒的 camp 点位） */
function buildMechanisms(spec: WhiteboxSpec, config: RedoMapConfig, play: MapPlay | null, terrain: WbTerrain, boundary: CompiledMap['boundary'], camps: UnitySceneDocument['camps']): SceneMechanisms {
  const at = (p: V2): Vec3 => [r3(p[0]), r3(terrain.walkAt(p[0], p[1])), r3(p[1])];
  const w = play?.weather;
  const storm = config.storm, site = storm && [...spec.strongholds, ...spec.guards].find(s => s.id === storm.site);
  const tuning = play?.boundaryTuning ?? { softStart: 0, windRamp: 14, pushBase: 4, pushGain: 18, hazeLead: 6, failsafe: 26, navInset: 2, tetherSlack: 2, tetherGrace: 1.2 };
  return {
    scene: `Redo/${spec.id}`, source: 'redo', sceneSha1: '',
    weather: w ? {
      ...mechBase('Redo/Weather', [0, 0, 0]),
      baseFogColor: w.baseFogColor, baseFogStart: w.baseFogStart, baseFogEnd: w.baseFogEnd, theme: w.theme, whiteoutProfile: w.whiteoutProfile,
      windDir: [spec.wind[0], spec.wind[1]], baseWind: w.baseWind,
      regions: storm && site && w.region ? [{ ...w.region, center: at(site.at), radius: storm.radius, from: storm.from }] : [],
    } : null,
    boundary: {
      scenePath: 'Redo/Boundary', asset: '', url: boundaryUrl(spec.id), width: boundary.width, height: boundary.height, sha1: '',
      origin: boundary.origin, cell: boundary.cell, theme: 'Desert', tuning,
    },
    quicksand: play?.quicksand ? (config.quicksand ?? []).map((q, k) => ({ ...mechBase(`Redo/Quicksand${k + 1}`, at(q.at)), ...play.quicksand!, radius: q.r, coreRadius: r3(q.r * 0.4) })) : [],
    // 补给营 + 安全区：模板取旧场景的（没有就用缺省：10 m 安全区、开商店）
    camps: camps.map(c => ({ ...mechBase(c.scenePath ?? 'Redo/Camp', c.position, c.yaw), label: c.title, ...(play?.camp ?? { openShop: true, restoreOnArrive: false }), safeRadius: c.safeRadius })),
    safeZones: camps.map(c => ({ ...mechBase(`${c.scenePath ?? 'Redo/Camp'}/Safe`, c.position, c.yaw), ...(play?.safeZone ?? { height: 6, pushMargin: 1.5, carveNavMesh: true }), radius: c.safeRadius })),
  };
}
