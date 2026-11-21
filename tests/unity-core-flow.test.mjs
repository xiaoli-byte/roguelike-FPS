// M11d 核心 · 局流程（docs/threejs-migration.md 4.7）：真的 Game.ts 的开局 / 阵亡 / 换关 / 暂离 / 继续征程，照 Unity 的
// GameSession.OnDied、SceneFlow.Arrive、MenuFlow.StartRun / Suspend / ResumeRun 的先后顺序断言。
// Game 用到的存档、元进度、路线规划、续玩档、时间仲裁、模态栈、事件、任务都是真的；渲染器、场景搭建、界面、玩家、武器、秘卷、掉落是最小的假对象
// （tsGraph 按文件打桩；Game.ts 新加相对 import 时，重的模块要在下面 STUBS 里补桩）。
// 假秘卷「聚宝盆」、假掉落「每关补 35% 备弹」都挂在 stage:loaded 上，和网页真的 defsUtility.ts / Loot.ts 一样——这正是进关快照不能包含的东西。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { cs, tsGraph } from './unity-parity-kit.mjs';

const gameSource = stripTypeScriptTypes(readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace("from 'three'", "from './__three'");

const STUBS = {
  'core/Game.ts': gameSource,
  // 渲染器在 node 里建不起来；其余 three 照用真的
  'core/__three.ts': `export * from 'three';
    export class WebGLRenderer { constructor() { this.shadowMap = { enabled: true, type: 0 }; this.autoClear = true; }
      setClearColor() {} setPixelRatio() {} setSize() {} clear() {} render() {} clearDepth() {} }`,
  'core/Input.ts': `export class Input { constructor() { this.enabled = false; this.pointerLocked = false; this.freeLook = false; this.bindings = {}; this.onLockChange = null; }
    keyPressed() { return false; } endFrame() {} requestLock() {} exitLock() {} flushMouse() {} }`,
  'world/Collision.ts': 'export class CollisionWorld {}',
  'world/UnityNavigation.ts': 'export class UnityNavigation {}',
  // 场景清单（备选图在不在）：测试控制什么时候读到
  'world/UnityLevelLibrary.ts': 'export const UnityLevelLibrary = { manifest: async () => ({ stages: await globalThis.__manifest() }) };',
  'world/StageDirector.ts': `export class StageDirector {
    constructor(ctx) { this.ctx = ctx; this.arena = null; this.exploration = null; this.loads = []; }
    async load(node) { if (globalThis.__failLoad?.(node)) throw new Error('关卡搭不起来'); this.loads.push(node); }
    unload() {} }`,
  'assets/AssetLibrary.ts': 'export const AssetLibrary = { preload: async () => {} };',
  'fx/Fx.ts': 'export class FxSystem { clear() {} update() {} }',
  'audio/AudioSystem.ts': 'export class AudioSystem { play() {} setMusic() {} applyVolumes() {} unlock() {} update() {} }',
  'ui/UI.ts': `export class UIManager {
    constructor() { this.toasts = []; this.summaries = []; this.pauseShown = false; this.menus = 0; }
    fade() { return Promise.resolve(); } toast(t) { this.toasts.push(t); } banner() {} showHUD() {} showPause(v) { this.pauseShown = v; }
    showMainMenu() { this.menus++; } showSummary(s) { this.summaries.push(s); } setBoss() {} setInteractPrompt() {} update() {} }`,
  'render/PostStack.ts': 'export class PostStack { constructor() { this.gameplay = { amount: 1 }; } render() { return true; } }',
  'dev/PerformanceMeter.ts': 'export class PerformanceMeter {}',
  'combat/Combat.ts': 'export class Combat { clear() {} }',
  'combat/Projectiles.ts': 'export class ProjectileSystem { clear() {} }',
  'enemies/EnemyManager.ts': 'export class EnemyManager { clear() {} aliveCount() { return 0; } }',
  'enemies.ts': 'export function registerStandardEnemies() {}',
  'enemies/bosses.ts': 'export function registerBosses() {}',
  'progression/Interaction.ts': 'export class InteractionSystem { clear() {} }',
  'progression/BalanceModel.ts': 'export {};',
  'progression/BalanceBosses.ts': 'export {};',
  'player/Heroes.ts': `const hero = (id, name) => ({ id, name, title: '', startingWeapon: 'smg', passive: { apply: () => () => {} } });
    export const HEROES = [hero('fox', '狐'), hero('falcon', '隼'), hero('bear', '熊')];`,
  // 玩家：上限 / 当前值的结算照 PlayerController.resetForRun / syncStatCaps（属性表版本变了、上限涨了，当前值跟着涨）
  'player/PlayerController.ts': `export class PlayerController {
    constructor(ctx) { this.ctx = ctx; this.bonusHp = 0; this.version = 0; this.seen = 0; this.capHp = 100; this.hp = 100; this.shield = 50; this._alive = true; this.hero = null; }
    get alive() { return this._alive; }
    maxHp() { return 100 + this.bonusHp; } maxShield() { return 50; }
    resetForRun(hero) { this.hero = hero; this.bonusHp = 0; this.version++; this.seen = this.version; this.capHp = this.maxHp(); this.hp = this.capHp; this.shield = 50; this._alive = true; }
    syncStatCaps() { if (this.version === this.seen) return; this.seen = this.version; const mh = this.maxHp();
      if (mh > this.capHp && this._alive) this.hp += mh - this.capHp; this.hp = Math.min(this.hp, mh); this.capHp = mh; }
    update() { this.syncStatCaps(); }
    die() { this.hp = 0; this._alive = false; this.ctx.events.emit('player:died', {}); }
    teleport() {} }`,
  'weapons/WeaponSystem.ts': `export class WeaponSystem {
    constructor(ctx) { this.ctx = ctx; this.slots = [null, null]; this.activeSlot = 0; this.uid = 0; }
    get active() { return this.slots[this.activeSlot]; }
    roll({ defId, rarity = 0 }) { return { uid: ++this.uid, defId, rarity, level: 0, element: 'none', mag: 30, reserve: 90, affixes: [] }; }
    resetForRun(id) { this.slots = [this.roll({ defId: id }), null]; this.activeSlot = 0; }
    magCapacity() { return 30; } reserveCapacity() { return 180; }
    addAmmoFraction(f) { for (const w of this.slots) if (w) w.reserve = Math.min(180, w.reserve + Math.round(180 * f)); }
    setViewmodelVisible() {} clear() {} describe(w) { return { name: w.defId }; } applyHeldMods() {} }`,
  // 掉落：同 progression/Loot.ts「每进入新的一关补给一部分备弹」
  'progression/Loot.ts': `export class LootSystem { constructor(ctx) { this.ctx = ctx; }
    init() { this.ctx.events.on('stage:loaded', () => this.ctx.weapons.addAmmoFraction(0.35)); } clear() {} }`,
  // 秘卷：聚宝盆照 defsUtility.ts（每进新关：本金每层 12 × 章系数 + 持有灵石每层 5% 利息）；vitality = 生命上限 +50
  'progression/Scrolls.ts': `export class ScrollSystem {
    constructor(ctx) { this.ctx = ctx; this.stacks = new Map(); }
    init() { this.ctx.events.on('stage:loaded', ({ stage }) => {
      const n = this.stacks.get('treasure_bowl') ?? 0;
      if (n <= 0 || !this.ctx.player.alive) return;
      const k = 1 + 0.35 * stage.chapter;
      this.ctx.run.coins += Math.round(12 * n * k) + Math.min(Math.round(30 * n * k), Math.floor(Math.max(0, this.ctx.run.coins) * 0.05 * n));
    }); }
    resetForRun() { this.stacks.clear(); }
    add(id) { this.stacks.set(id, (this.stacks.get(id) ?? 0) + 1); if (id === 'vitality') { this.ctx.player.bonusHp += 50; this.ctx.player.version++; } this.ctx.ui.toast('获得秘卷 ' + id); return true; }
    owned() { return [...this.stacks].map(([id, stacks]) => ({ def: { id, name: id, rarity: 0 }, stacks })); } }`,
};

globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
globalThis.document = {
  getElementById: () => ({ classList: { add() {} }, addEventListener() {}, style: {} }),
  addEventListener() {}, hidden: false, body: { appendChild() {} }, createElement: () => ({ style: {} }),
};
globalThis.location = { search: '', pathname: '/' };
globalThis.__manifest = async () => null;

const graph = await tsGraph(STUBS);
after(() => graph.dispose());
const { Game } = await graph.load('core/Game.ts');
const { SaveService } = await graph.load('core/SaveService.ts');
const { MetaSection, CareerSection, BANKED_FLAG } = await graph.load('progression/Meta.ts');
const Suspend = await graph.load('progression/RunSuspend.ts');
const RunPlan = await graph.load('progression/RunPlan.ts');
const StagePlan = await graph.load('progression/StagePlan.ts');
const { RunRoute } = await graph.load('progression/RunRoute.ts');

SaveService.quiet = true;
SaveService.deferWrites = false;
const RUN = 'spiritfire.save/run.json';

function mem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k) };
}

