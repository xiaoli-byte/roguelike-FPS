/**
 * 软边界（Unity BoundaryZone.cs：SoftBoundaryTuning / BoundaryField / BoundaryTether / BoundaryZone）：
 *   · 距离场：关卡构建器从可玩区遮罩烘的有符号距离（米，区内为负），双线性采样，范围外按「边上的值 + 到范围的距离」外推；
 *   · 玩家：过了起风线就沿梯度往回推 (4 + 18 × 风力) m/s（走碰撞世界的 moveBody，照常被地形挡），白化给天气导演；
 *     越过兜底环（failsafe + 3 m）直接托回安全点（不扣血，风沙色闪屏，1 s 无敌）；起风线外不记安全落脚点；
 *   · 敌人：站到拴绳线（navInset + tetherSlack）外持续 tetherGrace 秒就沿梯度拉回界内最近的导航点。
 * 距离场保留 Unity 坐标（导出器原样写 float32）：网页世界点按 (−x, z) 采样，梯度的 x 分量取反。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import type { V3 } from './LavaCore';
import type { MechanismHost } from './Host';
import type { BoundaryData, SoftBoundaryTuning } from './MechanismData';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 软边界的调参函数（Unity SoftBoundaryTuning 的方法） */
export const SoftBoundary = {
  defaults(): SoftBoundaryTuning {
    return { softStart: 0, windRamp: 14, pushBase: 4, pushGain: 18, hazeLead: 6, failsafe: 26, navInset: 2, tetherSlack: 2, tetherGrace: 1.2 };
  },
  NavCell: 1,
  navBlockMargin(t: SoftBoundaryTuning, navCell: number): number { return t.navInset + navCell * 0.7072; },
  navReach(t: SoftBoundaryTuning, navCell: number): number { return SoftBoundary.navBlockMargin(t, navCell) + navCell * 0.7072; },
  tetherOut(t: SoftBoundaryTuning, d: number): boolean { return d > t.navInset + t.tetherSlack; },
  /** 风力 0..1（距离 d 米处） */
  wind(t: SoftBoundaryTuning, d: number): number {
    return t.windRamp > 0 ? clamp01((d - t.softStart) / t.windRamp) : d > t.softStart ? 1 : 0;
  },
  /** 推回速度：没起风为 0，一起风就是 pushBase 起步 */
  push(t: SoftBoundaryTuning, wind: number): number { return wind > 0 ? t.pushBase + t.pushGain * wind : 0; },
  pushAt(t: SoftBoundaryTuning, d: number): number { return SoftBoundary.push(t, SoftBoundary.wind(t, d)); },
  /** 白化 0..1：softStart − hazeLead 开始，风力过半时满 */
  whiteout(t: SoftBoundaryTuning, d: number): number {
    const a = t.softStart - t.hazeLead, b = t.softStart + t.windRamp * 0.55;
    const x = clamp01((d - a) / Math.max(0.01, b - a));
    return x * x * (3 - 2 * x);
  },
  /** 以 speed 一直往外顶，最终停在离等值线多远（走路 7.5 → +2.7 m，冲刺 22 → +14 m，更快 = ∞） */
  holdDepth(t: SoftBoundaryTuning, speed: number): number {
    if (speed <= t.pushBase) return t.softStart;
    if (t.pushGain <= 0) return Infinity;
    const w = (speed - t.pushBase) / t.pushGain;
    return w > 1 ? Infinity : t.softStart + w * t.windRamp;
  },
  escapeMargin(t: SoftBoundaryTuning): number { return t.failsafe + 2; },
};

/** 有符号距离场（Unity BoundaryField；Unity 坐标） */
export class BoundaryField {
  readonly cell: number;

  constructor(private readonly d: Float32Array, readonly width: number, readonly height: number, readonly origin: readonly [number, number], cell: number) {
    if (width < 2 || height < 2 || d.length < width * height) throw new Error('距离场尺寸不对');
    this.cell = Math.max(0.01, cell);
  }

