// 看效果的流程工具（docs/art/reference-tingyuyuan.md 第四节第 10 项）：无头 Chrome 打开高原检视页 / 材质样板页，
// 调页面里的 lookdev（src/world/plateau/lookdev.ts）出图、量开销、找闪点。要先开着开发服务器（npm run dev -- --port 5199）。
//
//   node scripts/plateau/lookdev.mjs shots    [--maps 4-1,4-2,4-4,matboard] [--weather clear,storm] [--round 名字] [--against 上一轮]
//       固定机位（每张图的 VIEWPOINTS）逐个出图，存到 <out>/<轮>/<图>/；有上一轮就拼「上一轮 | 这一轮 | 差异」对比图、列出每个机位变了多少
//   node scripts/plateau/lookdev.mjs toggles  --map 4-4 [--view 0] [--weather storm]
//       同一机位全开出一张，再逐项关掉各出一张（出图后期、泛光、AO、交界、淋湿、雨……），拼成一张、标上画面变了多少和省了几毫秒
//   node scripts/plateau/lookdev.mjs fireflies [--maps 4-1,4-2,4-4] [--weather clear]
//       每个机位抖镜头连拍找闪点，存叠了红（孤立闪点）黄（边缘 / 细线在爬）标记的图，列占比和最集中的地方
//   node scripts/plateau/lookdev.mjs warm     --map 4-4
//       预热对照：warm=0 / 预热各开一次，转一圈 8 个方向，量每个方向第一帧的耗时（转身卡不卡）
//
// 公共参数：--out 目录（缺省系统临时目录下的 roguelike-lookdev，图不进仓库）、--port 5199、--width 1280 --height 720
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('out', join(tmpdir(), 'roguelike-lookdev'));
const PORT = +opt('port', 5199);
const W = +opt('width', 1280), H = +opt('height', 720);

