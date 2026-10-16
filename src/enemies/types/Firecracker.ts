/**
 * 炮仗傀儡（firecracker，第三章 · 祝融火狱的炮击怪，炉宫）：庙会提线木偶，提线烧断了，自己走。红漆木身、球关节，
 * 大圆木头脑袋上画着笑脸，胸口整个是明代「一窝蜂」六角火箭箱，两串鞭炮像子弹带一样挂在肩上，箱底腹部是铜火药仓（弱点）。
 * 按木偶的样子动：关节是刚性的木块，走路一顿一顿（一步迈出去、停一下、再迈），脑袋转头也是一格一格地「咔」过去；
 * 鞭炮串和冠顶绒球跟着身体的顿挫甩（弹簧骨骼）。
 *
 * - 保持距离：在 12–22 米外一顿一顿地挪，太近就退开；24 米内不需要视线就能开炮（火箭从头顶落下）。
 * - 一窝蜂（10–30 米、约每 6 秒，拿到重型令牌）：蹲下扎马、胸前箱盖「啪」地弹开（0.35 秒）→ 引信火花沿箱沿的导线
 *   一路烧到箱底火药仓（1.2 秒，火药仓越来越亮）→ 8 支火箭（精英 12 支）冲天，玩家周围 6 米内每个落点立刻亮出
 *   朱红偏洋红的预警圈，约 1.3–2 秒内从高空斜砸下来，各炸 1.6 米，落点留一小片残火烧 2.5 秒（祸斗会来吃）。
 *   走出预警区就躲开。
 * - 打断引信：引信烧着时打中腹部火药仓 → 箱子当场哑炸：火箭四散乱飞，落在傀儡周围 2.5–7 米（也炸伤它的同伴、
 *   能把它们推进熔岩），傀儡被炸得仰面倒地 2 秒（输出窗口）。
 * - 地老鼠：玩家在 8 米内时跺脚（0.4 秒），从脚下撒出 4 个地老鼠烟花贴地乱窜追脚，碰到脚或 2.5 秒后炸（起跳、后撤）。
 * - 连环爆：死时火箭箱炸开（3.5 米，玩家在里面也挨炸），引爆 3.5 米内其他炮仗傀儡和神火飞鸦（一只接一只），
 *   其余敌人吃火药伤害并被炸飞（见 inferno/ExplosiveChain.ts）。
 * - 弱点 = 腹部发亮的铜火药仓（命中球，打中算爆头）。头、箱体、骨盆、小腿各有命中球（跟着骨骼走）。
 *   箱盖是运行时程序化的单独部件（铰链在箱顶，挂在 chest 骨上），美术网格里没有。
 *
 * 状态机：march → brace → fuse → volley → recover → march
 *         march → stomp →（撒地老鼠）recover → march
 *         fuse →（火药仓中弹）toppled → getup → march
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { blastPlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { FROST_FX_TIME, Spring, applyFrostGlow, hitAnchor, raycastSpheres, type FrostGlowHandle, type HitSphere } from '../fx/FrostSkirmishFx';
import { FuseSpark, INFERNO, gunpowderBlast, launchRocketVolley, spawnGroundRats } from '../fx/InfernoBlastFx';
import { chainBlast, detonateKin, type ExplosiveKin } from '../inferno/ExplosiveChain';

export const FIRECRACKER_DEF: ScaledEnemyDef = {
  id: 'firecracker',
  name: '炮仗傀儡',
  // 美术按 1.9 米制作，游戏里放大 1.2 倍（约 2.3 米）；下面的尺寸都是放大前的值
  scale: 1.2,
  hp: 160,
  speed: 2.5,
  radius: 0.42,
  height: 1.9,
  // 每支火箭的伤害（地老鼠、死亡爆炸按比例）
  damage: 16,
  coins: [3, 6],
  essence: 1,
  // 头部判定球 = 画着笑脸的木头脑袋（头不是弱点：命中球里它算身体，弱点是腹部火药仓）
  headY: 1.52,
  headRadius: 0.2,
  knockbackResist: 0.3,
  color: 0xff5a2a,
};

/** 保持距离（米）、开炮距离、不需要视线的开炮距离 */
const KEEP = [12, 22] as const;
const FIRE_RANGE = [10, 30] as const;
const BLIND_FIRE = 24;
/** 一窝蜂：扎马弹盖、引信、齐射、收势（秒），冷却 */
const BRACE_TIME = 0.35;
const FUSE_TIME = 1.2;
const VOLLEY_TIME = 0.5;
const RECOVER_TIME = 0.9;
const VOLLEY_COOLDOWN = [5.5, 6.5] as const;
/** 火箭：数量、落点离玩家最远、爆炸半径、最早落地（从齐射开始）、相邻落地间隔、落点最小间距 */
const ROCKETS = 8;
const ROCKETS_ELITE = 12;
const SPREAD = 6;
const ROCKET_RADIUS = 1.6;
const ROCKET_FIRST = 1.3;
const ROCKET_STAGGER = 0.09;
const ROCKET_GAP = 1.7;
/** 火箭落点留下的残火：半径、持续、每 0.5 秒一跳的伤害占火箭伤害的比例 */
const FLOOR_FIRE = { radius: 1.0, time: 2.5, mult: 0.12 } as const;
/** 地老鼠：触发距离、跺脚前摇、数量、寿命、速度、爆炸半径、伤害倍率、冷却 */
const RAT_RANGE = 8;
const STOMP_TIME = 0.4;
const RATS = 4;
const RAT_LIFE = 2.5;
const RAT_SPEED = 5.2;
const RAT_RADIUS = 1.4;
const RAT_MULT = 0.6;
const RAT_COOLDOWN = [5, 6.5] as const;
/** 哑炸：仰倒时长、起身、乱飞火箭落点离傀儡的距离、伤害倍率、对敌人的基础伤害（× 等级）、击退 */
const TOPPLE_TIME = 2.0;
const GETUP_TIME = 0.6;
const DUD_RING = [2.5, 7] as const;
const DUD_MULT = 0.8;
const DUD_ENEMY_BASE = 30;
const DUD_KNOCK = 6;
/** 死亡爆炸：半径（米，不随体型）、对敌人的基础伤害（× 等级，精英 ×1.5）、击退、对玩家的伤害倍率 */
const BLAST_RADIUS = 3.5;
const BLAST_BASE = 70;
const BLAST_KNOCK = 9;
const BLAST_MULT = 1.0;
/** 木偶步态：一步的时长（秒）、迈腿占一步的比例、迈腿 / 停顿时的移速倍率（整步平均约等于 1） */
const STEP_TIME = 0.62;
const SWING = 0.42;
const SWING_SPEED = 1.95;
const HOLD_SPEED = 0.3;
/** 转头一格（弧度）：木偶的头是一格一格「咔」过去的 */
const HEAD_NOTCH = 0.2;

