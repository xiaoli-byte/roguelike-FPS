import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const mode = moduleUrl(stripTypeScriptTypes(await readFile(new URL('../src/world/WhiteboxMode.ts', import.meta.url), 'utf8'), { mode: 'transform' }));
const source = stripTypeScriptTypes(await readFile(new URL('../src/progression/Meta.ts', import.meta.url), 'utf8'), { mode: 'transform' }).replaceAll("'../world/WhiteboxMode'", `'${mode}'`);

test('approved layouts are the game default; art and technical inspection share the isolated sandbox', async () => {
  const { usesAuthoredLayout, showsAuthoredArt, isWhiteboxMode } = await import(mode);
  const oldLocation = globalThis.location;
  try {
    for (const [pathname, search, layout, art, sandbox] of [
      ['/index.html', '', true, true, false],
      ['/index.html', '?classic', false, false, false],
      ['/index.html', '?layout=legacy', false, false, false],
      ['/adventure-lab.html', '', false, false, false],
      ['/details-lab.html', '?mode=scene', false, false, false],
      ['/whitebox-lab.html', '?look=art', true, true, true],
      ['/whitebox-lab.html', '?look=whitebox', true, false, true],
      ['/index.html', '?layout=whitebox', true, false, true],
    ]) {
      globalThis.location = { pathname, search };
      assert.equal(usesAuthoredLayout(), layout, pathname + search);
      assert.equal(showsAuthoredArt(), art, pathname + search);
      assert.equal(isWhiteboxMode(), sandbox, pathname + search);
    }
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  }
});

test('whitebox career awards use an isolated save, while the normal game retains its existing save', async () => {
  const oldLocation = globalThis.location, oldStorage = globalThis.localStorage;
  try {
    for (const [index, location] of [{ pathname: '/index.html', search: '' }, { pathname: '/whitebox-lab.html', search: '' }, { pathname: '/index.html', search: '?layout=whitebox' }].entries()) {
      const original = JSON.stringify({ version: 1, essence: 321, talents: {}, unlockedHeroes: ['fox'], stats: { runs: 2 } });
      const storage = new Map([['gunflame.meta.v1', original]]);
      globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
      globalThis.location = location;
      const { MetaProgress } = await import(moduleUrl(source + `\n// isolated scenario ${index}`));
      const meta = new MetaProgress({});
      assert.equal(meta.save.essence, index === 0 ? 321 : 0);
      meta.addEssence(50); meta.persist();
      assert.equal(JSON.parse(storage.get(index === 0 ? 'gunflame.meta.v1' : 'gunflame.whitebox.meta.v1')).essence, index === 0 ? 371 : 50);
      if (index !== 0) assert.equal(storage.get('gunflame.meta.v1'), original);
    }
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  }
});
