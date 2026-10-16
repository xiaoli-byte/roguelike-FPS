/**
 * 火麒麟（第三章首领，祝融炉心殿 inferno-5）：祝融炉心的守炉兽。两个形态各是一个模型，共用一套四足马鹿骨架，
 * 55% 时在熔岩柱里换模型。
 *
 * 场地：圆形炉心殿，中央熔池上方吊着巨鼎，四条巨链拉到东南西北外墙的锁扣；四条放射状熔岩渠把地面切成四个象限，
 * 沿外墙一圈是外环跑道（QilinArena.locateFurnace 从熔岩掩码 / 导航网格找出熔池、殿墙、渠、桥、象限）。
 * 巨鼎、铁链是首领自带的场景道具（QilinCauldron），锁扣是可射击的小目标（QilinLock，boss_qilin_lock）。
 *
 * 一阶段 · 玄鳞（100–55%，玄铁鳞甲 = 护甲层）：
 *  - 踏火奔驰：沿外环跑道绕场狂奔，蹄印留火 4 秒（踩到被烧），撞到跑道上的人；然后停步转身、地面亮出一条冲撞线，
 *    横穿一个象限冲撞过去（侧移躲开）。冲撞撞上玄武岩柱会撞晕 1.6 秒（一个小输出窗口）。
 *  - 张鳞：人立 1 秒（全身鳞缝发亮、脚下预警圈），然后 360° 射出一圈红热鳞刃（血量 85% 以下连射两圈、错开半格），
 *    鳞刃撞到石柱 / 墙就碎——躲到玄武岩柱后面。
 *  - 麟火：玩家离得近时，面前扇形预警后短距离吐火扫射（石柱挡得住）。
 *  - 饮熔：血量到 85% 和 70% 时跳到熔池边低头饮熔 4 秒，两侧炉口各钻出 2 只炭童；饮完鳞甲回满、火鬃更旺。
 *    它身后那面外墙上的锁扣会发亮：打碎它，巨鼎那一角坠下砸中麒麟——眩晕 4 秒、鳞甲崩裂（全身都算弱点、受伤 ×2）。
 *    不饮熔时（或打错锁扣）鼎角砸空，白费一个锁扣。
 *  - 弱点：角根的火珠。
 * 转换（55%）：剩下的铁链全断，巨鼎整个砸进熔池、熔岩冲天；麒麟跳进熔池沉下去，鳞片炸飞，在熔岩柱里换成焚身跃出。
 * 二阶段 · 焚身（55–0%，鳞甲没了）：
 *  - 踏云：在 3.5–5.5 米高处绕殿弧线奔跑，越过熔岩渠；蹄下火云。
 *  - 俯冲踏地：连续三次——飞到玩家头顶、落点预警圈、砸下来炸出一圈贴地火环（起跳躲过）；三次之后落地喘息。
 *  - 喘息：落地喘 3.5 秒，胸口火心大亮——二阶段的主要输出窗口（弱点：胸口火心 + 角根火珠）。
 *  - 麟火吐息：落到熔池对岸，扇形预警盖住一个象限，然后吐息从象限一侧扫到另一侧——躲到柱后或池中的倒鼎后。
 *  - 熔流轮转：倒鼎压满熔池，熔岩溢进四条渠，按顺时针轮流涨宽到 4 米（LavaSystem.addLavaArea），
 *    每次淹一个象限的外侧 6 秒（狂怒时 4 秒），涨之前地面亮出预警条带。
 *  - 火云雨：顶上落火球（每个都有落点预警），高处排烟口刷神火飞鸦。
 *  - 狂怒（< 15%）：熔流轮转更快、出招间隙更短。
 * 美术：SK_Boss_Qilin / SK_Boss_QilinBurn（原生骨架，见 QilinModel.ts）；资产缺失或 ?classic 时用程序化兜底模型，招式不变。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, rotateTowards, TAU } from '../../core/math';
import { BossBase, type HitShape } from './BossBase';
import { attachEnemyArt } from '../../assets/EnemyArt';
import type { NativeBody } from '../../assets/NativeRig';
import type { LavaFlood, LavaSystem } from '../../world/Lava';
import { attackDirector } from '../AttackTokens';
import { getEnemyDef } from '../Registry';
import {
  clockwiseNext, floodShapes, furnaceAngle, furnacePoint, locateFurnace, quadrantOf, type Furnace,
} from './QilinArena';
import { QilinCauldron } from './QilinCauldron';
import { QilinFx, type Blade } from './QilinFx';
import { QILIN_LOCK_DEF, QilinLock } from './QilinLock';
import { BURN_POINTS, buildQilinProc, XUAN_POINTS, type QilinPoint } from './QilinModel';
import { anchorOn, ProcPose, type KPPose } from './KunPengModel';
import { easeInOut, easeOutCubic, span } from './parts';

export const QILIN_DEF: EnemyDef = {
  id: 'boss_qilin',
  name: '火麒麟',
  hp: 5000,
  // 玄铁鳞甲：一阶段的护甲层（饮熔回满，坠鼎砸中时崩裂，化焚身时炸飞）
  armor: 1500,
  speed: 10,
  radius: 2.0,
  height: 7.2,
  flying: true,
  damage: 16,
  coins: [80, 120],
  essence: 70,
  isBoss: true,
  headY: 6,
  headRadius: 0.5,
  knockbackResist: 1,
  color: 0xff6a1a,
};

/** 两个形态的模型缩放（美术按 6 米高到独角尖制作，头高约 4.5 米）：游戏里约 7.5 米 */
const SCALE = 1.25;
/** 饮熔的血量线（一阶段） */
const DRINK_AT = [0.85, 0.7];
const DRINK_TIME = 4;
const STUN_TIME = 4;
/** 二阶段踏云高度（离地，模型原点 = 四蹄） */
const SKY_ALT = 4.5;
const FLOOD_ON = 6;
const FLOOD_ON_RAGE = 4;
const FLOOD_WARN = 1.5;

const WARN = 0xff7a2a;
const FIRE = 0xff6a1a;
const HOT = 0xffd070;
const EMBER = 0xff8a3a;
const SCALE_DARK = 0x2a2420;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _imp = new THREE.Vector3();

/** 炭童、神火飞鸦（第三章阵容）：注册了才召 */
const TANTONG = 'tantong';
const FIRE_CROW = 'fire_crow';

export type FormId = 'xuan' | 'burn';

interface Form {
  host: THREE.Group;
  pose: KPPose;
  native: NativeBody | null;
  procGroup: THREE.Group;
  pts: Record<string, THREE.Object3D>;
  shapes: HitShape[];
  /** 骨骼名 → 绑定姿势下的模型空间位置（宿主局部、未缩放），用于绕蹄子的整体俯仰 */
  table: Record<string, QilinPoint>;
}

type GallopStage = 'toTrack' | 'run' | 'aim' | 'charge' | 'crash' | 'recover';
type DrinkStage = 'leap' | 'sip' | 'done';
type DiveStage = 'rise' | 'tele' | 'dive' | 'recover';
type BreathStage = 'approach' | 'tele' | 'sweep';
type PantStage = 'descend' | 'rest' | 'takeoff';

interface FloodCycle {
  order: number[];
  i: number;
  stage: 'warn' | 'on' | 'gap';
  t: number;
  floods: LavaFlood[];
  /** 没有熔岩系统时的兜底：自己按多边形结算伤害 */
  polys: [number, number][][];
  dmgAcc: number;
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

function inPoly(poly: readonly [number, number][], x: number, z: number): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) yes = !yes;
  }
  return yes;
}

export class Qilin extends BossBase {
  private furnace!: Furnace;
  private fx: QilinFx | null = null;
  private cauldron: QilinCauldron | null = null;
  private xuan!: Form;
  private burn!: Form;
  private form: FormId = 'xuan';
  /** 四个锁扣（与 furnace.quadrants 同序；null = 已碎 / 没召出来） */
  private readonly locks: (QilinLock | null)[] = [];
  private readonly lockBroken: boolean[] = [];
  private readonly lockPts: THREE.Vector3[] = [];
  private locksSpawned = false;

  // ── 一阶段 ──
  private gallopStage: GallopStage = 'toTrack';
  private stageT = 0;
  private gallopDir: 1 | -1 = 1;
  private runFor = 4;
  private theta = 0;
  private readonly chargeFrom = new THREE.Vector3();
  private chargeYaw = 0;
  private chargeLen = 20;
  private chargeTravel = 0;
  private chargeHit = false;
  private printAcc = 0;
  private printSide = 0;
  private trampleAt = -10;
  private printHurtAcc = 0;
  private bladeRings = 0;
  private breathAcc = 0;
  private drinksDone = 0;
  private drinkStage: DrinkStage = 'leap';
  private drinkQ = 0;
  private readonly drinkSpot = new THREE.Vector3();
  private readonly leapFrom = new THREE.Vector3();
  private cornerHitPending = false;
  /** 鳞甲崩裂剩余秒数（受伤 ×2、全身都算弱点） */
  private crackLeft = 0;
  private dmgTaken = 1;
  private maneHeat = 0;

  // ── 二阶段 ──
  private alt = 0;
  private orbit = 0;
  private orbitDir: 1 | -1 = 1;
  private orbitTimer = 6;
  private divesLeft = 0;
  private diveStage: DiveStage = 'rise';
  private readonly diveAt = new THREE.Vector3();
  private readonly diveFrom = new THREE.Vector3();
  private breathStage: BreathStage = 'approach';
  private readonly breathSpot = new THREE.Vector3();
  private breathYaw0 = 0;
  private breathYaw1 = 0;
  private breathRange = 30;
  private pantStage: PantStage = 'descend';
  private readonly pantAt = new THREE.Vector3();
  private flood: FloodCycle | null = null;
  private cloudAcc = 0;
  private rageTold = false;
  private readonly told = new Set<string>();

