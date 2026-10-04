// Read-only published asset measurements and a local-generation provenance report.
// Run after publish: node art/tools/audit_cargo_hoist.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadPublishedMesh } from './pose_geometry_audit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.resolve(repository, file));
const json = file => JSON.parse(read(file));
const hash = file => createHash('sha256').update(read(file)).digest('hex');
const id = 'SM_Env_CargoHoist', source = `art/source/props/${id}/`;
const state = json(source + 'asset.json');
const current = stage => state.stages[stage].versions.find(v => v.version === state.stages[stage].current);
const manifest = json('public/assets/manifest.json'), entry = manifest.assets[id];
const bytes = read(`public/${entry.url}`), gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
function nodeMatrix(index) {
  const n = gltf.nodes[index], matrix = new THREE.Matrix4();
  if (n.matrix) matrix.fromArray(n.matrix);
  else matrix.compose(new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]));
  const parent = gltf.nodes.findIndex(p => p.children?.includes(index));
  return parent < 0 ? matrix : nodeMatrix(parent).multiply(matrix);
}
const all = new THREE.Box3(), lods = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
for (let lod = 0; lod < entry.lodDistance.length; lod++) {
  const nodeIndex = gltf.nodes.findIndex(n => n.name === `${id}_LOD${lod}`), node = gltf.nodes[nodeIndex];
  const decoded = loadPublishedMesh(id, node.mesh), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
  geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1)); geometry.applyMatrix4(nodeMatrix(nodeIndex)); geometry.computeBoundingBox();
  const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); all.union(box);
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), reelDepthSamples = [];
  for (const fraction of [.44, .50, .56]) {
    ray.set(new THREE.Vector3(center.x, box.min.y + fraction * size.y, box.max.z + 1), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(mesh, false);
    reelDepthSamples.push({ fraction, y: ray.ray.origin.y, hitCount: hits.length, thickness: hits.length >= 2 ? hits.at(-1).distance - hits[0].distance : 0 });
  }
  lods.push({ lod, triangles: decoded.idx.length / 3, vertices: decoded.attrs.POSITION.length / 3, min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(), reelDepthSamples });
  geometry.dispose();
}
material.dispose();
const checkedLocalFiles = ['blockout', 'concept', 'highpoly', 'build', 'validate', 'review'].flatMap(stage => Object.values(current(stage).files).map(file => ({ stage, path: source + file.path, sha256: file.sha256, verified: hash(source + file.path) === file.sha256 })));
const previous = json('art/reviews/authored-scenes-detail-20261004/before-manifest.json');
const changedExistingAssets = Object.keys(previous.assets).filter(key => JSON.stringify(previous.assets[key]) !== JSON.stringify(manifest.assets[key]));
const promptFile = Object.values(current('concept').files).find(f => f.path.endsWith('_prompt.txt')).path;
const report = {
  created: new Date().toISOString(), id, sourceOnlyLocalHunyuan: true, artisticMeshCreatedProcedurally: false,
  publishedGLB: `public/${entry.url}`, manifestEntry: entry, publishedHashVerified: hash(`public/${entry.url}`) === entry.sha256,
  sourcePixelPolicy: 'Native built-in ImageGen output copied unchanged; registration v002 keys only the white background and separates four connected silhouettes, preserving source RGB and using uniform scaling. Failed equal-column v001 kept.',
  conceptSource: source + Object.values(current('concept').files).find(f => f.path.includes('_source.')).path,
  exactPrompt: source + promptFile,
  conceptSheet: source + Object.values(current('concept').files).find(f => f.path.endsWith('_sheet.png')).path,
  originalPromptRegistry: 'art/pipeline/cargo_hoist_concept_v001.json',
  workflow: source + Object.values(current('highpoly').files).find(f => f.path.endsWith('_graph.json')).path,
  hunyuan: current('highpoly'), build: current('build'), automaticQA: current('validate'), review: current('review'),
  allLodBounds: { min: all.min.toArray(), max: all.max.toArray(), size: all.getSize(new THREE.Vector3()).toArray() }, lods,
  checkedLocalFiles, changedExistingAssets,
  renderingContract: { uniformScaleOnly: true, groundDatum: 'Use actual all-LOD minimum Y and center X/Z through architectureMatrix.', purpose: 'Static set dressing beside approved routes; no collision or navigation authored in the mesh.', movingParts: false },
  limitations: ['Automatic and Codex AI asset review are not user acceptance.', 'No scene FPS inference is made from asset complexity or generation timings.'],
};
if (!report.publishedHashVerified || checkedLocalFiles.some(f => !f.verified) || changedExistingAssets.length) throw new Error('Source/published hash mismatch or unrelated manifest entry changed');
const out = path.resolve(repository, 'art/reviews/authored-scenes-detail-20261004/cargo-hoist-summary.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: out, bytes: entry.bytes, allLodBounds: report.allLodBounds, lods, provenanceFiles: checkedLocalFiles.length, changedExistingAssets }, null, 2));
