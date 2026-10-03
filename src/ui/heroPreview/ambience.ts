/**
 * 英雄主题氛围（预览台上围绕英雄的粒子 / 小物件）：
 *  - fox    赤狐：自脚下符文环与尾巴附近升起的余烬火星 + 三团低空环绕的狐火
 *  - falcon 雷隼：身体两侧 / 翅膀 / 腿边间歇噼啪的细小电弧（每 ~0.1s 重建折线），偶尔落向符文环，带电火花
 *  - bear   岩熊：在腰部高度环绕公转的低多边形碎岩（前低后高的倾斜轨道）+ 脚下扬起的浮尘
 *  - spirit 其他：英雄色的通用灵火
 * 所有效果都避开脸部（faceMask：头部前方、画面上靠近脸的粒子会被压暗到 0），整体强度偏克制，不遮挡英雄轮廓。
 * 坐标：英雄脚底中心在原点，Y 向上；英雄本地坐标（面朝 +Z、右侧为 −X）经 frame.yaw 旋转到世界坐标。
 * 缓冲区在构造时一次分配，update 热路径不分配对象；视觉随机直接用 Math.random。
 * 自建的几何体 / 材质在 dispose 时释放；传入的贴图（spark / glow）由调用方管理，这里不释放。
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';
import { FX_ORDER } from './altar';

export type AmbienceKind = 'fox' | 'falcon' | 'bear' | 'spirit';

export function ambienceKind(heroId: string): AmbienceKind {
  return heroId === 'fox' || heroId === 'falcon' || heroId === 'bear' ? heroId : 'spirit';
}

/** 每帧由 HeroPreview 填写（复用同一个对象） */
export interface AmbienceFrame {
  /** 本帧时长（已乘动画速度倍率） */
  dt: number;
  /** 累计时间（秒，未缩放，用于闪烁等） */
  t: number;
  /** 减弱动态：关闭随机闪烁与浮动 */
  calm: boolean;
  /** 英雄当前朝向（绕 Y，弧度）：英雄本地 +Z（正面）在世界中为 (sin yaw, 0, cos yaw) */
  yaw: number;
  /** 英雄包围盒：中心高度、身体半宽（水平，已夹到合理范围）与站立高度（世界单位，脚底 y = 0） */
  cy: number;
  halfW: number;
  height: number;
  /** 当前（插值中的）英雄主题色 */
  theme: THREE.Color;
}

export interface Ambience {
  readonly group: THREE.Group;
  /** 闪光强度 0..1（电弧等），供点光源调制 */
  readonly flash: number;
  /** vis：能见度 0..1（交叉淡入淡出） */
  update(f: AmbienceFrame, vis: number): void;
  dispose(): void;
}

export interface AmbienceOptions {
  /** 粒子数量倍率（按画质） */
  density: number;
  /** 小光点贴图（亮核） */
  spark: THREE.Texture;
  /** 柔和光晕贴图 */
  glow: THREE.Texture;
}

export function createAmbience(kind: AmbienceKind, o: AmbienceOptions): Ambience {
  switch (kind) {
    case 'fox': return new Embers(o, true);
    case 'falcon': return new Arcs(o);
    case 'bear': return new Rocks(o);
    default: return new Embers(o, false);
  }
}

// ───────────────────────────── 通用 ─────────────────────────────

const _c = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 整体强度（相对旧版武器展示调低，避免抢英雄的戏） */
const GAIN = 0.8;
/** 参考身高：各效果的尺寸 / 距离按 height / REF_H 缩放 */
const REF_H = 1.9;

/** 英雄本地坐标 → 世界坐标，写入 out[j..j+2] */
function toWorld(f: AmbienceFrame, lx: number, ly: number, lz: number, out: Float32Array, j: number): void {
  const s = Math.sin(f.yaw);
  const c = Math.cos(f.yaw);
  out[j] = lx * c + lz * s;
  out[j + 1] = ly;
  out[j + 2] = -lx * s + lz * c;
}

/**
 * 脸部避让系数 0..1：位于头部前方（z > −0.2，相机在 +Z）且在画面上靠近脸的粒子压暗，正中为 0。
 * 头部近似位于转轴上（x ≈ 0）、高度约 0.86 × 身高。
 */
