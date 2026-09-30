import * as THREE from 'three';
import type { ArenaInfo, GameContext, INavGrid } from '../core/types';
import { TAU } from '../core/math';

/** 光栅化可用的最小盒子形状（StaticBox 与 LevelGen 的 LayoutBox 都满足） */
export interface NavBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** 可走判定：格中心「列」的半宽（米）。列内 [floorY+0.05, floorY+1.9] 有盒子即不可走 */
export const NAV_FOOT = 0.35;
export const NAV_CLEAR_LOW = 0.05;
export const NAV_CLEAR_HIGH = 1.9;

const SQRT2 = Math.SQRT2;
/** 8 邻接：前 4 个为正交方向 */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
/** 贴墙格额外代价（相邻有阻挡 / 隔一格有阻挡） */
const WALL_COST_1 = 1.5;
const WALL_COST_2 = 0.35;
/** 两侧都被挡住的一格宽窄缝：体型大的敌人过不去，尽量绕行 */
const PINCH_COST = 6;
/** 世界盒子变化后自动重建的最小间隔（秒，游戏时间） */
const REBUILD_INTERVAL = 0.5;

/**
 * 把盒子光栅化到地面网格：格中心 (ox + (i+0.5)·cell, oz + (j+0.5)·cell) 的方形列（半宽 foot）
 * 在 [floorY+0.05, floorY+1.9] 内与任一盒子相交 → 阻挡。out[j*cols+i] = 1。
 */
export function rasterizeBlocked(
  boxes: readonly NavBox[], ox: number, oz: number, cols: number, rows: number,
  cell: number, floorY: number, foot: number, out: Uint8Array,
): void {
  out.fill(0);
  const y0 = floorY + NAV_CLEAR_LOW;
  const y1 = floorY + NAV_CLEAR_HIGH;
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    if (b.maxY <= y0 || b.minY >= y1) continue;
    // 中心严格落在 (min - foot, max + foot) 内的格子
    const i0 = Math.max(0, Math.floor((b.minX - foot - ox) / cell - 0.5) + 1);
    const i1 = Math.min(cols - 1, Math.ceil((b.maxX + foot - ox) / cell - 0.5) - 1);
    const j0 = Math.max(0, Math.floor((b.minZ - foot - oz) / cell - 0.5) + 1);
    const j1 = Math.min(rows - 1, Math.ceil((b.maxZ + foot - oz) / cell - 0.5) - 1);
    for (let j = j0; j <= j1; j++) {
      const row = j * cols;
      for (let i = i0; i <= i1; i++) out[row + i] = 1;
    }
  }
}

/**
 * 8 邻接（禁止切角）连通分量。comp 写入分量 id（阻挡格为 -1），返回各分量大小。
 * queue 长度需 >= cols*rows。
 */
export function labelComponents(blocked: Uint8Array, cols: number, rows: number, comp: Int32Array, queue: Int32Array): number[] {
  const n = cols * rows;
  comp.fill(-1, 0, n);
  const sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (blocked[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % cols;
      const cz = (c - cx) / cols;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (blocked[ni] || comp[ni] >= 0) continue;
        if (d >= 4 && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
        comp[ni] = id;
        queue[tail++] = ni;
      }
    }
    sizes.push(tail);
  }
  return sizes;
}

/**
 * 地面导航网格：1 米（可配）格子，8 邻接 A*（禁止切角、二叉堆、贴墙加代价），
 * 基于格子视线的路径拉直，BFS 最近可走点。所有工作数组复用，寻路过程不分配内存。
 */
export class NavGrid implements INavGrid {
  cellSize = 1;
  cols = 0;
  rows = 0;
  private ox = 0;
  private oz = 0;
  private floorY = 0;
  private built = false;
  private arena: ArenaInfo | null = null;
  private builtVersion = -1;
  private lastBuildTime = -Infinity;
  private capacity = 0;

  private blocked = new Uint8Array(0);
  /** 视线掩码：阻挡格及其 8 邻格（路径拉直时中间格不得落在这里，保证捷径离障碍约 0.85 米） */
  private losMask = new Uint8Array(0);
  private comp = new Int32Array(0);
  private mainComp = -1;
  private extra = new Float32Array(0);

