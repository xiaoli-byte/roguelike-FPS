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
const stylized = await readFile(new URL('../src/world/UnityStylizedLit.ts', import.meta.url), 'utf8');
const stylizedUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(stylized.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64')}`;
const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityWaterMaterial'", `'${waterUrl}'`).replaceAll("'./Atmosphere'", `'${atmosphereUrl}'`).replaceAll("'./UnityStylizedLit'", `'${stylizedUrl}'`), { mode: 'transform' })).toString('base64')}`;
const { applyUnityMaterial } = await import(url);
const sfl = await import(stylizedUrl);

/** 跑一遍 onBeforeCompile，拿到改过的着色器（标准材质的原始源码） */
function compile(material) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms),
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

/** 导出场景里最常见的一份 StylizedLit 参数（第一章 Tripo 件） */
function stylizedSource(overrides = {}) {
  const source = new THREE.MeshStandardMaterial();
  source.name = 'M_Test';
  source.userData = {
    unityShader: 'Spiritfire/StylizedLit',
    unityFloats: {
      _Desaturate: 0, _BumpScale: 1, _Metallic: 1, _Roughness: 1, _OcclusionStrength: 1, _RampThreshold: 0.02, _RampSoftness: 0.22,
      _ShadowLift: 0.2, _AmbientStrength: 1, _SpecStrength: 0.25, _SpecSize: 0.1, _RimPower: 4, _RimStrength: 0.18, _Fur: 0,
      _FlashAmount: 0, _Cutoff: 0.5, _Cull: 0, _SrcBlend: 1, _DstBlend: 0, _ZWrite: 1, ...overrides.floats,
    },
    unityColors: {
      _BaseColor: [1, 1, 1, 1], _Tint: [1, 1, 1, 1], _EmissionColor: [0, 0, 0, 1], _ShadowTint: [0.66, 0.62, 0.82, 1], _RimColor: [1, 0.9, 0.75, 1],
      _GlowMaskColor0: [0, 0, 0, 1], _GlowMaskColor1: [0, 0, 0, 1], _GlowMaskColor2: [0, 0, 0, 1], ...overrides.colors,
    },
    unityVectors: {
      _VariantParams: [0, 0, 14, 3], _DissolveParams: [0, 0.08, 9, 0], _RegionParams: [0, 0, 0, 0], _FlameKey: [0, 1, 9, 0], ...overrides.vectors,
    },
  };
  return source;
}

const environment = {
  sun: { forward: [-0.69, -0.59, 0.43], color: [1, 0.91, 0.8, 1], intensity: 1.45, shadows: 2, shadowStrength: 0.9 },
  ambient: { mode: 1, sky: [0.44, 0.52, 0.7, 1], equator: [0.58, 0.5, 0.42, 1], ground: [0.34, 0.27, 0.21, 1], light: [0.44, 0.52, 0.7, 1], intensity: 1 },
};

test('Unity colors are linearised the way Unity uploads them (GammaToLinearSpaceExact, HDR > 1 as pow 2.2)', () => {
  assert.equal(sfl.unityGammaToLinear(0), 0);
  assert.ok(Math.abs(sfl.unityGammaToLinear(0.5) - 0.21404) < 1e-4);
  assert.equal(sfl.unityGammaToLinear(1), 1);
  assert.ok(Math.abs(sfl.unityGammaToLinear(4) - Math.pow(4, 2.2)) < 1e-9);
  const tint = sfl.unityColor([0.56, 0.5, 0.8, 1], [1, 1, 1, 1]);
  assert.ok(Math.abs(tint.r - 0.2747) < 1e-3 && Math.abs(tint.g - 0.2140) < 1e-3 && Math.abs(tint.b - 0.6038) < 1e-3);
});

