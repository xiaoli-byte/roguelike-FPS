/**
 * 三青鸟（qingniao，第二章 · 昆仑雪墟的远程飞行怪）：西王母座下的三青鸟，冻成一只翼展 3.4 米的冰羽青鸟——
 * 红冠、白喙、三条长尾羽，每根飞羽镶一道冰刃，胸口嵌一颗发光霜晶（弱点）。第二章唯一的飞行常规怪，逼玩家抬头。
 * 动作按真实猛禽：悬停时身体半立、翅膀大幅扑扇（下扑时身体被托起一下），头保持稳定盯住目标；
 * 滑翔俯冲时收翅后掠、身体放平、尾羽拉直；落脚时张翅刹车、尾羽展开，站定后收翅理羽。
 *
 * - 盘旋：在离地 8–11 米处盘旋，和玩家保持 15–25 米、绕着玩家横移；看不到玩家时换到有视线的位置。
 * - 冰羽扇射（约每 3 秒，有视线、拿到远程令牌）：双翅后收上扬 0.5 秒（羽尖冰刃亮起）——前摇；
 *   随后一记下扑，从两翼与胸前同时射出 5 根冰羽，排成一道横排扫向玩家（横移从缝里躲开）。
 * - 俯冲换位：累计被打掉 30% 血时尖啸（0.45 秒，昂头张翅，地面在掠过点亮出预警圈），
 *   收翅贴地俯冲、从玩家身侧 1.6 米处掠过（被擦到重伤 + 被撞开，跳开或横移躲开），再拉升到玩家另一侧的高处。
 * - 歇脚：飞满约 12 秒，落到附近的柱顶 / 高台边（没有就落在空地上）歇 3 秒，收翅理羽——输出窗口；
 *   歇脚时被打掉 25% 血或被贴到 2.5 米内会惊飞。
 * 弱点 = 胸口霜晶；身体、头、内侧翅膀是挂在骨骼上的几颗命中球（展翼的鸟，竖直胶囊包不住）。
 *
 * 状态机：hover → volley → recover → hover
 *         hover →（掉血 30%）screech → swoopDown → swoopUp → hover
 *         hover →（飞满 12 秒）toPerch → perched → takeoff → hover
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import {
  FROST_FX_TIME, Spring, applyFrostGlow, hitAnchor, iceShatter, raycastSpheres, type FrostGlowHandle, type HitSphere,
} from '../fx/FrostSkirmishFx';

export const QINGNIAO_DEF: ScaledEnemyDef = {
  id: 'qingniao',
  name: '三青鸟',
  // 美术按翼展 2.87 米、冠顶到尾尖 2.6 米制作，游戏里放大 1.2 倍：翼展约 3.4 米
  scale: 1.2,
  hp: 80,
  speed: 6,
  radius: 0.42,
  // 脚底到冠顶（放大前；尾羽垂在脚底以下）
  height: 1.5,
  flying: true,
  damage: 9,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 胸口霜晶（球心离脚底 0.8，放大前）
  headY: 0.8,
  headRadius: 0.17,
  knockbackResist: 0.4,
  color: 0x5fc8ff,
};

/** 美术网格整体下移这么多（模型单位）：脚爪落在原点，尾羽垂到脚底以下 */
const ART_DROP = 1.0;
/**
 * 尾羽离地：出生时脚底至少离地这么高（模型单位，乘体型；尾羽垂在脚下约 1 个单位），贴地出生的直接放到半空；
 * 飞得低于 TAIL_CLEAR 时尾羽往后上方收起（TAIL_TUCK 弧度），不插进地面。
 */
const SPAWN_ALT = 2.0;
const TAIL_CLEAR = 1.6;
const TAIL_TUCK = 1.25;
/** 盘旋高度（离地 / 离玩家脚底，米）、水平距离带 */
const ALTITUDE = [8, 11] as const;
const RANGE = [15, 25] as const;
/** 冰羽扇射 */
const VOLLEY_WINDUP = 0.5;
const VOLLEY_RECOVER = 0.45;
const VOLLEY_COOLDOWN = [2.6, 3.4] as const;
const FEATHERS = 5;
const FEATHER_SPEED = 22;
/** 冰羽在目标处的横向间距（米） */
const FEATHER_SPACING = 2.0;
const FEATHER_LEAD = 0.35;
/** 俯冲换位：触发的累计掉血比例、尖啸前摇、掠过点离玩家的横向距离、速度、擦中判定与伤害 */
const SWOOP_TRIGGER = 0.3;
const SCREECH_TIME = 0.45;
const SWOOP_SIDE = 1.6;
const SWOOP_SPEED = 14;
const SWOOP_CLIMB_SPEED = 12;
const SWOOP_HIT_RANGE = 1.7;
const SWOOP_DAMAGE = 22;
const SWOOP_FAR = 16;
/** 歇脚：飞多久要歇、歇多久、惊飞条件 */
const PERCH_AFTER = [11, 14] as const;
const PERCH_TIME = 3;
const PERCH_STARTLE_HP = 0.25;
const PERCH_STARTLE_RANGE = 2.5;
const TAKEOFF_TIME = 0.5;
/** 霜晶 / 身体中心（模型单位，已含 ART_DROP） */
const JEWEL = new THREE.Vector3(0, 0.8, 0.5);
const CHEST = new THREE.Vector3(0, 0.78, 0.28);

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const PLUMES = ['L', 'C', 'R'] as const;

const C = {
  feather: 0x2f6fb8, featherDark: 0x1f4f8f, belly: 0xe4eef6, ice: 0xcff0ff, crest: 0xd8302a, beak: 0xf0ece0,
  talon: 0x3a3f4a, gold: 0x8fa080, jewel: 0x5ff0ff, jewelHot: 0xeaffff, eye: 0xff5040, eyeHot: 0xffd0a0,
};

