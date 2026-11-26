// M13 对照：Unity EditMode 的 ReactionTuningTests.cs、ReactionTests.cs → node --test。
// 调参表和常量是 Unity 版删除前从 CombatTuning.cs（Unity 的单一来源）冻结的规格（tests/fixtures/spec/combat.json、cs-consts.json），
// 与 Reactions.ts 比；判定（附着 / 引爆 / 强制反应 / 冷却 / 预算）用真的 Combat + ReactionSystem 驱动
// （Unity 那份用假的 IReactionEnv + ReactionScheduler：同样的输入、同样的断言，队列里的条目直接看 ReactionSystem 的内部字段——去类型后 private 只是普通属性）。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { combatRig, near, spec, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const RX = await graph.load('combat/Reactions.ts');
const Types = await graph.load('core/types.ts');
const EPS = 1e-4;

const SPEC = spec('combat');
const K = spec('cs-consts');
/** CombatTuning 里某个嵌套 static class 的常量 */
function tune(name) {
  const c = K[`Combat/CombatTuning.cs#${name}`];
  assert.ok(c, `CombatTuning.${name}`);
  return c;
}
/** CombatTuning 顶层（嵌套类之前）的总则常量 */
const general = K['Combat/CombatTuning.cs#general'];
/** Reactions.ts 里没导出的 const（读源码字面量） */
const webSrc = readFileSync(new URL('../src/combat/Reactions.ts', import.meta.url), 'utf8');
const web = Object.fromEntries([...webSrc.matchAll(/^const (\w+) = (-?[\d.]+(?:e-?\d+)?);/gm)].map(m => [m[1], Number(m[2])]));
const IDS = ['thunderfire', 'meltdown', 'veinseal', 'abyss'];

// ───────────── 调参（ReactionTuningTests）─────────────

test('TuningTableMatchesThreeJs: REACTION_TUNING ↔ CombatTuning.Reactions', () => {
  const rows = SPEC.reactions.tune;
  assert.equal(rows.length, 4, '反应种类');
  assert.deepEqual(Types.REACTION_IDS, IDS);
  IDS.forEach((id, i) => {
    const t = RX.REACTION_TUNING[id];
    assert.deepEqual([t.k, t.floor, t.cap, t.icd], rows[i], id);
  });
  assert.deepEqual(rows, [[1, 14, 80, 1], [1, 14, 100, 1.2], [1, 14, 90, 1.2], [1.5, 40, 320, 6]]);
});

test('GeneralConstantsMatchThreeJs: 总则常量', () => {
  assert.deepEqual(
    [RX.MAX_REACTION_DEPTH, RX.FRAME_BUDGET, RX.QUEUE_CAP, RX.BIG_FX_BUDGET, RX.LABEL_BUDGET, RX.CASCADE_DELAY, RX.ABYSS_WINDUP, RX.ICD_FLOOR, RX.DETONATE_ICD],
    [general.MaxReactionDepth, general.FrameBudget, general.QueueCap, general.BigFxBudget, general.LabelBudget, general.CascadeDelay, general.AbyssWindup, general.IcdFloor, general.DetonateIcd]);
  assert.deepEqual([general.MaxReactionDepth, general.FrameBudget, general.QueueCap, general.CascadeDelay, general.AbyssWindup, general.IcdFloor], [2, 8, 32, 0.15, 0.35, 0.3]);
  assert.equal(web.DETONATE_MERGE_DELAY, general.DetonateMergeDelay);
  const feedback = readFileSync(new URL('../src/combat/Feedback.ts', import.meta.url), 'utf8');
  assert.equal(Number(feedback.match(/const LABEL_GAP = ([\d.]+);/)[1]), general.LabelGap, 'LABEL_GAP（Feedback.ts）');
  const strength = webSrc.match(/1 \+ Math\.max\(0, d - 1\) \* ([\d.]+)/);
  assert.equal(Number(strength[1]), general.StrengthPerLevel, '关卡强度 S = 1 + max(0, 难度 − 1) × 0.85');
});