test('Unity StylizedLit maps its stylized lighting parameters to uniforms', () => {
  const source = stylizedSource({ colors: { _BaseColor: [0.5, 0.5, 0.5, 1], _ShadowTint: [0.56, 0.5, 0.8, 1] } });
  const material = applyUnityMaterial(source, environment);
  assert.ok(material instanceof THREE.MeshStandardMaterial);
  assert.notEqual(material, source);
  assert.equal(applyUnityMaterial(source, environment), material, 'one converted material per source material');
  assert.ok(Math.abs(material.color.r - 0.21404) < 1e-4, '_BaseColor is linearised, not the gamma value GLTFLoader copied');
  assert.equal(material.side, THREE.DoubleSide, '_Cull 0 = Off');
  assert.equal(material.vertexColors, false);
  const u = material.userData.sflUniforms;
  assert.ok(Math.abs(u.uSflRamp.value.x - 0.02) < 1e-9);
  assert.ok(Math.abs(u.uSflRamp.value.y - 0.22) < 1e-9);
  assert.ok(Math.abs(u.uSflRamp.value.z - 0.2) < 1e-9);
  assert.equal(u.uSflRamp.value.w, 1);
  assert.deepEqual([u.uSflSpec.value.x, u.uSflSpec.value.y, u.uSflSpec.value.z, u.uSflSpec.value.w], [0.25, 0.1, 4, 0.18]);
  assert.ok(Math.abs(u.uSflShadowTint.value.b - 0.6038) < 1e-3);
  const shader = compile(material);
  assert.ok(!shader.fragmentShader.includes('#include <lights_fragment_begin>'));
  assert.ok(shader.fragmentShader.includes('sflLight('));
  assert.ok(shader.fragmentShader.includes('vec3 outgoingLight = sflColor + totalEmissiveRadiance;'));
  assert.ok(shader.fragmentShader.includes('#include <fog_fragment>'), 'fog (and the Atmosphere layer) stay');
  assert.ok(shader.vertexShader.includes('#include <skinning_vertex>'), 'skinning stays');
  assert.equal(shader.uniforms.uSflRamp, u.uSflRamp);
  assert.equal(shader.uniforms.uSflAmbient0, sfl.stylizedShared.uSflAmbient0, 'scene ambient is shared');
});

test('Unity StylizedLit opens one define per optional block and keys the program on them', () => {
  const plain = applyUnityMaterial(stylizedSource({ floats: { _RimStrength: 0, _Metallic: 0, _Roughness: 1 } }), environment);
  assert.equal(plain.defines.SFL_RIM, undefined);
  assert.equal(plain.defines.SFL_SPEC, undefined, 'roughness 1 has no stepped highlight');
  assert.equal(plain.defines.SFL_DESATURATE, undefined);
  const chapter3 = applyUnityMaterial(stylizedSource({ floats: { _Desaturate: 0.12, _Metallic: 0.35, _Roughness: 0.6 } }), environment);
  assert.equal(chapter3.defines.SFL_DESATURATE, '');
  assert.equal(chapter3.defines.SFL_RIM, '');
  assert.equal(chapter3.defines.SFL_SPEC, '');
  assert.equal(chapter3.defines.SFL_METAL_ENV, '');
  assert.equal(chapter3.defines.STANDARD, '');
  assert.notEqual(plain.customProgramCacheKey(), chapter3.customProgramCacheKey());
  assert.equal(chapter3.customProgramCacheKey(), applyUnityMaterial(stylizedSource({ floats: { _Desaturate: 0.3, _Metallic: 0.5, _Roughness: 0.4 } }), environment).customProgramCacheKey());
});

test('Unity StylizedLit without an exported ORM map falls back to average ORM on normal-mapped pieces', () => {
  const source = stylizedSource({ floats: { _OcclusionStrength: 0.7, _Roughness: 0.9 } });
  source.normalMap = new THREE.Texture();
  const material = applyUnityMaterial(source, environment);
  assert.equal(material.metalness, 0);
  assert.ok(Math.abs(material.roughness - 0.9 * sfl.ORM_FALLBACK.roughness) < 1e-9);
  assert.ok(Math.abs(material.userData.sflUniforms.uSflSurface.value.y - (1 + (sfl.ORM_FALLBACK.ao - 1) * 0.7)) < 1e-9);
  const whitebox = applyUnityMaterial(stylizedSource({ floats: { _Metallic: 0, _Roughness: 0.92 } }), environment);
  assert.equal(whitebox.roughness, 0.92);
  assert.equal(whitebox.userData.sflUniforms.uSflSurface.value.y, 1);
});

test('Unity StylizedLit emission is the linearised HDR _EmissionColor', () => {
  const material = applyUnityMaterial(stylizedSource({ colors: { _EmissionColor: [4, 1.4, 0.35, 1] } }), environment);
  assert.ok(Math.abs(material.emissive.r - Math.pow(4, 2.2)) < 1e-6);
  assert.equal(material.emissiveIntensity, 1);
});

test('Unity StylizedLit reports runtime-only blocks that are not ported yet', () => {
  assert.deepEqual(sfl.unsupportedStylizedBlocks(stylizedSource().userData), []);
  const blocks = sfl.unsupportedStylizedBlocks(stylizedSource({ vectors: { _DissolveParams: [0.4, 0.08, 9, 0], _FlameKey: [1, 1, 9, 0] }, floats: { _Fur: 1 } }).userData);
  assert.deepEqual(blocks, ['dissolve', 'flameKey', 'fur']);
});

