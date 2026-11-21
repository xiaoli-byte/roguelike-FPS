import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { AssetLibrary, type LoadedAsset } from '../assets/AssetLibrary';
import { attachNativeBody, type NativeBody } from '../assets/NativeRig';
import { ClipPlayer } from '../anim/ClipPlayer';
import { qualityProfile } from '../core/QualityTiers';
import { type PetDef, type RGB, rgbHex, lerpRgb } from './PetDefs';
import { PET_FUR_DATA } from './PetDefsData';
import { FUR_MEDIUM_SHELLS, attachFurShells, type PetFurShells } from './PetFur';
import { glowSprite } from './PetFx';

/**
 * 一只灵宠的外观（照译 Unity G/Pets/PetVisuals.cs：PetModel、PetVisuals、PetPartGlow）：
 *   · 美术模型：public/assets/characters/SK_Pet_<名>.glb（原生骨架）+ M12 导出的动画片段（ClipPlayer：Animator + CreatureLocomotion + CreatureRig）；
 *     灵体：模型上不建任何碰撞；
 *   · 特效挂点（mouth、coin、pebble、eyefx、ember、horntip、pearl、head）：按名字找骨骼（容忍 socket_ 前缀与「命名空间:」前缀）；
 *   · 单独建模的发光件（精卫的火石、应龙的宝珠，SM_PetPart_*）挂在挂点上，网格往辉光色提亮一点、外面一圈呼吸的光晕；
 *   · 壳层毛发（有 fur 配置的五只，PetFur.ts，画质档决定层数）；
 *   · 白泽脚下的云；
 *   · 模型没加载到（?classic、资源缺失）时用同色系的简单几何拼一个认得出的占位体（猪 = 圆身 + 獠牙、鸟 = 身子 + 平展的翅膀、龙 = 一串球 + 翅膀…），
 *     坐标照 Unity 占位体（Unity → 网页 x 取反，绕 Y / Z 的角度取反）。
 */

/** docs/pet-system.md 7.3 的特效挂点（不变形骨骼）+ head */
export const SOCKET_NAMES = ['mouth', 'coin', 'pebble', 'eyefx', 'ember', 'horntip', 'pearl', 'head'] as const;

/** 发光件的脉动（Unity PetPartGlow）：网格往辉光色提亮（受击闪白的办法），外面一圈光晕跟着呼吸；boost 0–1 额外加亮 */
export class PartGlow {
  boost = 0;
  private readonly phase = Math.random() * 6;
  private readonly bright = new THREE.Color();
  private readonly base: { m: THREE.MeshStandardMaterial; e: THREE.Color }[] = [];
  readonly halo: THREE.Sprite;
  private readonly haloSize: number;

  constructor(readonly obj: THREE.Object3D, private readonly color: RGB) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const diameter = box.isEmpty() ? 0.05 : Math.max(size.x, size.y, size.z);
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.base.push({ m, e: m.emissive.clone() });
    });
    // 光晕：约为发光件直径的 4 倍（父级缩放已含在世界尺寸里，这里换回本地单位）
    const s = obj.getWorldScale(new THREE.Vector3()).x || 1;
    this.haloSize = diameter * 4 / s;
    this.halo = glowSprite(color, 0.5, this.haloSize);
    obj.add(this.halo);
  }

  update(now: number): void {
    const t = now * 3.2 + this.phase;
    const pulse = 0.5 + 0.5 * Math.sin(t);
    const flash = 0.08 + (0.22 - 0.08) * pulse + this.boost * 0.3;
    const c = lerpRgb(this.color, [1, 1, 1], 0.35);
    this.bright.setRGB(c[0], c[1], c[2]).multiplyScalar((1.3 + this.boost) * flash);
    for (const b of this.base) b.m.emissive.copy(b.e).add(this.bright);
    this.halo.scale.setScalar(this.haloSize * (1 + 0.15 * pulse + this.boost * 0.8));
    (this.halo.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, 0.35 + 0.25 * pulse + this.boost * 0.35));
  }
}

