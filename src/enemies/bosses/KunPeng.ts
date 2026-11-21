/**
 * 鲲鹏（Unity KunPeng/KunPengBrain.cs + KunPengDeath 的网页版；定义 KunPengDef.ts，招式 KunPengMoves.ts，场地 KunPengArena.ts，登场 KunPengIntro.ts）。
 * 第二章首领，2-4 北冥冰台：《庄子》北冥之鱼，化而为鸟。两个形态各是一个模型，阶段转换时在冰雾里换模型。
 * 首领框架（framework/BossBrain）之上加这几层：
 *   · 冰窟（IceHoleInfo）：Unity 场景从关卡水体反推（2-4 的北冥海），白盒关卡从导航网格反推，都没有就按场地建虚拟冰窟。
 *     场地圆（框架的 bossCenter / arenaRadius）= 冰窟圆心 / 外缘 + 2。
 *   · 不走导航：鲲的逻辑位置钉在冰窟里（方位 theta、离圆心 半径 − 4.6，y = 环台地面）；鹏在空中（EnemyBase 的飞行积分：水平按 accel 追期望速度，
 *     竖直追 地面 + hoverAlt，飞越冰窟时不低于 11.5 m，盘旋时上下起伏 0.5 m）。
 *   · 运行时姿态：鲲的沉浮 sunk（0 = 露出水面，1 = 完全沉下去 13 m）+ 按动作的俯仰 / 抬身，平切口始终压在水面下 0.3 m（KunPengMath.cutCeiling）；
 *     鹏转换时从雾里升起（riseOffset）。正式美术 + 动画数据读好后骨骼由片段驱动（M12：SK_Boss_Kun / SK_Boss_Peng 的采样 + Blender 手 K，
 *     src/anim/ClipPlayer；招式的 playAct 照 Unity KunPengBrain.Act 立刻切片段、按秒数拉伸，片段事件进招式的 cue，释放帧顿帧 impactHold 只顿片段）；
 *     读好之前和程序化兜底体沿用程序化摆姿势（同 Unity 的代理 / 占位体那条路）。
 *   · 鲛珠：两个形态的弱点都是额头的 pearl，平时微光，猛砸趴台 / 落台歇翼 / 撞柱硬直时大亮。
 *   · 生命刻度：75% 鲲怒（鲲的招式喘息 × 0.8、猛砸连掀两道冰浪、吐冰多一块）；25% 鹏狂怒（框架的狂怒：喘息 × 0.78、俯冲连掠、羽刃 14 枚）。
 *   · 特效（KunPengFx）：水面翻涌、吞吸气流、狂风风痕、冰雾爆闪、羽刃。
 *   · 演出：登场演出（KunPengIntro，代码驱动机位），化鹏（漩涡 → 水击三千里 → 扶摇 → 展翅，展翅跟鹏 roar 片段的 spread 事件），
 *     倒下（鲲沉回冰窟 / 鹏播手 K death 片段：翼折 → 栽落 → 触地 → 最后一声，没有片段时程序化收翼坠落砸冰面，之后冻雾）。
 * 网址带 ?dev 时（只在开发服务器里）挂 window.__kunpeng 调试钩子（跳演出、跳阶段、强制出招），生产构建里整段不存在。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp, TAU } from '../../core/math';
import type { HitShape } from './BossBase';
import { attachEnemyArt } from '../../assets/EnemyArt';
import type { NativeBody } from '../../assets/NativeRig';
import { BossBrain, hexColor } from './framework/BossBrain';
import type { BossFormDef, BossPhaseDef } from './framework/BossDef';
import type { BossMove } from './framework/BossMove';
import { stageHooks } from './framework/StageHooks';
import { BossIntroDirector, introEnabled, type DirectedBoss } from './intro/BossIntroDirector';
import { holeFromWater, IceHoleInfo, locateIceHole } from './KunPengArena';
import { KunPengDef, KunPengMath } from './KunPengDef';
import { KunPengFx } from './KunPengFx';
import { kunPengIntro, setIntroHole } from './KunPengIntro';
import { ClipPlayer } from '../../anim/ClipPlayer';
import { anchorOn, buildKunProc, buildPengProc, KUN_POINTS, PENG_POINTS, ProcPose, type KPPose, type ProcBody } from './KunPengModel';
import { createKunPengMove } from './KunPengMoves';
import { KunPengDeath, PENG } from './KunPengPlans';

/** 敌人名册里的条目（首领自己的耐久按 KunPengDef 的定档表另算；这里的是难度 1 的参考值） */
export const KUNPENG_DEF: EnemyDef = {
  id: 'boss_kunpeng',
  name: '鲲鹏',
  hp: KunPengDef.TierHp / KunPengDef.StageDifficulty,
  shield: KunPengDef.TierShield / KunPengDef.StageDifficulty,
  speed: 9,
  radius: 3,
  height: 8,
  flying: true,
  damage: 14,
  coins: [60, 100],
  essence: 60,
  isBoss: true,
  headY: 7.5,
  headRadius: 0.6,
  knockbackResist: 1,
  color: 0x7fe8ff,
};

const KUN_SCALE = KunPengDef.KunScale;
const PENG_SCALE = KunPengDef.PengScale;
const KUN_BASE_Y = KunPengDef.KunBaseY;
const KUN_SUNK_Y = KunPengDef.KunSunkY;
const WARN = KunPengDef.Warn;
const ICE = KunPengDef.Ice;
const PEARL = KunPengDef.Pearl;
const DEG = Math.PI / 180;
const { span, easeInOut, easeOutCubic, deltaAngle, moveTowardsAngle } = KunPengMath;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _save = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

export type FormId = 'kun' | 'peng';

interface Form {
  host: THREE.Group;
  proc: ProcBody;
  pose: KPPose;
  native: NativeBody | null;
  /** 片段播放器（M12：SK_Boss_Kun / SK_Boss_Peng 的采样 + Blender 手 K 片段）；读好之前 / 没有美术身体时程序化摆姿势 */
  clips: ClipPlayer | null;
  /** 关键点锚点（挂在骨骼上） */
  pts: Record<string, THREE.Object3D>;
  shapes: HitShape[];
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 场景文档里的首领场（StageDirector 的 Unity 场景文档；只读需要的字段） */
interface SceneBossDoc {
  id: string;
  center: number[];
  floorY: number;
  radius: number;
}

export class KunPeng extends BossBrain implements DirectedBoss {
  readonly kdef: KunPengDef;
  hole!: IceHoleInfo;
  /** 冰窟从哪来：scene（关卡水体）/ nav（白盒导航）/ fallback（虚拟） */
  holeSource: 'scene' | 'nav' | 'fallback' = 'fallback';
  fx: KunPengFx | null = null;
  kun!: Form;
  peng!: Form;
  director: BossIntroDirector | null = null;
  /** StageDirector 读：登场演出自己打名字卡，不再打横幅 */
  introDirected = false;
  readonly introOffset = new THREE.Vector3();

  // ── 鲲 ──
  /** 鲲在冰窟的哪个方位（相对圆心的 yaw，度） */
  theta = 0;
  /** 0 = 露出水面，1 = 完全沉没（视觉） */
  sunk = 1;
  /** 沉在水下：不可选中（潜袭） */
  submerged = false;
  /** 75% 以下：猛砸连掀两道冰浪、吐冰多一块、喘息 × 0.8 */
  kunFury = false;
  /** 平切口一圈最高点离水面多高（米；测试用，正常 ≤ −0.2） */
  cutTop = -Infinity;

