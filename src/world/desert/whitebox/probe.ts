import { WB_METRICS, type V2, type WbSite, type WhiteboxSpec } from './types';
import { pointInPolygon, type WbTerrain } from './terrain';

/**
 * 白盒可达性探针：在 0.5 m 的行走面上实测——不是看图。
 *   能走 = 相邻两格高差 ≤ 0.45 m（迈台阶）或坡 ≤ 40°；水深 > 1.1 m、可玩区外、图边不能走；主线不靠跳。
 *   宽度 = 到最近「走不过去的边」的距离 × 2（距离变换）。
 * 查：每条走法逐段寻路（长度、最陡 3 m 的坡度、最窄处宽度）、每个据点 / 驻守点 / 藏宝 / 出口从出生点走得到、
 * 据点场地有多少面积能走、怪从入场点走得到最近的据点（按怪的体宽）、跃下点的落差、地标视线。
 */
export interface PathResult {
  ok: boolean;
  /** 沿路的点（拉直后每 1 m 一个），画路线用 */
  pts: V2[];
  length: number;
  /** 最陡 3 m 的坡度（度）和它在哪 */
  maxSlope: number;
  steepAt: V2 | null;
  /** 最窄处的宽度（m）和它在哪 */
  minWidth: number;
  narrowAt: V2 | null;
  climb: number;
  /** 找不到够宽的路、退回只按玩家体宽找到的 */
  squeezed: boolean;
}

export interface RouteReport {
  id: string;
  name: string;
  kind: 'main' | 'alt';
  ok: boolean;
  length: number;
  seconds: number;
  maxSlope: number;
  steepAt: V2 | null;
  minWidth: number;
  narrowAt: V2 | null;
  climb: number;
  pts: V2[];
  problems: string[];
}

