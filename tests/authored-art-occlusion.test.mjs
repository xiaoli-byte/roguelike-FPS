import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [name, value] of Object.entries(imports)) source = source.replaceAll(`'${name}'`, `'${value}'`);
  return moduleUrl(source.replaceAll("'three'", `'${threeUrl}'`));
}
const libraryUrl = moduleUrl(`export const AssetLibrary = {
  get: id => globalThis.__occlusionAssets?.get(id) ?? null,
  preload: () => globalThis.__occlusionPreload ?? Promise.resolve()
};`);
const architectureUrl = await tsModule('../src/world/SceneArchitecture.ts', {
  '../assets/AssetLibrary': libraryUrl,
  '../assets/ArtEnvironment': moduleUrl('export function applyArtEnvironment() {}'),
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
});
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { AuthoredArtOcclusion } = await import(await tsModule('../src/world/AuthoredArtOcclusion.ts', {
  '../assets/AssetLibrary': libraryUrl, './SceneArchitecture': architectureUrl,
}));
const { generateWhitebox } = await import(await tsModule('../src/world/WhiteboxGen.ts', {
  './WhiteboxPlans': await tsModule('../src/world/WhiteboxPlans.ts'),
}));
const { buildAuthoredSceneLayout } = await import(await tsModule('../src/world/AuthoredSceneLayout.ts'));
const bounds = { minX: 0, minY: 0, minZ: -2, maxX: 6, maxY: 8, maxZ: 2 };
const v = (x, y = 4, z = 0) => new THREE.Vector3(x, y, z);
function emptyWindow(region = bounds) { return { bounds: region, replaceTag: 'whitebox-wall', ready: true, raycast: () => false }; }
function world() {
  const result = new CollisionWorld();
  result.addBox(-30, -4, -30, 30, 0, 30, 'floor');
  result.addBox(0, 0, -10, 20, 8, 10, 'whitebox-wall');
  return result;
}
function boxSnapshot(value) { return value.boxes.map(({ _stamp, ...box }) => box); }

test('ray windows subtract intervals of merged boxes without changing movement, floor, navigation or outside rays', () => {
  const w = world(), original = boxSnapshot(w), version = w.version;
  const unregister = w.addRayWindow(emptyWindow());
  assert.equal(w.version, version); assert.equal(w.activeRayWindowCount, 1);
  let hit = w.raycast(v(-3), v(1, 0), 30);
  assert.equal(hit.distance, 9); assert.deepEqual(hit.normal.toArray(), [-1, 0, 0]);
  assert.equal(hit.box, w.boxes[1], 'the remainder of the same merged wall stays solid');
  assert.equal(w.raycast(v(-3), v(1, 0), 8), null, 'short projectile segment can continue inside the alcove');
  hit = w.raycast(v(3), v(1, 0), 20); assert.equal(hit.distance, 3);
  assert.equal(w.raycast(v(3), v(-1, 0), 10), null, 'a projectile already in the window may leave through its open front');
  for (const z of [-2.01, 2.01, 8]) assert.equal(w.raycast(v(-3, 4, z), v(1, 0), 30).distance, 3);
  const floor = w.raycast(v(3, 1), v(0, -1), 2); assert.equal(floor.box.tag, 'floor'); assert.equal(floor.point.y, 0);
  const body = v(-1, .001); w.moveBody(body, .4, 1.8, v(3, 0), true);
  assert.ok(body.x < -.4, 'the original 8m movement wall must remain');
  assert.deepEqual(boxSnapshot(w), original);
  unregister(); assert.equal(w.activeRayWindowCount, 0); assert.equal(w.raycast(v(-3), v(1, 0), 30).distance, 3);
});

