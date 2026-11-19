// 界面实机截图（docs/threejs-migration.md M11c 验收）：无头 Chromium 按 1920×1080（界面缩放 = 1，像素 = USS 的设计像素）开调试局，
// 逐帧推进游戏（Game.frame，固定步长），拍 HUD 的各种状态、首领条、暂停菜单和设置页。
//   node scripts/web/ui-shots.mjs [端口=5233] [输出目录=docs/art/review/threejs-migration]
// 需要开发服务器（npx vite --port <端口>）；钩子 window.__game / __ctx 在网址带 ?debug 时存在（core/Game.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5233';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const W = 1920, H = 1080;
const log = (...a) => console.log('[ui]', ...a);
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
  return true;
})()`;

async function open(stage, menuShot = null) {
  await b.goto(`http://127.0.0.1:${port}/?debug&debugStage=${stage}`);
  await b.waitFor('window.__game && window.__ctx', 120000);
  for (let k = 0; k < 600 && !b.logs.some((l) => l.includes('[assets] 已加载')); k++) await wait(250);
  await b.eval(STEP);
  if (menuShot) {
    // 主菜单（还没迁的旧界面，挂在界面层的壳里）
    await step(0.5);
    await wait(1500);
    await step(0.05);
    await shot(menuShot);
  }
  await b.eval('window.__game.startRun(window.__ctx.heroes[0].id), true');
  for (let k = 0; k < 240; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await wait(250);
  }
  log(stage, 'state', await b.eval('window.__game.state'));
}

const step = (s) => b.eval(`window.__step(${s})`);
/** 界面动画用真实时间：推几帧游戏、再等真实时间让界面过渡走完 */
async function settle(ms = 700) {
  await step(0.05);
  await wait(ms);
  await step(0.02);
}
const shot = async (name) => {
  await b.shot(`${out}/ui-${name}.jpg`, 88);
  log('shot', name);
};

