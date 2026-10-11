/**
 * 美术资产专用的环境反射（IBL）。
 *
 * 管线产出的是 PBR 材质（金属度 / 粗糙度来自材质分区），金属部分主要靠反射环境显色；
 * 场景本身没有环境贴图（程序化模型是平直着色），给全场景加会改变所有旧材质的观感。
 * 所以只给美术资产的材质挂一张中性的 RoomEnvironment PMREM，强度适中：金属有光泽，手绘固有色不被冲淡。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** 环境反射强度（审核图里 Blender 世界光强 0.6，与之对齐） */
export const ART_ENV_INTENSITY = 0.6;

let env: THREE.Texture | null = null;

export function artEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!env) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  }
  return env;
}

/** 给美术材质挂上环境反射（材质已是实例克隆，可以直接改） */
export function applyArtEnvironment(mat: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): void {
  mat.envMap = artEnvMap(renderer);
  mat.envMapIntensity = ART_ENV_INTENSITY;
  // 各向异性过滤：GLB 贴图默认 1，斜着看（腿、地面方向的甲片、侧脸）会糊成一片；贴图共享，设一次即可
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap]) {
    if (t && t.anisotropy < aniso) {
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
  }
  mat.needsUpdate = true;
}
