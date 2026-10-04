import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// Published-asset checks intentionally require all three manifest entries. Before
// publication, run only: node --test --test-name-pattern="bounds-only|fixture|fallback" tests/nature-scene.test.mjs
// Fresh clones use tracked metadata, small generation graphs and runtime GLBs.
// ART_LOCAL_SOURCE_AUDIT=1 additionally verifies ignored highpolys and input PNGs.
const localSourceAudit = process.env.ART_LOCAL_SOURCE_AUDIT === '1';
const ids = ['SM_Env_DesertSandstone', 'SM_Env_FrostPine', 'SM_Env_InfernoBasalt'];
const bindings = ['desert.rock', 'frost.pine', 'inferno.rock'];
const landmarkIds = ['SM_Env_DesertRuin', 'SM_Env_FrostWayshrine', 'SM_Env_InfernoFoundry'];
const environmentIds = [...ids, ...landmarkIds];
const environmentBindings = [...bindings, 'desert.landmark', 'frost.landmark', 'inferno.landmark'];
const triangleBudget = [5000, 1600, 500];
const lodDistances = [0, 18, 42];
const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')).assets;
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const sourceFile = (id, relative) => new URL(`../art/source/props/${id}/${relative}`, import.meta.url);
const stageVersion = (state, name, version) => {
  const stage = state.stages[name];
  const record = stage?.versions.find(v => v.version === (version ?? stage.current));
  assert.ok(record, `${state.id}: missing ${name} provenance`);
  return record;
};
function highpolyFile(record, name) {
  const file = record.files[name];
  assert.ok(file, `missing registered Hunyuan source: ${name}`);
  assert.equal(file.path, `02_highpoly/${name}`, `${name}: unexpected source path`);
  assert.match(file.sha256, /^[0-9a-f]{64}$/, `${name}: missing SHA-256 provenance`);
  return file;
}
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return dataModule(source);
}
const fitUrl = await tsModule('../src/world/ScenePropFit.ts');
const { fitNaturalPropScale } = await import(fitUrl);
const libraryUrl = dataModule('export const AssetLibrary = { get: id => globalThis.__natureSceneTestAssets?.get(id) ?? null, preload: () => globalThis.__natureScenePreload ?? Promise.resolve() };');
const { SceneBackdrop } = await import(await tsModule('../src/world/SceneBackdrop.ts', { '../assets/AssetLibrary': libraryUrl }));
const { SceneDressing } = await import(await tsModule('../src/world/SceneDressing.ts', {
  '../assets/AssetLibrary': libraryUrl,
  '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment() {}'),
  './LevelGen': dataModule('export const PROP_COLLIDER = { pine: [1.7, 4.6] };'),
  './ScenePropFit': fitUrl,
  './SceneSurfaceMaterial': await tsModule('../src/world/SceneSurfaceMaterial.ts'),
}));

function glbDocument(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(bytes.subarray(20, 20 + length));
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  return { document, bin: bytes.subarray(28 + length) };
}

function nodeMatrix(document, index) {
  const node = document.nodes[index];
  const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
  const parent = document.nodes.findIndex(n => n.children?.includes(index));
  return parent < 0 ? local : nodeMatrix(document, parent).multiply(local);
}

function imageDimensions(document, bin, index) {
  const image = document.images[index], view = document.bufferViews[image.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  if (image.mimeType === 'image/png') {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  assert.equal(image.mimeType, 'image/webp');
  return webpDimensions(bytes);
}

// https://developers.google.com/speed/webp/docs/riff_container
function webpDimensions(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const end = bytes.readUInt32LE(4) + 8;
  assert.ok(end <= bytes.length, 'truncated WebP container');
  for (let offset = 12; offset + 8 <= end;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    assert.ok(payload + length <= end, 'truncated WebP chunk');
    if (kind === 'VP8X') {
      assert.ok(length >= 10);
      return { width: 1 + bytes.readUIntLE(payload + 4, 3), height: 1 + bytes.readUIntLE(payload + 7, 3) };
    }
    if (kind === 'VP8L') {
      assert.ok(length >= 5); assert.equal(bytes[payload], 0x2f);
      const dimensions = bytes.readUInt32LE(payload + 1);
      return { width: 1 + (dimensions & 0x3fff), height: 1 + ((dimensions >>> 14) & 0x3fff) };
    }
    if (kind === 'VP8 ') {
      assert.ok(length >= 10);
      assert.equal(bytes.subarray(payload + 3, payload + 6).toString('hex'), '9d012a');
      return { width: bytes.readUInt16LE(payload + 6) & 0x3fff, height: bytes.readUInt16LE(payload + 8) & 0x3fff };
    }
    offset = payload + length + (length % 2);
  }
  assert.fail('WebP has no supported dimension header');
}

function textureImage(document, index) {
  const texture = document.textures[index];
  const image = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
  assert.ok(Number.isInteger(image) && image >= 0 && image < document.images.length, 'texture image source missing');
  return image;
}

const actualAssets = new Map();
async function publishedAssets(selected = ids) {
  for (const id of selected) assert.ok(manifest[id], `${id}: publish the generated asset before running this check`);
  const missing = selected.filter(id => !actualAssets.has(id));
  if (!missing.length) return actualAssets;
  const { loadPublishedMesh } = await import('../art/tools/pose_geometry_audit.mjs');
  for (const id of missing) {
    const bytes = await readFile(new URL(`../public/${manifest[id].url}`, import.meta.url));
    const { document, bin } = glbDocument(bytes);
    const maps = document.images.map((_, i) => new THREE.Texture(imageDimensions(document, bin, i)));
    const materials = document.materials.map(m => new THREE.MeshStandardMaterial({
      map: maps[textureImage(document, m.pbrMetallicRoughness.baseColorTexture.index)],
      normalMap: maps[textureImage(document, m.normalTexture.index)],
      roughnessMap: maps[textureImage(document, m.pbrMetallicRoughness.metallicRoughnessTexture.index)],
    }));
    const lods = [0, 1, 2].map(lod => {
      const node = document.nodes.findIndex(n => n.name === `${id}_LOD${lod}`);
      assert.ok(node >= 0, `${id}: missing LOD${lod} node`);
      const meshIndex = document.nodes[node].mesh;
      const decoded = loadPublishedMesh(id, meshIndex);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
      if (decoded.attrs.NORMAL) geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.attrs.NORMAL, 3));
      if (decoded.attrs.TEXCOORD_0) geometry.setAttribute('uv', new THREE.BufferAttribute(decoded.attrs.TEXCOORD_0, 2));
      geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1));
      const mesh = new THREE.Mesh(geometry, materials[document.meshes[meshIndex].primitives[0].material]);
      mesh.name = `${id}_LOD${lod}`;
      mesh.applyMatrix4(nodeMatrix(document, node)); mesh.updateMatrixWorld(true);
      return mesh;
    });
    actualAssets.set(id, { id, entry: manifest[id], lods, bytes, document, bin, maps, materials });
  }
  return actualAssets;
}

