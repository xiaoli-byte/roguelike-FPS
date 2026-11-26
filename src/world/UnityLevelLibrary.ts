import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { LEVEL_CATALOG, levelUrl } from './level/catalog';
import type { SceneMechanisms } from './mechanisms/MechanismData';

export interface UnityTerrain {
  size: [number, number, number];
  layers: { url: string; tileSize: [number, number]; tileOffset: [number, number] }[];
  alphamaps: string[];
}

export interface UnityRenderer {
  name: string;
  url: string;
  platform?: string;
  water?: string;
  activator?: string;
  swing?: boolean;
  lamp?: boolean;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  terrain?: UnityTerrain;
  scenePath?: string;
}

export interface UnityHeightfield {
  origin: [number, number, number];
  scale: [number, number, number];
  resolution: number;
  heights: string;
}

export interface UnityWaveEntry {
  enemy: string;
  count: number;
  elite: boolean;
  affix: string;
  role: number;
  arrivalDelay: number;
  lane: number;
  holdBack: boolean;
  via: number;
}

export interface UnityWave {
  label: string;
  hint: string;
  triggerRemaining: number;
  delay: number;
  entries: UnityWaveEntry[];
}

export interface UnityEncounter {
  title: string;
  position: [number, number, number];
  triggerRadius: number;
  entryDepth: number;
  requireSight: boolean;
  autoTrigger: boolean;
  arenaRadius: number;
  requires: string[];
  /** role = Unity StationRole 枚举值（0 = Auto）；elevated = SpawnAnchor.elevated（导出器还没写，缺省地面） */
  anchors: { position: [number, number, number]; lane: number; role: number; elevated?: boolean }[];
  optional: boolean;
  roadside: boolean;
  reward: string;
  chestOffset: [number, number, number];
  difficulty: number;
  waves: UnityWave[];
  scenePath?: string;
}

export interface UnityNavigationData {
  vertices: [number, number, number][];
  indices: number[];
  areas: number[];
}

export interface UnityEnvironment {
  fog: { enabled: boolean; mode: number; color: [number, number, number, number]; start: number; end: number; density: number };
  ambient: { mode: number; sky: [number, number, number, number]; equator: [number, number, number, number]; ground: [number, number, number, number]; light: [number, number, number, number]; intensity: number };
  sun: { forward: [number, number, number]; color: [number, number, number, number]; intensity: number; shadows: number; shadowStrength: number } | null;
  sky: { name: string; shader: string; colors: Record<string, [number, number, number, number]>; floats: Record<string, number>; vectors: Record<string, [number, number, number, number]>; cubemap?: string[] } | null;
  lights: { type: number; position: [number, number, number]; forward: [number, number, number]; color: [number, number, number, number]; intensity: number; range: number; spotAngle: number }[];
}

export interface UnityVegetation {
  prototypes: { index: number; name: string; url: string }[];
  instances: { prototype: number; position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] }[];
}

export interface UnityGroundCover {
  name: string;
  url: string | null;
  texture: string | null;
  origin: [number, number, number];
  terrainSize: [number, number, number];
  width: number;
  height: number;
  counts: string;
  count: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  noiseSeed: number;
  noiseSpread: number;
  positionJitter: number;
  alignToGround: number;
  holeEdgePadding: number;
  healthyColor: [number, number, number, number];
  dryColor: [number, number, number, number];
  density: number;
  viewDistance: number;
}

export interface UnityPlatform {
  id: string;
  name: string;
  path: [number, number, number][];
  at: number;
  size: [number, number, number];
  mode: number;
  onSignal: number;
  speed: number;
  accel: number;
  cornerSpeed: number;
  dwell: number;
  departDelay: number;
  callDelay: number;
  callRadius: number;
  startPowered: boolean;
  powerSite: string | null;
  scenePath?: string;
}

export interface UnityWater {
  id: string;
  name: string;
  center: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number, number];
  shallow: number;
  deep: number;
  wadeSlow: number;
  deepIsHazard: boolean;
  drownBurst: number;
  spring: boolean;
  beds: [number, number, number][];
  scenePath?: string;
}

