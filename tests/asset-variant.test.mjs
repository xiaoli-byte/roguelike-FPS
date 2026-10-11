/** Chapter variants of enemy art: bind.variant picks the themed body / attachments, otherwise the default asset. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let source = stripTypeScriptTypes(await readFile(new URL('../src/assets/AssetLibrary.ts', import.meta.url), 'utf8'), { mode: 'transform' });
source = source
  .replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`)
  .replaceAll("'three/examples/jsm/loaders/GLTFLoader.js'", `'${dataModule('export class GLTFLoader {}')}'`)
  .replaceAll("'three/examples/jsm/loaders/DRACOLoader.js'", `'${dataModule('export class DRACOLoader {}')}'`)
  .replaceAll('import.meta.env.BASE_URL', "'/'");
const { AssetLibrary } = await import(dataModule(source));

const asset = (id, bind) => ({ id, entry: { bind }, gltf: null, lods: [] });
const put = (...assets) => {
  const loaded = AssetLibrary.loaded;
  loaded.clear();
  for (const a of assets) loaded.set(a.id, a);
};

test('findBound prefers the chapter variant and falls back to the default body', () => {
  put(asset('SK_Enemy_Grunt_Frost', { source: 'enemy', id: 'grunt', variant: 'frost' }),
    asset('SK_Enemy_Grunt', { source: 'enemy', id: 'grunt' }),
    asset('SM_EnemyWeapon_Scimitar', { source: 'enemy', id: 'grunt', attachment: 'scimitar' }));
  assert.equal(AssetLibrary.findBound('enemy', 'grunt', 'frost').id, 'SK_Enemy_Grunt_Frost');
  assert.equal(AssetLibrary.findBound('enemy', 'grunt', 'inferno').id, 'SK_Enemy_Grunt');
  assert.equal(AssetLibrary.findBound('enemy', 'grunt').id, 'SK_Enemy_Grunt');
  assert.equal(AssetLibrary.findBound('enemy', 'archer', 'frost'), null);
});

test('findAttachments swaps the whole themed set or keeps the default set', () => {
  put(asset('SM_EnemyWeapon_Scimitar', { source: 'enemy', id: 'grunt', attachment: 'scimitar' }),
    asset('SM_EnemyWeapon_IceAxe', { source: 'enemy', id: 'grunt', attachment: 'scimitar', variant: 'frost' }));
  assert.deepEqual(AssetLibrary.findAttachments('enemy', 'grunt', 'frost').map(a => a.id), ['SM_EnemyWeapon_IceAxe']);
  assert.deepEqual(AssetLibrary.findAttachments('enemy', 'grunt', 'desert').map(a => a.id), ['SM_EnemyWeapon_Scimitar']);
  assert.deepEqual(AssetLibrary.findAttachments('enemy', 'grunt').map(a => a.id), ['SM_EnemyWeapon_Scimitar']);
});
