import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const moduleCache = new Map();
async function tsModule(path) {
  const url = path instanceof URL ? path : new URL(path, import.meta.url);
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  let source = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
  for (const match of [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
    const from = match[1];
    const to = from === 'three' ? new URL('../node_modules/three/build/three.module.js', import.meta.url).href
      : from.startsWith('.') ? await tsModule(new URL(`${from}.ts`, url)) : from;
    source = source.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  moduleCache.set(url.href, result); return result;
}
const { getStageDesign } = await import(await tsModule('../src/world/StageDesign.ts'));
const { generateLevel } = await import(await tsModule('../src/world/LevelGen.ts'));
const { generateAdventure } = await import(await tsModule('../src/world/AdventureGen.ts'));
const { rotateLayout } = await import(await tsModule('../src/world/LevelCheck.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts'));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const themes = ['desert', 'frost', 'inferno'];
const stage = (chapter, index, type = index === 4 ? 'boss' : 'combat') =>
  ({ chapter, index, type, theme: themes[chapter], reward: type === 'shop' ? 'none' : 'scroll' });
const round = n => Math.round(n * 1e6) / 1e6;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pointKey = p => `${round(p.x)},${round(p.z)}`;
const cross = (ax, az, bx, bz) => ax * bz - az * bx;

/** Split actual road intersections/overlaps, not just declared waypoint lists. */
function roadGraph(paths) {
  const segments = paths.flatMap(path => path.points.slice(1).map((b, i) => ({ a: path.points[i], b, cuts: [0, 1] })));
  const onSegment = (p, s) => {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, len2 = dx * dx + dz * dz;
    const t = ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / Math.max(1e-9, len2);
    return t >= -1e-8 && t <= 1 + 1e-8 && Math.abs(cross(p.x - s.a.x, p.z - s.a.z, dx, dz)) < 1e-6 ? t : null;
  };
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    const ax = a.b.x - a.a.x, az = a.b.z - a.a.z, bx = b.b.x - b.a.x, bz = b.b.z - b.a.z;
    const det = cross(ax, az, bx, bz);
    if (Math.abs(det) < 1e-8) {
      for (const p of [b.a, b.b]) { const t = onSegment(p, a); if (t !== null) a.cuts.push(t); }
      for (const p of [a.a, a.b]) { const t = onSegment(p, b); if (t !== null) b.cuts.push(t); }
    } else {
      const dx = b.a.x - a.a.x, dz = b.a.z - a.a.z;
      const t = cross(dx, dz, bx, bz) / det, u = cross(dx, dz, ax, az) / det;
      if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) { a.cuts.push(t); b.cuts.push(u); }
    }
  }
  const vertices = new Map(), edges = new Map();
  for (const s of segments) {
    const cuts = [...new Set(s.cuts.map(round))].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const at = t => ({ x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t });
      const a = at(cuts[i - 1]), b = at(cuts[i]), ka = pointKey(a), kb = pointKey(b);
      if (ka === kb) continue;
      const key = [ka, kb].sort().join('|');
      vertices.set(ka, a); vertices.set(kb, b); edges.set(key, { a: ka, b: kb, length: distance(a, b) });
    }
  }
  const degree = new Map([...vertices.keys()].map(k => [k, 0]));
  for (const edge of edges.values()) { degree.set(edge.a, degree.get(edge.a) + 1); degree.set(edge.b, degree.get(edge.b) + 1); }
  return { vertices, edges, degree };
}
function routeSignature(design) {
  // The only final path is a movable service spur to the safe lookout foot.
  // It cannot contribute to authored topology identity or runtime fidelity.
  const paths = design.paths.slice(0, -1), graph = roadGraph(paths);
  const landmarks = [design.entrance, design.objective, ...design.sites];
  const pairs = landmarks.flatMap((p, i) => landmarks.slice(i + 1).map(q => round(distance(p, q)))).sort((a, b) => a - b);
  const lengths = paths.map(path => round(path.points.slice(1).reduce((sum, p, i) => sum + distance(p, path.points[i]), 0))).sort((a, b) => a - b);
  const bends = paths.map(path => {
    const turns = path.points.slice(1, -1).map((p, i) => {
      const a = path.points[i], b = path.points[i + 2], ax = p.x - a.x, az = p.z - a.z, bx = b.x - p.x, bz = b.z - p.z;
      return round(Math.abs(Math.atan2(cross(ax, az, bx, bz), ax * bx + az * bz)));
    });
    return [turns.join(','), turns.slice().reverse().join(',')].sort()[0];
  }).sort();
  return JSON.stringify({ lengths, bends, landmarkDistances: pairs,
    junctionDegrees: [...graph.degree.values()].filter(n => n !== 2).sort((a, b) => a - b),
    loops: graph.edges.size - graph.vertices.size + 1, totalRoad: round([...graph.edges.values()].reduce((n, e) => n + e.length, 0)) });
}

