/**
 * 碎刃 v2 的第一人称表现（docs/demon-blade-v2.md 第 9 节；M10 照 Unity BladeView.cs / BladeSwing.cs 补齐）：持刀姿态、三段斩、剑指手势、刀身上的碎片与刀光。
 *
 * - 姿态用「手的位置 + 刀尖方向 + 刃口方向」关键帧描述（相机空间），三段斩每段 [蓄势, 出刀（判定帧）, 收势]：
 *   [0, a) 从当前姿态平滑转到蓄势（a = 判定帧 × 0.55）；[a, h) 蓄势 → 出刀加速（t²）；[h, 1] 出刀 → 收势缓出。
 *   Unity 把这条时间线烘成剪辑（BladeSwingClip，采样之间线性插值，测试核对过和解析时间线处处吻合），网页直接求解析式。
 * - 剪辑的三个事件按视觉进度越过它们时派发：出刀（刀光起，另起一条）/ 判定帧（刃口白热一闪、甩出碎刃火星、镜头朝挥动方向轻轻一带）/ 收势（刀光止）。
 * - 命中：视觉进度停 40 ms（第三段 70 ms，真实时间），刀身闪亮，枪模弹簧往回一磕（onKick）。
 * - 伸刃：剪辑给这一段的伸长（第三段 2.2，刀根 0.09 以内不动），人刀合一常态伸长 1.3 × 强度叠在上面。
 * - 剑指 / 立掌 / 举手：右手收刀到手势姿态（0.14 s），左手从画面下方抬进来（美术手臂整块网格没有手指骨骼：拳头前沿补两根伸直并拢的手指，
 *   BladeSwordSign；整只手按「手指指向 + 前臂朝画面左下」摆），剑指时指尖亮一点灵光。
 * - 碎片：刃群模块（BladeSwarm）记录每片在手里还是在外面；在手里的按原位显示，伸刃时沿刀线展开并带一点横向错动；刚归位的放大一下再落回，
 *   归位闪按刀身六段各合成一颗光点（BladeGlints）。
 * - 刀光：BladeTrail（刀身 35% 处 → 伸长后的刀尖，亮度跟刀尖速度走，墨笔起收锋）。
 * - 交接：homeWorld 把碎片在第一人称刀身上的位置换算到主场景（两台相机 FOV 不同，按屏幕位置对齐），刃群从这里出发、回到这里。
 * Viewmodel 负责呼吸 / 晃动等通用摆动（碎刃的 Sway：枪重 0.85）并把 pose() 的结果叠到枢轴上，再调用 animate()。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { LoadedAsset } from '../../assets/AssetLibrary';
import { applyArtEnvironment } from '../../assets/ArtEnvironment';
import { attachStaticPart } from '../../assets/StaticAttachment';
import { clamp01, DEG } from '../../core/math';
import { bladeCells, BLADE_LEN, rootBoundaryY, SHARD_COUNT, spineX } from './BladeShape';
import { BLADE_PURPLE, buildDemonBlade, GRIP_Y, type DemonBladeModel } from './BladeModel';
import { SHARD_HOME, type BladeSwarm, type ShardHomeProvider } from './BladeSwarm';
import { BladeTrail } from './BladeTrail';
import { BladeGlints } from './BladeGlints';
import { buildSwordSign, indexTip, swordSignFit, type SwordSignFit } from './BladeSwordSign';

/** 剑指等手势 */
export type BladeGesture = 'none' | 'point' | 'shield' | 'raise';

/** 当前挥砍段的武器表条目（时长 / 判定帧 / 伸刃） */
export interface BladeSlashSpec {
  windup: number;
  duration: number;
  stretch: number;
}

/** 控制器每帧交给第一人称的状态（Unity BladePose） */
export interface BladePoseInput {
  /** 当前挥砍段（−1 = 不在挥砍）与进度、判定帧位置 */
  swing: number;
  swingP: number;
  hitP: number;
  /** 当前挥砍段的武器表条目（不在挥砍时为 null） */
  slash: BladeSlashSpec | null;
  /** 人刀合一时刀身的常态伸长倍率（武器表 union.stretch，1.3）；乘 union 生效 */
  unionStretch: number;
  gesture: BladeGesture;
  /** 人刀合一强度 0..1、鬼眼 0..1、刃气 0..1 */
  union: number;
  eye: number;
  qi: number;
}

export function createBladePoseInput(): BladePoseInput {
  return { swing: -1, swingP: 0, hitP: 0.3, slash: null, unionStretch: 1.3, gesture: 'none', union: 0, eye: 0, qi: 1 };
}

/** 关键帧：手（握持点）的相机空间位置、刀尖方向、刃口方向 */
interface Key {
  p: readonly [number, number, number];
  d: readonly [number, number, number];
  e: readonly [number, number, number];
}

const K = (p: Key['p'], d: Key['d'], e: Key['e']): Key => ({ p, d, e });

/** 待机：右下握刀（拳在画面内），刀身斜立在画面右侧，刃口朝左，刀面朝向镜头，能看到碎片与鬼面 */
export const IDLE = K([0.25, -0.22, -0.5], [-0.28, 0.82, -0.5], [-0.92, -0.1, 0.38]);
/** 剑指（千刃出窍 / 杀气爆发）：右拳收在右下、刀根斜指前方，鬼面朝镜头（击杀时能看到睁眼），画面中央让给左手与刃群 */
export const POINT = K([0.26, -0.22, -0.46], [-0.18, 0.5, -0.85], [-0.76, -0.53, -0.17]);
/** 碎刃屏障：刀柄横在身前（刀身已散成圆盾） */
export const SHIELD = K([0.12, -0.2, -0.4], [-0.9, 0.25, -0.3], [0, 0, -1]);
/** 杀气爆发起手：刀柄高举 */
export const RAISE = K([0.22, -0.12, -0.42], [-0.2, 0.95, -0.2], [-0.6, 0, -0.8]);