export interface UnityActivator {
  id: string;
  position: [number, number, number];
  byShot: boolean;
  byInteract: boolean;
  minShotDamage: number;
  toggle: boolean;
  oneShot: boolean;
  cooldown: number;
  lockedBy: string | null;
  lockedHint: string;
  title: string;
  verb: string;
  hint: string;
  toast: string;
  focusHeight: number;
  interactRadius: number;
  onColor: [number, number, number, number];
  offColor: [number, number, number, number];
  targets: string[];
  scenePath?: string;
}

/** 关卡目录里的一张图（由 level/catalog.ts 合成；原 Unity 导出的 manifest.json 的 stages[]）；每局路线的备选图（1-A / 2-A / 3-A）带 pool: true */
export interface UnityManifestStage {
  id: string;
  title?: string;
  chapter?: number;
  index?: number;
  kind?: string;
  reward?: string;
  scene?: string;
  available: boolean;
  url?: string;
  pool?: boolean;
}

export interface UnityLevelManifest {
  schema?: number;
  source?: string;
  stages: UnityManifestStage[];
}

// ───────────── 每局变化（M3 / M4）：以下字段都是可选的，旧导出没有时运行时原样跑 ─────────────
//
// scenePath：物体在场景里的层级路径（根物体名 / 子物体名 / …，同名兄弟在名字后加 #序号）。LevelLayout 的变体用路径引用物体，
// 一个导出项「在某个物体下」= 它的 scenePath 等于该路径或以「该路径/」开头（停用父物体 = 停用整棵子树，同 Unity SetActive）。

/**
 * 怪物入场点（Unity MonsterEntry）：据点之外持续涌来的游荡怪群（CombatDirector）只从这些地方进场。
 * 位置 = 落地点（导航网格上），forward = 进场后往哪走。
 */
export interface UnityMonsterEntry {
  scenePath?: string;
  position: [number, number, number];
  forward: [number, number, number];
  /** SpawnMode：0 现身 1 埋伏（入场点按现身处理）2 余烬起身 3 熔岩爬出 4 飞临 5 跃下 6 增援门 */
  mode: number;
  /** 一群在落地点周围散开的半径（米） */
  spread: number;
  /** 名字（报告 / 调试用：「北沙丘背后」） */
  label: string;
  /** 跃下的起跳点 / 增援门的门后；null = 落地点 */
  from: [number, number, number] | null;
  /** 只放飞行敌人（飞临入场点） */
  flyersOnly: boolean;
}

/** LevelLayout 的一种走法（Unity LevelLayout.Variant） */
export interface UnityLayoutVariant {
  /** 变体 id（main / reverse…） */
  id: string;
  /** 变体名（进关提示：「自驼队营地入」） */
  title: string;
  /** 抽中的权重（≤ 0 = 不参与随机，只能指定） */
  weight: number;
  /** 这一走法的出生点（PlayerSpawn 的路径和位置 / 朝向）；null = 用文档的 spawn */
  spawn: { scenePath: string; position: [number, number, number]; forward: [number, number, number] } | null;
  /** 这一走法的出口（ExitPortal 的路径，对应 exits[].scenePath）；null = 不换 */
  exit: string | null;
  /** 只在这个走法里出现的物体路径（别的走法里停用） */
  only: string[];
  /** 这个走法里停用的物体路径 */
  hide: string[];
  /** 这个走法里改写的场地先后（site / requires 都是据点的 title，同 encounters[].requires） */
  requires: { site: string; requires: string[] }[];
  /** 这个走法里换编制（spec 非 null）/ 换肃清奖励（reward 非 null）的场地 */
  sites: { site: string; spec: { waves: UnityWave[] } | null; reward: string | null }[];
}

/** 图内布局变体（Unity LevelLayout）：第一个变体 = 设计稿的走法（主变体） */
export interface UnityLevelLayout {
  variants: UnityLayoutVariant[];
}

