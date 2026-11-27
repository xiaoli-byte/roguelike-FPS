import { AirLife, type LeafCrown, type MoteBox } from '../../AirLife';
import { Banners, type Banner } from '../banners';
import { StormWall, type StormWallOptions } from '../stormWall';
import { GroundScatter, type GroundScatterOptions, type ScatterRoad } from '../groundScatter';
import type { WbTerrain } from '../whitebox/terrain';
import {
  beaconSmoke, dustDevils, groundDrift, ridgeSand, sandFalls,
  type DriftPatch, type DustDevil, type GroundDriftOptions, type RidgeLine, type RidgeSandOptions, type SandFall, type SandFallOptions,
  type SmokeColumn, type SmokeOptions,
} from '../sandFx';
import type { DesertBuild, DesertPart, Vec3 } from '../spec';
import type { V2, WhiteboxSpec } from '../whitebox/types';

/**
 * 第一章重做版的特效（level-art.md 第五步）：每张图在 maps.ts 的 `fx` 里写要哪些，这里按白盒数据摆好、挂到场景上。
 *   - 沙脊吹沙：白盒里的沙丘脊图章（ridge，沙丘材质）自动变成脊线，按脊高定吹多远、沙团多大；可以再手加脊线
 *   - 烽燧狼烟 / 香烟、尘卷风、落沙、贴地流沙：sandFx.ts 的五样（每样一次绘制调用）
 *   - 旗幡：banners.ts（立杆挑幡、檐下挂幡，两次绘制调用）
 *   - 落叶 / 光里的尘：AirLife（白杨树冠下掉叶子，树从白盒的「白杨」体块取）
 * 鸟群不在这里：氛围层按章节自动放（unityAtmosphereLayout），maps.ts 的 look.layout.flocks 可以手加。
 */
export interface RedoFx {
  /** 白盒沙丘脊 → 沙脊吹沙；false = 这张图不要 */
  ridges?: false | {
    /** 吹多远 = 脊高 × 这个倍数（夹在 14–40 m），默认 1 */
    reach?: number;
    /** 不透明度，默认 0.75 */
    opacity?: number;
    /** 沙团大小倍率，默认 1（脊高 × 0.32，夹在 5–14 m） */
    size?: number;
    /** 脊高低于这个（m）的不吹，默认 6 */
    minHeight?: number;
    /** 这些圆里不吹（出生点、出生看出去的第一眼） */
    skip?: { at: V2; r: number }[];
  };
  /** 手加的脊线（世界坐标；y 不给 = 贴地形） */
  extraRidges?: { points: V2[]; reach?: number; size?: number; opacity?: number }[];
  ridgeOptions?: RidgeSandOptions;
  smoke?: SmokeColumn[];
  smokeOptions?: SmokeOptions;
  devils?: DustDevil[];
  falls?: SandFall[];
  fallOptions?: SandFallOptions;
  drift?: DriftPatch[];
  driftOptions?: GroundDriftOptions;
  /** 旗幡：pole 的 at 给 [x, z]（脚下贴地），hang 的 at 给 [x, y, z]（挂点） */
  banners?: (Omit<Banner, 'at'> & { at: V2 | Vec3 })[];
  bannerWind?: number;
  /** 白杨落叶的颜色（不给 = 不落叶） */
  leaves?: number;
  /** 光里的尘（门洞、殿内） */
  motes?: MoteBox[];
  /** 天边的沙暴墙（圆心 = 图中心，墙脚 = 远景地面高度，受光朝白盒的太阳） */
  storm?: Omit<StormWallOptions, 'center' | 'baseY' | 'sunAzimuth'>;
  /** 地面散布（groundScatter.ts）：枯草、碎石按白盒地面材质的密度撒；路 = 白盒里路材质的涂抹 / 坡道，自动出车辙和砾石路肩 */
  ground?: Pick<GroundScatterOptions, 'grass' | 'pebbles' | 'shrubs' | 'shoulder' | 'grassColor' | 'pebbleColors' | 'ruts' | 'rutTint'>;
}

/** 白盒里的路：mat = road 的涂抹带（折线 + 半宽）和坡道 */
function whiteboxRoads(spec: WhiteboxSpec): ScatterRoad[] {
  const roads: ScatterRoad[] = [];
  for (const op of spec.terrain) {
    if (op.op === 'paint' && op.mat === 'road' && op.pts && op.half && !op.closed) roads.push({ pts: op.pts, half: op.half });
    else if (op.op === 'ramp' && op.mat === 'road') roads.push({ pts: op.pts, half: op.half });
  }
  return roads;
}

