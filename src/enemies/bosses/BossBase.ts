/**
 * 三个 Boss 的公共基类（继承冻结的 EnemyBase）。
 *
 * 负责：
 *  - 登场：spawnDuration 期间由子类 entrance(t) 演出（从地下升起 / 从天而降）。
 *  - 不可选中（契约 IEnemy.untargetable）：登场未完成、阶段转换演出期间为 true。EnemyManager 的 raycast /
 *    queryRadius / nearest 跳过本 Boss，Combat.damageEnemy / applyStatus 直接返回；raycastHit 同时返回 false 作为双保险。
 *  - 招式调度：招式 = 一段时间轴（tick(t) 返回 true 结束），带内置冷却与出招权重；招式之间有喘息期（idle 移动）。
 *    at(x) 在时间轴越过 x 秒的那一帧返回 true，便于编排「预警 → 出手 → 收招」。
 *    招式结束或被打断时撤回它画出、尚未填满的预警（HazardSet.cancelMoveWarnings，'move' 归属）。
 *  - 阶段：生命（hp / maxHp，与 Boss 血条刻度一致）跌破 thresholds[i] 时，等当前招式收尾（最多 2 秒，之后强制打断
 *    并撤回未兑现的预警），再播放吼叫 / 屏震 / 变色演出（演出期间不可选中）。
 *  - 霸体（契约 IEnemy.stunImmune）：只有招式间隙（走位 / 喘息）能被眩晕，最多 0.35 秒，之后 6 秒免疫；出招中、
 *    登场、阶段转换期间 stunImmune 为 true，Combat 直接忽略眩晕（不播特效、不派发事件），时间轴不会被暂停，
 *    已经画出的预警始终和实际出手对得上。击退抗性 1（EnemyBase 已处理）。
 *  - 大体型受击：hitShapes（球 / 竖直胶囊，挂在骨骼锚点上随动画移动），weak=true 的形状算爆头。
 *  - 清理：死亡或释放时取消所有任务、移除所有危险物、撤回所有预警（HazardSet.clear），召唤物随之崩解
 *    （静默移除：不经伤害管线、不派发 enemy:killed、不掉落，与 'purge' 静默处决约定一致）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, Element, GameContext, IEnemy, ProjectileSpec, SpawnOptions } from '../../core/types';
import { EnemyBase } from '../EnemyBase';
import { attackDirector } from '../AttackTokens';
import { clamp, raySphere, rayVerticalCapsule, TAU } from '../../core/math';
import { HazardSet } from './Hazards';
import { attachEnemyArt } from '../../assets/EnemyArt';
import type { SkinnedBody } from '../../assets/SkinnedBody';

const _v = new THREE.Vector3();
const _hc = new THREE.Vector3();
const _glowColor = new THREE.Color();

export interface HitShape {
  anchor: THREE.Object3D;
  radius: number;
  /** >0 为竖直胶囊（中心上下各 halfHeight），0 为球 */
  halfHeight: number;
  /** 弱点（命中算爆头） */
  weak: boolean;
}

export interface BossMove {
  readonly id: string;
  /** 本招内置冷却（从出招开始计） */
  cooldown: number;
  /** 收招后的喘息时间（再乘 restFactor） */
  recovery: number;
  /** 出招权重；<=0 表示当前不可用 */
  weight(): number;
  start(): void;
  /** t = 本招已进行秒数（首帧为 0）；返回 true 表示结束 */
  tick(t: number, dt: number): boolean;
  /** 结束或被打断时调用，负责清理本招的临时物体（必须可重复调用） */
  end?(): void;
}

interface Slot {
  move: BossMove;
  /** 登场结束后多久才可用 */
  firstDelay: number;
  readyAt: number;
}

const _cands: Slot[] = [];
const _weights: number[] = [];
/** 血量越过阶段阈值时，当前招式最多还能继续多久（之后强制打断进入阶段转换） */
const PHASE_WAIT = 2;

export interface FireOpts {
  radius?: number;
  color: number;
  visual?: ProjectileSpec['visual'];
  lifetime?: number;
  gravity?: number;
  scale?: number;
  element?: Element;
  homing?: number;
  explosionRadius?: number;
}

