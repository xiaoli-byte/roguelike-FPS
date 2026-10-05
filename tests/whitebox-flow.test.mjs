import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return moduleUrl(source + '\n//# sourceURL=' + new URL(path, import.meta.url).href);
}
const rngUrl = await ts('../src/core/Rng.ts');
const { Rng } = await import(rngUrl);
const plansUrl = await ts('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS } = await import(plansUrl);
const genUrl = await ts('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl });
const { generateWhitebox, whiteboxPoint } = await import(genUrl);
const encountersUrl = await ts('../src/world/WhiteboxEncounters.ts', { './WhiteboxGen': genUrl });
const { WHITEBOX_SQUADS, buildWhiteboxFights, buildWhiteboxAdventure, whiteboxPlansForApproach, whiteboxSpawnRegion } = await import(encountersUrl);
const bodyDefs = Object.fromEntries(await Promise.all([
  ...['Grunt', 'Archer', 'Bomber', 'Brute', 'Wisp', 'Shaman', 'Mortar', 'Marksman'].map(name => [name.toLowerCase(), 'types/' + name]),
  ['boss_colossus', 'bosses/Colossus'], ['boss_matriarch', 'bosses/Matriarch'], ['boss_warlord', 'bosses/Warlord'],
].map(async ([id, path]) => {
  const source = await readFile(new URL(`../src/enemies/${path}.ts`, import.meta.url), 'utf8');
  return [id, { radius: Number(source.match(/radius:\s*([\d.]+)/)[1]), height: Number(source.match(/height:\s*([\d.]+)/)[1]), isBoss: id.startsWith('boss_') }];
})));
const registryUrl = moduleUrl(`const defs=${JSON.stringify(bodyDefs)}; export function getEnemyDef(id){return defs[id];}`);
const waveUrl = await ts('../src/world/WaveRunner.ts', { '../enemies/Registry': registryUrl });
const { WaveRunner } = await import(waveUrl);
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
const navUrl = await ts('../src/world/NavGrid.ts', { '../core/math': await ts('../src/core/math.ts') });
const { NavGrid } = await import(navUrl);
const directorUrl = await ts('../src/world/StageDirector.ts', {
  '../core/Rng': rngUrl,
  '../assets/AssetLibrary': moduleUrl('export const AssetLibrary={enabled:true};'),
  '../enemies/Waves': moduleUrl('export function buildWaves(){throw new Error("Unexpected generic wave");} export function buildEncounterWaves(){throw new Error("Unexpected generic encounter");}'),
  './ArenaBuilder': moduleUrl(`import * as THREE from '${threeUrl}'; export function addCollision(world,L){for(const b of L.boxes)world.addBox(b.minX,b.minY,b.minZ,b.maxX,b.maxY,b.maxZ,b.tag,b.noRaycast);} export class ArenaView {group=new THREE.Group();update(){}dispose(){this.group.removeFromParent();}}`),
  './LevelGen': moduleUrl('export function generateLevel(){throw new Error("Unexpected legacy map");}'),
  './NavGrid': navUrl,
  './Portal': moduleUrl('export class Portal{constructor(ctx,node,position){ctx.portals.push({node,position});}update(){}dispose(){}}'),
  './Themes': moduleUrl('export function themeDef(id){return {id,name:id};}'),
  './WaveRunner': waveUrl,
  './AdventureBeacon': moduleUrl('export class AdventureBeacon{constructor(){throw new Error("Whitebox must not add a duplicate altar");}}'),
  './WhiteboxMode': moduleUrl('export function usesAuthoredLayout(){return true;}'),
  './WhiteboxGen': genUrl,
  './WhiteboxEncounters': encountersUrl,
});
const { StageDirector } = await import(directorUrl);
const chapter = theme => ['desert', 'frost', 'inferno'].indexOf(theme);
const nodeFor = (plan, type = plan.index === 5 ? 'boss' : 'combat') => ({ chapter: chapter(plan.chapter), index: plan.index - 1, type, theme: plan.chapter, reward: 'coins' });
const total = fight => fight.plans.flatMap(w => w.entries).reduce((n, e) => n + e.count, 0);
function context() {
  let time = 0;
  const events = [], warnings = [], spawns = [], chests = [], handlers = new Map();
  const ctx = {
    rng: new Rng(20261004), time: { now: 0 }, run: { seed: 20261004, difficulty: 1, stagesCleared: 0, essence: 0 },
    game: { state: 'playing', endRun() {} }, scene: new THREE.Scene(), stageGroup: new THREE.Group(),
    player: { alive: true, position: new THREE.Vector3(), yaw: 0, invulnerableTime: 0,
      teleport(p, yaw) { this.position.copy(p); this.yaw = yaw; }, heal() {}, maxHp() { return 100; } },
    world: new CollisionWorld(), nav: null, portals: [],
    loot: { spawnChest(position, reward) { chests.push({ position: position.clone(), reward }); }, spawnShop() {} },
    ui: { toast() {}, setBoss() {}, banner() {} }, audio: { play() {} },
    fx: { shake() {}, ring() {}, spawnEffect() {}, groundWarning(position, radius, duration) {
      const w = { position: position.clone(), radius, duration, time, cancelled: false }; warnings.push(w);
      return () => { w.cancelled = true; };
    } },
    events: { on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
      emit(name, payload) { events.push({ name, payload }); for (const fn of handlers.get(name) ?? []) fn(payload); } },
    enemies: { list: [], aliveCount() { return this.list.filter(e => e.alive).length; },
      spawn(id, options) {
        const enemy = { id, alive: true, isBoss: id.startsWith('boss_'), displayName: id, position: options.position.clone(),
          velocity: new THREE.Vector3(), radius: bodyDefs[id].radius, def: bodyDefs[id], time, options };
        this.list.push(enemy); spawns.push(enemy); ctx.events.emit('enemy:spawned', { enemy }); return enemy;
      }, killAll() { for (const enemy of this.list) if (enemy.alive) { enemy.alive = false; ctx.events.emit('enemy:killed', { enemy }); } } },
    runPlan: { nextOptions: () => [{ chapter: 0, index: 1, type: 'combat', reward: 'coins', theme: 'desert' }],
      isFinalStage: () => false, rewardLabel: r => r },
  };
  ctx.nav = new NavGrid(ctx);
  const director = new StageDirector(ctx); ctx.stage = director; director.init();
  function advance(seconds) {
    const count = Math.ceil(seconds / .05);
    for (let i = 0; i < count; i++) { time += seconds / count; ctx.time.now = time; director.update(seconds / count); }
  }
  return { ctx, director, advance, events, warnings, spawns, chests };
}
function enter(fixture, fight) {
  fixture.ctx.player.position.set(fight.facing.x, 0, fight.facing.z);
  fixture.advance(.1);
  assert.equal(fixture.director.exploration.encounters.find(e => e.id === fight.id).phase, 'active', `trigger ${fixture.director.whitebox.planId}/${fight.id}/${fight.room}`);
}
function verifySpawns(f, fight, initial) {
  const records = f.spawns.slice(initial);
  assert.equal(records.length, total(fight), `${f.director.whitebox.planId}/${fight.id} roster count`);
  for (const e of records) {
    const scale = e.options.elite ? 1.25 : 1, width = e.def.radius * scale + .15;
    assert.ok(fight.contains(e.position, width), `${e.id} must fit wholly in ${fight.room}`);
    assert.ok(!f.ctx.world.overlapsBody(e.position.x, e.position.y, e.position.z, width, e.def.height * scale + .1), `${e.id} full body clearance`);
    assert.ok(e.position.distanceTo(f.ctx.player.position) >= 10 - 1e-6, '10 m warning safety gap');
    const warning = f.warnings.find(w => w.position.distanceTo(e.position) < .001 && e.time - w.time >= (e.isBoss ? 1 : .8) - 1e-6);
    assert.ok(warning, `${e.id} has its complete on-screen warning`);
  }
}

/** Real dynamic obstacles leave only a 10×10m pocket around the player.
 * Every point in this pocket is <10m away, so the actual NavGrid, body query
 * and room-bound spawn scheduler must wait instead of selecting a close station.
 */
function closeDistantStations(f, player) {
  const a = f.director.arena, r = 5, y = a.floorY;
  const bounds = [
    [a.minX, a.minZ, player.x - r, a.maxZ], [player.x + r, a.minZ, a.maxX, a.maxZ],
    [player.x - r, a.minZ, player.x + r, player.z - r], [player.x - r, player.z + r, player.x + r, a.maxZ],
  ];
  const blockers = bounds.map(([x0, z0, x1, z1]) => f.ctx.world.addBox(x0, y, z0, x1, y + 4, z1, 'test-temporary-blocker'));
  f.ctx.nav.build(a);
  return () => { blockers.forEach(box => f.ctx.world.remove(box)); f.ctx.nav.build(a); };
}

test('all 15 whitebox maps load real authored encounters and clear exactly once without generic altar waves', t => {
  assert.equal(WHITEBOX_PLANS.length, 15);
  const populations = [];
  for (const plan of WHITEBOX_PLANS) {
    const f = context(), node = nodeFor(plan); f.director.load(node);
    const layout = generateWhitebox(node), fights = buildWhiteboxFights(layout, node);
    assert.equal(f.director.whitebox.planId, plan.id);
    assert.deepEqual(f.director.exploration.encounters.map(e => e.id), plan.encounters.map(e => e.id));
    f.advance(4); assert.equal(f.spawns.length, 0, `${plan.id} arrival must be safe, including boss maps`);
    const seen = new Set();
    for (const fight of fights) {
      if (seen.has(fight.id)) continue; seen.add(fight.id);
      const initial = f.spawns.length; enter(f, fight); f.advance(5);
      verifySpawns(f, fight, initial);
      f.ctx.enemies.killAll(); f.advance(fight.final ? 5 : 2);
      assert.equal(f.director.exploration.encounters.find(e => e.id === fight.id).phase, 'cleared');
      if (!fight.final) assert.equal(f.ctx.run.stagesCleared, 0, 'route fights never settle the stage');
    }
    assert.equal(f.director.cleared, true, plan.id);
    assert.equal(f.ctx.run.stagesCleared, 1); assert.equal(f.ctx.portals.length, 1);
    const count = f.spawns.length; f.advance(15); assert.equal(f.spawns.length, count, 'no duplicate end fight');
    assert.equal(f.events.filter(e => e.name === 'stage:cleared').length, 1);
    assert.equal(f.ctx.portals.length, 1, 'exit opens once'); f.director.unload();
    populations.push(`${plan.id}:${count}`);
  }
  t.diagnostic('Authored route populations (alternative warehouse counted once): ' + populations.join(' '));
});

test('elite branches preserve authored population and every promoted body can arrive inside its room', () => {
  for (const plan of WHITEBOX_PLANS.filter(p => p.index < 5)) {
    const node = nodeFor(plan, 'elite'), L = generateWhitebox(node), fights = buildWhiteboxFights(L, node);
    const f = context(); f.director.load(node); f.advance(3);
    const seen = new Set();
    for (const fight of fights) {
      if (seen.has(fight.id)) continue; seen.add(fight.id);
      assert.equal(total(fight), WHITEBOX_SQUADS[plan.id][fight.id].reduce((n, entry) => n + entry[1], 0));
      const initial = f.spawns.length; enter(f, fight); f.advance(5); verifySpawns(f, fight, initial);
      assert.ok(f.spawns.slice(initial).some(e => e.options.elite));
      f.ctx.enemies.killAll(); f.advance(fight.final ? 5 : 2);
    }
    assert.equal(f.director.cleared, true); f.director.unload();
  }
});

test('guarded optional supplies unlock once, other rooms cannot overlap encounters, and final fight can skip optional patrols', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'inferno-2'), node = nodeFor(plan), f = context(); f.director.load(node);
  const fights = buildWhiteboxFights(generateWhitebox(node), node), guard = fights.find(e => e.id === 'B');
  const supply = f.director.exploration.sites[1];
  f.ctx.player.position.copy(supply.position); f.advance(.1);
  assert.equal(supply.visited, false); assert.equal(f.chests.length, 0);
  // Re-enter from the marked approach, giving the complete room its intended separation.
  f.ctx.player.position.set(guard.facing.x, 0, guard.facing.z); f.advance(5);
  const final = fights.find(e => e.final); f.ctx.player.position.set(final.facing.x, 0, final.facing.z); f.advance(.2);
  assert.equal(f.director.exploration.encounters.find(e => e.id === final.id).phase, 'undiscovered');
  f.ctx.enemies.killAll(); f.advance(2); f.ctx.player.position.copy(supply.position); f.advance(.1);
  assert.equal(supply.visited, true); assert.equal(f.chests.length, 1); f.advance(.2); assert.equal(f.chests.length, 1);
  enter(f, final); f.advance(5); f.ctx.enemies.killAll(); f.advance(3);
  assert.equal(f.director.cleared, true); assert.equal(f.spawns.length, total(guard) + total(final));
});

