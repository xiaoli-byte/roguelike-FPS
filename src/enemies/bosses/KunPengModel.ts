/**
 * 鲲鹏的两具身体：鲲（头和前半身，冰线以下不建模）与鹏（完整的展翅巨鸟）。
 *
 * 美术资产是原生骨架（art/pipeline/creature_rigs/SK_Boss_Kun.json / SK_Boss_Peng.json，清单绑定
 * boss_kunpeng_kun / boss_kunpeng_peng），首领按骨骼名直接驱动（NativePose）。资产缺失或 ?classic 时用这里的
 * 程序化低多边形模型兜底：它的关节（空组）与美术骨骼同名、同位置、绑定姿势下零旋转，ProcPose 按 NativePose 的语义
 * （绕模型空间的轴转动，子骨骼随父骨骼一起转）驱动它们，所以同一套动画代码同时驱动美术骨骼和程序化关节。
 *
 * 坐标：骨骼表沿用绑定 JSON 的 Blender 坐标（前 = −Y，生物左 = +X，上 = +Z，米），b2g() 换成游戏模型空间
 * （前 = +Z，左 = +X，上 = +Y）。模型原点：鲲在冰线（平切口）中心，鹏在双爪之间的地面。
 */
import * as THREE from 'three';
import { geo, glow, glowMesh, mesh, scaled, std } from './parts';

type V3 = readonly [number, number, number];

interface BoneSpec {
  head: V3;
  parent: string | null;
}

/** Blender（前 −Y、左 +X、上 +Z）→ 游戏模型空间（前 +Z、左 +X、上 +Y） */
export function b2g(v: V3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v[0], v[2], -v[1]);
}

/** 与 creature_rigs/SK_Boss_Kun.json 一致（只用到骨骼头的位置与父子关系） */
export const KUN_BONES: Record<string, BoneSpec> = {
  root: { head: [0, 0, 0], parent: null },
  spine_1: { head: [0, 0.6, 0], parent: 'root' },
  spine_2: { head: [0, 0.3, 1.8], parent: 'spine_1' },
  spine_3: { head: [0, 0, 3.4], parent: 'spine_2' },
  head: { head: [0, -0.4, 4.8], parent: 'spine_3' },
  pearl: { head: [0, -2.0, 6.3], parent: 'head' },
  barbel_L_1: { head: [2.1, -1.25, 4.3], parent: 'head' },
  barbel_L_2: { head: [2.5, -0.6, 3.0], parent: 'barbel_L_1' },
  barbel_L_3: { head: [2.5, 0.4, 1.35], parent: 'barbel_L_2' },
  barbel_R_1: { head: [-2.1, -1.25, 4.3], parent: 'head' },
  barbel_R_2: { head: [-2.5, -0.6, 3.0], parent: 'barbel_R_1' },
  barbel_R_3: { head: [-2.5, 0.4, 1.35], parent: 'barbel_R_2' },
  fin_L: { head: [1.15, 0.85, 4.4], parent: 'spine_3' },
  fin_R: { head: [-1.15, 0.85, 4.4], parent: 'spine_3' },
};

