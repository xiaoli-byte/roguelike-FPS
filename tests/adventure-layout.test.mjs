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
const { getStageDesign } = await import(stageDesignUrl);
const adventureUrl = await tsModule('../src/world/AdventureGen.ts', { './NavGrid': navUrl, './StageDesign': stageDesignUrl });
const checkUrl = await tsModule('../src/world/LevelCheck.ts', { './NavGrid': navUrl });
const { generateLevel } = await import(await tsModule('../src/world/LevelGen.ts', { './LevelCheck': checkUrl, './Themes': await tsModule('../src/world/Themes.ts'), './AdventureGen': adventureUrl, './StageDesign': stageDesignUrl }));
const { generateAdventure } = await import(adventureUrl);
const { rotateLayout, validateAndRepair, LIGHT_COUNT } = await import(checkUrl);
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const { labelComponents, rasterizeBlocked, NAV_FOOT } = await import(navUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const libraryUrl = dataModule('export const AssetLibrary = { get: id => globalThis.__adventureTestAssets?.get(id) ?? null, preload: () => globalThis.__terrainPreload ?? Promise.resolve() };');
const { AdventureTerrain, adventureRockMatrix } = await import(await tsModule('../src/world/AdventureTerrain.ts', {
  '../assets/AssetLibrary': libraryUrl, '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment() {}'),
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
}));
const themes = ['desert', 'frost', 'inferno'];
const stage = (theme, type = 'combat') => ({ type, theme, chapter: 0, index: 0, reward: 'coins' });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function navigation(L, mask) {
  const n = L.half * 2, blocked = new Uint8Array(n * n), components = new Int32Array(n * n);
  rasterizeBlocked(L.boxes, -L.half, -L.half, n, n, 1, L.floorY, NAV_FOOT, blocked);
  if (mask) for (let i = 0; i < blocked.length; i++) if (!mask({ x: i % n - L.half + .5, z: Math.floor(i / n) - L.half + .5 })) blocked[i] = 1;
  labelComponents(blocked, n, n, components, new Int32Array(n * n));
  const at = p => Math.floor(p.z + L.half) * n + Math.floor(p.x + L.half);
  const home = components[at(L.playerSpawn)];
  return { blocked, components, at, reachable: p => home >= 0 && components[at(p)] === home };
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(1e-8, dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

test('360 semi-open layouts keep all discoveries and objectives reachable with localized safe spawns', () => {
  for (const theme of themes) for (const type of ['combat', 'elite']) for (let seed = 1; seed <= 60; seed++) {
    const L = generateLevel(new Rng(seed * 7919), stage(theme, type));
    assert.equal(L.half, 42); assert.equal(L.adventure.sites.length, 3);
    assert.equal(L.lights.length, LIGHT_COUNT);
    assert.equal(L.boxes.some(b => ['wall', 'tower', 'pilaster'].includes(b.look)), false);
    assert.ok(L.adventure.rocks.some(r => distance(r, L.center) < 25), 'interior formations must define real route choices');
    const snapshot = JSON.stringify(L);
    assert.equal(validateAndRepair(L), true);
    assert.equal(JSON.stringify(L), snapshot, 'published adventure must require no repair');
    const nav = navigation(L);
    for (const p of [L.adventure.objective, ...L.adventure.sites, ...L.adventure.zones, ...L.adventure.paths.flatMap(path => path.points), L.rewardPoint, ...L.portalPoints, ...L.checks]) assert.ok(nav.reachable(p), `${theme}/${type}/${seed}: unreachable point`);
    assert.ok(L.spawnPoints.length >= 14, `${theme}/${seed}: too few safe spawns`);
    for (const p of L.spawnPoints) {
      assert.ok(nav.reachable(p));
      assert.ok(distance(p, L.adventure.objective) >= 12 && distance(p, L.adventure.objective) <= 23);
      assert.ok(distance(p, L.playerSpawn) >= 14);
    }
    for (const p of L.portalPoints) assert.ok(distance(p, L.adventure.objective) >= 7);
    assert.ok(distance(L.adventure.objective, L.center) >= 12, 'objective must be asymmetric');
  }
});

test('two independent route corridors remain physically walkable across 120 seeds', () => {
  for (const theme of themes) for (let seed = 1; seed <= 40; seed++) {
    const L = generateLevel(new Rng(seed * 4093), stage(theme));
    for (const path of L.adventure.paths.slice(0, 2)) {
      assert.ok(path.width >= 5);
      const nav = navigation(L, p => path.points.slice(1).some((b, i) => segmentDistance(p, path.points[i], b) < path.width / 2));
      assert.ok(nav.reachable(L.adventure.objective), `${theme}/${seed}: alternate corridor disconnected`);
      for (const p of path.points) assert.ok(nav.reachable(p), `${theme}/${seed}: unreachable alternate route waypoint`);
    }
    // Closing the western approach still leaves the eastern approach usable.
    const west = L.adventure.paths[0].points[1];
    const nav = navigation(L, p => distance(p, west) > 5.5);
    assert.ok(nav.reachable(L.adventure.objective));
    assert.ok(nav.reachable(L.adventure.sites[1]));
  }
});

test('authored ridges remain connected while streets retain substantial mixed cover and a bent natural boundary', () => {
  for (const theme of themes) for (let seed = 1; seed <= 40; seed++) {
    const L = generateLevel(new Rng(seed * 6397), stage(theme));
    const interior = L.adventure.rocks.filter(r => r.ridge && r.ridge !== 'boundary');
    assert.ok(interior.reduce((area, r) => area + r.width * r.depth, 0) >= 80, 'natural cover disappeared between authored streets');
    assert.ok(L.architecture.filter(a => a.type === 'wall').length >= 8, 'actual wall modules must organize street cover');
    for (const id of ['west-ridge', 'central-ridge', 'north-ridge']) {
      const rocks = L.adventure.rocks.filter(r => r.ridge === id);
      const design = getStageDesign(stage(theme)), requested = design.ridges.find(r => r.id === id).anchors.length;
      assert.ok(rocks.length <= requested, 'a ridge cannot grow beyond the authored foreground budget');
      for (const rock of rocks) assert.ok(rock.width >= 5 && rock.depth >= 5 && rock.height >= design.ridgeHeight[0]);
      if (!rocks.length) continue;
      const reached = new Set([0]);
      for (let attempt = 0; attempt < rocks.length; attempt++) for (let i = 0; i < rocks.length; i++) for (const j of reached) {
        const a = rocks[i], b = rocks[j];
        const gap = Math.hypot(Math.max(Math.abs(a.x - b.x) - (a.width + b.width) / 2, 0), Math.max(Math.abs(a.z - b.z) - (a.depth + b.depth) / 2, 0));
        if (gap < .21) reached.add(i);
      }
      assert.equal(reached.size, rocks.length, 'ridge must form one connected formation');
    }
    const radii = L.adventure.rocks.filter(r => r.ridge === 'boundary').map(r => Math.hypot(r.x, r.z));
    assert.ok(Math.max(...radii) - Math.min(...radii) > 2, 'boundary must have visible inward/outward bends');
  }
});

test('six invalid adventure attempts fall back to a navigable classic room without throwing during load', async () => {
  const invalidUrl = dataModule('export function generateAdventure(){ globalThis.__adventureAttempts++; const L = structuredClone(globalThis.__invalidAdventureFixture); L.spawnPoints = []; return L; }');
  const { generateLevel: failSafeGenerate } = await import(await tsModule('../src/world/LevelGen.ts', { './LevelCheck': checkUrl, './Themes': await tsModule('../src/world/Themes.ts'), './AdventureGen': invalidUrl, './StageDesign': stageDesignUrl }));
  globalThis.__adventureAttempts = 0;
  globalThis.__invalidAdventureFixture = generateAdventure(new Rng(9), stage('desert'));
  const L = failSafeGenerate(new Rng(41), stage('desert'));
  assert.equal(globalThis.__adventureAttempts, 6);
  assert.equal(L.adventure, undefined); assert.equal(validateAndRepair(L), true);
  delete globalThis.__adventureAttempts; delete globalThis.__invalidAdventureFixture;
});

test('seed determinism, quarter-turn data rotation, and classic special rooms remain stable', () => {
  for (const theme of themes) {
    assert.deepEqual(generateLevel(new Rng(20261004), stage(theme)), generateLevel(new Rng(20261004), stage(theme)));
    for (const type of ['boss', 'treasure', 'shop']) assert.equal(generateLevel(new Rng(7), stage(theme, type)).adventure, undefined);
    assert.equal(generateLevel(new Rng(7), stage(theme), { adventure: false }).half, 28);
    const L = generateAdventure(new Rng(71), stage(theme)), original = structuredClone(L);
    rotateLayout(L, 1);
    assert.deepEqual(L.adventure.objective, { x: original.adventure.objective.z, z: -original.adventure.objective.x });
    for (let i = 0; i < L.adventure.rocks.length; i++) {
      const r = L.adventure.rocks[i], before = original.adventure.rocks[i];
      assert.equal(r.width, before.depth); assert.equal(r.depth, before.width);
      assert.equal(r.x, before.z); assert.equal(r.z, -before.x);
    }
    for (let p = 0; p < L.adventure.paths.length; p++) for (let i = 0; i < L.adventure.paths[p].points.length; i++) {
      const after = L.adventure.paths[p].points[i], before = original.adventure.paths[p].points[i];
      assert.deepEqual({ x: after.x, z: after.z }, { x: before.z, z: -before.x });
    }
    rotateLayout(L, 3);
    for (const p of L.adventure.paths.flatMap(p => p.points)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  }
});

test('continuous natural barriers confine the reachable region and move the fallback boundary outside it', () => {
  for (const theme of themes) for (let seed = 1; seed <= 20; seed++) {
    const L = generateLevel(new Rng(seed * 193), stage(theme));
    const nav = navigation(L), n = L.half * 2;
    for (let i = 0; i < n; i++) for (const p of [{ x: i - L.half + .5, z: -L.half + .5 }, { x: i - L.half + .5, z: L.half - .5 }, { x: -L.half + .5, z: i - L.half + .5 }, { x: L.half - .5, z: i - L.half + .5 }]) assert.equal(nav.reachable(p), false, 'visible formation ring must close before the air boundary');
    for (const b of L.boxes.filter(b => b.tag === 'boundary')) assert.ok(Math.min(Math.abs((b.minX + b.maxX) / 2), Math.abs((b.minZ + b.maxZ) / 2)) === 0 && Math.max(Math.abs((b.minX + b.maxX) / 2), Math.abs((b.minZ + b.maxZ) / 2)) > L.half);
  }
});

test('the low overlook has usable collision steps and its foot stays on native ground navigation', () => {
  const L = generateAdventure(new Rng(903), stage('desert')), nav = navigation(L), ramp = L.ramps[0];
  assert.ok(nav.reachable(ramp.foot)); assert.equal(ramp.top, 1.2);
  const world = new CollisionWorld();
  world.addBox(-56, -4, -56, 56, 0, 56, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const position = new THREE.Vector3(ramp.foot.x, .0001, ramp.foot.z);
  for (let i = 0; i < 80; i++) world.moveBody(position, .35, 1.8, new THREE.Vector3(0, -.02, -.07), true);
  assert.ok(position.y > 1.19 && position.z < ramp.z1, `failed to ascend actual 30 cm collision steps: ${position.toArray()}`);
});

test('instanced source vertices fit the corresponding rock envelope before and after rotation', () => {
  const source = new THREE.Mesh(new THREE.BoxGeometry(2.3, 3.8, 1.7), new THREE.MeshStandardMaterial());
  source.position.set(.4, 1.9, -.1); source.rotation.y = .27; source.updateMatrixWorld(true);
  const positions = source.geometry.getAttribute('position');
  const original = { x: 5, z: -7, width: 9, depth: 6, height: 12, yaw: 0 };
  for (const quarter of [0, 1, 2, 3]) {
    const rock = { ...original, yaw: quarter * Math.PI / 2, width: quarter & 1 ? original.depth : original.width, depth: quarter & 1 ? original.width : original.depth };
    const matrix = adventureRockMatrix(source, rock, .25), box = new THREE.Box3();
    for (let i = 0; i < positions.count; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
    assert.ok(Math.abs(box.min.x - (rock.x - rock.width / 2)) < 1e-6);
    assert.ok(Math.abs(box.max.x - (rock.x + rock.width / 2)) < 1e-6);
    assert.ok(Math.abs(box.min.z - (rock.z - rock.depth / 2)) < 1e-6);
    assert.ok(Math.abs(box.max.z - (rock.z + rock.depth / 2)) < 1e-6);
    assert.ok(Math.abs(box.min.y - .25) < 1e-6); assert.ok(Math.abs(box.max.y - 12.25) < 1e-6);
  }
  source.geometry.dispose(); source.material.dispose();
});

test('terrain owns only its instance buffer and cloned material, uses appropriate mesh budgets', () => {
  const packed = new THREE.Texture(), normal = new THREE.Texture();
  let mapsDisposed = 0; [packed, normal].forEach(map => map.addEventListener('dispose', () => mapsDisposed++));
  const materials = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ roughness: .2, metalness: .7,
    roughnessMap: packed, metalnessMap: packed, normalMap: normal }));
  const meshes = materials.map((material, i) => new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2), material));
  meshes.forEach(m => { m.position.y = 1.5; m.updateMatrixWorld(true); });
  globalThis.__adventureTestAssets = new Map(['SM_Env_DesertSandstone', 'SM_Env_InfernoBasalt'].map(id => [id, { id, lods: meshes }]));
  for (const quality of ['low', 'high']) for (const theme of themes) {
    const L = generateAdventure(new Rng(8), stage(theme));
    let sourceDisposed = 0; meshes.forEach(m => m.geometry.addEventListener('dispose', () => sourceDisposed++));
    const terrain = new AdventureTerrain({ settings: { quality } }, L), chunks = terrain.group.children;
    assert.ok(chunks.length > 1 && chunks.length <= 16, 'bounded spatial batches must replace the all-map sphere');
    assert.equal(chunks.reduce((n, lod) => n + lod.levels[0].object.count, 0), L.adventure.rocks.length);
    const ownedMaterials = new Set();
    for (const lod of chunks) {
      assert.equal(lod.matrixAutoUpdate, false);
      assert.deepEqual(lod.levels.map(l => l.distance), quality === 'low' ? [0] : [0, 42]);
      for (const [i, level] of lod.levels.entries()) {
        const mesh = level.object;
        assert.equal(mesh.geometry, meshes[quality === 'low' || i === 1 ? 2 : 1].geometry);
        assert.equal(mesh.castShadow, quality !== 'low');
        assert.equal(mesh.matrixAutoUpdate, false);
        assert.equal(mesh.material.roughnessMap, null); assert.ok(mesh.material.roughness >= .82);
        assert.equal(mesh.material.metalness, 0); assert.equal(mesh.material.normalMap, normal);
        assert.deepEqual(mesh.material.normalScale.toArray(), [.22, .22]);
        ownedMaterials.add(mesh.material);
      }
    }
    let materialDisposed = 0; ownedMaterials.forEach(m => m.addEventListener('dispose', () => materialDisposed++));
    terrain.dispose(); terrain.dispose();
    assert.equal(materialDisposed, ownedMaterials.size); assert.equal(sourceDisposed, 0);
    assert.equal(mapsDisposed, 0);
    for (const original of materials) {
      assert.equal(original.roughnessMap, packed); assert.equal(original.roughness, .2);
      assert.equal(original.metalness, .7); assert.deepEqual(original.normalScale.toArray(), [1, 1]);
    }
  }
  delete globalThis.__adventureTestAssets;
  meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  packed.dispose(); normal.dispose();
});

