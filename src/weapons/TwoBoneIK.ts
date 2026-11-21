/**
 * 两骨 IK（Unity TwoBoneIK.cs：肩 → 肘 → 手，余弦定理解析解；纯函数）。第一人称手臂是一整块刚体网格（前臂 + 手），
 * 所以这里只解出肘的位置，Viewmodel 让前臂沿「手 → 肘」摆过去：手按在握点 / 送弹口上，前臂跟着自然转，而不是整条手臂平移。
 */
import * as THREE from 'three';

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _want = new THREE.Vector3();
const _have = new THREE.Vector3();
const _rot = new THREE.Quaternion();

/** 把 v 投到法线为 n（单位向量）的平面上 */
function projectOnPlane(v: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
  return v.addScaledVector(n, -v.dot(n));
}

/**
 * 肘的位置（写进 out）：root = 肩，target = 手的目标，upper / lower = 上臂 / 前臂长，pole = 肘往哪边弯（提示点）。
 * 够不着（太远 / 太近）时把距离夹到可达范围（手臂伸直 / 折到底），返回 reached = false
 */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, upper: number, lower: number, pole: THREE.Vector3, out: THREE.Vector3): boolean {
  upper = Math.max(1e-4, upper);
  lower = Math.max(1e-4, lower);
  _to.subVectors(target, root);
  const dist = _to.length();
  const maxReach = upper + lower - 1e-4, minReach = Math.abs(upper - lower) + 1e-4;
  const reached = dist <= maxReach && dist >= minReach;
  const d = Math.min(maxReach, Math.max(minReach, dist));
  if (dist > 1e-6) _dir.copy(_to).divideScalar(dist);
  else _dir.set(0, 0, 1);
  // 肘在「肩 → 手」连线上的投影距离与离线高度
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - along * along));
  projectOnPlane(_bend.subVectors(pole, root), _dir);
  if (_bend.lengthSq() < 1e-10) projectOnPlane(_bend.set(0, -1, 0), _dir);
  if (_bend.lengthSq() < 1e-10) projectOnPlane(_bend.set(1, 0, 0), _dir);
  out.copy(root).addScaledVector(_dir, along).addScaledVector(_bend.normalize(), h);
  return reached;
}

/**
 * 刚体前臂的朝向（写进 out）：handRot 是手型（握持横滚 / 俯仰），forearm 是网格局部的「手 → 肘」方向；
 * 把前臂从手型给的方向转到真正指向肘的方向（最短转动，保留手腕的扭转）
 */
export function forearmRotation(handRot: THREE.Quaternion, forearm: THREE.Vector3, hand: THREE.Vector3, elbow: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _want.subVectors(elbow, hand);
  _have.copy(forearm).applyQuaternion(handRot);
  if (_want.lengthSq() < 1e-10 || _have.lengthSq() < 1e-10) return out.copy(handRot);
  _rot.setFromUnitVectors(_have.normalize(), _want.normalize());
  return out.copy(_rot).multiply(handRot);
}

/**
 * 第一人称左手的 IK 参数（Unity WeaponHandRig；相机空间换成 Three.js 约定：x 右、y 上、z 朝后，即 Unity 的 z 取反）：
 * 肩固定在相机左下方、肘往左下外侧弯；上臂 0.42 m、前臂 0.40 m（第一人称手臂比真人略长：枪模在眼前 0.6 m 左右）；
 * 前臂跟 IK 摆动取 70%、最多 35°（手臂网格是一整块，转多了袖子会扫进镜头）
 */
export const HAND_IK = {
  shoulder: [-0.19, -0.26, 0.05] as const,
  pole: [-0.55, -0.6, -0.3] as const,
  upperArm: 0.42,
  forearm: 0.4,
  weight: 0.7,
  maxSwingDeg: 35,
} as const;