/** 与 creature_rigs/SK_Boss_Peng.json 一致 */
export const PENG_BONES: Record<string, BoneSpec> = {
  root: { head: [0, 0, 0], parent: null },
  hips: { head: [0, -2.4, 2.3], parent: 'root' },
  chest: { head: [0, -2.5, 4.0], parent: 'hips' },
  neck: { head: [0, -2.4, 5.4], parent: 'chest' },
  head: { head: [0, -2.6, 6.1], parent: 'neck' },
  pearl: { head: [0, -3.0, 6.0], parent: 'head' },
  barbel_L_1: { head: [0.45, -3.35, 5.2], parent: 'head' },
  barbel_L_2: { head: [1.05, -3.6, 4.3], parent: 'barbel_L_1' },
  barbel_R_1: { head: [-0.45, -3.35, 5.2], parent: 'head' },
  barbel_R_2: { head: [-1.05, -3.6, 4.3], parent: 'barbel_R_1' },
  wing_L_1: { head: [0.8, -1.9, 5.7], parent: 'chest' },
  wing_L_2: { head: [1.5, -1.9, 6.5], parent: 'wing_L_1' },
  wing_L_3: { head: [2.15, -1.9, 7.2], parent: 'wing_L_2' },
  wing_R_1: { head: [-0.8, -1.9, 5.7], parent: 'chest' },
  wing_R_2: { head: [-1.5, -1.9, 6.5], parent: 'wing_R_1' },
  wing_R_3: { head: [-2.15, -1.9, 7.2], parent: 'wing_R_2' },
  wing_L_low: { head: [1.15, -1.9, 4.9], parent: 'chest' },
  wing_R_low: { head: [-1.15, -1.9, 4.9], parent: 'chest' },
  tail_1: { head: [0, -1.6, 2.6], parent: 'hips' },
  tail_2: { head: [0, 0.2, 1.8], parent: 'tail_1' },
  tail_3: { head: [0, 1.9, 1.1], parent: 'tail_2' },
  thigh_L: { head: [0.6, -2.3, 2.9], parent: 'hips' },
  shin_L: { head: [0.6, -2.3, 1.3], parent: 'thigh_L' },
  talon_L: { head: [0.6, -2.35, 0.55], parent: 'shin_L' },
  thigh_R: { head: [-0.6, -2.3, 2.9], parent: 'hips' },
  shin_R: { head: [-0.6, -2.3, 1.3], parent: 'thigh_R' },
  talon_R: { head: [-0.6, -2.35, 0.55], parent: 'shin_R' },
};

/**
 * 美术网格上的关键点（游戏模型空间，未乘形态缩放；按正 / 侧 / 顶正交图实测）：
 * 弱点额珠、头 / 颈 / 身的受击球心、口部（吞吸、吐冰的发射点）。挂在对应骨骼上，随动画移动。
 */
export const KUN_POINTS = {
  pearl: { bone: 'pearl', at: [0, 6.3, 2.3] as V3, r: 0.42 },
  // 头部受击球收在额珠后下方，额珠露在球外（BossBase 的弱点优先规则只容许弱点比身体远半个弱点半径）
  head: { bone: 'head', at: [0, 5.0, 1.3] as V3, r: 1.55 },
  snout: { bone: 'head', at: [0, 4.6, 3.2] as V3, r: 0.7 },
  mouth: { bone: 'head', at: [0, 4.5, 3.2] as V3, r: 0 },
  neck: { bone: 'spine_3', at: [0, 3.9, 0.2] as V3, r: 2.2 },
  body: { bone: 'spine_2', at: [0, 2.2, -0.2] as V3, r: 2.4 },
} as const;

export const PENG_POINTS = {
  pearl: { bone: 'pearl', at: [0, 6.0, 3.25] as V3, r: 0.3 },
  head: { bone: 'head', at: [0, 5.8, 3.0] as V3, r: 1.0 },
  beak: { bone: 'head', at: [0, 5.4, 3.95] as V3, r: 0 },
  chest: { bone: 'chest', at: [0, 4.6, 2.5] as V3, r: 1.5 },
  hips: { bone: 'hips', at: [0, 2.8, 2.3] as V3, r: 1.4 },
  wingL: { bone: 'wing_L_2', at: [2.0, 6.6, 1.9] as V3, r: 1.4 },
  wingR: { bone: 'wing_R_2', at: [-2.0, 6.6, 1.9] as V3, r: 1.4 },
  talons: { bone: 'hips', at: [0, 0.5, 2.6] as V3, r: 0 },
} as const;

/** 首领驱动骨骼的统一接口（NativePose 天然满足；程序化兜底用 ProcPose） */
export interface KPPose {
  reset(): void;
  rotate(name: string, axis: THREE.Vector3, angle: number): void;
  translate(name: string, x: number, y: number, z: number): void;
  scale(name: string, x: number, y?: number, z?: number): void;
  bone(name: string): THREE.Object3D | null;
  has(name: string): boolean;
}

/**
 * 程序化关节的姿势：绑定姿势下所有关节零旋转，所以「父骨骼的绑定朝向」是单位四元数，
 * NativePose 的局部增量 parentInv · R · parent 退化为 R；子关节照常随父关节转动。
 */
