// M12 第二期实机核对：逐个刷普通敌人，看片段播放器（src/anim/ClipPlayer）有没有接上、各 AI 状态播的是哪个片段，
// 每只拍四格（待机 / 移动 → 出招 → 受击 → 死亡）拼成一行，四只一张图。逐帧推进游戏（Game.frame 固定步长，不靠后台标签页的 rAF）。
//   node scripts/anim/enemy-clip-shots.mjs [端口=5684] [关卡=1-1] [名字=ch1] [敌人 id 逗号分隔] [输出目录=docs/art/review/threejs-migration]
// 输出：<目录>/m12-<名字>-<n>.jpg，控制台打印每只的「AI 状态 → 片段状态」对照、没接上片段的、页面报错。
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5684';
const stage = process.argv[3] ?? '1-1';
const name = process.argv[4] ?? 'ch1';
const ids = (process.argv[5] ?? 'jerboa_blade,scorpion_archer,fire_rat,mirage_toad,tomb_beast,apsara').split(',').filter(Boolean);
const out = process.argv[6] ?? 'docs/art/review/threejs-migration';
const log = (...a) => console.log('[m12]', ...a);

let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch { log('Chromium 没起来，重试', k + 1); }
}
if (!b) throw new Error('Chromium 起不来');

try {
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=${stage}`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  for (let k = 0; k < 2400 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
  await b.eval(`(() => {
    const g = window.__game;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    // 四格拼图：每格 480×270
    const sheet = document.createElement('canvas');
    sheet.width = 1920; sheet.height = 1080;
    window.__sheet = sheet;
    window.__sheetClear = () => { const x = sheet.getContext('2d'); x.fillStyle = '#111'; x.fillRect(0, 0, sheet.width, sheet.height); };
    window.__sheetClear();
    /** 把玩家摆到敌人面前 dist 米看着它，出一帧，画进第 row 行第 col 格，左上角写字 */
    window.__panel = (e, row, col, label, dist) => {
      const c = window.__ctx, p = c.player, V = p.position.constructor;
      const ex = e.position.x, ez = e.position.z;
      let dx = p.position.x - ex, dz = p.position.z - ez;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // 稍微偏到侧前方，看得出四肢
      const a = 0.6, cx = dx * Math.cos(a) - dz * Math.sin(a), cz = dx * Math.sin(a) + dz * Math.cos(a);
      const px = ex + cx * dist, pz = ez + cz * dist;
      const gy = c.world.groundHeight(px, pz, e.position.y + 3, 0.3);
      p.teleport(new V(px, (Number.isFinite(gy) ? gy : e.position.y) + 0.05, pz));
      const eye = p.eye, h = (e.def?.height ?? 1.6) * (e.root?.scale?.y ?? 1) * 0.55;
      const ddx = ex - eye.x, ddz = ez - eye.z, ddy = e.position.y + h - eye.y;
      p.yaw = Math.atan2(-ddx, -ddz);
      p.pitch = Math.atan2(ddy, Math.hypot(ddx, ddz));
      window.__step(1 / 240, 1 / 240);
      const x = sheet.getContext('2d');
      x.drawImage(c.renderer.domElement, col * 480, row * 270, 480, 270);
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(col * 480, row * 270, 480, 22);
      x.fillStyle = '#fff'; x.font = '14px sans-serif'; x.fillText(label, col * 480 + 6, row * 270 + 16);
      return true;
    };
    window.__probe = (e) => {
      const cp = e.clips ?? e.foe?.clips ?? null;
      const foe = e.foe ?? null;
      // 关卡自己刷出来的别的怪：直接撤掉，免得抢出手名额、挡镜头
      for (const o of window.__ctx.enemies.list) if (o !== e && !o.removed && !(o.def?.id ?? '').endsWith('_decoy') && o.owner !== e && o.summoner !== e) { try { o.removed = true; } catch {} }
      if (cp?.ready) e.__everReady = true;
      return {
        ever: !!e.__everReady,
        alive: e.alive, ai: foe ? (foe.move?.id || foe.posture || foe.state) : e.state,
        ready: cp ? cp.ready : null, clip: cp ? cp.state : null, has: !!cp,
        native: !!(e.nativeBody ?? foe?.body),
      };
    };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  for (let k = 0; k < 400; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'), stage);
  await b.eval('window.__step(1.5)');
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  const home = await b.eval(`(() => { const p = window.__ctx.player.position; window.__home = p.clone(); return p.toArray().map(v => +v.toFixed(1)); })()`);
  log('玩家出生点', home);

  const summary = [];
  let row = 0, sheetNo = 1;
  const flush = async () => {
    const url = await b.eval(`window.__sheet.toDataURL('image/jpeg', 0.86)`);
    mkdirSync(out, { recursive: true });
    const path = `${out}/m12-${name}-${sheetNo}.jpg`;
    writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
    log('截图', path);
    sheetNo++; row = 0;
    await b.eval('window.__sheetClear(), true');
  };

  for (const id of ids) {
    // 清场，玩家回出生点，在前方 9 m 刷一只
    const spawned = await b.eval(`(() => {
      const c = window.__ctx, p = c.player, V = p.position.constructor;
      c.enemies.killAll?.(); c.enemies.clear?.();
      p.teleport(window.__home.clone());
      const yaw = p.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let e = null;
      for (const d of [9, 7, 12, 5]) for (const s of [0, 0.6, -0.6, 1.2, -1.2, 2.2, -2.2, 3.14]) {
        const x = p.position.x + Math.sin(yaw + Math.PI + s) * d, z = p.position.z + Math.cos(yaw + Math.PI + s) * d;
        const y = c.world.groundHeight(x, z, p.position.y + 3, 0.3);
        if (!Number.isFinite(y) || Math.abs(y - p.position.y) > 2.5) continue;
        e = c.enemies.spawn('${id}', { position: new V(x, y, z), level: 1 });
        if (e) break;
      }
      window.__e = e;
      return e ? { pos: e.position.toArray().map(v => +v.toFixed(1)), cls: e.constructor.name } : null;
    })()`);
    if (!spawned) { summary.push({ id, error: '没刷出来' }); log(id, '没刷出来'); continue; }
    await b.eval(god);
    const pairs = new Map();
    const note = async () => {
      const s = await b.eval('JSON.stringify(window.__probe(window.__e))');
      const o = JSON.parse(s);
      const key = `${o.ai}→${o.clip}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
      return o;
    };
    const dist = await b.eval(`Math.max(2.4, (window.__e.def?.height ?? 1.6) * (window.__e.root?.scale?.y ?? 1) * 1.9)`);
    // 出生淡入 → 待机 / 移动
    await b.eval('window.__step(1.1)');
    let o = await note();
    await b.eval(`window.__panel(window.__e, ${row}, 0, ${JSON.stringify(`${id}: ${o.ai} / ${o.clip}`)}, ${dist})`);
    // 等它出招：最多 14 s，第一次进入非移动类状态后 0.3 s 拍一张
    const calm = new Set(['idle', 'chase', 'move', 'advance', 'march', 'hover', 'drift', 'stalk', 'run', 'dance', 'circle', 'perch', 'perched', 'swim', 'alert', 'spawn', 'enter', 'roam', '']);
    let shotAttack = false;
    for (let k = 0; k < 140; k++) {
      await b.eval('window.__step(0.1)');
      await b.eval(god);
      o = await note();
      if (!shotAttack && o.alive && !calm.has(String(o.ai))) {
        await b.eval('window.__step(0.25)');
        o = await note();
        await b.eval(`window.__panel(window.__e, ${row}, 1, ${JSON.stringify(`${o.ai} / ${o.clip}`)}, ${dist})`);
        shotAttack = true;
      }
      if (shotAttack && k > 60) break;
    }
    if (!shotAttack) await b.eval(`window.__panel(window.__e, ${row}, 1, ${JSON.stringify(`(没出招) ${o.ai} / ${o.clip}`)}, ${dist})`);
    // 受击：打掉 20% 生命（过 12% 触发叠加层 Flinch）
    await b.eval(`(() => { const c = window.__ctx, e = window.__e; if (!e.alive) return false;
      c.combat.damageEnemy(e, { base: e.maxHp * 0.2, element: 'none', source: 'weapon', canCrit: false, direction: e.position.clone().sub(c.player.position).setY(0).normalize() }); return true; })()`);
    await b.eval('window.__step(0.12)');
    o = await note();
    await b.eval(`window.__panel(window.__e, ${row}, 2, ${JSON.stringify(`受击 ${o.ai} / ${o.clip}`)}, ${dist})`);
    await b.eval('window.__step(0.6)');
    await note();
    // 死亡
    await b.eval(`(() => { const c = window.__ctx, e = window.__e; if (!e.alive) return false;
      c.combat.damageEnemy(e, { base: 1e7, element: 'none', source: 'status', canCrit: false }); return true; })()`);
    await b.eval('window.__step(0.45)');
    o = await note();
    await b.eval(`window.__panel(window.__e, ${row}, 3, ${JSON.stringify(`死亡 ${o.ai} / ${o.clip}`)}, ${dist})`);
    summary.push({ id, cls: spawned.cls, ready: o.ever, pairs: [...pairs.keys()] });
    log(id, spawned.cls, 'ready', o.ever, '\n     ', [...pairs.keys()].join('  '));
    row++;
    if (row === 4) await flush();
  }
  if (row > 0) await flush();
  const errors = b.logs.filter(l => /^\[(error|exception)\]/.test(l));
  const warns = b.logs.filter(l => /\[anim\]/.test(l));
  log('页面报错', errors.length, errors.slice(0, 12));
  log('动画警告', warns.length, warns.slice(0, 12));
  log('没接上片段', summary.filter(s => !s.ready).map(s => s.id));
} finally {
  await b.close();
}
