// 美术资产按需加载（src/assets/AssetLibrary.ts 的范围 / ensureBound / request / releaseUnused，src/assets/StageArt.ts 的本关集合）。
// 2026-11-25 实测：开局把全部角色读进来，游戏页渲染进程多占约 4.9 GB；敌人 / 首领改成进关按本关读、换关释放。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;

// ── AssetLibrary：GLTFLoader 换成桩，按 URL 现做一个带 _LOD0 网格和贴图的 glTF ──
let source = stripTypeScriptTypes(await readFile(new URL('../src/assets/AssetLibrary.ts', import.meta.url), 'utf8'), { mode: 'transform' });
source = source
  .replaceAll("'three'", `'${threeUrl}'`)
  .replaceAll("'three/examples/jsm/loaders/GLTFLoader.js'", `'${dataModule('export class GLTFLoader { setDRACOLoader() { return this; } loadAsync(url) { return globalThis.__gltf(url); } }')}'`)
  .replaceAll("'three/examples/jsm/loaders/DRACOLoader.js'", `'${dataModule('export class DRACOLoader { dispose() {} }')}'`)
  .replaceAll('import.meta.env.BASE_URL', "'/'");
const { AssetLibrary } = await import(dataModule(source));

const fetched = [];
const closed = new Set();
globalThis.__gltf = async (url) => {
  const id = url.replace(/^.*\//, '').replace(/\.glb$/, '');
  fetched.push(id);
  const map = new THREE.Texture();
  map.image = { width: 4, height: 4, close: () => closed.add(id) };
  const scene = new THREE.Group();
  // 名字带 Broken 的模拟枪火 1301：网格不按 _LOD0 命名，资产库读不出来
  scene.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map })), { name: id.includes('Broken') ? `${id}_part` : `${id}_LOD0` }));
  return { scene };
};

const entry = (id, bind) => [id, { url: `assets/x/${id}.glb`, kind: 'skeletal', class: 'x', bind, keepGlow: 'all', lodDistance: [0], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, sha256: '' }];
function reset(entries) {
  AssetLibrary.entries = Object.fromEntries(entries);
  AssetLibrary.manifestReady = Promise.resolve(true);
  AssetLibrary.loaded.clear();
  AssetLibrary.pending.clear();
  AssetLibrary.failed.clear();
  AssetLibrary.scopes.clear();
  fetched.length = 0;
  closed.clear();
}
const MANIFEST = [
  entry('SK_Hero_Fox', { source: 'hero', id: 'fox' }),
  entry('SK_Weapon_Smg', { source: 'weapon', id: 'smg' }),
  entry('SK_Enemy_Grunt', { source: 'enemy', id: 'grunt' }),
  entry('SM_EnemyWeapon_Scimitar', { source: 'enemy', id: 'grunt', attachment: 'scimitar' }),
  entry('SK_Enemy_Grunt_Frost', { source: 'enemy', id: 'grunt', variant: 'frost' }),
  entry('SK_Boss_Kun', { source: 'enemy', id: 'boss_kunpeng_kun' }),
  entry('SM_Tripo_Wall', { source: 'scene', id: 'wall' }),
];

test('core preload reads heroes only — no enemies, no weapons, no scene props', async () => {
  reset(MANIFEST);
  await AssetLibrary.preload('core');
  assert.deepEqual(fetched.sort(), ['SK_Hero_Fox']);
});

test('ensureBound reads the body and its attachments for the theme (default + themed), nothing else', async () => {
  reset(MANIFEST);
  await AssetLibrary.ensureBound('enemy', ['grunt'], 'desert');
  assert.deepEqual(fetched.sort(), ['SK_Enemy_Grunt', 'SM_EnemyWeapon_Scimitar']);
  assert.equal(AssetLibrary.findBound('enemy', 'grunt', 'desert').id, 'SK_Enemy_Grunt');
  assert.equal(AssetLibrary.findAttachments('enemy', 'grunt').length, 1);
  await AssetLibrary.ensureBound('enemy', ['grunt'], 'desert');
  assert.equal(fetched.length, 2, '已读的不重读');
});

