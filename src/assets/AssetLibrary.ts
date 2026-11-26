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
  /**
   * 同一个绑定目标（来源 + id + 主题）有多份身体时谁优先：大的优先，缺省 0，相同按清单顺序。只读选中的那份，读不出来退到下一份。
   * 2026-11-27：七把武器同时绑了自产枪模和枪火提取 / 骨龙铳，原来取「先读完的那份」，每次进游戏不一样，按需读时还两份都读。
   * 枪火提取的六把标 1（用户 2026-11-25「暂时保留」）；对外发布前删掉那几条，就回到自产枪模
   */
  priority?: number;
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
 * 预加载范围（2026-11-25 实测：全部角色 / 武器读进来，游戏页渲染进程多占约 4.9 GB，主要是解码后的贴图）。
 * core = 英雄、第一人称手臂、灵宠、商人（主游戏开局要等到齐的那一份）；
 * enemies = 敌人 / 首领及其挂件（bind.source = 'enemy'）：主游戏不整批读，进关前由 assets/StageArt.ts 按本关会出现的预取
 * （ensureBound），换关释放用不到的（releaseUnused）；
 * weapons = 第一人称 / 掉落枪模（bind.source = 'weapon'，24 把 × 2048² 贴图，解码后约 1.5 GB）：手上的和各英雄的初始武器进关前读，
 * 掉落 / 商店 / 图鉴用到时现读（先用程序化枪模，读到后换上），换关释放其余的；
 * scene = 场景件（bind.source = 'scene'：232 条、约 120 MB），只有旧场景视图（ArenaView 路径）和检视页用——
 * Unity 关卡读自己的发布目录 public/assets/unity-levels，不经清单；
 * all = 三份都要（检视页）。
 */
export type PreloadScope = 'core' | 'enemies' | 'weapons' | 'scene' | 'all';

/** 按需读、换关可释放的绑定来源 */
export const ON_DEMAND_SOURCES: ReadonlySet<string> = new Set(['enemy', 'weapon']);

function scopeOf(e: AssetEntry): Exclude<PreloadScope, 'all'> {
  if (e.bind?.source === 'scene') return 'scene';
  if (e.bind?.source === 'enemy') return 'enemies';
  if (e.bind?.source === 'weapon') return 'weapons';
  return 'core';
}

/** 同一绑定目标的几份身体排先后：该主题的变体压过默认的，再看 priority */
function rank(e: AssetEntry, variant?: string): number {
  return (variant && e.bind?.variant === variant ? 1000 : 0) + (e.priority ?? 0);
}

/** 一个资产的身体 + 挂件是否属于这批绑定目标（variant 给了：该主题的和不带主题的；没给：全部变体） */
function boundTo(e: AssetEntry, source: string, ids: ReadonlySet<string>, variant?: string): boolean {
  const b = e.bind;
  return !!b && b.source === source && ids.has(b.id) && (!variant || !b.variant || b.variant === variant);
}

class Library {
  private entries: Record<string, AssetEntry> = {};
  private loaded = new Map<string, LoadedAsset>();
  private failed = new Set<string>();
  private manifestReady: Promise<boolean> | null = null;
  private readonly scopes = new Map<PreloadScope, Promise<void>>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly releaseListeners: ((id: string) => void)[] = [];

  /**
   * 读清单并加载一个范围的资产（同一范围只读一次，重复调用拿同一个 Promise）。
   * 模块导入时就在后台开始读 core；用场景件的地方调 preload('scene')，资产到了再重建。
   */
  preload(scope: PreloadScope = 'core'): Promise<void> {
    if (disabled) return Promise.resolve();
    let ready = this.scopes.get(scope);
    if (!ready) {
      ready = scope === 'all'
        ? Promise.all([this.preload('core'), this.preload('enemies'), this.preload('weapons'), this.preload('scene')]).then(() => undefined)
        : this.loadScope(scope);
      this.scopes.set(scope, ready);
    }
    return ready;
  }

  /**
   * 读这些绑定目标的资产（身体 + 挂件），读完 resolve（失败的照旧记进 unavailable，调用方退回程序化模型）。
   * 例：ensureBound('enemy', ['grunt', 'boss_hanba'], 'desert')
   */
  async ensureBound(source: string, ids: Iterable<string>, variant?: string): Promise<void> {
    if (disabled || !await this.readManifest()) return;
    const want = new Set(ids);
    // 挂件全读；身体每个目标只读优先的那份，读不出来再试下一份（一轮一批，免得每份各起一套 Draco 解码线程）
    const attachments = Object.keys(this.entries).filter((a) => boundTo(this.entries[a], source, want, variant) && this.entries[a].bind.attachment);
    let pending = [...want];
    for (let round = 0; pending.length > 0 || round === 0; round++) {
      const picks = pending
        .map((id) => ({ id, asset: this.bodyCandidates(source, id, variant).find((a) => !this.failed.has(a)) }))
        .filter((p): p is { id: string; asset: string } => !!p.asset);
      await this.loadIds([...picks.map((p) => p.asset), ...(round === 0 ? attachments : [])]);
      pending = picks.filter((p) => !this.loaded.has(p.asset)).map((p) => p.id);
    }
  }