export class ProcPose implements KPPose {
  private readonly rest = new Map<string, { o: THREE.Object3D; p: THREE.Vector3 }>();
  private readonly q = new THREE.Quaternion();

  constructor(joints: Map<string, THREE.Object3D>) {
    for (const [name, o] of joints) this.rest.set(name, { o, p: o.position.clone() });
  }

  reset(): void {
    for (const r of this.rest.values()) {
      r.o.quaternion.identity();
      r.o.position.copy(r.p);
      r.o.scale.set(1, 1, 1);
    }
  }

  rotate(name: string, axis: THREE.Vector3, angle: number): void {
    const r = this.rest.get(name);
    if (!r || angle === 0) return;
    r.o.quaternion.premultiply(this.q.setFromAxisAngle(axis, angle));
  }

  translate(name: string, x: number, y: number, z: number): void {
    const r = this.rest.get(name);
    if (!r) return;
    r.o.position.x += x;
    r.o.position.y += y;
    r.o.position.z += z;
  }

  scale(name: string, x: number, y = x, z = x): void {
    this.rest.get(name)?.o.scale.set(x, y, z);
  }

  bone(name: string): THREE.Object3D | null {
    return this.rest.get(name)?.o ?? null;
  }

  has(name: string): boolean {
    return this.rest.has(name);
  }
}

export interface ProcBody {
  /** 程序化部件的根（美术资产挂上后整组隐藏） */
  group: THREE.Group;
  joints: Map<string, THREE.Object3D>;
}

/** 按骨骼表建关节层级（零旋转，位置 = 骨骼头相对父骨骼头） */
function buildJoints(bones: Record<string, BoneSpec>, parent: THREE.Object3D): Map<string, THREE.Object3D> {
  const joints = new Map<string, THREE.Object3D>();
  const abs = (name: string): THREE.Vector3 => b2g(bones[name].head);
  for (const name of Object.keys(bones)) {
    const g = new THREE.Group();
    g.name = `kp_${name}`;
    const spec = bones[name];
    const p = abs(name);
    if (spec.parent) p.sub(abs(spec.parent));
    g.position.copy(p);
    joints.set(name, g);
  }
  for (const name of Object.keys(bones)) {
    const spec = bones[name];
    (spec.parent ? joints.get(spec.parent)! : parent).add(joints.get(name)!);
  }
  return joints;
}

/** 在关节下按模型空间坐标放一个部件（关节零旋转：局部 = 模型坐标 − 关节绝对位置） */
function at(bones: Record<string, BoneSpec>, joint: string, x: number, y: number, z: number): THREE.Vector3 {
  // 关节的绝对位置 = 骨骼头（零旋转、零缩放差），沿父链累加与直接取骨骼头一致
  return new THREE.Vector3(x, y, z).sub(b2g(bones[joint].head));
}

/** 两点之间的细圆柱（须、腿） */
function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const me = new THREE.Mesh(geo.cyl(r * 0.7, r, 1, 5), m);
  me.scale.set(1, len, 1);
  me.position.copy(a).addScaledVector(d, 0.5);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(me);
  return me;
}

const kunMats = () => ({
  scale: std(0x2b4a6e, { rough: 0.7 }),
  scaleDark: std(0x1c3150, { rough: 0.75 }),
  belly: std(0xc9d8e6, { rough: 0.6 }),
  frost: std(0xe6f4ff, { emissive: 0x3a8fd8, ei: 0.25, rough: 0.35 }),
  tusk: std(0xe8eef2, { rough: 0.4 }),
  barbel: std(0x9fc2dc, { rough: 0.5 }),
  fin: std(0x35597f, { emissive: 0x1d4a7a, ei: 0.2, rough: 0.55 }),
  eye: glow(0x7ff6ff),
  pearl: glow(0x7ff0ff),
  pearlHalo: glow(0x5ae6ff, 0.35, true),
});

