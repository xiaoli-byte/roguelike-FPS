/**
 * 火麒麟的两具身体：玄鳞（一阶段，玄铁鳞甲）与焚身（二阶段，熔岩裂纹身、大火鬃）。两个模型共用一套四足马鹿骨架设计
 * （骨骼名、层级、关节方向相同；位置各按自己的网格实测），首领代码一套动画同时驱动两个形态。
 *
 * 美术资产是原生骨架（art/pipeline/creature_rigs/SK_Boss_Qilin.json / SK_Boss_QilinBurn.json，清单绑定
 * boss_qilin_xuan / boss_qilin_burn），首领按骨骼名直接驱动（NativePose）。资产缺失或 ?classic 时用这里的程序化低多边形
 * 兜底：关节（空组）与美术骨骼同名、同位置、绑定姿势下零旋转，ProcPose（KunPengModel）按 NativePose 的语义驱动它们。
 *
 * 坐标：骨骼表沿用绑定 JSON 的 Blender 坐标（前 = −Y，生物左 = +X，上 = +Z，米；整只高 6 米到独角尖），b2g() 换成
 * 游戏模型空间（前 = +Z，左 = +X，上 = +Y）。模型原点在四蹄之间的地面（包围盒中心）。
 *
 * 骨架（两个形态相同）：root → hips → spine → chest → neck_1 → neck_2 → head（jaw 下颌、pearl 角根火珠）；
 * 前腿 upperarm → forearm → fcannon → fhoof（肩、肘、腕、球节），后腿 thigh → shin → hcannon → hhoof（髋、膝、跗、球节）；
 * 尾 tail_1..3。关节方向按真实马：前腿腕关节向后折，后腿跗关节向前折。
 */
import * as THREE from 'three';
import { geo, glow, glowMesh, mesh, scaled, std } from './parts';
import { b2g } from './KunPengModel';

type V3 = readonly [number, number, number];

interface BoneSpec {
  head: V3;
  parent: string | null;
}

const legs = (front: [number, number, number][], hind: [number, number, number][]): Record<string, BoneSpec> => {
  const out: Record<string, BoneSpec> = {};
  const fn = ['upperarm', 'forearm', 'fcannon', 'fhoof'], hn = ['thigh', 'shin', 'hcannon', 'hhoof'];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    fn.forEach((n, i) => { const p = front[i]; out[`${n}_${side}`] = { head: [p[0] * s, p[1], p[2]], parent: i ? `${fn[i - 1]}_${side}` : 'chest' }; });
    hn.forEach((n, i) => { const p = hind[i]; out[`${n}_${side}`] = { head: [p[0] * s, p[1], p[2]], parent: i ? `${hn[i - 1]}_${side}` : 'hips' }; });
  }
  return out;
};

/** 与 creature_rigs/SK_Boss_Qilin.json 一致（只用到骨骼头的位置与父子关系） */
export const XUAN_BONES: Record<string, BoneSpec> = {
  root: { head: [0, 0, 0], parent: null },
  hips: { head: [0, 0.55, 2.8], parent: 'root' },
  spine: { head: [0, -0.3, 2.85], parent: 'hips' },
  chest: { head: [0, -1.0, 2.85], parent: 'spine' },
  neck_1: { head: [0, -1.4, 3.35], parent: 'chest' },
  neck_2: { head: [0, -1.55, 3.9], parent: 'neck_1' },
  head: { head: [0, -1.68, 4.35], parent: 'neck_2' },
  jaw: { head: [0, -1.72, 4.2], parent: 'head' },
  pearl: { head: [0, -1.93, 4.85], parent: 'head' },
  ...legs([[0.32, -1.5, 2.55], [0.32, -1.22, 1.78], [0.31, -1.27, 0.98], [0.3, -1.33, 0.45]],
    [[0.42, 0.45, 2.7], [0.45, 0.25, 2.0], [0.46, 0.84, 1.3], [0.45, 0.8, 0.45]]),
  tail_1: { head: [0, 0.72, 2.85], parent: 'hips' },
  tail_2: { head: [0, 1.15, 2.45], parent: 'tail_1' },
  tail_3: { head: [0, 1.6, 2.6], parent: 'tail_2' },
};