function faceMask(f: AmbienceFrame, x: number, y: number, z: number): number {
  if (z < -0.2) return 1;
  const r = f.height * 0.17;
  const dx = x / r;
  const dy = (y - f.height * 0.86) / (r * 1.3);
  const d2 = dx * dx + dy * dy;
  return d2 >= 1 ? 1 : d2 * d2;
}

/** 身体外沿的水平半径（halfW 已由 HeroPreview 夹到 0.2–0.42 × 身高） */
function bodyR(f: AmbienceFrame): number {
  return Math.max(f.halfW, f.height * 0.2);
}

/** 腰部高度：包围盒中心（耳朵 / 头冠会把它抬高一点，夹到 0.42–0.52 × 身高） */
function waistY(f: AmbienceFrame): number {
  return Math.min(f.height * 0.52, Math.max(f.height * 0.42, f.cy));
}

/** 加性混合的点云（顶点色控制每个粒子的亮度，黑色 = 不可见） */
class Cloud {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.PointsMaterial;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;

  constructor(readonly n: number, size: number, map: THREE.Texture) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.mat = new THREE.PointsMaterial({
      size, map, vertexColors: true, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = FX_ORDER + 2;
  }

  commit(opacity: number): void {
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ───────────────────────────── 余烬 / 灵火 ─────────────────────────────

const EMBER_HOT = new THREE.Color(0xffd27a);
const EMBER_DEEP = new THREE.Color(0xff4a12);
const FOXFIRE = new THREE.Color(0xff8a3a);
const WISPS = 3;

class Embers implements Ambience {
  readonly group = new THREE.Group();
  readonly flash = 0;
  private readonly cloud: Cloud;
  private readonly wisps: Cloud | null;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly vy: Float32Array;
  private readonly phase: Float32Array;
  private readonly base: Float32Array;
  private orbit = Math.random() * TAU;
  private seeded = false;

  constructor(o: AmbienceOptions, private readonly fox: boolean) {
    const n = Math.max(20, Math.round((fox ? 64 : 52) * o.density));
    this.cloud = new Cloud(n, fox ? 0.05 : 0.06, o.spark);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.group.add(this.cloud.points);
    this.wisps = fox ? new Cloud(WISPS, 0.24, o.glow) : null;
    if (this.wisps) this.group.add(this.wisps.points);
  }

  private spawn(i: number, f: AmbienceFrame, initial: boolean): void {
    const p = this.cloud.pos;
    const j = i * 3;
    const k = f.height / REF_H;
    const r = Math.random();
    if (this.fox && r < 0.32) {
      // 尾巴附近（臀后方）飘散
      toWorld(f, rand(-0.2, 0.2) * k, f.height * rand(0.3, 0.6), -rand(0.2, 0.55) * k, p, j);
    } else if (this.wisps && r < 0.44) {
      // 狐火拖出的火星
      const w = Math.floor(Math.random() * WISPS) * 3;
      const wp = this.wisps.pos;
      p[j] = wp[w] + rand(-0.04, 0.04);
      p[j + 1] = wp[w + 1] + rand(-0.04, 0.04);
      p[j + 2] = wp[w + 2] + rand(-0.04, 0.04);
    } else {
      // 自脚下的符文环升起（绕开双脚正中）
      const a = Math.random() * TAU;
      const d = rand(0.3, 0.8);
      p[j] = Math.cos(a) * d;
      p[j + 1] = rand(0.02, 0.12);
      p[j + 2] = Math.sin(a) * d;
    }
    this.vy[i] = this.fox ? rand(0.26, 0.6) : rand(0.14, 0.34);
    this.maxLife[i] = this.fox ? rand(1.4, 2.8) : rand(2.4, 4.2);
    this.phase[i] = Math.random() * TAU;
    if (initial) {
      this.life[i] = Math.random() * this.maxLife[i];
      p[j + 1] += this.vy[i] * this.life[i];
    } else {
      this.life[i] = 0;
    }
    if (this.fox) _c.copy(EMBER_HOT).lerp(EMBER_DEEP, Math.random());
    else _c.copy(f.theme).lerp(WHITE, Math.random() * 0.4);
    this.base[j] = _c.r * GAIN;
    this.base[j + 1] = _c.g * GAIN;
    this.base[j + 2] = _c.b * GAIN;
  }

  update(f: AmbienceFrame, vis: number): void {
    const dt = f.dt;
    // 狐火：绕英雄的倾斜轨道（靠近相机的一侧压到膝部高度，远侧在肩下，不挡脸）
    const wisps = this.wisps;
    if (wisps) {
      this.orbit += dt * 0.5;
      const wp = wisps.pos;
      const wc = wisps.col;
      const R = bodyR(f) + 0.42 * (f.height / REF_H);
      const H = f.height;
      const cy = waistY(f);
      for (let i = 0; i < WISPS; i++) {
        const a = this.orbit + (i * TAU) / WISPS;
        const r = R + 0.06 * Math.sin(this.orbit * 1.3 + i);
        const j = i * 3;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = cy - H * 0.2 * Math.sin(a) + 0.05 * Math.sin(this.orbit * 2.1 + i * 2);
        wp[j] = x;
        wp[j + 1] = y;
        wp[j + 2] = z;
        const b = (f.calm ? 0.8 : 0.66 + 0.26 * Math.sin(f.t * 7 + i * 3)) * GAIN * faceMask(f, x, y, z);
        wc[j] = FOXFIRE.r * b;
        wc[j + 1] = FOXFIRE.g * b;
        wc[j + 2] = FOXFIRE.b * b;
      }
      wisps.commit(vis);
    }

    const n = this.cloud.n;
    if (!this.seeded) {
      this.seeded = true;
      for (let i = 0; i < n; i++) this.spawn(i, f, true);
    }
    const p = this.cloud.pos;
    const col = this.cloud.col;
    const base = this.base;
    for (let i = 0; i < n; i++) {
      let life = this.life[i] + dt;
      if (life >= this.maxLife[i]) {
        this.spawn(i, f, false);
        life = 0;
      }
      this.life[i] = life;
      const k = life / this.maxLife[i];
      const j = i * 3;
      const ph = this.phase[i];
      // 上升 + 越飘越散的横向摆动
      const sway = 0.05 + 0.16 * k;
      p[j] += Math.sin(f.t * 1.7 + ph) * sway * dt;
      p[j + 1] += this.vy[i] * dt;
      p[j + 2] += Math.cos(f.t * 1.3 + ph * 1.7) * sway * 0.7 * dt;
      // 亮度：快速亮起、缓慢熄灭，带微弱闪烁；靠近脸部时压暗
      const fade = Math.min(1, k * 7) * (1 - k * k);
      const flick = f.calm ? 1 : 0.72 + 0.28 * Math.sin(f.t * 21 + ph * 9);
      const b = fade * flick * faceMask(f, p[j], p[j + 1], p[j + 2]);
      if (this.fox) {
        // 余烬随寿命冷却变红
        col[j] = base[j] * b;
        col[j + 1] = base[j + 1] * b * (1 - 0.55 * k);
        col[j + 2] = base[j + 2] * b * (1 - 0.8 * k);
      } else {
        col[j] = base[j] * b;
        col[j + 1] = base[j + 1] * b;
        col[j + 2] = base[j + 2] * b;
      }
    }
    this.cloud.commit(vis);
  }

  dispose(): void {
    this.cloud.dispose();
    this.wisps?.dispose();
    this.group.clear();
  }
}

// ───────────────────────────── 电弧 ─────────────────────────────

const ARC_COUNT = 4;
const ARC_SEG = 9;
/** 每道电弧两股（主股 + 偏移副股），每股 ARC_SEG 段、每段两个顶点 */
const ARC_VERTS = ARC_SEG * 2 * 2;
const ARC_CORE = new THREE.Color(0xe2fbff);
const ARC_EDGE = new THREE.Color(0x5cc8ff);
const SPARK = new THREE.Color(0xc4f2ff);
const _arcA = new Float32Array((ARC_SEG + 1) * 3);
const _arcB = new Float32Array((ARC_SEG + 1) * 3);

class Arcs implements Ambience {
  readonly group = new THREE.Group();
  flash = 0;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.LineBasicMaterial;
  private readonly lpos = new Float32Array(ARC_COUNT * ARC_VERTS * 3);
  private readonly lcol = new Float32Array(ARC_COUNT * ARC_VERTS * 3);
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly on = new Uint8Array(ARC_COUNT);
  private readonly stateT = new Float32Array(ARC_COUNT);
  private readonly rebuildT = new Float32Array(ARC_COUNT);
  /** 每道电弧各折点的脸部避让系数（重建时计算，着色时使用） */
  private readonly mask = new Float32Array(ARC_COUNT * (ARC_SEG + 1));
  private readonly sparks: Cloud;
  /** 沿电弧顶点的柔光点（WebGL 线宽恒为 1px，靠这层光晕让电弧在高分屏上也看得清） */
  private readonly halo: Cloud;
  private readonly sLife: Float32Array;
  private readonly sMax: Float32Array;
  private readonly sVel: Float32Array;
  private readonly sMask: Float32Array;
  private nextSpark = 0;
  private idleT = 0;

  constructor(o: AmbienceOptions) {
    this.posAttr = new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.lcol, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const lines = new THREE.LineSegments(this.geo, this.mat);
    lines.frustumCulled = false;
    lines.renderOrder = FX_ORDER + 1;
    this.group.add(lines);
    for (let a = 0; a < ARC_COUNT; a++) this.stateT[a] = Math.random() * 0.6;

    this.halo = new Cloud(ARC_COUNT * (ARC_SEG + 1), 0.11, o.glow);
    this.halo.points.renderOrder = FX_ORDER;
    this.group.add(this.halo.points);

    const n = Math.max(14, Math.round(36 * o.density));
    this.sparks = new Cloud(n, 0.04, o.spark);
    this.sLife = new Float32Array(n).fill(1);
    this.sMax = new Float32Array(n).fill(1);
    this.sVel = new Float32Array(n * 3);
    this.sMask = new Float32Array(n).fill(1);
    this.group.add(this.sparks.points);
  }

  private emitSpark(f: AmbienceFrame, x: number, y: number, z: number, speed: number): void {
    const i = this.nextSpark;
    this.nextSpark = (i + 1) % this.sparks.n;
    const j = i * 3;
    const p = this.sparks.pos;
    p[j] = x;
    p[j + 1] = y;
    p[j + 2] = z;
    const v = this.sVel;
    v[j] = rand(-1, 1) * speed;
    v[j + 1] = rand(-0.4, 1) * speed;
    v[j + 2] = rand(-1, 1) * speed;
    this.sLife[i] = 0;
    this.sMax[i] = rand(0.16, 0.4);
    this.sMask[i] = faceMask(f, x, y, z);
  }

  /** 身体外沿上的一点（世界坐标，绕转轴的角度 ang、高度 y、半径倍率 rm） */
  private static shell(f: AmbienceFrame, ang: number, y: number, rm: number, out: Float32Array, j: number): void {
    const r = bodyR(f) * rm;
    out[j] = Math.cos(ang) * r;
    out[j + 1] = y;
    out[j + 2] = Math.sin(ang) * r;
  }

  /** 重建第 a 道电弧的折线（中点随机位移，两端收拢） */
  private rebuild(a: number, f: AmbienceFrame): void {
    const H = f.height;
    const k = H / REF_H;
    const pa = _arcA;
    const last = ARC_SEG * 3;
    const roll = Math.random();
    if (roll < 0.36) {
      // 翅膀：自肩背沿翼面向外、向下跳（英雄本地坐标，左右随机）
      const side = Math.random() < 0.5 ? -1 : 1;
      toWorld(f, side * rand(0.12, 0.26) * k, H * rand(0.56, 0.74), -rand(0.1, 0.24) * k, pa, 0);
      toWorld(f, side * rand(0.42, 0.72) * k, H * rand(0.36, 0.66), -rand(0.16, 0.42) * k, pa, last);
    } else if (roll < 0.72) {
      // 身侧 / 腿边的表面爬行
      const ang = Math.random() * TAU;
      const y0 = H * rand(0.1, 0.56);
      Arcs.shell(f, ang, y0, rand(0.8, 1.05), pa, 0);
      Arcs.shell(f, ang + rand(-0.9, 0.9), Math.min(H * 0.6, Math.max(H * 0.05, y0 + rand(-0.22, 0.22) * H)), rand(0.95, 1.3), pa, last);
    } else {
      // 自腿边落向祭台符文环
      Arcs.shell(f, Math.random() * TAU, H * rand(0.12, 0.34), rand(0.75, 1), pa, 0);
      const ang = Math.random() * TAU;
      const r = rand(0.5, 0.74);
      pa[last] = Math.cos(ang) * r;
      pa[last + 1] = 0.012;
      pa[last + 2] = Math.sin(ang) * r;
    }
    const ax = pa[0], ay = pa[1], az = pa[2];
    const dx = pa[last] - ax, dy = pa[last + 1] - ay, dz = pa[last + 2] - az;
    const amp = 0.025 + Math.hypot(dx, dy, dz) * 0.15;
    const pb = _arcB;
    const m0 = a * (ARC_SEG + 1);
    for (let s = 0; s <= ARC_SEG; s++) {
      const t = s / ARC_SEG;
      const taper = Math.sin(Math.PI * t);
      const j = s * 3;
      if (s > 0 && s < ARC_SEG) {
        pa[j] = ax + dx * t + rand(-1, 1) * amp * taper;
        pa[j + 1] = ay + dy * t + rand(-1, 1) * amp * taper;
        pa[j + 2] = az + dz * t + rand(-1, 1) * amp * taper;
      }
      // 副股：在主股附近再抖一点，看起来更粗、更躁动
      const jit = 0.016 * taper;
      pb[j] = pa[j] + rand(-1, 1) * jit;
      pb[j + 1] = pa[j + 1] + rand(-1, 1) * jit;
      pb[j + 2] = pa[j + 2] + rand(-1, 1) * jit;
      this.mask[m0 + s] = faceMask(f, pa[j], pa[j + 1], pa[j + 2]);
    }
    // 光晕点跟随主股顶点
    const hp = this.halo.pos;
    const h0 = a * (ARC_SEG + 1) * 3;
    for (let j = 0; j <= last + 2; j++) hp[h0 + j] = pa[j];
    // 写入线段顶点
    const lp = this.lpos;
    let o = a * ARC_VERTS * 3;
    for (let strand = 0; strand < 2; strand++) {
      const src = strand === 0 ? pa : pb;
      for (let s = 0; s < ARC_SEG; s++) {
        const j = s * 3;
        lp[o++] = src[j]; lp[o++] = src[j + 1]; lp[o++] = src[j + 2];
        lp[o++] = src[j + 3]; lp[o++] = src[j + 4]; lp[o++] = src[j + 5];
      }
    }
    // 落点迸出电火花
    const sparks = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < sparks; i++) this.emitSpark(f, pa[last], pa[last + 1], pa[last + 2], rand(0.5, 1.3));
  }

  private paint(a: number, b: number): void {
    const lc = this.lcol;
    const m0 = a * (ARC_SEG + 1);
    // 线段顶点顺序：每股 ARC_SEG 段 × (起点, 终点)
    let o = a * ARC_VERTS * 3;
    for (let strand = 0; strand < 2; strand++) {
      const c = strand === 0 ? ARC_CORE : ARC_EDGE;
      const sb = (strand === 0 ? b : b * 0.7) * GAIN;
      for (let s = 0; s < ARC_SEG; s++) {
        for (let e = 0; e < 2; e++) {
          const m = sb * this.mask[m0 + s + e];
          lc[o++] = c.r * m;
          lc[o++] = c.g * m;
          lc[o++] = c.b * m;
        }
      }
    }
    // 光晕：两端收拢、中段最亮
    const hc = this.halo.col;
    const h0 = m0 * 3;
    for (let s = 0; s <= ARC_SEG; s++) {
      const m = b * GAIN * 0.38 * (0.35 + 0.65 * Math.sin((Math.PI * s) / ARC_SEG)) * this.mask[m0 + s];
      const j = h0 + s * 3;
      hc[j] = ARC_EDGE.r * m;
      hc[j + 1] = ARC_EDGE.g * m;
      hc[j + 2] = ARC_EDGE.b * m;
    }
  }

  update(f: AmbienceFrame, vis: number): void {
    const dt = f.dt;
    let active = 0;
    for (let a = 0; a < ARC_COUNT; a++) {
      this.stateT[a] -= dt;
      if (this.on[a]) {
        if (this.stateT[a] <= 0) {
          // 熄灭，间歇一会儿再噼啪
          this.on[a] = 0;
          this.stateT[a] = rand(0.18, 0.95);
          this.paint(a, 0);
          continue;
        }
        this.rebuildT[a] -= dt;
        if (this.rebuildT[a] <= 0) {
          this.rebuild(a, f);
          this.rebuildT[a] = rand(0.07, 0.13);
        }
      } else if (this.stateT[a] <= 0) {
        this.on[a] = 1;
        this.stateT[a] = rand(0.1, 0.36);
        this.rebuild(a, f);
        this.rebuildT[a] = rand(0.07, 0.13);
      } else {
        continue;
      }
      const b = f.calm ? 0.75 : rand(0.45, 1);
      this.paint(a, b);
      active += b;
    }
    this.flash = Math.min(1, active / 2.4) * vis;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mat.opacity = vis;
    this.halo.commit(vis);

    // 身体表面零星的小火花（避开脸部）
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = rand(0.12, 0.34);
      const j = this.nextSpark * 3;
      const p = this.sparks.pos;
      Arcs.shell(f, Math.random() * TAU, f.height * rand(0.08, 0.66), rand(0.85, 1.05), p, j);
      this.emitSpark(f, p[j], p[j + 1], p[j + 2], rand(0.2, 0.5));
    }

    const n = this.sparks.n;
    const p = this.sparks.pos;
    const col = this.sparks.col;
    const v = this.sVel;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (this.sLife[i] >= this.sMax[i]) {
        col[j] = col[j + 1] = col[j + 2] = 0;
        continue;
      }
      this.sLife[i] += dt;
      v[j + 1] -= 2.6 * dt;
      v[j] *= drag;
      v[j + 1] *= drag;
      v[j + 2] *= drag;
      p[j] += v[j] * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += v[j + 2] * dt;
      const k = Math.min(1, this.sLife[i] / this.sMax[i]);
      const b = (1 - k) * (f.calm ? 0.85 : rand(0.6, 1)) * GAIN * this.sMask[i];
      col[j] = SPARK.r * b;
      col[j + 1] = SPARK.g * b;
      col[j + 2] = SPARK.b * b;
    }
    this.sparks.commit(vis);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.sparks.dispose();
    this.halo.dispose();
    this.group.clear();
  }
}

