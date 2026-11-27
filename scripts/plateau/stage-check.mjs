// 正式游戏里的第四章网页原生高原场景（网址 plateau=1，src/world/plateau/stage/）进关核对：
// 开局直接进图（debugStage），掐掉热更新、不等资产库，推进几秒，按检视页的机位（换成正式坐标）拍玩家视角，
// 再起一场机关雷暴（window.__mechanisms.storm()）拍雨、淋湿；记下载入耗时、控制台报错、帧时间、绘制调用、高原层的状态。
//
//   node scripts/plateau/stage-check.mjs [端口 5199] [图 4-1] [输出目录]
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const port = process.argv[2] ?? '5199';
const map = process.argv[3] ?? '4-1';
const out = process.argv[4] ?? join(tmpdir(), 'roguelike-lookdev', `stage-${map}`);
mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[stage-check]', ...a);

// 检视页机位（高原坐标）：[名字, 站点 x, z, 看向 x, y, z]；正式坐标 = x、z 取反
const POSES = {
  '4-1': [
    ['出生点', -255, 205, 90, 60, -70],
    ['碉楼寨', -148, 8, -200, 30, -52],
    ['白塔溪谷', -10, 82, -32, 8, 56],
    ['圣湖海子', -90, -128, -160, 4, -165],
    ['垭口望贡嘎', 258, -182, 430, 420, -1550],
  ],
};

