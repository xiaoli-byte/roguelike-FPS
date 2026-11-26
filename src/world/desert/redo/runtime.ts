import * as THREE from 'three';
import { UnityLevelLibrary, type UnitySceneDocument } from '../../UnityLevelLibrary';
import { createUnityTerrainMesh } from '../../UnityTerrainMesh';
import { setStylizedEnvironment, stylizeTerrain, terrainStyle } from '../../UnityStylizedLit';
import { provideBoundaryField, type SceneMechanisms } from '../../mechanisms/MechanismData';
import { SoftBoundary } from '../../mechanisms/Boundary';
import { WHITEBOXES } from '../whitebox';
import { buildDeadPoplars, buildPoplars } from '../pieces/flora';
import { buildCamelBones } from '../pieces/bones';
import type { BuiltPiece, PieceBox, PieceContext } from '../pieces/types';
import type { DesertMapArt, DesertPart } from '../spec';
import { compileWhitebox, type CompiledMap, type PieceRequest } from './compile';

/**
 * 第一章重做的运行时：进关前（StageDirector.prepareDesertArt）把白盒编成场景文档、建好新做的件，
 * 改文档时（patchDocument）整份换掉旧场景的版面，场景搭好后（build）铺地形网格、挂新件。
 * 机关数据（patchMechanisms）：软边界换成白盒可玩区算出来的距离场；沙暴区、流沙这类按旧坐标摆的机关清掉或挪到新位置。
 */

/** 地形四层贴图（旧场景的沙漠地形层：起伏沙 / 黑戈壁砾石 / 龟裂土 / 赭红岩层）和每张盖多少米 */
const LAYERS = [
  { url: 'assets/unity-levels/textures/t_52868a62b1f7162d15a9.webp', tile: 9 },
  { url: 'assets/unity-levels/textures/t_95395f83d84a8de7b7b8.webp', tile: 4 },
  { url: 'assets/unity-levels/textures/t_a787e9460e7888b84aa9.webp', tile: 7 },
  { url: 'assets/unity-levels/textures/t_4e56f9302e97e7d607d0.webp', tile: 8 },
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
    const old = await UnityLevelLibrary.scene(id);
    const t0 = performance.now();
    c = compileWhitebox(spec, old);
    console.info(`[desert/redo] ${id} 编译 ${Math.round(performance.now() - t0)} ms：渲染件 ${c.doc.renderers.length}、碰撞 ${c.doc.colliders.length}、导航三角形 ${c.doc.navigation.indices.length / 3}`, c.notes);
    compiled.set(id, c);
    provideBoundaryField(boundaryUrl(id), c.boundary.field);
  }
  await loadNamedBuilders();
  const groundAt = (x: number, z: number): number => c!.terrain.groundAt(x, z);
  const old = pending.get(id);
  for (const p of old?.pieces ?? []) p.dispose();
  pending.set(id, await buildPieces(c, { ground: groundAt, low, environment: c.doc.environment }));
}

const boundaryUrl = (id: string): string => `redo/boundary/${id}.f32`;

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
    patchMechanisms(m: SceneMechanisms): void {
      const c = compiled.get(id);
      if (!c) return;
      const b = c.boundary;
      m.boundary = {
        scenePath: 'Redo/Boundary', asset: '', url: boundaryUrl(id), width: b.width, height: b.height, sha1: '',
        origin: b.origin, cell: b.cell, theme: 'Desert', tuning: m.boundary?.tuning ?? SoftBoundary.defaults(),
      };
      // 按旧坐标摆的机关：挪不动的先清掉（流沙、地面区、安全区、补给营、可破坏物、碑文……按白盒重摆是后面的事）
      for (const key of ['quicksand', 'surfaces', 'safeZones', 'camps', 'destructibles', 'lore', 'spans'] as const) if (m[key]) m[key] = [];
      if (m.weather) {
        const storm = c.config.storm, site = storm && [...c.spec.strongholds, ...c.spec.guards].find(s => s.id === storm.site);
        m.weather = {
          ...m.weather, windDir: [spec.wind[0], spec.wind[1]],
          regions: storm && site && m.weather.regions[0]
            ? [{ ...m.weather.regions[0], center: [site.at[0], c.terrain.walkAt(site.at[0], site.at[1]), site.at[1]], radius: storm.radius, from: storm.from }]
            : [],
        };
      }
    },
    async build(b): Promise<DesertPart[]> {
      const c = compiled.get(id);
      if (!c) return [];
      const parts: DesertPart[] = [await terrainPart(b.document, c, b.group)];
      const built = pending.get(id);
      pending.delete(id);
      for (const p of built?.pieces ?? []) {
        b.group.add(p.object);
        parts.push({ update: p.update?.bind(p), dispose: () => { p.object.removeFromParent(); p.dispose(); } });
      }
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
  const layers = await Promise.all(LAYERS.map(l => UnityLevelLibrary.loadTexture(l.url, true)));
  for (const layer of layers) { layer.anisotropy = 8; layer.needsUpdate = true; }
  // 着色器按 vMapUv 采样分层图：材质要挂一张 map 才有这个 varying
  const material = new THREE.MeshStandardMaterial({ map: control });
  stylizeTerrain(material, { control, layers, tiles: LAYERS.map(l => l.tile) }, terrainStyle(doc.id), doc.environment);
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
