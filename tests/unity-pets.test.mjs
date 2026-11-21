// M9 灵宠（docs/threejs-migration.md 4.8）：网页 src/pets 对 Unity G/Pets/*.cs 的数，常量逐个从 C# 源码里读出来比（改了一边另一边就红）；
// 以及 Unity EditMode 测试里和灵宠相关的几条：RunSuspendTests（续玩档里的灵宠往返、坏档、图鉴灵宠条目数）、
// HudWidgetTests.HitMarkerOnlyForDirectPlayerHits（灵宠的命中不出命中标记）。Unity 没有专门的 PetTests：行为的数（伤害、范围、间隔、冷却、
// 灵契经验）在这里按 C# 常量逐只比，嘲讽在真的 EnemyBase 上跑一遍。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { cs, csConsts, csTest, tsGraph } from './unity-parity-kit.mjs';
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

const src = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const FUR_DATA = (await graph.load('pets/PetDefsData.ts')).PET_FUR_DATA;
const defsCs = cs('Pets/PetDefs.cs');
const petCs = cs('Pets/Pet.cs');
const ownerCs = cs('Pets/PetOwner.cs');
const behCs = cs('Pets/PetBehaviours.cs');

// ───────────── 定义（PetDefs.cs → PetDefsData.ts，导出器）─────────────

test('PetDefsData.ts 由当前 C# 导出（scripts/web/export-pet-defs.mjs --check）', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/web/export-pet-defs.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.match(out, /一致：8 只灵宠、5 只有毛发/);
});

test('八只灵宠：顺序、id、资产、品阶、飞行、灵技冷却照 PetLibrary.All', () => {
  const ids = [...defsCs.matchAll(/id = "(\w+)", assetId = "(\w+)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => [d.id, d.assetId]), ids);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.rarity), [0, 0, 0, 1, 1, 1, 2, 2]);
  assert.deepEqual(DEFS.PET_LIBRARY.filter(d => d.flying).map(d => d.id), ['jingwei', 'chongming', 'yinglong']);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.skillCooldown), [18, 20, 16, 20, 22, 18, 25, 25]);
  assert.deepEqual(DEFS.PET_LIBRARY.map(d => d.label), ['凡灵 · 当康', '凡灵 · 讙', '凡灵 · 精卫', '灵兽 · 重明鸟', '灵兽 · 狻猊', '灵兽 · 狰', '神兽 · 白泽', '神兽 · 应龙']);
  // 发光件：精卫的火石挂 pebble、应龙的宝珠挂 pearl
  assert.deepEqual(DEFS.PET_LIBRARY.filter(d => d.partId).map(d => [d.id, d.partId, d.partSocket]),
    [['jingwei', 'SM_PetPart_JingweiPebble', 'pebble'], ['yinglong', 'SM_PetPart_YinglongPearl', 'pearl']]);
  // 按 id / 资产 id 都能找到（PetLibrary.Get）
  assert.equal(DEFS.getPetDef('SK_Pet_Baize').id, 'baize');
  assert.equal(DEFS.getPetDef('nope'), null);
  assert.equal(DEFS.getPetDef(''), null);
});

test('品阶：凡灵 72% / 灵兽 25% / 神兽 3%（PetRarities.Roll），抽灵宠先抽品阶再在品阶里平均抽（PetLibrary.Roll）', () => {
  const w = defsCs.match(/Weights = \{ ([^}]+) \}/)[1].split(',').map(Number);
  assert.deepEqual(DEFS.PET_RARITY_WEIGHTS, w);
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
  assert.equal(DEFS.petForReward('pet:rarity=9', () => 0.99).rarity, 2, '超出夹住（Mathf.Clamp(tier, 0, 2)）');
  assert.equal(DEFS.petForReward('pet:rarity=x', () => 0).rarity, 0, '不是整数 = 按权重抽');
  assert.equal(DEFS.petForReward('pet', () => 0.98).rarity, 2);
  assert.equal(RULES.rewardKey('pet'), 'pet');
  assert.equal(RULES.rewardKey('pet:rarity=2'), 'pet');
  const chest = cs('Loot/Chest.cs');
  assert.match(chest, /case "pet": return "灵宠";/);
  assert.match(chest, /"pet" => "灵兽封印：结契一只灵宠"/);
  const plan = (await_read('../src/progression/RunPlan.ts'));
  assert.match(plan, /pet: '灵宠'/);
  assert.match(await_read('../src/progression/loot/Chests.ts'), /case 'pet':\s*\/\/[^\n]*\n\s*return '灵兽封印：结契一只灵宠';/);
});

