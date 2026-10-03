/**
 * 敌人模型工具：模块级几何体 / 材质缓存、低多边形拼装辅助、人形骨架与步态。
 *
 * 约定：
 *  - 模型朝 +Z，脚底在原点。
 *  - 几何体全部缓存复用，任何人都不要 dispose 它们（EnemyBase 也不会）。
 *  - 材质同样缓存；EnemyBase.init 会为每个实例克隆一份（用于受击闪白），
 *    所以按实例改材质参数是安全的。
 */
import * as THREE from 'three';
import { TAU } from '../core/math';

export type Anchor = 'center' | 'top' | 'bottom';

// ───────────────────────────── 几何体缓存 ─────────────────────────────

const geoCache = new Map<string, THREE.BufferGeometry>();
const q = (n: number): number => Math.round(n * 1000);

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** 按锚点平移：top = 顶面在原点（向下悬挂的肢体），bottom = 底面在原点 */
function anchored(g: THREE.BufferGeometry, h: number, a: Anchor): THREE.BufferGeometry {
  if (a === 'top') g.translate(0, -h / 2, 0);
  else if (a === 'bottom') g.translate(0, h / 2, 0);
  return g;
}

export const Geo = {
  box(w: number, h: number, d: number, a: Anchor = 'center'): THREE.BufferGeometry {
    return cached(`box:${q(w)}:${q(h)}:${q(d)}:${a}`, () => anchored(new THREE.BoxGeometry(w, h, d), h, a));
  },
  cyl(rTop: number, rBot: number, h: number, seg = 6, a: Anchor = 'center'): THREE.BufferGeometry {
    return cached(`cyl:${q(rTop)}:${q(rBot)}:${q(h)}:${seg}:${a}`, () => anchored(new THREE.CylinderGeometry(rTop, rBot, h, seg), h, a));
  },
  cone(r: number, h: number, seg = 6, a: Anchor = 'center'): THREE.BufferGeometry {
    return cached(`cone:${q(r)}:${q(h)}:${seg}:${a}`, () => anchored(new THREE.ConeGeometry(r, h, seg), h, a));
  },
  ico(r: number, detail = 0): THREE.BufferGeometry {
    return cached(`ico:${q(r)}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
  },
  octa(r: number): THREE.BufferGeometry {
    return cached(`octa:${q(r)}`, () => new THREE.OctahedronGeometry(r));
  },
  dodeca(r: number): THREE.BufferGeometry {
    return cached(`dodeca:${q(r)}`, () => new THREE.DodecahedronGeometry(r));
  },
  torus(R: number, tube: number, radial = 5, tubular = 16, arc = TAU): THREE.BufferGeometry {
    return cached(`torus:${q(R)}:${q(tube)}:${radial}:${tubular}:${q(arc)}`, () => new THREE.TorusGeometry(R, tube, radial, tubular, arc));
  },
  /** 平躺在 XZ 平面、朝上的圆环 */
  ring(inner: number, outer: number, seg = 32): THREE.BufferGeometry {
    return cached(`ring:${q(inner)}:${q(outer)}:${seg}`, () => new THREE.RingGeometry(inner, outer, seg).rotateX(-Math.PI / 2));
  },
  /** 平躺在 XZ 平面、朝上的圆盘 */
  disc(r: number, seg = 24): THREE.BufferGeometry {
    return cached(`disc:${q(r)}:${seg}`, () => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2));
  },
  /** 截面 1×1、沿 +Z 从 0 延伸到 1 的长条（激光）。缩放 (宽, 宽, 长) 后 lookAt 目标即可 */
  beam(): THREE.BufferGeometry {
    return cached('beam', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5));
  },
  /** 朝上的地面通道：x ∈ [-0.5, 0.5]，z ∈ [0, 1] */
  lane(): THREE.BufferGeometry {
    return cached('lane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5));
  },
};

// ───────────────────────────── 材质缓存 ─────────────────────────────

const matCache = new Map<string, THREE.Material>();

export interface FlatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  ei?: number;
}

/** 低多边形平直着色的受光材质（会参与受击闪白） */
export function flat(color: number, o: FlatOpts = {}): THREE.MeshStandardMaterial {
  const rough = o.rough ?? 0.82;
  const metal = o.metal ?? 0.05;
  const emissive = o.emissive ?? 0x000000;
  const ei = o.ei ?? 1;
  const key = `f:${color}:${rough}:${metal}:${emissive}:${ei}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, emissive, emissiveIntensity: ei });
    matCache.set(key, m);
  }
  return m;
}

