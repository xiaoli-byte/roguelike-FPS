// M13 对照：Unity EditMode 的 Scroll*Tests.cs（Runtime / Offense / Element / Utility / Legend / Reaction / Tactics）→ node --test。
// 这一份迁的是「定义与公式」：
//   · 118 张秘卷的 id / 名字 / 稀有度 / 层数上限 / 标签 / 专属英雄 / 描述，逐张和 Unity 的定义源码（Progression/Scrolls/**）比；
//   · Unity 测试里手抄的 TS 数据表（进攻 24、元素 10、功能 30、反应 24、战术 20）和网页的表顺序一致；
//   · 属性卷（StatScroll）：Unity 写的 (Stat, 每层值) 逐张装进网页的 ScrollSystem，属性表的增量一分不差；
//   · 抽取权重（ScrollRoll.Weight / Pool）与 10 万次抽样、procScale、条件增伤四卷、元素弹三卷、传说卷的属性部分。
// 逐卷的触发行为（Unity 那边约 4000 行、靠 ScrollScope / TacticsKit 的假宿主驱动）没有迁：战术 20 卷网页原本就有 tests/scroll-tactics.test.mjs
// （Unity 的 ScrollTacticsTests 是从它移植过去的），其余见 docs/threejs-migration.md 第 7 节的表。
// 只写测试：和 Unity 不一致的地方写成 todo（见文件末尾），不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { combatRig, cs, csConsts, csTest, near, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const { SCROLL_DEFS } = await graph.load('progression/ScrollDefs.ts');
const { ScrollSystem } = await graph.load('progression/Scrolls.ts');
const Kit = await graph.load('progression/scrolls/ScrollKit.ts');
const { BASE_STATS } = await graph.load('core/Stats.ts');
const { Rng } = await graph.load('core/Rng.ts');
const groups = {
  offense: (await graph.load('progression/scrolls/defsOffense.ts')).OFFENSE_SCROLLS,
  element: (await graph.load('progression/scrolls/defsElement.ts')).ELEMENT_SCROLLS,
  utility: (await graph.load('progression/scrolls/defsUtility.ts')).UTILITY_SCROLLS,
  legend: (await graph.load('progression/scrolls/defsLegend.ts')).LEGEND_SCROLLS,
  reaction: (await graph.load('progression/scrolls/defsReaction.ts')).REACTION_SCROLLS,
  tactics: (await graph.load('progression/scrolls/defsTactics.ts')).TACTIC_SCROLLS,
};
const tsById = new Map(SCROLL_DEFS.map(d => [d.id, d]));
const num = s => Number(String(s).trim().replace(/[fF]$/, ''));

// ───────────── 读 Unity 的秘卷定义 ─────────────

const RARITY = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
const scrollsRoot = new URL('../unity/Assets/Game/Scripts/Progression/Scrolls/', import.meta.url);
const legendBase = cs('Progression/Scrolls/Legend/LegendScroll.cs');
const TAG_CONST = { LegendTag: legendBase.match(/LegendTag = "([^"]+)"/)[1], RiskTag: legendBase.match(/RiskTag = "([^"]+)"/)[1] };
/** Unity 的秘卷：{ id, file, body, name, rarity, maxStacks, tags, heroOnly, description | upside / downside, stats } */
const unity = new Map();
const sources = new Map();
for (const dir of readdirSync(scrollsRoot, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const f of readdirSync(new URL(`${dir.name}/`, scrollsRoot)).filter(x => x.endsWith('.cs'))) {
    const file = `${dir.name}/${f}`, src = readFileSync(new URL(file, scrollsRoot), 'utf8');
    sources.set(file, src);
    const legend = /: LegendScroll\b/.test(src);
    const hits = [...src.matchAll(/\bid = (?:"(\w+)"|(ScrollId))\s*[;,]/g)];
    hits.forEach((m, i) => {
      const id = m[1] ?? src.match(/const string ScrollId = "(\w+)"/)[1];
      const body = src.slice(m.index, hits[i + 1]?.index ?? m.index + 1400);
      const rarity = body.match(/\brarity = (?:(\d)|Rarity\.(\w+))/);
      const text = body.match(/\bText\("([^"]*)"(?:, "([^"]*)")?\)/);
      const desc = body.match(/\bdescription = (\$?)"((?:[^"\\]|\\.)*)"/);
      const tags = body.match(/\btags = new\[\] \{([^}]*)\}/)?.[1].split(',').map(s => s.trim()).filter(Boolean).map(t => (t.startsWith('"') ? t.replaceAll('"', '') : TAG_CONST[t]));
      unity.set(id, {
        id, file, body,
        name: body.match(/\bname = "([^"]+)"/)?.[1],
        rarity: rarity ? (rarity[1] !== undefined ? Number(rarity[1]) : RARITY[rarity[2]]) : legend ? 4 : undefined,
        maxStacks: Number(body.match(/\bmaxStacks = (\d+)/)?.[1] ?? (legend ? 1 : 3)),
        tags, heroOnly: body.match(/\bheroOnly = "(\w+)"/)?.[1],
        description: desc && desc[1] !== '$' ? desc[2] : undefined, interpolated: !!desc && desc[1] === '$',
        upside: text?.[1], downside: text?.[2],
        stats: /new StatScroll\s*\{?\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index)) || /StatScroll\s*\{\s*$/.test(src.slice(Math.max(0, m.index - 60), m.index))
          ? [...(body.match(/\bstats = new\[\] \{([^}]*)\}/)?.[1] ?? '').matchAll(/\(Stat\.(\w+), (-?[\d.]+)f?\)/g)].map(s => [s[1], num(s[2])])
          : null,
      });
    });
    // 工厂函数造的：元素弹三卷、引子三卷（稀有度 / 层数 / 标签在工厂里）
    for (const m of src.matchAll(/new ElementalRoundsScroll\("(\w+)", "([^"]+)", Element\.\w+, "([^"]+)"\)/g))
      unity.set(m[1], { id: m[1], file, name: m[2], rarity: 1, maxStacks: 3, tags: ['元素', m[3], '命中'], description: `武器命中时每层 5% 概率额外附着${m[3]}。`, factory: true });
    for (const m of src.matchAll(/RxLead\.Make\("(\w+)", "([^"]+)",/g))
      unity.set(m[1], { id: m[1], file, name: m[2], rarity: 1, maxStacks: 3, factory: true });
  }
}
// 工厂里写的数和上面抄的一致
assert.match(sources.get('Element/ElementalRounds.cs'), /rarity = 1;\s*maxStacks = 3;\s*tags = new\[\] \{ "元素", label, "命中" \};\s*description = \$"武器命中时每层 5% 概率额外附着\{label\}。";/);
assert.match(sources.get('Reaction/BasicLeads.cs'), /id = id, name = name, rarity = 1, maxStacks = 3,/);
unity.delete('id');

