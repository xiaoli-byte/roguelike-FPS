import * as THREE from 'three';
import { UnityLevelLibrary, type UnitySceneDocument, type UnityTerrain } from './UnityLevelLibrary';
import { stylizeTerrain, terrainStyle } from './UnityStylizedLit';

/**
 * Unity 地形材质 Spiritfire/StylizedTerrain（SF_StylizedTerrain.shader）：四层按高度混合、宏观色斑、坡度压暗、
 * 冰原 / 火狱 / 高原的陡坡三平面 + 崖面去重复，光照同 StylizedLit。着色器在 UnityStylizedLit.ts。
 * 分层图只取第一张（Unity 着色器也只认 _ControlMap + 四层）。贴图读完才改材质，返回的 Promise 等它。
 */
export async function applyUnityTerrain(material: THREE.MeshStandardMaterial, terrain: UnityTerrain, document?: Pick<UnitySceneDocument, 'id' | 'environment'>): Promise<void> {
  if (!material.map || terrain.layers.length === 0 || terrain.alphamaps.length === 0) return;
  try {
    const [control, ...layers] = await Promise.all([
      UnityLevelLibrary.loadTexture(terrain.alphamaps[0], false),
      ...terrain.layers.slice(0, 4).map(layer => UnityLevelLibrary.loadTexture(layer.url, true)),
    ]);
    // 分层图是权重数据：线性、夹边、不要各向异性外的滤波花样
    control.wrapS = control.wrapT = THREE.ClampToEdgeWrapping;
    control.colorSpace = THREE.NoColorSpace;
    control.needsUpdate = true;
    // Unity 的地表层贴图 anisoLevel 8（TerrainTextureGen.Write）；Three 会按显卡上限截
    for (const layer of layers) {
      if (layer.anisotropy >= 8) continue;
      layer.anisotropy = 8;
      layer.needsUpdate = true;
    }
    stylizeTerrain(material, { control, layers, tiles: terrain.layers.slice(0, 4).map(layer => layer.tileSize[0]) }, terrainStyle(document?.id), document?.environment);
  } catch (error) {
    console.error('[UnityTerrain] texture load failed', error);
  }
}
