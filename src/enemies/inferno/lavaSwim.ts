/**
 * 熔岩生物（第三章火鼍）在熔岩里的移动：导航网格把熔岩当阻挡，火鼍就自己在熔岩掩码（WhiteboxLava）上寻路。
 *
 * - lavaOf(ctx)：当前关卡的熔岩掩码（StageDirector.lavaSystem.lava；没有熔岩的关卡为 null）。
 * - LavaRoute.plan：从火鼍所在的熔岩格出发，在同一片连通的熔岩里广度优先搜索，找离目标点最近的熔岩格（贴着玩家那一侧的岸），
 *   回溯出路径（格中心），再把能直线穿过（沿线全是熔岩）的拐点合并掉。网格按关卡（每格 0.5 米，大熔岩湖最多搜 6 万格），每 0.5 秒重算一次。
 * - nearestLava：半径内离某点最近的熔岩格中心（爬回熔岩、被挤上岸时找回去的路）。
 * - bankPoint：从熔岩格往目标点方向找第一个不是熔岩的点（扑上岸的落点、岸边鼓泡的位置）。
 *
 * 只依赖 three 与类型：测试可以直接加载本文件。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { WhiteboxLava } from '../../world/WhiteboxTypes';

/** 路径合并时最多往前看几格、最多给出几个路点 */
const LOOKAHEAD = 48;
const MAX_POINTS = 4;

/** 当前关卡的熔岩掩码；没有熔岩时 null */
export function lavaOf(ctx: GameContext): WhiteboxLava | null {
  const st = ctx.stage as unknown as { lavaSystem?: { lava?: WhiteboxLava } | null } | undefined;
  return st?.lavaSystem?.lava ?? null;
}

export function isLava(L: WhiteboxLava, x: number, z: number): boolean {
  const ix = Math.floor((x - L.minX) / L.cell), iz = Math.floor((z - L.minZ) / L.cell);
  return ix >= 0 && iz >= 0 && ix < L.cols && iz < L.rows && L.mask[iz * L.cols + ix] === 1;
}

/** 线段 a→b（水平）是否全程在熔岩上（按 1/3 格采样） */
export function allLava(L: WhiteboxLava, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / (L.cell / 3)));
  for (let k = 0; k <= n; k++) if (!isLava(L, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
  return true;
}

/** 半径 r 内离 p 最近的熔岩格中心（按格扫描） */
export function nearestLava(L: WhiteboxLava, p: { x: number; z: number }, r: number, out: THREE.Vector3): boolean {
  const c = L.cell;
  const x0 = Math.max(0, Math.floor((p.x - r - L.minX) / c)), x1 = Math.min(L.cols - 1, Math.floor((p.x + r - L.minX) / c));
  const z0 = Math.max(0, Math.floor((p.z - r - L.minZ) / c)), z1 = Math.min(L.rows - 1, Math.floor((p.z + r - L.minZ) / c));
  let best = r * r, found = false;
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    if (L.mask[iz * L.cols + ix] !== 1) continue;
    const x = L.minX + (ix + 0.5) * c, z = L.minZ + (iz + 0.5) * c, d = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (d < best) { best = d; out.set(x, out.y, z); found = true; }
  }
  return found;
}

/** 从熔岩点 from 朝 to 走，第一个不是熔岩的点（找不到返回 false） */
export function bankPoint(L: WhiteboxLava, from: { x: number; z: number }, to: { x: number; z: number }, out: THREE.Vector3, maxD = 12): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  if (len < 1e-3) return false;
  const step = L.cell / 3, n = Math.ceil(Math.min(maxD, len + L.cell) / step);
  for (let k = 1; k <= n; k++) {
    const x = from.x + (dx / len) * step * k, z = from.z + (dz / len) * step * k;
    if (!isLava(L, x, z)) { out.set(x, out.y, z); return true; }
  }
  return false;
}

/** 熔岩里的寻路（每只火鼍一个，缓冲区复用） */
export class LavaRoute {
  private prev = new Int32Array(0);
  private queue = new Int32Array(0);
  private stamp = new Int32Array(0);
  private gen = 0;
  /** 上次规划出的路点（格中心，第一个是下一个要去的点） */
  readonly points: THREE.Vector3[] = [];
  private readonly pool: THREE.Vector3[] = [];

  /**
   * 从 from（须在熔岩上）出发，在连通的熔岩里找离 target 最近的格，把路点写进 points。
   * 返回终点离 target 的距离（米）；from 不在熔岩上时返回 Infinity、points 为空。
   */
  plan(L: WhiteboxLava, from: { x: number; z: number }, target: { x: number; z: number }, maxCells = 60000): number {
    this.points.length = 0;
    const n = L.cols * L.rows;
    if (this.prev.length < n) {
      this.prev = new Int32Array(n);
      this.queue = new Int32Array(n);
      this.stamp = new Int32Array(n);
      this.gen = 0;
    }
    const fx = Math.floor((from.x - L.minX) / L.cell), fz = Math.floor((from.z - L.minZ) / L.cell);
    if (fx < 0 || fz < 0 || fx >= L.cols || fz >= L.rows || L.mask[fz * L.cols + fx] !== 1) return Infinity;
    const gen = ++this.gen;
    const start = fz * L.cols + fx;
    let head = 0, tail = 0;
    this.queue[tail++] = start;
    this.stamp[start] = gen;
    this.prev[start] = -1;
    let best = start, bestD = Infinity;
    const cx = (i: number): number => L.minX + ((i % L.cols) + 0.5) * L.cell;
    const cz = (i: number): number => L.minZ + (Math.floor(i / L.cols) + 0.5) * L.cell;
    while (head < tail && head < maxCells) {
      const i = this.queue[head++];
      const d = (cx(i) - target.x) ** 2 + (cz(i) - target.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
      const x = i % L.cols, z = (i - x) / L.cols;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = z + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= L.cols || nz >= L.rows) continue;
        const j = nz * L.cols + nx;
        if (L.mask[j] !== 1 || this.stamp[j] === gen) continue;
        this.stamp[j] = gen;
        this.prev[j] = i;
        this.queue[tail++] = j;
      }
    }
    // 回溯（终点 → 起点），再反过来
    const chain: number[] = [];
    for (let i = best; i !== -1 && chain.length < 4096; i = this.prev[i]) chain.push(i);
    chain.reverse();
    // 拐点合并：从当前点能直线穿过熔岩到达的最远路点（只往前看 LOOKAHEAD 格、只出前 MAX_POINTS 个路点：火鼍只朝第一个点游，
    // 每 0.5 秒重算一次；大熔岩湖里整条路径逐段合并太贵）
    let at = 0;
    let ax = from.x, az = from.z;
    while (at < chain.length - 1 && this.points.length < MAX_POINTS) {
      let far = at + 1;
      for (let k = Math.min(chain.length - 1, at + LOOKAHEAD); k > at + 1; k--) {
        if (allLava(L, ax, az, cx(chain[k]), cz(chain[k]))) { far = k; break; }
      }
      const p = this.pool[this.points.length] ?? (this.pool[this.points.length] = new THREE.Vector3());
      p.set(cx(chain[far]), 0, cz(chain[far]));
      this.points.push(p);
      ax = p.x; az = p.z;
      at = far;
    }
    return Math.sqrt(bestD);
  }
}