try {
  // ───────────── 1-1：HUD 各状态 ─────────────
  await open('1-1', 'legacy-menu');
  await step(1.5);
  await settle(3200); // 横幅放完、HUD 淡入
  await shot('hud-full');

  // 前方摆两个敌人（一个普通、一个精英带词缀），面朝它们。1-1 的出生点朝西、离地图边界的隐形碰撞墙不到 9 m：
  // 先转到视线 16 m 内没有遮挡的方向（每次 30°），不然子弹和头顶血条的遮挡测试都会撞墙
  await b.eval(`(() => {
    const c = window.__ctx, p = c.player, V = p.position.constructor;
    p.invulnerableTime = 9999;
    for (let k = 0; k < 12; k++) {
      const g = p.getForward(new V());
      if (!c.world.segmentBlocked(p.eye, p.eye.clone().addScaledVector(g, 16))) break;
      p.yaw += Math.PI / 6;
      window.__step(0.02);
    }
    const f = p.getForward(new V());
    const at = (d, side) => { const q = p.position.clone().addScaledVector(f, d); q.x += -f.z * side; q.z += f.x * side; const y = c.world.groundHeight(q.x, q.z, q.y + 6, 0.3); if (Number.isFinite(y)) q.y = y; return q; };
    window.__foes = [
      c.enemies.spawn('grunt', { position: at(9, -1.6), level: 1 }),
      c.enemies.spawn('brute', { position: at(13, 2.4), elite: true, affix: 'volatile', level: 1 }),
    ].filter(Boolean);
    for (const e of window.__foes) e.stunTime = 999;
    return window.__foes.length;
  })()`);
  await step(2);
  // 瞄准普通敌人身体，真开火（准星散布、弹匣、命中标记、伤害数字、头顶血条都从武器 → 战斗管线来）；
  // 武器的弹道一发都没打中时（视线被挡）退回 combat.damageEnemy 按射速逐发喂伤害，界面走的是同一条事件
  await b.eval(`(() => { window.__hits = 0; window.__ctx.events.on('enemy:damaged', () => window.__hits++); return true; })()`);
  const aim = `(() => {
    const c = window.__ctx, p = c.player, e = window.__foes[0], V = p.position.constructor;
    const t = e.getBodyCenter(new V()), d = t.sub(p.eye);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    return true;
  })()`;
  const hit = (i, base, extra = '') => `(() => {
    const c = window.__ctx, e = window.__foes[${i}], V = c.player.position.constructor;
    if (!e || !e.alive) return false;
    const pt = e.getBodyCenter(new V()); pt.y += (Math.random() - 0.5) * 0.4;
    c.combat.damageEnemy(e, { base: ${base}, element: 'none', source: 'weapon', point: pt, canCrit: false ${extra} });
    return true;
  })()`;
  await b.eval(aim);
  await step(0.05);
  await b.eval('window.__ctx.input.simulateButton(0, true), true');
  for (let k = 0; k < 6; k++) {
    await b.eval(aim);
    await step(0.08);
  }
  const real = await b.eval('window.__hits');
  log('weapon hits', real);
  if (!real) {
    for (let k = 0; k < 6; k++) {
      await b.eval(aim);
      await b.eval(hit(0, 4));
      if (k === 3) await b.eval(hit(0, 6, ", forceCrit: true"));
      await step(0.08);
    }
  }
  // 精英：打掉一截护盾和生命，挂上灼烧 + 雷殛（状态小标、可反应的呼吸光）
  await b.eval(`(() => { const c = window.__ctx, e = window.__foes[1]; if (!e) return false;
    c.combat.damageEnemy(e, { base: 40, element: 'fire', source: 'weapon', canCrit: false, point: e.getBodyCenter(c.player.position.clone()) });
    c.combat.applyStatus(e, 'burn', 1, 8); c.combat.applyStatus(e, 'shock', 1, 8); return [e.hp, e.maxHp, e.shield, e.maxShield]; })()`);
  await b.eval(aim);
  await b.eval(hit(0, 5));
  await step(0.03);
  await wait(120);
  log('bars', JSON.stringify(await b.eval(`[...document.querySelectorAll('.sf-ebar-anchor')].filter(a => a.style.display !== 'none').map(a => [a.style.opacity, a.textContent])`)));
  await shot('hud-fire');
  await b.eval('window.__ctx.input.simulateButton(0, false), true');
  await step(0.05);
  await wait(500);
  await shot('damage-numbers');

  // 掉盾：护盾打穿（碎裂闪光），生命掉一截
  await b.eval(`(() => { const c = window.__ctx, p = c.player, V = p.position.constructor; p.invulnerableTime = 0;
    const from = p.position.clone().add(new V(6, 1, 0));
    p.takeDamage(p.shield + p.maxHp() * 0.3, 'none', null, from); p.invulnerableTime = 9999; return [p.hp, p.shield]; })()`);
  await step(0.03);
  await wait(40);
  await shot('hud-shield-break');
  await wait(900);

  // 低血：剩 18%（生命条闪、徽记朱红呼吸、四周暗角心跳）
  await b.eval(`(() => { const p = window.__ctx.player; p.hp = p.maxHp() * 0.18; p.shield = 0; return true; })()`);
  await step(0.2);
  await wait(700);
  await shot('hud-lowhp');
  await b.eval(`(() => { const p = window.__ctx.player; p.hp = p.maxHp(); p.shield = p.maxShield(); return true; })()`);

  // 换弹：打空一半再按 R（准星换弹环 + 武器槽换弹条）
  await b.eval(`(() => { const w = window.__ctx.weapons.active; if (w) w.mag = Math.min(w.mag, 3); return true; })()`);
  await b.eval(`window.__ctx.input.simulateKey('KeyR', true), true`);
  await step(0.05);
  await b.eval(`window.__ctx.input.simulateKey('KeyR', false), true`);
  await step(0.35);
  await wait(200);
  await shot('hud-reload');
  await step(3);

  // 技能冷却：放 Q、E（E 按两次把充能用完）
  for (const key of ['KeyQ', 'KeyE', 'KeyE']) {
    await b.eval(`window.__ctx.input.simulateKey('${key}', true), true`);
    await step(0.05);
    await b.eval(`window.__ctx.input.simulateKey('${key}', false), true`);
    await step(0.4);
  }
  await step(1.2);
  await wait(400);
  await shot('hud-skill-cooldown');

  // 提示与横幅：一条 toast（合并 ×2）+ 区域肃清横幅 + 交互提示卡
  await b.eval(`(() => { const u = window.__ctx.ui; u.toast('获得秘卷 · 燎原'); u.toast('获得秘卷 · 燎原'); u.toast('灵石 +120', '#f4d58a');
    u.banner('区域肃清', '出口已开启', 3); u.setInteractPrompt({ title: '赤蛟霰铳', subtitle: '稀有 · 霰弹', lines: ['伤害 ▲ 12%', '射速 ▼ 8%'], cost: 260 }); return true; })()`);
  await settle(1400);
  await shot('hud-toast-banner');
  await b.eval(`window.__ctx.ui.setInteractPrompt(null), true`);

  // 暂停菜单、设置页（三个页签）
  await b.eval('window.__game.pause(), true');
  await settle(600);
  await shot('pause');
  await b.eval(`window.__ctx.ui.root.router.open('settings')`);
  await settle(500);
  await shot('settings-controls');
  await b.eval(`window.__ctx.ui.root.router.top.select('画面'), true`);
  await settle(200);
  await shot('settings-video');
  await b.eval(`window.__ctx.ui.root.router.top.select('声音'), true`);
  await settle(200);
  await shot('settings-audio');
  await b.eval(`window.__ctx.ui.showPause(false), window.__game.resume(), true`);

  // ───────────── 1-4：首领条 ─────────────
  await open('1-4');
  await b.eval(`(() => { const c = window.__ctx, V = c.player.position.constructor; c.player.invulnerableTime = 9999;
    window.__boss = c.enemies.spawn('boss_hanba', { position: new V(0, -1.42794323, 8), level: c.run.difficulty }); return !!window.__boss; })()`);
  // 登场演出（HUD 藏起）走完
  for (let k = 0; k < 16; k++) await step(1);
  await b.eval(`(() => { const c = window.__ctx, p = c.player, h = window.__boss, V = p.position.constructor;
    const q = new V(h.position.x, 0, h.position.z + 16); const y = c.world.groundHeight(q.x, q.z, h.position.y + 12, 0.3);
    q.y = Number.isFinite(y) ? y + 0.05 : h.position.y; p.teleport(q, 0); return true; })()`);
  await b.eval(`(() => { const h = window.__boss; h.hp = h.maxHp * 0.86; h.shield = h.maxShield * 0.55; return [h.hp, h.maxHp, h.shield, h.maxShield]; })()`);
  await step(0.5);
  await settle(1000);
  await shot('boss-bar');
  log('boss', JSON.stringify(await b.eval(`(() => { const h = window.__boss; return { alive: h.alive, hp: h.hp, shield: h.shield, untargetable: !!h.untargetable }; })()`)));
} catch (err) {
  console.error(err);
  console.error(b.logs.slice(-40).join('\n'));
  process.exitCode = 1;
} finally {
  const errors = b.logs.filter((l) => /\[(error|exception)\]/.test(l) && !l.includes('加载失败'));
  if (errors.length) console.log('页面错误：\n' + errors.slice(-20).join('\n'));
  await b.close();
}
