// 鲲鹏（boss_kunpeng）对照测试：照 Unity EditMode 的 KunPengTests.cs 逐条改写（同样的输入、同样的断言数）。
// 没迁的两条：EnemyBodyRebind（Unity 组件，网页换形是 kun_host / peng_host 显隐，见 frost-boss.test.mjs）、
// KeyframedClips_EventsLandOnTheMoveTimeline（M12 第二期导出手 K 片段后改在 tests/anim-keyframed.test.mjs 里对照）。
// 另加：从 Unity 场景的水体反推冰窟（2-4 的北冥海 → 15 / 44 / 0.06）。
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importTs } from './hanba-load.mjs';

const { KunPengDef, KunPengMath, KunPengBalance } = await importTs('../src/enemies/bosses/KunPengDef.ts');
const Plans = await importTs('../src/enemies/bosses/KunPengPlans.ts');
const { IceHoleInfo, holeFromWater, DEFAULT_OUTER } = await importTs('../src/enemies/bosses/KunPengArena.ts');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const def = () => new KunPengDef();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const deltaAngle = KunPengMath.deltaAngle;

// ───────────── 定义 ─────────────

test('Def_Validates_TwoForms_SwapAtHalf：两个形态、50% 换形、4.6 s 演出 1.55 s 换模型、鹏重凝六成护盾、第一招狂风', () => {
  const d = def();
  assert.deepEqual(d.validate(), []);
  assert.equal(d.id, 'boss_kunpeng');
  assert.equal(d.forms.length, 2);
  assert.equal(d.firstForm.id, KunPengDef.KunForm);
  assert.ok(!d.firstForm.flying, '鲲不是飞行形态（钉在冰窟里）');
  const peng = d.form(KunPengDef.PengForm);
  assert.ok(peng);
  assert.equal(peng.flying, true, '鹏是飞行形态');
  near(peng.shieldRestore, 0.6, 1e-4, '化鹏后护盾重凝六成');
  assert.equal(peng.firstMove, Plans.PengGust.id, '鹏的第一招是扇翼狂风');
  assert.equal(d.firstForm.weakBone, 'pearl');
  assert.equal(peng.weakBone, 'pearl');
  assert.equal(d.phases.length, 1);
  const ph = d.phases[0];
  near(ph.at, 0.5, 1e-4);
  assert.equal(ph.form, KunPengDef.PengForm);
  near(ph.seconds, 4.6, 1e-4);
  near(ph.formSwapAt, 1.55, 1e-4, '冰雾最浓的一刻换模型');
  assert.equal(d.stunBetweenMoves, false, '元素眩晕不生效');
  assert.equal(d.summonCap, 0, '不召小怪');
});

test('BarTicks_AreFuryFormAndRage：血条刻度 75% 鲲怒、50% 化鹏、25% 鹏狂怒', () => {
  assert.deepEqual([...def().barTicks], [0.75, 0.5, 0.25]);
});

test('Moves_BelongToTheirForm_AndKeepThreeJsDurations：八招的形态归属、Three.js 时长、冷却 / 首次可用延迟', () => {
  const moves = Object.fromEntries(def().moves.map(m => [m.id, m]));
  assert.deepEqual(Object.keys(moves).sort(), ['dive', 'gust', 'inhale', 'perch', 'rain', 'slam', 'spit', 'swoop']);
  for (const id of ['inhale', 'slam', 'dive', 'spit']) assert.deepEqual(moves[id].forms, [KunPengDef.KunForm], id);
  for (const id of ['gust', 'swoop', 'rain', 'perch']) assert.deepEqual(moves[id].forms, [KunPengDef.PengForm], id);
  const total = id => moves[id].windup + moves[id].active + moves[id].recover;
  near(total('inhale'), 4.6, 1e-3);
  near(total('slam'), 2.5, 1e-3);
  near(total('dive'), 3.0, 1e-3);
  near(total('spit'), 1.3, 1e-3);
  near(total('gust'), 5.8, 1e-3);
  near(total('rain'), 0.9 + 10 * 0.11 + 0.6, 1e-3);
  assert.equal(moves.inhale.cooldown, 11);
  assert.equal(moves.dive.firstDelay, 6);
  assert.equal(moves.perch.cooldown, 14);
  assert.equal(moves.perch.firstDelay, 10);
});

