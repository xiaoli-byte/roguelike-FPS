import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

// Load the production profiler directly; no generated output or browser is needed.
const source = stripTypeScriptTypes(await readFile(new URL('../src/dev/PerformanceMeter.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { PerformanceMeter } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.document = { hidden: false };

function fixture(gl = {}) {
  let timestamp = 0;
  const metadata = { quality: 'medium', theme: 'inferno', gameState: 'playing' };
  const renderer = {
    getContext: () => gl,
    getPixelRatio: () => 1.25,
    domElement: { width: 1600, height: 900, clientWidth: 1280, clientHeight: 720 },
    info: {
      autoReset: true,
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 11, textures: 7 },
      programs: [1, 2],
      reset() { this.render.calls = this.render.triangles = this.render.points = this.render.lines = 0; },
    },
  };
  const meter = new PerformanceMeter(renderer, () => ({ ...metadata }));
  const frame = (interval = 1000 / 60, draw = () => {}) => {
    timestamp += interval;
    gl.tick?.();
    meter.beginFrame(timestamp);
    meter.endUpdate();
    meter.beginRender();
    draw(renderer.info.render);
    meter.endRender();
  };
  const warm = () => { for (let i = 0; i < 30; i++) frame(); };
  return { meter, renderer, metadata, frame, warm };
}

test('RAF report retains long real frame intervals rather than the gameplay dt clamp', () => {
  const { meter, frame, warm } = fixture();
  meter.sample(); warm();
  // 180 normal 20 ms frames plus 60 actual 140 ms stalls = 12 seconds.
  for (let i = 0; i < 240; i++) frame(i % 4 === 0 ? 140 : 20);
  assert.equal(meter.state, 'complete');
  assert.equal(meter.report.frames, 240);
  assert.equal(meter.report.rafMs.median, 20);
  assert.equal(meter.report.rafMs.p95, 140);
  assert.equal(meter.report.rafMs.mean, 50);
  assert.equal(meter.report.fps, 20);
  assert.ok(meter.report.updateMs.median >= 0);
  assert.ok(meter.report.renderSubmitMs.median >= 0);
});

test('exactly 30 warmup and 240 recorded frames latch a report until sampling restarts', () => {
  const { meter, frame, metadata } = fixture();
  assert.equal(meter.state, 'idle');
  meter.sample();
  for (let i = 0; i < 30; i++) {
    frame(); assert.equal(meter.progress, 0); assert.equal(meter.report, null);
  }
  for (let i = 0; i < 239; i++) frame();
  assert.equal(meter.progress, 239);
  assert.equal(meter.state, 'sampling');
  assert.equal(meter.report, null);
  frame();
  const latched = meter.report;
  assert.equal(meter.state, 'complete');
  assert.equal(latched.warmupFrames, 30);
  assert.equal(latched.frames, 240);
  assert.ok(Math.abs(latched.fps - 60) < 1e-9);
  assert.deepEqual(latched.gpu, { status: 'unavailable', samples: 0, ms: null, disjointEvents: 0 });
  metadata.theme = 'frost';
  for (let i = 0; i < 15; i++) frame(100);
  assert.equal(meter.report, latched);
  assert.equal(meter.report.metadata.theme, 'inferno');

  meter.sample();
  assert.equal(meter.state, 'warmup');
  assert.equal(meter.progress, 0);
  assert.equal(meter.report, null);
  for (let i = 0; i < 270; i++) frame(20);
  assert.equal(meter.state, 'complete');
  assert.notEqual(meter.report, latched);
  assert.equal(meter.report.frames, 240);
  assert.equal(meter.report.fps, 50);
  assert.equal(meter.report.metadata.theme, 'frost');
});

test('world and first-person render statistics accumulate together and reset once per frame', () => {
  const { meter, frame, warm, renderer } = fixture();
  assert.equal(renderer.info.autoReset, false);
  meter.sample(); warm();
  for (let i = 0; i < 240; i++) frame(20, render => {
    // World (including shadows), then the first-person scene.
    render.calls += 10; render.triangles += 8000; render.points += 100; render.lines += 4;
    render.calls += 3; render.triangles += 2000; render.points += 25; render.lines += 2;
  });
  assert.deepEqual(meter.report.render, { calls: 13, triangles: 10000, points: 125, lines: 6, geometries: 11, textures: 7, programs: 2 });
  assert.deepEqual(meter.report.resolution, { width: 1600, height: 900, cssWidth: 1280, cssHeight: 720, pixelRatio: 1.25 });
  assert.deepEqual(meter.report.metadata, { quality: 'medium', theme: 'inferno', gameState: 'playing' });
  frame();
  assert.deepEqual(renderer.info.render, { calls: 0, triangles: 0, points: 0, lines: 0 });
});

test('GPU results poll asynchronously with bounded queries, disjoint recovery and restart cleanup', () => {
  let tick = 0, active = null, maximum = 0, created = 0, returned = 0, disjoint = false;
  const live = new Set();
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    tick() { tick++; },
    getExtension(name) { assert.equal(name, 'EXT_disjoint_timer_query_webgl2'); return extension; },
    createQuery() {
      const query = { issued: tick, ended: false, draws: [] };
      live.add(query); created++; maximum = Math.max(maximum, live.size); return query;
    },
    beginQuery(target, query) { assert.equal(target, 1); assert.equal(active, null); active = query; },
    endQuery(target) { assert.equal(target, 1); assert.ok(active); active.ended = true; active = null; },
    deleteQuery(query) { assert.ok(live.delete(query), 'each query must be deleted exactly once'); },
    getParameter(target) {
      assert.equal(target, 2);
      if (tick === 130 && !disjoint) { disjoint = true; return true; }
      return false;
    },
    getQueryParameter(query, parameter) {
      assert.ok(query.ended);
      if (parameter === this.QUERY_RESULT_AVAILABLE) return tick - query.issued >= 35;
      assert.equal(parameter, this.QUERY_RESULT);
      assert.ok(tick - query.issued >= 35, 'never read an unavailable result');
      assert.deepEqual(query.draws, ['world', 'view'], 'one GPU query must surround both scenes');
      returned++;
      return query.issued < 130 ? 1000000 : 9250000;
    },
    finish() { assert.fail('GPU sampling must never synchronously wait'); },
  };
  const { meter, frame, warm } = fixture(gl);
  const draw = () => { if (active) active.draws.push('world', 'view'); };
  meter.sample(); warm();
  for (let i = 0; i < 10; i++) frame(20, draw);
  assert.ok(live.size > 0);
  meter.sample();
  assert.equal(live.size, 0, 'restart releases in-flight queries');
  warm();
  for (let i = 0; i < 400 && meter.state !== 'complete'; i++) frame(20, draw);
  assert.equal(meter.state, 'complete');
  assert.equal(meter.report.frames, 240);
  assert.equal(meter.report.gpu.status, 'available');
  assert.equal(meter.report.gpu.disjointEvents, 1);
  assert.equal(meter.report.gpu.ms.median, 9.25, 'disjoint invalidates earlier GPU timings');
  assert.ok(meter.report.gpu.samples > 0 && returned > 0);
  assert.ok(created > 0);
  assert.ok(maximum <= 4, `pending queries exceeded the cap: ${maximum}`);
  assert.equal(active, null);
  assert.equal(live.size, 0, 'completion releases every remaining query');
});
