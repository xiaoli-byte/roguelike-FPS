/**
 * 冻鲛人（jiaoren，第二章 · 昆仑雪墟的群怪，北冥一侧）：北冥冰海里溺亡水手的诅咒，矮小佝偻的鱼人。
 * 圆鼓鼓的大鱼头、玻璃似的凸眼、一张气鼓鼓的阔嘴，蓝灰鳞皮结着霜，小臂和后背长着破鳍，身后拖一条短鱼尾；
 * 额头嵌着一颗发光的鲛珠（弱点，头部判定罩住整张鱼脸）。手里一支冻鱼骨矛（程序化部件，挂在美术的右手骨上）。
 * 和雪狌狌同为群怪：狌狌贴身缠人、爬高台；鲛人先远投骨矛，再成群突刺。
 *
 * - 投矛：10–18 米外、看得见玩家时举矛过肩 0.5 秒（鲛珠和矛头亮起），投出一支低弧线的骨矛（只预判一半的移动：横移就能躲）。
 *   投完手里空了，冰在手心里重新冻出一支新矛要 5 秒；空手时不再拉开距离，转而凑到玩家身边。
 * - 围拢：手里有矛又还没接战时，守在 10–18 米的投矛距离带上横移；投过一次矛、或被玩家贴近到 7 米内就算接战，
 *   绕着玩家在 2.5–4.5 米的近身带上打转、慢慢合围。
 * - 群刺：6.5 米内有 3 只以上（含自己）可以出手的鲛人时，它们一起压低身子 0.45 秒（依次错开 0.12 秒，咕噜咕噜叫），
 *   然后朝玩家当时的位置直线突刺 4–5 米；刺完收势 0.7 秒（输出窗口）。同一群 4.5 秒内只发起一次。
 * - 戳刺：落单贴身（2 米内）时用矛 / 爪子快戳一下（0.35 秒前摇）。
 * - 鲛珠：死时额头的鲛珠蹦出来滚一小段，停下后变成一个小回复（玩家最大生命的 5%，精英 10%）。
 *
 * 状态机：advance → aim → throw → recover → advance
 *         advance → lungeWindup → lunge → recover → advance
 *         advance → jabWindup → jab → recover → advance
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, ProjectileSpec, SpawnOptions } from '../../core/types';
import type { BlockableProjectileSpec } from '../../combat/Projectiles';
import { clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { Geo, flat, joint, part } from '../Models';
import { FROST, SPEAR_TIP, assembleSpear, dropPearl, launchSpearVisual, type SpearFlight } from '../fx/FrostPackFx';
import { SpringTail, mix, smooth } from '../frost/PackMotion';

export const JIAOREN_DEF: ScaledEnemyDef = {
  id: 'jiaoren',
  name: '冻鲛人',
  // 美术按 1.4 米（含头冠）制作，游戏里放大 1.15 倍（约 1.6 米）：大鱼头在 10–18 米的投矛距离上也认得出来
  scale: 1.15,
  hp: 40,
  speed: 5.2,
  radius: 0.3,
  height: 1.2,
  damage: 11,
  coins: [1, 2],
  essence: 1,
  // 弱点 = 额头鲛珠：判定球罩住整张鱼脸（球心离地约 1.02、略靠前），跟着头骨走
  headY: 1.02,
  headRadius: 0.21,
  knockbackResist: 0,
  color: 0x7fd8ff,
};

/** 投矛距离带（米）、前摇、矛速与弹道重力、预判比例、重新冻出一支矛的时间 */
const THROW_RANGE = [10, 18] as const;
const THROW_WINDUP = 0.5;
const THROW_FOLLOW = 0.25;
const SPEAR_SPEED = 24;
const SPEAR_GRAVITY = 4;
const SPEAR_LEAD = 0.5;
const SPEAR_REGROW = 5;
/** 接战后绕着玩家打转的距离带 */
const CLOSE_BAND = [2.5, 4.5] as const;
/** 被贴近到这个距离就算接战（不再退回投矛距离带）；玩家拉开到 ENGAGE_DROP 以外重新守投矛带 */
const ENGAGE_NEAR = 7;
const ENGAGE_DROP = 20;
/** 群刺：触发距离、最少成员、前摇、成员之间的错开、突刺速度 / 时长、命中距离、伤害倍率、同一群的间隔 */
const PACK_RANGE = 6.5;
const PACK_MIN = 3;
const LUNGE_WINDUP = 0.45;
const LUNGE_STAGGER = 0.12;
const LUNGE_SPEED = 11;
const LUNGE_TIME = 0.42;
const LUNGE_HIT = 1.25;
const LUNGE_DAMAGE_MULT = 0.85;
const LUNGE_RECOVER = 0.7;
const PACK_GAP = 4.5;
/** 戳刺：距离、前摇、伤害倍率 */
const JAB_RANGE = 1.6;
const JAB_WINDUP = 0.35;
const JAB_DAMAGE_MULT = 0.7;
/** 鲛珠回复（玩家最大生命的比例） */
const PEARL_HEAL = 0.05;
/** 美术模型里矛握在掌心：腕关节沿手骨方向往指尖走这么远（米） */
const GRIP_OFFSET = 0.05;
/** 握矛的朝向（模型空间，绑定姿势）：矛尖朝前略向上 */
const HOLD_DIR = new THREE.Vector3(0, 0.35, 1).normalize();
/** 步态：步频（每秒步数，随速度）、触地占比、最大步幅（模型单位）、抬脚高度 */
const GAIT_FREQ = [1.6, 3.2] as const;
const GAIT_DUTY = 0.58;
const GAIT_STRIDE = 0.24;
const GAIT_LIFT = 0.07;

