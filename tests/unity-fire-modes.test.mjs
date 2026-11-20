// M13 对照：Unity EditMode 的 FireModeTests.cs → node --test（只迁了「计时常量与曲线」这一层）。
// Unity 的开火状态机是 WeaponStateMachine + 各 IFireMode + 假表现层（IWeaponEffects），测试逐帧驱动；
// 网页的开火逻辑整个在 WeaponSystem（src/weapons/WeaponSystem.ts）里，要输入 / 相机 / 第一人称模型 / 弹道全套上下文才能跑，
// 而且 M8 正在改这个文件——行为用例（连发追帧、点射、光束跳数、预热、蓄力、齐射、切枪、整匣 / 逐发换弹、应急补给、六把枪的持续秒伤）
// 等 M8 落定后再迁。这里先把两边的计时常量和曲线锁住：读 Unity 的 WeaponTiming.cs 和网页的 WeaponSystem.ts 源码逐项比。
// M8 如果给这些常量改了名 / 挪了文件，下面的正则要跟着改。只写测试，不改实现。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cs, csConsts } from './unity-parity-kit.mjs';

const timing = csConsts(cs('Weapons/FireModes/WeaponTiming.cs'));
const timingCs = cs('Weapons/FireModes/WeaponTiming.cs');
const web = readFileSync(new URL('../src/weapons/WeaponSystem.ts', import.meta.url), 'utf8');
const constant = name => {
  const m = web.match(new RegExp(`const ${name} = (-?[\\d.]+);`));
  assert.ok(m, `WeaponSystem.ts 里没有 ${name}`);
  return Number(m[1]);
};

test('切枪 / 输入缓冲 / 自动换弹 / 逐发上膛的时间同 Unity WeaponTiming', () => {
  assert.equal(constant('SWITCH_TIME'), timing.SwitchTime);
  assert.equal(constant('HOLSTER_FRAC'), timing.HolsterFrac);
  assert.equal(constant('FIRE_BUFFER'), timing.FireBuffer);
  assert.equal(constant('AUTO_RELOAD_DELAY'), timing.AutoReloadDelay);
  assert.equal(constant('SHELL_RACK_TIME'), timing.ShellRack);
  assert.deepEqual([timing.SwitchTime, timing.HolsterFrac, timing.FireBuffer, timing.AutoReloadDelay, timing.ShellRack], [0.35, 0.4, 0.14, 0.25, 0.3]);
});

test('行内写死的数同 Unity：同帧最多补 4 发、空枪声间隔 0.3 s、全空 2.5 s 应急补给、预热 0.9 s 降完、蓄力线圈 0.6 s 降完、换弹最短 0.2 s', () => {
  assert.equal(timing.MaxCatchUp, 4);
  assert.match(web, /while \(this\.cooldown <= 0 && n < 4 && \(infinite \|\| inst\.mag > 0\)\)/, '全自动：同帧最多 4 发（AutoCatchUpIsCappedAtFourPerFrame）');
  assert.match(web, /while \(this\.beamAcc >= interval && n < 4\)/, '光束：同帧最多 4 跳');
  assert.equal(timing.DryInterval, 0.3);
  assert.match(web, /this\.dryTimer = 0\.3;/);
  assert.equal(timing.StarveTime, 2.5);
  assert.match(web, /if \(this\.starvedTime < 2\.5\) return;/);
  assert.equal(timing.SpinDown, 0.9);
  assert.match(web, /this\.spin = Math\.max\(0, this\.spin - dt \/ 0\.9\);/);
  assert.equal(timing.CoilDown, 0.6);
  assert.match(web, /Math\.max\(0, this\.spin - dt \/ 0\.6\)/);
  assert.equal(timing.MinReload, 0.2);
  assert.match(web, /this\.reloadTotal = Math\.max\(0\.2, R\.reloadTime\);/);
  assert.equal(timing.RackBufferPad, 0.05);
  assert.match(web, /this\.fireBuffer = Math\.max\(this\.fireBuffer, this\.cooldown \+ 0\.05\);/, '逐发装填被开火打断：缓冲留到上膛结束再多 0.05 s');
});

test('蓄力伤害曲线：最低倍率 + (1 − 最低倍率) × t²（ChargeCurveAndFullChargeFlags）', () => {
  assert.match(timingCs, /return minMult \+ \(1 - minMult\) \* t \* t;/);
  assert.match(web, /shot\.mult = def\.chargeMinMult \+ \(1 - def\.chargeMinMult\) \* t \* t;/);
});

test('狂热 2 s 没命中清空、狂热 / 疾化乘进实际射速（开火状态机读的那一行）', () => {
  assert.equal(csConsts(cs('Weapons/Legendaries/Legendary_Frenzy.cs')).Decay, 2);
  assert.match(web, /rt\.frenzy > 0 && ctx\.time\.now - rt\.frenzyTime > 2\) rt\.frenzy = 0;/);
  assert.match(web, /const rate = R\.fireRate \* frenzyMult \* haste;/);
});

// ───────────── 没迁的（等 M8）─────────────

test.todo('FireModeTests 的行为用例（35 条里的 30 条：全自动追帧 / 闲置后不倾泻、半自动按住只打一发 / 冷却中按住到点开火 / 输入缓冲、点射、光束、预热、蓄力、齐射、切枪姿态与防抖、整匣 / 逐发换弹与打断、空枪自动换弹、无限弹药、应急补给、弹药比例与过关回填、六把枪持续秒伤、霰弹装一发打一发）：网页的状态机在 WeaponSystem 单体里且 M8 正在改，落定后用它的假输入 / 假弹道夹具迁');