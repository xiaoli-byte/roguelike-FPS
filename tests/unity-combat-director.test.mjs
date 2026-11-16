// Unity EditMode 对照（unity/Assets/Game/Tests/CombatDirectorTests.cs，经济部分 ScrollRuntimeTests.cs 的 EconomyConfigTests、
// BalanceModelTests.StageEssence_FieldClearCreditsOnce、BossEncounterTests 的保底串）→ node --test：同样的输入、同样的断言。
// 另加网页独有的：战斗导演的刷怪节奏 / 入场点 / 怪物表、LevelLayout 摆场景、场景文档没有新字段时原样跑。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const runRngUrl = await ts('../src/progression/RunRng.ts');
const economyUrl = await ts('../src/progression/Economy.ts');
const rewardScaleUrl = await ts('../src/progression/RewardScale.ts', { './Economy': economyUrl });
// 敌人定义：和 Unity 名册同样的耐久（tomb_beast 是冲锋型重型；tuo 在熔岩里游；boss 不进表）
const defs = {
  jerboa_blade: { id: 'jerboa_blade', hp: 60, radius: .5, coins: [1, 3] },
  scorpion_archer: { id: 'scorpion_archer', hp: 55, radius: .5, coins: [1, 3] },
  tomb_beast: { id: 'tomb_beast', hp: 300, armor: 120, radius: 1.2, coins: [5, 9] },
  fire_rat: { id: 'fire_rat', hp: 40, radius: .4, coins: [1, 2] },
  apsara: { id: 'apsara', hp: 90, shield: 40, radius: .5, flying: true, coins: [2, 4] },
  tuo: { id: 'tuo', hp: 650, armor: 120, radius: 1.5, coins: [8, 12] },
  boss_hanba: { id: 'boss_hanba', hp: 9000, radius: .9, isBoss: true, coins: [60, 100] },
};
const combatDirectorUrl = await ts('../src/world/CombatDirector.ts', {
  '../enemies/Registry': data(`const defs=${JSON.stringify(defs)}; export function getEnemyDef(id){return defs[id];}`),
  '../progression/RewardScale': rewardScaleUrl,
});
const stagePlanUrl = await ts('../src/progression/StagePlan.ts', { '../world/UnityStages': await ts('../src/world/UnityStages.ts') });
const runRouteUrl = await ts('../src/progression/RunRoute.ts', { './RunRng': runRngUrl, './StagePlan': stagePlanUrl });
const runPlanUrl = await ts('../src/progression/RunPlan.ts', { './RunRng': runRngUrl, './RunRoute': runRouteUrl, './StagePlan': stagePlanUrl });
const levelLayoutUrl = await ts('../src/world/LevelLayout.ts', { '../progression/RunRng': runRngUrl, '../progression/RunPlan': runPlanUrl });

const { RunRng } = await import(runRngUrl);
const { Rng } = await import(await ts('../src/core/Rng.ts'));
const Economy = await import(economyUrl);
const Reward = await import(rewardScaleUrl);
const { CombatDirector, MAX_ALIVE, WARMUP, cueTime, spawnModeOf } = await import(combatDirectorUrl);
const { applyLevelLayout, chooseLevelLayout, setLayoutForce } = await import(levelLayoutUrl);
const { RunRoute } = await import(runRouteUrl);
const RunPlan = await import(runPlanUrl);

const f32 = Math.fround;
const near = (actual, expected, eps, message) => assert.ok(Math.abs(actual - expected) <= eps, `${message ?? ''} ${actual} != ${expected}`);
const E = (enemy, count, elite = false) => ({ enemyId: enemy, count, elite });
/** Unity CombatDirectorTests.Spec()：两波，4 + 2 + 1 重型 / 3 + 1 精英重型 + 1 飞天 */
const spec = () => [
  { entries: [E('jerboa_blade', 4), E('scorpion_archer', 2), E('tomb_beast', 1)] },
  { entries: [E('fire_rat', 3), E('tomb_beast', 1, true), E('apsara', 1)] },
];
const total = waves => waves.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.count, 0), 0);

