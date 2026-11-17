// 熔心魔将 v2（boss_warlord）的对照测试：照 Unity EditMode 的 WarlordBalanceTests、WarlordSwordTests、WarlordVfxTests、
// BossGaitAnimTests.Warlord*、WarlordDashTests（与导航网格无关的部分）、BossIntroTests.EveryBossHasAValidIntro 逐条改写，同样的输入、同样的断言；
// 外加网页独有的：片段表与 Unity events.json 逐条一致、姿势解算（WarlordPoser）在 v006 骨架上解出来的关键姿势合理。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { importTs } from './hanba-load.mjs';

const D = await importTs('../src/enemies/bosses/WarlordDef.ts');
const B = await importTs('../src/enemies/bosses/WarlordBalance.ts');
const Poses = await importTs('../src/enemies/bosses/WarlordPoses.ts');
const { WarlordPoser } = await importTs('../src/enemies/bosses/WarlordPoser.ts');
const { brush, dryness } = await importTs('../src/enemies/bosses/WarlordFx.ts');
const { buildWarlordIntro } = await importTs('../src/enemies/bosses/WarlordIntro.ts');
const { BossDef, bossVitals } = await importTs('../src/enemies/bosses/framework/BossDef.ts');
const S = await importTs('../src/enemies/bosses/intro/BossIntroScript.ts');

const { WarlordDef, WarlordSword: WS, WarlordRef, BladeCombo, SwordWave, Iai, Spin, Thrust, Leap, ChannelSurge, WarlordPalette } = D;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const V = (x, y, z) => ({ x, y, z });
const Pr = 0.4;
const def = new WarlordDef();

const EVENTS_URL = new URL('../unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json', import.meta.url);
const unityEvents = await readFile(EVENTS_URL, 'utf8').then(t => JSON.parse(t).clips).catch(() => null);
/** Unity 事件表里某段片段第一个名为 name 的事件的归一化时刻 */
const uAt = (clip, name) => unityEvents?.[clip]?.events.find(e => e.name === name)?.at ?? NaN;

// ───────────── WarlordBalanceTests ─────────────

test('Definition_ValidatesAndUsesSwordMoves：九招清单、没有熔岩涌动和烈焰冲锋、陨石雨 / 回旋斩二阶段起', () => {
  assert.deepEqual(def.validate(), []);
  assert.deepEqual(def.moves.map(m => m.id), [
    BladeCombo.id, Iai.id, SwordWave.id, Thrust.id, Spin.id, 'warlord_sweep', 'warlord_leap', 'warlord_meteor', ChannelSurge.id,
  ]);
  assert.ok(!def.moves.some(m => m.id === 'warlord_lava'), '方场熔岩涌动在 3-3 改成了熔铜渠涨落');
  assert.ok(!def.moves.some(m => m.id === 'warlord_charge'), '烈焰冲锋换成了突刺冲锋');
  assert.equal(def.move('warlord_meteor').minPhase, 1, '陨石雨二阶段起才出');
  assert.equal(def.move(Spin.id).minPhase, 1, '回旋斩二阶段起');
  assert.equal(def.id, WarlordDef.Id);
  assert.equal(def.firstForm.prefab, 'SK_Boss_Warlord');
  assert.equal(def.firstForm.weakBone, 'socket_core');
  near(def.firstForm.weakRadius, 0.45, 1e-6);
  assert.deepEqual(def.hitZones.map(z => [z.id, z.bone]), [['pauldron_l', 'pauldron_L'], ['pauldron_r', 'pauldron_R'], ['knee_l', 'shin_L'], ['knee_r', 'shin_R']]);
});

test('Phases_TicksAndFury：刻度 50% / 20%、20% 狂怒、两段第一招、三阶段喘息 ≈ 0.6、不召唤', () => {
  assert.deepEqual([...def.barTicks], [0.5, 0.2]);
  near(def.enrageBelow, 0.2, 1e-5, '20% 狂怒');
  assert.equal(def.enrageAfter, 0);
  assert.equal(def.phases[0].firstMove, ChannelSurge.id, '越过 50% 后第一招是熔铜渠涨落');
  assert.equal(def.phases[1].firstMove, Spin.id, '狂怒后第一招是回旋二连');
  near(def.phases[1].restScale * def.enrageRestScale, 0.6, 0.02);
  assert.equal(def.summonCap, 0);
});

