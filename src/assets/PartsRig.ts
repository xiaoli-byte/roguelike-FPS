/**
 * 通用部件骨架：把任意节点层级的程序化模型（自爆兵、飞灯、Boss……）当作骨架。
 *
 * - 骨骼 = 模型里的每个非网格节点，名字是从模型根出发的子节点索引路径（jointPaths），白模导出器与运行时共用同一个函数，
 *   所以只要 buildModel 的代码不变，名字就一一对应。
 * - 清单里记录骨架指纹（每个节点的路径与静止局部位置）；运行时逐一核对，代码改了对不上就放弃绑定、保留程序化模型，绝不绑错。
 * - 绑定姿势 = 模型构建出来的姿势；权重由管线按「离哪个白模部件最近」生成（部件内近似刚性，交界处平滑过渡）。
 */
import * as THREE from 'three';
import type { LoadedAsset } from './AssetLibrary';
import { snapToSurface, type SkinnedBody } from './SkinnedBody';

/**
 * 非网格节点 → 路径名。根节点是 j_r，其余是 j_<各级子节点索引>（下划线分隔：GLTFLoader 会删掉名字里的 . : / 等保留字符）。
 * 遍历顺序是深度优先、按 children 顺序。
 */
export function jointPaths(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  const walk = (o: THREE.Object3D, path: string): void => {
    out.set(path, o);
    o.children.forEach((c, i) => {
      if (!(c as THREE.Mesh).isMesh) walk(c, path === 'j_r' ? `j_${i}` : `${path}_${i}`);
    });
  };
  walk(root, 'j_r');
  return out;
}

const _inv = new THREE.Matrix4();
const FINGERPRINT_TOLERANCE = 2e-3;

/**
 * @param host buildModel 返回的模型根（必须还处在构建姿势：在任何动画运行之前调用）
 * @param keep 不隐藏的子树（例如已经换上美术资产的命名挂点）
 */
export function attachPartsBody(host: THREE.Object3D, asset: LoadedAsset, lodScale = 1, keep: THREE.Object3D[] = []): SkinnedBody | null {
  const rig = asset.entry.rig;
  if (!rig) return null;
  const paths = jointPaths(host);
  // 骨架指纹：路径存在、是非网格节点、静止局部位置一致
  for (const [name, pos] of rig.joints) {
    const o = paths.get(name);
    if (!o || o.position.distanceTo(_v.fromArray(pos)) > FINGERPRINT_TOLERANCE) {
      console.warn(`[assets] ${asset.id} 骨架指纹不符（${name}），模型代码可能改过，保留程序化模型`);
      return null;
    }
  }
  const order: THREE.Object3D[][] = [];
  for (const src of asset.lods) {
    const sk = (src as THREE.SkinnedMesh).skeleton;
    if (!sk) return null;
    const bones = sk.bones.map((b) => paths.get(b.name));
    if (bones.some((b) => !b)) {
      console.warn(`[assets] ${asset.id} 的骨骼在模型里找不到：${sk.bones.filter((b) => !paths.get(b.name)).map((b) => b.name).join(',')}`);
      return null;
    }
    order.push(bones as THREE.Object3D[]);
  }

  // 绑定姿势 = 当前（构建）姿势
  host.updateWorldMatrix(true, true);
  _inv.copy(host.matrixWorld).invert();
  const inverseOf = new Map<THREE.Object3D, THREE.Matrix4>();
  for (const bones of order) {
    for (const j of bones) if (!inverseOf.has(j)) inverseOf.set(j, new THREE.Matrix4().multiplyMatrices(_inv, j.matrixWorld).invert());
  }

  // 隐藏被取代的实体部件；发光件（MeshBasicMaterial）、keep 子树、清单里声明保留的子树（环绕浮石、冰翼……）不动
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => kept.add(o));
  for (const name of rig.keep ?? []) paths.get(name)?.traverse((o) => kept.add(o));
  const glows: THREE.Mesh[] = [];
  host.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || kept.has(m)) return;
    if ((m.material as THREE.Material).type !== 'MeshBasicMaterial') m.visible = false;
    else glows.push(m);
  });
  // 小发光件（眼睛、面甲缝）贴到美术网格表面并缩小，落在贴图画好的眼睛里（同人形敌人）；大的光团、加法光环不动
  snapToSurface(glows, asset.lods[0].geometry, _inv);

  const material = (asset.lods[0].material as THREE.MeshStandardMaterial).clone();
  const b = asset.entry.bounds;
  const center = new THREE.Vector3().fromArray(b.min).add(_v.fromArray(b.max)).multiplyScalar(0.5);
  const radius = new THREE.Vector3().fromArray(b.max).sub(_v.fromArray(b.min)).length() * 0.75;
  const sphere = new THREE.Sphere(center, radius);
  const lod = new THREE.LOD();
  lod.name = `${asset.id}_lod`;
  const skeletons: THREE.Skeleton[] = [];
  asset.lods.forEach((src, i) => {
    const mesh = new THREE.SkinnedMesh(src.geometry, material);
    mesh.name = src.name;
    const bones = order[i];
    const skeleton = new THREE.Skeleton(bones as unknown as THREE.Bone[], bones.map((j) => inverseOf.get(j)!.clone()));
    skeletons.push(skeleton);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.boundingSphere = sphere;
    mesh.castShadow = true;
    lod.addLevel(mesh, (asset.entry.lodDistance[i] ?? i * 15) * lodScale, 0.1);
  });
  host.add(lod);
  return {
    lod,
    materials: [material],
    dispose: () => {
      for (const s of skeletons) s.dispose();
      skeletons.length = 0;
    },
  };
}

const _v = new THREE.Vector3();
