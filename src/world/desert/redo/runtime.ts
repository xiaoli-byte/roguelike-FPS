import * as THREE from 'three';
import { UnityLevelLibrary, type UnitySceneDocument } from '../../UnityLevelLibrary';
import { createUnityTerrainMesh } from '../../UnityTerrainMesh';
import { createUnityWaterMaterial } from '../../UnityWaterMaterial';
import { createStylizedLit } from '../../UnityStylizedLit';
import { createFarLayer } from '../farLayer';
import { setStylizedEnvironment, stylizeTerrain, terrainStyle } from '../../UnityStylizedLit';
import { provideBoundaryField } from '../../mechanisms/MechanismData';
import { WHITEBOXES } from '../whitebox';
import { buildDeadPoplars, buildPoplars } from '../pieces/flora';
import { buildCamelBones } from '../pieces/bones';
import { redoFx } from './fx';
import { REDO_FX } from './fxMaps';
import type { BuiltPiece, PieceBox, PieceContext } from '../pieces/types';
import type { DesertMapArt, DesertPart } from '../spec';
import { MARGIN, boundaryUrl, compileWhitebox, redoLight, type CompiledMap, type PieceRequest } from './compile';
import { REDO_MAPS } from './maps';
import type { VolumeOverrides } from '../../../render/UrpVolume';
import { patchDesertDocument } from '../document';

/**
 * 第一章重做的运行时：进关前（StageDirector → desertDocument / prepareDesertArt）把白盒编成场景文档、建好新做的件，
 * 场景文档整份由这里给（redoDocument），场景搭好后（build）铺地形网格、挂新件；机关数据（mechanisms）也整份由编译器生成。
 * 不读 Unity 导出的任何东西（用户 2026-11-26：「以后unity是要删除的」）：玩法数据在 play.ts，地形贴图在 public/assets/desert/terrain。
 */

/** 地形四层贴图（起伏沙 / 黑戈壁砾石 / 龟裂土 / 赭红岩层，从旧沙漠地形搬到第一章自己的目录）和每张盖多少米 */
/**
 * 地形四层贴图的调色（饱和度倍率、明度倍率）：照构图概念图——能走的砾石地、土路是去了饱和的灰褐，
 * 只有沙丘的沙保留暖黄（原贴图整片又橙又艳，2026-11-27 逐图还原时压的）
 */
const LAYER_TONE: [number, number][] = [[0.95, 0.97], [0.25, 0.78], [0.5, 0.9], [0.85, 1]];

/** 贴图在 canvas 上按亮度往灰里收（sat）、整体压暗（val），出一张新贴图（原图是缓存里共用的，不改它） */
function toneTexture(src: THREE.Texture, sat: number, val: number): THREE.Texture {
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width || typeof document === 'undefined' || (sat === 1 && val === 1)) return src;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return src;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, (l + (p[i + c] - l) * sat) * val));
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = src.colorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.flipY = src.flipY;
  t.anisotropy = src.anisotropy;
  t.needsUpdate = true;
  return t;
}

const LAYERS = [
  { url: 'assets/desert/terrain/sand.webp', tile: 9 },
  // 砾石：4 m 一铺时砾石斑有拳头到脸盆大，近景成一片豹纹斑（抢视线）；2.6 m 一铺缩成碎石粒
  { url: 'assets/desert/terrain/gravel.webp', tile: 2.6 },
  { url: 'assets/desert/terrain/earth.webp', tile: 7 },
  { url: 'assets/desert/terrain/rock.webp', tile: 8 },
];

const compiled = new Map<string, CompiledMap>();
/** prepare 里建好、build 里挂上的新件（每次进关重建：卸载时会 dispose） */
const pending = new Map<string, { pieces: BuiltPiece[]; missing: string[] }>();

