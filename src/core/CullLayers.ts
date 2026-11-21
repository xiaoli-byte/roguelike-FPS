import type { QualityProfile } from './QualityTiers';

/**
 * 按「图层」的距离剔除（Unity G/Core/CullLayers.cs 的网页版，I4；docs/performance-unity.md「剔除」；docs/threejs-migration.md 4.7）：
 * 关卡场景搭好后把小件和散布件分成两层，按画质档给这两层一个球面距离上限，远处的小东西不画；大件（建筑、崖壁、地标、远景）永远不剔。
 * 这是「远景 impostor」的替代：模型不减面、只发一级 LOD（2026-10-25），远处不换低模，只按距离不画小件。
 *   小件 {@link CullLayer.Detail}：包围盒最长边 ≤ {@link DETAIL_MAX_SIZE} m（碎石、罐子、灯笼、小摆件）；
 *   散布 {@link CullLayer.Scatter}：≤ {@link SCATTER_MAX_SIZE} m（巨砾、灌丛、矮树、货堆、掩体石）。
 * 距离（core/QualityTiers）：高档小件 120 m、散布到雾终点（被雾吞掉之后才剔，看不出来），中 / 低档往近收。
 *
 * 与 Unity 的差异：Unity 把物体挪到图层 8 / 9、由相机的 layerCullDistances 剔；three.js 没有按层的剔除距离，
 * 这里记下每件的包围盒中心，每隔一小段（相机挪了 {@link REFRESH_MOVE} m 或距离变了）改 visible。只动场景文档里的静态网格：
 * 蒙皮 / 实例化网格、地形、水和熔岩（着色器材质）、会摆的（幡、灯笼：userData.unitySwing / unityLamp）、别人已经藏起来的都不动。
 * 碰撞、子弹、视线、地面检测不受影响（网页的碰撞体是另一份数据）。
 */
export const CullLayer = { None: -1, Detail: 8, Scatter: 9 } as const;
export type CullLayerId = (typeof CullLayer)[keyof typeof CullLayer];

export const DETAIL_MAX_SIZE = 1.6, SCATTER_MAX_SIZE = 6;
/** 雾没开 / 雾终点异常时散布层的距离上限 */
export const SCATTER_FALLBACK = 400;
/** 相机挪了这么远才重算一遍（米） */
export const REFRESH_MOVE = 1.5;

/** 包围盒最长边 → 归哪一层（−1 = 不动；Unity CullLayers.Classify 的尺寸部分） */
export function classifySize(maxSize: number): CullLayerId {
  if (!(maxSize > 0.001)) return CullLayer.None;
  return maxSize <= DETAIL_MAX_SIZE ? CullLayer.Detail : maxSize <= SCATTER_MAX_SIZE ? CullLayer.Scatter : CullLayer.None;
}

/** 这一档的两层剔除距离（米）：小件固定距离，散布 = 雾终点 × 比例（没开雾用 {@link SCATTER_FALLBACK}），不小于小件的 */
export function cullDistances(p: QualityProfile, fogEnd: number): { detail: number; scatter: number } {
  const fog = fogEnd > 50 && fogEnd < 5000 ? fogEnd : SCATTER_FALLBACK;
  return { detail: p.detailCullDistance, scatter: Math.max(p.detailCullDistance, fog * p.scatterCullFog) };
}

/** 能被剔的东西（THREE.Object3D 的那一点点） */
export interface Cullable {
  visible: boolean;
}

interface Item {
  obj: Cullable;
  layer: CullLayerId;
  x: number;
  y: number;
  z: number;
  culled: boolean;
}

/** 场景里一件网格的最小形状（THREE.Mesh 的鸭子类型：core 不引 three，node --test 直接测） */
export interface MeshLike extends Cullable {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  userData?: Record<string, unknown>;
  children?: MeshLike[];
  material?: unknown;
  geometry?: { boundingBox: { min: Vec3; max: Vec3 } | null; computeBoundingBox?(): void };
  matrixWorld?: { elements: ArrayLike<number> };
  updateMatrixWorld?(force?: boolean): void;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 世界空间的轴对齐包围盒（8 个角过 matrixWorld）：中心和最长边 */
export function worldBounds(mesh: MeshLike): { center: Vec3; size: number } | null {
  const g = mesh.geometry, m = mesh.matrixWorld?.elements;
  if (!g || !m) return null;
  if (!g.boundingBox) g.computeBoundingBox?.();
  const box = g.boundingBox;
  if (!box) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max.x : box.min.x, y = i & 2 ? box.max.y : box.min.y, z = i & 4 ? box.max.z : box.min.z;
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (!Number.isFinite(wx + wy + wz)) return null;
    minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
    minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
  }
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function isShaderMaterial(material: unknown): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.some(m => !!m && typeof m === 'object' && ((m as { isShaderMaterial?: boolean }).isShaderMaterial === true));
}

