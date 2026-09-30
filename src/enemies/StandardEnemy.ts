/**
 * 普通敌人（非 Boss）的公共中间层，继承冻结的 EnemyBase。
 *
 * 模板方法：
 *  - EnemyBase.think → 本类 think：公共计时 / 视线 / 横移换向，再调用子类 ai(dt)
 *  - EnemyBase.animate → 本类 animate：步态相位、受击后仰衰减、发光插值、词缀更新，再调用子类 pose(dt)
 *
 * 另外提供：攻击令牌、带卡死绕行的 navigate、远程寻找视线站位、发光部件通道、
 * 词缀接入（精英名称 / 视觉 / 数值）以及若干几何小工具。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../core/types';
import { clamp01, damp } from '../core/math';
import { EnemyBase } from './EnemyBase';
import { attackDirector, type TokenKind } from './AttackTokens';
import { AFFIX_NAMES, createAffix, isAffixId, type AffixController } from './Affixes';
import { part, type HumanoidRig } from './Models';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

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
  private strafeTimer: number;
  private wasStunned = false;
  private tokenKind: TokenKind | null = null;

  // 视线站位
  protected readonly vantage = new THREE.Vector3();
  protected hasVantage = false;
  private vantageTimer = 0;

  // 卡死检测与绕行
  private stuckTimer = 0;
  private readonly stuckRef = new THREE.Vector3();
  private detourTime = 0;
  private readonly detour = new THREE.Vector3();

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    this.strafeSign = ctx.rng.sign();
    this.strafeTimer = ctx.rng.range(1, 2.6);
    // 出生后错开首次攻击，避免整波同步
    this.cooldown = ctx.rng.range(0.6, 2.0);
    this.stuckRef.copy(this.position);
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

  // ───────────── 生命周期 ─────────────

  override init(): void {
    super.init();
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
    if (!this.ctx.player.alive) {
      if (this.state !== 'idle') {
        this.cancelAttack();
        this.releaseAttack();
        this.setState('idle');
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
    }
    this.wasStunned = stunned;
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
  }

  protected override onDeath(r: DamageResult): void {
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
    for (const f of this.flashMats) {
      f.baseEmissive.setHex(color);
      f.baseIntensity = intensity;
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
    const mat = additive
      ? new THREE.MeshBasicMaterial({ color: base, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color: base, toneMapped: false });
    const mesh = part(parent, geo, mat, x, y, z);
    this.glowSlots.push({ mesh, base: new THREE.Color(base), hot: new THREE.Color(hot), channel: Math.min(GLOW_CHANNELS - 1, channel), mat: null });
    return mesh;
  }

  /** 修改某个发光部件的热色（例如同一法阵在不同招式下换色） */
  protected setGlowHot(mesh: THREE.Mesh, hot: number): void {
    for (const g of this.glowSlots) if (g.mesh === mesh) g.hot.setHex(hot);
  }

  // ───────────── AI 辅助 ─────────────

  /** 当前移速（含词缀） */
  get speed(): number {
    return this.def.speed * this.speedMult;
  }

  protected setState(s: string): void {
    this.state = s;
    this.stateTime = 0;
  }

  /** 前摇时长：攻速只缩短一部分，且不低于 min（保证可读） */
  protected windup(base: number, min = 0.25): number {
    return Math.max(Math.min(base, min), base / (1 + (this.attackRate - 1) * 0.45));
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

  /** 与玩家的高度差是否在范围内 */
  protected verticalReach(maxDy: number): boolean {
    return Math.abs(this.ctx.player.position.y - this.position.y) <= maxDy;
  }

  /** 朝向与「指向玩家」方向的夹角余弦（水平） */
  protected facingDot(): number {
    const p = this.ctx.player.position;
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
   * 走到目标（地面走导航网格），带卡死检测：1.1 秒几乎没挪动就随机绕行一小段。
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
    if (arrived || this.flying || this.controlLoss > 0) {
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
        if (this.ctx.nav.randomWalkable(this.position, 1.5, 4.5, this.detour)) this.detourTime = 0.9;
        this.strafeSign = -this.strafeSign;
      }
    }
    return false;
  }

  /**
   * 远程单位保持距离：太远靠近（导航），太近后撤带横移，区间内横移。
   */
  protected keepRange(minD: number, maxD: number, speed: number, strafeScale = 0.55): void {
    const p = this.ctx.player.position;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const s = this.strafeSign;
    if (d > maxD) {
      this.navigate(p, speed, Math.max(1, maxD - 1.5));
    } else if (d < minD) {
      this.setMove(-dx - dz * 0.45 * s, -dz + dx * 0.45 * s, speed);
    } else {
      this.setMove(-dz * s, dx * s, speed * strafeScale);
    }
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
      this.navigate(this.ctx.player.position, speed, Math.min(minR, 4));
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
