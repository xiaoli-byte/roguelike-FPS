// M11d 核心 · 平衡模型与经济投影（docs/threejs-migration.md 4.7）：照 Unity EditMode 的 BalanceModelTests 逐条改写。
// 敌人 / 首领数值读 Unity 导出的定义表 public/assets/unity-gameplay/defs.json；编制表直接和 BalanceModel.cs 的源码逐行对。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './hanba-load.mjs';

const B = await importTs('../src/progression/BalanceModel.ts');
const Bosses = await importTs('../src/progression/BalanceBosses.ts');
const Economy = await importTs('../src/progression/Economy.ts');
const StagePlan = await importTs('../src/progression/StagePlan.ts');
const { QilinDef } = await importTs('../src/enemies/bosses/QilinDef.ts');
const { TALENT_COSTS } = await importTs('../src/progression/Meta.ts');

const defs = JSON.parse(readFileSync(new URL('../public/assets/unity-gameplay/defs.json', import.meta.url), 'utf8'));
B.setBalanceData(defs);
// 魂晶按「这一局会走的关」算：前三章 12 关（第四章的图在网页里是另一套场景，照 Unity 的写法：建好一关算一关）
StagePlan.setSceneReady(s => !s.alt && s.chapter <= 3);

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} 期望 ${b}，实际 ${a}`);
const inRange = (v, lo, hi, msg = '') => assert.ok(v >= lo && v <= hi, `${msg}：${v} 不在 ${lo}–${hi}`);
const chapterReady = ch => B.STAGE_LOADS.filter(l => StagePlan.canonical(l.code)?.chapter - 1 === ch).every(B.rosterReady);

// ───────────── 编制表 ─────────────

test('编制表和 BalanceModel.cs 的 Stages 逐行一致（敌人、只数、精英、升格、窖藏、强化、驻守点）', (t) => {
  const cs = readFileSync(new URL('../unity/Assets/Game/Scripts/Core/BalanceModel.cs', import.meta.url), 'utf8');
  if (cs.startsWith('%TSD-Header')) return t.skip('BalanceModel.cs 被透明加密（先跑 node scripts/unity/dlp-unity-fix.mjs）');
  const squads = text => [...text.matchAll(/S\("(\w+)", (\d+)(?:, (\d+))?\)/g)].map(m => ({ enemy: m[1], count: +m[2], elites: +(m[3] ?? 0) }));
  const rows = [...cs.matchAll(/new\("(\d-\d)", (\d+), (\d+), (\d+), (.*?)\)( \{ roadside = new\[\] \{ (.*?) \} \})?,\r?\n/g)];
  assert.equal(rows.length, 12, 'C# 里 12 张开放大图');
  assert.equal(B.STAGE_LOADS.length, rows.length);
  rows.forEach((m, i) => {
    const load = B.STAGE_LOADS[i];
    assert.equal(load.code, m[1]);
    assert.deepEqual([load.promote, load.coinCaches, load.upgrades], [+m[2], +m[3], +m[4]], load.code);
    assert.deepEqual(load.squads, squads(m[5]), `${load.code} 场地`);
    assert.deepEqual(load.roadside, squads(m[7] ?? ''), `${load.code} 驻守点`);
  });
  const fields = StagePlan.STAGES.filter(s => !s.isBoss);
  assert.deepEqual(fields.map(s => s.code), B.STAGE_LOADS.map(l => l.code), '每张开放大图一行');
  assert.equal(B.loadKills(B.stageLoad('1-1')), 52);
});

test('StageTable_EnemiesAreRegistered：编制里的敌人都在定义表里，精英只数不超过总数', () => {
  for (const load of B.STAGE_LOADS) {
    for (const q of [...load.squads, ...load.roadside]) {
      if (StagePlan.canonical(load.code).chapter === 4 && !B.balanceEnemy(q.enemy)) continue; // 第四章的雷魅随高原敌人登记
      assert.ok(B.balanceEnemy(q.enemy), `${load.code} 的 ${q.enemy} 不在名册里`);
      inRange(q.elites, 0, q.count, `${load.code} ${q.enemy}`);
    }
  }
  for (let ch = 0; ch < 3; ch++) assert.equal(chapterReady(ch), true, `第 ${ch + 1} 章的编制都登记了`);
});

// ───────────── 经济 ─────────────

test('Projection_SumsStageEstimates：每章收入投影 = 逐关估算之和，击杀数按实际编制', (t) => {
  const rows = B.projectEconomy();
  const stages = B.estimateRun();
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  near(sum(rows, r => r.total), sum(stages, e => e.coins), 0.5, '整局灵石 = 逐关估算之和');
  near(sum(rows, r => r.essence), sum(stages, e => e.essence), 0.5, '整局魂晶 = 逐关估算之和');
  assert.deepEqual(rows.map(r => [r.chapter, r.fieldStages, r.bossStages]), [[0, 3, 1], [1, 3, 1], [2, 3, 1], [3, 3, 1]]);
  for (const r of rows) if (chapterReady(r.chapter)) assert.ok(r.kills > 30 * r.fieldStages + 9, `第 ${r.chapter + 1} 章击杀数按实际编制`);
  // 灵石获取 +8%（一级财富）：灵石等比、魂晶不变
  const rich = B.projectEconomy({ killsPerBossStage: B.BOSS_STAGE_ADDS, coinGainPct: 0.08 });
  near(rich[0].total, rows[0].total * 1.08, 1e-6);
  near(rich[0].essence, rows[0].essence, 1e-9);
  near(rows[0].rareWeapons, rows[0].total / 160, 1e-9, '第一章稀有武器 160');
  near(rows[1].rareWeapons, rows[1].total / 200, 1e-6, '第二章 160 × 1.25');
  const text = B.formatProjection(rows);
  assert.ok(text.startsWith('[Economy] 每章收入投影（各关实际编制，首领场杂兵 8 只，灵石获取 +0%）'));
  assert.equal(text.split('\n').length, 2 + rows.length);
  t.diagnostic(text);
});

test('逐关估算的算法：1-1 的击杀 / 精英 / 灵石 / 魂晶 / 耐久按定义表手算；首领场 = 8 只杂兵 + 首领', () => {
  const s = StagePlan.canonical('1-1');
  const e = B.estimateStage(s);
  const load = B.stageLoad('1-1');
  let coins = 0, essence = 0, ehp = 0, kills = 0, elites = 0;
  const add = (q, mult) => {
    const d = B.balanceEnemy(q.enemy), mid = (d.coins[0] + d.coins[1]) / 2, bulk = d.hp + d.armor / 0.75 + d.shield;
    kills += q.count;
    elites += q.elites;
    coins += (q.elites * 3 + (q.count - q.elites)) * mid * mult;
    essence += (q.elites * 5 + (q.count - q.elites)) * (d.essence ?? 1) * mult;
    ehp += (q.elites * 2.6 + (q.count - q.elites)) * bulk * s.difficulty;
  };
  load.squads.forEach(q => add(q, 1));
  load.roadside.forEach(q => add(q, 0.5)); // 驻守点奖励减半
  assert.equal(load.promote, 0, '1-1 没有升格');
  assert.equal(e.kills, kills);
  near(e.elites, elites, 1e-9);
  near(e.killCoins, coins, 1e-6);
  near(e.cacheCoins, 90, 1e-9, '一处灵石窖藏 = (60 + 120) / 2');
  near(e.essence, essence + 10, 1e-6, '每关 +10');
  near(e.fieldEhp, ehp, 1e-6);
  near(e.fieldSeconds, ehp / (90 * 1.6 * 0.8), 1e-6, '难度 1 的参考秒伤 115.2');
  assert.equal(e.bossCoins, 0);
  // 升格：1-2 升一只，按耐久加权取期望（合计多一只精英）
  const e12 = B.estimateStage(StagePlan.canonical('1-2'));
  near(e12.elites, 2 + 1, 1e-9, '写定 2 只 + 升格 1 只');
  // 首领场
  const boss = B.estimateStage(StagePlan.canonical('1-4'));
  assert.equal(boss.kills, 9);
  near(boss.bossCoins, 80, 1e-9, '旱魃 60–100 的中点 × 第一章系数 1');
  assert.equal(boss.fieldSeconds, 0);
  near(boss.essence, 8 + 60 + 10, 1e-9, '8 只杂兵 + 首领 60 + 清关 10');
  near(B.estimateStage(StagePlan.canonical('2-4')).bossCoins, 80 * 1.15, 1e-4, '第二章击杀系数 1.15');
  // 3-3 末尾的熔心魔将、4-1 三领主
  near(B.estimateStage(StagePlan.canonical('3-3')).bossCoins, 80 * 1.3, 1e-4);
  assert.deepEqual([...B.lordsOf(StagePlan.canonical('4-1'))], ['boss_kui', 'boss_feilian', 'boss_huashe']);
  assert.deepEqual([...B.lordsOf(StagePlan.canonical('4-2'))], ['boss_dae']);
  assert.deepEqual(['1-4', '2-4', '3-4', '4-4'].map(c => B.bossOf(StagePlan.canonical(c))), ['boss_hanba', 'boss_kunpeng', 'boss_qilin', 'boss_leize']);
  assert.equal(B.bossOf(StagePlan.canonical('1-1')), null);
});

test('Camps_AffordThePlan_ButNotTheWholeShop：补给营买得起计划、买不下整店', (t) => {
  assert.deepEqual(B.CAMPS.map(c => [c.at, c.after, c.gear]), [['1-3', null, '1-4'], ['2-4', '1-3', '2-4'], ['3-4', '2-4', '3-4'], ['4-4', '3-4', '4-4']]);
  for (const c of B.CAMPS) {
    if (!chapterReady(B.campChapter(c))) continue;
    const budget = B.campBudget(c), shelf = B.shelfValue(c), planned = B.campPlanned(c);
    t.diagnostic(`${c.at} 补给营：预算 ${budget.toFixed(0)}，计划花销 ${planned}，整店 ${shelf.toFixed(0)}（${(budget / shelf * 100).toFixed(0)}%）`);
    assert.ok(budget >= planned * 1.25, `${c.at}：计划里的强化 + 药剂之外还要剩钱挑一件`);
    inRange(budget / shelf, 0.45, 0.85, `${c.at}：能买大半、买不下整店`);
  }
  // 价格公式（Unity ShopPricing / WeaponLibrary）
  assert.deepEqual([0, 1, 2].map(ch => B.shopPrice(40, ch)), [40, 50, 60], '药剂 40 × (1 + 0.25 × 章)');
  assert.deepEqual([0, 1, 2].map(ch => B.shopPrice(20, ch)), [20, 25, 30], '弹药箱');
  assert.deepEqual([0, 1, 2, 3, 4].map(lv => B.upgradeCost(lv, 0)), [50, 100, 150, 200, 250]);
  assert.equal(B.upgradeCost(3, 1), 260, '50 × 4 × 1.3');
  assert.equal(B.campPlanned(B.CAMPS[0]), 40, '1-3：只买药');
  assert.equal(B.campPlanned(B.CAMPS[1]), 50 + 260, '2-4：药 + 第 4 级强化');
  assert.equal(B.campPlanned(B.CAMPS[2]), 60 + 320, '3-4：药 + 第 4 级强化（50 × 4 × 1.6）');
  assert.deepEqual([...B.SCROLL_PRICE], [80, 110, 145, 185, 220]);
  assert.deepEqual(B.CHAPTER_RARITY.map(r => [...r]), [[58, 32, 8, 2, 0.4], [28, 36, 24, 9, 3], [10, 26, 32, 22, 10]]);
  assert.equal(B.rarityWeight(0, 0, 0), 58);
  near(B.rarityWeight(0, 0, 5), 58 / 1.6, 1e-9, '幸运压普通');
  near(B.rarityWeight(1, 3, 2), 9 * (1 + 0.15 * 2 * 3), 1e-9, '幸运抬高品质');
  assert.equal(B.rarityWeight(1, 1, 0, 2), 0, '低于保底的不参与');
  assert.equal(B.rarityWeight(9, 4, 0), 10, '章越界夹到最后一行');
});

test('GearPlan_TracksReferenceCurve：每个首领前的装备倍率贴着参考曲线 ±15%', () => {
  assert.deepEqual([...B.RARITY_DAMAGE], [1, 1.15, 1.35, 1.6, 1.9]);
  assert.deepEqual([B.MAX_UPGRADE, B.UPGRADE_STEP, B.UPGRADE_BASE_COST, B.UPGRADE_CHAPTER_STEP], [5, 0.12, 50, 0.3]);
  assert.deepEqual(B.GEAR.map(g => [g.before, g.rarity, g.level, g.paidLevels, g.scrollDamage]),
    [['1-4', 1, 3, 0, 0], ['2-4', 3, 4, 1, 0.05], ['3-3', 4, 3, 0, 0.1], ['3-4', 4, 4, 1, 0.1], ['4-4', 4, 5, 1, 0.3]]);
  near(B.gearPlanMult(B.GEAR[0]), 1.15 * 1.36, 1e-9);
  near(B.gearPlanMult(B.GEAR[4]), 1.9 * 1.6 * 1.3, 1e-9);
  for (const g of B.GEAR) {
    const stage = StagePlan.canonical(g.before);
    assert.ok(stage, g.before);
    const ratio = B.gearPlanMult(g) / B.gearMult(stage.difficulty);
    inRange(ratio, 1 - B.GEAR_TOLERANCE, 1 + B.GEAR_TOLERANCE, `${g.before}：${g.why}`);
    inRange(g.paidLevels, 0, g.level);
  }
  assert.equal(B.GEAR[1].rarity, Economy.RARITY.epic, '2-4 前的史诗来自旱魃宝箱保底');
  assert.equal(Economy.weaponMinRarity('boss', 0), Economy.RARITY.epic);
  assert.equal(Economy.weaponMinRarity('boss', 1), Economy.RARITY.legendary, '3-x 的传说来自鲲鹏宝箱保底');
});

// ───────────── 难度 ─────────────

test('ReferenceCurve_MatchesQilinAnchor：参考秒伤 = 90 × 装备倍率 × 1.6 × 0.8，火麒麟的定档曲线就是它', () => {
  assert.deepEqual([B.BASE_DPS, B.GEAR_GROWTH, B.KIT_MULT, B.UPTIME], [90, 1.15, 1.6, 0.8]);
  assert.deepEqual([B.BOSS_MIN_SECONDS, B.BOSS_MAX_SECONDS, B.FIELD_MIN_SECONDS, B.FIELD_MAX_SECONDS, B.GEAR_TOLERANCE, B.DPS_SPREAD], [60, 120, 35, 75, 0.15, 0.15]);
  assert.deepEqual([B.BOSS_STAGE_ADDS, B.ELITE_HP_MULT, B.ARMOR_MULT], [8, 2.6, 0.75]);
  near(B.referenceDps(QilinDef.StageDifficulty), QilinDef.referenceDps(QilinDef.StageDifficulty), 0.01);
  near(B.referenceDps(1), 90 * 1.6 * 0.8, 1e-9);
  near(B.gearMult(0.3), 1, 1e-12, '难度低于 1 按 1');
  // C# 注释里写的四档
  assert.deepEqual([1.48, 2.28, 2.92, 3.08].map(d => Math.round(B.targetableDps(d))), [223, 356, 462, 488]);
  assert.deepEqual([1.48, 2.28, 2.92, 3.08].map(d => Math.round(B.referenceDps(d))), [179, 285, 370, 391]);
  for (let d = 1; d < 3.2; d += 0.16) assert.ok(B.gearMult(d) / d > 0.99, `难度 ${d.toFixed(2)}：装备成长不落后于敌人耐久`);
});

test('ReferenceCurve_MatchesBossSoak：曲线和四个首领浸泡的实测秒伤差 ±15% 以内', () => {
  assert.deepEqual(B.BOSS_SOAK.map(r => [...r]), [['1-4', 1.48, 220], ['2-4', 2.28, 405], ['3-3', 2.92, 435], ['3-4', 3.08, 480]]);
  for (const [stage, d, dps] of B.BOSS_SOAK) {
    near(StagePlan.canonical(stage).difficulty, d, 1e-4, `${stage} 的难度`);
    inRange(B.targetableDps(d) / dps, 0.85, 1.15, `${stage}：参考曲线和首领浸泡的实测`);
  }
});

test('FieldStages_FightTimeWithinBand：开放大图的纯输出用时在 35–75 s', (t) => {
  for (const e of B.estimateRun()) {
    if (e.stage.isBoss || !B.rosterReady(B.stageLoad(e.stage.code))) continue;
    t.diagnostic(`${e.stage.code}：${e.kills} 只（精英 ${e.elites.toFixed(1)}），耐久 ${e.fieldEhp.toFixed(0)}，参考秒伤 ${B.referenceDps(e.stage.difficulty).toFixed(0)}，约 ${e.fieldSeconds.toFixed(0)} s`);
    inRange(e.fieldSeconds, B.FIELD_MIN_SECONDS, B.FIELD_MAX_SECONDS, e.stage.label);
  }
  // slice11 实测 1-1 四处遭遇合计 45 s，模型约 48 s（加了驻守点之后更长，仍在带里）
  inRange(B.estimateStage(StagePlan.canonical('1-1')).fieldSeconds, 35, 75);
});

test('Bosses_KillTimeOnReferenceCurve：四个首领按参考秒伤（±15%）的击杀用时在 60–120 s', (t) => {
  assert.deepEqual([...B.BOSS_IDS], ['boss_hanba', 'boss_kunpeng', 'boss_warlord', 'boss_qilin']);
  assert.deepEqual(B.BOSS_IDS.map(Bosses.stageDifficultyOf), [1.48, 2.28, 2.92, 3.08]);
  for (const id of B.BOSS_IDS) {
    const lo = Bosses.bossSeconds(id, 1 + B.DPS_SPREAD), mid = Bosses.bossSeconds(id), hi = Bosses.bossSeconds(id, 1 - B.DPS_SPREAD);
    t.diagnostic(`${id}（难度 ${Bosses.stageDifficultyOf(id)}，参考秒伤 ${B.referenceDps(Bosses.stageDifficultyOf(id)).toFixed(0)}）：${lo.toFixed(0)} / ${mid.toFixed(0)} / ${hi.toFixed(0)} s`);
    inRange(mid, B.BOSS_MIN_SECONDS, B.BOSS_MAX_SECONDS, `${id} 参考秒伤`);
    inRange(lo, B.BOSS_MIN_SECONDS * 0.9, B.BOSS_MAX_SECONDS, `${id} 秒伤 +15%`);
    inRange(hi, B.BOSS_MIN_SECONDS, B.BOSS_MAX_SECONDS * 1.1, `${id} 秒伤 −15%`);
  }
  assert.equal(Bosses.bossSeconds('boss_nobody'), 0);
});

// ───────────── 魂晶 ─────────────

test('Essence_TalentsTakeAboutTenWins：通关一局约 1000–1400 魂晶，约十次通关升满天赋', (t) => {
  assert.equal(B.talentTotal(), 11300, '10 项 × (60 + 120 + 200 + 300 + 450)');
  const win = B.runEssence(), die14 = B.runEssence('1-4');
  const report = Bosses.fullBalanceReport();
  t.diagnostic(report);
  assert.ok(report.includes('[Balance] 逐关估算') && report.includes('[Balance] 补给营') && report.includes('[Balance] 首领 | 难度'));
  const route = 12;
  inRange(win / route, 1000 / 12, 1400 / 12, `通关一局的魂晶（${route} 关，合计 ${win.toFixed(0)}）`);
  inRange(B.talentTotal() / win, 6, 12, '约十次通关升满全部天赋');
  assert.ok(die14 >= TALENT_COSTS[0] * 3, '第一局死在旱魃也能点三个一级天赋');
  assert.ok(B.runEssence('2-4') > die14);
  // 阵亡 = 前面清掉的关 + 这一关的一半击杀（不含清关 +10）；通关 = 全部 + 200
  const est = B.estimateRun();
  const upTo = n => est.slice(0, n).reduce((a, e) => a + e.essence, 0);
  near(die14, upTo(3) + (est[3].essence - 10) / 2, 1e-6);
  near(win, upTo(12) + 200, 1e-6);
  near(B.runEssence(null, ['1-1', '1-2']), upTo(2) + 200, 1e-6, '指定路线');
});

test('StageEssence_FieldClearCreditsOnce：清关魂晶 +10 每关只发一次（首领倒下时强制发）', () => {
  const run = { essence: 0, flags: {} };
  assert.equal(Economy.creditStageEssence(run, '1-1'), true);
  assert.equal(Economy.creditStageEssence(run, '1-1'), false, '同一关只发一次');
  assert.equal(run.essence, Economy.ESSENCE_PER_STAGE);
  assert.equal(Economy.creditStageEssence(run, '1-4', true), true, '首领倒下时发');
  assert.equal(Economy.creditStageEssence(run, '1-4'), false, '首领场出口不再发');
  assert.equal(run.essence, Economy.ESSENCE_PER_STAGE * 2);
  assert.equal(run.flags['stage_essence:1-4'], 1, '进关快照带着标记');
});
