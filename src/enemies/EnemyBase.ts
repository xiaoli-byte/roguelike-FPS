import * as THREE from 'three';
import type {
  DamageResult, EnemyDef, GameContext, IEnemy, ProjectileSpec, SpawnOptions, StatusId, StatusInstance,
} from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01, rotateTowards, raySphere, rayVerticalCapsule } from '../core/math';
import type { MoveResult } from '../world/Collision';

const GRAVITY = 26;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const STATUS_TINT: Partial<Record<StatusId, THREE.Color>> = {
  burn: new THREE.Color(ELEMENT_COLORS.fire),
  shock: new THREE.Color(ELEMENT_COLORS.shock),
  corrode: new THREE.Color(ELEMENT_COLORS.corrode),
};

interface FlashMat {
  mat: THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

/**
 * 所有敌人（含 Boss）的基类。
 *
 * 子类职责：
 *  - buildModel(): 返回模型（朝向 +Z，脚底在原点）。几何体请做模块级缓存（本类不会 dispose 几何体）；
 *    材质可以随意创建，本类会为每个实例克隆一份用于受击闪白，并在 dispose 时释放克隆。
 *  - think(dt): 每帧 AI。通过 moveTo/chasePlayer/setMove/faceTowards/shoot/melee 等辅助方法驱动。
 *    think 之前本类已把期望移动清零，think 不调用移动辅助方法 = 原地不动。
 *  - 可选覆盖：animate(dt) 程序动画、onHurt(result)、onDeath(result)、animateDeath(t)、getMuzzle(out)、onDispose()。
 *
 * 生命周期：EnemyManager 调用 factory 构造 → init() → 每帧 update(dt) → removed 为 true 后 dispose()。
 */
export abstract class EnemyBase implements IEnemy {
  private static nextId = 1;

  readonly id: number;
  readonly ctx: GameContext;
  readonly def: EnemyDef;
  readonly root = new THREE.Group();
  /** 子类模型挂在这里（便于死亡/出生动画对其做整体变换） */
  readonly model = new THREE.Group();
  /** 就是 root.position（脚底中心） */
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();

  displayName: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  alive = true;
  removed = false;
  readonly isElite: boolean;
  readonly isBoss: boolean;
  readonly flying: boolean;
  readonly affix: string | null;
  readonly level: number;
  radius: number;
  height: number;
  headY: number;
  headRadius: number;
  readonly statuses = new Map<StatusId, StatusInstance>();
  stunTime = 0;
  slowMult = 1;
  damageTakenMult = 1;
  knockbackResist: number;

  /** 攻击伤害倍率（等级与精英加成），子类攻击时乘上 */
  damageMult: number;
  /** 模型整体缩放（精英 1.25） */
  readonly sizeScale: number;
  /** 当前朝向（root.rotation.y），模型 +Z 指向此方向 */
  facing = 0;
  onGround = false;
  /** 自出生起经过的秒数 */
  age = 0;
  /** 出生动画时长，期间不行动、不可被选中为「已激活」 */
  spawnDuration = 0.7;
  /** 死亡动画时长 */
  deathDuration = 0.9;
  deathTime = 0;
  /** 水平加速度（越大转向越灵活） */
  accel = 28;
  /** 飞行单位目标高度（绝对 y）。NaN 表示使用 地面 + hoverHeight */
  flyTargetY = NaN;
  hoverHeight = 3.2;
  /** 最近一次受伤的时间（ctx.time.now） */
  lastHurtTime = -999;
  /** 被击退后丧失控制的剩余时间 */
  protected controlLoss = 0;

  protected desiredX = 0;
  protected desiredZ = 0;
  protected flashTimer = 0;
  protected flashStrength = 1;
  protected flashMats: FlashMat[] = [];
  protected clonedMats: THREE.Material[] = [];
  protected moveResult: MoveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };

  // 寻路
  protected path: THREE.Vector3[] = [];
  protected pathIndex = 0;
  protected repathTimer = 0;
  protected readonly pathTarget = new THREE.Vector3(Infinity, 0, 0);

