import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RARITY_COLORS } from '../../core/types';
import type { Rarity, RewardType } from '../../core/types';

/**
 * 掉落 / 宝箱 / 商店用到的低多边形模型。
 * 几何体与共享材质做模块级缓存（永不释放）；同材质的静态零件预先合并成一个几何体以减少 draw call。
 * 需要逐实例动画的材质（宝箱宝石 / 内部光）由调用方负责 dispose。
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m as T;
}

function box(sx: number, sy: number, sz: number): THREE.BoxGeometry {
  return geo(`box:${sx}:${sy}:${sz}`, () => new THREE.BoxGeometry(sx, sy, sz));
}

/** 零件：几何体 + 平移 + 可选缩放 */
type Part = readonly [THREE.BufferGeometry, number, number, number, (readonly [number, number, number])?];

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 把多个零件合并成一个缓存几何体（零件须同为索引几何体） */
function merged(key: string, parts: readonly Part[]): THREE.BufferGeometry {
  return geo(key, () => {
    const list = parts.map(([g, x, y, z, s]) => {
      _t.set(x, y, z);
      _s.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1);
      return g.clone().applyMatrix4(_m4.compose(_t, _q.identity(), _s));
    });
    const out = mergeGeometries(list, false) as THREE.BufferGeometry | null;
    for (const g of list) if (g !== out) g.dispose();
    return out ?? new THREE.BufferGeometry();
  });
}

function std(color: number, opts: { metal?: number; rough?: number; emissive?: number; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `std:${color}:${opts.metal ?? 0}:${opts.rough ?? 0.7}:${opts.emissive ?? 0}:${opts.emissiveIntensity ?? 0}`;
  return mat(key, () => new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metal ?? 0,
    roughness: opts.rough ?? 0.7,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    flatShading: true,
  }));
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = false): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  if (shadow) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
  return o;
}

// ───────────── 调色板 ─────────────

export const PALETTE = {
  gold: 0xd9a441,
  lacquer: 0x5a1a14,
  vermilion: 0xa3232b,
  wood: 0x4a2c1a,
  paper: 0xf2e3c2,
  stone: 0x5c5f66,
  iron: 0x2e3036,
  coin: 0xffc23a,
  health: 0xff304a,
  ammo: 0x56643a,
  rune: 0x4aa3ff,
};

/** 奖励类型的主题色 */
export const REWARD_COLORS: Record<RewardType, number> = {
  scroll: 0xb45cff,
  weapon: 0xffa726,
  coins: 0xffd54a,
  heal: 0x4cff7a,
  upgrade: 0x4aa3ff,
  none: 0x9aa0a8,
};

export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// ───────────── 光柱 ─────────────

let gradientTex: THREE.Texture | null = null;

/** 自下而上渐隐的灰度贴图（用作 alphaMap） */
function beamGradient(): THREE.Texture {
  if (gradientTex) return gradientTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(0.55, '#3a3a3a');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  }
  gradientTex = new THREE.CanvasTexture(c);
  return gradientTex;
}

function beamMat(color: number): THREE.MeshBasicMaterial {
  return mat(`beam:${color}`, () => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    alphaMap: beamGradient(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
}

function glowMat(color: number, opacity = 0.7): THREE.MeshBasicMaterial {
  return mat(`glow:${color}:${opacity}`, () => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
}

/** 稀有度 / 奖励色光柱 + 地面光环（y=0 为地面） */
export function makeBeam(color: number, height = 4.5): THREE.Group {
  const g = new THREE.Group();
  const pillar = mesh(geo('beam', () => new THREE.CylinderGeometry(0.1, 0.32, 1, 12, 1, true).translate(0, 0.5, 0)), beamMat(color));
  pillar.scale.y = height;
  pillar.renderOrder = 2;
  const ring = mesh(geo('beamRing', () => new THREE.RingGeometry(0.42, 0.56, 28).rotateX(-Math.PI / 2)), glowMat(color, 0.75), 0, 0.03, 0);
  const disc = mesh(geo('beamDisc', () => new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2)), glowMat(color, 0.18), 0, 0.025, 0);
  g.add(pillar, ring, disc);
  return g;
}

export function rarityBeam(rarity: Rarity): THREE.Group {
  return makeBeam(RARITY_COLORS[rarity] ?? RARITY_COLORS[0], 3.2 + rarity * 0.7);
}

// ───────────── 拾取物 ─────────────

/** 铜钱：圆形方孔，面朝 ±Z */
function coinGeometry(): THREE.BufferGeometry {
  return geo('coin', () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.17, 0, Math.PI * 2, false);
    const h = 0.05;
    const hole = new THREE.Path();
    hole.moveTo(-h, -h);
    hole.lineTo(-h, h);
    hole.lineTo(h, h);
    hole.lineTo(h, -h);
    hole.lineTo(-h, -h);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false, curveSegments: 10 });
    g.center();
    return g;
  });
}

