// 4-1 三领主（夔 boss_kui、飞廉 boss_feilian、化蛇 boss_huashe）对照测试：照 Unity EditMode 的 LordTests.cs 逐条改写（同样的输入、同样的断言数）。
//   定义自检、血条刻度 66% / 33%、领主梯度（lordLevel = 4-1、转阶段只出横幅）、破防条按网页值 × 耐久比例换算、化蛇只在张嘴时填（fillWhen）；
//   定档：第 1 / 2 / 3 个打（血 × 1 / 1.15 / 1.3）的模拟击杀用时都在 60–120 s，第一个 65–85 s；
//   招式：前摇 / 出手 / 收招和 docs/art/ch4-move-events.json 一致；片段的出手事件落在释放帧上（≤ 1 帧）——Unity 读 Art/…/events.json，
//     网页读导出的 public/assets/anim/SK_Boss_*.json（同一份手 K 片段，事件按片段长归一化）；
//   登场：镜头表的段落起止、名字卡、land = 过肩机位 + 落回 1.4 s、首领的登场动作在交还前播完；死亡演出 6 s（show 4.8 + land 1.2）；
//   圣湖的游线在湖里、AngleOf 是 SwimPoint 的反函数、水位 = 基础 + 常驻 + 吼叫；
//   据点模式：Unity BossEncounter.stronghold 默认关（只有 4-1 三领主开），结算延迟 6.3 s 大于死亡演出。
// 网页另加：Unity 场景 YAML 导出的关卡目标（objectives.json）与 Unity 一致（6 座灵火坛、要点亮 3 座、据点门槛圆）；首领定义与 Unity defs.json 一致；
// 镜像片段（sidestepL / wheelR）和夔的 sink 网页没导出，退回 sidestep / wheel / kneel。
// 没有旧的 plateau 领主测试要改（src/world/plateau/play/bosses.ts 只给 plateau 试玩页用，没有测试）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { importTs } from './hanba-load.mjs';

const { KuiDef } = await importTs('../src/enemies/bosses/lords/KuiDef.ts');
const { FeilianDef } = await importTs('../src/enemies/bosses/lords/FeilianDef.ts');
const { HuasheDef } = await importTs('../src/enemies/bosses/lords/HuasheDef.ts');
const { LordDef } = await importTs('../src/enemies/bosses/lords/LordDef.ts');
const { kuiIntro } = await importTs('../src/enemies/bosses/lords/KuiIntro.ts');
const { feilianIntro } = await importTs('../src/enemies/bosses/lords/FeilianIntro.ts');
const { huasheIntro } = await importTs('../src/enemies/bosses/lords/HuasheIntro.ts');
const { buildLordDeathScript, SHOULDER_SHOT } = await importTs('../src/enemies/bosses/lords/LordIntros.ts');
const { HuasheLake } = await importTs('../src/enemies/bosses/lords/HuasheLake.ts');
const { kuiStorm, bindKuiStorm, kuiStrike } = await importTs('../src/enemies/bosses/lords/KuiStorm.ts');
const { STRONGHOLD_SETTLE_DELAY, objectiveDriven, inStrongholdThreshold } = await importTs('../src/world/objectives/LevelObjectives.ts');
const { BreakBar } = await importTs('../src/enemies/bosses/framework/BreakBar.ts');

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const defs = () => [new KuiDef(), new FeilianDef(), new HuasheDef()];
const deltaDeg = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

// ───────────── 定义 ─────────────

