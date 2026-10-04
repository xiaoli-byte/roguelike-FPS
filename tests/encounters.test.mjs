import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll("'" + key + "'", "'" + value + "'");
  return dataModule(source);
}
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const { buildWaves, buildEncounterWaves, placementForEnemy } = await import(await tsModule('../src/enemies/Waves.ts', {
  './bosses': dataModule("export function bossIdForChapter(ch) { return ['boss_colossus','boss_matriarch','boss_warlord'][ch]; }"),
}));
const bodyDefs = Object.fromEntries(await Promise.all(['Grunt', 'Archer', 'Bomber', 'Brute', 'Wisp', 'Shaman', 'Mortar', 'Marksman'].map(async name => {
  const source = await readFile(new URL('../src/enemies/types/' + name + '.ts', import.meta.url), 'utf8');
  return [name.toLowerCase(), { radius: Number(source.match(/radius:\s*([\d.]+)/)[1]), height: Number(source.match(/height:\s*([\d.]+)/)[1]) }];
})));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const navUrl = await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') });
const { NavGrid } = await import(navUrl);
const stageDesignUrl = await tsModule('../src/world/StageDesign.ts');
const adventureUrl = await tsModule('../src/world/AdventureGen.ts', { './NavGrid': navUrl, './StageDesign': stageDesignUrl });
const { generateLevel } = await import(await tsModule('../src/world/LevelGen.ts', {
  './LevelCheck': await tsModule('../src/world/LevelCheck.ts', { './NavGrid': navUrl }),
  './Themes': await tsModule('../src/world/Themes.ts'), './AdventureGen': adventureUrl, './StageDesign': stageDesignUrl,
}));
const { WaveRunner } = await import(await tsModule('../src/world/WaveRunner.ts', {
  '../enemies/Registry': dataModule('const bodies = ' + JSON.stringify(bodyDefs) + "; export function getEnemyDef(id) { return { ...bodies[id], isBoss: id.startsWith('boss_') }; }"),
}));
const themes = ['desert', 'frost', 'inferno'];
const stage = (chapter, index, type = 'combat') => ({ chapter, index, type, theme: themes[chapter], reward: 'coins' });
const total = plans => plans.reduce((n, w) => n + w.entries.reduce((n, e) => n + e.count, 0), 0);
const countId = (plans, id) => plans.flatMap(w => w.entries).filter(e => e.enemyId === id).reduce((n, e) => n + e.count, 0);
const normalIds = new Set(['grunt', 'archer', 'bomber', 'brute', 'wisp', 'shaman', 'mortar', 'marksman']);
const placements = new Set(['assault', 'flank', 'ranged', 'precision', 'artillery', 'support']);

test('12 stage formations vary by chapter/index and stay within the whole-route population budget', () => {
  const chapterSignatures = [];
  for (let chapter = 0; chapter < 3; chapter++) {
    const signatures = new Set();
    for (let index = 0; index < 4; index++) for (let seed = 1; seed <= 40; seed++) {
      const ctx = { rng: new Rng(seed) }, node = stage(chapter, index);
      const main = buildWaves(ctx, node);
      const approach0 = buildEncounterWaves(ctx, node, 'approach', 0);
      const approach1 = buildEncounterWaves(ctx, node, 'approach', 1);
      const cache = buildEncounterWaves(ctx, node, 'cache', 0);
      const oneRoute = total(main) + total(approach0) + total(cache);
      const allRoutes = oneRoute + total(approach1);
      assert.ok(oneRoute >= 18 && allRoutes <= 30, chapter + '/' + index + ': ' + oneRoute + '..' + allRoutes);
      for (const wave of [...main, ...approach0, ...approach1, ...cache]) {
        assert.ok(total([wave]) >= 3 && total([wave]) <= 7);
        assert.ok(wave.label && wave.hint);
        for (const e of wave.entries) {
          assert.ok(normalIds.has(e.enemyId)); assert.ok(placements.has(e.placement));
          assert.ok(e.count > 0 && Number.isInteger(e.count)); assert.ok(e.arrivalDelay >= 0);
        }
      }
      if (seed === 1) signatures.add(JSON.stringify(main.map(w => w.entries.map(e => [e.enemyId, e.count, e.placement]))));
    }
    assert.equal(signatures.size, 4, 'every non-boss stage needs a different tactical formation');
    chapterSignatures.push([...signatures].join('|'));
  }
  assert.equal(new Set(chapterSignatures).size, 3);
});

