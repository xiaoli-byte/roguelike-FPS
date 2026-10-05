import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: new URL('../node_modules/three/build/three.module.js', import.meta.url).href, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(source);
}
const plansUrl = await ts('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS } = await import(plansUrl);
const genUrl = await ts('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl });
const { generateWhitebox, whiteboxPoint, whiteboxInsidePolygon } = await import(genUrl);
const { buildWhiteboxFights } = await import(await ts('../src/world/WhiteboxEncounters.ts', { './WhiteboxGen': genUrl }));
const { buildShopLayout, SHOP_STALL_HALF_WIDTH, SHOP_CUSTOMER_HALF_WIDTH } = await import(await ts('../src/progression/loot/shopLayout.ts'));
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
const { NavGrid } = await import(await ts('../src/world/NavGrid.ts', { '../core/math': await ts('../src/core/math.ts') }));
const before = JSON.parse(await readFile(new URL('../art/reviews/level-expansion-20261005/before-plans.json', import.meta.url), 'utf8'));
const { generateWhitebox: generateBefore } = await import(await ts('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': data(`export const WHITEBOX_PLANS=${JSON.stringify(before)}`) }));
const node = (p, type = p.index === 5 ? 'boss' : 'combat') => ({ type, theme: p.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(p.chapter), index: p.index - 1, reward: 'coins' });
const vector = p => new THREE.Vector3(p.x, .001, p.z);
function routeLength(p) {
  let room = p.entry.room, at = p.entry.at, length = 0;
  for (const id of p.mainRoute) {
    const passage = p.passages.find(path => path.id === id);
    const points = passage.from === room ? passage.points : [...passage.points].reverse();
    for (const q of points) { length += Math.hypot(q[0] - at[0], q[1] - at[1]); at = q; }
    room = passage.from === room ? passage.to : passage.from;
  }
  return length + Math.hypot(p.exit.at[0] - at[0], p.exit.at[1] - at[1]);
}
function scene(L) {
  const world = new CollisionWorld();
  world.addBox(L.minX, -1, L.minZ, L.maxX, 0, L.maxZ, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const nav = new NavGrid({ world, enemies: { list: [] }, time: { now: 0 }, run: { time: 0 } });
  nav.build(L, 1); return { world, nav };
}

test('twelve individual exploration layouts gain real floor area and walking distance while retaining encounter identities', () => {
  const signatures = new Set();
  for (const p of WHITEBOX_PLANS) {
    const old = before.find(q => q.id === p.id);
    assert.deepEqual(p.encounters.map(e => [e.id, e.roster]), old.encounters.map(e => [e.id, e.roster]), `${p.id}: enlargement must not silently add enemy quota`);
    assert.ok(old.rooms.every(r => p.rooms.some(q => q.id === r.id)), `${p.id}: existing room identities`);
    const shape = JSON.stringify([p.rooms.map(r => r.polygon), p.passages.map(r => [r.points, r.width])]);
    assert.ok(!signatures.has(shape), `${p.id}: copied map geometry`); signatures.add(shape);
    if (p.index === 5) continue;
    const area = L => L.whitebox.floorRects.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0)
      - L.boxes.filter(b => b.tag === 'whitebox-cover').reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
    assert.ok(area(generateWhitebox(node(p))) >= area(generateBefore(node(old))) * 1.35, `${p.id}: playable area gain`);
    assert.ok(routeLength(p) >= routeLength(old) * 1.2, `${p.id}: genuine route distance gain`);
    assert.ok(p.passages.every(path => path.width >= (path.kind === 'main' ? 7 : 5)), `${p.id}: routes give room to turn and pass`);
  }
});

test('authored chests occupy distinct reachable rooms with explicit guards and stay apart from final rewards and portals', () => {
  for (const p of WHITEBOX_PLANS) {
    const L = generateWhitebox(node(p)), { world, nav } = scene(L), path = [];
    if (p.index !== 5) { assert.equal(p.rewards.length, 3); assert.equal(new Set(p.rewards.map(r => r.room)).size, 3); }
    for (const reward of p.rewards) {
      assert.ok(['coins', 'scroll', 'weapon', 'heal', 'upgrade'].includes(reward.reward), `${p.id}/${reward.label}: explicit loot`);
      assert.ok(reward.requires.length > 0 && reward.requires.every(id => p.encounters.some(e => e.id === id)), `${p.id}/${reward.label}: guard IDs`);
      const target = whiteboxPoint(p, reward.at);
      assert.equal(world.overlapsBody(target.x, .001, target.z, 1.25, 2), null, `${p.id}: chest approach clearance`);
      assert.ok(nav.findPath(vector(L.playerSpawn), vector(target), path) && path.at(-1).distanceTo(vector(target)) < .01, `${p.id}: exact chest approach`);
      assert.ok(Math.hypot(target.x - L.playerSpawn.x, target.z - L.playerSpawn.z) > 15, `${p.id}: no spawn-point reward pile`);
      for (const q of [L.rewardPoint, ...L.portalPoints]) assert.ok(Math.hypot(target.x - q.x, target.z - q.z) >= 3.2 - 1e-8, `${p.id}: chest overlaps final interaction`);
    }
  }
});

test('quiet shop branches reserve every real stall, table corner and customer approach', () => {
  for (const p of WHITEBOX_PLANS) {
    const L = generateWhitebox(node(p, 'shop')), { world, nav } = scene(L);
    const yaw = Math.atan2(L.playerSpawn.x - L.shopPoint.x, L.playerSpawn.z - L.shopPoint.z);
    const stations = buildShopLayout(L.shopPoint, yaw), path = [];
    for (const s of stations) {
      assert.equal(world.overlapsBody(s.position.x, .001, s.position.z, SHOP_STALL_HALF_WIDTH, 2), null, `${p.id}: full table fits`);
      world.addBox(s.position.x - SHOP_STALL_HALF_WIDTH, .05, s.position.z - SHOP_STALL_HALF_WIDTH,
        s.position.x + SHOP_STALL_HALF_WIDTH, 1.05, s.position.z + SHOP_STALL_HALF_WIDTH, 'prop', true);
    }
    nav.build(L, 1);
    for (const s of stations) {
      assert.equal(world.overlapsBody(s.customer.x, .001, s.customer.z, SHOP_CUSTOMER_HALF_WIDTH, 1.8), null, `${p.id}: customer fits beside real tables`);
      // The 1m nav raster conservatively inflates the counters. Move the physical
      // player from its nearby open cell and verify the actual customer station.
      assert.ok(nav.findPath(vector(L.playerSpawn), vector(s.customer), path), `${p.id}: shop reachable`);
      const pos = path.at(-1).clone(), distance = pos.distanceTo(vector(s.customer));
      assert.ok(distance < 2, `${p.id}: nav approach outside counter interaction distance`);
      const delta = vector(s.customer).sub(pos); delta.y = 0;
      for (let step = 0; step < 20; step++) world.moveBody(pos, .35, 1.8, delta.clone().multiplyScalar(.05), true, .45);
      assert.ok(Math.hypot(pos.x - s.customer.x, pos.z - s.customer.z) < .02, `${p.id}: raster fallback cannot physically reach counter`);
    }
  }
});

test('boss preparation corridors remain physically passable after all seven counters are present', () => {
  for (const p of WHITEBOX_PLANS.filter(p => p.index === 5)) {
    const L = generateWhitebox(node(p)), { world } = scene(L), prep = p.preparation;
    const center = whiteboxPoint(p, prep.at), yaw = Math.atan2(prep.facing[0] - prep.at[0], prep.facing[1] - prep.at[1]);
    for (const s of buildShopLayout(center, yaw)) world.addBox(s.position.x - .62, .05, s.position.z - .62,
      s.position.x + .62, 1.05, s.position.z + .62, 'prop', true);
    const preparationRoom = p.rooms.find(r => r.id === prep.room);
    assert.equal(L.spawnPoints.some(point => whiteboxInsidePolygon([point.x + p.bounds[0] / 2, point.z + p.bounds[1] / 2], preparationRoom.polygon)), false, `${p.id}: no enemy stations in shopping room`);
    for (const passage of p.passages) for (const points of [passage.points, [...passage.points].reverse()]) {
      const position = vector(whiteboxPoint(p, points[0]));
      assert.equal(world.overlapsBody(position.x, .001, position.z, .35, 1.8), null, `${p.id}/${passage.id}: starting point touches merchant`);
      for (const q of points.slice(1)) {
        const target = vector(whiteboxPoint(p, q));
        for (let count = 0; position.distanceTo(target) > .02 && count < 2000; count++) {
          const delta = target.clone().sub(position); delta.y = 0;
          delta.multiplyScalar(Math.min(.12 / delta.length(), 1)); delta.y = -.003;
          world.moveBody(position, .35, 1.8, delta, true, .45);
        }
        assert.ok(Math.hypot(position.x - target.x, position.z - target.z) < .02, `${p.id}/${passage.id}: shop blocks boss corridor`);
      }
    }
  }
});

test('every authored encounter has a real unblocked activation sightline in its own room', () => {
  for (const p of WHITEBOX_PLANS) {
    const L = generateWhitebox(node(p)), { world } = scene(L);
    for (const fight of buildWhiteboxFights(L, node(p))) {
      const target = new THREE.Vector3(fight.facing.x, 1.2, fight.facing.z);
      assert.ok(fight.points.some(point => !world.segmentBlocked(new THREE.Vector3(point.x, 1.2, point.z), target)), `${p.id}/${fight.id}/${fight.room}: facing hidden inside wall or cover`);
    }
  }
});
