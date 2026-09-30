/**
 * 程序化低多边形枪模（Box / Cylinder 组合）。
 *
 * 约定：枪管沿 −Z，原点在右手握把顶部（持枪手位置），+Y 向上，单位约等于米（第一人称尺度）。
 * 每把枪 = 枪身配色 + 稀有度色发光条 + 元素色能量槽。几何体与材质做模块级缓存，
 * 调用者移除模型时**不要 dispose 几何体 / 材质**（它们是共享的）。
 */
import * as THREE from 'three';
import type { Element, Rarity } from '../core/types';
import { ELEMENT_COLORS, RARITY_COLORS } from '../core/types';
import { getWeaponDef } from './WeaponDefs';

export interface GunModel {
  root: THREE.Group;
  /** 枪口（本地空挂点） */
  muzzle: THREE.Object3D;
  /** 换弹时移动的部件（弹匣 / 转轮 / 能量罐 / 弹箱） */
  mag: THREE.Object3D | null;
  /** 转轮（左轮 / 榴弹鼓），每发转动 1/steps 圈 */
  cylinder: THREE.Object3D | null;
  cylinderSteps: number;
  /** 机炮枪管组（绕 Z 旋转） */
  spinner: THREE.Object3D | null;
  /** 霰弹枪护木（泵动） */
  pump: THREE.Object3D | null;
  /** 弩：弩箭（上弦完成后可见） */
  bolt: THREE.Object3D | null;
  /** 弩：弓弦两半（由 setCrossbowString 调整） */
  stringHalves: [THREE.Mesh, THREE.Mesh] | null;
  /** 弩：弓梢位置（x 为右梢，左梢取负）与弦所在高度 */
  stringTip: { x: number; y: number; z: number } | null;
  /** 元素能量槽网格（第一人称会替换为可脉动的独立材质） */
  energy: THREE.Mesh[];
  /** 左手握点与所在父节点（霰弹枪挂在护木上随泵动） */
  leftHand: THREE.Vector3 | null;
  leftParent: THREE.Object3D | null;
}

interface Palette {
  body: number;
  dark: number;
  accent: number;
  grip: number;
}

const PALETTES: Record<string, Palette> = {
  revolver: { body: 0xa0603a, dark: 0x2a2522, accent: 0xd8a24a, grip: 0x6b3f22 },
  smg: { body: 0x3b3f46, dark: 0x1e2024, accent: 0xe6b422, grip: 0x26282c },
  rifle: { body: 0x56624e, dark: 0x23252a, accent: 0xb9bcc0, grip: 0x3a3f36 },
  burst: { body: 0x2f3b52, dark: 0x1b1f2a, accent: 0x9fb4d8, grip: 0x252c3b },
  shotgun: { body: 0x4b4f55, dark: 0x2a2c30, accent: 0x8a7a66, grip: 0x6a4428 },
  sniper: { body: 0x3e4a3a, dark: 0x1d211c, accent: 0xd9c89a, grip: 0x4c3a28 },
  launcher: { body: 0x7a2e20, dark: 0x2e2a28, accent: 0xe0a040, grip: 0x3a2a22 },
  crossbow: { body: 0x5a3e2a, dark: 0x2a2d31, accent: 0x8a96a0, grip: 0x3e2a1c },
  beam: { body: 0x2a3448, dark: 0x161b26, accent: 0xc07a3a, grip: 0x222838 },
  minigun: { body: 0x3a3d40, dark: 0x1f2124, accent: 0xd0a040, grip: 0x2a2c2f },
  swarm: { body: 0x4a5a3a, dark: 0x25292c, accent: 0xe8c040, grip: 0x2f3530 },
};

// ───────────────────────────── 缓存 ─────────────────────────────

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

const q = (n: number): number => Math.round(n * 10000);

/** 共享立方体几何（按尺寸缓存） */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b${q(w)}_${q(h)}_${q(d)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

/** 圆柱：rA 为 +axis 端半径，rB 为 −axis 端半径 */
function cylGeo(rA: number, rB: number, len: number, seg: number, axis: 'x' | 'y' | 'z', open = false): THREE.BufferGeometry {
  const key = `c${q(rA)}_${q(rB)}_${q(len)}_${seg}_${axis}${open ? 'o' : ''}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rA, rB, len, seg, 1, open);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    geoCache.set(key, g);
  }
  return g;
}

/** 低多边形实体材质（平直着色） */
export function solidMat(color: number, metalness = 0.35, roughness = 0.55): THREE.MeshStandardMaterial {
  const key = `s${color}_${metalness}_${roughness}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });
    matCache.set(key, m);
  }
  return m;
}