test('各反应参数：焚雷 / 熔金 / 封脉 / 归墟 / 崩解 ↔ CombatTuning', () => {
  const tf = tune('Thunderfire'), mg = tune('Meltdown'), vs = tune('Veinseal'), ab = tune('Abyss'), col = tune('Collapse');
  assert.deepEqual([web.TF_RADIUS, web.TF_SPLASH, web.TF_SPREAD_BURN, web.TF_KNOCKBACK, web.TF_MAX_ARCS], [tf.Radius, tf.Splash, tf.SpreadBurn, tf.Knockback, tf.MaxArcs]);
  assert.deepEqual([web.MG_ARMOR_MULT, web.POOL_RADIUS, web.POOL_TICK, web.POOL_TICKS, web.POOL_DAMAGE, web.POOL_CORRODE, web.POOL_HEIGHT, RX.MAX_POOLS],
    [mg.ArmorMult, mg.PoolRadius, mg.PoolTick, mg.PoolTicks, mg.PoolDamage, mg.PoolCorrode, mg.PoolHeight, mg.MaxPools]);
  assert.deepEqual([web.VS_SHIELD_MULT, web.VS_STUN, RX.SEAL_STUN_ICD, web.VS_SLOW, web.VS_SLOW_DURATION, web.VS_BOSS_VULN, web.VS_BOSS_VULN_DURATION, web.VS_CONDUCT_RANGE, web.VS_CONDUCT_TARGETS, web.VS_CONDUCT_DAMAGE, web.VS_CONDUCT_CORRODE],
    [vs.ShieldMult, vs.Stun, vs.StunIcd, vs.Slow, vs.SlowDuration, vs.BossVuln, vs.BossVulnDuration, vs.ConductRange, vs.ConductTargets, vs.ConductDamage, vs.ConductCorrode]);
  assert.deepEqual([web.AB_RADIUS, web.AB_SPLASH, web.AB_SPLASH_DEAD, web.AB_KNOCKBACK, web.AB_BOLT_HEIGHT, web.AB_WARN_RADIUS], [ab.Radius, ab.Splash, ab.SplashDead, ab.Knockback, ab.BoltHeight, ab.WarnRadius]);
  assert.deepEqual([web.COLLAPSE_BURN, web.COLLAPSE_CORRODE, web.COLLAPSE_SHOCK, web.COLLAPSE_CAP], [col.Burn, col.Corrode, col.Shock, col.Cap]);
  // ReactionTests.TuningMatchesThreeJs 钉的几个数
  assert.deepEqual([col.Burn, col.Corrode, col.Shock, col.Cap, vs.BossVuln, vs.StunIcd, mg.MaxPools], [0.3, 0.3, 0.5, 30, 1.12, 3.5, 4]);
});

test('ReactionBaseMatchesThreeJs / BaseIsClampedBetweenFloorAndCapTimesStrength', () => {
  const unityBase = (id, pin, s) => {
    const t = RX.REACTION_TUNING[id], p = Number.isFinite(pin) ? Math.max(0, pin) : 0;
    return Math.min(Math.max(t.k * p, t.floor * s), t.cap * s);
  };
  for (const id of IDS) for (const s of [1, 1.41, 1.77, 2.94]) for (const pin of [0, -5, 5, 13.9, 14, 40, 79, 80, 100, 213.3, 320, 1000, 1e6]) {
    near(assert, RX.reactionBase(id, pin, s), unityBase(id, pin, s), 1e-3, `B(${id}, pin ${pin}, S ${s})`);
  }
  near(assert, RX.reactionBase('thunderfire', 5, 1), 14, EPS, '低于下限取 14S');
  near(assert, RX.reactionBase('thunderfire', 50, 1), 50, EPS, 'k = 1');
  near(assert, RX.reactionBase('thunderfire', 500, 1), 80, EPS, '焚雷上限 80S');
  near(assert, RX.reactionBase('meltdown', 500, 1), 100, EPS, '熔金上限 100S');
  near(assert, RX.reactionBase('veinseal', 500, 1), 90, EPS, '封脉上限 90S');
  near(assert, RX.reactionBase('thunderfire', 5, 2), 28, EPS, '下限随 S');
  near(assert, RX.reactionBase('abyss', 100, 1), 150, EPS, '归墟 k = 1.5');
  near(assert, RX.reactionBase('abyss', 10, 1), 40, EPS);
  near(assert, RX.reactionBase('abyss', 1000, 1), 320, EPS);
  near(assert, RX.reactionBase('meltdown', NaN, 1), 14, EPS, 'NaN 按 0');
});

