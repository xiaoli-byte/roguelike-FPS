// M9 灵宠（docs/threejs-migration.md 4.8）：网页 src/pets 对 Unity G/Pets/*.cs 的数。期望值照 C# 抄成本文件里的常量，旁边注明出自哪个 C# 文件哪一行
// （不读 unity/ 下的任何文件：unity/ 以后会整个删掉）；以及 Unity EditMode 测试里和灵宠相关的几条：RunSuspendTests（续玩档里的灵宠往返、坏档、
// 图鉴灵宠条目数）、HudWidgetTests.HitMarkerOnlyForDirectPlayerHits（灵宠的命中不出命中标记）。Unity 没有专门的 PetTests：行为的数（伤害、范围、
// 间隔、冷却、灵契经验）在这里逐只比，嘲讽在真的 EnemyBase 上跑一遍。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { combatRig, tsGraph } from './unity-parity-kit.mjs';
import { importTs } from './hanba-load.mjs';

const graph = await tsGraph({
  // 美术 / 动画在 node 里不建：灵宠本体只测数与流程
  'pets/PetVisuals.ts': `export const SOCKET_NAMES = []; export function buildPetModel() { return null; } export function disposePetModel() {}
    export function modelRigged() { return false; } export function socketOf() { return null; } export function instantiatePart() { return null; }`,
  'pets/PetFx.ts': `export function glowSprite() { return { position: { y: 0 }, scale: { setScalar() {} }, material: { dispose() {} } }; }
    export function marker() { return null; } export function textLabel() { return null; } export function disposeObject() {}
    export class PetFxSystem { constructor() { this.group = { add() {} }; } attach() {} burst() {} pillar() {} beam() {} timedMarker() {} update() {} clear() {} }`,
  'pets/PetSeal.ts': 'export class PetSeal {}',
  'assets/AssetLibrary.ts': 'export const AssetLibrary = {};',
});
after(() => graph.dispose());
const DEFS = await graph.load('pets/PetDefs.ts');
const { Pet, ENGAGE_RANGE, LEASH_RANGE, STUCK_TIME, TARGET_MEMORY, MAX_LEVEL, AWAKEN_LEVEL, XP_NEED } = await graph.load('pets/Pet.ts');
const BEH = await graph.load('pets/PetBehaviours.ts');
const SYS = await graph.load('pets/PetSystem.ts');
const FUR = await graph.load('pets/PetFur.ts');
const { CrosshairWidget } = await graph.load('ui/hud/CrosshairWidget.ts');
const CX = await graph.load('ui/codex/Codex.ts');
const RULES = await graph.load('progression/loot/rewardRules.ts');
const { petHit } = await graph.load('combat/PetContract.ts');
const { PET_FUR_DATA: FUR_DATA, PET_DEF_DATA } = await graph.load('pets/PetDefsData.ts');

/** 网页源码（只读 src/，核对接线写法） */
const src = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// ───────────── 定义（Unity PetDefs.cs → src/pets/PetDefsData.ts，2026-11 一次性转换入库）─────────────

/**
 * 八只的移动 / 形态数（Unity Pets/PetDefs.cs，PetLibrary.All 的对象初始化器，第 84–162 行；没写的取 PetDef 字段初值：
 * 第 47–50 行 height 0.7、moveSpeed 9、followBack 3、followSide 1.2、flyHeight 2，hover 0）。
 * [id, 资产, 身高, 移速, 跟随后距, 跟随侧距, 飞行高度, 悬浮, 元素, 飞行, 灵技冷却]
 */
const DEF_TABLE = [
  ['dangkang', 'SK_Pet_Dangkang', 0.7, 9, 2.6, 1.1, 2, 0, 'none', false, 18], // PetDefs.cs:84 / 冷却 :88
  ['huan', 'SK_Pet_Huan', 0.6, 10, 3, -1.2, 2, 0, 'none', false, 20], // :95 / :99
  ['jingwei', 'SK_Pet_Jingwei', 0.35, 13, 3, 0.9, 2.1, 0, 'fire', true, 16], // :106 / :110
  ['chongming', 'SK_Pet_Chongming', 0.6, 13, 3, -1, 2.2, 0, 'shock', true, 20], // :118 / :122
  ['suanni', 'SK_Pet_Suanni', 0.8, 9, 2.6, 1.3, 2, 0, 'corrode', false, 22], // :129 / :133
  ['zheng', 'SK_Pet_Zheng', 0.85, 11, 3.2, -1.3, 2, 0, 'none', false, 18], // :140 / :144
  ['baize', 'SK_Pet_Baize', 1.3, 10, 3.4, 1.5, 2, 0.25, 'none', false, 25], // :151 / :155
  ['yinglong', 'SK_Pet_Yinglong', 1, 14, 2.4, -1.4, 3.2, 0, 'shock', true, 25], // :162 / :166
];

test('八只灵宠的移动 / 形态数据照 PetDefs.cs（转换入库的 PetDefsData.ts）', () => {
  assert.deepEqual(PET_DEF_DATA.map(d => [d.id, d.assetId, d.height, d.moveSpeed, d.followBack, d.followSide, d.flyHeight, d.hover, d.element, d.flying, d.skillCooldown]), DEF_TABLE);
  // 配色（PetDefs.cs:85 当康 body / accent、:76 CommonFx / MythicFx、:163 应龙 body；fx = DamageTable.ElementColor 的取 Damage.cs:167–169）
  const dk = PET_DEF_DATA[0], yl = PET_DEF_DATA[7];
  assert.deepEqual([dk.body, dk.accent, dk.fx], [[0.92, 0.76, 0.42], [0.62, 0.32, 0.18], [1, 0.92, 0.7]]);
  assert.deepEqual([yl.body, yl.fx, yl.partGlow], [[0.25, 0.62, 0.45], [1, 0.62, 0.32], [0.6, 0.8, 1]]);
  assert.deepEqual(PET_DEF_DATA[3].fx, [0.55, 0.75, 1], '重明鸟 fx = 雷元素色');
  assert.deepEqual(PET_DEF_DATA[4].fx, [0.6, 0.9, 0.3], '狻猊 fx = 蚀元素色');
  // 品阶色 / 神兽金（PetDefs.cs:13、:16）
  assert.deepEqual(DEFS.PET_RARITY_COLORS, [[0.85, 0.85, 0.85], [0.4, 0.65, 1], [1, 0.32, 0.3]]);
  assert.deepEqual(DEFS.PET_GOLD, [1, 0.8, 0.35]);
});