// ───────────── 定档 / 击杀用时 ─────────────

test('Vitals_TierAtStageDifficulty：2-4 定档 16000 + 4800，难度 1 按难度等比折回', () => {
  const v = def().vitalsAt(KunPengDef.StageDifficulty);
  near(v.hp, KunPengDef.TierHp, 0.5);
  near(v.shield, KunPengDef.TierShield, 0.5);
  near(def().vitalsAt(1).hp, KunPengDef.TierHp / KunPengDef.StageDifficulty, 1, '难度 1 = 定档按难度等比折回');
});

test('KillTime_AtReferenceDps_IsWithin60To120s：参考秒伤 ±15% 都在 60–120 s，比 Three.js 原值 × 难度长', () => {
  const d = def();
  const dps = KunPengBalance.referenceDps;
  near(dps, 405 * 0.8, 0.5, '章末参考秒伤 = 2-4 浸泡实测 × 0.8 命中率');
  const t = KunPengBalance.killSeconds(d, KunPengDef.StageDifficulty, dps);
  console.log(`参考秒伤 ${dps.toFixed(0)} 下击杀用时 ${t.toFixed(1)} s`);
  assert.ok(t >= 60 && t <= 120, `参考秒伤 ${dps.toFixed(0)} 下击杀用时 ${t.toFixed(0)} s`);
  for (const k of [0.85, 1.15]) {
    const tk = KunPengBalance.killSeconds(d, KunPengDef.StageDifficulty, dps * k);
    assert.ok(tk >= 60 && tk <= 120, `秒伤 × ${k} 下击杀用时 ${tk.toFixed(0)} s`);
  }
  near(KunPengBalance.effectiveHp(d, KunPengDef.StageDifficulty), KunPengDef.TierHp + KunPengDef.TierShield * 1.6, 1);
  near(KunPengBalance.untargetableSeconds(d), 3 + 4.6 + 3 * 1.5, 1e-3);
  // Three.js 原值 × 难度在浸泡实测的参考秒伤下不到 60 s（I3 重定档的理由）
  const ts = (4000 + 1200 * 1.6) * KunPengDef.StageDifficulty / dps + KunPengBalance.untargetableSeconds(d);
  assert.ok(ts < t, '定档比 Three.js 原值 × 难度长');
  assert.ok(ts < 60, `Three.js 原值 × 难度 ${ts.toFixed(0)} s`);
});

// ───────────── 平切口 ─────────────

test('CutCeiling_MatchesThreeJsFormula：前倾 / 后仰 / 侧倾时整只往下沉，切口一圈最高点正好在水面下 0.3 m', () => {
  near(KunPengMath.cutCeiling(0, 0), -0.3, 1e-5, '不俯仰：切口在水面下 0.3 m');
  near(KunPengMath.cutCeiling(0.42, 0), -0.3 - 1.3 * 3 * Math.sin(0.42), 1e-4);
  near(KunPengMath.cutCeiling(-0.25, 0), -0.3 - 1.3 * 2.8 * Math.sin(0.25), 1e-4);
  near(KunPengMath.cutCeiling(0, -0.03), -0.3 - 1.3 * 2.8 * Math.sin(0.03), 1e-4);
  assert.ok(KunPengMath.cutCeiling(0.42, 0) < KunPengMath.cutCeiling(0.2, 0), '越前倾越要往下沉');
  for (const pitch of [-0.25, 0, 0.35, 0.42]) {
    const y = KunPengMath.cutCeiling(pitch, 0);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0));
    const top = Math.max(...KunPengMath.CutRim.map(([x, z]) => V(x, 0, z).applyQuaternion(q).multiplyScalar(KunPengDef.KunScale).y)) + y;
    assert.ok(top <= -0.3 + 1e-3, `俯仰 ${pitch}：切口最高点 ${top.toFixed(3)}`);
  }
});

// ───────────── 冰窟几何 ─────────────