/** 右肘在相机空间的位置（前臂从手腕指向这里，画面右下角之外） */
const R_ELBOW = new THREE.Vector3(0.46, -0.66, 0.02);
/** 右手腕在刀身坐标里的位置（握持点沿刀柄向下一点，乘刀模缩放前） */
const R_WRIST = new THREE.Vector3(0.012, -0.05, 0.004);

/**
 * 英雄美术手臂（SM_Arms_<英雄><R|L>，握枪姿势建模）在各自挂点空间里的关键量：
 * 右手拳心（Unity 按网格截面量过：握把孔的中心比原值再偏 1.5 cm，刀柄才真的穿在拳心里）、握把轴（握枪时手枪握把的方向）、前臂方向；左手前臂方向。
 */
const ART_R_FIST = new THREE.Vector3(0.018, -0.05, 0.034);
const ART_R_GRIP = new THREE.Vector3(0, 0.955, -0.296).normalize();
const ART_R_FORE = new THREE.Vector3(0.1, -0.21, 0.3).normalize();
export const ART_L_FORE = new THREE.Vector3(-0.17, -0.26, 0.3).normalize();
/** 左手臂缩放（同枪的第一人称 rig：手臂跟着枪模缩 0.76） */
const LEFT_ARM_SCALE = 0.76;

/**
 * 美术左手的手势（相机空间，Unity BladeView.LeftPoint / LeftSeal / LeftRaise，z 取反）：手掌原点、剑指手指方向、前臂大致朝向（只定绕手指的翻转）。
 * 剑指 = 手指斜指前上方、略偏画面中心（指挥刃群）；立掌（屏障）= 手指竖直朝上（单手剑诀）；举手（聚合）= 更高、更竖
 */
interface LeftPose { palm: THREE.Vector3; fingers: THREE.Vector3; fore: THREE.Vector3 }
const LP = (p: [number, number, number], f: [number, number, number], o: [number, number, number]): LeftPose => ({
  palm: new THREE.Vector3(p[0], p[1], -p[2]), fingers: new THREE.Vector3(f[0], f[1], -f[2]).normalize(), fore: new THREE.Vector3(o[0], o[1], -o[2]).normalize(),
});
export const LEFT_ART: Readonly<Record<'point' | 'seal' | 'raise', LeftPose>> = {
  point: LP([-0.21, -0.135, 0.5], [0.5, 0.6, 0.62], [-0.3, -0.55, -0.78]),
  seal: LP([-0.2, -0.14, 0.48], [0.12, 0.97, 0.2], [-0.2, -0.55, -0.8]),
  raise: LP([-0.2, -0.08, 0.5], [0.2, 0.85, 0.5], [-0.25, -0.7, -0.65]),
};

/** 程序化左手（没有美术手臂时）：剑指（手指方向、掌背朝向）、立掌、前臂（d = 从手腕伸向肘部的反方向，前臂沿 −d 伸出） */
const LEFT_POINT = K([0, 0, 0], [0.3, 0.3, -0.9], [0.1, 0.95, 0.3]);
const LEFT_PALM = K([0, 0, 0], [0.1, 0.95, -0.3], [0.95, 0, 0.3]);
const LEFT_FORE = K([0, 0, 0], [0.35, 0.85, -0.4], [1, 0, 0.3]);

/**
 * 三段斩的关键帧 [蓄势, 出刀（判定帧）, 收势]：
 * 0 右上 → 左下斜斩；1 左 → 右回斩；2 伸刃：从右侧大幅横扫到左侧，刀身伸长。
 * 第三段照 Unity 改过（原来刀面完全水平、又在眼睛下方十几厘米平视，伸长的刀身和刀光都只剩一条线）：刃口朝下压、刀尖略低，刀面朝镜头侧倾约 35°。
 * 约束（16:9 与 4:3 都按 60° 视模相机逐帧投影核对过）：握刀点始终在画面内；刀尖整段都朝前（不转向镜头）；判定帧时刀身穿过画面中部。
 */
export const SWINGS: readonly (readonly [Key, Key, Key])[] = [
  [
    K([0.24, 0, -0.48], [0.3, 0.85, -0.15], [-0.75, 0.2, -0.6]),
    K([0.1, -0.12, -0.5], [-0.62, -0.35, -0.7], [-0.3, -0.9, 0.3]),
    K([-0.1, -0.19, -0.47], [-0.75, -0.25, -0.6], [-0.3, -0.85, 0.3]),
  ],
  [
    K([-0.14, -0.15, -0.46], [-0.85, 0.3, -0.1], [0.3, 0.2, -0.9]),
    K([0.06, -0.14, -0.5], [-0.5, 0.4, -0.77], [0.82, 0.1, -0.56]),
    K([0.28, -0.17, -0.44], [0.55, 0.35, -0.75], [0.75, -0.1, 0.6]),
  ],
  [
    K([0.3, -0.12, -0.44], [0.85, 0.08, -0.4], [-0.4, -0.3, -0.92]),
    K([0.05, -0.15, -0.5], [-0.72, -0.1, -0.68], [-0.66, -0.45, 0.62]),
    K([-0.16, -0.2, -0.46], [-0.85, -0.08, -0.45], [-0.45, -0.42, 0.8]),
  ],
];

