/**
 * 鲲鹏（第二章首领，北冥冰台）：《庄子》北冥之鱼，化而为鸟。两个形态各是一个模型，阶段转换时在冰雾里换模型。
 *
 * 场地：环形祭台围着中央冰窟（KunPengArena.locateIceHole 从导航网格找出冰窟的圆心、半径和环台外缘）。
 * 鲲始终在冰窟里，鹏在环台上空盘旋。冰窟本身的海水、浮冰、寒雾由 KunPengFx 画。
 *
 * 一阶段 · 鲲（头和前半身探出冰窟，冰线以下不建模）：
 *  - 吞吸：仰头张口 0.9 秒（面前扇形预警），随后 3 秒把扇形里的玩家一阵阵拉向冰窟（冰柱、矮墙挡得住）；
 *    收尾一口咬在冰沿上（冰沿圆形预警），被拉到冰沿的人吃重击并被甩开。
 *  - 猛砸：人立蓄力 1.1 秒（落点圆 + 冰浪扇形预警），整个前身砸在环台上：落点重击，再掀起一道沿扇形扩散的贴地冰浪（跳起躲开，
 *    掩体挡得住）。血量低于 75% 后连掀两道。砸下后头趴在环台上 0.8 秒——额头的鲛珠离地很近，是一阶段最好的输出窗口。
 *  - 潜袭：沉入冰窟（不可选中），在玩家所在的那一侧冰沿冒泡、亮出预警，1.3 秒后破冰而出（爆点重击 + 冰浪），环台上没有安全的角落。
 *  - 吐冰：玩家离得远时，朝玩家和两侧各吐一块带落点预警的抛物线冰弹。
 *  - 平时在冰窟里慢慢绕到玩家那一侧，转头盯着玩家。弱点：额头的鲛珠。
 * 转换（50%）：鲲吼叫着沉入冰窟，冰海炸开（整圈冰浪），冰雾爆闪盖住冰窟——在最浓的一刻换成鹏，鹏从雾里升空。
 * 二阶段 · 鹏（完整的展翅巨鸟，在环台上空盘旋）：
 *  - 扇翼狂风：飞到冰窟上空蓄力，环台外缘亮起一圈冻风带；随后 3.4 秒把玩家一阵阵推向外缘（冰柱后面不受风），外缘冻风带持续伤害。
 *  - 俯冲掠台：在玩家身边画出一条沿环台切线的长条预警，贴地高速掠过（侧移 / 冲刺躲开）；撞上冰柱、祭台会撞晕 1.8 秒。
 *    血量低于 25% 时连续俯冲两次。
 *  - 羽刃雨：拔高展翅，从翼尖洒下 10（25% 以下 14）枚冰羽刃，前三枚瞄准玩家，其余散落在玩家周围，落点都有预警。
 *  - 落台歇翼：飞累了（出两招之后）落到环台上收翼歇 4.8 秒——额头的鲛珠离地近、亮起来，是二阶段的主要输出窗口；
 *    落地与起飞各有一次有预警的翼风冲击。弱点：额头的鲛珠。
 * 美术：SK_Boss_Kun / SK_Boss_Peng（原生骨架，见 KunPengModel.ts）；资产缺失或 ?classic 时用程序化兜底模型，招式不变。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, rotateTowards, TAU } from '../../core/math';
import { BossBase, type HitShape } from './BossBase';
import { attachEnemyArt } from '../../assets/EnemyArt';
import type { NativeBody } from '../../assets/NativeRig';
import { holeAngle, holePoint, locateIceHole, type IceHole } from './KunPengArena';
import { KunPengFx } from './KunPengFx';
import {
  anchorOn, buildKunProc, buildPengProc, KUN_POINTS, PENG_POINTS, ProcPose, type KPPose, type ProcBody,
} from './KunPengModel';
import { easeInOut, easeOutCubic, span } from './parts';

export const KUNPENG_DEF: EnemyDef = {
  id: 'boss_kunpeng',
  name: '鲲鹏',
  hp: 4000,
  shield: 1200,
  speed: 9,
  radius: 3,
  height: 8,
  flying: true,
  damage: 14,
  coins: [70, 110],
  essence: 60,
  isBoss: true,
  headY: 7.5,
  headRadius: 0.6,
  knockbackResist: 1,
  color: 0x7fe8ff,
};

/** 两个形态的模型缩放（美术按 8 米制作）：鲲约 10.4 米高，鹏约 9.2 米 */
const KUN_SCALE = 1.3;
const PENG_SCALE = 1.15;
/** 鲲露出水面时模型原点（平切口）在水面下多深：切口永远藏在水里 */
const KUN_BASE_Y = -1.0;
/** 完全沉下去时的深度 */
const KUN_SUNK_Y = -14;
/**
 * 平切口的范围（模型单位，未缩放；creature_rigs/SK_Boss_Kun.json 的 spine_1 包围盒往里收一点）：往后、往前、往两侧。
 * animateKun 按当前俯仰 / 侧倾算出切口最高点，保证它始终在水面下 KUN_CUT_MARGIN 米（抬身 / 前扑时整只往下压）。
 */
const KUN_CUT_BACK = 3.0;
const KUN_CUT_FRONT = 2.8;
const KUN_CUT_SIDE = 2.8;
const KUN_CUT_MARGIN = 0.3;
/** 鲲身体中心离冰沿多远（往冰窟里收）：头部刚好探到冰沿上方 */
const KUN_INSET = 4.6;
/** 鹏盘旋高度（离地，模型原点 = 双爪）；飞越冰窟时不低于 PENG_OVER_HOLE（冰窟的白盒碰撞块高 10 米） */
const PENG_HOVER = 13.5;
const PENG_OVER_HOLE = 11.5;

const WARN = 0x7fd8ff;
const ICE = 0xd8f6ff;
const PEARL = 0x7ff0ff;
const GUST = 0xbfe9ff;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _save = new THREE.Vector3();
const _imp = new THREE.Vector3();

export type FormId = 'kun' | 'peng';

interface Form {
  host: THREE.Group;
  proc: ProcBody;
  pose: KPPose;
  native: NativeBody | null;
  /** 关键点锚点（挂在骨骼上） */
  pts: Record<string, THREE.Object3D>;
  shapes: HitShape[];
}

type SwoopStage = 'aim' | 'tele' | 'dive' | 'recover' | 'crash';
type PerchStage = 'approach' | 'descend' | 'rest' | 'takeoff';

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * 鲲的模型原点（平切口中心）最高能放到多高（相对水面所在的逻辑高度）：前倾时切口后缘翘起、后仰时前缘翘起、
 * 侧倾时一侧翘起——都要留在水面（KunPengFx 的海面在 +0.06）下 KUN_CUT_MARGIN 米。
 */
export function kunCutCeiling(pitch: number, roll: number): number {
  const sp = Math.sin(pitch);
  const lift = KUN_SCALE * (Math.max(KUN_CUT_BACK * sp, -KUN_CUT_FRONT * sp, 0) + KUN_CUT_SIDE * Math.abs(Math.sin(roll)));
  return 0.06 - KUN_CUT_MARGIN - lift;
}

export class KunPeng extends BossBase {
  private hole!: IceHole;
  private fx: KunPengFx | null = null;
  private kun!: Form;
  private peng!: Form;
  private form: FormId = 'kun';

  // ── 鲲 ──
  /** 鲲当前在冰窟的哪个方位（facing 约定，相对冰窟圆心） */
  private theta = 0;
  /** 0 = 露出水面，1 = 完全沉没（视觉） */
  private sunk = 1;
  /** 沉在水下：不可选中 */
  private submerged = false;
  private nextTheta = 0;
  private readonly impact = new THREE.Vector3();
  private readonly mouthPt = new THREE.Vector3();
  private pullAcc = 0;
  private inhaleTold = false;
  private bubbleAcc = 0;
  private enragedTold = false;
  private rageTold = false;

  // ── 鹏 ──
  private hoverAlt = PENG_HOVER;
  private orbit = 0;
  private orbitDir: 1 | -1 = 1;
  private orbitTimer = 6;
  private flapPhase = 0;
  private movesSincePerch = 0;
  private gustTold = false;
  private perchTold = false;
  private swoopStage: SwoopStage = 'aim';
  private stageT = 0;
  private swoopsLeft = 1;
  private readonly swoopFrom = new THREE.Vector3();
  private swoopYaw = 0;
  private swoopLen = 20;
  private swoopTravel = 0;
  private swoopHit = false;
  private perchStage: PerchStage = 'approach';
  private readonly perchAt = new THREE.Vector3();
  private rainCount = 10;
  private rainFired = 0;
  private trailAcc = 0;

