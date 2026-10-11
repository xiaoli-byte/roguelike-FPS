/**
 * 三彩镇墓兽（tomb_beast，第一章 · 赤沙古道的坦克）：唐墓里的三彩釉陶镇墓兽被旱魃的日火从里面烧醒。
 * 狮形四足、鬼面獠牙、独角、肩生火焰翼鳍；中空的陶身背上龟裂，裂缝里烧着日火（弱点，头部判定挂在背上）。
 * 2026-10-07 替换驼碑力士：格挡靠身体本身（正面厚釉甲），不持盾，四足骨架规矩、陶身大部分刚性。
 * 用户要求「体型大、数值 / 技能 / 特效有压迫感」：整体放大 1.7 倍（含独角约 3.7 米高、4.4 米长），血厚甲厚、不吃击退。
 *
 * - 釉甲推进：低头缓步逼近，每一步都震地扬尘；转身慢（每秒约 1.4 弧度）；正面来的伤害只吃 10%（釉甲上冒火星、瓷器脆响）。
 *   背上龟裂里常驻日火：火舌跳动、火星往上飘，是绕后要打的地方。
 * - 刨地冲撞：7–20 米、看得见玩家、基本正对时，仰头吼、前爪刨地 1 秒，地上亮起一条直线预警；随后低头直线冲锋（15 米/秒），
 *   独角犁过的地面留下一道日火裂痕（灼烧 3 秒）。撞到玩家重伤加强击飞；撞墙撞晕 1.8 秒（背上喷出日火柱、不格挡，
 *   最好的输出窗口）；没撞墙就滑行刹住 0.9 秒。
 * - 镇墓震：贴身时前身人立 0.7 秒，双前爪砸地：爆心重击，再推出一圈贴地扩散的日火冲击波（9 米，跳起能躲）。
 * - 狂怒：血量低于 40% 时仰天长吼，背上日火大盛，走得更快、冲撞冷却减半，每次冲撞后立刻再冲一次。
 * - 碎陶：每掉 12% 血，背上崩落一把陶片、裂缝更亮；死时整只陶身炸碎，日火冲天，地上留一片焦痕。
 *
 * 状态机：advance → chargeWindup → charge → (dazed | brake) → advance
 *         advance → stompWindup → stomp → advance
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { blastPlayer, zonePlayer } from '../Hazards';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { FLAME_FX_TIME, createFlameTongue, spawnFireRing, spawnFlamePillar, spawnGroundFlames, spawnScorch, type FlameTongue } from '../fx/FlameFx';

export const TOMB_BEAST_DEF: ScaledEnemyDef = {
  id: 'tomb_beast',
  name: '三彩镇墓兽',
  hp: 640,
  armor: 160,
  speed: 2.2,
  radius: 0.9,
  height: 1.9,
  damage: 42,
  coins: [8, 12],
  essence: 3,
  // 弱点 = 背上的龟裂：判定球挂在 crack 骨上（美术身体），人立 / 低头时跟着走
  headY: 1.45,
  headRadius: 0.42,
  knockbackResist: 1,
  color: 0xc9a25a,
  // 美术按 2.2 米（含独角）制作，游戏里放大到约 3.7 米：命中盒、弱点、特效一起放大
  scale: 1.7,
};

/** 正面格挡：来自正面这个夹角（余弦）以内的伤害乘以 GUARD_FACTOR */
const GUARD_FACTOR = 0.1;
const GUARD_COS = 0.34;
/** 推进时转身的角速度（弧度/秒）：慢，绕侧后方才打得到背 */
const TURN_RATE = 1.4;
/** 冲撞：触发距离（米）、蓄力、冷却、速度、最远冲多远、预警半宽（模型单位，乘体型） */
const CHARGE_RANGE = [7, 20] as const;
const CHARGE_WINDUP = 1.0;
const CHARGE_COOLDOWN = [5, 7] as const;
const CHARGE_SPEED = 15;
const CHARGE_LENGTH = 20;
const CHARGE_HALF_WIDTH = 0.75;
const CHARGE_DAMAGE_MULT = 1.4;
const CHARGE_KNOCK = 16;
const DAZED_TIME = 1.8;
const BRAKE_TIME = 0.9;
/** 冲撞犁出的日火裂痕：每隔多远落一段、半径（模型单位）、持续、每跳伤害（相对 damage） */
const TRAIL_STEP = 1.4;
const TRAIL_RADIUS = 0.6;
const TRAIL_TIME = 3;
const TRAIL_TICK = 0.5;
const TRAIL_DAMAGE_MULT = 0.15;
/** 镇墓震：触发距离与爆心半径（模型单位）、扩散冲击波最远半径与速度（米） */
const STOMP_RANGE = 3.2;
const STOMP_WINDUP = 0.7;
const STOMP_CORE = 1.6;
const STOMP_CORE_MULT = 1.0;
const WAVE_RADIUS = 9;
const WAVE_SPEED = 16;
const WAVE_DAMAGE_MULT = 0.7;
const WAVE_KNOCK = 9;
/** 跳起高于这个高度（米）就躲过冲击波 */
const WAVE_JUMP_CLEAR = 0.6;
/** 狂怒：血量比例阈值、移速倍率 */
const RAGE_AT = 0.4;
const RAGE_SPEED = 1.25;
/** 每掉这么多比例的血，背上崩落一把陶片 */
const SHARD_STEP = 0.12;
/** 脚步震屏：这个距离（米）内能感觉到 */
const STEP_SHAKE_RANGE = 22;

