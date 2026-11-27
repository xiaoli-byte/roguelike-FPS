/**
 * 4-1 折多垭口的网页原生场景（和检视页 plateauLab.ts 同一套组装，去掉检视页才有的：怪物白模、领主、行走者、面板）。
 * 全部按高原自己的坐标（检视页的坐标）建在 local 里；正式游戏里外面套一个转 180° 的根节点（layer.ts）。
 */
import * as THREE from 'three';
import { buildFarTerrain, buildMountains, buildSky, SKY } from '../backdrop';
import { FlagSystem } from '../flags';
import { Smoke, buildWater } from '../fx';
import { GeoBuilder } from '../geo';
import { buildLandmarks, type Animated, type MapIcon, type SmokeEmitter } from '../landmarks';
import { materials } from '../materials';
import { GrassField, buildStaticScatter } from '../scatter';
import { Terrain } from '../terrain';
import { CollisionWorld } from '../walker';
import { WindStreaks, buildWindMarks, setWindField, windAt, type WindSample } from '../wind';
import type { HeightGrid } from '../grid';

/** 一张高原图建好的样子（layer.ts 拿它挂进正式游戏、document.ts 拿它编碰撞和高度场） */
export interface PlateauWorld {
  id: string;
  terrain: HeightGrid;
  /** 高原自己的碰撞体（方盒 / 圆柱，高原坐标） */
  world: CollisionWorld;
  /** 全部可见的东西（高原坐标）：地形、地标、经幡、草、水、烟、远山（天空另外挂，跟着镜头走） */
  local: THREE.Group;
  sky: THREE.Mesh;
  grass: GrassField;
  /** 每帧：按镜头位置（高原坐标）推进草、风痕、烟、小动画 */
  update(dt: number, time: number, camLocal: THREE.Vector3): void;
  /** 盛行风（高原坐标）；声床、云影用 */
  windAt: (x: number, z: number) => WindSample;
  /** 太阳方向（高原坐标）、晴天 / 雷暴的地平线色 */
  sunDir: THREE.Vector3;
  horizon: string;
  stormHorizon: string;
  /** 引雷的导体（高原坐标） */
  conductors: THREE.Vector3[];
  /** 雾（晴天）：近、远 */
  fog: { near: number; far: number };
  /** 高原场景在正式游戏里绕竖轴转多少（弧度）：4-1 是 π（Unity 移植时换过坐标），4-4 是 0（正式坐标就是高原坐标） */
  yaw: number;
  /** 光（同检视页）：半球光 [天色, 地色, 强度]、太阳 [颜色, 强度]、柔光影子强度 */
  rig: { hemi: [string, string, number]; sun: [string, number]; soft: number };
  /** 声床：基础风、静水拍岸倍率 */
  sound: { baseWind: number; lap: number };
  /** 挂进正式游戏的场景时 / 卸下时（这张图要绑在场景上的东西：空气透视……） */
  attach?(scene: THREE.Scene): void;
  detach?(): void;
  /** 遮挡图不拍的（草、雾带、云） */
  coverHide: THREE.Object3D[];
  buildMs: number;
}

export function buildPlateau41(): PlateauWorld {
  const t0 = performance.now();
  setWindField(null);   // 4-1 用飞廉的风场（4-2 会换成峡谷风）
  const local = new THREE.Group();
  local.name = 'plateau-4-1';
  const terrain = new Terrain();
  for (const g of terrain.buildTiles(96)) {
    const m = new THREE.Mesh(g, materials().terrain);
    m.receiveShadow = true;
    m.castShadow = true;
    local.add(m);
  }
  const world = new CollisionWorld(terrain);
  const builder = new GeoBuilder();
  const flags = new FlagSystem();
  const extra = new THREE.Group();
  const anim: Animated[] = [];
  const smokeEmitters: SmokeEmitter[] = [];
  const icons: MapIcon[] = [];
  const conductors: THREE.Vector3[] = [];
  buildLandmarks({ terrain, b: builder, flags, world, extra, anim, smoke: smokeEmitters, icons, conductors });
  local.add(builder.build('landmarks'), flags.build(), extra);
  const occupied = (x: number, z: number): boolean => world.occupied(x, z);
  local.add(buildStaticScatter(terrain, occupied).group);
  const grass = new GrassField(terrain, occupied);
  local.add(grass.group);
  local.add(buildWater(terrain));
  const smoke = new Smoke(smokeEmitters);
  local.add(smoke.points);
  local.add(buildMountains(), buildFarTerrain(terrain));
  const windMarks = buildWindMarks(terrain);
  const windStreaks = new WindStreaks(terrain);
  local.add(windMarks.group, windStreaks.lines);
  const sky = buildSky();
  return {
    id: '4-1', terrain, world, local, sky, grass, conductors, windAt,
    sunDir: SKY.sunDir, horizon: SKY.horizon, stormHorizon: SKY.stormHorizon, fog: { near: 260, far: 4600 },
    yaw: Math.PI, rig: { hemi: ['#c4dbff', '#6a8a44', 1.25], sun: ['#fff2dc', 2.9], soft: 0.62 }, sound: { baseWind: 0.34, lap: 1 },
    coverHide: [grass.group],
    update(dt, time, cam) {
      grass.update(cam);
      for (const a of anim) a.update(time, dt);
      windMarks.update(time);
      windStreaks.update(dt, cam);
      smoke.update(dt);
    },
    buildMs: performance.now() - t0,
  };
}
