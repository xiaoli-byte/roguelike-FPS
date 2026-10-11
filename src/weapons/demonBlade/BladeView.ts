/**
 * 魔刀千刃 v2 的第一人称表现（docs/demon-blade-v2.md 第 9 节）：持刀姿态、三段斩、剑指手势、刀身上的碎片与刀光。
 *
 * - 姿态用「手的位置 + 刀尖方向 + 刃口方向」关键帧描述（相机空间），关键帧之间位置走样条、朝向走球面插值。
 * - 碎片：刃群模块（BladeSwarm）记录每片在手里还是在外面；在手里的按原位显示，伸刃时沿刀线展开，刚归位的闪一下。
 * - 交接：homeWorld 把碎片在第一人称刀身上的位置换算到主场景（两台相机 FOV 不同，按屏幕位置对齐），刃群从这里出发、回到这里。
 * Viewmodel 负责呼吸 / 晃动等通用摆动并把 pose() 的结果叠到枢轴上，再调用 animate()。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { LoadedAsset } from '../../assets/AssetLibrary';
import { applyArtEnvironment } from '../../assets/ArtEnvironment';
import { attachStaticPart } from '../../assets/StaticAttachment';
import { clamp01, DEG } from '../../core/math';
import { bladeCells, BLADE_LEN, rootBoundaryY, SHARD_COUNT } from './BladeShape';
import { BLADE_PURPLE, buildDemonBlade, GRIP_Y, type DemonBladeModel } from './BladeModel';
import { SHARD_HOME, type BladeSwarm, type ShardHomeProvider } from './BladeSwarm';

/** 剑指等手势 */
export type BladeGesture = 'none' | 'point' | 'shield' | 'raise';

/** 控制器每帧交给第一人称的状态 */
export interface BladePoseInput {
  /** 当前挥砍段（−1 = 不在挥砍）与进度、判定帧位置 */
  swing: number;
  swingP: number;
  hitP: number;
  gesture: BladeGesture;
  /** 人刀合一强度 0..1、鬼眼 0..1、刃气 0..1 */
  union: number;
  eye: number;
  qi: number;
}

export function createBladePoseInput(): BladePoseInput {
  return { swing: -1, swingP: 0, hitP: 0.3, gesture: 'none', union: 0, eye: 0, qi: 1 };
}

/** 关键帧：手（握持点）的相机空间位置、刀尖方向、刃口方向 */
interface Key {
  p: readonly [number, number, number];
  d: readonly [number, number, number];
  e: readonly [number, number, number];
}

const K = (p: Key['p'], d: Key['d'], e: Key['e']): Key => ({ p, d, e });

/** 待机：右下握刀（拳在画面内），刀身斜立在画面右侧，刃口朝左，刀面朝向镜头，能看到碎片与鬼面 */
const IDLE = K([0.25, -0.22, -0.5], [-0.28, 0.82, -0.5], [-0.92, -0.1, 0.38]);
/** 剑指（千刃出窍 / 杀气爆发）：右拳收在右下、刀根斜指前方，鬼面朝镜头（击杀时能看到睁眼），画面中央让给左手与刃群 */
const POINT = K([0.26, -0.22, -0.46], [-0.18, 0.5, -0.85], [-0.76, -0.53, -0.17]);
/** 碎刃屏障：刀柄横在身前（刀身已散成圆盾） */
const SHIELD = K([0.12, -0.2, -0.4], [-0.9, 0.25, -0.3], [0, 0, -1]);
/** 杀气爆发起手：刀柄高举 */
const RAISE = K([0.22, -0.12, -0.42], [-0.2, 0.95, -0.2], [-0.6, 0, -0.8]);

/** 右肘在相机空间的位置（前臂从手腕指向这里，画面右下角之外） */
const R_ELBOW = new THREE.Vector3(0.46, -0.66, 0.02);

