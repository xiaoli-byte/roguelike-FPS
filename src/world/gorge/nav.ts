/**
 * 4-2 自动验收用的行走图（docs/level-design/chuanzang-v1.md 3.1）：1 m 网格，每格可以有好几层可站的面——
 * 地形（坡 ≤ 40°、水深 ≤ 1.1 m、没出界）和可站立碰撞体的顶面（桥面、栈道、屋顶、跳石）。
 * 边：相邻格之间能走过去（地形按坡度；碰撞体按台阶高差）；往下跳 ≤ 3 m 是单向边；溜索是从起点平台到终点平台的单向边。
 * 每个可站的面记下它属于哪条「路」（铁索桥、溜索、栈道……），自动验收可以逐条断开再搜一遍。
 */
import { MAP } from './spec';
import type { Collider } from '../plateau/walker';
import type { GorgeTerrain } from './terrain';

const LIM = Math.tan((40 * Math.PI) / 180);

export interface NavRoute { id: string; colliders: Collider[] }
export interface NavZip { id: string; from: [number, number]; to: [number, number] }

export interface NavGraph {
  /** 从 (x, z) 附近（r 格内）出发 / 到达的搜索 */
  reach(from: [number, number], opts?: { without?: string; reverse?: boolean }): Uint8Array;
  /** 某次搜索结果里 (x, z) 附近是否到过 */
  hit(seen: Uint8Array, x: number, z: number, r?: number): boolean;
  /** 统计：可玩区面积、可走比例 */
  stats(seen: Uint8Array): { area: number; walkable: number; reach: number };
  readonly W: number; readonly H: number;
  /** 每格最上面那层的高度（平面图调试用） */
  readonly count: number;
}

