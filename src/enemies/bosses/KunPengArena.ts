/**
 * 鲲鹏的场地：冰窟的几何（Unity KunPeng/IceHole.cs 的 IceHoleInfo）——圆心（y = 环台地面）、冰窟半径、环台外缘半径、水面高度。
 * 角度有两套：IceHoleInfo 的方法用世界 yaw（度，0 = +Z，同 Unity）；holePoint / holeAngle 用弧度（facing 约定），给老代码和火麒麟用。
 *
 * 冰窟从哪来（resolveIceHole，按先后）：
 *  1. Unity 场景（2-4 北冥冰台）：关卡登记的水体（stageHooks.water）里离首领最近、近似圆形的那一段——构建器把北冥海放成边长 2 × (冰窟半径 + 1) 的水块，
 *     水面 = 冰窟标记高度 + 0.06（IceHole.DefaultWaterLevel）。所以圆心 = 水块中心、半径 = 边长 / 2 − 1、环台地面 = 水面 − 0.06，
 *     外缘 = 场景文档里首领场的半径（没有时取 IceHole 的缺省 44）。Unity 的 IceHole 标记本身没导出，这样反推出来的数和标记一致（15 / 44 / 0.06）。
 *  2. 白盒关卡（frost-5 V2）：locateIceHole 从导航网格反推（不可通行、被可通行地面围住、近似圆形的最大一块）。
 *  3. 都没有：虚拟冰窟（场地中心、半径 6、found = false），首领照常出招，只是冰窟没有地形洞。
 */
import * as THREE from 'three';
import type { ArenaInfo, INavGrid } from '../../core/types';

export interface IceHole {
  /** 冰窟圆心（世界坐标，y = 环台地面高度） */
  readonly center: THREE.Vector3;
  /** 冰窟半径（米） */
  readonly radius: number;
  /** 环台外缘半径（米） */
  readonly outer: number;
  /** 是否真的找到了冰窟（false = 虚拟冰窟） */
  readonly found: boolean;
}

const DEG = Math.PI / 180;

/** 冰窟几何（Unity IceHoleInfo 逐项照搬） */
export class IceHoleInfo implements IceHole {
  /** 虚拟冰窟的半径（米） */
  static readonly FallbackRadius = 6;
  /** 水面相对环台地面的缺省高度（Unity IceHole.DefaultWaterLevel） */
  static readonly DefaultWaterLevel = 0.06;

  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly outer: number;
  readonly waterY: number;
  readonly found: boolean;

  constructor(center: THREE.Vector3, radius: number, outer: number, waterY: number, found: boolean) {
    this.center = center.clone();
    this.radius = Math.max(0.5, radius);
    this.outer = Math.max(this.radius + 2, outer);
    this.waterY = waterY;
    this.found = found;
  }

  /** 环台地面高度（= 圆心的 y） */
  get floorY(): number {
    return this.center.y;
  }

  /** 环台中线半径（冰窟边与外缘的正中，鹏绕着它盘旋、落台） */
  get midRing(): number {
    return (this.radius + this.outer) * 0.5;
  }

  /** 从圆心朝 yaw（度）方向、离圆心 dist 米的点（y = 环台地面） */
  point(yawDeg: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = yawDeg * DEG;
    return out.set(this.center.x + Math.sin(a) * dist, this.center.y, this.center.z + Math.cos(a) * dist);
  }

  /** 点相对圆心的方位（yaw，度）。在圆心上时为 0 */
  angle(p: { x: number; z: number }): number {
    const dx = p.x - this.center.x, dz = p.z - this.center.z;
    return dx * dx + dz * dz < 1e-8 ? 0 : Math.atan2(dx, dz) / DEG;
  }

