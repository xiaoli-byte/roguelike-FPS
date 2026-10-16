// V2 art placement is derived from plan geometry alone: verify it frames the playable space
// without intruding on it, and that every collision feature (cover, deck, stair) gets its art.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(source);
}
const plansUrl = await tsModule('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_REDESIGN_PLANS } = await import(plansUrl);
const genUrl = await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl });
const { generateWhitebox, whiteboxInsidePolygon } = await import(genUrl);
const { buildRedesignArtLayout, REDESIGN_ART_ASSETS, REDESIGN_CURVED_HALLS, REDESIGN_HALL_KITS, REDESIGN_KIT_SHAPES, REDESIGN_PLATFORM_VARIANTS, REDESIGN_WALL_KITS, redesignKitKey } = await import(await tsModule('../src/world/RedesignArtLayout.ts', { './WhiteboxGen': genUrl }));
const stageFor = plan => ({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1, reward: 'coins' });

function onFloor(plan, x, z) {
  const p = [x + plan.bounds[0] / 2, z + plan.bounds[1] / 2];
  if (plan.rooms.some(r => whiteboxInsidePolygon(p, r.polygon))) return true;
  return plan.passages.some(path => path.points.some((b, i) => {
    if (!i) return false;
    const a = path.points[i - 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) <= path.width / 2;
  }));
}

// A chapter without a building kit would stay greybox and have no art layout to check.
const kitted = WHITEBOX_REDESIGN_PLANS.filter(p => REDESIGN_ART_ASSETS[redesignKitKey(p)]);
test('every V2 plan of all three chapters has a building kit with its shapes and wall kit', () => {
  for (const chapter of ['desert', 'frost', 'inferno']) assert.ok(kitted.some(p => p.chapter === chapter), `${chapter} plans have art`);
  for (const plan of kitted) {
    const key = redesignKitKey(plan);
    assert.ok(REDESIGN_KIT_SHAPES[key], `${plan.id}: kit ${key} has measured shapes`);
    assert.ok(REDESIGN_WALL_KITS[key], `${plan.id}: kit ${key} has a wall kit`);
  }
});

test('every kit asset the layouts place is published in the asset manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const ids = new Set([...Object.values(REDESIGN_ART_ASSETS).flatMap(k => Object.values(k)),
    ...Object.values(REDESIGN_WALL_KITS).flatMap(k => [k.panel, k.plain, k.endL, k.endR]),
    ...Object.values(REDESIGN_PLATFORM_VARIANTS).flatMap(list => list.map(([id]) => id)),
    ...Object.values(REDESIGN_HALL_KITS).flatMap(k => [k.wall, k.buttress])]);
  const missing = [...ids].filter(id => !manifest.assets[id]);
  assert.deepEqual(missing, []);
  // Hall kit sizes are the sections' and buttresses' own published sizes (metres).
  for (const [key, kit] of Object.entries(REDESIGN_HALL_KITS)) for (const [id, size] of [[kit.wall, kit.section], [kit.buttress, kit.pier]]) {
    const { min, max } = manifest.assets[id].bounds;
    size.forEach((v, i) => assert.ok(Math.abs(max[i] - min[i] - v) < .05, `${key} ${id} axis ${i}: ${(max[i] - min[i]).toFixed(3)} vs ${v}`));
  }
  for (const [key, kit] of Object.entries(REDESIGN_WALL_KITS)) {
    // The layout's kit widths are the pieces' own published widths (metres).
    const width = id => manifest.assets[id].bounds.max[0] - manifest.assets[id].bounds.min[0];
    assert.ok(Math.abs(width(kit.panel) - kit.widths.panel) < .05, `${key} panel width ${width(kit.panel)}`);
    assert.ok(Math.abs(width(kit.plain) - kit.widths.plain) < .05, `${key} plain width ${width(kit.plain)}`);
    assert.ok(Math.abs((width(kit.endL) + width(kit.endR)) / 2 - kit.widths.end) < .05, `${key} end width`);
  }
});