export class DistanceCuller {
  private readonly items: Item[] = [];
  private lastX = NaN;
  private lastY = NaN;
  private lastZ = NaN;
  private lastDetail = NaN;
  private lastScatter = NaN;
  /** 关掉（对照截图用）：全部放出来 */
  private off = false;
  /** 两层各多少件（Unity LastDetail / LastScatter）、现在藏着几件 */
  detailCount = 0;
  scatterCount = 0;
  culledCount = 0;

  get count(): number {
    return this.items.length;
  }

  get disabled(): boolean {
    return this.off;
  }

  set disabled(v: boolean) {
    this.off = v;
    this.lastX = NaN;
    if (v) this.showAll();
  }

  /** 换关：放出全部、清空 */
  clear(): void {
    this.showAll();
    this.items.length = 0;
    this.detailCount = this.scatterCount = this.culledCount = 0;
    this.lastX = this.lastDetail = NaN;
  }

  /** 登记一件（layer = None 的不收）。center = 世界空间包围盒中心 */
  add(obj: Cullable, layer: CullLayerId, center: Vec3): boolean {
    if (layer !== CullLayer.Detail && layer !== CullLayer.Scatter) return false;
    this.items.push({ obj, layer, x: center.x, y: center.y, z: center.z, culled: false });
    if (layer === CullLayer.Detail) this.detailCount++;
    else this.scatterCount++;
    this.lastX = NaN;
    return true;
  }

  /**
   * 给一棵场景树分层（返回收了几件）：只收看得见的静态网格；skip(节点) 为 true 的整棵子树跳过。
   * 调用前场景要已经摆好（这里会 updateMatrixWorld）
   */
  addScene(root: MeshLike, skip?: (node: MeshLike) => boolean): number {
    root.updateMatrixWorld?.(true);
    let n = 0;
    const walk = (node: MeshLike): void => {
      if (node.userData?.unitySwing || node.userData?.unityLamp || node.userData?.noCull || skip?.(node)) return;
      if (node.isMesh && !node.isSkinnedMesh && !node.isInstancedMesh && node.visible && !isShaderMaterial(node.material)) {
        const b = worldBounds(node);
        if (b && this.add(node, classifySize(b.size), b.center)) n++;
      }
      if (node.children) for (const child of node.children) walk(child);
    };
    walk(root);
    return n;
  }

  /**
   * 按相机位置和这一档的距离改 visible（球面距离：转头时不会忽隐忽现）。相机没怎么动、距离没变时什么都不做。
   * 返回这一次改了几件
   */
  update(camera: Vec3, distances: { detail: number; scatter: number }): number {
    if (this.off || this.items.length === 0) return 0;
    const dx = camera.x - this.lastX, dy = camera.y - this.lastY, dz = camera.z - this.lastZ;
    const moved = !(dx * dx + dy * dy + dz * dz < REFRESH_MOVE * REFRESH_MOVE);
    if (!moved && distances.detail === this.lastDetail && distances.scatter === this.lastScatter) return 0;
    this.lastX = camera.x; this.lastY = camera.y; this.lastZ = camera.z;
    this.lastDetail = distances.detail; this.lastScatter = distances.scatter;
    const d2 = distances.detail * distances.detail, s2 = distances.scatter * distances.scatter;
    let changed = 0, culled = 0;
    for (const it of this.items) {
      const x = it.x - camera.x, y = it.y - camera.y, z = it.z - camera.z;
      const limit = it.layer === CullLayer.Detail ? d2 : s2;
      // 距离写 0 = 不剔（同 Unity layerCullDistances 的 0：跟着相机远裁）
      const far = limit > 0 && x * x + y * y + z * z > limit;
      if (far !== it.culled) {
        // 别人藏起来的（机关、可破坏物）不去动：没剔的时候它已经不可见，就不归这里管
        if (far && !it.obj.visible) continue;
        it.culled = far;
        it.obj.visible = !far;
        changed++;
      }
      if (it.culled) culled++;
    }
    this.culledCount = culled;
    return changed;
  }

  private showAll(): void {
    for (const it of this.items) {
      if (it.culled) it.obj.visible = true;
      it.culled = false;
    }
    this.culledCount = 0;
  }
}
