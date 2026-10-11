/**
 * 第二章群怪（冻鲛人、雪狌狌）共用的动作小工具：关键帧插值与尾巴弹簧骨骼。
 *
 * 尾巴弹簧骨骼与跳鼠刀兵的尾巴同一算法（VRM spring bone 的 verlet 形式）：每节尾端是一个有惯性的质点，
 * 在世界空间里跟着身体的真实运动走，被拉回动画给出的目标方向（刚度从尾根往尾尖递减），带阻尼、少量重力、
 * 关节弯曲上限，与地面碰撞；骨骼朝向由质点位置反推。质点存成「相对角色位置」的偏移：整体的跳跃 / 冲刺不会把尾巴拖坏，
 * 模型内部的起伏和转身仍然带出惯性。
 */
import * as THREE from 'three';
import { clamp01 } from '../../core/math';

export const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 关键帧插值：keys = [[u, 值], ...]（u 递增），段内平滑过渡 */
export function keyed(u: number, keys: readonly (readonly [number, number])[]): number {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [u1, v1] = keys[i];
    if (u <= u1) {
      const [u0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smooth((u - u0) / (u1 - u0));
    }
  }
  return keys[keys.length - 1][1];
}

export interface SpringTailOpts {
  /** 每节刚度（每秒把尾端往目标方向推多少米），尾根到尾尖 */
  stiffness: readonly number[];
  drag: number;
  gravity: number;
  /** 每节相对动画目标方向最多偏多少（弧度） */
  maxBend: number;
  /** 尾端离地的最小高度（米，乘体型） */
  clearance: number;
}

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _delta = new THREE.Quaternion();

interface Joint {
  bone: THREE.Bone;
  axis: THREE.Vector3;
  localLen: number;
  tail: THREE.Vector3;
  prev: THREE.Vector3;
}

export class SpringTail {
  private readonly joints: Joint[] = [];
  private live = false;

  /**
   * @param bones 尾根到尾尖的骨骼（绑定姿势下调用）：每节的指向取到下一节的方向，最后一节沿用上一节的方向和长度
   */
  constructor(bones: readonly THREE.Bone[], private readonly opts: SpringTailOpts) {
    if (bones.length < 2) return;
    const wp = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const n = bones.length;
    for (let i = 0; i < n; i++) {
      const b = bones[i];
      const dirW = i < n - 1 ? wp[i + 1].clone().sub(wp[i]) : wp[n - 1].clone().sub(wp[n - 2]);
      const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
      const localLen = i < n - 1 ? bones[i + 1].position.length() : bones[n - 1].position.length();
      this.joints.push({ bone: b, axis: dirW.normalize().applyQuaternion(inv), localLen, tail: new THREE.Vector3(), prev: new THREE.Vector3() });
    }
  }

  get size(): number {
    return this.joints.length;
  }

  /** 出生动画 / 瞬移后：下一步从动画姿势重新起算 */
  reset(): void {
    this.live = false;
  }

  /**
   * 前进一步（在本帧的骨骼动画之后调用）。
   * @param origin 角色位置（世界）
   * @param groundY 地面高度（世界），没有地面碰撞时传 -Infinity
   * @param scale 角色整体缩放（离地间隙随之放大）
   */
  step(dt: number, origin: THREE.Vector3, groundY: number, scale: number): void {
    const o = this.opts;
    const h = Math.min(dt, 1 / 20);
    const floor = groundY + o.clearance * scale;
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      const b = j.bone;
      b.updateWorldMatrix(true, false);
      b.getWorldPosition(_head);
      b.getWorldQuaternion(_q);
      _dir.copy(j.axis).applyQuaternion(_q);
      const len = j.localLen * b.getWorldScale(_vel).x;
      _cur.copy(j.tail).add(origin);
      if (!this.live || _cur.distanceToSquared(_head) > 4) {
        _cur.copy(_head).addScaledVector(_dir, len);
        j.tail.copy(_cur).sub(origin);
        j.prev.copy(j.tail);
      }
      _next.copy(_cur)
        .addScaledVector(_vel.subVectors(j.tail, j.prev), 1 - o.drag)
        .addScaledVector(_dir, o.stiffness[Math.min(i, o.stiffness.length - 1)] * h)
        .add(_vel.set(0, -o.gravity * h, 0));
      _next.sub(_head).setLength(len).add(_head);
      _vel.subVectors(_next, _head).normalize();
      const bend = _vel.angleTo(_dir);
      if (bend > o.maxBend) {
        _delta.setFromUnitVectors(_dir, _vel);
        _pq.identity().slerp(_delta, o.maxBend / bend);
        _next.copy(_dir).applyQuaternion(_pq).multiplyScalar(len).add(_head);
      }
      if (_next.y < floor) {
        _next.y = floor;
        _next.sub(_head).setLength(len).add(_head);
      }
      j.prev.copy(j.tail);
      j.tail.copy(_next).sub(origin);
      _vel.subVectors(_next, _head).normalize();
      _delta.setFromUnitVectors(_dir, _vel);
      b.parent!.getWorldQuaternion(_pq).invert();
      b.quaternion.copy(_pq.multiply(_delta).multiply(_q));
    }
    this.live = true;
  }
}