function measuredVertices(asset) {
  const vertices = [], point = new THREE.Vector3();
  for (const mesh of asset.lods) {
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) vertices.push(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).clone());
  }
  return vertices;
}

function listenForDisposal(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

function layout(theme, decos = []) {
  return { theme, half: 28, floorY: 2, center: { x: 7, z: -11 }, decos, boxes: [] };
}

function withLibrary(assets, callback) {
  const previous = globalThis.__natureSceneTestAssets;
  globalThis.__natureSceneTestAssets = assets;
  try { return callback(); } finally { globalThis.__natureSceneTestAssets = previous; }
}

function withCanvas(callback) {
  const previous = globalThis.document;
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, scale() {},
    }) };
  } };
  try { return callback(); } finally { globalThis.document = previous; }
}

test('bounds-only references contain dimensions and never create a procedural blockout mesh', async () => {
  for (const id of environmentIds) {
    const state = await json(sourceFile(id, 'asset.json'));
    const record = stageVersion(state, 'blockout', manifest[id]?.version.blockout);
    assert.equal(record.reference_mode, 'bounds_only');
    assert.equal(record.geometry_created, false);
    assert.ok(Object.keys(record.files).every(name => !/\.(glb|gltf|blend|obj|ply|fbx|stl)$/i.test(name)));
    const meta = await json(sourceFile(id, record.files[`BO_${id}_v${String(record.version).padStart(3, '0')}.json`].path));
    assert.equal(meta.reference_mode, 'bounds_only');
    assert.deepEqual(meta.joints, []);
    assert.equal(meta.bounds.min[1], 0);
    assert.ok(meta.bounds.max.every((v, axis) => Number.isFinite(v) && v > meta.bounds.min[axis]));
    assert.ok((await readdir(sourceFile(id, '00_blockout/'))).every(name => !/\.(glb|gltf|blend|obj|ply|fbx|stl)$/i.test(name)), `${id}: unexpected artistic blockout`);
  }
});