/**
 * 一份干净的存储 + 一个新的 Game（主菜单上）。before：建 Game 之前在这份存储上做的事（写旧档…）；
 * manifest：场景清单怎么读（缺省读不到 = 按 UnityStages.ts，备选图不算建好）
 */
function fresh({ before = null, manifest = async () => null, sceneReady = s => !s.alt } = {}) {
  const store = mem();
  SaveService.forceDev = false;
  SaveService.useRoot(null);
  SaveService.useStorage(store);
  Suspend.RunSuspend.reset();
  Suspend.takeProblem();
  RunPlan.setCurrentRun(null);
  StagePlan.setStageCatalog(null);
  StagePlan.setSceneReady(sceneReady);
  globalThis.__failLoad = null;
  before?.();
  globalThis.__manifest = manifest;
  const game = new Game();
  game.toMenu();
  return { store, game, ctx: game.ctx };
}

/** 等 Game 的异步流程（黑幕回调、读清单、搭场景）走完 */
async function until(pred, what) {
  for (let i = 0; i < 400 && !pred(); i++) await new Promise(r => setImmediate(r));
  assert.ok(pred(), `等不到：${what}`);
}

const disk = store => (store.m.has(RUN) ? JSON.parse(store.m.get(RUN)) : null);
const career = () => SaveService.main.section(CareerSection);
const essence = () => SaveService.main.section(MetaSection).essence;