test('spatial rock LODs preserve every collision envelope and cull formations behind the player', () => {
  const meshes = [0, 1, 2].map(i => new THREE.Mesh(new THREE.BoxGeometry(2 + i * .1, 3, 2), new THREE.MeshStandardMaterial()));
  meshes.forEach(m => { m.position.set(.2, 1.5, -.1); m.rotation.y = .21; m.updateMatrixWorld(true); });
  const id = 'SM_Env_DesertSandstone';
  globalThis.__adventureTestAssets = new Map([[id, { id, lods: meshes }]]);
  const L = generateLevel(new Rng(20261004), stage('desert'));
  const terrain = new AdventureTerrain({ settings: { quality: 'high' } }, L);
  terrain.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 500);
  camera.position.set(L.adventure.objective.x, 1.6, L.adventure.objective.z);
  camera.rotation.y = 0; camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let visible = 0, far = 0;
  const identity = new THREE.Matrix4();
  for (const lod of terrain.group.children) {
    lod.update(camera);
    const selected = lod.levels[lod.getCurrentLevel()].object;
    if (frustum.intersectsObject(selected)) visible += selected.count;
    if (lod.getCurrentLevel() === 1) far++;
    for (const level of lod.levels) {
      const instance = level.object, positions = instance.geometry.getAttribute('position'), found = new Set();
      for (let i = 0; i < instance.count; i++) {
        instance.getMatrixAt(i, identity);
        const matrix = instance.matrixWorld.clone().multiply(identity), bounds = new THREE.Box3();
        for (let p = 0; p < positions.count; p++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, p).applyMatrix4(matrix));
        const center = bounds.getCenter(new THREE.Vector3());
        const index = L.adventure.rocks.findIndex(r => Math.abs(r.x - center.x) < 1e-5 && Math.abs(r.z - center.z) < 1e-5);
        assert.ok(index >= 0 && !found.has(index)); found.add(index);
        const rock = L.adventure.rocks[index];
        assert.ok(Math.abs(bounds.min.x - (rock.x - rock.width / 2)) < 1e-5);
        assert.ok(Math.abs(bounds.max.z - (rock.z + rock.depth / 2)) < 1e-5);
        assert.ok(Math.abs(bounds.min.y - L.floorY) < 1e-5 && Math.abs(bounds.max.y - L.floorY - rock.height) < 1e-5);
      }
    }
  }
  assert.ok(visible < L.adventure.rocks.length * .85, 'off-screen formations should not be submitted');
  assert.ok(far > 0, 'distant formations should select the published final LOD');
  terrain.dispose(); delete globalThis.__adventureTestAssets;
  meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
});

