import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const mode = moduleUrl(stripTypeScriptTypes(await readFile(new URL('../src/world/WhiteboxMode.ts', import.meta.url), 'utf8'), { mode: 'transform' }));
// M11d：Meta 的落盘在 core/SaveService（正式档 spiritfire.save/profile.json、白盒检视页用调试档 profile.dev.json）；
// 老键 gunflame.meta.v1 / gunflame.whitebox.meta.v1 只在第一次读时导入，不再写。importTs 递归载入 Meta 的相对依赖。
const { importTs } = await import('./hanba-load.mjs');
const { MetaProgress } = await importTs('../src/progression/Meta.ts');
const { SaveService } = await importTs('../src/core/SaveService.ts');
SaveService.deferWrites = false;
const MAIN = 'spiritfire.save/profile.json', DEV = 'spiritfire.save/profile.dev.json';
const essenceIn = (storage, key) => JSON.parse(storage.get(key)).sections.meta.data.essence;

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
      const meta = new MetaProgress({});
      assert.equal(meta.save.essence, index === 0 ? 321 : 0);
      meta.addEssence(50); meta.persist();
      // 正常游戏：老存档导入后写进正式档；白盒检视页：只写调试档
      assert.equal(essenceIn(storage, index === 0 ? MAIN : DEV), index === 0 ? 371 : 50);
      assert.equal(storage.has(index === 0 ? DEV : MAIN), false, 'the other profile is never written');
      assert.equal(storage.get('gunflame.meta.v1'), original, 'the pre-M11d key is imported once and never rewritten');
      assert.equal(storage.has('gunflame.whitebox.meta.v1'), false);
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
    globalThis.location = { pathname: '/whitebox-lab', search: '?layout=whitebox&debug=1' };
    const meta = new MetaProgress({}); meta.addEssence(500); meta.persist();
    assert.equal(storage.get('gunflame.meta.v1'), original, 'real career untouched');
    assert.equal(storage.has(MAIN), false, 'real profile untouched');
    assert.equal(essenceIn(storage, DEV), 500);
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  }
});