/**
 * 美术网格实测（模型空间、未缩放；Blender (x, y, z) → (x, z, -y)）：火药仓、箱口、箱盖铰链、引信导线、命中球。
 */
const BELLY = new THREE.Vector3(0, 0.76, 0.17);
const BELLY_R = 0.2;
const BOX_MUZZLE = new THREE.Vector3(0, 1.08, 0.3);
const LID_HINGE = new THREE.Vector3(0, 1.275, 0.29);
/** 箱盖：尖顶六边形，外接圆半径 */
const LID_R = 0.215;
/** 引信导线：从箱顶沿箱子左沿（生物左侧）烧到箱底，再进火药仓的引信口 */
const FUSE_PATH = [
  new THREE.Vector3(0, 1.25, 0.3), new THREE.Vector3(0.19, 1.16, 0.3), new THREE.Vector3(0.19, 0.97, 0.3),
  new THREE.Vector3(0, 0.87, 0.29), new THREE.Vector3(0, 0.71, 0.26),
];
const HITS = [
  { bone: 'chest', at: BELLY, r: BELLY_R, head: true },
  { bone: 'chest', at: new THREE.Vector3(0, 1.1, 0.02), r: 0.32, head: false },
  { bone: 'head', at: new THREE.Vector3(0, 1.52, 0), r: 0.22, head: false },
  { bone: 'hips', at: new THREE.Vector3(0, 0.6, 0), r: 0.24, head: false },
  { bone: 'shin_L', at: new THREE.Vector3(0.19, 0.3, 0), r: 0.16, head: false },
  { bone: 'shin_R', at: new THREE.Vector3(-0.19, 0.3, 0), r: 0.16, head: false },
] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const SIDES = ['L', 'R'] as const;

const C = {
  lacquer: 0xc0281c, dark: 0x2a1a14, wood: 0xd8b48a, face: 0xf2e4d0, cheek: 0xe8504a, brass: 0xc8963a,
  cap: 0x1e1612, pompom: 0xe0202a, belly: 0xffa040, bellyHot: 0xfff0b0, tube: 0xd8302a, tubeHot: 0xffd070,
};

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** 每帧的姿态参数（美术骨骼与白模共用） */
interface PuppetPose {
  /** 两条腿的迈步量（0..1）与支撑腿后蹬量 */
  swingL: number;
  swingR: number;
  /** 身体：上下（模型单位）、侧倾、前后倾 */
  bob: number;
  roll: number;
  lean: number;
  /** 扎马（0..1）、双臂张开（0..1）、后坐（0..1） */
  squat: number;
  arms: number;
  recoil: number;
  /** 头的偏航（已按格量化）、俯仰 */
  headYaw: number;
  headPitch: number;
  /** 鞭炮串（左右各：前后甩、左右甩）与绒球 */
  strPitch: [number, number];
  strRoll: [number, number];
  pomPitch: number;
  pomRoll: number;
}

/** 在 parent 上挂一个与模型空间同向、同尺度的插槽（host 空间坐标 x, y, z） */
function alignedSocket(parent: THREE.Object3D, host: THREE.Object3D, at: THREE.Vector3): THREE.Object3D {
  const a = new THREE.Object3D();
  parent.add(a);
  host.updateWorldMatrix(true, true);
  a.position.copy(parent.worldToLocal(host.localToWorld(_t.copy(at))));
  a.quaternion.copy(parent.getWorldQuaternion(_qa).invert().multiply(host.getWorldQuaternion(_qb)));
  a.scale.setScalar(host.getWorldScale(_s).x / Math.max(1e-6, parent.getWorldScale(_q).x));
  return a;
}

export class Firecracker extends StandardEnemy implements ExplosiveKin {
  readonly explosiveKin = true as const;

