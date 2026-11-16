/**
 * 登场演出的纯数学（Unity Bosses/Intro/IntroMath.cs）：缓动、姿态混合、环绕插值、交接误差、手持噪声、决斗坐标系。
 * 交接（落回第一人称）的硬性约定：blend 在 w ≥ 1 时原样返回目标姿态，landWeight 在 u ≥ 时长时正好是 1——最后一帧相机和眼睛的误差是 0。
 * 坐标：世界点照 Unity 的数（网页的关卡就是 Unity 导出的原坐标），决斗坐标系的「右」= Cross(up, forward)（与 Unity 同一个式子）；
 * 相机朝向按 three.js 相机（本地 −Z 看向目标）。
 */
import * as THREE from 'three';

export type IntroEase = 'linear' | 'in' | 'out' | 'inOut' | 'smoother';

export interface CamPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const _z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

export function ease(e: IntroEase, k: number): number {
  if (!(k > 0)) return 0;
  if (k >= 1) return 1;
  switch (e) {
    case 'in':
      return k * k * k;
    case 'out': {
      const u = 1 - k;
      return 1 - u * u * u;
    }
    case 'inOut':
      return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    case 'smoother':
      return k * k * k * (k * (k * 6 - 15) + 10);
    default:
      return k;
  }
}

/** 落回第一人称的权重：smootherstep；u ≥ seconds 时正好是 1 */
export function landWeight(u: number, seconds: number): number {
  return !(seconds > 0) || u >= seconds ? 1 : ease('smoother', u / seconds);
}

/** 落地用时按回程拉长：25 m 以内照脚本，越远越长，最多 1.45 倍 */
export function landStretch(meters: number): number {
  return Number.isFinite(meters) ? Math.min(1.45, Math.max(1, 1 + (meters - 25) / 65)) : 1;
}

/** 回程默认抬多高：路程的 8%，最多 4 m；太近不抬 */
export function landLiftFor(meters: number): number {
  return Number.isFinite(meters) && meters > 2.5 ? Math.min(meters * 0.08, 4) : 0;
}

/** 回程中段的抬升 lift × 4w(1 − w)：w ≤ 0 / ≥ 1 时正好是 0 */
export function landLift(lift: number, w: number): number {
  return !(w > 0) || w >= 1 || !Number.isFinite(lift) ? 0 : lift * 4 * w * (1 - w);
}

export function pose(position: THREE.Vector3, quaternion: THREE.Quaternion, fov: number): CamPose {
  return { position: position.clone(), quaternion: quaternion.clone(), fov };
}

export function copyPose(out: CamPose, p: CamPose): CamPose {
  out.position.copy(p.position);
  out.quaternion.copy(p.quaternion);
  out.fov = p.fov;
  return out;
}

/** 两个姿态按 w 混合（位置线性、朝向球面、视角线性）。w ≤ 0 原样返回 a，w ≥ 1 原样返回 b */
export function blend(a: CamPose, b: CamPose, w: number): CamPose {
  if (!(w > 0)) return a;
  if (w >= 1) return b;
  return {
    position: a.position.clone().lerp(b.position, w),
    quaternion: a.quaternion.clone().slerp(b.quaternion, w),
    fov: a.fov + (b.fov - a.fov) * w,
  };
}

export function land(from: CamPose, eye: CamPose, u: number, seconds: number): CamPose {
  return blend(from, eye, landWeight(u, seconds));
}

