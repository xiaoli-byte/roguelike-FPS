// V2 redesign slices (docs/level-design/plans-v2): same physical guarantees as the shipped plans,
// plus the redesign's own targets — wide linear arenas, reachable raised decks, short main route.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return dataModule(source);
}
const plansUrl = await tsModule('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS, WHITEBOX_REDESIGN_PLANS } = await import(plansUrl);
const { generateWhitebox, getWhiteboxPlan, whiteboxPoint } = await import(await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') }));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { buildWhiteboxFights } = await import(await tsModule('../src/world/WhiteboxEncounters.ts', { './WhiteboxGen': await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }) }));
const stageFor = plan => ({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1, reward: 'coins' });
const vec = p => new THREE.Vector3(p.x, 0.0001, p.z);
const area = polygon => Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
function collision(L) {
  const world = new CollisionWorld();
  world.addBox(L.minX, -1, L.minZ, L.maxX, 0, L.maxZ, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  return world;
}
function navFor(L, world) {
  const nav = new NavGrid({ world, enemies: { list: [] }, time: { now: 0 }, run: { time: 0 } });
  nav.build(L, 1);
  nav.setRamps(L.ramps.map(r => ({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, topY: r.top, sx0: r.sx0, sz0: r.sz0, sx1: r.sx1, sz1: r.sz1,
    foot: new THREE.Vector3(r.foot.x, 0, r.foot.z), head: new THREE.Vector3(r.head.x, r.top, r.head.z) })));
  return nav;
}
/** Walk a body along straight segments with the player's step-up height; returns false if stuck. */
function walk(world, pos, points, speed = 7.5) {
  for (const point of points) {
    let count = 0;
    while (Math.hypot(pos.x - point.x, pos.z - point.z) > .02 && count++ < 4000) {
      const dx = point.x - pos.x, dz = point.z - pos.z, distance = Math.hypot(dx, dz), step = Math.min(speed / 60, distance);
      world.moveBody(pos, .35, 1.8, new THREE.Vector3(dx / distance * step, -.05, dz / distance * step), true, .45);
    }
    if (count >= 4000) return false;
  }
  return true;
}

test('the redesign switch picks the V2 slice for its slot, LD-03 stays reachable, and ids never collide', () => {
  assert.ok(WHITEBOX_REDESIGN_PLANS.length >= 1);
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const stage = stageFor(plan);
    assert.equal(getWhiteboxPlan(stage, true).id, plan.id);
    assert.ok(WHITEBOX_PLANS.some(p => p.id === getWhiteboxPlan(stage).id), `${plan.id}: default must remain the shipped plan`);
    assert.ok(!WHITEBOX_PLANS.some(p => p.id === plan.id), 'redesign ids never collide with shipped ids');
  }
});

test('redesign targets: wide main connectors, large fight arenas, short direct main route, elevation in every fight', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    for (const id of plan.mainRoute) {
      const passage = plan.passages.find(p => p.id === id);
      assert.ok(passage.width >= 10, `${plan.id}/${id}: main connector narrower than 10 m`);
      assert.ok(passage.points.length <= 3, `${plan.id}/${id}: main connector bends more than once`);
    }
    const main = plan.mainRoute.reduce((sum, id) => { const p = plan.passages.find(x => x.id === id).points; return sum + p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0); }, 0);
    assert.ok(main <= 80, `${plan.id}: connectors total ${main} m; arenas should carry the route`);
    for (const encounter of plan.encounters) {
      const room = plan.rooms.find(r => r.id === encounter.room);
      assert.ok(area(room.polygon) >= 1600, `${plan.id}/${room.id}: fight arena under 1600 m²`);
      if (plan.index < 5) assert.ok((plan.platforms ?? []).some(p => {
        const c = [(p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2];
        return area(room.polygon) && c[0] >= Math.min(...room.polygon.map(q => q[0])) && c[0] <= Math.max(...room.polygon.map(q => q[0]))
          && c[1] >= Math.min(...room.polygon.map(q => q[1])) && c[1] <= Math.max(...room.polygon.map(q => q[1]));
      }), `${plan.id}/${room.id}: fight arena has no raised deck`);
      assert.ok(encounter.squad?.length, `${plan.id}/${encounter.id}: roster must live in the plan`);
    }
  }
});

