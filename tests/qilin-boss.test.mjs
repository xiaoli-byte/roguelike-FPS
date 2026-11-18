// 火麒麟（boss_qilin）的对照测试：照 Unity EditMode 的 QilinTests（定义、定档、炉心殿几何、玄鳞 / 焚身招式时间轴、熔流带、吐息计划）
// 和 BalanceModelTests.ReferenceCurve_MatchesQilinAnchor 逐条改写，同样的输入、同样的断言数。纯数据模块，不碰场景。
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importTs } from './hanba-load.mjs';

const Q = await importTs('../src/enemies/bosses/QilinDef.ts');
const F = await importTs('../src/enemies/bosses/QilinFurnace.ts');
const { HanbaDef } = await importTs('../src/enemies/bosses/HanbaDef.ts');
const { QilinDef, ScaleGallop, ScaleBlades, ScaleBreath, ScaleDrink, BurnFlood, BurnDives, BurnPant, BurnSweep, BurnRain, BurnRage } = Q;
const { QilinFurnace, FLOOD, floodStrips, inStrip, sweepPlan, deltaAngle } = F;

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const inRange = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg ?? ''} ${v} 不在 [${lo}, ${hi}]`);
const RAD = 180 / Math.PI;

test('Def_Validates_TicksFormsAndMoves：血条刻度 85 / 70 / 55，两个形态与各自的招式，焚身第一招熔流轮转', () => {
  const def = new QilinDef();
  assert.deepEqual(def.validate(), []);
  assert.equal(def.id, QilinDef.Id);
  assert.ok(def.id.startsWith('boss'));
  assert.deepEqual([...def.barTicks], [0.85, 0.7, QilinDef.TransformAt], '血条刻度 = 两道饮熔线 + 换形');
  assert.equal(def.phaseCount, 2);
  assert.equal(def.phases[0].form, QilinDef.BurnForm, '55% 换焚身');
  near(def.phases[0].formSwapAt, 1.9, 1e-4, '熔岩柱最浓时换模型');
  assert.equal(def.firstForm.prefab, QilinDef.XuanPrefab);
  assert.equal(def.form(QilinDef.BurnForm).prefab, QilinDef.BurnPrefab);
  assert.equal(def.firstForm.weakBone, 'pearl', '角根火珠是弱点');
  assert.equal(def.element, 'fire');
  const moves = Object.fromEntries(def.moves.map(m => [m.id, m]));
  for (const id of [ScaleGallop.id, ScaleBlades.id, ScaleBreath.id, ScaleDrink.id]) assert.deepEqual(moves[id].forms, [QilinDef.XuanForm], `${id} 只在玄鳞`);
  const burnIds = [BurnFlood.id, BurnDives.id, BurnPant.id, BurnSweep.id, BurnRain.id, BurnRage.id];
  for (const id of burnIds) assert.deepEqual(moves[id].forms, [QilinDef.BurnForm], `${id} 只在焚身`);
  assert.equal(def.moves.length, 4 + burnIds.length, '玄鳞四招 + 焚身六招');
  assert.equal(moves[ScaleDrink.id].weight, 0, '饮熔只由血量线排上');
  assert.equal(moves[BurnPant.id].weight, 0, '喘息只由俯冲三踏排上');
  assert.equal(moves[BurnRage.id].weight, 0, '狂怒长啸只由 15% 排上');
  assert.equal(def.form(QilinDef.BurnForm).firstMove, BurnFlood.id, '换形后第一招熔流轮转');
  assert.equal(def.form(QilinDef.BurnForm).flying, true, '焚身踏云：飞行形态');
  assert.ok(!def.firstForm.flying);
  const heart = QilinDef.HitZones.find(z => z.id === 'heart');
  assert.equal(heart.weak, true);
  assert.equal(heart.form, QilinDef.BurnForm, '胸口火心只在焚身');
  near(def.enrageBelow, 0.15, 1e-4);
  near(def.phases[0].restScale, 0.9, 1e-4);
  near(def.phases[0].restScale * def.enrageRestScale, 0.65, 0.01, 'TS restFactor：焚身 0.9，狂怒 0.65');
});

test('Balance_KillTimeWithinBand_AtStageDifficulty：28000 + 2400 护甲，砸中两次 / 一次 / 零次都在 60–120 s', () => {
  const def = new QilinDef();
  const v = def.vitalsAt(QilinDef.StageDifficulty);
  near(v.hp, QilinDef.TierHp, 0.5);
  near(v.armor, QilinDef.TierArmor, 0.5);
  near(v.shield, 0, 1e-3);
  near(def.vitals.hp, 9090, 1e-6, '难度 1 参考值（定档表优先，难度 1 时 = 定档 ÷ 3.08）');
  near(def.vitals.armor, 780, 1e-6);
  near(def.vitalsAt(1).hp, QilinDef.TierHp / QilinDef.StageDifficulty, 1e-6);
  const dps = QilinDef.referenceDps(QilinDef.StageDifficulty);
  near(dps, Q.BalanceModel.referenceDps(QilinDef.StageDifficulty), 0.01, '火麒麟的定档曲线就是 I3 参考曲线');
  inRange(dps / (Q.soakDps('3-4') * Q.BalanceModel.Uptime), 0.9, 1.1, '参考曲线和 3-4 浸泡实测 × 输出率对得上');
  const two = QilinDef.estimateKillSeconds(v, dps, 2), one = QilinDef.estimateKillSeconds(v, dps, 1), none = QilinDef.estimateKillSeconds(v, dps, 0);
  console.log(`参考秒伤 ${dps.toFixed(0)}：砸中两次 ${two.toFixed(0)} s / 一次 ${one.toFixed(0)} s / 零次 ${none.toFixed(0)} s`);
  inRange(two, 60, 120, '砸中两次');
  inRange(one, 60, 120, '砸中一次');
  inRange(none, 60, 120, '一次都不打');
  assert.ok(two < one, '打锁扣砸鼎要有收益');
  assert.ok(one < none);
  const factor = QilinDef.burnDpsFactor();
  inRange(factor, 0.75, 1.05, '焚身输出折算');
  const phase2 = v.hp * QilinDef.TransformAt / (dps * factor);
  inRange(phase2, 25, 55, '二阶段');
  const bare = { hp: v.hp, shield: 0, armor: 0 };
  const expect = v.hp * (1 - QilinDef.TransformAt) / dps + QilinDef.TransitionSeconds + phase2;
  near(QilinDef.estimateKillSeconds(bare, dps, 0), expect, 0.01, '没有护甲时 = 一阶段 + 换形演出 + 二阶段');
  const rot = QilinDef.burnRotation();
  inRange(rot.seconds, 18, 32, '焚身一轮');
  near(rot.pantSeconds, BurnPant.Rest, 1e-4, '一轮里落地喘息 3.5 s');
  assert.ok(rot.crowSeconds > 0);
  // Three.js 原值（5000 + 1500 护甲 × 难度）：打不打锁扣的差距比定档更大
  const d = QilinDef.StageDifficulty;
  const ts = { hp: 5000 * d, shield: 0, armor: 1500 * d };
  assert.ok(QilinDef.estimateKillSeconds(ts, dps, 0) - QilinDef.estimateKillSeconds(ts, dps, 2) > none - two, 'Three.js 的护甲下差距更大');
  // 锁扣：110 × 难度，一两秒打得碎
  const lockHp = Q.LOCK_BASE_HP * d;
  inRange(lockHp / dps, 0.5, 3, '锁扣');
  // 旱魃那一档也用同一个模型校一下
  inRange((HanbaDef.TierHp + HanbaDef.TierShield) / QilinDef.referenceDps(1.48), 60, 120, '旱魃');
});

test('ReferenceCurve_MatchesQilinAnchor：参考曲线 = 90 ×（1 + 1.15 ×（难度 − 1））× 1.6 × 0.8', () => {
  near(QilinDef.referenceDps(QilinDef.StageDifficulty), Q.BalanceModel.referenceDps(QilinDef.StageDifficulty), 0.01);
  near(Q.BalanceModel.referenceDps(3.08), 90 * (1 + 1.15 * 2.08) * 1.6 * 0.8, 1e-6);
  near(Q.BalanceModel.referenceDps(0.5), 90 * 1.6 * 0.8, 1e-6, '难度低于 1 按 1');
});

test('Furnace_Quadrants_ClockwiseAndChannels：象限中线西 / 北 / 东 / 南，顺时针 = 方位递增，渠与窄桥', () => {
  const f = new QilinFurnace(new THREE.Vector3());
  assert.equal(f.quadrantCount, 4);
  near(f.quadrantYaw(0), -90, 1e-3);
  near(f.quadrantYaw(1), 0, 1e-3);
  near(f.quadrantYaw(2), 90, 1e-3);
  near(Math.abs(f.quadrantYaw(3)), 180, 1e-3);
  assert.equal(f.quadrantOf({ x: 2, z: 15 }), 1, '北');
  assert.equal(f.quadrantOf({ x: 15, z: -3 }), 2, '东');
  assert.equal(f.quadrantOf({ x: -1, z: -15 }), 3, '南');
  assert.equal(f.quadrantOf({ x: -15, z: 1 }), 0, '西');
  assert.equal(f.clockwiseNext(1), 2);
  assert.equal(f.clockwiseNext(2), 3);
  assert.equal(f.clockwiseNext(3), 0);
  assert.equal(f.clockwiseNext(0), 1);
  assert.ok(f.onChannel(f.point(45, 19)));
  assert.ok(f.onChannel(f.point(45, 8)));
  assert.ok(!f.onChannel(f.point(45, 12)), '窄桥');
  assert.ok(!f.onChannel(f.point(0, 19)));
  assert.ok(!f.onChannel(f.point(45, 5)), '熔池里不算渠');
  const p = f.point(-60, 17);
  near(f.yawOf(p), -60, 1e-3);
  near(f.radiusOf(p), 17, 1e-3);
  // 3-4：炉口 ±72°、排烟口 ±110° 离地 12 m
  const l34 = QilinFurnace.level34(new THREE.Vector3(0, 0, 0));
  assert.equal(l34.mouths.length, 2);
  assert.equal(l34.vents.length, 2);
  near(Math.abs(l34.yawOf(l34.mouths[0])), 72, 1e-3);
  near(l34.vents[1].y, 12, 1e-6);
  near(l34.trackRadius, 20.8, 1e-6);
});

test('Moves_TimingMatchesThreeJs：张鳞 / 麟火 / 奔驰 / 饮熔的时间轴', () => {
  near(ScaleBlades.spec.windup, 1, 1e-4, '人立 1 s');
  assert.equal(ScaleBlades.Count, 36);
  near(ScaleBlades.SecondDelay, 0.4, 1e-4, '85% 以下 0.4 s 后第二圈');
  near(ScaleBreath.spec.windup, 0.8, 1e-4);
  near(ScaleBreath.spec.active, 1.6, 1e-4);
  near(ScaleGallop.spec.cooldown, 9, 1e-4);
  near(ScaleDrink.spec.windup, 1, 1e-4, '1 s 跃向池边');
  const def = new QilinDef();
  near(def.drinkSeconds, 4, 1e-4);
  near(QilinDef.StunSeconds, 4, 1e-4);
  near(QilinDef.CrackTakenMult, 2, 1e-4);
  near(def.phases[0].seconds, 5.2, 1e-4, '换形演出 5.2 s');
});

test('BurnMoves_TimingMatchesThreeJs：俯冲 / 喘息 / 吐息 / 熔流 / 火云雨', () => {
  assert.equal(BurnDives.Count, 3);
  near(BurnDives.Tele, 0.9, 1e-4);
  near(BurnDives.TeleRage, 0.7, 1e-4);
  near(BurnDives.DiveTime, 0.3, 1e-4);
  near(BurnDives.LandRecover, 0.45, 1e-4);
  near(BurnDives.Radius, 4.2, 1e-4);
  near(BurnDives.BlastDamage, 30, 1e-4);
  near(BurnDives.RingDamage, 16, 1e-4);
  near(BurnDives.spec.cooldown, 10, 1e-4);
  near(BurnDives.spec.weight, 2.8, 1e-4);
  near(BurnPant.spec.windup, 0.8, 1e-4);
  near(BurnPant.spec.active, 3.5, 1e-4);
  near(BurnPant.spec.recover, 0.7, 1e-4);
  assert.ok(BurnPant.TakeoffWarn >= 0.5);
  near(BurnSweep.spec.active, 1.2 + 2.6 + 0.3, 1e-4);
  near(BurnSweep.HalfBeam, 0.15 * RAD, 0.05);
  near(BurnSweep.TickDamage, 9, 1e-4);
  near(BurnSweep.spec.cooldown, 10, 1e-4);
  near(BurnFlood.spec.cooldown, 34, 1e-4);
  near(BurnFlood.OpenAt, 1.2, 1e-4);
  near(FLOOD.WarnSeconds, 1.5, 1e-4);
  near(FLOOD.OnSeconds, 6, 1e-4);
  near(FLOOD.OnSecondsRage, 4, 1e-4);
  near(FLOOD.FloodWidth, 4, 1e-4);
  assert.ok(4 * (FLOOD.WarnSeconds + FLOOD.OnSeconds + FLOOD.GapSeconds) <= BurnFlood.spec.cooldown + BurnFlood.OpenAt, '一轮不长于冷却');
  assert.equal(BurnRain.Meteors, 10);
  assert.equal(BurnRain.MeteorsRage, 14);
  near(BurnRain.Every, 0.16, 1e-4);
  near(BurnRain.Damage, 18, 1e-4);
  near(BurnRain.spec.cooldown, 13, 1e-4);
  near(BurnRain.spec.windup + BurnRain.spec.active + BurnRain.spec.recover, 2.6, 1e-4, 'TS 2.6 s 收招');
  assert.equal(new QilinDef().rainCrows, 4);
  near(Q.SKY.Alt, 4.5, 1e-4);
  near(Q.SKY.High, 7.5, 1e-4);
});

/** 3-4 的炉心殿几何（Level_3_4：熔池 7、殿墙 24、窄桥 10–14、渠半宽 0.8、渠在对角线） */
const furnace34 = () => QilinFurnace.level34(new THREE.Vector3(0, 0, 0));

test('Flood_Strips_HugChannelsOnQuadrantSide：每个象限两条熔流带贴着夹住它的两条渠、只淹外段、不压象限中线', () => {
  const f = furnace34();
  for (let q = 0; q < f.quadrantCount; q++) {
    const strips = floodStrips(f, q);
    assert.equal(strips.length, 2, `象限 ${q} 两条熔流带`);
    assert.deepEqual(strips.map(s => s.channel).sort(), [q, (q + 1) % 4].sort(), '贴着夹住象限的两条渠');
    for (const s of strips) {
      assert.equal(f.quadrantOf(s.center), q, `象限 ${q} 的熔流带中心落在这个象限里`);
      near(s.yaw, f.channelYaws[s.channel], 1e-3, '熔流带顺着渠');
      near(s.size.x, FLOOD.FloodWidth - 2 * f.channelHalfWidth + FLOOD.Overlap, 1e-3);
      assert.ok(f.radiusOf(s.from) > f.bridgeOuter, '窄桥不淹');
      assert.ok(f.radiusOf(s.center) + s.size.y * 0.5 > f.wallRadius, '一直淹到殿墙');
      const a = s.yaw / RAD;
      const ax = Math.sin(a), az = Math.cos(a);
      let ox = s.center.x - f.center.x, oz = s.center.z - f.center.z;
      const along = ox * ax + oz * az;
      ox -= ax * along;
      oz -= az * along;
      near(Math.hypot(ox, oz), (f.channelHalfWidth - FLOOD.Overlap + FLOOD.FloodWidth - f.channelHalfWidth) * 0.5, 1e-3);
      assert.ok(!inStrip(s, f.point(f.quadrantYaw(q), 19)), '象限中线上不淹');
      assert.ok(inStrip(s, s.center));
    }
    const prev = (q + 3) % 4;
    for (const s of strips) assert.ok(!inStrip(s, f.point(f.quadrantYaw(prev), 19)), '也不压隔壁象限的中线');
  }
});

test('Sweep_Plan_FromFarBankAcrossWholeQuadrant：对岸落点、从离玩家远的那条渠扫起、扫满整个象限', () => {
  const f = furnace34();
  const yawFrom = (from, to) => Math.atan2(to.x - from.x, to.z - from.z) * RAD;
  for (let q = 0; q < f.quadrantCount; q++) {
    const qy = f.quadrantYaw(q);
    const player = f.point(qy + 25, 18);
    const { spot, yaw0: y0, yaw1: y1, range } = sweepPlan(f, q, player);
    near(f.radiusOf(spot), f.poolRadius + BurnSweep.SpotOut, 1e-3, '落在熔池外 2.2 m');
    near(deltaAngle(qy + 180, f.yawOf(spot)), 0, 1e-3, '落在对岸');
    const span = Math.abs(deltaAngle(y0, y1));
    inRange(span, 55, 80, `象限 ${q} 扫的角度`);
    const a = f.point(f.channelYaws[q], f.wallRadius - 1);
    const b = f.point(f.channelYaws[(q + 1) % 4], f.wallRadius - 1);
    const ya = yawFrom(spot, a), yb = yawFrom(spot, b);
    near(deltaAngle(y0, ya), 0, 1e-3, '从离玩家远的那条渠扫起');
    near(deltaAngle(y1, yb), 0, 1e-3, '扫到玩家那一侧');
    const wallMid = f.point(qy, f.wallRadius - 2);
    assert.ok(range > Math.hypot(wallMid.x - spot.x, wallMid.z - spot.z), '射程够到殿墙跟前');
    const mid = f.point(qy, 16);
    const ym = yawFrom(spot, mid);
    assert.ok(Math.abs(deltaAngle(y0, ym)) + Math.abs(deltaAngle(ym, y1)) <= span + 0.01, '象限中线在扫过的扇形里');
    const other = sweepPlan(f, q, f.point(qy - 25, 18));
    near(deltaAngle(other.yaw0, yb), 0, 1e-3);
    near(deltaAngle(other.yaw1, ya), 0, 1e-3);
  }
});