/** 一组新件建不出来时，用白盒体块的碰撞顶上（主线还是走得通，只是画面上缺件） */
function fallbackColliders(c: CompiledMap, need: string): UnitySceneDocument['colliders'] {
  const out: UnitySceneDocument['colliders'] = [];
  for (const b of c.terrain.blocks) {
    if ((b.needs ?? '').split('：')[0] !== need) continue;
    const ground = c.terrain.groundAt(b.at[0], b.at[1]);
    const bottom = b.canopy ? b.y0 : ground - 0.3, top = b.y1;
    const size: [number, number, number] = b.kind === 'cyl' ? [b.size[0] * 2, top - bottom, b.size[0] * 2] : [b.size[0], top - bottom, b.size[1]];
    out.push(boxCollider(`${need}（白盒）`, { center: [b.at[0], (bottom + top) / 2, b.at[1]], size, rotation: yawQuat(b.kind === 'cyl' ? 0 : b.rot ?? 0) }));
  }
  return out;
}

function yawQuat(deg: number): [number, number, number, number] {
  const r = deg * Math.PI / 360;
  return [0, Math.sin(r), 0, Math.cos(r)];
}

/** 件的碰撞盒 → 文档的 box 碰撞（AABB 按旋转后的八个角算） */
function boxCollider(name: string, b: PieceBox): UnitySceneDocument['colliders'][number] {
  const q = new THREE.Quaternion(...(b.rotation ?? [0, 0, 0, 1]));
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity), v = new THREE.Vector3();
  for (let k = 0; k < 8; k++) {
    v.set((k & 1 ? 0.5 : -0.5) * b.size[0], (k & 2 ? 0.5 : -0.5) * b.size[1], (k & 4 ? 0.5 : -0.5) * b.size[2]).applyQuaternion(q).add(new THREE.Vector3(...b.center));
    min.min(v);
    max.max(v);
  }
  return { kind: 'box', name, scenePath: `Redo/Pieces/${name}`, center: b.center, size: b.size, rotation: b.rotation ?? [0, 0, 0, 1], min: min.toArray(), max: max.toArray() };
}

/** 新做的件（运行时建）：认得的种类建出来，认不得的（件还没做好）记下名字，碰撞退回白盒体块 */
async function buildPieces(c: CompiledMap, ctx: PieceContext): Promise<{ pieces: BuiltPiece[]; missing: string[] }> {
  const pieces: BuiltPiece[] = [], missing: string[] = [];
  const named = NAMED_BUILDERS;
  for (const req of c.pieces) {
    try {
      const built = await buildOne(req, ctx, named);
      if (built) pieces.push(built);
      else missing.push(req.kind === 'named' || req.kind === 'stair' ? req.name : req.kind);
    } catch (err) {
      console.error('[desert/redo] 新件没建起来', req, err);
      missing.push(req.kind === 'named' || req.kind === 'stair' ? req.name : req.kind);
    }
  }
  return { pieces, missing };
}

/** 木构件（九层楼、月泉阁、坐像殿、栈梯）：pieces/ 里的模块按约定导出 REDO_BUILDERS（件名 → 建件函数）；还没有就退回白盒 */
type NamedBuilder = (ctx: PieceContext, req: PieceRequest) => BuiltPiece | Promise<BuiltPiece>;
const NAMED_BUILDERS: Record<string, NamedBuilder> = {};
const MODULES: Record<string, () => Promise<unknown>> = import.meta.env ? import.meta.glob('../pieces/*.ts') : {};
let namedLoaded: Promise<void> | null = null;
function loadNamedBuilders(): Promise<void> {
  namedLoaded ??= Promise.all(Object.values(MODULES).map(async load => {
    const mod = await load() as { REDO_BUILDERS?: Record<string, NamedBuilder> };
    Object.assign(NAMED_BUILDERS, mod.REDO_BUILDERS ?? {});
  })).then(() => undefined);
  return namedLoaded;
}

