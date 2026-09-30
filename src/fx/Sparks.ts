/**
 * 拉丝火花：带速度拖尾的细长亮条（写入 RibbonBatch 渲染），受重力、阻尼并会在地面弹跳。
 * 结构数组 + 环形覆盖，零分配。
 */
import type * as THREE from 'three';
import type { RibbonBatch } from './Ribbons';

export class SparkStreaks {
  readonly capacity: number;
  alive = 0;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly width: Float32Array;
  private readonly grav: Float32Array;
  private cursor = 0;
  private hiWater = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, life: number, width = 0.022, gravity = 16): void {
    const i = this.cursor;
    this.cursor = i + 1 >= this.capacity ? 0 : i + 1;
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.width[i] = width;
    this.grav[i] = gravity;
    if (i + 1 > this.hiWater) this.hiWater = i + 1;
  }

  update(dt: number, floorY: number): void {
    if (dt <= 0) return;
    const hi = this.hiWater;
    const pos = this.pos, vel = this.vel, life = this.life;
    const damp = Math.exp(-1.1 * dt);
    let newHi = 0;
    let alive = 0;
    for (let i = 0; i < hi; i++) {
      let l = life[i];
      if (l <= 0) continue;
      l -= dt;
      life[i] = l > 0 ? l : 0;
      if (l <= 0) continue;
      alive++;
      newHi = i + 1;
      const i3 = i * 3;
      let vx = vel[i3] * damp;
      let vy = vel[i3 + 1] * damp - this.grav[i] * dt;
      let vz = vel[i3 + 2] * damp;
      let py = pos[i3 + 1] + vy * dt;
      if (py < floorY + 0.015 && vy < 0) {
        py = floorY + 0.015;
        vy = -vy * 0.35;
        vx *= 0.6;
        vz *= 0.6;
      }
      pos[i3] += vx * dt;
      pos[i3 + 1] = py;
      pos[i3 + 2] += vz * dt;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
    }
    this.alive = alive;
    this.hiWater = newHi;
    if (alive === 0) this.cursor = 0;
  }

  render(batch: RibbonBatch): void {
    const hi = this.hiWater;
    const pos = this.pos, vel = this.vel, col = this.col;
    for (let i = 0; i < hi; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      if (batch.full) return;
      const i3 = i * 3;
      const t = 1 - l / this.maxLife[i];
      const vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      // 拖尾长度 ∝ 速度，限制在 [4cm, 55cm]
      let k = 0.02;
      const len = speed * k;
      if (len > 0.55) k = 0.55 / Math.max(speed, 1e-4);
      else if (len < 0.04) k = 0.04 / Math.max(speed, 1e-4);
      const hx = pos[i3], hy = pos[i3 + 1], hz = pos[i3 + 2];
      const a = (1 - t) * (1 - t * 0.4);
      const hot = (1 - t) * (1 - t) * 0.6;
      const w = this.width[i] * (1 - t * 0.5);
      batch.quad(
        hx - vx * k, hy - vy * k, hz - vz * k,
        hx, hy, hz,
        w * 0.35, w,
        col[i3] + hot, col[i3 + 1] + hot, col[i3 + 2] + hot,
        0, a,
      );
    }
  }

  clear(): void {
    for (let i = 0; i < this.hiWater; i++) this.life[i] = 0;
    this.alive = 0;
    this.cursor = 0;
    this.hiWater = 0;
  }
}
