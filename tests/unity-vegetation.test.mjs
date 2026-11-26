// 植被按格子分块实例化（src/world/UnityVegetation.ts）：实例一棵不丢、矩阵不变、每块的包围球只盖自己那一格，
// 视锥 / 阴影相机才剔得掉画面外的块（整张图一个 InstancedMesh 时 4-3 每帧画 7283 万面）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const library = dataUrl(`import * as THREE from '${threeUrl}';
export const UnityLevelLibrary = { load: async (url) => globalThis.__vegetationGltf(url) };
export const unityPoint = (p) => new THREE.Vector3(p[0], p[1], p[2]);
export const unityQuaternion = (q) => new THREE.Quaternion(q[0], q[1], q[2], q[3]);`);
const materials = dataUrl('export const applyUnityMaterial = (m) => m;');
const source = (await readFile(new URL('../src/world/UnityVegetation.ts', import.meta.url), 'utf8'))
  .replaceAll("'three'", `'${threeUrl}'`)
  .replaceAll("'./UnityLevelLibrary'", `'${library}'`)
  .replaceAll("'./UnityMaterials'", `'${materials}'`);
const { createUnityVegetation, vegetationCells, VEGETATION_CELL } = await import(dataUrl(stripTypeScriptTypes(source, { mode: 'transform' })));

globalThis.__vegetationGltf = () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1).translate(0, 2, 0), new THREE.MeshStandardMaterial()));
  return { scene };
};

function forest() {
  const instances = [];
  for (let i = 0; i < 600; i++) {
    const x = (i * 37.3) % 900 - 450, z = (i * 91.7) % 700 - 350;
    instances.push({ prototype: i % 3, position: [x, i % 7, z], rotation: [0, Math.sin(i), 0, Math.cos(i)], scale: [1, 1 + (i % 5) * 0.1, 1] });
  }
  return { prototypes: [0, 1, 2].map((index) => ({ index, name: `TR_Test${index}`, url: `t${index}.glb` })), instances };
}

test('cells keep every instance in export order and stay inside their square', () => {
  const { instances } = forest();
  const cells = vegetationCells(instances);
  assert.equal([...cells.values()].reduce((n, list) => n + list.length, 0), instances.length);
  for (const [key, list] of cells) {
    const [cx, cz] = key.split(',').map(Number);
    for (const t of list) {
      assert.ok(t.position[0] >= cx * VEGETATION_CELL && t.position[0] < (cx + 1) * VEGETATION_CELL);
      assert.ok(t.position[2] >= cz * VEGETATION_CELL && t.position[2] < (cz + 1) * VEGETATION_CELL);
    }
    assert.deepEqual(list, instances.filter((t) => list.includes(t)), '格子里保持导出顺序');
  }
});

test('chunked instanced meshes reproduce every tree transform and get per-cell bounds', async () => {
  const document = { vegetation: forest(), environment: {} };
  const group = await createUnityVegetation(document, true);
  const meshes = group.children;
  assert.ok(meshes.length > 3, '按格子拆成多块，不是每个原型一块');
  const key = (prototype, p) => `${prototype}|${p.map((v) => +v.toFixed(4)).join(',')}`;
  const want = new Set(document.vegetation.instances.map((t) => key(t.prototype, t.position)));
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  let total = 0;
  for (const mesh of meshes) {
    assert.ok(mesh.isInstancedMesh);
    assert.equal(mesh.castShadow, true);
    const prototype = Number(/TR_Test(\d)/.exec(mesh.name)[1]);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      const tree = key(prototype, [position.x, position.y, position.z]);
      assert.ok(want.delete(tree), `多出或重复的树 ${tree}`);
      total++;
    }
    // 包围球只盖这一格（格子对角线一半 + 树高），不是整张图
    assert.ok(mesh.boundingSphere.radius < VEGETATION_CELL * Math.SQRT1_2 + 10, `${mesh.name} 包围球 ${mesh.boundingSphere.radius}`);
  }
  assert.equal(total, document.vegetation.instances.length);
  assert.equal(want.size, 0);
});

test('low quality keeps chunks but turns off shadow casting', async () => {
  const group = await createUnityVegetation({ vegetation: forest(), environment: {} }, false);
  assert.ok(group.children.every((m) => m.castShadow === false && m.receiveShadow === true));
});
