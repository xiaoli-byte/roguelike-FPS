import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { loadPublishedMesh } from '../art/tools/pose_geometry_audit.mjs';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(source);
}
const plansUrl = await tsModule('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS } = await import(plansUrl);
const { generateWhitebox } = await import(await tsModule('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }));
const { buildAuthoredSceneLayout, authoredPlacementRect, authoredPlacementOutsideFloor, authoredPlacementIntersectsRect, authoredDeckInsideFloor, authoredDeckFootprint, AUTHORED_ART_DIRECTION, AUTHORED_DECK_SIZE } = await import(await tsModule('../src/world/AuthoredSceneLayout.ts'));
const { architectureAssetBounds, architectureMatrix } = await import(await tsModule('../src/world/SceneArchitecture.ts', {
  three: new URL('../node_modules/three/build/three.module.js', import.meta.url).href,
  '../assets/AssetLibrary': dataModule('export const AssetLibrary={get(){return null},preload(){return Promise.resolve()}}'),
  '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment(){}'),
  './SceneSurfaceMaterial': dataModule('export function applyHandPaintedEnvironment(){}'),
}));
const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
const provenance = new Map();
for (const [id, entry] of Object.entries(manifest.assets)) {
  if (entry.generator?.tool) { provenance.set(id, entry.generator.tool); continue; }
  if (!id.startsWith('SM_Prop_')) continue;
  const source = JSON.parse(await readFile(new URL(`../art/source/props/${id}/asset.json`, import.meta.url), 'utf8'));
  const build = source.stages.build.versions.find(version => version.version === source.stages.build.current);
  const highpoly = source.stages.highpoly.versions.find(version => version.version === build.from.highpoly);
  provenance.set(id, highpoly?.tool);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const member of Object.values(value)) freeze(member); }
  return value;
}
const layouts = WHITEBOX_PLANS.map(plan => {
  const level = freeze(generateWhitebox({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, chapter: ['desert', 'frost', 'inferno'].indexOf(plan.chapter), index: plan.index - 1, reward: 'coins' }));
  const before = JSON.stringify(level), art = buildAuthoredSceneLayout(level);
  return { plan, level, art, before };
});
const overlaps = (a, b) => a.minX < b.maxX - 1e-7 && a.maxX > b.minX + 1e-7 && a.minZ < b.maxZ - 1e-7 && a.maxZ > b.minZ + 1e-7;

test('art assembly preserves every approved floor, collider, enemy station and interaction', () => {
  for (const { plan, level, art, before } of layouts) {
    assert.equal(JSON.stringify(level), before, `${plan.id}: art modified gameplay geometry`);
    assert.deepEqual(buildAuthoredSceneLayout(level), art, `${plan.id}: placement must be reproducible`);
    assert.equal(art.architecture, art.placements);
  }
});

test('every exposed edge has playable floor on one side and blocked ground on the other', () => {
  for (const { plan, level, art } of layouts) {
    const inside = p => level.whitebox.floorRects.some(r => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ);
    const segments = new Set();
    for (const edge of art.boundaries) {
      assert.equal(Math.abs(edge.outward.x) + Math.abs(edge.outward.z), 1);
      assert.equal(edge.length, Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z));
      for (let distance = .25; distance < edge.length; distance += .5) {
        const t = distance / edge.length;
        const p = { x: edge.a.x + (edge.b.x - edge.a.x) * t, z: edge.a.z + (edge.b.z - edge.a.z) * t };
        const key = `${p.x}:${p.z}:${edge.outward.x}:${edge.outward.z}`;
        assert.ok(!segments.has(key), `${plan.id}: duplicated boundary face`); segments.add(key);
        assert.ok(inside({ x: p.x - edge.outward.x * .12, z: p.z - edge.outward.z * .12 }), `${plan.id}/${edge.id}: seam treated as exterior`);
        assert.ok(!inside({ x: p.x + edge.outward.x * .12, z: p.z + edge.outward.z * .12 }), `${plan.id}/${edge.id}: normal points into floor`);
      }
    }
    assert.ok(segments.size > 100);
  }
});

