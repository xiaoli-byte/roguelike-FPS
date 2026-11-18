// 第四章 4-2 / 4-4 的可达性探针：照检视页组装地形和碰撞体，用 4-2 自动验收同一套行走规则（1 m 网格、坡 ≤ 40°、水深 ≤ 1.1 m、
// 往下跳 ≤ 3 m 单向、溜索单向），逐个查据点、驻守点、入场点能不能走到、能不能走回出口、怪从入场点能不能走到据点。
//   node scripts/plateau/reach_probe.mjs 4-2|4-4 [--cand '[["名字",x,z],…]']
// 不用开 dev 服务器：用 vite 的构建接口把 scripts/plateau/reach/<图>.ts 打成一个 iife，在无头 Chromium（cdp.mjs）里跑 file:// 页面。
// 本机 node_modules 里 rolldown 的原生库包缺 package.json 时，用 NAPI_RS_NATIVE_LIBRARY_PATH 直接指过去（不改 node_modules）。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const map = args[0];
const name = { '4-2': 'gorge', '4-4': 'haizi' }[map];
if (!name) { console.error('用法：node scripts/plateau/reach_probe.mjs 4-2|4-4 [--cand JSON]'); process.exit(2); }
const ci = args.indexOf('--cand');
const cand = ci >= 0 ? args[ci + 1] : '[]';
const root = resolve('.');
const bindingDir = join(root, 'node_modules/@rolldown');
if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH && existsSync(bindingDir)) {
  for (const d of readdirSync(bindingDir).filter(n => n.startsWith('binding-'))) {
    const f = readdirSync(join(bindingDir, d)).find(n => n.endsWith('.node'));
    if (f && !existsSync(join(bindingDir, d, 'package.json'))) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = join(bindingDir, d, f);
  }
}
const { build } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
const out = join(tmpdir(), 'ch4-reach-probe');
mkdirSync(out, { recursive: true });
const three = join(root, 'node_modules/three').split('\\').join('/');
await build({
  configFile: false, root, logLevel: 'warn', publicDir: false,
  resolve: { alias: [{ find: /^three$/, replacement: `${three}/build/three.module.js` }, { find: /^three\/addons\/(.*)$/, replacement: `${three}/examples/jsm/$1` }, { find: /^three\/(.*)$/, replacement: `${three}/$1` }] },
  build: { outDir: out, emptyOutDir: false, copyPublicDir: false, minify: false, target: 'es2022',
    lib: { entry: join(root, `scripts/plateau/reach/${name}.ts`), name: `reach_${name}`, formats: ['iife'], fileName: () => `${name}.js` } },
});
writeFileSync(join(out, `${name}.html`), `<!doctype html><meta charset="utf-8"><body><script src="${name}.js"></script>`);
const b = await launch({ width: 800, height: 600 });
let r;
try {
  await b.goto(pathToFileURL(join(out, `${name}.html`)).href);
  await b.waitFor('typeof window.__run === "function"', 120000);
  r = JSON.parse(await b.eval(`(window.__cand = ${cand}, JSON.stringify(window.__run()))`));
} finally { await b.close(); }
if (r.error) { console.error(r.error); process.exit(1); }
const yes = v => (v === null || v === undefined ? '—' : v ? '✓' : '✗');
let bad = 0;
if (name === 'gorge') {
  console.log('| 点 | 地面高 | 坡 | 水深 | 出生走得到 | 走得回出口 | 怪走得到据点 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const p of r.rows) {
    const ok = p.reachFromSpawn && p.reachExit && p.toSites !== false;
    bad += !ok;
    console.log(`| ${p.id} ${p.name} | ${p.h} | ${p.slope}° | ${p.wet} | ${yes(p.reachFromSpawn)} | ${yes(p.reachExit)} | ${yes(p.toSites)} |${ok ? '' : ` 最近可达 ${JSON.stringify(p.nearestReachable)}`}`);
  }
  for (const c of r.cand) console.log('候选', JSON.stringify(c));
} else {
  console.log(`湖岸环每 10° 一个扇区可走比例（0 = 北，顺时针）：${r.sectors.join(' ')}`);
  console.log(`导雷石柱四周 8 个方向站得到：${r.pillarAccess.map(p => `${p.id} ${p.ok}/8`).join('　')}；掩体：${r.placeAccess.map(p => `${p.kind} ${p.sides}/8`).join('、')}`);
  console.log('| 点 | 离湖心 | 地面高 | 坡 | 出生走得到 |');
  console.log('|---|---|---|---|---|');
  for (const p of r.pts) { bad += !p.reach; console.log(`| ${p.id} | ${p.r} m | ${p.h} | ${p.slope}° | ${yes(p.reach)} |${p.reach ? '' : ` 最近可达 ${JSON.stringify(p.nearest)}`}`); }
  bad += r.sectors.some(v => v < 90) + r.pillarAccess.some(p => p.ok < 6);
}
console.log(bad ? `${bad} 项不通过` : '全部通过');
process.exit(bad ? 1 : 0);