test('Defs_Validate_TicksLordLevelAndBreakBar：自检、刻度 66 / 33、领主梯度 4-1、只出横幅、破防条换算与名字', async () => {
  for (const d of defs()) {
    assert.deepEqual(d.validate(), [], d.id);
    assert.deepEqual([...d.barTicks], [0.66, 0.33], `${d.id} 血条刻度`);
    assert.equal(d.lordLevel, LordDef.Level, `${d.id} 按 4-1 的领主梯度`);
    assert.equal(d.phaseCinematic, false, `${d.id}：4-1 领主转阶段只出横幅`);
    assert.ok(d.breakBar, `${d.id} 有破防条`);
    near(d.webScale, d.stageHp / d.webHp, 1e-4);
    assert.ok(d.phases.every(p => !!p.toast), `${d.id} 两次转阶段都有阶段名横幅`);
  }
  near(new KuiDef().breakBar.max, 900 * KuiDef.TierHp / KuiDef.Web, 1e-2, '夔的破鼓按网页 900 换算');
  assert.equal(new KuiDef().breakBar.label, '破鼓');
  assert.equal(new FeilianDef().breakBar.label, '珠碎');
  assert.equal(new HuasheDef().breakBar.label, '噎住');
  const fill = new HuasheDef().breakBar.fillWhen;
  assert.ok(fill, '化蛇只在张嘴时填破防条');
  assert.equal(fill({ mouthOpen: true }), true);
  assert.equal(fill({ mouthOpen: false }), false);
  assert.equal(new KuiDef().breakBar.fillWhen, null, '夔 / 飞廉任何时候都填');
  // 已登记：注册表、关卡适配层
  const [lords, index, adapter] = await Promise.all([
    readFile(new URL('src/enemies/bosses/lords/index.ts', root), 'utf8'),
    readFile(new URL('src/enemies/bosses/index.ts', root), 'utf8'),
    readFile(new URL('src/world/UnitySceneAdapter.ts', root), 'utf8'),
  ]);
  for (const [cls, id, name] of [['Kui', 'boss_kui', '夔'], ['Feilian', 'boss_feilian', '飞廉'], ['Huashe', 'boss_huashe', '化蛇']]) {
    assert.match(lords, new RegExp(`new ${cls}\\(ctx, opts\\)`), cls);
    assert.ok(adapter.includes(`${id}: '${id}'`), `${id} 进 BOSS_IDS`);
    assert.ok(adapter.includes(`${id}: '${name}'`), `${id} 进 BOSS_LABELS`);
  }
  assert.match(index, /registerLords\(\)/);
});

