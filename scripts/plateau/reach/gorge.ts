// 4-2 可达性探针（node scripts/plateau/reach_probe.mjs 4-2）：照 src/dev/gorgeLab.ts 组装地形 + 碰撞体 + 过河，再用 nav.ts 的行走图逐点查。
import * as THREE from 'three';
import { FlagSystem } from '../../../src/world/plateau/flags';
import { GeoBuilder } from '../../../src/world/plateau/geo';
import { CollisionWorld } from '../../../src/world/plateau/walker';
import { buildCrossings } from '../../../src/world/gorge/crossings';
import { Hazards } from '../../../src/world/gorge/hazards';
import { buildGorgeLandmarks } from '../../../src/world/gorge/landmarks';
import { buildNav } from '../../../src/world/gorge/nav';
import { SITES } from '../../../src/world/gorge/spec';
import { GorgeTerrain, fordWeight, macroAt } from '../../../src/world/gorge/terrain';

type P = { id: string; name: string; x: number; z: number; kind: 'site' | 'guard' | 'entry' | 'fly' };
const POINTS: P[] = [
  ...SITES.map(s => ({ id: s.id, name: s.name, x: s.altar?.[0] ?? s.x, z: s.altar?.[1] ?? s.z, kind: 'site' as const })),
  // 驻守点 / 入场点：docs/art/concepts/ch4-631/README.md 3.1（2026-11-18 按本探针修正过）
  { id: 'G1', name: '藤索吊桥东头', x: 186, z: -118, kind: 'guard' },
  { id: 'G2', name: '伸臂木桥西头', x: -230, z: -157, kind: 'guard' },
  { id: 'G3', name: '栈道 A 岩龛（栈道面上）', x: 28.6, z: -13.3, kind: 'guard' },
  { id: 'G4', name: '西岸骡道回头弯', x: -60, z: 138, kind: 'guard' },
  { id: 'E1', name: '西岸坡顶岩洞', x: -236, z: 52, kind: 'entry' },
  { id: 'E2', name: '寨后林线', x: -178, z: -40, kind: 'entry' },
  { id: 'E3', name: '伸臂桥北头山道', x: -240, z: -205, kind: 'entry' },
  { id: 'E4', name: '江嘴北脊', x: 10, z: -196, kind: 'entry' },
  { id: 'E5', name: '吊桥东山道', x: 214, z: -112, kind: 'entry' },
  { id: 'E6', name: '古驿道外', x: 218, z: 2, kind: 'entry' },
  { id: 'E7', name: '江嘴尖卵石滩（飞临落点）', x: -4, z: -30, kind: 'fly' },
  { id: 'E8', name: '下游东岸水边', x: 40, z: 190, kind: 'entry' },
];

function run() {
  const t0 = performance.now();
  const scene = new THREE.Scene();
  const terrain = new GorgeTerrain();
  new Hazards(scene, terrain);
  const world = new CollisionWorld(terrain);
  const crossings = buildCrossings(terrain, world);
  const flags = new FlagSystem();
  const builder = new GeoBuilder();
  buildGorgeLandmarks({ terrain, b: builder, flags, world, extra: new THREE.Group(), anim: [], smoke: [], icons: [], conductors: [] } as any);
  const nav = buildNav(terrain, world.list, crossings.routes, crossings.zips.map(z => ({ id: z.spec.id, from: [z.spec.from[0], z.spec.from[1]], to: [z.spec.to[0], z.spec.to[1]] })),
    (x, z) => { const m = macroAt(x, z); return m.river === 'dd' && fordWeight(m.s) > 0.3; });
  const spawn = SITES[0], exit = SITES.find(s => s.kind === 'exit')!;
  const fwd = nav.reach([spawn.x, spawn.z]);
  const back = nav.reach([exit.x, exit.z], { reverse: true });
  const nearest = (seen: Uint8Array, x: number, z: number, R = 60) => {
    let best: [number, number, number] | null = null;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > R || (best && d >= best[2])) continue;
      if (nav.hit(seen, x + dx, z + dz, 0)) best = [x + dx, z + dz, d];
    }
    return best;
  };
  const gi = (x: number, z: number) => Math.round(z - terrain.minZ) * terrain.nx + Math.round(x - terrain.minX);
  const rows = POINTS.map(p => {
    const h = terrain.heightAt(p.x, p.z), slope = terrain.slopeAt(p.x, p.z) * 180 / Math.PI, wet = terrain.waterDepthAt(p.x, p.z);
    const bound = terrain.basin[gi(p.x, p.z)];
    const inF = nav.hit(fwd, p.x, p.z, 3), inB = nav.hit(back, p.x, p.z, 3);
    const nf = inF ? null : nearest(fwd, p.x, p.z);
    // 从这一点出发（怪的视角）能不能走到出生点 / 任一据点
    let toPlayer = null as null | boolean;
    if (p.kind !== 'fly') {
      const from = nav.reach([p.x, p.z]);
      toPlayer = SITES.some(s => nav.hit(from, s.altar?.[0] ?? s.x, s.altar?.[1] ?? s.z, 3));
    }
    return { ...p, h: +h.toFixed(1), slope: +slope.toFixed(0), wet: +wet.toFixed(2), bound: +bound.toFixed(1), reachFromSpawn: inF, reachExit: inB, toSites: toPlayer,
      nearestReachable: nf ? { x: nf[0], z: nf[1], d: +nf[2].toFixed(1), h: +terrain.heightAt(nf[0], nf[1]).toFixed(1) } : null };
  });
  const checks = null;
  const routeDump: Record<string, [number, number, number][]> = {};
  for (const r of crossings.routes) routeDump[r.id] = r.colliders.filter(c => c.walkable).map(c => [+c.x.toFixed(1), +c.z.toFixed(1), +c.y1.toFixed(1)]);
  const CAND: [string, number, number][] = (window as any).__cand ?? [];
  const cand = CAND.map(([id, x, z]) => {
    const from = nav.reach([x, z]);
    return { id, x, z, h: +terrain.heightAt(x, z).toFixed(1), slope: +(terrain.slopeAt(x, z) * 180 / Math.PI).toFixed(0), wet: +terrain.waterDepthAt(x, z).toFixed(2),
      bound: +terrain.basin[gi(x, z)].toFixed(1), fromSpawn: nav.hit(fwd, x, z, 1), toExit: nav.hit(back, x, z, 1),
      toSites: SITES.some(t => nav.hit(from, t.altar?.[0] ?? t.x, t.altar?.[1] ?? t.z, 3)) };
  });
  return { ms: Math.round(performance.now() - t0), bounds: [terrain.minX, terrain.maxX, terrain.minZ, terrain.maxZ], softBoundary: 14, rows, checks, routeDump, cand };
}
(window as any).__run = () => (() => { try { return run(); } catch (e) { return { error: String((e as Error)?.stack ?? e) }; } })();

(window as any).__probe = (window as any).__cand ? (window as any).__run() : undefined;