/** 每帧的姿态参数（美术骨骼与白模共用） */
interface BirdPose {
  /** 翅膀拍动角（上扬为正）、拍动相位 */
  flap: number;
  phase: number;
  amp: number;
  /** 翅膀上扬偏置、后掠、收拢 */
  raise: number;
  sweep: number;
  fold: number;
  /** 身体前倾（弧度）、上下托起（模型单位）、侧倾 */
  pitch: number;
  lift: number;
  bank: number;
  /** 头相对身体的偏航 / 俯仰 */
  headYaw: number;
  headPitch: number;
  /** 收腿（0 = 腿垂直站立） */
  tuck: number;
  /** 尾羽整体往后上方甩（绕 X 正转）、展开 */
  tailLift: number;
  tailFan: number;
}

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Qingniao extends StandardEnemy {
  private readonly hits: HitSphere[] = [];
  /** 冰羽出射点：左翼尖、左翼中、胸前霜晶、右翼中、右翼尖（挂在翼骨 / 白模翼关节上） */
  private readonly featherAnchors: THREE.Object3D[] = [];
  private glow: FrostGlowHandle | null = null;
  // 白模关节
  private pitchJoint!: THREE.Group;
  private neckJoint!: THREE.Group;
  private headJoint!: THREE.Group;
  private readonly wingJoints: { s: number; seg: THREE.Group[] }[] = [];
  private readonly legJoints: THREE.Group[] = [];
  private readonly plumeJoints: THREE.Group[][] = [];
  /** 羽尖冰刃的发光件（白模）与霜晶 */
  private readonly tipGlows: THREE.Mesh[] = [];
  // 行为
  private readonly altitude: number;
  private readonly bobPhase: number;
  private climb = 0;
  private flyTime = 0;
  private perchAfter: number;
  private hurtSinceSwoop = 0;
  private hurtWhilePerched = 0;
  private readonly perchPoint = new THREE.Vector3();
  private readonly swoopLow = new THREE.Vector3();
  private readonly swoopEnd = new THREE.Vector3();
  private swoopHit = false;
  private swoopWarning: (() => void) | null = null;
  private volleyTime = VOLLEY_WINDUP;
  // 姿态
  private flapPhase = 0;
  private readonly pose$: BirdPose = {
    flap: 0, phase: 0, amp: 0, raise: 0, sweep: 0, fold: 0, pitch: 0, lift: 0, bank: 0, headYaw: 0, headPitch: 0, tuck: 0, tailLift: 0, tailFan: 0,
  };
  private readonly sAmp = new Spring(30, 0.9);
  private readonly sRaise = new Spring(60, 0.8);
  private readonly sSweep = new Spring(50, 0.8);
  private readonly sFold = new Spring(30, 0.9);
  private readonly sPitch = new Spring(25, 0.85);
  private readonly sBank = new Spring(25, 0.8);
  private readonly sTuck = new Spring(20, 0.9);
  private readonly sFan = new Spring(30, 0.8);
  /** 尾羽弹簧：每条三节（俯仰、偏航） */
  private readonly tailSprings = PLUMES.map(() => [0, 1, 2].map(() => ({ p: new Spring(26, 0.45), y: new Spring(22, 0.4) })));
  private preenTimer = 0;
  private preenSide = 1;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, QINGNIAO_DEF, opts);
    this.altitude = ctx.rng.range(ALTITUDE[0], ALTITUDE[1]);
    this.hoverHeight = this.altitude;
    this.bobPhase = ctx.rng.range(0, Math.PI * 2);
    this.perchAfter = ctx.rng.range(PERCH_AFTER[0], PERCH_AFTER[1]);
    this.accel = 9;
    this.deathDuration = 1.2;
    this.cooldown = ctx.rng.range(1.0, 2.2);
    this.setState('hover');
    // 出生就在半空：尾羽垂在脚下，贴地出生的起飞那一秒尾羽会插进地面（上方有东西挡着就不抬）
    const pos = this.position;
    const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 1);
    const want = (Number.isFinite(gy) ? gy : pos.y) + SPAWN_ALT * this.sizeScale;
    if (pos.y < want && !ctx.world.overlapsBody(pos.x, want, pos.z, this.radius, this.height)) pos.y = want;
  }

  // ───────────── 白模 ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fea = flat(C.feather, { rough: 0.75 }), dark = flat(C.featherDark, { rough: 0.8 }), belly = flat(C.belly, { rough: 0.8 });
    const ice = flat(C.ice, { rough: 0.3 }), crest = flat(C.crest, { rough: 0.6 }), talon = flat(C.talon, { rough: 0.5 });
    // 身体绕髋转（前倾），所有部件都挂在它下面
    const pitch = joint(root, 0, 0.3, 0.22);
    this.pitchJoint = pitch;
    part(pitch, Geo.ico(0.24, 2), fea, 0, 0.48, 0.04).scale.set(0.95, 1.45, 0.85);
    part(pitch, Geo.ico(0.19, 2), belly, 0, 0.4, 0.14).scale.set(0.9, 1.4, 0.7);
    part(pitch, Geo.box(0.22, 0.22, 0.04), flat(C.gold, { metal: 0.5, rough: 0.5 }), 0, 0.5, 0.27, 0, 0, Math.PI / 4);
    this.glowPart(pitch, Geo.octa(0.1), C.jewel, C.jewelHot, JEWEL.x, JEWEL.y - 0.3, JEWEL.z - 0.22);
    // 颈、头：白喙、红冠、红眼
    const neck = joint(pitch, 0, 0.72, 0.06);
    this.neckJoint = neck;
    part(neck, Geo.cyl(0.08, 0.11, 0.2, 7), fea, 0, 0.08, 0);
    const head = joint(neck, 0, 0.2, 0.02);
    this.headJoint = head;
    part(head, Geo.ico(0.12, 1), fea, 0, 0.05, 0.04).scale.set(0.9, 0.95, 1.1);
    part(head, Geo.cone(0.045, 0.16, 6), flat(C.beak, { rough: 0.4 }), 0, 0.02, 0.2, Math.PI / 2 + 0.25, 0, 0);
    for (let i = 0; i < 3; i++) part(head, Geo.cone(0.03, 0.2 - i * 0.04, 4, 'bottom'), crest, 0, 0.13, 0.02 - i * 0.05, -0.3 - i * 0.25, 0, 0);
    for (const s of [1, -1]) this.glowPart(head, Geo.ico(0.02, 1), C.eye, C.eyeHot, s * 0.07, 0.07, 0.1);
    // 双翼：三节（肱、前臂、掌 + 主飞羽），每节一片羽面 + 后缘一道冰刃
    for (const s of [1, -1]) {
      const segs: THREE.Group[] = [];
      let parent: THREE.Object3D = pitch;
      const at = [[s * 0.2, 0.58, 0.05], [s * 0.4, 0.02, 0], [s * 0.4, 0.06, -0.01]] as const;
      const span = [0.42, 0.42, 0.46];
      for (let i = 0; i < 3; i++) {
        const g = joint(parent, at[i][0], at[i][1], at[i][2]);
        g.rotation.order = 'YZX';
        part(g, Geo.box(span[i], 0.04, 0.34 - i * 0.04), i === 2 ? dark : fea, s * span[i] / 2, 0, -0.08);
        part(g, Geo.box(span[i], 0.03, 0.08), ice, s * span[i] / 2, -0.01, -0.29 + i * 0.03);
        this.tipGlows.push(this.glowPart(g, Geo.box(span[i] * 0.9, 0.035, 0.03), 0x000000, C.jewelHot, s * span[i] / 2, -0.005, -0.33 + i * 0.03, 1, true));
        segs.push(g);
        parent = g;
      }
      this.wingJoints.push({ s, seg: segs });
      // 腿：跗跖 + 四趾爪
      const leg = joint(pitch, s * 0.13, 0.08, 0.02);
      part(leg, Geo.cyl(0.025, 0.03, 0.32, 5, 'top'), talon, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const a = k === 3 ? Math.PI : (k - 1) * 0.5;
        part(leg, Geo.cone(0.015, 0.09, 4), talon, Math.sin(a) * 0.04, -0.33, Math.cos(a) * 0.04, Math.PI / 2, a, 0);
      }
      this.legJoints.push(leg);
    }
    // 三条长尾羽：每条三节，末节是一片冰羽
    for (const s of [1, 0, -1]) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = pitch;
      for (let i = 0; i < 3; i++) {
        const g = joint(parent, i === 0 ? s * 0.03 : 0, i === 0 ? 0.02 : -0.36, i === 0 ? -0.1 : 0);
        if (i === 0) g.rotation.set(0.35, 0, s * 0.18);
        part(g, Geo.box(0.07 - i * 0.01, 0.38, 0.03), i === 2 ? ice : fea, 0, -0.18, 0);
        chain.push(g);
        parent = g;
      }
      this.plumeJoints.push(chain);
    }
    this.setHeadAnchor(pitch, JEWEL.x, JEWEL.y - 0.3, JEWEL.z - 0.22);
    return root;
  }

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    if (n) {
      // 美术网格下移：脚爪落在原点（逻辑位置），尾羽垂到下面
      let top: THREE.Object3D = n.lod;
      while (top.parent && top.parent !== host) top = top.parent;
      top.position.y -= ART_DROP;
      // 白模身体整组隐藏（含白模的霜晶 / 羽刃发光件：美术版改用贴图上的霜晶与冰刃本身发光）
      this.pitchJoint.visible = false;
    }
    const at = (bone: string, fallback: THREE.Object3D): THREE.Object3D => P?.bone(bone) ?? fallback;
    const wingL = this.wingJoints[0].seg, wingR = this.wingJoints[1].seg;
    const jewel = hitAnchor(at('chest', this.pitchJoint), host, JEWEL.x, JEWEL.y, JEWEL.z);
    this.hits.push({ anchor: jewel, r: QINGNIAO_DEF.headRadius!, head: true });
    this.hits.push({ anchor: hitAnchor(at('chest', this.pitchJoint), host, CHEST.x, CHEST.y, CHEST.z), r: 0.28, head: false });
    this.hits.push({ anchor: hitAnchor(at('hips', this.pitchJoint), host, 0, 0.42, 0.24), r: 0.24, head: false });
    this.hits.push({ anchor: hitAnchor(at('head', this.headJoint), host, 0, 1.28, 0.38), r: 0.16, head: false });
    for (const [s, w] of [[1, wingL], [-1, wingR]] as const) {
      const side = s > 0 ? 'L' : 'R';
      this.hits.push({ anchor: hitAnchor(at(`wing_1_${side}`, w[0]), host, s * 0.42, 0.88, 0.25), r: 0.2, head: false });
      this.hits.push({ anchor: hitAnchor(at(`wing_2_${side}`, w[1]), host, s * 0.82, 0.92, 0.26), r: 0.2, head: false });
    }
    this.setHeadAnchor(jewel, 0, 0, 0);
    for (const [s, w] of [[1, wingL], [-1, wingR]] as const) {
      const side = s > 0 ? 'L' : 'R';
      const tip = hitAnchor(at(`wing_3_${side}`, w[2]), host, s * 1.3, 1.04, 0.4);
      const mid = hitAnchor(at(`wing_2_${side}`, w[1]), host, s * 0.8, 0.94, 0.26);
      if (s > 0) this.featherAnchors.push(tip, mid, jewel);
      else this.featherAnchors.push(mid, tip);
    }
    if (!n) return;
    this.glow = applyFrostGlow(n.materials[0], 'qingniao', [
      // 胸口霜晶：常亮、随呼吸起伏，前摇时更亮（资产坐标 = 未下移的网格坐标）
      { color: C.jewel, hue: [0.53, 0.12], minSat: 0.25, minVal: 0.55, sphere: { center: [0, 1.8, 0.5], radius: 0.16 }, shimmer: 0.35 },
      // 羽尖冰刃：翼展外侧 0.75 米以外发白的冰边
      { color: 0x9feaff, hue: [0.55, 0.14], minVal: 0.78, maxSat: 0.55, box: { min: [0.75, 1.3, -0.2], max: [1.6, 2.4, 0.8], soft: 0.08, absX: true }, shimmer: 0.6 },
      // 尾羽末端的冰羽
      { color: 0x9feaff, hue: [0.55, 0.14], minVal: 0.78, maxSat: 0.55, box: { min: [-0.6, -0.1, -0.7], max: [0.6, 0.62, 0.2], soft: 0.08 }, shimmer: 0.6 },
    ]);
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.hits.length > 1 && this.alive) return this.hits[1].anchor.getWorldPosition(out);
    return this.localPoint(CHEST.x, CHEST.y, CHEST.z, out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    if (this.hits.length > 0 && this.alive) return this.hits[0].anchor.getWorldPosition(out);
    return this.localPoint(JEWEL.x, JEWEL.y, JEWEL.z + 0.1, out);
  }

  // ───────────── AI ─────────────

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    this.hurtSinceSwoop += r.dealt;
    if (this.state === 'perched') this.hurtWhilePerched += r.dealt;
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    switch (this.state) {
      case 'chase':
      case 'hover': {
        this.flyTime += dt;
        this.updateAltitude(dt);
        this.glowTarget[0] = 0.15;
        if (this.hurtSinceSwoop >= SWOOP_TRIGGER * this.maxHp && this.startScreech()) break;
        if (this.flyTime >= this.perchAfter && this.findPerch(this.perchPoint)) {
          this.setState('toPerch');
          break;
        }
        if (this.seekSight(RANGE[0] - 3, RANGE[1], this.speed, this.altitude)) {
          this.faceMovement(3, dt);
          break;
        }
        this.keepRange(RANGE[0], RANGE[1], this.speed, 0.6);
        this.facePlayer(3, dt);
        if (this.cooldown <= 0 && this.sees && this.distToPlayerXZ() <= RANGE[1] + 6) {
          if (this.requestAttack('ranged', VOLLEY_WINDUP + VOLLEY_RECOVER + 0.4)) {
            this.volleyTime = this.windup(VOLLEY_WINDUP, 0.35);
            this.setState('volley');
            this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.6 });
          } else {
            this.cooldown = this.ctx.rng.range(0.3, 0.7);
          }
        }
        break;
      }
      case 'volley': {
        // 双翅后收上扬，羽尖亮起；悬停原地（慢慢漂）
        this.updateAltitude(dt);
        this.keepRange(RANGE[0], RANGE[1], this.speed * 0.25, 0.3);
        this.facePlayer(5, dt);
        const t = clamp01(this.stateTime / this.volleyTime);
        this.glowTarget[0] = 0.3 + 0.7 * t;
        this.glowTarget[1] = t;
        if (this.stateTime >= this.volleyTime) {
          this.fireFeathers();
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.updateAltitude(dt);
        this.keepRange(RANGE[0], RANGE[1], this.speed * 0.5, 0.5);
        this.facePlayer(4, dt);
        this.glowTarget[0] = 0.15;
        this.glowTarget[1] = 0;
        if (this.stateTime >= VOLLEY_RECOVER) {
          this.releaseAttack();
          this.rollCooldown(VOLLEY_COOLDOWN[0], VOLLEY_COOLDOWN[1]);
          this.setState('hover');
        }
        break;
      }
      case 'screech': {
        // 尖啸：原地昂头张翅，然后收翅俯冲
        this.stopMoving();
        this.facePlayer(6, dt);
        this.glowTarget[0] = 0.6 + 0.4 * Math.sin(this.stateTime * 30);
        if (this.stateTime >= SCREECH_TIME) {
          this.swoopHit = false;
          this.accel = 30;
          this.setState('swoopDown');
        }
        break;
      }
      case 'swoopDown': {
        // 贴地俯冲向掠过点；高度直接追掠过点
        this.flyTargetY = this.swoopLow.y;
        const reached = this.flyTo(this.swoopLow, SWOOP_SPEED, 1.4);
        this.faceMovement(10, dt);
        this.checkSwoopHit();
        if (reached || this.stateTime > 1.8 || (this.moveResult.hitWall && this.stateTime > 0.3)) {
          this.swoopWarning = null;
          this.setState('swoopUp');
        }
        break;
      }
      case 'swoopUp': {
        // 掠过后拉升到玩家另一侧的高处
        this.flyTargetY = this.swoopEnd.y;
        const reached = this.flyTo(this.swoopEnd, SWOOP_CLIMB_SPEED, 2);
        this.faceMovement(5, dt);
        if (this.stateTime < 0.35) this.checkSwoopHit();
        if (reached || this.stateTime > 2.2 || this.moveResult.hitWall) {
          this.accel = 9;
          this.hurtSinceSwoop = 0;
          this.flyTime = Math.min(this.flyTime, this.perchAfter - 3);
          this.rollCooldown(1.0, 1.8);
          this.setState('hover');
        }
        break;
      }
      case 'toPerch': {
        // 先在落点上方 2.5 米处飞过去，到了再往下落；张翅刹车
        const p = this.perchPoint;
        const dxz = Math.hypot(p.x - this.position.x, p.z - this.position.z);
        this.flyTargetY = dxz > 1.2 ? Math.max(p.y + 2.5, Math.min(this.position.y, p.y + 6)) : p.y;
        this.flyTo(p, dxz > 4 ? this.speed : Math.max(1.2, dxz * 1.5), 0.15);
        if (dxz > 1.5) this.faceMovement(4, dt);
        else this.facePlayer(3, dt);
        if (dxz <= 0.4 && Math.abs(this.position.y - p.y) < 0.12) {
          this.stopMoving();
          this.hurtWhilePerched = 0;
          this.preenTimer = 0.6;
          this.setState('perched');
          _c.set(p.x, p.y + 0.05, p.z);
          this.ctx.fx.burst(_c, 0xf4faff, 10, 2.2, 0.5, 0.1, 3);
        } else if (this.stateTime > 7) {
          this.flyTime = 0;
          this.setState('hover');
        }
        break;
      }
      case 'perched': {
        this.stopMoving();
        this.flyTargetY = this.perchPoint.y;
        this.velocity.x = this.velocity.z = 0;
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.1;
        const startled = this.hurtWhilePerched >= PERCH_STARTLE_HP * this.maxHp
          || (this.distToPlayerXZ() < PERCH_STARTLE_RANGE * this.sizeScale && this.verticalReach(2.5));
        if (this.stateTime >= PERCH_TIME || startled) {
          this.setState('takeoff');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.4, pitch: 2 });
          this.ctx.fx.burst(this.position, 0xf4faff, 12, 3, 0.5, 0.1, 3);
        }
        break;
      }
      case 'takeoff': {
        this.flyTargetY = this.perchPoint.y + 3;
        this.stopMoving();
        this.facePlayer(3, dt);
        if (this.stateTime >= TAKEOFF_TIME) {
          this.flyTime = 0;
          this.perchAfter = this.ctx.rng.range(PERCH_AFTER[0], PERCH_AFTER[1]);
          this.rollCooldown(0.4, 1.0);
          this.setState('hover');
        }
        break;
      }
      default:
        this.setState('hover');
    }
  }

  /** 直线飞向目标（只管水平；高度由 flyTargetY 追） */
  private flyTo(target: THREE.Vector3, speed: number, arrive: number): boolean {
    const dx = target.x - this.position.x, dz = target.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) return true;
    this.setMove(dx, dz, speed);
    return false;
  }

  /** 盘旋高度：随玩家所在高度抬升，看不到玩家时再高一些，撞到障碍临时爬升，带缓慢起伏 */
  private updateAltitude(dt: number): void {
    const floor = this.ctx.stage.arena?.floorY ?? 0;
    const pl = this.ctx.player.position;
    if (this.moveResult.hitWall) this.climb = 1.2;
    else this.climb = Math.max(0, this.climb - dt);
    let y = Math.max(floor + this.altitude, pl.y + this.altitude * 0.8);
    if (this.blindTime > 0.6) y += 1.5;
    if (this.climb > 0) y += 2.5;
    this.flyTargetY = y + Math.sin(this.age * 0.9 + this.bobPhase) * 0.4;
  }

  /** 冰羽扇射：从两翼与胸前射出 5 根冰羽，在玩家处排成一道横排 */
  private fireFeathers(): void {
    const pl = this.ctx.player;
    this.playerChest(_p);
    this.getMuzzle(_c);
    const t = _c.distanceTo(_p) / FEATHER_SPEED;
    _p.addScaledVector(pl.velocity, t * FEATHER_LEAD);
    // 横排方向：水平面内垂直于视线
    _side.set(_p.z - _c.z, 0, -(_p.x - _c.x));
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    const origins = this.featherOrigins();
    for (let i = 0; i < FEATHERS; i++) {
      const k = i - (FEATHERS - 1) / 2;
      _q.copy(_p).addScaledVector(_side, -k * FEATHER_SPACING);
      this.shoot({
        speed: FEATHER_SPEED, damage: this.def.damage, radius: 0.2, color: 0xbfeeff, visual: 'shard', scale: 1.6,
        lifetime: 3.2, from: origins[i], target: _q,
      });
    }
    iceShatter(this.ctx, _c, 0.5);
  }

  /** 冰羽的出射点（世界坐标）：左翼尖、左翼中、胸前霜晶、右翼中、右翼尖。左 = 生物左侧，横排的 k 为负一侧 */
  private featherOrigins(): THREE.Vector3[] {
    return this.featherAnchors.map((a) => a.getWorldPosition(new THREE.Vector3()));
  }

  private startScreech(): boolean {
    const pl = this.ctx.player.position;
    // 掠过点：玩家身侧 1.6 米、胸口高度；终点：玩家另一侧 16 米外的高处
    _p.set(pl.x - this.position.x, 0, pl.z - this.position.z);
    const d = _p.length();
    if (d < 1e-3) return false;
    _p.multiplyScalar(1 / d);
    _side.set(_p.z, 0, -_p.x).multiplyScalar(this.strafeSign);
    this.swoopLow.set(pl.x + _side.x * SWOOP_SIDE, pl.y + 0.25, pl.z + _side.z * SWOOP_SIDE);
    this.swoopEnd.set(pl.x + _p.x * SWOOP_FAR, 0, pl.z + _p.z * SWOOP_FAR);
    const floor = this.ctx.stage.arena?.floorY ?? 0;
    this.swoopEnd.y = Math.max(floor + this.altitude, pl.y + this.altitude * 0.8);
    if (!this.ctx.nav.isWalkable(this.swoopEnd.x, this.swoopEnd.z)) {
      // 另一侧出界：拉升回自己这一侧
      this.swoopEnd.set(pl.x - _p.x * SWOOP_FAR * 0.8, this.swoopEnd.y, pl.z - _p.z * SWOOP_FAR * 0.8);
    }
    this.releaseAttack();
    this.setState('screech');
    this.ctx.audio.play('telegraph', { position: this.position, volume: 1, pitch: 2.2 });
    const eta = SCREECH_TIME + Math.hypot(this.swoopLow.x - this.position.x, this.swoopLow.z - this.position.z) / SWOOP_SPEED;
    _c.set(this.swoopLow.x, pl.y, this.swoopLow.z);
    this.swoopWarning = this.ctx.fx.groundWarning(_c, SWOOP_HIT_RANGE, eta, 0x1a8cff);  // 饱和蓝：浅青色在冰面上看不见
    return true;
  }

  /** 俯冲擦中：身体中心离玩家胸口 1.7 米内，一次 */
  private checkSwoopHit(): void {
    if (this.swoopHit) return;
    const pl = this.ctx.player;
    this.getBodyCenter(_c);
    this.playerChest(_p);
    if (_c.distanceTo(_p) > SWOOP_HIT_RANGE * this.sizeScale * 0.85) return;
    this.swoopHit = true;
    this.ctx.combat.damagePlayer(SWOOP_DAMAGE * this.damageMult, 'none', this, _c);
    _q.set(this.velocity.x, 0, this.velocity.z);
    if (_q.lengthSq() > 1e-4) _q.normalize().multiplyScalar(6);
    _q.y = 3;
    if (pl.alive && pl.invulnerableTime <= 0) pl.applyImpulse(_q);
    this.ctx.fx.shake(0.4, 0.25);
    iceShatter(this.ctx, _p, 0.6);
  }

  /**
   * 歇脚点：玩家 6–22 米内、顶面高 1.4–7 米、顶上有落脚空间且看得到玩家的柱顶 / 高台（取离玩家最近的边上一点）；
   * 都没有就在玩家 9–16 米外找一块看得到玩家的空地。
   */
  private findPerch(out: THREE.Vector3): boolean {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const floor = ctx.stage.arena?.floorY ?? 0;
    let best = Infinity, found = false;
    const boxes = ctx.world.query(pl.x - 22, pl.z - 22, pl.x + 22, pl.z + 22);
    for (const b of boxes) {
      if (b.noRaycast) continue;
      const top = b.maxY;
      if (top < floor + 1.4 || top > floor + 7) continue;
      if (b.maxX - b.minX < 0.7 || b.maxZ - b.minZ < 0.7) continue;
      const x = THREE.MathUtils.clamp(pl.x, b.minX + 0.35, b.maxX - 0.35);
      const z = THREE.MathUtils.clamp(pl.z, b.minZ + 0.35, b.maxZ - 0.35);
      const d = Math.hypot(x - pl.x, z - pl.z);
      if (d < 6 || d > 22) continue;
      if (ctx.world.groundHeight(x, z, top + 0.1) < top - 0.05) continue;
      if (ctx.world.overlaps(x - 0.35, top + 0.1, z - 0.35, x + 0.35, top + 2.2, z + 0.35)) continue;
      _c.set(x, top + 1.2, z);
      if (ctx.world.segmentBlocked(_c, ctx.player.eye)) continue;
      const score = Math.abs(d - 13) + ctx.rng.range(0, 3);
      if (score < best) {
        best = score;
        out.set(x, top, z);
        found = true;
      }
    }
    if (found) return true;
    for (let i = 0; i < 6; i++) {
      if (!ctx.nav.randomWalkable(pl, 9, 16, _p)) continue;
      const gy = ctx.world.groundHeight(_p.x, _p.z, Math.max(pl.y, floor) + 3);
      if (!Number.isFinite(gy)) continue;
      _c.set(_p.x, gy + 1.2, _p.z);
      if (ctx.world.segmentBlocked(_c, ctx.player.eye)) continue;
      out.set(_p.x, gy, _p.z);
      return true;
    }
    return false;
  }

  protected override cancelAttack(): void {
    const warn = this.swoopWarning;
    this.swoopWarning = null;
    warn?.();
    this.glowTarget[1] = 0;
    if (this.alive && (this.state === 'volley' || this.state === 'recover' || this.state === 'screech' || this.state === 'swoopDown' || this.state === 'swoopUp')) {
      this.accel = 9;
      this.setState('hover');
      this.rollCooldown(0.8, 1.6);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.getBodyCenter(_c);
    iceShatter(this.ctx, _c, 0.9 * this.sizeScale);
  }

  protected override animateDeath(t: number): void {
    // 中弹坠落：翻滚着往下掉，最后缩没
    this.model.rotation.x = -t * 2.2;
    this.model.rotation.z = t * 3.1;
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25)));
  }

  // ───────────── 姿态 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const perched = st === 'perched';
    const landing = st === 'toPerch' && Math.hypot(this.perchPoint.x - this.position.x, this.perchPoint.z - this.position.z) < 2.5;
    const swoop = st === 'swoopDown' || st === 'swoopUp';
    const volleyT = st === 'volley' ? clamp01(this.stateTime / this.volleyTime) : 0;
    const release = st === 'recover' ? clamp01(1 - this.stateTime / 0.3) : 0;
    const screech = st === 'screech' ? 1 : 0;
    const takeoff = st === 'takeoff' ? 1 : 0;

    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const sn = Math.sin(this.facing), cs = Math.cos(this.facing);
    const fwd = this.velocity.x * sn + this.velocity.z * cs;
    const lat = this.velocity.x * cs - this.velocity.z * sn;

    // 拍翅：频率 / 幅度按状态；俯冲时几乎不拍（滑翔），歇脚时停
    let freq = 2.2, amp = 0.55;
    if (swoop) { freq = 1.2; amp = 0.1; }
    if (landing) { freq = 3.0; amp = 0.75; }
    if (takeoff) { freq = 3.4; amp = 0.85; }
    if (screech) { freq = 4; amp = 0.25; }
    if (volleyT > 0) { freq = 1.4; amp = 0.15; }
    if (perched) { freq = 0; amp = 0; }
    if (!this.alive) { freq = 5; amp = 0.4; }
    this.flapPhase += dt * freq * Math.PI * 2;
    const p = this.pose$;
    p.amp = this.sAmp.step(amp, dt);
    p.phase = this.flapPhase;
    p.flap = p.amp * Math.sin(this.flapPhase) + 0.1 * (1 - (perched ? 1 : 0));
    // 扇射前摇：双翅上扬后收；出手瞬间猛地下扑前送
    p.raise = this.sRaise.step(0.75 * volleyT + 0.55 * screech - 0.85 * release, dt);
    p.sweep = this.sSweep.step(0.5 * volleyT - 0.35 * release + (swoop ? 0.85 : 0) + 0.15 * clamp01(fwd / 8), dt);
    p.fold = this.sFold.step(perched ? 1 : 0, dt);
    // 身体：悬停半立（前倾 0.35），往前飞时更平，俯冲时顺着速度放平；歇脚时直立；尖啸后仰
    const descent = swoop ? Math.atan2(-this.velocity.y, Math.max(1, sp)) : 0;
    const pitchT = perched ? 0.12 : swoop ? 0.95 + 0.3 * descent : 0.35 + 0.3 * clamp01(fwd / 6) - 0.35 * screech - 0.2 * volleyT + 0.15 * release
      - (landing ? 0.25 : 0) - this.hurtKick * 0.4;
    p.pitch = this.sPitch.step(THREE.MathUtils.clamp(pitchT, -0.3, 1.3), dt);
    // 下扑时身体被托起一下
    p.lift = perched ? 0 : -0.035 * p.amp * Math.cos(this.flapPhase);
    p.bank = this.sBank.step(THREE.MathUtils.clamp(-lat * 0.07, -0.5, 0.5) + (this.stunTime > 0 ? Math.sin(this.age * 8) * 0.3 : 0), dt);
    // 头：盯住玩家（偏航限幅），抵消身体前倾保持水平，向下看玩家；歇脚时理羽
    const pl = this.ctx.player.position;
    const yawTo = Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
    let headYaw = THREE.MathUtils.clamp(angleDiff(this.facing, yawTo), -0.9, 0.9);
    const dy = pl.y + 1 - (this.position.y + 1.2 * this.sizeScale);
    let headPitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.max(1, this.distToPlayerXZ())), -0.4, 0.8) * 0.7 - p.pitch * 0.75 - 0.5 * screech;
    if (perched) {
      this.preenTimer -= dt;
      if (this.preenTimer <= 0) {
        this.preenTimer = this.ctx.rng.range(0.9, 1.6);
        this.preenSide = -this.preenSide;
      }
      const preen = clamp01(Math.sin(clamp01(1 - this.preenTimer / 0.9) * Math.PI) * 1.2);
      headYaw = headYaw * (1 - preen) + this.preenSide * 1.3 * preen;
      headPitch = headPitch * (1 - preen) + 0.55 * preen;
    }
    p.headYaw = damp(p.headYaw, headYaw, 10, dt);
    p.headPitch = damp(p.headPitch, headPitch, 10, dt);
    p.tuck = this.sTuck.step(perched || landing ? 0 : 1, dt);
    // 尾羽（绑定姿势里向下后方垂着，约低于水平 68°）：绕 X 正转 = 往后上方甩。飞行时身体前倾已把它带到身后，
    // 再往后抬一点；俯冲时拉直；歇脚时几乎水平地搭在身后（不插进柱顶）；刹车 / 尖啸 / 落脚时展开成扇
    p.tailLift = swoop ? 0.15 : perched ? 1.3 : landing ? 0.6 : 0.25;
    // 飞得很低（起飞、贴地俯冲）时尾羽往后上方收起，不插进地面；落脚 / 歇脚有自己的姿势
    if (!perched && !landing && this.alive) {
      const floor = this.ctx.stage.arena?.floorY ?? 0;
      const k = this.sizeScale;
      const low = clamp01((TAIL_CLEAR * k - (this.position.y - floor)) / (0.8 * k));
      p.tailLift = Math.max(p.tailLift, TAIL_TUCK * low);
    }
    p.tailFan = this.sFan.step(landing || screech || takeoff ? 1 : perched ? 0.5 : 0.15, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody.pose, p, dt, fwd);
    else this.poseBlockout(p, dt, fwd);

    // 冰光：霜晶常亮随呼吸起伏、前摇更亮；羽刃在扇射前摇时亮起
    FROST_FX_TIME.value = this.ctx.time.now;
    const breathe = 0.85 + 0.15 * Math.sin(this.age * 2.4);
    const alive = this.alive ? 1 : 0.2;
    if (this.glow) {
      this.glow.strength[0].value = (0.9 + 0.9 * this.glowLevel[0]) * breathe * alive;
      this.glow.strength[1].value = (0.12 + 1.6 * this.glowLevel[1] + 0.3 * screech) * alive;
      this.glow.strength[2].value = (0.15 + 0.3 * screech) * alive;
    }
    for (const g of this.tipGlows) g.visible = this.glowLevel[1] > 0.02 || screech > 0;
  }

  /** 尾羽弹簧：目标角 = 整体抬起 + 随速度往后飘 + 慢波；每节滞后上一节 */
  private tailAngles(plume: number, seg: number, p: BirdPose, dt: number, fwd: number): { pitch: number; yaw: number } {
    const s = this.tailSprings[plume][seg];
    const wave = Math.sin(this.age * 2.2 - seg * 0.8 + plume * 1.3) * (0.06 + 0.04 * seg);
    const drag = clamp01(Math.abs(fwd) / 10) * 0.12 * (seg + 1);
    const pitch = s.p.step((seg === 0 ? 0 : -0.1 * p.flap) + wave + drag + (seg === 0 ? 0 : 0.08), dt);
    const yaw = s.y.step(Math.sin(this.age * 1.6 - seg * 0.9 + plume) * 0.05 - p.bank * 0.2, dt);
    return { pitch, yaw };
  }

  /**
   * 美术骨骼动画：hips 前倾托起；双翼三节拍动（下扑前臂和掌依次滞后、上扬时半收后掠）；颈部抵消前倾、头盯住玩家；
   * 腿飞行时向后收、爪握起；尾羽三条弹簧链；歇脚时收翅、尾羽搭在身后。
   */
  private poseNative(P: NativePose, p: BirdPose, dt: number, fwd: number): void {
    P.reset();
    P.translate('hips', 0, p.lift, 0);
    P.rotate('hips', AX, p.pitch);
    P.rotate('hips', AZ, p.bank);
    const up = Math.max(0, Math.cos(p.phase)) * p.amp;
    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R';
      const flap = p.flap + p.raise;
      // 收翅：肱骨下垂后掠，前臂前折，掌部后折贴住身体
      P.rotate(`wing_1_${side}`, AZ, s * (flap - p.fold * 1.0));
      P.rotate(`wing_1_${side}`, AY, s * (p.sweep * 0.7 + up * 0.25 + p.fold * 0.7));
      P.rotate(`wing_2_${side}`, AZ, s * (p.amp * 0.45 * Math.sin(p.phase - 0.7) + p.raise * 0.3));
      P.rotate(`wing_2_${side}`, AY, s * (p.sweep * 0.45 + up * 0.35 - p.fold * 1.0));
      P.rotate(`wing_3_${side}`, AZ, s * (p.amp * 0.35 * Math.sin(p.phase - 1.3) + p.raise * 0.2));
      P.rotate(`wing_3_${side}`, AY, s * (p.sweep * 0.3 + up * 0.25 + p.fold * 0.9));
      // 腿：飞行时向后收、爪握起；站立时伸直
      P.rotate(`thigh_${side}`, AX, 0.95 * p.tuck);
      P.rotate(`shin_${side}`, AX, -0.5 * p.tuck);
      P.rotate(`foot_${side}`, AX, 0.7 * p.tuck);
    }
    P.rotate('neck', AX, p.headPitch * 0.5);
    P.rotate('neck', AY, p.headYaw * 0.4);
    P.rotate('head', AX, p.headPitch * 0.5);
    P.rotate('head', AY, p.headYaw * 0.6);
    P.rotate('tail_0', AX, p.tailLift);
    for (let i = 0; i < PLUMES.length; i++) {
      const fan = (i === 0 ? 1 : i === 2 ? -1 : 0) * p.tailFan * 0.35;
      for (let k = 0; k < 3; k++) {
        const b = `tail_${PLUMES[i]}${k + 1}`;
        const a = this.tailAngles(i, k, p, dt, fwd);
        P.rotate(b, AX, a.pitch);
        P.rotate(b, AY, a.yaw);
        if (k === 0 && fan !== 0) P.rotate(b, AZ, fan);
      }
    }
  }

  private poseBlockout(p: BirdPose, dt: number, fwd: number): void {
    this.pitchJoint.position.y = 0.3 + p.lift;
    this.pitchJoint.rotation.set(p.pitch, 0, p.bank);
    const up = Math.max(0, Math.cos(p.phase)) * p.amp;
    for (const w of this.wingJoints) {
      const s = w.s;
      w.seg[0].rotation.set(0, s * (p.sweep * 0.7 + up * 0.25 + p.fold * 0.7), s * (p.flap + p.raise - p.fold * 1.0));
      w.seg[1].rotation.set(0, s * (p.sweep * 0.45 + up * 0.35 - p.fold * 1.0), s * (p.amp * 0.45 * Math.sin(p.phase - 0.7) + p.raise * 0.3));
      w.seg[2].rotation.set(0, s * (p.sweep * 0.3 + up * 0.25 + p.fold * 0.9), s * (p.amp * 0.35 * Math.sin(p.phase - 1.3) + p.raise * 0.2));
    }
    for (const l of this.legJoints) l.rotation.x = 0.95 * p.tuck;
    this.neckJoint.rotation.set(p.headPitch * 0.5, p.headYaw * 0.4, 0);
    this.headJoint.rotation.set(p.headPitch * 0.5, p.headYaw * 0.6, 0);
    for (let i = 0; i < this.plumeJoints.length; i++) {
      const chain = this.plumeJoints[i];
      const fan = (i === 0 ? 1 : i === 2 ? -1 : 0);
      for (let k = 0; k < chain.length; k++) {
        const a = this.tailAngles(i, k, p, dt, fwd);
        if (k === 0) chain[k].rotation.set(0.35 + p.tailLift + a.pitch, a.yaw, fan * (0.18 + p.tailFan * 0.35));
        else chain[k].rotation.set(a.pitch, a.yaw, 0);
      }
    }
  }
}