/**
 * 英雄美术手臂（SM_Arms_<英雄><R|L>，握枪姿势建模）在各自挂点空间里的关键量：
 * 右手拳心、握把轴（握枪时手枪握把的方向）、前臂方向；左手前臂方向与并拢的手指方向。
 * 来自程序化手臂 buildArm 的握持方块（美术手臂按它注册）与资产包围盒。
 */
const ART_R_FIST = new THREE.Vector3(0.003, -0.05, 0.034);
const ART_R_GRIP = new THREE.Vector3(0, 0.955, -0.296).normalize();
const ART_R_FORE = new THREE.Vector3(0.1, -0.21, 0.3).normalize();
const ART_L_FORE = new THREE.Vector3(-0.17, -0.26, 0.3).normalize();

/** 美术左手的手势：手腕位置、前臂方向（从手腕伸向肘部）、绕前臂的翻转角 */
const LEFT_ART_POINT = { x: -0.13, y: -0.13, z: -0.42, fx: -0.4, fy: -0.45, fz: 0.8, roll: -Math.PI / 2 };
const LEFT_ART_PALM = { x: -0.12, y: -0.12, z: -0.42, fx: -0.25, fy: -0.85, fz: 0.45, roll: Math.PI };

/** 左手：剑指（手指方向、掌背朝向）、立掌、前臂（d = 从手腕伸向肘部的反方向，前臂沿 −d 伸出） */
const LEFT_POINT = K([0, 0, 0], [0.3, 0.3, -0.9], [0.1, 0.95, 0.3]);
const LEFT_PALM = K([0, 0, 0], [0.1, 0.95, -0.3], [0.95, 0, 0.3]);
const LEFT_FORE = K([0, 0, 0], [0.35, 0.85, -0.4], [1, 0, 0.3]);

/**
 * 三段斩的关键帧 [蓄势, 出刀（判定帧）, 收势]：
 * 0 右上 → 左下斜斩；1 左 → 右回斩；2 伸刃：从右侧大幅横扫到左侧，刀身伸长。
 * 约束（16:9 与 4:3 都按 60° 视模相机逐帧投影核对过）：握刀点始终在画面内；刀尖在收势里仍朝前，不转向镜头，
 * 所以整段挥砍刀身都看得见；判定帧时刀身穿过画面中部。
 */
const SWINGS: readonly (readonly [Key, Key, Key])[] = [
  // 右上 → 左下斜斩：蓄势时刀举过右肩，判定帧时刀身斜横在画面中下，收势停在左下
  [
    K([0.24, 0, -0.48], [0.3, 0.85, -0.15], [-0.75, 0.2, -0.6]),
    K([0.1, -0.12, -0.5], [-0.62, -0.35, -0.7], [-0.3, -0.9, 0.3]),
    K([-0.1, -0.19, -0.47], [-0.75, -0.25, -0.6], [-0.3, -0.85, 0.3]),
  ],
  // 左 → 右回斩：刀尖略上扬，判定帧时刀身斜指左前方，收势立在画面右侧
  [
    K([-0.14, -0.15, -0.46], [-0.85, 0.3, -0.1], [0.3, 0.2, -0.9]),
    K([0.06, -0.14, -0.5], [-0.5, 0.4, -0.77], [0.82, 0.1, -0.56]),
    K([0.28, -0.17, -0.44], [0.55, 0.35, -0.75], [0.75, -0.1, 0.6]),
  ],
  // 伸刃：从右侧大幅横扫到左侧，判定帧时伸长的刀身在准星高度横贯画面
  [
    K([0.3, -0.12, -0.44], [0.85, 0.15, -0.4], [-0.4, 0, -0.92]),
    K([0.05, -0.16, -0.5], [-0.72, 0.06, -0.68], [-0.68, 0, 0.73]),
    K([-0.16, -0.2, -0.46], [-0.85, 0.05, -0.45], [-0.45, 0, 0.85]),
  ],
];
/** 蓄势占判定帧前的比例 */
const WIND_FRAC = 0.55;
/** 段结束 / 手势切换的过渡时长 */
const BLEND_TIME = 0.14;
/** 顿帧 */
const HITSTOP = 0.04;
const HITSTOP_HEAVY = 0.07;
/** 伸刃的碎片间距：刀身最长伸到 BLADE_LEN × stretch */
const STRETCH_BASE_Y = 0.09;
/** 刀光拖尾：每帧在走过的挥砍进度上采样 TRAIL_SUB 次（出刀只有两三帧，逐帧采样会是折线） */
const TRAIL_SAMPLES = 48;
const TRAIL_SUB = 4;
const TRAIL_LIFE = 0.16;
/** 归位闪光衰减 */
const ARRIVE_FLASH = 8;
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

