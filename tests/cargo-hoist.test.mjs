import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadPublishedMesh } from '../art/tools/pose_geometry_audit.mjs';

const id = 'SM_Env_CargoHoist', root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root));
const json = file => JSON.parse(read(file));
const state = json(`art/source/props/${id}/asset.json`);
const entry = json('public/assets/manifest.json').assets[id];
const current = stage => state.stages[stage].versions.find(v => v.version === state.stages[stage].current);

test('cargo hoist retains local multi-view provenance, complete concept registration and approved publication', () => {
  assert.ok(entry, 'hoist must be published');
  assert.equal(entry.bind.id, 'shared.cargoHoist');
  assert.equal(entry.generator.mode, 'multiview');
  assert.equal(entry.generator.checkpoint, 'hunyuan3d-dit-v2-mv_fp16.safetensors');
  assert.equal(current('blockout').geometry_created, false);
  assert.equal(current('blockout').reference_mode, 'bounds_only');
  assert.equal(current('concept').generator, 'Codex built-in image_gen');
  assert.equal(current('concept').review.verdict, 'approved');
  assert.equal(current('review').review.verdict, 'approved');
  assert.equal(current('review').review.by, 'Codex AI visual review');
  assert.equal(current('validate').passed, true);
  assert.deepEqual(current('validate').waived, []);
  assert.equal(createHash('sha256').update(read(`public/${entry.url}`)).digest('hex'), entry.sha256);
  assert.ok(entry.bytes <= 900 * 1024);
  const source = `art/source/props/${id}/`;
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
  for (const view of Object.values(current('concept').registration)) {
    assert.ok(view.source_foreground_coverage >= .995, 'four registered figures preserve the source silhouettes');
    assert.ok(view.offset[0] > 1 && view.offset[0] + view.size[0] < 511, 'complete crank fits panel without clipping');
  }
});

test('actual Draco hoist LODs preserve a thick grounded base and central reel volume', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let referenceSize;
  for (const [lod, budget] of [5000, 1600, 500].entries()) {
    const decoded = loadPublishedMesh(id, lod);
    assert.ok(decoded.idx.length / 3 <= budget);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1)); geometry.computeBoundingBox();
    const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
    assert.ok(size.x > 2.5 && size.x < 4.5, `LOD${lod}: width ${size.x}`);
    assert.ok(size.y > 3 && size.y < 4, `LOD${lod}: height ${size.y}`);
    assert.ok(size.z > 1.8 && size.z < 3.2, `LOD${lod}: volume depth ${size.z}`);
    assert.ok(Math.abs(box.min.y) < .03, `LOD${lod}: grounded base ${box.min.y}`);
    if (!referenceSize) referenceSize = size.clone();
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(size[axis] / referenceSize[axis] - 1) < .06, `LOD${lod}: ${axis} silhouette drift`);
    const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(true);
    const center = box.getCenter(new THREE.Vector3()), ray = new THREE.Raycaster();
    // Front-to-back centre rays hit the broad reel rather than a paper-thin facade.
    for (const f of [.44, .50, .56]) {
      ray.set(new THREE.Vector3(center.x, box.min.y + size.y * f, box.max.z + 1), new THREE.Vector3(0, 0, -1));
      const hits = ray.intersectObject(mesh, false);
      assert.ok(hits.length >= 2, `LOD${lod}: reel has front and back at height ${f}`);
      assert.ok(hits.at(-1).distance - hits[0].distance > .45, `LOD${lod}: solid reel depth at height ${f}`);
    }
    geometry.dispose();
  }
  material.dispose();
});
