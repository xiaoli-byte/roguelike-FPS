import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const source = await readFile(new URL('../src/world/UnityTerrainMesh.ts', import.meta.url), 'utf8');
const library = `import * as THREE from '${threeUrl}'; export function unityHeights(field){const b=Uint8Array.from(atob(field.heights),c=>c.charCodeAt(0));return new Float32Array(b.buffer)}`;
const replaced = source.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityLevelLibrary'", `'data:text/javascript;base64,${Buffer.from(library).toString('base64')}'`);
const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(replaced, { mode: 'transform' })).toString('base64')}`;
const { createUnityTerrainMesh } = await import(url);

test('Unity heightfield builds an upward terrain with matching world heights', () => {
  const field = {
    origin: [10, 2, 20], scale: [2, 4, 3], resolution: 2,
    heights: Buffer.from(new Float32Array([0, 0.25, 0.5, 1]).buffer).toString('base64'),
  };
  const mesh = createUnityTerrainMesh(field, new THREE.Group());
  assert.equal(mesh.geometry.attributes.position.count, 4);
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), [10, 2, 20, 12, 3, 20, 10, 4, 23, 12, 6, 23]);
  for (let i = 0; i < mesh.geometry.attributes.normal.array.length; i += 3) assert.ok(mesh.geometry.attributes.normal.array[i + 1] > 0);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [0, 2, 1, 1, 2, 3]);
});