test('15 named designs expose distinct physical route signatures, independent of rotation and reflection', () => {
  const ids = new Set(), titles = new Set(), routes = new Set(), bossKinds = new Set();
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 5; index++) {
    const node = stage(chapter, index), design = getStageDesign(node);
    assert.ok(!ids.has(design.id), `duplicate stage ID: ${design.id}`); ids.add(design.id);
    assert.ok(!titles.has(design.title), `duplicate title: ${design.title}`); titles.add(design.title);
    assert.ok(design.routeHint.length > 4 && design.combatHint.length > 4 && design.layoutKind);
    if (index === 4) { bossKinds.add(design.bossKind); continue; }
    const signature = routeSignature(design);
    assert.ok(!routes.has(signature), `${design.title}: road geometry only renames/rotates another stage`); routes.add(signature);
    const reflected = structuredClone(design);
    const transform = p => ({ x: p.z + 7, z: p.x - 13 });
    reflected.entrance = transform(design.entrance); reflected.objective = transform(design.objective);
    reflected.sites = design.sites.map(transform); reflected.paths = design.paths.map(path => ({ ...path, points: path.points.map(transform) }));
    assert.equal(routeSignature(reflected), signature, 'the signature must not reward mirror/rotation/translation alone');
    const graph = roadGraph(design.paths);
    assert.ok([...graph.degree.values()].some(n => n >= 3), `${design.title}: routes need actual junctions`);
    assert.ok(graph.edges.size >= graph.vertices.size, `${design.title}: route choice must include an actual cycle`);
  }
  assert.equal(ids.size, 15); assert.equal(titles.size, 15); assert.equal(routes.size, 12); assert.equal(bossKinds.size, 3);
});

const generated = new Map();
function inspectLayout(L, key, seed) {
  const world = new CollisionWorld();
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const nav = new NavGrid({ world, time: { now: 0 }, rng: new Rng(seed), enemies: { list: [] } });
  nav.build({ minX: L.minX, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, floorY: L.floorY });
  nav.setRamps(L.ramps.map(r => ({ ...r, topY: L.floorY + r.top,
    foot: new THREE.Vector3(r.foot.x, L.floorY, r.foot.z), head: new THREE.Vector3(r.head.x, L.floorY + r.top, r.head.z) })));
  return { L, world, nav, key };
}
function inspect(node, seed) {
  const key = `${node.chapter}/${node.index}/${node.type}/${seed}`;
  if (generated.has(key)) return generated.get(key);
  const rng = new Rng(seed ^ (node.chapter * 7919 + node.index * 104729 + 17));
  const result = inspectLayout(generateLevel(rng, node, { adventure: true }), key, seed);
  generated.set(key, result); return result;
}

function reachable(result, p, label) {
  const { L, nav, key } = result;
  assert.ok(nav.isWalkable(p.x, p.z), `${key}/${label}: blocked or outside the actual main navigation component`);
  const route = [];
  assert.ok(nav.findPath(new THREE.Vector3(L.playerSpawn.x, L.floorY, L.playerSpawn.z), new THREE.Vector3(p.x, L.floorY, p.z), route), `${key}/${label}: no real NavGrid path from entry`);
  assert.ok(route.length && Math.hypot(route.at(-1).x - p.x, route.at(-1).z - p.z) <= 1.5, `${key}/${label}: navigation remapped to a distant component`);
}

