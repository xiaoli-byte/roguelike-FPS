/**
 * Boss 模块共享的几何体 / 材质缓存与低多边形建模小工具。
 *
 * 约定：
 *  - 几何体与材质模板在模块级缓存、永不释放（EnemyBase 会为每个实例克隆材质并负责释放克隆）。
 *  - 发光部件（MeshBasicMaterial）用 glowMesh 创建：带 userData.glow 标记，BossBase 会关闭其投影，
 *    并按 userData.role 收集每个实例克隆后的材质，用于阶段变色 / 蓄力发光。
 */
import * as THREE from 'three';

// ───────────── 几何体缓存 ─────────────

const geos = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key);
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g as T;
}

export const geo = {
  box: (w: number, h: number, d: number) => cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt: number, rb: number, h: number, seg = 6, open = false) =>
    cached(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  cone: (r: number, h: number, seg = 6) => cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  ico: (r: number, detail = 0) => cached(`ico${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodeca: (r: number) => cached(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  octa: (r: number) => cached(`oct${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  tetra: (r: number) => cached(`tet${r}`, () => new THREE.TetrahedronGeometry(r, 0)),
  sphere: (r: number, ws = 10, hs = 8) => cached(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  torus: (r: number, tube: number, rs = 6, ts = 14) => cached(`tor${r},${tube},${rs},${ts}`, () => new THREE.TorusGeometry(r, tube, rs, ts)),
};

// ───────────── 材质缓存 ─────────────

const mats = new Map<string, THREE.Material>();

export interface StdOpts {
  emissive?: number;
  /** emissiveIntensity */
  ei?: number;
  rough?: number;
  metal?: number;
  opacity?: number;
}

/** 低多边形实体材质（flatShading），按参数缓存 */
export function std(color: number, o: StdOpts = {}): THREE.MeshStandardMaterial {
  const key = `std${color}|${o.emissive ?? 0}|${o.ei ?? 1}|${o.rough ?? 0.85}|${o.metal ?? 0.05}|${o.opacity ?? 1}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0.05,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 1,
    });
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true;
      m.opacity = o.opacity;
    }
    mats.set(key, m);
  }
  return m;
}

/** 自发光材质（不受光照与雾影响）；additive=true 时为叠加光晕 */
export function glow(color: number, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const key = `glow${color}|${opacity}|${additive}`;
  let m = mats.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: additive || opacity < 1,
      opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
      fog: false,
    });
    mats.set(key, m);
  }
  return m;
}

// ───────────── 建模工具 ─────────────

export function mesh(
  parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  if (rx !== 0 || ry !== 0 || rz !== 0) me.rotation.set(rx, ry, rz);
  parent.add(me);
  return me;
}

/** 发光部件：不投影；role 用于实例化后查找克隆材质 */
export function glowMesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, role = 'glow'): THREE.Mesh {
  const me = mesh(parent, g, m, x, y, z);
  me.userData.glow = true;
  me.userData.role = role;
  me.castShadow = false;
  return me;
}

/** 给实体部件打上 role 标记（例如需要随阶段变色的发光纹路） */
export function tag<T extends THREE.Object3D>(o: T, role: string): T {
  o.userData.role = role;
  return o;
}

/** 关节（空组），用于动画旋转 */
export function pivot(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** 受击判定锚点（空物体） */
export function anchor(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export function scaled<T extends THREE.Object3D>(o: T, sx: number, sy: number, sz: number): T {
  o.scale.set(sx, sy, sz);
  return o;
}

// ───────────── 缓动 ─────────────

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInQuad = (t: number): number => t * t;
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** 0..1 区间内 [a,b] 的线性进度 */
export function span(t: number, a: number, b: number): number {
  return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
}
