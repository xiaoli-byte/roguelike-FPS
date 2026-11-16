import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const source = await readFile(new URL('../src/world/Collision.ts', import.meta.url), 'utf8');
const triangles = await readFile(new URL('../src/world/UnityTriangles.ts', import.meta.url), 'utf8');
const trianglesUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(triangles.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64')}`;
const heightUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await readFile(new URL('../src/world/UnityHeightSampling.ts', import.meta.url), 'utf8'), { mode: 'transform' })).toString('base64')}`;
const url = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityTriangles'", `'${trianglesUrl}'`).replaceAll("'./UnityHeightSampling'", `'${heightUrl}'`), { mode: 'transform' })).toString('base64')}`;
const { CollisionWorld } = await import(url);

function rotatedWorld() {
  const world = new CollisionWorld();
  world.addObb(new THREE.Vector3(0, 1, 0), new THREE.Vector3(4, 2, 1), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4));
  return world;
}

test('Unity OBB accepts points inside the rotated shape, not its larger world AABB', () => {
  const world = rotatedWorld();
  assert.ok(world.overlapsBody(0.6, 0, 0, 0.1, 1.8));
  assert.equal(world.overlapsBody(1, 0, 0, 0.1, 1.8), null);
  assert.equal(world.sphereOverlaps(new THREE.Vector3(0.6, 1, 0), 0.05), true);
  assert.equal(world.sphereOverlaps(new THREE.Vector3(1, 1, 0), 0.05), false);
});

test('Unity OBB rays hit the actual rotated surface', () => {
  const world = rotatedWorld();
  const direction = new THREE.Vector3(1, 0, 1).normalize();
  const hit = world.raycast(new THREE.Vector3(-4, 1, -4), direction, 20);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.x + 0.353553) < 1e-3, hit.point.toArray().join(','));
  assert.ok(Math.abs(hit.point.z + 0.353553) < 1e-3, hit.point.toArray().join(','));
  assert.ok(Math.abs(hit.normal.y) < 1e-6);
});

test('Unity OBB movement resolves overlap without snapping to the world AABB', () => {
  const world = rotatedWorld();
  const position = new THREE.Vector3(1, 0, 0);
  const result = world.moveBody(position, 0.1, 1.8, new THREE.Vector3(-0.1, 0, 0), true);
  assert.equal(result.hitWall, true);
  assert.equal(world.overlapsBody(position.x, position.y, position.z, 0.1, 1.8), null);
});

test('Unity OBB with identity rotation retains ordinary box behavior', () => {
  const world = new CollisionWorld();
  world.addObb(new THREE.Vector3(0, 1, 0), new THREE.Vector3(2, 2, 2), new THREE.Quaternion());
  assert.ok(world.overlapsBody(0.9, 0, 0, 0.1, 1.8));
  assert.equal(world.overlapsBody(1.2, 0, 0, 0.1, 1.8), null);
  const hit = world.raycast(new THREE.Vector3(-3, 1, 0), new THREE.Vector3(1, 0, 0), 10);
  assert.ok(hit);
  assert.ok(Math.abs(hit.distance - 2) < 1e-6);
  assert.deepEqual(hit.normal.toArray(), [-1, 0, 0]);
});

test('Unity triangle collision preserves sloped ground, rays and projectiles', () => {
  const world = new CollisionWorld();
  world.addMesh(new Float32Array([-1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1]), new Uint32Array([0, 2, 1, 1, 2, 3]));
  assert.equal(world.groundHeight(0, 0, 5), 0);
  const hit = world.raycast(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0), 5);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.y) < 1e-6);
  assert.ok(hit.normal.y > 0.7);
  assert.ok(world.sphereOverlaps(new THREE.Vector3(0, 0.02, 0), 0.05));
  assert.equal(world.sphereOverlaps(new THREE.Vector3(0, 0.2, 0), 0.05), false);
  const position = new THREE.Vector3(0, 0.1, 0);
  assert.ok(world.overlapsBody(0, -0.1, 0, 0.1, 1.8), JSON.stringify({ normal: world.boxes[0].triangles.normal.toArray(), depth: world.boxes[0].triangles.depth }));
  const result = world.moveBody(position, 0.1, 1.8, new THREE.Vector3(0, -0.3, 0), false);
  assert.equal(result.onGround, true, JSON.stringify({ position: position.toArray(), result, normal: world.boxes[0].triangles.normal.toArray(), depth: world.boxes[0].triangles.depth }));
  assert.ok(Math.abs(position.y) < 0.001, position.toArray().join(','));
});