test('published nature and landmark assets meet three-LOD, 1024 PBR, file budget and local Hunyuan provenance', async () => {
  const assets = await publishedAssets(environmentIds);
  let totalBytes = 0;
  for (const [i, id] of environmentIds.entries()) {
    const asset = assets.get(id), { entry, document, bytes, bin } = asset;
    assert.equal(entry.kind, 'static'); assert.equal(entry.class, 'nature_prop');
    assert.deepEqual(entry.bind, { source: 'scene', id: environmentBindings[i] });
    assert.deepEqual(entry.lodDistance, lodDistances);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.ok(bytes.length <= 900 * 1024, `${id}: exceeds 900KiB`); totalBytes += bytes.length;
    assert.equal(asset.lods.length, 3); assert.equal(document.meshes.length, 3);
    assert.equal(document.skins?.length ?? 0, 0);
    const triangles = asset.lods.map(m => m.geometry.index.count / 3);
    for (const [lod, count] of triangles.entries()) assert.ok(count > 0 && count <= triangleBudget[lod], `${id}/LOD${lod}: ${count} triangles`);
    assert.ok(triangles[0] > triangles[1] && triangles[1] > triangles[2], `${id}: collapsed LOD chain`);
    for (const m of document.materials) {
      assert.equal(m.alphaMode ?? 'OPAQUE', 'OPAQUE', `${id}: foliage must use solid geometry`);
      const pbr = m.pbrMetallicRoughness;
      assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && m.normalTexture && m.occlusionTexture, `${id}: missing PBR channel`);
      assert.equal(pbr.metallicRoughnessTexture.index, m.occlusionTexture.index, `${id}: ORM packing changed`);
    }
    assert.equal(document.images.length, 3);
    document.images.forEach((_, index) => assert.deepEqual(imageDimensions(document, bin, index), { width: 1024, height: 1024 }));
    const state = await json(sourceFile(id, 'asset.json'));
    const build = stageVersion(state, 'build', entry.version.build);
    assert.equal(build.from.highpoly, entry.version.highpoly);
    assert.equal(build.from.blockout, entry.version.blockout);
    assert.equal(build.from.concept, entry.version.concept);
    const hp = stageVersion(state, 'highpoly', entry.version.highpoly);
    assert.notEqual(hp.quality_status, 'failed', `${id}: interrupted inference became a published mesh`);
    for (const failed of state.stages.highpoly.versions.filter(version => version.quality_status === 'failed')) {
      assert.notEqual(failed.version, hp.version);
      for (const file of Object.values(failed.files).filter(file => /_(graph|failure)\.json$/.test(file.path))) {
        assert.equal(createHash('sha256').update(await readFile(sourceFile(id, file.path))).digest('hex'), file.sha256,
          `${id}: failed inference evidence changed`);
      }
    }
    assert.equal(hp.from_concept, entry.version.concept);
    assert.match(hp.tool, /Hunyuan3D/); assert.match(hp.checkpoint, /hunyuan[_-]?3d/i);
    assert.deepEqual(entry.generator, { tool: hp.tool, mode: hp.mode, checkpoint: hp.checkpoint });
    assert.equal(entry.license, hp.license, `${id}: published license differs from the actual generator`);
    assert.notEqual(build.quality_status, 'failed', `${id}: rejected build became a runtime asset`);
    assert.ok(hp.comfyui && /cuda.*NVIDIA/i.test(hp.gpu), `${id}: local ComfyUI/GPU provenance missing`);
    const stem = `HP_${id}_v${String(hp.version).padStart(3, '0')}`;
    const graphFile = highpolyFile(hp, `${stem}_graph.json`);
    const graphBytes = await readFile(sourceFile(id, graphFile.path));
    assert.equal(createHash('sha256').update(graphBytes).digest('hex'), graphFile.sha256);
    const graph = JSON.parse(graphBytes);
    assert.ok(Object.values(graph).some(n => /Hunyuan3D/i.test(n.class_type)), `${id}: missing Hunyuan generation graph`);
    assert.ok(Object.values(graph).some(n => n.inputs?.ckpt_name === hp.checkpoint));
    const inputNames = hp.mode === 'multiview'
      ? ['front', 'left', 'back', 'right'].map(view => `${stem}_input_${view}.png`)
      : [`${stem}_input.png`];
    const inputFiles = inputNames.map(name => highpolyFile(hp, name));
    if (id === ids[1]) {
      assert.ok(hp.version > 1, 'the rejected single-view pine was published again');
      assert.equal(hp.mode, 'multiview');
    }
    if (hp.mode === 'multiview') {
      const conditioning = Object.entries(graph).find(([, node]) => node.class_type === 'Hunyuan3Dv2ConditioningMultiView');
      assert.ok(conditioning, `${id}: graph has no four-view conditioning`);
      const sampler = Object.values(graph).find(node => node.class_type === 'KSampler');
      assert.deepEqual(sampler?.inputs.positive, [conditioning[0], 0]);
      assert.deepEqual(sampler?.inputs.negative, [conditioning[0], 1]);
      const loaders = new Set();
      for (const view of ['front', 'left', 'back', 'right']) {
        const encoding = graph[conditioning[1].inputs[view]?.[0]];
        assert.equal(encoding?.class_type, 'CLIPVisionEncode', `${id}: ${view} is not encoded into conditioning`);
        const loaderId = encoding.inputs.image?.[0], loader = graph[loaderId];
        assert.equal(loader?.class_type, 'LoadImage', `${id}: missing connected ${view} image`);
        assert.equal(loader.inputs.image.split('/').at(-1), `${stem}_input_${view}.png`);
        loaders.add(loaderId);
      }
      assert.equal(loaders.size, 4, `${id}: must condition on four distinct view images`);
    }
    const hpFile = highpolyFile(hp, `${stem}.glb`);
    if (localSourceAudit) {
      for (const input of inputFiles) {
        const bytes = await readFile(sourceFile(id, input.path));
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
      }
      assert.equal(createHash('sha256').update(await readFile(sourceFile(id, hpFile.path))).digest('hex'), hpFile.sha256);
    }
    const reference = stageVersion(state, 'blockout', entry.version.blockout).bounds;
    for (const mesh of asset.lods) {
      const bounds = new THREE.Box3(), positions = mesh.geometry.getAttribute('position'), vertex = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) bounds.expandByPoint(vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld));
      for (const [axis, key] of ['x', 'y', 'z'].entries()) assert.ok(bounds.max[key] - bounds.min[key] >=
        (reference.max[axis] - reference.min[axis]) * .25 - 1e-6, `${id}/${mesh.name}: thin generated geometry violates the volume minimum`);
    }
  }
  assert.ok(totalBytes <= environmentIds.length * 900 * 1024, 'combined environment assets exceed their file budget');
});