test('Vitals_TierAtStageDifficulty：2.92 定档 18000 / 4600 / 5000，难度 1 ≈ 定档 ÷ 2.92', () => {
  const v = def.vitalsAt(WarlordDef.StageDifficulty);
  near(v.hp, WarlordDef.TierHp, 0.5);
  near(v.shield, WarlordDef.TierShield, 0.5);
  near(v.armor, WarlordDef.TierArmor, 0.5);
  near(def.vitals.hp, WarlordDef.TierHp / WarlordDef.StageDifficulty, 15);
  near(def.vitals.shield, WarlordDef.TierShield / WarlordDef.StageDifficulty, 15);
  near(def.vitals.armor, WarlordDef.TierArmor / WarlordDef.StageDifficulty, 15);
});

test('KillTime_NominalBuild_Within60To120：无属性构筑 80–110 s', () => {
  const t = B.killSeconds(def, WarlordDef.StageDifficulty);
  assert.ok(t >= B.MinSeconds && t <= B.MaxSeconds, `${t}`);
  assert.ok(t >= 80 && t <= 110, `领主战按中段定档：${t.toFixed(1)} s`);
});

for (const e of ['none', 'fire', 'shock', 'corrode']) {
  test(`KillTime_EachElement_Within60To120：${e}`, () => {
    const t = B.killSeconds(def, WarlordDef.StageDifficulty, 1, e);
    assert.ok(t >= B.MinSeconds && t <= B.MaxSeconds, `${e}：${t.toFixed(1)} s`);
  });
}

for (const [scale, e] of [[0.85, 'none'], [0.85, 'fire'], [1.2, 'none'], [1.2, 'fire'], [1.2, 'shock']]) {
  test(`KillTime_WeakAndStrongBuilds_StayInBand：秒伤 × ${scale}、${e}`, () => {
    const t = B.killSeconds(def, WarlordDef.StageDifficulty, scale, e);
    assert.ok(t >= B.MinSeconds && t <= B.MaxSeconds, `${t.toFixed(1)} s`);
  });
}

test('KillTime_TsValuesTimesDifficulty_WouldUndershoot：TS 原值 × 难度不到 60 s（重定档的理由）', () => {
  const raw = new BossDef();
  raw.id = 'boss_warlord_raw';
  raw.name = '魔将（TS 原值）';
  raw.vitals = bossVitals(4000, 1000, 1100);
  raw.phases.push(...def.phases);
  assert.ok(B.killSeconds(raw, WarlordDef.StageDifficulty) < B.MinSeconds);
});

test('ReferenceDps_ScalesWithDifficulty：锚在 3-3 浸泡实测，换难度等比；三层按层倍率', () => {
  near(B.referenceDps(WarlordDef.StageDifficulty), B.soakDps('3-3'), 0.01);
  near(B.referenceDps(1.48), B.soakDps('3-3') * 1.48 / 2.92, 0.01);
  near(B.layerSeconds(bossVitals(1000), 100, 'none'), 10, 1e-3);
  near(B.layerSeconds(bossVitals(0, 0, 1000), 100, 'none'), 1000 / (100 * 0.75), 1e-3);
});

test('SurgeHold_LongerInFury', () => {
  assert.ok(def.surgeHoldAt(2) > def.surgeHoldAt(1));
  assert.equal(def.surgeHoldAt(9), def.surgeHoldAt(2));
});

// ───────────── WarlordSwordTests ─────────────

test('Sector_MatchesTheWarning', () => {
  const o = V(0, 0, 0);
  assert.ok(D.inSector(o, 0, 52, 4.8, V(0, 0, 4.8), Pr, 3), '正前方边上');
  assert.ok(!D.inSector(o, 0, 52, 4.8, V(0, 0, 5.5), Pr, 3), '超出半径');
  assert.ok(!D.inSector(o, 0, 52, 4.8, V(0, 0, -2), Pr, 3), '身后');
  assert.ok(D.inSector(o, 90, 40, 4.4, V(3, 0, 0.5), Pr, 3), '朝右的扇形');
  assert.ok(!D.inSector(o, 0, 52, 4.8, V(0, 3.5, 2), Pr, 3), '跳得够高');
});

