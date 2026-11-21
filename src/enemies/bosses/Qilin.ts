/**
 * 火麒麟（Unity Qilin/QilinBrain.cs 的网页版；定义 QilinDef.ts，招式 QilinMoves.ts，殿的几何 QilinFurnace.ts，熔流 QilinFlood.ts，登场 QilinIntro.ts）。
 * 首领框架（framework/BossBrain）之上加这几层：
 *   · 场地：炉心殿几何（Unity 场景 3-4：场景文档的首领场地 + Level_3_4 的常量；白盒 inferno-5：QilinArena 从熔岩掩码反推）、吊鼎与四个锁扣
 *     （QilinCauldron / QilinLock；Unity 场景里的正式件 SM_Prop_QilinCauldron / SM_Prop_QilinChainLock 由它们认领、跟着动）、熔岩柱（QilinFx）。
 *   · 登场：从池心的熔岩柱里跃出（模型偏移，逻辑位置不动），落在熔池北沿人立长啸；登场演出（intro/BossIntroDirector）接管镜头；登场结束锁扣上膛（110 × 难度）。
 *   · 饮熔：85% / 70% 两道生命刻度（onMark）排上饮熔；饮熔时打碎它身后那面墙上的锁扣 → 鼎角砸中：护甲清零、硬直 4 s（受伤 × 2，框架 stagger）、鳞甲崩裂（全身弱点）。
 *   · 转换（55%，5.2 s）：链全断、锁扣静默移除、巨鼎坠池（池中掩体，冲出一圈火浪）；跳进熔池沉下去，1.9 s 在熔岩柱里换成焚身（框架换形），
 *     2.2 s 起从熔岩里冲出、跃回熔池另一侧的岸上；鳞甲炸飞（护甲清零）。逻辑位置在 1.1 s 扎进熔池时瞬移到池里、落地时瞬移到上岸点。
 *   · 走位：玄鳞在外环跑道上小跑、绕到玩家那一侧；焚身踏云（招式间隙 4.5 m、俯冲蓄势 / 火云雨 7.5 m、喘息 / 吐息落地 0，身下有石柱、倒鼎时抬过去），
 *     沿外环跑道上空绕殿弧线奔跑，5–9 s 掉一次头。网页的首领是飞行体（EnemyBase 的 flyTargetY），每帧在 think 之后定高度。
 *   · 熔流轮转（QilinFlood）由这里推进；15% 狂怒排上狂怒长啸（BurnRage）。胸口火心喘息时大亮。
 *   · 倒下：身上冒熔浆、落地溅一圈熔浆、熔池最后喷一股、净火归瑞的淡金光点（DefeatTimeline，ctx.fx 精神对齐）。
 * 动作：美术身体挂上、动画数据读好后播片段（M12 第二期：SK_Boss_Qilin / SK_Boss_QilinBurn 的采样 + Blender 手 K，src/anim/ClipPlayer），招式的 playAct 按秒数拉伸、
 *   片段事件进招式的 cue（先到者算，时间兜底照旧）；读好之前和程序化兜底体沿用程序化骨骼姿势（playAct 状态名映射到姿势参数）。
 * 网址带 ?dev 时（只在开发服务器里）挂 window.__qilin 调试钩子（跳演出、跳阶段、强制出招）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp, TAU } from '../../core/math';
import { attachEnemyArt } from '../../assets/EnemyArt';
import { ClipPlayer } from '../../anim/ClipPlayer';
import type { NativeBody } from '../../assets/NativeRig';
import type { LavaSystem } from '../../world/Lava';
import { attackDirector } from '../AttackTokens';
import { getEnemyDef } from '../Registry';
import type { HitShape } from './BossBase';
import { BossBrain, hexColor } from './framework/BossBrain';
import type { BossFormDef, BossPhaseDef } from './framework/BossDef';
import type { BossMove } from './framework/BossMove';
import { DefeatTimeline } from './framework/DefeatSequence';
import { summonOptions } from './framework/Summons';
import { BossIntroDirector, introEnabled, type DirectedBoss } from './intro/BossIntroDirector';
import { anchorOn, ProcPose, type KPPose } from './KunPengModel';
import type { BeamMesh } from './Visuals';
import { locateFurnace } from './QilinArena';
import { QilinCauldron } from './QilinCauldron';
import { QilinDef, SKY, STUN_LIE_UNTIL } from './QilinDef';
import { QilinFlood } from './QilinFlood';
import { QilinFurnace } from './QilinFurnace';
import { QilinFx, type Blade } from './QilinFx';
import { qilinIntro, type QilinIntroStage } from './QilinIntro';
import { QILIN_LOCK_DEF, QilinLock } from './QilinLock';
import { BURN_POINTS, buildQilinProc, XUAN_POINTS, type QilinPoint } from './QilinModel';
import { createQilinMove, dirOf, type BreathMove, type SweepMove } from './QilinMoves';
import { QilinScaleCrown } from './QilinScaleCrown';

/** 敌人名册里的条目（首领自己的耐久按 QilinDef 的定档表另算；这里的是难度 1 的参考值） */
export const QILIN_DEF: EnemyDef = {
  id: 'boss_qilin',
  name: '火麒麟',
  hp: 9090,
  // 玄铁鳞甲：一阶段的护甲层（饮熔回满，坠鼎砸中时崩裂，化焚身时炸飞）
  armor: 780,
  speed: 6.5,
  radius: 2.0,
  height: 7.2,
  flying: true,
  damage: 16,
  coins: [60, 100],
  essence: 60,
  isBoss: true,
  headY: 6,
  headRadius: 0.5,
  knockbackResist: 1,
  color: 0xff6a1a,
};

export type FormId = 'xuan' | 'burn';

interface Form {
  host: THREE.Group;
  pose: KPPose;
  native: NativeBody | null;
  /** 片段播放器（M12：SK_Boss_Qilin / SK_Boss_QilinBurn 的采样 + Blender 手 K 片段）；读好之前 / 没有美术身体时程序化摆姿势 */
  clips: ClipPlayer | null;
  /** 片段现在跟的是哪个动作名（this.anim） */
  clipAnim: string;
  procGroup: THREE.Group;
  pts: Record<string, THREE.Object3D>;
  shapes: HitShape[];
  /** 骨骼名 → 绑定姿势下的模型空间位置（宿主局部、未缩放），用于绕蹄子的整体俯仰 */
  table: Record<string, QilinPoint>;
}

const SCALE = QilinDef.ModelScale;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;
const HOOVES = ['hoofFL', 'hoofHR', 'hoofFR', 'hoofHL'];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _imp = new THREE.Vector3();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
/** 踏云找身下障碍物的高度上限（离殿内地面，米）：石柱 5.8 m + 余量 */
const UNDER_TOP = 8.5;
const span = (t: number, a: number, b: number): number => Math.min(1, Math.max(0, (t - a) / Math.max(1e-4, b - a)));
/** Unity QilinBrain.EaseInOut（smoothstep）/ EaseOutCubic */
const easeInOut = (k: number): number => k * k * (3 - 2 * k);
const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3);

/** 场景文档里的首领场地（StageDirector.unityDocument 的 bosses[]） */
interface SceneBoss {
  id: string;
  center: number[];
  floorY: number;
  radius: number;
}

export class Qilin extends BossBrain implements DirectedBoss {
  readonly qdef: QilinDef;
  furnace!: QilinFurnace;
  fx: QilinFx | null = null;
  cauldron: QilinCauldron | null = null;
  flood: QilinFlood | null = null;
  crown: QilinScaleCrown | null = null;
  director: BossIntroDirector | null = null;
  /** StageDirector 读：登场演出自己打名字卡，不再打横幅 */
  introDirected = false;
  readonly introOffset = new THREE.Vector3();

  // ───── 饮熔 / 锁扣 ─────
  sipping = false;
  drinkQuadrant = -1;
  drinksQueued = 0;
  drinksStarted = 0;
  drinksFinished = 0;
  cauldronHits = 0;
  wastedCorners = 0;
  crackLeft = 0;
  maneHeat = 0;
  printsDropped = 0;
  readonly locks: (QilinLock | null)[] = [];
  readonly lockBroken: boolean[] = [];
  private readonly lockPts: THREE.Vector3[] = [];
  private locksSpawned = false;
  private pendingCorner = -1;
  private wastedPending = false;
  private lockArt: THREE.Object3D[] = [];

  // ───── 焚身 ─────
  skyTarget: number = SKY.Alt;
  holdGround = false;
  heartBright = false;
  heartGlow = 0.3;
  rageRoars = 0;
  crowsSummoned = 0;
  private placed = false;
  private orbit = 0;
  private orbitDir = 1;
  private orbitTimer = 6;
  private beam: BeamMesh | null = null;
  private cloudAcc = 0;

