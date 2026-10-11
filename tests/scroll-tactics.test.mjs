import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// Transpile a temporary module graph so the real Combat / reaction / feedback circular imports run.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), 'spiritfire-scrolls-'));
after(() => rm(dir, { recursive: true, force: true }));
const modules = new Map();
async function ts(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file);
  const output = path.join(dir, path.relative(root, file)).replace(/\.ts$/, '.mjs');
  const url = pathToFileURL(output).href;
  modules.set(file, url);
  let source = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
  for (const match of [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)]) {
    const spec = match[1];
    const replacement = spec.startsWith('.')
      ? await ts(path.relative(root, path.resolve(path.dirname(file), spec + '.ts')))
      : import.meta.resolve(spec);
    source = source.replaceAll(`'${spec}'`, `'${replacement}'`).replaceAll(`"${spec}"`, `"${replacement}"`);
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, source);
  return url;
}
const { ScrollSystem } = await import(await ts('progression/Scrolls.ts'));
const { TACTIC_SCROLLS } = await import(await ts('progression/scrolls/defsTactics.ts'));
const { Stats } = await import(await ts('core/Stats.ts'));
const { EventBus } = await import(await ts('core/EventBus.ts'));
const { TaskRunner } = await import(await ts('core/Tasks.ts'));
const { Rng } = await import(await ts('core/Rng.ts'));
const { Combat } = await import(await ts('combat/Combat.ts'));

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function fixture() {
  const cooldowns = [], explosions = [], enemies = [];
  const weapon = uid => ({ uid, defId: 'test', mag: 3, reserve: 40, element: 'none', affixes: [] });
  const a = weapon(1), b = weapon(2);
  const events = new EventBus();
  const ctx = {
    events, tasks: new TaskRunner(), rng: new Rng(1234),
    time: { now: 0, frame: 0 }, run: { difficulty: 1, chapter: 0, heroId: 'bear', damageDealt: 0, kills: 0, coins: 0 },
    settings: { damageNumbers: false }, stageGroup: new THREE.Group(),
    player: { alive: true, hp: 50, shield: 0, position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 0),
      stats: new Stats(), invulnerableTime: 0, maxHp() { return this.stats.get('maxHp'); },
      maxShield() { return this.stats.get('maxShield'); },
      addShield(n) { const d = Math.max(0, Math.min(n, this.maxShield() - this.shield)); this.shield += d; return d; },
      heal(n) { const d = Math.max(0, Math.min(n, this.maxHp() - this.hp)); this.hp += d;
        if (d > 0) events.emit('player:healed', { amount: d }); return d; },
      takeDamage(n) { this.hp -= n; }, reduceCooldowns(n, slot) { cooldowns.push({ n, slot }); } },
    weapons: { active: a, slots: [a, b], isReloading: false, activeForm: null, magCapacity: () => 10 },
    enemies: { all: enemies, queryRadius(c, r, out = []) { out.length = 0;
      out.push(...enemies.filter(e => e.alive && e.position.distanceTo(c) <= r)); return out; } },
    world: { segmentBlocked: () => false, raycast: () => null },
    audio: { play() {} }, ui: { toast() {} }, meta: { addEssence() {} },
    fx: new Proxy({}, { get: () => () => {} }),
  };
  ctx.combat = new Combat(ctx);
  const explode = ctx.combat.explode.bind(ctx.combat);
  ctx.combat.explode = (c, r, req, opts) => { explosions.push({ c: c.clone(), r, req }); return explode(c, r, req, opts); };
  ctx.scrolls = new ScrollSystem(ctx);
  const emit = (name, data = {}) => events.emit(name, data);
  const advance = seconds => { ctx.time.now += seconds; ctx.time.frame++; ctx.tasks.update(seconds); };
  const enemy = (x = 1) => {
    const e = { id: enemies.length + 1, hp: 10000, maxHp: 10000, shield: 0, maxShield: 0, armor: 0, maxArmor: 0,
      alive: true, untargetable: false, damageTakenMult: 1, isBoss: false, isElite: false, radius: 1, height: 2,
      position: new THREE.Vector3(x, 0, 0), statuses: new Map(), def: { color: 0xffffff, essence: 0 },
      getBodyCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1, 0)); },
      getHeadCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1.8, 0)); },
      onDamaged() {}, onKilled() {}, knockback() {}, die() { this.alive = false; } };
    enemies.push(e); return e;
  };
  const hit = (e, overrides = {}) => ctx.combat.damageEnemy(e, {
    base: 100, element: 'none', source: 'weapon', procDepth: 0, canCrit: false, weaponUid: ctx.weapons.active.uid, ...overrides,
  });
  const add = (id, n = 1) => { for (let i = 0; i < n; i++) ctx.scrolls.add(`tac_${id}`); };
  const switchTo = w => { ctx.weapons.active = w; emit('weapon:switched', { weapon: w, slot: w.uid - 1 }); };
  return { ctx, a, b, emit, advance, enemy, hit, add, switchTo, cooldowns, explosions };
}