export function buildNav(terrain: GorgeTerrain, colliders: readonly Collider[], routes: NavRoute[], zips: NavZip[], fordCells: (x: number, z: number) => boolean): NavGraph {
  const S = 1;
  const W = Math.floor((terrain.maxX - terrain.minX) / S), H = Math.floor((terrain.maxZ - terrain.minZ) / S);
  const cx = (i: number): number => terrain.minX + (i + 0.5) * S, cz = (j: number): number => terrain.minZ + (j + 0.5) * S;
  // 每格的层：[高度, 来源（-1 地形；否则 route 序号或 -2 = 不属于任何路的建筑顶面）]
  const layers: { h: number; src: number; ford: boolean }[][] = Array.from({ length: W * H }, () => []);
  const blockedAt = new Map<number, { y0: number; y1: number }[]>();
  const routeOf = new Map<Collider, number>();
  routes.forEach((r, k) => r.colliders.forEach(c => routeOf.set(c, k)));
  const inside = (c: Collider, x: number, z: number, pad: number): boolean => {
    if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) <= c.r + pad;
    const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad;
  };
  for (const c of colliders) {
    const ext = c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.r;
    const i0 = Math.max(0, Math.floor((c.x - ext - terrain.minX) / S)), i1 = Math.min(W - 1, Math.ceil((c.x + ext - terrain.minX) / S));
    const j0 = Math.max(0, Math.floor((c.z - ext - terrain.minZ) / S)), j1 = Math.min(H - 1, Math.ceil((c.z + ext - terrain.minZ) / S));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      if (c.walkable && inside(c, cx(i), cz(j), 0.35)) layers[k].push({ h: c.y1, src: routeOf.get(c) ?? -2, ford: false });
      else if (!c.walkable && inside(c, cx(i), cz(j), 0.2)) { let l = blockedAt.get(k); if (!l) blockedAt.set(k, l = []); l.push({ y0: c.y0, y1: c.y1 }); }
    }
  }
  let count = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, x = cx(i), z = cz(j);
    const gi = Math.round(x - terrain.minX), gj = Math.round(z - terrain.minZ);
    const bound = terrain.basin[gj * terrain.nx + gi];
    const h = terrain.heightAt(x, z);
    const wet = terrain.waterDepthAt(x, z);
    if (bound <= MAP.softBoundary && terrain.slopeAt(x, z) <= Math.atan(LIM) && wet <= 1.1) {
      layers[k].push({ h, src: -1, ford: wet > 0.05 && fordCells(x, z) });
    }
    // 被墙、房子挡住的面去掉（顶面本身属于那个碰撞体的除外）
    const bl = blockedAt.get(k);
    if (bl) layers[k] = layers[k].filter(L => !bl.some(b => b.y0 < L.h + 1.6 && b.y1 > L.h + 0.45));
    count += layers[k].length;
  }
  // 层编号：node = k * 4 + 层序号（每格最多 4 层）
  const MAXL = 4;
  const nodeH = new Float32Array(W * H * MAXL).fill(NaN);
  const nodeSrc = new Int16Array(W * H * MAXL);
  const nodeFord = new Uint8Array(W * H * MAXL);
  layers.forEach((ls, k) => ls.slice(0, MAXL).forEach((L, n) => { nodeH[k * MAXL + n] = L.h; nodeSrc[k * MAXL + n] = L.src; nodeFord[k * MAXL + n] = L.ford ? 1 : 0; }));
  const zipEdges = zips.map(z => ({
    id: z.id,
    from: (Math.floor((z.from[1] - terrain.minZ) / S)) * W + Math.floor((z.from[0] - terrain.minX) / S),
    to: (Math.floor((z.to[1] - terrain.minZ) / S)) * W + Math.floor((z.to[0] - terrain.minX) / S),
  }));
  const routeIndex = new Map(routes.map((r, k) => [r.id, k]));

  /** a → b 能不能走（b 在 a 的相邻格）；dist = 两格中心距离 */
  const canStep = (ha: number, sa: number, hb: number, sb: number, dist: number): boolean => {
    const dh = hb - ha;
    if (dh < -3) return false;
    if (dh < 0 && -dh > 1.2) return true;  // 往下跳（单向：反方向时 dh > 0 会被下面挡住）
    if (sa === -1 && sb === -1) return Math.abs(dh) <= dist * LIM + 0.15;
    if (sa === sb && sa >= 0) return Math.abs(dh) <= dist * 1.05 + 0.1;   // 同一条桥 / 栈道上的台阶
    return Math.abs(dh) <= 0.75;
  };

  const reach = (from: [number, number], opts: { without?: string; reverse?: boolean } = {}): Uint8Array => {
    const seen = new Uint8Array(W * H * MAXL);
    const skip = opts.without !== undefined ? routeIndex.get(opts.without) ?? -9 : -9;
    const noFord = opts.without === 'ford';
    const noZip = zipEdges.find(z => z.id === opts.without);
    const ok = (n: number): boolean => !Number.isNaN(nodeH[n]) && nodeSrc[n] !== skip && !(noFord && nodeFord[n]);
    const queue: number[] = [];
    const fi = Math.floor((from[0] - terrain.minX) / S), fj = Math.floor((from[1] - terrain.minZ) / S);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const k = (fj + dj) * W + fi + di;
      for (let n = 0; n < MAXL; n++) if (ok(k * MAXL + n) && !seen[k * MAXL + n]) { seen[k * MAXL + n] = 1; queue.push(k * MAXL + n); }
    }
    while (queue.length) {
      const node = queue.pop()!;
      const k = Math.floor(node / MAXL), i = k % W, j = Math.floor(k / W);
      const h = nodeH[node], s = nodeSrc[node];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni, dist = di && dj ? Math.SQRT2 * S : S;
        for (let n = 0; n < MAXL; n++) {
          const m = nk * MAXL + n;
          if (seen[m] || !ok(m)) continue;
          const go = opts.reverse ? canStep(nodeH[m], nodeSrc[m], h, s, dist) : canStep(h, s, nodeH[m], nodeSrc[m], dist);
          if (go) { seen[m] = 1; queue.push(m); }
        }
      }
      // 溜索：从起点平台附近滑到终点平台
      for (const z of zipEdges) {
        if (z === noZip) continue;
        const [a, b] = opts.reverse ? [z.to, z.from] : [z.from, z.to];
        const ai = a % W, aj = Math.floor(a / W);
        if (Math.abs(ai - i) > 3 || Math.abs(aj - j) > 3) continue;
        const bi = b % W, bj = Math.floor(b / W);
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const bk = (bj + dj) * W + bi + di;
          for (let n = 0; n < MAXL; n++) { const m = bk * MAXL + n; if (!seen[m] && ok(m)) { seen[m] = 1; queue.push(m); } }
        }
      }
    }
    return seen;
  };

  const hit = (seen: Uint8Array, x: number, z: number, r = 3): boolean => {
    const ci = Math.floor((x - terrain.minX) / S), cj = Math.floor((z - terrain.minZ) / S);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      for (let n = 0; n < MAXL; n++) if (seen[(nj * W + ni) * MAXL + n]) return true;
    }
    return false;
  };

  const stats = (seen: Uint8Array): { area: number; walkable: number; reach: number } => {
    let area = 0, walk = 0, rch = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = cx(i), z = cz(j);
      const gi = Math.round(x - terrain.minX), gj = Math.round(z - terrain.minZ);
      if (terrain.basin[gj * terrain.nx + gi] > 0 || terrain.waterDepthAt(x, z) > 0.05) continue;
      area++;
      const k = j * W + i;
      let any = false, got = false;
      for (let n = 0; n < MAXL; n++) { if (!Number.isNaN(nodeH[k * MAXL + n])) any = true; if (seen[k * MAXL + n]) got = true; }
      if (any) walk++;
      if (got) rch++;
    }
    return { area: area * S * S, walkable: walk / area, reach: rch / area };
  };

  return { reach, hit, stats, W, H, count };
}