  // 白模关节
  private hipsJ!: THREE.Group;
  private chestJ!: THREE.Group;
  private headJ!: THREE.Group;
  private pomJ!: THREE.Group;
  private readonly armJ: { upper: THREE.Group; fore: THREE.Group }[] = [];
  private readonly legJ: { thigh: THREE.Group; shin: THREE.Group }[] = [];
  private readonly strJ: THREE.Group[][] = [];
  private bellyGlow!: THREE.Mesh;
  private readonly tubeGlows: THREE.Mesh[] = [];
  // 运行时部件
  private lidHinge: THREE.Object3D | null = null;
  private lidMats: THREE.Material[] = [];
  private fuse: FuseSpark | null = null;
  private bellyAnchor!: THREE.Object3D;
  private muzzleAnchor!: THREE.Object3D;
  private readonly hits: HitSphere[] = [];
  private glow: FrostGlowHandle | null = null;
  // 行为
  private braceTime = BRACE_TIME;
  private fuseTime = FUSE_TIME;
  private ratCd: number;
  private launched = 0;
  private volleyTargets: THREE.Vector3[] = [];
  private stompDone = false;
  private dudAge = Infinity;
  private volleyAge = Infinity;
  private primed = false;
  private detonated = false;
  /** 木偶步态：当前一步的进度（0..1）、这一步迈哪条腿 */
  private gait = 0;
  private stepLeg = 0;
  // 姿态
  private lidOpen = 0;
  private readonly pose$: PuppetPose = {
    swingL: 0, swingR: 0, bob: 0, roll: 0, lean: 0, squat: 0, arms: 0, recoil: 0, headYaw: 0, headPitch: 0,
    strPitch: [0, 0], strRoll: [0, 0], pomPitch: 0, pomRoll: 0,
  };
  private readonly sStr = SIDES.map(() => ({ p: new Spring(55, 0.28), r: new Spring(45, 0.3) }));
  private readonly sPom = { p: new Spring(70, 0.25), r: new Spring(70, 0.25) };
  private readonly sLid = new Spring(140, 0.45);
  private readonly sTopple = new Spring(30, 0.7);
  private prevVel = new THREE.Vector3();
  private headNotch = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FIRECRACKER_DEF, opts);
    this.accel = 14;
    this.walkScale = 0.6;
    this.deathDuration = 0.45;
    this.cooldown = ctx.rng.range(1.5, 3.0);
    this.ratCd = ctx.rng.range(0.5, 1.5);
    this.setState('march');
  }

  /** 木偶步态：只在迈腿时快走，停顿时几乎不动（整步平均约等于 def.speed） */
  override get speed(): number {
    const swinging = this.gait < SWING;
    return super.speed * (swinging ? SWING_SPEED : HOLD_SPEED);
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const lac = flat(C.lacquer, { rough: 0.55 }), dark = flat(C.dark, { rough: 0.7 }), wood = flat(C.wood, { rough: 0.8 });
    const brass = flat(C.brass, { rough: 0.4, metal: 0.6 });
    // 骨盆
    const hips = joint(root, 0, 0.62, 0);
    this.hipsJ = hips;
    part(hips, Geo.box(0.34, 0.16, 0.26), lac, 0, 0, 0);
    // 两条腿：大腿、膝球、小腿、脚
    for (const s of [1, -1]) {
      const thigh = joint(hips, s * 0.145, 0.1, 0);
      part(thigh, Geo.cyl(0.08, 0.075, 0.2, 7), lac, 0, -0.12, 0);
      part(thigh, Geo.ico(0.07, 1), dark, 0.02 * s, -0.235, 0);
      const shin = joint(thigh, s * 0.03, -0.235, 0);
      part(shin, Geo.cyl(0.085, 0.09, 0.3, 7), dark, 0.02 * s, -0.18, 0);
      part(shin, Geo.box(0.17, 0.09, 0.32), lac, 0.04 * s, -0.36, 0.05);
      this.legJ.push({ thigh, shin });
    }
    // 胸：六角火箭箱 + 腹部铜火药仓（弱点）
    const chest = joint(hips, 0, 0.18, 0);
    this.chestJ = chest;
    part(chest, Geo.cyl(0.25, 0.25, 0.42, 6), lac, 0, 0.29, 0, Math.PI / 2, 0, 0).scale.set(1, 1, 1.1);
    part(chest, Geo.ico(0.17, 1), brass, 0, -0.04, 0.08);
    this.bellyGlow = this.glowPart(chest, Geo.ico(0.1, 1), C.belly, C.bellyHot, 0, -0.04, 0.17, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2, r = i === 6 ? 0 : 0.12;
      this.tubeGlows.push(this.glowPart(chest, Geo.cyl(0.035, 0.035, 0.05, 6), C.tube, C.tubeHot,
        Math.cos(a) * r, 0.28 + Math.sin(a) * r, 0.24, 1));
    }
    for (const g of this.tubeGlows) g.rotation.x = Math.PI / 2;
    // 两串鞭炮（每串三节：肩下、腰侧、纸尾）
    for (const s of [1, -1]) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = chest;
      const at = [[s * 0.23, 0.53, 0], [s * 0.03, -0.3, 0], [s * 0.03, -0.27, 0]] as const;
      for (let i = 0; i < 3; i++) {
        const g = joint(parent, at[i][0], at[i][1], at[i][2]);
        for (let k = 0; k < 3; k++) part(g, Geo.cyl(0.03, 0.03, 0.08, 5), lac, 0.02 * s, -0.05 - k * 0.09, 0.06 * (k % 2 ? 1 : -1), 0, 0, 1.2);
        chain.push(g);
        parent = g;
      }
      this.strJ.push(chain);
    }
    // 两臂：上臂、肘球、前臂、木手
    for (const s of [1, -1]) {
      const upper = joint(chest, s * 0.29, 0.44, -0.06);
      part(upper, Geo.cyl(0.07, 0.07, 0.24, 7), lac, s * 0.06, -0.13, 0, 0, 0, s * 0.4);
      part(upper, Geo.ico(0.065, 1), dark, s * 0.115, -0.265, 0);
      const fore = joint(upper, s * 0.115, -0.265, 0.02);
      part(fore, Geo.cyl(0.075, 0.07, 0.22, 7), lac, s * 0.035, -0.11, 0, 0, 0, s * 0.3);
      part(fore, Geo.box(0.1, 0.22, 0.12), wood, s * 0.07, -0.33, 0);
      this.armJ.push({ upper, fore });
    }
    // 头：大圆木头脑袋、笑脸、黑帽、红绒球
    const head = joint(chest, 0, 0.57, 0);
    this.headJ = head;
    part(head, Geo.ico(0.2, 2), wood, 0, 0.15, 0);
    part(head, Geo.ico(0.17, 1), flat(C.face, { rough: 0.6 }), 0, 0.14, 0.06).scale.set(1, 1, 0.8);
    for (const s of [1, -1]) part(head, Geo.ico(0.04, 1), flat(C.cheek), s * 0.1, 0.1, 0.17);
    part(head, Geo.cyl(0.17, 0.2, 0.08, 10), flat(C.cap, { rough: 0.6 }), 0, 0.31, 0);
    const pom = joint(head, 0, 0.35, 0.03);
    this.pomJ = pom;
    part(pom, Geo.ico(0.06, 1), flat(C.pompom), 0, 0.08, 0);
    // 箱盖
    this.lidHinge = this.buildLid(chest, _p.set(LID_HINGE.x, LID_HINGE.y - 0.8, LID_HINGE.z));
    this.bellyAnchor = joint(chest, BELLY.x, BELLY.y - 0.8, BELLY.z);
    this.muzzleAnchor = joint(chest, BOX_MUZZLE.x, BOX_MUZZLE.y - 0.8, BOX_MUZZLE.z);
    this.setHeadAnchor(head, 0, 0.15, 0);
    return root;
  }

  /**
   * 箱盖（单独部件，程序化）：红漆尖顶六边形木板，金边、黑色内框、中间一枚铜钉帽和六颗角钉。铰链在箱顶尖角，
   * 弹开时绕水平轴向前上方翻起。材质由本敌人持有（白模与美术版共用这一套）。
   */
  private buildLid(parent: THREE.Object3D, at: THREE.Vector3): THREE.Object3D {
    const hinge = new THREE.Object3D();
    hinge.position.copy(at);
    parent.add(hinge);
    return this.fillLid(hinge);
  }

  private fillLid(hinge: THREE.Object3D): THREE.Object3D {
    const mk = (color: number, rough: number, metal = 0): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
      this.lidMats.push(m);
      return m;
    };
    const lac = mk(C.lacquer, 0.45), rim = mk(C.brass, 0.35, 0.6), inner = mk(C.dark, 0.6), stud = mk(0xe8c060, 0.3, 0.7);
    // 尖顶六边形：Cylinder(6) 绕 X 转 90° 后一个角朝 +Y、一个角朝 −Y
    const board = new THREE.Group();
    board.position.set(0, -LID_R, 0);
    hinge.add(board);
    const plate = new THREE.Mesh(Geo.cyl(LID_R, LID_R, 0.03, 6), lac);
    plate.rotation.x = Math.PI / 2;
    const frame = new THREE.Mesh(Geo.cyl(LID_R + 0.012, LID_R + 0.012, 0.018, 6), rim);
    frame.rotation.x = Math.PI / 2;
    frame.position.z = -0.008;
    const inset = new THREE.Mesh(Geo.cyl(LID_R * 0.72, LID_R * 0.72, 0.012, 6), inner);
    inset.rotation.x = Math.PI / 2;
    inset.position.z = 0.017;
    const boss = new THREE.Mesh(Geo.ico(0.035, 1), stud);
    boss.position.z = 0.03;
    board.add(plate, frame, inset, boss);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = new THREE.Mesh(Geo.ico(0.014, 0), stud);
      s.position.set(Math.sin(a) * LID_R * 0.86, Math.cos(a) * LID_R * 0.86, 0.02);
      board.add(s);
    }
    board.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return hinge;
  }

  // ───────────── 美术身体 ─────────────

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    const at = (bone: string, fallback: THREE.Object3D): THREE.Object3D => P?.bone(bone) ?? fallback;
    const fallbackFor = (bone: string): THREE.Object3D => {
      if (bone === 'head') return this.headJ;
      if (bone === 'hips') return this.hipsJ;
      if (bone === 'shin_L') return this.legJ[0].shin;
      if (bone === 'shin_R') return this.legJ[1].shin;
      return this.chestJ;
    };
    if (n) {
      // 白模的实体部件已被隐藏；箱盖是单独部件：挪到美术的 chest 骨上（铰链与模型空间同向）
      this.lidHinge?.removeFromParent();
      this.lidHinge = this.fillLid(alignedSocket(at('chest', this.chestJ), host, LID_HINGE));
      this.bellyGlow.visible = false;
      for (const g of this.tubeGlows) g.visible = false;
      this.bellyAnchor = hitAnchor(at('chest', this.chestJ), host, BELLY.x, BELLY.y, BELLY.z);
      this.muzzleAnchor = hitAnchor(at('chest', this.chestJ), host, BOX_MUZZLE.x, BOX_MUZZLE.y, BOX_MUZZLE.z);
      this.setHeadAnchor(hitAnchor(at('head', this.headJ), host, 0, 1.52, 0), 0, 0, 0);
      this.glow = applyFrostGlow(n.materials[0], 'firecracker', [
        // 腹部铜火药仓：贴图上发亮的橙色（引信烧着时越来越亮）
        { color: 0xff8a2a, hue: [0.08, 0.07], minSat: 0.35, minVal: 0.55, sphere: { center: [BELLY.x, BELLY.y, BELLY.z], radius: 0.26 }, shimmer: 0.5 },
        // 箱口的蜂窝火箭管口（齐射瞬间闪亮）
        { color: 0xffb040, hue: [0.0, 0.07], minSat: 0.45, box: { min: [-0.25, 0.85, 0.15], max: [0.25, 1.32, 0.45], soft: 0.03 }, shimmer: 0.6 },
      ]);
    }
    // 引信导线挂在箱子上（白模挂在胸关节、美术挂在 chest 骨的同向插槽上）
    const fuseParent = n ? alignedSocket(at('chest', this.chestJ), host, _p.set(0, 0, 0)) : this.chestJ;
    const pts = FUSE_PATH.map((v) => (n ? v.clone() : v.clone().setY(v.y - 0.8)));
    this.fuse = new FuseSpark(fuseParent, pts, 0.045);
    for (const h of HITS) {
      const parent = at(h.bone, fallbackFor(h.bone));
      const a = n ? hitAnchor(parent, host, h.at.x, h.at.y, h.at.z) : this.blockoutAnchor(h.bone, h.at);
      this.hits.push({ anchor: a, r: h.r, head: h.head });
    }
  }

  /** 白模上的命中锚点：按关节在模型空间的静止位置换算 */
  private blockoutAnchor(bone: string, at: THREE.Vector3): THREE.Object3D {
    const host = this.model.children[0];
    const parent = bone === 'head' ? this.headJ : bone === 'hips' ? this.hipsJ
      : bone === 'shin_L' ? this.legJ[0].shin : bone === 'shin_R' ? this.legJ[1].shin : this.chestJ;
    return hitAnchor(parent, host, at.x, at.y, at.z);
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.muzzleAnchor && this.alive) return this.muzzleAnchor.getWorldPosition(out);
    return this.localPoint(BOX_MUZZLE.x, BOX_MUZZLE.y, BOX_MUZZLE.z, out);
  }

  /** 火药仓的世界位置 */
  bellyCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.bellyAnchor && this.alive && this.age >= this.spawnDuration) return this.bellyAnchor.getWorldPosition(out);
    return this.localPoint(BELLY.x, BELLY.y, BELLY.z, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(0, 1.0, 0, out);
  }

  // ───────────── AI ─────────────

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    if (this.state !== 'fuse' || !this.alive) return;
    // 打断引信：打中腹部火药仓。直射命中火药仓的命中球会标成爆头（命中点在球面上）；投射物看命中点离火药仓多近
    //（投射物的爆头是木头脑袋，离火药仓很远，不算）
    const pt = r.request.point;
    const k = this.sizeScale;
    const dist = pt ? pt.distanceTo(this.bellyCenter(_q)) : Infinity;
    if ((r.request.headshot && dist <= 0.45 * k) || dist <= (BELLY_R + 0.08) * k) this.dud();
  }

  protected override ai(dt: number): void {
    if (this.ratCd > 0) this.ratCd -= dt;
    this.dudAge += dt;
    this.volleyAge += dt;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
      case 'march': {
        this.glowTarget[0] = 0.12;
        if (this.ratCd <= 0 && d < RAT_RANGE && this.verticalReach(2) && this.requestAttack('melee', STOMP_TIME + 0.6)) {
          this.stompDone = false;
          this.setState('stomp');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.3 });
          break;
        }
        const canLob = this.sees || d <= BLIND_FIRE;
        if (!canLob && this.seekSight(KEEP[0], KEEP[1], this.speed)) {
          this.faceMovement(3, dt);
          break;
        }
        this.march(d, dt);
        if (this.cooldown <= 0 && canLob && d >= FIRE_RANGE[0] && d <= FIRE_RANGE[1]) {
          if (this.requestAttack('heavy', BRACE_TIME + FUSE_TIME + VOLLEY_TIME + 1.2)) {
            this.braceTime = this.windup(BRACE_TIME, 0.25);
            this.fuseTime = this.windup(FUSE_TIME, 0.8);
            this.setState('brace');
            this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.9 });
          } else {
            this.cooldown = this.ctx.rng.range(0.6, 1.2);
          }
        }
        break;
      }
      case 'brace': {
        // 扎马、弹开箱盖
        this.stopMoving();
        this.facePlayer(2.5, dt);
        this.glowTarget[0] = 0.25;
        if (this.stateTime >= this.braceTime) {
          this.setState('fuse');
          this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.7, pitch: 1.6 });
        }
        break;
      }
      case 'fuse': {
        // 引信沿导线一路烧到箱底：火药仓越来越亮（这段时间打中火药仓 = 哑炸）
        this.stopMoving();
        this.facePlayer(2, dt);
        const t = clamp01(this.stateTime / this.fuseTime);
        this.glowTarget[0] = 0.3 + 0.7 * t;
        if (this.stateTime >= this.fuseTime) {
          this.launched = 0;
          this.volleyTargets = this.pickTargets(this.isElite ? ROCKETS_ELITE : ROCKETS);
          this.setState('volley');
          this.fireVolley();
        }
        break;
      }
      case 'volley': {
        this.stopMoving();
        this.glowTarget[0] = 1;
        if (this.stateTime >= VOLLEY_TIME) this.setState('recover');
        break;
      }
      case 'stomp': {
        this.stopMoving();
        this.facePlayer(4, dt);
        this.glowTarget[0] = 0.3;
        if (!this.stompDone && this.stateTime >= this.windup(STOMP_TIME, 0.3)) {
          this.stompDone = true;
          this.scatterRats();
        }
        if (this.stateTime >= STOMP_TIME + 0.35) {
          this.releaseAttack();
          this.ratCd = this.ctx.rng.range(RAT_COOLDOWN[0], RAT_COOLDOWN[1]);
          this.setState('march');
        }
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.15;
        if (this.stateTime >= RECOVER_TIME / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          if (this.cooldown <= 0.5) this.rollCooldown(VOLLEY_COOLDOWN[0], VOLLEY_COOLDOWN[1]);
          this.setState('march');
        }
        break;
      }
      case 'toppled': {
        // 哑炸后仰面倒地（输出窗口）
        this.stopMoving();
        this.glowTarget[0] = 0;
        if (this.stateTime >= TOPPLE_TIME) this.setState('getup');
        break;
      }
      case 'getup': {
        this.stopMoving();
        if (this.stateTime >= GETUP_TIME) {
          this.rollCooldown(3, 4);
          this.setState('march');
        }
        break;
      }
      default:
        this.setState('march');
    }
  }

  /** 保持距离：太远一顿一顿地走近，太近退开，区间内站定转向玩家 */
  private march(d: number, dt: number): void {
    const pl = this.ctx.player.position;
    if (d > KEEP[1]) {
      this.navigate(pl, this.speed, KEEP[1] - 2);
      this.faceMovement(3, dt);
    } else if (d < KEEP[0]) {
      const dx = this.position.x - pl.x, dz = this.position.z - pl.z;
      const s = this.strafeSign * 0.5;
      _t.set(this.position.x + (dx - dz * s) * 0.5, this.position.y, this.position.z + (dz + dx * s) * 0.5);
      this.navigate(_t, this.speed, 0.5);
      this.faceMovement(3, dt);
    } else {
      this.stopMoving();
      this.facePlayer(2.2, dt);
    }
  }

  /**
   * 落点：玩家预判位置一处，其余按黄金角撒在玩家周围 1.8–6 米（彼此至少 1.7 米，离傀儡至少 3 米），
   * 都投到可走的地面上。
   */
  pickTargets(count: number): THREE.Vector3[] {
    const ctx = this.ctx;
    const pl = ctx.player;
    const out: THREE.Vector3[] = [];
    const cands: [number, number][] = [[pl.position.x + pl.velocity.x * 0.6, pl.position.z + pl.velocity.z * 0.6]];
    const a0 = ctx.rng.range(0, Math.PI * 2);
    for (let i = 0; i < 40; i++) {
      const a = a0 + i * 2.399963 + ctx.rng.range(-0.15, 0.15);
      const r = 1.8 + ((i * 0.618034 + 0.3) % 1) * (SPREAD - 1.8);
      cands.push([pl.position.x + Math.sin(a) * r, pl.position.z + Math.cos(a) * r]);
    }
    for (const [x, z] of cands) {
      if (out.length >= count) break;
      _t.set(x, pl.position.y, z);
      if (!ctx.nav.nearestWalkable(_t, _q)) _q.copy(_t);
      if (Math.hypot(_q.x - pl.position.x, _q.z - pl.position.z) > SPREAD + 0.3) continue;
      if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) < 3 + this.radius) continue;
      if (out.some((o) => Math.hypot(o.x - _q.x, o.z - _q.z) < ROCKET_GAP)) continue;
      const gy = ctx.world.groundHeight(_q.x, _q.z, pl.position.y + 2);
      out.push(new THREE.Vector3(_q.x, Number.isFinite(gy) ? gy : pl.position.y, _q.z));
    }
    return out;
  }

  /** 齐射：箱口的蜂窝管里依次冲出火箭 */
  private fireVolley(): void {
    const ctx = this.ctx;
    const targets = this.volleyTargets;
    const from: THREE.Vector3[] = [];
    this.getMuzzle(_p);
    const k = this.sizeScale;
    for (let i = 0; i < targets.length; i++) {
      const a = (i / Math.max(1, targets.length)) * Math.PI * 2;
      from.push(new THREE.Vector3(_p.x + Math.cos(a) * 0.12 * k, _p.y + Math.sin(a) * 0.1 * k + 0.1, _p.z));
    }
    const times = targets.map((_, i) => ROCKET_FIRST + i * ROCKET_STAGGER);
    // 打乱落地顺序（不总是先砸玩家脚下）
    for (let i = times.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng.range(0, i + 0.999));
      [times[i], times[j]] = [times[j], times[i]];
    }
    launchRocketVolley(ctx, {
      from, targets, times, radius: ROCKET_RADIUS * (this.isElite ? 1.1 : 1), damage: this.def.damage * this.damageMult,
      source: this, scale: 1, fire: this.rocketFire(),
    });
    this.launched = targets.length;
    this.volleyAge = 0;
    ctx.fx.burst(_p, INFERNO.gold, 26, 9, 0.6, 0.07, 6);
    ctx.fx.burst(_p, INFERNO.soot, 10, 2.5, 1.1, 0.4, -1.5);
    ctx.fx.shake(0.12, 0.25);
    ctx.audio.play('shot_launcher', { position: _p, volume: 0.9, pitch: 1.3 });
    ctx.audio.play('explosion', { position: _p, volume: 0.4, pitch: 1.8 });
  }

  /** 火箭落点的残火（祸斗会跑来吃掉，见 inferno/FireFeed） */
  private rocketFire(): { radius: number; duration: number; damage: number } {
    return { radius: FLOOR_FIRE.radius, duration: FLOOR_FIRE.time, damage: this.def.damage * this.damageMult * FLOOR_FIRE.mult };
  }

  /** 哑炸：火药仓被打中，火箭在箱里炸开、四散乱飞（也炸伤同伴），傀儡仰面倒地 */
  private dud(): void {
    const ctx = this.ctx;
    this.fuse?.set(ctx, -1, 0);
    this.bellyCenter(_p);
    gunpowderBlast(ctx, _p, 1.2, 0.8);
    ctx.audio.play('explosion', { position: _p, volume: 0.8, pitch: 0.9 });
    const n = this.isElite ? ROCKETS_ELITE : ROCKETS;
    const targets: THREE.Vector3[] = [];
    const from: THREE.Vector3[] = [];
    const a0 = ctx.rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + i * 2.399963;
      const r = DUD_RING[0] + ((i * 0.618034 + 0.2) % 1) * (DUD_RING[1] - DUD_RING[0]);
      _t.set(this.position.x + Math.sin(a) * r, this.position.y, this.position.z + Math.cos(a) * r);
      if (!ctx.nav.nearestWalkable(_t, _q)) _q.copy(_t);
      const gy = ctx.world.groundHeight(_q.x, _q.z, this.position.y + 2);
      targets.push(new THREE.Vector3(_q.x, Number.isFinite(gy) ? gy : this.position.y, _q.z));
      from.push(_p.clone());
    }
    launchRocketVolley(ctx, {
      from, targets, times: targets.map((_, i) => 0.6 + i * 0.07), radius: ROCKET_RADIUS,
      damage: this.def.damage * this.damageMult * DUD_MULT, source: this,
      enemyBase: DUD_ENEMY_BASE * this.level * (this.isElite ? 1.5 : 1), knockback: DUD_KNOCK, rise: 4, riseTime: 0.3, scale: 0.9,
      fire: this.rocketFire(),
    });
    this.dudAge = 0;
    this.releaseAttack();
    this.setState('toppled');
  }

  /** 跺脚撒地老鼠 */
  private scatterRats(): void {
    const ctx = this.ctx;
    this.localPoint(0, 0.05, 0.3, _p);
    spawnGroundRats(ctx, {
      from: _p, count: RATS, life: RAT_LIFE, speed: RAT_SPEED, radius: RAT_RADIUS,
      damage: this.def.damage * this.damageMult * RAT_MULT, source: this, yaw: this.facing,
    });
    ctx.fx.burst(_p, INFERNO.gold, 16, 4, 0.4, 0.05, 4);
    ctx.fx.shake(0.1, 0.2);
    ctx.audio.play('enemy_melee', { position: _p, volume: 0.8, pitch: 0.7 });
  }

  /** 被同伴引爆（连环爆）：引信「嗤」一声，delay 秒后当场炸开 */
  chainDetonate(delay: number): void {
    if (this.primed || !this.alive) return;
    this.primed = true;
    this.tintBody(0xff7a20, 0.8);
    this.bellyCenter(_p);
    this.ctx.fx.burst(_p, INFERNO.gold, 10, 3, 0.3, 0.05, 2);
    this.ctx.tasks.delay(delay, () => detonateKin(this.ctx, this));
  }

  protected override cancelAttack(): void {
    this.fuse?.set(this.ctx, -1, 0);
    // 已经射出去的火箭照样落下（预警随火箭兑现）
    if (this.alive && (this.state === 'brace' || this.state === 'fuse' || this.state === 'volley' || this.state === 'stomp')) {
      this.setState('march');
      this.rollCooldown(2, 3);
    }
  }

  /** 死时火箭箱炸开：伤玩家（3.5 米内）、炸飞其他敌人、引爆附近的火药怪 */
  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (this.detonated || attackDirector.purging) return;
    this.detonated = true;
    const ctx = this.ctx;
    const center = this.bellyCenter(new THREE.Vector3());
    gunpowderBlast(ctx, center, BLAST_RADIUS, 1.5);
    ctx.fx.shake(0.35, 0.3);
    blastPlayer(ctx, center, BLAST_RADIUS, this.def.damage * this.damageMult * BLAST_MULT, 'fire', this, 0.5, 0.5, 7);
    chainBlast(ctx, {
      center, radius: BLAST_RADIUS, base: BLAST_BASE * this.level * (this.isElite ? 1.5 : 1), knockback: BLAST_KNOCK,
      mode: 'detonate', source: this,
    });
  }

  protected override onDispose(): void {
    super.onDispose();
    this.fuse?.dispose();
    this.fuse = null;
    for (const m of this.lidMats) m.dispose();
    this.lidMats.length = 0;
  }

  protected override animateDeath(t: number): void {
    // 炸开：一下鼓胀后碎没
    const s = this.sizeScale * (t < 0.25 ? 1 + t * 0.8 : Math.max(0.01, 1.2 * (1 - (t - 0.25) / 0.75)));
    this.model.scale.setScalar(s);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const p = this.pose$;
    // 步态：想移动时一步接一步；停下时把这一步迈完
    const wants = Math.hypot(this.desiredX, this.desiredZ) > 0.05;
    if (wants || this.gait > 0) {
      this.gait += dt / (STEP_TIME / Math.sqrt(Math.max(0.5, this.speedMult)));
      if (this.gait >= 1) {
        this.gait = wants ? this.gait - 1 : 0;
        this.stepLeg = 1 - this.stepLeg;
      }
    }
    // 迈腿段：急起急停（木偶）；停顿段腿落地不动
    const g = this.gait;
    const swing = g > 0 && g < SWING ? Math.sin(Math.PI * Math.pow(g / SWING, 0.8)) : 0;
    p.swingL = this.stepLeg === 0 ? swing : 0;
    p.swingR = this.stepLeg === 1 ? swing : 0;
    p.bob = 0.04 * swing;
    p.roll = (this.stepLeg === 0 ? -1 : 1) * 0.06 * swing;

    const brace = st === 'brace' ? clamp01(this.stateTime / this.braceTime) : 0;
    const squat = st === 'brace' ? brace : st === 'fuse' || st === 'volley' ? 1 : st === 'recover' ? clamp01(1 - this.stateTime / 0.5) : 0;
    p.squat = damp(p.squat, squat, 12, dt);
    p.arms = damp(p.arms, st === 'fuse' || st === 'volley' || st === 'brace' ? 1 : st === 'stomp' ? 0.6 : 0, 10, dt);
    const recoil = Math.exp(-this.volleyAge * 6) * (this.volleyAge < 2 ? 1 : 0);
    p.recoil = recoil;
    const stomp = st === 'stomp' ? Math.sin(Math.PI * clamp01(this.stateTime / STOMP_TIME)) : 0;
    p.lean = 0.06 * swing - 0.18 * recoil - 0.1 * this.hurtKick + 0.12 * p.squat;
    // 头：盯住玩家，按格「咔」过去
    const pl = this.ctx.player.position;
    const want = clamp(angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z)), -0.7, 0.7);
    const notch = Math.round(want / HEAD_NOTCH) * HEAD_NOTCH;
    if (notch !== this.headNotch) this.headNotch = notch;
    p.headYaw = damp(p.headYaw, this.headNotch, 22, dt);
    p.headPitch = damp(p.headPitch, -0.12 * p.squat + 0.25 * recoil, 14, dt);
    // 弹簧：鞭炮串和绒球跟着身体的顿挫、加减速甩
    const ax = (this.velocity.x - this.prevVel.x) / Math.max(dt, 1e-3), az = (this.velocity.z - this.prevVel.z) / Math.max(dt, 1e-3);
    this.prevVel.copy(this.velocity);
    const sn = Math.sin(this.facing), cs = Math.cos(this.facing);
    const af = clamp(ax * sn + az * cs, -20, 20), al = clamp(ax * cs - az * sn, -20, 20);
    for (let i = 0; i < 2; i++) {
      const sp = this.sStr[i];
      p.strPitch[i] = sp.p.step(clamp(af * 0.025 + 0.5 * swing * (i === this.stepLeg ? 1 : 0.4) - 0.6 * recoil + 0.2 * p.squat, -0.8, 0.8), dt);
      p.strRoll[i] = sp.r.step(clamp(-al * 0.02 + p.roll * 2.5 + (i === 0 ? 1 : -1) * 0.25 * p.arms, -0.6, 0.6), dt);
    }
    p.pomPitch = this.sPom.p.step(clamp(af * 0.03 - 1.2 * recoil + 0.8 * stomp + p.bob * 6, -0.9, 0.9), dt);
    p.pomRoll = this.sPom.r.step(clamp(-al * 0.03 + p.roll * 4, -0.9, 0.9), dt);
    // 箱盖：扎马时「啪」地弹开（欠阻尼弹簧，开到头会回弹一下），收势后合上
    const lidTarget = st === 'brace' || st === 'fuse' || st === 'volley' ? 1 : st === 'recover' && this.stateTime < 0.45 ? 1 : 0;
    this.lidOpen = this.sLid.step(lidTarget, dt);
    if (this.lidHinge) this.lidHinge.rotation.x = -1.9 * clamp(this.lidOpen, -0.1, 1.15);
    // 仰倒：整个身体绕脚后跟往后倒（哑炸）
    const topple = this.sTopple.step(st === 'toppled' ? 1 : st === 'getup' ? 1 - clamp01(this.stateTime / GETUP_TIME) : 0, dt);
    const host = this.model.children[0];
    host.rotation.set(-1.35 * topple + (this.stunTime > 0 ? Math.sin(this.age * 7) * 0.05 : 0), 0, 0);
    _t.set(0, 0, -0.25).applyEuler(host.rotation);
    host.position.set(0 - _t.x, 0.12 * topple - _t.y, -0.25 - _t.z);

    if (this.nativeBody) this.poseNative(this.nativeBody.pose, p, stomp, topple);
    else this.poseBlockout(p, stomp, topple);

    // 引信火花：沿导线烧下去；火药仓、管口发光
    if (this.fuse) this.fuse.set(this.ctx, st === 'fuse' ? clamp01(this.stateTime / this.fuseTime) : -1, dt);
    FROST_FX_TIME.value = this.ctx.time.now;
    const alive = this.alive ? 1 : 0.3;
    const fuseT = st === 'fuse' ? clamp01(this.stateTime / this.fuseTime) : 0;
    if (this.glow) {
      this.glow.strength[0].value = (0.35 + 1.8 * fuseT * (0.8 + 0.2 * Math.sin(this.age * 30)) + 0.8 * recoil) * alive;
      this.glow.strength[1].value = (0.05 + 2.2 * recoil + 0.3 * fuseT) * alive;
    }
    this.bellyGlow.scale.setScalar(1 + 0.6 * fuseT);
    for (const t of this.tubeGlows) t.scale.setScalar(1 + recoil);
    this.glowTarget[1] = recoil;
  }

  /**
   * 美术骨骼动画（模型空间：X = 傀儡的左侧，Y = 上，Z = 前；绕 +X 负转 = 抬腿向前）。
   * 刚性木偶：每个部件整块转动，球关节处不变形。迈腿段大腿前抬、小腿后折，停顿段落地；扎马时屈膝下蹲、双臂张开；
   * 齐射时上身后坐；跺脚时右腿高抬重踏；鞭炮串、绒球是弹簧。
   */
  private poseNative(P: NativePose, p: PuppetPose, stomp: number, topple: number): void {
    P.reset();
    P.translate('hips', 0, p.bob - 0.13 * p.squat - 0.03 * stomp, 0);
    P.rotate('hips', AZ, p.roll);
    P.rotate('chest', AX, p.lean);
    P.rotate('chest', AZ, -p.roll * 0.5);
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const s = i === 0 ? 1 : -1;
      const sw = i === 0 ? p.swingL : p.swingR;
      const stompLeg = i === 1 ? stomp : 0;
      const up = sw + stompLeg * 1.2;
      P.rotate(`thigh_${side}`, AX, -0.55 * up - 0.5 * p.squat - 0.6 * topple);
      P.rotate(`thigh_${side}`, AZ, s * 0.12 * p.squat);
      P.rotate(`shin_${side}`, AX, 0.75 * up + 0.85 * p.squat + 0.3 * topple);
      P.rotate(`foot_${side}`, AX, -0.25 * up - 0.35 * p.squat);
      // 双臂：走路时前后甩（与对侧腿同步），扎马时向外张开、前臂上抬；仰倒时乱甩
      const armSwing = (i === 0 ? p.swingR : p.swingL) * 0.35 - sw * 0.2;
      P.rotate(`upperarm_${side}`, AX, -armSwing * (1 - p.arms) - 0.15 * p.arms);
      P.rotate(`upperarm_${side}`, AZ, s * (0.55 * p.arms + 0.9 * topple));
      P.rotate(`forearm_${side}`, AX, -0.25 - 0.5 * p.arms + 0.3 * p.recoil);
      P.rotate(`hand_${side}`, AZ, s * 0.2 * p.arms);
      // 鞭炮串：前后、左右甩，下一节滞后
      P.rotate(`string_1_${side}`, AX, p.strPitch[i] * 0.6);
      P.rotate(`string_1_${side}`, AZ, p.strRoll[i] * 0.5);
      P.rotate(`string_2_${side}`, AX, p.strPitch[i] * 0.45);
      P.rotate(`string_2_${side}`, AZ, p.strRoll[i] * 0.4);
      P.rotate(`string_3_${side}`, AX, p.strPitch[i] * 0.35);
    }
    P.rotate('head', AY, p.headYaw);
    P.rotate('head', AX, p.headPitch);
    P.rotate('head', AZ, this.stunTime > 0 ? Math.sin(this.age * 7) * 0.3 : 0);
    P.rotate('pompom', AX, p.pomPitch);
    P.rotate('pompom', AZ, p.pomRoll);
  }

  private poseBlockout(p: PuppetPose, stomp: number, topple: number): void {
    this.hipsJ.position.y = 0.62 + p.bob - 0.13 * p.squat - 0.03 * stomp;
    this.hipsJ.rotation.set(0, 0, p.roll);
    this.chestJ.rotation.set(p.lean, 0, -p.roll * 0.5);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const sw = i === 0 ? p.swingL : p.swingR;
      const up = sw + (i === 1 ? stomp : 0) * 1.2;
      this.legJ[i].thigh.rotation.set(-0.55 * up - 0.5 * p.squat - 0.6 * topple, 0, s * 0.12 * p.squat);
      this.legJ[i].shin.rotation.set(0.75 * up + 0.85 * p.squat + 0.3 * topple, 0, 0);
      const armSwing = (i === 0 ? p.swingR : p.swingL) * 0.35 - sw * 0.2;
      this.armJ[i].upper.rotation.set(-armSwing * (1 - p.arms) - 0.15 * p.arms, 0, s * (0.55 * p.arms + 0.9 * topple));
      this.armJ[i].fore.rotation.set(-0.25 - 0.5 * p.arms + 0.3 * p.recoil, 0, 0);
      const chain = this.strJ[i];
      chain[0].rotation.set(p.strPitch[i] * 0.6, 0, p.strRoll[i] * 0.5);
      chain[1].rotation.set(p.strPitch[i] * 0.45, 0, p.strRoll[i] * 0.4);
      chain[2].rotation.set(p.strPitch[i] * 0.35, 0, 0);
    }
    this.headJ.rotation.set(p.headPitch, p.headYaw, this.stunTime > 0 ? Math.sin(this.age * 7) * 0.3 : 0);
    this.pomJ.rotation.set(p.pomPitch, 0, p.pomRoll);
  }
}
