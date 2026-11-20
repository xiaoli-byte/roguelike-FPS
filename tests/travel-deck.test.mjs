// 现行发布契约（art/README.md，2026-10-25 起）：每个资产只有一级 LOD（SM_Env_TravelDeck_LOD0），不减面，面数只记录、不是闸门。
// 原来对 LOD1 / LOD2 的面数预算和跨 LOD 轮廓漂移的断言只对多级 LOD 有意义，已删掉；其余性质在 LOD0 上照样断言。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadPublished, singleLodViolations, toGeometry } from './published-glb.mjs';

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

test('the published single-LOD deck retains a horizontal solid deck and continuous central walkable surface', async () => {
  const asset = await loadPublished(id);
  assert.deepEqual(singleLodViolations(asset), []);
  for (const { lod, primitives, matrix } of asset.lods) {
    assert.equal(primitives.length, 1);
    const geometry = toGeometry(primitives[0]).applyMatrix4(matrix);
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
