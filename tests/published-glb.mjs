// 读已发布 GLB 的测试辅助：照文件实际声明的方式解码几何，不假设压缩格式、也不假设有几级 LOD。
//
// 现行发布契约（art/README.md、art/pipeline/pipeline.toml，2026-10-25 起）：每个资产只有一级 LOD
// （节点 `<资产ID>_LOD0`，清单 lodDistance = [0]），成品网格原样发布、不减面；面数只记录、不是闸门。
// 管线导出的几何是 Draco（`[export] draco = true`），少数程序化 / 外部来源的资产不压缩；
// public/assets/unity-levels 下的关卡网格是 meshopt。这里三种都能读，由每个图元自己的扩展决定走哪条。
//
// 不写、不改任何资产。art/tools/pose_geometry_audit.mjs 的 loadPublishedMesh 只认 Draco 且按网格序号取，
// art/tools/setdressing_geometry.mjs 的 loadSetdressing 写死读三级 LOD——所以资产测试改用这里的读取器。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** 现行契约下每个发布资产该有的 LOD 节点序号。 */
export const PUBLISHED_LODS = Object.freeze([0]);

let manifestCache;
export function publishedManifest() {
  return manifestCache ??= JSON.parse(fs.readFileSync(path.join(repository, 'public/assets/manifest.json'), 'utf8')).assets;
}

let dracoModule;
async function draco() {
  if (dracoModule) return dracoModule;
  const file = path.join(repository, 'node_modules/three/examples/jsm/libs/draco/draco_decoder.js');
  const sandbox = { module: { exports: {} }, exports: {}, require, process, console, Buffer, TextDecoder, WebAssembly,
    __dirname: path.dirname(file), __filename: file, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return dracoModule = await sandbox.module.exports();
}

let meshoptModule;
async function meshopt() {
  if (meshoptModule) return meshoptModule;
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  await MeshoptDecoder.ready;
  return meshoptModule = MeshoptDecoder;
}

/** GLB 容器 → { document, bin }；头、长度、两个块的类型都校验。 */
export function parseGlb(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error('not a glTF 2 binary');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB length header does not match the file size');
  const length = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  const binStart = 20 + length;
  let bin = Buffer.alloc(0);
  if (binStart < bytes.length) {
    if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error('second GLB chunk is not BIN');
    bin = bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart));
  }
  return { document, bin };
}

/** 节点的世界矩阵（沿父链累乘；资产的 LOD 节点常挂在带变换的根下）。 */
export function nodeWorldMatrix(document, index) {
  const node = document.nodes[index];
  const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
  const parent = document.nodes.findIndex(n => n.children?.includes(index));
  return parent < 0 ? local : nodeWorldMatrix(document, parent).multiply(local);
}

/** 文件里实际存在的 `<id>_LOD<n>` 网格节点，按 n 升序。发布了几级就返回几级，不补不猜。 */
export function lodNodes(document, id) {
  const out = [];
  for (const [index, node] of (document.nodes ?? []).entries()) {
    const match = node.mesh !== undefined && node.name?.startsWith(`${id}_LOD`) ? /^(\d+)$/.exec(node.name.slice(id.length + 4)) : null;
    if (match) out.push({ lod: Number(match[1]), index, node });
  }
  return out.sort((a, b) => a.lod - b.lod);
}

/** 图元实际用的几何压缩：'draco' | 'meshopt' | 'none'。 */
export function primitiveCompression(document, primitive) {
  if (primitive.extensions?.KHR_draco_mesh_compression) return 'draco';
  const accessors = [...Object.values(primitive.attributes), ...(primitive.indices !== undefined ? [primitive.indices] : [])];
  const packed = accessors.some(a => document.bufferViews?.[document.accessors[a].bufferView]?.extensions?.EXT_meshopt_compression);
  return packed ? 'meshopt' : 'none';
}

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

