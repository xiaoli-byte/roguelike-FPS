/**
 * 炭童（tantong，第三章 · 祝融火狱的群怪，炉宫一侧）：给祝融的熔炉添炭的小鬼，失火后烧成了火魅。
 * 一米来高的炭块小孩：全身是几大块哑光黑炭拼起来的，炭缝里透出熔岩橙光；大圆炭头、两只余烬眼、咧到耳根的尖牙笑，
 * 头顶一撮烛芯似的炭火苗（弱点，头部判定罩住头顶和火苗）；只穿一件破朱红肚兜，脚踝一只发黑的铜脚环。手是五指的大炭手。
 * 和祸斗同为群怪：炭童成群扑脸、抛炭，死了不补刀会复燃；祸斗会跑来吃它的余烬（炭童彻底死，但祸斗变强）。
 *
 * - 小跑包围：远处直扑（每段方向偏一点，难瞄），5 米内在 1.6–3 米的近身带上打转、合围。
 * - 扑抓：2.6 米内蹲身、双爪举过头 0.35 秒（眼睛和炭缝亮起），一跳扑上来（约 2 米），落地双手乱抓两下（各 0.55 倍伤害），
 *   收势 0.5 秒（输出窗口）。
 * - 抛炭：6–14 米、看得到玩家时从自己肩上掰一块红炭（0.4 秒前摇：先掰炭、再抡过头），抛物线砸过去（只预判三分之一的移动），
 *   落点有朱红预警圈；落地炸开一小团火（1 米），留下一片烧 2 秒的地火（祸斗能吃）。全队每 0.6 秒最多一块。
 * - 余烬复燃：死后碎成一堆冒烟的炭（tantong_ember，另一只敌人：要被打掉或踩散才算清完这一波），光越闪越快，
 *   4 秒后炭块飞回去重新拼起来站起（tantong_reborn，半血、不掉落、再死就彻底碎成灰）。
 *   往炭堆上补一枪、范围伤害、或者走过去踩散，才算真死；祸斗吃掉炭堆也算。死在熔岩里 / 悬空处不留炭堆。
 * - 吹火：3 米内有同伴的炭堆（还没人在吹）时跑过去蹲下，对着炭堆鼓腮吹 1.2 秒，炭堆当场复燃——先杀蹲着吹火的那只。
 *
 * 状态机：chase → pounceWindup → pounce → flail → recover → chase
 *         chase → throwWindup → throwRelease → recover → chase
 *         chase → blowGo → blow →（炭堆复燃）chase
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { Geo, flat, joint, part } from '../Models';
import { FLAME_FX_TIME, applyFlameFur, createFlameTongue, type FlameFurHandle, type FlameTongue } from '../fx/FlameFx';
import { INFERNO, coalGeometry, createCoalChunk, launchCoal, reassembleCoals, type CoalFlight } from '../fx/InfernoPackFx';
import { onLavaCell, registerFire, type FireSource } from '../inferno/FireFeed';
import { mix, smooth } from '../frost/PackMotion';

export const TANTONG_DEF: ScaledEnemyDef = {
  id: 'tantong',
  name: '炭童',
  // 美术按 1.0 米（含头顶火苗）制作，游戏里放大 1.3 倍（约 1.3 米）
  scale: 1.3,
  hp: 30,
  speed: 6.5,
  radius: 0.26,
  height: 1.0,
  damage: 9,
  coins: [1, 2],
  essence: 1,
  // 弱点 = 头顶的炭火苗：判定球罩住头顶和火苗（球心离地 0.86），跟着头骨走；脸和身子算身体
  headY: 0.86,
  headRadius: 0.15,
  knockbackResist: 0,
  color: 0xff6a1a,
};

/** 复燃站起来的炭童：半血、不掉落、再死不留炭堆（与本体共用美术） */
export const TANTONG_REBORN_DEF: ScaledEnemyDef = {
  ...TANTONG_DEF,
  id: 'tantong_reborn',
  coins: [0, 0],
  essence: 0,
};

/** 炭童死后的余烬炭堆（不进阵容，只由炭童生成） */
export const TANTONG_EMBER_DEF: ScaledEnemyDef = {
  id: 'tantong_ember',
  name: '炭童余烬',
  scale: 1.3,
  // 一枪就散
  hp: 8,
  speed: 0,
  // 碰撞半径很小（不把玩家顶开，好让玩家踩上去）；命中判定是自己的球
  radius: 0.12,
  height: 0.3,
  damage: 0,
  coins: [0, 0],
  essence: 0,
  headY: 0.18,
  headRadius: 0.3,
  knockbackResist: 1,
  color: 0xff6a1a,
};

/** 扑抓：触发距离、前摇、扑跳速度 / 起跳竖直速度 / 最长时间、乱抓（两下的时刻、总时长、距离、每下伤害倍率）、收势 */
const POUNCE_RANGE = 2.6;
const POUNCE_WINDUP = 0.35;
const POUNCE_SPEED = 7.5;
const POUNCE_VY = 3.2;
const POUNCE_MAX = 0.5;
const FLAIL_HITS = [0.06, 0.26] as const;
const FLAIL_TIME = 0.42;
const FLAIL_RANGE = 1.3;
const FLAIL_DAMAGE_MULT = 0.55;
const POUNCE_RECOVER = 0.5;
/** 抛炭：距离带、前摇（前 BREAK_FRAC 掰炭）、全队间隔、炭块大小 / 炸开半径 / 伤害倍率、地火 */
const THROW_RANGE = [6, 14] as const;
const THROW_WINDUP = 0.4;
const BREAK_FRAC = 0.45;
const THROW_GAP = 0.6;
const COAL_SIZE = 0.09;
const COAL_RADIUS = 1.0;
const COAL_DAMAGE_MULT = 0.8;
const BURN_RADIUS = 1.0;
const BURN_TIME = 2;
const BURN_DAMAGE_MULT = 0.15;
/** 近身合围带 */
const CLOSE_BAND = [1.6, 3.0] as const;
/** 余烬：复燃时间、复燃时的血量比例、找同伴炭堆的距离、吹火时长、吹火时离炭堆的距离、跑去吹火的超时 */
export const REKINDLE_TIME = 4;
const REKINDLE_HP = 0.5;
const BLOW_SEEK = 3;
const BLOW_TIME = 1.2;
const BLOW_STAND = 0.75;
const BLOW_GO_TIMEOUT = 2.5;
/** 走进炭堆这么近（水平，米）就踩散 */
const STOMP_RANGE = 0.75;
/** 步态：步频（每秒步数，随速度）、触地占比、最大步幅（模型单位）、抬脚高度 */
const GAIT_FREQ = [2.2, 4.2] as const;
const GAIT_DUTY = 0.55;
const GAIT_STRIDE = 0.2;
const GAIT_LIFT = 0.06;
/** 头顶火苗的火舌（模型空间，挂 flame 骨）：主苗 + 两片侧苗 */
const FLAME_TONGUES = [
  { at: [0, 0.9, -0.03], size: 0.2 },
  { at: [0.025, 0.89, -0.02], size: 0.12 },
  { at: [-0.025, 0.89, -0.04], size: 0.12 },
] as const;