for (const plan of kitted) {
  const L = generateWhitebox(stageFor(plan), { redesign: true });
  const shape = REDESIGN_KIT_SHAPES[redesignKitKey(plan)];
  const art = buildRedesignArtLayout(L);
  const of = kind => art.filter(p => p.kind === kind);

  test(`${plan.id}: ramparts stand in the outer mass, face the floor and enclose every boundary`, () => {
    const ramparts = of('rampart');
    assert.ok(ramparts.length >= 20, `${ramparts.length} ramparts`);
    for (const r of ramparts) {
      assert.equal(onFloor(plan, r.x, r.z), false, `rampart centre (${r.x.toFixed(1)}, ${r.z.toFixed(1)}) intrudes on the floor`);
      // One step along its facing direction moves towards the floor (somewhere along its width: sections
      // that wrap a corner sit partly past the room's vertex).
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
      // Kit end pieces are narrow and sit at a run's ends, often wrapped past a corner: sample at least 6 m.
      const reach = Math.max(r.size[0], 6);
      const faces = [-.4, -.2, 0, .2, .4].some(k => onFloor(plan, r.x + fx * 2.5 + fz * k * reach, r.z + fz * 2.5 - fx * k * reach));
      // A run's end piece may lie wholly past the corner it wraps (buried in the next wall's body).
      const wrapsCorner = /End[LR]$/.test(r.assetId) && plan.rooms.some(room => room.polygon.some(([vx, vz]) =>
        Math.hypot(r.x + plan.bounds[0] / 2 - vx, r.z + plan.bounds[1] / 2 - vz) < 5));
      assert.ok(faces || wrapsCorner, `rampart (${r.x.toFixed(1)}, ${r.z.toFixed(1)}) front must face the playable floor`);
      // Round-hall sections and buttresses scale uniformly with their chord (checked by the furnace hall test below).
      const hall = REDESIGN_HALL_KITS[redesignKitKey(plan)];
      if (hall && (r.assetId === hall.wall || r.assetId === hall.buttress)) continue;
      // End pieces are the kit's narrowest (desert 1.74 m, frost 1.06 m); runs squeeze the kit at most to about 0.6.
      assert.ok(r.size[0] >= REDESIGN_WALL_KITS[redesignKitKey(plan)].widths.end * .6 && r.size[0] <= 8, `kit piece width ${r.size[0]}`);
      // One height for every section: scaling sections vertically would step the painted bands at each joint.
      assert.equal(r.size[1], L.wallHeight, 'ramparts match the collision wall height');
    }
  });

  test(`${plan.id}: each cover greybox box carries exactly one art placement at its centre`, () => {
    // The view hides cover greybox boxes one by one under finished art, matched by centre.
    const kinds = new Set(['column', 'barricade', 'coverwall', 'stall', 'goods', 'hoard', 'ruin', 'brazier']);
    const covers = art.filter(p => kinds.has(p.kind));
    // Gate posts are hidden by the gateway standing over them instead (its footprint contains their centre).
    const underGateway = (x, z) => [...of('gateway'), ...of('shrine')].some(g => {
      const dx = x - g.x, dz = z - g.z, c = Math.cos(g.yaw), s = Math.sin(g.yaw);
      return Math.abs(dx * c - dz * s) <= g.size[0] / 2 + .05 && Math.abs(dx * s + dz * c) <= g.size[2] / 2 + .05;
    });
    for (const b of L.boxes.filter(b => b.tag === 'whitebox-cover')) {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if (underGateway(cx, cz) && !covers.some(p => Math.abs(p.x - cx) < .3 && Math.abs(p.z - cz) < .3)) continue;
      // Massif covers (machine housings) are tiled by podium blocks whose centres lie inside the box instead.
      if (of('massif').some(p => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) {
        assert.ok(!covers.some(p => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ), 'massif box carries no other cover art');
        continue;
      }
      const on = covers.filter(p => Math.abs(p.x - cx) < .3 && Math.abs(p.z - cz) < .3);
      assert.equal(on.length, 1, `cover box at (${cx.toFixed(1)}, ${cz.toFixed(1)}) has ${on.length} placements`);
    }
  });

  test(`${plan.id}: every floor edge facing solid mass is covered by a rampart or a gateway`, () => {
    // Independent of the layout's own run detection: sample every room and passage edge on both sides.
    const edges = plan.rooms.flatMap(r => r.polygon.map((a, i) => [a, r.polygon[(i + 1) % r.polygon.length]]));
    for (const path of plan.passages) for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / len * path.width / 2, nz = (b[0] - a[0]) / len * path.width / 2;
      edges.push([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz]], [[a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz]]);
    }
    const wx = plan.bounds[0] / 2, wz = plan.bounds[1] / 2;
    const covers = (x, z) => art.some(p => {
      if (p.kind !== 'rampart' && p.kind !== 'gateway') return false;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), dx = x - p.x, dz = z - p.z;
      const along = Math.abs(dx * fz - dz * fx), across = dx * fx + dz * fz;
      if (p.kind === 'gateway') return along <= p.size[0] / 2 && Math.abs(across) <= p.size[2] / 2 + 1;
      // The sample sits on the rampart's inner (front) face, which is half a depth in front of its centre.
      // Kit pieces abut exactly (capped joints), so a sample on a joint belongs to both neighbours.
      return along <= p.size[0] / 2 + .05 && Math.abs(across - p.size[2] / 2) <= .4;
    });
    const missing = [];
    for (const [a, b] of edges) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      for (let t = .5; t < len - .5; t += 1) {
        const x = a[0] + ux * t, z = a[1] + uz * t;
        for (const s of [1, -1]) {
          const out = [x + uz * s * .6, z - ux * s * .6], inn = [x - uz * s * .6, z + ux * s * .6];
          if (onFloor(plan, out[0] - wx, out[1] - wz) || !onFloor(plan, inn[0] - wx, inn[1] - wz)) continue;
          // An open void's rim (frost-5's ice hole) is not solid mass: it stays open.
          if ((plan.voids ?? []).some(v => Math.hypot(out[0] - v.center[0], out[1] - v.center[1]) <= v.radius + 1.5)) continue;
          // Where a passage leaves a room at a slant, the room's wall stops where its body would enter the passage
          // (exactRuns kits) and the passage wall's body closes the corner: allow that notch, up to 0.6 m.
          const notch = shape.exactRuns ? [-.6, .6] : [];
          if (!covers(x - wx, z - wz) && !notch.some(d => covers(x + ux * d - wx, z + uz * d - wz))) missing.push(`(${x.toFixed(1)}, ${z.toFixed(1)})`);
        }
      }
    }
    assert.deepEqual(missing, [], `uncovered boundary samples: ${missing.length}`);
  });

  test(`${plan.id}: open voids keep a clear view: no wall, tower or gateway on their rim`, () => {
    // An open void (frost-5's ice hole, chapter 3's lava lakes and channels) is every non-floor point inside its circle.
    // No wall, tower, gateway or landmark may stand over it: sample each footprint and allow 1 m of overlap at the rim
    // (a wall that meets the edge of a lava lake or a channel's rounded end still closes the floor beside it).
    const inVoid = (x, z) => {
      const p = [x + plan.bounds[0] / 2, z + plan.bounds[1] / 2];
      return !onFloor(plan, x, z) && (plan.voids ?? []).some(v => Math.hypot(p[0] - v.center[0], p[1] - v.center[1]) <= v.radius - 1);
    };
    const blocking = art.filter(p => ['rampart', 'tower', 'gateway', 'landmark'].includes(p.kind)).filter(p => {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      for (let u = -.5; u <= .5 + 1e-9; u += .25) for (let v = -.5; v <= .5 + 1e-9; v += .25) {
        // A gateway's open archway is part of its passage (floor), never a void.
        if (inVoid(p.x + fz * u * p.size[0] + fx * v * p.size[2], p.z - fx * u * p.size[0] + fz * v * p.size[2])) return true;
      }
      return false;
    });
    assert.deepEqual(blocking.map(p => `${p.kind} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`), [], 'void rim');
  });

  test(`${plan.id}: gateways stand between rooms, framing their passage without entering any floor`, () => {
    const gateways = of('gateway');
    // Desert plans connect rooms by long passages (a gateway on most of them). Frost rooms nearly adjoin: most
    // passages are shorter than a gateway is deep, so gateways stand where the plan places gate posts or a passage
    // runs long enough; the boss ring's single short passage takes none. Inferno passages mostly cross open lava
    // (causeways, bridges), where a gateway's towers would stand in the lava: none is required.
    const least = plan.chapter === 'desert' ? Math.min(3, plan.mainRoute.length) : plan.chapter === 'inferno' || plan.index === 5 ? 0 : 1;
    assert.ok(gateways.length >= least && gateways.length <= plan.passages.length + plan.covers.filter(c => c.art === 'gate').length / 2, `${gateways.length} gateways`);
    // Gate posts (art 'gate') are collision boxes on the floor that a gateway's towers stand in.
    const posts = plan.covers.filter(c => c.art === 'gate').map(c => c.polygon.map(([x, z]) => [x - plan.bounds[0] / 2, z - plan.bounds[1] / 2]));
    const inPost = (x, z) => posts.some(poly => x >= Math.min(...poly.map(p => p[0])) - .05 && x <= Math.max(...poly.map(p => p[0])) + .05
      && z >= Math.min(...poly.map(p => p[1])) - .05 && z <= Math.max(...poly.map(p => p[1])) + .05);
    const narrowest = Math.min(...plan.passages.map(p => p.width));
    for (const g of gateways) {
      assert.ok(Math.abs(g.size[0] / g.size[1] - shape.gateway.width / shape.gateway.height) < 1e-6, 'gateway keeps its published proportions');
      const opening = g.size[0] * shape.gateway.opening / shape.gateway.width;
      assert.ok(opening >= narrowest - 1e-6, 'the opening is at least as wide as the narrowest passage');
      // Everything but the archway itself must stand in solid mass (the art has no collision of its own).
      const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
      for (let u = -.5; u <= .5 + 1e-9; u += 1 / 16) for (let v = -.5; v <= .5 + 1e-9; v += 1 / 8) {
        const across = u * g.size[0];
        if (Math.abs(across) < opening / 2) continue;
        const x = g.x + fz * across + fx * v * g.size[2], z = g.z - fx * across + fz * v * g.size[2];
        assert.ok(!onFloor(plan, x, z) || inPost(x, z), `gateway tower at (${(x + plan.bounds[0] / 2).toFixed(1)}, ${(z + plan.bounds[1] / 2).toFixed(1)}) stands on walkable floor`);
      }
    }
  });

  test(`${plan.id}: every cover, deck tile and stair has art matching its collision footprint`, () => {
    const dressing = ['stall', 'goods', 'hoard', 'ruin', 'brazier'];
    // Gate posts have no art of their own: a gateway spans each pair (checked with the gateways).
    const solid = plan.covers.filter(c => c.art !== 'gate' && c.art !== 'shrine');
    // A massif cover is one cover box tiled by several podium blocks (each tile inside it, tiles filling it exactly).
    const boxOf = c => { const xs = c.polygon.map(p => p[0] - plan.bounds[0] / 2), zs = c.polygon.map(p => p[1] - plan.bounds[1] / 2);
      return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
    const massifCovers = solid.filter(c => { const [x0, z0, x1, z1] = boxOf(c); return of('massif').some(p => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1); });
    for (const c of massifCovers) {
      const [x0, z0, x1, z1] = boxOf(c), tiles = of('massif').filter(p => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);
      assert.ok(!c.art && c.height >= 4 && Math.min(x1 - x0, z1 - z0) >= 4, 'only big tall plain covers are massifs');
      assert.ok(Math.abs(tiles.reduce((a, t) => a + t.size[0] * t.size[2], 0) - (x1 - x0) * (z1 - z0)) < 1e-6, 'massif tiles fill the box');
      for (const t of tiles) { assert.equal(t.size[1], c.height); assert.ok(t.size[0] <= 6 && t.size[2] <= 6, 'podium-block sized tiles'); }
    }
    assert.equal(of('massif').length, massifCovers.reduce((n, c) => { const [x0, z0, x1, z1] = boxOf(c); return n + of('massif').filter(p => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1).length; }, 0));
    assert.equal(of('column').length + of('barricade').length + of('coverwall').length + dressing.reduce((n, k) => n + of(k).length, 0) + massifCovers.length, solid.length);
    for (const cover of solid.filter(c => c.art)) {
      const xs = cover.polygon.map(p => p[0] - plan.bounds[0] / 2), zs = cover.polygon.map(p => p[1] - plan.bounds[1] / 2);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const art = of(cover.art).find(p => Math.abs(p.x - cx) < 1e-6 && Math.abs(p.z - cz) < 1e-6);
      assert.ok(art, `${cover.art} stands in its cover box`);
      // The front looks the authored way and the footprint after yaw equals the collision box.
      const fx = Math.sin(art.yaw), fz = Math.cos(art.yaw), want = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[cover.face];
      assert.ok(Math.abs(fx - want[0]) < 1e-9 && Math.abs(fz - want[1]) < 1e-9, `${cover.art} faces ${cover.face}`);
      const spanX = Math.abs(fz) > .5 ? art.size[0] : art.size[2], spanZ = Math.abs(fz) > .5 ? art.size[2] : art.size[0];
      assert.ok(Math.abs(spanX - (Math.max(...xs) - Math.min(...xs))) < 1e-6 && Math.abs(spanZ - (Math.max(...zs) - Math.min(...zs))) < 1e-6, `${cover.art} fills its box`);
      assert.equal(art.size[1], cover.height);
    }
    for (const c of of('column')) assert.ok(c.size[1] >= 4);
    for (const b of of('barricade')) assert.ok(b.size[1] <= 1.5);
    // Podium blocks ring every deck edge exactly (the top is one paved slab in the scene view).
    for (const deck of plan.platforms ?? []) {
      const [x0, z0, x1, z1] = deck.rect.map((v, i) => v - plan.bounds[i % 2] / 2);
      const tiles = of('platform').filter(p => p.x > Math.min(x0, x1) && p.x < Math.max(x0, x1) && p.z > Math.min(z0, z1) && p.z < Math.max(z0, z1));
      for (const t of tiles) {
        const onEdge = Math.abs(t.x - t.size[0] / 2 - Math.min(x0, x1)) < 1e-6 || Math.abs(t.x + t.size[0] / 2 - Math.max(x0, x1)) < 1e-6
          || Math.abs(t.z - t.size[2] / 2 - Math.min(z0, z1)) < 1e-6 || Math.abs(t.z + t.size[2] / 2 - Math.max(z0, z1)) < 1e-6;
        assert.ok(onEdge, `${deck.id}: interior podium block`);
        assert.equal(t.size[1], deck.height);
      }
      const perimeter = 2 * (Math.abs(x1 - x0) + Math.abs(z1 - z0));
      const covered = tiles.reduce((s, t) => s + 2 * (t.size[0] + t.size[2]), 0);
      assert.ok(covered >= perimeter - 1e-6, `${deck.id}: deck edge not fully ringed`);
    }
    assert.equal(of('stairs').length, L.ramps.length);
    for (const s of of('stairs')) {
      const ramp = L.ramps.find(r => Math.abs((r.sx0 + r.sx1) / 2 - s.x) < 1e-6 && Math.abs((r.sz0 + r.sz1) / 2 - s.z) < 1e-6);
      assert.ok(ramp, 'stairs sit on a ramp');
      // The low end (+Z front after yaw) faces the ramp foot.
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      assert.ok((ramp.foot.x - ramp.head.x) * fx + (ramp.foot.z - ramp.head.z) * fz > 0, 'stair front faces its foot');
      assert.equal(s.size[1], ramp.top);
    }
    assert.equal(of('landmark').length, 1);
    // The landmark has no collision: its footprint stays off the floor (a boss ring's exit lies inside the arena).
    for (const t of of('landmark')) {
      const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
      for (const [u, v] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5], [0, 0]])
        assert.equal(onFloor(plan, t.x + fz * u * t.size[0] + fx * v * t.size[2], t.z - fx * u * t.size[0] + fz * v * t.size[2]), false, 'landmark stands on the floor');
    }
    // Corner towers stand wholly in the outer mass behind a chamfer, facing the floor, above the ramparts.
    // Spaced kits (towerSpacing) skip chamfers near an existing tower, so they cap fewer joints.
    const spacing = REDESIGN_KIT_SHAPES[redesignKitKey(plan)].towerSpacing;
    // Chapter-3 rooms mostly open onto lava (no solid chamfer to cap): the chapter as a whole is checked below.
    assert.ok(of('tower').length >= (plan.chapter === 'inferno' ? 0 : spacing > 0 ? 2 : 4), `${of('tower').length} towers`);
    for (const t of of('tower')) for (const u of of('tower')) if (t !== u && spacing > 0)
      assert.ok(Math.hypot(t.x - u.x, t.z - u.z) >= spacing, 'corner towers keep their spacing');
    for (const t of of('tower')) {
      const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
      for (const [u, v] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5], [0, 0]])
        assert.equal(onFloor(plan, t.x + fz * u * t.size[0] + fx * v * t.size[2], t.z - fx * u * t.size[0] + fz * v * t.size[2]), false, 'tower intrudes on the floor');
      assert.ok(onFloor(plan, t.x + fx * (t.size[2] / 2 + 1.5), t.z + fz * (t.size[2] / 2 + 1.5)), 'tower front must face the floor');
      assert.ok(t.size[1] >= L.wallHeight + 3, 'towers clear the rampart skyline');
    }
  });
}