test('八只灵宠：顺序、id、资产、品阶、飞行、灵技冷却照 PetLibrary.All', () => {
  // PetLibrary.All 的 id / assetId（PetDefs.cs:82、93、104、116、127、138、149、160）
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => [d.id, d.assetId]), DEF_TABLE.map(r => [r[0], r[1]]));
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.rarity), [0, 0, 0, 1, 1, 1, 2, 2]);
  assert.deepEqual(DEFS.PET_LIBRARY.filter(d => d.flying).map(d => d.id), ['jingwei', 'chongming', 'yinglong']);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.skillCooldown), [18, 20, 16, 20, 22, 18, 25, 25]);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.label), ['凡灵 · 当康', '凡灵 · 讙', '凡灵 · 精卫', '灵兽 · 重明鸟', '灵兽 · 狻猊', '灵兽 · 狰', '神兽 · 白泽', '神兽 · 应龙']);
  // 发光件：精卫的火石挂 pebble、应龙的宝珠挂 pearl（PetDefs.cs:112、:168）
  assert.deepEqual(DEFS.PET_LIBRARY.filter(d => d.partId).map(d => [d.id, d.partId, d.partSocket]),
    [['jingwei', 'SM_PetPart_JingweiPebble', 'pebble'], ['yinglong', 'SM_PetPart_YinglongPearl', 'pearl']]);
  // 按 id / 资产 id 都能找到（PetLibrary.Get）
  assert.equal(DEFS.getPetDef('SK_Pet_Baize').id, 'baize');
  assert.equal(DEFS.getPetDef('nope'), null);
  assert.equal(DEFS.getPetDef(''), null);
});

test('品阶：凡灵 72% / 灵兽 25% / 神兽 3%（PetRarities.Roll），抽灵宠先抽品阶再在品阶里平均抽（PetLibrary.Roll）', () => {
  // PetDefs.cs:14 `static readonly float[] Weights = { 72, 25, 3 };`、:12 Names
  assert.deepEqual(DEFS.PET_RARITY_WEIGHTS, [72, 25, 3]);
  assert.deepEqual(DEFS.PET_RARITY_NAMES, ['凡灵', '灵兽', '神兽']);
  // 阈值：x = rand × 100，x < 72 凡灵，再 < 25 灵兽
  assert.equal(DEFS.rollRarity(() => 0.7199), 0);
  assert.equal(DEFS.rollRarity(() => 0.72), 1);
  assert.equal(DEFS.rollRarity(() => 0.9699), 1);
  assert.equal(DEFS.rollRarity(() => 0.97), 2);
  // 固定品阶后在池里按 Random.Range(0, n) 取
  assert.equal(DEFS.rollPet(() => 0, 2).id, 'baize');
  assert.equal(DEFS.rollPet(() => 0.999, 2).id, 'yinglong');
  assert.equal(DEFS.rollPet(() => 0.5, 1).id, 'suanni');
  // 10 万次分布
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const n = [0, 0, 0];
  for (let i = 0; i < 100000; i++) n[DEFS.rollRarity(rand)]++;
  assert.ok(Math.abs(n[0] / 1000 - 72) < 1 && Math.abs(n[1] / 1000 - 25) < 1 && Math.abs(n[2] / 1000 - 3) < 0.4, String(n));
});

test('奖励串（PetReward）："pet" / "pet:<id>" / "pet:rarity=<0–2>"；种类 / 标题名 / 宝箱说明照 Unity Chest.Label / Line', () => {
  assert.equal(DEFS.petForReward('pet:zheng', () => 0).id, 'zheng');
  assert.equal(DEFS.petForReward('pet:rarity=2', () => 0).id, 'baize');
  assert.equal(DEFS.petForReward('pet:rarity=9', () => 0.99).rarity, 2, '超出夹住（PetReward.cs:17 Mathf.Clamp(tier, 0, 2)）');
  assert.equal(DEFS.petForReward('pet:rarity=x', () => 0).rarity, 0, '不是整数 = 按权重抽');
  assert.equal(DEFS.petForReward('pet', () => 0.98).rarity, 2);
  assert.equal(RULES.rewardKey('pet'), 'pet');
  assert.equal(RULES.rewardKey('pet:rarity=2'), 'pet');
  // Loot/Chest.cs:66 `case "pet": return "灵宠";`、:80 `"pet" => "灵兽封印：结契一只灵宠"`
  assert.match(src('../src/progression/RunPlan.ts'), /pet: '灵宠'/);
  assert.match(src('../src/progression/loot/Chests.ts'), /case 'pet':\s*\/\/[^\n]*\n\s*return '灵兽封印：结契一只灵宠';/);
});

test('精英掉封印 6%（EconomyConfig.ElitePetChance）、击杀给灵契经验 普通 1 / 精英 4（PetOwner）', () => {
  assert.equal(SYS.ELITE_PET_CHANCE, 0.06); // Core/EconomyConfig.cs:44 ElitePetChance = 0.06f
  assert.deepEqual([SYS.NORMAL_XP, SYS.ELITE_XP], [1, 4]); // Pets/PetOwner.cs:19 NormalXp = 1, EliteXp = 4
});

// ───────────── 本体（Pet.cs）─────────────

