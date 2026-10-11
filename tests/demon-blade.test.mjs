// 魔刀千刃 v2（docs/demon-blade-v2.md）：碎刃几何、武器参数基准、词条规则、刃群无视护盾的分层结算。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
}

const shapeUrl = await ts('../src/weapons/demonBlade/BladeShape.ts');
const shape = await import(shapeUrl);
const typesUrl = await ts('../src/core/types.ts');
const mathUrl = await ts('../src/core/math.ts');
const rngUrl = await ts('../src/core/Rng.ts');
const defsUrl = await ts('../src/weapons/WeaponDefs.ts');
const { getWeaponDef, WEAPON_DEFS, comboCycleTime } = await import(defsUrl);
const { rollAffixes } = await import(await ts('../src/weapons/Affixes.ts', { './WeaponDefs': defsUrl, '../core/math': mathUrl }));
const { Rng } = await import(rngUrl);
const { applyLayers, newLayerOutcome } = await import(await ts('../src/combat/DamageCalc.ts', { '../core/types': typesUrl }));

const cells = shape.bladeCells();

/** 简单的伪随机（测试内采样用） */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

test('blade splits into exactly 128 distinct fragments that tile the shard region', () => {
  assert.equal(cells.length, 128);
  assert.equal(shape.SHARD_COUNT, 128);
  const region = shape.shardRegion();
  const total = cells.reduce((s, c) => s + c.area, 0);
  const regionArea = shape.polyArea(region);
  assert.ok(Math.abs(total - regionArea) / regionArea < 0.003, `fragment area ${total} vs region ${regionArea}`);
  for (const c of cells) {
    assert.ok(c.poly.length >= 6, `cell ${c.index} has at least 3 vertices`);
    assert.ok(c.area > 0.6e-4, `cell ${c.index} is not a sliver (${(c.area * 1e4).toFixed(2)} cm²)`);
    assert.ok(shape.pointInPoly(region, c.cx, c.cy), `cell ${c.index} centroid lies on the blade`);
  }
  // 随机点：几乎都恰好落在一片里（边界上的点允许落在两片或零片）
  const rnd = lcg(7);
  let ys = Infinity, ye = -Infinity, xs = Infinity, xe = -Infinity;
  for (let i = 0; i < region.length; i += 2) {
    xs = Math.min(xs, region[i]); xe = Math.max(xe, region[i]);
    ys = Math.min(ys, region[i + 1]); ye = Math.max(ye, region[i + 1]);
  }
  let inside = 0, none = 0, many = 0;
  while (inside < 20000) {
    const x = xs + rnd() * (xe - xs), y = ys + rnd() * (ye - ys);
    if (!shape.pointInPoly(region, x, y)) continue;
    inside++;
    let n = 0;
    for (const c of cells) if (shape.pointInPoly(c.poly, x, y)) n++;
    if (n === 0) none++;
    else if (n > 1) many++;
  }
  assert.ok(none / inside < 0.002, `uncovered ${none} / ${inside}`);
  assert.ok(many / inside < 0.002, `overlapping ${many} / ${inside}`);
});

test('every fragment has its own shape (no two are congruent)', () => {
  // 形状签名：顶点数 + 排序后的边长（0.1 mm）+ 面积（0.001 cm²）；全等的两片签名必然相同
  const keys = new Set();
  for (const c of cells) {
    const p = c.poly;
    const n = p.length / 2;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push(Math.round(Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]) * 1e4));
    }
    edges.sort((a, b) => a - b);
    keys.add(`${n}|${edges.join(',')}|${Math.round(c.area * 1e7)}`);
  }
  assert.equal(keys.size, 128);
});

test('fragments leave the blade tip first and the root last', () => {
  const ranks = cells.map((c) => c.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: 128 }, (_, i) => i));
  const byRank = cells.slice().sort((a, b) => a.rank - b.rank);
  assert.ok(byRank[0].cy > shape.BLADE_LEN * 0.85, 'first fragment is at the tip');
  assert.ok(byRank[127].cy < shape.rootBoundaryY(0) + 0.05, 'last fragment touches the demon-face root');
  for (let k = 1; k < 128; k++) assert.ok(byRank[k].cy <= byRank[k - 1].cy + 0.02, 'departure order runs tip → hilt');
});