test('actual published landmark LODs stay grounded inside their solid collision envelopes in every orientation', async () => {
  const assets = await publishedAssets(landmarkIds);
  const profiles = [[4.8, 4.4, 2.6], [4.2, 5, 3.2], [4.6, 4.8, 3.4]];
  withCanvas(() => withLibrary(assets, () => {
    for (const [i, id] of landmarkIds.entries()) {
      const asset = assets.get(id), [width, height, depth] = profiles[i];
      const sharedResources = [...asset.lods.map(mesh => mesh.geometry), ...asset.materials, ...asset.maps].map(listenForDisposal);
      for (const quality of ['high', 'low']) for (let quarter = 0; quarter < 4; quarter++) {
        const deco = { kind: 'landmark', x: 4, y: 2, z: 6, yaw: quarter * Math.PI / 2, s: .92,
          footprint: { width, height, depth }, sceneLayer: 'principal' };
        const dressing = new SceneDressing({ settings: { quality }, renderer: {} }, layout(['desert', 'frost', 'inferno'][i], [deco]),
          { sand: 0xffcc88, snow: 0xffffff, cloud: { color: 0xaaaaaa } }, () => .5, []);
        dressing.group.updateMatrixWorld(true);
        const lod = dressing.group.children.find(child => child.isLOD);
        assert.ok(lod && dressing.replaced.has(deco), `${id}: actual landmark was not attached`);
        assert.deepEqual(lod.levels.map(level => level.distance), quality === 'low' ? [0, 30] : [0, 20, 42]);
        for (const level of lod.levels) {
          const mesh = level.object, positions = mesh.geometry.getAttribute('position'), point = new THREE.Vector3();
          let grounded = Infinity;
          assert.equal(mesh.castShadow, quality === 'high');
          assert.equal(mesh.matrixAutoUpdate, false);
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld).sub(new THREE.Vector3(deco.x, deco.y, deco.z));
            grounded = Math.min(grounded, point.y);
            point.applyAxisAngle(new THREE.Vector3(0, 1, 0), -deco.yaw);
            assert.ok(Math.abs(point.x) <= width * deco.s / 2 + 1e-6, `${id}: width exceeds its collider`);
            assert.ok(Math.abs(point.z) <= depth * deco.s / 2 + 1e-6, `${id}: depth exceeds its collider`);
            assert.ok(point.y >= -1e-6 && point.y <= height * deco.s + 1e-6, `${id}: height exceeds its collider`);
          }
          assert.ok(grounded <= .05, `${id}/${mesh.name}: published LOD floats over its ground`);
        }
        dressing.dispose(); dressing.dispose();
      }
      assert.ok(sharedResources.every(count => count() === 0), `${id}: arena disposal released shared art`);
    }
  }));
});

test('rejected thin pine retains failed validation evidence and stays unpublished', async () => {
  const id = ids[1], state = await json(sourceFile(id, 'asset.json'));
  const failedBuild = stageVersion(state, 'build', 1);
  assert.equal(failedBuild.quality_status, 'failed');
  assert.ok(failedBuild.quality_errors.some(error => /自然三维体量 Z/.test(error)));
  const original = stageVersion(state, 'validate', 1);
  assert.equal(original.from_build, 1); assert.equal(original.passed, true);
  const failed = state.stages.validate.versions.find(version => version.from_build === 1 && version.passed === false);
  assert.ok(failed && failed.errors > 0, 'thin-pine failure record was lost');
  const originalFile = Object.values(original.files)[0], failedFile = Object.values(failed.files)[0];
  assert.notEqual(originalFile.path, failedFile.path, 'failure revalidation overwrote original QA evidence');
  for (const file of [originalFile, failedFile]) {
    assert.equal(createHash('sha256').update(await readFile(sourceFile(id, file.path))).digest('hex'), file.sha256);
  }
  const report = await json(sourceFile(id, failedFile.path));
  assert.ok(report.some(check => check.level === 'error' && /自然三维体量 Z/.test(check.check)));
  if (manifest[id]) {
    assert.ok(manifest[id].version.highpoly > 1 && manifest[id].version.build > 1, 'rejected pine v001 became published');
  }
  const config = (await readFile(new URL('../art/pipeline/pipeline.toml', import.meta.url), 'utf8'))
    .split('[classes.nature_prop]')[1].split(/\n\[/)[0];
  assert.ok(Number(/min_reference_span_fraction\s*=\s*([\d.]+)/.exec(config)?.[1]) >= .25,
    'natural assets lost their automatic thin-geometry rejection');
});

test('actual Draco geometry at every LOD respects pine and decorative rock visual caps', async () => {
  const assets = await publishedAssets();
  withCanvas(() => withLibrary(assets, () => {
    for (const [i, id] of ids.entries()) {
      const asset = assets.get(id), kind = id.includes('Pine') ? 'pine' : 'rock';
      const vertices = measuredVertices(asset);
      assert.ok(vertices.length > 100, `${id}: no actual mesh sampled`);
      assert.ok(vertices.every(v => Number.isFinite(v.x + v.y + v.z)));
      const point = new THREE.Vector3();
      for (const requested of [.25, .4, .8, 1, 1.3]) {
        const deco = { kind, x: 4, y: 2, z: 6, yaw: .8, s: requested };
        const dressing = new SceneDressing({ settings: { quality: 'high' }, renderer: {} }, layout(bindings[i].split('.')[0], [deco]),
          { sand: 0xffcc88, snow: 0xffffff, cloud: { color: 0xaaaaaa } }, () => .5, []);
        const lod = dressing.group.children.find(child => child.isLOD);
        assert.ok(lod && dressing.replaced.has(deco));
        assert.equal(lod.levels.length, 3);
        assert.ok(lod.scale.x > 0 && lod.scale.x <= requested);
        dressing.group.updateMatrixWorld(true);
        for (const { object: mesh } of lod.levels) {
          const positions = mesh.geometry.getAttribute('position');
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            assert.ok(Math.hypot(point.x - deco.x, point.z - deco.z) * 2 <= (kind === 'pine' ? 3.1 : 1.7) * requested + 1e-6,
              `${id}/${mesh.name}: radial footprint exceeds the generator's visual envelope`);
            assert.ok(point.y - deco.y <= (kind === 'pine' ? 4.6 : .85) * requested + 1e-6,
              `${id}/${mesh.name}: actual LOD height exceeds the near-prop cap`);
          }
        }
        dressing.dispose(); dressing.dispose();
      }
    }
  }));
});