test('118 distinct scrolls; all 20 tactics roll with normal rarity, exclusions and stack caps', () => {
  const f = fixture();
  assert.equal(f.ctx.scrolls.all.length, 118);
  assert.equal(TACTIC_SCROLLS.length, 20);
  assert.equal(new Set(f.ctx.scrolls.all.map(d => d.id)).size, 118);
  assert.equal(new Set(f.ctx.scrolls.all.map(d => d.name)).size, 118);
  assert.deepEqual(TACTIC_SCROLLS.map(d => d.rarity).reduce((a, r) => (a[r]++, a), [0, 0, 0, 0, 0]), [2, 6, 8, 2, 2]);
  const all = f.ctx.scrolls.roll(200).map(d => d.id);
  for (const d of TACTIC_SCROLLS) assert.ok(all.includes(d.id));
  f.add('crossfire', 3); f.add('crossfire');
  assert.equal(f.ctx.scrolls.stacks('tac_crossfire'), 3);
  assert.ok(!f.ctx.scrolls.roll(200).some(d => d.id === 'tac_crossfire'));
  assert.ok(f.ctx.scrolls.roll(200, { minRarity: 3, exclude: ['tac_dash_capstone'] })
    .every(d => d.rarity >= 3 && d.id !== 'tac_dash_capstone'));
});

test('switch effects require a different weapon, enforce cooldown and expire without stacking', () => {
  const f = fixture(); f.add('crossfire', 2); f.add('cover_change', 2);
  const e = f.enemy();
  f.switchTo(f.a); close(f.hit(e).dealt, 100); close(f.ctx.player.shield, 0);
  f.switchTo(f.b); close(f.hit(e).dealt, 124); close(f.ctx.player.shield, 16);
  f.switchTo(f.a); close(f.ctx.player.shield, 16);
  f.advance(4); close(f.hit(e).dealt, 100);
  f.switchTo(f.b); close(f.hit(e).dealt, 124); close(f.ctx.player.shield, 16);
  f.advance(1); f.switchTo(f.a); close(f.ctx.player.shield, 32);
  f.emit('stage:loaded'); close(f.hit(e).dealt, 100);
});

test('reload defense uses actual reload state; completed reload grants timed hit damage', () => {
  const f = fixture(); f.add('reload_guard', 3); f.add('loaded_focus', 2);
  f.ctx.combat.damagePlayer(10, 'none'); close(f.ctx.player.hp, 40);
  f.ctx.weapons.isReloading = true; f.ctx.combat.damagePlayer(10, 'none'); close(f.ctx.player.hp, 32.4);
  f.ctx.weapons.isReloading = false;
  f.emit('weapon:reloaded', { weapon: f.a }); close(f.hit(f.enemy(), { forceCrit: true }).dealt, 300);
  f.advance(8); close(f.hit(f.enemy(), { forceCrit: true }).dealt, 200);
});

