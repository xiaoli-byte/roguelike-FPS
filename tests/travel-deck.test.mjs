import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadPublishedMesh } from '../art/tools/pose_geometry_audit.mjs';

const id = 'SM_Env_TravelDeck';
const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root));
const json = file => JSON.parse(read(file));
const state = json(`art/source/props/${id}/asset.json`);
const entry = json('public/assets/manifest.json').assets[id];
const current = stage => state.stages[stage].versions.find(v => v.version === state.stages[stage].current);

test('travel deck is a published local Hunyuan asset with approved native concept and no generated blockout mesh', () => {
  assert.ok(entry, 'deck must be published before this regression passes');
  assert.equal(entry.bind.id, 'shared.travelDeck');
  assert.equal(entry.generator.mode, 'multiview');
  assert.equal(entry.generator.checkpoint, 'hunyuan3d-dit-v2-mv_fp16.safetensors');
  assert.equal(current('blockout').geometry_created, false);
  assert.equal(current('blockout').reference_mode, 'bounds_only');
  assert.equal(current('concept').generator, 'Codex built-in image_gen');
  assert.equal(current('concept').review.by, 'Codex AI visual review');
  assert.equal(current('review').review.by, 'Codex AI visual review');
  assert.equal(current('review').review.verdict, 'approved');
  assert.equal(current('validate').passed, true);
  assert.deepEqual(current('validate').waived, []);
  assert.equal(createHash('sha256').update(read(`public/${entry.url}`)).digest('hex'), entry.sha256);
  assert.ok(entry.bytes <= 900 * 1024);
  const source = `art/source/props/${id}/`;
  for (const file of Object.values(current('blockout').files)) {
    assert.equal(createHash('sha256').update(read(source + file.path)).digest('hex'), file.sha256);
  }
  const conceptFiles = Object.values(current('concept').files);
  assert.ok(conceptFiles.some(file => file.path.endsWith('_prompt.txt')));
  assert.ok(conceptFiles.some(file => file.path.endsWith('_source.png')));
  for (const file of conceptFiles) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const highpolyFiles = Object.values(current('highpoly').files);
  const graph = highpolyFiles.find(file => file.path.endsWith('_graph.json'));
  assert.ok(graph, 'exact submitted local workflow is kept in the repository');
  assert.equal(createHash('sha256').update(read(source + graph.path)).digest('hex'), graph.sha256);
  if (process.env.ART_LOCAL_SOURCE_AUDIT === '1') {
    for (const file of [...conceptFiles, ...highpolyFiles]) {
      assert.equal(createHash('sha256').update(read(source + file.path)).digest('hex'), file.sha256);
    }
  }
});

test('actual Draco LODs retain a horizontal solid deck and continuous central walkable surface', () => {
  for (const [lod, budget] of [5000, 1600, 500].entries()) {
    const decoded = loadPublishedMesh(id, lod);
    assert.ok(decoded.idx.length / 3 <= budget);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
    assert.ok(size.x > 5 && size.x < 6.8, `LOD${lod}: width ${size.x}`);
    assert.ok(size.z > 3.5 && size.z < 4.5, `LOD${lod}: length ${size.z}`);
    assert.ok(size.y > 0.5 && size.y < 0.85, `LOD${lod}: solid thickness ${size.y}`);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), center = box.getCenter(new THREE.Vector3());
    const heights = [];
    for (let iz = -4; iz <= 4; iz++) for (let ix = -4; ix <= 4; ix++) {
      ray.set(new THREE.Vector3(center.x + ix * size.x * 0.10, box.max.y + 1,
        center.z + iz * size.z * 0.10), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit, `LOD${lod}: no hole at central sample ${ix},${iz}`);
      heights.push(hit.point.y);
    }
    assert.ok(Math.max(...heights) - Math.min(...heights) < 0.02,
      `LOD${lod}: top must remain almost flat; measured ${Math.max(...heights) - Math.min(...heights)}m`);
    geometry.dispose(); material.dispose();
  }
});
