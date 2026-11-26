// 每张图 / 每章会出现的敌人与首领 → src/assets/stageRosters.ts（生成的 TS 表，运行时不读文件）。
//
//   node scripts/web/export-stage-rosters.mjs            写
//   node scripts/web/export-stage-rosters.mjs --check    只核对表是不是由当前关卡数据生成的（不写）
//
// 数据源：网页自己的关卡数据 public/assets/levels/<图>/level.json（2026-11-26 用户：「不能有任何依赖unity的代码」，
// unity/ 与 public/assets/unity-levels/ 以后整个删掉；level.json 由「Unity 迁移至 Three.js」会话一次性转换出来）。
// 字段按场景文档的约定读：encounters[].waves[].entries[].enemy、layout.variants[].sites[].spec.waves、bosses[].id。
//
// 为什么要它：美术资产按需加载（src/assets/StageArt.ts）。进关前要知道这一关会刷哪些敌人，好把它们的模型先读进来、
// 把用不到的释放掉。首领关的数据里没有波次——旱魃召沙魇 / 蝎弓手 / 邪飞天、火麒麟召炭童 / 火鸦，召的都是本章名册里的敌人，
// 所以离线汇总：每张图的波次敌人（含各布局变体改写的场地编制）与首领 id，每章取并集。
// 关卡数据改了要重跑；tests/stage-rosters.test.mjs 跑 --check（level.json 还没落地时跳过）。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LEVELS = join(ROOT, 'public/assets/levels');
const OUT = join(ROOT, 'src/assets/stageRosters.ts');

/** 一份关卡数据里会出现的敌人（遭遇波次 + 布局变体改写的场地编制）与首领 */
export function levelRoster(level) {
  const enemies = new Set();
  const waves = (list) => {
    for (const wave of list ?? []) for (const entry of wave?.entries ?? []) if (entry?.enemy) enemies.add(entry.enemy);
  };
  for (const site of level.encounters ?? []) waves(site.waves);
  for (const variant of level.layout?.variants ?? []) for (const site of variant.sites ?? []) waves(site.spec?.waves);
  const bosses = new Set((level.bosses ?? []).map((b) => b.id).filter(Boolean));
  return { enemies: [...enemies].sort(), bosses: [...bosses].sort() };
}

/** 图编号 → 章（1-based）：「1-2」「1-A」都是第一章 */
export const chapterOf = (mapId) => Number.parseInt(mapId, 10);

/** 有 level.json 的图编号（目录名） */
export function levelIds(dir = LEVELS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'level.json')) && Number.isFinite(chapterOf(d.name)))
    .map((d) => d.name).sort();
}

export function buildRosters(dir = LEVELS) {
  const maps = {};
  const chapters = {};
  for (const id of levelIds(dir)) {
    const chapter = chapterOf(id);
    const roster = levelRoster(JSON.parse(readFileSync(join(dir, id, 'level.json'), 'utf8')));
    maps[id] = { chapter, ...roster };
    const all = new Set(chapters[chapter] ?? []);
    for (const e of roster.enemies) all.add(e);
    chapters[chapter] = [...all].sort();
  }
  return { maps, chapters };
}

/** 生成的 TS 源码（键按字典序，换行统一 \n） */
export function renderTable(rosters) {
  const json = JSON.stringify({ maps: rosters.maps, chapters: rosters.chapters }, null, 2);
  return `// 生成文件：node scripts/web/export-stage-rosters.mjs（数据源 public/assets/levels/<图>/level.json），不要手改。
// 每张图的波次敌人与首领、每章的敌人并集；src/assets/StageArt.ts 进关前按它读敌人美术。
import type { StageRosters } from './StageArt';

export const STAGE_ROSTERS: StageRosters = ${json};
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (levelIds().length === 0) {
    console.error(`没有关卡数据：${LEVELS}/<图>/level.json（还没转换过来？）`);
    process.exit(1);
  }
  const text = renderTable(buildRosters());
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== text) {
      console.error('src/assets/stageRosters.ts 过期：重跑 node scripts/web/export-stage-rosters.mjs');
      process.exit(1);
    }
    console.log('stageRosters.ts 与关卡数据一致');
  } else {
    writeFileSync(OUT, text);
    console.log(`写入 ${OUT}`);
  }
}
