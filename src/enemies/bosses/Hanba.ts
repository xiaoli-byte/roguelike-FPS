/**
 * 旱魃（Unity Hanba/HanbaBrain.cs + HanbaCinematics.cs 的网页版；定义 HanbaDef.ts，招式 HanbaMoves.ts，场地 HanbaField.ts，太阳 HanbaSun.ts，登场 HanbaIntro.ts）。
 * 首领框架（framework/BossBrain）之上加这几层：
 *   · 运行时姿态：整体悬浮 hover + 上下起伏（模型抬高，逻辑位置贴地走导航）；动作片段（HanbaAnimator）按招式拉伸、出手跟动画事件；日轮旋转、炽度。
 *   · 日晒（SunExposure）：登场后每 0.1 s 判定一次玩家，光柱 + 日轮直射；日晒灼烧层（HanbaSunburn）由她持有、每帧推进。
 *   · 泉珠弱点：只在招式后摇（收招段 + weakGrace）、硬直和日蚀窗口露出（命中形状的 weak 开关 + 发光壳）；日蚀窗口里打泉珠 × 3。
 *   · 沙魇：召唤物名字前缀「沙魇·」，倒下时散成沙。
 *   · 太阳：露天场地的主光高过 42° 时，现身时压成午后的低太阳（1-4 本来就是 31°，不动）。
 *   · 阶段的场地变化：进二阶段吸干泉水、泉床龟裂、之后喷气；进三阶段日轮升到头顶、太阳推到约 85°。
 *   · 飞天之殇：召出的邪飞天不走召唤上限，由琵琶护体盯着；她倒下时一起崩解。
 *   · 演出：登场长啸（intro 片段 58%）、转阶段名卡 / 慢动作、倒下后的落地 / 日轮坠落 / 泉眼复涌 / 太阳回到午后。
 * 网址带 ?dev 时（只在开发服务器里）挂 window.__hanba 调试钩子（跳演出、跳阶段、强制出招），生产构建里整段不存在。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp } from '../../core/math';
import { BossBrain, hexColor } from './framework/BossBrain';
import { DefeatTimeline } from './framework/DefeatSequence';
import type { BossMove } from './framework/BossMove';
import { summonOptions, type SummonOptions } from './framework/Summons';
import { stageHooks } from './framework/StageHooks';
import { BossIntroDirector, introEnabled, type DirectedBoss } from './intro/BossIntroDirector';
import { HanbaDef } from './HanbaDef';
import { ApsaraWard, HanbaSpring, Phase2Scorch, Phase3SunRise } from './HanbaField';
import * as Fx from './HanbaFx';
import { hanbaIntro } from './HanbaIntro';
import { buildHanba, HanbaAnimator, type HanbaRig } from './HanbaModel';
import { createHanbaMove, type EclipseMove } from './HanbaMoves';
import { HanbaSunDriver, SunExposure, SunRing } from './HanbaSun';

/** 敌人名册里的条目（首领自己的耐久按 HanbaDef 的定档表另算；这里的是难度 1 的参考值） */
export const HANBA_DEF: EnemyDef = {
  id: 'boss_hanba', name: '旱魃 · 赤地之源', hp: 7700 / 1.48, shield: 3850 / 1.48,
  speed: 4.2, radius: 0.9, height: 4.5, damage: 15, coins: [60, 100], essence: 60,
  isBoss: true, headY: 3.25, headRadius: 0.2, knockbackResist: 1, color: 0xffd27a,
};

