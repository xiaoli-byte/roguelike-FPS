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
  /** 高清贴图版本（画质「高」时加载，同一套网格与骨骼，贴图 2048）；切换画质后重新进游戏生效 */
  hiUrl?: string;
  bytes?: number;
  kind: 'skeletal' | 'static';
  class: string;
  /** 绑定目标；attachment 为挂点名时表示挂在该挂点上的静态网格（武器 / 盾 / 法器） */
  bind: { source: string; id: string; attachment?: string; variant?: string };
  /** 运行时保留白模上的哪些发光部件：all / attachments（只留武器等挂件上的）/ none */
  keepGlow: 'all' | 'attachments' | 'none';
  /** 各级 LOD 的切换距离（米） */
  lodDistance: number[];
  /** 骨骼适配后的绑定姿势（人形：左右上臂外展角，弧度）；缺省用 HumanoidBind 的默认角 */
  bindPose?: { armSpreadL: number; armSpreadR: number };
  /** 通用部件骨架（非人形）：骨架指纹 = [节点路径名, 静止局部位置]，见 PartsRig.ts */
  rig?: { mode: 'parts'; joints: [string, number[]][]; keep?: string[] };
  /** 资产自带骨骼、运行时直接驱动（Tripo 英雄：Mixamo 命名的 65 骨），不做部件骨架重映射 */
  skeleton?: { mode: 'native'; convention: 'mixamo' | 'creature'; joints: number };
  bounds: { min: number[]; max: number[] };
  sha256: string;
  /** Local shape generator used for this published build; older entries may omit it. */
  generator?: { tool: string; mode: string; checkpoint: string };
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

/**
 * 预加载范围。core = 角色、首领、挂件、武器、手臂、灵宠、商人（主游戏开局要等到齐的那一份）；
 * scene = 场景件（bind.source = 'scene'：232 条、约 120 MB、上千张 1024–2048 贴图），只有旧场景视图（ArenaView 路径）
 * 和检视页用——Unity 关卡读自己的发布目录 public/assets/unity-levels，不经清单。2026-11-25 前开局把两份一起读完才进第一关。
 * all = 两份都要（检视页）。
 */
export type PreloadScope = 'core' | 'scene' | 'all';

const isSceneEntry = (e: AssetEntry): boolean => e.bind?.source === 'scene';

class Library {
  private entries: Record<string, AssetEntry> = {};
  private loaded = new Map<string, LoadedAsset>();
  private failed = new Set<string>();
  private manifestReady: Promise<boolean> | null = null;
  private readonly scopes = new Map<PreloadScope, Promise<void>>();
  private readonly pending = new Map<string, Promise<void>>();

  /**
   * 读清单并加载一个范围的资产（同一范围只读一次，重复调用拿同一个 Promise）。
   * 模块导入时就在后台开始读 core；用场景件的地方调 preload('scene')，资产到了再重建。
   */
  preload(scope: PreloadScope = 'core'): Promise<void> {
    if (disabled) return Promise.resolve();
    let ready = this.scopes.get(scope);
    if (!ready) {
      ready = scope === 'all' ? Promise.all([this.preload('core'), this.preload('scene')]).then(() => undefined) : this.loadScope(scope);
      this.scopes.set(scope, ready);
    }
    return ready;
  }

  /** 已加载的资产；未加载完 / 失败 / 被禁用时为 null */
  get(id: string): LoadedAsset | null {
    return this.loaded.get(id) ?? null;
  }

  /** 确定不会再出现的资产：清单已读到但不含它，或加载失败（清单未就绪时为 false，仍可能加载到） */
  unavailable(id: string): boolean {
    return this.failed.has(id) || (Object.keys(this.entries).length > 0 && !(id in this.entries));
  }

  /**
   * 按绑定目标查找身体资产（如 { source: 'enemy', id: 'grunt' }），不含挂件。
   * variant 是章节主题（desert / frost / inferno）：有该主题的变体就用变体，否则回退到不带 variant 的默认资产。
   */
  findBound(source: string, id: string, variant?: string): LoadedAsset | null {
    let fallback: LoadedAsset | null = null;
    for (const a of this.loaded.values()) {
      const b = a.entry.bind;
      if (b?.source !== source || b.id !== id || b.attachment) continue;
      if (variant && b.variant === variant) return a;
      if (!b.variant && !fallback) fallback = a;
    }
    return fallback;
  }

