import * as THREE from 'three';
import { createStylizedLit } from '../../UnityStylizedLit';
import type { BuiltPiece, LabPiece, PieceBox, PieceContext, V3 } from './types';

/**
 * 程序化木构套件（第一章重做 · 月泉阁 / 坐像殿 / 九层楼 / 贴崖木栈梯共用）。
 * 唐宋木构的简化：朱漆柱 + 覆盆柱础、深色枋、简化斗拱、灰蓝筒瓦屋面（庑殿 / 歇山 / 悬山 / 腰檐，檐角起翘）、勾栏、木梯、直棂窗、幡。
 *
 * 做法：每件按材质分桶，所有构件的顶点直接写在世界坐标里，最后一桶合成一个网格（一件 5–6 次绘制）。
 * 材质走游戏里 Unity 场景件同一条路（createStylizedLit：三色环境光、软阶梯主光、冷色暗部、边缘光），
 * 固有色 = 顶点色 × 一张很淡的程序贴图（瓦垄 / 木板缝 / 石缝，DataTexture 生成，node 里也能跑），不做噪点斑驳。
 * 坐标同 types.ts：x 东、z 南、y 上，米；转角 = 俯视逆时针度数 = THREE rotation.y。
 */

export type RGB = readonly [number, number, number];
/** 材质桶：漆木（无贴图）/ 木板 / 瓦 / 石 / 灰泥（无贴图）/ 布（双面，幡） */
export type MatKey = 'paint' | 'wood' | 'tile' | 'stone' | 'plaster' | 'cloth';

/** 调色板（sRGB）：对着现有沙漠木构资产（月泉阁、回廊、门楼、寺塔）取的色，比它们略收一点饱和度 */
export const PAL = {
  /** 朱漆柱（褪色的土朱红，比纯朱收一截饱和度：和现有月泉阁 / 回廊资产的柱色对齐） */
  lacquer: [0.45, 0.2, 0.15],
  /** 朱漆上的浮尘 / 剥落 */
  lacquerFade: [0.62, 0.4, 0.3],
  /** 脚下积沙 */
  dust: [0.62, 0.52, 0.41],
  /** 深色木枋 */
  beam: [0.3, 0.21, 0.15],
  /** 阑额（土朱） */
  beamRed: [0.43, 0.2, 0.14],
  /** 拱（棕） */
  bracket: [0.4, 0.24, 0.16],
  /** 斗（灰青绿，现有资产斗拱带的那种青绿） */
  bracketBlock: [0.44, 0.52, 0.45],
  /** 青绿点缀（栱眼壁、枋头） */
  teal: [0.36, 0.5, 0.46],
  /** 楼板 / 踏板（旧木） */
  plank: [0.53, 0.41, 0.31],
  /** 风吹日晒的素木（栈道、栈梯的栏杆：照 1-4 / 1-A 概念图，不上漆） */
  weathered: [0.47, 0.39, 0.31],
  /** 梯级立板 / 梁下暗面 */
  timberDark: [0.28, 0.19, 0.14],
  /** 筒瓦（暖灰，带一点青） */
  tile: [0.42, 0.42, 0.43],
  /** 檐口瓦当一排 / 脊 */
  tileDark: [0.29, 0.28, 0.29],
  ridge: [0.37, 0.36, 0.37],
  /** 檐下椽子、望板 */
  rafter: [0.36, 0.25, 0.18],
  /** 浅色砂石（柱础、台明、墩）：暖米色 */
  stone: [0.68, 0.58, 0.48],
  stoneDark: [0.56, 0.46, 0.38],
  /** 墙面灰泥（赭白） / 下碱（土红） */
  plaster: [0.8, 0.7, 0.55],
  plasterRed: [0.48, 0.27, 0.2],
  /** 窗棂 */
  lattice: [0.5, 0.24, 0.16],
  /** 窗纸 / 室内暗面 */
  paper: [0.84, 0.74, 0.56],
  interior: [0.17, 0.12, 0.1],
  /** 幡 */
  banner: [0.54, 0.15, 0.11],
  gold: [0.74, 0.57, 0.3],
  /** 砂岩（检视页占位崖） */
  sandstone: [0.8, 0.58, 0.4],
} satisfies Record<string, RGB>;

