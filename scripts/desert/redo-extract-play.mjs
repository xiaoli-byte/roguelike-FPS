// 一次性：把第一章的玩法数据从 Unity 导出（public/assets/unity-levels/）搬进 src/world/desert/redo/play.ts。
// 用户 2026-11-26：「现在是要从unity迁移到threeJS，以后unity是要删除的」——重做版运行时不再读 Unity 导出物；
// 搬完之后以 play.ts 为准（手改它），这个脚本只在 Unity 导出还在时重跑对照用。
//   node scripts/desert/redo-extract-play.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const MAPS = ['1-1', '1-2', '1-3', '1-4', '1-A'];
const root = 'public/assets/unity-levels';
const mech = JSON.parse(readFileSync(`${root}/mechanisms.json`, 'utf8')).scenes;
const vols = JSON.parse(readFileSync(`${root}/volumes.json`, 'utf8')).scenes;
const r4 = v => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(r4) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)])) : v;

const out = {};
for (const id of MAPS) {
  const d = JSON.parse(readFileSync(`${root}/scenes/${id}.json`, 'utf8'));
  const m = mech[id] ?? {};
  const env = structuredClone(d.environment);
  env.sky = null;   // Unity 烘的立方体天空盒不搬：重做版用网页的渐变天球（光影那一步按图调）
  out[id] = r4({
    title: d.title,
    encounters: d.encounters.map(e => ({
      title: e.title, optional: e.optional, requires: e.requires, reward: e.reward, chestOffset: e.chestOffset, difficulty: e.difficulty,
      triggerRadius: e.triggerRadius, arenaRadius: e.arenaRadius, entryDepth: e.entryDepth, requireSight: e.requireSight, autoTrigger: e.autoTrigger,
      roadside: e.roadside, roles: e.anchors.map(a => a.role), lanes: e.anchors.map(a => a.lane), waves: e.waves,
    })),
    caches: d.caches.map(c => ({ title: c.title, reward: c.reward, guard: c.guard })),
    bosses: d.bosses.map(b => ({ id: b.id, radius: b.radius })),
    environment: env,
    weather: m.weather ? {
      baseFogColor: m.weather.baseFogColor, baseFogStart: m.weather.baseFogStart, baseFogEnd: m.weather.baseFogEnd, theme: m.weather.theme,
      whiteoutProfile: m.weather.whiteoutProfile, baseWind: m.weather.baseWind,
      region: m.weather.regions[0] ? (({ center: _c, radius: _r, from: _f, ...rest }) => rest)(m.weather.regions[0]) : null,
    } : null,
    boundaryTuning: m.boundary?.tuning ?? null,
    quicksand: m.quicksand?.[0] ? (({ scenePath: _s, position: _p, rotation: _q, scale: _k, yaw: _y, matrix: _m, ...rest }) => rest)(m.quicksand[0]) : null,
    camp: m.camps?.[0] ? { safeRadius: m.camps[0].safeRadius, openShop: m.camps[0].openShop, restoreOnArrive: m.camps[0].restoreOnArrive } : null,
    safeZone: m.safeZones?.[0] ? { radius: m.safeZones[0].radius, height: m.safeZones[0].height, pushMargin: m.safeZones[0].pushMargin, carveNavMesh: m.safeZones[0].carveNavMesh } : null,
    grade: vols[id]?.resolved ?? null,
    water: d.water?.[0] ? { shallow: d.water[0].shallow, deep: d.water[0].deep, wadeSlow: d.water[0].wadeSlow, deepIsHazard: d.water[0].deepIsHazard, drownBurst: d.water[0].drownBurst } : null,
  });
}

const src = `// 自动生成（一次性搬运）：node scripts/desert/redo-extract-play.mjs，2026-11-26 从 Unity 导出的旧场景搬来第一章的玩法数据。
// 用户：「现在是要从unity迁移到threeJS，以后unity是要删除的」——重做版运行时只读这份，不再读 public/assets/unity-levels；
// 以后要改波次 / 奖励 / 调色就直接改这里（脚本只在 Unity 导出还在时重跑对照用）。
import type { UnityEnvironment, UnityWave } from '../../UnityLevelLibrary';
import type { QuicksandData, SoftBoundaryTuning, WeatherRegionData } from '../../mechanisms/MechanismData';
import type { VolumeOverrides } from '../../../render/UrpVolume';

export interface PlayEncounter {
  title: string;
  optional: boolean;
  /** 先清哪些据点才开（据点名） */
  requires: string[];
  reward: string;
  chestOffset: [number, number, number];
  difficulty: number;
  triggerRadius: number;
  arenaRadius: number;
  entryDepth: number;
  requireSight: boolean;
  autoTrigger: boolean;
  roadside: boolean;
  /** 站位角色序列（0 自动 / 1 正面 / 2 侧袭 / 3 远程 / 4 狙击 / 5 炮手 / 6 辅助）和刷怪道：编译时按白盒场地重摆锚点 */
  roles: number[];
  lanes: number[];
  waves: UnityWave[];
}

export interface MapPlay {
  title: string;
  encounters: PlayEncounter[];
  caches: { title: string; reward: string; guard: string | null }[];
  bosses: { id: string; radius: number }[];
  /** 光 / 雾 / 环境光（天空盒去掉了） */
  environment: UnityEnvironment;
  weather: { baseFogColor: [number, number, number, number]; baseFogStart: number; baseFogEnd: number; theme: string; whiteoutProfile: string; baseWind: number; region: Omit<WeatherRegionData, 'center' | 'radius' | 'from'> | null } | null;
  boundaryTuning: SoftBoundaryTuning | null;
  /** 流沙的参数模板（位置按白盒） */
  quicksand: Omit<QuicksandData, 'scenePath' | 'position' | 'rotation' | 'scale' | 'yaw' | 'matrix'> | null;
  camp: { safeRadius: number; openShop: boolean; restoreOnArrive: boolean } | null;
  safeZone: { radius: number; height: number; pushMargin: number; carveNavMesh: boolean } | null;
  /** 后期调色（旧场景 Volume 混好的结果） */
  grade: VolumeOverrides | null;
  /** 水体的参数模板（浅 / 深阈值、蹚水减速、深水危险）；形状按白盒的水面多边形 */
  water: { shallow: number; deep: number; wadeSlow: number; deepIsHazard: boolean; drownBurst: number } | null;
}

export const PLAY: Record<string, MapPlay> = ${JSON.stringify(out, null, 1)} as unknown as Record<string, MapPlay>;
`;
writeFileSync('src/world/desert/redo/play.ts', src);
console.log('写了 src/world/desert/redo/play.ts', Object.keys(out).map(k => `${k}: ${out[k].encounters.length} 遭遇`).join('，'));