// ───────────────────────────── 碎岩 ─────────────────────────────

const ROCK_DARK = new THREE.Color(0x4a3a2c);
const ROCK_LIGHT = new THREE.Color(0x7c664e);
const DUST = new THREE.Color(0xd8c29a);
const _obj = new THREE.Object3D();

class Rocks implements Ambience {
  readonly group = new THREE.Group();
  readonly flash = 0;
  private readonly geo = new THREE.IcosahedronGeometry(1, 0);
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  /** 每块碎岩：公转角、半径增量（身体外沿之外）、高度偏移（相对腰部，按身高）、角速度、浮动相位 */
  private readonly orbit: Float32Array;
  /** 自转角（xyz）、自转速度（xyz）、缩放（xyz，按参考身高） */
  private readonly spin: Float32Array;
  private readonly spinVel: Float32Array;
  private readonly size: Float32Array;
  private readonly dust: Cloud;
  private readonly dLife: Float32Array;
  private readonly dMax: Float32Array;
  private readonly dVel: Float32Array;
  private seeded = false;

  constructor(o: AmbienceOptions) {
    const n = (this.n = Math.max(6, Math.round(10 * o.density)));
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.94, metalness: 0.04, flatShading: true, transparent: true, emissive: 0x000000,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.frustumCulled = false;
    this.orbit = new Float32Array(n * 5);
    this.spin = new Float32Array(n * 3);
    this.spinVel = new Float32Array(n * 3);
    this.size = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o5 = i * 5;
      this.orbit[o5] = (i / n) * TAU + rand(-0.2, 0.2);
      this.orbit[o5 + 1] = rand(0.3, 0.6);
      this.orbit[o5 + 2] = rand(-0.05, 0.05);
      this.orbit[o5 + 3] = rand(0.18, 0.3);
      this.orbit[o5 + 4] = Math.random() * TAU;
      const s = (i % 4 === 0 ? 0.075 : 0.04) + Math.random() * 0.045;
      const j = i * 3;
      this.size[j] = s * rand(0.8, 1.3);
      this.size[j + 1] = s * rand(0.7, 1.15);
      this.size[j + 2] = s * rand(0.8, 1.3);
      this.spin[j] = Math.random() * TAU;
      this.spin[j + 1] = Math.random() * TAU;
      this.spin[j + 2] = Math.random() * TAU;
      this.spinVel[j] = rand(-0.9, 0.9);
      this.spinVel[j + 1] = rand(-0.9, 0.9);
      this.spinVel[j + 2] = rand(-0.9, 0.9);
      this.mesh.setColorAt(i, _c.copy(ROCK_DARK).lerp(ROCK_LIGHT, Math.random()));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.group.add(this.mesh);

    const dn = Math.max(14, Math.round(34 * o.density));
    this.dust = new Cloud(dn, 0.035, o.spark);
    this.dLife = new Float32Array(dn);
    this.dMax = new Float32Array(dn);
    this.dVel = new Float32Array(dn * 3);
    this.group.add(this.dust.points);
  }

