/**
 * 游玩模式用到的第四章正式模型（public/assets，清单 manifest.json）：只加载这一章的 14 个，
 * 不经过 AssetLibrary（它一导入就会在后台加载全部两百多个资产）。
 * 生物走原生骨架（attachNativeBody → NativePose），部件 / 道具只取 LOD0 静态网格。
 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetEntry, LoadedAsset } from '../../../assets/AssetLibrary';
import { attachNativeBody, type NativeBody } from '../../../assets/NativeRig';

export const PLATEAU_MODELS = [
  'SK_Enemy_Marmot', 'SK_Enemy_Tiangou', 'SK_Enemy_Aoyin', 'SK_Enemy_Jufu', 'SK_Enemy_Manman', 'SK_Enemy_Dijiang', 'SK_Enemy_Qiongqi',
  'SK_Boss_Kui', 'SK_Boss_Feilian', 'SK_Boss_Huashe',
  'SM_EnemyPart_LianguDrum', 'SM_EnemyPart_LianguCore', 'SM_EnemyPart_LianguMallet', 'SM_Prop_KuiBrokenDrum',
] as const;
export type PlateauModel = typeof PLATEAU_MODELS[number];

const loaded = new Map<string, LoadedAsset>();

/** 读清单并加载这一章的模型；onProgress(已完成, 总数) */
export async function loadPlateauModels(onProgress?: (done: number, total: number) => void): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const manifest = (await (await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' })).json()) as { assets: Record<string, AssetEntry> };
  const draco = new DRACOLoader();
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let done = 0;
  await Promise.all(PLATEAU_MODELS.map(async (id) => {
    const entry = manifest.assets[id];
    if (!entry) throw new Error(`清单里没有 ${id}`);
    const gltf = await loader.loadAsync(`${base}${entry.url}`);
    const lods: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const match = m.isMesh ? /_LOD(\d+)$/.exec(m.name) : null;
      if (match) lods[Number(match[1])] = m;
    });
    loaded.set(id, { id, entry, gltf, lods });
    onProgress?.(++done, PLATEAU_MODELS.length);
  }));
  draco.dispose();
}

/** 生物：返回模型根（脚底原点、面朝 +Z）和原生骨架 */
export function spawnCreature(id: PlateauModel, scale = 1): { host: THREE.Group; body: NativeBody } {
  const asset = loaded.get(id);
  if (!asset) throw new Error(`${id} 还没加载`);
  const host = new THREE.Group();
  host.name = id;
  host.scale.setScalar(scale);
  const body = attachNativeBody(host, asset);
  if (!body) throw new Error(`${id} 不是原生骨架`);
  host.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; });
  return { host, body };
}

/** 部件 / 道具：只取 LOD0；原点 = 资产自己的原点 */
export function spawnStatic(id: PlateauModel, scale = 1): THREE.Group {
  const asset = loaded.get(id);
  if (!asset) throw new Error(`${id} 还没加载`);
  const src = asset.lods[0];
  const mesh = new THREE.Mesh(src.geometry, src.material);
  src.updateWorldMatrix(true, false);
  mesh.applyMatrix4(src.matrixWorld);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.name = id;
  g.scale.setScalar(scale);
  g.add(mesh);
  return g;
}

/** 资产的包围盒（米，绑定姿势） */
export function modelBounds(id: PlateauModel): THREE.Box3 {
  const b = loaded.get(id)!.entry.bounds;
  return new THREE.Box3(new THREE.Vector3().fromArray(b.min), new THREE.Vector3().fromArray(b.max));
}