  /** (x, z) 处的有符号距离（Unity 坐标） */
  sample(x: number, z: number): number {
    const { width: w, height: h, d } = this;
    const fx = (x - this.origin[0]) / this.cell, fz = (z - this.origin[1]) / this.cell;
    const cx = Math.min(Math.max(fx, 0), w - 1), cz = Math.min(Math.max(fz, 0), h - 1);
    const i = Math.min(Math.trunc(cx), w - 2), j = Math.min(Math.trunc(cz), h - 2);
    const u = cx - i, v = cz - j;
    const k = j * w + i;
    const a = d[k] + (d[k + 1] - d[k]) * u, b = d[k + w] + (d[k + w + 1] - d[k + w]) * u;
    let s = a + (b - a) * v;
    const ox = (fx - cx) * this.cell, oz = (fz - cz) * this.cell;
    if (ox !== 0 || oz !== 0) s += Math.sqrt(ox * ox + oz * oz);
    return s;
  }

  /** 距离增大的方向（往外，水平单位向量）；平坦处 [0, 0] */
  outward(x: number, z: number, e = 1.5): [number, number] {
    const gx = this.sample(x + e, z) - this.sample(x - e, z), gz = this.sample(x, z + e) - this.sample(x, z - e);
    const l = Math.sqrt(gx * gx + gz * gz);
    return l > 1e-5 ? [gx / l, gz / l] : [0, 0];
  }

  inward(x: number, z: number): [number, number] {
    const [ox, oz] = this.outward(x, z);
    return [-ox, -oz];
  }

  /** 从 (x, z) 沿梯度走到距离 target 的位置 */
  moveToDistance(x: number, z: number, target: number, steps = 6): [number, number] {
    let px = x, pz = z;
    for (let i = 0; i < steps; i++) {
      const s = this.sample(px, pz) - target;
      if (Math.abs(s) < 0.05) break;
      const [ox, oz] = this.outward(px, pz);
      if (ox === 0 && oz === 0) break;
      px -= ox * s;
      pz -= oz * s;
    }
    return [px, pz];
  }
}

/** 拴绳的落点（Unity BoundaryTether；Unity 坐标；地面 / 导航由调用方注入） */
export const BoundaryTether = {
  Depths: [3, 6, 10, 16] as const,
  GroundRadius: 4,
  WideRadius: 8,
  findPoint(field: BoundaryField, t: SoftBoundaryTuning, from: V3, ground: ((x: number, z: number) => number | null) | null,
    nav: (near: V3, radius: number) => V3 | null, last: V3 | null): V3 | null {
    const edge = t.navInset;
    const tryAt = (limit: number, near: V3, radius: number): V3 | null => {
      const hit = nav(near, radius);
      if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y) && Number.isFinite(hit.z) && field.sample(hit.x, hit.z) <= limit) return hit;
      return null;
    };
    for (const depth of BoundaryTether.Depths) {
      const [bx, bz] = field.moveToDistance(from.x, from.z, edge - depth);
      if (!(field.sample(bx, bz) <= edge)) continue;
      const gy = ground ? ground(bx, bz) : null;
      if (gy !== null && Number.isFinite(gy)) {
        const hit = tryAt(edge, { x: bx, y: gy, z: bz }, BoundaryTether.GroundRadius);
        if (hit) return hit;
      }
      const wide = tryAt(edge, { x: bx, y: from.y, z: bz }, BoundaryTether.WideRadius);
      if (wide) return wide;
    }
    if (last && Number.isFinite(last.x)) return tryAt(edge + t.tetherSlack, last, BoundaryTether.GroundRadius);
    return null;
  },
};

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const DUST = 0xdbbd8c;

/** 软边界的运行时 */
export class BoundaryZone {
  playerWind = 0;
  playerWhiteout = 0;
  playerDistance = -Infinity;
  failsafeRecoveries = 0;
  tethered = 0;
  private tetherTimer = 0;
  private lastFailsafe = -10;
  private readonly outside = new Map<IEnemy, number>();
  private readonly lastOnMesh = new Map<IEnemy, THREE.Vector3>();
  private readonly hazardOff: () => void;
  readonly tuning: SoftBoundaryTuning;

  constructor(private readonly host: MechanismHost, readonly data: BoundaryData, readonly field: BoundaryField) {
    this.tuning = { ...SoftBoundary.defaults(), ...data.tuning };
    // 起风线外不记安全落脚点：托回永远落在界内
    this.hazardOff = host.safe.registerHazard(feet => this.distance(feet) > this.tuning.softStart);
  }

  /** 网页世界点离等值线的距离（区内为负） */
  distance(p: V3): number { return this.field.sample(-p.x, p.z); }