export interface PetModel {
  /** 模型根（Visual 下） */
  root: THREE.Object3D;
  /** 真实高度（脚底到头顶）、最大尺寸（米） */
  height: number;
  size: number;
  placeholder: boolean;
  body: NativeBody | null;
  /** 动画（片段读好之前 ready = false） */
  clips: ClipPlayer | null;
  sockets: Map<string, THREE.Object3D>;
  /** 发光件（没有为 null）与它平时挂在哪、挂上时的本地姿势 */
  part: THREE.Object3D | null;
  partHome: THREE.Object3D | null;
  partLocal: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 };
  partGlow: PartGlow | null;
  /** 占位体能单独动的部件：翅膀（符号）、尾巴（初始朝向）、龙身各节（初始位置） */
  wings: { t: THREE.Object3D; sign: number }[];
  tails: { t: THREE.Object3D; rest: THREE.Quaternion }[];
  spine: { t: THREE.Object3D; rest: THREE.Vector3 }[];
  fur: PetFurShells | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

/** 骨骼动画（片段已接上） */
export function modelRigged(m: PetModel): boolean {
  return !!m.clips?.ready;
}

export function socketOf(m: PetModel, name: string): THREE.Object3D | null {
  return m.sockets.get(name) ?? null;
}

export interface BuildOptions {
  /** 动画根（玩法移动的物体：步态从它的运动推导）；缺省 = parent */
  root?: THREE.Object3D;
  /** 展示用（封印里转圈的身影）：不按根节点运动推步态、不做脚步 IK / 看向，原地播待机 */
  display?: boolean;
}

/** 美术资产：按资产 id，退回按绑定（pet / id）找 */
function petAsset(def: PetDef): LoadedAsset | null {
  return AssetLibrary.get(def.assetId) ?? AssetLibrary.findBound('pet', def.id);
}

export function buildPetModel(ctx: GameContext, def: PetDef, parent: THREE.Object3D, opts: BuildOptions = {}): PetModel {
  const m: PetModel = {
    root: parent, height: def.height, size: def.height, placeholder: false, body: null, clips: null, sockets: new Map(),
    part: null, partHome: null, partLocal: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) },
    partGlow: null, wings: [], tails: [], spine: [], fur: null, materials: [], geometries: [],
  };
  const asset = petAsset(def);
  let body: NativeBody | null = null;
  if (asset) {
    try {
      body = attachNativeBody(parent, asset);
    } catch (err) {
      console.warn(`[pets] ${def.assetId} 的模型挂不上，用占位体`, err);
    }
  }
  if (body && asset) {
    m.body = body;
    m.root = body.model;
    m.materials.push(...body.materials);
    const b = asset.entry.bounds;
    m.height = b.max[1] - b.min[1] > 0.05 ? b.max[1] : def.height;
    m.size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    findSockets(m);
    const root = opts.root ?? parent;
    m.clips = new ClipPlayer(asset.id, body.model, {
      root: opts.display ? parent : root, rig: !opts.display, inPlace: true,
      ground: opts.display ? null : (x, y, z, max) => {
        const h = ctx.world.groundHeight(x, z, y);
        return h > y - max ? h : null;
      },
    });
    if (opts.display) {
      m.clips.onReady = (p) => {
        const loco = p.anim?.locomotion;
        if (loco) {
          loco.speedOverride = 0;
          loco.turnRadius = 0;
        }
        p.playLocomotion();
      };
    }
    attachPart(def, m, parent);
    const fur = PET_FUR_DATA[def.id];
    const tier = qualityProfile(ctx.settings.quality).fur;
    const lod0 = body.lod.levels[0]?.object as THREE.SkinnedMesh | undefined;
    if (fur && lod0 && tier !== 'none') m.fur = attachFurShells(lod0, fur, tier === 'shells' ? fur.shells : FUR_MEDIUM_SHELLS);
  } else {
    m.root = placeholder(def, parent, m);
    m.placeholder = true;
    m.height = def.height;
    const box = new THREE.Box3().setFromObject(m.root);
    const s = box.getSize(new THREE.Vector3());
    m.size = Math.max(def.height, s.x, s.z);
  }
  if (def.shape === 'sage') cloud(parent, m.size, m);
  return m;
}