test('authored north-warehouse alternative shares one quota and cloister changes the same two enemy slots', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'desert-2'), node = nodeFor(plan), f = context(); f.director.load(node);
  const fights = buildWhiteboxFights(generateWhitebox(node), node), variants = fights.filter(e => e.id === 'B');
  assert.equal(variants.length, 2);
  const north = variants.find(e => e.room === 'north'); enter(f, north); f.advance(5); verifySpawns(f, north, 0);
  f.ctx.enemies.killAll(); f.advance(2); f.ctx.player.position.set(variants[0].facing.x, 0, variants[0].facing.z); f.advance(5);
  assert.equal(f.spawns.length, total(north), 'north warehouse and well cannot each spawn the same quota');
  const temple = WHITEBOX_PLANS.find(p => p.id === 'desert-4'), L = generateWhitebox(nodeFor(temple));
  const B = buildWhiteboxFights(L, nodeFor(temple)).find(e => e.id === 'B');
  const connection = temple.passages.find(p => [p.from, p.to].includes('cloister') && [p.from, p.to].includes(B.room));
  assert.ok(connection, 'cloister approach remains authored in the floor plan');
  const route = connection.from === 'cloister' ? connection.points : [...connection.points].reverse();
  let threshold = null;
  for (let i = 1; i < route.length && !threshold; i++) {
    const a = route[i - 1], b = route[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
    for (let j = 0; j <= steps; j++) {
      const p = whiteboxPoint(temple, [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
      if (B.contains(p)) { threshold = p; break; }
    }
  }
  assert.ok(threshold, 'authored connection crosses the actual encounter room');
  const plans = whiteboxPlansForApproach(B, L, threshold);
  assert.equal(plans[0].entries.find(e => e.enemyId === 'bomber').count, 2);
  assert.equal(B.plans[0].entries.find(e => e.enemyId === 'grunt').count, 2, 'source quota is immutable');
});

test('quiet branches retain all authored footprints while spawning no combat or boss', () => {
  for (const plan of WHITEBOX_PLANS) for (const type of ['shop', 'treasure']) {
    const node = nodeFor(plan, type), f = context(); f.director.load(node); f.advance(3);
    assert.equal(f.director.whitebox.planId, plan.id); assert.equal(f.director.exploration.title, plan.title);
    for (const room of plan.rooms) { const p = whiteboxPoint(plan, room.labelAt); f.ctx.player.position.set(p.x, 0, p.z); f.advance(.5); }
    assert.equal(f.spawns.length, 0); assert.equal(f.ctx.run.stagesCleared, 1); assert.equal(f.ctx.portals.length, 1);
    f.director.unload();
  }
});

test('regional spawn safety rejects a neighbouring room inside the same radius and rechecks moving-player boss warnings', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'inferno-5'), node = nodeFor(plan), L = generateWhitebox(node);
  const fight = buildWhiteboxFights(L, node)[0], f = context(); f.director.load(node);
  enter(f, fight); f.advance(.5);
  const warning = f.warnings.find(w => w.radius === 3.4); assert.ok(warning);
  f.ctx.player.position.copy(warning.position); f.advance(1.05);
  assert.equal(f.spawns.length, 0, 'boss must reselect and display a new full warning when the player steps onto it');
  f.ctx.player.position.set(fight.facing.x, 0, fight.facing.z); f.advance(5);
  assert.equal(f.spawns.length, 1);
  const region = whiteboxSpawnRegion(fight, 0), other = whiteboxPoint(plan, plan.entry.at);
  assert.equal(region.contains(new THREE.Vector3(other.x, 0, other.z), .9), false);
  assert.equal(Object.keys(WHITEBOX_SQUADS).length, 15);
});

