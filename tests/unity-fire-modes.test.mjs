// M13 对照：Unity EditMode 的 FireModeTests.cs → node --test（迁了「计时常量与曲线」这一层 + 切枪姿态）。
// Unity 的开火状态机是 WeaponStateMachine + 各 IFireMode + 假表现层（IWeaponEffects），测试逐帧驱动；
// 网页 M8 之后：计时常量、扳机闩、蓄力曲线、切枪姿态这些纯逻辑在 src/weapons/FireControl.ts（Unity WeaponTiming / TriggerState 的移植，
// 不 import 任何东西，这里直接 import 比数值）；状态机本身还在 WeaponSystem（要输入 / 相机 / 第一人称模型 / 弹道全套上下文才能跑），
// 读它的源码确认用的是 FireControl 的常量而不是另写一份。行为用例（连发追帧、点射、光束跳数、预热、蓄力、齐射、切枪防抖、
// 整匣 / 逐发换弹、应急补给、六把枪的持续秒伤）见文件末尾的 todo。只写测试，不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { cs, csConsts, near, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const FC = await graph.load('weapons/FireControl.ts');
const { getWeaponDef } = await graph.load('weapons/WeaponDefs.ts');
const timing = csConsts(cs('Weapons/FireModes/WeaponTiming.cs'));
const timingCs = cs('Weapons/FireModes/WeaponTiming.cs');
const web = readFileSync(new URL('../src/weapons/WeaponSystem.ts', import.meta.url), 'utf8');
const T = FC.WEAPON_TIMING;

test('切枪 / 输入缓冲 / 自动换弹 / 逐发上膛的时间同 Unity WeaponTiming', () => {
  assert.deepEqual(
    [T.SwitchTime, T.HolsterFrac, T.FireBuffer, T.AutoReloadDelay, T.ShellRack],
    [timing.SwitchTime, timing.HolsterFrac, timing.FireBuffer, timing.AutoReloadDelay, timing.ShellRack],
  );
  assert.deepEqual([timing.SwitchTime, timing.HolsterFrac, timing.FireBuffer, timing.AutoReloadDelay, timing.ShellRack], [0.35, 0.4, 0.14, 0.25, 0.3]);
  // WeaponSystem 用的就是这几项（不另写一份字面量）
  assert.match(web, /const SWITCH_TIME = WEAPON_TIMING\.SwitchTime;/);
  assert.match(web, /const AUTO_RELOAD_DELAY = WEAPON_TIMING\.AutoReloadDelay;/);
  assert.match(web, /const SHELL_RACK_TIME = WEAPON_TIMING\.ShellRack;/);
  // 收枪比例在切枪姿态里、开火缓冲在扳机闩里
  const trigger = new FC.TriggerState();
  trigger.update(true, true, 1 / 60);
  near(assert, trigger.buffer, timing.FireBuffer, 1e-9, '按下时缓冲 = FireBuffer');
  assert.equal(FC.switchPose(T.SwitchTime * (1 - timing.HolsterFrac + 0.01), true).holster, true, '收枪占前 40%');
  assert.equal(FC.switchPose(T.SwitchTime * (1 - timing.HolsterFrac - 0.01), true).holster, false);
});

test('行内的数同 Unity：同帧最多补 4 发、空枪声间隔 0.3 s、全空 2.5 s 应急补给、预热 0.9 s 降完、蓄力线圈 0.6 s 降完、换弹最短 0.2 s', () => {
  assert.deepEqual(
    [T.MaxCatchUp, T.DryInterval, T.StarveTime, T.SpinDown, T.CoilDown, T.MinReload, T.RackBufferPad],
    [timing.MaxCatchUp, timing.DryInterval, timing.StarveTime, timing.SpinDown, timing.CoilDown, timing.MinReload, timing.RackBufferPad],
  );
  assert.deepEqual([timing.MaxCatchUp, timing.DryInterval, timing.StarveTime, timing.SpinDown, timing.CoilDown, timing.MinReload, timing.RackBufferPad], [4, 0.3, 2.5, 0.9, 0.6, 0.2, 0.05]);
  assert.match(web, /while \(this\.cooldown <= 0 && n < WEAPON_TIMING\.MaxCatchUp && \(infinite \|\| inst\.mag > 0\)\)/, '全自动：同帧最多 4 发（AutoCatchUpIsCappedAtFourPerFrame）');
  assert.match(web, /private updateBeam\([^)]*\): void \{[\s\S]*?this\.autoFire\(true, inst, R, infinite, rate\);/, '光束：跳数走同一个冷却与追帧上限（Unity BeamMode）');
  assert.match(web, /this\.dryTimer = WEAPON_TIMING\.DryInterval;/);
  assert.match(web, /if \(this\.starvedTime < WEAPON_TIMING\.StarveTime\) return;/);
  assert.match(web, /this\.spin = Math\.max\(0, this\.spin - dt \/ WEAPON_TIMING\.SpinDown\);/);
  assert.match(web, /Math\.max\(0, this\.spin - dt \/ WEAPON_TIMING\.CoilDown\)/);
  assert.match(web, /this\.reloadTotal = Math\.max\(WEAPON_TIMING\.MinReload, R\.reloadTime\);/);
  assert.match(web, /this\.trigger\.buffer = Math\.max\(this\.trigger\.buffer, this\.cooldown \+ WEAPON_TIMING\.RackBufferPad\);/, '逐发装填被开火打断：缓冲留到上膛结束再多 0.05 s');
});