test('Pet 常量：交战 18 m、拴绳 22 m、卡住 3 s、记仇 3 s；灵契 1–5 级、3 级觉醒、经验 6 / 10 / 16 / 24', () => {
  // Pets/Pet.cs:26 EngageRange = 18f, LeashRange = 22f, StuckTime = 3f, TargetMemory = 3f；:27 MaxLevel = 5, AwakenLevel = 3；:28 XpNeed = { 6, 10, 16, 24 }
  assert.deepEqual([ENGAGE_RANGE, LEASH_RANGE, STUCK_TIME, TARGET_MEMORY], [18, 22, 3, 3]);
  assert.deepEqual([MAX_LEVEL, AWAKEN_LEVEL], [5, 3]);
  assert.deepEqual([...XP_NEED], [6, 10, 16, 24]);
  // Pet.cs:41 DamageMult => 1 + 0.15f * (Level - 1)；:42 CooldownMult => 1 - 0.06f * (Level - 1)（数值在下一条用例里断言）
});

/** 一只不进场景的灵宠（构造函数只建字段；外部服务记下调用） */
function bare(id, level = 1) {
  const calls = [];
  const host = {
    ctx: { time: { now: 0 }, player: { position: new THREE.Vector3(), getForward: o => o.set(0, 0, 1) } },
    fx: { burst() {}, pillar: (...a) => calls.push(['pillar', ...a]) },
    floatText: (_p, t) => calls.push(['say', t]), banner: t => calls.push(['banner', t]), toast: t => calls.push(['toast', t]),
    flash() {}, leveledUp: () => calls.push(['level']),
  };
  const p = new Pet(host, DEFS.getPetDef(id));
  p.level = level;
  p.behaviour = { onAwaken: () => calls.push(['awaken']), skill: () => true };
  return { p, calls };
}

test('灵契：经验够了连升、3 级觉醒（横幅 + 觉醒说明）、满级经验归零；伤害每级 +15%、灵技冷却每级 −6%', () => {
  const { p, calls } = bare('dangkang');
  p.addXp(5);
  assert.deepEqual([p.level, p.xp], [1, 5]);
  p.addXp(1 + 10 + 3);
  assert.deepEqual([p.level, p.xp], [3, 3]);
  assert.ok(p.awakened);
  assert.deepEqual(calls.filter(c => c[0] === 'awaken').length, 1);
  assert.ok(calls.some(c => c[0] === 'banner' && c[1] === '灵契觉醒 · 当康'));
  assert.ok(calls.some(c => c[0] === 'toast' && c[1] === p.def.awakenDesc));
  assert.ok(calls.some(c => c[0] === 'say' && c[1] === '灵契 Lv.2'));
  p.addXp(1000);
  assert.deepEqual([p.level, p.xp, p.xpNext], [5, 0, 0]);
  p.addXp(5);
  assert.equal(p.xp, 0, '满级不再加');
  assert.equal(p.damageMult, 1 + 0.15 * 4);
  assert.ok(Math.abs(p.skillCooldown - 18 * (1 - 0.06 * 4)) < 1e-9);
  p.addXp(-3);
  assert.equal(p.level, 5);
});

test('灵技：冷却好了才放、正在普攻就排队（1.6 s 内动作结束即放）；放出后进冷却（TryCast / Cast）', () => {
  const { p } = bare('huan', 2);
  p.skillLeft = 3;
  assert.equal(p.tryCast(), false, '冷却中');
  p.skillLeft = 0;
  assert.equal(p.tryCast(), true);
  assert.ok(Math.abs(p.skillLeft - 20 * 0.94) < 1e-9, '2 级：20 × 0.94');
  // 正在出手：排队
  p.skillLeft = 0;
  p.act((function* () { yield 1; })());
  assert.equal(p.isBusy, true);
  assert.equal(p.tryCast(), true, '排上队也算');
  assert.equal(p.skillLeft, 0, '排队时还没放');
  p.released = true;
  assert.equal(p.tryCast(), false, '解除结契后不放');
});

test('灵宠的伤害请求就是 PetContract.petHit（来源 pet、不随机暴击、带 pet 标签）再乘灵契倍率', () => {
  const { p } = bare('zheng', 3);
  const req = p.info(10, 'fire', 0.4);
  const want = petHit(10 * p.damageMult, 'fire', 0.4);
  assert.deepEqual(req, want);
  assert.equal(req.base, 10 * 1.3);
  assert.equal(p.info(5, 'none', 0, 1).procDepth, 1, '衍生伤害（闪电跳跃）带深度');
});

// ───────────── 八只的行为常量（PetBehaviours.cs）─────────────

/**
 * 各只的常量（Unity Pets/PetBehaviours.cs 各 sealed class 的 const 段，行号是类声明处）与普攻间隔 / 攻击距离
 * （override AttackInterval / AttackRange；没写的取基类 PetBehaviour 的 1 / 2，PetBehaviours.cs:28–29）。
 */
