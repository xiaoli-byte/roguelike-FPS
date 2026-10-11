import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(await readFile(new URL('../src/world/ShadowCadence.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { ShadowCadence, ShadowFollow, SHADOW_FOLLOW_HALF, SHADOW_FOLLOW_STEP } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('full-resolution shadow refresh stays near 30 Hz across 50/60/120/144 Hz render loops', () => {
  for (const fps of [50, 60, 120, 144]) {
    const cadence = new ShadowCadence();
    let refreshes = 0, last = 0, maxGap = 0;
    for (let frame = 0; frame <= fps * 4; frame++) {
      if (!cadence.advance(1 / fps, 10)) continue;
      const now = frame / fps;
      if (refreshes) maxGap = Math.max(maxGap, now - last);
      last = now; refreshes++;
    }
    assert.ok(refreshes >= 120 && refreshes <= 121, `${fps} Hz produced ${refreshes} updates`);
    assert.ok(maxGap <= 1 / 30 + 1 / fps + 1e-6, 'animated caster shadows must not be left stale');
  }
});

test('new collision revisions force immediate map refresh without waiting for the next interval', () => {
  const cadence = new ShadowCadence();
  assert.equal(cadence.advance(0, 1), true);
  assert.equal(cadence.advance(.005, 1), false);
  assert.equal(cadence.advance(0, 2), true);
  assert.equal(cadence.advance(.005, 2), false);
  assert.equal(cadence.advance(.029, 2), true);
});

test('pause, non-finite deltas and frame stalls do not trigger refresh loops or poison the cadence', () => {
  const cadence = new ShadowCadence();
  cadence.advance(0, 1);
  for (const dt of [0, 0, -1, NaN, Infinity]) assert.equal(cadence.advance(dt, 1), false);
  assert.equal(cadence.advance(.5, 1), true);
  assert.equal(cadence.advance(0, 1), false);
  assert.equal(cadence.advance(1 / 30, 1), true);
});

test('the player-following shadow box moves in whole strides and always keeps the player near its centre', () => {
  // A sun basis tilted like the desert sun: right is horizontal, up leans back along the light.
  const len = Math.hypot(.35, .9, .25), d = { x: .35 / len, y: .9 / len, z: .25 / len };
  const rl = Math.hypot(d.z, d.x), right = { x: d.z / rl, y: 0, z: -d.x / rl };
  const up = { x: d.y * right.z - d.z * right.y, y: d.z * right.x - d.x * right.z, z: d.x * right.y - d.y * right.x };
  const follow = new ShadowFollow({ x: 0, y: 0, z: 0 }, right, up);
  const centre = { x: 0, y: 0, z: 0 };
  let redraws = 0, travelled = 0, prev = { x: 0, y: 0, z: 0 };
  for (let t = 0; t <= 400; t += .05) {
    const p = { x: Math.sin(t * .07) * 110, y: t % 7 < 1 ? 3 : 0, z: Math.cos(t * .05) * 40 + t * .1 };
    travelled += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p;
    const s = follow.follow(p);
    if (s) {
      redraws++;
      centre.x += s.x; centre.y += s.y; centre.z += s.z;
      // Whole strides across the light view only (texel-aligned at every map size).
      for (const axis of [right, up]) {
        const k = (s.x * axis.x + s.y * axis.y + s.z * axis.z) / SHADOW_FOLLOW_STEP;
        assert.ok(Math.abs(k - Math.round(k)) < 1e-9, 'shift is a whole number of strides');
      }
    }
    for (const axis of [right, up]) {
      const off = (p.x - centre.x) * axis.x + (p.y - centre.y) * axis.y + (p.z - centre.z) * axis.z;
      assert.ok(Math.abs(off) <= SHADOW_FOLLOW_STEP / 2 + 1e-9, `player ${off.toFixed(2)} m off the box centre`);
    }
  }
  assert.ok(SHADOW_FOLLOW_HALF - SHADOW_FOLLOW_STEP / 2 >= 48, 'at least 48 m of shadow around the player');
  assert.ok(redraws > 0 && redraws <= travelled / SHADOW_FOLLOW_STEP * 1.6 + 2, `${redraws} redraws over ${travelled.toFixed(0)} m`);
  assert.ok(Number.isInteger(2 * SHADOW_FOLLOW_HALF / SHADOW_FOLLOW_STEP), 'the box is a whole number of strides');
  for (const size of [1024, 2048, 4096]) assert.ok(Number.isInteger(SHADOW_FOLLOW_STEP / (2 * SHADOW_FOLLOW_HALF / size)), `${size}: stride is whole texels`);
});
