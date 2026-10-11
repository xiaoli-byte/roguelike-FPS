/** Support buffs (邪飞天): auras do not stack, blessings expire / end with their source, and every multiplier comes off exactly. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(await readFile(new URL('../src/enemies/SupportBuffs.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { BuffRegistry } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const AURA = { damage: 1.35, rate: 1.35, speed: 1.2, taken: 0.75 };
const BLESS = { damage: 1.6, rate: 1.5, speed: 1.15, taken: 0.5 };
const ally = (o = {}) => ({ alive: true, damageMult: 1, attackRate: 1, speedMult: 1, ...o });
const src = () => ({ alive: true, silenced: false });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('an aura multiplies damage, attack rate and speed and lowers damage taken', () => {
  const r = new BuffRegistry(AURA, BLESS), a = ally(), s = src();
  r.addAura(a, s, 0);
  close(a.damageMult, 1.35); close(a.attackRate, 1.35); close(a.speedMult, 1.2);
  close(r.taken(a), 0.75);
  r.removeAura(a, s, 1);
  close(a.damageMult, 1); close(a.attackRate, 1); close(a.speedMult, 1);
  assert.equal(r.map.size, 0);
  close(r.taken(a), 1);
});

test('two sources do not stack the aura, and it lasts until the last source leaves', () => {
  const r = new BuffRegistry(AURA, BLESS), a = ally(), s1 = src(), s2 = src();
  r.addAura(a, s1, 0); r.addAura(a, s2, 0);
  close(a.damageMult, 1.35);
  r.removeAura(a, s1, 1);
  close(a.damageMult, 1.35);
  r.removeAura(a, s2, 2);
  close(a.damageMult, 1);
});

test('a blessing stacks on the aura, expires on time and calls back once', () => {
  const r = new BuffRegistry(AURA, BLESS), a = ally(), s = src();
  let unbless = 0;
  r.addAura(a, s, 0);
  const b = r.grantBless(a, s, 10, 0);
  b.fx.onUnbless = () => unbless++;
  close(a.damageMult, 1.35 * 1.6); close(a.attackRate, 1.35 * 1.5); close(r.taken(a), 0.75 * 0.5);
  r.tick(9.9);
  close(a.damageMult, 1.35 * 1.6);
  r.tick(10);
  close(a.damageMult, 1.35); close(r.taken(a), 0.75);
  assert.equal(unbless, 1);
  r.tick(11);
  assert.equal(unbless, 1);
});

test('a silenced or dead source drops everything it gave (aura and blessing)', () => {
  const r = new BuffRegistry(AURA, BLESS), a = ally(), b2 = ally(), s = src();
  r.addAura(a, s, 0); r.addAura(b2, s, 0); r.grantBless(a, s, 99, 0);
  s.silenced = true;
  r.tick(1);
  close(a.damageMult, 1); close(b2.damageMult, 1);
  assert.equal(r.map.size, 0);
  const s2 = src(), c = ally();
  r.addAura(c, s2, 2);
  s2.alive = false;
  r.dropSource(s2, 3);
  close(c.damageMult, 1);
});

test('other multiplicative modifiers survive the buff coming and going (e.g. an elite affix)', () => {
  const r = new BuffRegistry(AURA, BLESS), a = ally({ damageMult: 1.25 }), s = src();
  r.addAura(a, s, 0);
  a.damageMult *= 1.2;            // an affix applied while buffed
  a.attackRate *= 1.5;
  r.removeAura(a, s, 1);
  close(a.damageMult, 1.25 * 1.2);
  close(a.attackRate, 1.5);
});

test('allies without attack rate / speed fields only get the damage part; dead allies are left alone', () => {
  const r = new BuffRegistry(AURA, BLESS), s = src();
  const plain = { alive: true, damageMult: 1 };
  r.addAura(plain, s, 0);
  close(plain.damageMult, 1.35);
  assert.equal(plain.attackRate, undefined);
  const a = ally();
  let cleared = 0;
  const st = r.addAura(a, s, 0);
  st.fx.onClear = () => cleared++;
  a.alive = false;
  r.tick(1);
  close(a.damageMult, 1.35);      // a corpse keeps its numbers; it is about to be removed anyway
  assert.equal(cleared, 1);
  assert.equal(r.get(a), undefined);
});

test('several allies dying on the same frame are all cleared in one tick (deleting while iterating)', () => {
  const r = new BuffRegistry(AURA, BLESS), s = src();
  const allies = [ally(), ally(), ally(), ally()];
  let cleared = 0;
  for (const a of allies) r.addAura(a, s, 0).fx.onClear = () => cleared++;
  allies[0].alive = false; allies[2].alive = false; allies[3].removed = true;
  r.tick(1);
  assert.equal(cleared, 3);
  assert.equal(r.map.size, 1);
  close(allies[1].damageMult, 1.35);
  r.dropSource(s, 2);
  assert.equal(r.map.size, 0);
  close(allies[1].damageMult, 1);
});