/** 鲲：约 8 米高（未缩放），冰线以下不建模 */
export function buildKunProc(parent: THREE.Object3D): ProcBody {
  const B = KUN_BONES;
  const group = new THREE.Group();
  group.name = 'kun_proc';
  parent.add(group);
  const J = buildJoints(B, group);
  const m = kunMats();
  const s1 = J.get('spine_1')!, s2 = J.get('spine_2')!, s3 = J.get('spine_3')!, head = J.get('head')!;
  // 身体：三段椭圆柱，前面一块浅色喉板
  let p = at(B, 'spine_1', 0, 1.0, -0.5);
  scaled(mesh(s1, geo.cyl(2.2, 2.5, 2.0, 9), m.scale, p.x, p.y, p.z), 1, 1, 1.2);
  p = at(B, 'spine_2', 0, 2.6, -0.2);
  scaled(mesh(s2, geo.cyl(2.0, 2.2, 1.8, 9), m.scale, p.x, p.y, p.z), 1, 1, 1.15);
  p = at(B, 'spine_3', 0, 4.0, 0.1);
  scaled(mesh(s3, geo.cyl(1.8, 2.0, 1.6, 9), m.scaleDark, p.x, p.y, p.z), 1, 1, 1.1);
  p = at(B, 'spine_2', 0, 2.4, 2.3);
  scaled(mesh(s2, geo.sphere(1.0, 8, 6), m.belly, p.x, p.y, p.z), 1.5, 2.2, 0.5);
  // 背脊冰刺
  for (let i = 0; i < 5; i++) {
    const jn = i < 2 ? 'spine_2' : 'spine_3';
    p = at(B, jn, 0, 2.2 + i * 0.9, -2.2 + i * 0.15);
    mesh(J.get(jn)!, geo.cone(0.35, 1.3, 4), m.frost, p.x, p.y, p.z, -0.6, 0, 0);
  }
  // 头：方钝的头颅 + 吻部 + 冠刺 + 獠牙
  p = at(B, 'head', 0, 5.6, 1.6);
  scaled(mesh(head, geo.box(3.2, 2.0, 3.4), m.scaleDark, p.x, p.y, p.z), 1, 1, 1);
  p = at(B, 'head', 0, 5.0, 3.3);
  mesh(head, geo.box(2.4, 1.1, 1.3), m.scale, p.x, p.y, p.z);
  p = at(B, 'head', 0, 4.35, 2.6);
  mesh(head, geo.box(2.2, 0.5, 1.6), m.belly, p.x, p.y, p.z);
  for (const [x, z, h] of [[-0.95, 3.2, 1.1], [-0.45, 3.65, 0.8], [0.45, 3.65, 0.8], [0.95, 3.2, 1.1]] as const) {
    p = at(B, 'head', x, 4.3 - h * 0.3, z);
    mesh(head, geo.cone(0.14, h, 4), m.tusk, p.x, p.y, p.z, Math.PI, 0, 0);
  }
  for (let i = 0; i < 4; i++) {
    p = at(B, 'head', 0, 7.0 + (i % 2) * 0.2, 1.7 - i * 0.6);
    mesh(head, geo.cone(0.3, 1.0 - i * 0.12, 4), m.frost, p.x, p.y, p.z, -0.5, 0, 0);
  }
  for (const s of [-1, 1]) {
    p = at(B, 'head', 1.15 * s, 5.45, 1.45 + 0.9);
    glowMesh(head, geo.sphere(0.14, 6, 4), m.eye, p.x, p.y, p.z, 'eye');
  }
  p = at(B, 'pearl', 0, 6.3, 2.3);
  glowMesh(J.get('pearl')!, geo.sphere(0.42, 10, 8), m.pearl, p.x, p.y, p.z, 'pearl');
  glowMesh(J.get('pearl')!, geo.sphere(0.7, 10, 8), m.pearlHalo, p.x, p.y, p.z, 'pearlHalo');
  // 须：嘴角 → 三节
  for (const side of ['L', 'R'] as const) {
    const k = side === 'L' ? 1 : -1;
    const pts = [b2g([1.5 * k, -1.8, 4.7]), b2g(B[`barbel_${side}_1`].head), b2g(B[`barbel_${side}_2`].head), b2g(B[`barbel_${side}_3`].head), b2g([3.0 * k, 2.1, 0.9])];
    const owners = ['head', `barbel_${side}_1`, `barbel_${side}_2`, `barbel_${side}_3`];
    for (let i = 0; i < 4; i++) {
      const o = owners[i];
      rod(J.get(o)!, pts[i].clone().sub(b2g(B[o].head)), pts[i + 1].clone().sub(b2g(B[o].head)), 0.1, m.barbel);
    }
    // 背上的翼鳍（化鹏的雏翼）：两片压扁的羽扇
    const fin = J.get(`fin_${side}`)!;
    for (let i = 0; i < 3; i++) {
      p = at(B, `fin_${side}`, (1.4 + i * 0.35) * k, 5.6 + i * 0.8, -1.2 - i * 0.5);
      const f = mesh(fin, geo.octa(1), m.fin, p.x, p.y, p.z, 0.5, 0, -0.35 * k);
      f.scale.set(0.18, 1.6 - i * 0.2, 0.8);
    }
  }
  return { group, joints: J };
}