test('published cliff fixture forms boundaries and regional ridges while small rocks retain their own source', () => {
  const cliffMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const cliffs = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(12, 9, 7), cliffMaterial));
  const rubble = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(3.5, 3, 2.3), rockMaterial));
  cliffs.forEach(m => { m.position.set(.2, 4.5, -.1); m.updateMatrixWorld(true); });
  rubble.forEach(m => { m.position.set(-.1, 1.5, .2); m.updateMatrixWorld(true); });
  for (const theme of themes) {
    const prefix = theme === 'desert' ? 'Desert' : theme === 'frost' ? 'Frost' : 'Inferno';
    const cliffId = `SM_Env_${prefix}Cliff`, rockId = theme === 'inferno' ? 'SM_Env_InfernoBasalt' : 'SM_Env_DesertSandstone';
    globalThis.__adventureTestAssets = new Map([[cliffId, { id: cliffId, lods: cliffs }], [rockId, { id: rockId, lods: rubble }]]);
    const L = generateAdventure(new Rng(20261004), stage(theme));
    const terrain = new AdventureTerrain({ settings: { quality: 'high' } }, L);
    terrain.group.updateMatrixWorld(true);
    let formationCount = 0, rubbleCount = 0;
    for (const lod of terrain.group.children) {
      const formation = lod.name.startsWith(cliffId);
      assert.deepEqual(lod.levels.map(l => l.distance), [0, 42]);
      if (formation) formationCount += lod.levels[0].object.count;
      else rubbleCount += lod.levels[0].object.count;
      for (const [i, level] of lod.levels.entries()) {
        const instance = level.object;
        assert.equal(instance.geometry, (formation ? cliffs : rubble)[i ? 2 : 1].geometry);
        if (formation && theme === 'frost') {
          assert.ok(instance.material.color.equals(cliffMaterial.color), 'actual authored snow cliff must retain its painted colour');
          assert.notEqual(instance.material.customProgramCacheKey(), 'adventure-snow-rock-v1');
        }
        const local = new THREE.Matrix4(), vertices = instance.geometry.getAttribute('position');
        for (let index = 0; index < instance.count; index++) {
          instance.getMatrixAt(index, local);
          const matrix = instance.matrixWorld.clone().multiply(local), bounds = new THREE.Box3();
          for (let p = 0; p < vertices.count; p++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(vertices, p).applyMatrix4(matrix));
          const center = bounds.getCenter(new THREE.Vector3());
          const rock = L.adventure.rocks.find(r => Math.abs(r.x - center.x) < 1e-5 && Math.abs(r.z - center.z) < 1e-5);
          assert.ok(rock && !!rock.ridge === formation);
          assert.ok(Math.abs(bounds.min.x - (rock.x - rock.width / 2)) < 1e-5 && Math.abs(bounds.max.z - (rock.z + rock.depth / 2)) < 1e-5);
          assert.ok(Math.abs(bounds.max.y - L.floorY - rock.height) < 1e-5);
        }
      }
    }
    assert.equal(formationCount, L.adventure.rocks.filter(r => r.ridge).length);
    assert.equal(rubbleCount, L.adventure.rocks.filter(r => !r.ridge).length);
    terrain.dispose();
  }
  delete globalThis.__adventureTestAssets;
  [...cliffs, ...rubble].forEach(m => m.geometry.dispose()); cliffMaterial.dispose(); rockMaterial.dispose();
});

