// Unity EditMode 对照（unity/Assets/Game/Tests/RunRouteTests.cs、RunPlanTests.cs）→ node --test：同样的输入、同样的断言。
// 另加网页独有的：RunRng 与 core/Rng 逐位相同、场景清单（pool: true）驱动图池、RunPlanner 开局 / 清单晚到重排。
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const runRngUrl = await ts('../src/progression/RunRng.ts');
const stagePlanUrl = await ts('../src/progression/StagePlan.ts', { '../world/UnityStages': await ts('../src/world/UnityStages.ts') });
const runRouteUrl = await ts('../src/progression/RunRoute.ts', { './RunRng': runRngUrl, './StagePlan': stagePlanUrl });
const runPlanUrl = await ts('../src/progression/RunPlan.ts', { './RunRng': runRngUrl, './RunRoute': runRouteUrl, './StagePlan': stagePlanUrl });
const levelLayoutUrl = await ts('../src/world/LevelLayout.ts', { '../progression/RunRng': runRngUrl, '../progression/RunPlan': runPlanUrl });

const { RunRng } = await import(runRngUrl);
const { Rng } = await import(await ts('../src/core/Rng.ts'));
const Plan = await import(stagePlanUrl);
const { RunRoute } = await import(runRouteUrl);
const RunPlan = await import(runPlanUrl);
const { pickLayoutVariant } = await import(levelLayoutUrl);
const manifest = JSON.parse(await readFile(new URL('../public/assets/unity-levels/manifest.json', import.meta.url), 'utf8'));

const { STAGES, POOL } = Plan;
const freshRun = (seed = 1) => ({ heroId: 'fox', seed, chapter: 0, stageIndex: 0, stage: { chapter: 0, index: 0, type: 'combat', reward: 'scroll', theme: 'desert' },
  coins: 0, kills: 0, damageDealt: 0, time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {} });
const codes = list => list.map(s => s.code);
const mapsOf = (r, chapter) => r.all.filter(s => s.chapter === chapter).map(s => s.map.code).join(',');
const near = (actual, expected, eps, message) => assert.ok(Math.abs(actual - expected) <= eps, `${message ?? ''} ${actual} != ${expected}`);
const sameSet = (a, b, message) => assert.deepEqual([...a].sort(), [...b].sort(), message);

beforeEach(() => {
  Plan.setDemoEnd(null);
  Plan.setStageCatalog(null);
  RunPlan.setCurrentRun(null);
  // 缺省：前三章主图建好，第四章和备选图都还没有（图池另有一项测）
  Plan.setSceneReady(s => s.chapter < 4 && !s.alt);
});

// ───────────── RunRouteTests ─────────────

test('RunRoute: unshuffled is the designed order', () => {
  const r = RunRoute.build(42, false);
  assert.equal(r.count, 12);
  assert.deepEqual(r.maps, codes(STAGES.slice(0, 12)));
  assert.deepEqual(codes(r.all), [...r.maps], '不洗牌时槽位编号 = 地图编号');
  for (let i = 0; i < r.count; i++) {
    assert.equal(r.all[i].order, i);
    assert.equal(r.all[i].route, r);
    assert.equal(r.all[i].map, STAGES[i]);
    near(r.all[i].difficulty, STAGES[i].difficulty, 1e-6);
  }
});

