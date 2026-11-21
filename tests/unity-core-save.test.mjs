// M11d 核心 · 存档（docs/threejs-migration.md 4.7）：照 Unity EditMode 的 SaveServiceTests、RunSuspendTests、GraphicsAudioTests（设置项）逐条改写。
// 存储换成 Map 包出来的 localStorage；「重开游戏」= 再 useStorage 一次（丢掉已经读进来的文件）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './hanba-load.mjs';

const Save = await importTs('../src/core/SaveService.ts');
const { SaveService } = Save;
const Meta = await importTs('../src/progression/Meta.ts');
const { MetaSection, CareerSection, MetaProgress, bankRun, runSummaryFrom, TALENTS, TALENT_COSTS, talentTotalCost, BANKED_FLAG } = Meta;
const GS = await importTs('../src/core/GameSettings.ts');
const Settings = await importTs('../src/core/settings.ts');
const Suspend = await importTs('../src/progression/RunSuspend.ts');
const RunPlan = await importTs('../src/progression/RunPlan.ts');
const StagePlan = await importTs('../src/progression/StagePlan.ts');
const { RunRoute } = await importTs('../src/progression/RunRoute.ts');
const { Stats } = await importTs('../src/core/Stats.ts');

SaveService.quiet = true;
SaveService.deferWrites = false;

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k) };
}

const MAIN = 'spiritfire.save/profile.json', DEV = 'spiritfire.save/profile.dev.json', SHARED = 'spiritfire.save/settings.json';
const RUN = 'spiritfire.save/run.json', RUN_DEV = 'spiritfire.save/run.dev.json';

/** 每个测试一份干净的存储；返回 reopen() = 重开游戏 */
function fresh(init = {}) {
  const store = mem(init);
  SaveService.forceDev = false;
  SaveService.devSource = null;
  SaveService.currentRun = null;
  SaveService.useRoot(null);
  SaveService.useStorage(store);
  Suspend.RunSuspend.reset();
  Suspend.RunSuspend.ensureInstalled();
  RunPlan.setCurrentRun(null);
  StagePlan.setSceneReady(s => !s.alt);
  return { store, reopen: () => SaveService.useStorage(store) };
}

function newRun(over = {}) {
  const run = {
    heroId: 'fox', seed: 20261121, chapter: 0, stageIndex: 0, stage: RunPlan.toNode(StagePlan.STAGES[0]),
    coins: 0, kills: 0, damageDealt: 0, time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {},
  };
  RunPlan.beginRun(run, StagePlan.canonical(over.stage ?? '1-1'), null, !!over.dev);
  delete over.stage;
  delete over.dev;
  return Object.assign(run, over);
}

// ───────────── SaveService ─────────────

test('RoundTripKeepsMetaAndCareer：信封 v2、meta / career 两段，重开后原样读回', () => {
  const { store, reopen } = fresh();
  const file = SaveService.main;
  assert.equal(file.status, 'fresh');
  const meta = file.section(MetaSection), career = file.section(CareerSection);
  assert.deepEqual(meta.unlockedHeroes, ['fox', 'falcon', 'bear'], '默认三人全开');
  meta.addEssence(500);
  meta.talents.vitality = 2;
  meta.talents.mastery = 5;
  career.record({ victory: true, heroId: 'fox', chapter: 3, stagesCleared: 12, kills: 400, time: 1500.5, damageDealt: 123456.5, essenceEarned: 1300 });
  career.record({ victory: false, heroId: 'bear', chapter: 2, stagesCleared: 5, kills: 150, time: 600, damageDealt: 40000, essenceEarned: 300 });
  assert.equal(file.save(), true);
  const root = JSON.parse(store.m.get(MAIN));
  assert.equal(root.version, 2);
  assert.equal(root.game, 'spiritfire');
  assert.deepEqual(Object.keys(root.sections).sort(), ['career', 'meta']);
  assert.equal(root.sections.meta.v, 1);
  assert.ok(!store.m.has(MAIN + '.bak'), '第一次写：只有主文件');

  reopen();
  const f2 = SaveService.main;
  assert.equal(f2.status, 'loaded');
  assert.equal(f2.fileVersion, 2);
  assert.equal(f2.migrated, false);
  const m2 = f2.section(MetaSection), c2 = f2.section(CareerSection);
  assert.notEqual(m2, meta, '重开后是新的段实例');
  assert.equal(m2.essence, 500);
  assert.equal(m2.talentLevel('vitality'), 2);
  assert.equal(m2.talentLevel('mastery'), 5);
  assert.deepEqual([c2.runs, c2.wins, c2.deaths, c2.bestChapter, c2.bestStages, c2.totalKills, c2.mostKills], [2, 1, 1, 3, 12, 550, 400]);
  assert.equal(c2.fastestWin, 1500.5);
  assert.equal(c2.totalTime, 2100.5);
  assert.equal(c2.totalDamage, 163456.5);
  assert.equal(c2.totalEssence, 1600);
  assert.deepEqual(c2.deathsByChapter, [0, 1]);
  assert.equal(c2.deathsInChapter(2), 1);
  assert.equal(c2.runsAs('fox'), 1);
  assert.equal(c2.winsAs('fox'), 1);
  assert.equal(c2.winsAs('bear'), 0);
  assert.equal(c2.winRate, 0.5);
});

test('CorruptMainRecoversFromBackup：主文件截断 / 全 0 字节 → 从 .bak 恢复，坏文件挪成 .corrupt', () => {
  const { store, reopen } = fresh();
  let file = SaveService.main;
  let meta = file.section(MetaSection);
  meta.addEssence(100);
  file.save();
  assert.ok(!store.m.has(file.backupPath));
  meta.addEssence(50);
  file.save();
  assert.ok(store.m.has(file.backupPath), '第二次写：旧主文件（100）轮换成 .bak');
  // 写到一半断电：截断的 JSON
  store.m.set(MAIN, '{"version":2,"sections":{"meta":{"v":1,"data":{"essence":99');
  reopen();
  file = SaveService.main;
  let m = file.section(MetaSection);
  assert.equal(file.status, 'recoveredFromBackup');
  assert.equal(m.essence, 100, '回到 .bak 里的上一份');
  assert.ok(store.m.has(file.corruptPath), '坏文件留作排查');
  assert.ok(!store.m.has(MAIN), '坏文件挪开了，不会被轮换进 .bak');
  m.addEssence(1);
  file.save();
  assert.ok(store.m.has(MAIN));
  reopen();
  assert.equal(SaveService.main.status, 'loaded');
  assert.equal(SaveService.main.section(MetaSection).essence, 101);
  // 主文件变成一堆 0 字节，也从 .bak 恢复
  store.m.set(MAIN, '\0'.repeat(64));
  reopen();
  assert.equal(SaveService.main.status, 'recoveredFromBackup');
  assert.equal(SaveService.main.section(MetaSection).essence, 100);
});

