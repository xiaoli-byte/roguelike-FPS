#!/usr/bin/env node
// Unity 场景网页导出的发布步骤：读 Unity 原样导出（public/assets/unity-levels.next，Git 忽略），
// 写网页实际加载的发布目录（public/assets/unity-levels，入库）。
//
//   node scripts/unity/optimize-web-levels.mjs            全量重建发布目录
//   node scripts/unity/optimize-web-levels.mjs --check    只核对发布目录与原样导出一致（不写文件）
//
// 做三件事，都不改变运行时看到的内容：
// 1. 地形 GLB 只剩材质：几何体由场景文档里的高度场在运行时重建（UnityTerrainMesh.ts），
//    原样导出里那份 1025² 顶点的网格（单张 56 MB）从来不会被画出来。
// 2. 其余网格的顶点 / 索引缓冲走 EXT_meshopt_compression（无过滤器，无损），
//    碰撞网格去掉用不到的法线 / UV。
// 3. 贴图 PNG → WebP（webp_textures.py）：颜色贴图有损 q90；地形 splat 无损；
//    法线贴图先按 Unity 的打包格式解包成 glTF RGB 法线（导出器 Blit 进 sRGB 渲染纹理，线性的法线贴图
//    带着 sRGB 曲线和 DXT5nm 布局出来，网页直接读是错的），再有损 q95。全不透明的贴图去掉 alpha 通道。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'public', 'assets', 'unity-levels.next');
const TARGET = join(ROOT, 'public', 'assets', 'unity-levels');
const CHECK = process.argv.includes('--check');

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== CHUNK_JSON) throw new Error('GLB without JSON chunk');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  let bin = Buffer.alloc(0);
  const binStart = 20 + jsonLength;
  if (binStart + 8 <= bytes.length && bytes.readUInt32LE(binStart + 4) === CHUNK_BIN) {
    bin = bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart));
  }
  return { json, bin };
}

function pad4(buffer, fill) {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer;
}

function writeGlb(json, bin) {
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad4(bin, 0);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), jsonChunk];
  if (binChunk.length) parts.push(Buffer.alloc(8), binChunk);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  parts[0].writeUInt32LE(GLB_MAGIC, 0); parts[0].writeUInt32LE(2, 4); parts[0].writeUInt32LE(total, 8);
  parts[1].writeUInt32LE(jsonChunk.length, 0); parts[1].writeUInt32LE(CHUNK_JSON, 4);
  if (binChunk.length) { parts[3].writeUInt32LE(binChunk.length, 0); parts[3].writeUInt32LE(CHUNK_BIN, 4); }
  return Buffer.concat(parts);
}

function addExtension(json, name, required) {
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), name])];
  if (required) json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), name])];
}

/** Terrain renderers: keep materials / textures, replace the heightfield mesh by one degenerate triangle. */
function stripTerrain(json) {
  const position = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const normal = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 0, 0, 0, 0]);
  const bin = Buffer.concat([Buffer.from(position.buffer), Buffer.from(normal.buffer), Buffer.from(uv.buffer)]);
  json.buffers = [{ byteLength: bin.length }];
  json.bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: 36, target: ARRAY_BUFFER },
    { buffer: 0, byteOffset: 36, byteLength: 36, target: ARRAY_BUFFER },
    { buffer: 0, byteOffset: 72, byteLength: 24, target: ARRAY_BUFFER },
  ];
  json.accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0, 0, 0] },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
  ];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      primitive.attributes = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 };
      delete primitive.indices;
      delete primitive.targets;
    }
  }
  return bin;
}

/** Collision meshes are read for POSITION + indices only (UnityColliders.ts). */
function stripCollisionAttributes(json) {
  const isCollision = (json.meshes ?? []).length > 0 && (json.meshes ?? []).every(mesh => /_Collision$/.test(mesh.name ?? ''))
    && (json.materials ?? []).length === 0;
  if (!isCollision) return;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) primitive.attributes = { POSITION: primitive.attributes.POSITION };
  }
}

