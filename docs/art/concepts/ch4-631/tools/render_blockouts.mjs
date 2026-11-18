// 第四章三张概念图的白模底图：在真实（或按设计稿搭的）场景里从概念机位渲染一张白模，
// 并用同一台相机把据点 / 驻守点 / 入场点 / 路线投影成画面坐标（带地形 / 墙块遮挡）→ tools/views/<图>.json。
// 概念图在这张白模上重绘（图生图），叠标按投影坐标画（route_maps.py），所以画里的东西和标注都在真实位置上。
//   node docs/art/concepts/ch4-631/tools/render_blockouts.mjs [4-2] [4-4] [4-A]
// 4-2 / 4-4 打包检视页 src/dev/gorgeLab.ts、haiziLab.ts；4-A 还没有场景，打包 tools/fortress_blockout.ts（按 maps/4-A.md 搭的最简白模）。
// 打成 iife 在无头 Chromium（scripts/plateau/cdp.mjs）里跑 file:// 页面，不用开 dev 服务器。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../../../../../scripts/plateau/cdp.mjs';

const root = resolve('.');
const HERE = join(root, 'docs/art/concepts/ch4-631');
const OUT = join(tmpdir(), 'ch4-631-blockouts');
mkdirSync(OUT, { recursive: true });
const W = 1536, H = 864;
// 机位（README 第 1 节）：yaw / pitch 是度（yaw = −方位角，北 = 0、顺时针），fov 是竖直视角
const VIEWS = {
  '4-2': { entry: 'src/dev/gorgeLab.ts', page: 'lab', file: '4-2_gorge', yaw: -40, pitch: -10, fov: 72, pos: [-160, 100] },
  '4-2b': { entry: 'src/dev/gorgeLab.ts', page: 'lab', file: '4-2_gorge_bridge', yaw: -48, pitch: 4, fov: 72, pos: [-62, 98] },
  '4-4': { entry: 'src/dev/haiziLab.ts', page: 'lab', file: '4-4_haizi', yaw: -15, pitch: 3, fov: 50, pos: null },
  '4-A': { entry: 'docs/art/concepts/ch4-631/tools/fortress_blockout.ts', page: 'bare', file: '4-A_fortress', yaw: -52, pitch: 5, fov: 36, pos: [-150, 130] },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWS);   // 4-2b = 西桥头机位（铁索桥）

// rolldown 原生库包缺 package.json 时（node_modules 装坏过）直接指过去
const bindingDir = join(root, 'node_modules/@rolldown');
if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH && existsSync(bindingDir)) {
  for (const d of readdirSync(bindingDir).filter(n => n.startsWith('binding-'))) {
    const f = readdirSync(join(bindingDir, d)).find(n => n.endsWith('.node'));
    if (f && !existsSync(join(bindingDir, d, 'package.json'))) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = join(bindingDir, d, f);
  }
}
const { build } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
const three = `${root.replaceAll(String.fromCharCode(92), '/')}/node_modules/three`;