async function buildOne(req: PieceRequest, ctx: PieceContext, named: Record<string, NamedBuilder>): Promise<BuiltPiece | null> {
  switch (req.kind) {
    case 'poplars': return buildPoplars(req.trees.map(t => ({ ...t, tint: req.tint })), ctx);
    case 'deadPoplars': return buildDeadPoplars(req.trees, ctx);
    case 'camelBones': return buildCamelBones(req.at, req.y, req.rot, ctx);
    case 'named':
    case 'stair': {
      const fn = named[req.name] ?? (req.kind === 'stair' ? named['木栈梯'] : undefined);
      return fn ? await fn(ctx, req) : null;
    }
  }
}

/** 进关前：编译（缓存）+ 建新件（每次重建） */
export async function prepareRedo(id: string, low = false): Promise<void> {
  const spec = WHITEBOXES[id];
  if (!spec) return;
  let c = compiled.get(id);
  if (!c) {
    const t0 = performance.now();
    c = compileWhitebox(spec);
    console.info(`[desert/redo] ${id} 编译 ${Math.round(performance.now() - t0)} ms：渲染件 ${c.doc.renderers.length}、碰撞 ${c.doc.colliders.length}、导航三角形 ${c.doc.navigation.indices.length / 3}`, c.notes);
    compiled.set(id, c);
    provideBoundaryField(boundaryUrl(id), c.boundary.field);
  }
  // 这一次进关的件已经建好、还没挂上（取文档时 prepare 过一次，搭场景前又 prepare 一次）：不重建
  if (pending.has(id)) return;
  await loadNamedBuilders();
  const groundAt = (x: number, z: number): number => c!.terrain.groundAt(x, z);
  pending.set(id, await buildPieces(c, { ground: groundAt, low, environment: c.doc.environment }));
}

/** 整份场景文档（已改好：版面 + 新件的碰撞），StageDirector 直接用它进关 */
export function redoDocument(id: string): UnitySceneDocument {
  const c = compiled.get(id);
  if (!c) throw new Error(`[desert/redo] ${id} 没有先 prepare`);
  return patchDesertDocument(c.doc, redoArt(id));
}

/** 第一章重做的图：编好的文档整份换掉旧场景的版面 */
export function redoArt(id: string): DesertMapArt | null {
  const spec = WHITEBOXES[id];
  if (!spec) return null;
  return {
    id, mood: spec.mood, wind: spec.wind,
    patchDocument(doc: UnitySceneDocument): void {
      const c = compiled.get(id);
      if (!c) { console.error(`[desert/redo] ${id} 没有先 prepare`); return; }
      const fresh = structuredClone(c.doc);
      const built = pending.get(id);
      const pieceColliders = (built?.pieces ?? []).flatMap((p, k) => p.colliders.map((b, j) => boxCollider(b.name ?? `件${k}_${j}`, b)));
      const fallback = (built?.missing ?? []).flatMap(name => fallbackColliders(c, name));
      if (built?.missing.length) console.warn(`[desert/redo] ${id} 这些新件还没做好，先用白盒体块的碰撞：${built.missing.join('、')}`);
      Object.assign(doc, fresh, { colliders: [...fresh.colliders, ...pieceColliders, ...fallback] });
      // 旧场景的小地图是旧版面，不能留
      delete doc.map;
    },
    mechanisms() {
      const c = compiled.get(id);
      if (!c) throw new Error(`[desert/redo] ${id} 没有先 prepare`);
      return structuredClone(c.mechanisms);
    },
    // 光影雾（maps.ts 的 look）：空气透视 / 云天 / 光柱给 UnityEnvironmentView，逆光轮廓给风格化材质，调色叠在旧场景调色上，雾带摆位给氛围层
    light: redoLight(spec, REDO_MAPS[id] ?? { margin: { rise: 0, dunes: 0 } }),
    atmosphere: REDO_MAPS[id]?.look?.atmosphere,
    clouds: REDO_MAPS[id]?.look?.clouds,
    shafts: REDO_MAPS[id]?.look?.shafts,
    rimBack: REDO_MAPS[id]?.look?.rimBack,
    layout: REDO_MAPS[id]?.look?.layout,
    get grade() {
      return mergeGrade(compiled.get(id)?.grade ?? undefined, REDO_MAPS[id]?.look?.grade);
    },
    async build(b): Promise<DesertPart[]> {
      const c = compiled.get(id);
      if (!c) return [];
      const parts: DesertPart[] = [await terrainPart(b.document, c, b.group), ...waterParts(b.document, c, b.group), await farGroundPart(b.document, c, b.group)];
      // 远景剪影环：一排排沙丘 / 台地 / 雅丹退进雾里（farLayer.ts）
      const far = REDO_MAPS[id]?.look?.far;
      if (far) {
        const layer = createFarLayer({
          center: [spec.size[0] / 2, spec.size[1] / 2], baseY: c.field.baseY, wind: spec.wind,
          rows: far.rows, veils: far.veils, look: far.look,
        });
        b.group.add(layer.group);
        parts.push(layer);
      }
      const built = pending.get(id);
      pending.delete(id);
      for (const p of built?.pieces ?? []) {
        b.group.add(p.object);
        parts.push({ update: p.update?.bind(p), dispose: () => { p.object.removeFromParent(); p.dispose(); } });
      }
      // 特效（fx.ts）：沙脊吹沙、狼烟、尘卷风、落沙、贴地流沙、旗幡、落叶
      parts.push(...redoFx(b, spec, REDO_FX[id], c.field.baseY, c.terrain));
      return parts;
    },
  };
}