/** 散布用的地面：图里、不压在体块下（行走面比地形高 0.25 m 以上 = 有体块）、不是水 / 木 / 瓦 / 植被 */
function scatterSurface(b: DesertBuild, terrain: WbTerrain): { height(x: number, z: number): number; kind(x: number, z: number): string | null } {
  const [W, D] = terrain.spec.size;
  return {
    height: (x, z) => b.terrainHeight(x, z),
    kind: (x, z) => {
      if (x < 0 || z < 0 || x > W || z > D) return null;
      if (terrain.walkAt(x, z) > terrain.groundAt(x, z) + 0.25) return null;
      const m = terrain.matAt(x, z);
      return m === 'water' || m === 'timber' || m === 'roof' || m === 'plant' ? null : m;
    },
  };
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** 白盒里的沙丘脊图章 → 脊线（跳过 skip 圆里的点，断成几段） */
function whiteboxRidges(spec: WhiteboxSpec, b: DesertBuild, o: Exclude<RedoFx['ridges'], false | undefined>): RidgeLine[] {
  const out: RidgeLine[] = [];
  const minH = o.minHeight ?? 6;
  for (const op of spec.terrain) {
    if (op.op !== 'ridge' || (op.mat && op.mat !== 'dune')) continue;
    const hs = Array.isArray(op.h) ? op.h : op.pts.map(() => op.h as number);
    const top = Math.max(...hs);
    if (top < minH) continue;
    let seg: Vec3[] = [];
    const flush = (): void => {
      if (seg.length >= 2) out.push({ points: seg, reach: clamp(top * (o.reach ?? 1), 14, 44), size: clamp(top * 0.32, 5, 14) * (o.size ?? 1), opacity: o.opacity, spacing: top > 25 ? 11 : 9 });
      seg = [];
    };
    // 折线按 4 m 一点加密，每点贴到地形上（脊顶）
    for (let k = 0; k < op.pts.length - 1; k++) {
      const a = op.pts[k], c = op.pts[k + 1], n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / 4));
      for (let i = 0; i < n + (k === op.pts.length - 2 ? 1 : 0); i++) {
        const t = i / n, x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t;
        const h = hs[k] + (hs[k + 1] - hs[k]) * t;
        const skip = (o.skip ?? []).some(s => Math.hypot(x - s.at[0], z - s.at[1]) < s.r);
        const y = b.terrainHeight(x, z);
        // 两头收尖、太矮的地方不吹
        if (skip || h < minH * 0.75 || !Number.isFinite(y)) { flush(); continue; }
        seg.push([x, y, z]);
      }
    }
    flush();
  }
  return out;
}

/** 白杨树冠（白盒「白杨」体块：有悬空树冠的用树冠，只有一根柱子的按柱顶往下 2.5 m） */
function poplarCrowns(spec: WhiteboxSpec, b: DesertBuild, color: number): LeafCrown[] {
  const crowns: LeafCrown[] = [];
  const seen = new Set<string>();
  for (const blk of spec.blocks) {
    if (blk.needs?.split('：')[0] !== '白杨') continue;
    const key = `${blk.at[0]},${blk.at[1]}`;
    if (seen.has(key)) continue;
    const g = b.terrainHeight(blk.at[0], blk.at[1]);
    if (!Number.isFinite(g)) continue;
    const canopy = spec.blocks.find(c => c.canopy && c.needs === blk.needs && c.at[0] === blk.at[0] && c.at[1] === blk.at[1]);
    const top = canopy?.top ?? blk.top ?? g + (canopy?.h ?? blk.h ?? 10);
    seen.add(key);
    crowns.push({ position: [blk.at[0], top - 2.5, blk.at[1]], radius: canopy ? canopy.size[0] : 2, ground: g + 0.05, count: 8, color });
  }
  // 树多的时候隔一棵取一棵（一棵 8 片叶子，同时在空中的约三分之一）
  return crowns.length > 36 ? crowns.filter((_, k) => k % 2 === 0) : crowns;
}

export function redoFx(b: DesertBuild, spec: WhiteboxSpec, fx: RedoFx | undefined, baseY = 0, terrain?: WbTerrain): DesertPart[] {
  if (!fx) return [];
  const parts: DesertPart[] = [];
  if (fx.ground && terrain) {
    const scatter = new GroundScatter(scatterSurface(b, terrain), {
      ...fx.ground,
      bounds: [0, 0, spec.size[0], spec.size[1]],
      roads: whiteboxRoads(spec),
      wind: spec.wind,
      // 据点场地中心密度减半：交战区不要满地碎东西
      calm: spec.strongholds.map(s => ({ x: s.at[0], z: s.at[1], r: (s.r ?? 24) * 0.45 })),
      low: b.low,
    });
    b.group.add(scatter.group);
    parts.push(scatter);
  }
  if (fx.storm) {
    // 白盒太阳方位（从北顺时针）→ farLayer 方位（0 = +Z、90 = +X）
    const storm = new StormWall({ ...fx.storm, center: [spec.size[0] / 2, spec.size[1] / 2], baseY, sunAzimuth: 180 - spec.sun.azimuth });
    b.group.add(storm.mesh);
    parts.push(storm);
  }
  const ridges: RidgeLine[] = [];
  if (fx.ridges !== false) ridges.push(...whiteboxRidges(spec, b, fx.ridges ?? {}));
  for (const r of fx.extraRidges ?? []) {
    const points = r.points.map((p): Vec3 => [p[0], b.terrainHeight(p[0], p[1]), p[1]]).filter(p => Number.isFinite(p[1]));
    if (points.length >= 2) ridges.push({ points, reach: r.reach, size: r.size, opacity: r.opacity });
  }
  if (ridges.length) parts.push(ridgeSand(b, ridges, fx.ridgeOptions));
  if (fx.smoke?.length) parts.push(beaconSmoke(b, fx.smoke, fx.smokeOptions));
  if (fx.devils?.length) parts.push(dustDevils(b, fx.devils));
  if (fx.falls?.length) parts.push(sandFalls(b, fx.falls, fx.fallOptions));
  if (fx.drift?.length) parts.push(groundDrift(b, fx.drift, fx.driftOptions));
  if (fx.banners?.length) {
    const list: Banner[] = fx.banners.map(x => ({
      ...x,
      at: x.at.length === 2 ? [x.at[0], b.groundHeight(x.at[0], x.at[1]), x.at[1]] : x.at,
    }));
    const banners = new Banners(list, { wind: spec.wind, strength: fx.bannerWind });
    b.group.add(banners.group);
    parts.push(banners);
  }
  const leaves = fx.leaves !== undefined ? poplarCrowns(spec, b, fx.leaves) : [];
  if (leaves.length || fx.motes?.length) {
    const life = new AirLife({ leaves, motes: fx.motes });
    b.group.add(life.group);
    parts.push({ dispose: () => { life.group.removeFromParent(); life.dispose(); } });
  }
  return parts;
}