/** Rebuild the binary chunk from the accessors still referenced, compressing each buffer view with meshopt. */
function compressBuffers(json, bin) {
  const used = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const index of Object.values(primitive.attributes)) used.add(index);
      if (primitive.indices !== undefined) used.add(primitive.indices);
      for (const target of primitive.targets ?? []) for (const index of Object.values(target)) used.add(index);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) used.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { used.add(sampler.input); used.add(sampler.output); }
  const indexAccessors = new Set();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) if (primitive.indices !== undefined) indexAccessors.add(primitive.indices);

  // Remap accessors to the used set; every accessor gets its own tightly packed buffer view.
  const accessorMap = new Map();
  const accessors = [];
  const fallback = [];
  const compressed = [];
  const views = [];
  let fallbackLength = 0, compressedLength = 0;
  for (const [oldIndex, accessor] of (json.accessors ?? []).entries()) {
    if (!used.has(oldIndex)) continue;
    const view = json.bufferViews[accessor.bufferView];
    if (view.byteStride && view.byteStride !== COMPONENT_SIZE[accessor.componentType] * TYPE_SIZE[accessor.type]) {
      throw new Error('interleaved buffer views are not expected in Unity exports');
    }
    if (accessor.sparse) throw new Error('sparse accessors are not expected in Unity exports');
    const elementSize = COMPONENT_SIZE[accessor.componentType] * TYPE_SIZE[accessor.type];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const raw = new Uint8Array(bin.buffer, bin.byteOffset + start, accessor.count * elementSize).slice();
    const isIndex = indexAccessors.has(oldIndex);
    let encoded = null, mode = null;
    if (isIndex && (elementSize === 2 || elementSize === 4)) {
      const triangles = accessor.count % 3 === 0;
      mode = triangles ? 'TRIANGLES' : 'INDICES';
      encoded = MeshoptEncoder.encodeGltfBuffer(raw, accessor.count, elementSize, mode);
    } else if (!isIndex && elementSize % 4 === 0 && elementSize <= 256) {
      mode = 'ATTRIBUTES';
      encoded = MeshoptEncoder.encodeGltfBuffer(raw, accessor.count, elementSize, mode);
    }
    const newView = { buffer: 0, byteOffset: fallbackLength, byteLength: raw.length };
    if (view.target !== undefined) newView.target = isIndex ? ELEMENT_ARRAY_BUFFER : ARRAY_BUFFER;
    if (encoded && encoded.length < raw.length) {
      newView.extensions = { EXT_meshopt_compression: { buffer: 1, byteOffset: compressedLength, byteLength: encoded.length, byteStride: elementSize, count: accessor.count, mode } };
      compressed.push(pad4(Buffer.from(encoded), 0));
      compressedLength += compressed.at(-1).length;
      fallbackLength += (raw.length + 3) & ~3;
    } else {
      // Not worth compressing: store as-is in the real buffer (buffer 1), view points there.
      newView.buffer = 1;
      newView.byteOffset = compressedLength;
      compressed.push(pad4(Buffer.from(raw), 0));
      compressedLength += compressed.at(-1).length;
    }
    views.push(newView);
    accessorMap.set(oldIndex, accessors.length);
    accessors.push({ ...accessor, bufferView: views.length - 1, byteOffset: undefined });
  }
  for (const accessor of accessors) delete accessor.byteOffset;
  const remap = index => accessorMap.get(index);
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = remap(primitive.indices);
      for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = remap(target[key]);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { sampler.input = remap(sampler.input); sampler.output = remap(sampler.output); }
  if ((json.images ?? []).some(image => image.bufferView !== undefined)) throw new Error('embedded images are not expected in Unity exports');
  json.accessors = accessors;
  json.bufferViews = views;
  const anyCompressed = views.some(view => view.extensions);
  // Buffer 0: fallback placeholder (no data in the GLB), buffer 1: the GLB binary chunk... glTF requires the GLB
  // chunk to be buffer 0, so swap: real data is buffer 0, the placeholder is buffer 1.
  for (const view of views) {
    if (view.extensions) { view.buffer = 1; view.extensions.EXT_meshopt_compression.buffer = 0; }
    else view.buffer = 0;
  }
  if (compressedLength === 0) {
    delete json.buffers; delete json.bufferViews; delete json.accessors;
    return Buffer.alloc(0);
  }
  json.buffers = [{ byteLength: compressedLength }];
  if (anyCompressed) {
    json.buffers.push({ byteLength: Math.max(fallbackLength, 4), extensions: { EXT_meshopt_compression: { fallback: true } } });
    addExtension(json, 'EXT_meshopt_compression', true);
  }
  return Buffer.concat(compressed);
}

