import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const defs = JSON.parse(await readFile(new URL('public/assets/unity-gameplay/defs.json', root), 'utf8'));

test('Unity exports complete gameplay registries', () => {
  assert.equal(defs.heroes.length, 3);
  assert.equal(defs.enemies.length, 40);
  assert.equal(defs.weapons.length, 18);
  assert.equal(defs.bosses.length, 9);
});

test('hero base stats match Unity', () => {
  const heroes = Object.fromEntries(defs.heroes.map(hero => [hero.id, hero]));
  assert.deepEqual(heroes.fox, { ...heroes.fox, maxHp: 100, maxShield: 60, moveSpeed: 7.8, startWeapon: 'smg' });
  assert.deepEqual(heroes.falcon, { ...heroes.falcon, maxHp: 90, maxShield: 70, moveSpeed: 7.5, startWeapon: 'revolver' });
  assert.deepEqual(heroes.bear, { ...heroes.bear, maxHp: 140, maxShield: 80, moveSpeed: 7, startWeapon: 'shotgun' });
});

test('weapon combat stats match Unity', () => {
  const weapons = Object.fromEntries(defs.weapons.map(weapon => [weapon.id, weapon]));
  for (const [id, expected] of Object.entries({
    smg: { damage: 11, fireRate: 13, mag: 36, reserve: 252, reloadTime: 1.7000000476837158 },
    revolver: { damage: 38, fireRate: 3.5, mag: 8, reserve: 64, reloadTime: 1.600000023841858 },
    railgun: { damage: 155, fireRate: 2, mag: 6, reserve: 36, reloadTime: 2.4000000953674316 },
  })) {
    const weapon = weapons[id];
    assert.ok(weapon, id);
    for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(weapon[key] - value) < 1e-6, `${id}.${key}`);
  }
});

test('boss definitions use Unity vitals and include all current chapter bosses', () => {
  const bosses = Object.fromEntries(defs.bosses.map(boss => [boss.id, boss]));
  for (const id of ['boss_hanba', 'boss_kunpeng', 'boss_qilin', 'boss_warlord']) {
    assert.ok(bosses[id], id);
    assert.ok(bosses[id].vitals.hp > 0, id);
  }
});

test('Hanba has its own registered three-phase behavior and Unity vitals', async () => {
  const [source, def, plans, registry, adapter] = await Promise.all([
    readFile(new URL('../src/enemies/bosses/Hanba.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/bosses/HanbaDef.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/bosses/HanbaPlans.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/bosses/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/world/UnitySceneAdapter.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /id: 'boss_hanba'/);
  assert.match(source, /hp: 7700 \/ 1\.48, shield: 3850 \/ 1\.48/);
  assert.match(source, /extends BossBrain/);
  assert.match(def, /ScorchedAt = 0\.6/);
  assert.match(def, /RedEarthAt = 0\.3/);
  assert.match(def, /TierHp = 7700/);
  assert.match(def, /TierShield = 3850/);
  for (const id of ['sun_sweep', 'hot_wind', 'sand_wraiths', 'scorch_crack', 'apsara_call', 'eclipse']) assert.ok(plans.includes(`id: '${id}'`), id);
  assert.match(registry, /new Hanba\(ctx, opts\)/);
  assert.ok(adapter.includes("boss_hanba: 'boss_hanba'"));
  assert.ok(!adapter.includes("boss_hanba: 'boss_colossus'"));
});

test('Sand wraith has its Unity burrow behavior and registration', async () => {
  const [source, registry] = await Promise.all([
    readFile(new URL('../src/enemies/types/SandWraith.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/index.ts', import.meta.url), 'utf8'),
  ]);
  const unity = defs.enemies.find(enemy => enemy.id === 'sand_wraith');
  assert.equal(unity.hp, 55);
  assert.ok(Math.abs(unity.speed - 5.6) < 1e-6);
  assert.match(source, /id: 'sand_wraith'/);
  assert.match(source, /scale: 1\.4, hp: 55, speed: 5\.6, damage: 12/);
  for (const state of ['sink', 'burrow', 'surface', 'erupt', 'recover']) assert.ok(source.includes(`'${state}'`), state);
  assert.match(registry, /new SandWraith\(ctx, opts\)/);
});

test('all eight Unity plateau enemies reuse native AI, models and exact hit spheres', async () => {
  const [registry, adapter, plateauIndex, foes] = await Promise.all([
    readFile(new URL('../src/enemies/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/plateau/PlateauFoeAdapter.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/enemies/plateau/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/world/plateau/play/foes.ts', import.meta.url), 'utf8'),
  ]);
  for (const id of ['marmot', 'tiangou', 'aoyin', 'jufu', 'manman', 'liangu', 'dijiang', 'qiongqi']) {
    assert.ok(plateauIndex.includes(`'${id}'`), id);
    assert.ok(defs.enemies.some(enemy => enemy.id === id), `Unity roster ${id}`);
  }
  assert.match(registry, /registerPlateauEnemies\(\)/);
  assert.match(adapter, /createFoe\(kind, this\.runtime/);
  assert.match(adapter, /new Roamer\(this\.runtime/);
  assert.match(adapter, /this\.foe\.spheres\(\)/);
  // 分层结算先扣护盾（坚盾词缀），只有扣到生命的那部分交给 Foe（M5）
  assert.match(adapter, /const hpLoss = Math\.max\(0, this\.lastHp - this\.hp\)/);
  assert.match(adapter, /this\.foe\.hp = Math\.min\(this\.foe\.maxHp, this\.lastHp\)/);
  assert.match(adapter, /this\.foe\.hit\(hpLoss \/ mult, mult, point, info\)/);
  assert.match(foes, /case 'qiongqi': throw new Error\('穷奇用 Roamer'\)/);
});

test('debugStage opens generated Unity scenes and never substitutes missing scenes', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const stageSource = await readFile(new URL('../src/world/UnityStages.ts', import.meta.url), 'utf8');
  const stagesUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(stageSource, { mode: 'transform' })).toString('base64')}`;
  // 局流程（progression/RunPlan → RunRoute / StagePlan / RunRng）：?debugStage= 开调试局，从那张图开始；没导出的图不顶替
  const module = async (path, imports = {}) => {
    let text = await readFile(new URL(path, import.meta.url), 'utf8');
    for (const [key, value] of Object.entries(imports)) text = text.replaceAll(`'${key}'`, `'${value}'`);
    return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text, { mode: 'transform' })).toString('base64')}`;
  };
  const rngUrl = await module('../src/progression/RunRng.ts');
  const planUrl = await module('../src/progression/StagePlan.ts', { '../world/UnityStages': stagesUrl });
  const routeUrl = await module('../src/progression/RunRoute.ts', { './RunRng': rngUrl, './StagePlan': planUrl });
  const { RunPlanner } = await import(await module('../src/progression/RunPlan.ts', { './RunRng': rngUrl, './RunRoute': routeUrl, './StagePlan': planUrl }));
  const first = () => { const planner = new RunPlanner({}); return planner.firstStage(planner.createRun('fox', 1)); };
  const previous = globalThis.location;
  try {
    globalThis.location = { search: '?debugStage=1-2' };
    assert.equal(first().index, 1);
    assert.equal(first().map, '1-2');
    globalThis.location = { search: '?debugStage=1-4' };
    assert.equal(first().type, 'boss');
    globalThis.location = { search: '?debugStage=4-2' };
    assert.equal(first().index, 0);
    assert.notEqual(first().map, '4-2');
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});
