/**
 * 英雄展示：Tripo P2.0 原生骨骼模型（Mixamo 65 骨）。
 *
 * 资产由 art/pipeline/build_tripo_heroes.py 发布（public/assets/characters/SK_Hero_*.glb，清单
 * `skeleton.mode = 'native'`）：米制、脚底原点、面朝 +Z，SK_Hero_*_LOD0..2 三级蒙皮网格共用一套骨骼，
 * Draco + WebP，BC + ORM 贴图。这里直接驱动它自带的骨骼——不重定向到程序化骨架：
 *  - 待机：上身呼吸（Spine1/Spine2 前后、肩随呼吸起伏）与头部轻微环顾；骨盆、腿不动，脚不滑步。
 *  - 持枪：武器挂点（rig.hand）钉在角色空间的持枪位置；左右臂两骨 IK（肘部有明确的 pole）+ 腕部定向，
 *    再按实测的中指根关节把手掌对到握把，手指按各自的弯曲表握住枪、拇指逐关节靠向目标点。
 *  - 亮相：1.5 秒抬枪并回落。
 * 每个实例独占骨骼与材质克隆；几何体与贴图是资产库共享的，dispose 时不释放。
 * 模型加载失败 / 未发布时由 index.ts 回退到程序化模型。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { HeroRig } from './types';
import { SpringChain } from '../../../assets/SpringChain';
import { createPose, env, flyingSquirrelShow, pangolinShow, redPandaShow, type HeroShow, type Landmarks, type Vec } from './heroShows';
import { createShowFx } from './heroShowFx';

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const world = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());

/**
 * 枪位（长度按「1.6 米英雄」写，运行时乘 身高 / 1.6）：
 *  - ready：低位持枪的握把顶部（x、z 绝对，y 相对右肩）；yaw：低位时枪口斜向身体内侧的角度；
 *  - shoulder：扛肩时握把相对右肩；back：背枪时离胸骨向后的距离；
 *  - right / left / thumbR / thumbL：枪身坐标里的握点（+Z 枪口、+Y 枪背），随 scale 缩放；leftAcross / leftDistal：托枪手掌朝向。
 * scale：Q 版英雄的手和头偏大，原尺寸的枪握在手里像玩具（v2 首版检查发现），整体放大。
 */
type V3 = readonly [number, number, number];
const GUN_LAYOUT: Record<string, {
  scale: number; ready: V3; yaw: number; shoulder: V3; back: number;
  right: V3; left: V3; thumbR: V3; thumbL: V3; leftAcross: V3; leftDistal: V3;
}> = {
  fox: {
    scale: 1.4, ready: [-0.17, -0.2, 0.3], yaw: 1.05, shoulder: [-0.06, -0.3, 0.16], back: 0.26,
    right: [-0.035, -0.06, -0.027], left: [0.035, -0.022, 0.235], thumbR: [0.018, -0.012, -0.015], thumbL: [-0.025, 0.035, 0.21],
    leftAcross: [0, 0, 1], leftDistal: [-1, 0, 0],
  },
  bear: {
    scale: 1.35, ready: [-0.2, -0.1, 0.42], yaw: 1.2, shoulder: [-0.07, -0.32, 0.18], back: 0.3,
    right: [-0.035, -0.06, -0.027], left: [0.035, -0.022, 0.3], thumbR: [0.018, -0.012, -0.015], thumbL: [-0.025, 0.035, 0.275],
    leftAcross: [0, 0, 1], leftDistal: [-1, 0, 0],
  },
  falcon: {
    scale: 1.35, ready: [-0.11, -0.13, 0.3], yaw: 0.7, shoulder: [-0.06, -0.3, 0.16], back: 0.24,
    right: [-0.035, -0.06, -0.027], left: [0.042, -0.07, -0.015], thumbR: [0.018, -0.012, -0.015], thumbL: [0.033, 0.004, -0.006],
    leftAcross: [0, 1, 0], leftDistal: [0, 0, 1],
  },
};
/** 转枪的转轴：扳机护圈（枪身坐标，+Z 枪口、+Y 枪背），食指勾住的位置 */
const TRIGGER = [0, -0.035, 0.04] as const;
/** 空手目标的平滑时间常数（秒） */
const FREE_HAND_TAU = 0.05;
/** 三位英雄的演出（heroShows.ts）：内部 id 不变，fox = 燎、bear = 磐、falcon = 鼯 */
const SHOWS: Record<string, (L: Landmarks) => HeroShow> = { fox: redPandaShow, bear: pangolinShow, falcon: flyingSquirrelShow };
export const NATIVE_HERO_IDS = ['fox', 'falcon', 'bear'] as const;

