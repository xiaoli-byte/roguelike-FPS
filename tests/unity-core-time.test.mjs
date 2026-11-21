// M11d 核心 · 时间与状态（docs/threejs-migration.md 4.7）：照 Unity G/Core 的 TimeScaleArbiter / GameState / HitStop / ClearSlowMo / FeelProfile
// 与 EditMode 的 FeelProfileTests、GraphicsAudioTests（帧率上限）逐条改写，断言 C# 的数。
import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './hanba-load.mjs';

const { TimeScaleArbiter, TimePriority, arbiterFor } = await importTs('../src/core/TimeScaleArbiter.ts');
const Framework = await importTs('../src/enemies/bosses/framework/TimeScaleArbiter.ts');
const { GameStateMachine } = await importTs('../src/core/GameStateMachine.ts');
const { HitStop, HIT_STOP, hitStopByPlayer } = await importTs('../src/core/HitStop.ts');
const { ClearSlowMo, EncounterClearWatcher } = await importTs('../src/core/ClearSlowMo.ts');
const { FEEL, defaultFeel, shakeAmplitude, SHAKE_MAX_STRENGTH } = await importTs('../src/core/FeelProfile.ts');
const { FrameLimiter, targetFrameRate, FRAME_CAPS } = await importTs('../src/core/GameSettings.ts');

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} 期望 ${b}，实际 ${a}`);

// ───────────── TimeScaleArbiter ─────────────

test('优先级照 Unity：顿帧 100 < 阵亡 200 < 过渡 300 < 模态 400 < 暂停 500；清场慢动作 = 顿帧 − 10', () => {
  assert.equal(TimePriority.HitStop, 100);
  assert.equal(TimePriority.DeathSlowMo, 200);
  assert.equal(TimePriority.SceneTransition, 300);
  assert.equal(TimePriority.Modal, 400);
  assert.equal(TimePriority.Pause, 500);
  assert.equal(TimePriority.ClearSlowMo, TimePriority.HitStop - 10);
  assert.equal(ClearSlowMo.Priority, 90);
  // 首领框架原来那两档原样
  assert.equal(TimePriority.BossCinematic, 150);
  assert.equal(TimePriority.BossIntro, 160);
});

test('仲裁器提到 core 后首领框架引用的是同一份（类、优先级表、每个 ctx.time 一个实例）', () => {
  assert.equal(Framework.TimeScaleArbiter, TimeScaleArbiter);
  assert.equal(Framework.TimePriority, TimePriority);
  const time = { timeScale: 1 };
  assert.equal(Framework.arbiterFor(time), arbiterFor(time));
});

test('同时多个申请：优先级最高的生效，同优先级取最后一个；没有申请 = 1；申请和撤销立刻生效', () => {
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => 0);
  assert.equal(arb.current, 1);
  assert.equal(arb.activePriority, -1);
  const stop = arb.request('hit', 0.05, TimePriority.HitStop);
  assert.equal(time.timeScale, 0.05);
  const death = arb.request('death', 0.3, TimePriority.DeathSlowMo);
  assert.equal(time.timeScale, 0.3);
  const pause = arb.request('pause', 0, TimePriority.Pause);
  assert.equal(time.timeScale, 0);
  assert.equal(arb.activePriority, TimePriority.Pause);
  assert.equal(arb.count, 3);
  const modalA = arb.request('a', 0, TimePriority.Modal), modalB = arb.request('b', 0.5, TimePriority.Modal);
  pause.dispose();
  assert.equal(time.timeScale, 0.5, '同优先级取最后一个');
  modalB.dispose();
  assert.equal(time.timeScale, 0);
  modalA.dispose();
  assert.equal(time.timeScale, 0.3);
  death.dispose();
  death.dispose();
  assert.equal(time.timeScale, 0.05);
  stop.dispose();
  assert.equal(time.timeScale, 1);
  assert.equal(arb.count, 0);
  assert.equal(arb.tampered, false);
});

test('句柄的 scale 可改（立即重新结算）；NaN / 负数当 0，上限 100；releaseOwner / clear', () => {
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => 0);
  const h = arb.request('x', 0.5, TimePriority.HitStop);
  h.scale = 0.2;
  assert.equal(time.timeScale, 0.2);
  h.scale = Number.NaN;
  assert.equal(time.timeScale, 0);
  h.scale = -3;
  assert.equal(h.scale, 0);
  h.scale = 1e9;
  assert.equal(time.timeScale, 100);
  arb.request('x', 0.7, TimePriority.Modal);
  arb.request('y', 0.4, TimePriority.HitStop);
  arb.releaseOwner('x');
  assert.equal(time.timeScale, 0.4, '撤掉 x 的全部申请');
  arb.clear();
  assert.equal(time.timeScale, 1);
  assert.equal(arb.count, 0);
  assert.equal(h.live, false);
});

// ───────────── GameStateMachine ─────────────

test('状态机：底层状态 + 模态栈；暂停用暂停优先级停时间，其余模态用模态优先级；弹出撤销', () => {
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => 0);
  const seen = [];
  const fsm = new GameStateMachine(arb, (from, to) => seen.push(`${from}>${to}`));
  assert.equal(fsm.current, 'boot');
  fsm.setBase('playing');
  assert.equal(fsm.isPlaying, true);
  const pause = {}, modal = {};
  fsm.push(pause, 'paused');
  assert.equal(fsm.current, 'paused');
  assert.equal(time.timeScale, 0);
  assert.equal(arb.activePriority, TimePriority.Pause);
  assert.equal(fsm.isPlaying, false);
  assert.equal(fsm.blocked, true);
  // 秘卷三选一叠在暂停菜单上，选完之后时间仍然停着
  fsm.push(modal, 'modal');
  assert.equal(fsm.current, 'modal');
  assert.equal(fsm.depth, 2);
  assert.equal(fsm.pop(modal), true);
  assert.equal(fsm.current, 'paused');
  assert.equal(time.timeScale, 0);
  // 不在栈顶也能弹
  fsm.push(modal, 'modal');
  assert.equal(fsm.pop(pause), true);
  assert.equal(fsm.current, 'modal');
  assert.equal(arb.activePriority, TimePriority.Modal);
  assert.equal(fsm.pop(pause), false, '没有的弹不出来');
  fsm.pop(modal);
  assert.equal(fsm.current, 'playing');
  assert.equal(time.timeScale, 1);
  assert.deepEqual(seen, ['boot>playing', 'playing>paused', 'paused>modal', 'modal>paused', 'paused>modal', 'modal>playing']);
});

test('状态机：同一个 owner 再压一次只留一项；freezeTime = false 不停时间；clear 回 boot，clearModals 一次只通知一回', () => {
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => 0);
  const seen = [];
  const fsm = new GameStateMachine(arb, (from, to) => seen.push(`${from}>${to}`));
  fsm.setBase('playing');
  const a = {};
  fsm.push(a, 'modal');
  fsm.push(a, 'summary');
  assert.equal(fsm.depth, 1);
  assert.equal(fsm.current, 'summary');
  assert.equal(arb.count, 1);
  fsm.pop(a);
  fsm.push(a, 'modal', false);
  assert.equal(time.timeScale, 1, '不停时间的模态');
  assert.equal(fsm.contains(a), true);
  fsm.push({}, 'paused');
  seen.length = 0;
  fsm.clearModals('menu');
  assert.deepEqual(seen, ['paused>menu']);
  assert.equal(fsm.depth, 0);
  assert.equal(time.timeScale, 1);
  assert.equal(arb.count, 0);
  fsm.push({}, 'paused');
  fsm.clear();
  assert.equal(fsm.current, 'boot');
  assert.equal(fsm.base, 'boot');
  assert.equal(time.timeScale, 1);
});

// ───────────── FeelProfile（FeelProfileTests）─────────────

test('DefaultsMatchTheTunedConstants：手感表默认值 = 顿帧 / 屏效的常数', () => {
  const f = defaultFeel();
  assert.equal(f.killStop, HIT_STOP.KillStop);
  assert.equal(f.eliteKillStop, HIT_STOP.EliteKillStop);
  assert.equal(f.bossKillStop, HIT_STOP.BossKillStop);
  assert.equal(f.critStop, HIT_STOP.CritStop);
  assert.equal(f.reactionStop, HIT_STOP.ReactionStop);
  assert.equal(f.hitStopScale, HIT_STOP.DefaultScale);
  assert.deepEqual([f.killStop, f.eliteKillStop, f.bossKillStop, f.critStop, f.reactionStop, f.hitStopScale], [0.035, 0.07, 0.18, 0.025, 0.045, 0.05]);
  assert.deepEqual([HIT_STOP.MaxStop, HIT_STOP.MinGap, HIT_STOP.BudgetMax, HIT_STOP.BudgetRate, HIT_STOP.MinUseful, HIT_STOP.HeavyCritFraction],
    [0.2, 0.12, 0.15, 0.075, 0.012, 0.18]);
  assert.equal(f.hurtAberration, 0.4);
  assert.ok(f.clearSlowMoScale >= 0.2 && f.clearSlowMoScale <= 0.6, '清场慢动作看得出、但不拖');
  assert.ok(f.clearSlowMoSeconds >= 0.2 && f.clearSlowMoSeconds <= 0.6, '慢动作不超过 0.6 s 真实时间');
  assert.deepEqual([f.clearSlowMoScale, f.clearSlowMoSeconds, f.clearSlowMoMinKills], [0.3, 0.4, 4]);
  assert.deepEqual([f.dashAberration, f.slowAberration, f.shakeExponent, f.shakeAmpMax], [0.25, 0.15, 2, 1.8]);
  assert.deepEqual([f.assistRange, f.assistConeDeg, f.assistSlowdown, f.assistPull], [45, 4, 0.5, 0.12]);
  assert.deepEqual(FEEL, f);
});

test('ShakeCurveAtExponentTwoIsTraumaSquared：震屏幅度 = min(上限, trauma² × 1.2)', () => {
  const f = defaultFeel();
  assert.equal(SHAKE_MAX_STRENGTH, 1.2);
  for (const t of [0, 0.25, 0.5, 0.8, 1]) near(shakeAmplitude(t, f), Math.min(f.shakeAmpMax, t * t * 1.2), 1e-5, `trauma ${t}`);
  near(shakeAmplitude(5, f), 1.2, 1e-9, 'trauma 夹在 0..1');
});

// ───────────── HitStop ─────────────

function rig() {
  const s = { now: 100, playing: true, dead: false };
  const time = { timeScale: 1 };
  const arb = new TimeScaleArbiter(time, () => s.now);
  const host = { clock: () => s.now, isPlaying: () => s.playing, playerDead: () => s.dead };
  return { s, time, arb, host, stop: new HitStop(arb, host, defaultFeel()) };
}

test('顿帧：击杀按档 0.035 / 0.07 / 0.18 s、×0.05；到点撤销；只认玩家造成的直接伤害', () => {
  const { s, time, stop } = rig();
  assert.equal(stop.onKilled('normal', 'status'), false, '持续伤害不顿');
  assert.equal(hitStopByPlayer('weapon') && hitStopByPlayer('skill') && hitStopByPlayer('melee') && hitStopByPlayer('explosion') && hitStopByPlayer('scroll'), true);
  assert.equal(hitStopByPlayer('status'), false);
  assert.equal(stop.onKilled('normal', 'weapon'), true);
  assert.equal(time.timeScale, 0.05);
  near(stop.budget, 0.15 - 0.035, 1e-9);
  s.now += 0.034;
  stop.update();
  assert.equal(stop.active, true);
  s.now += 0.002;
  stop.update();
  assert.equal(stop.active, false);
  assert.equal(time.timeScale, 1);
});

test('顿帧：进行中不叠加，只延到较晚的结束（单次最长 0.2 s）、缩放取较低的', () => {
  const { s, time, stop } = rig();
  assert.equal(stop.request(0.05, 0.1), true);
  assert.equal(time.timeScale, 0.1);
  s.now += 0.01;
  assert.equal(stop.request(0.03, 0.05), false, '结束得更早的不延长');
  assert.equal(time.timeScale, 0.05, '但缩放取较低的');
  assert.equal(stop.request(0.08, 0.5), true, '延到 now + 0.08');
  assert.equal(time.timeScale, 0.05);
  s.now += 0.079;
  stop.update();
  assert.equal(stop.active, true);
  s.now += 0.002;
  stop.update();
  assert.equal(stop.active, false);
});

test('顿帧：两次开始至少隔 0.12 s，明显更重的（长度 ≥ 上一次两倍）可以插队', () => {
  const { s, stop } = rig();
  assert.equal(stop.request(0.035), true);
  s.now += 0.04;
  stop.update();
  assert.equal(stop.request(0.035), false, '0.04 s 后同样轻的不顿');
  assert.equal(stop.request(0.07), true, '精英击杀（两倍）插队');
  s.now += 0.08;
  stop.update();
  s.now += 0.05;
  assert.equal(stop.request(0.035), true, '隔够 0.12 s');
});

test('顿帧：预算桶最多 0.15 s、每秒回 0.075 s；不够 12 ms 不顿', () => {
  const { s, stop } = rig();
  assert.equal(stop.request(0.18), true, '首领击杀');
  near(stop.budget, 0, 1e-9, '0.18 被预算截到 0.15');
  s.now += 0.151;
  stop.update();
  assert.equal(stop.active, false);
  assert.equal(stop.request(0.035), false, '预算只回了 11.3 ms，不够 12 ms');
  near(stop.budget, 0.151 * 0.075, 1e-9);
  s.now += 0.1;
  assert.equal(stop.request(0.035), true);
  near(stop.budget, 0, 1e-9, '给了 18.8 ms（≥ 12 ms），预算用光');
  s.now += 10;
  stop.update();
  stop.request(0.001);
  near(stop.budget, 0.15, 1e-9, '最多攒 0.15 s');
});

test('顿帧：只在正常游玩、时间没被别人压着、玩家活着时开始；关掉总开关立刻结束', () => {
  const { s, arb, stop } = rig();
  s.playing = false;
  assert.equal(stop.request(0.05), false);
  s.playing = true;
  s.dead = true;
  assert.equal(stop.request(0.05), false);
  s.dead = false;
  const slow = arb.request('boss', 0.3, TimePriority.DeathSlowMo);
  assert.equal(stop.request(0.05), false, '慢动作里不顿');
  slow.dispose();
  assert.equal(stop.request(0.05), true);
  stop.enabled = false;
  assert.equal(stop.active, false);
  assert.equal(stop.request(0.05), false);
});

test('顿帧：重暴击（打掉总量 18% 以上的武器 / 近战暴击）0.025 s；击杀那一下不重复；直接反应 0.045 s', () => {
  const { s, stop } = rig();
  assert.equal(stop.onDamaged(true, false, 'weapon', 17, 100), false, '17% 不算重');
  assert.equal(stop.onDamaged(false, false, 'weapon', 50, 100), false, '不是暴击');
  assert.equal(stop.onDamaged(true, true, 'weapon', 50, 100), false, '击杀由击杀顿帧管');
  assert.equal(stop.onDamaged(true, false, 'skill', 50, 100), false, '技能暴击不算');
  assert.equal(stop.onDamaged(true, false, 'melee', 18, 100), true);
  near(stop.budget, 0.15 - 0.025, 1e-9);
  s.now += 1;
  stop.update();
  assert.equal(stop.onReacted(1, 3), false, '连锁出来的反应不顿');
  assert.equal(stop.onReacted(0, 0), false, '没打到人');
  assert.equal(stop.onReacted(0, 2), true);
});

// ───────────── ClearSlowMo ─────────────

test('清场慢动作：场地打过 ≥ 4 只才放，×0.3 约 0.4 s（真实时间）；最后一击的顿帧先咬一下', () => {
  const { s, time, arb, host, stop } = rig();
  const slow = new ClearSlowMo(arb, host, defaultFeel());
  assert.equal(slow.onCleared(3), false, '两三只的小场地不放');
  assert.equal(stop.onKilled('normal', 'weapon'), true);
  assert.equal(slow.onCleared(4), true);
  assert.equal(time.timeScale, 0.05, '顿帧压着');
  s.now += 0.04;
  stop.update();
  slow.update();
  assert.equal(time.timeScale, 0.3, '顿帧结束后接着慢放');
  s.now += 0.37;
  slow.update();
  assert.equal(time.timeScale, 1);
  assert.equal(slow.count, 1);
  s.dead = true;
  assert.equal(slow.onCleared(9), false, '玩家已阵亡不放');
});

test('场地清掉的侦测：active → cleared 的那一帧回报开打期间的击杀数；换关清空', () => {
  const w = new EncounterClearWatcher();
  const a = { id: 'a', phase: 'dormant' }, b = { id: 'b', phase: 'dormant' };
  const list = [a, b];
  assert.deepEqual(w.observe(list), []);
  w.noteKill();
  a.phase = 'active';
  assert.deepEqual(w.observe(list), []);
  for (let i = 0; i < 5; i++) w.noteKill();
  a.phase = 'cleared';
  assert.deepEqual(w.observe(list), [5]);
  assert.deepEqual(w.observe(list), [], '只报一次');
  b.phase = 'active';
  w.observe(list);
  w.noteKill();
  assert.deepEqual(w.observe([{ id: 'b', phase: 'cleared' }]), [], '换了列表（换关）不算清场');
});

// ───────────── 帧率上限（GraphicsAudioTests.DisplaySettings_…）─────────────

test('帧率上限：选项 30 / 60 / 90 / 120 / 144 / 165 / 240 / 不限，默认不限，越界夹住', () => {
  assert.deepEqual([...FRAME_CAPS], [30, 60, 90, 120, 144, 165, 240, -1]);
  assert.equal(targetFrameRate(1), 60);
  assert.equal(targetFrameRate(4), 144);
  assert.equal(targetFrameRate(FRAME_CAPS.length - 1), -1, '不限');
  assert.equal(targetFrameRate(-5), 30, '越界夹住');
  assert.equal(targetFrameRate(undefined), -1, '没设过 = 不限');
});

test('帧率上限的节拍：60 Hz 限 30 隔一帧跑一次；144 Hz 限 60 平均 60；不限每帧都跑', () => {
  const run = (hz, cap, seconds = 2) => {
    const lim = new FrameLimiter();
    let n = 0;
    for (let i = 0; i <= hz * seconds; i++) if (lim.shouldRun(1000 + (i * 1000) / hz, cap)) n++;
    return n / seconds;
  };
  near(run(60, 30), 30, 1);
  near(run(60, 60), 60, 1);
  near(run(144, 60), 60, 1.5);
  near(run(144, 30), 30, 1);
  near(run(60, -1), 60, 1);
  near(run(60, 240), 60, 1, '上限比刷新率高 = 不限');
});