test('RunRoute: shuffle permutes field maps, pins the supply camp, keeps bosses', () => {
  const ch1 = new Set(), ch2 = new Set(), ch3 = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const r = RunRoute.build(seed * 7919);
    assert.equal(r.count, 12, `种子 ${seed}`);
    assert.deepEqual(codes(r.all), ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4', '3-1', '3-2', '3-3', '3-4'], '槽位编号按位置');
    for (const s of r.all) {
      assert.equal(s.chapter, s.map.chapter, '地图不跨章');
      assert.equal(s.isBoss, s.index === 3, `${s.code}：首领永远在章末`);
      near(s.difficulty, Plan.difficulty(s.chapter, s.index), 1e-6, '难度按槽位');
      assert.equal(s.scene, s.map.scene);
      assert.equal(s.title, s.map.title);
      assert.equal(s.clearReward, s.map.clearReward);
    }
    assert.equal(r.get('1-3').map.code, '1-3', '沉沙古城有首领前的补给营：钉在第一章最后一张开放图');
    assert.ok(r.get('1-3').supplyCamp);
    sameSet(mapsOf(r, 1).split(','), ['1-1', '1-2', '1-3', '1-4']);
    sameSet(mapsOf(r, 2).split(','), ['2-1', '2-2', '2-3', '2-4']);
    sameSet(mapsOf(r, 3).split(','), ['3-1', '3-2', '3-3', '3-4']);
    ch1.add(mapsOf(r, 1)); ch2.add(mapsOf(r, 2)); ch3.add(mapsOf(r, 3));
  }
  assert.equal(ch1.size, 2, '第一章：古道 / 雅丹两种先后（沉沙古城钉住）');
  assert.equal(ch2.size, 6, '第二章三张开放图六种先后都出现过');
  assert.equal(ch3.size, 6, '第三章三张开放图六种先后都出现过');
});

test('RunRoute: same seed same route, chapters independent', () => {
  assert.deepEqual(RunRoute.build(20261108).maps, RunRoute.build(20261108).maps);
  // 第四章多建好一张图，不改变前三章的顺序（每章各自派生随机序列）
  const a = RunRoute.build(777);
  Plan.setSceneReady(s => (s.chapter < 4 && !s.alt) || s.code === '4-1');
  const b = RunRoute.build(777);
  assert.deepEqual(a.maps, b.maps.slice(0, 12));
});

test('RunRoute: unbuilt maps are skipped, later slots move up', () => {
  // 现状：第四章只建好 4-1、4-3（4-2、4-4 还没有场景）
  Plan.setSceneReady(s => (s.chapter < 4 && !s.alt) || s.code === '4-1' || s.code === '4-3');
  for (let seed = 1; seed <= 20; seed++) {
    const r = RunRoute.build(seed);
    assert.equal(r.count, 14);
    const ch4 = r.all.filter(s => s.chapter === 4);
    assert.deepEqual(codes(ch4), ['4-1', '4-2'], '两个槽位，编号不跳');
    sameSet(ch4.map(s => s.map.code), ['4-1', '4-3']);
    assert.equal(r.last, ch4[1]);
    assert.equal(r.final, r.last);
    assert.equal(r.next(r.last), null);
  }
});

test('RunRoute: pool alt maps join the shuffle with the same slot count', () => {
  Plan.setSceneReady(s => s.chapter < 4); // 备选图也建好了
  const seen = new Set();
  let withAlt = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = RunRoute.build(seed * 104729);
    assert.equal(r.count, 12, '槽位数不变：每章 3 张开放图 + 首领');
    assert.deepEqual(codes(r.all), ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4', '3-1', '3-2', '3-3', '3-4']);
    assert.equal(r.get('1-3').map.code, '1-3', '补给营那张照样钉在第一章最后');
    for (let ch = 1; ch <= 3; ch++) {
      const maps = r.all.filter(s => s.chapter === ch && !s.isBoss).map(s => s.map);
      assert.equal(new Set(maps).size, 3, `第 ${ch} 章三个槽位三张不同的图`);
      for (const m of maps) assert.ok(STAGES.includes(m) || POOL.includes(m), m.code);
    }
    for (const s of r.all) {
      seen.add(s.map.code);
      if (s.map.alt) {
        assert.equal(s.scene, s.map.scene);
        assert.equal(s.clearReward, 'scroll');
      }
    }
    if (r.all.some(s => s.map.alt)) withAlt++;
  }
  for (const code of ['1-1', '1-2', '1-A', '2-1', '2-2', '2-3', '2-A', '3-1', '3-2', '3-3', '3-A']) assert.ok(seen.has(code), `${code} 在 300 局里至少出现过一次`);
  assert.ok(withAlt > 200, `大部分局至少抽到一张备选图（${withAlt}）`);

  // 不洗牌（生涯第一局 / 调试局）不走备选图；规划表原顺序也不认它们
  assert.ok(!RunRoute.build(5, false).all.some(s => s.map.alt));
  const alt = Plan.canonical('1-A');
  assert.ok(alt);
  assert.ok(alt.alt);
  assert.equal(Plan.canonicalForScene(alt.scene), alt);
  assert.equal(RunPlan.inPlay(alt), false);
  assert.equal(RunPlan.next(alt), null);
  assert.equal(RunPlan.isFinal(alt), false);
  assert.equal(STAGES.length, 16, '主线表不含备选图（经济投影、平衡表）');
  // 存档里的路线带着备选图也能读回来
  let seed = 1;
  while (!RunRoute.build(seed * 104729).all.some(s => s.map.alt)) seed++;
  const withPool = RunRoute.build(seed * 104729);
  assert.deepEqual(RunRoute.fromMaps(withPool.maps).maps, withPool.maps);
});

