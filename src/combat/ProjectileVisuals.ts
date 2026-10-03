/**
 * 投射物的程序化外观：8 种造型（orb / bolt / rocket / arrow / grenade / shard / flame / blade）+ 带状拖尾。
 * 'blade' 为魔刀千刃的飞刃：压扁的暗钢刃片 + 元素色刃光层 + 白热血槽，绕刃面法线高速自旋。
 *
 * - 几何体、共享的受光材质、发光贴图全部模块级缓存，永不释放。
 * - 每个 ProjectileView 自带一套发光材质（换色 / 淡出不影响别人），由 ProjectileSystem 对象池复用。
 * - 发光部分用 MeshBasic + 加法混合 + 关闭色调映射与雾，保证在任何主题下都醒目；
 *   实心内核不透明，亮背景（荒漠天空）下也能看清。
 */
import * as THREE from 'three';
import type { ProjectileVisual } from '../core/types';
import { clamp, clamp01, TAU } from '../core/math';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const WHITE = new THREE.Color(0xffffff);
const WARM = new THREE.Color(0xffd9a0);
const _col = new THREE.Color();

// ───────────────────────────── 共享资源 ─────────────────────────────

function lazy<T>(make: () => T): () => T {
  let v: T | undefined;
  return () => {
    if (v === undefined) v = make();
    return v;
  };
}

/** 柔和的径向发光贴图（程序生成，白色 + alpha 衰减） */
const glowTexture = lazy(() => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const t = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const a = Math.min(1, t * t * 1.1 + Math.pow(t, 6) * 0.9);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
});

/** 两片正交的十字面片（YZ 与 XZ 平面，z ∈ [-0.5, 0.5]），用作箭羽 */
function crossQuads(): THREE.BufferGeometry {
  const p = [
    0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5,
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  return g;
}

const G = {
  sphere: lazy(() => new THREE.IcosahedronGeometry(1, 2)),
  sphereLow: lazy(() => new THREE.IcosahedronGeometry(1, 1)),
  octa: lazy(() => new THREE.OctahedronGeometry(1, 0)),
  /** 轴向为 Z、长度 1、居中 */
  cylZ: lazy(() => new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateX(Math.PI / 2)),
  cylZThin: lazy(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateX(Math.PI / 2)),
  /** 尖端朝 +Z、长度 1、居中 */
  coneZ: lazy(() => new THREE.ConeGeometry(1, 1, 10, 1).rotateX(Math.PI / 2)),
  box: lazy(() => new THREE.BoxGeometry(1, 1, 1)),
  torus: lazy(() => new THREE.TorusGeometry(1, 0.22, 6, 18)),
  cross: lazy(crossQuads),
};

const M = {
  metal: lazy(() => new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.55, roughness: 0.42 })),
  wood: lazy(() => new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.8 })),
  bone: lazy(() => new THREE.MeshStandardMaterial({ color: 0xd9cdb0, roughness: 0.7 })),
  /** 飞刃的暗钢（平直着色，刃面棱角分明） */
  steel: lazy(() => new THREE.MeshStandardMaterial({ color: 0x50525c, metalness: 0.45, roughness: 0.35, flatShading: true })),
};

/** 飞刃自旋（弧度 / 秒，绕刃面法线）与摆动 */
const BLADE_SPIN = 24;
const BLADE_WOBBLE = 0.2;