async function startRun(game, hero = 'fox') {
  game.startRun(hero);
  await until(() => game.state === 'playing', '开局进关');
}

async function advance(game) {
  const ctx = game.ctx;
  const loads = ctx.stage.loads.length;
  game.advance(ctx.runPlan.nextOptions(ctx.run)[0]);
  await until(() => game.state === 'playing' && ctx.stage.loads.length > loads, '换关');
}

async function resume(game) {
  assert.equal(game.continueRun(), true, '继续征程');
  await until(() => game.state === 'playing', '继续征程进关');
}

// ───────────── 阵亡（Unity GameSession.OnDied：当场结算）─────────────

test('阵亡当场结算（Unity OnDied → Bank(false)）：慢动作里已经删了续玩档、不能暂离也打不开暂停，暂停「返回主菜单」→「继续征程」免死的路堵死', async () => {
  const unity = cs('Core/GameSession.cs');
  const onDied = unity.slice(unity.indexOf('void OnDied()'), unity.indexOf('static RunSummary Bank('));
  assert.ok(onDied.indexOf('TimeScaleArbiter.Request(this, 0.3f, TimeScaleArbiter.Priority.DeathSlowMo)') < onDied.indexOf('Bank(false)'), 'Unity：先慢动作，紧接着结算');
  assert.match(unity, /if \(complete \|\| \(player && player\.Dead\)\)\s*\{[\s\S]*?if \(GameInput\.Pressed\(GameAction\.Reload\)\) Restart\(\);\s*return;\s*\}[\s\S]*?GameInput\.Pressed\(GameAction\.Pause\)/,
    'Unity：玩家死了 Update 提前返回，不看暂停键');
  const suspend = cs('Core/RunSuspend.cs');
  assert.match(suspend, /public static bool CanSuspend\(RunState run\)\s*\{\s*if \(run == null \|\| !ShouldWrite\(run\)\) return false;/, 'Unity：结算过的局（ShouldWrite 为假）不能暂离');

  const { store, game, ctx } = fresh();
  await startRun(game);
  ctx.run.essence = 40;
  assert.ok(disk(store), '进关写了续玩档');
  assert.equal(game.canSuspend(), true);

  ctx.player.die();
  assert.equal(game.state, 'playing', '慢动作期间还是 playing');
  assert.equal(ctx.time.timeScale, 0.3, '阵亡慢动作 ×0.3');
  assert.equal(ctx.run.flags[BANKED_FLAG], 1, '阵亡那一刻就结算');
  assert.equal(disk(store), null, '续玩档跟着删掉');
  assert.equal(essence(), 40, '魂晶入账');
  assert.equal(career().runs, 1);
  assert.equal(game.canSuspend(), false, '结算过的局不能暂离');
  game.pause();
  assert.equal(game.state, 'playing', '阵亡慢动作里暂停不响应');
  assert.equal(ctx.ui.pauseShown, false);

  // 就算绕到「返回主菜单」：只是回主菜单（局已结算，不会再结一次），没有可以继续的征程
  assert.equal(game.suspendRun(), false);
  assert.equal(game.state, 'menu');
  assert.deepEqual([career().runs, essence()], [1, 40], '没有重复结算');
  assert.equal(game.continueRun(), false);
  assert.equal(ctx.ui.toasts.at(-1), '没有可以继续的征程');
});

test('阵亡慢动作走完照常出结算界面：用的是阵亡时结算的那一份，不再结一次', async () => {
  const { game, ctx } = fresh();
  await startRun(game);
  ctx.run.essence = 25;
  ctx.run.kills = 7;
  ctx.player.die();
  ctx.run.kills = 99; // 慢动作里的变化不进结算
  ctx.tasks.update(0.6);
  assert.equal(game.state, 'summary');
  assert.equal(ctx.ui.summaries.length, 1);
  const s = ctx.ui.summaries[0];
  assert.deepEqual([s.victory, s.essenceEarned, s.kills], [false, 25, 7]);
  assert.deepEqual([career().runs, career().deaths, essence()], [1, 1, 25]);
  assert.equal(ctx.time.timeScale, 1, '结算界面上时间回到 1');
});

// ───────────── 进关快照（Unity SceneFlow.Arrive：entry = CloneRun(run) 在 StageLoaded 之前）─────────────

test('进关快照拍在 stage:loaded 之前：聚宝盆入账、每关补的备弹不进续玩档；「暂离 → 继续征程」反复做灵石和弹药都不涨', async () => {
  const flow = cs('Core/SceneFlow.cs');
  const arrive = flow.slice(flow.indexOf('RunPersistence.RestoreAll(run);'));
  assert.ok(arrive.indexOf('entry = CloneRun(run);') < arrive.indexOf('GameSession.Instance?.BeginStage('), 'Unity：先记进关快照，再 BeginStage → Announce');
  const session = cs('Core/GameSession.cs');
  const announce = session.slice(session.indexOf('void Announce(bool chapterCard)'));
  assert.match(announce.slice(0, announce.indexOf('\n        }')), /GameEvents\.RaiseStageLoaded\(Stage\)/, 'Unity：StageLoaded 在 Announce 里发');

  const { store, game, ctx } = fresh();
  await startRun(game);
  ctx.run.coins = 100;
  ctx.scrolls.add('treasure_bowl');
  ctx.weapons.slots[0].reserve = 20;
  await advance(game);
  const bowl = 12 + 5; // 第一章：本金 12 + 利息 100 × 5%
  assert.equal(ctx.run.coins, 100 + bowl, '进关时聚宝盆入账一次');
  assert.equal(ctx.weapons.slots[0].reserve, 20 + 63, '进关时补 35% 备弹一次');
  const saved = disk(store);
  assert.equal(saved.stage, '1-2');
  assert.equal(saved.run.coins, 100, '续玩档是进关发放之前的');
  assert.equal(saved.run.weapons[0].reserve, 20);
  assert.deepEqual(saved.run.scrolls, { treasure_bowl: 1 });

  for (let i = 0; i < 4; i++) {
    assert.equal(game.suspendRun(), true, '暂离');
    assert.equal(game.state, 'menu');
    await resume(game);
    assert.equal(ctx.run.coins, 100 + bowl, `第 ${i + 1} 次继续：聚宝盆只发一次`);
    assert.equal(ctx.weapons.slots[0].reserve, 20 + 63, `第 ${i + 1} 次继续：备弹只补一次`);
    assert.equal(disk(store).run.coins, 100, '重写的续玩档还是进关发放之前的');
    assert.equal(disk(store).run.weapons[0].reserve, 20);
  }
  assert.deepEqual([career().runs, essence()], [0, 0], '暂离不结算');
});

test('继续征程的生命护盾照档：秘卷加的上限先结算掉，第一帧不会把档里的血补满', async () => {
  // 假玩家照的是真 PlayerController 的这段（Game 读档时调它；改名了这里会红）
  const player = readFileSync(new URL('../src/player/PlayerController.ts', import.meta.url), 'utf8');
  assert.match(player, /private syncStatCaps\(\): void \{\s*if \(this\.stats\.version === this\.statsVersion\) return;/);
  assert.match(player, /if \(mh > this\.capHp && this\._alive\) this\.hp \+= mh - this\.capHp;/);
  assert.match(player, /update\(dt: number\): void \{\s*this\.syncStatCaps\(\);/, '第一帧就结算上限');
  const { store, game, ctx } = fresh();
  await startRun(game);
  ctx.scrolls.add('vitality');
  ctx.player.update();
  assert.equal(ctx.player.maxHp(), 150);
  ctx.player.hp = 60;
  ctx.player.shield = 12;
  await advance(game);
  assert.deepEqual([disk(store).run.hp, disk(store).run.shield], [60, 12]);
  game.suspendRun();
  await resume(game);
  ctx.player.update(); // 第一帧
  assert.deepEqual([ctx.player.hp, ctx.player.shield, ctx.player.maxHp()], [60, 12, 150]);
  assert.deepEqual([disk(store).run.hp, disk(store).run.shield], [60, 12]);
});

// ───────────── 换关失败、开新局放弃旧局 ─────────────

test('换关时下一关搭不起来：回主菜单不结算，上一关的续玩档留着，还能从上一关继续', async () => {
  const { store, game, ctx } = fresh();
  await startRun(game);
  ctx.run.essence = 30;
  const before = disk(store);
  globalThis.__failLoad = () => true;
  game.advance(ctx.runPlan.nextOptions(ctx.run)[0]);
  await until(() => game.state === 'menu', '载入失败回主菜单');
  globalThis.__failLoad = null;
  assert.deepEqual([career().runs, essence()], [0, 0], '没有按失败结算');
  assert.deepEqual(disk(store), before, '续玩档还是上一关的');
  assert.equal(game.suspendedRun().stageLabel, StagePlan.canonical('1-1').label);
  await resume(game);
  assert.equal(RunPlan.stageCodeOf(ctx.run), '1-1');
});

test('开新局放弃旧征程要等场景清单：清单没到时不校验（备选图会被当成坏档挪走），到了才按败北结算、魂晶入账', async () => {
  const catalog = [...StagePlan.STAGES.map(s => ({ id: s.code, available: true })), ...StagePlan.POOL.map(s => ({ id: s.code, available: true, pool: true }))];
  let release = null;
  const { store, game } = fresh({
    sceneReady: null,
    // 旧征程：路线上有备选图（清单读到时才算建好）；写完档「刷新页面」，清单还没读到
    before: () => {
      StagePlan.setStageCatalog(catalog);
      let seed = 1;
      while (!RunRoute.build(seed).playable.some(s => s.map.alt)) seed++;
      const old = {
        heroId: 'bear', seed, chapter: 0, stageIndex: 0, stage: RunPlan.toNode(StagePlan.STAGES[0]),
        coins: 50, kills: 3, damageDealt: 10, time: 60, stagesCleared: 0, essence: 77, difficulty: 1, flags: {},
      };
      RunPlan.beginRun(old, null, RunRoute.build(seed));
      assert.equal(Suspend.write(old, false), true);
      StagePlan.setStageCatalog(null);
    },
    manifest: () => new Promise(r => { release = r; }),
  });
  assert.equal(StagePlan.hasStageCatalog(), false);
  game.startRun('fox');
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(game.state, 'transition', '等清单');
  assert.equal(disk(store)?.run.heroId, 'bear', '清单没到：旧征程原样留着');
  assert.ok(!store.m.has(RUN + '.corrupt'), '没有被当成坏档挪走');
  assert.equal(career().runs, 0);
  release(catalog);
  await until(() => game.state === 'playing', '清单到了开局');
  assert.equal(essence(), 77, '旧征程按败北结算，魂晶入账');
  assert.deepEqual([career().runs, career().deaths], [1, 1]);
  assert.ok(!store.m.has(RUN + '.corrupt'));
  assert.equal(Suspend.takeProblem(), null, '没有「存档已损坏」的提示');
  assert.equal(disk(store).run.heroId, 'fox', '续玩档换成新局的');
});
