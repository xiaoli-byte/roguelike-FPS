import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return dataModule(source);
}
const navUrl = await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') });
const stageDesignUrl = await tsModule('../src/world/StageDesign.ts');
const adventureUrl = await tsModule('../src/world/AdventureGen.ts', { './NavGrid': navUrl, './StageDesign': stageDesignUrl });
const checkUrl = await tsModule('../src/world/LevelCheck.ts', { './NavGrid': navUrl });
const levelUrl = await tsModule('../src/world/LevelGen.ts', { './LevelCheck': checkUrl, './Themes': await tsModule('../src/world/Themes.ts'), './AdventureGen': adventureUrl, './StageDesign': stageDesignUrl });
const { generateLevel } = await import(levelUrl);
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const { themeStyle } = await import(await tsModule('../src/world/Themes.ts'));
const { validateAndRepair } = await import(checkUrl);
const fitUrl = await tsModule('../src/world/ScenePropFit.ts');
const { fitLandmarkTransform } = await import(fitUrl);
const libraryUrl = dataModule(`export const AssetLibrary = {
 get: id => globalThis.__landmarkAssets?.get(id) ?? null,
 preload: () => globalThis.__landmarkPreload ?? Promise.resolve()
};`);
const { SceneDressing, SCENE_PROP_IDS } = await import(await tsModule('../src/world/SceneDressing.ts', {
  '../assets/AssetLibrary': libraryUrl,
  '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment() {}'),
  './LevelGen': levelUrl, './ScenePropFit': fitUrl,
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
}));
const { drawProps } = await import(await tsModule('../src/world/Props.ts', {
  './Batch': dataModule('export const Tpl = {};'),
}));
const themes = ['desert', 'frost', 'inferno'];
const profiles = { desert: { width: 4.8, height: 4.4, depth: 2.6 }, frost: { width: 4.2, height: 5, depth: 3.2 }, inferno: { width: 4.6, height: 4.8, depth: 3.4 } };
const pointBoxDistance = (p, b) => Math.hypot(Math.max(b.minX - p.x, p.x - b.maxX, 0), Math.max(b.minZ - p.z, p.z - b.maxZ, 0));
const boxGap = (a, b) => Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0));
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-8)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function angleDifference(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

test('360 landmark layouts retain four destination silhouettes, physical clearances and native navigation', () => {
  for (const theme of themes) for (const type of ['combat', 'elite']) for (let seed = 1; seed <= 60; seed++) {
    const L = generateLevel(new Rng(seed * 7919), { theme, type, chapter: 0, index: 0, reward: 'coins' });
    const landmarks = L.decos.filter(d => d.kind === 'landmark');
    assert.equal(landmarks.length, 4, `${theme}/${type}/${seed}: architecture reservation lost`);
    assert.equal(L.adventure.rocks.filter(r => r.ridge === 'boundary').length, 48);
    assert.ok(L.adventure.rocks.filter(r => r.ridge && r.ridge !== 'boundary').reduce((area, r) => area + r.width * r.depth, 0) >= 80,
      'authored courts retain substantial natural cover between their open streets');
    const snapshot = JSON.stringify(L);
    assert.equal(validateAndRepair(L), true); assert.equal(JSON.stringify(L), snapshot, 'landmarks must not need layout repair');
    assert.equal(L.spawnPoints.length, 16);
    const targets = [...L.adventure.sites, L.adventure.objective];
    for (const [index, d] of landmarks.entries()) {
      assert.deepEqual(d.footprint, profiles[theme]); assert.equal(d.sceneLayer, 'principal'); assert.equal(d.lit, false);
      const quarter = Math.round(d.yaw / (Math.PI / 2));
      assert.ok(Math.abs(d.yaw - quarter * Math.PI / 2) < 1e-6);
      assert.ok(angleDifference(d.yaw, Math.atan2(targets[index].x - d.x, targets[index].z - d.z)) <= Math.PI / 4 + 1e-6, 'generated +Z facade must face its destination');
      const collider = L.boxes.find(b => b.group === d.group && b.tag === 'landmark');
      assert.ok(collider && collider.look === 'collider', 'landmark must register a whole solid box');
      const width = (quarter & 1 ? d.footprint.depth : d.footprint.width) * d.s;
      const depth = (quarter & 1 ? d.footprint.width : d.footprint.depth) * d.s;
      assert.ok(Math.abs(collider.maxX - collider.minX - width) < 1e-6);
      assert.ok(Math.abs(collider.maxZ - collider.minZ - depth) < 1e-6);
      assert.ok(Math.abs(collider.maxY - collider.minY - d.footprint.height * d.s) < 1e-6);
      for (const [point, radius] of [[L.playerSpawn, 4.2], [L.adventure.objective, 3.5], [L.rewardPoint, 3.4],
        ...L.adventure.sites.map(p => [p, 3.8]), ...L.portalPoints.map(p => [p, 3.4])]) {
        assert.ok(pointBoxDistance(point, collider) >= radius - 1e-6, 'architecture intrudes into an interaction or reward circle');
      }
      for (const b of L.boxes) if (b !== collider && !b.noRaycast) assert.ok(boxGap(collider, b) > 1e-6,
        `${theme}/${type}/${seed}/landmark-${index}: overlaps ${JSON.stringify(b)}`);
      for (const p of L.spawnPoints) assert.ok(pointBoxDistance(p, collider) >= 1.35 - 1e-6, 'spawn clearance lost around a landmark');
      const corners = [collider.minX, collider.maxX].flatMap(x => [collider.minZ, collider.maxZ].map(z => ({ x, z })));
      for (const path of L.adventure.paths) for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i], margin = path.width / 2 + .45;
        assert.ok(pointBoxDistance(a, collider) >= margin - 1e-6 && pointBoxDistance(b, collider) >= margin - 1e-6);
        for (const corner of corners) assert.ok(segmentDistance(corner, a, b) >= margin - 1e-6,
          `${theme}/${type}/${seed}/landmark-${index}: road width pinched at ${JSON.stringify({ corner, a, b, margin })}`);
      }
    }
    assert.equal(landmarks[3].sceneRole, 'focal');
    assert.ok(L.decos.some(d => d.sceneRole === 'focal' && d.sceneLayer === 'support' && d.kind !== 'landmark'));
  }
});