const BEHAVIOUR_TABLE = {
  // PetBehaviours.cs:84 DangkangBehaviour；AttackInterval => 2.4f、AttackRange => ChargeRange
  Dangkang: { consts: { ChargeRange: 12, ChargeDamage: 22, ChargeStun: 0.5, AwakenStun: 0.3, ChargeSpeed: 16, RushLength: 18, RushDamage: 90, RushStun: 1.2, RushSpeed: 26, RushWidth: 1.6 }, interval: 2.4, range: 12 },
  // :219 HuanBehaviour；AttackInterval => 1f、AttackRange => 1.9f
  Huan: { consts: { ClawDamage: 4, MimicEvery: 10, MimicRadius: 10, MimicTime: 3, SkillRadius: 16, SkillTime: 5, SkillTaken: 1.25, AwakenSlow: 0.3, Claws: 3 }, interval: 1, range: 1.9 },
  // :320 JingweiBehaviour；AttackInterval => 1.3f，AttackRange 没覆写（取基类 2；另覆写了 CanAttack：飞到目标上空、看得见就投石）
  Jingwei: { consts: { StoneDamage: 16, StoneBurn: 0.5, RainDamage: 24, RainRadius: 5, Gravity: 22, PebbleRegrow: 0.6, PebbleSize: 0.16, RainCount: 10 }, interval: 1.3, range: 2 },
  // :442 ChongmingBehaviour；AttackInterval => 0.7f、AttackRange => Range
  Chongming: { consts: { BoltDamage: 9, BoltShock: 0.4, Range: 20, Bounce: 8, ChainDamage: 60, ChainRange: 12, Bolts: 2, ChainHops: 8 }, interval: 0.7, range: 20 },
  // :561 SuanniBehaviour；AttackInterval => 0.25f、AttackRange => ConeRange
  Suanni: { consts: { ConeRange: 6, ConeHalfAngle: 32, TickDamage: 4, CorrodeChance: 0.25, ShieldBonus: 20, RoarShield: 30, RoarRadius: 5, RoarStun: 1, RoarCooldown: 15, SkillRadius: 10, SkillStun: 1.5, SkillReduction: 0.4, SkillBuff: 5, MistEvery: 1, MistRadius: 2.2, MistTime: 3 }, interval: 0.25, range: 6 },
  // :730 ZhengBehaviour；AttackInterval => 1.4f、AttackRange => PounceRange
  Zheng: { consts: { TailDamage: 7, PounceRange: 8, StoneRange: 6, StoneRate: 0.08, StoneTime: 5, RendDamage: 100, RendRange: 18, RendSpeed: 34, StoneMax: 3, RendTargets: 5 }, interval: 1.4, range: 8 },
  // :875 BaizeBehaviour；AttackInterval => 1f、AttackRange => ShotRange
  Baize: { consts: { CritBonus: 0.5, AwakenCritBonus: 0.8, InsightRange: 25, InsightBonus: 1.2, ShotDamage: 30, ShotRange: 25, ScrollRadius: 30, ScrollStun: 1.5, ScrollTaken: 1.6, ScrollTime: 8, VacuumRange: 25, Shots: 3 }, interval: 1, range: 25 },
  // :1001 YinglongBehaviour；AttackInterval => 0.2f、AttackRange => BreathRange
  Yinglong: { consts: { RainRange: 28, RainDamage: 50, BreathDamage: 20, BreathRange: 22, BreathShock: 0.15, StormTime: 6, StormRate: 12, StormDamage: 70, StormRange: 30, PearlRise: 0.4, PearlHeight: 1.5, PearlReturn: 0.35, PearlSpin: 90 }, interval: 0.2, range: 22 },
};

test('八只的行为常量与 C# 同名同值（伤害 / 范围 / 间隔 / 冷却 / 层数），普攻间隔与攻击距离照 AttackInterval / AttackRange', () => {
  const table = { Dangkang: BEH.DANGKANG, Huan: BEH.HUAN, Jingwei: BEH.JINGWEI, Chongming: BEH.CHONGMING, Suanni: BEH.SUANNI, Zheng: BEH.ZHENG, Baize: BEH.BAIZE, Yinglong: BEH.YINGLONG };
  for (const [name, ts] of Object.entries(table)) {
    const want = BEHAVIOUR_TABLE[name];
    for (const [k, v] of Object.entries(want.consts)) assert.equal(ts[k], v, `${name}.${k}`);
    // TS 里多出来的键只能是 AttackInterval / AttackRange
    for (const k of Object.keys(ts)) assert.ok(k in want.consts || k === 'AttackInterval' || k === 'AttackRange', `${name}.${k} 在 C# 里没有`);
    const inst = BEH.BEHAVIOURS[name.toLowerCase()]();
    assert.equal(inst.attackInterval, want.interval, `${name}.AttackInterval`);
    assert.equal(inst.attackRange, want.range, `${name}.AttackRange`);
  }
  // 讙的学舌台词（PetBehaviours.cs:223 Phrases）
  assert.deepEqual([...BEH.HUAN_PHRASES], ['这边！', '来打我呀～', '喵！', '看这儿看这儿！', '（学你说话）', '嘿，打不着！']);
  // 元素色（Combat/Damage.cs:167–169 DamageTable.ElementColor）
  assert.deepEqual([...BEH.ELEMENT_RGB.fire], [1, 0.55, 0.2]);
  assert.deepEqual([...BEH.ELEMENT_RGB.shock], [0.55, 0.75, 1]);
  assert.deepEqual([...BEH.ELEMENT_RGB.corrode], [0.6, 0.9, 0.3]);
});

test('各只用到的玩家属性 / 状态 / 战斗钩子照 C#：狻猊护盾上限 +20、伤害减免 +40%；狰射速 +8%；白泽暴击伤害 +50% / +80%、改判弱点', () => {
  // C#：PetBehaviours.cs:582 `Stats?.Add(Source, Stat.MaxShield, ShieldBonus)`、:685 `Stat.DamageReduction, SkillReduction`、
  // :812 `Stat.FireRatePct, StoneRate * stacks.Count`、:911 `Stat.CritDamagePct, pet.Awakened ? AwakenCritBonus : CritBonus`、:892 `Combat.ForceWeakpoint.Add`
  const web = src('../src/pets/PetBehaviours.ts');
  assert.match(web, /stats\.add\('maxShield', SUANNI\.ShieldBonus, this\.source\)/);
  assert.match(web, /stats\.add\('damageReduction', C\.SkillReduction, this\.buffSource\)/);
  assert.match(web, /s\.add\('fireRatePct', ZHENG\.StoneRate \* this\.stacks\.length, this\.stoneSource\)/);
  assert.match(web, /s\.add\('critDamagePct', this\.pet\.awakened \? BAIZE\.AwakenCritBonus : BAIZE\.CritBonus, this\.source\)/);
  assert.match(web, /addForceWeakpoint\(\(\) => true\)/);
  // 行为表：八只都有
  assert.deepEqual(Object.keys(BEH.BEHAVIOURS).sort(), DEFS.PET_LIBRARY.map(d => d.behaviour).sort());
});

