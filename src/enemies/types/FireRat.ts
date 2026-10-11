/**
 * 火浣鼠（fire_rat，第一章 · 赤沙古道的自爆怪）：志怪里的火鼠，一身能织火浣布的火毛。按真实老鼠的体态和习性做：
 * 四足贴地的胖火鼠（短吻、大门牙、蓬松的大火尾），毛尖是雕塑感的火苗。血少（全身都好打），靠「滚成火球冲过来」制造压力：
 *
 * - 窜行：像真老鼠一样一段一段地冲刺（冲 0.4–0.8 秒、顿 0.12–0.3 秒），每段方向偏一点，难瞄。
 * - 人立 → 蜷身：14 米内、直线畅通时后腿人立、抬头尖叫，随即一头蜷成火球（共 0.65 秒，火毛越烧越旺）——前摇。
 * - 滚动冲锋：裹着火焰壳朝玩家滚过来，最高 11 米/秒，转向有限（每秒约 2.2 弧度：横向闪身能甩开），身后拖火尾。
 * - 贴身炸开：离玩家 1.6 米内爆炸（3.2 米，近重远轻）。滚了 0.3 秒后撞墙、或滚满 3 秒时，玩家在 3.5 米内照样炸；
 *   更远说明被闪开了：撞得一弹、舒展开愣 0.8 秒再追（不会在离玩家很远的地方炸掉）。
 * - 死后余火：不管怎么死，都在原地留下一小片燃烧的地面（1.6 米、3 秒，持续小火伤）。
 *   滚动中被击杀时火球照样爆开，但只伤其他敌人（打爆冲进敌群的火鼠是奖励）。
 *
 * 状态机：chase → curl（人立 → 蜷身）→ roll → （自爆）
 *         roll →（滚空）dizzy → chase
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, damp, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { blastPlayer, zonePlayer } from '../Hazards';
import { GroundDecal } from '../bosses/Visuals';
import { createFlameShell, FLAME_TIME } from '../fx/MirageFireball';
import { FLAME_FX_TIME, applyFlameFur, createFlameTongue, spawnFireRing, spawnFlamePillar, spawnGroundFlames, spawnScorch,
  type FlameFurHandle, type FlameTongue } from '../fx/FlameFx';
import { Geo, flat, joint, part } from '../Models';

export const FIRE_RAT_DEF: ScaledEnemyDef = {
  id: 'fire_rat',
  name: '火浣鼠',
  // 美术按真实老鼠的比例做（背高约 0.32、吻到臀约 0.75、尾长约 0.65），游戏里整体放大 1.6 倍：
  // 背高约 0.5 米、连尾全长约 2.2 米，贴地但看得清。下面的尺寸都是放大前的值
  scale: 1.6,
  hp: 26,
  speed: 6,
  radius: 0.26,
  // 含头顶火冠
  height: 0.46,
  damage: 26,
  coins: [1, 2],
  essence: 1,
  // 弱点 =「全身」：判定球罩住身体中段和头（球心离地 0.24），跟着身体移动（人立、蜷成球、滚动时也是）
  headY: 0.24,
  headRadius: 0.26,
  knockbackResist: 0,
  color: 0xff7a2a,
};

const ROLL_RANGE = 14;
/** 人立 + 蜷身的总前摇；前 REAR_FRAC 是后腿人立、尖叫，之后一头蜷成球 */
const CURL_TIME = 0.65;
const REAR_FRAC = 0.55;
/** 窜行：冲刺段与停顿段的时长（秒）、冲刺速度倍率、每段的方向偏摆（弧度） */
const DASH_TIME = [0.4, 0.8] as const;
const PAUSE_TIME = [0.12, 0.3] as const;
const DASH_BOOST = 1.3;
const DASH_JITTER = 0.5;
const ROLL_SPEED = 11;
/** 起滚速度与加速度：从 5 米/秒加速到满速 */
const ROLL_START = 5;
const ROLL_RAMP = 18;
/** 滚动时的转向角速度（弧度/秒）：横向闪身可以甩开 */
const ROLL_TURN = 2.2;
const ROLL_MAX_TIME = 3.0;
/** 撞墙 / 滚满时间时，离玩家这么近才引爆；更远算滚空了：撞晕舒展开，愣一会儿再追 */
const OBSTACLE_BLAST_RANGE = 3.5;
const DIZZY_TIME = 0.8;
/** 滚了这么久之后撞墙就炸（刚起滚时贴着掩体不算） */
const WALL_ARM_TIME = 0.3;
const TRIGGER_RANGE = 1.6;
const BLAST_RADIUS = 3.2;
/** 滚动中被击杀：对其他敌人的爆炸基础伤害（× 等级） */
const DEATH_BLAST_BASE = 32;
const BURN_RADIUS = 1.6;
const BURN_TIME = 3;
const BURN_TICK = 0.5;
/** 余火每跳伤害 = 自爆伤害 × 该比例 */
const BURN_RATIO = 0.12;
/** 球心高度与滚动半径（模型局部单位，脚底原点；半径含火苗毛），白模毛球的核心半径 */
const BALL_Y = 0.3;
const BALL_R = 0.3;
const BALL_CORE = 0.28;
/** 美术身体的中心（吻到臀）比包围盒中心靠前这么多（尾巴向后上方翘）：整体后移，让命中盒罩住整只鼠 */
const ART_SHIFT = 0.12;
/**
 * 四足步态（美术骨骼）：每条腿一个相位，触地段脚往后扫、腾空段抬脚前摆，脚位用两骨 IK 解。
 * 低速对角小跑（左前 + 右后同相），高速过渡到前后成对扒地的半跳跑（老鼠冲刺的样子），步频随速度升高。
 */