test('NamesColorsAndTagsMatchDesign', () => {
  assert.deepEqual(IDS.map(id => Types.REACTION_NAMES[id]), SPEC.reactions.names);
  assert.deepEqual(IDS.map(id => Types.REACTION_NAMES[id]), ['焚雷', '熔金', '封脉', '归墟']);
  const unityColors = SPEC.reactions.colors;
  assert.deepEqual(IDS.map(id => Types.REACTION_COLORS[id]), unityColors);
  assert.deepEqual(unityColors, [0xffd84a, 0xff7a1a, 0x5affd0, 0xc89bff]);
  assert.equal(web.TF_ARC_COLOR ?? Number(webSrc.match(/TF_ARC_COLOR = (0x[0-9a-f]+)/)[1]), 0x6fd8ff);
  // TS TAGS：[REACTION_TAG, <反应 id>]
  for (const id of IDS) assert.match(webSrc, new RegExp(`${id}: \\[REACTION_TAG, '${id}'\\]`), `${id} 的伤害标签`);
});

// ───────────── 夹具 ─────────────

async function fixture() {
  const rig = await combatRig(graph, THREE);
  rig.ctx.player.stats.setBase('critChance', 0);
  rig.ctx.world.groundHeight = () => 0;
  const rx = rig.ctx.combat.reactions;
  let windups = 0;
  rig.ctx.fx = new Proxy({}, { get: (_, key) => key === 'groundWarning' ? () => { windups++; } : () => {} });
  const reactions = [];
  rig.events.on('enemy:reaction', ev => reactions.push({ ...ev, point: ev.point.clone() }));
  /** 身上预先挂好状态（depth 2：不判定反应、不弹射） */
  const enemy = (burn = false, shock = false, corrode = false, o = {}) => {
    const e = rig.enemy({ x: 200 + rig.enemies.length * 30, ...o });
    if (burn) rig.ctx.combat.applyStatus(e, 'burn', o.burnPower ?? 10, undefined, { depth: 2 });
    if (shock) rig.ctx.combat.applyStatus(e, 'shock', o.shockPower ?? 10, undefined, { depth: 2 });
    if (corrode) rig.ctx.combat.applyStatus(e, 'corrode', o.corrodePower ?? 10, undefined, { depth: 2 });
    return e;
  };
  const at = (now, frame) => { rig.ctx.time.now = now; rig.ctx.time.frame = frame; };
  const ready = (e, key, now) => rx.ready(e, key, now);
  const last = () => rx.queue.at(-1);
  return { ...rig, rx, enemy, at, ready, last, reactions, windups: () => windups };
}

// ───────────── 冷却 / 判定（ReactionMath）─────────────

test('CooldownDividesByHasteWithFloor', async () => {
  const cooldown = async (id, haste) => {
    const f = await fixture();
    f.ctx.player.stats.add('reactionHaste', haste, 't');
    const e = f.enemy();
    f.at(0, 1);
    assert.ok(f.ctx.combat.triggerReaction(e, id, 10));
    return f.rx.icd.get(e)[id];
  };
  near(assert, await cooldown('thunderfire', 0), 1, EPS);
  near(assert, await cooldown('abyss', 1), 3, EPS, '6 / (1 + 1)');
  near(assert, await cooldown('thunderfire', 4), 0.3, EPS, '1 / 5 = 0.2 → 下限 0.3');
  near(assert, await cooldown('veinseal', -1), 24, EPS, '1 + 急速 下限 0.05');
  assert.equal(general.HasteDivisorFloor, 0.05);
});

test('AttachPicksAbyssThenPairByPriority', async () => {
  /** incoming 附着到身上有 hb / hs / hc 的敌人；cooling = 先记上冷却的反应 */
  const plan = async (incoming, hb, hs, hc, killed = false, cooling = []) => {
    const f = await fixture();
    const e = f.enemy(hb, hs, hc);
    f.at(0, 1);
    for (const id of cooling) f.rx.arm(e, id, 0);
    return f.rx.tryReact(e, incoming, 20, 0, null, killed);
  };
  assert.equal(await plan('burn', false, true, false), 'thunderfire');
  assert.equal(await plan('burn', false, false, true), 'meltdown');
  assert.equal(await plan('shock', false, false, true), 'veinseal');
  assert.equal(await plan('corrode', true, true, false), 'abyss', '另外两种都在 → 归墟');
  assert.equal(await plan('corrode', true, true, false, true), 'meltdown', '击杀那一击不引发归墟，熔金 > 封脉');
  assert.equal(await plan('corrode', true, true, false, false, ['abyss']), 'meltdown', '归墟冷却中 → 两两');
  assert.equal(await plan('burn', true, true, true, false, ['abyss']), 'thunderfire', 'incoming 自己的状态不算已有');
  assert.equal(await plan('burn', true, true, true), 'abyss');
  assert.equal(await plan('burn', true, false, false), null, '同一状态不反应');
  assert.equal(await plan('stun', true, true, true), null, '非元素状态不反应');
  assert.equal(await plan('shock', true, false, false, false, ['thunderfire']), null, '冷却中');
});