  /** 网页世界点往界内的水平方向 */
  inwardAt(p: V3): [number, number] {
    const [ix, iz] = this.field.inward(-p.x, p.z);
    return [-ix, iz];
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.updatePlayer(dt);
    this.tetherTimer -= dt;
    if (this.tetherTimer <= 0) {
      this.tetherTimer = 0.25;
      this.tetherEnemies(0.25);
    }
  }

  private updatePlayer(dt: number): void {
    const ctx = this.host.ctx, p = ctx.player, t = this.tuning;
    if (!p.alive) {
      this.playerWind = 0;
      this.playerWhiteout = Math.max(0, this.playerWhiteout - dt * 2);
      return;
    }
    const d = this.distance(p.position);
    this.playerDistance = d;
    const w = SoftBoundary.wind(t, d);
    this.playerWind = w;
    const target = SoftBoundary.whiteout(t, d);
    this.playerWhiteout = Math.abs(target - this.playerWhiteout) <= dt * 1.6 ? target : this.playerWhiteout + Math.sign(target - this.playerWhiteout) * dt * 1.6;
    if (d > t.failsafe + 3) {
      // 技能位移 / 击飞把人送过了兜底环：直接托回（不扣血）
      const now = ctx.time.now;
      if (now - this.lastFailsafe > 1) {
        this.lastFailsafe = now;
        this.failsafeRecoveries++;
        this.host.safe.recover({ burst: 0, tick: 0, tickTimes: [], sinkTime: 0, grace: 1, element: 'none', flash: [0.9, 0.8, 0.62, 0.6], sound: 'dash' });
      }
      return;
    }
    if (w <= 0) return;
    const [gx, gz] = this.inwardAt(p.position);
    if (gx === 0 && gz === 0) return;
    // 站在地上时带一点向下分量（往回推多半是下沙丘坡），不让人被推得离地小跳
    const step = SoftBoundary.push(t, w) * dt;
    _d.set(gx * step, p.onGround ? -step : 0, gz * step);
    ctx.world.moveBody(p.position, p.radius, p.height, _d, p.onGround, 0.45);
  }

  private tetherEnemies(dt: number): void {
    const ctx = this.host.ctx, t = this.tuning;
    for (const e of [...this.outside.keys()]) if (!e.alive) { this.outside.delete(e); this.lastOnMesh.delete(e); }
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.flying || e.isBoss) continue;
      const d = this.distance(e.position);
      if (d <= t.navInset) {
        let last = this.lastOnMesh.get(e);
        if (!last) this.lastOnMesh.set(e, last = new THREE.Vector3());
        last.copy(e.position);
      }
      if (!SoftBoundary.tetherOut(t, d)) {
        this.outside.delete(e);
        continue;
      }
      const time = (this.outside.get(e) ?? 0) + dt;
      this.outside.set(e, time);
      if (time >= t.tetherGrace && this.tether(e)) this.outside.delete(e);
    }
  }

  /** 沿梯度回到导航边缘以内，在那里的地面附近找导航点传过去 */
  private tether(e: IEnemy): boolean {
    const ctx = this.host.ctx;
    const from = { x: -e.position.x, y: e.position.y, z: e.position.z };
    const lastWeb = this.lastOnMesh.get(e);
    const last = lastWeb ? { x: -lastWeb.x, y: lastWeb.y, z: lastWeb.z } : null;
    const to = BoundaryTether.findPoint(this.field, this.tuning, from,
      (x, z) => {
        const g = ctx.world.groundHeight(-x, z, 500);
        return Number.isFinite(g) ? g : null;
      },
      (near, radius) => {
        _v.set(-near.x, near.y, near.z);
        if (!ctx.nav.nearestWalkable(_v, _d) || _d.distanceTo(_v) > radius) return null;
        return { x: -_d.x, y: _d.y, z: _d.z };
      }, last);
    if (!to) return false;
    const before = e.position.clone();
    e.position.set(-to.x, to.y, to.z);
    e.velocity.set(0, 0, 0);
    ctx.fx.burst(before.setY(before.y + 0.6), DUST, 10, 3, 0.6, 0.3);
    ctx.fx.burst(_v.copy(e.position).setY(e.position.y + 0.6), DUST, 10, 3, 0.6, 0.3);
    this.tethered++;
    return true;
  }

  dispose(): void {
    this.hazardOff();
  }
}