function checkBackdrop(assets, theme, rand) {
  withLibrary(assets, () => {
    const cliffId = `SM_Env_${theme === 'desert' ? 'Desert' : theme === 'frost' ? 'Frost' : 'Inferno'}Cliff`;
    const asset = assets.get(cliffId) ?? assets.get(theme === 'desert' ? ids[0] : ids[2]);
    const shared = [...asset.lods.map(m => m.geometry), ...asset.materials, ...asset.maps].map(listenForDisposal);
    const L = layout(theme), backdrop = new SceneBackdrop({}, L, rand);
    const parent = new THREE.Group(); parent.add(backdrop.group);
    assert.equal(backdrop.ready, true); assert.equal(backdrop.group.children.length, 1);
    const mesh = backdrop.group.children[0], source = asset.lods[2];
    assert.equal(mesh.isInstancedMesh, true); assert.equal(mesh.count, 30);
    assert.equal(mesh.geometry, source.geometry); assert.match(mesh.name, /\.LOD2$/);
    assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
    const copies = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const originals = Array.isArray(source.material) ? source.material : [source.material];
    copies.forEach((material, i) => {
      assert.notEqual(material, originals[i]); assert.equal(material.map, originals[i].map); assert.equal(material.fog, true);
      if (theme === 'frost' && asset.id === ids[2]) {
        assert.ok(source.geometry.getAttribute('normal'), 'snow shading requires actual mesh normals');
        assert.ok(material.color.b > material.color.r, 'frost backdrop lost its cold blue-grey tint');
        const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader,
          uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms) };
        material.onBeforeCompile(shader, {});
        assert.match(shader.vertexShader, /\bnormal\b/, 'snow vertex shader never reads the generated surface normal');
        assert.match(shader.vertexShader, /instanceMatrix/, 'snow normals must follow each rotated instance');
        assert.match(shader.vertexShader, /smoothstep\([^;]*normalize\([^;]*modelMatrix[^;]*\)\.y\s*\)/,
          'snow coverage must follow the upward component of a normalized world-space surface normal');
        const snowVarying = /varying\s+float\s+(\w+)\s*;/.exec(shader.vertexShader)?.[1];
        assert.ok(snowVarying, 'snow coverage never reaches the fragment shader');
        assert.match(shader.fragmentShader, new RegExp(`varying\\s+float\\s+${snowVarying}\\s*;`));
        assert.match(shader.fragmentShader, new RegExp(`diffuseColor\\.rgb\\s*=\\s*mix\\([^;]*\\b${snowVarying}\\b[^;]*\\);`),
          'snow coverage is declared but never blended into the material');
        assert.match(shader.fragmentShader, /smoothstep\(\s*60(?:\.0)?\s*,\s*180(?:\.0)?\s*,\s*vFogDepth\s*\)/,
          'frost backdrop fog should use its 60/180m range');
      }
      if (asset.id === cliffId) {
        const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader,
          uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms) };
        material.onBeforeCompile(shader, {});
        assert.doesNotMatch(shader.vertexShader + shader.fragmentShader, /vBackdropSnow/,
          'authored snowy cliff should retain its painted snow rather than the legacy white overlay');
      }
    });
    const matrix = new THREE.Matrix4(), placement = new THREE.Matrix4(), point = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), vertex = new THREE.Vector3();
    const positions = source.geometry.getAttribute('position'), heights = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      placement.copy(matrix).multiply(source.matrixWorld.clone().invert()); placement.decompose(point, rotation, scale);
      assert.ok(Math.abs(point.x - L.center.x) > L.half || Math.abs(point.z - L.center.z) > L.half,
        'backdrop origin stayed inside the playable courtyard');
      assert.ok(point.y < L.floorY, 'rock roots should be buried');
      const visible = new THREE.Box3(); let highest = -Infinity;
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(matrix);
        highest = Math.max(highest, vertex.y);
        if (vertex.y >= L.floorY) visible.expandByPoint(vertex);
      }
      assert.ok(!visible.isEmpty(), 'buried formation has no visible rock');
      // Test actual above-ground LOD2 vertices, including the wide low formations.
      assert.ok(visible.max.x < L.center.x - L.half || visible.min.x > L.center.x + L.half
        || visible.max.z < L.center.z - L.half || visible.min.z > L.center.z + L.half,
      'visible backdrop geometry intrudes into the playable courtyard');
      heights.push(highest - L.floorY);
    }
    const tallest = Math.max(...heights), shortest = Math.min(...heights);
    assert.ok(tallest > shortest * 1.35, 'horizon lost its high peaks and lower broad rock layers');
    assert.ok(heights.filter(height => height >= tallest * .8).length < mesh.count / 2,
      'high peaks should punctuate the ring rather than repeat at every position');
    assert.ok(mesh.boundingSphere && Number.isFinite(mesh.boundingSphere.radius));
    const owned = [...copies, mesh].map(listenForDisposal);
    backdrop.dispose(); backdrop.dispose();
    assert.equal(backdrop.group.parent, null); assert.equal(backdrop.group.children.length, 0);
    assert.ok(owned.every(count => count() === 1), 'owned far materials/instance must dispose exactly once');
    assert.ok(shared.every(count => count() === 0), 'backdrop disposed library geometry, source material or map');
  });
}

