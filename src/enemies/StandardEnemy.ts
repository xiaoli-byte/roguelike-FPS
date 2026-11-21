/**
 * 普通敌人（非 Boss）的公共中间层，继承冻结的 EnemyBase。
 *
 * 模板方法：
 *  - EnemyBase.think → 本类 think：公共计时 / 视线 / 横移换向，再调用子类 ai(dt)
 *  - EnemyBase.animate → 本类 animate：步态相位、受击后仰衰减、发光插值、词缀更新，再调用子类 pose(dt)
 *
 * 另外提供：攻击令牌、带卡死绕行的 navigate、能上下高台的 approachPlayer、远程寻找视线站位、
 * 发光部件通道、随动画移动的头部判定锚点、词缀接入（精英名称 / 视觉 / 数值）以及若干几何小工具。
 *
 * 受击四层（Unity EnemyAI.HitStagger / HitStun / Hitch + Poise，见 HitReaction.ts）：def.poise / hitch 不为 0 的敌人
 * 按韧性累计硬直、每挨一枪顿一下；外部的反制 / 剧本可以直接调 hitStagger / hitStun。前三章的敌人韧性都是 0，不进这两条。
 * 词缀招式（迅捷的前行龙卷）接管期间 affixAttackBusy = true：基础 AI 停手（Unity EnemyAI.AffixAttackBusy）。
 *
 * 片段（M12 第二期）：资产在 public/assets/anim/ 有片段时，美术挂载顺带建 ClipPlayer（Unity Animator + CreatureRig + CreatureLocomotion），
 * 读好后片段覆盖骨骼（程序化 pose 仍然跑：发光、挂件、阴影抬升这些副作用照旧，骨骼姿势被片段盖掉）。招式片段按子类的 clipCues 表
 * 在 setState 时播（Unity 各 AI 在同一处 Play / PlayTimed / PlayLocomotion）；眩晕 / 硬直播 Hit，醒来回 Locomotion；受击走 Rig.Hit +
 * 伤害过 12% 最大生命触发叠加层 Flinch（Unity EnemyBody.staggerFraction）；死亡冻住（Unity 没有布娃娃时关 Animator）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../core/types';
import { clamp01, damp } from '../core/math';
import { EnemyBase } from './EnemyBase';
import { attackDirector, type TokenKind } from './AttackTokens';
import { AFFIX_NAMES, createAffix, isAffixId, type AffixController } from './Affixes';
import { DEFAULT_STAGGER_SECONDS, PoiseMeter, STUN_TAKEN_MULT, isDotHit, poiseDamage, type HitCause, type HitLayer } from './HitReaction';
import { ENTRANCE, entranceAt, entrancePlan, type EntranceKind, type EntrancePlan } from './SpawnEntrance';
import { levelAt, playerLevel, type LevelSpot } from './Levels';
import { glowPartMat, part, type HumanoidRig } from './Models';
import { attachEnemyArt } from '../assets/EnemyArt';
import type { NativeBody } from '../assets/NativeRig';
import type { MoveResult } from '../world/Collision';
import type { SkinnedBody } from '../assets/SkinnedBody';
import type { ClipPlayer } from '../anim/ClipPlayer';

/**
 * 一个 AI 状态进入时怎么播片段（Unity EnemyAI 在 SetState 旁边的 Play / PlayTimed / PlayLocomotion）：
 *   clip  片段状态名（缺省 = AI 状态名）；fade 过渡秒数（缺省 0.08）；secs 有值时 PlayTimed（把片段拉伸到这么多秒，进状态那一帧末尾取值）
 *   'loco' = PlayLocomotion
 * 表里没有的状态不播（Unity 不调 Play：片段连段 / 留在当前状态）
 */
export type ClipCue = { clip?: string | (() => string); fade?: number; secs?: () => number } | 'loco';
/** EnemyBody.staggerFraction：单发伤害超过最大生命的这个比例触发叠加层 Flinch */
const CLIP_STAGGER_FRACTION = 0.12;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _push = new THREE.Vector3();
const _pushMove: MoveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };

/**
 * 击退（Unity EnemyAI.Knockback / LaunchUp）：水平冲量 × (1 − 抗性) 叠到一个推力上（上限 9 m/s），按 8/s 指数衰减推开；
 * 冲量 > 2 m/s 时失控 0.25 × (1 − 抗性) 秒（knockedBack，熔岩据此判「被打进去」）。竖直不走这里——上抛走 launchUp（重力 26）
 */
export const KNOCKBACK = { maxPush: 9, decay: 8, controlLossImpulse: 2, controlLossTime: 0.25, launchGravity: 26, minLaunch: 0.5 } as const;

/** 眩晕期间受伤 +25%（hitStun 进的眩晕）：每个 GameContext 挂一次全局伤害修正 */
const stunTakenInstalled = new WeakSet<object>();
function installStunTaken(ctx: GameContext): void {
  if (stunTakenInstalled.has(ctx)) return;
  stunTakenInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy) => (enemy instanceof StandardEnemy && enemy.hitStunTaken && enemy.stunTime > 0 ? STUN_TAKEN_MULT : 1));
}

/** 发光通道数：0 = 主前摇发光；1、2 供子类区分不同招式 */
const GLOW_CHANNELS = 3;

interface GlowSlot {
  mesh: THREE.Mesh;
  base: THREE.Color;
  hot: THREE.Color;
  channel: number;
  mat: THREE.MeshBasicMaterial | null;
}

export abstract class StandardEnemy extends EnemyBase {
  /** 移速倍率（词缀写入） */
  speedMult = 1;
  /** 攻速倍率：冷却按它加速，前摇只按一部分缩短以保证可读 */
  attackRate = 1;
  /** 狂暴词缀已触发 */
  frenzied = false;
  /** 词缀招式（迅捷的前行龙卷）接管中：基础 AI 不同时出手（Unity EnemyAI.AffixAttackBusy，由词缀控制器设置与解除） */
  affixAttackBusy = false;
  /** hitStun 进的眩晕：醒来前受伤 × STUN_TAKEN_MULT */
  hitStunTaken = false;
  /** 韧性破过几次、最近进的是受击哪一层（测试 / 冒烟读） */
  poiseBreaks = 0;
  lastHitLayer: HitLayer | null = null;

