// 第一章重做版的截图机位（给 scripts/desert/ch1-shots.mjs 用）：和白盒检视页 desert-lab.html 同一套算法——
// 出生第一眼（玩家眼高、朝出生朝向）、各据点 / 首领 / 出口进场（主线上离它 32 m 处看过去）、概念图的斜俯瞰机位。
// 这样重做版的游戏画面、白盒截图、构图概念图（docs/art/concepts/ch1-routes/views/）三者同机位，能逐张对照。
//   node scripts/desert/redo-poses.mjs [输出=docs/art/concepts/ch1-routes/game/poses.json]
//   CH1_QUERY='&redo=1' node scripts/desert/ch1-shots.mjs 5199 docs/art/concepts/ch1-routes/game docs/art/concepts/ch1-routes/game/poses.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if ((typeof rest[0] === 'string' ? rest[0] : rest[0]?.type) === 'ExperimentalWarning') return;
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

const { WHITEBOXES, buildTerrain, probeWhitebox, WB_METRICS } = await import('../../src/world/desert/whitebox/index.ts');
const out = process.argv[2] ?? 'docs/art/concepts/ch1-routes/game/poses.json';
const r2 = v => Math.round(v * 100) / 100;
const poses = { _: '第一章重做版的截图机位（scripts/desert/redo-poses.mjs 生成，和白盒检视页 / 构图概念图同机位）' };

for (const [id, spec] of Object.entries(WHITEBOXES)) {
  const terrain = buildTerrain(spec), report = probeWhitebox(terrain);
  const ground = (p, up) => [r2(p[0]), r2(terrain.walkAt(p[0], p[1]) + up), r2(p[1])];
  const main = report.routes.find(r => r.kind === 'main');
  /** 主线上到 target 之前 back 米处的点（同 desertLab.ts 的 approach） */
  const approach = (target, back) => {
    if (!main || main.pts.length < 2) return null;
    let best = 0, bd = Infinity;
    main.pts.forEach((p, i) => { const d = Math.hypot(p[0] - target[0], p[1] - target[1]); if (d < bd) { bd = d; best = i; } });
    let acc = 0;
    for (let i = best; i > 0; i--) {
      acc += Math.hypot(main.pts[i][0] - main.pts[i - 1][0], main.pts[i][1] - main.pts[i - 1][1]);
      if (acc >= back) return main.pts[i - 1];
    }
    return main.pts[0];
  };
  const list = [];
  const concept = spec.views.find(v => v.name === 'concept');
  if (concept?.eye && concept.look) list.push({ name: 'concept 斜俯瞰', eye: concept.eye, lookAt: concept.look, encounter: false });
  {
    const yaw = spec.spawn.yaw * Math.PI / 180, eye = ground(spec.spawn.at, WB_METRICS.eye);
    list.push({ name: 'spawn 出生第一眼', eye, lookAt: [r2(eye[0] + Math.sin(yaw) * 40), r2(eye[1] - 1), r2(eye[2] - Math.cos(yaw) * 40)], encounter: false });
  }
  for (const s of [...spec.strongholds, ...(spec.extras ?? []).filter(e => e.kind === 'boss'), spec.exit]) {
    const from = approach(s.at, 32);
    if (!from || Math.hypot(from[0] - s.at[0], from[1] - s.at[1]) < 6) continue;
    const tag = s === spec.exit ? 'exit 出口' : `s${s.id} ${s.name}`;
    list.push({ name: tag, eye: ground(from, WB_METRICS.eye), lookAt: ground(s.at, 1.2), encounter: s !== spec.exit && (spec.strongholds.includes(s)) });
  }
  poses[id] = list;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(poses, null, 1));
console.log('写了', out, Object.entries(poses).filter(([k]) => k !== '_').map(([k, v]) => `${k}: ${v.length}`).join('，'));