afterEach(() => {
  CombatDirector.force = null;
  CombatDirector.resetRoamingBudget();
  setLayoutForce(null);
  RunPlan.setCurrentRun(null);
});

// ───────────── CombatDirectorTests ─────────────

test('Densify: only normals with two or more, rewards shared so the site total stays', () => {
  CombatDirector.force = true;
  const template = spec();
  const run = structuredClone(template);
  const scale = CombatDirector.densify(run, CombatDirector.live(null));
  // 4 → 6、2 → 3、3 → 5；单只重型、精英、单只飞天不变
  assert.deepEqual(run[0].entries.map(e => e.count), [6, 3, 1]);
  assert.deepEqual(run[1].entries.map(e => e.count), [5, 1, 1]);
  assert.equal(total(template), 12, '模板不动');
  assert.equal(total(run), 17);
  near(scale, 12 / 17, 1e-5, '每只奖励 × 原只数 ÷ 加量后只数：据点总量不变');
  near(total(run) * scale, total(template), 1e-4);
});

test('Densify: off in dev runs', () => {
  CombatDirector.force = false;
  const run = spec();
  assert.equal(CombatDirector.densify(run, CombatDirector.live({ dev: false })), 1);
  assert.equal(total(run), 12);
  CombatDirector.force = null;
  assert.equal(CombatDirector.live({ dev: true }), false, '调试局缺省不加量');
  assert.equal(CombatDirector.live({ dev: undefined }), true, '正式的局加量');
  assert.equal(CombatDirector.live(null), false, '没开局');
});

test('RewardScale: probabilistic rounding keeps the expectation', () => {
  const rng = new RunRng(20261108);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) sum += Reward.scaleReward(7, 0.7, rng);
  near(sum / n, 7 * 0.7, 0.05, '期望 = 7 × 0.7');
  assert.equal(Reward.scaleReward(5, 1, rng), 5);
  assert.equal(Reward.scaleReward(5, 0, rng), 0);
  assert.equal(Reward.scaleReward(0, 0.5, rng), 0);
  let one = 0;
  for (let i = 0; i < 1000; i++) one += Reward.scaleReward(1, 0.3, rng);
  near(one, 300, 60, '1 只魂晶 × 0.3 ≈ 30% 给 1');
});

test('Roaming budget caps coins and essence per stage', () => {
  CombatDirector.resetRoamingBudget();
  const cap = Economy.roamingCoinCap(0);
  assert.equal(cap, Economy.roundToInt(f32(Economy.ROAMING_COINS_PER_STAGE * Economy.killChapterMult(0))));
  let coins = 0;
  for (let i = 0; i < 100; i++) coins += CombatDirector.claimRoamingCoins(4, 0);
  assert.equal(coins, cap, '游荡怪灵石到额度为止');
  assert.equal(CombatDirector.claimRoamingCoins(10, 0), 0);
  let essence = 0;
  for (let i = 0; i < 100; i++) essence += CombatDirector.claimRoamingEssence(1);
  assert.equal(essence, Economy.ROAMING_ESSENCE_PER_STAGE);
  CombatDirector.resetRoamingBudget();
  assert.equal(CombatDirector.claimRoamingCoins(4, 0), 4, '进新的一关额度清零');
  assert.equal(Economy.roamingCoinCap(2), Economy.roundToInt(f32(35 * f32(1.3))), '第三章 35 × 1.3');
  assert.equal(Economy.roamingCoinCap(2), 46, 'C# float：35 × 1.29999995f = 45.5f，RoundToInt 银行家舍入 → 46');
});