test('releaseUnused frees on-demand assets outside keep, closes their decoded images, and they can be read again', async () => {
  reset(MANIFEST);
  await AssetLibrary.preload('core');
  await AssetLibrary.ensureBound('enemy', ['grunt', 'boss_kunpeng_kun']);
  await AssetLibrary.ensureBound('enemy', ['grunt'], 'frost');
  assert.ok(AssetLibrary.get('SK_Enemy_Grunt_Frost'), '带主题读：该主题的变体优先');
  await AssetLibrary.ensureBound('weapon', ['smg']);
  const kun = AssetLibrary.get('SK_Boss_Kun');
  let geometryDisposed = false;
  kun.lods[0].geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  const notified = [];
  AssetLibrary.onRelease((id) => notified.push(id));
  const released = AssetLibrary.releaseUnused(new Set(['SK_Enemy_Grunt', 'SM_EnemyWeapon_Scimitar']));
  assert.equal(released, 3, '鲲、frost 变体的小怪、手上没有的冲锋枪被释放');
  assert.deepEqual(notified.sort(), ['SK_Boss_Kun', 'SK_Enemy_Grunt_Frost', 'SK_Weapon_Smg'], '释放前通知（RigidParts 清拆分缓存）');
  assert.equal(AssetLibrary.get('SK_Boss_Kun'), null);
  assert.equal(AssetLibrary.get('SK_Weapon_Smg'), null);
  assert.ok(geometryDisposed);
  assert.ok(closed.has('SK_Boss_Kun') && closed.has('SK_Enemy_Grunt_Frost'));
  assert.ok(AssetLibrary.get('SK_Hero_Fox'), '英雄不归按需释放管');
  assert.ok(AssetLibrary.get('SK_Enemy_Grunt'));
  fetched.length = 0;
  await AssetLibrary.ensureBound('enemy', ['boss_kunpeng_kun']);
  assert.deepEqual(fetched, ['SK_Boss_Kun'], '释放后要用时再读');
});

test('two bodies bound to one weapon: only the higher priority one is read, a broken one falls back, the pick is stable', async () => {
  const weapons = [
    entry('SK_Weapon_Smg', { source: 'weapon', id: 'smg' }),
    [...entry('SK_Weapon_Gunfire1002', { source: 'weapon', id: 'smg' })].map((v, i) => (i === 1 ? { ...v, priority: 1 } : v)),
    entry('SK_Weapon_Shotgun', { source: 'weapon', id: 'shotgun' }),
    [...entry('SK_Weapon_BrokenShotgun', { source: 'weapon', id: 'shotgun' })].map((v, i) => (i === 1 ? { ...v, priority: 1 } : v)),
  ];
  reset(weapons);
  await AssetLibrary.ensureBound('weapon', ['smg', 'shotgun']);
  assert.deepEqual(fetched.sort(), ['SK_Weapon_BrokenShotgun', 'SK_Weapon_Gunfire1002', 'SK_Weapon_Shotgun'], '优先的读一份；读不出来才读下一份');
  assert.equal(AssetLibrary.findBound('weapon', 'smg').id, 'SK_Weapon_Gunfire1002');
  assert.equal(AssetLibrary.findBound('weapon', 'shotgun').id, 'SK_Weapon_Shotgun');
  // 检视页整批读：两份都在时也按 priority 取，不看哪份先读完
  reset(weapons);
  await AssetLibrary.ensureBound('weapon', ['smg']);
  AssetLibrary.loaded.delete('SK_Weapon_Gunfire1002');
  AssetLibrary.pending.delete('SK_Weapon_Gunfire1002');
  await AssetLibrary.loadIds(['SK_Weapon_Smg']);
  await AssetLibrary.loadIds(['SK_Weapon_Gunfire1002']);
  assert.equal(AssetLibrary.findBound('weapon', 'smg').id, 'SK_Weapon_Gunfire1002');
});

test('request starts a read for a known binding and says whether art will come', async () => {
  reset(MANIFEST);
  assert.equal(AssetLibrary.request('enemy', 'grunt'), true);
  assert.equal(AssetLibrary.request('enemy', 'sand_wraith'), false, '清单里没有模型的敌人');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(AssetLibrary.findBound('enemy', 'grunt'));
});

