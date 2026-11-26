// M10 实机核对（docs/threejs-migration.md 4.8）：一个无头浏览器进 1-1（?debug&dev&debugStage=1-1），逐帧推进游戏（Game.frame，固定步长），
// 逐把枪装备 / 按住开火 / 开镜 / 换弹（ctx.weapons.give(ctx.weapons.roll({ defId })) + 改写 ctx.input），碎刃三段斩 / 千刃出窍（剑指）/ 屏障（立掌）/ 杀气爆发（举手），
// 断言「打得出、换弹分段（弹匣入位就加弹）、枪模后坐 / 左手 / 弹匣动了、零报错」，截图拼成联系表。
//   [M10_ONLY=guns,blade] node scripts/web/m10-shots.mjs [端口=5722] [输出目录=docs/art/review/threejs-migration] [碎刃英雄，逗号分隔=fox,bear,falcon]
// 在 agent worktree 里跑要给 vite 放行主检出的 node_modules（见 scripts/web/ui2-shots.mjs 头注释）。
import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5722';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const bladeHeroes = (process.argv[4] ?? 'fox,bear,falcon').split(',');
const only = process.env.M10_ONLY ? new Set(process.env.M10_ONLY.split(',')) : null;
const want = k => !only || only.has(k);
const log = (...a) => console.log('[m10]', ...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  log(ok ? '✔' : '✖', name, detail);
};
mkdirSync(out, { recursive: true });

let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch { log('Chromium 没起来，重试', k + 1); }
}
if (!b) throw new Error('Chromium 起不来');

const step = s => b.eval(`window.__step(${s})`);
const errorsSince = start => b.logs.slice(start).filter(l => /error|Error|TypeError|undefined is not|\[exception\]/.test(l) && !/favicon|DevTools|\[assets\]|net::ERR|load texture blob:/.test(l));

