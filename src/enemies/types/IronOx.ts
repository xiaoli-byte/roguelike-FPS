/**
 * 熔炉铁牛（iron_ox，第三章 · 祝融火狱的坦克，炉宫）：照唐代镇河铁牛铸的炉牛，祝融的工坊里铸出来、肚子里烧着一座活炉。
 * 全身铆接的玄铁甲板、牛角上缠着铁链，两肋是褶皱的铁风箱，胸口一扇青铜兽面炉门（单独建模、铰链在门顶，见
 * art/tools/cut_furnace_door.py：胸腔里挖了炉膛凹腔）。格挡靠铸铁身体本身，不持盾。
 * 用户要求坦克「有压迫感」：美术按肩高约 2.2 米（头顶 2.4 米）、长 2.6 米制作，游戏里放大 1.4 倍（约 3.4 米高），
 * 血厚甲厚、不吃击退（docs/art/enemy-roster-v2.md「熔炉铁牛 · 鼓风与呛火」）。
 *
 * 和前两章的坦克相反：弱点在**正面**，而且只在它最危险的时候打开。
 * - 铁蹄推进：低头慢走（2.4 米/秒），每一步都震屏，铁蹄留下发红的蹄印（1 秒冷却）；挤开挡路的小怪。
 *   铁甲到处只吃 20% 伤害（甲上迸火星、铁响），炉门关着时也一样。
 * - 鼓风吸气：6–16 米、看得见玩家、冷却 10 秒：仰头，两侧风箱鼓起 1.6 秒，风往嘴里灌，把玩家一阵阵往它那边拉
 *   （约每秒 2.5 米，掩体挡得住风）；胸口炉门打开、炉膛白热，地上亮出接下来熔铁喷吐的扇形预警（品红，越来越满）。
 *   **炉门是弱点（×3）**：站在正面，顶着吸力往炉膛里打。
 * - 呛火：吸气期间炉门累计吃到最大生命 8% 的伤害：炉膛回火爆炸，铁牛前腿一软跪倒 2.5 秒，风箱喷黑烟，炉门敞开（×3）——
 *   **最好的输出窗口**；这次吸气作废，不喷。
 * - 熔铁喷吐：吸气没被打断：低头 0.45 秒，喷出 12 米、60° 的熔铁扇面（火伤，掩体挡得住）；落地的熔铁冷成两排矮铁渣墙
 *   （真碰撞，挡路、挡子弹，也能当掩体），6 秒后碎掉。
 * - 顶角掀地：贴身 4 米内、正对：低头 0.5 秒（前方扇形预警），牛角往上一挑，掀起前方的地面铁板，把人挑飞。
 * - 精英：吸气更久（2.2 秒）、吸力更强，喷吐后紧接一次顶角。
 *
 * 状态机：advance → inhale → (choke | spitWindup → spit) → advance（精英：spit → tossWindup）
 *         advance → tossWindup → toss → advance
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, raySphere, rayVerticalCapsule, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import {
  INFERNO, SlagWall, createFurnaceCore, hoofPrint, moltenArc, moltenSplash, smokePuff, streak, type FurnaceCore,
} from '../fx/InfernoTankFx';

export const IRON_OX_DEF: ScaledEnemyDef = {
  id: 'iron_ox',
  name: '熔炉铁牛',
  hp: 700,
  armor: 260,
  speed: 2.4,
  radius: 0.95,
  height: 2.3,
  damage: 40,
  coins: [9, 13],
  essence: 3,
  // 弱点 = 胸口炉门 / 炉膛（模型单位，炉门中心离地约 0.84）；身体命中盒另算（见 raycastHit）
  headY: 0.84,
  headRadius: 0.2,
  knockbackResist: 1,
  color: 0xff6a1a,
  // 美术按 2.4 米（头顶）制作，游戏里放大到约 3.4 米：命中盒、弱点、特效一起放大
  scale: 1.4,
};

/** 铁甲减伤：炉门敞开时打进炉膛 ×3，其余（含关着的炉门）一律 ×0.2；持续伤害（状态）不受铁甲影响 */
const IRON_FACTOR = 0.2;
const DOOR_FACTOR = 3;
/** 炉门判定球半径（模型单位）：关着时小，敞开时罩住整个炉口 */
const DOOR_R_CLOSED = 0.2;
const DOOR_R_OPEN = 0.36;
/** 推进转身角速度（弧度/秒）、推进停步距离（米） */
const TURN_RATE = 1.0;
const STOP_DIST = 3.2;
/** 鼓风吸气：触发距离（米）、时长、冷却、吸力脉冲间隔与每次冲量、吸气范围、呛火阈值（最大生命比例） */
const INHALE_RANGE = [6, 16] as const;
const INHALE_TIME = 1.6;
const INHALE_TIME_ELITE = 2.2;
const INHALE_COOLDOWN = [9.5, 11] as const;
const INHALE_FIRST_CD = [2.5, 4] as const;
const PULL_GAP = 0.18;
const PULL_IMPULSE = 2.4;
const PULL_IMPULSE_ELITE = 3.3;
const PULL_RANGE = 20;
const CHOKE_FRACTION = 0.08;
const CHOKE_TIME = 2.5;
/** 熔铁喷吐：低头前摇、扇面射程（米）与半角、伤害倍率、喷吐持续 */
const SPIT_WINDUP = 0.45;
const SPIT_RANGE = 12;
const SPIT_HALF = Math.PI / 6;
const SPIT_MULT = 1.3;
const SPIT_TIME = 0.9;
/** 熔铁落地时刻（秒，自喷吐起）：铁渣墙在这一刻立起来 */
const SLAG_AT = 0.35;
/** 铁渣墙：两排（离铁牛 5.5 米两段、9 米三段），每段长度（米） */
const SLAG_ROWS: readonly { d: number; lat: readonly number[] }[] = [
  { d: 5.5, lat: [-1.7, 1.7] },
  { d: 9, lat: [-3.2, 0, 3.2] },
];
const SLAG_LEN = 2.1;
/** 顶角掀地：触发距离（米，中心算）、命中距离、前摇、伤害倍率、上挑 / 前推速度、冷却 */
const TOSS_RANGE = 4.2;
const TOSS_REACH = 4.8;
const TOSS_WINDUP = 0.5;
const TOSS_MULT = 1.2;
const TOSS_UP = 9;
const TOSS_PUSH = 5;
const TOSS_COOLDOWN = [2.4, 3.2] as const;
/** 挤开小怪：血量低于这个的地面敌人被挤开 */
const SHOVE_HP = 400;
/** 脚步震屏：这个距离（米）内能感觉到 */
const STEP_SHAKE_RANGE = 22;