  // ── 动画参数（平滑） ──
  private pRear = 0;
  private pWind = 0;
  private pSlam = 0;
  private pRoar = 0;
  private pFlare = 0;
  private pLook = 0;
  private pDive = 0;
  private pPerch = 0;
  private pTuck = 1;
  private pFlap = 1;
  private pPitch = 0;
  private pearlGlow = 0.3;
  private riseOffset = 0;
  private transFired = 0;
  private transPrev = -1;
  private entranceRoared = false;
  private splashAcc = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, KUNPENG_DEF, opts);
    this.displayName = '鲲鹏 · 鲲';
    this.thresholds = [0.5];
    this.spawnDuration = 3.0;
    this.deathDuration = 3.2;
    this.transitionDuration = 4.6;
    this.accel = 22;
    this.registerMoves();
  }

  // ───────────── 场地 / 模型 ─────────────

  override init(): void {
    // 在 BossBase.init（夹到竞技场、登场第一帧）之前就位：刷新点在冰窟哪一侧，鲲就从那一侧第一次探头
    this.hole = locateIceHole(this.ctx.nav, this.ctx.stage.arena, this.position);
    const d = Math.hypot(this.position.x - this.hole.center.x, this.position.z - this.hole.center.z);
    this.theta = d > 0.5 ? holeAngle(this.hole, this.position.x, this.position.z) : 0;
    this.placeKun(this.theta);
    this.facing = this.theta;
    this.position.y = this.hole.center.y;
    this.flyTargetY = this.position.y;
    this.velocity.set(0, 0, 0);
    super.init();
  }

  /** 冰窟半径里鲲身体中心所在的圈 */
  private kunRing(): number {
    return Math.max(1, this.hole.radius - KUN_INSET);
  }

  private placeKun(theta: number): void {
    holePoint(this.hole, theta, this.kunRing(), _v);
    this.position.x = _v.x;
    this.position.z = _v.z;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const kunHost = new THREE.Group();
    kunHost.name = 'kun_host';
    kunHost.scale.setScalar(KUN_SCALE);
    kunHost.position.y = KUN_SUNK_Y;
    root.add(kunHost);
    const pengHost = new THREE.Group();
    pengHost.name = 'peng_host';
    pengHost.scale.setScalar(PENG_SCALE);
    pengHost.visible = false;
    root.add(pengHost);
    const kp = buildKunProc(kunHost);
    const pp = buildPengProc(pengHost);
    this.kun = { host: kunHost, proc: kp, pose: new ProcPose(kp.joints), native: null, pts: {}, shapes: [] };
    this.peng = { host: pengHost, proc: pp, pose: new ProcPose(pp.joints), native: null, pts: {}, shapes: [] };
    return root;
  }

  protected override onModelReady(): void {
    // 两个形态各挂自己的美术身体（清单绑定 boss_kunpeng_kun / boss_kunpeng_peng，原生骨架）；BossBase 按 def.id 找不到资产，什么也不挂
    for (const [f, id] of [[this.kun, 'boss_kunpeng_kun'], [this.peng, 'boss_kunpeng_peng']] as const) {
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
        f.proc.group.visible = false;
        art.native.glowShell?.color.setHex(PEARL);
      }
    }
    this.buildAnchors(this.kun, KUN_POINTS);
    this.buildAnchors(this.peng, PENG_POINTS);
    const K = this.kun.pts;
    this.kun.shapes = [
      { anchor: K.pearl, radius: 0.6, halfHeight: 0, weak: true },
      { anchor: K.head, radius: 2.0, halfHeight: 0, weak: false },
      { anchor: K.snout, radius: 0.9, halfHeight: 0, weak: false },
      { anchor: K.neck, radius: 2.8, halfHeight: 0, weak: false },
      { anchor: K.body, radius: 3.0, halfHeight: 0, weak: false },
    ];
    const P = this.peng.pts;
    this.peng.shapes = [
      { anchor: P.pearl, radius: 0.5, halfHeight: 0, weak: true },
      { anchor: P.head, radius: 1.25, halfHeight: 0, weak: false },
      { anchor: P.chest, radius: 1.8, halfHeight: 0, weak: false },
      { anchor: P.hips, radius: 1.6, halfHeight: 0, weak: false },
      { anchor: P.wingL, radius: 1.6, halfHeight: 0, weak: false },
      { anchor: P.wingR, radius: 1.6, halfHeight: 0, weak: false },
    ];
    this.useForm('kun');
    this.fx = new KunPengFx(this.ctx, this.hole);
    this.fx.setAgitation(1);
  }

  private buildAnchors(f: Form, table: Record<string, { bone: string; at: readonly [number, number, number] }>): void {
    for (const [name, p] of Object.entries(table)) {
      const bone = f.pose.bone(p.bone) ?? f.host;
      f.pts[name] = anchorOn(f.host, bone, p.at, `kp_${name}`);
    }
  }

  private useForm(id: FormId): void {
    this.form = id;
    const f = id === 'kun' ? this.kun : this.peng;
    this.kun.host.visible = id === 'kun';
    this.peng.host.visible = id === 'peng';
    this.hitShapes = f.shapes;
    this.weakAnchor = f.pts.pearl;
    this.muzzleAnchor = id === 'kun' ? f.pts.mouth : f.pts.beak;
  }

  /** 契约 IEnemy.untargetable：BossBase 的登场 / 转换之外，鲲沉在水下时也不可选中 */
  override get untargetable(): boolean {
    return super.untargetable || this.submerged;
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const f = this.form === 'kun' ? this.kun : this.peng;
    const a = this.form === 'kun' ? f?.pts.neck : f?.pts.chest;
    return a ? a.getWorldPosition(out) : super.getBodyCenter(out);
  }

  override update(dt: number): void {
    if (!this.alive) {
      // 死亡演出由模型完成：逻辑位置钉住（鲲在冰窟的碰撞块里，重力下落会被推到块顶上；鹏的坠落是模型动画）
      _save.copy(this.position);
      super.update(dt);
      this.position.copy(_save);
      this.velocity.set(0, 0, 0);
    } else {
      super.update(dt);
    }
    this.fx?.update(dt);
  }

  // ───────────── 招式 ─────────────

  private isKun(): boolean {
    return this.phase === 0 && this.form === 'kun';
  }

  private isPeng(): boolean {
    return this.phase >= 1 && this.form === 'peng';
  }

  private enraged(): boolean {
    return this.phase >= 1 && this.phaseFraction() <= 0.25;
  }

  private registerMoves(): void {
    // ── 鲲 · 吞吸 ──
    this.addMove({
      id: 'inhale', cooldown: 11, recovery: 1.2,
      weight: () => (this.isKun() ? (this.distToPlayerXZ() > 14 ? 3 : 1.8) : 0),
      start: () => {
        this.setAnim('inhale', true);
        this.aimKunAtPlayer(1);
        this.computeMouth();
        const yaw = this.facing;
        this.hazards.sectorWarning(this.mouthPt.x, this.floorY(), this.mouthPt.z, yaw, 0.62, 22, 0.9, WARN);
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 0.7 });
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.5, volume: 0.9 });
        this.pullAcc = 0;
        if (!this.inhaleTold) {
          this.inhaleTold = true;
          this.ctx.ui.toast('鲲在吞吸——离开它面前的扇形，或者躲到冰柱后面！', '#8fe3ff');
        }
      },
      tick: (t, dt) => {
        this.stopMoving();
        this.holdKun();
        if (t >= 0.9 && t < 3.9) {
          this.fx?.suction(true, this.mouthPt, this.facing);
          this.fx?.setAgitation(1);
          this.pullAcc += dt;
          while (this.pullAcc >= 0.18) {
            this.pullAcc -= 0.18;
            this.pullPlayer();
          }
        }
        if (this.at(3.1)) {
          this.biteSpot(_v);
          this.hazards.groundWarning(_v.x, this.floorY(), _v.z, 5.5, 0.8, WARN);
        }
        if (this.at(3.9)) {
          this.fx?.suction(false);
          this.setAnim('bite', true);
          this.biteSpot(_v);
          this.hazards.blast(_v.x, this.floorY(), _v.z, 5.5, 32, { maxHeight: 4, knockback: 13, knockUp: 6 });
          this.ctx.fx.burst(_w.set(_v.x, this.floorY() + 1, _v.z), ICE, 26, 9, 0.8, 0.35, 10);
          this.ctx.fx.shake(0.45, 0.35);
          this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.5, volume: 1 });
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 1.2, volume: 0.6 });
        }
        return t >= 4.6;
      },
      end: () => {
        this.fx?.suction(false);
        this.fx?.setAgitation(0.35);
      },
    }, 2);

    // ── 鲲 · 猛砸冰浪 ──
    this.addMove({
      id: 'slam', cooldown: 7, recovery: 1.1,
      weight: () => (this.isKun() ? 2.6 : 0),
      start: () => {
        this.setAnim('slamWind', true);
        this.aimKunAtPlayer(0.9);
        const reach = (KUN_INSET + 3.2) * (KUN_SCALE / 1.3);
        this.impact.set(this.position.x + Math.sin(this.facing) * reach, this.floorY(), this.position.z + Math.cos(this.facing) * reach);
        const I = this.impact;
        this.hazards.groundWarning(I.x, I.y, I.z, 5, 1.1, WARN);
        this.hazards.sectorWarning(I.x, I.y, I.z, this.facing, 0.55, 26, 1.1, WARN);
        if (this.phaseFraction() <= 0.75) {
          this.hazards.sectorWarning(I.x, I.y, I.z, this.facing + 0.75, 0.3, 18, 1.1, WARN);
          this.hazards.sectorWarning(I.x, I.y, I.z, this.facing - 0.75, 0.3, 18, 1.1, WARN);
        }
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.8, volume: 0.8 });
      },
      tick: (t) => {
        this.stopMoving();
        this.holdKun();
        if (this.at(1.1)) {
          this.setAnim('slam', true);
          const I = this.impact;
          this.hazards.blast(I.x, I.y, I.z, 5, 30, { maxHeight: 3, knockback: 9, knockUp: 7 });
          this.hazards.wave({ x: I.x, y: I.y, z: I.z, speed: 15, maxRadius: 28, damage: 20, color: WARN, startRadius: 2.5,
            width: 1.2, height: 0.9, arcCenter: this.facing, arcHalf: 0.55, knockback: 9, dust: ICE });
          if (this.phaseFraction() <= 0.75) {
            for (const s of [-1, 1]) {
              this.hazards.wave({ x: I.x, y: I.y, z: I.z, speed: 13, maxRadius: 18, damage: 16, color: WARN, startRadius: 2.5,
                width: 1.1, height: 0.9, arcCenter: this.facing + 0.75 * s, arcHalf: 0.3, knockback: 8, dust: ICE });
            }
          }
          const fx = this.ctx.fx;
          fx.explosion(_v.set(I.x, I.y + 0.6, I.z), 4.5, ICE);
          fx.burst(_v, ICE, 40, 11, 1.0, 0.45, 16);
          fx.ring(_w.set(I.x, I.y + 0.1, I.z), 9, WARN, 0.7);
          fx.shake(0.7, 0.5);
          this.ctx.audio.play('boss_slam', { position: this.position, volume: 1 });
          this.ctx.audio.play('explosion', { position: this.position, pitch: 0.7, volume: 0.8 });
        }
        if (this.phaseFraction() <= 0.75 && this.at(1.55)) {
          const I = this.impact;
          this.hazards.wave({ x: I.x, y: I.y, z: I.z, speed: 18, maxRadius: 28, damage: 16, color: WARN, startRadius: 2.5,
            width: 1.1, height: 0.9, arcCenter: this.facing, arcHalf: 0.55, knockback: 8, dust: ICE });
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 1.3, volume: 0.6 });
        }
        // 头趴在环台上 0.8 秒（额头鲛珠离地近）后收回
        if (this.at(1.95)) this.setAnim('idle');
        return t >= 2.5;
      },
    }, 0.5);

    // ── 鲲 · 潜袭（从玩家那一侧破冰而出） ──
    this.addMove({
      id: 'dive', cooldown: 9, recovery: 0.8,
      weight: () => {
        if (!this.isKun()) return 0;
        const pl = this.ctx.player.position;
        const off = Math.abs(angleDiff(this.theta, holeAngle(this.hole, pl.x, pl.z)));
        return off > 1.2 ? 4 : 1.6;
      },
      start: () => {
        this.setAnim('sink', true);
        this.ctx.audio.play('boss_slam', { position: this.position, pitch: 0.6, volume: 0.6 });
        this.bubbleAcc = 0;
      },
      tick: (t, dt) => {
        this.stopMoving();
        if (t >= 0.5) this.submerged = true;
        if (this.at(0.7)) {
          const pl = this.ctx.player.position;
          this.nextTheta = holeAngle(this.hole, pl.x, pl.z) + this.ctx.rng.range(-0.35, 0.35);
          holePoint(this.hole, this.nextTheta, this.hole.radius + 1.5, this.impact);
          this.hazards.groundWarning(this.impact.x, this.floorY(), this.impact.z, 4.5, 1.3, WARN);
          this.ctx.audio.play('telegraph', { position: this.impact, pitch: 0.6 });
        }
        if (t > 0.7 && t < 2.0) {
          this.bubbleAcc += dt;
          if (this.bubbleAcc >= 0.12) {
            this.bubbleAcc = 0;
            holePoint(this.hole, this.nextTheta, this.hole.radius - 1.5 - Math.random() * 3, _v);
            _v.y = this.floorY() + 0.3;
            this.ctx.fx.burst(_v, ICE, 5, 4, 0.6, 0.3, 6);
          }
        }
        if (this.at(1.6)) {
          // 水下换位：鲲在新方位、面朝冰沿外
          this.theta = this.nextTheta;
          this.placeKun(this.theta);
          this.facing = this.theta;
          this.flyTargetY = this.position.y;
        }
        if (this.at(2.0)) {
          this.setAnim('erupt', true);
          this.submerged = false;
          const I = this.impact;
          this.hazards.blast(I.x, this.floorY(), I.z, 4.5, 26, { maxHeight: 4, knockback: 10, knockUp: 8 });
          this.hazards.wave({ x: I.x, y: this.floorY(), z: I.z, speed: 12, maxRadius: 12, damage: 14, color: WARN, startRadius: 2,
            width: 1, height: 0.85, arcCenter: this.theta, arcHalf: 1.2, knockback: 7, dust: ICE });
          this.ctx.fx.explosion(_v.set(I.x, this.floorY() + 0.8, I.z), 4, ICE);
          this.ctx.fx.burst(_v, ICE, 36, 12, 1.0, 0.45, 14);
          this.ctx.fx.shake(0.55, 0.45);
          this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.9 });
        }
        return t >= 3.0;
      },
      end: () => {
        this.submerged = false;
        this.setAnim('idle');
      },
    }, 6);

    // ── 鲲 · 吐冰 ──
    this.addMove({
      id: 'spit', cooldown: 5, recovery: 0.9,
      weight: () => (this.isKun() && this.distToPlayerXZ() > 12 ? 1.6 : 0),
      start: () => {
        this.setAnim('spit', true);
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.7 });
      },
      tick: (t, dt) => {
        this.stopMoving();
        this.holdKun();
        this.facePlayer(1.2, dt);
        if (this.at(0.7)) {
          this.getMuzzle(_a);
          const pl = this.ctx.player;
          const n = this.phaseFraction() <= 0.75 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * (3.2 + Math.floor((i - 1) / 2) * 3);
            _b.set(pl.position.x + pl.velocity.x * 0.6, this.floorY(), pl.position.z + pl.velocity.z * 0.6);
            const yaw = this.yawTo(_b.x, _b.z);
            _b.x += Math.cos(yaw) * side;
            _b.z -= Math.sin(yaw) * side;
            this.clampToRing(_b);
            this.hazards.lob({ from: _a, to: _b, time: 1.15, arc: 7, radius: 2.6, damage: 16, color: WARN, kind: 'ice', scale: 1.4 });
          }
          this.ctx.audio.play('enemy_shot', { position: this.position, pitch: 0.6, volume: 0.9 });
        }
        return t >= 1.3;
      },
    }, 3);

    // ── 鹏 · 扇翼狂风 ──
    this.addMove({
      id: 'gust', cooldown: 12, recovery: 1.2,
      weight: () => (this.isPeng() ? 2.0 : 0),
      start: () => {
        this.setAnim('gust', true);
        this.hoverAlt = PENG_OVER_HOLE + 1;
        this.accel = 26;
        this.movesSincePerch++;
      },
      tick: (t, dt) => {
        const C = this.hole.center;
        if (t < 1.6) this.moveTo(C, 14, 1);
        else this.stopMoving();
        this.facePlayer(2, dt);
        if (this.at(1.0)) {
          const o = this.hole.outer;
          this.hazards.zone({ x: C.x, y: this.floorY(), z: C.z, radius: o + 1, innerRadius: Math.max(this.hole.radius + 4, o - 5),
            duration: 3.6, arm: 1.0, damage: 8, interval: 0.4, color: GUST, element: 'none', maxHeight: 3, embers: 0xeaf8ff });
          this.ctx.audio.play('telegraph', { position: this.position, pitch: 0.8 });
          if (!this.gustTold) {
            this.gustTold = true;
            this.ctx.ui.toast('鹏扇起狂风——躲到冰柱后面，别被吹到环台外缘的冻风带里！', '#bfe9ff');
          }
        }
        if (t >= 2.0 && t < 5.4) {
          this.fx?.gust(true, C, this.hole.radius, this.hole.outer);
          this.pullAcc += dt;
          while (this.pullAcc >= 0.18) {
            this.pullAcc -= 0.18;
            this.gustPush();
          }
          this.trailAcc += dt;
          if (this.trailAcc >= 0.5) {
            this.trailAcc = 0;
            this.ctx.fx.shake(0.12, 0.3);
            this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.4, volume: 0.5 });
          }
        }
        if (this.at(5.4)) this.fx?.gust(false);
        return t >= 5.8;
      },
      end: () => {
        this.fx?.gust(false);
        this.hoverAlt = PENG_HOVER;
        this.accel = 22;
        this.pullAcc = 0;
      },
    }, 1.5);

    // ── 鹏 · 俯冲掠台 ──
    this.addMove({
      id: 'swoop', cooldown: 7, recovery: 1.0,
      weight: () => (this.isPeng() ? (this.distToPlayerXZ() > 10 ? 2.6 : 1.6) : 0),
      start: () => {
        this.swoopsLeft = this.enraged() ? 2 : 1;
        this.movesSincePerch++;
        this.beginSwoopAim();
      },
      tick: (_t, dt) => this.tickSwoop(dt),
      end: () => {
        this.accel = 22;
        this.hoverAlt = PENG_HOVER;
        this.pDive = 0;
      },
    }, 3.5);

    // ── 鹏 · 羽刃雨 ──
    this.addMove({
      id: 'rain', cooldown: 9, recovery: 1.0,
      weight: () => (this.isPeng() ? 2.0 : 0),
      start: () => {
        this.setAnim('spread', true);
        this.hoverAlt = 17;
        this.rainCount = this.enraged() ? 14 : 10;
        this.rainFired = 0;
        this.movesSincePerch++;
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.3 });
      },
      tick: (t, dt) => {
        this.stopMoving();
        this.facePlayer(2, dt);
        const t0 = 0.9;
        while (this.rainFired < this.rainCount && t >= t0 + this.rainFired * 0.11) this.fireFeather(this.rainFired++);
        return t >= t0 + this.rainCount * 0.11 + 0.6;
      },
      end: () => {
        this.hoverAlt = PENG_HOVER;
      },
    }, 5);

    // ── 鹏 · 落台歇翼（输出窗口） ──
    this.addMove({
      id: 'perch', cooldown: 14, recovery: 0.6,
      weight: () => (this.isPeng() && this.movesSincePerch >= 2 ? 3.4 : 0),
      start: () => {
        this.perchStage = 'approach';
        this.stageT = 0;
        this.setAnim('idle');
        this.pickPerchSpot();
        this.hoverAlt = Math.max(9, this.overHoleAlt(9));
        this.accel = 30;
      },
      tick: (_t, dt) => this.tickPerch(dt),
      end: () => {
        this.movesSincePerch = 0;
        this.hoverAlt = PENG_HOVER;
        this.accel = 22;
        this.pPerch = 0;
      },
    }, 10);
  }

  // ── 鲲：工具 ──

  /** 鲲在冰窟里的位置随 theta 固定；逻辑位置不靠速度移动（白盒里冰窟是碰撞块，零速度时不做碰撞推挤） */
  private holdKun(): void {
    this.flyTargetY = this.position.y;
    this.velocity.set(0, 0, 0);
  }

  /** 转向玩家（限制在冰窟外法线方向两侧 0.9 弧度内：鲲不会背对冰沿） */
  private aimKunAtPlayer(k: number): void {
    const want = clamp(angleDiff(this.theta, this.yawToPlayer()), -0.9, 0.9);
    this.facing = this.theta + want * k;
  }

  /** 口部投影到地面（吞吸气流的终点） */
  private computeMouth(): void {
    const reach = 3.4 * KUN_SCALE;
    this.mouthPt.set(this.position.x + Math.sin(this.facing) * reach, this.floorY() + 4.2, this.position.z + Math.cos(this.facing) * reach);
  }

  /** 吞吸收尾那一口咬在冰沿上的位置 */
  private biteSpot(out: THREE.Vector3): THREE.Vector3 {
    const r = KUN_INSET + 1.6;
    return out.set(this.position.x + Math.sin(this.facing) * r, this.floorY(), this.position.z + Math.cos(this.facing) * r);
  }

  /** 吞吸：扇形内、看得见（掩体挡气流）的玩家被一阵阵拉向口部 */
  private pullPlayer(): void {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const dx = this.mouthPt.x - pl.position.x;
    const dz = this.mouthPt.z - pl.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5 || d > 30) return;
    const off = Math.abs(angleDiff(this.facing, Math.atan2(-dx, -dz)));
    if (off > 0.75) return;
    // 气流从冰沿上方吹过来：从冰沿外 1 米、胸口高度连到玩家胸口，掩体挡住就不受影响
    this.biteSpot(_a);
    _a.y = this.floorY() + 1.3;
    _b.set(pl.position.x, pl.position.y + 1.2, pl.position.z);
    if (this.ctx.world.segmentBlocked(_a, _b)) return;
    const k = clamp(1.25 - d / 32, 0.5, 1.1);
    pl.applyImpulse(_imp.set((dx / d) * 3.4 * k, 0, (dz / d) * 3.4 * k));
  }

  /** 点夹到环台上（冰窟外 1 米、外缘内 1.5 米） */
  private clampToRing(p: THREE.Vector3): THREE.Vector3 {
    const C = this.hole.center;
    const dx = p.x - C.x;
    const dz = p.z - C.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = clamp(d, this.hole.radius + 1, this.hole.outer - 1.5);
    p.x = C.x + (dx / d) * r;
    p.z = C.z + (dz / d) * r;
    return p;
  }

  // ── 鹏：工具 ──

  /** 飞越冰窟上空时至少多高 */
  private overHoleAlt(alt: number): number {
    const d = Math.hypot(this.position.x - this.hole.center.x, this.position.z - this.hole.center.z);
    return d < this.hole.radius + this.radius + 1 && this.hole.found ? Math.max(alt, PENG_OVER_HOLE) : alt;
  }

  /** 狂风：冰窟上空吹向外缘；冰柱 / 矮墙后面不受风 */
  private gustPush(): void {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const C = this.hole.center;
    const dx = pl.position.x - C.x;
    const dz = pl.position.z - C.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return;
    // 风从冰沿上空横扫环台：从玩家方向的冰沿外 0.5 米、2 米高连到玩家胸口，冰柱 / 矮墙挡住就不受风
    holePoint(this.hole, Math.atan2(dx, dz), this.hole.radius + 0.5, _a);
    _a.y = this.floorY() + 2;
    _b.set(pl.position.x, pl.position.y + 1.2, pl.position.z);
    if (d > this.hole.radius + 1 && this.ctx.world.segmentBlocked(_a, _b)) return;
    pl.applyImpulse(_imp.set((dx / d) * 3.6, 0, (dz / d) * 3.6));
  }

  private beginSwoopAim(): void {
    this.swoopStage = 'aim';
    this.stageT = 0;
    this.setAnim('swoopReady', true);
    // 俯冲线：过玩家、沿环台切线方向；离冰窟太近就整条线外移，两端都留在环台内
    const pl = this.ctx.player.position;
    const C = this.hole.center;
    let ra = holeAngle(this.hole, pl.x, pl.z);
    let rp = Math.hypot(pl.x - C.x, pl.z - C.z);
    if (!(rp > 0.5)) { ra = this.facing; rp = this.hole.radius + 3; }
    rp = clamp(rp, this.hole.radius + 3, this.hole.outer - 4);
    const tangent = ra + (this.ctx.rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const half = Math.min(16, Math.sqrt(Math.max(4, (this.hole.outer - 3) ** 2 - rp * rp)));
    holePoint(this.hole, ra, rp, _v);
    this.swoopYaw = tangent;
    this.swoopFrom.set(_v.x - Math.sin(tangent) * half, this.floorY(), _v.z - Math.cos(tangent) * half);
    this.swoopLen = half * 2;
    this.hoverAlt = this.overHoleAlt(PENG_OVER_HOLE + 0.5);
    this.accel = 40;
    this.ctx.audio.play('enemy_alert', { position: this.position, pitch: 0.7 });
  }

  private tickSwoop(dt: number): boolean {
    this.stageT += dt;
    const F = this.swoopFrom;
    if (this.swoopStage === 'aim') {
      const arrived = this.moveTo(F, 22, 2.5);
      this.faceTowards(F, 4, dt);
      if (arrived || this.stageT > 1.8) {
        this.swoopStage = 'tele';
        this.stageT = 0;
        this.stopMoving();
        this.hoverAlt = 7;
        this.hazards.lineWarning(F.x, this.floorY(), F.z, this.swoopYaw, this.swoopLen, 2.3, 0.9, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      }
      return false;
    }
    if (this.swoopStage === 'tele') {
      this.stopMoving();
      this.facing = rotateTowards(this.facing, this.swoopYaw, 5 * dt);
      if (this.stageT >= 0.9) {
        this.swoopStage = 'dive';
        this.stageT = 0;
        this.swoopTravel = 0;
        this.swoopHit = false;
        this.accel = 90;
        this.hoverAlt = 0.6;
        this.velocity.y = Math.min(this.velocity.y, -10);
        this.setAnim('dive', true);
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.5, volume: 0.8 });
        this.peng.pts.talons.getWorldPosition(_prev);
      }
      return false;
    }
    if (this.swoopStage === 'dive') {
      this.setMove(Math.sin(this.swoopYaw), Math.cos(this.swoopYaw), 26);
      this.facing = this.swoopYaw;
      this.swoopTravel += Math.hypot(this.velocity.x, this.velocity.z) * dt;
      // 判定：从双爪到胸口的一段（随俯冲姿势倾斜），加上这一帧双爪扫过的路径
      this.peng.pts.talons.getWorldPosition(_a);
      this.peng.pts.chest.getWorldPosition(_b);
      if (!this.swoopHit && (this.hazards.segmentHitsPlayer(_a, _b, 1.6) || this.hazards.segmentHitsPlayer(_prev, _a, 1.6))) {
        this.swoopHit = true;
        this.hazards.hurt(30, 'none', this.position);
        this.ctx.player.applyImpulse(_imp.set(Math.sin(this.swoopYaw) * 12, 6, Math.cos(this.swoopYaw) * 12));
        this.ctx.fx.shake(0.5, 0.35);
        this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.7 });
      }
      _prev.copy(_a);
      this.trailAcc += dt;
      if (this.trailAcc >= 0.05) {
        this.trailAcc = 0;
        this.ctx.fx.burst(_a, ICE, 4, 2, 0.6, 0.35, -1);
      }
      const crashed = this.moveResult.hitWall && this.stageT > 0.2;
      if (this.swoopTravel >= this.swoopLen || crashed || this.stageT > 2.6) {
        this.stageT = 0;
        this.stopMoving();
        this.accel = 22;
        if (crashed) {
          this.swoopStage = 'crash';
          this.setAnim('crash', true);
          this.hoverAlt = 0;
          this.ctx.fx.shake(0.5, 0.4);
          this.ctx.fx.burst(_a, ICE, 24, 8, 0.9, 0.4, 12);
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 1.1 });
        } else {
          this.swoopStage = 'recover';
          this.setAnim('idle');
          this.hoverAlt = PENG_HOVER;
        }
      }
      return false;
    }
    this.stopMoving();
    this.facePlayer(2.5, dt);
    const wait = this.swoopStage === 'crash' ? 1.8 : 0.6;
    if (this.stageT >= wait) {
      this.swoopsLeft--;
      if (this.swoopsLeft > 0) {
        this.beginSwoopAim();
        return false;
      }
      return true;
    }
    return false;
  }

  private fireFeather(i: number): void {
    const pl = this.ctx.player;
    const tip = this.peng.pts[i % 2 ? 'wingL' : 'wingR'];
    tip.getWorldPosition(_a);
    if (i < 3) {
      const lead = 0.6 + i * 0.25;
      _b.set(pl.position.x + pl.velocity.x * lead, this.floorY(), pl.position.z + pl.velocity.z * lead);
    } else {
      const a = this.ctx.rng.range(0, TAU);
      const r = 2.5 + this.ctx.rng.range(0, 7);
      _b.set(pl.position.x + Math.sin(a) * r, this.floorY(), pl.position.z + Math.cos(a) * r);
    }
    if (this.hole.found) this.clampToRing(_b);
    const dur = 1.05;
    const to = _b.clone();
    const ok = this.fx?.launchFeather(_a, to, dur, (p) => {
      if (!this.alive) return;
      this.hazards.blast(p.x, p.y, p.z, 2.1, 15, { maxHeight: 2.2, knockback: 4, knockUp: 3 });
      this.ctx.fx.burst(_v.set(p.x, p.y + 0.3, p.z), ICE, 10, 6, 0.6, 0.3, 14);
      this.ctx.audio.play('enemy_shot', { position: _v, pitch: 1.6, volume: 0.45 });
    });
    if (ok) {
      this.hazards.groundWarning(to.x, to.y, to.z, 2.1, dur, WARN, 'hazard');
      if (i % 3 === 0) this.ctx.audio.play('enemy_shot', { position: this.position, pitch: 1.3, volume: 0.5 });
    }
  }

  /**
   * 落台点：玩家所在方位往一侧偏 0.55–1.1 弧度的环台中线。优先选脚下（鹏的碰撞方块那么大）全是平地的点——
   * 东西两座 2.5 米祭台和台阶不落；实在找不到平地，就按实际落脚高度（祭台顶）结算落地冲击和预警。
   */
  private pickPerchSpot(): void {
    const pl = this.ctx.player.position;
    const floor = this.floorY();
    const side = this.ctx.rng.sign();
    const base = holeAngle(this.hole, pl.x, pl.z);
    const first = this.ctx.rng.range(0.55, 1.1);
    const foot = this.radius * 0.85 + 0.3;
    let fallback = false;
    for (const off of [first, first + 0.35, first - 0.3, first + 0.7, -first, -first - 0.35, first + 1.1, -first + 0.3]) {
      holePoint(this.hole, base + side * off, (this.hole.radius + this.hole.outer) / 2, _v);
      if (!this.ctx.nav.nearestWalkable(_v, _w)) _w.copy(_v);
      const gy = this.ctx.world.groundHeight(_w.x, _w.z, floor + 8, foot);
      const top = Number.isFinite(gy) ? Math.max(gy, floor) : floor;
      // （foot 比碰撞方块略宽：落点离祭台 / 冰柱留 0.3 米余量）
      if (!fallback) {
        this.perchAt.set(_w.x, top, _w.z);
        fallback = true;
      }
      if (top - floor < 0.3) {
        this.perchAt.set(_w.x, top, _w.z);
        return;
      }
    }
  }

  /** 鹏脚下（整个碰撞方块范围内）最高的地面：平地 = floorY，压到祭台 / 冰柱时 = 台顶 */
  private groundUnder(x: number, z: number): number {
    const floor = this.floorY();
    const gy = this.ctx.world.groundHeight(x, z, floor + 8, this.radius * 0.85);
    return Number.isFinite(gy) ? Math.max(floor, gy) : floor;
  }

  private tickPerch(dt: number): boolean {
    this.stageT += dt;
    const L = this.perchAt;
    if (this.perchStage === 'approach') {
      this.hoverAlt = this.overHoleAlt(9);
      const arrived = this.moveTo(L, 16, 1.2);
      this.faceTowards(L, 3, dt);
      if (arrived || this.stageT > 3) {
        this.perchStage = 'descend';
        this.stageT = 0;
        this.stopMoving();
        // 就地落下（离落点不远时以自己脚下为准），落地冲击按脚下实际的地面高度结算（平地，或万不得已时的祭台顶）
        const floor = this.floorY();
        if (Math.hypot(this.position.x - L.x, this.position.z - L.z) < 2.5) {
          L.x = this.position.x;
          L.z = this.position.z;
        }
        L.y = this.groundUnder(L.x, L.z);
        this.hoverAlt = L.y - floor;
        // 收住冲过头的速度：就地垂直落下，不往前滑出预警圈
        this.velocity.x *= 0.25;
        this.velocity.z *= 0.25;
        this.hazards.groundWarning(L.x, L.y, L.z, 5, 0.9, WARN);
        this.ctx.audio.play('telegraph', { position: L, pitch: 0.9 });
      }
      return false;
    }
    this.stopMoving();
    if (this.perchStage === 'descend') {
      this.facePlayer(2, dt);
      this.moveTo(L, 6, 0.3);
      if (this.stageT >= 0.9) {
        this.perchStage = 'rest';
        this.stageT = 0;
        this.setAnim('perch', true);
        // 落地冲击在实际落脚处、按脚下实际的地面高度结算
        L.set(this.position.x, this.groundUnder(this.position.x, this.position.z), this.position.z);
        this.hazards.blast(L.x, L.y, L.z, 5, 18, { maxHeight: 3, knockback: 9, knockUp: 4 });
        this.hazards.wave({ x: L.x, y: L.y, z: L.z, speed: 12, maxRadius: 11, damage: 10, color: WARN, startRadius: 3, width: 0.9, height: 0.8, knockback: 6, dust: ICE });
        this.ctx.fx.shake(0.55, 0.4);
        this.ctx.fx.burst(_v.set(L.x, L.y + 0.5, L.z), ICE, 30, 9, 0.9, 0.4, 12);
        this.ctx.audio.play('boss_slam', { position: L, pitch: 0.9 });
        if (!this.perchTold) {
          this.perchTold = true;
          this.ctx.ui.toast('鹏落台歇翼——趁现在打它额头的鲛珠！', '#ffe08a');
        }
      }
      return false;
    }
    if (this.perchStage === 'rest') {
      this.facePlayer(0.8, dt);
      if (this.stageT >= 4.0 && this.stageT - dt < 4.0) {
        this.hazards.groundWarning(L.x, L.y, L.z, 7, 0.8, WARN);
        this.ctx.audio.play('telegraph', { position: L, pitch: 1.1 });
      }
      if (this.stageT >= 4.8) {
        this.perchStage = 'takeoff';
        this.stageT = 0;
        this.setAnim('takeoff', true);
        this.hazards.blast(L.x, L.y, L.z, 7, 14, { maxHeight: 4, knockback: 13, knockUp: 5 });
        this.ctx.fx.ring(_v.set(L.x, L.y + 0.1, L.z), 8, GUST, 0.6);
        this.ctx.fx.burst(_v.set(L.x, L.y + 1, L.z), ICE, 26, 10, 0.8, 0.4, 4);
        this.ctx.audio.play('boss_roar', { position: L, pitch: 1.3, volume: 0.8 });
        this.hoverAlt = PENG_HOVER;
      }
      return false;
    }
    return this.stageT >= 0.8;
  }

  // ───────────── 阶段 ─────────────

  protected override onPhase(_phase: number): void {
    this.transFired = 0;
    this.transPrev = -1;
    this.submerged = false;
    this.fx?.suction(false);
    this.fx?.setAgitation(1);
    this.setAnim('roar', true);
    this.ctx.ui.toast('鲲沉入冰窟——北冥要炸开了！', '#8fe3ff');
  }

  protected override transitionTick(t: number, dt: number): void {
    const was = this.transPrev;
    this.transPrev = t;
    const crossed = (x: number): boolean => was < x && t >= x;
    const C = this.hole.center;
    if (this.form === 'kun') {
      this.holdKun();
      this.aimKunAtPlayer(0.6);
      this.sunk = span(t, 0.6, 1.4);
    }
    if (crossed(1.3)) {
      // 冰海炸开：整圈冰浪 + 冰屑冲天
      const fx = this.ctx.fx;
      fx.explosion(_v.set(C.x, C.y + 1.5, C.z), Math.max(6, this.hole.radius * 0.6), ICE);
      fx.burst(_v, ICE, 60, 16, 1.4, 0.6, 12);
      fx.burst(_v.set(C.x, C.y + 4, C.z), 0xffffff, 40, 10, 1.6, 0.8, -2);
      fx.shake(0.85, 1.0);
      this.hazards.wave({ x: C.x, y: C.y, z: C.z, speed: 16, maxRadius: this.hole.outer + 2, damage: 10, color: WARN,
        startRadius: this.hole.radius, width: 1.2, height: 1.0, knockback: 8, dust: ICE });
      this.ctx.audio.play('explosion', { position: C, pitch: 0.55, volume: 1 });
      this.ctx.audio.play('shield_break', { position: C, pitch: 0.5, volume: 1 });
    }
    // 冰雾爆闪：1.2 → 1.55 涌满，保持到 2.6，4.0 散尽
    const fog = t < 1.2 ? 0 : t < 1.55 ? (t - 1.2) / 0.35 : t < 2.6 ? 1 : Math.max(0, 1 - (t - 2.6) / 1.4);
    this.fx?.flash(fog);
    if (crossed(1.55)) this.swapToPeng();
    if (this.form === 'peng') {
      // 鹏从雾里升起
      this.riseOffset = -14 * (1 - easeOutCubic(span(t, 1.55, 4.0)));
      this.facePlayer(1.5, dt);
      this.hoverAlt = PENG_OVER_HOLE + 1;
    }
    if (crossed(3.6)) {
      this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.45, volume: 1 });
      this.ctx.fx.shake(0.4, 0.8);
      this.getBodyCenter(_v);
      this.ctx.fx.burst(_v, ICE, 30, 10, 1.0, 0.4, 0);
    }
    if (t >= this.transitionDuration - dt * 1.5) {
      this.riseOffset = 0;
      this.fx?.flash(0);
    }
  }

  /** 化鹏：在冰雾最浓的一刻换模型（期间不可选中） */
  private swapToPeng(): void {
    const C = this.hole.center;
    this.useForm('peng');
    this.sunk = 1;
    this.position.set(C.x, this.floorY() + PENG_OVER_HOLE + 1, C.z);
    this.velocity.set(0, 0, 0);
    this.flyTargetY = this.position.y;
    this.hoverAlt = PENG_OVER_HOLE + 1;
    this.riseOffset = -14;
    this.orbit = holeAngle(this.hole, this.ctx.player.position.x, this.ctx.player.position.z) + Math.PI;
    this.displayName = '鲲鹏 · 鹏';
    // 化身后护盾重凝六成
    this.shield = Math.max(this.shield, this.maxShield * 0.6);
    this.ctx.ui.setBoss(this);
    this.ctx.ui.toast('北冥之鲲化而为鹏——它累了会落到环台上歇翼，额头的鲛珠仍是弱点', '#bfe9ff');
    this.fx?.setAgitation(0.5);
    this.queueMove('gust');
  }

  protected override restFactor(): number {
    if (this.phase === 0) return this.phaseFraction() <= 0.75 ? 0.8 : 1;
    return this.enraged() ? 0.7 : 0.9;
  }

  // ───────────── 常规行为 ─────────────

  protected override idle(dt: number): void {
    if (this.form === 'kun') {
      // 在冰窟里慢慢绕到玩家那一侧，转头盯着玩家
      this.stopMoving();
      const pl = this.ctx.player.position;
      this.theta = rotateTowards(this.theta, holeAngle(this.hole, pl.x, pl.z), 0.12 * dt);
      this.placeKun(this.theta);
      this.holdKun();
      const want = this.theta + clamp(angleDiff(this.theta, this.yawToPlayer()), -0.9, 0.9);
      this.facing = rotateTowards(this.facing, want, 1.2 * dt);
      return;
    }
    // 鹏：绕冰窟盘旋，隔一阵掉头
    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0 || (this.moveResult.hitWall && this.orbitTimer < 4)) {
      this.orbitDir = this.orbitDir > 0 ? -1 : 1;
      this.orbitTimer = this.ctx.rng.range(5, 9);
    }
    this.orbit += this.orbitDir * 0.24 * dt;
    holePoint(this.hole, this.orbit, (this.hole.radius + this.hole.outer) / 2, _v);
    this.moveTo(_v, this.def.speed * 0.95, 1.5);
    this.facePlayer(2.2, dt);
    this.hoverAlt = this.overHoleAlt(PENG_HOVER);
  }

  protected override passive(dt: number): void {
    if (this.form === 'peng') {
      const bob = this.anim === 'dive' || this.anim === 'perch' || this.hoverAlt <= 0.6 ? 0 : Math.sin(this.age * 1.3) * 0.5;
      const alt = this.current ? this.hoverAlt : this.overHoleAlt(this.hoverAlt);
      this.flyTargetY = this.floorY() + alt + bob;
    } else {
      this.holdKun();
    }
    if (this.phase === 0 && this.phaseFraction() <= 0.75 && !this.enragedTold) {
      this.enragedTold = true;
      this.ctx.ui.toast('鲲怒了——猛砸会连掀两道冰浪', '#8fe3ff');
    }
    if (this.enraged() && !this.rageTold) {
      this.rageTold = true;
      this.ctx.ui.toast('鹏狂怒了——俯冲会连掠两次，羽刃更密', '#bfe9ff');
    }
    // 鲛珠亮度：平时微光，猛砸趴台 / 鹏歇翼时大亮
    const bright = this.anim === 'slam' || this.anim === 'perch' || this.anim === 'crash';
    this.pearlGlow += ((bright ? 1 : 0.3) - this.pearlGlow) * Math.min(1, dt * 4);
    this.fx?.setAgitation(this.form === 'kun' ? (this.current?.id === 'inhale' || this.current?.id === 'dive' ? 1 : 0.35) : 0.25);
  }

  // ───────────── 登场 / 动画 ─────────────

  protected override entrance(t: number, dt: number): void {
    // 鲲从冰窟里升起：水面翻涌、冰沿炸起冰屑，升到一半时吼叫
    this.sunk = 1 - easeOutCubic(span(t, 0.1, 0.8));
    if (t >= 1) {
      this.sunk = 0;
      return;
    }
    this.splashAcc += dt;
    if (this.splashAcc >= 0.08 && t < 0.8) {
      this.splashAcc = 0;
      holePoint(this.hole, this.theta + (Math.random() - 0.5) * 0.8, this.kunRing() + Math.random() * 3, _v);
      _v.y = this.floorY() + 0.4;
      this.ctx.fx.burst(_v, ICE, 6, 6, 0.7, 0.35, 10);
    }
    if (t >= 0.72 && !this.entranceRoared) {
      this.entranceRoared = true;
      this.setAnim('roar', true);
      this.ctx.audio.play('boss_roar', { position: this.position, pitch: 0.75 });
      holePoint(this.hole, this.theta, this.hole.radius + 1, _v);
      this.ctx.fx.ring(_v.setY(this.floorY() + 0.1), 12, WARN, 1.0);
      this.ctx.fx.shake(0.6, 1.0);
    } else if (!this.entranceRoared) {
      this.setAnim('rise');
    }
    this.animate(dt);
  }

  protected override onEntranceEnd(): void {
    this.setAnim('idle');
    this.restLeft = 1.2;
    this.fx?.setAgitation(0.35);
    // 名称横幅已由关卡导演在刷出时显示，这里只补一条弱点提示
    this.ctx.ui.toast('北冥之鲲——它会从冰窟各处探头，额头的鲛珠是弱点', '#8fe3ff');
  }

  protected override animate(dt: number): void {
    if (this.form === 'kun') this.animateKun(dt);
    else this.animatePeng(dt);
    this.updatePearl();
  }

  private updatePearl(): void {
    const f = this.form === 'kun' ? this.kun : this.peng;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 5);
    const k = this.pearlGlow;
    if (f.native?.glowShell) f.native.glowShell.opacity = (0.15 + 0.55 * k) * (0.75 + 0.25 * pulse);
    this.setRoleOpacity('pearlHalo', (0.2 + 0.5 * k) * (0.7 + 0.3 * pulse));
  }

  /**
   * 鲲的骨骼动画（creature_rigs/SK_Boss_Kun.json，角度不超过注册表 SK_Boss_Kun.rom）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前倾。整个露出水面的身体绕水线（模型原点）俯仰 / 升降——切口在水下，大幅前扑不靠拉扯网格。
   * 切口始终压在水面下（kunCutCeiling）：前倾 / 后仰 / 抬身时整只往下沉，所以猛砸只前倾约 0.42 弧度——
   * 沉下去之后下巴刚好落在冰沿外约 1 米的环台上、额珠离地约 2 米（再倾就把头砸进环台里）。
   */
  private animateKun(dt: number): void {
    const a = this.anim;
    const t = this.animT;
    let rear = 0, wind = 0, slam = 0, roar = 0, flare = 0.1;
    let pitch = 0, rise = 0, lam = 6;
    if (a === 'inhale') { rear = 1; flare = 0.8; pitch = -0.12; lam = 5; }
    else if (a === 'bite') { slam = 0.55; pitch = 0.35; rise = -0.4; lam = 16; }
    else if (a === 'slamWind') { wind = 1; flare = 1; pitch = -0.25; rise = 1.6; lam = 4; }
    else if (a === 'slam') { slam = 1; pitch = t < 0.85 ? 0.42 : 0.38; rise = -0.6; lam = t < 0.2 ? 20 : 6; }
    else if (a === 'spit') { rear = t < 0.6 ? 0.8 : 0; slam = t >= 0.6 && t < 1.0 ? 0.4 : 0; pitch = t < 0.6 ? -0.1 : 0.12; lam = 9; }
    else if (a === 'roar' || a === 'rise') { roar = 1; flare = 1; pitch = -0.08; lam = 6; }
    else if (a === 'erupt') { roar = 0.7; flare = 1; rise = 1.2 * Math.max(0, 1 - t * 1.5); lam = 8; }
    else if (a === 'sink') { roar = 0.4; }
    const k = 1 - Math.exp(-lam * dt);
    this.pRear = mix(this.pRear, rear, k);
    this.pWind = mix(this.pWind, wind, k);
    this.pSlam = mix(this.pSlam, slam, k);
    this.pRoar = mix(this.pRoar, roar, k);
    this.pFlare = mix(this.pFlare, flare, k);
    this.pPitch = mix(this.pPitch, pitch, k);
    this.riseOffset = mix(this.riseOffset, rise, k);
    // 潜袭：0.0–0.7 沉、1.6 换位、2.0–2.8 浮起（转换与登场由各自的演出写 sunk）
    if (this.current?.id === 'dive') {
      const mt = this.moveT;
      this.sunk = mt < 2.0 ? easeInOut(span(mt, 0, 0.7)) : 1 - easeOutCubic(span(mt, 2.0, 2.7));
    } else if (this.transitionLeft <= 0 && this.entranceDone && this.alive) {
      this.sunk = Math.max(0, this.sunk - dt * 2);
    }
    let dy = this.yawToPlayer() - this.facing;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.pLook = mix(this.pLook, clamp(dy, -0.8, 0.8), 1 - Math.exp(-4 * dt));

    const host = this.kun.host;
    host.position.y = KUN_BASE_Y + this.riseOffset + (KUN_SUNK_Y - KUN_BASE_Y) * this.sunk;
    host.rotation.x = this.pPitch + Math.sin(this.age * 0.7) * 0.02;
    host.rotation.z = Math.sin(this.age * 0.45) * 0.03;
    host.position.y = Math.min(host.position.y, kunCutCeiling(host.rotation.x, host.rotation.z));

    const P = this.kun.pose;
    P.reset();
    const br = Math.sin(this.age * 0.8);
    const rr = this.pRear, ww = this.pWind, ss = this.pSlam, ro = this.pRoar;
    P.rotate('spine_2', AX, -0.1 * rr - 0.15 * ww + 0.18 * ss + 0.03 * br);
    P.rotate('spine_3', AX, -0.12 * rr - 0.15 * ww + 0.2 * ss - 0.15 * ro);
    P.rotate('head', AX, -0.2 * rr - 0.15 * ww + 0.15 * ss - 0.3 * ro - 0.04 * br);
    P.rotate('spine_2', AY, 0.12 * 0.5 * this.pLook);
    P.rotate('spine_3', AY, 0.15 * 0.5 * this.pLook);
    P.rotate('head', AY, 0.2 * 0.6 * this.pLook);
    P.rotate('spine_3', AZ, Math.sin(this.age * 0.6) * 0.04);
    const flareAng = 0.08 + 0.04 * Math.sin(this.age * 1.4) + 0.33 * this.pFlare;
    P.rotate('fin_L', AZ, -flareAng);
    P.rotate('fin_R', AZ, flareAng);
    const sw = this.age * 1.1;
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      P.rotate(`barbel_${side}_1`, AX, 0.12 * Math.sin(sw + (s > 0 ? 0 : 1.3)));
      P.rotate(`barbel_${side}_1`, AZ, -s * (0.25 * rr + 0.3 * ro));
      P.rotate(`barbel_${side}_2`, AX, 0.15 * Math.sin(sw - 0.6) + 0.3 * ss);
      P.rotate(`barbel_${side}_3`, AX, 0.18 * Math.sin(sw - 1.2));
    }
  }

  /**
   * 鹏的骨骼动画（creature_rigs/SK_Boss_Peng.json，角度不超过注册表 SK_Boss_Peng.rom）。
   * 扇翼：上半扇（wing_*_1..3）绕前后轴向外下压，下压时下半扇（wing_*_low）向外上张开，整扇像折扇；上提时两半一起收回。
   * 飞行时整只鸟绕双爪前倾、双爪收向身后；俯冲收翼伸爪；歇翼时直立（绑定姿势就是四视图里举翼的站姿）。
   */
  private animatePeng(dt: number): void {
    const a = this.anim;
    let dive = 0, perch = 0, tuck = 1, flap = 1, rate = 1.25, pitch = 0.3, lam = 5;
    if (a === 'dive') { dive = 1; tuck = 0; flap = 0.15; rate = 2.2; pitch = 0.85; lam = 10; }
    else if (a === 'swoopReady') { flap = 1.1; rate = 1.6; pitch = 0.45; }
    else if (a === 'perch') { perch = 1; tuck = 0; flap = 0.06; rate = 0.5; pitch = 0; lam = 4; }
    else if (a === 'crash') { perch = 0.6; tuck = 0; flap = 0.3; rate = 3; pitch = 0.5; lam = 8; }
    else if (a === 'takeoff') { tuck = 0.5; flap = 1.25; rate = 1.9; pitch = 0.15; lam = 7; }
    else if (a === 'gust') { flap = 1.3; rate = 1.7; pitch = 0.1; }
    else if (a === 'spread') { flap = 0.45; rate = 0.9; pitch = 0.2; }
    else if (a === 'roar') { flap = 1.2; rate = 1.5; pitch = 0.05; }
    if (this.transitionLeft > 0) { flap = 1.3; rate = 1.8; pitch = 0.05; tuck = 0.6; }
    const k = 1 - Math.exp(-lam * dt);
    this.pDive = mix(this.pDive, dive, k);
    this.pPerch = mix(this.pPerch, perch, k);
    this.pTuck = mix(this.pTuck, tuck, k);
    this.pFlap = mix(this.pFlap, flap, k);
    this.pPitch = mix(this.pPitch, pitch, k);
    this.flapPhase += dt * rate * TAU;
    let dy = this.yawToPlayer() - this.facing;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.pLook = mix(this.pLook, clamp(dy, -1, 1), 1 - Math.exp(-4 * dt));

    const host = this.peng.host;
    host.position.y = this.riseOffset;
    host.rotation.x = this.pPitch + (a === 'crash' ? Math.sin(this.age * 7) * 0.08 : 0);
    host.rotation.z = a === 'crash' ? Math.sin(this.age * 5) * 0.1 : Math.sin(this.age * 0.9) * 0.04;

    const P = this.peng.pose;
    P.reset();
    const fl = this.pFlap, dv = this.pDive, pr = this.pPerch, tk = this.pTuck;
    const ph = this.flapPhase;
    // 上半扇：外下压为负（左翼），范围 [-0.7, +0.2]；歇翼时收拢 +0.2
    const w1 = fl * -(0.25 + 0.45 * Math.sin(ph)) + 0.2 * pr + 0.25 * dv;
    const w2 = fl * -(0.12 + 0.12 * Math.sin(ph - 0.4)) + 0.15 * pr;
    const w3 = fl * -(0.06 + 0.09 * Math.sin(ph - 0.8));
    const wl = (w1 < 0 ? -0.4 * w1 : 0.5 * w1) + 0.15 * dv;
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      P.rotate(`wing_${side}_1`, AX, -0.35 * dv);
      P.rotate(`wing_${side}_1`, AZ, s * w1);
      P.rotate(`wing_${side}_2`, AZ, s * w2);
      P.rotate(`wing_${side}_3`, AZ, s * w3);
      P.rotate(`wing_${side}_low`, AX, -0.2 * dv);
      P.rotate(`wing_${side}_low`, AZ, s * wl);
      // 腿：飞行收向身后，俯冲前伸张爪
      P.rotate(`thigh_${side}`, AX, 0.45 * tk - 0.45 * dv);
      P.rotate(`shin_${side}`, AX, 0.2 * tk);
      P.rotate(`talon_${side}`, AX, 0.35 * tk - 0.3 * dv);
      P.rotate(`barbel_${side}_1`, AX, 0.12 * Math.sin(this.age * 1.6 + (s > 0 ? 0 : 1)) + 0.1 * dv);
      P.rotate(`barbel_${side}_2`, AX, 0.15 * Math.sin(this.age * 1.6 - 0.6));
    }
    P.rotate('hips', AX, 0.03 * Math.sin(ph + 0.5) * fl);
    P.rotate('neck', AX, 0.15 * dv + 0.12 * pr - 0.06 * Math.abs(this.pLook));
    P.rotate('head', AX, 0.2 * dv + 0.2 * pr - 0.1 + 0.04 * Math.sin(this.age * 0.8));
    P.rotate('neck', AY, 0.1 * this.pLook);
    P.rotate('head', AY, 0.12 * this.pLook);
    P.rotate('tail_1', AX, -0.15 + 0.05 * Math.sin(ph + 1) * fl - 0.05 * pr);
    P.rotate('tail_2', AY, 0.1 * Math.sin(this.age * 0.9));
    P.rotate('tail_3', AY, 0.12 * Math.sin(this.age * 0.9 - 0.5));
    P.rotate('tail_2', AX, -0.1 * (1 - pr));
  }

  // ───────────── 死亡 ─────────────

  protected override onBossDeath(_result: DamageResult): void {
    this.submerged = false;
    this.fx?.clearFeathers();
    this.fx?.suction(false);
    this.fx?.gust(false);
    this.fx?.flash(0);
    this.fx?.setAgitation(1);
    this.ctx.ui.toast(this.form === 'kun' ? '北冥之鲲沉入了冰海' : '鹏坠入北冥——冰海重归平静', '#bfe9ff');
  }

  protected override animateDeath(t: number): void {
    const dt = this.ctx.time.dt;
    if (this.form === 'kun') {
      // 鲲仰头长啸后沉回冰窟
      this.sunk = easeInOut(span(t, 0.25, 1));
      this.anim = 'roar';
      this.animateKun(dt);
    } else {
      // 鹏收翼坠落（模型动画：逻辑位置钉住），落到地面高度后碎成冰屑
      const drop = Math.max(0, this.position.y - this.floorY());
      const e = t * t;
      this.peng.host.position.y = -drop * Math.min(1, e * 1.2);
      this.peng.host.rotation.x = 0.3 + 1.0 * t;
      this.peng.host.rotation.z = Math.sin(t * 9) * 0.2 * (1 - t);
      const P = this.peng.pose;
      P.reset();
      for (const [side, s] of [['L', 1], ['R', -1]] as const) {
        P.rotate(`wing_${side}_1`, AZ, s * 0.25 * t);
        P.rotate(`wing_${side}_low`, AZ, s * 0.2 * t);
      }
      P.rotate('head', AX, 0.25 * t);
    }
    this.setRoleOpacity('pearlHalo', 0.4 * Math.max(0, 1 - t));
    const f = this.form === 'kun' ? this.kun : this.peng;
    if (f.native?.glowShell) f.native.glowShell.opacity = 0.6 * Math.max(0, 1 - t);
    if (t >= 0.82) this.model.scale.setScalar(Math.max(0.01, 1 - (t - 0.82) / 0.18));
  }

  protected override onBossDispose(): void {
    this.fx?.dispose();
    this.fx = null;
    for (const f of [this.kun, this.peng]) {
      if (!f) continue;
      f.native?.dispose();
      f.native = null;
    }
  }
}

/** 测试与检视用：当前形态与场地（只读） */
export function kunPengDebug(b: KunPeng): { form: FormId; hole: IceHole; submerged: boolean } {
  const x = b as unknown as { form: FormId; hole: IceHole; submerged: boolean };
  return { form: x.form, hole: x.hole, submerged: x.submerged };
}

