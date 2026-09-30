/**
 * 线状特效：弹道曳光（tracer）、持续光束（beam）、锯齿闪电（lightning）。
 * 全部对象池化，每帧把几何写进共享的 RibbonBatch。
 */
import * as THREE from 'three';
import { RIBBON_BEAM, RIBBON_SOFT, type RibbonBatch } from './Ribbons';
import { STYLE_GLOW, STYLE_SPARK, type ParticlePool } from './Particles';
import type { SparkStreaks } from './Sparks';
import { hexToColor, jitter, rand } from './shared';

const TRACER_POOL = 128;
const BEAM_POOL = 32;
const BOLT_POOL = 40;
/** 闪电主干最多分段数 */
const BOLT_SEGMENTS = 16;
const BRANCH_SEGMENTS = 5;

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);

interface Tracer {
  active: boolean;
  ax: number; ay: number; az: number;
  dx: number; dy: number; dz: number; // 单位方向
  dist: number;
  r: number; g: number; b: number;
  width: number;
  age: number;
  life: number;
  stamp: number;
}

interface Beam {
  active: boolean;
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: number;
  r: number; g: number; b2: number;
  width: number;
  age: number;
  duration: number;
  /** 末尾淡出窗口（秒） */
  fadeWin: number;
  seed: number;
  sparkAcc: number;
  /** 最近一次被刷新（合并）的帧号 */
  touchedFrame: number;
  stamp: number;
}

interface Bolt {
  active: boolean;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number; g: number; b2: number;
  age: number;
  life: number;
  rejitter: number;
  flicker: number;
  n: number;
  pts: Float32Array;
  branchFrom: number;
  bn: number;
  bpts: Float32Array;
  stamp: number;
}

export class TrailEffects {
  private readonly tracers: Tracer[] = [];
  private readonly beams: Beam[] = [];
  private readonly bolts: Bolt[] = [];
  private stamp = 0;
  private time = 0;

  constructor(private readonly glow: ParticlePool, private readonly sparks: SparkStreaks) {
    for (let i = 0; i < TRACER_POOL; i++) {
      this.tracers.push({ active: false, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 1, dist: 0, r: 1, g: 1, b: 1, width: 0.05, age: 0, life: 0.08, stamp: 0 });
    }
    for (let i = 0; i < BEAM_POOL; i++) {
      this.beams.push({
        active: false, a: new THREE.Vector3(), b: new THREE.Vector3(), color: 0, r: 1, g: 1, b2: 1,
        width: 0.2, age: 0, duration: 0.1, fadeWin: 0.05, seed: 0, sparkAcc: 0, touchedFrame: -1, stamp: 0,
      });
    }
    for (let i = 0; i < BOLT_POOL; i++) {
      this.bolts.push({
        active: false, a: new THREE.Vector3(), b: new THREE.Vector3(), r: 1, g: 1, b2: 1,
        age: 0, life: 0.15, rejitter: 0, flicker: 1, n: 0,
        pts: new Float32Array((BOLT_SEGMENTS + 1) * 3), branchFrom: 0, bn: 0,
        bpts: new Float32Array((BRANCH_SEGMENTS + 1) * 3), stamp: 0,
      });
    }
  }