  /** 绑定到某个目标各挂点上的静态网格；variant 同 findBound：该主题有挂件变体就整套换用，否则用默认挂件 */
  findAttachments(source: string, id: string, variant?: string): LoadedAsset[] {
    const all: LoadedAsset[] = [];
    for (const a of this.loaded.values()) {
      const b = a.entry.bind;
      if (b?.source === source && b.id === id && b.attachment) all.push(a);
    }
    const themed = variant ? all.filter((a) => a.entry.bind.variant === variant) : [];
    return themed.length > 0 ? themed : all.filter((a) => !a.entry.bind.variant);
  }

  get enabled(): boolean {
    return !disabled;
  }

  private readManifest(): Promise<boolean> {
    this.manifestReady ??= (async () => {
      try {
        const r = await fetch(`${BASE}assets/manifest.json`, { cache: 'no-cache' });
        if (!r.ok) return false;
        this.entries = ((await r.json()) as { assets?: Record<string, AssetEntry> }).assets ?? {};
        return true;
      } catch {
        return false;
      }
    })();
    return this.manifestReady;
  }

  private async loadScope(scope: 'core' | 'scene'): Promise<void> {
    if (!await this.readManifest()) return;
    const ids = Object.keys(this.entries).filter((id) => isSceneEntry(this.entries[id]) === (scope === 'scene'));
    // 每个范围一套加载器，读完就释放 Draco 解码线程（DRACOLoader.dispose 之后不能再用，所以不跨范围共用）。
    // three r186 的 DRACOLoader 默认用 import.meta.url 定位解码器，Vite 会把它打进产物，不需要另外拷贝
    const draco = new DRACOLoader();
    const loader = new GLTFLoader().setDRACOLoader(draco);
    for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map((id) => this.load(id, loader)));
    draco.dispose();
    const done = ids.filter((id) => this.loaded.has(id)).length;
    console.info(`[assets] ${scope === 'core' ? '角色 / 武器' : '场景件'}：已加载 ${done}/${ids.length} 个美术资产`);
  }

  private load(id: string, loader: GLTFLoader): Promise<void> {
    let pending = this.pending.get(id);
    if (!pending) {
      pending = this.loadOne(id, loader);
      this.pending.set(id, pending);
    }
    return pending;
  }

  private async loadOne(id: string, loader: GLTFLoader): Promise<void> {
    const entry = this.entries[id];
    try {
      const gltf = await loader.loadAsync(`${BASE}${entry.hiUrl && highQuality() ? entry.hiUrl : entry.url}`);
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

/**
 * 画质设置为「高」（读不到设置时按默认的高画质）。直接读存档，不引入 core/settings：
 * 本模块在测试里会被单独加载（tests/asset-variant.test.mjs）。M11d 起设置存在 spiritfire.save/settings.json 的「settings」段
 * （core/GameSettings.ts：entries 里只有和默认值不一样的项，quality 是下标 0 / 1 / 2，缺省 2 = 高）；
 * 还没有这个文件时读老键 gunflame.settings.v1（第一次启动时由 GameSettings 导入）。
 */
function highQuality(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const file = localStorage.getItem('spiritfire.save/settings.json');
    if (file) {
      const entries = (JSON.parse(file) as { sections?: { settings?: { data?: { entries?: { key?: string; value?: number }[] } } } }).sections?.settings?.data?.entries;
      if (Array.isArray(entries)) return (entries.find(e => e?.key === 'quality')?.value ?? 2) >= 1.5;
    }
    const raw = localStorage.getItem('gunflame.settings.v1');
    const quality = raw ? (JSON.parse(raw) as { quality?: string }).quality : undefined;
    return (quality ?? 'high') === 'high';
  } catch {
    return true;
  }
}

export const AssetLibrary = new Library();

// 模块被导入即开始后台预加载（敌人模块在启动时导入本模块，早于任何敌人生成；不改动冻结的 main.ts）
void AssetLibrary.preload();