test('Defs_MatchUnityDefsJson：生命定档、伤害、速度、半径 / 高、阶段、破防条、死亡演出与 Unity defs.json 一致', async () => {
  const unity = Object.fromEntries((await json('public/assets/unity-gameplay/defs.json')).bosses.map(b => [b.id, b]));
  for (const d of defs()) {
    const u = unity[d.id];
    assert.ok(u, d.id);
    assert.equal(d.name, u.name);
    assert.equal(d.title, u.title);
    near(d.vitalsAt(3.4).hp, u.tiers[0].vitals.hp, 1e-3, `${d.id} 定档`);
    near(d.vitalsAt(1).hp, u.vitals.hp, 1e-2, `${d.id} 难度 1`);
    near(d.damage, u.damage, 1e-6);
    near(d.speed, u.speed, 1e-6);
    near(d.radius, u.radius, 1e-6);
    near(d.height, u.height, 1e-6);
    near(d.webHp, u.webHp, 1e-6);
    near(d.tempo2, u.tempo2, 1e-6);
    near(d.tempo3, u.tempo3, 1e-6);
    assert.equal(d.phases.length, u.phases.length);
    d.phases.forEach((p, i) => {
      near(p.at, u.phases[i].at, 1e-6);
      near(p.seconds, u.phases[i].seconds, 1e-6);
      near(p.restScale, u.phases[i].restScale, 1e-6);
      assert.equal(p.toast, u.phases[i].toast);
      assert.equal(p.anim, u.phases[i].anim);
    });
    assert.equal(d.firstForm.weakBone, u.forms[0].weakBone);
    near(d.firstForm.weakRadius, u.forms[0].weakRadius, 1e-6);
    assert.deepEqual(d.hitZones.map(z => [z.id, z.bone, z.radius]), u.hitZones.map(z => [z.id, z.bone, z.radius]), `${d.id} 受击区`);
    assert.equal(d.deathAnim, u.deathAnim);
    for (const k of ['seconds', 'landSeconds', 'cardAt', 'cardSeconds', 'radius', 'height', 'lookHeight', 'orbitFrom', 'orbitTo', 'slowScale', 'slowSeconds']) near(d.death[k], u.death[k], 1e-5, `${d.id}.death.${k}`);
    for (const k of ['cardTitle', 'cardSub', 'epithet']) assert.equal(d.death[k], u.death[k]);
    near(d.repeatWeight, d.id === 'boss_kui' ? 1 : 0.35, 1e-6, `${d.id} 重复出同一招的权重`);
    assert.equal(d.summonCap, 4);
    near(d.phaseWait, 2, 1e-6);
    assert.equal(d.rewards.chest, 'scroll');
    near(d.defeat.seconds, 6, 1e-6);
  }
  // 运行时层（网页原值）逐项
  const k = new KuiDef(), uk = unity.boss_kui;
  for (const key of ['drumEvery', 'drumEvery3', 'leapEvery', 'leapBeyond', 'ringEvery', 'ringWarn', 'ringRadius', 'ringDamage', 'backlashRadius', 'backlashStun', 'backlashDamage', 'backlashBreak', 'lianguId', 'lianguCount', 'drumsPoleCharge', 'drumOpenMult', 'triggerRadius']) {
    assert.deepEqual(k[key], uk[key], `夔.${key}`);
  }
  assert.deepEqual(k.ringBand, uk.ringBand);
  const f = new FeilianDef(), uf = unity.boss_feilian;
  for (const key of ['windRadius', 'windCore', 'windPush', 'stormPush', 'windSpeedK', 'gustPush', 'breakWindOff', 'orbRegrow', 'sidestepDamage', 'tornadoLife', 'tornadoSpeed', 'fireLife', 'fireSpeed', 'fireTick', 'fireDamage', 'fireRadius']) {
    near(f[key], uf[key], 1e-6, `飞廉.${key}`);
  }
  const h = new HuasheDef(), uh = unity.boss_huashe;
  for (const key of ['flood', 'surge', 'surgeHold', 'surgeFall', 'soakDamage', 'whirlPull', 'wetBurn', 'wetShock', 'selfShockRange', 'selfShockDamage', 'swimRate']) {
    near(h[key], uh[key], 1e-6, `化蛇.${key}`);
  }
});

test('Tiers_KillTimesWithin60To120Seconds：第 1 / 2 / 3 个打的模拟击杀用时在 60–120 s，第一个 65–85 s；血量比例 12k : 11k : 10.5k 保留', () => {
  for (const d of defs()) {
    for (let n = 0; n < 3; n++) {
      const s = d.estimateKillSeconds(n);
      assert.ok(s >= 60 && s <= 120, `${d.id} 第 ${n + 1} 个打：${s.toFixed(0)} s`);
      if (n === 0) assert.ok(s >= 65 && s <= 85, `${d.id} 第一个打：${s.toFixed(0)} s`);
    }
  }
  assert.ok(new KuiDef().stageHp > new FeilianDef().stageHp);
  assert.ok(new FeilianDef().stageHp > new HuasheDef().stageHp);
});

// ───────────── 招式时间轴（docs/art/ch4-move-events.json）─────────────

const TABLE = {
  boss_kui: {
    hop: [0.3, 0.55, 0.25], leap: [0.75, 1.05, 0.8], leapChain: [0.5, 0.9, 0.35], turnLeap: [0.3, 0.5, 0.3],
    knuckle: [0, 3.9, 0], clap: [0.6, 0.2, 0.6], drum: [0.8, 1.8, 1], drum5: [0.8, 3, 1],
  },
  boss_feilian: {
    gust: [1, 0.6, 0.8], charge: [0.8, 1.4, 1], blades: [0.6, 0.1, 0.6], sidestep: [0.1, 0.6, 0.2],
    tornado: [1, 0.2, 0.6], wheel: [0.8, 2.2, 1.2], stormburst: [4, 0.3, 1.5],
  },
  boss_huashe: {
    spit: [0.6, 1.35, 0.6], lunge: [0.7, 0.35, 1.2], wingslap: [0.8, 0.4, 0.6], roar: [0.6, 2.4, 0.8],
    dive: [1.5, 0.35, 1.2], tailsweep: [0.7, 0.5, 0.8],
  },
};