test('DetonatePlanByStatusCount / pairOf', async () => {
  const plan = async (hb, hs, hc, cooling = []) => {
    const f = await fixture();
    const e = f.enemy(hb, hs, hc);
    f.at(0, 1);
    for (const id of cooling) f.rx.arm(e, id, 0);
    return f.ctx.combat.detonate(e, { power: 50 });
  };
  assert.equal(await plan(true, true, true), 'abyss', '三相 → 归墟');
  assert.equal(await plan(true, true, true, ['abyss']), 'thunderfire', '归墟冷却 → 按优先级');
  assert.equal(await plan(true, true, true, ['abyss', 'thunderfire']), 'meltdown');
  assert.equal(await plan(false, true, true), 'veinseal', '两相');
  assert.equal(await plan(true, false, true), 'meltdown');
  assert.equal(await plan(false, true, true, ['veinseal']), 'collapse', '组合都在冷却 → 崩解');
  assert.equal(await plan(true, false, false), 'collapse', '单相 → 崩解');
  assert.equal(await plan(false, false, false), null);
  assert.deepEqual(RX.PAIR_PRIORITY, ['thunderfire', 'meltdown', 'veinseal']);
  assert.equal(RX.pairOf('corrode', 'shock'), 'veinseal');
  assert.equal(RX.pairOf('burn', 'stun'), null);
  assert.equal(RX.pairOf('burn', 'burn'), null);
});

// ───────────── 引爆 ─────────────

test('DetonateThreeStatusesIsAbyssAndConsumesBurnAndShock', async () => {
  const f = await fixture();
  const e = f.enemy(true, true, true);
  f.at(10, 1);
  assert.equal(f.ctx.combat.detonate(e, { power: 100 }), 'abyss');
  const j = f.last();
  assert.deepEqual([j.kind, j.id, j.origin], ['reaction', 'abyss', 'detonate']);
  near(assert, j.pin, 100, EPS);
  near(assert, j.cash, 10 * 0.16 * 8, EPS, '灼烧结清值 = 强度 × 0.16 × 剩余 8 跳');
  assert.ok(!e.statuses.has('burn') && !e.statuses.has('shock'), '灼烧、雷殛被消耗');
  assert.ok(e.statuses.has('corrode'), '蚀化保留');
  near(assert, j.at, 10 + general.DetonateMergeDelay + general.AbyssWindup, EPS, '推迟一帧 + 0.35 s 收束');
  assert.equal(f.windups(), 1);
  assert.ok(!f.ready(e, 'abyss', 10), '记了归墟冷却');
  assert.ok(!f.ready(e, 'detonate', 10.49), '引爆冷却 0.5 s');
  assert.ok(f.ready(e, 'detonate', 10.5));
});

test('DetonateTwoStatusesPicksPairAndArmsIt', async () => {
  const f = await fixture();
  const e = f.enemy(true, false, true);
  f.at(0, 1);
  assert.equal(f.ctx.combat.detonate(e, { power: 60, mult: 1.5 }), 'meltdown');
  const j = f.last();
  near(assert, j.pin, 90, EPS, '强度 × 倍率');
  near(assert, j.mult, 1.5, EPS);
  assert.ok(!f.ready(e, 'meltdown', 1.19));
  assert.ok(f.ready(e, 'meltdown', 1.2));
  assert.ok(e.statuses.has('burn') && e.statuses.has('corrode'), '两两反应不消耗状态');
  const big = f.enemy(false, true, true, { maxHp: 100 });
  assert.equal(f.ctx.combat.detonate(big, { power: 1000 }), 'veinseal');
  near(assert, f.last().pin, 50, EPS, '强度钳到最大生命 × 0.5');
});