/** Unity BladeSwing / BladeView 的常数 */
export const BLADE_FP = {
  /** 蓄势占判定帧前的比例；收势进行到这里：刀光停采样、伸刃开始缩回；伸刃的固定段（刀身坐标 y ≤ 此值不拉长） */
  WindFrac: 0.55, RecoverP: 0.72, StretchBaseY: 0.09,
  /** 段结束 / 手势切换的过渡时长；命中后视觉进度停住的时长（真实秒） */
  BlendTime: 0.14, HitStopLight: 0.04, HitStopHeavy: 0.07,
  /** 刀光：每帧在走过的进度上采样几次；内沿在刀身上的位置（占刀身长度） */
  TrailSub: 4, TrailInner: 0.35,
  /** 归位闪的衰减（1/s）与峰值；判定帧甩出的火星放在刀尖屏幕位置往前这么远（米） */
  ArriveDecay: 8, ArrivePeak: 1.8, SparkDepth: 1.6,
  /** 命中时枪模往回一磕（米 / 弧度）：轻 / 重 */
  HitKick: [[0.014, 0.028], [0.024, 0.05]] as const,
  /** 归位闪的分段数 */
  GlintSegs: 6,
} as const;

/** 第一人称刀模缩放（关键帧位置是相机空间真实米数，只缩刀本身，屏幕构图不变） */
export const BLADE_VM_SCALE = 0.72;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v2 = new THREE.Vector3();
const _in = new THREE.Vector3();
const _out = new THREE.Vector3();
const _back = new THREE.Vector3();
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const PURPLE = new THREE.Color(BLADE_PURPLE);
const SHARD_SPARK = new THREE.Color(0xd8c2ff);

export function keyQuat(k: Key, out: THREE.Quaternion): THREE.Quaternion {
  _y.set(k.d[0], k.d[1], k.d[2]).normalize();
  _x.set(k.e[0], k.e[1], k.e[2]);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** 当前姿态（位置 + 朝向），可插值 */
export class Pose {
  readonly p = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  set(k: Key): this {
    this.p.set(k.p[0], k.p[1], k.p[2]);
    keyQuat(k, this.q);
    return this;
  }
  copy(o: Pose): this {
    this.p.copy(o.p);
    this.q.copy(o.q);
    return this;
  }
  lerp(o: Pose, t: number): this {
    this.p.lerp(o.p, t);
    this.q.slerp(o.q, clamp01(t));
    return this;
  }
  /** 刀身局部坐标（米，未缩放）→ 相机局部坐标（Unity BladeHoldPose.BladePoint） */
  bladePoint(x: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y - GRIP_Y, 0).multiplyScalar(BLADE_VM_SCALE).applyQuaternion(this.q).add(this.p);
  }
}

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 判定帧在进度里的位置（钳到 0.05–0.9） */
export const strikeP = (hitP: number): number => Math.min(0.9, Math.max(0.05, hitP));
/** 开始出刀（蓄势结束、刀光开始）在进度里的位置 */
export const windupP = (hitP: number): number => strikeP(hitP) * BLADE_FP.WindFrac;

/** 第 seg 段在进度 p 的刀姿（写进 out）；蓄势段从 from 转过去（Unity BladeSwing.Sample） */
export function sampleSwing(seg: number, p: number, hitP: number, from: Pose, out: Pose): Pose {
  const k = SWINGS[Math.min(SWINGS.length - 1, Math.max(0, seg))];
  const h = strikeP(hitP), a = h * BLADE_FP.WindFrac;
  if (p < a) return out.copy(from).lerp(_wPose.set(k[0]), smooth(p / a));
  if (p < h) {
    const t = (p - a) / (h - a);
    return out.set(k[0]).lerp(_sPose.set(k[1]), t * t);
  }
  const u = clamp01((p - h) / (1 - h));
  return out.set(k[1]).lerp(_fPose.set(k[2]), 1 - (1 - u) * (1 - u));
}
const _wPose = new Pose();
const _sPose = new Pose();
const _fPose = new Pose();

/** 剪辑里的伸刃倍率（不含人刀合一的常态伸长）：蓄势末段开始伸长、判定帧时到 slashStretch、收势（0.72 之后）缩回（Unity BladeSwing.Stretch） */
export function slashStretch(p: number, hitP: number, stretch: number): number {
  if (stretch <= 1.0001) return 1;
  const h = strikeP(hitP);
  const o = smooth((p - h * BLADE_FP.WindFrac) / (h * (1 - BLADE_FP.WindFrac)));
  const back = 1 - smooth((p - BLADE_FP.RecoverP) / (1 - BLADE_FP.RecoverP));
  return 1 + (stretch - 1) * o * back;
}

/** 伸刃后的刀身长度坐标：刀根 0.09 以内不动，其余按倍率拉长（Unity BladeSwing.StretchY） */
export function stretchY(y: number, stretch: number): number {
  return y <= BLADE_FP.StretchBaseY ? y : BLADE_FP.StretchBaseY + (y - BLADE_FP.StretchBaseY) * stretch;
}

/** 左手出现的程度：剑指 / 举手 1、立掌（屏障）0.8、没有手势 0 */
export function leftHandWeight(g: BladeGesture): number {
  return g === 'point' || g === 'raise' ? 1 : g === 'shield' ? 0.8 : 0;
}

/** 手势的目标刀姿 */
export function gestureKey(g: BladeGesture): Key {
  return g === 'point' ? POINT : g === 'shield' ? SHIELD : g === 'raise' ? RAISE : IDLE;
}

/** 两台相机 FOV 之比（主 / 枪模）：枪模相机里的点按它放大，屏幕位置不变（Unity BladeView.FovRatio） */
export function fovRatio(fovMain: number, fovVm: number): number {
  const c = (f: number): number => Math.min(179, Math.max(1, f));
  return Math.tan(c(fovMain) * 0.5 * DEG) / Math.tan(c(fovVm) * 0.5 * DEG);
}

/**
 * 手臂局部的手指方向 → 相机空间的手指方向（精确），前臂（手臂局部 ART_L_FORE）尽量朝 foreCam（Unity BladeView.LeftRotation）
 */
