// 每张图 / 每章会出现的敌人与首领 → public/assets/unity-levels/rosters.json（几 KB）。
//
//   node scripts/web/export-stage-rosters.mjs            写
//   node scripts/web/export-stage-rosters.mjs --check    只核对发布的文件是不是由当前场景文档生成的（不写）
//
// 为什么要它：美术资产按需加载（src/assets/StageArt.ts）。进关前要知道这一关会刷哪些敌人，好把它们的模型先读进来、
// 把用不到的释放掉。这一关自己的场景文档里有遭遇波次，但首领关的文档没有波次——旱魃召沙魇 / 蝎弓手 / 邪飞天、
// 火麒麟召炭童 / 火鸦，召的都是本章名册里的敌人；场景文档一张 7–33 MB，进关时不该为了名册把全章的文档都读一遍。
// 所以离线汇总：每张图的波次敌人（含各布局变体改写的场地编制）与首领 id，每章取并集。
// 场景文档改了（重新导出 / 发布 unity-levels）要重跑；tests/stage-rosters.test.mjs 跑 --check。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCENES = join(ROOT, 'public/assets/unity-levels/scenes');
const OUT = join(ROOT, 'public/assets/unity-levels/rosters.json');

/** 一份场景文档里会出现的敌人（遭遇波次 + 布局变体改写的场地编制）与首领 */
export function sceneRoster(doc) {
  const enemies = new Set();
  const waves = (list) => {
    for (const wave of list ?? []) for (const entry of wave?.entries ?? []) if (entry?.enemy) enemies.add(entry.enemy);
  };
  for (const site of doc.encounters ?? []) waves(site.waves);
  for (const variant of doc.layout?.variants ?? []) for (const site of variant.sites ?? []) waves(site.spec?.waves);
  const bosses = new Set((doc.bosses ?? []).map((b) => b.id).filter(Boolean));
  return { enemies: [...enemies].sort(), bosses: [...bosses].sort() };
}

/** 图编号 → 章（1-based）：「1-2」「1-A」都是第一章 */
export const chapterOf = (mapId) => Number.parseInt(mapId, 10);

export function buildRosters(scenesDir = SCENES) {
  const maps = {};
  const chapters = {};
  for (const file of readdirSync(scenesDir).filter((f) => f.endsWith('.json')).sort()) {
    const id = file.replace(/\.json$/, '');
    const chapter = chapterOf(id);
    if (!Number.isFinite(chapter)) continue;
    const roster = sceneRoster(JSON.parse(readFileSync(join(scenesDir, file), 'utf8')));
    maps[id] = { chapter, ...roster };
    const all = new Set(chapters[chapter] ?? []);
    for (const e of roster.enemies) all.add(e);
    chapters[chapter] = [...all].sort();
  }
  return { schema: 1, source: 'public/assets/unity-levels/scenes（scripts/web/export-stage-rosters.mjs）', maps, chapters };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = `${JSON.stringify(buildRosters(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
      console.error('rosters.json 过期：重跑 node scripts/web/export-stage-rosters.mjs');
      process.exit(1);
    }
    console.log('rosters.json 与场景文档一致');
  } else {
    writeFileSync(OUT, text);
    console.log(`写入 ${OUT}`);
  }
}
