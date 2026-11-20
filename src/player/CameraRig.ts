/**
 * 第一人称镜头手感（Unity Player/CameraFeel.cs，渲染相机姿态与 FOV 的唯一写入方）。只影响相机，不影响玩法用的 eye 与瞄准方向。
 * 每帧叠加：
 *   · 行走晃动：每 2.05 m 一步、踩下去正好在最低点（返回步点给脚步声）；竖直 4.5 cm、侧摆 3.2 cm、横滚 0.34°，按 速度 / 移速 加权，开镜时收到 35%；
 *   · 侧移倾斜：横向速度 / 移速 × 0.8°（空中 × 0.6、开镜 × 0.5），往移动方向歪；
 *   · 弹簧（K 140 / C 17，1/120 s 子步积分；给初速度 v 约 0.093 s 到峰、峰值 ≈ v × 0.0382）：
 *     落地下沉（下落速度 ≤ 22 m/s × 0.28 的向下初速度，俯仰跟着点头 0.35 rad/m）、受击冲击（impact：头被打向远离来源的一侧、
 *     正面来的往上仰、背后来的往前点，再被推开约 2.5 cm）、punch（斩击命中、技能落地）、开枪的向后一顿（fireKick）；
 *   · 震屏：CameraShake 的 trauma²（开头猛、收尾柔）× 设置「震屏强度」，6 轴噪声（位移 5.5 / 5.5 / 2.5 cm、俯仰 / 偏航 / 横滚 2.0° / 1.6° / 2.4°，
 *     位移 20 Hz、转角 16 Hz），幅度上限 1.8；噪声零均值，不会让弹道系统性偏；
 *   · 阵亡倒地：0.8 s（真实时间，不随阵亡慢动作变慢）下沉到离地约 0.45 m（先往下探地面）、低头 ≤ 11°（本来就在往下看时少低一点）、
 *     向左歪 29°；复活时 0.35 s 回来。
 * 自带的震屏 / 冲击也由这里接：落地 > 14 m/s 再震、一下 ≥ 8% 生命上限的重击再震、元素反应按距离震（20 m 外没有，连锁减半）、首领倒下长震。
 * FOV = 设置「视野」+ 开镜层（ctx.cameraFx.fovKick，负数 = 放大）+ 冲刺 6° / 高速（超过移速 8% 起每 m/s 0.55°，最多 6°），
 * 冲刺 + 高速合计 ≤ 8°，开镜时按放大程度压掉；整体 λ 16 平滑。
 * 旧震屏通道 ctx.cameraFx.shakeIntensity / shakeTime 照旧由 fx.shake 写、这里衰减（首领登场演出读它），画面只用 CameraShake。
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { DEG, clamp, clamp01, damp } from '../core/math';
import { CameraShake } from './CameraShake';

/** 控制器每帧交给镜头的运动状态（复用同一个对象） */
export interface RigInput {
  speedH: number;
  maxSpeed: number;
  onGround: boolean;
  /** 横向速度（世界速度在视线右方向上的分量，m/s） */
  strafeSpeed: number;
  dashing: boolean;
  alive: boolean;
  /** 开镜程度 0..1 */
  aimT: number;
}

// ── 常数（Unity CameraFeel；角度换成弧度：Unity 俯仰 + = 低头，网页 + = 抬头；横滚两边同向）──
export const RIG = {
  StepLength: 2.05,
  BobVertical: 0.045,
  BobSide: 0.032,
  BobRoll: 0.006,
  StrafeRoll: 0.014,
  SpringK: 140,
  SpringC: 17,
  /** K 140 / C 17 的弹簧：给初速度 v，约 0.093 s 后到峰，峰值 ≈ v × 0.0382 */
  PeakPerVelocity: 0.0382,
  /** 落地：下落速度（≤ 22 m/s）× 0.28 = 向下初速度；俯仰跟着下沉点头（0.35 rad / m） */
  LandImpulse: 0.28,
  DipPitch: 0.35,
  /** 受击（强度 1）：横滚 1.1 rad/s、俯仰 0.6 rad/s，再被推开约 2.5 cm */
  HurtRoll: 1.1,
  HurtPitch: 0.6,
  HurtPush: 0.025 / 0.0382,
  /** 开枪：头沿视线向后一顿 = 枪模后坐距离 × 0.25 */
  FireBack: 0.25 / 0.0382,
  DashFov: 6,
  SpeedFovMax: 6,
  ExtraFovMax: 8,
  AimSuppressKick: 8,
  FovLambda: 16,
  DeathTime: 0.8,
  ReviveTime: 0.35,
  DeathDrop: 1.1,
  DeathPitch: 0.2,
  DeathRoll: 0.5,
  /** 震屏强度 1 时各轴的标称幅度：位移（米）、转角（度） */
  ShakePos: [0.055, 0.055, 0.025] as const,
  ShakeRot: [2.0, 1.6, 2.4] as const,
  ShakePosFreq: 20,
  ShakeRotFreq: 16,
  /** 弹簧子步长：卡顿时 dt 可能到 0.1 s，显式积分会发散 */
  SpringStep: 1 / 120,
  /** 重落地再震（同 Three.js onLand） */
  HeavyLandSpeed: 14,
  /** 重击：一下 ≥ 生命上限的这么多再震 */
  HeavyHitFraction: 0.08,
} as const;