test('Lane_CoversLengthAndWidth', () => {
  const from = V(1, 0, 1), dir = { x: 1, z: 0 };
  assert.ok(D.inLane(from, dir, 10, 1.5, V(9, 0, 2.6), Pr, 3));
  assert.ok(!D.inLane(from, dir, 10, 1.5, V(9, 0, 3.2), Pr, 3), '侧面出了线宽');
  assert.ok(!D.inLane(from, dir, 10, 1.5, V(12, 0, 1), Pr, 3), '线尾之外');
  assert.ok(!D.inLane(from, dir, 10, 1.5, V(-1, 0, 1), Pr, 3), '线头之后');
});

test('Ring_InnerIsSafe', () => {
  const c = V(0, 0, 0);
  assert.ok(D.inRing(c, 0, 6.2, V(6, 0, 0), Pr, 2.2));
  assert.ok(!D.inRing(c, 0, 6.2, V(7, 0, 0), Pr, 2.2));
  assert.ok(!D.inRing(c, 2.6, 9, V(1.5, 0, 0), Pr, 2.2), '二连的第二圈：贴身安全');
  assert.ok(D.inRing(c, 2.6, 9, V(8, 0, 0), Pr, 2.2));
});

test('Wave_HorizontalIsJumpable_VerticalIsSidestepped', () => {
  const o = V(0, 0, 0), dir = { x: 0, z: 1 };
  assert.ok(D.waveSweeps(o, dir, 9, 10, SwordWave.HHalf, 0, SwordWave.HTop, V(2.5, 0, 9.5), Pr));
  assert.ok(!D.waveSweeps(o, dir, 9, 10, SwordWave.HHalf, 0, SwordWave.HTop, V(2.5, 1.1, 9.5), Pr));
  assert.ok(D.waveSweeps(o, dir, 9, 10, SwordWave.VHalf, 0, SwordWave.VTop, V(0.5, 1.3, 9.5), Pr));
  assert.ok(!D.waveSweeps(o, dir, 9, 10, SwordWave.VHalf, 0, SwordWave.VTop, V(1.5, 0, 9.5), Pr));
  assert.ok(!D.waveSweeps(o, dir, 9, 10, SwordWave.VHalf, 0, SwordWave.VTop, V(0, 0, 14), Pr));
  assert.ok(SwordWave.HTop < 8.6 * 8.6 / (2 * 26) - 0.3, '横剑气的离地上限低于玩家跳高');
});

test('WavePatterns_GrowWithPhase', () => {
  const p0 = SwordWave.pattern(0);
  assert.equal(p0.first.length, 1);
  assert.equal(p0.second.length, 0);
  assert.equal(p0.first[0].kind, 'vertical', '一阶段教竖剑气（侧移）');
  const p1 = SwordWave.pattern(1);
  assert.equal(p1.first[0].kind, 'horizontal', '二阶段先横（跳）');
  assert.equal(p1.second[0].kind, 'vertical', '再竖（侧移）');
  const p2 = SwordWave.pattern(2);
  assert.equal(p2.first.length + p2.second.length, 4, '狂怒十字剑气：一横三竖');
  assert.ok(p2.second[0].speed > p2.first[0].speed, '中间那道竖剑气比横剑气快');
});

test('Timing_DerivedFromClipEvents', () => {
  near(Iai.sheatheFor(0.95), 0.95 * 0.5 - WS.IaiDash, 1e-4);
  assert.ok(Iai.sheatheFor(0.3) >= 0.16, '纳刀至少 0.16 s');
  near(Spin.gapFor(0.6), 0.6 * (32 / 18 - 1), 1e-4);
  near(WS.CrossImpactAt / WS.CrossHitAt, 23 / 15, 1e-4);
});

// ───────────── WarlordVfxTests ─────────────

test('SlashOrder_LastIsTheOverheadChop', () => {
  assert.deepEqual([0, 1, 2].map(k => D.slashState(k, 3)), ['slashA', 'slashB', 'slashC']);
  assert.deepEqual([0, 1, 2, 3].map(k => D.slashState(k, 4)), ['slashA', 'slashB', 'slashA', 'slashC']);
  assert.ok(D.SlashClip > WarlordRef.ComboPer, '每刀片段要比每斩间隔长');
});

const at = (clip, name) => Poses.eventAt(clip, name);

