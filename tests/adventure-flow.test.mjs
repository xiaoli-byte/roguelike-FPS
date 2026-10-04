import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const rngUrl = await tsModule('../src/core/Rng.ts');
const { Rng } = await import(rngUrl);
const registryUrl = dataModule("export function getEnemyDef(id){ return {isBoss:id.startsWith('boss_')}; }");
const waveUrl = await tsModule('../src/world/WaveRunner.ts', { '../enemies/Registry': registryUrl });
const { WaveRunner } = await import(waveUrl);
const beaconUrl = await tsModule('../src/world/AdventureBeacon.ts');
const { AdventureBeacon } = await import(beaconUrl);
const directorUrl = await tsModule('../src/world/StageDirector.ts', {
  '../core/Rng': rngUrl,
  '../assets/AssetLibrary': dataModule('export const AssetLibrary = { get enabled() { return globalThis.__adventureAssetsEnabled !== false; } };'),
  '../enemies/Waves': dataModule("export function buildWaves(ctx,stage){return [{entries:[{enemyId:stage.type==='boss'?'boss_test':'grunt',count:2}],triggerRemaining:0}];} export function buildEncounterWaves(){return [{entries:[{enemyId:'grunt',count:3,placement:'assault'}],triggerRemaining:0,label:'通道守卫',hint:'利用侧路接近'}];}"),
  './ArenaBuilder': dataModule(`import * as THREE from '${threeUrl}'; export function addCollision(){} export class ArenaView {group=new THREE.Group(); update(){} dispose(){this.group.removeFromParent();}}`),
  './LevelGen': dataModule('export function generateLevel(rng,stage,options){ globalThis.__adventureGenerationOptions = options; const layout = structuredClone(globalThis.__adventureLayoutFixture); if(options.adventure === false) delete layout.adventure; return layout; }'),
  './NavGrid': dataModule('export class NavGrid {}'),
  './Portal': dataModule('export class Portal { constructor(ctx,node,position){this.ctx=ctx;this.node=node;ctx.portalRecords.push(this);}update(){}dispose(){this.disposed=true;} }'),
  './Themes': dataModule('export function themeDef(id){return {id,name:id};}'),
  './WaveRunner': waveUrl,
  './AdventureBeacon': beaconUrl,
  './WhiteboxMode': dataModule('export function usesAuthoredLayout(){return false;}'),
  './WhiteboxGen': dataModule('export function generateWhitebox(){throw new Error("Unexpected whitebox generation");}'),
  './WhiteboxEncounters': dataModule('export function buildWhiteboxAdventure(){} export function buildWhiteboxFights(){return [];} export function whiteboxPlansForApproach(){} export function whiteboxSpawnRegion(){}'),
});
const { StageDirector } = await import(directorUrl);

// Canvas drawing is presentation-only. THREE meshes, beacons, director and scheduler remain real.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {},
}) }) };

function layout(adventure = true) {
  const points = Array.from({ length: 16 }, (_, i) => ({ x: Math.cos(i * Math.PI / 8) * 18, z: Math.sin(i * Math.PI / 8) * 18 }));
  return {
    floorY: 0, minX: -64, minZ: -64, maxX: 64, maxZ: 64, half: 64,
    playerSpawn: { x: 0, z: 53 }, playerYaw: 0, spawnPoints: points,
    rewardPoint: { x: 1, z: 3 }, portalPoints: [{ x: -11, z: -52 }, { x: 0, z: -52 }, { x: 11, z: -52 }],
    shopPoint: { x: 0, z: 0 }, bossPoint: { x: 0, z: -9 }, center: { x: 0, z: 0 }, ramps: [], boxes: [],
    ...(adventure ? { adventure: { objective: { x: 0, z: 0 },
      sites: [{ id: 'supply', label: '补给营地', x: -30, z: 12, reward: 'coins' },
        { id: 'cache', label: '遗迹暗藏', x: 28, z: -26, reward: 'weapon' },
        { id: 'shrine', label: '隐秘神龛', x: -38, z: -25, reward: 'scroll' }],
      zones: [{ id: 'central', label: '祭坛', x: 0, z: 0, radius: 24 }],
      paths: [{ points: [{ x: 0, z: 53 }, { x: 0, z: 0 }], width: 6 }], rocks: [],
    } } : {}),
  };
}

