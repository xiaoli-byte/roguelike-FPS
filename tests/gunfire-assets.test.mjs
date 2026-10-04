/** Real published Hunyuan art regressions. All nine assets are required; no skips. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const themes = ['desert', 'frost', 'inferno'];
const prefixes = ['Desert', 'Frost', 'Inferno'];
const ids = prefixes.flatMap(prefix => ['Wall', 'Gate', 'Cliff'].map(kind => `SM_Env_${prefix}${kind}`));
const gateIds = prefixes.map(prefix => `SM_Env_${prefix}Gate`);
const cliffIds = prefixes.map(prefix => `SM_Env_${prefix}Cliff`);
const legacyIds = ['SM_Env_DesertSandstone', 'SM_Env_InfernoBasalt'];
const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')).assets;
const sourceFile = (id, relative) => new URL(`../art/source/props/${id}/${relative}`, import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const localSourceAudit = process.env.ART_LOCAL_SOURCE_AUDIT === '1';
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return dataModule(source);
}
const navUrl = await tsModule('../src/world/NavGrid.ts', { '../core/math': await tsModule('../src/core/math.ts') });
const stageDesignUrl = await tsModule('../src/world/StageDesign.ts');
const { generateAdventure } = await import(await tsModule('../src/world/AdventureGen.ts', { './NavGrid': navUrl, './StageDesign': stageDesignUrl }));
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const libraryUrl = dataModule('export const AssetLibrary = { get: id => globalThis.__gunfireActualAssets?.get(id) ?? null, preload: () => Promise.resolve() };');
const artEnvironmentUrl = dataModule('export function applyArtEnvironment() {}');
const materialUrl = await tsModule('../src/world/SceneSurfaceMaterial.ts');
const { architectureAssetBounds, architectureMatrix, SceneArchitecture } = await import(await tsModule('../src/world/SceneArchitecture.ts', {
  '../assets/AssetLibrary': libraryUrl, '../assets/ArtEnvironment': artEnvironmentUrl, './SceneSurfaceMaterial': materialUrl,
}));
const { AdventureTerrain } = await import(await tsModule('../src/world/AdventureTerrain.ts', {
  '../assets/AssetLibrary': libraryUrl, '../assets/ArtEnvironment': artEnvironmentUrl, './SceneSurfaceMaterial': materialUrl,
}));
const stage = theme => ({ type: 'combat', theme, chapter: 0, index: 0, reward: 'coins' });

function documentOf(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a); assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  return { document: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length) };
}
function nodeMatrix(document, index) {
  const node = document.nodes[index];
  const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
  const parent = document.nodes.findIndex(n => n.children?.includes(index));
  return parent < 0 ? local : nodeMatrix(document, parent).multiply(local);
}
function imageDimensions(document, bin, index) {
  const image = document.images[index], view = document.bufferViews[image.bufferView];
  assert.ok(view, 'all runtime texture bytes must be embedded');
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  if (image.mimeType === 'image/png') {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  assert.equal(image.mimeType, 'image/webp');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const end = bytes.readUInt32LE(4) + 8; assert.ok(end <= bytes.length);
  for (let offset = 12; offset + 8 <= end;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), payload = offset + 8;
    assert.ok(payload + length <= end);
    if (kind === 'VP8X') return [1 + bytes.readUIntLE(payload + 4, 3), 1 + bytes.readUIntLE(payload + 7, 3)];
    if (kind === 'VP8L') {
      assert.equal(bytes[payload], 0x2f); const size = bytes.readUInt32LE(payload + 1);
      return [1 + (size & 0x3fff), 1 + ((size >>> 14) & 0x3fff)];
    }
    if (kind === 'VP8 ') {
      assert.equal(bytes.subarray(payload + 3, payload + 6).toString('hex'), '9d012a');
      return [bytes.readUInt16LE(payload + 6) & 0x3fff, bytes.readUInt16LE(payload + 8) & 0x3fff];
    }
    offset = payload + length + (length % 2);
  }
  assert.fail('missing supported image header');
}
function textureImage(document, index) {
  const texture = document.textures[index], image = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
  assert.ok(Number.isInteger(image) && image >= 0 && image < document.images.length); return image;
}
const loaded = new Map();
async function publishedAssets(selected) {
  for (const id of selected) assert.ok(manifest[id], `${id}: publish the approved local Hunyuan asset before final validation`);
  const { loadPublishedMesh } = await import('../art/tools/pose_geometry_audit.mjs');
  for (const id of selected.filter(id => !loaded.has(id))) {
    const entry = manifest[id], bytes = await readFile(new URL(`../public/${entry.url}`, import.meta.url));
    const { document, bin } = documentOf(bytes);
    const maps = document.images.map((_, i) => {
      const [width, height] = imageDimensions(document, bin, i); return new THREE.Texture({ width, height });
    });
    const materials = document.materials.map(m => new THREE.MeshStandardMaterial({
      map: maps[textureImage(document, m.pbrMetallicRoughness.baseColorTexture.index)],
      normalMap: maps[textureImage(document, m.normalTexture.index)],
      roughnessMap: maps[textureImage(document, m.pbrMetallicRoughness.metallicRoughnessTexture.index)],
    }));
    const lods = [0, 1, 2].map(lod => {
      const node = document.nodes.findIndex(n => n.name === `${id}_LOD${lod}`); assert.ok(node >= 0, `${id}: no LOD${lod}`);
      const meshIndex = document.nodes[node].mesh, decoded = loadPublishedMesh(id, meshIndex);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
      if (decoded.attrs.NORMAL) geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.attrs.NORMAL, 3));
      if (decoded.attrs.TEXCOORD_0) geometry.setAttribute('uv', new THREE.BufferAttribute(decoded.attrs.TEXCOORD_0, 2));
      geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1));
      const mesh = new THREE.Mesh(geometry, materials[document.meshes[meshIndex].primitives[0].material]);
      mesh.name = `${id}_LOD${lod}`; mesh.applyMatrix4(nodeMatrix(document, node)); mesh.updateMatrixWorld(true); return mesh;
    });
    loaded.set(id, { id, entry, bytes, document, bin, maps, materials, lods });
  }
  return loaded;
}
function stageVersion(state, name, version) {
  const record = state.stages[name]?.versions.find(r => r.version === version);
  assert.ok(record, `${state.id}: missing ${name} version ${version}`); return record;
}
async function verifyFile(id, file) {
  assert.match(file.sha256, /^[0-9a-f]{64}$/); assert.equal(digest(await readFile(sourceFile(id, file.path))), file.sha256, `${id}: changed ${file.path}`);
}

test('nine actual published buildings and cliffs meet Draco/PBR budgets and unwaived local Hunyuan provenance', async () => {
  const assets = await publishedAssets(ids);
  for (const id of ids) {
    const { entry, bytes, document, bin, lods } = assets.get(id);
    assert.equal(entry.kind, 'static'); assert.equal(entry.class, 'nature_prop'); assert.equal(entry.keepGlow, 'none');
    const theme = themes[prefixes.findIndex(prefix => id.includes(prefix))], kind = id.replace(/^SM_Env_(Desert|Frost|Inferno)/, '').toLowerCase();
    assert.deepEqual(entry.bind, { source: 'scene', id: `${theme}.${kind}` }); assert.deepEqual(entry.lodDistance, [0, 18, 42]);
    assert.equal(bytes.length, entry.bytes); assert.equal(digest(bytes), entry.sha256); assert.ok(bytes.length <= 900 * 1024, `${id}: exceeds 900KiB`);
    assert.equal(document.meshes.length, 3); assert.equal(document.materials.length, 1); assert.equal(document.skins?.length ?? 0, 0);
    const counts = lods.map(m => m.geometry.index.count / 3);
    for (const [lod, count] of counts.entries()) {
      assert.ok(count > 0 && count <= [5000, 1600, 500][lod], `${id}/LOD${lod}: ${count} triangles`);
      assert.ok(lods[lod].geometry.getAttribute('normal') && lods[lod].geometry.getAttribute('uv'));
      const node = document.nodes.find(n => n.name === `${id}_LOD${lod}`);
      const primitive = document.meshes[node.mesh].primitives;
      assert.equal(primitive.length, 1); assert.equal(primitive[0].material, 0); assert.ok(primitive[0].extensions?.KHR_draco_mesh_compression);
    }
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `${id}: LODs do not decrease`);
    const material = document.materials[0], pbr = material.pbrMetallicRoughness;
    assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE');
    assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && material.normalTexture && material.occlusionTexture);
    assert.equal(pbr.metallicRoughnessTexture.index, material.occlusionTexture.index);
    assert.equal(document.images.length, 3);
    document.images.forEach((_, index) => assert.deepEqual(imageDimensions(document, bin, index), [1024, 1024]));
    const state = JSON.parse(await readFile(sourceFile(id, 'asset.json'), 'utf8'));
    const blockout = stageVersion(state, 'blockout', entry.version.blockout), concept = stageVersion(state, 'concept', entry.version.concept);
    const hp = stageVersion(state, 'highpoly', entry.version.highpoly), build = stageVersion(state, 'build', entry.version.build);
    assert.equal(blockout.reference_mode, 'bounds_only'); assert.equal(blockout.geometry_created, false);
    assert.ok((await readdir(sourceFile(id, '00_blockout/'))).every(name => !/\.(glb|gltf|blend|obj|ply|fbx|stl)$/i.test(name)), `${id}: procedural artistic reference created`);
    assert.equal(concept.from_blockout, blockout.version); assert.equal(concept.review?.verdict, 'approved');
    assert.equal(hp.from_concept, concept.version); assert.notEqual(hp.quality_status, 'failed');
    assert.match(hp.tool, /Hunyuan3D/); assert.match(hp.checkpoint, /hunyuan[_-]?3d/i); assert.ok(['single', 'multiview'].includes(hp.mode));
    assert.ok(hp.comfyui && /cuda.*NVIDIA/i.test(hp.gpu), `${id}: local ComfyUI GPU provenance missing`);
    assert.deepEqual(entry.generator, { tool: hp.tool, mode: hp.mode, checkpoint: hp.checkpoint }); assert.equal(entry.license, hp.license);
    assert.equal(build.quality_status, 'passed'); assert.deepEqual(build.quality_errors, []);
    assert.deepEqual([build.from.blockout, build.from.concept, build.from.highpoly], [blockout.version, concept.version, hp.version]);
    const exported = Object.values(build.files).find(file => file.path.endsWith('.glb'));
    assert.equal(exported?.sha256, entry.sha256, `${id}: publication differs from approved build`);
    const validation = state.stages.validate.versions.find(r => r.from_build === build.version && r.passed);
    const review = state.stages.review.versions.find(r => r.from_build === build.version && r.review?.verdict === 'approved');
    assert.ok(validation && review, `${id}: unreviewed/rejected build published`);
    assert.equal(validation.errors, 0); assert.deepEqual(validation.waived, []); assert.equal(review.review.by, 'Codex AI visual review');
    for (const file of Object.values(validation.files)) await verifyFile(id, file);
    const stem = `HP_${id}_v${String(hp.version).padStart(3, '0')}`, graphFile = hp.files[`${stem}_graph.json`];
    assert.ok(graphFile && graphFile.path === `02_highpoly/${stem}_graph.json`); await verifyFile(id, graphFile);
    const graph = JSON.parse(await readFile(sourceFile(id, graphFile.path), 'utf8'));
    assert.ok(Object.values(graph).some(n => /Hunyuan3D/i.test(n.class_type)));
    assert.ok(Object.values(graph).some(n => n.inputs?.ckpt_name === hp.checkpoint));
    const inputNames = hp.mode === 'multiview' ? ['front', 'left', 'back', 'right'].map(view => `${stem}_input_${view}.png`) : [`${stem}_input.png`];
    for (const name of [...inputNames, `${stem}.glb`]) {
      assert.ok(hp.files[name]); assert.equal(hp.files[name].path, `02_highpoly/${name}`); assert.match(hp.files[name].sha256, /^[0-9a-f]{64}$/);
    }
    if (hp.mode === 'multiview') {
      const conditioning = Object.entries(graph).find(([, n]) => n.class_type === 'Hunyuan3Dv2ConditioningMultiView'); assert.ok(conditioning);
      const sampler = Object.values(graph).find(n => n.class_type === 'KSampler');
      assert.deepEqual(sampler.inputs.positive, [conditioning[0], 0]); assert.deepEqual(sampler.inputs.negative, [conditioning[0], 1]);
      const loaders = new Set();
      for (const view of ['front', 'left', 'back', 'right']) {
        const encoder = graph[conditioning[1].inputs[view]?.[0]]; assert.equal(encoder?.class_type, 'CLIPVisionEncode');
        const loaderId = encoder.inputs.image?.[0], loader = graph[loaderId]; assert.equal(loader?.class_type, 'LoadImage');
        assert.equal(loader.inputs.image.split('/').at(-1), `${stem}_input_${view}.png`); loaders.add(loaderId);
      }
      assert.equal(loaders.size, 4);
    }
    if (localSourceAudit) for (const record of [blockout, concept, hp, build, validation, review])
      for (const file of Object.values(record.files)) await verifyFile(id, file);
  }
});

/** Clip a triangle against all six box planes; vertices alone cannot prove a hole. */
function clippedArea(triangle, box) {
  let polygon = triangle;
  for (const axis of ['x', 'y', 'z']) for (const [bound, greater] of [[box.min[axis], true], [box.max[axis], false]]) {
    if (!polygon.length) return 0;
    const output = [], signed = point => greater ? point[axis] - bound : bound - point[axis];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = signed(a), db = signed(b);
      if (da >= 0) output.push(a);
      if ((da >= 0) !== (db >= 0)) output.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = output;
  }
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) area += new THREE.Vector3().subVectors(polygon[i], polygon[0])
    .cross(new THREE.Vector3().subVectors(polygon[i + 1], polygon[0])).length() / 2;
  return area;
}
function transformedVertices(mesh, matrix) {
  const positions = mesh.geometry.getAttribute('position');
  return Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
}
function assertEmptyOpening(mesh, vertices, width, height, label) {
  const extent = new THREE.Box3().setFromPoints(vertices), epsilon = 1e-5;
  const box = new THREE.Box3(new THREE.Vector3(-width / 2 + epsilon, epsilon, extent.min.z - .001),
    new THREE.Vector3(width / 2 - epsilon, height - epsilon, extent.max.z + .001));
  const index = mesh.geometry.index;
  let intersections = 0, area = 0;
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => vertices[index.getX(i + k)]);
    if (triangle.some(p => !Number.isFinite(p.x + p.y + p.z))) assert.fail(`${label}: invalid exported position`);
    const clipped = clippedArea(triangle, box);
    if (clipped > 1e-12) { intersections++; area += clipped; }
  }
  assert.equal(intersections, 0, `${label}: ${intersections} real triangles fill the passage (${area}m²)`);
}
function assertBoundsClose(actual, expected, label, tolerance = 2e-5) {
  for (const side of ['min', 'max']) for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(actual[side][axis] - expected[side][axis]) <= tolerance, `${label}: ${side}.${axis} actual ${actual[side][axis]} expected ${expected[side][axis]}`);
}

