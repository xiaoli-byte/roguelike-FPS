// 旱魃（boss_hanba）与首领框架的对照测试：照 Unity EditMode 的 HanbaBalanceTests、CombatPipelineTests.SunburnStacks…、
// Ch4FoundationTests（破防条、BossDef 缺省、领主梯度）逐条改写，同样的输入、同样的断言数。
import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './hanba-load.mjs';

const { HanbaDef } = await importTs('../src/enemies/bosses/HanbaDef.ts');
const Plans = await importTs('../src/enemies/bosses/HanbaPlans.ts');
const Balance = await importTs('../src/enemies/bosses/HanbaBalance.ts');
const Sunburn = await importTs('../src/enemies/bosses/HanbaSunburn.ts');
const { BossDef, breakBarDef } = await importTs('../src/enemies/bosses/framework/BossDef.ts');
const { BreakBar } = await importTs('../src/enemies/bosses/framework/BreakBar.ts');
const Lord = await importTs('../src/enemies/bosses/framework/LordScaling.ts');
const { DotNetRandom } = await importTs('../src/enemies/bosses/framework/DotNetRandom.ts');
const { TimeScaleArbiter, TimePriority } = await importTs('../src/enemies/bosses/framework/TimeScaleArbiter.ts');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const def = () => new HanbaDef();

// ───────────── HanbaBalanceTests ─────────────

test('Tier_IsPlanValueAtStageDifficulty：1-4 定档 7700 + 3850、阈值 60% / 30%、两段第一招', () => {
  const d = def();
  const v = d.vitalsAt(HanbaDef.StageDifficulty);
  near(v.hp, HanbaDef.TierHp, 1);
  near(v.shield, HanbaDef.TierShield, 1);
  near(v.armor, 0, 1e-3);
  assert.deepEqual([...d.barTicks], [HanbaDef.ScorchedAt, HanbaDef.RedEarthAt]);
  assert.deepEqual(d.validate(), []);
  assert.equal(d.phases[0].firstMove, Plans.ApsaraCall.id);
  assert.equal(d.phases[1].firstMove, Plans.Eclipse.id);
  // 定档外按难度等比外推（单档）
  near(d.vitalsAt(1).hp, 7700 / 1.48, 1e-6);
  near(d.vitalsAt(2.22).shield, 3850 * 1.5, 1e-6);
});

test('Bs2Moves_UnlockByPhase：焦裂 / 飞天之殇从二阶段起，日蚀从三阶段起，一阶段三招一直留着', () => {
  const moves = Object.fromEntries(def().moves.map(m => [m.id, m]));
  assert.equal(moves[Plans.CrackLine.id].minPhase, 1);
  assert.equal(moves[Plans.ApsaraCall.id].minPhase, 1);
  assert.equal(moves[Plans.Eclipse.id].minPhase, 2);
  for (const id of [Plans.SunSweep.id, Plans.HotWind.id, Plans.SandWraiths.id]) assert.equal(moves[id].minPhase, 0, id);
});

test('EclipseWindow_IsFixedThreeSecondsAndTriplesPearl：日蚀窗口 3 s、不吃节奏，片段 20 / 110 / 135 帧', () => {
  const d = def();
  near(d.eclipseSeconds, 3, 1e-4);
  near(d.eclipseWeakMult, 3, 1e-4);
  for (const pace of d.pace) {
    const plan = Plans.Eclipse.plan(pace);
    near(plan.windup, Plans.Eclipse.Lead, 1e-4, '日蚀前摇不吃节奏');
    near(plan.active, d.eclipseSeconds, 1e-4, '日蚀窗口不吃节奏');
  }
  near(Plans.Eclipse.Lead, 20 / 30, 1e-3);
  near(Plans.Eclipse.ClipSeconds, 135 / 30, 1e-3);
  near(d.eclipseSeconds, (110 - 20) / 30, 1e-3);
  // 事件表：eclipseStart / eclipseEnd / flare 的归一化时刻 × 片段时长 = 0.667 / 3.667 / 3.933 s
  const clip = Plans.HANBA_CLIPS.eclipse;
  const at = name => clip.events.find(e => e[1] === name)[0] * clip.frames / 30;
  near(at('eclipseStart'), Plans.Eclipse.Lead, 2e-3);
  near(at('eclipseEnd') - at('eclipseStart'), d.eclipseSeconds, 2e-3);
  near(at('flare') - at('eclipseEnd'), Plans.Eclipse.FlareAfter, 2e-3);
});