test('dash load conserves ammunition, caps capacity, ignores melee and never emits reload', () => {
  const f = fixture(); f.add('dash_load', 3);
  let reloads = 0; f.ctx.events.on('weapon:reloaded', () => reloads++);
  f.emit('player:dashed'); assert.deepEqual([f.a.mag, f.a.reserve], [9, 34]);
  f.emit('player:dashed'); assert.deepEqual([f.a.mag, f.a.reserve], [9, 34]);
  f.advance(2); f.emit('player:dashed'); assert.deepEqual([f.a.mag, f.a.reserve], [10, 33]);
  f.advance(2); f.a.mag = 0; f.a.reserve = 1; f.emit('player:dashed'); assert.deepEqual([f.a.mag, f.a.reserve], [1, 0]);
  f.advance(2); f.a.reserve = 10; f.ctx.weapons.bladeHud = { mode: 'hand' }; f.emit('player:dashed');
  assert.deepEqual([f.a.mag, f.a.reserve], [1, 10]); assert.equal(reloads, 0);
});

test('dash and landing waves use difficulty / radius scaling and Combat wall occlusion', () => {
  const f = fixture(); f.add('dash_wave', 2); f.add('landing_wave');
  f.ctx.run.difficulty = 2; f.ctx.player.stats.add('explosionRadiusPct', 0.5, 'test');
  const e = f.enemy(0.5), far = f.enemy(20);
  f.emit('player:dashed'); close(10000 - e.hp, 48 * 1.85); close(far.hp, 10000);
  assert.equal(f.explosions[0].r, 4.5); assert.equal(f.explosions[0].req.procDepth, 1);
  f.emit('player:dashed'); assert.equal(f.explosions.length, 1);
  f.emit('player:landed', { fallSpeed: 5.99 }); assert.equal(f.explosions.length, 1);
  f.ctx.world.raycast = () => ({});
  const hp = e.hp; f.emit('player:landed', { fallSpeed: 6 }); close(e.hp, hp);
  assert.equal(f.explosions[1].r, 6);
});

test('skill and critical cooldown refunds exclude zero damage, derived damage and purge', () => {
  const f = fixture(); f.add('battle_mage', 2); f.add('crit_insight', 3); const e = f.enemy();
  f.hit(e, { source: 'skill', procDepth: 1 }); f.hit(e, { source: 'skill', tags: ['reaction'] });
  f.hit(e, { source: 'skill', base: 0 }); assert.equal(f.cooldowns.length, 0);
  f.hit(e, { source: 'skill' }); f.hit(e, { source: 'skill' });
  assert.deepEqual(f.cooldowns, [{ n: 0.5, slot: 'primary' }]);
  f.hit(e, { forceCrit: true, procDepth: 1 }); f.hit(e, { forceCrit: true, tags: ['purge'] });
  assert.equal(f.cooldowns.length, 1);
  f.hit(e, { forceCrit: true }); f.hit(e, { forceCrit: true }); close(f.cooldowns[1].n, 0.6);
  assert.equal(f.cooldowns[1].slot, 'secondary');
  f.advance(0.75); f.hit(e, { forceCrit: true }); assert.equal(f.cooldowns.length, 3);
});

test('skill ward and alternating skills handle cooldown, order, expired windows and stage reset', () => {
  const f = fixture(); f.add('spell_ward', 2); f.add('alternating_arts', 2);
  const use = slot => f.emit('skill:used', { slot, skillId: 'test' });
  use('primary'); use('primary'); close(f.ctx.player.shield, 12); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  use('secondary'); close(f.ctx.player.stats.get('skillDamagePct'), 0.4);
  assert.deepEqual(f.cooldowns, [{ n: 3, slot: 'primary' }]);
  f.advance(6); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  f.emit('stage:loaded'); use('primary'); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  f.advance(6); use('secondary'); close(f.ctx.player.stats.get('skillDamagePct'), 0);
});

