import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [name, value] of Object.entries(imports)) source = source.replaceAll(`'${name}'`, `'${value}'`);
  return moduleUrl(source.replaceAll("'three'", `'${threeUrl}'`));
}
const libraryUrl = moduleUrl(`export const AssetLibrary = {
  get: id => globalThis.__authoredViewAssets?.get(id) ?? null,
  preload: () => globalThis.__authoredViewPreload ?? Promise.resolve()
};`);
const texturesUrl = moduleUrl(`import * as THREE from '${threeUrl}';
export function preloadSceneSurface() { return globalThis.__authoredSurfacePreload ?? Promise.resolve(true); }
export function makeFloorTextures() {
  const maps = {map:new THREE.Texture(), bump:new THREE.Texture(), roughness:new THREE.Texture(),
    emissive:null, tile:8, authored:!globalThis.__authoredSurfacePending};
  globalThis.__authoredOwnedMaps?.push(maps); return maps;
}`);
const architectureUrl = await tsModule('../src/world/SceneArchitecture.ts', {
  '../assets/AssetLibrary': libraryUrl,
  '../assets/ArtEnvironment': moduleUrl('export function applyArtEnvironment() {}'),
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
});
const occlusionUrl = await tsModule('../src/world/AuthoredArtOcclusion.ts', {
  '../assets/AssetLibrary': libraryUrl, './SceneArchitecture': architectureUrl,
});
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { AuthoredSceneView, bakeAuthoredGroundField } = await import(await tsModule('../src/world/AuthoredSceneView.ts', {
  '../core/Rng': await tsModule('../src/core/Rng.ts'),
  '../assets/AssetLibrary': libraryUrl,
  './AuthoredSceneLayout': await tsModule('../src/world/AuthoredSceneLayout.ts'),
  './SceneArchitecture': architectureUrl,
  './AuthoredArtOcclusion': occlusionUrl,
  './SceneBackdrop': await tsModule('../src/world/SceneBackdrop.ts', { '../assets/AssetLibrary': libraryUrl }),
  './Sky': await tsModule('../src/world/Sky.ts', { './Batch': moduleUrl('export const Tpl = {};') }),
  './Themes': await tsModule('../src/world/Themes.ts'),
  './Textures': texturesUrl,
  './ShadowCadence': await tsModule('../src/world/ShadowCadence.ts'),
  './AdventureRoadMask': await tsModule('../src/world/AdventureRoadMask.ts'),
}));
const { generateWhitebox, whiteboxPoint } = await import(await tsModule('../src/world/WhiteboxGen.ts', {
  './WhiteboxPlans': await tsModule('../src/world/WhiteboxPlans.ts'),
}));
const { THEMES } = await import(await tsModule('../src/world/Themes.ts'));
function makeLayout(theme = 'desert', index = 0) {
  const layout = generateWhitebox({ theme, index, type: index === 4 ? 'boss' : 'combat', chapter: 0, reward: 'coins' });
  layout.adventure = { paths: layout.whitebox.plan.passages.map(path => ({
    width: path.width, points: path.points.map(p => whiteboxPoint(layout.whitebox.plan, p)),
  })) };
  return layout;
}
function context(quality = 'high') {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.62, 25); camera.updateMatrixWorld(true);
  scene.background = new THREE.Color(0x123456); scene.fog = new THREE.Fog(0x223344, 4, 20);
  return { scene, camera, settings: { quality }, renderer: { domElement: { height: 720 } }, world: new CollisionWorld() };
}
function wallAsset(id = 'SM_Env_DesertWall') {
  const material = new THREE.MeshStandardMaterial({ roughness: .5 });
  const lods = [0, 1, 2].map(() => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 1.4), material);
    mesh.position.y = 2.1; mesh.updateMatrixWorld(true); return mesh;
  });
  return { id, lods, entry: { bounds: { min: [-3.5, 0, -.7], max: [3.5, 4.2, .7] } } };
}