test('Moves_MatchCh4MoveTable：招式 = 表里的招式，三段时长一致；阶段限定与霸体', () => {
  for (const d of defs()) {
    const want = TABLE[d.id];
    assert.deepEqual(d.moves.map(m => m.id).sort(), Object.keys(want).sort(), `${d.id} 的招式 = 表里的招式`);
    for (const m of d.moves) {
      const [w, a, r] = want[m.id];
      near(m.windup, w, 1e-4, `${d.id}.${m.id} 前摇`);
      near(m.active, a, 1e-4, `${d.id}.${m.id} 出手`);
      near(m.recover, r, 1e-4, `${d.id}.${m.id} 收招`);
    }
  }
  const move = (d, id) => d.move(id);
  const k = new KuiDef(), f = new FeilianDef(), h = new HuasheDef();
  assert.equal(move(k, 'drum').minPhase, 1, '捶胸二阶段起');
  assert.equal(move(k, 'drum').maxPhase, 1, '捶胸三下只在二阶段');
  assert.equal(move(k, 'drum5').minPhase, 2, '捶胸五下三阶段');
  assert.equal(move(k, 'leapChain').minPhase, 2, '连环大跳三阶段');
  assert.equal(move(k, 'leap').maxPhase, 1, '大跳只在一二阶段（Unity KuiLeap.Allowed：Phase < 2）');
  assert.equal(move(f, 'tornado').minPhase, 1);
  assert.equal(move(f, 'wheel').minPhase, 1);
  assert.equal(move(f, 'stormburst').minPhase, 2);
  assert.equal(move(f, 'stormburst').stunnable, false, '风雷爆霸体');
  near(move(f, 'stormburst').firstDelay, 3, 1e-6);
  assert.equal(move(h, 'roar').minPhase, 1);
  assert.equal(move(h, 'roar').stunnable, false, '吼叫涨水霸体');
  assert.equal(move(h, 'dive').minPhase, 1);
  assert.equal(move(h, 'tailsweep').minPhase, 2);
  // 调度参数（冷却 / 喘息 / 权重）抽查
  near(move(k, 'leap').weight, 6, 1e-6);
  near(move(k, 'drum').weight, 50, 1e-6);
  near(move(k, 'turnLeap').weight, 20, 1e-6);
  near(move(f, 'sidestep').weight, 100, 1e-6);
  near(move(f, 'charge').cooldown, 3, 1e-6);
  near(move(h, 'lunge').weight, 3, 1e-6);
  near(move(h, 'roar').cooldown, 12, 1e-6);
});

/** 片段里的出手事件：招式 → (事件名, 招式时间里的秒数) */
const RELEASES = [
  ['SK_Boss_Kui', 'hop', 'land', 0.85], ['SK_Boss_Kui', 'leap', 'land', 1.8], ['SK_Boss_Kui', 'leap', 'glint', 0.5],
  ['SK_Boss_Kui', 'turnLeap', 'land', 0.8], ['SK_Boss_Kui', 'leapChain', 'land', 1.4], ['SK_Boss_Kui', 'clap', 'hit', 0.6],
  ['SK_Boss_Kui', 'drum', 'beat', 0.8], ['SK_Boss_Kui', 'drum5', 'beat', 0.8], ['SK_Boss_Kui', 'knuckle', 'step', 1.3],
  ['SK_Boss_Feilian', 'gust', 'hit', 1], ['SK_Boss_Feilian', 'charge', 'hit', 0.8], ['SK_Boss_Feilian', 'wheel', 'hit', 0.8],
  ['SK_Boss_Feilian', 'blades', 'release', 0.6], ['SK_Boss_Feilian', 'tornado', 'release', 1], ['SK_Boss_Feilian', 'stormburst', 'hit', 4],
  ['SK_Boss_Huashe', 'spit', 'release', 0.6], ['SK_Boss_Huashe', 'lunge', 'hit', 0.7], ['SK_Boss_Huashe', 'wingslap', 'hit', 0.8],
  ['SK_Boss_Huashe', 'dive', 'hit', 1.5], ['SK_Boss_Huashe', 'tailsweep', 'hit', 0.7],
];
const ASSET_BOSS = { SK_Boss_Kui: 'boss_kui', SK_Boss_Feilian: 'boss_feilian', SK_Boss_Huashe: 'boss_huashe' };

