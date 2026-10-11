/**
 * 雪狌狌（xingxing，第二章 · 昆仑雪墟的群怪，昆仑一侧）：《山海经》「其状如禺而白耳，伏行人走」的狌狌，
 * 以雪山里的川金丝猴为原型：天蓝色的裸脸、朝天小鼻、白耳簇，肩背披一大片金白长毛、毛梢结冰，肩上和脊背长着成簇的冰晶，
 * 一手腕上缠着朝圣者的红绳铜铃。额头嵌一颗发光的青色冰晶（弱点，头部判定罩住整张脸）。
 * 和冻鲛人同为群怪：鲛人远投骨矛、成群突刺；狌狌贴身缠人，而且能追到高处——高台不是绝对安全区。
 *
 * - 指节奔跑：远处四肢着地狂奔（川金丝猴的步态：后肢交替、前肢指节撑地，前肢承重），冰晶脊背一起一伏；
 *   近处站起来，左右折线包抄。
 * - 攀爬：玩家站在 3.5 米以内的高台或矮墙上时，跑到边缘下，蹲身 0.3 秒、扒着边缘一把一把翻上去（约 1 秒）。
 * - 抛冰块：够不着玩家（高台太高、没处可爬）时，从地上掰一块冰（0.5 秒前摇：先蹲下掰冰，再举过头顶），
 *   抛物线砸过去，落点有小预警圈。
 * - 跳砸：2.5–6.5 米内蹲身、双拳举过头顶 0.45 秒（脊背冰晶亮起），真跳跃扑向玩家的预判落点（落点亮预警圈），
 *   落地砸出一圈 2.5 米的冰环：伤害 + 短暂冻缓（移速 −35%，1.5 秒）。砸完蹲着喘 0.6 秒（输出窗口）。
 * - 抓挠：贴身时一爪横扫（0.3 秒前摇）。
 * - 起哄：一只被打死时，12 米内的同伴捶胸嚎叫 1 秒（群体硬直窗口）。
 *
 * 状态机：chase → slamWindup → slamAir → recover → chase
 *         chase → swipeWindup → swipe → recover → chase
 *         chase → throwWindup → throwRelease → recover → chase
 *         chase → climbPrep → climb → chase
 *         (任意地面状态) → rally → chase
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { zonePlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { spawnSlashArc } from '../fx/SlashArc';
import { FROST, chillPlayer, createIceChunk, launchIceChunk, spawnIceRing } from '../fx/FrostPackFx';
import { SpringTail, mix, smooth } from '../frost/PackMotion';

export const XINGXING_DEF: ScaledEnemyDef = {
  id: 'xingxing',
  name: '雪狌狌',
  // 美术按 1.3 米（含冰晶冠）制作，游戏里放大 1.3 倍（约 1.7 米）
  scale: 1.3,
  hp: 55,
  speed: 6.5,
  radius: 0.36,
  height: 1.1,
  damage: 14,
  coins: [1, 2],
  essence: 1,
  // 弱点 = 额头冰晶：判定球罩住整张脸（球心离地约 1.03、略靠前），跟着头骨走
  headY: 1.03,
  headRadius: 0.2,
  knockbackResist: 0,
  color: 0xbfe6ff,
};

const GRAVITY = 26;
/** 跳砸：触发距离、前摇、冰环半径、伤害倍率、预判比例、落点停在玩家身前的距离、冻缓 */
const SLAM_RANGE = [2.5, 6.5] as const;
const SLAM_WINDUP = 0.45;
const SLAM_RADIUS = 2.5;
const SLAM_DAMAGE_MULT = 1.0;
const SLAM_LEAD = 0.3;
const SLAM_SHORT = 0.5;
const SLAM_RECOVER = 0.6;
const CHILL_TIME = 1.5;
const CHILL_SLOW = 0.35;
/** 抓挠 */
const SWIPE_RANGE = 1.7;
const SWIPE_WINDUP = 0.3;
const SWIPE_DAMAGE_MULT = 0.6;
/** 抛冰块：前摇（前 RIP_FRAC 蹲下掰冰）、最远距离、冰块大小 / 碎裂半径 / 伤害倍率 */
const THROW_WINDUP = 0.5;
const RIP_FRAC = 0.4;
const THROW_MAX = 18;
const CHUNK_SIZE = 0.2;
const CHUNK_RADIUS = 1.4;
const CHUNK_DAMAGE_MULT = 0.75;
/** 攀爬：最大高差（米）、向玩家方向找边缘的最远距离、蹲身准备、爬升时的等效重力 */
const CLIMB_MIN = 0.7;
const CLIMB_MAX = 3.5;
const CLIMB_SEARCH = 4.5;
const CLIMB_PREP = 0.3;
const CLIMB_GRAVITY = 10;
const CLIMB_TIMEOUT = 1.8;
/** 起哄 */
const RALLY_RADIUS = 12;
const RALLY_TIME = 1.0;
/** 四足奔跑：超过这个速度（米/秒）趴下跑；步频（每秒步）、触地占比、最大步幅（模型单位）、抬肢高度 */
const QUAD_SPEED = 3.2;
const GAIT_FREQ = [1.6, 2.6] as const;
const GAIT_DUTY = [0.6, 0.42] as const;
const GAIT_SWEEP = 0.34;
const GAIT_LIFT = [0.05, 0.09] as const;
/** 四肢（绕跑：两后肢交替、两前肢交替，前后差半个周期） */
const LIMBS = [
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, ph: 0 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, ph: 0.14 },
  { u: 'arm_L', l: 'forearm_L', e: 'hand_L', front: true, ph: 0.5 },
  { u: 'arm_R', l: 'forearm_R', e: 'hand_R', front: true, ph: 0.64 },
] as const;
/** 脊背冰晶发光件的位置（模型空间，挂 chest 骨） */
const BACK_SHARDS = [
  { at: [0, 0.86, -0.17], s: 1.2 },
  { at: [0.07, 0.76, -0.19], s: 0.9 },
  { at: [-0.07, 0.76, -0.19], s: 0.9 },
] as const;