/** 自发光材质（不受光照、不做色调映射，保证颜色鲜明） */
export function glowMat(color: number, doubleSide = false): THREE.MeshBasicMaterial {
  const key = `g${color}${doubleSide ? 'd' : ''}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
    matCache.set(key, m);
  }
  return m;
}

/** 双面实体材质（开口镜筒：开镜时能从内部看穿） */
function tubeMat(color: number): THREE.MeshStandardMaterial {
  const key = `t${color}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.45, flatShading: true, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

/** 红点 / 瞄准镜分划的准心点颜色 */
const RETICLE_COLOR = 0xff3a3a;

export function elementColor(e: Element): number {
  return ELEMENT_COLORS[e];
}

let flashTex: THREE.CanvasTexture | null = null;
let glowTex: THREE.CanvasTexture | null = null;

/** 枪口火焰贴图（白色星芒，材质颜色着色） */
export function getFlashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(32, 32);
    g.rotate((i * Math.PI) / 3 + 0.25);
    g.beginPath();
    g.moveTo(0, -3.2);
    g.lineTo(31, 0);
    g.lineTo(0, 3.2);
    g.closePath();
    g.fill();
    g.restore();
  }
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

/** 柔和圆形光晕贴图 */
export function getGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const haloMats = new Map<number, THREE.SpriteMaterial>();

function haloMat(rarity: Rarity): THREE.SpriteMaterial {
  let m = haloMats.get(rarity);
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: RARITY_COLORS[rarity],
      transparent: true,
      opacity: 0.22 + rarity * 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    haloMats.set(rarity, m);
  }
  return m;
}

// ───────────────────────────── 建模工具 ─────────────────────────────

class Builder {
  readonly root = new THREE.Group();
  readonly energy: THREE.Mesh[] = [];
  readonly body: THREE.Material;
  readonly dark: THREE.Material;
  readonly accent: THREE.Material;
  readonly grip: THREE.Material;
  readonly rarity: THREE.Material;
  readonly energyMat: THREE.Material;
  readonly rarityLevel: Rarity;

  constructor(pal: Palette, rarity: Rarity, element: Element) {
    this.rarityLevel = rarity;
    this.body = solidMat(pal.body, 0.4, 0.5);
    this.dark = solidMat(pal.dark, 0.6, 0.45);
    this.accent = solidMat(pal.accent, 0.55, 0.4);
    this.grip = solidMat(pal.grip, 0.05, 0.85);
    this.rarity = glowMat(RARITY_COLORS[rarity]);
    this.energyMat = glowMat(ELEMENT_COLORS[element]);
  }