test('RunPlan follows the current run\'s route', () => {
  const route = RunRoute.build(31337);
  const run = RunPlan.beginRun(freshRun(31337), null, route, false);
  try {
    assert.equal(RunPlan.currentRun(), run);
    assert.ok(RunPlan.routeOf(run));
    assert.equal(RunPlan.specOf(run, run.stage).map, route.first.map, '开局在路线的第一关');
    assert.equal(RunPlan.stageCodeOf(run), '1-1');
    near(run.difficulty, 1, 1e-6);
    assert.equal(RunPlan.first(), RunPlan.routeOf(run).first);
    // 顺着 next 走完整条路线，每一关的场景都能按路径查回同一个槽位
    let s = RunPlan.first(), n = 0;
    while (s) {
      assert.equal(RunPlan.forScene(s.scene), s, s.code);
      assert.equal(RunPlan.get(s.code), s, s.code);
      assert.equal(s.order, n);
      const next = RunPlan.next(s);
      if (!next) assert.ok(RunPlan.isFinal(s) && RunPlan.isLast(s));
      else assert.ok(!RunPlan.isFinal(s));
      s = next;
      n++;
    }
    assert.equal(n, 12);
    assert.equal(RunPlan.playable().length, 12);
    assert.equal(RunPlan.final(), RunPlan.routeOf(run).last);
    // BossEncounter.Decide：最后一关胜利，其余进下一关
    assert.ok(RunPlan.isFinal(RunPlan.get('3-4')));
    assert.ok(!RunPlan.isFinal(RunPlan.get('1-4')));
    // 规划表本身不受影响
    assert.ok(Plan.canonical('1-1').scene.endsWith('/L1_1_GobiRoad.unity'));
    assert.equal(Plan.canonical('1-1').route, null);
  } finally {
    RunPlan.setCurrentRun(null);
  }
  assert.equal(RunPlan.first(), STAGES[0], '没有局时回到规划表');
});

test('RunState.Begin with a canonical first stage finds its slot', () => {
  const route = RunRoute.build(9);
  const map = Plan.canonical('2-2');
  const run = RunPlan.beginRun(freshRun(9), map, route, false);
  assert.equal(RunPlan.specOf(run, run.stage).map, map);
  assert.equal(RunPlan.stageCodeOf(run), route.forMap(map).code);
});

test('Route survives save and clone', () => {
  const route = RunRoute.build(424242);
  const run = { ...freshRun(424242), route: [...route.maps] };
  RunPlan.enterStage(run, RunPlan.routeOf(run).get('2-3'));
  const back = JSON.parse(JSON.stringify(run));
  assert.deepEqual(back.route, [...route.maps]);
  assert.equal(RunPlan.specOf(back, back.stage).map, RunPlan.specOf(run, run.stage).map, '续玩档读回来还在同一张图');
  const clone = structuredClone(run);
  assert.notEqual(clone.route, run.route, '重来本关的快照拷一份路线');
  assert.equal(RunPlan.specOf(clone, clone.stage).map, RunPlan.specOf(run, run.stage).map);
  // 旧档没有路线：按规划表
  const old = freshRun(1);
  RunPlan.enterStage(old, Plan.canonical('1-2'));
  assert.equal(RunPlan.routeOf(old), null);
  assert.equal(RunPlan.specOf(old, old.stage), Plan.canonical('1-2'));
  // 坏档：路线里有不认识的编号
  assert.equal(RunPlan.routeOf({ ...freshRun(1), route: ['1-1', '9-9'] }), null);
});