test('shield threshold never benefits zero shield capacity and only buffs weapon damage', () => {
  const f = fixture(); f.add('pristine_shield', 2); const e = f.enemy();
  f.ctx.player.shield = 47.5; close(f.hit(e).dealt, 120); close(f.hit(e, { source: 'skill' }).dealt, 100);
  f.ctx.player.shield = 47.49; close(f.hit(e).dealt, 100);
  f.ctx.player.stats.setBase('maxShield', 0); f.ctx.player.shield = 0; close(f.hit(e).dealt, 100);
});

test('shield break speed and actual healing conversion expire and respect shield cap', () => {
  const f = fixture(); f.add('emergency_reload', 2); f.add('healing_barrier', 2);
  f.emit('player:shieldBroken'); close(f.ctx.player.stats.get('reloadSpeedPct'), 0.4);
  f.ctx.player.heal(100); close(f.ctx.player.shield, 25);
  f.ctx.player.heal(100); close(f.ctx.player.shield, 25);
  f.ctx.player.hp = 0; f.ctx.player.heal(100); close(f.ctx.player.shield, 50);
  f.advance(5); close(f.ctx.player.stats.get('reloadSpeedPct'), 0);
});

test('prey marks are target specific, bounded, deduplicate pellets, expire and ignore derived / purge hits', () => {
  const f = fixture(); f.add('focused_prey', 3); const a = f.enemy(), b = f.enemy(2);
  close(f.hit(a).dealt, 100); close(f.hit(a).dealt, 109);
  f.advance(0.01); close(f.hit(a).dealt, 109);
  for (let i = 0; i < 10; i++) { f.advance(0.01); f.hit(a); }
  close(f.hit(a).dealt, 145); close(f.hit(b, { source: 'scroll' }).dealt, 100);
  f.hit(b, { procDepth: 1 }); f.hit(b, { tags: ['purge'] }); close(f.hit(b).dealt, 100);
  f.advance(4); close(f.hit(a).dealt, 100);
  f.emit('stage:loaded'); close(f.hit(a).dealt, 100);
});

test('reaction benefits accept only root reactions and refresh without adding duplicate stats', () => {
  const f = fixture(); f.add('reaction_ward', 2); f.add('reaction_stride', 2);
  f.emit('enemy:reaction', { depth: 1 }); close(f.ctx.player.shield, 0);
  f.emit('enemy:reaction', { depth: 0 }); f.emit('enemy:reaction', { depth: 0 });
  close(f.ctx.player.shield, 0); close(f.ctx.player.stats.get('reactionHaste'), 0.1);
  close(f.ctx.player.stats.get('moveSpeed'), 8.3);
  f.advance(0.8); f.emit('enemy:reaction', { depth: 0 }); close(f.ctx.player.shield, 0);
  f.advance(3.5); close(f.ctx.player.stats.get('reactionHaste'), 0.1);
  f.advance(0.5); close(f.ctx.player.stats.get('reactionHaste'), 0);
});

test('control damage only accepts living stun / slow states and weapon requests', () => {
  const f = fixture(); f.add('stagger_hunter', 2); const e = f.enemy();
  e.statuses.set('slow', { id: 'slow', remaining: 1 }); close(f.hit(e).dealt, 124);
  close(f.hit(e, { source: 'status' }).dealt, 100);
  e.statuses.get('slow').remaining = 0; close(f.hit(e).dealt, 100);
  e.statuses.set('stun', { id: 'stun', remaining: 1 }); close(f.hit(e).dealt, 124);
});

test('dash capstone consumes once before nested damage, respects expiry, wall and proc depth', () => {
  const f = fixture(); f.add('dash_capstone'); const e = f.enemy();
  f.emit('player:dashed'); f.hit(e, { procDepth: 1 }); assert.equal(f.explosions.length, 0);
  const hp = e.hp; f.hit(e); close(hp - e.hp, 170); assert.equal(f.explosions.length, 1);
  f.hit(e); assert.equal(f.explosions.length, 1);
  f.advance(4); f.emit('player:dashed'); f.advance(3); f.hit(e); assert.equal(f.explosions.length, 1);
  f.advance(1); f.emit('player:dashed'); f.emit('stage:loaded'); f.hit(e); assert.equal(f.explosions.length, 1);
});