/** 挂点：按名字找骨骼（大小写不敏感；容忍 socket_ 前缀与「命名空间:」前缀），第一个命中的为准 */
function findSockets(m: PetModel): void {
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) return;
    let n = o.name;
    const colon = n.lastIndexOf(':');
    if (colon >= 0) n = n.slice(colon + 1);
    if (/^socket_/i.test(n)) n = n.slice(7);
    n = n.toLowerCase();
    if ((SOCKET_NAMES as readonly string[]).includes(n) && !m.sockets.has(n)) m.sockets.set(n, o);
  });
}

/**
 * 发光件（Unity PetVisuals.AttachPart）：挂到挂点上（世界尺寸跟模型一致、朝向跟模型根一致）并让它微微脉动发亮。
 * 找不到挂点：火石挂嘴 / 头前方，宝珠挂前爪（claw_R / claw_L / forearm_*），都没有就按体型估一个位置挂在模型根下
 */
function attachPart(def: PetDef, m: PetModel, parent: THREE.Object3D): void {
  if (!def.partId) return;
  const go = instantiatePart(def.partId, m);
  if (!go) return;
  const home = socketOf(m, def.partSocket) ?? fallbackAnchor(def, m, parent);
  home.add(go);
  go.position.set(0, 0, 0);
  parent.updateMatrixWorld(true);
  // 朝向跟模型根一致；挂点骨骼可能带缩放：按模型根的世界尺寸校正
  const rootQ = m.root.getWorldQuaternion(new THREE.Quaternion());
  const homeQ = home.getWorldQuaternion(new THREE.Quaternion());
  go.quaternion.copy(homeQ.invert().multiply(rootQ));
  const rootS = m.root.getWorldScale(new THREE.Vector3()).x || 1;
  const homeS = home.getWorldScale(new THREE.Vector3()).x || 1;
  go.scale.setScalar(rootS / homeS);
  m.part = go;
  m.partHome = home;
  m.partLocal = { pos: go.position.clone(), quat: go.quaternion.clone(), scale: go.scale.clone() };
  m.partGlow = new PartGlow(go, def.partGlow);
}

/** 发光件的一个实例（SM_PetPart_*：原点 = 包围盒中心）；没加载到返回 null */
export function instantiatePart(partId: string, m?: PetModel): THREE.Object3D | null {
  const asset = AssetLibrary.get(partId);
  if (!asset) return null;
  const src = asset.lods[0];
  const mat = (src.material as THREE.MeshStandardMaterial).clone();
  const mesh = new THREE.Mesh(src.geometry, mat);
  mesh.name = partId;
  mesh.castShadow = false;
  const g = new THREE.Group();
  g.name = partId;
  g.add(mesh);
  m?.materials.push(mat);
  return g;
}

function fallbackAnchor(def: PetDef, m: PetModel, parent: THREE.Object3D): THREE.Object3D {
  const anchor = new THREE.Object3D();
  anchor.name = `${def.partSocket} (estimated)`;
  let bone: THREE.Object3D | null = null;
  let front = false;
  if (def.partSocket === 'pebble') {
    bone = socketOf(m, 'mouth');
    if (!bone) {
      bone = socketOf(m, 'head');
      front = !!bone;
    }
  } else {
    m.root.traverse((t) => {
      const n = t.name.replace(/^.*:/, '');
      if (/^claw_R$/i.test(n)) bone = t;
      else if (!bone && (/^claw_L$/i.test(n) || /^forearm_/i.test(n))) bone = t;
    });
  }
  if (bone) {
    (bone as THREE.Object3D).add(anchor);
    if (front) {
      parent.updateMatrixWorld(true);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(m.root.getWorldQuaternion(new THREE.Quaternion()));
      const wp = (bone as THREE.Object3D).getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, m.size * 0.12);
      anchor.position.copy((bone as THREE.Object3D).worldToLocal(wp));
    }
    return anchor;
  }
  m.root.add(anchor);
  // 火石：喙尖（前上）；宝珠：右前爪（前下、偏右——网页的右 = −X）
  if (def.partSocket === 'pebble') anchor.position.set(0, m.height * 0.75, m.size * 0.5);
  else anchor.position.set(-m.size * 0.12, m.height * 0.3, m.size * 0.35);
  return anchor;
}