const C = {
  coal: 0x2a211e, coalHi: 0x3e302a, crack: 0xff5a14, bib: 0xb8302a, bibDark: 0x7a1e1a, rope: 0x9c7c58, anklet: 0x6a4a2a,
  eye: 0xff8a20, eyeHot: 0xfff2b0, flame: 0xffa030, flameHot: 0xfff0b0, tooth: 0xffc860,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();

export class Tantong extends StandardEnemy {
  /** 全队上一次抛炭的时间 */
  private static throwGate = -Infinity;

  protected hips!: THREE.Group;
  protected torso!: THREE.Group;
  protected head!: THREE.Group;
  protected readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  protected readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  /** 掰下来的红炭（白模挂右手；美术身体时挂 hand_R 骨） */
  protected coal!: THREE.Group;
  private coalBaseScale = 1;
  private flameGlow!: THREE.Mesh;
  /** 白模的余烬眼（美术贴图自带眼睛：换上美术身体时收起） */
  private readonly eyeGlows: THREE.Mesh[] = [];
  /** 复燃站起来的（再死不留炭堆） */
  protected reborn = false;
  private windTime = POUNCE_WINDUP;
  private recoverTime = 0.4;
  private flailHits = 0;
  private readonly pounceDir = new THREE.Vector3();
  /** 正在去吹 / 正在吹的同伴炭堆 */
  blowTarget: TantongEmber | null = null;
  /** 最近一次抛出的炭块（测试与调试用） */
  lastCoal: CoalFlight | null = null;
  private zig = 0;
  private zigYaw = 0;
  private gait = 0;
  private fur: FlameFurHandle | null = null;
  private readonly tongues: { m: FlameTongue; base: number; phase: number }[] = [];
  private breathAcc = 0;
  // 平滑后的姿态参数
  private pCrouch = 0;
  private pArmsUp = 0;
  private pLean = 0;
  private pBlow = 0;

  constructor(ctx: GameContext, opts: SpawnOptions, def: ScaledEnemyDef = TANTONG_DEF) {
    super(ctx, def, opts);
    this.walkScale = 0.9;
    this.stepRate = 2.4;
    this.accel = 34;
    this.deathDuration = 0.45;
    this.cooldown = ctx.rng.range(0.6, 1.8);
  }

  protected override artId(): string {
    return TANTONG_DEF.id;
  }

  // ───────────── 模型（白模兜底：?classic 或资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const coal = flat(C.coal, { rough: 0.9 }), hi = flat(C.coalHi, { rough: 0.85 });
    const crack = flat(C.crack, { emissive: 0xc8400c }), bib = flat(C.bib, { rough: 0.8 }), bibDark = flat(C.bibDark);
    const lump = (p: THREE.Object3D, r: number, x: number, y: number, z: number, m = coal): THREE.Mesh => {
      const mesh = part(p, coalGeometry(), m, x, y, z, x * 3, y * 2, z * 5);
      mesh.scale.setScalar(r);
      return mesh;
    };

    const hips = joint(root, 0, 0.26, 0);
    this.hips = hips;
    lump(hips, 0.09, 0, 0, 0);
    part(hips, Geo.ico(0.075, 1), crack, 0, 0.0, 0.0);
    const torso = joint(hips, 0, 0.05, 0);
    this.torso = torso;
    lump(torso, 0.1, 0, 0.1, 0);
    lump(torso, 0.08, 0.04, 0.17, -0.02, hi);
    part(torso, Geo.ico(0.085, 1), crack, 0, 0.12, 0);
    // 朱红肚兜（胸前一片、下摆破边）+ 脖子上的绳
    part(torso, Geo.box(0.16, 0.24, 0.02), bib, 0, 0.08, 0.1);
    for (let i = 0; i < 4; i++) part(torso, Geo.cone(0.025, 0.06, 3), bibDark, -0.06 + i * 0.04, -0.06, 0.1, Math.PI, 0, 0);
    part(torso, Geo.torus(0.07, 0.008, 4, 10), flat(C.rope), 0, 0.22, 0.02, Math.PI / 2, 0, 0);

    // 大圆炭头：余烬眼、尖牙笑、招风耳，头顶一撮炭火苗（弱点）
    const head = joint(torso, 0, 0.26, 0);
    this.head = head;
    part(head, Geo.ico(0.15, 1), coal, 0, 0.15, 0).scale.set(1.05, 1.1, 1.0);
    lump(head, 0.06, 0.07, 0.24, -0.05, hi);
    lump(head, 0.05, -0.08, 0.22, -0.02, hi);
    for (const s of [1, -1]) {
      this.eyeGlows.push(this.glowPart(head, Geo.ico(0.03, 1), C.eye, C.eyeHot, s * 0.055, 0.17, 0.13));
      part(head, Geo.ico(0.04, 0), coal, s * 0.15, 0.14, -0.01).scale.set(0.5, 1, 0.8);
    }
    part(head, Geo.box(0.14, 0.03, 0.02), flat(C.tooth, { emissive: 0x7a4a10 }), 0, 0.08, 0.135);
    part(head, Geo.cone(0.03, 0.06, 5), coal, 0, 0.31, -0.02);
    this.flameGlow = this.glowPart(head, Geo.cone(0.045, 0.14, 6, 'bottom'), C.flame, C.flameHot, 0, 0.32, -0.02, 0);
    this.setHeadAnchor(head, 0, 0.31, 0);

    // 短臂、大炭手（五指）
    for (const s of [1, -1]) {
      const shoulder = joint(torso, s * 0.1, 0.18, 0);
      shoulder.rotation.z = s * 0.4;
      lump(shoulder, 0.045, 0, -0.03, 0);
      const elbow = joint(shoulder, 0, -0.08, 0);
      lump(elbow, 0.04, 0, -0.035, 0);
      const hand = joint(elbow, 0, -0.07, 0);
      lump(hand, 0.05, 0, -0.03, 0.01);
      for (let k = 0; k < 5; k++) {
        const a = (k - 2) * 0.35;
        part(hand, Geo.cyl(0.012, 0.01, 0.05, 5, 'top'), coal, s * Math.sin(a) * 0.03, -0.06, 0.01 + Math.cos(a) * 0.01, k === 0 ? 0.6 : 0, 0, s * a * 0.3);
      }
      this.arms.push({ shoulder, elbow, hand });
    }
    this.coal = createCoalChunk().group;
    this.arms[1].hand.add(this.coal);
    this.coal.position.set(0, -0.08, 0.04);
    this.coal.scale.setScalar(0.01);

    // 短腿、五趾大脚，左脚踝一只铜脚环
    for (const s of [1, -1]) {
      const hip = joint(hips, s * 0.06, -0.04, 0);
      lump(hip, 0.05, 0, -0.04, 0);
      const knee = joint(hip, 0, -0.1, 0);
      lump(knee, 0.045, 0, -0.04, 0);
      part(knee, Geo.box(0.08, 0.04, 0.12), coal, 0, -0.1, 0.03);
      for (let k = 0; k < 5; k++) part(knee, Geo.ico(0.012, 0), coal, (k - 2) * 0.016, -0.11, 0.09);
      if (s > 0) part(knee, Geo.torus(0.045, 0.01, 4, 10), flat(C.anklet, { metal: 0.5, rough: 0.5 }), 0, -0.06, 0, Math.PI / 2, 0, 0);
      this.legs.push({ hip, knee });
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
    // 弱点判定：罩住头顶和火苗的球，挂在 head 骨上
    const headBone = P.bone('head');
    if (headBone) {
      const anchor = new THREE.Object3D();
      headBone.add(anchor);
      anchor.position.copy(headBone.worldToLocal(host.localToWorld(new THREE.Vector3(0, TANTONG_DEF.headY!, 0))));
      this.setHeadAnchor(anchor, 0, 0, 0);
    }
    // 美术火苗自带发光壳：白模火苗收起
    if (n.glowShell) this.flameGlow.visible = false;
    for (const g of this.eyeGlows) g.visible = false;
    // 炭缝、眼睛、牙：按贴图颜色识别（亮橙 / 金黄）的自发光
    if (n.materials[0]) this.fur = applyFlameFur(n.materials[0], 0xff7a22);
    // 头顶火苗：火舌挂在 flame 骨上
    const flameBone = P.bone('flame') ?? headBone;
    if (flameBone) {
      const hostScale = host.getWorldScale(new THREE.Vector3()).x;
      for (const f of FLAME_TONGUES) {
        const m = createFlameTongue(Math.random(), 0xfff4c8, 0xffa030, 0xe0461a);
        flameBone.add(m);
        m.position.copy(flameBone.worldToLocal(host.localToWorld(_v.set(f.at[0], f.at[1], f.at[2]))));
        const base = (f.size * hostScale) / Math.max(1e-6, flameBone.getWorldScale(_w).x);
        m.scale.setScalar(base);
        this.tongues.push({ m, base, phase: Math.random() * 10 });
      }
    }
    // 红炭挂到美术右手骨：掌心前方
    const bone = P.bone('hand_R');
    const wrist = P.restPosition('hand_R');
    if (bone && wrist) {
      const tip = P.bone('fingers_R');
      const dir = new THREE.Vector3(0, -1, 0);
      if (tip) dir.copy(host.worldToLocal(tip.getWorldPosition(new THREE.Vector3()))).sub(wrist).normalize();
      const palm = wrist.clone().addScaledVector(dir, 0.07).add(_v.set(0, 0, 0.04));
      _m.compose(palm, _q.identity(), _s.setScalar(COAL_SIZE / 1.3));
      _m.premultiply(host.matrixWorld);
      _m2.copy(bone.matrixWorld).invert().multiply(_m);
      bone.add(this.coal);
      _m2.decompose(this.coal.position, this.coal.quaternion, this.coal.scale);
      this.coalBaseScale = this.coal.scale.x;
      this.coal.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = true;
      });
    } else {
      this.coalBaseScale = COAL_SIZE / 1.3;
    }
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const ctx = this.ctx;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
        this.chase(dt, d);
        break;
      case 'pounceWindup': {
        // 蹲身、双爪举过头，眼睛和炭缝越来越亮
        this.stopMoving();
        this.facePlayer(10, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        if (this.stateTime >= this.windTime) this.launchPounce();
        break;
      }
      case 'pounce':
        this.setMove(this.pounceDir.x, this.pounceDir.z, POUNCE_SPEED);
        this.glowTarget[0] = 1;
        if ((this.onGround && this.stateTime > 0.15) || (d <= 1.0 && this.stateTime > 0.08) || this.stateTime >= POUNCE_MAX) {
          this.velocity.x *= 0.3;
          this.velocity.z *= 0.3;
          this.flailHits = 0;
          this.setState('flail');
        }
        break;
      case 'flail':
        // 双手乱抓两下
        this.stopMoving();
        this.facePlayer(12, dt);
        while (this.flailHits < FLAIL_HITS.length && this.stateTime >= FLAIL_HITS[this.flailHits]) {
          this.flailHits++;
          if (this.melee(FLAIL_RANGE, this.def.damage * FLAIL_DAMAGE_MULT, 0.0)) {
            this.playerChest(_v);
            ctx.fx.burst(_v, INFERNO.spark, 6, 2.5, 0.3, 0.05, 3);
          }
        }
        if (this.stateTime >= FLAIL_TIME) {
          this.accel = 34;
          this.recoverTime = POUNCE_RECOVER;
          this.setState('recover');
        }
        break;
      case 'throwWindup': {
        this.stopMoving();
        this.facePlayer(8, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.3 + 0.6 * t;
        // 从肩上掰下炭块的一瞬间：一团火星
        if (t >= BREAK_FRAC && this.stateTime - dt < this.windTime * BREAK_FRAC) {
          this.coal.getWorldPosition(_v);
          ctx.fx.burst(_v, INFERNO.spark, 10, 2.5, 0.35, 0.05, 4);
          ctx.audio.play('land', { position: _v, volume: 0.35, pitch: 2.1 });
        }
        if (this.stateTime >= this.windTime) {
          this.throwCoal();
          this.setState('throwRelease');
        }
        break;
      }
      case 'throwRelease':
        this.stopMoving();
        if (this.stateTime >= 0.2) {
          this.recoverTime = 0.3;
          this.setState('recover');
        }
        break;
      case 'blowGo': {
        const pile = this.blowTarget;
        if (!pile || !pile.awaitingBlow(this)) {
          this.dropBlow();
          break;
        }
        // 走到炭堆旁边（靠自己这一侧）
        const dx = this.position.x - pile.position.x, dz = this.position.z - pile.position.z;
        const len = Math.hypot(dx, dz);
        if (len <= BLOW_STAND + 0.2) {
          this.stopMoving();
          this.setState('blow');
          this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.35, pitch: 1.9 });
          break;
        }
        _v.set(pile.position.x + (dx / Math.max(len, 1e-3)) * BLOW_STAND, pile.position.y, pile.position.z + (dz / Math.max(len, 1e-3)) * BLOW_STAND);
        if (len < 2) this.setMove(_v.x - this.position.x, _v.z - this.position.z, this.speed);
        else this.navigate(_v, this.speed, 0.2);
        this.faceMovement(12, dt);
        if (this.stateTime > BLOW_GO_TIMEOUT) this.dropBlow();
        break;
      }
      case 'blow': {
        // 蹲下鼓腮，对着炭堆吹；吹满 1.2 秒炭堆当场复燃
        const pile = this.blowTarget;
        this.stopMoving();
        if (!pile || !pile.awaitingBlow(this)) {
          this.dropBlow();
          break;
        }
        this.faceTowards(pile.position, 10, dt);
        this.glowTarget[0] = 0.5 + 0.3 * Math.sin(this.stateTime * 12);
        pile.blowProgress = clamp01(this.stateTime / BLOW_TIME);
        this.breathAcc += dt;
        if (this.breathAcc > 0.06) {
          this.breathAcc = 0;
          this.localPoint(0, 0.5, 0.2, _v);
          _w.copy(pile.position);
          _w.y += 0.15;
          _t.lerpVectors(_v, _w, Math.random());
          ctx.fx.burst(_t, INFERNO.ash, 1, 0.5, 0.3, 0.08, 0);
          ctx.fx.burst(_w, INFERNO.spark, 2, 1.4, 0.35, 0.05, -2);
        }
        if (this.stateTime >= BLOW_TIME) {
          this.blowTarget = null;
          pile.rekindle();
          this.setState('chase');
          this.rollCooldown(0.5, 1.0);
        }
        break;
      }
      case 'recover':
        this.stopMoving();
        this.glowTarget[0] = 0.15;
        this.facePlayer(5, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('chase');
        }
        break;
      default:
        this.setState('chase');
    }
  }

  /** 追击：先看身边有没有要吹的同伴炭堆，再看能不能出手（扑抓 / 抛炭），否则小跑包围 */
  private chase(dt: number, d: number): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    this.glowTarget[0] = 0.15 + 0.08 * Math.sin(this.age * 3.3);
    const pile = this.findPile();
    if (pile) {
      pile.blower = this;
      this.blowTarget = pile;
      this.setState('blowGo');
      return;
    }
    const reach = this.verticalReach(1.3);
    if (this.cooldown <= 0 && this.sees && reach && this.onGround && d <= POUNCE_RANGE && this.requestAttack('melee', 1.6)) {
      this.windTime = this.windup(POUNCE_WINDUP, 0.25);
      this.setState('pounceWindup');
      ctx.audio.play('enemy_alert', { position: this.position, volume: 0.4, pitch: 1.7 });
      return;
    }
    const now = ctx.time.now;
    if (Tantong.throwGate > now + THROW_GAP) Tantong.throwGate = -Infinity; // 时钟回退（新开一局）
    if (this.cooldown <= 0 && this.sees && this.onGround && d >= THROW_RANGE[0] && d <= THROW_RANGE[1]
      && now - Tantong.throwGate >= THROW_GAP && this.requestAttack('ranged', THROW_WINDUP + 0.6)) {
      Tantong.throwGate = now;
      this.windTime = this.windup(THROW_WINDUP, 0.3);
      this.setState('throwWindup');
      return;
    }
    if (!this.sees && this.blindTime > 0.5) {
      this.approachPlayer(this.speed, 1.6);
      this.faceMovement(10, dt);
      return;
    }
    if (d > 5 || !reach) {
      this.approachPlayer(this.speed, CLOSE_BAND[1]);
      // 视野内的开阔地：每段方向偏一点（小鬼一蹦一跳地扑过来）
      this.zig -= dt;
      if (this.zig <= 0) {
        this.zig = ctx.rng.range(0.35, 0.7);
        this.zigYaw = ctx.rng.range(-0.45, 0.45);
      }
      if (this.sees && d > 5 && Math.abs(this.desiredX) + Math.abs(this.desiredZ) > 0.01) {
        const a = Math.atan2(this.desiredX, this.desiredZ) + this.zigYaw;
        this.setMove(Math.sin(a), Math.cos(a), this.speed);
      }
      this.faceMovement(10, dt);
      return;
    }
    // 近身：在合围带上打转（冷却好了就往里挤，进扑抓距离）
    if (this.cooldown > 0.2) this.keepRange(CLOSE_BAND[0], CLOSE_BAND[1], this.speed * 0.85, 1.0);
    else this.setMove(pl.x - this.position.x, pl.z - this.position.z, this.speed);
    this.facePlayer(9, dt);
  }

  /** 3 米内、还没人在吹、离复燃还早的同伴炭堆 */
  private findPile(): TantongEmber | null {
    if (!this.onGround) return null;
    let best: TantongEmber | null = null;
    let bestD = BLOW_SEEK;
    for (const e of this.ctx.enemies.list) {
      if (!(e instanceof TantongEmber) || !e.awaitingBlow(this) || e.blower) continue;
      if (e.remaining < BLOW_TIME * 0.6) continue;
      const dd = Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z);
      if (dd < bestD && Math.abs(e.position.y - this.position.y) < 1) {
        bestD = dd;
        best = e;
      }
    }
    return best;
  }

  private dropBlow(): void {
    if (this.blowTarget && this.blowTarget.blower === this) {
      this.blowTarget.blower = null;
      this.blowTarget.blowProgress = 0;
    }
    this.blowTarget = null;
    if (this.state === 'blowGo' || this.state === 'blow') this.setState('chase');
  }

  /** 扑跳：朝玩家此刻的位置（轻微预判）跳出去 */
  private launchPounce(): void {
    const pl = this.ctx.player;
    let dx = pl.position.x + pl.velocity.x * 0.15 - this.position.x;
    let dz = pl.position.z + pl.velocity.z * 0.15 - this.position.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    dx /= len;
    dz /= len;
    this.pounceDir.set(dx, 0, dz);
    this.facing = Math.atan2(dx, dz);
    this.accel = 70;
    this.velocity.set(dx * POUNCE_SPEED, POUNCE_VY, dz * POUNCE_SPEED);
    this.setState('pounce');
    this.ctx.audio.play('jump', { position: this.position, volume: 0.4, pitch: 1.6 });
    _v.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.ctx.fx.burst(_v, INFERNO.ash, 5, 1.4, 0.4, 0.14, 1);
  }

  /** 抛炭：从手里的炭块位置抛向玩家脚下（预判三分之一），落点有朱红预警圈 */
  private throwCoal(): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.coal.updateWorldMatrix(true, false);
    const from = this.coal.getWorldPosition(new THREE.Vector3());
    const d = Math.hypot(pl.position.x - from.x, pl.position.z - from.z);
    const T = 0.5 + d * 0.04;
    const target = new THREE.Vector3(pl.position.x + pl.velocity.x * T * 0.33, pl.position.y, pl.position.z + pl.velocity.z * T * 0.33);
    const gy = ctx.world.groundHeight(target.x, target.z, pl.position.y + 0.5);
    if (Number.isFinite(gy)) target.y = gy;
    const dmg = this.def.damage * this.damageMult;
    this.lastCoal = launchCoal(ctx, {
      from, target, flightTime: T, size: COAL_SIZE * this.sizeScale, radius: COAL_RADIUS,
      damage: dmg * COAL_DAMAGE_MULT, burnRadius: BURN_RADIUS, burnTime: BURN_TIME, burnDamage: dmg * BURN_DAMAGE_MULT, source: this,
    });
    ctx.audio.play('skill_throw', { position: from, volume: 0.5, pitch: 1.4 });
    this.releaseAttack();
    this.rollCooldown(2.2, 3.4);
  }

  /** 由炭堆复燃生成：半血，炭块从炭堆飞回身上 */
  rekindledFrom(pile: THREE.Vector3): void {
    this.hp = Math.max(1, Math.round(this.maxHp * REKINDLE_HP));
    this.spawnDuration = 0.55;
    this.cooldown = 0.8;
    reassembleCoals(this.ctx, pile, () => this.getBodyCenter(_w), 5, 0.06 * this.sizeScale);
  }

  protected override cancelAttack(): void {
    this.accel = 34;
    this.dropBlow();
    if (this.state !== 'chase' && this.state !== 'idle') {
      this.setState('chase');
      this.rollCooldown(0.6, 1.2);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.coal.visible = false;
    for (const t of this.tongues) t.m.visible = false;
    if (attackDirector.purging || this.reborn) {
      // 复燃过的再死：彻底碎成灰
      this.getBodyCenter(_v);
      this.ctx.fx.burst(_v, INFERNO.ash, 18, 2.5, 0.8, 0.12, -0.5);
      return;
    }
    this.leavePile();
  }

  /** 碎成一堆余烬炭（另一只敌人）：死在熔岩里、悬空处不留 */
  private leavePile(): void {
    const ctx = this.ctx;
    const at = this.position.clone();
    const gy = ctx.world.groundHeight(at.x, at.z, at.y + 0.5);
    if (!Number.isFinite(gy) || at.y - gy > 1.5) return;
    at.y = gy;
    if (onLavaCell(ctx, at.x, at.z)) return;
    const level = this.level, elite = this.isElite, affix = this.affix ?? undefined;
    ctx.fx.burst(_v.set(at.x, at.y + 0.4 * this.sizeScale, at.z), INFERNO.spark, 16, 3, 0.5, 0.07, 6);
    ctx.fx.burst(_v, INFERNO.smoke, 6, 1, 0.9, 0.3, -1);
    // 延后一帧生成（不在 combat 的死亡结算里改敌人列表）
    ctx.tasks.delay(0.05, () => {
      const e = ctx.enemies.spawn(TANTONG_EMBER_DEF.id, { position: at, level });
      if (e instanceof TantongEmber) e.bindSource({ level, elite, affix });
    });
  }

  protected override onDispose(): void {
    super.onDispose();
    for (const t of this.tongues) t.m.material.dispose();
    this.tongues.length = 0;
  }

  protected override animateDeath(t: number): void {
    // 散架：往下一塌、缩小（炭堆接着出现）
    const e = t * t;
    this.model.rotation.x = 0;
    this.model.position.y = -e * this.height * 0.3;
    this.model.scale.set(this.sizeScale * (1 + e * 0.3), Math.max(0.01, this.sizeScale * (1 - e * 0.95)), this.sizeScale * (1 + e * 0.3));
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const k = 1 - Math.exp(-16 * dt);
    const wind = st === 'pounceWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    this.pCrouch = mix(this.pCrouch, st === 'pounceWindup' ? 0.8 * wind : st === 'blow' ? 1 : st === 'recover' ? 0.35 : st === 'flail' ? 0.25 : 0, k);
    this.pArmsUp = mix(this.pArmsUp, st === 'pounceWindup' ? smooth(wind * 1.4) : st === 'pounce' ? 0.8 : 0, st === 'pounce' ? 1 - Math.exp(-24 * dt) : k);
    this.pLean = mix(this.pLean, st === 'pounce' ? 0.5 : st === 'flail' ? 0.3 : st === 'blow' ? 0.45 : 0.12, k);
    this.pBlow = mix(this.pBlow, st === 'blow' ? 1 : 0, k);
    // 手里的炭块：掰下之后出现，抛出后消失
    const thr = st === 'throwWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    const hold = st === 'throwWindup' && thr >= BREAK_FRAC;
    this.coal.visible = hold;
    this.coal.scale.setScalar(this.coalBaseScale * (hold ? Math.max(0.01, smooth((thr - BREAK_FRAC) / 0.15)) : 0.01));
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, sp, thr);
    else this.poseProcedural(sp, thr);
    // 头顶火苗：平时一跳一跳，出招时蹿高
    FLAME_FX_TIME.value = this.ctx.time.now;
    const heat = Math.max(this.glowLevel[0], this.pBlow * 0.6);
    for (const tg of this.tongues) {
      const flick = 1 + 0.15 * Math.sin(this.age * 13 + tg.phase) + 0.08 * Math.sin(this.age * 31 + tg.phase * 2);
      const grow = 0.85 + 0.5 * heat;
      tg.m.scale.set(tg.base * grow * 0.9, tg.base * grow * flick, tg.base * grow);
      tg.m.material.uniforms.uAlpha.value = 0.75 + 0.25 * heat;
    }
    if (this.fur) this.fur.glow.value = 0.45 + 0.7 * heat + 0.08 * Math.sin(this.age * 7);
  }

  /** 两段手臂的掰炭 / 抡炭角度（模型空间绕 X，负 = 向前上方举） */
  private throwArm(thr: number): { ax: number; az: number; elbow: number } {
    if (this.state === 'throwRelease') return { ax: -0.9, az: 0, elbow: -0.2 };
    if (thr <= 0) return { ax: 0, az: 0, elbow: 0 };
    if (thr < BREAK_FRAC) {
      // 伸到对侧肩上掰炭
      const u = smooth(thr / BREAK_FRAC);
      return { ax: -1.3 * u, az: -0.9 * u, elbow: -1.2 * u };
    }
    const u = smooth((thr - BREAK_FRAC) / (1 - BREAK_FRAC));
    return { ax: mix(-1.3, -2.8, u), az: mix(-0.9, 0.3, u), elbow: mix(-1.2, -1.3, u) };
  }

  /**
   * 美术骨骼动画（自定义人形）。模型空间：X = 炭童左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾 / 肢体向后摆。
   * 小跑是一蹦一跳的童子步：身体前倾、左右晃、两臂甩；脚用两骨 IK 钉地。扑抓：蹲身举爪 → 前扑 → 双爪交替乱抓；
   * 抛炭：右手先伸到左肩掰炭，再抡过头顶甩出；吹火：深蹲、上身前探、头低向炭堆，两手撑膝；受击后仰、眩晕晃头。
   */
  private poseNative(n: NativeBody, dt: number, sp: number, thr: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const st = this.state;
    const walking = (st === 'chase' || st === 'blowGo') && sp > 0.3 && this.onGround;
    const move = clamp01(sp / 1.2);
    const sn = clamp01(sp / Math.max(1, this.speed));
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    if (walking) this.gait = (this.gait + freq * dt * 0.5) % 1;
    const ph = this.gait * Math.PI * 2;
    const stride = walking ? Math.min(GAIT_STRIDE, (sp * GAIT_DUTY) / (freq * this.sizeScale * 0.5)) * move : 0;
    const lift = walking ? GAIT_LIFT * move : 0;
    const c = this.pCrouch;
    const up = this.pArmsUp;
    const blow = this.pBlow;
    const breathe = Math.sin(t * 2.8);
    const air = !this.onGround && (st === 'pounce');

    // 身体：蹦跳起伏、左右晃；蹲身下沉；前倾；受击后仰；眩晕摇晃
    const hop = Math.abs(Math.sin(ph)) * 0.03 * move;
    P.translate('hips', 0, -0.09 * c + hop + breathe * 0.004, 0.02 * c);
    P.rotate('hips', AZ, Math.sin(ph) * 0.1 * move);
    P.rotate('hips', AX, this.pLean * 0.45 + c * 0.2 - this.hurtKick * 0.4);
    P.rotate('spine', AX, 0.05 + blow * 0.3 + breathe * 0.015);
    const throwTwist = thr > BREAK_FRAC ? -0.5 * smooth((thr - BREAK_FRAC) / (1 - BREAK_FRAC)) : thr * 0.4;
    P.rotate('chest', AY, throwTwist + (st === 'throwRelease' ? 0.35 : 0) + (st === 'flail' ? Math.sin(this.stateTime * 30) * 0.25 : 0));
    P.rotate('chest', AX, -up * 0.15 - this.hurtKick * 0.25);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(t * 8) * 0.2);
    // 头：抵消前倾看着玩家；吹火时低头对着炭堆、鼓腮一点一点；平时歪头坏笑
    P.rotate('neck', AX, -this.pLean * 0.4 - c * 0.15 + blow * 0.2);
    P.rotate('head', AX, -this.pLean * 0.3 - up * 0.25 + blow * (0.25 + Math.sin(t * 14) * 0.05) - this.hurtKick * 0.3);
    P.rotate('head', AZ, Math.sin(t * 1.6) * 0.08 * (1 - move) - Math.sin(ph) * 0.06 * move);
    if (this.stunTime > 0) P.rotate('head', AZ, Math.sin(t * 7) * 0.3);
    P.rotate('flame', AX, -sp * 0.04 + Math.sin(t * 9) * 0.05);
    P.rotate('flame', AZ, Math.sin(t * 7.3) * 0.06);

    // 手臂：小跑时前后甩；举爪 / 乱抓 / 掰炭 / 撑膝叠加
    const swing = Math.sin(ph) * 0.6 * move;
    const ta = this.throwArm(thr);
    for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
      let ax = (side === 'L' ? swing : -swing) - 0.1;
      ax += -2.4 * up;
      if (st === 'flail') ax += -1.3 + 0.8 * Math.sin(this.stateTime * 28 + (sgn > 0 ? 0 : Math.PI));
      ax += -0.9 * blow;
      let az = sgn * (0.12 * up + 0.1 * blow);
      let elbow = -0.25 - 0.5 * up - 0.4 * blow;
      if (side === 'R' && (thr > 0 || st === 'throwRelease')) {
        ax = ta.ax;
        az = ta.az * -1;
        elbow = ta.elbow;
      }
      P.rotate(`arm_${side}`, AX, ax);
      P.rotate(`arm_${side}`, AZ, az);
      P.rotate(`forearm_${side}`, AX, elbow);
      const grip = side === 'R' && (thr > 0 || st === 'throwRelease') ? 1 : st === 'flail' ? 0.4 + 0.4 * Math.sin(this.stateTime * 40) : 0.2;
      P.rotate(`fingers_${side}`, AX, -0.3 - 1.0 * grip + up * 0.5);
    }

    // 腿：IK（触地段脚往后扫、腾空段抬脚前摆）；蹲身时膝盖前屈；扑跳腾空时收腿
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
      P.rotate(`thigh_${side}`, AX, -0.1 - (air ? 0.6 : 0));
      P.rotate(`shin_${side}`, AX, 0.2 + (air ? 0.8 : 0));
      if (air) continue;
      _t.set(rest.x, rest.y + dy, rest.z + dz + 0.02 * c);
      P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _t, 1);
    }

    // 头顶火苗发光壳：平时微光，出招 / 吹火时亮
    if (n.glowShell) {
      const gl = Math.max(this.glowLevel[0], blow * 0.7);
      n.glowShell.opacity = clamp01(0.35 + 0.1 * Math.sin(t * 9) + gl * 0.6);
      n.glowShell.color.setHex(0xffb050);
    }
  }

  /** 白模动画：蹦跳小跑、举爪、乱抓、掰炭抡炭、蹲身吹火 */
  private poseProcedural(sp: number, thr: number): void {
    const amp = clamp(sp / Math.max(1, this.speed), 0, 1.2);
    const ph = this.walkPhase * 1.5;
    const c = this.pCrouch;
    const up = this.pArmsUp;
    this.hips.position.y = 0.26 - c * 0.08 + Math.abs(Math.sin(ph)) * 0.03 * amp;
    this.hips.rotation.set(this.pLean * 0.5 - this.hurtKick * 0.3, 0, Math.sin(ph) * 0.1 * amp + (this.stunTime > 0 ? Math.sin(this.age * 8) * 0.2 : 0));
    this.torso.rotation.set(this.pBlow * 0.3, this.state === 'flail' ? Math.sin(this.stateTime * 30) * 0.25 : thr * -0.4, 0);
    this.head.rotation.set(-this.pLean * 0.5 + this.pBlow * 0.3 - this.hurtKick * 0.3, 0, Math.sin(this.age * 1.6) * 0.08);
    const ta = this.throwArm(thr);
    for (const [i, a] of this.arms.entries()) {
      const sgn = i === 0 ? 1 : -1;
      let ax = Math.sin(ph + (i === 0 ? 0 : Math.PI)) * 0.6 * amp - 2.4 * up - 0.9 * this.pBlow;
      if (this.state === 'flail') ax += -1.3 + 0.8 * Math.sin(this.stateTime * 28 + i * Math.PI);
      if (i === 1 && (thr > 0 || this.state === 'throwRelease')) ax = ta.ax;
      a.shoulder.rotation.x = ax;
      a.shoulder.rotation.z = sgn * 0.4 + (i === 1 ? -ta.az : 0);
      a.elbow.rotation.x = -0.3 - 0.5 * up + (i === 1 ? ta.elbow : 0);
    }
    for (const [i, l] of this.legs.entries()) {
      const s = Math.sin(ph + i * Math.PI);
      l.hip.rotation.x = s * 0.6 * amp - c * 0.8;
      l.knee.rotation.x = Math.max(0, -s) * 0.6 * amp + c * 1.3;
    }
  }
}

