/**
 * 移动特效（Unity Player/MovementFx.cs）：
 *   冲刺：视线前方一圈拉长的风痕迎面掠过（第一人称看得见；Three.js 原来的「身后气流」在第一人称里看不到）+ 在地上冲刺时脚下一小团扬尘；
 *   二段跳：脚下英雄色的扩散环 + 一小撮往下飞的火星；
 *   落地：按下落速度扬起一圈尘土（≥ 6 m/s 才有，越重越大），重落地（≥ 14 m/s）另加一个扩散环。
 * 镜头的冲刺 FOV 冲击、落地下沉归 CameraRig。fx 没有分层入口（测试桩）时退回 burst / ring。
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { fxExtras } from '../fx/extras';

export const MOVE_FX = {
  /** 风痕：颗数、视线前方距离、偏离视轴半径、速度、粗细、寿命 */
  Streaks: 14, StreakAhead: [2, 5] as const, StreakRadius: [0.6, 1.6] as const, StreakSpeed: [26, 34] as const,
  StreakSize: [0.035, 0.06] as const, StreakLife: [0.14, 0.22] as const,
  /** 冲刺扬尘颗数 */
  DashDust: 8,
  /** 二段跳：扩散环半径、扩散速度（m/s）、火星颗数 */
  JumpRing: 1.3, JumpRingSpeed: 6, JumpSparks: 10,
  /** 落地：起扬尘的下落速度、重落地加环的下落速度、颗数（8 → 22） */
  LandDustFrom: 6, LandRingFrom: 14, LandDust: [8, 22] as const,
} as const;

/** 扬尘色（0.78, 0.68, 0.55）、风痕色（0.91, 0.95, 1，半透明按亮度折算） */
const DUST = 0xc7ad8c;
const WIND = 0x747980;

/** 落地扬尘的颗数与强度（Unity：k = (fall − 6) / 14，颗数 lerp(8, 22, k)）；fall < 6 时 0 */
export function landDust(fall: number): { count: number; k: number } {
  if (!(fall >= MOVE_FX.LandDustFrom)) return { count: 0, k: 0 };
  const k = Math.max(0, Math.min(1, (fall - MOVE_FX.LandDustFrom) / 14));
  return { count: Math.round(MOVE_FX.LandDust[0] + (MOVE_FX.LandDust[1] - MOVE_FX.LandDust[0]) * k), k };
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class MovementFx {
  constructor(private readonly ctx: GameContext) {}

  /** 冲刺：dir = 冲刺方向（水平单位向量），eye = 眼睛，feet = 脚底，grounded = 在地上 */
  dashed(dir: THREE.Vector3, eye: THREE.Vector3, feet: THREE.Vector3, grounded: boolean): void {
    const ctx = this.ctx;
    const ex = fxExtras(ctx);
    _right.crossVectors(UP, dir);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    // 风痕：视线前方 2–5 m、偏离视轴 0.6–1.6 m 的一圈点上生成，逆着冲刺方向飞过镜头
    for (let i = 0; i < MOVE_FX.Streaks; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(MOVE_FX.StreakRadius[0], MOVE_FX.StreakRadius[1]);
      _p.copy(eye).addScaledVector(dir, rand(MOVE_FX.StreakAhead[0], MOVE_FX.StreakAhead[1]))
        .addScaledVector(_right, Math.cos(a) * r).addScaledVector(UP, Math.sin(a) * r * 0.7);
      _v.copy(dir).multiplyScalar(-rand(MOVE_FX.StreakSpeed[0], MOVE_FX.StreakSpeed[1]));
      const life = rand(MOVE_FX.StreakLife[0], MOVE_FX.StreakLife[1]);
      if (ex?.streak) ex.streak(_p, _v, WIND, life, rand(MOVE_FX.StreakSize[0], MOVE_FX.StreakSize[1]));
    }
    if (!ex?.streak) {
      _p.copy(feet).addScaledVector(dir, -0.6).setY(feet.y + 0.9);
      ctx.fx.burst(_p, 0xe8f2ff, 8, 2.5, 0.3, 0.05, 0);
    }
    // 脚下扬尘（在地上冲刺时）
    if (!grounded) return;
    for (let i = 0; i < MOVE_FX.DashDust; i++) {
      _v.copy(dir).multiplyScalar(-rand(1.5, 3.5));
      _v.x += (Math.random() * 2 - 1) * 1.2;
      _v.z += (Math.random() * 2 - 1) * 1.2;
      _v.y = Math.abs((Math.random() * 2 - 1) * 1.2) * 0.6 + 0.4;
      _p.copy(feet).addScaledVector(dir, -0.4);
      _p.y += 0.1;
      if (ex?.dust) ex.dust(_p, _v, DUST, rand(0.25, 0.45), rand(0.35, 0.6));
      else ctx.fx.burst(_p, DUST, 1, 1.5, 0.5, 0.3, 0);
    }
  }

  /** 二段跳：脚下英雄色的扩散环 + 一小撮往下飞的火星 */
  airJumped(feet: THREE.Vector3, color: number): void {
    const ctx = this.ctx;
    const ex = fxExtras(ctx);
    _p.copy(feet);
    _p.y += 0.05;
    ctx.fx.ring(_p, MOVE_FX.JumpRing, color, MOVE_FX.JumpRing / MOVE_FX.JumpRingSpeed);
    for (let i = 0; i < MOVE_FX.JumpSparks; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (_v.lengthSq() > 1) _v.normalize();
      _v.multiplyScalar(3);
      _v.y = -Math.abs(_v.y) - 0.5;
      if (ex?.streak) ex.streak(_p, _v, color, 0.35, 0.05);
    }
    if (!ex?.streak) ctx.fx.burst(_p, color, 10, 3, 0.35, 0.06, 2);
  }

  /** 落地：fall = 下落速度（m/s） */
  landed(feet: THREE.Vector3, fall: number): void {
    const { count, k } = landDust(fall);
    if (count <= 0) return;
    const ctx = this.ctx;
    const ex = fxExtras(ctx);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const ox = Math.cos(a), oz = Math.sin(a);
      const sp = rand(2, 4 + 3 * k);
      _v.set(ox * sp, rand(0.3, 1.2), oz * sp);
      _p.set(feet.x + ox * 0.3, feet.y + 0.08, feet.z + oz * 0.3);
      if (ex?.dust) ex.dust(_p, _v, DUST, rand(0.3, 0.55 + 0.3 * k), rand(0.45, 0.8));
    }
    if (!ex?.dust) {
      _p.set(feet.x, feet.y + 0.1, feet.z);
      ctx.fx.burst(_p, DUST, count, 3 + 3 * k, 0.6, 0.3, 1);
    }
    if (fall >= MOVE_FX.LandRingFrom) {
      const r = 1.6 + 1.2 * k;
      _p.set(feet.x, feet.y + 0.04, feet.z);
      ctx.fx.ring(_p, r, DUST, r / 9);
    }
  }
}