test('BothCorruptFallsBackToDefaultsWithoutLosingTheFile：主文件和 .bak 都坏 → 默认值，坏文件留在 .corrupt', () => {
  const { store, reopen } = fresh({ [MAIN]: 'not json', [MAIN + '.bak']: '[1, 2, 3]' });
  const file = SaveService.main;
  const m = file.section(MetaSection);
  assert.equal(file.status, 'corrupt');
  assert.equal(m.essence, 0);
  assert.equal(store.m.get(file.corruptPath), 'not json');
  m.addEssence(7);
  file.save();
  reopen();
  assert.equal(SaveService.main.status, 'loaded');
  assert.equal(SaveService.main.section(MetaSection).essence, 7);
});

const WEB_V1 = '{"version":1,"essence":345.7,'
  + '"talents":{"vitality":3,"mastery":9,"bogus":-2,"lethal":"x","future":2},'
  + '"unlockedHeroes":["fox","ghost","",7],'
  + '"stats":{"runs":7,"wins":2,"bestChapter":3,"bestStages":11,"totalKills":812}}';

test('MigratesWebV1Save：信封 v1（老网页存档原样）迁成 v2 的 meta / career 段，按老规则清洗', () => {
  const { store, reopen } = fresh({ [MAIN]: WEB_V1 });
  let file = SaveService.main;
  const meta = file.section(MetaSection), career = file.section(CareerSection);
  assert.equal(file.status, 'loaded');
  assert.equal(file.migrated, true);
  assert.equal(file.fileVersion, 1);
  assert.equal(meta.essence, 345, '小数向下取整');
  assert.equal(meta.talentLevel('vitality'), 3);
  assert.equal(meta.talentLevel('mastery'), 5, '超过满级夹到 5');
  assert.equal(meta.talentLevel('lethal'), 0, '类型不对当 0');
  assert.ok(meta.unlockedHeroes.includes('ghost'), '网页版解锁过的保留');
  assert.ok(meta.unlockedHeroes.includes('falcon'), '默认英雄总在');
  assert.deepEqual([career.runs, career.wins, career.bestChapter, career.bestStages, career.totalKills], [7, 2, 3, 11, 812]);
  assert.equal(career.deaths, 5, '网页版没有阵亡数：按 局数 − 胜场 补');
  assert.equal(file.save(), true);
  const text = store.m.get(MAIN);
  assert.ok(text.includes('"version": 2'));
  assert.ok(text.includes('"sections"'));
  assert.ok(text.includes('"future"'), '不认识的天赋 id 原样保留');
  reopen();
  file = SaveService.main;
  assert.equal(file.status, 'loaded');
  assert.equal(file.migrated, false);
  assert.equal(file.fileVersion, 2);
  assert.equal(file.section(MetaSection).essence, 345);
  assert.equal(file.section(CareerSection).runs, 7);
});

test('老存档：localStorage 的 gunflame.meta.v1 第一次读时迁过来，老键不删不改；调试档读 gunflame.whitebox.meta.v1', () => {
  const lab = JSON.stringify({ version: 1, essence: 40, talents: {}, unlockedHeroes: ['fox'], stats: { runs: 1, wins: 0, bestChapter: 1, bestStages: 2, totalKills: 30 } });
  const { store, reopen } = fresh({ 'gunflame.meta.v1': WEB_V1, 'gunflame.whitebox.meta.v1': lab });
  const file = SaveService.main;
  assert.equal(file.status, 'loaded');
  assert.equal(file.importedLegacy, true);
  assert.equal(file.migrated, true);
  assert.equal(file.section(MetaSection).essence, 345);
  assert.equal(file.section(CareerSection).runs, 7);
  assert.equal(SaveService.dev.section(MetaSection).essence, 40);
  assert.ok(!store.m.has(MAIN), '读的时候不写');
  file.section(MetaSection).addEssence(5);
  file.save();
  assert.equal(store.m.get('gunflame.meta.v1'), WEB_V1, '老键原样留着（装回旧版本还能用）');
  assert.equal(JSON.parse(store.m.get(MAIN)).sections.meta.data.essence, 350);
  // 新键有了之后不再看老键
  store.m.set('gunflame.meta.v1', JSON.stringify({ version: 1, essence: 9999 }));
  reopen();
  assert.equal(SaveService.main.importedLegacy, false);
  assert.equal(SaveService.main.section(MetaSection).essence, 350);
});

class ProbeV1 {
  key = 'probe';
  version = 1;
  n = 0;
  capture() { return { n: this.n }; }
  restore(data) { this.n = data ? data.n : 0; }
}
class ProbeV2 {
  key = 'probe';
  version = 2;
  tenths = 0;
  restoredFrom = -1;
  capture() { return { tenths: this.tenths }; }
  restore(data, version) {
    this.restoredFrom = version;
    this.tenths = !data ? 0 : version < 2 ? data.n * 10 : data.tenths;
  }
}

test('SectionVersionsAndUnknownSectionsSurvive：段自己按版本升级；没人认领的段原样写回；段名重复报错', () => {
  const { reopen } = fresh();
  const probe = SaveService.main.section(ProbeV1);
  probe.n = 5;
  assert.equal(SaveService.main.save(), true);
  reopen();
  SaveService.main.section(MetaSection).addEssence(3);
  SaveService.main.save();
  reopen();
  assert.equal(SaveService.main.has('probe'), true);
  const v2 = SaveService.main.section(ProbeV2);
  assert.equal(v2.restoredFrom, 1);
  assert.equal(v2.tenths, 50, 'v1 的 n 是整数，v2 改存十分之一');
  assert.equal(SaveService.main.section(MetaSection).essence, 3);
  assert.throws(() => SaveService.main.section(ProbeV1), /重复/);
});

