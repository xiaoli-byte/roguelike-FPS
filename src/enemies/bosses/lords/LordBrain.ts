/**
 * 4-1 三领主的行为底座（Unity Bosses/Lords/LordBrain.cs；网页旧版 src/world/plateau/play/boss.ts）：
 *   · 领主梯度：BossBrain 生成时已按 framework/LordScaling 乘过血量、招式间喘息；收招段由 LordMove 乘 recoverScale（梯度 × 阶段节奏）；
 *     第三个打的领主 variant = 每阶段多一招变体（各领主自己接）。
 *   · 转阶段只出横幅（phaseCinematic = false），转阶段时撤掉场上的危险物（Unity 还撤落雷：落雷随 M7，经 KuiStorm 适配层）。
 *   · 破防条：满了 BossBrain 硬直，这里转给 onLordBreak（放开弱点、场地反应）。
 *   · 倒下：不要通用溃散的连环爆炸，放领主自己的死亡演出（LordCinema：代码驱动机位绕一圈、名字卡、落回第一人称），
 *     演出期间每帧回调 deathTick（网页由首领自己在倒下后的 update 里驱动，物体在 defeat.seconds 后回收）。
 *   · 动作：Unity Animator → src/anim 的 CreatureAnimator（public/assets/anim/<资产>.json 的采样 / 手 K 片段 + AC_ 控制器）；
 *     片段事件（hit / release / land / beat / glint）经 emitAnimEvent 交给招式的 cue；impactHold 只顿首领自己（动画 ×0.05，之后 ×1.6 追回）。
 *   · 模型：清单把 SK_Boss_<名> 绑在 boss_<名> 上（BossBase.init 的 attachEnemyArt 挂原生骨架）；受击区挂骨骼（LordDef.hitZones + 形态的弱点骨）。
 *   · 位移：招式驱动位置时（冲撞、侧跃、跳、游）走 beginDash / drive：EnemyBase 的重力 / 碰撞积分照跑，之后把位置钉回招式要的点（Unity BeginDash 关掉导航代理）。
 * 与 Unity 的差异：命中区只分弱点 / 身体（头部 ×1.5 这类部位倍率没有）；BlowPlayer 用 CollisionWorld.moveBody 推玩家脚底（同 Unity 扫掠的 CharacterController.Move）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../../core/types';
import { buildClips, ensureSockets, type CreatureAnimData } from '../../../anim/AnimData';
import { loadCreatureAnimData } from '../../../anim/AnimData';
import { AnimatorStateMachine } from '../../../anim/AnimatorStateMachine';
import { buildDefaultController } from '../../../anim/AnimData';
import { CreatureLocomotion } from '../../../anim/CreatureLocomotion';
import type { HitShape } from '../BossBase';
import { BossBrain, hexColor } from '../framework/BossBrain';
import type { BossMove } from '../framework/BossMove';
import type { BossPhaseDef } from '../framework/BossDef';
import { BossIntroDirector, introEnabled, type DirectedBoss } from '../intro/BossIntroDirector';
import type { BossIntroScript } from '../intro/BossIntroScript';
import { playLordDeath } from './LordCinema';
import type { LordDef } from './LordDef';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _delta = new THREE.Vector3();

/** 片段缺失时的替身（Unity 的镜像片段 sidestepL / wheelR、夔倒回残鼓的 sink 网页没有导出） */
const CLIP_FALLBACK: Readonly<Record<string, string>> = { sidestepL: 'sidestep', wheelR: 'wheel', sink: 'kneel' };

const animCache = new Map<string, Promise<CreatureAnimData>>();

/** 动画数据（每个资产只读一次） */
export function lordAnimData(asset: string): Promise<CreatureAnimData> {
  let p = animCache.get(asset);
  if (!p) {
    p = loadCreatureAnimData(asset);
    p.catch(() => animCache.delete(asset));
    animCache.set(asset, p);
  }
  return p;
}

/** 场景文档里的首领场（StageDirector 的 Unity 场景文档；只读需要的字段） */
interface SceneBossDoc {
  id: string;
  position: number[];
  center: number[];
  floorY: number;
  radius: number;
}