  protected affixCtl: AffixController | null = null;
  protected state = 'chase';
  protected stateTime = 0;
  /** 主攻击冷却剩余秒数（按 attackRate 倒数） */
  protected cooldown: number;
  protected strafeSign: number;
  /** 本帧是否看得到玩家（think 开头刷新） */
  protected sees = false;
  /** 连续看不到玩家的秒数 */
  protected blindTime = 0;
  /** 受击后仰强度（0..~1，自动衰减） */
  protected hurtKick = 0;
  protected walkPhase = 0;
  protected walkAmp = 0;
  /** 步态最大摆幅（弧度）与步频系数 */
  protected walkScale = 0.7;
  protected stepRate = 1.5;
  /** 各发光通道的目标强度与当前强度（0..1） */
  protected readonly glowTarget: number[] = [0, 0, 0];
  protected readonly glowLevel: number[] = [0, 0, 0];

  private readonly glowSlots: GlowSlot[] = [];
  private baseTint = 0x000000;
  private baseTintIntensity = 1;
  /** 与 flashMats 一一对应：该材质原本就有自发光 */
  private intrinsicGlow: boolean[] = [];
  private strafeTimer: number;
  private wasStunned = false;
  private tokenKind: TokenKind | null = null;
  /** 受击四层：韧性计量（def.poise / hitch 都是 0 时为 null）、每枪顿多久、硬直 / 顿一下的剩余秒数 */
  private readonly poiseMeter: PoiseMeter | null;
  private readonly hitchSeconds: number;
  private hitStaggerLeft = 0;
  private hitchLeft = 0;
  /** 出场位移（跃下 / 飞临 / 熔岩爬出，Unity SpawnEntrance）与落地后的出生站稳剩余秒数 */
  private entrance: { plan: EntrancePlan; from: THREE.Vector3; to: THREE.Vector3; t: number; trail: number } | null = null;
  private settleLeft = 0;
  /** 还没推完的水平击退速度（m/s，Unity EnemyAI.PendingPush） */
  readonly pendingPush = new THREE.Vector3();
  /** 美术资产身体（清单里有绑定本敌人的骨骼网格时） */
  private artBody: SkinnedBody | null = null;
  /** 原生骨架美术（按骨骼名驱动的动画用）；没有时为 null */
  protected nativeBody: NativeBody | null = null;
  /** 片段播放器（M12）：资产有片段时建，读好后 ready；没有片段 / 读不到为 null 或一直不 ready（程序化摆姿势是退路） */
  protected clips: ClipPlayer | null = null;
  private clipCueTable: Readonly<Record<string, ClipCue>> | null = null;
  private pendingCue: { state: string; cue: ClipCue } | null = null;

  // 视线站位
  protected readonly vantage = new THREE.Vector3();
  protected hasVantage = false;
  private vantageTimer = 0;

  // 卡死检测与绕行
  private stuckTimer = 0;
  private readonly stuckRef = new THREE.Vector3();
  private detourTime = 0;
  private readonly detour = new THREE.Vector3();

  // 高台上下
  private readonly spot: LevelSpot = { route: null, onTop: false };
  private dropTimer = 0;
  private dropClear = false;

