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
const { generateAdventure } = await import(await tsModule('../src/world/AdventureGen.ts', { './NavGrid': navUrl, './StageDesign': await tsModule('../src/world/StageDesign.ts') }));
const { rotateLayout, validateAndRepair } = await import(await tsModule('../src/world/LevelCheck.ts', { './NavGrid': navUrl }));
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const { NAV_FOOT, rasterizeBlocked } = await import(navUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const libraryUrl = dataModule(`export const AssetLibrary = {
 get: id => globalThis.__architectureAssets?.get(id) ?? null,
 preload: () => globalThis.__architecturePreload ?? Promise.resolve()
};`);
const { SceneArchitecture, architectureAssetBounds, architectureMatrix } = await import(await tsModule('../src/world/SceneArchitecture.ts', {
  '../assets/AssetLibrary': libraryUrl,
  '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment() {}'),
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
}));
const themes = ['desert', 'frost', 'inferno'];
const stage = (theme, index = 0) => ({ type: 'combat', theme, chapter: themes.indexOf(theme), index, reward: 'coins' });

test('363 architecture layouts retain visible arrival posts, real portal openings and unrepaired safe spawn navigation', () => {
  for (const theme of themes) for (const seed of [20261004, ...Array.from({ length: 120 }, (_, i) => (i + 1) * 7919)]) {
    const L = generateAdventure(new Rng(seed), stage(theme)), gates = L.architecture.filter(a => a.type === 'gate');
    assert.equal(gates.length, 2, `${theme}/${seed}: missing regional gate`);
    assert.ok(L.architecture.length >= 14, `${theme}/${seed}: too few connected building modules`);
    assert.deepEqual([...new Set(L.architecture.map(a => a.court))].sort(), ['arrival', 'east', 'north', 'shrine', 'west']);
    const arrival = gates.find(a => a.court === 'arrival'), ae = arrival.envelope;
    assert.equal(L.adventure.rocks.filter(r => r.ridge === 'boundary').length, 48);
    for (const gate of gates) for (const rock of L.adventure.rocks) {
      const c = Math.abs(Math.cos(gate.yaw)), s = Math.abs(Math.sin(gate.yaw)), e = gate.envelope;
      const width = (e.width * c + e.depth * s) * gate.s, depth = (e.depth * c + e.width * s) * gate.s;
      const gap = Math.hypot(Math.max(Math.abs(gate.x - rock.x) - (width + rock.width) / 2, 0),
        Math.max(Math.abs(gate.z - rock.z) - (depth + rock.depth) / 2, 0));
      assert.ok(gap >= .2 - 1e-6, `${theme}/${seed}/${gate.court}: a rock swallowed a post or lintel joint`);
    }
    for (const sign of [-1, 1]) {
      const start = new THREE.Vector3(L.playerSpawn.x, .05, L.playerSpawn.z);
      const end = new THREE.Vector3(arrival.x + sign * (ae.width + arrival.passage.width) * arrival.s / 4, .05, arrival.z);
      const direction = end.clone().sub(start).normalize(), side = new THREE.Vector3(-direction.z, 0, direction.x);
      for (const offset of [-.5, 0, .5]) {
        const ray = new THREE.Ray(start.clone().addScaledVector(side, offset), direction), hit = new THREE.Vector3();
        for (const rock of L.adventure.rocks.filter(r => !r.ridge)) {
          const volume = new THREE.Box3(new THREE.Vector3(rock.x - rock.width / 2, 0, rock.z - rock.depth / 2),
            new THREE.Vector3(rock.x + rock.width / 2, rock.height, rock.z + rock.depth / 2));
          const intersection = ray.intersectBox(volume, hit);
          assert.ok(!intersection || hit.distanceTo(ray.origin) > start.distanceTo(end), `${theme}/${seed}: loose rubble obscured an entrance post foot`);
        }
      }
    }
    if (theme === 'frost') {
      const pines = L.decos.filter(d => d.kind === 'pine');
      assert.ok(pines.length >= 4 && pines.length <= 8, `${theme}/${seed}: sparse published forest lost`);
      assert.equal(L.boxes.filter(b => b.tag === 'pine-trunk').length, pines.length);
      for (const pine of pines) {
        const trunk = L.boxes.find(b => b.tag === 'pine-trunk' && Math.abs((b.minX + b.maxX) / 2 - pine.x) < 1e-6
          && Math.abs((b.minZ + b.maxZ) / 2 - pine.z) < 1e-6);
        assert.ok(Math.abs(trunk.maxX - trunk.minX - 1.46 * pine.s) < 1e-6);
        const crownRadius = 1.55 * pine.s;
        for (const b of L.boxes.filter(b => b.tag === 'landmark' || b.tag.startsWith('architecture-')))
          assert.ok(Math.hypot(Math.max(b.minX - pine.x, pine.x - b.maxX, 0), Math.max(b.minZ - pine.z, pine.z - b.maxZ, 0)) >= crownRadius + .15 - 1e-6,
            'pine canopy swallowed a generated doorway or landmark');
      }
    }
    const before = JSON.stringify(L);
    assert.equal(validateAndRepair(L), true); assert.equal(JSON.stringify(L), before, 'architecture cannot depend on a repair deleting structures');
    assert.ok(L.spawnPoints.length >= 14);
    const n = L.half * 2, blocked = new Uint8Array(n * n);
    rasterizeBlocked(L.boxes, -L.half, -L.half, n, n, 1, L.floorY, NAV_FOOT, blocked);
    for (const gate of gates) {
      assert.ok(gate.passage.width * gate.s >= 7, 'two-way passage must retain corridor and body margin');
      assert.ok(gate.passage.height * gate.s > 3);
      for (const distance of [-1.8, 0, 1.8]) {
        const x = gate.x + Math.sin(gate.yaw) * distance, z = gate.z + Math.cos(gate.yaw) * distance;
        assert.equal(blocked[Math.floor(z + L.half) * n + Math.floor(x + L.half)], 0, `${theme}/${seed}: grounded doorway obstructed`);
      }
      const posts = L.boxes.filter(b => b.tag === 'architecture-gate' && b.minY < 1.9
        && Math.hypot((b.minX + b.maxX) / 2 - gate.x, (b.minZ + b.maxZ) / 2 - gate.z) < 8);
      assert.equal(posts.length, 2, 'gate is two grounded posts, not a solid whole facade');
    }
    const original = structuredClone(L);
    rotateLayout(L, 1);
    for (const [i, a] of L.architecture.entries()) {
      const was = original.architecture[i];
      assert.equal(a.x, was.z); assert.equal(a.z, -was.x);
      assert.equal(a.yaw, was.yaw + Math.PI / 2); assert.deepEqual(a.envelope, was.envelope);
    }
  }
});