test('EventsJson_ReleaseEventsOnTheReleaseFrame：导出片段的出手事件落在释放帧上（≤ 1 帧）', async () => {
  const cache = {};
  for (const [asset, state, evt, at] of RELEASES) {
    cache[asset] ??= await json(`public/assets/anim/${asset}.json`);
    const clip = cache[asset].clips[state];
    assert.ok(clip, `${asset}：没有片段 ${state}`);
    const total = TABLE[ASSET_BOSS[asset]][state].reduce((a, b) => a + b, 0);
    const hits = clip.events.filter(e => e.name === evt).map(e => e.t / clip.duration * total);
    assert.ok(hits.length > 0, `${asset}.${state} 没有事件 ${evt}`);
    const best = Math.min(...hits.map(h => Math.abs(h - at)));
    assert.ok(best <= 1 / 30 + 1e-3, `${asset}.${state} 的 ${evt} 离释放帧 ${(best * 30).toFixed(1)} 帧（> 1 帧）`);
  }
});

test('MirroredClips_FallBack：镜像片段 sidestepL / wheelR、夔的 sink 网页没导出，退回 sidestep / wheel / kneel（控制器里有这几个触发器）', async () => {
  const fei = await json('public/assets/anim/SK_Boss_Feilian.json');
  const kui = await json('public/assets/anim/SK_Boss_Kui.json');
  for (const s of ['sidestepL', 'wheelR']) assert.ok(!fei.clips[s], `${s} 还没导出：换成正式片段后删掉这条和 LordBrain 的替身表`);
  assert.ok(!kui.clips.sink);
  for (const s of ['sidestep', 'wheel']) assert.ok(fei.clips[s]);
  assert.ok(kui.clips.kneel);
  const brain = await readFile(new URL('src/enemies/bosses/lords/LordBrain.ts', root), 'utf8');
  assert.match(brain, /sidestepL: 'sidestep', wheelR: 'wheel', sink: 'kneel'/);
});

// ───────────── 登场 / 死亡演出（docs/art/ch4-boss-intros.json）─────────────

test('Intros_MatchCh4IntroTables：整段时长、镜头起点、名字卡、land = 过肩 + 落回 1.4 s、登场动作在交还前播完', () => {
  const table = [
    [kuiIntro, new KuiDef(), 8.0, [0, 2.3, 4.9, 6.6], 5.0],
    [feilianIntro, new FeilianDef(), 7.8, [0, 2.2, 4.4, 6.4], 4.6],
    [huasheIntro, new HuasheDef(), 7.8, [0, 2.0, 4.2, 6.4], 4.4],
  ];
  for (const [s, d, dur, starts, card] of table) {
    assert.equal(s.id, d.id, `${d.id} 用的是专属演出`);
    assert.deepEqual(s.validate(), [], d.id);
    near(s.seconds, dur, 0.011, `${d.id} 整段`);
    assert.deepEqual(s.shots.map(x => x.name), ['establish', 'reveal', 'closeup', 'land'], `${d.id} 镜头`);
    starts.forEach((t, i) => near(s.shotStart(i), t, 0.011, `${d.id} 第 ${i + 1} 镜起点`));
    near(s.shots[3].seconds + s.landSeconds, 1.4, 0.011, `${d.id} land 段 1.4 s`);
    near(s.shots[3].seconds, SHOULDER_SHOT, 1e-6);
    assert.equal(s.shots[3].from.anchor, 'eye', '过肩机位挂在玩家眼睛上');
    assert.ok(s.shots[0].blendIn > 0, '第一镜从玩家眼睛平滑过渡');
    const nc = s.cues.filter(c => c.kind === 'namecard');
    assert.equal(nc.length, 1);
    near(nc[0].at, card, 0.011, `${d.id} 名字卡`);
    assert.ok(s.spawnAt + d.intro.seconds <= s.seconds, `${d.id}：首领的登场动作在交还前播完`);
    assert.ok(s.epithet.startsWith('4-1'));
  }
});