test('actual whitebox recovery keeps the 10 m gap and defers while distant canyon stations are blocked', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'desert-1'), node = nodeFor(plan), f = context(); f.director.load(node);
  const fight = buildWhiteboxFights(generateWhitebox(node), node)[0]; enter(f, fight); f.advance(5);
  const enemy = f.spawns[0]; f.spawns[1].alive = false;
  const checkRecovered = () => {
    assert.ok(enemy.position.distanceTo(f.ctx.player.position) >= 10, 'recovery cannot teleport an enemy onto the player');
    assert.ok(fight.contains(enemy.position, enemy.radius + .15), 'recovery stays in the encounter room');
    assert.ok(!f.ctx.world.overlapsBody(enemy.position.x, 0, enemy.position.z, enemy.radius + .15, enemy.def.height + .1));
    assert.ok(enemy.position.y >= 0);
  };
  // A vertical out-of-world failure directly beneath the player makes the original
  // nearestWalkable proposal unsafe; this exercises antiStuck, not a helper mock.
  enemy.position.copy(f.ctx.player.position); enemy.position.y = -10; f.advance(.6); checkRecovered();
  // The expanded canyon normally has distant stations. Dynamically close those
  // stations, preserving a valid standing pocket and the genuine recovery query.
  const reopen = closeDistantStations(f, f.ctx.player.position);
  assert.ok(!f.ctx.world.overlapsBody(f.ctx.player.position.x, 0, f.ctx.player.position.z, .4, 1.8));
  enemy.position.copy(f.ctx.player.position); enemy.position.y = -10;
  f.advance(.6); assert.equal(enemy.position.y, -10, 'wait instead of using a close station');
  reopen(); f.advance(.6); checkRecovered();
  // A surviving nearby enemy also takes the actual 30 s straggler path.
  enemy.position.copy(f.ctx.player.position).add(new THREE.Vector3(1, 0, 0));
  f.advance(32); checkRecovered(); f.director.unload();
});

test('whitebox director exposes a blocked station and clears the hint as soon as a full warning can start', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'desert-1'), node = nodeFor(plan), f = context(); f.director.load(node);
  const fight = buildWhiteboxFights(generateWhitebox(node), node)[0]; enter(f, fight);
  assert.equal(f.director.exploration.spawnBlocked, false, 'initial gathering delay is ordinary progress');
  const reopen = closeDistantStations(f, f.ctx.player.position); f.advance(1.3);
  assert.equal(f.director.exploration.spawnBlocked, true); assert.equal(f.spawns.length, 0);
  reopen(); f.advance(.3);
  assert.equal(f.director.exploration.spawnBlocked, false); assert.equal(f.spawns.length, 0, 'full warnings remain visible');
  f.advance(2); assert.equal(f.spawns.length, total(fight)); f.director.unload();
});