  /** 点离圆心的水平距离 */
  distance(p: { x: number; z: number }): number {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z);
  }

  /** 把点夹到环台上：离冰窟边 inner 米以外、离外缘 outerMargin 米以内，高度不变 */
  clampToRing(p: THREE.Vector3, inner = 1, outerMargin = 1.5, out = new THREE.Vector3()): THREE.Vector3 {
    let dx = p.x - this.center.x, dz = p.z - this.center.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-4) {
      dx = 0;
      dz = 1;
      d = 1;
    }
    const lo = this.radius + inner, hi = Math.max(lo, this.outer - outerMargin);
    const r = Math.min(hi, Math.max(lo, d));
    return out.set(this.center.x + dx / d * r, p.y, this.center.z + dz / d * r);
  }

  /** 水平方向在冰窟里（离圆心不到 radius + pad） */
  overHole(p: { x: number; z: number }, pad = 0): boolean {
    return this.distance(p) < this.radius + pad;
  }

  /**
   * 没有冰窟时的虚拟冰窟：圆心 = 场地中心（没有场地时 near），半径 6，外缘 = 场地尺度 − 3（至少 14），水面 = 地面 + 0.06
   */
  static fallback(center: THREE.Vector3 | null, extent: number | null, near: THREE.Vector3): IceHoleInfo {
    const c = (center ?? near).clone();
    const outer = extent !== null ? Math.max(IceHoleInfo.FallbackRadius + 8, extent - 3) : 30;
    return new IceHoleInfo(c, IceHoleInfo.FallbackRadius, outer, c.y + IceHoleInfo.DefaultWaterLevel, false);
  }

  toString(): string {
    const c = this.center;
    return `冰窟 ${this.found ? '' : '（虚拟）'}圆心 (${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)})，半径 ${this.radius.toFixed(1)}，外缘 ${this.outer.toFixed(1)}，水面 y ${this.waterY.toFixed(2)}`;
  }
}

/** 水体（stageHooks.water 登记的一段；只读需要的字段） */
export interface HoleWaterBody {
  readonly name: string;
  readonly center: THREE.Vector3;
  readonly scale: THREE.Vector3;
}

/** IceHole 组件的缺省外缘（2-4 构建器写的也是 44） */
export const DEFAULT_OUTER = 44;

/**
 * 从关卡的水体反推冰窟（Unity 场景）：离 near 最近、在 maxDistance 内、俯视近似正方形（构建器放的是方水块，圆形冰窟内切）的一段。
 * 找不到返回 null
 */
export function holeFromWater(bodies: readonly HoleWaterBody[], near: THREE.Vector3, outer: number | null, maxDistance = 60): IceHoleInfo | null {
  let best: HoleWaterBody | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    const sx = Math.abs(b.scale.x), sz = Math.abs(b.scale.z);
    if (!(sx > 4 && sz > 4) || Math.abs(sx - sz) > 0.25 * Math.max(sx, sz)) continue;
    const d = Math.hypot(b.center.x - near.x, b.center.z - near.z);
    if (d > maxDistance || d >= bestD) continue;
    best = b;
    bestD = d;
  }
  if (!best) return null;
  const top = best.center.y + Math.abs(best.scale.y) / 2;
  const floor = top - IceHoleInfo.DefaultWaterLevel;
  const radius = Math.min(Math.abs(best.scale.x), Math.abs(best.scale.z)) / 2 - 1;
  return new IceHoleInfo(new THREE.Vector3(best.center.x, floor, best.center.z), radius, outer ?? DEFAULT_OUTER, top, true);
}

/** 冰窟至少多大才算（平方米）：冰柱、矮墙、祭台都比它小得多 */
const MIN_AREA = 120;
/** 等面积圆半径的倍数：块内最远点超过它就不是「圆窟」（细长的墙体、走廊尽头的山体） */
const ROUNDNESS = 1.45;
const FALLBACK_RADIUS = IceHoleInfo.FallbackRadius;

/**
 * 白盒关卡：从导航网格里找出中央冰窟。以 1 米步长采样整个竞技场的 nav.isWalkable，把不可通行的格子按 4 邻接分块；
 * 碰到采样边界的块是外围山体 / 围墙，剩下被可通行地面完全围住、面积最大且接近圆形的那一块是冰窟（圆心 = 质心，半径 = 等面积圆半径）；
 * 外缘半径：从圆心沿 32 个方向向外走到第一个不可通行格，取中位数。找不到时退回虚拟冰窟。
 */