export abstract class BossBase extends EnemyBase {
  readonly hazards: HazardSet;
  /** 当前阶段（0 起） */
  phase = 0;
  /** 进入第 i+1 阶段的血量比例阈值（降序） */
  protected thresholds: number[] = [0.5];
  protected current: BossMove | null = null;
  protected moveT = 0;
  private movePrev = -1;
  protected restLeft = 1.4;
  private slots: Slot[] = [];
  private lastMoveId = '';
  private queued: string | null = null;
  /** 越过阶段阈值后已等待当前招式收尾的秒数 */
  private phaseWait = 0;
  protected transitionLeft = 0;
  protected transitionDuration = 2.4;
  protected entranceDone = false;
  protected hitShapes: HitShape[] = [];
  protected weakAnchor: THREE.Object3D | null = null;
  /** 美术资产身体（清单里有绑定本 Boss 的骨骼网格时） */
  private artBody: SkinnedBody | null = null;
  protected muzzleAnchor: THREE.Object3D | null = null;
  /** 按 userData.role 收集的实例材质（init 之后可用） */
  protected readonly roleMats = new Map<string, THREE.Material[]>();
  protected minions: IEnemy[] = [];
  protected anim = 'idle';
  protected animT = 0;
  /** 死亡爆炸 / 特效主色 */
  protected themeColor: number;
  /** 眩晕免疫期截止时间（ctx.time.now）：每次被眩晕后 6 秒内 stunImmune 为 true */
  private stunImmuneUntil = 0;
  /** 上一次 update 结束时剩余的眩晕（用来识别新施加的眩晕） */
  private stunLeft = 0;
  private deathFxAcc = 0;
  private finalBlast = false;
  /** hitShapes 世界坐标缓存（每次 update 后失效，避免每条射线都重算骨骼矩阵） */
  private shapeCache: THREE.Vector3[] = [];
  private shapeCacheValid = false;

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    this.hazards = new HazardSet(ctx, this);
    this.deathDuration = 3.2;
    this.spawnDuration = 2.6;
    this.themeColor = def.color ?? 0xff8844;
  }

  // ───────────── 子类接口 ─────────────

  /** 招式间隙的移动 / 朝向 */
  protected abstract idle(dt: number): void;
  /** 登场演出，t 0→1（期间不可被射中） */
  protected abstract entrance(t: number, dt: number): void;
  /** 模型建好、材质已实例化之后 */
  protected onModelReady(): void {}
  protected onEntranceEnd(): void {}
  /** 进入新阶段（此时已打断招式、开始吼叫演出） */
  protected onPhase(_phase: number): void {}
  /** 阶段转换演出期间每帧调用，t 为已进行秒数 */
  protected transitionTick(_t: number, dt: number): void {
    this.facePlayer(1.5, dt);
  }
  /** 存活且已登场时每帧调用（含眩晕期间），用于护盾再生、背景陨石等 */
  protected passive(_dt: number): void {}
  /** 喘息时间倍率（阶段越高越短） */
  protected restFactor(): number {
    return 1;
  }
  protected onBossDeath(_result: DamageResult): void {}
  protected onBossDispose(): void {}

  // ───────────── 生命周期 ─────────────

  override init(): void {
    this.keepInsideArena();
    super.init();
    this.model.scale.setScalar(1);
    // 美术资产（清单里绑定到本 Boss 的骨骼网格，走通用部件骨架）；缺失时保持程序化模型。受击判定是 hitShapes，与网格无关
    this.artBody = attachEnemyArt({
      host: this.model.children[0],
      defId: this.def.id,
      rig: undefined,
      renderer: this.ctx.renderer,
      lowQuality: this.ctx.settings.quality === 'low',
      own: (m) => {
        this.clonedMats.push(m);
        this.flashMats.push({ mat: m, baseEmissive: m.emissive.clone(), baseIntensity: m.emissiveIntensity });
      },
    }).body;
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (o.userData.glow) mesh.castShadow = false;
      const role = o.userData.role as string | undefined;
      if (!role) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let arr = this.roleMats.get(role);
      if (!arr) {
        arr = [];
        this.roleMats.set(role, arr);
      }
      for (const m of mats) if (!arr.includes(m)) arr.push(m);
    });
    this.onModelReady();
    this.hazards.prewarm();
    this.entrance(0, 0);
  }

  /**
   * 契约 IEnemy.untargetable：登场未完成或阶段转换演出期间不可选中
   * （射线 / 范围查询跳过，Combat 的伤害与状态直接忽略）。
   */
  get untargetable(): boolean {
    return !this.entranceDone || this.transitionLeft > 0;
  }

  /**
   * 契约 IEnemy.stunImmune：出招中、登场、阶段转换期间，以及上次被眩晕后的 6 秒内免疫眩晕
   * （Combat 直接忽略，不播特效、不派发事件）。只有招式间隙能被眩晕。
   */
  get stunImmune(): boolean {
    return !this.entranceDone || this.transitionLeft > 0 || this.current !== null || this.ctx.time.now < this.stunImmuneUntil;
  }

  override update(dt: number): void {
    // 识别「上一帧之后新施加的」眩晕（Combat 只会在 stunImmune 为 false 时施加）：截断到 0.35 秒并开始 6 秒免疫期
    if (this.alive && this.stunTime > this.stunLeft + 1e-4) {
      this.stunTime = Math.min(this.stunTime, 0.35);
      this.stunImmuneUntil = this.ctx.time.now + 6;
    }
    super.update(dt);
    this.stunLeft = this.stunTime;
    if (!this.alive) {
      this.updateDeathFx(dt);
    } else {
      this.animT += dt;
      if (!this.entranceDone && this.age < this.spawnDuration) {
        this.model.scale.setScalar(1);
        this.entrance(this.age / this.spawnDuration, dt);
      } else if (this.entranceDone) {
        this.passive(dt);
      }
    }
    this.hazards.update(dt);
    this.shapeCacheValid = false;
  }

  protected override think(dt: number): void {
    if (!this.entranceDone) {
      this.entranceDone = true;
      // 招式的首次可用时间从登场结束算起
      const now = this.ctx.time.now;
      for (const s of this.slots) s.readyAt = s.firstDelay > 0 ? now + s.firstDelay : -Infinity;
      this.entrance(1, 0);
      this.onEntranceEnd();
    }
    if (this.transitionLeft > 0) {
      this.stopMoving();
      this.transitionLeft -= dt;
      this.transitionTick(this.transitionDuration - this.transitionLeft, dt);
      if (this.transitionLeft <= 0) {
        this.setAnim('idle');
        this.restLeft = 0.4;
      }
      return;
    }
    if (this.phase < this.thresholds.length && this.phaseFraction() <= this.thresholds[this.phase]) {
      // 正在出招时最多再等 PHASE_WAIT 秒让这一招打完（已经画出的预警照常兑现，观感比打断好）；
      // 超时则强制打断，abortMove 会撤回尚未填满的预警，不会出现「预警填满却什么也没发生」
      if (!this.current || this.phaseWait >= PHASE_WAIT) {
        this.phaseWait = 0;
        this.beginTransition(this.phase + 1);
        return;
      }
      this.phaseWait += dt;
    }
    const m = this.current;
    if (m) {
      const done = m.tick(this.moveT, dt);
      this.movePrev = this.moveT;
      this.moveT += dt;
      if (done && this.current === m) this.finishMove();
      return;
    }
    this.restLeft -= dt;
    this.idle(dt);
    if (this.restLeft <= 0) this.pickMove();
  }

  // ───────────── 招式调度 ─────────────

  /** 注册招式；firstDelay 为登场结束后多久才可用 */
  protected addMove(move: BossMove, firstDelay = 0): void {
    this.slots.push({ move, firstDelay, readyAt: firstDelay > 0 ? this.ctx.time.now + firstDelay : -Infinity });
  }

  /** 下一次出招强制使用该招（忽略冷却与权重） */
  protected queueMove(id: string): void {
    this.queued = id;
  }

  /** 时间轴在本帧越过 x 秒 */
  protected at(x: number): boolean {
    return this.movePrev < x && this.moveT >= x;
  }

  protected setAnim(name: string, restart = false): void {
    if (this.anim !== name || restart) {
      this.anim = name;
      this.animT = 0;
    }
  }

  private pickMove(): void {
    const now = this.ctx.time.now;
    if (this.queued) {
      const id = this.queued;
      this.queued = null;
      for (const s of this.slots) {
        if (s.move.id === id) {
          this.startMove(s, now);
          return;
        }
      }
    }
    _cands.length = 0;
    _weights.length = 0;
    let total = 0;
    for (const s of this.slots) {
      if (now < s.readyAt) continue;
      let w = s.move.weight();
      if (w <= 0) continue;
      if (s.move.id === this.lastMoveId) w *= 0.2;
      _cands.push(s);
      _weights.push(w);
      total += w;
    }
    if (_cands.length === 0) {
      this.restLeft = 0.3;
      return;
    }
    let r = this.ctx.rng.next() * total;
    let pick = _cands[_cands.length - 1];
    for (let i = 0; i < _cands.length; i++) {
      r -= _weights[i];
      if (r <= 0) {
        pick = _cands[i];
        break;
      }
    }
    _cands.length = 0;
    this.startMove(pick, now);
  }

  private startMove(s: Slot, now: number): void {
    this.current = s.move;
    this.moveT = 0;
    this.movePrev = -1;
    s.readyAt = now + s.move.cooldown;
    this.lastMoveId = s.move.id;
    this.stopMoving();
    s.move.start();
  }

  private finishMove(): void {
    const m = this.current;
    this.current = null;
    if (!m) return;
    m.end?.();
    // 正常收招时本招的预警都已兑现；万一有提前结束的分支，也不留下填不满的预警
    this.hazards.cancelMoveWarnings();
    this.restLeft = m.recovery * this.restFactor();
    this.setAnim('idle');
  }

  /** 打断当前招式（阶段转换 / 死亡 / 释放），并撤回本招尚未兑现的预警 */
  protected abortMove(): void {
    const m = this.current;
    this.current = null;
    m?.end?.();
    this.hazards.cancelMoveWarnings();
  }

  private beginTransition(next: number): void {
    this.abortMove();
    this.phase = next;
    this.transitionLeft = this.transitionDuration;
    this.setAnim('roar', true);
    this.ctx.audio.play('boss_roar', { position: this.position, volume: 1 });
    this.ctx.fx.shake(0.45, 0.9);
    this.onPhase(next);
  }

  // ───────────── 查询 / 工具 ─────────────

  /** 护盾 + 护甲 + 生命 的剩余比例 */
  healthFraction(): number {
    const max = this.maxHp + this.maxArmor + this.maxShield;
    return max > 0 ? (this.hp + this.armor + this.shield) / max : 0;
  }

  /**
   * 阶段判定用的比例：只看生命层（hp / maxHp）。
   * Boss 血条的 50% / 25% 刻度画在生命条上，按生命判定阶段，玩家看到刻度被越过时恰好进入新阶段。
   */
  phaseFraction(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
  }

  protected floorY(): number {
    return this.ctx.stage.arena?.floorY ?? 0;
  }

  protected arenaCenter(out: THREE.Vector3): THREE.Vector3 {
    const a = this.ctx.stage.arena;
    return a ? out.copy(a.center) : out.set(0, this.floorY(), 0);
  }

  protected clampToArena(v: THREE.Vector3, margin: number): THREE.Vector3 {
    const a = this.ctx.stage.arena;
    if (!a) return v;
    v.x = clamp(v.x, a.minX + margin, a.maxX - margin);
    v.z = clamp(v.z, a.minZ + margin, a.maxZ - margin);
    return v;
  }

  /** 沿 (dx,dz) 方向到竞技场边界（留 margin）的距离 */
  protected distToArenaEdge(x: number, z: number, dx: number, dz: number, margin: number): number {
    const a = this.ctx.stage.arena;
    if (!a) return 40;
    let t = 60;
    if (dx > 1e-4) t = Math.min(t, (a.maxX - margin - x) / dx);
    else if (dx < -1e-4) t = Math.min(t, (a.minX + margin - x) / dx);
    if (dz > 1e-4) t = Math.min(t, (a.maxZ - margin - z) / dz);
    else if (dz < -1e-4) t = Math.min(t, (a.minZ + margin - z) / dz);
    return Math.max(0, t);
  }

  private keepInsideArena(): void {
    const margin = this.radius + 6;
    this.clampToArena(this.position, margin);
  }

  protected yawTo(x: number, z: number): number {
    return Math.atan2(x - this.position.x, z - this.position.z);
  }

  protected yawToPlayer(): number {
    const p = this.ctx.player.position;
    return this.yawTo(p.x, p.z);
  }

  /** 设置 role 部件（MeshBasicMaterial）的颜色 */
  protected setRoleColor(role: string, color: THREE.Color | number): void {
    const arr = this.roleMats.get(role);
    if (!arr) return;
    if (typeof color === 'number') _glowColor.setHex(color);
    else _glowColor.copy(color);
    for (const m of arr) {
      const b = m as THREE.MeshBasicMaterial;
      if (b.color) b.color.copy(_glowColor);
    }
  }

  protected setRoleOpacity(role: string, opacity: number): void {
    const arr = this.roleMats.get(role);
    if (!arr) return;
    for (const m of arr) m.opacity = opacity;
  }

  /** 发射敌方投射物（沿给定方向）。伤害自动乘 damageMult */
  protected fireProjectile(from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, o: FireOpts): void {
    this.ctx.projectiles.spawn({
      owner: 'enemy',
      position: from.clone(),
      velocity: dir.clone().multiplyScalar(speed),
      gravity: o.gravity ?? 0,
      radius: o.radius ?? 0.25,
      lifetime: o.lifetime ?? 4,
      enemyDamage: damage * this.damageMult,
      element: o.element ?? 'none',
      color: o.color,
      visual: o.visual ?? 'orb',
      scale: o.scale,
      homing: o.homing,
      explosionRadius: o.explosionRadius,
      sourceEnemy: this,
    });
  }

  /** 在自身周围召唤小怪（数量受 cap 限制），返回实际召唤数 */
  protected summon(defId: string, count: number, minR: number, maxR: number, cap: number): number {
    this.pruneMinions();
    const rng = this.ctx.rng;
    const floor = this.floorY();
    let n = 0;
    for (let i = 0; i < count && this.minions.length < cap; i++) {
      const a = (i / count) * TAU + rng.range(-0.4, 0.4) + this.facing;
      const r = rng.range(minR, maxR);
      _v.set(this.position.x + Math.sin(a) * r, floor, this.position.z + Math.cos(a) * r);
      this.clampToArena(_v, 3);
      const pos = new THREE.Vector3();
      if (!this.ctx.nav.nearestWalkable(_v, pos)) pos.copy(_v);
      const e = this.ctx.enemies.spawn(defId, { position: pos, level: this.level });
      if (e) {
        this.minions.push(e);
        n++;
      }
    }
    return n;
  }

  protected pruneMinions(): void {
    let n = 0;
    for (let i = 0; i < this.minions.length; i++) {
      const m = this.minions[i];
      if (m.alive) this.minions[n++] = m;
    }
    this.minions.length = n;
  }

  /**
   * Boss 陨落时召唤物随之崩解：静默移除，与 'purge' 静默处决约定一致——直接进入死亡流程，不经伤害管线，
   * 不派发 enemy:killed，因此不掉落、不触发「击杀时」效果。请求同样带 'purge' 标签，
   * 召唤物自己的死亡回调若要区分清场与正常击杀，按标签判断即可；期间同样置 attackDirector.purging，
   * 爆裂词缀、爆骸虫的死亡爆炸不会发动（与 EnemyManager.killAll / forceKill 的行为一致）。
   * （StageDirector 在 Boss 死亡后调用的 EnemyManager.killAll 同样带 'purge'，两条清场路径都不给奖励。）
   */
  protected killMinions(): void {
    const wasPurging = attackDirector.purging;
    attackDirector.purging = true;
    try {
      for (const m of this.minions) {
        if (!m.alive) continue;
        this.purgeMinion(m);
      }
    } finally {
      attackDirector.purging = wasPurging;
    }
    this.minions.length = 0;
  }

  private purgeMinion(m: IEnemy): void {
    try {
      m.onKilled({
        request: { base: 0, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] },
        dealt: 0,
        isCrit: false,
        killed: true,
        layer: 'health',
        shieldBroken: false,
        armorBroken: false,
        element: 'none',
        statusApplied: null,
      });
    } catch (err) {
      // 单个召唤物的死亡回调出错不能中断 Boss 的死亡流程（其余召唤物照常崩解）
      console.error('[BossBase] 召唤物崩解出错', err);
    }
  }

  // ───────────── 受击判定 ─────────────

  /**
   * 多段命中体射线测试。不可选中（登场 / 阶段转换）时返回 false：EnemyManager.raycast 本就按契约跳过
   * untargetable 的敌人，这里是双保险（例如直接调用 raycastHit 的投射物精测）。
   */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive || this.untargetable) return false;
    const shapes = this.hitShapes;
    if (shapes.length === 0) return super.raycastHit(origin, dir, maxDist, out);
    if (!this.shapeCacheValid) {
      this.shapeCacheValid = true;
      const cache = this.shapeCache;
      while (cache.length < shapes.length) cache.push(new THREE.Vector3());
      this.root.updateMatrixWorld(true);
      for (let i = 0; i < shapes.length; i++) cache[i].setFromMatrixPosition(shapes[i].anchor.matrixWorld);
    }
    let body = -1;
    let weak = -1;
    let weakR = 0;
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      _hc.copy(this.shapeCache[i]);
      const t = s.halfHeight > 0
        ? rayVerticalCapsule(origin, dir, _hc.x, _hc.z, _hc.y - s.halfHeight, _hc.y + s.halfHeight, s.radius)
        : raySphere(origin, dir, _hc, s.radius);
      if (t < 0 || t > maxDist) continue;
      if (s.weak) {
        if (weak < 0 || t < weak) {
          weak = t;
          weakR = s.radius;
        }
      } else if (body < 0 || t < body) {
        body = t;
      }
    }
    // 弱点优先（与 EnemyBase 的爆头规则一致）：只有身体明显更近（超过半个弱点半径，例如从下方斜射先打到胸口）才算身体命中
    if (weak >= 0 && (body < 0 || weak <= body + weakR * 0.5)) {
      out.distance = weak;
      out.headshot = true;
      return true;
    }
    if (body >= 0) {
      out.distance = body;
      out.headshot = false;
      return true;
    }
    return false;
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.weakAnchor ? this.weakAnchor.getWorldPosition(out) : super.getHeadCenter(out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzleAnchor ? this.muzzleAnchor.getWorldPosition(out) : super.getMuzzle(out);
  }

  // ───────────── 死亡 / 释放 ─────────────

  protected override onDeath(result: DamageResult): void {
    this.abortMove();
    this.transitionLeft = 0;
    this.hazards.clear();
    this.killMinions();
    this.setEmissive(_glowColor.setHex(this.themeColor), 0.8);
    const c = this.getBodyCenter(new THREE.Vector3());
    this.ctx.fx.explosion(c, this.radius * 2.2, this.themeColor);
    this.ctx.fx.shake(0.8, 1.1);
    this.ctx.audio.play('boss_roar', { position: this.position, volume: 1, pitch: 0.7 });
    this.ctx.audio.play('boss_slam', { position: this.position });
    this.onBossDeath(result);
  }

  private updateDeathFx(dt: number): void {
    this.deathFxAcc += dt;
    const end = this.deathDuration * 0.88;
    if (this.deathFxAcc >= 0.2 && this.deathTime < end) {
      this.deathFxAcc = 0;
      const a = Math.random() * TAU;
      const r = this.radius * (0.2 + Math.random() * 0.8);
      const p = new THREE.Vector3(
        this.position.x + Math.sin(a) * r,
        this.position.y + (0.15 + Math.random() * 0.75) * this.height,
        this.position.z + Math.cos(a) * r,
      );
      this.ctx.fx.explosion(p, 0.9 + Math.random() * 1.1, this.themeColor);
      this.ctx.audio.play('explosion', { position: this.position, volume: 0.4, pitch: 0.8 + Math.random() * 0.4 });
    }
    if (!this.finalBlast && this.deathTime >= end) {
      this.finalBlast = true;
      const c = this.getBodyCenter(new THREE.Vector3());
      this.ctx.fx.explosion(c, this.radius * 3.2, this.themeColor);
      this.ctx.fx.burst(c, this.themeColor, 40, 12, 1.4, 0.5, 10);
      this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 14, this.themeColor, 0.9);
      this.ctx.fx.shake(0.9, 0.8);
      this.ctx.audio.play('explosion', { position: this.position, volume: 1, pitch: 0.6 });
    }
  }

  protected override onDispose(): void {
    this.abortMove();
    this.hazards.clear();
    this.onBossDispose();
    this.minions.length = 0;
    this.artBody?.dispose();
    this.artBody = null;
  }
}