test('DeathSpecs_ShowPlusLandIsSixSeconds：死亡演出 6 s（show 4.8 + 落回 1.2）、3 s 名字卡、0.3 倍慢放；通用溃散不另放慢动作', () => {
  for (const d of defs()) {
    near(d.death.seconds, 6, 1e-4, `${d.id} 死亡演出 6 s`);
    near(d.death.landSeconds, 1.2, 1e-4);
    near(d.death.showSeconds, 4.8, 1e-4);
    near(d.death.cardAt, 3, 1e-4);
    assert.ok(d.death.cardTitle.startsWith(d.name));
    assert.ok(d.death.slowScale >= 0.29 && d.death.slowScale <= 0.31);
    near(d.defeat.slowMo, 1, 1e-6, '通用溃散不另放慢动作（死亡演出放）');
    // 网页：死亡演出的镜头表交给登场导演播
    const s = buildLordDeathScript(d.id, d.death, () => new THREE.Vector3());
    assert.deepEqual(s.validate(), [], `${d.id} 死亡镜头表`);
    near(s.seconds, 6, 1e-4);
    assert.deepEqual(s.shots.map(x => x.name), ['show', 'land']);
    near(s.cues.find(c => c.kind === 'namecard').at, 3, 1e-6);
    near(s.cues.find(c => c.kind === 'slowmo').at, 0, 1e-6);
  }
});

// ───────────── 场地 ─────────────

test('HuasheLake_SwimLineStaysInTheLake：虚拟湖的游线在湖里、AngleOf 是 SwimPoint 的反函数、水位 = 基础 + 常驻 + 吼叫', () => {
  const lake = new HuasheLake(new THREE.Vector3(0, 0, 0), 52, null, null);
  assert.equal(lake.real, false, '没有摆湖：虚拟湖');
  for (let a = -3; a < 3.2; a += 0.4) {
    const p = lake.swimPoint(a, -0.3);
    assert.ok(lake.inLake(p), `游线 ${a.toFixed(1)} 在湖里`);
    near(deltaDeg(lake.angleOf(p) * 180 / Math.PI, a * 180 / Math.PI), 0, 0.5, 'AngleOf 是 SwimPoint 的反函数');
    near(p.y, lake.level - 0.3, 1e-4);
  }
  lake.flood = 1.2;
  lake.surge = 0.8;
  near(lake.level, lake.baseLevel + 2, 1e-4, '水位 = 基础 + 常驻 + 吼叫');
});

test('HuasheLake_HolyLake：4-1 的 Water_HolyLake（中心 (140, 7.21, 150)、96 × 5.5 × 64、朝向 −14.3°）→ 水面 9.96、半轴 48 / 32；游线在湖里', async () => {
  const doc = await json('public/assets/unity-levels/scenes/4-1.json');
  const w = doc.water.find(x => x.name.startsWith('Water_HolyLake'));
  assert.ok(w);
  const water = {
    name: w.name, center: new THREE.Vector3(...w.center), scale: new THREE.Vector3(...w.scale),
    quaternion: new THREE.Quaternion(...w.rotation),
  };
  const boss = doc.bosses.find(b => b.id === 'boss_huashe');
  const lake = new HuasheLake(new THREE.Vector3(boss.center[0], boss.floorY, boss.center[2]), boss.radius, water, null);
  assert.equal(lake.real, true);
  near(lake.baseLevel, 9.96, 0.01);
  near(lake.rx, 48, 1e-4);
  near(lake.rz, 32, 1e-4);
  near(lake.yaw * 180 / Math.PI, -14.32, 0.05);
  near(lake.baseLevel, boss.floorY, 0.01, '首领场地面 = 水面');
  for (let a = -3; a < 3.2; a += 0.25) assert.ok(lake.inLake(lake.swimPoint(a, -0.3), 0.95), `游线 ${a.toFixed(2)} 在湖里（离岸 ≥ 5%）`);
});

