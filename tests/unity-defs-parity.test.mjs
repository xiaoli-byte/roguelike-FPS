import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import {
  EXCEPTIONS, ENEMY_FIELDS, HERO_FIELDS, WEAPON_FIELDS, compare, loadUnity, loadWeb, staleExceptions,
} from '../scripts/web/defs-parity.mjs';

// M2：Unity 冻结的定义表（public/assets/unity-gameplay/defs.json）↔ 网页 TS 定义表逐字段对照。
// 字段映射、单位与缺省约定在 scripts/web/defs-parity.mjs（WEAPON_FIELDS / ENEMY_FIELDS / HERO_FIELDS），
// 有意保留的差异登记在它的 EXCEPTIONS（每条带原因）。`node scripts/web/defs-parity.mjs` 打印同一份报告。
const unity = await loadUnity();
const web = await loadWeb();
const result = compare(unity, web);
const show = (rows) => rows.map((d) => `${d.table}/${d.id}.${d.key ?? '*'}：Unity ${JSON.stringify(d.unity)} ≠ 网页 ${JSON.stringify(d.web)}`).join('\n');

test('every Unity hero, enemy and weapon has a web definition', () => {
  assert.equal(unity.schema, 2);
  const missing = result.missing.filter((m) => !m.reason);
  assert.deepEqual(missing, [], `网页表里缺：${missing.map((m) => `${m.table}/${m.id}`).join(', ')}`);
  // 武器表顺序同 Unity（[Defs(order)] = TS WEAPON_DEFS 下标 × 10），掉落 / 商店按这个顺序列
  assert.deepEqual(web.weapons.WEAPON_DEFS.map((w) => w.id), unity.weapons.map((w) => w.id));
});

for (const [table, fields] of [['weapons', WEAPON_FIELDS], ['enemies', ENEMY_FIELDS], ['heroes', HERO_FIELDS]]) {
  test(`${table}: every mapped field equals Unity (${fields.length} columns)`, () => {
    const open = result.diffs.filter((d) => d.table === table && !d.reason);
    assert.equal(open.length, 0, `未登记的差异：\n${show(open)}`);
  });
}

test('exception list is minimal: every entry is still a real difference and has a reason', () => {
  for (const e of EXCEPTIONS) assert.ok(typeof e.reason === 'string' && e.reason.length >= 10, `${e.table}/${e.id}.${e.key} 缺原因`);
  assert.deepEqual(staleExceptions(result).map((e) => `${e.table}/${e.id}.${e.key}`), [], '两边已一致的例外要从 EXCEPTIONS 删掉');
});

test('effective spread follows Unity: spreadTuned verbatim, otherwise TS × 0.4 (recovery unscaled)', () => {
  const byId = Object.fromEntries(web.weapons.WEAPON_DEFS.map((w) => [w.id, w]));
  const tuned = unity.weapons.filter((u) => u.spreadTuned).map((u) => u.id).sort();
  assert.deepEqual(tuned, ['beam', 'launcher', 'revolver', 'shotgun', 'smg', 'stormpod']);
  for (const u of unity.weapons) {
    const w = byId[u.id];
    const t = u.spreadTuned;
    assert.ok(Math.abs(w.spreadHip - (t ? t.hip : u.spreadTs.hip * 0.4)) < 1e-6, `${u.id} hip`);
    assert.ok(Math.abs(w.spreadMax - (t ? t.max : u.spreadTs.max * 0.4)) < 1e-6, `${u.id} max`);
    assert.ok(Math.abs(w.spreadRecovery - (t ? t.recovery : u.spreadTs.recovery)) < 1e-9, `${u.id} recovery`);
  }
  // 运行时读的是有效值（WeaponSystem.updateSpread / fire 同 Unity WeaponController）
  assert.equal(byId.smg.spreadAim, 0.005);
  assert.equal(byId.shotgun.pelletCone, 0.06);
  assert.equal(byId.magmashot.damage, 10);
  assert.equal(byId.stormpod.projectile.rollAfter, true);
});