test('Demo switch cuts the route at the slot', () => {
  Plan.setDemoEnd('1-4');
  const route = RunRoute.build(5);
  assert.ok(route.isDemo);
  assert.equal(route.final, route.get('1-4'));
  assert.equal(route.next(route.get('1-4')), null);
  assert.equal(route.playable.length, 4);
  assert.ok(!route.inPlay(route.get('2-1')));
  assert.ok(!route.isLast(route.get('1-4')));
});

test('LevelLayout.Pick: forced, or main without a route, seeded with a route', () => {
  const variants = [{ id: 'main', weight: 1 }, { id: 'reverse', weight: 1 }, { id: 'debug', weight: 0 }];
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(pickLayoutVariant(variants, 'REVERSE', null), 1, '指定 id（不分大小写）');
    assert.equal(pickLayoutVariant(variants, 'debug', null), 2, '权重 0 的只能指定');
    assert.equal(pickLayoutVariant(variants, null, null), 0, '没有局：主走法');
    assert.equal(pickLayoutVariant(variants, 'nope', null), 0, '没有这个变体：按正常规则');
  } finally {
    console.warn = warn;
  }
  const dev = { ...freshRun(3), dev: true };
  RunPlan.enterStage(dev, Plan.canonical('1-1'));
  assert.equal(pickLayoutVariant(variants, null, dev), 0, '没有路线的局（调试局 / 生涯第一局）：主走法');
  const seen = [0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const make = () => {
      const r = { ...freshRun(seed), route: [...RunRoute.build(seed).maps] };
      RunPlan.enterStage(r, RunPlan.routeOf(r).first);
      return r;
    };
    const a = pickLayoutVariant(variants, null, make()), b = pickLayoutVariant(variants, null, make());
    assert.equal(a, b, '同一局同一关（重来 / 续玩）抽到同一个变体');
    seen[a]++;
  }
  assert.ok(seen[0] > 60, `${seen}`);
  assert.ok(seen[1] > 60, `${seen}`);
  assert.equal(seen[2], 0);
});

// ───────────── RunPlanTests ─────────────

const ch4NotBuilt = s => s.chapter < 4;