// ───── 4-2：坐标抄 src/world/gorge/spec.ts 和 README 3.1（已用 reach_probe 验过）
const GORGE = {
  spawnVp: 'spawn',
  points: [
    ['site', '1', '① 甲居寨坡', -122, -4], ['site', '2', '② 铁索桥（西桥头）', -52, 84], ['lord', '3', '③ 江嘴 · 大鹗', 12, -114],
    ['site', '4', '④ 绝壁驿站', 94, -10], ['site', '5', '⑤ 河滩磨坊', -52, 194], ['exit', '出', '⑦ 古驿道', 206, 2],
    ['guard', 'G', 'G1 吊桥东头', 186, -118], ['guard', 'G', 'G2 伸臂桥西头', -230, -157], ['guard', 'G', 'G3 栈道岩龛', 28.6, -13.3, 31.5], ['guard', 'G', 'G4 回头弯', -60, 138],
    ['entry', 'E', 'E1 岩洞', -236, 52], ['entry', 'E', 'E2 寨后林线', -178, -40], ['entry', 'E', 'E3 伸臂桥北头', -240, -205], ['entry', 'E', 'E4 江嘴北脊', 10, -196],
    ['entry', 'E', 'E5 吊桥东山道', 214, -112], ['entry', 'E', 'E6 古驿道外', 218, 2], ['entry', 'E', 'E7 江嘴尖（飞临）', -4, -30], ['entry', 'E', 'E8 东岸水边', 40, 190],
    ['poi', '', '西桥头雷桩', -38, 84], ['poi', '', '东桥头雷桩', 46, 42], ['poi', '', '西桥楼', -45, 76], ['poi', '', '东桥楼', 41, 49],
  ],
  // 路：trail id（地形上的骡道）或显式点（x, z, y）
  routes: [
    ['main', ['trail:w1', 'trail:w2', [[-36, 72.8, 20.5], [-2, 61.5, 18.1], [33, 51.9, 20.5]], 'trail:e2', 'trail:e3']],
    ['alt', ['trail:w3']],
    ['alt', ['trail:w4', [[-150, -52, 40], [-116, -76.5, 26], [-82, -101, 17]], 'trail:n1']],
    ['alt', ['trail:n3', [[156, -170, 35], [171, -144, 31.8], [186, -118, 35]], 'trail:e4r']],
    ['roam', [[[-170, 60, null], [-150, 20, null], [-110, -40, null], [-80, 20, null], [-58, 90, null], [-56, 130, null], [-46, 170, null], [-90, 150, null], [-140, 120, null], [-170, 60, null]]]],
  ],
};
// ───── 4-4：坐标抄 src/world/haizi/spec.ts 和 README 3.2
const ring = (a0, a1, r = 63, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [Math.sin(a) * r, -Math.cos(a) * r, null]; });
const HAIZI = {
  spawnVp: 'spawn',
  points: [
    ['lord', '首', '雷泽雷神升起处', 0, -16, 6], ['exit', '坛', '终局灵火坛', 0, 0, null, 1.5],
    ['poi', '', '北柱', 0, -60, null, 7], ['poi', '', '东柱', 60, 0, null, 7], ['poi', '', '西柱', -60, 0, null, 7], ['poi', '', '南柱', 0, 60, null, 7],
    ['entry', 'E', 'E1 北垭口', 14, -77], ['entry', 'E', 'E2 冰舌脚', -66, -40], ['entry', 'E', 'E3 东坡', 76, -14], ['entry', 'E', 'E4 西南雪坡', -56, 52],
    ['entry', 'E', 'E5 西北岸（飞临）', -48, -32], ['entry', 'E', 'E6 东岸（飞临）', 50, 24],
  ],
  routes: [['main', [ring(195, 330)]], ['main', [ring(165, 30)]], ['alt', [[[-18, 67, null], [-14, 50, -0.5], [-22, 30, 0.5], [-12, 14, 0.5], [-4, 7, 1.5]]]]],
};