export interface ProbeRow {
  kind: string;
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface ProbeReport {
  id: string;
  name: string;
  routes: RouteReport[];
  rows: ProbeRow[];
  failures: number;
  /** 可走面积（m²）与占全图的比例 */
  walkArea: number;
  walkShare: number;
}

const deg = (slope: number): number => Math.atan(slope) * 180 / Math.PI;
const fmt = (p: V2 | null): string => p ? `(${p[0].toFixed(0)}, ${p[1].toFixed(0)})` : '';

class Heap {
  private readonly items: number[] = [];
  constructor(private readonly key: Float32Array) {}
  get size(): number { return this.items.length; }
  push(v: number): void {
    const a = this.items, key = this.key;
    let i = a.length;
    a.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[a[p]] <= key[v]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.items, key = this.key, top = a[0], last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && key[a[c + 1]] < key[a[c]]) c++;
        if (key[a[c]] >= key[last]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export class WhiteboxProbe {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  /** 这一格本身不能站（深水、界外、图边） */
  readonly blocked: Uint8Array;
  /** 到最近「走不过去的边」的距离（m） */
  readonly clearance: Float32Array;
  /** 从出生点走得到（按玩家体宽） */
  readonly reach: Uint8Array;
  private readonly h: Float32Array;
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private tick = 0;

  constructor(readonly terrain: WbTerrain) {
    const { nx, nz, cell, spec } = terrain;
    this.nx = nx;
    this.nz = nz;
    this.cell = cell;
    this.h = terrain.walk;
    const n = nx * nz;
    this.blocked = new Uint8Array(n);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix, x = ix * cell, z = iz * cell;
        if (ix < 2 || iz < 2 || ix > nx - 3 || iz > nz - 3) this.blocked[i] = 1;
        else if (spec.play && !pointInPolygon(x, z, spec.play)) this.blocked[i] = 1;
        else for (const w of spec.water ?? []) if (w.level - this.h[i] > 1.1 && pointInPolygon(x, z, w.pts)) this.blocked[i] = 1;
      }
    }
    // 站不住的陡坡：这一格自己的坡度 > 40° 就不能站（不然沿等高线横穿 50° 的沙面也算能走——相邻格高差小，
    // 只比高差查不出来）。坡度用两侧的差算；某一侧是墙 / 崖（高差 > 迈台阶）就只用另一侧——墙脚、台沿那一格本身是平的
    const maxGrad = Math.tan(WB_METRICS.maxSlope * Math.PI / 180) * 1.05, step = WB_METRICS.step;
    const axis = (i: number, o: number): number => {
      const a = this.h[i] - this.h[i - o], b = this.h[i + o] - this.h[i];
      const ua = Math.abs(a) <= step, ub = Math.abs(b) <= step;
      return ua && ub ? (Math.abs(a) + Math.abs(b)) / 2 : ua ? Math.abs(a) : ub ? Math.abs(b) : 0;
    };
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (!this.blocked[i] && Math.hypot(axis(i, 1), axis(i, nx)) / cell > maxGrad) this.blocked[i] = 1;
      }
    }
    // 距离变换：源 = 不能站的格，或和四邻之一高差过大的格（崖沿、墙脚）
    const INF = 1e9, d = this.clearance = new Float32Array(n).fill(INF);
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        if (this.blocked[i] || Math.abs(this.h[i] - this.h[i - 1]) > WB_METRICS.step || Math.abs(this.h[i] - this.h[i + 1]) > WB_METRICS.step
          || Math.abs(this.h[i] - this.h[i - nx]) > WB_METRICS.step || Math.abs(this.h[i] - this.h[i + nx]) > WB_METRICS.step) d[i] = 0;
      }
    }
    for (let i = 0; i < n; i++) if (this.blocked[i]) d[i] = 0;
    const a = cell, b = cell * Math.SQRT2;
    for (let iz = 1; iz < nz - 1; iz++) for (let ix = 1; ix < nx - 1; ix++) {
      const i = iz * nx + ix;
      d[i] = Math.min(d[i], d[i - 1] + a, d[i - nx] + a, d[i - nx - 1] + b, d[i - nx + 1] + b);
    }
    for (let iz = nz - 2; iz > 0; iz--) for (let ix = nx - 2; ix > 0; ix--) {
      const i = iz * nx + ix;
      d[i] = Math.min(d[i], d[i + 1] + a, d[i + nx] + a, d[i + nx + 1] + b, d[i + nx - 1] + b);
    }
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.reach = this.flood(spec.spawn.at, 0);
  }

  index(p: V2): number {
    return Math.min(this.nz - 1, Math.max(0, Math.round(p[1] / this.cell))) * this.nx + Math.min(this.nx - 1, Math.max(0, Math.round(p[0] / this.cell)));
  }

  point(i: number): V2 {
    return [(i % this.nx) * this.cell, Math.floor(i / this.nx) * this.cell];
  }

  /** i → j 这一步迈不迈得过去（j 是 i 的八邻之一） */
  private stepOk(i: number, j: number, diagonal: boolean): boolean {
    if (this.blocked[j]) return false;
    const limit = diagonal ? Math.max(WB_METRICS.step, Math.tan(WB_METRICS.maxSlope * Math.PI / 180) * this.cell * Math.SQRT2) : WB_METRICS.step;
    return Math.abs(this.h[i] - this.h[j]) <= limit;
  }

  private neighbors(i: number, fn: (j: number, dist: number) => void): void {
    const nx = this.nx;
    const e = this.stepOk(i, i + 1, false), w = this.stepOk(i, i - 1, false), s = this.stepOk(i, i + nx, false), n = this.stepOk(i, i - nx, false);
    if (e) fn(i + 1, this.cell);
    if (w) fn(i - 1, this.cell);
    if (s) fn(i + nx, this.cell);
    if (n) fn(i - nx, this.cell);
    // 斜着走不许蹭墙角：两条直边都得过得去
    const dd = this.cell * Math.SQRT2;
    if (e && s && this.stepOk(i, i + nx + 1, true)) fn(i + nx + 1, dd);
    if (e && n && this.stepOk(i, i - nx + 1, true)) fn(i - nx + 1, dd);
    if (w && s && this.stepOk(i, i + nx - 1, true)) fn(i + nx - 1, dd);
    if (w && n && this.stepOk(i, i - nx - 1, true)) fn(i - nx - 1, dd);
  }

  /** 最近的能站的格（离墙 ≥ minClear）；半径 reach 米内找不到返回 -1 */
  snap(p: V2, minClear = 0, reach = 4): number {
    const c = this.index(p);
    if (!this.blocked[c] && this.clearance[c] >= minClear) return c;
    const r = Math.ceil(reach / this.cell), cx = c % this.nx, cz = Math.floor(c / this.nx);
    let best = -1, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 1 || z < 1 || x >= this.nx - 1 || z >= this.nz - 1) continue;
      const i = z * this.nx + x, dist = dx * dx + dz * dz;
      if (dist < bd && !this.blocked[i] && this.clearance[i] >= minClear) { bd = dist; best = i; }
    }
    return best;
  }

  /** 从 p 出发走得到的所有格（离墙 ≥ minClear） */
  flood(p: V2, minClear: number): Uint8Array {
    const out = new Uint8Array(this.nx * this.nz), start = this.snap(p, minClear);
    if (start < 0) return out;
    const queue = [start];
    out[start] = 1;
    for (let k = 0; k < queue.length; k++) {
      this.neighbors(queue[k], j => {
        if (out[j] || this.clearance[j] < minClear) return;
        out[j] = 1;
        queue.push(j);
      });
    }
    return out;
  }

  /** A*：离墙 ≥ minClear 的格上寻路（起终点 3 m 内放宽——点位常贴着掩体或台沿）。偏好宽的、缓的 */
  private search(a: V2, b: V2, minClear: number): number[] | null {
    const start = this.snap(a, 0), goal = this.snap(b, 0);
    if (start < 0 || goal < 0) return null;
    const { g, f, parent, stamp, closed, nx, cell } = this, tick = ++this.tick;
    const gx = goal % nx, gz = Math.floor(goal / nx), sx = start % nx, sz = Math.floor(start / nx);
    const relax = 3 / cell;
    const heuristic = (i: number): number => Math.hypot((i % nx) - gx, Math.floor(i / nx) - gz) * cell;
    const heap = new Heap(f);
    g[start] = 0;
    f[start] = heuristic(start);
    parent[start] = -1;
    stamp[start] = tick;
    heap.push(start);
    while (heap.size) {
      const i = heap.pop();
      if (i === goal) {
        const out: number[] = [];
        for (let k = goal; k >= 0; k = parent[k]) out.push(k);
        return out.reverse();
      }
      if (closed[i] === tick) continue;
      closed[i] = tick;
      const gi = g[i];
      this.neighbors(i, (j, dist) => {
        const c = this.clearance[j];
        if (c < minClear) {
          const jx = j % nx, jz = Math.floor(j / nx);
          if (Math.hypot(jx - gx, jz - gz) > relax && Math.hypot(jx - sx, jz - sz) > relax) return;
        }
        const slope = Math.abs(this.h[i] - this.h[j]) / dist;
        const cost = dist * (1 + 2.5 * Math.max(0, slope - 0.3) + (c < 4 ? (4 - c) * 0.06 : 0));
        const next = gi + cost;
        if (closed[j] === tick || (stamp[j] === tick && next >= g[j])) return;
        stamp[j] = tick;
        g[j] = next;
        f[j] = next + heuristic(j);
        parent[j] = i;
        heap.push(j);
      });
    }
    return null;
  }

  /** a、b 两格之间的直线走不走得通：每半格采一个点，逐点迈得过去、离墙不比两端里窄的那头更近 */
  private lineOk(a: number, b: number, minClear: number): boolean {
    const nx = this.nx, ax = a % nx, az = Math.floor(a / nx), bx = b % nx, bz = Math.floor(b / nx);
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    const need = Math.min(minClear, this.clearance[a], this.clearance[b]);
    let prev = a;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, i = Math.round(az + (bz - az) * t) * nx + Math.round(ax + (bx - ax) * t);
      if (i === prev) continue;
      if (this.blocked[i] || this.clearance[i] < need || Math.abs(this.h[i] - this.h[prev]) > WB_METRICS.step) return false;
      prev = i;
    }
    return true;
  }

  /**
   * a → b 的路：先按 width 要的宽度找，找不到再只按玩家体宽找（squeezed）。格子路径用视线拉直（人不会走 45° 的锯齿），
   * 再每 1 m 采一个点量长度 / 最陡 3 m / 最窄处。
   */
  path(a: V2, b: V2, width: number): PathResult {
    let cells = this.search(a, b, width / 2), squeezed = false;
    if (!cells) {
      cells = this.search(a, b, this.cell);
      squeezed = true;
    }
    if (!cells) return { ok: false, pts: [], length: 0, maxSlope: 0, steepAt: null, minWidth: 0, narrowAt: null, climb: 0, squeezed: true };
    // 拉直：从当前点往前找最远的、直线走得通的点（最多看 40 m，别离寻路走廊太远）
    const minClear = squeezed ? this.cell : width / 2, keep: number[] = [cells[0]];
    for (let i = 0; i < cells.length - 1;) {
      let j = Math.min(cells.length - 1, i + 80);
      while (j > i + 1 && !this.lineOk(cells[i], cells[j], minClear)) j--;
      keep.push(cells[j]);
      i = j;
    }
    // 每 1 m 采样
    const pts: V2[] = [];
    for (let k = 0; k < keep.length - 1; k++) {
      const p = this.point(keep[k]), q = this.point(keep[k + 1]), len = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(len));
      for (let s = 0; s < n; s++) pts.push([p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n]);
    }
    pts.push(this.point(keep[keep.length - 1]));
    const n = pts.length, s = new Float32Array(n), hs = new Float32Array(n);
    let climb = 0;
    for (let k = 0; k < n; k++) {
      hs[k] = this.h[this.index(pts[k])];
      if (k) {
        s[k] = s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        climb += Math.max(0, hs[k] - hs[k - 1]);
      }
    }
    const length = s[n - 1];
    let maxSlope = 0, steepAt: V2 | null = null;
    for (let k = 0, j = 0; k < n; k++) {
      while (j < n - 1 && s[j] - s[k] < 3) j++;
      const run = s[j] - s[k];
      if (run < 2.5) break;
      const slope = Math.abs(hs[j] - hs[k]) / run;
      if (slope > maxSlope) { maxSlope = slope; steepAt = pts[(k + j) >> 1]; }
    }
    // 最窄处：去掉两头各 4 m（点位贴着墙 / 掩体是正常的）
    let minC = Infinity, narrowAt: V2 | null = null;
    for (let k = 0; k < n; k++) {
      if (s[k] < 4 || length - s[k] < 4) continue;
      const c = this.clearance[this.index(pts[k])];
      if (c < minC) { minC = c; narrowAt = pts[k]; }
    }
    if (!Number.isFinite(minC)) minC = this.clearance[this.index(pts[n >> 1])];
    return { ok: true, pts, length, maxSlope: deg(maxSlope), steepAt, minWidth: minC * 2, narrowAt, climb, squeezed };
  }

  /**
   * 从 from（眼高）看 to 顶上往下 span 米这一段，看得见多少米。
   * skip = 目标自己占的半径（m）：最后这一段不查遮挡——查的是体块中心，宽的地标（佛塔、九层楼）中心在自己里面，不跳过就是自己挡自己。
   */
  sight(from: V2, to: V2, top: number, span: number, skip = 3): number {
    const eye = this.terrain.walkAt(from[0], from[1]) + WB_METRICS.eye;
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(2, Math.ceil(dist));
    const tail = Math.ceil(skip);
    let visible = 0;
    const samples = Math.max(1, Math.round(span));
    for (let k = 0; k < samples; k++) {
      const y = top - (k + 0.5) * span / samples;
      let clear = true;
      for (let i = 2; i < steps - tail && clear; i++) {
        const t = i / steps;
        if (this.terrain.walkAt(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t) > eye + (y - eye) * t) clear = false;
      }
      if (clear) visible += span / samples;
    }
    return visible;
  }
}