  // ───── 演出 / 动画 ─────
  private xuan!: Form;
  private burn!: Form;
  private formVis: FormId = 'xuan';
  private introRoared = false;
  private readonly modelOffset = new THREE.Vector3();
  private readonly leapFrom = new THREE.Vector3();
  private readonly diveAt = new THREE.Vector3();
  private readonly landAt = new THREE.Vector3();
  private diveWarped = false;
  private landWarped = false;
  private transPrev = -1;
  private pearlGlow = 0.3;
  private printSide = 0;
  private printHurtAcc = 0;
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
  private readonly prevPos = new THREE.Vector3();
  private moveSpeed = 0;
  private heartHalo: THREE.Sprite | null = null;
  lastAct: string | null = null;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new QilinDef();
    super(ctx, QILIN_DEF, def, opts);
    this.qdef = def;
    this.accel = SKY.Accel;
    this.displayName = '火麒麟 · 玄鳞';
  }

  // ───────────── 场地 ─────────────

  private lavaSystem(): LavaSystem | null {
    return (this.ctx.stage as unknown as { lavaSystem?: LavaSystem | null }).lavaSystem ?? null;
  }

  private sceneBoss(): SceneBoss | null {
    const doc = (this.ctx.stage as unknown as { unityDocument?: { bosses?: SceneBoss[] } | null }).unityDocument;
    return doc?.bosses?.find(b => b.id === QilinDef.Id) ?? null;
  }

  /** 炉心殿：Unity 场景的首领场地（3-4）→ 白盒熔岩掩码 → 按场地推一份 */
  private resolveFurnace(): QilinFurnace {
    const sb = this.sceneBoss();
    if (sb) {
      const f = QilinFurnace.level34(new THREE.Vector3(sb.center[0], sb.floorY, sb.center[2]));
      this.arenaRadius = sb.radius;
      return f;
    }
    const legacy = locateFurnace(this.ctx.nav, this.ctx.stage.arena, this.lavaSystem()?.lava ?? null, this.position);
    const f = QilinFurnace.fromLegacy(legacy);
    this.arenaRadius = f.wallRadius - 0.5;
    return f;
  }

  get hallFloor(): number {
    return this.furnace.floorY;
  }

  protected override floorY(): number {
    return this.furnace ? this.furnace.floorY : super.floorY();
  }

  override init(): void {
    // 在 BossBase.init（夹到竞技场、登场第一帧）之前就位：熔池北沿（场地的出生点那一侧）池外 4.5 m，面朝熔池
    this.furnace = this.resolveFurnace();
    const f = this.furnace;
    this.bossCenter.copy(f.center);
    const theta = f.radiusOf(this.position) > 0.5 ? f.yawOf(this.position) : f.quadrantYaw(1);
    f.point(theta, f.poolRadius + 4.5, _v);
    this.position.set(_v.x, f.floorY, _v.z);
    this.facing = (theta + 180) * DEG;
    this.flyTargetY = f.floorY;
    this.velocity.set(0, 0, 0);
    this.prevPos.copy(this.position);
    // 锁扣：象限中线上、离圆心 23.1 m（殿墙 24 内 0.9）、锁身中心离地 12 m（Unity Level_3_4.LockR / LockHeight）
    for (let i = 0; i < f.quadrantCount; i++) {
      this.lockPts.push(f.point(f.quadrantYaw(i), f.wallRadius - 0.9, new THREE.Vector3()).setY(f.floorY + this.qdef.lockHeight - 0.75));
      this.locks.push(null);
      this.lockBroken.push(false);
    }
    super.init();
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const mk = (name: string, burn: boolean, table: Record<string, QilinPoint>): Form => {
      const host = new THREE.Group();
      host.name = name;
      host.scale.setScalar(SCALE);
      root.add(host);
      const proc = buildQilinProc(host, burn);
      return { host, pose: new ProcPose(proc.joints), native: null, clips: null, clipAnim: '', procGroup: proc.group, pts: {}, shapes: [], table };
    };
    this.xuan = mk('qilin_xuan_host', false, XUAN_POINTS);
    this.burn = mk('qilin_burn_host', true, BURN_POINTS);
    this.burn.host.visible = false;
    return root;
  }

  protected override createMove(id: string): BossMove | null {
    return createQilinMove(this, id);
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
        // 片段（Unity Animator + CreatureLocomotion）：人立 / 俯身烘在 hips 里，不开原地播放；步态按根节点的移动速度混合 Idle / Walk / Move
        const clips = new ClipPlayer(art.native.assetId, art.native.model, { root: this.root, rig: false, inPlace: false });
        // 片段事件交给招式的 cue；sfx: / fx: 不转——网页的招式自己播音效和震屏，免得响两遍
        clips.onEvent = (e) => {
          if (this.alive && f === this.F && !/^(sfx|fx):/.test(e.name)) this.emitAnimEvent(e.name);
        };
        f.clips = clips;
      }
      for (const [name, p] of Object.entries(f.table)) {
        const bone = f.pose.bone(p.bone) ?? f.host;
        f.pts[name] = anchorOn(f.host, bone, p.at, `ql_${name}`);
      }
    }
    const shapes = (f: Form, weak: string[]): HitShape[] => {
      const out: HitShape[] = [];
      for (const w of weak) out.push({ anchor: f.pts[w], radius: Math.max(0.38, f.table[w].r * SCALE), halfHeight: 0, weak: true });
      for (const n of ['head', 'neck', 'chest', 'body', 'hips']) out.push({ anchor: f.pts[n], radius: f.table[n].r * SCALE, halfHeight: 0, weak: false });
      return out;
    };
    this.xuan.shapes = shapes(this.xuan, ['pearl']);
    this.burn.shapes = shapes(this.burn, ['pearl', 'heart']);
    // 胸口火心的光晕（Unity 的光晕精灵：中心亮、边缘软；喘息时大亮）
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff8a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    halo.name = 'qilin-heart-halo';
    halo.renderOrder = 3;
    this.burn.pts.heart.add(halo);
    this.heartHalo = halo;
    this.useForm('xuan');

    const f = this.furnace;
    this.fx = new QilinFx(this.ctx, f.center, f.poolRadius);
    this.cauldron = new QilinCauldron(this.ctx, f, this.lockPts);
    this.cauldron.onImpact = (kind, at) => this.onCauldronImpact(kind, at);
    this.crown = new QilinScaleCrown(this.ctx);
    this.adoptSceneArt();
    if (introEnabled() && qilinIntro.validate().length === 0) {
      this.director = new BossIntroDirector(this.ctx, qilinIntro, this, this.position.clone());
      const st: QilinIntroStage = {
        pool: f.center.clone(), poolRadius: f.poolRadius,
        cauldron: () => this.cauldron ? this.cauldron.center(new THREE.Vector3()) : null,
        rattle: (k) => this.cauldron?.rattle(k),
      };
      this.director.ctx.bag.set('qilin', st);
      this.introHold = this.director;
      this.introDirected = true;
    }
    this.introTick(0, 0);
    if (devHookEnabled()) installDevHook(this);
  }

  /** Unity 场景里的吊鼎 / 锁扣正式件（场景视图画成静态网格）：吊鼎交给 QilinCauldron 跟着动，锁扣等锁扣生成时认领 */
  private adoptSceneArt(): void {
    const f = this.furnace;
    let ding: THREE.Object3D | null = null, best = 10;
    const locks: THREE.Object3D[] = [];
    this.ctx.scene.traverse((o) => {
      if (o.name.startsWith('SM_Prop_QilinCauldron')) {
        const d = f.radiusOf(o.getWorldPosition(_v));
        if (d < best) { best = d; ding = o; }
      } else if (o.name.startsWith('SM_Prop_QilinChainLock')) {
        if (Math.abs(f.radiusOf(o.getWorldPosition(_v)) - f.wallRadius) < 3) locks.push(o);
      }
    });
    if (ding) this.cauldron?.adoptArt(ding);
    this.lockArt = locks;
  }

  private useForm(id: FormId): void {
    this.formVis = id;
    const f = id === 'xuan' ? this.xuan : this.burn;
    this.xuan.host.visible = id === 'xuan';
    this.burn.host.visible = id === 'burn';
    this.hitShapes = f.shapes;
    this.weakAnchor = f.pts.pearl;
    this.muzzleAnchor = f.pts.mouth;
  }

  private get F(): Form {
    return this.formVis === 'xuan' ? this.xuan : this.burn;
  }

  get isXuan(): boolean {
    return this.formId === QilinDef.XuanForm;
  }

  get isBurn(): boolean {
    return this.formId === QilinDef.BurnForm;
  }

  /** 离殿内地面多高（蹄下） */
  get altitude(): number {
    return this.position.y - this.hallFloor;
  }

  get airborne(): boolean {
    return this.isBurn && this.altitude > 1;
  }

  // ───────────── DirectedBoss ─────────────

  get name(): string {
    return this.qdef.name;
  }

  get title(): string | null {
    return this.qdef.title;
  }

  introOverlay(color: number, amount: number): void {
    if (amount > 0.001) this.setEmissive(new THREE.Color(color), amount);
    else this.setEmissive(new THREE.Color(0x000000), 0);
  }

  get barTicks(): readonly number[] {
    return this.qdef.barTicks;
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const a = this.F?.pts.chest;
    return a ? a.getWorldPosition(out) : super.getBodyCenter(out);
  }

  // ───────────── 给招式用的点 / 工具 ─────────────

  mouthPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.F.pts.mouth.getWorldPosition(out);
  }

  headPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.F.pts.head.getWorldPosition(out);
  }

  chestPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.F.pts.chest.getWorldPosition(out);
  }

  hipsPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.F.pts.hips.getWorldPosition(out);
  }

  /** 下一只落蹄（0 左前、1 右后、2 右前、3 左后：横向跑步的落蹄顺序）的地面点 */
  nextHoofPoint(out: THREE.Vector3): THREE.Vector3 {
    const a = this.F.pts[HOOVES[this.printSide++ % 4]];
    if (a) a.getWorldPosition(out);
    else out.copy(this.position);
    out.y = this.hallFloor;
    return out;
  }

  /** 招式伤害：TS 写的是难度 1 的绝对伤害 → × 狂怒倍率（难度由危险物再乘） */
  dmg(tsBase: number): number {
    return this.moveDamage(tsBase / Math.max(1, this.qdef.damage));
  }

  predict(seconds: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player;
    return out.set(p.position.x + p.velocity.x * seconds, p.position.y, p.position.z + p.velocity.z * seconds);
  }

  /** 只提示一次 */
  private readonly told = new Set<string>();
  tell(key: string, text: string, color = '#ffb070'): void {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.ctx.ui.toast(text, color);
  }

  steer(dx: number, dz: number, speed: number): void {
    this.setMove(dx, dz, speed);
  }

  get moveHitWall(): boolean {
    return this.moveResult.hitWall;
  }

  /** 落一个燃烧的蹄印（4 s；玩家贴地踩到每 0.4 s 烧 7） */
  dropPrint(at: THREE.Vector3): void {
    this.fx?.hoofprint(at.x, at.z, this.facing);
    this.printsDropped++;
  }

  /** 这一帧想往 target 飞（水平，speed 米/秒，arrive 米内减速）；返回是否已到 */
  flyTo(target: THREE.Vector3, speed: number, arrive: number): boolean {
    const dx = target.x - this.position.x, dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) {
      this.hover();
      return true;
    }
    const v = speed * clamp(dist / Math.max(0.5, arrive * 2), 0, 1);
    this.setMove(dx, dz, Math.max(v, Math.min(speed, 2)));
    return dist <= arrive;
  }

  hover(): void {
    this.stopMoving();
  }

  brake(keep = 0.2): void {
    this.velocity.x *= keep;
    this.velocity.z *= keep;
  }

  /** 这一帧直接把位置放到 p（俯冲、降落、跃向池边这类脚本轨迹）：高度控制跳过这一帧，速度清零 */
  skyPlace(p: THREE.Vector3): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.stopMoving();
    this.flyTargetY = p.y;
    this.placed = true;
  }

  place(p: THREE.Vector3): void {
    this.skyPlace(p);
  }

  /** 熔池上空朝 p 那一侧的悬停点（离圆心 = 熔池半径 × 0.75） */
  poolEdgeToward(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const f = this.furnace;
    let dx = p.x - f.center.x, dz = p.z - f.center.z;
    if (dx * dx + dz * dz < 1e-4) {
      dx = this.position.x - f.center.x;
      dz = this.position.z - f.center.z;
    }
    const l = Math.hypot(dx, dz) || 1;
    return out.set(f.center.x + dx / l * f.poolRadius * 0.75, f.floorY, f.center.z + dz / l * f.poolRadius * 0.75);
  }

  /** p 正下方（身体半径的六成以内）最高的朝上表面：石柱顶、倒鼎、地面；打不到时殿内地面 */
  groundUnder(p: THREE.Vector3): number {
    const floor = this.hallFloor;
    const r = clamp(this.radius * 0.6, 0.4, 2);
    // 只找殿里的东西（石柱 5.8 m、倒鼎、祭台）：从离地 UNDER_TOP 米往下找。Unity 从身子上方 12 m 往下扫——网页的场景碰撞里殿顶、
    // 檐口这些高处的面也算「朝上的表面」，从身子上方找会一路抬升（实测踏云抬到 22–26 m）
    const y = this.ctx.world.groundHeight(p.x, p.z, floor + UNDER_TOP, r);
    return Number.isFinite(y) ? clamp(y, floor - 1.2, floor + UNDER_TOP) : floor;
  }

  /** 身子放在 feet 这里会不会插进石柱（离地 0.6 m 以上有东西） */
  bodyFits(feet: THREE.Vector3): boolean {
    const r = clamp(this.radius * 0.7, 0.4, 2.2);
    const y = this.ctx.world.groundHeight(feet.x, feet.z, this.hallFloor + 6, r);
    return !(Number.isFinite(y) && y > this.hallFloor + 0.6);
  }

  /** 把落点从石柱里推出来（最多推 4 m） */
  pushClear(feet: THREE.Vector3): THREE.Vector3 {
    if (this.bodyFits(feet)) return feet;
    const f = this.furnace;
    for (let ring = 1; ring <= 8; ring++) {
      const step = ring * 0.5;
      for (let k = 0; k < 8; k++) {
        const a = (k * 45 + ring * 17) * DEG;
        _w.set(feet.x + Math.sin(a) * step, feet.y, feet.z + Math.cos(a) * step);
        if (f.radiusOf(_w) > f.wallRadius - this.radius - 0.5) continue;
        if (this.bodyFits(_w)) return feet.copy(_w);
      }
    }
    return feet;
  }

  /** 焚身找落脚点（喘息、吐息）：池外、墙内、不在涨着的熔流 / 熔岩渠上、不压石柱 */
  landingSpot(near: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const f = this.furnace;
    out.copy(near).setY(this.hallFloor);
    const r = f.radiusOf(out);
    const minR = f.poolRadius + this.radius * 0.7 + 0.6, maxR = f.wallRadius - this.radius - 0.6;
    const yaw = r > 0.5 ? f.yawOf(out) : f.yawOf(this.ctx.player.position);
    if (r < minR) f.point(yaw, minR, out);
    else if (r > maxR) f.point(yaw, maxR, out);
    for (const rad of [0, 1.5, 3, 5, 8]) {
      for (let k = 0; k < (rad === 0 ? 1 : 8); k++) {
        const a = (k * 45 + rad * 13) * DEG;
        _w.set(out.x + Math.sin(a) * rad, this.hallFloor, out.z + Math.cos(a) * rad);
        if (f.radiusOf(_w) < f.poolRadius + 0.5 || f.radiusOf(_w) > maxR + 0.3) continue;
        if (f.onChannel(_w, this.radius * 0.5) || this.flood?.flooded(_w) || !this.bodyFits(_w)) continue;
        return out.copy(_w);
      }
    }
    return out;
  }

  /**
   * 沿 yaw（度）吐火：火焰粒子（beam = 焚身吐息：一条碰到石柱 / 倒鼎就截断的火柱）+ 判定节拍到了判一次：
   * 在扇形里（半角 halfDeg、射程）、口到玩家胸口不被挡 → 伤害。返回本拍的结果（没到节拍为 null）
   */
  breatheAlong(yawDeg: number, halfDeg: number, range: number, damage: number, dt: number, ticker: BreathMove | SweepMove, spread: number, beam = false): 'hit' | 'blocked' | 'miss' | null {
    const mouth = this.mouthPoint(_a);
    const d = dirOf(yawDeg, _v);
    const tip = _b.copy(mouth).addScaledVector(d, range);
    tip.y = this.hallFloor + (beam ? 0.9 : 0.8);
    _w.subVectors(tip, mouth);
    let len = _w.length();
    _w.multiplyScalar(1 / Math.max(1e-4, len));
    if (beam) {
      const hit = this.ctx.world.raycast(mouth, _w, len, _hitW);
      if (hit) {
        len = hit.distance;
        tip.copy(hit.point);
        if (Math.random() < dt * 20) this.ctx.fx.burst(tip, QilinDef.Hot, 6, 6, 0.4, 0.3, 4);
      }
      this.beam ??= this.hazards.beam(QilinDef.Fire, 0xffe0a0);
      this.beam.set(mouth, tip, 0.55);
    }
    this.fx?.breath(mouth, _w, Math.min(26, len * 1.4), spread, beam ? 4 : 3);
    if (!ticker.tick(dt)) return null;
    const pl = this.ctx.player;
    if (!pl.alive) return 'miss';
    const mx = mouth.x, mz = mouth.z;
    const ox = pl.position.x - mx, oz = pl.position.z - mz;
    if (Math.hypot(ox, oz) > range || Math.abs(((Math.atan2(ox, oz) / DEG - yawDeg + 540) % 360) - 180) > halfDeg) return 'miss';
    _b.set(pl.position.x, pl.position.y + 1.2, pl.position.z);
    if (this.ctx.world.segmentBlocked(mouth, _b)) return 'blocked';
    return this.hazards.hurt(damage, 'fire', mouth) > 0 ? 'hit' : 'miss';
  }

  endBeam(): void {
    this.hazards.releaseBeam(this.beam);
    this.beam = null;
  }

  /** 火云：殿顶一圈环形的暗紫褐火云带（Unity Fx.QilinFireClouds 精神对齐：一圈粒子云团） */
  fireClouds(seconds: number): void {
    const f = this.furnace;
    const y = this.hallFloor + 15;
    this.hazards.repeat(0.2, seconds, () => {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * TAU, r = f.wallRadius * (0.45 + Math.random() * 0.45);
        _v.set(f.center.x + Math.sin(a) * r, y + Math.random() * 2, f.center.z + Math.cos(a) * r);
        this.ctx.fx.burst(_v, Math.random() < 0.6 ? 0x4a2a24 : QilinDef.Fire, 4, 1.2, 1.4, 1.1, -0.5);
      }
    });
  }

  // ───────────── 召唤 ─────────────

  override summonPoints(): readonly THREE.Vector3[] {
    return this.furnace?.mouths ?? [];
  }

  /** 饮熔：两座炉口共钻出 4 只炭童（场地召唤点 = 炉口；受首领召唤上限约束） */
  summonTantong(): number {
    const d = this.qdef;
    if (!getEnemyDef(d.tantongId)) return 0;
    return this.summons.spawn(d.tantongId, d.drinkTantong, summonOptions({ warn: 0.6, minRadius: 4, maxRadius: 9, warnColor: QilinDef.Ember }));
  }

  /** 火云雨：高处排烟口飞出神火飞鸦（先在炉口生成，再放回排烟口的高度；同一个排烟口第二只沿殿墙切向错开 1.8 m） */
  summonCrows(count: number): number {
    const id = this.qdef.crowId;
    if (count <= 0 || !this.alive || !getEnemyDef(id)) return 0;
    const pts = this.crowPoints();
    const before = this.summons.totalSpawned;
    this.summons.spawn(id, count, summonOptions({ warn: 0, usePoints: true }));
    const made = this.summons.totalSpawned - before;
    const live = this.summons.liveList;
    const f = this.furnace;
    for (let k = 0; k < made && k < live.length; k++) {
      const e = live[live.length - 1 - k];
      const at = pts[k % pts.length].clone();
      const slot = Math.floor(k / pts.length);
      if (slot > 0) {
        const rx = at.x - f.center.x, rz = at.z - f.center.z, rl = Math.hypot(rx, rz) || 1;
        at.x += (-rz / rl) * 1.8 * slot;
        at.z += (rx / rl) * 1.8 * slot;
      }
      e.position.copy(at);
      (e as { flyTargetY?: number }).flyTargetY = at.y;
      this.ctx.fx.burst(at, QilinDef.Ember, 18, 6, 0.6, 0.25, 3);
    }
    this.crowsSummoned += made;
    if (made > 0) this.tell('crows', '高处排烟口飞出神火飞鸦——在空中打爆它们');
    return made;
  }

  private crowPoints(): THREE.Vector3[] {
    const f = this.furnace;
    const out: THREE.Vector3[] = [];
    for (const v of f.vents) {
      const rx = f.center.x - v.x, rz = f.center.z - v.z, rl = Math.hypot(rx, rz) || 1;
      out.push(new THREE.Vector3(v.x + rx / rl * 2.5, v.y, v.z + rz / rl * 2.5));
    }
    if (out.length > 0) return out;
    const pa = f.yawOf(this.ctx.player.position);
    for (const side of [-1, 1]) out.push(f.point(pa + 180 + side * 34.4, f.wallRadius - 1).setY(this.hallFloor + 10));
    return out;
  }

  // ───────────── 饮熔 / 锁扣 / 吊鼎 ─────────────

  /** 饮熔：选象限（离自己最近、锁扣还在、链还拴着的；都没了取自己所在的象限） */
  pickDrinkQuadrant(): number {
    const f = this.furnace;
    const me = f.yawOf(this.position);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < f.quadrantCount; i++) {
      if (!this.lockAlive(i) || (this.cauldron && !this.cauldron.chainIntact(i))) continue;
      const d = Math.abs(((f.quadrantYaw(i) - me + 540) % 360) - 180);
      if (d >= bestD) continue;
      bestD = d;
      best = i;
    }
    return best >= 0 ? best : f.quadrantOf(this.position);
  }

  lockAlive(i: number): boolean {
    const l = this.locks[i];
    return !!l && l.alive;
  }

  get cornerPending(): boolean {
    return this.pendingCorner >= 0;
  }

  beginSip(quadrant: number): void {
    this.sipping = true;
    this.drinkQuadrant = quadrant;
    this.drinksStarted++;
    const l = this.locks[quadrant];
    if (l?.alive) l.highlight = true;
  }

  endSip(): void {
    const l = this.drinkQuadrant >= 0 ? this.locks[this.drinkQuadrant] : null;
    if (l?.alive) l.highlight = false;
    this.sipping = false;
    this.drinkQuadrant = -1;
    this.fx?.eruption(0);
  }

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
    if (!this.cauldron.dropCorner(i)) return;
    if (this.sipping && this.drinkQuadrant === i) this.pendingCorner = i;
    else {
      this.wastedPending = true;
      this.wastedCorners++;
    }
  }

  private onCauldronImpact(kind: 'corner' | 'fallen', at: THREE.Vector3): void {
    const fx = this.ctx.fx;
    const fallen = kind === 'fallen';
    fx.explosion(_v.copy(at), fallen ? 6 : 3.5, QilinDef.Fire);
    fx.burst(_v, QilinDef.Ember, fallen ? 60 : 30, fallen ? 14 : 9, 1.1, 0.4, 12);
    const d = at.distanceTo(this.ctx.player.position);
    const k = Math.max(0, 1 - d / 70);
    if (k > 0.01) fx.shake((fallen ? 0.95 : 0.6) * k, fallen ? 1 : 0.5);
    this.ctx.audio.play('boss_slam', { position: at, pitch: fallen ? 0.5 : 0.75, volume: 1 });
    this.ctx.audio.play('explosion', { position: at, pitch: 0.6, volume: 0.9 });
    if (fallen) {
      // 巨鼎砸进熔池：熔岩冲天，一圈火浪从池边扫到殿墙（跳过去）
      this.fx?.eruption(1);
      const f = this.furnace;
      if (this.alive) {
        this.hazards.wave({
          x: f.center.x, y: f.floorY, z: f.center.z, speed: 15, maxRadius: f.wallRadius + 1, damage: this.dmg(12), color: QilinDef.Warn,
          startRadius: f.poolRadius, width: 1.1, height: 0.95, knockback: 7, element: 'fire', dust: QilinDef.Ember,
        });
      }
      return;
    }
    if (this.pendingCorner >= 0 && this.sipping && this.alive && this.phase === 0) {
      this.pendingCorner = -1;
      this.cornerHit();
    } else if (this.wastedPending) {
      this.wastedPending = false;
      this.pendingCorner = -1;
      this.ctx.ui.toast('鼎角砸空——白费了一个锁扣。等它饮熔时再打它身后那一个', '#c8a070');
    }
  }

  /** 鼎角砸中饮熔的麒麟：护甲清零、鳞甲崩裂（全身弱点）、硬直 4 s（受伤 × 2）。饮熔被打断 */
  private cornerHit(): void {
    this.cauldronHits++;
    this.armor = 0;
    const h = this.headPoint(_v);
    this.ctx.fx.burst(h, QilinDef.ScaleDark, 40, 10, 1.2, 0.35, 16);
    this.ctx.fx.burst(h, QilinDef.Hot, 30, 9, 0.8, 0.3, 6);
    this.ctx.audio.play('shield_break', { position: h, pitch: 0.6, volume: 1 });
    this.playSfx('boss_roar', 1, 0.65);
    this.ctx.ui.toast('巨鼎砸中火麒麟！鳞甲崩裂——全身都是弱点、伤害翻倍，4 秒！', '#ffe08a');
    this.stagger(QilinDef.StunSeconds, 'stun', QilinDef.CrackTakenMult);
    this.startCrack(QilinDef.StunSeconds);
  }

  private startCrack(seconds: number): void {
    this.crackLeft = Math.max(this.crackLeft, seconds);
    this.setCrackWeak(true);
  }

  private endCrack(): void {
    this.crackLeft = 0;
    this.setCrackWeak(false);
  }

  /** 鳞甲崩裂：五个受击球都算弱点；结束后回到只有火珠 */
  private setCrackWeak(on: boolean): void {
    if (!this.xuan?.shapes) return;
    for (const s of this.xuan.shapes) s.weak = on || s.anchor === this.xuan.pts.pearl;
  }

  /** 首领自己的锁扣（测试与检视用：已碎的为 null） */
  get lockList(): readonly (QilinLock | null)[] {
    return this.locks;
  }

  /** 登场结束：四个锁扣上膛（110 × 难度），认领场景里的锁扣正式件 */
  private spawnLocks(): void {
    if (this.locksSpawned) return;
    this.locksSpawned = true;
    if (!getEnemyDef(QILIN_LOCK_DEF.id)) return;
    const f = this.furnace;
    for (let i = 0; i < this.lockPts.length; i++) {
      if (this.lockBroken[i]) continue;
      const e = this.ctx.enemies.spawn(QILIN_LOCK_DEF.id, { position: this.lockPts[i].clone(), level: this.level });
      if (!(e instanceof QilinLock)) continue;
      e.owner = this;
      e.index = i;
      e.faceAngle = (f.quadrantYaw(i) + 180) * DEG;
      e.facing = e.faceAngle;
      this.locks[i] = e;
      // 场景里同一个象限的锁扣正式件
      let art: THREE.Object3D | null = null, best = 4;
      for (const o of this.lockArt) {
        o.getWorldPosition(_v);
        const d = Math.hypot(_v.x - this.lockPts[i].x, _v.z - this.lockPts[i].z);
        if (d < best) { best = d; art = o; }
      }
      if (art) e.adoptArt(art);
    }
  }

  /** 剩下的锁扣静默移除（链全断、倒下时） */
  private purgeLocks(): void {
    const was = attackDirector.purging;
    attackDirector.purging = true;
    try {
      for (let i = 0; i < this.locks.length; i++) {
        const l = this.locks[i];
        this.locks[i] = null;
        this.lockBroken[i] = true;
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

  // ───────────── 每帧 ─────────────

  override update(dt: number): void {
    const before = _keep.copy(this.position);
    super.update(dt);
    this.undoFalloutGuard(before);
    if (this.waitingForSpawn) return;
    this.cauldron?.update(dt);
    this.fx?.update(dt, this.alive ? this.bladeResolver : null);
    this.flood?.tick(dt);
    this.crown?.update(dt);
    if (!this.alive) return;
    // 身下的地面（Unity StepSky：p.y < ground 时放到 ground 上）：飞行体低空横冲进石柱时，碰撞解算会把整个身子从柱底往下推出去
    if (this.introDone && !this.transitioning) {
      const ground = this.isBurn ? this.groundUnder(this.position) : this.hallFloor;
      if (this.position.y < ground - 0.05) {
        this.position.y = ground;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }
    if (this.crackLeft > 0) {
      this.crackLeft -= dt;
      if (this.crackLeft <= 0) this.endCrack();
      else if (Math.random() < dt * 14) {
        // 鳞甲崩裂期间：身上轮流闪金色裂光
        const pts = ['head', 'chest', 'hips', 'neck', 'body'];
        this.F.pts[pts[Math.floor(Math.random() * 5)]].getWorldPosition(_v);
        this.ctx.fx.burst(_v.add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), 0xffe08a, 4, 3, 0.3, 0.18, 0);
      }
    }
    this.maneHeat = Math.max(0, this.maneHeat - dt * 0.02);
    // 蹄印烧脚（4 s、半径 0.95 m、贴地每 0.4 s 烧 7）
    this.printHurtAcc += dt;
    if (this.printHurtAcc >= this.qdef.printInterval) {
      this.printHurtAcc = 0;
      const pl = this.ctx.player;
      if (pl.alive && pl.position.y - this.hallFloor < 0.5 && this.fx?.printNear(pl.position.x, pl.position.z, this.qdef.printRadius)) {
        this.hazards.hurt(this.dmg(this.qdef.printDamage), 'fire', pl.position);
      }
    }
  }

  /**
   * EnemyBase 的「掉出世界」保护按关卡的 floorY 判（3-4 是山门出生点的 24 m，殿内地面 0 m）：低于 floorY − 12、脚下 3 m 内没有地面就瞬移回关卡中心——
   * 焚身踏云（4.5–7.5 m）、饮熔跃起（6 m）在殿内半空时正好落进这个判定，会被拽出殿外。这里认出那一下瞬移（落到 floorY + 0.5、跳了好几米）并撤回；
   * 真掉出殿外（离殿心超过殿墙 + 6 m）时照常交给它
   */
  private undoFalloutGuard(before: THREE.Vector3): void {
    const a = this.ctx.stage.arena;
    if (!a || !this.alive || !this.furnace) return;
    if (Math.abs(this.position.y - (a.floorY + 0.5)) > 1e-4 || before.y >= a.floorY - 12) return;
    if (this.position.distanceToSquared(before) < 16 || this.furnace.radiusOf(before) > this.furnace.wallRadius + 6) return;
    this.position.copy(before);
    this.velocity.set(0, 0, 0);
  }

  /** 鳞刃：撞到掩体就碎；扫过玩家（贴地 0.2–2.4 米高的竖薄片）就伤人 */
  private readonly bladeResolver = (b: Blade): 'hit' | 'block' | null => {
    if (this.ctx.world.segmentBlocked(b.prev, b.pos)) return 'block';
    const floor = this.hallFloor;
    _a.copy(b.prev).setY(floor + 0.4);
    _b.copy(b.pos).setY(floor + 0.4);
    const pl = this.ctx.player;
    if (pl.position.y > floor + 2.2) return null;
    if (this.hazards.segmentHitsPlayer(_a, _b, 0.55)) {
      this.hazards.hurt(this.dmg(20), 'fire', b.pos);
      pl.applyImpulse(_imp.copy(b.dir).multiplyScalar(4).setY(2));
      return 'hit';
    }
    return null;
  };

  /** 框架的 think 之后定高度（EnemyBase 接着按 flyTargetY 积分） */
  protected override think(dt: number): void {
    super.think(dt);
    this.stepHeight();
  }

  private stepHeight(): void {
    const floor = this.hallFloor;
    if (this.placed) {
      this.placed = false;
      this.flyTargetY = this.position.y;
      this.velocity.y = 0;
      return;
    }
    if (!this.isBurn || !this.introDone || this.transitioning) {
      this.flyTargetY = floor;
      return;
    }
    // 焚身踏云：竖直追目标高度（招式间隙 4.5、俯冲蓄势 / 火云雨 7.5、喘息 / 吐息落地 0），身下有石柱 / 倒鼎时抬过去
    const alt = Math.max(0, this.skyTarget);
    const bob = alt > 1 ? Math.sin(this.age * 1.6) * 0.9 : 0;
    let target = floor + alt + bob;
    if (alt > 0.5) {
      const under = Math.max(this.groundUnder(this.position), this.groundUnder(_v.copy(this.position).addScaledVector(this.velocity, 0.4)));
      target = Math.max(target, under + SKY.Clearance);
    }
    this.flyTargetY = target;
    // 夹在殿墙以内（身体半径 + 0.5 m）
    const f = this.furnace;
    const max = Math.max(2, f.wallRadius - this.radius - 0.5);
    const dx = this.position.x - f.center.x, dz = this.position.z - f.center.z, d = Math.hypot(dx, dz);
    if (d > max) {
      this.position.x = f.center.x + dx / d * max;
      this.position.z = f.center.z + dz / d * max;
    }
  }

  // ───────────── 框架钩子 ─────────────

  /** 登场：熔池里冲起熔岩柱，麒麟从池心跃出，落在出生点（熔池北沿）人立长啸 */
  protected override introTick(t: number, dt: number): void {
    const f = this.furnace;
    this.fx?.eruption(t < 0.3 ? 0.7 : 0);
    const k = easeInOut(span(t, 0.12, 0.45));
    const lift = Math.sin(Math.PI * k) * 7 - 8 * (1 - span(t, 0, 0.14));
    this.modelOffset.set((f.center.x - this.position.x) * (1 - k), lift, (f.center.z - this.position.z) * (1 - k));
    if (k >= 1 && !this.introRoared) {
      this.introRoared = true;
      this.act('rear', 1.2);
      this.playSfx('boss_roar', 1, 0.8);
      const floor = _v.set(this.position.x, this.hallFloor + 0.1, this.position.z);
      this.ctx.fx.ring(floor, 12, QilinDef.Warn, 1);
      this.ctx.fx.burst(_w.copy(floor).setY(floor.y + 0.3), QilinDef.Fire, 30, 7, 0.8, 0.35, 8);
      this.ctx.fx.burst(_w, 0x4a3028, 20, 5, 0.9, 0.4, 4);
      this.quake(0.6, 1);
    }
    // 跃出段不再逐帧 act：现身时 onPresent 已经照 Unity（BossBrain.Spawn 的 PlayAct(intro.anim, intro.seconds)）播了 tuck、拉伸到 3.2 s，
    // 程序化姿势也一直停在 tuck 到落地人立；Unity QilinBrain.IntroTick 只在落地时 PlayAct("rear", 1.2f) 一次
    // 登场时间里 EnemyBase 不调 animate：这里补上
    if (dt > 0 && this.age < this.spawnDuration) this.animate(dt);
  }

  protected override onIntroEnd(): void {
    this.clipLoco = true;
    this.modelOffset.set(0, 0, 0);
    this.fx?.eruption(0);
    this.spawnLocks();
    this.tell('intro', '火麒麟·玄鳞——角根的火珠是弱点；它饮熔时，打碎它身后外墙上的锁扣，让巨鼎砸它');
  }

  /** 85% / 70% 饮熔线：正在出招（或硬直）就排队，空着就立刻出 */
  protected override onMark(id: string): void {
    if (id !== QilinDef.DrinkMarkA && id !== QilinDef.DrinkMarkB) return;
    if (this.phase > 0 || !this.isXuan || this.transitioning || this.phaseFraction() <= QilinDef.TransformAt) return;
    this.drinksQueued++;
    if (!this.currentMove && !this.staggered && this.stunTime <= 0 && this.introDone) this.forceMove('drink');
    else this.queueMove('drink');
  }

  /** 55%：链全断、锁扣移除、巨鼎坠池；记下跳池的起点、池心落点、换形后的上岸点 */
  protected override onPhase(phase: number): void {
    if (phase !== 1) return;
    this.endCrack();
    if (this.sipping) this.endSip();
    this.pendingCorner = -1;
    this.wastedPending = false;
    this.fx?.clearPrints();
    this.fx?.clearBlades();
    this.crown?.release();
    this.purgeLocks();
    this.cauldron?.fall();
    const f = this.furnace;
    this.leapFrom.copy(this.position);
    let ax = this.position.x - f.center.x, az = this.position.z - f.center.z;
    let al = Math.hypot(ax, az);
    if (al < 1e-2) { ax = 0; az = 1; al = 1; }
    const inR = Math.min(3, f.poolRadius * 0.45);
    this.diveAt.set(f.center.x + ax / al * inR, f.floorY, f.center.z + az / al * inR);
    const pl = this.ctx.player.position;
    let px = pl.x - f.center.x, pz = pl.z - f.center.z;
    let plen = Math.hypot(px, pz);
    if (plen < 1e-2) { px = -ax; pz = -az; plen = al; }
    const landR = f.poolRadius + 4.5;
    this.landAt.set(f.center.x + px / plen * landR, f.floorY, f.center.z + pz / plen * landR);
    // 玩家正好站在上岸点上：往旁边让 40°
    if (Math.hypot(pl.x - this.landAt.x, pl.z - this.landAt.z) < 4.5) {
      const a = Math.atan2(px, pz) + 40 * DEG;
      this.landAt.set(f.center.x + Math.sin(a) * landR, f.floorY, f.center.z + Math.cos(a) * landR);
    }
    this.diveWarped = this.landWarped = false;
    this.transPrev = -1;
  }

  /**
   * 化焚身：0.2–1.1 s 跃向池心、1.1–1.9 s 沉下去；熔岩柱 1.0 → 1.6 s 冲满、保持到 3.4 s、4.6 s 落下；2.2–3.6 s 从熔岩里冲出、3.6–4.6 s 跃回岸上。
   * 模型走偏移；逻辑位置 1.1 s 扎进熔池时瞬移到池里、4.6 s 落地时瞬移到上岸点
   */
  protected override transitionTick(t: number, _dt: number): void {
    const was = this.transPrev;
    this.transPrev = t;
    const crossed = (x: number) => was < x && t >= x;
    const f = this.furnace;
    const col = t < 1 ? 0 : t < 1.6 ? (t - 1) / 0.6 : t < 3.4 ? 1 : Math.max(0, 1 - (t - 3.4) / 1.2);
    this.fx?.eruption(col);
    if (t >= 1.1 && !this.diveWarped) {
      this.diveWarped = true;
      this.warpTo(this.diveAt);
    }
    if (t < 1.9) {
      const k = easeInOut(span(t, 0.2, 1.1));
      _v.lerpVectors(this.leapFrom, this.diveAt, k);
      _v.y = this.hallFloor + Math.sin(Math.PI * k) * 7 - 9 * easeInOut(span(t, 1.1, 1.9));
      this.modelOffset.subVectors(_v, this.position);
      if (crossed(0.2)) this.act('tuck', 0.9);
      if (crossed(1.1)) {
        this.ctx.fx.burst(_w.set(f.center.x, f.floorY + 0.5, f.center.z), QilinDef.Fire, 50, 12, 1.2, 0.5, 8);
        this.ctx.audio.play('explosion', { position: f.center, pitch: 0.5, volume: 1 });
      }
      return;
    }
    const rise = easeOutCubic(span(t, 2.2, 3.6)), hop = easeInOut(span(t, 3.6, 4.6));
    if (hop >= 1) this.landWarp();
    _a.copy(this.diveAt).setY(this.hallFloor - 9 + 13 * rise);
    _v.lerpVectors(_a, this.landAt, hop);
    _v.y = mix(_a.y, this.landAt.y, hop) + Math.sin(Math.PI * hop) * 3;
    this.modelOffset.subVectors(_v, this.position);
    if (crossed(2.4)) {
      // 玄铁鳞片炸飞
      _w.copy(_v).setY(_v.y + 2);
      this.ctx.fx.burst(_w, QilinDef.ScaleDark, 60, 14, 1.4, 0.4, 14);
      this.ctx.fx.burst(_w, QilinDef.Hot, 40, 10, 1, 0.35, 4);
      this.quake(0.6, 0.8);
    }
    if (crossed(3.6)) this.act('leap', 1);
    if (crossed(3.8)) this.playSfx('boss_roar', 1, 1.2);
  }

  private warpTo(p: THREE.Vector3): void {
    this.position.set(p.x, this.hallFloor, p.z);
    this.velocity.set(0, 0, 0);
    this.flyTargetY = this.hallFloor;
  }

  private landWarp(): void {
    if (this.landWarped) return;
    this.landWarped = true;
    this.warpTo(this.landAt);
  }

  protected override onTransitionEnd(phase: BossPhaseDef): void {
    this.clipLoco = true;
    if (phase.form === QilinDef.BurnForm) this.landWarp();
    this.modelOffset.set(0, 0, 0);
    this.fx?.eruption(0);
    if (!this.isBurn) return;
    // 落在岸上之后踏云升空（第一招熔流轮转飞向池心上空）
    this.skyTarget = SKY.Alt;
    this.orbit = this.furnace.yawOf(this.position);
    this.orbitTimer = this.ctx.rng.range(5, 9);
  }

  protected override onFormChanged(_prev: BossFormDef | null, next: BossFormDef): void {
    if (next.id !== QilinDef.BurnForm) return;
    this.useForm('burn');
    this.displayName = '火麒麟 · 焚身';
    this.ctx.ui.setBoss(this);
    // 换形发生在转换演出这一帧的 transitionTick 之后：新模型立刻放到熔岩下面（池心），免得在上岸点闪一帧
    if (this.transitioning) this.modelOffset.set(this.diveAt.x - this.position.x, this.hallFloor - 9 - this.position.y, this.diveAt.z - this.position.z);
    // 玄铁鳞甲炸飞
    this.armor = 0;
    this.endCrack();
    this.skyTarget = 0;
    this.flood ??= new QilinFlood(this);
    this.ctx.ui.toast('火麒麟化为焚身——它会在半空踏云奔跑；三次俯冲后落地喘息，胸口火心和角根火珠是弱点', '#ffb070');
  }

  /**
   * 狂怒（15%）：焚身排上狂怒长啸。框架只有一个排队位，俯冲三踏之后排的喘息会把它挤掉——
   * 这里记一笔，招式间隙里立刻出（排着的喘息留着，长啸之后接着出）
   */
  private rageDue = false;
  protected override onEnrage(_reason: string): void {
    if (this.isBurn) this.rageDue = true;
  }

  protected override passiveTick(_dt: number): void {
    if (this.rageDue && !this.currentMove && this.isBurn && this.forceMove('burn_rage')) this.rageDue = false;
  }

  /** 招式间隙：玄鳞沿外环跑道小跑、绕到玩家那一侧；焚身在外环跑道上空绕殿弧线奔跑 */
  protected override idleMove(dt: number): void {
    const f = this.furnace;
    if (this.isBurn) {
      this.skyIdle(dt);
      return;
    }
    const me = f.yawOf(this.position), pa = f.yawOf(this.ctx.player.position);
    const rel = ((me - pa + 540) % 360) - 180;
    const want = pa + 34.4 * (rel >= 0 ? 1 : -1);
    const diff = ((want - me + 540) % 360) - 180;
    const step = clamp(diff, -20, 20);
    if (Math.abs(diff) > 8.6 || Math.abs(f.radiusOf(this.position) - f.trackRadius) > 1.5) {
      this.moveTo(f.point(me + step, f.trackRadius, _v), this.qdef.speed, 0.8);
      this.faceMovement(180 * DEG, dt);
    } else {
      this.stopMoving();
      this.facePlayer(115 * DEG, dt);
    }
  }

  private skyIdle(dt: number): void {
    const f = this.furnace;
    if (this.holdGround) {
      this.skyTarget = 0;
      this.hover();
      this.facePlayer(90 * DEG, dt);
      return;
    }
    this.skyTarget = SKY.Alt;
    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0) {
      this.orbitDir = -this.orbitDir;
      this.orbitTimer = this.ctx.rng.range(5, 9);
    }
    this.orbit += this.orbitDir * 31.5 * dt;
    this.flyTo(f.point(this.orbit, (f.bridgeOuter + f.wallRadius) * 0.5 - 1, _v), SKY.OrbitSpeed, 1);
    if (this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z > 0.25) {
      this.turnToward(Math.atan2(this.velocity.x, this.velocity.z), 172 * DEG, dt);
    } else this.facePlayer(115 * DEG, dt);
  }

  // ───────────── 倒下 / 释放 ─────────────

  protected override onDefeated(_result: DamageResult): void {
    this.modelOffset.set(0, 0, 0);
    this.endCrack();
    if (this.sipping) this.endSip();
    this.purgeLocks();
    this.fx?.clearBlades();
    this.fx?.eruption(0.5);
    this.crown?.release();
    this.endBeam();
    this.flood?.stop();
    this.heartBright = false;
    // 倒下：硬直姿势只到瘫倒的晕眩段，躺着溃散
    this.act('stun', this.qdef.defeat.seconds / STUN_LIE_UNTIL);
    this.director?.abort('首领倒下');
    this.defeatFx();
  }

  /** 倒下的特效：身上的熔浆一路往下滴，落地溅一圈熔浆，溃散那一下熔池最后喷一股，净火归瑞（淡金光点、暖白祥云从身上升起） */
  private defeatFx(): void {
    const ctx = this.ctx;
    const secs = this.qdef.defeat.seconds;
    const f = this.furnace;
    new DefeatTimeline(ctx)
      .during(secs * 0.9, () => {
        if (Math.random() < 0.4) ctx.fx.burst(this.getBodyCenter(_v).add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), QilinDef.Fire, 3, 1, 0.8, 0.22, 9);
      })
      .at(0.6, () => {
        _v.set(this.position.x, this.hallFloor + 0.3, this.position.z);
        ctx.fx.burst(_v, QilinDef.Fire, 30, 7, 0.9, 0.35, 8);
        ctx.fx.ring(_v, 4.2, QilinDef.Warn, 0.7);
        this.quake(0.5, 0.4, 50);
      })
      .at(secs * 0.88, () => {
        for (let i = 0; i < 5; i++) ctx.fx.burst(_v.set(f.center.x, f.floorY + 1.6 * i, f.center.z), QilinDef.Fire, 12, 3, 0.9, 0.35, 6);
        ctx.fx.burst(_v.set(this.position.x, this.hallFloor + 0.3, this.position.z), QilinDef.Hot, 24, 6, 0.8, 0.3, 6);
      })
      .at(secs * 0.97, () => {
        _v.set(this.position.x, this.hallFloor + 2.2, this.position.z);
        ctx.fx.burst(_v, 0xffe6a8, 40, 3, 2.2, 0.25, -2.5);
        ctx.fx.burst(_v, 0xfff4e0, 16, 1.5, 2.6, 0.9, -1.2);
      });
  }

  protected override animateDeath(t: number): void {
    // 腿一软瘫下去，余烬散去
    this.anim = 'stun';
    const dt = this.ctx.time.dt;
    const fc = this.F.clips;
    if (fc?.ready) {
      // 片段：硬直片段只播到瘫倒的晕眩段（拉伸后第 72% 落在倒下演出结尾），97% 时冻住（Unity DefeatFx 的 animator.speed = 0）——躺着溃散，不站起来
      fc.frozen = t >= 0.97;
      this.animateBody(dt);
    } else {
      this.animateBody(dt);
      const host = this.F.host;
      host.rotation.z = -0.5 * easeInOut(span(t, 0.15, 0.6));
      host.position.y = Math.min(host.position.y, 0);
    }
    if (t > 0.5) this.fx?.eruption(0);
    this.setRoleOpacity('pearlHalo', 0.4 * Math.max(0, 1 - t));
    this.setRoleOpacity('heartHalo', 0.4 * Math.max(0, 1 - t));
    if (this.heartHalo) this.heartHalo.material.opacity = 0;
    if (this.F.native?.glowShell) this.F.native.glowShell.opacity = 0.6 * Math.max(0, 1 - t);
    if (t >= 0.82) this.model.scale.setScalar(Math.max(0.01, 1 - (t - 0.82) / 0.18));
  }

  protected override onReleased(): void {
    this.flood?.dispose();
    this.flood = null;
    this.endBeam();
    this.fx?.dispose();
    this.fx = null;
    this.cauldron?.release();
    this.crown?.dispose();
    this.crown = null;
    this.purgeLocks();
    this.director?.abort('首领释放');
    for (const f of [this.xuan, this.burn]) {
      if (!f) continue;
      f.native?.dispose();
      f.native = null;
      f.clips?.dispose();
      f.clips = null;
    }
    if (devHook?.boss === this) devHook = null;
  }

  // ───────────── 动画 ─────────────

  /** 招式动作（Unity Brain.PlayAct：片段状态名、拉伸秒数、交叉淡入秒数）→ 程序化姿势 + 片段 */
  act(state: string, seconds: number, fade = 0.1): void {
    if (!state) return;
    this.lastAct = state;
    this.setAnim(state === 'Locomotion' || state === 'Idle' ? 'idle' : state, true);
    // 片段按时长拉伸，播完回到待机 / 奔跑（Unity PlayAct 之后 Animator 回 Locomotion）；时长 0 = 一直保持到下一个动作
    this.animLeft = seconds > 0.05 ? seconds : Infinity;
    // 片段：拉伸到 seconds 播完（Unity Act 的 ActScale），下一次 animate 时切进去
    this.clipSeconds = seconds;
    this.clipFade = fade;
    this.clipLoco = false;
    this.clipActed = true;
    if (this.xuan) this.xuan.clipAnim = '';
    if (this.burn) this.burn.clipAnim = '';
  }

  private animLeft = Infinity;

  override playAct(state: string, seconds: number): void {
    this.act(state, seconds);
  }

  /**
   * 片段跟着动作名走：act / setAnim 换了动作就切片段（招式 act('Locomotion', 0, fade) 照 PlayAct 按 fade 交叉淡入；片段播完回待机、没有片段的动作走 PlayLocomotion，已经在 Locomotion 就不重播）。
   * clipLoco：收招 / 转换结束 / 登场结束（Unity BossBrain.FinishMove / EndTransition / IntroDone 的 PlayLocomotion）——这之后没有新动作就回步态
   */
  private syncClip(f: Form, c: ClipPlayer): void {
    if (this.clipLoco) {
      this.clipLoco = false;
      if (f.clipAnim === this.anim) {
        if (c.state !== 'Locomotion') c.playLocomotion();
        return;
      }
    }
    if (f.clipAnim === this.anim) return;
    f.clipAnim = this.anim;
    const acted = this.clipActed;
    this.clipActed = false;
    // 招式显式要的步态 act('Locomotion', 0, fade)：Unity PlayAct → Play("Locomotion", fade) = CrossFadeInFixedTime（奔驰起冲 0.05、缺省 0.1），
    // 已经在步态里也照样交叉淡入一次；片段播完自己回待机走 PlayLocomotion（0.15）
    if (acted && this.anim === 'idle') c.play('Locomotion', this.clipFade);
    else if (this.anim === 'idle' || !c.has(this.anim)) {
      if (c.state !== 'Locomotion') c.playLocomotion();
    } else if (this.clipSeconds > 0.05) c.playTimed(this.anim, this.clipSeconds, this.clipFade);
    else c.play(this.anim, this.clipFade);
    this.clipSeconds = 0;
  }
  private clipSeconds = 0;
  private clipFade = 0.1;
  private clipLoco = false;
  /** act() 之后还没切过片段：这次换片段是招式显式要的（淡入秒数用 clipFade），不是片段播完回待机 */
  private clipActed = false;

  protected override onMoveEnded(_m: BossMove): void {
    if (this.alive) this.clipLoco = true;
  }

  protected override animate(dt: number): void {
    // 实际水平速度（步态频率）
    const sp = Math.hypot(this.position.x - this.prevPos.x, this.position.z - this.prevPos.z) / Math.max(dt, 1e-4);
    this.prevPos.copy(this.position);
    this.moveSpeed = mix(this.moveSpeed, Math.min(sp, 40), 1 - Math.exp(-8 * dt));
    if (this.anim !== 'idle' && this.alive && (this.animLeft -= dt) <= 0) this.setAnim('idle');
    this.animateBody(dt);
    // 登场 / 转换的模型偏移（世界）→ 根节点局部
    _v.copy(this.modelOffset).add(this.introOffset);
    const c = Math.cos(-this.facing), s = Math.sin(-this.facing);
    this.model.position.set(_v.x * c + _v.z * s, _v.y, -_v.x * s + _v.z * c);
    this.updateGlow(dt);
    // 焚身在空中时蹄下冒火云
    if (this.airborne) {
      this.cloudAcc += dt;
      if (this.cloudAcc >= 0.11) {
        this.cloudAcc = 0;
        for (let k = 0; k < 2; k++) {
          const a = this.F.pts[HOOVES[(this.printSide++) & 3]];
          if (!a) continue;
          a.getWorldPosition(_v);
          this.fx?.emit(_v, _w.set((Math.random() - 0.5) * 1.5, -0.5 + Math.random(), (Math.random() - 0.5) * 1.5), 0.55, 0.35 + Math.random() * 0.3,
            Math.random() < 0.35 ? QilinDef.Hot : QilinDef.Fire, 2, 1.2);
        }
      }
    }
  }

  private updateGlow(dt: number): void {
    const f = this.F;
    // 火珠：平时微光；人立、被砸晕、鳞甲崩裂、喘息时大亮
    const bright = this.staggered || this.crackLeft > 0 || this.heartBright || (this.currentMove?.id === 'scales' && this.currentMove.stage === 'windup');
    this.pearlGlow += ((bright ? 1 : 0.35) - this.pearlGlow) * Math.min(1, dt * 4);
    this.heartGlow += ((this.heartBright ? 1 : 0.3) - this.heartGlow) * Math.min(1, dt * 4);
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 5);
    if (f.native?.glowShell) f.native.glowShell.opacity = (0.15 + 0.55 * this.pearlGlow) * (0.75 + 0.25 * pulse);
    this.setRoleOpacity('pearlHalo', (0.2 + 0.5 * this.pearlGlow) * (0.7 + 0.3 * pulse));
    this.setRoleOpacity('heartHalo', (0.15 + 0.7 * this.heartGlow) * (0.7 + 0.3 * pulse));
    if (this.heartHalo) {
      const g = this.heartGlow * (0.85 + 0.15 * Math.sin(this.age * 7));
      this.heartHalo.visible = this.isBurn;
      // Unity：光晕边长 1.2 + 2.2 × 亮度（米），透明度 0.35 + 0.6 × 亮度；宿主有体型缩放，这里除回去
      this.heartHalo.scale.setScalar((1.2 + 2.2 * g) / SCALE);
      (this.heartHalo.material as THREE.SpriteMaterial).opacity = 0.35 + 0.6 * g;
    }
  }

  /**
   * 骨骼动画（creature_rigs/SK_Boss_Qilin*.json，角度不超过注册表 SK_Boss_Qilin.rom / SK_Boss_QilinBurn.rom；网页原有的程序化姿势）。
   * 模型空间：X = 生物左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾。步态：横向跑步（左后 → 右后 → 左前 → 右前），慢时对角快步。
   */
  private animateBody(dt: number): void {
    const fc = this.F.clips;
    if (fc?.ready) {
      // 片段驱动：宿主的人立 / 前倾 / 起伏都在片段里（Unity 的模型根节点不动），这里只把宿主放正
      this.syncClip(this.F, fc);
      this.F.host.rotation.set(0, 0, 0);
      this.F.host.position.set(0, 0, 0);
      fc.update(dt);
      return;
    }
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
    const fly = this.airborne;
    if (fly && a !== 'stomp' && a !== 'tuck' && a !== 'breath') gait = Math.max(gait, 0.75);
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
    const stride = this.pGait > 0.6 ? 7 : 4;
    this.gaitPhase += dt * TAU * (fly ? 1.6 : Math.max(0.8, this.moveSpeed / stride)) * (this.pGait > 0.02 ? 1 : 0);

    const f = this.F;
    const P = f.pose;
    P.reset();
    const g = this.pGait, ph = this.gaitPhase;
    const gallop = g > 0.6 || fly;
    const off = gallop ? { fL: 0.5, fR: 0.62, hL: 0, hR: 0.12 } : { fL: 0, fR: 0.5, hL: 0.5, hR: 0 };
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      const pf = ph + off[side === 'L' ? 'fL' : 'fR'] * TAU;
      const sf = Math.sin(pf), cf = Math.cos(pf);
      P.rotate(`upperarm_${side}`, AX, g * (-0.1 - 0.45 * sf) - 0.6 * this.pRear - 0.25 * this.pDrink + 0.1 * this.pStun - 0.4 * this.pTuck - 0.5 * this.pStomp);
      P.rotate(`forearm_${side}`, AX, g * 0.4 * Math.max(0, cf) + 0.3 * this.pRear + 0.4 * this.pTuck - 0.2 * this.pStomp);
      P.rotate(`fcannon_${side}`, AX, g * 1.15 * Math.max(0, cf) + 1.35 * this.pRear + 1.4 * this.pTuck);
      P.rotate(`upperarm_${side}`, AZ, s * (0.1 * this.pRear + 0.12 * this.pDrink + 0.15 * this.pStun));
      const ph2 = ph + off[side === 'L' ? 'hL' : 'hR'] * TAU;
      const sh = Math.sin(ph2), chh = Math.cos(ph2);
      P.rotate(`thigh_${side}`, AX, g * (-0.05 + 0.5 * sh) + 0.35 * this.pRear - 0.6 * this.pTuck + 0.55 * this.pStomp);
      P.rotate(`shin_${side}`, AX, -g * 0.25 * Math.max(0, -chh) + 0.3 * this.pStomp);
      P.rotate(`hcannon_${side}`, AX, -g * 0.8 * Math.max(0, -chh) - 1.0 * this.pTuck);
      P.rotate(`thigh_${side}`, AZ, s * 0.12 * this.pStun);
    }
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
    host.rotation.set(phi, 0, this.formVis === 'burn' ? Math.sin(this.age * 0.9) * 0.03 * (fly ? 1 : 0) : 0);
    const pz = phi < 0 ? hind : 0;
    host.position.set(0, pz * Math.sin(phi) + bob, pz * (1 - Math.cos(phi)));
  }
}