async function enter(hero) {
  const start = b.logs.length;
  await Promise.race([b.goto(`http://127.0.0.1:${port}/?debug&dev&debugStage=1-1`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  for (let k = 0; k < 1200 && !b.logs.slice(start).some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  await b.eval(`(() => {
    const g = window.__game, c = window.__ctx;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    const held = new Set(), tap = new Set();
    const down = c.input.down.bind(c.input), pressed = c.input.pressed.bind(c.input);
    c.input.enabled = true;
    c.input.down = a => held.has(a) || tap.has(a) || down(a);
    c.input.pressed = a => { if (tap.has(a)) { tap.delete(a); return true; } return pressed(a); };
    window.__keys = { held, tap };
    window.__events = { fired: 0, reloaded: 0 };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(${JSON.stringify(hero)}), true`);
  for (let k = 0; k < 600; k++) {
    await step(0.1);
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await step(1.5);
  await b.eval(`(() => {
    const c = window.__ctx;
    c.input.enabled = true;
    // 上下文丢了又被浏览器恢复时 isContextLost() 又是 false，但 three 的缓冲 / 贴图没了（整片白）：按事件计数
    window.__lost = 0;
    c.renderer.domElement.addEventListener('webglcontextlost', () => window.__lost++);
    c.events.on('weapon:fired', () => window.__events.fired++);
    c.events.on('weapon:reloaded', () => window.__events.reloaded++);
    return true;
  })()`);
  return start;
}

const god = () => b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`);
const hold = (a, on = true) => b.eval(`window.__keys.held[${on ? '"add"' : '"delete"'}](${JSON.stringify(a)}), true`);
const tap = a => b.eval(`window.__keys.tap.add(${JSON.stringify(a)}), true`);
const foes = (defId, n, dist) => b.eval(`(() => {
  const c = window.__ctx, p = c.player, V = p.position.constructor;
  const f = p.getForward(new V()), r = new V(f.z, 0, -f.x);
  let k = 0;
  for (let i = 0; i < ${n}; i++) {
    const s = (i - (${n} - 1) / 2) * 1.6;
    const x = p.position.x + f.x * ${dist} + r.x * s, z = p.position.z + f.z * ${dist} + r.z * s;
    if (c.enemies.spawn(${JSON.stringify(defId)}, { position: new V(x, c.world.groundHeight(x, z, p.position.y + 3, 0.3), z) })) k++;
  }
  return k;
})()`);
const clearFoes = () => b.eval(`(() => { const c = window.__ctx; for (const e of [...c.enemies.list]) if (e.alive) c.combat.damageEnemy(e, { base: 1e7, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] }); return true; })()`);
const give = (id, rarity = 2) => b.eval(`(() => { const w = window.__ctx.weapons; const inst = w.roll({ defId: ${JSON.stringify(id)}, rarity: ${rarity} }); w.give(inst); return inst.mag; })()`);
const level = () => b.eval(`(() => {
  const p = window.__ctx.player;
  window.__home ??= { pos: p.position.clone(), yaw: p.yaw };
  p.teleport(window.__home.pos.clone(), window.__home.yaw);
  p.pitch = -0.04; p.velocity.set(0, 0, 0);
  window.__step(0.1);
  return true;
})()`);
/** 按帧推进直到条件成立（页面里跑，省掉往返）；返回过程里每帧的读数 */
const stepUntil = (cond, maxSeconds, sample = 'null') => b.eval(`(() => {
  const ws = window.__ctx.weapons, vm = ws.vm;
  const rows = [];
  for (let i = 0, n = Math.round(${maxSeconds} * 60); i < n; i++) {
    window.__step(1 / 60);
    const r = ${sample};
    if (r) rows.push(r);
    if (${cond}) return { ok: true, rows };
  }
  return { ok: ${cond}, rows };
})()`);

/** 截图 → 缩到 w×h 放进联系表的一格（页面里用 2D canvas 拼，不需要本地图像库） */
const tiles = {};
async function tile(sheet, label) {
  const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  (tiles[sheet] ??= []).push({ label, data: r.data });
}
async function writeSheet(sheet, cols = 4, w = 480, h = 270) {
  const list = tiles[sheet] ?? [];
  if (!list.length) return;
  const json = JSON.stringify(list);
  const dataUrl = await b.eval(`(async () => {
    const list = ${json};
    const cols = ${cols}, w = ${w}, h = ${h}, rows = Math.ceil(list.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * w; cv.height = rows * h;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < list.length; i++) {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + list[i].data;
      await img.decode();
      const x = (i % cols) * w, y = Math.floor(i / cols) * h;
      g.drawImage(img, x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y, w, 24);
      g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(list[i].label, x + 8, y + 17);
      g.strokeStyle = '#000'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    return cv.toDataURL('image/jpeg', 0.86);
  })()`);
  const path = `${out}/m10-${sheet}.jpg`;
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  log('写出', path, `${list.length} 格`);
}

const vmDebug = `(() => { const d = window.__ctx.weapons.vm.debug(); return d; })()`;

// ───────────── 逐把枪 ─────────────

/** 无头浏览器在别的会话也占着显卡时偶尔丢 WebGL 上下文（画面整片白）：这一把作废、重进关卡再来一次（最多 3 次），白屏不进联系表 */
const contextLost = () => b.eval('(window.__lost ?? 0) > 0 || window.__ctx.renderer.getContext().isContextLost()').catch(() => true);
/** 截图画面中部（避开 HUD）近白像素的比例：上下文丢失 / 恢复后整片白，这种截图不算数 */
const whiteFrac = data => b.eval(`(async () => {
  const img = new Image();
  img.src = 'data:image/jpeg;base64,${data}';
  await img.decode();
  const w = 160, h = 90, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, Math.round(h * 0.15), w, Math.round(h * 0.6)).data;
  let white = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235) white++;
  return white / (px.length / 4);
})()`);
let contextLosses = 0;

/** 一把枪：装备 / 开火 / 开镜 / 换弹；check 与截图先记在本地，上下文没丢才算数 */
async function runGun(id, check, tile) {
  await clearFoes();
  await level();
  await foes('jerboa_blade', 2, 9);
  await god();
  await give(id);
  await step(0.8);
  const info = await b.eval(`(() => { const ws = window.__ctx.weapons; const vm = ws.vm; const e = vm.cur; return {
    shown: vm.root.visible, original: !!e?.original, recoil: !!e?.recoil, hasLeft: !!e?.leftArm, weight: vm.debug().weight }; })()`);
  check(`${id} 装备`, info.shown, `原版枪 ${info.original}，原版后坐运动 ${info.recoil}，左手 ${info.hasLeft}，枪重 ${info.weight}`);

  // 开火：按住 1.2 s（蓄力武器到时松手），记枪模后坐峰值；在后坐最大附近截一张
  const fired0 = await b.eval('window.__events.fired');
  await hold('fire');
  const fire = await stepUntil('false', 0.35, `(() => { const d = vm.debug(); return [d.kickBack, d.kickRot]; })()`);
  await tile('fire', `${id} 开火`);
  const fire2 = await stepUntil('false', 0.85, `(() => { const d = vm.debug(); return [d.kickBack, d.kickRot]; })()`);
  await hold('fire', false);
  await step(0.3);
  const rows = [...fire.rows, ...fire2.rows];
  const kickRot = Math.max(...rows.map(r => r[1]));
  const fired = (await b.eval('window.__events.fired')) - fired0;
  // 有原版后坐运动（GunfireOriginalMotion）的枪不叠枪模弹簧后坐（Unity WeaponController.Feedback 同样）
  check(`${id} 开火`, fired > 0 && (info.recoil || kickRot > 0.004 || id === 'beam' || id === 'flamer'), `开火 ${fired} 次，枪模上抬峰值 ${kickRot.toFixed(3)} rad${info.recoil ? '（原版后坐运动）' : ''}`);

  // 开镜
  await hold('aim');
  await step(0.45);
  const aimT = await b.eval('window.__ctx.weapons.vmState.aimT');
  await tile('aim', `${id} 开镜 ${aimT.toFixed(2)}`);
  await hold('aim', false);
  await step(0.4);
  check(`${id} 开镜`, aimT > 0.95, `开镜程度 ${aimT.toFixed(2)}`);

  // 换弹：弹匣留 1 发，按 R；整匣换弹看弹匣入位那一刻是否加弹（第一人称左手的动画事件），逐发装填看每发
  const cap = await b.eval(`(() => { const ws = window.__ctx.weapons, w = ws.active; w.mag = Math.min(1, w.mag); w.reserve = ws.reserveCapacity(w); return ws.magCapacity(w); })()`);
  const reloaded0 = await b.eval('window.__events.reloaded');
  await tap('reload');
  const r1 = await stepUntil('ws.reloadProgress >= 0.45 || !ws.isReloading', 6,
    `(() => { const d = vm.debug(); return [ws.reloadProgress, ws.active.mag, d.magOut, d.handOffset, d.forearmSwing, d.reloadTilt, d.shellTilt]; })()`);
  await tile('reload', `${id} 换弹 ${(await b.eval('window.__ctx.weapons.reloadProgress')).toFixed(2)}`);
  const r2 = await stepUntil('!ws.isReloading', 8,
    `(() => { const d = vm.debug(); return [ws.reloadProgress, ws.active.mag, d.magOut, d.handOffset, d.forearmSwing, d.reloadTilt, d.shellTilt]; })()`);
  const rr = [...r1.rows, ...r2.rows];
  const endMag = await b.eval('window.__ctx.weapons.active.mag');
  const shell = await b.eval(`(() => { const d = window.__ctx.weapons.active; return (${JSON.stringify(id)} === 'shotgun' || ${JSON.stringify(id)} === 'magmashot'); })()`);
  const jump = rr.findIndex((r, i) => i > 0 && r[1] > rr[i - 1][1]);
  const jumpP = jump >= 0 ? rr[jump][0] : -1;
  const magMax = Math.max(...rr.map(r => r[2])), handMax = Math.max(...rr.map(r => r[3])), swingMax = Math.max(...rr.map(r => r[4]));
  const tiltMax = Math.max(...rr.map(r => Math.max(r[5], r[6])));
  const reloadedEvents = (await b.eval('window.__events.reloaded')) - reloaded0;
  let ok = r2.ok && endMag === cap && reloadedEvents === 1;
  let detail = `进度 ${jumpP.toFixed(2)} 时弹药跳上去，换完 ${endMag}/${cap}`;
  if (!info.original) {
    ok &&= tiltMax > 0.5;
    detail += `，换弹姿态 ${tiltMax.toFixed(2)}`;
    if (info.hasLeft) {
      ok &&= handMax > 0.03;
      detail += `，左手离握点 ${(handMax * 100).toFixed(1)} cm、前臂摆 ${swingMax.toFixed(1)}°`;
      // 整匣：弹匣入位（loadAt 0.78）那一刻就加弹，换弹动作还在收尾
      if (!shell) { ok &&= jumpP > 0.7 && jumpP < 0.9; detail += '（弹匣入位加弹）'; }
    }
    if (!shell && !['revolver', 'trinity', 'stormpod', 'launcher'].includes(id)) { ok &&= magMax > 0.5; detail += `，弹匣离位 ${magMax.toFixed(2)}`; }
  }
  check(`${id} 换弹`, ok, detail);
  await step(0.3);
}

if (want('guns')) {
  log('══ 枪（fox）');
  let start = await enter('fox');
  const setup = async () => { await b.eval('window.__home = undefined, true'); await god(); await level(); };
  await setup();
  const ids = (await b.eval(`window.__ctx.weapons.allDefIds()`)).filter(id => id !== 'demon_blade');
  const errs = [];
  for (const id of ids) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const local = [], localTiles = [];
      const from = b.logs.length;
      await runGun(id, (name, ok, detail = '') => local.push({ name, ok, detail }), async (sheet, label) => {
        const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
        localTiles.push({ sheet, label, data: r.data });
      });
      let white = 0;
      for (const t of localTiles) white = Math.max(white, await whiteFrac(t.data));
      const nan = await b.eval(`(() => { let n = 0; window.__ctx.weapons.vm.root.traverse(o => { if (o.matrixWorld.elements.some(v => !Number.isFinite(v))) n++; });
        return n + (window.__ctx.camera.matrixWorld.elements.some(v => !Number.isFinite(v)) ? 1000 : 0); })()`);
      check(`${id} 姿态数值`, nan === 0, nan ? `${nan} 个节点矩阵非有限值` : '');
      if (await contextLost() || white > 0.9) {
        contextLosses++;
        log('⚠', id, `WebGL 上下文丢失（截图近白 ${(white * 100).toFixed(0)}%），重进关卡再来一次`);
        start = await enter('fox');
        await setup();
        continue;
      }
      for (const r of local) check(r.name, r.ok, r.detail);
      for (const t of localTiles) (tiles[t.sheet] ??= []).push({ label: t.label, data: t.data });
      errs.push(...errorsSince(from));
      break;
    }
  }
  check('枪：WebGL 上下文', contextLosses < 3, `丢失 ${contextLosses} 次（作废重来）`);
  // 三才转轮：开枪换元素时灵纹亮闪
  const triFrom = b.logs.length;
  await give('trinity');
  await step(0.8);
  const triStart = await b.eval(vmDebug);
  await hold('fire');
  const tri = await stepUntil('false', 0.6, `(() => { const d = vm.debug(); return [d.glowElement, d.glowFlash]; })()`);
  await hold('fire', false);
  const flashes = tri.rows.filter((r, i) => r[0] !== (i > 0 ? tri.rows[i - 1][0] : triStart.glowElement)).length;
  check('三才转轮换元素亮闪', flashes >= 1 && Math.max(...tri.rows.map(r => r[1])) > 0.5, `元素换了 ${flashes} 次，亮闪峰值 ${Math.max(...tri.rows.map(r => r[1])).toFixed(2)}`);
  if (!(await contextLost())) errs.push(...errorsSince(triFrom));
  check('枪：页面报错', errs.length === 0, errs.slice(0, 5).join(' | '));
  for (const s of ['fire', 'aim', 'reload']) await writeSheet(s);
}

// ───────────── 碎刃 ─────────────

if (want('blade')) {
  for (const hero of bladeHeroes) {
    log('══ 碎刃', hero);
    const start = await enter(hero);
    await b.eval('window.__home = undefined, true');
    await god();
    await level();
    await give('demon_blade', 3);
    await step(0.8);
    await clearFoes();
    await foes('jerboa_blade', 3, 2.6);
    await god();
    await step(0.2);
    if (hero === bladeHeroes[0]) {
      // 三段斩：每段在判定帧之后两帧截一张（刀光、刃口白热一闪）
      const strikes0 = await b.eval('window.__ctx.weapons.vm.bladeView().strikeEvents');
      await hold('fire');
      for (let seg = 0; seg < 3; seg++) {
        const r = await stepUntil(`(() => { const v = vm.bladeView(), p = ws.blade.pose; return p.swing === ${seg} && v.visualProgress >= p.hitP + 0.04; })()`, 3);
        await tile('blade', `第 ${seg + 1} 段 判定帧后`);
        if (seg === 2) await b.shot(`${out}/m10-blade-slash3.jpg`);
        check(`碎刃第 ${seg + 1} 段`, r.ok);
      }
      await hold('fire', false);
      await step(0.6);
      const strikes = (await b.eval('window.__ctx.weapons.vm.bladeView().strikeEvents')) - strikes0;
      check('判定帧事件', strikes >= 3, `${strikes} 次`);
      // 屏障（立掌）
      await hold('reload');
      await step(0.6);
      await tile('blade', '碎刃屏障（立掌）');
      await hold('reload', false);
      await step(0.8);
      // 杀气爆发（举手 → 剑指）
      await tap('weaponSkill');
      await step(0.25);
      await tile('blade', '杀气爆发 聚合（举手）');
      await step(1.5);
    }
    // 千刃出窍（剑指：补两根手指，指尖灵光）：先清场，别让近身的敌人挡住左手
    await clearFoes();
    await step(0.6);
    await clearFoes();
    await hold('aim');
    await step(0.8);
    const sign = await b.eval('(() => { const v = window.__ctx.weapons.vm.bladeView(); return { shown: v.swordSignShown, left: v.leftHandWeight }; })()');
    await tile('blade', `千刃出窍 剑指（${hero}）`);
    if (hero === bladeHeroes[0]) await b.shot(`${out}/m10-blade-point.jpg`);
    await hold('aim', false);
    await step(1.2);
    check(`剑指手指（${hero}）`, sign.shown && sign.left > 0.9, `左手 ${sign.left.toFixed(2)}`);
    check(`碎刃（${hero}）：WebGL 上下文`, !(await contextLost()), '丢了就是白屏截图，重跑');
    let white = 0;
    for (const t of tiles.blade ?? []) white = Math.max(white, await whiteFrac(t.data));
    check(`碎刃（${hero}）：截图不是白屏`, white < 0.9, `画面中部近白 ${(white * 100).toFixed(0)}%`);
    const errs = errorsSince(start);
    check(`碎刃（${hero}）：页面报错`, errs.length === 0, errs.slice(0, 5).join(' | '));
  }
  await writeSheet('blade', 3, 640, 360);
}

await b.close();
// 无头 Chromium 的一次性配置目录（每个约 400 MB）：cdp.mjs 不删的版本里在这里兜底
for (let k = 0; k < 20; k++) {
  await new Promise(r => setTimeout(r, 500));
  const left = readdirSync(tmpdir()).filter(d => d.startsWith(`ch4-cdp-${process.pid}-`));
  if (!left.length) break;
  for (const d of left) { try { rmSync(join(tmpdir(), d), { recursive: true, force: true }); } catch { /* Chromium 还没退干净，等一下再删 */ } }
}
const bad = results.filter(r => !r.ok);
log(`${results.length - bad.length} / ${results.length} 通过`);
if (bad.length) {
  for (const r of bad) log('✖', r.name, r.detail);
  process.exitCode = 1;
}