/** 释放模型自己建的东西（共享几何体 / 贴图不动） */
export function disposePetModel(m: PetModel): void {
  try {
    m.clips?.dispose();
  } catch { /* 已释放 */ }
  m.fur?.dispose();
  m.body?.dispose();
  for (const mat of m.materials) mat.dispose();
  for (const g of m.geometries) g.dispose();
  m.partGlow?.halo.material.dispose();
}

// ───────────── 占位体 ─────────────

type Prim = 'sphere' | 'cube' | 'cylinder' | 'capsule';
const primGeo: Partial<Record<Prim, THREE.BufferGeometry>> = {};
function geo(p: Prim): THREE.BufferGeometry {
  return primGeo[p] ??= p === 'sphere' ? new THREE.SphereGeometry(0.5, 14, 10)
    : p === 'cube' ? new THREE.BoxGeometry(1, 1, 1)
      : p === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 2, 14)
        : new THREE.CapsuleGeometry(0.5, 1, 6, 12);
}

const DEG = Math.PI / 180;
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [1, 1, 1];
const mul = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

/** 一个部件：Unity 坐标 / 欧拉角（度）换到网页（x 取反、绕 Y / Z 取反） */
function part(m: PetModel, parent: THREE.Object3D, type: Prim, pos: [number, number, number], scale: [number, number, number] | number, c: RGB,
  euler: [number, number, number] = [0, 0, 0], glow = false): THREE.Mesh {
  const mat = glow
    ? new THREE.MeshBasicMaterial({ color: rgbHex(c), toneMapped: false })
    : new THREE.MeshStandardMaterial({ color: rgbHex(c), roughness: 0.75 });
  m.materials.push(mat);
  const mesh = new THREE.Mesh(geo(type), mat);
  mesh.position.set(-pos[0], pos[1], pos[2]);
  mesh.rotation.set(euler[0] * DEG, -euler[1] * DEG, -euler[2] * DEG, 'YXZ');
  if (typeof scale === 'number') mesh.scale.setScalar(scale);
  else mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = !glow;
  parent.add(mesh);
  return mesh;
}

function pivot(parent: THREE.Object3D, name: string, pos: [number, number, number], euler: [number, number, number] = [0, 0, 0]): THREE.Object3D {
  const t = new THREE.Object3D();
  t.name = name;
  t.position.set(-pos[0], pos[1], pos[2]);
  t.rotation.set(euler[0] * DEG, -euler[1] * DEG, -euler[2] * DEG, 'YXZ');
  parent.add(t);
  return t;
}