const C = {
  amber: 0xb8722e, green: 0x3f8a62, cream: 0xe8d8b0, claw: 0xeadfc4, glaze: 0xd9b25a,
  crack: 0xc8781e, crackHot: 0xfff0b0, eye: 0xd88a1a, eyeHot: 0xffe08a,
  warn: 0xffb040, dust: 0xc8a06a, spark: 0xffe6a0, shard: 0xd8c8a0, shardGreen: 0x4f9a70, shardAmber: 0xc07a30,
  ember: 0xffc860, sunfire: 0xfff2b8, trail: 0xff9a30,
};

/**
 * 四足步态（美术骨骼）：步频、触地比例随速度从慢走过渡到冲锋；一步里脚掌相对身体最多扫过多远（模型局部单位，
 * 再快就允许一点打滑，不把腿拉断）、抬脚高度。
 */
const GAIT_FREQ = [1.2, 2.8] as const;
const GAIT_DUTY = [0.62, 0.38] as const;
const GAIT_SWEEP = 0.75;
const GAIT_LIFT = [0.12, 0.3] as const;
/** 腿：上段、下段、末端骨骼名，对角小跑与奔跑的相位偏移；paw = 刨地的那只（右前爪） */
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, paw: false, trot: 0, gallop: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, paw: true, trot: 0.5, gallop: 0.1 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, paw: false, trot: 0.5, gallop: 0.5 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, paw: false, trot: 0, gallop: 0.6 },
] as const;
/** 人立时髋部抬起的角度（弧度） */
const REAR_PITCH = 0.55;
/**
 * 背上龟裂里的日火火舌（模型空间、未缩放；按美术网格实测背脊高度：前高后低，约 1.75 → 1.35），
 * 底部略埋进裂缝，火苗从裂缝里冒出来。挂在 crack 骨上，跟着身体走。
 */
const CRACK_TONGUES = [
  { at: [0.0, 1.68, 0.38], size: 0.34 },
  { at: [0.14, 1.58, 0.2], size: 0.26 },
  { at: [-0.12, 1.52, 0.04], size: 0.3 },
  { at: [0.1, 1.44, -0.14], size: 0.24 },
  { at: [-0.06, 1.38, -0.3], size: 0.27 },
  { at: [0.0, 1.46, 0.0], size: 0.4 },
] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

/** 每个 GameContext 只注册一次全局伤害修正（正面格挡） */
const guardInstalled = new WeakSet<object>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  front: boolean;
  side: number;
}

export class TombBeast extends StandardEnemy {
  // 白模骨架
  private body!: THREE.Group;
  private head!: THREE.Group;
  private tail: THREE.Group[] = [];
  private wings: THREE.Group[] = [];
  private legs: Leg[] = [];
  /** 背上龟裂（白模的弱点发光件；美术身体用发光壳） */
  private crackAnchor!: THREE.Object3D;
  /** 背上日火火舌（挂在 crack 骨 / 白模的龟裂上） */
  private tongues: { m: FlameTongue; base: number; phase: number }[] = [];