test('DetonateOneStatusCollapsesWithoutConsuming', async () => {
  const f = await fixture();
  f.ctx.player.stats.add('elementDamagePct', 0.5, 't'); // 每跳属性倍率 1.5
  f.at(0, 1);
  const burn = f.enemy(true, false, false, { burnPower: 40 / (0.16 * 8) }); // 剩余跳伤 40
  assert.equal(f.ctx.combat.detonate(burn, { power: 500, mult: 2 }), 'collapse');
  let j = f.last();
  assert.deepEqual([j.kind, j.collapse], ['collapse', 'burn']);
  near(assert, j.fixedBase, 0.3 * 40 * 1.5 * 2, EPS, '0.3 × 剩余（含属性倍率）× 引爆倍率');
  assert.ok(burn.statuses.has('burn'), '崩解不消耗状态');

  const shock = f.enemy(false, true, false, { shockPower: 20 });
  assert.equal(f.ctx.combat.detonate(shock, { power: 500 }), 'collapse');
  j = f.last();
  assert.equal(j.collapse, 'shock');
  near(assert, j.pin, 30, EPS, '雷殛强度按反应口径乘回属性倍率（重新弹射用）');
  near(assert, j.fixedBase, 15, EPS, '0.5 × 雷殛强度');

  f.ctx.run.difficulty = 1 + 1 / 0.85; // S = 2
  const cor = f.enemy(false, false, true, { corrodePower: 1000 / (0.08 * 10) });
  assert.equal(f.ctx.combat.detonate(cor, { power: 500 }), 'collapse');
  j = f.last();
  assert.equal(j.collapse, 'corrode');
  near(assert, j.fixedBase, 60, EPS, '上限 30 × S');
});

test('DetonatePairOnCooldownFallsBackToCollapse', async () => {
  const f = await fixture();
  const e = f.enemy(true, true, false);
  f.at(0, 1);
  assert.equal(f.ctx.combat.detonate(e, { power: 50 }), 'thunderfire');
  f.at(0.6, 100); // 引爆冷却过了、焚雷还在冷却（1 s）→ 崩解（灼烧优先）
  assert.equal(f.ctx.combat.detonate(e, { power: 50 }), 'collapse');
  assert.equal(f.last().collapse, 'burn');
});

test('DetonateWithinIcdMergesSameHitOtherwiseRejects', async () => {
  const f = await fixture();
  const e = f.enemy(true, true, false);
  f.at(1, 10);
  assert.equal(f.ctx.combat.detonate(e, { power: 50 }), 'thunderfire');
  const first = f.last();
  assert.equal(f.ctx.combat.detonate(e, { power: 80, mult: 1.25 }), 'thunderfire', '同帧并入同一条');
  near(assert, first.pin, 100, EPS, '取较高强度（80 × 1.25）');
  near(assert, first.mult, 1.25, EPS);
  f.at(1.01, 11);
  assert.equal(f.ctx.combat.detonate(e, { power: 30 }), 'thunderfire', '下一帧（破势）也并入');
  near(assert, first.pin, 100, EPS, '较弱的不降低强度');
  assert.equal(f.rx.queue.length, 1);
  f.at(1.2, 13);
  assert.equal(f.ctx.combat.detonate(e, { power: 50 }), null, '冷却内、没有可并入的 → 拒绝');
  f.rx.flush();
  assert.equal(f.rx.queue.length, 0);
  f.at(1.3, 20);
  assert.equal(f.ctx.combat.detonate(e, { power: 50 }), null, '执行掉之后冷却内也不能并入');
});

test('DetonateMergeOfCollapseRecomputesWithHigherMult', async () => {
  const f = await fixture();
  const e = f.enemy(true, false, false, { burnPower: 20 / (0.16 * 8) });
  f.at(0, 5);
  f.ctx.combat.detonate(e, { power: 10 });
  const j = f.last();
  near(assert, j.fixedBase, 6, EPS);
  f.ctx.combat.detonate(e, { power: 10, mult: 3 });
  near(assert, j.fixedBase, 18, EPS, '按更高倍率重算');
});