test('three real gate sources and all rotated runtime LODs have a complete empty passage without artistic stretching', async () => {
  const assets = await publishedAssets(gateIds);
  for (const [i, id] of gateIds.entries()) {
    const asset = assets.get(id), bounds = architectureAssetBounds(asset.lods);
    const base = generateAdventure(new Rng(20261004), stage(themes[i])).architecture.find(a => a.type === 'gate');
    for (const [lod, source] of asset.lods.entries()) assertEmptyOpening(source, transformedVertices(source, source.matrixWorld), 6.4, 3.8, `${id}/sourceLOD${lod}`);
    for (const quarter of [0, 1, 2, 3]) {
      const placement = { ...base, x: 7.25, y: .4, z: -8.5, yaw: quarter * Math.PI / 2 };
      const pose = new THREE.Object3D(); pose.position.set(placement.x, placement.y, placement.z); pose.rotation.y = placement.yaw; pose.updateMatrix();
      const inversePose = pose.matrix.clone().invert(), actualUnion = new THREE.Box3();
      let uniform;
      for (const [lod, source] of asset.lods.entries()) {
        const matrix = architectureMatrix(source, placement, bounds), artTransform = matrix.clone().multiply(source.matrixWorld.clone().invert());
        const scale = new THREE.Vector3(); artTransform.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        assert.ok(Math.abs(scale.x - scale.y) < 1e-8 && Math.abs(scale.y - scale.z) < 1e-8, `${id}: artistic mesh stretched`);
        if (uniform !== undefined) assert.ok(Math.abs(scale.x - uniform) < 1e-8, `${id}: LOD re-fit changed its anchor/scale`);
        uniform = scale.x;
        const vertices = transformedVertices(source, matrix);
        vertices.forEach(p => actualUnion.expandByPoint(p));
        assertEmptyOpening(source, vertices.map(p => p.clone().applyMatrix4(inversePose)), 7.68, 4.56, `${id}/yaw${quarter}/runtimeLOD${lod}`);
      }
      const e = placement.envelope, width = (quarter & 1 ? e.depth : e.width) * placement.s, depth = (quarter & 1 ? e.width : e.depth) * placement.s;
      assertBoundsClose(actualUnion, new THREE.Box3(new THREE.Vector3(placement.x - width / 2, placement.y, placement.z - depth / 2),
        new THREE.Vector3(placement.x + width / 2, placement.y + e.height * placement.s, placement.z + depth / 2)), `${id}/yaw${quarter} whole grounded envelope`);
    }
  }
});