test('IceHole_PointAngleRoundTrip_ClampToRing_Fallback：方位 / 圆周点 / 夹到环台 / 虚拟冰窟', () => {
  const h = new IceHoleInfo(V(10, 2, -5), 15, 44, 2.06, true);
  for (const yaw of [0, 37, 90, -120, 179]) {
    const p = h.point(yaw, 20);
    near(p.y, 2, 1e-5, '圆周点在环台地面');
    near(h.distance(p), 20, 1e-3);
    near(deltaAngle(yaw, h.angle(p)), 0, 1e-3, `方位 ${yaw}`);
  }
  near(h.midRing, 29.5, 1e-4);
  const inner = h.clampToRing(h.point(60, 3));
  near(h.distance(inner), 16, 1e-3);
  near(h.angle(inner), 60, 1e-2);
  near(h.distance(h.clampToRing(h.point(200, 80))), 42.5, 1e-3);
  near(h.distance(h.clampToRing(h.point(10, 25))), 25, 1e-3, '环台上的点不动');
  assert.ok(h.overHole(h.point(0, 14.9)));
  assert.ok(!h.overHole(h.point(0, 15.1)));
  const fb = IceHoleInfo.fallback(null, null, V(1, 0, 1));
  assert.equal(fb.found, false);
  near(fb.radius, IceHoleInfo.FallbackRadius, 1e-5);
  assert.ok(fb.outer > fb.radius + 2);
  near(fb.waterY - fb.floorY, IceHoleInfo.DefaultWaterLevel, 1e-5);
});

test('HoleFromWater：2-4 的北冥海水块（32 × 6.06 × 32，中心 y −2.97）反推出 Unity 冰窟标记的 15 / 44 / 水面 0.06', () => {
  const sea = { name: 'Beiming Sea', center: V(0, -2.97, 0), scale: V(32, 6.06, 32) };
  const h = holeFromWater([sea], V(0, 0.24, 17), 44);
  assert.ok(h && h.found);
  near(h.radius, 15, 1e-4);
  near(h.outer, 44, 1e-4);
  near(h.waterY, 0.06, 1e-4);
  near(h.floorY, 0, 1e-4);
  assert.equal(holeFromWater([sea], V(200, 0, 0), 44), null, '离首领太远的水不算');
  assert.equal(holeFromWater([{ ...sea, scale: V(80, 2, 10) }], V(0, 0, 0), 44), null, '长条水（河）不算');
  near(holeFromWater([sea], V(0, 0, 0), null).outer, DEFAULT_OUTER, 1e-4, '没有首领场半径时取 IceHole 的缺省外缘');
});

test('SwoopLine_StaysOnTheRing_AlongTheTangent_ThroughThePlayersBearing：两端在环台上、沿切线、过玩家方位', () => {
  const h = new IceHoleInfo(V(0, 0, 0), 15, 44, 0.06, true);
  for (const yaw of [0, 75, 190, 300]) for (const r of [10, 18, 30, 43]) for (const side of [-1, 1]) {
    const player = h.point(yaw, r);
    const { from, yaw: lineYaw, length: len } = KunPengMath.swoopLine(h, player, side);
    const to = from.clone().add(KunPengMath.dir(lineYaw).multiplyScalar(len));
    assert.ok(len <= 32 + 1e-3);
    assert.ok(h.distance(from) <= h.outer - 3 + 0.05, '起点在外缘内 3 m');
    assert.ok(h.distance(to) <= h.outer - 3 + 0.05, '终点在外缘内 3 m');
    const mid = from.clone().add(to).multiplyScalar(0.5);
    near(deltaAngle(yaw, h.angle(mid)), 0, 0.05);
    near(h.distance(mid), Math.min(h.outer - 4, Math.max(h.radius + 3, r)), 1e-2);
    near(Math.abs(deltaAngle(h.angle(mid), lineYaw)), 90, 1e-2);
    for (let i = 0; i <= 10; i++) assert.ok(h.distance(from.clone().lerp(to, i / 10)) > h.radius + 2.9);
  }
});