test('spellgun cycle uses damage sources, refreshes without stacking and applies risk via real Combat', () => {
  const f = fixture(); f.add('spellgun_cycle'); const e = f.enemy();
  f.hit(e, { source: 'scroll' }); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  f.emit('skill:used', { slot: 'primary', skillId: 'test' }); close(f.hit(e).dealt, 125);
  close(f.hit(e, { source: 'skill' }).dealt, 135);
  f.emit('skill:used', { slot: 'secondary', skillId: 'test' }); close(f.hit(e).dealt, 125);
  f.ctx.combat.damagePlayer(10, 'none'); close(f.ctx.player.hp, 38.5);
  f.advance(5); close(f.ctx.player.stats.get('damagePct'), 0); close(f.ctx.player.stats.get('skillDamagePct'), 0);
});

test('stack upgrades and reset remove old modifiers, all tasks, listeners and delayed combat state', () => {
  const f = fixture(); const e = f.enemy();
  for (const d of TACTIC_SCROLLS) f.add(d.id.slice(4));
  f.switchTo(f.b); f.emit('skill:used', { slot: 'primary', skillId: 'test' }); f.emit('player:dashed'); f.hit(e);
  f.add('crossfire'); close(f.ctx.player.stats.get('damagePct'), 0.25);
  f.advance(4); f.switchTo(f.a); close(f.ctx.player.stats.get('damagePct'), 0.49);
  f.ctx.scrolls.resetForRun(); f.advance(0);
  assert.equal(f.ctx.tasks.size, 0); assert.equal(f.ctx.scrolls.owned().length, 0);
  close(f.ctx.player.stats.get('damagePct'), 0); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  const shield = f.ctx.player.shield, refunds = f.cooldowns.length, blasts = f.explosions.length;
  f.switchTo(f.b); f.emit('player:dashed'); f.hit(e, { forceCrit: true });
  f.emit('skill:used', { slot: 'secondary', skillId: 'test' }); f.emit('enemy:reaction', { depth: 0 });
  close(f.ctx.player.shield, shield); assert.equal(f.cooldowns.length, refunds); assert.equal(f.explosions.length, blasts);
  close(f.hit(e).dealt, 100);
});

test('loaded focus shares three charges across same-frame pellets and boosts headshots', () => {
  const f = fixture(); f.add('loaded_focus', 3); const e = f.enemy();
  f.emit('weapon:reloaded', { weapon: f.a });
  close(f.hit(e, { source: 'scroll' }).dealt, 100);
  close(f.hit(e, { procDepth: 1 }).dealt, 100);
  close(f.hit(e, { weaponUid: f.b.uid }).dealt, 100);
  close(f.hit(e, { base: 0 }).dealt, 0);
  for (let round = 0; round < 3; round++) {
    f.advance(0.01);
    for (let pellet = 0; pellet < 8; pellet++) close(f.hit(e).dealt, 175);
    // Headshots also crit in Combat; both bonuses must be applied exactly once.
    close(f.hit(e, { headshot: true }).dealt, 440);
  }
  f.advance(0.01); close(f.hit(e).dealt, 100);
  f.emit('weapon:reloaded', { weapon: f.a }); f.switchTo(f.b); f.switchTo(f.a);
  close(f.hit(e).dealt, 100);
  for (const event of ['stage:loaded', 'player:died']) {
    f.emit('weapon:reloaded', { weapon: f.a }); f.emit(event); close(f.hit(e).dealt, 100);
  }
  f.emit('weapon:reloaded', { weapon: f.a }); f.advance(8); close(f.hit(e).dealt, 100);
});