test('Unity water slows wading, rescues from deep water and follows spring phases', async () => {
  const data = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`;
  const library = `import * as THREE from '${threeUrl}'; export function unityPoint(v){return new THREE.Vector3(...v)} export function unityQuaternion(v){return new THREE.Quaternion(...v)}`;
  const hooks = data(await readFile(new URL('../src/enemies/bosses/framework/StageHooks.ts', import.meta.url), 'utf8'));
  const waterUrl = data((await readFile(new URL('../src/world/UnityWater.ts', import.meta.url), 'utf8')).replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityLevelLibrary'", `'${data(library)}'`)
    .replaceAll("'../enemies/bosses/framework/StageHooks'", `'${hooks}'`));
  const { UnityWaterView } = await import(waterUrl);
  const { Stats } = await import(data(await readFile(new URL('../src/core/Stats.ts', import.meta.url), 'utf8')));
  const { EventBus } = await import(data(await readFile(new URL('../src/core/EventBus.ts', import.meta.url), 'utf8')));
  const stats = new Stats(), events = new EventBus(), renderer = new THREE.Group();
  const player = { position: new THREE.Vector3(0, 0.8, 0), onGround: true, radius: 0.4, stats,
    maxHp: () => 100, teleport(p) { this.position.copy(p); this.onGround = false; } };
  const ctx = { player, events, enemies: { list: [] }, stats, stage: {}, combat: { damagePlayer() {} },
    nav: { nearestWalkable(point, out) { out.copy(point); return true; } },
    fx: { ring() {}, burst() {} }, audio: { play() {} }, rng: { next: () => 0.5 },
  };
  const document = { water: [{ id: 'water', name: 'Water', center: [0, 1, 0], scale: [10, 2, 10], rotation: [0, 0, 0, 1], shallow: 0.15, deep: 1.3, wadeSlow: 0.55, deepIsHazard: true, drownBurst: 0.05, spring: true, beds: [] }] };
  const view = new UnityWaterView(ctx, document, new Map([['water', [renderer]]]));
  view.update(0.1);
  assert.ok(player.stats.get('moveSpeed') < player.stats.getBase('moveSpeed') * 0.6);
  player.position.set(20, 0, 20); player.onGround = true; view.update(0.1);
  assert.equal(player.stats.get('moveSpeed'), player.stats.getBase('moveSpeed'));
  player.position.set(0, 0.65, 0); view.update(0.1);
  assert.deepEqual(player.position.toArray(), [20, 0, 20]);
  events.emit('enemy:bossPhase', { enemy: { def: { id: 'boss_hanba' }, getHeadCenter: out => out }, phase: 1 });
  for (let i = 0; i < 33; i++) view.update(0.1);
  assert.equal(renderer.visible, false);
  events.emit('enemy:killed', { enemy: { def: { id: 'boss_hanba' } } });
  for (let i = 0; i < 43; i++) view.update(0.1);
  assert.equal(renderer.visible, true);
  view.dispose();
  assert.equal(player.stats.get('moveSpeed'), player.stats.getBase('moveSpeed'));
});

test('Unity moving platform carries riders and its collision without duplication', async () => {
  const data = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`;
  const library = `import * as THREE from '${threeUrl}'; export function unityPoint(v){return new THREE.Vector3(...v)} export function unityQuaternion(v){return new THREE.Quaternion(...v)}`;
  const platformUrl = data((await readFile(new URL('../src/world/UnityPlatforms.ts', import.meta.url), 'utf8')).replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityLevelLibrary'", `'${data(library)}'`));
  const { UnityPlatformView } = await import(platformUrl);
  const ctx = { world: new CollisionWorld(), player: { position: new THREE.Vector3(0, 0.1, 0), radius: 0.4, onGround: true }, stage: {} };
  const root = new THREE.Group();
  const def = { id: 'lift', name: 'Lift', path: [[0, 0, 0], [4, 1, 0]], at: 0, size: [2, 0.5, 2], mode: 0, speed: 3, accel: 2.5, cornerSpeed: 0.8, dwell: 1.5, departDelay: 0.8, callDelay: 0.6, callRadius: 4, startPowered: true, powerSite: null };
  const document = { colliders: [{ kind: 'box', name: 'Lift', platform: 'lift', center: [0, -0.25, 0], size: [2, 0.5, 2], rotation: [0, 0, 0, 1], min: [-1, -0.5, -1], max: [1, 0, 1] }] };
  const view = new UnityPlatformView(ctx, def, root, document);
  view.update(1.5);
  for (let i = 0; i < 24; i++) view.update(0.1);
  assert.ok(root.position.distanceTo(new THREE.Vector3(4, 1, 0)) < 1e-4, root.position.toArray().join(','));
  assert.ok(ctx.player.position.distanceTo(new THREE.Vector3(4, 1.1, 0)) < 1e-4, ctx.player.position.toArray().join(','));
  assert.equal(ctx.world.boxes.length, 1);
  assert.ok(ctx.world.boxes[0].obb.center.distanceTo(new THREE.Vector3(4, 0.75, 0)) < 1e-4);
  ctx.player.onGround = false;
  const before = ctx.player.position.clone();
  view.update(1.5);
  assert.ok(ctx.player.position.equals(before));
  assert.equal(ctx.world.boxes.length, 1);
});

test('Unity activator supports interaction, shot hits, cooldown and platform signals', async () => {
  const data = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`;
  const library = `import * as THREE from '${threeUrl}'; export function unityPoint(v){return new THREE.Vector3(...v)}`;
  const activatorUrl = data((await readFile(new URL('../src/world/UnityActivators.ts', import.meta.url), 'utf8')).replaceAll("'three'", `'${threeUrl}'`).replaceAll("'./UnityLevelLibrary'", `'${data(library)}'`));
  const { UnityActivatorSystem } = await import(activatorUrl);
  const calls = [], interactions = [];
  const ctx = {
    world: new CollisionWorld(), time: { now: 0 }, stage: {},
    interact: { add(value) { interactions.push(value); return () => {}; } },
    ui: { toast() {} },
  };
  ctx.world.addBox(-1, -1, -1, 1, 1, 1, 'unity-activator-switch');
  const def = { id: 'switch', position: [0, 0, 0], byShot: true, byInteract: true, minShotDamage: 1, toggle: true,
    oneShot: false, cooldown: 0.6, lockedBy: null, lockedHint: '', title: '机关', verb: '敲响', hint: '', toast: '',
    focusHeight: 1.4, interactRadius: 3, onColor: [1, 0.7, 0.2, 1], offColor: [0.3, 0.3, 0.3, 1], targets: ['lift'] };
  const root = new THREE.Group(); root.userData.unitySwing = true;
  const platform = { id: 'lift', activate(on) { calls.push(on); } };
  const system = new UnityActivatorSystem(ctx, { activators: [def] }, new Map([['switch', [root]]]), [platform]);
  assert.equal(interactions.length, 1);
  interactions[0].onInteract();
  assert.deepEqual(calls, [true]);
  assert.equal(interactions[0].onInteract(), false);
  ctx.time.now += 0.7;
  const hit = ctx.world.raycast(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(1, 0, 0), 10);
  assert.ok(hit);
  hit.box.onHit(10);
  assert.deepEqual(calls, [true, false]);
  system.update(0.1);
  system.dispose();
});
