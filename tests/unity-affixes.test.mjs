// M13 对照：Unity EditMode 的 AffixTests.cs、AffixTriggerTests.cs、LegendaryTests.cs → node --test。
// 词条表（id / 区间 / 权重 / 固定 / perHit / 顺序）、准入条件、文本直接从 C# 源码里读：
//   · 每条词条一个文件（Weapons/Affixes/Numeric|Trigger、Weapons/Legendaries），[Defs(order)] + base(...) + Text + Allow；
//   · Allow 表达式机械翻译成 JS 再和网页的 allow 逐武器逐元素比；
//   · 文本断言从 Unity 测试源码里把「期望文本 / 词条 id / 数值」三元组抠出来，喂给网页的 describeAffix。
// 触发 / 传说的运行时（AffixEffects）用假的 combat / host 驱动，断言同 Unity 那份。
// 只写测试：和 Unity 不一致的地方写成 todo（见文件末尾），不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cs, csConsts, csTest, near, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const A = await graph.load('weapons/Affixes.ts');
const W = await graph.load('weapons/WeaponDefs.ts');
const WS = await graph.load('weapons/WeaponStats.ts');
const D = await graph.load('weapons/Describe.ts');
const { AffixEffects } = await graph.load('weapons/AffixEffects.ts');
const { Rng } = await graph.load('core/Rng.ts');
const { Stats } = await graph.load('core/Stats.ts');
const { EventBus } = await graph.load('core/EventBus.ts');

const ELEMENTS = ['none', 'fire', 'shock', 'corrode'];
const EPS = 1e-4;
const def = id => W.getWeaponDef(id);

// ───────────── 读 Unity 的词条定义 ─────────────

const weaponsDir = new URL('../unity/Assets/Game/Scripts/Weapons/', import.meta.url);
const num = s => Number(String(s).trim().replace(/[fF]$/, ''));
const affixIds = Object.fromEntries([...cs('Weapons/WeaponStatsResolver.cs').matchAll(/(\w+) = "(\w+)"/g)].map(m => [m[1], m[2]]));
const triggerBase = cs('Weapons/Affixes/Trigger/TriggerAffixDef.cs');
const ELEMENT_CS = { 'Element.Fire': 'fire', 'Element.Shock': 'shock', 'Element.Corrode': 'corrode', 'Element.None': 'none' };

/** C# 的 Allow 表达式 → JS（d = 武器定义，e = 实例元素，picked = 已抽到的 id）。有没认出来的片段就抛错 */
function translateAllow(expr, element) {
  let js = expr
    .replaceAll('(c.def.cycle == null || c.def.cycle.Length == 0)', '!d.cycle')
    .replaceAll('c.def.cycle == null || c.def.cycle.Length == 0', '!d.cycle')
    .replaceAll('(c.def.cycle != null && c.def.cycle.Length > 0)', '!!d.cycle')
    .replaceAll('AffixRules.GunOnly(c.def)', '!u.isBlade(d)')
    .replaceAll('AffixRules.DirectHit(c.def)', 'u.directHit(d)')
    .replaceAll('AffixRules.CanReact(c)', 'u.canReact(d, e, picked)')
    .replaceAll('c.def.IsExplosive', 'u.isExplosive(d)')
    .replaceAll('c.def.IsHitscan', 'u.isHitscan(d)')
    .replaceAll('c.def.projectile != null', '!!d.projectile')
    .replaceAll('c.def.mode != FireMode.Beam', "d.mode !== 'beam'")
    .replaceAll('c.def.mode != FireMode.Charge', "d.mode !== 'charge'")
    .replaceAll('c.element != Element.None', "e !== 'none'")
    .replaceAll('c.element != element', `e !== '${element}'`);
  assert.ok(!/\bc\.|AffixRules|FireMode|Element\./.test(js), `没翻译干净的 Allow：${expr} → ${js}`);
  return new Function('u', 'd', 'e', 'picked', `return ${js};`);
}

/** Unity 的判定（WeaponDefs.cs / AffixDef.cs 的 AffixRules），直接读网页定义的字段，不走网页的 isHitscan 之类 */
const U = {
  isHitscan: d => !d.projectile && d.mode !== 'beam',
  isExplosive: d => !!d.projectile && d.projectile.explosionRadius > 0,
  isBlade: d => !!d.blade,
  directHit: d => U.isHitscan(d) || d.kind === 'crossbow',
  canReact: (d, e, picked) => e !== 'none' || (!!d.cycle && d.cycle.length > 0) || !!d.chargeDetonate || picked.some(p => p.startsWith('sub')),
  hitsPerShot: d => d.pellets * (d.projectile ? d.projectile.count : 1),
  shotsPerSecond: d => d.fireRate * d.burstCount,
};
const rules = csConsts(cs('Weapons/Affixes/AffixDef.cs'));
U.hitsPerSecond = d => (d.mode === 'charge' ? 1 / (1 / Math.max(0.01, d.fireRate) + d.chargeTime) : U.shotsPerSecond(d)) * U.hitsPerShot(d);
U.perHitChance = (d, raw) => Math.min(rules.PerHitMax, Math.max(rules.PerHitMin, raw * rules.PerHitBase / Math.max(0.01, U.hitsPerSecond(d))));
U.rarityScale = rarity => 1 + 0.15 * Math.max(0, rarity - 1);

function readDefs(sub) {
  const dir = new URL(sub, weaponsDir);
  const out = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.cs') && f !== 'TriggerAffixDef.cs')) {
    const src = readFileSync(new URL(file, dir), 'utf8');
    const order = Number(src.match(/\[Defs\((\d+)\)\]/)[1]);
    const args = src.match(/\)\s*:\s*base\(([^)]*)\)/)[1].split(',').map(s => s.trim());
    const idConst = src.match(/const string Id = "(\w+)"/)?.[1];
    const id = args[0] === 'Id' ? idConst : affixIds[args[0].replace('AffixIds.', '')];
    assert.ok(id, `${file}：读不出 id`);
    const row = { file, order, id, src };
    if (sub.startsWith('Legendaries')) {
      row.name = args[1].replaceAll('"', '');
      row.allow = src.match(/Allow\(in AffixContext c\) => ([^;]+);/)?.[1] ?? 'true';
      row.allowFn = row.allow === 'true' ? () => true : translateAllow(row.allow);
    } else if (ELEMENT_CS[args[1]]) {
      // SubElementAffix：区间 / 权重 / perHit 在基类里
      const b = triggerBase.match(/SubElementAffix\([^)]*\)\s*:\s*base\(id, ([\d.]+)f?, ([\d.]+)f?, (\d+), perHit: true\)/);
      Object.assign(row, { min: num(b[1]), max: num(b[2]), weight: num(b[3]), fixed: false, perHit: true });
      row.allowFn = translateAllow(triggerBase.match(/Allow\(in AffixContext c\) => ([^;]+);/)[1], ELEMENT_CS[args[1]]);
    } else {
      Object.assign(row, { min: num(args[1]), max: num(args[2]), weight: num(args[3]), fixed: args.includes('isFixed: true'), perHit: args.includes('perHit: true') });
      const allow = src.match(/Allow\(in AffixContext c\) => ([^;]+);/)?.[1];
      row.allowFn = allow ? translateAllow(allow) : () => true;
    }
    out.push(row);
  }
  return out.sort((a, b) => a.order - b.order);
}
const numericCs = readDefs('Affixes/Numeric/');
const triggerCs = readDefs('Affixes/Trigger/');
const rollableCs = [...numericCs, ...triggerCs].sort((a, b) => a.order - b.order);
const legendaryCs = readDefs('Legendaries/');

