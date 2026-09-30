import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** 与帧率无关的指数趋近：lambda 越大越快 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVec3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): THREE.Vector3 {
  return current.lerp(target, 1 - Math.exp(-lambda * dt));
}

/** 把角度差规约到 (-PI, PI] */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** 以最大角速度 maxStep 从 a 转向 b */
export function rotateTowards(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** yaw=0 朝 -Z（与 three.js 相机默认朝向一致），pitch>0 抬头 */
export function dirFromYawPitch(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** 由方向向量求 yaw（与 dirFromYawPitch 一致） */
export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** 在以 dir 为轴、半角 angle 的圆锥内随机取方向（均匀分布于圆盘投影） */
export function randomInCone(dir: THREE.Vector3, angle: number, rand: () => number, out = new THREE.Vector3()): THREE.Vector3 {
  if (angle <= 0) return out.copy(dir);
  const r = Math.sqrt(rand()) * Math.tan(angle);
  const th = rand() * TAU;
  // 构造正交基
  const up = Math.abs(dir.y) < 0.99 ? _UP : _RIGHT;
  const t1 = _t1.crossVectors(dir, up).normalize();
  const t2 = _t2.crossVectors(dir, t1).normalize();
  out.copy(dir)
    .addScaledVector(t1, Math.cos(th) * r)
    .addScaledVector(t2, Math.sin(th) * r)
    .normalize();
  return out;
}

const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/** 射线与球求交，返回距离或 -1 */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/**
 * 射线与竖直胶囊（线段 [yMin, yMax] 于 (cx, cz)，半径 r）求交，返回距离或 -1。
 */
export function rayVerticalCapsule(origin: THREE.Vector3, dir: THREE.Vector3, cx: number, cz: number, yMin: number, yMax: number, r: number): number {
  // 先与无限圆柱求交
  const ox = origin.x - cx, oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  let best = -1;
  if (a > 1e-8) {
    const b = ox * dir.x + oz * dir.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / a;
      if (t < 0 && c <= 0) t = 0; // 起点在圆柱内
      if (t >= 0) {
        const y = origin.y + dir.y * t;
        if (y >= yMin && y <= yMax) best = t;
      }
    }
  }
  if (best >= 0) return best;
  // 两端半球
  _cap.set(cx, yMin, cz);
  const t0 = raySphere(origin, dir, _cap, r);
  _cap.set(cx, yMax, cz);
  const t1 = raySphere(origin, dir, _cap, r);
  if (t0 >= 0 && (t1 < 0 || t0 < t1)) return t0;
  return t1;
}

const _cap = new THREE.Vector3();

/** 点到线段距离平方（3D） */
export function distSqPointSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  let t = len > 0 ? (apx * abx + apy * aby + apz * abz) / len : 0;
  t = clamp01(t);
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** 计算抛物线发射速度：从 from 以水平速度 hSpeed 命中 to（重力 g），返回是否可行 */
export function ballisticVelocity(from: THREE.Vector3, to: THREE.Vector3, hSpeed: number, g: number, out: THREE.Vector3): THREE.Vector3 {
  const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
  const dist = Math.hypot(dx, dz);
  const t = Math.max(0.2, dist / hSpeed);
  out.set(dx / t, dy / t + 0.5 * g * t, dz / t);
  return out;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
