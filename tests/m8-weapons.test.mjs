// M8 武器 / 技能对照（Unity Weapons/WeaponController.cs、FireModes/*、FlameCone.cs、RailgunBeam.cs、Ballistics.cs，Skills/CastPose.cs、
// SkillFx.cs、HeroSkills.cs、Bear / Falcon / LiaoSkills.cs → 网页 src/weapons/、src/player/）。常量从 C# 源码读出来比；
// 行为断言照 Unity EditMode 的 FireModeTests（扳机 / 冲刺禁射）、CastPoseTests、WeaponSpecialsTests。
import assert from 'node:assert/strict';
import test from 'node:test';
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
const cs = path => readFile(new URL(`../unity/Assets/Game/Scripts/${path}`, import.meta.url), 'utf8');
const src = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
function csConsts(source) {
  const out = {};
  for (const m of source.matchAll(/const\s+(?:float|int)\s+([^;(){}]+);/g)) {
    for (const part of m[1].split(',')) {
      const kv = part.match(/^\s*(\w+)\s*=\s*(-?[\d.]+)f?\s*$/);
      if (kv) out[kv[1]] = Number(kv[2]);
    }
  }
  return out;
}
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} ${a} ≠ ${b}`);

const mathUrl = await ts('../src/core/math.ts');
const FC = await import(await ts('../src/weapons/FireControl.ts'));
const jets = [];
const FLAME = await import(await ts('../src/weapons/FlameCone.ts', {
  '../core/types': data('export const ELEMENT_COLORS = { none: 0xffffff, fire: 0xff6a1f, shock: 0x6fd8ff, corrode: 0x9dff4a };'),
  '../core/math': mathUrl,
  '../fx/extras': data('export function fxExtras() { return { flameJet: (...a) => globalThis.__jets.push(a) }; }'),
}));
globalThis.__jets = jets;
const RAIL = await import(await ts('../src/weapons/RailgunBeam.ts'));
const CAST = await import(await ts('../src/player/CastPose.ts'));

// ───────────── 时序 / 手感常数 ─────────────

test('weapon timing + feel constants match Unity WeaponTiming / WeaponController', async () => {
  const t = csConsts(await cs('Weapons/FireModes/WeaponTiming.cs'));
  for (const k of Object.keys(FC.WEAPON_TIMING)) near(FC.WEAPON_TIMING[k], t[k], k);
  const wc = await cs('Weapons/WeaponController.cs');
  const c = csConsts(wc);
  near(FC.WEAPON_FEEL.RecoilScale, c.RecoilScale);
  near(FC.WEAPON_FEEL.ViewKickScale, c.ViewKickScale);
  near(FC.WEAPON_FEEL.MeleeHudSpread, c.MeleeHudSpread);
  assert.match(wc, /aimT = Mathf\.MoveTowards\(aimT, aiming \? 1 : 0, dt \* 7f\)/);
  near(FC.WEAPON_FEEL.AimRate, 7);
  assert.match(wc, /magnitude \/ 7\.5f\) \* \(0\.2f - 0\.1f \* aimT\)/);
  assert.match(wc, /motor\.Grounded \? 1 : 1\.15f - 0\.1f \* aimT/);
  assert.match(wc, /bloom \* \(1 - 0\.45f \* aimT\)\) \* R\.spreadMult/);
  assert.match(wc, /Mathf\.Lerp\(1, 0\.72f, aimT\)/);
  assert.match(wc, /Mathf\.Clamp\(spreadNow \+ PelletCone\(def, R\), 0, 0\.25f\)/);
  const F = FC.WEAPON_FEEL;
  assert.deepEqual([F.MoveSpread, F.MoveSpreadAim, F.MoveSpreadSpeed, F.AirSpread, F.AirSpreadAim, F.BloomAim, F.PelletAim, F.HudSpreadMax, F.HudLambda], [0.2, 0.1, 7.5, 1.15, 0.1, 0.45, 0.72, 0.25, 18]);
  near(F.ScopeKick, csConsts(await cs('Weapons/Handling/WeaponSight.cs')).ScopeKick);
  // WeaponSystem 真的在用
  const ws = await src('weapons/WeaponSystem.ts');
  assert.match(ws, /addRecoil\(pitch \* WEAPON_FEEL\.RecoilScale, yaw \* WEAPON_FEEL\.RecoilScale\)/);
  assert.match(ws, /kick\.call\(ctx\.player, def\.shake \* strength, shakeTime, def\.kick\.back \* strength\)/, '开枪的镜头反馈走 fireKick');
  assert.match(wc, /feel\.FireKick\(def\.shake \* strength, def\.shake > 0\.15f \? 0\.16f : 0\.08f, def\.kickBack \* strength\)/);
});

test('trigger latch: buffered press or a held-but-unfired press counts as a pull (Unity TriggerState)', () => {
  const t = new FC.TriggerState();
  t.update(true, true, 0.016);
  near(t.buffer, 0.14);
  assert.ok(t.pulled(true));
  // 冷却中按住不放 0.3 s：缓冲早没了，但这次按压还没打出过 → 冷却一好仍然算扣了一下
  for (let i = 0; i < 20; i++) t.update(false, true, 0.016);
  assert.equal(t.buffered, false);
  assert.ok(t.pulled(true), '按住只要没打出过就还算');
  t.consume();
  assert.ok(!t.pulled(true), '打出后必须松开扳机');
  t.update(false, false, 0.016);
  assert.ok(!t.pulled(false));
  t.update(false, true, 0.016);
  assert.ok(t.pulled(true), '松开再按住又算一次');
  // 提前 0.1 s 按下再松开：缓冲还在
  t.reset();
  t.update(true, true, 0.016);
  t.update(false, false, 0.1);
  assert.ok(t.pulled(false));
  t.update(false, false, 0.05);
  assert.ok(!t.pulled(false), '0.14 s 之后缓冲过期');
});

test('dash blocks firing but not charging / spin-up; aim is refused while reloading / switching / dashing', async () => {
  assert.equal(FC.canShoot(true, false), true);
  assert.equal(FC.canShoot(true, true), false, '冲刺中不开火');
  assert.equal(FC.canShoot(false, false), false);
  const base = { aimInput: true, takeover: false, reloading: false, switchTimer: 0, dashing: false };
  assert.equal(FC.aimAllowed(base), true);
  for (const k of ['takeover', 'reloading', 'dashing']) assert.equal(FC.aimAllowed({ ...base, [k]: true }), false, k);
  assert.equal(FC.aimAllowed({ ...base, switchTimer: 0.1 }), false);
  assert.equal(FC.aimAllowed({ ...base, aimInput: false }), false);
  // 源码结构：各开火模式怎么用 blocked（同 Unity FireModes）
  const ws = await src('weapons/WeaponSystem.ts');
  assert.match(ws, /const blocked = dashing;/);
  assert.match(ws, /this\.autoFire\(fireDown && shootOk, inst, R, infinite, rate\)/, '全自动');
  assert.match(ws, /this\.updateBeam\(dt, fireDown && shootOk && hasAmmo/, '光束');
  assert.match(ws, /if \(blocked\) return;\s*this\.burstTimer -= dt;/, '点射：冲刺中暂停，冲刺完接着打');
  assert.match(ws, /const firing = want && !blocked && this\.spin >= 1 && hasAmmo;/, '机炮：转速保持但不开火');
  assert.match(ws, /this\.updateCharge\(dt, fireDown, inputOk, ready && hasAmmo && this\.cooldown <= 0,/, '蓄力不看 blocked');
  assert.match(await cs('Weapons/FireModes/SpinupMode.cs'), /firing = want && !input\.blocked && spin >= 1 && host\.HasAmmo;/);
  assert.match(await cs('Weapons/FireModes/ChargeMode.cs'), /bool can = input\.ready && host\.HasAmmo && host\.Cooldown <= 0;/);
  assert.match(await cs('Weapons/FireModes/BurstMode.cs'), /if \(input\.blocked\) return;/);
  assert.match(await cs('Weapons/WeaponController.cs'), /blocked = motor\.Dashing/);
});

test('aim, spread, charge and switch-pose formulas', () => {
  // 开镜：线性每秒 7
  let a = 0;
  for (let i = 0; i < 6; i++) a = FC.aimStep(a, true, 1 / 60);
  near(a, 0.7);
  for (let i = 0; i < 6; i++) a = FC.aimStep(a, true, 1 / 60);
  assert.equal(a, 1, '约 0.14 s 开完');
  near(FC.aimStep(1, false, 0.1), 0.3);
  // 散布：跑动 +20%、滞空 ×1.15（开镜各减 0.1），连射累积开镜 × 0.55，进了镜为 0
  near(FC.spreadAngle(0.02, 7.5, true, 0, 0, 1), 0.024);
  near(FC.spreadAngle(0.02, 99, true, 1, 0, 1), 0.022);
  near(FC.spreadAngle(0.02, 0, false, 0, 0, 1), 0.023);
  near(FC.spreadAngle(0.02, 0, false, 1, 0, 1), 0.021);
  near(FC.spreadAngle(0.02, 0, true, 1, 0.01, 2), (0.02 + 0.0055) * 2);
  assert.equal(FC.spreadAngle(0.02, 7.5, false, 1, 0.05, 1, -45), 0, '狙击镜里零散布');
  near(FC.spreadAngle(0.02, 0, true, 1, 0, 1, -24), 0.02, '贯虹 −24° 不算进镜');
  assert.ok(FC.scoped(-30.01) && !FC.scoped(-30));
  // 蓄力：0.2 + 0.8·t²；反馈 0.4 + 0.6·t
  near(FC.chargeMult(0.2, 0), 0.2);
  near(FC.chargeMult(0.2, 0.5), 0.4);
  near(FC.chargeMult(0.2, 1), 1);
  near(FC.chargeMult(0.2, 7), 1);
  near(FC.chargeStrength(0.5), 0.7);
  near(FC.fireInterval(13), 1 / 13);
  near(FC.fireInterval(0), 10, '射速下限 0.1 发 / 秒');
  near(FC.bloomDelay(13, 1), 1.25 / 13);
  near(FC.bloomDelay(1, 1), 0.35);
  near(FC.bloomDelay(100, 3), 0.08);
  // 切枪姿态：前 40% 旧枪下沉，后 60% 新枪抬起
  assert.deepEqual(FC.switchPose(0, true), { holster: false, lower: 0 });
  const p1 = FC.switchPose(0.35 * 0.8, true);
  assert.ok(p1.holster);
  near(p1.lower, 0.5);
  const p2 = FC.switchPose(0.35 * 0.3, true);
  assert.ok(!p2.holster);
  near(p2.lower, 0.5);
  near(FC.switchPose(0.35 * 0.25, false).lower, 0.25);
});

test('beam: ticks ride the shared cooldown; chain jump uses the main hit template (Unity Ballistics.BeamTick)', async () => {
  const ws = await src('weapons/WeaponSystem.ts');
  assert.doesNotMatch(ws, /beamAcc/, '不再用独立累加器（连点能快过射速）');
  assert.match(ws, /this\.ballistics\.beamTrace\(inst, R, this\.beamHit\);\s*this\.autoFire\(true, inst, R, infinite, rate\);/);
  const firing = await src('weapons/Firing.ts');
  assert.match(firing, /elementChance: R\.elementChance,\s*critMult: R\.critMult,[\s\S]{0,200}procDepth: 1,\s*tags: \['chain'\]/);
  const b = await cs('Weapons/Ballistics.cs');
  assert.match(b, /HitInfo\(in s, s\.damage \* def\.chainFraction, oc, \(oc - end\)\.normalized\);\s*info\.depth = 1;\s*info\.tags \|= DamageTag\.Chain;/);
  const c = csConsts(b);
  near(c.PierceKeep, 0.85);
  near(c.PointBlankRange, 1.3);
  assert.match(firing, /const PIERCE_KEEP = 0\.85;/);
  assert.match(firing, /const MAX_HITS = 8;/);
  assert.equal(c.MaxPierceHits, 8);
  assert.match(firing, /const POINT_BLANK = 1\.3;/);
});

// ───────────── 喷火锥（FlameCone.cs） ─────────────

const flamer = { id: 'flamer', mode: 'auto', range: 11, knockback: 0, projectile: { speed: 24, lifetime: 0.42, radius: 0.32, scale: 1.1, visual: 'flame', color: 0xff7a2a } };

test('flame cone: constants and reach / radius match Unity FlameCone', async () => {
  const text = await cs('Weapons/FlameCone.cs');
  const c = csConsts(text);
  near(FLAME.FLAME_CONE.HalfAngle, c.HalfAngle);
  near(FLAME.FLAME_CONE.StartOffset, c.StartOffset);
  assert.match(text, /Visual = "flame"/);
  assert.match(text, /Mathf\.RoundToInt\(5 \* Fx\.Density\)/);
  assert.match(text, /\(tick \+ i\) % 3 == 0/);
  assert.deepEqual([FLAME.FLAME_CONE.Flames, FLAME.FLAME_CONE.LickEvery], [5, 3]);
  assert.ok(FLAME.flameConeHandles(flamer));
  assert.ok(!FLAME.flameConeHandles({ ...flamer, mode: 'semi' }));
  assert.ok(!FLAME.flameConeHandles({ ...flamer, projectile: { ...flamer.projectile, visual: 'orb' } }));
  assert.ok(!FLAME.flameConeHandles({ ...flamer, projectile: null }));
  near(FLAME.flameReach(flamer), 24 * 0.42, '弹速 × 寿命 ≈ 10 m');
  near(FLAME.flameReach(flamer, 1.5), 11, '弹速词条拉长，但不超过射程');
  near(FLAME.flameRadiusAt(flamer, 0), 0.32);
  near(FLAME.flameRadiusAt(flamer, 10), 0.32 + 10 * Math.tan(0.06));
  assert.ok(Math.abs(FLAME.flameRadiusAt(flamer, 10) - 0.92) < 0.01, '10 m 处半径约 0.9 m');
  // 定义表里的喷火器就是这些数
  assert.match(await src('weapons/WeaponDefs.ts'), /id: 'flamer'[\s\S]{0,400}range: 11, pierce: 3,\s*projectile: \{ speed: 24, gravity: -3, radius: 0\.32, lifetime: 0\.42, visual: 'flame'/);
  assert.match(await src('weapons/WeaponSystem.ts'), /else if \(flameConeHandles\(def\)\) \{[\s\S]{0,160}this\.flame\.emit\(/, 'WeaponSystem 把喷火器转给火焰锥，不发投射物');
});

test('flame cone: capsule-in-cone geometry and "nearest 1 + pierce, blocked ones take no slot"', () => {
  const origin = new THREE.Vector3(0, 1.6, 0), dir = new THREE.Vector3(0, 0, -1);
  const out = { along: 0, off: 0, point: new THREE.Vector3() };
  const hit = (x, z, r = 0.4, h = 1.8) => FLAME.coneHit(flamer, origin, dir, 10, { x, y: 0, z }, r, h, out);
  assert.ok(hit(0, -5), '正前方');
  near(out.off, 0, '轴线穿过胶囊');
  assert.ok(hit(0, -0.3), '贴脸的也烧到');
  assert.ok(hit(1.0, -9), '9 m 处偏 1 m：锥半径 0.86 + 身体 0.4');
  assert.equal(hit(1.5, -9), null);
  assert.ok(hit(0.6, -1), '1 m 处偏 0.6 m：身体表面离轴 0.2 < 0.38');
  assert.equal(hit(1.0, -1), null);
  assert.equal(hit(0, -10.6), null, '锥长之外');
  assert.equal(hit(0, 3), null, '背后');
  assert.ok(hit(0.1, -10.3), '身体表面还在 10 m 内');
  // 高处的敌人：火舌从头顶下方擦过也算（胶囊顶端）
  origin.set(0, 3, 0);
  assert.ok(hit(0, -5, 0.4, 2.8));
  assert.equal(hit(0, -5, 0.4, 1.8), null, '头顶离锥轴 1.2 m');
  // 排序与名额
  const cands = [{ along: 6, id: 'c' }, { along: 2, id: 'a', blocked: true }, { along: 4, id: 'b' }, { along: 8, id: 'd' }, { along: 9, id: 'e' }];
  assert.deepEqual(FLAME.pickBurned([...cands], 1, c => !!c.blocked).map(c => c.id), ['b', 'c'], '被挡住的不算、也不占名额');
  assert.deepEqual(FLAME.pickBurned([...cands], 3, c => !!c.blocked).map(c => c.id), ['b', 'c', 'd', 'e']);
  assert.deepEqual(FLAME.pickBurned([...cands], 0, () => false).map(c => c.id), ['a']);
});

test('flame cone: one tick burns through the damage pipeline (no weakpoint, wall cuts the reach) and emits flames', () => {
  const dealt = [];
  const mk = (z, extra = {}) => ({ alive: true, untargetable: false, position: new THREE.Vector3(0, 0, z), radius: 0.4, height: 1.8, ...extra });
  const enemies = [mk(-3), mk(-5), mk(-7), mk(-8), mk(-9), mk(-4, { untargetable: true })];
  let wall = null;
  const ctx = {
    player: { eye: new THREE.Vector3(0, 1.2, 0), getAimDirection: out => out.set(0, 0, -1) },
    world: { raycast: () => wall, segmentBlocked: () => false },
    enemies: { queryRadius: (c, r, out) => { out.push(...enemies); return out; } },
    combat: { damageEnemy: (e, req) => dealt.push([enemies.indexOf(e), req]) },
  };
  const cone = new FLAME.FlameCone(ctx, out => out.set(0.2, 1.0, -0.7), () => 0.99);
  const R = { def: flamer, damage: 7.5, pierce: 3, elementChance: 0.08, critMult: 1.5, critChance: 0, projSpeedMult: 1 };
  jets.length = 0;
  assert.equal(cone.emit({ inst: { uid: 9 }, R, element: 'fire', spread: 0, mult: 2, forceCrit: false }), 4);
  assert.deepEqual(dealt.map(d => d[0]), [0, 1, 2, 3], '前 1 + 3 名，不可选中的跳过');
  const req = dealt[0][1];
  assert.deepEqual([req.base, req.element, req.source, req.elementChance, req.critMult, req.weaponUid, req.procDepth], [15, 'fire', 'weapon', 0.08, 1.5, 9, 0]);
  assert.equal(req.headshot, undefined, '不按弱点算');
  assert.equal(jets.filter(j => !j[5]).length >= 5, true, '每跳 5 颗火舌（外加舔火星）');
  // 撞墙截短：墙在 4 m → 5 m 之后的烧不到
  dealt.length = 0;
  wall = { distance: 4 };
  assert.equal(cone.emit({ inst: { uid: 9 }, R, element: 'fire', spread: 0, mult: 1, forceCrit: true }), 1);
  near(cone.lastReach, 4);
  assert.equal(dealt[0][1].forceCrit, true);
  assert.ok(jets.some(j => j[5] === true), '隔跳一颗烟');
});

// ───────────── 贯虹虹光（RailgunBeam.cs） ─────────────

test('railgun beam: constants, rainbow, taper and helix match Unity RailgunBeam', async () => {
  const text = await cs('Weapons/RailgunBeam.cs');
  const c = csConsts(text);
  for (const k of ['Strands', 'Points', 'Life', 'Radius', 'Turns', 'SpinSpeed']) near(RAIL.RAILGUN_BEAM[k], c[k], k);
  assert.match(text, /width = Mathf\.Clamp\(width, 0\.02f, 0\.3f\)/);
  assert.match(text, /widthMultiplier = width \* 0\.55f \* \(1 - 0\.6f \* k\)/);
  assert.match(text, /Radius \* \(1 \+ 1\.5f \* k\)/);
  const B = RAIL.RAILGUN_BEAM;
  assert.deepEqual([B.WidthMin, B.WidthMax, B.WidthShare, B.WidthShrink, B.Spread], [0.02, 0.3, 0.55, 0.6, 1.5]);
  // 彩虹：色相 u、饱和 0.8、明度 1
  const rgb = RAIL.rainbow(0);
  near(rgb.r, 1); near(rgb.g, 0.2); near(rgb.b, 0.2);
  const g = RAIL.rainbow(1 / 3);
  near(g.g, 1); near(g.r, 0.2, '', 1e-5); near(g.b, 0.2, '', 1e-5);
  near(RAIL.rainbow(1.25).g, RAIL.rainbow(0.25).g, '按 1 取模');
  // 两端收拢
  assert.equal(RAIL.taper(0), 0);
  assert.equal(RAIL.taper(1), 0);
  near(RAIL.taper(1 / 16), 0.5);
  assert.equal(RAIL.taper(0.5), 1);
  // 螺旋：两端落在枪口 / 落点上；中段离弹道 = 半径 × (1 + 1.5k)
  const from = new THREE.Vector3(0, 1, 0), to = new THREE.Vector3(0, 1, -20), p = new THREE.Vector3();
  assert.ok(RAIL.strandPoint(from, to, 0, 0, 0.1, p).distanceTo(from) < 1e-6);
  assert.ok(RAIL.strandPoint(from, to, 2, 31, 0.1, p).distanceTo(to) < 1e-6);
  RAIL.strandPoint(from, to, 1, 16, 0, p);
  near(Math.hypot(p.x, p.y - 1), 0.05, '初始缠绕半径');
  RAIL.strandPoint(from, to, 1, 16, 0.19, p);
  near(Math.hypot(p.x, p.y - 1), 0.05 * (1 + 1.5 * 0.5), '一边散开');
  near(RAIL.beamFade(0), 1);
  near(RAIL.beamFade(0.38), 0);
  near(RAIL.strandWidth(0.1, 0), 0.055);
  near(RAIL.strandWidth(0.1, 0.38), 0.055 * 0.4);
  // 对象池：太短 / 非法的不出，播完回池
  const scene = new THREE.Scene();
  const beams = new RAIL.RailgunBeams(() => scene);
  assert.equal(beams.spawn(from, new THREE.Vector3(0, 1, -0.1), 0.05), false);
  assert.equal(beams.spawn(from, new THREE.Vector3(NaN, 0, 0), 0.05), false);
  assert.equal(beams.spawn(from, to, 0.05), true);
  beams.update(0.1, new THREE.Vector3(0, 1.6, 0));
  assert.equal(beams.live, 1);
  assert.equal(scene.children.length, 1);
  const pos = scene.children[0].geometry.getAttribute('position');
  assert.equal(pos.count, 3 * 32 * 2);
  assert.ok(Number.isFinite(pos.array.reduce((a, b) => a + b, 0)));
  beams.update(0.3, new THREE.Vector3(0, 1.6, 0));
  assert.equal(beams.live, 0);
  assert.equal(beams.spawn(from, to, 0.05), true);
  assert.equal(scene.children.length, 1, '回池复用');
  // 接线：满蓄命中扫描 → 虹光
  assert.match(await src('weapons/Firing.ts'), /this\.fullChargeFx\?\.\(_muzzle, _end, def\.tracerWidth\)/);
  assert.match(await cs('Weapons/Ballistics.cs'), /if \(s\.full\) RailgunBeam\.Spawn\(muzzle, end, s\.element/);
});

// ───────────── 施法姿势（CastPoseTests.cs） ─────────────

test('cast pose: keyframes are the Unity tables; every hero skill has a style', async () => {
  const text = await cs('Skills/CastPose.cs');
  for (const [name, style] of [['Throw', 'throw'], ['Summon', 'summon'], ['Slam', 'slam'], ['Raise', 'raise'], ['Mark', 'mark']]) {
    const block = text.slice(text.indexOf(`static readonly Key[] ${name} =`), text.indexOf('};', text.indexOf(`static readonly Key[] ${name} =`)));
    const rows = [...block.matchAll(/K\(([^)]+)\)/g)].map(m => m[1].split(',').map(v => parseFloat(v)));
    const mine = CAST.CAST_TIMELINES[style].map(k => [k.t, ...k.pos, ...k.rot]);
    assert.equal(mine.length, rows.length, name);
    for (let i = 0; i < rows.length; i++) for (let j = 0; j < 7; j++) near(mine[i][j], rows[i][j], `${name}[${i}][${j}]`);
  }
  for (const id of ['fox_blaze_grenade', 'fox_nine_tails', 'falcon_storm_beacon', 'falcon_hawk_verdict', 'bear_earth_splitter', 'bear_bastion']) {
    assert.notEqual(CAST.castStyleFor(id), 'none', id);
    assert.match(text, new RegExp(`"${id}"`));
  }
  assert.equal(CAST.castStyleFor('unknown_skill'), 'none');
  assert.deepEqual(['fox_blaze_grenade', 'falcon_storm_beacon', 'fox_nine_tails', 'bear_earth_splitter', 'bear_bastion', 'falcon_hawk_verdict'].map(CAST.castStyleFor),
    ['throw', 'throw', 'summon', 'slam', 'raise', 'mark']);
});

test('cast pose: timelines start and end at rest and stay short (Unity CastPoseTests)', () => {
  for (const style of ['throw', 'summon', 'slam', 'raise', 'mark']) {
    const keys = CAST.castTimeline(style);
    assert.ok(keys.length >= 3, `${style} 至少 3 个关键帧`);
    assert.deepEqual([...keys[0].pos], [0, 0, 0]);
    assert.deepEqual([...keys.at(-1).pos, ...keys.at(-1).rot], [0, 0, 0, 0, 0, 0]);
    assert.ok(keys.at(-1).t >= 0.3 && keys.at(-1).t <= 0.65, `${style} 0.3–0.65 s 放完`);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i].t > keys[i - 1].t);
    let maxPos = 0, maxRot = 0;
    const p = { x: 0, y: 0, z: 0 }, r = { x: 0, y: 0, z: 0 };
    for (let t = 0; t <= keys.at(-1).t + 0.05; t += 0.01) {
      CAST.evaluateCast(keys, t, p, r);
      maxPos = Math.max(maxPos, Math.hypot(p.x, p.y, p.z));
      maxRot = Math.max(maxRot, Math.hypot(r.x, r.y, r.z));
    }
    assert.ok(maxPos >= 0.02 && maxPos <= 0.13, `${style} 位移看得出、但枪不出画面（${maxPos}）`);
    assert.ok(maxRot < 0.6, `${style} 转角不超过 ~34°`);
    CAST.evaluateCast(keys, keys.at(-1).t + 0.01, p, r);
    assert.deepEqual([p.x, p.y, p.z, r.x, r.y, r.z], [0, 0, 0, 0, 0, 0]);
  }
  // 运行时：skill:used 触发、放完归零、新的打断旧的
  const handlers = {};
  const ctx = { time: { now: 5 }, events: { on: (name, fn) => { handlers[name] = fn; } } };
  const pose = new CAST.CastPose(ctx);
  handlers['skill:used']({ slot: 'secondary', skillId: 'bear_earth_splitter' });
  assert.equal(pose.playing, 'slam');
  ctx.time.now = 5.24;
  pose.update();
  near(pose.pos.y, -0.11, '砸到最低');
  near(pose.rot.x, -0.45);
  handlers['skill:used']({ slot: 'primary', skillId: 'bear_bastion' });
  assert.equal(pose.playing, 'raise');
  ctx.time.now += 0.6;
  pose.update();
  assert.equal(pose.playing, 'none');
  assert.deepEqual([pose.pos.x, pose.pos.y, pose.pos.z], [0, 0, 0]);
  handlers['skill:used']({ slot: 'primary', skillId: 'nope' });
  assert.equal(pose.playing, 'none');
});

test('cast pose overlays the viewmodel pose in the same convention as Unity OverlayPos / OverlayRot', async () => {
  const vm = await src('weapons/Viewmodel.ts');
  assert.match(vm, /x \+= s\.overlayPos\.x;\s*y \+= s\.overlayPos\.y;\s*z \+= s\.overlayPos\.z;/);
  assert.match(vm, /rx \+= s\.overlayRot\.x;\s*ry \+= s\.overlayRot\.y;\s*rz \+= s\.overlayRot\.z;/);
  assert.match(await src('weapons/WeaponSystem.ts'), /s\.overlayPos = cast \? cast\.pos : null;/);
  assert.match(await src('player/PlayerController.ts'), /this\.castPose = new CastPose\(ctx\);/);
});

// ───────────── 技能（HeroSkills / SkillFx / 三位英雄） ─────────────

test('skills: deny reasons, hand origin and hero numbers match Unity', async () => {
  const hero = await cs('Skills/HeroSkills.cs');
  near(csConsts(hero).DenyInterval, 0.35);
  const sc = await src('player/SkillController.ts');
  assert.match(sc, /const DENY_INTERVAL = 0\.35;/);
  for (const reason of ['cooldown', 'busy', 'failed']) assert.match(sc, new RegExp(`this\\.deny\\(s, slot, '${reason}'\\)`));
  assert.match(sc, /this\.ctx\.events\.emit\('skill:denied', \{ slot, skillId: s\.def\.id, reason \}\)/);
  assert.match(hero, /enum SkillDeny[\s\S]{0,400}Cooldown,[\s\S]{0,200}Busy,[\s\S]{0,200}Failed,/);
  // 手边出手点：右 0.24、下 0.2、前 0.45，贴墙停在墙前
  const fx = await cs('Skills/SkillFx.cs');
  assert.match(fx, /eye\.right \* \(0\.24f \* side\) - eye\.up \* 0\.2f \+ eye\.forward \* 0\.45f/);
  assert.match(fx, /Mathf\.Clamp\(radius, 0\.02f, 0\.3f\)/);
  assert.match(fx, /hit\.distance - 0\.02f/);
  const common = await src('player/skills/common.ts');
  assert.match(common, /HAND_ORIGIN = \{ Right: 0\.24, Down: 0\.2, Forward: 0\.45, RadiusMin: 0\.02, RadiusMax: 0\.3, Skin: 0\.02 \}/);
  assert.match(fx, /pv\.x \* 0\.35f/);
  assert.match(common, /p\.velocity\.x \* 0\.35/);
  assert.match(fx, /falloff = 0\.45f/);
  // 燎
  const liao = await cs('Skills/LiaoSkills.cs');
  const fox = await src('player/skills/fox.ts');
  const tsNum = (text, name) => Number(text.match(new RegExp(`const ${name} = (-?[\\d.]+);`))[1]);
  const gc = csConsts(liao.slice(liao.indexOf('class LiaoBlazeGrenade'), liao.indexOf('class LiaoNineTails')));
  const nc = csConsts(liao.slice(liao.indexOf('class LiaoNineTails')));
  near(tsNum(fox, 'EMBER_BONUS'), csConsts(liao).EmberBonus);
  assert.ok(liao.includes('const float Duration = 3, First = 0.3f, Interval = (Duration - First) / (Count - 1);'));
  assert.deepEqual([tsNum(fox, 'FOXFIRE_DURATION'), tsNum(fox, 'FOXFIRE_FIRST')], [3, 0.3]);
  for (const [a, b] of [['GRENADE_RADIUS', 'Radius'], ['GRENADE_DAMAGE', 'Damage'], ['GRENADE_SPEED', 'Speed'], ['GRENADE_LIFT', 'Lift'], ['GRENADE_GRAVITY', 'Gravity'],
    ['GRENADE_LIFETIME', 'Lifetime'], ['GRENADE_KNOCKBACK', 'Knockback']]) near(tsNum(fox, a), gc[b], a);
  for (const [a, b] of [['FOXFIRE_COUNT', 'Count'], ['FOXFIRE_DAMAGE', 'Damage'], ['FOXFIRE_SPEED', 'Speed'],
    ['FOXFIRE_HOMING', 'Homing'], ['FOXFIRE_RANGE', 'Range']]) near(tsNum(fox, a), nc[b], a);
  // 鼯
  const falconCs = csConsts(await cs('Skills/FalconSkills.cs'));
  const falcon = await src('player/skills/falcon.ts');
  for (const [a, b] of [['BEACON_RADIUS', 'Radius'], ['BEACON_INTERVAL', 'Interval'], ['BEACON_TARGETS', 'Targets'], ['BEACON_DAMAGE', 'Damage'], ['BEACON_TOP', 'Top'],
    ['BEACON_THROW_LIFETIME', 'ThrowLifetime'], ['HAWK_FIRE_RATE', 'FireRate'], ['HAWK_CHAIN_RANGE', 'ChainRange'], ['HAWK_CHAIN_RATIO', 'ChainRatio'], ['AIR_BONUS', 'AirBonus']]) {
    near(tsNum(falcon, a), falconCs[b], a);
  }
  assert.match(falcon, /req\.source !== 'status' && req\.source !== 'pet'/, '灵宠不吃凌空（Unity AirMultiplier）');
  assert.deepEqual([...falcon.matchAll(/cooldown: (\d+),\s*charges: (\d+)/g)].map(m => [Number(m[1]), Number(m[2])]), [[10, 2], [25, 1]]);
  assert.deepEqual([...fox.matchAll(/cooldown: (\d+),\s*charges: (\d+)/g)].map(m => [Number(m[1]), Number(m[2])]), [[8, 2], [20, 1]]);
});

test('bear: numbers, grounded-snap leap, dash lock and the bastion projectile ward match Unity BearSkills', async () => {
  const text = await cs('Skills/BearSkills.cs');
  const split = csConsts(text.slice(text.indexOf('class BearEarthSplitter'), text.indexOf('class BearBastion')));
  const bast = csConsts(text.slice(text.indexOf('class BearBastion')));
  const hide = csConsts(text.slice(0, text.indexOf('class BearThickHide')));
  const bear = await import(await ts('../src/player/skills/bear.ts', {
    './common': data(`export class EffectSession { constructor(f) { this.f = f; } begin() {} end() {} track() {} get active() { return false; } }
      export const SKILL_COLORS = { earth: 1, gold: 2 }; export function cancelDash() {} export function radiusScale() { return 1; } export function shockwave() { return 0; }`),
    '../../fx/extras': data('export function fxExtras() { return null; }'),
  }));
  const T = bear.BEAR_TUNING;
  for (const [a, b] of [['SLAM_RADIUS', 'Radius'], ['SLAM_DAMAGE', 'Damage'], ['SLAM_STUN', 'Stun'], ['SLAM_KNOCKBACK', 'Knockback'], ['SLAM_LIFT', 'Lift'], ['SLAM_FALLOFF', 'Falloff'],
    ['LEAP_FORWARD', 'LeapForward'], ['LEAP_UP', 'LeapUp'], ['SLAM_DOWN_SPEED', 'DownSpeed'], ['SLAM_EXTRA_GRAVITY', 'ExtraGravity'], ['SLAM_MIN_AIR', 'MinAir'],
    ['SLAM_MAX_LEAP', 'MaxLeap'], ['SLAM_AIR_KEEP', 'AirKeep'], ['SLAM_GROUND_SNAP', 'GroundSnap']]) near(T[a], split[b], a);
  for (const [a, b] of [['BASTION_DURATION', 'Duration'], ['BASTION_REDUCTION', 'Reduction'], ['BASTION_DAMAGE_PCT', 'DamagePct'], ['BASTION_WAVE_RADIUS', 'WaveRadius'],
    ['BASTION_WAVE_DAMAGE', 'WaveDamage'], ['BASTION_WAVE_KNOCKBACK', 'WaveKnockback'], ['BASTION_WAVE_LIFT', 'WaveLift'], ['BASTION_WAVE_FALLOFF', 'WaveFalloff'],
    ['BASTION_WARD_RADIUS', 'WardRadius'], ['BASTION_WARD_HEIGHT', 'WardHeight']]) near(T[a], bast[b], a);
  for (const [a, b] of [['HIDE_REGEN_DELAY', 'HideRegenDelay'], ['HIDE_WAVE_RADIUS', 'HideWaveRadius'], ['HIDE_WAVE_DAMAGE', 'HideWaveDamage'], ['HIDE_WAVE_ICD', 'HideWaveIcd'],
    ['HIDE_WAVE_KNOCKBACK', 'HideWaveKnockback'], ['HIDE_WAVE_LIFT', 'HideWaveLift']]) near(T[a], hide[b], a);
  // 按地面起跳：踩着地面，或脚下 0.35 m 内有地面且竖直速度在 −2…0.5 m/s
  assert.equal(bear.slamFromGround(true, -9, 99), true);
  assert.equal(bear.slamFromGround(false, 0, 0.2), true, '被敌人胶囊顶起一点');
  assert.equal(bear.slamFromGround(false, -1.9, 0.35), true);
  assert.equal(bear.slamFromGround(false, -2.1, 0.1), false, '真正在下落：立即下砸');
  assert.equal(bear.slamFromGround(false, 0.6, 0.1), false, '刚起跳');
  assert.equal(bear.slamFromGround(false, 0, 0.5), false);
  assert.equal(bear.slamFromGround(false, 0, -1), false, '脚下没有地面');
  const mine = await src('player/skills/bear.ts');
  assert.match(mine, /slamSession\.track\(lock\.call\(p\)\)/, '跃起期间锁冲刺');
  assert.match(text, /fr\.locks \|= MotorLock\.Dash;/);
  assert.match(mine, /shape: 'sphere'/);
  assert.match(text, /ward\.shape = ProjectileWard\.Shape\.Sphere;\s*ward\.radius = WardRadius;/);
  assert.match(mine, /ctx\.fx\.burst\(_c, SKILL_COLORS\.gold, 8, 2\.5, 0\.3, 0\.05, 0\);\s*ctx\.audio\.play\('hit_armor', \{ position: _c, volume: 0\.6, pitch: 1\.2 \}\)/);
  assert.match(text, /SkillFx\.Burst\(point, SkillFx\.Gold, 8, 2\.5f, 0\.3f, 0\.05f\);\s*GameAudio\.PlayAt\("hit_armor", point, 0\.6f, 1\.2f\);/);
  assert.match(await src('player/PlayerController.ts'), /this\.dashLockout <= 0 && this\.dashLocks <= 0\)/);
});