test('DetonateRejects', async () => {
  const f = await fixture();
  f.at(0, 1);
  assert.equal(f.ctx.combat.detonate(f.enemy(false, false, false), { power: 50 }), null, '身上没有元素状态');
  assert.equal(f.ctx.combat.detonate(f.enemy(true, true, true), { power: 50, depth: 2 }), null, '深度 ≥ 2');
  const dead = f.enemy(true, true, true);
  dead.alive = false;
  assert.equal(f.ctx.combat.detonate(dead, { power: 50 }), null, '已死');
  const hidden = f.enemy(true, true, true);
  hidden.untargetable = true;
  assert.equal(f.ctx.combat.detonate(hidden, { power: 50 }), null, '不可选中');
  assert.equal(f.rx.queue.length, 0);
  f.ctx.combat.detonate(f.enemy(true, false, false), { power: 50, depth: 1 });
  near(assert, f.last().at, general.CascadeDelay, EPS, '连锁引爆延后 0.15 s');
});

// ───────────── 强制反应 ─────────────

test('TriggerOptionsIcdFixedBaseScaleTag', async () => {
  const f = await fixture();
  const e = f.enemy();
  f.at(0, 1);
  assert.ok(f.ctx.combat.triggerReaction(e, 'thunderfire', 30, { tag: 'kalpa', weaponUid: 4 }), '不需要元素状态');
  const t = f.last();
  assert.deepEqual([t.origin, t.tag, t.weaponUid, t.fixedBase], ['forced', 'kalpa', 4, null]);
  near(assert, t.pin, 30, EPS);
  near(assert, t.scale, 1, EPS, 'scale 未设视为 1');
  f.at(0.5, 2);
  assert.ok(!f.ctx.combat.triggerReaction(e, 'thunderfire', 30), '冷却中');
  assert.ok(f.ctx.combat.triggerReaction(e, 'thunderfire', 30, { ignoreIcd: true, fixedBase: 123, scale: 0.5 }), 'ignoreIcd 无视冷却');
  near(assert, f.last().fixedBase, 123, EPS);
  near(assert, f.last().scale, 0.5, EPS);
  assert.ok(!f.ctx.combat.triggerReaction(e, 'meltdown', 30, { depth: 2 }), '深度 ≥ 2');
});

test('TriggerOnDeadOrDestroyedEnemy', async () => {
  const f = await fixture();
  const dead = f.enemy();
  dead.alive = false;
  f.at(0, 1);
  assert.ok(f.ctx.combat.triggerReaction(dead, 'meltdown', 20), '敌人已死也可以强制反应（范围部分照常）');
  assert.ok(f.last().killed);
  assert.ok(f.ready(dead, 'meltdown', 0), '死了不记冷却');
  const p = new THREE.Vector3(1, 2, 3);
  assert.ok(f.ctx.combat.triggerReaction(dead, 'abyss', 20, { point: p }));
  assert.deepEqual(f.last().point.toArray(), [1, 2, 3]);
  near(assert, f.last().at, general.AbyssWindup, EPS, '归墟同样 0.35 s 收束');
  assert.equal(f.windups(), 1);
});

// ───────────── 元素附着 ─────────────

test('AttachCarriesReactionScaleOriginAndCascadeDelay', async () => {
  const f = await fixture();
  const e = f.enemy(false, false, true, { maxHp: 100 });
  f.at(5, 1);
  // 经 Combat.applyStatus：强度钳到最大生命 × 0.5，reactionScale / weaponUid 透传
  f.ctx.combat.applyStatus(e, 'shock', 80, undefined, { depth: 0, weaponUid: 7, reactionScale: 0.6 });
  const j = f.last();
  assert.deepEqual([j.id, j.origin, j.weaponUid], ['veinseal', 'status', 7]);
  near(assert, j.scale, 0.6, EPS, 'reactionScale');
  near(assert, j.pin, 50, EPS, '钳到最大生命 × 0.5');
  near(assert, j.at, 5, EPS, '直接命中立即执行');
  const g = f.enemy(true, false, false);
  assert.equal(f.rx.tryReact(g, 'corrode', 10, 1, null, false), 'meltdown');
  near(assert, f.last().at, 5 + general.CascadeDelay, EPS, '连锁延后 0.15 s');
  assert.equal(f.rx.tryReact(f.enemy(true, false, false), 'corrode', 10, 2, null, false), null, '深度 ≥ 2 不反应');
});