test('outline matches the approved design sheet proportions', () => {
  // 设计图正侧面：刀身长 0.78 米、宽约 5.1 cm 保持到 70% 处，刀身先向刃口一侧下垂再向刀背上挑，刀尖与刀背交于一点
  assert.ok(Math.abs(shape.BLADE_LEN - 0.778) < 0.005);
  for (const y of [0.15, 0.3, 0.45]) {
    const w = shape.bladeWidth(y);
    assert.ok(w > 0.048 && w < 0.054, `width at ${y} = ${w}`);
  }
  assert.ok(shape.bladeWidth(0.74) < 0.03, 'tip tapers');
  assert.ok(shape.bladeWidth(shape.BLADE_LEN) < 1e-6, 'edge meets spine at the tip');
  assert.ok(shape.bladeCenterX(0.4) > shape.bladeCenterX(0), 'blade sags toward the edge mid-length');
  assert.ok(shape.bladeCenterX(shape.BLADE_LEN) < shape.bladeCenterX(0.4) - 0.04, 'tip sweeps back toward the spine');
  // 刀根（鬼面）+ 碎刃区 = 整个刀身
  const whole = shape.polyArea(shape.bladeOutline());
  const parts = shape.polyArea(shape.rootPolygon()) + shape.polyArea(shape.shardRegion());
  assert.ok(Math.abs(whole - parts) / whole < 0.01, `root + shards ${parts} vs outline ${whole}`);
  // 刀根分界：刀背一侧更长（设计图里暗色刀根沿刀背延伸更远）
  assert.ok(shape.rootBoundaryY(0) > shape.rootBoundaryY(1) + 0.05);
});

test('fragment layout is deterministic across module loads', async () => {
  const again = await import(`${shapeUrl}#reload`);
  const other = again.bladeCells();
  assert.equal(other.length, 128);
  for (let i = 0; i < 128; i++) {
    assert.equal(other[i].rank, cells[i].rank);
    assert.ok(Math.abs(other[i].cx - cells[i].cx) < 1e-12 && Math.abs(other[i].cy - cells[i].cy) < 1e-12);
  }
});

test('demon blade numbers stay inside the DESIGN baseline', () => {
  const d = getWeaponDef('demon_blade');
  assert.equal(d.kind, 'blade');
  assert.ok(d.blade, 'has v2 params');
  const b = d.blade;
  const combo = b.combo.reduce((s, c) => s + c.damage, 0);
  const slashDps = combo / comboCycleTime(d);
  assert.ok(slashDps >= 95 && slashDps <= 112, `slash DPS ${slashDps}`);
  const swarmDps = b.swarm.damage / b.swarm.tick;
  assert.ok(swarmDps >= 55 && swarmDps <= 70, `swarm DPS ${swarmDps}`);
  assert.equal(d.damage * d.fireRate, swarmDps, 'root fields describe the swarm tick');
  assert.equal(b.combo[2].stretch, 2.2, 'third slash extends the blade');
  assert.ok(b.combo[2].range > b.combo[0].range * 1.6, 'extended slash reaches further');
  assert.equal(d.reserve, 0);
  assert.equal(b.qi.max / b.swarm.drain, 5, 'full qi keeps the swarm out for 5 s');
  assert.ok(b.burst.cooldown >= 12 && b.burst.radius >= 5);
  assert.equal(b.union.duration, 8);
  // 没有任何旧双形态字段残留
  for (const w of WEAPON_DEFS) {
    for (const k of ['melee', 'skill', 'rangedSkill', 'recall', 'perProjectileAmmo']) assert.ok(!(k in w), `${w.id}.${k}`);
  }
});

test('gun-only affixes and legendaries never roll on the demon blade', () => {
  const d = getWeaponDef('demon_blade');
  const banned = new Set(['mag', 'reload', 'spread', 'recoil', 'pierce', 'headBlast', 'killRefill', 'reserve', 'projSpeed', 'lg_last', 'lg_endless']);
  const rng = new Rng(4242);
  for (let i = 0; i < 400; i++) {
    for (const el of ['none', 'fire', 'shock', 'corrode']) {
      for (const a of rollAffixes(d, 4, el, rng)) assert.ok(!banned.has(a.id), `rolled ${a.id}`);
    }
  }
});

test('swarm damage bypasses enemy shields when asked', () => {
  const stats = { get: () => 0, mult: () => 1 };
  const enemy = () => ({ hp: 100, shield: 50, armor: 0 });
  const normal = enemy();
  applyLayers(stats, normal, 30, 'none', newLayerOutcome());
  assert.equal(normal.shield, 20);
  assert.equal(normal.hp, 100);
  const pierced = enemy();
  const out = applyLayers(stats, pierced, 30, 'none', newLayerOutcome(), true);
  assert.equal(pierced.shield, 50, 'shield untouched');
  assert.equal(pierced.hp, 70);
  assert.equal(out.firstLayer, 'health');
});