test('art view preserves every reviewed collision volume while borrowing meshes and owning only its render resources', () => {
  const asset = wallAsset(); globalThis.__authoredViewAssets = new Map([[asset.id, asset]]);
  globalThis.__authoredOwnedMaps = [];
  let borrowedDisposed = 0;
  asset.lods.forEach(m => m.geometry.addEventListener('dispose', () => borrowedDisposed++));
  asset.lods[0].material.addEventListener('dispose', () => borrowedDisposed++);
  const layout = makeLayout('desert', 1), before = JSON.stringify(layout), ctx = context();
  const background = ctx.scene.background, fog = ctx.scene.fog;
  const view = new AuthoredSceneView(ctx, layout, THEMES.desert, () => .5);
  ctx.scene.add(view.group); view.update(1 / 60, 2);
  assert.equal(JSON.stringify(layout), before, 'art cannot mutate approved passages or collision');
  assert.ok(view.group.getObjectByName('authored.paving.exact-floor-plan'));
  assert.ok(view.group.getObjectByName('authored.boundary.technical-closure'));
  const materials = new Set(); let count = 0;
  view.group.traverse(object => {
    if (object.isInstancedMesh) { count += object.count; materials.add(object.material); }
  });
  assert.ok(count > 0, 'published fixture asset should be instantiated');
  assert.ok([...materials].every(m => m !== asset.lods[0].material), 'scene cannot tint shared library materials');
  let releasedMaps = 0;
  for (const maps of globalThis.__authoredOwnedMaps) for (const key of ['map', 'bump', 'roughness']) maps[key].addEventListener('dispose', () => releasedMaps++);
  view.dispose(); view.dispose();
  assert.equal(view.group.children.length, 0); assert.equal(view.group.parent, null);
  assert.equal(ctx.scene.background, background); assert.equal(ctx.scene.fog, fog);
  assert.equal(borrowedDisposed, 0); assert.equal(releasedMaps, 3);
  asset.lods.forEach(m => m.geometry.dispose()); asset.lods[0].material.dispose();
  delete globalThis.__authoredViewAssets; delete globalThis.__authoredOwnedMaps;
});

test('desert, frost and inferno construct finite render surfaces with world-centred route masks', () => {
  for (const theme of ['desert', 'frost', 'inferno']) {
    const layout = makeLayout(theme), ctx = context('low');
    const view = new AuthoredSceneView(ctx, layout, THEMES[theme], () => .5);
    const floor = view.group.getObjectByName('authored.paving.exact-floor-plan');
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <map_fragment>\n#include <normal_fragment_maps>' };
    floor.material.onBeforeCompile(shader, {});
    const image = shader.uniforms.authoredRoad.value.image, extent = shader.uniforms.authoredExtent.value;
    assert.ok(image.data.some(value => value > 0));
    const p = layout.adventure.paths[0].points[0];
    const x = Math.min(image.width - 1, Math.max(0, Math.floor((p.x / (2 * extent) + .5) * image.width)));
    const z = Math.min(image.height - 1, Math.max(0, Math.floor((p.z / (2 * extent) + .5) * image.height)));
    assert.ok(image.data[(z * image.width + x) * 4] > 210, `${theme}: road mask shifted toward the objective`);
    view.group.traverse(object => {
      if (object.isMesh) {
        const positions = object.geometry.getAttribute('position');
        for (let i = 0; i < positions.array.length; i++) assert.ok(Number.isFinite(positions.array[i]));
      }
    });
    view.update(1 / 30, 5); view.dispose();
  }
});

