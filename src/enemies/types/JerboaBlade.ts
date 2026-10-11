/**
 * 跳鼠刀兵（jerboa_blade，第一章 · 赤沙古道的群怪）：大耳长尾的沙跳鼠兵，披残缺札甲，双持短弯刀。
 * 3–5 只成群出现。双脚并拢弹跳前进，接近时左右折线跳（难瞄）；单只很脆，弱点是两耳之间发光的铜铃（头部判定）。
 *
 * - 扑斩：4–9 米内蹲伏蓄力 0.4 秒（铜铃亮、耳朵后贴、吱吱叫），真跳跃扑向玩家的预判落点，落地原地旋身横斩（2 米、360°）。
 *   斩完硬直 0.5 秒（最好的输出窗口），然后向后跳开拉距离（打了就跑）。精英落空时会立刻再扑一次。
 * - 交叉斩：贴身时双刀 X 字交叉劈砍。
 *
 * 状态机：chase → crouch → leap → spin → recover → hopBack → chase
 *         chase → slashWindup → slash → recover → chase
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import { boneHull, type NativeBody, type NativePose } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import { spawnSlashArc } from '../fx/SlashArc';

export const JERBOA_BLADE_DEF: ScaledEnemyDef = {
  id: 'jerboa_blade',
  name: '跳鼠刀兵',
  // 美术按 1.1 米做，游戏里整体放大 1.3 倍（耳尖约 1.43 米）：太小在 8–15 米的交战距离上看不清结构、显得扁平。
  // 下面的尺寸都是放大前的值，命中盒 / 头部判定由 EnemyBase 一起乘上
  scale: 1.3,
  hp: 42,
  speed: 7,
  radius: 0.34,
  // 含竖起的大耳（耳尖离地约 1.1）
  height: 1.1,
  damage: 9,
  coins: [1, 2],
  essence: 1,
  // 弱点 = 两耳之间的铜铃（铃心离地约 0.95）；判定球连带头顶，跟着头骨移动
  headY: 0.92,
  headRadius: 0.17,
  knockbackResist: 0,
  color: 0xffb860,
};

const LEAP_MIN = 4;
const LEAP_MAX = 9;
const LEAP_WINDUP = 0.4;
const GRAVITY = 26;
/** 扑跳落点停在玩家身前的距离 */
const LEAP_SHORT = 0.9;
/** 落点按玩家速度预判的比例（横移即可躲开） */
const LEAP_LEAD = 0.35;
const SPIN_RANGE = 2.0;
const SPIN_TIME = 0.28;
const SPIN_DAMAGE_MULT = 1.3;
const SLASH_RANGE = 1.5;
const SLASH_WINDUP = 0.3;
const RECOVER_AFTER_SPIN = 0.5;
const HOP_BACK_TIME = 0.42;
const HOP_BACK_SPEED = 7.5;
/** 冷却中在这个距离带上绕着玩家折线跳，等下一次扑斩 */
const ORBIT = [3.8, 6.5] as const;
/**
 * 双足跳（跳鼠 / 袋鼠式）：一跳 = 很短的触地（落地缓冲 → 蹬伸，脚钉在地上、身体从脚上方越过）+ 很长的腾空（收腿 → 前伸准备落地）。
 * 频率基本固定，跑得越快步幅越大；只有触地时才能改变方向。
 */
const HOP_TIME = 0.42;
/**
 * 触地段占一跳的比例（相位 0 = 落地瞬间）：= 脚掌扫过的距离 / (移速 × 一跳时长)，跑得越快触地越短，
 * 触地期间脚完全钉住不滑。扫过距离 = 落地时脚在髋前方 STRIDE_AHEAD + 蹬离时在髋后方 STRIDE_BEHIND（随速度放大）。
 */
const STANCE_RANGE = [0.14, 0.4] as const;
const STRIDE_AHEAD = [0.03, 0.17] as const;
const STRIDE_BEHIND = [0.03, 0.21] as const;
/** 满速时腾空最高点（米，相对触地基准） */
const HOP_HEIGHT = 0.22;
/** 腿在绑定姿势下几乎伸直：落地 / 蹬离瞬间髋部要比站立低 HOP_LOW_EDGE，触地中段再低到 HOP_LOW_MID，脚才够得到身体前后 */
const HOP_LOW_EDGE = 0.05;
const HOP_LOW_MID = 0.1;
/** 安全限位：触地时脚相对髋关节最多落后 / 领先多少（模型局部单位）；超出就让脚贴地滑一点，不把腿拉断 */
const FOOT_BEHIND = 0.3;
const FOOT_AHEAD = 0.28;
/** 蹬伸时脚跟抬起、脚尖撑地：踝关节最多抬高这么多（≈ 脚掌长），脚尖不会戳进地面 */
const HEEL_LIFT = 0.075;
/**
 * 尾巴弹簧骨骼（同 VRM spring bone）：每节尾端是一个有惯性的质点，在世界空间里跟着身体的真实运动（跳跃起落、转身、旋斩）走，
 * 被拉回动画给出的目标方向（刚度，尾根硬、尾尖软），带阻尼和少量重力，与地面碰撞；骨骼朝向由质点位置反推，弯曲连续。
 * 刚度单位：每秒把尾端往目标方向推多少米（与 three-vrm 相同）。
 */
const TAIL_STIFFNESS = [5.2, 3.0, 2.0, 1.4] as const;
const TAIL_DRAG = 0.3;
const TAIL_GRAVITY = 0.25;
/** 每节相对动画目标方向最多偏多少（弧度）：真实尾巴每个关节能弯的角度有限，4 节骨骼弯太多会像折断 */
const TAIL_MAX_BEND = 0.45;
/** 尾端离地的最小高度（尾簇半径） */
const TAIL_CLEARANCE = 0.05;
/** 折线跳：每隔这么久换一次横向方向 */
const ZIGZAG = [0.45, 0.85] as const;

const C = {
  fur: 0xd99a55, belly: 0xf0d4a8, ear: 0xe89a90, eye: 0x1a120e, nose: 0xd98a8a,
  armor: 0x5f6b55, brass: 0xc9a24a, scarf: 0x9e2f2a, wrap: 0x8a3a2c, cloth: 0xd8c8a4, tuft: 0xf4ece0,
  bell: 0xd9a838, bellHot: 0xfff2c0, steel: 0xd6dbe0, grip: 0x3a2618, edge: 0xe8eef2, edgeHot: 0xffc46a,
};

const _v = new THREE.Vector3();
const _arc = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _plant = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** 关键帧插值：keys = [[u, 值], ...]（u 递增），段内平滑过渡 */
const keyed = (u: number, keys: readonly (readonly [number, number])[]): number => {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, v1] = keys[i];
    if (u <= u1) {
      const [u0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smooth((u - u0) / (u1 - u0));
    }
  }
  return keys[keys.length - 1][1];
};
const _hip = new THREE.Vector3();
const _tHead = new THREE.Vector3();
const _tDir = new THREE.Vector3();
const _tNext = new THREE.Vector3();
const _tVel = new THREE.Vector3();
const _tQ = new THREE.Quaternion();
const _tPQ = new THREE.Quaternion();
const _tDelta = new THREE.Quaternion();
const _tOrigin = new THREE.Vector3();
const _tCur = new THREE.Vector3();