function assertEntryAndServices(result) {
  const { L, world, key } = result;
  for (const [label, p] of [['entry', L.playerSpawn], ['reward', L.rewardPoint], ['shop', L.shopPoint], ...L.portalPoints.map((p, i) => [`exit-${i}`, p])]) reachable(result, p, label);
  assert.equal(world.overlapsBody(L.playerSpawn.x, L.floorY + .05, L.playerSpawn.z, .4, 1.8), null, `${key}: player body is embedded at entry`);
}

function assertAdventureSafety(result, node) {
  const { L, world, key } = result;
  const design = getStageDesign(node);
  assertEntryAndServices(result);
  assert.ok(L.adventure, `${key}: authored adventure unexpectedly fell back to the shared courtyard`);
  assert.equal(L.adventure.designId, getStageDesign(node).id, `${key}: wrong authored stage`);
  assert.equal(L.adventure.title, getStageDesign(node).title);
  const rotate = (p, k) => k === 1 ? { x: p.z, z: -p.x } : k === 2 ? { x: -p.x, z: -p.z }
    : k === 3 ? { x: -p.z, z: p.x } : { ...p };
  const rotation = [0, 1, 2, 3].find(k => distance(rotate(design.entrance, k), L.playerSpawn) < 1e-6);
  assert.notEqual(rotation, undefined, `${key}: entry moved away from its authored stage`);
  const gates = (L.architecture ?? []).filter(a => a.type === 'gate');
  for (const socket of design.gateSockets) {
    const target = rotate(socket, rotation);
    assert.ok(gates.some(a => a.court === socket.court && distance(a, target) < .01), `${key}: authored ${socket.court} gate was silently dropped`);
  }
  for (const gate of gates) {
    reachable(result, gate, `gate-${gate.court}`);
    assert.ok(gate.passage?.width > .8 && gate.passage.height * gate.s >= 1.85, `${key}: gate has no player-size opening`);
    const c = Math.cos(gate.yaw), sn = Math.sin(gate.yaw), halfDepth = gate.envelope.depth * gate.s / 2 + .75;
    const edge = gate.passage.width * gate.s / 2 - .6, steps = Math.ceil(halfDepth * 2);
    for (const localX of [-edge, 0, edge]) for (let i = 0; i <= steps; i++) {
      const localZ = -halfDepth + 2 * halfDepth * i / steps;
      const x = gate.x + localX * c + localZ * sn, z = gate.z - localX * sn + localZ * c;
      assert.equal(world.overlapsBody(x, L.floorY + .05, z, .4, 1.8), null, `${key}/${gate.court}: standing player cannot traverse the real opening`);
    }
  }
  assert.equal(routeSignature({ entrance: L.playerSpawn, objective: L.adventure.objective, sites: L.adventure.sites, paths: L.adventure.paths }),
    routeSignature(getStageDesign(node)), `${key}: runtime roads do not implement the selected physical blueprint`);
  reachable(result, L.adventure.objective, 'objective');
  for (const site of L.adventure.sites) reachable(result, site, site.id);
  for (const path of L.adventure.paths) for (const p of path.points) reachable(result, p, 'route-waypoint');
  const spur = L.adventure.paths.at(-1), spurEnd = spur.points.at(-1);
  assert.ok(L.ramps.some(r => distance(spurEnd, r.foot) <= 1.5), `${key}: lookout service spur never reaches the real safe stair foot`);
  for (const ramp of L.ramps) {
    reachable(result, ramp.foot, 'lookout-stair-foot');
    const ascent = [];
    assert.ok(result.nav.findPath(new THREE.Vector3(L.playerSpawn.x, L.floorY, L.playerSpawn.z),
      new THREE.Vector3(ramp.head.x, L.floorY + ramp.top, ramp.head.z), ascent), `${key}: real navigation cannot ascend the lookout`);
    assert.ok(ascent.length && Math.abs(ascent.at(-1).y - L.floorY - ramp.top) < .4, `${key}: lookout navigation ends at ground level`);
    assert.equal(world.overlapsBody(ramp.head.x, L.floorY + ramp.top + .05, ramp.head.z, .4, 1.8), null, `${key}: player embeds at the top of the lookout stairs`);
  }
  for (let j = 1; j < spur.points.length; j++) {
    const a = spur.points[j - 1], b = spur.points[j], steps = Math.ceil(distance(a, b));
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 0, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      assert.ok(result.nav.isWalkable(p.x, p.z), `${key}: lookout approach is blocked at (${round(p.x)},${round(p.z)})`);
    }
  }
  // The final short path is the one elevated lookout spur. All main
  // routes and cross-links must carry a standing player along the full
  // segment, not merely provide individually reachable endpoints.
  for (const [pathIndex, path] of L.adventure.paths.slice(0, -1).entries()) {
    for (let j = 1; j < path.points.length; j++) {
      const a = path.points[j - 1], b = path.points[j], steps = Math.ceil(distance(a, b));
      for (let k = 0; k <= steps; k++) {
        const t = steps ? k / steps : 0, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const hit = world.overlapsBody(x, L.floorY + .05, z, .4, 1.8);
        assert.equal(hit, null, `${key}/path-${pathIndex}/segment-${j - 1} at (${round(x)},${round(z)}): standing player hits ${hit?.tag ?? 'unknown'} along a declared road`);
      }
    }
  }
  assert.ok(L.adventure.spawnAnchors?.length, `${key}: altar fight has no authored spawn formation`);
  for (const [i, a] of L.adventure.spawnAnchors.entries()) {
    reachable(result, a, `altar-anchor-${i}`);
    assert.equal(world.overlapsBody(a.x, L.floorY + .05, a.z, .65, 2.2), null, `${key}: altar anchor embeds a heavy guard body`);
  }
  assert.ok(L.adventure.encounters?.length, `${key}: differentiated combat needs real route encounters`);
  for (const e of L.adventure.encounters) {
    reachable(result, e, e.id);
    assert.equal(world.overlapsBody(e.x, L.floorY + .05, e.z, .4, 1.8), null, `${key}/${e.id}: trigger centre embeds the player`);
    assert.ok(e.triggerRadius > 0 && e.arenaRadius > e.triggerRadius && e.anchors.length, `${key}/${e.id}: unusable local encounter`);
    if (e.siteId) assert.ok(L.adventure.sites.some(s => s.id === e.siteId), `${key}/${e.id}: guard references no supply`);
    for (const [i, a] of e.anchors.entries()) {
      reachable(result, a, `${e.id}/anchor-${i}`);
      assert.equal(world.overlapsBody(a.x, L.floorY + .05, a.z, .65, 2.2), null, `${key}/${e.id}: anchor embeds a heavy guard body`);
      assert.ok(distance(a, e) <= e.arenaRadius + 1e-6, `${key}/${e.id}: spawn anchor escapes its encounter`);
    }
    // A player at the trigger and its approach rim must not cover every
    // anchor with the scheduler's 10m exclusion, trapping pending spawns.
    const probePoints = [e, ...Array.from({ length: 8 }, (_, i) => ({ x: e.x + Math.sin(i * Math.PI / 4) * e.triggerRadius * .85,
      z: e.z + Math.cos(i * Math.PI / 4) * e.triggerRadius * .85 }))].filter(p => result.nav.isWalkable(p.x, p.z));
    for (const p of probePoints) assert.ok(e.anchors.some(a => distance(a, p) >= 10), `${key}/${e.id}: every authored spawn is excluded by the player's position`);
  }
}

