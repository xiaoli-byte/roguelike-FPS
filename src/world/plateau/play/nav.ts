/**
 * 追人用的寻路场：2 m 网格，开局算一次哪些格子能走（深水、陡坡、碰撞体周围 1 m 不能走），
 * 每 0.4 秒以玩家为源点在 140 m 内做一次 Dijkstra（8 邻接）。追人的怪往距离更小的相邻格走，就能绕开玛尼墙、民居这些障碍。
 */
import type { Terrain } from '../terrain';
import type { CollisionWorld } from '../walker';

const CELL = 2;
const RANGE = 70;
const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export class NavField {
  private readonly nx: number;
  private readonly nz: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly walk: Uint8Array;
  private readonly dist: Float32Array;
  private readonly stamp: Uint32Array;
  private gen = 1;
  private srcI = -1;
  private srcJ = -1;
  private age = 99;
  private readonly heap: number[] = [];

  constructor(private readonly terrain: Terrain, world: CollisionWorld) {
    this.x0 = terrain.minX; this.z0 = terrain.minZ;
    this.nx = Math.ceil((terrain.maxX - terrain.minX) / CELL);
    this.nz = Math.ceil((terrain.maxZ - terrain.minZ) / CELL);
    const n = this.nx * this.nz;
    this.walk = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      this.walk[j * this.nx + i] = terrain.waterDepthAt(x, z) < 0.8 && terrain.slopeAt(x, z) < 1.1 && !world.occupied(x, z, 0.9) ? 1 : 0;
    }
  }

  private cell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.x0) / CELL), Math.floor((z - this.z0) / CELL)];
  }

  /** 每帧调：玩家换了格子或超过 0.4 秒就重算 */
  update(dt: number, px: number, pz: number): void {
    this.age += dt;
    const [i, j] = this.cell(px, pz);
    if (this.age < 0.4) return;
    this.age = 0;
    this.srcI = i; this.srcJ = j;
    this.gen++;
    const H = this.heap;
    H.length = 0;
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return;
    const s = j * this.nx + i;
    this.dist[s] = 0; this.stamp[s] = this.gen;
    H.push(s);
    // 小顶堆（按 dist）
    const push = (k: number): void => {
      H.push(k);
      let c = H.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (this.dist[H[p]] <= this.dist[H[c]]) break; [H[p], H[c]] = [H[c], H[p]]; c = p; }
    };
    const pop = (): number => {
      const top = H[0], last = H.pop()!;
      if (H.length) {
        H[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < H.length && this.dist[H[l]] < this.dist[H[m]]) m = l;
          if (r < H.length && this.dist[H[r]] < this.dist[H[m]]) m = r;
          if (m === c) break;
          [H[m], H[c]] = [H[c], H[m]]; c = m;
        }
      }
      return top;
    };
    while (H.length) {
      const k = pop();
      const ci = k % this.nx, cj = (k / this.nx) | 0, d = this.dist[k];
      if (d > RANGE) continue;
      for (const [di, dj, w] of DIRS) {
        const a = ci + di, b = cj + dj;
        if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
        const q = b * this.nx + a;
        if (!this.walk[q]) continue;
        // 斜着走不能切墙角
        if (di && dj && (!this.walk[cj * this.nx + a] || !this.walk[b * this.nx + ci])) continue;
        const nd = d + w;
        if (this.stamp[q] === this.gen && this.dist[q] <= nd) continue;
        this.dist[q] = nd; this.stamp[q] = this.gen;
        push(q);
      }
    }
  }

  /** 从 (x, z) 往玩家走的下一个路点；不在场内（太远或走不通）返回 null */
  next(x: number, z: number): [number, number] | null {
    const [i, j] = this.cell(x, z);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return null;
    const k = j * this.nx + i;
    let best = this.stamp[k] === this.gen ? this.dist[k] : Infinity, bi = -1, bj = -1;
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
      const q = b * this.nx + a;
      if (this.stamp[q] !== this.gen) continue;
      if (this.dist[q] < best) { best = this.dist[q]; bi = a; bj = b; }
    }
    if (bi < 0) return null;
    return [this.x0 + (bi + 0.5) * CELL, this.z0 + (bj + 0.5) * CELL];
  }
}
