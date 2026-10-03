/**
 * 美术资产库：读取美术管线发布的清单（public/assets/manifest.json），后台预加载 GLB。
 *
 * - 引擎和管线之间唯一的契约就是清单；资产缺失、加载失败或以 ?classic 打开时，get() 返回 null，
 *   调用方退回程序化模型，游戏照常运行。
 * - 几何体、贴图、材质模板全部共享，不要 dispose；需要逐实例改的材质由调用方 clone。
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export interface AssetEntry {
  url: string;
  kind: 'skeletal' | 'static';
  class: string;
  /** 绑定目标；attachment 为挂点名时表示挂在该挂点上的静态网格（武器 / 盾 / 法器） */
  bind: { source: string; id: string; attachment?: string };
  /** 运行时保留白模上的哪些发光部件：all / attachments（只留武器等挂件上的）/ none */
  keepGlow: 'all' | 'attachments' | 'none';
  /** 各级 LOD 的切换距离（米） */
  lodDistance: number[];
  /** 骨骼适配后的绑定姿势（人形：左右上臂外展角，弧度）；缺省用 HumanoidBind 的默认角 */
  bindPose?: { armSpreadL: number; armSpreadR: number };
  /** 通用部件骨架（非人形）：骨架指纹 = [节点路径名, 静止局部位置]，见 PartsRig.ts */
  rig?: { mode: 'parts'; joints: [string, number[]][]; keep?: string[] };
  bounds: { min: number[]; max: number[] };
  sha256: string;
}

export interface LoadedAsset {
  id: string;
  entry: AssetEntry;
  gltf: GLTF;
  /** 按 LOD 序号排列的网格（skeletal 资产为 SkinnedMesh） */
  lods: THREE.Mesh[];
}

const BASE = import.meta.env.BASE_URL;
const disabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('classic');

class Library {
  private entries: Record<string, AssetEntry> = {};
  private loaded = new Map<string, LoadedAsset>();
  private failed = new Set<string>();
  private loader: GLTFLoader | null = null;
  private ready: Promise<void> | null = null;

  /** 启动时调用一次：读清单并在后台加载全部资产（不阻塞启动） */
  preload(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = disabled ? Promise.resolve() : this.loadAll();
    return this.ready;
  }

  /** 已加载的资产；未加载完 / 失败 / 被禁用时为 null */
  get(id: string): LoadedAsset | null {
    return this.loaded.get(id) ?? null;
  }

  /** 按绑定目标查找身体资产（如 { source: 'enemy', id: 'grunt' }），不含挂件 */
  findBound(source: string, id: string): LoadedAsset | null {
    for (const a of this.loaded.values()) {
      const b = a.entry.bind;
      if (b?.source === source && b.id === id && !b.attachment) return a;
    }
    return null;
  }

  /** 绑定到某个目标各挂点上的静态网格 */
  findAttachments(source: string, id: string): LoadedAsset[] {
    const out: LoadedAsset[] = [];
    for (const a of this.loaded.values()) {
      const b = a.entry.bind;
      if (b?.source === source && b.id === id && b.attachment) out.push(a);
    }
    return out;
  }

  get enabled(): boolean {
    return !disabled;
  }

  private async loadAll(): Promise<void> {
    let manifest: { assets?: Record<string, AssetEntry> };
    try {
      const r = await fetch(`${BASE}assets/manifest.json`, { cache: 'no-cache' });
      if (!r.ok) return;
      manifest = await r.json();
    } catch {
      return;
    }
    this.entries = manifest.assets ?? {};
    // three r186 的 DRACOLoader 默认用 import.meta.url 定位解码器，Vite 会把它打进产物，不需要另外拷贝
    const draco = new DRACOLoader();
    this.loader = new GLTFLoader().setDRACOLoader(draco);
    await Promise.all(Object.keys(this.entries).map((id) => this.load(id)));
    draco.dispose();
    console.info(`[assets] 已加载 ${this.loaded.size}/${Object.keys(this.entries).length} 个美术资产`);
  }

  private async load(id: string): Promise<void> {
    const entry = this.entries[id];
    try {
      const gltf = await this.loader!.loadAsync(`${BASE}${entry.url}`);
      const lods: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const match = m.isMesh ? /_LOD(\d+)$/.exec(m.name) : null;
        if (match) lods[Number(match[1])] = m;
      });
      if (lods.length === 0 || lods.some((m) => !m)) throw new Error('GLB 里没有按 _LOD<n> 命名的网格');
      gltf.scene.updateMatrixWorld(true);
      this.loaded.set(id, { id, entry, gltf, lods });
    } catch (err) {
      this.failed.add(id);
      console.warn(`[assets] ${id} 加载失败，使用程序化模型`, err);
    }
  }
}

export const AssetLibrary = new Library();

// 模块被导入即开始后台预加载（敌人模块在启动时导入本模块，早于任何敌人生成；不改动冻结的 main.ts）
void AssetLibrary.preload();
