#!/usr/bin/env node
// 一次性转换（2026-11-26，去 Unity 依赖 S1）：入库的 Unity 导出 public/assets/unity-levels → 网页自己的关卡数据目录 public/assets/levels。
// 用户：「不能有任何依赖unity的代码」「以后unity是要删除的」。只读入库的导出物，不需要 Unity 编辑器；转完这个脚本就删（git 历史里留着）。
//
//   node scripts/once/levels-convert.mjs            重写 public/assets/levels 和 src/world/level/catalog.ts
//   node scripts/once/levels-convert.mjs --verify   只核对（新旧逐项深比较、碰撞逐顶点比、每个改写过的 GLB 用 three 的 GLTFLoader 读一遍），不写文件
//
// 产出（布局见 docs 里的去 Unity 方案 targetLayout 第一节）：
//   levels/<id>/level.json      场景文档（schema 3）：去掉 scene（Assets/Scenes/*.unity，没人读）；网格 / 贴图地址改到 levels/；
//                               有网格的碰撞体去掉 url、改成 mesh: 'c<序号>'（序号 = 它在 colliders 里的下标），文档加 collision；
//                               机关段（原 mechanisms.json 里这一关的）并进 mechanisms，去掉来源字段 scene / source / sceneSha1、
//                               软边界的 asset / sha1，软边界地址改到 levels/<id>/boundary.f32；小地图改到 levels/<id>/map.webp
//   levels/<id>/collision.glb   本关全部网格碰撞合成一份（每个碰撞体一个节点 c<序号>）；镜像离线烘掉：按旧的 colliderNeedsMirror
//                               规则（src/world/UnityColliderFrame.ts）判断，x 取反并交换绕序，之后运行时不再猜；meshopt 重新压缩
//   levels/<id>/boundary.f32    软边界距离场，字节不变（仍按 Unity 坐标存，运行时按 −x 采样；翻坐标留给 P5）
//   levels/<id>/map.webp        俯视小地图，字节不变
//   levels/meshes/m_*.glb       渲染件 / 植被 / 草皮原型：BIN 块逐字节不变，只改 JSON 块——
//                               材质 extras unityShader / unityFloats / unityColors / unityVectors → shader / floats / colors / vectors；
//                               熔岩材质的顶点属性 _UNITY_INFO / _UNITY_FLOW → _LAVA_INFO / _LAVA_FLOW；
//                               其余材质上的 _UNITY_INFO（Unity UV1 原样导出成 vec4：xy = TEXCOORD_1、zw = 0，没人读）从图元上摘掉；
//                               asset.generator → levels-convert
//   levels/textures/t_*.webp    字节不变（GLB 用 ../textures/ 相对引用，所以和 meshes/ 同级）
//   src/world/level/catalog.ts  关卡目录（替代 manifest.json）
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'public/assets/unity-levels');
const OUT = join(ROOT, 'public/assets/levels');
const CATALOG = join(ROOT, 'src/world/level/catalog.ts');
const VERIFY = process.argv.includes('--verify');
const OLD = 'assets/unity-levels/';
const NEW = 'assets/levels/';
const GENERATOR = 'levels-convert';

const { parseGlb, decodePrimitive } = await import(pathToFileURL(join(ROOT, 'tests/published-glb.mjs')).href);
const { colliderNeedsMirror, mirrorColliderX } = await import(pathToFileURL(join(ROOT, 'src/world/UnityColliderFrame.ts')).href);

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const manifest = readJson(join(SRC, 'manifest.json'));
const mechanisms = readJson(join(SRC, 'mechanisms.json'));
const stages = manifest.stages.filter(stage => stage.available);
const scenes = new Map(stages.map(stage => [stage.id, readJson(join(ROOT, 'public', stage.url))]));

// ───────────── GLB 读写 ─────────────

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

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

/** GLB 的 BIN 块（含块头），改 JSON 块时原样接回 */
function binChunkBytes(bytes) {
  const binStart = 20 + bytes.readUInt32LE(12);
  return binStart < bytes.length ? bytes.subarray(binStart) : Buffer.alloc(0);
}