test('real building instances share library geometry and their measured all-LOD bounds match the collision envelopes', async () => {
  const assets = await publishedAssets(ids.filter(id => !cliffIds.includes(id)));
  globalThis.__gunfireActualAssets = assets;
  try {
    for (const [i, theme] of themes.entries()) {
      const L = generateAdventure(new Rng(20261004), stage(theme)), camera = new THREE.PerspectiveCamera();
      const architecture = new SceneArchitecture({ renderer: {}, camera, settings: { quality: 'high' } }, L);
      const seen = new Set(); let count = 0;
      architecture.group.updateMatrixWorld(true);
      for (const lod of architecture.group.children) {
        count += lod.levels[0].object.count;
        const id = lod.name.split('.court.')[0], asset = assets.get(id), expected = L.architecture.filter(a => a.assetId === id);
        const allBounds = architectureAssetBounds(asset.lods);
        for (let instanceIndex = 0; instanceIndex < lod.levels[0].object.count; instanceIndex++) {
          const union = new THREE.Box3();
          const first = lod.levels[0].object, firstLocal = new THREE.Matrix4(); first.getMatrixAt(instanceIndex, firstLocal);
          const firstMatrix = first.matrixWorld.clone().multiply(firstLocal);
          const source = asset.lods.find(source => source.geometry === first.geometry); assert.ok(source);
          // LOD1/2 may have an asymmetric inset after decimation. Identify the
          // placement by its production transform, not the visible LOD centre.
          const placement = expected.find(a => {
            const matrix = architectureMatrix(source, a, allBounds);
            return matrix.elements.every((value, index) => Math.abs(value - firstMatrix.elements[index]) <= 2e-5);
          });
          assert.ok(placement, `${id}: an actual instance lost its measured anchor`); seen.add(placement);
          for (const level of lod.levels) {
            const instance = level.object, local = new THREE.Matrix4(); instance.getMatrixAt(instanceIndex, local);
            assert.ok(asset.lods.some(source => source.geometry === instance.geometry));
            const vertices = instance.geometry.getAttribute('position'), matrix = instance.matrixWorld.clone().multiply(local);
            for (let vertex = 0; vertex < vertices.count; vertex++) union.expandByPoint(new THREE.Vector3().fromBufferAttribute(vertices, vertex).applyMatrix4(matrix));
          }
          const quarter = Math.round(placement.yaw / (Math.PI / 2)), e = placement.envelope;
          // Walls render LOD1/2, so decimation can inset their far surface a few
          // millimetres. No actual vertex may protrude beyond the collision box.
          const width = (quarter & 1 ? e.depth : e.width) * placement.s, depth = (quarter & 1 ? e.width : e.depth) * placement.s;
          assert.ok(union.min.x >= placement.x - width / 2 - 2e-5 && union.max.x <= placement.x + width / 2 + 2e-5);
          assert.ok(union.min.z >= placement.z - depth / 2 - 2e-5 && union.max.z <= placement.z + depth / 2 + 2e-5);
          assert.ok(union.min.y >= placement.y - 2e-5 && union.max.y <= placement.y + e.height * placement.s + 2e-5);
        }
      }
      assert.equal(count, L.architecture.length); assert.equal(seen.size, L.architecture.length); architecture.dispose();
      const wall = L.architecture.find(a => a.assetId === `SM_Env_${prefixes[i]}Wall`), source = assets.get(wall.assetId);
      const union = new THREE.Box3();
      for (const mesh of source.lods) transformedVertices(mesh, architectureMatrix(mesh, { ...wall, x: 0, y: 0, z: 0, yaw: 0 }, architectureAssetBounds(source.lods))).forEach(p => union.expandByPoint(p));
      assertBoundsClose(union, new THREE.Box3(new THREE.Vector3(-wall.envelope.width / 2, 0, -wall.envelope.depth / 2),
        new THREE.Vector3(wall.envelope.width / 2, wall.envelope.height, wall.envelope.depth / 2)), `${source.id}: invisible outer strips returned`);
    }
  } finally { delete globalThis.__gunfireActualAssets; }
});