/** 跑一遍规格里的全部检查 */
export function probeWhitebox(terrain: WbTerrain): ProbeReport {
  const spec = terrain.spec, probe = new WhiteboxProbe(terrain), M = WB_METRICS;
  const sites = new Map<string, WbSite>();
  for (const s of [spec.spawn, ...spec.strongholds, ...spec.guards, ...spec.entries, ...spec.caches, spec.exit, ...(spec.extras ?? [])]) sites.set(s.id, s);
  const at = (v: string | V2): V2 => typeof v === 'string' ? sites.get(v)?.at ?? (() => { throw new Error(`[${spec.id}] 走法里的点位 ${v} 不存在`); })() : v;
  const reachable = (p: V2): boolean => {
    const i = probe.snap(p, 0, 3);
    return i >= 0 && probe.reach[i] === 1;
  };
  const rows: ProbeRow[] = [];
  const row = (kind: string, s: { id: string; name: string }, ok: boolean, detail: string): void => { rows.push({ kind, id: s.id, name: s.name, ok, detail }); };

  // 走法
  const routes: RouteReport[] = spec.routes.map(route => {
    const need = route.kind === 'main' ? M.mainWidth : M.altWidth;
    const problems: string[] = [];
    const r: RouteReport = { id: route.id, name: route.name, kind: route.kind, ok: true, length: 0, seconds: 0, maxSlope: 0, steepAt: null, minWidth: Infinity, narrowAt: null, climb: 0, pts: [], problems };
    for (let k = 0; k < route.via.length - 1; k++) {
      const leg = probe.path(at(route.via[k]), at(route.via[k + 1]), need);
      const label = `${typeof route.via[k] === 'string' ? route.via[k] : fmt(route.via[k] as V2)} → ${typeof route.via[k + 1] === 'string' ? route.via[k + 1] : fmt(route.via[k + 1] as V2)}`;
      if (!leg.ok) { problems.push(`${label} 走不通`); r.ok = false; continue; }
      r.length += leg.length;
      r.climb += leg.climb;
      r.pts.push(...leg.pts);
      if (leg.maxSlope > r.maxSlope) { r.maxSlope = leg.maxSlope; r.steepAt = leg.steepAt; }
      if (leg.minWidth < r.minWidth) { r.minWidth = leg.minWidth; r.narrowAt = leg.narrowAt; }
      if (leg.squeezed) problems.push(`${label} 最窄处只有 ${leg.minWidth.toFixed(1)} m ${fmt(leg.narrowAt)}，要 ≥ ${need} m`);
    }
    if (route.kind === 'main' && r.maxSlope > M.mainSlope) problems.push(`最陡处 ${r.maxSlope.toFixed(0)}° ${fmt(r.steepAt)}，主线要 ≤ ${M.mainSlope}°`);
    if (!Number.isFinite(r.minWidth)) r.minWidth = 0;
    r.seconds = r.length / M.runSpeed;
    r.ok = problems.length === 0;
    return r;
  });

  // 点位从出生点走得到
  for (const s of spec.strongholds) {
    const ok = reachable(s.at), r = s.r ?? 26;
    // 场地里能走的面积比（离墙够玩家站）
    let total = 0, good = 0, low = Infinity, high = -Infinity;
    const c = Math.ceil(r / probe.cell), ci = probe.index(s.at), cx = ci % probe.nx, cz = Math.floor(ci / probe.nx);
    for (let dz = -c; dz <= c; dz++) for (let dx = -c; dx <= c; dx++) {
      if (dx * dx + dz * dz > c * c) continue;
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= probe.nx || z >= probe.nz) continue;
      const i = z * probe.nx + x;
      total++;
      if (probe.reach[i] && probe.clearance[i] >= probe.cell) {
        good++;
        low = Math.min(low, terrain.walk[i]);
        high = Math.max(high, terrain.walk[i]);
      }
    }
    const share = total ? good / total : 0;
    // 掩体：场地里的实心体块按高度分级
    let half = 0, full = 0;
    for (const b of terrain.blocks) {
      if (b.canopy || Math.hypot(b.at[0] - s.at[0], b.at[1] - s.at[1]) > r) continue;
      const tall = b.y1 - terrain.groundAt(b.at[0], b.at[1]);
      if (tall >= 0.8 && tall <= 1.4) half++;
      else if (tall >= 2.2) full++;
    }
    row('据点', s, ok && share >= 0.5, `${ok ? '走得到' : '走不到'}；场地半径 ${r} m 里 ${Math.round(share * 100)}% 能走，高差 ${Number.isFinite(low) ? (high - low).toFixed(1) : '—'} m；掩体 半身 ${half} / 全身 ${full}`);
  }
  for (const s of spec.guards) {
    const far = Math.hypot(s.at[0] - spec.spawn.at[0], s.at[1] - spec.spawn.at[1]);
    const ok = reachable(s.at);
    row('驻守点', s, ok && far >= 35, `${ok ? '走得到' : '走不到'}；离出生点 ${far.toFixed(0)} m${far < 35 ? '（要 ≥ 35 m）' : ''}`);
  }
  for (const s of spec.caches) row('藏宝', s, reachable(s.at), reachable(s.at) ? '走得到' : '走不到');
  row('出口', spec.exit, reachable(spec.exit.at), reachable(spec.exit.at) ? '走得到' : '走不到');
  for (const s of spec.extras ?? []) {
    const label = { camp: '补给营', boss: '首领', perch: '俯射位', shade: '荫蔽', summon: '召唤点' }[s.kind];
    row(label, s, reachable(s.at), reachable(s.at) ? '走得到' : '走不到');
  }
  // 入场点：怪走得到最近的据点（按怪的体宽）；跃下看落差
  for (const s of spec.entries) {
    const far = Math.hypot(s.at[0] - spec.spawn.at[0], s.at[1] - spec.spawn.at[1]);
    const mode = s.mode ?? 'walk';
    if (mode === 'fly') { row('入场点', s, true, '飞临，不查走路'); continue; }
    const targets = spec.strongholds.length ? spec.strongholds : (spec.extras ?? []).filter(e => e.kind === 'boss');
    let best: { name: string; leg: PathResult } | null = null;
    for (const t of [...targets].sort((p, q) => Math.hypot(p.at[0] - s.at[0], p.at[1] - s.at[1]) - Math.hypot(q.at[0] - s.at[0], q.at[1] - s.at[1])).slice(0, 2)) {
      const leg = probe.path(s.at, t.at, M.enemyRadius * 2);
      if (leg.ok && !leg.squeezed && (!best || leg.length < best.leg.length)) best = { name: t.name, leg };
    }
    let ok = !!best && far >= 30, detail = best ? `怪走 ${best.leg.length.toFixed(0)} m 到「${best.name}」` : '怪按体宽 2.1 m 走不到最近的两个据点';
    if (far < 30) detail += `；离出生点只有 ${far.toFixed(0)} m（要 ≥ 30 m）`;
    if (mode === 'jump') {
      if (!s.from) { ok = false; detail += '；跃下点没给起跳处'; }
      else {
        const drop = terrain.walkAt(s.from[0], s.from[1]) - terrain.walkAt(s.at[0], s.at[1]), run = Math.hypot(s.from[0] - s.at[0], s.from[1] - s.at[1]);
        const fine = drop >= 2 && drop <= 14 && run <= 10;
        ok = ok && fine;
        detail += `；跃下 ${drop.toFixed(1)} m、水平 ${run.toFixed(1)} m${fine ? '' : '（要落差 2–14 m、水平 ≤ 10 m）'}`;
      }
    }
    row('入场点', s, ok, detail);
  }
  // 视线
  for (const sight of spec.sights) {
    const from = at(sight.from);
    const block = terrain.blocks.find(b => b.landmark === sight.to);
    const site = sites.get(sight.to);
    if (!block && !site) { row('视线', { id: sight.to, name: sight.to }, false, '目标不存在'); continue; }
    const to: V2 = block ? block.at : site!.at;
    const top = block ? block.y1 : terrain.walkAt(to[0], to[1]) + 2;
    const span = block ? Math.min(block.y1 - terrain.groundAt(to[0], to[1]), 12) : 2;
    // 地标体块自己占的半径（盒子取半对角线）+ 1 m：这一段里的遮挡是它自己
    const skip = block ? (block.kind === 'cyl' ? block.size[0] : Math.hypot(block.size[0], block.size[1]) / 2) + 1 : 3;
    const visible = probe.sight(from, to, top, span, Math.max(3, skip));
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    row('视线', { id: `${typeof sight.from === 'string' ? sight.from : fmt(sight.from)}→${sight.to}`, name: sight.why }, visible >= Math.min(2, span * 0.3),
      `${dist.toFixed(0)} m 外，看得见顶上 ${visible.toFixed(0)} / ${span.toFixed(0)} m`);
  }

  let cells = 0;
  for (let i = 0; i < probe.reach.length; i++) cells += probe.reach[i];
  const walkArea = cells * probe.cell * probe.cell;
  const failures = routes.filter(r => !r.ok).length + rows.filter(r => !r.ok).length;
  return { id: spec.id, name: spec.name, routes, rows, failures, walkArea, walkShare: walkArea / (spec.size[0] * spec.size[1]) };
}

