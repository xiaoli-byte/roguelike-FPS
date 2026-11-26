// 关卡冒烟：关卡目录里每张可用图逐张进关（调试局 ?debug&debugStage=<id>），记下这张图「搭出来是什么样」，改关卡数据 / 读取代码前后各跑一遍逐项比对。
// 2026-11-26 去 Unity 依赖（public/assets/unity-levels → public/assets/levels）时加的，之后每次动关卡数据、场景栈都拿它对照。
//
//   node scripts/web/level-smoke.mjs [端口=5173] [输出目录=tests/.cache/level-smoke/latest] [--redo] [--maps=1-1,3-3] [--variant=reverse]
//   node scripts/web/level-smoke.mjs --compare <基线目录> <新目录>       逐项比对两次的 smoke.json（计数不等、网络请求里还有 unity 字样都算不过，退出码 1）
//
// 需要开发服务器（npx vite --port <端口>）；钩子 window.__game / __ctx / __mechanisms 在网址带 ?debug 时存在（core/Game.ts）。
// --redo：网址加 redo=1（第一章重做版，src/world/desert/redo）；不给 --maps 时只跑第一章的图（redo 只影响第一章）。
// 每张图记：
//   · render：场景组（StageDirector.view.group）里的网格 / 实例网格 / 点 / 线个数、三角数、材质种类（类型 + 是否改过着色器）、几何属性名；
//     机关组（mechanisms）单列；
//   · collision：碰撞世界里的盒子数、网格碰撞数与三角数，网格碰撞顶点坐标和、面法线（面积加权）和（镜像 / 绕序错了这几个和会变）、标签分布、高度场数；
//   · nav：导航网格三角数 / 顶点数；
//   · mechanisms：window.__mechanisms 的数据段各类条数、运行时各类个数、软边界有无；数据段去掉来源字段后的摘要（sha256）；
//   · objectives：关卡目标模式（objective = 灵火坛 / 据点首领清关，final = 终点战清关）和目标文档摘要；
//   · post：postScene.active、混好的全局 Volume 参数（PostScene.evaluate(null)）；
//   · doc：遭遇 / 藏宝 / 出口 / 营地 / 首领 / 入场点数，遭遇战（whiteboxFights）数，出生点与朝向；
//   · minimap：小地图地址与 HTTP 状态；
//   · network：页面全部资源请求里地址带 unity 的（资源 / 源码模块分开记），资源请求按目录计数；
//   · 出生点按出生朝向（俯仰 0、不画枪、隐藏界面、天气强制平静）截一张 <图>.png。
// 天气粒子等有随机成分：截图只做人工 / 阈值比较，计数要逐项相等。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = name => argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = name => flag(name)?.split('=').slice(1).join('=') ?? null;