function additive(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

// ───────────────────────────── 尺寸约定 ─────────────────────────────

/**
 * 视觉整体缩放。orb / bolt / shard / flame 以「投射物半径」为单位建模；
 * arrow / rocket / grenade 以米为单位建模，再按半径适度缩放（避免碰撞半径大时模型夸张）。
 */
export function viewSize(kind: ProjectileVisual, radius: number, scale: number): number {
  switch (kind) {
    case 'arrow':
      return scale * clamp(radius / 0.1, 0.8, 1.6);
    case 'rocket':
      return scale * clamp(radius / 0.14, 0.6, 2);
    case 'grenade':
      return scale * clamp(radius / 0.12, 0.7, 2.2);
    default:
      return Math.max(0.04, radius) * scale;
  }
}

/** 拖尾挂点相对中心向后的距离（× size） */
export function tailOffset(kind: ProjectileVisual): number {
  return kind === 'rocket' ? 0.42 : kind === 'arrow' ? 0.45 : 0;
}

/** 全部造型（换关时逐一预热；新增造型记得加进来） */
export const PROJECTILE_VISUALS: readonly ProjectileVisual[] = ['orb', 'bolt', 'rocket', 'arrow', 'grenade', 'shard', 'flame', 'blade'];

// ───────────────────────────── 投射物外观 ─────────────────────────────

export class ProjectileView {
  readonly root = new THREE.Group();
  /** 自转 / 翻滚层 */
  private readonly spin = new THREE.Group();
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly accentMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly halo: THREE.Sprite;
  private glow: THREE.Mesh | null = null;
  private accent: THREE.Mesh | null = null;
  /** 箭杆（敌方骨白 / 玩家木色） */
  private shaft: THREE.Mesh | null = null;

  /** 内核向白色混合的比例 */
  private coreWhiten = 0.45;
  private glowOpacity = 0.5;
  private haloScale = 3;
  private accentLen = 1;
  private size = 1;
  private hostile = false;
  private phase = 0;

  constructor(readonly kind: ProjectileVisual) {
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    this.glowMat = additive(0.5);
    this.accentMat = additive(0.9);
    this.haloMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.root.add(this.spin);
    this.spin.add(this.halo);
    this.root.visible = false;
    this.build();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.spin): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  private build(): void {
    switch (this.kind) {
      case 'orb': {
        this.coreWhiten = 0.55;
        this.mesh(G.sphere(), this.coreMat).scale.setScalar(0.55);
        this.glow = this.mesh(G.sphereLow(), this.glowMat);
        this.glowOpacity = 0.5;
        this.haloScale = 4.2;
        break;
      }
      case 'bolt': {
        this.mesh(G.sphere(), this.coreMat).scale.set(0.5, 0.5, 1.9);
        this.glow = this.mesh(G.octa(), this.glowMat);
        this.glow.scale.set(0.95, 0.95, 4.2);
        this.glow.position.z = -1.1;
        this.glowOpacity = 0.55;
        this.haloScale = 3.4;
        break;
      }
      case 'blade': {
        // 魔刀飞刃：压扁八面体刃片（宽 0.95 × 厚 0.18 × 长 2.4 个半径），外裹略大的刃光层，中间一道白热血槽
        this.coreWhiten = 0.7;
        this.mesh(G.octa(), M.steel()).scale.set(0.95, 0.18, 2.4);
        this.glow = this.mesh(G.octa(), this.glowMat);
        this.glow.scale.set(1.3, 0.32, 2.9);
        this.glowOpacity = 0.6;
        this.mesh(G.octa(), this.coreMat).scale.set(0.32, 0.22, 1.9);
        this.haloScale = 2.0;
        break;
      }
      case 'shard': {
        this.coreWhiten = 0.5;
        // 弹幕类大量出现：只用内核 + 光晕两次绘制
        this.mesh(G.octa(), this.coreMat).scale.set(0.55, 0.55, 2.2);
        this.haloScale = 3.2;
        break;
      }
      case 'flame': {
        this.coreWhiten = 0.35;
        this.glow = this.mesh(G.sphereLow(), this.glowMat);
        this.glowOpacity = 0.6;
        this.mesh(G.sphereLow(), this.coreMat).scale.setScalar(0.5);
        this.accent = this.mesh(G.sphereLow(), this.accentMat);
        this.accent.scale.set(0.7, 0.7, 1.1);
        this.accent.position.z = -0.65;
        this.haloScale = 3.2;
        break;
      }
      case 'arrow': {
        this.coreWhiten = 0.35;
        const shaft = this.mesh(G.cylZThin(), M.wood());
        shaft.scale.set(0.022, 0.022, 0.72);
        shaft.position.z = -0.1;
        this.shaft = shaft;
        const head = this.mesh(G.coneZ(), this.coreMat);
        head.scale.set(0.05, 0.05, 0.16);
        head.position.z = 0.33;
        const fletch = this.mesh(G.cross(), this.glowMat);
        fletch.scale.set(0.12, 0.12, 0.16);
        fletch.position.z = -0.4;
        this.glowOpacity = 0.75;
        this.accent = this.mesh(G.octa(), this.accentMat);
        this.accent.scale.set(0.05, 0.05, 0.55);
        this.accent.position.z = -0.3;
        this.accentLen = 0.55;
        this.halo.position.z = 0.3;
        this.haloScale = 0.55;
        break;
      }
      case 'rocket': {
        this.coreWhiten = 0.3;
        this.mesh(G.cylZ(), M.metal()).scale.set(0.075, 0.075, 0.5);
        const nose = this.mesh(G.coneZ(), this.coreMat);
        nose.scale.set(0.075, 0.075, 0.16);
        nose.position.z = 0.33;
        const band = this.mesh(G.cylZ(), this.coreMat);
        band.scale.set(0.082, 0.082, 0.05);
        band.position.z = 0.12;
        for (let i = 0; i < 4; i++) {
          const fin = this.mesh(G.box(), M.metal());
          const a = (i / 4) * TAU;
          fin.scale.set(0.012, 0.085, 0.12);
          fin.rotation.z = a;
          fin.position.set(Math.sin(a) * -0.09, Math.cos(a) * 0.09, -0.19);
        }
        this.glow = this.mesh(G.sphereLow(), this.glowMat);
        this.glow.scale.setScalar(0.1);
        this.glow.position.z = -0.28;
        this.glowOpacity = 0.9;
        this.accent = this.mesh(G.coneZ(), this.accentMat);
        this.accent.rotation.y = Math.PI;
        this.accent.scale.set(0.065, 0.065, 0.32);
        this.accent.position.z = -0.42;
        this.accentLen = 0.32;
        this.halo.position.z = -0.3;
        this.haloScale = 0.8;
        break;
      }
      case 'grenade': {
        this.coreWhiten = 0.25;
        this.mesh(G.sphereLow(), M.metal()).scale.setScalar(0.11);
        this.mesh(G.torus(), this.coreMat).scale.setScalar(0.112);
        const cap = this.mesh(G.cylZ(), M.metal());
        cap.scale.set(0.03, 0.03, 0.06);
        cap.rotation.x = Math.PI / 2;
        cap.position.y = 0.115;
        this.accent = this.mesh(G.sphereLow(), this.accentMat);
        this.accent.scale.setScalar(0.035);
        this.accent.position.y = 0.155;
        this.haloScale = 0.55;
        break;
      }
    }
  }

  /** 激活时配置：颜色、是否敌方（敌方更亮更大）、整体缩放 */
  setup(color: number, hostile: boolean, size: number): void {
    this.hostile = hostile;
    this.size = size;
    this.phase = Math.random() * TAU;
    _col.setHex(color);
    this.coreMat.color.copy(_col).lerp(WHITE, this.coreWhiten);
    this.glowMat.color.copy(_col);
    this.glowMat.opacity = Math.min(1, this.glowOpacity * (hostile ? 1.25 : 1));
    this.haloMat.color.copy(_col);
    this.haloMat.opacity = hostile ? 1 : 0.85;
    if (this.kind === 'rocket' || this.kind === 'flame') this.accentMat.color.copy(_col).lerp(WARM, 0.55);
    else if (this.kind === 'grenade') this.accentMat.color.copy(_col).lerp(WHITE, 0.35);
    else this.accentMat.color.copy(_col);
    this.accentMat.opacity = 0.9;
    this.halo.scale.setScalar(this.haloScale * (hostile ? 1.35 : 1));
    // 敌方弩矢用骨白箭杆，更容易与玩家的区分
    if (this.shaft) this.shaft.material = hostile ? M.bone() : M.wood();
    this.spin.rotation.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.scale.setScalar(size);
    this.root.visible = true;
  }

  /**
   * 每帧动画。dir 为单位速度方向；fade ∈ [0,1] 为到期淡出（1 = 正常）。
   */
  animate(dir: THREE.Vector3, age: number, lifetime: number, dt: number, fade: number): void {
    const kind = this.kind;
    if (kind !== 'orb' && kind !== 'grenade') this.root.quaternion.setFromUnitVectors(Z_AXIS, dir);
    const hs = this.haloScale * (this.hostile ? 1.35 : 1);
    const pulseAmp = this.hostile ? 0.18 : 0.1;
    let grow = 1;

    switch (kind) {
      case 'orb': {
        const s = 1 + 0.12 * Math.sin(age * 18 + this.phase);
        this.glow!.scale.setScalar(s);
        this.halo.scale.setScalar(hs * (1 + pulseAmp * Math.sin(age * 11 + this.phase)));
        break;
      }
      case 'bolt':
      case 'arrow':
        this.halo.scale.setScalar(hs * (1 + pulseAmp * Math.sin(age * 14 + this.phase)));
        if (this.accent) this.accent.scale.z = this.accentLen * (0.85 + 0.3 * Math.random());
        break;
      case 'blade':
        // 刃片在自身平面内高速旋转（像掷出的飞刀），并绕长轴轻微摆动
        this.spin.rotation.y += dt * BLADE_SPIN;
        this.spin.rotation.z = BLADE_WOBBLE * Math.sin(age * 25 + this.phase);
        this.halo.scale.setScalar(hs * (1 + pulseAmp * Math.sin(age * 12 + this.phase)));
        break;
      case 'shard':
        this.spin.rotation.z += dt * 9;
        this.halo.scale.setScalar(hs * (1 + pulseAmp * Math.sin(age * 12 + this.phase)));
        break;
      case 'rocket': {
        const f = 0.8 + Math.random() * 0.5;
        this.accent!.scale.z = this.accentLen * f;
        this.halo.scale.setScalar(hs * (0.85 + 0.3 * Math.random()));
        break;
      }
      case 'grenade': {
        this.spin.rotation.x += dt * 13;
        this.spin.rotation.y += dt * 4;
        const left = lifetime - age;
        const rate = left < 1 ? 14 : 5;
        const on = Math.sin(age * rate * TAU + this.phase) > 0;
        this.accentMat.opacity = on ? 1 : 0.12;
        this.halo.scale.setScalar(hs * (on ? 1.15 : 0.7));
        break;
      }
      case 'flame': {
        const t = clamp01(age / Math.max(0.05, lifetime));
        grow = 0.7 + 1.1 * t;
        const flick = 0.9 + Math.random() * 0.2;
        this.glow!.scale.setScalar(flick);
        this.accent!.scale.set(0.7 * flick, 0.7 * flick, 1.1 * (0.8 + Math.random() * 0.5));
        const out = 1 - clamp01((t - 0.6) / 0.4);
        this.glowMat.opacity = this.glowOpacity * (this.hostile ? 1.25 : 1) * out;
        this.accentMat.opacity = 0.9 * out;
        this.haloMat.opacity = (this.hostile ? 1 : 0.85) * out;
        this.halo.scale.setScalar(hs * flick);
        break;
      }
    }
    this.root.scale.setScalar(this.size * grow * fade);
  }

  hide(): void {
    this.root.visible = false;
  }
}

// ───────────────────────────── 拖尾 ─────────────────────────────

/** 拖尾最多保留的点数 */
const TRAIL_POINTS = 20;
/** 投射物消失后拖尾淡出的时长 */
const TRAIL_FADE = 0.35;

const trailIndex = lazy(() => {
  const idx: number[] = [];
  for (let k = 0; k < TRAIL_POINTS - 1; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  return new THREE.Uint16BufferAttribute(idx, 1);
});

const trailMaterial = lazy(() => new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
  fog: false,
}));

