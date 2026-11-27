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

// 特效（redo/fxMaps.ts）：都摆在图里；立杆的幡不立在据点场地中间（交战区留干净，level-art.md「特效」）
const { REDO_FX } = await import('../src/world/desert/redo/fxMaps.ts');
test('特效都摆在图里、幡杆不进据点场地中心', () => {
  for (const [id, fx] of Object.entries(REDO_FX)) {
    const spec = WHITEBOXES[id];
    assert.ok(spec, `${id} 没有白盒`);
    const [W, D] = spec.size;
    const inside = (x, z, what) => assert.ok(x >= -20 && x <= W + 20 && z >= -20 && z <= D + 20, `${id} ${what} (${x}, ${z}) 在图外`);
    for (const s of fx.smoke ?? []) inside(s.origin[0], s.origin[2], '烟');
    for (const f of fx.falls ?? []) inside(f.top[0], f.top[2], '落沙');
    for (const p of fx.drift ?? []) inside(p.center[0], p.center[1], '流沙');
    for (const d of fx.devils ?? []) for (const p of d.path) inside(p[0], p[1], '尘卷风');
    for (const m of fx.motes ?? []) inside(m.center[0], m.center[2], '浮尘');
    for (const r of fx.extraRidges ?? []) for (const p of r.points) inside(p[0], p[1], '脊线');
    for (const b of fx.banners ?? []) {
      const [x, z] = b.at.length === 2 ? b.at : [b.at[0], b.at[2]];
      inside(x, z, '幡');
      if (b.kind !== 'pole') continue;
      for (const s of spec.strongholds) {
        const d = Math.hypot(x - s.at[0], z - s.at[1]);
        assert.ok(d > (s.r ?? 24) * 0.4, `${id} 幡杆 (${x}, ${z}) 在据点「${s.name}」场地中心 ${d.toFixed(1)} m`);
      }
    }
  }
});

// 地面散布（groundScatter.ts）：密度照配置出数、车辙带的三角形朝上（2026-11-27 第一版绕向反了，整条带背面朝上被剔掉、游戏里看不见）
const THREE = await import('three');
const { GroundScatter } = await import('../src/world/desert/groundScatter.ts');
test('地面散布：数量按密度、车辙带朝上', () => {
  const surface = { height: () => 0, kind: (x, z) => (x < 50 ? 'gravel' : 'sand') };
  const s = new GroundScatter(surface, {
    bounds: [0, 0, 100, 100], roads: [{ pts: [[0, 50], [100, 50]], half: 3 }], wind: [1, 0],
    grass: { gravel: 0.1 }, pebbles: { gravel: 0.3, sand: 0.05 }, shoulder: { width: 2, grass: 0, pebbles: 0 }, seed: 7,
  });
  // 砾石半边 50 × 100 m²：草约 500、石约 1500 + 沙地 250（据点减半没给）
  assert.ok(s.counts.grass > 350 && s.counts.grass < 650, `草 ${s.counts.grass}`);
  assert.ok(s.counts.pebbles > 1400 && s.counts.pebbles < 2100, `石 ${s.counts.pebbles}`);
  let ruts;
  s.group.traverse(o => { if (o.name === 'DesertGroundScatter.ruts') ruts = o; });
  assert.ok(ruts, '没有车辙带');
  const p = ruts.geometry.getAttribute('position'), idx = ruts.geometry.index;
  const v = k => new THREE.Vector3(p.getX(idx.getX(k)), p.getY(idx.getX(k)), p.getZ(idx.getX(k)));
  for (let t = 0; t < idx.count; t += 3 * 37) {
    const n = new THREE.Vector3().crossVectors(v(t + 1).sub(v(t)), v(t + 2).sub(v(t)));
    assert.ok(n.y > 0, `车辙带第 ${t / 3} 个三角形朝下`);
  }
  s.dispose();
});
