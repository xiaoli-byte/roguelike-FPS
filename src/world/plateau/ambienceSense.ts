/**
 * 环境声床的「耳朵」（docs/art/reference-tingyuyuan.md 第四节第 9 项）：每帧看玩家周围是什么，填 AmbienceBed.params。
 *
 * 全靠三样现成的数据，不额外摆声源：
 *  - 遮挡图的 CPU 副本（coverMap.ts 的 heightAt）：头顶有没有屋顶 / 桥面 / 檐（雨打在头上、外面的声音闷掉）、
 *    四周多少地方也盖着（檐下还是屋里）、离檐口多近（滴水）、四周的山 / 墙有多高（背风还是迎风）、周围哪里是石头房子桥面（硬表面）。
 *  - 地形（HeightGrid）：每个顶点的地表材质权重（草、岩、雪、土）决定雨落在什么上；水面高度和它的坡度分出
 *    「又宽又深还在流」= 大江大河（轰鸣）、「在流但窄浅」= 溪（潺潺）、「不流」= 湖 / 海子（拍岸）。
 *  - 风场（windAt）和湿度（WORLD_UNIFORMS.uWet：雨停了檐口还要滴一阵）。
 *
 * 一圈圈采样（12 个方向 × 几个半径，约 200 次查表）每 0.15 s 做一次；声像每帧按镜头朝向算。
 */
import * as THREE from 'three';
import type { AmbienceParams } from '../../audio/AmbienceBed';
import type { CoverMapResult } from './coverMap';
import type { HeightGrid } from './grid';
import { WORLD_UNIFORMS } from './materials';

export interface AmbienceSenseOpts {
  /** 风场（4-1 飞廉 / 4-2 峡谷风的 windAt）：strength 0..1 加在基础风上，方向定风的声像 */
  windAt?: (x: number, z: number) => { dx: number; dz: number; strength: number };
  /** 晴天的基础风（高原上一直有风），缺省 0.32 */
  baseWind?: number;
  /** 静水拍岸的倍率（4-4 已经有 WaterSound 的拍岸声，给 0） */
  lap?: number;
  /**
   * 高原场景在世界里转了 180°（正式游戏：plateau/stage/layer.ts）：地形、材质、水面、风场按高原坐标查（x、z 取反），
   * 遮挡图、声像按世界坐标
   */
  flip?: boolean;
}

const DIRS = 12;
const RING_NEAR = [1.5, 3, 5];
const RING_SURF = [2, 5, 9, 14];
const RING_SHELTER = [10, 25, 50];
const RING_WATER = [4, 9, 18, 35, 70, 120];
const COS = Array.from({ length: DIRS }, (_, i) => Math.cos((i + 0.5) / DIRS * Math.PI * 2));
const SIN = Array.from({ length: DIRS }, (_, i) => Math.sin((i + 0.5) / DIRS * Math.PI * 2));

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** 一类声源的方向累积（世界 xz） */
class DirAcc {
  x = 0; z = 0; w = 0;
  reset(): void { this.x = this.z = this.w = 0; }
  add(dx: number, dz: number, w: number): void { this.x += dx * w; this.z += dz * w; this.w += w; }
  /** 声像：方向集中时偏到那一边，四面都有时居中 */
  pan(rx: number, rz: number): number {
    const l = Math.hypot(this.x, this.z);
    if (l < 1e-6 || this.w < 1e-6) return 0;
    const focus = Math.min(1, l / this.w * 1.4);
    return Math.max(-1, Math.min(1, (this.x * rx + this.z * rz) / l)) * 0.85 * focus;
  }
}

export class AmbienceSense {
  private scanIn = 0;
  private roof = 0;
  private indoor = 0;
  private drip = 0;
  private soft = 1;
  private hard = 0;
  private water = 0;
  private snow = 0;
  private exposure = 1;
  private roar = 0;
  private stream = 0;
  private lap = 0;
  private readonly roarDir = new DirAcc();
  private readonly streamDir = new DirAcc();
  private readonly lapDir = new DirAcc();
  private readonly dripDir = new DirAcc();
  private readonly windDir = new THREE.Vector2(1, 0);
  private windK = 0;