const C = {
  fur: 0xf0e6d4, furTip: 0x9fd0f0, face: 0x4f9ae0, nose: 0xe07a8a, eye: 0x1a2a3a, hand: 0x5a6a8a,
  crystal: 0x7fd0ff, crystalDeep: 0x3f9ad8, cord: 0xc0302a, bell: 0xc9a04a,
  gem: 0x3fc8e8, gemHot: 0xe8ffff, shard: 0x000000, shardHot: 0x9ff0ff,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();

export class Xingxing extends StandardEnemy {
  protected hips!: THREE.Group;
  protected torso!: THREE.Group;
  protected head!: THREE.Group;
  protected readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  protected readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  protected readonly tail: THREE.Group[] = [];
  /** 手里的冰块（掰冰 → 举过头顶 → 抛出） */
  protected chunk!: THREE.Group;
  private chunkBaseScale = 1;
  private gemGlow!: THREE.Mesh;
  private readonly shardGlows: THREE.Mesh[] = [];
  private windTime = SLAM_WINDUP;
  private recoverTime = 0.5;
  private airborne = false;
  private slamTime = 0.6;
  private slamSpeed = 0;
  private readonly slamDir = new THREE.Vector3();
  private readonly slamLanding = new THREE.Vector3();
  private cancelWarning: (() => void) | null = null;
  /** 攀爬：边缘下的落脚点、台面上的目标点、台面高度；找边缘的节流计时 */
  private readonly climbBase = new THREE.Vector3();
  private readonly climbTop = new THREE.Vector3();
  private climbOk = false;
  private climbTimer = 0;
  /** 折线包抄 */
  private zigzag = 0;
  /** 四足步态相位 0..1 */
  private gait = 0;
  private tailSpring: SpringTail | null = null;
  // 平滑后的姿态参数
  private pQuad = 0;
  private pCrouch = 0;
  private pArmsUp = 0;
  private pClimb = 0;
  private pBeat = 0;
  private pSwipe = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, XINGXING_DEF, opts);
    this.walkScale = 0.9;
    this.stepRate = 2;
    this.accel = 34;
    this.cooldown = ctx.rng.range(0.5, 1.6);
  }

  // ───────────── 模型（白模兜底：?classic 或资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fur = flat(C.fur), tipMat = flat(C.furTip, { rough: 0.5 }), face = flat(C.face, { rough: 0.6 }), hand = flat(C.hand, { rough: 0.7 });
    const crystal = flat(C.crystal, { emissive: 0x1d5c7a, rough: 0.2 });

    const hips = joint(root, 0, 0.5, 0);
    this.hips = hips;
    part(hips, Geo.ico(0.16, 1), fur, 0, 0, -0.01).scale.set(1.05, 0.9, 0.95);

    const torso = joint(hips, 0, 0.08, 0);
    this.torso = torso;
    part(torso, Geo.ico(0.2, 1), fur, 0, 0.16, -0.01).scale.set(1.05, 1.0, 0.85);
    // 金白毛披肩：几大块毛簇，毛梢冰蓝
    for (const s of [1, -1]) {
      part(torso, Geo.cone(0.12, 0.3, 5), fur, s * 0.17, 0.2, -0.03, 0, 0, s * 2.7);
      part(torso, Geo.cone(0.06, 0.12, 5), tipMat, s * 0.24, 0.06, -0.03, 0, 0, s * 2.9);
      // 肩上冰晶簇
      part(torso, Geo.octa(0.07), crystal, s * 0.22, 0.34, -0.02).scale.set(0.7, 1.6, 0.7);
      part(torso, Geo.octa(0.05), crystal, s * 0.28, 0.3, -0.05).scale.set(0.7, 1.5, 0.7);
    }
    // 脊背冰晶（跳砸前亮起）
    for (const sh of BACK_SHARDS) {
      part(torso, Geo.octa(0.07 * sh.s), crystal, sh.at[0], sh.at[1] - 0.58, sh.at[2]).scale.set(0.7, 1.8, 0.7);
      const g = this.glowPart(torso, Geo.octa(0.085 * sh.s), C.shard, C.shardHot, sh.at[0], sh.at[1] - 0.58, sh.at[2], 1, true);
      g.scale.set(0.7, 1.8, 0.7);
      this.shardGlows.push(g);
    }

    // 头：毛茸茸的圆头，蓝色裸脸、朝天鼻、白耳簇、冰晶冠，额头冰晶
    const head = joint(torso, 0, 0.34, 0.02);
    this.head = head;
    part(head, Geo.ico(0.19, 2), fur, 0, 0.15, -0.01);
    part(head, Geo.ico(0.13, 1), face, 0, 0.12, 0.09).scale.set(1, 0.95, 0.7);
    part(head, Geo.ico(0.025, 1), flat(C.nose), 0, 0.12, 0.2);
    for (const s of [1, -1]) {
      part(head, Geo.ico(0.03, 1), flat(C.eye, { rough: 0.2 }), s * 0.05, 0.16, 0.17);
      part(head, Geo.ico(0.07, 1), flat(0xffffff), s * 0.19, 0.17, -0.02).scale.set(0.5, 1, 0.8);
    }
    for (let i = 0; i < 4; i++) part(head, Geo.octa(0.06), crystal, (i - 1.5) * 0.06, 0.34 + (i % 2) * 0.03, -0.04).scale.set(0.7, 1.8, 0.7);
    this.gemGlow = this.glowPart(head, Geo.octa(0.035), C.gem, C.gemHot, 0, 0.23, 0.15, 0);
    this.gemGlow.scale.set(0.8, 1.5, 0.6);
    this.setHeadAnchor(head, 0, 0.14, 0.06);

    // 长臂、大手（握拳指节着地）；右腕红绳铜铃
    for (const s of [1, -1]) {
      const shoulder = joint(torso, s * 0.2, 0.26, 0);
      shoulder.rotation.z = s * 0.4;
      part(shoulder, Geo.cyl(0.07, 0.06, 0.24, 6, 'top'), fur, 0, 0, 0);
      const elbow = joint(shoulder, 0, -0.24, 0);
      part(elbow, Geo.cyl(0.06, 0.055, 0.18, 6, 'top'), fur, 0, 0, 0);
      const h = joint(elbow, 0, -0.18, 0);
      part(h, Geo.ico(0.075, 1), hand, 0, -0.06, 0.02).scale.set(1, 1.2, 1);
      if (s < 0) {
        part(h, Geo.cyl(0.07, 0.07, 0.03, 8), flat(C.cord), 0, 0.02, 0);
        part(h, Geo.ico(0.03, 1), flat(C.bell, { metal: 0.6, rough: 0.4 }), -0.07, 0.0, 0.02);
      }
      this.arms.push({ shoulder, elbow, hand: h });
    }
    // 冰块挂在右手（平时缩没）
    this.chunk = createIceChunk(CHUNK_SIZE);
    this.arms[1].hand.add(this.chunk);
    this.chunk.position.set(0.04, -0.12, 0.06);
    this.chunk.scale.setScalar(0.01);

    // 短粗腿 + 像手一样的大脚
    for (const s of [1, -1]) {
      const hip = joint(hips, s * 0.11, -0.04, 0);
      part(hip, Geo.cyl(0.08, 0.065, 0.2, 6, 'top'), fur, 0, 0, 0);
      const knee = joint(hip, 0, -0.2, 0.03);
      part(knee, Geo.cyl(0.06, 0.05, 0.18, 6, 'top'), fur, 0, 0, 0);
      part(knee, Geo.box(0.13, 0.06, 0.24), hand, 0, -0.2, 0.06);
      this.legs.push({ hip, knee });
    }
    // 短粗尾
    let parent: THREE.Object3D = hips;
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, i === 0 ? -0.04 : -0.12, i === 0 ? -0.12 : -0.03);
      seg.rotation.x = 0.45;
      part(seg, Geo.cyl(0.045 - i * 0.008, 0.055 - i * 0.008, 0.14, 6, 'top'), i === 2 ? tipMat : fur, 0, 0, 0);
      this.tail.push(seg);
      parent = seg;
    }
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    const P = n.pose;
    P.reset();
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    // 弱点判定：罩住脸的球，挂在 head 骨上
    const headBone = P.bone('head');
    if (headBone) {
      const anchor = new THREE.Object3D();
      headBone.add(anchor);
      anchor.position.copy(headBone.worldToLocal(host.localToWorld(new THREE.Vector3(0, 1.03, 0.1))));
      this.setHeadAnchor(anchor, 0, 0, 0);
    }
    if (n.glowShell) this.gemGlow.visible = false;
    // 脊背冰晶发光件挂到 chest 骨（贴着美术冰晶的位置）
    const chest = P.bone('chest');
    if (chest) {
      for (const [i, sh] of BACK_SHARDS.entries()) {
        const g = this.shardGlows[i];
        _m.compose(new THREE.Vector3(sh.at[0], sh.at[1], sh.at[2]), _q.identity(), _s.set(0.9, 2.2, 0.9));
        _m.premultiply(host.matrixWorld);
        _m2.copy(chest.matrixWorld).invert().multiply(_m);
        chest.add(g);
        _m2.decompose(g.position, g.quaternion, g.scale);
      }
    }
    // 冰块挂到美术右手骨：掌心前方
    const bone = P.bone('hand_R');
    const wrist = P.restPosition('hand_R');
    if (bone && wrist) {
      const tip = P.bone('fingers_R');
      const dir = new THREE.Vector3(0, -1, 0);
      if (tip) dir.copy(host.worldToLocal(tip.getWorldPosition(new THREE.Vector3()))).sub(wrist).normalize();
      const palm = wrist.clone().addScaledVector(dir, 0.12).add(_v.set(0.03, 0, 0.06));
      _m.compose(palm, _q.identity(), _s.setScalar(1));
      _m.premultiply(host.matrixWorld);
      _m2.copy(bone.matrixWorld).invert().multiply(_m);
      bone.add(this.chunk);
      _m2.decompose(this.chunk.position, this.chunk.quaternion, this.chunk.scale);
      this.chunkBaseScale = this.chunk.scale.x;
      this.chunk.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = true;
      });
    }
    const tails = [1, 2, 3].map((i) => P.bone(`tail_${i}`));
    if (tails.every((b): b is THREE.Bone => !!b)) {
      this.tailSpring = new SpringTail(tails, { stiffness: [4.2, 2.6, 1.7], drag: 0.3, gravity: 0.35, maxBend: 0.5, clearance: 0.05 });
    }
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
        this.chase(dt, d);
        break;
      case 'slamWindup': {
        // 蹲身、双拳举过头顶，脊背冰晶亮起
        this.stopMoving();
        this.facePlayer(9, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.glowTarget[1] = t;
        if (this.stateTime >= this.windTime) this.launchSlam();
        break;
      }
      case 'slamAir': {
        this.glowTarget[1] = 1;
        this.desiredX = this.slamDir.x * this.slamSpeed;
        this.desiredZ = this.slamDir.z * this.slamSpeed;
        if (!this.onGround) this.airborne = true;
        const landed = this.airborne && this.onGround && this.stateTime > 0.12;
        if (landed || this.stateTime >= this.slamTime + 0.5) this.slamImpact();
        break;
      }
      case 'swipeWindup':
        this.facePlayer(10, dt);
        this.glowTarget[0] = 0.8;
        if (d > 1.1) this.setMove(pl.x - this.position.x, pl.z - this.position.z, this.speed * 0.4);
        else this.stopMoving();
        if (this.stateTime >= this.windTime) {
          this.melee(SWIPE_RANGE, this.def.damage * SWIPE_DAMAGE_MULT, 0.15);
          const k = this.sizeScale;
          _v.set(this.position.x, this.position.y + 0.75 * k, this.position.z);
          spawnSlashArc(ctx, { center: _v, yaw: this.facing, radius: 1.1 * k, arc: 1.9, dir: 1, tilt: 0.35, width: 0.32 * k, duration: 0.22, color: 0xbfeaff });
          this.setState('swipe');
        }
        break;
      case 'swipe':
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 1.5);
        if (this.stateTime >= 0.18) {
          this.recoverTime = 0.4;
          this.setState('recover');
        }
        break;
      case 'throwWindup': {
        this.stopMoving();
        this.facePlayer(8, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.3 + 0.5 * t;
        // 掰下冰块的一瞬间：脚下扬起一团雪和冰屑
        if (t >= RIP_FRAC && this.stateTime - dt < this.windTime * RIP_FRAC) {
          _v.set(this.position.x + Math.sin(this.facing) * 0.4, this.position.y + 0.1, this.position.z + Math.cos(this.facing) * 0.4);
          ctx.fx.burst(_v, FROST.snow, 8, 2, 0.5, 0.18, 2);
          ctx.fx.burst(_v, FROST.ice, 6, 2.5, 0.4, 0.05, 6);
          ctx.audio.play('land', { position: _v, volume: 0.45, pitch: 1.8 });
        }
        if (this.stateTime >= this.windTime) {
          this.throwChunk();
          this.setState('throwRelease');
        }
        break;
      }
      case 'throwRelease':
        this.stopMoving();
        if (this.stateTime >= 0.22) {
          this.recoverTime = 0.3;
          this.setState('recover');
        }
        break;
      case 'climbPrep':
        // 边缘下蹲身，抬头看着台沿
        this.stopMoving();
        this.faceTowards(this.climbTop, 10, dt);
        if (this.stateTime >= CLIMB_PREP) this.launchClimb();
        break;
      case 'climb': {
        // 低重力爬升（扒着边缘一把一把往上翻）：台沿以下贴墙，翻过台沿后走上台面
        this.velocity.y += (GRAVITY - CLIMB_GRAVITY) * dt;
        this.accel = 60;
        const above = this.position.y >= this.climbTop.y + 0.12;
        const dx = this.climbTop.x - this.position.x, dz = this.climbTop.z - this.position.z;
        this.setMove(dx, dz, above ? 3.5 : 0.8);
        this.faceTowards(this.climbTop, 10, dt);
        // 翻上台面、走到边缘内侧才算爬完；落回台下（没扒住）或超时就放弃
        const onTop = this.onGround && this.position.y > this.climbTop.y - 0.25;
        const done = onTop && this.stateTime > 0.25 && Math.hypot(dx, dz) < 0.45;
        const fell = this.onGround && this.position.y < this.climbTop.y - 0.5 && this.stateTime > 0.5;
        if (done || fell || this.stateTime > CLIMB_TIMEOUT) {
          this.accel = 34;
          this.setState('chase');
          if (done) {
            _v.set(this.position.x, this.position.y + 0.1, this.position.z);
            ctx.fx.burst(_v, FROST.snow, 6, 1.4, 0.4, 0.16, 1);
          }
        }
        break;
      }
      case 'rally':
        // 捶胸嚎叫：原地不动（群体硬直窗口）
        this.stopMoving();
        this.glowTarget[0] = 0.6;
        if (this.stateTime >= RALLY_TIME) this.setState('chase');
        break;
      case 'recover':
        this.stopMoving();
        this.glowTarget[0] = 0.15;
        this.glowTarget[1] = 0;
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('chase');
        }
        break;
      default:
        this.setState('chase');
    }
  }

  /** 追击：先看能不能出手（抓挠 / 跳砸 / 抛冰块 / 攀爬），否则四足狂奔、近处折线包抄 */
  private chase(dt: number, d: number): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    this.glowTarget[0] = 0.15 + 0.1 * Math.sin(this.age * 3.1);
    this.glowTarget[1] = 0;
    const above = pl.y - this.position.y;
    const reach = Math.abs(above) <= 1.2;
    if (this.cooldown <= 0 && this.sees && reach && this.onGround) {
      if (d <= SWIPE_RANGE + 0.3 && this.requestAttack('melee', 1.0)) {
        this.windTime = this.windup(SWIPE_WINDUP, 0.22);
        this.setState('swipeWindup');
        ctx.audio.play('enemy_alert', { position: this.position, volume: 0.4, pitch: 1.6 });
        return;
      }
      if (d >= SLAM_RANGE[0] && d <= SLAM_RANGE[1] && this.directPathClear(pl) && this.requestAttack('melee', 2.2)) {
        this.windTime = this.windup(SLAM_WINDUP, 0.3);
        this.setState('slamWindup');
        ctx.audio.play('enemy_charge', { position: this.position, volume: 0.55, pitch: 1.2 });
        return;
      }
    }
    // 玩家在高处：先找能爬的边缘；爬不上去就抛冰块
    if (above > CLIMB_MIN) {
      this.climbTimer -= dt;
      if (this.climbTimer <= 0) {
        this.climbTimer = 0.3;
        this.climbOk = above <= CLIMB_MAX && this.onGround && this.findClimb();
      }
      if (this.climbOk) {
        const toBase = Math.hypot(this.climbBase.x - this.position.x, this.climbBase.z - this.position.z);
        if (toBase <= 0.9) {
          this.setState('climbPrep');
          this.stopMoving();
          return;
        }
        // 边缘下的落脚点贴着墙，可能不在导航网格里：近了就直接走过去
        if (toBase <= 1.8) this.setMove(this.climbBase.x - this.position.x, this.climbBase.z - this.position.z, this.speed);
        else this.navigate(this.climbBase, this.speed, 0.4);
        this.faceMovement(10, dt);
        return;
      }
      if (this.cooldown <= 0 && this.sees && d <= THROW_MAX && this.onGround && this.requestAttack('ranged', THROW_WINDUP + 0.6)) {
        this.windTime = this.windup(THROW_WINDUP, 0.38);
        this.setState('throwWindup');
        return;
      }
    } else if (!reach && this.cooldown <= 0 && this.sees && d <= THROW_MAX && d > 4 && this.onGround
      && this.requestAttack('ranged', THROW_WINDUP + 0.6)) {
      // 玩家在下面够不着（比如自己在高台上）也抛冰块
      this.windTime = this.windup(THROW_WINDUP, 0.38);
      this.setState('throwWindup');
      return;
    }
    // 同在一座高台 / 矮墙上（台面不在导航网格里）、或自己在高处要下去：直接朝玩家走（走出边缘就掉下去）
    const floorY = ctx.stage.arena?.floorY ?? 0;
    if (this.position.y > floorY + 0.5 && (reach || above < -CLIMB_MIN)) {
      this.setMove(pl.x - this.position.x, pl.z - this.position.z, this.speed);
      this.faceMovement(10, dt);
      return;
    }
    if (d > 9 || !this.sees || !reach) {
      this.approachPlayer(this.speed, 1.4);
      this.faceMovement(10, dt);
      return;
    }
    // 近处：左右折线包抄（冷却中在跳砸距离带上打转）
    this.zigzag -= dt;
    if (this.zigzag <= 0) {
      this.zigzag = ctx.rng.range(0.5, 1.0);
      this.strafeSign = -this.strafeSign || 1;
    }
    if (this.cooldown > 0.3) {
      this.keepRange(SLAM_RANGE[0] + 0.5, SLAM_RANGE[1], this.speed * 0.85, 0.9);
    } else {
      const dx = pl.x - this.position.x, dz = pl.z - this.position.z;
      const side = d > 2.5 ? 0.6 : 0.2;
      this.setMove(dx / d - dz / d * this.strafeSign * side, dz / d + dx / d * this.strafeSign * side, this.speed);
    }
    if (d < 4) this.facePlayer(10, dt);
    else this.faceMovement(10, dt);
  }

  /**
   * 沿自己 → 玩家的方向找一道可以翻上去的边缘：第一处比脚下高出 0.6 米以上的地面就是边缘，
   * 要求它和玩家差不多高（就是玩家站的那层）、高差不超过 3.5 米、边缘后面有站脚的地方。
   */
  private findClimb(): boolean {
    const w = this.ctx.world;
    const pl = this.ctx.player.position;
    const x0 = this.position.x, z0 = this.position.z, y0 = this.position.y;
    const dx = pl.x - x0, dz = pl.z - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return false;
    const ux = dx / len, uz = dz / len;
    const probe = pl.y + 0.5;
    for (let s = 0.3; s <= Math.min(len + 0.3, CLIMB_SEARCH); s += 0.2) {
      const gy = w.groundHeight(x0 + ux * s, z0 + uz * s, probe);
      if (!(gy > y0 + 0.6)) continue;
      if (gy - y0 > CLIMB_MAX || Math.abs(gy - pl.y) > 0.6) return false;
      const ts = s + 0.6;
      const gy2 = w.groundHeight(x0 + ux * ts, z0 + uz * ts, probe, 0.2);
      if (!(Math.abs(gy2 - gy) < 0.3)) return false;
      this.climbBase.set(x0 + ux * Math.max(0, s - 0.5), y0, z0 + uz * Math.max(0, s - 0.5));
      this.climbTop.set(x0 + ux * ts, gy, z0 + uz * ts);
      return true;
    }
    return false;
  }

  /** 起爬：低重力下的竖直起跳（够到台面以上），水平方向先贴墙 */
  private launchClimb(): void {
    const h = Math.max(0.5, this.climbTop.y - this.position.y);
    this.velocity.y = Math.sqrt(2 * CLIMB_GRAVITY * (h + 0.35));
    this.accel = 60;
    this.setState('climb');
    this.ctx.audio.play('jump', { position: this.position, volume: 0.4, pitch: 1.3 });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.burst(_v, FROST.snow, 5, 1.2, 0.4, 0.16, 1);
  }

  /** 跳砸起跳：按落点距离定飞行时间（落点锁定、亮预警圈） */
  private launchSlam(): void {
    const pl = this.ctx.player;
    let dx = pl.position.x - this.position.x;
    let dz = pl.position.z - this.position.z;
    const est = 0.4 + Math.hypot(dx, dz) * 0.03;
    dx += pl.velocity.x * est * SLAM_LEAD;
    dz += pl.velocity.z * est * SLAM_LEAD;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    const dist = clamp(len - SLAM_SHORT, 1, SLAM_RANGE[1] + 1);
    this.slamTime = 0.4 + dist * 0.03;
    this.slamSpeed = dist / this.slamTime;
    this.slamDir.set(dx / len, 0, dz / len);
    this.facing = Math.atan2(this.slamDir.x, this.slamDir.z);
    this.velocity.set(this.slamDir.x * this.slamSpeed, GRAVITY * this.slamTime * 0.5, this.slamDir.z * this.slamSpeed);
    this.slamLanding.set(this.position.x + this.slamDir.x * dist, this.position.y + 0.02, this.position.z + this.slamDir.z * dist);
    this.cancelWarning = this.ctx.fx.groundWarning(this.slamLanding, SLAM_RADIUS * Math.min(1.25, this.sizeScale / 1.3), this.slamTime, FROST.warnSolid);
    this.airborne = false;
    this.accel = 60;
    this.setState('slamAir');
    this.ctx.audio.play('jump', { position: this.position, volume: 0.5, pitch: 1.1 });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.burst(_v, FROST.snow, 8, 1.8, 0.45, 0.2, 1);
  }

  /** 落地砸出冰环：伤害 + 冻缓 */
  private slamImpact(): void {
    const ctx = this.ctx;
    this.cancelWarning = null;
    this.accel = 34;
    this.stopMoving();
    this.velocity.x *= 0.2;
    this.velocity.z *= 0.2;
    const r = SLAM_RADIUS * Math.min(1.25, this.sizeScale / 1.3);
    _v.set(this.position.x, this.position.y, this.position.z);
    const hit = zonePlayer(ctx, _v, r, this.def.damage * SLAM_DAMAGE_MULT * this.damageMult, 'none', this, 1.6);
    if (hit) chillPlayer(ctx, CHILL_TIME, CHILL_SLOW);
    spawnIceRing(ctx, _v, r);
    ctx.fx.shake(hit ? 0.3 : 0.15, 0.2);
    ctx.audio.play('boss_slam', { position: _v, volume: 0.45, pitch: 1.6 });
    this.recoverTime = SLAM_RECOVER;
    this.setState('recover');
  }

  /** 抛冰块：从手里的冰块位置抛向玩家脚下（轻微预判），落点有预警圈 */
  private throwChunk(): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.chunk.updateWorldMatrix(true, false);
    const from = this.chunk.getWorldPosition(new THREE.Vector3());
    const d = Math.hypot(pl.position.x - from.x, pl.position.z - from.z);
    const T = 0.55 + d * 0.035;
    const target = new THREE.Vector3(pl.position.x + pl.velocity.x * T * 0.3, pl.position.y, pl.position.z + pl.velocity.z * T * 0.3);
    const gy = ctx.world.groundHeight(target.x, target.z, pl.position.y + 0.5);
    if (Number.isFinite(gy)) target.y = gy;
    launchIceChunk(ctx, {
      from, target, flightTime: T, size: CHUNK_SIZE * this.sizeScale, radius: CHUNK_RADIUS,
      damage: this.def.damage * CHUNK_DAMAGE_MULT * this.damageMult, source: this,
    });
    ctx.audio.play('skill_throw', { position: from, volume: 0.55, pitch: 0.9 });
    this.releaseAttack();
    this.rollCooldown(1.8, 2.8);
  }

  /** 同伴被打死：捶胸嚎叫 1 秒 */
  startRally(): void {
    if (!this.alive || this.stunTime > 0 || !this.onGround) return;
    if (this.state !== 'chase' && this.state !== 'recover') return;
    this.releaseAttack();
    this.setState('rally');
    this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.5, pitch: 0.8 + Math.random() * 0.2 });
  }

  protected override cancelAttack(): void {
    this.accel = 34;
    this.glowTarget[1] = 0;
    this.cancelWarning?.();
    this.cancelWarning = null;
    if (this.state !== 'chase' && this.state !== 'idle' && this.state !== 'climb') {
      this.setState('chase');
      this.rollCooldown(0.6, 1.2);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (attackDirector.purging) return;
    // 起哄：附近的同伴捶胸嚎叫
    for (const e of this.ctx.enemies.list) {
      if (e === this || !(e instanceof Xingxing) || !e.alive) continue;
      const dx = e.position.x - this.position.x, dz = e.position.z - this.position.z;
      if (dx * dx + dz * dz <= RALLY_RADIUS * RALLY_RADIUS) e.startRally();
    }
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const k = 1 - Math.exp(-14 * dt);
    const quad = st === 'chase' && sp > QUAD_SPEED && this.onGround && this.distToPlayerXZ() > 3.5;
    this.pQuad = mix(this.pQuad, quad ? 1 : 0, 1 - Math.exp(-6 * dt));
    const wind = st === 'slamWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    const thr = st === 'throwWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    let crouch = 0, armsUp = 0;
    if (st === 'slamWindup') { crouch = 0.8 * wind; armsUp = smooth(wind * 1.5); }
    else if (st === 'slamAir') { crouch = 0.2; armsUp = this.velocity.y > 0 ? 1 : 0.15; }
    else if (st === 'recover') crouch = 0.6;
    else if (st === 'throwWindup') { crouch = thr < RIP_FRAC ? 0.9 : 0.3; armsUp = thr < RIP_FRAC ? -0.3 : smooth((thr - RIP_FRAC) / (1 - RIP_FRAC)); }
    else if (st === 'throwRelease') { crouch = 0.15; armsUp = 0.35; }
    else if (st === 'climbPrep') crouch = 0.7;
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pArmsUp = mix(this.pArmsUp, armsUp, st === 'slamAir' || st === 'throwRelease' ? 1 - Math.exp(-24 * dt) : k);
    this.pClimb = mix(this.pClimb, st === 'climb' || st === 'climbPrep' ? 1 : 0, 1 - Math.exp(-12 * dt));
    this.pBeat = mix(this.pBeat, st === 'rally' ? 1 : 0, k);
    this.pSwipe = mix(this.pSwipe, st === 'swipeWindup' ? -1 : st === 'swipe' ? 1 : 0, 1 - Math.exp(-26 * dt));
    // 手里的冰块：掰下之后出现，抛出后消失
    const hold = st === 'throwWindup' && thr >= RIP_FRAC;
    this.chunk.visible = hold;
    this.chunk.scale.setScalar(this.chunkBaseScale * (hold ? Math.max(0.01, smooth((thr - RIP_FRAC) / 0.15)) : 0.01));
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, sp);
    else this.poseProcedural(sp);
  }

  /** 把一条肢体的末端（踝 / 腕）按权重 w 拉向模型空间的 target */
  private reach(P: NativePose, u: string, l: string, e: string, target: THREE.Vector3, w: number, orient: number): void {
    if (w <= 0.001) return;
    P.hostPosition(e, _cur);
    _t.lerpVectors(_cur, target, clamp01(w));
    P.twoBoneIK(u, l, e, _t, orient);
  }

  /**
   * 美术骨骼动画（自定义人形 + 尾）。模型空间：X = 狌狌左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾 / 肢体向后摆。
   * - 四足奔跑（pQuad）：髋部前倾约 60°、压低，后肢交替蹬地、前肢指节撑地（两骨 IK 钉地，触地段往后扫、腾空段前摆），
   *   头抬起看前方，脊背随步子一起一伏；
   * - 两足（站立、近身包抄、出招）：微微前倾、长臂下垂随步子摆；
   * - 跳砸：蹲身、双拳举过头，空中下落时砸下；抛冰块：先蹲下掰冰、再举过头顶甩出；攀爬：双臂交替上够、身体贴墙；
   * - 起哄：双臂交替捶胸、仰头嚎叫。
   */
  private poseNative(n: NativeBody, dt: number, sp: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const st = this.state;
    const q = this.pQuad;
    const c = this.pCrouch;
    const up = this.pArmsUp;
    const climb = this.pClimb;
    const beat = this.pBeat;
    const sn = clamp01(sp / Math.max(1, this.speed));
    const moving = this.onGround && sp > 0.3 && (st === 'chase' || st === 'swipeWindup');
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    if (moving) this.gait = (this.gait + freq * dt) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * sn * q;
    const sweep = moving ? Math.min(GAIT_SWEEP, (sp * duty) / (freq * this.sizeScale)) : 0;
    const lift = moving ? GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * sn : 0;
    const ph = this.gait * Math.PI * 2;
    const breathe = Math.sin(t * 2.4);
    const air = !this.onGround && (st === 'slamAir' || st === 'climb');

    // 身体
    const pitch = q * 1.05 + c * 0.35 + climb * 0.3 + 0.08 - this.hurtKick * 0.35 - beat * 0.15;
    P.translate('hips', 0, -0.08 * q - 0.1 * c + 0.012 * Math.sin(ph * 2) * (moving ? 1 : 0) + breathe * 0.004, 0.03 * c);
    P.rotate('hips', AX, pitch);
    P.rotate('spine', AX, 0.1 * q * Math.sin(ph) + 0.05 * c);
    P.rotate('chest', AX, -0.06 * q * Math.sin(ph + 0.6) - up * 0.15 + beat * Math.sin(t * 14) * 0.05);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(t * 8) * 0.2);
    P.rotate('chest', AY, this.pSwipe * -0.35);
    // 头：抵消前倾看向前方；站着时左右张望；起哄时仰头
    P.rotate('neck', AX, -pitch * 0.55 - beat * 0.3);
    P.rotate('head', AX, -pitch * 0.35 - beat * 0.35 - up * 0.2 - this.hurtKick * 0.3 + Math.sin(t * 6.1) * 0.02 * (1 - q));
    P.rotate('head', AY, Math.sin(t * 1.7) * 0.18 * (1 - q) * (1 - c) * (moving ? 0.3 : 1));

    // 手臂：两足时自然下垂随步子摆；举过头 / 捶胸 / 抓挠 / 攀爬叠加
    const swing = moving ? Math.sin(ph) * 0.35 * sn * (1 - q) : 0;
    const reachUp = climb > 0.01 ? Math.sin(t * 11) : 0;
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      const sgn = side === 'L' ? 1 : -1;
      let ax = swing * sgn - 0.1 - pitch * (1 - q) * 0.6;
      ax += -2.75 * up;                                           // 举过头（向前上方屈臂）
      ax += -climb * (2.5 + 0.35 * reachUp * sgn);                // 攀爬：双臂交替上够
      ax += -beat * (1.0 + 0.25 * Math.sin(t * 14 + (sgn > 0 ? 0 : Math.PI)));
      if (side === 'R') ax += this.pSwipe < 0 ? -this.pSwipe * 0.6 : -this.pSwipe * 1.5;
      P.rotate(`arm_${side}`, AX, ax);
      P.rotate(`arm_${side}`, AZ, sx * (0.05 + 0.15 * up + 0.25 * beat) + (side === 'R' ? this.pSwipe * -0.5 : 0));
      const elbow = -0.3 - 0.5 * up - beat * (1.4 + 0.4 * Math.sin(t * 14 + (sgn > 0 ? 0 : Math.PI))) - climb * 0.4 * (1 - reachUp * sgn);
      P.rotate(`forearm_${side}`, AX, elbow);
      P.rotate(`fingers_${side}`, AX, -0.6 - 0.9 * Math.max(up, q, beat));
    }
    // 腿：两足 / 四足共用触地-腾空循环；四足时后肢后蹬，前肢走 IK 撑地
    const groundW = air ? 0 : 1;
    for (const L of LIMBS) {
      const rest = P.restPosition(L.e);
      if (!rest) continue;
      const u = (this.gait + (q > 0.5 ? L.ph : L.front ? L.ph : (L.u === 'thigh_R' ? 0.5 : 0))) % 1;
      let dz = 0, dy = 0;
      if (moving) {
        if (u < duty) dz = sweep * (0.5 - u / duty);
        else {
          const s = (u - duty) / (1 - duty);
          dz = sweep * (-0.5 + smooth(s));
          dy = Math.sin(s * Math.PI) * lift;
        }
      }
      if (!L.front) {
        P.rotate(L.u, AX, -pitch * 0.9 - 0.15 - (air ? 0.6 : 0));
        P.rotate(L.l, AX, 0.3 + (air ? 0.9 : 0));
        _w.set(rest.x, rest.y + dy, rest.z + dz - 0.08 * q + 0.03 * c);
        this.reach(P, L.u, L.l, L.e, _w, groundW, 1);
      } else if (q > 0.02) {
        // 前肢：腕落在肩下略前方的地面上（指节着地）
        P.hostPosition(L.u, _v);
        _w.set(_v.x * 0.92, 0.16 + dy, _v.z + 0.06 + dz);
        this.reach(P, L.u, L.l, L.e, _w, q * groundW, 0);
      }
    }
    // 尾巴：四足时抬平、两足时下垂轻摆，惯性交给弹簧骨骼
    P.rotate('tail_1', AX, 0.2 + q * 0.6 + c * 0.3);
    P.rotate('tail_1', AY, Math.sin(ph) * 0.15 * sn + Math.sin(t * 1.5) * 0.08);
    if (this.tailSpring) {
      if (this.age < this.spawnDuration) this.tailSpring.reset();
      else this.tailSpring.step(dt, this.position, this.onGround ? this.position.y : -Infinity, this.sizeScale);
    }
    // 四足奔跑时前爪撑地扬雪
    if (moving && q > 0.6 && Math.sin(ph) * Math.sin(ph - freq * dt * Math.PI * 2) < 0 && Math.random() < 0.5) {
      _v.set(this.position.x, this.position.y + 0.05, this.position.z);
      this.ctx.fx.burst(_v, FROST.snow, 2, 0.8, 0.3, 0.1 * this.sizeScale, 1.5);
    }
    // 额头冰晶发光壳：平时微光，出招时亮
    if (n.glowShell) {
      const gl = this.glowLevel[0];
      n.glowShell.opacity = clamp01(0.25 + 0.08 * Math.sin(t * 3.3) + gl * gl * 0.75);
      n.glowShell.color.setHex(0x8ff4ff);
    }
  }

  /** 白模动画：四足 / 两足、举拳、捶胸、攀爬 */
  private poseProcedural(sp: number): void {
    const amp = clamp(sp / Math.max(1, this.speed), 0, 1.2);
    const ph = this.walkPhase * 1.4;
    const q = this.pQuad;
    const c = this.pCrouch;
    const up = this.pArmsUp;
    const beat = this.pBeat;
    const climb = this.pClimb;
    this.hips.position.y = 0.5 - c * 0.1 - q * 0.1 + Math.abs(Math.sin(ph)) * 0.02 * amp;
    this.hips.rotation.set(q * 1.0 + c * 0.3 + climb * 0.3 - this.hurtKick * 0.3, 0, this.stunTime > 0 ? Math.sin(this.age * 8) * 0.2 : 0);
    this.head.rotation.set(-q * 0.9 - beat * 0.5 - this.hurtKick * 0.3, Math.sin(this.age * 1.7) * 0.15 * (1 - q), 0);
    for (const [i, a] of this.arms.entries()) {
      const sgn = i === 0 ? 1 : -1;
      const sw = Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.5 * amp;
      a.shoulder.rotation.x = sw * (1 - q) - q * 1.0 + q * sw - 2.7 * up - climb * (2.4 + 0.4 * Math.sin(this.age * 11) * sgn)
        - beat * (1 + 0.3 * Math.sin(this.age * 14 + i * Math.PI)) + (i === 1 ? -this.pSwipe * 1.2 : 0);
      a.elbow.rotation.x = -0.3 - beat * 1.4 - up * 0.4;
    }
    for (const [i, l] of this.legs.entries()) {
      const s = Math.sin(ph + i * Math.PI);
      l.hip.rotation.x = s * 0.6 * amp - q * 0.9 - c * 0.7;
      l.knee.rotation.x = Math.max(0, -s) * 0.6 * amp + c * 1.0 + q * 0.4;
    }
    for (const [i, seg] of this.tail.entries()) {
      seg.rotation.x = 0.45 - q * 0.3 * (i === 0 ? 1 : 0);
      seg.rotation.y = Math.sin(ph - i * 0.7) * 0.2 * amp + Math.sin(this.age * 1.5 - i) * 0.08;
    }
  }
}
