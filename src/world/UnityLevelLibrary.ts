import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
  anchors: { position: [number, number, number]; lane: number; role: number }[];
  optional: boolean;
  roadside: boolean;
  reward: string;
  chestOffset: [number, number, number];
  difficulty: number;
  waves: UnityWave[];
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
}

export interface UnitySceneDocument {
  schema: number;
  id: string;
  title: string;
  scene: string;
  spawn: { position: [number, number, number]; forward: [number, number, number] };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  visualBounds?: { min: [number, number, number]; max: [number, number, number] };
  map?: { url: string; area: [number, number, number, number] };
  renderers: UnityRenderer[];
  colliders: { kind: string; name: string; min: [number, number, number]; max: [number, number, number]; platform?: string; activator?: string; url?: string; center?: [number, number, number]; size?: [number, number, number]; rotation?: [number, number, number, number] }[];
  platforms: UnityPlatform[];
  water: UnityWater[];
  activators: UnityActivator[];
  heightfields: UnityHeightfield[];
  vegetation?: UnityVegetation;
  groundCover?: UnityGroundCover[];
  navigation: UnityNavigationData;
  environment: UnityEnvironment;
  encounters: UnityEncounter[];
  exits: { position: [number, number, number]; rotation: [number, number, number, number]; reward: string; requires: string[] }[];
  caches: { title: string; position: [number, number, number]; reward: string; discoverRadius: number; guard: string | null }[];
  camps: { title: string; position: [number, number, number]; yaw: number; safeRadius: number; openShop: boolean }[];
  bosses: { id: string; position: [number, number, number]; center: [number, number, number]; floorY: number; radius: number; reward: [number, number, number]; stronghold: boolean }[];
}

const BASE = import.meta.env.BASE_URL;

class Library {
  // 发布目录的网格走 EXT_meshopt_compression（scripts/unity/optimize-web-levels.mjs）
  private readonly loader = new GLTFLoader().setDRACOLoader(new DRACOLoader()).setMeshoptDecoder(MeshoptDecoder);
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly meshes = new Map<string, Promise<GLTF>>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly scenes = new Map<string, Promise<UnitySceneDocument | null>>();
  private manifest: Promise<{ stages: { id: string; available: boolean; url?: string }[] }> | null = null;

  async scene(id: string): Promise<UnitySceneDocument | null> {
    let pending = this.scenes.get(id);
    if (!pending) {
      pending = (async () => {
        this.manifest ??= fetch(`${BASE}assets/unity-levels/manifest.json`).then(response => {
          if (!response.ok) throw new Error(`Unity 场景清单读取失败：${response.status}`);
          return response.json();
        });
        const item = (await this.manifest).stages.find(stage => stage.id === id);
        if (!item) return null;
        if (!item.available || !item.url) throw new Error(`Unity 场景 ${id} 尚未生成，不能使用旧网页地图代替`);
        const response = await fetch(`${BASE}${item.url}`);
        if (!response.ok) throw new Error(`Unity 场景 ${id} 读取失败：${response.status}`);
        return await response.json() as UnitySceneDocument;
      })();
      this.scenes.set(id, pending);
    }
    return pending.catch(error => {
      this.scenes.delete(id);
      this.manifest = null;
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

  async preload(document: UnitySceneDocument, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const urls = [...new Set([
      ...document.renderers.map(renderer => renderer.url),
      ...(document.vegetation?.prototypes.map(prototype => prototype.url) ?? []),
      ...document.colliders.flatMap(collider => collider.url ? [collider.url] : []),
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
