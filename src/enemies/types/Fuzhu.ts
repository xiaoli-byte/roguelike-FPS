/**
 * 夫诸（fuzhu，第二章 · 昆仑雪墟 / 北冥的远程怪）：《山海经》「其状如白鹿而四角」，见则其邑大水。这里冻成了冰：
 * 优雅的白鹿，两支分叉冰角共四个角尖泛着青光，胸口嵌一颗青色冰晶（弱点）。按真鹿的体态和步态做：
 * 慢走是侧对步（左后 → 左前 → 右后 → 右前），快走过渡到对角小跑；四蹄着地时用两骨 IK 钉住蹄子；
 * 高傲、疏离——平时侧身踱步、扭头盯着玩家，尾巴垂着；起跳、蓄力时尾巴竖起报警（白尾鹿的习性）。
 *
 * - 保持距离：在 13–24 米之间踱步（横向慢走，面朝走向、扭头看玩家）；看不到玩家时绕到有视线的地方。
 * - 冰光：有视线、冷却好时低头把四角对准玩家，四个角尖与角间的光团越蓄越亮（1.2 秒）；
 *   地面先亮出一条瞄准线（沿冰光路径一直铺到被掩体挡住的地方）。前 70% 跟着玩家转，之后锁死方向——这时离开瞄准线就能躲。
 *   随后射出直线冰光（被掩体、地面挡住），命中重伤；冰光扫过的地面结冰 4 秒，玩家踩上去打滑（加速、刹车都很慢）。
 * - 跳跃换位：玩家逼近到 6.5 米内时，后腿一蹲、整只鹿腾空跃起，落到背离玩家约 10 米外的可走点（前腿折叠、后腿后蹬，
 *   像真鹿跳栏），冷却 4–6 秒；落地蹄下扬起冰雾。跳跃中不攻击，落地后很快就能再蓄力：玩家要靠远程对枪，不是追着砍。
 * - 弱点 = 胸口冰晶（头部判定挂在 gem 骨上，正面才打得到）；身体、脖子、头另有命中球（跟着骨骼走）。
 *
 * 状态机：move → charge →（射出冰光）→ recover → move
 *         move → crouch → leap → land → move
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp, raySphere } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { FROST, FROST_FX_TIME, applyIceGlow, castIceBeam, createFrostGlow, type FrostGlow, type IceGlowHandle } from '../fx/FrostRangedFx';

export const FUZHU_DEF: ScaledEnemyDef = {
  id: 'fuzhu',
  name: '夫诸',
  // 美术按 1.9 米（含角，背高约 1.0）制作，游戏里放大 1.25 倍：背高约 1.25 米、角尖约 2.4 米，比玩家高一头
  scale: 1.25,
  hp: 95,
  speed: 4.4,
  radius: 0.42,
  // 背 + 颈（不含角）；下面的尺寸都是放大前的值
  height: 1.5,
  damage: 28,
  coins: [2, 4],
  essence: 1,
  // 弱点 = 胸口冰晶（球心离地约 0.9），判定球挂在 gem 骨上
  headY: 0.9,
  headRadius: 0.16,
  knockbackResist: 0.35,
  color: 0x9fe8ff,
};

/** 保持距离的区间（米） */
const MIN_RANGE = 13;
const MAX_RANGE = 24;
/** 冰光：触发距离、射程、蓄力、跟踪段比例、判定半径 */
const FIRE_RANGE = [6, 30] as const;
const BEAM_RANGE = 34;
const CHARGE_TIME = 1.2;
const TRACK_FRAC = 0.7;
const BEAM_RADIUS = 0.35;
const BEAM_COOLDOWN = [3.6, 5.0] as const;
const RECOVER_TIME = 0.7;
/** 冻地：半宽（米）、持续（秒） */
const STRIP_HALF = 0.9;
const STRIP_TIME = 4;
/** 瞄准线半宽（米） */
const AIM_HALF = 0.55;
/** 跳跃换位：触发距离、目标距离、腾空时长、蹲伏时长、落地缓冲、冷却 */
const LEAP_TRIGGER = 6.5;
const LEAP_DIST = 10;
const LEAP_TIME = 0.8;
const CROUCH_TIME = 0.2;
const LAND_TIME = 0.3;
const LEAP_COOLDOWN = [4, 6] as const;
const GRAVITY = 26;

/**
 * 步态（美术骨骼）：慢走为侧对步（同侧后、前相差 1/4 周期），快了过渡到对角小跑。步频、触地比例随速度变化；
 * 一步里蹄子相对身体最多扫过多远（模型单位）、抬蹄高度。
 */
const GAIT_FREQ = [1.1, 2.4] as const;
const GAIT_DUTY = [0.66, 0.46] as const;
const GAIT_SWEEP = 0.5;
const GAIT_LIFT = [0.07, 0.15] as const;
/** 腿：上段、下段、末端（掌骨 / 跖骨，IK 的末端）、蹄；侧对步与小跑的相位 */
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'fcannon_L', hoof: 'fhoof_L', front: true, walk: 0.25, trot: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'fcannon_R', hoof: 'fhoof_R', front: true, walk: 0.75, trot: 0.5 },
  { u: 'thigh_L', l: 'shin_L', e: 'hcannon_L', hoof: 'hhoof_L', front: false, walk: 0, trot: 0.5 },
  { u: 'thigh_R', l: 'shin_R', e: 'hcannon_R', hoof: 'hhoof_R', front: false, walk: 0.5, trot: 0 },
] as const;

