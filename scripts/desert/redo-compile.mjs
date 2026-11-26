// 第一章重做：把白盒编成游戏的场景文档，在 node 里跑一遍看结果（不开浏览器）。
//   node scripts/desert/redo-compile.mjs [图...]          缺省全部：件数、碰撞、导航三角形、遭遇、提醒，外加用游戏的导航网格类测寻路耗时
//   node scripts/desert/redo-compile.mjs 1-1 --json out.json   另存编好的文档（看数据用）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning') return;
  return emitWarning.call(this, warning, ...rest);
};
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const file = fileURLToPath(new URL(specifier, context.parentURL));
      if (!/\.[cm]?[jt]s$/i.test(file)) for (const candidate of [`${file}.ts`, `${file}/index.ts`]) if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  },
});

const { WHITEBOXES } = await import('../../src/world/desert/whitebox/index.ts');
const { compileWhitebox } = await import('../../src/world/desert/redo/compile.ts');
const { UnityNavMesh } = await import('../../src/world/UnityNavMesh.ts');
const THREE = await import('three');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const jsonOut = flag('--json');
const ids = args.length ? args : Object.keys(WHITEBOXES);
for (const id of ids) {
  const old = JSON.parse(readFileSync(`public/assets/unity-levels/scenes/${id}.json`, 'utf8'));
  const t0 = performance.now();
  const c = compileWhitebox(WHITEBOXES[id], old);
  const ms = performance.now() - t0;
  const d = c.doc;
  console.log(`\n== ${id} ${d.title}（编译 ${ms.toFixed(0)} ms）`);
  console.log(`渲染件 ${d.renderers.length}（${new Set(d.renderers.map(r => r.name)).size} 种）· 碰撞 ${d.colliders.length} · 导航三角形 ${d.navigation.indices.length / 3} · 高度场 ${d.heightfields[0].resolution}²`);
  console.log(`遭遇 ${d.encounters.map(e => `${e.title}${e.optional ? '(可选)' : ''}[${e.anchors.length}锚 ${e.waves.length}波]`).join('、')}`);
  console.log(`入场点 ${d.entries.length} · 藏宝 ${d.caches.map(x => `${x.title}:${x.reward}${x.guard ? '/' + x.guard : ''}`).join('、')} · 出口 ${d.exits.length} · 补给营 ${d.camps.length} · 首领 ${d.bosses.map(b => b.id).join('、') || '无'}`);
  console.log(`新件 ${c.pieces.map(p => p.kind === 'named' || p.kind === 'stair' ? p.name : p.kind === 'camelBones' ? '驼骨' : `${p.kind}×${p.trees.length}`).join('、')}`);
  for (const n of c.notes) console.log('  提醒：' + n);
  // 寻路耗时：用游戏的导航网格类，从出生点到每个据点 / 出口
  const ctx = { rng: { next: Math.random } };
  const t1 = performance.now();
  const nav = new UnityNavMesh(ctx, d);
  const build = performance.now() - t1;
  const out = [];
  const from = new THREE.Vector3(...d.spawn.position);
  const targets = [...d.encounters.map(e => e.position), ...d.exits.map(e => e.position)];
  // 先空跑一遍预热（第一次调用含 JIT 编译，不算）
  for (const p of targets) nav.findPath(from, new THREE.Vector3(...p), out);
  let worst = 0, fails = 0;
  for (const p of targets) {
    const t2 = performance.now();
    const ok = nav.findPath(from, new THREE.Vector3(...p), out);
    worst = Math.max(worst, performance.now() - t2);
    if (!ok) fails++;
  }
  console.log(`导航：建网 ${build.toFixed(0)} ms，出生点到 ${targets.length} 个目标寻路最慢 ${worst.toFixed(1)} ms${fails ? `，${fails} 个找不到路` : ''}`);
  {
    // 对照：旧场景（Unity 烘的导航网格）同样从出生点到各遭遇
    const oldNav = new UnityNavMesh(ctx, old);
    let oldWorst = 0;
    for (const e of old.encounters) oldNav.findPath(new THREE.Vector3(...old.spawn.position), new THREE.Vector3(...e.position), out);
    for (const e of old.encounters) {
      const t2 = performance.now();
      oldNav.findPath(new THREE.Vector3(...old.spawn.position), new THREE.Vector3(...e.position), out);
      oldWorst = Math.max(oldWorst, performance.now() - t2);
    }
    console.log(`  对照旧场景：导航三角形 ${old.navigation.indices.length / 3}，寻路最慢 ${oldWorst.toFixed(1)} ms`);
  }
  if (jsonOut) writeFileSync(jsonOut.replace('{id}', id), JSON.stringify(d));
}