test('alternating arts refunds the previous skill, throttles pairs and never duplicates buffs', () => {
  const f = fixture(); f.add('alternating_arts', 3); const e = f.enemy();
  const use = slot => f.emit('skill:used', { slot, skillId: 'test' });
  use('primary'); use('secondary'); close(f.hit(e, { source: 'skill' }).dealt, 160);
  use('primary'); use('secondary'); assert.equal(f.cooldowns.length, 1);
  f.advance(3); use('primary');
  assert.deepEqual(f.cooldowns, [{ n: 4.5, slot: 'primary' }, { n: 4.5, slot: 'secondary' }]);
  close(f.ctx.player.stats.get('skillDamagePct'), 0.6);
  f.advance(6); use('secondary'); assert.equal(f.cooldowns.length, 2);
  close(f.ctx.player.stats.get('skillDamagePct'), 0);
  use('primary'); f.emit('player:died'); close(f.ctx.player.stats.get('skillDamagePct'), 0);
  f.ctx.player.alive = false; use('secondary'); assert.equal(f.cooldowns.length, 3);
});

test('reaction ward stores two hits, preserves invulnerable charges and expires / resets', () => {
  const f = fixture(); f.add('reaction_ward', 3);
  const rx = depth => f.emit('enemy:reaction', { depth });
  const damage = expected => { const hp = f.ctx.player.hp; f.ctx.combat.damagePlayer(10, 'none'); close(hp - f.ctx.player.hp, expected); };
  rx(1); damage(10);
  rx(0); rx(0); f.ctx.player.invulnerableTime = 1; damage(0);
  f.ctx.player.invulnerableTime = 0; damage(4); damage(10);
  f.advance(0.8); rx(0); f.advance(0.8); rx(0); f.advance(0.8); rx(0);
  damage(4); damage(4); damage(10); // Third reaction refreshes but cannot exceed two charges.
  f.advance(0.8); rx(0); f.advance(6); damage(10);
  rx(0); f.emit('stage:loaded'); damage(10);
  f.advance(0.8); rx(0); f.emit('player:died'); damage(10);
});

test('reaction ward refreshes the entire reserve and combines with ordinary reduction', () => {
  const f = fixture(); f.add('reaction_ward', 2); f.ctx.player.stats.add('damageReduction', 0.25, 'test');
  f.emit('enemy:reaction', { depth: 0 }); f.advance(5.9); f.emit('enemy:reaction', { depth: 0 });
  f.advance(0.2);
  const hp = f.ctx.player.hp;
  f.ctx.combat.damagePlayer(10, 'none'); f.ctx.combat.damagePlayer(10, 'none');
  close(hp - f.ctx.player.hp, 9);
});

test('critical battle intent accumulates across frames, caps, refreshes and excludes procs / purge', () => {
  const f = fixture(); f.ctx.scrolls.add('crit_streak'); const e = f.enemy();
  f.hit(e, { forceCrit: true, procDepth: 1 });
  f.hit(e, { forceCrit: true, source: 'scroll' });
  f.hit(e, { forceCrit: true, tags: ['purge'] });
  close(f.ctx.player.stats.get('critDamagePct'), 0);
  f.hit(e, { forceCrit: true }); f.hit(e, { forceCrit: true });
  close(f.ctx.player.stats.get('critDamagePct'), 0.06);
  for (let i = 0; i < 8; i++) { f.advance(0.1); f.hit(e, { forceCrit: true }); }
  close(f.ctx.player.stats.get('critDamagePct'), 0.3); close(f.ctx.player.stats.get('fireRatePct'), 0.075);
  f.advance(4.9); f.hit(e, { forceCrit: true }); f.advance(0.2);
  close(f.ctx.player.stats.get('critDamagePct'), 0.3);
  f.advance(4.8); close(f.ctx.player.stats.get('critDamagePct'), 0);
  f.hit(e, { forceCrit: true }); close(f.ctx.player.stats.get('critDamagePct'), 0.06);
  f.ctx.scrolls.add('crit_streak'); close(f.ctx.player.stats.get('critDamagePct'), 0);
  f.ctx.scrolls.add('crit_streak');
  for (let i = 0; i < 5; i++) { f.advance(0.1); f.hit(e, { forceCrit: true }); }
  close(f.ctx.player.stats.get('critDamagePct'), 0.9); close(f.ctx.player.stats.get('fireRatePct'), 0.225);
  for (const event of ['stage:loaded', 'player:died']) {
    f.emit(event); close(f.ctx.player.stats.get('critDamagePct'), 0); close(f.ctx.player.stats.get('fireRatePct'), 0);
    f.advance(0.1); f.hit(e, { forceCrit: true });
  }
  f.ctx.scrolls.resetForRun(); f.advance(0); assert.equal(f.ctx.tasks.size, 0);
});