  box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx !== 0 || ry !== 0 || rz !== 0) m.rotation.set(rx, ry, rz);
    parent.add(m);
    if (mat === this.energyMat) this.energy.push(m);
    return m;
  }

  /** 沿 axis 的圆柱；rEnd 为 −axis 端半径（缺省 = r） */
  cyl(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', seg = 8, rEnd = r): THREE.Mesh {
    const m = new THREE.Mesh(cylGeo(r, rEnd, len, seg, axis), mat);
    m.position.set(x, y, z);
    parent.add(m);
    if (mat === this.energyMat) this.energy.push(m);
    return m;
  }

  /** 开口镜筒（沿 Z，双面），开镜时视线从中间穿过 */
  tube(parent: THREE.Object3D, color: number, r: number, len: number, x: number, y: number, z: number, seg = 10, rEnd = r): THREE.Mesh {
    const m = new THREE.Mesh(cylGeo(r, rEnd, len, seg, 'z', true), tubeMat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** 发光环（开口短筒，双面） */
  ring(parent: THREE.Object3D, color: number, r: number, len: number, x: number, y: number, z: number, seg = 10): THREE.Mesh {
    const m = new THREE.Mesh(cylGeo(r, r, len, seg, 'z', true), glowMat(color, true));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /**
   * 红点瞄具：中空方框 + 准心点（中心在 (0, cy, cz)，开镜时准心点落在屏幕中央）。
   */
  redDot(parent: THREE.Object3D, cy: number, cz: number, frameColor: THREE.Material, baseY: number): void {
    const s = 0.032, t = 0.004, d = 0.05;
    this.box(parent, frameColor, s, t, d, 0, cy + s / 2 - t / 2, cz);
    this.box(parent, frameColor, s, t, d, 0, cy - s / 2 + t / 2, cz);
    this.box(parent, frameColor, t, s, d, s / 2 - t / 2, cy, cz);
    this.box(parent, frameColor, t, s, d, -s / 2 + t / 2, cy, cz);
    const mh = Math.max(0.002, cy - s / 2 - baseY);
    this.box(parent, this.dark, 0.02, mh, 0.04, 0, baseY + mh / 2, cz);
    this.box(parent, glowMat(RETICLE_COLOR), 0.0035, 0.0035, 0.002, 0, cy, cz - d / 2 + 0.002);
  }

  /** 双柱照门（中间留缺口，不挡视线） */
  rearNotch(parent: THREE.Object3D, y: number, z: number, h = 0.02, gap = 0.012): void {
    this.box(parent, this.dark, 0.005, h, 0.012, gap / 2 + 0.0025, y, z);
    this.box(parent, this.dark, 0.005, h, 0.012, -gap / 2 - 0.0025, y, z);
  }

  group(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  /** 手枪式握把（顶部约在原点） */
  pistolGrip(parent: THREE.Object3D, mat: THREE.Material, y = -0.055, z = 0.035, h = 0.11, tilt = -0.3): void {
    this.box(parent, mat, 0.04, h, 0.052, 0, y, z, tilt);
  }

  /** 扳机与护圈 */
  trigger(parent: THREE.Object3D, z = -0.02): void {
    this.box(parent, this.dark, 0.008, 0.008, 0.05, 0, -0.03, z - 0.005);
    this.box(parent, this.dark, 0.008, 0.03, 0.008, 0, -0.016, z - 0.03);
    this.box(parent, this.accent, 0.006, 0.02, 0.006, 0, -0.012, z + 0.004, 0.3);
  }
}

function blankModel(b: Builder): GunModel {
  const muzzle = new THREE.Object3D();
  b.root.add(muzzle);
  return {
    root: b.root, muzzle, mag: null, cylinder: null, cylinderSteps: 6, spinner: null, pump: null,
    bolt: null, stringHalves: null, stringTip: null, energy: b.energy, leftHand: null, leftParent: null,
  };
}

// ───────────────────────────── 各武器 ─────────────────────────────

function buildRevolver(b: Builder, m: GunModel): void {
  const r = b.root;
  b.pistolGrip(r, b.grip, -0.058, 0.032, 0.115, -0.32);
  b.box(r, b.dark, 0.044, 0.018, 0.06, 0, -0.116, 0.052, -0.32);
  b.box(r, b.body, 0.04, 0.05, 0.13, 0, 0.03, -0.025);
  b.box(r, b.body, 0.034, 0.03, 0.05, 0, 0.012, 0.045);
  b.trigger(r, -0.03);
  const cyl = b.group(r, 0, 0.038, -0.05);
  b.cyl(cyl, b.dark, 0.031, 0.062, 0, 0, 0, 'z', 8);
  b.cyl(cyl, b.accent, 0.011, 0.066, 0, 0, 0, 'z', 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.cyl(cyl, b.body, 0.006, 0.064, Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0, 'z', 5);
  }
  m.cylinder = cyl;
  m.cylinderSteps = 8;
  m.mag = cyl;
  b.cyl(r, b.body, 0.014, 0.17, 0, 0.056, -0.165, 'z', 8);
  b.box(r, b.body, 0.014, 0.018, 0.17, 0, 0.068, -0.165);
  b.box(r, b.accent, 0.006, 0.014, 0.012, 0, 0.083, -0.24);
  b.box(r, b.dark, 0.018, 0.012, 0.012, 0, 0.076, 0.03);
  b.box(r, b.dark, 0.012, 0.03, 0.02, 0, 0.066, 0.058, 0.4);
  b.box(r, b.rarity, 0.004, 0.008, 0.11, 0.021, 0.03, -0.03);
  b.box(r, b.rarity, 0.004, 0.008, 0.11, -0.021, 0.03, -0.03);
  b.box(r, b.energyMat, 0.005, 0.05, 0.022, 0.023, -0.055, 0.03, -0.32);
  b.box(r, b.energyMat, 0.005, 0.05, 0.022, -0.023, -0.055, 0.03, -0.32);
  m.muzzle.position.set(0, 0.056, -0.255);
}

function buildSmg(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.052, 0.068, 0.27, 0, 0.038, -0.07);
  b.box(r, b.accent, 0.03, 0.012, 0.21, 0, 0.078, -0.07);
  b.box(r, b.dark, 0.022, 0.006, 0.03, 0, 0.087, 0.03);
  b.rearNotch(r, 0.097, 0.03, 0.016, 0.012);
  b.box(r, b.dark, 0.006, 0.02, 0.012, 0, 0.09, -0.19);
  b.cyl(r, b.dark, 0.022, 0.1, 0, 0.042, -0.25, 'z', 8);
  for (let i = 0; i < 3; i++) b.box(r, b.accent, 0.047, 0.006, 0.012, 0, 0.042, -0.22 - i * 0.03);
  b.cyl(r, b.dark, 0.011, 0.05, 0, 0.042, -0.325, 'z', 6);
  b.pistolGrip(r, b.grip);
  b.trigger(r);
  const mag = b.group(r, 0, 0.004, -0.11);
  b.box(mag, b.dark, 0.034, 0.15, 0.042, 0, -0.07, 0.006, 0.12);
  b.box(mag, b.accent, 0.036, 0.012, 0.044, 0, -0.035, 0.004, 0.12);
  b.box(mag, b.accent, 0.036, 0.012, 0.044, 0, -0.09, 0.011, 0.12);
  m.mag = mag;
  b.box(r, b.dark, 0.012, 0.012, 0.15, 0.018, 0.03, 0.14);
  b.box(r, b.dark, 0.012, 0.012, 0.15, -0.018, 0.03, 0.14);
  b.box(r, b.grip, 0.05, 0.06, 0.02, 0, 0.015, 0.215);
  b.box(r, b.rarity, 0.004, 0.008, 0.2, 0.028, 0.048, -0.07);
  b.box(r, b.rarity, 0.004, 0.008, 0.2, -0.028, 0.048, -0.07);
  b.box(r, b.energyMat, 0.006, 0.026, 0.06, 0.029, 0.02, -0.16);
  b.box(r, b.energyMat, 0.006, 0.026, 0.06, -0.029, 0.02, -0.16);
  m.muzzle.position.set(0, 0.042, -0.355);
  m.leftHand = new THREE.Vector3(0, 0.02, -0.235);
}

function buildRifle(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.058, 0.08, 0.34, 0, 0.04, -0.07);
  b.box(r, b.dark, 0.05, 0.062, 0.24, 0, 0.037, -0.36);
  for (let i = 0; i < 4; i++) b.box(r, b.body, 0.054, 0.008, 0.02, 0, 0.07, -0.28 - i * 0.055);
  b.cyl(r, b.dark, 0.011, 0.12, 0, 0.042, -0.54, 'z', 6);
  b.box(r, b.dark, 0.028, 0.028, 0.05, 0, 0.042, -0.615);
  b.box(r, b.accent, 0.03, 0.006, 0.03, 0, 0.042, -0.615);
  // 红点瞄具（中空，开镜时准心点在屏幕中央）
  b.redDot(r, 0.1, -0.03, b.dark, 0.08);
  b.box(r, b.rarity, 0.004, 0.004, 0.05, 0.0165, 0.114, -0.03);
  b.box(r, b.dark, 0.008, 0.026, 0.01, 0, 0.081, -0.46);
  const mag = b.group(r, 0, 0.0, -0.13);
  b.box(mag, b.dark, 0.034, 0.09, 0.058, 0, -0.045, 0, 0.12);
  b.box(mag, b.dark, 0.034, 0.08, 0.054, 0, -0.118, 0.018, 0.38);
  m.mag = mag;
  b.pistolGrip(r, b.grip, -0.055, 0.045);
  b.trigger(r, 0.0);
  b.box(r, b.body, 0.046, 0.06, 0.2, 0, 0.03, 0.2);
  b.box(r, b.grip, 0.05, 0.1, 0.035, 0, 0.012, 0.31);
  b.box(r, b.dark, 0.052, 0.104, 0.01, 0, 0.012, 0.332);
  b.box(r, b.rarity, 0.004, 0.01, 0.28, 0.03, 0.05, -0.07);
  b.box(r, b.rarity, 0.004, 0.01, 0.28, -0.03, 0.05, -0.07);
  b.box(r, b.energyMat, 0.006, 0.03, 0.12, 0.026, 0.035, -0.36);
  b.box(r, b.energyMat, 0.006, 0.03, 0.12, -0.026, 0.035, -0.36);
  m.muzzle.position.set(0, 0.042, -0.645);
  m.leftHand = new THREE.Vector3(0, 0.006, -0.36);
}

function buildBurst(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.066, 0.1, 0.46, 0, 0.045, -0.08);
  b.box(r, b.dark, 0.07, 0.03, 0.2, 0, 0.1, -0.1);
  b.tube(r, PALETTES.burst.dark, 0.02, 0.14, 0, 0.132, -0.06, 8);
  b.tube(r, PALETTES.burst.dark, 0.024, 0.02, 0, 0.132, -0.13, 8);
  b.ring(r, RARITY_COLORS[b.rarityLevel], 0.0215, 0.006, 0, 0.132, -0.141, 8);
  b.box(r, b.dark, 0.012, 0.018, 0.03, 0, 0.113, -0.06);
  b.box(r, glowMat(RETICLE_COLOR), 0.003, 0.003, 0.002, 0, 0.132, -0.128);
  for (let i = 0; i < 3; i++) b.cyl(r, b.accent, 0.009, 0.13, 0, 0.018 + i * 0.027, -0.37, 'z', 6);
  b.box(r, b.dark, 0.03, 0.09, 0.02, 0, 0.045, -0.425);
  b.pistolGrip(r, b.grip);
  b.trigger(r, -0.01);
  const mag = b.group(r, 0, -0.005, 0.1);
  b.box(mag, b.dark, 0.036, 0.1, 0.06, 0, -0.05, 0, -0.08);
  m.mag = mag;
  b.box(r, b.grip, 0.06, 0.11, 0.03, 0, 0.04, 0.165);
  for (let i = 0; i < 3; i++) {
    b.box(r, b.rarity, 0.004, 0.012, 0.03, 0.034, 0.05, -0.12 - i * 0.05);
    b.box(r, b.rarity, 0.004, 0.012, 0.03, -0.034, 0.05, -0.12 - i * 0.05);
  }
  b.box(r, b.energyMat, 0.03, 0.02, 0.06, 0, 0.107, 0.08);
  m.muzzle.position.set(0, 0.045, -0.44);
  m.leftHand = new THREE.Vector3(0, -0.005, -0.24);
}