test('redesign slices have collision-safe interactions, stations and portals', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const L = generateWhitebox(stageFor(plan), { redesign: true }), world = collision(L);
    assert.equal(L.whitebox.planId, plan.id);
    for (const point of L.whitebox.checkpoints) assert.equal(world.overlapsBody(point.x, .001, point.z, .35, 1.8), null, `${plan.id}/${point.id}: player clearance`);
    assert.ok(L.spawnPoints.length >= 40, `${plan.id}: too few enemy stations`);
    for (const point of L.spawnPoints) assert.equal(world.overlapsBody(point.x, .001, point.z, 1.3, 2.6), null, `${plan.id}: enemy station intersects blocker`);
    for (const point of L.portalPoints) assert.equal(world.overlapsBody(point.x, .001, point.z, 1.5, 2.5), null, `${plan.id}: portal intersects blocker`);
    for (const ramp of L.ramps) assert.equal(world.overlapsBody(ramp.foot.x, .001, ramp.foot.z, .35, 1.8), null, `${plan.id}: stair foot blocked`);
  }
});

test('the player walks the whole main route and climbs every raised deck by its stairs', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const L = generateWhitebox(stageFor(plan), { redesign: true }), world = collision(L), nav = navFor(L, world), path = [];
    for (const target of L.whitebox.checkpoints) {
      const pos = vec(L.playerSpawn);
      assert.equal(nav.findPath(pos, vec(target), path), true, `${plan.id}: no path to ${target.id}`);
      assert.ok(walk(world, pos, path), `${plan.id}/${target.id}: body stuck on the main route`);
      assert.ok(Math.hypot(pos.x - target.x, pos.z - target.z) < .05, `${plan.id}/${target.id}: did not reach`);
    }
    for (const ramp of L.ramps) {
      const pos = vec(ramp.foot);
      assert.ok(walk(world, pos, [new THREE.Vector3(ramp.head.x, 0, ramp.head.z)]), `${plan.id}: stuck on stair to deck`);
      assert.ok(Math.abs(pos.y - ramp.top) < .06, `${plan.id}: stair did not lift the player onto the ${ramp.top} m deck (y=${pos.y.toFixed(2)})`);
    }
  }
});

test('enemy navigation reaches the top of every raised deck through its stair ramp', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const L = generateWhitebox(stageFor(plan), { redesign: true }), nav = navFor(L, collision(L)), path = [];
    for (const deck of plan.platforms) {
      const c = whiteboxPoint(plan, [(deck.rect[0] + deck.rect[2]) / 2, (deck.rect[1] + deck.rect[3]) / 2]);
      const top = new THREE.Vector3(c.x, deck.height, c.z);
      assert.equal(nav.findPath(vec(L.playerSpawn), top, path), true, `${plan.id}/${deck.id}: enemies cannot path onto deck`);
    }
  }
});

// The desert roster burrows, rolls or charges along the ground (confirmed by the enemy sessions, 2026-10-07).
const GROUND_ONLY = new Set(['jerboa_blade', 'scorpion_archer', 'mirage_toad', 'fire_rat', 'tomb_beast',
  'jiaoren', 'xingxing', 'haozhi', 'fuzhu', 'ice_whale', 'xuangui', 'frost_crab', 'fox_witch']);
// Deck stations still serve shooters that can stand on a deck: checked with a deck-capable roster in the same rooms.
const DECK_ROSTER = [['archer', 2], ['mortar', 1], ['grunt', 3]];
const roleOf = id => ({ archer: 'ranged', wisp: 'ranged', scorpion_archer: 'ranged', qingniao: 'ranged', marksman: 'precision', fuzhu: 'precision',
  mortar: 'artillery', mirage_toad: 'artillery', ice_whale: 'artillery' })[id] ?? 'other';
const withRoster = (L, squad) => ({ ...L, whitebox: { ...L.whitebox, plan: { ...L.whitebox.plan, encounters: L.whitebox.plan.encounters.map(e => ({ ...e, squad })) } } });

