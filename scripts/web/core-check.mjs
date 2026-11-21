// M11d 核心实机检查（docs/threejs-migration.md 4.7）：无头 Chromium 开正式主菜单（不是调试局），逐帧推进游戏（Game.frame，固定步长），
// 走一遍：老存档导入（含音量换算）→ 开局写续玩档 → 画质档的渲染比例 / 距离剔除 → 顿帧 / 模态 / 暂停停时间 → 设置页由设置表生成 →
// 进下一关重写续玩档（进关快照不含聚宝盆入账 / 每关补弹）→ 暂停「返回主菜单」暂离不结算 → 主菜单「继续征程」读回（反复暂离灵石不涨、生命照档）
// → 有续玩档时出征先弹确认框 → 阵亡当场结算并删档、慢动作里不能暂停 / 暂离。每一步打 ✔ / ✖，最后有 ✖ 就退出码 1。
//   node scripts/web/core-check.mjs [端口=5713] [截图目录=docs/art/review/threejs-migration]
// 需要开发服务器（npx vite --port <端口>）；钩子 window.__game / __ctx 在网址带 ?debug 时存在（core/Game.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5713';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(ok ? '✔' : '✖', name, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

const OLD_META = { version: 1, essence: 345, talents: { vitality: 3 }, unlockedHeroes: ['fox', 'falcon', 'bear'], stats: { runs: 7, wins: 2, bestChapter: 2, bestStages: 6, totalKills: 400 } };
// M11e 之前的设置（没有环境音 / 界面音两项 = 旧音量语义）：旧主 0.4 / 音效 0.45 / 音乐 0.25 = 新推子 0.5 / 0.5 / 0.5
const OLD_SETTINGS = { sensitivity: 1.3, fov: 90, masterVolume: 0.4, sfxVolume: 0.45, musicVolume: 0.25, quality: 'medium', shadowQuality: 'medium', damageNumbers: true, screenShake: 0.5, invertY: false };

const b = await launch({ width: 1600, height: 900 });
const STEP = `(() => {
  const g = window.__game;
  window.__step = (seconds, dt = 1 / 60) => {
    let t = window.__simT ?? performance.now();
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
    window.__simT = t;
  };
  return true;
})()`;
const step = (s) => b.eval(`window.__step(${s})`);
const ev = (expr) => b.eval(expr);
const shot = async (name) => b.shot(`${out}/core-${name}.jpg`, 86);
/** 推进到 state === playing 且关卡搭好 */
async function untilPlaying(extra = 'true') {
  for (let k = 0; k < 400; k++) {
    await step(0.1);
    if (await ev(`window.__game.state === 'playing' && !!window.__ctx.stage.arena && (${extra})`)) return true;
    await wait(200);
  }
  return false;
}
const runFile = () => ev(`(() => { const t = localStorage.getItem('spiritfire.save/run.json'); return t ? JSON.parse(t) : null; })()`);
const profile = () => ev(`(() => { const t = localStorage.getItem('spiritfire.save/profile.json'); return t ? JSON.parse(t).sections : null; })()`);