  /** 绑到这个目标的身体（不含挂件），按优先次序：该主题的变体在前，再按 priority 大的在前、清单顺序 */
  private bodyCandidates(source: string, id: string, variant?: string): string[] {
    const ids = Object.keys(this.entries);
    return ids
      .filter((a) => {
        const b = this.entries[a].bind;
        return b?.source === source && b.id === id && !b.attachment && (!b.variant || b.variant === variant);
      })
      .sort((a, b) => rank(this.entries[b], variant) - rank(this.entries[a], variant) || ids.indexOf(a) - ids.indexOf(b));
  }

  /**
   * 同步版的补读：这个绑定目标清单里有、但还没读到时开始读（不等），返回 true = 读到之后再来取就有。
   * 漏预取的敌人（召唤物、调试刷怪）第一只用程序化模型，后面的就有美术；图鉴缩略图据此决定「等一等」还是「没有模型」。
   */
  request(source: string, id: string, variant?: string): boolean {
    if (disabled) return false;
    if (Object.keys(this.entries).length === 0) {
      void this.ensureBound(source, [id], variant);
      return true;
    }
    const want = new Set([id]);
    const usable = Object.keys(this.entries).filter((a) => boundTo(this.entries[a], source, want, variant) && !this.failed.has(a));
    if (usable.length === 0) return false;
    if (!this.findBound(source, id, variant) || usable.some((a) => this.entries[a].bind.attachment && !this.loaded.has(a))) {
      void this.ensureBound(source, [id], variant);
    }
    return true;
  }

  /**
   * 释放按需读的资产里不在 keep（资产 id）中的：几何体、材质、贴图交还 GPU，解码后的图（ImageBitmap）立刻关掉。
   * 只在没有实例在用的时候调（换关：上一关的敌人已经清掉之后）。还在读的不动。返回释放了几个
   */
  releaseUnused(keep: ReadonlySet<string>): number {
    let n = 0;
    for (const [id, asset] of this.loaded) {
      if (!ON_DEMAND_SOURCES.has(asset.entry.bind?.source ?? '') || keep.has(id)) continue;
      for (const listener of this.releaseListeners) listener(id);
      disposeAsset(asset);
      this.loaded.delete(id);
      this.pending.delete(id);
      n++;
    }
    return n;
  }

  /** 资产被释放前通知（按资产缓存了派生数据的模块据此清缓存：RigidParts 拆好的枪模部件） */
  onRelease(listener: (id: string) => void): void {
    this.releaseListeners.push(listener);
  }

  /** 清单里绑定到这些目标的资产 id（清单没读到时为空） */
  boundIds(source: string, ids: Iterable<string>, variant?: string): string[] {
    const want = new Set(ids);
    return Object.keys(this.entries).filter((id) => boundTo(this.entries[id], source, want, variant));
  }

  /** 清单里某个绑定来源的全部绑定目标 id（如 'enemy' → grunt、boss_kunpeng_kun …；清单没读到时为空） */
  knownBindIds(source: string): string[] {
    const ids = new Set<string>();
    for (const e of Object.values(this.entries)) if (e.bind?.source === source) ids.add(e.bind.id);
    return [...ids];
  }

  /** 当前已读进来的资产 id（检视 / 测试用） */
  loadedIds(): string[] {
    return [...this.loaded.keys()];
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
    // 同一目标读进来了多份身体时（检视页整批读）按 priority 取，相同取先登记的——不看哪份先读完
    let best: LoadedAsset | null = null;
    const order = (a: LoadedAsset): number => Object.keys(this.entries).indexOf(a.id);
    for (const a of this.loaded.values()) {
      const b = a.entry.bind;
      if (b?.source !== source || b.id !== id || b.attachment || (b.variant && b.variant !== variant)) continue;
      const d = best ? rank(a.entry, variant) - rank(best.entry, variant) : 1;
      if (d > 0 || (d === 0 && order(a) < order(best!))) best = a;
    }
    return best;
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

  private async loadScope(scope: Exclude<PreloadScope, 'all'>): Promise<void> {
    if (!await this.readManifest()) return;
    const ids = Object.keys(this.entries).filter((id) => scopeOf(this.entries[id]) === scope);
    await this.loadIds(ids);
    const done = ids.filter((id) => this.loaded.has(id)).length;
    const label = { core: '英雄 / 手臂 / 灵宠', enemies: '敌人 / 首领', weapons: '枪模', scene: '场景件' }[scope];
    console.info(`[assets] ${label}：已加载 ${done}/${ids.length} 个美术资产`);
  }

  /** 读一批资产（已读的跳过，正在读的等它）：每批一套加载器，读完就释放 Draco 解码线程（DRACOLoader.dispose 之后不能再用，所以不跨批共用）。
   *  three r186 的 DRACOLoader 默认用 import.meta.url 定位解码器，Vite 会把它打进产物，不需要另外拷贝 */
  private async loadIds(ids: readonly string[]): Promise<void> {
    const todo = ids.filter((id) => !this.loaded.has(id) && !this.failed.has(id));
    if (todo.length === 0) return;
    const draco = new DRACOLoader();
    const loader = new GLTFLoader().setDRACOLoader(draco);
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map((id) => this.load(id, loader)));
    draco.dispose();
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

/** 交还一个资产的 GPU 资源并关掉解码后的图（ImageBitmap 不关的话要等 GC，内存迟迟不降） */
function disposeAsset(asset: LoadedAsset): void {
  const textures = new Set<THREE.Texture>();
  asset.gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh as THREE.SkinnedMesh).skeleton?.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      material.dispose();
    }
  });
  for (const texture of textures) {
    texture.dispose();
    const image = texture.image as { close?: () => void } | null;
    if (typeof image?.close === 'function') image.close();
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