export function makeCoinModel(): THREE.Object3D {
  const m = mesh(coinGeometry(), std(PALETTE.coin, { metal: 0.75, rough: 0.32, emissive: 0x6a4300, emissiveIntensity: 0.9 }));
  m.castShadow = true;
  return m;
}

function shellGeo(): THREE.BufferGeometry {
  return geo('ammoShell', () => new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6));
}

function tipGeo(): THREE.BufferGeometry {
  return geo('ammoTip', () => new THREE.ConeGeometry(0.035, 0.07, 6));
}

export function makeAmmoModel(): THREE.Object3D {
  const g = new THREE.Group();
  const brass = std(PALETTE.gold, { metal: 0.7, rough: 0.35, emissive: 0x4a3000, emissiveIntensity: 0.6 });
  g.add(mesh(box(0.42, 0.22, 0.28), std(PALETTE.ammo, { rough: 0.8 }), 0, 0, 0, true));
  g.add(mesh(merged('ammoBrass', [
    [box(0.44, 0.05, 0.3), 0, 0.02, 0],
    [shellGeo(), -0.11, 0.17, 0],
    [shellGeo(), 0, 0.17, 0],
    [shellGeo(), 0.11, 0.17, 0],
  ]), brass));
  g.add(mesh(merged('ammoTips', [
    [tipGeo(), -0.11, 0.275, 0],
    [tipGeo(), 0, 0.275, 0],
    [tipGeo(), 0.11, 0.275, 0],
  ]), std(0xb87333, { metal: 0.8, rough: 0.3 })));
  return g;
}

export function makeHealthModel(): THREE.Object3D {
  const g = new THREE.Group();
  const red = std(PALETTE.health, { rough: 0.4, emissive: PALETTE.health, emissiveIntensity: 0.85 });
  const cross = mesh(merged('healthCross', [
    [box(0.38, 0.13, 0.13), 0, 0, 0],
    [box(0.13, 0.38, 0.13), 0, 0, 0],
  ]), red);
  cross.castShadow = true;
  g.add(cross);
  g.add(mesh(geo('healthRing', () => new THREE.TorusGeometry(0.27, 0.02, 5, 20)), glowMat(0xff8090, 0.6)));
  return g;
}

// ───────────── 宝箱 ─────────────

export interface ChestModel {
  root: THREE.Group;
  /** 盖子枢轴（位于后上沿，rotation.x 负值为开启） */
  lid: THREE.Group;
  /** 逐实例材质（宝石、内部光），由调用方 dispose */
  gemMat: THREE.MeshStandardMaterial;
  innerMat: THREE.MeshBasicMaterial;
}