test('SlashHit_LandsOnTheJudgement：刀到 × 片段长 = 0.5 s 的判定（±1 帧），拖影包住刀到', () => {
  for (const clip of ['slashA', 'slashB', 'slashC']) {
    const hit = at(clip, 'hit');
    assert.ok(!Number.isNaN(hit), `${clip} 没有 hit 事件`);
    near(hit * D.SlashClip, WarlordRef.ComboWindup, 1 / 30, `${clip} 的刀到`);
    assert.ok(at(clip, 'smear') < hit);
    assert.ok(at(clip, 'smearEnd') > hit);
  }
});

test('StretchedClips_KeepTheirReleaseRatios：raise cast 33%、plant hit 35%、横扫刀到在头两帧、落地 / 撞墙第 0 帧', () => {
  near(at('raise', 'cast'), 0.33, 0.01);
  near(at('plant', 'hit'), 0.35, 0.01);
  assert.ok(at('sweep', 'hit') * 0.8 <= 2 / 30);
  assert.ok(at('sweepBack', 'hit') * 0.8 <= 2 / 30);
  near(at('land', 'hit'), 0, 1e-4);
  near(at('crash', 'impact'), 0, 1e-4);
});

test('Leap_DoesNotChainIntoLand：腾空片段不自动接 land，蹲伏接腾空', () => {
  assert.equal(Poses.CLIPS.leap.next, undefined);
  assert.equal(Poses.CLIPS.crouch.next, 'leap');
});

test('SwordClips_ReleaseEventsMatchTheMoves：新片段的出手事件在 WarlordSword 记的位置上', () => {
  const check = (clip, evt, want) => near(at(clip, evt), want, 0.5 / 30, `${clip} 的 ${evt}`);
  for (const clip of ['slashA', 'slashB', 'slashUp', 'slashC']) check(clip, 'hit', WS.SlashHitAt);
  check('iai', 'hit', WS.IaiHitAt);
  check('iai', 'dash', WS.IaiDashAt);
  check('waveSlash', 'hit', WS.WaveHitAt);
  check('waveCross', 'hit', WS.CrossHitAt);
  check('waveCross', 'impact', WS.CrossImpactAt);
  check('thrustCut', 'hit', WS.ThrustCutHitAt);
  check('spin', 'hit', WS.SpinHitAt);
  check('spinTwice', 'hit', WS.SpinTwiceHitAt);
  check('spinTwice', 'impact', WS.SpinTwiceImpactAt);
});

test('ComboPlan_NextStrokeArrivesBeforeTheClipLeaves：三 / 四 / 五刀、末刀下劈、二阶段起有上挑、节奏不匀速', () => {
  for (let phase = 0; phase <= 2; phase++) {
    const plan = BladeCombo.plan(phase);
    assert.equal(plan.length, 3 + phase);
    assert.equal(plan[plan.length - 1].stroke, 'cleave');
    assert.equal(plan.some(b => b.stroke === 'rise'), phase >= 1);
    for (let k = 0; k < plan.length; k++) {
      assert.ok(BladeCombo.windupOf(plan[k]) > 0.33, `阶段 ${phase} 第 ${k} 刀的前摇太短`);
      if (k === 0) continue;
      assert.ok(plan[k].warn > plan[k - 1].strike, '下一刀的预警在上一刀刀到之后');
      const leave = plan[k - 1].warn + 0.98 * BladeCombo.windupOf(plan[k - 1]) / WS.SlashHitAt;
      assert.ok(plan[k].warn < leave, `阶段 ${phase} 第 ${k} 刀起手时上一刀已经在退回待机`);
    }
  }
  const p0 = BladeCombo.plan(0);
  assert.ok(p0[2].warn - p0[1].strike > p0[1].warn - p0[0].strike, '下劈前多顿一下');
});

test('Brush_EntryThinExitSharp', () => {
  assert.ok(brush(0) < 0.2, '露锋：起笔细');
  near(brush(1), 0, 1e-4, '出锋：收笔尖');
  assert.ok(brush(0.8) > 1, '收笔前一顿');
  assert.ok(brush(0.6) > brush(0.2), '行笔渐粗');
  assert.ok(dryness(0.05) > 0.8, '飞白在起笔那一段');
  near(dryness(0.5), 0, 1e-4);
});

