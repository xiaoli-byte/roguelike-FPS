// 无头 Chromium 驱动（Chrome DevTools 协议，不依赖 playwright 包）：第四章脚本化试玩、截图用。
//
//   const b = await launch({ width: 1280, height: 720 });
//   await b.goto('http://localhost:5199/plateau-lab.html?play');
//   await b.waitFor('window.plateau?.play?.ready');
//   await b.eval('plateau.simulate(2)');
//   await b.shot('docs/art/review/ch4-combat/xxx.jpg');
//   await b.close();
//
// Chromium 默认用本机 Playwright 装的那份（%LOCALAPPDATA%/ms-playwright/chromium-*），也可以用环境变量 CHROME 指定。
// 网页在后台标签页里不给 rAF：试玩一律用页面自己的 simulate(秒) 按固定步长推进，再手动渲染一帧截图。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
      const exe = join(base, d, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('找不到 Chromium：设置环境变量 CHROME 指向 chrome.exe');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 起一个无头 Chromium；偶尔起不来（端口占用、沙箱）就换端口重试 */
export async function launch(o = {}) {
  for (let k = 0; k < 4; k++) {
    try { return await launchOnce({ ...o, port: 9300 + Math.floor(Math.random() * 600) }); } catch (e) { if (k === 3) throw e; }
  }
}

async function launchOnce({ width = 1280, height = 720, port = 9300, headless = true } = {}) {
  const profile = join(tmpdir(), `ch4-cdp-${process.pid}-${port}`);
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
  ];
  if (headless) args.push('--headless=new');
  const proc = spawn(findChrome(), [...args, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let k = 0; k < 200 && !targets; k++) {
    await sleep(150);
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* 还没起来 */ }
  }
  const page = targets?.find(t => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('Chromium 没有起来'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${msg.params.type}] ${msg.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const api = {
    send, logs,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(300);
    },
    /** 在页面里求值（表达式，支持 await），返回 JSON 值 */
    async eval(expr, timeoutMs = 600000) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
      if (r.exceptionDetails) throw new Error(`页面里出错：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n表达式：${expr.slice(0, 300)}`);
      return r.result.value;
    },
    async waitFor(expr, timeoutMs = 120000) {
      const t0 = Date.now();
      for (;;) {
        try { if (await api.eval(`!!(${expr})`)) return; } catch { /* 页面还在加载 */ }
        if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${expr}\n${logs.slice(-20).join('\n')}`);
        await sleep(250);
      }
    },
    /** 截当前画面（JPEG / PNG 按扩展名） */
    async shot(path, quality = 86) {
      const png = path.endsWith('.png');
      const r = await send('Page.captureScreenshot', { format: png ? 'png' : 'jpeg', quality: png ? undefined : quality });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    },
    async close() {
      try { await send('Browser.close'); } catch { /* 已经关了 */ }
      ws.close();
      await sleep(200);
      proc.kill();
    },
  };
  return api;
}