/** 与 creature_rigs/SK_Boss_QilinBurn.json 一致 */
export const BURN_BONES: Record<string, BoneSpec> = {
  root: { head: [0, 0, 0], parent: null },
  hips: { head: [0, 0.5, 2.95], parent: 'root' },
  spine: { head: [0, -0.45, 3.0], parent: 'hips' },
  chest: { head: [0, -1.35, 3.0], parent: 'spine' },
  neck_1: { head: [0, -1.8, 3.45], parent: 'chest' },
  neck_2: { head: [0, -1.95, 4.0], parent: 'neck_1' },
  head: { head: [0, -2.05, 4.4], parent: 'neck_2' },
  jaw: { head: [0, -2.1, 4.18], parent: 'head' },
  pearl: { head: [0, -2.33, 4.85], parent: 'head' },
  ...legs([[0.45, -1.85, 2.65], [0.45, -1.45, 2.0], [0.45, -1.75, 1.15], [0.45, -1.95, 0.58]],
    [[0.52, 0.45, 2.8], [0.56, 0.25, 2.05], [0.57, 0.98, 1.28], [0.57, 0.88, 0.55]]),
  tail_1: { head: [0, 0.62, 3.1], parent: 'hips' },
  tail_2: { head: [0, 1.1, 3.05], parent: 'tail_1' },
  tail_3: { head: [0, 1.6, 3.65], parent: 'tail_2' },
};

export interface QilinPoint {
  bone: string;
  /** 游戏模型空间（未乘形态缩放） */
  at: V3;
  /** 受击球半径（未缩放；0 = 只是锚点） */
  r: number;
}

/**
 * 网格上的关键点（游戏模型空间，按正 / 侧正交图与头部特写实测）：弱点（角根火珠、焚身的胸口火心）、受击球心、
 * 口部（吐息发射点）、四蹄（蹄印、火云）。挂在对应骨骼上，随动画移动。
 */
export const XUAN_POINTS: Record<string, QilinPoint> = {
  pearl: { bone: 'pearl', at: [0, 4.85, 1.93], r: 0.3 },
  // 头部受击球收在火珠后下方，火珠露在球外（BossBase 的弱点优先规则只容许弱点比身体远半个弱点半径）
  head: { bone: 'head', at: [0, 4.25, 1.75], r: 0.42 },
  mouth: { bone: 'jaw', at: [0, 4.15, 2.2], r: 0 },
  neck: { bone: 'neck_1', at: [0, 3.65, 1.45], r: 0.6 },
  chest: { bone: 'chest', at: [0, 2.6, 1.3], r: 0.85 },
  body: { bone: 'spine', at: [0, 2.6, 0.3], r: 0.85 },
  hips: { bone: 'hips', at: [0, 2.55, -0.55], r: 0.8 },
  hoofFL: { bone: 'fhoof_L', at: [0.3, 0.1, 1.43], r: 0 },
  hoofFR: { bone: 'fhoof_R', at: [-0.3, 0.1, 1.43], r: 0 },
  hoofHL: { bone: 'hhoof_L', at: [0.45, 0.1, -0.73], r: 0 },
  hoofHR: { bone: 'hhoof_R', at: [-0.45, 0.1, -0.73], r: 0 },
  hornTip: { bone: 'head', at: [0, 6.0, 1.7], r: 0 },
};

export const BURN_POINTS: Record<string, QilinPoint> = {
  pearl: { bone: 'pearl', at: [0, 4.85, 2.33], r: 0.3 },
  heart: { bone: 'chest', at: [0, 2.85, 2.2], r: 0.45 },
  head: { bone: 'head', at: [0, 4.25, 2.15], r: 0.42 },
  mouth: { bone: 'jaw', at: [0, 4.12, 2.65], r: 0 },
  neck: { bone: 'neck_1', at: [0, 3.8, 1.9], r: 0.65 },
  chest: { bone: 'chest', at: [0, 2.7, 1.45], r: 0.85 },
  body: { bone: 'spine', at: [0, 2.7, 0.5], r: 0.9 },
  hips: { bone: 'hips', at: [0, 2.7, -0.5], r: 0.85 },
  hoofFL: { bone: 'fhoof_L', at: [0.45, 0.1, 2.2], r: 0 },
  hoofFR: { bone: 'fhoof_R', at: [-0.45, 0.1, 2.2], r: 0 },
  hoofHL: { bone: 'hhoof_L', at: [0.57, 0.1, -0.83], r: 0 },
  hoofHR: { bone: 'hhoof_R', at: [-0.57, 0.1, -0.83], r: 0 },
  hornTip: { bone: 'head', at: [0, 6.0, 2.24], r: 0 },
};

export interface QilinProcBody {
  /** 程序化部件的根（美术资产挂上后整组隐藏） */
  group: THREE.Group;
  joints: Map<string, THREE.Object3D>;
}