const _color = new THREE.Color();
/** sRGB → 线性（顶点色按线性存） */
export function lin(c: RGB, k = 1): [number, number, number] {
  _color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return [_color.r * k, _color.g * k, _color.b * k];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function shade(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

// ───────────── 程序贴图（灰度，乘在顶点色上） ─────────────

const fract = (v: number): number => v - Math.floor(v);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 整数哈希 → 0..1 */
export function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 一张贴图覆盖多少米（UV = 米 / 这个数） */
const TEX_METRES: Record<MatKey, number> = { paint: 1, wood: 1, tile: 1.28, stone: 1.6, plaster: 2, cloth: 1 };
/** 木板贴图沿板长方向再拉长一倍（板端接缝 2 m 一道） */
const TEX_U_STRETCH: Record<MatKey, number> = { paint: 1, wood: 2, tile: 1, stone: 1, plaster: 1, cloth: 1 };

function lumTexture(size: number, fn: (u: number, v: number, px: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const px = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = Math.round(clamp01(fn((x + 0.5) * px, (y + 0.5) * px, px)) * 255);
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = l;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 筒瓦屋面：u 横过坡（垄距 0.32 m）、v 顺坡（每节 0.32 m）。盖瓦圆柱明暗 + 搭接缝，底瓦沟略暗、贴盖瓦两侧一道影 */
function tileLum(u: number, v: number, px: number): number {
  const a = fract(u * 4), b = fract(v * 4), w = px * 4;
  const row = Math.floor(u * 4), course = Math.floor(v * 4);
  const c0 = 0.52, c1 = 0.94;
  const cover = sstep(c0 - w, c0 + w, a) * (1 - sstep(c1 - w, c1 + w, a));
  const t = clamp01((a - c0) / (c1 - c0));
  const round = 0.78 + 0.2 * Math.pow(Math.sin(Math.PI * t), 0.7);
  // 每节盖瓦下端搭在下一节上：一道暗缝 + 缝上沿一点亮边（鱼鳞一样的节奏，远看不像铁皮）
  const lap = (0.6 + 0.4 * sstep(0.0, 0.07 + w, b)) * (b > 0.88 ? 1.05 : 1);
  const tt = clamp01(a / c0);
  const pan = 0.62 - 0.04 * Math.sin(Math.PI * tt);
  const nearCover = Math.max(1 - sstep(0.0, 0.12, a), sstep(c0 - 0.14, c0, a));
  const panLap = 0.86 + 0.14 * sstep(0.0, 0.04 + w, fract(b + 0.5));
  const tone = 0.985 + 0.03 * hash01(row * 7 + course * 131);
  return (cover * round * lap + (1 - cover) * pan * (1 - 0.2 * nearCover) * panLap) * tone;
}

/** 木板：沿 u 的长板（板宽 0.25 m），板缝暗线 + 缝边一点倒角亮，极淡的顺纹；每块板端头错缝 */
function plankLum(u: number, v: number, px: number): number {
  const b = v * 4, i = Math.floor(b), f = fract(b), w = px * 4;
  const seam = sstep(0, 0.035 + w, f) * (1 - sstep(0.985 - w, 1, f));
  const bevel = f > 0.035 && f < 0.09 ? 1.04 : 1;
  const g = fract(u + hash01(i * 3 + 1));
  const joint = sstep(0, 0.004 + px, g) * (1 - sstep(0.996 - px, 1, g));
  const grain = 1 - 0.05 * Math.pow(0.5 + 0.5 * Math.sin((f * 6 + 0.3 * Math.sin(u * Math.PI * 4 + i * 1.7)) * Math.PI * 2), 4);
  const tone = 0.92 + 0.08 * hash01(i * 7 + 3);
  return (0.55 + 0.45 * seam * joint) * grain * tone * bevel;
}

/** 条石：层高 0.4 m、块长 0.8 m、隔层错半块；细灰缝，每块一点明暗差 */
function stoneLum(u: number, v: number, px: number): number {
  const r = Math.floor(v * 4), f = fract(v * 4);
  const bu = u * 2 + (r % 2) * 0.5, c = Math.floor(bu), g = fract(bu);
  const d = Math.min(Math.min(f, 1 - f) * 0.4, Math.min(g, 1 - g) * 0.8);
  const pm = px * 1.6;
  const joint = sstep(0.007, 0.007 + pm * 1.5, d);
  const tone = 0.9 + 0.08 * hash01(r * 13 + (c % 2) * 5 + 1);
  const lip = f > 0.9 ? 1.04 : 1;
  return (0.6 + 0.4 * joint) * tone * lip;
}

const TEXTURES: Partial<Record<MatKey, THREE.Texture>> = {};
function textureFor(k: MatKey): THREE.Texture | null {
  if (k === 'paint' || k === 'plaster' || k === 'cloth') return null;
  TEXTURES[k] ??= lumTexture(512, k === 'tile' ? tileLum : k === 'wood' ? plankLum : stoneLum);
  return TEXTURES[k]!;
}

const SOURCES = new Map<MatKey, THREE.MeshStandardMaterial>();
/** 风格化材质（每种一份、全部件共用；和 Unity 场景件同一套 SF_StylizedLit 参数缺省值） */
export function timberMaterial(k: MatKey, environment?: PieceContext['environment']): THREE.MeshStandardMaterial {
  let src = SOURCES.get(k);
  if (!src) {
    src = new THREE.MeshStandardMaterial({ map: textureFor(k) });
    src.name = `PT_Timber_${k}`;
    src.userData = {
      unityShader: 'Spiritfire/StylizedLit',
      unityFloats: { _Metallic: 0, _Roughness: 1, _Cull: k === 'cloth' ? 0 : 2 },
      unityColors: { _BaseColor: [1, 1, 1, 1] },
    };
    SOURCES.set(k, src);
  }
  const m = createStylizedLit(src, environment);
  if (!m.vertexColors) {
    m.vertexColors = true;
    m.needsUpdate = true;
  }
  return m;
}

// ───────────── 几何桶 + 套件 ─────────────

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

class Bucket {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly t: number[] = [];
  readonly i: number[] = [];
  get count(): number { return this.p.length / 3; }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: readonly number[], u: number, v: number): number {
    const k = this.p.length / 3;
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(col[0], col[1], col[2]);
    this.t.push(u, v);
    return k;
  }
  /** 三角形：按顶点法线自动定朝向（几何法线和存的法线背向就倒序） */
  tri(a: number, b: number, c: number): void {
    const p = this.p, n = this.n;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    const sx = n[a * 3] + n[b * 3] + n[c * 3], sy = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], sz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    if (gx * sx + gy * sy + gz * sz < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface BoxOpts {
  /** 木纹 / 板缝沿本地哪根轴（0 x / 1 y / 2 z） */
  grain?: 0 | 1 | 2;
  /** 脚下积沙（0..1）：离地 1 m 内往沙色里收 */
  dust?: number;
  /** 不要底面（埋地 / 贴墙看不见的面） */
  skipBottom?: boolean;
  /** 顶面另一种颜色 */
  top?: RGB;
  /** 底面另一种颜色（楼板底、梁底压暗） */
  bottom?: RGB;
  /** 贴图密度倍数（< 1 = 石块 / 木板更大） */
  uv?: number;
  /** 加一个碰撞盒（名字） */
  collide?: string;
}

/** 三个正交轴：face = [法线轴, 正负, u 轴, v 轴] */
const FACES: [number, 1 | -1, number, number][] = [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]];

/**
 * 一件木构的几何收集器：构件写进各材质桶，碰撞盒写进 colliders，最后 build() 合成 BuiltPiece。
 */
export class Kit {
  readonly colliders: PieceBox[] = [];
  readonly updaters: ((dt: number, t: number) => void)[] = [];
  readonly extras: THREE.Object3D[] = [];
  private readonly buckets = new Map<MatKey, Bucket>();
  /** 幡的每顶点摆动参数：[法向 x, z, 权重, 相位] */
  private readonly cloth: number[] = [];

  constructor(readonly ctx: PieceContext, readonly name = 'timber') {}

  bucket(k: MatKey): Bucket {
    let b = this.buckets.get(k);
    if (!b) {
      b = new Bucket();
      this.buckets.set(k, b);
    }
    return b;
  }

  /** 顶点色（线性）：积沙 + 明暗系数 */
  colorAt(col: RGB, x: number, y: number, z: number, dust = 0, k = 1): number[] {
    if (dust > 0) {
      const g = this.ctx.ground(x, z);
      const t = clamp01(1 - (y - g) / 0.8);
      if (t > 0) return lin(mix(col, PAL.dust, dust * t * t * 0.6), k);
    }
    return lin(col, k);
  }

  /** 长方体：中心 c、尺寸 s，可选朝向 q（缺省轴对齐）。UV 按米、在世界坐标里连续（石缝 / 板缝跨块对齐） */
  box(c: V3, s: V3, col: RGB, mat: MatKey = 'paint', o: BoxOpts = {}, q?: THREE.Quaternion): void {
    const bk = this.bucket(mat), T = (o.uv ?? 1) / TEX_METRES[mat], TU = T / TEX_U_STRETCH[mat];
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    const pl = [0, 0, 0], nl = [0, 0, 0];
    for (const [ax, sg, ua0, va0] of FACES) {
      if (o.skipBottom && ax === 1 && sg < 0) continue;
      let ua = ua0, va = va0;
      if (o.grain !== undefined && o.grain !== ax && va0 === o.grain) {
        ua = va0;
        va = ua0;
      }
      nl[0] = nl[1] = nl[2] = 0;
      nl[ax] = sg;
      _v1.set(nl[0], nl[1], nl[2]);
      if (q) _v1.applyQuaternion(q);
      const fc = ax === 1 && sg > 0 && o.top ? o.top : ax === 1 && sg < 0 && o.bottom ? o.bottom : col;
      const idx: number[] = [];
      for (const [cu, cv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pl[ax] = sg * h[ax];
        pl[ua] = cu * h[ua];
        pl[va] = cv * h[va];
        _v0.set(pl[0], pl[1], pl[2]);
        if (q) _v0.applyQuaternion(q);
        const x = _v0.x + c[0], y = _v0.y + c[1], z = _v0.z + c[2];
        const u = (pl[ua] + (q ? 0 : c[ua])) * TU, v = (pl[va] + (q ? 0 : c[va])) * T;
        idx.push(bk.vert(x, y, z, _v1.x, _v1.y, _v1.z, this.colorAt(fc, x, y, z, o.dust), u, v));
      }
      bk.quad(idx[0], idx[1], idx[2], idx[3]);
    }
    if (o.collide) this.collide(c, s, o.collide, q);
  }

  /** 两点之间的方木（截面 w 宽 × h 高，本地 y 尽量朝上）；木纹沿长向 */
  beam(a: V3, b: V3, w: number, h: number, col: RGB, mat: MatKey = 'paint', o: BoxOpts = {}): void {
    const q = beamFrame(a, b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 1e-4) return;
    this.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [len, h, w], col, mat, { grain: 0, ...o }, q);
  }

  /** 绕 y 轴转 yaw 度（俯视逆时针）的长方体 */
  boxYaw(c: V3, s: V3, yawDeg: number, col: RGB, mat: MatKey = 'paint', o: BoxOpts = {}): void {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, (yawDeg * Math.PI) / 180);
    this.box(c, s, col, mat, o, q);
  }

  /** 圆柱（朱漆柱）：12 边、收分、柱脚一段积沙，柱顶封口 */
  column(x: number, z: number, y0: number, y1: number, r: number, col: RGB = PAL.lacquer, o: { seg?: number; taper?: number; dust?: number; mat?: MatKey } = {}): void {
    const seg = o.seg ?? (this.ctx.low ? 8 : 12), taper = o.taper ?? 0.1, dust = o.dust ?? 1;
    const bk = this.bucket(o.mat ?? 'paint');
    const H = y1 - y0;
    const ys = [y0, y0 + Math.min(0.35, H * 0.1), y0 + Math.min(1.1, H * 0.3), y1 - Math.min(0.4, H * 0.1), y1];
    const rows: number[][] = [];
    const slope = (r * taper) / H;
    for (const y of ys) {
      const f = (y - y0) / H;
      // 梭柱：上段收分、柱头再卷杀一点
      const rr = r * (1 - taper * f) * (f > 0.9 ? 1 - (f - 0.9) * 0.6 : 1);
      const row: number[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
        const px = x + cx * rr, pz = z + cz * rr;
        _v1.set(cx, slope, cz).normalize();
        row.push(bk.vert(px, y, pz, _v1.x, _v1.y, _v1.z, this.colorAt(col, px, y, pz, dust, f > 0.55 ? 0.93 + 0.07 * (1 - f) : 1), a * r, y));
      }
      rows.push(row);
    }
    for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < seg; j++) bk.quad(rows[k][j], rows[k][j + 1], rows[k + 1][j + 1], rows[k + 1][j]);
    const rt = r * (1 - taper) * 0.94, cc = this.colorAt(PAL.timberDark, x, y1, z);
    const center = bk.vert(x, y1, z, 0, 1, 0, cc, 0, 0);
    const ring: number[] = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(bk.vert(x + Math.cos(a) * rt, y1, z + Math.sin(a) * rt, 0, 1, 0, cc, 0, 0));
    }
    for (let j = 0; j < seg; j++) bk.tri(center, ring[j], ring[j + 1]);
  }

  /** 旋转体：profile = [半径, 高] 自下而上（柱础覆盆、宝珠、塔刹） */
  lathe(x: number, y: number, z: number, profile: [number, number][], col: RGB, mat: MatKey = 'stone', seg = 16, dust = 0): void {
    const bk = this.bucket(mat);
    const n = profile.length;
    const nrm: [number, number][] = profile.map((_, i) => {
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) {
      const [r, py] = profile[i], [nr, ny] = nrm[i];
      const row: number[] = [];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
        const px = x + cx * r, pz = z + cz * r;
        row.push(bk.vert(px, y + py, pz, cx * nr, ny, cz * nr, this.colorAt(col, px, y + py, pz, dust), (a * Math.max(r, 0.2)) / TEX_METRES[mat], (y + py) / TEX_METRES[mat]));
      }
      rows.push(row);
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) bk.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]);
  }

  /** 原始四边形（世界坐标），法线给定或自动 */
  quad(mat: MatKey, pts: V3[], col: RGB | RGB[], normal?: V3, uv?: [number, number][]): void {
    const bk = this.bucket(mat);
    _v0.set(...pts[0]);
    _v1.set(...pts[1]).sub(_v0);
    _v2.set(...pts[2]).sub(_v0);
    const n = normal ? _v3.set(...normal) : _v3.copy(_v1).cross(_v2).normalize();
    const idx = pts.map((p, i) => {
      const c = Array.isArray(col[0]) ? (col as RGB[])[i] : (col as RGB);
      return bk.vert(p[0], p[1], p[2], n.x, n.y, n.z, lin(c), uv ? uv[i][0] : p[0] / TEX_METRES[mat], uv ? uv[i][1] : p[1] / TEX_METRES[mat]);
    });
    if (idx.length === 3) bk.tri(idx[0], idx[1], idx[2]);
    else bk.quad(idx[0], idx[1], idx[2], idx[3]);
  }

  /** 碰撞盒（世界坐标） */
  collide(c: V3, s: V3, name?: string, q?: THREE.Quaternion): void {
    const box: PieceBox = { center: [r3(c[0]), r3(c[1]), r3(c[2])], size: [r3(s[0]), r3(s[1]), r3(s[2])] };
    if (q && Math.abs(q.w) < 0.999999) box.rotation = [q.x, q.y, q.z, q.w];
    if (name) box.name = name;
    this.colliders.push(box);
  }

  /** 两点之间一根方木的碰撞盒 */
  collideBeam(a: V3, b: V3, w: number, h: number, name?: string): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this.collide([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [len, h, w], name, beamFrame(a, b));
  }

  /**
   * 幡：上端 top 挂一根横杆，布面宽 w、长 len，布面朝 facing（度，俯视逆时针，0 = 布面法线朝 +x）。
   * 写进 cloth 桶，build 时成一张动态网格，update 里按风摆。
   */
  banner(top: V3, w: number, len: number, facing: number, o: { col?: RGB; trim?: RGB; phase?: number; amp?: number; tail?: boolean } = {}): void {
    const bk = this.bucket('cloth');
    const a = (facing * Math.PI) / 180;
    const nx = Math.cos(a), nz = -Math.sin(a); // 布面法线
    const tx = -nz, tz = nx; // 横向
    const nxs = 4, nys = this.ctx.low ? 8 : 16;
    const col = o.col ?? PAL.banner, trim = o.trim ?? PAL.gold;
    const phase = o.phase ?? 0, amp = o.amp ?? 0.22;
    const rows: number[][] = [];
    for (let j = 0; j <= nys; j++) {
      const v = j / nys;
      const row: number[] = [];
      for (let i = 0; i <= nxs; i++) {
        const u = i / nxs - 0.5;
        // 幡尾：下端收成燕尾
        const tailCut = o.tail !== false && v > 0.9 ? (v - 0.9) * 10 * (0.5 - Math.abs(u)) * 0.6 : 0;
        const x = top[0] + tx * u * w, z = top[2] + tz * u * w, y = top[1] - v * len + tailCut * len * 0.08;
        const band = v < 0.06 || (v > 0.84 && v < 0.88) ? trim : Math.abs(u) > 0.42 ? shade(col, 0.82) : col;
        row.push(bk.vert(x, y, z, nx, 0, nz, lin(band), u, v));
        this.cloth.push(nx, nz, Math.pow(v, 1.25), phase + u * 0.8);
      }
      rows.push(row);
    }
    for (let j = 0; j < nys; j++) for (let i = 0; i < nxs; i++) {
      const a0 = rows[j][i], a1 = rows[j][i + 1], b1 = rows[j + 1][i + 1], b0 = rows[j + 1][i];
      bk.i.push(a0, b0, b1, a0, b1, a1);
    }
    // 横杆 + 两头宝珠
    this.beam([top[0] - tx * (w / 2 + 0.12), top[1] + 0.04, top[2] - tz * (w / 2 + 0.12)], [top[0] + tx * (w / 2 + 0.12), top[1] + 0.04, top[2] + tz * (w / 2 + 0.12)], 0.06, 0.06, PAL.beam);
    this.clothAmp = Math.max(this.clothAmp, amp);
  }
  private clothAmp = 0;

  /** 三角形数（报告用） */
  triangles(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.i.length / 3;
    return n;
  }

  build(): BuiltPiece {
    const group = new THREE.Group();
    group.name = this.name;
    const geoms: THREE.BufferGeometry[] = [];
    for (const [k, bk] of this.buckets) {
      if (!bk.count) continue;
      const g = bk.geometry();
      geoms.push(g);
      const mesh = new THREE.Mesh(g, timberMaterial(k, this.ctx.environment));
      mesh.name = `${this.name}_${k}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (k === 'cloth') this.animateCloth(g);
    }
    for (const e of this.extras) group.add(e);
    group.userData.triangles = this.triangles();
    const ups = this.updaters;
    return {
      object: group,
      colliders: this.colliders,
      update: ups.length ? (dt, t) => { for (const u of ups) u(dt, t); } : undefined,
      dispose() {
        for (const g of geoms) g.dispose();
      },
    };
  }

  /** 幡：每帧沿布面法线摆（下端摆得多），再横向轻轻晃 */
  private animateCloth(g: THREE.BufferGeometry): void {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    pos.setUsage(THREE.DynamicDrawUsage);
    const base = Float32Array.from(pos.array as Float32Array);
    const anim = this.cloth, amp = this.clothAmp || 0.22;
    this.updaters.push((_dt, t) => {
      const arr = pos.array as Float32Array;
      for (let k = 0, n = base.length / 3; k < n; k++) {
        const nx = anim[k * 4], nz = anim[k * 4 + 1], w = anim[k * 4 + 2], ph = anim[k * 4 + 3];
        const s = Math.sin(t * 2.1 + ph - w * 3.2) * 0.7 + Math.sin(t * 3.7 + ph * 1.7 - w * 5.0) * 0.3;
        const side = Math.sin(t * 1.3 + ph * 0.5) * 0.25;
        const d = amp * w * s;
        arr[k * 3] = base[k * 3] + nx * d - nz * side * w * amp;
        arr[k * 3 + 1] = base[k * 3 + 1] + Math.abs(s) * w * amp * 0.15;
        arr[k * 3 + 2] = base[k * 3 + 2] + nz * d + nx * side * w * amp;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
    });
  }
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** a → b 方木的朝向：本地 x 沿长向、本地 y 尽量朝上 */
export function beamFrame(a: V3, b: V3): THREE.Quaternion {
  const x = _v0.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const up = Math.abs(x.y) > 0.98 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0);
  const z = _v1.copy(x).cross(up).normalize();
  const y = _v2.copy(z).cross(x).normalize();
  _m4.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m4);
}

/** 按三根基向量（x、y；z = x × y）的碰撞盒 */
export function frameQuat(x: THREE.Vector3, y: THREE.Vector3): THREE.Quaternion {
  const z = new THREE.Vector3().copy(x).cross(y).normalize();
  _m4.makeBasis(x, y, z);
  return _q.setFromRotationMatrix(_m4).clone();
}

// ───────────── 柱、柱础、斗拱 ─────────────

/** 覆盆柱础：方石座 + 覆盆（r = 柱半径） */
export function plinth(kit: Kit, x: number, z: number, y: number, r: number, o: { h?: number; col?: RGB } = {}): void {
  const h = plinthH(r, o.h), col = o.col ?? PAL.stone;
  const base = r * 2.7, hb = h * 0.45;
  // 方座往下多埋 0.2，坡地上也不悬空
  kit.box([x, y + (hb - 0.2) / 2, z], [base, hb + 0.2, base], col, 'stone', { skipBottom: true });
  kit.lathe(x, y + hb, z, [[r * 1.32, 0], [r * 1.3, 0.05], [r * 1.18, (h - hb) * 0.6], [r * 1.04, (h - hb) * 0.9], [r * 0.98, h - hb]], col, 'stone', kit.ctx.low ? 10 : 16);
}
/** 柱础总高（方座 + 覆盆） */
export const plinthH = (r: number, h?: number): number => h ?? Math.min(0.3, r * 0.75);

/** 一根落地柱：柱础 + 朱漆柱；collide 给名字就加碰撞盒（方 2r） */
export function post(kit: Kit, x: number, z: number, y0: number, y1: number, r: number, o: { col?: RGB; collide?: string; plinth?: boolean } = {}): void {
  if (o.plinth !== false) plinth(kit, x, z, y0, r);
  const ph = o.plinth !== false ? plinthH(r) - 0.02 : 0;
  kit.column(x, z, y0 + ph, y1, r, o.col ?? PAL.lacquer);
  if (o.collide) kit.collide([x, (y0 + y1) / 2, z], [2 * r, y1 - y0, 2 * r], o.collide);
}

/** 本地（外 = out、沿墙 = along）偏移 → 世界 */
function local(x: number, y: number, z: number, out: [number, number], lx: number, ly: number, lz: number): V3 {
  return [x + lx * out[0] - lz * out[1], y + ly, z + lx * out[1] + lz * out[0]];
}

/**
 * 简化斗拱（一朵）：栌斗 + 泥道栱 / 华栱 + 散斗，tiers = 2 再加慢栱、外跳华栱、令栱和耍头。
 * (x, y, z) = 栌斗底（柱头 / 普拍枋顶），out = 朝外的单位向量（俯视），s = 尺度（1 ≈ 柱径 0.6 m 的殿）。返回斗拱顶高。
 */
export function bracket(kit: Kit, x: number, y: number, z: number, out: [number, number], s = 1, o: { tiers?: 1 | 2; arm?: RGB; block?: RGB } = {}): number {
  const yaw = (Math.atan2(-out[1], out[0]) * 180) / Math.PI;
  const arm = o.arm ?? PAL.bracket, blk = o.block ?? PAL.bracketBlock, tiers = o.tiers ?? 2;
  const B = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: RGB): void =>
    kit.boxYaw(local(x, y, z, out, lx * s, ly * s, lz * s), [sx * s, sy * s, sz * s], yaw, col);
  B(0, 0.15, 0, 0.58, 0.3, 0.58, blk);
  const y1 = 0.3;
  B(0, y1 + 0.12, 0, 0.2, 0.24, 1.36, arm);
  B(0.3, y1 + 0.12, 0, 1.25, 0.24, 0.2, arm);
  for (const lz of [-0.58, 0.58]) B(0, y1 + 0.32, lz, 0.26, 0.16, 0.26, blk);
  B(0.78, y1 + 0.32, 0, 0.26, 0.16, 0.26, blk);
  if (tiers === 1) {
    B(0.78, y1 + 0.52, 0, 0.2, 0.24, 1.1, arm);
    return y + (y1 + 0.64) * s;
  }
  const y2 = y1 + 0.4;
  B(0, y2 + 0.12, 0, 0.2, 0.24, 1.9, arm);
  B(0.55, y2 + 0.12, 0, 2.05, 0.24, 0.2, arm);
  B(1.45, y2 + 0.12, 0, 0.2, 0.24, 1.36, arm);
  for (const lz of [-0.86, 0.86]) B(0, y2 + 0.32, lz, 0.26, 0.16, 0.26, blk);
  for (const lz of [-0.6, 0, 0.6]) B(1.45, y2 + 0.32, lz, 0.26, 0.16, 0.26, blk);
  // 耍头：伸出去的枋头，刷一点青绿
  B(0.95, y2 + 0.52, 0, 1.95, 0.22, 0.18, arm);
  B(1.95, y2 + 0.52, 0, 0.12, 0.2, 0.19, PAL.teal);
  return y + (y2 + 0.64) * s;
}

// ───────────── 勾栏 ─────────────

export interface RailOpts {
  /** 寻杖高（缺省 1.05） */
  h?: number;
  /** 望柱最大间距（缺省 1.5） */
  span?: number;
  col?: RGB;
  panel?: RGB;
  /** 望柱头的小斗（缺省灰青绿斗色）；栈道这类素木栏杆给木色 */
  cap?: RGB;
  /** 碰撞盒名字；false = 不给 */
  collide?: string | false;
  /** 两头的望柱（和别的栏杆接上时可以省掉一头） */
  ends?: [boolean, boolean];
}

/** 勾栏：望柱 + 寻杖 + 盆唇 + 地栿，盆唇下华版、上蜀柱；a、b = 两端的地面点（可以一高一低：楼梯扶手） */
export function railing(kit: Kit, a: V3, b: V3, o: RailOpts = {}): void {
  const h = o.h ?? 1.05, col = o.col ?? PAL.lacquer, panel = o.panel ?? shade(PAL.beamRed, 0.85);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (len < 0.05) return;
  const n = Math.max(1, Math.ceil(len / (o.span ?? 1.5)));
  const at = (t: number, dy: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + dy, a[2] + (b[2] - a[2]) * t];
  for (let i = 0; i <= n; i++) {
    if ((i === 0 && o.ends?.[0] === false) || (i === n && o.ends?.[1] === false)) continue;
    const p = at(i / n, 0);
    kit.box([p[0], p[1] + (h + 0.1) / 2, p[2]], [0.13, h + 0.1, 0.13], col, 'paint', { dust: 0.4 });
    kit.box([p[0], p[1] + h + 0.13, p[2]], [0.17, 0.07, 0.17], o.cap ?? PAL.bracketBlock);
  }
  kit.beam(at(0, h), at(1, h), 0.08, 0.07, col);
  kit.beam(at(0, 0.56), at(1, 0.56), 0.1, 0.07, col);
  kit.beam(at(0, 0.07), at(1, 0.07), 0.12, 0.12, PAL.beam);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    kit.beam(at(t0 + 0.04 / n, 0.33), at(t1 - 0.04 / n, 0.33), 0.035, 0.38, panel);
    const m = at((t0 + t1) / 2, 0);
    kit.box([m[0], m[1] + (0.6 + h) / 2, m[2]], [0.07, h - 0.6, 0.07], col);
  }
  if (o.collide !== false) kit.collideBeam(at(0, h / 2), at(1, h / 2), 0.16, h, o.collide ?? 'railing');
}

// ───────────── 木梯 ─────────────

export interface StairOpts {
  width: number;
  /** 级数（缺省按 0.16 m 一级） */
  steps?: number;
  /** 梯梁根数（缺省：宽 ≤ 3.5 m 两根，再宽每 2.6 m 加一根） */
  stringers?: number;
  /** 梯下立柱（落到地面，带剪刀撑） */
  posts?: boolean;
  postStep?: number;
  /** 左 / 右（面朝上坡）扶手 */
  railL?: boolean;
  railR?: boolean;
  collide?: string | false;
}

/**
 * 一跑木梯：a = 起步处（下端）踏面中线的地面点，b = 到顶处（上端）中线、和上面平台同高。
 * 踏板骑在 a→b 的斜线上（每级中点正好在线上，上下差不过半级），碰撞是一个斜 OBB，顶面就是这条线。
 */
export function stairRun(kit: Kit, a: V3, b: V3, o: StairOpts): { dir: [number, number]; lat: [number, number] } {
  const dx = b[0] - a[0], dz = b[2] - a[2], run = Math.hypot(dx, dz), rise = b[1] - a[1];
  const dir: [number, number] = [dx / run, dz / run], lat: [number, number] = [-dir[1], dir[0]];
  const n = o.steps ?? Math.max(2, Math.round(rise / 0.16));
  const q = run / n, D = rise / n, W = o.width;
  const yaw = (Math.atan2(-dir[1], dir[0]) * 180) / Math.PI;
  const P = (s: number, l: number, y: number): V3 => [a[0] + dir[0] * s + lat[0] * l, y, a[2] + dir[1] * s + lat[1] * l];
  const line = (s: number): number => a[1] + (s / run) * rise;
  for (let k = 1; k <= n; k++) {
    const s0 = (k - 1) * q, yTop = a[1] + (k - 0.5) * D;
    kit.boxYaw(P(s0 + q / 2 - 0.02, 0, yTop - 0.03), [q + 0.04, 0.06, W - 0.04], yaw, PAL.plank, 'wood', { grain: 2 });
    const yBot = k === 1 ? a[1] : yTop - D;
    if (yTop - 0.06 - yBot > 0.01) kit.boxYaw(P(s0 + 0.03, 0, (yBot + yTop - 0.06) / 2), [0.03, yTop - 0.06 - yBot, W - 0.08], yaw, PAL.timberDark);
  }
  // 梯梁：两侧外露一段（高出踏面 0.12），中间的藏在踏板下
  const ns = o.stringers ?? (W <= 3.5 ? 2 : 2 + Math.ceil((W - 3.5) / 2.6));
  const depth = 0.42, alpha = Math.atan2(rise, run), sec = 1 / Math.cos(alpha);
  const lines: number[] = [];
  for (let i = 0; i < ns; i++) lines.push(-W / 2 + 0.06 + (i * (W - 0.12)) / (ns - 1));
  for (let i = 0; i < ns; i++) {
    const outer = i === 0 || i === ns - 1;
    const top = outer ? D / 2 + 0.12 : -0.08;
    const off = top - (depth / 2) * sec;
    kit.beam(P(-0.05, lines[i], line(-0.05) + off), P(run + 0.02, lines[i], line(run + 0.02) + off), outer ? 0.1 : 0.12, depth, PAL.beam);
  }
  // 立柱 + 剪刀撑
  if (o.posts !== false) {
    const step = o.postStep ?? 2.4;
    const ss: number[] = [];
    for (let s = 0.5; s < run - 0.2; s += step) ss.push(s);
    if (run - (ss[ss.length - 1] ?? 0) > 1.2) ss.push(run - 0.25);
    const postLines = ns > 2 ? lines : [lines[0], lines[ns - 1]];
    let prev: { s: number; tops: number[]; bots: number[] } | null = null;
    for (const s of ss) {
      const tops: number[] = [], bots: number[] = [];
      for (const l of postLines) {
        const p = P(s, l, 0);
        const yTop = line(s) + (l === lines[0] || l === lines[ns - 1] ? D / 2 + 0.12 : -0.08) - depth * sec;
        const yBot = kit.ctx.ground(p[0], p[2]);
        tops.push(yTop);
        bots.push(yBot);
        if (yTop - yBot < 0.25) continue;
        kit.box([p[0], (yTop + yBot - 0.3) / 2, p[2]], [0.2, yTop - yBot + 0.3, 0.2], PAL.beam, 'paint', { dust: 1 });
        if (yTop - yBot > 1.8 && o.collide !== false) kit.collide([p[0], (yTop + yBot) / 2, p[2]], [0.2, yTop - yBot, 0.2], 'stair post');
      }
      // 横向剪刀撑（每两根柱之间一个 X）
      for (let i = 0; i + 1 < postLines.length; i++) {
        const h0 = Math.min(tops[i], tops[i + 1]) - 0.2, b0 = Math.max(bots[i], bots[i + 1]) + 0.35;
        if (h0 - b0 < 1.2) continue;
        kit.beam(P(s, postLines[i], b0), P(s, postLines[i + 1], h0), 0.09, 0.12, PAL.timberDark);
        kit.beam(P(s, postLines[i], h0), P(s, postLines[i + 1], b0), 0.09, 0.12, PAL.timberDark);
      }
      // 纵向斜撑（外侧两条线）
      if (prev) {
        for (const li of [0, postLines.length - 1]) {
          const l = postLines[li];
          const hA = prev.tops[li] - 0.25, bB = bots[li] + 0.4;
          if (hA - bB > 1.0) kit.beam(P(prev.s, l + (li === 0 ? -0.12 : 0.12), hA), P(s, l + (li === 0 ? -0.12 : 0.12), bB), 0.08, 0.12, PAL.timberDark);
        }
      }
      prev = { s, tops, bots };
    }
  }
  const rail = (side: 1 | -1): void => {
    const l = side * (W / 2 - 0.05);
    railing(kit, P(0.3 * q, l, a[1] + 0.5 * D + 0.0), P(run - 0.3 * q, l, b[1] - 0.5 * D), { collide: o.collide === false ? false : `${o.collide ?? 'stair'} rail` });
  };
  if (o.railR) rail(1);
  if (o.railL) rail(-1);
  if (o.collide !== false) {
    const L = Math.hypot(run, rise), th = 0.35;
    const x = new THREE.Vector3(dir[0] * Math.cos(alpha), Math.sin(alpha), dir[1] * Math.cos(alpha));
    const y = new THREE.Vector3(-dir[0] * Math.sin(alpha), Math.cos(alpha), -dir[1] * Math.sin(alpha));
    const mid: V3 = [(a[0] + b[0]) / 2 - y.x * th / 2, (a[1] + b[1]) / 2 - y.y * th / 2, (a[2] + b[2]) / 2 - y.z * th / 2];
    kit.collide(mid, [L, th, W], o.collide ?? 'stair run', frameQuat(x, y));
  }
  return { dir, lat };
}

/** 平台 / 楼面：木板面（板沿 grain 轴）+ 下面一圈边枋；y = 面高 */
export function deck(kit: Kit, x0: number, x1: number, z0: number, z1: number, y: number, o: { th?: number; grain?: 0 | 2; joists?: number; collide?: string | false; edge?: RGB } = {}): void {
  const th = o.th ?? 0.12;
  kit.box([(x0 + x1) / 2, y - th / 2, (z0 + z1) / 2], [x1 - x0, th, z1 - z0], PAL.plank, 'wood', { grain: o.grain ?? 0, bottom: shade(PAL.timberDark, 1.2) });
  const e = o.edge ?? PAL.beam, eh = 0.28;
  kit.box([(x0 + x1) / 2, y - th - eh / 2, z0 + 0.08], [x1 - x0, eh, 0.16], e);
  kit.box([(x0 + x1) / 2, y - th - eh / 2, z1 - 0.08], [x1 - x0, eh, 0.16], e);
  kit.box([x0 + 0.08, y - th - eh / 2, (z0 + z1) / 2], [0.16, eh, z1 - z0 - 0.32], e);
  kit.box([x1 - 0.08, y - th - eh / 2, (z0 + z1) / 2], [0.16, eh, z1 - z0 - 0.32], e);
  const js = o.joists ?? 1.2;
  if (js > 0) {
    const alongX = (o.grain ?? 0) === 2;
    const span0 = alongX ? x0 : z0, span1 = alongX ? x1 : z1;
    for (let s = span0 + js; s < span1 - 0.3; s += js) {
      if (alongX) kit.box([s, y - th - 0.11, (z0 + z1) / 2], [0.12, 0.22, z1 - z0 - 0.32], PAL.timberDark);
      else kit.box([(x0 + x1) / 2, y - th - 0.11, s], [x1 - x0 - 0.32, 0.22, 0.12], PAL.timberDark);
    }
  }
  if (o.collide !== false) kit.collide([(x0 + x1) / 2, y - 0.2, (z0 + z1) / 2], [x1 - x0, 0.4, z1 - z0], o.collide ?? 'deck');
}

// ───────────── 门窗 ─────────────

/**
 * 一开间的直棂窗 / 格扇门：a、b = 两柱之间墙线上的地面点（俯视），h = 到额枋底的高度。
 * 窗：下面一段槛墙（sill 高），上面直棂；门：几扇格扇（上棂下裙板）。背后一层暗面，看进去有深度。
 */
export function lattice(kit: Kit, a: V3, b: V3, h: number, o: { kind?: 'window' | 'door'; sill?: number; inset?: number; spacing?: number; back?: RGB } = {}): void {
  const kind = o.kind ?? 'window', sill = kind === 'door' ? 0 : o.sill ?? 0.9;
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
  const P = (t: number, y: number, n = 0): V3 => [a[0] + ux * t - uz * n, a[1] + y, a[2] + uz * t + ux * n];
  const inset = o.inset ?? 0;
  // 背后暗面
  kit.boxYaw(P(len / 2, (sill + h) / 2, inset + 0.06), [len, h - sill, 0.04], yaw, o.back ?? PAL.interior);
  if (sill > 0) {
    kit.boxYaw(P(len / 2, sill / 2, inset), [len, sill, 0.22], yaw, PAL.plasterRed, 'plaster', { top: PAL.beam });
  }
  // 框
  const fr = PAL.lattice;
  kit.boxYaw(P(0.05, (sill + h) / 2, inset), [0.1, h - sill, 0.12], yaw, fr);
  kit.boxYaw(P(len - 0.05, (sill + h) / 2, inset), [0.1, h - sill, 0.12], yaw, fr);
  kit.boxYaw(P(len / 2, sill + 0.05, inset), [len, 0.1, 0.12], yaw, fr);
  kit.boxYaw(P(len / 2, h - 0.06, inset), [len, 0.12, 0.12], yaw, fr);
  if (kind === 'window') {
    // 直棂：上下两段，中间一道横档
    const top = h - 0.12, bot = sill + 0.1, mid = bot + (top - bot) * 0.78;
    kit.boxYaw(P(len / 2, mid, inset), [len, 0.08, 0.1], yaw, fr);
    const sp = o.spacing ?? 0.16;
    const nb = Math.max(2, Math.floor((len - 0.2) / sp));
    for (let i = 1; i < nb; i++) {
      const t = 0.1 + ((len - 0.2) * i) / nb;
      kit.boxYaw(P(t, (bot + mid) / 2, inset), [0.045, mid - bot, 0.06], yaw, fr);
    }
    kit.boxYaw(P(len / 2, (mid + top) / 2, inset + 0.02), [len - 0.2, top - mid - 0.04, 0.03], yaw, PAL.paper, 'plaster');
  } else {
    const leaves = Math.max(2, Math.round(len / 0.95));
    const lw = (len - 0.2) / leaves;
    for (let i = 0; i < leaves; i++) {
      const t0 = 0.1 + i * lw, t1 = t0 + lw;
      kit.boxYaw(P(t1, h / 2, inset), [0.06, h - 0.2, 0.1], yaw, fr);
      const skirt = h * 0.36;
      kit.boxYaw(P((t0 + t1) / 2, 0.1 + skirt / 2, inset + 0.01), [lw - 0.06, skirt, 0.05], yaw, PAL.beamRed);
      kit.boxYaw(P((t0 + t1) / 2, 0.1 + skirt + 0.04, inset), [lw, 0.08, 0.1], yaw, fr);
      // 方格眼
      const g0 = 0.1 + skirt + 0.08, g1 = h - 0.2;
      const cols = 3, rows = Math.max(3, Math.round((g1 - g0) / 0.24));
      for (let c = 1; c < cols; c++) kit.boxYaw(P(t0 + (lw * c) / cols, (g0 + g1) / 2, inset), [0.035, g1 - g0, 0.05], yaw, fr);
      for (let r = 1; r < rows; r++) kit.boxYaw(P((t0 + t1) / 2, g0 + ((g1 - g0) * r) / rows, inset), [lw - 0.04, 0.035, 0.05], yaw, fr);
      kit.boxYaw(P((t0 + t1) / 2, (g0 + g1) / 2, inset + 0.03), [lw - 0.06, g1 - g0, 0.02], yaw, PAL.paper, 'plaster');
    }
  }
}

// ───────────── 屋面 ─────────────

/** 屋面在本地平面上的一块坡：outward 法向 = 本地 x / z 轴的正 / 负；d = 离檐口的水平进深，s = 横向坐标 */
interface Patch {
  ax: 0 | 2;
  sg: 1 | -1;
  /** 檐口线在法向轴上的坐标 */
  edge: number;
  /** 进深范围 0..d1 */
  d1: number;
  lo(d: number): number;
  hi(d: number): number;
  /** 这一侧是自由边（悬山的山面、歇山山花以上、腰檐不转角的端头）：补一条博风 / 封边 */
  openLo?(d: number): boolean;
  openHi?(d: number): boolean;
  /** 额外必须落在网格上的进深（折点） */
  rows?: number[];
  /** 这块坡的檐口要不要排檐椽 */
  rafters?: boolean;
}

interface Surface {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  eave: number;
  rise: number;
  /** 剖面的进深（g 的归一化分母） */
  D: number;
  a: number;
  lift: number;
  flare: number;
  liftR: number;
  /** 四角起翘开关：(+x,+z) (−x,+z) (−x,−z) (+x,−z) */
  corners: [boolean, boolean, boolean, boolean];
  thick: number;
}

/** 檐口到脊的剖面：g(t) = a·t + (1 − a)·t²（下缓上陡，举折） */
const profile = (S: Surface, d: number): number => {
  const t = Math.max(0, d / S.D);
  return S.eave + S.rise * (S.a * t + (1 - S.a) * t * t);
};

/** 屋面上表面（不含起翘）离檐口 d 米处的高度：件里摆露明的椽、檩（塌顶）时用 */
export function roofHeightAt(o: Pick<RoofOpts, 'eave' | 'ridge' | 'hz' | 'curve'>, d: number): number {
  const t = Math.min(1, Math.max(0, d / o.hz)), a = o.curve ?? 0.55;
  return o.eave + (o.ridge - o.eave) * (a * t + (1 - a) * t * t);
}

/** 本地平面点（未起翘）→ 世界坐标（起翘、出翘之后） */
function surfPoint(S: Surface, lx: number, lz: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(lx), az = Math.abs(lz);
  const q = lx >= 0 ? (lz >= 0 ? 0 : 3) : lz >= 0 ? 1 : 2;
  let w = 0;
  if (S.corners[q] && S.lift + S.flare > 0) {
    const r = S.liftR;
    const cx = clamp01((ax - (S.hx - r)) / r), cz = clamp01((az - (S.hz - r)) / r);
    w = Math.pow(cx, 2.2) * Math.pow(cz, 2.2);
  }
  const f = (S.flare * w) / Math.SQRT2;
  const px = lx + Math.sign(lx) * f, pz = lz + Math.sign(lz) * f, py = y + S.lift * w;
  return out.set(S.x + px * S.cos + pz * S.sin, py, S.z - px * S.sin + pz * S.cos);
}

function patchPlan(P: Patch, d: number, s: number): [number, number] {
  return P.ax === 2 ? [s, P.sg * (P.edge - d)] : [P.sg * (P.edge - d), s];
}

export interface RoofMakeOpts {
  tile?: RGB;
  under?: RGB;
  res?: number;
  /** 屋面破洞（世界坐标）：月泉阁东段塌顶 */
  hole?: (x: number, z: number) => boolean;
  /** 檐椽：墙线到檐口的出挑、间距 */
  rafterOut?: number;
  rafterStep?: number;
  /** 博风 / 封边颜色 */
  barge?: RGB;
}

const _p = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pd = new THREE.Vector3();

/**
 * 铺一组坡（上表面瓦、下表面望板 + 檐口封边 + 自由边博风 + 破洞边），返回取屋面点的函数（脊饰用）。
 */
function makePatches(kit: Kit, S: Surface, patches: Patch[], o: RoofMakeOpts): (P: Patch, d: number, s: number, lift?: number) => V3 {
  const res = o.res ?? (kit.ctx.low ? 1.0 : 0.5);
  const tileCol = o.tile ?? PAL.tile, under = o.under ?? PAL.rafter, barge = o.barge ?? PAL.beam;
  const top = kit.bucket('tile'), bot = kit.bucket('wood'), edge = kit.bucket('paint');
  const T = 1 / TEX_METRES.tile, TW = 1 / TEX_METRES.wood, TWU = TW / TEX_U_STRETCH.wood;
  const point = (P: Patch, d: number, s: number, out: THREE.Vector3): THREE.Vector3 => {
    const [lx, lz] = patchPlan(P, d, s);
    return surfPoint(S, lx, lz, profile(S, d), out);
  };
  const normalAt = (P: Patch, d: number, s: number, out: THREE.Vector3): THREE.Vector3 => {
    const e = 0.05;
    point(P, Math.max(0, d - e), s, _pa);
    point(P, d + e, s, _pb);
    point(P, d, s - e, _pc);
    point(P, d, s + e, _pd);
    _pb.sub(_pa);
    _pd.sub(_pc);
    out.copy(_pb).cross(_pd).normalize();
    if (out.y < 0) out.negate();
    return out;
  };
  const nrm = new THREE.Vector3();
  for (const P of patches) {
    const ds = new Set<number>();
    const nd = Math.max(1, Math.ceil(P.d1 / res));
    for (let i = 0; i <= nd; i++) ds.add((P.d1 * i) / nd);
    for (const r of P.rows ?? []) if (r > 0 && r < P.d1) ds.add(r);
    ds.add(Math.min(0.22, P.d1 / 3));
    const D = [...ds].sort((x, y) => x - y);
    let wMax = 0;
    for (const d of D) wMax = Math.max(wMax, P.hi(d) - P.lo(d));
    const ns = Math.max(1, Math.ceil(wMax / res));
    // 顺坡弧长（贴图 v）
    const arc: number[] = [0];
    for (let i = 1; i < D.length; i++) arc.push(arc[i - 1] + Math.hypot(D[i] - D[i - 1], profile(S, D[i]) - profile(S, D[i - 1])));
    const T0: number[][] = [], B0: number[][] = [];
    const keep: boolean[][] = [];
    const pos: THREE.Vector3[][] = [];
    for (let i = 0; i < D.length; i++) {
      const d = D[i], lo = P.lo(d), hi = P.hi(d);
      const rowT: number[] = [], rowB: number[] = [], rowP: THREE.Vector3[] = [];
      for (let j = 0; j <= ns; j++) {
        const s = lo + ((hi - lo) * j) / ns;
        const p = point(P, d, s, new THREE.Vector3());
        normalAt(P, d, s, nrm);
        // 檐口一排瓦当压暗、脊边略暗
        const k = d < 0.25 ? 0.62 : 1 - 0.06 * clamp01((d - P.d1 + 0.6) / 0.6);
        rowT.push(top.vert(p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, lin(tileCol, k), s * T, arc[i] * T));
        const ao = 0.7 + 0.3 * clamp01(1 - d / Math.max(1, P.d1));
        rowB.push(bot.vert(p.x, p.y - S.thick, p.z, -nrm.x, -nrm.y, -nrm.z, lin(under, ao), arc[i] * TWU, s * TW));
        rowP.push(p);
      }
      T0.push(rowT);
      B0.push(rowB);
      pos.push(rowP);
    }
    for (let i = 0; i < D.length - 1; i++) {
      const row: boolean[] = [];
      for (let j = 0; j < ns; j++) {
        let k = true;
        if (o.hole) {
          const c = _p.copy(pos[i][j]).add(pos[i + 1][j + 1]).multiplyScalar(0.5);
          k = !o.hole(c.x, c.z);
        }
        row.push(k);
        if (!k) continue;
        top.quad(T0[i][j], T0[i][j + 1], T0[i + 1][j + 1], T0[i + 1][j]);
        bot.quad(B0[i][j], B0[i][j + 1], B0[i + 1][j + 1], B0[i + 1][j]);
      }
      keep.push(row);
    }
    // 封边：两点之间一条竖带（上表面到下表面再往下 extra），朝外法线 outward
    const strip = (pa: THREE.Vector3, pb: THREE.Vector3, outward: THREE.Vector3, col: RGB, extra = 0): void => {
      const n = outward;
      const c = lin(col);
      const i0 = edge.vert(pa.x, pa.y + 0.02, pa.z, n.x, n.y, n.z, c, 0, 0);
      const i1 = edge.vert(pb.x, pb.y + 0.02, pb.z, n.x, n.y, n.z, c, 0, 0);
      const i2 = edge.vert(pb.x, pb.y - S.thick - extra, pb.z, n.x, n.y, n.z, c, 0, 0);
      const i3 = edge.vert(pa.x, pa.y - S.thick - extra, pa.z, n.x, n.y, n.z, c, 0, 0);
      edge.quad(i0, i1, i2, i3);
    };
    const outN = new THREE.Vector3();
    const planDir = (lx: number, lz: number): THREE.Vector3 => outN.set(lx * S.cos + lz * S.sin, 0, -lx * S.sin + lz * S.cos).normalize();
    // 檐口
    for (let j = 0; j < ns; j++) {
      if (!keep[0][j]) continue;
      const [lx, lz] = patchPlan(P, -1, 0), [mx, mz] = patchPlan(P, 0, 0);
      strip(pos[0][j], pos[0][j + 1], planDir(lx - mx, lz - mz), PAL.timberDark, 0.03);
    }
    // 自由边（博风板）
    for (let i = 0; i < D.length - 1; i++) {
      const dm = (D[i] + D[i + 1]) / 2;
      for (const side of [0, 1] as const) {
        const open = side === 0 ? P.openLo?.(dm) : P.openHi?.(dm);
        const j = side === 0 ? 0 : ns;
        if (!open || !keep[i][side === 0 ? 0 : ns - 1]) continue;
        const [lx, lz] = patchPlan(P, dm, side === 0 ? -1 : 1), [mx, mz] = patchPlan(P, dm, 0);
        strip(pos[i][j], pos[i + 1][j], planDir(lx - mx, lz - mz), barge, 0.22);
      }
    }
    // 破洞的断边
    if (o.hole) {
      for (let i = 0; i < D.length - 1; i++) for (let j = 0; j < ns; j++) {
        if (!keep[i][j]) continue;
        const nb: [number, number, THREE.Vector3, THREE.Vector3][] = [
          [i - 1, j, pos[i][j], pos[i][j + 1]], [i + 1, j, pos[i + 1][j], pos[i + 1][j + 1]],
          [i, j - 1, pos[i][j], pos[i + 1][j]], [i, j + 1, pos[i][j + 1], pos[i + 1][j + 1]],
        ];
        for (const [ii, jj, pa, pb] of nb) {
          if (ii < 0 || ii >= D.length - 1 || jj < 0 || jj >= ns || keep[ii][jj]) continue;
          const c = _pc.copy(pos[i][j]).add(pos[i + 1][j + 1]).multiplyScalar(0.5);
          const m = _pd.copy(pa).add(pb).multiplyScalar(0.5).sub(c).setY(0).normalize();
          strip(pa, pb, m.clone(), PAL.tileDark, 0.04);
        }
      }
    }
    // 檐椽
    if (P.rafters && o.rafterOut && o.rafterOut > 0.3) {
      const step = o.rafterStep ?? 0.36, dOut = Math.min(o.rafterOut + 0.2, P.d1);
      const lo = Math.max(P.lo(0), P.lo(dOut)) + 0.25, hi = Math.min(P.hi(0), P.hi(dOut)) - 0.25;
      for (let s = lo; s <= hi; s += step) {
        const pa = point(P, 0.1, s, new THREE.Vector3()), pb = point(P, dOut, s, new THREE.Vector3());
        if (o.hole && (o.hole(pa.x, pa.z) || o.hole(pb.x, pb.z))) continue;
        kit.beam([pa.x, pa.y - S.thick - 0.07, pa.z], [pb.x, pb.y - S.thick - 0.07, pb.z], 0.11, 0.11, PAL.rafter);
      }
    }
  }
  return (P: Patch, d: number, s: number, lift = 0): V3 => {
    point(P, d, s, _p);
    return [_p.x, _p.y + lift, _p.z];
  };
}

export interface RoofOpts extends RoofMakeOpts {
  x: number;
  z: number;
  /** 转角（度，俯视逆时针）：本地 x = 脊的方向 */
  yaw?: number;
  kind: 'hip' | 'xieshan' | 'gable';
  /** 檐口（四角起翘之前）的半长（沿脊）/ 半深 */
  hx: number;
  hz: number;
  /** 檐口高 / 屋面脊高（不含脊饰） */
  eave: number;
  ridge: number;
  /** 歇山：山花面到中心的距离（缺省 hx − 0.5·hz） */
  gableX?: number;
  /** 歇山出际 / 悬山山面出挑（缺省 0.45） */
  gableOut?: number;
  lift?: number;
  flare?: number;
  liftR?: number;
  /** 剖面线性分量（缺省 0.55：檐口缓、脊下陡） */
  curve?: number;
  thick?: number;
  /** 正脊高 / 宽（缺省按檐宽） */
  ridgeH?: number;
  ridgeW?: number;
  /** 鸱吻高（0 = 不要） */
  chiwei?: number;
  /** 戗脊 / 垂脊截面尺度（缺省 1） */
  orn?: number;
  /** 山花板颜色（歇山） */
  gable?: RGB;
  /** 悬山两头封山花板 */
  gableFill?: boolean;
  /** 两面坡各给一个斜 OBB（能站、能挡子弹） */
  collideSlopes?: string;
  /** 正脊的哪一头断了（塌顶）：1 = +x 头，−1 = −x 头 */
  brokenRidge?: 1 | -1;
}

/**
 * 屋顶：庑殿（hip）、歇山（xieshan）、悬山（gable）。四角按 lift / flare 起翘出翘（离角 liftR 米内渐起），
 * 正脊 + 鸱吻、戗脊（角上翘起一截仔角梁）、歇山的垂脊 / 博脊 / 山花板。
 */
export function roof(kit: Kit, o: RoofOpts): void {
  const yaw = ((o.yaw ?? 0) * Math.PI) / 180;
  const hx = o.hx, hz = o.hz, xo = o.gableOut ?? 0.45;
  const gable = o.kind === 'gable';
  const S: Surface = {
    x: o.x, z: o.z, cos: Math.cos(yaw), sin: Math.sin(yaw), hx, hz,
    eave: o.eave, rise: o.ridge - o.eave, D: hz, a: o.curve ?? 0.55,
    lift: gable ? 0 : o.lift ?? Math.min(0.9, hz * 0.12), flare: gable ? 0 : o.flare ?? Math.min(0.6, hz * 0.07),
    liftR: o.liftR ?? Math.min(hz * 0.75, Math.max(2, hz * 0.55)),
    corners: [true, true, true, true], thick: o.thick ?? Math.min(0.24, 0.1 + hz * 0.018),
  };
  const patches: Patch[] = [];
  const rafters = !!o.rafterOut;
  let ridgeHalf: number, dk = hz;
  if (o.kind === 'hip') {
    const rx = Math.max(0, hx - hz);
    ridgeHalf = rx;
    for (const sg of [1, -1] as const) {
      patches.push({ ax: 2, sg, edge: hz, d1: hz, lo: d => -(hx - d), hi: d => hx - d, rafters });
      patches.push({ ax: 0, sg, edge: hx, d1: hz, lo: d => -(hz - d), hi: d => hz - d, rafters });
    }
  } else if (o.kind === 'xieshan') {
    const xg = o.gableX ?? hx - 0.5 * hz;
    dk = hx - xg - xo;
    ridgeHalf = xg + xo;
    const wTop = xg + xo;
    for (const sg of [1, -1] as const) {
      patches.push({
        ax: 2, sg, edge: hz, d1: hz, lo: d => -Math.max(wTop, hx - d), hi: d => Math.max(wTop, hx - d),
        openLo: d => d > dk + 1e-3, openHi: d => d > dk + 1e-3, rows: [dk], rafters,
      });
      patches.push({ ax: 0, sg, edge: hx, d1: dk, lo: d => -(hz - d), hi: d => hz - d, rafters });
    }
  } else {
    ridgeHalf = hx;
    for (const sg of [1, -1] as const) patches.push({ ax: 2, sg, edge: hz, d1: hz, lo: () => -hx, hi: () => hx, openLo: () => true, openHi: () => true, rafters });
  }
  const at = makePatches(kit, S, patches, o);
  const sc = o.orn ?? Math.min(1.4, Math.max(0.7, hz / 5));
  const ridgeCol = PAL.ridge;
  const holed = (p: V3): boolean => !!o.hole?.(p[0], p[2]);
  const toWorld = (lx: number, y: number, lz: number): V3 => [o.x + lx * S.cos + lz * S.sin, y, o.z - lx * S.sin + lz * S.cos];

  // 正脊（分段：塌了的段不画）+ 鸱吻
  const rh = o.ridgeH ?? 0.35 + hz * 0.06, rw = o.ridgeW ?? 0.3 + hz * 0.025;
  const ry = o.ridge - 0.12;
  const L = ridgeHalf + (gable ? 0.15 : 0.25);
  const segs = Math.max(1, Math.ceil((2 * L) / 1.2));
  for (let i = 0; i < segs; i++) {
    const x0 = -L + (2 * L * i) / segs, x1 = -L + (2 * L * (i + 1)) / segs;
    const m = toWorld((x0 + x1) / 2, ry, 0);
    if (holed(m)) continue;
    if (o.brokenRidge && Math.sign((x0 + x1) / 2) === o.brokenRidge && Math.abs((x0 + x1) / 2) > L * 0.45) continue;
    kit.beam(toWorld(x0, ry + rh / 2, 0), toWorld(x1, ry + rh / 2, 0), rw, rh, ridgeCol);
    kit.beam(toWorld(x0, ry + rh + 0.05, 0), toWorld(x1, ry + rh + 0.05, 0), rw * 1.25, 0.1, PAL.tileDark);
  }
  const cw = o.chiwei ?? (gable ? 0 : rh * 1.7);
  if (cw > 0) {
    for (const side of [1, -1]) {
      if (o.brokenRidge === side) continue;
      const base = toWorld(side * L, ry, 0);
      if (holed(base)) continue;
      const P = (out: number, up: number): V3 => toWorld(side * (L + out), ry + up, 0);
      // 鸱吻：竖起来往里卷的一截（几段方木拼出轮廓）+ 外侧一道鳍
      kit.beam(P(-0.18, 0), P(-0.02, cw * 0.62), rw * 0.95, cw * 0.38, PAL.tileDark);
      kit.beam(P(-0.02, cw * 0.58), P(-0.2, cw), rw * 0.85, cw * 0.24, PAL.tileDark);
      kit.beam(P(-0.2, cw), P(-0.42, cw * 0.92), rw * 0.7, cw * 0.15, PAL.tileDark);
      kit.beam(P(0.06, cw * 0.06), P(0.12, cw * 0.62), rw * 0.3, cw * 0.14, ridgeCol);
    }
  }

  // 戗脊 / 垂脊：沿屋面上的一条线排方木，角上翘起一截
  const ridgeLine = (pts: V3[], w: number, h: number): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (holed(pts[i]) || holed(pts[i + 1])) continue;
      kit.beam(pts[i], pts[i + 1], w, h, ridgeCol);
    }
  };
  if (!gable) {
    const dTop = o.kind === 'hip' ? hz : dk;
    for (const P of patches.filter(p => p.ax === 2)) {
      for (const side of [-1, 1]) {
        const pts: V3[] = [];
        const n = Math.max(3, Math.ceil(dTop / 0.6));
        for (let i = 0; i <= n; i++) {
          const d = dTop * (1 - i / n);
          pts.push(at(P, d, side > 0 ? P.hi(d) : P.lo(d), 0.12 * sc));
        }
        ridgeLine(pts, 0.24 * sc, 0.28 * sc);
        // 仔角梁：从角上往外上方翘出去
        const c = pts[pts.length - 1];
        if (!holed(c)) {
          const [lx, lz] = patchPlan(P, 0, side > 0 ? P.hi(0) : P.lo(0));
          const len = Math.hypot(lx, lz) || 1;
          const dirx = ((lx / len) * S.cos + (lz / len) * S.sin), dirz = (-(lx / len) * S.sin + (lz / len) * S.cos);
          kit.beam(c, [c[0] + dirx * 0.32 * sc, c[1] + 0.3 * sc, c[2] + dirz * 0.32 * sc], 0.17 * sc, 0.17 * sc, PAL.tileDark);
          // 角下的仔角梁头（套兽位置）：一小块青绿
          kit.beam([c[0] - dirx * 0.1, c[1] - 0.32 * sc, c[2] - dirz * 0.1], [c[0] + dirx * 0.28 * sc, c[1] - 0.26 * sc, c[2] + dirz * 0.28 * sc], 0.16 * sc, 0.16 * sc, PAL.teal);
        }
      }
    }
  }
  if (o.kind === 'xieshan') {
    const xg = ridgeHalf - xo;
    for (const P of patches.filter(p => p.ax === 2)) {
      for (const side of [-1, 1]) {
        const pts: V3[] = [];
        const n = Math.max(3, Math.ceil((hz - dk) / 0.6));
        for (let i = 0; i <= n; i++) {
          const d = hz - ((hz - dk) * i) / n;
          pts.push(at(P, d, side * (xg + xo), 0.12 * sc));
        }
        ridgeLine(pts, 0.26 * sc, 0.3 * sc);
      }
    }
    // 博脊（山花脚下）+ 山花板
    const gcol = o.gable ?? PAL.plasterRed;
    for (const side of [-1, 1]) {
      const Pend = patches.find(p => p.ax === 0 && p.sg === side)!;
      const a = at(Pend, dk, Pend.lo(dk), 0.08), b = at(Pend, dk, Pend.hi(dk), 0.08);
      if (!holed(a) && !holed(b)) kit.beam(a, b, 0.3 * sc, 0.26 * sc, ridgeCol);
      // 山花：竖面，x = ±xg，下沿博脊、上沿顺着前后坡
      const n = 10, zk = hz - dk;
      const yb = profile(S, dk) - 0.05;
      for (let i = 0; i < n; i++) {
        const z0 = -zk + (2 * zk * i) / n, z1 = -zk + (2 * zk * (i + 1)) / n;
        const y0 = profile(S, hz - Math.abs(z0)) - S.thick * 0.5, y1 = profile(S, hz - Math.abs(z1)) - S.thick * 0.5;
        const pa = toWorld(side * (xg - 0.05), yb, z0), pb = toWorld(side * (xg - 0.05), yb, z1);
        const pc = toWorld(side * (xg - 0.05), y1, z1), pd = toWorld(side * (xg - 0.05), y0, z0);
        if (holed(pa) && holed(pb)) continue;
        const nrm: V3 = [side * S.cos, 0, -side * S.sin];
        kit.quad('plaster', [pa, pb, pc, pd], gcol, nrm);
      }
      // 悬鱼（山花尖下一块白板）
      const fy = profile(S, hz) - 0.9 * sc;
      const f = toWorld(side * (xg + 0.02), fy, 0);
      if (!holed(f)) kit.boxYaw(f, [0.06, 0.9 * sc, 0.5 * sc], o.yaw ?? 0, PAL.plaster, 'plaster');
    }
  }
  if (gable && o.gableFill) {
    for (const side of [-1, 1]) {
      const n = 10, xg = hx - xo;
      for (let i = 0; i < n; i++) {
        const z0 = -hz + (2 * hz * i) / n, z1 = -hz + (2 * hz * (i + 1)) / n;
        const y0 = profile(S, hz - Math.abs(z0)) - S.thick, y1 = profile(S, hz - Math.abs(z1)) - S.thick;
        const yb = o.eave - 0.4;
        kit.quad('plaster', [toWorld(side * xg, yb, z0), toWorld(side * xg, yb, z1), toWorld(side * xg, y1, z1), toWorld(side * xg, y0, z0)], o.gable ?? PAL.plasterRed, [side * S.cos, 0, -side * S.sin]);
      }
    }
  }
  if (o.collideSlopes) {
    for (const P of patches.filter(p => p.ax === 2)) {
      const e0 = at(P, 0, 0), r0 = at(P, P.d1, 0);
      const dir = new THREE.Vector3(r0[0] - e0[0], r0[1] - e0[1], r0[2] - e0[2]);
      const len = dir.length();
      dir.normalize();
      const lat = new THREE.Vector3(S.cos, 0, -S.sin);
      const nrm = new THREE.Vector3().copy(lat).cross(dir).normalize();
      if (nrm.y < 0) nrm.negate();
      const th = 0.3, w = 2 * (P.hi(0) - 0.1);
      const c: V3 = [(e0[0] + r0[0]) / 2 - nrm.x * th / 2, (e0[1] + r0[1]) / 2 - nrm.y * th / 2, (e0[2] + r0[2]) / 2 - nrm.z * th / 2];
      kit.collide(c, [w, th, len], o.collideSlopes, frameQuat(lat, nrm));
    }
  }
}

export interface PentOpts extends RoofMakeOpts {
  /** 墙线矩形（世界坐标，轴对齐） */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** 贴墙处高 / 檐口高 / 出挑 */
  top: number;
  eave: number;
  out: number;
  sides: { n?: boolean; e?: boolean; s?: boolean; w?: boolean };
  lift?: number;
  flare?: number;
  thick?: number;
  /** 不转角的那头伸出墙角多少 */
  endExt?: number;
}

/** 腰檐 / 副阶的单坡檐（围着墙线的几面；相邻两面都有时角上斜接起翘，否则方头收边） */
export function pentRoof(kit: Kit, o: PentOpts): void {
  const wx = (o.x1 - o.x0) / 2, wz = (o.z1 - o.z0) / 2, out = o.out, ext = o.endExt ?? 0.3;
  const hx = wx + out, hz = wz + out;
  const { n = false, e = false, s = false, w = false } = o.sides;
  const S: Surface = {
    x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2, cos: 1, sin: 0, hx, hz,
    eave: o.eave, rise: o.top - o.eave, D: out, a: 0.75,
    lift: o.lift ?? Math.min(0.6, out * 0.3), flare: o.flare ?? Math.min(0.35, out * 0.18), liftR: Math.max(1.6, out * 1.4),
    corners: [e && s, w && s, w && n, e && n], thick: o.thick ?? 0.2,
  };
  const patches: Patch[] = [];
  const side = (ax: 0 | 2, sg: 1 | -1, loHip: boolean, hiHip: boolean): void => {
    const L = ax === 2 ? hx : hz, Wl = ax === 2 ? wx : wz;
    patches.push({
      ax, sg, edge: ax === 2 ? hz : hx, d1: out,
      lo: d => (loHip ? -(L - d) : -(Wl + ext)), hi: d => (hiHip ? L - d : Wl + ext),
      openLo: () => !loHip, openHi: () => !hiHip, rafters: true,
    });
  };
  // ax 2：横向 s = 本地 x（lo = 西）；ax 0：横向 s = 本地 z（lo = 北）
  if (s) side(2, 1, w, e);
  if (n) side(2, -1, w, e);
  if (e) side(0, 1, n, s);
  if (w) side(0, -1, n, s);
  const at = makePatches(kit, S, patches, { ...o, rafterOut: o.rafterOut ?? out - 0.1, rafterStep: o.rafterStep ?? 0.4 });
  // 贴墙一道博脊；斜接的角上一道戗脊
  for (const P of patches) {
    // 贴墙博脊：分段，压在破洞 / 断开处的段不画
    const lo = P.lo(out), hi = P.hi(out), nseg = Math.max(1, Math.ceil((hi - lo) / 1.0));
    for (let k = 0; k < nseg; k++) {
      const a = at(P, out, lo + ((hi - lo) * k) / nseg, 0.05), b = at(P, out, lo + ((hi - lo) * (k + 1)) / nseg, 0.05);
      if (o.hole?.((a[0] + b[0]) / 2, (a[2] + b[2]) / 2 + (P.ax === 2 ? P.sg * 0.3 : 0))) continue;
      kit.beam(a, b, 0.22, 0.2, PAL.ridge);
    }
    for (const sd of [-1, 1]) {
      const hip = sd < 0 ? !P.openLo?.(0) : !P.openHi?.(0);
      if (!hip) continue;
      const pts: V3[] = [];
      for (let i = 0; i <= 4; i++) {
        const d = out * (1 - i / 4);
        pts.push(at(P, d, sd > 0 ? P.hi(d) : P.lo(d), 0.1));
      }
      for (let i = 0; i < 4; i++) kit.beam(pts[i], pts[i + 1], 0.2, 0.22, PAL.ridge);
      const c = pts[4];
      const [lx, lz] = patchPlan(P, 0, sd > 0 ? P.hi(0) : P.lo(0));
      const len = Math.hypot(lx, lz) || 1;
      kit.beam(c, [c[0] + (lx / len) * 0.4, c[1] + 0.3, c[2] + (lz / len) * 0.4], 0.18, 0.18, PAL.ridge);
    }
  }
}

/** 宝顶 / 塔刹：须弥座 + 覆钵 + 相轮 + 宝珠（攒尖顶尖上） */
export function finial(kit: Kit, x: number, y: number, z: number, h: number): void {
  const k = h / 3;
  kit.lathe(x, y, z, [[0.7 * k, 0], [0.7 * k, 0.25 * k], [0.5 * k, 0.3 * k], [0.62 * k, 0.75 * k], [0.4 * k, 1.0 * k], [0.18 * k, 1.05 * k]], PAL.ridge, 'paint', 12);
  for (let i = 0; i < 4; i++) kit.lathe(x, y + (1.1 + i * 0.32) * k, z, [[0.12 * k, 0], [0.32 * k, 0.04 * k], [0.3 * k, 0.12 * k], [0.12 * k, 0.16 * k]], PAL.gold, 'paint', 12);
  kit.lathe(x, y + 2.4 * k, z, [[0.05 * k, 0], [0.22 * k, 0.12 * k], [0.26 * k, 0.3 * k], [0.18 * k, 0.48 * k], [0.03 * k, 0.6 * k]], PAL.gold, 'paint', 12);
}

// ───────────── 检视页：套件样件 + 现有资产对照 ─────────────

const REFERENCE = ['SM_Tripo_DesertCrescentPavilion', 'SM_Tripo_DesertCloister', 'SM_Tripo_DesertTemplePagoda', 'SM_Tripo_DesertGateway'];

/** 现有 GLB 道具 → 风格化材质（同 props.ts 的 stylizedFor：按 PBR 参数反推 Unity 材质参数） */
export async function loadPropGlb(id: string, ctx: PieceContext): Promise<THREE.Object3D> {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const draco = new DRACOLoader();
  const gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}assets/props/${id}.glb`);
  draco.dispose();
  gltf.scene.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const swap = (m: THREE.Material): THREE.Material => {
      if (!(m instanceof THREE.MeshStandardMaterial)) return m;
      const proxy = m.clone();
      const srgb = m.color.clone().convertLinearToSRGB();
      proxy.userData = {
        unityShader: 'Spiritfire/StylizedLit',
        unityFloats: m.normalMap ? { _Metallic: 1, _Roughness: Math.min(1, m.roughness / 0.86) } : { _Metallic: m.metalness, _Roughness: m.roughness },
        unityColors: { _BaseColor: [srgb.r, srgb.g, srgb.b, m.opacity] },
      };
      return createStylizedLit(proxy, ctx.environment);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  // 有 LOD 的只留 LOD0
  const lods: THREE.Object3D[] = [];
  gltf.scene.traverse(o => { if (/_LOD[1-9]$/.test(o.name)) lods.push(o); });
  for (const o of lods) o.removeFromParent();
  return gltf.scene;
}

/** 套件样件：一开间歇山小殿（柱、斗拱、阑额、栏杆、直棂窗、格扇门、梯、幡） */
export function buildKitSample(ctx: PieceContext, x0 = 0, z0 = 0): Kit {
  const kit = new Kit(ctx, 'timber-sample');
  const cols: [number, number][] = [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]];
  kit.box([x0, 0.25, z0], [8.4, 0.5, 7.4], PAL.stone, 'stone', { collide: 'base' });
  for (const [cx, cz] of cols) post(kit, x0 + cx, z0 + cz, 0.5, 3.8, 0.24, { collide: 'col' });
  for (const z of [-2.5, 2.5]) kit.beam([x0 - 3.2, 3.62, z0 + z], [x0 + 3.2, 3.62, z0 + z], 0.22, 0.34, PAL.beamRed);
  for (const x of [-3, 3]) kit.beam([x0 + x, 3.62, z0 - 2.7], [x0 + x, 3.62, z0 + 2.7], 0.22, 0.34, PAL.beamRed);
  for (const [cx, cz] of cols) {
    bracket(kit, x0 + cx, 3.8, z0 + cz, [0, Math.sign(cz)], 0.8);
    bracket(kit, x0 + cx, 3.8, z0 + cz, [Math.sign(cx), 0], 0.8);
  }
  for (const z of [-2.5, 2.5]) bracket(kit, x0, 3.8, z0 + z, [0, Math.sign(z)], 0.8);
  lattice(kit, [x0 - 3, 0.5, z0 - 2.5], [x0 + 3, 0.5, z0 - 2.5], 3.1, { kind: 'window' });
  lattice(kit, [x0 - 3, 0.5, z0 - 2.5], [x0 - 3, 0.5, z0 + 2.5], 3.1, { kind: 'door' });
  roof(kit, { x: x0, z: z0, kind: 'xieshan', hx: 5.2, hz: 4.2, eave: 4.3, ridge: 7.0, rafterOut: 1.6 });
  railing(kit, [x0 - 4.1, 0.5, z0 + 3.6], [x0 - 1.5, 0.5, z0 + 3.6]);
  stairRun(kit, [x0 + 0.5, 0, z0 + 6.2], [x0 + 0.5, 0.5, z0 + 3.7], { width: 2.4, posts: false, railL: true, railR: true });
  kit.banner([x0 + 1.5, 3.4, z0 + 2.7], 0.6, 2.6, 90, { phase: 0.4 });
  return kit;
}