  private windTime = CHARGE_WINDUP;
  private chargeCd: number;
  private chargeDist = 0;
  private chargeHit = false;
  private recharge = false;
  private trailAt = 0;
  private lane: GroundDecal | null = null;
  private ring: GroundDecal | null = null;
  private blockFxAt = 0;
  private emberAcc = 0;
  private alerted = false;
  private enraged = false;
  /** 已经崩落过几把陶片 */
  private shards = 0;
  // 平滑后的姿态：低头、人立、刨地、冲锋、撞晕、日火旺度
  private pLow = 0;
  private pRear = 0;
  private pPaw = 0;
  private pRun = 0;
  private pDaze = 0;
  private pHeat = 0;
  /** 步态相位（美术骨骼）与每条腿上一帧的相位（判断落地震步） */
  private gait = 0;
  private readonly legU = [0, 0, 0, 0];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, TOMB_BEAST_DEF, opts);
    this.walkScale = 0.5;
    this.stepRate = 1.2;
    this.chargeCd = ctx.rng.range(2, 4);
    installGuard(ctx);
  }

  /** 狂怒时走得更快 */
  override get speed(): number {
    return super.speed * (this.enraged ? RAGE_SPEED : 1);
  }

  /** 釉甲格挡中（推进、蓄力）；冲撞、撞晕、刹停、踏地后摇不挡 */
  get guarding(): boolean {
    return this.alive && this.stunTime <= 0 && (this.state === 'advance' || this.state === 'stompWindup' || this.state === 'chargeWindup');
  }

  /** 这次伤害的倍率：正面被釉甲挡住时大幅减伤，并在头脸上冒火星 */
  guardFactor(req: DamageRequest): number {
    if (!this.guarding || req.source === 'status') return 1;
    if (req.direction) _v.set(-req.direction.x, 0, -req.direction.z);
    else _v.set(this.ctx.player.position.x - this.position.x, 0, this.ctx.player.position.z - this.position.z);
    const len = _v.length();
    if (len < 1e-4) return 1;
    _f.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (_v.dot(_f) / len < GUARD_COS) return 1;
    const now = this.ctx.time.now;
    if (now - this.blockFxAt > 0.07) {
      this.blockFxAt = now;
      this.localPoint((Math.random() - 0.5) * 0.9, 0.7 + Math.random() * 0.9, 1.2, _p);
      this.ctx.fx.burst(_p, C.spark, 7, 5, 0.3, 0.07 * this.sizeScale, 6);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.4, pitch: 2.1 });
    }
    // 从正面斜着擦到背上的爆头也算挡住
    return req.headshot ? GUARD_FACTOR * 0.5 : GUARD_FACTOR;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const amber = flat(C.amber, { rough: 0.35 }), green = flat(C.green, { rough: 0.35 }), cream = flat(C.cream, { rough: 0.35 });
    const claw = flat(C.claw, { rough: 0.3 });
    // 身体：长而厚的狮身（身体中心离地约 1.0），胸口更宽
    const body = joint(root, 0, 1.0, 0);
    this.body = body;
    part(body, Geo.ico(0.6, 2), cream, 0, 0.05, -0.15).scale.set(1.15, 0.95, 1.7);
    part(body, Geo.ico(0.55, 2), green, 0, 0.12, 0.45).scale.set(1.25, 1.05, 0.9);
    part(body, Geo.box(1.0, 0.12, 1.6), amber, 0, 0.6, -0.1);
    // 背上龟裂（弱点）
    this.crackAnchor = joint(body, 0, 0.6, 0);
    this.glowPart(this.crackAnchor, Geo.box(0.7, 0.05, 1.2), C.crack, C.crackHot, 0, 0.08, -0.15);
    this.setHeadAnchor(this.crackAnchor, 0, 0, 0);
    // 肩上火焰翼鳍
    for (const s of [1, -1]) {
      const w = joint(body, s * 0.62, 0.45, 0.5);
      this.wings.push(w);
      part(w, Geo.cone(0.18, 0.9, 5, 'bottom'), amber, 0, 0, 0, -0.9, 0, s * -0.35);
      part(w, Geo.cone(0.12, 0.6, 5, 'bottom'), green, s * 0.05, 0.05, -0.15, -1.1, 0, s * -0.5);
    }
    // 头：鬼面、獠牙、独角、耳冠
    const head = joint(body, 0, 0.35, 1.05);
    this.head = head;
    part(head, Geo.box(0.8, 0.7, 0.6), cream, 0, 0, 0.1);
    part(head, Geo.box(0.5, 0.3, 0.3), green, 0, -0.18, 0.42);
    part(head, Geo.cone(0.13, 0.9, 6, 'bottom'), cream, 0, 0.3, 0.05, -0.25, 0, 0);
    for (const s of [1, -1]) {
      this.glowPart(head, Geo.ico(0.08, 1), C.eye, C.eyeHot, s * 0.2, 0.1, 0.42);
      part(head, Geo.cone(0.05, 0.25, 5), claw, s * 0.18, -0.32, 0.45, Math.PI, 0, 0);
      part(head, Geo.cone(0.1, 0.5, 5, 'bottom'), amber, s * 0.42, 0.2, -0.05, -0.4, 0, s * -0.6);
    }
    // 四条粗腿（三爪）
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(body, s * 0.42, -0.1, front ? 0.55 : -0.75);
        part(upper, Geo.box(0.38, 0.55, 0.42, 'top'), front ? green : amber, 0, 0, 0);
        const lower = joint(upper, 0, -0.55, 0);
        part(lower, Geo.box(0.34, 0.4, 0.36, 'top'), cream, 0, 0, 0);
        for (const k of [-1, 0, 1]) part(lower, Geo.cone(0.06, 0.18, 5), claw, k * 0.11, -0.38, 0.2, Math.PI / 2, 0, 0);
        this.legs.push({ upper, lower, front, side: s });
      }
    }
    // 火焰尾
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, i === 0 ? 0.3 : 0, i === 0 ? -1.15 : -0.3);
      part(seg, Geo.cone(0.16 - i * 0.04, 0.4, 5), i % 2 ? green : amber, 0, 0, -0.15, -Math.PI / 2, 0, 0);
      this.tail.push(seg);
      parent = seg;
    }
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    const crack = n?.pose.bone('crack') ?? null;
    if (n && crack) {
      // 弱点判定跟着美术的背部龟裂：crack 骨刚性蒙住整片裂纹（发光壳也在它上面），骨头根部就在背脊表面；白模的发光条收起
      this.setHeadAnchor(crack, 0, 0, 0);
      if (n.glowShell) this.crackAnchor.visible = false;
      // 白模的眼睛发光件按方块脑袋摆，对不上美术的鬼面（会飘在肩上）：美术贴图自带金色眼睛，收起
      this.head.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = false;
      });
    }
    this.buildCrackFire(crack ?? this.crackAnchor);
  }

  /** 背上龟裂里的日火火舌：位置按模型空间给，换算到挂点局部（骨骼的缩放各不相同） */
  private buildCrackFire(parent: THREE.Object3D): void {
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    // 出生时模型还在缩放动画里：尺寸按「相对模型根」折算，不能直接用世界缩放
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    const ps = parent.getWorldScale(new THREE.Vector3()).x;
    for (const t of CRACK_TONGUES) {
      const m = createFlameTongue(Math.random(), 0xfff6d0, 0xffb040, 0xe0501a);
      parent.add(m);
      m.position.copy(parent.worldToLocal(host.localToWorld(new THREE.Vector3(t.at[0], t.at[1], t.at[2]))));
      const base = (t.size * hostScale) / Math.max(1e-6, ps);
      m.scale.setScalar(base);
      this.tongues.push({ m, base, phase: Math.random() * 10 });
    }
  }

  protected override cancelAttack(): void {
    this.hideWarnings();
    this.accel = 22;
    this.glowTarget[0] = 0;
    if (this.state !== 'advance' && this.state !== 'idle') {
      this.setState('advance');
      this.chargeCd = Math.max(this.chargeCd, 2);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideWarnings();
    for (const t of this.tongues) t.m.material.dispose();
    this.tongues.length = 0;
  }

  private hideWarnings(): void {
    this.lane?.release();
    this.lane = null;
    this.ring?.release();
    this.ring = null;
  }

  /** 震屏：按离玩家的距离衰减 */
  private quake(strength: number, range: number, dur = 0.3): void {
    const k = clamp01(1 - this.distToPlayerXZ() / range);
    if (k > 0) this.ctx.fx.shake(strength * k, dur);
  }

  /** 仰头长吼：震屏、头顶一圈热浪、背上火星迸发 */
  private roar(volume = 0.8): void {
    this.localPoint(0, 1.3, 1.1, _p);
    this.ctx.audio.play('boss_roar', { position: _p, volume, pitch: 0.75 });
    this.ctx.fx.ring(_p, 2.5 * this.sizeScale, C.sunfire, 0.45);
    this.getHeadCenter(_v);
    this.ctx.fx.burst(_v, C.ember, 18, 4, 0.9, 0.08 * this.sizeScale, -3);
    this.quake(0.35, 28, 0.5);
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    const yawTo = Math.atan2(pl.position.x - this.position.x, pl.position.z - this.position.z);
    this.chargeCd -= dt * this.attackRate * (this.enraged ? 2 : 1);
    this.checkShards();
    if (!this.alerted && this.sees && d < 30) {
      this.alerted = true;
      this.roar(0.7);
    }
    if (!this.enraged && this.hp / this.maxHp < RAGE_AT) {
      this.enraged = true;
      this.roar(1);
      this.getHeadCenter(_p);
      spawnFlamePillar(this.ctx, _p, 0.5 * this.sizeScale, 2.6 * this.sizeScale);
    }
    switch (this.state) {
      case 'advance': {
        this.accel = 22;
        this.glowTarget[0] = (this.enraged ? 0.55 : 0.25) + 0.1 * Math.sin(this.age * 2);
        this.facing = rotateTowards(this.facing, yawTo, TURN_RATE * (this.enraged ? 1.3 : 1) * dt);
        if (d <= STOMP_RANGE * this.sizeScale && this.verticalReach(2) && this.cooldown <= 0) {
          this.beginStomp();
          break;
        }
        if (this.chargeCd <= 0 && d >= CHARGE_RANGE[0] && d <= CHARGE_RANGE[1] && this.sees && this.verticalReach(1.5) && this.facingDot() > 0.85) {
          this.beginCharge();
          break;
        }
        const stop = 2.4 * this.sizeScale;
        if (d > stop) this.approachPlayer(this.speed, stop);
        else this.stopMoving();
        break;
      }
      case 'chargeWindup': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        // 前 60% 还能微调方向，之后锁定（侧移可躲）
        if (t < 0.6) this.facing = rotateTowards(this.facing, yawTo, 1.2 * dt);
        this.updateLane(t);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        // 刨地：一下一扬沙，越来越响
        if (Math.floor(this.stateTime / 0.3) !== Math.floor((this.stateTime - dt) / 0.3)) {
          this.localPoint(-0.47, 0.05, 1.1, _p);
          this.ctx.fx.burst(_p, C.dust, 10, 3, 0.5, 0.16 * this.sizeScale, 8);
          this.ctx.audio.play('footstep', { position: _p, volume: 0.8, pitch: 0.5 });
          this.quake(0.12, 16, 0.15);
        }
        if (this.stateTime >= this.windTime) this.startCharge();
        break;
      }
      case 'charge':
        this.chargeStep(dt);
        break;
      case 'dazed': {
        this.stopMoving();
        this.glowTarget[0] = 1;
        if (this.stateTime >= DAZED_TIME) this.endCharge();
        break;
      }
      case 'brake': {
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), Math.max(0, CHARGE_SPEED * (1 - this.stateTime / 0.35)));
        this.glowTarget[0] = 0.7;
        if (this.stateTime < 0.35 && Math.floor(this.stateTime / 0.08) !== Math.floor((this.stateTime - dt) / 0.08)) {
          this.localPoint(0, 0.05, 1.0, _p);
          this.ctx.fx.burst(_p, C.dust, 6, 3, 0.6, 0.2 * this.sizeScale, 6);
        }
        if (this.stateTime >= BRAKE_TIME) {
          if (this.recharge) {
            this.recharge = false;
            this.facing = yawTo;
            this.beginCharge(0.5);
          } else this.endCharge();
        }
        break;
      }
      case 'stompWindup': {
        this.stopMoving();
        this.facePlayer(2, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        if (this.ring) {
          this.ring.circle(this.position.x, this.position.y, this.position.z, WAVE_RADIUS);
          this.ring.fill = t;
          this.ring.opacity = 0.25 + 0.5 * t;
        }
        if (this.stateTime >= this.windTime) this.stomp();
        break;
      }
      case 'stomp': {
        this.stopMoving();
        if (this.stateTime >= 0.55) {
          this.setState('advance');
          this.rollCooldown(2.0, 2.8);
        }
        break;
      }
      default:
        this.setState('advance');
    }
  }

  /** 背上每掉 SHARD_STEP 的血崩落一把陶片 */
  private checkShards(): void {
    const lost = 1 - this.hp / this.maxHp;
    while (this.shards < Math.floor(lost / SHARD_STEP)) {
      this.shards++;
      this.getHeadCenter(_p);
      const s = this.sizeScale;
      this.ctx.fx.burst(_p, C.shard, 10, 5, 0.9, 0.11 * s, 16);
      this.ctx.fx.burst(_p, C.shardGreen, 5, 5, 0.9, 0.1 * s, 16);
      this.ctx.fx.burst(_p, C.sunfire, 8, 3, 0.4, 0.14 * s, -2);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.6, pitch: 1.2 });
    }
  }

  private beginCharge(windup = CHARGE_WINDUP): void {
    this.windTime = this.windup(windup, 0.45);
    this.setState('chargeWindup');
    this.stopMoving();
    this.roar(0.7);
    this.hideWarnings();
    this.lane = GroundDecal.acquire(this.ctx.stageGroup, C.warn);
    this.updateLane(0);
  }

  /** 地面直线预警：从身前起，沿朝向延伸，随蓄力填满 */
  private updateLane(t: number): void {
    const lane = this.lane;
    if (!lane) return;
    const sx = Math.sin(this.facing), sz = Math.cos(this.facing), k = this.sizeScale;
    lane.rect(this.position.x + sx * 1.2 * k, this.position.y, this.position.z + sz * 1.2 * k, this.facing, CHARGE_LENGTH, CHARGE_HALF_WIDTH * k);
    lane.fill = t;
    lane.opacity = 0.35 + 0.5 * t;
  }

  private startCharge(): void {
    this.setState('charge');
    this.hideWarnings();
    this.chargeDist = 0;
    this.trailAt = 0;
    this.chargeHit = false;
    this.accel = 70;
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 1, pitch: 0.6 });
    this.quake(0.3, 20, 0.25);
  }

  /** 冲锋一帧：直线前冲，扫到玩家（只打一次），沿途犁出日火裂痕；撞墙撞晕，冲满距离就刹车 */
  private chargeStep(dt: number): void {
    const sx = Math.sin(this.facing), sz = Math.cos(this.facing), k = this.sizeScale;
    this.setMove(sx, sz, CHARGE_SPEED);
    this.chargeDist += Math.hypot(this.velocity.x, this.velocity.z) * dt;
    this.glowTarget[0] = 0.9;
    while (this.chargeDist - this.trailAt >= TRAIL_STEP) {
      this.trailAt += TRAIL_STEP;
      this.dropTrail();
    }
    const pl = this.ctx.player;
    if (!this.chargeHit && pl.alive) {
      _v.subVectors(pl.position, this.position);
      const along = _v.x * sx + _v.z * sz;
      const side = Math.abs(_v.x * sz - _v.z * sx);
      if (along > -0.3 && along < (1.3 + 0.9) * k && side < 0.9 * k + pl.radius && _v.y > -1 && _v.y < 1.8 * k) {
        this.chargeHit = true;
        this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * CHARGE_DAMAGE_MULT, 'none', this, this.position);
        _v.set(sx, 0, sz).multiplyScalar(CHARGE_KNOCK);
        _v.y = 7;
        pl.applyImpulse(_v);
        this.ctx.fx.shake(0.9, 0.35);
        this.ctx.audio.play('boss_slam', { position: pl.position, volume: 0.8, pitch: 1.3 });
      }
    }
    if (this.moveResult.hitWall && this.stateTime > 0.15) {
      this.wallImpact();
      return;
    }
    if (this.chargeDist >= CHARGE_LENGTH || this.stateTime > CHARGE_LENGTH / CHARGE_SPEED + 0.6) {
      this.setState('brake');
      this.recharge = (this.isElite || this.enraged) && !this.recharge;
    }
  }

  /** 撞墙：撞晕，碎石四溅，背上喷出日火柱 */
  private wallImpact(): void {
    this.setState('dazed');
    const ctx = this.ctx, k = this.sizeScale;
    this.localPoint(0, 1.0, 1.5, _p);
    ctx.fx.burst(_p, C.dust, 24, 6, 0.9, 0.26 * k, 10);
    ctx.fx.burst(_p, C.shard, 10, 6, 0.8, 0.1 * k, 18);
    ctx.audio.play('boss_slam', { position: _p, volume: 1, pitch: 0.8 });
    ctx.audio.play('shield_break', { position: _p, volume: 0.7, pitch: 0.9 });
    this.getHeadCenter(_p);
    spawnFlamePillar(ctx, _p, 0.45 * k, 2.2 * k);
    this.quake(0.8, 24, 0.45);
  }

  /** 冲撞犁过的地面：一段日火裂痕（贴花 + 跳动的火苗），灼烧站在里面的玩家 */
  private dropTrail(): void {
    const ctx = this.ctx, k = this.sizeScale;
    const gy = ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
    const ground = new THREE.Vector3(this.position.x, Number.isFinite(gy) ? gy : this.position.y, this.position.z);
    const r = TRAIL_RADIUS * k;
    const decal = GroundDecal.acquire(ctx.stageGroup, C.trail).circle(ground.x, ground.y, ground.z, r);
    decal.pattern = 1;
    spawnGroundFlames(ctx, ground, r * 0.7, 3, TRAIL_TIME, 0.45 * k);
    ctx.fx.burst(ground, C.dust, 6, 3, 0.6, 0.22 * k, 6);
    const dmg = this.def.damage * this.damageMult * TRAIL_DAMAGE_MULT;
    let t = 0, tick = 0.15;
    ctx.tasks.add((dt) => {
      t += dt;
      decal.time = t;
      decal.opacity = t < 0.1 ? t / 0.1 : Math.max(0, 1 - Math.max(0, t - (TRAIL_TIME - 0.6)) / 0.6);
      tick -= dt;
      if (tick <= 0) {
        tick += TRAIL_TICK;
        zonePlayer(ctx, ground, r, dmg, 'fire', null);
      }
      if (t >= TRAIL_TIME) {
        decal.release();
        return true;
      }
      return false;
    });
  }

  private endCharge(): void {
    this.accel = 22;
    this.setState('advance');
    this.chargeCd = this.ctx.rng.range(CHARGE_COOLDOWN[0], CHARGE_COOLDOWN[1]);
  }

  private beginStomp(): void {
    this.windTime = this.windup(STOMP_WINDUP, 0.4);
    this.setState('stompWindup');
    this.stopMoving();
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 0.5 });
    this.hideWarnings();
    this.ring = GroundDecal.acquire(this.ctx.stageGroup, C.warn);
  }

  /** 镇墓震：双前爪砸地，爆心重击，再推出一圈贴地扩散的日火冲击波 */
  private stomp(): void {
    this.setState('stomp');
    this.hideWarnings();
    const ctx = this.ctx, k = this.sizeScale;
    this.localPoint(0, 0, 1.0, _p);
    const gy = ctx.world.groundHeight(_p.x, _p.z, this.position.y + 0.5);
    const ground = new THREE.Vector3(_p.x, Number.isFinite(gy) ? gy : this.position.y, _p.z);
    ctx.audio.play('boss_slam', { position: ground, volume: 1, pitch: 0.7 });
    ctx.audio.play('explosion', { position: ground, volume: 0.5, pitch: 0.6 });
    ctx.fx.burst(ground, C.dust, 26, 7, 0.9, 0.3 * k, 10);
    ctx.fx.burst(ground, C.shard, 10, 6, 0.7, 0.08 * k, 18);
    spawnFlamePillar(ctx, ground, 0.6 * k, 2 * k);
    spawnScorch(ctx, ground, STOMP_CORE * k, 7);
    spawnFireRing(ctx, ground, WAVE_RADIUS);
    ctx.fx.ring(ground, WAVE_RADIUS, 0xffd080, WAVE_RADIUS / WAVE_SPEED);
    this.quake(0.9, 26, 0.45);
    blastPlayer(ctx, ground.clone().setY(ground.y + 0.6), STOMP_CORE * k, this.def.damage * this.damageMult * STOMP_CORE_MULT, 'none', this, 0.3, 0, 8);
    this.launchWave(ground);
  }

  /** 贴地扩散的冲击波：波面扫过地上的玩家（只打一次）造成伤害并往外推；跳起能躲 */
  private launchWave(center: THREE.Vector3): void {
    const ctx = this.ctx;
    const dmg = this.def.damage * this.damageMult * WAVE_DAMAGE_MULT;
    const inner = STOMP_CORE * this.sizeScale;
    const source = this;
    let r = 0, prev = 0, hit = false, fxAcc = 0;
    ctx.tasks.add((dt) => {
      prev = r;
      r = Math.min(WAVE_RADIUS, r + WAVE_SPEED * dt);
      const pl = ctx.player;
      if (!hit && pl.alive) {
        const dx = pl.position.x - center.x, dz = pl.position.z - center.z;
        const dist = Math.hypot(dx, dz);
        const rise = pl.position.y - center.y;
        if (dist > inner && dist >= prev - 0.4 && dist <= r + 0.4 && rise > -0.6 && rise < WAVE_JUMP_CLEAR) {
          hit = true;
          ctx.combat.damagePlayer(dmg, 'none', source, center);
          _v.set(dx, 0, dz).normalize().multiplyScalar(WAVE_KNOCK);
          _v.y = 5;
          pl.applyImpulse(_v);
        }
      }
      // 波面扬沙
      fxAcc += (r - prev) * 2.2;
      while (fxAcc >= 1) {
        fxAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        _p.set(center.x + Math.cos(a) * r, center.y + 0.1, center.z + Math.sin(a) * r);
        ctx.fx.burst(_p, C.dust, 2, 2.5, 0.5, 0.2, 6);
      }
      return r >= WAVE_RADIUS;
    });
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (attackDirector.purging) return;
    // 整只陶身炸碎：三彩碎片四溅，日火冲天，地上留一片焦痕
    const ctx = this.ctx, k = this.sizeScale;
    const center = this.getBodyCenter(new THREE.Vector3());
    for (const col of [C.shard, C.shardGreen, C.shardAmber]) ctx.fx.burst(center, col, 16, 7, 1.2, 0.14 * k, 18);
    ctx.fx.burst(center, C.sunfire, 20, 5, 0.6, 0.2 * k, -3);
    const gy = ctx.world.groundHeight(center.x, center.z, center.y + 1);
    const ground = new THREE.Vector3(center.x, Number.isFinite(gy) ? gy : this.position.y, center.z);
    spawnFlamePillar(ctx, ground, 0.8 * k, 3.2 * k);
    spawnScorch(ctx, ground, 1.6 * k, 10);
    spawnGroundFlames(ctx, ground, 1.0 * k, 6, 2.5, 0.5 * k);
    ctx.audio.play('shield_break', { position: center, volume: 1, pitch: 0.7 });
    ctx.audio.play('explosion', { position: center, volume: 0.7, pitch: 0.8 });
    this.quake(0.6, 24, 0.4);
  }

  protected override pose(dt: number): void {
    // 姿态目标：推进时低头；刨地时更低、右前爪刨；冲锋时压低前冲；撞晕摇头；人立
    const st = this.state;
    let low = 0.35, rear = 0, paw = 0, run = 0, daze = 0, rate = 8;
    if (st === 'chargeWindup') {
      // 先仰头吼，再低头刨地
      const t = this.stateTime / this.windTime;
      low = t < 0.25 ? -0.6 : 0.85;
      paw = t < 0.25 ? 0 : 1;
    } else if (st === 'charge') { low = 1; run = 1; rate = 14; }
    else if (st === 'brake') { low = 0.7; run = 0.4; }
    else if (st === 'dazed') { low = 0.2; daze = 1; }
    else if (st === 'stompWindup') { rear = smooth(this.stateTime / this.windTime); low = 0; rate = 16; }
    else if (st === 'stomp') { rear = 0; low = 0.7; rate = 30; }
    else if (st === 'idle') low = 0.1;
    const k = 1 - Math.exp(-rate * dt);
    this.pLow = mix(this.pLow, low, k);
    this.pRear = mix(this.pRear, rear, st === 'stompWindup' ? 1 : k);
    this.pPaw = mix(this.pPaw, paw, k);
    this.pRun = mix(this.pRun, run, k);
    this.pDaze = mix(this.pDaze, daze, k);
    const heat = Math.max(this.enraged ? 0.75 : 0.3, clamp01(this.glowLevel[0]));
    this.pHeat = mix(this.pHeat, heat, 1 - Math.exp(-6 * dt));
    this.updateCrackFire(dt);
    if (this.nativeBody) {
      this.poseNative(this.nativeBody, dt);
      return;
    }
    this.poseBlockout();
  }

  /** 背上的日火：火舌随旺度蹿高，火星往上飘（狂怒 / 蓄力 / 撞晕时最旺） */
  private updateCrackFire(dt: number): void {
    FLAME_FX_TIME.value = this.ctx.time.now;
    const heat = this.pHeat;
    for (const t of this.tongues) {
      const flick = 1 + 0.15 * Math.sin(this.age * 12 + t.phase) + 0.08 * Math.sin(this.age * 27 + t.phase * 2);
      const grow = 0.55 + 1.0 * heat;
      t.m.scale.set(t.base * grow * 0.9, t.base * grow * flick * 1.3, t.base * grow);
      t.m.material.uniforms.uAlpha.value = 0.5 + 0.5 * heat;
    }
    this.emberAcc += dt * (0.4 + 1.6 * heat);
    while (this.emberAcc > 0.12) {
      this.emberAcc -= 0.12;
      this.localPoint((Math.random() - 0.5) * 0.6, 1.45 + Math.random() * 0.2, (Math.random() - 0.5) * 0.8, _p);
      this.ctx.fx.burst(_p, Math.random() < 0.6 ? C.ember : C.sunfire, 1, 0.8, 0.9, 0.05 * this.sizeScale, -3);
    }
  }

  /** 白模动画：对角小跑；低头时头和独角压到身前；人立时绕后腿抬起前半身；撞晕摇头 */
  private poseBlockout(): void {
    const amp = Math.min(1.2, Math.hypot(this.velocity.x, this.velocity.z) / Math.max(1, this.def.speed)) * this.walkScale;
    const ph = this.walkPhase * (1 + this.pRun);
    const b = this.body;
    b.position.set(0, 1.0 + Math.abs(Math.sin(ph)) * 0.04 * amp + this.pRear * 0.35, -this.pRear * 0.3);
    b.rotation.set(-this.pRear * 0.75 + this.pLow * 0.08 - this.hurtKick * 0.15, 0, this.pDaze * Math.sin(this.age * 9) * 0.12);
    this.head.rotation.set(this.pLow * 0.45 - this.pRear * 0.3, this.pDaze * Math.sin(this.age * 11) * 0.4, 0);
    for (const l of this.legs) {
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph + off);
      const paw = l.front && l.side < 0 ? this.pPaw * Math.max(0, Math.sin(this.age * 20)) : 0;
      l.upper.rotation.x = swing * 0.5 * amp - (l.front ? this.pRear * 0.9 + paw * 0.6 : -this.pRear * 0.75);
      l.lower.rotation.x = (l.front ? 1 : -1) * Math.max(0, -swing) * 0.4 * amp + (l.front ? this.pRear * 1.2 + paw * 0.8 : 0);
    }
    for (const [i, w] of this.wings.entries()) w.rotation.z = (i === 0 ? -1 : 1) * (0.1 * Math.sin(this.age * 3) + this.pRun * 0.3);
    for (const [i, seg] of this.tail.entries()) {
      seg.rotation.x = 0.25 - this.pRun * 0.3 + Math.sin(this.age * 3 + i) * 0.05;
      seg.rotation.y = Math.sin(this.age * 2.4 - i * 0.8) * (0.15 + 0.2 * amp);
    }
  }

  /**
   * 美术骨骼动画（四足，creature_rigs/SK_Enemy_TombBeast.json）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前倾 / 低头，负转 = 抬头 / 前身抬起。
   * - 步态：每条腿一个相位，触地段脚往后扫、腾空段抬脚前摆，两骨 IK 解；慢走对角小跑，冲锋过渡到前后成对的奔跑。
   *   每只脚落地时扬尘、按距离震屏（沉重感）。
   * - 低头护面、看向玩家；冲撞前先仰头吼，再低头刨地（右前爪一下下往后刨）；人立时绕髋抬起前半身（后脚钉地、前爪收起），
   *   踏地时砸下；撞晕时摇头、身体打晃；翼鳍和火焰尾跟着动作摆；背上发光壳随蓄力 / 撞晕 / 狂怒变亮。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const move = clamp01(sp / 0.8);
    const sn = clamp01((sp - this.def.speed) / (CHARGE_SPEED - this.def.speed));  // 0 = 走，1 = 全速冲锋
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * sn;
    const rear = this.pRear;
    const sweep = Math.min(GAIT_SWEEP, (sp * duty) / (freq * this.sizeScale)) * (1 - rear);
    const lift = (GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * sn) * move * (1 - rear);
    const ph = this.gait * Math.PI * 2;
    const daze = this.pDaze + (this.stunTime > 0 ? 1 : 0);

    // 身体：步子起伏、冲锋时前倾和脊柱屈伸；人立绕髋抬起前半身；受击后仰；撞晕打晃
    P.translate('hips', 0, -0.03 * move * (1 - Math.cos(ph * 2)) * 0.5 - 0.06 * Math.max(0, this.pLow) * (1 - rear), 0);
    P.rotate('hips', AX, 0.06 * sn - rear * REAR_PITCH);
    P.rotate('hips', AZ, Math.sin(ph) * 0.03 * move + daze * Math.sin(this.age * 7) * 0.08);
    P.rotate('spine', AX, 0.1 * sn * Math.sin(ph) - rear * 0.1);
    P.rotate('chest', AX, -0.08 * sn * Math.sin(ph + 0.6) - this.hurtKick * 0.25 + 0.04 * Math.sin(this.age * 1.7));
    // 头：低头把独角和鬼面对着玩家，看向玩家；冲锋时再压低（独角朝前顶）；人立时低头俯视；撞晕摇头
    const pl = this.ctx.player.position;
    let dyaw = Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const look = this.state === 'charge' || daze > 0.1 ? 0 : THREE.MathUtils.clamp(dyaw, -0.7, 0.7);
    P.rotate('neck', AY, look * 0.5);
    P.rotate('head', AY, look * 0.3 + daze * Math.sin(this.age * 11) * 0.35);
    // 人立时扣住髋部抬起的角度、再往下压：鬼面居高临下俯视玩家，而不是仰头看天
    P.rotate('neck', AX, this.pLow * 0.3 + this.pRun * 0.25 + rear * 0.35 - 0.05 * sn * Math.sin(ph));
    P.rotate('head', AX, this.pLow * 0.25 + this.pRun * 0.35 + rear * 0.3 - this.hurtKick * 0.2);
    // 翼鳍：平时随呼吸轻扇，冲锋时向后贴，人立 / 狂怒时张开
    const flare = 0.25 * rear + (this.enraged ? 0.12 : 0);
    for (const [s, k] of [['L', 1], ['R', -1]] as const) {
      P.rotate(`wing_${s}`, AZ, k * (0.05 * Math.sin(this.age * 2.2) - 0.15 * this.pRun + flare));
      P.rotate(`wing_${s}`, AX, 0.35 * this.pRun);
    }
    // 火焰尾：走动时左右摆，冲锋时拉平向后，撞晕时乱甩
    const wag = 0.1 + 0.15 * move + 0.3 * daze;
    for (let i = 1; i <= 3; i++) {
      const b = `tail_${i}`;
      if (i === 1) P.rotate(b, AX, 0.5 * this.pRun - 0.2 * rear);
      P.rotate(b, AX, 0.04 * Math.sin(this.age * 2.5 + i));
      P.rotate(b, AY, wag * Math.sin(this.age * (2.6 + 4 * sn + 6 * daze) - i * 0.8));
    }
    // 腿 IK：触地段从前往后扫，腾空段抬脚前摆；人立时前爪收到胸前（目标随人立抬高、脚掌放松下垂，
    // 砸下时沿 IK 落回地面，不会先穿进地里）；刨地时右前爪往后刨
    for (const [li, leg] of LEGS.entries()) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      if (leg.front && rear > 0.02) {
        _t.set(rest.x, rest.y + 0.85 * rear, rest.z + 0.1 * rear);
        P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1 - rear);
        continue;
      }
      const off = leg.trot + (leg.gallop - leg.trot) * sn;
      const u = (this.gait + off) % 1;
      // 落地（腾空段结束、进入触地段）：扬尘、震屏
      if (move > 0.3 && this.legU[li] > duty && u < duty) this.footfall(leg.e, sn);
      this.legU[li] = u;
      let dz: number, dy: number;
      if (u < duty) {
        dz = sweep * (0.5 - u / duty);
        dy = 0;
      } else {
        const t = (u - duty) / (1 - duty);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * lift;
      }
      if (leg.paw) {
        // 刨地：抬起 → 往前伸 → 压下往后刨，一秒约三下
        const c = (this.age * 3.2) % 1;
        dz += this.pPaw * (c < 0.5 ? mix(-0.25, 0.2, smooth(c / 0.5)) : mix(0.2, -0.25, (c - 0.5) / 0.5));
        dy += this.pPaw * (c < 0.5 ? Math.sin((c / 0.5) * Math.PI) * 0.22 : 0);
      }
      _t.set(rest.x, rest.y + dy, rest.z + dz);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1);
    }
    if (n.glowShell) n.glowShell.opacity = clamp01(Math.max(this.glowLevel[0], this.pHeat * 0.6)) * 0.9;
  }

  /** 一只脚落地：脚下扬尘，按距离轻震屏（冲锋时更重） */
  private footfall(bone: string, sn: number): void {
    const b = this.nativeBody?.pose.bone(bone);
    if (!b) return;
    b.getWorldPosition(_p);
    _p.y = this.position.y + 0.05;
    this.ctx.fx.burst(_p, C.dust, 4 + Math.round(4 * sn), 1.6 + 2 * sn, 0.55, 0.2 * this.sizeScale, 6);
    this.quake(0.05 + 0.1 * sn, STEP_SHAKE_RANGE, 0.12);
    if (this.distToPlayerXZ() < STEP_SHAKE_RANGE) this.ctx.audio.play('footstep', { position: _p, volume: 0.5 + 0.4 * sn, pitch: 0.45 });
  }
}

/** 正面格挡：全局伤害修正，只对推进中的镇墓兽生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof TombBeast ? enemy.guardFactor(req) : 1));
}