function pageScript(cfg, yaw, pitch, fov, pos) {
  return `(() => {
    const G = window.gorge ?? window.haizi;
    const st = document.createElement('style');
    st.textContent = '#panel,#map,#hud,#perf,#hint,#checks,#cross,#maps,#loading,#storm,#storm-text,#toggle{display:none!important}';
    document.head.appendChild(st);
    const mon = document.getElementById('opt-monsters'); if (mon && mon.checked) { mon.checked = false; mon.dispatchEvent(new Event('change')); }
    const V = G.camera.position.constructor;
    const cfg = ${JSON.stringify(cfg)};
    G.goTo(G.VIEWPOINTS.find(v => v.id === cfg.spawnVp));
    ${pos ? `G.walker.place(${pos[0]}, ${pos[1]});` : ''}
    G.walker.yaw = ${yaw}; G.walker.pitch = ${pitch};
    (G.sim ?? G.simulate)(0.3, 1 / 30, false);
    G.walker.yaw = ${yaw}; G.walker.pitch = ${pitch};
    (G.sim ?? G.simulate)(1 / 30, 1 / 30, false);
    if (G.flight) G.flight.fov = ${fov};   // 4-2 检视页每帧把相机视角重置成 flight.fov（默认 72°），截图前页面会再画一帧
    G.renderer.setPixelRatio(1); G.renderer.setSize(${W}, ${H}, false);
    G.camera.aspect = ${W} / ${H}; G.camera.fov = ${fov}; G.camera.updateProjectionMatrix();
    G.renderer.render(G.scene, G.camera);
    const T = G.terrain, cam = G.camera, eye = cam.position.clone();
    const proj = (x, y, z) => { const v = new V(x, y, z).project(cam); const vis = v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
      const los = T.lineOfSight(eye.x, eye.y, eye.z, x, y + 1.2, z); return [+(((v.x + 1) / 2) * ${W}).toFixed(1), +(((1 - v.y) / 2) * ${H}).toFixed(1), vis && v.z < 1 ? 1 : 0, los ? 1 : 0, +Math.hypot(x - eye.x, z - eye.z).toFixed(0)]; };
    const ground = (x, z) => T.heightAt(x, z);
    const points = cfg.points.map(([kind, letter, label, x, z, y, hOff]) => ({ kind, letter, label, x, z, s: proj(x, (y ?? ground(x, z)) + (hOff ?? 0), z) }));
    const trail = id => { const rev = id.endsWith('r'); const t = (T.trails || []).find(t => t.id === (rev ? id.slice(0, -1) : id)); if (!t) return []; const p = t.pts.map(q => [q.x, q.z, q.y]); return rev ? p.reverse() : p; };
    const routes = cfg.routes.map(([style, parts]) => { const pts = []; for (const part of parts) { const arr = typeof part === 'string' ? trail(part.slice(6)) : part; for (const [x, z, y] of arr) pts.push(proj(x, (y ?? ground(x, z)) + 0.3, z)); } return { style, pts }; });
    return JSON.stringify({ eye: [eye.x, eye.y, eye.z].map(v => +v.toFixed(1)), yaw: ${yaw}, pitch: ${pitch}, fov: ${fov}, W: ${W}, H: ${H}, canvas: [G.renderer.domElement.width, G.renderer.domElement.height], points, routes });
  })()`;
}


// ───── 4-A：和 route_check_4A.py / maps/4-A.md 同一组数据
const POINTS = [
  ['site', '1', '① 河畔村寨', -75, 0], ['site', '2', '② 山门下院', 62, 66, 6], ['site', '3', '③ 坡道中台', 113, 24, 26], ['site', '4', '④ 煨桑台', 190, 22, 14],
  ['site', '5', '⑤ 残碉', -60, -165], ['lord', '6', '⑥ 顶殿前庭', 128, -30, 48], ['exit', '出', '后山口经幡门', 160, -95, 56], ['exit', '出', '西口', -222, 60],
  ['guard', 'G', 'G1 石桥', -20, 95, 3], ['guard', 'G', 'G2 上游冰滩', 4, -26], ['guard', 'G', 'G3 西坡缺口', 85, -10, 26], ['guard', 'G', 'G4 转经道拐角', 196, -40, 24],
  ['entry', 'E', 'E1 西口山道', -200, 84], ['entry', 'E', 'E2 村北林线', -118, -70], ['entry', 'E', 'E3 啸獭洞', -110, 92], ['entry', 'E', 'E4 溪谷上游（飞临）', 6, -150],
  ['entry', 'E', 'E5 山门增援门', 45, 75, 6], ['entry', 'E', 'E6 西墙头跃下', 74, -16, 21], ['entry', 'E', 'E7 东坡崖顶跃下', 194, -8, 18], ['entry', 'E', 'E8 后山口外', 170, -118, 58],
];
const ROUTES = [
  ['main', [[-150, 130, null], [-110, 128, null], [-70, 110, null], [-40, 112, null], [-20, 95, 3], [6, 86, null], [30, 82, null], [45, 75, 6], [58, 62, 6],
    [80, 50, 11], [60, 38, 16], [84, 26, 21], [104, 30, 26], [122, 18, 26], [106, 4, 32], [126, -14, 38], [112, -24, 43], [126, -36, 48], [148, -60, 52], [160, -95, 56]]],
  ['alt', [[-110, 128, null], [-90, 60, null], [-75, 0, null], [-30, -14, null], [4, -22, null], [36, -30, 8], [62, -22, 17], [85, -10, 26], [104, 4, 26], [113, 24, 26]]],
  ['alt', [[45, 75, 6], [70, 122, 7], [140, 128, 8], [190, 80, 10], [190, 22, 14], [196, -40, 24], [170, -70, 34], [150, -52, 44], [126, -36, 48]]],
  ['alt', [[-75, 0, null], [-90, -60, null], [-70, -120, null], [-60, -165, null]]],
  ['roam', [[-60, -165, null], [-100, -80, null], [-120, 40, null], [-60, 110, null], [-20, 95, 3], [-60, 60, null], [-110, -40, null], [-60, -165, null]]],
];