test('NewerFileIsReadOnly：来自更新版本的文件照读但不写', () => {
  const future = '{"version":99,"sections":{"meta":{"v":3,"data":{"essence":5}}}}';
  const { store } = fresh({ [MAIN]: future });
  const file = SaveService.main;
  assert.equal(file.readOnly, true);
  assert.equal(file.section(MetaSection).essence, 5, '认识的字段照读');
  assert.equal(file.save(), false, '不把新版本的存档写坏');
  assert.equal(store.m.get(MAIN), future);
});

test('段坏了只丢这一段：别的段照读，整文件留一份 .corrupt', () => {
  const text = JSON.stringify({ version: 2, sections: { meta: { v: 1, data: { essence: 12 } }, probe: { v: 2, data: { tenths: 30 } } } });
  const { store } = fresh({ [MAIN]: text });
  class Bad extends ProbeV2 {
    restore(data, version) {
      if (data) throw new Error('读不了');
      super.restore(data, version);
    }
  }
  const bad = SaveService.main.section(Bad);
  assert.equal(bad.tenths, 0);
  assert.equal(SaveService.main.section(MetaSection).essence, 12);
  assert.equal(store.m.get(MAIN + '.corrupt'), text);
});

// ───────────── 天赋 / 结算 ─────────────

test('TalentTableMatchesThreeJs：10 项 × 5 级，价格 60 / 120 / 200 / 300 / 450，升满 11300', () => {
  assert.equal(TALENTS.length, 10);
  assert.deepEqual([...TALENT_COSTS], [60, 120, 200, 300, 450]);
  assert.equal(talentTotalCost(), 11300);
  assert.deepEqual(TALENTS.map(t => [t.id, t.stat, t.perLevel]), [
    ['vitality', 'maxHp', 8], ['barrier', 'maxShield', 6], ['mastery', 'damagePct', 0.04], ['lethal', 'critChance', 0.02],
    ['swift', 'moveSpeed', 0.15], ['reload', 'reloadSpeedPct', 0.05], ['affinity', 'elementChancePct', 0.03], ['haste', 'skillHaste', 0.05],
    ['wealth', 'coinGainPct', 0.08], ['fortune', 'luck', 1],
  ]);
});

test('bankRun：魂晶入账（局内 + 胜利 200）、记生涯、写盘；同一局只结算一次', () => {
  const { store, reopen } = fresh();
  const run = newRun({ stage: '2-3', essence: 137, kills: 88, time: 640, damageDealt: 5000.4, stagesCleared: 6, coins: 210 });
  const s = bankRun(run, false);
  assert.equal(s.essenceEarned, 137);
  assert.equal(run.flags[BANKED_FLAG], 1);
  assert.equal(bankRun(run, false), null, '阵亡和放弃不会各结一次');
  reopen();
  const meta = SaveService.main.section(MetaSection), career = SaveService.main.section(CareerSection);
  assert.equal(meta.essence, 137);
  assert.deepEqual([career.runs, career.wins, career.deaths, career.bestChapter, career.bestStages, career.totalKills], [1, 0, 1, 2, 6, 88]);
  assert.deepEqual(career.deathsByChapter, [0, 1]);
  const win = runSummaryFrom(newRun({ stage: '3-4', essence: 900 }), true);
  assert.equal(win.essenceEarned, 1100, '通关额外 +200');
  assert.ok(store.m.has(MAIN));
});

test('DevRunsNeverTouchTheRealProfile：调试局记进调试档，正式档一个字节都不动', () => {
  const { store } = fresh();
  SaveService.main.section(MetaSection).addEssence(321);
  SaveService.main.save();
  const before = store.m.get(MAIN);
  const run = newRun({ dev: true, essence: 55, kills: 9 });
  assert.equal(SaveService.profileFor(run), SaveService.dev);
  bankRun(run, false);
  assert.equal(store.m.get(MAIN), before);
  assert.equal(JSON.parse(store.m.get(DEV)).sections.meta.data.essence, 55);
  assert.equal(JSON.parse(store.m.get(DEV)).sections.career.data.runs, 1);
  // forceDev（Unity -devprofile / 网页白盒检视页）：正式局也记调试档
  SaveService.forceDev = true;
  assert.equal(SaveService.devActive, true);
  bankRun(newRun({ essence: 5 }), false);
  assert.equal(store.m.get(MAIN), before);
  assert.equal(SaveService.dev.section(MetaSection).essence, 60);
  SaveService.forceDev = false;
});

test('MetaProgress：界面读的 save 是当前档的活视图；买天赋扣魂晶并写盘；天赋按开局快照生效', () => {
  const { store } = fresh({ 'gunflame.meta.v1': WEB_V1 });
  const ctx = { run: null };
  const meta = new MetaProgress(ctx);
  assert.equal(meta.save.essence, 345);
  assert.equal(meta.save.stats.runs, 7);
  assert.equal(meta.talentLevel('vitality'), 3);
  assert.equal(meta.nextTalentCost('vitality'), 300);
  assert.equal(meta.buyTalent('vitality'), true);
  assert.equal(meta.save.essence, 45);
  assert.equal(meta.buyTalent('vitality'), false, '买不起 450');
  assert.equal(JSON.parse(store.m.get(MAIN)).sections.meta.data.talents.vitality, 4);
  // 开局快照：之后在主菜单买的天赋这一局不生效
  const snap = meta.talentSnapshot();
  assert.deepEqual(snap, { vitality: 4, mastery: 5 }, '快照只记认识的天赋、夹在满级');
  ctx.run = newRun({ talents: { vitality: 1, mastery: 9, future: 3 } });
  const stats = new Stats();
  const hp = stats.get('maxHp'), dmg = stats.get('damagePct');
  meta.applyTalents(stats);
  assert.equal(stats.get('maxHp') - hp, 8, '按快照的 1 级，不是档里的 4 级');
  assert.ok(Math.abs(stats.get('damagePct') - dmg - 0.2) < 1e-9, '快照里超过满级的夹到 5');
  ctx.run = null;
  SaveService.currentRun = null;
});

// ───────────── 设置（共享文件）─────────────