/**
 * 短弯刀的刀身 / 刃口光带几何（模块级缓存）。刀身在 YZ 平面：沿 +Z 伸出，刃口朝 -Y，刀尖上挑；厚度沿 X。
 * 侧面轮廓按设计稿：根部窄、中段略宽、末段上弯收成尖。
 */
let daggerGeo: { blade: THREE.BufferGeometry; edge: THREE.BufferGeometry } | null = null;
function daggerGeometry(): { blade: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  if (daggerGeo) return daggerGeo;
  // 刃口曲线（刀尖 → 根部）与刀背曲线（根部 → 刀尖），单位米；x = 沿刀身，y = 高度
  const edge: [number, number][] = [[0.25, 0.062], [0.215, 0.022], [0.17, -0.004], [0.11, -0.017], [0.05, -0.021], [0, -0.019]];
  const spine: [number, number][] = [[0, 0.017], [0.07, 0.02], [0.13, 0.027], [0.19, 0.041], [0.225, 0.054], [0.25, 0.062]];
  const extrude = (pts: [number, number][], depth: number, bevel: number): THREE.BufferGeometry => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 4,
    });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2); // 轮廓 x → +Z（刀身方向），挤出方向 → X（厚度）
    g.computeVertexNormals();
    return g;
  };
  const outline = [...spine, ...edge.slice(1)];
  // 刃口光带：沿刃口曲线往里收 6 毫米的一条窄带，比刀身略厚，两面都看得见
  const band: [number, number][] = [...edge, ...edge.slice().reverse().map(([x, y]) => [x - 0.004, y + 0.007] as [number, number])];
  daggerGeo = { blade: extrude(outline, 0.006, 0.002), edge: extrude(band, 0.0105, 0) };
  return daggerGeo;
}
/** 美术模型里刀握在掌心：腕关节沿手骨方向往指尖走这么远（米） */
const GRIP_OFFSET = 0.045;

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class JerboaBlade extends StandardEnemy {
  protected hips!: THREE.Group;
  protected torso!: THREE.Group;
  protected head!: THREE.Group;
  protected readonly ears: THREE.Group[] = [];
  protected readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  protected readonly legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[] = [];
  protected readonly tail: THREE.Group[] = [];
  /** 双刀挂点（原生骨架美术不带刀：刀一直是程序化部件，挂到手骨上） */
  protected readonly daggers: THREE.Group[] = [];
  /** 弹跳相位 0..1（0 = 站定；移动时循环） */
  private hopPhase = 0;
  private zigzagTimer = 0;
  private windTime = LEAP_WINDUP;
  private recoverTime = 0.4;
  private leapTime = 0.5;
  private leapHit = false;
  private leapAirborne = false;
  private retried = false;
  private readonly leapDir = new THREE.Vector3();
  private spinAge = Infinity;
  // 平滑后的姿态参数
  private pCrouch = 0;
  private pLean = 0;
  private pArmR = 0;
  private pArmL = 0;
  private pEar = 0;
  private pSpin = 0;
  private bellGlow!: THREE.Mesh;
  /** 上一帧的弹跳相位（判断落地瞬间） */
  private prevHop = 0;
  /** 0..1：当前移速相对满速，决定步幅、腾空高度和前倾 */
  private gaitSpeed = 0;
  /** 触地段两只脚钉住的世界坐标（左、右） */
  private readonly gaitFeet = [new THREE.Vector3(), new THREE.Vector3()];
  private gaitPlanted = false;
  /** 尾根俯仰意图（反向配重）的平滑值 */
  private tailPitch = 0;
  private tailPitchV = 0;
  /** 尾巴弹簧骨骼：每节一个尾端质点（世界坐标，当前 / 上一帧）、骨骼局部的指向轴与长度 */
  private tailSim: { bone: THREE.Bone; axis: THREE.Vector3; localLen: number; tail: THREE.Vector3; prev: THREE.Vector3 }[] = [];
  private tailSimLive = false;
  /** 脚趾底面轮廓点（toe 骨局部坐标，见 afterInit） */
  private toeSole: Partial<Record<'L' | 'R', THREE.Vector3[]>> = {};
  /** 当前的触地段比例（见 STANCE_RANGE）；AI 用它判断是否着地 */
  private stanceFrac = 0.2;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, JERBOA_BLADE_DEF, opts);
    this.walkScale = 1;
    this.stepRate = 2.4;
    this.accel = 34;
    this.cooldown = ctx.rng.range(0.4, 1.6);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fur = flat(C.fur), belly = flat(C.belly), wrap = flat(C.wrap), brass = flat(C.brass, { metal: 0.6, rough: 0.4 });
    // 骨盆（脚底原点，面朝 +Z）
    const hips = joint(root, 0, 0.5, 0);
    this.hips = hips;
    const pelvis = part(hips, Geo.ico(0.12, 1), fur, 0, 0, -0.01);
    pelvis.scale.set(1.05, 0.9, 1.0);
    // 破布裙甲
    part(hips, Geo.box(0.27, 0.16, 0.2, 'top'), flat(C.cloth), 0, 0.02, 0);
    part(hips, Geo.box(0.1, 0.2, 0.02, 'top'), flat(C.scarf), 0, 0.02, 0.105);
    part(hips, Geo.box(0.28, 0.045, 0.21), flat(C.wrap), 0, 0.03, 0);

    // 躯干：小胸甲 + 单侧肩甲
    const torso = joint(hips, 0, 0.04, 0);
    this.torso = torso;
    const chest = part(torso, Geo.ico(0.12, 1), fur, 0, 0.13, 0);
    chest.scale.set(1.0, 1.25, 0.85);
    part(torso, Geo.ico(0.09, 1), belly, 0, 0.1, 0.05).scale.set(1, 1.3, 0.6);
    part(torso, Geo.box(0.22, 0.14, 0.17), flat(C.armor, { metal: 0.35, rough: 0.6 }), 0, 0.14, 0.01);
    part(torso, Geo.box(0.23, 0.025, 0.18), brass, 0, 0.2, 0.01);
    part(torso, Geo.box(0.13, 0.05, 0.14), flat(C.armor, { metal: 0.35, rough: 0.6 }), 0.13, 0.25, 0, 0, 0, -0.35);
    // 红围巾（绕颈 + 背后垂片）
    part(torso, Geo.box(0.2, 0.06, 0.16), flat(C.scarf), 0, 0.27, 0.01);
    part(torso, Geo.box(0.12, 0.2, 0.02, 'top'), flat(C.scarf), 0.03, 0.26, -0.085, 0.15, 0, 0.1);

    // 头：圆脑袋 + 小尖吻 + 大黑眼
    const head = joint(torso, 0, 0.3, 0.01);
    this.head = head;
    part(head, Geo.ico(0.125, 2), fur, 0, 0.04, 0).scale.set(1, 0.95, 1.05);
    part(head, Geo.ico(0.08, 1), belly, 0, 0.0, 0.07).scale.set(1, 0.75, 0.9);
    part(head, Geo.ico(0.018, 0), flat(C.nose), 0, 0.02, 0.15);
    for (const s of [1, -1]) {
      part(head, Geo.ico(0.036, 1), flat(C.eye, { rough: 0.2 }), s * 0.062, 0.055, 0.09);
      // 大耳：根部关节，随动作前后贴伏
      const ear = joint(head, s * 0.06, 0.13, -0.01);
      ear.rotation.z = -s * 0.38;
      this.ears.push(ear);
      part(ear, Geo.ico(0.1, 1), fur, 0, 0.13, 0).scale.set(0.62, 1.35, 0.16);
      part(ear, Geo.ico(0.085, 1), flat(C.ear), 0, 0.13, 0.012).scale.set(0.55, 1.2, 0.1);
    }
    // 两耳之间的铜铃（弱点）
    part(head, Geo.cyl(0.012, 0.012, 0.03, 6), brass, 0, 0.165, 0);
    this.bellGlow = this.glowPart(head, Geo.ico(0.048, 1), C.bell, C.bellHot, 0, 0.13 + 0.06, 0.005, 0);
    this.setHeadAnchor(head, 0, 0.1, 0);

    // 手臂：细，自然下垂略外张
    for (const s of [1, -1]) {
      const shoulder = joint(torso, s * 0.13, 0.22, 0);
      shoulder.rotation.z = s * 0.28;
      part(shoulder, Geo.cyl(0.032, 0.028, 0.15, 6, 'top'), fur, 0, 0, 0);
      const elbow = joint(shoulder, 0, -0.15, 0);
      part(elbow, Geo.cyl(0.028, 0.026, 0.13, 6, 'top'), fur, 0, 0, 0);
      part(elbow, Geo.cyl(0.034, 0.034, 0.05, 6), wrap, 0, -0.1, 0);
      const hand = joint(elbow, 0, -0.14, 0);
      part(hand, Geo.ico(0.033, 1), fur, 0, -0.01, 0.005);
      this.arms.push({ shoulder, elbow, hand });
      // 短弯刀（设计稿）：红缠柄 + 金色云头护手 + 金柄头，单刃弯刀身、刀尖上挑；刃口一条光带（出刀时发亮）
      const dagger = joint(hand, 0, -0.015, 0.01);
      dagger.name = s > 0 ? 'dagger_L' : 'dagger_R';
      dagger.rotation.x = -0.15;
      const dg = daggerGeometry();
      part(dagger, Geo.cyl(0.013, 0.014, 0.085, 8), flat(C.wrap), 0, 0, -0.005, Math.PI / 2, 0, 0);
      for (const z of [-0.03, 0.0, 0.025]) part(dagger, Geo.cyl(0.0155, 0.0155, 0.008, 8), brass, 0, 0, z, Math.PI / 2, 0, 0);
      part(dagger, Geo.ico(0.017, 1), brass, 0, 0, -0.052);
      part(dagger, Geo.box(0.022, 0.07, 0.016), brass, 0, 0.004, 0.044);
      part(dagger, Geo.ico(0.012, 0), brass, 0, 0.04, 0.044);
      part(dagger, Geo.ico(0.012, 0), brass, 0, -0.032, 0.044);
      // 刀身：亮钢色、低金属度（没有反射环境时高金属度会发黑）
      part(dagger, dg.blade, flat(C.steel, { metal: 0.3, rough: 0.32 }), 0, 0, 0.052);
      this.glowPart(dagger, dg.edge, C.edge, C.edgeHot, 0, 0, 0.052, 0);
      this.daggers.push(dagger);
    }

    // 腿：短粗大腿 + 长小腿 + 长脚掌（四趾）
    for (const s of [1, -1]) {
      const hip = joint(hips, s * 0.075, -0.02, 0);
      part(hip, Geo.ico(0.085, 1), fur, s * 0.01, -0.05, 0.01).scale.set(0.95, 1.25, 1.15);
      const knee = joint(hip, 0, -0.16, 0.06);
      part(knee, Geo.cyl(0.035, 0.026, 0.2, 6, 'top'), fur, 0, 0, 0, 0.42, 0, 0);
      const ankle = joint(knee, 0, -0.18, -0.08);
      part(ankle, Geo.cyl(0.036, 0.036, 0.06, 6), wrap, 0, 0, 0);
      part(ankle, Geo.box(0.05, 0.12, 0.05, 'top'), fur, 0, 0.0, 0.0, 0.3, 0, 0);
      part(ankle, Geo.box(0.085, 0.035, 0.2), fur, 0, -0.122, 0.06);
      for (const t of [-1.5, -0.5, 0.5, 1.5]) part(ankle, Geo.cone(0.01, 0.04, 4), flat(C.grip), t * 0.018, -0.13, 0.17, Math.PI / 2, 0, 0);
      this.legs.push({ hip, knee, ankle });
    }

    // 长尾：三节下垂向后，末端白色尾簇
    let parent: THREE.Object3D = hips;
    const pitches = [-0.35, -0.3, -0.2];
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, 0, i === 0 ? -0.1 : -0.17);
      seg.rotation.x = pitches[i];
      part(seg, Geo.box(0.026 - i * 0.004, 0.026 - i * 0.004, 0.17), fur, 0, 0, -0.085);
      this.tail.push(seg);
      parent = seg;
    }
    part(parent, Geo.cyl(0.02, 0.02, 0.03, 6), wrap, 0, 0, -0.17, Math.PI / 2, 0, 0);
    part(parent, Geo.ico(0.06, 1), flat(C.tuft), 0, -0.01, -0.25).scale.set(0.85, 0.85, 1.6);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    const P = n.pose;
    // 弱点判定跟着美术的铜铃骨骼；美术铃铛自带发光壳，白模的发光球收起
    const bell = P.bone('bell');
    if (bell) {
      this.setHeadAnchor(bell, 0, 0, 0);
      if (n.glowShell) this.bellGlow.visible = false;
    }
    // 双刀是程序化部件：挂到美术的手骨上，握在掌心、刀身朝前（按绑定姿势在模型空间摆好再换算到手骨局部）
    P.reset();
    this.model.updateWorldMatrix(true, true);
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      const bone = P.bone(`hand_${side}`);
      const wrist = P.restPosition(`hand_${side}`);
      if (!bone || !wrist) continue;
      const d = this.daggers[i];
      // 掌心 = 腕关节沿手骨（腕 → 指尖）方向前移 GRIP_OFFSET；没有子骨骼时按手臂下垂处理
      const tip = bone.children.find((c) => (c as THREE.Bone).isBone);
      const dir = new THREE.Vector3(0, -1, 0);
      if (tip) dir.copy(this.model.worldToLocal(tip.getWorldPosition(new THREE.Vector3()))).sub(wrist).normalize();
      const palm = wrist.clone().addScaledVector(dir, GRIP_OFFSET); // 模型局部单位（整体缩放在模型根上）
      // 绑定姿势（手臂下垂）时刀尖朝前下方；持刀前举、屈肘约 70° 时刀尖朝前略上
      _q.setFromAxisAngle(AX, 0.95);
      _m.compose(palm, _q, _s.setScalar(1));
      _m.premultiply(this.model.matrixWorld);
      _m2.copy(bone.matrixWorld).invert().multiply(_m);
      bone.add(d);
      _m2.decompose(d.position, d.quaternion, d.scale);
      d.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = true;
      });
    }
    // 尾巴弹簧骨骼：按绑定姿势记下每节的指向与长度（都在骨骼局部，和出生动画的整体缩放无关）；
    // 最后一节没有子骨骼，沿用上一节的方向和长度
    this.tailSim = [];
    const heads = [1, 2, 3, 4].map((i) => P.bone(`tail_${i}`));
    if (heads.every((b): b is THREE.Bone => !!b)) {
      const wp = heads.map((b) => b.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < 4; i++) {
        const b = heads[i];
        const dirW = i < 3 ? wp[i + 1].clone().sub(wp[i]) : wp[3].clone().sub(wp[2]);
        const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
        const localLen = i < 3 ? heads[i + 1].position.length() : heads[3].position.length();
        this.tailSim.push({ bone: b, axis: dirW.normalize().applyQuaternion(inv), localLen, tail: new THREE.Vector3(), prev: new THREE.Vector3() });
      }
    }
    // 脚趾轮廓点（近似凸包）：每帧贴地保护只检查这几十个点（见 poseNative 末尾）
    for (const side of ['L', 'R'] as const) this.toeSole[side] = boneHull(n, `toe_${side}`);
  }

  protected override ai(dt: number): void {
    const p = this.ctx.player.position;
    const d = this.distToPlayerXZ();
    this.spinAge += dt;
    if (this.state !== 'chase' && this.state !== 'leap') this.accel = 34;
    switch (this.state) {
      case 'chase': {
        this.glowTarget[0] = 0.15 + 0.1 * Math.sin(this.age * 3);
        const reach = this.verticalReach(1.6);
        // 双足跳只能在触地时改变速度 / 方向：腾空段几乎没有控制力
        const grounded = this.hopPhase < this.stanceFrac;
        this.accel = grounded ? 70 : 4;
        if (this.cooldown <= 0 && reach && this.sees && grounded) {
          if (d <= SLASH_RANGE + 0.3 && this.requestAttack('melee', 1.2)) {
            this.windTime = this.windup(SLASH_WINDUP, 0.22);
            this.setState('slashWindup');
            this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.35, pitch: 1.9 + this.ctx.rng.range(0, 0.2) });
            break;
          }
          if (d >= LEAP_MIN && d <= LEAP_MAX && this.onGround && this.directPathClear(p) && this.requestAttack('melee', 2.2)) {
            this.retried = false;
            this.beginCrouch(LEAP_WINDUP);
            break;
          }
        }
        // 折线跳：远处直扑，近处（12 米内）左右折线逼近，难以瞄准
        this.zigzagTimer -= dt;
        if (this.zigzagTimer <= 0 && this.hopPhase < this.stanceFrac) {
          this.zigzagTimer = this.ctx.rng.range(ZIGZAG[0], ZIGZAG[1]);
          this.strafeSign = -this.strafeSign || 1;
        }
        if (d > 12 || !this.sees || !reach) {
          this.approachPlayer(this.speed, 1.2);
          this.faceMovement(12, dt);
        } else if (this.cooldown > 0.25) {
          // 冷却中：在扑斩距离带上左右折线跳着绕圈，不贴脸
          this.keepRange(ORBIT[0], ORBIT[1], this.speed, 0.9);
          this.faceTravel(dt);
        } else {
          const dx = p.x - this.position.x, dz = p.z - this.position.z;
          const fwd = d > LEAP_MIN - 0.5 ? 1 : 0.2;
          const side = d > 2 ? 0.85 : 0.4;
          this.setMove(dx / d * fwd - dz / d * this.strafeSign * side, dz / d * fwd + dx / d * this.strafeSign * side, this.speed);
          this.faceTravel(dt);
        }
        break;
      }
      case 'crouch': {
        // 蹲伏蓄力：铃铛亮起、耳朵后贴
        this.stopMoving();
        this.facePlayer(8, dt);
        this.glowTarget[0] = 1;
        if (this.stateTime >= this.windTime) this.launchLeap();
        break;
      }
      case 'leap': {
        this.glowTarget[0] = 1;
        this.desiredX = this.leapDir.x * this.leapSpeed;
        this.desiredZ = this.leapDir.z * this.leapSpeed;
        if (!this.onGround) this.leapAirborne = true;
        // 落地（或撞墙卡住）→ 旋斩
        const landed = this.leapAirborne && this.onGround && this.stateTime > 0.1;
        if (landed || this.stateTime >= this.leapTime + 0.35 || (this.moveResult.hitWall && this.stateTime > 0.15)) this.spin();
        break;
      }
      case 'spin': {
        this.stopMoving();
        this.glowTarget[0] = 0.6;
        if (this.stateTime >= SPIN_TIME) {
          if (this.isElite && !this.leapHit && !this.retried && d >= 2.5 && d <= LEAP_MAX && this.sees) {
            // 精英落空：不硬直，立刻再扑一次
            this.retried = true;
            this.beginCrouch(LEAP_WINDUP * 0.6);
            break;
          }
          this.recoverTime = RECOVER_AFTER_SPIN;
          this.setState('recover');
        }
        break;
      }
      case 'slashWindup': {
        this.glowTarget[0] = 1;
        this.facePlayer(8, dt);
        if (d > 1.0) this.setMove(p.x - this.position.x, p.z - this.position.z, this.def.speed * 0.5);
        else this.stopMoving();
        if (this.stateTime >= this.windTime) {
          this.melee(SLASH_RANGE, this.def.damage, 0.2);
          this.crossSlashFx();
          this.setState('slash');
        }
        break;
      }
      case 'slash': {
        this.glowTarget[0] = 0.5;
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 1.5);
        if (this.stateTime >= 0.14) {
          this.recoverTime = 0.38;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.glowTarget[0] = 0.1;
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(1.4, 2.6);
          // 打了就跑：近身时向后（略斜）跳开
          if (d < 3.5 && this.onGround) {
            const dx = this.position.x - p.x, dz = this.position.z - p.z;
            const len = Math.max(0.01, Math.hypot(dx, dz));
            this.leapDir.set(dx / len - dz / len * this.strafeSign * 0.5, 0, dz / len + dx / len * this.strafeSign * 0.5).normalize();
            this.velocity.set(this.leapDir.x * HOP_BACK_SPEED, 5.2, this.leapDir.z * HOP_BACK_SPEED);
            this.setState('hopBack');
            this.ctx.audio.play('jump', { position: this.position, volume: 0.35, pitch: 1.6 });
          } else {
            this.setState('chase');
          }
        }
        break;
      }
      case 'hopBack': {
        this.glowTarget[0] = 0.1;
        this.desiredX = this.leapDir.x * HOP_BACK_SPEED;
        this.desiredZ = this.leapDir.z * HOP_BACK_SPEED;
        this.facePlayer(6, dt);
        if (this.stateTime >= HOP_BACK_TIME || (this.onGround && this.stateTime > 0.15)) this.setState('chase');
        break;
      }
      default:
        this.setState('chase');
    }
  }

  private leapSpeed = 0;

  /** 跳着走时脸朝前进方向（跳鼠不会侧着蹦）；贴近或几乎不动时才转向玩家 */
  private faceTravel(dt: number): void {
    if (Math.hypot(this.velocity.x, this.velocity.z) > 2 && this.distToPlayerXZ() > 2.4) this.faceMovement(10, dt);
    else this.facePlayer(10, dt);
  }

  private beginCrouch(time: number): void {
    this.windTime = this.windup(time, 0.26);
    this.setState('crouch');
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.45, pitch: 1.9 + this.ctx.rng.range(0, 0.2) });
  }

  /** 真跳跃：按落点距离定飞行时间，起跳竖直速度让它在 leapTime 后回到地面高度 */
  private launchLeap(): void {
    const pl = this.ctx.player;
    let dx = pl.position.x - this.position.x;
    let dz = pl.position.z - this.position.z;
    const est = 0.32 + Math.hypot(dx, dz) * 0.035;
    dx += pl.velocity.x * est * LEAP_LEAD;
    dz += pl.velocity.z * est * LEAP_LEAD;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    const dist = clamp(len - LEAP_SHORT, 1.5, LEAP_MAX);
    this.leapTime = 0.32 + dist * 0.035;
    this.leapSpeed = dist / this.leapTime;
    this.leapDir.set(dx / len, 0, dz / len);
    this.facing = Math.atan2(this.leapDir.x, this.leapDir.z);
    this.velocity.set(this.leapDir.x * this.leapSpeed, GRAVITY * this.leapTime * 0.5, this.leapDir.z * this.leapSpeed);
    this.leapHit = false;
    this.leapAirborne = false;
    this.accel = 60;
    this.setState('leap');
    this.ctx.audio.play('dash', { position: this.position, volume: 0.5, pitch: 1.5 });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.burst(_v, 0xc8a06a, 6, 1.6, 0.35, 0.12, 1);
  }

  /** 落地旋身横斩：360° 判定 + 环形刀光 + 落地扬沙 */
  private spin(): void {
    this.accel = 34;
    this.stopMoving();
    this.velocity.x *= 0.2;
    this.velocity.z *= 0.2;
    this.leapHit = this.melee(SPIN_RANGE, this.def.damage * SPIN_DAMAGE_MULT, -1);
    this.spinAge = 0;
    this.setState('spin');
    const k = this.sizeScale;
    _arc.set(this.position.x, this.position.y + 0.42 * k, this.position.z);
    spawnSlashArc(this.ctx, { center: _arc, yaw: this.facing, radius: SPIN_RANGE * 0.85 * k, arc: Math.PI * 1.9, width: 0.5 * k, duration: 0.26, color: 0xffb54a });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.ring(_v, SPIN_RANGE * k, 0xd8b078, 0.35);
    this.ctx.fx.burst(_v, 0xc8a06a, 10, 2.4, 0.45, 0.14, 1);
    this.ctx.audio.play('land', { position: this.position, volume: 0.5, pitch: 1.4 });
    if (this.leapHit) this.ctx.fx.shake(0.22, 0.15);
  }

  /** 交叉斩：两道斜刀光交成 X */
  private crossSlashFx(): void {
    const k = this.sizeScale;
    _arc.set(this.position.x, this.position.y + 0.55 * k, this.position.z);
    for (const s of [1, -1] as const) {
      spawnSlashArc(this.ctx, { center: _arc, yaw: this.facing, radius: 1.1 * k, arc: 1.7, dir: s, tilt: s * 0.75, width: 0.3 * k, duration: 0.2, color: 0xffc46a });
    }
  }

  protected override cancelAttack(): void {
    this.accel = 34;
    this.glowTarget[0] = 0;
    if (this.state !== 'chase' && this.state !== 'idle' && this.state !== 'hopBack') {
      this.setState('chase');
      this.rollCooldown(0.6, 1.2);
    }
  }

  protected override pose(dt: number): void {
    // 弹跳相位（0 = 落地瞬间）：追击且在动时循环；停下时把这一跳跳完再站定；其他状态归零
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.state === 'chase' && speedNow > 0.6;
    this.gaitSpeed = mix(this.gaitSpeed, clamp01(speedNow / 6.5), 1 - Math.exp(-6 * dt));
    this.prevHop = this.hopPhase;
    if (this.state !== 'chase') this.hopPhase = 0;
    else if (moving || this.hopPhase > 0) {
      this.hopPhase += dt / (HOP_TIME / Math.sqrt(Math.max(0.5, this.speedMult)));
      if (this.hopPhase >= 1) this.hopPhase = moving ? this.hopPhase - 1 : 0;
    }
    const gs = this.gaitSpeed;
    const sweep = mix(STRIDE_AHEAD[0], STRIDE_AHEAD[1], gs) + mix(STRIDE_BEHIND[0], STRIDE_BEHIND[1], gs);
    const hopDur = HOP_TIME / Math.sqrt(Math.max(0.5, this.speedMult));
    // 扫过距离是模型局部单位，换成世界米数再和移速比
    this.stanceFrac = clamp(sweep * this.sizeScale / (Math.max(0.8, speedNow) * hopDur), STANCE_RANGE[0], STANCE_RANGE[1]);
    const sf0 = this.stanceFrac;
    const h = this.hopPhase;
    const hopping = this.state === 'chase' && h > 0;
    // air：腾空弧 0..1..0；squat：触地缓冲 0..1..0
    const air = hopping && h >= sf0 ? Math.sin(Math.PI * (h - sf0) / (1 - sf0)) : 0;
    const squat = hopping && h < sf0 ? Math.sin(Math.PI * h / sf0) : 0;

    const native = !!this.nativeBody;
    // 跑动时身体明显前倾（尾巴平衡），双臂收在胸前持刀
    let crouch = native ? 0 : squat * 0.35;
    let lean = native ? 0.55 * this.gaitSpeed : 0.15 * air;
    let armR = native ? -0.6 : -0.3, armL = armR;
    let ear = 0;
    let rate = 18;
    switch (this.state) {
      case 'crouch': {
        const t = clamp01(this.stateTime / this.windTime);
        crouch = 0.9 * t;
        lean = 0.45 * t;
        armR = 0.9; armL = 0.9; // 双刀向后拖
        ear = t;
        break;
      }
      case 'leap': {
        crouch = 0.15;
        lean = 0.35;
        armR = -1.6; armL = -1.6;
        ear = 1;
        rate = 26;
        break;
      }
      case 'spin':
        crouch = 0.45;
        lean = 0.2;
        armR = -1.45; armL = -1.45;
        ear = 0.6;
        rate = 30;
        break;
      case 'slashWindup':
        crouch = 0.25;
        lean = -0.1;
        armR = -2.6; armL = -2.6;
        ear = 0.5;
        break;
      case 'slash':
        // 交叉斩收势：双臂前伸交叉，刀尖朝前
        crouch = 0.3;
        lean = 0.35;
        armR = -1.1; armL = -1.1;
        rate = 32;
        break;
      case 'recover':
        crouch = 0.2;
        armR = -0.5; armL = -0.5;
        break;
      case 'hopBack':
        crouch = 0.1;
        lean = -0.25;
        armR = -0.8; armL = -0.8;
        ear = 0.7;
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pLean = mix(this.pLean, lean, k);
    this.pArmR = mix(this.pArmR, armR, k);
    this.pArmL = mix(this.pArmL, armL, k);
    this.pEar = mix(this.pEar, ear, 1 - Math.exp(-10 * dt));
    // 旋斩：身体在 SPIN_TIME 内转一整圈（缓出）
    const spinT = clamp01(this.spinAge / SPIN_TIME);
    this.pSpin = spinT < 1 ? Math.PI * 2 * (1 - Math.pow(1 - spinT, 2.5)) : 0;
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, air, squat);
    else this.poseProcedural(air);
  }

  private poseProcedural(air: number): void {
    const c = this.pCrouch;
    const breathe = Math.sin(this.age * 3.1) * 0.01;
    this.hips.position.y = 0.5 - c * 0.17 + air * 0.16 + breathe;
    this.hips.rotation.set(this.pLean * 0.4 - this.hurtKick * 0.25, this.pSpin, this.stunTime > 0 ? Math.sin(this.age * 9) * 0.2 : 0);
    this.torso.rotation.x = this.pLean * 0.6;
    this.head.rotation.x = -this.pLean * 0.7 - this.hurtKick * 0.3 + Math.sin(this.age * 7.3) * 0.03;
    this.head.rotation.y = Math.sin(this.age * 1.9) * 0.12 * (1 - c);
    for (const [i, ear] of this.ears.entries()) {
      // 耳朵：平时微微抽动，蓄力 / 扑跳时向后贴伏
      ear.rotation.x = -this.pEar * 1.1 + Math.sin(this.age * 11 + i * 2) * 0.05;
    }
    for (const [i, a] of this.arms.entries()) {
      a.shoulder.rotation.x = i === 0 ? this.pArmL : this.pArmR;
      a.elbow.rotation.x = -0.5 - 0.3 * c;
    }
    for (const l of this.legs) {
      // 下蹲：髋前屈、膝后屈、踝前屈（脚掌保持贴地）；腾空时两腿并拢后蹬
      l.hip.rotation.x = -0.9 * c + 0.5 * air;
      l.knee.rotation.x = 1.5 * c - 0.2 * air;
      l.ankle.rotation.x = -0.6 * c + 0.5 * air;
    }
    // 尾巴：平衡杆，随前倾抬起、弹跳时甩动
    const swing = Math.sin(this.age * 2.3) * 0.08;
    for (const [i, seg] of this.tail.entries()) {
      seg.rotation.x = [-0.35, -0.3, -0.2][i] + this.pLean * 0.35 + air * 0.15 * (i + 1) * 0.5;
      seg.rotation.y = swing * (i + 1) * 0.6;
    }
  }

  /** 把一条腿的踝按权重 w 拉回绑定位置（脚掌贴地）；w = 0 时也保证踝不低于绑定高度（身体压低时不穿地） */
  private plantLeg(P: NativePose, side: string, w: number, flat = w, lift = 0): void {
    const rest = P.restPosition(`foot_${side}`);
    if (!rest) return;
    P.hostPosition(`foot_${side}`, _foot);
    _plant.lerpVectors(_foot, rest, w);
    _plant.y = Math.max(_plant.y, rest.y + lift);
    if (_plant.distanceToSquared(_foot) < 1e-7 && flat <= 0.001) return;
    P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _plant, flat);
  }

  /**
   * 原生骨架动画（Tripo 人形绑定 + 管线补的耳、尾、铃）。模型空间：X = 跳鼠左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前倾 / 肢体向后摆，负转 = 后仰 / 肢体向前抬；左臂绕 +Z 正转 = 外展（右臂取反）。
   *
   * 追击时是跳鼠 / 袋鼠式双足跳（见 HOP_TIME）：
   * - 触地（相位 0..stanceFrac，随速度自适应）：两脚钉在落点（世界坐标），身体从脚上方越过；先压低缓冲、再蹬伸，脚跟先抬、脚尖最后离地；
   * - 腾空：腿先向后蹬直 → 收到腹下 → 向前伸出准备落地；身体起跳时略抬头、落地前略低头，头部保持水平；
   * - 尾巴近乎水平地平衡，俯仰与身体相反；耳朵向后顺风，落地时往前一甩；双臂收在胸前持刀，落地时被惯性压低。
   */
  private poseNative(n: NativeBody, dt: number, air: number, squat: number): void {
    const P = n.pose;
    P.reset();
    const k = this.sizeScale;
    const c = this.pCrouch;
    const lean = this.pLean;
    const t = this.age;
    const st = this.state;
    const airborne = !this.onGround && (st === 'leap' || st === 'hopBack');
    const breathe = Math.sin(t * 3.1);
    const h = this.hopPhase;
    const gait = st === 'chase' && h > 0;
    const sf = this.gaitSpeed;
    const sfr = this.stanceFrac;
    const stance = gait && h < sfr;
    const s = stance ? h / sfr : 0;                      // 触地进度
    const u = gait && !stance ? (h - sfr) / (1 - sfr) : 0; // 腾空进度
    const land = stance ? Math.sin(Math.PI * s) : 0;             // 落地缓冲 0..1..0
    // 身体俯仰：落地压头 → 蹬地抬头 → 腾空中慢慢转回低头准备落地（首尾相接）
    const pitch = !gait ? 0 : stance
      ? sf * (0.08 * (1 - s) - 0.1 * s + 0.1 * land)
      : sf * (-0.1 + 0.18 * u);

    // 整体：腾空抬高、触地压低；旋斩原地小跳一圈；受击后仰；眩晕摇晃
    const spinHop = this.pSpin > 0 ? Math.sin(Math.min(1, this.spinAge / SPIN_TIME) * Math.PI) : 0;
    // 旋斩是原地小跳：不下蹲（腿不钉地，下蹲会让脚穿进地面）
    // 跑动的髋高：触地基准 -E（落地 / 蹬离瞬间腿斜撑），触地中段再压到 -D，腾空是从 -E 起落的抛物线
    const lowE = HOP_LOW_EDGE * sf, lowD = HOP_LOW_MID * sf;
    const drop = st === 'spin' ? 0 : c * 0.13 + (gait ? lowE + (lowD - lowE) * land : 0);
    const rise = gait && !stance ? HOP_HEIGHT * (0.35 + 0.65 * sf) * 4 * u * (1 - u) : 0;
    // 平移量是模型局部单位（整体缩放在模型根上，不能再乘 sizeScale）
    P.translate('root', 0, rise + spinHop * 0.12 - drop + breathe * 0.004, 0);
    // 地面阴影：身体被动画抬离地面的高度（BlobShadows 据此缩小阴影、沿太阳方向偏开）
    this.visualLift = Math.max(0, rise + spinHop * 0.12) * k;
    if (this.pSpin) P.rotate('root', AY, this.pSpin);
    if (this.stunTime > 0) P.rotate('root', AZ, Math.sin(t * 9) * 0.18);
    const hipPitch = lean * 0.45 + c * 0.25 + pitch - this.hurtKick * 0.35;
    P.rotate('hips', AX, hipPitch);
    P.rotate('spine', AX, lean * 0.2 + breathe * 0.015 * (1 - sf));
    P.rotate('chest', AX, lean * 0.15 - this.hurtKick * 0.15);
    // 头：视线保持水平（抵消前倾与跳跃俯仰）；站着时左右张望、偶尔抽动
    P.rotate('head', AX, -lean * 0.6 - pitch * 0.9 - c * 0.2 - this.hurtKick * 0.3 + Math.sin(t * 7.3) * 0.02 * (1 - sf));
    P.rotate('head', AY, (Math.sin(t * 1.9) * 0.14 + (Math.sin(t * 13) > 0.97 ? 0.15 : 0)) * (1 - c) * (1 - sf));
    // 耳朵：站着时竖起微抖；跑动时向后顺风，落地瞬间往前一甩；蓄力 / 扑跳时贴伏
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      const flick = (Math.sin(t * 11 + sx * 2) * 0.05 + (Math.sin(t * 3.7 + sx) > 0.96 ? 0.25 : 0)) * (1 - sf);
      const run = gait ? -0.35 * sf + 0.3 * sf * land - 0.12 * sf * Math.sin(Math.PI * u) : 0;
      P.rotate(`ear_${side}`, AX, -this.pEar * 0.95 + flick + run);
      P.rotate(`ear_${side}`, AZ, sx * (this.pEar * 0.25 + 0.05 * breathe * (1 - sf) + 0.08 * sf));
    }
    // 铃铛：随头部晃动，落地时一荡
    P.rotate('bell', AX, Math.sin(t * 6.1) * 0.08 * (1 - sf) + 0.25 * land - 0.1 * Math.sin(Math.PI * u));
    P.rotate('bell', AZ, Math.sin(t * 4.3) * 0.08);

    // 手臂：持刀。pArmL / pArmR 是前后摆（负 = 向前抬），另按状态外展、屈肘
    const arms: [string, number, number][] = [['L', this.pArmL, 1], ['R', this.pArmR, -1]];
    for (const [side, swing, sx] of arms) {
      let abduct = 0.15;
      let elbow = -0.9;
      if (st === 'chase') { abduct = 0.1; elbow = -1.3; } // 收在胸前
      else if (st === 'crouch') { abduct = 0.35; elbow = -0.4; }
      else if (st === 'leap') { abduct = 0.55; elbow = -0.3; }
      else if (st === 'spin') { abduct = 1.25; elbow = -0.1; }
      else if (st === 'slashWindup') { abduct = 0.45; elbow = -1.3; }
      else if (st === 'slash') { abduct = -0.35; elbow = -0.25; } // 交叉斩：两臂在身前交叉
      // 跑动：落地时双臂被惯性压低、肘部打开一点，腾空时收回
      const bounce = gait ? 0.2 * sf * land - 0.08 * sf * Math.sin(Math.PI * u) : 0;
      P.rotate(`arm_${side}`, AX, swing + bounce + Math.sin(t * 3 + sx) * 0.04 * (1 - sf));
      P.rotate(`arm_${side}`, AZ, sx * abduct);
      P.rotate(`forearm_${side}`, AX, elbow + bounce * 0.8);
    }

    // 腿
    if (!gait) this.gaitPlanted = false;
    // 脚跟抬起量：触地后半段逐渐抬（脚尖撑地蹬伸），蹬离后的一小段保持，再随收腿归零
    const heelMax = 0.4 + 0.6 * sf;
    const heelUp = stance ? smooth((s - 0.45) / 0.55) * heelMax : gait && u < 0.3 ? heelMax * (1 - smooth(u / 0.3)) : 0;
    const touchdown = stance && (!this.gaitPlanted || h < this.prevHop);
    const tuck = airborne ? 1 : st === 'spin' ? spinHop : 0;
    const kick = st === 'leap' && airborne ? Math.max(0, 1 - this.stateTime / 0.18) : 0;
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      let thigh: number, shin: number, foot: number, toe: number;
      if (gait && stance) {
        // 触地：缓冲时屈膝更深；后半段脚跟先抬、脚趾贴地（蹬伸）
        const off = smooth((s - 0.45) / 0.55) * (0.4 + 0.6 * sf);
        thigh = -0.12 - 0.2 * sf * land;
        shin = 0.24 + 0.35 * sf * land;
        foot = 0.9 * off;
        // 脚趾反转同样的角度：脚掌前倾时脚趾保持水平贴地（美术脚趾整块蒙在 toe 骨上）
        toe = -0.9 * off;
      } else if (gait) {
        // 腾空：蹬直 → 收到腹下（脚跟贴近屁股）→ 前伸准备落地。角度按「相对竖直」写，扣掉髋部前倾，
        // 否则身体前倾会把腿一起甩到后面，看起来像腿吊着
        thigh = keyed(u, [[0, 0.5 * sf], [0.3, -0.95], [0.72, -1.05], [1, -0.8]]) - hipPitch;
        shin = keyed(u, [[0, 0.0], [0.3, 1.55], [0.72, 1.15], [1, 0.55]]);
        foot = keyed(u, [[0, 0.9 * sf], [0.3, -0.45], [1, -0.35]]);
        toe = keyed(u, [[0, -0.6 * sf], [0.4, 0.2], [1, 0]]);
      } else {
        // 站立 / 攻击：预弯膝盖（保证 IK 往前屈膝），腾空时收腿，扑跳起跳瞬间后蹬
        const free = airborne || st === 'spin' ? 1 : 0;
        thigh = -0.12 - tuck * 0.55 + kick * 0.7;
        shin = 0.24 + tuck * 0.85 - kick * 0.4;
        foot = (-tuck * 0.35 + kick * 0.6) * free;
        toe = tuck * 0.4 * free;
      }
      P.rotate(`thigh_${side}`, AX, thigh);
      P.rotate(`shin_${side}`, AX, shin);
      P.rotate(`foot_${side}`, AX, foot);
      P.rotate(`toe_${side}`, AX, toe);

      const rest = P.restPosition(`foot_${side}`);
      if (!rest) continue;
      if (gait) {
        if (touchdown) {
          // 落地：脚落在髋关节前方（沿前进方向）STRIDE_AHEAD 处、贴地；之后整个触地段钉在那里，身体从上方越过
          const f = this.facing;
          const vx = this.velocity.x, vz = this.velocity.z;
          const vl = Math.hypot(vx, vz) || 1;
          const ahead = mix(STRIDE_AHEAD[0], STRIDE_AHEAD[1], sf);
          _foot.copy(rest);
          _foot.x += ((vx * Math.cos(f) - vz * Math.sin(f)) / vl) * ahead;
          _foot.z += ((vx * Math.sin(f) + vz * Math.cos(f)) / vl) * ahead;
          this.gaitFeet[i].copy(this.model.localToWorld(_foot));
        }
        let w = 0;
        if (stance) w = 1;
        else if (u < 0.15) w = 1 - u / 0.15; // 蹬离：腿跟着身体抬起时松开
        if (w > 0) {
          _plant.copy(this.gaitFeet[i]);
          this.model.worldToLocal(_plant);
          _plant.y = rest.y + HEEL_LIFT * heelUp;
          // 身体越过脚太远（跑得快）时让脚贴地滑一点，不把腿拉断
          const hip = P.restPosition(`thigh_${side}`);
          if (hip) {
            _hip.copy(hip);
            const dz = clamp(_plant.z - _hip.z, -FOOT_BEHIND, FOOT_AHEAD); // 模型局部单位（精英的整体缩放已在模型根上）
            if (stance && dz !== _plant.z - _hip.z) {
              _plant.z = _hip.z + dz;
              this.gaitFeet[i].copy(this.model.localToWorld(_foot.copy(_plant)));
            }
          }
          P.hostPosition(`foot_${side}`, _foot);
          _plant.lerpVectors(_foot, _plant, w);
          P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _plant, stance ? 1 - smooth((s - 0.45) / 0.55) * 0.85 : 0);
        } else {
          this.plantLeg(P, side, 0, 0, HEEL_LIFT * heelUp);
        }
      } else {
        const groundW = airborne || st === 'spin' ? 0 : 1;
        this.plantLeg(P, side, groundW, st === 'spin' ? 1 - spinHop : groundW);
      }
    }
    // 脚趾贴地保护：IK 之后脚趾轮廓上最低的点若低于地面，就绕跖球把脚趾抬到刚好贴地。蹬伸时脚掌会随膝的弯曲平面侧倾，
    // 脚趾外缘可能最低，所以检查的是三维轮廓。空中也要查：扑跳落地前一帧身体还没着地，下垂的脚趾已经先插进地里
    const groundY = this.onGround
      ? this.position.y
      : this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.01, this.radius * 0.5);
    if (groundY > this.position.y - 0.4) {
      const floor = P.hostHeight(groundY);
      for (const side of ['L', 'R'] as const) {
        const sole = this.toeSole[side];
        if (sole) P.liftAbove(`toe_${side}`, sole, AX, floor, -1);
      }
    }
    if (touchdown) {
      // 每次落地脚下扬起一小撮沙（快跑时才有，避免原地小跳也冒烟）
      if (this.gaitPlanted && sf > 0.5) {
        _foot.set(this.position.x, this.position.y + 0.04, this.position.z);
        this.ctx.fx.burst(_foot, 0xd8b98a, 2, 0.9, 0.3, 0.08 * k, 1.5);
      }
      this.gaitPlanted = true;
    }

    // 尾巴：跳鼠 / 袋鼠的平衡杆。动画只给「意图」——尾根随前倾抬到接近水平、与腿的前后摆和身体俯仰反向配重；
    // 摆动的惯性、甩尾、鞭梢、转身时被甩开，都交给弹簧骨骼（simulateTail）在世界空间里算出来
    const step = Math.min(dt, 1 / 30);
    const legSwing = !gait ? 0 : stance ? sf * (-0.6 + 1.1 * s) : sf * keyed(u, [[0, 0.5], [0.3, -0.95], [0.72, -1.05], [1, -0.8]]);
    const counter = -0.3 * legSwing - pitch * 1.2 + (airborne ? 0.25 : 0);
    this.tailPitchV += (60 * (counter - this.tailPitch) - 12 * this.tailPitchV) * step;
    this.tailPitch = clamp(this.tailPitch + this.tailPitchV * step, -0.35, 0.6);
    // 尾簇静止时几乎贴地：身体压低多少，尾根就抬多少（尾长约 0.35 米）
    const tailRoot = 0.12 + clamp(drop * 3.2, 0, 0.8);
    // 抬尾的角度主要由尾根承担（模型里尾巴是从臀部往下斜 50° 长出来的，尾根不抬会先下垂再上拐成 V 形），
    // 其余几节分一点，弯成平滑上扬的弧；尾根处蒙皮已加宽过渡（creature_rigs blend_y），不会折出棱
    const share = [0.62, 0.18, 0.12, 0.08];
    // 腾空（扑跳 / 后跳）时尾巴向后伸直，与身体大致成一线（跳鼠飞跃时的姿态）
    const raise = tailRoot + this.tailPitch + Math.max(0, lean) * 0.6 + (gait ? sf * 0.5 : 0) + (airborne ? 0.75 : 0);
    for (let i = 1; i <= 4; i++) {
      const idle = gait ? 0 : Math.sin(t * 2.1 - i * 0.6) * 0.035;
      const lift = raise * share[i - 1] + idle;
      P.rotate(`tail_${i}`, AX, lift);
      if (!gait) P.rotate(`tail_${i}`, AY, Math.sin(t * 1.3 - i * 0.5) * 0.05);
    }
    this.simulateTail(dt);
    void air;
    void squat;

    // 弱点发光壳：平时微光；蓄力 / 出刀时亮
    if (n.glowShell) {
      const gl = this.glowLevel[0];
      n.glowShell.opacity = clamp01(0.12 + 0.06 * Math.sin(t * 3) + gl * gl * 0.7);
    }
  }

  /**
   * 尾巴弹簧骨骼一步（VRM spring bone 的 verlet 形式）：从尾根到尾尖，每节
   * 尾端 += 惯性（上一帧位移 ×(1 - 阻尼)）+ 目标方向 × 刚度 × dt + 重力 × dt，再按节长拉回、不低于地面；
   * 然后把骨骼从「动画目标方向」转到「质点方向」。
   */
  private simulateTail(dt: number): void {
    const sim = this.tailSim;
    if (sim.length === 0) return;
    // 出生动画（从地下升起、整体缩放）期间保持动画姿势，结束后再接上物理
    if (this.age < this.spawnDuration) {
      this.tailSimLive = false;
      return;
    }
    const h = Math.min(dt, 1 / 20);
    const k = this.sizeScale;
    // 出生动画期间模型从地下升起，不做地面碰撞（否则尾巴被地面折弯）
    const groundY = this.onGround && this.age >= this.spawnDuration ? this.position.y + TAIL_CLEARANCE * k : -Infinity;
    // 质点存成「相对角色位置」的偏移（只去掉平移、不去掉转向）：整个身体的跳起 / 落地 / 冲刺不会把尾巴拖坏，
    // 而模型内部的起伏（弹跳、缓冲）和转身仍然带出惯性
    const origin = _tOrigin.copy(this.position);
    for (let i = 0; i < sim.length; i++) {
      const j = sim[i];
      const b = j.bone;
      b.updateWorldMatrix(true, false);
      b.getWorldPosition(_tHead);
      b.getWorldQuaternion(_tQ);
      _tDir.copy(j.axis).applyQuaternion(_tQ); // 动画想要的方向（世界）
      const len = j.localLen * b.getWorldScale(_tVel).x; // 节长（世界）
      _tCur.copy(j.tail).add(origin);
      if (!this.tailSimLive || _tCur.distanceToSquared(_tHead) > 4) {
        _tCur.copy(_tHead).addScaledVector(_tDir, len);
        j.tail.copy(_tCur).sub(origin);
        j.prev.copy(j.tail);
      }
      _tNext.copy(_tCur)
        .addScaledVector(_tVel.subVectors(j.tail, j.prev), 1 - TAIL_DRAG)
        .addScaledVector(_tDir, TAIL_STIFFNESS[i] * h)
        .add(_tVel.set(0, -TAIL_GRAVITY * h, 0));
      // 节长约束 + 关节角度限制 + 地面
      _tNext.sub(_tHead).setLength(len).add(_tHead);
      _tVel.subVectors(_tNext, _tHead).normalize();
      const bend = _tVel.angleTo(_tDir);
      if (bend > TAIL_MAX_BEND) {
        _tDelta.setFromUnitVectors(_tDir, _tVel);
        _tPQ.identity().slerp(_tDelta, TAIL_MAX_BEND / bend);
        _tNext.copy(_tDir).applyQuaternion(_tPQ).multiplyScalar(len).add(_tHead);
      }
      if (_tNext.y < groundY) {
        _tNext.y = groundY;
        _tNext.sub(_tHead).setLength(len).add(_tHead);
      }
      j.prev.copy(j.tail);
      j.tail.copy(_tNext).sub(origin);
      // 骨骼转向质点：世界增量 Δ = from(目标方向 → 质点方向)，局部 = 父⁻¹ · Δ · 当前世界
      _tVel.subVectors(_tNext, _tHead).normalize();
      _tDelta.setFromUnitVectors(_tDir, _tVel);
      b.parent!.getWorldQuaternion(_tPQ).invert();
      b.quaternion.copy(_tPQ.multiply(_tDelta).multiply(_tQ));
    }
    this.tailSimLive = true;
  }
}
