/**
 * 风场（Unity WindField.cs + WindRunner）：基础风向 + 吸引点（飞廉的风眼：strength > 0 吸、< 0 推）；整张图的覆盖（4-2 峡谷风）。
 *   · sample(p)：水平风向 + 强度 0..1（越靠近吸引点风越强、方向越朝它）；
 *   · playerPush：把玩家沿风向吹着走（m/s × 风强，走 moveBody，不进速度；冲刺中不推）；playerSpeedK：顺风走快 / 逆风走慢的比例。
 * 基础风没设时读天气导演的盛行风（windDir / baseWind），都没有时 (−0.82, −0.57) × 0.25（Unity 坐标；网页 x 取反 = (0.82, −0.57)）。
 * 换关时清空（WindField 跟着机关系统一关一份）。第四章领主（飞廉）随 M6 接上来用。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { V3 } from './LavaCore';

export interface WindSample { dir: [number, number]; strength: number }

/** 风的吸引点（Unity WindAttractor） */
export class WindAttractor {
  active = true;
  constructor(public center: V3, public radius = 260, public core = 30, public strength = 1, private readonly owner: WindField | null = null) {}

  /** 在 p 处的影响程度 0..1（远 → 近 smoothstep） */
  weight(p: V3): number {
    const d = Math.hypot(p.x - this.center.x, p.z - this.center.z);
    if (d >= this.radius) return 0;
    const t = Math.min(1, Math.max(0, (this.radius - d) / Math.max(0.01, this.radius - this.core)));
    return t * t * (3 - 2 * t);
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.owner?.remove(this);
  }
}

const FALLBACK: [number, number] = [0.82, -0.57];
const FALLBACK_STRENGTH = 0.25;
const _d = new THREE.Vector3();

export class WindField {
  readonly attractors: WindAttractor[] = [];
  baseDir: [number, number] | null = null;
  baseStrength: number | null = null;
  override: ((p: V3) => WindSample) | null = null;
  playerPush = 0;
  playerSpeedK = 0;
  /** 天气导演的盛行风（网页坐标） */
  weather: { dir: [number, number]; strength: number } | null = null;

  addAttractor(center: V3, radius: number, strength = 1, core = 30): WindAttractor {
    const r = Math.max(1, radius);
    const a = new WindAttractor({ ...center }, r, Math.min(Math.max(core, 0), r - 0.5), strength, this);
    this.attractors.push(a);
    return a;
  }

  remove(a: WindAttractor): void {
    const i = this.attractors.indexOf(a);
    if (i >= 0) this.attractors.splice(i, 1);
  }

  reset(): void {
    for (const a of [...this.attractors]) a.dispose();
    this.attractors.length = 0;
    this.baseDir = null;
    this.baseStrength = null;
    this.override = null;
    this.playerPush = 0;
    this.playerSpeedK = 0;
  }

  get base(): WindSample {
    const d = this.baseDir ?? this.weather?.dir ?? FALLBACK;
    const s = this.baseStrength ?? this.weather?.strength ?? FALLBACK_STRENGTH;
    const l = Math.hypot(d[0], d[1]);
    const fl = Math.hypot(FALLBACK[0], FALLBACK[1]);
    return { dir: l > 1e-3 ? [d[0] / l, d[1] / l] : [FALLBACK[0] / fl, FALLBACK[1] / fl], strength: Math.min(1, Math.max(0, s)) };
  }

  sample(p: V3): WindSample {
    if (this.override) {
      const o = this.override(p);
      const l = Math.hypot(o.dir[0], o.dir[1]);
      return { dir: l > 1e-3 ? [o.dir[0] / l, o.dir[1] / l] : this.base.dir, strength: Math.min(1, Math.max(0, o.strength)) };
    }
    const b = this.base;
    let dx = b.dir[0], dz = b.dir[1], strength = b.strength;
    for (const a of this.attractors) {
      if (!a.active || a.strength === 0) continue;
      const w = a.weight(p);
      if (w <= 0) continue;
      let tx = a.center.x - p.x, tz = a.center.z - p.z;
      const d = Math.hypot(tx, tz);
      if (d < 1e-3) continue;
      tx /= d;
      tz /= d;
      if (a.strength < 0) { tx = -tx; tz = -tz; }
      const k = Math.min(1, w * 1.6);
      dx += (tx - dx) * k;
      dz += (tz - dz) * k;
      strength = Math.max(strength, Math.abs(a.strength) * w);
    }
    const l = Math.hypot(dx, dz);
    return { dir: l > 1e-6 ? [dx / l, dz / l] : b.dir, strength: Math.min(1, Math.max(0, strength)) };
  }

  /** 摆动物件的偏转（经幡 / 草）：强度 × (0.75 + 0.25 × 阵风) */
  sway(at: V3, time: number): number {
    const w = this.sample(at);
    const gust = Math.sin(time * 1.7 + at.x * 0.11 + at.z * 0.07) * 0.5 + Math.sin(time * 3.9 + at.z * 0.23) * 0.5;
    return Math.min(1, Math.max(0, w.strength * (0.75 + 0.25 * gust)));
  }

  get strongest(): WindAttractor | null {
    let best: WindAttractor | null = null;
    for (const a of this.attractors) if (a.active && (!best || Math.abs(a.strength) > Math.abs(best.strength))) best = a;
    return best;
  }

  /** 玩家步速倍率：1 ± k × 风强 × cos（下限 0.2） */
  speedMult(at: V3, moveX: number, moveZ: number): number {
    if (!(this.playerSpeedK > 0)) return 1;
    const l = Math.hypot(moveX, moveZ);
    if (l < 1e-2) return 1;
    const w = this.sample(at);
    return Math.max(0.2, 1 + this.playerSpeedK * w.strength * (moveX / l * w.dir[0] + moveZ / l * w.dir[1]));
  }

  /** 每帧（WindRunner）：吹着玩家走 */
  update(ctx: GameContext, dt: number): void {
    const p = ctx.player;
    if (!p.alive || !(this.playerPush > 0) || p.isDashing) return;
    const w = this.sample(p.position);
    const k = this.playerPush * w.strength * dt;
    if (k * k <= 1e-10) return;
    _d.set(w.dir[0] * k, 0, w.dir[1] * k);
    ctx.world.moveBody(p.position, p.radius, p.height, _d, p.onGround, 0.45);
  }
}