test('CrackLine_ActiveCoversSpreadAndChain：出手时长盖住蔓延 + 逐段爆开，三阶段前摇更短', () => {
  const c = Plans.CrackLine;
  const len = c.MaxLength;
  const spread = len / c.CrackSpeed;
  const chain = Math.ceil(len / c.Step) * c.ChainGap;
  assert.ok(c.activeSeconds(len) > spread + c.ExplodeDelay + chain - 1e-3);
  assert.ok(c.plan(1.4).windup < c.plan(1).windup, '三阶段焦裂前摇更短');
});

test('PacePlans_ShortenWindupsInLaterPhases：除日蚀外各招三阶段前摇不长于一阶段，整招 > 0.5 s', () => {
  const d = def();
  for (const m of Plans.HANBA_MOVES) {
    if (m.id === Plans.Eclipse.id) continue;
    const p1 = m.plan(d.paceAt(0)), p3 = m.plan(d.paceAt(2));
    assert.ok(p3.windup <= p1.windup + 1e-4, m.id);
    assert.ok(Plans.planTotal(p1) > 0.5, m.id);
  }
});

test('ClipHits_MatchEventsJson：招式的出手位置 = 动画事件在片段里的位置', () => {
  const at = (clip, name) => Plans.HANBA_CLIPS[clip].events.find(e => e[1] === name)[0];
  near(Plans.SunSweep.ClipHit, at('sunSweep', 'beamStart'), 1e-3);
  near(Plans.HotWind.ClipHit, at('droughtGale', 'hit'), 1e-3);
  near(Plans.SandWraiths.ClipHit, at('summonWraiths', 'summon'), 1e-3);
  near(Plans.CrackLine.ClipHit, at('crackPalm', 'hit'), 1e-3);
  near(Plans.ApsaraCall.ClipHit, at('apsaraCall', 'summon'), 1e-3);
  near(at('intro', 'roar'), def().roarAt, 1e-4);
  // ActAt：整段拉伸到 (hitAt − 1/60) ÷ 出手位置，事件提前约一帧落在前摇结束
  const seconds = Plans.actAtSeconds(Plans.SunSweep.ClipHit, 1.4);
  near(seconds * Plans.SunSweep.ClipHit, 1.4 - 1 / 60, 1e-6);
});

test('KillTime_EveryProfileWithinSixtyToOneTwenty：三种打法各 16 个种子平均 60–120 s，单个 50–130 s，越强越快', () => {
  const d = def();
  let prev = Infinity;
  for (const p of Balance.PROFILES) {
    const { mean, min, max, sample } = Balance.average(d, p, 16);
    console.log(`${p.name}：平均 ${mean.toFixed(1)} s（${min.toFixed(1)}–${max.toFixed(1)}），样例 ${Balance.describe(sample)}`);
    assert.ok(mean >= Balance.TARGET_MIN && mean <= Balance.TARGET_MAX, `${p.name} 平均击杀用时 ${mean.toFixed(1)} s`);
    assert.ok(min >= 50, `${p.name} 最快 ${min.toFixed(1)} s`);
    assert.ok(max <= 130, `${p.name} 最慢 ${max.toFixed(1)} s`);
    assert.ok(mean < prev, '打法越强越快');
    prev = mean;
  }
});

test('Simulation_VisitsAllPhasesAndSetPieces：中位打法走过三个阶段、至少一次飞天之殇和日蚀，同种子可复现', () => {
  const d = def();
  const r = Balance.simulate(d, Balance.MID, 1234);
  console.log(Balance.describe(r));
  assert.ok(r.killed, '中位打法打得死');
  assert.ok(r.phase2At > 0);
  assert.ok(r.phase3At > r.phase2At);
  assert.ok(r.apsaras >= 1, '二阶段至少一次飞天之殇');
  assert.ok(r.eclipses >= 1, '三阶段至少一次日蚀');
  const transitions = d.phases.reduce((s, p) => s + p.seconds, 0);
  near(r.untargetable, transitions, 0.1, '不可选中的时间 = 两段转阶段演出');
  near(r.warded, Balance.MID.pipaSeconds * r.apsaras, 0.1 * r.apsaras, '每次护体都持续到琵琶被打碎');
  assert.ok(r.eclipseOpen > d.eclipseSeconds - 0.1);
  const again = Balance.simulate(d, Balance.MID, 1234);
  near(again.seconds, r.seconds, 1e-4, '同一种子可复现');
});