/** 复燃站起来的炭童：半血、不掉落，再死就彻底碎成灰 */
export class TantongReborn extends Tantong {
  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, opts, TANTONG_REBORN_DEF);
    this.reborn = true;
  }
}

// ───────────────────────────── 余烬炭堆 ─────────────────────────────

/** 炭堆里的炭块（模型空间，脚底原点）：位置、大小 */
const PILE_CHUNKS = [
  { at: [0, 0.07, 0], r: 0.1 },
  { at: [0.1, 0.05, 0.04], r: 0.07 },
  { at: [-0.09, 0.05, -0.03], r: 0.08 },
  { at: [0.02, 0.05, -0.11], r: 0.065 },
  { at: [0.0, 0.15, 0.02], r: 0.055 },
] as const;

/**
 * 炭童的余烬炭堆（tantong_ember）：一堆冒烟的炭块，炭缝的光越闪越快，4 秒后炭块飞回去、炭童重新站起来（半血）。
 * 一枪就散（8 点血，不暴击），范围伤害照样打得到；玩家走进 0.75 米就踩散。同伴蹲着吹 1.2 秒会让它当场复燃；
 * 祸斗会跑来吃掉它（炭童彻底死）。打散 / 踩散 / 吃掉之前，这一波都算没清完。
 */