test('当康丰年冲的路径判定：点到线段的水平距离（SegmentDistance）', () => {
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(0, 0, 10);
  assert.equal(BEH.segmentDistance(new THREE.Vector3(1.5, 5, 4), a, b), 1.5);
  assert.equal(BEH.segmentDistance(new THREE.Vector3(0, 0, -2), a, b), 2);
  assert.equal(BEH.segmentDistance(new THREE.Vector3(3, 0, 14), a, b), 5);
  assert.equal(BEH.segmentDistance(new THREE.Vector3(0, 0, 3), a, a), 3, '退化线段');
});

// ───────────── 毛发（FurBake 的规则）─────────────

test('毛发遮罩：每骨倍数按通配符、后写的覆盖先写的（FurSettings.BoneMultiplier）；骨架坐标 → 模型空间', () => {
  assert.deepEqual(Object.keys(FUR_DATA), ['huan', 'suanni', 'zheng', 'baize', 'yinglong'], '五只有毛发壳层（SK_Pet_*.art.json 的 fur 段）');
  // 发丝格子密度缺省 = 1 / (0.35 × 毛长)（Pipeline/Editor/FurBake.cs:55）、壳层数缺省 16（:48，毛 / 羽 16 / 10）
  for (const [id, f] of Object.entries(FUR_DATA)) {
    assert.ok(Math.abs(f.density - 1 / (0.35 * f.length)) < 1e-3, `${id} 密度`);
    assert.equal(f.shells, 16, `${id} 壳层`);
  }
  const fur = FUR_DATA.yinglong;
  assert.equal(FUR.boneMultiplier(fur, 'head'), 0, '应龙只有鬃毛长毛');
  assert.equal(FUR.boneMultiplier(fur, 'mane_3'), 1);
  const huan = FUR_DATA.huan;
  assert.equal(FUR.boneMultiplier(huan, 'tailC_2'), 1.25);
  assert.equal(FUR.boneMultiplier(huan, 'paw_L'), 0.4);
  assert.equal(FUR.boneMultiplier(huan, 'spine'), 1, '没写的 1');
  assert.equal(FUR.boneMultiplier(huan, 'bell'), 0);
  // Blender 骨架（前 −Y、左 +X、上 +Z）→ glTF 模型（前 +Z、左 +X、上 +Y）
  assert.deepEqual(FUR.rigToModel([0.1, -0.3, 0.4]).toArray(), [0.1, 0.4, 0.3]);
  // 壳层材质的根部压暗 / 发梢提亮（Art/Characters/SK_Pet_*/M_Pet_*_FurShell.mat 第 43 行 _FurRootShade: 0.8、第 46 行 _FurTipLight: 0.06，五只相同）
  assert.equal(FUR.FUR_ROOT_SHADE, 0.8);
  assert.equal(FUR.FUR_TIP_LIGHT, 0.06);
});

// ───────────── RunSuspendTests（灵宠那几条）─────────────

const Save = await importTs('../src/core/SaveService.ts');
const { SaveService } = Save;
const Suspend = await importTs('../src/progression/RunSuspend.ts');
const RunPlan = await importTs('../src/progression/RunPlan.ts');
const StagePlan = await importTs('../src/progression/StagePlan.ts');
SaveService.quiet = true;
SaveService.deferWrites = false;

function fresh() {
  const m = new Map();
  const store = { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k) };
  SaveService.forceDev = false;
  SaveService.devSource = null;
  SaveService.currentRun = null;
  SaveService.useRoot(null);
  SaveService.useStorage(store);
  Suspend.RunSuspend.reset();
  Suspend.RunSuspend.ensureInstalled();
  RunPlan.setCurrentRun(null);
  StagePlan.setSceneReady(s => !s.alt);
  return store;
}

function sampleRun(over = {}) {
  const run = {
    heroId: 'fox', seed: 123456789, chapter: 0, stageIndex: 0, stage: RunPlan.toNode(StagePlan.STAGES[0]),
    coins: 287, kills: 64, damageDealt: 98765.25, time: 431.5, stagesCleared: 1, essence: 19, difficulty: 1, flags: {},
  };
  RunPlan.beginRun(run, StagePlan.canonical('1-2'), null, false);
  return Object.assign(run, { hp: 63.5, shield: 12, ...over });
}

test('RoundTripKeepsEveryField 的灵宠：续玩档写盘再读回，id / 灵契等级 / 经验 / 灵技冷却剩余原样（RunSuspendTests）', () => {
  // Unity Tests/RunSuspendTests.cs:79 `run.pet = new PetSave { id = PetLibrary.All[0].id, level = 3, xp = 7.5f, cooldownLeft = 4.25f };`（:125–128 逐项断言）
  const [level, xp, cd] = [3, 7.5, 4.25];
  const store = fresh();
  const run = sampleRun({ pet: { id: DEFS.PET_LIBRARY[0].id, level, xp, cooldownLeft: cd } });
  assert.equal(Suspend.write(run, false), true);
  const disk = JSON.parse(store.m.get('spiritfire.save/run.json'));
  assert.deepEqual(disk.run.pet, { id: 'dangkang', level: 3, xp: 7.5, cooldownLeft: 4.25 });
  const r = Suspend.read(false);
  assert.equal(r.status, 'ok', r.error);
  assert.deepEqual(r.result.run.pet, { id: run.pet.id, level, xp, cooldownLeft: cd });
  // 没有灵宠：写 null、读回来没有
  fresh();
  Suspend.write(sampleRun(), false);
  assert.equal(Suspend.read(false).result.run.pet ?? null, null);
});