test('all 15 slots support reachable combat and elite overrides over deterministic seed samples', () => {
  const before = JSON.stringify(themes.flatMap((_, chapter) => Array.from({ length: 5 }, (_, i) => getStageDesign(stage(chapter, i)))));
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 5; index++) {
    for (const type of ['combat', 'elite']) for (const seed of [20261004, 81331, 936587]) {
      const node = stage(chapter, index, type), result = inspect(node, seed), { L, world, key } = result;
      assertAdventureSafety(result, node);
    }
  }
  assert.equal(JSON.stringify(themes.flatMap((_, chapter) => Array.from({ length: 5 }, (_, i) => getStageDesign(stage(chapter, i))))), before,
    'runtime jitter or rotation must not mutate shared authored blueprints');
});

test('quiet shop and treasure overrides keep reachable services without triggerable guards', () => {
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 5; index++) {
    for (const type of ['shop', 'treasure']) for (const seed of [20261004, 81331, 936587]) {
      const result = inspect(stage(chapter, index, type), seed);
      assertEntryAndServices(result);
      assert.ok(!result.L.adventure?.encounters?.length, `${result.key}: a quiet stage must not contain triggerable combat`);
    }
  }
});

test('raw authored maps already satisfy native navigation and body clearance before repair or retry', () => {
  const sampling = new Rng(0xa53), seeds = [20261004, sampling.int(1, 10000000), sampling.int(1, 10000000)];
  for (let chapter = 0; chapter < 3; chapter++) for (let index = 0; index < 5; index++) {
    for (const type of ['combat', 'elite']) for (const seed of seeds) {
      const node = stage(chapter, index, type), rng = new Rng(seed ^ (chapter * 7919 + index * 104729 + 17));
      const raw = generateAdventure(rng, node);
      const result = inspectLayout(raw, `raw/${chapter}/${index}/${type}/${seed}`, seed);
      assertAdventureSafety(result, node);
      for (const zone of raw.adventure.zones) reachable(result, zone, zone.id);
    }
  }
});

