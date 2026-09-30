/**
 * 玩家控制器：第一人称运动（加速 / 摩擦 / 空中控制 / 土狼时间 / 跳跃缓冲 / 多段跳 / 滑翔 / 冲刺）、
 * 视角与后坐力回正、生命与护盾、英雄技能槽，以及相机表现（委托 CameraRig）。
 *
 * 约定：position 为脚底中心；eye = position + 1.62；yaw = 0 朝 −Z（见 core/math.ts dirFromYawPitch）。
 */
import * as THREE from 'three';
import type { Element, GameContext, HeroDef, IEnemy, IPlayer, SkillState } from '../core/types';
import { Stats } from '../core/Stats';
import { DEG, TAU, clamp, damp, dirFromYawPitch, lerp } from '../core/math';
import type { MoveResult } from '../world/Collision';
import { CameraRig, type RigInput } from './CameraRig';
import { SkillController } from './SkillController';

// ───────────────────────────── 运动常量 ─────────────────────────────

const EYE_HEIGHT = 1.62;
const RADIUS = 0.35;
const HEIGHT = 1.8;
const STEP_HEIGHT = 0.45;
const GRAVITY = 26;
const MAX_FALL_SPEED = 42;

/** 地面：有输入时朝目标速度的加速度 / 无输入时的刹车减速度（m/s²） */
const GROUND_ACCEL = 78;
const GROUND_FRICTION = 60;
/** 空中控制与空中阻力 */
const AIR_ACCEL = 20;
const AIR_DRAG = 1.2;
/** 超过最大速度（冲刺、击退、技能位移后）时逐渐回落的速度 */
const OVERSPEED_DECEL_GROUND = 24;
const OVERSPEED_DECEL_AIR = 3;
/** 被击退后短时间内地面摩擦降低，让击退有位移 */
const KNOCKBACK_FRICTION = 12;
const KNOCKBACK_TIME = 0.3;

const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const AIR_JUMP_MULT = 0.94;
/** 空中跳跃时水平速度向输入方向重定向的比例 */
const AIR_JUMP_REDIRECT = 0.65;

const GLIDE_FALL_SPEED = 2.4;
const GLIDE_GRAVITY_MULT = 0.3;
const GLIDE_AIR_ACCEL = 26;

const DASH_SPEED = 22;
const DASH_TIME = 0.18;
/** 冲刺结束后保留的速度（相对冲刺速度） */
const DASH_EXIT_KEEP = 0.45;
const DASH_IFRAMES = 0.12;
const DASH_LOCKOUT = 0.06;

const LOOK_SENS = 0.0022;
const PITCH_LIMIT = 89 * DEG;
/** 后坐力中会被自动回正的比例、开始回正前的延迟、回正速率 */
const RECOIL_RECOVER_FRACTION = 0.6;
const RECOIL_RECOVER_DELAY = 0.07;
const RECOIL_RECOVER_RATE = 9;

const LAND_EVENT_SPEED = 1.5;
const HURT_SOUND_INTERVAL = 0.22;
const LOW_HP_RATIO = 0.3;
const MIN_SHIELD_DELAY = 0.3;