test('Kill rewards: site factor shares, roadside halves, roaming claims the stage budget', () => {
  const site = {}, roaming = {}, plain = {};
  CombatDirector.applySiteReward(site, 0.5);
  CombatDirector.applySiteReward(plain, 1);
  assert.equal(Reward.rewardScaleOf(plain), null, '倍率 1 不挂');
  Reward.applyRewardScale(roaming, 1, 1, true);
  assert.equal(Reward.scaleKillCoins(plain, 9, 0), 9);
  const rng = new Rng(4);
  let sum = 0;
  for (let i = 0; i < 4000; i++) sum += Reward.scaleKillCoins(site, 9, 0, rng);
  near(sum / 4000, 4.5, 0.15);
  CombatDirector.resetRoamingBudget();
  assert.equal(Reward.scaleKillCoins(roaming, 30, 0), 30);
  assert.equal(Reward.scaleKillCoins(roaming, 30, 0), 5, '额度 35：第二只只剩 5');
  assert.equal(Reward.scaleKillEssence(roaming, 5), 5);
  assert.equal(Reward.scaleKillEssence(roaming, 5), 3, '魂晶额度 8');
  // 游荡怪覆盖据点倍率（Unity：Apply 改写倍率，roaming 只会从假变真）
  Reward.applyRewardScale(site, 1, 1, true);
  assert.deepEqual(Reward.rewardScaleOf(site), { coins: 1, essence: 1, roaming: true });
});

// ───────────── EconomyConfigTests / BalanceModelTests / BossEncounterTests ─────────────

test('Economy: chapter factors match TS', () => {
  near(Economy.killChapterMult(0), 1, 1e-5);
  near(Economy.killChapterMult(2), 1.3, 1e-5);
  near(Economy.rewardChapterMult(2), 1.7, 1e-5);
  near(Economy.shopChapterMult(2), 1.5, 1e-5);
  assert.equal(Economy.rewardCoins(80, 2), 136);
});

test('Economy: kill coins roll within range with elite and chapter', () => {
  const rng = new RunRng(1);
  for (let i = 0; i < 500; i++) {
    const normal = Economy.killCoins([2, 4], 'normal', 0, rng);
    assert.ok(normal >= 2 && normal <= 4, `${normal}`);
    const elite = Economy.killCoins([2, 4], 'elite', 2, rng);
    assert.ok(elite >= Economy.roundToInt(f32(6 * f32(1.3))) && elite <= Economy.roundToInt(f32(12 * f32(1.3))), `${elite}`);
    const boss = Economy.killCoins([0, 0], 'boss', 0, rng);
    assert.ok(boss >= 60 && boss <= 100, '首领没写时 60–100');
  }
  assert.equal(Economy.killCoins([0, 0], 'normal', 0, rng), 0, '没写灵石的普通敌人不掉');
});

test('Economy: chest coins and tier strings', () => {
  const rng = new RunRng(2);
  const lo = Economy.roundToInt(f32(f32(60 * f32(1.35)) * f32(1.4))), hi = Economy.roundToInt(f32(f32(120 * f32(1.35)) * f32(1.4)));
  for (let i = 0; i < 200; i++) {
    const normal = Economy.chestCoins('normal', 0, rng);
    assert.ok(normal >= 60 && normal <= 120);
    const elite = Economy.chestCoins('elite', 1, rng);
    assert.ok(elite >= lo && elite <= hi, `${elite} ∉ [${lo}, ${hi}]`);
  }
  assert.equal(Economy.applyTier('scroll', 'normal', 0), 'scroll');
  assert.equal(Economy.applyTier('scroll', 'elite', 0), 'scroll:min=1');
  assert.equal(Economy.applyTier('scroll:min=2', 'boss', 0), 'scroll:min=2', '写死的保底不覆盖');
  assert.equal(Economy.applyTier('weapon', 'elite', 0), 'weapon:min=1');
  assert.equal(Economy.applyTier('weapon', 'boss', 0), 'weapon:min=3', '第一章首领保底史诗');
  assert.equal(Economy.applyTier('weapon', 'boss', 1), 'weapon:min=4', '第二章起保底传说');
  assert.equal(Economy.applyTier('weapon', 'boss', 2), 'weapon:min=4');
  assert.equal(Economy.applyTier('weapon:smg', 'elite', 0), 'weapon:smg', '关卡写死的武器原样');
  assert.equal(Economy.applyTier('coins', 'elite', 0), 'coins:tier=elite');
  assert.equal(Economy.tierOf(Economy.splitReward('coins:tier=elite')), 'elite');
  assert.equal(Economy.intArg(Economy.splitReward('scroll:min=2'), 'min', 0), 2);
  assert.equal(Economy.intArg(Economy.splitReward('scroll'), 'min', 7), 7);
  assert.equal(Economy.weaponMinRarity('boss', 0), 3);
  assert.equal(Economy.weaponMinRarity('boss', 1), 4, '3-x 的传说来自鲲鹏宝箱保底');
});