function context() {
  const handlers = new Map(), items = [], chestRecords = [], spawnRecords = [], warningRecords = [], bannerRecords = [], events = [];
  const ctx = {
    rng: new Rng(20261005), run: { seed: 1234, difficulty: 1, stagesCleared: 0, essence: 0 },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), stageGroup: new THREE.Group(), game: { state: 'playing', endRun() {} },
    player: { alive: true, position: new THREE.Vector3(), yaw: 0, radius: .4, height: 1.8,
      teleport(p, yaw) { this.position.copy(p); this.yaw = yaw; }, heal() {}, maxHp() { return 100; } },
    world: { clear() {}, segmentBlocked() { return false; } }, nav: { build() {}, nearestWalkable(p, out) { return out.copy(p); },
      findPath(_from, to, out) { out.length = 0; out.push(to.clone()); return true; },
      isWalkable() { return true; }, randomWalkable(center, _min, _max, out) { out.copy(center); return true; } },
    interact: { add(item) { items.push(item); return () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); }; } },
    loot: { spawnChest(position, reward) { chestRecords.push({ position, reward }); }, spawnShop() {} },
    ui: { toast() {}, setBoss() {}, banner(...args) { bannerRecords.push(args); } }, audio: { play() {} },
    fx: { ring() {}, shake() {}, groundWarning(position, radius, duration) { warningRecords.push({ position: position.clone(), radius, duration }); } },
    events: { on(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
      emit(name, payload) { events.push({ name, payload }); for (const fn of handlers.get(name) ?? []) fn(payload); } },
    enemies: { list: [], aliveCount() { return this.list.filter(e => e.alive).length; },
      spawn(id, options) {
        const enemy = { alive: true, isBoss: id.startsWith('boss_'), position: options.position.clone(), velocity: new THREE.Vector3(), def: {} };
        this.list.push(enemy); spawnRecords.push(enemy); ctx.events.emit('enemy:spawned', { enemy });
      }, killAll() { this.list.forEach(e => { e.alive = false; }); } },
    runPlan: { nextOptions: () => [{ chapter: 0, index: 1, type: 'combat', reward: 'coins', theme: 'desert' }],
      isFinalStage: () => false, rewardLabel: r => r, stageLabel: () => '1-1' },
    portalRecords: [],
  };
  return { ctx, items, chestRecords, spawnRecords, warningRecords, bannerRecords, events };
}
const stage = { chapter: 0, index: 0, type: 'combat', reward: 'scroll', theme: 'desert' };
function advanceDirector(director, seconds) {
  const steps = Math.ceil(seconds / .05);
  for (let i = 0; i < steps; i++) director.update(seconds / steps);
}
function loadDirector(variant = stage, adventure = true, classic = false, encounters = false) {
  globalThis.__adventureAssetsEnabled = !classic;
  globalThis.__adventureLayoutFixture = layout(adventure);
  if (encounters && adventure) {
    const a = globalThis.__adventureLayoutFixture.adventure;
    a.title = '回廊测试'; a.routeHint = '两条路线通往祭坛';
    const encounter = (id, x, z, kind = 'approach', siteId) => ({ id, label: id, kind, x, z,
      triggerRadius: 8, arenaRadius: 24, siteId,
      anchors: Array.from({ length: 12 }, (_, i) => ({ x: x + Math.cos(i * Math.PI / 6) * 18,
        z: z + Math.sin(i * Math.PI / 6) * 18, role: i % 2 ? 'ranged' : 'assault', lane: i % 3 })),
    });
    a.encounters = [encounter('entry-guard', 0, 26), encounter('supply-guard', -30, 12, 'cache', 'supply'),
      encounter('east-guard', 28, -26)];
  }
  const state = context(), director = new StageDirector(state.ctx); state.ctx.stage = director;
  director.init(); director.load(variant);
  return { ...state, director };
}