test('Palette_FuryShiftsTowardWhiteHotCopper', () => {
  assert.equal(WarlordPalette.copperAt(0), WarlordPalette.Copper);
  assert.equal(WarlordPalette.copperAt(1), WarlordPalette.FuryCopper);
  assert.ok((WarlordPalette.hotAt(1) & 255) > (WarlordPalette.hotAt(0) & 255), '狂怒的亮芯更白');
  const c = new THREE.Color(WarlordPalette.Smoke), hsl = {};
  c.getHSL(hsl);
  const r = c.r, g = c.g, b = c.b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx > 0 ? (mx - mn) / mx : 0;
  assert.ok(hsl.h > 0.75 || hsl.h < 0.05, `烟要偏紫褐（色相 ${hsl.h.toFixed(2)}）`);
  assert.ok(s < 0.6);
});

// ───────────── BossGaitAnimTests（魔将） ─────────────

test('WarlordLocomotion_TwoHandedLoopsAtRecordedSpeeds：慢走 2.3 m/s、疾行 4.6 m/s 循环，第一声脚步在右脚落地', () => {
  for (const [clip, speed] of [['Walk', 2.3], ['Move', 4.6]]) {
    const c = Poses.CLIPS[clip];
    assert.equal(c.loop, true, `${clip} 要循环`);
    near(c.speed, speed, 1e-3);
    assert.ok(at(clip, 'sfx:footstep') < 0.1);
  }
  assert.equal(Poses.CLIPS.Idle.loop, true);
});

test('WarlordIntroLand_HandsOverToRoarAtItsGatherFrame：落地第 0 帧、怒视在停顿之后、咆哮从缩身那一帧接着播', () => {
  near(at('introLand', 'hit'), 0, 1e-4);
  const glare = at('introLand', 'glare');
  assert.ok(glare > 0.5 && glare < 0.95, `${glare}`);
  assert.equal(Poses.CLIPS.introLand.next, undefined);
  near(at('roar', 'gather'), 12 / 72, 0.01, 'RoarGatherAt 要等于 roar 的 gather 事件');
});

test('ClipTable_MatchesUnityEvents：片段表的事件、next、loop、speed 与 Unity events.json 逐条一致', { skip: unityEvents ? false : '没有 Unity 事件表' }, () => {
  for (const [name, clip] of Object.entries(Poses.CLIPS)) {
    const u = unityEvents[name];
    assert.ok(u, `Unity 事件表里没有 ${name}`);
    const mine = clip.events.map(([f, n]) => [n, f / clip.frames]);
    assert.equal(mine.length, u.events.length, `${name} 的事件数`);
    for (const [n, a] of mine) assert.ok(u.events.some(e => e.name === n && Math.abs(e.at - a) <= 6e-4), `${name} 的 ${n}@${a.toFixed(4)}`);
    assert.equal(clip.next, u.next, `${name} 的 next`);
    assert.equal(!!clip.loop, !!u.loop, `${name} 的 loop`);
    if (u.speed) near(clip.speed, u.speed, 1e-3, `${name} 的 speed`);
  }
  for (const name of Object.keys(unityEvents)) assert.ok(Poses.CLIPS[name], `网页片段表缺 ${name}`);
});

// ───────────── WarlordDashTests（不依赖导航网格的部分） ─────────────

test('ThrustLine_PlainGround：平地上不截（玩家 6 m → 11 m）；台沿截短不受场地边的最短 8 m 限制', () => {
  near(Thrust.planLength(6, 40), 11, 1e-6);
  near(Thrust.planLength(19, 40), 24, 1e-6, '最长 24 m');
  near(Thrust.planLength(19, 5), 5, 1e-6, '截到场地边');
  near(Thrust.planLength(19, 40, l => Math.min(l, 9.4)), 9.4, 1e-6, '台沿截短');
  near(Thrust.planLength(2, 40, l => Math.min(l, 3)), 3, 1e-6, '台沿截得比 8 m 还短也照截');
});

/** 平地上的脚本位移（ScriptedMotion 在平地上的行为）：位置 += 速度 × dt、竖直速度 −= g × dt，落到地面上就贴地 */
function flatStep(m, dt) {
  m.v.y -= m.g * dt;
  m.p.addScaledVector(m.v, dt);
  m.grounded = false;
  if (m.p.y <= 0) {
    m.p.y = 0;
    if (m.v.y < 0) m.v.y = 0;
    m.grounded = true;
  }
}