const b = await launch({ width: 1280, height: 720 });
const rec = { map, poses: [], errors: [] };
try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(100000)' });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
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
  const t0 = Date.now();
  await b.send('Page.navigate', { url: `http://localhost:${port}/?debug&dev&debugStage=${map}&plateau=1` });
  await b.waitFor('window.__game && window.__ctx', 300000);
  // 不等资产库（同 scripts/desert/ch1-shots.mjs 的 CH1_ASSETS=0）
  await b.eval(`(async () => {
    const hit = performance.getEntriesByType('resource').map(e => e.name).find(n => /\\/src\\/assets\\/AssetLibrary\\.ts(\\?|$)/.test(n));
    if (!hit) return null;
    const m = await import(hit); m.AssetLibrary.ready = Promise.resolve(); return hit;
  })()`, 60000);
  await b.eval(`(() => {
    const g = window.__game, c = window.__ctx;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  let ready = false;
  for (let k = 0; k < 600 && !ready; k++) {
    await b.eval('window.__step(0.1), true');
    ready = await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`);
    if (!ready) await wait(250);
  }
  rec.loadMs = Date.now() - t0;
  if (!ready) throw new Error(`开局失败：state = ${await b.eval('window.__game.state')}`);
  log(`进关 ${(rec.loadMs / 1000).toFixed(1)} s`);
  // 关掉怪 / 波次、玩家无敌、藏 UI
  await b.eval(`(() => {
    const c = window.__ctx, s = c.stage;
    s.updateEncounters = () => {}; s.discoverSites = () => {};
    try { s.waves?.cancel?.(); } catch {} try { s.encounterWaves?.cancel?.(); } catch {}
    s.waves = null; s.encounterWaves = null;
    if (c.enemies.list.length) c.enemies.clear();
    c.player.invulnerableTime = 1e9;
    const ui = document.getElementById('ui-root'); if (ui) ui.style.visibility = 'hidden';
    return true;
  })()`);
  await b.eval('window.__step(1), true');
  rec.state = await b.eval(`(() => {
    const c = window.__ctx, v = c.stage.view, d = c.stage.unityDocument;
    return { doc: d?.id, scene: d?.scene, colliders: d?.colliders.length, encounters: d?.encounters.length, plateau: !!v?.plateau,
      environment: !!v?.environment, fog: c.scene.fog ? [Math.round(c.scene.fog.near), Math.round(c.scene.fog.far)] : null,
      tone: c.renderer.toneMapping, spawn: c.player.position.toArray().map(x => +x.toFixed(1)) };
  })()`);
  log('状态', JSON.stringify(rec.state));
  const shot = async (name) => {
    const t1 = Date.now();
    await b.eval('window.__step(0.6), true');
    const perf = await b.eval(`(() => { const gl = window.__ctx.renderer.getContext(), px = new Uint8Array(4); const ms = [];
      for (let i = 0; i < 6; i++) { const t0 = performance.now(); window.__step(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t0); }
      ms.sort((a, b) => a - b); const info = window.__ctx.renderer.info; return { frameMs: +ms[3].toFixed(1), calls: info.render.calls, tris: info.render.triangles }; })()`);
    const file = join(out, `${map}-${String(rec.poses.length).padStart(2, '0')}-${name}.jpg`);
    await b.shot(file, 88);
    rec.poses.push({ name, file, ...perf, ms: Date.now() - t1 });
    log(name, JSON.stringify(perf));
  };
  for (const [name, x, z, lx, ly, lz] of process.env.STORM_ONLY === '1' ? [] : POSES[map] ?? []) {
    // 正式坐标：x、z 取反；站到地面上，朝看点
    await b.eval(`(() => { const c = window.__ctx, p = c.player, w = c.world, V = p.position.constructor;
      const x = ${-x}, z = ${-z}; const gy = w.groundHeight(x, z, 400, 0.3);
      p.teleport(new V(x, (Number.isFinite(gy) ? gy : 0) + 0.05, z), 0);
      window.__step(0.3);
      const e = c.camera.getWorldPosition(new V()), L = [${-lx}, ${ly}, ${-lz}];
      const dx = L[0] - e.x, dy = L[1] - e.y, dz = L[2] - e.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz))));
      return true; })()`);
    await shot(name);
  }
  // 雷暴：机关雷暴的调试入口，推 20 s（渐入 + 淋湿），回到第一个机位拍
  const storm = await b.eval(`(() => { const m = window.__mechanisms; if (!m?.storm) return '没有机关雷暴（window.__mechanisms.storm）'; m.storm.begin({ aroundPlayer: true }); return 'ok'; })()`);
  log('雷暴', storm);
  if (storm === 'ok') {
    const [name, x, z, lx, ly, lz] = (POSES[map] ?? [])[1] ?? POSES[map][0];
    await b.eval(`(() => { const c = window.__ctx, p = c.player, w = c.world, V = p.position.constructor;
      const x = ${-x}, z = ${-z}; const gy = w.groundHeight(x, z, 400, 0.3); p.teleport(new V(x, (Number.isFinite(gy) ? gy : 0) + 0.05, z), 0);
      window.__step(0.3); const e = c.camera.getWorldPosition(new V()), L = [${-lx}, ${ly}, ${-lz}];
      const dx = L[0] - e.x, dy = L[1] - e.y, dz = L[2] - e.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); return true; })()`);
    for (let k = 0; k < 20; k++) await b.eval('window.__step(1), true');
    rec.storm = await b.eval(`(async () => { const c = window.__ctx, m = window.__mechanisms;
      const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/plateau/materials.ts'));
      const U = url ? (await import(url)).WORLD_UNIFORMS : null;
      return { mechanismLevel: +(m.storm.level).toFixed(2), uStorm: U ? +U.uStorm.value.toFixed(2) : null, wet: U ? +U.uWet.value.toFixed(2) : null, rainVisible: !!c.scene.getObjectByName('rain')?.visible }; })()`);
    log('雷暴状态', JSON.stringify(rec.storm));
    await shot(`雷暴-${name}`);
  }
  rec.errors = b.logs.filter(l => /error|exception|失败|没建起来/i.test(l)).slice(-30);
} finally {
  writeFileSync(join(out, 'stage-check.json'), JSON.stringify(rec, null, 1));
  await b.close();
}
log(`报错 ${rec.errors.length} 条${rec.errors.length ? '：\n  ' + rec.errors.join('\n  ') : ''}`);
log(`图在 ${out}`);