const _hitW = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };
const _keep = new THREE.Vector3();

let glowTex: THREE.Texture | null = null;

/** 软边光晕贴图（径向渐变，中心白、边缘透明）；没有 DOM（node 测试）时不用贴图 */
function glowTexture(): THREE.Texture | null {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,230,180,0.75)');
  grad.addColorStop(0.6, 'rgba(255,160,80,0.22)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** 测试与检视用：当前形态、场地、锁扣、吊鼎（只读） */
export function qilinDebug(b: Qilin): {
  form: FormId; furnace: QilinFurnace; cauldron: QilinCauldron | null; crackLeft: number; drinksDone: number; fx: QilinFx | null;
} {
  return { form: b.isBurn ? 'burn' : 'xuan', furnace: b.furnace, cauldron: b.cauldron, crackLeft: b.crackLeft, drinksDone: b.drinksQueued, fx: b.fx };
}

// ───────────────────────────── 开发钩子（?dev，只在开发服务器里） ─────────────────────────────

interface DevHook {
  boss: Qilin;
}

let devHook: DevHook | null = null;

function devHookEnabled(): boolean {
  return !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
}

/** 调试：当前形态的片段状态（没有片段为 null） */
function qilinClipState(boss: Qilin): { state: string | null; ready: boolean; frozen: boolean } | null {
  const c = (boss as unknown as { F: Form }).F.clips;
  return c ? { state: c.state, ready: c.ready, frozen: c.frozen } : null;
}

function installDevHook(boss: Qilin): void {
  devHook = { boss };
  (window as unknown as Record<string, unknown>).__qilin = {
    get boss() { return boss; },
    skipIntro: () => boss.director?.requestSkip(true) ?? false,
    /** 把生命层打到某个比例（门槛照常起作用：每次只越一道线） */
    setHealth: (fraction: number) => {
      boss.armor = 0;
      boss.hp = Math.max(1, boss.maxHp * fraction);
    },
    forceMove: (id: string) => boss.forceMove(id),
    breakLock: (i: number) => {
      const l = boss.locks[i];
      if (l?.alive) l.onKilled({
        request: { base: 9999, element: 'none', source: 'weapon', canCrit: false, procDepth: 0, tags: [] },
        dealt: 9999, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
      });
      return !!l;
    },
    state: () => ({
      pos: boss.position.toArray().map(v => +v.toFixed(2)), cam: boss.ctx.camera.position.toArray().map(v => +v.toFixed(2)),
      phase: boss.phase, form: boss.formId, introDone: boss.introDone, transitioning: boss.transitioning, move: boss.currentMove?.id ?? null,
      stage: boss.currentMove?.stage ?? null, hp: boss.hp, maxHp: boss.maxHp, armor: boss.armor, maxArmor: boss.maxArmor, crack: +boss.crackLeft.toFixed(2),
      sipping: boss.sipping, drinkQ: boss.drinkQuadrant, drinks: [boss.drinksQueued, boss.drinksStarted, boss.drinksFinished], hits: boss.cauldronHits,
      locks: boss.locks.map(l => !!l?.alive), cauldron: boss.cauldron?.state ?? null, cauldronArt: boss.cauldron?.hasArt ?? false,
      flood: boss.flood ? { q: boss.flood.floodingQuadrant, warn: boss.flood.warningQuadrant, active: boss.flood.active } : null,
      alt: +boss.altitude.toFixed(2), sky: boss.skyTarget, enraged: boss.enraged, act: boss.lastAct, furnaceFound: boss.furnace.found,
      director: boss.director ? { stage: boss.director.stage, shot: boss.director.shotName, t: boss.director.t, released: boss.director.released } : null,
      color: hexColor(boss.qdef.color), clip: qilinClipState(boss),
    }),
  };
}
