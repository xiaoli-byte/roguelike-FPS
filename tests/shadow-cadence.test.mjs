import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(await readFile(new URL('../src/world/ShadowCadence.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { ShadowCadence } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

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
