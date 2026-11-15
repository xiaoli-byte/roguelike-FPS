import * as THREE from 'three';
import { UnityLevelLibrary, type UnityTerrain } from './UnityLevelLibrary';

export function applyUnityTerrain(material: THREE.MeshStandardMaterial, terrain: UnityTerrain): void {
  void Promise.all([
    ...terrain.layers.map(layer => UnityLevelLibrary.loadTexture(layer.url, true)),
    ...terrain.alphamaps.map(url => UnityLevelLibrary.loadTexture(url, false)),
  ]).then(textures => {
    const layers = textures.slice(0, terrain.layers.length);
    const splats = textures.slice(terrain.layers.length);
    material.onBeforeCompile = shader => {
      let declarations = '';
      let blend = 'vec4 terrainColor = vec4(0.0);\nfloat terrainWeightSum = 0.0;\n';
      for (let i = 0; i < layers.length; i++) {
        const splat = Math.floor(i / 4), channel = i % 4;
        const layer = terrain.layers[i];
        shader.uniforms[`uUnityLayer${i}`] = { value: layers[i] };
        shader.uniforms[`uUnityScale${i}`] = { value: new THREE.Vector2(terrain.size[0] / layer.tileSize[0], terrain.size[2] / layer.tileSize[1]) };
        shader.uniforms[`uUnityOffset${i}`] = { value: new THREE.Vector2(layer.tileOffset[0] / layer.tileSize[0], layer.tileOffset[1] / layer.tileSize[1]) };
        declarations += `uniform sampler2D uUnityLayer${i};\nuniform vec2 uUnityScale${i};\nuniform vec2 uUnityOffset${i};\n`;
        blend += `float terrainWeight${i} = texture2D(uUnitySplat${splat}, vMapUv).${'rgba'[channel]};\n`;
        blend += `terrainWeightSum += terrainWeight${i};\n`;
        blend += `terrainColor += texture2D(uUnityLayer${i}, vMapUv * uUnityScale${i} + uUnityOffset${i}) * terrainWeight${i};\n`;
      }
      for (let i = 0; i < splats.length; i++) {
        shader.uniforms[`uUnitySplat${i}`] = { value: splats[i] };
        declarations += `uniform sampler2D uUnitySplat${i};\n`;
      }
      blend += 'diffuseColor *= terrainColor / max(terrainWeightSum, 0.0001);\n';
      shader.fragmentShader = declarations + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', blend);
    };
    material.customProgramCacheKey = () => `unity-terrain-${terrain.layers.length}-${terrain.alphamaps.length}`;
    material.needsUpdate = true;
  }).catch(error => console.error('[UnityTerrain] texture load failed', error));
}
