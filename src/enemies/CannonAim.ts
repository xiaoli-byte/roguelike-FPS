import * as THREE from 'three';
import type { MortarPose } from './AttackPoses';

export interface CannonAim {
  rotation: THREE.Quaternion;
  supportY: number;
  supportClearance: number;
  forward: number;
  lift: number;
  lookUp: number;
  limited: boolean;
}

const _baseline = new THREE.Quaternion();
const _aimed = new THREE.Quaternion();
const _kick = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _direction = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const unit = (t: number): number => Math.max(0, Math.min(1, t));
const smooth = (t: number): number => { const x = unit(t); return x * x * (3 - 2 * x); };

export function createCannonAim(): CannonAim {
  return { rotation: new THREE.Quaternion().setFromAxisAngle(RIGHT, 0.75), supportY: 0.24, supportClearance: 0.03,
    forward: 0, lift: 0, lookUp: 0, limited: false };
}

/** 速度在躯干局部空间。近距离高曲射前置炮尾并抬头观察，双手继续弯肘承托。 */
export function boundCannonAim(velocity: THREE.Vector3, out: CannonAim): CannonAim {
  const rawPitch = Math.atan2(Math.hypot(velocity.x, velocity.z), velocity.y);
  const rawYaw = Math.atan2(velocity.x, velocity.z);
  const pitch = THREE.MathUtils.clamp(rawPitch, 0.30, 1.05);
  const yawLimit = 0.25;
  const yaw = THREE.MathUtils.clamp(rawYaw, -yawLimit, yawLimit);
  out.limited = Math.abs(pitch - rawPitch) > 1e-5 || Math.abs(yaw - rawYaw) > 1e-5;
  _direction.set(Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch));
  out.rotation.setFromUnitVectors(UP, _direction);
  const near = 1 - smooth((pitch - 0.45) / 0.20);
  // 实际发布的斗笠宽帽檐需要高曲射时略抬头；平射方向额外前置以留出峰值后坐净空。
  out.forward = near * 0.09 + 0.015 * smooth((pitch - 0.75) / 0.15);
  out.lift = near * 0.04;
  out.lookUp = near * 0.15;
  // 炮管趋平且偏向一侧时，前托沿管身稍下滑，不能靠拉直对侧手臂硬够。
  out.supportY = THREE.MathUtils.clamp(0.24 + near * 0.02 - Math.max(0, pitch - 0.75) * 0.20, 0.18, 0.27)
    - 0.06 * smooth((pitch - 0.75) / 0.30);
  out.supportClearance = 0.025 + 0.005 * smooth((pitch - 0.45) / 0.30) + 0.010 * smooth((pitch - 0.75) / 0.10);
  return out;
}

/** 与关键帧共用的纯补偿；前摇逐渐架准，收势逐渐回到原持炮姿态。 */
export function applyCannonAim(p: MortarPose, aim: CannonAim, state: string, progress: number, recoilPitchDelta = 0): void {
  const weight = state === 'brace' ? smooth(progress / 0.85)
    : state === 'fire' ? 1 : state === 'recover' ? 1 - smooth(progress) : 0;
  if (weight <= 0) return;
  _baseline.setFromEuler(_euler.set(p.pitch, p.yaw, p.roll));
  _aimed.copy(aim.rotation).premultiply(_kick.setFromAxisAngle(RIGHT, recoilPitchDelta));
  _baseline.slerp(_aimed, weight);
  _euler.setFromQuaternion(_baseline);
  p.pitch = _euler.x; p.yaw = _euler.y; p.roll = _euler.z;
  p.y += aim.lift * weight;
  p.z += aim.forward * weight;
  p.head -= aim.lookUp * weight;
  p.supportY += (aim.supportY - p.supportY) * weight;
  p.supportClearance += (aim.supportClearance - p.supportClearance) * weight;
}