export function locateIceHole(nav: INavGrid | null | undefined, arena: ArenaInfo | null | undefined, near?: THREE.Vector3): IceHoleInfo {
  const floorY = arena?.floorY ?? 0;
  const fallback = (): IceHoleInfo => {
    const c = arena ? arena.center.clone() : (near ? near.clone() : new THREE.Vector3());
    c.y = floorY;
    const half = arena ? Math.min(arena.maxX - arena.minX, arena.maxZ - arena.minZ) / 2 : 30;
    return new IceHoleInfo(c, FALLBACK_RADIUS, Math.max(FALLBACK_RADIUS + 8, half - 3), floorY + IceHoleInfo.DefaultWaterLevel, false);
  };
  if (!nav || !arena) return fallback();
  const step = 1;
  const x0 = arena.minX + step / 2;
  const z0 = arena.minZ + step / 2;
  const cols = Math.max(1, Math.floor((arena.maxX - arena.minX) / step));
  const rows = Math.max(1, Math.floor((arena.maxZ - arena.minZ) / step));
  if (cols * rows > 400 * 400) return fallback();
  const open = new Uint8Array(cols * rows);
  let anyOpen = false;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const w = nav.isWalkable(x0 + i * step, z0 + j * step);
      open[j * cols + i] = w ? 1 : 0;
      if (w) anyOpen = true;
    }
  }
  if (!anyOpen) return fallback();

  // 不可通行块的 4 邻接分量
  const comp = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let best: { area: number; cx: number; cz: number; far: number } | null = null;
  let id = 0;
  for (let s = 0; s < cols * rows; s++) {
    if (open[s] || comp[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    let touches = false;
    let sx = 0;
    let sz = 0;
    let n = 0;
    while (head < tail) {
      const c = queue[head++];
      const i = c % cols;
      const j = (c - i) / cols;
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) touches = true;
      sx += i;
      sz += j;
      n++;
      const nb = [i > 0 ? c - 1 : -1, i < cols - 1 ? c + 1 : -1, j > 0 ? c - cols : -1, j < rows - 1 ? c + cols : -1];
      for (const k of nb) {
        if (k < 0 || open[k] || comp[k] >= 0) continue;
        comp[k] = id;
        queue[tail++] = k;
      }
    }
    if (!touches && n * step * step >= MIN_AREA && (!best || n > best.area)) {
      const ci = sx / n;
      const cj = sz / n;
      // 块内离质心最远的格子（圆度判定）
      let far = 0;
      for (let q = 0; q < tail; q++) {
        const c = queue[q];
        const i = c % cols;
        const j = (c - i) / cols;
        far = Math.max(far, Math.hypot(i - ci, j - cj));
      }
      const req = Math.sqrt(n / Math.PI);
      if (far <= req * ROUNDNESS + 1) best = { area: n, cx: ci, cz: cj, far };
    }
    id++;
  }
  if (!best) return fallback();
  const center = new THREE.Vector3(x0 + best.cx * step, floorY, z0 + best.cz * step);
  const radius = Math.sqrt((best.area * step * step) / Math.PI);

  // 外缘：沿 32 个方向走到第一个不可通行处，取中位数
  const reach: number[] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let r = radius + 1.5;
    while (r < 120 && nav.isWalkable(center.x + dx * r, center.z + dz * r)) r += 0.5;
    reach.push(r);
  }
  reach.sort((a, b) => a - b);
  const outer = Math.max(radius + 6, reach[reach.length >> 1]);
  return new IceHoleInfo(center, radius, outer, floorY + IceHoleInfo.DefaultWaterLevel, true);
}

/** 冰窟边缘朝 angle（弧度，facing 约定：atan2(dx, dz)）方向、离圆心 dist 米的点 */
export function holePoint(hole: IceHole, angle: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(hole.center.x + Math.sin(angle) * dist, hole.center.y, hole.center.z + Math.cos(angle) * dist);
}

/** 点 (x, z) 相对冰窟圆心的方位角（弧度，facing 约定） */
export function holeAngle(hole: IceHole, x: number, z: number): number {
  return Math.atan2(x - hole.center.x, z - hole.center.z);
}
