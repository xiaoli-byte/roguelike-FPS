/**
 * 4-4 神山海子的网页原生场景（和检视页 haiziLab.ts 同一套组装，去掉检视页才有的：行走者、面板、游玩模式）。
 * 正式游戏里不转向（yaw = 0）：4-4 没有 Unity 版，正式坐标就是高原坐标，雷泽雷神（haizi/leize.ts）的场地、石柱、湖都原样用。
 */
import * as THREE from 'three';
import { Atmosphere, atmosphereForChapter } from '../../Atmosphere';
import { CloudSky, cloudSkyForChapter } from '../../CloudSky';
import { MistStreams, type MistStream } from '../../MistStreams';
import { DAWN_SUN_DIR, buildHaizi, type HaiziScene } from '../../haizi/scene';
import { DAWN, LAKE } from '../../haizi/spec';
import { HaiziTerrain } from '../../haizi/terrain';
import { SKY } from '../backdrop';
import { CollisionWorld } from '../walker';
import type { PlateauWorld } from './world41';

/** 4-4 多出来的东西（雷神适配器、文档编译要用） */
export interface Haizi44 {
  terrain: HaiziTerrain;
  world: CollisionWorld;
  arena: HaiziScene;
}

export function buildPlateau44(): PlateauWorld & { haizi: Haizi44 } {
  const t0 = performance.now();
  const local = new THREE.Group();
  local.name = 'plateau-4-4';
  const terrain = new HaiziTerrain();
  const world = new CollisionWorld(terrain);
  // 湖面反射贴图：正式游戏的画布不定，按 1080p 的一半
  const arena = buildHaizi(local as unknown as THREE.Scene, terrain, world, 960, 540);
  const { sky, lake, anim, grass } = arena;
  // 雾带（同检视页）：湖的北半边贴水面一层，冰斗脚一圈
  const ringKeys = (r: number, from: number, to: number, n: number): MistStream['keys'] => Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / (n - 1), x = Math.sin(a) * r, z = -Math.cos(a) * r;
    return { position: [x, terrain.heightAt(x, z) + 3, z] as [number, number, number], halfWidth: 9, size: 28, opacity: i === 0 || i === n - 1 ? 0 : 1 };
  });
  const lakeMist = new MistStreams([{
    opacity: 0.3, speed: 0.35, flat: true, floorY: LAKE.level, stretch: 2,
    keys: [
      { position: [-46, LAKE.level + 0.8, -14], halfWidth: 12, size: 26, halfHeight: 1.5, opacity: 0 },
      { position: [-22, LAKE.level + 0.8, -30], halfWidth: 14, size: 28, halfHeight: 1.5 },
      { position: [20, LAKE.level + 0.8, -32], halfWidth: 14, size: 28, halfHeight: 1.5 },
      { position: [46, LAKE.level + 0.8, -14], halfWidth: 12, size: 26, halfHeight: 1.5, opacity: 0 },
    ],
  }], { renderOrder: 2 });
  const footMist = new MistStreams([{ opacity: 0.16, speed: 0.5, keys: ringKeys(96, -2.1, 2.1, 11) }]);
  const clouds = new CloudSky({ ...cloudSkyForChapter(4), low: 0.08, mid: 0.22, high: 0.5, sunGlow: 0 });
  // 湖面反射贴图的透明通道是标记：云和雾不改它
  for (const m of [lakeMist.mesh, footMist.mesh, clouds.mesh]) {
    const mat = m.material as THREE.Material;
    if (mat.blending === THREE.NormalBlending) { mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; }
    mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor;
  }
  local.add(lakeMist.mesh, footMist.mesh, clouds.mesh);
  return {
    id: '4-4', terrain, world, local, sky, grass, conductors: arena.conductors,
    windAt: () => ({ dx: 1, dz: 0, strength: 0 }),
    sunDir: DAWN_SUN_DIR, horizon: DAWN.fog, stormHorizon: SKY.stormHorizon, fog: { near: 260, far: 4200 },
    yaw: 0, rig: { hemi: [DAWN.hemiSky, DAWN.hemiGround, DAWN.hemiIntensity], sun: [DAWN.sun, DAWN.sunIntensity], soft: 0.72 },
    sound: { baseWind: 0.3, lap: 1 },
    coverHide: [grass.group, lakeMist.mesh, footMist.mesh, clouds.mesh],
    attach(scene) {
      Atmosphere.bind(scene, { ...atmosphereForChapter(4), cloudShadow: DAWN.cloudShadow }, { baseY: LAKE.level });
    },
    detach() {
      Atmosphere.unbind();
    },
    update(dt, time, cam) {
      grass.update(cam);
      for (const a of anim) a.update(time, dt);
      Atmosphere.update(time);
      lake.update();
    },
    haizi: { terrain, world, arena },
    buildMs: performance.now() - t0,
  };
}