function buildShotgun(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.06, 0.08, 0.2, 0, 0.04, -0.03);
  // 碎岩镶嵌
  b.box(r, b.accent, 0.02, 0.035, 0.05, 0.032, 0.05, -0.04, 0.3, 0.2, 0.4);
  b.box(r, b.accent, 0.02, 0.03, 0.04, -0.032, 0.045, -0.08, -0.2, 0.3, 0.5);
  b.cyl(r, b.dark, 0.02, 0.42, 0, 0.062, -0.34, 'z', 8);
  b.cyl(r, b.dark, 0.015, 0.34, 0, 0.022, -0.3, 'z', 8);
  b.cyl(r, b.accent, 0.025, 0.024, 0, 0.062, -0.54, 'z', 7);
  const pump = b.group(r, 0, 0.022, -0.3);
  b.box(pump, b.grip, 0.054, 0.048, 0.13, 0, 0, 0);
  for (let i = 0; i < 3; i++) b.box(pump, b.dark, 0.058, 0.008, 0.012, 0, -0.012, -0.04 + i * 0.04);
  m.pump = pump;
  b.pistolGrip(r, b.grip, -0.05, 0.06, 0.1, -0.45);
  b.trigger(r, 0.0);
  b.box(r, b.grip, 0.05, 0.075, 0.24, 0, 0.018, 0.19, 0.1);
  b.box(r, b.dark, 0.052, 0.1, 0.02, 0, 0.0, 0.31, 0.1);
  b.box(r, b.rarity, 0.006, 0.006, 0.36, 0, 0.085, -0.34);
  b.box(r, b.dark, 0.012, 0.016, 0.012, 0, 0.088, -0.53);
  for (let i = 0; i < 3; i++) b.box(r, b.energyMat, 0.012, 0.028, 0.013, 0.034, 0.03, 0.02 - i * 0.022);
  m.muzzle.position.set(0, 0.062, -0.56);
  m.leftHand = new THREE.Vector3(0, -0.024, 0);
  m.leftParent = pump;
}

