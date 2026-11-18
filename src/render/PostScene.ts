import * as THREE from 'three';
import { evaluateVolumes, type SceneVolumeData, type VolumeLayer, type VolumeParams, type VolumesDocument } from './UrpVolume';

/**
 * 当前关卡的后处理数据（全局一份，和 Atmosphere 一样是模块级的）：
 *   · 场景的 Volume（volumes.json，Unity 关卡导出的）——PostStack 在 stage:loaded 时认出 Unity 场景的根节点
 *     （UnitySceneView 的 unity-scene-<id>）就 load(id)，根节点离开场景就 clear()；
 *   · 运行时的 Volume 层（玩法屏效、以后的天气 / 首领）——addLayer() 登记，返回注销函数；
 *   · 显示空间的叠加物（SunShafts 光柱：拷画布、按显示空间的值做的）——在关卡根节点里按名字找，
 *     PostStack 在调色之后、枪模之前把它们画到画布上（见 PostStack 的说明）。
 * 没有载入场景（主菜单、非 Unity 场景）时 active = false，PostStack 不接管，照原样直接画到画布。
 */
class PostSceneState {
  private doc: VolumesDocument | null = null;
  private pending: Promise<VolumesDocument | null> | null = null;
  private sceneData: SceneVolumeData | null = null;
  private id: string | null = null;
  private readonly runtime = new Set<VolumeLayer>();
  private readonly listeners = new Set<() => void>();
  /** 显示空间叠加物（SunShafts 的网格），在世界场景里 */
  overlays: THREE.Mesh[] = [];

  get active(): boolean {
    return this.sceneData !== null;
  }

  get sceneId(): string | null {
    return this.id;
  }

  get scene(): SceneVolumeData | null {
    return this.sceneData;
  }

  get document(): VolumesDocument | null {
    return this.doc;
  }

  /** volumes.json（第一次要的时候读，之后缓存；读不到 = null，网页照原样画） */
  fetchDocument(): Promise<VolumesDocument | null> {
    if (this.doc) return Promise.resolve(this.doc);
    if (!this.pending) {
      const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      this.pending = fetch(`${base}assets/unity-levels/volumes.json`)
        .then(r => (r.ok ? r.json() as Promise<VolumesDocument> : null))
        .then(doc => (this.doc = doc))
        .catch(err => {
          console.warn('[post] volumes.json 读不到，后处理关闭', err);
          this.pending = null;
          return null;
        });
    }
    return this.pending;
  }

  /**
   * 载入关卡 id 的 Volume；root = 关卡根节点（找 SunShafts）。volumes.json 已经在缓存里时同步生效
   * （PostStack 在 stage:loaded 里调，要赶在同一个事件里的着色器预热之前），否则读完再生效。
   */
  load(id: string, root?: THREE.Object3D | null): Promise<void> {
    this.id = id;
    if (this.doc) {
      this.apply(id, root);
      return Promise.resolve();
    }
    return this.fetchDocument().then(() => {
      if (this.id === id) this.apply(id, root);
    });
  }

  /** 卸载关卡 */
  clear(): void {
    if (this.id === null && !this.sceneData) return;
    this.id = null;
    this.sceneData = null;
    this.overlays = [];
    this.changed();
  }

  private apply(id: string, root?: THREE.Object3D | null): void {
    this.sceneData = this.doc?.scenes[id] ?? null;
    if (this.doc && !this.sceneData) console.warn(`[post] volumes.json 里没有关卡 ${id}，后处理关闭`);
    this.overlays = [];
    root?.traverse(object => {
      if (object.name === 'SunShafts' && (object as THREE.Mesh).isMesh) this.overlays.push(object as THREE.Mesh);
    });
    this.changed();
  }

  /**
   * 运行时的 Volume 层（天气、首领、机关……）：和场景 Volume 一起按优先级混，权重随时改（layer.weight）。
   * 返回注销函数。玩法屏效（GameplayVolumes）也走这里。
   */
  addLayer(layer: VolumeLayer): () => void {
    this.runtime.add(layer);
    return () => this.runtime.delete(layer);
  }

  /** 场景载入 / 卸载时通知（PostStack 借此提前切渲染状态，让换关时的着色器预编译命中后处理用的变体） */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 混好的整个栈；camera = 相机世界坐标（局部 Volume 用），null 只算全局 */
  evaluate(camera: THREE.Vector3 | null): VolumeParams {
    return evaluateVolumes(this.doc, this.sceneData, this.runtime, camera ? [camera.x, camera.y, camera.z] : null);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

export const postScene = new PostSceneState();
