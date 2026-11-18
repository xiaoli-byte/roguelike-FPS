// 鲲鹏无头对局截图（docs/threejs-migration.md M6 验收）：?debug&dev&debugStage=2-4 开一局，玩家走进北冥冰台的环台（首领场自己的地面）触发首领战，
// 逐帧推进游戏（Game.frame，固定步长，不靠后台标签页的 rAF），在登场演出（俯拍冰窟 / 破水 / 鲛珠特写）、一阶段猛砸、化鹏、二阶段羽刃雨与落台各拍一张。
//   node scripts/kunpeng/fight-shots.mjs [端口=5671] [输出目录=docs/art/review/threejs-migration]
// 开发钩子 window.__kunpeng 只在开发服务器里、网址带 ?dev 时存在（src/enemies/bosses/KunPeng.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5671';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const log = (...a) => console.log('[kunpeng]', ...a);
// 几个代理同时跑无头对局时机器很挤，Chromium 30 s 内起不来是常事：多试几轮
let b = null;
for (let k = 0; k < 6 && !b; k++) {
  try {
    b = await launch({ width: 1280, height: 720 });
  } catch (err) {
    log(`Chromium 没起来（第 ${k + 1} 轮）`, err?.message ?? err);
    await new Promise(r => setTimeout(r, 20000));
  }
}
if (!b) throw new Error('Chromium 起不来');