test('Economy: coin gain is applied once at credit without rounding loss', () => {
  const run = { coins: 0 };
  for (let i = 0; i < 25; i++) Economy.creditCoins(run, 1, 1.08);
  assert.equal(run.coins, 27, '25 × 1.08 = 27，逐颗取整不能丢');
  assert.equal(Economy.creditCoins(run, 10, 1), 10);
  assert.equal(Economy.creditCoins(run, 0, 1), 0);
});

test('Economy: stage essence credits once per stage (boss force)', () => {
  const run = { flags: {}, essence: 0 };
  assert.ok(Economy.creditStageEssence(run, '1-1'));
  assert.ok(!Economy.creditStageEssence(run, '1-1'), '同一关只发一次');
  assert.equal(run.essence, Economy.ESSENCE_PER_STAGE);
  assert.ok(Economy.creditStageEssence(run, '1-4', true), '首领倒下时发');
  assert.ok(!Economy.creditStageEssence(run, '1-4'), '首领场出口不再发');
  assert.equal(run.essence, Economy.ESSENCE_PER_STAGE * 2);
  assert.equal(structuredClone(run).flags['stage_essence:1-4'], 1, '进关快照带着标记');
  assert.equal(Economy.essenceFor(undefined, 'boss'), 60);
  assert.equal(Economy.essenceFor(2, 'elite'), 10);
  assert.equal(Economy.essenceFor(undefined, 'normal'), 1);
});

// ───────────── 战斗导演（网页）─────────────

function scene(overrides = {}) {
  return {
    schema: 1, id: '1-1', title: '测试', scene: 'Assets/Scenes/L1_1_GobiRoad.unity',
    spawn: { position: [0, 0, 0], forward: [0, 0, 1] }, bounds: { min: [-200, -10, -200], max: [200, 50, 200] },
    renderers: [], colliders: [], platforms: [], water: [], activators: [], heightfields: [],
    navigation: { vertices: [], indices: [], areas: [] }, environment: {},
    encounters: [
      { title: 'A', position: [0, 0, 60], requires: [], waves: [{ entries: [{ enemy: 'jerboa_blade', count: 4 }, { enemy: 'tomb_beast', count: 1 }, { enemy: 'tuo', count: 1 }] }] },
      { title: 'B', position: [60, 0, 0], requires: ['A'], waves: [{ entries: [{ enemy: 'fire_rat', count: 3 }, { enemy: 'boss_hanba', count: 1 }, { enemy: 'apsara', count: 1 }] }] },
    ],
    exits: [], caches: [], camps: [{ title: '营地', position: [-100, 0, -100], yaw: 0, safeRadius: 10, openShop: true }], bosses: [],
    ...overrides,
  };
}

function context({ run = { seed: 1, difficulty: 1.2, chapter: 0 }, blocked = () => false, path = () => true } = {}) {
  const spawned = [], warnings = [];
  return {
    spawned, warnings,
    run, rng: new Rng(99), game: { state: 'playing' },
    camera: (() => { const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, -1); return camera; })(),
    player: { alive: true, position: new THREE.Vector3(), yaw: 0 },
    world: { segmentBlocked: blocked },
    nav: { nearestWalkable(p, out) { out.copy(p); return true; }, findPath(from, to, out) { out.push(to.clone()); return path(from, to); } },
    fx: { groundWarning(pos, radius, duration, color) { const w = { pos: pos.clone(), radius, duration, color, cancelled: false }; warnings.push(w); return () => { w.cancelled = true; }; } },
    enemies: { spawn(id, opts) { const e = { id, alive: true, def: defs[id], opts }; spawned.push(e); return e; } },
  };
}
const host = (state = {}) => ({ siteActive: () => !!state.site, completed: () => !!state.done });
const step = (director, seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) director.update(dt); };

