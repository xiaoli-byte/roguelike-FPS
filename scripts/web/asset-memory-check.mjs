// 美术资产内存实测（src/assets/AssetLibrary.ts 按需加载、src/assets/StageArt.ts 进关预取 / 换关释放）：
// 无头 Chromium 开正式主菜单（?debug 才有 window.__game / __ctx / __assets），按步骤量游戏页渲染进程的私有内存（Windows 进程计数，含解码后的贴图）：
//   1. 主菜单（开局只读英雄 / 手臂 / 灵宠 / 商人）
//   2. 开局进第一关（进关前按本关读敌人、手上和各英雄初始的枪模）
//   3. 跳到另一章的首领关（释放上一章的敌人和上一张图的网格 / 贴图，读本关的首领和本章名册）
//   4. 对照：新开一页，在主菜单把全部敌人 / 首领 / 枪模也读进来（= 2026-11-25 之前开局整批读的量）
//   node scripts/web/asset-memory-check.mjs [端口=5199] [跳到的图=3-4]
// 需要开发服务器或正式包的预览（vite / vite preview，都要带 ?debug 的钩子）。vite 默认只听 localhost。
import { execFileSync } from 'node:child_process';
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5199';
const jumpMap = process.argv[3] ?? '3-4';
// vite 默认只监听 localhost（Windows 上解析成 ::1），127.0.0.1 连不上
const base = `http://localhost:${port}`;

/** 这个脚本起的无头 Chromium 的进程：按配置目录名（cdp.mjs：ch4-cdp-<本进程 pid>-<端口>）认 */
function memory() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*ch4-cdp-${process.pid}-*' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([\\w-]+)') { $Matches[1] } else { 'browser' }; "$t $([math]::Round($_.PrivatePageCount / 1MB))" }`;
  const rows = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().split(/\r?\n/).map((l) => l.split(' '));
  const renderer = Math.max(0, ...rows.filter(([t]) => t === 'renderer').map(([, mb]) => Number(mb)));
  const gpu = rows.filter(([t]) => t === 'gpu-process').reduce((s, [, mb]) => s + Number(mb), 0);
  return { renderer, gpu };
}

const STEP = `(() => {
  const g = window.__game;
  window.__step = (seconds, dt = 1 / 30) => {
    let t = window.__simT ?? performance.now();
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
    window.__simT = t;
  };
  return true;
})()`;

async function untilPlaying(b) {
  for (let k = 0; k < 600; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval("window.__game.state === 'playing'")) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const results = [];
const note = (step, extra = {}) => {
  // 等 GC 和贴图上传落定再量
  const m = memory();
  results.push({ step, ...m, ...extra });
  console.log(`${step.padEnd(28)} 渲染进程 ${String(m.renderer).padStart(5)} MB   GPU 进程 ${String(m.gpu).padStart(5)} MB`, Object.keys(extra).length ? JSON.stringify(extra) : '');
};
const settle = (b, ms = 4000) => b.eval(`new Promise(r => setTimeout(r, ${ms}))`);
const assetLogs = (b) => b.logs.filter((l) => l.includes('[assets]')).map((l) => l.replace(/^\[\w+\] /, ''));

const b = await launch({ width: 1280, height: 720 });
try {
  await b.goto(`${base}/?debug`);
  await b.waitFor('!!window.__game && window.__game.state === "menu"', 180000);
  await b.eval('window.__assets.preload()');
  await settle(b, 6000);
  note('1 主菜单', { assets: await b.eval('window.__assets.loadedIds().length') });

  await b.eval(STEP);
  await b.eval("window.__game.startRun(window.__ctx.heroes[0].id)");
  if (!await untilPlaying(b)) throw new Error('第一关没进去');
  await b.eval('window.__step(2)');
  await settle(b);
  note('2 第一关', { stage: await b.eval('window.__ctx.run.stage.map ?? "1-1"'), assets: await b.eval('window.__assets.loadedIds().length') });

  const [chapter, index] = jumpMap.split('-').map((s) => Number.parseInt(s, 10) - 1);
  await b.eval(`(() => { const s = window.__ctx.run.stage; window.__game.advance({ ...s, chapter: ${chapter}, index: ${Number.isFinite(index) ? index : 0}, map: '${jumpMap}', type: '${Number(index) === 3 ? 'boss' : 'combat'}', theme: ['desert', 'frost', 'inferno', 'plateau'][${chapter}] ?? s.theme }); return true; })()`);
  for (let k = 0; k < 20; k++) { await b.eval('window.__step(0.1)'); await new Promise((r) => setTimeout(r, 100)); }
  if (!await untilPlaying(b)) throw new Error(`${jumpMap} 没进去`);
  await b.eval('window.__step(2)');
  await settle(b);
  note(`3 跳到 ${jumpMap}`, { assets: await b.eval('window.__assets.loadedIds().length') });

  console.log('\n资产库日志：\n  ' + assetLogs(b).join('\n  '));
} finally {
  await b.close();
}

// 对照：新开一个浏览器，主菜单把敌人 / 首领也整批读进来（旧行为）
const c = await launch({ width: 1280, height: 720 });
try {
  await c.goto(`${base}/?debug`);
  await c.waitFor('!!window.__game && window.__game.state === "menu"', 180000);
  await c.eval(`Promise.all(['core', 'enemies', 'weapons'].map(s => window.__assets.preload(s)))`, 600000);
  await settle(c, 6000);
  note('4 对照：主菜单全读（旧）', { assets: await c.eval('window.__assets.loadedIds().length') });
} finally {
  await c.close();
}
console.log(JSON.stringify(results));
