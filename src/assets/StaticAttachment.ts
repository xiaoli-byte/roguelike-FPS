/**
 * 把美术管线产出的静态网格（SM_*，武器 / 盾 / 法器）挂到程序化模型的命名挂点上。
 *
 * 资产的原点就是挂点（buildModel 里命名过的子节点，如 blade.name = 'scimitar'），坐标是挂点的局部空间，
 * 所以直接作为挂点的子节点加入即可：挂点的瞄准俯仰、抬举等程序动画照常生效。
 * 挂点下直接挂着的脚本实体部件被隐藏；发光提示件（刀刃、弩矢、盾徽、炮口、法珠）保留，前摇提示不丢。
 */
import * as THREE from 'three';
import type { LoadedAsset } from './AssetLibrary';

export interface AttachedPart {
  lod: THREE.LOD;
  /** 本实例独占的材质（调用方负责登记释放 / 受击闪白） */
  materials: THREE.MeshStandardMaterial[];
  /** 挂点下保留的发光提示件（美术贴图里已画了发光元素，调用方把它们改成「只在前摇时亮」） */
  glows: THREE.Mesh[];
}

/**
 * @param host buildModel 返回的模型根
 * @param lodScale LOD 切换距离倍率（低画质 < 1）
 * @returns 找不到挂点时为 null（资产与代码对不上，保持程序化模型）
 */
export function attachStaticPart(host: THREE.Object3D, asset: LoadedAsset, lodScale = 1): AttachedPart | null {
  const name = asset.entry.bind.attachment;
  const socket = name ? host.getObjectByName(name) : undefined;
  if (!socket) {
    console.warn(`[assets] ${asset.id}：模型里没有挂点 ${name}`);
    return null;
  }
  const glows: THREE.Mesh[] = [];
  for (const c of socket.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh) continue;
    if ((m.material as THREE.Material).type !== 'MeshBasicMaterial') m.visible = false;
    else glows.push(m);
  }
  const material = (asset.lods[0].material as THREE.MeshStandardMaterial).clone();
  const lod = new THREE.LOD();
  lod.name = `${asset.id}_lod`;
  asset.lods.forEach((src, i) => {
    const mesh = new THREE.Mesh(src.geometry, material);
    mesh.name = src.name;
    mesh.castShadow = true;
    lod.addLevel(mesh, (asset.entry.lodDistance[i] ?? i * 15) * lodScale, 0.1);
  });
  socket.add(lod);
  return { lod, materials: [material], glows };
}
