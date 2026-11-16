import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/unity-levels/manifest.json', root), 'utf8'));
const available = manifest.stages.filter(stage => stage.available);
const unavailable = manifest.stages.filter(stage => !stage.available).map(stage => stage.id);

async function exists(url) {
  try { await stat(new URL(url, root)); return true; } catch { return false; }
}

test('Unity run plan exposes 16 main stages, the map pool and every generated Unity scene', () => {
  const main = manifest.stages.filter(stage => !stage.pool);
  const pool = manifest.stages.filter(stage => stage.pool);
  assert.equal(main.length, 16);
  assert.ok(available.length >= 13);
  assert.deepEqual(main.map(stage => stage.id), ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4', '3-1', '3-2', '3-3', '3-4', '4-1', '4-2', '4-3', '4-4']);
  // 图池备选图（RunPlan.Pool）：只进清单和场景目录，不进 UnityStages.ts 的主线表
  assert.deepEqual(pool.map(stage => stage.id), ['1-A', '2-A', '3-A']);
  assert.ok(pool.every(stage => stage.available && stage.url), 'every pool map is exported');
  assert.deepEqual(unavailable, manifest.stages.filter(stage => !stage.available).map(stage => stage.id));
});

for (const stage of available) test(`${stage.id}: scene geometry, collision and gameplay come from Unity`, async () => {
  const document = JSON.parse(await readFile(new URL(`public/${stage.url}`, root), 'utf8'));
  assert.equal(document.id, stage.id);
  assert.equal(document.title, stage.title);
  assert.ok(document.spawn.position.every(Number.isFinite));
  assert.equal(document.spawn.forward.length, 3);
  assert.ok(document.renderers.length > 0);
  assert.ok(document.bounds.min.every(Number.isFinite) && document.bounds.max.every(Number.isFinite));
  assert.ok(document.bounds.min[0] < document.bounds.max[0] && document.bounds.min[2] < document.bounds.max[2], 'playable bounds are ordered and non-empty');
  assert.ok(document.bounds.max[0] - document.bounds.min[0] < 2000 && document.bounds.max[2] - document.bounds.min[2] < 2000, 'navigation uses the playable LevelMeta bounds');
  assert.ok(document.colliders.length > 0);
  for (const collider of document.colliders) {
    for (let axis = 0; axis < 3; axis++) assert.ok(collider.min[axis] <= collider.max[axis], `${document.id}/${collider.name}: inverted collider`);
    if (collider.kind === 'box') {
      assert.equal(collider.center.length, 3);
      assert.equal(collider.size.length, 3);
      assert.equal(collider.rotation.length, 4);
      assert.ok(collider.size.every(value => Number.isFinite(value) && value > 0));
    }
  }
  assert.ok(document.navigation.vertices.length > 0 && document.navigation.indices.length > 0, 'baked Unity NavMesh is exported');
  assert.ok(document.environment.fog.color.length === 4 && document.environment.ambient.sky.length === 4);
  assert.ok(document.environment.sky || document.environment.sun, 'Unity sky or directional light is exported');
  assert.equal(document.environment.sky?.cubemap?.length, 6, 'six native Unity skybox faces are exported');
  for (const url of document.environment.sky?.cubemap ?? []) assert.ok(await exists(`public/${url}`), url);
  assert.ok(document.map?.url, 'Unity LevelMap is exported');
  assert.ok(await exists(`public/${document.map.url}`), document.map.url);
  assert.equal(document.map.area.length, 4);
  for (const renderer of document.renderers) {
    assert.ok(renderer.url.length < 180, `${stage.id}/${renderer.name}: exported path must fit Windows path limits`);
    assert.ok(await exists(`public/${renderer.url}`), renderer.url);
    assert.equal(renderer.position.length, 3);
    assert.equal(renderer.rotation.length, 4);
    assert.equal(renderer.scale.length, 3);
  }
  for (const field of document.heightfields) {
    const bytes = Buffer.from(field.heights, 'base64');
    assert.equal(bytes.length, field.resolution * field.resolution * 4);
    assert.ok(field.resolution > 0 && Number.isInteger(field.resolution));
    assert.equal(field.scale.length, 3);
  }
  for (const prototype of document.vegetation?.prototypes ?? []) assert.ok(await exists(`public/${prototype.url}`), prototype.url);
  for (const instance of document.vegetation?.instances ?? []) {
    assert.ok(document.vegetation.prototypes.some(prototype => prototype.index === instance.prototype));
    assert.ok(instance.position.every(Number.isFinite) && instance.rotation.every(Number.isFinite) && instance.scale.every(value => Number.isFinite(value) && value > 0));
  }
  if (stage.id === '4-3') assert.ok(document.vegetation?.instances.length > 1000, 'Larch forest instances are exported');
  for (const layer of document.groundCover ?? []) {
    assert.ok(layer.url || layer.texture, `${stage.id}/${layer.name}: missing native detail prototype`);
    assert.equal(Buffer.from(layer.counts, 'base64').length, layer.width * layer.height * 4);
    assert.ok(layer.count > 0 && layer.viewDistance > 0);
  }
  for (const collider of document.colliders.filter(collider => ['sphere', 'capsule', 'mesh'].includes(collider.kind))) {
    assert.ok(collider.url, `${stage.id}/${collider.name}: primitive or mesh collider must not collapse to world bounds`);
    assert.ok(await exists(`public/${collider.url}`), collider.url);
  }
  for (const platform of document.platforms ?? []) {
    assert.ok(platform.path.length >= 2, `${stage.id}/${platform.name}: missing native platform path`);
    assert.ok(platform.path.every(point => point.every(Number.isFinite)));
    assert.ok(platform.size.every(value => Number.isFinite(value) && value > 0));
    assert.ok(document.renderers.some(renderer => renderer.platform === platform.id), `${stage.id}/${platform.name}: missing platform renderer`);
  }
  for (const water of document.water ?? []) {
    assert.ok(water.center.every(Number.isFinite) && water.scale.every(value => Number.isFinite(value) && value > 0));
    assert.equal(water.rotation.length, 4);
    assert.ok(water.deep >= water.shallow && water.wadeSlow > 0 && water.wadeSlow <= 1);
  }
  for (const encounter of document.encounters) {
    assert.ok(encounter.waves.length > 0, encounter.title);
    assert.ok(encounter.waves.every(wave => wave.entries.every(entry => entry.enemy && entry.count > 0)));
    assert.ok(encounter.triggerRadius > 0 && encounter.arenaRadius > 0);
  }
  assert.ok(document.exits.length > 0 || document.bosses.length > 0);
});

test('heightfields drive ground movement and ray hits', async () => {
  const source = await readFile(new URL('../src/world/Collision.ts', import.meta.url), 'utf8');
  const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
  const triangles = await readFile(new URL('../src/world/UnityTriangles.ts', import.meta.url), 'utf8');
  const trianglesUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(triangles.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64')}`;
  const heightUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await readFile(new URL('../src/world/UnityHeightSampling.ts', import.meta.url), 'utf8'), { mode: 'transform' })).toString('base64')}`;
  const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityTriangles'", `'${trianglesUrl}'`).replaceAll("'./UnityHeightSampling'", `'${heightUrl}'`), { mode: 'transform' })).toString('base64')}`;
  const { CollisionWorld } = await import(url);
  const { sampleUnityHeight } = await import(heightUrl);
  const world = new CollisionWorld();
  world.addHeightfield({
    origin: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1), resolution: 2,
    heights: new Float32Array([0, 0, 0, 1]),
  });
  assert.equal(sampleUnityHeight(world.heightfields[0], 0.75, 0.75), 0.5);
  assert.equal(world.groundHeight(0.75, 0.75, 5), 0.5);
  const position = new THREE.Vector3(0.75, 2, 0.75);
  const result = world.moveBody(position, 0.3, 1.8, new THREE.Vector3(0, -3, 0), false);
  assert.equal(result.onGround, true);
  assert.ok(Math.abs(position.y - 0.5001) < 1e-3);
  const hit = world.raycast(new THREE.Vector3(0.75, 2, 0.75), new THREE.Vector3(0, -1, 0), 5);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.y - 0.5) < 1e-3);
});

test('all Unity mesh texture URIs resolve to published texture files', async () => {
  const urls = new Set();
  for (const stage of available) {
    const document = JSON.parse(await readFile(new URL(`public/${stage.url}`, root), 'utf8'));
    for (const renderer of document.renderers) urls.add(renderer.url);
  }
  for (const url of urls) {
    const bytes = await readFile(new URL(`public/${url}`, root));
    const length = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
    for (const image of gltf.images ?? []) {
      if (!image.uri) continue;
      assert.ok(image.uri.startsWith('../textures/'), `${url}: ${image.uri}`);
      assert.ok(await exists(`public/assets/unity-levels/meshes/${image.uri}`), `${url}: ${image.uri}`);
    }
  }
});