function rewriteJsonChunk(bytes, json) {
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const tail = binChunkBytes(bytes);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + jsonChunk.length + tail.length, 8);
  head.writeUInt32LE(jsonChunk.length, 12); head.writeUInt32LE(CHUNK_JSON, 16);
  return Buffer.concat([head, jsonChunk, tail]);
}

const EXTRAS = { unityShader: 'shader', unityFloats: 'floats', unityColors: 'colors', unityVectors: 'vectors' };
const LAVA_ATTRS = { _UNITY_INFO: '_LAVA_INFO', _UNITY_FLOW: '_LAVA_FLOW' };
const isLava = (json, primitive) => json.materials?.[primitive.material]?.extras?.unityShader === 'Spiritfire/Lava';

/** 渲染 GLB 的 JSON 块：extras 键去 unity 前缀；熔岩属性改名，其余材质上的 _UNITY_INFO 摘掉；generator 改名 */
function convertRenderJson(source) {
  const json = structuredClone(source);
  json.asset = { ...json.asset, generator: GENERATOR };
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    const lava = isLava(source, primitive);
    const attributes = {};
    for (const [name, accessor] of Object.entries(primitive.attributes)) {
      if (name in LAVA_ATTRS) {
        if (lava) attributes[LAVA_ATTRS[name]] = accessor;
        else if (name === '_UNITY_FLOW') throw new Error(`非熔岩材质上有 _UNITY_FLOW`);
        continue;
      }
      attributes[name] = accessor;
    }
    primitive.attributes = attributes;
  }
  for (const material of json.materials ?? []) {
    if (!material.extras) continue;
    const extras = {};
    for (const [key, value] of Object.entries(material.extras)) {
      if (!(key in EXTRAS)) throw new Error(`没见过的材质 extras 键 ${key}`);
      extras[EXTRAS[key]] = value;
    }
    material.extras = extras;
  }
  return json;
}

// ───────────── 碰撞：解码、镜像、合并、meshopt 压缩 ─────────────

/** 旧的单个碰撞 GLB → 网页坐标的 { positions, indices }（照旧运行时：遍历全部网格，忽略节点变换——导出的都是单位变换，--verify 查） */
async function legacyCollider(collider) {
  const { document, bin } = parseGlb(readFileSync(join(ROOT, 'public', collider.url)));
  const positions = [], indices = [];
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    const { attrs, idx } = await decodePrimitive(document, bin, primitive);
    const base = positions.length / 3;
    for (const v of attrs.POSITION) positions.push(v);
    for (const i of idx) indices.push(base + i);
  }
  const p = new Float32Array(positions), ix = new Uint32Array(indices);
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < p.length; i += 3) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); }
  const mirrored = colliderNeedsMirror(minX, maxX, collider.min[0], collider.max[0]);
  if (mirrored) mirrorColliderX(p, ix);
  return { positions: p, indices: ix, mirrored, nodes: document.nodes ?? [] };
}

function encodeView(raw, count, size, mode, buffers) {
  const encoded = MeshoptEncoder.encodeGltfBuffer(raw, count, size, mode);
  if (encoded.length < raw.length) {
    const offset = buffers.data.reduce((s, b) => s + b.length, 0);
    buffers.data.push(pad4(Buffer.from(encoded), 0));
    const fallback = buffers.fallback;
    buffers.fallback += (raw.length + 3) & ~3;
    return { buffer: 1, byteOffset: fallback, byteLength: raw.length, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: encoded.length, byteStride: size, count, mode } } };
  }
  const offset = buffers.data.reduce((s, b) => s + b.length, 0);
  buffers.data.push(pad4(Buffer.from(raw), 0));
  return { buffer: 0, byteOffset: offset, byteLength: raw.length };
}

