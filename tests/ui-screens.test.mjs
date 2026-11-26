// 界面第二期（docs/threejs-migration.md M11c）：路由规则与数据映射的对照测试——都拿 Unity 的 C# 源码当规格读：
//   · 路由：每个界面的 id、挡不挡游戏（BlockState）、停不停时间（FreezeTime）；UI.ts 的层位表登记了全部界面；局内热键（ScreenHotkeys）。
//   · 键位：改键页动作表（SettingsScreen.Actions）、缺省键（GameInput）、按键说明（ControlsScreen.Rows），以及改键的存取。
//   · 数据映射（src/ui/ScreenData.ts）：关卡卡片、整局结算、主菜单生涯、天赋行、秘卷卡面、选英雄技能行的文字。
//   · 图鉴（src/ui/codex/Codex.ts）：敌人名册与顺序（[Defs] 序）、首领名 / 称号、Lore、隐藏 / 别名、分页、收录存档。
//   · 全图（src/ui/MapMarkers.ts）：方位、视线朝向、俯视图投影照 Unity MapMarkers / MapScreen（导出器只翻 X），图框尺寸常数。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { tsGraph } from './unity-parity-kit.mjs';

const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const read = async (path) => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^﻿/, '');
const load = async (path) => import(dataModule(stripTypeScriptTypes(await read(path), { mode: 'transform' })));

const SD = await load('../src/ui/ScreenData.ts');
const CX = await load('../src/ui/codex/Codex.ts');
const KB = await load('../src/ui/KeyBinds.ts');
const MM = await load('../src/ui/MapMarkers.ts');

// 要连带 import 的模块走 tsGraph（去类型后写进临时目录，three 用真的）；图鉴缩略图棚的 AssetLibrary 读 import.meta.env，打桩
const graph = await tsGraph({ 'assets/AssetLibrary.ts': 'export const AssetLibrary = {};' });
after(() => graph.dispose());
const LEGEND = (await graph.load('progression/scrolls/defsLegend.ts')).LEGEND_SCROLLS;
const SCROLL_KIT = await graph.load('progression/scrolls/ScrollKit.ts');
const AFFIXES = await graph.load('enemies/Affixes.ts');
const BARS = await graph.load('ui/hud/EnemyBars.ts');
const INV = await graph.load('ui/screens/InventoryScreen.ts');
const KIT = await graph.load('ui/screens/ScreenKit.ts');
const THUMBS = await graph.load('ui/codex/CodexThumbs.ts');
const PORTAL = await graph.load('world/Portal.ts');

const U = '../unity/Assets/Game/Scripts/';
const unity = (path) => read(U + path);

// ───────────── 路由规则 ─────────────