  // A* 工作区
  private g = new Float32Array(0);
  private f = new Float32Array(0);
  private parent = new Int32Array(0);
  private openStamp = new Uint32Array(0);
  private closedStamp = new Uint32Array(0);
  private heap = new Int32Array(0);
  private heapPos = new Int32Array(0);
  private heapSize = 0;
  private search = 0;

  // BFS 工作区
  private queue = new Int32Array(0);
  private depth = new Int32Array(0);
  private bfsStamp = new Uint32Array(0);
  private bfsId = 0;

  private cellPath = new Int32Array(0);
  /** 由本网格创建、可以在后续寻路中原地复用的路点向量 */
  private owned = new WeakSet<THREE.Vector3>();

  constructor(readonly ctx: GameContext) {}

  // ───────────── 构建 ─────────────

  build(arena: ArenaInfo, cellSize = 1): void {
    this.arena = arena;
    const cs = Math.max(0.25, cellSize);
    this.cellSize = cs;
    this.ox = arena.minX;
    this.oz = arena.minZ;
    this.floorY = arena.floorY;
    this.cols = Math.max(1, Math.ceil((arena.maxX - arena.minX) / cs - 1e-6));
    this.rows = Math.max(1, Math.ceil((arena.maxZ - arena.minZ) / cs - 1e-6));
    const n = this.cols * this.rows;
    this.ensureCapacity(n);

    const world = this.ctx.world;
    rasterizeBlocked(world.boxes, this.ox, this.oz, this.cols, this.rows, cs, this.floorY, Math.min(NAV_FOOT, cs * 0.45), this.blocked);

    // 连通分量：最大的一块是「主区域」
    const sizes = labelComponents(this.blocked, this.cols, this.rows, this.comp, this.queue);
    this.mainComp = -1;
    let best = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > best) {
        best = sizes[i];
        this.mainComp = i;
      }
    }

    this.computeWallCost();
    this.built = true;
    this.builtVersion = world.version;
    this.lastBuildTime = this.ctx.time.now;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = n;
    this.blocked = new Uint8Array(n);
    this.losMask = new Uint8Array(n);
    this.comp = new Int32Array(n);
    this.extra = new Float32Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.openStamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.heapPos = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.depth = new Int32Array(n);
    this.bfsStamp = new Uint32Array(n);
    this.cellPath = new Int32Array(n);
    this.search = 0;
    this.bfsId = 0;
  }

  /** 贴墙格加代价：相邻（含网格边界）有阻挡 +1.5，隔一格有阻挡 +0.35；一格宽窄缝 +6 */
  private computeWallCost(): void {
    const { cols, rows, blocked, extra, losMask } = this;
    const bl = (x: number, z: number): boolean => x < 0 || z < 0 || x >= cols || z >= rows || blocked[z * cols + x] !== 0;
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const i = z * cols + x;
        if (blocked[i]) {
          extra[i] = 0;
          losMask[i] = 1;
          continue;
        }
        losMask[i] = bl(x - 1, z) || bl(x + 1, z) || bl(x, z - 1) || bl(x, z + 1)
          || bl(x - 1, z - 1) || bl(x + 1, z + 1) || bl(x - 1, z + 1) || bl(x + 1, z - 1) ? 1 : 0;
        if ((bl(x - 1, z) && bl(x + 1, z)) || (bl(x, z - 1) && bl(x, z + 1))
          || (bl(x - 1, z - 1) && bl(x + 1, z + 1)) || (bl(x - 1, z + 1) && bl(x + 1, z - 1))) {
          extra[i] = PINCH_COST;
          continue;
        }
        let ring = 3;
        for (let dz = -2; dz <= 2 && ring > 1; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = x + dx;
            const nz = z + dz;
            const r = Math.max(Math.abs(dx), Math.abs(dz));
            if (r >= ring) continue;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows || blocked[nz * cols + nx]) {
              ring = r;
              if (ring === 1) break;
            }
          }
        }
        extra[i] = ring === 1 ? WALL_COST_1 : ring === 2 ? WALL_COST_2 : 0;
      }
    }
  }

  /** 碰撞世界有变化（有人增删了盒子）时按间隔自动重建 */
  private ensureFresh(): void {
    const arena = this.arena;
    if (!arena) return;
    const world = this.ctx.world;
    if (world.version === this.builtVersion) return;
    if (world.boxes.length === 0) {
      // 关卡已卸载
      this.built = false;
      this.builtVersion = world.version;
      return;
    }
    if (this.built && this.ctx.time.now - this.lastBuildTime < REBUILD_INTERVAL) return;
    this.build(arena, this.cellSize);
  }

  // ───────────── 格子工具 ─────────────

  private centerX(i: number): number {
    return this.ox + ((i % this.cols) + 0.5) * this.cellSize;
  }

  private centerZ(i: number): number {
    return this.oz + (Math.floor(i / this.cols) + 0.5) * this.cellSize;
  }

  /** 世界坐标 → 格子索引；越界返回 -1 */
  private cellAt(x: number, z: number): number {
    const ix = Math.floor((x - this.ox) / this.cellSize);
    const iz = Math.floor((z - this.oz) / this.cellSize);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  private cellAtClamped(x: number, z: number): number {
    let ix = Math.floor((x - this.ox) / this.cellSize);
    let iz = Math.floor((z - this.oz) / this.cellSize);
    ix = ix < 0 ? 0 : ix >= this.cols ? this.cols - 1 : ix;
    iz = iz < 0 ? 0 : iz >= this.rows ? this.rows - 1 : iz;
    return iz * this.cols + ix;
  }

  private blockedXZ(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return true;
    return this.blocked[iz * this.cols + ix] !== 0;
  }

  /** 视线用：阻挡格或贴着阻挡的格子 */
  private tightXZ(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return true;
    return this.losMask[iz * this.cols + ix] !== 0;
  }

  // ───────────── 查询接口 ─────────────

  isWalkable(x: number, z: number): boolean {
    this.ensureFresh();
    if (!this.built) return true;
    const c = this.cellAt(x, z);
    return c >= 0 && this.blocked[c] === 0;
  }

  nearestWalkable(p: THREE.Vector3, out: THREE.Vector3): boolean {
    this.ensureFresh();
    if (!this.built) {
      out.copy(p);
      return false;
    }
    const c = this.cellAt(p.x, p.z);
    if (c >= 0 && this.blocked[c] === 0 && (this.comp[c] === this.mainComp || this.mainComp < 0)) {
      out.set(p.x, this.floorY, p.z);
      return true;
    }
    let best = this.nearestCell(p.x, p.z, this.mainComp);
    if (best < 0) best = this.nearestCell(p.x, p.z, -1);
    if (best < 0) {
      out.copy(p);
      return false;
    }
    out.set(this.centerX(best), this.floorY, this.centerZ(best));
    return true;
  }

  randomWalkable(center: THREE.Vector3, minR: number, maxR: number, out: THREE.Vector3): boolean {
    this.ensureFresh();
    if (!this.built) {
      out.copy(center);
      return false;
    }
    const rng = this.ctx.rng;
    const lo = Math.max(0, Math.min(minR, maxR));
    const hi = Math.max(lo + 0.01, maxR);
    const lo2 = lo * lo;
    const hi2 = hi * hi;
    const cs = this.cellSize;
    const jitter = cs * 0.3;
    // 先随机采样（面积均匀）
    for (let k = 0; k < 28; k++) {
      const a = rng.next() * TAU;
      const r = Math.sqrt(lo2 + rng.next() * (hi2 - lo2));
      const x = center.x + Math.sin(a) * r;
      const z = center.z + Math.cos(a) * r;
      const c = this.cellAt(x, z);
      if (c < 0 || this.blocked[c] || (this.mainComp >= 0 && this.comp[c] !== this.mainComp)) continue;
      out.set(
        this.centerX(c) + (rng.next() - 0.5) * jitter,
        this.floorY,
        this.centerZ(c) + (rng.next() - 0.5) * jitter,
      );
      return true;
    }
    // 退化：扫描环形区域内的全部格子，蓄水池抽样
    const x0 = Math.max(0, Math.floor((center.x - hi - this.ox) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((center.x + hi - this.ox) / cs));
    const z0 = Math.max(0, Math.floor((center.z - hi - this.oz) / cs));
    const z1 = Math.min(this.rows - 1, Math.floor((center.z + hi - this.oz) / cs));
    let pick = -1;
    let seen = 0;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const c = iz * this.cols + ix;
        if (this.blocked[c] || (this.mainComp >= 0 && this.comp[c] !== this.mainComp)) continue;
        const dx = this.ox + (ix + 0.5) * cs - center.x;
        const dz = this.oz + (iz + 0.5) * cs - center.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < lo2 || d2 > hi2) continue;
        seen++;
        if (rng.next() * seen < 1) pick = c;
      }
    }
    if (pick >= 0) {
      out.set(this.centerX(pick), this.floorY, this.centerZ(pick));
      return true;
    }
    this.nearestWalkable(center, out);
    return false;
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): boolean {
    // 注意：成功时才截断 out，以便原地复用上一次的路点向量
    this.ensureFresh();
    if (!this.built) return this.fail(out);

    // 起点：不可走（贴着障碍 / 站在高台上）时取最近可走格
    let s = this.cellAt(from.x, from.z);
    let startRemapped = false;
    if (s < 0 || this.blocked[s]) {
      s = this.nearestCell(from.x, from.z, this.mainComp);
      if (s < 0) s = this.nearestCell(from.x, from.z, -1);
      if (s < 0) return this.fail(out);
      startRemapped = true;
    }
    let sc = this.comp[s];

    // 起点困在小块孤岛而目标在主区域：把起点挪回主区域
    const tRaw = this.cellAt(to.x, to.z);
    const targetInMain = tRaw >= 0 && this.blocked[tRaw] === 0 && this.comp[tRaw] === this.mainComp;
    if (sc !== this.mainComp && this.mainComp >= 0 && targetInMain) {
      const ms = this.nearestCell(from.x, from.z, this.mainComp);
      if (ms >= 0) {
        s = ms;
        sc = this.mainComp;
        startRemapped = true;
      }
    }

    // 终点：不可走或与起点不连通时，取与起点同一分量里离目标最近的格子
    let t = tRaw;
    let goalExact = t >= 0 && this.blocked[t] === 0 && this.comp[t] === sc;
    if (!goalExact) {
      t = this.nearestCell(to.x, to.z, sc);
      if (t < 0) return this.fail(out);
    }

    let count = 0;
    if (s === t) {
      if (goalExact) count = this.writePoint(out, count, to.x, to.z);
      else count = this.writePoint(out, count, this.centerX(t), this.centerZ(t));
      out.length = count;
      return true;
    }

    const len = this.astar(s, t);
    if (len <= 0) return this.fail(out);
    const path = this.cellPath;

    // 路径拉直：从锚点出发，沿格子路径向前推进，直到视线被挡
    let ax = from.x;
    let az = from.z;
    if (startRemapped) {
      ax = this.centerX(path[0]);
      az = this.centerZ(path[0]);
      count = this.writeRelaxed(out, count, path[0]);
    }
    const last = len - 1;
    let px = ax;
    let pz = az;
    let i = 0;
    while (i < last) {
      let j = i + 1;
      while (j < last && this.lineClear(ax, az, this.centerX(path[j + 1]), this.centerZ(path[j + 1]))) j++;
      px = ax;
      pz = az;
      ax = this.centerX(path[j]);
      az = this.centerZ(path[j]);
      count = this.writeRelaxed(out, count, path[j]);
      i = j;
    }
    // 终点可走时以精确目标收尾：前一锚点到目标视线畅通则替换终点格中心，否则追加（与终点格同格，必然可达）
    if (goalExact) {
      if (count > 0 && this.lineClear(px, pz, to.x, to.z)) this.writePoint(out, count - 1, to.x, to.z);
      else count = this.writePoint(out, count, to.x, to.z);
    }
    out.length = count;
    return count > 0;
  }

  // ───────────── A* ─────────────

  /** 返回 cellPath 中的路径长度（含起终点），失败返回 0 */
  private astar(s: number, t: number): number {
    const { cols, rows, blocked, extra, g, f, parent, openStamp, closedStamp } = this;
    if (++this.search >= 0xfffffff0) {
      openStamp.fill(0);
      closedStamp.fill(0);
      this.search = 1;
    }
    const sid = this.search;
    const tx = t % cols;
    const tz = (t - tx) / cols;

    this.heapSize = 0;
    g[s] = 0;
    f[s] = this.heuristic(s % cols, Math.floor(s / cols), tx, tz);
    parent[s] = -1;
    openStamp[s] = sid;
    this.heapPush(s);

    while (this.heapSize > 0) {
      const cur = this.heapPop();
      if (cur === t) return this.reconstruct(s, t);
      closedStamp[cur] = sid;
      const cx = cur % cols;
      const cz = (cur - cx) / cols;
      const gc = g[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (blocked[ni] || closedStamp[ni] === sid) continue;
        // 禁止切角：对角移动要求两侧正交格都可走
        if (d >= 4 && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
        const ng = gc + DC[d] * (1 + extra[ni]);
        if (openStamp[ni] !== sid) {
          openStamp[ni] = sid;
          g[ni] = ng;
          parent[ni] = cur;
          f[ni] = ng + this.heuristic(nx, nz, tx, tz);
          this.heapPush(ni);
        } else if (ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = cur;
          f[ni] = ng + this.heuristic(nx, nz, tx, tz);
          this.siftUp(this.heapPos[ni]);
        }
      }
    }
    return 0;
  }

  /** 八方向距离（可采纳：额外代价只会让实际代价更大） */
  private heuristic(x: number, z: number, tx: number, tz: number): number {
    const dx = Math.abs(x - tx);
    const dz = Math.abs(z - tz);
    return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * 1.0001;
  }

  private reconstruct(s: number, t: number): number {
    const path = this.cellPath;
    let n = 0;
    for (let c = t; c !== -1 && n < path.length; c = this.parent[c]) {
      path[n++] = c;
      if (c === s) break;
    }
    // 反转为 起点 → 终点
    for (let a = 0, b = n - 1; a < b; a++, b--) {
      const tmp = path[a];
      path[a] = path[b];
      path[b] = tmp;
    }
    return n;
  }

  private heapPush(node: number): void {
    const k = this.heapSize++;
    this.heap[k] = node;
    this.heapPos[node] = k;
    this.siftUp(k);
  }

  private heapPop(): number {
    const heap = this.heap;
    const top = heap[0];
    this.heapSize--;
    if (this.heapSize > 0) this.siftDown(0, heap[this.heapSize]);
    return top;
  }

  private siftUp(k: number): void {
    const { heap, heapPos, f } = this;
    const node = heap[k];
    const fv = f[node];
    while (k > 0) {
      const p = (k - 1) >> 1;
      const pn = heap[p];
      if (f[pn] <= fv) break;
      heap[k] = pn;
      heapPos[pn] = k;
      k = p;
    }
    heap[k] = node;
    heapPos[node] = k;
  }

  private siftDown(k: number, node: number): void {
    const { heap, heapPos, f } = this;
    const size = this.heapSize;
    const fv = f[node];
    const half = size >> 1;
    while (k < half) {
      let c = 2 * k + 1;
      let cn = heap[c];
      const r = c + 1;
      if (r < size && f[heap[r]] < f[cn]) {
        c = r;
        cn = heap[r];
      }
      if (f[cn] >= fv) break;
      heap[k] = cn;
      heapPos[cn] = k;
      k = c;
    }
    heap[k] = node;
    heapPos[node] = k;
  }

  // ───────────── BFS 最近格 ─────────────

  /**
   * 从 (x,z) 所在格（越界则钳制）做 BFS，返回「欧氏距离 + 贴障碍惩罚」最小的可走格：
   * 更倾向开阔处，避免把目标 / 传送点选进高台与墙之间的窄缝。
   * want >= 0 时只接受该连通分量的格子；-1 表示任意可走格。找不到返回 -1。
   */
  private nearestCell(x: number, z: number, want: number): number {
    const { cols, rows, blocked, comp, queue, depth, bfsStamp } = this;
    if (++this.bfsId >= 0xfffffff0) {
      bfsStamp.fill(0);
      this.bfsId = 1;
    }
    const id = this.bfsId;
    const cs = this.cellSize;
    const start = this.cellAtClamped(x, z);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    depth[start] = 0;
    bfsStamp[start] = id;
    let best = -1;
    let bestD = Infinity;
    while (head < tail) {
      const c = queue[head++];
      const dep = depth[c];
      // 第 dep 层的格子离 p 至少 (dep - 0.71)·cs，已不可能更近
      if (best >= 0 && (dep - 0.71) * cs > bestD) break;
      const cx = c % cols;
      const cz = (c - cx) / cols;
      if (!blocked[c] && (want < 0 || comp[c] === want)) {
        const dx = this.ox + (cx + 0.5) * cs - x;
        const dz = this.oz + (cz + 0.5) * cs - z;
        const d = Math.sqrt(dx * dx + dz * dz) + (this.extra[c] >= PINCH_COST ? 3 * cs : this.losMask[c] ? 1.5 * cs : 0);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (bfsStamp[ni] === id) continue;
        bfsStamp[ni] = id;
        depth[ni] = dep + 1;
        queue[tail++] = ni;
      }
    }
    return best;
  }

  // ───────────── 视线 ─────────────

  /**
   * 「粗」视线：两条相距 0.6 格的平行线，中间经过的格子既不能是阻挡格也不能贴着阻挡格
   * （起止格只要求可走）。这样拉直后的捷径离障碍至少约 0.85 米，大体型敌人也不会蹭住墙角。
   */
  private lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) return true;
    const r = this.cellSize * 0.3;
    const px = (-dz / len) * r;
    const pz = (dx / len) * r;
    return this.segClear(x0 + px, z0 + pz, x1 + px, z1 + pz) && this.segClear(x0 - px, z0 - pz, x1 - px, z1 - pz);
  }

  /** DDA 遍历线段经过的格子；恰好穿过格点时两侧格子也要满足同样条件 */
  private segClear(x0: number, z0: number, x1: number, z1: number): boolean {
    const cs = this.cellSize;
    const gx = (x0 - this.ox) / cs;
    const gz = (z0 - this.oz) / cs;
    const ex = (x1 - this.ox) / cs;
    const ez = (z1 - this.oz) / cs;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    const tx = Math.floor(ex);
    const tz = Math.floor(ez);
    if (this.blockedXZ(ix, iz)) return false;
    const dx = ex - gx;
    const dz = ez - gz;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = stepX > 0 ? (ix + 1 - gx) * tDeltaX : stepX < 0 ? (gx - ix) * tDeltaX : Infinity;
    let tMaxZ = stepZ > 0 ? (iz + 1 - gz) * tDeltaZ : stepZ < 0 ? (gz - iz) * tDeltaZ : Infinity;
    let guard = this.cols + this.rows + 4;
    while ((ix !== tx || iz !== tz) && guard-- > 0) {
      if (Math.min(tMaxX, tMaxZ) > 1) break;
      if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
        if (this.tightXZ(ix + stepX, iz) || this.tightXZ(ix, iz + stepZ)) return false;
        ix += stepX;
        iz += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
      const end = ix === tx && iz === tz;
      if (end ? this.blockedXZ(ix, iz) : this.tightXZ(ix, iz)) return false;
    }
    return true;
  }

  // ───────────── 输出 ─────────────

  private fail(out: THREE.Vector3[]): boolean {
    out.length = 0;
    return false;
  }

  /**
   * 写入格子路点，并把贴着障碍的格子中心向远离障碍的方向推开（最多 0.4 格，仍在本格内），
   * 让体型大的敌人也能「到达」路点，而不是顶在墙角上。两侧都有障碍时推力抵消，留在中心。
   */
  private writeRelaxed(out: THREE.Vector3[], idx: number, c: number): number {
    let x = this.centerX(c);
    let z = this.centerZ(c);
    if (this.losMask[c]) {
      const cx = c % this.cols;
      const cz = (c - cx) / this.cols;
      let px = 0;
      let pz = 0;
      for (let d = 0; d < 8; d++) {
        if (!this.blockedXZ(cx + DX[d], cz + DZ[d])) continue;
        const w = d < 4 ? 1 : 0.7071;
        px -= DX[d] * w;
        pz -= DZ[d] * w;
      }
      const l = Math.hypot(px, pz);
      if (l > 0.3) {
        const k = (this.cellSize * 0.4) / l;
        x += px * k;
        z += pz * k;
      }
    }
    return this.writePoint(out, idx, x, z);
  }

  /** 写入第 idx 个路点：复用本网格之前创建的向量，避免每次寻路分配 */
  private writePoint(out: THREE.Vector3[], idx: number, x: number, z: number): number {
    let v = idx < out.length ? out[idx] : undefined;
    if (!v || !this.owned.has(v)) {
      v = new THREE.Vector3();
      this.owned.add(v);
      out[idx] = v;
    }
    v.set(x, this.floorY, z);
    return idx + 1;
  }
}
