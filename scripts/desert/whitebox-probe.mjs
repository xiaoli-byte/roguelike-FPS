// 第一章白盒可达性探针：直接 import src/world/desert/whitebox 的 TS（纯数据，不开浏览器），在 0.5 m 行走面上实测
// 每条走法（长度 / 最陡 3 m / 最窄处）、每个点位从出生点走不走得到、据点场地能走的面积、怪从入场点到据点、地标视线。
//   node scripts/desert/whitebox-probe.mjs [图...]            缺省全部
//   node scripts/desert/whitebox-probe.mjs 1-1 --json out.json  另存机器读的结果（含路线折线）
//   node scripts/desert/whitebox-probe.mjs 1-1 --dump <目录>   把行走面 / 地形 / 材质 / 可达范围 / 离墙距离写成二进制 + 元数据（自己出检查图用）
// 退出码：0 全部通过；1 有不通过；2 脚本出错。
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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

try {
  const { WHITEBOXES, buildTerrain, probeWhitebox, formatReport } = await import('../../src/world/desert/whitebox/index.ts');
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const jsonOut = flag('--json'), dumpOut = flag('--dump');
  const ids = args.length ? args : Object.keys(WHITEBOXES);
  let failures = 0;
  const results = {};
  for (const id of ids) {
    const spec = WHITEBOXES[id];
    if (!spec) { console.error(`没有白盒 ${id}（有：${Object.keys(WHITEBOXES).join('、')}）`); process.exit(2); }
    const t0 = performance.now();
    const terrain = buildTerrain(spec);
    const report = probeWhitebox(terrain);
    console.log(formatReport(report));
    console.log(`\n（${terrain.nx} × ${terrain.nz} 格，${Math.round(performance.now() - t0)} ms）\n`);
    failures += report.failures;
    results[id] = report;
    // --dump：把高度场 / 行走面 / 材质 / 能走的范围写成二进制 + 元数据，给 python 出检查图用
    if (dumpOut) {
      const { WhiteboxProbe } = await import('../../src/world/desert/whitebox/index.ts');
      const probe = new WhiteboxProbe(terrain);
      const base = `${dumpOut}/${id}`;
      writeFileSync(`${base}.walk.f32`, Buffer.from(terrain.walk.buffer));
      writeFileSync(`${base}.ground.f32`, Buffer.from(terrain.ground.buffer));
      writeFileSync(`${base}.mat.u8`, Buffer.from(terrain.mat.buffer));
      writeFileSync(`${base}.reach.u8`, Buffer.from(probe.reach.buffer));
      writeFileSync(`${base}.clear.f32`, Buffer.from(probe.clearance.buffer));
      writeFileSync(`${base}.json`, JSON.stringify({ nx: terrain.nx, nz: terrain.nz, cell: terrain.cell, spec, report, blocks: terrain.blocks }));
    }
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  console.log(failures ? `合计 ${failures} 项不通过` : '全部通过');
  process.exit(failures ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(2);
}