test('late asset and surface loads cannot resurrect a disposed stage or allocate replacement maps', async () => {
  let finishAssets, finishSurface;
  globalThis.__authoredViewPreload = new Promise(resolve => finishAssets = resolve);
  globalThis.__authoredSurfacePreload = new Promise(resolve => finishSurface = resolve);
  globalThis.__authoredSurfacePending = true; globalThis.__authoredOwnedMaps = [];
  const layout = makeLayout(), ctx = context(), view = new AuthoredSceneView(ctx, layout, THEMES.desert, () => .5);
  view.dispose(); const mapCount = globalThis.__authoredOwnedMaps.length;
  finishAssets(); finishSurface(true); await globalThis.__authoredViewPreload; await globalThis.__authoredSurfacePreload; await Promise.resolve();
  assert.equal(view.group.children.length, 0); assert.equal(globalThis.__authoredOwnedMaps.length, mapCount);
  delete globalThis.__authoredViewPreload; delete globalThis.__authoredSurfacePreload;
  delete globalThis.__authoredSurfacePending; delete globalThis.__authoredOwnedMaps;
});

test('published deck instances place the measured walking surface above the original floor without raising collision', () => {
  const id = 'SM_Env_TravelDeck', height = .734755, original = new THREE.MeshStandardMaterial();
  const lods = [0, 1, 2].map(() => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5.516021, height, 3.881925), original);
    mesh.position.y = height / 2; mesh.updateMatrixWorld(true); return mesh;
  });
  globalThis.__authoredViewAssets = new Map([[id, { id, lods }]]);
  const layout = makeLayout('frost', 2), before = JSON.stringify(layout), ctx = context();
  const view = new AuthoredSceneView(ctx, layout, THEMES.frost, () => .5);
  view.group.updateMatrixWorld(true);
  let measured = 0;
  view.group.traverse(object => {
    if (!object.isInstancedMesh || !object.name.startsWith(id)) return;
    for (let i = 0; i < object.count; i++) {
      const matrix = new THREE.Matrix4(); object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld);
      const surface = new THREE.Vector3(0, .610 - height / 2, 0).applyMatrix4(matrix);
      assert.ok(Math.abs(surface.y - .01) < .0001, 'top surface disappeared below the unmodified ground');
      measured++;
    }
  });
  assert.ok(measured > 0); assert.equal(JSON.stringify(layout), before);
  view.dispose(); delete globalThis.__authoredViewAssets;
  lods.forEach(m => m.geometry.dispose()); original.dispose();
});

test('only the two bridge maps tint their lower substrate; the playable surface and collision stay untouched', () => {
  for (const theme of ['desert', 'frost', 'inferno']) for (let index = 0; index < 5; index++) {
    const layout = makeLayout(theme, index), before = JSON.stringify(layout);
    const view = new AuthoredSceneView(context('low'), layout, THEMES[theme], () => .5);
    const floor = view.group.getObjectByName('authored.paving.exact-floor-plan');
    const substrate = view.group.getObjectByName('authored.horizon.substrate');
    assert.equal(floor.material.customProgramCacheKey(), 'authored-painted-ground-v2');
    const vertices = substrate.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) assert.ok(Math.abs(vertices.getY(i) + .03) < 1e-7);
    if (index === 2 && theme !== 'desert') {
      assert.notEqual(substrate.material, floor.material);
      assert.equal(substrate.material.map, floor.material.map, 'geography must reuse the authored texture');
      assert.equal(substrate.material.bumpMap, null);
      const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>',
        fragmentShader: '#include <map_fragment>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>' };
      substrate.material.onBeforeCompile(shader, {});
      if (theme === 'inferno') {
        const { left, right, north, south } = substrate.material.userData.substrate.channel;
        const plan = layout.whitebox.plan, centre = whiteboxPoint(plan, plan.notes.find(note => note.text.includes('输渣隔离带')).at);
        assert.ok(centre.x > left && centre.x < right && centre.z > north && centre.z < south);
        const receiver = whiteboxPoint(plan, plan.rooms.find(room => room.id === 'receiver').labelAt);
        assert.ok(layout.playerSpawn.x < left && receiver.x > right, 'molten colour belongs between the two banks');
        assert.deepEqual(shader.uniforms.substrateChannel.value.toArray(), [left, right, north, south]);
        assert.ok(substrate.material.emissiveIntensity <= .5);
      } else {
        assert.equal(substrate.material.userData.substrate.kind, 'ice');
        assert.equal(substrate.material.emissiveIntensity, 0);
      }
    } else assert.equal(substrate.material, floor.material, `${theme}/${index}: unrelated map received a geography change`);
    assert.equal(JSON.stringify(layout), before); view.dispose();
  }
});