test('authored route encounters trigger once, serialize combat and never settle the stage', () => {
  const { ctx, director, items, spawnRecords, events } = loadDirector(stage, true, false, true);
  director.update(20); assert.equal(spawnRecords.length, 0, 'safe arrival should stay quiet');
  assert.equal(director.exploration.title, '回廊测试');
  const [first, second] = director.exploration.encounters;
  ctx.player.position.copy(first.position); director.update(.1);
  assert.equal(first.phase, 'active'); assert.equal(director.exploration.phase, 'explore');
  advanceDirector(director, 3.5);
  assert.equal(spawnRecords.length, 3);
  ctx.player.position.copy(second.position); director.update(3);
  assert.equal(second.phase, 'undiscovered'); assert.equal(spawnRecords.length, 3, 'no concurrent route battle');
  ctx.player.position.copy(director.exploration.objective); items[0].onInteract();
  assert.equal(director.exploration.phase, 'explore'); assert.equal(items[0].enabled, true, 'altar remains available after blocked attempt');
  ctx.enemies.killAll(); director.update(.5);
  assert.equal(first.phase, 'cleared'); assert.equal(director.waveCount, 0);
  assert.equal(director.cleared, false); assert.equal(events.filter(e => e.name === 'stage:cleared').length, 0);
  ctx.player.position.copy(first.position); director.update(4); assert.equal(spawnRecords.length, 3, 'completed patrol cannot repeat');
  ctx.player.position.copy(director.exploration.objective); items[0].onInteract();
  assert.equal(director.exploration.phase, 'battle');
});

test('guarded supplies unlock only after their encounter and are awarded exactly once', () => {
  const { ctx, director, chestRecords } = loadDirector(stage, true, false, true);
  const site = director.exploration.sites[0], guard = director.exploration.encounters[1];
  ctx.player.position.copy(site.position); director.update(.1);
  assert.equal(guard.phase, 'active'); assert.equal(site.visited, false); assert.equal(chestRecords.length, 0);
  advanceDirector(director, 3.5); ctx.enemies.killAll(); director.update(.5);
  assert.equal(guard.phase, 'cleared'); assert.equal(site.visited, true);
  assert.equal(chestRecords.filter(c => c.reward === 'coins').length, 1);
  director.update(30); assert.equal(chestRecords.filter(c => c.reward === 'coins').length, 1);
});

test('a nearby patrol behind a wall cannot trigger before the player enters its visible approach', () => {
  const { ctx, director, spawnRecords } = loadDirector(stage, true, false, true);
  const first = director.exploration.encounters[0]; ctx.player.position.copy(first.position);
  ctx.world.segmentBlocked = () => true;
  advanceDirector(director, 4); assert.equal(first.phase, 'undiscovered'); assert.equal(spawnRecords.length, 0);
  ctx.world.segmentBlocked = () => false;
  advanceDirector(director, 4); assert.equal(first.phase, 'active'); assert.equal(spawnRecords.length, 3);
});

test('unload cancels route telegraphs and resets encounter progress independently of old references', () => {
  const { ctx, director, spawnRecords } = loadDirector(stage, true, false, true);
  const old = director.exploration.encounters[0];
  ctx.player.position.copy(old.position); director.update(.1); director.update(.41);
  director.unload(); director.update(10); assert.equal(spawnRecords.length, 0);
  director.load(stage); assert.equal(director.exploration.encounters[0].phase, 'undiscovered');
  assert.notEqual(director.exploration.encounters[0], old);
  director.update(10); assert.equal(spawnRecords.length, 0);
});