  // 视线缓存
  private losTimer = 0;
  private losValue = false;

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    this.id = EnemyBase.nextId++;
    this.ctx = ctx;
    this.def = def;
    this.position = this.root.position;
    this.position.copy(opts.position);
    this.isElite = !!opts.elite;
    this.isBoss = !!def.isBoss;
    this.flying = !!def.flying;
    this.affix = opts.affix ?? null;
    this.level = Math.max(0.5, opts.level ?? 1);

    const eliteHp = this.isElite ? 2.6 : 1;
    const hpScale = this.level * eliteHp;
    this.maxHp = this.hp = Math.round(def.hp * hpScale);
    this.maxShield = this.shield = Math.round((def.shield ?? 0) * hpScale);
    this.maxArmor = this.armor = Math.round((def.armor ?? 0) * hpScale);
    this.damageMult = (1 + (this.level - 1) * 0.55) * (this.isElite ? 1.25 : 1);

    this.sizeScale = this.isElite ? 1.25 : 1;
    this.radius = def.radius * this.sizeScale;
    this.height = def.height * this.sizeScale;
    this.headY = (def.headY ?? def.height * 0.85) * this.sizeScale;
    this.headRadius = (def.headRadius ?? def.radius * 0.55) * this.sizeScale;
    this.knockbackResist = this.isBoss ? 1 : clamp01((def.knockbackResist ?? 0) + (this.isElite ? 0.3 : 0));
    this.displayName = (this.isElite ? '精英·' : '') + def.name;
    this.repathTimer = Math.random() * 0.3;
    this.losTimer = Math.random() * 0.25;
  }

  // ───────────── 子类接口 ─────────────

  protected abstract buildModel(): THREE.Object3D;
  protected abstract think(dt: number): void;
  /** 每帧程序动画（活着时） */
  protected animate(_dt: number): void {}
  protected onHurt(_result: DamageResult): void {}
  protected onDeath(_result: DamageResult): void {}
  protected onDispose(): void {}

  /** 死亡动画，t 从 0 到 1 */
  protected animateDeath(t: number): void {
    const e = t * t;
    this.model.rotation.x = -e * Math.PI * 0.5;
    this.model.position.y = -e * this.height * 0.4;
    const s = this.sizeScale * (1 - e * 0.6);
    this.model.scale.setScalar(Math.max(0.01, s));
  }

  /** 发射点（世界坐标）。默认头部前方 */
  getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    this.getHeadCenter(out);
    out.x += Math.sin(this.facing) * this.radius * 0.9;
    out.z += Math.cos(this.facing) * this.radius * 0.9;
    return out;
  }

  // ───────────── 生命周期 ─────────────

  /** 由 EnemyManager 在构造后立即调用 */
  init(): void {
    const m = this.buildModel();
    this.model.add(m);
    this.model.scale.setScalar(0.01);
    this.root.add(this.model);
    this.root.rotation.y = this.facing;

    // 为每个实例克隆材质，便于闪白 / 状态着色
    const cache = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const swap = (mat: THREE.Material): THREE.Material => {
        let c = cache.get(mat);
        if (!c) {
          c = mat.clone();
          cache.set(mat, c);
          this.clonedMats.push(c);
          const em = c as FlashMat['mat'];
          if (em.emissive && em.emissive.isColor) {
            this.flashMats.push({ mat: em, baseEmissive: em.emissive.clone(), baseIntensity: em.emissiveIntensity ?? 1 });
          }
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });

    if (this.isElite) this.addEliteAura();
    this.ctx.scene.add(this.root);
    this.ctx.fx.spawnEffect(this.position, this.def.color ?? 0xff4455);
    this.ctx.audio.play('enemy_spawn', { position: this.position, volume: 0.5 });
  }

  dispose(): void {
    this.onDispose();
    this.root.removeFromParent();
    for (const m of this.clonedMats) m.dispose();
    this.clonedMats.length = 0;
    this.flashMats.length = 0;
  }

  update(dt: number): void {
    this.age += dt;

    if (!this.alive) {
      this.deathTime += dt;
      const t = clamp01(this.deathTime / this.deathDuration);
      this.animateDeath(t);
      // 死亡时仍受重力（倒地）
      if (!this.flying || this.deathTime > 0.05) this.integrate(dt, true);
      if (t >= 1) this.removed = true;
      return;
    }

    this.updateFlash(dt);

    if (this.age < this.spawnDuration) {
      const t = this.age / this.spawnDuration;
      const e = 1 - Math.pow(1 - t, 3);
      this.model.scale.setScalar(Math.max(0.01, e * this.sizeScale));
      this.facePlayer(6, dt);
      this.root.rotation.y = this.facing;
      this.integrate(dt, false);
      return;
    }
    if (this.model.scale.x !== this.sizeScale && this.model.rotation.x === 0) this.model.scale.setScalar(this.sizeScale);

    this.desiredX = 0;
    this.desiredZ = 0;
    if (this.controlLoss > 0) this.controlLoss -= dt;

    if (this.stunTime > 0) {
      this.stunTime = Math.max(0, this.stunTime - dt);
    } else {
      this.think(dt);
    }

    this.integrate(dt, false);
    this.root.rotation.y = this.facing;
    this.animate(dt);

    // 掉出世界保护
    const arena = this.ctx.stage.arena;
    if (arena && this.position.y < arena.floorY - 12) {
      this.ctx.nav.nearestWalkable(arena.center, _v1);
      this.position.set(_v1.x, arena.floorY + 0.5, _v1.z);
      this.velocity.set(0, 0, 0);
    }
  }

  private integrate(dt: number, dead: boolean): void {
    const v = this.velocity;
    // 水平：朝期望速度加速
    if (!dead) {
      const control = this.controlLoss > 0 ? 0.15 : 1;
      const a = this.accel * control * (this.onGround || this.flying ? 1 : 0.35);
      const dx = this.desiredX - v.x;
      const dz = this.desiredZ - v.z;
      const len = Math.hypot(dx, dz);
      const step = a * dt;
      if (len <= step) {
        v.x = this.desiredX;
        v.z = this.desiredZ;
      } else {
        v.x += (dx / len) * step;
        v.z += (dz / len) * step;
      }
    } else {
      const f = Math.exp(-4 * dt);
      v.x *= f;
      v.z *= f;
    }

    if (this.flying && !dead) {
      let ty = this.flyTargetY;
      if (Number.isNaN(ty)) {
        const floor = this.ctx.stage.arena?.floorY ?? 0;
        ty = floor + this.hoverHeight;
      }
      const vy = clamp((ty - this.position.y) * 3, -this.def.speed * 1.5, this.def.speed * 1.5);
      v.y += (vy - v.y) * clamp01(6 * dt);
    } else {
      v.y -= GRAVITY * dt;
    }

    _v1.copy(v).multiplyScalar(dt);
    const r = this.ctx.world.moveBody(this.position, this.radius * 0.85, this.height, _v1, this.onGround, this.flying ? 0 : 0.55, this.moveResult);
    this.onGround = r.onGround;
    if (r.onGround && v.y < 0) v.y = 0;
    if (r.hitCeiling && v.y > 0) v.y = 0;
    if (r.hitWall && this.controlLoss > 0) {
      v.x *= 0.3;
      v.z *= 0.3;
    }
  }

  // ───────────── 受击 ─────────────

  onDamaged(result: DamageResult): void {
    this.lastHurtTime = this.ctx.time.now;
    this.flashTimer = 0.1;
    this.flashStrength = result.isCrit ? 1.6 : 1;
    this.onHurt(result);
  }

  onKilled(result: DamageResult): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = 0;
    this.stunTime = 0;
    const dir = result.request.direction;
    if (dir && !this.isBoss) {
      this.velocity.x += dir.x * 4;
      this.velocity.z += dir.z * 4;
      this.velocity.y = Math.max(this.velocity.y, 2.5);
    }
    this.setEmissive(new THREE.Color(0xffffff), 0.6);
    this.getBodyCenter(_v2);
    this.ctx.fx.deathEffect(_v2, this.def.color ?? 0xff4455, this.radius * 2);
    this.ctx.audio.play('enemy_death', { position: this.position });
    this.onDeath(result);
  }

  knockback(impulse: THREE.Vector3): void {
    if (!this.alive) return;
    const k = 1 - this.knockbackResist;
    if (k <= 0) return;
    this.velocity.addScaledVector(impulse, k);
    if (impulse.lengthSq() > 4) this.controlLoss = Math.max(this.controlLoss, 0.25 * k);
  }

  getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.headY, this.position.z);
  }

  getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.height * 0.5, this.position.z);
  }

  raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    this.getHeadCenter(_v3);
    const th = raySphere(origin, dir, _v3, this.headRadius);
    const r = this.radius;
    // 身体胶囊的最高点（线段顶 + 半球半径）压在头心下方 0.3 个头半径处，
    // 保证头部球的上 2/3 露在身体之外，平视也能打出爆头。
    const yMin = this.position.y + Math.min(r, this.height * 0.3);
    const yMax = Math.max(yMin, this.position.y + this.headY - this.headRadius * 0.3 - r);
    const tb = rayVerticalCapsule(origin, dir, this.position.x, this.position.z, yMin, yMax, r);
    let best = -1;
    let head = false;
    if (th >= 0 && th <= maxDist) {
      best = th;
      head = true;
    }
    // 头部优先：只有身体明显更近（例如从下方斜射先打到胸口）才算身体命中
    if (tb >= 0 && tb <= maxDist && (best < 0 || tb < best - this.headRadius * 0.5)) {
      best = tb;
      head = false;
    }
    if (best < 0) return false;
    out.distance = best;
    out.headshot = head;
    return true;
  }

  // ───────────── 视觉 ─────────────

  private updateFlash(dt: number): void {
    if (this.flashMats.length === 0) return;
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const k = Math.max(0, this.flashTimer / 0.1) * this.flashStrength;
      for (const f of this.flashMats) {
        f.mat.emissive.setRGB(1, 1, 1);
        f.mat.emissiveIntensity = 0.2 + k * 1.4;
      }
      return;
    }
    // 状态着色：取最高优先级的元素状态
    let tint: THREE.Color | null = null;
    for (const id of ['shock', 'burn', 'corrode'] as StatusId[]) {
      if (this.statuses.has(id)) {
        tint = STATUS_TINT[id] ?? null;
        break;
      }
    }
    if (tint) {
      const pulse = 0.35 + 0.25 * Math.sin(this.age * 14);
      for (const f of this.flashMats) {
        f.mat.emissive.copy(tint);
        f.mat.emissiveIntensity = pulse;
      }
    } else {
      for (const f of this.flashMats) {
        f.mat.emissive.copy(f.baseEmissive);
        f.mat.emissiveIntensity = f.baseIntensity;
      }
    }
  }

  protected setEmissive(color: THREE.Color, intensity: number): void {
    for (const f of this.flashMats) {
      f.mat.emissive.copy(color);
      f.mat.emissiveIntensity = intensity;
    }
  }

  private addEliteAura(): void {
    if (!eliteRingGeo) eliteRingGeo = new THREE.TorusGeometry(1, 0.06, 6, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.85, depthWrite: false });
    this.clonedMats.push(mat);
    const ring = new THREE.Mesh(eliteRingGeo, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    ring.scale.setScalar(this.def.radius * 1.6);
    this.model.add(ring);
  }

  // ───────────── AI 辅助 ─────────────

  protected get player() {
    return this.ctx.player;
  }

  /** 玩家胸口位置 */
  playerChest(out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player.position;
    return out.set(p.x, p.y + 1.15, p.z);
  }

  /** 水平距离（到玩家） */
  distToPlayerXZ(): number {
    const p = this.ctx.player.position;
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  /** 三维距离（身体中心到玩家胸口） */
  distToPlayer(): number {
    this.getBodyCenter(_v1);
    this.playerChest(_v2);
    return _v1.distanceTo(_v2);
  }

  /** 头部到玩家眼睛是否无遮挡（0.25 秒缓存） */
  canSeePlayer(): boolean {
    this.losTimer -= this.ctx.time.dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.2 + Math.random() * 0.1;
      this.getHeadCenter(_v1);
      this.losValue = !this.ctx.world.segmentBlocked(_v1, this.ctx.player.eye);
    }
    return this.losValue;
  }

  /** 直接设置期望水平移动（方向无需归一化） */
  protected setMove(dx: number, dz: number, speed: number): void {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) {
      this.desiredX = 0;
      this.desiredZ = 0;
      return;
    }
    const s = speed * this.slowMult;
    this.desiredX = (dx / len) * s;
    this.desiredZ = (dz / len) * s;
  }

  protected stopMoving(): void {
    this.desiredX = 0;
    this.desiredZ = 0;
  }

  /** 朝某点转身（角速度 rad/s） */
  protected faceTowards(p: THREE.Vector3, turnRate: number, dt: number): void {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.facing = rotateTowards(this.facing, Math.atan2(dx, dz), turnRate * dt);
  }

  protected facePlayer(turnRate: number, dt: number): void {
    this.faceTowards(this.ctx.player.position, turnRate, dt);
  }

  /** 朝移动方向转身 */
  protected faceMovement(turnRate: number, dt: number): void {
    if (Math.abs(this.desiredX) + Math.abs(this.desiredZ) < 0.01) return;
    this.facing = rotateTowards(this.facing, Math.atan2(this.desiredX, this.desiredZ), turnRate * dt);
  }

  /**
   * 移动到目标（地面单位走导航网格，飞行单位直线）。到达 arriveDist 内返回 true。
   */
  protected moveTo(target: THREE.Vector3, speed: number, arriveDist = 0.6): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= arriveDist) {
      this.stopMoving();
      return true;
    }
    if (this.flying) {
      this.setMove(dx, dz, speed);
      return false;
    }

    this.repathTimer -= this.ctx.time.dt;
    const targetMoved = this.pathTarget.distanceToSquared(target) > 2.5 * 2.5;
    if (this.repathTimer <= 0 || targetMoved || this.pathIndex >= this.path.length) {
      this.repathTimer = 0.45 + Math.random() * 0.35;
      this.pathTarget.copy(target);
      if (this.directPathClear(target)) {
        this.path.length = 0;
        this.path.push(_v3.copy(target).clone());
        this.pathIndex = 0;
      } else if (!this.ctx.nav.findPath(this.position, target, this.path)) {
        this.path.length = 0;
        this.path.push(target.clone());
      }
      this.pathIndex = 0;
    }

    let wp = this.path[this.pathIndex];
    while (wp && Math.hypot(wp.x - this.position.x, wp.z - this.position.z) < 0.7 && this.pathIndex < this.path.length - 1) {
      this.pathIndex++;
      wp = this.path[this.pathIndex];
    }
    if (!wp) {
      this.setMove(dx, dz, speed);
      return false;
    }
    this.setMove(wp.x - this.position.x, wp.z - this.position.z, speed);
    return false;
  }

  /**
   * 两点间直线是否可走：膝盖高度的中线、腰部高度的中线，以及膝盖高度左右各偏移 0.85 个半径的两条线都无遮挡。
   * 侧向射线避免大体型单位沿障碍物边缘「擦边」直走后卡在棱角上。
   */
  protected directPathClear(target: THREE.Vector3): boolean {
    const w = this.ctx.world;
    const knee = this.position.y + 0.6;
    _v1.set(this.position.x, knee, this.position.z);
    _v2.set(target.x, knee, target.z);
    if (w.segmentBlocked(_v1, _v2)) return false;
    // 侧向偏移
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      const off = this.radius * 0.85;
      const px = (-dz / len) * off;
      const pz = (dx / len) * off;
      for (const s of [1, -1]) {
        _v1.set(this.position.x + px * s, knee, this.position.z + pz * s);
        _v2.set(target.x + px * s, knee, target.z + pz * s);
        if (w.segmentBlocked(_v1, _v2)) return false;
      }
    }
    _v1.set(this.position.x, knee + this.height * 0.4, this.position.z);
    _v2.set(target.x, knee + this.height * 0.4, target.z);
    return !w.segmentBlocked(_v1, _v2);
  }

  /** 追击玩家，停在 stopDist 内 */
  protected chasePlayer(speed: number, stopDist = 1.2): boolean {
    if (this.distToPlayerXZ() <= stopDist) {
      this.stopMoving();
      return true;
    }
    return this.moveTo(this.ctx.player.position, speed, stopDist);
  }

  /**
   * 远程单位保持距离：太近后退，太远靠近，区间内横移（strafeSign = ±1）。
   */
  protected keepDistance(minD: number, maxD: number, speed: number, strafeSign: number): void {
    const p = this.ctx.player.position;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > maxD || !this.canSeePlayer()) {
      this.moveTo(p, speed, Math.min(maxD, 3));
    } else if (d < minD) {
      // 后退 + 一点横移
      this.setMove(-dx + -dz * 0.4 * strafeSign, -dz + dx * 0.4 * strafeSign, speed);
    } else {
      this.setMove(-dz * strafeSign, dx * strafeSign, speed * 0.6);
    }
  }

  /**
   * 发射敌方投射物，瞄准玩家胸口。lead 为预判系数（0~1），spread 为随机偏角（弧度）。
   * damage 会自动乘以 damageMult。
   */
  protected shoot(
    opts: { speed: number; damage: number; radius?: number; color?: number; gravity?: number; lifetime?: number; lead?: number; spread?: number; visual?: ProjectileSpec['visual']; explosionRadius?: number; homing?: number; element?: ProjectileSpec['element']; scale?: number; from?: THREE.Vector3; target?: THREE.Vector3 },
  ): void {
    const from = opts.from ? _v1.copy(opts.from) : this.getMuzzle(_v1);
    const target = opts.target ? _v2.copy(opts.target) : this.playerChest(_v2);
    const lead = opts.lead ?? 0;
    if (lead > 0 && !opts.target) {
      const t = from.distanceTo(target) / opts.speed;
      target.addScaledVector(this.ctx.player.velocity, t * lead);
    }
    const vel = _v3.subVectors(target, from).normalize();
    if (opts.spread && opts.spread > 0) {
      vel.x += (Math.random() - 0.5) * 2 * opts.spread;
      vel.y += (Math.random() - 0.5) * 2 * opts.spread;
      vel.z += (Math.random() - 0.5) * 2 * opts.spread;
      vel.normalize();
    }
    vel.multiplyScalar(opts.speed);
    if (opts.gravity) {
      // 抛物线补偿：让弹道大致落在目标
      const dist = Math.hypot(target.x - from.x, target.z - from.z);
      const t = dist / Math.max(1, Math.hypot(vel.x, vel.z));
      vel.y += 0.5 * opts.gravity * t;
    }
    this.ctx.projectiles.spawn({
      owner: 'enemy',
      position: from.clone(),
      velocity: vel.clone(),
      gravity: opts.gravity ?? 0,
      radius: opts.radius ?? 0.22,
      lifetime: opts.lifetime ?? 6,
      enemyDamage: opts.damage * this.damageMult,
      element: opts.element ?? 'none',
      color: opts.color ?? this.def.color ?? 0xff5533,
      visual: opts.visual ?? 'orb',
      explosionRadius: opts.explosionRadius,
      homing: opts.homing,
      scale: opts.scale,
      sourceEnemy: this,
    });
    this.ctx.audio.play('enemy_shot', { position: from, volume: 0.6 });
  }

  /**
   * 近战判定：玩家在 range（水平，含玩家半径）内且在前方 arcCos 夹角内则命中。damage 自动乘 damageMult。
   */
  protected melee(range: number, damage: number, arcCos = 0.2): boolean {
    const p = this.ctx.player.position;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > range + this.ctx.player.radius) return false;
    if (Math.abs(p.y - this.position.y) > this.height + 0.6) return false;
    if (d > 0.01) {
      const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
      if ((dx * fx + dz * fz) / d < arcCos) return false;
    }
    this.ctx.combat.damagePlayer(damage * this.damageMult, 'none', this, this.position);
    this.ctx.audio.play('enemy_melee', { position: this.position });
    return true;
  }
}

let eliteRingGeo: THREE.TorusGeometry | null = null;