test('chapter-2 plans dress their rooms with their own kit and frame every exit with its portal shrine', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const frost = kitted.filter(p => p.chapter === 'frost');
  assert.equal(frost.length, 5);
  const placed = new Set();
  for (const plan of frost) {
    const art = buildRedesignArtLayout(generateWhitebox(stageFor(plan), { redesign: true })), ids = REDESIGN_ART_ASSETS[redesignKitKey(plan)];
    const shrines = art.filter(p => p.kind === 'shrine');
    assert.equal(shrines.length, 1, `${plan.id}: one portal shrine`);
    assert.equal(shrines[0].assetId, ids.shrine);
    // The exit lies in front of the shrine, within its width.
    const exit = [plan.exit.at[0] - plan.bounds[0] / 2, plan.exit.at[1] - plan.bounds[1] / 2], s = shrines[0];
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), dx = exit[0] - s.x, dz = exit[1] - s.z;
    assert.ok(dx * fx + dz * fz > 0 && Math.abs(dx * fz - dz * fx) < s.size[0] / 2, `${plan.id}: exit faces the shrine arch`);
    for (const p of art.filter(p => ['stall', 'goods', 'hoard', 'ruin', 'brazier'].includes(p.kind))) {
      assert.equal(p.assetId, ids[p.kind], `${plan.id}: ${p.kind} comes from the plan's kit`);
      placed.add(p.assetId);
      // The view fits the model per axis into its box: frost boxes keep the published proportions (uniform scale).
      const { min, max } = manifest.assets[p.assetId].bounds, scale = p.size.map((v, i) => v / (max[i] - min[i]));
      assert.ok(Math.max(...scale) / Math.min(...scale) < 1.06, `${plan.id}: ${p.kind} stretched ${scale.map(v => v.toFixed(2))}`);
    }
  }
  // Every published set-dressing piece of both chapter-2 kits appears somewhere in the chapter.
  for (const key of ['frost', 'frostSea']) for (const kind of ['stall', 'goods', 'hoard', 'ruin', 'brazier'])
    assert.ok(placed.has(REDESIGN_ART_ASSETS[key][kind]), `${REDESIGN_ART_ASSETS[key][kind]} is placed in a chapter-2 level`);
});