  // ───────────── 发射 ─────────────

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number): void {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.05) return;
    const t = this.take(this.tracers);
    t.active = true;
    t.ax = from.x; t.ay = from.y; t.az = from.z;
    t.dx = dx / dist; t.dy = dy / dist; t.dz = dz / dist;
    t.dist = dist;
    hexToColor(color, _c);
    t.r = _c.r; t.g = _c.g; t.b = _c.b;
    t.width = width;
    t.age = 0;
    // 远距离稍长一点，保证能看见弹头飞过
    t.life = Math.min(0.1, 0.06 + dist * 0.0008);
    t.stamp = ++this.stamp;
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, duration: number, frame: number): void {
    // 连续每帧调用的光束（同一发射点、同色）合并为一条，只刷新端点与寿命，避免叠亮闪烁
    for (const bm of this.beams) {
      if (!bm.active || bm.color !== color || bm.touchedFrame === frame || bm.age <= 0) continue;
      if (bm.a.distanceToSquared(from) > 0.35 * 0.35) continue;
      bm.a.copy(from);
      bm.b.copy(to);
      bm.width = width;
      bm.touchedFrame = frame;
      // 至少再亮 duration 秒；已经在淡出的光束拉回常亮段
      bm.duration = bm.age + Math.max(bm.duration - bm.age, duration);
      bm.fadeWin = Math.min(0.12, Math.max(0.02, duration * 0.5));
      return;
    }
    const bm = this.take(this.beams);
    bm.active = true;
    bm.a.copy(from);
    bm.b.copy(to);
    bm.color = color;
    hexToColor(color, _c);
    bm.r = _c.r; bm.g = _c.g; bm.b2 = _c.b;
    bm.width = width;
    bm.age = 0;
    bm.duration = Math.max(0.03, duration);
    bm.fadeWin = Math.min(0.12, Math.max(0.02, bm.duration * 0.5));
    bm.seed = Math.random() * 100;
    bm.sparkAcc = 0;
    bm.touchedFrame = frame;
    bm.stamp = ++this.stamp;
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const bo = this.take(this.bolts);
    bo.active = true;
    bo.a.copy(from);
    bo.b.copy(to);
    hexToColor(color, _c);
    bo.r = _c.r; bo.g = _c.g; bo.b2 = _c.b;
    bo.age = 0;
    bo.life = 0.15 + Math.random() * 0.04;
    bo.rejitter = 0;
    bo.stamp = ++this.stamp;
    this.jitterBolt(bo);
    // 两端的电火花
    const n = 5;
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(to.x, to.y, to.z, jitter(6), rand(-1, 5), jitter(6), _c, rand(0.12, 0.28), 0.018, 6);
    }
    _c2.copy(_c).multiplyScalar(1.6);
    this.glow.spawn(STYLE_GLOW, to.x, to.y, to.z, 0, 0, 0, _c2, 0.9, 0.12);
    this.glow.spawn(STYLE_GLOW, from.x, from.y, from.z, 0, 0, 0, _c, 0.5, 0.1);
  }

  /** 取空闲槽，没有就复用最旧的 */
  private take<T extends { active: boolean; stamp: number }>(pool: T[]): T {
    let oldest = pool[0];
    for (const it of pool) {
      if (!it.active) return it;
      if (it.stamp < oldest.stamp) oldest = it;
    }
    return oldest;
  }

  /** 重新生成闪电折线（主干 + 一条分叉） */
  private jitterBolt(bo: Bolt): void {
    const a = bo.a, b = bo.b;
    _d.subVectors(b, a);
    const dist = _d.length();
    if (dist < 1e-4) {
      bo.n = 0;
      bo.bn = 0;
      return;
    }
    _d.divideScalar(dist);
    const ref = Math.abs(_d.y) < 0.95 ? _UP : _RIGHT;
    _u.crossVectors(_d, ref).normalize();
    _w.crossVectors(_d, _u).normalize();
    const n = Math.max(5, Math.min(BOLT_SEGMENTS, Math.round(dist / 0.65)));
    const amp = Math.min(1.1, 0.12 + dist * 0.08);
    bo.n = n;
    const p = bo.pts;
    let ou = 0, ow = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const env = Math.sin(Math.PI * t);
      // 随机游走 + 包络，端点固定
      ou = ou * 0.45 + jitter(amp);
      ow = ow * 0.45 + jitter(amp);
      const k = i === 0 || i === n ? 0 : env;
      p[i * 3] = a.x + _d.x * dist * t + (_u.x * ou + _w.x * ow) * k;
      p[i * 3 + 1] = a.y + _d.y * dist * t + (_u.y * ou + _w.y * ow) * k;
      p[i * 3 + 2] = a.z + _d.z * dist * t + (_u.z * ou + _w.z * ow) * k;
    }
    // 分叉：从中段某点斜着伸出
    if (n >= 6 && Math.random() < 0.8) {
      const from = Math.floor(n * rand(0.25, 0.7));
      bo.branchFrom = from;
      bo.bn = BRANCH_SEGMENTS;
      const bl = dist * rand(0.18, 0.32);
      const su = jitter(1), sw = jitter(1);
      const bp = bo.bpts;
      let x = p[from * 3], y = p[from * 3 + 1], z = p[from * 3 + 2];
      bp[0] = x; bp[1] = y; bp[2] = z;
      const step = bl / BRANCH_SEGMENTS;
      for (let i = 1; i <= BRANCH_SEGMENTS; i++) {
        const fx = _d.x * 0.6 + (_u.x * su + _w.x * sw) * 0.8;
        const fy = _d.y * 0.6 + (_u.y * su + _w.y * sw) * 0.8;
        const fz = _d.z * 0.6 + (_u.z * su + _w.z * sw) * 0.8;
        x += fx * step + jitter(step * 0.5);
        y += fy * step + jitter(step * 0.5);
        z += fz * step + jitter(step * 0.5);
        bp[i * 3] = x; bp[i * 3 + 1] = y; bp[i * 3 + 2] = z;
      }
    } else {
      bo.bn = 0;
    }
    bo.flicker = rand(0.55, 1);
  }

  // ───────────── 推进 & 渲染 ─────────────

  update(dt: number, batch: RibbonBatch): void {
    this.time += dt;
    this.updateTracers(dt, batch);
    this.updateBeams(dt, batch);
    this.updateBolts(dt, batch);
  }

  private updateTracers(dt: number, batch: RibbonBatch): void {
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      const k = t.age / t.life;
      if (k >= 1) {
        t.active = false;
        continue;
      }
      // 弹头在前 55% 寿命内飞完全程
      const head = t.dist * Math.min(1, (t.age + 0.012) / (t.life * 0.55));
      const streak = Math.min(t.dist * 0.5, 5);
      const tail = Math.max(0, head - streak);
      const w = t.width * 0.5;
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      // 整条淡淡的弹道
      batch.quad(
        t.ax, t.ay, t.az,
        t.ax + t.dx * head, t.ay + t.dy * head, t.az + t.dz * head,
        w * 0.15, w * 0.45,
        t.r, t.g, t.b,
        0.05 * (1 - k), 0.28 * (1 - k),
      );
      // 明亮的弹头拖尾
      batch.quad(
        t.ax + t.dx * tail, t.ay + t.dy * tail, t.az + t.dz * tail,
        t.ax + t.dx * head, t.ay + t.dy * head, t.az + t.dz * head,
        w * 0.3, w,
        t.r * 1.4, t.g * 1.4, t.b * 1.4,
        0, fade,
      );
    }
  }

  private updateBeams(dt: number, batch: RibbonBatch): void {
    for (const bm of this.beams) {
      if (!bm.active) continue;
      bm.age += dt;
      if (bm.age >= bm.duration) {
        bm.active = false;
        continue;
      }
      const a = bm.a, b = bm.b;
      const dist = a.distanceTo(b);
      const fin = Math.min(1, bm.age / 0.035 + 0.25);
      const remain = bm.duration - bm.age;
      const fout = Math.min(1, remain / bm.fadeWin);
      const alpha = fin * fout;
      const wob = 1 + 0.14 * Math.sin(this.time * 70 + bm.seed) + 0.06 * Math.sin(this.time * 131 + bm.seed * 3);
      const w = bm.width * 0.5 * wob;
      // 外层光晕
      batch.quad(a.x, a.y, a.z, b.x, b.y, b.z, w * 2.2, w * 2.4, bm.r * 0.9, bm.g * 0.9, bm.b2 * 0.9, alpha * 0.45, alpha * 0.4, RIBBON_BEAM, 0, dist);
      // 中层
      batch.quad(a.x, a.y, a.z, b.x, b.y, b.z, w, w * 1.05, bm.r * 1.3, bm.g * 1.3, bm.b2 * 1.3, alpha * 0.8, alpha * 0.75, RIBBON_BEAM, 0, dist);
      // 白热核心
      batch.quad(a.x, a.y, a.z, b.x, b.y, b.z, w * 0.3, w * 0.3, 0.8 + bm.r * 0.4, 0.8 + bm.g * 0.4, 0.8 + bm.b2 * 0.4, alpha, alpha, RIBBON_SOFT);

      if (dt > 0) {
        // 末端溅射火花与光团
        bm.sparkAcc += dt * 45;
        _c.setRGB(bm.r, bm.g, bm.b2);
        while (bm.sparkAcc >= 1) {
          bm.sparkAcc -= 1;
          this.sparks.spawn(b.x, b.y, b.z, jitter(5), rand(0, 5), jitter(5), _c, rand(0.1, 0.25), 0.02, 10);
        }
        if (Math.random() < dt * 30) {
          this.glow.spawn(STYLE_GLOW, b.x, b.y, b.z, 0, 0, 0, _c, bm.width * 5 + 0.3, 0.08);
          this.glow.spawn(STYLE_SPARK, a.x, a.y, a.z, 0, 0, 0, _c, bm.width * 2.5 + 0.15, 0.06, 0);
        }
      }
    }
  }

  private updateBolts(dt: number, batch: RibbonBatch): void {
    for (const bo of this.bolts) {
      if (!bo.active) continue;
      bo.age += dt;
      if (bo.age >= bo.life) {
        bo.active = false;
        continue;
      }
      bo.rejitter -= dt;
      if (bo.rejitter <= 0 && dt > 0) {
        bo.rejitter = 0.035;
        this.jitterBolt(bo);
      }
      const k = bo.age / bo.life;
      const alpha = (1 - k * k) * bo.flicker;
      this.drawPolyline(batch, bo.pts, bo.n, 0.09, 0.02, bo.r, bo.g, bo.b2, alpha);
      if (bo.bn > 0) this.drawPolyline(batch, bo.bpts, bo.bn, 0.055, 0.012, bo.r, bo.g, bo.b2, alpha * 0.7);
    }
  }

  private drawPolyline(batch: RibbonBatch, p: Float32Array, n: number, glowW: number, coreW: number, r: number, g: number, b: number, alpha: number): void {
    for (let i = 0; i < n; i++) {
      const o = i * 3, o2 = o + 3;
      const ax = p[o], ay = p[o + 1], az = p[o + 2];
      const bx = p[o2], by = p[o2 + 1], bz = p[o2 + 2];
      batch.quad(ax, ay, az, bx, by, bz, glowW, glowW, r, g, b, alpha * 0.55, alpha * 0.55);
      batch.quad(ax, ay, az, bx, by, bz, coreW, coreW, 0.75 + r * 0.5, 0.75 + g * 0.5, 0.75 + b * 0.5, alpha, alpha);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const t of this.tracers) if (t.active) n++;
    for (const b of this.beams) if (b.active) n++;
    for (const b of this.bolts) if (b.active) n++;
    return n;
  }

  clear(): void {
    for (const t of this.tracers) t.active = false;
    for (const b of this.beams) b.active = false;
    for (const b of this.bolts) b.active = false;
  }
}