test('设置表照 Unity GameSettings：键、分组、范围、步长、默认值', () => {
  const row = key => {
    const d = GS.findSetting(key);
    return [d.group, d.type, d.defaultValue, d.min, d.max, d.step];
  };
  assert.deepEqual(row('sensitivity'), ['操作', 'float', 1, 0.2, 3, 0.05]);
  assert.deepEqual(row('invertY'), ['操作', 'bool', 0, 0, 1, 1]);
  assert.deepEqual(row('fov'), ['画面', 'float', 80, 60, 110, 1]);
  assert.deepEqual(row('quality'), ['画面', 'choice', 2, 0, 2, 1]);
  assert.deepEqual(row('frameCap'), ['画面', 'choice', 7, 0, 7, 1]);
  assert.deepEqual(row('screenShake'), ['画面', 'float', 1, 0, 1.5, 0.05]);
  assert.deepEqual(row('screenEffects'), ['画面', 'float', 1, 0, 1, 0.05]);
  assert.deepEqual(row('damageNumbers'), ['画面', 'bool', 1, 0, 1, 1]);
  for (const key of ['masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume', 'uiVolume']) assert.deepEqual(row(key), ['声音', 'float', 1, 0, 1, 0.05]);
  assert.deepEqual([...GS.findSetting('quality').options], ['低', '中', '高']);
  assert.deepEqual([...GS.findSetting('frameCap').options], ['30', '60', '90', '120', '144', '165', '240', '不限']);
  assert.equal(GS.findSetting('frameCap').options.length, GS.FRAME_CAPS.length);
  // 登记顺序 = 页签顺序与页内顺序（Unity GameSettings.All 去掉网页没有的，加网页独有的阴影精度）
  assert.deepEqual(GS.GAME_SETTINGS.map(d => d.key), ['sensitivity', 'invertY', 'fov', 'quality', 'shadowQuality', 'frameCap', 'screenShake', 'screenEffects',
    'damageNumbers', 'masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume', 'uiVolume']);
  assert.deepEqual(GS.GAME_SETTINGS.filter(d => d.webOnly).map(d => d.key), ['shadowQuality']);
  assert.deepEqual([...GS.UNITY_ONLY_SETTINGS], ['aimAssist', 'displayMode', 'resolutionWidth', 'resolutionHeight', 'vsync']);
  // 夹范围、按步长取整（Unity Clean）；显示（Unity Display）
  assert.equal(GS.cleanSetting(GS.findSetting('fov'), 300), 110);
  assert.equal(GS.cleanSetting(GS.findSetting('sensitivity'), 1.234), 1.25);
  assert.equal(GS.cleanSetting(GS.findSetting('quality'), 1.4), 1);
  assert.equal(GS.settingDisplay(GS.findSetting('masterVolume'), 0.35), '35%');
  assert.equal(GS.settingDisplay(GS.findSetting('screenShake'), 1.5), '150%');
  assert.equal(GS.settingDisplay(GS.findSetting('quality'), 2), '高');
  assert.equal(GS.settingDisplay(GS.findSetting('invertY'), 1), '开');
  assert.deepEqual(Settings.DEFAULT_SETTINGS, {
    sensitivity: 1, invertY: false, fov: 80, quality: 'high', shadowQuality: 'medium', frameCap: 7, screenShake: 1, screenEffects: 1, damageNumbers: true,
    masterVolume: 1, musicVolume: 1, sfxVolume: 1, ambienceVolume: 1, uiVolume: 1,
  });
});

test('SettingsLiveInTheSharedFile：设置在 settings.json 的「settings」段（{version, entries}），正式档 / 调试档共用', () => {
  const { store, reopen } = fresh();
  const section = GS.settingsSection();
  const s = Settings.loadSettings();
  assert.equal(s, section.settings, 'ctx.settings 就是这一段的活视图');
  assert.deepEqual(s, Settings.DEFAULT_SETTINGS);
  section.set(GS.findSetting('frameCap'), 1);
  section.set(GS.findSetting('screenEffects'), 0.5);
  section.set(GS.findSetting('ambienceVolume'), 0.3);
  section.set(GS.findSetting('uiVolume'), 0.6);
  section.set(GS.findSetting('musicVolume'), 0.25);
  // 界面直接改对象再 saveSettings（设置页的做法）
  s.quality = 'low';
  s.fov = 95;
  s.invertY = true;
  Settings.saveSettings(s);
  assert.ok(!store.m.has(MAIN) && !store.m.has(DEV), '不进存档文件');
  const data = JSON.parse(store.m.get(SHARED)).sections.settings;
  assert.equal(data.v, 1);
  assert.equal(data.data.version, 1);
  assert.deepEqual(Object.fromEntries(data.data.entries.map(e => [e.key, e.value])),
    { invertY: 1, fov: 95, quality: 0, frameCap: 1, screenEffects: 0.5, musicVolume: 0.25, ambienceVolume: 0.3, uiVolume: 0.6 }, '只写和默认值不一样的项');
  reopen();
  const again = Settings.loadSettings();
  assert.notEqual(again, s);
  assert.equal(again.frameCap, 1);
  assert.equal(GS.targetFrameRate(again.frameCap), 60);
  assert.equal(again.screenEffects, 0.5);
  assert.equal(again.ambienceVolume, 0.3);
  assert.equal(again.uiVolume, 0.6);
  assert.equal(again.musicVolume, 0.25);
  assert.equal(again.quality, 'low');
  assert.equal(again.fov, 95);
  assert.equal(again.invertY, true);
  assert.equal(again.masterVolume, 1);
  // 通知与恢复默认
  const seen = [];
  const sec = GS.settingsSection();
  sec.onChanged(d => seen.push(d.key));
  assert.equal(sec.set(GS.findSetting('fov'), 95), false, '没变不通知');
  sec.resetAll();
  assert.deepEqual(seen.sort(), ['ambienceVolume', 'fov', 'frameCap', 'invertY', 'musicVolume', 'quality', 'screenEffects', 'uiVolume']);
  assert.deepEqual(Settings.loadSettings(), Settings.DEFAULT_SETTINGS);
  assert.deepEqual(JSON.parse(store.m.get(SHARED)).sections.settings.data.entries, []);
});