export interface NativeHeroOptions {
  /** 各级 LOD 的切换距离（米）；缺省 [0, 10, 24] */
  lodDistance?: readonly number[];
  /** 资产标称身高（米）。缺省按 LOD0 包围盒实测；源模型不是米制时会按它缩放 */
  height?: number;
}

/** 取模板里按 _LOD<n> 命名的蒙皮网格；没有命名 LOD 时退回全部蒙皮网格（原始 Tripo 导出只有一个） */
function lodMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const named: THREE.SkinnedMesh[] = [];
  const all: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    all.push(m);
    const k = /_LOD(\d+)$/.exec(m.name);
    if (k) named[Number(k[1])] = m;
  });
  return named.length && named.every(Boolean) ? named : all.slice(0, 1);
}

/**
 * 由已加载的 glTF 场景（资产库共享模板）建一个独立实例。模板不被修改。
 * @returns 模板缺少必需的 Mixamo 关节时返回 null（调用方回退到程序化模型）
 */
export function createNativeHero(id: string, template: THREE.Object3D, options: NativeHeroOptions = {}): HeroRig | null {
  const model = clone(template) as THREE.Group;
  model.updateMatrixWorld(true);
  const meshes = lodMeshes(model);
  if (!meshes.length) return null;
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig[:_]?/, ''), o as THREE.Bone);
  });
  const required = ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head'];
  for (const side of ['Left', 'Right']) {
    required.push(`${side}Arm`, `${side}ForeArm`, `${side}Hand`);
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let j = 1; j <= 3; j++) required.push(`${side}Hand${f}${j}`);
    for (let j = 1; j <= 4; j++) required.push(`${side}HandThumb${j}`);
  }
  const missing = required.filter((n) => !bones.has(n));
  if (missing.length) {
    console.warn(`[heroes] ${id}: native skeleton lacks ${missing.join(', ')}`);
    return null;
  }

  const root = new THREE.Group();
  root.name = `native-hero-${id}`;
  root.add(model);
  // 只按 LOD0 的绑定姿势量尺寸：发布资产已是米制（缩放 1），原始 Tripo 导出（约 1 单位高）在这里换算
  const bounds = new THREE.Box3().setFromObject(meshes[0]);
  const measured = bounds.max.y - bounds.min.y;
  const height = options.height ?? measured;
  if (Math.abs(measured - height) > height * 0.01) {
    model.scale.multiplyScalar(height / measured);
    model.position.y -= bounds.min.y * model.scale.y;
  }
  root.updateMatrixWorld(true);

  // 材质每实例克隆（预览台会改透明度做淡入淡出）；贴图共享
  const materials: THREE.Material[] = [];
  const cloned = new Map<THREE.Material, THREE.Material>();
  const adopt = (m: THREE.Material): THREE.Material => {
    let c = cloned.get(m);
    if (!c) {
      c = m.clone();
      cloned.set(m, c);
      materials.push(c);
    }
    return c;
  };
  const distances = options.lodDistance ?? [0, 10, 24];
  const lod = new THREE.LOD();
  lod.name = `native-hero-${id}-lod`;
  meshes[0].parent!.add(lod);
  lod.position.copy(meshes[0].position);
  lod.quaternion.copy(meshes[0].quaternion);
  lod.scale.copy(meshes[0].scale);
  meshes.forEach((mesh, i) => {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adopt) : adopt(mesh.material);
    mesh.castShadow = true;
    // IK 会把手臂从 T 形绑定姿势收回胸前：包围体按绑定姿势算会偏，展示模型始终在镜头中，不做视锥剔除
    mesh.frustumCulled = false;
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    lod.addLevel(mesh, distances[i] ?? i * 12);
    mesh.visible = i === 0; // 首帧（渲染器尚未更新 LOD 前）只显示 / 量测 LOD0
  });
  root.updateMatrixWorld(true);

  const bone = (name: string): THREE.Bone => bones.get(name)!;
  const rest = new Map([...bones.values()].map((b) => [b, b.quaternion.clone()]));
  const hand = new THREE.Group();
  hand.name = 'native-weapon-socket';
  root.add(hand);
  const setWorldQ = (b: THREE.Bone, q: THREE.Quaternion): void => {
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    b.updateWorldMatrix(false, true);
  };
  const rotateWorld = (b: THREE.Bone, axis: THREE.Vector3, angle: number): void => {
    setWorldQ(b, new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  };
  const pointBone = (b: THREE.Bone, child: THREE.Bone, target: THREE.Vector3): void => {
    const origin = world(b);
    const from = world(child).sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    setWorldQ(b, new THREE.Quaternion().setFromUnitVectors(from, to).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  };
  const frame = (across: THREE.Vector3, distal: THREE.Vector3): THREE.Quaternion => {
    distal.normalize();
    across.addScaledVector(distal, -across.dot(distal)).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, distal, across.clone().cross(distal)));
  };
  root.userData.gripAudit = {};
  /**
   * 两骨手臂 IK：手腕到 target，肘部朝 pole 所在的半平面。
   * 手腕朝向：grip = 1 时让手掌按 (across, distal) 对齐（握枪）；grip = 0 时手腕保持绑定姿势相对前臂的自然角度
   * （空手时不硬拧手腕）；两者之间 slerp。Mixamo 没有前臂旋转骨：手腕绕前臂轴的扭转有一半分给前臂骨，
   * 不然手腕处的蒙皮会拧成糖纸。
   */
  function solve(side: string, target: THREE.Vector3, pole: THREE.Vector3, across: THREE.Vector3, distal: THREE.Vector3, grip = 1): void {
    const upper = bone(`${side}Arm`), lower = bone(`${side}ForeArm`), wrist = bone(`${side}Hand`);
    const s = world(upper), e = world(lower), w = world(wrist);
    const a = s.distanceTo(e), b = e.distanceTo(w);
    const dir = target.clone().sub(s);
    const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 0.001, a + b - 0.002);
    dir.normalize();
    const bend = pole.clone().sub(s);
    bend.addScaledVector(dir, -bend.dot(dir)).normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const elbow = s.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    pointBone(upper, lower, elbow);
    pointBone(lower, wrist, s.clone().addScaledVector(dir, d));
    const natural = wrist.getWorldQuaternion(new THREE.Quaternion());
    let want = natural.clone();
    if (grip > 0.001) {
      const current = frame(world(bone(`${side}HandIndex1`)).sub(world(bone(`${side}HandPinky1`))), world(bone(`${side}HandMiddle1`)).sub(world(wrist)));
      const aligned = frame(across, distal).multiply(current.invert()).multiply(natural);
      want = natural.clone().slerp(aligned, Math.min(1, grip));
    }
    // swing–twist：绕前臂轴的扭转一半交给前臂骨（转轴过肘和腕，手腕位置不变）
    const f = world(wrist).sub(world(lower)).normalize();
    const delta = want.clone().multiply(natural.clone().invert());
    const proj = delta.x * f.x + delta.y * f.y + delta.z * f.z;
    const twist = 2 * Math.atan2(proj, delta.w);
    if (Math.abs(twist) > 1e-3) rotateWorld(lower, f, 0.5 * THREE.MathUtils.clamp(twist, -1.6, 1.6));
    setWorldQ(wrist, want);
    root.userData.gripAudit[side] = { wristError: world(wrist).distanceTo(target), reach: a + b, requestedReach: target.distanceTo(s) };
  }
  /** 两骨 IK（腿）：end 放到 target，膝盖朝 pole */
  function twoBone(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
    const s0 = world(upper), e0 = world(lower), w0 = world(end);
    const a = s0.distanceTo(e0), b = e0.distanceTo(w0);
    const dir = target.clone().sub(s0);
    const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    dir.normalize();
    const bend = pole.clone().sub(s0);
    bend.addScaledVector(dir, -bend.dot(dir)).normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const knee = s0.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    pointBone(upper, lower, knee);
    pointBone(lower, end, s0.clone().addScaledVector(dir, d));
  }
  /** 手指：握枪弯曲表（gun = 1）与空手的张开 / 握拳（curl）之间插值 */
  function fingers(side: string, axis: THREE.Vector3, gun: number, curl: number): void {
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) for (let joint = 1; joint <= 3; joint++) {
      const f = bone(`${side}Hand${finger}${joint}`);
      // 扳机指沿护圈伸直；托枪手按枪型握紧
      const grip = side === 'Right' && finger === 'Index' ? [0, 0.12, 0.28, 0.25]
        : side === 'Left' && id !== 'falcon' ? [0, 0.35, 0.75, 0.85] : [0, 0.5, 1.05, 1.05];
      const free = [0, 0.15 + 0.85 * curl, 0.2 + 1.0 * curl, 0.15 + 0.9 * curl];
      rotateWorld(f, axis, (grip[joint] * gun + free[joint] * (1 - gun)) * (side === 'Right' ? 1 : -1));
    }
  }
  function palm(side: string, desired: THREE.Vector3, pole: THREE.Vector3, across: THREE.Vector3, distal: THREE.Vector3, gun: number, curl: number): void {
    // 先定腕部朝向，再按实测的中指根关节（而不是假设的手长）把手掌对到接触点
    const wrist = bone(`${side}Hand`);
    solve(side, world(wrist), pole, across.clone(), distal.clone(), gun);
    const target = world(wrist).add(desired.clone().sub(world(bone(`${side}HandMiddle1`))));
    solve(side, target, pole, across.clone(), distal.clone(), gun);
    fingers(side, across.clone().normalize(), gun, curl);
    root.userData.gripAudit[side].knuckleError = world(bone(`${side}HandMiddle1`)).distanceTo(desired);
  }
  function thumb(side: string, target: THREE.Vector3): void {
    const tip = bone(`${side}HandThumb4`);
    for (let iteration = 0; iteration < 6; iteration++) for (let joint = 3; joint >= 1; joint--) {
      const b = bone(`${side}HandThumb${joint}`), origin = world(b);
      const q = new THREE.Quaternion().setFromUnitVectors(world(tip).sub(origin).normalize(), target.clone().sub(origin).normalize());
      const limited = new THREE.Quaternion().slerp(q, Math.min(1, 0.18 / Math.max(0.001, q.angleTo(new THREE.Quaternion()))));
      setWorldQ(b, limited.multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    }
  }

  // ───────────── 演出（heroShows.ts）：地标、枪位、弹簧骨骼 ─────────────
  const local = (b: THREE.Bone): THREE.Vector3 => root.worldToLocal(world(b));
  const asVec = (p: THREE.Vector3): Vec => [p.x, p.y, p.z];
  const s = height / 1.6;
  const L: Landmarks = {
    s,
    shoulderL: asVec(local(bone('LeftArm'))), shoulderR: asVec(local(bone('RightArm'))),
    hipL: asVec(local(bone('LeftUpLeg'))), hipR: asVec(local(bone('RightUpLeg'))),
    chest: asVec(local(bone('Spine2'))), head: asVec(local(bone('Head'))),
  };
  const show = (SHOWS[id] ?? SHOWS.fox)(L);
  const P = createPose();
  const rootInv0 = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const legs = (['Left', 'Right'] as const).map((side) => {
    const foot = bone(`${side}Foot`);
    return {
      side, up: bone(`${side}UpLeg`), low: bone(`${side}Leg`), foot,
      rest: local(foot), knee: local(bone(`${side}Leg`)), q: rootInv0.clone().multiply(foot.getWorldQuaternion(new THREE.Quaternion())),
    };
  });
  const hips = bone('Hips');
  const hipsRest = hips.position.clone();
  const hipsY = local(hips).y;
  const modelPos0 = model.position.clone();
  const modelQ0 = model.quaternion.clone();
  const tailBones: THREE.Bone[] = [];
  for (let i = 1; bones.has(`tail_${i}`); i++) tailBones.push(bones.get(`tail_${i}`)!);
  const springs: SpringChain[] = [];
  if (tailBones.length) springs.push(new SpringChain(tailBones, { stiffness: [9, 6.5, 5, 3.8, 2.8, 2.2, 1.8], drag: 0.22, gravity: 0.12, maxBend: 0.3 }));
  const ears = ['ear_L', 'ear_R'].filter((n) => bones.has(n)).map((n) => bones.get(n)!);
  for (const e of ears) springs.push(new SpringChain([e], { stiffness: [16], drag: 0.3, gravity: 0, maxBend: 0.35, tipLength: 0.08 * s }));
  const fx = createShowFx(id, root, bone, s, materials);

  // 枪位（角色坐标）：低位持枪（各英雄原有的握持）、扛肩、背在背后；hand 挂点 = 握把顶部，本地 −Z 为枪口
  const GUN = GUN_LAYOUT[id] ?? GUN_LAYOUT.fox;
  hand.scale.setScalar(GUN.scale);
  const qLook = (fwd: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion => {
    const z = fwd.clone().normalize();
    const x = up.clone().cross(z).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, z.clone().cross(x), z));
  };
  const _bodyQ = new THREE.Quaternion();
  const _rootQ = new THREE.Quaternion();
  const _poseQ = new THREE.Quaternion();
  const _pivot = new THREE.Vector3();
  /** 角色坐标（绑定姿势参照）→ root 本地：加上入场时的整体位移 / 转动（转轴在髋的高度） */
  const poseToRoot = (p: THREE.Vector3): THREE.Vector3 => p.sub(_pivot).applyQuaternion(_poseQ).add(_pivot).add(v(P.root.x, P.root.y, P.root.z));
  const toWorld = (p: THREE.Vector3): THREE.Vector3 => root.localToWorld(poseToRoot(p));
  const dirW = (p: THREE.Vector3): THREE.Vector3 => p.applyQuaternion(_bodyQ);
  /** 骨骼当前位置换回角色坐标（去掉入场位移 / 转动） */
  const live = (b: THREE.Bone): THREE.Vector3 => {
    const p = root.worldToLocal(world(b)).sub(v(P.root.x, P.root.y, P.root.z)).sub(_pivot);
    return p.applyQuaternion(_poseQ.clone().invert()).add(_pivot);
  };
  fx.bind({ toWorld: (p) => toWorld(p), live, gunWorld: () => hand });

  const freeHand: Record<string, { p: THREE.Vector3; live: boolean }> = { Left: { p: v(0, 0, 0), live: false }, Right: { p: v(0, 0, 0), live: false } };
  let intro = -1;
  let fidget: { index: number; u: number } | null = null;
  let nextFidget = 4;
  let lastFidget = -1;
  let seed = 1 + id.length * 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const update = (dt: number, t: number): void => {
    // ── 时间：出场 / 小动作调度（出场中不插小动作）
    if (intro >= 0) {
      intro += dt;
      if (intro > show.intro) {
        intro = -1;
        nextFidget = t + 3;
      }
    }
    const forced = root.userData.forceFidget as { index: number; u: number } | undefined;
    if (forced) fidget = { ...forced };
    else if (fidget) {
      fidget.u += dt;
      if (fidget.u >= show.fidgets[fidget.index]) {
        fidget = null;
        nextFidget = t + show.fidgetGap[0] + rand() * (show.fidgetGap[1] - show.fidgetGap[0]);
      }
    } else if (intro < 0 && t >= nextFidget && show.fidgets.length) {
      let i = Math.floor(rand() * show.fidgets.length);
      if (i === lastFidget) i = (i + 1) % show.fidgets.length;
      lastFidget = i;
      fidget = { index: i, u: 0 };
    }
    const fid = fidget && intro < 0
      ? { ...fidget, w: env(fidget.u, 0, 0.3, show.fidgets[fidget.index] - 0.3, show.fidgets[fidget.index]) } : null;
    show.pose(P, intro, t, fid);

    // ── 复位到绑定姿势，摆整体位移 / 转动
    for (const [b, q] of rest) b.quaternion.copy(q);
    hips.position.copy(hipsRest);
    _pivot.set(0, hipsY, 0);
    _poseQ.setFromEuler(new THREE.Euler(P.root.pitch, P.root.yaw, -P.root.roll, 'YXZ'));
    model.quaternion.copy(_poseQ).multiply(modelQ0);
    model.position.copy(poseToRoot(modelPos0.clone()));
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(_rootQ);
    _bodyQ.copy(_rootQ).multiply(_poseQ);
    const X = dirW(v(1, 0, 0)), Y = dirW(v(0, 1, 0)), Z = dirW(v(0, 0, 1));

    // ── 髋：下沉 / 侧移 / 转动；腿用 IK 钉住脚，脚掌保持绑定时的朝向
    const hw = toWorld(live(hips).add(v(P.hips.x, -P.hips.drop, 0)));
    hips.position.copy(hips.parent!.worldToLocal(hw));
    hips.updateWorldMatrix(false, true);
    rotateWorld(hips, Y, P.hips.yaw);
    rotateWorld(hips, X, P.hips.pitch);
    rotateWorld(hips, Z, -P.hips.roll);
    for (const g of legs) {
      const off = g.side === 'Left' ? P.footL : P.footR;
      const target = toWorld(g.rest.clone().add(v(off[0], off[1], off[2])));
      const pole = toWorld(g.knee.clone().add(v(off[0], 0, 0.5 * s)));
      twoBone(g.up, g.low, g.foot, target, pole);
      setWorldQ(g.foot, _bodyQ.clone().multiply(g.q));
    }

    // ── 躯干 / 脖子 / 头
    for (const [n, w] of [['Spine', 0.3], ['Spine1', 0.35], ['Spine2', 0.35]] as const) {
      if (!bones.has(n)) continue;
      rotateWorld(bone(n), Y, P.spine[1] * w);
      rotateWorld(bone(n), X, P.spine[0] * w);
      rotateWorld(bone(n), Z, -P.spine[2] * w);
    }
    rotateWorld(bone('Neck'), Y, P.neck[1]);
    rotateWorld(bone('Neck'), X, P.neck[0]);
    rotateWorld(bone('Head'), Y, P.head[1]);
    rotateWorld(bone('Head'), X, P.head[0]);
    rotateWorld(bone('Head'), Z, -P.head[2]);

    // ── 枪位：三个位置按权重混合，再绕扳机护圈转 spin
    const shR = live(bone('RightArm'));
    const chest = live(bone('Spine2'));
    const readyP = v(GUN.ready[0] * s, shR.y + GUN.ready[1] * s, GUN.ready[2] * s);
    const readyQ = new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), GUN.yaw);
    const shoulderP = shR.clone().add(v(GUN.shoulder[0] * s, GUN.shoulder[1] * s, GUN.shoulder[2] * s));
    // 枪口朝天：握把在胸前右侧，枪管贴着右肩前方竖直向上、略朝外（避开 Q 版的大头）、略朝前；枪背朝向角色。
    // （v2 首版是握把在腰、枪管朝后上方越过肩膀，用户看成「枪拿反了」）
    const shoulderQ = qLook(v(-0.32, 0.9, 0.28), v(0.25, 0.25, -0.93));
    const backP = chest.clone().add(v(0.04 * s, 0.06 * s, -GUN.back * s));
    const backQ = qLook(v(-0.5, 0.86, 0), v(0, 0, -1));
    const gp = readyP.clone().lerp(shoulderP, P.gun.shoulder).lerp(backP, P.gun.back);
    gp.y += P.gun.lift;
    const gq = readyQ.clone().slerp(shoulderQ, P.gun.shoulder).slerp(backQ, P.gun.back);
    // 转枪：手不动，枪绕扳机护圈（食指勾住的位置）转——手的握点按不转的枪算
    const spinQ = gq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), P.gun.spin));
    const pivot = v(...TRIGGER).multiplyScalar(GUN.scale);
    const spinP = gp.clone().add(pivot.clone().applyQuaternion(gq)).sub(pivot.clone().applyQuaternion(spinQ));
    hand.position.copy(poseToRoot(spinP.clone()));
    hand.quaternion.copy(_poseQ).multiply(spinQ).multiply(new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI));
    hand.updateWorldMatrix(true, true);
    const gw = _bodyQ.clone().multiply(gq);
    const gunPt = (o: readonly number[]): THREE.Vector3 => toWorld(gp.clone().add(v(o[0], o[1], o[2]).multiplyScalar(GUN.scale).applyQuaternion(gq)));
    const gunAx = (a: readonly [number, number, number]): THREE.Vector3 => v(a[0], a[1], a[2]).applyQuaternion(gw);

    // ── 双手：握枪点与空手目标之间插值；肘部朝向同样插值
    const arms = [
      { side: 'Right', A: P.right, grip: GUN.right, pole: v(-0.5 * s, shR.y - 0.5 * s, -0.15 * s), across: gunAx([0, 1, 0]), distal: gunAx([0, 0, 1]), thumb: GUN.thumbR },
      { side: 'Left', A: P.left, grip: GUN.left, pole: v(0.45 * s, shR.y - 0.45 * s, 0.05 * s), across: gunAx(GUN.leftAcross), distal: gunAx(GUN.leftDistal), thumb: GUN.thumbL },
    ] as const;
    const k = 1 - Math.exp(-Math.max(dt, 0) / FREE_HAND_TAU);
    for (const a of arms) {
      const g = THREE.MathUtils.clamp(a.A.onGun, 0, 1);
      const sh = live(bone(`${a.side}Arm`));
      // 空手目标在角色坐标里做一阶平滑（吸收时间线里的跳变）；握枪时手直接跟枪
      const sm = freeHand[a.side];
      const raw = v(...a.A.target);
      if (!sm.live || dt <= 0 || sm.p.distanceTo(raw) > 0.6 * s) sm.p.copy(raw);
      else sm.p.lerp(raw, k);
      sm.live = true;
      const freeT = sm.p.clone();
      const freeAcross = Y.clone().addScaledVector(Z, 0.3).normalize();
      const freeDistal = dirW(freeT.clone().sub(sh).normalize());
      const desired = g > 0.999 ? gunPt(a.grip) : g < 0.001 ? toWorld(freeT.clone()) : gunPt(a.grip).lerp(toWorld(freeT.clone()), 1 - g);
      // 肘部：空手时一律朝外、朝下、略朝后（不跟着每个姿势手写的方向走，握枪 / 空手切换时不会翻面）
      const out = a.side === 'Left' ? 1 : -1;
      const autoPole = sh.clone().add(v(0.55 * out, -0.75, -0.35).multiplyScalar(0.5 * s));
      const pole = toWorld(a.pole.clone().lerp(autoPole, 1 - g));
      const across = a.across.clone().lerp(freeAcross, 1 - g).normalize();
      const distal = a.distal.clone().lerp(freeDistal, 1 - g).normalize();
      palm(a.side, desired, pole, across, distal, g, a.A.curl);
      if (g > 0.5) thumb(a.side, gunPt(a.thumb));
    }

    // ── 尾巴 / 耳朵：先摆意图姿势，再交给弹簧骨骼算惯性
    const n = tailBones.length;
    tailBones.forEach((b, i) => {
      rotateWorld(b, Y, -(P.tail.yaw / n + P.tail.wave * Math.sin(P.tail.phase - i * 0.8)));
      rotateWorld(b, X, P.tail.pitch / n + P.tail.curl * i);
    });
    if (ears[0]) rotateWorld(ears[0], X, -P.earL);
    if (ears[1]) rotateWorld(ears[1], X, -P.earR);
    root.updateMatrixWorld(true);
    for (const sp of springs) sp.step(dt);

    fx.update(P, dt, t);
    root.updateMatrixWorld(true);
    // 骨骼矩阵立刻刷新：预览台用 getVertexPosition 量取景范围，要拿到本帧的蒙皮结果
    for (const level of lod.levels) (level.object as THREE.SkinnedMesh).skeleton.update();
  };
  update(0, 0);
  return {
    root,
    height,
    hand,
    materials,
    show: { entrance: show.entrance, intro: show.intro, frameFrom: show.frameFrom },
    update,
    playIntro: () => {
      intro = 0;
      fidget = null;
      fx.reset();
      for (const sp of springs) sp.reset();
      freeHand.Left.live = freeHand.Right.live = false;
    },
    dispose: () => {
      fx.dispose();
      for (const level of lod.levels) (level.object as THREE.SkinnedMesh).skeleton.dispose();
      for (const m of materials) m.dispose();
      root.removeFromParent();
    },
  };
}

/** 开发 / 测试用：从 URL（可为 data: URL）加载一个 Tripo 英雄 GLB 并建实例。Draco 资产需传入 loader */
export async function loadNativeHero(id: string, url: string, options: NativeHeroOptions = {}, loader = new GLTFLoader()): Promise<HeroRig> {
  const gltf = await loader.loadAsync(url);
  const rig = createNativeHero(id, gltf.scene, options);
  if (!rig) throw new Error(`${url}: not a native hero skeleton`);
  return rig;
}