function buildSniper(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.056, 0.072, 0.3, 0, 0.038, -0.05);
  b.box(r, b.body, 0.05, 0.056, 0.22, 0, 0.032, -0.3);
  b.cyl(r, b.dark, 0.012, 0.36, 0, 0.045, -0.56, 'z', 8);
  b.box(r, b.dark, 0.034, 0.03, 0.07, 0, 0.045, -0.76);
  b.box(r, b.accent, 0.036, 0.008, 0.05, 0, 0.045, -0.76);
  // 瞄准镜
  b.box(r, b.dark, 0.02, 0.03, 0.02, 0, 0.088, 0.02);
  b.box(r, b.dark, 0.02, 0.03, 0.02, 0, 0.088, -0.12);
  b.tube(r, PALETTES.sniper.dark, 0.024, 0.26, 0, 0.12, -0.05, 10);
  b.tube(r, PALETTES.sniper.dark, 0.032, 0.05, 0, 0.12, -0.2, 10, 0.026);
  b.tube(r, PALETTES.sniper.dark, 0.028, 0.04, 0, 0.12, 0.09, 10);
  b.ring(r, RARITY_COLORS[b.rarityLevel], 0.0325, 0.006, 0, 0.12, -0.226, 10);
  b.box(r, glowMat(RETICLE_COLOR), 0.0025, 0.0025, 0.002, 0, 0.12, -0.17);
  b.cyl(r, b.accent, 0.012, 0.03, 0.03, 0.12, -0.05, 'x', 8);
  b.cyl(r, b.accent, 0.012, 0.03, 0, 0.15, -0.05, 'y', 8);
  // 枪栓
  b.cyl(r, b.accent, 0.007, 0.05, 0.045, 0.05, 0.06, 'x', 6);
  b.box(r, b.accent, 0.018, 0.018, 0.018, 0.072, 0.05, 0.06);
  const mag = b.group(r, 0, 0.002, -0.1);
  b.box(mag, b.dark, 0.04, 0.07, 0.08, 0, -0.035, 0);
  m.mag = mag;
  b.pistolGrip(r, b.grip, -0.055, 0.05, 0.11, -0.35);
  b.trigger(r, 0.0);
  b.box(r, b.grip, 0.05, 0.08, 0.26, 0, 0.02, 0.23);
  b.box(r, b.grip, 0.046, 0.03, 0.12, 0, 0.07, 0.22);
  b.box(r, b.dark, 0.052, 0.11, 0.02, 0, 0.01, 0.37);
  b.box(r, b.rarity, 0.004, 0.01, 0.2, 0.026, 0.03, 0.22);
  b.box(r, b.rarity, 0.004, 0.01, 0.2, -0.026, 0.03, 0.22);
  b.box(r, b.energyMat, 0.006, 0.024, 0.1, 0.029, 0.04, -0.07);
  b.box(r, b.energyMat, 0.006, 0.024, 0.1, -0.029, 0.04, -0.07);
  m.muzzle.position.set(0, 0.045, -0.8);
  m.leftHand = new THREE.Vector3(0, 0.004, -0.3);
}

