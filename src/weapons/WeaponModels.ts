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
import { AssetLibrary } from '../assets/AssetLibrary';
import { attachRigidParts } from '../assets/RigidParts';

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
  /** 美术枪模的实例材质（带自发光遮罩时）：自发光颜色 = 元素色（无元素时稀有度色）；userData.glowBase 是基准色，第一人称在其上做脉动 */
  artGlow: THREE.MeshStandardMaterial | null;
  /** 魔刀千刃的刀身挂点（刀身 / 刃片 / 符纹 / 宝珠 / 流苏）；其他武器为 null */
  blade: BladeRig | null;
}

/** 魔刀千刃的刃片数（千刃形态满弹匣时悬浮的刃片数；刀身 9 段 × 刃口 / 刀背两列） */
export const BLADE_SHARDS = 18;

/**
 * 魔刀千刃的刀身挂点（docs/demon-blade.md 10.7.2）。坐标均为 root 空间：
 * 原点在握把轴线上（右手握持处），刀身沿 −Z，刃口朝 −Y，刀尖向 +Y 上翘。
 */
export interface BladeRig {
  /** 刀身组（刀脊骨架 + 血槽符纹）：原点在兽首口中，沿 −Z 伸出；斩形态显示，变形时沿 Z 缩回淡出 */
  body: THREE.Group;
  /** 18 片刃片：shards[seg * 2 + col]，seg 0 靠护手、8 为刀尖；col 0 刃口 / 1 刀背。斩形态在 home 拼成刀刃 */
  shards: THREE.Mesh[];
  /** 每片的 home 位置与朝向（root 空间；几何体已含刀身弧度，home 朝向为单位旋转） */
  shardHome: { pos: THREE.Vector3; rot: THREE.Euler }[];
  /** 刃片的脱离 / 投掷顺序：shardOrder[k] = 第 k 个离开的刃片下标（自刀尖向护手） */
  shardOrder: number[];
  /** 朱红发光符纹（血槽、刃口符文、兽目）：共用一个材质，第一人称替换为可增亮的独立材质 */
  runes: THREE.Mesh[];
  /** 宝珠：元素色（在 energy 列表中随能量槽脉动）；无元素时为暗金（markMat，不进 energy） */
  orb: THREE.Mesh;
  /** 兽首护手 */
  guard: THREE.Object3D;
  /** 柄尾流苏链节（3 节，自上而下串联；每节沿本地 −Y 下垂，下一节挂在上一节末端） */
  tassel: THREE.Object3D[];
  /** 刀尖（root 空间）：斩形态的枪口位置、刀光拖尾外缘 */
  tip: THREE.Vector3;
  /** 刀光拖尾内缘取样点（root 空间，刀身约 30% 处） */
  trailInner: THREE.Vector3;
}

/**
 * 美术资产接管枪身后仍保留程序化的部件（按节点名）：开镜视线要穿过的中空瞄具、按上弦状态显隐的弩箭、
 * 按上弦程度拉伸的弓弦。美术管线导出白模时把它们排除在外，运行时也不隐藏它们。
 */
export const PROCEDURAL_PARTS = ['sight', 'bolt', 'string_l', 'string_r'];

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
  flamer: { body: 0x8a2a1a, dark: 0x2a1a14, accent: 0xffb03a, grip: 0x3a2a20 },
  stormpod: { body: 0x2f4a3a, dark: 0x1a2620, accent: 0xb08a3a, grip: 0x3a3026 },
  magmashot: { body: 0x5a1e14, dark: 0x1e1410, accent: 0xff6a1f, grip: 0x6b4a2a },
  trinity: { body: 0x3a3a44, dark: 0x1c1c22, accent: 0xe8d6a0, grip: 0x2a4a3a },
  railgun: { body: 0x3a3f4a, dark: 0x1b1d24, accent: 0xc9a8ff, grip: 0x24242a },
  lantern: { body: 0x2f3a2a, dark: 0x161b14, accent: 0xc8b070, grip: 0x3b2c1e },
  demon_blade: { body: 0x34343a, dark: 0x18161a, accent: 0xa8842e, grip: 0x5c1810 },
};

/** 三才转轮弹膛的元素顺序（与 WeaponDefs 中 trinity.cycle 一致） */
const TRINITY_CYCLE: readonly Element[] = ['fire', 'shock', 'corrode'];

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

