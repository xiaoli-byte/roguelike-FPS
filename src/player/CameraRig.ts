/**
 * 第一人称镜头表现：行走晃动（并给出步点）、侧移倾斜、落地下沉、受击抖动与镜头冲击（斩击命中）、
 * 屏幕震动（读取并衰减 ctx.cameraFx）、FOV（设置 + 武器开镜 + 冲刺 / 高速）、死亡倒地。
 * 只影响相机，不影响玩法用的 eye 与瞄准方向。
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';
import { clamp, clamp01, damp } from '../core/math';

/** 控制器每帧交给镜头的运动状态（复用同一个对象） */
export interface RigInput {
  speedH: number;
  maxSpeed: number;
  onGround: boolean;
  /** 本地横移输入 -1..1（右为正） */
  strafe: number;
  dashing: boolean;
  alive: boolean;
}

/** 每步行进距离（米），决定晃动与脚步声频率 */
const STEP_LENGTH = 2.05;
const BOB_VERTICAL = 0.045;
const BOB_SIDE = 0.032;
const BOB_ROLL = 0.006;
const STRAFE_ROLL = 0.014;

/** 阻尼弹簧参数（落地下沉 / 受击） */
const SPRING_K = 140;
const SPRING_C = 17;

const DASH_FOV = 6;
const SPEED_FOV_MAX = 6;
/** 冲刺 + 高速带来的 FOV 增量合计上限（度） */
const EXTRA_FOV_MAX = 8;
/** 开镜放大到这么多度（fovKick ≤ −此值）时完全取消冲刺 / 高速 FOV */
const AIM_SUPPRESS_KICK = 8;
const FOV_LAMBDA = 16;

/**
 * 屏幕震动：cameraFx.shakeIntensity 为 0..1 的相对强度（1 = 很强；fx.shake 单次写入上限 1.5，这里同样钳在 1.5）。
 * 强度为 1 时：位移约 ±5 厘米、俯仰约 ±1°、偏航约 ±0.8°、横滚约 ±1.1°。
 * 只作用于渲染相机，不影响 eye 与瞄准方向，所以旋转分量保持克制，避免准星与弹道明显错位。
 */
const SHAKE_MAX = 1.5;
/** 强度每秒按 e^(−rate·t) 衰减；shakeTime 的最后 SHAKE_FADE 秒线性淡出 */
const SHAKE_DECAY = 2.5;
const SHAKE_FADE = 0.12;

const DEATH_TIME = 0.7;

export class CameraRig {
  private bobPhase = 0;
  private bobWeight = 0;
  private strafeRoll = 0;
  private dip = 0;
  private dipVel = 0;
  private punchPitch = 0;
  private punchPitchVel = 0;
  private punchRoll = 0;
  private punchRollVel = 0;
  private dashFov = 0;
  private speedFov = 0;
  private fov = NaN;
  private shakeClock = 0;
  private deathT = 0;

  constructor(private readonly ctx: GameContext) {}

  reset(): void {
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.strafeRoll = 0;
    this.dip = this.dipVel = 0;
    this.punchPitch = this.punchPitchVel = 0;
    this.punchRoll = this.punchRollVel = 0;
    this.dashFov = 0;
    this.speedFov = 0;
    this.fov = NaN;
    this.deathT = 0;
  }

  /** 传送 / 换关：清掉残留的弹簧位移与冲刺 FOV（不影响死亡倒地与晃动相位） */
  calm(): void {
    this.dip = this.dipVel = 0;
    this.punchPitch = this.punchPitchVel = 0;
    this.punchRoll = this.punchRollVel = 0;
    this.dashFov = 0;
    this.speedFov = 0;
  }

  /** 落地：按下落速度下沉 */
  land(fallSpeed: number): void {
    this.dipVel -= clamp(fallSpeed, 0, 22) * 0.28;
  }