const pengMats = () => ({
  feather: std(0x2d4f78, { rough: 0.7 }),
  featherLight: std(0xb9cfe4, { emissive: 0x2a6fb0, ei: 0.15, rough: 0.55 }),
  chest: std(0xd9e4ee, { rough: 0.6 }),
  beak: std(0xe3e8ec, { rough: 0.4 }),
  leg: std(0x24324a, { rough: 0.6 }),
  claw: std(0xe8eef2, { rough: 0.35 }),
  barbel: std(0x9fc2dc, { rough: 0.5 }),
  eye: glow(0x7ff6ff),
  pearl: glow(0x7ff0ff),
  pearlHalo: glow(0x5ae6ff, 0.35, true),
});

/** 鹏：约 8 米高（未缩放），绑定姿势直立、双翼上举成 V 形 */
export function buildPengProc(parent: THREE.Object3D): ProcBody {
  const B = PENG_BONES;
  const group = new THREE.Group();
  group.name = 'peng_proc';
  parent.add(group);
  const J = buildJoints(B, group);
  const m = pengMats();
  let p = at(B, 'hips', 0, 2.9, 2.3);
  scaled(mesh(J.get('hips')!, geo.sphere(1.0, 9, 7), m.feather, p.x, p.y, p.z), 1.3, 1.4, 1.2);
  p = at(B, 'chest', 0, 4.6, 2.5);
  scaled(mesh(J.get('chest')!, geo.sphere(1.0, 9, 7), m.feather, p.x, p.y, p.z), 1.4, 1.5, 1.3);
  p = at(B, 'chest', 0, 4.4, 3.5);
  scaled(mesh(J.get('chest')!, geo.sphere(1.0, 8, 6), m.chest, p.x, p.y, p.z), 0.7, 1.3, 0.4);
  p = at(B, 'neck', 0, 5.6, 2.6);
  scaled(mesh(J.get('neck')!, geo.sphere(0.7, 8, 6), m.feather, p.x, p.y, p.z), 1, 1.1, 1);
  const head = J.get('head')!;
  p = at(B, 'head', 0, 5.9, 2.9);
  scaled(mesh(head, geo.sphere(0.75, 9, 7), m.feather, p.x, p.y, p.z), 1, 0.95, 1.15);
  p = at(B, 'head', 0, 5.45, 3.75);
  mesh(head, geo.cone(0.32, 1.0, 5), m.beak, p.x, p.y, p.z, Math.PI / 2 + 0.5, 0, 0);
  for (const s of [-1, 1]) {
    p = at(B, 'head', 0.35 * s, 5.95, 3.45);
    glowMesh(head, geo.sphere(0.09, 6, 4), m.eye, p.x, p.y, p.z, 'eye');
    p = at(B, 'head', 0.25 * s, 6.6, 2.5);
    mesh(head, geo.cone(0.12, 0.7, 4), m.featherLight, p.x, p.y, p.z, -0.6, 0, -0.3 * s);
  }
  p = at(B, 'pearl', 0, 6.0, 3.25);
  glowMesh(J.get('pearl')!, geo.sphere(0.3, 10, 8), m.pearl, p.x, p.y, p.z, 'pearl');
  glowMesh(J.get('pearl')!, geo.sphere(0.52, 10, 8), m.pearlHalo, p.x, p.y, p.z, 'pearlHalo');
  for (const side of ['L', 'R'] as const) {
    const k = side === 'L' ? 1 : -1;
    // 须
    const pts = [b2g(B[`barbel_${side}_1`].head), b2g(B[`barbel_${side}_2`].head), b2g([1.5 * k, -3.6, 3.4])];
    for (let i = 0; i < 2; i++) {
      const o = `barbel_${side}_${i + 1}`;
      rod(J.get(o)!, pts[i].clone().sub(b2g(B[o].head)), pts[i + 1].clone().sub(b2g(B[o].head)), 0.06, m.barbel);
    }
    // 翼：三节上半扇（每节两片大羽）+ 下半扇
    const seg = [[`wing_${side}_1`, 1.25, 6.0, 1.1], [`wing_${side}_2`, 1.9, 6.85, 1.2], [`wing_${side}_3`, 2.55, 7.6, 1.1]] as const;
    for (const [jn, x, y, len] of seg) {
      for (let f = 0; f < 2; f++) {
        p = at(B, jn, x * k + f * 0.25 * k, y - 0.6 - f * 0.4, 1.9);
        const fe = mesh(J.get(jn)!, geo.octa(1), f ? m.featherLight : m.feather, p.x, p.y, p.z, 0, 0, -0.55 * k);
        fe.scale.set(0.55, len + 0.4, 0.12);
      }
    }
    p = at(B, `wing_${side}_low`, 1.7 * k, 3.9, 1.9);
    const low = mesh(J.get(`wing_${side}_low`)!, geo.octa(1), m.feather, p.x, p.y, p.z, 0, 0, 0.25 * k);
    low.scale.set(0.7, 1.4, 0.12);
    // 腿与爪
    const thigh = J.get(`thigh_${side}`)!, shin = J.get(`shin_${side}`)!, talon = J.get(`talon_${side}`)!;
    p = at(B, `thigh_${side}`, 0.62 * k, 2.1, 2.3);
    scaled(mesh(thigh, geo.sphere(0.5, 7, 5), m.feather, p.x, p.y, p.z), 1, 1.6, 1);
    rod(shin, new THREE.Vector3(0, 0, 0), at(B, `shin_${side}`, 0.6 * k, 0.55, 2.35), 0.14, m.leg);
    for (const [dx, dz] of [[-0.25, 0.9], [0, 1.0], [0.25, 0.9], [0, -0.5]] as const) {
      const tip = at(B, `talon_${side}`, 0.6 * k + dx, 0.1, 2.35 + dz);
      rod(talon, new THREE.Vector3(0, 0, 0), tip, 0.09, m.leg);
      mesh(talon, geo.cone(0.08, 0.35, 4), m.claw, tip.x, tip.y - 0.1, tip.z, dz > 0 ? 2.2 : -2.2, 0, 0);
    }
  }
  // 尾扇：三节、每节一片宽羽
  for (let i = 0; i < 3; i++) {
    const jn = `tail_${i + 1}`;
    const a = b2g(B[jn].head);
    const b = i < 2 ? b2g(B[`tail_${i + 2}`].head) : b2g([0, 3.9, 0.3]);
    const mid = a.clone().add(b).multiplyScalar(0.5).sub(a);
    const f = mesh(J.get(jn)!, geo.octa(1), i === 2 ? m.featherLight : m.feather, mid.x, mid.y, mid.z);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    f.scale.set(0.7 + i * 0.25, a.distanceTo(b) * 0.65, 0.12);
  }
  return { group, joints: J };
}

/** 骨骼上的锚点：位置按模型空间（host 坐标）给，换算到骨骼局部（绑定姿势下调用） */
export function anchorOn(host: THREE.Object3D, bone: THREE.Object3D, at: V3, name: string): THREE.Object3D {
  host.updateWorldMatrix(true, true);
  const o = new THREE.Object3D();
  o.name = name;
  bone.add(o);
  o.position.copy(bone.worldToLocal(host.localToWorld(new THREE.Vector3(at[0], at[1], at[2]))));
  return o;
}