  // ── 鹏 ──
  /** 目标高度（离环台地面） */
  hoverAlt = 13.5;
  /** 上次落台歇翼之后出过几招（≥ 2 才会落台） */
  movesSincePerch = 0;
  /** 转换演出里鹏从雾里升起的偏移（米，负 = 在下面） */
  riseOffset = 0;
  perched = false;
  diving = false;

  // ── 鲛珠 / 演出 ──
  pearlBright = false;
  pearlGlow = 0.3;
  lastAct: string | null = null;
  private readonly told = new Set<string>();
  private orbit = 0;
  private orbitDir = 1;
  private orbitTimer = 6;
  private flapPhase = 0;
  private transPrev = -1;
  private spreadDone = false;
  private introRoared = false;
  /** 本场顿帧次数（测试 / 调试；Unity KunPengBrain.ImpactHolds） */
  impactHolds = 0;
  private holdLeft = 0;
  private holdDebt = 0;
  // 动画参数（平滑）
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
  private kRise = 0;
  // 倒下演出（KunPengDeath）
  private deathKun = true;
  private deathStartY = 0;
  private deathDrop = 0;
  private deathLanded = false;
  private deathLingered = false;
  /** 鹏播手 K death 片段（正式美术 + 片段读好、有 death 状态）；否则程序化收翼坠落 */
  private deathKeyframed = false;
  private deathIntoWater = false;
  /** 触地的地面 / 水面高度（世界） */
  private deathGround = 0;
  private deathBroke = false;
  private deathCried = false;
  /** 触地 / 没顶的时刻（倒下后几秒）与来源（片段事件 / 按时间兜底；调试） */
  deathLandedAt = -1;
  deathLandSource = '—';

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new KunPengDef();
    super(ctx, KUNPENG_DEF, def, opts);
    this.kdef = def;
    this.displayName = '鲲鹏 · 鲲';
    this.hoverAlt = def.pengHover;
    this.accel = def.pengAccel;
  }

  // ───────────── 场地 / 模型 ─────────────

  override init(): void {
    // 在 BossBase.init（夹到竞技场、登场第一帧）之前就位：刷新点在冰窟哪一侧，鲲就从那一侧第一次探头
    this.hole = this.resolveHole();
    this.bossCenter.copy(this.hole.center);
    this.arenaRadius = this.hole.outer + 2;
    const d = this.hole.distance(this.position);
    this.theta = d > 0.5 ? this.hole.angle(this.position) : 0;
    this.orbit = this.theta;
    this.sunk = 1;
    this.placeKun();
    this.setFacingDeg(this.theta);
    this.flyTargetY = this.position.y;
    this.velocity.set(0, 0, 0);
    super.init();
  }

  /** 冰窟：关卡水体（Unity 场景）→ 白盒导航 → 虚拟冰窟（场景文档的首领场 / 竞技场中心） */
  private resolveHole(): IceHoleInfo {
    const doc = (this.ctx.stage as unknown as { unityDocument?: { bosses?: SceneBossDoc[] } | null }).unityDocument;
    const boss = doc?.bosses?.find(b => b.id === KunPengDef.Id) ?? doc?.bosses?.[0] ?? null;
    const near = boss ? new THREE.Vector3(boss.center[0], boss.floorY, boss.center[2]) : this.position;
    const water = stageHooks.water?.waterBodies() ?? [];
    const fromWater = holeFromWater(water, near, boss ? boss.radius : null);
    if (fromWater) {
      this.holeSource = 'scene';
      return fromWater;
    }
    if (!boss) {
      const nav = locateIceHole(this.ctx.nav, this.ctx.stage.arena, this.position);
      this.holeSource = nav.found ? 'nav' : 'fallback';
      return nav;
    }
    this.holeSource = 'fallback';
    return IceHoleInfo.fallback(near, boss.radius, this.position);
  }

  /** 冰窟半径里鲲身体中心所在的圈 */
  get kunRing(): number {
    return Math.max(1, this.hole.radius - this.kdef.kunInset);
  }

  /** 把鲲钉在冰窟里当前方位（离圆心 kunRing，y = 环台地面） */
  placeKun(): void {
    this.hole.point(this.theta, this.kunRing, _v);
    this.position.set(_v.x, this.hole.floorY, _v.z);
    if (this.formId !== PENG) {
      this.flyTargetY = this.position.y;
      this.velocity.set(0, 0, 0);
    }
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
    this.kun = { host: kunHost, proc: kp, pose: new ProcPose(kp.joints), native: null, clips: null, pts: {}, shapes: [] };
    this.peng = { host: pengHost, proc: pp, pose: new ProcPose(pp.joints), native: null, clips: null, pts: {}, shapes: [] };
    return root;
  }

