/**
 * 赤狐展示模型专用的拼装工具：自建材质 / 几何体登记（便于 dispose）、凸包造型、
 * 带抖动的毛团、两段式手臂 IK。只给 fox.ts 使用。
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

/** 可复现的伪随机数（mulberry32） */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 椭圆截面上的 n 个点（XZ 平面，高度 y），追加到 out 并返回 out */
export function ring(out: number[], y: number, rx: number, rz: number, n = 6, cx = 0, cz = 0, phase = 0): number[] {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
  }
  return out;
}

/** 把 x≠0 的点镜像一份（x → −x），得到左右对称的点集 */
export function sym(pts: number[]): number[] {
  const out = pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    if (Math.abs(pts[i]) > 1e-6) out.push(-pts[i], pts[i + 1], pts[i + 2]);
  }
  return out;
}

/** 点集整体镜像到另一侧（x → −x） */
export function mirrorX(pts: number[]): number[] {
  const out = pts.slice();
  for (let i = 0; i < out.length; i += 3) out[i] = -out[i];
  return out;
}

/** 倒角长方体的顶点（每个角切去 b），用于手掌、扣件等 */
export function bevelBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, b: number): number[] {
  const out: number[] = [];
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const sx = x === x0 ? 1 : -1;
        const sy = y === y0 ? 1 : -1;
        const sz = z === z0 ? 1 : -1;
        out.push(x + sx * b, y, z, x, y + sy * b, z, x, y, z + sz * b);
      }
    }
  }
  return out;
}

export interface LimbSection {
  /** 沿 −Y 的距离 */
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
}

export class FoxKit {
  readonly mats: THREE.Material[] = [];
  readonly geos: THREE.BufferGeometry[] = [];
  /** 其它需要释放的对象（如骨骼贴图） */
  readonly extra: { dispose(): void }[] = [];