export const LAB: LabPiece[] = [
  {
    id: 'timber-kit',
    title: '木构套件 · 对照',
    note: '套件样件（左，一开间歇山小殿）和现有沙漠木构资产（右：月泉阁、回廊、寺塔、门楼）并排比颜色和细节密度',
    async build(ctx) {
      const kit = buildKitSample(ctx, 0, 0);
      const built = kit.build();
      const xs = [16, 29, 44, 62];
      const refs = await Promise.all(REFERENCE.map(id => loadPropGlb(id, ctx).catch(err => { console.warn('[timber] 参照资产加载失败', id, err); return null; })));
      refs.forEach((r, i) => {
        if (!r) return;
        r.position.set(xs[i], 0, 0);
        built.object.add(r);
      });
      return built;
    },
    views: [
      { name: 'row', eye: [30, 9, 38], look: [30, 4, 0], fov: 50 },
      { name: 'sample', eye: [6, 2.2, 11], look: [0, 3, 0], fov: 55 },
      { name: 'eaves', eye: [3.5, 1.6, 6.5], look: [0, 4.6, 1], fov: 60 },
      { name: 'pavilion', eye: [10, 3, 14], look: [13, 4, 0], fov: 55 },
      { name: 'gateway', eye: [58, 2.2, 14], look: [62, 5, 0], fov: 55 },
    ],
  },
];