/**
 * 面向相机的带状拖尾（加法混合，尾部渐细渐暗）。点列按「最旧 → 最新」存放，
 * 最后一个点是跟随投射物的活动头部，距离上一个固定点超过 spacing 时固定下来。
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly pts = new Float32Array(TRAIL_POINTS * 3);
  private count = 0;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly geo: THREE.BufferGeometry;
  private width = 0.1;
  private spacing = 0.25;
  private r = 1;
  private g = 1;
  private b = 1;
  private intensity = 1;
  private dyingTime = -1;
  private shrinkAcc = 0;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setIndex(trailIndex());
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, trailMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get dying(): boolean {
    return this.dyingTime >= 0;
  }

  reset(p: THREE.Vector3, color: number, width: number, spacing: number): void {
    const pts = this.pts;
    pts[0] = pts[3] = p.x;
    pts[1] = pts[4] = p.y;
    pts[2] = pts[5] = p.z;
    this.count = 2;
    _col.setHex(color);
    this.r = _col.r;
    this.g = _col.g;
    this.b = _col.b;
    this.width = width;
    this.spacing = Math.max(0.05, spacing);
    this.intensity = 1;
    this.dyingTime = -1;
    this.shrinkAcc = 0;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = true;
  }

  push(p: THREE.Vector3): void {
    const pts = this.pts;
    let i = (this.count - 1) * 3;
    pts[i] = p.x;
    pts[i + 1] = p.y;
    pts[i + 2] = p.z;
    const j = i - 3;
    const dx = pts[i] - pts[j], dy = pts[i + 1] - pts[j + 1], dz = pts[i + 2] - pts[j + 2];
    if (dx * dx + dy * dy + dz * dz < this.spacing * this.spacing) return;
    if (this.count >= TRAIL_POINTS) {
      pts.copyWithin(0, 3, this.count * 3);
      this.count--;
    }
    i = this.count * 3;
    pts[i] = p.x;
    pts[i + 1] = p.y;
    pts[i + 2] = p.z;
    this.count++;
  }

  startDying(): void {
    if (this.dyingTime < 0) this.dyingTime = 0;
  }

  /** 推进淡出；返回 false 表示已完全消失、可以回收 */
  tick(dt: number): boolean {
    if (this.dyingTime < 0) return true;
    this.dyingTime += dt;
    this.intensity = 1 - this.dyingTime / TRAIL_FADE;
    if (this.intensity <= 0) return false;
    // 尾部收缩
    this.shrinkAcc += dt;
    while (this.shrinkAcc > 0.02 && this.count > 2) {
      this.shrinkAcc -= 0.02;
      this.pts.copyWithin(0, 3, this.count * 3);
      this.count--;
    }
    return true;
  }

  /** 按相机位置重建带状顶点 */
  update(cam: THREE.Vector3): void {
    const n = this.count;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const pts = this.pts;
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const inv = 1 / (n - 1);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(n - 1, i + 1) * 3;
      const tx = pts[i1] - pts[i0], ty = pts[i1 + 1] - pts[i0 + 1], tz = pts[i1 + 2] - pts[i0 + 2];
      const k = i * 3;
      const px = pts[k], py = pts[k + 1], pz = pts[k + 2];
      const vx = cam.x - px, vy = cam.y - py, vz = cam.z - pz;
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const u = i * inv;
      const w = this.width * (0.2 + 0.8 * u);
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (len < 1e-6) {
        sx = 0;
        sy = w;
        sz = 0;
      } else {
        const s = w / len;
        sx *= s;
        sy *= s;
        sz *= s;
      }
      const o = i * 6;
      pos[o] = px + sx;
      pos[o + 1] = py + sy;
      pos[o + 2] = pz + sz;
      pos[o + 3] = px - sx;
      pos[o + 4] = py - sy;
      pos[o + 5] = pz - sz;
      const a = u * u * this.intensity;
      col[o] = col[o + 3] = this.r * a;
      col[o + 1] = col[o + 4] = this.g * a;
      col[o + 2] = col[o + 5] = this.b * a;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  hide(): void {
    this.mesh.visible = false;
    this.geo.setDrawRange(0, 0);
    this.dyingTime = -1;
  }
}