async function bufferViewBytes(document, bin, index) {
  const view = document.bufferViews[index], packed = view.extensions?.EXT_meshopt_compression;
  if (!packed) {
    if ((view.buffer ?? 0) !== 0) throw new Error('GLB with external buffers');
    return { bytes: bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), stride: view.byteStride };
  }
  const decoder = await meshopt();
  const source = bin.subarray(packed.byteOffset ?? 0, (packed.byteOffset ?? 0) + packed.byteLength);
  const target = new Uint8Array(packed.count * packed.byteStride);
  decoder.decodeGltfBuffer(target, packed.count, packed.byteStride, source, packed.mode, packed.filter ?? 'NONE');
  return { bytes: Buffer.from(target.buffer), stride: packed.byteStride };
}

async function readAccessor(document, bin, index, asFloat) {
  const accessor = document.accessors[index], Type = COMPONENTS[accessor.componentType], width = WIDTH[accessor.type];
  if (accessor.sparse) throw new Error('sparse accessors are not published by this pipeline');
  const { bytes, stride } = await bufferViewBytes(document, bin, accessor.bufferView);
  const step = stride ?? Type.BYTES_PER_ELEMENT * width, offset = accessor.byteOffset ?? 0;
  const out = asFloat ? new Float32Array(accessor.count * width) : new Uint32Array(accessor.count * width);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType];
  const scale = asFloat && accessor.normalized ? NORMALIZE[accessor.componentType] : 0;
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < width; k++) {
    const value = view[get](offset + i * step + k * Type.BYTES_PER_ELEMENT, true);
    out[i * width + k] = scale ? Math.max(value / scale, -1) : value;
  }
  return out;
}

/**
 * 解一个图元：{ attrs: { POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 … }（Float32Array）, idx: Uint32Array, compression }。
 * 形状与 art/tools/pose_geometry_audit.mjs 的 loadPublishedMesh 相同，可以直接交给那边的蒙皮 / 姿势函数。
 */
export async function decodePrimitive(document, bin, primitive) {
  const compression = primitiveCompression(document, primitive), attrs = {};
  if (compression !== 'draco') {
    for (const [semantic, accessor] of Object.entries(primitive.attributes)) attrs[semantic] = await readAccessor(document, bin, accessor, true);
    const idx = primitive.indices !== undefined ? await readAccessor(document, bin, primitive.indices, false)
      : Uint32Array.from({ length: attrs.POSITION.length / 3 }, (_, i) => i);
    return { attrs, idx, compression };
  }
  const codec = await draco(), ext = primitive.extensions.KHR_draco_mesh_compression, view = document.bufferViews[ext.bufferView];
  const input = new Int8Array(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0), view.byteLength);
  const buffer = new codec.DecoderBuffer(); buffer.Init(input, input.byteLength);
  const decoder = new codec.Decoder(), mesh = new codec.Mesh(), status = decoder.DecodeBufferToMesh(buffer, mesh);
  try {
    if (!status.ok()) throw new Error(status.error_msg());
    for (const [semantic, uid] of Object.entries(ext.attributes)) {
      const attribute = decoder.GetAttributeByUniqueId(mesh, uid), floats = new codec.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(mesh, attribute, floats);
      const out = new Float32Array(mesh.num_points() * attribute.num_components());
      for (let i = 0; i < out.length; i++) out[i] = floats.GetValue(i);
      attrs[semantic] = out; codec.destroy(floats);
    }
    const idx = new Uint32Array(mesh.num_faces() * 3), face = new codec.DracoInt32Array();
    for (let i = 0; i < mesh.num_faces(); i++) { decoder.GetFaceFromMesh(mesh, i, face); for (let k = 0; k < 3; k++) idx[i * 3 + k] = face.GetValue(k); }
    codec.destroy(face);
    return { attrs, idx, compression };
  } finally { codec.destroy(buffer); codec.destroy(mesh); codec.destroy(decoder); }
}