function keyQuat(k: Key, out: THREE.Quaternion): THREE.Quaternion {
  _y.set(k.d[0], k.d[1], k.d[2]).normalize();
  _x.set(k.e[0], k.e[1], k.e[2]);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** 当前姿态（位置 + 朝向），可插值 */
class Pose {
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
    this.q.slerp(o.q, t);
    return this;
  }
}

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 刀光：在武器场景里记录刀根 / 刀尖的轨迹，画成一条由紫到白的扇面 */
class SwingTrail {
  readonly mesh: THREE.Mesh;
  private readonly inner = new Float32Array(TRAIL_SAMPLES * 3);
  private readonly outer = new Float32Array(TRAIL_SAMPLES * 3);
  private readonly age = new Float32Array(TRAIL_SAMPLES);
  private n = 0;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly geo = new THREE.BufferGeometry();

  constructor() {
    const idx: number[] = [];
    for (let k = 0; k < TRAIL_SAMPLES - 1; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.pos = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setDrawRange(0, 0);
    // 普通混合：叠加混合在沙漠、雪地这类亮背景上几乎看不见
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'demonBlade.trail';
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }

  push(inner: THREE.Vector3, outer: THREE.Vector3): void {
    if (this.n >= TRAIL_SAMPLES) {
      this.inner.copyWithin(0, 3);
      this.outer.copyWithin(0, 3);
      this.age.copyWithin(0, 1);
      this.n--;
    }
    const i = this.n++;
    inner.toArray(this.inner, i * 3);
    outer.toArray(this.outer, i * 3);
    this.age[i] = 0;
  }

  update(dt: number, color: THREE.Color): void {
    for (let i = 0; i < this.n; i++) this.age[i] += dt;
    let dead = 0;
    while (dead < this.n - 1 && this.age[dead] > TRAIL_LIFE) dead++;
    if (dead > 0) {
      this.inner.copyWithin(0, dead * 3);
      this.outer.copyWithin(0, dead * 3);
      this.age.copyWithin(0, dead);
      this.n -= dead;
    }
    if (this.n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      for (let a = 0; a < 3; a++) {
        P[i * 6 + a] = this.inner[i * 3 + a];
        P[i * 6 + 3 + a] = this.outer[i * 3 + a];
      }
      const life = clamp01(1 - this.age[i] / TRAIL_LIFE);
      const head = clamp01(1 - this.age[i] / 0.04);
      // 刀尖一侧是偏白的亮紫、向刀根渐隐；最新的一小段最亮
      const w = 0.45 + 0.5 * head;
      C[i * 8] = color.r; C[i * 8 + 1] = color.g; C[i * 8 + 2] = color.b; C[i * 8 + 3] = 0;
      C[i * 8 + 4] = color.r + (1 - color.r) * w;
      C[i * 8 + 5] = color.g + (1 - color.g) * w;
      C[i * 8 + 6] = color.b + (1 - color.b) * w;
      C[i * 8 + 7] = life * life * 0.8;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.geo.setDrawRange(0, (this.n - 1) * 6);
  }
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
  /** 刀（含右手）：按姿态整体转动 */
  private readonly hold = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightFore = new THREE.Group();
  /** 英雄美术手臂的挂点：右手在刀模根下（随刀转动、按手腕扭转），左手在相机空间 */
  private readonly artRight = new THREE.Group();
  private readonly artLeft = new THREE.Group();
  private hasArtRight = false;
  private hasArtLeft = false;
  /** 右拳绕刀柄的扭转角（平滑） */
  private twist = 0;
  private snapTwist = true;
  private procRight: THREE.Group | null = null;
  private procLeftHand: THREE.Group | null = null;
  private readonly leftHand = new THREE.Group();
  private leftFore: THREE.Group | null = null;
  private readonly trail = new SwingTrail();
  private readonly trailColor = new THREE.Color(BLADE_PURPLE);
  private readonly mats: THREE.Material[] = [];
  private swarm: BladeSwarm | null = null;

  // 姿态
  private readonly cur = new Pose();
  private readonly from = new Pose();
  private readonly target = new Pose();
  private readonly w = new Pose();
  private readonly s = new Pose();
  private readonly f = new Pose();
  private mode = -2;
  private modeT = 0;
  private lastSwing = -1;
  private hitStop = 0;
  private visP = 0;
  private snap = true;
  private leftT = 0;
  /** 伸刃当前倍率（视觉） */
  private stretch = 1;
  private hitFlash = 0;
  private time = 0;

  constructor(private readonly ctx: GameContext, heroColor: number) {
    this.root.name = 'demonBlade.view';
    this.model = buildDemonBlade(true);
    this.model.root.scale.setScalar(BLADE_VM_SCALE);
    this.hold.add(this.model.root);
    this.root.add(this.hold, this.leftArm, this.trail.mesh);
    this.artRight.name = 'arm_r';
    this.artLeft.name = 'arm_l';
    this.model.root.add(this.artRight);
    this.root.add(this.artLeft);
    this.artLeft.visible = false;
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

  /** 新段开始（判定帧前由控制器调用） */
  onSlash(): void {
    this.trail.clear();
  }

  /** 本段命中：顿帧 + 刀身闪亮 */
  onHit(heavy: boolean): void {
    this.hitStop = heavy ? HITSTOP_HEAVY : HITSTOP;
    this.hitFlash = 1;
  }

  /** 刚切到这把刀：下一帧直接对齐待机姿态 */
  resetAnim(): void {
    this.snap = true;
    this.snapTwist = true;
    this.trail.clear();
    this.lastSwing = -1;
    this.mode = -2;
  }

  /**
   * 换上英雄的美术手臂（AssetLibrary.findAttachments('fp', 英雄 id)）：右手拳握刀柄，左手并掌作剑指。
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
      else this.hasArtLeft = true;
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
   * 求本帧刀姿（相机空间的手位置与朝向），写入 hold；返回值无（Viewmodel 枢轴只做通用摆动）。
   * s：控制器状态；dt 为本帧秒数（暂停时 0）。
   */
  pose(dt: number, s: BladePoseInput): void {
    this.time += dt;
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
    if (s.swing >= 0) {
      const seg = SWINGS[Math.min(SWINGS.length - 1, s.swing)];
      if (this.mode !== s.swing || s.swing !== this.lastSwing || s.swingP < this.visP - 0.3) {
        this.from.copy(this.cur);
        this.mode = s.swing;
        this.visP = 0;
        this.w.set(seg[0]);
        this.s.set(seg[1]);
        this.f.set(seg[2]);
        this.trail.clear();
      }
      this.lastSwing = s.swing;
      // 顿帧：视觉进度停在出刀位置，之后追上逻辑进度
      const prevP = this.visP;
      if (this.hitStop <= 0) this.visP = Math.min(s.swingP, this.visP + dt * 12 + Math.max(0, s.swingP - this.visP) * 0.6);
      // 刀光：把本帧走过的进度细分采样（蓄势段不拖光）
      if (this.visP > prevP) {
        for (let k = 1; k <= TRAIL_SUB; k++) {
          const p = prevP + ((this.visP - prevP) * k) / TRAIL_SUB;
          if (p < s.hitP * WIND_FRAC) continue;
          this.swingPose(p, s.hitP);
          this.pushTrail();
        }
      }
      this.swingPose(this.visP, s.hitP);
    } else {
      this.lastSwing = -1;
      const g = s.gesture === 'point' ? 1 : s.gesture === 'shield' ? 2 : s.gesture === 'raise' ? 3 : 0;
      if (this.mode !== 100 + g) {
        this.from.copy(this.cur);
        this.mode = 100 + g;
        this.modeT = 0;
        this.target.set(g === 1 ? POINT : g === 2 ? SHIELD : g === 3 ? RAISE : IDLE);
      }
      this.modeT += dt;
      this.cur.copy(this.from).lerp(this.target, smooth(this.modeT / BLEND_TIME));
    }
    if (this.snap) {
      this.cur.set(IDLE);
      this.snap = false;
    }
    // 伸刃：第三段从蓄势末段开始伸长，收势时缩回；人刀合一常态伸长
    const unionStretch = 1 + 0.3 * s.union;
    let want = unionStretch;
    if (s.swing === 2) {
      const p = this.visP, h = s.hitP;
      const out = smooth((p - h * WIND_FRAC) / (h * (1 - WIND_FRAC)));
      const back = 1 - smooth((p - 0.72) / 0.28);
      want = unionStretch + (2.2 - 1) * out * back;
    }
    this.stretch += (want - this.stretch) * Math.min(1, dt * 30);
    this.hold.position.copy(this.cur.p);
    this.hold.quaternion.copy(this.cur.q);
    // 右前臂：手腕（握持点沿刀柄向下一点）→ 画面右下方的肘部
    _v.set(0.012, -0.05, 0.004).multiplyScalar(BLADE_VM_SCALE).applyQuaternion(this.cur.q).add(this.cur.p);
    this.rightFore.position.copy(_v);
    _w.copy(R_ELBOW).sub(_v).normalize().negate();
    _q.setFromUnitVectors(_y.set(0, 1, 0), _w);
    this.rightFore.quaternion.copy(_q);
    if (this.hasArtRight) this.poseArtRight(dt, _v);
    // 左手剑指：手腕在画面左下，手指指向前方略偏画面中心；前臂朝左下后方伸出画面
    const left = s.gesture === 'point' || s.gesture === 'raise' ? 1 : s.gesture === 'shield' ? 0.8 : 0;
    this.leftT += (left - this.leftT) * Math.min(1, dt * 14);
    const showLeft = this.leftT > 0.02;
    const k = smooth(this.leftT);
    const raise = s.gesture === 'raise' ? 0.05 : 0;
    if (this.hasArtLeft) {
      this.artLeft.visible = showLeft;
      if (showLeft) this.poseArtLeft(k, raise, s.gesture === 'shield');
    } else {
      this.leftArm.visible = showLeft;
      if (showLeft) {
        this.leftArm.position.set(-0.12, -0.42 + 0.24 * k + raise, -0.46);
        // 手指方向（剑指）与掌心朝向；屏障时立掌
        keyQuat(s.gesture === 'shield' ? LEFT_PALM : LEFT_POINT, this.leftHand.quaternion);
        keyQuat(LEFT_FORE, this.leftFore!.quaternion);
      }
    }
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
   * 美术左手：并拢的手掌顺着前臂伸直，所以前臂从画面左下方伸向中心，手指顺势指向前方（剑指）；
   * 屏障时前臂更竖、手掌立起。roll 为绕前臂的翻转角，让掌背朝向镜头。
   */
  private poseArtLeft(k: number, raise: number, palm: boolean): void {
    const tune = (globalThis as { __bladeLeftTune?: { x: number; y: number; z: number; fx: number; fy: number; fz: number; roll: number } }).__bladeLeftTune;
    const t = tune ?? (palm ? LEFT_ART_PALM : LEFT_ART_POINT);
    this.artLeft.position.set(t.x, t.y - 0.2 * (1 - k) + raise, t.z);
    const fore = _v2.set(t.fx, t.fy, t.fz).normalize();
    this.artLeft.quaternion.setFromUnitVectors(ART_L_FORE, fore);
    _q3.setFromAxisAngle(fore, t.roll);
    this.artLeft.quaternion.premultiply(_q3);
  }

  private swingPose(p: number, hitP: number): void {
    const h = Math.min(0.9, Math.max(0.05, hitP));
    const a = h * WIND_FRAC;
    if (p < a) {
      this.cur.copy(this.from).lerp(this.w, smooth(p / a));
      return;
    }
    if (p < h) {
      const t = (p - a) / (h - a);
      this.cur.copy(this.w).lerp(this.s, t * t);
      return;
    }
    const t = (p - h) / (1 - h);
    this.cur.copy(this.s).lerp(this.f, 1 - (1 - t) * (1 - t));
  }

  /** 姿态生效、矩阵更新之后：碎片、刀芯、鬼眼、刀光 */
  animate(dt: number, s: BladePoseInput): void {
    const m = this.model;
    const cells = bladeCells();
    const sw = this.swarm;
    const now = this.ctx.time.now;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    let coreTop = 10;
    let anyHome = false;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const home = !sw || sw.state[i] === SHARD_HOME;
      if (!home) {
        m.buffer.hide(i);
        coreTop = Math.min(coreTop, cells[i].cy - 0.012);
        continue;
      }
      anyHome = true;
      const c = cells[i];
      const y = this.stretchY(c.cy);
      const spread = this.stretch - 1;
      const jx = spread * 0.006 * Math.sin(i * 7.31 + this.time * 3);
      const wave = Math.max(0, Math.sin(this.time * 2.6 - c.rank * 0.09)) ** 6 * 0.35;
      const arrive = sw ? Math.exp(-(now - sw.arrivedAt[i]) * ARRIVE_FLASH) * 1.8 : 0;
      m.buffer.set(i, c.cx + jx, y, 0, null, 1, wave + arrive + this.hitFlash * 0.6 + s.union * 0.4 + spread * 0.5);
    }
    m.buffer.flush();
    // 伸刃时刀芯随碎片拉开会露出整条紫光；伸刃中隐藏刀芯
    m.setCoreTop(this.stretch > 1.05 ? -1 : anyHome ? coreTop : -1);
    m.setAura((1 + s.union * 0.8 + this.hitFlash * 0.5) * (anyHome ? 1 : 0));
    m.setAwake(Math.max(s.eye, s.union));
    const u = m.shardMat.userData.uniforms as { uBoost: { value: number } };
    u.uBoost.value = s.union * 0.5 + (s.qi < 0.25 ? 0 : 0);
    this.trailColor.setHex(BLADE_PURPLE).lerp(_c0.setHex(0xffffff), 0.15 + 0.3 * s.union);
    this.trail.update(dt, this.trailColor);
  }

  /** 按当前姿态 cur 记录一段刀光（刀身 60% 处到伸长后的刀尖，root 空间；刀模 frame 相对握持点上移 −GRIP_Y） */
  private pushTrail(): void {
    _v.set(0.004, BLADE_LEN * 0.6 * this.stretch - GRIP_Y, 0).multiplyScalar(BLADE_VM_SCALE).applyQuaternion(this.cur.q).add(this.cur.p);
    _w.set(-0.02, this.stretchY(BLADE_LEN) - GRIP_Y, 0).multiplyScalar(BLADE_VM_SCALE).applyQuaternion(this.cur.q).add(this.cur.p);
    this.trail.push(_v, _w);
  }

  /** 伸刃后的长度坐标（刀根附近不动） */
  private stretchY(y: number): number {
    return y <= STRETCH_BASE_Y ? y : STRETCH_BASE_Y + (y - STRETCH_BASE_Y) * this.stretch;
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
    const a = Math.tan(ctx.camera.fov * DEG * 0.5) / Math.tan(ctx.viewCamera.fov * DEG * 0.5);
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
    const a = Math.tan(ctx.camera.fov * DEG * 0.5) / Math.tan(ctx.viewCamera.fov * DEG * 0.5);
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
    (this.trail.mesh.material as THREE.Material).dispose();
    this.trail.mesh.geometry.dispose();
  }
}

const _c0 = new THREE.Color();