test('director roster: site enemies weighted by count, bosses and lava dwellers left out', () => {
  const director = new CombatDirector(context(), scene(), { type: 'combat' }, host());
  assert.deepEqual(director.rosterWeights.map(r => [r.id, r.weight]).sort(),
    [['apsara', 1], ['fire_rat', 3], ['jerboa_blade', 4], ['tomb_beast', 1]]);
});

test('director: warm-up 25 s, packs of 3 from a hidden entry 22–75 m away, roaming reward scale, paused by sites / safe zone / clear', () => {
  const ctx = context({ blocked: (_eye, target) => target.z < 0 });
  const entries = [
    { position: [0, 0, 10], forward: [0, 0, -1], mode: 0, spread: 3, label: '太近', from: null, flyersOnly: false },
    { position: [0, 0, -40], forward: [0, 0, 1], mode: 6, spread: 3, label: '北门', from: [0, 0, -46], flyersOnly: false },
    { position: [0, 0, 200], forward: [0, 0, -1], mode: 0, spread: 3, label: '太远', from: null, flyersOnly: false },
  ];
  const state = {};
  const director = new CombatDirector(ctx, scene({ entries }), { type: 'combat' }, host(state));
  CombatDirector.force = true;
  step(director, WARMUP - 0.5);
  assert.equal(ctx.warnings.length, 0, '进关 25 s 内不刷');
  step(director, 1);
  assert.equal(ctx.warnings.length, 3, '第一群 3 只');
  for (const w of ctx.warnings) {
    assert.ok(Math.abs(w.pos.z + 40) <= 3.01 && Math.abs(w.pos.x) <= 3.01, '只从合格的入场点（北门）散开');
    near(w.duration, cueTime('gate'), 1e-9, '增援门的预告时长');
  }
  assert.equal(ctx.spawned.length, 0);
  step(director, cueTime('gate') + 0.2);
  assert.equal(ctx.spawned.length, 3);
  assert.equal(director.packs, 1);
  assert.ok(ctx.spawned.every(e => Reward.rewardScaleOf(e)?.roaming), '游荡怪挂 roaming');
  assert.ok(ctx.spawned.filter(e => e.def.id === 'tomb_beast').length <= 1, '重型一群最多一只');
  assert.ok(ctx.spawned.every(e => e.opts.level === 1.2));

  // 据点交战中：不刷，计时顺延
  state.site = true;
  step(director, 60);
  assert.equal(director.packs, 1);
  state.site = false;
  step(director, 10);
  assert.equal(director.packs, 2, '据点打完之后 4 s 恢复（不攒着一起刷）');
  state.done = true;
  step(director, 60);
  assert.equal(director.packs, 2, '关卡完成后不刷');
  state.done = false;
  ctx.player.position.set(-100, 0, -95);
  step(director, 60);
  assert.equal(director.packs, 2, '补给营安全区附近不刷');
});

test('director: dev runs and boss stages never spawn; spawnNow works for debugging', () => {
  const ctx = context({ run: { seed: 1, difficulty: 1, dev: true } });
  const director = new CombatDirector(ctx, scene(), { type: 'combat' }, host());
  step(director, 120);
  assert.equal(ctx.warnings.length, 0, '调试局');
  const boss = new CombatDirector(context(), scene(), { type: 'boss' }, host());
  CombatDirector.force = true;
  step(boss, 120);
  assert.equal(boss.packs, 0, '首领关');
  // 没有入场点的老图：视野外 24–42 m 的导航点
  assert.ok(director.spawnNow(5, 1));
  assert.equal(ctx.warnings.length, 5);
  const anchor = ctx.warnings[0].pos;
  const d = Math.hypot(anchor.x, anchor.z);
  assert.ok(d >= 24 - 4 - 4.01 && d <= 42 + 4.01, `${d}`);
  assert.equal(ctx.warnings.filter(w => w.color === 0xffc233).length, 1, '一群最多一只精英');
  assert.ok(!director.spawnNow(), '正在刷时不能再刷');
  step(director, 1);
  assert.equal(ctx.spawned.length, 5);
  assert.equal(ctx.spawned.filter(e => e.opts.elite).length, 1);
});