  // ── 动画参数（平滑） ──
  private gaitPhase = 0;
  private pGait = 0;
  private pRear = 0;
  private pDrink = 0;
  private pStun = 0;
  private pTuck = 0;
  private pStomp = 0;
  private pJaw = 0;
  private pLook = 0;
  private pPitch = 0;
  private sinkY = 0;
  private pearlGlow = 0.3;
  private heartGlow = 0.3;
  private transPrev = -1;
  private swapped = false;
  private entranceRoared = false;
  private readonly entranceFrom = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private moveSpeed = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, QILIN_DEF, opts);
    this.displayName = '火麒麟 · 玄鳞';
    this.thresholds = [0.55];
    this.spawnDuration = 3.2;
    this.deathDuration = 3.4;
    this.transitionDuration = 5.2;
    this.accel = 30;
    // 鳞甲崩裂的受伤 ×2：状态系统每帧会把 damageTakenMult 重置成状态倍率，这里在它上面再乘崩裂倍率
    Object.defineProperty(this, 'damageTakenMult', {
      get: () => this.dmgTaken * (this.crackLeft > 0 ? 2 : 1),
      set: (v: number) => { this.dmgTaken = v; },
      configurable: true,
      enumerable: true,
    });
    this.registerMoves();
  }

  // ───────────── 场地 / 模型 ─────────────

  private lavaSystem(): LavaSystem | null {
    return (this.ctx.stage as unknown as { lavaSystem?: LavaSystem | null }).lavaSystem ?? null;
  }

  override init(): void {
    // 在 BossBase.init（夹到竞技场、登场第一帧）之前就位：从熔池里朝刷新点那一侧跃出，落在池边
    this.furnace = locateFurnace(this.ctx.nav, this.ctx.stage.arena, this.lavaSystem()?.lava ?? null, this.position);
    const f = this.furnace;
    const d = Math.hypot(this.position.x - f.center.x, this.position.z - f.center.z);
    this.theta = d > 0.5 ? furnaceAngle(f, this.position.x, this.position.z) : (f.quadrants[0] ?? 0);
    furnacePoint(f, this.theta, f.pool + 4.5, _v);
    this.position.set(_v.x, f.center.y, _v.z);
    this.entranceFrom.copy(f.center);
    this.facing = this.theta;
    this.flyTargetY = this.position.y;
    this.velocity.set(0, 0, 0);
    this.prevPos.copy(this.position);
    for (let i = 0; i < f.quadrants.length; i++) {
      this.lockPts.push(furnacePoint(f, f.quadrants[i], f.wall - 0.5, new THREE.Vector3()).setY(f.center.y + 3));
      this.locks.push(null);
      this.lockBroken.push(false);
    }
    super.init();
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const mk = (name: string, burn: boolean, table: Record<string, QilinPoint>): Form => {
      const host = new THREE.Group();
      host.name = name;
      host.scale.setScalar(SCALE);
      root.add(host);
      const proc = buildQilinProc(host, burn);
      return { host, pose: new ProcPose(proc.joints), native: null, procGroup: proc.group, pts: {}, shapes: [], table };
    };
    this.xuan = mk('qilin_xuan_host', false, XUAN_POINTS);
    this.burn = mk('qilin_burn_host', true, BURN_POINTS);
    this.burn.host.visible = false;
    return root;
  }

  protected override onModelReady(): void {
    // 两个形态各挂自己的美术身体（清单绑定 boss_qilin_xuan / boss_qilin_burn，原生骨架）
    for (const [f, id] of [[this.xuan, 'boss_qilin_xuan'], [this.burn, 'boss_qilin_burn']] as const) {
      const art = attachEnemyArt({
        host: f.host,
        defId: id,
        rig: undefined,
        renderer: this.ctx.renderer,
        lowQuality: this.ctx.settings.quality === 'low',
        own: (m) => {
          this.clonedMats.push(m);
          this.flashMats.push({ mat: m, baseEmissive: m.emissive.clone(), baseIntensity: m.emissiveIntensity });
        },
      });
      if (art.native) {
        f.native = art.native;
        f.pose = art.native.pose;
        f.procGroup.visible = false;
        art.native.glowShell?.color.setHex(0xffa64a);
      }
      for (const [name, p] of Object.entries(f.table)) {
        const bone = f.pose.bone(p.bone) ?? f.host;
        f.pts[name] = anchorOn(f.host, bone, p.at, `ql_${name}`);
      }
    }
    const S = SCALE;
    const shapes = (f: Form, weak: string[]): HitShape[] => {
      const out: HitShape[] = [];
      for (const w of weak) out.push({ anchor: f.pts[w], radius: Math.max(0.38, f.table[w].r * S), halfHeight: 0, weak: true });
      for (const n of ['head', 'neck', 'chest', 'body', 'hips']) out.push({ anchor: f.pts[n], radius: f.table[n].r * S, halfHeight: 0, weak: false });
      return out;
    };
    this.xuan.shapes = shapes(this.xuan, ['pearl']);
    this.burn.shapes = shapes(this.burn, ['pearl', 'heart']);
    this.useForm('xuan');
    const f = this.furnace;
    this.fx = new QilinFx(this.ctx, f.center, f.pool);
    this.cauldron = new QilinCauldron(this.ctx, f, this.lockPts);
    this.cauldron.onImpact = (kind, at) => this.onCauldronImpact(kind, at);
  }

  private useForm(id: FormId): void {
    this.form = id;
    const f = id === 'xuan' ? this.xuan : this.burn;
    this.xuan.host.visible = id === 'xuan';
    this.burn.host.visible = id === 'burn';
    this.hitShapes = f.shapes;
    this.weakAnchor = f.pts.pearl;
    this.muzzleAnchor = f.pts.mouth;
  }

  private get F(): Form {
    return this.form === 'xuan' ? this.xuan : this.burn;
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const a = this.F?.pts.chest;
    return a ? a.getWorldPosition(out) : super.getBodyCenter(out);
  }

  override update(dt: number): void {
    super.update(dt);
    this.cauldron?.update(dt);
    this.fx?.update(dt, this.alive ? this.bladeResolver : null);
  }

  /** 鳞刃：撞到掩体就碎；扫过玩家（贴地 0.2–2.4 米高的竖薄片）就伤人 */
  private readonly bladeResolver = (b: Blade): 'hit' | 'block' | null => {
    if (this.ctx.world.segmentBlocked(b.prev, b.pos)) return 'block';
    _a.copy(b.prev).setY(this.floorY() + 0.4);
    _b.copy(b.pos).setY(this.floorY() + 0.4);
    const top = this.floorY() + 2.2;
    const pl = this.ctx.player;
    if (pl.position.y > top) return null;
    if (this.hazards.segmentHitsPlayer(_a, _b, 0.55)) {
      this.hazards.hurt(20, 'fire', b.pos);
      pl.applyImpulse(_imp.copy(b.dir).multiplyScalar(4).setY(2));
      return 'hit';
    }
    return null;
  };

  // ───────────── 招式 ─────────────

  private isXuan(): boolean {
    return this.phase === 0 && this.form === 'xuan';
  }

  private isBurn(): boolean {
    return this.phase >= 1 && this.form === 'burn';
  }

  private enraged(): boolean {
    return this.phase >= 1 && this.phaseFraction() <= 0.15;
  }

  private tell(key: string, text: string, color = '#ffb070'): void {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.ctx.ui.toast(text, color);
  }

  private trackR(): number {
    return Math.max(this.furnace.bridge[1] + 3, this.furnace.wall - 3.2);
  }

  private registerMoves(): void {
    // ── 玄鳞 · 踏火奔驰 + 横穿冲撞 ──
    this.addMove({
      id: 'gallop', cooldown: 9, recovery: 1.0,
      weight: () => (this.isXuan() ? 2.6 : 0),
      start: () => {
        this.gallopStage = 'toTrack';
        this.stageT = 0;
        const pl = this.ctx.player.position;
        const me = furnaceAngle(this.furnace, this.position.x, this.position.z);
        this.theta = me;
        this.gallopDir = angleDiff(me, furnaceAngle(this.furnace, pl.x, pl.z)) >= 0 ? 1 : -1;
        this.runFor = this.ctx.rng.range(3.2, 4.6);
        this.printAcc = 0;
        this.accel = 34;
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.1, volume: 0.7 });
        this.tell('gallop', '火麒麟沿外环跑道狂奔——别站在跑道上，蹄印上的火会烧人', '#ffb070');
      },
      tick: (_t, dt) => this.tickGallop(dt),
      end: () => {
        this.accel = 30;
      },
    }, 0.5);

    // ── 玄鳞 · 张鳞 ──
    this.addMove({
      id: 'scales', cooldown: 11, recovery: 1.2,
      weight: () => (this.isXuan() ? 2.0 : 0),
      start: () => {
        this.setAnim('rear', true);
        this.bladeRings = 0;
        const p = this.position;
        this.hazards.groundWarning(p.x, this.floorY(), p.z, 6.5, 1.0, WARN);
        this.ctx.fx.ring(_v.set(p.x, this.floorY() + 0.1, p.z), 24, WARN, 1.0);
        this.ctx.audio.play('telegraph', { position: p, pitch: 0.75 });
        this.ctx.audio.play('boss_roar', { position: p, pitch: 0.9, volume: 0.8 });
        this.tell('scales', '火麒麟人立张鳞——躲到玄武岩柱后面！', '#ff9a4a');
      },
      tick: (t) => {
        this.stopMoving();
        // 人立时鳞缝喷火星
        if (t < 1.0 && Math.random() < 0.6) {
          this.getBodyCenter(_v);
          _w.set((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6);
          this.fx?.emit(_v.add(_a.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)), _w, 0.5, 0.2, EMBER, 2, 0);
        }
        if (this.at(1.0)) this.fireRing(0);
        if (this.phaseFraction() <= 0.85 && this.at(1.4)) this.fireRing(0.5);
        return t >= 2.2;
      },
    }, 2.5);

    // ── 玄鳞 · 麟火（短距离吐火） ──
    this.addMove({
      id: 'breath', cooldown: 7, recovery: 0.9,
      weight: () => (this.isXuan() && this.distToPlayerXZ() < 15 ? 2.4 : 0),
      start: () => {
        this.setAnim('breath', true);
        this.facing = this.yawToPlayer();
        const m = this.mouthGround(_v);
        this.hazards.sectorWarning(m.x, this.floorY(), m.z, this.facing, 0.42, 14, 0.8, WARN);
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.6, volume: 0.9 });
        this.breathAcc = 0;
      },
      tick: (t, dt) => {
        this.stopMoving();
        if (t < 0.8) return false;
        this.facing = rotateTowards(this.facing, this.yawToPlayer(), 0.5 * dt);
        this.breatheAlong(this.facing, 0.42, 14, 6, dt);
        return t >= 2.4;
      },
    }, 1.5);

    // ── 玄鳞 · 饮熔（85% / 70%，只由血量线排队） ──
    this.addMove({
      id: 'drink', cooldown: 1, recovery: 0.6,
      weight: () => 0,
      start: () => this.beginDrink(),
      tick: (t, dt) => this.tickDrink(t, dt),
      end: () => this.endDrink(),
    });

    // ── 玄鳞 · 被鼎角砸中（眩晕 4 秒、鳞甲崩裂） ──
    this.addMove({
      id: 'stunned', cooldown: 0, recovery: 0.8,
      weight: () => 0,
      start: () => {
        this.setAnim('stun', true);
        this.stopMoving();
        this.flyTargetY = this.floorY();
      },
      tick: (t) => {
        this.stopMoving();
        if (Math.random() < 0.25) {
          this.F.pts.head.getWorldPosition(_v);
          this.ctx.fx.burst(_v, HOT, 2, 2, 0.5, 0.2, 2);
        }
        return t >= STUN_TIME;
      },
      end: () => {
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.8, volume: 0.9 });
      },
    });

    // ── 焚身 · 连续三次俯冲踏地 ──
    this.addMove({
      id: 'dives', cooldown: 10, recovery: 0.4,
      weight: () => (this.isBurn() ? 2.8 : 0),
      start: () => {
        this.divesLeft = 3;
        this.beginDive();
        this.tell('dives', '焚身俯冲踏地——落点会炸出一圈火环，跳起来躲；连踏三次之后它会落地喘息', '#ffb070');
      },
      tick: (_t, dt) => this.tickDive(dt),
      end: () => {
        this.accel = 30;
        this.alt = SKY_ALT;
      },
    }, 2.5);

    // ── 焚身 · 喘息（三次俯冲之后排队） ──
    this.addMove({
      id: 'pant', cooldown: 0, recovery: 0.6,
      weight: () => 0,
      start: () => this.beginPant(),
      tick: (_t, dt) => this.tickPant(dt),
      end: () => {
        this.alt = SKY_ALT;
        this.accel = 30;
      },
    });

    // ── 焚身 · 麟火吐息扫象限 ──
    this.addMove({
      id: 'sweep', cooldown: 10, recovery: 1.0,
      weight: () => (this.isBurn() ? 2.2 : 0),
      start: () => this.beginSweep(),
      tick: (_t, dt) => this.tickSweep(dt),
      end: () => {
        this.alt = SKY_ALT;
        this.pJaw = Math.min(this.pJaw, 0.3);
      },
    }, 6);

    // ── 焚身 · 熔流轮转 ──
    this.addMove({
      id: 'flood', cooldown: 34, recovery: 0.6,
      weight: () => (this.isBurn() && !this.flood ? 3 : 0),
      start: () => {
        this.setAnim('roar', true);
        this.alt = 5.5;
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.7, volume: 1 });
        this.tell('flood', '熔岩溢进四条渠——渠会顺时针轮流涨宽，淹掉一个象限的外侧，看地上的预警条带！', '#ff9a4a');
      },
      tick: (t) => {
        this.moveTo(this.furnace.center, 16, 1.5);
        this.facePlayer(2, this.ctx.time.dt);
        this.fx?.eruption(t < 1.6 ? 0.45 : 0);
        if (this.at(1.2)) this.startFloodCycle();
        return t >= 2.0;
      },
      end: () => {
        this.fx?.eruption(0);
        this.alt = SKY_ALT;
      },
    }, 0);

    // ── 焚身 · 火云雨 + 排烟口神火飞鸦 ──
    this.addMove({
      id: 'rain', cooldown: 13, recovery: 1.0,
      weight: () => (this.isBurn() ? 1.8 : 0),
      start: () => {
        this.setAnim('roar', true);
        this.alt = 7.5;
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.2 });
      },
      tick: (t) => {
        this.stopMoving();
        this.facePlayer(2, this.ctx.time.dt);
        if (this.at(0.7)) this.fireRain();
        if (this.at(1.0)) this.summonCrows();
        return t >= 2.6;
      },
      end: () => {
        this.alt = SKY_ALT;
      },
    }, 4);
  }

  // ── 玄鳞：踏火奔驰 ──

  private tickGallop(dt: number): boolean {
    this.stageT += dt;
    const f = this.furnace;
    const R = this.trackR();
    if (this.gallopStage === 'toTrack') {
      this.theta = furnaceAngle(f, this.position.x, this.position.z);
      furnacePoint(f, this.theta + this.gallopDir * 0.25, R, _v);
      const there = this.moveTo(_v, 15, 1.5);
      this.faceMovement(5, dt);
      if (there || Math.abs(Math.hypot(this.position.x - f.center.x, this.position.z - f.center.z) - R) < 1.2 || this.stageT > 2.5) {
        this.gallopStage = 'run';
        this.stageT = 0;
      }
      return false;
    }
    if (this.gallopStage === 'run') {
      const speed = 18;
      this.theta = furnaceAngle(f, this.position.x, this.position.z) + this.gallopDir * 0.3;
      furnacePoint(f, this.theta, R, _v);
      this.moveTo(_v, speed, 0.2);
      this.faceMovement(6, dt);
      this.dropPrints(dt, 0.13);
      this.trample();
      const pl = this.ctx.player.position;
      const ahead = angleDiff(furnaceAngle(f, this.position.x, this.position.z), furnaceAngle(f, pl.x, pl.z)) * this.gallopDir;
      if (this.stageT >= this.runFor || (this.stageT > 2 && ahead > 0.5 && ahead < 1.3)) this.beginCharge();
      return false;
    }
    if (this.gallopStage === 'aim') {
      this.stopMoving();
      this.facing = rotateTowards(this.facing, this.chargeYaw, 7 * dt);
      if (this.stageT >= 1.0) {
        this.gallopStage = 'charge';
        this.stageT = 0;
        this.chargeTravel = 0;
        this.chargeHit = false;
        this.accel = 90;
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.3, volume: 0.9 });
      }
      return false;
    }
    if (this.gallopStage === 'charge') {
      this.setMove(Math.sin(this.chargeYaw), Math.cos(this.chargeYaw), 30);
      this.facing = this.chargeYaw;
      this.chargeTravel += Math.hypot(this.velocity.x, this.velocity.z) * dt;
      this.dropPrints(dt, 0.1);
      this.F.pts.chest.getWorldPosition(_a);
      this.F.pts.hips.getWorldPosition(_b);
      _a.y = _b.y = this.floorY() + 1.2;
      if (!this.chargeHit && this.hazards.segmentHitsPlayer(_a, _b, 1.6)) {
        this.chargeHit = true;
        this.hazards.hurt(34, 'none', this.position);
        const side = Math.sign(angleDiff(this.chargeYaw, this.yawToPlayer())) || 1;
        this.ctx.player.applyImpulse(_imp.set(Math.sin(this.chargeYaw + side * 1.2) * 13, 7, Math.cos(this.chargeYaw + side * 1.2) * 13));
        this.ctx.fx.shake(0.55, 0.35);
        this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.6 });
      }
      const crashed = this.moveResult.hitWall && this.stageT > 0.15;
      if (this.chargeTravel >= this.chargeLen || crashed || this.stageT > 2.4) {
        this.stopMoving();
        this.accel = 30;
        this.stageT = 0;
        if (crashed) {
          this.gallopStage = 'crash';
          this.setAnim('stun', true);
          this.F.pts.head.getWorldPosition(_v);
          this.ctx.fx.burst(_v, 0x4a4040, 30, 8, 1.0, 0.4, 14);
          this.ctx.fx.shake(0.6, 0.4);
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 0.9 });
          this.tell('crash', '火麒麟一头撞上石柱，晕了——快打角根的火珠！', '#ffe08a');
        } else {
          this.gallopStage = 'recover';
          this.setAnim('idle');
        }
      }
      return false;
    }
    this.stopMoving();
    this.facePlayer(2, dt);
    return this.stageT >= (this.gallopStage === 'crash' ? 1.6 : 0.5);
  }

  /** 横穿冲撞：从当前位置过玩家（预判 0.35 秒）一直冲到对面跑道 */
  private beginCharge(): void {
    const f = this.furnace;
    const pl = this.ctx.player;
    _v.set(pl.position.x + pl.velocity.x * 0.35, 0, pl.position.z + pl.velocity.z * 0.35);
    this.chargeYaw = this.yawTo(_v.x, _v.z);
    // 直线与跑道圆（半径 R）的远交点
    const R = this.trackR();
    const ox = this.position.x - f.center.x, oz = this.position.z - f.center.z;
    const dx = Math.sin(this.chargeYaw), dz = Math.cos(this.chargeYaw);
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R;
    const disc = b * b - c;
    this.chargeLen = clamp(disc > 0 ? -b + Math.sqrt(disc) : 20, 10, 2 * R);
    this.chargeFrom.copy(this.position);
    this.gallopStage = 'aim';
    this.stageT = 0;
    this.stopMoving();
    this.hazards.lineWarning(this.position.x, this.floorY(), this.position.z, this.chargeYaw, this.chargeLen, 2.0, 1.0, WARN);
    this.ctx.audio.play('telegraph', { position: this.position });
    this.setAnim('paw', true);
    this.tell('charge', '地上亮线——火麒麟要横穿象限冲撞，侧移躲开！', '#ffb070');
  }

  /** 奔跑时左右交替落下燃烧的蹄印 */
  private dropPrints(dt: number, every: number): void {
    this.printAcc += dt;
    if (this.printAcc < every) return;
    this.printAcc = 0;
    const names = ['hoofFL', 'hoofHR', 'hoofFR', 'hoofHL'];
    const a = this.F.pts[names[this.printSide++ % 4]];
    if (!a) return;
    a.getWorldPosition(_v);
    this.fx?.hoofprint(_v.x, _v.z, this.facing);
    if (this.printSide % 2) this.ctx.fx.burst(_v.setY(this.floorY() + 0.2), EMBER, 4, 3, 0.4, 0.15, 6);
  }

  /** 奔驰时撞到跑道上的玩家 */
  private trample(): void {
    const pl = this.ctx.player;
    if (!pl.alive || this.ctx.time.now - this.trampleAt < 1.0) return;
    this.getBodyCenter(_v);
    const d = Math.hypot(pl.position.x - _v.x, pl.position.z - _v.z);
    if (d > this.radius + 1.0 || pl.position.y - this.floorY() > 3) return;
    this.trampleAt = this.ctx.time.now;
    this.hazards.hurt(24, 'none', this.position);
    const out = Math.atan2(pl.position.x - _v.x, pl.position.z - _v.z);
    pl.applyImpulse(_imp.set(Math.sin(out) * 11, 6, Math.cos(out) * 11));
    this.ctx.fx.shake(0.4, 0.3);
    this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.7 });
  }

  // ── 玄鳞：张鳞 ──

  private fireRing(offsetFrac: number): void {
    const n = 36;
    this.setAnim('scalesFire', true);
    this.getBodyCenter(_v);
    this.fx?.fireRing(_v.setY(this.floorY()), n, this.facing + (offsetFrac * TAU) / n, 21, this.furnace.wall * 2.2, 2.4);
    this.bladeRings++;
    this.ctx.fx.burst(_v.setY(this.floorY() + 3), EMBER, 30, 10, 0.6, 0.3, 6);
    this.ctx.fx.shake(0.35, 0.3);
    this.ctx.audio.play('enemy_shot', { position: this.position, pitch: 0.55, volume: 1 });
    this.ctx.audio.play('shield_break', { position: this.position, pitch: 1.4, volume: 0.6 });
  }

  // ── 吐息（两个形态共用的判定） ──

  /** 口部投影到地面 */
  private mouthGround(out: THREE.Vector3): THREE.Vector3 {
    this.F.pts.mouth.getWorldPosition(out);
    out.y = this.floorY();
    return out;
  }

  /** 沿 yaw 方向吐火：粒子 + 每 0.15 秒判定一次（扇形 halfAngle、射程 range、口到玩家胸口不被挡） */
  private breatheAlong(yaw: number, halfAngle: number, range: number, damage: number, dt: number): void {
    this.F.pts.mouth.getWorldPosition(_a);
    _w.set(Math.sin(yaw), -0.12, Math.cos(yaw)).normalize();
    this.fx?.breath(_a, _w, Math.min(26, range * 1.4), 0.35, 3);
    this.breathAcc += dt;
    if (this.breathAcc < 0.15) return;
    this.breathAcc = 0;
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const m = this.mouthGround(_v);
    const dx = pl.position.x - m.x, dz = pl.position.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d > range || Math.abs(angleDiff(yaw, Math.atan2(dx, dz))) > halfAngle) return;
    _b.set(pl.position.x, pl.position.y + 1.2, pl.position.z);
    if (this.ctx.world.segmentBlocked(_a, _b)) return;
    this.hazards.hurt(damage, 'fire', _a);
  }

  // ── 玄鳞：饮熔 ──

  private beginDrink(): void {
    if (this.phase > 0) {
      this.drinkStage = 'done';
      return;
    }
    const f = this.furnace;
    // 饮熔点：离自己最近、锁扣还在的象限（都断了就随便一个）
    const me = furnaceAngle(f, this.position.x, this.position.z);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < f.quadrants.length; i++) {
      if (this.lockBroken[i] || !(this.cauldron?.chainIntact(i) ?? true)) continue;
      const d = Math.abs(angleDiff(me, f.quadrants[i]));
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) best = quadrantOf(f, this.position.x, this.position.z);
    this.drinkQ = best;
    furnacePoint(f, f.quadrants[best], f.pool + 3.1, this.drinkSpot);
    this.leapFrom.copy(this.position);
    this.drinkStage = 'leap';
    this.cornerHitPending = false;
    this.setAnim('leap', true);
    this.hazards.groundWarning(this.drinkSpot.x, this.floorY(), this.drinkSpot.z, 4.5, 1.0, WARN);
    this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.85, volume: 1 });
  }

  private tickDrink(t: number, dt: number): boolean {
    if (this.drinkStage === 'done') return true;
    const f = this.furnace;
    if (this.drinkStage === 'leap') {
      // 1 秒的抛物线跃向池边（直接驱动位置：首领飞行体，零速度不受碰撞推挤）
      const k = easeInOut(span(t, 0, 1.0));
      this.position.x = mix(this.leapFrom.x, this.drinkSpot.x, k);
      this.position.z = mix(this.leapFrom.z, this.drinkSpot.z, k);
      this.position.y = this.floorY() + Math.sin(Math.PI * k) * 6;
      this.flyTargetY = this.position.y;
      this.velocity.set(0, 0, 0);
      this.facing = rotateTowards(this.facing, f.quadrants[this.drinkQ] + Math.PI, 5 * dt);
      if (t >= 1.0) {
        this.drinkStage = 'sip';
        this.position.y = this.floorY();
        this.flyTargetY = this.floorY();
        this.facing = f.quadrants[this.drinkQ] + Math.PI;
        this.setAnim('drink', true);
        const L = this.drinkSpot;
        this.hazards.blast(L.x, this.floorY(), L.z, 4.5, 24, { maxHeight: 3, knockback: 9, knockUp: 5 });
        this.ctx.fx.shake(0.5, 0.4);
        this.ctx.fx.burst(_v.set(L.x, this.floorY() + 0.4, L.z), EMBER, 26, 8, 0.8, 0.3, 10);
        this.ctx.audio.play('boss_slam', { position: L, pitch: 0.9 });
        this.summonTantong();
        this.highlightLock(this.drinkQ, true);
        this.tell('drink', '火麒麟在熔池边饮熔——打碎它身后外墙上发亮的锁扣，让巨鼎砸它！', '#ffe08a');
      }
      return false;
    }
    // sip：低头饮熔，熔岩从池面吸进嘴里
    this.stopMoving();
    this.velocity.set(0, 0, 0);
    this.fx?.eruption(0.18);
    if (Math.random() < 0.8) {
      this.F.pts.mouth.getWorldPosition(_a);
      furnacePoint(f, f.quadrants[this.drinkQ] + (Math.random() - 0.5) * 0.5, f.pool * (0.4 + Math.random() * 0.5), _v);
      _v.y = this.floorY() + 0.2;
      _w.subVectors(_a, _v).multiplyScalar(1.6);
      this.fx?.emit(_v, _w, 0.6, 0.25, Math.random() < 0.5 ? HOT : FIRE, 0, 0);
    }
    this.maneHeat = Math.min(1, this.maneHeat + dt / DRINK_TIME * 0.5);
    // 锁扣打碎后鼎角还在落：等它砸下来（onCauldronImpact 打断本招）
    if (t >= 1.0 + DRINK_TIME && !this.cornerHitPending) {
      this.drinkStage = 'done';
      this.armor = this.maxArmor;
      this.damageMult *= 1.08;
      this.maneHeat = 1;
      this.getBodyCenter(_v);
      this.ctx.fx.burst(_v, FIRE, 40, 9, 0.9, 0.4, 4);
      this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.95, volume: 1 });
      this.ctx.ui.toast('火麒麟饮完熔岩——鳞甲回满，火鬃更旺了', '#ff9a4a');
      return true;
    }
    return false;
  }

  private endDrink(): void {
    this.fx?.eruption(0);
    this.highlightLock(this.drinkQ, false);
    if (this.position.y > this.floorY() + 0.1) {
      this.position.y = this.floorY();
      this.flyTargetY = this.floorY();
    }
  }

  /** 正在饮熔（低头那 4 秒）：鼎角砸下来能砸中 */
  private get drinking(): boolean {
    return this.current?.id === 'drink' && this.drinkStage === 'sip';
  }

  private highlightLock(i: number, on: boolean): void {
    const l = this.locks[i];
    if (l?.alive) l.highlight = on;
  }

  // ── 锁扣 / 吊鼎 ──

  /** 锁扣碎了（QilinLock.onDeath 回调） */
  onLockBroken(lock: QilinLock): void {
    this.breakLock(lock.index);
  }

  /** 锁扣 i 碎了：鼎角坠下。饮熔时打的正是它身后那个锁扣 → 砸中；否则砸空 */
  breakLock(i: number): void {
    if (i < 0 || i >= this.lockBroken.length || this.lockBroken[i]) return;
    this.lockBroken[i] = true;
    this.locks[i] = null;
    if (!this.alive || this.phase > 0 || !this.cauldron) return;
    const impact = this.cauldron.dropCorner(i);
    if (!impact) return;
    this.cornerHitPending = this.drinking && this.drinkQ === i;
    if (!this.cornerHitPending) this.cornerWasted = true;
  }

  private cornerWasted = false;

  private onCauldronImpact(kind: 'corner' | 'fallen', at: THREE.Vector3): void {
    const fx = this.ctx.fx;
    fx.explosion(_v.copy(at), kind === 'fallen' ? 6 : 3.5, FIRE);
    fx.burst(_v, EMBER, kind === 'fallen' ? 60 : 30, kind === 'fallen' ? 14 : 9, 1.1, 0.4, 12);
    fx.shake(kind === 'fallen' ? 0.95 : 0.6, kind === 'fallen' ? 1.0 : 0.5);
    this.ctx.audio.play('boss_slam', { position: at, pitch: kind === 'fallen' ? 0.5 : 0.75, volume: 1 });
    this.ctx.audio.play('explosion', { position: at, pitch: 0.6, volume: 0.9 });
    if (kind === 'fallen') {
      const C = this.furnace.center;
      this.fx?.eruption(1);
      this.hazards.wave({ x: C.x, y: C.y, z: C.z, speed: 15, maxRadius: this.furnace.wall + 1, damage: 12, color: WARN,
        startRadius: this.furnace.pool, width: 1.1, height: 0.95, knockback: 7, element: 'fire', dust: EMBER });
      return;
    }
    if (this.cornerHitPending && this.alive && this.phase === 0) {
      this.cornerHitPending = false;
      this.cornerHit();
    } else if (this.cornerWasted) {
      this.cornerWasted = false;
      this.ctx.ui.toast('鼎角砸空——白费了一个锁扣。等它饮熔时再打它身后那一个', '#c8a070');
    }
  }

  /** 鼎角砸中饮熔的麒麟：眩晕 4 秒、鳞甲崩裂（全身弱点、受伤 ×2） */
  private cornerHit(): void {
    this.crackLeft = STUN_TIME;
    this.armor = 0;
    this.F.pts.head.getWorldPosition(_v);
    this.ctx.fx.burst(_v, SCALE_DARK, 40, 10, 1.2, 0.35, 16);
    this.ctx.fx.burst(_v, HOT, 30, 9, 0.8, 0.3, 6);
    this.ctx.audio.play('shield_break', { position: this.position, pitch: 0.6, volume: 1 });
    this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.65, volume: 1 });
    this.ctx.ui.toast('巨鼎砸中火麒麟！鳞甲崩裂——全身都是弱点、伤害翻倍，4 秒！', '#ffe08a');
    this.abortMove();
    this.queueMove('stunned');
    this.restLeft = 0;
  }

  /** 首领自己的锁扣（测试与检视用：已碎的为 null） */
  get lockList(): readonly (QilinLock | null)[] {
    return this.locks;
  }

  private spawnLocks(): void {
    if (this.locksSpawned) return;
    this.locksSpawned = true;
    if (!getEnemyDef(QILIN_LOCK_DEF.id)) return;
    const f = this.furnace;
    for (let i = 0; i < this.lockPts.length; i++) {
      if (this.lockBroken[i]) continue;
      const e = this.ctx.enemies.spawn(QILIN_LOCK_DEF.id, { position: this.lockPts[i].clone(), level: this.level });
      if (e instanceof QilinLock) {
        e.owner = this;
        e.index = i;
        e.faceAngle = f.quadrants[i] + Math.PI;
        e.facing = e.faceAngle;
        this.locks[i] = e;
      }
    }
  }

  /** 剩下的锁扣静默移除（链全断时） */
  private purgeLocks(): void {
    const was = attackDirector.purging;
    attackDirector.purging = true;
    try {
      for (let i = 0; i < this.locks.length; i++) {
        const l = this.locks[i];
        this.locks[i] = null;
        if (!l || !l.alive) continue;
        l.owner = null;
        try {
          l.onKilled({
            request: { base: 0, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] },
            dealt: 0, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
          });
        } catch (err) {
          console.error('[Qilin] 锁扣移除出错', err);
        }
      }
    } finally {
      attackDirector.purging = was;
    }
  }

  // ── 召唤 ──

  private spawnAt(id: string, p: THREE.Vector3): IEnemy | null {
    if (!getEnemyDef(id)) return null;
    const e = this.ctx.enemies.spawn(id, { position: p.clone(), level: this.level });
    if (e) this.minions.push(e);
    return e;
  }

  /** 饮熔时两侧炉口各钻出 2 只炭童（炉口在饮熔点两侧的象限外墙边） */
  private summonTantong(): void {
    this.pruneMinions();
    if (this.minions.length >= 6) return;
    const f = this.furnace;
    const base = f.quadrants[this.drinkQ];
    for (const side of [-1, 1]) {
      const a = base + side * (Math.PI / 2 + 0.35);
      for (let k = 0; k < 2; k++) {
        furnacePoint(f, a + (k - 0.5) * 0.12, f.wall - 1.5, _v);
        if (!this.ctx.nav.nearestWalkable(_v, _w)) _w.copy(_v);
        _w.y = this.floorY();
        if (this.spawnAt(TANTONG, _w)) this.ctx.fx.burst(_w.setY(this.floorY() + 0.8), EMBER, 14, 5, 0.6, 0.25, 4);
      }
    }
  }

  /** 火云雨时高处排烟口（玩家对面两侧）刷神火飞鸦 */
  private summonCrows(): void {
    this.pruneMinions();
    const f = this.furnace;
    const pa = furnaceAngle(f, this.ctx.player.position.x, this.ctx.player.position.z);
    let n = 0;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2 && this.minions.length < 6; k++) {
        furnacePoint(f, pa + Math.PI + side * 0.6 + k * 0.08, f.wall - 1, _v);
        _v.y = this.floorY() + 10;
        if (this.spawnAt(FIRE_CROW, _v)) n++;
      }
    }
    if (n) this.tell('crows', '高处排烟口飞出神火飞鸦——在空中打爆它们', '#ffb070');
  }

  // ── 焚身：俯冲踏地 ──

  private beginDive(): void {
    const pl = this.ctx.player;
    const f = this.furnace;
    this.diveAt.set(pl.position.x + pl.velocity.x * 0.5, this.floorY(), pl.position.z + pl.velocity.z * 0.5);
    // 不出殿墙
    const dx = this.diveAt.x - f.center.x, dz = this.diveAt.z - f.center.z, d = Math.hypot(dx, dz);
    if (d > f.wall - 2.5) {
      this.diveAt.x = f.center.x + (dx / d) * (f.wall - 2.5);
      this.diveAt.z = f.center.z + (dz / d) * (f.wall - 2.5);
    }
    this.diveStage = 'rise';
    this.stageT = 0;
    this.alt = 7.5;
    this.accel = 40;
    this.setAnim('gallop');
  }

  private tickDive(dt: number): boolean {
    this.stageT += dt;
    const A = this.diveAt;
    if (this.diveStage === 'rise') {
      const there = this.moveTo(A, 22, 1.2);
      this.faceTowards(A, 5, dt);
      if (there || this.stageT > 1.4) {
        this.diveStage = 'tele';
        this.stageT = 0;
        this.stopMoving();
        this.velocity.x *= 0.2;
        this.velocity.z *= 0.2;
        this.setAnim('tuck', true);
        this.hazards.groundWarning(A.x, this.floorY(), A.z, 4.2, this.enraged() ? 0.7 : 0.9, WARN);
        this.ctx.audio.play('telegraph', { position: A, pitch: 1.0 });
      }
      return false;
    }
    if (this.diveStage === 'tele') {
      this.stopMoving();
      this.facePlayer(3, dt);
      if (this.stageT >= (this.enraged() ? 0.7 : 0.9)) {
        this.diveStage = 'dive';
        this.stageT = 0;
        this.diveFrom.copy(this.position);
        this.setAnim('stomp', true);
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.4, volume: 0.8 });
      }
      return false;
    }
    if (this.diveStage === 'dive') {
      const k = Math.min(1, this.stageT / 0.3);
      const e = k * k;
      this.position.x = mix(this.diveFrom.x, A.x, k);
      this.position.z = mix(this.diveFrom.z, A.z, k);
      this.position.y = mix(this.diveFrom.y, this.floorY(), e);
      this.flyTargetY = this.position.y;
      this.velocity.set(0, 0, 0);
      if (k >= 1) {
        this.diveStage = 'recover';
        this.stageT = 0;
        this.alt = 0;
        this.hazards.blast(A.x, this.floorY(), A.z, 4.2, 30, { maxHeight: 3, knockback: 10, knockUp: 6, element: 'fire' });
        this.hazards.wave({ x: A.x, y: this.floorY(), z: A.z, speed: 13, maxRadius: 15, damage: 16, color: WARN, startRadius: 2,
          width: 1.0, height: 0.85, knockback: 6, element: 'fire', dust: EMBER });
        this.ctx.fx.explosion(_v.set(A.x, this.floorY() + 0.6, A.z), 4, FIRE);
        this.ctx.fx.ring(_w.set(A.x, this.floorY() + 0.1, A.z), 8, WARN, 0.7);
        this.ctx.fx.shake(0.65, 0.45);
        this.ctx.audio.play('boss_slam', { position: A, volume: 1 });
      }
      return false;
    }
    // recover：踏完弹起
    this.stopMoving();
    if (this.stageT >= 0.45) {
      this.divesLeft--;
      if (this.divesLeft > 0) {
        this.beginDive();
        return false;
      }
      this.queueMove('pant');
      return true;
    }
    return false;
  }

  // ── 焚身：喘息 ──

  private beginPant(): void {
    // 落点：脚下最近的可走地面（导航把熔岩当阻挡，所以不会落进熔岩）
    if (!this.ctx.nav.nearestWalkable(_v.copy(this.position).setY(this.floorY()), this.pantAt)) this.pantAt.copy(this.position);
    this.pantAt.y = this.floorY();
    this.pantStage = 'descend';
    this.stageT = 0;
    this.alt = 0;
    this.setAnim('stomp', true);
    this.hazards.groundWarning(this.pantAt.x, this.floorY(), this.pantAt.z, 5, 0.8, WARN);
  }

  private tickPant(dt: number): boolean {
    this.stageT += dt;
    const L = this.pantAt;
    if (this.pantStage === 'descend') {
      this.moveTo(L, 10, 0.3);
      this.alt = 0;
      if (this.stageT >= 0.8) {
        this.pantStage = 'rest';
        this.stageT = 0;
        this.stopMoving();
        this.position.y = this.floorY();
        this.setAnim('pant', true);
        this.hazards.blast(L.x, this.floorY(), L.z, 5, 16, { maxHeight: 3, knockback: 8, knockUp: 4 });
        this.ctx.fx.shake(0.45, 0.35);
        this.ctx.audio.play('boss_slam', { position: L, pitch: 1.1 });
        this.tell('pant', '焚身落地喘息——胸口火心大亮，现在是输出时机！', '#ffe08a');
      }
      return false;
    }
    this.stopMoving();
    if (this.pantStage === 'rest') {
      this.facePlayer(0.6, dt);
      if (this.stageT >= 3.0 && this.stageT - dt < 3.0) {
        this.hazards.groundWarning(this.position.x, this.floorY(), this.position.z, 6, 0.5, WARN);
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.1 });
      }
      if (this.stageT >= 3.5) {
        this.pantStage = 'takeoff';
        this.stageT = 0;
        this.setAnim('tuck', true);
        this.hazards.blast(this.position.x, this.floorY(), this.position.z, 6, 12, { maxHeight: 4, knockback: 12, knockUp: 5, element: 'fire' });
        this.ctx.fx.ring(_v.set(this.position.x, this.floorY() + 0.1, this.position.z), 7, WARN, 0.6);
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.3, volume: 0.8 });
        this.alt = SKY_ALT;
      }
      return false;
    }
    return this.stageT >= 0.7;
  }

  // ── 焚身：麟火扫象限 ──

  private beginSweep(): void {
    const f = this.furnace;
    const q = quadrantOf(f, this.ctx.player.position.x, this.ctx.player.position.z);
    // 站到熔池对岸（落地吐息：石柱、池中的倒鼎才挡得住）
    furnacePoint(f, f.quadrants[q] + Math.PI, f.pool + 2.2, this.breathSpot);
    const n = f.channels.length;
    const aLo = f.channels[q], aHi = f.channels[(q + 1) % n];
    furnacePoint(f, aLo, f.wall - 1, _a);
    furnacePoint(f, aHi, f.wall - 1, _b);
    const s = this.breathSpot;
    const y0 = Math.atan2(_a.x - s.x, _a.z - s.z), y1 = Math.atan2(_b.x - s.x, _b.z - s.z);
    // 从离玩家远的一侧扫向另一侧
    const pYaw = Math.atan2(this.ctx.player.position.x - s.x, this.ctx.player.position.z - s.z);
    const nearLo = Math.abs(angleDiff(pYaw, y0)) < Math.abs(angleDiff(pYaw, y1));
    this.breathYaw0 = nearLo ? y1 : y0;
    this.breathYaw1 = nearLo ? y0 : y1;
    this.breathRange = Math.max(_a.distanceTo(s), _b.distanceTo(s)) + 2;
    this.breathStage = 'approach';
    this.stageT = 0;
    this.alt = 3;
    this.breathAcc = 0;
    this.setAnim('gallop');
  }

  private tickSweep(dt: number): boolean {
    this.stageT += dt;
    const s = this.breathSpot;
    if (this.breathStage === 'approach') {
      const there = this.moveTo(s, 20, 1.2);
      this.faceTowards(s, 4, dt);
      if (there || this.stageT > 2.2) {
        this.breathStage = 'tele';
        this.stageT = 0;
        this.stopMoving();
        this.alt = 0;
        this.setAnim('breath', true);
        const mid = this.breathYaw0 + angleDiff(this.breathYaw0, this.breathYaw1) / 2;
        const half = Math.abs(angleDiff(this.breathYaw0, this.breathYaw1)) / 2 + 0.08;
        this.hazards.sectorWarning(s.x, this.floorY(), s.z, mid, half, this.breathRange, 1.2, WARN);
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.5, volume: 1 });
        this.tell('sweep', '焚身要吐息扫过整个象限——躲到石柱或池中倒鼎的后面！', '#ff9a4a');
      }
      return false;
    }
    this.stopMoving();
    if (this.breathStage === 'tele') {
      this.facing = rotateTowards(this.facing, this.breathYaw0, 4 * dt);
      if (this.stageT >= 1.2) {
        this.breathStage = 'sweep';
        this.stageT = 0;
        this.ctx.audio.play('skill_fire', { position: this.position, pitch: 0.6, volume: 1 });
      }
      return false;
    }
    const k = Math.min(1, this.stageT / 2.6);
    const yaw = this.breathYaw0 + angleDiff(this.breathYaw0, this.breathYaw1) * k;
    this.facing = yaw;
    this.breatheAlong(yaw, 0.15, this.breathRange, 9, dt);
    return k >= 1 && this.stageT >= 2.9;
  }

  // ── 焚身：熔流轮转 ──

  private startFloodCycle(): void {
    if (this.flood) return;
    const f = this.furnace;
    const q0 = quadrantOf(f, this.ctx.player.position.x, this.ctx.player.position.z);
    const order = [q0];
    while (order.length < f.quadrants.length) order.push(clockwiseNext(f, order[order.length - 1]));
    this.flood = { order, i: 0, stage: 'warn', t: 0, floods: [], polys: [], dmgAcc: 0 };
    this.warnFlood(order[0]);
  }

  private warnFlood(q: number): void {
    const { strips } = floodShapes(this.furnace, q);
    for (const s of strips) this.hazards.lineWarning(s.x, this.floorY(), s.z, s.yaw, s.length, s.half, FLOOD_WARN, WARN, 0, 'hazard');
    this.ctx.audio.play('telegraph', { position: this.furnace.center, pitch: 0.6 });
  }

  private tickFlood(dt: number): void {
    const c = this.flood;
    if (!c) return;
    c.t += dt;
    const q = c.order[c.i];
    if (c.stage === 'warn') {
      if (c.t >= FLOOD_WARN) {
        c.stage = 'on';
        c.t = 0;
        const { polygons } = floodShapes(this.furnace, q);
        const lava = this.lavaSystem();
        c.polys = polygons;
        if (lava) for (const p of polygons) c.floods.push(lava.addLavaArea(p, { rise: 0.5 }));
        // 熔岩涌进渠：池边冒火
        furnacePoint(this.furnace, this.furnace.quadrants[q], this.furnace.bridge[1] + 3, _v);
        this.ctx.fx.burst(_v.setY(this.floorY() + 0.3), EMBER, 30, 7, 0.9, 0.3, 6);
        this.ctx.audio.play('skill_fire', { position: _v, pitch: 0.5, volume: 0.9 });
      }
      return;
    }
    if (c.stage === 'on') {
      // 没有熔岩系统（旧关卡 / 测试）时自己结算：站在涨宽的渠里每 0.5 秒烧一下
      if (c.floods.length === 0) {
        c.dmgAcc += dt;
        const pl = this.ctx.player.position;
        if (c.dmgAcc >= 0.5) {
          c.dmgAcc = 0;
          if (pl.y - this.floorY() < 0.4 && c.polys.some((p) => inPoly(p, pl.x, pl.z))) this.hazards.hurt(10, 'fire', pl);
        }
      }
      if (c.t >= (this.enraged() ? FLOOD_ON_RAGE : FLOOD_ON)) {
        for (const fl of c.floods) fl.remove();
        c.floods.length = 0;
        c.polys = [];
        c.stage = 'gap';
        c.t = 0;
      }
      return;
    }
    if (c.t >= (this.enraged() ? 0.3 : 0.6)) {
      c.i++;
      if (c.i >= c.order.length) {
        this.flood = null;
        return;
      }
      c.stage = 'warn';
      c.t = 0;
      this.warnFlood(c.order[c.i]);
    }
  }

  private stopFlood(): void {
    const c = this.flood;
    if (!c) return;
    for (const fl of c.floods) fl.remove();
    this.flood = null;
  }

  /** 当前涨宽的象限（测试与检视用；没有在涨时为 −1） */
  get floodingQuadrant(): number {
    const c = this.flood;
    return c && c.stage === 'on' ? c.order[c.i] : -1;
  }

  // ── 焚身：火云雨 ──

  private fireRain(): void {
    const pl = this.ctx.player;
    const f = this.furnace;
    const n = this.enraged() ? 14 : 10;
    for (let i = 0; i < n; i++) {
      this.hazards.later(i * 0.16, () => {
        if (!this.alive) return;
        const to = new THREE.Vector3();
        if (i < 3) {
          const lead = 0.5 + i * 0.25;
          to.set(pl.position.x + pl.velocity.x * lead, this.floorY(), pl.position.z + pl.velocity.z * lead);
        } else {
          const a = this.ctx.rng.range(0, TAU), r = 2.5 + this.ctx.rng.range(0, 8);
          to.set(pl.position.x + Math.sin(a) * r, this.floorY(), pl.position.z + Math.cos(a) * r);
        }
        const dx = to.x - f.center.x, dz = to.z - f.center.z, d = Math.hypot(dx, dz);
        if (d > f.wall - 1) { to.x = f.center.x + (dx / d) * (f.wall - 1); to.z = f.center.z + (dz / d) * (f.wall - 1); }
        const from = new THREE.Vector3(to.x + this.ctx.rng.range(-4, 4), this.floorY() + 22, to.z + this.ctx.rng.range(-4, 4));
        this.hazards.lob({ from, to, time: 1.25, arc: 1, radius: 2.4, damage: 18, color: WARN, kind: 'meteor', element: 'fire', scale: 1.1 });
      });
    }
    this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.1, volume: 0.7 });
  }

  // ───────────── 阶段 ─────────────

  protected override onPhase(_phase: number): void {
    this.transPrev = -1;
    this.swapped = false;
    this.crackLeft = 0;
    this.fx?.clearPrints();
    this.fx?.clearBlades();
    this.leapFrom.copy(this.position);
    this.setAnim('rear', true);
    this.ctx.ui.toast('剩下的铁链全断了——巨鼎坠入熔池！', '#ff9a4a');
    this.purgeLocks();
    for (let i = 0; i < this.lockBroken.length; i++) this.lockBroken[i] = true;
    this.cauldron?.fall();
  }

  protected override transitionTick(t: number, dt: number): void {
    const was = this.transPrev;
    this.transPrev = t;
    const crossed = (x: number): boolean => was < x && t >= x;
    const C = this.furnace.center;
    this.velocity.set(0, 0, 0);
    if (!this.swapped) {
      // 0–1.1 秒：跳进熔池中央；1.1–1.9 秒：沉下去
      const k = easeInOut(span(t, 0.2, 1.1));
      this.position.x = mix(this.leapFrom.x, C.x, k);
      this.position.z = mix(this.leapFrom.z, C.z, k);
      this.position.y = this.floorY() + Math.sin(Math.PI * k) * 7;
      this.flyTargetY = this.position.y;
      this.facing = rotateTowards(this.facing, this.yawToPlayer(), 2 * dt);
      this.sinkY = -9 * easeInOut(span(t, 1.1, 1.9));
      if (crossed(0.2)) this.setAnim('tuck', true);
      if (crossed(1.1)) {
        this.ctx.fx.burst(_v.set(C.x, C.y + 0.5, C.z), FIRE, 50, 12, 1.2, 0.5, 8);
        this.ctx.audio.play('explosion', { position: C, pitch: 0.5, volume: 1 });
      }
    }
    // 熔岩柱：1.0 → 1.6 冲满，保持到 3.4，4.6 落下
    const col = t < 1.0 ? 0 : t < 1.6 ? (t - 1.0) / 0.6 : t < 3.4 ? 1 : Math.max(0, 1 - (t - 3.4) / 1.2);
    this.fx?.eruption(col);
    if (crossed(1.9)) this.swapToBurn();
    if (this.swapped) {
      // 2.2–3.6 秒：从熔岩里冲出来，升到踏云高度
      const k = easeOutCubic(span(t, 2.2, 3.6));
      this.sinkY = -9 * (1 - k);
      this.position.y = this.floorY() + SKY_ALT * k;
      this.flyTargetY = this.position.y;
      this.facing = rotateTowards(this.facing, this.yawToPlayer(), 2 * dt);
      if (crossed(2.4)) {
        // 鳞片炸飞
        this.getBodyCenter(_v);
        this.ctx.fx.burst(_v, SCALE_DARK, 60, 14, 1.4, 0.4, 14);
        this.ctx.fx.burst(_v, HOT, 40, 10, 1.0, 0.35, 4);
        this.ctx.fx.shake(0.6, 0.8);
      }
      if (crossed(3.8)) this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.2, volume: 1 });
    }
    if (t >= this.transitionDuration - dt * 1.5) {
      this.sinkY = 0;
      this.fx?.eruption(0);
      this.alt = SKY_ALT;
    }
  }

  /** 化焚身：在熔岩柱最浓的时候换模型（期间不可选中） */
  private swapToBurn(): void {
    this.swapped = true;
    this.useForm('burn');
    this.displayName = '火麒麟 · 焚身';
    // 玄铁鳞甲炸飞
    this.armor = 0;
    this.crackLeft = 0;
    this.ctx.ui.setBoss(this);
    this.ctx.ui.toast('火麒麟化为焚身——它会在半空踏云奔跑；三次俯冲后落地喘息，胸口火心和角根火珠是弱点', '#ffb070');
    this.orbit = furnaceAngle(this.furnace, this.ctx.player.position.x, this.ctx.player.position.z) + Math.PI;
    this.queueMove('flood');
  }

  protected override restFactor(): number {
    if (this.phase === 0) return this.phaseFraction() <= 0.7 ? 0.85 : 1;
    return this.enraged() ? 0.65 : 0.9;
  }

  // ───────────── 常规行为 ─────────────

  protected override idle(dt: number): void {
    const f = this.furnace;
    if (this.form === 'xuan') {
      // 沿外环跑道小跑，绕到玩家那一侧，转头盯着玩家
      const pl = this.ctx.player.position;
      const R = this.trackR();
      const me = furnaceAngle(f, this.position.x, this.position.z);
      const want = furnaceAngle(f, pl.x, pl.z) + 0.6 * (angleDiff(furnaceAngle(f, pl.x, pl.z), me) >= 0 ? 1 : -1);
      const step = clamp(angleDiff(me, want), -0.35, 0.35);
      furnacePoint(f, me + step, R, _v);
      if (Math.abs(angleDiff(me, want)) > 0.15 || Math.abs(Math.hypot(this.position.x - f.center.x, this.position.z - f.center.z) - R) > 1.5) {
        this.moveTo(_v, 6.5, 0.8);
        this.faceMovement(3, dt);
      } else {
        this.stopMoving();
        this.facePlayer(2, dt);
      }
      this.alt = 0;
      return;
    }
    // 焚身：在半空绕殿弧线奔跑，越过熔岩渠；隔一阵掉头
    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0 || (this.moveResult.hitWall && this.orbitTimer < 4)) {
      this.orbitDir = this.orbitDir > 0 ? -1 : 1;
      this.orbitTimer = this.ctx.rng.range(5, 9);
    }
    this.orbit += this.orbitDir * 0.55 * dt;
    furnacePoint(f, this.orbit, (f.bridge[1] + f.wall) / 2 - 1, _v);
    this.moveTo(_v, 11, 1.0);
    this.faceMovement(3, dt);
    this.alt = SKY_ALT;
  }

  protected override passive(dt: number): void {
    const floor = this.floorY();
    // 高度：招式里直接驱动位置的阶段（跃起、俯冲）自己写 flyTargetY；其余按 alt 加一点起伏
    const directY = (this.current?.id === 'drink' && this.drinkStage === 'leap') || (this.current?.id === 'dives' && this.diveStage === 'dive');
    if (!directY) {
      const bob = this.form === 'burn' && this.alt > 1 ? Math.sin(this.age * 1.6) * 0.9 : 0;
      this.flyTargetY = floor + this.alt + bob;
    }
    // 饮熔血量线
    if (this.phase === 0 && this.drinksDone < DRINK_AT.length && this.phaseFraction() <= DRINK_AT[this.drinksDone]
      && this.current?.id !== 'drink' && this.current?.id !== 'stunned') {
      this.drinksDone++;
      this.queueMove('drink');
      if (!this.current) this.restLeft = 0;
    }
    // 鳞甲崩裂：全身都算弱点
    if (this.crackLeft > 0) {
      this.crackLeft = Math.max(0, this.crackLeft - dt);
      for (const s of this.xuan.shapes) s.weak = this.crackLeft > 0 || s.anchor === this.xuan.pts.pearl;
    }
    // 蹄印烧脚
    this.printHurtAcc += dt;
    if (this.printHurtAcc >= 0.4) {
      this.printHurtAcc = 0;
      const pl = this.ctx.player;
      if (pl.alive && pl.position.y - floor < 0.5 && this.fx?.printNear(pl.position.x, pl.position.z, 0.95)) this.hazards.hurt(7, 'fire', pl.position);
    }
    this.tickFlood(dt);
    // 焚身蹄下火云
    if (this.form === 'burn' && this.alive) {
      this.cloudAcc += dt;
      if (this.cloudAcc >= 0.05) {
        this.cloudAcc = 0;
        for (const n of ['hoofFL', 'hoofFR', 'hoofHL', 'hoofHR']) {
          const a = this.F.pts[n];
          if (!a || Math.random() < 0.4) continue;
          a.getWorldPosition(_v);
          _w.set((Math.random() - 0.5) * 1.5, -0.5 + Math.random(), (Math.random() - 0.5) * 1.5);
          this.fx?.emit(_v, _w, 0.55, 0.35 + Math.random() * 0.3, Math.random() < 0.35 ? HOT : FIRE, 2, 1.2);
        }
      }
    }
    if (this.enraged() && !this.rageTold) {
      this.rageTold = true;
      this.ctx.ui.toast('焚身狂怒——熔流轮转更快了', '#ff7a4a');
    }
    // 弱点光：平时微光；张鳞、被砸晕、喘息时大亮
    const bright = this.anim === 'stun' || this.anim === 'rear' || this.crackLeft > 0;
    this.pearlGlow += ((bright ? 1 : 0.35) - this.pearlGlow) * Math.min(1, dt * 4);
    this.heartGlow += ((this.anim === 'pant' ? 1 : 0.3) - this.heartGlow) * Math.min(1, dt * 4);
  }

  // ───────────── 登场 / 动画 ─────────────

  protected override entrance(t: number, dt: number): void {
    // 熔池里冲起熔岩柱，麒麟从池心跃出，落在朝刷新点那一侧的池边
    this.fx?.eruption(t < 0.3 ? 0.7 : 0);
    const k = easeInOut(span(t, 0.12, 0.45));
    const lift = Math.sin(Math.PI * k) * 7 - 8 * (1 - span(t, 0, 0.14));
    _v.subVectors(this.entranceFrom, this.position).multiplyScalar(1 - k);
    // 世界偏移 → root 局部（root 绕 Y 转 facing）
    const c = Math.cos(-this.facing), s = Math.sin(-this.facing);
    this.model.position.set(_v.x * c + _v.z * s, lift, -_v.x * s + _v.z * c);
    if (t >= 1) {
      this.model.position.set(0, 0, 0);
      return;
    }
    if (k >= 1 && !this.entranceRoared) {
      this.entranceRoared = true;
      this.setAnim('rear', true);
      this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.8 });
      this.ctx.fx.ring(_w.set(this.position.x, this.floorY() + 0.1, this.position.z), 12, WARN, 1.0);
      this.ctx.fx.shake(0.6, 1.0);
    } else if (!this.entranceRoared) {
      this.setAnim('tuck');
    }
    this.animate(dt);
  }

  protected override onEntranceEnd(): void {
    this.model.position.set(0, 0, 0);
    this.setAnim('idle');
    this.restLeft = 1.2;
    this.spawnLocks();
    // 名称横幅已由关卡导演在刷出时显示，这里只补一条弱点提示
    this.ctx.ui.toast('火麒麟·玄鳞——角根的火珠是弱点；它饮熔时，打碎它身后外墙上的锁扣，让巨鼎砸它', '#ffb070');
  }

  protected override animate(dt: number): void {
    // 实际水平速度（步态频率）
    const sp = Math.hypot(this.position.x - this.prevPos.x, this.position.z - this.prevPos.z) / Math.max(dt, 1e-4);
    this.prevPos.copy(this.position);
    this.moveSpeed = mix(this.moveSpeed, Math.min(sp, 40), 1 - Math.exp(-8 * dt));
    this.animateBody(dt);
    this.updateGlow();
  }

  private updateGlow(): void {
    const f = this.F;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 5);
    if (f.native?.glowShell) f.native.glowShell.opacity = (0.15 + 0.55 * this.pearlGlow) * (0.75 + 0.25 * pulse);
    this.setRoleOpacity('pearlHalo', (0.2 + 0.5 * this.pearlGlow) * (0.7 + 0.3 * pulse));
    this.setRoleOpacity('heartHalo', (0.15 + 0.7 * this.heartGlow) * (0.7 + 0.3 * pulse));
  }

  /**
   * 骨骼动画（creature_rigs/SK_Boss_Qilin*.json，角度不超过注册表 SK_Boss_Qilin.rom / SK_Boss_QilinBurn.rom）。
   * 模型空间：X = 生物左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾（腿向后摆、尾巴上翘、头往下）。
   * 步态：真实马的横向跑步（左后 → 右后 → 左前 → 右前），慢时是对角快步；前腿腕关节在摆动相向后折，后腿跗关节向前折。
   * 人立（张鳞）整只绕后蹄抬起；饮熔低头、前腿岔开；吐息张嘴、颈部跟着吐息方向；眩晕 / 喘息垂头。
   */
  private animateBody(dt: number): void {
    const a = this.anim;
    const moving = this.moveSpeed > 1.5;
    let gait = moving ? clamp(this.moveSpeed / 16, 0.35, 1) : 0;
    let rear = 0, drink = 0, stun = 0, tuck = 0, stomp = 0, jaw = 0.05, pitch = 0, lam = 6;
    if (a === 'rear' || a === 'scalesFire') { rear = a === 'rear' ? 1 : 0.7; jaw = 0.25; gait = 0; lam = 5; }
    else if (a === 'drink') { drink = 1; jaw = 0.2; gait = 0; pitch = 0.1; lam = 4; }
    else if (a === 'stun' || a === 'pant') { stun = 1; jaw = 0.25; gait = 0; lam = 5; }
    else if (a === 'breath') { jaw = 0.25; gait = 0; lam = 8; }
    else if (a === 'tuck' || a === 'leap') { tuck = 1; gait = 0; pitch = -0.1; lam = 8; }
    else if (a === 'stomp') { stomp = 1; gait = 0; pitch = 0.08; lam = 12; }
    else if (a === 'roar') { rear = 0.35; jaw = 0.25; gait = Math.min(gait, 0.4); }
    else if (a === 'paw') { gait = 0; jaw = 0.1; }
    if (this.form === 'burn' && this.alt > 1 && a !== 'stomp' && a !== 'tuck' && a !== 'breath') gait = Math.max(gait, 0.75);
    const k = 1 - Math.exp(-lam * dt);
    this.pGait = mix(this.pGait, gait, 1 - Math.exp(-5 * dt));
    this.pRear = mix(this.pRear, rear, k);
    this.pDrink = mix(this.pDrink, drink, k);
    this.pStun = mix(this.pStun, stun, k);
    this.pTuck = mix(this.pTuck, tuck, k);
    this.pStomp = mix(this.pStomp, stomp, k);
    this.pJaw = mix(this.pJaw, jaw, k);
    this.pPitch = mix(this.pPitch, pitch, k);
    let dy = this.yawToPlayer() - this.facing;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.pLook = mix(this.pLook, clamp(dy, -1, 1), 1 - Math.exp(-4 * dt));
    // 步频：跑步每步约 7 米（马鹿体型放大后），快步约 4 米
    const stride = this.pGait > 0.6 ? 7 : 4;
    const fly = this.form === 'burn' && this.alt > 1;
    this.gaitPhase += dt * TAU * (fly ? 1.6 : Math.max(0.8, this.moveSpeed / stride)) * (this.pGait > 0.02 ? 1 : 0);

    const f = this.F;
    const P = f.pose;
    P.reset();
    const g = this.pGait, ph = this.gaitPhase;
    const gallop = g > 0.6 || fly;
    // 每条腿的相位（跑步：横向跑步；快步：对角）
    const off = gallop
      ? { fL: 0.5, fR: 0.62, hL: 0, hR: 0.12 }
      : { fL: 0, fR: 0.5, hL: 0.5, hR: 0 };
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      const pf = ph + off[side === 'L' ? 'fL' : 'fR'] * TAU;
      const sf = Math.sin(pf), cf = Math.cos(pf);
      // 前腿：伸出 −0.55 ↔ 收拢 +0.35；向前摆动时腕关节向后折
      P.rotate(`upperarm_${side}`, AX, g * (-0.1 - 0.45 * sf) - 0.6 * this.pRear - 0.25 * this.pDrink + 0.1 * this.pStun - 0.4 * this.pTuck - 0.5 * this.pStomp);
      P.rotate(`forearm_${side}`, AX, g * 0.4 * Math.max(0, cf) + 0.3 * this.pRear + 0.4 * this.pTuck - 0.2 * this.pStomp);
      P.rotate(`fcannon_${side}`, AX, g * 1.15 * Math.max(0, cf) + 1.35 * this.pRear + 1.4 * this.pTuck);
      P.rotate(`upperarm_${side}`, AZ, s * (0.1 * this.pRear + 0.12 * this.pDrink + 0.15 * this.pStun));
      const ph2 = ph + off[side === 'L' ? 'hL' : 'hR'] * TAU;
      const sh = Math.sin(ph2), chh = Math.cos(ph2);
      // 后腿：蹬直向后 +0.45 ↔ 前摆 −0.55；向前摆动时跗关节向前折
      P.rotate(`thigh_${side}`, AX, g * (-0.05 + 0.5 * sh) + 0.35 * this.pRear - 0.6 * this.pTuck + 0.55 * this.pStomp);
      P.rotate(`shin_${side}`, AX, -g * 0.25 * Math.max(0, -chh) + 0.3 * this.pStomp);
      P.rotate(`hcannon_${side}`, AX, -g * 0.8 * Math.max(0, -chh) - 1.0 * this.pTuck);
      P.rotate(`thigh_${side}`, AZ, s * 0.12 * this.pStun);
    }
    // 躯干：跑步时脊柱屈伸，颈部反向点头
    const flex = Math.sin(ph * 2) * 0.05 * g;
    P.rotate('spine', AX, flex);
    P.rotate('chest', AX, -flex * 0.6);
    const breathe = Math.sin(this.age * (this.pStun > 0.5 ? 5 : 1.2)) * (0.02 + 0.03 * this.pStun);
    P.rotate('chest', AX, breathe);
    const look = this.pLook * (1 - this.pDrink) * (1 - this.pStun * 0.6);
    P.rotate('neck_1', AX, -0.35 * this.pRear + 0.5 * this.pDrink + 0.45 * this.pStun - 0.2 * this.pTuck + 0.3 * this.pStomp + 0.08 * g * Math.sin(ph * 2 + 1) + 0.12 * g);
    P.rotate('neck_2', AX, 0.35 * this.pDrink + 0.25 * this.pStun);
    P.rotate('head', AX, -0.15 * this.pRear + 0.15 * this.pDrink + 0.1 * this.pStun + 0.1 * this.pStomp - 0.03 * Math.sin(this.age * 0.8));
    P.rotate('neck_1', AY, 0.3 * look);
    P.rotate('neck_2', AY, 0.25 * look);
    P.rotate('head', AY, 0.1 * look);
    P.rotate('jaw', AX, Math.min(0.25, this.pJaw + (this.pStun > 0.5 ? 0.05 * Math.sin(this.age * 5) : 0)));
    // 尾：跑步时上翘、平时慢摆
    P.rotate('tail_1', AX, 0.3 * g + 0.35 * this.pRear - 0.2 * this.pStun);
    P.rotate('tail_1', AY, 0.2 * Math.sin(this.age * 1.1));
    P.rotate('tail_2', AY, 0.25 * Math.sin(this.age * 1.1 - 0.6));
    P.rotate('tail_3', AY, 0.25 * Math.sin(this.age * 1.1 - 1.2));
    P.rotate('tail_2', AX, 0.15 * g);

    // 宿主：人立绕后蹄抬起（−0.55 弧度），饮熔 / 踏地微微前倾；跑步时上下起伏
    const host = f.host;
    const hind = f.table.hoofHL.at[2] * SCALE;
    const phi = -0.55 * this.pRear + this.pPitch;
    const bob = g * 0.22 * Math.abs(Math.sin(ph)) * (gallop ? 1 : 0.5);
    host.rotation.set(phi, 0, this.form === 'burn' ? Math.sin(this.age * 0.9) * 0.03 * (fly ? 1 : 0) : 0);
    // 抬头（phi < 0）绕后蹄转：宿主平移 p − Rx(phi)·p，p = 后蹄 (0, 0, hind)；低头的小角度绕原点
    const pz = phi < 0 ? hind : 0;
    host.position.set(0, pz * Math.sin(phi) + bob + this.sinkY, pz * (1 - Math.cos(phi)));
  }

  // ───────────── 死亡 ─────────────

  protected override onBossDeath(_result: DamageResult): void {
    this.stopFlood();
    this.fx?.clearBlades();
    this.fx?.eruption(0.5);
    this.purgeLocks();
    this.ctx.ui.toast(this.form === 'xuan' ? '火麒麟倒下了——炉心的火熄了' : '焚身散成满地余烬——祝融炉心重归平静', '#ffb070');
  }

  protected override animateDeath(t: number): void {
    // 腿一软侧倒，余烬散去
    this.anim = 'stun';
    const dt = this.ctx.time.dt;
    this.alt = 0;
    this.animateBody(dt);
    const host = this.F.host;
    host.rotation.z = -1.2 * easeInOut(span(t, 0.15, 0.6));
    host.position.y = Math.min(host.position.y, 0);
    if (t > 0.5) this.fx?.eruption(0);
    this.setRoleOpacity('pearlHalo', 0.4 * Math.max(0, 1 - t));
    this.setRoleOpacity('heartHalo', 0.4 * Math.max(0, 1 - t));
    if (this.F.native?.glowShell) this.F.native.glowShell.opacity = 0.6 * Math.max(0, 1 - t);
    if (t >= 0.82) this.model.scale.setScalar(Math.max(0.01, 1 - (t - 0.82) / 0.18));
  }

  protected override onBossDispose(): void {
    this.stopFlood();
    this.fx?.dispose();
    this.fx = null;
    this.cauldron?.dispose();
    this.cauldron = null;
    for (const f of [this.xuan, this.burn]) {
      if (!f) continue;
      f.native?.dispose();
      f.native = null;
    }
  }
}

/** 测试与检视用：当前形态、场地、锁扣、吊鼎（只读） */
export function qilinDebug(b: Qilin): {
  form: FormId; furnace: Furnace; cauldron: QilinCauldron | null; crackLeft: number; drinksDone: number; fx: QilinFx | null;
} {
  const x = b as unknown as { form: FormId; furnace: Furnace; cauldron: QilinCauldron | null; crackLeft: number; drinksDone: number; fx: QilinFx | null };
  return { form: x.form, furnace: x.furnace, cauldron: x.cauldron, crackLeft: x.crackLeft, drinksDone: x.drinksDone, fx: x.fx };
}