function buildLauncher(b: Builder, m: GunModel): void {
  const r = b.root;
  b.cyl(r, b.body, 0.05, 0.36, 0, 0.075, -0.24, 'z', 10);
  b.cyl(r, b.dark, 0.058, 0.04, 0, 0.075, -0.42, 'z', 10);
  b.cyl(r, b.rarity, 0.053, 0.012, 0, 0.075, -0.33, 'z', 10);
  b.cyl(r, b.rarity, 0.053, 0.012, 0, 0.075, -0.15, 'z', 10);
  const drum = b.group(r, 0, 0.065, 0.0);
  b.cyl(drum, b.dark, 0.068, 0.12, 0, 0, 0, 'z', 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.cyl(drum, b.accent, 0.018, 0.124, Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0, 'z', 6);
  }
  m.cylinder = drum;
  m.cylinderSteps = 4;
  m.mag = drum;
  b.box(r, b.dark, 0.04, 0.03, 0.2, 0, 0.0, 0.0);
  b.pistolGrip(r, b.grip, -0.06, 0.04);
  b.trigger(r, -0.02);
  b.box(r, b.dark, 0.04, 0.02, 0.1, 0, 0.02, -0.27);
  b.box(r, b.dark, 0.035, 0.09, 0.04, 0, -0.03, -0.27);
  b.box(r, b.body, 0.045, 0.06, 0.14, 0, 0.03, 0.15);
  b.box(r, b.dark, 0.05, 0.09, 0.02, 0, 0.02, 0.23);
  b.box(r, b.dark, 0.012, 0.05, 0.02, 0, 0.15, -0.1);
  b.box(r, b.accent, 0.03, 0.006, 0.02, 0, 0.172, -0.1);
  b.cyl(r, b.energyMat, 0.018, 0.12, 0.066, 0.05, -0.2, 'z', 8);
  b.cyl(r, b.dark, 0.02, 0.012, 0.066, 0.05, -0.265, 'z', 8);
  b.cyl(r, b.dark, 0.02, 0.012, 0.066, 0.05, -0.135, 'z', 8);
  m.muzzle.position.set(0, 0.075, -0.445);
  m.leftHand = new THREE.Vector3(0, -0.01, -0.27);
}

function buildCrossbow(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.046, 0.05, 0.5, 0, 0.035, -0.14);
  b.box(r, b.accent, 0.012, 0.01, 0.4, 0, 0.064, -0.18);
  // 弓臂（弓梢向后掠）
  b.box(r, b.dark, 0.06, 0.03, 0.04, 0, 0.05, -0.36);
  b.box(r, b.accent, 0.2, 0.018, 0.028, -0.094, 0.05, -0.326, 0, 0.35, 0);
  b.box(r, b.accent, 0.2, 0.018, 0.028, 0.094, 0.05, -0.326, 0, -0.35, 0);
  b.box(r, b.rarity, 0.012, 0.024, 0.012, -0.188, 0.05, -0.292);
  b.box(r, b.rarity, 0.012, 0.024, 0.012, 0.188, 0.05, -0.292);
  // 弓弦（单位长度，缩放到实际长度）
  const strMat = solidMat(0xe8e0d0, 0, 0.9);
  const sl = new THREE.Mesh(boxGeo(1, 0.004, 0.004), strMat);
  const sr = new THREE.Mesh(boxGeo(1, 0.004, 0.004), strMat);
  r.add(sl, sr);
  m.stringHalves = [sl, sr];
  m.stringTip = { x: 0.188, y: 0.05, z: -0.292 };
  // 弩箭
  const bolt = b.group(r, 0, 0.074, -0.24);
  b.box(bolt, b.dark, 0.008, 0.008, 0.26, 0, 0, 0);
  b.box(bolt, b.energyMat, 0.014, 0.014, 0.03, 0, 0, -0.14);
  b.box(bolt, b.rarity, 0.022, 0.003, 0.03, 0, 0, 0.115);
  m.bolt = bolt;
  // 顶部箭匣（连弩）
  const mag = b.group(r, 0, 0.11, -0.12);
  b.box(mag, b.body, 0.05, 0.06, 0.2, 0, 0, 0);
  b.box(mag, b.accent, 0.052, 0.008, 0.2, 0, 0.026, 0);
  b.box(mag, b.dark, 0.01, 0.02, 0.01, 0, 0.04, -0.08);
  b.box(mag, b.dark, 0.02, 0.012, 0.01, 0, 0.036, 0.09);
  m.mag = mag;
  b.pistolGrip(r, b.grip, -0.05, 0.04);
  b.trigger(r, 0.0);
  b.box(r, b.body, 0.046, 0.07, 0.16, 0, 0.02, 0.18);
  b.box(r, b.dark, 0.05, 0.09, 0.02, 0, 0.015, 0.27);
  b.box(r, b.rarity, 0.004, 0.01, 0.3, 0.025, 0.035, -0.12);
  b.box(r, b.rarity, 0.004, 0.01, 0.3, -0.025, 0.035, -0.12);
  m.muzzle.position.set(0, 0.074, -0.4);
  m.leftHand = new THREE.Vector3(0, 0.01, -0.25);
  setCrossbowString(m, 1);
}

