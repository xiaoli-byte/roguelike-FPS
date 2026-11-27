// 一次性搬数据（用户 2026-11-26：「以后unity是要删除的」）：把第四章场景文档（public/assets/levels/<图>/level.json，
// 2026-11-27 前在 public/assets/unity-levels/scenes/<图>.json——都是 Unity 导出的）里的玩法部分
// （出生、边界、据点波次、入场点、出口、领主、导航网格、水面、小地图、机关）抽出来，存进网页自己的目录 public/assets/plateau/。
// 场景本身（地形、碰撞、模型）不搬——正式游戏里的第四章改用网页原生的高原场景（src/world/plateau/stage/）。
// 坐标照旧是正式游戏的坐标（Unity 导出时已经换成了网页坐标：正式 4-1 = 高原检视页 4-1 绕竖轴转 180°）。
//
//   node scripts/plateau/extract-play.mjs 4-1
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const id = process.argv[2];
if (!id) { console.log('用法：node scripts/plateau/extract-play.mjs <图号，如 4-1>'); process.exit(1); }
const src = [join(ROOT, 'public/assets/levels', id, 'level.json'), join(ROOT, 'public/assets/unity-levels/scenes', `${id}.json`)].find(f => existsSync(f));
if (!src) { console.log(`找不到 ${id} 的场景文档`); process.exit(1); }
const doc = JSON.parse(readFileSync(src, 'utf8'));
const outDir = join(ROOT, 'public/assets/plateau');
mkdirSync(outDir, { recursive: true });

const KEEP = ['schema', 'id', 'title', 'spawn', 'bounds', 'visualBounds', 'environment', 'encounters', 'exits', 'caches', 'camps', 'bosses', 'entries', 'layout', 'navigation', 'water', 'platforms', 'activators', 'mechanisms'];
const play = Object.fromEntries(KEEP.filter(k => doc[k] !== undefined).map(k => [k, doc[k]]));
// 水面只要碰撞 / 游泳要的几何，Unity 的材质名之类留着无妨；小地图拷一份过来
if (doc.map?.url) {
  const file = `${id}-map${doc.map.url.slice(doc.map.url.lastIndexOf('.'))}`;
  copyFileSync(join(ROOT, 'public', doc.map.url), join(outDir, file));
  play.map = { url: `assets/plateau/${file}`, area: doc.map.area };
}
// 机关（天气、软边界、导体、据点）：软边界的距离场是单独的二进制文件，一起拷过来
const boundary = play.mechanisms?.boundary;
if (boundary?.url) {
  const file = `${id}-boundary${boundary.url.slice(boundary.url.lastIndexOf('.'))}`;
  copyFileSync(join(ROOT, 'public', boundary.url), join(outDir, file));
  play.mechanisms = { ...play.mechanisms, boundary: { ...boundary, url: `assets/plateau/${file}` } };
}
// 导航网格的数字取 3 位小数（米级的网格，毫米够了），文件小一半
const round = v => Math.round(v * 1000) / 1000;
play.navigation = { ...play.navigation, vertices: play.navigation.vertices.map(p => p.map(round)) };
const out = join(outDir, `${id}.play.json`);
writeFileSync(out, JSON.stringify(play));
console.log(`${basename(src)} → ${out}（${(readFileSync(out).length / 1024).toFixed(0)} KB）：据点 ${play.encounters.length}、领主 ${play.bosses.length}、出口 ${play.exits.length}、导航三角形 ${play.navigation.indices.length / 3}、水面 ${play.water.length}、机关 ${Object.keys(play.mechanisms ?? {}).join(' / ') || '无'}`);