// ───────────── 比对 ─────────────
if (flag('compare')) {
  const [a, b] = argv.filter(x => !x.startsWith('--'));
  if (!a || !b) throw new Error('用法：--compare <基线目录> <新目录>');
  const A = JSON.parse(readFileSync(join(a, 'smoke.json'), 'utf8')), B = JSON.parse(readFileSync(join(b, 'smoke.json'), 'utf8'));
  // 不比的：耗时、网络明细（单独检查）、控制台（只列出来）
  const SKIP = new Set(['timing', 'network', 'console', 'shot', 'url']);
  let bad = 0;
  const diff = (x, y, path, out) => {
    if (typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y) || (x === null) !== (y === null)) { out.push(`${path}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`); return; }
    if (x && typeof x === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!SKIP.has(k)) diff(x[k], y[k], path ? `${path}.${k}` : k, out);
      return;
    }
    if (x !== y) out.push(`${path}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };
  for (const id of new Set([...Object.keys(A.maps), ...Object.keys(B.maps)])) {
    const out = [];
    if (!A.maps[id] || !B.maps[id]) out.push(`只在${A.maps[id] ? '基线' : '新的'}里有`);
    else diff(A.maps[id], B.maps[id], '', out);
    const unity = B.maps[id]?.network?.unityAssets ?? [];
    if (unity.length) out.push(`新的网络请求里还有 unity：${unity.join(', ')}`);
    const errs = B.maps[id]?.console ?? [];
    console.log(`${out.length ? '✖' : '✔'} ${id}${out.length ? '' : '  逐项相等'}${errs.length ? `（控制台 ${errs.length} 条报错）` : ''}`);
    for (const line of out) console.log(`    ${line}`);
    bad += out.length ? 1 : 0;
  }
  console.log(`\n${bad ? `${bad} 张图有差异` : '全部逐项相等'}（截图在两个目录的 <图>.png，人工比对）`);
  process.exit(bad ? 1 : 0);
}

// ───────────── 跑一遍 ─────────────
const positional = argv.filter(x => !x.startsWith('--'));
const port = positional[0] ?? '5173';
const out = positional[1] ?? join(ROOT, 'tests/.cache/level-smoke/latest');
const REDO = !!flag('redo');
const VARIANT = flagValue('variant');
const log = (...a) => console.log('[level-smoke]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

/** 关卡目录里可用的图（src/world/level/catalog.ts） */
async function catalog() {
  const { LEVEL_CATALOG } = await import(pathToFileURL(join(ROOT, 'src/world/level/catalog.ts')).href);
  return LEVEL_CATALOG.filter(s => s.available).map(s => s.id);
}

const all = await catalog();
const only = flagValue('maps')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
const maps = only ?? (REDO ? all.filter(id => id.startsWith('1-')) : all);
mkdirSync(out, { recursive: true });
const { launch } = await import(pathToFileURL(join(ROOT, 'scripts/plateau/cdp.mjs')).href);

/** 杀掉本进程起的 Chromium（cdp.mjs 的配置目录名是 ch4-cdp-<pid>-<端口>） */
function killStrays() {
  if (process.platform !== 'win32') return;
  const filter = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'ch4-cdp-${process.pid}-' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell', ['-NoProfile', '-Command', filter], { stdio: 'ignore' });
}
process.on('exit', killStrays);

// 页面里的工具：固定步长推帧（rAF 停掉）、安静下来（不刷怪、天气平静）、量一张图
const PAGE_TOOLS = `(() => {
  const g = window.__game, c = window.__ctx;
  window.requestAnimationFrame = () => 0;
  window.__step = (seconds, dt = 1 / 60) => {
    let t = window.__simT ?? performance.now();
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
    window.__simT = t;
  };
  window.__quiet = () => {
    const s = c.stage;
    s.updateEncounters = () => {};
    s.discoverSites = () => {};
    try { s.waves?.cancel?.(); } catch {}
    try { s.encounterWaves?.cancel?.(); } catch {}
    s.waves = null; s.encounterWaves = null;
    if (c.enemies.list.length) c.enemies.clear();
    c.projectiles.clear?.();
    for (const r of window.__mechanisms?.weather?.regions ?? []) { try { r.force('calm', 0); } catch {} }
    c.player.invulnerableTime = 1e9; c.player.hp = c.player.maxHp();
    return true;
  };
  return true;
})()`;

const MEASURE = `(async () => {
  const c = window.__ctx, s = c.stage, d = s.unityDocument, v = s.view;
  const r6 = x => Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x;
  const round = o => JSON.parse(JSON.stringify(o, (k, x) => typeof x === 'number' ? r6(x) : x));
  const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const stable = o => JSON.stringify(o, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
  const res = performance.getEntriesByType('resource').map(e => e.name);
  const moduleUrl = re => res.find(n => re.test(n));
  const out = { id: d?.id ?? null, title: d?.title ?? null };

  // ── 渲染 ──
  const render = (root, skip) => {
    const o = { meshes: 0, instanced: 0, instances: 0, points: 0, lines: 0, triangles: 0, materials: {}, attributes: {} };
    const seenGeo = new Set();
    const walk = obj => {
      if (skip && skip(obj)) return;
      if (obj.isInstancedMesh) { o.instanced++; o.instances += obj.count; }
      else if (obj.isMesh) o.meshes++;
      else if (obj.isPoints) o.points++;
      else if (obj.isLine) o.lines++;
      if (obj.isMesh || obj.isPoints || obj.isLine) {
        const g = obj.geometry;
        if (g && obj.isMesh) o.triangles += Math.floor((g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3) * (obj.isInstancedMesh ? obj.count : 1);
        if (g && !seenGeo.has(g.uuid)) {
          seenGeo.add(g.uuid);
          for (const name of Object.keys(g.attributes)) o.attributes[name] = (o.attributes[name] ?? 0) + 1;
        }
        for (const m of [].concat(obj.material ?? [])) {
          const key = m.type + (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') ? '+shader' : '');
          o.materials[key] = (o.materials[key] ?? 0) + 1;
        }
      }
      for (const ch of obj.children) walk(ch);
    };
    walk(root);
    return o;
  };
  const mech = v?.group?.getObjectByName?.('mechanisms') ?? null;
  out.render = v?.group ? { scene: render(v.group, obj => obj === mech), mechanisms: mech ? render(mech) : null, documentRenderers: d?.renderers?.length ?? null } : null;

  // ── 碰撞 ──
  const w = c.world, tags = {}, perBox = [];
  let boxes = 0, meshes = 0, triangles = 0;
  for (const b of w.boxes) {
    const tag = String(b.tag).replace(/-\\d+$/, '-#');
    tags[tag] = (tags[tag] ?? 0) + 1;
    if (!b.triangles) { boxes++; continue; }
    meshes++;
    const p = b.triangles.positions, ix = b.triangles.indices;
    triangles += ix.length / 3;
    let sx = 0, sy = 0, sz = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < p.length; i += 3) { sx += p[i]; sy += p[i + 1]; sz += p[i + 2]; }
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const a = ix[i] * 3, bb = ix[i + 1] * 3, cc = ix[i + 2] * 3;
      const ux = p[bb] - p[a], uy = p[bb + 1] - p[a + 1], uz = p[bb + 2] - p[a + 2];
      const vx = p[cc] - p[a], vy = p[cc + 1] - p[a + 1], vz = p[cc + 2] - p[a + 2];
      nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
    }
    perBox.push([sx, sy, sz, nx, ny, nz]);
  }
  // 各碰撞体载入先后不定：每个盒子先自己求和，再排序相加（和与顺序无关）
  const sum = k => Math.round(perBox.map(x => x[k]).sort((a, b) => a - b).reduce((s, x) => s + x, 0) * 100) / 100;
  out.collision = { boxes, meshes, triangles, vertexSum: [0, 1, 2].map(sum), normalSum: [3, 4, 5].map(sum), tags, heightfields: w.heightfields.length };

  // ── 导航 ──
  const nav = c.nav?.unity ?? null;
  out.nav = nav ? { triangles: nav.triangles?.length ?? null, vertices: nav.vertices?.length ?? null } : null;

  // ── 机关 ──
  const m = window.__mechanisms ?? null;
  if (m) {
    const data = {};
    for (const [k, x] of Object.entries(m.data ?? {})) {
      if (Array.isArray(x)) data[k] = x.length;
      else if (x && typeof x === 'object') data[k] = true;
      else if (x === null) data[k] = null;
    }
    // 摘要去掉来源字段（scene / source / sceneSha1、软边界的 asset / sha1 / url：去 Unity 时删掉或改了地址）
    const strip = JSON.parse(JSON.stringify(m.data ?? {}));
    delete strip.scene; delete strip.source; delete strip.sceneSha1;
    if (strip.boundary) { delete strip.boundary.asset; delete strip.boundary.sha1; delete strip.boundary.url; }
    out.mechanisms = {
      data, digest: await sha(stable(round(strip))),
      runtime: {
        lava: m.volumes?.size ?? 0, geysers: m.geysers?.length ?? 0, sluices: m.sluices?.length ?? 0, destructibles: m.destructibles?.length ?? 0,
        spans: m.spans?.length ?? 0, icicles: m.icicles?.length ?? 0, conductors: m.conductors?.length ?? 0, levels: m.levels?.length ?? 0,
        weather: !!m.weather, weatherRegions: m.weather?.regions?.length ?? 0, boundary: !!m.boundary, quicksand: !!m.quicksand, surfaces: !!m.surfaces,
        safeZones: !!m.safeZones, channels: !!m.channels,
      },
    };
  } else out.mechanisms = null;

  // ── 关卡目标 ──
  const objUrl = moduleUrl(/\\/src\\/world\\/objectives\\/LevelObjectives\\.ts(\\?|$)/);
  let objectives = null;
  if (objUrl && d) {
    const mod = await import(objUrl);
    const doc = await mod.loadLevelObjectives(d.id);
    if (doc) {
      const copy = JSON.parse(JSON.stringify(doc));
      delete copy.scene;
      objectives = { driven: mod.objectiveDriven(doc), altars: doc.altars?.length ?? 0, altarsNeeded: doc.objective?.altarsNeeded ?? 0, bosses: doc.bosses?.length ?? 0, digest: await sha(stable(round(copy))) };
    }
  }
  out.objectives = { mode: s.objective ? 'objective' : 'final', doc: objectives };

  // ── 后处理 ──
  const postUrl = moduleUrl(/\\/src\\/render\\/PostScene\\.ts(\\?|$)/);
  if (postUrl) {
    const { postScene } = await import(postUrl);
    const params = round(postScene.evaluate(null));
    out.post = { active: postScene.active, sceneId: postScene.sceneId, digest: await sha(stable(params)), params };
  } else out.post = null;

  // ── 文档 ──
  out.doc = d ? {
    encounters: d.encounters?.length ?? 0, caches: d.caches?.length ?? 0, exits: d.exits?.length ?? 0, camps: d.camps?.length ?? 0,
    bosses: d.bosses?.length ?? 0, entries: d.entries?.length ?? 0, platforms: d.platforms?.length ?? 0, water: d.water?.length ?? 0,
    activators: d.activators?.length ?? 0, colliders: d.colliders?.length ?? 0, renderers: d.renderers?.length ?? 0,
    vegetation: d.vegetation?.instances?.length ?? 0, groundCover: d.groundCover?.length ?? 0,
    fights: s.whiteboxFights?.length ?? 0, finalFights: (s.whiteboxFights ?? []).filter(f => f.final).length,
    spawn: s.arena ? [...s.arena.playerSpawn.toArray().map(r6), r6(s.arena.playerYaw)] : null,
  } : null;

  // ── 小地图 ──
  const mapUrl = s.layout?.adventure?.mapImage?.url ?? null;
  out.minimap = { url: mapUrl, status: mapUrl ? (await fetch(new URL(mapUrl, location.href))).status : null };

  // ── 网络 ──
  const path = n => { try { return new URL(n).pathname; } catch { return n; } };
  const isModule = p => /^\\/(src|node_modules|@vite|@id|@fs)\\//.test(p);
  const unity = res.map(path).filter(p => /unity/i.test(p));
  const byDir = {};
  for (const p of res.map(path)) if (!isModule(p) && p.startsWith('/assets/')) {
    const dir = p.split('/').slice(0, 4).join('/');
    byDir[dir] = (byDir[dir] ?? 0) + 1;
  }
  out.network = { unityAssets: [...new Set(unity.filter(p => !isModule(p)))].sort(), unityModules: [...new Set(unity.filter(isModule))].length, assetsByDir: byDir };
  return out;
})()`;

class Hung extends Error {}
let b = null;
async function relaunch() {
  if (b) { killStrays(); await wait(800); }
  b = null;
  b = await launch({ width: 1280, height: 720 });
}
async function ev(expr, ms = 180000) {
  let timer;
  try {
    return await Promise.race([b.eval(expr), new Promise((_, rej) => { timer = setTimeout(() => rej(new Hung(`页面 ${Math.round(ms / 1000)} s 没有回应：${expr.slice(0, 80)}`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function send(method, params, ms = 60000) {
  let timer;
  try {
    return await Promise.race([b.send(method, params), new Promise((_, rej) => { timer = setTimeout(() => rej(new Hung(`${method} 没有回应`)), ms); })]);
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

async function smokeMap(id) {
  await send('Page.navigate', { url: 'about:blank' });
  await wait(1200);
  if (!b.hooked) {
    // 开发服务器的模块成百上千，资源计时缓冲缺省只记 250 条：放大，网络请求才记得全；掐掉 Vite 热更新（同 scripts/desert/ch1-shots.mjs）
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(1000000)' });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
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
    b.hooked = true;
  }
  const logStart = b.logs.length;
  const t0 = Date.now();
  const url = `http://127.0.0.1:${port}/?debug&debugStage=${id}${REDO ? '&redo=1' : ''}${VARIANT ? `&variant=${VARIANT}` : ''}`;
  await send('Page.navigate', { url }, 120000);
  await wait(300);
  await waitFor('window.__game && window.__ctx', 300000);
  await ev(PAGE_TOOLS);
  await ev(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  let ready = false;
  for (let k = 0; k < 1200 && !ready; k++) {
    await step(0.1);
    ready = await ev(`window.__game.state === 'playing' && !!window.__ctx.stage.arena && !!window.__ctx.stage.view`);
    if (!ready) await wait(250);
  }
  if (!ready) throw new Error(`进关失败：state = ${await ev('window.__game.state')}`);
  const loadMs = Date.now() - t0;
  await ev(`(() => { const ui = document.getElementById('ui-root'); if (ui) ui.style.visibility = 'hidden'; return true; })()`);
  await ev('window.__quiet()');
  // 机关的软边界距离场、天空盒、贴图是异步到的：推一段、等真实时间
  await step(1);
  await wait(1500);
  await ev('window.__quiet()');
  await step(0.5);
  const rec = await ev(MEASURE, 240000);
  // 出生点、出生朝向、俯仰 0，不画枪
  await ev(`(() => { const c = window.__ctx, a = c.stage.arena, p = c.player; delete p.updateCamera; c.weapons.setViewmodelVisible(false);
    p.teleport(a.playerSpawn.clone(), a.playerYaw); p.pitch = 0; return true; })()`);
  await ev('window.__quiet()');
  await step(1.5);
  await wait(800);
  await ev(`(() => { const c = window.__ctx, a = c.stage.arena, p = c.player; p.teleport(a.playerSpawn.clone(), a.playerYaw); p.pitch = 0; return true; })()`);
  await step(0.5);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${id}.png`), Buffer.from(shot.data, 'base64'));
  rec.shot = `${id}.png`;
  rec.url = url;
  rec.timing = { loadMs };
  rec.console = b.logs.slice(logStart).filter(l => l.startsWith('[exception]') || (l.startsWith('[error]') && !/favicon/.test(l))).slice(0, 20);
  return rec;
}

const record = { meta: { port, redo: REDO, variant: VARIANT, maps, started: new Date().toISOString() }, maps: {}, failed: {} };
await relaunch();
try {
  for (const id of maps) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rec = await smokeMap(id);
        record.maps[id] = rec;
        delete record.failed[id];
        const r = rec.render?.scene;
        log(id, `进关 ${(rec.timing.loadMs / 1000).toFixed(1)} s`, `网格 ${r?.meshes ?? '-'} / 碰撞 ${rec.collision.boxes}+${rec.collision.meshes}（${rec.collision.triangles} 三角）`,
          `导航 ${rec.nav?.triangles ?? '-'}`, `后处理 ${rec.post?.active}`, `目标 ${rec.objectives.mode}`, `小地图 ${rec.minimap.status}`,
          rec.network.unityAssets.length ? `unity 请求 ${rec.network.unityAssets.length}` : '无 unity 请求', rec.console.length ? `报错 ${rec.console.length}` : '');
        break;
      } catch (err) {
        record.failed[id] = String(err?.stack ?? err);
        log(id, attempt === 0 ? '失败，重起浏览器再试一次' : '失败', String(err?.message ?? err).slice(0, 300));
        await relaunch();
      }
    }
    writeFileSync(join(out, 'smoke.json'), JSON.stringify(record, null, 1));
  }
} finally {
  record.meta.finished = new Date().toISOString();
  writeFileSync(join(out, 'smoke.json'), JSON.stringify(record, null, 1));
  try { await b?.close(); } catch { /* 已经关了 */ }
  killStrays();
}
const failed = Object.keys(record.failed);
log(`${Object.keys(record.maps).length} / ${maps.length} 张图完成${failed.length ? `，失败：${failed.join(', ')}` : ''} → ${out}`);
process.exit(failed.length ? 1 : 0);