// ── StageArt：本关集合 ──
// 名册是生成的 TS 表（src/assets/stageRosters.ts）：去掉类型照原样读进来；StageArt 不碰关卡库、不读 unity-levels
const rostersSource = stripTypeScriptTypes(await readFile(new URL('../src/assets/stageRosters.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { STAGE_ROSTERS: rosters } = await import(dataModule(rostersSource.replaceAll("'./StageArt'", `'${dataModule('export {};')}'`)));
const stubs = {
  '../core/types': 'export {};',
  '../enemies/plateau': "export const PLATEAU_ENEMY_IDS = ['marmot', 'aoyin', 'liangu'];",
  './AssetLibrary': 'export const AssetLibrary = {};',
  './stageRosters': 'export const STAGE_ROSTERS = { maps: {}, chapters: {} };',
};
const stageText = await readFile(new URL('../src/assets/StageArt.ts', import.meta.url), 'utf8');
assert.ok(!/unity|UnityLevelLibrary/i.test(stageText.replace(/\/\*\*[\s\S]*?\*\//g, '')), 'StageArt 的代码里不能依赖 Unity（2026-11-26 用户要求）');
let stageSource = stripTypeScriptTypes(stageText, { mode: 'transform' });
for (const [spec, code] of Object.entries(stubs)) stageSource = stageSource.replaceAll(`'${spec}'`, `'${dataModule(code)}'`);
const { stageEnemyIds } = await import(dataModule(stageSource));

const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')).assets;
const known = new Set(Object.values(manifest).filter((e) => e.bind?.source === 'enemy').map((e) => e.bind.id));
const plateau = new Set(['marmot', 'tiangou', 'aoyin', 'leiyak', 'jufu', 'manman', 'liangu', 'dijiang', 'qiongqi']);

test('a chapter-3 boss stage reads its chapter roster plus both Qilin forms, not other chapters', () => {
  const ids = stageEnemyIds({ mapId: '3-4', chapter: 3, rosters, known, skip: plateau });
  assert.ok(ids.includes('boss_qilin_xuan') && ids.includes('boss_qilin_burn'), '首领按前缀展开到各形态');
  assert.ok(ids.includes('tantong') && ids.includes('fire_crow'), '火麒麟召的炭童、火鸦在本章名册里');
  assert.ok(!ids.includes('jerboa_blade') && !ids.includes('boss_hanba') && !ids.includes('boss_warlord'));
});

test('the Hanba stage has no waves but still reads what Hanba summons', () => {
  assert.deepEqual(rosters.maps['1-4'].enemies, [], '首领关没有波次');
  const ids = stageEnemyIds({ mapId: '1-4', chapter: 1, rosters, known, skip: plateau });
  for (const id of ['boss_hanba', 'apsara', 'scorpion_archer']) assert.ok(ids.includes(id), id);
});

test('chapter 4 reads the lords through AssetLibrary but leaves plateau foes to their own loader', () => {
  const ids = stageEnemyIds({ mapId: '4-1', chapter: 4, rosters, known, skip: plateau });
  assert.deepEqual(ids, ['boss_feilian', 'boss_huashe', 'boss_kui']);
});

test('a map missing from the table reads its chapter roster and every boss of the chapter; unknown ids are dropped', () => {
  const table = {
    maps: { '9-1': { chapter: 9, enemies: ['grunt', 'no_such_enemy'], bosses: [] }, '9-4': { chapter: 9, enemies: [], bosses: ['boss_kunpeng'] } },
    chapters: { 9: ['archer', 'grunt', 'no_such_enemy'] },
  };
  assert.deepEqual(stageEnemyIds({ mapId: '9-1', chapter: 9, rosters: table, known, skip: plateau }), ['archer', 'grunt']);
  assert.deepEqual(stageEnemyIds({ mapId: '9-B', chapter: 9, rosters: table, known, skip: plateau }), ['archer', 'boss_kunpeng_kun', 'boss_kunpeng_peng', 'grunt'],
    '新图还没进名册：首领按本章全部读，免得唯一的首领用程序化模型');
});

test('every enemy that appears in a chapter roster and has art is reachable from some stage', () => {
  for (const [chapter, list] of Object.entries(rosters.chapters)) {
    if (chapter === '4') continue;
    const mapIds = Object.keys(rosters.maps).filter((m) => rosters.maps[m].chapter === Number(chapter));
    const reached = new Set(mapIds.flatMap((mapId) => stageEnemyIds({ mapId, chapter: Number(chapter), rosters, known, skip: plateau })));
    for (const id of list) if (known.has(id)) assert.ok(reached.has(id), `${chapter} 章 ${id}`);
  }
});

// ── UnityLevelLibrary：换关释放上一张图的网格 / 贴图 / 场景文档 ──
let levelSource = stripTypeScriptTypes(await readFile(new URL('../src/world/UnityLevelLibrary.ts', import.meta.url), 'utf8'), { mode: 'transform' });
levelSource = levelSource
  .replaceAll("'three'", `'${threeUrl}'`)
  .replaceAll("'three/examples/jsm/loaders/GLTFLoader.js'", `'${dataModule('export class GLTFLoader { setDRACOLoader() { return this; } setMeshoptDecoder() { return this; } }')}'`)
  .replaceAll("'three/examples/jsm/loaders/DRACOLoader.js'", `'${dataModule('export class DRACOLoader {}')}'`)
  .replaceAll("'three/examples/jsm/libs/meshopt_decoder.module.js'", `'${dataModule('export const MeshoptDecoder = {};')}'`)
  .replaceAll('import.meta.env.BASE_URL', "'/'");
const { UnityLevelLibrary, documentUrls } = await import(dataModule(levelSource));

function fakeMesh(name, closedSet) {
  const map = new THREE.Texture();
  map.image = { close: () => closedSet.add(name) };
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map })));
  return { scene };
}

test('documentUrls collects renderers, terrain layers / splats, vegetation, colliders and ground cover', () => {
  const urls = documentUrls({
    renderers: [{ url: 'm/a.glb' }, { url: 'm/t.glb', terrain: { layers: [{ url: 't/l0.webp' }], alphamaps: ['t/s0.webp'] } }],
    vegetation: { prototypes: [{ url: 'm/tree.glb' }] },
    colliders: [{ url: 'm/col.glb' }, { kind: 'box' }],
    groundCover: [{ url: 'm/grass.glb', texture: 't/grass.webp' }, { url: null, texture: null }],
  });
  assert.deepEqual([...urls].sort(), ['m/a.glb', 'm/col.glb', 'm/grass.glb', 'm/t.glb', 'm/tree.glb', 't/grass.webp', 't/l0.webp', 't/s0.webp']);
});

test('releaseExcept frees the previous map but keeps what the next map shares', async () => {
  const lib = UnityLevelLibrary;
  const gone = new Set();
  lib.meshes.clear(); lib.textures.clear(); lib.scenes.clear();
  lib.meshes.set('m/old.glb', Promise.resolve(fakeMesh('old', gone)));
  lib.meshes.set('m/shared.glb', Promise.resolve(fakeMesh('shared', gone)));
  const oldLayer = new THREE.Texture(); oldLayer.image = { close: () => gone.add('oldLayer') };
  lib.textures.set('t/old.webp', Promise.resolve(oldLayer));
  lib.scenes.set('1-1', Promise.resolve({ id: '1-1' }));
  lib.scenes.set('3-4', Promise.resolve({ id: '3-4' }));
  const next = { id: '3-4', renderers: [{ url: 'm/shared.glb' }] };
  assert.equal(lib.releaseExcept(next), 2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...gone].sort(), ['old', 'oldLayer']);
  assert.deepEqual([...lib.meshes.keys()], ['m/shared.glb']);
  assert.deepEqual([...lib.scenes.keys()], ['3-4'], '只留这一张图的场景文档（4-3 一份 33 MB）');
  assert.equal(lib.releaseExcept(null), 1, '第一章重做版（文档现编）：全部释放');
});