/** death 片段里的倒地 / 跪落时刻、泉眼复涌、太阳复原（HanbaCinematics） */
const COLLAPSE_AT = 2.0, KNEEL_AT = 3.17, REFILL_AT = 2.4, REFILL_SECONDS = 3, SUN_RESTORE_SECONDS = 5;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Hanba extends BossBrain implements DirectedBoss {
  readonly hdef: HanbaDef;
  rig!: HanbaRig;
  animator!: HanbaAnimator;
  ring!: SunRing;
  exposure!: SunExposure;
  readonly ward: ApsaraWard;
  readonly scorch: Phase2Scorch;
  readonly sunRise: Phase3SunRise;
  director: BossIntroDirector | null = null;
  /** StageDirector 读：登场演出自己打名字卡，不再打横幅 */
  introDirected = false;
  readonly introOffset = new THREE.Vector3();

  weakExposed = false;
  weakWindows = 0;
  eclipseOpen = false;
  eclipseWindows = 0;
  introRoared = false;
  loweredSun = false;
  /** 危险物打中玩家的次数（Unity BossHazards.PlayerHits） */
  playerHits = 0;
  apsarasSummoned = 0;
  wraithsCrumbled = 0;
  impactHolds = 0;
  lastAct: string | null = null;
  private apsara: IEnemy | null = null;
  private readonly wraiths = new Set<IEnemy>();
  private weakGrace = 0;
  private bobT = 0;
  private hoverNow = 0;
  private holdLeft = 0;
  private holdDebt = 0;
  private holdCue: string | null = null;
  private holdCueSeconds = 0;
  private holdCueWait = 0;
  private sinkFrom = 0;
  private glowShell: THREE.MeshBasicMaterial | null = null;
  private readonly bones = new Map<string, THREE.Object3D>();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new HanbaDef();
    super(ctx, HANBA_DEF, def, opts);
    this.hdef = def;
    this.arenaRadius = 44;
    this.ward = new ApsaraWard(this);
    this.scorch = new Phase2Scorch(this);
    this.sunRise = new Phase3SunRise(this);
    // 危险物打中玩家计数（旱风「热浪打中」的扬沙闪屏 / 烤身靠它）
    const hz = this.hazards;
    const hurt = hz.hurt.bind(hz);
    hz.hurt = (base, element, from) => {
      const r = hurt(base, element, from);
      if (r > 0) this.playerHits++;
      return r;
    };
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    this.rig = buildHanba();
    this.animator = new HanbaAnimator(this.rig, (evt) => this.emitAnimEvent(evt));
    this.weakAnchor = this.rig.pearl;
    this.muzzleAnchor = this.rig.ring;
    this.hitShapes = [
      { anchor: this.rig.pearl, radius: 0.2, halfHeight: 0, weak: false },
      { anchor: this.rig.body, radius: 0.68, halfHeight: 1.5, weak: false },
    ];
    return this.rig.root;
  }

  protected override createMove(id: string): BossMove | null {
    return createHanbaMove(this, id);
  }

  /** 美术已挂好：原生骨骼的姿势层、泉珠骨、发光壳、日轮挂件；日轮 / 日晒 / 登场演出 */
  protected override onModelReady(): void {
    const host = this.model.children[0];
    this.animator.bindNative(host);
    host.traverse((o) => {
      if ((o as THREE.Bone).isBone && !this.bones.has(o.name)) this.bones.set(o.name, o);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && /_GlowShell/.test(m.name)) this.glowShell = m.material as THREE.MeshBasicMaterial;
    });
    const core = this.bones.get('socket_core');
    if (core) {
      this.hitShapes[0].anchor = core;
      this.weakAnchor = core;
      this.rig.pearlGlow.visible = false;
    }
    // 正式日轮挂件挂在 sunring 支点上了：程序化日轮收起
    if (this.rig.ring.children.some(c => c !== this.rig.ringProc && c.name.includes('HanbaSunRing'))) this.rig.ringProc.visible = false;
    this.ring = new SunRing(this.ctx, this.rig.ring);
    const d = this.hdef;
    this.exposure = new SunExposure(this, this.ring, () => HanbaSunDriver.find(this.ctx),
      (dmg, from) => {
        if (this.ctx.player.alive) this.ctx.combat.damagePlayer(dmg, 'fire', null, from ? new THREE.Vector3(from.x, from.y, from.z) : null);
      },
      (color, alpha, seconds) => Fx.screenFlash(this.ctx, color, alpha, seconds),
      // M8：玩家有减益组件时日晒层挂在玩家身上（HUD / 其他系统读 player.status）；测试桩没有时照旧由旱魃持有
      (this.ctx.player as unknown as { status?: { sunburn?: import('./HanbaSunburn').SunburnInstance } } | undefined)?.status?.sunburn ?? null);
    this.exposure.shaftGain = d.shaftGain;
    this.exposure.ringGain = d.ringGain;
    this.exposure.ringRange = d.ringRange;
    this.exposure.ringBlazeRange = d.ringBlazeRange;
    this.exposure.waterFactor = d.waterFactor;
    this.exposure.damagePerStack = d.sunDamagePerStack;
    this.summons.onSpawned = (e) => this.tintWraith(e);
    this.setWeak(false, true);
    if (introEnabled() && hanbaIntro.validate().length === 0) {
      this.director = new BossIntroDirector(this.ctx, hanbaIntro, this, this.position.clone());
      this.introHold = this.director;
      this.introDirected = true;
    }
    if (devHookEnabled()) installDevHook(this);
  }

  // ───────────── DirectedBoss ─────────────

  get name(): string {
    return this.hdef.name;
  }

  get title(): string | null {
    return this.hdef.title;
  }

  /** 首领身上叠一层发光（演出里身上的金光褪去） */
  introOverlay(color: number, amount: number): void {
    if (amount > 0.001) this.setEmissive(new THREE.Color(color), amount);
    else this.setEmissive(new THREE.Color(0x000000), 0);
  }

  get barTicks(): readonly number[] {
    return this.hdef.barTicks;
  }

  // ───────────── 每帧 ─────────────

  override update(dt: number): void {
    super.update(dt);
    if (this.waitingForSpawn) return;
    this.tickHold(dt);
    this.animator.update(dt);
    this.hover(dt);
    this.ring.update(dt);
    this.exposure.update(dt);
    this.ward.update(dt);
    if (!this.alive) return;
    this.weakpoint(dt);
    this.trackWraiths();
  }

  /** 悬浮：模型抬到 hover + 起伏 + 动作上浮（倒下后 1.5 s 内落地，由死亡演出接手） */
  private hover(dt: number): void {
    const d = this.hdef;
    this.bobT += dt * d.bobRate * Math.PI * 2;
    if (this.alive) this.hoverNow = d.hover + Math.sin(this.bobT) * d.bob;
    else {
      const k = Math.min(1, this.deathTime / 1.5);
      this.hoverNow = this.sinkFrom + (0 - this.sinkFrom) * k * k;
    }
    this.model.position.set(this.introOffset.x, this.hoverNow + this.animator.lift + this.introOffset.y, this.introOffset.z);
  }

  /** 泉珠：收招段 → 露出（再留 weakGrace 秒）；硬直、日蚀窗口中也露着 */
  private weakpoint(dt: number): void {
    if (this.currentMove && this.currentMove.stage === 'recover') this.weakGrace = this.hdef.weakGrace;
    else this.weakGrace -= dt;
    const open = this.introDone && !this.transitioning && (this.weakGrace > 0 || this.staggered || this.eclipseOpen);
    if (open !== this.weakExposed) this.setWeak(open);
    if (this.glowShell) this.glowShell.opacity = this.weakExposed ? 0.55 + 0.25 * Math.sin(this.ctx.time.now * 8) : 0;
  }

  private setWeak(open: boolean, force = false): void {
    if (!force && open === this.weakExposed) return;
    if (open && !this.weakExposed) this.weakWindows++;
    this.weakExposed = open;
    this.hitShapes[0].weak = open;
    if (!this.bones.has('socket_core')) this.rig.pearlGlow.visible = open;
  }

  private tintWraith(e: IEnemy): void {
    this.wraiths.add(e);
    if (e.def.id !== 'sand_wraith' && !e.displayName.startsWith('沙魇·')) (e as { displayName: string }).displayName = `沙魇·${e.def.name}`;
  }

  private trackWraiths(): void {
    for (const e of this.wraiths) {
      if (e.alive) continue;
      this.wraiths.delete(e);
      this.wraithsCrumbled++;
      this.ctx.fx.burst(_a.copy(e.position).setY(e.position.y + 0.5), HanbaDef.Sand, 22, 4.5, 1.1, 0.35, 4);
    }
  }

  // ───────────── 动作 / 顿帧 ─────────────

  get pace(): number {
    return this.hdef.paceAt(this.phase);
  }

  /** 播一个招式动作并拉伸到 seconds 秒播完 */
  act(state: string, seconds: number): void {
    if (!state) return;
    this.lastAct = state;
    this.animator.play(state, seconds);
  }

  override playAct(state: string, seconds: number): void {
    this.act(state, seconds);
  }

  /** 释放帧的顿帧：只把她自己的动作压到 ×0.05 停 seconds 秒（≤ 0.12），之后 ×1.6 追回 */
  impactHold(seconds: number): void {
    if (!this.alive || !(seconds > 0)) return;
    this.holdLeft = Math.max(this.holdLeft, Math.min(0.12, seconds));
    this.impactHolds++;
  }

  /** 等出手事件 cue 到了再顿帧（最多等 maxWait 秒） */
  impactHoldOn(cue: string, seconds: number, maxWait = 0.12): void {
    if (!this.alive || !(seconds > 0)) return;
    this.holdCue = cue;
    this.holdCueSeconds = seconds;
    this.holdCueWait = maxWait;
  }

  private tickHold(dt: number): void {
    if (this.holdCue !== null && (this.holdCueWait -= dt) <= 0) {
      this.holdCue = null;
      this.impactHold(this.holdCueSeconds);
    }
    const a = this.animator;
    if (!this.alive) {
      this.holdLeft = this.holdDebt = 0;
      a.speed = 1;
      return;
    }
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      this.holdDebt += dt * 0.95;
      a.speed = 0.05;
      return;
    }
    if (this.holdDebt > 0) {
      this.holdDebt -= dt * 0.6;
      a.speed = this.holdDebt > 0 ? 1.6 : 1;
      if (this.holdDebt <= 0) this.holdDebt = 0;
    } else a.speed = 1;
  }

  protected override onAnimEvent(evt: string): void {
    if (evt === 'roar' && !this.introDone) this.introRoar();
    if (this.holdCue !== null && evt === this.holdCue) {
      this.holdCue = null;
      this.impactHold(this.holdCueSeconds);
    }
  }

  // ───────────── 给招式用的挂点 / 工具 ─────────────

  /** 手掌（原生骨骼 hand_R / hand_L；没有时取身体中线前上方） */
  hand(right: boolean, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(right ? 'hand_R' : 'hand_L');
    if (b) return b.getWorldPosition(out);
    const s = right ? -1 : 1;
    this.getBodyCenter(out);
    out.x += Math.sin(this.facing) * 0.8 + Math.cos(this.facing) * 0.6 * s;
    out.z += Math.cos(this.facing) * 0.8 - Math.sin(this.facing) * 0.6 * s;
    out.y += 0.8;
    return out;
  }

  /** 心口的泉珠 */
  pearlPos(out: THREE.Vector3): THREE.Vector3 {
    return (this.weakAnchor ?? this.rig.pearl).getWorldPosition(out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.hoverNow + this.height * 0.5, this.position.z);
  }

  groundY(x: number, z: number, fromY: number): number {
    const y = this.ctx.world.groundHeight(x, z, fromY, 0.1);
    return Number.isFinite(y) && y > fromY - 40 ? y : this.position.y;
  }

  facePlayerRate(rate: number, dt: number): void {
    this.facePlayer(rate, dt);
  }

  quakeAt(p: THREE.Vector3, strength: number, duration: number, range: number): void {
    const d = p.distanceTo(this.ctx.player.position);
    const k = range > 0 ? Math.max(0, 1 - d / range) : 1;
    if (strength * k > 0.01) this.ctx.fx.shake(strength * k, duration);
  }

  summonOptsFor(o: Partial<SummonOptions>): SummonOptions {
    return summonOptions(o);
  }

  override glow(_channel: number, value: number): void {
    // 主前摇发光：泉珠发光壳之外的身体自发光（程序化体用日轮的光晕表现，炽度由招式另调）
    if (this.glowShell && !this.weakExposed) this.glowShell.opacity = Math.max(0, Math.min(0.35, value * 0.35));
  }

  get apsaraAlive(): boolean {
    return !!this.apsara && this.apsara.alive;
  }

  /** 在 at 召出被腐化的邪飞天（不走召唤上限），立刻套上琵琶护体；已有一只活着时只续护体 */
  summonApsara(at: THREE.Vector3): IEnemy | null {
    if (!this.alive) return null;
    if (!this.apsaraAlive) {
      const e = this.ctx.enemies.spawn(this.hdef.apsaraId, { position: at.clone(), level: this.level });
      if (!e) return null;
      this.apsara = e;
      this.apsarasSummoned++;
      (e as { displayName: string }).displayName = this.hdef.apsaraName;
      this.summons.adopt(e);
    }
    this.ward.raise(this.apsara!);
    return this.apsara;
  }

  /** 开日蚀窗口：泉珠露出，打在泉珠上的伤害 × weakMult（在弱点必暴之外） */
  openEclipse(weakMult: number): void {
    if (!this.alive) return;
    if (!this.eclipseOpen) this.eclipseWindows++;
    this.eclipseOpen = true;
    this.weakpointDamageMult = Math.max(1, weakMult);
    this.setWeak(true);
  }

  closeEclipse(): void {
    this.eclipseOpen = false;
    this.weakpointDamageMult = 1;
  }

  get spring(): HanbaSpring | null {
    return this.scorch.spring;
  }

  get currentEclipse(): EclipseMove | null {
    return this.currentMove?.id === 'eclipse' ? this.currentMove as EclipseMove : null;
  }

  // ───────────── 框架钩子 ─────────────

  /** 现身：登场动作、吼声、震屏（框架）+ 露天场地的太阳压成午后低太阳 */
  protected override onPresent(): void {
    super.onPresent();
    this.loweredSun = false;
    const sky = HanbaSunDriver.find(this.ctx);
    if (sky && sky.elevation > this.hdef.lowSunMax + 0.5) {
      sky.driveTo(this.hdef.lowSunElevation, Math.max(0.5, this.hdef.intro.seconds * 0.8));
      this.loweredSun = true;
    }
  }

  protected override introTick(t: number): void {
    // 日轮从暗处慢慢燃起；长啸那一下（intro 片段 70 / 120 帧）震屏、炸亮、短慢动作
    this.ring.setBlaze(0.05 + (this.ring.idleBlaze - 0.05) * t, 0.2 + 0.8 * t);
    if (!this.introRoared && t >= this.hdef.roarAt) this.introRoar();
  }

  /** 登场长啸：震屏、日轮炸亮、脚下一圈沙浪、暖色闪屏、短慢动作（只一次） */
  private introRoar(): void {
    if (this.introRoared) return;
    this.introRoared = true;
    const d = this.hdef;
    this.quake(0.75, 0.7, 80);
    this.ring.flash(1);
    this.ring.setBlaze(1, 3);
    const feet = _a.copy(this.position).setY(this.position.y + 0.1);
    this.ctx.fx.ring(feet, 10, HanbaDef.Sand, 0.8);
    this.ctx.fx.ring(feet, 16, HanbaDef.Sun, 0.7);
    this.ctx.fx.burst(this.getBodyCenter(_b), HanbaDef.Sun, 30, 8, 1, 0.35, 2);
    Fx.screenFlash(this.ctx, 'rgb(255,217,128)', 0.3, 0.5);
    this.slowMo(d.introSlowMo, d.introSlowMoSeconds);
  }

  protected override onIntroEnd(): void {
    if (!this.introRoared) this.introRoar();
    this.ring.idle();
  }

  protected override onPhase(phase: number): void {
    this.closeEclipse();
    if (!this.ring.eclipsed) {
      this.ring.flash(1);
      this.ring.setBlaze(1, 2.5);
    }
    this.ctx.fx.burst(this.getBodyCenter(_a).setY(_a.y + 1), HanbaDef.Sun, 36, 9, 1.1, 0.4, 3);
    const d = this.hdef;
    const seconds = phase >= 1 && phase - 1 < d.phases.length ? d.phases[phase - 1].seconds : 3;
    const title = d.cardTitle(phase);
    if (title) this.ctx.ui.banner(title, d.cardSub(phase) ?? undefined, clamp(seconds, 2, 3.2));
    this.slowMo(d.phaseSlowMo, d.phaseSlowMoSeconds);
    if (phase >= 1) this.scorch.begin(seconds);
    if (phase >= 2) this.sunRise.begin(seconds);
  }

  protected override transitionTick(t: number): void {
    const k = (t * 1.6) % 2;
    this.glow(0, k > 1 ? 2 - k : k);
  }

  protected override onTransitionEnd(): void {
    this.glow(0, 0);
    this.ring.idle();
  }

  /** 招式间隙和出招中每帧：二阶段起裂缝喷气 */
  protected override passiveTick(dt: number): void {
    if (this.phase >= 1) this.scorch.tick(dt);
  }

  protected override onEnrage(): void {
    this.ring.idleBlaze = Math.max(this.ring.idleBlaze, 0.55);
    this.ring.spinSpeed *= 1.5;
    this.ring.idle();
  }

  protected override onDefeated(_result: DamageResult): void {
    this.closeEclipse();
    this.exposure.active = false;
    this.sinkFrom = this.hoverNow;
    if (this.ring.risen) this.ring.fall(this.position, 1.1);
    this.ring.extinguish();
    this.setWeak(true, true);
    this.act('death', this.hdef.defeat.seconds);
    for (const e of this.wraiths) this.ctx.fx.burst(_a.copy(e.position).setY(e.position.y + 0.5), HanbaDef.Sand, 22, 4.5, 1.1, 0.35, 4);
    this.wraiths.clear();
    this.ward.drop();
    this.scorch.end();
    this.director?.abort('首领倒下');
    this.defeatShow();
  }

  /** 倒下的演出（HanbaCinematics.Defeat + HanbaBrain.DefeatFx）：倒地 / 跪落震屏、泉眼复涌、太阳回到午后、溃散金沙 */
  private defeatShow(): void {
    const ctx = this.ctx;
    const secs = this.hdef.defeat.seconds;
    const at = this.position.clone();
    Fx.sandBlast(ctx, this.getBodyCenter(new THREE.Vector3()), 2.4);
    new DefeatTimeline(ctx)
      .during(secs, () => {
        if (Math.random() < 0.35) ctx.fx.burst(_a.copy(this.position).setY(this.position.y + 0.5 + Math.random() * 3), HanbaDef.Sand, 3, 1.2, 0.8, 0.22, 5);
      })
      .at(COLLAPSE_AT, () => {
        this.quake(0.55, 0.5, 60);
        ctx.fx.burst(_a.copy(at).setY(at.y + 0.3), HanbaDef.Sand, 26, 6, 0.9, 0.4, 6);
        Fx.sandBlast(ctx, _a.copy(at).setY(at.y + 0.3), 3.6);
        Fx.slam(ctx, at, 4.5);
      })
      .at(REFILL_AT, () => {
        const spring = this.spring ?? HanbaSpring.find();
        if (spring && spring.level < 0.99) {
          spring.refill(REFILL_SECONDS, ctx);
          ctx.audio.play('shield_recharge', { position: at, volume: 0.8, pitch: 0.6 });
        }
        if (stageHooks.water && stageHooks.water.depthAt(at, true) > 0) Fx.springSpout(ctx, at, 1.2, 4.5);
        const sky = HanbaSunDriver.find(ctx);
        if (sky && (sky.drives > 0 || sky.dim < 0.99)) sky.restore(SUN_RESTORE_SECONDS);
      })
      .at(KNEEL_AT, () => {
        this.quake(0.45, 0.4, 60);
        ctx.audio.play('boss_slam', { position: at, volume: 0.8, pitch: 0.8 });
      })
      .at(secs * 0.88, () => Fx.sandBlast(ctx, _a.copy(at).setY(at.y + 2.2), 3.2, HanbaDef.Sun));
  }

  protected override animateDeath(t: number): void {
    // 落地由 hover 接手；第 88% 时最后一下大爆炸（BossBase）后模型隐去
    if (t >= 0.88) this.model.visible = false;
  }

  protected override onReleased(): void {
    this.animator.dispose();
    this.closeEclipse();
    this.ward.dispose();
    this.scorch.end();
    this.ring?.dispose();
    this.exposure?.burn.clear();
    this.director?.abort('首领释放');
    if (devHook?.boss === this) devHook = null;
  }

  override onDamaged(result: DamageResult): void {
    super.onDamaged(result);
    if (this.eclipseOpen && result.request.headshot && result.dealt > 0) {
      const e = this.currentEclipse;
      if (e) eclipseWeakHits++;
    }
  }
}