test('蓄力伤害曲线：最低倍率 + (1 − 最低倍率) × t²（ChargeCurveAndFullChargeFlags）', () => {
  assert.match(timingCs, /return minMult \+ \(1 - minMult\) \* t \* t;/);
  // Unity 的三个点
  near(assert, FC.chargeMult(0.2, 0), 0.2, 1e-6);
  near(assert, FC.chargeMult(0.2, 0.5), 0.4, 1e-6);
  near(assert, FC.chargeMult(0.2, 1), 1, 1e-6);
  for (const t of [-1, 0, 0.13, 0.5, 0.77, 1, 2]) {
    const c = Math.max(0, Math.min(1, t));
    near(assert, FC.chargeMult(0.35, t), 0.35 + 0.65 * c * c, 1e-9, `t = ${t}`);
  }
  // ChargeMode.Shot：半蓄 strength 0.7、不算满蓄；满蓄 full、穿透 +3、倍率 1（贯虹灵炮）
  near(assert, FC.chargeStrength(0.5), 0.7, 1e-5);
  near(assert, FC.chargeStrength(1), 1, 1e-9);
  assert.match(web, /shot\.mult = chargeMult\(def\.chargeMinMult, t\);/);
  assert.match(web, /shot\.pierceBonus = t >= 1 \? def\.chargeFullPierce : 0;/);
  assert.match(web, /shot\.full = t >= 1;/);
  const railgun = getWeaponDef('railgun');
  assert.deepEqual([railgun.mode, railgun.chargeMinMult, railgun.chargeFullPierce], ['charge', 0.2, 3]);
});

test('SwitchPoseHolstersThenDraws: 先收旧枪（前 40%）再抬新枪', () => {
  const S = T.SwitchTime;
  let p = FC.switchPose(S, true);
  assert.ok(p.holster);
  near(assert, p.lower, 0, 1e-5, '刚开始收枪：旧枪还没下沉');
  p = FC.switchPose(S * (1 - 0.39), true);
  assert.ok(p.holster);
  assert.ok(p.lower > 0.95, '收枪快结束：旧枪几乎沉到底');
  p = FC.switchPose(S * (1 - 0.41), true);
  assert.ok(!p.holster, '过了 40% 换成新枪');
  assert.ok(p.lower > 0.95, '新枪从底下开始抬');
  p = FC.switchPose(0.0001, true);
  assert.ok(!p.holster);
  assert.ok(p.lower < 0.01);
  p = FC.switchPose(S * 0.5, false);
  assert.ok(!p.holster, '没有旧枪：新枪直接抬');
  near(assert, p.lower, 0.5, 1e-5);
  assert.deepEqual(FC.switchPose(0, true), { holster: false, lower: 0 });
});

test('狂热 2 s 没命中清空、狂热 / 疾化乘进实际射速（开火状态机读的那一行）', () => {
  assert.equal(csConsts(cs('Weapons/Legendaries/Legendary_Frenzy.cs')).Decay, 2);
  assert.match(web, /rt\.frenzy > 0 && ctx\.time\.now - rt\.frenzyTime > 2\) rt\.frenzy = 0;/);
  assert.match(web, /const rate = R\.fireRate \* frenzyMult \* haste;/);
});

// ───────────── 没迁的 ─────────────

test.todo('FireModeTests 的行为用例（35 条里的 29 条：全自动追帧 / 闲置后不倾泻、半自动按住只打一发 / 冷却中按住到点开火 / 输入缓冲、点射、光束、预热、蓄力、齐射、切枪防抖、整匣 / 逐发换弹与打断、空枪自动换弹、无限弹药、应急补给、弹药比例与过关回填、六把枪持续秒伤、霰弹装一发打一发）：'
  + 'M8 把扳机闩 / 计时 / 曲线 / 切枪姿态抽进了 FireControl.ts（tests/m8-weapons.test.mjs 测了），状态机还在 WeaponSystem 单体里，要给它做假输入 / 假弹道夹具才能逐帧驱动');