/** Unity Stat 枚举名 → 网页属性键 */
const statKey = name => ({ MagPct: 'magSizePct' }[name] ?? name[0].toLowerCase() + name.slice(1));

// ───────────── 夹具：真的 ScrollSystem + Combat ─────────────

async function rig({ heroId = 'fox', chapter = 0, seed = 1 } = {}) {
  const r = await combatRig(graph, THREE, { rng: new Rng(seed) });
  r.ctx.run.heroId = heroId;
  r.ctx.run.chapter = chapter;
  r.scrolls = new ScrollSystem(r.ctx);
  r.ctx.scrolls = r.scrolls;
  r.give = (id, n = 1) => { for (let i = 0; i < n; i++) r.scrolls.add(id); };
  r.snapshot = () => Object.fromEntries(Object.keys(BASE_STATS).map(k => [k, r.ctx.player.stats.get(k)]));
  return r;
}
const delta = (before, after) => Object.fromEntries(Object.keys(before).filter(k => Math.abs(after[k] - before[k]) > 1e-9).map(k => [k, +(after[k] - before[k]).toFixed(6)]));

// ───────────── 定义表 ─────────────

/** 已知的文案 / 标签差异：M13 对出来的货币叫法 / 战鼓 / 回春 / 标签顺序 / 高风险卷都已照 Unity 改齐，现在一张都不许不同 */
const KNOWN = {};

test('118 张秘卷：id 集合同 Unity（Unity 多一张「破绽」，见 todo）', () => {
  assert.equal(SCROLL_DEFS.length, 118);
  assert.equal(tsById.size, 118, 'id 不重复');
  const onlyWeb = [...tsById.keys()].filter(id => !unity.has(id)), onlyUnity = [...unity.keys()].filter(id => !tsById.has(id));
  assert.deepEqual(onlyWeb, [], '网页有、Unity 没有的秘卷');
  assert.deepEqual(onlyUnity, ['weak_point'], 'Unity 有、网页没有的秘卷');
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), { offense: 24, element: 10, utility: 30, legend: 10, reaction: 24, tactics: 20 });
});

test('每张秘卷的名字 / 稀有度 / 层数上限 / 标签 / 专属英雄 / 描述同 Unity 的定义', () => {
  const issues = {};
  let descriptions = 0;
  for (const [id, t] of tsById) {
    const u = unity.get(id), bad = [];
    assert.ok(u.name, `${id}：Unity 源码里读不到名字`);
    if (u.name !== t.name) bad.push(`name：Unity「${u.name}」网页「${t.name}」`);
    assert.ok(u.rarity !== undefined, `${id}：Unity 源码里读不到稀有度`);
    if (u.rarity !== t.rarity) bad.push(`rarity：Unity ${u.rarity} 网页 ${t.rarity}`);
    if (u.maxStacks !== t.maxStacks) bad.push(`maxStacks：Unity ${u.maxStacks} 网页 ${t.maxStacks}`);
    if ((u.heroOnly ?? undefined) !== t.heroOnly && !u.factory) bad.push(`heroOnly：Unity ${u.heroOnly} 网页 ${t.heroOnly}`);
    if (u.tags && JSON.stringify(u.tags) !== JSON.stringify(t.tags ?? [])) bad.push('tags');
    if (u.description !== undefined) { descriptions++; if (u.description !== t.description) bad.push('description'); }
    if (bad.length) issues[id] = bad.map(b => b.split('：')[0]).sort();
    for (const b of bad) if (!/^(tags|description)$/.test(b)) assert.fail(`${id} ${b}`);
  }
  assert.deepEqual(issues, KNOWN, '标签 / 描述逐字同 Unity');
  assert.ok(descriptions >= 95, `逐字比过描述的有 ${descriptions} 张`);
});