export function leftRotation(fingerLocal: THREE.Vector3, fingerCam: THREE.Vector3, foreCam: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const fl = _x.copy(fingerLocal).normalize();
  const fc = _y.copy(fingerCam).normalize();
  const upA = _v.copy(ART_L_FORE).addScaledVector(fl, -ART_L_FORE.dot(fl)).negate();
  const upC = _w.copy(foreCam).addScaledVector(fc, -foreCam.dot(fc)).negate();
  if (upA.lengthSq() < 1e-6) upA.set(0, 1, 0);
  if (upC.lengthSq() < 1e-6) upC.set(0, 1, 0);
  const basis = (f: THREE.Vector3, u: THREE.Vector3, q: THREE.Quaternion): THREE.Quaternion => {
    const zA = _z.copy(f);
    const xA = _s.crossVectors(u, zA).normalize();
    const yA = _p.crossVectors(zA, xA);
    return q.setFromRotationMatrix(_m.makeBasis(xA, yA, zA));
  };
  basis(fl, upA, _q3);
  basis(fc, upC, out);
  return out.multiply(_q3.invert());
}

function box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

export class BladeView implements ShardHomeProvider {
  /** 挂到 Viewmodel 枢轴下（枢轴在相机原点 + 通用摆动；关键帧给出相机空间的手位置） */
  readonly root = new THREE.Group();
  readonly model: DemonBladeModel;
  /** 命中时枪模往回一磕（Viewmodel 接上：Unity sway.Kick） */
  onKick: ((back: number, rot: number) => void) | null = null;
  /** 刀（含右手）：按姿态整体转动 */
  private readonly hold = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightFore = new THREE.Group();
  /** 英雄美术手臂的挂点：右手在刀模根下（随刀转动、按手腕扭转），左手在相机空间 */
  private readonly artRight = new THREE.Group();
  private readonly artLeft = new THREE.Group();
  private hasArtRight = false;
  private hasArtLeft = false;
  /** 剑指的两根手指（美术左手下，用手臂自己的材质） */
  private swordSign: THREE.Mesh | null = null;
  private signFit: SwordSignFit = swordSignFit(null);
  /** 右拳绕刀柄的扭转角（平滑） */
  private twist = 0;
  private snapTwist = true;
  private procRight: THREE.Group | null = null;
  private readonly leftHand = new THREE.Group();
  private leftFore: THREE.Group | null = null;
  readonly trail = new BladeTrail();
  readonly glints = new BladeGlints();
  private readonly trailColor = new THREE.Color(BLADE_PURPLE);
  private readonly mats: THREE.Material[] = [];
  private swarm: BladeSwarm | null = null;

  // 姿态
  private readonly cur = new Pose();
  private readonly from = new Pose();
  private readonly target = new Pose();
  private readonly tmp = new Pose();
  private mode = -2;
  private modeT = 0;
  private lastSwing = -1;
  private hitStop = 0;
  private visP = 0;
  private snap = true;
  private leftT = 0;
  private leftGesture: BladeGesture = 'point';
  private readonly leftRot = new THREE.Quaternion();
  private leftPosed = false;
  /** 伸刃当前倍率（视觉）与剪辑给的伸刃 */
  private stretch = 1;
  private clipStretch = 1;
  private hitFlash = 0;
  private strikeFlash = 0;
  private arriveGlow = 0;
  private lastUnion = false;
  private readonly lastTip = new THREE.Vector3();
  private time = 0;
  /** 判定帧事件派发过几次（测试读） */
  strikeEvents = 0;

  constructor(private readonly ctx: GameContext, heroColor: number) {
    this.root.name = 'demonBlade.view';
    this.model = buildDemonBlade(true);
    this.model.root.scale.setScalar(BLADE_VM_SCALE);
    this.hold.add(this.model.root);
    this.root.add(this.hold, this.leftArm, this.trail.mesh, this.glints.mesh);
    this.artRight.name = 'arm_r';
    this.artLeft.name = 'arm_l';
    this.model.root.add(this.artRight);
    this.root.add(this.artLeft);
    this.artLeft.visible = false;
    this.artLeft.scale.setScalar(LEFT_ARM_SCALE);
    this.buildHands(heroColor);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    this.cur.set(IDLE);
  }

  setSwarm(swarm: BladeSwarm | null): void {
    this.swarm = swarm;
  }

  /** 新段开始（控制器 startSwing）：刀光另起一条 */
  onSlash(): void {
    this.trail.break();
  }

  /** 判定帧（控制器结算命中的那一刻，打没打中都调）：记下人刀合一（火星规模）；第三段的世界大弧随 M11b（Unity Fx.Slash） */
  onStrike(_index: number, union: boolean): void {
    this.lastUnion = union;
  }

  /** 本段命中：视觉进度停住（顿帧，真实时间）、刀身闪亮、往回一磕 */
  onHit(heavy: boolean): void {
    this.hitStop = heavy ? BLADE_FP.HitStopHeavy : BLADE_FP.HitStopLight;
    this.hitFlash = heavy ? 1.4 : 1;
    const [back, rot] = BLADE_FP.HitKick[heavy ? 1 : 0];
    this.onKick?.(back, rot);
  }

  /** 刚切到这把刀：下一帧直接对齐待机姿态 */
  resetAnim(): void {
    this.snap = true;
    this.snapTwist = true;
    this.mode = -2;
    this.lastSwing = -1;
    this.visP = 0;
    this.hitStop = 0;
    this.leftT = 0;
    this.leftPosed = false;
    this.stretch = 1;
    this.clipStretch = 1;
    this.trail.clear();
    this.glints.clear();
    this.artLeft.visible = false;
  }

  /** 剑指的两根手指显示着（测试 / 实机脚本读） */
  get swordSignShown(): boolean {
    return !!this.swordSign && this.hasArtLeft && this.artLeft.visible;
  }

  /** 左手出现程度 0..1、当前伸刃倍率、视觉进度、刀光 */
  get leftHandWeight(): number {
    return this.leftT;
  }
  get stretchNow(): number {
    return this.stretch;
  }
  get visualProgress(): number {
    return this.visP;
  }