async function bundle(id) {
  const v = VIEWS[id];
  await build({
    configFile: false, root, logLevel: 'warn', publicDir: false,
    define: { 'import.meta.url': JSON.stringify('file:///' + root.replaceAll(String.fromCharCode(92), '/') + '/src/dev/lab.js') },
    resolve: { alias: [{ find: /^three$/, replacement: `${three}/build/three.module.js` }, { find: /^three\/addons\/(.*)$/, replacement: `${three}/examples/jsm/$1` }, { find: /^three\/(.*)$/, replacement: `${three}/$1` }] },
    build: { outDir: OUT, emptyOutDir: false, copyPublicDir: false, minify: false, target: 'es2022',
      lib: { entry: join(root, v.entry), name: `bo_${v.file.replace(/\W/g, '_')}`, formats: ['iife'], fileName: () => `${v.file}.js` } },
  });
  const html = v.page === 'lab'
    ? readFileSync(join(root, 'plateau-lab.html'), 'utf8').replace(/<script type="module"[^>]*><\/script>/, `<script src="${v.file}.js"></script>`)
    : `<!doctype html><meta charset="utf-8"><body><script src="${v.file}.js"></script>`;
  writeFileSync(join(OUT, `${v.file}.html`), html);
}

async function shoot(id) {
  const v = VIEWS[id];
  const deg = a => (a * Math.PI) / 180;
  for (let attempt = 0; attempt < 3; attempt++) {
    let b;
    try {
      b = await launch({ width: W, height: H });
      await b.goto(pathToFileURL(join(OUT, `${v.file}.html`)).href);
      let r;
      if (v.page === 'lab') {
        await b.waitFor('(window.gorge ?? window.haizi) !== undefined', 180000);
        r = await b.eval(pageScript(v.entry.includes('gorge') ? GORGE : HAIZI, deg(v.yaw), deg(v.pitch), v.fov, v.pos));
      } else {
        await b.waitFor('window.fortress !== undefined', 120000);
        const [px, pz] = v.pos, yaw = v.yaw, pitch = v.pitch, fov = v.fov;
        r = await b.eval(`(() => {
    const F = window.fortress;
    F.render(${px}, ${pz}, ${yaw}, ${pitch}, ${fov});
    const P = ${JSON.stringify(POINTS)}, R = ${JSON.stringify(ROUTES)};
    const dens = pts => { const out = []; for (let i = 0; i + 1 < pts.length; i++) { const [ax, az, ay] = pts[i], [bx, bz, by] = pts[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let k = 0; k < n; k++) { const t = k / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t; const y = ay == null || by == null ? null : ay + (by - ay) * t; out.push([x, z, y]); } } out.push(pts[pts.length - 1]); return out; };
    const points = P.map(([kind, letter, label, x, z, y]) => ({ kind, letter, label, x, z, s: F.project(x, z, y == null ? null : y) }));
    const routes = R.map(([style, pts]) => ({ style, pts: dens(pts).map(([x, z, y]) => F.project(x, z, y == null ? null : y + 0.3)) }));
    return JSON.stringify({ W: ${W}, H: ${H}, points, routes });
  })()`);
      }
      writeFileSync(join(HERE, 'tools/views', `${id}.json`), r);
      await b.shot(join(HERE, `${v.file}_blockout.jpg`), 88);
      console.log('ok', id);
      return;
    } catch (e) {
      console.warn(`${id} 第 ${attempt + 1} 次失败：${e.message}`);   // 机器内存紧时 Chromium 偶尔起不来
    } finally { if (b) await b.close(); }
  }
  throw new Error(`${id} 渲染失败`);
}

for (const id of wanted) { await bundle(id); await shoot(id); }