test('RunPlan: stages in order with D1 difficulty', () => {
  Plan.setSceneReady(ch4NotBuilt);
  const s = STAGES;
  assert.equal(s.length, 16, '前三章 12 关 + 第四章 4-1 / 4-2 / 4-3 / 4-4');
  assert.deepEqual(codes(s), ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4', '3-1', '3-2', '3-3', '3-4', '4-1', '4-2', '4-3', '4-4']);
  for (let i = 0; i < s.length; i++) {
    assert.equal(s[i].order, i);
    near(s[i].difficulty, 1 + 0.8 * (s[i].chapter - 1) + 0.16 * s[i].index, 1e-5, s[i].code);
    assert.equal(s[i].isBoss, s[i].index === 3, `${s[i].code} 首领关 = 章内第 4 关`);
    assert.equal(s[i].clearReward, s[i].isBoss ? 'weapon' : 'scroll', s[i].code);
    assert.ok(s[i].scene.startsWith('Assets/Scenes/') && s[i].scene.endsWith('.unity'), s[i].scene);
    assert.equal(RunPlan.forScene(s[i].scene), s[i]);
    if (s[i].chapter < 4) assert.equal(RunPlan.next(s[i]), i + 1 < 12 ? s[i + 1] : null, `${s[i].code} 的下一关（第四章还没建）`);
  }
  near(RunPlan.get('1-4').difficulty, 1.48, 1e-5);
  near(RunPlan.get('2-4').difficulty, 2.28, 1e-5);
  near(RunPlan.get('3-4').difficulty, 3.08, 1e-5);
  assert.equal(RunPlan.final(), RunPlan.get('3-4'));
  assert.ok(RunPlan.isFinal(RunPlan.get('3-4')) && RunPlan.isLast(RunPlan.get('3-4')));
  assert.ok(!RunPlan.isFinal(RunPlan.get('1-4')));
  assert.equal(RunPlan.playable().length, 12);
  near(RunPlan.get('4-1').difficulty, 3.4, 1e-5);
  near(RunPlan.get('4-3').difficulty, 3.72, 1e-5);
  near(RunPlan.get('4-4').difficulty, 3.88, 1e-5);
  assert.equal(RunPlan.get('4-3').scene, 'Assets/Scenes/L4_3_Cailin.unity');
  assert.equal(RunPlan.get('4-2').chapterName, '雪域天路');
});

test('RunPlan: chapter 4 follows chapter 3, skipping unbuilt stages', () => {
  Plan.setSceneReady(() => true);
  const g = RunPlan.get;
  assert.equal(RunPlan.next(g('3-4')), g('4-1'), '3-4 之后进第四章');
  assert.equal(RunPlan.next(g('4-2')), g('4-3'), '4-2 之后是 4-3 彩林海子');
  assert.equal(RunPlan.next(g('4-3')), g('4-4'));
  assert.equal(RunPlan.final(), g('4-4'));
  assert.ok(RunPlan.isLast(g('4-4')) && !RunPlan.isFinal(g('3-4')));
  assert.equal(RunPlan.playable().length, 16);
  assert.ok(!RunPlan.isFinal(g('3-4')), '第四章建好后火麒麟不再是终局');
  assert.ok(RunPlan.isFinal(g('4-4')), '雷泽雷神是终局首领（C4-1）');

  // 只建好了 4-1：3-4 → 4-1，4-1 就是这一局的最后一关
  Plan.setSceneReady(st => st.chapter < 4 || st.code === '4-1');
  assert.equal(RunPlan.next(g('3-4')), g('4-1'));
  assert.equal(RunPlan.final(), g('4-1'));
  assert.equal(RunPlan.next(g('4-1')), null);
  assert.equal(RunPlan.playable().length, 13);

  // 4-2 没建：4-1 → 4-3 跳过 4-2
  Plan.setSceneReady(st => st.code !== '4-2');
  assert.equal(RunPlan.next(g('4-1')), g('4-3'));
  assert.ok(!RunPlan.inPlay(g('4-2')));
  assert.equal(RunPlan.playable().length, 15);

  // 现状（2026-11-07）：第四章只建好 4-1、4-3：3-4 → 4-1 → 4-3，4-3 是这一局的最后一关
  Plan.setSceneReady(st => st.chapter < 4 || st.code === '4-1' || st.code === '4-3');
  assert.equal(RunPlan.next(g('4-1')), g('4-3'));
  assert.equal(RunPlan.final(), g('4-3'));
  assert.equal(RunPlan.next(g('4-3')), null);
  assert.equal(RunPlan.playable().length, 14);

  // 第四章一关都没建：照旧在 3-4 胜利结算
  Plan.setSceneReady(ch4NotBuilt);
  assert.equal(RunPlan.final(), g('3-4'));
  assert.equal(RunPlan.next(g('3-4')), null);
  assert.ok(RunPlan.isFinal(g('3-4')));
});

test('RunPlan: supply camps before each boss', () => {
  assert.deepEqual(codes(STAGES.filter(s => s.supplyCamp)), ['1-3', '2-4', '3-4', '4-4'],
    '补给营：第一章在 1-3 末段（1-4 月牙泉入口只是安全起步台），二、三、四章在首领场门槛外');
});

test('RunPlan: demo switch ends the run at 1-4', () => {
  Plan.setSceneReady(ch4NotBuilt);
  Plan.setDemoEnd(Plan.DEMO_DEFAULT);
  const s14 = RunPlan.get('1-4');
  assert.ok(RunPlan.isDemo());
  assert.equal(RunPlan.final(), s14);
  assert.ok(RunPlan.isFinal(s14), '试玩版：1-4 就是最后一关');
  assert.ok(!RunPlan.isLast(s14), '但不是完整版的最后一关（结算文案按这个区分）');
  assert.equal(RunPlan.next(s14), null, '1-4 之后没有下一关');
  assert.equal(RunPlan.next(RunPlan.first()), RunPlan.get('1-2'));
  assert.equal(RunPlan.playable().length, 4);
  assert.ok(!RunPlan.inPlay(RunPlan.get('2-1')));
  assert.equal(STAGES.length, 16, '完整表不受开关影响');

  Plan.setDemoEnd(null);
  assert.ok(!RunPlan.isDemo());
  assert.equal(RunPlan.next(s14), RunPlan.get('2-1'));

  Plan.setDemoEnd('3-4');
  assert.ok(!RunPlan.isDemo(), '终点设成 3-4 等于完整版');
  Plan.setDemoEnd('9-9');
  assert.ok(!RunPlan.isDemo(), '不在表里的编号等于关掉');
  assert.equal(RunPlan.final(), RunPlan.get('3-4'));
});

test('RunPlan: demo switch from the URL (Unity: command line)', () => {
  assert.equal(Plan.resolveDemoEnd('?demo'), '1-4');
  assert.equal(Plan.resolveDemoEnd('?demoEnd=2-4'), '2-4');
  assert.equal(Plan.resolveDemoEnd('?demoEnd=1-3&skipmenu'), '1-3');
  assert.equal(Plan.resolveDemoEnd('?demoEnd'), '1-4', '只写开关不写关卡 = 缺省终点');
  assert.equal(Plan.resolveDemoEnd('?skipmenu'), null);
  assert.equal(Plan.resolveDemoEnd(null), null);
});

// ───────────── 网页：随机流、场景清单、开局 ─────────────

test('RunRng is bit-identical to core/Rng (mulberry32 + fork) and hashes stream names with FNV-1a', () => {
  for (const seed of [0, 1, 42, 20261108, 0xffffffff, -7]) {
    const a = new RunRng(seed), b = new Rng(seed);
    for (let i = 0; i < 64; i++) assert.equal(a.nextDouble(), b.next());
    const fa = a.fork(1234), fb = b.fork(1234);
    for (let i = 0; i < 16; i++) assert.equal(fa.nextDouble(), fb.next());
  }
  assert.equal(RunRng.hash(''), 2166136261 | 0);
  assert.equal(RunRng.hash('a'), 0xe40c292c | 0, 'FNV-1a("a")');
  assert.equal(RunRng.hash('route'), RunRng.hash('route'));
  // 不同流互不相干；同名同种子同序列
  assert.notEqual(RunRng.stream(9, '1-2/enc').nextUInt(), RunRng.stream(9, '1-2/loot').nextUInt());
  assert.deepEqual([1, 2, 3].map(() => RunRng.stream(9, 'loot').nextUInt()), [1, 2, 3].map(() => RunRng.stream(9, 'loot').nextUInt()));
  const r = new RunRng(5);
  for (let i = 0; i < 200; i++) {
    const v = r.int(2, 4);
    assert.ok(v >= 2 && v <= 4 && Number.isInteger(v));
  }
});

test('runStream: same run + stage + name continues one sequence; another stage starts fresh', () => {
  const run = RunPlan.beginRun(freshRun(77), null, RunRoute.build(77));
  const s = RunPlan.runStream(run, 'loot');
  assert.equal(RunPlan.runStream(run, 'loot'), s);
  const first = s.nextUInt();
  assert.equal(first, RunRng.stream(77, '1-1/loot').nextUInt());
  RunPlan.enterStage(run, RunPlan.routeOf(run).get('1-2'));
  assert.equal(RunPlan.runStream(run, 'loot').nextUInt(), RunRng.stream(77, '1-2/loot').nextUInt());
  RunPlan.setCurrentRun(null);
});

test('scene manifest drives readiness: pool: true alt maps join the route, otherwise the route falls back like Unity\'s ready predicate', () => {
  Plan.setSceneReady(null);
  // 清单读到之前：主线按 UnityStages.ts，备选图不进图池
  assert.ok(!Plan.sceneExported(Plan.canonical('1-A')));
  assert.ok(Plan.sceneExported(Plan.canonical('1-1')));
  assert.ok(!Plan.sceneExported(Plan.canonical('4-2')), 'UnityStages.ts：4-2 还没导出');
  for (let seed = 1; seed <= 50; seed++) assert.ok(!RunRoute.build(seed).all.some(s => s.map.alt));

  // 当前清单：16 张主图（4-2、4-4 没导出）+ 三张 pool: true 的备选图
  Plan.setStageCatalog(manifest.stages);
  const pool = manifest.stages.filter(s => s.pool && s.available).map(s => s.id);
  for (const alt of POOL) assert.equal(Plan.sceneExported(alt), pool.includes(alt.code), alt.code);
  let withAlt = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = RunRoute.build(seed * 104729);
    assert.equal(r.all.filter(s => s.chapter < 4).length, 12);
    assert.deepEqual(codes(r.all.filter(s => s.chapter === 4)), ['4-1', '4-2'], '第四章两个槽位（4-1、4-3 两张图）');
    if (r.all.some(s => s.map.alt)) withAlt++;
  }
  if (pool.length > 0) assert.ok(withAlt > 60, `${withAlt}`);

  // 清单里备选图没标 pool（或没导出）：不进图池，路线和读到清单之前一样只在主图里洗
  Plan.setStageCatalog(manifest.stages.map(({ pool: _pool, ...rest }) => rest));
  for (const alt of POOL) assert.ok(!Plan.sceneExported(alt));
  const withoutPool = RunRoute.build(31337).maps;
  Plan.setStageCatalog(null);
  assert.deepEqual(RunRoute.build(31337).maps, withoutPool);
});