test('weapon roles are introduced deliberately; elite promotions preserve population and source plans', () => {
  assert.deepEqual([...normalIds].map(id => [id, placementForEnemy(id)]), [
    ['grunt', 'assault'], ['archer', 'ranged'], ['bomber', 'flank'], ['brute', 'assault'],
    ['wisp', 'ranged'], ['shaman', 'support'], ['mortar', 'artillery'], ['marksman', 'precision'],
  ]);
  for (let index = 0; index < 4; index++) {
    const node = stage(0, index), ctx = { rng: new Rng(10) };
    const plans = [...buildWaves(ctx, node), ...buildEncounterWaves(ctx, node, 'approach', 0), ...buildEncounterWaves(ctx, node, 'approach', 1)];
    if (index < 2) assert.equal(countId(plans, 'brute'), 0);
    if (index < 3) assert.equal(countId(plans, 'mortar'), 0);
    assert.equal(countId(plans, 'shaman'), 0); assert.equal(countId(plans, 'marksman'), 0);
  }
  assert.ok(countId(buildWaves({ rng: new Rng(1) }, stage(0, 3)), 'mortar') > 0);
  assert.ok(countId(buildWaves({ rng: new Rng(1) }, stage(1, 0)), 'shaman') > 0);
  assert.equal(countId(buildWaves({ rng: new Rng(1) }, stage(1, 0)), 'marksman'), 0);
  assert.ok(countId(buildWaves({ rng: new Rng(1) }, stage(1, 1)), 'marksman') > 0);
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 4; index++) {
    const normal = buildWaves({ rng: new Rng(33) }, stage(chapter, index));
    const elite = buildWaves({ rng: new Rng(33) }, stage(chapter, index, 'elite'));
    assert.equal(elite.length, 2); assert.ok(total(elite) <= total(normal));
    assert.equal(elite.flatMap(w => w.entries).filter(e => e.elite).reduce((n, e) => n + e.count, 0), chapter === 2 ? 3 : 2);
    assert.deepEqual(buildWaves({ rng: new Rng(33) }, stage(chapter, index)), normal, 'elite assembly must not mutate shared formation data');
  }
  for (const type of ['shop', 'treasure']) {
    assert.deepEqual(buildWaves({ rng: new Rng(1) }, stage(0, 0, type)), []);
    assert.deepEqual(buildEncounterWaves({ rng: new Rng(1) }, stage(0, 0, type), 'cache', 0), []);
  }
  for (let chapter = 0; chapter < 3; chapter++) assert.equal(total(buildWaves({ rng: new Rng(1) }, stage(chapter, 4, 'boss'))), 1);
});

function fixture(entries, anchors, regional = false) {
  let time = 0;
  const warnings = [], spawns = [], enemies = [];
  const ctx = {
    rng: new Rng(94), run: { difficulty: 1 },
    player: { position: new THREE.Vector3(), yaw: 0 },
    world: { segmentBlocked() { return false; } },
    nav: { isWalkable() { return true; }, randomWalkable() { return false; },
      findPath(_from, to, out) { out.push(to.clone()); return true; }, nearestWalkable(p, out) { out.copy(p); return true; } },
    fx: { groundWarning(pos, _radius, duration) {
      const warning = { time, pos: pos.clone(), duration, cancelled: false }; warnings.push(warning);
      return () => { warning.cancelled = true; };
    }, shake() {} }, audio: { play() {} },
    enemies: { list: enemies, aliveCount() { return enemies.filter(e => e.alive).length; },
      spawn(id, options) { const e = { id, alive: true, position: options.position.clone(), time }; enemies.push(e); spawns.push(e); return e; } },
  };
  const arena = { minX: -60, minZ: -60, maxX: 60, maxZ: 60, floorY: 0, center: new THREE.Vector3(),
    spawnPoints: [], spawnAnchors: anchors };
  const region = regional ? { center: new THREE.Vector3(), minRadius: 10, maxRadius: 35, minPlayerDistance: 10, anchors } : undefined;
  const runner = new WaveRunner(ctx, arena, [{ entries }], 0, new THREE.Vector3(0, 0, -30), () => {}, region);
  const tick = t => { time = t; runner.update(t); };
  const advance = (from, to) => { for (let t = from; t <= to + 1e-7; t += .1) tick(t); };
  return { ctx, arena, runner, tick, advance, warnings, spawns, enemies };
}
const anchor = (role, lane, x, z) => ({ role, lane, position: new THREE.Vector3(x, 0, z) });