test('all three backdrops use generated LOD2, stay outside the arena and dispose owned resources once', async () => {
  const assets = await publishedAssets();
  for (const theme of ['desert', 'frost', 'inferno']) checkBackdrop(assets, theme, () => .5);
});

test('published broad cliffs remain outside the arena at backdrop LOD2 in every chapter', async () => {
  const assets = await publishedAssets(['SM_Env_DesertCliff', 'SM_Env_FrostCliff', 'SM_Env_InfernoCliff']);
  for (const theme of ['desert', 'frost', 'inferno']) checkBackdrop(assets, theme, () => .5);
});

test('backdrop cliff fixture replaces only its own fallback instance after loading', async () => {
  const previousAssets = globalThis.__natureSceneTestAssets, previousPreload = globalThis.__natureScenePreload;
  try {
    for (const theme of ['desert', 'frost', 'inferno']) {
      const old = fixtureAsset(theme === 'desert' ? ids[0] : ids[2], 3);
      const cliff = fixtureAsset(`SM_Env_${theme === 'desert' ? 'Desert' : theme === 'frost' ? 'Frost' : 'Inferno'}Cliff`, 9);
      const map = new THREE.Texture();
      for (const mesh of cliff.lods) {
        mesh.geometry.dispose();
        // Wide, offset source bounds and node transforms catch an entry-bounds
        // approximation accidentally stretching or bringing cliffs inside play.
        mesh.geometry = new THREE.BoxGeometry(12, 9, 7).translate(3, 4.5, -2);
        mesh.position.set(1.3, .4, -.9); mesh.updateMatrixWorld(true); mesh.material.map = map;
      }
      const assets = new Map([[old.id, old]]);
      globalThis.__natureSceneTestAssets = assets;
      let loaded;
      globalThis.__natureScenePreload = new Promise(resolve => { loaded = resolve; });
      let draws = 0;
      const backdrop = new SceneBackdrop({}, layout(theme), () => { draws++; return .5; });
      const parent = new THREE.Group(); parent.add(backdrop.group);
      const fallback = backdrop.group.children[0], fallbackOwned = [fallback, fallback.material].map(listenForDisposal);
      const shared = [map, ...[old, cliff].flatMap(asset => asset.lods.flatMap(mesh => [mesh.geometry, mesh.material]))].map(listenForDisposal);
      assert.equal(fallback.geometry, old.lods[2].geometry);
      const consumed = draws;
      assets.set(cliff.id, cliff); loaded();
      await globalThis.__natureScenePreload; await Promise.resolve();
      assert.equal(draws, consumed, 'async art replacement must not change the shared arena RNG');
      assert.equal(backdrop.group.parent, parent); assert.equal(backdrop.group.children.length, 1);
      const preferred = backdrop.group.children[0];
      assert.notEqual(preferred, fallback); assert.equal(preferred.geometry, cliff.lods[2].geometry);
      assert.equal(preferred.material.map, map); assert.equal(preferred.count, 30);
      assert.equal(preferred.castShadow, false); assert.equal(preferred.receiveShadow, false);
      assert.ok(fallbackOwned.every(count => count() === 1), 'late replacement leaked its old scene-owned GPU resources');
      const owned = [preferred, preferred.material].map(listenForDisposal);
      backdrop.dispose(); backdrop.dispose();
      assert.ok(owned.every(count => count() === 1));
      assert.ok(shared.every(count => count() === 0), 'backdrop replacement or teardown disposed library art');
      checkBackdrop(new Map([[cliff.id, { ...cliff, materials: cliff.lods.map(mesh => mesh.material), maps: [map] }]]), theme, () => .5);
      for (const asset of [old, cliff]) for (const mesh of asset.lods) { mesh.geometry.dispose(); mesh.material.dispose(); }
      map.dispose();
    }
  } finally {
    globalThis.__natureSceneTestAssets = previousAssets; globalThis.__natureScenePreload = previousPreload;
  }
});

