// 4-4 可达性探针（node scripts/plateau/reach_probe.mjs 4-4）：照 src/dev/haiziLab.ts 组装地形 + 碰撞体，按 4-2 nav.ts 同一套规则做 1 m 网格搜索。
import * as THREE from 'three';
import { CollisionWorld } from '../../../src/world/plateau/walker';
import { buildHaizi } from '../../../src/world/haizi/scene';
import { LAKE, MAP, PILLARS, PLACEMENTS, SPAWN } from '../../../src/world/haizi/spec';
import { HaiziTerrain } from '../../../src/world/haizi/terrain';

const LIM = Math.tan((40 * Math.PI) / 180);
function run() {
  const t0 = performance.now();
  const terrain = new HaiziTerrain();
  const world = new CollisionWorld(terrain);
  buildHaizi(new THREE.Scene(), terrain, world, 256, 256);
  const R = 112, W = 2 * R;
  const idx = (x: number, z: number) => (Math.floor(z + R)) * W + Math.floor(x + R);
  const H = new Float32Array(W * W).fill(NaN);
  const inside = (c: any, x: number, z: number, pad: number) => {
    if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) <= c.r + pad;
    const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return Math.abs(dx * cs - dz * sn) <= c.hx + pad && Math.abs(dx * sn + dz * cs) <= c.hz + pad;
  };
  const gi = (x: number, z: number) => Math.round(z - terrain.minZ) * terrain.nx + Math.round(x - terrain.minX);
  let blockedCells = 0;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = i - R + 0.5, z = j - R + 0.5;
    if (x < terrain.minX || x > terrain.maxX || z < terrain.minZ || z > terrain.maxZ) continue;
    const h = terrain.heightAt(x, z), wet = terrain.waterLevelAt(x, z) - h;
    if (terrain.basin[gi(x, z)] > MAP.softBoundary || terrain.slopeAt(x, z) > Math.atan(LIM) || wet > 1.1) continue;
    if (world.list.some((c: any) => !c.walkable && inside(c, x, z, 0.2) && c.y0 < h + 1.6 && c.y1 > h + 0.45)) { blockedCells++; continue; }
    H[j * W + i] = h;
  }
  const seen = new Uint8Array(W * W);
  const q: number[] = [];
  const s0 = idx(SPAWN.x, SPAWN.z);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k = s0 + dj * W + di; if (!Number.isNaN(H[k])) { seen[k] = 1; q.push(k); } }
  while (q.length) {
    const k = q.pop()!, i = k % W, j = Math.floor(k / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const m = nj * W + ni; if (seen[m] || Number.isNaN(H[m])) continue;
      const dh = H[m] - H[k], dist = di && dj ? Math.SQRT2 : 1;
      if (dh < -3) continue;
      if ((dh < 0 && -dh > 1.2) || Math.abs(dh) <= dist * LIM + 0.15) { seen[m] = 1; q.push(m); }
    }
  }
  const hit = (x: number, z: number, r = 2) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (seen[idx(x + dx, z + dz)]) return true; return false; };
  const near = (x: number, z: number, Rm = 30) => { let b: any = null; for (let dz = -Rm; dz <= Rm; dz++) for (let dx = -Rm; dx <= Rm; dx++) { const d = Math.hypot(dx, dz); if (d > Rm || (b && d >= b.d)) continue; if (seen[idx(x + dx, z + dz)]) b = { x: x + dx, z: z + dz, d: +d.toFixed(1) }; } return b; };
  // 湖岸环：按 10° 分扇区，统计每个扇区能走到的格子
  const sectors: number[] = [];
  for (let a = 0; a < 36; a++) {
    let got = 0, tot = 0;
    for (let r = LAKE.shoreR; r <= LAKE.shoreOuterR; r += 1) for (let t = 0; t < 10; t += 2) {
      const ang = ((a * 10 + t) * Math.PI) / 180, x = Math.sin(ang) * r, z = -Math.cos(ang) * r;
      tot++; if (seen[idx(x, z)]) got++;
    }
    sectors.push(Math.round((got / tot) * 100));
  }
  // 出生 + 入场点：docs/art/concepts/ch4-631/README.md 3.2（2026-11-18 按本探针修正过）；__cand 可以追加候选点
  const PTS: [string, number, number][] = [['出生', SPAWN.x, SPAWN.z], ['E1 北垭口', 14, -77], ['E2 冰舌脚', -40, -66], ['E3 东坡', 76, -14], ['E4 西南雪坡', -56, 52],
    ['E5 西北岸（飞临落点）', -48, -32], ['E6 东岸（飞临落点）', 50, 24], ...((window as any).__cand ?? [])];
  const pts = PTS.map(([id, x, z]) => ({ id, x, z, r: +Math.hypot(x, z).toFixed(1), h: +terrain.heightAt(x, z).toFixed(1), slope: +(terrain.slopeAt(x, z) * 180 / Math.PI).toFixed(0),
    wet: +(terrain.waterLevelAt(x, z) - terrain.heightAt(x, z)).toFixed(2), bound: +terrain.basin[gi(x, z)].toFixed(1), reach: hit(x, z), nearest: hit(x, z) ? null : near(x, z) }));
  const pillarAccess = PILLARS.map(p => ({ id: p.id, ok: [0, 1, 2, 3, 4, 5, 6, 7].filter(k => hit(p.x + Math.cos(k * Math.PI / 4) * 3.5, p.z + Math.sin(k * Math.PI / 4) * 3.5, 0)).length }));
  const placeAccess = PLACEMENTS.filter(p => p.kind !== 'altar').map(p => ({ kind: p.kind, x: p.x, z: p.z, sides: [0, 1, 2, 3, 4, 5, 6, 7].filter(k => hit(p.x + Math.cos(k * Math.PI / 4) * 4, p.z + Math.sin(k * Math.PI / 4) * 4, 0)).length }));
  return { ms: Math.round(performance.now() - t0), colliders: world.list.length, blockedCells, sectors, pts, pillarAccess, placeAccess };
}
(window as any).__run = () => { try { return run(); } catch (e) { return { error: String((e as Error)?.stack ?? e) }; } };
