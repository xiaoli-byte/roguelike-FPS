// 旱魃无头对局截图（docs/threejs-migration.md M6 验收）：?debug&dev&debugStage=1-4 开一局，把玩家放到首领场边上触发首领战，
// 逐帧推进游戏（Game.frame，固定步长，不靠后台标签页的 rAF），在登场演出、一阶段扫射、二阶段焦土、三阶段日蚀各拍一张。
//   node scripts/hanba/fight-shots.mjs [端口=5651] [输出目录=docs/art/review/threejs-migration]
// 开发钩子 window.__hanba 只在开发服务器里、网址带 ?dev 时存在（src/enemies/bosses/Hanba.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5651';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const b = await launch({ width: 1280, height: 720 });
const log = (...a) => console.log('[hanba]', ...a);

try {
  await b.goto(`http://localhost:${port}/?debug&dev&debugStage=1-4`);
  await b.waitFor('window.__game && window.__ctx', 120000);
  // 美术资产在后台加载（旱魃的正式模型、日轮挂件都在里面）：等清单加载完再开局
  for (let k = 0; k < 900 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
  // 停掉页面自己的 rAF 循环（后台标签页里本来就不稳），改由下面的 step 逐帧推进
  await b.eval(`(() => {
    const g = window.__game;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  // 载入关卡（异步）：一边等一边推帧
  for (let k = 0; k < 240; k++) {
    await b.eval('window.__step(0.1)');
    const ok = await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`);
    if (ok) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'));
  await b.eval('window.__step(2)');
  log('arena', JSON.stringify(await b.eval(`(() => { const a = window.__ctx.stage.arena; return [a.minX, a.maxX, a.minZ, a.maxZ, a.floorY]; })()`)));
  // 玩家沿出生点 → 首领场中心走到台地边缘（离中心 42 m 以内、和台地同高），让关卡自己触发首领战（WaveRunner 刷首领）
  const rim = await b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, a = c.stage.arena;
    const from = c.player.position.clone(), center = new V(2, 0, 4);
    for (let k = 0; k <= 60; k++) {
      const p = from.clone().lerp(center, k / 60);
      if (Math.hypot(p.x - center.x, p.z - center.z) > 42) continue;
      const y = c.world.groundHeight(p.x, p.z, 60, 0.3);
      if (!Number.isFinite(y) || Math.abs(y - a.floorY) > 2.5) continue;
      p.y = y + 0.05;
      c.player.teleport(p, Math.atan2(-(center.x - p.x), -(center.z - p.z)));
      return p.toArray();
    }
    return null;
  })()`);
  log('rim', JSON.stringify(rim));
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  let found = false;
  for (let k = 0; k < 80 && !found; k++) {
    await b.eval('window.__step(0.1)');
    await b.eval(god);
    found = await b.eval('!!window.__hanba');
  }
  if (!found) {
    // 首领关的遭遇没触发（调试开局的进度状态不同）：按场景文档的首领锚点直接刷（同 WaveRunner 的刷法）
    log('fight did not trigger', JSON.stringify(await b.eval(`({ p: window.__ctx.player.position.toArray(), alive: window.__ctx.enemies.aliveCount(), stage: window.__ctx.stage.stage?.type })`)));
    await b.eval(`(() => { const c = window.__ctx, V = c.player.position.constructor; c.enemies.spawn('boss_hanba', { position: new V(0, -1.42794323, 8), level: c.run.difficulty }); return true; })()`);
    for (let k = 0; k < 10 && !found; k++) {
      await b.eval('window.__step(0.05)');
      found = await b.eval('!!window.__hanba');
    }
  }
  if (!found) throw new Error(`首领没有出现\n${b.logs.filter(l => !l.includes('加载失败')).slice(-30).join('\n')}`);
  log('hanba spawned', JSON.stringify(await b.eval('window.__hanba.state()')));
  const state = () => b.eval('JSON.stringify(window.__hanba.state())');
  const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };

  // ── 登场演出：建立全景（basin）→ 破泉升起（emerge）→ 长啸特写 + 名字卡（roar）──
  await step(1.4);
  log('intro basin', await state());
  await b.shot(`${out}/hanba-intro-basin.jpg`);
  await step(2.4);
  log('intro emerge', await state());
  await b.shot(`${out}/hanba-intro-emerge.jpg`);
  await step(1.6);
  log('intro roar', await state());
  await b.shot(`${out}/hanba-intro-roar.jpg`);
  await step(3.5);
  log('after intro', await state());

  // 开打后把玩家放到泉北岸、离她 16 m，面朝她（截图看得清）
  await b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, h = window.__hanba.boss.position;
    const p = new V(h.x, 0, h.z + 16);
    const y = c.world.groundHeight(p.x, p.z, h.y + 12, 0.3);
    p.y = Number.isFinite(y) ? y + 0.05 : h.y;
    c.player.teleport(p, 0);
    return true;
  })()`);
  // ── 一阶段：日轮扫射 ──
  for (let k = 0; k < 30 && !(await b.eval('window.__hanba.state().introDone')); k++) await step(0.2);
  await b.eval(`window.__hanba.forceMove('sun_sweep')`);
  await step(2.0);
  log('phase1 sweep', await state());
  await b.shot(`${out}/hanba-phase1-sweep.jpg`);
  await step(4);

  // ── 二阶段：吸干泉水、龟裂、喷气、飞天之殇 ──
  await b.eval('window.__hanba.setHealth(0.55)');
  await step(1);
  log('phase2 transition', await state());
  await step(4);
  log('phase2', await state());
  // 泉床裂口喷气：挑离玩家最近的几个裂口喷一轮，转过去看
  await b.eval(`(() => {
    const h = window.__hanba.boss, c = window.__ctx, p = c.player.position;
    h.scorch.burst(3);
    const v = h.scorch.vents.slice().sort((a, b) => a.distanceToSquared(p) - b.distanceToSquared(p))[0];
    if (v) { c.player.yaw = Math.atan2(-(v.x - p.x), -(v.z - p.z)); c.player.pitch = -0.08; }
    return true;
  })()`);
  await step(1.35);
  await b.shot(`${out}/hanba-phase2-scorch.jpg`);

  // ── 三阶段：日轮升顶、日蚀 ──
  await b.eval('window.__hanba.boss.ward.drop()');
  await b.eval('window.__hanba.setHealth(0.25)');
  await step(4.2);
  log('phase3 risen', await state());
  for (let k = 0; k < 30; k++) {
    const st = JSON.parse(await state());
    if (st.eclipse) break;
    if (!st.move && !st.transitioning) await b.eval(`window.__hanba.forceMove('eclipse')`);
    await step(0.2);
  }
  await step(1.2);
  // 抬头看升到头顶的日轮（黑盘 + 日冕倒计时珠），她在画面下沿
  await b.eval(`(() => {
    const h = window.__hanba.boss, c = window.__ctx, p = c.player.eye, r = h.ring.center(p.clone());
    c.player.yaw = Math.atan2(-(r.x - p.x), -(r.z - p.z));
    c.player.pitch = Math.min(1.1, Math.atan2(r.y - p.y, Math.hypot(r.x - p.x, r.z - p.z)) * 0.75);
    return true;
  })()`);
  await step(0.3);
  log('phase3 eclipse', await state());
  await b.shot(`${out}/hanba-phase3-eclipse.jpg`);
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 20)) log(e);
} finally {
  await b.close();
}