/** 元素反应的震屏强度（Unity CameraFeel.OnReacted） */
export function reactionShake(id: string, depth: number): number {
  const s = id === 'thunderfire' ? 0.3 : id === 'abyss' ? 0.26 : id === 'meltdown' ? 0.22 : 0.16;
  return depth > 0 ? s * 0.5 : s;
}

/** 弹簧一步（显式欧拉，同 Unity CameraFeel.Spring） */
export function springStep(x: number, v: number, h: number): [number, number] {
  v += (-x * RIG.SpringK - v * RIG.SpringC) * h;
  x += v * h;
  return [x, v];
}

/** 一维梯度噪声（Perlin 风格，−1..1，零均值）：seed 区分通道 */
export function noise1(seed: number, t: number): number {
  const x = t + seed * 17.13;
  const i = Math.floor(x);
  const f = x - i;
  const g0 = grad(i, seed), g1 = grad(i + 1, seed);
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  // 梯度噪声在整数格点为 0；× 2 让幅度大致落在 ±1
  return ((1 - u) * g0 * f + u * g1 * (f - 1)) * 2;
}

function grad(i: number, seed: number): number {
  let h = Math.imul(i ^ Math.imul(seed | 0, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _sh = new THREE.Vector3();

export class CameraRig {
  private bobPhase = 0;
  private bobWeight = 0;
  private strafeRoll = 0;
  private dip = 0;
  private dipVel = 0;
  /** 头部平移弹簧（偏航空间：x 右、y 上、z 前，米） */
  private readonly push = new THREE.Vector3();
  private readonly pushVel = new THREE.Vector3();
  /** 转角弹簧（弧度，网页约定）：x 俯仰（+ 抬头）、y 偏航（+ 左转）、z 横滚（+ 向左歪） */
  private readonly punchA = new THREE.Vector3();
  private readonly punchVel = new THREE.Vector3();
  private dashFov = 0;
  private speedFov = 0;
  private fov = NaN;
  private shakeClock = 0;
  private deathT = 0;
  private deathDrop: number = RIG.DeathDrop;
  private wasDead = false;
  private readonly seeds: [number, number, number];
  /** 震屏前端：fx.shake 经 ctx.cameraFx.addShake 写进来 */
  readonly shake: CameraShake;

  constructor(private readonly ctx: GameContext) {
    this.seeds = [Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000)];
    this.shake = new CameraShake(() => ctx.time.now);
    // fx.shake → 这里（鸭子类型挂在 cameraFx 上：Fx 不 import 玩家模块）
    const cfx = ctx.cameraFx as unknown as { addShake?: (strength: number, duration: number) => void } | undefined;
    if (cfx) cfx.addShake = (s, d) => this.shake.add(s, d);
    const ev = ctx.events;
    if (ev) {
      ev.on('stage:loaded', () => {
        this.calm();
        this.shake.clear();
        this.fov = NaN;
      });
      ev.on('enemy:reaction', e => {
        if (e.hits <= 0) return;
        this.shake.quake(ctx.player.position, e.point, reactionShake(e.reaction, e.depth), 20, 0.25);
      });
      ev.on('enemy:killed', ({ enemy }) => {
        if (enemy.isBoss) this.shake.add(0.7, 0.6);
      });
    }
  }

  reset(): void {
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.strafeRoll = 0;
    this.calm();
    this.fov = NaN;
    this.deathT = 0;
    this.wasDead = false;
    this.shake.clear();
  }

  /** 传送 / 换关：清掉残留的弹簧与冲刺 / 高速 FOV（不影响震屏和阵亡倒地：托回安全点时特意给的那一震要留着） */
  calm(): void {
    this.dip = this.dipVel = 0;
    this.push.set(0, 0, 0);
    this.pushVel.set(0, 0, 0);
    this.punchA.set(0, 0, 0);
    this.punchVel.set(0, 0, 0);
    this.dashFov = 0;
    this.speedFov = 0;
  }

  /** 落地：按下落速度下沉；重落地（> 14 m/s）再震一下 */
  land(fallSpeed: number): void {
    if (!Number.isFinite(fallSpeed)) return;
    this.dipVel -= clamp(fallSpeed, 0, 22) * RIG.LandImpulse;
    if (fallSpeed > RIG.HeavyLandSpeed) this.shake.add(Math.min(0.5, (fallSpeed - RIG.HeavyLandSpeed) * 0.04), 0.18);
  }

  /**
   * 来自 from（世界坐标）的冲击，strength 0–1（受伤时 = 伤害 / 生命上限 × 4，至少 0.15）：头被打向远离来源的一侧（横滚约 2.4°）、
   * 正面来的往上仰（约 1.3°）、背后来的往前点，再被推开约 2.5 cm。from 为空或与玩家重合（没有方向）时随机一侧。
   * player = 玩家脚底位置，yaw = 朝向
   */
  impact(from: THREE.Vector3 | null, strength: number, player: THREE.Vector3, yaw: number): void {
    if (!(strength > 0)) return;
    const s = clamp(strength, 0.15, 1);
    let tx = 0, tz = 0;
    if (from) {
      tx = from.x - player.x;
      tz = from.z - player.z;
    }
    const len = Math.hypot(tx, tz);
    const directed = Number.isFinite(len) && len > 0.1;
    let side = 0, front = 1;
    // 偏航空间：右 = (cos yaw, 0, −sin yaw)，前 = (−sin yaw, 0, −cos yaw)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (directed) {
      tx /= len;
      tz /= len;
      side = tx * rx + tz * rz;
      front = tx * fx + tz * fz;
    }
    const dir = Math.abs(side) < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side);
    this.punchVel.z += dir * RIG.HurtRoll * s;
    // Unity：正面来的往上仰（−低头 = 抬头），背后来的往前点（× −0.6）
    this.punchVel.x += RIG.HurtPitch * s * (front >= -0.3 ? 1 : -0.6);
    if (directed) {
      this.pushVel.x -= side * RIG.HurtPush * s;
      this.pushVel.z -= front * RIG.HurtPush * s;
    }
  }

  /** 旧接口（受击抖动）：strength 0..1，side > 0 表示伤害来自右侧（没有来向时用） */
  hurt(strength: number, side: number): void {
    const s = clamp(strength, 0.15, 1);
    const dir = side === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side);
    this.punchVel.z += dir * RIG.HurtRoll * s;
    this.punchVel.x += RIG.HurtPitch * s;
  }

  /** 镜头冲击（旧接口，斩击命中等）：直接给转角弹簧角速度冲量（弧度/秒，正 pitch = 上仰），自然回弹 */
  punch(roll: number, pitch: number): void {
    if (Number.isFinite(roll)) this.punchVel.z += roll;
    if (Number.isFinite(pitch)) this.punchVel.x += pitch;
  }

  /** 镜头冲击（Unity CameraFeel.Punch）：约 0.09 s 后到峰、峰值约为给的度数。pitchDeg + = 往下点头，rollDeg + = 向左歪，yawDeg + = 右转 */
  punchDegrees(pitchDeg: number, rollDeg: number, yawDeg = 0): void {
    if (Number.isFinite(pitchDeg)) this.punchVel.x -= pitchDeg * DEG / RIG.PeakPerVelocity;
    if (Number.isFinite(yawDeg)) this.punchVel.y -= yawDeg * DEG / RIG.PeakPerVelocity;
    if (Number.isFinite(rollDeg)) this.punchVel.z += rollDeg * DEG / RIG.PeakPerVelocity;
  }

  /** 开枪的镜头反馈（Unity CameraFeel.FireKick）：枪的震屏（开镜减半）+ 头沿视线向后一顿（back = 枪模后坐距离，米） */
  fireKick(shake: number, shakeTime: number, back: number, aimT: number, pitch: number): void {
    if (shake > 0) this.shake.add(shake * (1 - 0.5 * aimT), shakeTime);
    if (back > 0 && Number.isFinite(back)) {
      // 视线方向（偏航空间）= (0, sin pitch, cos pitch)；向后 = 取反
      const k = back * RIG.FireBack;
      this.pushVel.y -= Math.sin(pitch) * k;
      this.pushVel.z -= Math.cos(pitch) * k;
    }
  }

  dashKick(): void {
    this.dashFov = RIG.DashFov;
  }

  /** 直接把相机放到 eye（传送 / 读关时），不带任何偏移 */
  snap(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, yaw: number, pitch: number): void {
    camera.position.copy(eye);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  /** 阵亡时眼睛往下能落多少：脚下离眼睛不到 1.1 m 时少落一点，头离地至少约 0.45 m（Unity：半径 0.15 的球往下扫 1.5 m） */
  private probeDeathDrop(eye: THREE.Vector3): number {
    const g = this.ctx.world?.groundHeight?.(eye.x, eye.z, eye.y, 0.15);
    if (g === undefined || !(g > -Infinity)) return RIG.DeathDrop;
    const sweep = eye.y - g - 0.15;
    if (sweep > RIG.DeathDrop + 0.4) return RIG.DeathDrop;
    return clamp(sweep - 0.3, 0, RIG.DeathDrop);
  }

  /** 更新并写入相机。返回本帧是否踩下一步（用于脚步声） */
  update(dt: number, s: RigInput, camera: THREE.PerspectiveCamera, eye: THREE.Vector3, yaw: number, pitch: number): boolean {
    const ctx = this.ctx;
    dt = Math.max(0, dt);
    // 倒地按真实时间走（阵亡慢动作 ×0.3 时不会慢吞吞），暂停时不动
    const ts = ctx.time.timeScale;
    const realDt = ts > 0 ? Math.min(dt / ts, 0.1) : 0;
    const aim = clamp01(s.aimT);
    const maxSpeed = Math.max(1, s.maxSpeed);
    const speedH = Number.isFinite(s.speedH) ? s.speedH : 0;

    // ── 行走晃动 ──
    const onFoot = s.alive && s.onGround && !s.dashing;
    let stepped = false;
    if (onFoot) {
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += ((speedH * dt) / RIG.StepLength) * Math.PI;
      if (speedH > 0.8 && Math.floor(this.bobPhase / Math.PI) !== before) stepped = true;
      if (this.bobPhase > 200 * Math.PI) this.bobPhase -= 200 * Math.PI;
    }
    this.bobWeight = damp(this.bobWeight, onFoot && speedH > 0.8 ? clamp01(speedH / maxSpeed) : 0, 10, dt);
    const bw = this.bobWeight * (1 - 0.65 * aim);
    const bobY = -Math.cos(this.bobPhase * 2) * 0.5 * RIG.BobVertical * bw;
    const swayX = Math.sin(this.bobPhase) * RIG.BobSide * bw;
    const bobRoll = Math.sin(this.bobPhase) * RIG.BobRoll * bw;

    // ── 侧移倾斜：往移动方向歪 ──
    const strafe = clamp(s.strafeSpeed / maxSpeed, -1, 1);
    this.strafeRoll = damp(this.strafeRoll, s.alive ? -strafe * RIG.StrafeRoll * (s.onGround ? 1 : 0.6) * (1 - 0.5 * aim) : 0, 8, dt);

    // ── 弹簧（子步积分）──
    for (let rem = Math.min(dt, 0.1); rem > 0; rem -= RIG.SpringStep) {
      const h = Math.min(rem, RIG.SpringStep);
      [this.dip, this.dipVel] = springStep(this.dip, this.dipVel, h);
      this.springVec(this.push, this.pushVel, h);
      this.springVec(this.punchA, this.punchVel, h);
    }

    // ── 震屏：trauma² × 设置，6 轴噪声 ──
    this.decayLegacyShake(dt);
    this.shakeClock += dt;
    if (this.shakeClock > 1000) this.shakeClock -= 1000;
    const amp = Math.min(1.8, this.shake.amplitude() * Math.max(0, ctx.settings.screenShake ?? 1));
    let shX = 0, shY = 0, shZ = 0, shPitch = 0, shYaw = 0, shRoll = 0;
    if (amp > 1e-4) {
      const tp = this.shakeClock * RIG.ShakePosFreq, tr = this.shakeClock * RIG.ShakeRotFreq;
      const [a, b, c] = this.seeds;
      shX = noise1(a, tp) * RIG.ShakePos[0] * amp;
      shY = noise1(b, tp) * RIG.ShakePos[1] * amp;
      shZ = noise1(c, tp) * RIG.ShakePos[2] * amp;
      shPitch = noise1(a + 37, tr) * RIG.ShakeRot[0] * DEG * amp;
      shYaw = noise1(b + 37, tr) * RIG.ShakeRot[1] * DEG * amp;
      shRoll = noise1(c + 37, tr) * RIG.ShakeRot[2] * DEG * amp;
    }

    // ── 阵亡倒地 ──
    if (!s.alive) {
      if (!this.wasDead) this.deathDrop = this.probeDeathDrop(eye);
      this.deathT = Math.min(1, this.deathT + realDt / RIG.DeathTime);
    } else this.deathT = Math.max(0, this.deathT - realDt / RIG.ReviveTime);
    this.wasDead = !s.alive;
    const de = 1 - Math.pow(1 - this.deathT, 3);
    // 本来就在往下看时少低一点头（别翻过头顶）：Unity 俯仰 + = 低头，80° 封顶
    const deathPitch = clamp(80 * DEG + pitch, 0, RIG.DeathPitch);

    // ── 写入相机：先定朝向，再把偏航空间的平移与视线空间的震屏位移换到世界 ──
    const rx = pitch + this.dip * RIG.DipPitch + this.punchA.x + shPitch - de * deathPitch;
    const ry = yaw + this.punchA.y + shYaw;
    const rz = bobRoll + this.strafeRoll + this.punchA.z + shRoll + de * RIG.DeathRoll;
    const ox = swayX + this.push.x;
    const oy = bobY + this.dip - de * this.deathDrop + this.push.y;
    const oz = this.push.z;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let px = eye.x + cy * ox - sy * oz;
    let py = eye.y + oy;
    let pz = eye.z - sy * ox - cy * oz;
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    // 视线空间：x 右、y 上、z 前（three 相机朝 −z）
    _sh.set(shX, shY, -shZ).applyQuaternion(_q);
    px += _sh.x;
    py += _sh.y;
    pz += _sh.z;
    if (!Number.isFinite(px + py + pz + rx + ry + rz)) {
      this.calm();
      this.shake.clear();
      camera.position.copy(eye);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      camera.position.set(px, py, pz);
      camera.rotation.set(rx, ry, rz, 'YXZ');
    }

    // ── FOV：设置 + 开镜 + 冲刺 / 高速 ──
    this.dashFov = damp(this.dashFov, 0, 5, dt);
    // 冲刺本身已有冲刺 FOV，冲刺中不再叠高速 FOV
    const speedTarget = s.alive && !s.dashing ? clamp((speedH - maxSpeed * 1.08) * 0.55, 0, RIG.SpeedFovMax) : 0;
    this.speedFov = damp(this.speedFov, speedTarget, 6, dt);
    const kick = Number.isFinite(ctx.cameraFx.fovKick) ? ctx.cameraFx.fovKick : 0;
    // 开镜（fovKick < 0）时压掉冲刺 / 高速带来的视野变宽：狙击镜里画面不「呼吸」
    const aimK = kick < 0 ? clamp01(1 + kick / RIG.AimSuppressKick) : 1;
    const extra = Math.min(RIG.ExtraFovMax, this.dashFov + this.speedFov) * aimK;
    const baseFov = Number.isFinite(ctx.settings.fov) ? ctx.settings.fov : 80;
    const target = clamp(baseFov + kick + extra, 20, 130);
    this.fov = Number.isNaN(this.fov) ? target : damp(this.fov, target, RIG.FovLambda, dt);
    if (Math.abs(camera.fov - this.fov) > 0.005) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    return stepped;
  }

  private springVec(x: THREE.Vector3, v: THREE.Vector3, h: number): void {
    v.x += (-x.x * RIG.SpringK - v.x * RIG.SpringC) * h;
    v.y += (-x.y * RIG.SpringK - v.y * RIG.SpringC) * h;
    v.z += (-x.z * RIG.SpringK - v.z * RIG.SpringC) * h;
    x.x += v.x * h;
    x.y += v.y * h;
    x.z += v.z * h;
  }

  /** 旧震屏通道（fx.shake 照旧写 ctx.cameraFx，首领登场演出读）：只按原规则衰减，不再画到镜头上 */
  private decayLegacyShake(dt: number): void {
    const fx = this.ctx.cameraFx;
    if (fx.shakeTime > 0 && fx.shakeIntensity > 0 && Number.isFinite(fx.shakeIntensity) && Number.isFinite(fx.shakeTime)) {
      fx.shakeTime = Math.max(0, fx.shakeTime - dt);
      fx.shakeIntensity *= Math.exp(-2.5 * dt);
      if (fx.shakeTime <= 0) fx.shakeIntensity = 0;
    } else {
      fx.shakeTime = 0;
      fx.shakeIntensity = 0;
    }
  }
}