/** 朱漆宝箱：包角 / 锁扣按奖励色着色。正面朝 +Z，y=0 为地面 */
export function makeChest(color: number): ChestModel {
  const root = new THREE.Group();
  const lacquer = std(PALETTE.lacquer, { rough: 0.55 });
  const trim = std(color, { metal: 0.7, rough: 0.35, emissive: color, emissiveIntensity: 0.18 });
  const gold = std(PALETTE.gold, { metal: 0.8, rough: 0.3 });

  root.add(mesh(box(1.1, 0.55, 0.7), lacquer, 0, 0.275, 0, true));
  root.add(mesh(merged('chestTrim', [
    [box(1.16, 0.08, 0.76), 0, 0.04, 0],
    [box(0.08, 0.56, 0.75), -0.5, 0.28, 0],
    [box(0.08, 0.56, 0.75), 0.5, 0.28, 0],
  ]), trim));
  root.add(mesh(merged('chestGold', [
    [box(1.14, 0.05, 0.74), 0, 0.53, 0],
    [box(0.34, 0.2, 0.02), 0, 0.3, 0.36],
  ]), gold));

  const innerMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  root.add(mesh(box(1.0, 0.02, 0.6), innerMat, 0, 0.56, 0));

  const lid = new THREE.Group();
  lid.position.set(0, 0.56, -0.35);
  lid.add(mesh(merged('chestLid', [
    [box(1.12, 0.22, 0.72), 0, 0.11, 0.36],
    [box(0.98, 0.1, 0.5), 0, 0.27, 0.36],
  ]), lacquer, 0, 0, 0, true));
  lid.add(mesh(merged('chestLidTrim', [
    [box(1.16, 0.05, 0.76), 0, 0.03, 0.36],
    [box(0.08, 0.3, 0.76), -0.5, 0.15, 0.36],
    [box(0.08, 0.3, 0.76), 0.5, 0.15, 0.36],
  ]), trim));
  lid.add(mesh(box(0.2, 0.16, 0.03), gold, 0, 0.06, 0.73));
  const gemMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.25, flatShading: true });
  const gem = mesh(geo('gem', () => new THREE.OctahedronGeometry(0.1, 0)), gemMat, 0, 0.06, 0.76);
  gem.scale.set(1, 1.3, 0.6);
  lid.add(gem);
  root.add(lid);

  return { root, lid, gemMat, innerMat };
}

// ───────────── 商店 ─────────────

/** 摊位：木台 + 朱红桌布 + 四角攒尖顶 + 灯笼。y=0 为地面，正面朝 +Z */
export function makeStall(accent: number): THREE.Group {
  const g = new THREE.Group();
  const roofGeo = geo('stallRoof', () => new THREE.ConeGeometry(1.3, 0.5, 4, 1).rotateY(Math.PI / 4));
  const post = box(0.08, 2.36, 0.08);

  g.add(mesh(merged('stallWood', [
    [box(1.5, 0.82, 0.85), 0, 0.41, 0],
    [post, -0.72, 1.18, -0.38],
    [post, 0.72, 1.18, -0.38],
  ]), std(PALETTE.wood, { rough: 0.85 }), 0, 0, 0, true));
  g.add(mesh(merged('stallRed', [
    [box(1.56, 0.06, 0.9), 0, 0.84, 0],
    [box(1.56, 0.34, 0.02), 0, 0.66, 0.455],
    [roofGeo, 0, 2.6, -0.1, [1, 1, 0.78]],
  ]), std(PALETTE.vermilion, { rough: 0.6 }), 0, 0, 0, true));
  g.add(mesh(merged('stallGold', [
    [box(1.58, 0.03, 0.025), 0, 0.5, 0.465],
    [box(1.86, 0.05, 1.44), 0, 2.36, -0.1],
  ]), std(PALETTE.gold, { metal: 0.8, rough: 0.3 })));

  const lantern = mesh(geo('lantern', () => new THREE.SphereGeometry(0.11, 8, 6)), std(0xffa040, { emissive: 0xff8a20, emissiveIntensity: 1.6 }), 0.72, 2.08, -0.3);
  lantern.scale.y = 1.3;
  g.add(lantern);
  g.add(mesh(geo('stallDisc', () => new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2)), glowMat(accent, 0.35), 0, 0.875, 0));
  return g;
}