test('老设置的音量是旧语义：主 / 音效 / 音乐缺省 0.8 / 0.9 / 0.5（音乐另乘 0.6）→ 换成新推子，听感不变', () => {
  // M11e 之前存的（没有环境音 / 界面音两个字段）
  const old = { sensitivity: 1.3, fov: 90, masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.5, quality: 'medium', shadowQuality: 'high', damageNumbers: false, screenShake: 0.5, invertY: true };
  const legacy = JSON.stringify(old);
  const { store, reopen } = fresh({ 'gunflame.settings.v1': legacy });
  const section = GS.settingsSection();
  const s = section.settings;
  assert.equal(section.importedLegacy, true);
  assert.deepEqual([s.masterVolume, s.sfxVolume, s.musicVolume], [1, 1, 1], '旧缺省 = 新缺省');
  assert.deepEqual([s.ambienceVolume, s.uiVolume], [1, 1]);
  assert.deepEqual([s.sensitivity, s.fov, s.quality, s.shadowQuality, s.damageNumbers, s.screenShake, s.invertY], [1.3, 90, 'medium', 'high', false, 0.5, true]);
  assert.equal(store.m.get('gunflame.settings.v1'), legacy, '老键不删不改');
  assert.ok(store.m.has(SHARED), '导入后写进新文件');
  // 听感不变：实际电平 = 推子 × 清单基础电平（主 0.8 / 音效 0.9 / 音乐 0.3）；旧版 = 推子（音乐再 × 0.6）
  const base = { masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.3 };
  for (const [m, x, mu] of [[0.4, 0.45, 0.25], [0.2, 0.9, 0.1], [0.8, 0.0, 0.5], [0.6, 0.72, 0.35]]) {
    const v = GS.migrateLegacySettings({ masterVolume: m, sfxVolume: x, musicVolume: mu });
    assert.ok(Math.abs(v.masterVolume * base.masterVolume - m) <= 0.8 * 0.025 + 1e-9, `主 ${m}`);
    assert.ok(Math.abs(v.sfxVolume * base.sfxVolume - x) <= 0.9 * 0.025 + 1e-9, `音效 ${x}`);
    assert.ok(Math.abs(v.musicVolume * base.musicVolume - mu * 0.6) <= 0.3 * 0.025 + 1e-9, `音乐 ${mu}`);
  }
  assert.deepEqual(GS.migrateLegacySettings({ masterVolume: 0.4, sfxVolume: 0.45, musicVolume: 0.25 }), { masterVolume: 0.5, sfxVolume: 0.5, musicVolume: 0.5 });
  assert.deepEqual(GS.migrateLegacySettings({ masterVolume: 1, sfxVolume: 1, musicVolume: 1 }), { masterVolume: 1, sfxVolume: 1, musicVolume: 1 }, '比旧缺省还大的夹在 1');
  // M11e 之后存的（有环境音 / 界面音）：已经是新语义，原样
  assert.deepEqual(GS.migrateLegacySettings({ masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.5, ambienceVolume: 1, uiVolume: 0.4 }),
    { masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9, ambienceVolume: 1, uiVolume: 0.4 });
  // 坏字段不要、越界夹住
  assert.deepEqual(GS.migrateLegacySettings({ fov: 500, quality: 'ultra', invertY: 'yes', sensitivity: 0.1, ambienceVolume: 1 }), { sensitivity: 0.2, fov: 110, ambienceVolume: 1 });
  assert.deepEqual(GS.migrateLegacySettings(null), {});
  // 导入只做一次：之后改老键不影响
  store.m.set('gunflame.settings.v1', JSON.stringify({ ...old, fov: 61 }));
  reopen();
  assert.equal(GS.settingsSection().importedLegacy, false);
  assert.equal(Settings.loadSettings().fov, 90);
});

// ───────────── 续玩（RunSuspendTests）─────────────

function snapshot(over = {}) {
  return newRun({
    stage: '1-2', coins: 245, essence: 31, kills: 57, time: 412.5, damageDealt: 18234.5, stagesCleared: 1,
    flags: { glide: 1, 'stage_essence:1-1': 1 }, talents: { vitality: 2, fortune: 1 },
    scrolls: { blade_edge: 3, eagle_eye: 1 },
    weapons: [
      { id: 'rifle', rarity: 2, level: 3, element: 'fire', mag: 17, reserve: 140, active: true, affixes: [{ id: 'crit', value: 0.1 }] },
      { id: 'shotgun', rarity: 0, level: 0, element: 'none', mag: 6, reserve: 30, active: false, affixes: [] },
    ],
    hp: 71.5, shield: 12, ...over,
  });
}

test('RoundTripKeepsEveryField：进关快照写盘再读回，字段一个不少', () => {
  const { store } = fresh();
  const snap = snapshot();
  assert.equal(Suspend.shouldWrite(snap), true);
  assert.equal(Suspend.write(snap, false), true);
  const root = JSON.parse(store.m.get(RUN));
  assert.deepEqual([root.version, root.game, root.kind, root.stage, root.hero], [2, 'spiritfire', 'run', '1-2', 'fox']);
  assert.equal(root.label, StagePlan.canonical('1-2').label);
  assert.ok(!store.m.has(RUN + '.bak'), '不留 .bak');
  const r = Suspend.read(false);
  assert.equal(r.status, 'ok');
  const run = r.result.run;
  assert.notEqual(run, snap, '每次都是新对象');
  assert.equal(r.result.dev, false);
  assert.equal(r.result.stage.code, '1-2');
  assert.deepEqual([run.heroId, run.seed, run.chapter, run.stageIndex, run.coins, run.essence, run.kills, run.stagesCleared], ['fox', 20261121, 0, 1, 245, 31, 57, 1]);
  assert.deepEqual([run.time, run.damageDealt, run.hp, run.shield], [412.5, 18234.5, 71.5, 12]);
  assert.equal(run.difficulty, StagePlan.canonical('1-2').difficulty, '难度以规划表为准');
  assert.deepEqual(run.stage, RunPlan.toNode(StagePlan.canonical('1-2')));
  assert.deepEqual(run.flags, snap.flags);
  assert.deepEqual(run.talents, { vitality: 2, fortune: 1 });
  assert.deepEqual(Object.entries(run.scrolls), [['blade_edge', 3], ['eagle_eye', 1]], '秘卷按获得顺序');
  assert.deepEqual(run.weapons, snap.weapons);
  assert.equal(run.dev, undefined);
  assert.equal(Suspend.peek(false).run.kills, 57);
  assert.equal(Suspend.takeProblem(), null);
});