test('director: alive cap, growth over time, flyers-only entries', () => {
  const ctx = context();
  const entries = [{ position: [0, 0, 50], forward: [0, 0, -1], mode: 4, spread: 2, label: '飞临', from: [0, 30, 60], flyersOnly: true }];
  const director = new CombatDirector(ctx, scene({ entries }), { type: 'combat' }, host());
  CombatDirector.force = true;
  step(director, 30);
  assert.ok(ctx.spawned.length > 0 && ctx.spawned.every(e => e.def.flying), '飞临入场点只放飞行敌人');
  step(director, 600);
  assert.ok(ctx.spawned.length <= MAX_ALIVE, `场上最多 ${MAX_ALIVE} 只（${ctx.spawned.length}）`);
  for (const e of ctx.spawned) e.alive = false;
  const before = ctx.warnings.length;
  while (ctx.warnings.length === before) director.update(0.1);
  assert.equal(ctx.warnings.length - before, 7, '待了十分钟：一群 7 只（3 + ⌊分钟 / 1.5⌋，封顶 7）');
  assert.equal(spawnModeOf(4), 'flyIn');
  assert.equal(spawnModeOf('Gate'), 'gate');
  assert.equal(spawnModeOf(99), 'appear');
});

test('director: no entries array (old export) falls back cleanly; unreachable entries are skipped', () => {
  const ctx = context({ path: () => false });
  const director = new CombatDirector(ctx, scene({ entries: [{ position: [0, 0, 40], forward: [0, 0, 1], mode: 0, spread: 4, label: '', from: null, flyersOnly: false }] }), { type: 'combat' }, host());
  assert.equal(director.entries, 1);
  assert.ok(!director.spawnNow(), '走不到的入场点不用');
  const old = new CombatDirector(context(), scene(), { type: 'combat' }, host());
  assert.equal(old.entries, 0);
  assert.ok(old.spawnNow(3));
  const empty = new CombatDirector(context(), scene({ encounters: [] }), { type: 'combat' }, host());
  assert.ok(!empty.spawnNow(), '没有怪物表');
});

// ───────────── LevelLayout 摆场景（网页）─────────────