test('RunPlanner: first career run uses the designed order, later runs a seeded route; a late manifest re-plans before the first stage', async () => {
  Plan.setSceneReady(null);
  const fresh = new RunPlan.RunPlanner({ meta: { save: { stats: { runs: 0 } } } }, async () => manifest.stages);
  const first = fresh.createRun('fox', 5);
  assert.equal(first.route, undefined);
  assert.equal(first.dev, undefined);
  assert.equal(fresh.firstStage(first).map, '1-1');

  let resolve;
  const late = new Promise(r => { resolve = r; });
  const veteran = new RunPlan.RunPlanner({ meta: { save: { stats: { runs: 3 } } } }, () => late);
  const run = veteran.createRun('fox', 20261116);
  assert.deepEqual(run.route, [...RunRoute.build(20261116).maps], '清单读到之前按 UnityStages.ts 排');
  const prepared = veteran.prepare(run);
  resolve(manifest.stages);
  await prepared;
  assert.deepEqual(run.route, [...RunRoute.build(20261116).maps], '清单到了之后按清单重排（备选图可能进来）');
  assert.equal(run.stage.map, RunPlan.routeOf(run).first.map.code);
  assert.equal(veteran.firstStage(run), run.stage);
  // 槽位编号 / 难度按位置，场景按地图
  let node = run.stage, n = 0;
  while (node) {
    const spec = RunPlan.specOf(run, node);
    assert.equal(node.map, spec.map.code);
    assert.equal(`${node.chapter + 1}-${node.index + 1}`, spec.code);
    near(veteran.difficultyFor(node), spec.difficulty, 1e-9);
    assert.ok(veteran.stageLabel(node).startsWith(`${spec.code} · ${spec.title}`));
    run.stage = node;
    const next = veteran.nextOptions(run);
    assert.equal(veteran.isFinalStage(node), next.length === 0);
    node = next[0];
    n++;
  }
  assert.equal(n, RunPlan.routeOf(run).count);
  RunPlan.setCurrentRun(null);
});