test('360 authored stage layouts expose both gates and visible building streets without deleting geometry to repair navigation', () => {
  for (const theme of themes) for (let index = 0; index < 4; index++) for (let seed = 1; seed <= 30; seed++) {
    const node = stage(theme, index), derivedSeed = seed * 7919 ^ (node.chapter * 7919 + node.index * 104729 + 17);
    const L = generateAdventure(new Rng(derivedSeed), node), key = `${theme}/${index}/${seed}`;
    assert.equal(L.architecture.filter(a => a.type === 'gate').length, 2, `${key}: a route lost its portal`);
    assert.ok(L.architecture.filter(a => a.type === 'wall').length >= 8, `${key}: no recognizable published wall streets`);
    assert.ok(L.architecture.length <= 22, `${key}: architecture exceeded the foreground budget`);
    assert.equal(L.adventure.rocks.filter(r => r.ridge === 'boundary').length, 48);
    assert.ok(L.adventure.rocks.filter(r => r.ridge).length <= 63);
    for (const a of L.architecture) for (const rock of L.adventure.rocks) {
      const c = Math.abs(Math.cos(a.yaw)), s = Math.abs(Math.sin(a.yaw)), e = a.envelope;
      const gap = Math.hypot(Math.max(Math.abs(a.x - rock.x) - ((e.width * c + e.depth * s) * a.s + rock.width) / 2, 0),
        Math.max(Math.abs(a.z - rock.z) - ((e.depth * c + e.width * s) * a.s + rock.depth) / 2, 0));
      assert.ok(gap >= .2 - 1e-6, `${key}/${a.type}: cliff swallowed a published structure`);
    }
    const before = JSON.stringify(L);
    assert.equal(validateAndRepair(L), true, `${key}: native navigation rejected an authored scene`);
    assert.equal(JSON.stringify(L), before, `${key}: repair removed authored geometry or formation anchors`);
    assert.ok(L.spawnPoints.length >= 14, `${key}: main battle lost safe spawn capacity`);
    assert.ok(L.adventure.encounters.length >= 2 && L.adventure.encounters.every(e => e.anchors.length >= 8));
  }
});