test('Simulation_TougherTierTakesLonger：难度 × 1.5 时击杀用时明显变长', () => {
  const d = def();
  const at14 = Balance.average(d, Balance.MID, 8).mean;
  const harder = Balance.average(d, Balance.MID, 8, HanbaDef.StageDifficulty * 1.5).mean;
  assert.ok(harder > at14 * 1.3, `${harder.toFixed(1)} vs ${at14.toFixed(1)}`);
});

test('DotNetRandom 与 .NET System.Random 同种子同序列', () => {
  // new System.Random(0).Next() = 1559595546；new System.Random(42).Next() = 1434747710（.NET Framework / Mono 的 Knuth 减法生成器）
  assert.equal(new DotNetRandom(0).next(), 1559595546);
  assert.equal(new DotNetRandom(42).next(), 1434747710);
  const r = new DotNetRandom(1234);
  for (let i = 0; i < 1000; i++) {
    const x = r.nextDouble();
    assert.ok(x >= 0 && x < 1);
  }
});

// ───────────── CombatPipelineTests.SunburnStacksWhileExposedAndFadesInShade ─────────────

test('SunburnStacksWhileExposedAndFadesInShade：每 0.5 s 一层、最多 10 层，离开 0.3 s 后消退，几秒内清空', () => {
  const sun = new Sunburn.SunburnInstance(null);
  sun.apply(Sunburn.SUNBURN_STACK_SECONDS);
  assert.equal(sun.stacks, 1);
  for (let i = 0; i < 20; i++) sun.apply(Sunburn.SUNBURN_STACK_SECONDS);
  assert.equal(sun.stacks, Sunburn.SUNBURN_MAX_STACKS, '最多 10 层');
  near(sun.tickDamage, Sunburn.SUNBURN_MAX_STACKS * Sunburn.SUNBURN_DAMAGE_PER_STACK, 1e-4);
  sun.tick(0.2);
  assert.equal(sun.stacks, Sunburn.SUNBURN_MAX_STACKS, '刚离开日晒还不消退');
  sun.tick(0.2);
  assert.ok(sun.stacks < Sunburn.SUNBURN_MAX_STACKS, '离开 0.3 s 后开始消退');
  for (let i = 0; i < 300 && sun.active; i++) sun.tick(1 / 60);
  assert.equal(sun.active, false, '躲进影子几秒内清空');
});

test('Sunburn 跳伤：满层每 0.5 s 一跳 层数 × 每层伤害，经 hurt 回调', () => {
  const hits = [];
  const sun = new Sunburn.SunburnInstance((d) => hits.push(d));
  Sunburn.sunExposure(sun, 5, 1, 0.6 * 1.264);
  assert.equal(sun.stacks, 10);
  // 一直晒着：1 s 两跳
  for (let i = 0; i < 60; i++) {
    sun.apply(1 / 60);
    sun.tick(1 / 60);
  }
  assert.equal(hits.length, 2);
  near(hits[0], 10 * 0.6 * 1.264, 1e-6);
  // 浅水：增益 0.5，同样的暴露只叠一半
  const wet = new Sunburn.SunburnInstance(null);
  Sunburn.sunExposure(wet, 1, 0.5);
  assert.equal(wet.stacks, 1);
});

// ───────────── Ch4FoundationTests：破防条 / BossDef 缺省 / 领主梯度 ─────────────

test('BreakBar_FillsFromWeakAndReactions_GrowsEachBreak', () => {
  const bar = new BreakBar(breakBarDef({ max: 900, seconds: 4, takenMult: 1.3, label: '破鼓' }));
  let broke = 0, recovered = 0;
  bar.onBroke = (_b, n) => { broke = n; };
  bar.onRecovered = () => { recovered++; };
  assert.equal(bar.fillFrom({}, 100), 0, '打身体不填');
  assert.equal(bar.fillFrom({ weakpoint: true }, 100), 100, '弱点 × 1');
  assert.equal(bar.fillFrom({ reaction: true }, 100), 150, '反应 × 1.5');
  assert.equal(bar.threshold, 900);
  assert.equal(bar.add(899), false);
  near(bar.fill, 899 / 900, 1e-4);
  assert.equal(bar.add(1), true, '填满就破');
  assert.equal(bar.broken, true);
  assert.equal(broke, 1);
  assert.equal(bar.fill, 1, '破防中满格');
  assert.equal(bar.add(5000), false, '破防中不填');
  bar.tick(3.9);
  assert.equal(bar.broken, true);
  bar.tick(0.2);
  assert.equal(bar.broken, false);
  assert.equal(recovered, 1);
  assert.equal(bar.current, 0, '破完清空');
  near(bar.threshold, 1125, 1e-3, '下一次多要 25%');
  bar.locked = true;
  assert.equal(bar.add(5000), false, '登场 / 转阶段时不填');
  bar.locked = false;
  assert.equal(bar.add(1125), true);
  assert.equal(broke, 2);
  bar.cancel();
  assert.equal(bar.broken, false);
  assert.equal(recovered, 1, 'cancel 不发 onRecovered');
  bar.reset();
  assert.equal(bar.breaks, 0);
  assert.equal(bar.threshold, 900);
  assert.equal(bar.add(NaN), false);
});