/**
 * 美术网格实测（模型空间、未缩放；Blender 坐标 (x, y, z) → (x, z, -y)）：
 * 两支冰角的主尖与侧尖（发光星点）、前叉小尖、鼻尖、各命中球的中心与半径。
 */
const HORN_TIPS = [
  { at: [0.17, 1.89, 0.24], size: 0.2 },
  { at: [-0.17, 1.89, 0.24], size: 0.2 },
  { at: [0.27, 1.75, 0.09], size: 0.17 },
  { at: [-0.27, 1.75, 0.09], size: 0.17 },
  { at: [0.115, 1.66, 0.45], size: 0.11 },
  { at: [-0.115, 1.66, 0.45], size: 0.11 },
] as const;
const NOSE = [0, 1.22, 0.61] as const;
/** 角间光团（冰光的发射点）：两支角之间、额头前上方 */
const FOCUS = [0, 1.66, 0.42] as const;
const HIT_SPHERES = [
  { bone: 'chest', at: [0, 0.86, 0.22], r: 0.27 },
  { bone: 'hips', at: [0, 0.84, -0.3], r: 0.27 },
  { bone: 'neck', at: [0, 1.12, 0.33], r: 0.17 },
  { bone: 'head', at: [0, 1.33, 0.47], r: 0.16 },
] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();

const C = {
  fur: 0xf2f6f8, furShade: 0xc8d6de, mark: 0x7fa2b2, hoof: 0x46647a, horn: 0x8fb8cc, hornTip: 0x6fe6ff, hornHot: 0xf0ffff,
  gem: 0x3fc8e8, gemHot: 0xe8ffff, eye: 0x5fd8ff, eyeHot: 0xe8ffff, ear: 0xb8a8b0, nose: 0x2a3440,
};

/** 白模的腿：上段 / 下段关节、前后、左右 */
interface BlockLeg {
  upper: THREE.Group;
  lower: THREE.Group;
  front: boolean;
  side: number;
}

export class Fuzhu extends StandardEnemy {
  protected body!: THREE.Group;
  protected neck!: THREE.Group;
  protected head!: THREE.Group;
  protected tail!: THREE.Group;
  private readonly blockLegs: BlockLeg[] = [];
  /** 白模的角尖发光件（美术身体时隐藏） */
  private readonly tipGlows: THREE.Mesh[] = [];
  private gemGlow!: THREE.Mesh;
  /** 白模的命中球锚点（美术身体时换成骨骼锚点） */
  private readonly hitAnchors: { o: THREE.Object3D; r: number }[] = [];
  /** 发射点（角间光团）、鼻尖锚点 */
  private focus!: THREE.Object3D;
  private nose!: THREE.Object3D;