for (const dt of [1 / 60, 0.1, 1 / 3]) {
  test(`Leap_LandsInsideTheWarningCircle_AtAnyStep：dt ${dt.toFixed(3)}`, () => {
    const air = 1;
    const from = new THREE.Vector3(-8, 0, -3), target = new THREE.Vector3(8, 0, 5);
    const d = target.clone().sub(from);
    const dy = d.y;
    d.y = 0;
    const v = d.divideScalar(air);
    v.y = (dy + 0.5 * WarlordRef.LeapGravity * air * air) / air;
    const m = { p: from.clone(), v, g: WarlordRef.LeapGravity, grounded: false };
    let drift = 0, t = 0, landAt = -1;
    const flat = q => Math.hypot(q.x - target.x, q.z - target.z);
    for (let i = 0; i < 200 && landAt < 0; i++) {
      t += dt;
      flatStep(m, dt);
      switch (Leap.decide(t, air, m.grounded, m.p, target, false)) {
        case 'pin':
          drift = Math.max(drift, flat(m.p));
          m.p.copy(target);
          m.v.set(0, 0, 0);
          break;
        case 'land':
          if (!Leap.isBlocked(m.p, target, false)) {
            drift = Math.max(drift, flat(m.p));
            m.p.copy(target);
          }
          landAt = t;
          break;
      }
    }
    assert.ok(landAt >= air - 0.12, `${landAt.toFixed(2)} s 就砸下来了（预警 ${air} s 才填满）`);
    assert.ok(flat(m.p) <= WarlordRef.LeapMiss, `落在预警圈外（偏 ${flat(m.p).toFixed(2)} m）`);
    near(m.p.y, target.y, 0.05);
    if (dt > 0.3) assert.ok(drift > WarlordRef.LeapMiss, 'dt 0.33 时抛物线本应偏出预警圈（保护确实起了作用）');
  });
}

test('Leap_BlockedLanding：落在比落点高 0.8 m 以上的东西上或撞墙 = 被挡住', () => {
  const tgt = V(0, 0, 0);
  assert.ok(Leap.isBlocked(V(0, 0.9, 0), tgt, false));
  assert.ok(!Leap.isBlocked(V(0, 0.5, 0), tgt, false));
  assert.ok(Leap.isBlocked(V(0, 0, 0), tgt, true));
  assert.equal(Leap.decide(0.1, 1, true, V(0, 0, 0), tgt, false), 'fly', '起跳头 0.15 s 不算着地');
  assert.equal(Leap.decide(0.5, 1, true, V(0, 0, 0), tgt, false), 'pin', '没被挡住却早着地：钉到落点等');
  assert.equal(Leap.decide(0.5, 1, true, V(0, 1.2, 0), tgt, false), 'land', '被挡住：就地落地');
  assert.equal(Leap.decide(1.9, 1, false, V(0, 3, 0), tgt, false), 'land', '滞空超时');
});

// ───────────── BossIntroTests（魔将） ─────────────

test('EveryBossHasAValidIntro_6To10Seconds：魔将的演出自检通过、三镜、登场动作在交还前播完', () => {
  const s = buildWarlordIntro();
  assert.equal(s.id, WarlordDef.Id);
  assert.deepEqual(s.validate(), []);
  assert.ok(s.seconds >= 6 && s.seconds <= 10, `整段 ${s.seconds.toFixed(1)} s`);
  assert.ok(s.shots.length >= 3);
  assert.ok(s.shots[0].blendIn > 0, '第一镜从玩家眼中平滑拔起');
  assert.ok(s.spawnAt + def.intro.seconds <= s.seconds, '首领自己的登场动作要在镜头交还前播完');
  assert.ok(s.spawnAt < s.shotStart(s.shots.length - 1), '特写之前首领就已经生成');
  assert.ok(s.epithet && s.epithet.length > 0);
  near(s.spawnAt + def.intro.seconds * def.dropFraction, 2.64, 0.03, '落地时刻对上「copper splash」2.66 s');
});

test('IntroAnchors_ResolveToFiniteSpots_WithoutAScene：每一镜的机位 / 看点都是有限的点，王座锚点在场地中心上方 31 m', () => {
  const center = new THREE.Vector3(-152, 0, 164);
  for (const s of [buildWarlordIntro(), buildWarlordIntro(center)]) {
    const c = S.BossIntroContext.preview(s, new THREE.Vector3(5, 0, -40), new THREE.Vector3(0, 0, 8));
    for (const shot of s.shots) {
      for (const pt of [shot.from, shot.to, shot.lookFrom, shot.lookTo]) {
        const p = c.point(pt);
        assert.ok(Number.isFinite(p.x + p.y + p.z), `${shot.name} 的 ${pt.anchor}`);
      }
    }
  }
  const c = S.BossIntroContext.preview(buildWarlordIntro(center), new THREE.Vector3(5, 0, -40), new THREE.Vector3(0, 0, 8));
  assert.deepEqual(c.anchor('fireGodThrone').toArray(), [-152, 31, 164]);
});