const fieldAt = (field, plan, [x, z], channel) => {
  const point = whiteboxPoint(plan, [x, z]);
  const ix = Math.max(0, Math.min(field.resolution - 1, Math.floor((point.x / (field.extent * 2) + .5) * field.resolution)));
  const iz = Math.max(0, Math.min(field.resolution - 1, Math.floor((point.z / (field.extent * 2) + .5) * field.resolution)));
  return field.data[(iz * field.resolution + ix) * 4 + channel];
};

test('one deterministic packed field distinguishes working floors, natural ground, wind deposits and separated slag pools', () => {
  for (const theme of ['desert', 'frost', 'inferno']) {
    const layout = makeLayout(theme, theme === 'desert' ? 0 : 2), before = JSON.stringify(layout);
    const view = new AuthoredSceneView(context('low'), layout, THEMES[theme], () => .5);
    const field = bakeAuthoredGroundField(layout, view.art.boundaries), plan = layout.whitebox.plan;
    assert.equal(field.data.length, field.resolution * field.resolution * 4);
    assert.ok(field.data.byteLength <= 1024 * 1024, 'stage colour fields must remain under 1 MiB');
    assert.deepEqual(field.data, bakeAuthoredGroundField(layout, view.art.boundaries).data);
    if (theme === 'desert') {
      assert.equal(fieldAt(field, plan, plan.rooms.find(r => r.id === 'entry').labelAt, 1), 0, 'canyon entry should retain natural sand');
      assert.ok(fieldAt(field, plan, plan.rooms.find(r => r.id === 'exit').labelAt, 1) > 120, 'gate approach should show a working stone floor');
    } else if (theme === 'frost') {
      assert.ok(fieldAt(field, plan, [27, 21], 1) > 150, 'winch yard centre should expose its paving');
      assert.ok(fieldAt(field, plan, [15.5, 21], 2) > fieldAt(field, plan, [27, 21], 2) + 60, 'snow should accumulate at the bank, not cover its entire working yard');
    } else {
      assert.ok(fieldAt(field, plan, [58, 20], 3) > 110, 'a warm pool should remain visible inside the isolation strip');
      assert.ok(fieldAt(field, plan, [58, 38], 3) < 10, 'dark crust must separate the pools');
      assert.equal(fieldAt(field, plan, [10, 120], 3), 0, 'heat must not turn the entire map perimeter into lava');
    }
    assert.equal(JSON.stringify(layout), before); view.dispose();
  }
});

test('one resident warm light uses a real furnace alcove and never adds shadow passes', () => {
  for (let index = 0; index < 5; index++) for (const quality of ['high', 'medium', 'low']) {
    const layout = makeLayout('inferno', index), view = new AuthoredSceneView(context(quality), layout, THEMES.inferno, () => .5);
    const lights = view.group.children.filter(object => object.isPointLight);
    assert.equal(lights.length, quality === 'low' ? 0 : 1);
    for (const light of lights) {
      const source = view.art.placements.find(p => p.assetId === 'SM_Prop_InfernoCrucible'
        && Math.hypot(p.x - light.position.x, p.z - light.position.z) < .01);
      assert.ok(source && (source.story.beat === 'entry' || source.story.beat === 'junction'));
      assert.ok(light.position.y > source.y && light.position.y < source.y + source.envelope.height * source.s);
      assert.equal(light.castShadow, false); assert.ok(light.distance <= 9);
    }
    view.dispose();
  }
});