test('坏档：灵宠等级为负 / 经验、冷却不是数 = 灵宠数值不合法（RunSuspend.Validate）', () => {
  // Unity Core/RunSuspend.cs:335 `run.pet.level < 0 || !float.IsFinite(run.pet.xp) || !float.IsFinite(run.pet.cooldownLeft)`
  const store = fresh();
  Suspend.write(sampleRun({ pet: { id: 'huan', level: 2, xp: 1, cooldownLeft: 0 } }), false);
  const text = JSON.parse(store.m.get('spiritfire.save/run.json'));
  text.run.pet.level = -1;
  store.m.set('spiritfire.save/run.json', JSON.stringify(text));
  const r = Suspend.read(false);
  assert.equal(r.status, 'corrupt');
  assert.match(r.error, /灵宠数值不合法/);
  text.run.pet = 'huan';
  store.m.set('spiritfire.save/run.json', JSON.stringify(text));
  assert.equal(Suspend.read(false).status, 'corrupt', 'pet 不是对象');
});

test('图鉴：灵宠条目 = 灵宠名录（PetLibrary 的顺序），副标题「品阶 · 称号」（RunSuspendTests / CodexCatalog）', () => {
  // Unity Tests/RunSuspendTests.cs:532 `Assert.AreEqual(PetLibrary.All.Length, CodexCatalog.Of(CodexKind.Pet).Count)`；
  // Progression/Codex.cs:298 `subtitle = $"{PetRarities.Name(p.rarity)} · {p.title}"`
  const pets = DEFS.PET_LIBRARY.map(DEFS.defView);
  const cat = new CX.CodexCatalog({ weapons: [], scrolls: [], enemies: [], pets, rarityName: () => '', rarityColor: () => [1, 1, 1, 1], elementColor: () => [1, 1, 1, 1] });
  assert.equal(cat.of('pet').length, DEFS.PET_LIBRARY.length);
  assert.deepEqual(cat.of('pet').map(e => e.id), DEFS.PET_LIBRARY.map(d => d.id));
  assert.equal(cat.find('pet', 'baize').subtitle, '神兽 · 万鬼图鉴');
  assert.equal(cat.find('pet', 'jingwei').def.passiveName, undefined, '精卫没有被动');
});

// ───────────── HudWidgetTests ─────────────

test('HitMarkerOnlyForDirectPlayerHits：灵宠的命中 / 击杀不出命中标记（还有跳伤、衍生、反应、静默处决）', () => {
  // Unity Tests/HudWidgetTests.cs:79 `CountsAsPlayerHit(new DamageInfo { source = DamageSource.Pet }), Is.False, "灵宠"`
  const hit = (request) => CrosshairWidget.countsAsPlayerHit({ request, dealt: 5 });
  assert.equal(hit({ source: 'weapon' }), true);
  assert.equal(hit({ source: 'skill' }), true);
  assert.equal(hit({ source: 'status' }), false, '持续伤害跳伤');
  assert.equal(hit({ source: 'pet', tags: ['pet'] }), false, '灵宠');
  assert.equal(hit({ source: 'weapon', procDepth: 1 }), false, '弹射 / 衍生');
  assert.equal(hit({ source: 'explosion', tags: ['explosion', 'reaction'] }), false, '反应伤害');
  assert.equal(hit({ source: 'weapon', tags: ['purge'] }), false, '静默处决');
  // HUD 部件注册表里有灵宠面板（id 'pet'，order 50 = Unity UI/Widgets/PetPanelWidget.cs:13 [HudWidget("pet", Order = 50)]）
  const panel = src('../src/ui/hud/PetPanelWidget.ts');
  assert.match(panel, /readonly id = 'pet';/);
  assert.match(panel, /override readonly order = 50;/);
});

// ───────────── 嘲讽（EnemyAI.Taunt / HitTarget / Decoys）─────────────

test('嘲讽：被嘲讽的敌人走位 / 瞄准 / 近战都对着诱饵，近战打在诱饵上无效（冒「格挡」），到时或诱饵没了就还给玩家', async () => {
  // Unity Enemies/EnemyAI.cs:857 `tauntUntil = taunt == decoy ? Mathf.Max(tauntUntil, Time.time + seconds) : Time.time + seconds;`、
  // :884 `blockTextAt = Time.time + 0.45f;`
  const g2 = await tsGraph({});
  try {
    const { EnemyBase } = await g2.load('enemies/EnemyBase.ts');
    class Dummy extends EnemyBase {
      buildModel() { return new THREE.Group(); }
      think() {}
      hitIt(range) { return this.melee(range, 10, -1); }
      get target() { return this.targetPos; }
    }
    const floats = [], hurts = [];
    const ctx = {
      time: { now: 0, dt: 0.016 },
      player: { position: new THREE.Vector3(0, 0, 10), eye: new THREE.Vector3(0, 1.6, 10), radius: 0.4 },
      combat: { damagePlayer: (a) => (hurts.push(a), a) },
      audio: { play() {} },
      ui: { floatText: (p, t) => floats.push(t) },
      world: { segmentBlocked: () => false },
    };
    const e = new Dummy(ctx, { id: 'd', name: 'd', hp: 100, speed: 3, radius: 0.5, height: 1.8, damage: 10, coins: [0, 0] }, { position: new THREE.Vector3() });
    const decoy = { position: new THREE.Vector3(0, 0, 1.2), alive: true };
    assert.equal(e.taunted, false);
    assert.equal(e.target, ctx.player.position);
    e.taunt(decoy, 3, 0.36);
    assert.equal(e.taunted, true);
    assert.equal(e.target, decoy.position, '走位 / 朝向对着诱饵');
    assert.deepEqual(e.playerChest(new THREE.Vector3()).toArray(), [0, 0.36, 1.2], '瞄准点 = 诱饵离地 eyeHeight');
    assert.equal(e.hitIt(1.5), false, '打到诱饵无效');
    assert.deepEqual([hurts.length, floats], [0, ['格挡']]);
    ctx.time.now = 0.2;
    e.hitIt(1.5);
    assert.equal(floats.length, 1, '「格挡」全场节流 0.45 s');
    // 重复嘲讽取更晚的结束时间；换了诱饵按新的算
    e.taunt(decoy, 1);
    ctx.time.now = 2.9;
    assert.equal(e.taunted, true);
    ctx.time.now = 3.1;
    assert.equal(e.taunted, false, '到时');
    assert.equal(e.target, ctx.player.position);
    e.taunt(decoy, 5);
    decoy.alive = false;
    assert.equal(e.taunted, false, '诱饵没了（换宠 / 解除结契）');
    // 不被嘲讽时照常打玩家
    ctx.player.position.set(0, 0, 1);
    assert.equal(e.hitIt(1.5), true);
    assert.equal(hurts.length, 1);
  } finally {
    await g2.dispose();
  }
});

