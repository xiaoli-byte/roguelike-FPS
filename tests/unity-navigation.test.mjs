import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const source = await readFile(new URL('../src/world/UnityNavMesh.ts', import.meta.url), 'utf8');
const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64')}`;
const { UnityNavMesh } = await import(url);
const context = { rng: { next: () => 0.5 } };

function mesh(vertices, indices) {
  return new UnityNavMesh(context, { navigation: { vertices, indices, areas: indices.map(() => 0) } });
}

test('UnityNavMesh follows shared triangle edges and returns a direct funnel path', () => {
  const navigation = mesh([[0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1], [1, 0, 0]], [0, 4, 3, 4, 2, 3, 4, 1, 2]);
  const path = [];
  assert.equal(navigation.findPath(new THREE.Vector3(0.25, 0, 0.25), new THREE.Vector3(1.75, 0, 0.75), path), true);
  assert.ok(path.length <= 2);
  assert.ok(path.at(-1).distanceTo(new THREE.Vector3(1.75, 0, 0.75)) < 1e-6);
});

test('UnityNavMesh welds coincident Unity vertices before finding shared edges', () => {
  const navigation = mesh([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, 1, 2, 3, 4, 5]);
  const path = [];
  assert.equal(navigation.findPath(new THREE.Vector3(0.2, 0, 0.2), new THREE.Vector3(0.8, 0, 0.8), path), true);
  assert.ok(path.length > 0);
});

test('UnityNavMesh preserves baked surface height and projects off-mesh targets', () => {
  const navigation = mesh([[0, 0, 0], [1, 1, 0], [1, 1, 1], [0, 0, 1]], [0, 1, 2, 0, 2, 3]);
  const nearest = new THREE.Vector3();
  assert.equal(navigation.nearestWalkable(new THREE.Vector3(0.5, 4, 0.5), nearest), true);
  assert.ok(Math.abs(nearest.y - 0.5) < 1e-6);
  const path = [];
  assert.equal(navigation.findPath(new THREE.Vector3(0.25, 0.25, 0.25), new THREE.Vector3(4, 0, 4), path), true);
  assert.ok(path.at(-1).x <= 1 && path.at(-1).z <= 1);
});

test('UnityNavMesh reports disconnected paths without directing agents through empty space', () => {
  const navigation = mesh([[0, 0, 0], [1, 0, 0], [0, 0, 1], [3, 0, 0], [4, 0, 0], [3, 0, 1]], [0, 1, 2, 3, 4, 5]);
  const path = [];
  assert.equal(navigation.findPath(new THREE.Vector3(0.2, 0, 0.2), new THREE.Vector3(3.2, 0, 0.2), path), false);
  assert.ok(path.at(-1).x <= 1);
});

const manifest = JSON.parse(await readFile(new URL('../public/assets/unity-levels/manifest.json', import.meta.url), 'utf8'));
for (const stage of manifest.stages.filter(stage => stage.available)) {
  test(`${stage.id}: player spawn and main encounter use the baked Unity NavMesh`, async () => {
    const document = JSON.parse(await readFile(new URL(`../public/${stage.url}`, import.meta.url), 'utf8'));
    const navigation = new UnityNavMesh(context, document);
    const spawn = new THREE.Vector3().fromArray(document.spawn.position);
    const projected = new THREE.Vector3();
    assert.equal(navigation.nearestWalkable(spawn, projected), true);
    assert.ok(projected.distanceTo(spawn) < 5, `spawn is ${projected.distanceTo(spawn).toFixed(2)}m from NavMesh`);
    const target = document.encounters.find(encounter => !encounter.optional)?.position;
    if (target) {
      const path = [];
      assert.equal(navigation.findPath(projected, new THREE.Vector3().fromArray(target), path), true);
      assert.ok(path.length > 0);
      let previous = projected;
      for (const point of path) {
        const steps = Math.max(1, Math.ceil(previous.distanceTo(point) / 2));
        for (let i = 1; i <= steps; i++) {
          const sample = previous.clone().lerp(point, i / steps);
          assert.equal(navigation.isWalkable(sample.x, sample.z), true, `${stage.id}: funnel segment leaves NavMesh`);
        }
        previous = point;
      }
    }
  });
}
