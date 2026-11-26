// M8 玩家对照（Unity Player/CameraFeel.cs、Fx/CameraShake.cs、Player/PlayerStatus.cs + Combat/Status/{Chill,Ignite,Sunburn}Status.cs、
// Player/SafeGround.cs、Player/MovementFx.cs、Pipeline/Runtime/PlayerMotor.cs 的后坐回正 → 网页 src/player/）。
// 常量和 Unity 版删除前从 C# 冻结的规格比（tests/fixtures/spec/cs-consts.json、player.json）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { spec } from './unity-parity-kit.mjs';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const src = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
/**
 * C# 常量（const / public 数值字段），键 = 相对 Unity 工程 Game/Scripts 的文件名（PlayerMotor 在 Pipeline/Runtime）。
 * 写成「弧度 × Mathf.Rad2Deg」「x / PeakPerVelocity」的，冻结的是前面那个字面量。
 */
const K = spec('cs-consts');
const PLAYER = spec('player');
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} ${a} ≠ ${b}`);

const mathUrl = await ts('../src/core/math.ts');
const shakeUrl = await ts('../src/player/CameraShake.ts');
const SHAKE = await import(shakeUrl);
const RIGM = await import(await ts('../src/player/CameraRig.ts', { '../core/math': mathUrl, './CameraShake': shakeUrl }));
const sunburnUrl = await ts('../src/enemies/bosses/HanbaSunburn.ts');
const STATUS = await import(await ts('../src/player/PlayerStatus.ts', { '../enemies/bosses/HanbaSunburn': sunburnUrl }));
const SUN = await import(sunburnUrl);
const FALL = await import(await ts('../src/player/FallRecovery.ts'));
const MOVE = await import(await ts('../src/player/MovementFx.ts', { '../fx/extras': data('export function fxExtras() { return null; }') }));

// ───────────── 震屏（Fx/CameraShake.cs + FeelProfile） ─────────────

test('camera shake: constants match Unity CameraShake / FeelProfile', async () => {
  const c = K['Fx/CameraShake.cs'];
  near(SHAKE.SHAKE.MaxStrength, c.MaxStrength);
  near(SHAKE.SHAKE.MaxTime, c.MaxTime);
  assert.equal(SHAKE.SHAKE.Voices, c.VoiceCount);
  near(SHAKE.SHAKE.MergeWindow, c.MergeWindow);
  near(SHAKE.SHAKE.StackShare, c.StackShare);
  const feel = K['Core/FeelProfile.cs'];
  near(SHAKE.SHAKE.Exponent, feel.shakeExponent, 'trauma²');
  near(SHAKE.SHAKE.AmpMax, feel.shakeAmpMax ?? 1.8);
});

test('camera shake: trauma² curve, voices stack at 35%, bursts inside 60 ms merge', () => {
  let now = 10;
  const s = new SHAKE.CameraShake(() => now);
  s.add(0.5, 0.4);
  near(s.current, 0.5, '单个来源时幅度就等于传进来的强度');
  near(s.amplitude(), 0.5);
  now += 0.2;
  near(s.trauma, Math.sqrt(0.5 / 1.2) * 0.5, 'trauma 在时长内线性降到 0');
  near(s.amplitude(), 1.2 * (Math.sqrt(0.5 / 1.2) * 0.5) ** 2, '画面幅度 = 1.2 × trauma²（开头猛、收尾柔）');
  now += 0.3;
  assert.equal(s.trauma, 0);
  // 多个来源：最强的 + 其余之和 × 0.35
  now = 20;
  s.addTrauma(0.6, 1);
  now += 0.1;
  s.addTrauma(0.4, 1);
  near(s.trauma, 0.54 + 0.4 * 0.35);
  // 0.06 s 内的连续调用并进同一个声部、取较强者
  s.clear();
  now = 30;
  s.addTrauma(0.3, 0.5);
  now += 0.03;
  s.addTrauma(0.5, 0.2);
  near(s.trauma, 0.5, '没有叠成 0.5 + 0.3 × 0.35');
  // 上限 / 非法值
  s.clear();
  s.add(99, 99);
  near(s.trauma, 1);
  s.clear();
  s.add(NaN, 1);
  s.add(1, -1);
  assert.equal(s.trauma, 0);
  // 按距离衰减：range 外没有
  s.quake({ x: 0, z: 0 }, { x: 30, z: 0 }, 0.5, 20, 0.3);
  assert.equal(s.trauma, 0);
  s.quake({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.5, 20, 0.3);
  near(s.current, 0.25);
  near(SHAKE.shakeAmplitude(1), 1.2);
});

// ───────────── 镜头手感（Player/CameraFeel.cs） ─────────────

test('camera rig: constants match Unity CameraFeel', async () => {
  const c = K['Player/CameraFeel.cs'];
  const R = RIGM.RIG;
  // 长度 / 时间 / FOV：原样
  for (const k of ['StepLength', 'BobVertical', 'BobSide', 'SpringK', 'SpringC', 'PeakPerVelocity', 'LandImpulse', 'DashFov', 'SpeedFovMax', 'ExtraFovMax', 'AimSuppressKick',
    'FovLambda', 'DeathTime', 'ReviveTime', 'DeathDrop', 'ShakePosFreq', 'ShakeRotFreq']) near(R[k], c[k], k);
  // 角度：C# 写成「弧度 × Rad2Deg」，网页直接用弧度——字面量相同
  for (const k of ['BobRoll', 'StrafeRoll', 'DipPitch', 'HurtRoll', 'HurtPitch', 'DeathPitch', 'DeathRoll']) near(R[k], c[k], k);
  near(R.HurtPush, c.HurtPush / c.PeakPerVelocity, 'HurtPush = 0.025 / 峰值系数');
  near(R.FireBack, c.FireBack / c.PeakPerVelocity, 'FireBack = 0.25 / 峰值系数');
  near(R.SpringStep, 1 / 120);
  assert.deepEqual([...R.ShakePos], PLAYER.shakePos);
  assert.deepEqual([...R.ShakeRot], PLAYER.shakeRot);
  near(c.ShakeAmpMax, 1.8);
  near(c.LungeFovSpeed, 15);
  assert.match(await src('player/PlayerController.ts'), /const LUNGE_FAST = 15;/);
  // 重落地 / 重击 / 首领倒下的震屏（Unity CameraFeel：fall > 14 → Min(0.5, (fall − 14) × 0.04)、frac ≥ 0.08 → Min(0.45, frac × 1.6)、首领倒下 (0.7, 0.6)）
  near(R.HeavyLandSpeed, 14);
  near(R.HeavyHitFraction, 0.08);
  assert.match(await src('player/CameraRig.ts'), /if \(enemy\.isBoss\) this\.shake\.add\(0\.7, 0\.6\)/);
  // 元素反应的震屏强度
  assert.deepEqual(['thunderfire', 'abyss', 'meltdown', 'veinseal'].map(id => RIGM.reactionShake(id, 0)), [0.3, 0.26, 0.22, 0.16]);
  near(RIGM.reactionShake('thunderfire', 1), 0.15, '连锁减半');
});

test('camera rig: the K 140 / C 17 spring peaks ≈ v × 0.0382 after ≈ 0.093 s', () => {
  let x = 0, v = 1, peak = 0, at = 0;
  for (let t = 0; t < 0.5; t += RIGM.RIG.SpringStep) {
    [x, v] = RIGM.springStep(x, v, RIGM.RIG.SpringStep);
    if (x > peak) { peak = x; at = t; }
  }
  near(peak, RIGM.RIG.PeakPerVelocity, '峰值（Unity 的标称系数；1/120 s 显式积分实测约 0.033）', 0.006);
  near(at, 0.093, '到峰时间', 0.012);
  // 噪声：零均值、幅度在 ±1 左右
  let sum = 0, max = 0;
  for (let i = 0; i < 4000; i++) {
    const n = RIGM.noise1(7, i * 0.137);
    sum += n;
    max = Math.max(max, Math.abs(n));
  }
  assert.ok(Math.abs(sum / 4000) < 0.05, '零均值：不会让弹道系统性偏');
  assert.ok(max <= 1.2 && max > 0.4);
});

test('recoil: camera recoil fully recovers (Unity PlayerMotor.RecoilRecoverFraction = 1)', async () => {
  const motor = K['Pipeline/Runtime/PlayerMotor.cs'];
  const pc = await src('player/PlayerController.ts');
  const num = name => Number(pc.match(new RegExp(`const ${name} = ([\\d.]+);`))[1]);
  near(num('RECOIL_RECOVER_FRACTION'), motor.RecoilRecoverFraction);
  near(num('RECOIL_RECOVER_DELAY'), motor.RecoilRecoverDelay);
  near(num('RECOIL_RECOVER_RATE'), motor.RecoilRecoverRate);
  // 滑翔（鼯的被动）
  const glide = K['Skills/Glide.cs'];
  near(num('GLIDE_FALL_SPEED'), glide.FallSpeed);
  near(num('GLIDE_GRAVITY_MULT'), glide.GravityMult);
  near(num('GLIDE_BRAKE'), glide.Brake);
  near(num('GLIDE_AIR_ACCEL'), glide.AirAccel);
});

// ───────────── 减益：寒意 / 点燃 / 日晒 ─────────────

test('player status: constants match Unity Chill / Ignite / Sunburn', async () => {
  const chill = K['Combat/Status/ChillStatus.cs'];
  for (const k of ['MaxSlow', 'DefaultSeconds', 'MaxEntries']) near(STATUS.CHILL[k], chill[k], k);
  const ignite = K['Combat/Status/IgniteStatus.cs'];
  for (const k of ['DefaultSeconds', 'TickInterval', 'EndGrace', 'LastTickGrace']) near(STATUS.IGNITE[k], ignite[k], k);
  const sun = K['Combat/Status/SunburnStatus.cs'];
  near(SUN.SUNBURN_STACK_SECONDS, sun.StackSeconds);
  near(SUN.SUNBURN_TICK_INTERVAL, sun.TickInterval);
  near(SUN.SUNBURN_DAMAGE_PER_STACK, sun.DamagePerStack);
  near(SUN.SUNBURN_DECAY_DELAY, sun.DecayDelay);
  near(SUN.SUNBURN_DECAY_PER_SECOND, sun.DecayPerSecond);
  near(SUN.SUNBURN_MAX_STACKS, sun.MaxStacks);
});

test('chill: strongest entry wins, capped at 70%, repeated hits refresh instead of stacking', () => {
  const c = new STATUS.ChillInstance();
  assert.equal(c.speedMult, 1);
  c.apply(0.35, 1.5);
  near(c.speedMult, 0.65);
  c.apply(0.35, 1.5);
  near(c.speedMult, 0.65, '同样的两条不越叠越慢');
  c.apply(0.9, 0.5);
  near(c.speedMult, 0.3, '上限 70%');
  c.tick(0.6);
  near(c.speedMult, 0.65, '强的那条到期后回落到次强的');
  c.tick(1);
  assert.equal(c.active, false);
  // 百分数口径；最多 4 条，满了替换「比例 × 剩余时间」最小的
  near(STATUS.chillFraction(35), 0.35);
  near(STATUS.chillFraction(NaN), 0);
  for (const [f, t] of [[0.2, 4], [0.3, 4], [0.4, 4], [0.1, 0.5]]) c.apply(f, t);
  c.apply(0.25, 3);
  assert.equal(c.count, 4);
  c.tick(1);
  assert.equal(c.count, 4, '0.1 × 0.5 的那条已被换掉（否则这里只剩 3 条）');
  assert.equal(c.apply(0, 1), false);
});

test('ignite: ticks every 0.5 s; re-ignite refreshes time and keeps the larger tick', () => {
  const hits = [];
  const ig = new STATUS.IgniteInstance(d => hits.push(d));
  ig.apply(3, 2);
  near(ig.remainingDotRaw, 12, '2 s = 4 跳');
  for (let i = 0; i < 100; i++) ig.tick(0.01);
  assert.deepEqual(hits, [3, 3]);
  ig.apply(2, 2);
  near(ig.tickDamage, 3, '取较大的跳伤');
  for (let i = 0; i < 400; i++) ig.tick(0.01);
  assert.equal(hits.length, 6, '1 s 时续到 3 s：0.5 … 3.0 共 6 跳');
  assert.equal(ig.active, false);
});

test('player status: chill only scales walk speed; everything clears on death; hurt goes through the host', () => {
  let alive = true;
  const hurt = [];
  const st = new STATUS.PlayerStatus({ hurt: (amount, element) => hurt.push([amount, element]), alive: () => alive });
  assert.ok(st.chill(0.4, 1));
  near(st.speedMult, 0.6);
  assert.ok(st.ignite(2, 5));
  st.update(0.5);
  assert.deepEqual(hurt, [[5, 'fire']]);
  assert.ok(st.sunExposure(2.6, 1, 0.6));
  assert.ok(st.has('sunburn'));
  assert.equal(st.view('chill').stacks, 1);
  alive = false;
  st.update(0.1);
  assert.ok(!st.has('chill') && !st.has('ignite') && !st.has('sunburn'));
  assert.equal(st.speedMult, 1);
  assert.equal(st.chill(0.4, 1), false, '阵亡后不再挂');
});

test('enemy-side entry points route into PlayerStatus when the player has one', async () => {
  for (const [file, call] of [['enemies/fx/FrostPackFx.ts', 'status.chill(frac, seconds)'], ['enemies/fx/FrostSupportFx.ts', 'status.chill(frac, duration)'],
    ['enemies/fx/InfernoRangedFx.ts', 'status.ignite(duration, tick)']]) {
    assert.ok((await src(file)).includes(call), `${file} 没有转到 PlayerStatus`);
  }
  assert.match(await src('enemies/bosses/Hanba.ts'), /status\?\.sunburn \?\? null/, '旱魃的日晒层挂在玩家状态上');
  // 行为：有 status 时不再改属性表
  const calls = [];
  const sup = await import(await ts('../src/enemies/fx/FrostSupportFx.ts', {
    '../../core/math': mathUrl,
    '../Models': data('export const Geo = new Proxy({}, { get: () => () => ({}) }); export function part() { return {}; } export function newAdditive() { return {}; }'),
  }).catch(() => data('export const chillPlayer = null;'))).catch(() => ({ chillPlayer: null }));
  if (typeof sup.chillPlayer === 'function') {
    const stats = { get: () => 7.5, add: () => calls.push('add'), removeSource: () => calls.push('remove') };
    const status = { speedMult: 1, chill(f) { this.speedMult = 1 - f; return true; } };
    const lost = sup.chillPlayer({ player: { stats, status }, time: { now: 0 }, tasks: { delay() {} } }, 0.7, 1.5);
    near(lost, 7.5 * 0.7);
    assert.deepEqual(calls, [], '不改属性表');
  }
});

// ───────────── 安全落点 / 坠落回收（Player/SafeGround.cs） ─────────────

test('fall recovery: constants match Unity SafeGround; kill line sits 40 m below the lowest safe point', async () => {
  const c = K['Player/SafeGround.cs'];
  near(FALL.SAFE.RecordInterval, c.recordInterval);
  near(FALL.SAFE.EdgeProbe, c.edgeProbe);
  near(FALL.SAFE.Spacing, c.spacing);
  assert.equal(FALL.SAFE.Ring, c.RingSize);
  near(FALL.SAFE.DebugInvuln, c.DebugInvuln);
  near(FALL.SAFE.AbyssFallSpeed, c.AbyssFallSpeed);
  near(FALL.SAFE.AbyssProbe, c.AbyssProbe);
  // Unity SafeGround 的 HazardSpec.Fall：扣 10% 最大生命（burst = 0.1f）、1 s 无敌（grace = 1f）
  near(FALL.FALL_SPEC.burst, 0.1);
  near(FALL.FALL_SPEC.grace, 1);
  assert.equal(FALL.killLine(-60, 3), -60);
  assert.equal(FALL.killLine(-25, -10), -50, '井底比出生点低很多时出界线跟着往下');
});

test('fall recovery: records safe spots on solid ground and carries the player back with a 10% hit', () => {
  const ground = (x, z) => (x > 20 ? -Infinity : 0);
  const player = {
    position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(), alive: true, onGround: true, isDashing: false, isLunging: false,
    invulnerableTime: 0, hp: 100, maxHp: () => 100, teleport(p) { this.position.copy(p); },
  };
  const damage = [];
  const ctx = {
    time: { now: 0 }, stage: { arena: { floorY: 0, killY: -30, playerSpawn: new THREE.Vector3() } },
    world: { groundHeight: (x, z) => ground(x, z), query: () => [] },
    combat: { damagePlayer: (amount) => { damage.push([amount, player.invulnerableTime]); return amount; } },
    audio: { play() {} }, ui: {},
  };
  FALL.fallRecoveryHooks.safe = null;
  const fall = new FALL.FallRecovery(ctx, player);
  fall.resetTo(player.position);
  for (let i = 0; i <= 10; i++) {
    ctx.time.now = i * 0.25;
    player.position.set(i * 1.9, 0, 0);
    assert.equal(fall.update(), false);
  }
  near(fall.lastSafe.x, 19, '每 0.2 s 记一个');
  // 走出边缘掉下去
  player.onGround = false;
  player.position.set(24, -45, 0);
  assert.equal(fall.update(), true);
  near(player.position.x, 19, '托回最近的安全点');
  assert.deepEqual(damage, [[10, 0]], '扣 10% 最大生命，无视托回的短无敌');
  assert.ok(player.invulnerableTime >= 1, '之后 1 s 无敌');
  assert.equal(fall.recoveries, 1);
  // 调试无敌（> 5 s）不扣血
  player.invulnerableTime = 999;
  player.position.set(24, -45, 0);
  fall.update();
  assert.equal(damage.length, 1);
  // 有机关的安全落脚点时交给它
  let hooked = 0;
  FALL.fallRecoveryHooks.safe = { recover: spec => { hooked++; assert.equal(spec, FALL.FALL_SPEC); } };
  player.position.set(24, -45, 0);
  fall.update();
  assert.equal(hooked, 1);
  FALL.fallRecoveryHooks.safe = null;
});

// ───────────── 移动特效（Player/MovementFx.cs） ─────────────

test('movement fx: numbers match Unity MovementFx', async () => {
  const M = MOVE.MOVE_FX;
  // Unity MovementFx 的 Random.Range：冲刺风线半径 0.6–1.6、前方 2–5、速度 26–34、粗细 0.035–0.06、寿命 0.14–0.22
  assert.deepEqual([[...M.StreakRadius], [...M.StreakAhead], [...M.StreakSpeed], [...M.StreakSize], [...M.StreakLife]], [[0.6, 1.6], [2, 5], [26, 34], [0.035, 0.06], [0.14, 0.22]]);
  // 落地：fall < 6 不出尘，k = Clamp01((fall − 6) / 14)，尘粒 Lerp(8, 22, k)，fall ≥ 14 出地面波纹
  assert.deepEqual([M.LandDustFrom, M.LandRingFrom, [...M.LandDust]], [6, 14, [8, 22]]);
  assert.deepEqual(MOVE.landDust(5.9), { count: 0, k: 0 });
  assert.deepEqual(MOVE.landDust(6), { count: 8, k: 0 });
  assert.deepEqual(MOVE.landDust(13), { count: 15, k: 0.5 });
  assert.deepEqual(MOVE.landDust(40), { count: 22, k: 1 });
});