test('window unions, side exits, bounded heights, other box tags and stage cleanup are exact', () => {
  const w = world();
  const stale = w.addRayWindow(emptyWindow({ ...bounds, minX: 4, maxX: 9, minY: 2, maxY: 6 }));
  w.addRayWindow(emptyWindow({ ...bounds, minY: 2, maxY: 6 }));
  assert.equal(w.raycast(v(-3), v(1, 0), 30).distance, 12);
  assert.equal(w.raycast(v(-3, 1), v(1, 0), 30).distance, 3);
  assert.equal(w.raycast(v(-3, 7), v(1, 0), 30).distance, 3);
  const direction = v(1, 0, 1).normalize(), hit = w.raycast(v(1), direction, 20);
  assert.ok(Math.abs(hit.point.z - 2) < 1e-8); assert.deepEqual(hit.normal.toArray(), [0, 0, -1]);
  const cover = w.addBox(2, 0, -1, 3, 3, 1, 'whitebox-cover');
  assert.equal(w.raycast(v(-3, 2.5), v(1, 0), 30).box, cover);
  w.clear(); assert.equal(w.activeRayWindowCount, 0);
  w.addRayWindow(emptyWindow()); stale(); assert.equal(w.activeRayWindowCount, 1, 'old view cleanup must not remove a new stage window');
});

test('local ray interval subtraction agrees with independently split solid boxes across oblique and inside-origin rays', () => {
  const masked = new CollisionWorld(), split = new CollisionWorld();
  masked.addBox(0, 0, -10, 20, 8, 10, 'whitebox-wall');
  masked.addRayWindow(emptyWindow({ ...bounds, minY: 2, maxY: 6 }));
  // Five residual solids of this edge-touching window, without any ray overlay.
  for (const b of [[6, 0, -10, 20, 8, 10], [0, 0, -10, 6, 2, 10], [0, 6, -10, 6, 8, 10],
    [0, 2, -10, 6, 6, -2], [0, 2, 2, 6, 6, 10]]) split.addBox(...b, 'whitebox-wall');
  let seed = 9359;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let i = 0; i < 2500; i++) {
    const origin = v(rand() * 32 - 8, rand() * 12 - 2, rand() * 26 - 13);
    const direction = v(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const expected = split.raycast(origin, direction, 40), actual = masked.raycast(origin, direction, 40);
    assert.equal(!!actual, !!expected, `ray ${i} changed hit/miss outside the exact subtraction`);
    if (actual) assert.ok(Math.abs(actual.distance - expected.distance) < 1e-7, `ray ${i} skipped a merged-box remainder`);
  }
});

function fixtureAsset(id = 'test-boat') {
  const material = new THREE.MeshStandardMaterial();
  const lods = [0, 1, 2].map(() => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material); mesh.position.y = 1; mesh.updateMatrixWorld(true); return mesh; });
  return { id, entry: { bounds: { min: [-1, 0, -1], max: [1, 2, 1] } }, lods, material };
}
function placement(id, x = 4) { return { assetId: id, type: 'wall', court: 'arrival', x, y: 0, z: 0, yaw: .24, s: 1, envelope: { width: 2, height: 2, depth: 2 } }; }
function destroyAsset(asset) { asset.lods.forEach(mesh => mesh.geometry.dispose()); asset.material.dispose(); }

test('local LOD1 triangles supply actual hit positions and opposing normals while unrelated scene instances are never candidates', () => {
  const w = world(), asset = fixtureAsset(); globalThis.__occlusionAssets = new Map([[asset.id, asset]]);
  const placements = [placement(asset.id), ...Array.from({ length: 412 }, (_, i) => placement(asset.id, 100 + i))];
  const spec = { id: 'boat-slot', bounds, placementIndices: [0] }, helper = new AuthoredArtOcclusion(w, placements, [spec]);
  try {
    assert.equal(w.activeRayWindowCount, 1); assert.equal(helper.stats.candidates, 1);
    const origin = v(-3, 1), direction = v(1, 0), hit = w.raycast(origin, direction, 30);
    assert.equal(hit.box.tag, 'authored-art:test-boat'); assert.ok(hit.point.x > 2.8 && hit.point.x < 3.2);
    assert.ok(hit.normal.dot(direction) < -.9); assert.ok(Math.abs(hit.normal.length() - 1) < 1e-8);
    assert.equal(w.raycast(v(-3, 4), direction, 30).point.x, 6, 'open air above a low object continues to the residual rear wall');
    assert.ok(helper.stats.lastTriangleTests <= 16);
  } finally { helper.dispose(); delete globalThis.__occlusionAssets; destroyAsset(asset); }
});