  protected override createMove(id: string): BossMove | null {
    return createKunPengMove(this, id);
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
        // 片段（Unity Animator）：宿主的俯仰 / 抬身已经烘在根骨骼里，不开原地播放、不要运行时动画层（看向会和烘好的转头打架）
        const clips = new ClipPlayer(art.native.assetId, art.native.model, { root: this.root, rig: false, inPlace: false });
        const kun = f === this.kun;
        // 片段事件交给招式的 cue（hit / wave2 / plunge / breach / flap…）；sfx: / fx: 不转——网页的招式自己播音效和震屏（Unity 是 ClipsDriveSfx 时招式不播），免得响两遍
        clips.onEvent = (e) => {
          if (this.alive && kun === this.isKun && !/^(sfx|fx):/.test(e.name)) this.emitAnimEvent(e.name);
          // death 片段的事件（倒下后框架不再转发，这里自己接；Unity KunPengDeath.OnAnimEvent）
          else if (!this.alive && !kun && this.deathKeyframed) this.deathEvent(e.name);
        };
        f.clips = clips;
      }
    }
    this.buildAnchors(this.kun, KUN_POINTS);
    this.buildAnchors(this.peng, PENG_POINTS);
    const K = this.kun.pts;
    this.kun.shapes = [
      { anchor: K.pearl, radius: 0.6, halfHeight: 0, weak: true },
      { anchor: K.head, radius: 2.0, halfHeight: 0, weak: false },
      { anchor: K.snout, radius: 0.9, halfHeight: 0, weak: false },
      { anchor: K.neck, radius: 2.2, halfHeight: 0, weak: false },
      { anchor: K.body, radius: this.kdef.kunBodyRadius, halfHeight: 0, weak: false },
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
    this.fx = new KunPengFx(this.ctx, this.hole, { sceneWater: this.holeSource === 'scene', waterY: this.hole.waterY });
    this.fx.setAgitation(1);
    if (introEnabled() && kunPengIntro.validate().length === 0) {
      setIntroHole(this.hole);
      this.director = new BossIntroDirector(this.ctx, kunPengIntro, this, this.position.clone());
      this.introHold = this.director;
      this.introDirected = true;
    }
    if (devHookEnabled()) installDevHook(this);
  }

  private buildAnchors(f: Form, table: Record<string, { bone: string; at: readonly [number, number, number] }>): void {
    for (const [name, p] of Object.entries(table)) {
      const bone = f.pose.bone(p.bone) ?? f.host;
      f.pts[name] = anchorOn(f.host, bone, p.at, `kp_${name}`);
    }
  }

  private useForm(id: FormId): void {
    const f = id === 'kun' ? this.kun : this.peng;
    this.kun.host.visible = id === 'kun';
    this.peng.host.visible = id === 'peng';
    this.hitShapes = f.shapes;
    this.weakAnchor = f.pts.pearl;
    this.muzzleAnchor = id === 'kun' ? f.pts.mouth : f.pts.beak;
  }

  get isKun(): boolean {
    return this.formId !== PENG;
  }

  get isPeng(): boolean {
    return this.formId === PENG;
  }

  // ───────────── DirectedBoss ─────────────

  get name(): string {
    return this.kdef.name;
  }

  get title(): string | null {
    return this.kdef.title;
  }

  introOverlay(color: number, amount: number): void {
    if (amount > 0.001) this.setEmissive(new THREE.Color(color), amount);
    else this.setEmissive(new THREE.Color(0x000000), 0);
  }

  get barTicks(): readonly number[] {
    return this.kdef.barTicks;
  }

  // ───────────── 契约 ─────────────

  /** 鲲沉在水下时也不可选中 */
  protected override get extraUntargetable(): boolean {
    return this.submerged;
  }

  /** 环台地面（冰窟里的「脚下」是冰窟底，招式都按环台地面结算） */
  protected override floorY(): number {
    return this.hole ? this.hole.floorY : super.floorY();
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const f = this.isKun ? this.kun : this.peng;
    const a = this.isKun ? f?.pts.neck : f?.pts.chest;
    return a ? a.getWorldPosition(out) : super.getBodyCenter(out);
  }

  // ───────────── 每帧 ─────────────

  override update(dt: number): void {
    if (!this.alive) {
      // 倒下演出由模型完成：逻辑位置钉住（鹏的坠落是模型动画）
      _save.copy(this.position);
      super.update(dt);
      this.position.copy(_save);
      this.velocity.set(0, 0, 0);
    } else {
      super.update(dt);
    }
    this.fx?.update(dt);
    if (this.waitingForSpawn || !this.alive) return;
    if (this.isKun) this.stepKun(dt);
    else this.stepPeng();
    // 登场动作期间 EnemyBase 不调 animate（生成缩放那一段）
    if (!this.introDone && this.age < this.spawnDuration) this.animate(dt);
    const want = this.pearlBright || this.staggered ? 1 : 0.3;
    this.pearlGlow += (want - this.pearlGlow) * Math.min(1, dt * 4);
  }

  /** 鲲：逻辑位置钉在冰窟里；不在潜袭 / 转换 / 登场里时慢慢浮出水面 */
  private stepKun(dt: number): void {
    if (this.introDone && !this.transitioning && this.currentMove?.id !== 'dive') this.sunk = Math.max(0, this.sunk - dt * 2);
    this.placeKun();
  }

  /** 鹏：竖直追目标高度（招式间隙飞越冰窟时不低于 11.5 m，盘旋时上下起伏 0.5 m） */
  private stepPeng(): void {
    const alt = this.currentMove || this.transitioning || this.staggered ? this.hoverAlt : this.overHoleAlt(this.hoverAlt);
    const low = this.perched || this.diving || this.staggered || alt <= 0.7;
    const bob = low ? 0 : Math.sin(this.age * 1.3) * 0.5;
    this.flyTargetY = this.hole.floorY + alt + bob;
  }

  // ───────────── 给招式用的工具 ─────────────

  get facingDeg(): number {
    return this.facing / DEG;
  }

  setFacingDeg(yawDeg: number): void {
    this.facing = yawDeg * DEG;
  }

  /** 按角速度（度/秒）转向某点 */
  faceDeg(p: THREE.Vector3, degPerSec: number, dt: number): void {
    this.faceTowards(p, degPerSec * DEG, dt);
  }

  /** 首领 → 玩家的 yaw（度） */
  get yawToPlayerDeg(): number {
    const p = this.ctx.player.position;
    const dx = p.x - this.position.x, dz = p.z - this.position.z;
    return dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) / DEG : this.facingDeg;
  }

  /** 玩家在冰窟的哪个方位（度） */
  get playerAngle(): number {
    return this.hole.angle(this.ctx.player.position);
  }

  /** 转向玩家，但不超出冰窟外法线两侧 51.57°（鲲不会背对冰沿）；k = 偏转比例 */
  aimKunAtPlayer(k: number): void {
    const lim = this.kdef.kunAimLimit;
    const want = clamp(deltaAngle(this.theta, this.yawToPlayerDeg), -lim, lim);
    this.setFacingDeg(this.theta + want * k);
  }

  /** 按角速度把头转向玩家（同样夹在外法线两侧） */
  turnKunToward(degPerSec: number, dt: number): void {
    const lim = this.kdef.kunAimLimit;
    const want = this.theta + clamp(deltaAngle(this.theta, this.yawToPlayerDeg), -lim, lim);
    this.setFacingDeg(moveTowardsAngle(this.facingDeg, want, degPerSec * dt));
  }

  /** 口部投影（吞吸气流的终点）：往前 3.4 × 体型，高 4.2 */
  mouthPoint(out: THREE.Vector3): THREE.Vector3 {
    KunPengMath.dir(this.facingDeg, out).multiplyScalar(3.4 * KUN_SCALE).add(this.position);
    out.y = this.position.y + 4.2;
    return out;
  }

  /** 吞吸收尾那一口咬在冰沿上的位置：往前 kunInset + 1.6 */
  biteSpot(out: THREE.Vector3): THREE.Vector3 {
    KunPengMath.dir(this.facingDeg, out).multiplyScalar(this.kdef.kunInset + 1.6).add(this.position);
    out.y = this.hole.floorY;
    return out;
  }

  /** 嘴 / 喙（吐冰的出手点） */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.getMuzzle(out);
  }

  /** 两侧翼尖（鹏的 wing_*_2 锚点） */
  wingTip(left: boolean, out: THREE.Vector3): THREE.Vector3 {
    return this.peng.pts[left ? 'wingL' : 'wingR'].getWorldPosition(out);
  }

  talons(out: THREE.Vector3): THREE.Vector3 {
    return this.peng.pts.talons.getWorldPosition(out);
  }

  chest(out: THREE.Vector3): THREE.Vector3 {
    return this.peng.pts.chest.getWorldPosition(out);
  }

  /** 玩家 lead 秒后的位置（按当前速度） */
  predict(lead: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player;
    return out.copy(p.position).addScaledVector(p.velocity, lead);
  }

  /** 这一帧往 target 飞（水平，speed 米/秒，arrive 米内减速）；返回是否已到 */
  flyTo(target: THREE.Vector3, speed: number, arrive: number): boolean {
    const dx = target.x - this.position.x, dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) {
      this.stopMoving();
      return true;
    }
    const v = speed * Math.min(1, dist / Math.max(0.5, arrive * 2));
    this.setMove(dx, dz, Math.max(v, Math.min(speed, 2)));
    return dist <= arrive;
  }

  /** 这一帧按给定的水平速度飞（俯冲） */
  flyVelocityTo(vx: number, vz: number): void {
    this.setMove(vx, vz, Math.hypot(vx, vz));
  }

  hover(): void {
    this.stopMoving();
  }

  /** 飞越冰窟上空时至少多高 */
  overHoleAlt(alt: number): number {
    return this.hole.found && this.hole.distance(this.position) < this.hole.radius + this.radius + 1 ? Math.max(alt, this.kdef.pengOverHole) : alt;
  }

  /** 某点正下方的地面（打不到时：冰窟上空 −∞，否则环台地面） */
  groundBelow(p: THREE.Vector3): number {
    const from = Math.max(p.y, this.hole.floorY) + 3;
    const g = this.ctx.world.groundHeight(p.x, p.z, from, 0);
    if (Number.isFinite(g) && g > this.hole.floorY - 12) return g;
    return this.hole.overHole(p) ? -Infinity : this.hole.floorY;
  }

  /**
   * 鹏脚下（整个碰撞方块范围内）最高的地面：平地 = 环台地面，压到祭台 / 冰柱时 = 台顶。
   * Unity 是脚印圆上 9 根射线；网页用碰撞世界的方形脚底查询（边长 2 × 脚印半径，包住整个圆，夹在两根射线之间的台角也算上）
   */
  groundUnder(p: THREE.Vector3, footprint = -1): number {
    const r = footprint > 0 ? footprint : this.radius * 0.85;
    const top = this.hole.floorY + 8;
    const g = this.ctx.world.groundHeight(p.x, p.z, top, r);
    return Number.isFinite(g) && g < top ? Math.max(this.hole.floorY, g) : this.hole.floorY;
  }

  /** 冰窟边缘段（Unity 的 rimRoot：气流和狂风越过它）：冰窟半径外 3.2 m 以内的碰撞 */
  private isRim(p: THREE.Vector3): boolean {
    return this.hole.found && this.hole.distance(p) < this.hole.radius + 3.2 && p.y < this.hole.floorY + 2.6;
  }

  /** 从 a 到 b 被地形 / 建筑挡住（冰柱、矮墙、祭台）：忽略冰窟边缘段 */
  coverBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _v.copy(a);
    for (let k = 0; k < 4; k++) {
      _dir.subVectors(b, _v);
      const len = _dir.length();
      if (len < 0.05) return false;
      _dir.divideScalar(len);
      if (!this.ctx.world.raycast(_v, _dir, len - 0.01, _hit)) return false;
      if (!this.isRim(_hit.point)) return true;
      _v.copy(_hit.point).addScaledVector(_dir, 0.05);
    }
    return false;
  }

  /** 从 origin 沿 dir 看 dist 米内第一处陡面（法线朝上分量 < 0.5，不算冰窟边缘段）离多远；没有 = ∞ */
  steepAhead(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): number {
    _w.copy(origin);
    let travelled = 0;
    for (let k = 0; k < 4 && travelled < dist; k++) {
      if (!this.ctx.world.raycast(_w, dir, dist - travelled, _hit)) return Infinity;
      if (_hit.normal.y < 0.5 && !this.isRim(_hit.point) && _hit.distance > 0) return travelled + _hit.distance;
      travelled += _hit.distance + 0.05;
      _w.copy(_hit.point).addScaledVector(dir, 0.05);
    }
    return Infinity;
  }

  /** 每场第一次的提示（同一件事只说一次） */
  tellOnce(key: string, text: string, color: string): void {
    if (!key || this.told.has(key)) return;
    this.told.add(key);
    this.ctx.ui.toast(text, color);
  }

  /**
   * 播一个动作：程序化姿势按名字切换；片段照 Unity KunPengBrain.Act 立刻切过去、拉伸到 seconds 播完（ActScale = 片段长 / seconds），
   * 'idle' / 'Locomotion' 回步态。clip = false：只换程序化姿势——Unity 的招式不播、由控制器自己连段的（吞吸 → 扑咬、蓄力 → 猛砸、
   * 下潜 → 破水）和招式中途回待机的那几处，片段照原样播完（见 KunPengMoves）。
   */
  override playAct(state: string, seconds: number, clip = true): void {
    if (!state) return;
    this.lastAct = state;
    this.setAnim(state, true);
    if (clip) this.playClip(state, seconds);
  }

  /** 当前形态的片段播放器（没有美术身体为 null；数据还没读好时请求会记下、读好后补播） */
  private get formClips(): ClipPlayer | null {
    return (this.isKun ? this.kun : this.peng).clips;
  }

  /** 只播片段（招式里片段时刻和程序化姿势切换点不同的地方，见 KunPengMoves） */
  clipAct(state: string, seconds: number): void {
    if (state) this.playClip(state, seconds);
  }

  private playClip(state: string, seconds: number, fade = 0.12): void {
    const c = this.formClips;
    if (!c) return;
    // 控制器的 act_<状态> 触发器走任意状态 0.12 s 过渡；没有这个状态（Hit 之类）Unity 只报警告、什么也不做（ClipPlayer 同样）
    if (state === 'idle' || state === 'Locomotion') c.playLocomotion();
    else c.playTimed(state, seconds, fade);
  }

  /**
   * 释放帧的顿帧（Unity KunPengBrain.ImpactHold）：只把首领自己的片段压到 ×0.05 停 seconds 秒（≤ 0.12），之后 ×1.6 追回欠下的时间——
   * 后面的片段事件照样落在原来的时刻附近，不拖慢招式；全局时间不动。没有片段（程序化摆姿势）时什么也不做。震屏由调用方同一帧给
   */
  impactHold(seconds: number): void {
    if (!this.formClips?.ready || !this.alive || !(seconds > 0)) return;
    this.holdLeft = Math.max(this.holdLeft, Math.min(0.12, seconds));
    this.impactHolds++;
  }

  /** 片段这一帧走的时间（Unity TickHold 的 anim.speed × dt） */
  private holdDt(dt: number): number {
    if (!this.alive) {
      this.holdLeft = this.holdDebt = 0;
      return dt;
    }
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      this.holdDebt += dt * 0.95;
      return dt * 0.05;
    }
    if (this.holdDebt > 0) {
      const catchUp = 1.6;
      this.holdDebt -= dt * (catchUp - 1);
      const rate = this.holdDebt > 0 ? catchUp : 1;
      if (this.holdDebt <= 0) this.holdDebt = 0;
      return dt * rate;
    }
    return dt;
  }

  // ───────────── 框架钩子 ─────────────

  protected override introTick(t: number, dt: number): void {
    // 鲲从冰窟里升起：水面翻涌、冰沿炸起冰屑，升到一半时吼叫
    this.sunk = 1 - easeOutCubic(span(t, 0.1, 0.8));
    this.aimKunAtPlayer(0.5);
    if (t < 0.8 && dt > 0 && Math.random() < dt / 0.08) {
      const p = this.hole.point(this.theta + (Math.random() * 2 - 1) * 23, this.kunRing + Math.random() * 3, _v);
      p.y = this.hole.waterY + 0.3;
      this.ctx.fx.burst(p, ICE, 6, 6, 0.7, 0.35, 10);
    }
    if (t >= 0.72 && !this.introRoared) {
      this.introRoared = true;
      this.playAct('roar', 2.4);
      this.playSfx('boss_roar', 1, 0.75);
      const ring = this.hole.point(this.theta, this.hole.radius + 1, _v);
      this.ctx.fx.ring(ring.setY(this.hole.floorY + 0.1), 12, WARN, 1);
      this.quake(0.6, 1);
    }
  }

  protected override onIntroEnd(): void {
    this.playAct('idle', 1);
    this.fx?.setAgitation(0.35);
    // 名字卡已由登场打过，这里补一条弱点提示
    this.tellOnce('intro', '北冥之鲲——它会从冰窟各处探头，额头的鲛珠是弱点', '#8fe3ff');
  }

  /** 招式间隙：鲲在冰窟里慢慢绕到玩家那一侧、转头盯着玩家；鹏绕冰窟盘旋（环台中线上空），隔 5–9 s 掉头 */
  protected override idleMove(dt: number): void {
    const d = this.kdef;
    if (this.isKun) {
      this.theta = moveTowardsAngle(this.theta, this.playerAngle, d.kunCircleRate * dt);
      this.placeKun();
      this.turnKunToward(d.kunTurnRate, dt);
      return;
    }
    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0) {
      this.orbitDir = -this.orbitDir;
      this.orbitTimer = this.ctx.rng.range(d.pengOrbitFlip[0], d.pengOrbitFlip[1]);
    }
    this.orbit += this.orbitDir * d.pengOrbitRate * dt;
    this.flyTo(this.hole.point(this.orbit, this.hole.midRing, _v), this.kdef.speed * 0.95, 1.5);
    this.faceDeg(this.ctx.player.position, 126, dt);
    this.hoverAlt = this.overHoleAlt(d.pengHover);
  }

  protected override passiveTick(): void {
    // 鹏狂怒（25%）：只在鹏形态（鲲形态的刻度只画在血条上）
    if (this.isPeng && !this.enraged && this.phaseFraction() <= KunPengDef.RageAt) this.enrage('health');
    const id = this.currentMove?.id;
    this.fx?.setAgitation(this.isKun ? (id === 'inhale' || id === 'dive' ? 1 : 0.35) : 0.25);
  }

  protected override onMark(id: string): void {
    if (id !== KunPengDef.FuryMark || this.kunFury) return;
    this.kunFury = true;
    // 鲲怒：鲲的招式喘息 × 0.8，猛砸连掀两道冰浪、吐冰多一块（招式里读 kunFury）
    for (const m of this.moveList) if (m.forms?.includes(KunPengDef.KunForm)) m.recovery *= 0.8;
    if (this.isKun) this.tellOnce('fury', '鲲怒了——猛砸会连掀两道冰浪', '#8fe3ff');
  }

  protected override onPhase(): void {
    this.transPrev = -1;
    this.spreadDone = false;
    this.submerged = false;
    this.fx?.suction(false);
    this.fx?.gust(false);
    this.fx?.setAgitation(1);
  }

  /**
   * 化鹏：0.6–1.4 s 鲲边吼边沉，冰窟卷成漩涡 → 1.3 s「水击三千里」：冰爆、整圈冰浪推到外缘 → 1.4 s 冰窟中心拔起扶摇柱（到 3.4 s）；
   * 框架在 1.55 s 换模型 → 鹏从水下 14 m 在柱里升起 → 3.6 s 展翅：柱子炸散成风环 + 雪羽，长啸。冰雾 1.2–2.6 s 最浓
   */
  protected override transitionTick(t: number, dt: number): void {
    const was = this.transPrev;
    this.transPrev = t;
    const crossed = (x: number): boolean => was < x && t >= x;
    const c = this.hole.center;
    const water = _w.set(c.x, this.hole.waterY, c.z);
    if (this.isKun) {
      this.placeKun();
      this.aimKunAtPlayer(0.6);
      this.sunk = span(t, 0.6, 1.4);
    }
    const fx = this.ctx.fx;
    if (crossed(0.6)) {
      // 北冥漩涡：鲲往下沉，水面跟着卷
      fx.ring(water, Math.max(4, this.hole.radius * 0.85), WARN, 1.4);
      fx.ring(water, Math.max(3, this.hole.radius * 0.5), 0xeefcff, 1.2);
    }
    if (t > 0.6 && t < 1.4 && Math.random() < dt / 0.05) {
      const a = t * 9 + Math.random(), r = this.hole.radius * (0.85 - 0.6 * span(t, 0.6, 1.4)) * Math.random();
      fx.burst(_v.set(c.x + Math.sin(a) * r, this.hole.waterY + 0.1, c.z + Math.cos(a) * r), 0xeefcff, 3, 2, 0.6, 0.22, 3);
    }
    if (crossed(1.3)) {
      // 水击三千里（释放帧）：冰爆 + 水柱、整圈冰浪推到外缘
      fx.explosion(_v.set(c.x, c.y + 1.5, c.z), clamp(this.hole.radius * 0.6, 6, 8), ICE);
      fx.burst(_v, ICE, 60, 16, 1.4, 0.6, 12);
      fx.burst(_v.set(c.x, c.y + 4, c.z), 0xffffff, 40, 10, 1.6, 0.8, -2);
      for (let i = 0; i < 12; i++) {
        const p = this.hole.point(i * 30, this.hole.radius - 0.5, _v);
        fx.burst(p.setY(this.hole.waterY + 0.5), 0xeefcff, 10, 7, 0.9, 0.35, 9);
      }
      this.quake(0.85, 1, 90);
      this.hazards.wave({
        x: c.x, y: c.y, z: c.z, speed: 16, maxRadius: this.hole.outer + 2, damage: this.moveDamage(10 / Math.max(1, this.bdef.damage)), color: WARN,
        startRadius: this.hole.radius, width: 1.2, height: 1, knockback: 8, dust: ICE,
      });
      this.playSfx('explosion', 1, 0.55);
      this.playSfx('shield_break', 1, 0.5);
    }
    // 扶摇柱：螺旋上升的风线（到展翅为止）
    if (t > 1.4 && t < 3.4 && !this.spreadDone && Math.random() < dt / 0.03) {
      const a = t * 7 + Math.random() * TAU, h = (t - 1.4) * 12 * Math.random();
      fx.burst(_v.set(c.x + Math.sin(a) * 6, this.hole.waterY + h, c.z + Math.cos(a) * 6), 0xeaf8ff, 2, 3, 0.6, 0.22, -4);
    }
    // 冰雾：1.2–2.6 s 起一层偏冷的蓝灰，最浓 0.35（Unity 不再整幅冷白；换形由扶摇柱和冰海炸开挡着）
    const fog = t < 1.2 ? 0 : t < 1.55 ? (t - 1.2) / 0.35 : t < 2.6 ? 1 : Math.max(0, 1 - (t - 2.6) / 1.4);
    this.fx?.flash(fog * 0.35);
    if (this.isPeng) {
      this.riseOffset = -14 * (1 - easeOutCubic(span(t, KunPengDef.TransitionSwap, 3.4)));
      this.faceDeg(this.ctx.player.position, 86, dt);
      this.hoverAlt = this.kdef.pengOverHole + 1;
    }
    if (crossed(3.6) && this.isPeng && !this.spreadDone) this.spreadBurst();
    if (crossed(3.65)) {
      this.playSfx('boss_roar', 1, 1.45);
      this.quake(0.4, 0.8);
    }
  }

  /** 化而为鸟的展翅（释放帧）：扶摇柱炸散成一圈风环 + 雪羽、白闪 */
  private spreadBurst(): void {
    if (this.spreadDone) return;
    this.spreadDone = true;
    const c = this.getBodyCenter(_v);
    this.ctx.fx.burst(c, ICE, 30, 10, 1.0, 0.4, 0);
    this.ctx.fx.burst(c, 0xffffff, 24, 14, 0.6, 0.3, 0);
    this.ctx.fx.ring(c, 14, KunPengDef.Gust, 0.8);
    this.ctx.fx.ring(_w.set(c.x, this.hole.waterY + 0.1, c.z), 18, KunPengDef.Gust, 1);
    this.impactHold(0.08);
    this.quake(0.5, 0.5);
  }

  /** Unity BossBrain.FinishMove：收招 → PlayLocomotion（片段；打断时紧接着的硬直 / 转换 / 倒下动作会盖掉它） */
  protected override onMoveEnded(_m: BossMove): void {
    if (this.alive) this.formClips?.playLocomotion();
  }

  protected override onAnimEvent(evt: string): void {
    // 化鹏长啸的展翅（鹏 roar 片段第 50 帧的 spread）：转换演出里由片段驱动展翅爆发；没有片段时 3.6 s 兜底（transitionTick）
    if (evt === 'spread' && this.transitioning && this.isPeng) this.spreadBurst();
  }

  protected override onTransitionEnd(_phase: BossPhaseDef): void {
    // Unity BossBrain.EndTransition：PlayLocomotion
    this.formClips?.playLocomotion();
    this.riseOffset = 0;
    this.fx?.flash(0);
    if (this.isPeng) this.hoverAlt = this.kdef.pengHover;
  }

  /** 换形（框架在 1.55 s 换）：换模型、鹏落在冰窟正上方 12.5 m、从水下 14 m 升起；护盾重凝、第一招狂风由形态定义给 */
  protected override onFormChanged(_prev: BossFormDef | null, next: BossFormDef): void {
    this.diving = this.perched = false;
    if (next.id !== PENG) return;
    const d = this.kdef;
    const c = this.hole.center;
    this.useForm('peng');
    this.sunk = 1;
    const alt = d.pengOverHole + 1;
    this.position.set(c.x, this.hole.floorY + alt, c.z);
    this.velocity.set(0, 0, 0);
    this.flyTargetY = this.position.y;
    this.hoverAlt = alt;
    this.riseOffset = -14;
    this.orbit = this.playerAngle + 180;
    this.accel = d.pengAccel;
    const left = this.bdef.phases.length > 0 ? Math.max(0.5, this.bdef.phases[0].seconds - KunPengDef.TransitionSwap) : 3;
    this.playAct('roar', left);
    this.displayName = '鲲鹏 · 鹏';
    this.ctx.ui.setBoss(this);
    this.fx?.setAgitation(0.5);
    this.tellOnce('peng', '北冥之鲲化而为鹏——它累了会落到环台上歇翼，额头的鲛珠仍是弱点', '#bfe9ff');
  }

  protected override onStaggered(): void {
    this.diving = false;
    if (this.isPeng) this.hoverAlt = Math.max(0, this.groundUnder(this.position) - this.hole.floorY);
  }

  protected override onDefeated(_result: DamageResult): void {
    this.submerged = false;
    const fx = this.fx;
    if (fx) {
      fx.clearFeathers();
      fx.suction(false);
      fx.gust(false);
      fx.flash(0);
      fx.setAgitation(1);
    }
    this.ctx.ui.toast(this.isKun ? '北冥之鲲沉入了冰海' : '鹏坠入北冥——冰海重归平静', '#bfe9ff');
    this.director?.abort('首领倒下');
    // 倒下演出（KunPengDeath）：鲲沉回冰窟；鹏有手 K death 片段就播片段（翼折 → 栽落 → 触地 → 最后一声），没有就收翼坠落、55% 砸到冰面
    //（死在冰窟上空就坠进北冥）
    this.deathKun = this.isKun;
    this.deathLanded = this.deathLingered = false;
    this.deathBroke = this.deathCried = false;
    this.deathLandedAt = -1;
    this.deathLandSource = '—';
    const host = this.deathKun ? this.kun.host : this.peng.host;
    this.deathStartY = host.position.y;
    let ground = this.hole.floorY;
    this.deathIntoWater = false;
    if (!this.deathKun) {
      if (this.hole.found && this.hole.distance(this.position) < this.hole.radius - 0.5) {
        ground = this.hole.waterY;
        this.deathIntoWater = true;
      } else {
        const g = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5, 0);
        if (Number.isFinite(g)) ground = Math.max(this.hole.floorY, g);
      }
    }
    this.deathGround = ground;
    this.deathDrop = Math.max(0, this.position.y + this.deathStartY - ground);
    // Unity KunPengDeath.Begin：顿帧 / ActScale 复位；鹏有 death 状态就从这一刻播 death（PlayDeath），否则交叉淡入 roar
    const c = (this.deathKun ? this.kun : this.peng).clips;
    this.deathKeyframed = !this.deathKun && !!c?.ready && c.has('death');
    if (this.deathKeyframed) c!.play('death', 0.08);
    else if (c?.ready && c.has('roar')) c.play('roar', 0.15);
  }

  /** death 片段的事件（Unity KunPengDeath.OnAnimEvent）：翼折、乱扑掉羽、触地、最后一声 */
  private deathEvent(evt: string): void {
    switch (evt) {
      case 'wingBreak': this.wingBreak(); break;
      case 'flail': this.featherShed(this.boneWorld('wing_R_2', _v), 10); break;
      case 'land': this.pengLand('事件 land'); break;
      case 'lastCry': this.lastCry(); break;
    }
  }

  /** 鹏的骨骼世界位置（找不到骨骼时用胸口锚点） */
  private boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.peng.pose.bone(name);
    return b ? b.getWorldPosition(out) : this.peng.pts.chest.getWorldPosition(out);
  }

  /** 雪羽：从某点洒一小撮白羽 + 冰屑（特效正式件随 M11b） */
  private featherShed(p: THREE.Vector3, n: number): void {
    this.ctx.fx.burst(p, 0xf4fbff, n, 4, 1.2, 0.3, -2);
    this.ctx.fx.burst(p, ICE, Math.max(2, n >> 1), 3, 0.7, 0.25, 4);
  }

  /** 翼折（death 片段第 12 帧）：左翼中段一声脆响、炸开一团雪羽 */
  private wingBreak(): void {
    if (this.deathBroke) return;
    this.deathBroke = true;
    const w = this.boneWorld('wing_L_2', _w);
    this.featherShed(w, 24);
    this.ctx.fx.ring(w, 2.2, 0xf4fbff, 0.4);
    this.ctx.audio.play('shield_break', { position: w, volume: 0.9, pitch: 0.75 });
  }

  /** 最后一声（触地之后抬头朝北冥）：鲛珠一亮、长啸 */
  private lastCry(): void {
    if (this.deathCried || !this.deathLanded) return;
    this.deathCried = true;
    const head = this.boneWorld('pearl', _w);
    this.ctx.fx.burst(head, 0xfff4c8, 14, 3, 0.8, 0.3, 0);
    this.ctx.fx.ring(head, 3, KunPengDef.Gust, 0.6);
    this.ctx.audio.play('boss_roar', { position: head, volume: 0.45, pitch: 1.45 });
  }

  /** 鹏触地：碎冰、冰环、震屏、闷响（坠进北冥是水花、水环、闷响） */
  private pengLand(source: string): void {
    if (this.deathLanded) return;
    this.deathLanded = true;
    this.deathLandedAt = this.deathTime;
    this.deathLandSource = source;
    const g = this.deathKeyframed ? this.boneWorld('chest', _v) : this.peng.pts.chest.getWorldPosition(_v);
    g.y = this.deathGround;
    if (this.deathIntoWater) {
      const fx = this.ctx.fx;
      fx.burst(_w.copy(g).setY(g.y + 0.4), 0xeefcff, 40, 9, 1.1, 0.4, 10);
      for (let i = 0; i < 4; i++) fx.burst(_w.set(g.x, g.y + 1.2 * i, g.z), 0xeefcff, 10, 3, 0.8, 0.32, 7);
      fx.ring(_w.copy(g).setY(g.y + 0.05), 7, 0xeefcff, 1.2);
      const d = g.distanceTo(this.ctx.player.position);
      const k = 0.6 * Math.max(0, 1 - d / 70);
      if (k > 0.01) fx.shake(k, 0.5);
      this.ctx.audio.play('boss_slam', { position: g, volume: 1, pitch: 0.7 });
    } else this.impact(g, 1);
  }

  /** 倒下的模型动画（t 0 → 1；第 88% 时框架炸开、模型隐去） */
  protected override animateDeath(t: number): void {
    const dt = this.ctx.time.dt;
    if (this.deathKun) {
      // 鲲仰头长啸后沉回冰窟，没顶时水面炸起水冠、大涟漪
      this.sunk = easeInOut(span(t, 0.25, KunPengDeath.SunkAt));
      this.anim = 'roar';
      this.animateKun(dt);
      if (!this.deathLanded && t >= KunPengDeath.SunkAt) {
        this.deathLanded = true;
        this.deathLandedAt = this.deathTime;
        this.deathLandSource = '按时间';
        const w = _v.set(this.hole.center.x, this.hole.waterY, this.hole.center.z);
        this.impact(w, 1.6);
        this.ctx.fx.ring(w, Math.max(8, this.hole.radius * 0.8), 0xeefcff, 1.6);
      }
    } else if (this.deathKeyframed) {
      // 手 K death 片段（Unity KunPengDeath 的 Keyframed 分支）：失衡那一下还在原地，0.2 s 起加速往下掉，2.4 s 正好落到地面（= 片段的 land）；
      // 坠进北冥的之后再沉下去。逻辑位置钉住，只动宿主
      const s = this.deathTime;
      const u = span(s, KunPengDeath.FallFrom, KunPengDeath.LandTime);
      let y = this.deathStartY - this.deathDrop * u * u;
      if (this.deathIntoWater) y -= KunPengDeath.SinkDepth * easeInOut(span(s, KunPengDeath.LandTime + 0.4, this.deathDuration * 0.88));
      const host = this.peng.host;
      host.position.y = y;
      host.rotation.set(0, 0, 0);
      this.peng.clips?.update(dt);
      // 片段事件没来（掉帧跳过）时按时间兜底
      if (!this.deathBroke && s >= KunPengDeath.BreakTime + 0.1) this.wingBreak();
      if (!this.deathLanded && s >= KunPengDeath.LandTime + 0.05) this.pengLand('按时间兜底');
      if (!this.deathCried && s >= KunPengDeath.CryTime + 0.1) this.lastCry();
      // 翼折之后一路掉雪羽
      if (this.deathBroke && !this.deathLanded && Math.random() < dt / 0.06) this.featherShed(this.boneWorld('wing_L_2', _v), 3);
    } else {
      // 鹏收翼坠落（模型动画：逻辑位置钉住），55% 砸到冰面，之后趴着头一抬一落地抽两下
      const f = span(t, 0, KunPengDeath.LandAt);
      const host = this.peng.host;
      host.position.y = this.deathStartY - this.deathDrop * f * f;
      const twitch = this.deathLanded ? Math.sin((t - KunPengDeath.LandAt) * 22) * 4 * DEG * (1 - span(t, KunPengDeath.LandAt, 0.85)) : 0;
      host.rotation.x = 0.3 + Math.min(t, KunPengDeath.LandAt) / KunPengDeath.LandAt + twitch;
      host.rotation.z = Math.sin(t * 9) * 0.2 * (1 - f);
      const P = this.peng.pose;
      P.reset();
      for (const [side, s] of [['L', 1], ['R', -1]] as const) {
        P.rotate(`wing_${side}_1`, AZ, s * 0.25 * f);
        P.rotate(`wing_${side}_low`, AZ, s * 0.2 * f);
      }
      P.rotate('head', AX, 0.25 * f);
      if (!this.deathLanded && t >= KunPengDeath.LandAt) this.pengLand('按时间');
    }
    const f = this.isKun ? this.kun : this.peng;
    if (f.native?.glowShell) f.native.glowShell.opacity = 0.6 * Math.max(0, 1 - t);
    this.setRoleOpacity('pearlHalo', 0.4 * Math.max(0, 1 - t));
    if (t >= 0.88) {
      this.model.visible = false;
      if (!this.deathLingered) {
        // 炸开之后的余韵：落点一片冻雾 + 霜斑
        this.deathLingered = true;
        const g = this.deathKun ? _v.copy(this.hole.center) : _v.set(this.position.x, this.hole.floorY, this.position.z);
        this.ctx.fx.burst(g.setY(g.y + 0.6), 0xeaf8ff, 40, 3, 2.4, 0.9, -0.5);
        this.ctx.fx.ring(g, 7, ICE, 2);
      }
    }
  }

  /** 鹏砸上冰面 / 鲲没顶：碎冰、冰环、震屏、闷响 */
  private impact(ground: THREE.Vector3, k: number): void {
    const fx = this.ctx.fx;
    fx.explosion(_w.copy(ground).setY(ground.y + 0.5), 2.2 * k, ICE);
    fx.burst(_w, ICE, Math.round(30 * k), 9, 1.0, 0.4, 12);
    fx.ring(_w.copy(ground).setY(ground.y + 0.1), 6 * k, ICE, 0.8);
    fx.ring(_w, 4.5 * k, WARN, 0.6);
    const d = ground.distanceTo(this.ctx.player.position);
    const s = 0.7 * Math.max(0, 1 - d / 70);
    if (s > 0.01) fx.shake(s, 0.6);
    this.ctx.audio.play('boss_slam', { position: ground, volume: 1, pitch: 0.8 });
  }

  protected override onReleased(): void {
    this.fx?.dispose();
    this.fx = null;
    for (const f of [this.kun, this.peng]) {
      if (!f) continue;
      f.native?.dispose();
      f.native = null;
      f.clips?.dispose();
      f.clips = null;
    }
    this.director?.abort('首领释放');
    if (devHook?.boss === this) devHook = null;
  }

  // ───────────── 动画 ─────────────

  protected override animate(dt: number): void {
    if (this.isKun) this.animateKun(dt);
    else this.animatePeng(dt);
    this.updatePearl();
  }

  private updatePearl(): void {
    const f = this.isKun ? this.kun : this.peng;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 5);
    const k = this.pearlGlow;
    if (f.native?.glowShell) f.native.glowShell.opacity = (0.15 + 0.55 * k) * (0.75 + 0.25 * pulse);
    this.setRoleOpacity('pearlHalo', (0.2 + 0.5 * k) * (0.7 + 0.3 * pulse));
  }

  /**
   * 鲲的骨骼动画（creature_rigs/SK_Boss_Kun.json，角度不超过注册表 SK_Boss_Kun.rom）。模型空间：X = 生物左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾。
   * 整个露出水面的身体绕水线（模型原点）俯仰 / 升降——切口在水下；按 cutCeiling 把切口压在水面下 0.3 m（前倾 / 后仰 / 抬身时整只往下沉）。
   * 俯仰 / 抬身照 Unity KunPengBrain.ProcKunPose 的状态表：猛砸的出手段前倾 0.42、吞吸的收招段（扑咬）前倾 0.35。
   */
  private animateKun(dt: number): void {
    const kc = this.kun.clips;
    if (kc?.ready) {
      // 片段驱动（Unity LateUpdate 的 baked 分支）：片段以完全沉下去的位置为参照，根骨骼把身体抬到 KunBaseY（± 俯仰抬身），宿主只叠加沉浮
      const host = this.kun.host;
      host.rotation.set(0, 0, 0);
      const waterRel = this.hole.waterY - this.position.y;
      const drop = (KUN_SUNK_Y - KUN_BASE_Y) * this.sunk;
      host.position.y = KUN_SUNK_Y + drop + (waterRel - KunPengDef.TsWaterLevel);
      kc.update(dt, this.holdDt(dt));
      // 平切口中心离水面多高（程序化那条路量的是一圈最高点；片段的俯仰烘在骨骼里，这里只量中心）
      const rb = this.kun.pose.bone('root');
      if (rb) {
        host.updateWorldMatrix(true, true);
        this.cutTop = rb.getWorldPosition(_w).y - this.hole.waterY;
      }
      return;
    }
    const a = this.anim;
    const t = this.animT;
    const m = this.currentMove;
    let rear = 0, wind = 0, slam = 0, roar = 0, flare = 0.1;
    let pitch = 0, rise = 0, lam = 6;
    if (a === 'inhale') { rear = 1; flare = 0.8; pitch = -0.12; lam = 5; }
    else if (a === 'bite') { slam = 0.55; pitch = 0.35; rise = -0.4; lam = 16; }
    else if (a === 'slamWind') { wind = 1; flare = 1; pitch = -0.25; rise = 1.6; lam = 4; }
    else if (a === 'slam') { slam = 1; pitch = 0.42; rise = -0.6; lam = t < 0.2 ? 20 : 6; }
    else if (a === 'spit') { rear = t < 0.6 ? 0.8 : 0; slam = t >= 0.6 && t < 1.0 ? 0.4 : 0; pitch = t < 0.6 ? -0.1 : 0.12; lam = 9; }
    else if (a === 'roar' || a === 'rise') { roar = 1; flare = 1; pitch = -0.08; lam = 6; }
    else if (a === 'erupt') { roar = 0.7; flare = 1; rise = 1.2 * Math.max(0, 1 - t * 1.5); lam = 8; }
    else if (a === 'sink') { roar = 0.4; }
    if (m?.id === 'slam' && m.stage === 'active') { pitch = 0.42; rise = -0.6; lam = 20; }
    const k = 1 - Math.exp(-lam * dt);
    this.pRear = mix(this.pRear, rear, k);
    this.pWind = mix(this.pWind, wind, k);
    this.pSlam = mix(this.pSlam, slam, k);
    this.pRoar = mix(this.pRoar, roar, k);
    this.pFlare = mix(this.pFlare, flare, k);
    this.pPitch = mix(this.pPitch, pitch, k);
    this.kRise = mix(this.kRise, rise, k);
    const look = Math.atan2(Math.sin(this.yawToPlayerDeg * DEG - this.facing), Math.cos(this.yawToPlayerDeg * DEG - this.facing));
    this.pLook = mix(this.pLook, clamp(look, -0.8, 0.8), 1 - Math.exp(-4 * dt));

    const host = this.kun.host;
    host.rotation.x = this.pPitch + Math.sin(this.age * 0.7) * 0.02;
    host.rotation.z = Math.sin(this.age * 0.45) * 0.03;
    // 平切口压在水面下：水面相对逻辑位置（环台地面）的高度 + 按俯仰 / 侧倾算出的上限；沉浮整体往下叠
    const waterRel = this.hole.waterY - this.position.y;
    const drop = (KUN_SUNK_Y - KUN_BASE_Y) * this.sunk;
    const cc = KunPengMath.cutCeiling(host.rotation.x, host.rotation.z, KUN_SCALE);
    host.position.y = Math.min(KUN_BASE_Y + this.kRise + drop, waterRel + cc + drop);
    // 切口一圈最高点（相对水面）：原点 + 俯仰 / 侧倾翘起的高度（= −cutCeiling − 边距）
    this.cutTop = this.position.y + host.position.y + (-cc - KunPengDef.CutMargin) - this.hole.waterY;

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
   * 鹏的骨骼动画（creature_rigs/SK_Boss_Peng.json）。扇翼：上半扇绕前后轴向外下压，下压时下半扇向外上张开；
   * 飞行时整只鸟绕双爪前倾、双爪收向身后；俯冲收翼伸爪；歇翼时直立。
   */
  private animatePeng(dt: number): void {
    const pc = this.peng.clips;
    if (pc?.ready) {
      // 片段驱动：俯仰烘在根骨骼的旋转里（Unity：正式美术 mr.localRotation = identity），宿主只管从雾里升起
      this.peng.host.position.y = this.riseOffset;
      this.peng.host.rotation.set(0, 0, 0);
      pc.update(dt, this.holdDt(dt));
      return;
    }
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
    if (this.transitioning) { flap = 1.3; rate = 1.8; pitch = 0.05; tuck = 0.6; }
    const k = 1 - Math.exp(-lam * dt);
    this.pDive = mix(this.pDive, dive, k);
    this.pPerch = mix(this.pPerch, perch, k);
    this.pTuck = mix(this.pTuck, tuck, k);
    this.pFlap = mix(this.pFlap, flap, k);
    this.pPitch = mix(this.pPitch, pitch, k);
    this.flapPhase += dt * rate * TAU;
    const look = Math.atan2(Math.sin(this.yawToPlayerDeg * DEG - this.facing), Math.cos(this.yawToPlayerDeg * DEG - this.facing));
    this.pLook = mix(this.pLook, clamp(look, -1, 1), 1 - Math.exp(-4 * dt));

    const host = this.peng.host;
    host.position.y = this.riseOffset;
    host.rotation.x = this.pPitch + (a === 'crash' ? Math.sin(this.age * 7) * 0.08 : 0);
    host.rotation.z = a === 'crash' ? Math.sin(this.age * 5) * 0.1 : Math.sin(this.age * 0.9) * 0.04;

    const P = this.peng.pose;
    P.reset();
    const fl = this.pFlap, dv = this.pDive, pr = this.pPerch, tk = this.pTuck;
    const ph = this.flapPhase;
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
}

/** 调试：当前形态的片段状态（没有片段 / 还没读好为 null） */
function kunPengClipState(b: KunPeng): { state: string | null; ready: boolean } | null {
  const c = (b as unknown as { formClips: ClipPlayer | null }).formClips;
  return c ? { state: c.state, ready: c.ready } : null;
}

/** 测试与检视用：当前形态与场地（只读） */
export function kunPengDebug(b: KunPeng): { form: FormId; hole: IceHoleInfo; submerged: boolean } {
  return { form: b.isKun ? 'kun' : 'peng', hole: b.hole, submerged: b.submerged };
}

// ───────────────────────────── 开发钩子（?dev，只在开发服务器里） ─────────────────────────────

interface DevHook {
  boss: KunPeng;
}

let devHook: DevHook | null = null;

function devHookEnabled(): boolean {
  return !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
}

function installDevHook(boss: KunPeng): void {
  devHook = { boss };
  (window as unknown as Record<string, unknown>).__kunpeng = {
    get boss() { return boss; },
    skipIntro: () => boss.director?.requestSkip(true) ?? false,
    /** 把生命层打到某个比例（门槛照常起作用：每次只越一道线） */
    setHealth: (fraction: number) => {
      boss.shield = 0;
      boss.hp = Math.max(1, boss.maxHp * fraction);
    },
    forceMove: (id: string) => boss.forceMove(id),
    state: () => ({
      pos: boss.position.toArray().map(v => +v.toFixed(2)), cam: boss.ctx.camera.position.toArray().map(v => +v.toFixed(2)),
      form: boss.isKun ? 'kun' : 'peng', phase: boss.phase, introDone: boss.introDone, transitioning: boss.transitioning,
      move: boss.currentMove?.id ?? null, stage: boss.currentMove?.stage ?? null, hp: Math.round(boss.hp), maxHp: boss.maxHp,
      shield: Math.round(boss.shield), maxShield: boss.maxShield, sunk: +boss.sunk.toFixed(2), submerged: boss.submerged, theta: +boss.theta.toFixed(1),
      hoverAlt: boss.hoverAlt, enraged: boss.enraged, kunFury: boss.kunFury, staggered: boss.staggered, untargetable: boss.untargetable,
      hole: { source: boss.holeSource, c: boss.hole.center.toArray().map(v => +v.toFixed(2)), r: +boss.hole.radius.toFixed(2), outer: +boss.hole.outer.toFixed(2), waterY: +boss.hole.waterY.toFixed(2) },
      director: boss.director ? { stage: boss.director.stage, shot: boss.director.shotName, t: boss.director.t, released: boss.director.released } : null,
      act: boss.lastAct, movesStarted: boss.movesStarted, telegraphs: boss.telegraphs, color: hexColor(boss.kdef.color),
      clip: kunPengClipState(boss), impactHolds: boss.impactHolds, deathLanded: boss.deathLandedAt, deathLandSource: boss.deathLandSource,
    }),
  };
}