export class TantongEmber extends StandardEnemy implements FireSource {
  readonly kind = 'ember' as const;
  /** 正在吹它的同伴（同一堆只让一只吹） */
  blower: Tantong | null = null;
  /** 吹火进度 0..1（只用于表现：越吹越亮） */
  blowProgress = 0;
  claimedBy: number | null = null;
  private life = 0;
  private src: { level: number; elite: boolean; affix?: string } = { level: 1, elite: false };
  private done = false;
  private flicker = 0;
  private smokeAcc = 0;
  private unregister: (() => void) | null = null;
  private readonly glows: THREE.Mesh[] = [];
  private readonly chunks: THREE.Object3D[] = [];
  private tongue: FlameTongue | null = null;
  private readonly ground = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, TANTONG_EMBER_DEF, opts);
    this.spawnDuration = 0.25;
    this.deathDuration = 0.4;
    this.facing = ctx.rng.range(0, Math.PI * 2);
  }

  /** 离复燃还剩几秒 */
  get remaining(): number {
    return Math.max(0, REKINDLE_TIME - this.life);
  }

  /** 记下是谁碎成的（复燃时按同样的强度 / 精英站起来） */
  bindSource(src: { level: number; elite: boolean; affix?: string }): void {
    this.src = src;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const coal = flat(C.coal, { rough: 0.95, emissive: 0x2a0a02 });
    for (const [i, ch] of PILE_CHUNKS.entries()) {
      const g = joint(root, ch.at[0], ch.at[1], ch.at[2]);
      g.rotation.set(i * 1.3, i * 2.1, i * 0.7);
      part(g, coalGeometry(), coal, 0, 0, 0).scale.setScalar(ch.r);
      const glow = part(g, coalGeometry(), new THREE.MeshBasicMaterial({
        color: INFERNO.crack, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }), 0, 0, 0);
      glow.scale.setScalar(ch.r * 1.08);
      glow.rotation.set(0.6, 0.3, 0.9);
      this.glows.push(glow);
      this.chunks.push(g);
    }
    // 炭堆底下一圈暗红的余烬
    part(root, Geo.disc(0.22, 12), new THREE.MeshBasicMaterial({
      color: 0x5a1a06, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), 0, 0.01, 0);
    return root;
  }

  protected override afterInit(): void {
    this.ground.copy(this.position);
    // 炭堆顶上一小簇火苗（复燃前越蹿越高）；挂在模型上（随整体缩放），不进实例材质克隆（共享火舌时间）
    const t = createFlameTongue(Math.random(), 0xfff0c0, 0xff9a30, 0xd8401a);
    t.position.set(0, 0.12, 0);
    t.scale.setScalar(0.01);
    this.model.add(t);
    this.tongue = t;
    this.unregister = registerFire(this.ctx, this);
    this.ctx.audio.play('burn_tick', { position: this.position, volume: 0.4, pitch: 0.7 });
  }

  // FireSource（position = 炭堆脚底中心，radius = 碰撞半径）
  edible(): boolean {
    return this.alive && !this.done;
  }

  /** 被祸斗吃掉：炭堆消失（不算玩家击杀），炭童彻底死 */
  consume(): void {
    if (!this.edible()) return;
    this.vanish();
    this.ctx.fx.burst(_v.set(this.position.x, this.position.y + 0.1, this.position.z), INFERNO.smoke, 8, 1.2, 0.8, 0.2, -1);
  }

  /** 这堆还在等人吹（活着、没复燃；who 是正在吹它的那只时也算） */
  awaitingBlow(who: Tantong): boolean {
    return this.alive && !this.done && (this.blower === null || this.blower === who) && this.claimedBy === null;
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    _v.set(this.position.x, this.position.y + 0.12 * this.sizeScale, this.position.z);
    const r = 0.26 * this.sizeScale;
    const ox = origin.x - _v.x, oy = origin.y - _v.y, oz = origin.z - _v.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return false;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = -b + Math.sqrt(disc);
    if (t < 0 || t > maxDist) return false;
    out.distance = t;
    out.headshot = false;
    return true;
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + 0.12 * this.sizeScale, this.position.z);
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + 0.2 * this.sizeScale, this.position.z);
  }

  protected override ai(dt: number): void {
    this.stopMoving();
    this.velocity.x = 0;
    this.velocity.z = 0;
    if (this.done) return;
    this.life += dt;
    // 踩散
    const pl = this.ctx.player;
    const dx = pl.position.x - this.position.x, dz = pl.position.z - this.position.z;
    if (pl.alive && dx * dx + dz * dz <= STOMP_RANGE * STOMP_RANGE && Math.abs(pl.position.y - this.position.y) < 0.7) {
      this.stomp();
      return;
    }
    if (this.life >= REKINDLE_TIME) this.rekindle();
  }

  /** 玩家走进来踩散：按一次近战击杀结算（算玩家击杀，炭堆不掉落） */
  private stomp(): void {
    const ctx = this.ctx;
    const req: DamageRequest = {
      base: this.maxHp * 4 + 20, element: 'none', source: 'melee', canCrit: false,
      point: this.getBodyCenter(new THREE.Vector3()),
    };
    ctx.audio.play('land', { position: this.position, volume: 0.7, pitch: 0.7 });
    if (typeof ctx.combat.damageEnemy === 'function') ctx.combat.damageEnemy(this, req);
    if (this.alive) this.vanish();
  }

  /** 复燃：炭堆消失（不算击杀），原地站起一只半血的炭童，炭块飞回去拼合 */
  rekindle(): void {
    if (this.done || !this.alive) return;
    const ctx = this.ctx;
    const at = this.position.clone();
    const src = this.src;
    if (this.blower) this.blower.blowTarget = null;
    this.blower = null;
    this.vanish();
    ctx.fx.burst(_v.set(at.x, at.y + 0.3, at.z), INFERNO.spark, 24, 4, 0.5, 0.08, 1);
    ctx.fx.ring(_w.set(at.x, at.y + 0.05, at.z), 1.4, INFERNO.ember, 0.35);
    ctx.audio.play('skill_fire', { position: at, volume: 0.6, pitch: 1.3 });
    const e = ctx.enemies.spawn(TANTONG_REBORN_DEF.id, { position: at, level: src.level, elite: src.elite || undefined, affix: src.affix });
    if (e instanceof Tantong) e.rekindledFrom(at);
  }

  /** 消失：不经过 combat（复燃、被吃掉），不算击杀、不掉落 */
  private vanish(): void {
    if (this.done || !this.alive) return;
    this.done = true;
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    const req: DamageRequest = { base: 0, element: 'none', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    };
    this.onKilled(res);
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.unregister?.();
    this.unregister = null;
    if (this.blower) {
      this.blower.blowTarget = null;
      this.blower = null;
    }
    const wasDone = this.done;
    this.done = true;
    if (wasDone || attackDirector.purging) return;
    // 被打散 / 踩散：炭块崩开、火灭成灰
    const c = this.getBodyCenter(new THREE.Vector3());
    this.ctx.fx.burst(c, INFERNO.coal, 10, 3.5, 0.7, 0.07, 9);
    this.ctx.fx.burst(c, INFERNO.ash, 12, 1.8, 0.9, 0.12, -0.6);
    this.ctx.fx.burst(c, INFERNO.ember, 8, 2.5, 0.4, 0.05, 2);
  }

  protected override cancelAttack(): void {}

  protected override onDispose(): void {
    super.onDispose();
    this.unregister?.();
    this.unregister = null;
    this.tongue?.material.dispose();
    this.tongue = null;
  }

  protected override animateDeath(t: number): void {
    // 炭块往外崩、缩没
    const e = t * t;
    for (const [i, g] of this.chunks.entries()) {
      const ch = PILE_CHUNKS[i];
      g.position.set(ch.at[0] * (1 + e * 4), ch.at[1] * (1 - e), ch.at[2] * (1 + e * 4));
      g.scale.setScalar(Math.max(0.01, 1 - e));
    }
    if (this.tongue) this.tongue.visible = false;
  }

  protected override pose(dt: number): void {
    // 炭缝的光越闪越快（1.5 → 9 Hz），吹火时更亮；顶上的火苗越蹿越高
    const u = clamp01(this.life / REKINDLE_TIME);
    const blow = this.blower ? this.blowProgress : 0;
    const freq = 1.5 + 7.5 * Math.pow(Math.max(u, blow), 1.5);
    this.flicker += dt * freq * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.flicker);
    const heat = clamp01(0.3 + 0.5 * pulse * (0.4 + 0.6 * u) + 0.4 * blow);
    for (const g of this.glows) {
      const m = g.material as THREE.MeshBasicMaterial;
      m.color.setHex(INFERNO.crack).lerp(_hot.setHex(INFERNO.crackHot), heat * heat).multiplyScalar(0.35 + 0.75 * heat);
    }
    if (this.tongue) {
      FLAME_FX_TIME.value = this.ctx.time.now;
      const s = 0.06 + 0.22 * Math.max(u * u, blow) + 0.04 * pulse;
      this.tongue.scale.set(s * 0.9, s * (1 + 0.15 * Math.sin(this.age * 17)), s);
      this.tongue.material.uniforms.uAlpha.value = 0.5 + 0.5 * heat;
    }
    // 冒烟（越到复燃越旺），吹火时火星往上蹿
    this.smokeAcc += dt * (0.8 + 2.5 * u + 4 * blow);
    if (this.smokeAcc > 0.3) {
      this.smokeAcc = 0;
      _v.set(this.position.x + (Math.random() - 0.5) * 0.2, this.position.y + 0.2 * this.sizeScale, this.position.z + (Math.random() - 0.5) * 0.2);
      this.ctx.fx.burst(_v, INFERNO.smoke, 1, 0.3, 1.2, 0.22, -0.9);
      if (u > 0.5 || blow > 0) this.ctx.fx.burst(_v, INFERNO.spark, 2, 1.2, 0.4, 0.05, -2.5);
    }
    // 快复燃时炭块一颤一颤
    const shake = u > 0.6 ? (u - 0.6) * 0.04 * Math.sin(this.age * 50) : 0;
    for (const [i, g] of this.chunks.entries()) g.position.y = PILE_CHUNKS[i].at[1] + Math.abs(shake) * (i % 2 ? 1 : 0.5);
  }
}

const _hot = new THREE.Color();
