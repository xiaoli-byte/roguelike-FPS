import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(source);
}
const typesUrl = await ts('../src/core/types.ts'), rngUrl = await ts('../src/core/Rng.ts');
const { Rng } = await import(rngUrl);
const plansUrl = await ts('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS } = await import(plansUrl);
const genUrl = await ts('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl });
const { generateWhitebox, whiteboxPoint } = await import(genUrl);
const fightUrl = await ts('../src/world/WhiteboxEncounters.ts', { './WhiteboxGen': genUrl });
const { buildWhiteboxFights, whiteboxRoomContains } = await import(fightUrl);
const layoutUrl = await ts('../src/progression/loot/shopLayout.ts');
const { buildShopLayout, SHOP_STALL_HALF_WIDTH, SHOP_CUSTOMER_HALF_WIDTH } = await import(layoutUrl);
const { ShopManager } = await import(await ts('../src/progression/loot/Shop.ts', {
  '../../core/types': typesUrl, './shopLayout': layoutUrl,
  './assets': await ts('../src/progression/loot/assets.ts', { '../../core/types': typesUrl,
    'three/examples/jsm/utils/BufferGeometryUtils.js': new URL('../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url).href }),
  './physics': await ts('../src/progression/loot/physics.ts'), './PriceTag': await ts('../src/progression/loot/PriceTag.ts'),
  './weaponPrompt': await ts('../src/progression/loot/weaponPrompt.ts', { '../../core/types': typesUrl }),
}));
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
const navUrl = await ts('../src/world/NavGrid.ts', { '../core/math': await ts('../src/core/math.ts') });
const { NavGrid } = await import(navUrl);
const waveUrl = await ts('../src/world/WaveRunner.ts', { '../enemies/Registry': data(`export function getEnemyDef(id){const boss=id.startsWith('boss_');return {isBoss:boss,radius:boss?2:.6,height:boss?4:1.8};}`) });
const { StageDirector } = await import(await ts('../src/world/StageDirector.ts', {
  '../core/Rng': rngUrl, '../assets/AssetLibrary': data('export const AssetLibrary={enabled:true};'),
  '../enemies/Waves': data('export function buildWaves(){throw new Error("Unexpected generic wave");} export function buildEncounterWaves(){throw new Error("Unexpected generic encounter");}'),
  './ArenaBuilder': data(`import * as THREE from '${threeUrl}'; export function addCollision(world,L){for(const b of L.boxes)world.addBox(b.minX,b.minY,b.minZ,b.maxX,b.maxY,b.maxZ,b.tag,b.noRaycast);} export class ArenaView {group=new THREE.Group();update(){}dispose(){this.group.removeFromParent();}}`),
  './LevelGen': data('export function generateLevel(){throw new Error("Unexpected legacy map");}'),
  './NavGrid': navUrl, './Portal': data('export class Portal{constructor(ctx){ctx.portals++;}update(){}dispose(){}}'),
  './Themes': data('export function themeDef(id){return {id,name:id};}'), './WaveRunner': waveUrl,
  './AdventureBeacon': data('export class AdventureBeacon{constructor(){throw new Error("Duplicate altar");}}'),
  './WhiteboxMode': data('export function usesAuthoredLayout(){return true;}'), './WhiteboxGen': genUrl, './WhiteboxEncounters': fightUrl,
}));
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
const nodeFor = plan => ({ chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1,
  type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, reward: 'coins' });

function fixture(plan) {
  const node = nodeFor(plan), items = new Set(), handlers = new Map(), events = [], spawns = [], chests = [], shops = [];
  let uid = 0;
  const weapon = () => ({ uid: ++uid, rarity: 1, level: 0, mag: 8, reserve: 100, element: 'none', affixes: [] });
  const starting = weapon(), ctx = {
    time: { now: 0, frame: 0 }, rng: new Rng(20261005), run: { seed: 20261005, chapter: node.chapter, difficulty: 1, coins: 1000, stagesCleared: 0, essence: 0, stage: node },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), game: { state: 'playing', endRun() {} }, portals: 0,
    player: { alive: true, position: new THREE.Vector3(), yaw: 0, radius: .4, height: 1.8, invulnerableTime: 0,
      hp: 20, shield: 0, stats: { version: 0 }, teleport(p, yaw) { this.position.copy(p); this.yaw = yaw; }, maxHp: () => 100, maxShield: () => 50,
      heal(n) { const d = Math.min(n, 100 - this.hp); this.hp += d; return d; }, addShield(n) { const d = Math.min(n, 50 - this.shield); this.shield += d; return d; } },
    world: new CollisionWorld(), nav: null,
    interact: { add(i) { items.add(i); return () => items.delete(i); } },
    weapons: { active: starting, slots: [starting, null], roll: weapon, createWorldModel: () => new THREE.Group(), reserveCapacity: () => 100,
      describe: w => ({ name: `测试枪 ${w.uid}`, color: '#ffffff', element: 'none', stats: [], traits: [] }),
      give(w) { this.active = w; this.slots[0] = w; return null; }, upgradeCost: w => w.level < 3 ? 50 : null,
      upgrade(w) { w.level++; }, addAmmoFraction() { this.slots.forEach(w => { if (w) w.reserve = 100; }); } },
    scrolls: { roll: () => [{ id: 's1', name: '测试秘卷一', rarity: 1, maxStacks: 1 }, { id: 's2', name: '测试秘卷二', rarity: 2, maxStacks: 1 }], stacks: () => 0, add() {} },
    ui: { toast() {}, setBoss() {}, banner() {} }, audio: { play() {} },
    fx: { burst() {}, ring() {}, shake() {}, spawnEffect() {}, groundWarning: () => () => {} },
    events: { on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
      emit(name, value) { events.push({ name, value }); for (const fn of handlers.get(name) ?? []) fn(value); } },
    enemies: { list: [], aliveCount() { return this.list.filter(e => e.alive).length; },
      spawn(id, options) { const boss = id.startsWith('boss_'), enemy = { id, isBoss: boss, alive: true, displayName: id,
        radius: boss ? 2 : .6, def: { height: boss ? 4 : 1.8 }, position: options.position.clone(), velocity: new THREE.Vector3() };
        this.list.push(enemy); spawns.push(enemy); ctx.events.emit('enemy:spawned', { enemy }); return enemy; },
      killAll() { for (const enemy of this.list) if (enemy.alive) { enemy.alive = false; ctx.events.emit('enemy:killed', { enemy }); } } },
    runPlan: { nextOptions: () => [{ ...node, index: 0, type: 'combat' }], isFinalStage: () => false, rewardLabel: r => r },
  };
  ctx.nav = new NavGrid(ctx);
  const shop = new ShopManager(ctx, new THREE.Group(), () => {});
  ctx.loot = { spawnChest(position, reward) { chests.push({ position: position.clone(), reward }); },
    spawnShop(center, yaw) { const dispose = shop.spawn(center, yaw); shops.push({ center, yaw }); return dispose; } };
  const director = new StageDirector(ctx); ctx.stage = director; director.init(); director.load(node);
  const layout = generateWhitebox(node), fights = buildWhiteboxFights(layout, node);
  function advance(seconds) {
    const n = Math.ceil(seconds / .05);
    for (let i = 0; i < n; i++) { ctx.time.now += seconds / n; ctx.time.frame++; director.update(seconds / n); shop.update(seconds / n); }
  }
  return { ctx, director, node, layout, fights, shop, shops, items, events, spawns, chests, advance };
}

test('all three authored boss stages provide the real seven-stall shop, safe customer stations and complete cleanup', () => {
  const bosses = WHITEBOX_PLANS.filter(p => p.index === 5); assert.equal(bosses.length, 3);
  for (const plan of bosses) {
    assert.ok(plan.preparation, `${plan.id} preparation metadata`);
    const f = fixture(plan), preparation = plan.preparation, center = whiteboxPoint(plan, preparation.at);
    assert.equal(f.shops.length, 1); assert.equal(f.items.size, 7);
    assert.equal(f.director.exploration.preparation.label, preparation.label);
    assert.equal(f.ctx.player.hp, 20, 'arrival does not freely restore health'); assert.equal(f.ctx.player.shield, 0);
    const yaw = Math.atan2(preparation.facing[0] - preparation.at[0], preparation.facing[1] - preparation.at[1]);
    assert.ok(Math.abs(f.shops[0].yaw - yaw) < 1e-10);
    const stations = buildShopLayout(center, yaw);
    for (const station of stations) {
      for (const [point, width] of [[station.position, SHOP_STALL_HALF_WIDTH], [station.customer, SHOP_CUSTOMER_HALF_WIDTH]]) {
        assert.ok(whiteboxRoomContains(plan, preparation.room, point, width), `${plan.id} full shop body/customer inside preparation`);
        assert.equal(f.layout.boxes.some(b => b.maxY > .05 && b.minY < 2 && point.x + width > b.minX && point.x - width < b.maxX
          && point.z + width > b.minZ && point.z - width < b.maxZ), false, `${plan.id} no wall or cover overlap`);
      }
      assert.equal(Boolean(f.ctx.world.overlapsBody(station.customer.x, 0, station.customer.z, SHOP_CUSTOMER_HALF_WIDTH, 1.8)), false,
        `${plan.id} customer can stand beside the actual spawned counters`);
      f.ctx.player.position.set(station.customer.x, 0, station.customer.z); f.advance(3);
      assert.equal(f.spawns.length, 0, `${plan.id} shopping cannot summon boss`);
    }
    const potion = [...f.items].find(i => i.prompt().title === '战备药剂'), ammo = [...f.items].find(i => i.prompt().title === '弹药箱');
    potion.onInteract(); assert.equal(f.ctx.player.hp, 60); assert.equal(f.ctx.player.shield, 50);
    f.ctx.weapons.active.reserve = 0; f.advance(.1); ammo.onInteract(); assert.equal(f.ctx.weapons.active.reserve, 100);
    f.ctx.game.state = 'modal'; f.advance(5); assert.equal(f.spawns.length, 0); f.ctx.game.state = 'playing';
    const old = [...f.items], before = f.ctx.run.coins; f.director.unload(); f.director.unload();
    assert.equal(f.items.size, 0); assert.equal(f.ctx.world.boxes.length, 0);
    old.forEach(i => i.onInteract()); assert.equal(f.ctx.run.coins, before, 'old shop callbacks cannot transact');
  }
});

test('each boss starts only in its actual fight room, keeps normal warning/settlement and cannot repeat after returning to shop', () => {
  for (const plan of WHITEBOX_PLANS.filter(p => p.index === 5)) {
    const f = fixture(plan), fight = f.fights.find(e => e.final);
    f.advance(30); assert.equal(f.spawns.length, 0, `${plan.id} arrival may wait indefinitely`);
    assert.ok(fight.contains(fight.facing), `${plan.id} reviewed trigger is inside the main room`);
    f.ctx.player.position.set(fight.facing.x, 0, fight.facing.z); f.advance(.1);
    assert.equal(f.director.exploration.phase, 'battle'); assert.equal(f.spawns.length, 0, 'spawn warning is preserved');
    f.advance(5); assert.equal(f.spawns.length, 1); assert.ok(fight.contains(f.spawns[0].position, 2.15));
    f.ctx.enemies.killAll(); f.advance(5); assert.equal(f.ctx.run.stagesCleared, 1); assert.equal(f.ctx.portals, 1);
    const p = whiteboxPoint(plan, plan.preparation.at); f.ctx.player.position.set(p.x, 0, p.z); f.advance(4);
    f.ctx.player.position.set(fight.facing.x, 0, fight.facing.z); f.advance(6);
    assert.equal(f.spawns.length, 1); assert.equal(f.ctx.run.stagesCleared, 1); assert.equal(f.ctx.portals, 1); f.director.unload();
  }
});

test('authored chest uses explicit reward/prerequisites, room containment and line of sight before one-time visible discovery', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'desert-1'), f = fixture(plan);
  const index = plan.rewards.findIndex(r => r.requires?.length), source = plan.rewards[index], site = f.director.exploration.sites[index];
  assert.ok(source.reward && source.requires.length);
  f.ctx.player.position.copy(site.position); f.director.discoverSites(); assert.equal(site.visited, false);
  for (const id of source.requires) f.director.exploration.encounters.find(e => e.id === id).phase = 'cleared';
  const adjacent = plan.rooms.find(r => r.id !== source.room && !whiteboxRoomContains(plan, source.room, whiteboxPoint(plan, r.labelAt)));
  const other = whiteboxPoint(plan, adjacent.labelAt); f.ctx.player.position.set(other.x, 0, other.z);
  f.director.discoverSites(); assert.equal(site.visited, false, 'other room is insufficient even if prerequisites are cleared');
  const original = f.ctx.world.segmentBlocked.bind(f.ctx.world); f.ctx.world.segmentBlocked = () => true;
  f.ctx.player.position.copy(site.position); f.director.discoverSites(); assert.equal(site.visited, false, 'blocked sight never registers discovery');
  f.ctx.world.segmentBlocked = original;
  // Find a genuine visible station 8–18m from the chest inside its authored room.
  let observer = null;
  const room = plan.rooms.find(r => r.id === source.room);
  for (let z = Math.min(...room.polygon.map(p => p[1])) + 1; !observer && z < Math.max(...room.polygon.map(p => p[1])) - 1; z += 1) {
    for (let x = Math.min(...room.polygon.map(p => p[0])) + 1; !observer && x < Math.max(...room.polygon.map(p => p[0])) - 1; x += 1) {
      const p = whiteboxPoint(plan, [x, z]), d = Math.hypot(p.x - site.position.x, p.z - site.position.z);
      if (d < 8 || d > 18 || !whiteboxRoomContains(plan, source.room, p, .5) || f.ctx.world.overlapsBody(p.x, 0, p.z, .5, 1.8)) continue;
      if (!original(new THREE.Vector3(p.x, 1.2, p.z), site.position.clone().add(new THREE.Vector3(0, .6, 0)))) observer = p;
    }
  }
  assert.ok(observer, 'reviewed room permits visible discovery before walking to the chest');
  f.ctx.player.position.set(observer.x, 0, observer.z); f.director.discoverSites();
  assert.equal(site.visited, true); assert.equal(f.chests.find(c => c.position.distanceTo(site.position) < .01)?.reward, source.reward);
  const count = f.chests.length; f.director.discoverSites(); f.ctx.player.position.copy(site.position); f.director.discoverSites();
  assert.equal(f.chests.length, count, 're-entry cannot create a second chest'); f.director.unload();
});

test('finishing the final fight leaves skipped guarded loot locked; a later branch fight unlocks it without a second settlement or exit', () => {
  const plan = WHITEBOX_PLANS.find(p => p.id === 'inferno-2'), f = fixture(plan), final = f.fights.find(e => e.final);
  const index = plan.rewards.findIndex(r => r.requires?.includes('B')), reward = plan.rewards[index], site = f.director.exploration.sites[index];
  assert.ok(reward); const guard = f.fights.find(e => e.id === 'B');
  f.ctx.player.position.set(final.facing.x, 0, final.facing.z); f.advance(5); f.ctx.enemies.killAll(); f.advance(3);
  assert.equal(f.director.cleared, true); assert.equal(f.director.exploration.encounters.find(e => e.id === 'B').phase, 'undiscovered');
  f.ctx.player.position.copy(site.position); f.director.discoverSites(); assert.equal(site.visited, false);
  f.ctx.player.position.set(guard.facing.x, 0, guard.facing.z); f.advance(5);
  assert.equal(f.director.exploration.phase, 'cleared'); assert.ok(f.ctx.enemies.aliveCount() > 0, 'optional fight remains playable after final completion');
  const survivor = f.ctx.enemies.list.find(e => e.alive);
  f.ctx.enemies.list.forEach(e => { if (e !== survivor) e.alive = false; });
  survivor.position.copy(f.ctx.player.position).add(new THREE.Vector3(1, 0, 0)); f.advance(32);
  assert.ok(survivor.position.distanceTo(f.ctx.player.position) >= 10, 'post-clear branch retains the real straggler recovery safety gap');
  assert.ok(guard.contains(survivor.position, survivor.radius + .15), 'post-clear recovery remains in the branch room');
  f.ctx.enemies.killAll(); f.advance(2); f.ctx.player.position.copy(site.position); f.advance(.1);
  assert.equal(site.visited, true); const rewards = f.chests.filter(c => c.position.distanceTo(site.position) < .01);
  assert.equal(rewards.length, 1); assert.equal(rewards[0].reward, reward.reward);
  f.advance(10); assert.equal(f.ctx.run.stagesCleared, 1); assert.equal(f.ctx.portals, 1);
  assert.equal(f.events.filter(e => e.name === 'stage:cleared').length, 1); f.director.unload();
});