export interface UnitySceneDocument {
  schema: number;
  id: string;
  title: string;
  /** @deprecated 原 Unity 场景路径（Assets/Scenes/*.unity）：public/assets/levels 的文档不带，没有代码读它 */
  scene?: string;
  spawn: { position: [number, number, number]; forward: [number, number, number] };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  visualBounds?: { min: [number, number, number]; max: [number, number, number] };
  map?: { url: string; area: [number, number, number, number] };
  renderers: UnityRenderer[];
  /**
   * 碰撞体。mesh = 网格 / 球 / 胶囊碰撞在 {@link collision} 那份 GLB 里的节点名（c<下标>，网页坐标，镜像已在转换时烘掉）；
   * 没有 mesh 的按 min / max（box 再加 center / size / rotation 的有向盒）
   */
  colliders: { kind: string; name: string; min: [number, number, number]; max: [number, number, number]; platform?: string; activator?: string; mesh?: string; center?: [number, number, number]; size?: [number, number, number]; rotation?: [number, number, number, number]; scenePath?: string }[];
  /** 本关全部网格碰撞合成的一份 GLB（assets/levels/<id>/collision.glb），节点名对 colliders[].mesh */
  collision?: string;
  platforms: UnityPlatform[];
  water: UnityWater[];
  activators: UnityActivator[];
  heightfields: UnityHeightfield[];
  vegetation?: UnityVegetation;
  groundCover?: UnityGroundCover[];
  navigation: UnityNavigationData;
  environment: UnityEnvironment;
  encounters: UnityEncounter[];
  exits: { position: [number, number, number]; rotation: [number, number, number, number]; reward: string; requires: string[]; scenePath?: string }[];
  caches: { title: string; position: [number, number, number]; reward: string; discoverRadius: number; guard: string | null; scenePath?: string }[];
  camps: { title: string; position: [number, number, number]; yaw: number; safeRadius: number; openShop: boolean; scenePath?: string }[];
  bosses: { id: string; position: [number, number, number]; center: [number, number, number]; floorY: number; radius: number; reward: [number, number, number]; stronghold: boolean }[];
  /** 怪物入场点（MonsterEntry）；没有 = 老图，战斗导演退回视野外随机导航点 */
  entries?: UnityMonsterEntry[];
  /** 图内布局变体（LevelLayout）；没有 / 空 = 只有一种走法 */
  layout?: UnityLevelLayout | null;
  /** 地图机关（熔岩、熔泉、流沙、软边界、天气……；原 Unity 导出的 mechanisms.json 里这一关的那段）；没有 = 这张图没有机关 */
  mechanisms?: SceneMechanisms | null;
}

const BASE = import.meta.env.BASE_URL;

class Library {
  // public/assets/levels 的网格和碰撞走 EXT_meshopt_compression
  private readonly loader = new GLTFLoader().setDRACOLoader(new DRACOLoader()).setMeshoptDecoder(MeshoptDecoder);
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly meshes = new Map<string, Promise<GLTF>>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly scenes = new Map<string, Promise<UnitySceneDocument | null>>();
  private manifestPending: Promise<UnityLevelManifest> | null = null;

  /**
   * 关卡目录（src/world/level/catalog.ts）合成的清单：局路线按它判断哪些图有数据（备选图带 pool: true），url = assets/levels/<id>/level.json。
   * 2026-11-26 前读 Unity 导出的 public/assets/unity-levels/manifest.json；返回 Promise 是沿用原来的签名
   */
  manifest(): Promise<UnityLevelManifest> {
    this.manifestPending ??= Promise.resolve({
      schema: 3,
      source: 'src/world/level/catalog.ts',
      stages: LEVEL_CATALOG.map(entry => ({ ...entry, url: entry.available ? levelUrl(entry.id) : undefined })),
    });
    return this.manifestPending;
  }

  async scene(id: string): Promise<UnitySceneDocument | null> {
    let pending = this.scenes.get(id);
    if (!pending) {
      pending = (async () => {
        const item = (await this.manifest()).stages.find(stage => stage.id === id);
        if (!item) return null;
        if (!item.available || !item.url) throw new Error(`关卡 ${id} 还没有数据（public/assets/levels），不能使用旧网页地图代替`);
        const response = await fetch(`${BASE}${item.url}`);
        if (!response.ok) throw new Error(`关卡 ${id} 读取失败：${response.status}`);
        return await response.json() as UnitySceneDocument;
      })();
      this.scenes.set(id, pending);
    }
    return pending.catch(error => {
      this.scenes.delete(id);
      this.manifestPending = null;
      throw error;
    });
  }