// ───────────── 姿势解算（网页独有：v006 骨架上现场烘焙的关键帧要合理） ─────────────

async function loadSkeleton() {
  const buf = await readFile(new URL('../public/assets/characters/SK_Boss_Warlord.glb', import.meta.url));
  const len = buf.readUInt32LE(12);
  const j = JSON.parse(buf.subarray(20, 20 + len).toString());
  const objs = j.nodes.map(n => {
    const o = new THREE.Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n, i) => { for (const c of n.children ?? []) objs[i].add(objs[c]); });
  return objs.find(o => o.name === 'root');
}

const skeleton = await loadSkeleton().catch(() => null);

test('Poser_KeyPosesAreSane：底姿剑尖离地约半米、竖劈剑尖贴地在前、举剑过顶、插剑入地、脚踩在地上', { skip: skeleton ? false : '没有 SK_Boss_Warlord.glb' }, () => {
  const poser = WarlordPoser.fromBones(skeleton);
  assert.deepEqual(poser.missing, []);
  const pose = (clip, frame) => {
    const k = Poses.CLIPS[clip].keys.find(x => x[0] === frame);
    poser.build(k[1]);
    return { tip: poser.pos('socket_sword_tip'), grip: poser.pos('socket_sword'), footL: poser.pos('foot_L'), footR: poser.pos('foot_R'),
      handL: poser.pos('hand_L'), head: poser.pos('head') };
  };
  const g = pose('Idle', 0);
  assert.ok(g.tip.y > 0.3 && g.tip.y < 1.1, `底姿剑尖离地 ${g.tip.y.toFixed(2)} m`);
  assert.ok(g.tip.z > 1 && g.tip.x > 0.5, '剑尖斜指左前下方（模型 +X = 生物左、+Z = 前）');
  near(g.footL.y, 0.38, 0.03, '脚踝贴着绑定高度（踩在地上）');
  near(g.footR.y, 0.38, 0.03);
  assert.ok(g.handL.distanceTo(g.grip) < 0.6, '左手握在剑柄上');
  const c = pose('slashC', 15);
  assert.ok(c.tip.y < 0.6 && c.tip.z > 2.5, `竖劈入地：剑尖 ${c.tip.toArray().map(v => v.toFixed(2))}`);
  const cock = pose('slashC', 9);
  assert.ok(cock.tip.y > 5 && cock.tip.z < 0, '双手过顶：剑尖在头顶后方');
  const raise = pose('raise', 24);
  assert.ok(raise.tip.y > 6, '举剑指天');
  const plant = pose('plant', 14);
  assert.ok(plant.tip.y < 0, '大剑直插入地');
  const fall = pose('fall', 0);
  assert.ok(fall.footL.y > 0.7, '下坠时腿收起');
  // 回旋斩：髋转 200° 时四肢 / 剑的方向仍按骨架空间给（同 Blender 构建器），脚跟着转身踩回地面
  const spin = pose('spin', 21);
  assert.ok(Math.abs(spin.footL.y - 0.38) < 0.05 && Math.abs(spin.footR.y - 0.38) < 0.05, '回旋时脚还踩在地上');
});

test('Poser_BakesEveryClipWithFiniteRotations', { skip: skeleton ? false : '没有 SK_Boss_Warlord.glb' }, () => {
  const poser = WarlordPoser.fromBones(skeleton);
  for (const [name, clip] of Object.entries(Poses.CLIPS)) {
    const baked = poser.bake(clip);
    assert.equal(baked.keys.length, clip.keys.length, name);
    for (const k of baked.keys) {
      for (const [bone, q] of k.pose.q) assert.ok(Number.isFinite(q.x + q.y + q.z + q.w) && Math.abs(q.length() - 1) < 1e-3, `${name} 第 ${k.frame} 帧 ${bone}`);
      assert.ok(Number.isFinite(k.pose.hips.y), name);
    }
  }
});