  private chargeTime = CHARGE_TIME;
  /** 冰光的锁定方向（单位向量）与瞄准点 */
  private readonly aimDir = new THREE.Vector3(0, 0, 1);
  private readonly aimPoint = new THREE.Vector3();
  private aimDecal: GroundDecal | null = null;
  private aimLen = 10;
  private aimTimer = 0;
  private recoverTime = RECOVER_TIME;
  private leapCd: number;
  private readonly leapVel = new THREE.Vector3();
  private readonly leapTarget = new THREE.Vector3();
  private breathAcc = 0;
  private chargeAcc = 0;
  /** 刚射出的冰光（0 = 刚射出，后坐 / 甩头用） */
  private fireAge = Infinity;
  /** 步态相位 */
  private gait = 0;
  private prevFacing = 0;
  // 平滑后的姿态参数
  private pAlert = 0;
  private pCharge = 0;
  private pLookYaw = 0;
  private pLookPitch = 0;
  private pCrouch = 0;
  private pAir = 0;
  private pLand = 0;
  // 贴合模型的冰光特效
  private iceGlow: IceGlowHandle | null = null;
  private stars: { m: FrostGlow; base: number; phase: number }[] = [];
  private orb: FrostGlow | null = null;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FUZHU_DEF, opts);
    this.walkScale = 0.9;
    this.stepRate = 1.2;
    this.accel = 18;
    this.leapCd = ctx.rng.range(0.5, 1.5);
    this.cooldown = ctx.rng.range(1.2, 2.4);
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fur = flat(C.fur, { rough: 0.9 }), shade = flat(C.furShade), mark = flat(C.mark);
    const hoof = flat(C.hoof, { rough: 0.5 }), horn = flat(C.horn, { rough: 0.3, emissive: 0x10283a });
    // 身体：躯干中心离地 0.86，前胸略高
    const body = joint(root, 0, 0.86, 0);
    this.body = body;
    part(body, Geo.ico(0.26, 2), fur, 0, 0, -0.02).scale.set(0.82, 0.85, 1.75);
    part(body, Geo.ico(0.2, 1), shade, 0, -0.1, 0.05).scale.set(0.8, 0.6, 1.6);
    for (const s of [1, -1]) part(body, Geo.box(0.02, 0.1, 0.4), mark, s * 0.2, 0.05, -0.05, 0.2, 0, 0);
    // 胸口冰晶（弱点）
    this.gemGlow = this.glowPart(body, Geo.octa(0.07), C.gem, C.gemHot, 0, 0.02, 0.44, 0);
    this.gemGlow.scale.set(0.8, 1.3, 0.6);
    // 脖子（向前上方斜）与头
    const neck = joint(body, 0, 0.12, 0.3);
    this.neck = neck;
    neck.rotation.x = -0.35;
    part(neck, Geo.cyl(0.08, 0.13, 0.42, 7, 'bottom'), fur, 0, 0, 0);
    part(neck, Geo.cone(0.14, 0.3, 6, 'bottom'), shade, 0, 0.05, -0.06, -0.4, 0, 0); // 鬃毛
    const head = joint(neck, 0, 0.42, 0.02);
    this.head = head;
    head.rotation.x = 0.35;
    part(head, Geo.ico(0.1, 1), fur, 0, 0.02, 0.04).scale.set(0.85, 0.85, 1.1);
    part(head, Geo.cone(0.065, 0.2, 7), fur, 0, -0.01, 0.17, Math.PI / 2, 0, 0);
    part(head, Geo.ico(0.025, 0), flat(C.nose), 0, -0.01, 0.27);
    for (const s of [1, -1]) {
      this.glowPart(head, Geo.ico(0.018, 0), C.eye, C.eyeHot, s * 0.06, 0.04, 0.1, 1);
      part(head, Geo.cone(0.05, 0.14, 5), flat(C.ear), s * 0.1, 0.1, -0.02, 0, 0, -s * 1.0);
      // 冰角：主干两节 + 侧叉 + 前叉，角尖发光
      const base = joint(head, s * 0.05, 0.1, 0.0);
      base.rotation.set(-0.25, 0, -s * 0.3);
      part(base, Geo.cyl(0.018, 0.028, 0.32, 5, 'bottom'), horn, 0, 0, 0);
      const upper = joint(base, 0, 0.32, 0);
      upper.rotation.set(0.35, 0, s * 0.2);
      part(upper, Geo.cyl(0.01, 0.018, 0.26, 5, 'bottom'), horn, 0, 0, 0);
      this.tipGlows.push(this.glowPart(upper, Geo.cone(0.016, 0.08, 5, 'bottom'), C.hornTip, C.hornHot, 0, 0.24, 0, 0));
      const side = joint(base, 0, 0.2, 0);
      side.rotation.set(-0.5, 0, -s * 0.9);
      part(side, Geo.cyl(0.008, 0.016, 0.2, 5, 'bottom'), horn, 0, 0, 0);
      this.tipGlows.push(this.glowPart(side, Geo.cone(0.013, 0.06, 5, 'bottom'), C.hornTip, C.hornHot, 0, 0.19, 0, 0));
      const fork = joint(base, 0, 0.08, 0.01);
      fork.rotation.set(0.9, 0, 0);
      part(fork, Geo.cyl(0.006, 0.012, 0.12, 5, 'bottom'), horn, 0, 0, 0);
    }
    // 四条细长的腿：前腿肘在后、后腿膝在前跗关节在后（白模简化成两节）
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(body, s * 0.11, -0.06, front ? 0.3 : -0.32);
        part(upper, Geo.ico(front ? 0.08 : 0.11, 1), fur, 0, -0.05, 0).scale.set(0.8, 1.4, 1.0);
        part(upper, Geo.cyl(0.035, 0.045, 0.4, 6, 'top'), fur, 0, -0.05, 0);
        const lower = joint(upper, 0, -0.42, 0);
        part(lower, Geo.cyl(0.022, 0.03, 0.34, 6, 'top'), fur, 0, 0, 0);
        part(lower, Geo.box(0.06, 0.06, 0.08), hoof, 0, -0.36, 0.02);
        this.blockLegs.push({ upper, lower, front, side: s });
      }
    }
    // 短尾
    const tail = joint(body, 0, 0.12, -0.45);
    this.tail = tail;
    tail.rotation.x = 0.6;
    part(tail, Geo.cone(0.06, 0.18, 6, 'top'), fur, 0, 0, 0);
    this.setHeadAnchor(this.gemGlow, 0, 0, 0);
    // 发射点与鼻尖、命中球
    this.focus = joint(head, 0, 0.32, 0.06);
    this.nose = joint(head, 0, -0.01, 0.27);
    this.hitAnchors.push({ o: joint(body, 0, 0, 0.22), r: 0.27 }, { o: joint(body, 0, 0, -0.3), r: 0.27 },
      { o: joint(neck, 0, 0.22, 0), r: 0.17 }, { o: joint(head, 0, 0, 0.08), r: 0.16 });
    return root;
  }

  // ───────────── 美术身体 ─────────────

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    // 白模发光件对不上美术的角和宝石：收起，改用贴合模型的特效
    for (const g of this.tipGlows) g.visible = false;
    this.gemGlow.visible = false;
    this.head.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    const ws = new THREE.Vector3();
    const anchor = (bone: string, at: readonly number[]): THREE.Object3D | null => {
      const b = n.pose.bone(bone);
      if (!b) return null;
      const o = new THREE.Object3D();
      b.add(o);
      o.position.copy(b.worldToLocal(host.localToWorld(_p.set(at[0], at[1], at[2]))));
      return o;
    };
    const gem = n.pose.bone('gem');
    if (gem) {
      const g = anchor('gem', [0, 0.9, 0.5]);
      if (g) this.setHeadAnchor(g, 0, 0, 0);
    }
    this.focus = anchor('head', FOCUS) ?? this.focus;
    this.nose = anchor('head', NOSE) ?? this.nose;
    this.hitAnchors.length = 0;
    for (const h of HIT_SPHERES) {
      const o = anchor(h.bone, h.at);
      if (o) this.hitAnchors.push({ o, r: h.r });
    }
    // 冰晶自发光：角尖 + 宝石（贴图里的青色）
    this.iceGlow = applyIceGlow(n.materials[0]);
    if (n.glowShell) n.glowShell.color.setHex(0x8af0ff);
    // 角尖星光点（大小以模型单位给，换算成骨骼局部缩放）
    for (const tip of HORN_TIPS) {
      const o = anchor('head', tip.at);
      if (!o) continue;
      const m = createFrostGlow();
      o.add(m);
      const base = (tip.size * hostScale) / Math.max(1e-6, o.getWorldScale(ws).x);
      m.scale.setScalar(base);
      this.stars.push({ m, base, phase: Math.random() * 10 });
    }
    const f = this.focus;
    const orb = createFrostGlow(FROST.beam, FROST.core);
    f.add(orb);
    const ob = (0.5 * hostScale) / Math.max(1e-6, f.getWorldScale(ws).x);
    orb.scale.setScalar(ob);
    orb.userData.base = ob;
    this.orb = orb;
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.leapCd > 0) this.leapCd -= dt;
    this.fireAge += dt;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0.15 + 0.08 * Math.sin(this.age * 2);
        if (this.leapCd <= 0 && d < LEAP_TRIGGER * this.leapReach() && this.verticalReach(2.5) && this.pickLeap()) {
          this.setState('crouch');
          this.stopMoving();
          this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.5, pitch: 1.5 });
          break;
        }
        if (!this.sees && this.seekSight(MIN_RANGE - 4, MAX_RANGE, this.speed, 1.6 * this.sizeScale)) {
          this.faceMovement(5, dt);
          break;
        }
        // 区间内慢慢踱步（面朝走向）；太近快步后撤，太远走近
        const fast = d < MIN_RANGE - 2 || d > MAX_RANGE + 2;
        this.keepRange(MIN_RANGE, MAX_RANGE, d < 9 ? this.speed * 1.3 : this.speed, 0.38);
        if (fast) this.faceMovement(5, dt);
        else if (Math.hypot(this.desiredX, this.desiredZ) > 0.5) this.faceMovement(3, dt);
        else this.facePlayer(3, dt);
        if (this.cooldown <= 0 && this.sees && d >= FIRE_RANGE[0] && d <= FIRE_RANGE[1] && this.verticalReach(6)) {
          if (this.requestAttack('heavy', CHARGE_TIME + 1.4)) this.beginCharge();
          else this.cooldown = this.ctx.rng.range(0.4, 0.9);
        }
        break;
      }
      case 'charge': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.chargeTime);
        this.glowTarget[0] = 0.3 + 0.7 * t;
        if (t < TRACK_FRAC) {
          // 跟踪段：转身对准玩家，瞄准点跟着玩家胸口走（带一点提前量）
          this.facePlayer(4.5, dt);
          this.updateAim(false, dt);
        } else {
          this.updateAim(true, dt);
        }
        this.chargeFx(t, dt);
        if (this.stateTime >= this.chargeTime) this.fire();
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.25;
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(BEAM_COOLDOWN[0], BEAM_COOLDOWN[1]);
          this.setState('move');
        }
        break;
      }
      case 'crouch': {
        this.stopMoving();
        this.faceTowards(this.leapTarget, 6, dt);
        if (this.stateTime >= CROUCH_TIME) this.launchLeap();
        break;
      }
      case 'leap': {
        // 腾空：保持起跳速度（空中加速度只有三分之一，desired 设成起跳速度防止被拉慢）
        this.setMove(this.leapVel.x, this.leapVel.z, Math.hypot(this.leapVel.x, this.leapVel.z));
        this.faceTowards(this.leapTarget, 4, dt);
        if (this.onGround && this.stateTime > 0.15) this.land();
        else if (this.stateTime > LEAP_TIME * 2.5) this.land();
        break;
      }
      case 'land': {
        this.stopMoving();
        this.facePlayer(5, dt);
        if (this.stateTime >= LAND_TIME) {
          this.setState('move');
          // 落地后很快就能再蓄力（逼近它只会让它换个地方继续射）
          this.cooldown = Math.min(this.cooldown, this.ctx.rng.range(0.6, 1.1));
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  /** 精英体型更大，被逼近的判定距离也略大 */
  private leapReach(): number {
    return this.isElite ? 1.15 : 1;
  }

  private beginCharge(): void {
    this.chargeTime = this.windup(CHARGE_TIME, 0.9);
    this.setState('charge');
    this.stopMoving();
    this.chargeAcc = 0;
    this.aimTimer = 0;
    this.updateAim(false, 0);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.75, pitch: 1.6 });
    // 前蹄一跺：蓄力开始
    this.localPoint(0.1, 0.05, 0.3, _p);
    this.ctx.fx.burst(_p, FROST.snow, 6, 1.6, 0.4, 0.1 * this.sizeScale, 4);
  }

  /** 发射点（角间光团，世界坐标） */
  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    this.focus.updateWorldMatrix(true, false);
    return this.focus.getWorldPosition(out);
  }

  /** 瞄准：跟踪段更新瞄准方向；瞄准线沿冰光的地面投影铺到被挡住的地方 */
  private updateAim(locked: boolean, dt: number): void {
    const pl = this.ctx.player;
    if (!locked) {
      this.aimPoint.set(pl.position.x + pl.velocity.x * 0.2, pl.position.y + Math.min(1.1, pl.height * 0.6), pl.position.z + pl.velocity.z * 0.2);
      this.getMuzzle(_p);
      this.aimDir.subVectors(this.aimPoint, _p).normalize();
    }
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.1;
      this.getMuzzle(_p);
      const hit = this.ctx.world.raycast(_p, this.aimDir, BEAM_RANGE);
      const dist = hit ? hit.distance : BEAM_RANGE;
      this.aimLen = Math.max(1, Math.hypot(this.aimDir.x, this.aimDir.z) * dist);
    }
    const yaw = Math.atan2(this.aimDir.x, this.aimDir.z);
    if (!this.aimDecal) this.aimDecal = GroundDecal.acquire(this.ctx.stageGroup, FROST.warn);
    const dec = this.aimDecal;
    dec.rect(this.position.x, this.position.y, this.position.z, yaw, this.aimLen, AIM_HALF * (this.isElite ? 1.25 : 1));
    const t = clamp01(this.stateTime / this.chargeTime);
    dec.fill = t;
    dec.time = this.ctx.time.now;
    // 锁定之后瞄准线变亮、闪得更快
    dec.opacity = locked ? 0.85 + 0.15 * Math.sin(this.ctx.time.now * 30) : 0.55 + 0.2 * t;
  }

  private clearAim(): void {
    this.aimDecal?.release();
    this.aimDecal = null;
  }

  private fire(): void {
    this.getMuzzle(_p);
    // 冻地从鹿前蹄处开始（冰光从头顶射出，脚下的地面不结冰）
    this.localPoint(0, 0, 0.45, _q);
    const res = castIceBeam(this.ctx, {
      from: _p, dir: this.aimDir, range: BEAM_RANGE, radius: BEAM_RADIUS * (this.isElite ? 1.2 : 1),
      damage: this.def.damage * this.damageMult, source: this,
      strip: { from: _q.clone(), halfWidth: STRIP_HALF, duration: STRIP_TIME }, scale: this.isElite ? 1.25 : 1,
    });
    void res;
    this.clearAim();
    this.fireAge = 0;
    this.recoverTime = RECOVER_TIME;
    this.setState('recover');
  }

  /** 蓄力特效：角尖冒冰晶，光团越来越亮；呼出白气 */
  private chargeFx(t: number, dt: number): void {
    this.chargeAcc += dt * (5 + t * 20);
    if (this.chargeAcc < 1) return;
    this.chargeAcc = 0;
    const k = this.sizeScale;
    if (this.stars.length) {
      const s = this.stars[Math.floor(Math.random() * this.stars.length)];
      s.m.getWorldPosition(_p);
      this.ctx.fx.burst(_p, t > 0.7 ? FROST.core : FROST.spark, 1, 0.5 + t, 0.3, 0.05 * k, -0.5);
    } else {
      this.getMuzzle(_p);
      this.ctx.fx.burst(_p, FROST.spark, 1, 0.8, 0.3, 0.05 * k, -0.5);
    }
    if (t > 0.5) {
      this.getMuzzle(_p);
      this.ctx.fx.burst(_p, FROST.core, 1, 0.3, 0.2, (0.06 + t * 0.08) * k, 0);
    }
  }

  /** 选跳跃落点：背离玩家约 10 米、可走、直线上没有高墙（矮掩体跳得过去），高差不大 */
  private pickLeap(): boolean {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    let bx = this.position.x - pl.x, bz = this.position.z - pl.z;
    const len = Math.hypot(bx, bz);
    if (len < 1e-3) {
      bx = -Math.sin(this.facing);
      bz = -Math.cos(this.facing);
    } else {
      bx /= len;
      bz /= len;
    }
    const base = Math.atan2(bx, bz);
    for (const off of [0, 0.5 * this.strafeSign, -0.5 * this.strafeSign, 1.0 * this.strafeSign, -1.0 * this.strafeSign, 1.5, -1.5]) {
      const a = base + off;
      _t.set(this.position.x + Math.sin(a) * LEAP_DIST, this.position.y, this.position.z + Math.cos(a) * LEAP_DIST);
      if (!ctx.nav.isWalkable(_t.x, _t.z)) continue;
      const gy = ctx.world.groundHeight(_t.x, _t.z, this.position.y + 3);
      if (!Number.isFinite(gy) || Math.abs(gy - this.position.y) > 1.5) continue;
      _t.y = gy;
      // 腾空弧线中段约 2 米高：1.4 米高处的直线不被挡住就跳得过去
      _p.set(this.position.x, this.position.y + 1.4, this.position.z);
      _q.set(_t.x, _t.y + 1.4, _t.z);
      if (ctx.world.segmentBlocked(_p, _q)) continue;
      // 落点离玩家要比现在更远
      if (Math.hypot(_t.x - pl.x, _t.z - pl.z) < len + 4) continue;
      this.leapTarget.copy(_t);
      return true;
    }
    this.leapCd = 1.0;
    return false;
  }

  private launchLeap(): void {
    const dx = this.leapTarget.x - this.position.x, dz = this.leapTarget.z - this.position.z;
    const dy = this.leapTarget.y - this.position.y;
    const T = LEAP_TIME;
    this.leapVel.set(dx / T, 0.5 * GRAVITY * T + dy / T, dz / T);
    this.velocity.copy(this.leapVel);
    this.onGround = false;
    this.setState('leap');
    this.leapCd = this.ctx.rng.range(LEAP_COOLDOWN[0], LEAP_COOLDOWN[1]);
    this.ctx.audio.play('jump', { position: this.position, volume: 0.6, pitch: 0.8 });
    this.localPoint(0, 0.05, -0.35, _p);
    this.ctx.fx.burst(_p, FROST.snow, 12, 3, 0.5, 0.14 * this.sizeScale, 5);
  }

  private land(): void {
    this.setState('land');
    this.stopMoving();
    this.velocity.x *= 0.3;
    this.velocity.z *= 0.3;
    const k = this.sizeScale;
    for (const z of [0.3, -0.35]) {
      this.localPoint(0, 0.05, z, _p);
      this.ctx.fx.burst(_p, FROST.snow, 8, 2.5, 0.5, 0.16 * k, 4);
    }
    _p.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.ring(_p, 2.2 * k, FROST.ice, 0.4);
    this.ctx.audio.play('land', { position: this.position, volume: 0.7, pitch: 1.2 });
  }

  protected override cancelAttack(): void {
    this.clearAim();
    if (this.state === 'charge' || this.state === 'recover') {
      this.setState('move');
      this.rollCooldown(1.5, 2.5);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.clearAim();
    if (this.iceGlow) this.iceGlow.glow.value = 0;
    this.getBodyCenter(_p);
    this.ctx.fx.burst(_p, FROST.shard, 16, 3.5, 0.7, 0.1 * this.sizeScale, 6);
    this.ctx.fx.burst(_p, FROST.mist, 6, 1.2, 0.9, 0.35 * this.sizeScale, -0.4);
  }

  protected override onDispose(): void {
    super.onDispose();
    this.clearAim();
    for (const s of this.stars) s.m.material.dispose();
    this.stars.length = 0;
    this.orb?.material.dispose();
    this.orb = null;
  }

  protected override animateDeath(t: number): void {
    // 侧身倒下、冰化碎散（缩小沉下去）
    const e = t * t;
    this.model.rotation.z = e * 1.35;
    this.model.position.y = -e * 0.3;
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - Math.max(0, t - 0.6) * 2.4)));
    for (const s of this.stars) s.m.material.uniforms.uAlpha.value *= 0.85;
  }

  /** 身体 / 脖子 / 头的命中球（跟着骨骼走），与默认的胶囊 + 胸口冰晶判定一起算 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const base = super.raycastHit(origin, dir, maxDist, out);
    if (!this.alive || this.age < this.spawnDuration) return base;
    let best = -1;
    for (const h of this.hitAnchors) {
      h.o.getWorldPosition(_t);
      const t = raySphere(origin, dir, _t, h.r * this.sizeScale);
      if (t >= 0 && t <= maxDist && (best < 0 || t < best)) best = t;
    }
    if (best < 0) return base;
    if (!base) {
      out.distance = best;
      out.headshot = false;
      return true;
    }
    // 弱点优先：身体命中球明显更近（挡在冰晶前面）才算身体
    if (out.headshot ? best < out.distance - this.headRadius * 0.5 : best < out.distance) {
      out.distance = best;
      out.headshot = false;
    }
    return true;
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const charging = this.state === 'charge';
    const t = charging ? clamp01(this.stateTime / this.chargeTime) : 0;
    const alert = charging || this.state === 'crouch' || this.state === 'leap' || this.state === 'land' ? 1 : 0;
    this.pAlert = damp(this.pAlert, alert, 6, dt);
    this.pCharge = damp(this.pCharge, charging ? Math.min(1, t * 1.6) : 0, charging ? 10 : 6, dt);
    this.pCrouch = damp(this.pCrouch, this.state === 'crouch' ? 1 : 0, 22, dt);
    this.pAir = damp(this.pAir, this.state === 'leap' ? 1 : 0, 14, dt);
    this.pLand = damp(this.pLand, this.state === 'land' ? Math.sin(Math.PI * clamp01(this.stateTime / LAND_TIME)) : 0, 25, dt);
    // 扭头看玩家（水平 / 俯仰），限制在脖子能转到的范围
    const pl = this.ctx.player.position;
    const want = angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z));
    const lookYaw = this.state === 'leap' ? 0 : clamp(want, -1.1, 1.1);
    this.pLookYaw = damp(this.pLookYaw, lookYaw, 5, dt);
    const pitch = charging
      ? Math.atan2(this.aimDir.y, Math.hypot(this.aimDir.x, this.aimDir.z))
      : clamp(this.pitchTo(this.position, pl) * 0.6, -0.4, 0.4);
    this.pLookPitch = damp(this.pLookPitch, pitch, 6, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();

    // 冰晶发光：平时微光，蓄力越来越亮，射出瞬间最亮
    FROST_FX_TIME.value = this.ctx.time.now;
    const flash = Math.exp(-this.fireAge * 6);
    const heat = Math.max(this.pCharge, flash);
    if (this.iceGlow) this.iceGlow.glow.value = 0.35 + 1.6 * heat + 0.05 * Math.sin(this.age * 3);
    const shell = this.nativeBody?.glowShell;
    if (shell) shell.opacity = clamp01(0.12 + 0.04 * Math.sin(this.age * 2.2) + 0.5 * heat);
    for (const s of this.stars) {
      const flick = 1 + 0.08 * Math.sin(this.age * 11 + s.phase);
      s.m.scale.setScalar(s.base * (0.6 + 1.3 * heat) * flick);
      s.m.material.uniforms.uAlpha.value = 0.25 + 0.75 * heat;
    }
    if (this.orb) {
      const ob = this.orb.userData.base as number;
      const k = charging ? t * t : flash;
      this.orb.visible = k > 0.02;
      this.orb.scale.setScalar(ob * (0.3 + 1.1 * k) * (1 + 0.08 * Math.sin(this.age * 37)));
      this.orb.material.uniforms.uAlpha.value = k;
    }
    // 呼出白气（冷天里的鹿），蓄力时更急
    this.breathAcc += dt * (charging ? 2.2 : 0.45);
    if (this.breathAcc >= 1) {
      this.breathAcc = 0;
      this.nose.getWorldPosition(_p);
      this.ctx.fx.burst(_p, FROST.mist, 2, 0.5, 0.9, 0.12 * this.sizeScale, -0.3);
    }
  }

  /**
   * 美术骨骼动画（模型空间：X = 鹿的左侧，Y = 上，Z = 前；绕 +X 正转 = 前端下压 / 向下的腿向后摆）。
   * 步态相位驱动四条腿：着地段用两骨 IK 把腕 / 跗关节拉到「蹄落点 + 掌骨长度」处，掌骨回到绑定朝向（竖直），蹄子钉在地上；
   * 腾空段抬蹄前摆，前腿腕关节向后折、后腿跗关节向前收（真鹿的折腿）。蓄力时低头把角对准玩家；跳跃时前腿折叠、后腿后蹬。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    // 原地转身也迈步（按转身速度折算成一点步速）
    const yawRate = dt > 0 ? Math.abs(angleDiff(this.prevFacing, this.facing)) / dt : 0;
    this.prevFacing = this.facing;
    const sp = Math.max(Math.hypot(this.velocity.x, this.velocity.z), Math.min(1.2, yawRate * 0.6));
    const air = this.pAir, crouch = this.pCrouch, land = this.pLand;
    const grounded = 1 - air;
    const k = this.sizeScale;
    const sn = clamp01(sp / (this.speed * 1.2)) * grounded;
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    const move = clamp01(sp / 0.6) * grounded;
    this.gait = (this.gait + freq * dt * move) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * sn;
    const sweep = Math.min(GAIT_SWEEP, (sp * duty) / (freq * k)) * grounded;
    const lift = (GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * sn) * move;
    const ph = this.gait * Math.PI * 2;
    const ch = this.pCharge;
    const recoil = Math.exp(-this.fireAge * 9) * (this.fireAge < 1 ? 1 : 0);

    // 身体：步子起伏；蹲伏 / 落地压低后躯；腾空先抬头后低头；受击后仰；眩晕摇晃
    const lean = this.state === 'leap' ? clamp(-this.velocity.y / 12, -1, 1) : 0;
    P.translate('hips', 0, 0.015 * sn * Math.sin(ph * 2) - 0.12 * crouch - 0.08 * land, 0);
    // 蹲伏：后躯下沉、昂首；腾空：上升段抬头、下落段低头（lean < 0 = 上升）
    P.rotate('hips', AX, -0.15 * crouch + 0.1 * land + 0.25 * air * lean - 0.1 * this.hurtKick);
    P.rotate('chest', AX, 0.04 * sn * Math.sin(ph * 2 + 0.6) + 0.08 * ch);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(this.age * 8) * 0.12);
    // 脖子与头：看玩家；蓄力时低头把角对准（脖子前伸下压，头再按瞄准俯仰微调）；射出瞬间甩头后坐
    const lookYaw = this.pLookYaw * (1 - 0.4 * ch);
    P.rotate('neck', AY, lookYaw * 0.55);
    P.rotate('head', AY, lookYaw * 0.45);
    P.rotate('neck', AX, -0.12 * this.pAlert + 0.62 * ch - 0.35 * recoil - 0.2 * air - 0.1 * this.hurtKick
      + 0.03 * Math.sin(this.age * 1.3) * (1 - ch));
    P.rotate('head', AX, 0.2 * ch - this.pLookPitch * (0.6 + 0.4 * ch) - 0.25 * recoil + 0.1 * air * lean);
    // 尾巴：平时垂着轻摆，警觉 / 蓄力 / 跳跃时竖起（白尾鹿的报警）
    P.rotate('tail_1', AX, 0.9 * this.pAlert + 0.08 * Math.sin(this.age * 2.3));
    P.rotate('tail_2', AX, 0.4 * this.pAlert);
    P.rotate('tail_1', AY, 0.12 * Math.sin(this.age * 5.1) * (1 - this.pAlert));

    for (const leg of LEGS) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      if (air > 0.02) {
        // 腾空：前腿折叠在胸前（腕关节后折）、后腿向后蹬直
        if (leg.front) {
          P.rotate(leg.u, AX, -0.55 * air);
          P.rotate(leg.l, AX, -0.25 * air);
          P.rotate(leg.e, AX, 1.55 * air);
          P.rotate(leg.hoof, AX, 0.4 * air);
        } else {
          P.rotate(leg.u, AX, 0.6 * air);
          P.rotate(leg.l, AX, -0.2 * air);
          P.rotate(leg.e, AX, 0.45 * air);
        }
        if (air > 0.9) continue;
      }
      const off = leg.walk + (leg.trot - leg.walk) * sn;
      const u = (this.gait + off) % 1;
      let dz: number, dy: number, swing = 0;
      if (u < duty) {
        dz = sweep * (0.5 - u / duty);
        dy = 0;
      } else {
        const s = (u - duty) / (1 - duty);
        dz = sweep * (-0.5 + s * s * (3 - 2 * s));
        swing = Math.sin(s * Math.PI);
        dy = swing * lift;
      }
      // 蹲伏 / 落地：蹄子不动、身体下沉，腿自然弯曲（IK 目标不随身体下沉）
      _t.set(rest.x, rest.y + dy, rest.z + dz);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1);
      if (swing > 0.01) {
        // 腾空段折腿：前腿腕关节向后折、后腿跗关节向前收
        if (leg.front) {
          P.rotateCurrent(leg.e, AX, 0.9 * swing * (0.5 + 0.5 * sn));
          P.rotateCurrent(leg.hoof, AX, 0.35 * swing);
        } else {
          P.rotateCurrent(leg.e, AX, -0.35 * swing * (0.5 + 0.5 * sn));
          P.rotateCurrent(leg.hoof, AX, 0.3 * swing);
        }
      }
    }
  }

  /** 白模动画：四腿对角摆动、低头蓄力、扭头看玩家、跳跃折腿 */
  private poseBlockout(): void {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const amp = Math.min(1, sp / Math.max(1, this.def.speed)) * (1 - this.pAir);
    const ph = this.walkPhase * 1.6;
    const ch = this.pCharge, air = this.pAir;
    this.body.position.y = 0.86 + Math.abs(Math.sin(ph)) * 0.03 * amp - 0.1 * this.pCrouch - 0.06 * this.pLand;
    this.body.rotation.x = -0.15 * air - this.hurtKick * 0.2;
    this.body.rotation.z = this.stunTime > 0 ? Math.sin(this.age * 8) * 0.15 : 0;
    this.neck.rotation.set(-0.35 + 0.75 * ch - 0.1 * this.pAlert, this.pLookYaw * 0.5, 0);
    this.head.rotation.set(0.35 + 0.2 * ch - this.pLookPitch * 0.6, this.pLookYaw * 0.4, 0);
    this.tail.rotation.x = 0.6 - 1.2 * this.pAlert;
    for (const l of this.blockLegs) {
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph + off);
      if (l.front) {
        l.upper.rotation.x = swing * 0.5 * amp - 0.5 * air;
        l.lower.rotation.x = Math.max(0, swing) * 0.7 * amp + 1.4 * air;
      } else {
        l.upper.rotation.x = swing * 0.5 * amp + 0.6 * air + 0.3 * this.pCrouch;
        l.lower.rotation.x = -Math.max(0, -swing) * 0.6 * amp - 0.3 * this.pCrouch;
      }
    }
    // 白模角尖发光件：跟着蓄力变亮
    this.glowTarget[0] = Math.max(this.glowTarget[0], ch);
  }
}
