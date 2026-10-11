import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = fileURLToPath(new URL('../../src/', import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute output directory.');
const tempRoot = path.resolve(tmpdir());
const temp = await mkdtemp(path.join(tempRoot, 'spiritfire-catalog-'));
const graph = new Map();
// 保存此次重做前的说明，供图鉴直接对照；当前效果始终从运行时定义读取。
const beforeRedesign = {
  crit_streak: '武器暴击后 3 秒内，暴击率每层 +5%。',
  meteor_shot: '弹速每层 +20%，武器伤害每层 +3%。',
  treasure_bowl: '每进入新关卡，获得当前金币 10% 的利息（每层上限 40，随章节提高）。',
  tac_loaded_focus: '换弹完成后 6 秒内，暴击伤害每层 +15%。',
  tac_alternating_arts: '在 6 秒内交替释放 Q 与 E 后，5 秒内技能伤害每层 +15%；连续使用同一技能不触发。',
  tac_reaction_ward: '直接引发元素反应时每层回复 4 护盾；冷却 0.6 秒。衍生反应不触发。',
};
async function ts(relative) {
  const sourcePath = path.resolve(root, relative);
  if (graph.has(sourcePath)) return graph.get(sourcePath);
  const destination = path.join(temp, path.relative(root, sourcePath)).replace(/\.ts$/, '.mjs');
  const url = pathToFileURL(destination).href;
  graph.set(sourcePath, url);
  let source = stripTypeScriptTypes(await readFile(sourcePath, 'utf8'), { mode: 'transform' });
  for (const match of [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)]) {
    const specifier = match[1];
    const resolved = specifier.startsWith('.')
      ? await ts(path.relative(root, path.resolve(path.dirname(sourcePath), specifier + '.ts')))
      : import.meta.resolve(specifier);
    source = source.replaceAll(`'${specifier}'`, `'${resolved}'`).replaceAll(`"${specifier}"`, `"${resolved}"`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, source);
  return url;
}
try {
  const { SCROLL_DEFS } = await import(await ts('progression/ScrollDefs.ts'));
  const registry = await readFile(path.join(root, 'progression/ScrollDefs.ts'), 'utf8');
  const names = {
    OFFENSE_SCROLLS: '伤害与武器', ELEMENT_SCROLLS: '元素与异常', UTILITY_SCROLLS: '技能与生存',
    LEGEND_SCROLLS: '传说与英雄', REACTION_SCROLLS: '元素反应', TACTIC_SCROLLS: '战术联动',
  };
  const groups = new Map();
  for (const match of registry.matchAll(/import\s+\{\s*(\w+_SCROLLS)\s*\}\s+from\s+'(.+)';/g)) {
    const [, symbol, module] = match;
    const defs = (await import(await ts(`progression/${module}.ts`)))[symbol];
    for (const def of defs) groups.set(def.id, { category: names[symbol] ?? symbol, isNew: symbol === 'TACTIC_SCROLLS' });
  }
  const items = SCROLL_DEFS.map(def => {
    assert.ok(groups.has(def.id), `Ungrouped scroll: ${def.id}`);
    assert.ok(def.description && def.name && def.maxStacks > 0);
    return { id: def.id, name: def.name, description: def.description, rarity: def.rarity,
      maxStacks: def.maxStacks, tags: def.tags ?? [], heroOnly: def.heroOnly ?? null,
      isRedesigned: Object.hasOwn(beforeRedesign, def.id), previousDescription: beforeRedesign[def.id] ?? null,
      ...groups.get(def.id) };
  });
  assert.equal(new Set(items.map(d => d.id)).size, items.length);
  assert.equal(items.filter(d => d.isRedesigned).length, 6);
  const data = { date: '2026-10-05', revision: 'six-redesign', items };
  const template = await readFile(new URL('./catalog.fragment.html', import.meta.url), 'utf8');
  assert.equal(template.split('__SCROLL_DATA__').length, 2);
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'scroll-catalog.json'), JSON.stringify(data, null, 2));
  await writeFile(path.join(output, 'scroll-catalog.html'), template.replace('__SCROLL_DATA__', serialized));
  const counts = Object.fromEntries(Object.values(names).map(name => [name, items.filter(d => d.category === name).length]));
  console.log(JSON.stringify({ total: items.length, new: items.filter(d => d.isNew).length, redesigned: 6,
    heroes: items.filter(d => d.heroOnly).length, categories: counts, output }, null, 2));
} finally {
  assert.ok(path.resolve(temp).startsWith(tempRoot + path.sep));
  assert.ok(path.basename(temp).startsWith('spiritfire-catalog-'));
  await rm(temp, { recursive: true, force: true });
}