/** 环绕插值：a、b 是机位相对看点的偏移，水平方向按角度转过去（不穿过看点），水平距离和高度线性插值 */
export function orbit(a: THREE.Vector3, b: THREE.Vector3, k: number): THREE.Vector3 {
  const la = Math.hypot(a.x, a.z), lb = Math.hypot(b.x, b.z);
  const len = la + (lb - la) * k;
  let dx = 0, dz = 0;
  if (la < 1e-4 && lb < 1e-4) { /* 竖直 */ } else if (la < 1e-4) {
    dx = b.x / lb; dz = b.z / lb;
  } else if (lb < 1e-4) {
    dx = a.x / la; dz = a.z / la;
  } else {
    const ya = Math.atan2(a.x, a.z), yb = Math.atan2(b.x, b.z);
    let d = yb - ya;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const y = ya + d * k;
    dx = Math.sin(y); dz = Math.cos(y);
  }
  return new THREE.Vector3(dx * len, a.y + (b.y - a.y) * k, dz * len);
}

export function finite(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** 相机从 from 看向 target 的朝向（three 相机：本地 −Z 指向目标），roll 度绕视线；方向太短 / 竖直时也给确定值 */
export function lookRotation(from: THREE.Vector3, target: THREE.Vector3, roll = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  const dir = new THREE.Vector3().subVectors(target, from);
  if (!finite(dir) || dir.lengthSq() < 1e-8) dir.copy(_fwd);
  dir.normalize();
  const up = Math.abs(dir.y) > 0.999 ? _fwd : _up;
  // Matrix4.lookAt(eye, target)：本地 +Z = eye − target，相机的 −Z 就指向 target
  _m.lookAt(new THREE.Vector3(), dir, up);
  out.setFromRotationMatrix(_m);
  if (Math.abs(roll) > 1e-4) out.multiply(_q.setFromAxisAngle(_z, roll * Math.PI / 180));
  return out;
}

export function lookPose(from: THREE.Vector3, target: THREE.Vector3, fov: number, roll = 0): CamPose {
  return { position: from.clone(), quaternion: lookRotation(from, target, roll), fov };
}

/** 两个姿态的差：位置（米）、朝向（度）、视角（度） */
export function poseError(a: CamPose, b: CamPose): { meters: number; degrees: number; fov: number } {
  return { meters: a.position.distanceTo(b.position), degrees: a.quaternion.angleTo(b.quaternion) * 180 / Math.PI, fov: Math.abs(a.fov - b.fov) };
}

/** 决斗坐标系：+Z = 从玩家指向首领出生点（水平），+X = Cross(up, forward)（玩家的右手，Unity 同式）。重合 / 竖直时退回 fallback */
export function duelBasis(player: THREE.Vector3, spawn: THREE.Vector3, fallback: THREE.Vector3): { forward: THREE.Vector3; right: THREE.Vector3 } {
  const forward = new THREE.Vector3(spawn.x - player.x, 0, spawn.z - player.z);
  if (!finite(forward) || forward.lengthSq() < 0.25) forward.set(fallback.x, 0, fallback.z);
  if (!finite(forward) || forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(_up, forward);
  return { forward, right };
}

export function toWorld(offset: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(right).multiplyScalar(offset.x).addScaledVector(_up, offset.y).addScaledVector(forward, offset.z);
}

/** 看向 target 的玩家视线（网页约定：yaw = atan2(−dx, −dz)、pitch > 0 抬头），俯仰夹在 ±maxPitch 度 */
export function yawPitch(from: THREE.Vector3, target: THREE.Vector3, maxPitchDeg: number): { yaw: number; pitch: number } {
  const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
  const flat = Math.max(1e-3, Math.hypot(dx, dz));
  const max = maxPitchDeg * Math.PI / 180;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.min(max, Math.max(-max, Math.atan2(dy, flat))) };
}

/** 手持 / 震屏噪声：三个独立的 −1..1 平滑噪声通道（值噪声 + smoothstep，代替 Unity 的 PerlinNoise） */
export function noise3(seed: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(noise1(seed, t), noise1(seed + 31.7, t), noise1(seed + 77.3, t));
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise1(seed: number, t: number): number {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 57.3), b = hash(i + 1 + seed * 57.3);
  return (a + (b - a) * u) * 2 - 1;
}

/** 指数平滑（与帧率无关） */
export function dampTo(a: number, b: number, lambda: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}
