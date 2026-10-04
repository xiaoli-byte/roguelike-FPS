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
const { WHITEBOX_PLANS } = await import(plansUrl);
const { generateWhitebox, getWhiteboxPlan, whiteboxPoint } = await import(await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') }));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const stageFor = plan => ({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1, reward: 'coins' });
const vec = p => new THREE.Vector3(p.x, 0.0001, p.z);
function collision(L) {
  const world = new CollisionWorld();
  world.addBox(L.minX, -1, L.minZ, L.maxX, 0, L.maxZ, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  return world;
}
function navFor(L, world) {
  const nav = new NavGrid({ world, enemies: { list: [] }, time: { now: 0 }, run: { time: 0 } });
  nav.build(L, 1);
  return nav;
}

test('runtime floor plans exactly preserve all reviewed polygons, widths and authored identities', async () => {
  const reviewed = (await Promise.all(['desert', 'frost', 'inferno'].map(chapter => readFile(new URL(`../docs/level-design/plans/${chapter}.json`, import.meta.url), 'utf8').then(JSON.parse)))).flat();
  assert.deepEqual(WHITEBOX_PLANS, reviewed);
  assert.equal(WHITEBOX_PLANS.length, 15);
  for (const plan of WHITEBOX_PLANS) {
    assert.equal(getWhiteboxPlan(stageFor(plan)).id, plan.id);
    assert.deepEqual(whiteboxPoint(plan, plan.entry.at), { x: plan.entry.at[0] - plan.bounds[0] / 2, z: plan.entry.at[1] - plan.bounds[1] / 2 });
  }
});

test('all 15 technical levels have collision-safe interaction and enemy placements', () => {
  for (const plan of WHITEBOX_PLANS) {
    const L = generateWhitebox(stageFor(plan)), world = collision(L);
    assert.ok(L.boxes.length < 1500, `${plan.id}: unmerged collision raster`);
    assert.ok(L.whitebox.floorRects.length < 1200, `${plan.id}: unmerged floor raster`);
    assert.ok(L.boxes.every(b => b.group === 0 && !b.noRaycast), `${plan.id}: boundary should be visible and block shots`);
    for (const point of L.whitebox.checkpoints) assert.equal(world.overlapsBody(point.x, .001, point.z, .35, 1.8), null, `${plan.id}/${point.id}: player clearance`);
    assert.ok(L.spawnPoints.length >= 20, `${plan.id}: too few enemy stations`);
    for (const point of L.spawnPoints) {
      assert.equal(world.overlapsBody(point.x, .001, point.z, 1.3, 2.6), null, `${plan.id}: enemy station intersects blocker`);
      assert.ok(Math.hypot(point.x - L.playerSpawn.x, point.z - L.playerSpawn.z) >= 10);
    }
    for (const point of L.portalPoints) assert.equal(world.overlapsBody(point.x, .001, point.z, 1.5, 2.5), null, `${plan.id}: portal intersects blocker`);
    for (let i = 0; i < L.portalPoints.length; i++) for (let j = i + 1; j < L.portalPoints.length; j++) assert.ok(vec(L.portalPoints[i]).distanceTo(vec(L.portalPoints[j])) >= 4 - 1e-6);
    if (L.type === 'boss') assert.equal(world.overlapsBody(L.bossPoint.x, .001, L.bossPoint.z, plan.chapter === 'desert' ? 2.1 : 1.3, 4), null, `${plan.id}: boss clearance`);
  }
});

test('real 1m NavGrid paths reach every checkpoint, interaction and enemy station without nearest-point fallback', () => {
  for (const plan of WHITEBOX_PLANS) {
    const L = generateWhitebox(stageFor(plan)), nav = navFor(L, collision(L)), path = [];
    for (const target of [...L.whitebox.checkpoints, ...L.portalPoints, L.rewardPoint, L.shopPoint, ...L.spawnPoints]) {
      assert.equal(nav.findPath(vec(L.playerSpawn), vec(target), path), true, `${plan.id}: no path to ${target.id ?? JSON.stringify(target)}`);
      assert.ok(path.at(-1).distanceTo(vec(target)) < .01, `${plan.id}: navigation silently selected a nearby point ${target.id ?? JSON.stringify(target)}`);
    }
  }
});

test('player body can physically follow navigation to all authored checkpoints at walking and dash-sized steps', () => {
  for (const plan of WHITEBOX_PLANS) {
    const L = generateWhitebox(stageFor(plan)), world = collision(L), nav = navFor(L, world), path = [];
    for (const target of L.whitebox.checkpoints) for (const speed of [7.5, 22]) {
      const pos = vec(L.playerSpawn);
      assert.equal(nav.findPath(pos, vec(target), path), true);
      for (const point of path) {
        let count = 0;
        while (Math.hypot(pos.x - point.x, pos.z - point.z) > .015 && count++ < 4000) {
          const dx = point.x - pos.x, dz = point.z - pos.z, distance = Math.hypot(dx, dz), step = Math.min(speed / 60, distance);
          world.moveBody(pos, .35, 1.8, new THREE.Vector3(dx / distance * step, -.003, dz / distance * step), true, .45);
        }
        assert.ok(count < 4000, `${plan.id}/${target.id}: body stuck while following real NavGrid path at ${speed}m/s (${pos.x},${pos.z}) -> (${point.x},${point.z})`);
      }
      assert.ok(Math.hypot(pos.x - target.x, pos.z - target.z) < .02, `${plan.id}/${target.id}: did not physically reach target`);
    }
  }
});

test('authored passage centrelines remain physically passable in both directions', () => {
  for (const plan of WHITEBOX_PLANS) {
    const L = generateWhitebox(stageFor(plan)), world = collision(L);
    for (const passage of plan.passages) for (const direction of [1, -1]) {
      const points = direction === 1 ? passage.points : [...passage.points].reverse(), pos = vec(whiteboxPoint(plan, points[0]));
      for (const authored of points.slice(1)) {
        const point = whiteboxPoint(plan, authored);
        let count = 0;
        while (Math.hypot(pos.x - point.x, pos.z - point.z) > .01 && count++ < 2000) {
          const dx = point.x - pos.x, dz = point.z - pos.z, distance = Math.hypot(dx, dz), step = Math.min(.125, distance);
          world.moveBody(pos, .35, 1.8, new THREE.Vector3(dx / distance * step, -.003, dz / distance * step), true, .45);
        }
        assert.ok(count < 2000, `${plan.id}/${passage.id}: authored corridor body stuck`);
      }
    }
  }
});

test('visible outer masses prevent cover-assisted double-jump escape in every map', () => {
  for (const plan of WHITEBOX_PLANS) {
    const L = generateWhitebox(stageFor(plan)), world = collision(L);
    // Base jump 8.6m/s, gravity 26m/s², second jump multiplier .94, plus 2.6m cover.
    const top = 2.6 + 8.6 ** 2 / 52 + (8.6 * .94) ** 2 / 52 + .1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const position = vec(L.playerSpawn); position.y = top;
      let blocked = false;
      for (let i = 0; i < 400; i++) blocked = world.moveBody(position, .35, 1.8, new THREE.Vector3(dx * .4, 0, dz * .4), false).hitWall || blocked;
      assert.ok(blocked, `${plan.id}: airborne player can escape outer mass`);
      assert.ok(position.x > L.minX && position.x < L.maxX && position.z > L.minZ && position.z < L.maxZ, `${plan.id}: airborne player left map bounds`);
    }
  }
});