test('ground-only enemies never take deck stations; deck-capable shooters stand on the deck tops; squads spread with the room', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const stage = stageFor(plan), L = generateWhitebox(stage, { redesign: true }), world = collision(L), nav = navFor(L, world), path = [];
    for (const fight of buildWhiteboxFights(L, stage)) {
      const squad = plan.encounters.find(e => e.id === fight.id).squad;
      if (squad.every(([id]) => GROUND_ONLY.has(id))) assert.deepEqual(fight.anchors.filter(a => a.y !== undefined), [], `${plan.id}/${fight.id}: ground-only squad given a deck station`);
    }
    assert.ok(buildWhiteboxFights(withRoster(L, DECK_ROSTER), stage).every(f => f.anchors.some(a => a.y !== undefined)), `${plan.id}: deck-capable shooters reach the decks`);
    for (const fight of [...buildWhiteboxFights(L, stage), ...buildWhiteboxFights(withRoster(L, DECK_ROSTER), stage)]) {
      const decks = L.ramps.filter(r => fight.contains({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }));
      // A shooting role is raised only when it is filled, and only by enemies that can stand on a deck.
      const filled = role => fight.plans[0].entries.filter(e => roleOf(e.enemyId) === role);
      const raised = role => filled(role).length > 0 && filled(role).every(e => !GROUND_ONLY.has(e.enemyId));
      const shooters = fight.anchors.filter(a => ['ranged', 'precision', 'artillery'].includes(a.role));
      for (const a of shooters) {
        if (!decks.length || !raised(a.role)) { assert.equal(a.y, undefined, `${plan.id}/${fight.id}: shooters stand on the floor`); continue; }
        const at = new THREE.Vector3(a.x, a.y, a.z);
        assert.ok(decks.some(r => Math.abs(a.y - r.top) < 1e-9 && a.x > r.x0 && a.x < r.x1 && a.z > r.z0 && a.z < r.z1), `${plan.id}/${fight.id}: ${a.role} station is not on a deck top`);
        assert.equal(nav.platformAt(at), true, `${plan.id}/${fight.id}: nav does not see the deck station`);
        assert.equal(world.overlapsBody(a.x, a.y + .001, a.z, .9, 2.5), null, `${plan.id}/${fight.id}: deck station intersects a blocker`);
        assert.equal(nav.findPath(vec(L.playerSpawn), at, path), true, `${plan.id}/${fight.id}: deck station unreachable`);
      }
      for (const a of fight.anchors.filter(a => a.y === undefined)) assert.equal(world.overlapsBody(a.x, .001, a.z, .9, 2.5), null, `${plan.id}/${fight.id}: floor station blocked`);
      // A whole squad must not start inside one small circle of a large arena.
      const xs = fight.anchors.map(a => a.x), zs = fight.anchors.map(a => a.z);
      const spanned = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      assert.ok(spanned >= 16, `${plan.id}/${fight.id}: stations span only ${spanned.toFixed(1)} m`);
    }
  }
});

test('outer masses out-reach a double jump from the tallest standable top', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const L = generateWhitebox(stageFor(plan), { redesign: true }), world = collision(L);
    const tallest = Math.max(2.6, ...plan.covers.map(c => c.height), ...plan.platforms.map(p => p.height));
    const top = tallest + 8.6 ** 2 / 52 + (8.6 * .94) ** 2 / 52 + .1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const position = vec(L.playerSpawn); position.y = top;
      let blocked = false;
      for (let i = 0; i < 800; i++) blocked = world.moveBody(position, .35, 1.8, new THREE.Vector3(dx * .4, 0, dz * .4), false).hitWall || blocked;
      assert.ok(blocked, `${plan.id}: airborne player escapes from ${tallest} m`);
      assert.ok(position.x > L.minX && position.x < L.maxX && position.z > L.minZ && position.z < L.maxZ, `${plan.id}: left map bounds`);
    }
  }
});

test('a portal shrine at the exit receives the opened portal in its arch, whichever way it faces', () => {
  for (const plan of WHITEBOX_REDESIGN_PLANS) {
    const pylons = plan.covers.filter(c => c.art === 'shrine');
    if (pylons.length < 2) continue;
    const L = generateWhitebox(stageFor(plan), { redesign: true });
    // The director opens portalPoints[1]; in plan metres it must lie between the two pylons, inside their depth.
    const p = L.portalPoints[1], x = p.x + plan.bounds[0] / 2, z = p.z + plan.bounds[1] / 2;
    const xs = pylons.flatMap(c => c.polygon.map(q => q[0])), zs = pylons.flatMap(c => c.polygon.map(q => q[1]));
    assert.ok(x > Math.min(...xs) && x < Math.max(...xs) && z > Math.min(...zs) && z < Math.max(...zs), `${plan.id}: portal (${x.toFixed(1)}, ${z.toFixed(1)}) is not in the shrine arch`);
    assert.ok(!pylons.some(c => { const cx = c.polygon.map(q => q[0]), cz = c.polygon.map(q => q[1]);
      return x >= Math.min(...cx) && x <= Math.max(...cx) && z >= Math.min(...cz) && z <= Math.max(...cz); }), `${plan.id}: portal inside a pylon`);
  }
});