test('late cliff fixture atomically replaces borrowed rock art and never revives a disposed terrain', async () => {
  let finish; globalThis.__terrainPreload = new Promise(resolve => finish = resolve);
  const material = new THREE.MeshStandardMaterial();
  const rocks = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2), material));
  const cliffs = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(12, 9, 7), material));
  rocks.forEach(m => { m.position.y = 1.5; m.updateMatrixWorld(true); });
  cliffs.forEach(m => { m.position.y = 4.5; m.updateMatrixWorld(true); });
  const rockId = 'SM_Env_DesertSandstone', cliffId = 'SM_Env_FrostCliff';
  globalThis.__adventureTestAssets = new Map([[rockId, { id: rockId, lods: rocks }]]);
  // The reviewed entrance can legitimately reserve every default loose rock.
  // Choose a seeded mixed family to exercise preservation of old rubble.
  const L = Array.from({ length: 12 }, (_, i) => generateAdventure(new Rng((i + 1) * 7919), stage('frost')))
    .find(layout => layout.adventure.rocks.some(rock => !rock.ridge));
  assert.ok(L, 'late-load regression needs both a formation and loose rubble');
  const active = new AdventureTerrain({ settings: { quality: 'high' } }, L);
  const disposed = new AdventureTerrain({ settings: { quality: 'high' } }, L);
  const oldMaterials = new Set(active.group.children.flatMap(lod => lod.levels.map(level => level.object.material)));
  let clonesDisposed = 0; oldMaterials.forEach(m => m.addEventListener('dispose', () => clonesDisposed++));
  assert.equal(active.group.children.reduce((n, lod) => n + lod.levels[0].object.count, 0), L.adventure.rocks.length);
  disposed.dispose();
  globalThis.__adventureTestAssets.set(cliffId, { id: cliffId, lods: cliffs });
  finish(); await globalThis.__terrainPreload; await Promise.resolve();
  assert.equal(clonesDisposed, oldMaterials.size, 'temporary instance materials must be released once after replacement');
  assert.ok(active.group.children.some(lod => lod.name.startsWith(cliffId)));
  assert.ok(active.group.children.some(lod => lod.name.startsWith(rockId)));
  assert.equal(active.group.children.reduce((n, lod) => n + lod.levels[0].object.count, 0), L.adventure.rocks.length);
  assert.equal(disposed.group.children.length, 0);
  active.dispose(); delete globalThis.__terrainPreload; delete globalThis.__adventureTestAssets;
  [...rocks, ...cliffs].forEach(m => m.geometry.dispose()); material.dispose();
});