/** 自发光（不受光照、不参与色调映射）——眼睛、核心、法器 */
export function glowMat(color: number): THREE.MeshBasicMaterial {
  const key = `g:${color}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    matCache.set(key, m);
  }
  return m;
}

/** 加法混合半透明（光晕、法阵、激光）。颜色为黑时完全不可见 */
export function additiveMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  const key = `a:${color}:${opacity}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    matCache.set(key, m);
  }
  return m;
}

/** 新建一份独立的加法材质（调用者负责释放；敌人请交给 StandardEnemy.ownMaterial） */
export function newAdditive(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return additiveMat(color, opacity).clone();
}

/**
 * 发光部件（StandardEnemy.glowPart）的模板材质：按「底色 + 热色 + 通道 + 混合方式」缓存。
 * EnemyBase.init 会为每个实例克隆模型里的全部材质（同一模板在一个实例里只克隆一份），
 * 所以只有参数完全相同的发光部件才会共用实例材质——它们每帧写入的颜色也完全相同，不会互相覆盖。
 */
export function glowPartMat(base: number, hot: number, channel: number, additive: boolean): THREE.MeshBasicMaterial {
  const key = `gp:${base}:${hot}:${channel}:${additive ? 1 : 0}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = additive
      ? new THREE.MeshBasicMaterial({
        color: base, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      })
      : new THREE.MeshBasicMaterial({ color: base, toneMapped: false });
    matCache.set(key, m);
  }
  return m;
}

// ───────────────────────────── 拼装辅助 ─────────────────────────────

/** 创建网格并挂到 parent 上 */
export function part(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** 空关节 / 挂点 */
export function joint(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ───────────────────────────── 人形骨架 ─────────────────────────────

export interface HumanoidSpec {
  /** 髋关节高度（= 大腿 + 小腿） */
  hipY: number;
  /** 两腿横向偏移 */
  hipX: number;
  thigh: number;
  legW: number;
  legColor: number;
  shinColor?: number;
  footColor?: number;
  torsoW: number;
  torsoH: number;
  torsoD: number;
  torsoColor: number;
  /** 肩关节横向偏移与相对髋的高度 */
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  foreArm: number;
  armW: number;
  armColor: number;
  foreColor?: number;
  handColor?: number;
  /** 头部关节相对髋的高度 */
  neckY: number;
}

export interface HumanoidRig {
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  /** 髋部基准高度（下蹲 / 起伏以它为基准） */
  hipY: number;
}

/**
 * 搭建一个两段式四肢的人形骨架（只含腿、躯干盒、手臂；头部内容由各敌人自己加到 rig.head）。
 * 关节旋转约定：rotation.x 为负 = 肢体向前（+Z）摆；肘 / 膝 rotation.x 为负 = 前臂前屈，膝为正 = 小腿后屈。
 */
export function buildHumanoid(root: THREE.Object3D, s: HumanoidSpec): HumanoidRig {
  const hips = joint(root, 0, s.hipY, 0);
  const shin = s.hipY - s.thigh;

  const leg = (side: number): [THREE.Group, THREE.Group] => {
    const hip = joint(hips, side * s.hipX, 0, 0);
    part(hip, Geo.box(s.legW, s.thigh, s.legW * 1.05, 'top'), flat(s.legColor));
    const knee = joint(hip, 0, -s.thigh, 0);
    part(knee, Geo.box(s.legW * 0.88, shin, s.legW * 0.92, 'top'), flat(s.shinColor ?? s.legColor));
    const fh = Math.min(0.14, s.legW * 0.55);
    part(knee, Geo.box(s.legW * 1.02, fh, s.legW * 1.7), flat(s.footColor ?? s.shinColor ?? s.legColor), 0, -shin + fh / 2, s.legW * 0.35);
    return [hip, knee];
  };
  const [legL, kneeL] = leg(1);
  const [legR, kneeR] = leg(-1);

  const torso = joint(hips, 0, 0, 0);
  part(torso, Geo.box(s.torsoW, s.torsoH, s.torsoD, 'bottom'), flat(s.torsoColor), 0, -0.04, 0);
  const head = joint(torso, 0, s.neckY, 0);

  const arm = (side: number): [THREE.Group, THREE.Group, THREE.Group] => {
    const shoulder = joint(torso, side * s.shoulderX, s.shoulderY, 0);
    part(shoulder, Geo.box(s.armW, s.upperArm, s.armW, 'top'), flat(s.armColor));
    const elbow = joint(shoulder, 0, -s.upperArm, 0);
    part(elbow, Geo.box(s.armW * 0.88, s.foreArm, s.armW * 0.88, 'top'), flat(s.foreColor ?? s.armColor));
    const hand = joint(elbow, 0, -s.foreArm, 0);
    part(hand, Geo.box(s.armW * 1.05, s.armW * 0.9, s.armW * 1.05), flat(s.handColor ?? s.foreColor ?? s.armColor), 0, -s.armW * 0.3, 0);
    return [shoulder, elbow, hand];
  };
  const [armL, elbowL, handL] = arm(1);
  const [armR, elbowR, handR] = arm(-1);

  return { hips, torso, head, armL, armR, elbowL, elbowR, handL, handR, legL, legR, kneeL, kneeR, hipY: s.hipY };
}

/**
 * 步态：腿前后摆 + 膝盖弯曲 + 髋部起伏；armSwing>0 时双臂反向摆动（持武器的手臂之后再覆盖）。
 * @param phase 步态相位（弧度）
 * @param amp 摆幅（0 = 站立）
 */
export function applyWalk(r: HumanoidRig, phase: number, amp: number, armSwing = 1): void {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  r.legL.rotation.set(-s * amp, 0, 0);
  r.legR.rotation.set(s * amp, 0, 0);
  r.kneeL.rotation.set(Math.max(0, c) * amp * 1.3, 0, 0);
  r.kneeR.rotation.set(Math.max(0, -c) * amp * 1.3, 0, 0);
  r.hips.position.y = r.hipY - Math.abs(c) * amp * 0.05;
  r.torso.rotation.set(amp * 0.08, s * amp * 0.12, 0);
  r.armL.rotation.set(s * amp * 0.75 * armSwing, 0, 0.06);
  r.armR.rotation.set(-s * amp * 0.75 * armSwing, 0, -0.06);
  r.elbowL.rotation.set(-0.25 - Math.max(0, s) * amp * 0.4, 0, 0);
  r.elbowR.rotation.set(-0.25 - Math.max(0, -s) * amp * 0.4, 0, 0);
  r.head.rotation.set(0, 0, 0);
}

/** 下蹲：髋部降低 d 米，大腿前屈、小腿后屈，使脚大致留在原地 */
export function applyCrouch(r: HumanoidRig, d: number): void {
  if (d <= 0) return;
  r.hips.position.y -= d;
  const a = Math.acos(Math.max(0.2, 1 - d / Math.max(0.3, r.hipY)));
  r.legL.rotation.x -= a;
  r.legR.rotation.x -= a;
  r.kneeL.rotation.x += a * 2;
  r.kneeR.rotation.x += a * 2;
  r.torso.rotation.x += a * 0.5;
}

/** 让 obj 的欧拉角朝目标插值（t ∈ [0,1]） */
export function blendRot(o: THREE.Object3D, x: number, y: number, z: number, t: number): void {
  o.rotation.x += (x - o.rotation.x) * t;
  o.rotation.y += (y - o.rotation.y) * t;
  o.rotation.z += (z - o.rotation.z) * t;
}

const _reach = new THREE.Vector3();

/**
 * 两骨骼手臂 IK：让手腕关节（hand）落到 target（躯干局部坐标），肩 rotation = (x, 0, z)、肘只在 x 上前屈，
 * 与 applyWalk 等程序动画的关节约定一致。够不着时手臂伸直指向目标。持械动作用它把双手「握」在武器的握点上。
 * @param side 1 = 左臂（+X），-1 = 右臂
 */
export function reachArm(r: HumanoidRig, side: number, target: THREE.Vector3): void {
  const arm = side > 0 ? r.armL : r.armR;
  const elbow = side > 0 ? r.elbowL : r.elbowR;
  const hand = side > 0 ? r.handL : r.handR;
  const l1 = elbow.position.length();
  const l2 = hand.position.length();
  _reach.subVectors(target, arm.position);
  const d = Math.min(Math.max(_reach.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  _reach.setLength(d);
  // 肘关节弯曲角（0 = 伸直），余弦定理
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  elbow.rotation.set(-bend, 0, 0);
  // 未转肩时手腕在上臂空间的位置 h = (0, hy, hz)；求 R = Rx(a)·Rz(c) 使 R·h 指向目标
  const hy = -l1 - l2 * Math.cos(bend);
  const hz = l2 * Math.sin(bend);
  const c = Math.asin(Math.min(1, Math.max(-1, -_reach.x / hy)));
  const a = Math.atan2(_reach.z, _reach.y) - Math.atan2(hz, hy * Math.cos(c));
  arm.rotation.set(a, 0, c);
}