test('描述是内插字符串 / 两段式的卷：数字逐个相同（传说卷的收益 + 代价、引子三卷）', () => {
  const digits = s => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  let checked = 0;
  for (const [id, t] of tsById) {
    const u = unity.get(id);
    if (u.upside !== undefined) {
      assert.deepEqual(digits(t.description), digits(u.upside + (u.downside ?? '')), `${id}：Unity「${u.upside} / ${u.downside ?? ''}」网页「${t.description}」`);
      checked++;
    } else if (u.interpolated) {
      const tpl = u.body.match(/\bdescription = \$"((?:[^"\\]|\\.)*)"/)[1];
      const consts = csConsts(sources.get(u.file));
      const filled = tpl.replace(/\{(\w+)(?::[^}]*)?\}/g, (_, k) => (Number.isFinite(consts[k]) ? String(consts[k]) : '§'));
      if (!filled.includes('§')) { assert.deepEqual(digits(t.description), digits(filled), `${id}：Unity「${filled}」网页「${t.description}」`); checked++; }
    }
  }
  for (const id of ['rx_lead_shock', 'rx_lead_fire', 'rx_lead_corrode']) assert.deepEqual(digits(tsById.get(id).description), [8], `${id}：每层 8%`);
  assert.match(sources.get('Reaction/BasicLeads.cs'), /float chance = 0\.08f \* n;/);
  assert.ok(checked >= 7, `比过 ${checked} 张`);
});