const GAIT_FREQ = [2.6, 8.0] as const;
const GAIT_DUTY = [0.62, 0.4] as const;
/** 一步里脚掌相对身体最多扫过多远（模型局部单位）：再快就允许一点打滑，不把腿拉断 */
const GAIT_SWEEP = 0.2;
const GAIT_LIFT = [0.03, 0.07] as const;
/** 腿：上段、下段、末端（腕 / 踝）骨骼名，小跑与半跳跑的相位偏移 */
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, trot: 0, bound: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, trot: 0.5, bound: 0.08 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, trot: 0.5, bound: 0.5 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, trot: 0, bound: 0.58 },
] as const;
/**
 * 贴在骨骼上的火舌（模型空间坐标，已含 ART_SHIFT）：头顶火冠三片、背脊两片、尾尖两片。
 * 位置按美术网格实测（火冠顶约 0.46、尾尖约 0.6 高），火舌底部略埋进毛里，火苗从毛尖里冒出来。
 */
const BODY_TONGUES = [
  { bone: 'head', at: [0, 0.42, 0.08], size: 0.2 },
  { bone: 'head', at: [0.04, 0.4, 0.04], size: 0.14 },
  { bone: 'head', at: [-0.04, 0.4, 0.04], size: 0.14 },
  { bone: 'chest', at: [0, 0.34, -0.07], size: 0.13 },
  { bone: 'spine', at: [0, 0.31, -0.2], size: 0.12 },
  { bone: 'tail_5', at: [-0.02, 0.57, -0.5], size: 0.22 },
  { bone: 'tail_5', at: [-0.01, 0.55, -0.47], size: 0.15 },
] as const;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _t = new THREE.Vector3();

const C = {
  fur: 0xc8502a, furDark: 0x9a3a22, belly: 0xf2dcc0, skin: 0xb8604a, flame: 0xff8a2a, flameTip: 0xffd27a, ear: 0xe07a6a,
  tooth: 0xfff6e6, claw: 0x3a2418, nose: 0xb04a40, eye: 0xff7a1a, eyeHot: 0xfff4b0,
  burn: 0xff7a20, ember: 0xff6a1a, trail: 0xffb040, core: 0xfff3c4,
};

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

