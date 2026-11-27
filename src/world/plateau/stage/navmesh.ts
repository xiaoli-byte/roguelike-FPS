/**
 * 没有 Unity 导航网格的高原图（4-4）：按地形和碰撞世界生成一张网格导航网格（UnityNavigationData 的格式）。
 * 每 step 米一个格点；格点可走 = 在可玩区里、坡不陡、不在碰撞体占地里、水不深；四个角都可走的格子出两个三角形。
 * 从出生点连通的才留（孤岛去掉）。正式游戏的导航（UnityNavigation）、坠落回收、刷怪点都读它。
 */
import type { UnitySceneDocument } from '../../UnityLevelLibrary';
import type { HeightGrid } from '../grid';
import type { CollisionWorld } from '../walker';

export interface NavGridOptions {
  step?: number;
  /** 到可玩区边界的有符号距离（区内为负） */
  bound: (x: number, z: number) => number;
  /** 最陡能走的坡（弧度），缺省 40° */
  maxSlope?: number;
  /** 最深能走的水（米），缺省 0.9 */
  maxWater?: number;
  /** 从这里连通的才留 */
  seed: [number, number];
}

export function buildGridNav(terrain: HeightGrid, world: CollisionWorld, o: NavGridOptions): UnitySceneDocument['navigation'] {
  const step = o.step ?? 2, maxSlope = Math.tan(o.maxSlope ?? (40 * Math.PI) / 180), maxWater = o.maxWater ?? 0.9;
  const x0 = Math.ceil(terrain.minX / step) * step, z0 = Math.ceil(terrain.minZ / step) * step;
  const nx = Math.floor((terrain.maxX - x0) / step) + 1, nz = Math.floor((terrain.maxZ - z0) / step) + 1;
  const ok = new Uint8Array(nx * nz), y = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
    const h = terrain.heightAt(x, z);
    y[k] = h;
    if (o.bound(x, z) > 0) continue;
    const e = 0.8;
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e), gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > maxSlope) continue;
    if (terrain.waterDepthAt(x, z) > maxWater) continue;
    if (world.occupied(x, z, 0.45)) continue;
    ok[k] = 1;
  }
  // 从出生点连通
  const si = Math.round((o.seed[0] - x0) / step), sj = Math.round((o.seed[1] - z0) / step);
  const keep = new Uint8Array(nx * nz);
  let start = -1, best = Infinity;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
    const i = si + di, j = sj + dj;
    if (i < 0 || j < 0 || i >= nx || j >= nz || !ok[j * nx + i]) continue;
    const d = di * di + dj * dj;
    if (d < best) { best = d; start = j * nx + i; }
  }
  if (start >= 0) {
    const queue = [start];
    keep[start] = 1;
    while (queue.length) {
      const k = queue.pop()!, i = k % nx, j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const n = b * nx + a;
        if (keep[n] || !ok[n] || Math.abs(y[n] - y[k]) > step * 0.9) continue;
        keep[n] = 1;
        queue.push(n);
      }
    }
  }
  const index = new Int32Array(nx * nz).fill(-1);
  const vertices: [number, number, number][] = [];
  const vid = (k: number): number => {
    if (index[k] < 0) { index[k] = vertices.length; const i = k % nx, j = (k - i) / nx; vertices.push([x0 + i * step, +y[k].toFixed(3), z0 + j * step]); }
    return index[k];
  };
  const indices: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (!keep[a] || !keep[b] || !keep[c] || !keep[d]) continue;
    // 绕序同 Unity 导出的导航网格（(b − a) × (c − a) 的 y 分量为正）：a → b → c、b → d → c
    indices.push(vid(a), vid(b), vid(c), vid(b), vid(d), vid(c));
  }
  return { vertices, indices, areas: new Array(indices.length / 3).fill(0) };
}