test('completing the altar disperses unopened patrols without granting remote cache rewards', () => {
  const { ctx, director, items, spawnRecords, chestRecords } = loadDirector(stage, true, false, true);
  ctx.player.position.copy(director.exploration.objective); items[0].onInteract();
  advanceDirector(director, 5); ctx.enemies.killAll(); director.update(.5);
  assert.equal(director.exploration.phase, 'cleared');
  assert.ok(director.exploration.encounters.every(e => e.phase === 'cleared'));
  assert.equal(chestRecords.filter(c => c.reward === 'coins').length, 0);
  const count = spawnRecords.length;
  ctx.player.position.copy(director.exploration.sites[0].position); director.update(5);
  assert.equal(spawnRecords.length, count); assert.equal(chestRecords.filter(c => c.reward === 'coins').length, 1);
});

test('adventure permits exploration indefinitely and schedules first wave relative to altar activation', () => {
  const { ctx, director, items, spawnRecords, warningRecords } = loadDirector();
  director.update(90);
  assert.equal(director.exploration.phase, 'explore'); assert.equal(director.waveCount, 0);
  assert.equal(spawnRecords.length, 0); assert.equal(warningRecords.length, 0);
  assert.equal(items.length, 1); assert.equal(items[0].prompt().key, 'F');
  ctx.player.position.copy(director.exploration.objective);
  items[0].onInteract(); items[0].onInteract();
  assert.equal(director.exploration.phase, 'battle'); assert.equal(items[0].enabled, false);
  director.update(1.99); assert.equal(warningRecords.length, 0);
  director.update(.02); assert.ok(warningRecords.length > 0); assert.equal(spawnRecords.length, 0);
  advanceDirector(director, 2); assert.equal(spawnRecords.length, 2, 'repeat interaction must not schedule a second set of enemies');
});

test('classic disables regional generation and schedules the visible courtyard while normal play keeps adventure enabled', () => {
  const classic = loadDirector(stage, true, true);
  assert.deepEqual(globalThis.__adventureGenerationOptions, { adventure: false });
  assert.equal(classic.director.exploration, null); assert.equal(classic.items.length, 0);
  advanceDirector(classic.director, 4.1);
  assert.equal(classic.spawnRecords.length, 2, 'courtyard should retain automatic wave progression');
  classic.director.unload();
  const normal = loadDirector();
  assert.deepEqual(globalThis.__adventureGenerationOptions, { adventure: true });
  assert.equal(normal.director.exploration.phase, 'explore'); assert.equal(normal.items.length, 1);
  normal.director.update(5); assert.equal(normal.spawnRecords.length, 0);
  normal.director.unload();
});

test('each optional cache is discovered once, after clearance discovery remains available', () => {
  const { ctx, director, chestRecords, events } = loadDirector();
  const sites = director.exploration.sites;
  ctx.player.position.copy(sites[0].position); director.update(.05);
  director.update(.05); ctx.player.position.set(0, 0, 53); director.update(.05);
  ctx.player.position.copy(sites[0].position); director.update(.05);
  assert.equal(chestRecords.length, 1); assert.equal(chestRecords[0].reward, 'coins'); assert.equal(sites[0].visited, true);
  director.onCleared();
  ctx.player.position.copy(sites[1].position); director.update(.05); director.update(.05);
  assert.equal(chestRecords.filter(c => c.reward === 'weapon').length, 1);
  assert.equal(events.filter(e => e.name === 'stage:cleared').length, 1);
});