/** 片段播放器：原生骨架上的状态机 + 根节点移动 → Speed（Unity Animator + CreatureLocomotion） */
class LordAnimator {
  readonly animator: AnimatorStateMachine;
  readonly locomotion: CreatureLocomotion;
  readonly clips: Map<string, THREE.AnimationClip>;

  constructor(data: CreatureAnimData, model: THREE.Object3D, root: THREE.Object3D, onEvent: (name: string) => void) {
    ensureSockets(model, data);
    this.clips = buildClips(data);
    this.animator = new AnimatorStateMachine(model, data.controller ?? buildDefaultController(data), this.clips);
    this.animator.onEvent = (e) => onEvent(e.name);
    this.locomotion = new CreatureLocomotion(root, this.animator, null, data.moveSpeed);
  }

  has(state: string): boolean {
    return this.animator.hasState(state);
  }

  /** EnemyAI.PlayTimed：把片段拉伸到 seconds 正好播完（ActScale = 片段长 / seconds，钳在 0.4–2.5） */
  play(state: string, seconds: number, fade: number): void {
    const len = this.animator.clipLength(state);
    if (this.animator.hasParameter('ActScale')) {
      this.animator.setFloat('ActScale', len > 0 && seconds > 0.05 ? THREE.MathUtils.clamp(len / seconds, 0.4, 2.5) : 1);
    }
    this.animator.crossFadeInFixedTime(state, fade);
  }

  update(dt: number, animDt: number): void {
    this.locomotion.tick(dt);
    this.animator.update(animDt);
  }

  dispose(): void {
    this.animator.dispose();
  }
}

export abstract class LordBrain extends BossBrain implements DirectedBoss {
  readonly ldef: LordDef;
  /** 登场演出（introEnabled 时） */
  director: BossIntroDirector | null = null;
  /** StageDirector 读：登场演出自己打名字卡，不再打横幅 */
  introDirected = false;
  readonly introOffset = new THREE.Vector3();
  /** 死亡演出（倒下后才有） */
  deathCinema: BossIntroDirector | null = null;
  /** 破防过几次 */
  breaks = 0;
  /** 最近播的片段（测试 / 调试） */
  lastAct: string | null = null;
  actsPlayed = 0;
  /** 原生骨架挂上了（false = 程序化占位体） */
  hasNative = false;
  /** 招式驱动位置中（Unity BeginDash） */
  dashing = false;

  protected clipPlayer: LordAnimator | null = null;
  protected native: THREE.Object3D | null = null;
  protected readonly bones = new Map<string, THREE.Object3D>();
  private readonly drivePos = new THREE.Vector3();
  private readonly tellAt = new Map<string, number>();
  private weakShape: HitShape | null = null;
  private weakRadius = 0.5;
  private weakOn = true;
  private pendingAct: { state: string; seconds: number; fade: number } | null = null;
  private holdLeft = 0;
  private holdRecover = 0;
  private deathT = 0;
  private deathStarted = false;
  private placeholder: THREE.Object3D | null = null;

  constructor(ctx: GameContext, enemyDef: EnemyDef, def: LordDef, opts: SpawnOptions) {
    super(ctx, enemyDef, def, opts);
    this.ldef = def;
    this.deathBursts = false;
    this.fitArena(opts.position);
    if (def.prefab) void lordAnimData(def.prefab).catch(err => console.warn(`[Lord] ${def.prefab} 动画数据读不到`, err));
  }