test('three real cliff families and old loose rocks retain every actual collision envelope and shared resource', async () => {
  const assets = await publishedAssets([...cliffIds, ...legacyIds]); globalThis.__gunfireActualAssets = assets;
  try {
    for (const [i, theme] of themes.entries()) for (const quality of ['high', 'low']) {
      // The default now has no rubble in front of its entrance. Use a mixed
      // seeded layout so BOTH real published source families are measured.
      const L = Array.from({ length: 12 }, (_, seed) => generateAdventure(new Rng((seed + 1) * 7919), stage(theme)))
        .find(layout => layout.adventure.rocks.some(rock => !rock.ridge));
      assert.ok(L, `${theme}: actual mesh regression must exercise both cliffs and old rubble`);
      const terrain = new AdventureTerrain({ renderer: {}, settings: { quality } }, L);
      terrain.group.updateMatrixWorld(true);
      const sourceId = quality === 'high' ? 1 : 2, seen = new Set(), resourceCounts = [];
      const selected = [assets.get(cliffIds[i]), assets.get(theme === 'inferno' ? legacyIds[1] : legacyIds[0])];
      for (const asset of selected) for (const resource of [...asset.lods.map(m => m.geometry), ...asset.materials, ...asset.maps]) {
        const counter = { disposed: 0 }; resource.addEventListener('dispose', () => counter.disposed++); resourceCounts.push(counter);
      }
      for (const lod of terrain.group.children) {
        const id = lod.name.split('.adventure.rocks.')[0], asset = assets.get(id), cliff = id === cliffIds[i];
        assert.deepEqual(lod.levels.map(level => level.distance), quality === 'low' ? [0] : [0, 42]);
        for (const [levelIndex, level] of lod.levels.entries()) {
          const instance = level.object; assert.equal(instance.geometry, asset.lods[levelIndex ? 2 : sourceId].geometry);
          assert.equal(instance.castShadow, quality === 'high'); assert.equal(instance.matrixAutoUpdate, false);
          const positions = instance.geometry.getAttribute('position');
          for (let index = 0; index < instance.count; index++) {
            const local = new THREE.Matrix4(); instance.getMatrixAt(index, local);
            const matrix = instance.matrixWorld.clone().multiply(local), bounds = new THREE.Box3();
            for (let v = 0; v < positions.count; v++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, v).applyMatrix4(matrix));
            const center = bounds.getCenter(new THREE.Vector3()), rock = L.adventure.rocks.find(r => Math.abs(r.x - center.x) < 2e-5 && Math.abs(r.z - center.z) < 2e-5);
            assert.ok(rock && !!rock.ridge === cliff, `${theme}: wrong generated source for formation/rubble`);
            if (levelIndex === 0) seen.add(rock);
            assertBoundsClose(bounds, new THREE.Box3(new THREE.Vector3(rock.x - rock.width / 2, L.floorY, rock.z - rock.depth / 2),
              new THREE.Vector3(rock.x + rock.width / 2, L.floorY + rock.height, rock.z + rock.depth / 2)), `${id}/${instance.name} collision fit`);
          }
        }
      }
      assert.equal(seen.size, L.adventure.rocks.length); terrain.dispose(); terrain.dispose();
      assert.ok(resourceCounts.every(counter => counter.disposed === 0), 'terrain disposed public geometry/maps/material templates');
    }
  } finally { delete globalThis.__gunfireActualAssets; }
});

test.after(() => {
  for (const asset of loaded.values()) for (const resource of [...asset.lods.map(m => m.geometry), ...asset.materials, ...asset.maps]) resource.dispose();
});