test('Unity 测试里手抄的 TS 数据表：进攻 24 / 元素 10 / 功能 30 / 反应 24 / 战术 20，顺序同网页', () => {
  const tuples = (file, withTag) => [...csTest(file).matchAll(withTag ? /\("(\w+)", "([^"]+)", (\d), (\d+), "([^"]+)"\)/g : /\("(\w+)", "([^"]+)", (\d), (\d+)\)/g)];
  const check = (rows, list, label) => {
    assert.deepEqual(rows.map(m => m[1]), list.map(d => d.id), `${label}：顺序`);
    for (const m of rows) {
      const d = tsById.get(m[1]);
      assert.deepEqual([d.name, d.rarity, d.maxStacks], [m[2], Number(m[3]), Number(m[4])], `${label} ${m[1]}`);
      if (m[5]) assert.ok(d.tags.includes(m[5]), `${label} ${m[1]} 带「${m[5]}」标签`);
    }
  };
  check(tuples('ScrollOffenseTests.cs'), groups.offense, '进攻');
  check(tuples('ScrollElementTests.cs'), groups.element, '元素');
  check(tuples('ScrollUtilityTests.cs', true), groups.utility, '功能');
  const idList = (file, re) => [...csTest(file).match(re)[1].matchAll(/"(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(idList('ScrollReactionTests.cs', /string\[\] \w+ =\s*\{([\s\S]*?)\};/), groups.reaction.map(d => d.id), '反应：顺序');
  const tac = idList('ScrollTacticsTests.cs', /\{\s*("tac_crossfire"[\s\S]*?)\};/);
  assert.deepEqual([...tac].sort(), groups.tactics.map(d => d.id).sort(), '战术：20 张');
  // 传说：独一份（层数上限 1）、英雄卷只进本英雄的池
  for (const d of groups.legend.filter(x => x.rarity === 4)) assert.equal(d.maxStacks, 1, `${d.id}：传说卷只能拿一张`);
  assert.deepEqual(groups.legend.filter(d => d.heroOnly).map(d => [d.id, d.heroOnly]), [['fox_resonance', 'fox'], ['falcon_sky', 'falcon'], ['bear_mountain', 'bear']]);
});

// ───────────── 属性卷 ─────────────

test('属性卷：Unity 的 (Stat, 每层值) 逐张装进网页，属性增量 = 层数 × 值，卸掉后归零（StatOnlyScrollsStackLikeTs 等）', async () => {
  const statScrolls = [...unity.values()].filter(u => u.stats && u.stats.length && tsById.has(u.id));
  assert.ok(statScrolls.length >= 30, `Unity 的属性卷 ${statScrolls.length} 张`);
  for (const u of statScrolls) {
    const r = await rig();
    const before = r.snapshot();
    for (let n = 1; n <= u.maxStacks; n++) {
      r.give(u.id);
      const want = {};
      for (const [stat, v] of u.stats) want[statKey(stat)] = +((want[statKey(stat)] ?? 0) + v * n).toFixed(6);
      assert.deepEqual(delta(before, r.snapshot()), want, `${u.id} ×${n}`);
    }
    r.give(u.id);
    assert.equal(r.scrolls.stacks(u.id), u.maxStacks, `${u.id}：满层后不再叠`);
    r.scrolls.resetForRun();
    assert.deepEqual(delta(before, r.snapshot()), {}, `${u.id}：清空后属性还原`);
  }
});

test('属性卷叠层的数（ScrollRuntimeTests.StatScrollStackMathMatchesTs）：利刃 5 层 +30%，回春 3 层 延迟 3 − 1.2、恢复 30 + 24', async () => {
  const r = await rig(), s = r.ctx.player.stats;
  r.give('keen_blade', 5);
  near(assert, s.get('damagePct'), 0.3, 1e-9);
  near(assert, s.mult('damagePct'), 1.3, 1e-9);
  r.give('quick_recovery', 3);
  near(assert, s.get('shieldRegenDelay'), 3 - 1.2, 1e-9);
  near(assert, s.get('shieldRegenRate'), 30 + 24, 1e-9);
  assert.deepEqual(r.scrolls.owned().map(o => [o.def.id, o.stacks]), [['keen_blade', 5], ['quick_recovery', 3]], '按获得顺序');
  r.scrolls.resetForRun();
  assert.equal(s.get('damagePct'), 0);
});

test('传说卷的属性部分：Install 里无条件的 s.Stat(Stat.X, 常量) 同网页（玉碎 +55% 等）', async () => {
  const src = sources.get('Legend/Legendary.cs'), consts = csConsts(src);
  const classes = [...src.matchAll(/public sealed class (\w+) : LegendScroll([\s\S]*?)(?=\n    public sealed class |\n    \/\/\/ <summary>|\n}\s*$)/g)];
  let checked = 0;
  for (const [, , body] of classes) {
    const id = body.match(/\bid = (?:"(\w+)"|ScrollId)/);
    if (!id || !id[1]) continue;
    const install = body.match(/public override void Install\(ScrollScope s, int n\)\s*\{([\s\S]*?)\n        \}/)?.[1] ?? '';
    // 只认 Install 顶层（8 + 4 = 12 个空格缩进）的 s.Stat：回调里的是有条件的
    const flat = [...install.matchAll(/^ {12}s\.Stat\(Stat\.(\w+), (-?)(\w+|[\d.]+f?)\);/gm)];
    if (!flat.length) continue;
    const r = await rig(), before = r.snapshot();
    r.give(id[1]);
    const got = delta(before, r.snapshot());
    for (const [, stat, sign, expr] of flat) {
      const v = (sign ? -1 : 1) * (Number.isFinite(consts[expr]) ? consts[expr] : num(expr));
      assert.ok(Number.isFinite(v), `${id[1]}：读不出 ${expr}`);
      near(assert, got[statKey(stat)] ?? 0, v, 1e-6, `${id[1]} ${stat}`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `比过 ${checked} 项`);
});

// ───────────── 触发类：公式 ─────────────

test('procScale：1 + max(0, 难度 − 1) × 0.85，难度低于 1 不打折、NaN 当 1', () => {
  const p = d => Kit.procScale({ run: { difficulty: d } });
  assert.equal(p(1), 1);
  assert.equal(p(0.5), 1);
  near(assert, p(2.28), 1 + 1.28 * 0.85, 1e-9);
  assert.equal(p(NaN), 1);
  assert.match(cs('Progression/ScrollKit.cs'), /0\.85f/);
});

test('条件增伤四卷：先声夺人 / 断命 / 近身搏杀 / 百步穿杨的阈值和每层加成同 Unity', async () => {
  const src = sources.get('Offense/DamageScrolls.cs');
  const classes = Object.fromEntries([...src.matchAll(/public sealed class (\w+) : ConditionalDamageScroll([\s\S]*?)(?=public sealed class |$)/g)].map(m => [m[2].match(/id = "(\w+)"/)[1], { perStack: num(m[2].match(/perStack = ([\d.]+)f?/)[1]), ...csConsts(m[2]) }]));
  assert.deepEqual(Object.keys(classes).sort(), ['close_combat', 'executioner', 'first_blood', 'sharpshooter']);
  const dealt = async (id, n, setup) => {
    const r = await rig();
    r.give(id, n);
    const e = r.enemy({ maxHp: 100000 });
    setup(e);
    return r.hit(e).dealt;
  };
  const base = await dealt('keen_blade', 0, () => {});
  near(assert, base, 100, 1e-6, '没有秘卷时 100');
  for (let n = 1; n <= 3; n++) {
    const fb = classes.first_blood, ex = classes.executioner, cc = classes.close_combat, sh = classes.sharpshooter;
    near(assert, await dealt('first_blood', n, () => {}), 100 * (1 + fb.perStack * n), 1e-6, `先声夺人 ×${n}：满耐久`);
    near(assert, await dealt('first_blood', n, e => { e.hp = e.maxHp * fb.Threshold; }), 100, 1e-6, '先声夺人：恰好 90% 不算');
    near(assert, await dealt('executioner', n, e => { e.hp = e.maxHp * (ex.Threshold - 0.01); }), 100 * (1 + ex.perStack * n), 1e-6, `断命 ×${n}`);
    near(assert, await dealt('executioner', n, e => { e.hp = e.maxHp * ex.Threshold; }), 100, 1e-6, '断命：恰好 35% 不算');
    near(assert, await dealt('close_combat', n, e => e.position.set(cc.Range - 0.1, 0, 0)), 100 * (1 + cc.perStack * n), 1e-6, `近身搏杀 ×${n}`);
    near(assert, await dealt('close_combat', n, e => e.position.set(cc.Range, 0, 0)), 100, 1e-6, '近身搏杀：恰好 7 m 不算');
    near(assert, await dealt('close_combat', n, e => e.position.set(cc.Range - 0.1, 50, 0)), 100 * (1 + cc.perStack * n), 1e-6, '近身搏杀：只算水平距离');
    near(assert, await dealt('sharpshooter', n, e => e.position.set(0, 0, sh.Range + 0.1)), 100 * (1 + sh.perStack * n), 1e-6, `百步穿杨 ×${n}`);
    near(assert, await dealt('sharpshooter', n, e => e.position.set(0, 0, sh.Range)), 100, 1e-6, '百步穿杨：恰好 18 m 不算');
  }
  // 耐久 = 生命 + 护盾 + 护甲
  const armored = e => { e.maxArmor = e.maxHp; e.armor = e.maxHp * 0.7; };
  near(assert, await dealt('first_blood', 1, armored), await dealt('keen_blade', 0, armored), 1e-6, '护甲掉了三成：总耐久 85%，不到 90%，不加成');
});

test('元素弹三卷：武器直接命中、没打死、这一击没附着同种状态时，每层 5% 概率附着（燃弹 / 雷弹 / 蚀弹）', async () => {
  const chance = csConsts(sources.get('Element/ElementalRounds.cs')).ChancePerStack;
  assert.equal(chance, 0.05);
  for (const [id, status] of [['ignite_rounds', 'burn'], ['storm_rounds', 'shock'], ['acid_rounds', 'corrode']]) {
    const r = await rig();
    let roll = 0.999;
    const applied = [];
    r.events.on('enemy:statusApplied', ({ status: s }) => applied.push(s));
    r.give(id, 2);
    r.ctx.rng = { next: () => 0.999, chance: p => roll < p, range: (a, b) => (a + b) / 2, int: a => a, pick: l => l[0], weighted: l => l[0] };
    const e = r.enemy();
    roll = chance * 2 + 0.001;
    r.hit(e);
    assert.deepEqual(applied, [], `${id}：2 层 = 10%，掷 10.1% 不中`);
    roll = chance * 2 - 0.001;
    r.hit(e);
    assert.deepEqual(applied, [status], `${id}：掷 9.9% 中`);
    r.hit(e, { source: 'skill' });
    r.hit(e, { procDepth: 1 });
    assert.equal(applied.length, 1, `${id}：技能 / 衍生伤害不算`);
    const weak = r.enemy({ maxHp: 50 });
    r.hit(weak);
    assert.equal(applied.length, 1, `${id}：打死的那一击不附着`);
  }
});

// ───────────── 抽取 ─────────────

const rollCs = cs('Progression/ScrollRoll.cs');
const RC = csConsts(rollCs);
const rarityWeight = rollCs.match(/RarityWeight = \{([^}]+)\}/)[1].split(',').map(Number);
/** ScrollRoll.Weight */
function unityWeight(d, c) {
  let w = rarityWeight[d.rarity];
  w *= 1 + d.rarity * (RC.LuckPerRarity * c.luck + RC.ChapterPerRarity * c.chapter);
  const owned = (c.stacks[d.id] ?? 0) > 0;
  if (owned) w *= RC.OwnedMult;
  if (d.heroOnly) w *= RC.HeroOnlyMult;
  if (d.tags.includes('反应')) {
    if (!d.heroOnly) w *= c.hasElementSource ? RC.ReactionWithSource : RC.ReactionWithoutSource;
    if (!owned && d.tags.some(t => c.flows.includes(t))) w *= RC.FlowMult;
  }
  return w;
}
const fake = (id, rarity, maxStacks = 3, heroOnly, ...tags) => ({ id, name: id, rarity, maxStacks, heroOnly, description: 'x', tags: tags.length ? tags : ['测试'], apply: () => () => {} });
/** 同 ScrollRuntimeTests.Pool；持有的那张带「焚雷」标签，让网页从已持有里推出流派（Unity 的上下文是直接给 flows） */
const POOL = hero => [
  fake('c0', 0), fake('c1', 0, 5), fake('u0', 1), fake('u1', 1), fake('r0', 2), fake('e0', 3, 1), fake('l0', 4, 1),
  fake('owned', 1, 3, undefined, '测试', '焚雷'), fake('maxed', 0, 2), fake('mine_only', 2, 1, hero), fake('other_only', 2, 1, 'nobody'),
  fake('rx_plain', 1, 3, undefined, '反应'), fake('rx_flow', 2, 3, undefined, '反应', '焚雷'), fake('rx_mine', 3, 1, hero, '反应', '熔金'),
];
async function rollRig(heroId, seed) {
  const r = await rig({ heroId, chapter: 1, seed });
  r.ctx.player.stats.add('luck', 2, 'test');
  const pool = POOL(heroId), sys = r.scrolls;
  sys.all = pool;
  sys.byId = new Map(pool.map(d => [d.id, d]));
  sys.ownedMap.set('owned', { def: sys.byId.get('owned'), stacks: 1, unload: null });
  sys.ownedMap.set('maxed', { def: sys.byId.get('maxed'), stacks: 2, unload: null });
  return { r, pool, sys };
}

test('抽取权重的常量同 Unity：基础权重、幸运 / 章节、已有 / 专属 / 反应卷 / 流派', () => {
  const ts = readFileSync(new URL('../src/progression/Scrolls.ts', import.meta.url), 'utf8');
  assert.deepEqual(ts.match(/RARITY_WEIGHT[^=]*= \[([^\]]+)\]/)[1].split(',').map(Number), rarityWeight);
  assert.deepEqual([RC.LuckPerRarity, RC.ChapterPerRarity, RC.OwnedMult, RC.HeroOnlyMult, RC.ReactionWithSource, RC.ReactionWithoutSource, RC.FlowMult], [0.1, 0.18, 1.3, 1.5, 1.4, 0.5, 1.3]);
  assert.match(ts, /w \*= 1 \+ d\.rarity \* \(0\.1 \* luck \+ 0\.18 \* chapter\)/);
  const list = (src, name) => [...src.match(new RegExp(`${name}[^=]*= [\\[{]([^\\]}]+)[\\]}]`))[1].matchAll(/["'](\w+|[^"']+)["']/g)].map(m => m[1]);
  assert.deepEqual(list(ts, 'FLOW_TAGS'), list(rollCs, 'FlowTags'));
  assert.deepEqual(list(ts, 'ELEMENT_HEROES'), list(rollCs, 'ElementHeroes'));
  assert.deepEqual(list(ts, 'ELEMENT_AFFIXES'), list(rollCs, 'ElementAffixes'));
  // WeightFormulaMatchesTs 里的数
  const c = { luck: 2, chapter: 1, stacks: { owned: 1, maxed: 2 }, flows: ['焚雷'], hasElementSource: false };
  const p = POOL('fox'), by = id => p.find(d => d.id === id);
  [100, 52 * 1.38, 26 * 1.76, 11 * 2.14, 4 * 2.52].forEach((w, r) => near(assert, unityWeight(fake('a', r), c), w, 1e-9));
  near(assert, unityWeight(by('owned'), c), 52 * 1.38 * 1.3, 1e-9, '已有 ×1.3');
  near(assert, unityWeight(by('mine_only'), c), 26 * 1.76 * 1.5, 1e-9, '专属 ×1.5');
  near(assert, unityWeight(by('rx_plain'), c), 52 * 1.38 * 0.5, 1e-9, '反应卷没有元素来源 ×0.5');
  near(assert, unityWeight(by('rx_flow'), c), 26 * 1.76 * 0.5 * 1.3, 1e-9, '未拥有且属于已投入流派 ×1.3');
  near(assert, unityWeight(by('rx_mine'), c), 11 * 2.14 * 1.5, 1e-9, '专属反应卷不按元素来源降权');
});

test('抽取池：满层的、别的英雄的、低于保底的、排除的都不出；不放回；池子不够就少给', async () => {
  const { sys } = await rollRig('bear', 7);
  const ids = n => sys.roll(n).map(d => d.id);
  const all = ids(99);
  assert.ok(!all.includes('maxed') && !all.includes('other_only'));
  assert.ok(all.includes('mine_only') && all.includes('owned'));
  assert.equal(all.length, POOL('bear').length - 2, '池子不够就少给');
  const hi = sys.roll(99, { minRarity: 2, exclude: ['r0'] });
  assert.ok(hi.length > 0 && hi.every(d => d.rarity >= 2) && !hi.some(d => d.id === 'r0'));
  for (let i = 0; i < 200; i++) { const pick = ids(3); assert.equal(new Set(pick).size, 3, '不放回'); }
});

for (const [heroId, hasElementSource] of [['bear', false], ['fox', true]]) {
  test(`10 万次抽样的分布 = Unity 的权重公式（${hasElementSource ? '有元素来源：燎' : '没有元素来源：磐'}，幸运 2、第二章、已投入焚雷）`, async () => {
    const { sys, pool } = await rollRig(heroId, 20261020);
    const c = { luck: 2, chapter: 1, stacks: { owned: 1, maxed: 2 }, flows: ['焚雷'], hasElementSource };
    const eligible = pool.filter(d => (c.stacks[d.id] ?? 0) < d.maxStacks && (!d.heroOnly || d.heroOnly === heroId));
    const total = eligible.reduce((s, d) => s + unityWeight(d, c), 0);
    const N = 100000, counts = {};
    for (let i = 0; i < N; i++) { const id = sys.roll(1)[0].id; counts[id] = (counts[id] ?? 0) + 1; }
    assert.deepEqual(Object.keys(counts).sort(), eligible.map(d => d.id).sort(), '没抽到池子外的卷');
    for (const d of eligible) near(assert, counts[d.id] / N, unityWeight(d, c) / total, 0.01, d.id);
    for (let r = 0; r < 5; r++) {
      const e = eligible.filter(d => d.rarity === r).reduce((s, d) => s + unityWeight(d, c), 0) / total;
      const g = eligible.filter(d => d.rarity === r).reduce((s, d) => s + counts[d.id], 0) / N;
      near(assert, g, e, 0.01, `稀有度 ${r}`);
    }
  });
}

test('登记的全部秘卷、没有幸运 / 章节 / 持有：利刃的概率 = 100 ÷ 总权重（专属 ×1.5、非专属反应卷按元素来源）', async () => {
  for (const [heroId, hasElementSource] of [['fox', true], ['bear', false]]) {
    const r = await rig({ heroId, seed: 99 });
    const c = { luck: 0, chapter: 0, stacks: {}, flows: [], hasElementSource };
    const eligible = SCROLL_DEFS.filter(d => !d.heroOnly || d.heroOnly === heroId);
    const total = eligible.reduce((s, d) => s + unityWeight({ ...d, tags: d.tags ?? [] }, c), 0);
    const N = 60000;
    let keen = 0, foreign = 0;
    for (let i = 0; i < N; i++) { const d = r.scrolls.roll(1)[0]; if (d.id === 'keen_blade') keen++; if (d.heroOnly && d.heroOnly !== heroId) foreign++; }
    assert.equal(foreign, 0, '别的英雄的专属卷不出');
    near(assert, keen / N, 100 / total, 0.004, `${heroId}：利刃`);
  }
});

test('元素来源：燎 / 鼯自带；磐要靠带元素的武器、元素词条或「元素」标签的秘卷', async () => {
  const src = async (heroId, prep) => { const r = await rig({ heroId }); prep?.(r); return r.scrolls.hasElementSource(heroId); };
  assert.equal(await src('fox'), true);
  assert.equal(await src('falcon'), true);
  assert.equal(await src('bear'), false);
  assert.equal(await src('bear', r => r.give('ember_heart')), true, '持有带「元素」标签的秘卷');
  assert.equal(await src('bear', r => { r.a.element = 'fire'; }), true, '带元素的武器');
  assert.equal(await src('bear', r => { r.b.affixes.push({ id: 'subShock', value: 0.1 }); }), true, '副元素词条');
  assert.equal(await src('bear', r => { r.b.affixes.push({ id: 'dmg', value: 0.1 }); }), false);
  const r = await rig();
  r.give('rx_tf_charm');
  assert.ok(r.scrolls.ownedFlows().has('焚雷'), '已投入的流派从持有秘卷的标签里来');
});

// ───────────── 不一致清单（不改实现）─────────────

test.todo('Unity 多一张进攻卷「破绽」weak_point（精良，3 层，弱点伤害每层 +15%，Stat.WeakpointDamagePct）：网页的 defsOffense.ts 没有这张，Stats 也没有 weakpointDamagePct 这个属性（unity/…/Offense/OffenseStatScrolls.cs）');

// ───────────── M13 不一致的修正（原来的 todo：货币叫法、战鼓、回春、标签顺序、高风险传说卷）─────────────

test('货币叫法同 Unity（D13）：点金手 / 悬赏令 / 聚宝盆 / 贪婪之心写「灵石」，秘卷定义里不再出现「金币」', async () => {
  const want = {
    golden_touch: '灵石获取每层 +15%。',
    bounty: '击杀精英时每层额外掉落 12 灵石，击杀首领时每层额外掉落 60 灵石。',
    treasure_bowl: '每进入新关卡，获得每层 12 灵石本金，另获得持有灵石每层 5% 的利息（利息每层上限 30）。本金与利息上限随章节提高；每层都增加本金和利率。',
  };
  for (const [id, text] of Object.entries(want)) {
    assert.equal(unity.get(id).description, text, `${id}：Unity 原文`);
    assert.equal(tsById.get(id).description, text, id);
  }
  assert.equal(tsById.get('midas_heart').upside, unity.get('midas_heart').upside);
  assert.equal(tsById.get('midas_heart').downside, unity.get('midas_heart').downside);
  assert.match(tsById.get('midas_heart').description, /灵石获取 \+50%；每持有 100 灵石/);
  for (const d of SCROLL_DEFS) assert.doesNotMatch(`${d.description}${d.upside ?? ''}${d.downside ?? ''}`, /金币/, `${d.id}：局内货币叫灵石`);
  // 聚宝盆的提示同 Unity：「聚宝盆：本金 P + 利息 I = G 灵石」
  assert.match(sources.get('Utility/Economy.cs'), /Toast\(\$"聚宝盆：本金 \{principal\} \+ 利息 \{interest\} = \{gain\} 灵石"/);
  const r = await rig({ chapter: 1 });
  r.ctx.run.coins = 200;
  r.give('treasure_bowl');
  r.ctx.events.emit('stage:loaded', { stage: { chapter: 1 } });
  // 本金 round(12 × 1.35) = 16，利息 min(round(30 × 1.35) = 41, floor(200 × 5%) = 10) = 10
  assert.deepEqual(r.toasts.at(-1)?.[0], '聚宝盆：本金 16 + 利息 10 = 26 灵石');
  assert.equal(r.ctx.run.coins, 226);
});

test('战鼓同 Unity WarDrumScroll：「每处据点开战时」，听据点开战（encounter:started），不随每一波续上', async () => {
  assert.equal(tsById.get('war_drum').description, unity.get('war_drum').description);
  assert.equal(unity.get('war_drum').description, '每处据点开战时，8 秒内射速每层 +15%、移动速度每层 +0.5。');
  assert.match(unity.get('war_drum').body, /s\.OnEncounterStarted\(_ => ScrollKit\.ProcBuff\(s, buff, Duration\)\)/);
  const mobility = sources.get('Utility/Mobility.cs'), c = csConsts(mobility.slice(mobility.indexOf('class WarDrumScroll')));
  assert.deepEqual([c.Duration, c.FireRatePerStack, c.MoveSpeedPerStack], [8, 0.15, 0.5]);
  // Unity ScrollUtilityTests.WarDrumBuffsFireRateAndSpeedWhenAnEncounterStarts：2 层 → 射速 +30%、移速 +1，8 s 后撤掉
  const r = await rig(), s = r.ctx.player.stats;
  const base = { fire: s.get('fireRatePct'), move: s.get('moveSpeed') };
  r.give('war_drum', 2);
  r.ctx.events.emit('wave:started', { index: 1, total: 3 });
  assert.equal(s.get('fireRatePct'), base.fire, '后续波次开始不触发（Unity 只在据点开战时响）');
  r.ctx.events.emit('encounter:started', { id: '烽燧前哨', waves: 3 });
  near(assert, s.get('fireRatePct') - base.fire, 0.3, 1e-9);
  near(assert, s.get('moveSpeed') - base.move, 1, 1e-9);
  r.advance(4);
  r.ctx.events.emit('wave:started', { index: 1, total: 3 });
  r.advance(4.01);
  near(assert, s.get('fireRatePct'), base.fire, 1e-9, '8 s 后撤掉，中途来的下一波不续时长');
  near(assert, s.get('moveSpeed'), base.move, 1e-9);
});

test('回春的描述与功能卷的标签顺序同 Unity：主标签在前（灵盾 / 回春「护盾, 生存」、收割「击杀, 生存」、摄魂「击杀, 护盾」）', () => {
  assert.equal(tsById.get('quick_recovery').description, '护盾恢复延迟每层 −0.4 秒，恢复速度每层 +8/秒。');
  assert.equal(tsById.get('quick_recovery').description, unity.get('quick_recovery').description);
  const want = { spirit_ward: ['护盾', '生存'], quick_recovery: ['护盾', '生存'], harvest: ['击杀', '生存'], soul_siphon: ['击杀', '护盾'] };
  for (const [id, tags] of Object.entries(want)) {
    assert.deepEqual(unity.get(id).tags, tags, `${id}：Unity 原文`);
    assert.deepEqual(tsById.get(id).tags, tags, id);
  }
});

test('高风险传说卷同 Unity LegendScroll：标签「高风险」，描述分收益 / 代价两段，代价另起一行「代价：…」（界面标红读 downside）', () => {
  assert.equal(Kit.RISK_TAG, TAG_CONST.RiskTag);
  assert.equal(Kit.LEGEND_TAG, TAG_CONST.LegendTag);
  assert.equal(Kit.DOWNSIDE_PREFIX, legendBase.match(/DownsidePrefix = "([^"]+)"/)[1]);
  assert.equal(Kit.DOWNSIDE_COLOR, `#${legendBase.match(/DownsideHex = "([0-9a-f]{6})"/)[1]}`);
  assert.match(legendBase, /description = this\.downside == null \? upside : upside \+ "\\n" \+ DownsideLine\(this\.downside\);/);
  const risky = ['glass_cannon', 'berserk_blood', 'gambler', 'midas_heart', 'blood_pact', 'overdrive'];
  for (const d of groups.legend.filter(x => !x.heroOnly)) {
    const u = unity.get(d.id);
    assert.equal(d.upside, u.upside, `${d.id}：收益同 Unity`);
    assert.equal(d.downside, u.downside, `${d.id}：代价同 Unity`);
    assert.equal(risky.includes(d.id), d.downside !== undefined, `${d.id}：高风险的六卷有代价，万剑归宗没有`);
    assert.equal(d.tags.includes('高风险'), risky.includes(d.id), `${d.id}：标签`);
    assert.ok(!d.tags.includes('风险'), `${d.id}：传说卷不用旧的「风险」标签`);
    assert.equal(d.description, d.downside ? `${d.upside}\n代价：${d.downside}` : d.upside, `${d.id}：描述 = 收益（+ 换行 + 代价行）`);
  }
  assert.deepEqual(Kit.legendText('收益。', '代价。'), { description: '收益。\n代价：代价。', upside: '收益。', downside: '代价。' });
  assert.deepEqual(Kit.legendText('收益。'), { description: '收益。', upside: '收益。', downside: undefined });
});