function buildBeam(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.066, 0.086, 0.3, 0, 0.043, -0.06);
  b.box(r, b.dark, 0.07, 0.02, 0.2, 0, 0.096, -0.06);
  b.cyl(r, b.accent, 0.02, 0.12, 0, 0.045, -0.27, 'z', 8);
  for (let i = 0; i < 3; i++) b.cyl(r, b.energyMat, 0.038 - i * 0.005, 0.014, 0, 0.045, -0.23 - i * 0.035, 'z', 10);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    b.box(r, b.dark, 0.012, 0.012, 0.1, Math.cos(a) * 0.042, 0.045 + Math.sin(a) * 0.042, -0.3);
  }
  b.cyl(r, b.energyMat, 0.01, 0.02, 0, 0.045, -0.335, 'z', 6);
  const cell = b.group(r, 0, 0.125, -0.02);
  b.cyl(cell, b.energyMat, 0.02, 0.1, 0, 0, 0, 'z', 8);
  b.cyl(cell, b.dark, 0.024, 0.016, 0, 0, 0.055, 'z', 8);
  b.cyl(cell, b.dark, 0.024, 0.016, 0, 0, -0.055, 'z', 8);
  m.mag = cell;
  b.pistolGrip(r, b.grip, -0.055, 0.04);
  b.trigger(r, -0.01);
  b.box(r, b.body, 0.05, 0.07, 0.1, 0, 0.035, 0.13);
  b.box(r, b.rarity, 0.004, 0.012, 0.24, 0.034, 0.03, -0.06);
  b.box(r, b.rarity, 0.004, 0.012, 0.24, -0.034, 0.03, -0.06);
  m.muzzle.position.set(0, 0.045, -0.345);
  m.leftHand = new THREE.Vector3(0, 0.0, -0.17);
}

function buildMinigun(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.11, 0.11, 0.22, 0, 0.04, -0.06);
  b.box(r, b.dark, 0.09, 0.05, 0.08, 0, 0.04, 0.08);
  b.cyl(r, b.dark, 0.035, 0.05, 0, 0.04, 0.14, 'z', 8);
  const sp = b.group(r, 0, 0.045, -0.17);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cyl(sp, b.dark, 0.011, 0.4, Math.cos(a) * 0.032, Math.sin(a) * 0.032, -0.2, 'z', 6);
  }
  b.cyl(sp, b.body, 0.05, 0.03, 0, 0, -0.02, 'z', 10);
  b.cyl(sp, b.body, 0.048, 0.02, 0, 0, -0.2, 'z', 10);
  b.cyl(sp, b.accent, 0.048, 0.02, 0, 0, -0.38, 'z', 10);
  b.cyl(sp, b.dark, 0.012, 0.42, 0, 0, -0.21, 'z', 6);
  m.spinner = sp;
  b.box(r, b.dark, 0.02, 0.05, 0.02, 0, 0.12, 0.0);
  b.box(r, b.dark, 0.02, 0.05, 0.02, 0, 0.12, -0.14);
  b.box(r, b.grip, 0.026, 0.024, 0.18, 0, 0.15, -0.07);
  const mag = b.group(r, -0.1, 0.0, -0.04);
  b.box(mag, b.body, 0.08, 0.1, 0.12, 0, 0, 0);
  b.box(mag, b.accent, 0.082, 0.014, 0.122, 0, 0.03, 0);
  b.box(mag, b.dark, 0.03, 0.02, 0.08, 0.05, 0.04, 0);
  m.mag = mag;
  b.pistolGrip(r, b.grip, -0.06, 0.02, 0.1, -0.2);
  b.trigger(r, -0.02);
  // 左侧握把
  b.box(r, b.dark, 0.03, 0.02, 0.05, -0.07, 0.04, -0.2);
  b.box(r, b.grip, 0.024, 0.08, 0.026, -0.085, 0.0, -0.2);
  b.box(r, b.rarity, 0.004, 0.014, 0.18, 0.057, 0.05, -0.06);
  b.box(r, b.rarity, 0.004, 0.014, 0.1, -0.057, 0.07, -0.12);
  for (let i = 0; i < 3; i++) b.box(r, b.energyMat, 0.006, 0.01, 0.04, 0.057, 0.02, -0.02 - i * 0.05);
  m.muzzle.position.set(0, 0.045, -0.58);
  m.leftHand = new THREE.Vector3(-0.085, 0.03, -0.2);
}