  /** 世界坐标 → 高原坐标的符号（flip 时 −1） */
  private readonly S: number;

  constructor(private readonly terrain: HeightGrid, private readonly cover: CoverMapResult | null, private readonly opts: AmbienceSenseOpts = {}) {
    this.S = opts.flip ? -1 : 1;
  }

  /** 某处头顶最高表面的高度：先查遮挡图，图外 / 没有就用地面和水面 */
  private top(x: number, z: number): number {
    const h = this.cover ? this.cover.heightAt(x, z) : -1e4;
    if (h > -1e3) return h;
    const S = this.S;
    return Math.max(this.terrain.heightAt(S * x, S * z), this.terrain.waterLevelAt(S * x, S * z));
  }

  /** 每帧：rain = 雨强（Weather.level）；结果写进 out（AmbienceBed.params） */
  update(dt: number, camera: THREE.Camera, rain: number, out: AmbienceParams): void {
    camera.getWorldPosition(_eye);
    this.scanIn -= dt;
    if (this.scanIn <= 0) { this.scanIn = 0.15; this.scan(_eye); }
    _right.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q));
    const rl = Math.hypot(_right.x, _right.z) || 1, rx = _right.x / rl, rz = _right.z / rl;
    const wet = WORLD_UNIFORMS.uWet.value as number;
    out.rain = rain;
    out.wind = clamp01((this.opts.baseWind ?? 0.32) + 0.35 * this.windK + 0.45 * rain);
    out.exposure = this.exposure;
    // 风从上风来：声像偏向上风那边
    out.windPan = -(this.windDir.x * rx + this.windDir.y * rz) * 0.4;
    out.soft = this.soft; out.hard = this.hard; out.water = this.water; out.snow = this.snow;
    out.roof = this.roof;
    out.indoor = this.indoor;
    out.drip = this.drip * clamp01(Math.max(rain * 1.2, wet * 0.7));
    out.dripPan = this.dripDir.pan(rx, rz);
    out.roar = this.roar; out.roarPan = this.roarDir.pan(rx, rz);
    out.stream = this.stream; out.streamPan = this.streamDir.pan(rx, rz);
    out.lap = this.lap * (this.opts.lap ?? 1); out.lapPan = this.lapDir.pan(rx, rz);
  }

  private scan(e: THREE.Vector3): void {
    const T = this.terrain, S = this.S;
    // ── 头顶、四周、檐口 ──
    const over = this.top(e.x, e.z) - e.y;
    this.roof = smooth(0.15, 0.8, over);
    let covered = 0, total = 0, coveredNear = 0, totalNear = 0;
    this.dripDir.reset();
    const under = this.roof > 0.5;
    for (const r of RING_NEAR) for (let d = 0; d < DIRS; d++) {
      const x = e.x + COS[d] * r, z = e.z + SIN[d] * r;
      const c = this.top(x, z) - e.y > 0.15;
      if (c) covered++;
      total++;
      if (r <= 3) { totalNear++; if (c) coveredNear++; }
      // 檐下：滴水落在外头没盖的地方；檐外：滴水从旁边盖着的檐口落下来
      if (c !== under) this.dripDir.add(COS[d], SIN[d], 1 / r);
    }
    const cf = covered / total;
    this.indoor = this.roof * (0.25 + 0.75 * cf);
    // 正好在檐口（一半盖着一半露天）滴水最多；檐外要贴着檐才听得见
    this.drip = under ? Math.min(1, 2.2 * (1 - cf)) : Math.min(1, 3 * coveredNear / totalNear);
    // ── 雨落在什么上 ──
    let soft = 0, hard = 0, water = 0, snow = 0;
    const surf = (x: number, z: number, w: number): void => {
      const g = T.heightAt(S * x, S * z), wl = T.waterLevelAt(S * x, S * z), top = this.top(x, z);
      if (wl > g + 0.05 && top < wl + 0.3) { water += w; return; }
      if (top - g > 0.8) { hard += w; return; }   // 屋顶、墙头、桥面、大石头
      const i = Math.round((S * x - T.minX) / T.step), j = Math.round((S * z - T.minZ) / T.step);
      if (i < 0 || j < 0 || i >= T.nx || j >= T.nz) { soft += w; return; }
      const k = (j * T.nx + i) * 4, m = T.mat;
      const sum = m[k] + m[k + 1] + m[k + 2] + m[k + 3] || 1;
      soft += w * (m[k] + m[k + 3]) / sum; hard += w * m[k + 1] / sum; snow += w * m[k + 2] / sum;
    };
    surf(e.x, e.z, 1.5);
    for (const r of RING_SURF) for (let d = 0; d < DIRS; d++) surf(e.x + COS[d] * r, e.z + SIN[d] * r, 1 / (1 + r / 6));
    const sw = soft + hard + water + snow || 1;
    this.soft = soft / sw; this.hard = hard / sw; this.water = water / sw; this.snow = snow / sw;
    // ── 背风 / 迎风：四周的山、墙有多高（仰角） ──
    let shelter = 0;
    for (let d = 0; d < DIRS; d++) {
      let el = 0;
      for (const r of RING_SHELTER) el = Math.max(el, (this.top(e.x + COS[d] * r, e.z + SIN[d] * r) - e.y) / r);
      shelter += Math.min(1, Math.max(0, el) / 0.5);
    }
    this.exposure = (1 - 0.8 * shelter / DIRS) * (1 - 0.5 * this.indoor);
    // ── 水：江、溪、静水 ──
    let roar = 0, stream = 0, lap = 0;
    this.roarDir.reset(); this.streamDir.reset(); this.lapDir.reset();
    const waterAt = (x: number, z: number, dx: number, dz: number, r: number, mul: number): void => {
      const lx = S * x, lz = S * z;
      const wl = T.waterLevelAt(lx, lz), depth = wl - T.heightAt(lx, lz);
      if (!(depth > 0.05)) return;
      const gx = (T.waterLevelAt(lx + 3, lz) - T.waterLevelAt(lx - 3, lz)) / 6, gz = (T.waterLevelAt(lx, lz + 3) - T.waterLevelAt(lx, lz - 3)) / 6;
      const slope = Math.hypot(gx, gz);
      const flow = Number.isFinite(slope) ? smooth(0.004, 0.012, slope) : 0;
      const big = smooth(1.0, 2.2, depth);
      const wr = flow * big / (1 + r / 40) * mul, ws = flow * (1 - big) / (1 + (r / 12) ** 2) * mul, wlp = (1 - flow) / (1 + (r / 10) ** 2) * mul;
      roar += wr; stream += ws; lap += wlp;
      this.roarDir.add(dx, dz, wr); this.streamDir.add(dx, dz, ws); this.lapDir.add(dx, dz, wlp);
    };
    waterAt(e.x, e.z, 0, 0, 0, 3);
    for (const r of RING_WATER) for (let d = 0; d < DIRS; d++) waterAt(e.x + COS[d] * r, e.z + SIN[d] * r, COS[d], SIN[d], r, 1);
    this.roar = clamp01(roar * 1.6 / DIRS);
    this.stream = clamp01(stream * 5 / DIRS);
    // 江边听不见拍岸（三江口的缓水区也算静水，但轰鸣早盖住了）
    this.lap = clamp01(lap * 3 / DIRS) * (1 - this.roar);
    // ── 风场 ──
    const w = this.opts.windAt?.(S * e.x, S * e.z);
    if (w) { this.windK = w.strength; this.windDir.set(S * w.dx, S * w.dz); } else this.windK = 0;
  }
}