/** 文字报告（Markdown 表格） */
export function formatReport(r: ProbeReport): string {
  const out: string[] = [`## ${r.id} ${r.name}`, '', `可走面积 ${Math.round(r.walkArea)} m²（占全图 ${Math.round(r.walkShare * 100)}%）`, '',
    '| 走法 | 结果 | 长度 | 跑完 | 最陡 3 m | 最窄处 | 爬升 | 问题 |', '|---|---|---|---|---|---|---|---|'];
  for (const x of r.routes) {
    out.push(`| ${x.kind === 'main' ? '主线' : '侧翼'} ${x.id} ${x.name} | ${x.ok ? '✓' : '✗'} | ${x.length.toFixed(0)} m | ${x.seconds.toFixed(0)} s | ${x.maxSlope.toFixed(0)}° | ${x.minWidth.toFixed(1)} m ${fmt(x.narrowAt)} | ${x.climb.toFixed(0)} m | ${x.problems.join('；')} |`);
  }
  out.push('', '| 类别 | 点位 | 结果 | 说明 |', '|---|---|---|---|');
  for (const x of r.rows) out.push(`| ${x.kind} | ${x.id} ${x.name} | ${x.ok ? '✓' : '✗'} | ${x.detail} |`);
  out.push('', r.failures ? `**${r.failures} 项不通过**` : '**全部通过**');
  return out.join('\n');
}