test('backdrop fallback destroyed before preload cannot be revived by the late cliff', async () => {
  const previousAssets = globalThis.__natureSceneTestAssets, previousPreload = globalThis.__natureScenePreload;
  try {
    const old = fixtureAsset(ids[0], 3), cliff = fixtureAsset('SM_Env_DesertCliff', 9);
    const assets = new Map([[old.id, old]]); globalThis.__natureSceneTestAssets = assets;
    let loaded;
    globalThis.__natureScenePreload = new Promise(resolve => { loaded = resolve; });
    const backdrop = new SceneBackdrop({}, layout('desert'), () => .5);
    const owned = [backdrop.group.children[0], backdrop.group.children[0].material].map(listenForDisposal);
    backdrop.dispose(); assets.set(cliff.id, cliff); loaded();
    await globalThis.__natureScenePreload; await Promise.resolve();
    assert.equal(backdrop.ready, false); assert.equal(backdrop.group.children.length, 0);
    assert.ok(owned.every(count => count() === 1));
    for (const asset of [old, cliff]) for (const mesh of asset.lods) { mesh.geometry.dispose(); mesh.material.dispose(); }
  } finally {
    globalThis.__natureSceneTestAssets = previousAssets; globalThis.__natureScenePreload = previousPreload;
  }
});

test('backdrop fallback leaves every theme empty only when its generated asset is unavailable', () => {
  withLibrary(new Map(), () => {
    for (const theme of ['desert', 'frost', 'inferno']) {
      const backdrop = new SceneBackdrop({}, layout(theme), () => .5);
      assert.equal(backdrop.ready, false); assert.equal(backdrop.group.children.length, 0);
      backdrop.dispose(); backdrop.dispose();
    }
  });
});

test('WebP header fixture reads VP8, VP8L and VP8X dimensions and extension-only image sources', () => {
  for (const [width, height] of [[1024, 1024], [1537, 769]]) for (const kind of ['VP8 ', 'VP8L', 'VP8X']) {
    const payload = Buffer.alloc(kind === 'VP8L' ? 5 : 10);
    if (kind === 'VP8 ') {
      Buffer.from('9d012a', 'hex').copy(payload, 3);
      payload.writeUInt16LE(width | 0xc000, 6); payload.writeUInt16LE(height | 0x4000, 8);
    } else if (kind === 'VP8L') {
      payload[0] = 0x2f;
      payload.writeUInt32LE(((width - 1) | ((height - 1) << 14) | (1 << 28)) >>> 0, 1);
    } else {
      payload.writeUIntLE(width - 1, 4, 3); payload.writeUIntLE(height - 1, 7, 3);
    }
    // A leading odd-sized unknown chunk verifies RIFF padding before the dimension chunk.
    const bytes = Buffer.alloc(12 + 10 + 8 + payload.length + payload.length % 2);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8);
    bytes.write('TEST', 12); bytes.writeUInt32LE(1, 16);
    bytes.write(kind, 22); bytes.writeUInt32LE(payload.length, 26); payload.copy(bytes, 30);
    assert.deepEqual(webpDimensions(bytes), { width, height });
    const document = { images: [{ mimeType: 'image/webp', bufferView: 0 }],
      bufferViews: [{ byteLength: bytes.length }], textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }] };
    assert.equal(textureImage(document, 0), 0);
    assert.deepEqual(imageDimensions(document, bytes, textureImage(document, 0)), { width, height });
  }
});

test('published sandstone WebP maps and varied backdrop smoke work without other unpublished assets', async () => {
  const assets = await publishedAssets([ids[0]]), asset = assets.get(ids[0]);
  assert.equal(asset.document.images.length, 3);
  asset.document.images.forEach((_, i) => assert.deepEqual(imageDimensions(asset.document, asset.bin, i), { width: 1024, height: 1024 }));
  asset.document.materials.forEach((m, i) => {
    assert.equal(asset.materials[i].map, asset.maps[textureImage(asset.document, m.pbrMetallicRoughness.baseColorTexture.index)]);
    assert.equal(asset.materials[i].normalMap, asset.maps[textureImage(asset.document, m.normalTexture.index)]);
    assert.equal(asset.materials[i].roughnessMap, asset.maps[textureImage(asset.document, m.pbrMetallicRoughness.metallicRoughnessTexture.index)]);
  });
  checkBackdrop(assets, 'desert', () => .5);
});

function fixtureAsset(id, height) {
  const lods = [0, 1, 2].map(i => {
    const geometry = new THREE.BufferGeometry();
    // Reproduce decimation expanding a lower LOD beyond the manifest's LOD0 height.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([1.2, 0, 0, -1.2, 0, 0, 0, height * (1 + i * .008), 1.1], 3));
    geometry.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = `${id}_LOD${i}`; mesh.updateMatrixWorld(true); return mesh;
  });
  return { id, entry: { class: 'nature_prop', lodDistance: lodDistances, bounds: { min: [-1.2, 0, 0], max: [1.2, height, 1.1] } }, lods };
}

