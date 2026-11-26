// 第一章重做（src/world/desert/redo/）：白盒编成游戏的场景文档。
// 锁住：五张图都编得出来、遭遇锚点 / 入场点站在走得到的地面上、有导航网格和软边界；
// 重做版不读 Unity 导出物（用户 2026-11-26：「以后unity是要删除的」）——代码里不许出现 assets/unity-levels/ 的路径。
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

const { WHITEBOXES } = await import('../src/world/desert/whitebox/index.ts');
const { compileWhitebox } = await import('../src/world/desert/redo/compile.ts');

test('重做版不读 Unity 导出物：redo/ 和新件的代码里没有 assets/unity-levels/ 路径', () => {
  const dirs = ['src/world/desert/redo', 'src/world/desert/pieces'];
  for (const dir of dirs) for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    assert.ok(!/['"`]assets\/unity-levels\//.test(src), `${dir}/${f} 引用了 Unity 导出物`);
  }
});

for (const [id, spec] of Object.entries(WHITEBOXES)) {
  test(`${id} ${spec.name}：编得出能玩的场景文档`, () => {
    const c = compileWhitebox(spec);
    const d = c.doc;
    assert.equal(d.heightfields.length, 1);
    assert.ok(d.navigation.indices.length / 3 > 500, '导航网格太小');
    assert.ok(c.mechanisms.boundary, '没有软边界');
    assert.equal(c.boundary.field.length, c.boundary.width * c.boundary.height);
    // 出生点、遭遇锚点、入场点都站在探针「走得到」的格子上（离锚点 1.5 m 内）
    const reachable = (x, z) => {
      const i = c.probe.snap([x, z], 0, 1.5);
      return i >= 0 && c.probe.reach[i] === 1;
    };
    assert.ok(reachable(d.spawn.position[0], d.spawn.position[2]), '出生点走不到');
    for (const e of d.encounters) {
      assert.ok(e.waves.length > 0, `${e.title} 没有波次`);
      for (const a of e.anchors) assert.ok(reachable(a.position[0], a.position[2]), `${e.title} 的锚点 (${a.position[0]}, ${a.position[2]}) 走不到`);
    }
    for (const e of d.entries ?? []) assert.ok(reachable(e.position[0], e.position[2]), `入场点 ${e.label} 走不到`);
    // 据点都编上了（1-4 首领场没有据点遭遇，编首领）
    if (id === '1-4') assert.equal(d.bosses.length, 1);
    else assert.equal(d.encounters.filter(e => !e.optional).length, spec.strongholds.length);
    // 渲染件只用 public/assets/props 的网页件
    for (const r of d.renderers) assert.ok(r.url.startsWith('assets/props/'), r.url);
  });
}