test('authored role/lane stations and arrival delays survive queued scheduling', () => {
  const anchors = [anchor('assault', 0, 0, -12), anchor('flank', 1, 14, 0), anchor('ranged', 0, -8, -15),
    anchor('precision', 0, -18, -18), anchor('artillery', 0, 10, -22), anchor('support', 0, 0, -18)];
  const roles = { grunt: 'assault', bomber: 'flank', archer: 'ranged', marksman: 'precision', mortar: 'artillery', shaman: 'support' };
  const entries = Object.entries(roles).map(([enemyId, placement]) => ({ enemyId, count: 1, placement, arrivalDelay: placement === 'precision' ? 2 : 0 }));
  const f = fixture(entries, anchors, true); f.tick(0);
  const precision = f.runner.pending.find(p => p.id === 'marksman');
  assert.equal(precision.placement, 'precision'); assert.equal(precision.arrivalDelay, 2); assert.ok(precision.warnAt >= 2);
  f.advance(.1, 7);
  assert.equal(f.spawns.length, 6);
  for (const spawn of f.spawns) {
    const expected = anchors.find(a => a.role === roles[spawn.id]);
    assert.ok(spawn.position.distanceTo(expected.position) < 1e-8, spawn.id + ' must retain its weapon station');
    const warning = f.warnings.filter(w => w.pos.distanceTo(spawn.position) < 1e-8).at(-1);
    assert.ok(spawn.time - warning.time >= .8 - 1e-7);
  }
  assert.ok(f.spawns.find(s => s.id === 'marksman').time >= 2.8);
});

test('coarse time steps and rushing into a warning always retain the full visible lead', () => {
  const coarse = fixture([{ enemyId: 'mortar', count: 1, placement: 'artillery', arrivalDelay: 1.2 }], [anchor('artillery', 0, 0, -22)]);
  coarse.tick(0); coarse.tick(5);
  assert.equal(coarse.warnings.length, 1); assert.ok(coarse.warnings[0].duration >= .8 - 1e-10);
  assert.equal(coarse.spawns.length, 0); coarse.tick(5.79); assert.equal(coarse.spawns.length, 0);
  coarse.tick(5.81); assert.equal(coarse.spawns.length, 1);
  for (const regional of [false, true]) {
    const f = fixture([{ enemyId: 'grunt', count: 1 }], [anchor('assault', 0, 0, -12), anchor('assault', 1, 0, 15)], regional);
    f.tick(0); f.ctx.player.position.copy(f.warnings[0].pos); f.tick(.81); f.tick(.82);
    assert.equal(f.spawns.length, 0); assert.equal(f.warnings.length, 2); assert.ok(f.warnings[0].cancelled);
    f.tick(1.6); assert.equal(f.spawns.length, 0); f.tick(1.63); assert.equal(f.spawns.length, 1);
    assert.ok(f.spawns[0].position.distanceTo(f.ctx.player.position) >= 10);
  }
});

test('walkable but disconnected/partial-path stations wait without centre or nearest-point fallback', () => {
  const f = fixture([{ enemyId: 'grunt', count: 1 }], [anchor('assault', 0, 0, -16)], true);
  f.ctx.nav.findPath = (_from, to, out) => { out.push(to.clone().add(new THREE.Vector3(3, 0, 0))); return true; };
  f.advance(0, 2); assert.equal(f.spawns.length, 0); assert.equal(f.warnings.length, 0); assert.equal(f.runner.done, false);
  f.ctx.nav.findPath = (_from, to, out) => { out.push(to.clone()); return true; };
  f.tick(2.3); assert.equal(f.warnings.length, 1); assert.equal(f.spawns.length, 0);
  f.tick(3.11); assert.equal(f.spawns.length, 1); assert.equal(f.runner.done, true);
  const blocked = fixture([{ enemyId: 'grunt', count: 1 }], [anchor('assault', 0, 0, -5)], true);
  blocked.advance(0, 2); assert.equal(blocked.spawns.length, 0); assert.equal(blocked.warnings.length, 0);
  blocked.runner.cancel(); blocked.tick(8); assert.equal(blocked.runner.done, true);
});

