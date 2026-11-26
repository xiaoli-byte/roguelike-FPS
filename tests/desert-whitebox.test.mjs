// 第一章重做白盒（src/world/desert/whitebox/）：每张图的规格都要过可达性探针——
// 每条走法逐段走得通（主线够宽、不过陡）、每个据点 / 驻守点 / 藏宝 / 出口从出生点走得到、怪从入场点走得到据点、地标视线成立。
// 改了白盒数据或地形图章，这里不过就是把路改断了。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const { WHITEBOXES, buildTerrain, probeWhitebox, WB_METRICS } = await import('../src/world/desert/whitebox/index.ts');

test('第一章五张图都有白盒', () => {
  assert.deepEqual(Object.keys(WHITEBOXES).sort(), ['1-1', '1-2', '1-3', '1-4', '1-A']);
});

for (const [id, spec] of Object.entries(WHITEBOXES)) {
  test(`${id} ${spec.name}：规格自洽`, () => {
    const ids = [spec.spawn, ...spec.strongholds, ...spec.guards, ...spec.entries, ...spec.caches, spec.exit, ...(spec.extras ?? [])].map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, `点位 id 重复：${ids.join(' ')}`);
    const main = spec.routes.filter(r => r.kind === 'main');
    assert.equal(main.length, 1, '有且只有一条主线');
    // 主线按顺序穿过全部据点（环线会回到起点：按首次经过的顺序比）
    const order = [...new Set(main[0].via.filter(v => typeof v === 'string' && spec.strongholds.some(s => s.id === v)))];
    assert.deepEqual(order, spec.strongholds.map(s => s.id), '主线要按顺序经过每个据点');
    for (const e of spec.entries) if (e.mode === 'jump') assert.ok(e.from, `跃下点 ${e.id} 要给起跳处`);
    for (const [x, z] of [spec.spawn.at, spec.exit.at, ...spec.strongholds.map(s => s.at)]) {
      assert.ok(x > 0 && x < spec.size[0] && z > 0 && z < spec.size[1], `点位 (${x}, ${z}) 在图外`);
    }
  });

  test(`${id} ${spec.name}：探针全部通过`, () => {
    const report = probeWhitebox(buildTerrain(spec));
    const bad = [
      ...report.routes.filter(r => !r.ok).map(r => `走法 ${r.id} ${r.name}：${r.problems.join('；')}`),
      ...report.rows.filter(r => !r.ok).map(r => `${r.kind} ${r.id} ${r.name}：${r.detail}`),
    ];
    assert.deepEqual(bad, []);
    const mainRoute = report.routes.find(r => r.kind === 'main');
    assert.ok(mainRoute.minWidth >= WB_METRICS.mainWidth, `主线最窄处 ${mainRoute.minWidth.toFixed(1)} m`);
    assert.ok(mainRoute.maxSlope <= WB_METRICS.mainSlope, `主线最陡处 ${mainRoute.maxSlope.toFixed(0)}°`);
  });
}
