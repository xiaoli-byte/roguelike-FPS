// Chapter-3 lava floor (USER DECISION 2026-10-11 「熔岩做成伤害地面」): inferno V2 lava has no fence, blocks enemy
// navigation, hurts the player once per entry (burst + short burn) and lifts them back to the last safe spot; a jump
// clears a 1.6 m channel; ground enemies that walk in are pushed back, enemies knocked in burn. Frost keeps its fence.
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
const { generateWhitebox, whiteboxPoint } = await import(await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') }));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { LavaSystem, LAVA, onLava } = await import(await tsModule('../src/world/Lava.ts'));

const stageFor = plan => ({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1, reward: 'coins' });
const inferno = WHITEBOX_REDESIGN_PLANS.filter(p => p.chapter === 'inferno');
const layoutOf = id => {
  const plan = WHITEBOX_REDESIGN_PLANS.find(p => p.id === id);
  return { plan, L: generateWhitebox(stageFor(plan), { redesign: true }) };
};
function collision(L) {
  const world = new CollisionWorld();
  world.addBox(L.minX, -1, L.minZ, L.maxX, 0, L.maxZ, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  return world;
}
function navFor(L) {
  const nav = new NavGrid({ world: collision(L), enemies: { list: [] }, time: { now: 0 }, run: { time: 0 } });
  nav.setLava(L.whitebox.lava ?? null);
  nav.build(L, 1);
  return nav;
}
/** Centre of the cell at world (x, z); lava cells deep inside the lava (all 8 neighbours lava too). */
function deepLavaPoints(lava, step = 37) {
  const out = [];
  for (let i = 0; i < lava.mask.length; i += step) {
    const x = i % lava.cols, z = Math.floor(i / lava.cols);
    if (x < 2 || z < 2 || x >= lava.cols - 2 || z >= lava.rows - 2) continue;
    let deep = true;
    for (let dz = -2; dz <= 2 && deep; dz++) for (let dx = -2; dx <= 2; dx++) if (lava.mask[(z + dz) * lava.cols + x + dx] !== 1) { deep = false; break; }
    if (deep) out.push({ x: lava.minX + (x + .5) * lava.cell, z: lava.minZ + (z + .5) * lava.cell });
  }
  return out;
}

// ─── data / generator ───

test('every inferno V2 plan has lava, as lava voids or lava strips, and no fence boxes for it', () => {
  assert.equal(inferno.length, 5);
  for (const plan of inferno) {
    assert.ok((plan.voids ?? []).every(v => v.kind === 'lava'), `${plan.id}: every inferno void is lava`);
    const L = generateWhitebox(stageFor(plan), { redesign: true }), lava = L.whitebox.lava;
    assert.ok(lava && lava.rects.length > 0, `${plan.id} has a lava field`);
    assert.equal(L.boxes.filter(b => b.tag === 'whitebox-void').length, 0, `${plan.id}: lava raises no fence`);
    // No collision box of any kind stands on lava below a double jump's reach (the floor stays open).
    const sample = deepLavaPoints(lava);
    assert.ok(sample.length > 20, `${plan.id}: lava sample`);
    for (const p of sample) assert.ok(!L.boxes.some(b => b.maxY > .05 && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && b.minY < 3),
      `${plan.id}: nothing solid on lava at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    // Lava stays part of the drawn floor (art views lay their ground there; the lava surface sits on top).
    assert.ok(sample.every(p => L.whitebox.floorRects.some(r => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ)));
  }
});

test('frost-5 keeps its fenced ice hole; shipped plans and frost / desert V2 have no lava', () => {
  const frost5 = WHITEBOX_REDESIGN_PLANS.find(p => p.id.startsWith('frost-5'));
  assert.ok(frost5.voids?.length && frost5.voids.every(v => v.kind === undefined), 'frost-5 ice hole is a plain void');
  const L = generateWhitebox(stageFor(frost5), { redesign: true });
  assert.ok(L.boxes.some(b => b.tag === 'whitebox-void' && b.maxY >= 3.5 && b.noRaycast), 'frost-5 ice hole keeps its 3.5 m see-through fence');
  assert.equal(L.whitebox.lava, undefined);
  for (const plan of [...WHITEBOX_PLANS, ...WHITEBOX_REDESIGN_PLANS.filter(p => p.chapter !== 'inferno')]) {
    const G = generateWhitebox(stageFor(plan), { redesign: plan.id.endsWith('-v2') });
    assert.equal(G.whitebox.lava, undefined, `${plan.id} has no lava`);
  }
});

test('inferno-5 radial channels are 1.6 m strips with a 4 m bridge, so a jump clears them and enemies cross on the bridge', () => {
  const { plan, L } = layoutOf('inferno-5-v2'), lava = L.whitebox.lava;
  const strips = plan.hazards.filter(h => h.kind === 'lava');
  assert.equal(strips.length, 8, 'four channels, each split by its bridge');
  for (const s of strips) assert.equal(s.width, 1.6);
  // Across each channel (perpendicular through a strip's midpoint) the lava run is at most ~1.6 m wide.
  for (const s of strips) {
    const [a, b] = s.points, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    let run = 0;
    for (let t = -3; t <= 3; t += .05) {
      const w = whiteboxPoint(plan, [mid[0] + n[0] * t, mid[1] + n[1] * t]);
      if (onLava(lava, w.x, w.z)) run += .05;
    }
    assert.ok(run > 1 && run <= 2.3, `${s.id}: lava run across the channel ${run.toFixed(2)} m`);
  }
  // Ground enemies walk from one quadrant to the next over a bridge, never through lava.
  const nav = navFor(L), C = [55, 40];
  const at = (deg, r) => { const p = whiteboxPoint(plan, [C[0] + Math.cos(deg * Math.PI / 180) * r, C[1] + Math.sin(deg * Math.PI / 180) * r]); return new THREE.Vector3(p.x, 0, p.z); };
  for (const [from, to] of [[0, 90], [90, 180], [180, 270], [270, 360]]) {
    const path = [];
    assert.ok(nav.findPath(at(from, 16), at(to, 16), path), `path ${from}° → ${to}°`);
    const end = path.at(-1);
    assert.ok(end.distanceTo(at(to, 16)) < 1.5, `path ${from}° → ${to}° reaches the next quadrant`);
    let prev = at(from, 16);
    for (const p of path) {
      for (let k = 0; k <= 20; k++) {
        const x = prev.x + (p.x - prev.x) * k / 20, z = prev.z + (p.z - prev.z) * k / 20;
        assert.ok(!onLava(lava, x, z), `path ${from}° → ${to}° stays off lava (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
      prev = p;
    }
  }
});

// ─── navigation ───

test('lava cells are not walkable for enemy navigation, and straight lines over lava are flagged', () => {
  for (const plan of inferno) {
    const L = generateWhitebox(stageFor(plan), { redesign: true }), nav = navFor(L);
    const sample = deepLavaPoints(L.whitebox.lava, 53);
    for (const p of sample) assert.equal(nav.isWalkable(p.x, p.z), false, `${plan.id}: lava at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is not walkable`);
    // The entry and every encounter stay walkable, and nothing authored stands in lava.
    for (const at of [plan.entry.at, plan.exit.at, ...plan.encounters.map(e => e.at)]) {
      const w = whiteboxPoint(plan, at);
      assert.ok(nav.isWalkable(w.x, w.z), `${plan.id}: ${at} walkable`);
    }
    for (const p of [L.playerSpawn, L.rewardPoint, L.shopPoint, ...L.portalPoints, ...L.spawnPoints])
      assert.ok(!onLava(L.whitebox.lava, p.x, p.z), `${plan.id}: placement ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is off lava`);
    const a = new THREE.Vector3(sample[0].x - 30, 0, sample[0].z), b = new THREE.Vector3(sample[0].x + 30, 0, sample[0].z);
    assert.equal(nav.crossesLava(a, b), true, `${plan.id}: a line through lava crosses lava`);
  }
  // Without lava the query is always false.
  const desert = WHITEBOX_PLANS[0], D = generateWhitebox(stageFor(desert)), dn = navFor(D);
  assert.equal(dn.crossesLava(new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)), false);
});

// ─── player and enemy runtime ───

function harness(id = 'inferno-5-v2') {
  const { plan, L } = layoutOf(id), lava = L.whitebox.lava;
  const damage = [], tasks = [];
  const player = {
    alive: true, onGround: true, position: new THREE.Vector3(L.playerSpawn.x, 0, L.playerSpawn.z), velocity: new THREE.Vector3(),
    invulnerableTime: 0, hp: 100, maxHp() { return 100; },
    teleport(p) { this.position.copy(p); this.velocity.set(0, 0, 0); this.onGround = true; },
  };
  const enemies = { list: [] };
  const ctx = {
    time: { now: 0 }, player, enemies, camera: new THREE.PerspectiveCamera(),
    combat: {
      // Mirrors Combat.damagePlayer: invulnerability blocks the hit.
      damagePlayer(amount, element) { if (player.invulnerableTime > 0) return 0; damage.push({ amount, element, t: ctx.time.now }); player.hp -= amount; return amount; },
      damageEnemy(enemy, req) { enemy.hits = (enemy.hits ?? []).concat(req); enemy.hp -= req.base; if (enemy.hp <= 0) enemy.alive = false; return {}; },
    },
    tasks: { add(fn) { const t = { fn, dead: false }; tasks.push(t); return () => { t.dead = true; }; } },
    fx: { burst() {}, ring() {}, shake() {} }, audio: { play() {} },
    nav: { nearestWalkable(p, out) { out.copy(p); return true; } },
  };
  const system = new LavaSystem(ctx, lava, L.floorY, L.playerSpawn);
  const step = (dt = 1 / 60) => {
    ctx.time.now += dt;
    system.update(dt, ctx.time.now);
    for (const t of tasks) if (!t.dead && t.fn(dt) === true) t.dead = true;
    if (player.invulnerableTime > 0) player.invulnerableTime = Math.max(0, player.invulnerableTime - dt);
  };
  const run = (seconds, dt = 1 / 60) => { for (let s = 0; s < seconds - 1e-9; s += dt) step(dt); };
  return { plan, L, lava, ctx, player, damage, system, step, run, enemies };
}
/** inferno-5: a point on the south-east channel's outer strip (centre line) and its two banks. */
function channelSE(h, offset = 0) {
  const C = [55, 40], a = Math.PI / 4, r = 18, n = [-Math.sin(a), Math.cos(a)];
  const p = whiteboxPoint(h.plan, [C[0] + Math.cos(a) * r + n[0] * offset, C[1] + Math.sin(a) * r + n[1] * offset]);
  return new THREE.Vector3(p.x, 0, p.z);
}

test('stepping into lava: one burst plus a short burn, then a lift back to the last safe spot with brief invulnerability', () => {
  const h = harness();
  const bank = channelSE(h, -3), deep = channelSE(h, 0);
  assert.ok(!onLava(h.lava, bank.x, bank.z) && onLava(h.lava, deep.x, deep.z));
  h.player.position.copy(bank); h.run(.3);
  assert.ok(h.system.safe.distanceTo(bank) < 1e-6, 'standing on the bank records it as safe');
  // Walk in.
  h.player.position.copy(deep); h.step();
  assert.equal(h.system.sinking, true);
  assert.equal(h.damage.length, 1, 'one burst on contact');
  assert.equal(h.damage[0].amount, 100 * LAVA.burst);
  assert.equal(h.damage[0].element, 'fire');
  // Keep standing in it until lifted: only the scheduled burn ticks, no second burst.
  h.run(LAVA.sinkTime + .05);
  assert.equal(h.damage.length, 1 + LAVA.burnAt.length, 'burst + burn ticks, once per entry');
  assert.ok(Math.abs(h.player.hp - (100 - 100 * (LAVA.burst + LAVA.burnTick * LAVA.burnAt.length))) < 1e-6, `hp ${h.player.hp}`);
  assert.equal(h.system.sinking, false);
  assert.ok(h.player.position.distanceTo(bank) < 1e-6, 'lifted back to the bank');
  assert.ok(h.player.invulnerableTime > .5, 'brief invulnerability after the lift');
  assert.equal(h.system.entries, 1);
  // Repeated entries keep hurting, even inside the post-lift grace.
  h.player.position.copy(deep); h.step();
  assert.equal(h.system.entries, 2);
  assert.equal(h.damage.length, 4, 'a fresh burst on re-entry');
  h.run(LAVA.sinkTime + .05);
  assert.ok(h.player.position.distanceTo(bank) < 1e-6);
});

test('dash i-frames do not let a grounded dash cross lava; a teleport across lava is not an entry', () => {
  const h = harness();
  const near = channelSE(h, -2), far = channelSE(h, 2);
  assert.ok(!onLava(h.lava, near.x, near.z) && !onLava(h.lava, far.x, far.z));
  h.player.position.copy(channelSE(h, -3)); h.run(.2);
  h.player.position.copy(near); h.step();
  // One grounded frame from bank to bank, 4 m in a frame, with dash i-frames running.
  h.player.invulnerableTime = .25;
  h.player.position.copy(far); h.step();
  assert.equal(h.system.sinking, true, 'the swept frame touched lava');
  assert.equal(h.damage.length, 1, 'dash i-frames do not block lava');
  h.run(LAVA.sinkTime + .05);
  assert.ok(h.player.position.distanceTo(channelSE(h, -3)) < 1e-6, 'returned to the near bank: no crossing by dash');
  // A teleport (checkpoint, challenge entrance) across the lava is not a lava entry.
  const before = h.system.entries;
  h.player.invulnerableTime = 0;
  const away = new THREE.Vector3(far.x + 20, 0, far.z); // straight through the channel and beyond
  h.player.position.copy(away); h.step();
  assert.equal(h.system.entries, before);
});

test('jumping a 1.6 m channel deals no damage', () => {
  const h = harness();
  h.player.position.copy(channelSE(h, -3)); h.run(.2);
  // Run at 7.5 m/s; take off 1.3 m before the centre line and land 1.3 m past it (a real jump flies ~4 m).
  const v = 7.5, dt = 1 / 60;
  for (let s = -3; s <= 3; s += v * dt) {
    const air = Math.abs(s) < 1.3;
    h.player.onGround = !air;
    h.player.position.copy(channelSE(h, s));
    h.player.position.y = air ? .6 : 0;
    h.step(dt);
  }
  h.player.onGround = true; h.run(.3);
  assert.equal(h.damage.length, 0);
  assert.equal(h.system.entries, 0);
  assert.ok(h.system.safe.distanceTo(channelSE(h, 3)) < .2, 'the far bank becomes the new safe spot');
  // Falling into the channel from a jump (landing on lava) is an entry.
  h.player.onGround = false; h.player.position.copy(channelSE(h, 0)); h.player.position.y = .8; h.step();
  assert.equal(h.system.entries, 0, 'airborne over lava is safe');
  h.player.onGround = true; h.player.position.y = 0; h.step();
  assert.equal(h.system.entries, 1, 'landing in lava hurts');
});

test('the safe spot is only taken a little inland from the lava edge, never on lava', () => {
  const h = harness();
  h.player.position.copy(channelSE(h, -3)); h.run(.2);
  const recorded = h.system.safe.clone();
  for (let s = -3; s <= -.9; s += .1) { h.player.position.copy(channelSE(h, s)); h.step(); }
  assert.ok(!onLava(h.lava, h.system.safe.x, h.system.safe.z));
  // The recorded spot keeps at least LAVA.safeMargin from every lava cell.
  const c = h.system.safe;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    assert.ok(!onLava(h.lava, c.x + Math.cos(a) * (LAVA.safeMargin - .05), c.z + Math.sin(a) * (LAVA.safeMargin - .05)), 'margin');
  }
  assert.ok(c.distanceTo(recorded) < 2.2);
});

test('ground enemies that walk into lava are pushed back; knocked in, they burn; bosses and fliers ignore lava', () => {
  const h = harness();
  const bank = channelSE(h, -3), deep = channelSE(h, 0);
  const mk = extra => ({ alive: true, flying: false, isBoss: false, hp: 60, position: bank.clone(), velocity: new THREE.Vector3(), knockedBack: false, ...extra });
  const walker = mk(), knocked = mk(), boss = mk({ isBoss: true }), flier = mk({ flying: true });
  h.enemies.list.push(walker, knocked, boss, flier);
  h.player.position.copy(channelSE(h, -6)); h.step();
  for (const e of h.enemies.list) e.position.copy(deep);
  walker.velocity.set(3, 0, 3);
  knocked.knockedBack = true;
  h.step();
  assert.ok(walker.alive && walker.position.distanceTo(bank) < 1e-6, 'walked in: back on the bank');
  assert.equal(walker.velocity.x, 0);
  assert.equal(knocked.alive, false, 'knocked into lava: burned');
  assert.ok(knocked.hits[0].tags.includes('lava') && knocked.hits[0].element === 'fire');
  assert.ok(boss.alive && boss.position.distanceTo(deep) < 1e-6, 'bosses are not moved by lava');
  assert.ok(flier.alive && flier.position.distanceTo(deep) < 1e-6, 'fliers cross lava');
  // Knocked shortly before (still sliding after control returns) also counts.
  const late = mk(); h.enemies.list.push(late); h.step();
  late.knockedBack = true; h.step(); late.knockedBack = false; h.run(.3);
  late.position.copy(deep); h.step();
  assert.equal(late.alive, false, 'slid in within the knock window');
  // An enemy hurled high over the lava is safe until it lands.
  const thrown = mk(); h.enemies.list.push(thrown); h.step();
  thrown.position.copy(deep); thrown.position.y = 2; h.step();
  assert.ok(thrown.alive && Math.hypot(thrown.position.x - deep.x, thrown.position.z - deep.z) < 1e-6);
});

test('the lava surface is one mesh with one ember cloud and one light, and disposes cleanly', () => {
  const h = harness('inferno-1-v2'), scene = new THREE.Scene();
  scene.add(h.system.group);
  let meshes = 0, points = 0, lights = 0;
  h.system.group.traverse(o => { if (o.isMesh) meshes++; if (o.isPoints) points++; if (o.isLight) lights++; });
  assert.deepEqual([meshes, points, lights], [1, 1, 1]);
  h.run(1);
  h.system.dispose();
  assert.equal(h.system.group.parent, null);
  h.system.update(.016, 1); // no-op after dispose
});