test('meteor procs through real Combat, scales, throttles and cannot crit or recurse', () => {
  const f = fixture(); for (let i = 0; i < 3; i++) f.ctx.scrolls.add('meteor_shot');
  f.ctx.run.difficulty = 2; const e = f.enemy(); const stars = [];
  f.ctx.player.stats.add('critChance', 1, 'test'); f.ctx.player.stats.add('elementChancePct', 1, 'test');
  f.ctx.events.on('enemy:damaged', ({ result }) => { if (result.request.source === 'scroll') stars.push(result); });
  close(f.ctx.player.stats.get('projectileSpeedPct'), 0.6); close(f.ctx.player.stats.get('damagePct'), 0);
  const hp = e.hp; f.hit(e); close(hp - e.hp, 100 + 36 * 1.85);
  assert.equal(stars.length, 1); assert.equal(stars[0].isCrit, false);
  assert.equal(stars[0].request.procDepth, 1); assert.equal(stars[0].element, 'none'); assert.equal(e.statuses.size, 0);
  f.hit(e); assert.equal(stars.length, 1);
  f.advance(0.8); f.hit(e, { source: 'skill' }); f.hit(e, { procDepth: 1 }); f.hit(e, { tags: ['purge'] });
  assert.equal(stars.length, 1);
  // Hitscan / melee share source=weapon and need no projectile object or point.
  f.hit(e, { weaponUid: undefined }); assert.equal(stars.length, 2);
  f.ctx.scrolls.resetForRun(); f.advance(1); f.hit(e); assert.equal(stars.length, 2);
});

test('meteor does not spend cooldown on lethal, zero or untargetable direct hits', () => {
  const f = fixture(); f.ctx.scrolls.add('meteor_shot'); const e = f.enemy(); const doomed = f.enemy();
  doomed.hp = 10; f.hit(doomed); assert.equal(doomed.alive, false);
  f.hit(e, { base: 0 }); e.untargetable = true; f.hit(e); e.untargetable = false;
  f.hit(e); close(e.hp, 9888);
});

test('treasure bowl pays principal at zero coins and scales both layers, caps and chapters', () => {
  const f = fixture(); const changes = []; f.ctx.events.on('coins:changed', data => changes.push(data));
  f.ctx.scrolls.add('treasure_bowl'); close(f.ctx.run.coins, 0);
  const enter = chapter => f.emit('stage:loaded', { stage: { chapter } });
  enter(0); close(f.ctx.run.coins, 12); assert.deepEqual(changes.at(-1), { coins: 12, delta: 12 });
  f.ctx.run.coins = 200; enter(0); close(changes.at(-1).delta, 22);
  f.ctx.scrolls.add('treasure_bowl'); close(f.ctx.run.coins, 222);
  f.ctx.run.coins = 200; enter(0); close(changes.at(-1).delta, 44);
  f.ctx.run.coins = 10000; enter(0); close(changes.at(-1).delta, 84);
  f.ctx.run.coins = 10000; enter(2); close(changes.at(-1).delta, 143);
  f.ctx.player.alive = false; const coins = f.ctx.run.coins; enter(2); close(f.ctx.run.coins, coins);
  f.ctx.player.alive = true; f.ctx.scrolls.resetForRun(); enter(2); close(f.ctx.run.coins, coins);
});