/**
 * 发布名按内容哈希取（t_<sha1 前 20 位>.webp）：Unity 导出时贴图按编辑器会话里的对象编号命名，每次导出编号都变，
 * 引用它的网格文件跟着全变（一次重导改写 2700 多个 GLB）。按内容命名后没变的贴图、网格逐字节不变；内容相同的贴图合成一份。
 */
let textureNames = null;
function buildTextureNames() {
  textureNames = new Map();
  for (const name of readdirSync(join(SOURCE, 'textures'))) {
    if (!/\.png$/i.test(name)) continue;
    const hash = createHash('sha1').update(readFileSync(join(SOURCE, 'textures', name))).digest('hex').slice(0, 20);
    textureNames.set(name, `t_${hash}.webp`);
  }
}

function textureName(uri) {
  const name = basename(uri);
  return textureNames?.get(name) ?? name.replace(/\.png$/i, '.webp');
}

function optimizeMesh(file, out) {
  const { json, bin } = readGlb(readFileSync(file));
  const terrain = (json.meshes ?? []).some(mesh => /Heightfield$/.test(mesh.name ?? ''));
  let data = bin;
  if (terrain) data = stripTerrain(json);
  else stripCollisionAttributes(json);
  for (const image of json.images ?? []) if (image.uri) image.uri = `../textures/${textureName(image.uri)}`;
  data = compressBuffers(json, data);
  writeFileSync(out, writeGlb(json, data));
  return { terrain };
}

function rewriteSceneTextures(text) {
  return text.replace(/assets\/unity-levels\/textures\/([^"]+?\.png)"/g, (_, name) => `assets/unity-levels/textures/${textureName(name)}"`);
}

/**
 * Texture roles for webp_textures.py: "normal" (Unity packed normal map, unpacked to glTF RGB there) and
 * "lossless" (terrain splat maps, read as blend weights). Everything else is colour.
 */
function textureRoles() {
  const roles = {};
  const imageOf = (json, info) => json.images?.[json.textures?.[info.index]?.source]?.uri;
  for (const file of readdirSync(join(SOURCE, 'meshes'))) {
    const { json } = readGlb(readFileSync(join(SOURCE, 'meshes', file)));
    for (const material of json.materials ?? []) {
      const colour = [material.pbrMetallicRoughness?.baseColorTexture, material.emissiveTexture].filter(Boolean).map(info => basename(imageOf(json, info) ?? ''));
      if (!material.normalTexture) continue;
      const uri = imageOf(json, material.normalTexture);
      if (!uri) continue;
      if (colour.includes(basename(uri))) throw new Error(`${file}: ${uri} is both a colour and a normal texture`);
      roles[basename(uri)] = 'normal';
    }
  }
  for (const file of readdirSync(join(SOURCE, 'scenes'))) {
    const doc = JSON.parse(readFileSync(join(SOURCE, 'scenes', file), 'utf8'));
    for (const renderer of doc.renderers ?? []) for (const url of renderer.terrain?.alphamaps ?? []) {
      if (roles[basename(url)] === 'normal') throw new Error(`${file}: ${url} is both a splat map and a normal texture`);
      roles[basename(url)] = 'lossless';
    }
  }
  return roles;
}

function hashFile(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

async function main() {
  if (!existsSync(join(SOURCE, 'manifest.json'))) {
    throw new Error(`没有原样导出：${SOURCE}（先在 Unity 里跑 bash scripts/unity/bridge.sh webexport）`);
  }
  buildTextureNames();
  if (CHECK) return check();
  await MeshoptEncoder.ready;
  emptyDir(TARGET);
  for (const folder of ['scenes', 'meshes', 'textures']) mkdirSync(join(TARGET, folder), { recursive: true });

  const sourceSize = folderSize(SOURCE);
  copyFileSync(join(SOURCE, 'manifest.json'), join(TARGET, 'manifest.json'));
  for (const file of readdirSync(join(SOURCE, 'scenes'))) {
    writeFileSync(join(TARGET, 'scenes', file), rewriteSceneTextures(readFileSync(join(SOURCE, 'scenes', file), 'utf8')));
  }

  const meshes = readdirSync(join(SOURCE, 'meshes')).filter(name => name.endsWith('.glb'));
  let terrains = 0;
  for (const [i, name] of meshes.entries()) {
    const result = optimizeMesh(join(SOURCE, 'meshes', name), join(TARGET, 'meshes', name));
    if (result.terrain) terrains++;
    if ((i + 1) % 250 === 0) console.log(`meshes ${i + 1}/${meshes.length}`);
  }
  console.log(`meshes ${meshes.length} (terrain stripped: ${terrains})`);

  const listFile = join(TARGET, '.texture-roles.json');
  writeFileSync(listFile, JSON.stringify({ roles: textureRoles(), names: Object.fromEntries(textureNames) }));
  const python = process.env.PYTHON ?? 'python';
  const result = spawnSync(python, ['-I', join(ROOT, 'scripts', 'unity', 'webp_textures.py'), join(SOURCE, 'textures'), join(TARGET, 'textures'), listFile], { stdio: 'inherit' });
  rmSync(listFile, { force: true });
  if (result.status !== 0) throw new Error('texture conversion failed');

  verifyReferences();
  console.log(`unity-levels: ${(sourceSize / 2 ** 20).toFixed(0)} MiB → ${(folderSize(TARGET) / 2 ** 20).toFixed(0)} MiB`);
}

/**
 * 清空发布目录里的文件，目录本身留着：别的进程（文件监视、杀毒 / DLP 扫描）占着目录句柄时，在 Windows 上删目录本身会 EPERM
 * （删到一半就停，发布目录残缺）
 */
function emptyDir(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) emptyDir(full);
    else rmSync(full, { force: true });
  }
}

function folderSize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? folderSize(full) : statSync(full).size;
  }
  return total;
}