try {
  await b.goto(`http://localhost:${port}/?debug&dev&debugStage=2-4`);
  await b.waitFor('window.__game && window.__ctx', 120000);
  for (let k = 0; k < 900 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
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
  for (let k = 0; k < 240; k++) {
    await b.eval('window.__step(0.1)');
    const ok = await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`);
    if (ok) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'), 'stage', await b.eval('window.__ctx.stage.stage?.id ?? window.__ctx.stage.stage?.title ?? null'));
  await b.eval('window.__step(2)');
  // 玩家沿出生点 → 首领场中心走进环台：离中心 42 m 以内、站在首领场自己的地面上（2-4 的环台 0 m，出生的营地 −8 m），
  // 让关卡自己触发首领战（同 Unity BossEncounter：场地范围内且脚在首领场地面 ±6 m）
  const rim = await b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, boss = c.stage.unityDocument?.bosses?.[0];
    if (!boss) return null;
    const floor = boss.floorY, center = new V(boss.center[0], floor, boss.center[2]);
    const from = c.player.position.clone();
    for (let k = 0; k <= 80; k++) {
      const p = from.clone().lerp(center, k / 80);
      const d = Math.hypot(p.x - center.x, p.z - center.z);
      if (d > 40 || d < 20) continue;
      const y = c.world.groundHeight(p.x, p.z, 60, 0.3);
      if (!Number.isFinite(y) || Math.abs(y - floor) > 2.5) continue;
      p.y = y + 0.05;
      c.player.teleport(p, Math.atan2(-(center.x - p.x), -(center.z - p.z)));
      return [p.toArray(), boss.id, boss.radius];
    }
    return null;
  })()`);
  log('rim', JSON.stringify(rim));
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  let found = false;
  for (let k = 0; k < 80 && !found; k++) {
    await b.eval('window.__step(0.1)');
    await b.eval(god);
    found = await b.eval('!!window.__kunpeng');
  }
  if (!found) throw new Error(`首领没有出现（关卡没有触发首领战）\n${JSON.stringify(await b.eval(`({ p: window.__ctx.player.position.toArray(), alive: window.__ctx.enemies.aliveCount() })`))}\n${b.logs.filter(l => !l.includes('加载失败')).slice(-30).join('\n')}`);
  log('kunpeng spawned', JSON.stringify(await b.eval('window.__kunpeng.state()')));
  const state = () => b.eval('JSON.stringify(window.__kunpeng.state())');
  const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };
  /** 让玩家看向首领（或某点） */
  const look = (expr = 'window.__kunpeng.boss.getBodyCenter(new V())', pitchK = 0.9) => b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, e = c.player.eye, t = ${expr};
    c.player.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z));
    c.player.pitch = Math.max(-1, Math.min(1.1, Math.atan2(t.y - e.y, Math.hypot(t.x - e.x, t.z - e.z)) * ${pitchK}));
    return true;
  })()`);
  /** 玩家站到环台上：冰窟圆心朝 yawDeg、离圆心 r 米（贴地） */
  const stand = (yawExpr, r) => b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, h = window.__kunpeng.boss.hole;
    const p = h.point(${yawExpr}, ${r}, new V());
    const y = c.world.groundHeight(p.x, p.z, h.floorY + 6, 0.3);
    p.y = (Number.isFinite(y) ? y : h.floorY) + 0.05;
    c.player.teleport(p, 0);
    return p.toArray().map(v => +v.toFixed(2));
  })()`);

  // ── 登场演出：俯拍冰窟（abyss）→ 破水（breach）→ 鲛珠特写 + 名字卡（pearl）──
  await step(1.3);
  log('intro abyss', await state());
  await b.shot(`${out}/kunpeng-intro-abyss.jpg`);
  await step(1.9);
  log('intro breach', await state());
  await b.shot(`${out}/kunpeng-intro-breach.jpg`);
  await step(2.0);
  log('intro pearl', await state());
  await b.shot(`${out}/kunpeng-intro-pearl.jpg`);
  await step(3.5);
  log('after intro', await state());
  for (let k = 0; k < 30 && !(await b.eval('window.__kunpeng.state().introDone')); k++) await step(0.2);

  // ── 一阶段：猛砸冰浪（玩家在鲲正面的环台上，离冰沿 9 m）──
  log('stand', await stand('window.__kunpeng.boss.theta + 25', 'h.radius + 11'));
  await step(0.6);
  await b.eval(`window.__kunpeng.forceMove('slam')`);
  await look();
  await step(1.25);
  await look('window.__kunpeng.boss.moveById("slam").impact.clone().setY(window.__kunpeng.boss.hole.floorY + 3)', 0.6);
  log('phase1 slam', await state());
  await b.shot(`${out}/kunpeng-phase1-slam.jpg`);
  await step(2);

  // ── 一阶段：吞吸（扇形 + 冰屑气流）──
  await b.eval(`window.__kunpeng.forceMove('inhale')`);
  await look();
  await step(1.8);
  await look();
  log('phase1 inhale', await state());
  await b.shot(`${out}/kunpeng-phase1-inhale.jpg`);
  await step(3.5);

  // ── 化鹏：50% 以下，冰窟炸开、扶摇、鹏从雾里升起 ──
  await b.eval('window.__kunpeng.setHealth(0.45)');
  for (let k = 0; k < 30 && !(await b.eval('window.__kunpeng.state().transitioning')); k++) await step(0.1);
  await step(1.35);
  await look('window.__kunpeng.boss.hole.center.clone().setY(window.__kunpeng.boss.hole.floorY + 4)', 0.8);
  log('transition burst', await state());
  await b.shot(`${out}/kunpeng-phase2-transform.jpg`);
  await step(2.0);
  await look();
  log('transition rise', await state());
  await b.shot(`${out}/kunpeng-phase2-rise.jpg`);
  for (let k = 0; k < 40 && (await b.eval('window.__kunpeng.state().transitioning')); k++) await step(0.2);

  // ── 二阶段：扇翼狂风（化鹏后的第一招）→ 羽刃雨 ──
  await step(3.0);
  await look();
  log('phase2 gust', await state());
  await b.shot(`${out}/kunpeng-phase2-gust.jpg`);
  for (let k = 0; k < 40 && (await b.eval('!!window.__kunpeng.state().move')); k++) await step(0.2);
  await b.eval(`window.__kunpeng.forceMove('rain')`);
  await step(1.35);
  await look('window.__kunpeng.boss.getBodyCenter(new V()).lerp(window.__ctx.player.position, 0.6)', 0.9);
  log('phase2 rain', await state());
  await b.shot(`${out}/kunpeng-phase2-rain.jpg`);
  await step(2.5);

  // ── 二阶段：落台歇翼（主要输出窗口，鲛珠大亮）──
  await b.eval('window.__kunpeng.boss.movesSincePerch = 2');
  await b.eval(`window.__kunpeng.forceMove('perch')`);
  for (let k = 0; k < 40; k++) {
    await step(0.2);
    const st = JSON.parse(await state());
    if (st.move === 'perch' && st.stage === 'active') break;
  }
  await step(0.8);
  await look();
  log('phase2 perch', await state());
  await b.shot(`${out}/kunpeng-phase2-perch.jpg`);

  // ── 25% 鹏狂怒：连掠两次的俯冲 ──
  await step(5);
  await b.eval('window.__kunpeng.setHealth(0.2)');
  await step(0.3);
  for (let k = 0; k < 40 && (await b.eval('!!window.__kunpeng.state().move')); k++) await step(0.2);
  await b.eval(`window.__kunpeng.forceMove('swoop')`);
  for (let k = 0; k < 40; k++) {
    await step(0.1);
    const sub = await b.eval('window.__kunpeng.boss.currentMove?.sub ?? null');
    if (sub === 'dive') break;
  }
  await step(0.25);
  await look();
  log('phase2 swoop (enraged)', await state());
  await b.shot(`${out}/kunpeng-phase2-swoop.jpg`);
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 20)) log(e);
} finally {
  await b.close();
}