/** 测试里造的武器（同 Unity 测试里 new WeaponDef { … } 的那几把） */
const smg = def('smg');
const synth = {
  bolt: { ...smg, id: 't_bolt', kind: 'crossbow', mode: 'semi', fireRate: 1.2, cycle: null, projectile: { ...def('crossbow').projectile ?? def('launcher').projectile, count: 1, explosionRadius: 0 }, innate: [] },
  rail: { ...smg, id: 't_rail', kind: 'sniper', mode: 'charge', fireRate: 2, chargeTime: 0.9, chargeDetonate: true, projectile: null, innate: [] },
  trinity: { ...smg, id: 't_trinity', kind: 'pistol', mode: 'semi', fireRate: 2, cycle: ['fire', 'shock', 'corrode'], innate: [] },
  blade: { ...smg, id: 't_blade', kind: 'blade', mode: 'semi', fireRate: 1, blade: { combo: [] }, innate: [] },
  swarm: { ...smg, id: 't_swarm', mode: 'semi', fireRate: 0.75, projectile: { ...def('launcher').projectile, count: 5 }, innate: [] },
};
const allDefs = [...W.WEAPON_DEFS, ...Object.values(synth)];

// ───────────── 定义表 ─────────────

test('普通词条 29 条：id、顺序、区间、权重、固定、perHit 同 Unity 注册表（[Defs] 顺序）', () => {
  assert.equal(numericCs.length, 15, '数值 15 条');
  assert.equal(triggerCs.length, 14, '触发 14 条');
  assert.deepEqual(A.AFFIXES.map(a => a.id), rollableCs.map(a => a.id), '顺序同 Unity（order = TS 下标 × 10）');
  rollableCs.forEach((c, i) => {
    const t = A.AFFIXES[i];
    assert.equal(c.order, i * 10, `${c.id}：order`);
    near(assert, t.min, c.min, 1e-9, `${c.id} min`);
    near(assert, t.max, c.max, 1e-9, `${c.id} max`);
    assert.equal(t.weight, c.weight, `${c.id} 权重`);
    assert.equal(!!t.fixed, c.fixed, `${c.id} 固定`);
    assert.equal(!!t.perHit, c.perHit, `${c.id} perHit`);
    assert.equal(A.isLegendaryId(c.id), false);
  });
  // AffixTests / AffixTriggerTests 里手抄的那两张表也对一遍
  for (const [file, cols] of [['AffixTests.cs', 5], ['AffixTriggerTests.cs', 5]]) {
    const table = csTest(file).match(/\[\] Ts =\s*\{([\s\S]*?)\};/)[1];
    const rows = [...table.matchAll(/\("(\w+)", ([\d.]+)f?, ([\d.]+)f?, (\d+), (true|false)\)/g)];
    assert.ok(rows.length >= 14, `${file}：读到 ${rows.length} 行`);
    for (const m of rows) {
      const t = A.AFFIXES.find(a => a.id === m[1]);
      assert.ok(t, m[1]);
      assert.deepEqual([t.min, t.max, t.weight], [num(m[2]), num(m[3]), num(m[4])], `${file} ${m[1]}（${cols} 列）`);
    }
  }
  assert.deepEqual([...A.AFFIX_COUNT], [0, 1, 1, 2, 3]);
  assert.deepEqual([...A.AFFIX_COUNT], cs('Weapons/Affixes/AffixDef.cs').match(/int\[\] Count = \{([^}]+)\}/)[1].split(',').map(Number));
});