const C = {
  skin: 0x6f9cc8, belly: 0xdfe8ef, fin: 0x4f8fd8, finTip: 0xa8dcff, eye: 0x18324a, eyeWhite: 0xe8f4ff,
  cloth: 0x4a3a34, sash: 0x7a3a30, rope: 0x9c7c58, claw: 0x2a2a34,
  pearl: 0x2fb8d8, pearlHot: 0xd8ffff, bladeGlow: 0x000000, bladeHot: 0x8ff0ff,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();

export class Jiaoren extends StandardEnemy {
  /** 同一群里上一次群刺的发起时间（所有鲛人共用） */
  private static packGate = -Infinity;

  protected hips!: THREE.Group;
  protected torso!: THREE.Group;
  protected head!: THREE.Group;
  protected readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  protected readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  protected readonly tail: THREE.Group[] = [];
  /** 骨矛（白模和美术身体共用：美术身体时挂到 hand_R 骨上） */
  protected spear!: THREE.Group;
  private pearlGlow!: THREE.Mesh;
  /** 手里有矛；没有时 regrow 计时到 SPEAR_REGROW 重新冻出一支 */
  hasSpear = true;
  /** 最近一次投出的飞矛外观（测试与调试用） */
  lastSpear: SpearFlight | null = null;
  private regrow = 0;
  /** 已接战：绕着玩家近身打转，不再退回投矛距离带 */
  engaged = false;
  private windTime = THROW_WINDUP;
  private recoverTime = 0.4;
  private lungeHit = false;
  private readonly lungeDir = new THREE.Vector3();
  /** 群刺 / 戳刺之后的个人冷却 */
  private lungeCooldown = 0;
  /** 步态相位 0..1 */
  private gait = 0;
  private tailSpring: SpringTail | null = null;
  /** 握矛的局部朝向（手骨 / 白模手节点局部） */
  private readonly spearHoldQ = new THREE.Quaternion();
  /** 骨矛挂到骨骼上之后的局部缩放（抵消骨骼自身的缩放） */
  private spearBaseScale = 1;
  // 平滑后的姿态参数
  private pAim = 0;
  private pCrouch = 0;
  private pThrust = 0;
  private pLean = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, JIAOREN_DEF, opts);
    this.walkScale = 0.8;
    this.stepRate = 1.8;
    this.accel = 30;
    this.cooldown = ctx.rng.range(0.8, 2.2);
    this.lungeCooldown = ctx.rng.range(0.5, 1.5);
  }

  // ───────────── 模型（白模兜底：?classic 或资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin), belly = flat(C.belly), fin = flat(C.fin, { rough: 0.5 }), tip = flat(C.finTip, { rough: 0.4 });
    const cloth = flat(C.cloth), sash = flat(C.sash), rope = flat(C.rope), claw = flat(C.claw, { rough: 0.5 });

    const hips = joint(root, 0, 0.44, 0);
    this.hips = hips;
    part(hips, Geo.ico(0.12, 1), skin, 0, 0, 0).scale.set(1.05, 0.85, 0.9);
    // 破布裙 + 红腰带 + 绳结
    part(hips, Geo.cyl(0.13, 0.17, 0.2, 7, 'top'), cloth, 0, 0.05, 0);
    part(hips, Geo.cyl(0.135, 0.135, 0.05, 7), sash, 0, 0.06, 0);
    part(hips, Geo.ico(0.03, 0), rope, 0.08, 0.05, 0.11);

    const torso = joint(hips, 0, 0.08, 0);
    this.torso = torso;
    part(torso, Geo.ico(0.13, 1), skin, 0, 0.14, -0.01).scale.set(1.05, 1.15, 0.85);
    part(torso, Geo.ico(0.1, 1), belly, 0, 0.12, 0.04).scale.set(1, 1.2, 0.6);
    // 背鳍
    for (let i = 0; i < 3; i++) part(torso, Geo.cone(0.03, 0.14 - i * 0.02, 4), fin, 0, 0.24 - i * 0.07, -0.1, -0.9, 0, 0);
    // 破背心
    part(torso, Geo.box(0.27, 0.12, 0.2), cloth, 0, 0.24, -0.01);

    // 大鱼头：圆鼓鼓，凸眼、阔嘴、头冠鳍和两侧鳃鳍，额头鲛珠
    const head = joint(torso, 0, 0.3, 0.01);
    this.head = head;
    part(head, Geo.ico(0.2, 2), skin, 0, 0.17, 0.0).scale.set(0.95, 1.05, 1.05);
    part(head, Geo.ico(0.15, 1), belly, 0, 0.08, 0.08).scale.set(1, 0.7, 0.9);
    part(head, Geo.box(0.17, 0.025, 0.04), flat(0x2a3a4a), 0, 0.06, 0.2);
    for (const s of [1, -1]) {
      part(head, Geo.ico(0.065, 1), flat(C.eyeWhite, { rough: 0.2 }), s * 0.11, 0.2, 0.14);
      part(head, Geo.ico(0.04, 1), flat(C.eye, { rough: 0.2 }), s * 0.125, 0.2, 0.185);
      part(head, Geo.cone(0.05, 0.16, 4), fin, s * 0.2, 0.12, -0.02, 0, 0, -s * 1.3);
      part(head, Geo.cone(0.025, 0.09, 4), tip, s * 0.24, 0.07, 0.0, 0, 0, -s * 1.6);
    }
    part(head, Geo.cone(0.04, 0.28, 4), fin, 0, 0.4, -0.02, -0.15, 0, 0);
    for (let i = 0; i < 4; i++) part(head, Geo.cone(0.035, 0.18 - i * 0.02, 4), fin, 0, 0.33 - i * 0.07, -0.12 - i * 0.03, -0.9 - i * 0.15, 0, 0);
    this.pearlGlow = this.glowPart(head, Geo.ico(0.04, 1), C.pearl, C.pearlHot, 0, 0.27, 0.19, 0);
    this.setHeadAnchor(head, 0, 0.17, 0.08);

    // 手臂：细，前臂外侧一片鳍，蹼爪
    for (const s of [1, -1]) {
      const shoulder = joint(torso, s * 0.14, 0.22, 0);
      shoulder.rotation.z = s * 0.35;
      part(shoulder, Geo.cyl(0.035, 0.03, 0.15, 6, 'top'), skin, 0, 0, 0);
      const elbow = joint(shoulder, 0, -0.15, 0);
      part(elbow, Geo.cyl(0.03, 0.028, 0.13, 6, 'top'), skin, 0, 0, 0);
      part(elbow, Geo.cone(0.04, 0.12, 4), fin, s * 0.03, -0.05, -0.02, 0, 0, -s * 1.2);
      const hand = joint(elbow, 0, -0.14, 0);
      part(hand, Geo.ico(0.035, 1), skin, 0, -0.01, 0.01).scale.set(0.9, 1, 1.1);
      for (let k = 0; k < 4; k++) part(hand, Geo.cone(0.008, 0.05, 4), claw, (k - 1.5) * 0.014, -0.05, 0.03, 0.5, 0, 0);
      this.arms.push({ shoulder, elbow, hand });
    }
    // 骨矛握在右手（arms[1]）：矛尖朝前略向上
    const handR = this.arms[1].hand;
    this.spear = assembleSpear(handR, flat(FROST.bone, { rough: 0.6 }), flat(FROST.ice, { emissive: 0x2a6a88, rough: 0.25 }),
      (p, g) => this.glowPart(p, g, C.bladeGlow, C.bladeHot, 0, 0, 0, 1, true));
    this.spear.position.set(0, -0.03, 0.02);
    this.spear.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), HOLD_DIR);
    this.spearHoldQ.copy(this.spear.quaternion);

    // 短腿 + 蹼足（四趾带爪）
    for (const s of [1, -1]) {
      const hip = joint(hips, s * 0.09, -0.04, 0);
      part(hip, Geo.cyl(0.05, 0.04, 0.17, 6, 'top'), skin, 0, 0, 0);
      const knee = joint(hip, 0, -0.17, 0.02);
      part(knee, Geo.cyl(0.038, 0.035, 0.15, 6, 'top'), skin, 0, 0, 0);
      part(knee, Geo.box(0.11, 0.035, 0.18), skin, 0, -0.16, 0.06);
      for (let k = 0; k < 4; k++) part(knee, Geo.cone(0.012, 0.04, 4), claw, (k - 1.5) * 0.026, -0.165, 0.16, Math.PI / 2, 0, 0);
      this.legs.push({ hip, knee });
    }
    // 短鱼尾：三节下垂，末端一把尾鳍
    let parent: THREE.Object3D = hips;
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, i === 0 ? -0.02 : -0.12, i === 0 ? -0.1 : -0.04);
      seg.rotation.x = 0.4;
      part(seg, Geo.cyl(0.035 - i * 0.008, 0.04 - i * 0.008, 0.13, 6, 'top'), skin, 0, 0, 0);
      this.tail.push(seg);
      parent = seg;
    }
    part(parent, Geo.cone(0.09, 0.16, 4), fin, 0, -0.18, 0, Math.PI, 0, 0).scale.set(1, 1, 0.25);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    const P = n.pose;
    P.reset();
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    // 弱点判定：罩住鱼脸的球，挂在 head 骨上（模型空间里头心离地 1.02、略靠前）
    const headBone = P.bone('head');
    if (headBone) {
      const anchor = new THREE.Object3D();
      headBone.add(anchor);
      anchor.position.copy(headBone.worldToLocal(host.localToWorld(new THREE.Vector3(0, 1.02, 0.1))));
      this.setHeadAnchor(anchor, 0, 0, 0);
    }
    // 美术鲛珠自带发光壳：白模发光球收起
    if (n.glowShell) this.pearlGlow.visible = false;
    // 骨矛挂到美术右手骨：握在掌心，矛尖朝前略向上（在模型空间摆好再换算到手骨局部）
    const bone = P.bone('hand_R');
    const wrist = P.restPosition('hand_R');
    if (bone && wrist) {
      const tipBone = P.bone('fingers_R');
      const dir = new THREE.Vector3(0, -1, 0);
      if (tipBone) dir.copy(host.worldToLocal(tipBone.getWorldPosition(new THREE.Vector3()))).sub(wrist).normalize();
      const palm = wrist.clone().addScaledVector(dir, GRIP_OFFSET);
      _q.setFromUnitVectors(AZ, HOLD_DIR);
      _m.compose(palm, _q, _s.setScalar(1));
      _m.premultiply(host.matrixWorld);
      _m2.copy(bone.matrixWorld).invert().multiply(_m);
      bone.add(this.spear);
      _m2.decompose(this.spear.position, this.spear.quaternion, this.spear.scale);
      this.spearHoldQ.copy(this.spear.quaternion);
      this.spearBaseScale = this.spear.scale.x;
      this.spear.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = true;
      });
    }
    // 鱼尾弹簧骨骼
    const tails = [1, 2, 3].map((i) => P.bone(`tail_${i}`));
    if (tails.every((b): b is THREE.Bone => !!b)) {
      this.tailSpring = new SpringTail(tails, { stiffness: [4.5, 2.8, 1.8], drag: 0.32, gravity: 0.3, maxBend: 0.5, clearance: 0.04 });
    }
  }

  // ───────────── AI ─────────────

  /** 能参加群刺：活着、在追击状态、个人冷却好了、够得着 */
  get packReady(): boolean {
    return this.alive && this.state === 'advance' && this.lungeCooldown <= 0 && this.age >= this.spawnDuration && this.stunTime <= 0;
  }

  protected override ai(dt: number): void {
    const ctx = this.ctx;
    const d = this.distToPlayerXZ();
    if (this.lungeCooldown > 0) this.lungeCooldown -= dt * this.attackRate;
    // 手心里重新冻出骨矛
    if (!this.hasSpear) {
      this.regrow += dt;
      if (this.regrow >= SPEAR_REGROW) {
        this.hasSpear = true;
        this.regrow = 0;
        this.spear.getWorldPosition(_v);
        ctx.fx.burst(_v, FROST.mist, 6, 1.0, 0.4, 0.08 * this.sizeScale, -1);
      }
    }
    if (d < ENGAGE_NEAR) this.engaged = true;
    else if (d > ENGAGE_DROP) this.engaged = false;

    switch (this.state) {
      case 'advance':
        this.advance(dt, d);
        break;
      case 'aim': {
        // 举矛过肩：站定、正对玩家，鲛珠和矛头越来越亮
        this.stopMoving();
        this.facePlayer(9, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        this.glowTarget[1] = t;
        if (this.stateTime >= this.windTime) {
          this.throwSpear();
          this.setState('throw');
        }
        break;
      }
      case 'throw':
        this.stopMoving();
        this.glowTarget[1] = 0;
        if (this.stateTime >= THROW_FOLLOW) {
          this.recoverTime = 0.35;
          this.setState('recover');
        }
        break;
      case 'lungeWindup': {
        // 压低身子，矛尖对准玩家（错开的成员先等一会儿再蓄力）
        this.stopMoving();
        this.facePlayer(10, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.glowTarget[1] = t;
        if (this.stateTime >= this.windTime) this.launchLunge();
        break;
      }
      case 'lunge': {
        this.glowTarget[1] = 1;
        this.setMove(this.lungeDir.x, this.lungeDir.z, LUNGE_SPEED);
        if (!this.lungeHit && d <= LUNGE_HIT + 0.3 && this.verticalReach(1.4)) {
          this.lungeHit = this.melee(LUNGE_HIT, this.def.damage * LUNGE_DAMAGE_MULT, 0.3);
          if (this.lungeHit) {
            this.playerChest(_v);
            ctx.fx.burst(_v, FROST.ice, 8, 3, 0.3, 0.06, 4);
          }
        }
        if (this.stateTime >= LUNGE_TIME || this.lungeHit || (this.moveResult.hitWall && this.stateTime > 0.1)) {
          this.stopMoving();
          this.velocity.x *= 0.3;
          this.velocity.z *= 0.3;
          this.recoverTime = LUNGE_RECOVER;
          this.setState('recover');
        }
        break;
      }
      case 'jabWindup': {
        this.facePlayer(10, dt);
        this.glowTarget[1] = clamp01(this.stateTime / this.windTime);
        if (d > 1.0) this.setMove(ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z, this.speed * 0.4);
        else this.stopMoving();
        if (this.stateTime >= this.windTime) {
          this.melee(JAB_RANGE, this.def.damage * JAB_DAMAGE_MULT, 0.25);
          this.setState('jab');
        }
        break;
      }
      case 'jab':
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 1.2);
        this.glowTarget[1] = 0.4;
        if (this.stateTime >= 0.16) {
          this.recoverTime = 0.45;
          this.setState('recover');
        }
        break;
      case 'recover':
        this.stopMoving();
        this.glowTarget[0] = 0.15;
        this.glowTarget[1] = 0;
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('advance');
        }
        break;
      default:
        this.setState('advance');
    }
  }

  /** 追击：选出手（投矛 / 群刺 / 戳刺），否则按是否接战决定守投矛带还是近身合围 */
  private advance(dt: number, d: number): void {
    const ctx = this.ctx;
    this.glowTarget[0] = 0.15 + 0.08 * Math.sin(this.age * 2.7);
    this.glowTarget[1] = 0;
    const reach = this.verticalReach(1.4);
    // 群刺：6.5 米内凑够 3 只可以出手的鲛人
    if (this.sees && reach && d <= PACK_RANGE && this.lungeCooldown <= 0) {
      const now = ctx.time.now;
      if (Jiaoren.packGate > now + PACK_GAP) Jiaoren.packGate = -Infinity; // 时钟回退（新开一局）
      if (now - Jiaoren.packGate >= PACK_GAP) {
        const pack = this.gatherPack();
        const need = this.isElite ? PACK_MIN - 1 : PACK_MIN;
        if (pack.length >= need) {
          Jiaoren.packGate = now;
          pack.sort((a, b) => a.distToPlayerXZ() - b.distToPlayerXZ());
          pack.forEach((m, i) => m.beginLunge(i * LUNGE_STAGGER));
          return;
        }
      }
    }
    // 落单贴身：快戳
    if (this.cooldown <= 0 && reach && d <= JAB_RANGE + 0.35 && this.requestAttack('melee', 1.0)) {
      this.windTime = this.windup(JAB_WINDUP, 0.24);
      this.setState('jabWindup');
      ctx.audio.play('enemy_alert', { position: this.position, volume: 0.35, pitch: 1.4 });
      return;
    }
    // 投矛
    if (this.hasSpear && this.cooldown <= 0 && this.sees && d >= THROW_RANGE[0] - 1 && d <= THROW_RANGE[1] + 1
      && this.requestAttack('ranged', THROW_WINDUP + THROW_FOLLOW + 0.6)) {
      this.windTime = this.windup(THROW_WINDUP, 0.35);
      this.setState('aim');
      ctx.audio.play('enemy_charge', { position: this.position, volume: 0.5, pitch: 1.5 });
      return;
    }
    if (!this.sees && this.blindTime > 0.5) {
      this.approachPlayer(this.speed, 2);
      this.faceMovement(8, dt);
      return;
    }
    if (this.hasSpear && !this.engaged) {
      // 守投矛距离带
      if (d > THROW_RANGE[1]) this.approachPlayer(this.speed, THROW_RANGE[1] - 1);
      else this.keepRange(THROW_RANGE[0], THROW_RANGE[1], this.speed * 0.8, 0.6);
    } else if (d > CLOSE_BAND[1] + 1 || !reach) {
      this.approachPlayer(this.speed, CLOSE_BAND[1]);
    } else {
      // 近身合围：在近身带上打转
      this.keepRange(CLOSE_BAND[0], CLOSE_BAND[1], this.speed * 0.75, 0.9);
    }
    if (d < 9) this.facePlayer(7, dt);
    else this.faceMovement(8, dt);
  }

  /** 玩家 6.5 米内、可以出手的鲛人（含自己） */
  private gatherPack(): Jiaoren[] {
    const out: Jiaoren[] = [];
    for (const e of this.ctx.enemies.list) {
      if (!(e instanceof Jiaoren) || !e.packReady) continue;
      if (e.distToPlayerXZ() > PACK_RANGE || !e.verticalReach(1.4)) continue;
      out.push(e);
    }
    return out;
  }

  /** 加入群刺：delay 秒后开始蓄力（按离玩家由近到远依次错开） */
  beginLunge(delay: number): void {
    if (!this.alive) return;
    this.windTime = this.windup(LUNGE_WINDUP, 0.32) + delay;
    this.lungeCooldown = this.ctx.rng.range(5, 7);
    this.setState('lungeWindup');
    this.ctx.tasks.delay(delay, () => {
      if (this.alive && this.state === 'lungeWindup') this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.45, pitch: 1.7 + Math.random() * 0.2 });
    });
  }

  /** 突刺：朝玩家此刻的位置（轻微预判）直线冲出 */
  private launchLunge(): void {
    const pl = this.ctx.player;
    let dx = pl.position.x + pl.velocity.x * 0.15 - this.position.x;
    let dz = pl.position.z + pl.velocity.z * 0.15 - this.position.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    dx /= len;
    dz /= len;
    this.lungeDir.set(dx, 0, dz);
    this.facing = Math.atan2(dx, dz);
    this.lungeHit = false;
    this.accel = 70;
    this.velocity.x = dx * LUNGE_SPEED * 0.6;
    this.velocity.z = dz * LUNGE_SPEED * 0.6;
    this.setState('lunge');
    this.ctx.audio.play('dash', { position: this.position, volume: 0.4, pitch: 1.3 });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.burst(_v, FROST.snow, 5, 1.4, 0.4, 0.16, 1);
  }

  /** 投矛：真实投射物（伤害、挡弹）+ 跟着同一弹道飞的骨矛模型 */
  private throwSpear(): void {
    const ctx = this.ctx;
    const k = this.sizeScale;
    // 出手点：矛尖（姿势已在前摇里摆好）
    this.spear.updateWorldMatrix(true, false);
    const from = this.spear.localToWorld(_v.set(0, 0, SPEAR_TIP)).clone();
    const target = this.playerChest(_w);
    const dist = from.distanceTo(target);
    const t = dist / SPEAR_SPEED;
    target.addScaledVector(ctx.player.velocity, t * SPEAR_LEAD);
    const vel = new THREE.Vector3().subVectors(target, from).normalize().multiplyScalar(SPEAR_SPEED);
    vel.y += 0.5 * SPEAR_GRAVITY * t;
    const life = t * 1.6 + 0.6;
    const visual = launchSpearVisual(ctx, from, vel, SPEAR_GRAVITY, life, k);
    this.lastSpear = visual;
    // 被碎刃屏障挡下：伤害由投射物系统取消，飞矛外观也当场碎在盾面上（onBlocked 是投射物系统的可选扩展）
    const spec: ProjectileSpec & BlockableProjectileSpec = {
      owner: 'enemy', position: from.clone(), velocity: vel.clone(), gravity: SPEAR_GRAVITY, radius: 0.14,
      lifetime: life, enemyDamage: this.def.damage * this.damageMult, element: 'none', color: FROST.ice,
      visual: 'shard', scale: 0.7, sourceEnemy: this,
      onImpact: (point) => visual.impact(point),
      onBlocked: (point) => visual.block(point),
    };
    ctx.projectiles.spawn(spec);
    ctx.audio.play('skill_throw', { position: from, volume: 0.6, pitch: 1.3 });
    this.hasSpear = false;
    this.regrow = 0;
    this.engaged = true;
    this.releaseAttack();
    this.rollCooldown(1.6, 2.8);
  }

  protected override cancelAttack(): void {
    this.accel = 30;
    this.glowTarget[1] = 0;
    if (this.state !== 'advance' && this.state !== 'idle') {
      this.setState('advance');
      this.rollCooldown(0.6, 1.2);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.spear.visible = false;
    if (attackDirector.purging) return;
    // 鲛珠滚落：变成一个小回复
    const ctx = this.ctx;
    const from = this.getHeadCenter(new THREE.Vector3());
    from.x += Math.sin(this.facing) * 0.15 * this.sizeScale;
    from.z += Math.cos(this.facing) * 0.15 * this.sizeScale;
    const a = this.facing + ctx.rng.range(-0.8, 0.8);
    const heal = Math.max(4, Math.round(ctx.player.maxHp() * PEARL_HEAL * (this.isElite ? 2 : 1)));
    dropPearl(ctx, from, _w.set(Math.sin(a), 0, Math.cos(a)), heal);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const aimT = st === 'aim' ? clamp01(this.stateTime / this.windTime) : 0;
    const k = 1 - Math.exp(-16 * dt);
    this.pAim = mix(this.pAim, st === 'aim' ? smooth(aimT * 1.6) : 0, st === 'throw' ? 1 - Math.exp(-30 * dt) : k);
    this.pCrouch = mix(this.pCrouch, st === 'lungeWindup' ? 1 : st === 'jabWindup' ? 0.4 : st === 'recover' ? 0.25 : 0, k);
    this.pThrust = mix(this.pThrust, st === 'lunge' || st === 'jab' || st === 'throw' ? 1 : 0, 1 - Math.exp(-28 * dt));
    this.pLean = mix(this.pLean, st === 'lunge' ? 0.55 : st === 'lungeWindup' ? 0.4 : 0.15, k);
    // 骨矛：手里没矛时缩没，重新冻出时从掌心长出来
    const grow = this.hasSpear ? 1 : smooth((this.regrow - (SPEAR_REGROW - 0.6)) / 0.6);
    this.spear.scale.setScalar(Math.max(0.01, grow) * this.spearBaseScale);
    this.spear.visible = grow > 0.02;

    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, sp);
    else this.poseProcedural(sp);
    this.orientSpear();
  }

  /** 瞄准 / 突刺时把矛尖对准玩家（其余时候按握矛朝向） */
  private orientSpear(): void {
    const parent = this.spear.parent;
    if (!parent) return;
    const w = Math.max(this.pAim, this.pCrouch * 0.8, this.pThrust * (this.state === 'throw' ? 0 : 1));
    if (w < 0.01) {
      this.spear.quaternion.copy(this.spearHoldQ);
      return;
    }
    // 目标朝向（世界）：指向玩家胸口
    this.spear.updateWorldMatrix(true, false);
    this.spear.getWorldPosition(_v);
    this.playerChest(_w).sub(_v).normalize();
    _q.setFromUnitVectors(AZ, _w);
    parent.getWorldQuaternion(_q2).invert();
    _q2.multiply(_q);
    this.spear.quaternion.copy(this.spearHoldQ).slerp(_q2, clamp01(w));
  }

  /**
   * 美术骨骼动画（自定义人形 + 鱼尾）。模型空间：X = 鲛人左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾 / 肢体向后摆。
   * 走路是佝偻的鸭步：身体前倾、左右摇摆，脚用两骨 IK 钉在地上（触地段脚往后扫、腾空段抬脚前摆）；
   * 投矛：右臂举过肩、肘部后收、上身右转蓄力，出手时整条手臂甩向前方；群刺：压低身子、矛平端，突刺时整个人前扑。
   */
  private poseNative(n: NativeBody, dt: number, sp: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const st = this.state;
    const walking = (st === 'advance' || st === 'lunge' || st === 'jabWindup') && sp > 0.3;
    const move = clamp01(sp / 1.2);
    const sn = clamp01(sp / Math.max(1, this.speed));
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    if (walking) this.gait = (this.gait + freq * dt * 0.5) % 1;
    const ph = this.gait * Math.PI * 2;
    const stride = Math.min(GAIT_STRIDE, (sp * GAIT_DUTY) / (freq * this.sizeScale * 0.5)) * move;
    const lift = GAIT_LIFT * move;
    const breathe = Math.sin(t * 2.6);
    const crouch = this.pCrouch;
    const aim = this.pAim;
    const thrust = this.pThrust;

    // 身体：佝偻前倾、左右摇摆、随步子起伏；受击后仰；眩晕摇晃
    const bob = Math.abs(Math.sin(ph)) * 0.018 * move;
    P.translate('hips', 0, -0.03 * crouch - 0.02 * move + bob + breathe * 0.004, 0.02 * crouch);
    P.rotate('hips', AZ, Math.sin(ph) * 0.09 * move);
    P.rotate('hips', AX, this.pLean * 0.5 + crouch * 0.25 - this.hurtKick * 0.35 - aim * 0.12);
    P.rotate('spine', AX, 0.06 + breathe * 0.015 - aim * 0.1);
    P.rotate('chest', AY, -aim * 0.45 + thrust * (st === 'throw' ? 0.35 : 0));
    P.rotate('chest', AX, 0.05 - this.hurtKick * 0.2 + crouch * 0.1);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(t * 8) * 0.2);
    // 头：抵消前倾保持视线，鸭步时轻轻点头，偶尔歪头鼓腮
    P.rotate('neck', AX, -this.pLean * 0.4 - crouch * 0.15);
    P.rotate('head', AX, -this.pLean * 0.3 + Math.sin(ph * 2) * 0.03 * move - this.hurtKick * 0.3);
    P.rotate('head', AZ, Math.sin(t * 1.3) * 0.06 * (1 - move) - Math.sin(ph) * 0.05 * move);
    P.rotate('head', AY, aim * 0.35);
    P.rotate('pearl', AX, Math.sin(t * 5.3) * 0.02);

    // 手臂：左臂随步子前后摆；右臂握矛（平时端在身侧，矛尖朝前）
    const swing = Math.sin(ph) * 0.35 * move;
    P.rotate('arm_L', AX, swing - 0.1 - aim * 0.6 - crouch * 0.5);
    P.rotate('arm_L', AZ, 0.1 + aim * 0.4);
    P.rotate('forearm_L', AX, -0.35 - crouch * 0.4);
    const holdR = -0.55 - swing * 0.4;
    // 投矛：举过肩、屈肘后收；出手时甩向前下方
    const throwArm = st === 'throw' ? -1.0 : -2.5;
    P.rotate('arm_R', AX, mix(holdR, throwArm, Math.max(aim, st === 'throw' ? thrust : 0)) + crouch * 0.55 - thrust * (st === 'lunge' || st === 'jab' ? 0.9 : 0));
    P.rotate('arm_R', AZ, -0.12 - aim * 0.35);
    P.rotate('forearm_R', AX, -0.7 - aim * 0.8 + thrust * 0.5);
    P.rotate('fingers_R', AX, -0.9);
    P.rotate('fingers_L', AX, -0.3 - crouch * 0.4);

    // 腿：IK（触地段脚往后扫、腾空段抬脚前摆），蹲伏时膝盖前屈
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      const rest = P.restPosition(`foot_${side}`);
      if (!rest) continue;
      const u = (this.gait + i * 0.5) % 1;
      let dz = 0, dy = 0;
      if (walking) {
        if (u < GAIT_DUTY) dz = stride * (0.5 - u / GAIT_DUTY);
        else {
          const s = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
          dz = stride * (-0.5 + smooth(s));
          dy = Math.sin(s * Math.PI) * lift;
        }
      }
      P.rotate(`thigh_${side}`, AX, -0.1);
      P.rotate(`shin_${side}`, AX, 0.2);
      _t.set(rest.x, rest.y + dy, rest.z + dz + 0.02 * crouch);
      P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _t, 1);
    }
    // 鱼尾：根部随身体前倾抬起、走路左右甩；其余交给弹簧骨骼
    P.rotate('tail_1', AX, 0.25 + this.pLean * 0.5 + 0.08 * Math.sin(ph));
    P.rotate('tail_1', AY, Math.sin(ph) * 0.18 * move + Math.sin(t * 1.7) * 0.06);
    P.rotate('tail_2', AX, 0.1);
    if (this.tailSpring) {
      if (this.age < this.spawnDuration) this.tailSpring.reset();
      else this.tailSpring.step(dt, this.position, this.onGround ? this.position.y : -Infinity, this.sizeScale);
    }

    // 鲛珠发光壳：平时微光，蓄力 / 出手时亮
    if (n.glowShell) {
      const gl = this.glowLevel[0];
      n.glowShell.opacity = clamp01(0.22 + 0.08 * Math.sin(t * 3) + gl * gl * 0.75);
      n.glowShell.color.setHex(0x7ff0ff);
    }
  }

  /** 白模动画：鸭步、摆臂；投矛举臂、群刺压低前扑 */
  private poseProcedural(sp: number): void {
    const amp = clamp(sp / Math.max(1, this.speed), 0, 1.2);
    const ph = this.walkPhase * 1.6;
    const crouch = this.pCrouch;
    const aim = this.pAim;
    const thrust = this.pThrust;
    this.hips.position.y = 0.44 - crouch * 0.07 + Math.abs(Math.sin(ph)) * 0.02 * amp;
    this.hips.rotation.set(this.pLean * 0.5 - this.hurtKick * 0.3, 0, Math.sin(ph) * 0.1 * amp + (this.stunTime > 0 ? Math.sin(this.age * 8) * 0.2 : 0));
    this.torso.rotation.set(0.1 - aim * 0.15, -aim * 0.4, 0);
    this.head.rotation.set(-this.pLean * 0.6 - this.hurtKick * 0.3, aim * 0.3, Math.sin(this.age * 1.3) * 0.06);
    const [armL, armR] = this.arms;
    armL.shoulder.rotation.x = Math.sin(ph) * 0.4 * amp - aim * 0.5 - crouch * 0.4;
    armL.elbow.rotation.x = -0.4;
    armR.shoulder.rotation.x = mix(-0.6, -2.6, aim) + crouch * 0.5 - thrust * 1.0;
    armR.elbow.rotation.x = -0.6 - aim * 0.7 + thrust * 0.5;
    for (const [i, l] of this.legs.entries()) {
      const s = Math.sin(ph + i * Math.PI);
      l.hip.rotation.x = s * 0.5 * amp - crouch * 0.6;
      l.knee.rotation.x = Math.max(0, -s) * 0.6 * amp + crouch * 0.9;
    }
    for (const [i, seg] of this.tail.entries()) {
      seg.rotation.x = 0.4 + this.pLean * 0.3;
      seg.rotation.y = Math.sin(ph - i * 0.7) * 0.2 * amp + Math.sin(this.age * 1.7 - i) * 0.08;
    }
  }
}