/** colliders: [{ name: 'c<序号>', positions, indices }] → 一份 GLB */
function collisionGlb(colliders) {
  const json = {
    asset: { version: '2.0', generator: GENERATOR },
    scene: 0, scenes: [{ name: 'collision', nodes: colliders.map((_, i) => i) }],
    nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
    extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'],
  };
  const buffers = { data: [], fallback: 0 };
  for (const [k, c] of colliders.entries()) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < c.positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], c.positions[i + a]); max[a] = Math.max(max[a], c.positions[i + a]); }
    const vertexCount = c.positions.length / 3;
    json.bufferViews.push({ ...encodeView(new Uint8Array(c.positions.buffer, c.positions.byteOffset, c.positions.byteLength), vertexCount, 12, 'ATTRIBUTES', buffers), target: 34962 });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: vertexCount, type: 'VEC3', min, max });
    const position = json.accessors.length - 1;
    json.bufferViews.push({ ...encodeView(new Uint8Array(c.indices.buffer, c.indices.byteOffset, c.indices.byteLength), c.indices.length, 4, 'TRIANGLES', buffers), target: 34963 });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5125, count: c.indices.length, type: 'SCALAR' });
    json.meshes.push({ name: c.name, primitives: [{ attributes: { POSITION: position }, indices: json.accessors.length - 1, mode: 4 }] });
    json.nodes.push({ name: c.name, mesh: k });
  }
  const bin = Buffer.concat(buffers.data);
  json.buffers.push({ byteLength: bin.length });
  if (json.bufferViews.some(view => view.extensions)) json.buffers.push({ byteLength: Math.max(buffers.fallback, 4), extensions: { EXT_meshopt_compression: { fallback: true } } });
  else { delete json.extensionsUsed; delete json.extensionsRequired; }
  return writeGlb(json, bin);
}

// ───────────── 场景文档 ─────────────

const mapUrl = id => `${NEW}${id}/map.webp`;
const collisionUrl = id => `${NEW}${id}/collision.glb`;
const boundaryUrl = id => `${NEW}${id}/boundary.f32`;
const levelUrl = id => `${NEW}${id}/level.json`;

/** 网格 / 贴图地址：assets/unity-levels/(meshes|textures)/X → assets/levels/(meshes|textures)/X */
function moveUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(OLD)) return value;
  const rest = value.slice(OLD.length);
  if (!/^(meshes|textures)\//.test(rest)) throw new Error(`没想到的地址 ${value}`);
  return NEW + rest;
}

function mapUrls(value) {
  if (Array.isArray(value)) return value.map(mapUrls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapUrls(v)]));
  return moveUrl(value);
}

function convertMechanisms(id) {
  const source = mechanisms.scenes[id];
  if (!source) return null;
  const { scene: _scene, source: _source, sceneSha1: _sha, ...rest } = structuredClone(source);
  if (rest.boundary) {
    const { asset: _asset, sha1: _sha1, ...boundary } = rest.boundary;
    if (boundary.url !== `${OLD}boundary/${id}.f32`) throw new Error(`${id} 软边界地址 ${boundary.url}`);
    rest.boundary = { ...boundary, url: boundaryUrl(id) };
  }
  return rest;
}

function convertDocument(id, doc) {
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'scene') continue;
    if (key === 'schema') { out.schema = 3; continue; }
    if (key === 'map') { out.map = { ...value, url: mapUrl(id) }; continue; }
    if (key === 'colliders') {
      out.colliders = value.map((collider, index) => Object.fromEntries(Object.entries(collider).map(([k, v]) => k === 'url' ? ['mesh', `c${index}`] : [k, v])));
      if (value.some(collider => collider.url)) out.collision = collisionUrl(id);
      continue;
    }
    out[key] = mapUrls(value);
  }
  const mech = convertMechanisms(id);
  if (mech) out.mechanisms = mech;
  return out;
}

/** 文档里引用的网格 / 贴图文件名 */
function documentFiles(doc) {
  const meshes = new Set(), textures = new Set();
  const add = url => {
    const m = /^assets\/unity-levels\/(meshes|textures)\/(.+)$/.exec(url ?? '');
    if (m) (m[1] === 'meshes' ? meshes : textures).add(m[2]);
  };
  for (const r of doc.renderers) {
    add(r.url);
    for (const layer of r.terrain?.layers ?? []) add(layer.url);
    for (const map of r.terrain?.alphamaps ?? []) add(map);
  }
  for (const p of doc.vegetation?.prototypes ?? []) add(p.url);
  for (const g of doc.groundCover ?? []) { add(g.url); add(g.texture); }
  for (const face of doc.environment?.sky?.cubemap ?? []) add(face);
  return { meshes, textures };
}

