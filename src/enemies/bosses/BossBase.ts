/**
 * 三个 Boss 的公共基类（继承冻结的 EnemyBase）。
 *
 * 负责：
 *  - 登场：spawnDuration 期间不可被射中，由子类 entrance(t) 演出（从地下升起 / 从天而降）。
 *  - 招式调度：招式 = 一段时间轴（tick(t) 返回 true 结束），带内置冷却与出招权重；招式之间有喘息期（idle 移动）。
 *    at(x) 在时间轴越过 x 秒的那一帧返回 true，便于编排「预警 → 出手 → 收招」。
 *  - 阶段：血量（护盾 + 护甲 + 生命 的总比例）跌破 thresholds[i] 时打断当前招式，播放吼叫 / 屏震 / 变色演出。
 *  - 霸体：眩晕最多 0.35 秒，之后 6 秒免疫；击退抗性 1（EnemyBase 已处理）。
 *  - 大体型受击：hitShapes（球 / 竖直胶囊，挂在骨骼锚点上随动画移动），weak=true 的形状算爆头。
 *  - 清理：死亡或释放时取消所有任务、移除所有危险物（HazardSet.clear），召唤物随之崩解。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, Element, GameContext, IEnemy, ProjectileSpec, SpawnOptions } from '../../core/types';
import { EnemyBase } from '../EnemyBase';
import { clamp, raySphere, rayVerticalCapsule, TAU } from '../../core/math';
import { HazardSet } from './Hazards';

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
  readyAt: number;
}

const _cands: Slot[] = [];
const _weights: number[] = [];

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
  protected transitionLeft = 0;
  protected transitionDuration = 2.4;
  protected entranceDone = false;
  protected hitShapes: HitShape[] = [];
  protected weakAnchor: THREE.Object3D | null = null;
  protected muzzleAnchor: THREE.Object3D | null = null;
  /** 按 userData.role 收集的实例材质（init 之后可用） */
  protected readonly roleMats = new Map<string, THREE.Material[]>();
  protected minions: IEnemy[] = [];
  protected anim = 'idle';
  protected animT = 0;
  /** 死亡爆炸 / 特效主色 */
  protected themeColor: number;
  private stunImmuneUntil = 0;
  private deathFxAcc = 0;
  private finalBlast = false;

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

  override update(dt: number): void {
    if (this.alive && this.stunTime > 0) {
      const now = this.ctx.time.now;
      if (!this.entranceDone || this.transitionLeft > 0 || now < this.stunImmuneUntil) {
        this.stunTime = 0;
      } else {
        this.stunTime = Math.min(this.stunTime, 0.35);
        this.stunImmuneUntil = now + 6;
      }
    }
    super.update(dt);
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
  }

  protected override think(dt: number): void {
    if (!this.entranceDone) {
      this.entranceDone = true;
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
    if (this.phase < this.thresholds.length && this.healthFraction() <= this.thresholds[this.phase]) {
      this.beginTransition(this.phase + 1);
      return;
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

  /** 注册招式；firstDelay 为开场后多久才可用 */
  protected addMove(move: BossMove, firstDelay = 0): void {
    this.slots.push({ move, readyAt: firstDelay > 0 ? this.ctx.time.now + firstDelay : -Infinity });
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
    this.restLeft = m.recovery * this.restFactor();
    this.setAnim('idle');
  }

  /** 打断当前招式（阶段转换 / 死亡 / 释放） */
  protected abortMove(): void {
    const m = this.current;
    this.current = null;
    m?.end?.();
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

  /** Boss 陨落时召唤物随之崩解（不经伤害管线，不掉落） */
  protected killMinions(): void {
    for (const m of this.minions) {
      if (!m.alive) continue;
      m.onKilled({
        request: { base: 0, element: 'none', source: 'status', canCrit: false, procDepth: 2 },
        dealt: 0,
        isCrit: false,
        killed: true,
        layer: 'health',
        shieldBroken: false,
        armorBroken: false,
        element: 'none',
        statusApplied: null,
      });
    }
    this.minions.length = 0;
  }

  // ───────────── 受击判定 ─────────────

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive || !this.entranceDone) return false;
    if (this.hitShapes.length === 0) return super.raycastHit(origin, dir, maxDist, out);
    let body = -1;
    let weak = -1;
    for (const s of this.hitShapes) {
      s.anchor.getWorldPosition(_hc);
      const t = s.halfHeight > 0
        ? rayVerticalCapsule(origin, dir, _hc.x, _hc.z, _hc.y - s.halfHeight, _hc.y + s.halfHeight, s.radius)
        : raySphere(origin, dir, _hc, s.radius);
      if (t < 0 || t > maxDist) continue;
      if (s.weak) {
        if (weak < 0 || t < weak) weak = t;
      } else if (body < 0 || t < body) {
        body = t;
      }
    }
    if (weak >= 0 && (body < 0 || weak <= body + 0.2)) {
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
  }
}