test('the same warm light serves both nearby alcoves with hysteresis and no light-count changes', () => {
  for (let index = 0; index < 5; index++) {
    const layout = makeLayout('inferno', index), ctx = context('high');
    const view = new AuthoredSceneView(ctx, layout, THEMES.inferno, () => .5);
    try {
      const light = view.group.children.find(object => object.isPointLight);
      const fixtures = view.art.placements.filter(p => p.assetId === 'SM_Prop_InfernoCrucible'
        && p.story && (p.story.beat === 'entry' || p.story.beat === 'junction')).slice(0, 2);
      const positions = fixtures.map(p => new THREE.Vector3(p.x, p.y + p.envelope.height * p.s * .82, p.z));
      const midpoint = positions[0].clone().add(positions[1]).multiplyScalar(.5);
      const direction = positions[1].clone().sub(positions[0]).normalize();
      function move(position, expected) {
        ctx.camera.position.copy(position); ctx.camera.position.y = layout.floorY + 1.62;
        view.update(1 / 60, 1);
        assert.deepEqual(view.group.children.filter(object => object.isPointLight), [light], 'reuse the same light and shader light count');
        assert.ok(light.position.distanceTo(positions[expected]) < 1e-8);
        assert.equal(light.userData.fixtureId, fixtures[expected].story.id);
        assert.equal(light.visible, true); assert.equal(light.castShadow, false);
      }
      move(positions[0], 0);
      move(midpoint.clone().addScaledVector(direction, 1), 0);
      move(midpoint.clone().addScaledVector(direction, 4), 1);
      move(positions[1], 1);
      move(midpoint.clone().addScaledVector(direction, -1), 1);
      move(midpoint.clone().addScaledVector(direction, -4), 0);
      move(positions[0], 0);
    } finally { view.dispose(); }
  }
});

test('technical closure skins keep the authored eye-height views to each story object open', () => {
  for (const theme of ['desert', 'frost', 'inferno']) for (let index = 0; index < 5; index++) {
    const layout = makeLayout(theme, index), view = new AuthoredSceneView(context('low'), layout, THEMES[theme], () => .5);
    view.group.updateMatrixWorld(true);
    const closure = view.group.getObjectByName('authored.boundary.technical-closure');
    for (const p of view.art.placements.filter(p => p.story)) {
      const origin = new THREE.Vector3(p.story.observer.x, layout.floorY + 1.62, p.story.observer.z);
      const target = new THREE.Vector3(p.x, p.y + p.story.focusHeight, p.z), distance = target.distanceTo(origin);
      const ray = new THREE.Raycaster(origin, target.sub(origin).normalize(), .02, distance - .02);
      assert.equal(ray.intersectObject(closure).length, 0, `${theme}/${index}/${p.story.id}: backing hid the approved art view`);
    }
    view.dispose();
  }
});

