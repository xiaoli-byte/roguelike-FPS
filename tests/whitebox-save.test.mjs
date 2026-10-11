import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const mode = moduleUrl(stripTypeScriptTypes(await readFile(new URL('../src/world/WhiteboxMode.ts', import.meta.url), 'utf8'), { mode: 'transform' }));
const source = stripTypeScriptTypes(await readFile(new URL('../src/progression/Meta.ts', import.meta.url), 'utf8'), { mode: 'transform' }).replaceAll("'../world/WhiteboxMode'", `'${mode}'`);

test('approved layouts are the game default; art and technical inspection share the isolated sandbox', async () => {
  const { usesAuthoredLayout, showsAuthoredArt, isWhiteboxMode, usesRedesignLayout } = await import(mode);
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
      ['/whitebox-lab', '?look=art', true, true, true],
      ['/whitebox-lab/', '', true, false, true],
      ['/whitebox-labs.html', '', true, true, false],
    ]) {
      globalThis.location = { pathname, search };
      assert.equal(usesAuthoredLayout(), layout, pathname + search);
      assert.equal(showsAuthoredArt(), art, pathname + search);
      assert.equal(isWhiteboxMode(), sandbox, pathname + search);
    }
    // V2 plans ship by default (in the game and the lab); ?plan=ld03 brings back the LD-03 plans for comparison.
    // Only shipped chapters (desert, frost) use V2 by default; ?plan=v2 previews unshipped chapters too.
    for (const [pathname, search, theme, redesign] of [['/index.html', '', 'desert', true], ['/index.html', '', 'frost', true], ['/index.html', '', 'inferno', false],
      ['/index.html', '?plan=v2', 'inferno', true], ['/index.html', '?plan=ld03', 'frost', false],
      ['/index.html', '?plan=v2', 'frost', true], ['/index.html', '?plan=ld03', 'desert', false],
      ['/whitebox-lab.html', '?look=art', 'desert', true], ['/whitebox-lab.html', '?look=art', 'inferno', false],
      ['/whitebox-lab.html', '?plan=v2&look=art', 'inferno', true], ['/whitebox-lab.html', '?plan=ld03&look=art', 'desert', false]]) {
      globalThis.location = { pathname, search };
      assert.equal(usesRedesignLayout(theme), redesign, pathname + search + ' ' + theme);
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

test('the lab save stays isolated when its script tags the URL only after every module has loaded', async () => {
  const oldLocation = globalThis.location, oldStorage = globalThis.localStorage;
  try {
    const original = JSON.stringify({ version: 1, essence: 321, talents: {}, unlockedHeroes: ['fox'], stats: { runs: 2 } });
    const storage = new Map([['gunflame.meta.v1', original]]);
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    globalThis.location = { pathname: '/whitebox-lab', search: '' };
    const { MetaProgress } = await import(moduleUrl(source + `
// late-tag scenario`));
    globalThis.location = { pathname: '/whitebox-lab', search: '?layout=whitebox&debug=1' };
    const meta = new MetaProgress({}); meta.addEssence(500); meta.persist();
    assert.equal(storage.get('gunflame.meta.v1'), original, 'real career untouched');
    assert.equal(JSON.parse(storage.get('gunflame.whitebox.meta.v1')).essence, 500);
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  }
});
