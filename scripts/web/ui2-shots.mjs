// 界面第二期实机截图（docs/threejs-migration.md M11c 验收）：无头 Chromium 按 1920×1080（界面缩放 = 1，像素 = USS 的设计像素）
// 逐个打开第二期的界面截图：主菜单、选英雄、天赋、图鉴、操作说明、改键页、确认框，局内的罗盘条、全图、行囊（行囊 / 灵宠页）、
// 灵宠面板、秘卷三选一、秘卷触发弹字、精英印章、狙击镜、关卡卡片、整局结算。每张都跑一遍 USS 核对（见 USS_CHECK），最后报合计与页面错误数（应为 0）。
//   node scripts/web/ui2-shots.mjs [端口=5714] [输出目录=docs/art/review/threejs-migration]
// 需要开发服务器（npx vite --port <端口>）；钩子 window.__game / __ctx 在网址带 ?debug 时存在（core/Game.ts）。?uishots 关掉「图鉴新收录」提示。
// 在 agent worktree 里跑：node_modules 是指向主检出的目录联接，vite 按真实路径拒绝（draco 解码器 403 → 美术资产全退回程序化模型、
// 图鉴缩略图拍不出来），要给 vite 一份把主检出 node_modules 加进 server.fs.allow 的配置（--config），主检出直接跑没有这个问题。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5714';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const W = 1920, H = 1080;
const log = (...a) => console.log('[ui2]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: W, height: H });
const STEP = `(() => {
  const g = window.__game;
  window.__step = (seconds, dt = 1 / 60) => {
    let t = window.__simT ?? performance.now();
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
    window.__simT = t;
  };
  window.__ui = window.__ctx.ui;
  window.__router = window.__ctx.ui.root.router;
  return true;
})()`;
const step = (s) => b.eval(`window.__step(${s})`);

/**
 * 每张截图都跑的 USS 核对（页面里算）：
 *   uss    转出来的 Unity 规则（css/unity/*.css，选择器带 sf- 的类规则，不含 sf-base 的基准）里写死的长度 / 颜色 / 排版值，逐个对比命中元素的计算样式。
 *          元素自己有内联样式的属性（= Unity 代码里 style.x = …）、同一属性被几条 Unity 规则同时写（按优先级挑赢家）都照算；
 *          宽高另列（flex 收缩 / 拉伸是排版结果，Yoga 一样会做），其余不一致就是有别的样式盖住了 USS。
 *   legacy 把选择器里带 gf- 的旧样式规则（base.css 的 .gf-ui 容器、主菜单远景）全部摘掉再算一遍，sf 元素的计算样式应该一点不变。
 */
const USS_CHECK = `(() => {
  const PROPS = ['font-size','letter-spacing','line-height','font-weight','font-style','color','background-color','opacity',
    'padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left',
    'border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-color','border-left-color',
    'border-top-left-radius','flex-direction','flex-grow','flex-wrap','align-items','justify-content','align-self','position','text-align'];
  const SIZE = ['width','height','min-width','min-height','max-width','max-height'];
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const all = [...document.querySelectorAll('.sf-root *')].filter(e => !(e instanceof SVGElement) && visible(e));
  const snap = () => all.map(e => { const s = getComputedStyle(e); return [...PROPS, ...SIZE].map(p => s.getPropertyValue(p)).join('|'); });
  // ── legacy：摘掉 gf- 规则前后比 ──
  const before = snap();
  const removed = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.selectorText && /gf-/.test(r.selectorText)) { removed.push([sheet, i, r.cssText]); sheet.deleteRule(i); }
    }
  }
  const after = snap();
  for (const [sheet, i, text] of removed.reverse()) sheet.insertRule(text, i);
  const legacy = [];
  before.forEach((v, k) => { if (v !== after[k] && legacy.length < 8) legacy.push((all[k].className || all[k].tagName) + ' ' + diff(v, after[k])); });
  function diff(a, b) { const x = a.split('|'), y = b.split('|'), n = [...PROPS, ...SIZE]; return n.map((p, i) => x[i] !== y[i] ? p + ':' + x[i] + '→' + y[i] : '').filter(Boolean).join(' '); }
  // ── uss：Unity 规则的写死值 ──
  const spec = (sel) => { const s = sel.replace(/::[\\w-]+/g, ''); return [(s.match(/#/g) || []).length, (s.match(/\\.|\\[|:(?!:)/g) || []).length, (s.match(/(^|[\\s>+~])[a-zA-Z]+/g) || []).length]; };
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const rules = [];
  let order = 0;
  for (const sheet of document.styleSheets) {
    let rs; try { rs = sheet.cssRules; } catch { continue; }
    for (const r of rs) {
      order++;
      if (!r.selectorText || !/\\.sf-/.test(r.selectorText) || /:where|^\\.sf-root\\b|^\\.ui-layer|^\\.sf-layer--modal|::/.test(r.selectorText)) continue;
      rules.push({ r, order });
    }
  }
  const win = new Map();
  for (const e of all) {
    const m = new Map();
    for (const { r, order } of rules) {
      const parts = r.selectorText.split(',').map(s => s.trim()).filter(s => { try { return e.matches(s); } catch { return false; } });
      if (!parts.length) continue;
      const sp = parts.map(spec).sort(cmp).at(-1);
      for (let i = 0; i < r.style.length; i++) {
        const p = r.style[i], v = r.style.getPropertyValue(p);
        const cur = m.get(p);
        if (!cur || cmp(sp, cur.sp) > 0 || (cmp(sp, cur.sp) === 0 && order > cur.order)) m.set(p, { v, sp, order, sel: r.selectorText });
      }
    }
    win.set(e, m);
  }
  let checked = 0, sizeChecked = 0;
  const bad = [], sizeBad = [];
  const norm = (v) => v.replace(/\\s+/g, ' ').trim();
  // 量具：同样是实线边框、绝对定位的空元素，用来把写法换成浏览器的计算值（颜色、关键字、无单位行高）
  // 每次整体重设（removeProperty 掉边框宽度会退回 medium = 3px，把后面量的宽高撑大）
  const probe = document.createElement('div');
  const PROBE = 'position:absolute;visibility:hidden;border:0 solid transparent;display:flex;box-sizing:border-box;';
  document.body.appendChild(probe);
  for (const [e, m] of win) {
    const cs = getComputedStyle(e);
    for (const [p, w] of m) {
      if (!PROPS.includes(p) && !SIZE.includes(p)) continue;
      // 简写里带 var() 时拆出来的长写是空串（等替换）：跳过
      if (!w.v || /var\\(|%|auto|calc|em$|initial|inherit/.test(w.v) || e.style.getPropertyValue(p)) continue;
      probe.style.cssText = PROBE + 'font-size:' + cs.fontSize;
      probe.style.setProperty(p, w.v);
      const want = norm(getComputedStyle(probe).getPropertyValue(p) || w.v);
      const got = norm(cs.getPropertyValue(p));
      const isSize = SIZE.includes(p);
      if (isSize) sizeChecked++; else checked++;
      if (got !== want && !(p === 'line-height' && got === 'normal')) (isSize ? sizeBad : bad).push((e.className || e.tagName) + ' ' + p + ' 应 ' + want + ' 实 ' + got + ' ← ' + w.sel);
    }
  }
  probe.remove();
  return { checked, mismatches: bad.length, bad: bad.slice(0, 10), sizeChecked, sizeMismatches: sizeBad.length, sizeBad: [...new Set(sizeBad)].slice(0, 60), legacyRules: removed.length, legacyChanged: legacy.length, legacy };
})()`;
const ussReport = [];
async function ussCheck(name) {
  const r = await b.eval(USS_CHECK);
  ussReport.push([name, r]);
  log('uss', name, `核对 ${r.checked} 项、不一致 ${r.mismatches}；宽高 ${r.sizeChecked} 项、不一致 ${r.sizeMismatches}；旧 gf- 规则 ${r.legacyRules} 条、影响 sf 元素 ${r.legacyChanged} 个`);
  for (const x of [...r.bad, ...r.legacy]) log('   ', x);
}
/** 界面动画用真实时间：推几帧游戏、再等真实时间让界面过渡走完 */
async function settle(ms = 700) {
  await step(0.05);
  await wait(ms);
  await step(0.03);
}
const shot = async (name) => {
  await b.shot(`${out}/ui2-${name}.jpg`, 88);
  log('shot', name);
  await ussCheck(name);
};
const ev = (code) => b.eval(`(() => { ${code}; return true; })()`);

try {
  await b.goto(`http://127.0.0.1:${port}/?debug&uishots&debugStage=1-1`);
  await b.waitFor('window.__game && window.__ctx', 120000);
  for (let k = 0; k < 600 && !b.logs.some((l) => l.includes('[assets] 已加载')); k++) await wait(250);
  await b.eval(STEP);
  // 存档：给点魂晶、几级天赋、生涯记录，图鉴收录一部分
  await ev(`const c = window.__ctx, m = c.meta; m.save.essence = 1680; m.save.stats = { runs: 12, wins: 2, bestChapter: 3, bestStages: 11, totalKills: 2486 };
    m.save.talents = { vitality: 3, mastery: 2, lethal: 1 };
    const u = window.__ui, cat = u.catalog;
    cat.of('weapon').slice(0, 7).forEach(e => u.codex.unlock('weapon', e.id));
    cat.of('scroll').filter((_, i) => i % 2 === 0).forEach(e => u.codex.unlock('scroll', e.id));
    cat.of('enemy').filter((_, i) => i % 3 !== 2).forEach(e => u.codex.unlock('enemy', e.id));
    c.game.toMenu()`);

  // ───────────── 主菜单与它上面的页 ─────────────
  await settle(2600);
  await shot('main-menu');
  log('menu', JSON.stringify(await b.eval(`[window.__router.ids, document.querySelector('.sf-menu__stats')?.textContent, window.__ui.catalog.total, ['weapon','scroll','enemy','pet'].map(k => window.__ui.catalog.of(k).length)]`)));

  await ev(`window.__router.open('hero-select')`);
  await settle(2500);
  await shot('hero-select');
  await ev(`window.__router.top.select(1, false)`);
  await settle(1800);
  await shot('hero-select-2');
  await ev(`window.__router.close('hero-select')`);

  await ev(`window.__router.open('talents')`);
  await settle(1000);
  await shot('talents');
  await ev(`window.__router.close('talents')`);

  await ev(`window.__router.open('codex', 'weapon')`);
  for (let k = 0; k < 40; k++) await step(0.05);
  await settle(800);
  await shot('codex-weapon');
  await ev(`window.__router.top.select('scroll')`);
  await settle(500);
  await shot('codex-scroll');
  await ev(`window.__router.top.select('enemy')`);
  for (let k = 0; k < 60; k++) await step(0.05);
  await settle(600);
  await shot('codex-enemy');
  log('codex', JSON.stringify(await b.eval(`[window.__router.top.pageCount, window.__router.top.pageThumbsReady, window.__ui.thumbs.count, window.__router.top.detailName, window.__ui.catalog.of('enemy').map(e => e.id + ':' + e.name + ':' + e.subtitle).join(' ')]`)));
  await ev(`const s = window.__router.top; s.goPage(s.pageCount - 1)`);
  for (let k = 0; k < 40; k++) await step(0.05);
  await settle(500);
  await shot('codex-enemy-last');
  await ev(`window.__router.top.select('pet')`);
  await settle(400);
  await shot('codex-pet-empty');
  await ev(`window.__router.close('codex')`);

  await ev(`window.__router.open('controls')`);
  await settle(700);
  await shot('controls');
  await ev(`window.__router.open('settings', '按键')`);
  await settle(700);
  await shot('settings-keys');
  await ev(`window.__router.top.rebind('reload')`);
  await settle(200);
  await shot('settings-keys-rebinding');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }))`);
  await settle(200);
  log('rebind', JSON.stringify(await b.eval(`[window.__ui.keys.code('reload'), window.__ctx.input.bindings.reload, localStorage.getItem('gunflame.keybinds.v1')]`)));
  await ev(`window.__ui.keys.reset(); window.__router.close('settings'); window.__router.close('controls')`);

  await ev(`window.__router.open('confirm', { title: '开始新征程', message: '开始新征程会放弃当前的征程（第 1-3 关），确定吗？', detail: '放弃的征程按败北结算：已收集的魂晶照常入账，此操作不能撤销。', confirmText: '放弃并出征', cancelText: '取消' })`);
  await settle(600);
  await shot('confirm');
  await ev(`window.__router.top.cancel()`);

  // ───────────── 进一局：HUD 部件与局内界面 ─────────────
  await ev(`window.__game.startRun(window.__ctx.heroes[0].id)`);
  for (let k = 0; k < 240; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await wait(250);
  }
  log('state', await b.eval('window.__game.state'), JSON.stringify(await b.eval('window.__router.ids')));
  await ev(`window.__ctx.player.invulnerableTime = 9999`);
  await step(1.5);
  await settle(3200);
  await shot('hud-compass');
  log('compass', JSON.stringify(await b.eval(`(() => { const m = window.__ui.map.markers; return [m.all.length, m.target && m.target.name, m.targetVerb, m.all.filter(x => x.discovered).length]; })()`)));

  // 精英印章：第一章名册的四只精英（四种词缀），在前方 11–19 m 左右错开摆，找一个四只都看得见的朝向
  log('foes', await b.eval(`(() => {
    const c = window.__ctx, p = c.player, V = p.position.constructor;
    const SLOTS = [[11, -5.5, 'jerboa_blade', 'swift'], [14, 1.5, 'tomb_beast', 'volatile'], [17, 7.5, 'scorpion_archer', 'shielded'], [19, -1, 'apsara', 'frenzied']];
    const at = (f, d, side) => { const q = p.position.clone().addScaledVector(f, d); q.x += -f.z * side; q.z += f.x * side; const y = c.world.groundHeight(q.x, q.z, q.y + 6, 0.3); if (Number.isFinite(y)) q.y = y; return q; };
    const clear = (f) => SLOTS.every(([d, s]) => { const q = at(f, d, s); q.y += 1.2; return Math.abs(q.y - 1.2 - p.position.y) < 2.5 && !c.world.segmentBlocked(p.eye, q); });
    for (let k = 0; k < 24 && !clear(p.getForward(new V())); k++) p.yaw += Math.PI / 12;
    window.__step(0.02);
    const f = p.getForward(new V());
    window.__foes = SLOTS.map(([d, s, id, affix]) => c.enemies.spawn(id, { position: at(f, d, s), elite: true, affix, level: 1 })).filter(Boolean);
    for (const e of window.__foes) e.stunTime = 999;
    return [window.__foes.map(e => e.def?.id ?? e.id), clear(f)];
  })()`));
  await step(2);
  await settle(500);
  log('seals', JSON.stringify(await b.eval(`[...document.querySelectorAll('.sf-ebar__seal')].filter(a => a.style.display !== 'none').map(a => [a.style.opacity, a.style.scale])`)));
  await shot('elite-seal');

  // 秘卷触发弹字 + 灵宠面板（灵宠本体是 M9：这里给一份演示数据走 PetSource 接口）
  await ev(`const c = window.__ctx; const ids = c.scrolls.all.slice(0, 40).filter((s, i) => i % 9 === 0).map(s => s.id);
    for (const id of ids.slice(0, 3)) window.__ui.scrollProc(id); window.__ui.scrollProc(ids[0]);
    const def = { id: 'demo_fox', name: '赤狐', title: '燎原之尾', rarityName: '灵品', rarityColor: 0x4aa3ff, role: '突击', element: 'fire', lore: '（界面演示数据）跟在身侧的小赤狐，尾尖一点不灭的火。',
      attackDesc: '扑咬最近的敌人，附带灼烧。', passiveName: '余烬', passiveDesc: '主人击杀灼烧中的敌人时回复少量护盾。', skillName: '燎原', skillDesc: '向前喷出一道火浪，点燃沿途敌人。', skillCooldown: 14, awakenDesc: '觉醒后火浪留下燃烧的地面。' };
    window.__pet = { def, level: 3, maxLevel: 10, awakenLevel: 5, awakened: false, xp: 46, xpNext: 120, skillLeft: 5.2, skillCooldown: 14, skillReady: false, busy: false, damageDealt: 1832, castStamp: 1 };
    window.__ui.setPetSource({ current: () => window.__pet, catalog: () => [def] })`);
  await step(0.1);
  await wait(250);
  await step(0.03);
  await shot('scroll-proc-pet');

  // 狙击镜：把视角层压到 −45°（鹰隼狙击开镜的量）
  await ev(`window.__scopeHold = setInterval(() => { window.__ctx.cameraFx.fovKick = -45; }, 4)`);
  for (let k = 0; k < 10; k++) {
    await ev(`window.__ctx.cameraFx.fovKick = -45; window.__ctx.ui.hud.tick(1 / 60, 1 / 60, performance.now() / 1000, true, false)`);
    await wait(30);
  }
  await shot('scope');
  await ev(`clearInterval(window.__scopeHold); window.__ctx.cameraFx.fovKick = 0`);
  await step(0.5);

  // 全图
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', bubbles: true }))`);
  await settle(700);
  log('map', JSON.stringify(await b.eval(`[window.__game.state, window.__router.ids, window.__router.top.hasImage, window.__router.top.boxSize, window.__router.top.titleText, window.__router.top.targetText, window.__router.top.marks.length]`)));
  await shot('map');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', bubbles: true }))`);
  await settle(200);
  log('map closed', await b.eval('window.__game.state'), JSON.stringify(await b.eval('window.__router.ids')));

  // 行囊（先拿几卷秘卷、第二把枪）
  await ev(`const c = window.__ctx; const all = c.scrolls.all; for (const i of [0, 3, 3, 8, 15, 22, 31]) if (all[i]) c.scrolls.add(all[i].id);
    const ids = c.weapons.allDefIds(); c.weapons.give(c.weapons.roll({ defId: ids[Math.min(4, ids.length - 1)], rarity: 3 }))`);
  await step(0.2);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }))`);
  await settle(700);
  log('inventory', JSON.stringify(await b.eval(`[window.__game.state, window.__router.top.id, window.__router.top.scrollRows, window.__router.top.weaponCards]`)));
  await shot('inventory');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))`);
  await settle(300);
  await shot('inventory-pet');
  await ev(`window.__ui.setPetSource(null); window.__router.top.rebuild()`);
  await settle(200);
  await shot('inventory-pet-empty');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }))`);
  await settle(200);

  // 秘卷三选一：各稀有度挑一张（含传说 / 史诗）
  await ev(`const c = window.__ctx; const by = r => c.scrolls.all.find(s => s.rarity === r);
    window.__picked = null; c.ui.showScrollChoice([by(4) ?? by(3), by(1) ?? by(0), c.scrolls.all[3]].filter(Boolean), s => { window.__picked = s.id; c.scrolls.add(s.id); })`);
  await settle(1900);
  await shot('scroll-choice');
  await ev(`window.__router.top.choose(0, true)`);
  await wait(120);
  await step(0.03);
  await shot('scroll-choice-picked');
  await settle(600);
  log('choice', JSON.stringify(await b.eval(`[window.__picked, window.__game.state, window.__router.ids, !!document.querySelector('.sf-choice')]`)));

  // 关卡卡片：走出口换关时弹（Game.advance → UI.stageCard）
  await ev(`const c = window.__ctx; c.run.kills += 37; c.run.coins += 264; c.run.time += 312; const next = c.runPlan.nextOptions(c.run)[0]; window.__next = next; c.game.advance(next)`);
  await settle(900);
  log('stage card', JSON.stringify(await b.eval(`[window.__game.state, window.__router.ids, window.__router.top && window.__router.top.tagText]`)));
  await shot('stage-card');

  // 整局结算（直接结束这一局：卡片随状态收起）
  await ev(`const c = window.__ctx; c.run.damageDealt = 48213; c.run.essence = 86; c.run.stagesCleared = 2; c.game.endRun(false)`);
  await settle(2600);
  log('summary', JSON.stringify(await b.eval(`[window.__game.state, window.__router.ids]`)));
  await shot('summary-defeat');
  await ev(`const s = window.__router.top; s.onOpen({ ...s.summary, victory: true, stagesCleared: 16, essenceEarned: 486, chapter: 3, stageIndex: 3 })`);
  await settle(2600);
  await shot('summary-victory');
  await ev(`window.__router.top.toMenu()`);
  await settle(1500);
  log('back to menu', JSON.stringify(await b.eval(`[window.__game.state, window.__router.ids]`)));

} catch (err) {
  console.error(err);
  console.error(b.logs.slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  const sum = (k) => ussReport.reduce((n, [, r]) => n + r[k], 0);
  const sizes = [...new Set(ussReport.flatMap(([, r]) => r.sizeBad))];
  log('uss 宽高不一致（排版结果，逐条看过）', sizes.length, '种');
  for (const x of sizes) log('   ', x);
  log('uss 合计', `${ussReport.length} 张：核对 ${sum('checked')} 项、不一致 ${sum('mismatches')}；宽高 ${sum('sizeChecked')} 项、不一致 ${sum('sizeMismatches')}；旧样式影响 sf 元素 ${sum('legacyChanged')} 个`);
  const errors = b.logs.filter((l) => /\[(error|exception)\]|Uncaught|TypeError|ReferenceError/i.test(l) && !l.includes('加载失败'));
  log('page errors', errors.length);
  for (const e of errors.slice(0, 20)) log('  ', e.slice(0, 500));
  await b.close();
}