test('chapter-3 plans dress their rooms with the Zhurong kit and frame every exit with its portal shrine', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const inferno = kitted.filter(p => p.chapter === 'inferno');
  assert.equal(inferno.length, 5);
  const placed = new Set();
  for (const plan of inferno) {
    assert.equal(redesignKitKey(plan), 'inferno');
    const art = buildRedesignArtLayout(generateWhitebox(stageFor(plan), { redesign: true })), ids = REDESIGN_ART_ASSETS.inferno;
    const shrines = art.filter(p => p.kind === 'shrine');
    assert.equal(shrines.length, 1, `${plan.id}: one portal shrine`);
    assert.equal(shrines[0].assetId, ids.shrine);
    const exit = [plan.exit.at[0] - plan.bounds[0] / 2, plan.exit.at[1] - plan.bounds[1] / 2], s = shrines[0];
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), dx = exit[0] - s.x, dz = exit[1] - s.z;
    assert.ok(dx * fx + dz * fz > 0 && Math.abs(dx * fz - dz * fx) < s.size[0] / 2, `${plan.id}: exit faces the shrine arch`);
    // The shrine keeps its published proportions (it stands larger than published, never stretched).
    const sb = manifest.assets[ids.shrine].bounds, ss = s.size.map((v, i) => v / (sb.max[i] - sb.min[i]));
    assert.ok(Math.max(...ss) / Math.min(...ss) < 1.01, `${plan.id}: shrine stretched ${ss.map(v => v.toFixed(2))}`);
    for (const p of art.filter(p => p.kind === 'tower' || p.kind === 'gateway')) placed.add(p.assetId);
    for (const p of art.filter(p => ['stall', 'goods', 'hoard', 'ruin', 'brazier'].includes(p.kind))) {
      assert.equal(p.assetId, ids[p.kind], `${plan.id}: ${p.kind} comes from the Zhurong kit`);
      placed.add(p.assetId);
      const { min, max } = manifest.assets[p.assetId].bounds, scale = p.size.map((v, i) => v / (max[i] - min[i]));
      assert.ok(Math.max(...scale) / Math.min(...scale) < 1.06, `${plan.id}: ${p.kind} stretched ${scale.map(v => v.toFixed(2))}`);
    }
    // Plain covers keep their kinds: no plain cover box is left for a squashed cover wall wider than it is long.
    for (const c of art.filter(p => p.kind === 'coverwall' || p.kind === 'barricade')) assert.ok(c.size[0] >= c.size[2] * 1.5, `${plan.id}: ${c.kind} ${c.size}`);
  }
  for (const kind of ['stall', 'goods', 'hoard', 'ruin', 'brazier', 'tower', 'gateway'])
    assert.ok(placed.has(REDESIGN_ART_ASSETS.inferno[kind]), `${REDESIGN_ART_ASSETS.inferno[kind]} is placed in a chapter-3 level`);
});

