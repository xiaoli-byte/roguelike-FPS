/**
 * 4-4 神山海子的玩法数据（没有 Unity 版，按检视页的 spec 编；坐标就是高原坐标）：
 *   出生 = 南岸（SPAWN）；首领 = 雷泽雷神（boss_leize），场地圆心在湖心、半径 62 m，走到湖边就开打；
 *   门外补给营（BalanceModel：「4-4 门外补给营」）= 出生点身后；湖 = 一块水（浅处减速、深处算危险、回到安全的岸上）；
 *   软边界 = 湖心 78 m 外起风雪推回（public/assets/plateau/4-4-boundary.f32，scripts/plateau/author-44.mjs 生成）；
 *   导航网格 = navmesh.ts 按地形和碰撞生成。据点、出口没有：终局首领战，打赢就通关。
 */
import type { UnitySceneDocument } from '../../UnityLevelLibrary';
import { ISLAND, LAKE, MAP, SPAWN } from '../../haizi/spec';
import { buildGridNav } from './navmesh';
import type { Haizi44 } from './world44';

type PlayData = Omit<UnitySceneDocument, 'renderers' | 'colliders' | 'heightfields' | 'scene'>;

export function play44(h: Haizi44): PlayData {
  const T = h.terrain;
  const sy = T.heightAt(SPAWN.x, SPAWN.z);
  const fl = Math.hypot(SPAWN.x, SPAWN.z) || 1;
  // 补给营：出生点再往外（离湖远）14 m、往东偏 10 m（不挡从出生点看湖、看神山的那一眼）
  const ox = SPAWN.x / fl, oz = SPAWN.z / fl;
  const cx = SPAWN.x + ox * 14 + oz * 10, cz = SPAWN.z + oz * 14 - ox * 10;
  const depth = LAKE.level - LAKE.bottom;
  let lo = Infinity, hi = -Infinity;
  for (let x = T.minX; x <= T.maxX; x += 8) for (let z = T.minZ; z <= T.maxZ; z += 8) { const y = T.heightAt(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const navigation = buildGridNav(T, h.world, { bound: (x, z) => Math.hypot(x, z) - MAP.playRadius, seed: [SPAWN.x, SPAWN.z] });
  return {
    schema: 3, id: '4-4', title: '神山海子',
    spawn: { position: [SPAWN.x, sy, SPAWN.z], forward: [-SPAWN.x / fl, 0, -SPAWN.z / fl] },
    bounds: { min: [-MAP.playRadius - 4, lo, -MAP.playRadius - 4], max: [MAP.playRadius + 4, hi, MAP.playRadius + 4] },
    visualBounds: { min: [T.minX, lo, T.minZ], max: [T.maxX, hi, T.maxZ] },
    environment: {
      fog: { enabled: true, mode: 1, color: [0.8, 0.84, 0.88, 1], start: 260, end: 4200, density: 0.01 },
      ambient: { mode: 1, sky: [0.71, 0.77, 0.86, 1], equator: [0.64, 0.66, 0.7, 1], ground: [0.64, 0.66, 0.7, 1], light: [1, 1, 1, 1], intensity: 1 },
      sun: null, sky: null, lights: [],
    },
    encounters: [], entries: [], exits: [], caches: [], layout: null, platforms: [], activators: [],
    camps: [{ title: '神山海子 · 门外补给营', position: [cx, T.heightAt(cx, cz), cz], yaw: Math.atan2(-SPAWN.x, -SPAWN.z), safeRadius: 10, openShop: true }],
    bosses: [{
      id: 'boss_leize', position: [0, LAKE.level, 0], center: [0, LAKE.level, 0], floorY: LAKE.level, radius: 62,
      reward: [ISLAND.x, LAKE.level + ISLAND.h, ISLAND.z], stronghold: false,
    }],
    water: [{
      id: 'haizi-lake', name: 'Water_HaiziLake', center: [0, LAKE.level - depth / 2, 0], scale: [LAKE.shoreR * 2, depth, LAKE.shoreR * 2],
      rotation: [0, 0, 0, 1], shallow: 0.15, deep: 1.3, wadeSlow: 0.55, deepIsHazard: true, drownBurst: 0.05, spring: false, beds: [],
    }] as unknown as UnitySceneDocument['water'],
    navigation,
    mechanisms: {
      boundary: {
        scenePath: 'Environment/Boundary', url: 'assets/plateau/4-4-boundary.f32', width: 201, height: 201, origin: [-200, -200], cell: 2, theme: 'Frost',
        tuning: { softStart: 0, windRamp: 14, pushBase: 4, pushGain: 18, hazeLead: 6, failsafe: 26, navInset: 2, tetherSlack: 2, tetherGrace: 1.2 },
      },
    } as unknown as UnitySceneDocument['mechanisms'],
  } as PlayData;
}