test('all non-cover art envelopes stay outside every playable room and passage', () => {
  for (const { plan, level, art } of layouts) for (const placement of art.placements) {
    const rect = authoredPlacementRect(placement);
    assert.ok([placement.x, placement.y, placement.z, placement.yaw, placement.s, ...Object.values(placement.envelope)].every(Number.isFinite));
    assert.equal(placement.s, 1, 'uniform fitting is delegated to the all-LOD renderer');
    if (placement.role === 'cover') continue;
    // A diagonal source has an oriented rectangular envelope. Its axis-aligned
    // bounding box includes empty corner triangles, which are not source mesh.
    assert.ok(authoredPlacementOutsideFloor(level, placement), `${plan.id}/${placement.assetId}/${placement.role}: visible art intrudes on approved walk space`);
    for (const point of [...level.portalPoints, level.rewardPoint, level.shopPoint]) {
      assert.ok(!authoredPlacementIntersectsRect(placement, { minX: point.x - .9, maxX: point.x + .9, minZ: point.z - .9, maxZ: point.z + .9 }), `${plan.id}: art blocks interaction clearance`);
    }
  }
});

test('cover masonry retains the 2.6m silhouette and fits inside the existing collider union', () => {
  for (const { plan, level, art } of layouts) {
    const covers = level.boxes.filter(box => box.tag === 'whitebox-cover');
    const rendered = art.placements.filter(p => p.role === 'cover');
    assert.ok(rendered.length >= covers.length);
    for (const placement of rendered) {
      const rect = authoredPlacementRect(placement), area = (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
      const covered = covers.reduce((sum, b) => sum + Math.max(0, Math.min(rect.maxX, b.maxX) - Math.max(rect.minX, b.minX)) * Math.max(0, Math.min(rect.maxZ, b.maxZ) - Math.max(rect.minZ, b.minZ)), 0);
      assert.ok(covered >= area - 1e-6, `${plan.id}/${placement.label}: cover art enlarges collision footprint`);
      assert.ok(placement.y >= 0 && placement.y + placement.envelope.height <= 2.6 + 1e-7);
    }
    for (const [index, cover] of covers.entries()) assert.ok(rendered.some(p => overlaps(authoredPlacementRect(p), cover) && p.y + p.envelope.height >= 2.58), `${plan.id}/${index}: no art reaches the solid cover top`);
  }
});

test('15 compositions use real published Hunyuan modules with distinct authored room landmarks', () => {
  assert.equal(new Set(layouts.map(({ art }) => art.identity)).size, 15);
  for (const { plan, art } of layouts) {
    const direction = AUTHORED_ART_DIRECTION[plan.id];
    assert.equal(art.landmarks.length, direction.features.length);
    assert.ok(art.landmarks.length >= 3);
    for (const feature of direction.features) assert.ok(plan.rooms.some(room => room.id === feature.room), `${plan.id}: unknown feature room`);
    for (const placement of art.placements) {
      const entry = manifest.assets[placement.assetId];
      assert.ok(entry, `${plan.id}: missing published model ${placement.assetId}`);
      assert.match(provenance.get(placement.assetId) ?? '', /Hunyuan/i, `${placement.assetId}: art must retain generated source provenance`);
      assert.equal(entry.kind, 'static');
    }
    assert.ok(art.landmarks.some(p => p.envelope.height > 10), `${plan.id}: no readable skyline objective`);
  }
});

test('art observation views reuse safe gameplay checkpoints and face grounded room stories', () => {
  for (const { plan, level, art } of layouts) {
    assert.equal(new Set(art.inspectionViews.map(view => view.id)).size, art.inspectionViews.length);
    for (const view of art.inspectionViews) {
      assert.ok(view.id.startsWith('art-'));
      assert.ok(level.whitebox.checkpoints.some(point => Math.hypot(point.x - view.x, point.z - view.z) < 1e-8), `${plan.id}/${view.id}: invented observation point`);
      const observer = { minX: view.x - .38, maxX: view.x + .38, minZ: view.z - .38, maxZ: view.z + .38 };
      assert.ok(!level.boxes.some(box => overlaps(box, observer)), `${plan.id}/${view.id}: observer intersects collision`);
      const subject = art.placements.find(p => `art-${p.story?.id}` === view.id);
      assert.ok(subject && Math.hypot(subject.x - view.x, subject.z - view.z) > 1);
      assert.ok(Math.abs(view.yaw - Math.atan2(view.x - subject.x, view.z - subject.z)) < 1e-8);
      assert.ok(Math.abs(view.pitch) <= .35 && Number.isFinite(view.targetY));
    }
    const stories = art.placements.filter(p => p.story && p.story.beat !== 'focal');
    assert.deepEqual([...new Set(stories.map(p => p.story.beat))].sort(), ['entry', 'junction', 'supply']);
    assert.ok(stories.length >= 7 && stories.length <= 10);
    for (const p of stories) {
      assert.equal(p.y, level.floorY, `${plan.id}/${p.label}: story prop floats above its ground support`);
      assert.ok(art.boundaries.some(boundary => boundary.id === p.boundaryId));
    }
    const hoistRoom = { 'desert-2': 'cargo', 'frost-3': 'middle', 'inferno-3': 'repair' }[plan.id];
    const hoists = stories.filter(p => p.assetId === 'SM_Env_CargoHoist');
    assert.equal(hoists.length, hoistRoom ? 1 : 0, `${plan.id}: hoist should only identify a working cargo room`);
    if (hoistRoom) { assert.equal(hoists[0].roomId, hoistRoom); assert.equal(hoists[0].story.beat, 'junction'); }
  }
});

test('working props identify only the six authored trading, repair and slag-handling rooms', () => {
  const expected = {
    'desert-2': ['SM_Env_MarketStall', 'well'], 'desert-3': ['SM_Env_MarketStall', 'inner'],
    'frost-3': ['SM_Env_FrozenSkiff', 'middle-pier'],
    'inferno-1': ['SM_Env_SlagCart', 'entry'], 'inferno-3': ['SM_Env_SlagCart', 'transfer'], 'inferno-4': ['SM_Env_SlagCart', 'molds'],
  };
  const cartHeadings = new Set();
  for (const { plan, level, art } of layouts) {
    const subjects = art.placements.filter(p => ['SM_Env_MarketStall', 'SM_Env_FrozenSkiff', 'SM_Env_SlagCart'].includes(p.assetId));
    assert.equal(subjects.length, expected[plan.id] ? 1 : 0, `${plan.id}: unrelated room gained a repeated work prop`);
    if (!subjects.length) continue;
    const p = subjects[0];
    assert.ok(art.placements.filter(member => member.story?.id === p.story.id).length <= 4,
      `${plan.id}: work grouping exceeds its own prop budget`);
    assert.deepEqual([p.assetId, p.roomId], expected[plan.id]);
    assert.equal(p.y, level.floorY);
    const view = art.inspectionViews.find(view => view.id === `art-${p.story.id}`);
    assert.ok(view, `${plan.id}: work grouping has no safe room observation view`);
    const distance = Math.hypot(p.x - view.x, p.z - view.z);
    assert.ok(distance >= 5 && distance <= 20, `${plan.id}: observation loses the room relationship at ${distance.toFixed(1)}m`);
    if (p.assetId === 'SM_Env_SlagCart') cartHeadings.add(p.yaw.toFixed(3));
  }
  assert.equal(cartHeadings.size, 3, 'slag carts must face their separate unloading approaches');
});

test('actual published landmark and story meshes remain visible from their room eye-level views', () => {
  const assets = new Map(), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  function asset(id) {
    if (assets.has(id)) return assets.get(id);
    const bytes = readFileSync(new URL(`../public/${manifest.assets[id].url}`, import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    function nodeMatrix(index) {
      const node = gltf.nodes[index], matrix = new THREE.Matrix4();
      if (node.matrix) matrix.fromArray(node.matrix);
      else matrix.compose(new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
      const parent = gltf.nodes.findIndex(n => n.children?.includes(index));
      return parent < 0 ? matrix : nodeMatrix(parent).multiply(matrix);
    }
    const geometries = gltf.nodes.map((node, index) => ({ ...node, index })).filter(node => /_LOD\d+$/.test(node.name)).sort((a, b) => a.name.localeCompare(b.name)).map(node => {
      const decoded = loadPublishedMesh(id, node.mesh), geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
      geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1)); geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false; mesh.matrix.copy(nodeMatrix(node.index)); mesh.updateMatrixWorld(true); return mesh;
    });
    const source = geometries[Math.min(1, geometries.length - 1)], bounds = architectureAssetBounds(geometries);
    // Stratified *triangle centres*, not AABB corners: the latter often sample
    // empty gate openings and gaps between branches instead of actual artwork.
    const points = new Map(), a = new THREE.Vector3(), b = a.clone(), c = a.clone();
    const position = source.geometry.attributes.position, indices = source.geometry.index;
    const size = source.geometry.boundingBox.getSize(new THREE.Vector3()), min = source.geometry.boundingBox.min;
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(position, indices.getX(i)); b.fromBufferAttribute(position, indices.getX(i + 1)); c.fromBufferAttribute(position, indices.getX(i + 2));
      const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const key = [Math.floor((centre.x - min.x) / size.x * 5), Math.floor((centre.y - min.y) / size.y * 6), Math.floor((centre.z - min.z) / size.z * 3)].join(':');
      if (!points.has(key)) points.set(key, centre);
    }
    const value = { source, bounds, geometries, points: [...points.values()] }; assets.set(id, value); return value;
  }
  const failures = [], ray = new THREE.Raycaster(), intersection = new THREE.Vector3();
  for (const { plan, level, art } of layouts) {
    const meshes = art.placements.map(placement => {
      const data = asset(placement.assetId), mesh = new THREE.Mesh(data.source.geometry, material);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(architectureMatrix(data.source, placement, data.bounds)); mesh.updateMatrixWorld(true);
      if (placement.story) {
        const inversePlacement = new THREE.Matrix4().compose(new THREE.Vector3(placement.x, placement.y, placement.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw), new THREE.Vector3(1, 1, 1)).invert();
        for (const [lod, source] of data.geometries.entries()) {
          const local = source.geometry.boundingBox.clone().applyMatrix4(inversePlacement.clone().multiply(architectureMatrix(source, placement, data.bounds)));
          const env = placement.envelope, tolerance = 1e-5;
          assert.ok(local.min.x >= -env.width / 2 - tolerance && local.max.x <= env.width / 2 + tolerance
            && local.min.z >= -env.depth / 2 - tolerance && local.max.z <= env.depth / 2 + tolerance
            && local.min.y >= -tolerance && local.max.y <= env.height + tolerance,
          `${plan.id}/${placement.assetId}/LOD${lod}: actual published mesh exceeds the tested non-walkable envelope`);
        }
      }
      return { placement, mesh, box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld), data };
    });
    for (const target of meshes.filter(item => item.placement.story)) {
      const story = target.placement.story, origin = new THREE.Vector3(story.observer.x, level.floorY + 1.62, story.observer.z);
      let visible = 0; const occluders = new Map();
      for (const local of target.data.points) {
        const point = local.clone().applyMatrix4(target.mesh.matrixWorld), direction = point.sub(origin);
        ray.near = 0; ray.far = direction.length() + .05; ray.set(origin, direction.normalize());
        let first = null, firstDistance = Infinity;
        for (const item of meshes) {
          if (!item.box.containsPoint(origin) && (!ray.ray.intersectBox(item.box, intersection) || intersection.distanceTo(origin) > ray.far)) continue;
          const hit = ray.intersectObject(item.mesh, false)[0];
          if (hit && hit.distance < firstDistance) { first = item; firstDistance = hit.distance; }
        }
        if (first === target) visible++;
        else if (first) { const key = `${first.placement.assetId}/${first.placement.role}/${first.placement.label}@[${first.placement.x.toFixed(1)},${first.placement.z.toFixed(1)}]`; occluders.set(key, (occluders.get(key) ?? 0) + 1); }
      }
      const fraction = visible / target.data.points.length;
      if (fraction < .3) failures.push(`${plan.id}/${story.id}/${target.placement.assetId}: ${(fraction * 100).toFixed(1)}% of surface samples visible; blocked by ${JSON.stringify([...occluders].sort((a,b) => b[1]-a[1]).slice(0,3))}`);
    }
  }
  for (const value of assets.values()) for (const mesh of value.geometries) mesh.geometry.dispose(); material.dispose();
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('boundary assembly uses landscape-scale pieces with a bounded instance count', () => {
  for (const { plan, art } of layouts) {
    const perimeter = art.boundaries.reduce((sum, edge) => sum + edge.length, 0);
    const edgePieces = art.placements.filter(p => ['boundary', 'corner'].includes(p.role) || p.label?.startsWith('boundary-'));
    assert.ok(edgePieces.length <= perimeter / 3 + 12, `${plan.id}: boundary density exceeds one piece per 3m`);
    assert.ok(art.placements.length >= 20 && art.placements.length < 470, `${plan.id}: oversized art instance budget (${art.placements.length})`);
    assert.ok(art.placements.filter(p => p.role === 'boundary').every(p => p.envelope.height >= 4.4), `${plan.id}: grid-sized repeated modules`);
    const bank = art.placements.filter(p => p.role === 'boundary' && p.assetId.endsWith('Cliff'));
    if (AUTHORED_ART_DIRECTION[plan.id].naturalRooms.length >= 3) assert.ok(bank.some(p => p.envelope.height >= 9.8), `${plan.id}: natural silhouette should use large cliff masses`);
  }
});

test('the repair-bay projectile window is local, names complete real subjects and never changes the floor plan', () => {
  for (const { plan, level, art, before } of layouts) {
    assert.equal(art.rayWindows.length, plan.id === 'frost-3' ? 1 : 0, `${plan.id}: an unrelated map gained a raycast aperture`);
    for (const window of art.rayWindows) {
      const b = window.bounds;
      assert.ok(b.maxX - b.minX < 8 && b.maxZ - b.minZ < 10 && b.minY === level.floorY && b.maxY - b.minY <= 10);
      assert.ok(window.placementIndices.length >= 1 && window.placementIndices.length <= 2);
      assert.equal(new Set(window.placementIndices).size, window.placementIndices.length);
      const subjects = window.placementIndices.map(index => art.placements[index]);
      assert.equal(subjects.filter(p => p.assetId === 'SM_Env_FrozenSkiff').length, 1);
      for (const p of subjects) {
        assert.equal(p.story.id, 'work-skiff');
        const actual = authoredPlacementRect(p);
        assert.ok(actual.minX >= b.minX && actual.maxX <= b.maxX && actual.minZ >= b.minZ && actual.maxZ <= b.maxZ);
        assert.ok(p.y >= b.minY && p.y + p.envelope.height <= b.maxY);
      }
    }
    assert.equal(JSON.stringify(level), before, `${plan.id}: raycast art metadata modified original navigation/colliders`);
  }
});

test('deck placements preserve the selected bridges, full passage widths and every existing collision', () => {
  const expected = { 'frost-3': ['f3-c', 'f3-d', 'f3-g', 'f3-h'], 'inferno-3': ['middle-bridge', 'north-bridge'] };
  for (const { plan, level, art, before } of layouts) {
    assert.deepEqual([...new Set(art.decks.map(p => p.passageId))].sort(), [...(expected[plan.id] ?? [])].sort());
    assert.equal(art.deckFloorMasks.length, art.decks.length);
    assert.ok(art.decks.length < 90 && art.decks.length + art.placements.length < 510,
      `${plan.id}: expanded bridge map exceeds its combined instance budget`);
    for (const [i, deck] of art.decks.entries()) {
      const passage = plan.passages.find(path => path.id === deck.passageId);
      assert.ok(authoredDeckInsideFloor(level, deck), `${plan.id}/${deck.passageId}: planks extend beyond the approved floor`);
      assert.ok(deck.envelope.width <= passage.width - .44);
      assert.ok(Math.abs(deck.envelope.width / AUTHORED_DECK_SIZE.width - deck.envelope.depth / AUTHORED_DECK_SIZE.depth) < 1e-9, 'source mesh stretched along one axis');
      assert.ok(Math.abs(deck.envelope.height / AUTHORED_DECK_SIZE.height - deck.sourceScale) < 1e-9);
      assert.ok(Math.abs(deck.y + deck.surfaceY * deck.sourceScale - (level.floorY + .01)) < 1e-9, 'rivets were used as floor datum');
      assert.deepEqual(art.deckFloorMasks[i].polygon, authoredDeckFootprint(deck));
      assert.ok(!art.architecture.includes(deck), 'ground overlays must remain distinct from blocked-wall placement');
    }
    assert.equal(JSON.stringify(level), before);
  }
});

test('published deck meshes cover each bridge centreline continuously at all three LODs', () => {
  const geometries = [0, 1, 2].map(lod => {
    const decoded = loadPublishedMesh('SM_Env_TravelDeck', lod), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1)); geometry.computeBoundingBox();
    return geometry;
  });
  const bounds = new THREE.Box3(); for (const geometry of geometries) bounds.union(geometry.boundingBox);
  const centre = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), ray = new THREE.Raycaster();
  for (const { plan, level, art } of layouts.filter(({ art }) => art.decks.length)) for (const [lod, geometry] of geometries.entries()) {
    const meshes = art.decks.map(deck => {
      const mesh = new THREE.Mesh(geometry, material);
      const scale = Math.min(deck.envelope.width / size.x, deck.envelope.height / size.y, deck.envelope.depth / size.z);
      mesh.position.set(deck.x, deck.y, deck.z); mesh.rotation.y = deck.yaw; mesh.scale.setScalar(scale); mesh.updateMatrix();
      mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z));
      mesh.matrixAutoUpdate = false; mesh.updateMatrixWorld(true); return mesh;
    });
    for (const passage of plan.passages.filter(path => art.decks.some(deck => deck.passageId === path.id))) {
      for (let segment = 1; segment < passage.points.length; segment++) {
        const a = passage.points[segment - 1], b = passage.points[segment], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let distance = 0; distance <= length; distance += .4) {
          const t = distance / length;
          ray.set(new THREE.Vector3(a[0] + (b[0] - a[0]) * t - plan.bounds[0] / 2, 2, a[1] + (b[1] - a[1]) * t - plan.bounds[1] / 2), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObjects(meshes, false)[0];
          assert.ok(hit && hit.point.y >= level.floorY - .025, `${plan.id}/${passage.id}/${segment} LOD${lod} at ${distance.toFixed(1)}m: exposed break in wooden walk surface`);
        }
      }
    }
  }
  for (const geometry of geometries) geometry.dispose(); material.dispose();
});

test('real published meshes retain eye-height boundary readability in the three reviewed difficult maps', async () => {
  const output = join(tmpdir(), `gunfire-boundary-regression-${process.pid}.json`);
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../art/tools/audit_authored_boundary.mjs', import.meta.url)),
      '--plans', 'desert-1,frost-3,inferno-3', '--height', '1.62', '--out', output], { windowsHide: true });
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.method.heightM, 1.62);
    for (const map of report.maps) {
      // This is an actual triangle ray audit. It excludes the technical closure skin.
      // Tiny corner seams remain documented; whole apparent exits must not reopen.
      assert.ok(map.lengthWeighted.noHitWithin8Fraction < .035, `${map.planId}: exposed boundary art regressed`);
      assert.ok(map.counts.near / map.samples > .78, `${map.planId}: too much art is set far behind collision`);
      for (const risk of map.risks.filter(edge => edge.length >= 8)) assert.ok(risk.noHitWithin8 / risk.samples <= .34,
        `${map.planId}/${risk.boundaryId}: a long boundary reads as open ground`);
    }
  } finally {
    await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});