/** 地形网格：高度场三角化 + 旧沙漠地形的四层贴图，权重图是白盒材质（分层图的 u 是镜像的、行从 z 大的一头起：整张倒过来） */
async function terrainPart(doc: UnitySceneDocument, c: CompiledMap, group: THREE.Group): Promise<DesertPart> {
  const n = c.field.n, src = c.control, data = new Uint8Array(src.length);
  for (let k = 0; k < n * n; k++) data.set(src.subarray((n * n - 1 - k) * 4, (n * n - k) * 4), k * 4);
  const control = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  control.magFilter = THREE.LinearFilter;
  control.minFilter = THREE.LinearFilter;
  control.colorSpace = THREE.NoColorSpace;
  control.needsUpdate = true;
  const raw = await Promise.all(LAYERS.map(l => UnityLevelLibrary.loadTexture(l.url, true)));
  const layers = raw.map((t, k) => toneTexture(t, ...LAYER_TONE[k]));
  for (const layer of layers) { layer.anisotropy = 8; layer.needsUpdate = true; }
  // 着色器按 vMapUv 采样分层图：材质要挂一张 map 才有这个 varying
  const material = new THREE.MeshStandardMaterial({ map: control });
  // 暗部色调缺省比沙漠章原来的 [0.7, 0.64, 0.82] 暖一档：铺地在阴影里不发紫灰
  const style = terrainStyle(doc.id), shadow = REDO_MAPS[doc.id]?.look?.terrainShadow ?? ([0.7, 0.65, 0.72, 1] as [number, number, number, number]);
  stylizeTerrain(material, { control, layers, tiles: LAYERS.map(l => l.tile) }, shadow ? { ...style, shadowTint: shadow } : style, doc.environment);
  setStylizedEnvironment(doc.environment);
  const source = new THREE.Group();
  source.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  const mesh = createUnityTerrainMesh(doc.heightfields[0], source);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
  return {
    dispose(): void {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      control.dispose();
    },
  };
}

/**
 * 画面上的水面：白盒的水面多边形铺成一张平面（水体盒管玩法，这张只管看）。1-4 的叫 CrescentSpring Surface——
 * UnityWaterView 按这个名字找到它，旱魃吸干泉水时让它跟着水位落下去、见底时藏起来。
 */