function await_read(path) {
  return execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(new URL(path, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))}, 'utf8'))`], { encoding: 'utf8' });
}

test('精英掉封印 6%（EconomyConfig.ElitePetChance）、击杀给灵契经验 普通 1 / 精英 4（PetOwner）', () => {
  assert.equal(SYS.ELITE_PET_CHANCE, csConsts(cs('Core/EconomyConfig.cs')).ElitePetChance);
  const c = csConsts(ownerCs);
  assert.deepEqual([SYS.NORMAL_XP, SYS.ELITE_XP], [c.NormalXp, c.EliteXp]);
});

// ───────────── 本体（Pet.cs）─────────────

test('Pet 常量：交战 18 m、拴绳 22 m、卡住 3 s、记仇 3 s；灵契 1–5 级、3 级觉醒、经验 6 / 10 / 16 / 24', () => {
  const c = csConsts(petCs);
  assert.deepEqual([ENGAGE_RANGE, LEASH_RANGE, STUCK_TIME, TARGET_MEMORY], [c.EngageRange, c.LeashRange, c.StuckTime, c.TargetMemory]);
  assert.deepEqual([MAX_LEVEL, AWAKEN_LEVEL], [c.MaxLevel, c.AwakenLevel]);
  assert.deepEqual([...XP_NEED], petCs.match(/XpNeed = \{ ([^}]+) \}/)[1].split(',').map(Number));
  assert.match(petCs, /DamageMult => 1 \+ 0\.15f \* \(Level - 1\)/);
  assert.match(petCs, /CooldownMult => 1 - 0\.06f \* \(Level - 1\)/);
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

// ───────────── 八只的行为常量（PetBehaviours.cs）─────────────

/** C# 里 sealed class <Name>Behaviour 的类体 */
function classBody(name) {
  const i = behCs.indexOf(`public sealed class ${name}Behaviour`);
  assert.ok(i >= 0, name);
  const j = behCs.indexOf('public sealed class', i + 10);
  return behCs.slice(i, j < 0 ? undefined : j);
}

test('八只的行为常量与 C# 同名同值（伤害 / 范围 / 间隔 / 冷却 / 层数），普攻间隔与攻击距离照 AttackInterval / AttackRange', () => {
  const table = { Dangkang: BEH.DANGKANG, Huan: BEH.HUAN, Jingwei: BEH.JINGWEI, Chongming: BEH.CHONGMING, Suanni: BEH.SUANNI, Zheng: BEH.ZHENG, Baize: BEH.BAIZE, Yinglong: BEH.YINGLONG };
  const base = behCs.slice(behCs.indexOf('public abstract class PetBehaviour'), behCs.indexOf('public sealed class'));
  const baseOf = prop => Number(base.match(new RegExp(`virtual float ${prop} => ([\\d.]+)f;`))[1]);
  for (const [name, ts] of Object.entries(table)) {
    const body = classBody(name);
    const c = csConsts(body);
    for (const [k, v] of Object.entries(c)) assert.equal(ts[k], v, `${name}.${k}`);
    // TS 里多出来的键只能是 AttackInterval / AttackRange
    for (const k of Object.keys(ts)) assert.ok(k in c || k === 'AttackInterval' || k === 'AttackRange', `${name}.${k} 在 C# 里没有`);
    // 普攻间隔 / 攻击距离：C# 写的字面量或常量名；没写的用基类的 1 / 2
    const inst = BEH.BEHAVIOURS[name.toLowerCase()]();
    for (const [prop, key] of [['AttackInterval', 'attackInterval'], ['AttackRange', 'attackRange']]) {
      const m = body.match(new RegExp(`override float ${prop} => (\\w[\\w.]*?)f?;`));
      const want = !m ? baseOf(prop) : /^[\d.]+$/.test(m[1]) ? Number(m[1]) : c[m[1]];
      assert.equal(inst[key], want, `${name}.${prop}`);
    }
  }
  // 讙的学舌台词、白泽 / 应龙的颜色常量
  const phrases = classBody('Huan').match(/Phrases = \{ ([^}]+) \}/)[1].match(/"([^"]+)"/g).map(s => JSON.parse(s));
  assert.deepEqual([...BEH.HUAN_PHRASES], phrases);
  // 元素色（DamageTable.ElementColor）
  const dmg = cs('Combat/Damage.cs');
  for (const [el, name] of [['fire', 'Fire'], ['shock', 'Shock'], ['corrode', 'Corrode']]) {
    const m = dmg.match(new RegExp(`Element\\.${name} => new Color\\(([^)]+)\\)`))[1].split(',').map(s => Number(s.trim().replace(/f$/, '')));
    assert.deepEqual([...BEH.ELEMENT_RGB[el]], m, el);
  }
});