function installCanvas() {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, scale() {},
  }) }) };
  return () => { globalThis.document = previous; };
}
function sourceAsset(id) {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const lods = [0, 1, 2].map(index => {
    // Source transforms and the expanded far LOD must all fit the same envelope.
    const source = new THREE.Mesh(new THREE.BoxGeometry(2.6 + index * .15, 3.8 + index * .08, 1.9), material);
    source.name = `${id}_LOD${index}`; source.position.set(.4, 2.2, -.3); source.rotation.y = .19;
    source.updateMatrixWorld(true); return source;
  });
  return { id, entry: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, lodDistance: [0, 20, 42] }, lods };
}
function fixtureLayout(theme, yaw = 0) {
  const footprint = profiles[theme];
  return { theme, half: 42, floorY: .25, center: { x: 0, z: 0 }, boxes: [],
    decos: [{ kind: 'landmark', x: 7, y: .25, z: -11, yaw, s: .92, w: footprint.width, h: footprint.height, footprint,
      sceneRole: 'focal', sceneLayer: 'principal', lit: false, group: 400, v: .5 }] };
}
function disposeSource(asset) { for (const source of asset.lods) source.geometry.dispose(); asset.lods[0].material.map.dispose(); asset.lods[0].material.dispose(); }

test('fixture landmark LOD vertices fit solid collision envelopes after offsets and every quarter-turn', () => {
  const restore = installCanvas();
  try {
    for (const theme of themes) {
      const asset = sourceAsset(SCENE_PROP_IDS[theme].landmark);
      globalThis.__landmarkAssets = new Map([[asset.id, asset]]);
      for (let quarter = 0; quarter < 4; quarter++) {
        const L = fixtureLayout(theme, quarter * Math.PI / 2), d = L.decos[0];
        const dressing = new SceneDressing({ settings: { quality: 'high' } }, L, themeStyle(theme), () => .5, []);
        dressing.group.updateMatrixWorld(true);
        const lod = dressing.group.children.find(o => o.isLOD);
        assert.ok(lod); assert.equal(lod.matrixAutoUpdate, false);
        assert.deepEqual(lod.levels.map(level => level.distance), [0, 20, 42]);
        for (const level of lod.levels) {
          const mesh = level.object, points = mesh.geometry.getAttribute('position'), bounds = new THREE.Box3();
          assert.equal(mesh.matrixAutoUpdate, false); assert.equal(mesh.castShadow, true);
          for (let i = 0; i < points.count; i++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld));
          const width = (quarter & 1 ? d.footprint.depth : d.footprint.width) * d.s;
          const depth = (quarter & 1 ? d.footprint.width : d.footprint.depth) * d.s;
          assert.ok(bounds.min.x >= d.x - width / 2 - 1e-6 && bounds.max.x <= d.x + width / 2 + 1e-6);
          assert.ok(bounds.min.z >= d.z - depth / 2 - 1e-6 && bounds.max.z <= d.z + depth / 2 + 1e-6);
          assert.ok(bounds.min.y >= d.y - 1e-6 && bounds.max.y <= d.y + d.footprint.height * d.s + 1e-6);
        }
        dressing.dispose();
      }
      disposeSource(asset);
    }
  } finally { delete globalThis.__landmarkAssets; restore(); }
});