test('BossDef_Ch4FieldsDefaultToOldBehaviour：缺省没有破防条、不按领主梯度、转阶段接管镜头', () => {
  const d = new BossDef();
  assert.equal(d.breakBar, null);
  assert.ok(!d.lordLevel);
  assert.equal(d.phaseCinematic, true);
  const t = Lord.lordTierFor({}, d.lordLevel);
  assert.equal(t.hpMult, 1);
  assert.equal(t.recoveryMult, 1);
  const h = def();
  assert.equal(h.breakBar, null, '旱魃没有破防条');
  assert.ok(!h.lordLevel);
});

test('LordScaling_ByDefeatsInThisMap：同一领主只算一次，血 ×1.15 / 1.3、收招 ×0.9 / 0.8、第三个加变体', () => {
  const flags = {};
  const t0 = Lord.lordTierFor(flags, '4-1');
  assert.equal(t0.index, 0);
  near(t0.hpMult, 1, 1e-5);
  near(t0.recoveryMult, 1, 1e-5);
  assert.equal(t0.extraVariant, false);
  Lord.recordLordDefeat(flags, '4-1', 'boss_huashe');
  Lord.recordLordDefeat(flags, '4-1', 'boss_huashe');
  const t1 = Lord.lordTierFor(flags, '4-1');
  assert.equal(t1.index, 1, '同一个领主只算一次');
  near(t1.hpMult, 1.15, 1e-5);
  near(t1.recoveryMult, 0.9, 1e-5);
  Lord.recordLordDefeat(flags, '4-1', 'boss_feilian');
  const t2 = Lord.lordTierFor(flags, '4-1');
  assert.equal(t2.index, 2);
  near(t2.hpMult, 1.3, 1e-5);
  near(t2.recoveryMult, 0.8, 1e-5);
  assert.equal(t2.extraVariant, true);
  assert.equal(Lord.lordsDefeated(flags, '4-2'), 0, '别的图不受影响');
});

test('BossDef.validate 抓坏表：阈值不降序、第一招不存在、没有形态', () => {
  const d = new BossDef();
  d.id = 'boss_x';
  d.name = 'x';
  d.phases.push({ at: 0.3, seconds: 1, formSwapAt: -1, anim: 'roar', sfx: null, shake: 0, restScale: 1, firstMove: 'nope' });
  d.phases.push({ at: 0.6, seconds: 1, formSwapAt: -1, anim: 'roar', sfx: null, shake: 0, restScale: 1 });
  const errs = d.validate();
  assert.ok(errs.some(e => e.includes('严格降序')));
  assert.ok(errs.some(e => e.includes('nope')));
  assert.ok(errs.some(e => e.includes('没有形态')));
  assert.ok(errs.some(e => e.includes('没有招式')));
});

// ───────────── 时间缩放仲裁 ─────────────

test('TimeScaleArbiter：高优先级生效、按真实时间撤销、外部写过就不再改', () => {
  let now = 0;
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => now);
  const intro = arb.request('intro', 0.45, TimePriority.BossIntro, 0.35);
  assert.equal(time.timeScale, 0.45);
  const death = arb.request('death', 0.3, TimePriority.DeathSlowMo, 0.8);
  assert.equal(time.timeScale, 0.3, '阵亡慢动作压过演出');
  now = 0.4;
  arb.tick();
  assert.equal(intro.live, false, '真实 0.35 s 后撤销');
  assert.equal(time.timeScale, 0.3);
  now = 0.9;
  arb.tick();
  assert.equal(death.live, false);
  assert.equal(time.timeScale, 1, '全部撤销后回到 1');
  arb.request('a', 0.5, TimePriority.HitStop, 1);
  time.timeScale = 0.3; // 外部（玩家阵亡）直接写
  arb.request('b', 0.2, TimePriority.SceneTransition, 1);
  assert.equal(time.timeScale, 0.3, '外部接管后不再写');
  now = 5;
  arb.tick();
  assert.equal(time.timeScale, 0.3, '撤销后也不改回外部写的值');
});