test('各只用到的玩家属性 / 状态 / 战斗钩子照 C#：狻猊护盾上限 +20、伤害减免 +40%；狰射速 +8%；白泽暴击伤害 +50% / +80%、改判弱点', () => {
  assert.match(classBody('Suanni'), /Stats\?\.Add\(Source, Stat\.MaxShield, ShieldBonus\)/);
  assert.match(classBody('Suanni'), /Stat\.DamageReduction, SkillReduction/);
  assert.match(classBody('Zheng'), /Stat\.FireRatePct, StoneRate \* stacks\.Count/);
  assert.match(classBody('Baize'), /Stat\.CritDamagePct, pet\.Awakened \? AwakenCritBonus : CritBonus/);
  assert.match(classBody('Baize'), /Combat\.ForceWeakpoint\.Add/);
  // 网页对应
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
  // 壳层材质的根部压暗 / 发梢提亮照 M_Pet_*_FurShell.mat
  const mat = src('../unity/Assets/Art/Characters/SK_Pet_Huan/M_Pet_Huan_FurShell.mat');
  assert.equal(FUR.FUR_ROOT_SHADE, Number(mat.match(/_FurRootShade: ([\d.]+)/)[1]));
  assert.equal(FUR.FUR_TIP_LIGHT, Number(mat.match(/_FurTipLight: ([\d.]+)/)[1]));
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
  const unity = csTest('RunSuspendTests.cs');
  const m = unity.match(/run\.pet = new PetSave \{ id = PetLibrary\.All\[0\]\.id, level = (\d+), xp = ([\d.]+)f, cooldownLeft = ([\d.]+)f \}/);
  assert.ok(m, 'Unity 测试里的样本');
  const [level, xp, cd] = [Number(m[1]), Number(m[2]), Number(m[3])];
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
  assert.match(cs('Core/RunSuspend.cs'), /run\.pet\.level < 0 \|\| !float\.IsFinite\(run\.pet\.xp\) \|\| !float\.IsFinite\(run\.pet\.cooldownLeft\)/);
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
  assert.match(csTest('RunSuspendTests.cs'), /Assert\.AreEqual\(PetLibrary\.All\.Length, CodexCatalog\.Of\(CodexKind\.Pet\)\.Count\)/);
  assert.match(cs('Progression/Codex.cs'), /subtitle = \$"\{PetRarities\.Name\(p\.rarity\)\} · \{p\.title\}"/);
  const pets = DEFS.PET_LIBRARY.map(DEFS.defView);
  const cat = new CX.CodexCatalog({ weapons: [], scrolls: [], enemies: [], pets, rarityName: () => '', rarityColor: () => [1, 1, 1, 1], elementColor: () => [1, 1, 1, 1] });
  assert.equal(cat.of('pet').length, DEFS.PET_LIBRARY.length);
  assert.deepEqual(cat.of('pet').map(e => e.id), DEFS.PET_LIBRARY.map(d => d.id));
  assert.equal(cat.find('pet', 'baize').subtitle, '神兽 · 万鬼图鉴');
  assert.equal(cat.find('pet', 'jingwei').def.passiveName, undefined, '精卫没有被动');
});

// ───────────── HudWidgetTests ─────────────

test('HitMarkerOnlyForDirectPlayerHits：灵宠的命中 / 击杀不出命中标记（还有跳伤、衍生、反应、静默处决）', () => {
  const unity = csTest('HudWidgetTests.cs');
  assert.match(unity, /CountsAsPlayerHit\(new DamageInfo \{ source = DamageSource\.Pet \}\), Is\.False, "灵宠"/);
  const hit = (request) => CrosshairWidget.countsAsPlayerHit({ request, dealt: 5 });
  assert.equal(hit({ source: 'weapon' }), true);
  assert.equal(hit({ source: 'skill' }), true);
  assert.equal(hit({ source: 'status' }), false, '持续伤害跳伤');
  assert.equal(hit({ source: 'pet', tags: ['pet'] }), false, '灵宠');
  assert.equal(hit({ source: 'weapon', procDepth: 1 }), false, '弹射 / 衍生');
  assert.equal(hit({ source: 'explosion', tags: ['explosion', 'reaction'] }), false, '反应伤害');
  assert.equal(hit({ source: 'weapon', tags: ['purge'] }), false, '静默处决');
  // HUD 部件注册表里有灵宠面板（id 'pet'，order 50 = Unity [HudWidget("pet", Order = 50)]）
  assert.match(cs('UI/Widgets/PetPanelWidget.cs'), /\[HudWidget\("pet", Order = 50\)\]/);
  const panel = src('../src/ui/hud/PetPanelWidget.ts');
  assert.match(panel, /readonly id = 'pet';/);
  assert.match(panel, /override readonly order = 50;/);
});

// ───────────── 嘲讽（EnemyAI.Taunt / HitTarget / Decoys）─────────────

test('嘲讽：被嘲讽的敌人走位 / 瞄准 / 近战都对着诱饵，近战打在诱饵上无效（冒「格挡」），到时或诱饵没了就还给玩家', async () => {
  const unity = cs('Enemies/EnemyAI.cs');
  assert.match(unity, /tauntUntil = taunt == decoy \? Mathf\.Max\(tauntUntil, Time\.time \+ seconds\) : Time\.time \+ seconds;/);
  assert.match(unity, /blockTextAt = Time\.time \+ 0\.45f;/);
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
