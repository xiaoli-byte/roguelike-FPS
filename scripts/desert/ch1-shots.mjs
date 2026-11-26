// 第一章五张图（1-1 / 1-2 / 1-3 / 1-4 / 1-A）的游戏画面截图：同一份机位拍几轮，前后对照（docs/art/level-art.md：用玩家视角验收）。
// 重做版（网址 redo=1）的机位由 scripts/desert/redo-poses.mjs 生成，和白盒检视页、构图概念图同机位：
//
//   node scripts/desert/redo-poses.mjs
//   CH1_QUERY='&redo=1' CH1_FOES=0 CH1_ASSETS=0 node scripts/desert/ch1-shots.mjs 5199 docs/art/concepts/ch1-routes/game/<轮次> docs/art/concepts/ch1-routes/game/poses.json [只拍的图，逗号分隔]
//   python docs/art/concepts/ch1-routes/tools/make_game_sheets.py game/<上一轮> game/<这一轮>    （构图概念图 | 上一轮 | 这一轮 对照页）
//
// 机位 JSON：{ "1-1": [{ name, eye:[x,y,z], lookAt:[x,y,z], encounter?: bool, why? }...] }（网页世界坐标；以 "_" 开头的键忽略）。
// 每个机位：
//   · 玩家机位：玩家传送到 eye 脚下（eye.y − 1.62；脚下的地面 / 碰撞面高于它就站到面上），推 2.5 s（中间等真实时间让贴图 / 着色器到齐），
//     再按实际眼位把朝向 / 俯仰对准 lookAt，拍 1280×720 JPEG（带枪，和玩家看到的一样；CH1_GUN=0 不画枪）。
//   · 俯瞰机位（eye 离地 > 20 m）：玩家站到 lookAt 脚下，接管相机（PlayerController.updateCamera 换成空函数，相机直接放到 eye 看 lookAt），不画枪；
//     雾（120–260 m 线性 + 空气透视）会把俯瞰洗成一片，另拍一张关雾的 -nofog 看布局（CH1_NOFOG=0 不拍）。
//   · 遭遇机位（encounter: true，或名字带「据点 / site / 进场 / 首领场」）：先拍空场，再在 lookAt 附近刷 4 只本章敌人（跳鼠刀兵 ×2、蝎尾弩卫、蜃楼蟾），
//     推 1 s 再拍一张 -foes（查「敌人能不能从背景里跳出来」），拍完清掉。
//   · 每张图另出一张宽 320 的去色缩略图 <图>-<机位>-gray.jpg；每张图一张拼图 <图>-sheet.jpg 和去色拼图 <图>-sheet-gray.jpg。
// 为了前后对照可复现：开局后关掉据点触发 / 波次 / 支路发现、清掉场上的怪，区域天气（1-1 沙暴）每个机位前强制回到平静。
// 记录写到 <输出目录>/shots.json：每张图的载入耗时、控制台报错、每个机位的实际眼位 / 修正 / 视线遮挡 / 帧时间 / 绘制调用。
// 全程只开一个 Chromium，几张图在同一个标签页里轮流载入（中间先回 about:blank）；页面卡死时杀掉重起一个、这张图重拍一次；
// 结束时把这个进程起过的 Chromium 全部杀掉（同 post-shots.mjs）。
// 环境变量：CH1_POSE=<正则> 只补拍名字匹配的机位（拼图按目录里现有的截图重拼，shots.json 里其它机位的记录保留）；CH1_SETTLE=<秒> 每个机位推进的时长（缺省 2.5）；CH1_FOES=0 不刷怪；CH1_GUN=0 不画枪；CH1_NOFOG=0 俯瞰不加拍关雾图。
// CH1_ASSETS=0 不等美术资产库：AssetLibrary 在后台读约 350 件角色 / 首领 / 道具 / 枪模 GLB（开发服务器上 1–4 分钟），
//   Game.startRun 开局前会 await AssetLibrary.preload()。这时不再等「[assets] 已加载」，开局前把页面里那份 AssetLibrary 的
//   ready 换成已完成的 Promise（按页面实际载入的模块地址 import 同一个实例），开局只等场景本身。后台照样在读，读到一半时
//   刷出来的怪 / 第一人称枪模可能还是程序化占位体（看场景 / 光影够用；看怪和枪别用，最好配 CH1_FOES=0）。
//   场景件（UnityLevelLibrary 的网格 / 贴图）不走资产库，不受影响。
// CH1_HMR=1 保留 Vite 热更新。缺省掐掉：别的会话改 src/ 时 Vite 会整页刷新，长时间的载入 / 开局会被中途刷掉；
//   掐掉后每张图用的是打开页面那一刻的代码（每张图都重新开页，改了的代码下一张图就生效）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5199';
const out = process.argv[3] ?? 'docs/art/concepts/ch1-routes/game/latest';
const posesPath = process.argv[4] ?? 'docs/art/concepts/ch1-routes/game/poses.json';
const only = process.argv[5] ? new Set(process.argv[5].split(',').map(s => s.trim()).filter(Boolean)) : null;
const poseFilter = process.env.CH1_POSE ? new RegExp(process.env.CH1_POSE) : null;
const SETTLE = Number(process.env.CH1_SETTLE ?? 2.5);
const GUN = process.env.CH1_GUN !== '0';
const FOES = process.env.CH1_FOES !== '0';
const NOFOG = process.env.CH1_NOFOG !== '0';
const ASSETS = process.env.CH1_ASSETS !== '0';
const HMR = process.env.CH1_HMR === '1';
// 额外的网址参数（如 '&desert=0' 看 Unity 原样、'&desertDemo=farLayer' 叠一个演示模块）
const QUERY = process.env.CH1_QUERY ?? '';
const OVERHEAD_AGL = 20;
const FOE_IDS = ['jerboa_blade', 'scorpion_archer', 'jerboa_blade', 'mirage_toad'];
const log = (...a) => console.log('[ch1-shots]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

const poses = JSON.parse(readFileSync(posesPath, 'utf8').replace(/^﻿/, ''));
const maps = Object.keys(poses).filter(k => !k.startsWith('_') && Array.isArray(poses[k]) && (!only || only.has(k)));
if (maps.length === 0) throw new Error(`机位文件里没有要拍的图：${posesPath}${only ? `（只拍 ${[...only].join(',')}）` : ''}`);
mkdirSync(out, { recursive: true });

/** 文件名：两位序号 + 名字（去掉开头编号、括号里的说明和文件名不能用的字符，最多 18 个字） */
function slug(name, i) {
  let s = String(name ?? '').replace(/^\d+\s*/, '').replace(/（[^）]*）|\([^)]*\)/g, '');
  s = s.replace(/[\\/:*?"<>|]/g, ' ').replace(/[\s·•・→「」，,。、]+/g, '-').replace(/^-+|-+$/g, '');
  return `${String(i + 1).padStart(2, '0')}${s ? '-' + [...s].slice(0, 18).join('') : ''}`;
}
const isEncounter = p => p.encounter === true || (p.encounter !== false && /据点|site|进场|首领场/i.test(p.name ?? ''));

/** 杀掉本进程起的 Chromium（cdp.mjs 的配置目录名是 ch4-cdp-<pid>-<端口>） */
function killStrays() {
  if (process.platform !== 'win32') return;
  const filter = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'ch4-cdp-${process.pid}-' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell', ['-NoProfile', '-Command', filter], { stdio: 'ignore' });
}

// 页面里的工具：固定步长推帧（rAF 停掉，免得真实帧插进来）、帧时间、摆机位、刷怪、去色缩略图和拼图
const PAGE_TOOLS = `(() => {
  const g = window.__game, c = window.__ctx, V = c.player.position.constructor;
  window.requestAnimationFrame = () => 0;
  window.__step = (seconds, dt = 1 / 60) => {
    let t = window.__simT ?? performance.now();
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
    window.__simT = t;
  };
  window.__timeFrames = (n) => {
    const gl = c.renderer.getContext(), px = new Uint8Array(4), ms = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      window.__step(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const r = v => Math.round(v * 10) / 10;
    // 一整帧（含后处理各遍）的绘制调用 / 三角形：关掉自动清零，手动清一次再推一帧
    const info = c.renderer.info, auto = info.autoReset;
    info.autoReset = false; info.reset();
    window.__step(1 / 60);
    const calls = info.render.calls, triangles = info.render.triangles;
    info.autoReset = auto;
    return { median: r(ms[Math.floor(ms.length / 2)]), mean: r(ms.reduce((s, v) => s + v, 0) / ms.length), p90: r(ms[Math.floor(ms.length * 0.9)]), calls, triangles };
  };
  const EYE = 1.62, w = c.world;
  const terrainAt = (x, z) => { try { return w.highestTerrain(x, z); } catch { return -Infinity; } };
  const r2 = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const aimFrom = (e, L) => { const dx = L[0] - e.x, dy = L[1] - e.y, dz = L[2] - e.z; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
  /** 场上的怪、据点、波次、支路发现都关掉；天气回到平静 */
  window.__quiet = () => {
    const s = c.stage;
    s.updateEncounters = () => {};
    s.discoverSites = () => {};
    try { s.waves?.cancel?.(); } catch {}
    try { s.encounterWaves?.cancel?.(); } catch {}
    s.waves = null; s.encounterWaves = null;
    if (c.enemies.list.length) c.enemies.clear();
    c.projectiles.clear?.();
    const m = window.__mechanisms;
    for (const r of m?.weather?.regions ?? []) { try { r.force('calm', 0); } catch {} }
    c.player.invulnerableTime = 1e9; c.player.hp = c.player.maxHp();
    return true;
  };
  /** 摆机位：返回实际用的脚底 / 修正说明；俯瞰机位接管相机 */
  window.__pose = (eye, lookAt, gun) => {
    const p = c.player, notes = [];
    delete p.updateCamera;
    const under = w.groundHeight(eye[0], eye[2], 400, 0.3);
    const agl = eye[1] - (Number.isFinite(under) ? under : -1e9);
    if (agl > ${OVERHEAD_AGL}) {
      // 俯瞰：玩家站到看点脚下（离边界远，风沙 / 软边界不进画面），相机自己摆
      const q = new V(lookAt[0], lookAt[1], lookAt[2]), at = q.clone();
      if (!c.nav.nearestWalkable(q, at)) at.copy(q);
      const gy = w.groundHeight(at.x, at.z, at.y + 3, 0.3);
      if (Number.isFinite(gy)) at.y = gy;
      p.teleport(at.clone().setY(at.y + 0.02), 0);
      p.updateCamera = () => {};
      c.weapons.setViewmodelVisible(false);
      c.camera.position.set(eye[0], eye[1], eye[2]);
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      c.camera.updateMatrixWorld();
      return { mode: 'overhead', agl: r2(agl), notes };
    }
    c.weapons.setViewmodelVisible(gun);
    const want = eye[1] - EYE;
    let foot = w.groundHeight(eye[0], eye[2], eye[1] + 0.3, 0.3);
    const terr = terrainAt(eye[0], eye[2]);
    if (terr > eye[1] + 0.3) { notes.push('眼位埋在地形里（地形 ' + r2(terr) + '），站到地形上'); foot = terr; }
    else if (!Number.isFinite(foot)) { foot = under; notes.push('眼位下面没有地面，用最高地面 ' + r2(under)); }
    if (Number.isFinite(foot) && foot > want + 0.15) notes.push('脚下地面 ' + r2(foot) + ' 高于 eye−1.62 = ' + r2(want) + '，眼位抬高 ' + r2(foot - want) + ' m');
    if (Number.isFinite(foot) && foot < want - 1) {
      // 要求的脚底下没有可站的面（碰撞缺了 / 站点是屋顶之类网页站不上去的地方）：玩家留在下面的地面上，相机直接放到要求的眼位
      notes.push('眼位悬空 ' + r2(want - foot) + ' m（脚下碰撞面 ' + r2(foot) + '，站不上去）：相机直接放在要求的眼位，玩家留在下面');
      p.teleport(new V(eye[0], foot + 0.02, eye[2]), 0);
      p.updateCamera = () => {};
      c.camera.position.set(eye[0], eye[1], eye[2]);
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      c.camera.updateMatrixWorld();
      return { mode: 'fixed', foot: r2(foot), notes };
    }
    if (Number.isFinite(foot) && foot < want - 0.4) notes.push('眼位悬空：脚下地面 ' + r2(foot) + '，比 eye−1.62 低 ' + r2(want - foot) + ' m，玩家站到地面上');
    const y = Number.isFinite(foot) ? foot : want;
    const [yaw, pitch] = aimFrom({ x: eye[0], y: y + EYE, z: eye[2] }, lookAt);
    p.teleport(new V(eye[0], y + 0.02, eye[2]), yaw);
    p.pitch = pitch;
    return { mode: 'player', foot: r2(foot), notes };
  };
  /** 按实际眼位重新对准看点；返回实际眼位、和要求的偏差、眼位 → 看点有没有被碰撞体挡 */
  window.__aim = (eye, lookAt) => {
    const p = c.player, cam = c.camera;
    if (Object.prototype.hasOwnProperty.call(p, 'updateCamera')) {
      // 俯瞰 / 悬空机位：相机是自己摆的，每帧原样；遮挡只对悬空机位有意义
      const e = cam.position.clone(), L = new V(lookAt[0], lookAt[1], lookAt[2]), d = e.distanceTo(L);
      const low = eye[1] - w.groundHeight(eye[0], eye[2], 400, 0.3) <= ${OVERHEAD_AGL};
      return low ? { eye: e.toArray().map(r2), drift: 0, blocked: w.segmentBlocked(e, e.clone().lerp(L, Math.max(0, 1 - 1 / Math.max(d, 1e-3)))), dist: r2(d) } : { eye: e.toArray().map(r2) };
    }
    const e = p.eye.clone();
    const [yaw, pitch] = aimFrom(e, lookAt);
    p.yaw = yaw; p.pitch = Math.max(-1.55, Math.min(1.55, pitch));
    // 遮挡只查到看点前 1 m（看点常常就贴在地面 / 物体表面上）
    const L = new V(lookAt[0], lookAt[1], lookAt[2]), d = e.distanceTo(L);
    const L1 = e.clone().lerp(L, Math.max(0, 1 - 1 / Math.max(d, 1e-3)));
    return { eye: e.toArray().map(r2), drift: r2(e.distanceTo(new V(eye[0], eye[1], eye[2]))), blocked: w.segmentBlocked(e, L1), dist: r2(d) };
  };
  /** 在看点附近刷几只本章敌人（沿视线方向前后、左右错开，贴到导航 / 地面上） */
  window.__foes = (eye, lookAt, ids) => {
    const f = new V(lookAt[0] - eye[0], 0, lookAt[2] - eye[2]);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const right = new V(-f.z, 0, f.x);
    const offs = [[0, -3.5], [3, 3], [-1.5, 5.5], [-4, 1], [2, -6]];
    const made = [];
    ids.forEach((id, i) => {
      const [df, dr] = offs[i % offs.length];
      const q = new V(lookAt[0], lookAt[1], lookAt[2]).addScaledVector(f, df).addScaledVector(right, dr);
      const at = q.clone();
      if (!c.nav.nearestWalkable(q, at)) at.copy(q);
      const gy = w.groundHeight(at.x, at.z, Math.max(at.y, q.y) + 3, 0.3);
      if (Number.isFinite(gy)) at.y = gy;
      const e = c.enemies.spawn(id, { position: at, level: c.run.difficulty || 1 });
      if (e) made.push({ id, at: at.toArray().map(r2) });
    });
    return made;
  };
  window.__clearFoes = () => { c.enemies.clear(); c.projectiles.clear?.(); return true; };
  /** 关 / 开场景雾（连带空气透视层）：俯瞰机位加拍一张不带雾的看布局；改了雾要让材质重编 */
  window.__fog = (on) => {
    if (!on && c.scene.fog) { window.__savedFog = c.scene.fog; c.scene.fog = null; }
    else if (on && !c.scene.fog && window.__savedFog) c.scene.fog = window.__savedFog;
    else return false;
    c.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    return true;
  };
  // 去色缩略图 + 拼图（拍完的 JPEG 传回页面里画）
  const sheetW = 480, sheetH = 270, label = 26, cols = 4;
  window.__thumbs = [];
  const load = async (b64) => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode(); return img; };
  const toB64 = (cv) => cv.toDataURL('image/jpeg', 0.88).split(',')[1];
  window.__gray = async (b64, name) => {
    const img = await load(b64);
    const mk = (W, gray) => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(W * img.height / img.width); const x = cv.getContext('2d'); if (gray) x.filter = 'grayscale(1)'; x.drawImage(img, 0, 0, cv.width, cv.height); return cv; };
    window.__thumbs.push({ name, color: mk(sheetW, false), gray: mk(sheetW, true) });
    return toB64(mk(320, true));
  };
  window.__sheet = (gray) => {
    const list = window.__thumbs, rows = Math.ceil(list.length / cols);
    const cv = document.createElement('canvas'); cv.width = cols * sheetW; cv.height = rows * (sheetH + label);
    const x = cv.getContext('2d');
    x.fillStyle = '#121216'; x.fillRect(0, 0, cv.width, cv.height);
    x.font = '16px "Microsoft YaHei", "PingFang SC", sans-serif'; x.fillStyle = '#ebe6dc'; x.textBaseline = 'top';
    list.forEach((t, k) => {
      const px = (k % cols) * sheetW, py = Math.floor(k / cols) * (sheetH + label);
      x.drawImage(gray ? t.gray : t.color, px, py, sheetW, sheetH);
      x.fillText(t.name, px + 8, py + sheetH + 4, sheetW - 16);
    });
    return toB64(cv);
  };
  return true;
})()`;

// ───────────── 驱动 ─────────────
// 页面卡死（主线程不回话、CPU 全闲，第一次整跑时 1-1 → 1-2 换图就这样挂住过）时 cdp.mjs 的 eval 会永远等下去：
// 每次求值都带客户端超时；超时算「页面卡死」，杀掉这个 Chromium、重起一个（同一时刻仍只有一个），这张图从头再拍一次。
class Hung extends Error {}
let b = null;
async function relaunch() {
  if (b) { killStrays(); await wait(800); }
  b = null;
  try {
    b = await launch({ width: 1280, height: 720 });
  } catch (err) {
    killStrays();
    throw err;
  }
}
await relaunch();
process.on('exit', killStrays);

const recordPath = join(out, 'shots.json');
let record = {};
try { if (existsSync(recordPath)) record = JSON.parse(readFileSync(recordPath, 'utf8')); } catch { record = {}; }
record._meta = { posesPath, port, gun: GUN, settle: SETTLE, updated: new Date().toISOString() };

/** 带客户端超时的求值：超时抛 Hung */
async function ev(expr, ms = 180000) {
  let timer;
  try {
    return await Promise.race([b.eval(expr), new Promise((_, rej) => { timer = setTimeout(() => rej(new Hung(`页面 ${Math.round(ms / 1000)} s 没有回应：${expr.slice(0, 80)}`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function send(method, params, ms = 60000) {
  let timer;
  try {
    return await Promise.race([b.send(method, params), new Promise((_, rej) => { timer = setTimeout(() => rej(new Hung(`${method} ${Math.round(ms / 1000)} s 没有回应`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function waitFor(expr, ms) {
  const t0 = Date.now();
  for (;;) {
    try { if (await ev(`!!(${expr})`, 30000)) return; } catch (e) { if (e instanceof Hung && Date.now() - t0 > ms) throw e; }
    if (Date.now() - t0 > ms) throw new Hung(`等不到：${expr}`);
    await wait(250);
  }
}
const step = s => ev(`window.__step(${s})`);
const saveJpeg = (file, b64) => writeFileSync(join(out, file), Buffer.from(b64, 'base64'));

async function shoot(map, stem) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  saveJpeg(`${map}-${stem}.jpg`, r.data);
  const gray = await ev(`window.__gray(${JSON.stringify(r.data)}, ${JSON.stringify(`${map}-${stem}`)})`);
  saveJpeg(`${map}-${stem}-gray.jpg`, gray);
  return `${map}-${stem}.jpg`;
}

async function shootMap(map, rec) {
  // 先回空白页、等上一张图的 WebGL 和资源放干净，再进下一张
  await send('Page.navigate', { url: 'about:blank' }, 60000);
  await wait(1500);
  const logStart = b.logs.length;
  rec.logStart = logStart;
  const t0 = Date.now();
  if (!b.pageHooked) {
    // 每个新页面先跑的两段（每个 Chromium 挂一次）：
    //  · 开发服务器的模块成百上千，资源计时缓冲缺省只记 250 条：放大，CH1_ASSETS=0 才能从里面找到 AssetLibrary 的模块地址；
    //  · 掐掉 Vite 的热更新连接（CH1_HMR=1 保留）：别的会话一直在改 src/，每存一次盘 Vite 就整页刷新，
    //    1–4 分钟的载入 / 开局中途被刷掉（实测 1-1 载入到一半被刷，PAGE_TOOLS 读不到 __ctx）。换成一个永远「已连上」、
    //    从不来消息也从不断开的假连接（断开的话 Vite 会轮询服务器、连上了再刷新）；拍图用的是开页那一刻的代码。
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(100000)' });
    if (!HMR) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const Native = window.WebSocket;
      function Quiet(url, protocols) {
        if (![].concat(protocols ?? []).includes('vite-hmr')) return new Native(url, protocols);
        const fake = new EventTarget();
        return Object.assign(fake, { url: String(url), protocol: 'vite-hmr', readyState: 1, CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, send() {}, close() {} });
      }
      Quiet.prototype = Native.prototype;
      Object.assign(Quiet, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      window.WebSocket = Quiet;
    })()` });
    b.pageHooked = true;
  }
  await send('Page.navigate', { url: `http://localhost:${port}/?debug&dev&debugStage=${map}${QUERY}` }, 120000);
  await wait(300);
  await waitFor('window.__game && window.__ctx', 300000);
  rec.load.pageMs = Date.now() - t0;
  if (ASSETS) {
    for (let k = 0; k < 1200 && !b.logs.slice(logStart).some(l => l.includes('[assets] 已加载')); k++) await wait(250);
  } else {
    // 不等资产库：开局前让 AssetLibrary.preload() 立刻返回（见文件头 CH1_ASSETS）。模块地址从资源计时里找页面实际用的那个
    // （HMR 后会带 ?t=）；找不到就不动——自己猜地址 import 会多出一个实例、再从头读一遍全部资产——开局照常等资产
    rec.load.assetsSkipped = await ev(`(async () => {
      const hit = performance.getEntriesByType('resource').map(e => e.name).find(n => /\\/src\\/assets\\/AssetLibrary\\.ts(\\?|$)/.test(n));
      if (!hit) return null;
      const m = await import(hit);
      m.AssetLibrary.ready = Promise.resolve();
      return hit.replace(location.origin, '');
    })()`, 60000);
    if (!rec.load.assetsSkipped) log(map, 'CH1_ASSETS=0：页面的资源计时里找不到 AssetLibrary 模块，照常等资产');
  }
  rec.load.assetsMs = Date.now() - t0;
  await ev(PAGE_TOOLS);
  await ev(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  let ready = false;
  for (let k = 0; k < 600 && !ready; k++) {
    await step(0.1);
    ready = await ev(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`);
    if (!ready) await wait(250);
  }
  rec.load.readyMs = Date.now() - t0;
  if (!ready) throw new Error(`开局失败：state = ${await ev('window.__game.state')}`);
  await ev(`(() => { const ui = document.getElementById('ui-root'); if (ui) ui.style.visibility = 'hidden'; return true; })()`);
  await ev('window.__quiet()');
  await step(1);
  rec.load.scene = await ev(`(() => { const c = window.__ctx, a = c.stage.arena, d = c.stage.unityDocument; return { id: d?.id ?? null, spawn: a?.playerSpawn?.toArray().map(v => +v.toFixed(2)), fog: c.scene.fog ? [c.scene.fog.near ?? null, c.scene.fog.far ?? null, c.scene.fog.density ?? null] : null, far: c.camera.far }; })()`);
  log(map, `载入 ${(rec.load.readyMs / 1000).toFixed(1)} s（资产 ${(rec.load.assetsMs / 1000).toFixed(1)} s）`, JSON.stringify(rec.load.scene));

  const list = poses[map];
  for (let i = 0; i < list.length; i++) {
    const pose = list[i];
    if (poseFilter && !poseFilter.test(pose.name ?? '')) continue;
    const stem = slug(pose.name, i);
    const pr = { name: pose.name, file: null, eye: pose.eye, lookAt: pose.lookAt };
    rec.poses.push(pr);
    try {
      const E = JSON.stringify(pose.eye), L = JSON.stringify(pose.lookAt);
      await ev('window.__quiet()');
      Object.assign(pr, await ev(`window.__pose(${E}, ${L}, ${GUN})`));
      // 推一段、等真实时间让异步的贴图 / 着色器编译到齐，再按实际眼位对准、推完剩下的
      await step(SETTLE * 0.4);
      await wait(500);
      await ev(`window.__aim(${E}, ${L})`);
      await step(SETTLE * 0.4);
      await wait(300);
      Object.assign(pr, await ev(`window.__aim(${E}, ${L})`));
      await step(Math.max(0.05, SETTLE * 0.2 - 0.35));
      pr.frame = await ev('window.__timeFrames(20)');
      await ev(`window.__aim(${E}, ${L})`);
      await step(2 / 60);
      pr.file = await shoot(map, stem);
      if (pr.mode === 'player' && pr.drift > 0.3) pr.notes.push(`实际眼位偏离要求 ${pr.drift} m`);
      if (pr.blocked) pr.notes.push('眼位 → 看点的直线被碰撞体挡住');
      log(map, stem, pr.mode, JSON.stringify(pr.eye), pr.notes.length ? pr.notes.join('；') : '', `帧 ${pr.frame.median} ms / ${pr.frame.calls} 次调用`);
      if (FOES && isEncounter(pose)) {
        pr.foes = await ev(`window.__foes(${E}, ${L}, ${JSON.stringify(FOE_IDS)})`);
        await step(1);
        await ev(`window.__aim(${E}, ${L})`);
        await step(2 / 60);
        pr.foesFile = await shoot(map, `${stem}-foes`);
        await ev('window.__clearFoes()');
        await step(0.1);
        log(map, stem, `刷了 ${pr.foes.length} 只`, pr.foes.map(f => f.id).join(','));
      }
      if (NOFOG && pr.mode === 'overhead' && await ev('window.__fog(false)')) {
        // 俯瞰隔着 100–200 m 的雾什么都看不清：加拍一张关雾的看布局，拍完把雾开回去（材质要重编，多等一会儿）
        try {
          await step(0.2); await wait(1500); await step(0.2);
          pr.nofogFile = await shoot(map, `${stem}-nofog`);
        } finally {
          await ev('window.__fog(true)');
          await step(0.2); await wait(1500); await step(0.2);
        }
      }
    } catch (err) {
      if (err instanceof Hung) throw err;
      pr.error = String(err?.message ?? err).slice(0, 400);
      log(map, stem, '失败', pr.error);
    }
  }
  if (poseFilter) {
    // 只补拍了几个机位：拼图按目录里这张图现有的全部截图重拼
    await ev('(window.__thumbs = [], true)');
    const stems = readdirSync(out).filter(f => f.startsWith(`${map}-`) && /^\d\d/.test(f.slice(map.length + 1)) && f.endsWith('.jpg') && !f.endsWith('-gray.jpg'))
      .map(f => f.slice(0, -4)).sort();
    for (const s of stems) await ev(`window.__gray(${JSON.stringify(readFileSync(join(out, s + '.jpg')).toString('base64'))}, ${JSON.stringify(s)})`);
  }
  saveJpeg(`${map}-sheet.jpg`, await ev('window.__sheet(false)'));
  saveJpeg(`${map}-sheet-gray.jpg`, await ev('window.__sheet(true)'));
}

for (const map of maps) {
  const prev = record[map];
  let rec = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    rec = { load: {}, poses: [], errors: [], warnings: 0, attempt };
    record[map] = rec;
    try {
      await shootMap(map, rec);
      break;
    } catch (err) {
      rec.failed = String(err?.message ?? err).slice(0, 600);
      log(map, 'FAILED', `第 ${attempt} 次`, rec.failed);
      if (b) log(b.logs.slice(-12).join('\n'));
      if (err instanceof Hung) {
        rec.hung = true;
        // 卡死前的报错先记下来，重起浏览器后日志就没了
        const mine = b.logs.slice(rec.logStart ?? 0);
        rec.errorsBeforeHang = [...new Set(mine.filter(l => /^\[(error|exception)\]/.test(l)).map(l => l.slice(0, 300)))].slice(0, 20);
        log(map, '页面卡死：重起 Chromium', attempt < 2 ? '再拍一次' : '放弃这张图');
        await relaunch();
        continue;
      }
      break;
    }
  }
  const mine = b.logs.slice(rec.logStart ?? 0);
  rec.warnings = mine.filter(l => l.startsWith('[warning]') || l.startsWith('[warn]')).length;
  rec.errors = [...new Set(mine.filter(l => /^\[(error|exception)\]/.test(l)).map(l => l.slice(0, 300)))].slice(0, 30);
  delete rec.logStart;
  if (poseFilter && Array.isArray(prev?.poses)) {
    // 补拍：没重拍的机位沿用上次的记录，按机位文件里的顺序排
    const byName = new Map(prev.poses.map(p => [p.name, p]));
    for (const p of rec.poses) byName.set(p.name, p);
    rec.poses = poses[map].map(p => byName.get(p.name)).filter(Boolean);
    rec.partial = (prev.partial ?? []).concat([{ at: new Date().toISOString(), filter: String(poseFilter) }]);
  }
  if (rec.errors.length) log(map, `控制台报错 ${rec.errors.length} 条：\n  ` + rec.errors.slice(0, 8).join('\n  '));
  writeFileSync(recordPath, JSON.stringify(record, null, 2));
}

await Promise.race([b.close(), wait(5000)]);
killStrays();
log('完成', recordPath);