test('AttachAbyssConsumesOnlyTheOtherTwo', async () => {
  const f = await fixture();
  const a = f.enemy(true, true, false, { burnPower: 7 / (0.16 * 8) });
  f.at(0, 1);
  assert.equal(f.rx.tryReact(a, 'corrode', 50, 0, null, false), 'abyss');
  near(assert, f.last().cash, 7, EPS);
  assert.ok(!a.statuses.has('burn') && !a.statuses.has('shock'));
  near(assert, f.last().at, general.AbyssWindup, EPS);
  const b = f.enemy(true, true, true);
  assert.equal(f.rx.tryReact(b, 'burn', 50, 0, null, false), 'abyss');
  assert.ok(b.statuses.has('burn'), 'incoming 是火时，身上已有的灼烧不算「另外两种」，不消耗');
  assert.ok(!b.statuses.has('shock'));
});

test('IcdIsPerEnemyPerReactionAndUsesHaste', async () => {
  const f = await fixture();
  f.ctx.player.stats.add('reactionHaste', 1, 't');
  const e = f.enemy(false, true, false);
  f.at(0, 1);
  assert.equal(f.rx.tryReact(e, 'burn', 20, 0, null, false), 'thunderfire');
  f.at(0.49, 2);
  assert.equal(f.rx.tryReact(e, 'burn', 20, 0, null, false), null, '急速 100%：冷却 0.5 s');
  f.at(0.5, 3);
  assert.equal(f.rx.tryReact(e, 'burn', 20, 0, null, false), 'thunderfire');
  assert.equal(f.rx.tryReact(f.enemy(false, true, false), 'burn', 20, 0, null, false), 'thunderfire', '别的敌人不受影响');
  assert.ok(f.ready(e, 'meltdown', 0.5), '别的反应不受影响');
});

// ───────────── 预算 ─────────────

test('EightReactionsPerFrameAndQueueCap', async () => {
  const f = await fixture();
  const targets = Array.from({ length: 40 }, () => f.enemy(true, false, false));
  let n = 0;
  f.at(0, 1);
  for (let i = 0; i < 8; i++) assert.equal(f.rx.tryReact(targets[n++], 'shock', 20, 0, null, false), 'thunderfire', `第 ${i + 1} 个`);
  assert.equal(f.rx.tryReact(targets[n++], 'shock', 20, 0, null, false), null, '本帧第 9 个被拒');
  assert.ok(!f.ctx.combat.triggerReaction(f.enemy(), 'abyss', 10), '强制反应同样占预算');
  // 队列上限 32：后面几帧继续塞（都延后执行，留在队列里）
  for (let frame = 2; frame <= 4; frame++) {
    f.at(0, frame);
    for (let i = 0; i < 8; i++) assert.equal(f.rx.tryReact(targets[n++], 'shock', 20, 1, null, false), 'thunderfire');
  }
  assert.equal(f.rx.queue.length, 32);
  f.at(0, 5);
  assert.equal(f.rx.tryReact(targets[n++], 'shock', 20, 1, null, false), null, '队列满');
});

test('TakeDueReturnsOnlyDueJobsInOrder: 到期的才执行、按入队顺序', async () => {
  const f = await fixture();
  const a = f.enemy(true, false, false), b = f.enemy(true, false, false), c = f.enemy();
  f.at(0, 1);
  f.rx.tryReact(a, 'shock', 20, 1, null, false); // 0.15
  f.rx.tryReact(b, 'shock', 20, 0, null, false); // 0
  f.ctx.combat.triggerReaction(c, 'abyss', 10);  // 0.35
  f.at(0.2, 2);
  f.rx.flush();
  assert.deepEqual(f.reactions.map(r => r.enemy), [a, b]);
  assert.equal(f.rx.queue.length, 1);
  assert.equal(f.rx.queue[0].enemy, c);
});