test('missing art fails closed, loading activates atomically, and disposal or world clear cannot revive a ray window', async () => {
  const w = world(), asset = fixtureAsset(); let release;
  globalThis.__occlusionAssets = new Map(); globalThis.__occlusionPreload = new Promise(resolve => { release = resolve; });
  let ready = 0, borrowedDisposed = 0;
  asset.lods.forEach(source => source.geometry.addEventListener('dispose', () => borrowedDisposed++));
  const spec = { id: 'loading-slot', bounds, placementIndices: [0] };
  const first = new AuthoredArtOcclusion(w, [placement(asset.id)], [spec], () => ready++);
  const live = new AuthoredArtOcclusion(w, [placement(asset.id)], [spec], () => ready++);
  assert.equal(w.activeRayWindowCount, 0); assert.equal(w.raycast(v(-3, 1), v(1, 0), 30).point.x, 0);
  first.dispose(); globalThis.__occlusionAssets.set(asset.id, asset); release(); await Promise.resolve();
  assert.equal(w.activeRayWindowCount, 1); assert.equal(ready, 1, 'only the still-live view activates when loading completes');
  assert.equal(w.raycast(v(-3, 1), v(1, 0), 30).box.tag, 'authored-art:test-boat');
  live.dispose(); assert.equal(w.activeRayWindowCount, 0);
  const next = new AuthoredArtOcclusion(w, [placement(asset.id)], [spec], () => ready++);
  assert.equal(w.activeRayWindowCount, 1); assert.equal(ready, 2);
  w.clear(); assert.equal(w.activeRayWindowCount, 0); next.dispose(); assert.equal(borrowedDisposed, 0);
  delete globalThis.__occlusionAssets; delete globalThis.__occlusionPreload; destroyAsset(asset);
});