/** 位置（+ 法线 / UV）与索引 → BufferGeometry，带包围盒。位置和法线是拷贝：调用方可以 applyMatrix4，不会改到 loadPublished 缓存的解码结果。 */
export function toGeometry(decoded) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION.slice(), 3));
  if (decoded.attrs.NORMAL) geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.attrs.NORMAL.slice(), 3));
  if (decoded.attrs.TEXCOORD_0) geometry.setAttribute('uv', new THREE.BufferAttribute(decoded.attrs.TEXCOORD_0, 2));
  geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1));
  geometry.computeBoundingBox();
  return geometry;
}

/** 任意 GLB 文件（仓库相对路径）→ 解析后的文档与它实际带的每一级 LOD。 */
export async function loadGlbLods(file, id) {
  const bytes = fs.readFileSync(path.resolve(repository, file)), { document, bin } = parseGlb(bytes);
  const lods = [];
  for (const { lod, index, node } of lodNodes(document, id)) {
    const primitives = [];
    for (const primitive of document.meshes[node.mesh].primitives)
      primitives.push({ ...await decodePrimitive(document, bin, primitive), material: primitive.material, source: primitive });
    lods.push({ lod, name: node.name, nodeIndex: index, meshIndex: node.mesh, matrix: nodeWorldMatrix(document, index), primitives,
      triangles: primitives.reduce((sum, p) => sum + p.idx.length / 3, 0),
      boneNames: node.skin !== undefined ? document.skins[node.skin].joints.map(j => document.nodes[j].name) : [] });
  }
  return { id, file, bytes, document, bin, lods };
}

const published = new Map();
/** 清单里的发布资产 → { id, entry, bytes, document, bin, lods }；同一进程内缓存（解码结果只读，不要改）。 */
export async function loadPublished(id) {
  if (published.has(id)) return published.get(id);
  const entry = publishedManifest()[id];
  if (!entry) throw new Error(`${id}: not in public/assets/manifest.json`);
  const asset = { ...await loadGlbLods(`public/${entry.url}`, id), entry };
  published.set(id, asset);
  return asset;
}

/**
 * 现行契约的结构检查，返回违反项（空数组 = 合格）：
 * 清单 lodDistance = [0]；文件里只有 `<id>_LOD0` 一级；这一级有三角面；几何压缩是运行时装载器读得了的
 * （src/assets/AssetLibrary.ts 只挂了 DRACOLoader，没有 meshopt 解码器），并且文件声明的扩展和图元实际用的对得上。
 */
export function singleLodViolations(asset) {
  const out = [], { id, entry, document, lods } = asset;
  if (JSON.stringify(entry.lodDistance) !== JSON.stringify(PUBLISHED_LODS)) out.push(`${id}: manifest lodDistance ${JSON.stringify(entry.lodDistance)}, expected [0]`);
  if (JSON.stringify(lods.map(l => l.lod)) !== JSON.stringify(PUBLISHED_LODS)) out.push(`${id}: published LOD nodes ${JSON.stringify(lods.map(l => l.name))}, expected only ${id}_LOD0`);
  const stray = (document.nodes ?? []).filter(n => /_LOD[1-9]\d*$/.test(n.name ?? '')).map(n => n.name);
  if (stray.length) out.push(`${id}: far-LOD nodes are still published: ${stray}`);
  for (const lod of lods) {
    if (!(lod.triangles > 0)) out.push(`${lod.name}: no triangles`);
    for (const primitive of lod.primitives) {
      if (primitive.compression === 'meshopt') out.push(`${lod.name}: EXT_meshopt_compression geometry, which AssetLibrary cannot decode`);
      if (!primitive.attrs.POSITION?.every(Number.isFinite)) out.push(`${lod.name}: non-finite positions`);
    }
  }
  const declared = new Set(document.extensionsUsed ?? []), used = new Set(lods.flatMap(l => l.primitives.map(p => p.compression)));
  if (used.has('draco') !== declared.has('KHR_draco_mesh_compression')) out.push(`${id}: extensionsUsed and the primitives disagree about Draco`);
  if (used.has('draco') && !(document.extensionsRequired ?? []).includes('KHR_draco_mesh_compression')) out.push(`${id}: Draco geometry without extensionsRequired`);
  return out;
}