test('role-scored legacy points remain compatible and the scheduler never exceeds ten live units', () => {
  const f = fixture([{ enemyId: 'grunt', count: 12 }], []);
  f.arena.spawnPoints = Array.from({ length: 16 }, (_, i) => new THREE.Vector3(Math.sin(i * Math.PI / 8) * 20, 0, Math.cos(i * Math.PI / 8) * 20));
  f.advance(0, 8); assert.equal(f.spawns.length, 10); assert.equal(f.ctx.enemies.aliveCount(), 10); assert.equal(f.runner.done, false);
  assert.equal(f.runner.waitingForSpace, false, 'the live population limit is not a blocked station');
  f.enemies.slice(0, 3).forEach(e => { e.alive = false; });
  f.advance(8.1, 12); assert.equal(f.spawns.length, 12); assert.ok(f.ctx.enemies.aliveCount() <= 10); assert.equal(f.runner.done, true);
  for (const spawn of f.spawns) assert.ok(spawn.position.length() >= 10);
});

test('waitingForSpace distinguishes failed placement from scheduled arrivals and complete ground warnings', () => {
  const f = fixture([{ enemyId: 'grunt', count: 1, arrivalDelay: 2 }], [anchor('assault', 0, 0, -5)]);
  f.tick(0); assert.equal(f.runner.waitingForSpace, false);
  f.tick(1); assert.equal(f.runner.waitingForSpace, false, 'the authored delay has not elapsed');
  f.tick(2); assert.equal(f.runner.waitingForSpace, true); assert.equal(f.warnings.length, 0);
  f.ctx.player.position.set(20, 0, 0); f.tick(2.3);
  assert.equal(f.runner.waitingForSpace, false, 'a valid warning is ordinary arrival progress');
  assert.equal(f.warnings.length, 1); assert.equal(f.spawns.length, 0);
  f.tick(3.11); assert.equal(f.spawns.length, 1); assert.equal(f.runner.waitingForSpace, false);
  const blocked = fixture([{ enemyId: 'grunt', count: 1 }], []);
  blocked.tick(0); assert.equal(blocked.runner.waitingForSpace, true);
  blocked.runner.cancel(); assert.equal(blocked.runner.waitingForSpace, false);
});

test('all eight enemy bodies use actual dimensions and elite scale to reject narrow stations', () => {
  for (const [id, def] of Object.entries(bodyDefs)) for (const elite of [false, true]) {
    const f = fixture([{ enemyId: id, count: 1, elite }], [anchor(placementForEnemy(id), 0, 0, -18)]);
    const world = f.ctx.world = new CollisionWorld();
    world.addBox(-60, -1, -60, 60, 0, 60, 'floor');
    // A body can stand on the floor; a solid slab above its head is harmless.
    world.addBox(-2, 4, -20, 2, 5, -16, 'lintel');
    const wall = world.addBox(def.radius * (elite ? 1.25 : 1) + .14, 0, -19, 2, 3.5, -17, 'wall');
    f.advance(0, 1); assert.equal(f.warnings.length, 0, id + '/' + elite); assert.equal(f.spawns.length, 0);
    world.remove(wall); f.tick(1.3); assert.equal(f.warnings.length, 1, id + '/' + elite);
    f.tick(2.11); assert.equal(f.spawns.length, 1, id + '/' + elite);
  }
  for (const ceiling of [false, true]) for (const elite of [false, true]) {
    const f = fixture([{ enemyId: 'brute', count: 1, elite }], [anchor('assault', 0, 0, -18)]);
    const world = f.ctx.world = new CollisionWorld();
    if (ceiling) world.addBox(-2, 2.65, -20, 2, 4, -16, 'ceiling');
    else world.addBox(.88, 0, -19, 2, 4, -17, 'wall');
    f.advance(0, 2);
    assert.equal(f.spawns.length, elite ? 0 : 1, 'normal shield fits, elite shield does not: ceiling=' + ceiling);
  }
});

test('random fallback and final arrival recheck static body clearance and restart the full warning', () => {
  const f = fixture([{ enemyId: 'mortar', count: 1, elite: true }], []);
  const world = f.ctx.world = new CollisionWorld();
  const station = new THREE.Vector3(0, 0, -22), alternative = new THREE.Vector3(18, 0, -22);
  const wall = world.addBox(.7, 0, -23, 2, 3, -21, 'wall');
  f.ctx.nav.randomWalkable = (_target, _min, _max, out) => { out.copy(station); return true; };
  f.advance(0, 1); assert.equal(f.warnings.length, 0); assert.equal(f.spawns.length, 0);
  world.remove(wall); f.tick(1.3); assert.equal(f.warnings.length, 1);
  world.addBox(.7, 0, -23, 2, 3, -21, 'wall');
  f.ctx.nav.randomWalkable = (_target, _min, _max, out) => { out.copy(alternative); return true; };
  f.tick(2.11); assert.equal(f.spawns.length, 0); assert.ok(f.warnings[0].cancelled);
  f.tick(2.12); assert.equal(f.warnings.length, 2); assert.equal(f.spawns.length, 0);
  f.tick(2.91); assert.equal(f.spawns.length, 0); f.tick(2.93); assert.equal(f.spawns.length, 1);
  assert.ok(f.spawns[0].position.distanceTo(alternative) < 1e-8);
});

