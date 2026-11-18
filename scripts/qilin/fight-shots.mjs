// 火麒麟无头对局截图（docs/threejs-migration.md M6 验收）：?debug&dev&debugStage=3-4 开一局，玩家从出生点沿神道走进炉心殿（站在首领场自己的地面上），
// 让关卡自己触发首领战；逐帧推进游戏（Game.frame，固定步长，不靠后台标签页的 rAF），在登场演出三个镜头、一阶段张鳞 / 饮熔、化焚身、二阶段熔流 / 喘息 / 狂怒各拍一张。
//   node scripts/qilin/fight-shots.mjs [端口=5672] [输出目录=docs/art/review/threejs-migration]
// 开发钩子 window.__qilin 只在开发服务器里、网址带 ?dev 时存在（src/enemies/bosses/Qilin.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5672';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const b = await launch({ width: 1280, height: 720 });
const log = (...a) => console.log('[qilin]', ...a);

try {
  await b.goto(`http://localhost:${port}/?debug&dev&debugStage=3-4`);
  await b.waitFor('window.__game && window.__ctx', 180000);
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
  log('state', await b.eval('window.__game.state'));
  await b.eval('window.__step(2)');
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  // 玩家沿出生点 → 首领场中心（3-4：神道从南门进殿）走进炉心殿：离中心 21 m 以内、脚在首领场自己的地面上（殿内 0 m，出生点在 24 m 的山门）
  const rim = await b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, boss = c.stage.unityDocument?.bosses?.[0];
    const floor = boss ? boss.floorY : c.stage.arena.floorY;
    const from = c.player.position.clone(), center = boss ? new V(boss.center[0], floor, boss.center[2]) : new V(0, 0, 0);
    for (let k = 0; k <= 200; k++) {
      const p = from.clone().lerp(center, k / 200);
      if (Math.hypot(p.x - center.x, p.z - center.z) > 21) continue;
      const y = c.world.groundHeight(p.x, p.z, floor + 8, 0.3);
      if (!Number.isFinite(y) || Math.abs(y - floor) > 2.5) continue;
      p.y = y + 0.05;
      c.player.teleport(p, Math.atan2(-(center.x - p.x), -(center.z - p.z)));
      return [p.toArray().map(v => +v.toFixed(2)), boss?.id ?? null];
    }
    return null;
  })()`);
  log('rim', JSON.stringify(rim));
  let found = false;
  for (let k = 0; k < 80 && !found; k++) {
    await b.eval('window.__step(0.1)');
    await b.eval(god);
    found = await b.eval('!!window.__qilin');
  }
  if (!found) throw new Error(`首领没有出现（关卡没触发首领战）\n${b.logs.filter(l => !l.includes('加载失败')).slice(-30).join('\n')}`);
  const state = () => b.eval('JSON.stringify(window.__qilin.state())');
  const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };
  log('qilin spawned', await state());

  // ── 登场演出：殿内中景仰到吊鼎（furnace）→ 侧面跟拍跃出（leap）→ 仰拍人立长啸 + 名字卡（rear）──
  // 演出有慢动作（演出时间按真实时间走），按演出自己的时间等镜头
  const untilIntro = async (t) => {
    for (let k = 0; k < 200; k++) {
      const d = JSON.parse(await state()).director;
      if (!d || d.t >= t || d.released) return;
      await step(0.05);
    }
  };
  await untilIntro(1.5);
  log('intro furnace', await state());
  await b.shot(`${out}/qilin-intro-furnace.jpg`);
  await untilIntro(2.85);
  log('intro leap', await state());
  await b.shot(`${out}/qilin-intro-leap.jpg`);
  await untilIntro(4.7);
  log('intro rear', await state());
  await b.shot(`${out}/qilin-intro-rear.jpg`);
  for (let k = 0; k < 40 && !JSON.parse(await state()).introDone; k++) await step(0.2);
  log('after intro', await state());

  /** 玩家放到殿内 yaw（度）方向、离圆心 r 米处，面朝 look（没给就看首领身体） */
  const place = (yaw, r, look = null) => b.eval(`(() => {
    const c = window.__ctx, q = window.__qilin.boss, f = q.furnace, V = c.player.position.constructor;
    const a = ${yaw} * Math.PI / 180, p = new V(f.center.x + Math.sin(a) * ${r}, f.center.y, f.center.z + Math.cos(a) * ${r});
    const y = c.world.groundHeight(p.x, p.z, f.center.y + 4, 0.3);
    p.y = Number.isFinite(y) ? y + 0.05 : f.center.y;
    const t = ${look ? `new V(${look})` : 'q.getBodyCenter(new V())'};
    c.player.teleport(p, Math.atan2(-(t.x - p.x), -(t.z - p.z)));
    const e = p.clone(); e.y += 1.6;
    c.player.pitch = Math.max(-0.6, Math.min(0.9, Math.atan2(t.y - e.y, Math.hypot(t.x - e.x, t.z - e.z))));
    return true;
  })()`);
  const lookAtBoss = (dy = 0) => b.eval(`(() => {
    const c = window.__ctx, q = window.__qilin.boss, t = q.getBodyCenter(new c.player.position.constructor()), p = c.player.position;
    t.y += ${dy};
    c.player.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    c.player.pitch = Math.max(-0.6, Math.min(0.9, Math.atan2(t.y - p.y - 1.6, Math.hypot(t.x - p.x, t.z - p.z))));
    return true;
  })()`);

  // ── 一阶段：张鳞（前摇里鳞冠竖起）──
  await place(180, 17);
  await step(0.5);
  for (let k = 0; k < 80 && !(await b.eval(`window.__qilin.forceMove('scales')`)); k++) await step(0.1);
  await step(0.6);
  await lookAtBoss(-0.5);
  log('phase1 scales', await state());
  await b.shot(`${out}/qilin-phase1-scales.jpg`);
  await step(2);

  // ── 一阶段：85% 饮熔（跃到池边低头饮熔，它身后的锁扣发亮）──
  await b.eval('window.__qilin.setHealth(0.84)');
  for (let k = 0; k < 40 && !JSON.parse(await state()).sipping; k++) await step(0.1);
  await step(0.6);
  const sip = JSON.parse(await state());
  log('phase1 drink', JSON.stringify(sip));
  if (sip.drinkQ >= 0) {
    // 站在饮熔点对面的池岸，越过麒麟看它身后墙上发亮的锁扣
    await b.eval(`(() => {
      const c = window.__ctx, q = window.__qilin.boss, f = q.furnace, V = c.player.position.constructor;
      const qy = f.quadrantYaw(${sip.drinkQ}), a = (qy + 180 + 28) * Math.PI / 180;
      const p = new V(f.center.x + Math.sin(a) * 13, f.center.y + 0.05, f.center.z + Math.cos(a) * 13);
      const lk = f.point(qy, f.wallRadius - 1); lk.y = f.center.y + 9;
      c.player.teleport(p, Math.atan2(-(lk.x - p.x), -(lk.z - p.z)));
      c.player.pitch = Math.atan2(lk.y - p.y - 1.6, Math.hypot(lk.x - p.x, lk.z - p.z));
      return true;
    })()`);
  }
  await step(0.1);
  await b.shot(`${out}/qilin-phase1-drink.jpg`);
  // 打碎它身后那个锁扣：鼎角砸中、鳞甲崩裂
  if (sip.drinkQ >= 0) await b.eval(`window.__qilin.breakLock(${sip.drinkQ})`);
  await step(1.0);
  await lookAtBoss();
  log('phase1 crack', await state());
  await b.shot(`${out}/qilin-phase1-crack.jpg`);
  await step(4.5);

  // ── 化焚身（55%）：熔岩柱里换形 ──
  // 南门轴线上（两根柱子在 ±20° 之间）看熔池正中
  await place(180, 17, '0, 6, 0');
  await b.eval('window.__qilin.setHealth(0.5)');
  for (let k = 0; k < 30 && !JSON.parse(await state()).transitioning; k++) await step(0.1);
  await step(2.3);
  await b.eval(`(() => { const c = window.__ctx, f = window.__qilin.boss.furnace, p = c.player.position; const t = f.center.clone(); t.y += 5;
    c.player.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z)); c.player.pitch = Math.atan2(t.y - p.y - 1.6, Math.hypot(t.x - p.x, t.z - p.z)); return true; })()`);
  log('transition', await state());
  await b.shot(`${out}/qilin-transition.jpg`);
  await step(3.5);

  // ── 二阶段：熔流轮转（换形后第一招）──
  for (let k = 0; k < 60; k++) {
    const st = JSON.parse(await state());
    if (st.flood && st.flood.q >= 0) break;
    await step(0.1);
  }
  const fl = JSON.parse(await state());
  log('phase2 flood', JSON.stringify(fl));
  if (fl.flood && fl.flood.q >= 0) {
    // 站在被淹的象限中线上（两条熔流带之间留着的路），看着一侧涨宽的渠和它外段尽头的殿墙
    await b.eval(`(() => {
      const c = window.__ctx, q = window.__qilin.boss, f = q.furnace, V = c.player.position.constructor;
      const qy = f.quadrantYaw(${fl.flood.q}), a = qy * Math.PI / 180;
      // 象限中线外段（石柱在 ±20°、13 m，站在 19 m 处看渠不被挡）
      const p = new V(f.center.x + Math.sin(a) * 19, f.center.y + 0.05, f.center.z + Math.cos(a) * 19);
      const t = f.point(f.channelYaws[${fl.flood.q}], 19);
      c.player.teleport(p, Math.atan2(-(t.x - p.x), -(t.z - p.z)));
      c.player.pitch = -0.32;
      return true;
    })()`);
  }
  await step(0.2);
  await b.shot(`${out}/qilin-phase2-flood.jpg`);

  // ── 二阶段：踏云俯冲三踏 → 落地喘息（胸口火心大亮）──
  await place(150, 16);
  for (let k = 0; k < 60; k++) {
    const st = JSON.parse(await state());
    if (!st.move && !st.transitioning) { await b.eval(`window.__qilin.forceMove('burn_dives')`); break; }
    await step(0.1);
  }
  for (let k = 0; k < 120; k++) {
    const st = JSON.parse(await state());
    if (st.move === 'burn_pant' && st.stage === 'active') break;
    await step(0.1);
  }
  await step(0.8);
  // 俯冲的冲击把玩家掀来掀去：站回它面前（朝殿心那一侧 10 m），看胸口火心
  await b.eval(`(() => {
    const c = window.__ctx, q = window.__qilin.boss, f = q.furnace, V = c.player.position.constructor, b = q.position;
    let dx = f.center.x - b.x, dz = f.center.z - b.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const p = new V(b.x + dx * 10, f.center.y + 0.05, b.z + dz * 10);
    const t = q.getBodyCenter(new V());
    c.player.teleport(p, Math.atan2(-(t.x - p.x), -(t.z - p.z)));
    c.player.pitch = Math.atan2(t.y - p.y - 1.6, Math.hypot(t.x - p.x, t.z - p.z));
    return true;
  })()`);
  await step(0.05);
  log('phase2 pant', await state());
  await b.shot(`${out}/qilin-phase2-pant.jpg`);
  await step(3);

  // ── 二阶段：15% 狂怒长啸（火浪从池边扫到殿墙）──
  await place(180, 17, '0, 5, 0');
  await b.eval('window.__qilin.setHealth(0.12)');
  for (let k = 0; k < 120; k++) {
    const st = JSON.parse(await state());
    if (st.move === 'burn_rage' && st.stage === 'active') break;
    await step(0.1);
  }
  await step(0.35);
  // 看着悬在熔池上空的焚身和扫过来的火浪
  await b.eval(`(() => { const c = window.__ctx, q = window.__qilin.boss, f = q.furnace, p = c.player.position; const t = q.getBodyCenter(f.center.clone()); t.y -= 2.5;
    c.player.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z)); c.player.pitch = Math.atan2(t.y - p.y - 1.6, Math.hypot(t.x - p.x, t.z - p.z)); return true; })()`);
  log('phase2 rage', await state());
  await b.shot(`${out}/qilin-phase2-rage.jpg`);
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 20)) log(e);
} finally {
  await b.close();
}