  std(color: number, rough = 0.8, metal = 0.02, emissive = 0x000000, ei = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, emissive, emissiveIntensity: ei });
    this.mats.push(m);
    return m;
  }

  glow(color: number, additive = false): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    if (additive) {
      m.transparent = true;
      m.blending = THREE.AdditiveBlending;
      m.depthWrite = false;
    }
    this.mats.push(m);
    return m;
  }

  private glowTex: THREE.Texture | null = null;

  /** 程序化的径向柔光贴图（64×64 画布，白色中心向外淡出），整个模型共用一张 */
  glowTexture(): THREE.Texture {
    if (this.glowTex) return this.glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.22, 'rgba(255,255,255,0.6)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.extra.push(t);
    this.glowTex = t;
    return t;
  }

  /** 加性柔光精灵材质（配 THREE.Sprite，用于火焰光晕） */
  spriteGlow(color: number, opacity: number): THREE.SpriteMaterial {
    const m = new THREE.SpriteMaterial({
      map: this.glowTexture(), color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.mats.push(m);
    return m;
  }

  /** 顶点色火焰材质（不受光照 / 色调映射）；additive 时为加性半透明，opacity 为其强度 */
  flameMat(additive: boolean, opacity = 1): THREE.MeshBasicMaterial {
    const m = this.glow(0xffffff, additive);
    m.vertexColors = true;
    m.opacity = opacity;
    return m;
  }

  /**
   * 一缕火舌：沿 +Y 的低多边形尖管（根部圆、先鼓后收成泪滴），脊线向 +X 弯（bend = 尖端横向偏移 / 高度）；
   * 顶点色由根部 cBase 渐变到尖端 cTip。配 flameMat 使用。
   */
  flameGeo(h: number, r: number, bend: number, cBase: THREE.Color, cTip: THREE.Color, n = 5, phase = 0): THREE.BufferGeometry {
    const us = [0, 0.12, 0.28, 0.46, 0.63, 0.78, 0.9];
    const prof = (u: number): number => (u < 0.28 ? 0.62 + 0.38 * Math.sin(((u / 0.28) * Math.PI) / 2) : Math.pow((1 - u) / 0.72, 1.2));
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const push = (x: number, y: number, z: number, u: number): void => {
      pos.push(x, y, z);
      c.copy(cBase).lerp(cTip, Math.pow(Math.min(1, Math.max(0, u)), 0.8));
      col.push(c.r, c.g, c.b);
    };
    push(0, -r * 0.55, 0, 0);
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      const rr = r * prof(u);
      const cx = bend * h * u * u;
      for (let k = 0; k < n; k++) {
        const a = phase + (k / n) * Math.PI * 2 + ((i % 2) * Math.PI) / n;
        push(cx + Math.cos(a) * rr, h * u, Math.sin(a) * rr * 0.85, u);
      }
    }
    push(bend * h, h, 0, 1);
    const idx: number[] = [];
    const tip = pos.length / 3 - 1;
    for (let k = 0; k < n; k++) idx.push(0, 1 + k, 1 + ((k + 1) % n));
    for (let i = 0; i < us.length - 1; i++) {
      for (let k = 0; k < n; k++) {
        const a = 1 + i * n + k;
        const b = 1 + i * n + ((k + 1) % n);
        const c2 = 1 + (i + 1) * n + k;
        const d = 1 + (i + 1) * n + ((k + 1) % n);
        idx.push(a, c2, b, b, c2, d);
      }
    }
    const lastRing = 1 + (us.length - 1) * n;
    for (let k = 0; k < n; k++) idx.push(lastRing + k, tip, lastRing + ((k + 1) % n));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return this.own(g);
  }

  own<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  /** 由扁平 xyz 数组生成凸包几何体 */
  hull(pts: number[]): THREE.BufferGeometry {
    const v: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i += 3) v.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
    return this.own(new ConvexGeometry(v));
  }

  /** 锥形肢体：若干椭圆截面（沿 −Y 排列）的凸包 */
  limb(sections: LimbSection[], n = 6, phase = 0): THREE.BufferGeometry {
    const pts: number[] = [];
    for (const s of sections) ring(pts, -s.y, s.rx, s.rz, n, s.cx ?? 0, s.cz ?? 0, phase);
    return this.hull(pts);
  }

  /**
   * 毛团：椭球面上带抖动的点 + 若干朝 tipDir 倾斜的尖刺（毛簇）的凸包。
   * 中心 (cx,cy,cz)，半轴 (rx,ry,rz)。
   */
  fluff(
    rand: () => number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number,
    n = 16, jitter = 0.12, spikes = 0, spikeLen = 0.35, spikeBias = 0.4,
  ): THREE.BufferGeometry {
    const pts: number[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * golden + rand() * 0.6;
      const k = 1 + (rand() - 0.5) * 2 * jitter;
      pts.push(cx + Math.cos(a) * r * rx * k, cy + y * ry * k, cz + Math.sin(a) * r * rz * k);
    }
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + rand() * 0.8;
      const y = (rand() - 0.3) * 0.9;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const k = 1 + spikeLen * (0.6 + rand() * 0.6);
      pts.push(cx + Math.cos(a) * r * rx * k, cy + (y + spikeBias) * ry, cz + Math.sin(a) * r * rz * k);
    }
    return this.hull(pts);
  }

  mesh(
    parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    if (sx !== 1 || sy !== 1 || sz !== 1) m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  joint(parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (rx || ry || rz) g.rotation.set(rx, ry, rz);
    parent.add(g);
    return g;
  }

  private disposed = false;

  /** 释放自建资源（可重复调用；不清空 mats，外部持有的材质列表保持不变） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const e of this.extra) e.dispose();
  }
}

// ───────────────────────────── 两段式 IK ─────────────────────────────

const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);

/**
 * 两段式手臂 IK（在 shoulder 的父空间中求解）。
 * 约定：上臂 / 前臂沿本地 −Y 下垂；肘关节绕本地 X 弯曲（负角 = 前臂朝本地 +Z 屈）。
 * @param target 腕关节目标位置（父空间）
 * @param pole 肘尖朝向提示（父空间方向）
 * @param handQ 手（腕关节）在父空间中的期望朝向；null 则不改手
 * @returns 实际到达点与目标的距离（>0 表示够不着）
 */
export function solveArm(
  shoulder: THREE.Object3D, elbow: THREE.Object3D, hand: THREE.Object3D,
  a: number, b: number, target: THREE.Vector3, pole: THREE.Vector3, handQ: THREE.Quaternion | null,
): number {
  const S = shoulder.position;
  _u.subVectors(target, S);
  const raw = _u.length();
  if (raw < 1e-6) _u.set(0, -1, 0);
  else _u.divideScalar(raw);
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, raw));
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _n.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_n.lengthSq() < 1e-8) _n.set(0, 0, -1).addScaledVector(_u, -_u.z);
  _n.normalize();
  _e.copy(S).addScaledVector(_u, a * cosA).addScaledVector(_n, a * sinA);
  _e1.subVectors(_e, S).normalize();
  _tip.copy(S).addScaledVector(_u, d);
  _e2.subVectors(_tip, _e).normalize();

  _by.copy(_e1).negate();
  _bz.copy(_e2).addScaledVector(_e1, -_e2.dot(_e1));
  if (_bz.lengthSq() < 1e-8) _bz.copy(_n);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  _m4.makeBasis(_bx, _by, _bz);
  shoulder.quaternion.setFromRotationMatrix(_m4);
  const bend = Math.acos(Math.min(1, Math.max(-1, _e1.dot(_e2))));
  elbow.quaternion.setFromAxisAngle(AXIS_X, -bend);
  if (handQ) {
    _qa.copy(shoulder.quaternion).multiply(elbow.quaternion).invert();
    hand.quaternion.copy(_qa).multiply(handQ);
  }
  return raw - d;
}

// ───────────────────────────── 缓动 ─────────────────────────────

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 区间 [a,b] 内从 0 平滑到 1 */
export const ramp = (x: number, a: number, b: number): number => smooth((x - a) / (b - a));

/** 临界附近阻尼弹簧（带超调），用于有重量感的跟随 */
export class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(x: number, public k = 120, public c = 14) {
    this.x = x;
    this.target = x;
  }
  step(dt: number): number {
    // 半隐式欧拉，dt ≤ 0.05 稳定
    const n = Math.max(1, Math.ceil(dt / 0.0125));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (this.target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x: number): void {
    this.x = x;
    this.v = 0;
    this.target = x;
  }
}