test('路线也跟着存：洗过牌的局读回来还在同一条路线的同一个槽位', () => {
  fresh();
  const run = snapshot();
  RunPlan.beginRun(run, null, RunRoute.build(77));
  RunPlan.enterStage(run, RunPlan.next(RunPlan.specOf(run, run.stage)));
  const code = RunPlan.stageCodeOf(run), map = run.stage.map;
  assert.equal(code, '1-2');
  Suspend.write(run, false);
  const back = Suspend.read(false).result;
  assert.deepEqual(back.run.route, run.route);
  assert.equal(back.stage.code, '1-2');
  assert.equal(back.run.stage.map, map, '槽位上还是那张图');
  assert.equal(back.stage.route.matches(run.route), true);
  // 路线里有不认识的图 = 坏档
  const text = JSON.parse(SaveService.storage.getItem(RUN));
  text.run.route[0] = '9-9';
  SaveService.storage.setItem(RUN, JSON.stringify(text));
  assert.equal(Suspend.read(false).status, 'corrupt');
});

test('WriteOverwritesThePreviousStage / DevRunsGoToTheirOwnFile', () => {
  const { store } = fresh();
  Suspend.write(snapshot(), false);
  Suspend.write(snapshot({ stage: '1-3', kills: 99 }), false);
  assert.equal(Suspend.read(false).result.stage.code, '1-3');
  assert.equal(Suspend.read(false).result.run.kills, 99);
  // 调试局：只在调试档开着时写，写进 run.dev.json
  const dev = snapshot({ dev: true });
  assert.equal(Suspend.shouldWrite(dev), false, '正式档开着时调试局不写');
  SaveService.forceDev = true;
  assert.equal(Suspend.shouldWrite(dev), true);
  assert.equal(Suspend.devFor(dev), true);
  Suspend.write(dev, true);
  assert.ok(store.m.has(RUN_DEV));
  assert.equal(Suspend.read(true).result.run.dev, true);
  assert.equal(Suspend.read(true).result.dev, true);
  SaveService.forceDev = false;
  assert.equal(Suspend.read(false).result.run.kills, 99, '正式档的续玩档没动');
});

const BROKEN = ['', '   ', 'not json', '[1,2]', '{}', '{"version":"2"}', '{"version":2,"game":"other","kind":"run","run":{}}',
  '{"version":2,"game":"spiritfire","kind":"profile","run":{}}', '{"version":2,"game":"spiritfire","kind":"run"}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"nobody","stageCode":"1-1"}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"9-9"}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","coins":-5}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","flags":{"meta.banked":1}}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","weapons":[{"id":"rifle","rarity":7}]}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","weapons":[{"id":"rifle","level":9}]}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","weapons":[{"id":"rifle","element":"void"}]}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","weapons":[{"rarity":1}]}}',
  '{"version":2,"game":"spiritfire","kind":"run","run":{"heroId":"fox","stageCode":"1-1","talents":{"vitality":-1}}}'];

test('CorruptFilesAreDiscardedWithANotice：读不了的续玩档挪成 .corrupt、提示一次，不崩溃', () => {
  for (const text of BROKEN.slice(1)) {
    const { store } = fresh({ [RUN]: text });
    assert.equal(Suspend.read(false).status, 'corrupt', text);
    assert.equal(store.m.get(RUN), text, 'read 不动盘上的东西');
    assert.equal(Suspend.peek(false), null);
    assert.ok(!store.m.has(RUN), '坏档挪开');
    assert.equal(store.m.get(RUN + '.corrupt'), text);
    assert.equal(Suspend.takeProblem(), '上次的征程存档已损坏，无法继续，已丢弃');
    assert.equal(Suspend.takeProblem(), null, '只提示一次');
    assert.equal(Suspend.exists(false), false);
  }
  // 截断的文件
  const { store } = fresh();
  Suspend.write(snapshot(), false);
  const full = store.m.get(RUN);
  store.m.set(RUN, full.slice(0, Math.floor(full.length / 2)));
  assert.equal(Suspend.read(false).status, 'corrupt');
});

test('NewerVersionIsKeptButNotOffered / MissingFileIsNone', () => {
  const future = '{"version":99,"game":"spiritfire","kind":"run","run":{}}';
  const { store } = fresh({ [RUN]: future });
  assert.equal(Suspend.read(false).status, 'newer');
  assert.equal(Suspend.peek(false), null);
  assert.equal(store.m.get(RUN), future, '原样留着');
  assert.equal(Suspend.takeProblem(), '上次的征程来自更新的版本，这个版本无法继续');
  fresh();
  assert.equal(Suspend.read(false).status, 'none');
  assert.equal(Suspend.peek(false), null);
  assert.equal(Suspend.takeProblem(), null);
  assert.equal(Suspend.exists(false), false);
});

test('BankingARunDeletesItsSuspendFile：一局结束（阵亡 / 放弃 / 胜利）就删那个档的续玩档', () => {
  const { store } = fresh();
  const run = snapshot();
  Suspend.write(run, false);
  SaveService.forceDev = true;
  Suspend.write(snapshot({ dev: true }), true);
  SaveService.forceDev = false;
  assert.ok(store.m.has(RUN) && store.m.has(RUN_DEV));
  bankRun(run, false);
  assert.ok(!store.m.has(RUN), '正式局结算：删 run.json');
  assert.ok(store.m.has(RUN_DEV), '调试档的不动');
});

test('ForfeitBanksTheSuspendedRunAsADefeat：开新局放弃旧局 = 按败北结算（魂晶照常入账）再删档', () => {
  const { store } = fresh();
  Suspend.write(snapshot({ essence: 64 }), false);
  const s = Suspend.forfeit(false);
  assert.equal(s.victory, false);
  assert.equal(s.essenceEarned, 64);
  assert.equal(SaveService.main.section(MetaSection).essence, 64);
  assert.deepEqual([SaveService.main.section(CareerSection).runs, SaveService.main.section(CareerSection).deaths], [1, 1]);
  assert.ok(!store.m.has(RUN));
  assert.equal(Suspend.forfeit(false), null, '没有档：什么都不结');
  store.m.set(RUN, 'not json');
  assert.equal(Suspend.forfeit(false), null, '坏档只删档');
  assert.ok(!store.m.has(RUN));
  assert.equal(SaveService.main.section(CareerSection).runs, 1);
});