/** 秘卷展示模型（卷轴），横向 */
export function makeScrollModel(rarity: Rarity): THREE.Object3D {
  const color = RARITY_COLORS[rarity] ?? RARITY_COLORS[0];
  const g = new THREE.Group();
  const knob = geo('scrollKnob', () => new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10).rotateZ(Math.PI / 2));
  const stripe = box(0.3, 0.035, 0.014);
  const paper = mesh(merged('scrollPaper', [
    [geo('scrollRoll', () => new THREE.CylinderGeometry(0.075, 0.075, 0.46, 10).rotateZ(Math.PI / 2)), 0, 0, 0],
    [box(0.4, 0.3, 0.012), 0, -0.16, 0.07],
  ]), std(PALETTE.paper, { rough: 0.9 }));
  paper.castShadow = true;
  g.add(paper);
  g.add(mesh(merged('scrollTrim', [
    [knob, -0.255, 0, 0],
    [knob, 0.255, 0, 0],
    [geo('scrollBand', () => new THREE.TorusGeometry(0.082, 0.016, 5, 14).rotateY(Math.PI / 2)), 0, 0, 0],
    [stripe, 0, -0.12, 0.078],
    [stripe, 0, -0.2, 0.078],
  ]), std(color, { metal: 0.5, rough: 0.35, emissive: color, emissiveIntensity: 0.55 })));
  return g;
}

export function makePotionModel(): THREE.Object3D {
  const g = new THREE.Group();
  const liquid = std(PALETTE.health, { rough: 0.2, emissive: 0xff2040, emissiveIntensity: 0.7 });
  const flask = mesh(geo('flask', () => new THREE.SphereGeometry(0.17, 10, 8)), liquid);
  flask.castShadow = true;
  g.add(flask);
  g.add(mesh(geo('flaskNeck', () => new THREE.CylinderGeometry(0.05, 0.065, 0.14, 8)), std(0xd6e8f0, { rough: 0.15, metal: 0.1 }), 0, 0.2, 0));
  g.add(mesh(geo('flaskCork', () => new THREE.CylinderGeometry(0.058, 0.05, 0.07, 8)), std(0x8a5a32), 0, 0.3, 0));
  g.add(mesh(geo('flaskTag', () => new THREE.TorusGeometry(0.06, 0.012, 4, 12).rotateX(Math.PI / 2)), std(PALETTE.gold, { metal: 0.8, rough: 0.3 }), 0, 0.15, 0));
  return g;
}

export function makeAmmoCrateModel(): THREE.Object3D {
  const g = makeAmmoModel();
  g.scale.setScalar(1.45);
  return g;
}

export interface AnvilModel {
  root: THREE.Group;
  /** 悬浮的符文环（逐帧旋转） */
  rune: THREE.Object3D;
}

/** 强化台：石座铁砧 + 悬浮符文环 */
export function makeAnvil(): AnvilModel {
  const root = new THREE.Group();
  const runeMat = std(PALETTE.rune, { emissive: PALETTE.rune, emissiveIntensity: 1.5, rough: 0.3 });

  root.add(mesh(merged('anvilStone', [
    [box(0.9, 0.3, 0.7), 0, 0.15, 0],
    [box(0.5, 0.32, 0.36), 0, 0.46, 0],
  ]), std(PALETTE.stone, { rough: 0.9 }), 0, 0, 0, true));
  root.add(mesh(merged('anvilIron', [
    [box(1.0, 0.24, 0.4), 0, 0.74, 0],
    [box(0.42, 0.12, 0.3), 0, 0.58, 0],
    [geo('anvilHorn', () => new THREE.ConeGeometry(0.14, 0.4, 6).rotateZ(-Math.PI / 2)), 0.69, 0.76, 0],
  ]), std(PALETTE.iron, { metal: 0.85, rough: 0.35 }), 0, 0, 0, true));
  // 符文刻痕
  root.add(mesh(box(0.52, 0.03, 0.02), runeMat, 0, 0.74, 0.205));

  const rune = mesh(geo('runeRing', () => new THREE.TorusGeometry(0.34, 0.025, 5, 32)), runeMat, 0, 1.45, 0);
  const inner = mesh(geo('runeRingInner', () => new THREE.TorusGeometry(0.22, 0.018, 4, 24)), glowMat(PALETTE.rune, 0.8));
  inner.rotation.y = Math.PI / 2;
  rune.add(inner);
  root.add(rune);
  return { root, rune };
}