test('actual collision body traverses both default and 360 seeded gates across all four orientations', () => {
  for (const theme of themes) for (const seed of [20261004, ...Array.from({ length: 120 }, (_, i) => (i + 1) * 7919)]) {
    // The default player views cover every direction; seeded layouts distribute
    // the rotated approaches across the same four orientations.
    for (const quarter of seed === 20261004 ? [0, 1, 2, 3] : [seed % 4]) {
      const L = generateAdventure(new Rng(seed), stage(theme));
      rotateLayout(L, quarter);
      const world = new CollisionWorld();
      world.addBox(-56, -4, -56, 56, 0, 56, 'floor');
      for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
      for (const gate of L.architecture.filter(a => a.type === 'gate')) {
        const forward = new THREE.Vector3(Math.sin(gate.yaw), 0, Math.cos(gate.yaw));
        const position = new THREE.Vector3(gate.x, .0001, gate.z).addScaledVector(forward, -3);
        for (let i = 0; i < 100; i++) world.moveBody(position, .55, 2.1, forward.clone().multiplyScalar(.06), true);
        assert.ok(new THREE.Vector3(position.x - gate.x, 0, position.z - gate.z).dot(forward) > 2.9, `${theme}/${seed}/${quarter}: physical body struck an invisible facade`);
      }
    }
  }
});

test('actual published pine roots fit the sparse forest trunk collider across all LODs', async () => {
  const { loadPublishedMesh } = await import('../art/tools/pose_geometry_audit.mjs');
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')).assets;
  const id = 'SM_Env_FrostPine', bytes = await readFile(new URL(`../public/${manifest[id].url}`, import.meta.url));
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const nodeMatrix = index => {
    const node = document.nodes[index];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = document.nodes.findIndex(n => n.children?.includes(index));
    return parent < 0 ? local : nodeMatrix(parent).multiply(local);
  };
  for (const lod of [0, 1, 2]) {
    const node = document.nodes.findIndex(n => n.name === `${id}_LOD${lod}`);
    const data = loadPublishedMesh(id, document.nodes[node].mesh), matrix = nodeMatrix(node);
    let rootCount = 0, rootRadius = 0;
    for (let i = 0; i < data.attrs.POSITION.length; i += 3) {
      const p = new THREE.Vector3().fromArray(data.attrs.POSITION, i).applyMatrix4(matrix);
      if (p.y <= .5) { rootCount++; rootRadius = Math.max(rootRadius, Math.hypot(p.x, p.z)); }
    }
    assert.ok(rootCount > 10, 'actual exported root geometry must be measured');
    assert.ok(rootRadius <= .73, `LOD${lod} root extends outside the reserved .73m radius: ${rootRadius}`);
  }
});