/** Unity PetVisuals.Placeholder：按身高 1 搭，整体缩放到真实身高 */
function placeholder(def: PetDef, parent: THREE.Object3D, m: PetModel): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'Placeholder · ' + def.name;
  parent.add(root);
  root.scale.setScalar(def.height);
  const b = def.body, a = def.accent;
  const dark = lerpRgb(b, BLACK, 0.55);
  const P = (t: Prim, p: [number, number, number], s: [number, number, number] | number, c: RGB, e?: [number, number, number], g = false, at: THREE.Object3D = root) =>
    part(m, at, t, p, s, c, e, g);
  const sides = [-1, 1];
  switch (def.shape) {
    case 'boar':
      P('sphere', [0, 0.5, 0], [0.78, 0.64, 1.02], b);
      P('sphere', [0, 0.6, 0.5], [0.52, 0.5, 0.46], b);
      P('cylinder', [0, 0.53, 0.76], [0.24, 0.06, 0.2], [0.92, 0.62, 0.55], [90, 0, 0]);
      for (const s of sides) {
        P('capsule', [0.11 * s, 0.46, 0.74], [0.05, 0.09, 0.05], [0.98, 0.95, 0.85], [-35, 0, -20 * s]);
        P('cube', [0.2 * s, 0.84, 0.44], [0.15, 0.04, 0.13], a, [0, 0, 35 * s]);
        P('sphere', [0.12 * s, 0.68, 0.7], 0.07, BLACK);
        for (const z of [-0.28, 0.26]) P('cylinder', [0.22 * s, 0.14, z], [0.15, 0.14, 0.15], dark);
      }
      P('cube', [0, 0.83, -0.05], [0.12, 0.04, 0.8], a);
      for (let i = 0; i < 3; i++) P('capsule', [(i - 1) * 0.07, 0.92, 0.5], [0.04, 0.1, 0.04], [1, 0.85, 0.35], [-20, 0, (i - 1) * 20], true);
      P('cylinder', [0, 0.38, 0.66], [0.16, 0.015, 0.16], [1, 0.78, 0.3], [70, 0, 0], true);
      break;
    case 'cat':
      P('capsule', [0, 0.5, 0], [0.36, 0.48, 0.36], b, [90, 0, 0]);
      P('sphere', [0, 0.8, 0.48], 0.42, b);
      P('sphere', [0, 0.84, 0.67], 0.17, mul(a, 1.3), undefined, true);
      P('sphere', [0, 0.84, 0.75], 0.06, BLACK);
      P('sphere', [0, 0.62, 0.42], [0.36, 0.26, 0.2], [0.92, 0.88, 0.8]);
      for (const s of sides) {
        P('cube', [0.13 * s, 1.04, 0.46], [0.08, 0.24, 0.04], b, [0, 0, -12 * s]);
        for (const z of [-0.3, 0.3]) P('cylinder', [0.14 * s, 0.18, z], [0.1, 0.18, 0.1], dark);
      }
      for (let i = 0; i < 3; i++) P('sphere', [(i - 1) * 0.1, 0.55, 0.6], 0.06, [0.85, 0.65, 0.3], undefined, true);
      for (let i = 0; i < 3; i++) {
        const pv = pivot(root, 'Tail' + i, [0, 0.62, -0.45], [-50, (i - 1) * 28, 0]);
        P('capsule', [0, 0.3, 0], [0.1, 0.3, 0.1], i === 1 ? a : b, undefined, false, pv);
        m.tails.push({ t: pv, rest: pv.quaternion.clone() });
      }
      break;
    case 'smallBird':
      P('sphere', [0, 0.5, 0], [0.7, 0.6, 1.3], b);
      P('sphere', [0, 0.74, 0.62], 0.5, [0.9, 0.9, 0.88]);
      P('sphere', [0, 0.84, 0.6], [0.42, 0.25, 0.4], BLACK);
      P('capsule', [0, 0.7, 0.95], [0.1, 0.14, 0.1], WHITE, [90, 0, 0]);
      P('sphere', [0, 0.68, 1.1], 0.16, [0.55, 0.53, 0.5]);
      P('cube', [0, 0.48, -0.78], [0.5, 0.04, 0.55], a);
      for (const s of sides) {
        P('sphere', [0.14 * s, 0.8, 0.82], 0.08, BLACK);
        P('capsule', [0.12 * s, 0.18, 0], [0.06, 0.1, 0.06], [0.9, 0.15, 0.1]);
        const pv = pivot(root, s < 0 ? 'WingL' : 'WingR', [0.28 * s, 0.6, 0.05]);
        P('cube', [0.62 * s, 0, 0], [1.25, 0.05, 0.6], b, undefined, false, pv);
        P('cube', [1.1 * s, 0, -0.12], [0.35, 0.055, 0.4], [1, 0.45, 0.15], undefined, true, pv);
        m.wings.push({ t: pv, sign: s });
      }
      break;
    case 'pheasant':
      P('sphere', [0, 0.5, 0], [0.55, 0.55, 0.95], b);
      P('sphere', [0, 0.86, 0.4], 0.38, b);
      P('capsule', [0, 0.84, 0.62], [0.08, 0.1, 0.08], [1, 0.75, 0.3], [90, 0, 0]);
      P('cube', [0, 1.1, 0.3], [0.04, 0.3, 0.2], a, [-35, 0, 0]);
      for (const s of sides) {
        // 双瞳：每只眼两颗青色瞳仁
        P('sphere', [0.15 * s, 0.9, 0.5], 0.12, WHITE);
        P('sphere', [0.2 * s, 0.92, 0.52], 0.05, mul(a, 1.4), undefined, true);
        P('sphere', [0.2 * s, 0.88, 0.47], 0.05, mul(a, 1.4), undefined, true);
        const pv = pivot(root, s < 0 ? 'WingL' : 'WingR', [0.24 * s, 0.62, 0]);
        P('cube', [0.52 * s, 0, 0], [1.05, 0.05, 0.5], b, undefined, false, pv);
        P('cube', [0.6 * s, 0.01, 0], [0.7, 0.055, 0.1], a, [0, 20 * s, 0], true, pv);
        m.wings.push({ t: pv, sign: s });
      }
      for (let i = 0; i < 3; i++) {
        const pv = pivot(root, 'Tail' + i, [0, 0.45, -0.42], [-130 + i * 8, (i - 1) * 14, 0]);
        P('capsule', [0, 0.45, 0], [0.07, 0.45, 0.07], i === 1 ? a : [1, 0.82, 0.4], undefined, false, pv);
        m.tails.push({ t: pv, rest: pv.quaternion.clone() });
      }
      break;
    case 'lion': {
      P('sphere', [0, 0.45, -0.08], [0.7, 0.58, 0.95], b);
      P('sphere', [0, 0.74, 0.34], 0.78, a);
      P('sphere', [0, 0.72, 0.48], 0.56, b);
      P('cube', [0, 0.6, 0.72], [0.34, 0.06, 0.1], [0.75, 0.15, 0.12]);
      for (const s of sides) {
        P('sphere', [0.14 * s, 0.8, 0.7], 0.14, WHITE);
        P('sphere', [0.15 * s, 0.8, 0.77], 0.06, BLACK);
        for (const z of [-0.36, 0.24]) P('cylinder', [0.22 * s, 0.15, z], [0.19, 0.15, 0.19], b);
      }
      // 背上的小香炉
      P('cylinder', [0, 0.86, -0.18], [0.32, 0.1, 0.32], [0.55, 0.42, 0.2]);
      P('sphere', [0, 0.98, -0.18], 0.12, [0.6, 0.9, 0.3], undefined, true);
      P('sphere', [0, 0.62, -0.6], 0.26, a);
      P('sphere', [0, 0.5, 0.66], 0.08, [1, 0.8, 0.3], undefined, true);
      break;
    }
    case 'leopard':
      P('capsule', [0, 0.56, 0], [0.38, 0.52, 0.4], b, [90, 0, 0]);
      P('sphere', [0, 0.7, 0.6], 0.36, b);
      P('sphere', [0, 0.6, 0.72], [0.2, 0.14, 0.18], [0.95, 0.88, 0.75]);
      P('capsule', [0, 0.92, 0.66], [0.06, 0.14, 0.06], a, [-30, 0, 0]);
      for (let i = 0; i < 6; i++) P('sphere', [i % 2 === 0 ? 0.12 : -0.12, 0.72, -0.35 + i * 0.13], 0.08, BLACK);
      for (const s of sides) {
        P('sphere', [0.1 * s, 0.76, 0.76], 0.06, [1, 0.85, 0.3], undefined, true);
        for (const z of [-0.32, 0.3]) P('cylinder', [0.15 * s, 0.2, z], [0.1, 0.2, 0.1], b);
      }
      for (let i = 0; i < 5; i++) {
        const pv = pivot(root, 'Tail' + i, [0, 0.62, -0.48], [-60, (i - 2) * 22, 0]);
        P('capsule', [0, 0.36, 0], [0.06, 0.36, 0.06], i % 2 === 0 ? b : lerpRgb(b, BLACK, 0.3), undefined, false, pv);
        m.tails.push({ t: pv, rest: pv.quaternion.clone() });
      }
      break;
    case 'sage': {
      P('sphere', [0, 0.55, 0], [0.68, 0.55, 1.08], b);
      P('sphere', [0, 0.62, 0.38], [0.6, 0.52, 0.4], b);
      P('sphere', [0, 0.88, 0.5], 0.4, b);
      P('capsule', [0, 0.68, 0.62], [0.1, 0.12, 0.1], b);
      P('sphere', [0, 0.97, 0.69], 0.07, mul(a, 1.3), undefined, true);
      P('cube', [0, 0.56, 0.6], [0.07, 0.1, 0.03], [0.45, 0.9, 0.65], undefined, true);
      for (const s of sides) {
        P('capsule', [0.12 * s, 1.12, 0.44], [0.05, 0.18, 0.05], a, [-25, 0, -25 * s], true);
        P('sphere', [0.1 * s, 0.92, 0.67], 0.05, BLACK);
        for (let i = 0; i < 4; i++) P('sphere', [0.33 * s, 0.6, -0.3 + i * 0.18], 0.05, mul(a, 1.3), undefined, true);
        for (const z of [-0.32, 0.3]) P('cylinder', [0.22 * s, 0.18, z], [0.14, 0.18, 0.14], b);
      }
      const tp = pivot(root, 'Tail0', [0, 0.62, -0.5], [-120, 0, 0]);
      P('capsule', [0, 0.25, 0], [0.14, 0.25, 0.14], b, undefined, false, tp);
      m.tails.push({ t: tp, rest: tp.quaternion.clone() });
      break;
    }
    case 'dragon': {
      // 龙身：一串由粗到细的球，S 形；龙头在最前
      const n = 10;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const p: [number, number, number] = [Math.sin(k * 5.5) * 0.22, 0.55 + Math.sin(k * 3.2 + 1) * 0.1, 0.95 - k * 2.3];
        const seg = P('sphere', p, 0.36 + (0.09 - 0.36) * k, i % 3 === 1 ? a : b);
        m.spine.push({ t: seg, rest: seg.position.clone() });
      }
      const head = pivot(root, 'Head', [0, 0.66, 1.1]);
      P('sphere', [0, 0, 0], [0.36, 0.3, 0.44], b, undefined, false, head);
      P('cylinder', [0, -0.04, 0.24], [0.2, 0.1, 0.2], b, [90, 0, 0], false, head);
      P('sphere', [0, 0.02, -0.18], [0.42, 0.36, 0.3], WHITE, undefined, false, head);
      for (const s of sides) {
        P('capsule', [0.1 * s, 0.24, -0.06], [0.04, 0.18, 0.04], a, [-35, 0, -20 * s], false, head);
        P('capsule', [0.16 * s, 0.32, -0.12], [0.03, 0.08, 0.03], a, [-60, 0, -50 * s], false, head);
        P('sphere', [0.12 * s, 0.07, 0.12], 0.06, [1, 0.85, 0.3], undefined, true, head);
        P('capsule', [0.1 * s, -0.08, 0.32], [0.02, 0.16, 0.02], WHITE, [70, 0, 30 * s], false, head);
        const pv = pivot(root, s < 0 ? 'WingL' : 'WingR', [0.2 * s, 0.72, 0.55]);
        P('cube', [0.55 * s, 0, 0], [1.1, 0.04, 0.55], b, undefined, false, pv);
        P('cube', [0.95 * s, 0.005, -0.1], [0.35, 0.045, 0.45], [0.45, 0.65, 1], undefined, true, pv);
        m.wings.push({ t: pv, sign: s });
      }
      P('sphere', [0.18, 0.4, 0.9], 0.1, [0.75, 0.9, 1], undefined, true);
      break;
    }
  }
  return root;
}

/** 白泽脚下踏的云：几团扁平的白球 + 金色光晕 */
function cloud(parent: THREE.Object3D, size: number, m: PetModel): void {
  const c = new THREE.Group();
  c.name = 'Cloud';
  parent.add(c);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const mesh = part(m, c, 'sphere', [Math.cos(a) * 0.32 * size, 0.02, Math.sin(a) * 0.42 * size], [0.36 * size, 0.12 * size, 0.36 * size], [0.98, 0.97, 0.92], undefined, true);
    mesh.castShadow = false;
  }
  const g = glowSprite([1, 0.85, 0.5], 0.35, size * 1.6);
  m.materials.push(g.material);
  c.add(g);
}