/** 模型空间（未缩放、three 坐标：X = 生物左侧，Y = 上，Z = 前）里的关键点，按美术网格实测 */
const WEAK_POINT = new THREE.Vector3(0, 0.84, 0.86);
const CORE_POINT = new THREE.Vector3(0, 0.84, 0.72);
const CORE_RADIUS = 0.22;
const MOUTH_POINT = new THREE.Vector3(0, 1.36, 1.3);
const BELLOWS_POINT = new THREE.Vector3(0.6, 1.2, 0.2);

/**
 * 四足步态（美术骨骼）：牛的慢步是四拍的侧对步（左后 → 左前 → 右后 → 右前），触地比例高；
 * 一步里蹄子相对身体最多扫过多远（模型局部单位）、抬蹄高度。
 */
const GAIT_FREQ = 0.75;
const GAIT_DUTY = 0.75;
const GAIT_SWEEP = 0.5;
const GAIT_LIFT = 0.16;
const LEGS = [
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, side: 1, phase: 0 },
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, side: 1, phase: 0.25 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, side: -1, phase: 0.5 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, side: -1, phase: 0.75 },
] as const;
const TAIL = ['tail_1', 'tail_2', 'tail_3'] as const;

const C = {
  iron: 0x3a3430, ironDark: 0x231f1c, rust: 0x6b3a22, bronze: 0xa8743a, horn: 0x5a4636, eye: 0xff7a1a, eyeHot: 0xffe0a0,
  seam: 0xff5a14, seamHot: 0xffd27a,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const AZ = new THREE.Vector3(0, 0, 1);

/** 每个 GameContext 只注册一次全局伤害修正（铁甲 / 炉门） */
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

export class IronOx extends StandardEnemy {
  // 白模骨架（?classic 与资产缺失时的兜底）
  private body!: THREE.Group;
  private head!: THREE.Group;
  private door!: THREE.Group;
  private bellows: THREE.Object3D[] = [];
  private tail: THREE.Group[] = [];
  private legs: Leg[] = [];
  /** 弱点锚点（炉门 / 炉口）、炉心辉光的挂点、嘴（喷吐、吸气的终点） */
  private weakAnchor!: THREE.Object3D;
  private coreAnchor!: THREE.Object3D;
  private mouthAnchor!: THREE.Object3D;
  private core: FurnaceCore | null = null;

  private windTime = SPIT_WINDUP;
  private inhaleCd: number;
  private inhaleTime = INHALE_TIME;
  private pullAcc = 0;
  private streakAcc = 0;
  private spitYaw = 0;
  private slagDone = false;
  private fan: GroundDecal | null = null;
  private sector: GroundDecal | null = null;
  private blockFxAt = 0;
  private alerted = false;
  /** 这次吸气期间炉门吃到的伤害 */
  doorDamage = 0;
  /** 最近一次喷吐 / 顶角是否打中了玩家（测试与调试用） */
  struck = false;
  /** 本次喷吐立起的铁渣墙（测试与调试用） */
  readonly walls: SlagWall[] = [];
  // 平滑后的姿态：炉门开度、仰头、风箱、跪倒、低头（顶角 / 喷吐）、上挑
  private pDoor = 0;
  private pRaise = 0;
  private pBellows = 0;
  private pKneel = 0;
  private pLow = 0;
  private pFlick = 0;
  private gait = 0;
  private readonly legU = [0, 0, 0, 0];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, IRON_OX_DEF, opts);
    this.walkScale = 0.3;
    this.stepRate = 0.8;
    this.inhaleCd = ctx.rng.range(INHALE_FIRST_CD[0], INHALE_FIRST_CD[1]);
    installGuard(ctx);
  }

  /** 炉门敞开（吸气后段、呛火跪倒）：打进炉膛 ×3 */
  get doorOpen(): boolean {
    return this.alive && (this.state === 'choke' || (this.state === 'inhale' && this.stateTime >= 0.25));
  }

  /** 这次伤害的倍率：炉门敞开时打进炉膛 ×3；其余铁甲 ×0.2（迸火星、铁响） */
  armourFactor(req: DamageRequest): number {
    if (req.source === 'status' || !this.alive) return 1;
    if (req.headshot && this.doorOpen) return DOOR_FACTOR;
    const now = this.ctx.time.now;
    if (now - this.blockFxAt > 0.07) {
      this.blockFxAt = now;
      if (req.point) _p.copy(req.point);
      else this.localPoint((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, 1.0, _p);
      this.ctx.fx.burst(_p, INFERNO.ember, 5, 5, 0.25, 0.05 * this.sizeScale, 9);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.3, pitch: 1.7 });
    }
    return IRON_FACTOR;
  }

  /** 身体命中盒：竖直胶囊从脚到背（头部判定挂在胸口的炉门上，比背低得多，不能用基类按头高算的胶囊） */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    this.getHeadCenter(_v);
    const th = raySphere(origin, dir, _v, this.headRadius);
    const r = this.radius;
    const tb = rayVerticalCapsule(origin, dir, this.position.x, this.position.z, this.position.y + r, this.position.y + Math.max(r, this.height - r), r);
    let best = -1, head = false;
    if (th >= 0 && th <= maxDist) {
      best = th;
      head = true;
    }
    if (tb >= 0 && tb <= maxDist && (best < 0 || tb < best - this.headRadius * 0.5)) {
      best = tb;
      head = false;
    }
    if (best < 0) return false;
    out.distance = best;
    out.headshot = head;
    return true;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const iron = flat(C.iron, { rough: 0.6, metal: 0.5 }), dark = flat(C.ironDark, { rough: 0.7, metal: 0.4 });
    const bronze = flat(C.bronze, { rough: 0.45, metal: 0.6 }), horn = flat(C.horn, { rough: 0.6 });
    // 身体：高耸的肩峰、厚甲躯干（身体中心离地约 1.4）
    const body = joint(root, 0, 1.4, 0);
    this.body = body;
    part(body, Geo.box(1.25, 1.0, 2.2), iron, 0, 0, -0.05);
    part(body, Geo.box(1.15, 0.5, 1.0), iron, 0, 0.6, 0.35);
    part(body, Geo.box(1.05, 0.35, 1.6), dark, 0, -0.55, 0);
    for (const s of [1, -1]) {
      // 两肋的风箱格栅
      const b = joint(body, s * 0.6, -0.15, -0.1);
      for (let i = 0; i < 6; i++) this.glowPart(b, Geo.box(0.08, 0.8, 0.08), C.seam, C.seamHot, 0, 0, -0.3 + i * 0.12, 1);
      part(b, Geo.box(0.06, 0.9, 0.8), dark, -s * 0.03, 0, 0);
      this.bellows.push(b);
    }
    // 胸口的炉门：铰链在门顶，门板是一块青铜圆盘；后面是发光的炉口
    this.glowPart(body, Geo.cyl(0.3, 0.3, 0.05, 14), C.seam, C.seamHot, 0, -0.56, 0.98, 1).rotation.x = Math.PI / 2;
    const door = joint(body, 0, -0.27, 1.06);
    part(door, Geo.cyl(0.34, 0.34, 0.08, 14), bronze, 0, -0.3, 0).rotation.x = Math.PI / 2;
    this.door = door;
    this.weakAnchor = joint(body, WEAK_POINT.x, WEAK_POINT.y - 1.4, WEAK_POINT.z);
    this.coreAnchor = joint(body, CORE_POINT.x, CORE_POINT.y - 1.4, CORE_POINT.z + 0.28);
    // 头：宽低的牛头，短粗前弯的牛角，眼和鼻孔发光
    const head = joint(body, 0, 0.1, 1.15);
    this.head = head;
    part(head, Geo.box(0.7, 0.62, 0.62), iron, 0, 0, 0.2);
    for (const s of [1, -1]) {
      part(head, Geo.cone(0.1, 0.55, 6), horn, s * 0.45, 0.32, 0.15, 0.4, 0, -s * 1.1);
      this.glowPart(head, Geo.ico(0.06, 1), C.eye, C.eyeHot, s * 0.22, 0.12, 0.52);
    }
    this.mouthAnchor = joint(head, 0, -0.1, 0.55);
    // 四条粗腿 + 大蹄
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(body, s * 0.42, -0.3, front ? 0.7 : -0.75);
        part(upper, Geo.cyl(0.24, 0.2, 0.6, 8, 'top'), iron, 0, 0, 0);
        const lower = joint(upper, 0, -0.6, 0);
        part(lower, Geo.cyl(0.18, 0.2, 0.42, 8, 'top'), iron, 0, 0, 0);
        part(lower, Geo.box(0.32, 0.12, 0.36), dark, 0, -0.44, 0.04);
        this.legs.push({ upper, lower, front, side: s });
      }
    }
    // 尾巴：三节下垂，尾穗是一团铁焰
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, i === 0 ? 0.3 : -0.32, i === 0 ? -1.1 : 0);
      part(seg, Geo.cyl(0.05, 0.06, 0.34, 5), dark, 0, -0.16, 0);
      this.tail.push(seg);
      parent = seg;
    }
    part(parent, Geo.cone(0.1, 0.3, 5), flat(C.rust), 0, -0.4, 0, Math.PI, 0, 0);
    this.setHeadAnchor(this.weakAnchor, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    let coreParent: THREE.Object3D = this.coreAnchor;
    if (n) {
      const chest = n.pose.bone('chest');
      const head = n.pose.bone('head');
      if (chest) {
        this.weakAnchor = this.anchorOn(chest, WEAK_POINT);
        this.setHeadAnchor(this.weakAnchor, 0, 0, 0);
        coreParent = this.coreAnchor = this.anchorOn(chest, CORE_POINT);
      }
      if (head) this.mouthAnchor = this.anchorOn(head, MOUTH_POINT);
      // 炉门发光壳：熔岩橙（吸气时炉门烧得发白）
      n.glowShell?.color.setHex(0xffa040);
      // 白模的发光件按方块摆，对不上美术（美术贴图自带接缝、眼、鼻孔的熔岩光）：收起
      this.body.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = false;
      });
    }
    // 炉心：挂在 chest 骨（或白模身体）上，朝前，开门时白热
    const core = createFurnaceCore();
    coreParent.add(core.group);
    const ps = coreParent.getWorldScale(_v).x;
    const hs = host.getWorldScale(_f).x;
    core.group.scale.setScalar((CORE_RADIUS * hs) / Math.max(1e-6, ps));
    core.set(0);
    this.core = core;
  }

  /** 在骨骼下建一个锚点，位置按模型空间给（换算到骨骼局部，骨骼的缩放各不相同） */
  private anchorOn(bone: THREE.Object3D, hostPoint: THREE.Vector3): THREE.Object3D {
    const host = this.model.children[0];
    const a = new THREE.Object3D();
    bone.add(a);
    a.position.copy(bone.worldToLocal(host.localToWorld(hostPoint.clone())));
    return a;
  }

  protected override cancelAttack(): void {
    this.hideWarnings();
    this.releaseAttack();
    if (this.state === 'choke') return;
    if (this.state !== 'advance' && this.state !== 'idle') {
      this.setState('advance');
      this.accel = 14;
      this.inhaleCd = Math.max(this.inhaleCd, 3);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideWarnings();
    this.core?.dispose();
    this.core = null;
  }

  private hideWarnings(): void {
    this.fan?.release();
    this.fan = null;
    this.sector?.release();
    this.sector = null;
  }

  /** 震屏：按离玩家的距离衰减 */
  private quake(strength: number, range: number, dur = 0.3): void {
    const k = clamp01(1 - this.distToPlayerXZ() / range);
    if (k > 0) this.ctx.fx.shake(strength * k, dur);
  }

  private yawToPlayer(): number {
    const pl = this.ctx.player.position;
    return Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
  }

  private groundAt(x: number, z: number): number {
    const gy = this.ctx.world.groundHeight(x, z, this.position.y + 1);
    return Number.isFinite(gy) ? gy : this.position.y;
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    // 吸气时打进炉膛的伤害累计：够了就呛火
    if (this.state === 'inhale' && this.doorOpen && r.request.headshot && r.request.source !== 'status') {
      this.doorDamage += r.dealt;
      if (this.doorDamage >= this.maxHp * CHOKE_FRACTION) this.choke();
    }
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    const yawTo = this.yawToPlayer();
    this.inhaleCd -= dt * this.attackRate;
    if (!this.alerted && this.sees && d < 30) {
      this.alerted = true;
      this.getHeadCenter(_p);
      this.ctx.audio.play('enemy_alert', { position: _p, volume: 0.9, pitch: 0.45 });
    }
    switch (this.state) {
      case 'advance': {
        this.accel = 14;
        this.glowTarget[1] = 0.1;
        this.facing = rotateTowards(this.facing, yawTo, TURN_RATE * dt);
        const fd = this.facingDot();
        if (this.cooldown <= 0 && d <= TOSS_RANGE && fd > 0.6 && this.verticalReach(2) && this.requestAttack('melee', 1.4)) {
          this.beginToss();
          break;
        }
        if (this.inhaleCd <= 0 && d >= INHALE_RANGE[0] && d <= INHALE_RANGE[1] && this.sees && fd > 0.5 && this.verticalReach(3)
          && this.requestAttack('heavy', INHALE_TIME_ELITE + SPIT_WINDUP + SPIT_TIME + 1)) {
          this.beginInhale();
          break;
        }
        if (d > STOP_DIST) this.approachPlayer(this.speed, STOP_DIST);
        else this.stopMoving();
        this.shove();
        break;
      }
      case 'inhale': {
        this.stopMoving();
        this.facing = rotateTowards(this.facing, yawTo, 0.7 * dt);
        const t = clamp01(this.stateTime / this.inhaleTime);
        this.glowTarget[1] = 0.4 + 0.6 * t;
        this.updateFan(t);
        this.pullAcc += dt;
        while (this.pullAcc >= PULL_GAP) {
          this.pullAcc -= PULL_GAP;
          this.pullPlayer();
        }
        this.streakAcc += dt;
        while (this.streakAcc >= 0.06) {
          this.streakAcc -= 0.06;
          this.suctionStreak();
        }
        if (this.stateTime >= this.inhaleTime) this.beginSpit();
        break;
      }
      case 'choke': {
        this.stopMoving();
        if (Math.floor(this.stateTime / 0.2) !== Math.floor((this.stateTime - dt) / 0.2)) {
          for (const s of [1, -1]) smokePuff(this.ctx, this.localPoint(s * BELLOWS_POINT.x, BELLOWS_POINT.y, BELLOWS_POINT.z, _p), this.sizeScale * 0.7, 4);
          this.coreAnchor.getWorldPosition(_p);
          smokePuff(this.ctx, _p, this.sizeScale * 0.5, 3);
        }
        if (this.stateTime >= CHOKE_TIME) {
          this.ctx.audio.play('land', { position: this.position, volume: 0.9, pitch: 0.45 });
          this.quake(0.3, STEP_SHAKE_RANGE, 0.25);
          this.toAdvance();
        }
        break;
      }
      case 'spitWindup': {
        this.stopMoving();
        this.updateFan(1);
        if (this.stateTime >= this.windTime) this.spit();
        break;
      }
      case 'spit': {
        this.stopMoving();
        if (!this.slagDone && this.stateTime >= SLAG_AT) {
          this.slagDone = true;
          this.raiseWalls();
        }
        if (this.stateTime >= SPIT_TIME) {
          // 精英：喷完紧接一次顶角
          if (this.isElite && this.distToPlayerXZ() <= TOSS_RANGE + 2 && this.requestAttack('melee', 1.4)) this.beginToss();
          else this.toAdvance();
        }
        break;
      }
      case 'tossWindup': {
        this.stopMoving();
        this.facing = rotateTowards(this.facing, yawTo, 1.4 * dt);
        this.updateSector(clamp01(this.stateTime / this.windTime));
        if (this.stateTime >= this.windTime) this.toss();
        break;
      }
      case 'toss': {
        this.stopMoving();
        if (this.stateTime >= 0.55) this.toAdvance();
        break;
      }
      default:
        this.setState('advance');
    }
  }

  private toAdvance(): void {
    this.setState('advance');
    this.accel = 14;
    this.hideWarnings();
    this.releaseAttack();
  }

  /** 挤开挡在面前的小怪（铁牛不绕路） */
  private shove(): void {
    const list = this.ctx.enemies?.list;
    if (!list || Math.hypot(this.velocity.x, this.velocity.z) < 0.3) return;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    for (const e of list) {
      if (e === this || !e.alive || e.flying || e.isBoss || e.maxHp >= SHOVE_HP * this.level) continue;
      const dx = e.position.x - this.position.x, dz = e.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > this.radius + e.radius + 0.5 || dist < 1e-3 || dx * fx + dz * fz <= 0) continue;
      const side = dx * fz - dz * fx >= 0 ? 1 : -1;
      _v.set(fz * side * 6 + fx * 2, 1.5, -fx * side * 6 + fz * 2);
      e.knockback(_v);
    }
  }

  // ───────────── 鼓风吸气 / 呛火 ─────────────

  private beginInhale(): void {
    this.setState('inhale');
    this.stopMoving();
    this.inhaleTime = this.isElite ? INHALE_TIME_ELITE : INHALE_TIME;
    this.doorDamage = 0;
    this.pullAcc = 0;
    this.streakAcc = 0;
    this.struck = false;
    this.hideWarnings();
    this.fan = GroundDecal.acquire(this.ctx.stageGroup, INFERNO.warn);
    this.fan.solid = true;
    this.updateFan(0);
    this.getHeadCenter(_p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 1, pitch: 0.45 });
    this.ctx.audio.play('enemy_charge', { position: _p, volume: 0.8, pitch: 0.5 });
  }

  /** 喷吐扇形预警：吸气期间一直亮着（越来越满），提前告诉玩家「不打断就喷这里」 */
  private updateFan(t: number): void {
    if (!this.fan) return;
    const yaw = this.state === 'spitWindup' ? this.spitYaw : this.facing;
    this.fan.circle(this.position.x, this.groundAt(this.position.x, this.position.z), this.position.z, SPIT_RANGE, this.radius, yaw, SPIT_HALF);
    this.fan.fill = t;
    this.fan.opacity = 0.18 + 0.5 * t;
  }

  /** 风往嘴里灌：前方、看得见（掩体挡风）的玩家被一阵阵拉向炉门 */
  private pullPlayer(): void {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const dx = this.position.x - pl.position.x, dz = this.position.z - pl.position.z;
    const d = Math.hypot(dx, dz);
    if (d < this.radius + 1.6 || d > PULL_RANGE) return;
    if ((-dx * Math.sin(this.facing) - dz * Math.cos(this.facing)) / d < 0.3) return;
    this.mouthAnchor.getWorldPosition(_a);
    _b.set(pl.position.x, pl.position.y + 1.2, pl.position.z);
    if (this.ctx.world.segmentBlocked(_a, _b)) return;
    const k = (this.isElite ? PULL_IMPULSE_ELITE : PULL_IMPULSE) * clamp01(1.3 - d / (PULL_RANGE * 1.2));
    pl.applyImpulse(_v.set((dx / d) * k, 0, (dz / d) * k));
  }

  /** 气流线朝嘴汇聚、火星被吸进炉门 */
  private suctionStreak(): void {
    const a = this.facing + (Math.random() - 0.5) * 1.3;
    const r = 4 + Math.random() * 7;
    _a.set(this.position.x + Math.sin(a) * r, this.position.y + 0.6 + Math.random() * 3, this.position.z + Math.cos(a) * r);
    if (Math.random() < 0.55) {
      this.mouthAnchor.getWorldPosition(_b);
      streak(this.ctx, _a, _b, 0xffe6c0, 0.42, 0.035);
    } else {
      this.coreAnchor.getWorldPosition(_b);
      streak(this.ctx, _a, _b, INFERNO.ember, 0.5, 0.05);
    }
  }

  /** 呛火：炉膛回火爆炸，跪倒 2.5 秒，炉门敞开（最好的输出窗口）；这次吸气作废 */
  private choke(): void {
    this.setState('choke');
    this.hideWarnings();
    this.releaseAttack();
    this.stopMoving();
    this.inhaleCd = this.ctx.rng.range(INHALE_COOLDOWN[0], INHALE_COOLDOWN[1]);
    this.coreAnchor.getWorldPosition(_p);
    moltenSplash(this.ctx, _p, this.sizeScale * 1.2, 18);
    smokePuff(this.ctx, _p, this.sizeScale, 10);
    this.ctx.fx.explosion?.(_p, 1.2 * this.sizeScale, INFERNO.lava);
    this.ctx.audio.play('boss_slam', { position: _p, volume: 1, pitch: 0.7 });
    this.ctx.audio.play('boss_roar', { position: _p, volume: 0.7, pitch: 1.6 });
    this.quake(0.5, STEP_SHAKE_RANGE, 0.4);
  }

  // ───────────── 熔铁喷吐 ─────────────

  private beginSpit(): void {
    this.windTime = this.windup(SPIT_WINDUP, 0.35);
    this.setState('spitWindup');
    this.spitYaw = this.facing;
    this.inhaleCd = this.ctx.rng.range(INHALE_COOLDOWN[0], INHALE_COOLDOWN[1]);
    this.mouthAnchor.getWorldPosition(_p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.9, pitch: 0.7 });
  }

  private spit(): void {
    this.setState('spit');
    this.slagDone = false;
    this.walls.length = 0;
    this.hideWarnings();
    this.mouthAnchor.getWorldPosition(_a);
    this.ctx.audio.play('skill_fire', { position: _a, volume: 1, pitch: 0.6 });
    this.quake(0.35, STEP_SHAKE_RANGE, 0.3);
    // 熔铁团：朝两排铁渣墙飞出去（落地时刻 = 立墙时刻）
    const sy = Math.sin(this.spitYaw), cy = Math.cos(this.spitYaw);
    for (const row of SLAG_ROWS) {
      for (const lat of row.lat) {
        for (let k = 0; k < 2; k++) {
          const l = lat + (k - 0.5) * 0.9;
          _b.set(this.position.x + sy * row.d + cy * l, 0, this.position.z + cy * row.d - sy * l);
          _b.y = this.groundAt(_b.x, _b.z) + 0.3;
          moltenArc(this.ctx, _a, _b, SLAG_AT, 0.18 * this.sizeScale, 1.2 + row.d * 0.12);
        }
      }
    }
    // 扇面伤害：12 米、60°，掩体挡得住
    const pl = this.ctx.player;
    const dx = pl.position.x - this.position.x, dz = pl.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (pl.alive && d <= SPIT_RANGE + pl.radius && this.verticalReach(3.5)) {
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - this.spitYaw), Math.cos(Math.atan2(dx, dz) - this.spitYaw)));
      _b.set(pl.position.x, pl.position.y + 1.1, pl.position.z);
      if ((off <= SPIT_HALF || d < this.radius + 1) && !this.ctx.world.segmentBlocked(_a, _b)) {
        this.struck = true;
        this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * SPIT_MULT, 'fire', this, _a);
        moltenSplash(this.ctx, _b, 1, 12);
      }
    }
  }

  /** 熔铁落地，冷成两排矮铁渣墙（墙面朝铁牛） */
  private raiseWalls(): void {
    const sy = Math.sin(this.spitYaw), cy = Math.cos(this.spitYaw);
    _a.set(this.position.x, this.position.y + 0.8, this.position.z);
    for (const row of SLAG_ROWS) {
      for (const lat of row.lat) {
        const x = this.position.x + sy * row.d + cy * lat, z = this.position.z + cy * row.d - sy * lat;
        _b.set(x, this.position.y + 0.8, z);
        if (this.ctx.world.segmentBlocked(_a, _b)) continue;
        const w = new SlagWall(this.ctx, x, this.groundAt(x, z), z, this.spitYaw, SLAG_LEN);
        if (w.boxes.length) this.walls.push(w);
        else w.shatter();
      }
    }
    this.ctx.audio.play('land', { position: _b, volume: 0.8, pitch: 0.6 });
  }

  // ───────────── 顶角掀地 ─────────────

  private beginToss(): void {
    this.windTime = this.windup(TOSS_WINDUP, 0.35);
    this.setState('tossWindup');
    this.stopMoving();
    this.struck = false;
    this.hideWarnings();
    this.sector = GroundDecal.acquire(this.ctx.stageGroup, INFERNO.warn);
    this.sector.solid = true;
    this.updateSector(0);
    this.mouthAnchor.getWorldPosition(_p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.7, pitch: 0.6 });
    smokePuff(this.ctx, _p, this.sizeScale * 0.4, 3);
  }

  private updateSector(t: number): void {
    if (!this.sector) return;
    this.sector.circle(this.position.x, this.groundAt(this.position.x, this.position.z), this.position.z, TOSS_REACH, this.radius * 0.6, this.facing, 0.8);
    this.sector.fill = t;
    this.sector.opacity = 0.3 + 0.5 * t;
  }

  private toss(): void {
    this.setState('toss');
    this.hideWarnings();
    const pl = this.ctx.player;
    this.localPoint(0, 0.2, 2.2, _p);
    _p.y = this.groundAt(_p.x, _p.z) + 0.15;
    // 掀起的地面铁板：一把铁片和火星往上崩
    this.ctx.fx.burst(_p, INFERNO.iron, 14, 7, 0.8, 0.16 * this.sizeScale, 16);
    this.ctx.fx.burst(_p, INFERNO.ember, 10, 6, 0.5, 0.07 * this.sizeScale, 8);
    this.ctx.fx.ring(_p, 2.2, INFERNO.lava, 0.3);
    this.ctx.audio.play('boss_slam', { position: _p, volume: 0.9, pitch: 0.8 });
    this.quake(0.45, STEP_SHAKE_RANGE, 0.3);
    const d = this.distToPlayerXZ();
    if (pl.alive && d <= TOSS_REACH + pl.radius && this.facingDot() > 0.45 && this.verticalReach(2.2)) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * TOSS_MULT, 'none', this, _p);
      _v.set(Math.sin(this.facing) * TOSS_PUSH, TOSS_UP, Math.cos(this.facing) * TOSS_PUSH);
      pl.applyImpulse(_v);
      this.ctx.fx.shake(0.6, 0.3);
    }
    this.rollCooldown(TOSS_COOLDOWN[0], TOSS_COOLDOWN[1]);
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.hideWarnings();
    if (attackDirector.purging) return;
    const ctx = this.ctx, k = this.sizeScale;
    this.coreAnchor.getWorldPosition(_p);
    moltenSplash(ctx, _p, k * 1.5, 24);
    smokePuff(ctx, _p, k, 12);
    ctx.fx.explosion?.(_p, 1.6 * k, INFERNO.lava);
    ctx.audio.play('boss_slam', { position: _p, volume: 1, pitch: 0.55 });
    this.quake(0.6, 26, 0.45);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    let door = 0, raise = 0, bellows = 0, kneel = 0, low = 0, flick = 0, rate = 6;
    if (st === 'inhale') {
      const t = this.stateTime / this.inhaleTime;
      raise = smooth(t / 0.3);
      bellows = smooth(t);
      door = smooth((this.stateTime - 0.1) / 0.35);
      rate = 10;
    } else if (st === 'choke') {
      kneel = smooth(this.stateTime / 0.3) * (1 - smooth((this.stateTime - CHOKE_TIME + 0.4) / 0.4));
      door = 1;
      bellows = 0.3 + 0.2 * Math.sin(this.age * 9);
      rate = 12;
    } else if (st === 'spitWindup') { low = 0.6 * smooth(this.stateTime / this.windTime); bellows = 1; door = 0.4; rate = 14; }
    else if (st === 'spit') { low = 0.6; bellows = Math.max(0, 1 - this.stateTime / 0.6); rate = 14; }
    else if (st === 'tossWindup') { low = smooth(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'toss') { flick = this.stateTime < 0.12 ? 1 : Math.max(0, 1 - (this.stateTime - 0.12) / 0.4); rate = 30; }
    const k = 1 - Math.exp(-rate * dt);
    this.pDoor = mix(this.pDoor, door, 1 - Math.exp(-(door > this.pDoor ? 9 : 5) * dt));
    this.pRaise = mix(this.pRaise, raise, k);
    this.pBellows = mix(this.pBellows, bellows, 1 - Math.exp(-5 * dt));
    this.pKneel = mix(this.pKneel, kneel, k);
    this.pLow = mix(this.pLow, low, k);
    this.pFlick = mix(this.pFlick, flick, k);
    // 炉门判定：敞开时罩住整个炉口
    this.headRadius = (this.doorOpen ? DOOR_R_OPEN : DOOR_R_CLOSED) * this.sizeScale;
    // 炉心：开门白热，呛火时闪烁
    const heat = st === 'choke' ? 0.9 + 0.5 * Math.random() : this.pDoor * (0.7 + 0.3 * this.pBellows);
    this.core?.set(heat);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();
  }

  /** 白模动画：四拍慢步；吸气仰头、开门、风箱鼓起；跪倒；低头顶角 */
  private poseBlockout(): void {
    const amp = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / Math.max(1, this.def.speed)) * (1 - this.pKneel);
    const ph = this.walkPhase;
    this.body.position.y = 1.4 - 0.45 * this.pKneel;
    this.body.rotation.set(0.18 * this.pKneel - this.hurtKick * 0.05, 0, Math.sin(ph) * 0.02 * amp);
    this.head.rotation.x = -0.45 * this.pRaise + 0.4 * this.pLow - 0.7 * this.pFlick;
    this.door.rotation.x = -1.5 * this.pDoor;
    for (const b of this.bellows) b.scale.set(1 + 0.8 * this.pBellows, 1, 1 + 0.1 * this.pBellows);
    for (const l of this.legs) {
      const off = (l.front ? Math.PI / 2 : 0) + (l.side > 0 ? 0 : Math.PI);
      l.upper.rotation.x = Math.sin(ph + off) * 0.3 * amp + (l.front ? -0.9 : 0) * this.pKneel;
      l.lower.rotation.x = (l.front ? 1.6 : 0) * this.pKneel;
    }
    for (const [i, seg] of this.tail.entries()) seg.rotation.z = Math.sin(this.age * 1.6 - i * 0.6) * 0.15;
  }

  /**
   * 美术骨骼动画（牛形四足，creature_rigs/SK_Enemy_IronOx.json）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前端往下（低头），负转 = 前端往上（仰头 / 开门）。
   * - 步态：四拍侧对步，蹄子触地段往后扫、腾空段抬蹄前摆（两骨 IK），每一蹄落地留发红的蹄印、按距离震屏。
   * - 鼓风吸气：仰头、两侧风箱（bellows 骨缩放）鼓起，炉门（door 骨，铰链在门顶）往前上方掀开。
   * - 呛火：身体前沉、前腿跪倒（蹄子钉在原地，IK 折腕），炉门敞开、风箱一抽一抽地喷烟。
   * - 熔铁喷吐 / 顶角：低头，顶角时猛地一挑。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const kn = this.pKneel;
    const move = clamp01(sp / 0.5) * (1 - kn);
    this.gait = (this.gait + GAIT_FREQ * dt * move) % 1;
    const sweep = Math.min(GAIT_SWEEP, (sp * GAIT_DUTY) / (GAIT_FREQ * this.sizeScale));
    const lift = GAIT_LIFT * move;
    const ph = this.gait * Math.PI * 2;

    // 身体：慢步的起伏与侧摆；受击微仰；跪倒时前沉
    P.translate('hips', 0, -0.03 * move * (1 - Math.cos(ph * 2)) * 0.5 - 0.42 * kn, 0.05 * kn);
    P.rotate('hips', AX, 0.16 * kn - this.hurtKick * 0.03);
    P.rotate('spine', AZ, Math.sin(ph) * 0.02 * move);
    // 头：看向玩家；吸气仰头、喷吐 / 顶角低头、顶角上挑；走路时点头
    let dyaw = this.yawToPlayer() - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const look = this.state === 'advance' ? THREE.MathUtils.clamp(dyaw, -0.5, 0.5) : 0;
    P.rotate('neck', AY, look * 0.5);
    P.rotate('neck', AX, -0.12 * this.pRaise + 0.12 * this.pLow - 0.15 * this.pFlick + 0.03 * Math.sin(ph * 2) * move);
    P.rotate('head', AX, -0.32 * this.pRaise + 0.3 * this.pLow - 0.45 * this.pFlick - this.hurtKick * 0.1);
    // 风箱鼓起、炉门掀开
    const bl = 1 + 0.14 * this.pBellows;
    P.scale('bellows_L', bl);
    P.scale('bellows_R', bl);
    P.rotate('door', AX, -1.5 * this.pDoor);
    // 尾巴慢慢甩
    for (const [i, b] of TAIL.entries()) P.rotate(b, AZ, Math.sin(this.age * 1.4 - i * 0.7) * 0.12 * (i + 1) * 0.5);
    // 腿 IK
    for (const [li, leg] of LEGS.entries()) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const u = (this.gait + leg.phase) % 1;
      if (move > 0.3 && this.legU[li] > GAIT_DUTY && u < GAIT_DUTY) this.footfall(leg.e);
      this.legU[li] = u;
      let dz: number, dy: number;
      if (u < GAIT_DUTY) {
        dz = sweep * (0.5 - u / GAIT_DUTY);
        dy = 0;
      } else {
        const t = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * lift;
      }
      // 跪倒：前蹄往后收到胸下、贴地（腕折叠）
      const kz = leg.front ? -0.25 * kn : 0;
      _t.set(rest.x, rest.y + dy + (leg.front ? 0.05 * kn : 0), rest.z + dz * (1 - kn) + kz);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1 - 0.7 * kn * (leg.front ? 1 : 0));
    }
    if (n.glowShell) n.glowShell.opacity = clamp01(0.08 + 0.85 * this.pDoor * (0.6 + 0.4 * this.pBellows)) * 0.9;
  }

  /** 一蹄落地：发红的蹄印 + 震屏 + 闷响 */
  private footfall(bone: string): void {
    const b = this.nativeBody?.pose.bone(bone);
    if (!b) return;
    b.getWorldPosition(_p);
    _p.y = this.groundAt(_p.x, _p.z);
    hoofPrint(this.ctx, _p, 0.22 * this.sizeScale, 1);
    this.quake(0.09, STEP_SHAKE_RANGE, 0.14);
    if (this.distToPlayerXZ() < STEP_SHAKE_RANGE) this.ctx.audio.play('footstep', { position: _p, volume: 0.6, pitch: 0.35 });
  }
}

/** 铁甲 / 炉门：全局伤害修正，只对铁牛生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof IronOx ? enemy.armourFactor(req) : 1));
}