// ───────────── 关卡目录 ─────────────

function catalogSource() {
  const lines = manifest.stages.map(s => `  { id: '${s.id}', available: ${!!s.available}${s.pool ? ', pool: true' : ''} },`);
  return `/**
 * 关卡目录（网页的「构建设置」）：主线 16 关 + 每章的备选图（pool: true，每局路线洗牌时和本章主图一起抽）。
 * available = 关卡数据已在 public/assets/levels/<id>/level.json（{@link levelUrl}）；4-2 / 4-4 还没有。
 * 2026-11-26 去 Unity 依赖时由 Unity 导出的 manifest.json 一次性转来（之后这里就是源头，加图直接改这张表）。
 * 局路线只看 id / available / pool（StagePlan.setStageCatalog）；关卡名、章节、类型、奖励在 UnityStages.ts（R2 时并进来）。
 */
export interface LevelCatalogEntry {
  id: string;
  available: boolean;
  pool?: boolean;
}

export const LEVEL_CATALOG: readonly LevelCatalogEntry[] = [
${lines.join('\n')}
];

/** 一张图的关卡数据文件（相对站点根，不带 BASE_URL） */
export function levelUrl(id: string): string {
  return \`assets/levels/\${id}/level.json\`;
}
`;
}

// ───────────── 写 ─────────────

const allMeshes = new Set(), allTextures = new Set();
for (const doc of scenes.values()) {
  const files = documentFiles(doc);
  for (const m of files.meshes) allMeshes.add(m);
  for (const t of files.textures) allTextures.add(t);
}
// GLB 自己引用的贴图
for (const name of allMeshes) {
  const { document } = parseGlb(readFileSync(join(SRC, 'meshes', name)));
  for (const image of document.images ?? []) {
    if (!image.uri) continue;
    if (!image.uri.startsWith('../textures/')) throw new Error(`${name}: 贴图地址 ${image.uri}`);
    allTextures.add(image.uri.slice('../textures/'.length));
  }
}

async function write() {
  await MeshoptEncoder.ready;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'meshes'), { recursive: true });
  mkdirSync(join(OUT, 'textures'), { recursive: true });
  let mirrored = 0, colliderCount = 0;
  for (const [id, doc] of scenes) {
    mkdirSync(join(OUT, id), { recursive: true });
    const colliders = [];
    for (const [index, collider] of doc.colliders.entries()) {
      if (!collider.url) continue;
      const c = await legacyCollider(collider);
      if (c.mirrored) mirrored++;
      colliders.push({ name: `c${index}`, positions: c.positions, indices: c.indices });
    }
    colliderCount += colliders.length;
    if (colliders.length) writeFileSync(join(OUT, id, 'collision.glb'), collisionGlb(colliders));
    writeFileSync(join(OUT, id, 'level.json'), JSON.stringify(convertDocument(id, doc)));
    cpSync(join(ROOT, 'public', doc.map.url), join(OUT, id, 'map.webp'));
    const boundary = mechanisms.scenes[id]?.boundary;
    if (boundary) cpSync(join(ROOT, 'public', boundary.url), join(OUT, id, 'boundary.f32'));
    console.log(`${id}: 碰撞 ${colliders.length} 个`);
  }
  for (const name of allMeshes) {
    const bytes = readFileSync(join(SRC, 'meshes', name));
    const { document } = parseGlb(bytes);
    writeFileSync(join(OUT, 'meshes', name), rewriteJsonChunk(bytes, convertRenderJson(document)));
  }
  for (const name of allTextures) cpSync(join(SRC, 'textures', name), join(OUT, 'textures', name));
  mkdirSync(dirname(CATALOG), { recursive: true });
  writeFileSync(CATALOG, catalogSource());
  console.log(`${scenes.size} 张图；碰撞 ${colliderCount} 个（镜像烘掉 ${mirrored} 个）；渲染网格 ${allMeshes.size} 个；贴图 ${allTextures.size} 张`);
}

// ───────────── 核对 ─────────────

const problems = [];
const fail = message => { problems.push(message); if (problems.length <= 40) console.log('✖', message); };