  load(url: string): Promise<GLTF> {
    let pending = this.meshes.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(`${BASE}${url}`).catch(error => {
        const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : JSON.stringify(error);
        throw new Error(`${url}: ${detail}`, { cause: error });
      });
      this.meshes.set(url, pending);
    }
    return pending;
  }

  loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    let pending = this.textures.get(url);
    if (!pending) {
      pending = this.textureLoader.loadAsync(`${BASE}${url}`).then(texture => {
        texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.flipY = false;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        return texture;
      });
      this.textures.set(url, pending);
    }
    return pending;
  }

  /**
   * 换关：释放不属于 document 的网格、贴图与场景文档（GPU 资源交还、解码后的图关掉）。网格 / 贴图按 URL 缓存、各图共用的件留着。
   * 只能在上一张图的场景已经卸掉、这一张还没搭之前调（assets/StageArt.ts 的 prepareStageArt）——此刻缓存里不在 keep 里的都没人在用；
   * 新图要用的话照常现读。document = null（第一章重做版，文档由白盒现编）时全部释放。
   * 2026-11-25 前从不淘汰：一局打下来每张图的网格 / 贴图都留在内存和显存里（单张图贴图解码后 0.2–1.1 GB）。返回释放了几项
   */
  releaseExcept(document: UnitySceneDocument | null): number {
    const keep = document ? documentUrls(document) : new Set<string>();
    let n = 0;
    for (const [url, pending] of this.meshes) {
      if (keep.has(url)) continue;
      this.meshes.delete(url);
      void pending.then(gltf => disposeTree(gltf.scene), () => undefined);
      n++;
    }
    for (const [url, pending] of this.textures) {
      if (keep.has(url)) continue;
      this.textures.delete(url);
      void pending.then(disposeTexture, () => undefined);
      n++;
    }
    for (const id of [...this.scenes.keys()]) if (id !== document?.id) this.scenes.delete(id);
    return n;
  }

  async preload(document: UnitySceneDocument, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const urls = [...new Set([
      ...document.renderers.map(renderer => renderer.url),
      ...(document.vegetation?.prototypes.map(prototype => prototype.url) ?? []),
      ...(document.collision ? [document.collision] : []),
      ...(document.groundCover?.flatMap(layer => layer.url ? [layer.url] : []) ?? []),
    ])];
    let loaded = 0;
    for (let i = 0; i < urls.length; i += 4) {
      await Promise.all(urls.slice(i, i + 4).map(url => this.load(url).then(gltf => {
        loaded++;
        onProgress?.(loaded, urls.length);
        return gltf;
      })));
    }
  }
}

/** 一份场景文档会用到的网格 / 贴图 URL（渲染件、植被原型、合并的碰撞网格、草皮、地形分层与 splat） */
export function documentUrls(document: UnitySceneDocument): Set<string> {
  const urls = new Set<string>();
  for (const r of document.renderers ?? []) {
    urls.add(r.url);
    for (const layer of r.terrain?.layers ?? []) urls.add(layer.url);
    for (const map of r.terrain?.alphamaps ?? []) urls.add(map);
  }
  for (const p of document.vegetation?.prototypes ?? []) urls.add(p.url);
  if (document.collision) urls.add(document.collision);
  for (const g of document.groundCover ?? []) {
    if (g.url) urls.add(g.url);
    if (g.texture) urls.add(g.texture);
  }
  return urls;
}

function disposeTexture(texture: THREE.Texture): void {
  texture.dispose();
  const image = texture.image as { close?: () => void } | null;
  if (typeof image?.close === 'function') image.close();
}

function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      material.dispose();
    }
  });
  for (const texture of textures) disposeTexture(texture);
}

export const UnityLevelLibrary = new Library();

export async function prepareUnityScene(document: UnitySceneDocument): Promise<void> {
  if (document.id.startsWith('4-')) {
    const { loadPlateauModels } = await import('./plateau/play/assets');
    await loadPlateauModels();
  }
}

export function unityHeights(field: UnityHeightfield): Float32Array {
  const binary = atob(field.heights);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function unityPoint(point: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

export function unityQuaternion(rotation: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
}