  /**
   * 换上英雄的美术手臂（AssetLibrary.findAttachments('fp', 英雄 id)）：右手拳握刀柄，左手剑指（补两根手指）。
   * 返回它们的实例材质（由调用方登记释放）；没有资产时保持程序化手臂。
   */
  attachArtArms(assets: readonly LoadedAsset[], renderer: THREE.WebGLRenderer): THREE.MeshStandardMaterial[] {
    const mats: THREE.MeshStandardMaterial[] = [];
    for (const asset of assets) {
      const socket = asset.entry.bind.attachment;
      if (socket !== 'arm_r' && socket !== 'arm_l') continue;
      const part = attachStaticPart(this.root, asset);
      if (!part) continue;
      part.lod.traverse((o) => {
        (o as THREE.Mesh).castShadow = false;
      });
      for (const m of part.materials) {
        applyArtEnvironment(m, renderer);
        mats.push(m);
      }
      if (socket === 'arm_r') this.hasArtRight = true;
      else {
        this.hasArtLeft = true;
        this.signFit = swordSignFit(asset.id);
        const geo = buildSwordSign(this.signFit);
        this.swordSign = new THREE.Mesh(geo, part.materials[0]);
        this.swordSign.name = 'arm_l.swordSign';
        this.swordSign.castShadow = false;
        this.artLeft.add(this.swordSign);
      }
    }
    // 美术手臂在位时隐藏对应的程序化方块手
    if (this.hasArtRight) {
      if (this.procRight) this.procRight.visible = false;
      this.rightFore.visible = false;
    }
    if (this.hasArtLeft) this.leftArm.visible = false;
    return mats;
  }

  private buildHands(heroColor: number): void {
    const glove = new THREE.MeshStandardMaterial({ color: 0x5c4a3e, roughness: 0.75, metalness: 0.05 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.8, metalness: 0.1 });
    const sleeveColor = new THREE.Color(0x2b2a2f).lerp(new THREE.Color(heroColor), 0.3).multiplyScalar(0.8);
    const sleeve = new THREE.MeshStandardMaterial({ color: sleeveColor, roughness: 0.92, metalness: 0.02 });
    this.mats.push(glove, cuff, sleeve);
    // 右手：拳头握住刀柄（刀柄沿模型 Y），拇指压在刀柄上
    const r = new THREE.Group();
    r.name = 'proc_arm_r';
    this.procRight = r;
    this.model.root.add(r);
    box(r, glove, 0.05, 0.075, 0.052, 0.012, 0, 0.004);
    box(r, glove, 0.018, 0.06, 0.02, -0.02, 0.006, 0.02, 0, 0, 0.2);
    box(r, glove, 0.016, 0.03, 0.02, -0.006, 0.042, 0.022, 0.4, 0, 0);
    // 前臂单独挂在 root 下，每帧从手腕指向画面右下方的肘部（手腕大幅翻转时袖子不会扫进画面）
    const rFore = this.rightFore;
    rFore.name = 'arm_r.forearm';
    this.root.add(rFore);
    box(rFore, cuff, 0.064, 0.05, 0.064, 0, -0.02, 0);
    box(rFore, sleeve, 0.072, 0.34, 0.072, 0, -0.2, 0);
    // 左手剑指：食指、中指并拢伸直，其余两指与拇指扣起。手腕在 leftArm 原点，前臂朝左下后方伸出画面
    const l = this.leftArm;
    l.name = 'proc_arm_l';
    const hand = this.leftHand;
    hand.name = 'arm_l.hand';
    l.add(hand);
    box(hand, glove, 0.044, 0.046, 0.026, 0, 0.026, 0);
    box(hand, glove, 0.017, 0.068, 0.016, 0.0095, 0.08, 0);
    box(hand, glove, 0.017, 0.063, 0.016, -0.0095, 0.077, 0);
    box(hand, glove, 0.036, 0.018, 0.024, -0.002, 0.052, 0.014, 0.9, 0, 0);
    box(hand, glove, 0.015, 0.034, 0.017, 0.026, 0.03, 0.01, 0.2, 0, -0.7);
    const fore = new THREE.Group();
    fore.name = 'arm_l.forearm';
    l.add(fore);
    box(fore, cuff, 0.06, 0.05, 0.06, 0, -0.025, 0);
    box(fore, sleeve, 0.066, 0.3, 0.066, 0, -0.2, 0);
    this.leftFore = fore;
    l.visible = false;
  }