test('Trilight ambient becomes zonal SH: equal colours give flat ambient, intensity scales', () => {
  const grey = [0.5, 0.5, 0.5, 1];
  const [c0, c1, c2] = sfl.trilightCoefficients({ mode: 1, sky: grey, equator: grey, ground: grey, light: grey, intensity: 2 });
  assert.ok(Math.abs(c0.x - 0.21404 * 2) < 1e-4);
  assert.ok(Math.abs(c1.x) < 1e-9 && Math.abs(c2.x) < 1e-9);
  sfl.setStylizedEnvironment(environment);
  const [s0, s1] = [sfl.stylizedShared.uSflAmbient0.value, sfl.stylizedShared.uSflAmbient1.value];
  assert.ok(s1.z > 0, 'blue sky above, warm ground below');
  assert.ok(s0.x > 0 && s0.y > 0 && s0.z > 0);
  assert.equal(sfl.stylizedShared.uSflAmbientMode.value, 1);
  assert.ok(Math.abs(sfl.stylizedShared.uSflShadowStrength.value - 0.9) < 1e-9);
});

test('Unity Foliage sways with vertex alpha and keeps translucency', () => {
  const source = new THREE.MeshStandardMaterial();
  source.userData = {
    unityShader: 'Spiritfire/Foliage',
    unityFloats: { _RampThreshold: -0.05, _RampSoftness: 0.32, _ShadowLift: 0.42, _AmbientStrength: 1, _RimPower: 3, _RimStrength: 0.25, _Translucency: 0.7, _WindStrength: 0.18, _WindSpeed: 1.1, _Flutter: 0.04 },
    unityColors: { _BaseColor: [1, 1, 1, 1], _ShadowTint: [0.55, 0.62, 0.88, 1], _RimColor: [1, 0.92, 0.75, 1], _TranslucencyColor: [1, 0.78, 0.38, 1] },
  };
  const material = applyUnityMaterial(source, environment);
  assert.ok(material instanceof THREE.MeshStandardMaterial);
  assert.equal(material.vertexColors, true);
  assert.equal(material.defines.SFL_FOLIAGE, '');
  const u = material.userData.sflUniforms;
  assert.deepEqual([u.uSflWind.value.x, u.uSflWind.value.y, u.uSflWind.value.z], [0.18, 1.1, 0.04]);
  assert.ok(Math.abs(u.uSflTranslucency.value.r - 0.7) < 1e-9);
  const shader = compile(material);
  assert.ok(shader.vertexShader.includes('sflFoliageWind('));
  assert.ok(!shader.vertexShader.includes('#include <project_vertex>'));
  assert.equal(shader.uniforms.uSflTime, sfl.stylizedShared.uSflTime);
});

test('Unity StylizedTerrain: per-map parameters from M_Terrain_*.mat and the steep-triplanar block', () => {
  assert.equal(sfl.terrainStyle('1-1').steepTriplanar, false);
  assert.equal(sfl.terrainStyle('2-1').rockScale, 16);
  assert.deepEqual(sfl.terrainStyle('3-2').shadowTint, [0.52, 0.48, 0.8, 1]);
  assert.equal(sfl.terrainStyle('3-9').rockScale, 18, 'unknown maps fall back to their chapter');
  const v = sfl.terrainFbm(0.25, 0.75, 2, 5, 5);
  assert.ok(v > 0 && v < 1);
  assert.equal(sfl.terrainFbm(0, 0.5, 2, 5, 5), sfl.terrainFbm(1, 0.5, 2, 5, 5), 'macro noise tiles seamlessly');
  const texture = () => new THREE.Texture();
  const flat = new THREE.MeshStandardMaterial({ map: texture() });
  sfl.stylizeTerrain(flat, { control: texture(), layers: [texture(), texture(), texture(), texture()], tiles: [9, 4, 7, 8] }, sfl.terrainStyle('1-1'), environment);
  assert.equal(flat.defines.SFL_TERRAIN, '');
  assert.equal(flat.defines.SFL_STEEP_TRIPLANAR, undefined);
  const flatShader = compile(flat);
  assert.ok(!flatShader.fragmentShader.includes('#include <map_fragment>'));
  assert.ok(flatShader.vertexShader.includes('vSflPos'));
  assert.deepEqual(flat.userData.sflUniforms.uSflLayerTile.value.toArray(), [9, 4, 7, 8]);
  const frost = new THREE.MeshStandardMaterial({ map: texture() });
  sfl.stylizeTerrain(frost, { control: texture(), layers: [texture(), texture(), texture(), texture()], tiles: [10, 6, 12, 16] }, sfl.terrainStyle('2-1'), environment);
  assert.equal(frost.defines.SFL_STEEP_TRIPLANAR, '');
  assert.ok(frost.userData.sflUniforms.uSflWarp.value instanceof THREE.DataTexture);
  assert.notEqual(flat.customProgramCacheKey(), frost.customProgramCacheKey());
});

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