async function publishedAsset(id) {
  const { loadPublishedMesh } = await import('../art/tools/pose_geometry_audit.mjs');
  const first = loadPublishedMesh(id, 0);
  const bytes = await readFile(new URL(`../public/${first.entry.url}`, import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  function nodeMatrix(index) {
    const node = gltf.nodes[index], matrix = new THREE.Matrix4();
    if (node.matrix) matrix.fromArray(node.matrix);
    else matrix.compose(new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = gltf.nodes.findIndex(n => n.children?.includes(index));
    return parent < 0 ? matrix : nodeMatrix(parent).multiply(matrix);
  }
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const nodes = gltf.nodes.map((node, index) => ({ ...node, index })).filter(node => /_LOD\d+$/.test(node.name)).sort((a, b) => a.name.localeCompare(b.name));
  const lods = nodes.map(node => {
    const data = loadPublishedMesh(id, node.mesh);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(data.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.idx, 1));
    const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(nodeMatrix(node.index)); mesh.updateMatrixWorld(true); return mesh;
  });
  return { id, entry: first.entry, lods, material };
}

test('the actual skiff alcove matches published LOD1 hits, blocks its visible rear and sides, and stays within a measured ray budget', async t => {
  const layout = generateWhitebox({ theme: 'frost', index: 2, type: 'combat', chapter: 1, reward: 'coins' });
  const before = JSON.stringify(layout), art = buildAuthoredSceneLayout(layout);
  assert.equal(art.rayWindows.length, 1, 'the reviewed skiff alcove must be the only aperture');
  const spec = art.rayWindows[0], b = spec.bounds;
  const placements = [...art.placements, ...art.decks];
  const assets = await Promise.all([...new Set(placements.map(p => p.assetId))].map(publishedAsset));
  const assetMap = new Map(assets.map(asset => [asset.id, asset])); globalThis.__occlusionAssets = assetMap;
  const { architectureAssetBounds, architectureMatrix } = await import(architectureUrl);
  const w = new CollisionWorld();
  for (const box of layout.boxes) w.addBox(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, box.tag, box.noRaycast);
  w.addBox(layout.minX - 12, -4, layout.minZ - 12, layout.maxX + 12, 0, layout.maxZ + 12, 'floor');
  const geometryBounds = new Map(assets.map(asset => [asset.id, architectureAssetBounds(asset.lods)]));
  const meshes = placements.map(p => {
    const asset = assetMap.get(p.assetId), source = asset.lods[Math.min(1, asset.lods.length - 1)], mesh = new THREE.Mesh(source.geometry, asset.material);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(architectureMatrix(source, p, geometryBounds.get(p.assetId))); mesh.updateMatrixWorld(true);
    mesh.userData.placement = p; return mesh;
  });
  const helper = new AuthoredArtOcclusion(w, placements, art.rayWindows);
  try {
    assert.equal(w.activeRayWindowCount, 1); assert.ok(helper.stats.candidates < 40, 'precomputed alcove candidates must exclude the full scene');
    const boat = meshes.find(mesh => mesh.userData.placement.assetId === 'SM_Env_FrozenSkiff');
    assert.ok(boat);
    const observer = boat.userData.placement.story.observer, eye = v(observer.x, 1.62, observer.z);
    const position = boat.geometry.attributes.position, indices = boat.geometry.index;
    const targets = [], a = v(0), c = v(0), d = v(0), ray = new THREE.Raycaster();
    for (let i = 0, stride = Math.max(3, Math.floor(indices.count / 100 / 3) * 3); i < indices.count - 2; i += stride) {
      a.fromBufferAttribute(position, indices.getX(i)); c.fromBufferAttribute(position, indices.getX(i + 1)); d.fromBufferAttribute(position, indices.getX(i + 2));
      const target = a.clone().add(c).add(d).multiplyScalar(1 / 3).applyMatrix4(boat.matrixWorld);
      if (target.y > .08 && target.x > b.minX && target.x < b.maxX && target.z > b.minZ && target.z < b.maxZ) targets.push(target);
    }
    let checked = 0, boatHits = 0;
    const cases = [], failedEdges = [];
    function compare(origin, direction, label, requireArt = false) {
      ray.set(origin, direction); ray.near = 0; ray.far = 80;
      const reference = ray.intersectObjects(meshes, false)[0], actual = w.raycast(origin, direction, 80);
      if (requireArt && !actual?.box.tag.startsWith('authored-art:')) {
        failedEdges.push({ label, origin: origin.toArray(), direction: direction.toArray(),
          actual: actual && { tag: actual.box.tag, point: actual.point.toArray() },
          visible: reference && { label: reference.object.userData.placement.label, point: reference.point.toArray() } });
        return;
      }
      if (!reference || reference.point.x < b.minX || reference.point.x > b.maxX || reference.point.z < b.minZ
        || reference.point.z > b.maxZ || reference.point.y < .05 || reference.point.y > b.maxY) return actual;
      assert.ok(actual, `${label}: visible art no longer blocks the shot`);
      assert.ok(Math.abs(actual.distance - reference.distance) < .002, `${label}: expected visible surface ${reference.distance}, got ${actual.distance}`);
      const normal = reference.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(reference.object.matrixWorld));
      if (normal.dot(direction) > 0) normal.negate();
      assert.ok(normal.dot(actual.normal) > .999, `${label}: projectile bounce normal differs from the visible triangle`);
      if (actual.box.tag === 'authored-art:SM_Env_FrozenSkiff') boatHits++;
      checked++; cases.push({ origin: origin.clone(), direction: direction.clone() });
      return actual;
    }
    for (const [i, target] of targets.entries()) compare(eye, target.clone().sub(eye).normalize(), `hull-${i}`);
    const boatBounds = new THREE.Box3().setFromObject(boat), boatCenter = boatBounds.getCenter(v(0));
    for (const lift of [.1, .4]) {
      const aim = boatCenter.clone(); aim.y = boatBounds.max.y + lift;
      const direction = aim.sub(eye).normalize(), hit = compare(eye, direction, `eye-over-skiff-${lift}`, true);
      assert.ok(hit && hit.point.y > boatBounds.max.y && hit.point.x < boatBounds.min.x,
        'a shot over the skiff must reach the visible rear shore instead of the old front box');
      const cursor = eye.clone(); let travelled = 0, segmented = null, usedInsideOrigin = false;
      for (let i = 0; i < 80; i++) {
        usedInsideOrigin ||= cursor.x < b.maxX - .1 && cursor.x > b.minX + .1;
        const part = w.raycast(cursor, direction, .6);
        if (part) { segmented = part; travelled += part.distance; break; }
        travelled += .6; cursor.addScaledVector(direction, .6);
      }
      assert.ok(usedInsideOrigin && segmented, 'the projectile must continue from origins inside the mesh aperture');
      assert.ok(Math.abs(travelled - hit.distance) < .002); assert.ok(segmented.normal.dot(hit.normal) > .999);
    }
    for (const height of [.55, 1.05]) {
      const aim = boatCenter.clone(); aim.y = height;
      const hit = compare(eye, aim.sub(eye).normalize(), `eye-low-gunwale-${height}`, true);
      assert.ok(hit && hit.box.tag.startsWith('authored-art:'), 'low gunwale shots must hit the visible hull or low quay');
    }
    for (const height of [1.2, 4, 7, 7.9]) {
      const inside = v((b.minX + b.maxX) * .5, height, (b.minZ + b.maxZ) * .5);
      for (const [label, direction] of [['rear', v(-1, 0)], ['north-edge', v(0, 0, -1)], ['south-edge', v(0, 0, 1)]])
        compare(inside, direction, `${label}-${height}`, true);
    }
    assert.deepEqual(failedEdges, [], 'air at a window exit must not replace a visible enclosing wall');
    assert.ok(checked >= 25, 'sample real hull and enclosing shore triangles rather than bounds alone');
    assert.ok(boatHits >= 10, 'the low quay must leave actual visible hull surfaces available to bullets');
    const queries = helper.stats.queries; w.raycast(v(layout.minX - 2, 4, layout.minZ - 2), v(1, 0), 20);
    assert.equal(helper.stats.queries, queries, 'outside shots must not enter the triangle tree');
    for (let i = 0; i < 200; i++) { const shot = cases[i % cases.length]; w.raycast(shot.origin, shot.direction, 80); }
    let triangleTests = 0, maxTriangleTests = 0; const count = 4000, start = performance.now();
    const hit = { distance: 0, point: v(0), normal: v(0), box: null };
    for (let i = 0; i < count; i++) {
      const shot = cases[i % cases.length]; w.raycast(shot.origin, shot.direction, 80, hit);
      triangleTests += helper.stats.lastTriangleTests; maxTriangleTests = Math.max(maxTriangleTests, helper.stats.lastTriangleTests);
    }
    const msPerRay = (performance.now() - start) / count;
    assert.ok(triangleTests / count < helper.stats.triangles * .12, 'each shot must inspect a small BVH subset');
    t.diagnostic(JSON.stringify({ candidates: helper.stats.candidates, triangles: helper.stats.triangles, checked, boatHits, count,
      meanTriangleTests: triangleTests / count, maxTriangleTests, msPerRay }));
    assert.equal(JSON.stringify(layout), before);
  } finally {
    helper.dispose(); delete globalThis.__occlusionAssets;
    for (const asset of assets) destroyAsset(asset);
  }
});