test('CanSuspendOnlyWithItsOwnSnapshotOnDisk：盘上是这一局这一关的续玩档才能暂离', () => {
  const { store } = fresh();
  const run = snapshot();
  assert.equal(Suspend.canSuspend(run), false, '还没写过');
  const written = [];
  Suspend.RunSuspend.onWritten(code => written.push(code));
  Suspend.write(run, false);
  assert.deepEqual(written, ['1-2']);
  assert.equal(Suspend.canSuspend(run), true);
  assert.equal(Suspend.canSuspend(snapshot({ seed: 5 })), false, '别的局');
  assert.equal(Suspend.canSuspend(snapshot({ stage: '1-3' })), false, '别的关（这一关还没写）');
  assert.equal(Suspend.canSuspend(snapshot({ heroId: 'bear' })), false);
  assert.equal(Suspend.canSuspend(snapshot({ dev: true })), false, '调试局没写档');
  store.m.delete(RUN);
  assert.equal(Suspend.canSuspend(run), false, '文件没了');
  Suspend.write(run, false);
  run.flags[BANKED_FLAG] = 1;
  assert.equal(Suspend.canSuspend(run), false, '已经结算过的局');
  Suspend.RunSuspend.enabled = false;
  assert.equal(Suspend.shouldWrite(snapshot()), false);
  // 继续征程读回来的局算作刚写过
  Suspend.RunSuspend.enabled = true;
  Suspend.write(snapshot(), false);
  Suspend.RunSuspend.reset();
  const back = Suspend.peek(false);
  assert.equal(Suspend.canSuspend(back.run), false);
  Suspend.adopt(back);
  assert.equal(Suspend.canSuspend(back.run), true);
});

test('TalentsAreLockedAtRunStartThroughSuspendAndResume / OldVersionFileWithoutSnapshotUsesTalentsAtResume', () => {
  const { store } = fresh();
  const meta = SaveService.main.section(MetaSection);
  meta.talents.vitality = 2;
  SaveService.main.save();
  const run = snapshot({ talents: meta.talentSnapshot() });
  Suspend.write(run, false);
  // 暂离期间在主菜单买了天赋：照常进元进度
  meta.talents.vitality = 4;
  meta.talents.swift = 1;
  SaveService.main.save();
  assert.deepEqual(Suspend.read(false).result.run.talents, { vitality: 2 }, '继续征程仍按开局快照');
  // v1 的档没有快照：按读档那一刻档里的天赋补上
  const root = JSON.parse(store.m.get(RUN));
  root.version = 1;
  delete root.run.talents;
  store.m.set(RUN, JSON.stringify(root));
  assert.deepEqual(Suspend.read(false).result.run.talents, { vitality: 4, swift: 1 });
  assert.equal(Suspend.RUN_SUSPEND_VERSION, 2);
  assert.equal(Suspend.TALENT_SNAPSHOT_VERSION, 2);
});

test('续玩档里的关这个版本没有（场景没导出 / 试玩终点之后）= 坏档；英雄表可以换', () => {
  fresh();
  Suspend.write(snapshot({ stage: '2-2' }), false);
  StagePlan.setSceneReady(s => s.chapter === 1);
  assert.equal(Suspend.read(false).status, 'corrupt', '2-2 的场景没了');
  StagePlan.setSceneReady(s => !s.alt);
  assert.equal(Suspend.read(false).status, 'ok');
  Suspend.RunSuspend.setHeroLookup(id => id === 'bear');
  assert.equal(Suspend.read(false).status, 'corrupt', '英雄不在了');
  Suspend.RunSuspend.setHeroLookup(null);
  assert.equal(Suspend.read(false).status, 'ok');
  StagePlan.setSceneReady(null);
});

// ───────────── 本会话补的对照（读 C# 源码 / SaveServiceTests、RunSuspendTests 剩下的几条）─────────────

const { readFileSync } = await import('node:fs');
const { RunRng } = await importTs('../src/progression/RunRng.ts');

/** 读 Unity 源码；被本机 DLP 透明加密时返回 null（先跑 node scripts/unity/dlp-unity-fix.mjs） */
function unitySource(rel) {
  const text = readFileSync(new URL(`../unity/Assets/Game/Scripts/${rel}`, import.meta.url), 'utf8');
  return text.startsWith('%TSD-Header') ? null : text;
}