try {
  // ───────────── 老存档 ─────────────
  await b.goto(`${base}/assets/unity-gameplay/defs.json`);
  await ev(`localStorage.clear(), localStorage.setItem('gunflame.meta.v1', ${JSON.stringify(JSON.stringify(OLD_META))}),
    localStorage.setItem('gunflame.settings.v1', ${JSON.stringify(JSON.stringify(OLD_SETTINGS))}), true`);
  await b.goto(`${base}/?debug`);
  await b.waitFor('window.__game && window.__ctx', 120000);
  for (let k = 0; k < 600 && !b.logs.some((l) => l.includes('[assets] 已加载')); k++) await wait(250);
  await ev(STEP);
  await step(0.3);
  const s = await ev(`(() => { const s = window.__ctx.settings; return [s.masterVolume, s.sfxVolume, s.musicVolume, s.ambienceVolume, s.quality, s.fov, s.sensitivity, s.frameCap, s.screenEffects]; })()`);
  check('老设置导入：音量按旧缺省换算成新推子（0.4 / 0.45 / 0.25 → 0.5 / 0.5 / 0.5），其余原样，新项取默认', JSON.stringify(s) === JSON.stringify([0.5, 0.5, 0.5, 1, 'medium', 90, 1.3, 7, 1]), s);
  const m = await ev(`[window.__ctx.meta.save.essence, window.__ctx.meta.save.stats.runs, window.__ctx.meta.talentLevel('vitality')]`);
  check('老元进度导入：魂晶 345、7 局、生命强化 3 级', JSON.stringify(m) === '[345,7,3]', m);
  await wait(1200);
  await step(0.05);
  const keys = await ev(`[localStorage.getItem('gunflame.settings.v1') === ${JSON.stringify(JSON.stringify(OLD_SETTINGS))}, !!localStorage.getItem('spiritfire.save/settings.json'), localStorage.getItem('gunflame.meta.v1') === ${JSON.stringify(JSON.stringify(OLD_META))}]`);
  check('导入后写进 spiritfire.save/settings.json，老键不删不改', keys.every(Boolean), keys);
  const pr = await ev(`window.__ctx.renderer.getPixelRatio()`);
  check('中画质的渲染比例 0.85（设备像素比 1）', Math.abs(pr - 0.85) < 1e-6, String(pr));
  const cont0 = await ev(`(() => { const b = document.querySelector('[data-name="nav-继续征程"]'); return b ? b.style.display : 'missing'; })()`);
  check('没有续玩档时主菜单不显示「继续征程」', cont0 === 'none', cont0);

  // ───────────── 开局：续玩档、剔除 ─────────────
  await ev(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  check('开局进到 1-1', await untilPlaying(), await ev(`window.__game.state`));
  await step(0.5);
  let rf = await runFile();
  check('进关写续玩档 run.json（正式档、1-1、英雄、天赋快照）', rf && rf.stage === '1-1' && rf.hero === (await ev('window.__ctx.run.heroId')) && rf.run.talents?.vitality === 3 && rf.run.dev === false,
    rf ? { stage: rf.stage, hero: rf.hero, talents: rf.run.talents, dev: rf.run.dev } : null);
  check('能暂离（盘上有这一关的续玩档）', await ev('window.__game.canSuspend()'));
  const cull = await ev(`(() => { const c = window.__game.culler; return { count: c.count, detail: c.detailCount, scatter: c.scatterCount, culled: c.culledCount }; })()`);
  check('Unity 场景的小件 / 散布件分了层', cull.count > 0 && cull.detail > 0, cull);
  const culledAt = async (q) => {
    await ev(`window.__ctx.settings.quality = '${q}', window.__game.applySettings(), true`);
    await step(0.05);
    return ev(`[window.__game.culler.culledCount, window.__ctx.renderer.getPixelRatio()]`);
  };
  const [lo, hi, med] = [await culledAt('low'), await culledAt('high'), await culledAt('medium')];
  check('画质低 / 高 / 中：渲染比例 0.7 / 1 / 0.85，低档剔得最多', Math.abs(lo[1] - 0.7) < 1e-6 && Math.abs(hi[1] - 1) < 1e-6 && Math.abs(med[1] - 0.85) < 1e-6 && lo[0] >= med[0] && med[0] >= hi[0],
    { low: lo, high: hi, medium: med });
  await shot('play-1-1');

  // ───────────── 时间：顿帧、模态、暂停 ─────────────
  const hs = await ev(`(async () => {
    const c = window.__ctx, p = c.player, V = p.position.constructor;
    p.invulnerableTime = 9999;
    const f = p.getForward(new V());
    const at = p.position.clone().addScaledVector(f, 6);
    const e = c.enemies.spawn('grunt', { position: at, level: 1 });
    if (!e) return 'spawn failed';
    window.__step(1.2);
    await new Promise(r => setTimeout(r, 200));
    c.combat.damageEnemy(e, { base: 999999, element: 'none', source: 'weapon', canCrit: false, point: e.getBodyCenter(p.position.clone()) });
    const during = [c.time.timeScale, window.__game.timeArbiter.activePriority, e.alive];
    await new Promise(r => setTimeout(r, 120));
    window.__step(0.02);
    return [during, [c.time.timeScale, window.__game.timeArbiter.activePriority]];
  })()`);
  check('顿帧：击杀普通怪 ×0.05（顿帧优先级 100），真实 0.035 s 后回到 1', Array.isArray(hs) && hs[0][0] === 0.05 && hs[0][1] === 100 && hs[1][0] === 1, hs);
  const modal = await ev(`(() => { const g = window.__game, c = window.__ctx; g.openModal(); const a = [g.state, c.time.timeScale, g.timeArbiter.activePriority, g.fsm.depth];
    g.closeModal(); return [a, [g.state, c.time.timeScale, g.fsm.depth]]; })()`);
  check('模态栈：打开模态停住时间（优先级 400），关掉回到 1', JSON.stringify(modal) === JSON.stringify([['modal', 0, 400, 1], ['playing', 1, 0]]), modal);
  await ev(`window.__game.pause(), true`);
  await step(0.05);
  await wait(500);
  await step(0.02);
  const paused = await ev(`[window.__game.state, window.__ctx.time.timeScale, window.__game.timeArbiter.activePriority]`);
  check('暂停：时间停住（优先级 500）', JSON.stringify(paused) === JSON.stringify(['paused', 0, 500]), paused);
  const hint = await ev(`document.body.innerText.includes('本局保留，下次从本关开头「继续征程」')`);
  check('暂停菜单提示「返回主菜单」是暂离', hint);
  await shot('pause');
  await ev(`window.__ctx.ui.root.router.open('settings'), window.__ctx.ui.root.router.top.select('画面'), true`);
  await step(0.05);
  await wait(400);
  await step(0.02);
  const video = await ev(`['帧率上限', '屏幕特效', '震屏强度', '阴影精度'].map(t => document.body.innerText.includes(t))`);
  check('设置页「画面」由设置表生成（含补进来的帧率上限、屏幕特效）', video.every(Boolean), video);
  await shot('settings-video');
  await ev(`window.__ctx.ui.root.router.close('settings'), window.__ctx.ui.showPause(false), window.__game.resume(), true`);
  await step(0.1);
  check('继续游戏：时间回到 1', await ev(`window.__game.state === 'playing' && window.__ctx.time.timeScale === 1`));

  // ───────────── 进下一关：续玩档重写（秘卷、灵石、武器）─────────────
  const scrollId = 'iron_bones';
  await ev(`(() => { const c = window.__ctx; c.scrolls.add('iron_bones'); c.scrolls.add('iron_bones'); c.scrolls.add('treasure_bowl'); c.run.coins += 321; return true; })()`);
  await step(0.05);
  await ev(`(() => { const c = window.__ctx, w = c.weapons.slots[c.weapons.activeSlot]; c.player.hp = 57; w.reserve = 3; return true; })()`);
  const before = await ev(`({ code: window.__ctx.run.stage.map ?? null, coins: window.__ctx.run.coins, reserve: window.__ctx.weapons.slots[window.__ctx.weapons.activeSlot]?.reserve,
    weapon: window.__ctx.weapons.slots[window.__ctx.weapons.activeSlot]?.defId, maxHp: window.__ctx.player.maxHp() })`);
  await ev(`(() => { const c = window.__ctx; window.__game.advance(c.runPlan.nextOptions(c.run)[0]); return true; })()`);
  const advanced = await untilPlaying(`(window.__ctx.run.stage.map ?? '') !== ${JSON.stringify(before.code ?? '')}`);
  rf = await runFile();
  check('进下一关重写续玩档（关卡、秘卷 2 层、灵石）', advanced && rf && rf.stage !== '1-1' && rf.run.scrolls?.[scrollId] === 2 && rf.run.coins >= 321,
    rf ? { stage: rf.stage, scrolls: rf.run.scrolls, coins: rf.run.coins, weapons: rf.run.weapons?.map(w => w.id) } : null);
  const savedStage = rf?.stage;
  const arrived = await ev(`({ coins: window.__ctx.run.coins, reserve: window.__ctx.weapons.slots[window.__ctx.weapons.activeSlot]?.reserve, hp: window.__ctx.player.hp })`);
  const activeSave = rf?.run.weapons?.find(w => w.active);
  check('进关快照拍在 stage:loaded 之前：续玩档是聚宝盆入账 / 每关补弹之前的（Unity SceneFlow.Arrive）',
    rf && rf.run.coins === before.coins && arrived.coins > before.coins && activeSave?.reserve === before.reserve && arrived.reserve > before.reserve && rf.run.hp === 57,
    { before, arrived, saved: rf ? { coins: rf.run.coins, reserve: activeSave?.reserve, hp: rf.run.hp } : null });
  const views = await ev(`[window.__ctx.scene.children.filter(c => c.name.startsWith('unity-scene-')).map(c => c.name), window.__game.culler.count]`);
  check('换关：剔除名单换成新场景的（场上只有一个 Unity 场景根节点）', views[0].length === 1 && views[1] > 0, views);

  // ───────────── 暂离 → 继续征程 ─────────────
  const prof0 = await profile();
  await ev(`window.__game.pause(), true`);
  const suspended = await ev(`window.__game.suspendRun()`);
  await step(0.5);
  await wait(800);
  await step(0.1);
  const prof1 = await profile();
  check('暂停「返回主菜单」= 暂离：回主菜单、不结算、续玩档留着', suspended === true && (await ev('window.__game.state')) === 'menu' && !!(await runFile())
    && JSON.stringify(prof0) === JSON.stringify(prof1), { suspended, essence: prof1?.meta?.data?.essence ?? null });
  await wait(700);
  await step(0.05);
  const cont = await ev(`(() => { const b = document.querySelector('[data-name="nav-继续征程"]'); return b ? [b.style.display, b.textContent] : null; })()`);
  check('主菜单显示「继续征程」（关卡 · 英雄 · 用时 · 灵石）', cont && cont[0] !== 'none' && cont[1].includes(savedStage), cont);
  await shot('menu-continue');
  // 有未完成的征程时出征：先弹确认框（Unity MenuFlow.StartRun），取消就什么都不动
  const ask = await ev(`(() => { const r = window.__ctx.ui.root.router; r.open('hero-select'); r.top.confirm(); const t = r.top; return [t.id, t.request?.message ?? null]; })()`);
  await step(0.3);
  await wait(400);
  await step(0.05);
  await shot('menu-forfeit-confirm');
  const runBeforeCancel = JSON.stringify(await runFile());
  await ev(`(() => { const r = window.__ctx.ui.root.router; r.top.cancel(); r.close('hero-select'); return true; })()`);
  await step(0.1);
  check('有续玩档时出征先弹确认框（第 N 关、放弃按败北结算），取消后续玩档原样', ask[0] === 'confirm' && ask[1]?.includes(`第 ${savedStage} 关`) && (await ev('window.__game.state')) === 'menu'
    && JSON.stringify(await runFile()) === runBeforeCancel, ask);
  check('继续征程', await ev('window.__game.continueRun()'));
  const resumed = await untilPlaying();
  const back = await ev(`(() => { const c = window.__ctx; return { stage: c.run.stage.map ?? null, coins: c.run.coins, scroll: c.scrolls.owned().find(o => o.def.id === ${JSON.stringify(scrollId)})?.stacks ?? 0,
    weapon: c.weapons.slots[0]?.defId, talents: c.run.talents, state: window.__game.state,
    scene: c.scene.children.filter(o => o.name.startsWith('unity-scene-')).map(o => o.name)[0] ?? null }; })()`);
  check('读回的局：同一关（同一张图）、灵石（档里的 + 进关时聚宝盆一次）、秘卷层数、手上的枪、天赋快照', resumed && back.scene === views[0][0] && back.coins === arrived.coins && back.scroll === 2 && back.weapon === rf.run.weapons.find(w => w.active)?.id && back.talents?.vitality === 3, back);
  check('继续之后还能再暂离', await ev('window.__game.canSuspend()'));
  await step(0.5);
  const again = await ev(`({ coins: window.__ctx.run.coins, hp: window.__ctx.player.hp, maxHp: window.__ctx.player.maxHp() })`);
  check('继续征程：聚宝盆只发一次（灵石同暂离前）、生命照档（第一帧不补上秘卷加的上限）', again.coins === arrived.coins && again.hp === 57 && again.maxHp === before.maxHp, again);
  // 再暂离 → 继续一次：灵石、续玩档都不涨（Unity 顺序之前这里每轮都会多一份聚宝盆）
  await ev(`window.__game.suspendRun(), true`);
  await step(0.3);
  check('第二次继续征程', await ev('window.__game.continueRun()'));
  await untilPlaying();
  const again2 = await ev(`window.__ctx.run.coins`);
  check('反复「暂离 → 继续征程」灵石不涨，续玩档也不涨', again2 === arrived.coins && (await runFile())?.run.coins === before.coins, { coins: again2, file: (await runFile())?.run.coins });

  // ───────────── 阵亡：当场结算并删档（Unity GameSession.OnDied）─────────────
  const essenceRun = await ev(`Math.round(window.__ctx.run.essence)`);
  const died = await ev(`(() => { const g = window.__game, c = window.__ctx, p = c.player; p.invulnerableTime = 0; p.takeDamage(1e9, 'none', null);
    const a = [p.alive, g.state, c.time.timeScale, g.canSuspend()]; g.pause(); return [...a, g.state]; })()`);
  const prof2 = await profile();
  check('阵亡当场结算：慢动作 ×0.3 时续玩档已删、魂晶入账、局数 +1，不能暂离也打不开暂停',
    JSON.stringify(died) === JSON.stringify([false, 'playing', 0.3, false, 'playing']) && (await runFile()) === null
    && prof2?.meta?.data?.essence === 345 + essenceRun && prof2?.career?.data?.runs === 8,
    { died, essence: prof2?.meta?.data?.essence, runs: prof2?.career?.data?.runs, essenceRun });
  await step(2.5);
  await wait(300);
  await step(0.05);
  const after = await profile();
  check('慢动作走完出结算界面，不再结一次', (await ev('window.__game.state')) === 'summary' && after?.career?.data?.runs === 8 && after?.meta?.data?.essence === prof2?.meta?.data?.essence,
    { state: await ev('window.__game.state'), runs: after?.career?.data?.runs });
  await shot('death-summary');

  const errors = b.logs.filter((l) => l.startsWith('[exception]') || (l.startsWith('[error]') && !l.includes('favicon')));
  check('控制台没有异常', errors.length === 0, errors.slice(0, 6).join('\n'));
} catch (err) {
  check('脚本跑完', false, String(err?.stack ?? err));
} finally {
  await b.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