test('altar battle clear settles once, awards main reward and opens existing chapter exits', () => {
  const { ctx, director, items, chestRecords, events } = loadDirector();
  ctx.player.position.set(0, 0, 0); items[0].onInteract(); advanceDirector(director, 4.1);
  ctx.enemies.killAll(); director.update(.5);
  assert.equal(director.cleared, true); assert.equal(director.exploration.phase, 'cleared');
  assert.equal(ctx.run.stagesCleared, 1); assert.equal(ctx.run.essence, 10);
  assert.equal(chestRecords.filter(c => c.reward === 'scroll').length, 1);
  director.update(2); director.update(5); director.onCleared();
  assert.equal(events.filter(e => e.name === 'stage:cleared').length, 1);
  assert.equal(ctx.portalRecords.length, 1); assert.equal(ctx.portalRecords[0].node.index, 1);
  assert.equal(director.exploration.exit.z, -52); assert.equal(director.exploration.exit.x, 0);
});

test('unload cancels pending combat, removes interaction and isolates exploration records on next load', () => {
  const { ctx, director, items, spawnRecords } = loadDirector();
  const oldItem = items[0], oldState = director.exploration;
  ctx.player.position.copy(oldState.sites[0].position); director.update(.1);
  oldItem.onInteract(); director.update(2.1); director.unload(); oldItem.onInteract(); director.update(10);
  assert.equal(items.length, 0); assert.equal(director.exploration, null); assert.equal(spawnRecords.length, 0);
  director.load(stage); assert.equal(director.exploration.sites[0].visited, false);
  assert.notEqual(director.exploration, oldState); assert.equal(director.exploration.phase, 'explore');
});

test('boss and free stages preserve their immediate scheduling and settlement', () => {
  const boss = loadDirector({ ...stage, type: 'boss' }, false);
  assert.equal(boss.director.exploration, null); advanceDirector(boss.director, 3.6);
  assert.equal(boss.spawnRecords.length, 2);
  const treasure = loadDirector({ ...stage, type: 'treasure', reward: 'coins' }, false);
  assert.equal(treasure.chestRecords.length, 1); treasure.director.update(.01);
  assert.equal(treasure.ctx.run.stagesCleared, 1); assert.equal(treasure.director.exploration, null);
  treasure.director.update(1); assert.equal(treasure.ctx.portalRecords.length, 1);
});

test('beacon cannot activate while dead or paused and unregisters cleanly after disposal', () => {
  const { ctx, items } = context(); let activates = 0;
  const beacon = new AdventureBeacon(ctx, new THREE.Vector3(), ctx.stageGroup, () => { activates++; return true; });
  ctx.player.alive = false; items[0].onInteract(); ctx.player.alive = true;
  ctx.game.state = 'paused'; items[0].onInteract(); assert.equal(activates, 0);
  ctx.game.state = 'playing'; items[0].onInteract(); items[0].onInteract(); assert.equal(activates, 1);
  beacon.dispose(); beacon.dispose(); assert.equal(items.length, 0); assert.equal(beacon.group.parent, null);
});

test('beacon label fades for the viewing camera while phase text updates only on transition', () => {
  const { ctx } = context(), painted = [];
  const originalDocument = globalThis.document;
  const paint = { clearRect() {}, fillRect() {}, strokeRect() {},
    fillText(text) { painted.push({ text, border: this.strokeStyle }); } };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => paint }) };
  try {
    const objective = new THREE.Vector3(7, 0, -11);
    ctx.camera.position.set(7, 1.7, -3);
    const beacon = new AdventureBeacon(ctx, objective, ctx.stageGroup, () => true);
    const label = beacon.group.children.find(o => o instanceof THREE.Sprite);
    const texture = label.material.map, firstVersion = texture.version;
    assert.equal(label.material.opacity, 1); assert.equal(label.scale.x, 4.8);
    assert.equal(painted.at(-1).text, '探索支路 · 准备后启动');
    ctx.camera.position.z = -6.3; beacon.update(.05, 1);
    assert.ok(Math.abs(label.material.opacity - .5) < 1e-10, 'middle of distance fade should remain smooth');
    ctx.camera.position.z = -8; beacon.update(.05, 2);
    assert.equal(label.material.opacity, 0, 'three metre near view must not be obscured by the billboard');
    assert.equal(texture.version, firstVersion, 'distance changes must not redraw/upload the canvas');
    beacon.setPhase('battle'); const battleVersion = texture.version;
    assert.equal(battleVersion, firstVersion + 1); assert.equal(painted.at(-1).text, '试炼进行中 · 清除守卫');
    assert.equal(painted.at(-1).border, '#ff7156');
    beacon.setPhase('battle'); beacon.update(.05, 3); assert.equal(texture.version, battleVersion);
    ctx.camera.position.z = -3; beacon.setPhase('cleared'); beacon.update(.05, 4);
    assert.equal(label.material.opacity, 1); assert.equal(label.visible, true);
    assert.equal(painted.at(-1).text, '试炼完成 · 前往出口'); assert.equal(painted.at(-1).border, '#79e5ba');
    assert.equal(texture.version, battleVersion + 1); beacon.dispose();
  } finally { globalThis.document = originalDocument; }
});