/** Every texture URL in scenes and meshes must exist in the published folder. */
function verifyReferences() {
  const missing = [];
  const textures = new Set(readdirSync(join(TARGET, 'textures')));
  for (const file of readdirSync(join(TARGET, 'scenes'))) {
    const text = readFileSync(join(TARGET, 'scenes', file), 'utf8');
    for (const match of text.matchAll(/assets\/unity-levels\/textures\/([^"]+)"/g)) if (!textures.has(match[1])) missing.push(`${file}: ${match[1]}`);
    for (const match of text.matchAll(/assets\/unity-levels\/meshes\/([^"]+)"/g)) if (!existsSync(join(TARGET, 'meshes', match[1]))) missing.push(`${file}: ${match[1]}`);
  }
  for (const file of readdirSync(join(TARGET, 'meshes'))) {
    const { json } = readGlb(readFileSync(join(TARGET, 'meshes', file)));
    for (const image of json.images ?? []) if (image.uri && !textures.has(basename(image.uri))) missing.push(`${file}: ${image.uri}`);
  }
  if (missing.length) throw new Error(`发布目录缺文件：\n${missing.slice(0, 20).join('\n')}`);
}

/** --check: the published folder was built from the current raw export (same file set, same scene docs). */
function check() {
  const problems = [];
  const sourceScenes = readdirSync(join(SOURCE, 'scenes'));
  for (const file of sourceScenes) {
    const target = join(TARGET, 'scenes', file);
    if (!existsSync(target)) { problems.push(`缺场景 ${file}`); continue; }
    const expected = rewriteSceneTextures(readFileSync(join(SOURCE, 'scenes', file), 'utf8'));
    if (expected !== readFileSync(target, 'utf8')) problems.push(`场景过期 ${file}`);
  }
  const sourceMeshes = new Set(readdirSync(join(SOURCE, 'meshes')));
  const targetMeshes = new Set(readdirSync(join(TARGET, 'meshes')));
  for (const name of sourceMeshes) if (!targetMeshes.has(name)) problems.push(`缺网格 ${name}`);
  for (const name of targetMeshes) if (!sourceMeshes.has(name)) problems.push(`多余网格 ${name}`);
  const sourceTextures = new Set(readdirSync(join(SOURCE, 'textures')).map(name => textureName(name)));
  const targetTextures = new Set(readdirSync(join(TARGET, 'textures')));
  for (const name of sourceTextures) if (!targetTextures.has(name)) problems.push(`缺贴图 ${name}`);
  if (hashFile(join(SOURCE, 'manifest.json')) !== hashFile(join(TARGET, 'manifest.json'))) problems.push('manifest 过期');
  if (problems.length) {
    console.error(problems.slice(0, 30).join('\n'));
    process.exit(1);
  }
  console.log('unity-levels 发布目录与原样导出一致');
}

await main();