test('all fixture LOD vertices share one uniform authored fit and stay within the rotated envelope', () => {
  const meshes = [0, 1, 2].map(i => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5.8 - i * .15, 4 - i * .08, 1.1), new THREE.MeshStandardMaterial());
    mesh.position.set(.31 + i * .02, 2, -.2); mesh.updateMatrixWorld(true); return mesh;
  });
  const bounds = architectureAssetBounds(meshes);
  for (const quarter of [0, 1, 2, 3]) {
    const placement = { type: 'wall', assetId: 'SM_Env_DesertWall', court: 'arrival', x: 7, y: .25, z: -5,
      yaw: quarter * Math.PI / 2, s: 1.2, envelope: { width: 6.6, height: 4.4, depth: 1.3 } };
    let scale;
    for (const source of meshes) {
      const matrix = architectureMatrix(source, placement, bounds), authored = matrix.clone().multiply(source.matrixWorld.clone().invert());
      const sizes = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
      authored.decompose(position, rotation, sizes);
      assert.ok(Math.abs(sizes.x - sizes.y) < 1e-8 && Math.abs(sizes.y - sizes.z) < 1e-8, 'art was stretched');
      if (scale !== undefined) assert.ok(Math.abs(scale - sizes.x) < 1e-8, 'LOD re-fit caused scale popping');
      scale = sizes.x;
      const extentX = (quarter & 1 ? placement.envelope.depth : placement.envelope.width) * placement.s / 2;
      const extentZ = (quarter & 1 ? placement.envelope.width : placement.envelope.depth) * placement.s / 2;
      const vertices = source.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(matrix);
        assert.ok(Math.abs(p.x - placement.x) <= extentX + 1e-6 && Math.abs(p.z - placement.z) <= extentZ + 1e-6);
        assert.ok(p.y >= placement.y - 1e-6 && p.y <= placement.y + placement.envelope.height * placement.s + 1e-6);
      }
    }
  }
  meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
});

test('fixture instancing borrows published geometry and shares clone materials without disposing art', () => {
  const original = new THREE.MeshStandardMaterial({ roughness: .4 });
  const meshes = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(6.6, 4.4, 1.3), original));
  meshes.forEach(m => { m.position.y = 2.2; m.updateMatrixWorld(true); });
  const id = 'SM_Env_DesertWall';
  globalThis.__architectureAssets = new Map([[id, { id, lods: meshes }]]);
  let geometryDisposed = 0; meshes.forEach(m => m.geometry.addEventListener('dispose', () => geometryDisposed++));
  for (const quality of ['high', 'low']) {
    const camera = new THREE.PerspectiveCamera(); camera.position.set(-8.5, 1.6, 29); camera.updateMatrixWorld(true);
    const L = generateAdventure(new Rng(20261004), stage('desert'));
    const architecture = new SceneArchitecture({ camera, settings: { quality } }, L);
    const materials = new Set(); let count = 0;
    for (const lod of architecture.group.children) {
      assert.equal(lod.matrixAutoUpdate, false); assert.equal(lod.autoUpdate, false);
      assert.deepEqual(lod.levels.map(l => l.distance), quality === 'low' ? [0] : [0, 44]);
      count += lod.levels[0].object.count;
      for (const [i, level] of lod.levels.entries()) {
        const instance = level.object; materials.add(instance.material);
        assert.equal(instance.geometry, meshes[quality === 'low' || i ? 2 : 1].geometry);
        assert.equal(instance.matrixAutoUpdate, false); assert.equal(instance.castShadow, quality !== 'low');
      }
    }
    assert.equal(count, L.architecture.filter(a => a.type === 'wall').length);
    assert.equal(materials.size, 1, 'building copies must share one clone across chunks and LODs');
    let cloneDisposed = 0; materials.forEach(m => m.addEventListener('dispose', () => cloneDisposed++));
    architecture.dispose(); architecture.dispose(); assert.equal(cloneDisposed, 1); assert.equal(geometryDisposed, 0);
  }
  delete globalThis.__architectureAssets;
  meshes.forEach(m => m.geometry.dispose()); original.dispose();
});

test('missing fixture art creates no mesh fallback and late preload respects disposal', async () => {
  let finish; globalThis.__architecturePreload = new Promise(resolve => finish = resolve);
  const camera = new THREE.PerspectiveCamera(), L = generateAdventure(new Rng(1), stage('desert'));
  const view = new SceneArchitecture({ camera, settings: { quality: 'high' } }, L);
  assert.equal(view.group.children.length, 0); view.dispose();
  finish(); await globalThis.__architecturePreload; await Promise.resolve();
  assert.equal(view.group.children.length, 0);
  delete globalThis.__architecturePreload;
});