test('the Zhurong kit carries its colour-keyed emissive mask (lava seams, coals and furnace mouths glow)', async () => {
  // glTF JSON chunk of a GLB: 12-byte header, then [length, 'JSON', json].
  const json = async id => {
    const buf = await readFile(new URL(`../public/assets/props/${id}.glb`, import.meta.url));
    return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  };
  const kit = REDESIGN_ART_ASSETS.inferno, wall = REDESIGN_WALL_KITS.inferno, hall = REDESIGN_HALL_KITS.inferno;
  // The plain wall and the cast-iron barricade have no lava in their concepts; the hall wall's base seam and
  // the buttress's front crack do.
  const glowing = [...Object.values(kit).filter(id => id !== kit.barricade), wall.panel, wall.endL, wall.endR, hall.wall, hall.buttress];
  for (const id of glowing) {
    const gltf = await json(id);
    assert.ok(gltf.materials.some(m => m.emissiveTexture), `${id} has an emissive texture`);
  }
});

test('the round furnace hall is walled with hall sections and buttresses, not rampart end pilasters', () => {
  for (const [id, hall] of Object.entries(REDESIGN_CURVED_HALLS)) {
    const plan = kitted.find(p => p.id === id), kit = REDESIGN_HALL_KITS[redesignKitKey(plan)];
    assert.ok(plan && kit, `${id}: plan and hall kit`);
    const art = buildRedesignArtLayout(generateWhitebox(stageFor(plan), { redesign: true }));
    const centre = [hall.center[0] - plan.bounds[0] / 2, hall.center[1] - plan.bounds[1] / 2];
    const radial = p => Math.hypot(p.x - centre[0], p.z - centre[1]);
    const sections = art.filter(p => p.assetId === kit.wall), piers = art.filter(p => p.assetId === kit.buttress);
    // Two stretches (the bridge mouth and the north niche break the circle): about 7.6 m sections, a buttress on every joint.
    assert.ok(sections.length >= 12, `${sections.length} hall sections`);
    assert.ok(piers.length >= sections.length && piers.length <= sections.length + 4, `${piers.length} buttresses`);
    const rampartKit = Object.values(REDESIGN_WALL_KITS[redesignKitKey(plan)]).filter(v => typeof v === 'string');
    // Only the straight walls meeting the circle (niche sides, bridge mouth) end on it: about a hundred pieces were
    // laid along the facets before.
    const onArc = art.filter(p => rampartKit.includes(p.assetId) && Math.abs(radial(p) - hall.radius - 1.5) < 1.6);
    assert.ok(onArc.length <= 12, `${id}: ${onArc.length} rampart pieces on the hall arc`);
    for (const s of sections) {
      // Uniform scale (a few centimetres of joint overlap), its front face on the floor edge, facing the hall centre.
      const scale = s.size.map((v, i) => v / kit.section[i]);
      assert.ok(Math.max(...scale) / Math.min(...scale) < 1.05, `section stretched ${scale.map(v => v.toFixed(2))}`);
      const front = radial(s) - s.size[2] / 2;
      assert.ok(front > hall.radius - .3 && front < hall.radius + .3, `section front at r ${front.toFixed(2)}`);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      assert.ok((centre[0] - s.x) * fx + (centre[1] - s.z) * fz > 0, 'section faces the hall');
      assert.ok(!onFloor(plan, s.x, s.z), 'section body stands outside the floor');
    }
  }
});

test('chapter-3 decks and massifs mix the podium block variants; other kits keep their one block', () => {
  const seen = new Map();
  for (const plan of kitted) {
    for (const p of buildRedesignArtLayout(generateWhitebox(stageFor(plan), { redesign: true })).filter(p => p.kind === 'platform' || p.kind === 'massif')) {
      const key = redesignKitKey(plan);
      if (!seen.has(key)) seen.set(key, new Map());
      seen.get(key).set(p.assetId, (seen.get(key).get(p.assetId) ?? 0) + 1);
    }
  }
  for (const [key, counts] of seen) {
    const variants = REDESIGN_PLATFORM_VARIANTS[key] ?? [];
    assert.deepEqual([...counts.keys()].sort(), [REDESIGN_ART_ASSETS[key].platform, ...variants.map(([id]) => id)].sort(), `${key} podium blocks`);
    if (!variants.length) continue;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (const [id, share] of variants) assert.ok(Math.abs(counts.get(id) / total - share) < .12, `${id} share ${(counts.get(id) / total).toFixed(2)}`);
  }
});