test('SwoopSide_ComesFromTheBirdsEnd_SoAPillarBetweenThemLiesOnTheLineBeforeThePlayer：从鹏那一头进场，夹在中间的柱子在玩家之前', () => {
  const h = new IceHoleInfo(V(0, 0, 0), 15, 44, 0.06, true);
  const flat = v => Math.hypot(v.x, v.z);
  for (const yaw of [0, 75, 190, 300]) for (const sign of [-1, 1]) {
    const player = h.point(yaw, 28);
    const bird = h.point(yaw + sign * 40, h.midRing).add(V(0, 13.5, 0));
    const side = KunPengMath.swoopSide(h, player, bird, 1);
    const { from, yaw: lineYaw, length: len } = KunPengMath.swoopLine(h, player, side);
    const dir = KunPengMath.dir(lineYaw);
    const to = from.clone().add(dir.clone().multiplyScalar(len));
    assert.ok(flat(from.clone().sub(bird)) < flat(to.clone().sub(bird)), '从鹏那一头进场');
    const pillar = h.point(yaw + sign * 10, 28 / Math.cos(10 * Math.PI / 180));
    near(pillar.clone().sub(from).dot(V(dir.z, 0, -dir.x)), 0, 0.05, '柱心在线上');
    assert.ok(pillar.clone().sub(from).dot(dir) < player.clone().sub(from).dot(dir), '柱子在玩家之前');
  }
  const p = h.point(30, 28);
  assert.equal(KunPengMath.swoopSide(h, p, p.clone().add(V(0, 13, 0)), 1), 1);
  assert.equal(KunPengMath.swoopSide(h, p, p.clone().add(V(0, 13, 0)), -1), -1);
});

test('TrimSwoop_KeepsLures_PullsUpBeforeWallsBehindThePlayer：引撞不截，玩家身后的陡面截到前 8 m、至少过玩家 3 m', () => {
  const inf = Infinity;
  near(KunPengMath.trimSwoop(32, 16, inf, 8, 3), 32, 1e-4);
  assert.equal(KunPengMath.swoopLured(32, 16, inf), false);
  near(KunPengMath.trimSwoop(32, 16, 10, 8, 3), 32, 1e-4);
  assert.equal(KunPengMath.swoopLured(32, 16, 10), true);
  near(KunPengMath.trimSwoop(32, 16, 30, 8, 3), 22, 1e-4);
  assert.equal(KunPengMath.swoopLured(32, 16, 30), false);
  near(KunPengMath.trimSwoop(32, 16, 20, 8, 3), 19, 1e-4);
  near(KunPengMath.trimSwoop(32, 16, 32, 8, 3), 32, 1e-4);
  assert.equal(KunPengMath.swoopLured(32, 16, 40), false);
});

// ───────────── 潜袭的沉浮 ─────────────

test('DiveSunk_UnderwaterUntilBreach_FullyOutAtTheBite：破水前整只在水下，扑咬那一帧完全出水', () => {
  const D = Plans.KunDive;
  const frame = 1 / 30;
  near(D.sunkAt(D.SinkFrom), 0, 1e-4, '起手那一抽露在水面上');
  near(D.sunkAt(D.SinkTo), 1, 1e-4, '0.8 s 沉到底');
  near(D.sunkAt(D.BreachAt - 0.01), 1, 1e-4, '破水前整只在水下');
  assert.ok(D.RelocateAt < D.BreachAt - D.DomeLead + 1e-4, '换位不晚于水面隆起');
  assert.ok(D.sunkAt(D.BreachAt + 0.15) < 0.2, '破水 0.15 s 后头已经出水');
  near(D.sunkAt(D.spec.windup - frame), 0, 1e-4, '扑咬（出手）前一帧整只出水');
});

test('Rain_RageFeathersStayWithinOneFrameOfTheShedLoop：狂怒 14 枚 × 0.11 s 与 4 枚一圈的 13 帧循环差不到 1 帧', () => {
  const R = Plans.PengFeatherRain;
  near(R.RageFeathers * R.Interval, R.RageFeathers / 4 * (13 / 30), 1 / 30);
  near(R.spec.active, R.Feathers * R.Interval, 1e-6);
});
