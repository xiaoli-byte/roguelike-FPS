import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const source = await readFile(new URL('../src/world/UnityMaterials.ts', import.meta.url), 'utf8');
const water = await readFile(new URL('../src/world/UnityWaterMaterial.ts', import.meta.url), 'utf8');
const atmosphere = await readFile(new URL('../src/world/Atmosphere.ts', import.meta.url), 'utf8');
const atmosphereUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(atmosphere.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64')}`;
const waterUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(water.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./Atmosphere'", `'${atmosphereUrl}'`), { mode: 'transform' })).toString('base64')}`;
const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityWaterMaterial'", `'${waterUrl}'`).replaceAll("'./Atmosphere'", `'${atmosphereUrl}'`), { mode: 'transform' })).toString('base64')}`;
const { applyUnityMaterial } = await import(url);

test('Unity Backdrop uses unlit vertex color without scene fog', () => {
  const source = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
  source.userData = { unityShader: 'Spiritfire/Backdrop', unityFloats: { _UseVertexColor: 1 }, unityColors: { _Tint: [1, 1, 1, 1] } };
  const material = applyUnityMaterial(source);
  assert.ok(material instanceof THREE.MeshBasicMaterial);
  assert.equal(material.vertexColors, true);
  assert.equal(material.fog, false);
  assert.equal(material.side, THREE.DoubleSide);
});

test('Unity Lava keeps authored flow and emission values', () => {
  const source = new THREE.MeshStandardMaterial();
  source.userData = { unityShader: 'Spiritfire/Lava', unityFloats: { _Emission: 1.45, _FlowSpeed: 1.2 }, unityColors: { _HotColor: [1, 0.33, 0.035, 1] } };
  const material = applyUnityMaterial(source);
  assert.ok(material instanceof THREE.ShaderMaterial);
  assert.equal(material.uniforms.uEmission.value, 1.45);
  assert.equal(material.uniforms.uFlowSpeed.value, 1.2);
});

test('Unity water keeps native waves, flow, depth and transparency', () => {
  const source = new THREE.MeshStandardMaterial();
  source.userData = {
    unityShader: 'Spiritfire/Water',
    unityFloats: { _WaveScale: 5, _Alpha: 0.72 },
    unityColors: { _ShallowColor: [0.24, 0.62, 0.72, 0.5], _DeepColor: [0.05, 0.22, 0.4, 0.88] },
    unityVectors: { _Flow: [0.5, 0.25, 2, 1] },
  };
  const environment = {
    sun: { forward: [-0.5, -0.5, 0], color: [1, 1, 1, 1], intensity: 1.2, shadows: 2, shadowStrength: 0.9 },
    ambient: { mode: 1, sky: [0.4, 0.5, 0.6, 1], equator: [0.5, 0.5, 0.5, 1], ground: [0.2, 0.2, 0.2, 1], light: [0.4, 0.5, 0.6, 1], intensity: 1 },
  };
  const material = applyUnityMaterial(source, environment);
  assert.ok(material instanceof THREE.ShaderMaterial);
  assert.equal(material.userData.unityWater, true);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.uniforms.uWaveScale.value, 5);
  assert.equal(material.uniforms.uFlow.value.x, -0.5);
  assert.equal(material.uniforms.uFlow.value.y, 0.25);
  assert.equal(material.uniforms.uFlow.value.z, 2);
  assert.ok(material.fragmentShader.includes('uViewport'));
});