function layoutScene() {
  const doc = scene({
    spawn: { position: [0, 0, 0], forward: [0, 0, 1] },
    renderers: [
      { name: 'ground', scenePath: 'World/Ground', url: 'g.glb', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'altarN', scenePath: 'Layout/North/Altar', url: 'a.glb', position: [0, 0, -90], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'altarS', scenePath: 'Layout/South/Altar', url: 'a.glb', position: [0, 0, 90], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'rubble', scenePath: 'World/Rubble', url: 'r.glb', position: [5, 0, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'northish', scenePath: 'Layout/NorthGate', url: 'n.glb', position: [5, 0, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
    exits: [
      { position: [0, 0, -90], rotation: [0, 0, 0, 1], reward: '', requires: [], scenePath: 'Layout/North/Exit' },
      { position: [0, 0, 90], rotation: [0, 0, 0, 1], reward: '', requires: [], scenePath: 'Layout/South/Exit' },
    ],
    encounters: [
      { title: 'A', position: [0, 0, -30], requires: [], reward: 'scroll', waves: [{ entries: [{ enemy: 'jerboa_blade', count: 2 }] }] },
      { title: 'B', position: [0, 0, 30], requires: ['A'], reward: 'scroll', waves: [{ entries: [{ enemy: 'fire_rat', count: 2 }] }] },
      { title: 'C', position: [0, 0, 60], requires: ['B'], reward: '', scenePath: 'Layout/South/Optional', waves: [{ entries: [{ enemy: 'apsara', count: 1 }] }] },
    ],
    entries: [
      { scenePath: 'Layout/North/Entry', position: [0, 0, -60], forward: [0, 0, 1], mode: 0, spread: 3, label: '北', from: null, flyersOnly: false },
      { scenePath: 'World/Entry', position: [40, 0, 0], forward: [-1, 0, 0], mode: 0, spread: 3, label: '东', from: null, flyersOnly: false },
    ],
  });
  doc.layout = { variants: [
    { id: 'main', title: '自南门入', weight: 1, spawn: { scenePath: 'Layout/South/Spawn', position: [0, 0, 95], forward: [0, 0, -1] }, exit: 'Layout/North/Exit',
      only: ['Layout/North'], hide: [], requires: [], sites: [] },
    { id: 'reverse', title: '自北门入', weight: 1, spawn: { scenePath: 'Layout/North/Spawn', position: [0, 0, -95], forward: [0, 0, 1] }, exit: 'Layout/South/Exit',
      only: ['Layout/South'], hide: ['World/Rubble'], requires: [{ site: 'A', requires: ['B'] }, { site: 'B', requires: [] }],
      sites: [{ site: 'B', spec: { waves: [{ entries: [{ enemy: 'tomb_beast', count: 1 }] }] }, reward: 'weapon' }, { site: 'A', spec: null, reward: 'coins' }] },
  ] };
  return doc;
}

test('LevelLayout: the chosen variant keeps its spawn / exit / only objects, hides the rest, rewrites order and site specs', () => {
  const doc = layoutScene();
  const main = applyLevelLayout(doc, 0);
  assert.deepEqual(main.document.spawn.position, [0, 0, 95]);
  assert.deepEqual(main.document.exits.map(e => e.scenePath), ['Layout/North/Exit']);
  assert.deepEqual(main.document.renderers.map(r => r.name), ['ground', 'altarN', 'rubble', 'northish'], '「Layout/NorthGate」不算在「Layout/North」下');
  assert.deepEqual(main.document.encounters.map(e => [e.title, e.requires]), [['A', []], ['B', ['A']]], 'C 在南边的专属物体下，主走法里停用');
  assert.deepEqual(main.document.entries.map(e => e.label), ['北', '东']);
  assert.equal(main.allEncounters.length, 3, '怪物表照收停用的据点（Unity GetComponentsInChildren(true)）');

  const rev = applyLevelLayout(doc, 1);
  assert.deepEqual(rev.document.spawn.forward, [0, 0, 1]);
  assert.deepEqual(rev.document.exits.map(e => e.scenePath), ['Layout/South/Exit']);
  assert.deepEqual(rev.document.renderers.map(r => r.name), ['ground', 'altarS', 'northish'], '藏起碎石');
  assert.deepEqual(rev.document.encounters.map(e => [e.title, e.requires, e.reward]), [['A', ['B'], 'coins'], ['B', [], 'weapon'], ['C', ['B'], '']]);
  assert.deepEqual(rev.document.encounters[1].waves[0].entries.map(e => e.enemy), ['tomb_beast'], '换编制');
  assert.deepEqual(rev.document.entries.map(e => e.label), ['东']);
  assert.equal(doc.encounters[1].waves[0].entries[0].enemy, 'fire_rat', '原文档不动');
  assert.equal(rev.allEncounters[1].waves[0].entries[0].enemy, 'tomb_beast', '怪物表按变体换好的编制收');
});

test('LevelLayout: chosen per run seed + slot, forced by id, main without a route, no-op without layout data', () => {
  const doc = layoutScene();
  const plain = scene();
  const same = chooseLevelLayout(plain, null);
  assert.equal(same.document, plain, '没有 layout：原样返回');
  assert.equal(same.index, -1);
  assert.equal(chooseLevelLayout(doc, null).index, 0, '没有局：主走法');
  setLayoutForce('reverse');
  assert.equal(chooseLevelLayout(doc, null).variant.id, 'reverse');
  setLayoutForce(null);
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const run = { heroId: 'fox', seed, chapter: 0, stageIndex: 0, stage: { chapter: 0, index: 0, type: 'combat', reward: 'scroll', theme: 'desert' },
      coins: 0, kills: 0, damageDealt: 0, time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {} };
    RunPlan.beginRun(run, null, RunRoute.build(seed));
    const a = chooseLevelLayout(doc, run).index;
    assert.equal(chooseLevelLayout(doc, run).index, a, '同一局同一关重进还是同一种走法');
    seen.add(a);
  }
  assert.deepEqual([...seen].sort(), [0, 1]);
});