/** 圆环（默认在 XY 平面、绕 Z 轴；arc 为弧长弧度） */
function torusGeo(r: number, tube: number, radial: number, tubular: number, arc = Math.PI * 2): THREE.BufferGeometry {
  const key = `r${q(r)}_${q(tube)}_${radial}_${tubular}_${q(arc)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.TorusGeometry(r, tube, radial, tubular, arc);
    geoCache.set(key, g);
  }
  return g;
}

/** 低多边形球（二十面体细分 1 次） */
function ballGeo(r: number): THREE.BufferGeometry {
  const key = `i${q(r)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.IcosahedronGeometry(r, 1);
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

/**
 * 固定颜色的发光标记（三才弹膛帽、赤蛟管口环等）。与 glowMat 分开缓存：glowMat 按颜色共享，
 * 若颜色恰好等于武器元素色会与 Builder.energyMat 是同一实例，从而被当成能量槽替换 / 脉动 / 改色。
 */
function markMat(color: number): THREE.MeshBasicMaterial {
  const key = `k${color}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    matCache.set(key, m);
  }
  return m;
}

/** 半透明加法发光材质（灯纱等；不投射阴影） */
function veilMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const key = `v${color}_${opacity}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
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
  readonly element: Element;

  constructor(pal: Palette, rarity: Rarity, element: Element) {
    this.rarityLevel = rarity;
    this.element = element;
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
    bolt: null, stringHalves: null, stringTip: null, energy: b.energy, leftHand: null, leftParent: null, artGlow: null, blade: null,
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
  // 红点瞄具（中空，开镜时准心点在屏幕中央）；分组在原点，只用来按名字保留程序化（见 PROCEDURAL_PARTS）
  const sight = b.group(r, 0, 0, 0);
  sight.name = 'sight';
  b.redDot(sight, 0.1, -0.03, b.dark, 0.08);
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
  // 筒式瞄具（中空，开镜视线从中间穿过）；分组在原点，只用来按名字保留程序化（见 PROCEDURAL_PARTS）
  const sight = b.group(r, 0, 0, 0);
  sight.name = 'sight';
  b.tube(sight, PALETTES.burst.dark, 0.02, 0.14, 0, 0.132, -0.06, 8);
  b.tube(sight, PALETTES.burst.dark, 0.024, 0.02, 0, 0.132, -0.13, 8);
  b.ring(sight, RARITY_COLORS[b.rarityLevel], 0.0215, 0.006, 0, 0.132, -0.141, 8);
  b.box(sight, b.dark, 0.012, 0.018, 0.03, 0, 0.113, -0.06);
  b.box(sight, glowMat(RETICLE_COLOR), 0.003, 0.003, 0.002, 0, 0.132, -0.128);
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
  sl.name = 'string_l';
  sr.name = 'string_r';
  r.add(sl, sr);
  m.stringHalves = [sl, sr];
  m.stringTip = { x: 0.188, y: 0.05, z: -0.292 };
  // 弩箭
  const bolt = b.group(r, 0, 0.074, -0.24);
  bolt.name = 'bolt';
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

// ───────────── 武器库扩充（docs/arsenal-expansion.md 第 3 节） ─────────────

/** 朱雀吐息：赤红枪身、外扩喷口与金环、朱雀头罩，枪身下挂燃料罐 */
function buildFlamer(b: Builder, m: GunModel): void {
  const r = b.root;
  const pal = PALETTES.flamer;
  // 枪身、稀有度条、尾盖
  b.box(r, b.body, 0.07, 0.07, 0.32, 0, 0.02, -0.12);
  b.box(r, b.rarity, 0.004, 0.008, 0.2, 0.036, 0.02, -0.12);
  b.box(r, b.rarity, 0.004, 0.008, 0.2, -0.036, 0.02, -0.12);
  b.box(r, b.dark, 0.074, 0.074, 0.014, 0, 0.02, 0.045);
  // 顶部隔热罩，散热窗透出火光
  b.box(r, b.dark, 0.05, 0.012, 0.22, 0, 0.061, -0.14);
  for (let i = 0; i < 4; i++) b.box(r, b.energyMat, 0.034, 0.004, 0.008, 0, 0.0675, -0.07 - i * 0.04);
  // 喷口（−Z 端外扩）与三道金环，口内火光
  b.cyl(r, b.dark, 0.022, 0.16, 0, 0.03, -0.36, 'z', 10, 0.034);
  for (const z of [-0.3, -0.34, -0.38]) b.ring(r, pal.accent, 0.03, 0.012, 0, 0.03, z);
  b.cyl(r, b.energyMat, 0.025, 0.004, 0, 0.03, -0.441, 'z', 10);
  // 朱雀头罩、冠羽、喙与双目
  b.box(r, b.accent, 0.05, 0.03, 0.06, 0, 0.065, -0.33, 0.3);
  b.box(r, b.accent, 0.008, 0.03, 0.02, 0.012, 0.085, -0.31, -0.4);
  b.box(r, b.accent, 0.008, 0.03, 0.02, -0.012, 0.085, -0.31, -0.4);
  b.box(r, b.accent, 0.018, 0.012, 0.03, 0, 0.058, -0.37, 0.55);
  b.box(r, b.energyMat, 0.004, 0.006, 0.008, 0.0255, 0.068, -0.345);
  b.box(r, b.energyMat, 0.004, 0.006, 0.008, -0.0255, 0.068, -0.345);
  // 引火苗与点火座
  b.box(r, b.dark, 0.016, 0.01, 0.05, 0, -0.004, -0.385);
  b.cyl(r, b.energyMat, 0.006, 0.02, 0, -0.005, -0.41, 'y', 6);
  // 压力表（左侧，第一人称可见）
  b.cyl(r, b.dark, 0.016, 0.01, -0.04, 0.03, 0.015, 'x', 10);
  b.cyl(r, b.energyMat, 0.012, 0.003, -0.0455, 0.03, 0.015, 'x', 10);
  // 燃料罐（cell 换弹时向下卸出）
  const tank = b.group(r, 0, -0.07, -0.088);
  b.cyl(tank, b.body, 0.035, 0.16, 0, 0, 0, 'z', 10);
  b.cyl(tank, b.dark, 0.037, 0.012, 0, 0, 0.052, 'z', 10);
  b.cyl(tank, b.dark, 0.037, 0.012, 0, 0, -0.052, 'z', 10);
  b.cyl(tank, b.dark, 0.024, 0.01, 0, 0, -0.084, 'z', 10, 0.014);
  b.box(tank, b.energyMat, 0.012, 0.03, 0.07, 0.036, 0, 0);
  b.box(tank, b.energyMat, 0.012, 0.03, 0.07, -0.036, 0, 0);
  m.mag = tank;
  // 握把：后握、扳机、前竖握
  b.pistolGrip(r, b.grip, -0.06, 0.05, 0.11, -0.25);
  b.trigger(r, 0.02);
  b.box(r, b.grip, 0.025, 0.07, 0.03, 0, -0.04, -0.26);
  b.box(r, b.dark, 0.03, 0.01, 0.034, 0, -0.078, -0.26);
  m.leftHand = new THREE.Vector3(0, -0.03, -0.26);
  m.muzzle.position.set(0, 0.03, -0.45);
}

/** 青冥雷蛊：青铜炮管、五罐转鼓（贴符）、顶部青铜导轨 */
function buildStormpod(b: Builder, m: GunModel): void {
  const r = b.root;
  const pal = PALETTES.stormpod;
  // 炮管、前后铜箍、管口内辉
  b.tube(r, pal.dark, 0.04, 0.2, 0, 0.04, -0.2, 12);
  b.tube(r, pal.accent, 0.044, 0.02, 0, 0.04, -0.292, 12);
  b.tube(r, pal.accent, 0.044, 0.016, 0, 0.04, -0.115, 12);
  b.cyl(r, b.energyMat, 0.03, 0.01, 0, 0.04, -0.29, 'z', 12);
  // 炮管左侧的镇雷符
  const paper = solidMat(0xe8d9a0, 0, 0.9);
  b.box(r, paper, 0.002, 0.036, 0.022, -0.0405, 0.04, -0.17, 0, 0, -0.06);
  b.box(r, markMat(0xd23a2a), 0.003, 0.008, 0.008, -0.041, 0.046, -0.17);
  // 蛊罐转鼓：5 个罐包 + 中轴，转鼓上贴符纸与朱印
  const drum = b.group(r, 0, 0.03, -0.03);
  b.cyl(drum, b.body, 0.05, 0.09, 0, 0, 0, 'z', 10);
  b.cyl(drum, b.accent, 0.01, 0.097, 0, 0, 0, 'z', 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.cyl(drum, b.energyMat, 0.012, 0.095, Math.cos(a) * 0.033, Math.sin(a) * 0.033, 0, 'z', 6);
  }
  b.box(drum, paper, 0.025, 0.05, 0.002, 0.055, 0, -0.05, 0, 0, 0.15);
  b.box(drum, markMat(0xd23a2a), 0.008, 0.008, 0.003, 0.0555, -0.012, -0.05);
  m.cylinder = drum;
  m.mag = drum;
  m.cylinderSteps = 5;
  // 下机架（连接握把、转鼓与前握）
  b.box(r, b.dark, 0.056, 0.018, 0.3, 0, -0.005, -0.08);
  // 顶部青铜导轨（两个导轨座）与准星
  b.box(r, b.accent, 0.012, 0.008, 0.22, 0, 0.088, -0.12);
  b.box(r, b.dark, 0.008, 0.006, 0.012, 0, 0.082, -0.2);
  b.box(r, b.dark, 0.008, 0.006, 0.012, 0, 0.082, -0.13);
  b.box(r, b.accent, 0.006, 0.012, 0.006, 0, 0.098, -0.225);
  // 稀有度条
  b.box(r, b.rarity, 0.004, 0.008, 0.12, 0.03, -0.01, -0.15);
  b.box(r, b.rarity, 0.004, 0.008, 0.12, -0.03, -0.01, -0.15);
  // 握把、前握、短托
  b.pistolGrip(r, b.grip, -0.06, 0.05, 0.11, -0.3);
  b.trigger(r, 0);
  b.box(r, b.grip, 0.024, 0.05, 0.03, 0, -0.03, -0.2);
  b.box(r, b.body, 0.04, 0.05, 0.1, 0, 0.0, 0.12);
  b.box(r, b.dark, 0.046, 0.066, 0.016, 0, -0.004, 0.176);
  m.leftHand = new THREE.Vector3(0, -0.02, -0.2);
  m.muzzle.position.set(0, 0.04, -0.31);
}

/** 赤蛟霰铳：并列双管、龙鳞脊、火蚀双色标记的折开式霰弹枪 */
function buildMagmashot(b: Builder, m: GunModel): void {
  const r = b.root;
  // 并列双管与中脊 / 下肋
  b.cyl(r, b.body, 0.017, 0.36, 0.019, 0.04, -0.2, 'z', 10);
  b.cyl(r, b.body, 0.017, 0.36, -0.019, 0.04, -0.2, 'z', 10);
  b.box(r, b.dark, 0.01, 0.012, 0.34, 0, 0.052, -0.2);
  b.box(r, b.dark, 0.01, 0.012, 0.3, 0, 0.028, -0.21);
  // 龙鳞脊 6 片与蛟首准星
  for (let i = 0; i < 6; i++) b.box(r, b.accent, 0.012, 0.006, 0.03, 0, 0.062, -0.05 - i * 0.056);
  b.box(r, b.accent, 0.005, 0.012, 0.005, 0, 0.066, -0.365);
  // 蚀色导槽（两侧）与火色管口环（固定颜色，一眼可见双元素）
  b.box(r, markMat(0x9dff4a), 0.004, 0.01, 0.05, 0.037, 0.04, -0.25);
  b.box(r, markMat(0x9dff4a), 0.004, 0.01, 0.05, -0.037, 0.04, -0.25);
  b.cyl(r, markMat(0xff6a1f), 0.02, 0.008, 0.019, 0.04, -0.37, 'z', 10);
  b.cyl(r, markMat(0xff6a1f), 0.02, 0.008, -0.019, 0.04, -0.37, 'z', 10);
  b.cyl(r, b.dark, 0.011, 0.004, 0.019, 0.04, -0.381, 'z', 8);
  b.cyl(r, b.dark, 0.011, 0.004, -0.019, 0.04, -0.381, 'z', 8);
  // 机匣：能量槽、稀有度条、铰链、顶杆与双击锤
  b.box(r, b.dark, 0.05, 0.06, 0.12, 0, 0.025, 0.02);
  b.box(r, b.energyMat, 0.004, 0.012, 0.08, 0.026, 0.025, 0.02);
  b.box(r, b.energyMat, 0.004, 0.012, 0.08, -0.026, 0.025, 0.02);
  b.box(r, b.rarity, 0.004, 0.008, 0.1, 0.026, 0, 0.02);
  b.box(r, b.rarity, 0.004, 0.008, 0.1, -0.026, 0, 0.02);
  b.cyl(r, b.accent, 0.007, 0.054, 0, 0.004, -0.035, 'x', 8);
  b.box(r, b.accent, 0.012, 0.006, 0.04, 0, 0.058, 0.05);
  b.box(r, b.dark, 0.008, 0.022, 0.012, 0.013, 0.062, 0.072, -0.5);
  b.box(r, b.dark, 0.008, 0.022, 0.012, -0.013, 0.062, 0.072, -0.5);
  // 枪托与托底板
  b.box(r, b.grip, 0.04, 0.06, 0.18, 0, -0.01, 0.15, -0.15);
  b.box(r, b.dark, 0.044, 0.066, 0.012, 0, 0.004, 0.245, -0.15);
  b.pistolGrip(r, b.grip, -0.05, 0.06, 0.1, -0.4);
  b.trigger(r, 0.0);
  // 护木（贴住双管底部）与防滑槽
  b.box(r, b.grip, 0.05, 0.04, 0.12, 0, 0.003, -0.16);
  for (let i = 0; i < 3; i++) b.box(r, b.dark, 0.054, 0.006, 0.01, 0, -0.008, -0.2 + i * 0.04);
  m.leftHand = new THREE.Vector3(0, -0.02, -0.16);
  m.muzzle.position.set(0, 0.04, -0.39);
}

/** 三才转轮：六膛转轮（火雷蚀弹膛帽），卦象肋与随下一发元素变色的灵纹 */
function buildTrinity(b: Builder, m: GunModel): void {
  const r = b.root;
  // 握把、握把底、扳机、框架、后背
  b.pistolGrip(r, b.grip, -0.058, 0.032, 0.115, -0.32);
  b.box(r, b.dark, 0.044, 0.018, 0.06, 0, -0.116, 0.052, -0.32);
  b.trigger(r, -0.03);
  b.box(r, b.body, 0.042, 0.052, 0.13, 0, 0.03, -0.025);
  b.box(r, b.body, 0.034, 0.03, 0.05, 0, 0.012, 0.045);
  // 转轮：弹膛 i 位于 π/2 − i·60°，每发前转一格后，正上方（对准枪管）恰为下一发的元素
  const cy = b.group(r, 0, 0.04, -0.05);
  b.cyl(cy, b.dark, 0.034, 0.066, 0, 0, 0, 'z', 10);
  b.cyl(cy, b.accent, 0.008, 0.07, 0, 0, 0, 'z', 6);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 - (i / 6) * Math.PI * 2;
    b.cyl(cy, markMat(ELEMENT_COLORS[TRINITY_CYCLE[i % 3]]), 0.0065, 0.068, Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0, 'z', 6);
  }
  m.cylinder = cy;
  m.mag = cy;
  m.cylinderSteps = 6;
  // 枪管与下挂凸耳；卦象肋三道
  b.cyl(r, b.body, 0.015, 0.2, 0, 0.058, -0.18, 'z', 8);
  b.box(r, b.body, 0.012, 0.016, 0.18, 0, 0.044, -0.18);
  for (const z of [-0.12, -0.16, -0.2]) b.box(r, b.accent, 0.03, 0.004, 0.01, 0, 0.076, z);
  // 灵纹条（动态变色：下一发的元素）
  b.box(r, b.energyMat, 0.004, 0.01, 0.12, 0.016, 0.058, -0.18);
  b.box(r, b.energyMat, 0.004, 0.01, 0.12, -0.016, 0.058, -0.18);
  // 稀有度条
  b.box(r, b.rarity, 0.004, 0.008, 0.11, 0.022, 0.03, -0.03);
  b.box(r, b.rarity, 0.004, 0.008, 0.11, -0.022, 0.03, -0.03);
  // 三才徽记（框架两侧三色点）
  for (let i = 0; i < 3; i++) {
    const mat = markMat(ELEMENT_COLORS[TRINITY_CYCLE[i]]);
    b.box(r, mat, 0.003, 0.006, 0.006, 0.0215, 0.014, -0.006 + i * 0.012);
    b.box(r, mat, 0.003, 0.006, 0.006, -0.0215, 0.014, -0.006 + i * 0.012);
  }
  // 照门座、照门、击锤、准星（开镜时准星顶端落在屏幕中央）
  b.box(r, b.body, 0.026, 0.02, 0.03, 0, 0.066, 0.022);
  b.rearNotch(r, 0.083, 0.022, 0.014, 0.01);
  b.box(r, b.dark, 0.012, 0.03, 0.02, 0, 0.056, 0.052, 0.4);
  b.box(r, b.accent, 0.005, 0.017, 0.012, 0, 0.0815, -0.265);
  m.muzzle.position.set(0, 0.058, -0.285);
}

/** 贯虹灵炮：双导轨夹发光芯，四道旋转线圈（随蓄力加速），顶置电容 */
function buildRailgun(b: Builder, m: GunModel): void {
  const r = b.root;
  const pal = PALETTES.railgun;
  // 机匣与两侧散热槽
  b.box(r, b.body, 0.07, 0.09, 0.3, 0, 0.02, -0.02);
  for (let i = 0; i < 4; i++) {
    b.box(r, b.dark, 0.004, 0.03, 0.01, 0.036, 0.012, -0.12 + i * 0.026);
    b.box(r, b.dark, 0.004, 0.03, 0.01, -0.036, 0.012, -0.12 + i * 0.026);
  }
  // 双导轨与发光芯；前端上下导轨桥
  b.box(r, b.dark, 0.012, 0.05, 0.55, 0.022, 0.035, -0.425);
  b.box(r, b.dark, 0.012, 0.05, 0.55, -0.022, 0.035, -0.425);
  b.box(r, markMat(pal.accent), 0.006, 0.02, 0.52, 0, 0.035, -0.42);
  b.box(r, b.dark, 0.056, 0.01, 0.024, 0, 0.065, -0.66);
  b.box(r, b.dark, 0.056, 0.01, 0.024, 0, 0.005, -0.66);
  // 线圈：4 个发光环，各带一颗能量块让旋转看得见；两根笼条连成一体
  const sp = b.group(r, 0, 0.035, -0.42);
  for (const z of [-0.18, -0.06, 0.06, 0.18]) {
    b.ring(sp, pal.accent, 0.045, 0.012, 0, 0, z);
    b.box(sp, b.energyMat, 0.01, 0.01, 0.014, 0, 0.045, z);
  }
  for (const a of [Math.PI * 7 / 6, Math.PI * 11 / 6]) b.box(sp, b.dark, 0.004, 0.004, 0.37, Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0);
  m.spinner = sp;
  // 电容（cell 换弹时向上抽出）
  const cap = b.group(r, 0, 0.085, 0.02);
  b.cyl(cap, b.dark, 0.03, 0.12, 0, 0, 0, 'z', 10);
  b.cyl(cap, b.energyMat, 0.031, 0.015, 0, 0, 0.035, 'z', 10);
  b.cyl(cap, b.energyMat, 0.031, 0.015, 0, 0, -0.035, 'z', 10);
  b.cyl(cap, b.accent, 0.022, 0.008, 0, 0, 0.062, 'z', 10);
  b.cyl(cap, b.accent, 0.022, 0.008, 0, 0, -0.062, 'z', 10);
  m.mag = cap;
  // 枪托、托底板、握把、扳机
  b.box(r, b.body, 0.04, 0.07, 0.16, 0, 0, 0.2);
  b.box(r, b.dark, 0.046, 0.08, 0.014, 0, 0, 0.285);
  b.pistolGrip(r, b.grip, -0.058, 0.05, 0.11, -0.3);
  b.trigger(r, 0.0);
  // 照门（立柱支撑）、准星与虹光觇环（开镜时觇环中心落在屏幕中央）
  b.box(r, b.dark, 0.016, 0.06, 0.012, 0, 0.095, 0.092);
  b.rearNotch(r, 0.13, 0.08);
  b.box(r, b.dark, 0.006, 0.018, 0.006, 0, 0.072, -0.66);
  b.box(r, b.dark, 0.004, 0.036, 0.006, 0, 0.098, -0.66);
  b.ring(r, pal.accent, 0.014, 0.005, 0, 0.13, -0.66, 12);
  // 稀有度条
  b.box(r, b.rarity, 0.004, 0.008, 0.24, 0.036, 0.04, -0.02);
  b.box(r, b.rarity, 0.004, 0.008, 0.24, -0.036, 0.04, -0.02);
  // 线圈下方的握脊（左手握持）
  b.box(r, b.dark, 0.022, 0.016, 0.28, 0, -0.026, -0.31);
  m.leftHand = new THREE.Vector3(0, -0.02, -0.32);
  m.muzzle.position.set(0, 0.035, -0.72);
}

/** 蚀蛊灯：握杆前端挂一盏铜骨蛊灯，灯纱透出蛊火 */
function buildLantern(b: Builder, m: GunModel): void {
  const r = b.root;
  // 握杆与铜箍、杆尾
  b.cyl(r, b.grip, 0.018, 0.22, 0, 0, -0.08, 'z', 8);
  b.cyl(r, b.accent, 0.02, 0.012, 0, 0, -0.182, 'z', 8);
  b.cyl(r, b.accent, 0.02, 0.012, 0, 0, 0.022, 'z', 8);
  b.cyl(r, b.accent, 0.012, 0.024, 0, 0, 0.04, 'z', 8, 0.02);
  b.pistolGrip(r, b.grip, -0.055, 0.04, 0.1, -0.3);
  b.trigger(r, 0);
  // 横梁，立柱与挑臂（灯钩挂在挑臂下）
  b.box(r, b.accent, 0.012, 0.012, 0.08, 0, 0.02, -0.2);
  b.box(r, b.accent, 0.008, 0.05, 0.008, 0, 0.04, -0.19);
  b.box(r, b.accent, 0.008, 0.008, 0.08, 0, 0.064, -0.23);
  // 灯笼：6 根灯骨、上下灯盖、吊钩、铜坠与红穗、灯纱
  const lg = b.group(r, 0, -0.03, -0.26);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(lg, b.dark, 0.004, 0.11, 0.004, Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
  }
  b.cyl(lg, b.accent, 0.054, 0.01, 0, 0.055, 0, 'y', 10);
  b.cyl(lg, b.accent, 0.054, 0.01, 0, -0.055, 0, 'y', 10);
  b.box(lg, b.accent, 0.004, 0.03, 0.004, 0, 0.075, 0);
  b.cyl(lg, b.accent, 0.006, 0.03, 0, -0.075, 0, 'y', 6);
  b.box(lg, solidMat(0xb02a22, 0, 0.9), 0.006, 0.03, 0.006, 0, -0.104, 0);
  b.cyl(lg, veilMat(0x9dff4a, 0.16), 0.048, 0.1, 0, 0, 0, 'y', 12);
  // 灯芯（cell 换弹时向上抽出）与焰尖
  const wick = b.group(lg, 0, 0, 0);
  b.cyl(wick, b.energyMat, 0.03, 0.07, 0, 0, 0, 'y', 10);
  b.cyl(wick, b.energyMat, 0.002, 0.014, 0, 0.042, 0, 'y', 8, 0.016);
  m.mag = wick;
  // 稀有度条
  b.box(r, b.rarity, 0.004, 0.008, 0.14, 0.02, 0, -0.08);
  b.box(r, b.rarity, 0.004, 0.008, 0.14, -0.02, 0, -0.08);
  m.leftHand = new THREE.Vector3(0, -0.02, -0.12);
  m.muzzle.position.set(0, -0.03, -0.33);
}

// ───────────── 魔刀千刃（docs/demon-blade.md 第 8、10.7 节） ─────────────
//
// 刀身由「刀脊骨架（body，暗）+ 血槽符纹（body，朱红发光）」与 18 片刃片拼成：每段一片刃口（带抛光斜面与符文）
// 一片刀背，两列之间留一道缝，血槽的红光从缝里透出。刃片的几何体按刀身弧度在 root 空间算好角点后
// 以自身质心为原点（home 朝向 = 单位旋转），变形时整片飞离、悬浮、飞回。

/** 刃片段起点（兽口前的刀根）与长度：刃片段占 z ∈ [BLADE_Z0 − BLADE_LEN, BLADE_Z0] */
const BLADE_Z0 = -0.128;
const BLADE_LEN = 0.742;
const BLADE_SEGS = BLADE_SHARDS / 2;
/** 刃口 / 刀背两列刃片之间的缝（半宽） */
const BLADE_GAP = 0.0012;
/** 刃口抛光斜面的高度 */
const BLADE_BEVEL = 0.0085;
const BLADE_EDGE_T = 0.0012;
/** 刀身组原点（兽首口中）：变形时刀脊沿 Z 缩回这里 */
const BLADE_BODY_Z = -0.09;
/** 符纹朱红（刀身符纹、兽目；与飞刃默认色一致） */
export const BLADE_RUNE_COLOR = 0xff3a24;
/** 无元素时宝珠的暗金 */
const BLADE_ORB_GOLD = 0xc9a040;
const BLADE_GOLD_BRIGHT = 0xd8b45a;
const TASSEL_RED = 0xb02a22;
const FANG_BONE = 0xe8dcc0;

/** 刀身中线高度（刀尖上翘约 0.06） */
const bladeMidY = (u: number): number => -0.004 + 0.062 * u * u;
/** 刀背高出中线的高度 */
const bladeSpineH = (u: number): number => 0.0185 - 0.003 * u;
/** 刃口低于中线的深度（越近刀尖越宽，牛尾刀的轮廓） */
const bladeEdgeH = (u: number): number => 0.021 + 0.013 * u;
/** 刀背厚 / 中线处厚 / 斜面起点厚（随长度收薄） */
const bladeSpineT = (u: number): number => 0.0095 - 0.0035 * u;
const bladeMidT = (u: number): number => 0.0074 - 0.003 * u;
const bladeBevelT = (u: number): number => 0.0042 - 0.0016 * u;
const bladeZ = (u: number): number => BLADE_Z0 - BLADE_LEN * u;
/** 刀尖：刃口在最后一段扫上来与刀背相交（夹钢尖） */
const BLADE_TIP_Y = bladeMidY(1) + bladeSpineH(1) * 0.5;
const BLADE_TIP_Z = bladeZ(1);

/** 六面体截面：z 处从 yBot（x 向厚 tBot）到 yTop（厚 tTop），x 居中 */
interface Section { z: number; yBot: number; yTop: number; tBot: number; tTop: number }

const sec = (z: number, yBot: number, yTop: number, tBot: number, tTop: number): Section => ({ z, yBot, yTop, tBot, tTop });

/** 六面体 6 个面的角点下标（角点：截面 a 的 左下 / 右下 / 右上 / 左上，再截面 b 同序） */
const HEX_FACES: readonly (readonly number[])[] = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];

/** 角点平均（质心） */
function slabCenter(a: Section, b: Section, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, (a.yBot + a.yTop + b.yBot + b.yTop) / 4, (a.z + b.z) / 2);
}

/**
 * 把截面 a → b 围成的六面体（非索引三角形，绕序朝外）追加到 out，所有角点减去 origin。
 * 角点可以重合（刀尖处退化成线），零面积三角形无害。
 */
function pushSlab(out: number[], a: Section, b: Section, origin: THREE.Vector3): void {
  const c = [
    -a.tBot / 2, a.yBot, a.z, a.tBot / 2, a.yBot, a.z, a.tTop / 2, a.yTop, a.z, -a.tTop / 2, a.yTop, a.z,
    -b.tBot / 2, b.yBot, b.z, b.tBot / 2, b.yBot, b.z, b.tTop / 2, b.yTop, b.z, -b.tTop / 2, b.yTop, b.z,
  ];
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < 8; i++) {
    mx += c[i * 3];
    my += c[i * 3 + 1];
    mz += c[i * 3 + 2];
  }
  mx /= 8;
  my /= 8;
  mz /= 8;
  for (const f of HEX_FACES) {
    // Newell 法线（对不共面的四边形也稳定）与面心
    let nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0;
    for (let k = 0; k < 4; k++) {
      const i = f[k] * 3, j = f[(k + 1) % 4] * 3;
      nx += (c[i + 1] - c[j + 1]) * (c[i + 2] + c[j + 2]);
      ny += (c[i + 2] - c[j + 2]) * (c[i] + c[j]);
      nz += (c[i] - c[j]) * (c[i + 1] + c[j + 1]);
      fx += c[i];
      fy += c[i + 1];
      fz += c[i + 2];
    }
    const out4 = nx * (fx / 4 - mx) + ny * (fy / 4 - my) + nz * (fz / 4 - mz) >= 0;
    const o = out4 ? f : [f[0], f[3], f[2], f[1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const i = o[k] * 3;
      out.push(c[i] - origin.x, c[i + 1] - origin.y, c[i + 2] - origin.z);
    }
  }
}

function arrayGeo(pos: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const _bm = new THREE.Matrix4();
const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
const _bp = new THREE.Vector3();
const _bs = new THREE.Vector3(1, 1, 1);
const _ba = new THREE.Vector3();

/** 把若干小方块（[w, h, d, x, y, z, rx, ry, rz]）合并成一个非索引几何体 */
function mergedBoxes(boxes: readonly (readonly number[])[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const [w, h, d, x, y, z, rx = 0, ry = 0, rz = 0] of boxes) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    _bm.compose(_bp.set(x, y, z), _bq.setFromEuler(_be.set(rx, ry, rz)), _bs);
    g.applyMatrix4(_bm);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    g.dispose();
  }
  return arrayGeo(pos);
}

/** 刀身各部件的共享几何体（与稀有度 / 元素无关，全局只建一次） */
interface BladeGeos {
  /** 每片刃片：主体几何体（以质心为原点）与质心（root 空间） */
  shard: THREE.BufferGeometry[];
  shardCenter: THREE.Vector3[];
  /** 刃口片的抛光斜面（同一原点）；刀背片为 null */
  bevel: (THREE.BufferGeometry | null)[];
  /** 刃口片的符文（两面各一道刻痕 + 一点；同一原点）；刀背片为 null */
  glyph: (THREE.BufferGeometry | null)[];
  /** 刀脊骨架与血槽符纹（刀身组空间，原点 BLADE_BODY_Z） */
  core: THREE.BufferGeometry;
  groove: THREE.BufferGeometry;
}

let bladeGeos: BladeGeos | null = null;

function getBladeGeos(): BladeGeos {
  if (bladeGeos) return bladeGeos;
  const shard: THREE.BufferGeometry[] = [];
  const shardCenter: THREE.Vector3[] = [];
  const bevel: (THREE.BufferGeometry | null)[] = [];
  const glyph: (THREE.BufferGeometry | null)[] = [];
  const tipY = BLADE_TIP_Y, tipZ = BLADE_TIP_Z, tipT = BLADE_EDGE_T;
  for (let k = 0; k < BLADE_SEGS; k++) {
    const ua = k / BLADE_SEGS, ub = (k + 1) / BLADE_SEGS;
    const tip = k === BLADE_SEGS - 1;
    const za = bladeZ(ua), zb = bladeZ(ub);
    const ma = bladeMidY(ua), mb = bladeMidY(ub);
    // 刃口片：上部暗钢（中线 → 斜面线）+ 下部抛光斜面（斜面线 → 刃口）
    const ea = ma - bladeEdgeH(ua), eb = mb - bladeEdgeH(ub);
    const upA = sec(za, ea + BLADE_BEVEL, ma - BLADE_GAP, bladeBevelT(ua), bladeMidT(ua));
    const upB = tip ? sec(zb, tipY - 0.004, tipY - 0.003, tipT, tipT) : sec(zb, eb + BLADE_BEVEL, mb - BLADE_GAP, bladeBevelT(ub), bladeMidT(ub));
    const bvA = sec(za, ea, ea + BLADE_BEVEL, BLADE_EDGE_T, bladeBevelT(ua));
    const bvB = tip ? sec(zb, tipY - 0.0045, tipY - 0.004, tipT, tipT) : sec(zb, eb, eb + BLADE_BEVEL, BLADE_EDGE_T, bladeBevelT(ub));
    const ce = slabCenter(upA, upB, new THREE.Vector3());
    const ep: number[] = [];
    pushSlab(ep, upA, upB, ce);
    shard.push(arrayGeo(ep));
    shardCenter.push(ce);
    const bp: number[] = [];
    pushSlab(bp, bvA, bvB, ce);
    bevel.push(arrayGeo(bp));
    // 符文：上部两面各一道斜刻痕 + 一点（刀尖段放在靠后的位置）
    const gu = tip ? ua + 0.3 / BLADE_SEGS : (ua + ub) / 2;
    const gm = bladeMidY(gu);
    const gy = (gm - BLADE_GAP + gm - bladeEdgeH(gu) + BLADE_BEVEL) / 2 - (tip ? 0.002 : 0);
    const gx = (bladeMidT(gu) + bladeBevelT(gu)) / 4 + 0.00045;
    const gz = bladeZ(gu);
    const slant = k % 2 === 0 ? 0.5 : -0.5;
    const boxes: number[][] = [];
    for (const s of [-1, 1]) {
      boxes.push([0.0012, 0.0062, 0.0115, s * gx - ce.x, gy - ce.y, gz - ce.z, slant, 0, 0]);
      boxes.push([0.0012, 0.0024, 0.0024, s * gx - ce.x, gy - ce.y, gz + 0.0115 - ce.z, 0.785, 0, 0]);
    }
    glyph.push(mergedBoxes(boxes));
    // 刀背片：中线 → 刀背
    const bkA = sec(za, ma + BLADE_GAP, ma + bladeSpineH(ua), bladeMidT(ua), bladeSpineT(ua));
    const bkB = tip ? sec(zb, tipY - 0.0015, tipY, tipT, tipT) : sec(zb, mb + BLADE_GAP, mb + bladeSpineH(ub), bladeMidT(ub), bladeSpineT(ub));
    const cb = slabCenter(bkA, bkB, new THREE.Vector3());
    const kp: number[] = [];
    pushSlab(kp, bkA, bkB, cb);
    shard.push(arrayGeo(kp));
    shardCenter.push(cb);
    bevel.push(null);
    glyph.push(null);
  }
  // 刀脊骨架：比刃片薄、藏在刃片里；刃片离开后露出暗色的「骨」。从兽口里（刀身组原点）伸到刀尖前
  const origin = _ba.set(0, 0, BLADE_BODY_Z);
  const cp: number[] = [];
  const gp: number[] = [];
  const coreSec = (u: number, z = bladeZ(u)): Section => {
    const m = bladeMidY(u), h = 0.0085 - 0.004 * u, t = 0.0056 - 0.0028 * u;
    return sec(z, m - h, m + h, t, t);
  };
  const grooveSec = (u: number, z = bladeZ(u)): Section => {
    const m = bladeMidY(u), t = bladeMidT(u) + 0.0009;
    return sec(z, m - 0.0017, m + 0.0017, t, t);
  };
  pushSlab(cp, coreSec(0, BLADE_BODY_Z), coreSec(0), origin);
  const coreEnd = 0.92, grooveEnd = 0.9;
  for (let k = 0; k < BLADE_SEGS; k++) {
    pushSlab(cp, coreSec((k / BLADE_SEGS) * coreEnd), coreSec(((k + 1) / BLADE_SEGS) * coreEnd), origin);
    pushSlab(gp, grooveSec((k / BLADE_SEGS) * grooveEnd), grooveSec(((k + 1) / BLADE_SEGS) * grooveEnd), origin);
  }
  bladeGeos = { shard, shardCenter, bevel, glyph, core: arrayGeo(cp), groove: arrayGeo(gp) };
  return bladeGeos;
}

const _sz = new THREE.Vector3(0, 0, 1);
const _sd = new THREE.Vector3();

/** 两点之间的方条（沿 a → b，截面 w × h） */
function strut(parent: THREE.Object3D, mat: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number): THREE.Mesh {
  _sd.set(bx - ax, by - ay, bz - az);
  const len = _sd.length();
  const m = new THREE.Mesh(boxGeo(w, h, len), mat);
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(_sz, _sd.multiplyScalar(1 / len));
  parent.add(m);
  return m;
}

/**
 * 魔刀千刃：暗钢弧形长刀（牛尾刀轮廓、夹钢尖），朱红血槽与刃口符文；兽首衔刃的鎏金护手，兽目发红光；
 * 缠布握把、环首柄尾挂红流苏；刀根镶元素色宝珠。单手持刀（无左手）。
 */
function buildDemonBlade(b: Builder, m: GunModel): void {
  const r = b.root;
  const G = getBladeGeos();
  // 暗钢：比调色板 body 略亮、金属度适中（第一人称没有环境贴图，金属度太高会发黑）
  const steel = solidMat(0x5c5f6a, 0.35, 0.4);
  const steelBack = solidMat(0x4c4e58, 0.38, 0.42);
  const polish = solidMat(0xdde2e8, 0.32, 0.24);
  const gold = b.accent;
  const goldHi = solidMat(BLADE_GOLD_BRIGHT, 0.6, 0.35);
  const rune = markMat(BLADE_RUNE_COLOR);
  const cloth = solidMat(TASSEL_RED, 0, 0.9);
  const runes: THREE.Mesh[] = [];

  // ── 握把：缠布（交错倾斜的布圈）、前后金箍、稀有度色箍 ──
  b.cyl(r, b.dark, 0.0158, 0.134, 0, 0, 0.046, 'z', 8);
  for (let i = 0; i < 9; i++) {
    const w = b.cyl(r, b.grip, 0.0174, 0.0078, 0, 0, -0.011 + i * 0.0148, 'z', 8);
    w.rotation.x = i % 2 === 0 ? 0.32 : -0.32;
  }
  b.cyl(r, gold, 0.0186, 0.009, 0, 0, -0.019, 'z', 8);
  b.cyl(r, gold, 0.019, 0.011, 0, 0, 0.113, 'z', 8);
  b.cyl(r, b.rarity, 0.0189, 0.0032, 0, 0, 0.105, 'z', 8);
  // 环首（立在 YZ 平面）与环内的小兽牙
  const ring = new THREE.Mesh(torusGeo(0.022, 0.0055, 6, 14), gold);
  ring.position.set(0, 0, 0.141);
  ring.rotation.y = Math.PI / 2;
  r.add(ring);
  b.box(r, goldHi, 0.006, 0.01, 0.008, 0, 0.0, 0.119);

  // ── 兽首护手（兽首衔刃） ──
  const guard = b.group(r, 0, 0, 0);
  const tsuba = b.cyl(guard, gold, 0.029, 0.007, 0, 0, -0.026, 'z', 10);
  tsuba.scale.set(1, 1.22, 1);
  const rim = b.ring(guard, RARITY_COLORS[b.rarityLevel], 0.0292, 0.0026, 0, 0, -0.026, 10);
  rim.scale.set(1, 1.22, 1);
  // 兽首：头、眉骨、两腮
  b.box(guard, gold, 0.04, 0.052, 0.04, 0, 0.002, -0.05);
  b.box(guard, goldHi, 0.046, 0.011, 0.024, 0, 0.027, -0.061, 0.35);
  // 上颚 / 鼻 / 鼻孔，下颚，獠牙
  b.box(guard, gold, 0.032, 0.015, 0.034, 0, 0.024, -0.08, -0.12);
  b.box(guard, goldHi, 0.022, 0.011, 0.011, 0, 0.029, -0.096);
  b.box(guard, b.dark, 0.005, 0.004, 0.002, 0.0062, 0.03, -0.1018);
  b.box(guard, b.dark, 0.005, 0.004, 0.002, -0.0062, 0.03, -0.1018);
  b.box(guard, gold, 0.028, 0.011, 0.028, 0, -0.027, -0.077, 0.18);
  const bone = solidMat(FANG_BONE, 0.05, 0.7);
  for (const s of [-1, 1]) {
    b.box(guard, gold, 0.01, 0.024, 0.03, s * 0.021, -0.004, -0.06, 0, s * 0.25, 0);
    b.box(guard, bone, 0.0045, 0.013, 0.0045, s * 0.0105, 0.012, -0.092);
    b.box(guard, bone, 0.004, 0.01, 0.004, s * 0.0095, -0.017, -0.087);
    // 兽目（符纹红）
    runes.push(b.box(guard, rune, 0.006, 0.006, 0.01, s * 0.0205, 0.017, -0.067, 0, s * 0.2, 0));
    // 双角：贴着握把上方向后掠
    strut(guard, goldHi, s * 0.014, 0.027, -0.047, s * 0.024, 0.041, -0.024, 0.008, 0.008);
    strut(guard, goldHi, s * 0.024, 0.041, -0.024, s * 0.027, 0.045, 0.002, 0.0055, 0.0055);
    // 腮鬃（兼作护手两翼，向后掠）与翼尖
    strut(guard, gold, s * 0.022, 0.002, -0.054, s * 0.046, -0.006, -0.03, 0.008, 0.006);
    b.box(guard, goldHi, 0.007, 0.007, 0.007, s * 0.047, -0.006, -0.029, 0.4, 0, s * 0.6);
    strut(guard, gold, s * 0.02, -0.016, -0.05, s * 0.037, -0.03, -0.032, 0.006, 0.005);
  }
  // 鬃脊与下巴须
  strut(guard, gold, 0, 0.029, -0.036, 0, 0.039, -0.014, 0.012, 0.006);
  strut(guard, gold, 0, -0.031, -0.07, 0, -0.046, -0.052, 0.01, 0.007);

  // ── 刀根（兽口吐出的一截实心刀身）、金箍与宝珠 ──
  const m0 = bladeMidY(0);
  const rTop = m0 + bladeSpineH(0), rBot = m0 - bladeEdgeH(0) * 0.95;
  b.box(r, steel, 0.0098, rTop - rBot, 0.043, 0, (rTop + rBot) / 2, -0.1075);
  b.box(r, goldHi, 0.0135, rTop - rBot + 0.006, 0.01, 0, (rTop + rBot) / 2, -0.088);
  b.box(r, b.rarity, 0.004, 0.003, 0.012, 0, rTop + 0.0036, -0.088);
  const orbMat = b.element === 'none' ? markMat(BLADE_ORB_GOLD) : b.energyMat;
  const orb = new THREE.Mesh(ballGeo(0.0088), orbMat);
  orb.position.set(0, (rTop + rBot) / 2, -0.109);
  r.add(orb);
  if (orbMat === b.energyMat) b.energy.push(orb);
  for (const s of [-1, 1]) {
    const bez = new THREE.Mesh(torusGeo(0.0098, 0.0018, 4, 12), goldHi);
    bez.position.set(s * 0.0052, orb.position.y, orb.position.z);
    bez.rotation.y = Math.PI / 2;
    r.add(bez);
  }

  // ── 刀身组：刀脊骨架 + 血槽符纹 ──
  const body = b.group(r, 0, 0, BLADE_BODY_Z);
  body.add(new THREE.Mesh(G.core, b.dark));
  const groove = new THREE.Mesh(G.groove, rune);
  body.add(groove);
  runes.push(groove);

  // ── 18 片刃片 ──
  const shards: THREE.Mesh[] = [];
  const shardHome: { pos: THREE.Vector3; rot: THREE.Euler }[] = [];
  for (let i = 0; i < BLADE_SHARDS; i++) {
    const edge = i % 2 === 0;
    const s = new THREE.Mesh(G.shard[i], edge ? steel : steelBack);
    s.position.copy(G.shardCenter[i]);
    r.add(s);
    const bv = G.bevel[i];
    if (bv) s.add(new THREE.Mesh(bv, polish));
    const gl = G.glyph[i];
    if (gl) {
      const gm = new THREE.Mesh(gl, rune);
      s.add(gm);
      runes.push(gm);
    }
    shards.push(s);
    shardHome.push({ pos: G.shardCenter[i].clone(), rot: new THREE.Euler() });
  }
  const shardOrder: number[] = [];
  for (let k = 0; k < BLADE_SHARDS; k++) shardOrder.push((BLADE_SEGS - 1 - (k >> 1)) * 2 + (k & 1));

  // ── 流苏：环首底部垂下，三节（绳 + 金珠 / 绳 + 金帽 / 穗） ──
  const t0 = b.group(r, 0, -0.026, 0.141);
  b.box(t0, cloth, 0.006, 0.01, 0.006, 0, -0.004, 0);
  b.box(t0, cloth, 0.0028, 0.026, 0.0028, 0, -0.019, 0);
  const bead = new THREE.Mesh(ballGeo(0.0062), goldHi);
  bead.position.set(0, -0.034, 0);
  t0.add(bead);
  const t1 = b.group(t0, 0, -0.037, 0);
  b.box(t1, cloth, 0.0026, 0.016, 0.0026, 0, -0.008, 0);
  b.cyl(t1, goldHi, 0.0058, 0.007, 0, -0.019, 0, 'y', 8);
  const t2 = b.group(t1, 0, -0.022, 0);
  b.cyl(t2, cloth, 0.0052, 0.056, 0, -0.028, 0, 'y', 7, 0.0125);
  const strand = solidMat(0x8a1c16, 0, 0.9);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(t2, strand, 0.0018, 0.014, 0.0018, Math.cos(a) * 0.009, -0.061, Math.sin(a) * 0.009, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
  }

  const tip = new THREE.Vector3(0, BLADE_TIP_Y, BLADE_TIP_Z);
  m.muzzle.position.copy(tip);
  m.blade = {
    body, shards, shardHome, shardOrder, runes, orb, guard, tassel: [t0, t1, t2],
    tip, trailInner: new THREE.Vector3(0, bladeMidY(0.3), bladeZ(0.3)),
  };
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
  flamer: buildFlamer,
  stormpod: buildStormpod,
  magmashot: buildMagmashot,
  trinity: buildTrinity,
  railgun: buildRailgun,
  lantern: buildLantern,
  demon_blade: buildDemonBlade,
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

/** 美术枪模雕刻纹路的自发光强度（按稀有度） */
const ART_GLOW: Record<Rarity, number> = { 0: 0.5, 1: 0.8, 2: 1.1, 3: 1.5, 4: 2.0 };

/** 构建一把枪（第一人称与掉落共用） */
export function buildGunModel(defId: string, rarity: Rarity, element: Element, opts: { art?: boolean } = {}): GunModel {
  const def = getWeaponDef(defId);
  const pal = PALETTES[def.id] ?? PALETTES.rifle;
  const b = new Builder(pal, rarity, element);
  const m = blankModel(b);
  (BUILDERS[def.id] ?? buildRifle)(b, m);
  b.root.name = `gun:${def.id}`;
  // 美术资产（art/pipeline 发布的刚体部件资产）：按部件挂到程序化节点上，活动部件照旧由程序动画驱动；
  // 资产缺失 / 未加载完 / ?classic 时保留程序化枪模
  const asset = opts.art === false ? null : AssetLibrary.findBound('weapon', def.id);
  const art = asset ? attachRigidParts(b.root, asset, PROCEDURAL_PARTS) : null;
  if (art?.emissive) {
    // 雕刻纹路发光：元素色；无元素时用稀有度色。亮度随稀有度提高
    const base = new THREE.Color(element !== 'none' ? ELEMENT_COLORS[element] : RARITY_COLORS[rarity]).multiplyScalar(ART_GLOW[rarity]);
    art.material.emissive.copy(base);
    art.material.userData.glowBase = base;
    m.artGlow = art.material;
  }
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
    // 半透明灯纱不投射阴影
    if (mesh.isMesh) mesh.castShadow = !(mesh.material as THREE.Material).transparent;
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