function simulateGenerated(L, position, arena, plans, region, firstAt) {
  const world = new CollisionWorld(), pad = L.wallThickness + 12;
  world.addBox(L.minX - pad, L.floorY - 4, L.minZ - pad, L.maxX + pad, L.floorY, L.maxZ + pad, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  let time = 0;
  const enemies = [], starts = [], warnings = [], spawns = [];
  const ctx = { world, rng: new Rng(20261004), time: { now: 0 }, run: { difficulty: 1 },
    player: { position: position.clone(), yaw: L.playerYaw },
    fx: { groundWarning(pos, _r, duration) {
      const warning = { position: pos.clone(), time, duration, end: Infinity }; warnings.push(warning);
      return () => { warning.end = time; };
    }, shake() {} }, audio: { play() {} },
    enemies: { list: enemies, aliveCount: () => enemies.filter(e => e.alive).length,
      spawn(id, options) {
        const def = bodyDefs[id], scale = options.elite ? 1.25 : 1, pos = options.position.clone();
        assert.equal(world.overlapsBody(pos.x, pos.y, pos.z, def.radius * scale + .15, def.height * scale + .1), null);
        const e = { id, alive: true, position: pos, radius: def.radius * scale, time, elite: !!options.elite,
          wave: starts.length - 1 }; enemies.push(e); spawns.push(e); return e;
      } },
  };
  ctx.nav = new NavGrid(ctx); ctx.nav.build(arena);
  ctx.nav.setRamps(L.ramps.map(r => ({ ...r, topY: L.floorY + r.top,
    foot: new THREE.Vector3(r.foot.x, L.floorY, r.foot.z), head: new THREE.Vector3(r.head.x, L.floorY + r.top, r.head.z) })));
  assert.ok(ctx.nav.isWalkable(position.x, position.z), L.adventure.designId + ': probe player must stand on the actual navigation grid at ' + position.toArray());
  assert.equal(world.overlapsBody(position.x, position.y, position.z, .4, 1.8), null, 'probe player must fit its position');
  const runner = new WaveRunner(ctx, arena, plans, firstAt, new THREE.Vector3(L.bossPoint.x, L.floorY, L.bossPoint.z),
    index => starts.push({ index, time }), region);
  for (let step = 0; step <= 400; step++) {
    time = step / 10; ctx.time.now = time;
    // Model combat completion without moving the player or bypassing queued arrivals.
    for (const e of enemies) if (time - e.time >= 2.5) e.alive = false;
    runner.update(time);
    if (runner.done) break;
  }
  const actual = spawns.length, expected = total(plans);
  const arrivals = starts.map(s => spawns.filter(e => e.wave === s.index).map(e => e.time - s.time));
  for (const e of spawns) {
    const warning = warnings.find(w => w.position.distanceTo(e.position) < 1e-8 && w.end === e.time && e.time - w.time >= .8 - 1e-7);
    assert.ok(warning && e.time - warning.time >= .8 - 1e-7, 'generated stage must retain its complete visible warning');
  }
  return { actual, expected, done: runner.done, elapsed: time, spawns,
    first: arrivals.flatMap(a => a.length ? [Math.min(...a)] : []),
    last: arrivals.flatMap(a => a.length ? [Math.max(...a)] : []),
    pending: runner.pending.map(p => ({ id: p.id, elite: p.elite, role: p.placement, pos: p.pos?.toArray() ?? null })) };
}

function altarEntrance(L, arena, desired) {
  // Choose a legal standing cell on the approach, rather than assume every
  // fractional point three metres from the objective occupies a clear nav cell.
  const world = new CollisionWorld();
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const nav = new NavGrid({ world, time: { now: 0 }, rng: new Rng(20261004), enemies: { list: [] } }); nav.build(arena);
  const point = desired.clone();
  if (!nav.isWalkable(point.x, point.z)) assert.ok(nav.nearestWalkable(desired, point), 'altar approach needs a legal standing cell');
  assert.ok(point.distanceTo(desired) <= 1.5 && point.distanceTo(arena.center) <= 4.1, L.adventure.designId + ': entry probe ' + desired.toArray() + '→' + point.toArray() + ' must stay on the approach and inside altar interaction range of ' + arena.center.toArray());
  assert.equal(world.overlapsBody(point.x, point.y, point.z, .4, 1.8), null);
  return point;
}

test('seed 20261004: all generated encounter centres and altar entrances flush every real wave, including elite shields', t => {
  const failures = [], summaries = [], first = [], last = [];
  let scenarios = 0, complete = 0, eliteShields = 0;
  const v = (p, L) => new THREE.Vector3(p.x, L.floorY, p.z);
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 4; index++) {
    const node = stage(chapter, index);
    const L = generateLevel(new Rng(20261004 ^ (chapter * 7919 + index * 104729 + 17)), node, { adventure: true });
    assert.ok(L.adventure?.encounters?.length, 'the probe must test the actual semi-open layout');
    const base = { minX: L.minX, minZ: L.minZ, maxX: L.maxX, maxZ: L.maxZ, floorY: L.floorY,
      center: v(L.adventure.objective, L), spawnPoints: L.spawnPoints.map(p => v(p, L)),
      spawnAnchors: L.adventure.spawnAnchors.map(a => ({ position: v(a, L), role: a.role, lane: a.lane })) };
    let population = 0;
    const check = (label, pos, arena, plans, region, firstAt) => {
      const result = simulateGenerated(L, pos, arena, plans, region, firstAt); scenarios++;
      if (result.actual !== result.expected || !result.done) failures.push({ slot: (chapter + 1) + '-' + (index + 1), label, ...result });
      else complete++;
      first.push(...result.first); last.push(...result.last);
      eliteShields += result.spawns.filter(e => e.id === 'brute' && e.elite).length;
      return result;
    };
    for (const [ordinal, e] of L.adventure.encounters.entries()) {
      const anchors = e.anchors.map(a => ({ position: v(a, L), role: a.role, lane: a.lane }));
      const arena = { ...base, center: v(e, L), spawnPoints: anchors.map(a => a.position), spawnAnchors: anchors };
      const plans = buildEncounterWaves({ rng: new Rng(20261004) }, node, e.kind, ordinal); population += total(plans);
      check(e.id, v(e, L), arena, plans, { center: arena.center, minRadius: 0, maxRadius: e.arenaRadius, minPlayerDistance: 10 }, .4);
    }
    const approach = L.adventure.paths.find(path => path.points.at(-1).x === L.adventure.objective.x && path.points.at(-1).z === L.adventure.objective.z);
    assert.ok(approach, 'altar entrance must come from an actual route');
    const direction = v(approach.points.at(-2), L).sub(base.center).normalize();
    const entrance = altarEntrance(L, base, base.center.clone().addScaledVector(direction, 3));
    const region = { center: base.center, minRadius: 12, maxRadius: 23, minPlayerDistance: 12 };
    const plans = buildWaves({ rng: new Rng(20261004) }, node); population += total(plans);
    check('altar-entrance', entrance, base, plans, region, 2);
    // Elite branch keeps the same real geometry, and may promote the wide shield body.
    const elitePlans = buildWaves({ rng: new Rng(20261004) }, { ...node, type: 'elite' });
    check('elite-altar-entrance', entrance, base, elitePlans, region, 2);
    const shieldWave = plans.find(w => w.entries.some(e => e.enemyId === 'brute'));
    if (shieldWave) {
      const shield = shieldWave.entries.find(e => e.enemyId === 'brute');
      check('elite-shield-clearance', entrance, base,
        [{ entries: [{ ...shield, count: 1, elite: true }], triggerRemaining: 0 }], region, 2);
    }
    assert.ok(population >= 18 && population <= 30, 'real generated encounters + altar exceed the slot population budget');
    summaries.push((chapter + 1) + '-' + (index + 1) + ':' + population);
  }
  assert.equal(failures.length, 0, JSON.stringify(failures)); assert.ok(eliteShields > 0, 'wide elite bodies must actually arrive');
  t.diagnostic('Generated population ' + summaries.join(' '));
  t.diagnostic('Completed ' + complete + '/' + scenarios + ' fixed-position simulations; elite shields=' + eliteShields
    + '; wave start→first=' + Math.min(...first).toFixed(1) + '..' + Math.max(...first).toFixed(1)
    + 's; wave start→last=' + Math.min(...last).toFixed(1) + '..' + Math.max(...last).toFixed(1) + 's');
});