const _delta = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class PlayerController implements IPlayer {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly eye = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  hp = 100;
  shield = 50;
  readonly stats = new Stats();
  readonly radius = RADIUS;
  readonly height = HEIGHT;
  invulnerableTime = 0;

  private _hero: HeroDef | null = null;
  private _alive = true;
  private _onGround = false;
  private _lastDamageTime = -999;
  private _isDashing = false;
  private _dashCharges = 1;
  private _dashCdRemaining = 0;

  // 运动状态
  private readonly moveResult: MoveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };
  private coyote = 0;
  private jumpBuffer = 0;
  private airJumpsLeft = 0;
  private dashTime = 0;
  private dashLockout = 0;
  private dashDirX = 0;
  private dashDirZ = -1;
  private knockbackTimer = 0;
  /** 本帧被外力抛起（applyImpulse 向上），不做贴地 */
  private forceAirborne = false;
  private strafeInput = 0;

  // 后坐力回正
  private recoilDebtPitch = 0;
  private recoilDebtYaw = 0;
  private lastRecoilTime = -999;

  // 生命 / 护盾
  private statsVersion = -1;
  private capHp = 100;
  private capShield = 50;
  private shieldRegenerating = false;
  private lastHurtSound = -999;
  private heartbeat = 0;
  private diedEmitted = false;

  private readonly rig: CameraRig;
  private readonly rigInput: RigInput = { speedH: 0, maxSpeed: 7.5, onGround: true, strafe: 0, dashing: false, alive: true };
  private readonly skillCtl: SkillController;

  constructor(readonly ctx: GameContext) {
    this.rig = new CameraRig(ctx);
    this.skillCtl = new SkillController(ctx, this.stats);
  }

  // ───────────── IPlayer 只读状态 ─────────────

  get hero(): HeroDef | null {
    return this._hero;
  }

  get alive(): boolean {
    return this._alive;
  }

  get onGround(): boolean {
    return this._onGround;
  }

  get lastDamageTime(): number {
    return this._lastDamageTime;
  }

  get isDashing(): boolean {
    return this._isDashing;
  }

  get dashCharges(): number {
    return this._dashCharges;
  }

  get dashCooldownRemaining(): number {
    return this._dashCdRemaining;
  }

  get skills(): { primary: SkillState | null; secondary: SkillState | null } {
    return this.skillCtl.states;
  }

  maxHp(): number {
    return Math.max(1, this.stats.get('maxHp'));
  }

  maxShield(): number {
    return Math.max(0, this.stats.get('maxShield'));
  }

  getAimDirection(out: THREE.Vector3): THREE.Vector3 {
    return dirFromYawPitch(this.yaw, this.pitch, out);
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return dirFromYawPitch(this.yaw, 0, out);
  }

  // ───────────── 生命周期 ─────────────

  init(): void {
    this.updateEye();
    this.rig.snap(this.ctx.camera, this.eye, this.yaw, this.pitch);
  }

  resetForRun(hero: HeroDef): void {
    this.skillCtl.teardown();
    this._hero = hero;
    this.stats.reset(hero.base);
    this.ctx.meta.applyTalents(this.stats);
    this.statsVersion = this.stats.version;
    this.capHp = this.maxHp();
    this.capShield = this.maxShield();
    this.hp = this.capHp;
    this.shield = this.capShield;

    this._alive = true;
    this.diedEmitted = false;
    this.invulnerableTime = 0;
    this._lastDamageTime = -999;
    this.shieldRegenerating = false;
    this.heartbeat = 0;
    this.lastHurtSound = -999;

    this.velocity.set(0, 0, 0);
    this._isDashing = false;
    this.dashTime = 0;
    this.dashLockout = 0;
    this._dashCharges = this.maxDashCharges();
    this._dashCdRemaining = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airJumpsLeft = this.maxAirJumps();
    this.knockbackTimer = 0;
    this.forceAirborne = false;
    this.recoilDebtPitch = 0;
    this.recoilDebtYaw = 0;
    this.pitch = 0;

    this.rig.reset();
    this.skillCtl.setup(hero);
  }

  update(dt: number): void {
    this.syncStatCaps();
    const acceptInput = this._alive && this.ctx.input.enabled;
    if (this.invulnerableTime > 0) this.invulnerableTime = Math.max(0, this.invulnerableTime - dt);

    if (acceptInput) this.updateLook();
    this.updateRecoil(dt);
    this.skillCtl.update(dt, acceptInput);
    this.updateMovement(dt, acceptInput);
    this.updateVitals(dt);
    this.checkOutOfWorld();
    this.updateCamera(dt);
  }

  // ───────────── 视角 / 后坐力 ─────────────

  private updateLook(): void {
    const input = this.ctx.input;
    const s = this.ctx.settings;
    const k = LOOK_SENS * (s.sensitivity > 0 ? s.sensitivity : 1);
    const dYaw = -input.mouseDX * k;
    const dPitch = -input.mouseDY * k * (s.invertY ? -1 : 1);
    if (dYaw === 0 && dPitch === 0) return;
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    // 玩家主动压枪时抵消待回正量，避免回正过头
    if (this.recoilDebtPitch > 0 && dPitch < 0) this.recoilDebtPitch = Math.max(0, this.recoilDebtPitch + dPitch);
    if (this.recoilDebtYaw !== 0 && Math.sign(dYaw) === -Math.sign(this.recoilDebtYaw)) {
      const r = this.recoilDebtYaw + dYaw;
      this.recoilDebtYaw = Math.sign(r) === Math.sign(this.recoilDebtYaw) ? r : 0;
    }
  }

  addRecoil(pitch: number, yaw: number): void {
    if (!this._alive) return;
    const before = this.pitch;
    this.pitch = clamp(this.pitch + pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw = wrapAngle(this.yaw + yaw);
    // 只记录实际生效的那部分（抬到极限时不再累计）
    this.recoilDebtPitch += (this.pitch - before) * RECOIL_RECOVER_FRACTION;
    this.recoilDebtYaw += yaw * RECOIL_RECOVER_FRACTION;
    this.lastRecoilTime = this.ctx.time.now;
  }

  private updateRecoil(dt: number): void {
    if (this.recoilDebtPitch === 0 && this.recoilDebtYaw === 0) return;
    if (this.ctx.time.now - this.lastRecoilTime < RECOIL_RECOVER_DELAY) return;
    const k = 1 - Math.exp(-RECOIL_RECOVER_RATE * dt);
    const dp = this.recoilDebtPitch * k;
    const dy = this.recoilDebtYaw * k;
    this.pitch = clamp(this.pitch - dp, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw = wrapAngle(this.yaw - dy);
    this.recoilDebtPitch -= dp;
    this.recoilDebtYaw -= dy;
    if (Math.abs(this.recoilDebtPitch) < 1e-5) this.recoilDebtPitch = 0;
    if (Math.abs(this.recoilDebtYaw) < 1e-5) this.recoilDebtYaw = 0;
  }

  // ───────────── 运动 ─────────────

  private maxDashCharges(): number {
    return Math.max(1, Math.round(this.stats.get('dashCharges')));
  }

  private maxAirJumps(): number {
    return Math.max(0, Math.round(this.stats.get('extraJumps')));
  }

  private updateMovement(dt: number, acceptInput: boolean): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const v = this.velocity;
    const maxSpeed = Math.max(1, this.stats.get('moveSpeed'));

    // 输入 → 世界方向。forward = (−sin yaw, 0, −cos yaw)，right = (cos yaw, 0, −sin yaw)
    let ix = 0;
    let iz = 0;
    if (acceptInput) {
      if (input.down('forward')) iz += 1;
      if (input.down('back')) iz -= 1;
      if (input.down('right')) ix += 1;
      if (input.down('left')) ix -= 1;
    }
    this.strafeInput = ix;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let wx = -sy * iz + cy * ix;
    let wz = -cy * iz - sy * ix;
    const wl = Math.hypot(wx, wz);
    const hasInput = wl > 1e-4;
    if (hasInput) {
      wx /= wl;
      wz /= wl;
    }

    // 计时器
    if (this.coyote > 0) this.coyote -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.dashLockout > 0) this.dashLockout -= dt;
    if (this.knockbackTimer > 0) this.knockbackTimer -= dt;
    const jumpPressed = acceptInput && input.pressed('jump');
    if (jumpPressed) this.jumpBuffer = JUMP_BUFFER;

    this.updateDashCharges(dt);

    // 冲刺开始
    if (acceptInput && input.pressed('dash') && this._dashCharges >= 1 && !this._isDashing && this.dashLockout <= 0) {
      this.startDash(hasInput ? wx : -sy, hasInput ? wz : -cy);
    }

    let jumped = false;
    if (this._isDashing) {
      this.dashTime -= dt;
      v.x = this.dashDirX * DASH_SPEED;
      v.z = this.dashDirZ * DASH_SPEED;
      v.y = 0;
      if (this.dashTime <= 0) this.endDash();
    } else {
      this.applyHorizontal(dt, maxSpeed, hasInput, wx, wz);
    }

    // 跳跃（可以打断冲刺，保留冲刺出口速度）
    if (this.jumpBuffer > 0) {
      const grounded = (this._onGround && !this.forceAirborne) || this.coyote > 0;
      if (grounded) {
        if (this._isDashing) this.endDash();
        this.doJump(false, hasInput, wx, wz, maxSpeed);
        jumped = true;
      } else if (jumpPressed && this.airJumpsLeft > 0) {
        if (this._isDashing) this.endDash();
        this.doJump(true, hasInput, wx, wz, maxSpeed);
        jumped = true;
      }
    }

    // 重力 / 滑翔
    const gliding = !this._isDashing && !this._onGround && !jumped && v.y < 0 &&
      (ctx.run.flags.glide ?? 0) > 0 && acceptInput && input.down('jump');
    if (!this._isDashing) {
      v.y -= GRAVITY * (gliding ? GLIDE_GRAVITY_MULT : 1) * dt;
      if (gliding && v.y < -GLIDE_FALL_SPEED) v.y = damp(v.y, -GLIDE_FALL_SPEED, 9, dt);
      if (v.y < -MAX_FALL_SPEED) v.y = -MAX_FALL_SPEED;
    }
    if (gliding && hasInput) {
      // 滑翔时略增强空中控制
      this.approachHorizontal(wx * maxSpeed, wz * maxSpeed, (GLIDE_AIR_ACCEL - AIR_ACCEL) * dt);
    }

    // 碰撞求解
    const prevVy = v.y;
    const wasGrounded = this._onGround && !this.forceAirborne && !jumped && v.y <= 0;
    _delta.copy(v).multiplyScalar(dt);
    const r = ctx.world.moveBody(this.position, RADIUS, HEIGHT, _delta, wasGrounded, STEP_HEIGHT, this.moveResult);
    const wasOnGround = this._onGround;
    this._onGround = r.onGround;
    this.forceAirborne = false;
    if (r.onGround && v.y < 0) v.y = 0;
    if (r.hitCeiling && v.y > 0) v.y = 0;
    if (r.hitWall) {
      // 沿墙滑动：去掉指向墙内的速度分量
      const n = r.wallNormal;
      const vn = v.x * n.x + v.z * n.z;
      if (vn < 0) {
        v.x -= n.x * vn;
        v.z -= n.z * vn;
      }
    }

    if (this._onGround) {
      this.coyote = COYOTE_TIME;
      this.airJumpsLeft = this.maxAirJumps();
      if (!wasOnGround) this.onLand(Math.max(0, -prevVy));
    }
  }

  /** 水平速度：地面高加速 + 强摩擦（跟手），空中有限控制；超速时平滑回落以保留冲刺惯性 */
  private applyHorizontal(dt: number, maxSpeed: number, hasInput: boolean, wx: number, wz: number): void {
    const v = this.velocity;
    const onG = this._onGround && !this.forceAirborne;
    const speedH = Math.hypot(v.x, v.z);
    let wishSpeed = maxSpeed;
    if (speedH > maxSpeed) wishSpeed = Math.max(maxSpeed, speedH - (onG ? OVERSPEED_DECEL_GROUND : OVERSPEED_DECEL_AIR) * dt);

    let rate: number;
    let tx = 0;
    let tz = 0;
    if (hasInput) {
      tx = wx * wishSpeed;
      tz = wz * wishSpeed;
      rate = onG ? GROUND_ACCEL : AIR_ACCEL;
    } else if (onG) {
      rate = GROUND_FRICTION;
    } else {
      rate = AIR_DRAG;
    }
    if (onG && this.knockbackTimer > 0) rate = Math.min(rate, KNOCKBACK_FRICTION);
    this.approachHorizontal(tx, tz, rate * dt);
  }

  private approachHorizontal(tx: number, tz: number, maxStep: number): void {
    const v = this.velocity;
    const dx = tx - v.x;
    const dz = tz - v.z;
    const len = Math.hypot(dx, dz);
    if (len <= maxStep || len < 1e-6) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (dx / len) * maxStep;
      v.z += (dz / len) * maxStep;
    }
  }

  private doJump(air: boolean, hasInput: boolean, wx: number, wz: number, maxSpeed: number): void {
    const ctx = this.ctx;
    const v = this.velocity;
    const jv = Math.max(0, this.stats.get('jumpVelocity'));
    v.y = air ? jv * AIR_JUMP_MULT : jv;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this._onGround = false;
    if (air) {
      this.airJumpsLeft--;
      if (hasInput) {
        // 二段跳可以改变方向
        const sp = Math.max(maxSpeed, Math.hypot(v.x, v.z) * 0.9);
        v.x = lerp(v.x, wx * sp, AIR_JUMP_REDIRECT);
        v.z = lerp(v.z, wz * sp, AIR_JUMP_REDIRECT);
      }
      const color = this._hero?.color ?? 0xffffff;
      _tmp.set(this.position.x, this.position.y + 0.05, this.position.z);
      ctx.fx.ring(_tmp, 1.3, color, 0.3);
      ctx.fx.burst(_tmp, color, 10, 3, 0.35, 0.06, 2);
    }
    ctx.events.emit('player:jumped', {});
    ctx.audio.play('jump', { volume: air ? 0.8 : 0.7, pitch: air ? 1.2 : 0.95 + Math.random() * 0.1 });
  }

  private onLand(fallSpeed: number): void {
    if (fallSpeed < LAND_EVENT_SPEED) return;
    this.ctx.events.emit('player:landed', { fallSpeed });
    this.ctx.audio.play('land', { volume: clamp(0.25 + fallSpeed / 16, 0.25, 1), pitch: clamp(1.15 - fallSpeed / 60, 0.8, 1.15) });
    this.rig.land(fallSpeed);
    if (fallSpeed > 14) this.ctx.fx.shake(Math.min(0.5, (fallSpeed - 14) * 0.04), 0.18);
  }

  private updateDashCharges(dt: number): void {
    const max = this.maxDashCharges();
    if (this._dashCharges > max) this._dashCharges = max;
    if (this._dashCharges >= max) {
      this._dashCdRemaining = 0;
      return;
    }
    const cd = Math.max(0.2, this.stats.get('dashCooldown'));
    if (this._dashCdRemaining <= 0) this._dashCdRemaining = cd;
    this._dashCdRemaining -= dt;
    while (this._dashCdRemaining <= 0 && this._dashCharges < max) {
      this._dashCharges++;
      if (this._dashCharges < max) this._dashCdRemaining += cd;
      else this._dashCdRemaining = 0;
    }
  }

  private startDash(dx: number, dz: number): void {
    const ctx = this.ctx;
    const wasFull = this._dashCharges >= this.maxDashCharges();
    this._dashCharges--;
    if (wasFull || this._dashCdRemaining <= 0) this._dashCdRemaining = Math.max(0.2, this.stats.get('dashCooldown'));
    const l = Math.hypot(dx, dz) || 1;
    this.dashDirX = dx / l;
    this.dashDirZ = dz / l;
    this._isDashing = true;
    this.dashTime = DASH_TIME;
    this.invulnerableTime = Math.max(this.invulnerableTime, DASH_IFRAMES);
    this.rig.dashKick();
    ctx.events.emit('player:dashed', {});
    ctx.audio.play('dash', { volume: 0.8, pitch: 0.95 + Math.random() * 0.1 });
    // 身后扬起的气流
    _tmp.set(this.position.x - this.dashDirX * 0.6, this.position.y + 0.9, this.position.z - this.dashDirZ * 0.6);
    ctx.fx.burst(_tmp, 0xe8f2ff, 8, 2.5, 0.3, 0.05, 0);
  }

  private endDash(): void {
    if (!this._isDashing) return;
    this._isDashing = false;
    this.dashTime = 0;
    this.dashLockout = DASH_LOCKOUT;
    const keep = DASH_SPEED * DASH_EXIT_KEEP;
    this.velocity.x = this.dashDirX * keep;
    this.velocity.z = this.dashDirZ * keep;
  }

  applyImpulse(v: THREE.Vector3): void {
    this.velocity.add(v);
    if (v.y > 0.5) {
      this._onGround = false;
      this.forceAirborne = true;
      this.coyote = 0;
    }
    if (v.x * v.x + v.z * v.z > 9) this.knockbackTimer = KNOCKBACK_TIME;
  }

  teleport(pos: THREE.Vector3, yaw?: number): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) {
      this.yaw = wrapAngle(yaw);
      this.pitch = 0;
    }
    if (this._isDashing) {
      this._isDashing = false;
      this.dashTime = 0;
    }
    this.recoilDebtPitch = 0;
    this.recoilDebtYaw = 0;
    this.jumpBuffer = 0;
    this.forceAirborne = false;
    this.knockbackTimer = 0;
    // 贴地判定，避免出生时误触发落地
    const gy = this.ctx.world.groundHeight(pos.x, pos.z, pos.y + 0.05, RADIUS - 0.01);
    this._onGround = gy > -Infinity && pos.y - gy < 0.08;
    if (this._onGround) this.position.y = Math.max(this.position.y, gy + 1e-4);
    this.coyote = this._onGround ? COYOTE_TIME : 0;
    this.updateEye();
    this.rig.snap(this.ctx.camera, this.eye, this.yaw, this.pitch);
  }

  private checkOutOfWorld(): void {
    const arena = this.ctx.stage.arena;
    const floorY = arena?.floorY ?? 0;
    if (this.position.y > floorY - 25) return;
    if (arena) this.teleport(arena.playerSpawn, arena.playerYaw);
    else this.teleport(_tmp.set(0, floorY + 1, 0));
  }

  // ───────────── 生命 / 护盾 ─────────────

  /** 属性变化时：上限提高则当前值同步增加增量，降低则钳制 */
  private syncStatCaps(): void {
    if (this.stats.version === this.statsVersion) return;
    this.statsVersion = this.stats.version;
    const mh = this.maxHp();
    const ms = this.maxShield();
    if (mh > this.capHp && this._alive) this.hp += mh - this.capHp;
    if (ms > this.capShield && this._alive) this.shield += ms - this.capShield;
    this.hp = Math.min(this.hp, mh);
    this.shield = Math.min(this.shield, ms);
    this.capHp = mh;
    this.capShield = ms;
  }

  takeDamage(amount: number, element: Element, source: IEnemy | null, from?: THREE.Vector3 | null): number {
    if (!this._alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
    if (this.invulnerableTime > 0) return 0;
    this.syncStatCaps();
    const ctx = this.ctx;
    const now = ctx.time.now;

    const hadShield = this.shield > 0;
    const toShield = Math.min(this.shield, amount);
    this.shield -= toShield;
    if (this.shield < 1e-3) this.shield = 0;
    const toHp = Math.min(this.hp, amount - toShield);
    this.hp -= toHp;
    const dealt = toShield + toHp;
    this._lastDamageTime = now;
    this.shieldRegenerating = false;

    const src = from ?? source?.position ?? null;
    const fromPos = src ? new THREE.Vector3().copy(src) : null;
    ctx.events.emit('player:damaged', { amount: dealt, toShield, toHp, element, source, from: fromPos });

    if (now - this.lastHurtSound >= HURT_SOUND_INTERVAL) {
      this.lastHurtSound = now;
      ctx.audio.play('player_hurt', { volume: clamp(0.45 + dealt / 40, 0.45, 1), pitch: toHp > 0 ? 1 : 1.15 });
    }
    let side = 0;
    if (fromPos) side = (fromPos.x - this.position.x) * Math.cos(this.yaw) - (fromPos.z - this.position.z) * Math.sin(this.yaw);
    this.rig.hurt((dealt / this.maxHp()) * 4, side);

    if (hadShield && this.shield <= 0) {
      ctx.events.emit('player:shieldBroken', {});
      ctx.audio.play('shield_break', { volume: 0.9 });
      ctx.fx.shake(0.25, 0.2);
    }
    if (this.hp <= 1e-3) this.die();
    return dealt;
  }

  private die(): void {
    if (!this._alive) return;
    this._alive = false;
    this.hp = 0;
    this._isDashing = false;
    this.dashTime = 0;
    this.recoilDebtPitch = 0;
    this.recoilDebtYaw = 0;
    if (!this.diedEmitted) {
      this.diedEmitted = true;
      this.ctx.events.emit('player:died', {});
    }
  }

  heal(amount: number): number {
    if (!this._alive || !(amount > 0)) return 0;
    this.syncStatCaps();
    const actual = Math.min(this.maxHp() - this.hp, amount);
    if (actual <= 0) return 0;
    this.hp += actual;
    this.ctx.events.emit('player:healed', { amount: actual });
    return actual;
  }

  addShield(amount: number): number {
    if (!this._alive || !(amount > 0)) return 0;
    this.syncStatCaps();
    const actual = Math.min(this.maxShield() - this.shield, amount);
    if (actual <= 0) return 0;
    this.shield += actual;
    this.ctx.events.emit('player:healed', { amount: actual });
    return actual;
  }

  private updateVitals(dt: number): void {
    if (!this._alive) return;
    const ctx = this.ctx;
    const now = ctx.time.now;
    const maxHp = this.maxHp();
    const maxShield = this.maxShield();

    // 护盾：未受伤 shieldRegenDelay 秒后开始恢复（开始时播一次音效）
    const delay = Math.max(MIN_SHIELD_DELAY, this.stats.get('shieldRegenDelay'));
    if (this.shield < maxShield) {
      if (now - this._lastDamageTime >= delay) {
        if (!this.shieldRegenerating) {
          this.shieldRegenerating = true;
          ctx.audio.play('shield_recharge', { volume: 0.6 });
        }
        this.shield = Math.min(maxShield, this.shield + Math.max(0, this.stats.get('shieldRegenRate')) * dt);
      }
    } else {
      this.shieldRegenerating = false;
    }

    // 生命恢复
    const regen = this.stats.get('hpRegen');
    if (regen > 0 && this.hp < maxHp) this.hp = Math.min(maxHp, this.hp + regen * dt);

    // 低血量心跳：血越少越急
    const ratio = this.hp / maxHp;
    if (ratio < LOW_HP_RATIO) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        const t = ratio / LOW_HP_RATIO;
        ctx.audio.play('low_hp', { volume: lerp(1, 0.55, t) });
        this.heartbeat = lerp(0.55, 1.0, t);
      }
    } else {
      this.heartbeat = 0;
    }
  }

  // ───────────── 技能 ─────────────

  reduceCooldowns(seconds: number, slot: 'primary' | 'secondary' | 'both' = 'both'): void {
    this.skillCtl.reduce(seconds, slot);
  }

  // ───────────── 相机 ─────────────

  private updateEye(): void {
    this.eye.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
  }

  private updateCamera(dt: number): void {
    this.updateEye();
    const ri = this.rigInput;
    ri.speedH = Math.hypot(this.velocity.x, this.velocity.z);
    ri.maxSpeed = Math.max(1, this.stats.get('moveSpeed'));
    ri.onGround = this._onGround;
    ri.strafe = this.strafeInput;
    ri.dashing = this._isDashing;
    ri.alive = this._alive;
    const stepped = this.rig.update(dt, ri, this.ctx.camera, this.eye, this.yaw, this.pitch);
    if (stepped) {
      const run = clamp(ri.speedH / ri.maxSpeed, 0.4, 1.3);
      this.ctx.audio.play('footstep', { volume: 0.35 + 0.25 * run, pitch: 0.9 + Math.random() * 0.2 });
    }
  }
}

/** 把角度规约到 (−π, π] */
function wrapAngle(a: number): number {
  if (a > Math.PI || a <= -Math.PI) a -= TAU * Math.floor((a + Math.PI) / TAU);
  return a;
}