test('layout rotation carries encounter centres and every authored spawn anchor with the terrain', () => {
  for (let chapter = 0; chapter < 3; chapter++) {
    const { L } = inspect(stage(chapter, 1), 20261004), rotated = structuredClone(L);
    assert.ok(rotated.adventure?.encounters?.length && rotated.adventure.spawnAnchors?.length);
    rotateLayout(rotated, 1);
    const check = (before, after) => { assert.ok(Math.abs(after.x - before.z) < 1e-7); assert.ok(Math.abs(after.z + before.x) < 1e-7); };
    for (const [i, e] of L.adventure.encounters.entries()) {
      check(e, rotated.adventure.encounters[i]);
      e.anchors.forEach((a, j) => check(a, rotated.adventure.encounters[i].anchors[j]));
    }
    L.adventure.spawnAnchors.forEach((a, i) => check(a, rotated.adventure.spawnAnchors[i]));
  }
});

test('three boss arenas preserve a wide opening and real movement space without route encounters', () => {
  const signatures = new Set();
  for (let chapter = 0; chapter < 3; chapter++) for (const seed of [20261004, 81331, 936587]) {
    const result = inspect(stage(chapter, 4), seed), { L, world, key } = result;
    assertEntryAndServices(result);
    assert.ok(!L.adventure?.encounters?.length, `${key}: boss must not activate unrelated route guards`);
    reachable(result, L.bossPoint, 'boss');
    assert.equal(world.overlapsBody(L.bossPoint.x, L.floorY + .05, L.bossPoint.z, [2.1, 1.3, 1.3][chapter], [5.4, 3.4, 3.6][chapter]), null, `${key}: boss is embedded at spawn`);
    let open = 0, total = 0;
    for (const radius of [6, 10, 14]) for (let i = 0; i < 8; i++) {
      total++;
      const p = { x: L.center.x + Math.sin(i * Math.PI / 4) * radius, z: L.center.z + Math.cos(i * Math.PI / 4) * radius };
      if (!world.overlapsBody(p.x, L.floorY + .05, p.z, .45, 1.8) && result.nav.isWalkable(p.x, p.z)) open++;
    }
    assert.ok(open >= total * .75, `${key}: central boss movement space is obstructed`);
    if (seed === 20261004) {
      const structural = L.boxes.filter(b => b.tag.startsWith('architecture-') || ['platform', 'stair', 'lowWall', 'pillar', 'ruin', 'cover'].includes(b.look) || ['platform', 'stair', 'pillar', 'cover'].includes(b.tag));
      const sizes = structural.map(b => [round(b.maxY - b.minY), ...[round(b.maxX - b.minX), round(b.maxZ - b.minZ)].sort((a, c) => a - c)].join(',')).sort();
      const centres = structural.map(b => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }));
      const radii = centres.map(p => round(distance(p, L.center))).sort((a, b) => a - b);
      const pairs = centres.flatMap((p, i) => centres.slice(i + 1).map(q => round(distance(p, q)))).sort((a, b) => a - b);
      signatures.add(JSON.stringify({ sizes, radii, pairs }));
    }
  }
  assert.equal(signatures.size, 3, 'boss arenas need differing structural arrangements, not only theme colors or rotation');
});