async function publishedSceneAsset(id) {
  const { loadPublishedMesh } = await import('../art/tools/pose_geometry_audit.mjs');
  const first = loadPublishedMesh(id, 0);
  const bytes = await readFile(new URL(`../public/${first.entry.url}`, import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  function nodeMatrix(index) {
    const node = gltf.nodes[index], matrix = new THREE.Matrix4();
    if (node.matrix) matrix.fromArray(node.matrix);
    else matrix.compose(new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = gltf.nodes.findIndex(n => n.children?.includes(index));
    return parent < 0 ? matrix : nodeMatrix(parent).multiply(matrix);
  }
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const nodes = gltf.nodes.map((node, index) => ({ ...node, index })).filter(node => /_LOD\d+$/.test(node.name)).sort((a, b) => a.name.localeCompare(b.name));
  const sources = nodes.map(node => {
    const data = loadPublishedMesh(id, node.mesh);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.idx, 1));
    const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(nodeMatrix(node.index)); mesh.updateMatrixWorld(true);
    return mesh;
  });
  return { id, entry: first.entry, lods: sources, material };
}

test('published desert walls conceal support skins from the gate and cargo inspection views at every LOD', async () => {
  const { architectureAssetBounds, architectureMatrix } = await import(architectureUrl);
  const asset = await publishedSceneAsset('SM_Env_DesertWall');
  const { id, lods: sources, material } = asset;
  const bounds = architectureAssetBounds(sources), ray = new THREE.Raycaster();
  let checked = 0;
  try {
    for (const [index, inspectionId] of [[1, 'art-story-junction'], [3, 'art-focal-1']]) {
      const layout = makeLayout('desert', index), view = new AuthoredSceneView(context('low'), layout, THEMES.desert, () => .5);
      try {
        view.group.updateMatrixWorld(true);
        const closure = view.group.getObjectByName('authored.boundary.technical-closure');
        const inspection = view.art.inspectionViews.find(p => p.id === inspectionId);
        const camera = new THREE.PerspectiveCamera(80, 1280 / 720, .1, 1000);
        camera.position.set(inspection.x, layout.floorY + 1.62, inspection.z);
        camera.rotation.order = 'YXZ'; camera.rotation.set(inspection.pitch, inspection.yaw, 0); camera.updateMatrixWorld(true);
        const pixels = [[1050, 365], [1072, 430], [1080, 500]];
        for (let y = 30; y < 690; y += 30) for (let x = 20; x < 1280; x += 30) pixels.push([x, y]);
        for (const source of sources) {
          const walls = view.art.placements.filter(p => p.assetId === id).map(p => {
            const mesh = new THREE.Mesh(source.geometry, material); mesh.matrixAutoUpdate = false;
            mesh.matrix.copy(architectureMatrix(source, p, bounds)); mesh.updateMatrixWorld(true); return mesh;
          });
          for (const [x, y] of pixels) {
            ray.setFromCamera(new THREE.Vector2(x / 1280 * 2 - 1, 1 - y / 720 * 2), camera);
            const support = ray.intersectObject(closure, false)[0];
            if (!support || support.point.y < layout.floorY + .1) continue;
            const wall = ray.intersectObjects(walls, false)[0]; checked++;
            assert.ok(wall && wall.distance < support.distance,
              `${view.art.planId}/${inspectionId}: support is exposed at pixel ${x},${y}`);
          }
        }
      } finally { view.dispose(); }
    }
    assert.ok(checked > 200, 'the regression must exercise both support-facing views');
  } finally { for (const source of sources) source.geometry.dispose(); material.dispose(); }
});

test('all fifteen authored backdrop rings use map bounds, stay outside reviewed floors and keep the same thirty last-LOD pieces', async () => {
  const assets = await Promise.all(['Desert', 'Frost', 'Inferno'].map(theme => publishedSceneAsset(`SM_Env_${theme}Cliff`)));
  globalThis.__authoredViewAssets = new Map(assets.map(asset => [asset.id, asset]));
  let borrowedDisposed = 0;
  for (const asset of assets) for (const source of asset.lods) source.geometry.addEventListener('dispose', () => borrowedDisposed++);
  try {
    for (const [chapter, theme] of ['desert', 'frost', 'inferno'].entries()) for (let index = 0; index < 5; index++) {
      const layout = makeLayout(theme, index), before = JSON.stringify(layout);
      const relocated = structuredClone(layout);
      relocated.center = { x: layout.minX + 2, z: layout.minZ + 3 };
      const movedBefore = JSON.stringify(relocated), views = [];
      try {
        const matrices = [];
        for (const level of [layout, relocated]) {
          const view = new AuthoredSceneView(context('low'), level, THEMES[theme], () => .5); views.push(view);
          const backdrop = view.group.getObjectByName(`scene.backdrop.${theme}`);
          assert.equal(backdrop.children.length, 1, `${level.whitebox.planId}: background must remain one instanced draw`);
          const mesh = backdrop.children[0];
          assert.equal(mesh.count, 30); assert.equal(mesh.geometry, assets[chapter].lods.at(-1).geometry);
          assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
          matrices.push(Array.from(mesh.instanceMatrix.array));
          mesh.geometry.computeBoundingBox();
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
            assert.ok(level.whitebox.floorRects.every(rect => bounds.max.x < rect.minX || bounds.min.x > rect.maxX
              || bounds.max.z < rect.minZ || bounds.min.z > rect.maxZ), `${level.whitebox.planId}: distant cliff ${i} intrudes on a reviewed floor`);
          }
        }
        assert.deepEqual(matrices[0], matrices[1], `${layout.whitebox.planId}: moving the encounter must not move the scenery ring`);
        assert.equal(JSON.stringify(layout), before); assert.equal(JSON.stringify(relocated), movedBefore);
      } finally { for (const view of views) view.dispose(); }
    }
    assert.equal(borrowedDisposed, 0, 'background disposal must not release published geometry');
  } finally {
    delete globalThis.__authoredViewAssets;
    for (const asset of assets) { for (const source of asset.lods) source.geometry.dispose(); asset.material.dispose(); }
  }
});