function waterParts(doc: UnitySceneDocument, c: CompiledMap, group: THREE.Group): DesertPart[] {
  return (c.spec.water ?? []).map((w, k) => {
    const shape = new THREE.Shape(w.pts.map(p => new THREE.Vector2(p[0], -p[1])));
    // ShapeGeometry 在 XY 平面：绕 x 转 −90° 放平（y 取反抵掉，z = 白盒的 z）
    const geometry = new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
    const source = new THREE.MeshStandardMaterial();
    source.userData = {
      unityShader: 'Spiritfire/Water',
      // 泉水：浅处青绿、深处蓝，全画面唯一的冷色
      unityColors: { _ShallowColor: [0.18, 0.78, 0.78, 0.6], _DeepColor: [0.04, 0.38, 0.5, 0.92] },
      unityFloats: { _Alpha: 0.85, _WaveScale: 3, _WaveSpeed: 0.5, _WaveHeight: 0.02, _Sparkle: 1.2 },
    };
    const material = createUnityWaterMaterial(source, doc.environment);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = c.spec.id === '1-4' ? `CrescentSpring Surface ${k + 1}` : `Water Surface ${k + 1}`;
    mesh.position.y = w.level;
    mesh.renderOrder = 2;
    group.add(mesh);
    return {
      update(_dt: number, t: number): void { material.uniforms.uTime.value = t; },
      dispose(): void { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
    };
  });
}

/** 调色：play.ts 里旧场景 Volume 的结果打底，这张图 look.grade 里给了的组件参数逐项盖上去 */
function mergeGrade(base: VolumeOverrides | undefined, over: VolumeOverrides | undefined): VolumeOverrides | undefined {
  if (!over) return base;
  const out: Record<string, Record<string, unknown>> = structuredClone((base ?? {}) as Record<string, Record<string, unknown>>);
  for (const [k, v] of Object.entries(over)) out[k] = { ...(out[k] ?? {}), ...(v as Record<string, unknown>) };
  return out as VolumeOverrides;
}

/**
 * 远景地面：图外地形最外一圈收回到 baseY，接一大片同高的沙地一直铺到相机远裁面之外（远景剪影的脚下雾融进它在远处的雾色）。
 * 沙层贴图按 9 m 一张平铺；只受光、不投影。
 */
async function farGroundPart(doc: UnitySceneDocument, c: CompiledMap, group: THREE.Group): Promise<DesertPart> {
  const size = 7000;
  const sand = toneTexture(await UnityLevelLibrary.loadTexture(LAYERS[0].url, true), ...LAYER_TONE[0]).clone();
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  sand.repeat.set(size / LAYERS[0].tile, size / LAYERS[0].tile);
  sand.needsUpdate = true;
  const material = createStylizedLit(new THREE.MeshStandardMaterial({ map: sand, roughness: 1, metalness: 0 }), doc.environment);
  // 只铺在高度场外面：中间挖掉高度场那一块（往里缩 1 m，钻到高度场最外一圈底下，不留缝）。
  // 不挖的话这张平面会从低处穿出来（1-4 的泉、1-A 的河床都比远景地面低），把泉水和盆底盖住
  const [W, D] = c.spec.size, M = MARGIN - 1, half = size / 2, cx = W / 2, cz = D / 2;
  const shape = new THREE.Shape([new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half), new THREE.Vector2(half, half), new THREE.Vector2(-half, half)]);
  // ShapeGeometry 在 XY 平面、绕 x 转 −90° 放平：平面上的 (x, y) → 世界 (x, 0, −y)
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(-M - cx, -(-M - cz)), new THREE.Vector2(-M - cx, -(D + M - cz)), new THREE.Vector2(W + M - cx, -(D + M - cz)), new THREE.Vector2(W + M - cx, -(-M - cz)),
  ]));
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  // ShapeGeometry 的 uv = 顶点坐标（米）：换成 0..1，沙层贴图按 repeat 平铺
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + half) / size, (uv.getY(i) + half) / size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Far Ground';
  mesh.position.set(cx, c.field.baseY - 0.05, cz);
  mesh.receiveShadow = true;
  group.add(mesh);
  return {
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      sand.dispose();
    },
  };
}