/** 每张图：网址参数、调试入口名 */
const MAPS = {
  '4-1': { q: '', handle: 'plateau' },
  '4-2': { q: '?map=4-2', handle: 'gorge' },
  '4-4': { q: '?map=4-4', handle: 'haizi' },
  matboard: { q: '?matboard=1', handle: 'matboard' },
};
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const py = (args) => execFileSync('python', [join(HERE, 'lookdev_sheet.py'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

/** 打开一张图：等调试入口、点掉「开始游玩 / 检视地图」、收面板、藏 HUD、关颗粒（对比要稳） */
async function open(b, key, extraQuery = '') {
  const M = MAPS[key];
  if (!M) throw new Error(`不认识的图：${key}（可选 ${Object.keys(MAPS).join(' / ')}）`);
  const q = M.q ? `${M.q}${extraQuery ? '&' + extraQuery : ''}` : (extraQuery ? `?${extraQuery}` : '');
  await b.goto(`http://localhost:${PORT}/plateau-lab.html${q}`);
  await b.waitFor(`window.${M.handle} !== undefined && window.${M.handle}.lookdev`, 240000);
  await b.eval(`new Promise(r => setTimeout(r, 1500))`);
  await b.eval(`(() => { const btn = document.getElementById('btn-inspect'); if (btn) btn.click();
    document.getElementById('panel')?.classList.add('collapsed');
    for (const id of ['hud', 'map', 'hint', 'cross']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    window.${M.handle}.film.flags.grain = false; return 1; })()`);
  return M.handle;
}
/** 推进 seconds 秒（不渲染；各页的 simulate 签名不一样） */
const sim = (h, s) => `(String(window.${h}.simulate).includes('hold') ? window.${h}.simulate(${s}, [], 1/30) : window.${h}.simulate(${s}, 1/30, false))`;
/** 到机位 i、定天气、推进到天气稳定（雷暴程度到位；雷暴再多等 15 s 让地面湿透）、画一帧 */
async function frame(b, h, i, weather) {
  const storm = weather === 'storm';
  return b.eval(`(() => { const H = window.${h}; H.goTo(H.VIEWPOINTS[${i}]); H.weather.stormy = ${storm};
    for (let k = 0; k < 90 && Math.abs(H.weather.level - ${storm ? 1 : 0}) > 0.01; k++) ${sim(h, 1)};
    ${sim(h, storm ? 15 : 1)}; H.goTo(H.VIEWPOINTS[${i}]); H.render(); const v = H.VIEWPOINTS[${i}]; return { id: v.id ?? String(${i}), name: v.name ?? '' }; })()`);
}
const safe = s => String(s).replace(/[^\w一-龥-]+/g, '_');
/** 定格出图（时间定在同一刻、只要画布），写成 JPEG */
async function snap(b, h, file) {
  const url = await b.eval(`window.${h}.lookdev.snapshot(10)`);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

/** 出错（多半是别的会话改文件、页面被热更新刷新）重试一次 */
async function withRetry(fn) {
  try { return await fn(); } catch (err) {
    console.warn(`  出错，重试一次：${String(err.message).split('\n')[0]}`);
    return fn();
  }
}

async function shots() {
  const maps = opt('maps', '4-1,4-2,4-4,matboard').split(',');
  const weathers = opt('weather', 'clear,storm').split(',');
  const round = opt('round', stamp());
  const roundDir = join(OUT, round);
  const b = await launch({ width: W, height: H });
  try {
    for (const key of maps) {
      await withRetry(async () => {
        const h = await open(b, key);
        const n = await b.eval(`window.${h}.VIEWPOINTS.length`);
        const dir = join(roundDir, key);
        mkdirSync(dir, { recursive: true });
        // 天气在外层（先晴后雷暴）：雷暴之后接着拍晴天，天还没放晴、地还湿着
        for (const w of [...weathers].sort((a, c) => (a === 'storm' ? 1 : 0) - (c === 'storm' ? 1 : 0))) for (let i = 0; i < n; i++) {
          const v = await frame(b, h, i, w);
          await snap(b, h, join(dir, `${String(i).padStart(2, '0')}-${safe(v.id)}-${w}.jpg`));
        }
        console.log(`${key}：${n} 个机位 × ${weathers.length} 种天气 → ${dir}`);
      });
    }
  } finally { await b.close(); }
  // 和上一轮比
  const prev = opt('against', null) ?? readdirSync(OUT).filter(d => d !== round && statSync(join(OUT, d)).isDirectory())
    .sort((a, c) => statSync(join(OUT, c)).mtimeMs - statSync(join(OUT, a)).mtimeMs)[0];
  if (!prev || !existsSync(join(OUT, prev))) { console.log(`第一轮（${round}），没有可比的上一轮。`); return; }
  for (const key of maps) {
    const a = join(OUT, prev, key), c = join(roundDir, key);
    if (!existsSync(a)) continue;
    process.stdout.write(py(['compare', a, c, join(roundDir, `compare-${key}-${prev}-vs-${round}.jpg`), prev, round]));
  }
}

async function toggles() {
  // 缺省晴天：雷暴的闪电随机，会让两张图的亮度对不上
  const key = opt('map', '4-4'), view = +opt('view', 0), weather = opt('weather', 'clear');
  const dir = join(OUT, `toggles-${key}-${view}-${weather}-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  const b = await launch({ width: W, height: H });
  let rows = [];
  try {
    await withRetry(async () => {
    rows = [];
    const h = await open(b, key);
    await frame(b, h, view, weather);
    await snap(b, h, join(dir, '00-all.jpg'));
    const sw = await b.eval(`window.${h}.lookdev.switches.map(s => ({ id: s.id, label: s.label, on: s.get() }))`);
    for (const [k, s] of sw.entries()) {
      if (!s.on || s.id === 'grain') continue;
      await b.eval(`(() => { const H = window.${h}; const s = H.lookdev.switches.find(x => x.id === '${s.id}'); s.set(false); H.render(); H.render(); return 1; })()`);
      const file = `${String(k + 1).padStart(2, '0')}-${s.id}.jpg`;
      await snap(b, h, join(dir, file));
      await b.eval(`(() => { const H = window.${h}; H.lookdev.switches.find(x => x.id === '${s.id}').set(true); H.render(); return 1; })()`);
      rows.push({ file, id: s.id, label: s.label });
    }
    const prof = await b.eval(`window.${h}.lookdev.profile().then(r => r)`);
    for (const r of rows) r.ms = prof.rows.find(x => x.id === r.id)?.delta ?? null;
    writeFileSync(join(dir, 'toggles.json'), JSON.stringify({ map: key, view, weather, base: prof.base, noise: prof.noise, method: prof.method, size: `${prof.width}×${prof.height}`, rows }, null, 1));
    console.log(`整帧 ${prof.base.toFixed(2)} ms（按 ${prof.width}×${prof.height} 测，${prof.method === 'gpu' ? 'GPU 计时' : 'CPU + 同步'}，噪声 ±${prof.noise.toFixed(2)} ms）`);
    });
  } finally { await b.close(); }
  process.stdout.write(py(['toggles', dir]));
}

async function fireflies() {
  const maps = opt('maps', '4-1,4-2,4-4').split(','), weather = opt('weather', 'clear');
  const dir = join(OUT, `fireflies-${weather}-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  const b = await launch({ width: W, height: H });
  const table = [];
  try {
    for (const key of maps) {
      await withRetry(async () => {
        const h = await open(b, key);
        const n = await b.eval(`window.${h}.VIEWPOINTS.length`);
        for (let i = 0; i < n; i++) {
          const v = await frame(b, h, i, weather);
          const r = await b.eval(`(() => { const R = window.${h}.lookdev.fireflies(8); return R; })()`);
          const file = join(dir, `${key}-${String(i).padStart(2, '0')}-${safe(v.id)}.jpg`);
          writeFileSync(file, Buffer.from(r.overlay.split(',')[1], 'base64'));
          table.push({ 图: key, 机位: v.name || v.id, '闪点 %': +(r.sparkleRatio * 100).toFixed(3), '边缘 / 细线 %': +(r.shimmerRatio * 100).toFixed(2), 最集中: r.hot.slice(0, 2).map(c => `(${c.x},${c.y})×${c.n}`).join(' ') });
        }
      });
    }
  } finally { await b.close(); }
  console.table(table);
  writeFileSync(join(dir, 'fireflies.json'), JSON.stringify(table, null, 1));
  console.log(`标记图在 ${dir}`);
}

async function warm() {
  const key = opt('map', '4-4');
  const res = {};
  // 每种各开一个全新的浏览器（新的配置目录 = 没有上一次留下的着色器缓存），才比得公平
  for (const mode of ['warm=0', '']) {
    const b = await launch({ width: W, height: H });
    try {
      await withRetry(async () => {
      const h = await open(b, key, mode);
      res[mode ? '不预热' : '预热'] = await b.eval(`(() => { const H = window.${h}; const gl = H.renderer.getContext(); const px = new Uint8Array(4);
        const out = []; const q0 = H.camera.quaternion.clone();
        for (let k = 0; k < 8; k++) { H.camera.quaternion.copy(q0); H.camera.rotateY(k * Math.PI / 4); H.camera.updateMatrixWorld(true);
          const t0 = performance.now(); H.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
        H.camera.quaternion.copy(q0);
        return { warmMs: Math.round(H.lookdev.warmMs), firstLookMs: out.map(x => Math.round(x)), worst: Math.round(Math.max(...out)) }; })()`);
      });
    } finally { await b.close(); }
  }
  console.log(JSON.stringify(res, null, 1));
}

const CMDS = { shots, toggles, fireflies, warm };
if (!CMDS[cmd]) {
  console.log('用法：node scripts/plateau/lookdev.mjs shots|toggles|fireflies|warm [参数]（见文件头）');
  process.exit(1);
}
await CMDS[cmd]();