/** 能 new 出 PetSystem、跑 init 的模块图：灵宠美术 / 特效 / 动画数据都打桩（node 里不读 GLB、不 fetch） */
async function petSystemGraph() {
  return tsGraph({
    'pets/PetVisuals.ts': `export const SOCKET_NAMES = []; export function buildPetModel() { return null; } export function disposePetModel() {}
      export function modelRigged() { return false; } export function socketOf() { return null; } export function instantiatePart() { return null; }`,
    'pets/PetFx.ts': `import * as THREE from 'three';
      export function glowSprite() { return new THREE.Object3D(); } export function marker() { return null; } export function textLabel() { return new THREE.Object3D(); }
      export function disposeObject() {}
      export class PetFxSystem { constructor() { this.group = new THREE.Group(); } attach() {} burst() {} pillar() {} beam() {} timedMarker() {} update() {} clear() {} }`,
    'pets/PetSeal.ts': 'export class PetSeal {}',
    'assets/AssetLibrary.ts': 'export const AssetLibrary = {};',
    'anim/ClipPlayer.ts': 'export function clipData() { return Promise.resolve(null); }',
  });
}

test('嘲讽只挡 Unity 也挡的那几条路：灵宠系统不给 Combat 挂全局受伤修饰器——被嘲讽的首领、敌人的爆炸照样伤玩家', async () => {
  // Unity 只在这几处按 Taunted 挡伤害：Enemies/EnemyAI.cs:870–877 HitTarget、AI/Inferno/InfernoKit.cs:554–561 HitPlayer、
  // EnemyProjectile.cs:156 / :228 / :248 spirit 弹、各 AI 自己的 `if (Taunted)`；而 Bosses/BossHazards.cs:390–396 Hurt →
  // `Combat.DamagePlayer(damage, …, owner)`、Combat.cs:372–379 DamagePlayer、Enemies/Hazards/Blast.cs:51 Blast.Player 都不看嘲讽
  const g = await petSystemGraph();
  try {
    const { PetSystem } = await g.load('pets/PetSystem.ts');
    const rig = await combatRig(g, THREE);
    const mods = [];
    const addIncoming = rig.ctx.combat.addIncomingModifier.bind(rig.ctx.combat);
    rig.ctx.combat.addIncomingModifier = fn => (mods.push(fn), addIncoming(fn));
    Object.assign(rig.ctx, { loot: {}, game: { debug: false }, input: { enabled: false } });
    const sys = new PetSystem(rig.ctx);
    sys.init();
    assert.equal(mods.length, 0, '灵宠系统不挂受伤修饰器（旧版把被嘲讽者的伤害一刀切记 0）');
    const decoy = { position: new THREE.Vector3(0, 0, 1), alive: true };
    const boss = { id: 90, isBoss: true, taunted: true, position: new THREE.Vector3(0, 0, 3), decoyBlocked() {} };
    const hp0 = rig.ctx.player.hp;
    rig.ctx.combat.damagePlayer(20, 'fire', boss, boss.position);
    assert.equal(hp0 - rig.ctx.player.hp, 20, '被讙嘲讽的首领：首领招式（BossHazards.Hurt）照样伤玩家');
    // 普通敌人被嘲讽时：直接命中（hitTarget = HitTarget）挡掉、冒「格挡」；它的爆炸（Blast.Player）照样伤
    const { EnemyBase } = await g.load('enemies/EnemyBase.ts');
    const { blastPlayer } = await g.load('enemies/Hazards.ts');
    class Dummy extends EnemyBase {
      buildModel() { return new THREE.Group(); }
      think() {}
      strike() { return this.hitTarget(10, 'none', this.position); }
    }
    const floats = [];
    Object.assign(rig.ctx.player, { radius: 0.4, height: 1.8, velocity: new THREE.Vector3(), applyImpulse() {} });
    rig.ctx.ui.floatText = (_p, t) => floats.push(t);
    rig.ctx.world.segmentBlocked = () => false;
    rig.ctx.player.takeDamage = function (n) { this.hp -= n; return n; };
    const e = new Dummy(rig.ctx, { id: 'd', name: 'd', hp: 100, speed: 3, radius: 0.5, height: 1.8, damage: 10, coins: [0, 0] }, { position: new THREE.Vector3(0, 0, 2) });
    e.taunt(decoy, 3);
    const hp1 = rig.ctx.player.hp;
    assert.equal(e.strike(), false, '直接命中打在诱饵上无效');
    assert.deepEqual([rig.ctx.player.hp, floats], [hp1, ['格挡']]);
    blastPlayer(rig.ctx, new THREE.Vector3(0, 1, 0.5), 3, 12, 'fire', e, 0.5, 0, 0);
    assert.ok(rig.ctx.player.hp < hp1, '被嘲讽者的爆炸不看嘲讽（Blast.Player），照样伤');
    // 不被嘲讽时直接命中照常
    decoy.alive = false;
    const hp2 = rig.ctx.player.hp;
    assert.equal(e.strike(), true);
    assert.equal(hp2 - rig.ctx.player.hp, 10);
    sys.clear();
  } finally {
    await g.dispose();
  }
});