  /**
   * 求本帧刀姿（相机空间的手位置与朝向），写入 hold。
   * s：控制器状态；dt 为本帧秒数（暂停时 0，顿帧时被压小）；realDt 为真实秒数（视觉顿帧按它走，同 Unity unscaledDeltaTime）。
   */
  pose(dt: number, s: BladePoseInput, realDt = dt): void {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.strikeFlash = Math.max(0, this.strikeFlash - dt * 9);
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - realDt);
    if (s.swing >= 0) this.animateSwing(dt, s);
    else {
      this.lastSwing = -1;
      const g = s.gesture === 'point' ? 1 : s.gesture === 'shield' ? 2 : s.gesture === 'raise' ? 3 : 0;
      if (this.mode !== 100 + g) {
        this.from.copy(this.cur);
        this.mode = 100 + g;
        this.modeT = 0;
        this.target.set(gestureKey(s.gesture));
      }
      this.modeT += dt;
      this.cur.copy(this.from).lerp(this.target, smooth(this.modeT / BLADE_FP.BlendTime));
      this.clipStretch = 1;
    }
    if (this.snap) {
      this.cur.set(IDLE);
      this.snap = false;
    }
    // 伸刃：剪辑给这一段的伸长（第三段 2.2），人刀合一常态伸长叠在上面
    const unionStretch = 1 + (Math.max(1, s.unionStretch) - 1) * clamp01(s.union);
    const want = unionStretch + (this.clipStretch - 1);
    this.stretch += (want - this.stretch) * Math.min(1, dt * 30);
    this.hold.position.copy(this.cur.p);
    this.hold.quaternion.copy(this.cur.q);
    // 右前臂：手腕（握持点沿刀柄向下一点）→ 画面右下方的肘部
    _v.copy(R_WRIST).multiplyScalar(BLADE_VM_SCALE).applyQuaternion(this.cur.q).add(this.cur.p);
    this.rightFore.position.copy(_v);
    _w.copy(R_ELBOW).sub(_v).normalize().negate();
    _q.setFromUnitVectors(_y.set(0, 1, 0), _w);
    this.rightFore.quaternion.copy(_q);
    if (this.hasArtRight) this.poseArtRight(dt, _v);
    this.poseLeft(dt, s.gesture);
  }

  /** 挥砍（Unity BladeView.AnimateSwing）：视觉进度（顿帧时停住）、刀光采样、剪辑事件 */
  private animateSwing(dt: number, s: BladePoseInput): void {
    const hitP = s.hitP;
    const slashK = s.slash ? Math.max(1, s.slash.stretch) : 1;
    if (this.mode !== s.swing || s.swing !== this.lastSwing || s.swingP < this.visP - 0.3) {
      this.from.copy(this.cur);
      this.mode = s.swing;
      this.visP = 0;
      this.tipOf(this.cur, this.stretch, this.lastTip);
      this.trail.break();
    }
    this.lastSwing = s.swing;
    // 顿帧：视觉进度停在出刀位置，之后追上逻辑进度
    const prevP = this.visP;
    if (this.hitStop <= 0) this.visP = Math.min(s.swingP, this.visP + dt * 12 + Math.max(0, s.swingP - this.visP) * 0.6);
    const rate = dt > 1e-5 ? (this.visP - prevP) / dt : 0;
    const wP = windupP(hitP), rP = BLADE_FP.RecoverP;
    // 刀光：把本帧走过的进度细分采样（蓄势段与收势后段不拖光）；外沿速度 = 刀尖对进度的导数 × 本帧的进度速率
    if (this.visP > prevP) {
      for (let k = 1; k <= BLADE_FP.TrailSub; k++) {
        const p = prevP + ((this.visP - prevP) * k) / BLADE_FP.TrailSub;
        if (p < wP || p > rP) continue;
        sampleSwing(s.swing, p, hitP, this.from, this.tmp);
        const st = slashStretch(p, hitP, slashK);
        this.tmp.bladePoint(0.004, stretchY(BLADE_LEN * BLADE_FP.TrailInner, st), _in);
        this.tipOf(this.tmp, st, _out);
        const dp = 0.01, pb = Math.max(0, p - dp);
        sampleSwing(s.swing, pb, hitP, this.from, this.tmp);
        this.tipOf(this.tmp, slashStretch(pb, hitP, slashK), _back);
        const speed = (_out.distanceTo(_back) / dp) * rate;
        this.trail.push(_in, _out, speed);
      }
    }
    this.tipOf(this.cur, this.stretch, this.lastTip);
    sampleSwing(s.swing, this.visP, hitP, this.from, this.cur);
    this.clipStretch = slashStretch(this.visP, hitP, slashK);
    this.dispatchEvents(s.swing, hitP, prevP, this.visP);
  }

  /** 伸长后的刀尖（相机空间） */
  private tipOf(pose: Pose, stretch: number, out: THREE.Vector3): THREE.Vector3 {
    return pose.bladePoint(-0.02, stretchY(BLADE_LEN, stretch), out);
  }

  /** 视觉进度从 prevP 走到 p：越过的剪辑事件依次派发（出刀 / 判定帧 / 收势；同一帧可能越过好几个） */
  private dispatchEvents(seg: number, hitP: number, prevP: number, p: number): void {
    if (p <= prevP) return;
    const at = [windupP(hitP), strikeP(hitP), BLADE_FP.RecoverP];
    if (at[0] > prevP && at[0] <= p) {
      // 开始出刀：刀光起
      this.trail.break();
      this.trail.resetPeak();
    }
    if (at[1] > prevP && at[1] <= p) this.onBladeStrike(seg);
    // 收势：刀光不再采样（剩下的自然淡掉）——采样窗口已按 RecoverP 截断
  }

  /** 判定帧：刃口白热一闪、甩出碎刃火星（随 M11b 换预设：现在用 ctx.fx.burst）、镜头朝挥动方向轻轻一带（命中的重冲击由控制器给） */
  private onBladeStrike(seg: number): void {
    this.strikeEvents++;
    this.strikeFlash = 1;
    // 镜头：一 = 右上 → 左下、二 = 左 → 右、三 = 大横扫；幅度不到命中冲击的一半，只让空挥也有「出刀」的感觉
    const yaw = seg === 1 ? 0.32 : seg === 2 ? -0.5 : -0.28;
    const pitch = seg === 0 ? 0.22 : 0.06;
    const punch = (this.ctx.player as unknown as { punchDegrees?: (p: number, r: number, y: number) => void }).punchDegrees;
    punch?.call(this.ctx.player, pitch, seg === 1 ? -0.25 : 0.25, yaw);
    this.spawnSparks(seg);
  }

  /** 判定帧甩出的火星：刀尖的屏幕位置往前 1.6 m 处顺着挥动方向（Unity BladeTrailPreset 的粒子层；随 M11b 换预设） */
  private spawnSparks(seg: number): void {
    const ctx = this.ctx;
    const tip = this.cur.bladePoint(spineX(BLADE_LEN), stretchY(BLADE_LEN, this.stretch), _v2);
    // root（枢轴）空间 → 武器相机空间 → 主相机（按屏幕位置对齐）
    this.root.updateWorldMatrix(true, false);
    tip.applyMatrix4(this.root.matrixWorld);
    ctx.viewCamera.updateMatrixWorld();
    ctx.viewCamera.worldToLocal(tip);
    const a = fovRatio(ctx.camera.fov, ctx.viewCamera.fov);
    tip.x *= a;
    tip.y *= a;
    if (-tip.z < 0.05) return;
    tip.multiplyScalar(BLADE_FP.SparkDepth / -tip.z);
    ctx.camera.updateMatrixWorld();
    ctx.camera.localToWorld(tip);
    const scale = (seg === 2 ? 1.6 : 1) * (this.lastUnion ? 1.25 : 1);
    const color = _c0.copy(PURPLE).lerp(SHARD_SPARK, 0.5);
    ctx.fx.burst(tip, color.getHex(), Math.round(3 * scale + 1), 5.5 * Math.sqrt(scale), 0.13, 0.04, 2);
  }

  /**
   * 美术右手：握把轴对准刀柄（模型 +Y），拳心落在刀柄轴线上；再绕刀柄扭转，让前臂尽量指向画面右下方的肘部。
   * 挂点在刀模根下（含刀模缩放），所以只需在刀模局部空间里求朝向。wrist 为相机空间的手腕位置。
   */
  private poseArtRight(dt: number, wrist: THREE.Vector3): void {
    _q.setFromUnitVectors(ART_R_GRIP, _y.set(0, 1, 0));
    const f1 = _v2.copy(ART_R_FORE).applyQuaternion(_q);
    // 肘部方向换到刀模局部空间（刀模根相对 hold 没有旋转）
    const e = _w.copy(R_ELBOW).sub(wrist).applyQuaternion(_q3.copy(this.cur.q).invert());
    const want = Math.atan2(e.x, e.z) - Math.atan2(f1.x, f1.z);
    let d = want - this.twist;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.twist += d * (this.snapTwist ? 1 : Math.min(1, dt * 18));
    this.snapTwist = false;
    _q2.setFromAxisAngle(_y, this.twist).multiply(_q);
    this.artRight.quaternion.copy(_q2);
    this.artRight.position.copy(ART_R_FIST).applyQuaternion(_q2).negate();
  }

  /**
   * 左手（Unity BladeView.PoseLeftArm）：从画面下方抬进来（0.14 s 平滑）；美术左手按「手指指向手势方向 + 前臂朝画面左下」摆，手势之间球面插值；
   * 没有美术手臂时用程序化方块手
   */
  private poseLeft(dt: number, gesture: BladeGesture): void {
    this.leftT += (leftHandWeight(gesture) - this.leftT) * Math.min(1, dt * 14);
    const show = this.leftT > 0.02;
    const k = smooth(this.leftT);
    if (this.hasArtLeft) {
      this.artLeft.visible = show;
      if (!show) return;
      if (gesture !== 'none') this.leftGesture = gesture;
      const t = this.leftGesture === 'shield' ? LEFT_ART.seal : this.leftGesture === 'raise' ? LEFT_ART.raise : LEFT_ART.point;
      leftRotation(this.signFit.dir, t.fingers, t.fore, _q);
      this.artLeft.position.copy(t.palm);
      this.artLeft.position.y -= 0.22 * (1 - k);
      if (!this.leftPosed) {
        this.leftRot.copy(_q);
        this.leftPosed = true;
      } else this.leftRot.slerp(_q, Math.min(1, dt * 16));
      this.artLeft.quaternion.copy(this.leftRot);
      return;
    }
    this.leftArm.visible = show;
    if (!show) return;
    const raise = gesture === 'raise' ? 0.05 : 0;
    this.leftArm.position.set(-0.12, -0.42 + 0.24 * k + raise, -0.46);
    // 手指方向（剑指）与掌心朝向；屏障时立掌
    keyQuat(gesture === 'shield' ? LEFT_PALM : LEFT_POINT, this.leftHand.quaternion);
    keyQuat(LEFT_FORE, this.leftFore!.quaternion);
  }

  /** 左手食指指尖（root 空间；没有美术左手时为 null） */
  private fingerTip(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.hasArtLeft) return null;
    this.artLeft.updateMatrix();
    return indexTip(this.signFit, out).applyMatrix4(this.artLeft.matrix);
  }

  /** 姿态生效、矩阵更新之后：碎片、鬼眼、光点、刀光 */
  animate(dt: number, s: BladePoseInput): void {
    const m = this.model;
    this.glints.begin();
    this.updateShards(s);
    // 剑指：指尖一点灵光（轻微脉动）
    if (this.artLeft.visible && s.gesture === 'point' && this.leftT > 0.3) {
      const tip = this.fingerTip(_v);
      if (tip) {
        const pulse = 0.8 + 0.2 * Math.sin(this.time * 9);
        _c0.copy(PURPLE).lerp(_c1.setRGB(1, 1, 1), 0.35).multiplyScalar(2.2);
        this.glints.add(tip, 0.05, _c0, smooth(this.leftT) * pulse);
      }
    }
    // 判定帧：刃口白热一闪
    if (this.strikeFlash > 0.02) {
      const tip = this.cur.bladePoint(spineX(BLADE_LEN), stretchY(BLADE_LEN, this.stretch), _v);
      _c0.copy(PURPLE).lerp(_c1.setRGB(1, 1, 1), 0.6).multiplyScalar(2.6);
      this.glints.add(tip, 0.09 + 0.05 * this.strikeFlash, _c0, this.strikeFlash);
    }
    this.glints.end();
    m.setAwake(Math.max(s.eye, s.union));
    const u = m.shardMat.userData.uniforms as { uBoost: { value: number } };
    u.uBoost.value = s.union * 0.5;
    this.trailColor.copy(PURPLE).lerp(_c1.setRGB(1, 1, 1), 0.15 + 0.3 * s.union);
    this.trail.tick(dt, this.trailColor, this.ctx.viewCamera);
  }

  /**
   * 碎片（Unity BladeView.UpdateShards）：在手里的按原位显示（伸刃拉开、横向错动），刚归位的放大一下；
   * 归位闪按刀身分段合成几颗中等大小的光点；刀身整体发光 = 命中 0.6 + 判定帧 0.35 + 人刀合一 0.4 + 伸刃 0.5 + 归位（Unity BladeModel.SetGlow）
   */
  private updateShards(s: BladePoseInput): void {
    const m = this.model;
    const cells = bladeCells();
    const sw = this.swarm;
    const now = this.ctx.time.now;
    const spread = this.stretch - 1;
    const segs = BLADE_FP.GlintSegs;
    const segPos = _segPos, segW = _segW, segPeak = _segPeak;
    segW.fill(0);
    segPeak.fill(0);
    let glowSum = 0;
    let coreTop = 10;
    let anyHome = false;
    const glow = this.hitFlash * 0.6 + this.strikeFlash * 0.35 + s.union * 0.4 + spread * 0.5 + this.arriveGlow;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const home = !sw || sw.state[i] === SHARD_HOME;
      const c = cells[i];
      if (!home) {
        m.buffer.hide(i);
        coreTop = Math.min(coreTop, c.cy - 0.012);
        continue;
      }
      anyHome = true;
      const seg = Math.max(0, Math.min(segs - 1, Math.floor((c.cy / BLADE_LEN) * segs)));
      const y = stretchY(c.cy, this.stretch);
      const x = c.cx + spread * 0.006 * Math.sin(i * 7.31 + this.time * 3);
      let arrive = sw ? Math.exp(-(now - sw.arrivedAt[i]) * BLADE_FP.ArriveDecay) * BLADE_FP.ArrivePeak : 0;
      if (arrive < 0.02) arrive = 0;
      m.buffer.set(i, x, y, 0, null, 1 + 0.2 * Math.min(1, arrive), glow);
      if (arrive > 0) {
        glowSum += arrive;
        const p = this.cur.bladePoint(x, y, _v);
        if (segW[seg] > 0) segPos[seg].addScaledVector(p, arrive);
        else segPos[seg].copy(p).multiplyScalar(arrive);
        segW[seg] += arrive;
        segPeak[seg] = Math.max(segPeak[seg], arrive);
      }
    }
    m.buffer.flush();
    // 每段一颗（落在这一段亮的碎片的加权中心），大一些、少一些，整把刀仍是一段段闪过去
    _c0.copy(PURPLE).lerp(SHARD_SPARK, 0.6).multiplyScalar(1.4);
    for (let k = 0; k < segs; k++) {
      if (segW[k] <= 0) continue;
      const pk = Math.min(1, segPeak[k]);
      this.glints.add(_v.copy(segPos[k]).divideScalar(segW[k]), 0.06 + 0.035 * pk, _c0, Math.min(0.55, segPeak[k] * 0.4));
    }
    this.arriveGlow = Math.min(0.6, glowSum * 0.012);
    // 伸刃时刀芯随碎片拉开会露出整条紫光；伸刃中隐藏刀芯（网页刀模的缝光芯）
    m.setCoreTop(this.stretch > 1.05 ? -1 : anyHome ? coreTop : -1);
    m.setAura((1 + s.union * 0.8 + this.hitFlash * 0.5) * (anyHome ? 1 : 0));
  }

  /** 伸刃后的长度坐标（刀根附近不动） */
  private stretchY(y: number): number {
    return stretchY(y, this.stretch);
  }

  /**
   * 碎片 i 在原位时的主场景世界坐标与朝向，返回世界缩放。
   * 武器相机固定在武器场景原点、不旋转，所以武器场景的世界坐标就是相机空间；
   * 两台相机 FOV 不同：x / y 按 tan 比例缩放，屏幕位置对齐。
   */
  homeWorld(i: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const c = bladeCells()[i];
    const m = this.model;
    m.frame.updateWorldMatrix(true, false);
    pos.set(c.cx, this.stretchY(c.cy), 0).applyMatrix4(m.frame.matrixWorld);
    const ctx = this.ctx;
    const a = fovRatio(ctx.camera.fov, ctx.viewCamera.fov);
    pos.x *= a;
    pos.y *= a;
    ctx.camera.updateMatrixWorld();
    ctx.camera.localToWorld(pos);
    m.frame.matrixWorld.decompose(_p, _q, _s);
    quat.copy(ctx.camera.quaternion).multiply(_q);
    return _s.x * a;
  }

  /** 刀根（鬼面）当前的主场景世界坐标（噬灵魔气飞向这里） */
  rootWorld(out: THREE.Vector3): THREE.Vector3 {
    const m = this.model;
    m.frame.updateWorldMatrix(true, false);
    out.set(0.01, rootBoundaryY(0.5) * 0.4, 0).applyMatrix4(m.frame.matrixWorld);
    const ctx = this.ctx;
    const a = fovRatio(ctx.camera.fov, ctx.viewCamera.fov);
    out.x *= a;
    out.y *= a;
    ctx.camera.updateMatrixWorld();
    return ctx.camera.localToWorld(out);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.model.dispose();
    for (const mat of this.mats) mat.dispose();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry instanceof THREE.BoxGeometry) mesh.geometry.dispose();
    });
    this.swordSign?.geometry.dispose();
    this.trail.dispose();
    this.glints.dispose();
  }
}

const _segPos = Array.from({ length: BLADE_FP.GlintSegs }, () => new THREE.Vector3());
const _segW = new Array<number>(BLADE_FP.GlintSegs).fill(0);
const _segPeak = new Array<number>(BLADE_FP.GlintSegs).fill(0);