/** 网页界面：id、blockState（缺省 'modal'）、freezeTime（缺省 true），照 UIScreen 基类 */
async function webScreen(file) {
  const s = await read(`../src/ui/screens/${file}.ts`);
  const idConst = /readonly id = (\w+)/.exec(s)?.[1];
  const id = new RegExp(`export const ${idConst} = '([^']+)'`).exec(s)?.[1];
  const block = /get blockState\(\)[^{]*\{\s*return ([^;]+);/.exec(s)?.[1] ?? "'modal'";
  const freeze = /get freezeTime\(\)[^{]*\{\s*return (true|false);/.exec(s)?.[1] ?? 'true';
  return { id, block: block === 'null' ? null : block.replace(/'/g, ''), freeze: freeze === 'true' };
}

/** Unity 界面：Id、BlockState（缺省 GameState.Modal）、FreezeTime（缺省 true），照 Toolkit/UIRouter.cs 的 UIScreen */
async function unityScreen(file) {
  const s = await unity(`UI/Screens/${file}.cs`);
  let id = /const string ScreenId = "([^"]+)"/.exec(s)?.[1];
  // 借别的类的常量：HeroSelectScreen.ScreenId = MainMenuScreen.HeroSelectId、SummaryScreen.Id => MenuFlow.SummaryScreenId
  const ref = /const string ScreenId = (\w+)\.(\w+);/.exec(s) ?? /override string Id => (\w+)\.(\w+);/.exec(s);
  if (!id && ref) id = new RegExp(`${ref[2]} = "([^"]+)"`).exec(await unity(`UI/Screens/${ref[1]}.cs`))?.[1];
  const block = /override GameState\? BlockState => ([\w.]+);/.exec(s)?.[1] ?? 'GameState.Modal';
  const freeze = /override bool FreezeTime => (true|false);/.exec(s)?.[1] ?? 'true';
  return { id, block: block === 'null' ? null : block.replace('GameState.', '').toLowerCase(), freeze: freeze === 'true' };
}

const SCREEN_PAIRS = [
  ['PauseScreen', 'PauseScreen'], ['SettingsScreen', 'SettingsScreen'], ['ConfirmScreen', 'ConfirmScreen'], ['ControlsScreen', 'ControlsScreen'],
  ['CodexScreen', 'CodexScreen'], ['MapScreen', 'MapScreen'], ['StageCardScreen', 'StageCardScreen'], ['MainMenuScreen', 'MainMenuScreen'],
  ['HeroSelectScreen', 'HeroSelectScreen'], ['TalentScreen', 'TalentScreen'], ['SummaryScreen', 'SummaryScreen'],
  ['ScrollChoiceScreen', 'ScrollChoiceScreen'], ['InventoryScreen', 'InventoryPanel'],
];

test('路由规则照 Unity：13 个界面的 id、挡不挡游戏、停不停时间', async () => {
  const seen = new Set();
  for (const [web, cs] of SCREEN_PAIRS) {
    const w = await webScreen(web), u = await unityScreen(cs);
    assert.ok(u.id, `${cs}.cs 读不到 Id`);
    assert.deepEqual(w, u, `${web} ↔ ${cs}.cs`);
    seen.add(w.id);
  }
  assert.equal(seen.size, SCREEN_PAIRS.length, '界面 id 不重复');
  // 规则本身（Unity 的设计）：菜单上叠开的页不挡游戏也不停时间；局内的行囊 / 全图 / 三选一挡游戏（modal）；暂停 paused；关卡卡片与结算 summary
  const by = Object.fromEntries(await Promise.all(SCREEN_PAIRS.map(async ([web]) => [(await webScreen(web)).id, await webScreen(web)])));
  for (const id of ['main-menu', 'hero-select', 'talents', 'codex', 'controls', 'settings', 'confirm']) assert.deepEqual([by[id].block, by[id].freeze], [null, false], id);
  for (const id of ['inventory', 'map', 'scroll-choice']) assert.equal(by[id].block, 'modal', id);
  assert.equal(by.pause.block, 'paused');
  assert.deepEqual([by['stage-card'].block, by.summary.block], ['summary', 'summary']);
});

test('UI.ts 的层位表登记了注册的每个路由界面和四个 HUD 部件，第二期清单全部完成', async () => {
  const ui = await read('../src/ui/UI.ts');
  const registered = [...ui.matchAll(/router\.register\(new (\w+)\(/g)].map((m) => m[1]);
  const idConst = Object.fromEntries([...ui.matchAll(/import \{ (\w+_ID), (\w+) \} from '\.\/screens\/\w+'/g)].map((m) => [m[2], m[1]]));
  const slots = [...ui.matchAll(/\{ id: ([\w'-]+), layer: UILayer\.(\w+), title: '([^']+)', done: (true|false) \}/g)].map((m) => ({ id: m[1], layer: m[2], title: m[3], done: m[4] === 'true' }));
  assert.equal(registered.length, 13);
  for (const cls of registered) {
    const slot = slots.find((s) => s.id === idConst[cls]);
    assert.ok(slot, `${cls} 没登记层位`);
    assert.equal(slot.layer, 'Modal', `${cls} 是路由界面，在界面层`);
  }
  assert.deepEqual(slots.filter((s) => s.layer === 'Hud').map((s) => s.id).sort(), ["'elite-seal'", "'pet-panel'", "'scope'", "'scroll-proc'"]);
  assert.ok(slots.every((s) => s.done), slots.filter((s) => !s.done).map((s) => s.title).join('、'));
  // 回到游戏 / 换关时收起的菜单页（MENU_SCREENS）都是不挡游戏的菜单页 + 结算
  const menu = /const MENU_SCREENS = \[([^\]]+)\]/.exec(ui)[1].split(',').map((s) => s.trim());
  assert.deepEqual(menu, ['MAIN_MENU_ID', 'HERO_SELECT_SCREEN_ID', 'TALENTS_SCREEN_ID', 'CODEX_ID', 'CONTROLS_ID', 'CONFIRM_ID', 'SUMMARY_ID']);
});

test('局内热键照 Unity ScreenHotkeys：只在游玩中响应，行囊键开行囊、地图键开全图', async () => {
  const cs = await unity('UI/Screens/ScreenHotkeys.cs');
  const pairs = [...cs.matchAll(/GameInput\.Pressed\(GameAction\.(\w+)\)\) UIRouter\.Open\((\w+)\.ScreenId\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(pairs, [['Inventory', 'InventoryPanel'], ['Map', 'MapScreen']]);
  const ui = await read('../src/ui/UI.ts');
  const web = [...ui.matchAll(/this\.keys\.matches\('(\w+)', code\)\) return this\.root\.router\.open\((\w+)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(web, [['inventory', 'INVENTORY_ID'], ['map', 'MAP_ID']]);
  assert.match(ui, /private hotkey\(code: string\): boolean \{\s*const ctx = this\.ctx;\s*if \(ctx\.game\.state !== 'playing' \|\| !\(ctx\.player\?\.hp > 0\)\) return false;/);
});

// ───────────── 键位 ─────────────

const ACTION_OF = { Jump: 'jump', Dash: 'dash', Fire: 'fire', Aim: 'aim', Reload: 'reload', Interact: 'interact', SkillQ: 'skillPrimary', SkillE: 'skillSecondary',
  WeaponSkill: 'weaponSkill', Weapon1: 'weapon1', Weapon2: 'weapon2', Swap: 'swapWeapon', PetSkill: 'petSkill', Inventory: 'inventory', Map: 'map', Pause: 'pause' };
/** Unity 键盘控件路径 → KeyboardEvent.code */
const codeOf = (k) => ({ space: 'Space', leftShift: 'ShiftLeft', rightShift: 'ShiftRight', escape: 'Escape', tab: 'Tab' })[k] ?? (/^\d$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`);

test('改键页动作表照 Unity SettingsScreen.Actions（顺序、名字），缺省键照 GameInput 的键盘绑定', async () => {
  const settings = await unity('UI/Screens/SettingsScreen.cs');
  const block = /static readonly \(GameAction action, string label\)\[\] Actions =([\s\S]*?)\};/.exec(settings)[1];
  const actions = [...block.matchAll(/\(GameAction\.(\w+), "([^"]+)"\)/g)].map((m) => ({ id: ACTION_OF[m[1]], label: m[2], unity: m[1] }));
  assert.equal(actions.length, 16);
  assert.deepEqual(KB.BIND_DEFS.map((d) => [d.id, d.label]), actions.map((a) => [a.id, a.label]));

  const input = (await read('../unity/Assets/Pipeline/Runtime/GameInput.cs'));
  for (const a of actions) {
    const line = new RegExp(`Button\\(GameAction\\.${a.unity}, "([^"]+)"[^;]*;`).exec(input)[0];
    const keys = [...line.matchAll(/"<Keyboard>\/(\w+)"/g)].map((m) => codeOf(m[1]));
    const mouse = [...line.matchAll(/"<Mouse>\/(\w+)"/g)].map((m) => m[1]);
    const def = KB.KeyBinds.def(a.id);
    assert.deepEqual(def.defaults, keys, `${a.label} 的键盘键`);
    // 纯鼠标动作（射击左键 / 瞄准右键）在网页是写死的；武器技能另绑的中键也写死在 core/Input，改键页只列键盘键
    if (keys.length === 0) assert.ok(def.fixed && def.mouse, `${a.label} 是纯鼠标动作，网页写死`);
    if (a.id === 'weaponSkill') assert.deepEqual(mouse, ['middleButton']);
  }
  assert.deepEqual(KB.BIND_DEFS.filter((d) => d.fixed).map((d) => d.id), ['fire', 'aim', 'pause'], '只有鼠标键与暂停不能改');
});

test('按键说明照 Unity ControlsScreen.Rows（顺序、说明文字、固定键帽）', async () => {
  const cs = await unity('UI/Screens/ControlsScreen.cs');
  const block = /\)\[\] Rows =([\s\S]*?)\};/.exec(cs)[1];
  const rows = [...block.matchAll(/\((?:GameAction\.(\w+)|null), "([^"]+)", (?:"([^"]+)"|null), (?:"([^"]+)"|null)\)/g)]
    .map((m) => ({ id: m[1] ? ACTION_OF[m[1]] : null, label: m[2], ...(m[3] ? { fixedKb: m[3] } : {}) }));
  assert.equal(rows.length, 16);
  assert.deepEqual(KB.CONTROL_ROWS.map((r) => ({ ...r })), rows);
});

test('改键：只换第一个键盘键、写死的不能改、存档只存改过的、套到输入表、恢复默认', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const input = { bindings: {} };
  const keys = new KB.KeyBinds(storage, input);
  assert.deepEqual(input.bindings.dash, ['ShiftLeft', 'ShiftRight']);
  assert.equal(input.bindings.fire, undefined, '鼠标动作不进键盘表');
  let changed = 0;
  keys.onChanged(() => changed++);
  assert.equal(keys.set('dash', 'KeyC'), true);
  assert.deepEqual(input.bindings.dash, ['KeyC', 'ShiftRight'], '只换第一个，右 Shift 留着（同 Unity）');
  assert.equal(keys.label('dash'), 'C');
  assert.equal(keys.set('fire', 'KeyZ'), false);
  assert.equal(keys.set('pause', 'KeyO'), false);
  assert.equal(keys.set('map', 'KeyN'), true);
  assert.ok(keys.matches('map', 'KeyN') && !keys.matches('map', 'KeyM'));
  assert.deepEqual(JSON.parse(store.get(KB.KEYBINDS_KEY)), { dash: 'KeyC', map: 'KeyN' });
  assert.equal(keys.set('map', 'KeyM'), true, '改回缺省 = 去掉覆盖项');
  assert.deepEqual(JSON.parse(store.get(KB.KEYBINDS_KEY)), { dash: 'KeyC' });
  // 重新进游戏：读存档套到输入表；存档里写死动作的覆盖项不认
  store.set(KB.KEYBINDS_KEY, JSON.stringify({ dash: 'KeyC', fire: 'KeyZ', reload: 'KeyT', bogus: 'KeyQ' }));
  const input2 = { bindings: {} };
  const keys2 = new KB.KeyBinds(storage, input2);
  assert.deepEqual(keys2.overrides, { dash: 'KeyC', reload: 'KeyT' });
  assert.deepEqual(input2.bindings.reload, ['KeyT']);
  keys2.reset();
  assert.equal(store.has(KB.KEYBINDS_KEY), false);
  assert.deepEqual(input2.bindings.dash, ['ShiftLeft', 'ShiftRight']);
  assert.equal(changed, 3, '改了三次（写死的、空键不算）；keys2 的恢复默认通知的是它自己的监听');
  // 坏存档：用缺省键
  store.set(KB.KEYBINDS_KEY, '{oops');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(new KB.KeyBinds(storage, null).overrides, {});
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(['KeyR', 'Digit1', 'ShiftLeft', 'ShiftRight', 'Space', 'Escape', 'Numpad3', 'F5', 'BracketLeft'].map(KB.keyName), ['R', '1', 'Shift', '右 Shift', '空格', 'Esc', '小键盘 3', 'F5', '[']);
});

// ───────────── 数据映射 ─────────────

const brief = (o) => ({ label: '1-2 · 雅丹迷城', title: '雅丹迷城', chapter: 1, chapterName: '赤沙古道', difficulty: 1.16, isBoss: false, supplyCamp: false, rewardLabel: '', ...o });

test('关卡卡片照 Unity StageCardScreen：四格、下一关预告、标签与「继续」', async () => {
  const cs = await unity('UI/Screens/StageCardScreen.cs');
  for (const lit of ['"下 一 关"', '（制作中）', '新章节 · ', '"首领关"', '"门外有补给营" : "关内有补给营"', '清关奖励 · ', '"继续" : "再走一遍本关"', '本关 +', '"本关未得"', '现有 '])
    assert.ok(cs.includes(lit), `Unity 源码里有 ${lit}`);
  const v = SD.stageCardView({
    stage: brief({ label: '1-4 · 鸣沙月泉', title: '鸣沙月泉', difficulty: 1.48, isBoss: true }),
    next: brief({ label: '2-1 · 冰瀑栈道', title: '冰瀑栈道', chapter: 2, chapterName: '北冥昆仑', difficulty: 1.4, supplyCamp: true, rewardLabel: '武器' }),
    time: 3723, kills: 1234, coinsDelta: -56, coins: 2048, scrolls: 7, scrollsGained: 0, nextReady: false,
  });
  assert.equal(v.chapter, '第一章 · 赤沙古道');
  assert.equal(v.title, '1-4 · 鸣沙月泉');
  assert.deepEqual(v.stats.map((s) => [s.icon, s.label, s.value, s.sub]), [
    ['hourglass', '用时', '1:02:03', ''], ['skull', '击杀', '1,234', ''], ['coin', '灵石', '−56', '现有 2,048'], ['spark', '秘卷', '7 层', '本关未得'],
  ]);
  assert.equal(v.nextLabel, '下 一 关');
  assert.equal(v.nextTitle, '2-1 · 冰瀑栈道（制作中）');
  assert.deepEqual(v.tags.map((t) => t.text), ['新章节 · 第二章 北冥昆仑', '难度 1.40（−0.08）', '关内有补给营', '清关奖励 · 武器']);
  assert.equal(v.continueText, '再走一遍本关');
  const boss = SD.stageCardView({ stage: brief(), next: brief({ label: '1-4 · 鸣沙月泉', isBoss: true, supplyCamp: true, difficulty: 1.48 }), time: 59, kills: 0, coinsDelta: 264, coins: 264, scrolls: 8, scrollsGained: 8, nextReady: true });
  assert.deepEqual(boss.tags.map((t) => [t.text, t.cls]), [['难度 1.48（+0.32）', ''], ['首领关', 'sf-stagecard__tag--boss'], ['门外有补给营', 'sf-stagecard__tag--camp']]);
  assert.equal(boss.stats[0].value, '0:59');
  assert.deepEqual([boss.stats[2].value, boss.stats[3].sub, boss.continueText, boss.boss], ['+264', '本关 +8', '继续', true]);
  const last = SD.stageCardView({ stage: null, next: null, title: '试炼场', time: 0, kills: 0, coinsDelta: 0, coins: 0, scrolls: 0, scrollsGained: 0, nextReady: true });
  assert.deepEqual([last.chapter, last.title, last.nextTitle, last.continueText, last.tags.length], ['', '试炼场', '（没有下一关）', '再走一遍本关', 0]);
});

test('整局结算 / 主菜单生涯照 Unity SummaryScreen / MainMenuScreen 的文字', async () => {
  const sum = await unity('UI/Screens/SummaryScreen.cs');
  for (const lit of ['"已击败全部首领"', '试玩通关 · ', '"首领关"', '止步于 ', '"魂火未熄，再入轮回"', '"首章已破，余火待燃"', '局内收集 ', '回主菜单可在「天赋」里花掉'])
    assert.ok(sum.includes(lit), `Unity 源码里有 ${lit}`);
  const spec = { label: '1-2 · 雅丹迷城', title: '雅丹迷城', isBoss: false };
  assert.equal(SD.reachText({ victory: false, chapter: 0, stageIndex: 1 }, spec, false), '止步于 第一章 · 第 2 关（雅丹迷城）');
  assert.equal(SD.reachText({ victory: false, chapter: 1, stageIndex: 3 }, { ...spec, isBoss: true, title: '北冥' }, false), '止步于 第二章 · 首领关（北冥）');
  assert.equal(SD.reachText({ victory: false, chapter: 2, stageIndex: 0 }, null, false), '止步于 第三章 · 第 1 关');
  assert.equal(SD.reachText({ victory: true, chapter: 0, stageIndex: 3 }, spec, false), '试玩通关 · 1-2 · 雅丹迷城');
  assert.equal(SD.reachText({ victory: true, chapter: 3, stageIndex: 3 }, spec, true), '已击败全部首领');
  assert.deepEqual([SD.epitaphText(false, false, 4), SD.epitaphText(true, true, 4), SD.epitaphText(true, false, 3)], ['魂火未熄，再入轮回', '首章已破，余火待燃', '三章尽破，烈焰长明']);
  assert.equal(SD.essenceNote(486, 200), '局内收集 286 + 通关奖励 200，已存入魂晶');
  assert.equal(SD.essenceNote(86, 0), '局内收集的魂晶已存入，回主菜单可在「天赋」里花掉');

  const menu = await unity('UI/Screens/MainMenuScreen.cs');
  for (const k of ['("出征", ', '("通关", ', '("最远", ', '("最多清关", ', '尚无出征记录。试玩版共 ', '击败沿途全部首领即可通关。']) assert.ok(menu.includes(k), k);
  assert.equal(SD.careerItems({ runs: 0, wins: 0, bestChapter: 0, bestStages: 0, totalKills: 0 }), null);
  assert.deepEqual(SD.careerItems({ runs: 12, wins: 2, bestChapter: 3, bestStages: 11, totalKills: 2486 }).map((i) => `${i.k} ${i.v}`), ['出征 12 次', '通关 2 次', '最远 第三章', '最多清关 11 关', '累计斩敌 2,486']);
  assert.equal(SD.careerItems({ runs: 1, wins: 0, bestChapter: 0, bestStages: 0, totalKills: 3 })[2].v, '—');
  assert.equal(SD.firstRunText(4, true, '1-4 · 鸣沙月泉'), '尚无出征记录。试玩版共 4 关，到 1-4 · 鸣沙月泉 为止。');
  assert.equal(SD.firstRunText(16, false, ''), '尚无出征记录。共 16 关，击败沿途全部首领即可通关。');
  assert.deepEqual([1, 9, 10, 11, 20, 23, 99].map(SD.cnNum), ['一', '九', '十', '十一', '二十', '二十三', '九十九']);
});

test('天赋行、秘卷卡面、选英雄技能行照 Unity TalentScreen / ScrollChoiceScreen / HeroSelectScreen', async () => {
  const tal = await unity('UI/Screens/TalentScreen.cs');
  for (const lit of ['当前 ', '下一级 ', '花费 {cost} 魂晶强化', '还差 {cost - have} 魂晶', '已点亮 ']) assert.ok(tal.includes(lit), lit);
  const t = { id: 'vitality', name: '生命强化', description: '', maxLevel: 5, perLevel: 8, cost: (lv) => 60 + 60 * lv };
  const fmt = (v) => `+${v}`;
  assert.deepEqual(SD.talentRow(t, 3, 100, fmt), { level: '3 / 5', maxed: false, cost: 240, short: true, now: '当前 +24', next: '下一级 +32', tooltip: '还差 140 魂晶', pips: [true, true, true, false, false] });
  assert.equal(SD.talentRow(t, 1, 500, fmt).tooltip, '花费 120 魂晶强化');
  assert.deepEqual(SD.talentRow(t, 5, 0, fmt), { level: '5 / 5', maxed: true, cost: 0, short: false, now: '当前 +40', next: '', tooltip: '', pips: [true, true, true, true, true] });
  assert.deepEqual(SD.talentTotals([t, { ...t, id: 'b', maxLevel: 3 }], (id) => (id === 'b' ? 9 : 2)), { owned: 5, total: 8 });

  const sc = await unity('UI/Screens/ScrollChoiceScreen.cs');
  for (const lit of ['"升层" : "新得"', '（已满）', '层数 {cur} → {next} / {max}', '"唯一 · 已持有" : "唯一"', '"代价"']) assert.ok(sc.includes(lit), lit);
  const glass = LEGEND.find((d) => d.id === 'glass_cannon');
  const v = SD.scrollCardView(glass, 0, '传说');
  assert.deepEqual([v.state, v.rarityVertical, v.upside, v.downside, v.pips, v.count], ['新得', '传\n说', '武器伤害 +55%。', '受到的伤害 +35%。', [], '唯一']);
  const stack = SD.scrollCardView({ id: 'blade', name: '利刃', description: '武器伤害每层 +{n}×6%。', rarity: 0, maxStacks: 3 }, 2, '普通');
  assert.deepEqual([stack.state, stack.cur, stack.next, stack.upside, stack.pips, stack.count], ['升层', 2, 3, '武器伤害每层 +3×6%。', ['owned', 'owned', 'next'], '层数 2 → 3 / 3']);
  assert.equal(SD.scrollCardView({ ...glass, maxStacks: 3 }, 3, '传说').count, '层数 3 / 3（已满）');
  assert.equal(SD.scrollCardView(glass, 1, '传说').count, '唯一 · 已持有');

  assert.deepEqual(SD.skillRow({ name: '燃爆雷', description: '掷出一枚爆竹手雷。2 次充能，每次充能 8 秒。', cooldown: 8, charges: 2 }, true), { name: '燃爆雷', meta: '冷却 8 秒 · 2 次充能', desc: '掷出一枚爆竹手雷。' });
  assert.deepEqual(SD.skillRow({ name: '尾焰火灵', description: '唤出九团火灵。冷却 20 秒。', cooldown: 20, charges: 1 }, false), { name: '尾焰火灵', meta: '冷却 20 秒', desc: '唤出九团火灵。' });
  assert.deepEqual(SD.skillRow(null, false), { name: '—', meta: '', desc: '' });
  assert.deepEqual([SD.barRatio(90, [100, 90, 140]), SD.barRatio(5, [0]), SD.barRatio(200, [100])], [90 / 140, 0, 1]);
});

test('高风险传说卷的代价行照 Unity：卡面收益 / 「代价」朱字行分开（SplitDownside），行囊另起一行「代价：…」，图鉴整段说明代价行标红（Describe 富文本）', async () => {
  const base = await unity('Progression/Scrolls/Legend/LegendScroll.cs');
  assert.equal(SD.DOWNSIDE_PREFIX, /DownsidePrefix = "([^"]+)"/.exec(base)[1]);
  assert.equal(SD.DOWNSIDE_COLOR, `#${/DownsideHex = "([0-9a-f]{6})"/.exec(base)[1]}`);
  assert.deepEqual([SD.DOWNSIDE_PREFIX, SD.DOWNSIDE_COLOR], [SCROLL_KIT.DOWNSIDE_PREFIX, SCROLL_KIT.DOWNSIDE_COLOR], 'ScreenData 与 ScrollKit 同值');
  // Unity 卡面：传说卷（HighRisk）用 upside / downside 两段；别的卷从描述里摘红色代价行
  const sc = await unity('UI/Screens/ScrollChoiceScreen.cs');
  assert.match(sc, /if \(def is LegendScroll \{ HighRisk: true \} ls\)\s*\{\s*upside = Fill\(def, ls\.upside, stacks\);\s*downside = Fill\(def, ls\.downside, stacks\);/);
  assert.match(sc, /ScreenKit\.Text\("sf-scroll__downlabel", down, "代价"\);\s*ScreenKit\.Text\("sf-scroll__downtext", down, downside\);/);
  // 网页的七张传说卷逐张对 Unity Legendary.cs 的 Text(收益, 代价)
  const legendary = await unity('Progression/Scrolls/Legend/Legendary.cs');
  const pairs = [...legendary.matchAll(/Text\("([^"]+)"(?:, "([^"]+)")?\);/g)].map((m) => [m[1], m[2] ?? '']);
  const mine = LEGEND.filter((d) => !d.heroOnly);
  assert.equal(mine.length, pairs.length);
  for (const d of mine) {
    const pair = pairs.find(([up]) => up === d.upside);
    assert.ok(pair, `${d.id}：Unity 有同样的收益文字`);
    const v = SD.scrollCardView(d, 0, '传说');
    assert.deepEqual([v.upside, v.downside], pair, `${d.id}：卡面收益 / 代价`);
    // 图鉴：Describe(1) = 收益 + 换行 + <color=#ff6a50>代价：…</color>（LegendScroll.Text）
    assert.equal(SD.scrollRichText(d, 1), pair[1] ? `${pair[0]}\n<color=#ff6a50>代价：${pair[1]}</color>` : pair[0], `${d.id}：整段说明`);
    // 拆开以后不能再带着描述里拼好的「代价：」行
    assert.doesNotMatch(v.upside, /代价/, d.id);
  }
  // 只有描述、没有 upside / downside 字段的卷：从描述里摘「代价：…」那一行（Unity 摘 <color=#ff6a50> 那一段）
  assert.deepEqual(SD.splitDownside({ description: '射速每层 +{n}×5%。\n代价：受到的伤害每层 +{n}×3%。' }, 2), { upside: '射速每层 +2×5%。', downside: '受到的伤害每层 +2×3%。' });
  assert.deepEqual(SD.splitDownside({ description: '武器伤害 +8%。' }, 1), { upside: '武器伤害 +8%。', downside: '' });
  // 行囊（Unity ScrollList.Render，detailed）：收益富文本一行 + sf-owned__down「代价：」+ 代价；暂停页的小签不带说明
  const list = await unity('UI/Screens/ScrollList.cs');
  assert.match(list, /ScrollChoiceScreen\.SplitDownside\(def, stacks, out var up, out var down\);\s*ScreenKit\.Text\("sf-owned__desc", row, up, rich: true\);\s*if \(!string\.IsNullOrEmpty\(down\)\) ScreenKit\.Text\("sf-owned__down", row, "代价：" \+ down\);/);
  const kit = await read('../src/ui/screens/ScreenKit.ts');
  assert.match(kit, /const \{ upside, downside \} = splitDownside\(def, stacks\);\s*text\('sf-owned__desc', row, upside, UIFontRole\.Body, true\);\s*if \(downside\) text\('sf-owned__down', row, DOWNSIDE_PREFIX \+ downside\);/);
  // 图鉴（Unity CodexScreen.DescribeScroll：dDesc.text = s.Describe(1)，dDesc 是富文本标签）
  const codex = await read('../src/ui/screens/CodexScreen.ts');
  assert.match(codex, /const one = scrollRichText\(s, 1\);\s*this\.setDesc\(one\);/);
  assert.match(codex, /private setDesc\(s: string\): void \{\s*setText\(this\.dDesc, s\);/);
});

// ───────────── 行囊属性表、精英印章色、图鉴武器缩略图、关卡卡片的触发 ─────────────

/** Unity `Stat.MaxHp, Stat.CritChance…` → 网页 StatKey（首字母小写） */
const statKeys = (block) => [...block.matchAll(/Stat\.(\w+)/g)].map((m) => m[1][0].toLowerCase() + m[1].slice(1));

test('Tab 行囊常驻属性照 Unity StatGrid.KeyStats（14 项同序），暂停页精简表照 StatGrid.PauseStats', async () => {
  const cs = await unity('UI/Screens/StatGrid.cs');
  const keys = statKeys(/Stat\[\] KeyStats =\s*\{([\s\S]*?)\};/.exec(cs)[1]);
  const pause = statKeys(/Stat\[\] PauseStats =\s*\{([\s\S]*?)\};/.exec(cs)[1]);
  assert.equal(keys.length, 14);
  assert.deepEqual(INV.KEY_STATS, keys);
  assert.deepEqual(KIT.PAUSE_STATS, pause);
  // 行囊用的就是这张表（Unity InventoryPanel：StatGrid.Render(statsGrid, …, StatGrid.KeyStats, true)）
  assert.match(await unity('UI/Screens/InventoryPanel.cs'), /StatGrid\.KeyStats, true\)/);
  assert.match(await read('../src/ui/screens/InventoryScreen.ts'), /renderStatGrid\(ctx, this\.statsGrid, KEY_STATS, true\)/);
  // 属性名照 Unity StatInfo（局内货币叫灵石，D13）
  const { STAT_INFO } = await graph.load('core/Stats.ts');
  assert.equal(STAT_INFO.coinGainPct.name, /Stat\.CoinGainPct => new\(s, "([^"]+)"/.exec(await unity('Core/StatInfo.cs'))[1]);
});

test('局内货币在界面上叫灵石（Unity D13）：src/ui 不出现「金币」；属性名、天赋说明、清关奖励名照 Unity', async () => {
  const files = (await readdir(new URL('../src/ui/', import.meta.url), { recursive: true })).filter((f) => /\.(ts|css)$/.test(f));
  for (const f of files) assert.doesNotMatch(await read(`../src/ui/${f.replace(/\\/g, '/')}`), /金币/, f);
  // 天赋（Talent_*.cs 的 base(id, 名字, 属性, 每级, 说明)），天赋页逐行显示说明
  const meta = await read('../src/progression/Meta.ts');
  const web = Object.fromEntries([...meta.matchAll(/talent\('(\w+)', '([^']+)', '(\w+)', ([\d.]+), '([^']+)'\)/g)].map((m) => [m[1], [m[2], m[3], Number(m[4]), m[5]]]));
  const dir = new URL(U + 'Progression/Meta/Talents/', import.meta.url);
  const talents = (await readdir(dir)).filter((f) => /^Talent_\w+\.cs$/.test(f));
  assert.equal(talents.length, 10);
  for (const f of talents) {
    const m = /base\("(\w+)", "([^"]+)", Stat\.(\w+), ([\d.]+)f, "([^"]+)"\)/.exec(await unity(`Progression/Meta/Talents/${f}`));
    assert.deepEqual(web[m[1]], [m[2], m[3][0].toLowerCase() + m[3].slice(1), Number(m[4]), m[5]], f);
  }
  // 关卡卡片「清关奖励 · …」（Unity StageCardScreen → Chest.Label）
  const chest = await unity('Loot/Chest.cs');
  const run = await read('../src/progression/RunPlan.ts');
  for (const key of ['weapon', 'scroll', 'coins', 'upgrade']) {
    const label = new RegExp(`case "${key}": return "([^"]+)";`).exec(chest)[1];
    assert.match(run, new RegExp(`\\b${key}: '${label}'`), `${key} → ${label}`);
  }
});

test('掉落 / 宝箱 / 商店给玩家看的灵石提示照 Unity（D13）：强化 / 秘卷满层转灵石、宝箱「一大堆灵石」、商店「灵石不足」', async () => {
  const loot = await read('../src/progression/Loot.ts');
  const chests = await read('../src/progression/loot/Chests.ts');
  const shop = await read('../src/progression/loot/Shop.ts');
  // 强化奖励没得强化（UpgradeReward.Grant：Toast(w != null ? 满级 : 没有武器)）
  const up = /Toast\(w != null \? "([^"]+)" : "([^"]+)"\)/.exec(await unity('Loot/Rewards/UpgradeReward.cs'));
  assert.ok(loot.includes(`ctx.ui.toast(w ? '${up[1]}' : '${up[2]}'`), `${up[1]} / ${up[2]}`);
  // 秘卷全部满层（LootDirector.OfferScrolls）
  const full = /GameUI\.Toast\("(秘卷已全部满层[^"]*)"/.exec(await unity('Loot/LootDirector.cs'))[1];
  assert.ok(loot.includes(`ctx.ui.toast('${full}'`), full);
  // 宝箱说明行（CoinsReward.Line 的普通档 / 精英档；网页按关卡类型，只在精英关标精英加成，见迁移计划 4.6 第 8 条）
  const [, line, eliteLine] = /Line\(string\[\] args\) => [^?]+\? "([^"]+)" : "([^"]+)"/.exec(await unity('Loot/Rewards/CoinsReward.cs'));
  assert.ok(chests.includes(`return type === 'elite' ? '${eliteLine}' : '${line}';`), `${line} / ${eliteLine}`);
  // 商店买不起（ShopCounter.NotEnough；HUD 交互卡 PromptWidget 同样写这个）
  const notEnough = /NotEnough = "([^"]+)"/.exec(await unity('Loot/Shop/ShopCounter.cs'))[1];
  assert.ok(shop.includes(`this.deny('${notEnough}')`), notEnough);
  assert.match(await read('../src/ui/hud/PromptWidget.ts'), new RegExp(notEnough));
  // 三份文件的字串里不再有「金币」（注释里说的是代码概念，不算）
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const [f, src] of [['Loot.ts', loot], ['Chests.ts', chests], ['Shop.ts', shop]]) assert.doesNotMatch(code(src), /金币/, f);
});

test('精英印章的词缀纹样用词缀本身的颜色（Unity EliteSeal ← aura.Accent ← affix.Color），血条词缀小标签用 AffixLabels 的颜色', async () => {
  const seal = await unity('UI/Widgets/EliteSeal.cs');
  assert.match(seal, /var tint = sig == EliteSigil\.None \? Gold : aura\.Accent\.Value;/);
  assert.match(await unity('Enemies/Affixes/EliteAffixes.cs'), /aura\.SetSigil\(affix\.Id, affix\.Color\)/);
  const hex = (c) => c.slice(0, 3).map((v) => Math.round(v * 255)).reduce((a, v) => a * 256 + v, 0);
  for (const id of AFFIXES.AFFIX_IDS) {
    const name = id[0].toUpperCase() + id.slice(1);
    const src = await unity(`Enemies/Affixes/EliteAffix_${name}.cs`);
    const want = Number(/Color => Hex\.Rgb\((0x[0-9a-f]+)\)/.exec(src)[1]);
    assert.equal(hex(BARS.AFFIX_SEAL_COLORS[id]), want, `${id} 印章色 = EliteAffix_${name}.Color`);
  }
  const bars = await unity('UI/Widgets/EnemyBars.cs');
  for (const m of bars.matchAll(/\["(\w+)"\] = \("([^"]+)", Hex\.Rgb\((0x[0-9a-f]+)\), "([^"]+)"\)/g)) {
    const l = BARS.AFFIX_LABELS[m[1]];
    assert.deepEqual([l.name, hex(l.color), l.hint], [m[2], Number(m[3]), m[4]], `${m[1]} 小标签`);
  }
  assert.match(await read('../src/ui/hud/EnemyBars.ts'), /s\.seal\.bind\(s\.elite, affixId \|\| null, isAffixId\(affixId\) \? AFFIX_SEAL_COLORS\[affixId\] : null\);/);
});

test('图鉴武器缩略图只拍枪身：去掉掉落模型的稀有度光晕精灵再取景（Unity CodexThumbs 实例化裸枪 prefab）', async () => {
  const cs = await unity('UI/Screens/CodexThumbs.cs');
  assert.match(cs, /Object\.Instantiate\(prefab/);
  assert.doesNotMatch(cs, /Halo|halo|光晕/);
  // 掉落模型里确实挂着光晕精灵
  assert.match(await read('../src/weapons/WeaponModels.ts'), /const halo = new THREE\.Sprite\(haloMat\(rarity\)\);[\s\S]*?holder\.add\(halo\);/);
  assert.match(await read('../src/ui/codex/CodexThumbs.ts'), /return bareGun\(this\.ctx\.weapons\.createWorldModel\(inst\)\);/);
  const holder = new THREE.Group();
  const gun = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.1), new THREE.MeshBasicMaterial());
  const halo = new THREE.Sprite(new THREE.SpriteMaterial());
  halo.scale.set(3, 1, 1);
  holder.add(gun, halo);
  const out = THUMBS.bareGun(holder);
  assert.equal(out, holder);
  let sprites = 0;
  out.traverse((o) => { if (o.isSprite) sprites++; });
  assert.equal(sprites, 0, '光晕摘掉了');
  assert.equal(gun.parent, holder, '枪身还在');
  const size = new THREE.Box3().setFromObject(out).getSize(new THREE.Vector3());
  assert.deepEqual([size.x, size.y, size.z].map((v) => Math.round(v * 1000) / 1000), [1, 0.2, 0.1], '取景包围盒只算枪身');
});

test('关卡卡片只在玩家从出口进门时弹（Unity GameSession.CompleteStage），检视页直接 game.advance 不弹', async () => {
  const session = await unity('Core/GameSession.cs');
  assert.match(session, /if \(Managed && !final && UIRouter\.Get\(StageCardScreen\.ScreenId\) != null\)/);
  assert.equal([...session.matchAll(/UIRouter\.Open\(StageCardScreen\.ScreenId/g)].length, 1, 'Unity 只有过关这一处弹卡');
  // Game.advance 本身不问 UI：检视页（adventureLab / whiteboxLab）的跳关、重置、换关直接调它
  const game = await read('../src/core/Game.ts');
  const advance = /\n  advance\(next: StageNode\): void \{([\s\S]*?)\n  \}/.exec(game)[1];
  assert.doesNotMatch(advance, /stageCard/);
  for (const lab of ['adventureLab', 'whiteboxLab']) assert.match(await read(`../src/dev/${lab}.ts`), /game\.advance\(node\);/, lab);
  // 出口进门：先问 UI；弹了卡就等「继续」，没弹（不在游玩中 / 没有路线数据）就直接换关
  const calls = [];
  let proceed = null, showCard = true;
  const ctx = {
    time: { now: 10 },
    ui: { stageCard: (node, cb) => { calls.push(['card', node.id]); proceed = cb; return showCard; } },
    game: { advance: (node) => calls.push(['advance', node.id]) },
  };
  const portal = Object.assign(Object.create(PORTAL.Portal.prototype), { ctx, node: { id: '1-2' }, ready: true, disposed: false, lastUse: -10 });
  portal.enter();
  assert.deepEqual(calls, [['card', '1-2']], '弹卡时先不换关');
  proceed();
  assert.deepEqual(calls, [['card', '1-2'], ['advance', '1-2']], '按「继续」才换关');
  calls.length = 0;
  showCard = false;
  ctx.time.now = 20;
  portal.enter();
  assert.deepEqual(calls, [['card', '1-2'], ['advance', '1-2']], 'UI 没弹卡就直接换关');
  calls.length = 0;
  ctx.time.now = 20.5;
  portal.enter();
  assert.deepEqual(calls, [], '1 秒内重复进门不算');
});

// ───────────── 图鉴 ─────────────

/** Unity 图鉴的敌人：Enemies/Defs 的每个定义类（[Defs(序)] + id），去掉附属单位；首领：Bosses 的 BossDef 子类（[Defs(序)]、Id、name、title），去掉测试场的 */
async function unityRoster() {
  const root = new URL(U + 'Enemies/Defs/', import.meta.url);
  const consts = new Map();
  for (const m of (await unity('Enemies/AI/Inferno/TantongAI.cs')).matchAll(/(\w+Id) = "([^"]+)"/g)) consts.set(`TantongAI.${m[1]}`, m[2]);
  const enemies = [];
  for (const d of await readdir(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = d.name;
    for (const f of (await readdir(new URL(dir + '/', root))).filter((n) => n.endsWith('.cs'))) {
      const s = await unity(`Enemies/Defs/${dir}/${f}`);
      const order = Number(/\[Defs\((\d+)\)\]/.exec(s)[1]);
      const ref = /\bid = ([\w.]+),/.exec(s)?.[1];
      const id = /const string Id = "([^"]+)"/.exec(s)?.[1] ?? /\bid = "([^"]+)"/.exec(s)?.[1] ?? consts.get(ref);
      assert.ok(id, `${f} 读不到 id`);
      enemies.push({ id, order });
    }
  }
  const bosses = [];
  for (const d of await readdir(new URL(U + 'Bosses/', import.meta.url), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = d.name;
    for (const f of (await readdir(new URL(U + `Bosses/${dir}/`, import.meta.url))).filter((n) => /Def\.cs$/.test(n))) {
      const s = await unity(`Bosses/${dir}/${f}`);
      const order = /\[Defs\((\d+)\)\]/.exec(s);
      const id = /const string Id = "([^"]+)"/.exec(s);
      if (!order || !id) continue;
      bosses.push({ id: id[1], order: Number(order[1]), name: /\bname = "([^"]+)"/.exec(s)[1], title: /\btitle = "([^"]+)"/.exec(s)?.[1] ?? '' });
    }
  }
  return { enemies, bosses };
}

test('图鉴敌人名册照 Unity：[Defs] 序、附属单位 / 测试场首领不列、首领名与称号、Lore 逐条一致', async () => {
  const codex = await unity('Progression/Codex.cs');
  const set = (name) => new Set([...new RegExp(`${name} = new\\(\\) \\{([^}]*)\\}`).exec(codex)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const hidden = new Set([...set('hiddenEnemies'), ...set('hiddenBosses')]);
  assert.deepEqual([...CX.HIDDEN_ENEMIES].sort(), [...hidden].sort());
  const alias = /enemyAlias = new\(\) \{([^}]*)\}/.exec(codex)[1];
  assert.deepEqual(CX.ENEMY_ALIAS, Object.fromEntries([...alias.matchAll(/\["(\w+)"\] = "(\w+)"/g)].map((m) => [m[1], m[2]])));

  const { enemies, bosses } = await unityRoster();
  const listed = enemies.filter((e) => CX.codexEnemyId(e.id) === e.id);
  assert.deepEqual(CX.ENEMY_ORDER, Object.fromEntries(listed.sort((a, b) => a.order - b.order).map((e) => [e.id, e.order])));
  assert.equal(listed.length, 37);
  const shown = bosses.filter((b) => !hidden.has(b.id)).sort((a, b) => a.order - b.order);
  assert.deepEqual(CX.BOSS_CARDS, Object.fromEntries(shown.map((b) => [b.id, [b.order, b.name, b.title]])));
  assert.equal(shown.length, 7);

  const lore = Object.fromEntries([...codex.matchAll(/\["(\w+)"\] = \((\d), "([^"]+)"\)/g)].map((m) => [m[1], [Number(m[2]), m[3]]]));
  assert.deepEqual(CX.LORE, lore);
  assert.equal(Object.keys(lore).length, 32);
  // 角色名照 Unity RoleName：没有站位数据的网页敌人写「敌人」（Unity 每个敌人都有站位，落到「辅助」）
  assert.deepEqual(['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'].map((p) => CX.roleName({ id: 'x', name: 'x', placement: p })), ['突击', '侧袭', '远程', '狙击', '炮击', '辅助']);
  assert.equal(CX.roleName({ id: 'x', name: 'x', placement: 'flank', flying: true }), '侧袭 · 飞行');
});

test('图鉴清单：只列 Unity 有的；武器按定义表、秘卷按稀有度、敌人按章与 [Defs] 序（首领在本章敌人之后，没写章的在最后）', () => {
  const white = [1, 1, 1, 1];
  const cat = new CX.CodexCatalog({
    weapons: [{ id: 'smg', name: '蜂鸣冲锋枪', category: '冲锋枪', element: 'none' }, { id: 'flamer', name: '朱雀吐息', category: '喷火器', element: 'fire' }],
    scrolls: [{ id: 'a', name: 'A', rarity: 2 }, { id: 'b', name: 'B', rarity: 0 }, { id: 'c', name: 'C', rarity: 2 }, { id: 'd', name: 'D', rarity: 1 }],
    // 网页注册表的顺序是乱的，还混着旧名册、附属件、测试场首领
    enemies: [
      { id: 'grunt', name: '沙匪刀客' }, { id: 'marmot', name: '啸獭', placement: 'assault' }, { id: 'boss_kui', name: '夔', isBoss: true },
      { id: 'boss_warlord', name: '熔心魔将 · 熔火深渊的统帅', isBoss: true }, { id: 'tantong', name: '炭童', placement: 'assault' },
      { id: 'boss_hanba', name: '旱魃 · 赤地之源', isBoss: true }, { id: 'mirage_toad', name: '蜃楼蟾', placement: 'artillery', element: 'fire' },
      { id: 'jerboa_blade', name: '跳鼠刀兵', placement: 'flank' }, { id: 'boss_colossus', name: '沙暴巨像', isBoss: true },
      { id: 'boss_qilin_lock', name: '吊鼎锁扣' }, { id: 'mirage_toad_decoy', name: '蜃景分身' }, { id: 'boss_proxy', name: '试炼傀儡', isBoss: true },
      { id: 'jiaoren', name: '冻鲛人', placement: 'flank' }, { id: 'boss_qilin', name: '火麒麟', isBoss: true },
    ],
    pets: [{ id: 'fox', name: '赤狐', title: '燎原之尾', rarityName: '灵品', rarityColor: 0x4aa3ff }],
    rarityName: (r) => ['普通', '精良', '稀有', '史诗', '传说'][r],
    rarityColor: () => white,
    elementColor: () => [1, 0.55, 0.2, 1],
  });
  assert.deepEqual(cat.of('weapon').map((e) => `${e.id}:${e.subtitle}`), ['smg:冲锋枪', 'flamer:喷火器']);
  assert.deepEqual(cat.of('weapon')[1].color, [1, 0.55, 0.2, 1], '元素武器用元素色');
  assert.deepEqual(cat.of('scroll').map((e) => `${e.id}:${e.subtitle}`), ['b:普通秘卷', 'd:精良秘卷', 'a:稀有秘卷', 'c:稀有秘卷']);
  assert.deepEqual(cat.of('enemy').map((e) => e.id), ['jerboa_blade', 'mirage_toad', 'boss_hanba', 'jiaoren', 'tantong', 'boss_warlord', 'boss_qilin', 'marmot', 'boss_kui']);
  const hanba = cat.find('enemy', 'boss_hanba');
  assert.deepEqual([hanba.name, hanba.subtitle, hanba.boss, hanba.chapter], ['旱魃', '首领 · 赤地之源', true, 1]);
  assert.deepEqual([cat.find('enemy', 'mirage_toad').subtitle, cat.find('enemy', 'marmot').chapter], ['炮击', 0]);
  assert.equal(CX.describeEnemy(cat.find('enemy', 'marmot')), '突击型敌人。');
  assert.equal(CX.describeEnemy(cat.find('enemy', 'boss_kui')), '镇守一方的首领。');
  assert.equal(cat.find('pet', 'fox').subtitle, '灵品 · 燎原之尾');
  assert.equal(cat.total, 2 + 4 + 9 + 1);
  assert.equal(CX.codexEnemyId('tantong_reborn'), 'tantong');
  assert.equal(CX.codexEnemyId('tantong_ember'), null);
});

test('图鉴分页 4 × 3（Unity CodexScreen.Columns / Rows），翻页绕回', async () => {
  const cs = await unity('UI/Screens/CodexScreen.cs');
  const [, cols, rows] = /const int Columns = (\d+), Rows = (\d+)/.exec(cs);
  assert.deepEqual([CX.CODEX_COLUMNS, CX.CODEX_ROWS, CX.CODEX_PER_PAGE], [Number(cols), Number(rows), cols * rows]);
  assert.deepEqual([0, 1, 12, 13, 44, 118].map(CX.pageCount), [1, 1, 1, 2, 4, 10]);
  assert.deepEqual([CX.wrapPage(-1, 4), CX.wrapPage(4, 4), CX.wrapPage(2, 4)], [3, 0, 2]);
});

test('图鉴收录存档：首次收录记「新」、看过清掉、认不出的 id 原样保留但不计数、坏存档从空开始', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const book = new CX.Codex(storage);
  const heard = [];
  book.onUnlocked((k, id) => heard.push(`${k}:${id}`));
  assert.equal(book.unlock('enemy', 'apsara'), true);
  assert.equal(book.unlock('enemy', 'apsara'), false);
  assert.equal(book.unlock('enemy', 'grunt'), true, '不在清单里的也收（同 Unity）');
  assert.equal(book.unlock('weapon', ''), false);
  assert.deepEqual(heard, ['enemy:apsara', 'enemy:grunt']);
  book.catalog = { of: (k) => (k === 'enemy' ? [{ id: 'apsara' }, { id: 'tomb_beast' }] : []) };
  assert.deepEqual([book.count('enemy'), book.totalCount, book.freshCount('enemy')], [1, 1, 1]);
  book.markSeen('enemy', 'apsara');
  assert.equal(book.isFresh('enemy', 'apsara'), false);
  book.flush();
  assert.deepEqual(JSON.parse(store.get(CX.CODEX_KEY)), { weapon: [], scroll: [], enemy: ['apsara', 'grunt'], pet: [], fresh: ['enemy:grunt'] });
  const again = new CX.Codex(storage);
  assert.deepEqual([...again.unlockedIds('enemy')], ['apsara', 'grunt']);
  assert.equal(again.isFresh('enemy', 'grunt'), true);
  again.restore('{"enemy":["a","a",3,""],"weapon":"nope"}');
  assert.deepEqual([[...again.unlockedIds('enemy')], [...again.unlockedIds('weapon')]], [['a'], []]);
  again.restore('not json');
  assert.equal(again.unlockedIds('enemy').length, 0);
});

// ───────────── 全图 ─────────────

test('全图方位与投影照 Unity MapMarkers / MapScreen（导出器只翻 X：x_web = −x_unity）', async () => {
  // 视线朝向：网页视线 (−sin yaw, −cos yaw) 换成 Unity 坐标 (sin yaw, −cos yaw)，Unity Heading = atan2(x, z)
  for (const yaw of [0, 0.4, Math.PI / 2, 2.5, Math.PI, -1.1, 7]) {
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const want = (Math.atan2(fx, fz) * 180) / Math.PI;
    assert.ok(Math.abs(MM.deltaAngle(want, MM.headingOf(yaw))) < 1e-9, `yaw ${yaw}`);
  }
  // 方位：Unity Bearing = atan2(Δx_unity, Δz)
  for (const [ax, az, bx, bz] of [[0, 0, 5, 0], [3, -2, -7, 9], [10, 10, 10, -4], [-1, 4, 2, 4]]) {
    const want = (Math.atan2(-bx - -ax, bz - az) * 180) / Math.PI;
    assert.ok(Math.abs(MM.deltaAngle(want, MM.bearing(ax, az, bx, bz))) < 1e-9);
  }
  // 俯视图：Unity u = (x_unity − xMin) / 宽、top = 1 − (z − zMin) / 高；网页的底图范围 = [−xMax, −xMin, zMin, zMax]（WebSceneExporter）
  const doc = JSON.parse(await read('../public/assets/levels/1-1/level.json'));
  const area = doc.map.area;
  const [xMin, xMax, zMin, zMax] = [-area[1], -area[0], area[2], area[3]];
  const unityUV = (x, z) => ({ u: (-x - xMin) / (xMax - xMin), v: 1 - (z - zMin) / (zMax - zMin) });
  const points = [doc.spawn.position, ...doc.encounters.map((e) => e.position)];
  for (const [x, , z] of points) {
    const w = MM.worldToMap(area, x, z), u = unityUV(x, z);
    assert.ok(Math.abs(w.u - u.u) < 1e-9 && Math.abs(w.v - u.v) < 1e-9, `${x}, ${z}`);
  }
  const spawn = MM.worldToMap(area, doc.spawn.position[0], doc.spawn.position[2]);
  assert.ok(spawn.u < 0.25 && spawn.v > 0.7, '1-1 出生点在俯视图左下（古道起点）');
  // 图框：左右各留 90、上下共留 230、最宽 1500（Unity MapScreen 常数），保持底图长宽比
  const cs = await unity('UI/Screens/MapScreen.cs');
  const [, side, tb, maxW] = /SideMargin = (\d+)f, TopBottom = (\d+)f, MaxW = (\d+)f/.exec(cs);
  assert.deepEqual([side, tb, maxW].map(Number), [90, 230, 1500]);
  assert.deepEqual(MM.mapBoxSize(1554, 1080, [0, 100, 0, 100]), { w: 850, h: 850 });
  assert.deepEqual(MM.mapBoxSize(1920, 1080, [0, 400, 0, 100]), { w: 1500, h: 375 });
});