test('嘲讽的各路判断照 Unity 逐只翻在 src/enemies：首领没有、近战 / 直接命中 / 地波 / 自爆 / 灵体弹有', () => {
  // 首领的招式在 Unity 只有 BossBrain.HitPlayer → HitTarget（BossBrain.cs:1061，只有 Proxy 首领用，网页没有）挡；网页首领一处都不该挡
  const bossFiles = ['Hazards.ts', 'BossBase.ts', 'Hanba.ts', 'KunPeng.ts', 'Qilin.ts', 'Warlord.ts', 'lords/Huashe.ts', 'lords/FeilianMoves.ts'];
  for (const f of bossFiles) assert.doesNotMatch(src(`../src/enemies/bosses/${f}`), /taunted/, `首领 ${f} 不看嘲讽`);
  // 各 AI 的出处（照 Unity 行号核对过的几处，改掉了这里会红）
  const want = [
    ['types/FireRat.ts', /if \(this\.taunted\) \{\s*this\.decoyBlocked\(\);/], // FireRatAI.cs:342 Taunted → DecoyBlocked + Blast.Shake
    ['types/TombBeast.ts', /rise < WAVE_JUMP_CLEAR && !source\.taunted/], // GroundWave.cs:151 owner.Taunted → 跳过
    ['types/IcePuffer.ts', /if \(this\.taunted\) this\.decoyBlocked\(\);\s*else blastPlayer/], // IcePufferAI.cs:231
    ['types/FireCrow.ts', /if \(this\.taunted\) this\.decoyBlocked\(\);\s*else blastPlayer/], // FireCrowAI.cs:283
    ['types/Qingniao.ts', /if \(this\.swoopHit \|\| this\.taunted\) return;/], // QingniaoAI.cs:355
    ['types/XuanGui.ts', /pl\.alive && !this\.taunted && now - this\.lastSpinHit/], // XuanGuiAI.cs:506
    ['types/Mamian.ts', /pl\.alive && !this\.taunted && !pl\.isDashing/], // MamianAI.cs:410
    ['types/IronOx.ts', /if \(!pl\.alive \|\| this\.taunted\) return;/], // IronOxAI.cs:351
    ['types/Tuo.ts', /!this\.roarHit && pl\.alive && !this\.taunted/], // TuoAI.cs:880 GroundWave（owner = this）
    ['types/Haozhi.ts', /enemyDamage: spirit \? 0 : damage/], // HaozhiAI.cs:84 spirit = Taunted
    ['types/Jiaoren.ts', /enemyDamage: spirit \? 0 :/], // JiaorenAI.cs:330
    ['fx/MirageFireball.ts', /if \(spec\.spirit\) \{\s*spec\.source\?\.decoyBlocked\?\.\(\);\s*return;/], // MirageToadAI.cs:372 if (!spirit) FireZone
    ['fx/FrostPackFx.ts', /if \(spec\.spirit\) spec\.source\?\.decoyBlocked\?\.\(\);\s*else blastPlayer/], // XingxingAI.cs:420
    ['fx/FrostRangedFx.ts', /p\.alive && !s\.source\?\.taunted && d <= s\.radius/], // IceWhalePillar.cs:146
    ['Affixes.ts', /!e\.alive \|\| !!e\.taunted/], // EliteAffix_Swift.cs:124
  ];
  for (const [f, re] of want) assert.match(src(`../src/enemies/${f}`), re, f);
  // 不挡的几路：毕方的火矛、炭童的炭块（EnemyProjectile 没设 spirit：BifangAI.cs:446、TantongAI.cs:411）
  assert.doesNotMatch(src('../src/enemies/fx/InfernoRangedFx.ts'), /taunted/);
  assert.doesNotMatch(src('../src/enemies/fx/InfernoPackFx.ts'), /taunted/);
});

test('精卫火石落地爆炸照 PlayerProjectile.Impact：边缘 30%、播爆炸特效和爆炸声（色 = 弹体色 0xffd9a0）', async () => {
  // Combat/Projectiles/ProjectileSpecs.cs:72 `explosionFalloff = 0.3f;`、:83 `color = new Color(1f, 0.851f, 0.627f);`；
  // PlayerProjectile.cs:443–447 `falloff = explosionFalloff, …, color = color`（没设 noFx）；Combat.cs:426–430 没有 noFx 就播 Fx.Explosion + "explosion"
  const { STONE_FALLOFF, STONE_EXPLOSION_COLOR } = await graph.load('pets/Pet.ts');
  assert.equal(STONE_FALLOFF, 0.3);
  assert.equal(STONE_EXPLOSION_COLOR, (255 << 16) | (Math.round(0.851 * 255) << 8) | Math.round(0.627 * 255));
  const g = await petSystemGraph();
  try {
    const { PetSystem } = await g.load('pets/PetSystem.ts');
    const booms = [];
    const ctx = {
      combat: { explode: (c, r, req, o) => (booms.push({ r, o: { ...o } }), 0) },
      enemies: { raycast: () => null },
      world: { raycast: () => false, groundHeight: () => 0 },
      fx: { tracer() {} },
    };
    const sys = new PetSystem(ctx);
    sys.current = { released: false };
    let landed = 0;
    sys.throwStone({
      from: new THREE.Vector3(0, 1, 0), velocity: new THREE.Vector3(0, -6, 0), gravity: 22, radius: 0.15, life: 2, explodeRadius: 2.4,
      request: { base: 16, element: 'fire', source: 'pet' }, partId: '', size: 0.16, glow: [1, 0.5, 0.2], onImpact: () => landed++,
    });
    for (let i = 0; i < 20 && booms.length === 0; i++) sys.updateStones(1 / 30);
    assert.equal(booms.length, 1, '落地炸一次');
    assert.deepEqual(booms[0], { r: 2.4, o: { falloff: 0.3, color: 0xffd9a0 } }, '不带 noFx：播爆炸特效和爆炸声');
    assert.equal(landed, 1, '再回调落地特效（ShotFx.Impact / MuzzleFlash / Telegraph.Wave）');
  } finally {
    await g.dispose();
  }
});