  /** 受击：strength 0..1，side >0 表示伤害来自右侧 */
  hurt(strength: number, side: number): void {
    const s = clamp(strength, 0.15, 1);
    // 头部被打向远离伤害来源的一侧；无方向时随机
    const dir = side === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side);
    this.punchRollVel += dir * 1.1 * s;
    this.punchPitchVel += 0.6 * s;
  }

  /** 镜头冲击（斩击命中等）：直接给受击弹簧角速度冲量（弧度/秒），自然回弹 */
  punch(roll: number, pitch: number): void {
    if (Number.isFinite(roll)) this.punchRollVel += roll;
    if (Number.isFinite(pitch)) this.punchPitchVel += pitch;
  }

  dashKick(): void {
    this.dashFov = DASH_FOV;
  }

  /** 直接把相机放到 eye（传送 / 读关时），不带任何偏移 */
  snap(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, yaw: number, pitch: number): void {
    camera.position.copy(eye);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  /**
   * 更新并写入相机。返回本帧是否踩下一步（用于脚步声）。
   */
  update(dt: number, s: RigInput, camera: THREE.PerspectiveCamera, eye: THREE.Vector3, yaw: number, pitch: number): boolean {
    const ctx = this.ctx;

    // ── 行走晃动 ──
    const walking = s.onGround && s.alive && !s.dashing && s.speedH > 0.8;
    this.bobWeight = damp(this.bobWeight, walking ? clamp01(s.speedH / Math.max(1, s.maxSpeed)) : 0, 10, dt);
    let stepped = false;
    if (walking) {
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += ((s.speedH * dt) / STEP_LENGTH) * Math.PI;
      if (Math.floor(this.bobPhase / Math.PI) !== before) stepped = true;
      if (this.bobPhase > 200 * Math.PI) this.bobPhase -= 200 * Math.PI;
    }
    const bw = this.bobWeight;
    const bobY = -Math.cos(this.bobPhase * 2) * 0.5 * BOB_VERTICAL * bw;
    const swayX = Math.sin(this.bobPhase) * BOB_SIDE * bw;
    const bobRoll = Math.sin(this.bobPhase) * BOB_ROLL * bw;

    // ── 侧移倾斜 ──
    this.strafeRoll = damp(this.strafeRoll, s.alive ? -s.strafe * STRAFE_ROLL * (s.onGround ? 1 : 0.6) : 0, 8, dt);

    // ── 弹簧：落地下沉 / 受击 ──
    this.dipVel += (-this.dip * SPRING_K - this.dipVel * SPRING_C) * dt;
    this.dip += this.dipVel * dt;
    this.punchPitchVel += (-this.punchPitch * SPRING_K - this.punchPitchVel * SPRING_C) * dt;
    this.punchPitch += this.punchPitchVel * dt;
    this.punchRollVel += (-this.punchRoll * SPRING_K - this.punchRollVel * SPRING_C) * dt;
    this.punchRoll += this.punchRollVel * dt;

    // ── 屏幕震动（fx 写入强度与时长，这里读取并衰减） ──
    const fx = ctx.cameraFx;
    let amp = 0;
    if (fx.shakeTime > 0 && fx.shakeIntensity > 0 && Number.isFinite(fx.shakeIntensity) && Number.isFinite(fx.shakeTime)) {
      fx.shakeTime = Math.max(0, fx.shakeTime - dt);
      fx.shakeIntensity *= Math.exp(-SHAKE_DECAY * dt);
      amp = Math.min(SHAKE_MAX, fx.shakeIntensity) * Math.min(1, fx.shakeTime / SHAKE_FADE);
      if (fx.shakeTime <= 0) fx.shakeIntensity = 0;
    } else {
      fx.shakeTime = 0;
      fx.shakeIntensity = 0;
    }
    this.shakeClock += dt;
    const c = this.shakeClock;
    let shX = 0, shY = 0, shZ = 0, shPitch = 0, shYaw = 0, shRoll = 0;
    if (amp > 0) {
      shX = (Math.sin(c * 53.1) * 0.6 + Math.sin(c * 97.3 + 1.7) * 0.4) * amp * 0.05;
      shY = (Math.sin(c * 61.7 + 0.4) * 0.6 + Math.sin(c * 89.9 + 2.3) * 0.4) * amp * 0.05;
      shZ = Math.sin(c * 71.3 + 3.1) * amp * 0.02;
      shPitch = (Math.sin(c * 47.9 + 0.9) * 0.7 + Math.sin(c * 83.1) * 0.3) * amp * 0.018;
      shYaw = (Math.sin(c * 43.3 + 2.2) * 0.7 + Math.sin(c * 77.7 + 0.3) * 0.3) * amp * 0.014;
      shRoll = Math.sin(c * 38.9 + 1.1) * amp * 0.02;
    }

    // ── 死亡倒地 ──
    if (!s.alive) this.deathT = Math.min(1, this.deathT + dt / DEATH_TIME);
    const de = 1 - Math.pow(1 - this.deathT, 3);

    // ── 写入相机 ──
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    camera.position.set(
      eye.x + cy * swayX + shX,
      eye.y + bobY + this.dip - de * 1.1 + shY,
      eye.z - sy * swayX + shZ,
    );
    camera.rotation.set(
      pitch + this.dip * 0.35 + this.punchPitch + shPitch - de * 0.2,
      yaw + shYaw,
      bobRoll + this.strafeRoll + this.punchRoll + shRoll + de * 0.5,
      'YXZ',
    );

    // ── FOV ──
    this.dashFov = damp(this.dashFov, 0, 5, dt);
    // 冲刺本身已有 dashFov 冲击，冲刺中不再叠加高速 FOV
    const speedTarget = s.alive && !s.dashing ? clamp((s.speedH - s.maxSpeed * 1.08) * 0.55, 0, SPEED_FOV_MAX) : 0;
    this.speedFov = damp(this.speedFov, speedTarget, 6, dt);
    const kick = Number.isFinite(fx.fovKick) ? fx.fovKick : 0;
    // 开镜（fovKick < 0）时压掉冲刺 / 高速带来的视野变宽，避免狙击镜里画面「呼吸」
    const aimK = kick < 0 ? clamp01(1 + kick / AIM_SUPPRESS_KICK) : 1;
    const extra = Math.min(EXTRA_FOV_MAX, this.dashFov + this.speedFov) * aimK;
    const baseFov = Number.isFinite(ctx.settings.fov) ? ctx.settings.fov : 80;
    const target = clamp(baseFov + kick + extra, 20, 130);
    this.fov = Number.isNaN(this.fov) ? target : damp(this.fov, target, FOV_LAMBDA, dt);
    if (Math.abs(camera.fov - this.fov) > 0.005) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    return stepped;
  }
}