test('LabelsFourPerFrameAndPerEnemyGap', async () => {
  const f = await fixture();
  const shown = [];
  f.ctx.ui.damageNumber = (pos, n, opts) => shown.push(opts);
  const fb = f.ctx.combat.feedback;
  const e = Array.from({ length: 5 }, () => f.enemy());
  const p = new THREE.Vector3();
  const allow = (enemy, big) => { const before = shown.length; fb.reactionLabel(enemy, p, 'x', 0, big); return shown.length > before; };
  f.at(0, 1);
  for (let i = 0; i < 4; i++) assert.ok(allow(e[i], false), `第 ${i + 1} 条`);
  assert.ok(!allow(e[4], false), '每帧最多 4 条');
  assert.ok(!allow(e[4], true), '大号也受每帧预算限制');
  f.at(0.1, 2);
  assert.ok(!allow(e[0], false), '同一敌人 0.3 s 一条');
  assert.ok(allow(e[0], true), '大号（归墟）不受逐敌节流');
  f.at(0.31, 3);
  assert.ok(allow(e[1], false));
});

// ───────────── 封脉首领 / 眩晕冷却 ─────────────

test('BossVulnAndSealStunCooldown', async () => {
  const f = await fixture();
  const boss = f.enemy(false, false, false, { isBoss: true });
  f.at(1, 1);
  f.ctx.combat.triggerReaction(boss, 'veinseal', 20);
  f.rx.flush();
  near(assert, f.rx.vulnMult(boss), 1.12, EPS, '首领「脉滞」');
  f.at(4.9, 2);
  near(assert, f.rx.vulnMult(boss), 1.12, EPS);
  f.at(5, 3);
  near(assert, f.rx.vulnMult(boss), 1, EPS, '4 s 到期恢复');
  near(assert, f.rx.vulnMult(f.enemy()), 1, EPS);
  assert.ok(!boss.statuses.has('stun'), '首领不眩晕');

  const e = f.enemy();
  const seal = now => {
    f.at(now, Math.round(now * 100) + 10);
    e.stunTime = 0; e.statuses.delete('stun');
    f.ctx.combat.triggerReaction(e, 'veinseal', 20, { ignoreIcd: true });
    f.rx.flush();
    return f.reactions.at(-1).stunned;
  };
  assert.ok(seal(10));
  near(assert, e.statuses.get('stun').remaining, 0.7, EPS, '封脉眩晕 0.7 s');
  assert.ok(!seal(13.4), '封脉眩晕 3.5 s 一次');
  assert.ok(seal(13.5));
});

test('LevelScaleIsOnePlusPoint85PerLevel: 反应威力下限随关卡难度', async () => {
  for (const [level, s] of [[1, 1], [0.5, 1], [1.48, 1.408], [2.2, 2.02], [3.4, 3.04]]) {
    const f = await fixture();
    f.ctx.run.difficulty = level;
    const e = f.enemy(false, false, false, { maxHp: 1e6 });
    f.at(0, 1);
    f.ctx.combat.triggerReaction(e, 'thunderfire', 0); // pin 0 → B = 下限 14 × S
    f.rx.flush();
    near(assert, f.reactions[0].base, 14 * s, 1e-3, `S = 1 + max(0, 难度 − 1) × 0.85，难度 ${level}`);
  }
});

// M8 照 Unity 改齐（原来的 todo：网页点燃半径内全部）
test('焚雷扩散灼烧：身体中心在半径内、按距离取最近 SpreadTargets = 16 个（Unity ReactionSystem.Nearest）', async () => {
  const tf = tune('Thunderfire');
  assert.equal(RX.TF_SPREAD_TARGETS, tf.SpreadTargets, 'TF_SPREAD_TARGETS ↔ CombatTuning.Thunderfire.SpreadTargets');
  assert.equal(tf.SpreadTargets, 16);
  const f = await fixture();
  const center = f.enemy(false, false, false, { x: 0, z: 0, maxHp: 1e6 });
  // 20 只由近到远围一圈（身体中心离焚雷中心 0.5…2.4 m，都在 3 m 内）
  const ring = [];
  for (let i = 0; i < 20; i++) {
    const d = 0.5 + i * 0.1, a = i * 2.4;
    ring.push(f.enemy(false, false, false, { x: Math.cos(a) * d, z: Math.sin(a) * d, maxHp: 1e6 }));
  }
  f.at(0, 1);
  assert.ok(f.ctx.combat.triggerReaction(center, 'thunderfire', 100));
  f.rx.flush();
  const burning = ring.filter(e => e.statuses.has('burn'));
  assert.equal(burning.length, tf.SpreadTargets, '只点最近的 16 只');
  assert.deepEqual(burning, ring.slice(0, tf.SpreadTargets), '按距离由近到远');
});