test('the real skiff aperture becomes visible and ray-active together, then restores ordinary collision on view disposal', async () => {
  let release;
  globalThis.__authoredViewPreload = new Promise(resolve => { release = resolve; });
  globalThis.__authoredViewAssets = new Map();
  const layout = makeLayout('frost', 2), ctx = context('low');
  for (const b of layout.boxes) ctx.world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const view = new AuthoredSceneView(ctx, layout, THEMES.frost, () => .5), assets = [];
  try {
    assert.equal(view.art.rayWindows.length, 1);
    const spec = view.art.rayWindows[0], pending = view.group.getObjectByName(`authored.ray-window.pending.${spec.id}`);
    assert.ok(pending.visible); assert.equal(ctx.world.activeRayWindowCount, 0);
    const b = spec.bounds, origin = new THREE.Vector3(b.maxX + 1, 4, (b.minZ + b.maxZ) / 2), direction = new THREE.Vector3(-1, 0, 0);
    assert.ok(ctx.world.raycast(origin, direction, 20).distance < 1.01, 'unloaded art keeps the original visible solid barrier');
    assets.push(...await Promise.all([...new Set([...view.art.placements, ...view.art.decks].map(p => p.assetId))].map(publishedSceneAsset)));
    for (const asset of assets) globalThis.__authoredViewAssets.set(asset.id, asset);
    release(); await Promise.resolve(); await Promise.resolve();
    assert.equal(ctx.world.activeRayWindowCount, 1); assert.equal(pending.visible, false);
    const hit = ctx.world.raycast(origin, direction, 20);
    assert.ok(hit.distance > 1.2 && hit.box.tag.startsWith('authored-art:'));
    // No remaining technical skin may close the mesh-only aperture behind its hull.
    view.group.updateMatrixWorld(true);
    const closure = view.group.getObjectByName('authored.boundary.technical-closure');
    const ray = new THREE.Raycaster(origin, direction, 0, origin.x - b.minX);
    assert.equal(ray.intersectObject(closure, false).length, 0);
    view.dispose(); assert.equal(ctx.world.activeRayWindowCount, 0);
    assert.ok(ctx.world.raycast(origin, direction, 20).distance < 1.01, 'technical-whitebox view uses ordinary boxes again');
  } finally {
    view.dispose(); release(); delete globalThis.__authoredViewPreload; delete globalThis.__authoredViewAssets;
    for (const asset of assets) { for (const source of asset.lods) source.geometry.dispose(); asset.material.dispose(); }
  }
});