test('设置表逐项读 GameSettings.cs 比：两边都有的项键 / 分组 / 类型 / 默认值 / 范围 / 步长 / 选项一致，Unity 独有的就是 UNITY_ONLY_SETTINGS', (t) => {
  const cs = unitySource('Core/GameSettings.cs');
  if (!cs) return t.skip('GameSettings.cs 被透明加密');
  const groups = { GroupControls: '操作', GroupVideo: '画面', GroupAudio: '声音' };
  const num = (s) => {
    s = s.trim();
    if (s === '(float)ArtQualityLevel.High') return 2;
    const n = Number(s.replace(/f$/, ''));
    assert.ok(Number.isFinite(n), `认不出 C# 的数 ${s}`);
    return n;
  };
  const rows = [...cs.matchAll(/Add\(new SettingDef\("(\w+)", "([^"]+)", (\w+), SettingType\.(\w+), ([^,]+), ([^,]+), ([^,]+), ([^,)]+)([\s\S]*?)\)\);/g)];
  assert.ok(rows.length >= 15, `C# 里认出 ${rows.length} 项`);
  const unityKeys = [];
  for (const [, key, label, group, type, def, min, max, step, rest] of rows) {
    unityKeys.push(key);
    const d = GS.findSetting(key);
    if (!d) continue;
    assert.equal(d.label, label, `${key} 显示名`);
    assert.equal(d.group, groups[group], `${key} 分组`);
    assert.equal(d.type, type.toLowerCase(), `${key} 类型`);
    assert.deepEqual([d.defaultValue, d.min, d.max, d.step], [num(def), num(min), num(max), num(step)], `${key} 默认 / 范围 / 步长`);
    const options = /new\[\]\s*\{([^}]*)\}/.exec(rest)?.[1];
    if (options && options.includes('"')) assert.deepEqual([...d.options], [...options.matchAll(/"([^"]*)"/g)].map(m => m[1]), `${key} 选项`);
  }
  // 画质的选项名在 C# 里是 ArtQuality.Label(...)：低 / 中 / 高
  assert.deepEqual([...GS.findSetting('quality').options], ['低', '中', '高']);
  const webKeys = GS.GAME_SETTINGS.filter(d => !d.webOnly).map(d => d.key);
  assert.deepEqual(webKeys, unityKeys.filter(k => webKeys.includes(k)), '登记顺序同 GameSettings.All');
  assert.deepEqual(unityKeys.filter(k => !webKeys.includes(k)), [...GS.UNITY_ONLY_SETTINGS], 'Unity 有、网页没有的项');
  // 帧率上限的档位 = GraphicsQuality.FrameCaps
  const caps = /FrameCaps = \{([^}]*)\}/.exec(unitySource('Core/GraphicsQuality.cs') ?? '')?.[1];
  if (caps) assert.deepEqual([...GS.FRAME_CAPS], caps.split(',').map(Number));
});

test('TalentsApplyToStatSheetUnderTalentSource：十项天赋按等级写进属性表（来源 talent）；重复套用不动属性表；改等级整体撤掉再加', () => {
  fresh();
  const ctx = { run: null };
  const meta = new MetaProgress(ctx);
  const m = meta.meta;
  Object.assign(m.talents, { vitality: 2, barrier: 5, mastery: 3, lethal: 1, swift: 4, reload: 2, affinity: 5, haste: 1, wealth: 3, fortune: 99 });
  assert.equal(meta.talentLevel('fortune'), 5, '等级夹到满级');
  const s = new Stats(); // 生命 100、护盾 50、移速 7.5、暴击 5%
  assert.equal(meta.applyTalents(s), true);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-4, `${what}：期望 ${b}，实际 ${a}`);
  near(s.get('maxHp'), 116, '生命');
  near(s.get('maxShield'), 80, '护盾');
  near(s.get('damagePct'), 0.12, '武器伤害');
  near(s.get('critChance'), 0.07, '暴击率');
  near(s.get('moveSpeed'), 8.1, '移速');
  near(s.get('reloadSpeedPct'), 0.10, '换弹');
  near(s.get('elementChancePct'), 0.15, '元素触发');
  near(s.get('skillHaste'), 0.05, '技能急速');
  near(s.get('coinGainPct'), 0.24, '灵石获取');
  near(s.get('luck'), 5, '幸运');
  assert.equal(s.modsFrom(Meta.TALENT_SOURCE).length, 10);
  // 重复套用：属性表的版本号不变（生命上限不会被撤掉再加回）
  const version = s.version;
  assert.equal(meta.applyTalents(s), false);
  assert.equal(s.version, version);
  // 等级变了：旧的整体撤掉再加
  m.talents.vitality = 0;
  assert.equal(meta.applyTalents(s), true);
  near(s.get('maxHp'), 100, '生命');
  assert.equal(s.modsFrom(Meta.TALENT_SOURCE).length, 9);
  // 全部清零：来源撤掉，其他来源不受影响
  s.add('maxHp', 30, 'scroll');
  for (const t of TALENTS) m.talents[t.id] = 0;
  assert.equal(meta.applyTalents(s), true);
  assert.equal(s.hasSource(Meta.TALENT_SOURCE), false);
  near(s.get('maxHp'), 130, '生命');
  assert.equal(meta.applyTalents(s), false);
  SaveService.currentRun = null;
});

test('SnapshotSkipsUnknownTalentsAndClampsLevels：不认识的天赋、0 级不出修正，等级夹到满级；新版本的天赋原样存回', () => {
  fresh();
  const levels = { vitality: 99, future_talent: 3, mastery: 0 };
  const mods = Meta.talentMods(levels);
  assert.equal(mods.length, 1, '不认识的天赋、0 级都不出修正');
  assert.equal(mods[0].key, 'maxHp');
  assert.ok(Math.abs(mods[0].value - 40) < 1e-6, '等级夹到满级（5 × 8）');
  assert.equal(Meta.talentMods(null).length, 0);

  const run = snapshot({ talents: levels });
  assert.equal(Suspend.write(run, false), true);
  const r = Suspend.read(false);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.result.run.talents.future_talent, 3, '新版本的天赋原样保留');
  const ctx = { run: r.result.run };
  const s = new Stats();
  new MetaProgress(ctx).applyTalents(s);
  assert.ok(Math.abs(s.get('maxHp') - 140) < 1e-6);
  SaveService.currentRun = null;

  const meta = SaveService.main.section(MetaSection);
  meta.talents = { reload: 2 };
  assert.deepEqual(meta.talentSnapshot(), { reload: 2 }, '快照只记 > 0 的');
});

test('RandomStreamsResumeFromTheStageOrigin：读回来的局同一个流名给出同一串数（随机流只由种子 + 关卡 + 流名决定）', () => {
  fresh();
  const run = snapshot();
  const expect = Array.from({ length: 6 }, () => RunPlan.runStream(run, 'loot').nextUInt());
  // 进关快照是另一份对象（Unity SceneFlow.CloneRun）：它的流还在这一关的起点
  const clone = JSON.parse(JSON.stringify(run));
  assert.equal(Suspend.write(clone, false), true);
  const r = Suspend.read(false);
  assert.equal(r.status, 'ok', r.error);
  const got = Array.from({ length: 6 }, () => RunPlan.runStream(r.result.run, 'loot').nextUInt());
  assert.deepEqual(got, expect);
  // 流名 = 关卡编号 / 流名
  const direct = RunRng.stream(run.seed, '1-2/loot');
  assert.deepEqual(Array.from({ length: 6 }, () => direct.nextUInt()), expect);
  // 不同流互不相干
  assert.notEqual(RunPlan.runStream(r.result.run, 'enc').nextUInt(), RunRng.stream(run.seed, '1-2/loot').nextUInt());
});