  private spawnDust(i: number, f: AmbienceFrame, initial: boolean): void {
    const j = i * 3;
    const p = this.dust.pos;
    const a = Math.random() * TAU;
    const r = rand(0.35, 1.5);
    p[j] = Math.cos(a) * r;
    p[j + 1] = initial ? rand(0, f.height * 0.8) : rand(-0.05, 0.15);
    p[j + 2] = Math.sin(a) * r;
    this.dVel[j] = rand(-0.04, 0.04);
    this.dVel[j + 1] = rand(0.03, 0.1);
    this.dVel[j + 2] = rand(-0.04, 0.04);
    this.dMax[i] = rand(3.5, 7);
    this.dLife[i] = initial ? Math.random() * this.dMax[i] : 0;
  }

  update(f: AmbienceFrame, vis: number): void {
    const dt = f.dt;
    const n = this.n;
    const H = f.height;
    const k = H / REF_H;
    const R0 = bodyR(f);
    // 腰部高度的倾斜轨道：靠近相机的一侧降到胯下，远侧升到胸背后（被身体遮住），不挡脸也不切过胸前
    const waist = waistY(f);
    const tilt = H * 0.13;
    for (let i = 0; i < n; i++) {
      const o5 = i * 5;
      const a = (this.orbit[o5] += this.orbit[o5 + 3] * dt);
      const r = R0 + this.orbit[o5 + 1] * k;
      const j = i * 3;
      const sp = this.spin;
      sp[j] += this.spinVel[j] * dt;
      sp[j + 1] += this.spinVel[j + 1] * dt;
      sp[j + 2] += this.spinVel[j + 2] * dt;
      const bob = f.calm ? 0 : 0.04 * k * Math.sin(f.t * 1.1 + this.orbit[o5 + 4]);
      const front = Math.sin(a);
      _obj.position.set(Math.cos(a) * r, waist + this.orbit[o5 + 2] * H - tilt * front + bob, front * r);
      _obj.rotation.set(sp[j], sp[j + 1], sp[j + 2]);
      // 经过身前时略微缩小，减少对身体的遮挡
      const sc = k * (front > 0.5 ? 1 - 0.3 * (front - 0.5) * 2 : 1);
      _obj.scale.set(this.size[j] * sc, this.size[j + 1] * sc, this.size[j + 2] * sc);
      _obj.updateMatrix();
      this.mesh.setMatrixAt(i, _obj.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mat.opacity = vis;
    this.mat.emissive.copy(f.theme).multiplyScalar(0.1);

    const dn = this.dust.n;
    if (!this.seeded) {
      this.seeded = true;
      for (let i = 0; i < dn; i++) this.spawnDust(i, f, true);
    }
    const p = this.dust.pos;
    const col = this.dust.col;
    for (let i = 0; i < dn; i++) {
      let life = this.dLife[i] + dt;
      if (life >= this.dMax[i]) {
        this.spawnDust(i, f, false);
        life = 0;
      }
      this.dLife[i] = life;
      const j = i * 3;
      p[j] += this.dVel[j] * dt;
      p[j + 1] += this.dVel[j + 1] * dt;
      p[j + 2] += this.dVel[j + 2] * dt;
      const t = life / this.dMax[i];
      const tw = f.calm ? 0.4 : 0.3 + 0.12 * Math.sin(f.t * 3 + i * 1.7);
      const b = Math.sin(Math.PI * t) * tw * GAIN * faceMask(f, p[j], p[j + 1], p[j + 2]);
      col[j] = DUST.r * b;
      col[j + 1] = DUST.g * b;
      col[j + 2] = DUST.b * b;
    }
    this.dust.commit(vis);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    this.dust.dispose();
    this.group.clear();
  }
}