test('weapon library constants match Unity WeaponLibrary', async () => {
  const cs = await readFile(new URL('../unity/Assets/Game/Scripts/Weapons/WeaponDefs.cs', import.meta.url), 'utf8');
  const rarity = cs.match(/RarityDamage = \{([^}]*)\}/)[1].split(',').map((s) => parseFloat(s));
  assert.deepEqual([...web.weapons.RARITY_DAMAGE], rarity);
  assert.equal(web.weapons.MAX_LEVEL, Number(cs.match(/MaxUpgrade = (\d+)/)[1]));
  assert.equal(web.weapons.LEVEL_DAMAGE, parseFloat(cs.match(/UpgradeStep = ([\d.]+)f/)[1]));
  assert.equal(web.weapons.SPREAD_SCALE, 0.4);
});

test('chapter 4 roster agrees with the plateau runtime specs (FOE_SPECS)', () => {
  // 第四章的行为仍由 FOE_SPECS 驱动；名册与它的韧性 / 速度 / 体型 / 生命必须同值。
  // 穷奇名册即精英：生命 423 × 2.6 ≈ 1100、体型 1 × 1.25 = FOE_SPECS 里已经折算好的精英值。
  for (const u of unity.enemies.filter((e) => web.foeSpecs[e.id])) {
    const spec = web.foeSpecs[u.id];
    const elite = u.rank === 'Elite';
    const poise = u.poise === 'Infinity' ? Infinity : u.poise;
    assert.equal(spec.poise, poise, `${u.id} poise`);
    assert.ok(Math.abs(spec.staggerTime - u.staggerSeconds) < 1e-6, `${u.id} staggerTime`);
    assert.ok(Math.abs((spec.hitch ?? 0) - u.hitch) < 1e-6, `${u.id} hitch`);
    assert.ok(Math.abs(spec.speed - u.speed) < 1e-6, `${u.id} speed`);
    assert.ok(Math.abs(spec.scale - u.scale * (elite ? 1.25 : 1)) < 1e-6, `${u.id} scale`);
    assert.equal(spec.hp, Math.round(u.hp * (elite ? 2.6 : 1)), `${u.id} hp`);
  }
});

test('def-driven behaviour: roster elites always spawn elite, affix exclusions come from the definition', async () => {
  const manager = await readFile(new URL('../src/enemies/EnemyManager.ts', import.meta.url), 'utf8');
  assert.match(manager, /const elite = !!opts\.elite \|\| entry\.def\.rank === 'elite';/);
  assert.match(manager, /rollAffix\(this\.ctx\.rng, entry\.def\.affixExclusions\)/);
  assert.equal(web.enemies.qiongqi.rank, 'elite');

  const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
  const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const tsModule = async (path, imports = {}) => {
    let source = await readFile(new URL(path, import.meta.url), 'utf8');
    for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
    return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
  };
  const mathUrl = await tsModule('../src/core/math.ts');
  const { rollAffix, AFFIX_IDS } = await import(await tsModule('../src/enemies/Affixes.ts', {
    './Models': await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl }),
    './Hazards': await tsModule('../src/enemies/Hazards.ts', { '../core/math': mathUrl }),
  }));
  let i = 0;
  const rng = { pick: (list) => list[i++ % list.length] };
  for (const id of ['firecracker', 'fire_crow', 'aoyin', 'manman', 'liangu', 'dijiang']) {
    const exclude = web.enemies[id].affixExclusions;
    assert.ok(exclude.length > 0, id);
    for (let n = 0; n < 12; n++) assert.ok(!exclude.includes(rollAffix(rng, exclude)), id);
  }
  const seen = new Set();
  for (let n = 0; n < 8; n++) seen.add(rollAffix(rng));
  assert.deepEqual([...seen].sort(), [...AFFIX_IDS].sort());
});