test('fixture repeated landmarks share materials and low quality skips the expensive LOD without disposing public art', () => {
  const restore = installCanvas(), theme = 'desert', asset = sourceAsset(SCENE_PROP_IDS[theme].landmark);
  globalThis.__landmarkAssets = new Map([[asset.id, asset]]);
  let sourceDisposed = 0;
  for (const source of asset.lods) source.geometry.addEventListener('dispose', () => sourceDisposed++);
  asset.lods[0].material.addEventListener('dispose', () => sourceDisposed++);
  asset.lods[0].material.map.addEventListener('dispose', () => sourceDisposed++);
  try {
    for (const quality of ['high', 'low']) {
      const L = fixtureLayout(theme); L.decos = Array.from({ length: 4 }, (_, i) => ({ ...L.decos[0], x: i * 8, group: 400 + i }));
      const dressing = new SceneDressing({ settings: { quality } }, L, themeStyle(theme), () => .5, []);
      const lods = dressing.group.children.filter(o => o.isLOD), ownedMaterials = new Set();
      assert.equal(lods.length, 4);
      for (const lod of lods) {
        assert.deepEqual(lod.levels.map(level => level.distance), quality === 'low' ? [0, 30] : [0, 20, 42]);
        for (const [index, level] of lod.levels.entries()) {
          assert.equal(level.object.geometry, asset.lods[index + (quality === 'low' ? 1 : 0)].geometry);
          assert.equal(level.object.castShadow, quality !== 'low'); ownedMaterials.add(level.object.material);
        }
      }
      assert.equal(ownedMaterials.size, 1);
      let cloneDisposed = 0; for (const material of ownedMaterials) material.addEventListener('dispose', () => cloneDisposed++);
      dressing.dispose(); dressing.dispose();
      assert.equal(cloneDisposed, 1); assert.equal(sourceDisposed, 0);
    }
  } finally { delete globalThis.__landmarkAssets; disposeSource(asset); restore(); }
});

test('fixture missing landmarks create no placeholder geometry and late preload cannot resurrect a disposed arena', async () => {
  const restore = installCanvas(), theme = 'desert', L = fixtureLayout(theme);
  let finish;
  globalThis.__landmarkPreload = new Promise(resolve => { finish = resolve; });
  globalThis.__landmarkAssets = new Map();
  const disposed = new SceneDressing({ settings: { quality: 'low' } }, L, themeStyle(theme), () => .5, []);
  const surviving = new SceneDressing({ settings: { quality: 'low' } }, L, themeStyle(theme), () => .5, []);
  try {
    assert.equal(disposed.group.children.length, 0); assert.equal(surviving.group.children.length, 0);
    let geometryCalls = 0;
    const batch = { setFrame() {}, clearFrame() {}, add() { geometryCalls++; }, box() { geometryCalls++; } };
    drawProps(batch, L, themeStyle(theme), () => .5, [], surviving.replaced);
    assert.equal(geometryCalls, 0, 'missing landmark must never fall back to procedural architecture');
    disposed.dispose();
    const asset = sourceAsset(SCENE_PROP_IDS[theme].landmark); globalThis.__landmarkAssets.set(asset.id, asset);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(disposed.group.children.length, 0);
    assert.equal(surviving.group.children.filter(o => o.isLOD).length, 1, 'fast starts must attach the actual generated asset when preload finishes');
    surviving.dispose(); disposeSource(asset);
  } finally { disposed.dispose(); surviving.dispose(); delete globalThis.__landmarkPreload; delete globalThis.__landmarkAssets; restore(); }
});

test('fixture unified building fit preserves proportions and centers off-origin source bounds', () => {
  const fit = fitLandmarkTransform({ min: [-3, 2, -1], max: [1, 10, 2] }, { width: 4.8, height: 4.4, depth: 2.6 });
  assert.equal(fit.scale, .55);
  assert.deepEqual(fit.offset, [1, -2, -.5]);
});