// ───────────── 据点模式 / 关卡目标 ─────────────

test('BossEncounter_Stronghold：只有 4-1 三领主是据点模式；结算等死亡演出放完（6.3 > 6）', async () => {
  assert.ok(STRONGHOLD_SETTLE_DELAY > new KuiDef().death.seconds, '据点结算等死亡演出放完');
  near(STRONGHOLD_SETTLE_DELAY, 6.3, 1e-6);
  const manifest = await json('public/assets/unity-levels/manifest.json');
  for (const stage of manifest.stages.filter(s => s.available && s.url)) {
    const doc = await json(`public/${stage.url}`);
    for (const b of doc.bosses) assert.equal(!!b.stronghold, stage.id === '4-1', `${stage.id} ${b.id} 的据点模式`);
  }
});

test('LevelObjective_41：objectives.json 照 Unity 场景——6 座灵火坛要点亮 3 座、①②③ 有守卫、④⑤⑥ 由领主点亮、门槛圆（残鼓 22 / 冰舌顶 32 / 湖岸 50）', async () => {
  const all = await json('public/assets/unity-levels/objectives.json');
  const o = all.levels['4-1'];
  assert.ok(o);
  assert.ok(objectiveDriven(o));
  assert.equal(o.objective.altarsNeeded, 3);
  assert.equal(o.objective.altars.length, 6);
  assert.equal(o.objective.required.length, 0, '目标只看灵火');
  assert.equal(o.altars.length, 6);
  const doc = await json('public/assets/unity-levels/scenes/4-1.json');
  const sites = new Set(doc.encounters.map(e => e.title));
  for (const a of o.altars) {
    // 场景文档里同一个灵火坛的四角石柱渲染件在同一个位置
    const r = doc.renderers.find(x => (x.scenePath ?? '').includes(`/${a.name}/`));
    assert.ok(r, `${a.name} 在场景文档里`);
    near(Math.hypot(r.position[0] - a.position[0], r.position[2] - a.position[2]), 0, 0.01, `${a.name} 位置`);
    if (a.guard) assert.ok(sites.has(a.guard), `${a.name} 的守卫 ${a.guard} 是场景里的遭遇`);
    near(a.kindleTime, 1.2, 1e-6);
  }
  assert.deepEqual(o.altars.filter(a => a.guard).map(a => a.name), ['Altar_1_s1', 'Altar_2_s2', 'Altar_3_s3']);
  const lord = Object.fromEntries(o.bosses.map(b => [b.bossId, b]));
  assert.deepEqual(Object.keys(lord).sort(), ['boss_feilian', 'boss_huashe', 'boss_kui']);
  assert.equal(lord.boss_huashe.altar, 'Altar_4_s4');
  assert.equal(lord.boss_feilian.altar, 'Altar_5_s5');
  assert.equal(lord.boss_kui.altar, 'Altar_6_s6');
  for (const b of o.bosses) {
    assert.equal(b.stronghold, true);
    assert.ok(o.altars.find(a => a.name === b.altar && !a.guard), `${b.bossId} 的坛不挂守卫`);
  }
  // 门槛：圆心 / 半径（Unity ZheduoLevel.strongholds）；夔的圆心在残鼓 = 出生点，不在拉则
  const spawn = Object.fromEntries(doc.bosses.map(b => [b.id, b]));
  near(lord.boss_kui.threshold.radius, 22, 1e-6);
  near(lord.boss_feilian.threshold.radius, 32, 1e-6);
  near(lord.boss_huashe.threshold.radius, 50, 1e-6);
  near(Math.hypot(lord.boss_kui.threshold.center[0] - spawn.boss_kui.position[0], lord.boss_kui.threshold.center[2] - spawn.boss_kui.position[2]), 0, 0.01);
  near(Math.hypot(lord.boss_feilian.threshold.center[0] - spawn.boss_feilian.center[0], lord.boss_feilian.threshold.center[2] - spawn.boss_feilian.center[2]), 0, 0.01);
  near(Math.hypot(lord.boss_huashe.threshold.center[0] - spawn.boss_huashe.center[0], lord.boss_huashe.threshold.center[2] - spawn.boss_huashe.center[2]), 0, 0.01);
  for (const id of Object.keys(lord)) {
    const t = lord[id].threshold, s = spawn[id];
    assert.ok(inStrongholdThreshold(t, { x: s.position[0], y: s.position[1], z: s.position[2] }), `${id} 的出生点在门槛里`);
    assert.ok(!inStrongholdThreshold(t, { x: s.position[0], y: t.maxY + 1, z: s.position[2] }), `${id} 门槛有高度上限`);
  }
  // 4-3 同样是灵火坛 N 选 M（没有据点首领）；前三章没有灵火坛
  assert.equal(all.levels['4-3'].objective.altarsNeeded, 3);
  assert.equal(all.levels['4-3'].altars.length, 5);
  for (const id of ['1-1', '2-2', '3-3']) assert.ok(!objectiveDriven(all.levels[id]), `${id} 照旧终点战清关`);
  // 导出文件是由当前 Unity 场景生成的（Unity 版已冻结：工作区里编辑器重存过、没提交的场景不算数，入库的 objectives.json 按已提交的场景生成）
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'unity/Assets/Scenes'], { cwd: new URL('.', root), encoding: 'utf8' }).stdout?.trim();
  if (dirty) return;
  const r = spawnSync(process.execPath, ['scripts/web/export-level-objectives.mjs', '--check'], { cwd: new URL('.', root), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

// ───────────── 框架：破防条条件填充 / 夔的雷暴适配层 ─────────────

test('BreakBar_FillWhen：化蛇没张嘴时打嘴不填（BossBrain.onDamaged 先问 fillWhen）', async () => {
  const d = new HuasheDef();
  const bar = new BreakBar(d.breakBar);
  // 模拟 BossBrain.onDamaged 的顺序：fillWhen 不满足 → 不填
  const feed = (brain, weakpoint, dealt) => {
    if (bar.def.fillWhen && !bar.def.fillWhen(brain)) return false;
    return bar.add(bar.fillFrom({ weakpoint }, dealt));
  };
  feed({ mouthOpen: false }, true, 500);
  near(bar.current, 0, 1e-6, '闭着嘴：不填');
  feed({ mouthOpen: true }, true, 500);
  near(bar.current, 500, 1e-6, '张着嘴：打弱点按 1 倍填');
  feed({ mouthOpen: true }, false, 500);
  near(bar.current, 500, 1e-6, '张着嘴但没打中弱点：不填');
  const brain = await readFile(new URL('src/enemies/bosses/framework/BossBrain.ts', root), 'utf8');
  assert.match(brain, /const when = this\.breakBar\.def\.fillWhen;/);
});

test('KuiStorm_Adapter：M7 没接上时落雷只记数；接上后照传参数', () => {
  bindKuiStorm(null);
  const before = kuiStorm.pendingBolts;
  kuiStrike(new THREE.Vector3(1, 2, 3), { warn: 1.2, radius: 3.2, damage: 18, source: null });
  assert.equal(kuiStorm.pendingBolts, before + 1);
  const calls = [];
  bindKuiStorm({
    strike: (p, o) => calls.push([p.toArray(), o]), nearestCharged: () => null, chargeConductors() {}, beginStorm: () => null, clearStrikes() {},
  });
  kuiStrike(new THREE.Vector3(4, 5, 6), { warn: 1.2, radius: 3.2, damage: 18, source: null });
  assert.deepEqual(calls[0][0], [4, 5, 6]);
  assert.equal(calls[0][1].radius, 3.2);
  bindKuiStorm(null);
});