export class FireRat extends StandardEnemy {
  /** 人立的支点（后脚掌处）：整只鼠绕它抬起前半身 */
  protected pivot!: THREE.Group;
  protected body!: THREE.Group;
  protected head!: THREE.Group;
  /** 四条腿：左前、右前、左后、右后（每条 = 上段关节 + 下段关节） */
  protected readonly legs: { upper: THREE.Group; lower: THREE.Group; front: boolean; side: number }[] = [];
  protected readonly tail: THREE.Group[] = [];
  /** 蜷成球时罩住身体的「毛球」（白模用；美术是单独的火球模型） */
  private ballSkin!: THREE.Group;
  private shell: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private curlTime = CURL_TIME;
  private rollYaw = 0;
  /** 滚动角（绕身体左右轴，累计） */
  private rollAngle = 0;
  private detonated = false;
  private clearTimer = 0;
  private pathClear = false;
  private trailAcc = 0;
  private emberAcc = 0;
  /** 窜行：当前段剩余时间、是否在冲刺、本段方向偏摆 */
  private dashTimer = 0;
  private dashing = true;
  private dashYaw = 0;
  // 平滑后的姿态参数
  private pCurl = 0;
  private pRear = 0;
  private pFire = 0;
  private pPause = 0;
  /** 步态相位（0..1 循环） */
  private gait = 0;
  /** 美术身体已切换成火球（蜷身过半） */
  private balled = false;
  /** 毛尖自发光（美术身体、美术火球各一份材质） */
  private furs: FlameFurHandle[] = [];
  /** 骨骼 / 火球上的火舌；ball = 挂在火球上（只在滚球形态显示） */
  private tongues: { m: FlameTongue; ball: boolean; base: number; phase: number }[] = [];
  /** 火星从这些位置飘起（火冠、尾尖） */
  private emitters: THREE.Object3D[] = [];
  /** 挂上了美术火球（自带火苗毛）：火焰壳只留一层淡淡的热光，不盖住模型 */
  private artBall = false;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FIRE_RAT_DEF, opts);
    this.deathDuration = 0.35;
    this.accel = 40;
    this.walkScale = 1;
    this.stepRate = 3.6;
    this.cooldown = ctx.rng.range(0.3, 1.2);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fur = flat(C.fur), dark = flat(C.furDark), belly = flat(C.belly), claw = flat(C.claw, { rough: 0.5 });
    const skin = flat(C.skin, { rough: 0.6 });
    const flame = flat(C.flame, { emissive: 0x7a2a08 }), tip = flat(C.flameTip, { emissive: 0x9a6a20 });
    /** 一撮雕塑感的火苗毛：橙红锥 + 浅金尖 */
    const tuft = (parent: THREE.Object3D, x: number, y: number, z: number, rx: number, rz: number, s = 1): void => {
      const g = joint(parent, x, y, z);
      g.rotation.set(rx, 0, rz);
      part(g, Geo.cone(0.04 * s, 0.13 * s, 5, 'bottom'), flame, 0, 0, 0);
      part(g, Geo.cone(0.021 * s, 0.075 * s, 5, 'bottom'), tip, 0, 0.09 * s, 0);
    };

    // 人立支点在后脚掌：抬前半身时后脚不离地
    const pivot = joint(root, 0, 0, -0.2);
    this.pivot = pivot;
    // 身体：长而圆的鼠身，背微拱（身体中心离地 0.22）
    const body = joint(pivot, 0, 0.22, 0.2);
    this.body = body;
    part(body, Geo.ico(0.2, 2), fur, 0, 0.01, 0).scale.set(0.78, 0.72, 1.75);
    part(body, Geo.ico(0.16, 2), belly, 0, -0.05, 0.04).scale.set(0.8, 0.6, 1.7);
    // 背脊一排火苗毛（向后翻卷）
    for (let i = 0; i < 6; i++) {
      const z = 0.22 - i * 0.09;
      tuft(body, 0, 0.13 - Math.abs(z) * 0.12, z, -1.0, 0, 1.25 - i * 0.06);
      tuft(body, 0.07, 0.1 - Math.abs(z) * 0.1, z - 0.03, -1.15, -0.7, 0.9);
      tuft(body, -0.07, 0.1 - Math.abs(z) * 0.1, z - 0.03, -1.15, 0.7, 0.9);
    }

    // 头：尖吻、粉鼻头、大门牙、发光小眼、圆耳，头顶一簇火冠
    const head = joint(body, 0, 0.04, 0.33);
    this.head = head;
    part(head, Geo.ico(0.1, 2), fur, 0, 0, 0).scale.set(0.95, 0.9, 1.15);
    part(head, Geo.cone(0.065, 0.16, 8), fur, 0, -0.015, 0.13, Math.PI / 2, 0, 0);
    part(head, Geo.ico(0.06, 1), belly, 0, -0.045, 0.08).scale.set(1, 0.6, 1.3);
    part(head, Geo.ico(0.018, 1), flat(C.nose), 0, -0.012, 0.215);
    for (const s of [1, -1]) {
      part(head, Geo.box(0.016, 0.04, 0.01), flat(C.tooth, { rough: 0.4 }), s * 0.009, -0.06, 0.19);
      this.glowPart(head, Geo.ico(0.02, 1), C.eye, C.eyeHot, s * 0.055, 0.03, 0.07);
      part(head, Geo.box(0.05, 0.016, 0.02), dark, s * 0.05, 0.06, 0.07, 0, 0, s * 0.4);
      part(head, Geo.ico(0.05, 1), fur, s * 0.07, 0.08, -0.03).scale.set(1, 1, 0.3);
      part(head, Geo.ico(0.036, 1), flat(C.ear), s * 0.07, 0.08, -0.018).scale.set(1, 1, 0.25);
    }
    tuft(head, 0, 0.08, 0.0, -0.35, 0, 1.3);
    tuft(head, 0.035, 0.07, -0.03, -0.6, -0.4, 1.0);
    tuft(head, -0.035, 0.07, -0.03, -0.6, 0.4, 1.0);
    this.setHeadAnchor(body, 0, 0.02, 0.02);

    // 四条腿：前腿短直，后腿长、脚掌长（前四趾、后五趾）
    for (const front of [true, false]) {
      for (const side of [1, -1]) {
        const upper = joint(body, side * 0.08, -0.06, front ? 0.2 : -0.18);
        part(upper, Geo.ico(front ? 0.05 : 0.07, 1), fur, 0, -0.02, 0).scale.set(0.9, 1.2, 1.1);
        const lower = joint(upper, 0, front ? -0.08 : -0.07, front ? 0.01 : -0.02);
        part(lower, Geo.cyl(0.018, 0.015, 0.07, 6, 'top'), skin, 0, 0, 0);
        part(lower, Geo.box(0.04, 0.015, front ? 0.05 : 0.08), skin, 0, -0.075, front ? 0.015 : 0.03);
        const toes = front ? 4 : 5;
        for (let k = 0; k < toes; k++) {
          part(lower, Geo.cone(0.005, 0.025, 4), claw, (k - (toes - 1) / 2) * 0.009, -0.078, front ? 0.05 : 0.075, Math.PI / 2, 0, 0);
        }
        this.legs.push({ upper, lower, front, side });
      }
    }

    // 细长鼠尾：五节向后上翘，根粗尖细，顶上几撮小火苗，尾尖一大簇火
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 5; i++) {
      const seg = joint(parent, 0, 0, i === 0 ? -0.33 : -0.13);
      seg.rotation.x = i === 0 ? 0.25 : 0.12;
      const r = 0.026 - i * 0.004;
      part(seg, Geo.cyl(r * 0.8, r, 0.135, 6), skin, 0, 0, -0.065, Math.PI / 2, 0, 0);
      if (i < 4) tuft(seg, 0, r, -0.06, -1.1, 0, 0.55 + i * 0.05);
      this.tail.push(seg);
      parent = seg;
    }
    tuft(parent, 0, 0.0, -0.13, -1.2, 0, 1.5);
    tuft(parent, 0.02, 0.0, -0.12, -1.3, -0.6, 1.1);
    tuft(parent, -0.02, 0.0, -0.12, -1.3, 0.6, 1.1);

    // 蜷成球时的毛球外皮（平时缩没），挂在根节点的球心上
    // 挂点名 fire_ball：美术的火球模型（SM_EnemyPart_FireRatBall）挂在这里
    const ball = joint(root, 0, BALL_Y, 0);
    ball.name = 'fire_ball';
    this.ballSkin = ball;
    part(ball, Geo.ico(BALL_CORE, 2), fur, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      // 均匀撒在球面上的火苗毛（黄金角螺旋）
      const y = 1 - (i + 0.5) / 7, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
      const n = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
      const g = joint(ball, n.x * BALL_CORE * 0.92, n.y * BALL_CORE * 0.92, n.z * BALL_CORE * 0.92);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      part(g, Geo.cone(0.045, 0.06, 5, 'bottom'), flame, 0, 0, 0);
      part(g, Geo.cone(0.022, 0.04, 5, 'bottom'), tip, 0, 0.05, 0);
    }
    ball.scale.setScalar(0.01);
    ball.visible = false;
    return root;
  }

  protected override afterInit(): void {
    // 火焰壳挂在模型上（随整体缩放），不进实例材质克隆（共享火舌时间）
    const shell = createFlameShell(C.flame, 0);
    shell.position.set(0, BALL_Y, 0);
    shell.scale.setScalar(BALL_R * 1.5);
    shell.visible = false;
    this.model.add(shell);
    this.shell = shell;
    const n = this.nativeBody;
    if (!n) return;
    // 白模身体整组隐藏（含发光的眼睛）；毛球挂点留着给美术火球
    this.pivot.visible = false;
    this.ballSkin.visible = false;
    // 美术火球还没挂上（清单里没有 SM_EnemyPart_FireRatBall）：白模毛球重新显示出来顶替
    this.artBall = this.ballSkin.children.some((o) => (o as THREE.LOD).isLOD);
    if (!this.artBall) {
      this.ballSkin.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.visible = true; });
    }
    const host = this.model.children[0];
    let top: THREE.Object3D = n.lod;
    while (top.parent && top.parent !== host) top = top.parent;
    top.position.z -= ART_SHIFT;
    // 弱点判定球挂到脊柱骨上：身体中段（后移之后的模型坐标），人立、蜷身时跟着身体走
    const spine = n.pose.bone('spine');
    if (spine) {
      host.updateWorldMatrix(true, true);
      const anchor = new THREE.Object3D();
      spine.add(anchor);
      anchor.position.copy(spine.worldToLocal(host.localToWorld(new THREE.Vector3(0, 0.22, 0.02))));
      this.setHeadAnchor(anchor, 0, 0, 0);
    }
    this.buildFlameFx(n);
  }

  /** 贴合模型的火焰：毛尖自发光、骨骼上的火舌、火球上的火舌 */
  private buildFlameFx(n: NativeBody): void {
    this.furs.push(applyFlameFur(n.materials[0]));
    let ballMat: THREE.MeshStandardMaterial | null = null;
    this.ballSkin.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!ballMat && this.artBall && (o as THREE.Mesh).isMesh && m?.isMeshStandardMaterial) ballMat = m;
    });
    if (ballMat) this.furs.push(applyFlameFur(ballMat));
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    const ws = new THREE.Vector3();
    // 出生时模型还在 0.01 倍的缩放动画里：尺寸按「相对模型根」折算，不能直接用世界缩放
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    const attach = (parent: THREE.Object3D, hostPoint: THREE.Vector3, size: number, ball: boolean): FlameTongue => {
      const m = createFlameTongue();
      parent.add(m);
      m.position.copy(parent.worldToLocal(host.localToWorld(hostPoint.clone())));
      // 火舌大小以模型单位给（size），换算成父节点局部缩放（骨骼的缩放各不相同）
      const base = (size * hostScale) / Math.max(1e-6, parent.getWorldScale(ws).x);
      m.scale.setScalar(base);
      this.tongues.push({ m, ball, base, phase: Math.random() * 10 });
      return m;
    };
    for (const t of BODY_TONGUES) {
      const bone = n.pose.bone(t.bone);
      if (!bone) continue;
      const m = attach(bone, new THREE.Vector3(t.at[0], t.at[1], t.at[2]), t.size, false);
      if (t.bone === 'head' && t.size > 0.15) this.emitters.push(m);
      if (t.bone === 'tail_5' && t.size > 0.2) this.emitters.push(m);
    }
    // 火球：一圈火舌插在球面上（随球滚动，像燃烧的火轮）。挂点平时缩到 0.01 藏着：挂的时候临时恢复 1 倍
    const ballScale = this.ballSkin.scale.x;
    this.ballSkin.scale.setScalar(1);
    this.ballSkin.updateWorldMatrix(true, false);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.8, 0.6 * (i % 2 ? 1 : -0.2), Math.sin(a) * 0.8).normalize();
      attach(this.ballSkin, dir.multiplyScalar(BALL_CORE * 1.02).add(new THREE.Vector3(0, BALL_Y, 0)), 0.22, true);
    }
    this.ballSkin.scale.setScalar(ballScale);
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase': {
        this.glowTarget[0] = 0.2 + 0.1 * Math.sin(this.age * 6);
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) {
          this.clearTimer = 0.2;
          this.pathClear = this.sees && d <= ROLL_RANGE && this.verticalReach(1.2) && (d < 4 || this.directPathClear(pl.position));
        }
        if (this.cooldown <= 0 && this.pathClear && d <= ROLL_RANGE) {
          this.curlTime = this.windup(CURL_TIME, 0.4);
          this.setState('curl');
          this.stopMoving();
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 1.7 });
          break;
        }
        // 窜行：冲一段、顿一下，每段方向偏一点（真老鼠的走法）
        this.dashTimer -= dt;
        if (this.dashTimer <= 0) {
          this.dashing = !this.dashing || d < 3;
          this.dashTimer = this.dashing ? this.ctx.rng.range(DASH_TIME[0], DASH_TIME[1]) : this.ctx.rng.range(PAUSE_TIME[0], PAUSE_TIME[1]);
          this.dashYaw = this.ctx.rng.range(-DASH_JITTER, DASH_JITTER);
        }
        if (!this.dashing) {
          this.stopMoving();
          this.facePlayer(6, dt);
          break;
        }
        this.approachPlayer(this.speed * DASH_BOOST, 0.5);
        if (this.sees && d > 4) {
          // 视野内的开阔地：在寻路方向上加本段的偏摆
          const a = Math.atan2(this.desiredX, this.desiredZ) + this.dashYaw;
          this.setMove(Math.sin(a), Math.cos(a), this.speed * DASH_BOOST);
        }
        this.faceMovement(14, dt);
        break;
      }
      case 'curl': {
        this.stopMoving();
        this.facePlayer(8, dt);
        const t = clamp01(this.stateTime / this.curlTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.tintBody(0xff6a1a, t * 0.7);
        if (this.stateTime >= this.curlTime) {
          this.rollYaw = this.facing;
          this.trailAcc = 0;
          this.accel = 60;
          this.setState('roll');
          this.getBodyCenter(_c);
          this.ctx.fx.burst(_c, C.trail, 10, 3.5, 0.35, 0.18, -1);
        }
        break;
      }
      case 'roll': {
        // 有限转向追玩家；起滚后加速到满速
        _p.subVectors(pl.position, this.position);
        this.rollYaw = rotateTowards(this.rollYaw, Math.atan2(_p.x, _p.z), ROLL_TURN * (this.isElite ? 1.3 : 1) * dt);
        const v = Math.min(ROLL_SPEED * (this.isElite ? 1.15 : 1), ROLL_START + this.stateTime * ROLL_RAMP);
        this.setMove(Math.sin(this.rollYaw), Math.cos(this.rollYaw), v);
        this.facing = this.rollYaw;
        this.glowTarget[0] = 1;
        const near = d <= TRIGGER_RANGE && this.verticalReach(1.8);
        const wall = this.moveResult.hitWall && this.stateTime > WALL_ARM_TIME;
        const timeout = this.stateTime >= ROLL_MAX_TIME;
        if (near) this.detonate();
        else if (wall || timeout) {
          // 撞墙 / 滚满时间：玩家就在附近（贴着掩体）照样炸；离得远 = 被闪开了，撞晕而不是在半路炸掉
          if (d <= OBSTACLE_BLAST_RANGE && this.verticalReach(1.8)) this.detonate();
          else this.bonk(wall);
        }
        break;
      }
      case 'dizzy': {
        // 滚空撞晕：原地愣着、慢慢舒展开，然后重新去追
        this.stopMoving();
        this.glowTarget[0] = 0.3;
        if (this.stateTime >= DIZZY_TIME) {
          this.setState('chase');
          this.rollCooldown(1.5, 2.5);
        }
        break;
      }
      default:
        this.setState('chase');
    }
  }

  /** 滚空了（撞墙 / 滚满时间时玩家不在附近）：撞得一弹，舒展开愣一会儿，不在半路爆炸 */
  private bonk(wall: boolean): void {
    this.setState('dizzy');
    this.accel = 40;
    this.restoreTint();
    if (wall) {
      // 撞墙反弹一小段
      this.velocity.x *= -0.35;
      this.velocity.z *= -0.35;
    }
    this.getBodyCenter(_c);
    this.ctx.fx.burst(_c, C.ember, 12, 3.5, 0.6, 0.06, 6);
    this.ctx.fx.burst(_c, C.trail, 6, 2, 0.3, 0.25 * this.sizeScale, -1);
    this.ctx.audio.play('land', { position: _c, volume: 0.6, pitch: 1.4 });
  }

  /** 自爆：伤害玩家、爆炸特效、留下余火，自身死亡（不经过 combat：不算玩家击杀、不掉落） */
  private detonate(): void {
    if (this.detonated || !this.alive) return;
    this.detonated = true;
    this.getBodyCenter(_c);
    const center = _c.clone();
    this.ctx.fx.explosion(center, BLAST_RADIUS, 0xff8a2a);
    this.ctx.audio.play('explosion', { position: center, pitch: 1.15 });
    this.blastFx(center);
    blastPlayer(this.ctx, center, BLAST_RADIUS, this.def.damage * this.damageMult, 'fire', this, 0.5, 0.7);
    this.leaveBurn(center);
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    const req: DamageRequest = { base: 0, element: 'fire', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'fire', statusApplied: null,
    };
    this.onKilled(res);
  }

  protected override onDeath(r: DamageResult): void {
    const rolling = this.state === 'roll';
    super.onDeath(r);
    if (this.detonated || attackDirector.purging) return;
    this.detonated = true;
    const ctx = this.ctx;
    const center = this.getBodyCenter(new THREE.Vector3());
    this.leaveBurn(center);
    if (!rolling) {
      // 走路 / 蜷身时被打死：火毛散成一团火星
      ctx.fx.burst(center, C.trail, 12, 3, 0.45, 0.16 * this.sizeScale, -2);
      ctx.fx.burst(center, C.ember, 14, 4, 0.9, 0.06, 3);
      return;
    }
    // 滚动中被打爆：火球照样炸开，只伤其他敌人（延后结算，避免在 combat 结算里递归）
    const base = DEATH_BLAST_BASE * this.level * (this.isElite ? 1.5 : 1);
    this.blastFx(center);
    ctx.tasks.delay(0.06, () => {
      ctx.combat.explode(center, BLAST_RADIUS, {
        base, element: 'fire', source: 'explosion', procDepth: 1, elementChance: 0.6, canCrit: false, knockback: 6,
      }, { playerDamage: 0, color: 0xff8a2a, falloff: 0.5 });
    });
  }

  /** 爆炸的附加层：冲击环、上冲的火团、余烬 */
  private blastFx(center: THREE.Vector3): void {
    const fx = this.ctx.fx;
    const gy = this.ctx.world.groundHeight(center.x, center.z, center.y + 1);
    _p.set(center.x, Number.isFinite(gy) ? Math.min(gy, center.y) : this.position.y, center.z);
    // 贴地火环冲击波 + 上冲的火柱 + 留在地上的焦痕（比余火久）
    const ground = _p.clone();
    spawnFireRing(this.ctx, ground, BLAST_RADIUS * 1.05);
    spawnFlamePillar(this.ctx, ground, 0.9, 2.6 * (this.isElite ? 1.2 : 1));
    spawnScorch(this.ctx, ground, BLAST_RADIUS * 0.6, 8);
    _p.y += 0.3;
    fx.burst(_p, 0xffb040, 10, 2.2, 0.5, 0.4, -6);
    fx.burst(center, C.ember, 24, 6, 1.2, 0.06, 4);
  }

  /** 死后余火：流动的熔沙贴花、冒火星，每 0.5 秒对站在里面的玩家结算一次小火伤 */
  private leaveBurn(center: THREE.Vector3): void {
    const ctx = this.ctx;
    const gy = ctx.world.groundHeight(center.x, center.z, center.y + 1);
    const ground = new THREE.Vector3(center.x, Number.isFinite(gy) ? Math.min(gy, center.y) : this.position.y, center.z);
    // 悬空（从高台边滚下去时炸在半空）就不留余火
    if (center.y - ground.y > 2.5) return;
    const r = BURN_RADIUS * (this.isElite ? 1.25 : 1);
    const dmg = this.def.damage * this.damageMult * BURN_RATIO;
    const decal = GroundDecal.acquire(ctx.stageGroup, C.burn).circle(ground.x, ground.y, ground.z, r);
    decal.pattern = 1;
    spawnGroundFlames(ctx, ground, r * 0.75, this.isElite ? 9 : 7, BURN_TIME, 0.9);
    let t = 0, tick = BURN_TICK, sparks = 0;
    ctx.tasks.add((dt) => {
      t += dt;
      decal.time = t;
      decal.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - Math.max(0, t - (BURN_TIME - 0.8)) / 0.8);
      tick -= dt;
      if (tick <= 0) {
        tick += BURN_TICK;
        zonePlayer(ctx, ground, r, dmg, 'fire', null);
      }
      sparks += dt;
      if (sparks > 0.1 && t < BURN_TIME - 0.4) {
        sparks = 0;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r;
        _p.set(ground.x + Math.cos(a) * rr, ground.y + 0.1, ground.z + Math.sin(a) * rr);
        ctx.fx.burst(_p, Math.random() < 0.5 ? C.ember : C.trail, 1, 1.0, 0.6, 0.08, -3);
      }
      if (t >= BURN_TIME) {
        decal.release();
        return true;
      }
      return false;
    });
  }

  protected override animateDeath(t: number): void {
    // 炸开：一下膨胀后缩没
    const s = this.sizeScale * (t < 0.3 ? 1 + t * 1.3 : Math.max(0.01, 1.39 * (1 - (t - 0.3) / 0.7)));
    this.model.scale.setScalar(s);
    if (this.shell) this.shell.material.uniforms.uAlpha.value *= 0.8;
  }

  protected override cancelAttack(): void {
    // 蜷身 / 滚动被打断（眩晕、清理、玩家死亡）：舒展开回去追
    if (this.state === 'curl' || this.state === 'roll') {
      this.setState('chase');
      this.restoreTint();
      this.accel = 30;
      this.rollCooldown(1.2, 2.2);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.shell?.material.dispose();
    this.shell = null;
    for (const t of this.tongues) t.m.material.dispose();
    this.tongues.length = 0;
  }

  protected override pose(dt: number): void {
    const curling = this.state === 'curl';
    const rolling = this.state === 'roll';
    const curlT = curling ? clamp01(this.stateTime / this.curlTime) : 0;
    // 前 REAR_FRAC 人立，之后蜷身（人立同时收回）
    const curlK = curling ? clamp01((curlT - REAR_FRAC) / (1 - REAR_FRAC)) : 0;
    const rearK = curling ? (curlT < REAR_FRAC ? Math.sin((curlT / REAR_FRAC) * Math.PI * 0.5) : 1 - curlK) : 0;
    this.pRear = damp(this.pRear, rearK, 18, dt);
    this.pCurl = damp(this.pCurl, rolling ? 1 : curlK, rolling ? 30 : 18, dt);
    this.pPause = damp(this.pPause, this.state === 'chase' && !this.dashing ? 1 : 0, 10, dt);
    // 火焰壳只在蜷身和滚动时燃起；人立时靠火星变密提示
    this.pFire = damp(this.pFire, rolling ? 1 : curlK, 12, dt);
    const c = this.pCurl;
    const host = this.model.children[0];

    // 滚动：整个身体绕球心滚（白模和美术身体都挂在 host 下）
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (rolling) this.rollAngle += (sp * dt) / (BALL_R * this.sizeScale);
    else this.rollAngle = damp(this.rollAngle, Math.round(this.rollAngle / (Math.PI * 2)) * Math.PI * 2, 8, dt); // 被打断：滚回正立
    const th = this.rollAngle;
    host.rotation.x = th;
    host.position.set(0, BALL_Y - BALL_Y * Math.cos(th) - (rolling ? BALL_Y - BALL_R : 0), -BALL_Y * Math.sin(th));

    if (this.nativeBody) this.poseNative(this.nativeBody, c, sp, dt);
    else this.poseBlockout(c, sp);

    // 火焰壳：蜷身时燃起，滚动时整个罩住
    const shell = this.shell;
    if (shell) {
      FLAME_TIME.value = this.ctx.time.now;
      const a = this.pFire * (this.artBall ? 0.14 : 0.55);
      shell.material.uniforms.uAlpha.value = a;
      shell.visible = a > 0.02;
      shell.scale.setScalar(BALL_R * ((this.artBall ? 0.95 : 1.05) + (this.artBall ? 0.1 : 0.2) * this.pFire) * (1 + 0.05 * Math.sin(this.age * 23)));
      shell.rotation.set(this.age * 2.1, this.age * 3.4, 0);
    }

    // 贴合模型的火焰：毛尖自发光与火舌跟着状态变旺（平时微亮，人立更亮，蜷身 / 滚动最亮）
    FLAME_FX_TIME.value = this.ctx.time.now;
    const heat = Math.max(this.pFire, this.pRear);
    for (const f of this.furs) f.glow.value = 0.35 + 0.75 * heat + 0.08 * Math.sin(this.age * 11);
    for (const t of this.tongues) {
      t.m.visible = t.ball === this.balled;
      const flick = 1 + 0.12 * Math.sin(this.age * 13 + t.phase) + 0.06 * Math.sin(this.age * 29 + t.phase * 2);
      const grow = t.ball ? 1.15 : 0.85 + 0.45 * heat;
      t.m.scale.set(t.base * grow * 0.95, t.base * grow * flick, t.base * grow);
      t.m.material.uniforms.uAlpha.value = t.ball ? 0.95 : 0.6 + 0.4 * heat;
    }
    // 火星：从火冠、尾尖的火舌里飘起（白模从身体随机处），蜷身越来越密，滚动时拖一条火尾
    this.emberAcc += dt * (0.25 + heat * 0.75);
    if (this.emberAcc > 0.22) {
      this.emberAcc = 0;
      const src = !this.balled && this.emitters.length ? this.emitters[Math.floor(Math.random() * this.emitters.length)] : null;
      if (src) src.getWorldPosition(_p).y += 0.12 * this.sizeScale;
      else this.localPoint((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.25, (Math.random() - 0.6) * 0.4, _p);
      this.ctx.fx.burst(_p, C.ember, 1, 0.7, 0.7, 0.05, -2.5);
    }
    if (rolling) {
      this.trailAcc += sp * dt;
      while (this.trailAcc >= 0.18) {
        this.trailAcc -= 0.18;
        this.localPoint(0, BALL_R * 0.8, -BALL_R * 0.9, _p);
        this.ctx.fx.burst(_p, C.trail, 1, 0.3, 0.38, 0.4 * this.sizeScale, -1.5);
        this.localPoint(0, 0.06, -BALL_R * 0.6, _p);
        this.ctx.fx.burst(_p, C.core, 1, 0.15, 0.2, 0.22 * this.sizeScale, 0);
      }
    }
  }

  /**
   * 美术骨骼动画（四足）：步态相位驱动四条腿的 IK 目标；身体随步子起伏、冲刺时脊柱一屈一伸；
   * 停顿时抬头左右嗅；人立时绕髋抬起前半身（后脚钉地、前爪收到胸前、仰头）；蜷身过半换成火球模型。
   */
  private poseNative(n: NativeBody, c: number, sp: number, dt: number): void {
    // 蜷身过半：身体换成火球模型（挂点 fire_ball），换的一瞬间爆一团火盖住
    const ball = c > 0.5;
    if (ball !== this.balled) {
      this.balled = ball;
      this.getBodyCenter(_c);
      this.ctx.fx.burst(_c, C.trail, 14, 3.2, 0.35, 0.32 * this.sizeScale, -2);
      this.ctx.fx.burst(_c, C.core, 6, 1.5, 0.25, 0.4 * this.sizeScale, 0);
    }
    n.lod.visible = !ball;
    const sk = this.ballSkin;
    sk.visible = ball;
    sk.scale.setScalar(ball ? 0.75 + 0.25 * clamp01((c - 0.5) / 0.25) : 0.01);
    if (ball) return;

    const P = n.pose;
    P.reset();
    const rear = this.pRear;
    const move = clamp01(sp / 1.5);
    const sn = clamp01(sp / (this.speed * DASH_BOOST)) * (1 - c) * (1 - rear);
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * sn;
    // 触地段脚掌相对身体扫过的距离 = 移速 × 触地时长（换成模型局部单位），脚就钉在地上不滑
    const sweep = Math.min(GAIT_SWEEP, (sp * duty) / (freq * this.sizeScale)) * (1 - c) * (1 - rear);
    const lift = (GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * sn) * move * (1 - rear);
    const ph = this.gait * Math.PI * 2;

    // 身体：起伏、冲刺时前倾和脊柱屈伸；受击后仰；眩晕摇晃
    P.translate('hips', 0, 0.012 * sn * Math.sin(ph * 2) - 0.03 * rear, -0.03 * rear);
    P.rotate('hips', AX, 0.05 * sn - rear * 1.0 + c * 0.7);
    P.rotate('spine', AX, 0.12 * sn * Math.sin(ph) + c * 0.6);
    P.rotate('chest', AX, -0.08 * sn * Math.sin(ph + 0.5) - rear * 0.25 + c * 0.5 - this.hurtKick * 0.3);
    if (this.stunTime > 0 || this.state === 'dizzy') P.rotate('hips', AZ, Math.sin(this.age * 8) * 0.2);
    // 头：跑动时稳住视线，停顿时抬头左右嗅，人立时仰头尖叫，蜷身时埋头
    const sniff = this.pPause;
    P.rotate('neck', AX, -0.12 * sn * Math.sin(ph) + rear * 0.6 + c * 0.6 - sniff * 0.15);
    P.rotate('head', AX, rear * 0.3 + c * 0.5 - sniff * 0.15 + Math.sin(this.age * 7) * 0.03 * sniff);
    P.rotate('head', AY, sniff * Math.sin(this.age * 9) * 0.3);
    // 尾巴：冲刺时压平，跑动时左右甩、波沿尾巴往后传；停顿时轻摆；人立时撑地；蜷身时卷起
    const wag = 0.06 + 0.18 * sn + 0.08 * sniff;
    for (let i = 1; i <= 5; i++) {
      const b = `tail_${i}`;
      if (i === 1) P.rotate(b, AX, -0.45 * sn + rear * 1.0);
      P.rotate(b, AX, c * 0.4 + 0.04 * Math.sin(this.age * 3 + i));
      P.rotate(b, AY, wag * Math.sin(this.age * (5 + 6 * sn) - i * 0.7));
    }
    // 前爪：人立时收到胸前（不走 IK）
    if (rear > 0.02) {
      for (const s of ['L', 'R']) {
        P.rotate(`upperarm_${s}`, AX, 0.8 * rear);
        P.rotate(`forearm_${s}`, AX, 0.9 * rear);
      }
    }
    // 腿 IK：触地段从前往后扫，腾空段抬脚前摆；蜷身时收到腹下
    for (const leg of LEGS) {
      if (leg.front && rear > 0.02) continue;
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const off = leg.trot + (leg.bound - leg.trot) * sn;
      const u = (this.gait + off) % 1;
      let dz: number, dy: number;
      if (u < duty) {
        dz = sweep * (0.5 - u / duty);
        dy = 0;
      } else {
        const t = (u - duty) / (1 - duty);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * lift;
      }
      _t.set(rest.x, rest.y + dy + c * (leg.front ? 0.12 : 0.1), rest.z - ART_SHIFT + dz + c * (leg.front ? -0.1 : 0.08));
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1);
    }
  }

  /**
   * 白模动画：四足窜行（对角小跑，身体随步子起伏），停顿时抬头嗅、尾巴轻摆；
   * 人立时绕后脚抬起前半身、前爪收在胸前，随后低头收腿蜷成毛球。
   */
  private poseBlockout(c: number, sp: number): void {
    const amp = Math.min(1.2, sp / Math.max(1, this.def.speed)) * (1 - c);
    const ph = this.walkPhase * 1.8;
    const rear = this.pRear;
    this.pivot.rotation.x = -rear * 1.05;
    const b = this.body;
    b.position.y = 0.22 + Math.abs(Math.sin(ph)) * 0.025 * amp;
    b.rotation.x = Math.sin(ph * 2) * 0.05 * amp + c * 0.5 - this.hurtKick * 0.25;
    b.rotation.z = this.stunTime > 0 || this.state === 'dizzy' ? Math.sin(this.age * 8) * 0.25 : 0;
    b.scale.setScalar(Math.max(0.01, 1 - Math.max(0, c - 0.5) * 2));
    // 头：跑动时前伸，停顿时抬头左右嗅，人立时仰头尖叫
    const sniff = this.pPause * Math.sin(this.age * 9) * 0.25;
    this.head.rotation.set(-0.1 * amp - rear * 0.5 + c * 0.6 - this.pPause * 0.25, sniff, 0);
    for (const l of this.legs) {
      // 对角小跑：左前 + 右后 同相
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph + off);
      if (l.front) {
        l.upper.rotation.x = swing * 0.7 * amp - rear * 1.2 - c * 0.8;
        l.lower.rotation.x = Math.max(0, -swing) * 0.6 * amp + rear * 1.6;
      } else {
        l.upper.rotation.x = swing * 0.8 * amp + rear * 0.9 - c * 0.6;
        l.lower.rotation.x = -Math.max(0, swing) * 0.5 * amp - rear * 0.9;
      }
    }
    // 尾巴：跑动时左右甩、后段跟随（波沿尾巴传下去），人立时压低撑地
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      seg.rotation.x = (i === 0 ? 0.25 : 0.12) + Math.sin(this.age * 4 + i * 0.7) * 0.05 + rear * (i === 0 ? 0.6 : 0.05) + c * 0.4;
      seg.rotation.y = Math.sin(ph * 0.5 - i * 0.8) * 0.22 * amp + Math.sin(this.age * 2.3 - i) * 0.08;
    }
    const sk = this.ballSkin;
    const k = clamp01((c - 0.45) / 0.4);
    sk.visible = k > 0.01;
    sk.scale.setScalar(Math.max(0.01, k));
  }

}