function buildJoints(bones: Record<string, BoneSpec>, parent: THREE.Object3D): Map<string, THREE.Object3D> {
  const joints = new Map<string, THREE.Object3D>();
  for (const name of Object.keys(bones)) {
    const g = new THREE.Group();
    g.name = `ql_${name}`;
    const spec = bones[name];
    const p = b2g(spec.head);
    if (spec.parent) p.sub(b2g(bones[spec.parent].head));
    g.position.copy(p);
    joints.set(name, g);
  }
  for (const name of Object.keys(bones)) {
    const spec = bones[name];
    (spec.parent ? joints.get(spec.parent)! : parent).add(joints.get(name)!);
  }
  return joints;
}

/** 关节零旋转：模型空间坐标 → 关节局部 */
function local(bones: Record<string, BoneSpec>, joint: string, p: THREE.Vector3): THREE.Vector3 {
  return p.clone().sub(b2g(bones[joint].head));
}

/** 两点之间的圆柱（腿、颈、尾） */
function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const me = new THREE.Mesh(geo.cyl(r1, r0, 1, 6), m);
  me.scale.set(1, len, 1);
  me.position.copy(a).addScaledVector(d, 0.5);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(me);
  return me;
}

/** 程序化兜底的低多边形麒麟（玄鳞 / 焚身），约 6 米高（未缩放） */
export function buildQilinProc(parent: THREE.Object3D, burn: boolean): QilinProcBody {
  const B = burn ? BURN_BONES : XUAN_BONES;
  const P = burn ? BURN_POINTS : XUAN_POINTS;
  const group = new THREE.Group();
  group.name = burn ? 'qilin_burn_proc' : 'qilin_xuan_proc';
  parent.add(group);
  const J = buildJoints(B, group);
  const m = burn
    ? {
      body: std(0x2e1710, { emissive: 0xff5a14, ei: 0.55, rough: 0.8 }),
      dark: std(0x1e100b, { emissive: 0xc8380c, ei: 0.35, rough: 0.85 }),
      mane: std(0xff6a1a, { emissive: 0xff4a10, ei: 0.9, rough: 0.6 }),
      maneHot: std(0xffc040, { emissive: 0xffa020, ei: 1.0, rough: 0.5 }),
      horn: std(0x2a1a14, { emissive: 0xff7a20, ei: 0.4, rough: 0.5 }),
      hoof: std(0x1a0f0a, { rough: 0.7 }),
    }
    : {
      body: std(0x24211f, { emissive: 0xc0400e, ei: 0.22, rough: 0.6, metal: 0.4 }),
      dark: std(0x171513, { emissive: 0x8a2a08, ei: 0.18, rough: 0.65, metal: 0.4 }),
      mane: std(0xa8281a, { emissive: 0x5a1004, ei: 0.3, rough: 0.7 }),
      maneHot: std(0xe0601c, { emissive: 0xa03008, ei: 0.4, rough: 0.6 }),
      horn: std(0x1c1816, { emissive: 0xc04010, ei: 0.25, rough: 0.45 }),
      hoof: std(0x141210, { rough: 0.7 }),
    };
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const G = (j: string): THREE.Object3D => J.get(j)!;
  const put = (j: string, g: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Vector3, sx = 1, sy = 1, sz = 1, rx = 0): THREE.Mesh => {
    const q = local(B, j, p);
    return scaled(mesh(G(j), g, mat, q.x, q.y, q.z, rx), sx, sy, sz);
  };
  const fz = burn ? 0.35 : 0; // 焚身身体整体更靠前
  // 躯干：臀、腰、胸三段
  put('hips', geo.sphere(0.85, 9, 7), m.body, V(0, 2.6, -0.5 - fz * 0.2), 1, 1, 1.1);
  put('spine', geo.sphere(0.8, 9, 7), m.dark, V(0, 2.65, 0.35 + fz), 1, 0.95, 1.3);
  put('chest', geo.sphere(0.9, 9, 7), m.body, V(0, 2.65, 1.3 + fz), 1, 1.05, 1.1);
  // 颈：两段向前上方的粗圆柱
  const n1 = b2g(B.neck_1.head), n2 = b2g(B.neck_2.head), hd = b2g(B.head.head);
  rod(G('neck_1'), local(B, 'neck_1', n1.clone().add(V(0, -0.3, -0.1))), local(B, 'neck_1', n2), 0.7, 0.55, m.body);
  rod(G('neck_2'), local(B, 'neck_2', n2), local(B, 'neck_2', hd), 0.55, 0.45, m.dark);
  // 头：方颅 + 吻 + 下颌 + 独角 + 火珠 + 眉角
  const hc = new THREE.Vector3(...P.head.at);
  put('head', geo.box(0.8, 0.65, 0.9), m.dark, hc);
  put('head', geo.box(0.6, 0.4, 0.6), m.body, hc.clone().add(V(0, -0.05, 0.6)));
  put('jaw', geo.box(0.5, 0.18, 0.6), m.dark, hc.clone().add(V(0, -0.35, 0.5)));
  const horn = put('head', geo.cone(0.14, 1.3, 6), m.horn, V(0, 5.4, P.pearl.at[2] - 0.12));
  horn.rotation.x = -0.18;
  for (const s of [-1, 1]) put('head', geo.cone(0.08, 0.6, 4), m.horn, hc.clone().add(V(0.3 * s, 0.4, -0.35)), 1, 1, 1, -1.1);
  const pc = new THREE.Vector3(...P.pearl.at);
  const pq = local(B, 'pearl', pc);
  glowMesh(G('pearl'), geo.sphere(0.2, 10, 8), glow(0xffb040), pq.x, pq.y, pq.z, 'pearl');
  glowMesh(G('pearl'), geo.sphere(0.36, 10, 8), glow(0xff7a20, 0.35, true), pq.x, pq.y, pq.z, 'pearlHalo');
  if (burn && P.heart) {
    const h = local(B, 'chest', new THREE.Vector3(...P.heart.at));
    glowMesh(G('chest'), geo.sphere(0.36, 10, 8), glow(0xffd060), h.x, h.y, h.z, 'heart');
    glowMesh(G('chest'), geo.sphere(0.62, 10, 8), glow(0xff8a20, 0.35, true), h.x, h.y, h.z, 'heartHalo');
  }
  // 鬃：沿颈背的一排火焰锥
  const maneN = burn ? 9 : 7;
  for (let i = 0; i < maneN; i++) {
    const k = i / (maneN - 1);
    const j = k < 0.45 ? 'neck_1' : k < 0.85 ? 'neck_2' : 'head';
    const p = n1.clone().lerp(hd, k).add(V(0, 0.45, -0.45));
    const c = put(j, geo.cone(burn ? 0.38 : 0.3, burn ? 1.5 : 1.1, 5), i % 2 ? m.maneHot : m.mane, p);
    c.rotation.x = -0.9 - k * 0.3;
    c.rotation.z = ((i % 3) - 1) * 0.35;
  }
  // 腿：每段一根圆柱，蹄子方块
  for (const side of ['L', 'R'] as const) {
    for (const [a, b, c, d] of [['upperarm', 'forearm', 'fcannon', 'fhoof'], ['thigh', 'shin', 'hcannon', 'hhoof']] as const) {
      const chain = [a, b, c, d].map((n) => `${n}_${side}`);
      for (let i = 0; i < 3; i++) {
        const p0 = b2g(B[chain[i]].head), p1 = b2g(B[chain[i + 1]].head);
        rod(G(chain[i]), local(B, chain[i], p0), local(B, chain[i], p1), i === 0 ? 0.32 : 0.2, i === 0 ? 0.24 : 0.17, i === 0 ? m.body : m.dark);
      }
      const hoof = b2g(B[chain[3]].head);
      const foot = V(hoof.x, 0.12, hoof.z + 0.12);
      rod(G(chain[3]), local(B, chain[3], hoof), local(B, chain[3], foot), 0.17, 0.15, m.dark);
      put(chain[3], geo.box(0.34, 0.24, 0.42), m.hoof, foot.clone().setY(0.12));
      if (burn) {
        for (let k = 0; k < 3; k++) {
          const f = put(chain[3], geo.cone(0.18, 0.6, 5), k % 2 ? m.maneHot : m.mane, foot.clone().add(V(Math.sin(k * 2.1) * 0.25, 0.35, Math.cos(k * 2.1) * 0.25)));
          f.rotation.z = Math.sin(k * 2.1) * 0.5;
        }
      }
    }
  }
  // 尾：三节，尾穗一团火焰
  const t1 = b2g(B.tail_1.head), t2 = b2g(B.tail_2.head), t3 = b2g(B.tail_3.head);
  rod(G('tail_1'), local(B, 'tail_1', t1), local(B, 'tail_1', t2), 0.2, 0.14, m.dark);
  rod(G('tail_2'), local(B, 'tail_2', t2), local(B, 'tail_2', t3), 0.14, 0.12, m.dark);
  const tuft = burn ? 1.0 : 0.65;
  for (let k = 0; k < 5; k++) {
    const c = put('tail_3', geo.cone(tuft * 0.45, tuft * 1.8, 5), k % 2 ? m.maneHot : m.mane, t3.clone().add(V(Math.sin(k * 1.3) * 0.3, 0.6 + k * 0.2, -0.25 - k * 0.12)));
    c.rotation.x = -0.4 - k * 0.1;
  }
  return { group, joints: J };
}