  // 头部判定锚点（骨骼 + 局部偏移）：爆头判定、伤害数字、头顶血条都跟着动画走
  private headAnchor: THREE.Object3D | null = null;
  private readonly headLocal = new THREE.Vector3();

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    this.strafeSign = ctx.rng.sign();
    this.strafeTimer = ctx.rng.range(1, 2.6);
    // 出生后错开首次攻击，避免整波同步
    this.cooldown = ctx.rng.range(0.6, 2.0);
    this.stuckRef.copy(this.position);
    // 第四章受击四层：有韧性 / 顿一下的敌人才挂计量（Unity Poise.Attach：前三章都是 0，不挂）
    const poise = def.poise ?? 0;
    this.hitchSeconds = Math.max(0, def.hitch ?? 0);
    this.poiseMeter = poise > 0 || this.hitchSeconds > 0 ? new PoiseMeter(poise) : null;
  }

  // ───────────── 子类接口 ─────────────

  /** 每帧 AI（未眩晕、玩家存活时） */
  protected abstract ai(dt: number): void;
  /** 每帧程序动画 */
  protected abstract pose(dt: number): void;
  /** 模型与材质就绪之后（此时 model 内材质已是实例克隆） */
  protected afterInit(): void {}
  /** 攻击被打断（眩晕 / 死亡 / 清理 / 玩家死亡）：收起预警物、恢复移动参数、回到默认状态 */
  protected cancelAttack(): void {}
  /**
   * 片段表（M12）：AI 状态 → 怎么播（照 Unity 对应 AI 的 Play / PlayTimed / PlayLocomotion）。没有片段的敌人不用写
   */
  protected clipCues(): Readonly<Record<string, ClipCue>> | null {
    return null;
  }
  /** 子类自己的晕眩表现（镇墓兽撞墙撞晕）：打开 CreatureRig 的晕眩叠加（Unity EnemyAI.DazeOverlay） */
  protected get dazeOverlay(): boolean {
    return false;
  }
  /** 片段在驱动骨骼（数据读好了）：子类可据此跳过只为骨骼服务的程序化计算 */
  protected get clipDriven(): boolean {
    return this.clips?.ready ?? false;
  }
  /** 立刻播一个片段状态（不经状态表；同一帧之前 setState 排下的片段作废：后调用的算数，同 Unity 先后两次 CrossFade） */
  protected playClip(state: string, fade = 0.08, seconds = 0): void {
    if (!this.clips) return;
    this.pendingCue = null;
    if (seconds > 0.05) this.clips.playTimed(state, seconds, fade);
    else this.clips.play(state, fade);
  }
  /** Unity EnemyAI.PlayLocomotion */
  protected playLocomotion(): void {
    if (!this.clips) return;
    this.pendingCue = null;
    this.clips.playLocomotion();
  }
  /** 绑定美术资产用的 id（清单 bind.id）；共用身体的变体（如蜃景分身）改成本体的 id */
  protected artId(): string {
    return this.def.id;
  }

  // ───────────── 生命周期 ─────────────

  override init(): void {
    super.init();
    this.attachArtBody();
    // 自带自发光的材质（飞灯的纸灯身、巫祝的符纸）不参与词缀 / 招式着色，保住它们的辨识度
    this.intrinsicGlow = this.flashMats.map((f) => f.baseEmissive.getHex() !== 0);
    for (const g of this.glowSlots) {
      g.mat = g.mesh.material as THREE.MeshBasicMaterial;
      g.mat.color.copy(g.base);
    }
    // 发光 / 半透明部件不投影
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) m.castShadow = false;
    });
    const affix = this.affix;
    if (this.isElite && isAffixId(affix)) {
      this.affixCtl = createAffix(this, affix);
      this.displayName = `精英·${AFFIX_NAMES[affix]} ${this.def.name}`;
    }
    this.afterInit();
  }

  protected override think(dt: number): void {
    this.stateTime += dt;
    if (this.cooldown > 0) this.cooldown -= dt * this.attackRate;
    // 出场落地后的出生站稳（Unity：AI 交还后还有 spawn 状态的 0.7 s）：站着面向玩家，已经能打
    if (this.settleLeft > 0) {
      this.settleLeft -= dt;
      this.stopMoving();
      this.facePlayer(6, dt);
      return;
    }
    // 受击四层：硬直中停摆（到点回到初始状态）；轻怪挨一枪顿一下（不打断招式）。前三章的敌人从不进这两个分支
    if (this.hitStaggerLeft > 0) {
      this.hitStaggerLeft -= dt;
      this.glowTarget[0] = 0;
      this.stopMoving();
      if (this.hitStaggerLeft <= 0) {
        this.hitStaggerLeft = 0;
        this.onHitStaggerEnd();
      }
      return;
    }
    if (this.hitchLeft > 0) {
      this.hitchLeft -= dt;
      return;
    }
    if (!this.ctx.player.alive) {
      if (this.state !== 'idle') {
        this.cancelAttack();
        this.releaseAttack();
        this.setState('idle');
        this.playLocomotion();
      }
      this.stopMoving();
      this.glowTarget[0] = 0;
      return;
    }
    this.sees = this.canSeePlayer();
    this.blindTime = this.sees ? 0 : this.blindTime + dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0 || (this.moveResult.hitWall && this.strafeTimer < 1.3)) {
      this.strafeSign = -this.strafeSign;
      this.strafeTimer = this.ctx.rng.range(1.5, 3.2);
    }
    // 词缀招式接管期间：基础 AI 停手、站住（Unity EnemyAI.Update 的 AffixAttackBusy 分支）
    if (this.affixAttackBusy) {
      this.stopMoving();
      return;
    }
    this.ai(dt);
  }

  protected override animate(dt: number): void {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const ref = Math.max(1.5, this.def.speed);
    this.walkAmp = damp(this.walkAmp, Math.min(1.2, sp / ref) * this.walkScale, 10, dt);
    this.walkPhase += dt * (2.5 + sp * this.stepRate);
    this.hurtKick = damp(this.hurtKick, 0, 8, dt);

    const stunned = this.stunTime > 0;
    if (stunned && !this.wasStunned) {
      this.cancelAttack();
      this.releaseAttack();
      this.playClip('Hit', 0.05);
    }
    // 醒了：hitStun 的受伤加成撤掉（Unity EnemyAI：醒来时 stunTaken.Dispose）；片段回 Locomotion
    if (!stunned && this.wasStunned) {
      this.hitStunTaken = false;
      this.playLocomotion();
    }
    this.wasStunned = stunned;
    this.poiseMeter?.tick(dt);
    if (stunned) this.glowTarget[0] = 0;

    for (let i = 0; i < GLOW_CHANNELS; i++) this.glowLevel[i] = damp(this.glowLevel[i], this.glowTarget[i], 14, dt);
    for (const g of this.glowSlots) {
      if (g.mat) g.mat.color.copy(g.base).lerp(g.hot, clamp01(this.glowLevel[g.channel]));
    }
    this.affixCtl?.update(dt);
    this.pose(dt);
  }

  protected override onHurt(r: DamageResult): void {
    const k = r.isCrit ? 0.7 : 0.38;
    this.hurtKick = Math.min(1.1, this.hurtKick + k * (0.5 + Math.min(1, r.dealt / Math.max(1, this.maxHp * 0.25))));
    this.affixCtl?.onHurt(r);
    this.poiseHit(r);
    // 片段：方向性受击弹簧 + 重击触发叠加层 Flinch（Unity EnemyBody.OnDamaged；持续伤害不晃）
    const c = this.clips;
    if (c?.ready && r.dealt > 0 && !isDotHit(r.request)) {
      const strength = clamp01((r.dealt / Math.max(1, this.maxHp)) * 4);
      c.hit(r.request.direction ?? _a.set(0, 0, 0), strength, !r.killed && r.dealt >= this.maxHp * CLIP_STAGGER_FRACTION);
    }
  }

  // ───────────── 受击四层（Unity EnemyAI.HitStagger / HitStun / Hitch、Poise.OnDamaged） ─────────────

  /** 霸体：此刻硬直打不断（招式标了霸体、大招）。缺省 false；子类按当前招式覆写 */
  get superArmor(): boolean {
    return false;
  }

  /** 正在硬直（受击四层的硬直，不是元素眩晕） */
  get hitStaggered(): boolean {
    return this.hitStaggerLeft > 0;
  }

  /** 每次受伤：轻怪顿一下（持续伤害不算），韧性累计满了硬直（Unity Poise.OnDamaged） */
  private poiseHit(r: DamageResult): void {
    const meter = this.poiseMeter;
    if (!meter || r.killed || !(r.dealt > 0) || !this.alive) return;
    const req = r.request;
    if (this.hitchSeconds > 0 && !isDotHit(req)) this.hitch(this.hitchSeconds);
    if (!meter.add(poiseDamage(req, r.dealt))) return;
    if (this.hitStagger(this.def.staggerSeconds ?? DEFAULT_STAGGER_SECONDS, req.point ?? null, 'poise')) this.poiseBreaks++;
  }

  /**
   * 硬直（韧性破、反制、机关）：统一入口。死了 / 出生中 / 霸体时返回 false；否则交给 onHitStagger
   * （缺省：打断招式、撤预警、停下、后仰，停摆 seconds 秒，到点 onHitStaggerEnd）
   */
  hitStagger(seconds: number, from: THREE.Vector3 | null = null, cause: HitCause = 'poise'): boolean {
    if (!this.alive || this.age < this.spawnDuration || !(seconds > 0) || !Number.isFinite(seconds) || this.superArmor) return false;
    let ok = false;
    try {
      ok = this.onHitStagger(seconds, from, cause);
    } catch (err) {
      console.error('[StandardEnemy] onHitStagger threw', err);
    }
    if (ok) this.lastHitLayer = 'stagger';
    return ok;
  }

  /** 眩晕（反制、破防、封脉）：走元素眩晕（精英 ×0.75、首领另有规则），期间受伤 +25%。死了 / 出生中返回 false */
  hitStun(seconds: number, _cause: HitCause = 'script'): boolean {
    if (!this.alive || this.age < this.spawnDuration || !(seconds > 0) || !Number.isFinite(seconds)) return false;
    const before = this.stunTime;
    this.ctx.combat.applyStatus(this, 'stun', 0, seconds);
    const ok = this.stunTime > before || (before > 0 && this.stunTime > 0);
    if (!ok) return false;
    installStunTaken(this.ctx);
    this.hitStunTaken = true;
    this.lastHitLayer = 'stun';
    return true;
  }

  /** 顿一下（轻怪每挨一枪）：AI 停 seconds 秒、不打断招式（已经在顿的取较长） */
  hitch(seconds: number): void {
    if (!this.alive || this.age < this.spawnDuration || !(seconds > 0) || !Number.isFinite(seconds)) return;
    const was = this.hitchLeft > 0;
    this.hitchLeft = Math.max(this.hitchLeft, seconds);
    if (!was) this.lastHitLayer = 'flinch';
  }

  /** 硬直的表现与状态（子类覆写表现；返回 false = 不进）。缺省：停下、打断招式、后仰、停摆 seconds 秒 */
  protected onHitStagger(seconds: number, _from: THREE.Vector3 | null, _cause: HitCause): boolean {
    this.stopMoving();
    this.releaseAttack();
    this.cancelAttack();
    this.glowTarget[0] = 0;
    this.hitStaggerLeft = Math.max(this.hitStaggerLeft, seconds);
    this.hurtKick = Math.min(1.1, this.hurtKick + 0.8);
    this.playClip('Hit', 0.05);
    return true;
  }

  /** 硬直结束（cancelAttack 已经把子类送回默认状态；片段回 Locomotion，同 Unity OnHitStaggerEnd） */
  protected onHitStaggerEnd(): void {
    this.playLocomotion();
  }

  protected override onDeath(r: DamageResult): void {
    // 片段冻在最后一帧（Unity 没有布娃娃时 Animator.enabled = false）；倒地照旧是 EnemyBase 的程序化前倒
    if (this.clips) this.clips.frozen = true;
    this.hitStaggerLeft = this.hitchLeft = 0;
    this.hitStunTaken = false;
    this.releaseAttack();
    this.cancelAttack();
    // 眼睛 / 核心熄灭
    for (const g of this.glowSlots) if (g.mat) g.mat.color.copy(g.base).multiplyScalar(0.25);
    if (!attackDirector.purging) this.affixCtl?.onDeath(r);
  }

  protected override onDispose(): void {
    this.releaseAttack();
    this.cancelAttack();
    this.affixCtl?.dispose();
    this.affixCtl = null;
    this.artBody?.dispose();
    this.artBody = null;
    this.nativeBody = null;
    this.clips?.dispose();
    this.clips = null;
  }

  // ───────────── 出生 / 出场（Unity EnemyAI.Spawn 的不可选中、SpawnEntrance） ─────────────

  /**
   * 不可选中：出生显形的 0.7 s（Unity EnemyAI.Spawn 把 hp.untargetable 留到 spawn 状态结束）、出场位移中。
   * 子类覆写时并上 super.untargetable
   */
  get untargetable(): boolean {
    if (!this.alive) return false;
    if (this.entrance) return true;
    return this.age < this.spawnDuration;
  }

  /** 正在出场位移（跃下 / 飞临 / 熔岩爬出） */
  get entering(): boolean {
    return this.entrance !== null;
  }

  /**
   * 开始一段出场位移（Unity SpawnEntrance.Begin）：敌人刚生成在落点 to 上，这一帧挪到起点 from，按 kind 走到 to；
   * 期间 AI 不思考、不吃击退、不可选中，不播出生显形；落地后站稳 0.7 s 再交给 AI
   */
  beginEntrance(kind: EntranceKind, from: THREE.Vector3, to: THREE.Vector3): boolean {
    if (!this.alive || !Number.isFinite(from.x + from.y + from.z) || !Number.isFinite(to.x + to.y + to.z)) return false;
    this.entrance = { plan: entrancePlan(kind, from, to), from: from.clone(), to: to.clone(), t: 0, trail: 0 };
    this.settleLeft = 0;
    this.position.copy(from);
    this.velocity.set(0, 0, 0);
    this.model.scale.setScalar(this.sizeScale);
    const dx = to.x - from.x, dz = to.z - from.z;
    if (dx * dx + dz * dz > 1e-6) this.facing = Math.atan2(dx, dz);
    this.root.rotation.y = this.facing;
    // 熔岩爬出：起跳点一团熔岩溅（Unity SpawnCues.LavaSplash）
    if (kind === 'hop') {
      _a.copy(from).y += 0.2;
      this.ctx.fx.burst(_a, 0xff6a1f, 14, 4, 0.6, 0.14, 8);
    }
    return true;
  }

  override update(dt: number): void {
    const en = this.entrance;
    if (!en) {
      super.update(dt);
      this.stepPush(dt);
      this.tickClips(dt);
      return;
    }
    if (!this.alive) {
      this.entrance = null;
      super.update(dt);
      this.tickClips(dt);
      return;
    }
    this.age += dt;
    en.t += dt;
    const u = entranceAt(en.plan, en.from, en.to, en.t, _a);
    if (dt > 0) this.velocity.set((_a.x - this.position.x) / dt, (_a.y - this.position.y) / dt, (_a.z - this.position.z) / dt);
    const dx = _a.x - this.position.x, dz = _a.z - this.position.z;
    this.position.copy(_a);
    if (dx * dx + dz * dz > 1e-6) this.facing = Math.atan2(dx, dz);
    // 飞临：一路拖尾焰（每 0.04 s 两颗）
    if (en.plan.kind === 'fly' && en.t > en.plan.delay) {
      en.trail += dt;
      while (en.trail > 0.04) {
        en.trail -= 0.04;
        this.ctx.fx.burst(this.position, 0xff8a3a, 2, 0.6, 0.45, 0.1, -0.5);
      }
    }
    if (u >= 1 && en.t >= en.plan.delay) {
      this.position.copy(en.to);
      this.velocity.set(0, 0, 0);
      this.entrance = null;
      this.settleLeft = ENTRANCE.settle;
      if (this.age < this.spawnDuration) this.age = this.spawnDuration;
      // 跃下：落地一震（Unity SpawnCues.Land）
      if (en.plan.kind === 'jump') {
        _a.copy(en.to).y += 0.06;
        this.ctx.fx.ring(_a, 1.6, 0xc8a878, 0.35);
        this.ctx.fx.burst(_a, 0xc8a878, 10, 3, 0.5, 0.16, 4);
        this.ctx.audio.play('land', { position: en.to, volume: 0.7 });
      }
    }
    this.root.rotation.y = this.facing;
    this.animate(dt);
    this.tickClips(dt);
  }

  /** 片段：先补播本帧 setState 排下的片段（片段表的 secs 在这时取值），再推进状态机（覆盖程序化摆的骨骼）、CreatureRig */
  private tickClips(dt: number): void {
    const c = this.clips;
    if (!c) return;
    const p = this.pendingCue;
    this.pendingCue = null;
    if (p) {
      const cue = p.cue;
      if (cue === 'loco') c.playLocomotion();
      else {
        const secs = cue.secs?.() ?? 0;
        const name = typeof cue.clip === 'function' ? cue.clip() : cue.clip ?? p.state;
        if (secs > 0.05) c.playTimed(name, secs, cue.fade ?? 0.08);
        else c.play(name, cue.fade ?? 0.08);
      }
    }
    c.daze = this.alive && (this.stunTime > 0 || this.dazeOverlay) ? 1 : 0;
    c.update(dt);
  }

  /**
   * 击退（Unity EnemyAI.Knockback）：地面单位只取水平分量，叠到推力上（上限 9 m/s）、按 8/s 衰减推开；
   * 冲量够大时失控。飞行单位照旧加到速度上（Unity FlyingEnemyAI.AirKnockback）。出场位移中不吃击退
   */
  override knockback(impulse: THREE.Vector3): void {
    if (this.entrance) return;
    if (this.flying) {
      super.knockback(impulse);
      return;
    }
    if (!this.alive) return;
    const k = 1 - this.knockbackResist;
    if (k <= 0) return;
    const p = this.pendingPush;
    p.x += impulse.x * k;
    p.z += impulse.z * k;
    const len = Math.hypot(p.x, p.z);
    if (len > KNOCKBACK.maxPush) p.multiplyScalar(KNOCKBACK.maxPush / len);
    if (impulse.x * impulse.x + impulse.z * impulse.z > KNOCKBACK.controlLossImpulse ** 2) {
      this.controlLoss = Math.max(this.controlLoss, KNOCKBACK.controlLossTime * k);
    }
  }

  /**
   * 击飞上抛（Unity EnemyAI.LaunchUp；裂地重击、磐石壁垒、厚皮的冲击波）：上抛速度 × (1 − 抗性)，
   * 连同还没推完的水平击退一起带上天，重力 26，落地前不受控。首领（抗性 1）、飞行、出生 / 出场中的不受影响；不到 0.5 m/s 不掀。返回是否掀起来了
   */
  launchUp(velocity: number): boolean {
    const vy = velocity * (1 - this.knockbackResist);
    if (!this.alive || this.entrance || this.age < this.spawnDuration || this.flying || !(velocity > 0) || vy < KNOCKBACK.minLaunch) return false;
    this.velocity.x += this.pendingPush.x;
    this.velocity.z += this.pendingPush.z;
    this.pendingPush.set(0, 0, 0);
    this.velocity.y = Math.max(this.velocity.y, vy);
    this.onGround = false;
    // 落地前不受控（Unity：整段交给脚本位移，AI 的移动不生效）：失控时长 = 腾空时间
    this.controlLoss = Math.max(this.controlLoss, (2 * vy) / KNOCKBACK.launchGravity);
    return true;
  }

  /** 推力推开、衰减（Unity EnemyAI.StepPush：agent.Move(push × dt)，push × e^(−8dt)） */
  private stepPush(dt: number): void {
    const p = this.pendingPush;
    if (p.x * p.x + p.z * p.z < 0.0004 || !(dt > 0)) return;
    if (this.alive) {
      _push.set(p.x * dt, 0, p.z * dt);
      this.ctx.world.moveBody(this.position, this.radius * 0.85, this.height, _push, this.onGround, 0.55, _pushMove);
    }
    p.multiplyScalar(Math.exp(-KNOCKBACK.decay * dt));
  }

  // ───────────── 美术资产 ─────────────

  /**
   * 资产清单里有绑定到本敌人的骨骼网格（bind = { source: 'enemy', id: def.id }）时，蒙皮到程序化人形骨骼上，
   * 取代脚本拼装的身体部件（约定：人形敌人把 HumanoidRig 存在 this.rig）。资产未就绪则保持程序化模型。
   */
  private attachArtBody(): void {
    const art = attachEnemyArt({
      host: this.model.children[0],
      defId: this.artId(),
      variant: this.ctx.stage?.stage?.theme,
      rig: (this as unknown as { rig?: unknown }).rig,
      renderer: this.ctx.renderer,
      lowQuality: this.ctx.settings.quality === 'low',
      own: (m) => {
        this.ownMaterial(m);
        this.flashMats.push({ mat: m, baseEmissive: m.emissive.clone(), baseIntensity: m.emissiveIntensity });
      },
      clips: {
        root: this.root,
        ground: (x, y, z, max) => {
          const h = this.ctx.world.groundHeight(x, z, y);
          return h > y - max ? h : null;
        },
      },
    });
    this.artBody = art.body;
    this.nativeBody = art.native;
    this.clips = art.clips ?? null;
    if (this.clips) {
      // Unity EnemyAI：body.Rig.lookTarget = 玩家视点
      this.clips.lookTarget = this.ctx.player.eye;
      this.clipCueTable = this.clipCues();
      // 构造时就进了的状态（enter 这类出生状态）补排一次
      const first = this.clipCueTable?.[this.state];
      if (first) this.pendingCue = { state: this.state, cue: first };
    }
    // 武器上的发光件按白模的方块摆放，平时显示底色会和美术模型错位（比如弧形刀刃旁的一根直条）；
    // 美术贴图里已经画了发光元素，所以改成加法混合、底色为黑：平时不可见，前摇时叠加发光，提示功能不变
    const weaponGlows = new Set(art.parts.flatMap((p) => p.glows));
    this.glowsAsOverlay((g) => weaponGlows.has(g));
  }

  /** 已经换上美术身体（白模的身体部件被隐藏） */
  protected get hasArtBody(): boolean {
    return this.artBody !== null;
  }

  /** 把发光件改成加法混合、底色为黑的叠加层：平时不可见（美术贴图自带发光元素），前摇时叠加发光 */
  protected glowsAsOverlay(which: (mesh: THREE.Mesh) => boolean = () => true): void {
    for (const g of this.glowSlots) {
      if (!which(g.mesh)) continue;
      const m = g.mesh.material as THREE.MeshBasicMaterial;
      m.blending = THREE.AdditiveBlending;
      m.transparent = true;
      m.depthWrite = false;
      m.needsUpdate = true;
      g.base.setHex(0x000000);
    }
  }

  // ───────────── 头部判定 ─────────────

  /**
   * 在 buildModel 里指定头部判定球的锚点：obj 的局部坐标 (x, y, z) 处为头心。
   * EnemyBase.raycastHit 通过 getHeadCenter 取头心，所以前倾 / 下蹲 / 冲锋时头部判定与画面一致。
   * def.headY 仍需填静止姿态下的头心高度（身体胶囊的上沿按它计算）。
   */
  protected setHeadAnchor(obj: THREE.Object3D, x: number, y: number, z: number): void {
    this.headAnchor = obj;
    this.headLocal.set(x, y, z);
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    const a = this.headAnchor;
    // 出生 / 死亡动画期间模型在缩放、倒地，用静止数值即可
    if (!a || !this.alive || this.age < this.spawnDuration) return super.getHeadCenter(out);
    a.updateWorldMatrix(true, false);
    out.copy(this.headLocal).applyMatrix4(a.matrixWorld);
    if (!Number.isFinite(out.x + out.y + out.z)) return super.getHeadCenter(out);
    return out;
  }

  // ───────────── 词缀 / 材质接口（Affixes 使用） ─────────────

  /**
   * 修改身体材质的基础自发光（每帧可调；受击闪白与元素着色仍由 EnemyBase 覆盖）。
   * persistent=true 时记为常驻底色（词缀），restoreTint() 会恢复到它。
   */
  tintBody(color: number, intensity: number, persistent = false): void {
    if (persistent) {
      this.baseTint = color;
      this.baseTintIntensity = intensity;
    }
    const fm = this.flashMats;
    for (let i = 0; i < fm.length; i++) {
      if (this.intrinsicGlow[i]) continue;
      fm[i].baseEmissive.setHex(color);
      fm[i].baseIntensity = intensity;
    }
  }

  /** 恢复常驻底色（招式临时着色结束后调用） */
  restoreTint(): void {
    this.tintBody(this.baseTint, this.baseTintIntensity);
  }

  /** 交给基类在 dispose 时释放的实例材质 */
  ownMaterial<T extends THREE.Material>(m: T): T {
    this.clonedMats.push(m);
    return m;
  }

  // ───────────── 建模辅助 ─────────────

  /**
   * 在 buildModel 里创建发光部件：颜色随通道强度在 base 与 hot 之间插值。
   * additive=true 时为加法混合（base 设为 0x000000 即「平时不可见」）。
   */
  protected glowPart(
    parent: THREE.Object3D, geo: THREE.BufferGeometry, base: number, hot: number,
    x = 0, y = 0, z = 0, channel = 0, additive = false,
  ): THREE.Mesh {
    const ch = Math.max(0, Math.min(GLOW_CHANNELS - 1, channel));
    // 模板材质按参数缓存；EnemyBase.init 会把它克隆成实例材质（init 之后 g.mat 指向克隆）
    const mesh = part(parent, geo, glowPartMat(base, hot, ch, additive), x, y, z);
    this.glowSlots.push({ mesh, base: new THREE.Color(base), hot: new THREE.Color(hot), channel: ch, mat: null });
    return mesh;
  }

  // ───────────── AI 辅助 ─────────────

  /** 当前移速（含词缀） */
  get speed(): number {
    return this.def.speed * this.speedMult;
  }

  protected setState(s: string): void {
    this.state = s;
    this.stateTime = 0;
    const cue = this.clipCueTable?.[s];
    if (cue) this.pendingCue = { state: s, cue };
  }

  /**
   * 前摇时长（秒下限版）：攻速加成只缩短一部分前摇——按 1/√攻速 缩（Unity EnemyAI.Windup），且不低于 min 秒（保证可读）。
   * 等价于 Unity 的 Windup(base, min / base)（Unity 里写成 XxxWindupMin / XxxWindup 的那些调用）
   */
  protected windup(base: number, min = 0.25): number {
    return Math.max(Math.min(base, min), base / Math.sqrt(Math.max(0.1, this.attackRate)));
  }

  /** 前摇时长（Unity EnemyAI.Windup(time, minFraction) 原样）：time × max(minFraction, 1/√攻速) */
  protected windupFrac(time: number, minFraction: number): number {
    return time * Math.max(minFraction, 1 / Math.sqrt(Math.max(0.1, this.attackRate)));
  }

  /** 随机冷却，打散同类敌人的节奏 */
  protected rollCooldown(min: number, max: number): void {
    this.cooldown = this.ctx.rng.range(min, max);
  }

  protected requestAttack(kind: TokenKind, hold: number): boolean {
    const ok = attackDirector.tryAcquire(this.id, kind, this.ctx.time.now, hold, this.ctx.run.chapter);
    if (ok) this.tokenKind = kind;
    return ok;
  }

  protected releaseAttack(): void {
    if (this.tokenKind) {
      attackDirector.release(this.id);
      this.tokenKind = null;
    }
  }

  /** 与玩家（被嘲讽时：灵宠诱饵）的高度差是否在范围内 */
  protected verticalReach(maxDy: number): boolean {
    return Math.abs(this.targetPos.y - this.position.y) <= maxDy;
  }

  /** 朝向与「指向玩家」（被嘲讽时：诱饵）方向的夹角余弦（水平） */
  protected facingDot(): number {
    const p = this.targetPos;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return 1;
    return (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / d;
  }

  /** 模型局部坐标（未缩放）→ 世界坐标：只考虑朝向与精英缩放 */
  protected localPoint(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.sizeScale;
    const sn = Math.sin(this.facing);
    const cs = Math.cos(this.facing);
    return out.set(
      this.position.x + (x * cs + z * sn) * s,
      this.position.y + y * s,
      this.position.z + (-x * sn + z * cs) * s,
    );
  }

  /** from → to 的俯仰角（正 = 向上） */
  protected pitchTo(from: THREE.Vector3, to: THREE.Vector3): number {
    return Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
  }

  /**
   * 走到目标（地面走导航网格），带卡死检测：1.1 秒几乎没挪动（顶在障碍物端面、被人群堵住）
   * 就向侧面绕行一小段（优先垂直于目标方向、直线可达的点，找不到再随机），然后重新寻路。
   * 到达 arrive 内返回 true。
   */
  protected navigate(target: THREE.Vector3, speed: number, arrive = 0.6): boolean {
    const dt = this.ctx.time.dt;
    if (this.detourTime > 0) {
      this.detourTime -= dt;
      if (this.moveTo(this.detour, speed, 0.4)) this.detourTime = 0;
      return false;
    }
    const arrived = this.moveTo(target, speed, arrive);
    if (arrived || this.flying || this.controlLoss > 0 || this.stunTime > 0) {
      this.stuckTimer = 0;
      this.stuckRef.copy(this.position);
      return arrived;
    }
    this.stuckTimer += dt;
    if (this.stuckTimer >= 1.1) {
      const moved = Math.hypot(this.position.x - this.stuckRef.x, this.position.z - this.stuckRef.z);
      const expected = speed * this.slowMult * this.stuckTimer;
      this.stuckTimer = 0;
      this.stuckRef.copy(this.position);
      if (expected > 1 && moved < expected * 0.2) {
        this.strafeSign = -this.strafeSign;
        if (this.pickDetour(target)) this.detourTime = 0.9;
      }
    }
    return false;
  }

  /** 绕行点：先试目标方向左右两侧 2–3.5 米（略向后退），要求可走且直线可达；都不行再在附近随机取点 */
  private pickDetour(target: THREE.Vector3): boolean {
    const ctx = this.ctx;
    const px = this.position.x;
    const pz = this.position.z;
    const dx = target.x - px;
    const dz = target.z - pz;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      const ux = dx / len;
      const uz = dz / len;
      for (let k = 0; k < 4; k++) {
        const side = (k % 2 === 0 ? 1 : -1) * this.strafeSign;
        const lat = k < 2 ? 2.2 : 3.4;
        const back = k < 2 ? 0.4 : 1.2;
        const x = px - uz * side * lat - ux * back;
        const z = pz + ux * side * lat - uz * back;
        if (!ctx.nav.isWalkable(x, z)) continue;
        _a.set(px, this.position.y + 0.6, pz);
        _b.set(x, this.position.y + 0.6, z);
        if (ctx.world.segmentBlocked(_a, _b)) continue;
        this.detour.set(x, this.position.y, z);
        return true;
      }
    }
    return ctx.nav.randomWalkable(this.position, 1.5, 4.5, this.detour);
  }

  /**
   * 地面近战追击玩家：同在地面时等同 navigate；玩家站在高台（或其台阶）上时，
   * 先导航到台阶口再沿台阶直线走上去；自己在高台上而玩家不在时，台边无遮挡就直接走下去，否则沿台阶下来。
   * 到达 arrive 内（且与玩家同层）返回 true。
   */
  protected approachPlayer(speed: number, arrive: number): boolean {
    const ctx = this.ctx;
    const pl = this.targetPos;
    // 被嘲讽：直接走向灵宠诱饵（诱饵就在玩家身边，不按玩家所在层找路）
    if (this.flying || this.taunted) return this.navigate(pl, speed, arrive);
    const floorY = ctx.stage.arena?.floorY ?? 0;
    const them = playerLevel(ctx, floorY);
    const me = this.spot;
    levelAt(ctx.world, this.position, floorY, me);
    const mr = me.route;
    const pr = them.route;
    if (!mr && !pr) return this.navigate(pl, speed, arrive);

    const dx = pl.x - this.position.x;
    const dz = pl.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (mr && mr === pr) {
      // 同一座高台：台面上直接追（台面不在导航网格里）；还在台阶上时先走完台阶
      if (d <= arrive) {
        this.stopMoving();
        return true;
      }
      if (!me.onTop && them.onTop) this.steerTo(mr.top, speed);
      else if (me.onTop && !them.onTop && this.distXZ(mr.top) > 1.2) this.steerTo(mr.top, speed);
      else this.setMove(dx, dz, speed);
      return false;
    }
    if (mr) {
      // 自己在高台上、玩家不在：台边没有护栏挡着就直接走下去，否则沿台阶下来
      this.dropTimer -= ctx.time.dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = 0.3;
        this.dropClear = this.directPathClear(pl);
      }
      if (this.dropClear) this.setMove(dx, dz, speed);
      else if (me.onTop && this.distXZ(mr.top) > 0.8) this.steerTo(mr.top, speed);
      else this.steerTo(mr.foot, speed);
      return false;
    }
    // 自己在地面、玩家在高台（或其台阶）上：走到台阶口，再沿台阶上去
    const route = pr!;
    if (this.distXZ(route.foot) <= 1.0) {
      if (them.onTop) this.steerTo(route.top, speed);
      else this.setMove(dx, dz, speed);
      return false;
    }
    this.navigate(route.foot, speed, 0.5);
    return false;
  }

  private steerTo(p: THREE.Vector3, speed: number): void {
    this.setMove(p.x - this.position.x, p.z - this.position.z, speed);
  }

  private distXZ(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  /**
   * 远程单位保持距离：太远靠近（导航），太近后撤带横移，区间内横移。
   */
  protected keepRange(minD: number, maxD: number, speed: number, strafeScale = 0.55): void {
    const p = this.targetPos;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const s = this.strafeSign;
    // A shooter standing on a raised deck holds the high ground: it waits there for the player within
    // 12 m past its band (a far-end dais, say) rather than walking down, and never backs or strafes over
    // the deck edge.
    const perched = !this.flying && this.ctx.nav.platformAt?.(this.position) === true;
    if (d > maxD && !(perched && d <= maxD + 12)) {
      this.navigate(p, speed, Math.max(1, maxD - 1.5));
    } else if (d < minD) {
      this.perchMove(perched, -dx - dz * 0.45 * s, -dz + dx * 0.45 * s, speed);
    } else {
      this.perchMove(perched, -dz * s, dx * s, speed * strafeScale);
    }
  }

  /** setMove, except that a perched unit turns back instead of stepping off its deck. */
  protected perchMove(perched: boolean, dx: number, dz: number, speed: number): void {
    if (perched) {
      const len = Math.hypot(dx, dz) || 1, reach = this.radius + .6;
      _a.set(this.position.x + dx / len * reach, this.position.y, this.position.z + dz / len * reach);
      if (!this.ctx.nav.platformAt!(_a)) {
        this.strafeSign = -this.strafeSign;
        this.stopMoving();
        return;
      }
    }
    this.setMove(dx, dz, speed);
  }

  /**
   * 在玩家周围 [minR, maxR] 找一个能看到玩家的站位（离自己越近越好）。
   * @param eyeH 站位处视线高度（地面单位用头高，飞行单位用悬停高度）
   */
  protected findVantage(minR: number, maxR: number, eyeH: number, out: THREE.Vector3, tries = 6): boolean {
    const p = this.ctx.player;
    let best = Infinity;
    let found = false;
    for (let i = 0; i < tries; i++) {
      if (!this.ctx.nav.randomWalkable(p.position, minR, maxR, _a)) continue;
      _b.set(_a.x, _a.y + eyeH, _a.z);
      if (this.ctx.world.segmentBlocked(_b, p.eye)) continue;
      const d = (_a.x - this.position.x) ** 2 + (_a.z - this.position.z) ** 2;
      if (d < best) {
        best = d;
        out.copy(_a);
        found = true;
      }
    }
    return found;
  }

  /**
   * 远程通用：持续看不到玩家时移动到有视线的站位。返回 true 表示本帧正在寻位（已设置移动）。
   */
  protected seekSight(minR: number, maxR: number, speed: number, eyeH = this.headY): boolean {
    if (this.sees) {
      this.hasVantage = false;
      return false;
    }
    if (this.blindTime < 0.4) return false;
    this.vantageTimer -= this.ctx.time.dt;
    if (!this.hasVantage || this.vantageTimer <= 0) {
      this.vantageTimer = this.ctx.rng.range(1.2, 2.0);
      this.hasVantage = this.findVantage(minR, maxR, eyeH, this.vantage);
    }
    if (this.hasVantage) {
      if (this.navigate(this.vantage, speed, 0.8)) {
        this.hasVantage = false;
        this.vantageTimer = 0;
      }
    } else {
      this.navigate(this.targetPos, speed, Math.min(minR, 4));
    }
    return true;
  }

  // ───────────── 动画辅助 ─────────────

  /** 人形通用：受击后仰 + 眩晕摇晃（在 pose 最后调用） */
  protected applyHurtAndStun(r: HumanoidRig): void {
    r.torso.rotation.x -= this.hurtKick * 0.45;
    r.head.rotation.x -= this.hurtKick * 0.3;
    if (this.stunTime > 0) {
      const w = Math.sin(this.age * 7);
      r.head.rotation.z += w * 0.35;
      r.head.rotation.x += 0.3;
      r.torso.rotation.z += w * 0.1;
      r.armL.rotation.x *= 0.3;
      r.armR.rotation.x *= 0.3;
    }
  }
}