/** 两份 JSON 的差异路径（值不同 / 只在一边有） */
function diffPaths(a, b, path = '', out = []) {
  if (isDeepStrictEqual(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) { out.push({ path, a, b }); return out; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push({ path, a, b });
  return out;
}

function verifyDocument(id, oldDoc, newDoc) {
  for (const d of diffPaths(oldDoc, newDoc)) {
    const p = d.path;
    if (p === 'scene' && d.b === undefined) continue;
    if (p === 'schema' && d.b === 3) continue;
    if (p === 'collision' && d.a === undefined && d.b === collisionUrl(id)) continue;
    if (p === 'mechanisms' && d.a === undefined) continue;
    if (p === 'map.url' && d.b === mapUrl(id)) continue;
    if (typeof d.a === 'string' && d.a.startsWith(OLD) && d.b === moveUrl(d.a) && !p.startsWith('colliders.')) continue;
    const m = /^colliders\.(\d+)\.(url|mesh)$/.exec(p);
    if (m) {
      const old = oldDoc.colliders[+m[1]], neu = newDoc.colliders[+m[1]];
      if (old.url && neu.url === undefined && neu.mesh === `c${m[1]}`) continue;
    }
    fail(`${id}/level.json ${p}: ${JSON.stringify(d.a)?.slice(0, 80)} → ${JSON.stringify(d.b)?.slice(0, 80)}`);
  }
  // 机关段：和 mechanisms.json 里这一关的比，只差去掉的来源字段和软边界地址
  const oldMech = mechanisms.scenes[id];
  if (!oldMech !== !newDoc.mechanisms) fail(`${id}: 机关段有无不一致`);
  if (oldMech && newDoc.mechanisms) {
    for (const d of diffPaths(oldMech, newDoc.mechanisms)) {
      if (['scene', 'source', 'sceneSha1', 'boundary.asset', 'boundary.sha1'].includes(d.path) && d.b === undefined) continue;
      if (d.path === 'boundary.url' && d.b === boundaryUrl(id)) continue;
      fail(`${id} mechanisms ${d.path}: ${JSON.stringify(d.a)?.slice(0, 80)} → ${JSON.stringify(d.b)?.slice(0, 80)}`);
    }
  }
}

/** three 的 GLTFLoader 读一遍（贴图换成空贴图：Node 里没有 Image）；返回 gltf */
let loaderPromise = null;
async function gltfLoader() {
  loaderPromise ??= (async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.register(() => ({ name: 'stub-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    return { loader, THREE };
  })();
  return loaderPromise;
}
async function loadWithThree(bytes) {
  const { loader } = await gltfLoader();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
}

async function verify() {
  // 关卡目录
  if (!existsSync(CATALOG)) fail('没有 src/world/level/catalog.ts');
  else {
    const { LEVEL_CATALOG } = await import(pathToFileURL(CATALOG).href);
    const want = manifest.stages.map(s => ({ id: s.id, available: !!s.available, ...(s.pool ? { pool: true } : {}) }));
    if (!isDeepStrictEqual(LEVEL_CATALOG.map(e => ({ ...e })), want)) fail('catalog.ts 和 manifest.json 对不上');
  }
  let colliders = 0, vertices = 0;
  for (const [id, oldDoc] of scenes) {
    const dir = join(OUT, id);
    if (!existsSync(join(dir, 'level.json'))) { fail(`${id}: 没有 level.json`); continue; }
    const newDoc = readJson(join(dir, 'level.json'));
    verifyDocument(id, oldDoc, newDoc);
    if (sha1(readFileSync(join(dir, 'map.webp'))) !== sha1(readFileSync(join(ROOT, 'public', oldDoc.map.url)))) fail(`${id}: map.webp 字节变了`);
    const b = mechanisms.scenes[id]?.boundary;
    if (b) {
      const bytes = readFileSync(join(dir, 'boundary.f32'));
      if (sha1(bytes) !== b.sha1 || sha1(bytes) !== sha1(readFileSync(join(ROOT, 'public', b.url)))) fail(`${id}: boundary.f32 字节变了`);
    } else if (existsSync(join(dir, 'boundary.f32'))) fail(`${id}: 多出 boundary.f32`);
    // 碰撞：旧 GLB 解码 + 按旧规则镜像，和 collision.glb 里对应节点逐顶点、逐索引比（published-glb 读取器 + three 的 GLTFLoader 各读一遍）
    const meshColliders = oldDoc.colliders.map((c, index) => ({ c, index })).filter(x => x.c.url);
    if (!meshColliders.length) continue;
    const bytes = readFileSync(join(dir, 'collision.glb'));
    const { document, bin } = parseGlb(bytes);
    const gltf = await loadWithThree(bytes);
    const byName = new Map();
    gltf.scene.traverse(o => { if (o.isMesh) byName.set(o.name, o); });
    if (document.nodes.length !== meshColliders.length || byName.size !== meshColliders.length) fail(`${id}: 碰撞节点 ${document.nodes.length} / three ${byName.size}，带 mesh 的碰撞体 ${meshColliders.length}`);
    for (const { c, index } of meshColliders) {
      const expected = await legacyCollider(c);
      for (const n of expected.nodes) if (n.matrix || n.translation || n.rotation || n.scale) fail(`${id}/${c.name}: 旧碰撞 GLB 的节点带变换`);
      const nodeIndex = document.nodes.findIndex(n => n.name === `c${index}`);
      if (nodeIndex < 0) { fail(`${id}: collision.glb 里没有 c${index}`); continue; }
      const { attrs, idx } = await decodePrimitive(document, bin, document.meshes[document.nodes[nodeIndex].mesh].primitives[0]);
      const mesh = byName.get(`c${index}`);
      const threePos = mesh?.geometry.getAttribute('position')?.array, threeIdx = mesh?.geometry.getIndex()?.array;
      const same = (got, want, eps) => got && got.length === want.length && want.every((v, i) => Math.abs(got[i] - v) <= eps);
      // meshopt 的三角形索引编码会在三角形内部轮换顶点（绕序不变）：逐个三角形比，允许 (a b c) / (b c a) / (c a b)，不允许反绕
      const sameTriangles = (got, want) => got && got.length === want.length && want.every((_, i) => {
        if (i % 3) return true;
        const [a, b, c] = [want[i], want[i + 1], want[i + 2]], [x, y, z] = [got[i], got[i + 1], got[i + 2]];
        return (x === a && y === b && z === c) || (x === b && y === c && z === a) || (x === c && y === a && z === b);
      });
      if (!same(attrs.POSITION, expected.positions, 1e-4) || !same(threePos, expected.positions, 1e-4)) fail(`${id}/c${index}（${c.name}）：顶点对不上`);
      if (!sameTriangles(idx, expected.indices) || !sameTriangles(threeIdx, expected.indices)) fail(`${id}/c${index}（${c.name}）：三角形 / 绕序对不上`);
      // 落在文档的 AABB 上（文档 AABB 是 Unity Collider.bounds，比网格宽 1–3 m：网格要在它里面，并盖住它一半以上的宽度）
      const acc = document.accessors[document.meshes[document.nodes[nodeIndex].mesh].primitives[0].attributes.POSITION];
      const width = c.max[0] - c.min[0];
      if (!(acc.min[0] >= c.min[0] - 1 && acc.max[0] <= c.max[0] + 1 && acc.max[0] - acc.min[0] >= width * 0.5)) fail(`${id}/c${index}：网格 x ${acc.min[0].toFixed(1)}…${acc.max[0].toFixed(1)} 不在文档 AABB ${c.min[0].toFixed(1)}…${c.max[0].toFixed(1)} 上`);
      colliders++;
      vertices += expected.positions.length / 3;
    }
  }
  // 渲染 GLB：BIN 块逐字节相同、JSON 块只差改名的键；three 读一遍，属性 / 材质标记是新名字
  const want = new Set([...allMeshes]);
  const have = new Set(readdirSync(join(OUT, 'meshes')));
  for (const name of want) if (!have.has(name)) fail(`levels/meshes 缺 ${name}`);
  for (const name of have) if (!want.has(name)) fail(`levels/meshes 多出 ${name}`);
  let lavaPrims = 0, strippedInfo = 0;
  for (const name of want) {
    if (!have.has(name)) continue;
    const oldBytes = readFileSync(join(SRC, 'meshes', name)), newBytes = readFileSync(join(OUT, 'meshes', name));
    if (!binChunkBytes(oldBytes).equals(binChunkBytes(newBytes))) fail(`${name}: BIN 块变了`);
    const a = parseGlb(oldBytes).document, b = parseGlb(newBytes).document;
    for (const d of diffPaths(a, b)) {
      if (d.path === 'asset.generator' && d.b === GENERATOR) continue;
      const ex = /^materials\.(\d+)\.extras\.(\w+)$/.exec(d.path);
      if (ex) {
        const extras = a.materials[+ex[1]].extras;
        if (d.b === undefined && ex[2] in EXTRAS && isDeepStrictEqual(extras[ex[2]], b.materials[+ex[1]].extras[EXTRAS[ex[2]]])) continue;
        if (d.a === undefined && Object.entries(EXTRAS).some(([o, n]) => n === ex[2] && isDeepStrictEqual(extras[o], d.b))) continue;
      }
      const at = /^meshes\.(\d+)\.primitives\.(\d+)\.attributes\.(\w+)$/.exec(d.path);
      if (at) {
        const prim = a.meshes[+at[1]].primitives[+at[2]], lava = isLava(a, prim), nb = b.meshes[+at[1]].primitives[+at[2]].attributes;
        if (lava && at[3] in LAVA_ATTRS && d.b === undefined && nb[LAVA_ATTRS[at[3]]] === d.a) continue;
        if (lava && Object.values(LAVA_ATTRS).includes(at[3]) && d.a === undefined) continue;
        if (!lava && at[3] === '_UNITY_INFO' && d.b === undefined) { strippedInfo++; continue; }
      }
      fail(`${name} ${d.path}: ${JSON.stringify(d.a)?.slice(0, 60)} → ${JSON.stringify(d.b)?.slice(0, 60)}`);
    }
    const gltf = await loadWithThree(newBytes);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const names = Object.keys(o.geometry.attributes);
      if (names.some(n => /unity/i.test(n))) fail(`${name}/${o.name}: three 读出的属性还带 unity：${names}`);
      for (const m of [].concat(o.material)) {
        if (Object.keys(m.userData).some(k => /unity/i.test(k))) fail(`${name}/${o.name}: 材质 userData 还带 unity 键`);
        if (m.userData.shader === 'Spiritfire/Lava') {
          lavaPrims++;
          if (!o.geometry.attributes._lava_info || !o.geometry.attributes._lava_flow) fail(`${name}/${o.name}: 熔岩没有 _lava_info / _lava_flow`);
        }
      }
    });
  }
  // 贴图
  const texHave = new Set(readdirSync(join(OUT, 'textures')));
  for (const name of allTextures) {
    if (!texHave.has(name)) { fail(`levels/textures 缺 ${name}`); continue; }
    if (sha1(readFileSync(join(SRC, 'textures', name))) !== sha1(readFileSync(join(OUT, 'textures', name)))) fail(`${name}: 贴图字节变了`);
  }
  for (const name of texHave) if (!allTextures.has(name)) fail(`levels/textures 多出 ${name}`);
  // 新文档里的地址都在 assets/levels/ 下且文件存在
  for (const id of scenes.keys()) {
    const text = readFileSync(join(OUT, id, 'level.json'), 'utf8');
    if (text.includes('unity-levels')) fail(`${id}/level.json 还有 unity-levels`);
    for (const m of text.matchAll(/"(assets\/[^"]+)"/g)) if (!m[1].startsWith(NEW) || !existsSync(join(ROOT, 'public', m[1]))) fail(`${id}: ${m[1]} 不在 levels/ 下或文件不存在`);
  }
  console.log(`核对：${scenes.size} 张图，碰撞 ${colliders} 个 / ${vertices} 个顶点，渲染网格 ${want.size} 个（熔岩图元 ${lavaPrims}、摘掉非熔岩 _UNITY_INFO ${strippedInfo}），贴图 ${allTextures.size} 张`);
  console.log(problems.length ? `✖ ${problems.length} 处不对` : '✔ public/assets/levels 和 Unity 导出逐项一致');
  process.exit(problems.length ? 1 : 0);
}

if (VERIFY) await verify();
else await write();