function buildSwarm(b: Builder, m: GunModel): void {
  const r = b.root;
  b.box(r, b.body, 0.13, 0.12, 0.28, 0, 0.09, -0.12);
  b.box(r, b.dark, 0.136, 0.02, 0.29, 0, 0.09, -0.12);
  b.box(r, b.dark, 0.14, 0.126, 0.02, 0, 0.09, -0.26);
  const tubes: [number, number][] = [[0, 0], [-0.035, 0.032], [0.035, 0.032], [-0.035, -0.032], [0.035, -0.032]];
  const tips = b.group(r, 0, 0.09, -0.27);
  for (const [x, y] of tubes) {
    b.cyl(r, b.dark, 0.019, 0.02, x, 0.09 + y, -0.272, 'z', 8);
    b.cyl(tips, b.energyMat, 0.013, 0.03, x, y, -0.006, 'z', 6, 0.004);
  }
  m.mag = tips;
  b.box(r, b.dark, 0.04, 0.03, 0.14, 0, 0.018, -0.05);
  b.pistolGrip(r, b.grip, -0.05, 0.04);
  b.trigger(r, -0.01);
  b.box(r, b.grip, 0.032, 0.08, 0.035, 0, -0.01, -0.2);
  b.box(r, b.body, 0.06, 0.05, 0.12, 0, 0.06, 0.08);
  b.box(r, b.dark, 0.02, 0.04, 0.04, 0, 0.17, -0.06);
  b.box(r, b.rarity, 0.018, 0.02, 0.004, 0, 0.18, -0.082);
  b.box(r, b.rarity, 0.004, 0.012, 0.26, 0.067, 0.12, -0.12);
  b.box(r, b.rarity, 0.004, 0.012, 0.26, -0.067, 0.12, -0.12);
  b.box(r, b.accent, 0.132, 0.01, 0.03, 0, 0.152, -0.2);
  m.muzzle.position.set(0, 0.09, -0.29);
  m.leftHand = new THREE.Vector3(0, 0.0, -0.2);
}

const BUILDERS: Record<string, (b: Builder, m: GunModel) => void> = {
  revolver: buildRevolver,
  smg: buildSmg,
  rifle: buildRifle,
  burst: buildBurst,
  shotgun: buildShotgun,
  sniper: buildSniper,
  launcher: buildLauncher,
  crossbow: buildCrossbow,
  beam: buildBeam,
  minigun: buildMinigun,
  swarm: buildSwarm,
};

/**
 * 调整弩弦：t = 1 为上弦（弦拉到扳机处），t = 0 为松弦（弦贴近弓臂）。
 */
export function setCrossbowString(m: GunModel, t: number): void {
  if (!m.stringHalves || !m.stringTip) return;
  const tip = m.stringTip;
  const nockZ = tip.z + (-0.1 - tip.z) * t;
  const dz = tip.z - nockZ;
  const len = Math.hypot(tip.x, dz);
  const ang = Math.atan2(-dz, tip.x);
  const [sl, sr] = m.stringHalves;
  sr.position.set(tip.x * 0.5, tip.y, (tip.z + nockZ) * 0.5);
  sr.rotation.set(0, ang, 0);
  sr.scale.set(len, 1, 1);
  sl.position.set(-tip.x * 0.5, tip.y, (tip.z + nockZ) * 0.5);
  sl.rotation.set(0, -ang, 0);
  sl.scale.set(len, 1, 1);
}

/** 构建一把枪（第一人称与掉落共用） */
export function buildGunModel(defId: string, rarity: Rarity, element: Element): GunModel {
  const def = getWeaponDef(defId);
  const pal = PALETTES[def.id] ?? PALETTES.rifle;
  const b = new Builder(pal, rarity, element);
  const m = blankModel(b);
  (BUILDERS[def.id] ?? buildRifle)(b, m);
  b.root.name = `gun:${def.id}`;
  return m;
}

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

/**
 * 世界掉落模型：缩放后的枪模 + 稀有度光晕（不含灯光）。
 * 模型以包围盒中心为原点，枪管朝 −Z。调用者负责加入场景与移除（不要 dispose 共享资源）。
 */
export function buildWorldModel(defId: string, rarity: Rarity, element: Element): THREE.Group {
  const def = getWeaponDef(defId);
  const gun = buildGunModel(defId, rarity, element);
  gun.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  gun.root.scale.setScalar(def.worldScale);
  gun.root.updateMatrixWorld(true);
  _box.setFromObject(gun.root);
  _box.getCenter(_center);
  _box.getSize(_size);
  gun.root.position.sub(_center);

  const holder = new THREE.Group();
  holder.name = `weaponDrop:${def.id}`;
  holder.add(gun.root);
  // 光晕随枪身长度与稀有度放大（贴图边缘透明，可见范围约为尺寸的一半）
  const halo = new THREE.Sprite(haloMat(rarity));
  const len = Math.max(_size.x, _size.z);
  const s = 0.95 + rarity * 0.12;
  halo.scale.set(len * 1.3 * s, Math.max(0.45, _size.y * 2.2) * s, 1);
  halo.renderOrder = 2;
  holder.add(halo);
  holder.userData.weaponDefId = def.id;
  holder.userData.rarity = rarity;
  return holder;
}
