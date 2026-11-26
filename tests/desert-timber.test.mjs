// 第一章新做的木构件（src/world/desert/pieces/：月泉阁、坐像殿、九层楼、贴崖木栈梯、之字木栈道）对上白盒的度量：
// 柱位、柱间净宽（主线要穿过去）、梯段坡度、坐像殿的视线（前庭看得见坐像、② 望寺塔不被挡）。检查项在 pieces/timberChecks.ts。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const { runTimberChecks } = await import('../src/world/desert/pieces/timberChecks.ts');

for (const r of runTimberChecks()) {
  test(`木构件 · ${r.name}`, () => assert.ok(r.ok, r.detail));
}