  /** 场地：场景文档里离出生点最近的同 id 首领场（中心、地面高、半径） */
  private fitArena(spawn: THREE.Vector3): void {
    this.arenaRadius = 34;
    let doc: { bosses?: SceneBossDoc[] } | null = null;
    try {
      doc = (this.ctx.stage as unknown as { unityDocument?: { bosses?: SceneBossDoc[] } | null }).unityDocument ?? null;
    } catch {
      doc = null;
    }
    const entry = doc?.bosses?.filter(b => b.id === this.ldef.id)
      .sort((a, b) => Math.hypot(a.position[0] - spawn.x, a.position[2] - spawn.z) - Math.hypot(b.position[0] - spawn.x, b.position[2] - spawn.z))[0];
    if (!entry || Math.hypot(entry.position[0] - spawn.x, entry.position[2] - spawn.z) > 12) return;
    this.bossCenter.set(entry.center[0], entry.floorY, entry.center[2]);
    this.arenaRadius = Math.max(entry.radius, Math.hypot(spawn.x - entry.center[0], spawn.z - entry.center[2]) + 4);
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    const d = this.ldef;
    const root = new THREE.Group();
    // 占位体（清单里没有正式模型时）：一个和定义同高的胶囊；正式模型挂上时 attachNativeBody 会把它藏起来
    const mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(d.radius, Math.max(0.1, d.height - d.radius * 2), 6, 12), mat);
    body.position.y = d.height / 2;
    root.add(body);
    this.placeholder = body;
    // 受击区先挂在占位体上（按身高比例），onModelReady 换到骨骼
    const shapes: HitShape[] = [];
    for (const z of d.hitZones) {
      const a = new THREE.Object3D();
      a.position.y = d.height * (z.id === 'head' ? 0.85 : z.id === 'hips' ? 0.35 : 0.6);
      root.add(a);
      shapes.push({ anchor: a, radius: z.radius, halfHeight: 0, weak: false });
    }
    const form = d.firstForm;
    const weak = new THREE.Object3D();
    weak.position.y = d.height * 0.7;
    root.add(weak);
    this.weakRadius = form?.weakRadius ?? 0.5;
    this.weakShape = { anchor: weak, radius: this.weakRadius, halfHeight: 0, weak: true };
    shapes.unshift(this.weakShape);
    this.hitShapes = shapes;
    this.weakAnchor = weak;
    return root;
  }

  protected override onModelReady(): void {
    const host = this.model.children[0];
    const native = host?.children.find(c => c !== this.placeholder && hasSkin(c)) ?? null;
    if (native) {
      this.native = native;
      this.hasNative = true;
      native.traverse((o) => {
        if (o.name && !this.bones.has(o.name)) this.bones.set(o.name, o);
      });
      const zones = this.ldef.hitZones;
      for (let i = 0; i < zones.length; i++) {
        const b = this.bones.get(zones[i].bone);
        if (b) this.hitShapes[i + 1].anchor = b;
      }
      const wb = this.ldef.firstForm?.weakBone ? this.bones.get(this.ldef.firstForm.weakBone) : null;
      if (wb && this.weakShape) {
        this.weakShape.anchor = wb;
        this.weakAnchor = wb;
      }
      if (this.ldef.prefab) {
        lordAnimData(this.ldef.prefab).then((data) => {
          if (!this.native || this.removed) return;
          try {
            this.clipPlayer = new LordAnimator(data, this.native, this.root, (evt) => this.emitAnimEvent(evt));
            const p = this.pendingAct;
            this.pendingAct = null;
            if (p) this.playActFade(p.state, p.seconds, p.fade);
          } catch (err) {
            console.error(`[Lord] ${this.ldef.id} 片段没接上`, err);
          }
        }).catch(() => { /* 没有片段：模型停在绑定姿势 */ });
      }
    }
    this.guardCall('onLordModel', () => this.onLordModel());
    const script = this.introScript();
    if (script && introEnabled() && script.validate().length === 0) {
      this.director = new BossIntroDirector(this.ctx, script, this, this.position.clone());
      this.introHold = this.director;
      this.introDirected = true;
    }
    if (devHookEnabled()) installDevHook(this);
  }

  /** 调试 / 截图用的状态（window.__lord.state()） */
  debugState(): Record<string, unknown> {
    const m = this.currentMove;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      id: this.ldef.id, pos: this.position.toArray().map(r), center: this.bossCenter.toArray().map(r), radius: r(this.arenaRadius),
      phase: this.phase, introDone: this.introDone, transitioning: this.transitioning, staggered: this.staggered, alive: this.alive,
      move: m?.id ?? null, stage: m?.stage ?? null, t: m ? r(m.t) : 0, hp: Math.round(this.hp), maxHp: this.maxHp,
      act: this.lastAct, acts: this.actsPlayed, native: this.hasNative, clips: !!this.clipPlayer, dashing: this.dashing,
      weak: this.weakPointActive, breaks: this.breaks, bar: this.breakBar ? r(this.breakBar.fill) : null, lord: this.lord.index,
      recoverScale: r(this.recoverScale), moves: this.movesStarted, telegraphs: this.telegraphs,
      director: this.director ? { stage: this.director.stage, shot: this.director.shotName, t: r(this.director.t), released: this.director.released } : null,
      death: this.deathCinema ? { stage: this.deathCinema.stage, shot: this.deathCinema.shotName, t: r(this.deathCinema.t) } : null,
    };
  }

  /** 首领的登场演出脚本（null = 不放） */
  protected abstract introScript(): BossIntroScript | null;

  /** 模型挂好之后（场地件、程序化附件） */
  protected onLordModel(): void {}

  // ───────────── DirectedBoss ─────────────

  get name(): string {
    return this.ldef.name;
  }

  get title(): string | null {
    return this.ldef.title;
  }

  introOverlay(_color: number, _amount: number): void {}

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const c = this.bones.get('chest') ?? this.bones.get('spine2') ?? this.bones.get('spine');
    if (c) return c.getWorldPosition(out);
    return out.set(this.position.x, this.position.y + this.height * 0.55, this.position.z);
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    const h = this.bones.get('head');
    return h ? h.getWorldPosition(out) : out.set(this.position.x, this.position.y + this.height * 0.85, this.position.z);
  }

  // ───────────── 片段 ─────────────

  override playAct(state: string, seconds: number): void {
    this.playActFade(state, seconds, 0.08);
  }

  playActFade(state: string, seconds: number, fade = 0.08): void {
    if (!state) return;
    this.lastAct = state;
    this.actsPlayed++;
    const a = this.clipPlayer;
    if (!a) {
      this.pendingAct = { state, seconds, fade };
      return;
    }
    const s = a.has(state) ? state : CLIP_FALLBACK[state] && a.has(CLIP_FALLBACK[state]) ? CLIP_FALLBACK[state] : null;
    if (!s) return;
    a.play(s, seconds, fade);
  }

  /** 片段时长（没有片段为 0） */
  clipLength(state: string): number {
    return this.clipPlayer?.animator.clipLength(state) ?? 0;
  }

  /** 顿帧：只顿首领自己（动画 ×0.05 停 seconds 秒，再 ×1.6 把停掉的 0.95 × seconds 追回来）；全局时间不动 */
  impactHold(seconds: number): void {
    if (!(seconds > 0)) return;
    this.holdLeft = Math.max(this.holdLeft, seconds);
    this.holdRecover = seconds * 0.95 / 0.6;
  }

  private animDt(dt: number): number {
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      return dt * 0.05;
    }
    if (this.holdRecover > 0) {
      this.holdRecover -= dt;
      return dt * 1.6;
    }
    return dt;
  }

  // ───────────── 每帧 ─────────────

  override update(dt: number): void {
    const driven = this.dashing && this.alive;
    if (driven) this.drivePos.copy(this.position);
    super.update(dt);
    if (driven && this.dashing) {
      // EnemyBase 的重力 / 碰撞积分照跑过了：钉回招式要的点
      this.position.copy(this.drivePos);
      this.velocity.set(0, 0, 0);
    }
    if (this.clipPlayer) {
      try {
        this.clipPlayer.update(dt, this.animDt(dt));
      } catch (err) {
        console.error(`[Lord] ${this.ldef.id} 动画更新出错`, err);
        this.clipPlayer = null;
      }
    }
    if (!this.alive && this.deathStarted) {
      this.deathT += dt;
      this.guardCall('deathTick', () => this.deathTick(this.deathT, dt));
    }
  }

  /** 招式里改了位置：记下来（update 结束时钉回） */
  drive(p: THREE.Vector3): void {
    this.position.copy(p);
    this.drivePos.copy(p);
  }

  beginDash(): void {
    this.dashing = true;
    this.velocity.set(0, 0, 0);
    this.stopMoving();
  }

  endDash(): void {
    this.dashing = false;
    this.velocity.set(0, 0, 0);
  }

  // ───────────── 领主节奏 ─────────────

  /** 阶段节奏：二阶段 × 0.9、三阶段 × 0.75（网页版 tempo） */
  get phaseTempo(): number {
    return this.ldef.phaseTempo(this.phase);
  }

  /** 收招段的倍率 = 领主梯度 × 阶段节奏 */
  get recoverScale(): number {
    return this.lord.recoveryMult * this.phaseTempo;
  }

  /** 第三个打的领主：每阶段多一招变体 */
  get variant(): boolean {
    return this.lord.extraVariant;
  }

  /** 网页数值 → Unity 的耐久比例（破防条、机关对领主的伤害） */
  get webScale(): number {
    return this.ldef.webScale;
  }

  get facingDeg(): number {
    return this.facing / DEG;
  }

  set facingDeg(v: number) {
    this.facing = v * DEG;
  }

  // ───────────── 弱点 ─────────────

  /** 弱点开关（飞廉珠碎、化蛇只在张嘴时）：关掉时弱点球收成 0（射线打不到，子弹落到身后的身体上） */
  setWeakPointActive(on: boolean): void {
    if (this.weakOn === on || !this.weakShape) return;
    this.weakOn = on;
    this.weakShape.radius = on ? this.weakRadius : 0;
  }

  get weakPointActive(): boolean {
    return this.weakOn;
  }

  // ───────────── 框架钩子 ─────────────

  protected override onPhase(phase: number): void {
    // 转阶段时清掉场上的预警和投射物（网页版 clearHostile）
    this.hazards.clear();
    this.guardCall('onLordPhase', () => this.onLordPhase(phase));
  }

  protected onLordPhase(_phase: number): void {}

  protected override onBreak(count: number): void {
    this.breaks = count;
    this.guardCall('onLordBreak', () => this.onLordBreak(count));
  }

  protected onLordBreak(_count: number): void {}

  protected override onDefeated(result: DamageResult): void {
    this.hazards.clear();
    this.endDash();
    this.playActFade(this.ldef.deathAnim, 0, 0.15);
    this.guardCall('onLordDefeated', () => this.onLordDefeated(result));
    this.deathT = 0;
    this.deathStarted = true;
    this.deathCinema = playLordDeath(this.ctx, this);
  }

  protected onLordDefeated(_result: DamageResult): void {}

  /** 倒下由片段（deathAnim）+ 各领主的 deathTick 演，不要 EnemyBase 的通用前倒缩小 */
  protected override animateDeath(_t: number): void {}

  /** 死亡演出每帧（t = 倒下后的秒数，游戏时间） */
  deathTick(_t: number, _dt: number): void {}

  protected override onReleased(): void {
    this.clipPlayer?.dispose();
    this.clipPlayer = null;
    this.guardCall('onLordReleased', () => this.onLordReleased());
  }

  protected onLordReleased(): void {}

  // ───────────── 工具 ─────────────

  /** 提示（同一个 key 在 cooldown 秒内只说一次） */
  tell(key: string, text: string, color: number, cooldown = 10, _seconds = 2.6): void {
    if (!text) return;
    const now = this.ctx.time.now;
    const at = this.tellAt.get(key);
    if (at !== undefined && now < at) return;
    this.tellAt.set(key, now + cooldown);
    this.ctx.ui.toast(text, hexColor(color));
  }

  /** 脚下的地面高度（从上方 6 m 往下找世界几何；找不到用自己的高度） */
  groundAt(p: THREE.Vector3): number {
    const y = this.ctx.world.groundHeight(p.x, p.z, p.y + 6, 0);
    return Number.isFinite(y) && y > p.y - 40 ? y : p.y;
  }

  bone(name: string): THREE.Object3D | null {
    return this.bones.get(name) ?? null;
  }

  /** 骨骼的世界位置（找不到用身体中心） */
  bonePos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones.get(name);
    if (b) {
      b.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(b.matrixWorld);
    }
    return this.getBodyCenter(out);
  }

  /** 玩家脚底（死了为 false） */
  playerFeet(out: THREE.Vector3): boolean {
    const p = this.ctx.player;
    if (!p.alive) return false;
    out.copy(p.position);
    return true;
  }

  get playerGrounded(): boolean {
    return this.ctx.player.onGround;
  }

  /** 玩家正在冲刺 / 无敌 */
  get playerDashing(): boolean {
    const p = this.ctx.player;
    return p.isDashing || p.invulnerableTime > 0;
  }

  /** 给玩家一下冲量（击退 / 掀飞） */
  pushPlayer(impulse: THREE.Vector3): void {
    const p = this.ctx.player;
    if (!p.alive) return;
    p.applyImpulse(_a.copy(impulse));
  }

  /** 持续吹着玩家走（狂风猛推、湖水漩涡）：扫掠移动玩家脚底，不进速度；冲刺中不吹 */
  blowPlayer(velocity: THREE.Vector3, dt: number): void {
    const p = this.ctx.player;
    if (!p.alive || !(dt > 0) || p.isDashing) return;
    _delta.set(velocity.x * dt, 0, velocity.z * dt);
    if (_delta.lengthSq() < 1e-10) return;
    this.ctx.world.moveBody(p.position, p.radius, p.height, _delta, p.onGround, 0.45);
  }

  /** 玩家 t 秒后的预判位置（水平） */
  predict(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.ctx.player;
    return out.set(p.position.x + p.velocity.x * t, p.position.y, p.position.z + p.velocity.z * t);
  }

  /** 场地中心（地面高） */
  get arenaCenter3(): THREE.Vector3 {
    return this.bossCenter;
  }

  /** 视线（两点之间没有世界几何挡着） */
  lineClear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    return !this.ctx.world.segmentBlocked(a, b);
  }

  shake(strength: number, seconds = 0.4, range = 60): void {
    this.quake(strength, seconds, range);
  }

  facePlayerDeg(degPerSec: number, dt: number): void {
    this.facePlayer(degPerSec * DEG, dt);
  }

  protected guardCall(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[Lord] ${this.ldef.id} ${what} threw`, err);
    }
  }

  // ───────────── 给子类的钩子（Unity 同名） ─────────────

  protected override onTransitionEnd(phase: BossPhaseDef): void {
    this.guardCall('onLordTransitionEnd', () => this.onLordTransitionEnd(phase));
  }

  protected onLordTransitionEnd(_phase: BossPhaseDef): void {}

  protected override onMoveEnded(_m: BossMove): void {}

  /** 骨骼的朝向前方（世界，水平） */
  boneForward(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones.get(name);
    if (!b) return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    b.getWorldDirection(out);
    out.y = 0;
    return out.lengthSq() > 1e-6 ? out.normalize() : out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  /** 两点水平距离 */
  static flat(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  /** 朝 yaw（度）方向的单位向量 */
  static dir(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(yawDeg * DEG), 0, Math.cos(yawDeg * DEG));
  }

  /** 从 from 指向 to 的 yaw（度） */
  static yawTo(from: THREE.Vector3, to: THREE.Vector3, fallback = 0): number {
    const dx = to.x - from.x, dz = to.z - from.z;
    return dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) / DEG : fallback;
  }

  /** 两个 yaw（度）的差（−180..180） */
  static deltaAngle(a: number, b: number): number {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  static moveTowardsAngle(cur: number, target: number, maxDelta: number): number {
    const d = LordBrain.deltaAngle(cur, target);
    return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
  }

  static smooth(x: number): number {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  }

  /** 一个点在离身体（脚底 + 半高）多远（调试） */
  distTo(p: THREE.Vector3): number {
    _b.copy(this.position);
    return LordBrain.flat(_b, p);
  }
}

function hasSkin(o: THREE.Object3D): boolean {
  let found = false;
  o.traverse((c) => {
    if ((c as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

function devHookEnabled(): boolean {
  return !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
}

/** 开发钩子 window.__lord（只在开发服务器里、网址带 ?dev 时；指向最近生成的领主）：跳演出、跳阶段、强制出招、破防、看状态 */
function installDevHook(boss: LordBrain): void {
  const w = window as unknown as Record<string, unknown>;
  const all = (w.__lords as Record<string, LordBrain> | undefined) ?? {};
  all[boss.ldef.id] = boss;
  w.__lords = all;
  w.__lord = {
    get boss() { return boss; },
    skipIntro: () => boss.director?.requestSkip(true) ?? false,
    /** 把生命层打到某个比例（门槛照常起作用：每次只越一道线） */
    setHealth: (fraction: number) => { boss.hp = Math.max(1, boss.maxHp * fraction); },
    forceMove: (id: string) => boss.forceMove(id),
    breakNow: () => { boss.breakBar?.break(); return boss.breakBar?.breaks ?? 0; },
    kill: () => {
      boss.gateOff = true;
      boss.ctx.combat.damageEnemy(boss, { base: boss.hp * 10 + 1e6, element: 'none', source: 'status', canCrit: false });
      return !boss.alive;
    },
    state: () => boss.debugState(),
  };
}
