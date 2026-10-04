import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

// 直接测试生产 TypeScript，无需引入测试框架或生成临时编译文件。
async function moduleUrl(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [specifier, url] of Object.entries(imports)) source = source.replace(`'${specifier}'`, `'${url}'`);
  const outputText = stripTypeScriptTypes(source);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const filterUrl = await moduleUrl('../src/core/MouseLookFilter.ts');
const { MouseLookFilter } = await import(filterUrl);
const { Input } = await import(await moduleUrl('../src/core/Input.ts', { './MouseLookFilter': filterUrl }));
const sample = (filter, x, y, time) => ({ ...filter.sample(x, y, time) });

test('small aim corrections and large frame totals retain every pixel', () => {
  const filter = new MouseLookFilter();
  let total = 0;
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(sample(filter, 60, -8, i * 2), { x: 60, y: -8 });
    total += 60;
  }
  assert.equal(total, 720);
});

test('isolated sub-400px spikes are discarded without losing the following small movement', () => {
  for (const [x, y] of [[280, 0], [0, -280], [210, 210]]) {
    const filter = new MouseLookFilter();
    sample(filter, 2, 1, 0);
    assert.deepEqual(sample(filter, x, y, 8), { x: 0, y: 0 });
    assert.deepEqual(sample(filter, 3, -2, 16), { x: 3, y: -2 });
  }
});

test('sustained fast flicks confirm and restore buffered motion, including across frame boundaries', () => {
  const filter = new MouseLookFilter();
  sample(filter, 2, 0, 0);
  assert.deepEqual(sample(filter, 300, 0, 8), { x: 0, y: 0 });
  assert.deepEqual(sample(filter, 260, 0, 16), { x: 560, y: 0 });
  assert.deepEqual(sample(filter, 220, 0, 24), { x: 220, y: 0 });
});

test('fast flicks remain intact when mouse events are coalesced at 20fps', () => {
  const filter = new MouseLookFilter();
  sample(filter, 300, 0, 0);
  assert.deepEqual(sample(filter, 260, 0, 50), { x: 560, y: 0 });
  assert.deepEqual(sample(filter, 220, 0, 100), { x: 220, y: 0 });
});

test('stale or reset spikes cannot be replayed by later input', () => {
  const filter = new MouseLookFilter();
  sample(filter, 280, 0, 0);
  assert.deepEqual(sample(filter, 80, 0, 200), { x: 80, y: 0 });
  filter.reset();
  sample(filter, 280, 0, 208);
  filter.reset();
  assert.deepEqual(sample(filter, 80, 0, 216), { x: 80, y: 0 });
});

test('invalid and oversized packets discard both axes and never poison later aim', () => {
  for (const [x, y, time] of [[NaN, 10, 8], [20, Infinity, 8], [401, 12, 8], [12, -401, 8], [1, 1, NaN]]) {
    const filter = new MouseLookFilter();
    assert.deepEqual(sample(filter, x, y, time), { x: 0, y: 0 });
    assert.deepEqual(sample(filter, 4, 5, 16), { x: 4, y: 5 });
  }
});

function surface() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn(event); },
  };
}

function fixture() {
  const win = surface();
  const doc = Object.assign(surface(), { hidden: false, pointerLockElement: null });
  const canvas = Object.assign(surface(), { requestPointerLock() {} });
  let now = 0;
  globalThis.window = win;
  globalThis.document = doc;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const input = new Input(canvas);
  return {
    win, doc, canvas, input,
    lock() { doc.pointerLockElement = canvas; doc.emit('pointerlockchange'); },
    move(x, y, time) { now = time; win.emit('mousemove', { movementX: x, movementY: y, timeStamp: time }); },
  };
}

test('locking guards cursor warp, frame reset keeps fast-flick confirmation, unlocking flushes motion', () => {
  const f = fixture();
  f.lock();
  f.move(300, 0, 10);
  assert.equal(f.input.mouseDX, 0);
  f.move(10, 4, 60);
  assert.equal(f.input.mouseDX, 10);
  f.input.endFrame();
  f.move(300, 0, 68);
  f.input.endFrame();
  f.move(200, 0, 76);
  assert.equal(f.input.mouseDX, 500);
  f.doc.pointerLockElement = null;
  f.doc.emit('pointerlockchange');
  assert.equal(f.input.mouseDX, 0);
  assert.equal(f.input.mouseDY, 0);
});

test('blur, visibility changes and disabled input cannot leave queued view movement', () => {
  const f = fixture();
  f.input.freeLook = true;
  f.move(10, 2, 60);
  f.win.emit('blur');
  f.move(20, 3, 68);
  assert.equal(f.input.mouseDX, 0);
  f.win.emit('focus');
  f.move(4, 1, 76);
  assert.equal(f.input.mouseDX, 4);
  f.doc.hidden = true;
  f.doc.emit('visibilitychange');
  f.move(50, 10, 84);
  assert.equal(f.input.mouseDX, 0);
  f.doc.hidden = false;
  f.input.enabled = false;
  f.move(50, 10, 92);
  assert.equal(f.input.mouseDX, 0);
  f.input.enabled = true;
  f.move(5, 0, 100);
  assert.equal(f.input.mouseDX, 5);
});

test('raw mouse lock falls back only for unsupported raw input', async () => {
  const f = fixture();
  const calls = [];
  f.canvas.requestPointerLock = async (options) => {
    calls.push(options);
    if (options?.unadjustedMovement) throw new DOMException('Unsupported', 'NotSupportedError');
  };
  f.input.requestLock();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ unadjustedMovement: true }, undefined]);
  calls.length = 0;
  f.canvas.requestPointerLock = async (options) => {
    calls.push(options);
    throw new DOMException('No user gesture', 'NotAllowedError');
  };
  f.input.requestLock();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ unadjustedMovement: true }]);
});

test('overlapping requests do not request pointer lock twice', async () => {
  const f = fixture();
  let calls = 0;
  let resolve;
  f.canvas.requestPointerLock = () => { calls++; return new Promise((done) => { resolve = done; }); };
  f.input.requestLock();
  f.input.requestLock();
  assert.equal(calls, 1);
  resolve();
  await new Promise((done) => setImmediate(done));
});