let eclipseWeakHits = 0;

// ───────────────────────────── 开发钩子（?dev，只在开发服务器里） ─────────────────────────────

interface DevHook {
  boss: Hanba;
}

let devHook: DevHook | null = null;

function devHookEnabled(): boolean {
  return !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
}

function installDevHook(boss: Hanba): void {
  devHook = { boss };
  (window as unknown as Record<string, unknown>).__hanba = {
    get boss() { return boss; },
    /** 跳过登场演出（不看首次锁） */
    skipIntro: () => boss.director?.requestSkip(true) ?? false,
    /** 把生命层打到某个比例（跳阶段用；门槛照常起作用：每次只越一道线） */
    setHealth: (fraction: number) => {
      boss.shield = 0;
      boss.hp = Math.max(1, boss.maxHp * fraction);
    },
    forceMove: (id: string) => boss.forceMove(id),
    state: () => ({
      pos: boss.position.toArray().map(v => +v.toFixed(2)), cam: boss.ctx.camera.position.toArray().map(v => +v.toFixed(2)),
      phase: boss.phase, introDone: boss.introDone, transitioning: boss.transitioning, move: boss.currentMove?.id ?? null,
      stage: boss.currentMove?.stage ?? null, hp: boss.hp, maxHp: boss.maxHp, shield: boss.shield, weak: boss.weakExposed,
      eclipse: boss.eclipseOpen, ringRisen: boss.ring.risen, sunburn: boss.exposure.burn.stacks, exposureGain: boss.exposure.lastGain,
      director: boss.director ? { stage: boss.director.stage, shot: boss.director.shotName, t: boss.director.t, released: boss.director.released } : null,
      sunElevation: HanbaSunDriver.find(boss.ctx)?.elevation ?? null, springLevel: stageHooks.water?.springLevel() ?? null,
      vents: boss.scorch.vents.length, ward: boss.ward.up, playerHits: boss.playerHits, act: boss.lastAct, eclipseWeakHits,
      color: hexColor(boss.hdef.color), clip: { driven: boss.animator.clipDriven, state: boss.animator.state, u: +boss.animator.u.toFixed(3) },
    }),
  };
}