function localRunner() {
  const result = context(), arena = { ...layout(), spawnPoints: layout().spawnPoints.map(p => new THREE.Vector3(p.x, 0, p.z)), floorY: 0 };
  result.ctx.player.position.set(0, 0, 0);
  const runner = new WaveRunner(result.ctx, arena, [{ entries: [{ enemyId: 'grunt', count: 3 }] }], 2,
    new THREE.Vector3(), () => {}, { center: new THREE.Vector3(), minRadius: 12, maxRadius: 23, minPlayerDistance: 12 });
  return { ...result, runner };
}

test('altar spawn candidates stay on navigable ground in the local ring and away from player', () => {
  const { ctx, runner, warningRecords, spawnRecords } = localRunner();
  ctx.nav.isWalkable = (x, z) => x >= -5;
  for (let frame = 0; frame <= 60; frame++) runner.update(2 + frame * .05);
  assert.equal(spawnRecords.length, 3); assert.equal(warningRecords.length, 3);
  for (const { position: p } of [...spawnRecords, ...warningRecords]) {
    assert.ok(p.x >= -5); assert.equal(p.y, 0); const d = Math.hypot(p.x, p.z);
    assert.ok(d >= 12 && d <= 23); assert.ok(p.distanceTo(ctx.player.position) >= 12);
  }
});

test('rushing into a warning forces a fresh safe warning rather than an immediate close spawn', () => {
  const { ctx, runner, warningRecords, spawnRecords } = localRunner();
  runner.update(2); assert.equal(warningRecords.length, 1);
  ctx.player.position.copy(warningRecords[0].position);
  runner.update(2.81); assert.ok(spawnRecords.every(e => e.position.distanceTo(ctx.player.position) >= 12));
  const before = spawnRecords.length; runner.update(2.82); assert.equal(spawnRecords.length, before);
  for (let frame = 0; frame <= 60; frame++) runner.update(3 + frame * .05);
  assert.ok(warningRecords.length >= 4, 'relocated pending spawn must have its own full warning');
});

test('no safe local point delays pending enemies without forcing them elsewhere, then recovers', () => {
  const { ctx, runner, spawnRecords, warningRecords } = localRunner();
  ctx.nav.isWalkable = () => false; runner.update(2); runner.update(3);
  assert.equal(spawnRecords.length, 0); assert.equal(warningRecords.length, 0); assert.equal(runner.done, false);
  ctx.nav.isWalkable = () => true;
  for (let frame = 0; frame <= 40; frame++) runner.update(3.3 + frame * .05);
  assert.equal(spawnRecords.length, 3); assert.equal(runner.done, true);
  const cancelled = localRunner(); cancelled.runner.update(2); cancelled.runner.cancel(); cancelled.runner.update(10);
  assert.equal(cancelled.spawnRecords.length, 0); assert.equal(cancelled.runner.done, true);
});