test('near dressing fixture retains every natural LOD and distinct low-quality far switching', () => {
  withCanvas(() => {
    for (const [id, theme, kind, height] of [[ids[0], 'desert', 'rock', 3], [ids[1], 'frost', 'pine', 4.6], [ids[2], 'inferno', 'rock', 3]]) {
      const asset = fixtureAsset(id, height);
      const vertices = measuredVertices(asset), bounds = new THREE.Box3().setFromPoints(vertices);
      const radius = Math.max(...vertices.map(v => Math.hypot(v.x, v.z)));
      withLibrary(new Map([[id, asset]]), () => {
        for (const quality of ['high', 'medium', 'low']) for (const requested of [.3, .8, 1.3]) {
          const deco = { kind, x: 4, y: 2, z: 6, yaw: .8, s: requested };
          const dressing = new SceneDressing({ settings: { quality }, renderer: {} }, layout(theme, [deco]),
            { sand: 0xffcc88, snow: 0xffffff, cloud: { color: 0xaaaaaa } }, () => .5, []);
          const lod = dressing.group.children.find(child => child.isLOD);
          assert.ok(lod); assert.ok(dressing.replaced.has(deco));
          const scale = fitNaturalPropScale({ min: bounds.min.toArray(), max: bounds.max.toArray() }, requested, kind, radius);
          assert.ok(Math.abs(lod.scale.x - scale) < 1e-7);
          const factor = kind === 'rock' ? Math.max(.15, scale) : 1;
          const expected = quality === 'low' ? [0, 42 * factor] : [0, 18 * factor, 42 * factor];
          assert.deepEqual(lod.levels.map(level => level.distance), expected);
          assert.deepEqual(lod.levels.map(level => level.object.geometry), asset.lods.slice(quality === 'low' ? 1 : 0).map(mesh => mesh.geometry));
          const camera = new THREE.PerspectiveCamera(); dressing.group.updateMatrixWorld(true);
          for (const [i, level] of lod.levels.entries()) {
            camera.position.set(deco.x + level.distance + .01, deco.y, deco.z); camera.updateMatrixWorld(true); lod.update(camera);
            assert.equal(lod.getCurrentLevel(), i, `${id}/${quality}: camera failed to select LOD${quality === 'low' ? i + 1 : i}`);
          }
          const shared = asset.lods.flatMap(mesh => [mesh.geometry, mesh.material]).map(listenForDisposal);
          dressing.dispose(); dressing.dispose();
          assert.ok(shared.every(count => count() === 0), 'near dressing destroyed a library resource');
        }
      });
      asset.lods.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
    }
  });
});

test('painted dressing changes only six environment clones and preserves shared ORM maps and legacy metal', () => {
  withCanvas(() => {
    const legacyId = 'SM_Prop_DesertReliquary';
    for (const [i, id] of [...environmentIds, legacyId].entries()) {
      const packed = new THREE.Texture(), normal = new THREE.Texture();
      const original = new THREE.MeshStandardMaterial({ roughness: .7, metalness: .6,
        roughnessMap: packed, metalnessMap: packed, normalMap: normal, normalScale: new THREE.Vector2(.8, .8) });
      const asset = fixtureAsset(id, 3);
      asset.lods.forEach(mesh => { mesh.material.dispose(); mesh.material = original; });
      if (id === legacyId) asset.entry.class = 'scene_prop';
      const [theme, kind] = id === legacyId ? ['desert', 'statue'] : environmentBindings[i].split('.');
      const deco = { kind, x: 4, y: 2, z: 6, yaw: 0, s: 1,
        ...(kind === 'landmark' ? { footprint: { width: 4, height: 4, depth: 3 } } : {}) };
      const shared = [packed, normal, original, ...asset.lods.map(mesh => mesh.geometry)].map(listenForDisposal);
      withLibrary(new Map([[id, asset]]), () => {
        const dressing = new SceneDressing({ settings: { quality: 'low' }, renderer: {} }, layout(theme, [deco]),
          { sand: 0xffcc88, snow: 0xffffff }, () => .5, []);
        const lod = dressing.group.children.find(child => child.isLOD);
        assert.ok(lod && dressing.replaced.has(deco));
        const copies = new Set(lod.levels.map(level => level.object.material));
        assert.equal(copies.size, 1, 'LOD copies should share one arena-owned material');
        const copy = [...copies][0], disposed = listenForDisposal(copy);
        assert.notEqual(copy, original);
        assert.equal(copy.normalMap, normal);
        assert.equal(copy.metalnessMap, packed);
        if (id === legacyId) {
          assert.equal(copy.roughnessMap, packed); assert.equal(copy.roughness, .7);
          assert.equal(copy.metalness, .6); assert.deepEqual(copy.normalScale.toArray(), [.8, .8]);
        } else {
          assert.equal(copy.roughnessMap, null, 'packed green channel must not restore glossy surface patches');
          assert.ok(copy.roughness >= .82); assert.equal(copy.metalness, 0);
          assert.deepEqual(copy.normalScale.toArray(), [.22, .22]);
        }
        dressing.dispose(); dressing.dispose();
        assert.equal(disposed(), 1);
      });
      assert.equal(original.roughnessMap, packed); assert.equal(original.roughness, .7);
      assert.equal(original.metalness, .6); assert.deepEqual(original.normalScale.toArray(), [.8, .8]);
      assert.ok(shared.every(count => count() === 0), 'scene finish changes must not mutate or dispose library art');
      asset.lods.forEach(mesh => mesh.geometry.dispose()); original.dispose(); packed.dispose(); normal.dispose();
    }
  });
});
