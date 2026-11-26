// 关卡材质标记的中性键名（2026-11-26 去 Unity 依赖）：public/assets/levels 的 GLB 材质 extras 写 shader / floats / colors / vectors，
// 熔岩顶点属性是 _LAVA_INFO / _LAVA_FLOW（three 读成 _lava_info / _lava_flow）。
// 旧键 unityShader / unityFloats / unityColors / unityVectors 暂时还认（第一章新件代码还在写，R2 统一后删回退），两种写法结果要一样。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const load = async (path, imports = {}) => {
  let source = (await readFile(new URL(path, import.meta.url), 'utf8')).replaceAll("'three'", `'${threeUrl}'`);
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`;
};
const atmosphereUrl = await load('../src/world/Atmosphere.ts');
const waterUrl = await load('../src/world/UnityWaterMaterial.ts', { './Atmosphere': atmosphereUrl });
const stylizedUrl = await load('../src/world/UnityStylizedLit.ts');
const materialsUrl = await load('../src/world/UnityMaterials.ts', { './UnityWaterMaterial': waterUrl, './Atmosphere': atmosphereUrl, './UnityStylizedLit': stylizedUrl });
const { applyUnityMaterial } = await import(materialsUrl);
const { materialMarks } = await import(stylizedUrl);

const environment = {
  sun: { forward: [-0.5, -0.5, 0], color: [1, 1, 1, 1], intensity: 1.2, shadows: 2, shadowStrength: 0.9 },
  ambient: { mode: 1, sky: [0.4, 0.5, 0.6, 1], equator: [0.5, 0.5, 0.5, 1], ground: [0.2, 0.2, 0.2, 1], light: [0.4, 0.5, 0.6, 1], intensity: 1 },
};

/** 同一份材质参数，新键 / 旧键各写一份 */
function pair(shader, floats = {}, colors = {}, vectors = {}) {
  const make = userData => Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true }), { name: 'M_Test', userData });
  return {
    neutral: make({ shader, floats, colors, vectors }),
    legacy: make({ unityShader: shader, unityFloats: floats, unityColors: colors, unityVectors: vectors }),
  };
}

test('materialMarks：新键优先，旧键回退，都没有时给空表', () => {
  assert.deepEqual(materialMarks({ shader: 'A', floats: { _X: 1 }, unityShader: 'B', unityFloats: { _X: 2 } }), { shader: 'A', floats: { _X: 1 }, colors: {}, vectors: {} });
  assert.deepEqual(materialMarks({ unityShader: 'B', unityColors: { _C: [1, 0, 0, 1] } }), { shader: 'B', floats: {}, colors: { _C: [1, 0, 0, 1] }, vectors: {} });
  assert.deepEqual(materialMarks({}), { shader: undefined, floats: {}, colors: {}, vectors: {} });
  assert.deepEqual(materialMarks(undefined), { shader: undefined, floats: {}, colors: {}, vectors: {} });
});

test('风格化光照：新键和旧键转出来的材质一样（着色器缓存键、风格参数）', () => {
  const { neutral, legacy } = pair('Spiritfire/StylizedLit', { _RampThreshold: 0.02, _ShadowLift: 0.2, _Metallic: 1, _Roughness: 1 }, { _ShadowTint: [0.66, 0.62, 0.82, 1], _BaseColor: [1, 1, 1, 1] });
  const a = applyUnityMaterial(neutral, environment), b = applyUnityMaterial(legacy, environment);
  assert.notEqual(a, neutral, '认出了风格化光照');
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());
  assert.deepEqual(a.defines, b.defines);
  const foliage = pair('Spiritfire/Foliage', { _WindStrength: 0.4 }, { _BaseColor: [1, 1, 1, 1] });
  assert.equal(applyUnityMaterial(foliage.neutral, environment).customProgramCacheKey(), applyUnityMaterial(foliage.legacy, environment).customProgramCacheKey());
});

test('远景板 / 熔岩 / 水面：按新键分派，参数和旧键一致', () => {
  const backdrop = pair('Spiritfire/Backdrop', { _UseVertexColor: 1 }, { _Tint: [0.5, 0.6, 0.7, 1] });
  const [ba, bb] = [applyUnityMaterial(backdrop.neutral), applyUnityMaterial(backdrop.legacy)];
  assert.ok(ba instanceof THREE.MeshBasicMaterial);
  assert.ok(ba.color.equals(bb.color));
  const lava = pair('Spiritfire/Lava', { _Emission: 1.45, _FlowSpeed: 1.2 }, { _HotColor: [1, 0.33, 0.035, 1] });
  const [la, lb] = [applyUnityMaterial(lava.neutral), applyUnityMaterial(lava.legacy)];
  assert.ok(la instanceof THREE.ShaderMaterial);
  assert.equal(la.uniforms.uEmission.value, 1.45);
  assert.equal(la.uniforms.uFlowSpeed.value, lb.uniforms.uFlowSpeed.value);
  assert.ok(la.uniforms.uHot.value.equals(lb.uniforms.uHot.value));
  const water = pair('Spiritfire/Water', { _WaveScale: 5, _Alpha: 0.72 }, { _ShallowColor: [0.24, 0.62, 0.72, 0.5] }, { _Flow: [0.5, 0.25, 2, 1] });
  const [wa, wb] = [applyUnityMaterial(water.neutral, environment), applyUnityMaterial(water.legacy, environment)];
  assert.ok(wa instanceof THREE.ShaderMaterial);
  for (const key of ['uWaveScale', 'uAlpha']) assert.equal(wa.uniforms[key].value, wb.uniforms[key].value);
  assert.ok(wa.uniforms.uFlow.value.equals(wb.uniforms.uFlow.value));
  assert.ok(wa.uniforms.uShallow.value.equals(wb.uniforms.uShallow.value));
  assert.ok(wa.uniforms.uSunColor.value.equals(wb.uniforms.uSunColor.value));
});

test('熔岩顶点属性叫 _lava_info / _lava_flow：GLB 里的 _LAVA_INFO / _LAVA_FLOW 和运行时现建的熔岩面都对得上着色器', async () => {
  const lava = applyUnityMaterial(pair('Spiritfire/Lava').neutral);
  assert.match(lava.vertexShader, /attribute vec4 _lava_info;/);
  assert.match(lava.vertexShader, /attribute vec4 _lava_flow;/);
  assert.ok(!/_unity_/.test(lava.vertexShader));
  const builder = await readFile(new URL('../src/world/mechanisms/Lava.ts', import.meta.url), 'utf8');
  assert.match(builder, /setAttribute\('_lava_info'/);
  assert.match(builder, /setAttribute\('_lava_flow'/);
  assert.ok(!/_unity_(info|flow)/.test(builder));
});
