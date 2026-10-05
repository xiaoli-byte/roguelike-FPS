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
  return moduleUrl(source);
}
const typesUrl = await ts('../src/core/types.ts');
const layoutUrl = await ts('../src/progression/loot/shopLayout.ts');
const { buildShopLayout } = await import(layoutUrl);
const assetsUrl = await ts('../src/progression/loot/assets.ts', {
  '../../core/types': typesUrl,
  'three/examples/jsm/utils/BufferGeometryUtils.js': new URL('../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url).href,
});
const shopUrl = await ts('../src/progression/loot/Shop.ts', {
  '../../core/types': typesUrl,
  './assets': assetsUrl,
  './physics': await ts('../src/progression/loot/physics.ts'),
  './PriceTag': await ts('../src/progression/loot/PriceTag.ts'),
  './weaponPrompt': await ts('../src/progression/loot/weaponPrompt.ts', { '../../core/types': typesUrl }),
  './shopLayout': layoutUrl,
});
const { ShopManager } = await import(shopUrl);
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
// PriceTag's real materials, texture ownership and sprite cleanup run; canvas painting is irrelevant here.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };

function fixture(chapter = 0, stageType = 'boss') {
  const items = new Set(), events = [], notices = [], grants = { health: 0, shield: 0, ammo: 0, weapon: 0, scroll: 0, upgrade: 0 };
  let uid = 0;
  const weapon = () => ({ uid: ++uid, defId: 'test-rifle', rarity: 1, level: 0, mag: 8, reserve: 100, element: 'none', affixes: [] });
  const starting = weapon(), group = new THREE.Group(), world = new CollisionWorld();
  world.addBox(-50, -1, -50, 50, 0, 50, 'floor');
  const ctx = {
    time: { now: 0, frame: 0 }, game: { state: 'playing' }, rng: { chance: () => true },
    run: { chapter, coins: 1000, stage: { type: stageType } },
    player: { alive: true, position: new THREE.Vector3(), hp: 100, shield: 50, stats: { version: 0 },
      maxHp: () => 100, maxShield: () => 50,
      heal(n) { grants.health++; const d = Math.min(n, 100 - this.hp); this.hp += d; return d; },
      addShield(n) { grants.shield++; const d = Math.min(n, 50 - this.shield); this.shield += d; return d; } },
    world, stage: { arena: { minX: -50, maxX: 50, minZ: -50, maxZ: 50, floorY: 0 } },
    interact: { add(item) { items.add(item); return () => items.delete(item); } },
    events: { emit(name, data) { events.push({ name, ...data }); this.reenter?.(name); } },
    audio: { play() {} }, ui: { toast(text) { notices.push(text); } }, fx: { burst() {}, ring() {} },
    weapons: { active: starting, slots: [starting, null], roll: weapon,
      createWorldModel: () => new THREE.Group(), reserveCapacity: () => 100,
      describe: w => ({ name: `测试枪 ${w.uid}`, color: '#ffffff', element: 'none', stats: [], traits: [] }),
      give(w) { grants.weapon++; const old = this.active; this.active = w; this.slots[0] = w; return old; },
      addAmmoFraction() { grants.ammo++; for (const w of this.slots) if (w) w.reserve = 100; },
      upgradeCost(w) { return w.level < 3 ? 50 + w.level * 25 : null; },
      upgrade(w) { grants.upgrade++; w.level++; } },
    scrolls: { roll: () => [{ id: 'left', name: '左秘卷', rarity: 1, description: '测试', maxStacks: 2 },
      { id: 'right', name: '右秘卷', rarity: 2, description: '测试', maxStacks: 2 }],
      owned: new Map(), stacks(id) { return this.owned.get(id) ?? 0; },
      add(id) { grants.scroll++; this.owned.set(id, this.stacks(id) + 1); } },
  };
  const drops = [], shop = new ShopManager(ctx, group, (...args) => drops.push(args));
  const dispose = shop.spawn(new THREE.Vector3(), 0);
  const item = title => [...items].find(i => i.prompt().title === title);
  const tick = () => { ctx.time.now += .05; ctx.time.frame++; shop.update(.05); };
  return { ctx, shop, dispose, items, item, group, world, grants, events, notices, drops, tick };
}

test('health/shield recovery and reserve ammunition are priced repeatable services in shops and before bosses', () => {
  for (const type of ['shop', 'boss']) {
    const f = fixture(0, type), potion = f.item('战备药剂'), ammo = f.item('弹药箱');
    f.ctx.player.hp = 10; f.ctx.player.shield = 2;
    potion.onInteract(); assert.equal(f.ctx.player.hp, 50); assert.equal(f.ctx.player.shield, 50);
    assert.equal(f.ctx.run.coins, 960); assert.ok(potion.enabled);
    f.tick(); potion.onInteract(); assert.equal(f.ctx.player.hp, 90); assert.equal(f.ctx.run.coins, 920);
    f.tick(); potion.onInteract(); assert.equal(f.ctx.player.hp, 100); assert.equal(f.ctx.run.coins, 880);
    f.tick(); potion.onInteract(); assert.equal(f.ctx.run.coins, 880, 'full recovery does not charge');
    f.ctx.player.shield = 1; f.tick(); potion.onInteract();
    assert.equal(f.ctx.player.hp, 100); assert.equal(f.ctx.player.shield, 50); assert.equal(f.ctx.run.coins, 840, 'shield alone can be supplied');
    f.ctx.weapons.active.reserve = 5; f.tick(); ammo.onInteract();
    assert.equal(f.ctx.weapons.active.reserve, 100); assert.equal(f.ctx.run.coins, 820); assert.ok(ammo.enabled);
    f.ctx.weapons.active.reserve = 0; f.tick(); ammo.onInteract();
    assert.equal(f.ctx.run.coins, 800); assert.equal(f.grants.ammo, 2);
    f.tick(); ammo.onInteract(); assert.equal(f.ctx.run.coins, 800, 'full reserves do not charge');
    f.dispose();
  }
});

test('insufficient currency, full states, dead player and modal cannot grant or charge; chapter prices remain unchanged', () => {
  const f = fixture(2), potion = f.item('战备药剂'), ammo = f.item('弹药箱');
  assert.equal(potion.prompt().cost, 60); assert.equal(ammo.prompt().cost, 30);
  potion.onInteract(); ammo.onInteract(); assert.equal(f.ctx.run.coins, 1000);
  assert.deepEqual([f.grants.health, f.grants.shield, f.grants.ammo], [0, 0, 0]);
  f.ctx.player.hp = 40; f.ctx.player.shield = 0; f.ctx.weapons.active.reserve = 0;
  f.ctx.run.coins = 29; potion.onInteract(); ammo.onInteract();
  assert.equal(f.ctx.run.coins, 29); assert.equal(f.ctx.player.hp, 40); assert.equal(f.ctx.weapons.active.reserve, 0);
  f.ctx.run.coins = 1000; f.ctx.game.state = 'modal'; potion.onInteract(); ammo.onInteract();
  f.ctx.game.state = 'playing'; f.ctx.player.alive = false; potion.onInteract(); ammo.onInteract();
  assert.equal(f.ctx.run.coins, 1000); assert.equal(f.events.length, 0); f.dispose();
});

test('event reentry and a second call in the same frame never duplicate a supply grant', () => {
  const f = fixture(), potion = f.item('战备药剂'), ammo = f.item('弹药箱');
  f.ctx.player.hp = 0; f.ctx.player.shield = 0;
  f.ctx.weapons.active.reserve = 0;
  f.ctx.events.reenter = name => { if (name === 'coins:changed') { potion.onInteract(); ammo.onInteract(); } };
  potion.onInteract(); potion.onInteract();
  assert.equal(f.ctx.player.hp, 40); assert.equal(f.ctx.run.coins, 960); assert.equal(f.grants.health, 1);
  ammo.onInteract(); assert.equal(f.ctx.weapons.active.reserve, 0, 'cross-stall callback and second purchase in the frame are blocked');
  f.tick(); ammo.onInteract(); assert.equal(f.ctx.weapons.active.reserve, 100); assert.equal(f.grants.ammo, 1);
  f.tick(); potion.onInteract(); assert.equal(f.ctx.player.hp, 80); assert.equal(f.grants.health, 2);
  assert.equal(f.events.filter(e => e.name === 'coins:changed').length, 3); f.dispose();
});

test('weapon, scroll and upgrade remain distinct finite goods and paid repeatable upgrades', () => {
  const f = fixture(), weapon = [...f.items].find(i => i.prompt().title.startsWith('测试枪')),
    scroll = f.item('左秘卷'), upgrade = f.item('强化台');
  weapon.onInteract(); weapon.onInteract(); assert.equal(f.grants.weapon, 1); assert.equal(f.drops.length, 1); assert.equal(weapon.enabled, false);
  f.tick(); scroll.onInteract(); scroll.onInteract(); assert.equal(f.grants.scroll, 1); assert.equal(scroll.enabled, false);
  f.tick(); const initial = f.ctx.run.coins; upgrade.onInteract(); upgrade.onInteract();
  assert.equal(f.ctx.weapons.active.level, 1); assert.equal(f.ctx.run.coins, initial - 50);
  f.tick(); upgrade.onInteract(); assert.equal(f.ctx.weapons.active.level, 2); assert.equal(f.ctx.run.coins, initial - 125);
  f.tick(); upgrade.onInteract(); assert.equal(f.ctx.weapons.active.level, 3);
  f.tick(); const fullPrice = f.ctx.run.coins; upgrade.onInteract(); assert.equal(f.ctx.run.coins, fullPrice); f.dispose();
});

test('pure arc matches real seven-stall placement; selective disposal and clear remove collisions, tags and stale callbacks', () => {
  const f = fixture(), stations = buildShopLayout({ x: 0, z: 0 }, 0);
  assert.equal(stations.length, 7); assert.equal(f.world.boxes.filter(b => b.tag === 'prop').length, 7);
  const roots = f.group.children.filter(c => c.type === 'Group');
  roots.forEach((root, i) => {
    assert.ok(Math.hypot(root.position.x - stations[i].position.x, root.position.z - stations[i].position.z) < 1e-8);
    assert.ok(Math.abs(Math.hypot(stations[i].customer.x, stations[i].customer.z) - 4.7) < 1e-8);
  });
  const stale = [...f.items], second = f.shop.spawn(new THREE.Vector3(18, 0, 0), Math.PI / 2);
  assert.equal(f.items.size, 14); f.dispose(); f.dispose();
  assert.equal(f.items.size, 7); assert.equal(f.world.boxes.filter(b => b.tag === 'prop').length, 7);
  f.ctx.player.hp = 0; const initial = f.ctx.run.coins; stale.forEach(i => i.onInteract());
  assert.equal(f.ctx.run.coins, initial); assert.equal(f.grants.health, 0, 'captured old callbacks are inactive');
  f.shop.clear(); second(); second(); f.shop.clear();
  assert.equal(f.items.size, 0); assert.equal(f.group.children.length, 0); assert.equal(f.world.boxes.length, 1);
});