test('传说特性 10 条：id、名字、顺序同 Unity；不进普通词条池', () => {
  assert.equal(legendaryCs.length, 10);
  assert.deepEqual(A.LEGENDARIES.map(l => l.id), legendaryCs.map(l => l.id));
  assert.deepEqual(A.LEGENDARIES.map(l => l.name), legendaryCs.map(l => l.name));
  legendaryCs.forEach((l, i) => {
    assert.equal(l.order, 1000 + i * 10, l.id);
    assert.equal(A.isLegendaryId(l.id), true);
    assert.equal(A.legendaryName(l.id), l.name);
    assert.ok(l.id.startsWith('lg_'));
  });
  assert.ok(!A.AFFIXES.some(a => a.id.startsWith('lg_')));
  // LegendaryTests.Ts
  const ts = [...csTest('LegendaryTests.cs').match(/\[\] Ts =\s*\{([\s\S]*?)\};/)[1].matchAll(/\("(lg_\w+)", "([^"]+)"\)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(A.LEGENDARIES.map(l => [l.id, l.name]), ts);
});

// ───────────── 文本 ─────────────

test('词条文本：Unity 测试里断言的每一句，网页 describeAffix 给出同一句', () => {
  const numeric = [...csTest('AffixTests.cs').matchAll(/Assert\.AreEqual\("([^"]+)", AffixText\.Describe\(w, new WeaponAffix\("(\w+)", ([\d.]+)f?\)\)\)/g)];
  const trigger = [...csTest('AffixTriggerTests.cs').matchAll(/Assert\.AreEqual\("([^"]+)", T\("(\w+)", ([\d.]+)f?\)\)/g)];
  assert.equal(numeric.length, 16, 'AffixTests.TextsMatchTs 的 16 句');
  assert.equal(trigger.length, 14, 'AffixTriggerTests.TextsMatchTs 的 14 句');
  for (const [, text, id, v] of [...numeric, ...trigger]) assert.equal(A.describeAffix(smg, { id, value: num(v) }), text, id);
  assert.equal(A.describeAffix(smg, { id: 'no_such_affix', value: 1 }), null, '未知词条返回 null');
});

test('传说文本：【传说·名】前缀、发 / 跳 / 轮 / 段斩击；武器名带传说前缀', () => {
  const vars = { smg, 'Def("beam")': def('beam'), swarm: synth.swarm, blade: synth.blade };
  const rows = [...csTest('LegendaryTests.cs').matchAll(/Assert\.AreEqual\("(【[^"]+)", T\("(lg_\w+)", (smg|swarm|blade|Def\("beam"\))\)\)/g)];
  assert.equal(rows.length, 14, 'LegendaryTests.TextsCarryLegendaryPrefix 的 14 句');
  for (const [, text, id, v] of rows) {
    const d = vars[v];
    const l = A.LEGENDARIES.find(x => x.id === id);
    assert.equal(A.describeAffix(d, { id, value: l.value(d) }), text, `${id} @ ${d.id}`);
  }
  const inst = { uid: 1, defId: 'smg', rarity: 4, level: 2, element: 'none', mag: 0, reserve: 0, affixes: [{ id: 'lg_nth', value: 6 }] };
  const R = WS.resolveWeapon(inst, new Stats());
  assert.equal(D.weaponDisplayName(R), '天命·蜂鸣冲锋枪');
  const desc = D.describeWeapon(inst, R);
  assert.equal(desc.traits.at(-1), '【传说·天命】每第 6 发必定暴击', '特性行里传说排最后');
});

test('特性行：固有特性在最前，词条按顺序在后（AffixTests.TraitsListNotesThenAffixes）', () => {
  const d = def('stormpod');
  const inst = { uid: 2, defId: 'stormpod', rarity: 3, level: 0, element: 'corrode', mag: 0, reserve: 0, affixes: [{ id: 'subShock', value: 0.4 }, { id: 'dmg', value: 0.13 }, { id: 'swift', value: 0.5 }] };
  const traits = D.describeWeapon(inst, WS.resolveWeapon(inst, new Stats())).traits;
  assert.deepEqual(traits.slice(0, d.notes.length), [...d.notes], '固有特性在最前');
  assert.equal(traits.at(-2), '伤害 +13%');
  assert.equal(traits.at(-1), '持握时移动速度 +0.5');
});

// ───────────── 准入 ─────────────

test('普通词条准入：每把武器 × 每种元素 × 抽没抽到副元素，都和 Unity 的 Allow 一致', () => {
  let checked = 0;
  for (const d of allDefs) for (const e of ELEMENTS) for (const picked of [[], ['subFire'], d.innate.map(a => a.id)]) {
    const web = A.AFFIXES.filter(a => a.allow(d, e, picked)).map(a => a.id);
    const unity = rollableCs.filter(a => a.allowFn(U, d, e, picked)).map(a => a.id);
    assert.deepEqual(web, unity, `${d.id}/${e}/[${picked}]`);
    checked++;
  }
  assert.ok(checked > 200);
});

test('普通词条准入：Unity 测试里写死的那几组', () => {
  const allowed = (d, e, picked = d.innate.map(a => a.id)) => new Set(A.AFFIXES.filter(a => a.allow(d, e, picked)).map(a => a.id));
  const numeric = new Set(numericCs.map(a => a.id)), trigger = new Set(triggerCs.map(a => a.id));
  const expect = (set, d, e, picked, list) => assert.deepEqual([...allowed(d, e, picked)].filter(x => set.has(x)).sort(), [...list].sort(), `${d.id}/${e}`);
  // AffixTests.EligibilityMatchesTs
  const any = ['dmg', 'rate', 'critDmg', 'critChance', 'hunter', 'swift'], gun = ['mag', 'reload', 'reserve'];
  const N = (id, e, ...extra) => expect(numeric, def(id), e, undefined, [...any, ...gun, ...extra]);
  N('revolver', 'none', 'spread', 'recoil', 'pierce');
  N('revolver', 'fire', 'spread', 'recoil', 'pierce', 'elemChance');
  N('smg', 'none', 'spread', 'recoil', 'pierce');
  N('shotgun', 'shock', 'spread', 'recoil', 'pierce', 'elemChance');
  N('beam', 'shock', 'elemChance');
  N('launcher', 'fire', 'recoil', 'blast', 'projSpeed', 'elemChance');
  N('stormpod', 'corrode', 'recoil', 'blast', 'projSpeed', 'elemChance');
  // AffixTriggerTests.EligibilityMatchesTs
  const subs = ['subFire', 'subShock', 'subCorrode'], always = ['killRefill', 'hitShield', 'statusHunter'], react = ['rxnDmg', 'rxnRefill', 'rxnHaste', 'rxnShield'];
  const T = (d, e, picked, ...groups) => expect(trigger, d, e, picked, groups.flat());
  T(def('revolver'), 'none', [], always, subs, ['headBlast', 'ricochet', 'detonate']);
  T(def('revolver'), 'none', ['subFire'], always, subs, react, ['headBlast', 'ricochet', 'detonate']);
  T(def('revolver'), 'fire', [], always, react, ['subShock', 'subCorrode', 'headBlast', 'ricochet', 'detonate']);
  T(def('beam'), 'shock', [], always, react, ['subFire', 'subCorrode']);
  T(def('launcher'), 'fire', [], always, react, ['subShock', 'subCorrode']);
  T(synth.bolt, 'none', [], always, subs, ['headBlast', 'ricochet', 'detonate', 'seed']);
  T(synth.rail, 'none', [], always, subs, react, ['headBlast', 'ricochet']);
  T(synth.trinity, 'fire', [], always, react, ['headBlast', 'ricochet', 'detonate']);
  T(synth.blade, 'none', [], ['hitShield', 'statusHunter', 'ricochet', 'detonate', 'subFire', 'subShock', 'subCorrode']);
});

test('传说准入：每把武器 × 每种元素同 Unity；合璧 / 终焉 / 无尽 / 轮回的例外', () => {
  for (const d of allDefs) for (const e of ELEMENTS) {
    const picked = d.innate.map(a => a.id);
    assert.deepEqual(A.LEGENDARIES.filter(l => l.allow(d, e, picked)).map(l => l.id), legendaryCs.filter(l => l.allowFn(U, d, e, picked)).map(l => l.id), `${d.id}/${e}`);
  }
  const all = A.LEGENDARIES.map(l => l.id);
  const expect = (d, e, without) => assert.deepEqual(A.LEGENDARIES.filter(l => l.allow(d, e, [])).map(l => l.id), all.filter(x => !without.includes(x)), `${d.id}/${e}`);
  expect(smg, 'none', ['lg_bond']);
  expect(smg, 'fire', []);
  expect(def('beam'), 'shock', ['lg_last']);
  expect(synth.blade, 'none', ['lg_last', 'lg_endless', 'lg_bond']);
  expect(synth.trinity, 'fire', ['lg_lunhui']);
});

// ───────────── 传说数值 ─────────────

test('传说数值：天命按每秒射击分档、万象 1.6 ÷ 每秒命中数钳在 [5%, 75%]、其余固定（LegendaryTests.ValuesMatchTs）', () => {
  const V = (id, d) => A.LEGENDARIES.find(l => l.id === id).value(typeof d === 'string' ? def(d) : d);
  const bare = o => ({ ...smg, burstCount: 1, pellets: 1, projectile: null, mode: 'auto', ...o });
  assert.equal(V('lg_nth', 'smg'), 6);
  assert.equal(V('lg_nth', 'beam'), 6);
  assert.equal(V('lg_nth', 'revolver'), 5);
  assert.equal(V('lg_nth', 'shotgun'), 4);
  assert.equal(V('lg_nth', 'launcher'), 4);
  assert.equal(V('lg_nth', bare({ fireRate: 8 })), 6);
  assert.equal(V('lg_nth', bare({ fireRate: 7.99 })), 5);
  assert.equal(V('lg_nth', bare({ fireRate: 2.5 })), 5);
  assert.equal(V('lg_nth', bare({ fireRate: 2.49 })), 4);
  assert.equal(V('lg_nth', bare({ fireRate: 1.6, burstCount: 3 })), 5, '点射 1.6 轮 × 3 发');
  near(assert, V('lg_prism', 'smg'), 1.6 / 13, EPS);
  near(assert, V('lg_prism', 'shotgun'), 1.6 / (1.4 * 9), EPS, '霰弹按弹丸');
  near(assert, V('lg_prism', 'beam'), 0.16, EPS);
  near(assert, V('lg_prism', 'launcher'), 0.75, EPS, '上限');
  near(assert, V('lg_prism', bare({ fireRate: 20, pellets: 10 })), 0.05, EPS, '下限');
  // 固定值：从每个 Legendary_*.cs 的 Value 里读
  for (const l of legendaryCs) {
    const m = l.src.match(/float Value\(WeaponDef weapon\) => (-?[\d.]+)f?;/);
    if (!m) continue;
    for (const d of allDefs) assert.equal(V(l.id, d), num(m[1]), `${l.id} @ ${d.id}`);
  }
  assert.deepEqual(legendaryCs.filter(l => !/Value\(WeaponDef weapon\) => (-?[\d.]+)f?;/.test(l.src)).map(l => l.id), ['lg_nth', 'lg_prism'], '只有天命 / 万象随武器变');
});

// ───────────── 抽取 ─────────────

const legendaryOf = list => list.filter(a => A.isLegendaryId(a.id));

test('词条数按稀有度、固有词条排最前且不放大、同 id 不抽两次、传说只在传说品质且排最后', () => {
  const rng = new Rng(3);
  for (const id of ['smg', 'stormpod', 'beam']) {
    const d = def(id);
    for (let rarity = 0; rarity < 5; rarity++) for (let i = 0; i < 200; i++) {
      const list = A.rollAffixes(d, rarity, d.element, rng);
      d.innate.forEach((a, k) => assert.deepEqual(list[k], { id: a.id, value: a.value }, `${id}：固有词条原样排最前`));
      assert.equal(list.slice(d.innate.length).filter(a => !A.isLegendaryId(a.id)).length, A.AFFIX_COUNT[rarity], `${id} 品质 ${rarity}：词条数`);
      assert.equal(new Set(list.map(a => a.id)).size, list.length, `${id}：同 id 不会抽两次`);
      const lg = legendaryOf(list);
      assert.ok(lg.length <= (rarity === 4 ? 1 : 0));
      if (lg.length) assert.equal(list.at(-1), lg[0], '传说特性排最后');
    }
  }
});

test('数值随稀有度放大（×1 / 1 / 1.15 / 1.3 / 1.45）并取整到 0.01（疾行 0.1、化盾整数、固定值不放大）', () => {
  const rng = new Rng(17);
  for (let rarity = 1; rarity < 5; rarity++) {
    const scale = U.rarityScale(rarity);
    for (let i = 0; i < 400; i++) for (const a of A.rollAffixes(smg, rarity, 'fire', rng)) {
      const d = rollableCs.find(x => x.id === a.id);
      if (!d || d.perHit) continue;
      if (d.fixed) { assert.equal(a.value, d.min, `${a.id}：固定值不放大`); continue; }
      const step = a.id === 'swift' ? 0.1 : a.id === 'rxnShield' ? 1 : 0.01;
      assert.ok(a.value >= d.min * scale - step * 0.51 && a.value <= d.max * scale + step * 0.51, `${a.id} 品质 ${rarity}：${a.value}`);
      near(assert, a.value / step, Math.round(a.value / step), 1e-6, `${a.id}：取整到 ${step}`);
    }
  }
  assert.deepEqual([0, 1, 2, 3, 4].map(U.rarityScale).map(x => +x.toFixed(4)), [1, 1, 1.15, 1.3, 1.45]);
  assert.match(cs('Weapons/Affixes/AffixDef.cs'), /RarityScale\(int rarity\) => 1 \+ 0\.15f \* Mathf\.Max\(0, rarity - 1\)/);
});

test('第一条按权重抽（冲锋枪无元素：出现率 = 权重 ÷ 准入池总权重）', () => {
  const pool = rollableCs.filter(a => a.allowFn(U, smg, 'none', []));
  const total = pool.reduce((s, a) => s + a.weight, 0);
  const n = 40000, rng = new Rng(21), counts = {};
  for (let i = 0; i < n; i++) { const id = A.rollAffixes(smg, 1, 'none', rng).at(-1).id; counts[id] = (counts[id] ?? 0) + 1; }
  for (const a of pool) near(assert, (counts[a.id] ?? 0) / n, a.weight / total, 0.01, `${a.id} 的出现率`);
  assert.equal(counts.blast, undefined, '冲锋枪抽不到爆炸范围');
});

test('perHit 归一：原始值 × 稀有度 × 3.5 ÷ 每秒命中数，钳在 [2%, 75%]', () => {
  assert.deepEqual([rules.PerHitBase, rules.PerHitMin, rules.PerHitMax], [3.5, 0.02, 0.75]);
  near(assert, U.hitsPerSecond(smg), 13, EPS);
  near(assert, U.hitsPerSecond(def('shotgun')), 1.4 * 9, EPS, '霰弹：每秒发数 × 弹丸');
  near(assert, U.perHitChance(smg, 0.1), 0.1 * 3.5 / 13, 1e-9);
  near(assert, U.perHitChance(def('launcher'), 0.261), 0.75, 1e-9, '上限 75%');
  near(assert, U.perHitChance(def('beam'), 0.01), 0.02, 1e-9, '下限 2%');
  // 网页的 perHitChance 不导出：从抽出来的副元素数值反查，每把武器每个稀有度都要落在 Unity 公式的区间里
  const sub = triggerCs.find(a => a.id === 'subFire');
  const rng = new Rng(8);
  let seen = 0;
  for (const d of W.WEAPON_DEFS) for (const rarity of [1, 3, 4]) {
    const lo = U.perHitChance(d, sub.min * U.rarityScale(rarity)), hi = U.perHitChance(d, sub.max * U.rarityScale(rarity));
    for (let i = 0; i < 150; i++) for (const a of A.rollAffixes(d, rarity, 'none', rng).slice(d.innate.length)) {
      if (!a.id.startsWith('sub')) continue;
      seen++;
      assert.ok(a.value >= lo - 0.0051 && a.value <= hi + 0.0051, `${d.id} 品质 ${rarity} ${a.id} = ${a.value}，应在 [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
      assert.ok(a.value >= 0.02);
      near(assert, a.value * 100, Math.round(a.value * 100), 1e-6);
    }
  }
  assert.ok(seen > 300, `抽到的副元素词条 ${seen} 条`);
});

test('每抽一条都重新过滤：无元素的枪要先抽到副元素，反应类词条才会出现；带元素时直接准入', () => {
  const reactive = new Set(['rxnDmg', 'rxnRefill', 'rxnHaste', 'rxnShield']);
  const rng = new Rng(1), revolver = def('revolver');
  let unlocked = 0;
  for (let i = 0; i < 4000; i++) {
    const list = A.rollAffixes(revolver, 4, 'none', rng);
    const firstRx = list.findIndex(a => reactive.has(a.id));
    if (firstRx < 0) continue;
    unlocked++;
    const firstSub = list.findIndex(a => a.id.startsWith('sub'));
    assert.ok(firstSub >= 0 && firstSub < firstRx, `反应类之前必须先有副元素：${list.map(a => a.id)}`);
  }
  assert.ok(unlocked > 20, `解锁过 ${unlocked} 次`);
  let direct = 0;
  for (let i = 0; i < 2000; i++) if (reactive.has(A.rollAffixes(revolver, 1, 'fire', rng).at(-1).id)) direct++;
  assert.ok(direct > 100, '带元素时反应类是第一条就能抽到的');
});

test('传说品质恰好一条特性：只抽准入的、等概率、数值由武器决定；史诗没有', () => {
  const rng = new Rng(11), counts = {}, n = 18000;
  for (let i = 0; i < n; i++) {
    const list = A.rollAffixes(smg, 4, 'none', rng);
    const lgs = legendaryOf(list);
    assert.equal(lgs.length, 1);
    assert.equal(list.at(-1), lgs[0]);
    assert.equal(lgs[0].value, A.LEGENDARIES.find(l => l.id === lgs[0].id).value(smg), '数值由武器决定');
    counts[lgs[0].id] = (counts[lgs[0].id] ?? 0) + 1;
  }
  const allowed = legendaryCs.filter(l => l.allowFn(U, smg, 'none', [])).map(l => l.id);
  assert.deepEqual(Object.keys(counts).sort(), [...allowed].sort(), '只抽准入的');
  for (const id of allowed) near(assert, counts[id] / n, 1 / allowed.length, 0.015, `${id} 等概率`);
  for (let i = 0; i < 300; i++) assert.equal(legendaryOf(A.rollAffixes(smg, 3, 'fire', rng)).length, 0, '史诗没有特性');
});

test('抽出来的词条进解析器：伤害 / 射速 / 暴击 / 猎首 / 疾行 / 穿透合计，名字带传说前缀（RolledAffixesFeedTheResolver）', () => {
  const rng = new Rng(77), stats = new Stats();
  let uid = 100;
  const total = (inst, id) => inst.affixes.filter(a => a.id === id).reduce((s, a) => s + a.value, 0);
  for (let i = 0; i < 300; i++) {
    const d = rng.weighted(W.WEAPON_DEFS, x => x.dropWeight);
    const inst = { uid: uid++, defId: d.id, rarity: 4, level: 0, element: d.element, mag: 0, reserve: 0, affixes: A.rollAffixes(d, 4, d.element, rng) };
    const r = WS.resolveWeapon(inst, stats);
    near(assert, r.damageMult, W.RARITY_DAMAGE[4] * (1 + total(inst, 'dmg')), 1e-9, d.id);
    near(assert, r.fireRate, d.fireRate * (1 + total(inst, 'rate')), 1e-9, d.id);
    near(assert, r.critMult, d.critMult * (1 + total(inst, 'critDmg')), 1e-9, d.id);
    assert.equal(r.critChance, total(inst, 'critChance'));
    assert.equal(r.hunter, total(inst, 'hunter'));
    assert.equal(r.swift, total(inst, 'swift'));
    assert.equal(r.pierce, d.pierce + Math.round(total(inst, 'pierce')));
    const lg = r.legendary ? A.legendaryName(r.legendary) : null;
    assert.equal(D.weaponDisplayName(r), lg ? `${lg}·${d.name}` : d.name, '传说前缀');
  }
});

// ───────────── 运行时：AffixEffects ─────────────

const fxConsts = { ...csConsts(cs('Weapons/Affixes/AffixEffects.cs')) };
const lgConsts = Object.fromEntries(legendaryCs.map(l => [l.id, csConsts(l.src)]));

test('触发 / 传说的常量同 Unity（读两边源码）', () => {
  const tsSrc = readFileSync(new URL('../src/weapons/AffixEffects.ts', import.meta.url), 'utf8');
  const ts = name => { const m = tsSrc.match(new RegExp(`const ${name} = (-?[\\d.]+);`)); assert.ok(m, `AffixEffects.ts 里没有 ${name}`); return Number(m[1]); };
  const pairs = [
    ['HEAD_BLAST_RADIUS', fxConsts.HeadBlastRadius], ['RICOCHET_RANGE', fxConsts.RicochetRange], ['RICOCHET_DAMAGE', fxConsts.RicochetDamage],
    ['POWER_CAP', fxConsts.PowerCap], ['PRISM_REACTION_SCALE', fxConsts.PrismReactionScale], ['DETONATE_ICD', fxConsts.DetonateIcd],
    ['PER_HIT_CAP', fxConsts.PerHitCap], ['RXN_PROC_GAP', fxConsts.RxnProcGap], ['RXN_HASTE_TIME', fxConsts.RxnHasteTime],
    ['SEED_DURATION', fxConsts.SeedDuration], ['ECHO_RANGE', fxConsts.EchoRange], ['NIRVANA_DEPTH', fxConsts.NirvanaDepth],
    ['FRENZY_MAX', lgConsts.lg_frenzy.MaxStacks], ['BOIL_MAX', lgConsts.lg_boil.MaxStacks], ['BOIL_WINDOW', lgConsts.lg_boil.Window],
    ['LUNHUI_ABYSS_MULT', lgConsts.lg_lunhui.AbyssMult], ['BOND_GAP', lgConsts.lg_bond.Gap], ['BOND_GAP_FLOOR', lgConsts.lg_bond.GapFloor],
  ];
  for (const [name, unity] of pairs) {
    assert.ok(Number.isFinite(unity), `Unity 源码里读不到 ${name} 对应的常量`);
    assert.equal(ts(name), unity, name);
  }
  // 行内写死的数：爆头爆炸 0.08 s 内只炸一次、狂热同帧 0.05 s 只叠一层、殉爆 35–220、击退 4 / 6、殉爆连锁深度 2
  assert.equal(fxConsts.HeadBlastGap, 0.08);
  assert.match(tsSrc, /now - rt\.lastHeadBlast > 0\.08/);
  assert.equal(lgConsts.lg_frenzy.StackGap, 0.05);
  assert.match(tsSrc, /now - rt\.frenzyTime > 0\.05/);
  assert.deepEqual([lgConsts.lg_nova.MinDamage, lgConsts.lg_nova.MaxDamage, lgConsts.lg_nova.Knockback, lgConsts.lg_nova.MaxChainDepth], [35, 220, 6, 2]);
  assert.match(tsSrc, /knockback: p\.kind === 'nova' \? 6 : 4/);
  assert.equal(csConsts(triggerCs.find(a => a.id === 'headBlast').src).Knockback, 4);
  assert.match(tsSrc, /R\.legendary === 'lg_nova' && depth < 2/);
  const r = { dps: 0, perShot: 0 };
  assert.equal(WS.novaDamage(r), 35, '殉爆下限');
  assert.equal(WS.novaDamage({ dps: 1000, perShot: 1000 }), 220, '殉爆上限');
  near(assert, WS.novaDamage({ dps: 100, perShot: 40 }), 0.35 * 100 + 0.5 * 40, 1e-9);
  assert.match(cs('Weapons/Legendaries/Legendary_Nova.cs'), /0\.35f \* \w+\.dps \+ 0\.5f \* \w+\.perShot/);
});

/** 假环境（同 AffixTriggerTests.FakeEnv）：记下爆炸 / 弹射 / 附着 / 引爆 / 回填 / 护盾，rand 可调 */
function fxRig({ rand = 0.999 } = {}) {
  const env = { now: 0, rand, blasts: [], strikes: [], applied: [], detonates: [], triggers: [], refills: [], shields: [], nearest: null, modifiers: [] };
  const weapons = [];
  const runtimes = new Map();
  const stats = new Stats();
  const events = new EventBus();
  const ctx = {
    events, time: { get now() { return env.now; } }, rng: { next: () => env.rand },
    player: { alive: true, stats, addShield: n => { env.shields.push(n); return n; } },
    enemies: { nearest: (_p, _r, exclude) => (env.nearest && !exclude?.has(env.nearest) ? env.nearest : null) },
    fx: new Proxy({}, { get: () => () => {} }),
    combat: {
      addOutgoingModifier(fn) { env.modifiers.push(fn); return () => env.modifiers.splice(env.modifiers.indexOf(fn), 1); },
      explode: (point, radius, req, opts) => env.blasts.push({ point: point.clone(), radius, req: { ...req }, opts }),
      damageEnemy: (target, req) => env.strikes.push({ target, req: { ...req } }),
      applyStatus: (e, status, power, _d, opts) => env.applied.push({ e, status, power, opts: { ...opts } }),
      detonate: (e, opts) => env.detonates.push({ e, opts: { ...opts } }),
      triggerReaction: (e, id, base, opts) => { env.triggers.push({ e, id, base, opts: { ...opts } }); return true; },
    },
  };
  const host = {
    find: uid => weapons.find(w => w.uid === uid) ?? null,
    resolve: inst => WS.resolveWeapon(inst, stats),
    runtime: inst => { if (!runtimes.has(inst)) runtimes.set(inst, { shots: 0, frenzy: 0, frenzyTime: -99, lastHeadBlast: -99, readyAt: 0, cycleIndex: 0, rxnHasteUntil: -99 }); return runtimes.get(inst); },
    refill: (inst, rounds) => env.refills.push({ inst, rounds }),
  };
  const fx = new AffixEffects(ctx, host);
  fx.init();
  let uid = 500;
  const gun = (id, affixes, { own = true, element = 'none', rarity = 2 } = {}) => {
    const w = { uid: uid++, defId: id, rarity, level: 0, element, mag: 0, reserve: 0, affixes: affixes.map(([k, v]) => ({ id: k, value: v })) };
    if (own) weapons.push(w);
    return w;
  };
  const enemy = (maxHp = 1000, o = {}) => ({
    alive: true, maxHp, hp: maxHp, isBoss: false, isElite: false, statuses: new Map(), position: new THREE.Vector3(),
    getBodyCenter(out) { return out.copy(this.position).setY(1); }, getHeadCenter(out) { return out.copy(this.position).setY(1.8); }, ...o,
  });
  const hit = (e, w, dealt, o = {}) => {
    const request = { base: o.base ?? dealt, element: o.element ?? 'none', source: o.source ?? 'weapon', weaponUid: w?.uid, headshot: !!o.weak, procDepth: o.depth ?? 0, tags: o.tags, point: new THREE.Vector3(0, 1, 0) };
    events.emit('enemy:damaged', { enemy: e, result: { request, dealt, isCrit: !!o.crit, killed: !!o.killed, statusApplied: o.applied ?? null } });
  };
  const kill = (e, w, o = {}) => events.emit('enemy:killed', { enemy: e, result: { request: { base: 10, element: o.element ?? 'none', source: 'weapon', weaponUid: w?.uid, procDepth: o.depth ?? 0 }, dealt: 10, killed: true } });
  const reaction = (e, w, o = {}) => events.emit('enemy:reaction', { enemy: e, reaction: o.id ?? 'thunderfire', point: new THREE.Vector3(), base: o.base ?? 40, depth: o.depth ?? 0, weaponUid: w?.uid, tag: o.tag });
  const mod = (e, req) => env.modifiers.reduce((m, fn) => m * fn(e, req), 1);
  return { env, fx, ctx, host, stats, gun, enemy, hit, kill, reaction, mod, resolve: host.resolve };
}

test('触发在下一次 flush 才执行；只认自己槽里的枪的直接命中（ProcsWaitForFlushAndOnlyOwnWeaponDirectHitsCount）', () => {
  const r = fxRig();
  const w = r.gun('revolver', [['headBlast', 0.6]]), stranger = r.gun('revolver', [['headBlast', 0.6]], { own: false });
  const e = r.enemy(), R = r.resolve(w);
  r.hit(e, w, 50, { weak: true });
  assert.equal(r.env.blasts.length, 0, '派发时不执行（不在伤害结算里重入）');
  r.fx.flush();
  assert.equal(r.env.blasts.length, 1, '下一次 flush 执行');
  const o = r.env.blasts[0];
  near(assert, o.req.base, R.perShot * 0.6, EPS, '单发总伤害 × 值');
  near(assert, o.radius, fxConsts.HeadBlastRadius * R.blastMult, EPS);
  assert.equal(o.req.weaponUid, w.uid);
  assert.equal(o.req.procDepth, 1, '衍生深度 1');
  assert.equal(o.req.canCrit, false, '不暴击');
  assert.equal(o.req.source, 'weapon');
  assert.equal(o.req.knockback, 4);
  r.env.now = 1;
  r.hit(e, stranger, 50, { weak: true });
  r.hit(e, w, 50, { weak: true, depth: 1 });
  r.hit(e, w, 50, { weak: true, source: 'skill' });
  r.hit(e, w, 50, { weak: true, source: 'status', tags: ['reaction'] });
  r.hit(e, w, 50, { weak: false });
  r.fx.flush();
  assert.equal(r.env.blasts.length, 1, '别人的枪 / 衍生伤害 / 技能 / 反应伤害 / 不是爆头都不触发');
});

test('爆头爆炸：一发霰弹 0.08 s 内只炸一次', () => {
  const r = fxRig();
  const w = r.gun('shotgun', [['headBlast', 0.5]]), e = r.enemy();
  r.env.now = 5;
  for (let i = 0; i < 9; i++) r.hit(e, w, 12, { weak: true });
  r.env.now = 5.05;
  r.hit(e, w, 12, { weak: true });
  r.fx.flush();
  assert.equal(r.env.blasts.length, 1);
  r.env.now = 5.2;
  r.hit(e, w, 12, { weak: true });
  r.fx.flush();
  assert.equal(r.env.blasts.length, 2);
});

test('副元素：同一把枪对同一敌人同帧只排一条，强度 = 上一帧合并伤害，钳到最大生命一半', () => {
  const r = fxRig({ rand: 0 });
  const w = r.gun('shotgun', [['subFire', 0.3]]);
  const e = r.enemy(1000), other = r.enemy(1000);
  for (let i = 0; i < 9; i++) r.hit(e, w, 12);
  r.hit(other, w, 20);
  r.fx.flush();
  assert.equal(r.env.applied.length, 2, '同种附着只排一条');
  const a = r.env.applied.find(x => x.e === e);
  assert.equal(a.status, 'burn');
  near(assert, a.power, 108, EPS, '9 × 12（空属性表下状态强度 = 合并伤害）');
  assert.equal(a.opts.depth, 0);
  assert.equal(a.opts.weaponUid, w.uid);
  near(assert, r.env.applied.find(x => x.e === other).power, 20, EPS);
  const small = r.enemy(100);
  r.hit(small, w, 80);
  r.fx.flush();
  near(assert, r.env.applied.at(-1).power, 50, EPS, '钳到最大生命一半');
  const before = r.env.applied.length;
  r.hit(e, w, 30, { applied: 'burn' });
  r.hit(other, w, 30, { killed: true });
  r.env.rand = 0.5;
  r.hit(small, w, 30);
  r.fx.flush();
  assert.equal(r.env.applied.length, before, '这一击已附着同种状态 / 打死了 / 掷骰没中都不附着');
});

test('青冥雷蛊的固有「副·雷」40% 走词条', () => {
  const r = fxRig({ rand: 0.39 });
  const d = def('stormpod');
  assert.deepEqual(d.innate[0], { id: 'subShock', value: 0.4 });
  const w = r.gun('stormpod', d.innate.map(a => [a.id, a.value]), { element: 'corrode' });
  const e = r.enemy();
  r.hit(e, w, 60, { element: 'corrode' });
  r.fx.flush();
  assert.deepEqual(r.env.applied.map(x => x.status), ['shock']);
  r.env.rand = 0.41;
  r.hit(e, w, 60, { element: 'corrode' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 1);
});

test('击杀回填：round(容量 × 值)、至少 1 发，衍生击杀不回填', () => {
  const r = fxRig();
  const w = r.gun('smg', [['killRefill', 0.2]]), R = r.resolve(w), e = r.enemy();
  r.kill(e, w);
  assert.equal(r.env.refills.length, 1);
  assert.equal(r.env.refills[0].rounds, Math.max(1, Math.floor(R.magCap * 0.2 + 0.5)));
  r.kill(e, w, { depth: 1 });
  assert.equal(r.env.refills.length, 1, '衍生击杀（弹射、爆头爆炸）不回填');
  const tiny = r.gun('magmashot', [['killRefill', 0.12]]);
  r.kill(e, tiny);
  assert.equal(r.env.refills.at(-1).rounds, 1, '2 发弹匣 × 12% → 至少 1 发');
});

test('命中回盾：实际伤害 × 值，0 伤害不加', () => {
  const r = fxRig();
  const w = r.gun('smg', [['hitShield', 0.05]]), e = r.enemy();
  r.hit(e, w, 40);
  r.hit(e, w, 0);
  assert.equal(r.env.shields.length, 1);
  near(assert, r.env.shields[0], 2, EPS);
});

test('弹射：几率按 1/√弹丸数折算，50% 基础伤害、深度 1、可暴击，不会再弹', () => {
  const r = fxRig({ rand: 0.2 });
  const w = r.gun('smg', [['ricochet', 0.3]]), e = r.enemy();
  r.env.nearest = r.enemy();
  r.env.nearest.position.set(3, 0, 0);
  r.hit(e, w, 40);
  r.fx.flush();
  assert.equal(r.env.strikes.length, 1);
  const s = r.env.strikes[0];
  assert.equal(s.target, r.env.nearest);
  near(assert, s.req.base, 20, EPS, '50% 基础伤害');
  assert.equal(s.req.procDepth, 1);
  assert.notEqual(s.req.canCrit, false, '弹射可以暴击');
  assert.equal(s.req.weaponUid, w.uid);
  r.hit(s.target, w, 20, { depth: 1 });
  r.fx.flush();
  assert.equal(r.env.strikes.length, 1, '衍生伤害不会再弹');
  const sg = r.gun('shotgun', [['ricochet', 0.3]]);
  r.hit(e, sg, 12);
  r.fx.flush();
  assert.equal(r.env.strikes.length, 1, '霰弹：0.2 > 0.3 / 3，不弹');
  r.env.nearest = null;
  r.hit(e, w, 40);
  r.fx.flush();
  assert.equal(r.env.strikes.length, 1, '周围没人：什么都不做');
});

test('回元 / 化盾 / 疾化：只认本武器引发的反应，回元和化盾 0.3 s 内最多一次，疾化 3 s 并刷新', () => {
  const r = fxRig();
  const w = r.gun('smg', [['rxnRefill', 0.1], ['rxnShield', 6], ['rxnHaste', 0.2]]), R = r.resolve(w), e = r.enemy();
  r.env.now = 10;
  r.reaction(e, null);
  assert.equal(r.env.refills.length + r.env.shields.length, 0, '不是本武器引发的反应');
  r.reaction(e, w);
  assert.equal(r.env.refills[0].rounds, Math.max(1, Math.floor(R.magCap * 0.1 + 0.5)));
  assert.deepEqual(r.env.shields, [6]);
  near(assert, r.host.runtime(w).rxnHasteUntil, 13, EPS, '疾化 3 s');
  r.env.now = 10.2;
  r.reaction(e, w);
  assert.equal(r.env.refills.length, 1);
  assert.equal(r.env.shields.length, 1);
  near(assert, r.host.runtime(w).rxnHasteUntil, 13.2, EPS, '疾化刷新');
  r.env.now = 10.4;
  r.reaction(e, w);
  assert.equal(r.env.refills.length, 2);
  assert.equal(r.env.shields.length, 2);
});

test('输出修饰：猎首只对首领 / 精英的武器伤害；乘隙按元素状态种数；反应伤害只吃化合；持续伤害都不吃', () => {
  const r = fxRig();
  const hunter = r.gun('smg', [['hunter', 0.2]]);
  const boss = r.enemy(1000, { isBoss: true }), elite = r.enemy(1000, { isElite: true }), normal = r.enemy();
  const weapon = w => ({ base: 10, element: 'none', source: 'weapon', weaponUid: w.uid });
  near(assert, r.mod(boss, weapon(hunter)), 1.2, EPS);
  near(assert, r.mod(elite, weapon(hunter)), 1.2, EPS);
  assert.equal(r.mod(normal, weapon(hunter)), 1, '普通敌人不加');
  near(assert, r.mod(boss, { ...weapon(hunter), tags: ['explosion'] }), 1.2, EPS, '武器投射物的爆炸也吃');
  assert.equal(r.mod(boss, { ...weapon(hunter), source: 'status', tags: ['reaction'] }), 1, '反应伤害不吃');
  assert.equal(r.mod(boss, { ...weapon(hunter), source: 'status', tags: ['dot'] }), 1, '持续伤害不吃');
  assert.equal(r.mod(boss, { base: 10, element: 'none', source: 'skill' }), 1, '技能伤害不吃');

  const w = r.gun('smg', [['statusHunter', 0.08], ['rxnDmg', 0.25]]);
  const e = r.enemy();
  e.statuses.set('burn', {}); e.statuses.set('corrode', {}); e.statuses.set('slow', {});
  near(assert, r.mod(e, weapon(w)), 1 + 0.08 * 2, EPS, '两种元素状态（减速不算）');
  near(assert, r.mod(e, { ...weapon(w), tags: ['explosion'], procDepth: 1 }), 1 + 0.08 * 2, EPS, '武器爆炸、衍生伤害也吃乘隙');
  near(assert, r.mod(e, { ...weapon(w), source: 'status', tags: ['reaction'] }), 1.25, EPS, '反应伤害只吃化合');
  assert.equal(r.mod(e, { ...weapon(w), source: 'status', tags: ['dot'] }), 1, '持续伤害都不吃');
  e.statuses.clear();
  assert.equal(r.mod(e, weapon(w)), 1);
});

test('破势：要暴击或爆头、目标身上有元素状态，同一把枪 1.5 s 一次', () => {
  const r = fxRig();
  const w = r.gun('revolver', [['detonate', 0.8]]), e = r.enemy();
  r.env.now = 20;
  r.hit(e, w, 60, { crit: true });
  r.fx.flush();
  assert.equal(r.env.detonates.length, 0, '身上没有元素状态');
  e.statuses.set('burn', {});
  r.hit(e, w, 60);
  r.fx.flush();
  assert.equal(r.env.detonates.length, 0, '不是暴击也不是爆头');
  r.hit(e, w, 60, { weak: true });
  r.fx.flush();
  assert.equal(r.env.detonates.length, 1);
  near(assert, r.env.detonates[0].opts.mult, 0.8, EPS);
  near(assert, r.env.detonates[0].opts.power, 60, EPS);
  assert.equal(r.env.detonates[0].opts.weaponUid, w.uid);
  r.env.now = 21.4;
  r.hit(e, w, 60, { crit: true });
  r.fx.flush();
  assert.equal(r.env.detonates.length, 1, '1.5 s 内不再引爆');
  r.env.now = 21.5;
  r.hit(e, w, 60, { crit: true });
  r.fx.flush();
  assert.equal(r.env.detonates.length, 2);
});

test('蛊种：6 s 内目标发生反应时以词条威力传染给 8 m 内一名敌人，只传一次、传染出的不再传', () => {
  const r = fxRig();
  const w = r.gun('lantern', [['seed', 0.4]], { element: 'corrode' }), e = r.enemy(), near1 = r.enemy();
  r.env.nearest = near1;
  r.hit(e, w, 30, { element: 'corrode' });
  r.env.now = 3;
  r.reaction(e, null, { id: 'meltdown', base: 50 });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 1);
  const t = r.env.triggers[0];
  assert.equal(t.e, near1);
  assert.equal(t.id, 'meltdown');
  near(assert, t.opts.fixedBase, 50 * 0.4, EPS, '威力 = 原反应 × 词条值');
  assert.equal(t.opts.depth, 1);
  assert.equal(t.opts.tag, 'echo');
  assert.equal(t.opts.weaponUid, w.uid);
  r.reaction(e, null, { id: 'meltdown', base: 50 });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 1, '一颗蛊种只传一次');
  r.hit(e, w, 30, { element: 'corrode' });
  r.env.now = 3 + fxConsts.SeedDuration + 0.1;
  r.reaction(e, null, { base: 50 });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 1, '过了 6 s 蛊种失效');
  r.hit(e, w, 30, { element: 'corrode' });
  r.reaction(e, null, { base: 50, tag: 'echo' });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 1, '传染出的反应不再传染');
});

test('clear 丢掉没执行的触发；flush 里排进来的留到下一次', () => {
  const r = fxRig();
  const w = r.gun('revolver', [['headBlast', 0.6]]), e = r.enemy();
  r.hit(e, w, 50, { weak: true });
  r.fx.clear();
  r.fx.flush();
  assert.equal(r.env.blasts.length, 0, '换关：丢弃');
  // 执行爆头爆炸时又打出一发爆头（爆炸里再入队）：这次 flush 不执行它
  r.env.now = 2;
  r.hit(e, w, 50, { weak: true });
  const explode = r.ctx.combat.explode;
  r.ctx.combat.explode = (...args) => { explode(...args); if (r.env.blasts.length === 1) { r.env.now = 3; r.hit(e, w, 50, { weak: true }); } };
  r.fx.flush();
  assert.equal(r.env.blasts.length, 1);
  r.fx.flush();
  assert.equal(r.env.blasts.length, 2, '下一次 flush 才执行');
});

// ───────────── 传说运行时 ─────────────

test('狂热：命中叠层（同帧多弹丸只一层）到 10 层；鼎沸：自己引发的反应叠层到 8 层、4 s 清空，武器与反应伤害都吃', () => {
  const r = fxRig();
  const frenzy = r.gun('shotgun', [['lg_frenzy', 0.04]], { rarity: 4 }), e = r.enemy();
  r.env.now = 1;
  for (let i = 0; i < 9; i++) r.hit(e, frenzy, 12);
  assert.equal(r.host.runtime(frenzy).frenzy, 1, '一发霰弹只叠一层');
  for (let i = 0; i < 20; i++) { r.env.now += 0.1; r.hit(e, frenzy, 12); }
  assert.equal(r.host.runtime(frenzy).frenzy, lgConsts.lg_frenzy.MaxStacks);

  const boil = r.gun('smg', [['lg_boil', 0.06]], { rarity: 4, element: 'fire' });
  const weapon = { base: 10, element: 'fire', source: 'weapon', weaponUid: boil.uid };
  const rx = { ...weapon, source: 'status', tags: ['reaction'] };
  r.env.now = 50;
  assert.equal(r.mod(e, weapon), 1);
  r.reaction(e, boil);
  near(assert, r.mod(e, weapon), 1.06, EPS);
  near(assert, r.mod(e, rx), 1.06, EPS, '反应伤害也吃');
  r.reaction(e, null);
  near(assert, r.mod(e, weapon), 1.06, EPS, '别人的反应不叠');
  for (let i = 0; i < 12; i++) { r.env.now += 0.5; r.reaction(e, boil); }
  near(assert, r.mod(e, weapon), 1 + 0.06 * lgConsts.lg_boil.MaxStacks, EPS, '最多 8 层');
  r.env.now += lgConsts.lg_boil.Window + 0.1;
  assert.equal(r.mod(e, weapon), 1, '4 s 没触发清空');
  r.reaction(e, boil);
  near(assert, r.mod(e, weapon), 1.06, EPS, '从 0 重新叠');
});

test('轮回：每 0.6 s 依次附加灼烧、雷殛、蚀化，本武器引发的「归墟」×1.5', () => {
  const r = fxRig();
  const w = r.gun('smg', [['lg_lunhui', 0.6]], { rarity: 4 }), e = r.enemy();
  const seq = [];
  for (let i = 0; i < 4; i++) {
    r.env.now = 10 + i * 0.6;
    r.hit(e, w, 20);
    r.hit(e, w, 20);
    r.fx.flush();
    seq.push(r.env.applied.at(-1).status);
  }
  assert.deepEqual(seq, ['burn', 'shock', 'corrode', 'burn']);
  assert.equal(r.env.applied.length, 4, '0.6 s 内只附着一次');
  const rx = tags => r.mod(e, { base: 10, element: 'none', source: 'status', weaponUid: w.uid, tags });
  near(assert, rx(['reaction', 'abyss']), lgConsts.lg_lunhui.AbyssMult, EPS);
  assert.equal(rx(['reaction']), 1, '别的反应不加');
});

test('合璧：命中带有其他元素状态的敌人必定附加本发元素，同一敌人有间隔（1 s ÷ (1 + 反应急速)，最低 0.3 s）', () => {
  const r = fxRig();
  const w = r.gun('smg', [['lg_bond', 1]], { rarity: 4, element: 'fire' }), e = r.enemy();
  r.env.now = 5;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 0, '身上没有别的元素状态');
  e.statuses.set('shock', {});
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.deepEqual(r.env.applied.map(a => a.status), ['burn']);
  r.env.now = 5.9;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 1, '1 s 内不再强制附着');
  r.env.now = 6.01;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 2);
  r.stats.add('reactionHaste', 9, 't');
  r.env.now = 6.01 + lgConsts.lg_bond.GapFloor - 0.05;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 2, '间隔下限 0.3 s（上一次是按 1 s 排的）');
  r.env.now = 7.02;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  r.env.now = 7.02 + lgConsts.lg_bond.GapFloor + 0.01;
  r.hit(e, w, 20, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.applied.length, 4, '反应急速 +900% → 间隔钳到 0.3 s');
});

test('万象：三种元素各自独立掷骰，附着引发的反应威力 ×0.6', () => {
  const r = fxRig({ rand: 0 });
  const w = r.gun('smg', [['lg_prism', 1.6 / 13]], { rarity: 4 }), e = r.enemy();
  r.hit(e, w, 20);
  r.fx.flush();
  assert.deepEqual(r.env.applied.map(a => a.status), ['burn', 'shock', 'corrode']);
  for (const a of r.env.applied) assert.equal(a.opts.reactionScale, fxConsts.PrismReactionScale);
  r.env.rand = 0.5;
  r.hit(e, w, 20);
  r.fx.flush();
  assert.equal(r.env.applied.length, 3, '没掷中');
});

test('殉爆：击杀时同元素爆炸（半径 = 特性值 × 爆炸范围），连锁两层；涅槃：身负两种元素状态被击杀时于尸身引发反应（最大生命 × 25%）', () => {
  const r = fxRig();
  const w = r.gun('smg', [['lg_nova', 4]], { rarity: 4, element: 'fire' }), e = r.enemy(), R = r.resolve(w);
  r.kill(e, w, { element: 'fire' });
  r.fx.flush();
  assert.equal(r.env.blasts.length, 1);
  const b = r.env.blasts[0];
  near(assert, b.radius, 4 * R.blastMult, EPS);
  near(assert, b.req.base, WS.novaDamage(R), EPS);
  assert.equal(b.req.element, 'fire');
  assert.equal(b.req.procDepth, 1);
  assert.equal(b.req.knockback, lgConsts.lg_nova.Knockback);
  r.kill(e, w, { depth: 1 });
  r.fx.flush();
  assert.equal(r.env.blasts.at(-1).req.procDepth, 2, '连锁第二层');
  r.kill(e, w, { depth: 2 });
  r.fx.flush();
  assert.equal(r.env.blasts.length, 2, '深度 2 的击杀不再炸');

  const n = r.gun('smg', [['lg_nirvana', 0.25]], { rarity: 4 }), corpse = r.enemy(400);
  corpse.statuses.set('burn', {});
  r.hit(corpse, n, 50, { killed: true });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 0, '只有一种元素状态');
  corpse.statuses.set('shock', {});
  r.hit(corpse, n, 50, { killed: true });
  r.fx.flush();
  assert.equal(r.env.triggers.length, 1);
  const t = r.env.triggers[0];
  near(assert, t.base, 400 * 0.25, EPS);
  assert.equal(t.opts.depth, fxConsts.NirvanaDepth);
  assert.equal(t.opts.weaponUid, n.uid);
});
