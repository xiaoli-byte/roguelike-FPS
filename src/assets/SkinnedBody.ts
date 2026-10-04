/**
 * 把美术管线产出的骨骼网格（SK_*）蒙皮到敌人现有的程序化人形骨骼上。
 *
 * 资产的骨骼名就是 HumanoidRig 的关节名，蒙皮在 A-pose 绑定（见 HumanoidBind.ts）。这里不使用 GLB 自带的骨骼，
 * 而是用游戏关节本身作为骨骼：在绑定姿势下取关节相对模型根的矩阵求逆作为 boneInverses，
 * 之后程序动画照常旋转关节，SkinnedMesh 自动跟随 —— 动画代码、头部判定、武器挂点都不用改。
 *
 * 程序化模型里直接挂在关节上的身体部件被隐藏（由高精度模型取代）；武器等挂件保留；
 * 身体上的发光部件（眼睛等）按资产清单的 keepGlow 决定是否保留。
 */
import * as THREE from 'three';
import type { HumanoidRig } from '../enemies/Models';
import type { LoadedAsset } from './AssetLibrary';
import { applyBindPose, HUMANOID_JOINTS } from './HumanoidBind';
import { articulationGeometry } from './ArticulationWeights';

export interface SkinnedBody {
  lod: THREE.LOD;
  /** 本实例独占的材质（调用方负责登记释放 / 受击闪白） */
  materials: THREE.MeshStandardMaterial[];
  /** 释放本实例的骨骼纹理（几何体与贴图是共享的，不释放） */
  dispose(): void;
}

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _probeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const GLOW_SCALE = 0.6;

/**
 * 白模的发光件按方块脑袋的脸面摆放，美术网格的脸往往更靠里（兜帽里的骷髅）或更靠外。
 * 在绑定姿势下从发光件前方 0.3 米沿父关节的 −Z 发射线，打到美术网格最外层表面，把发光件贴到表面前 6 毫米。
 * 只处理小尺寸的普通混合发光件（眼睛、面甲缝），加法混合的光环 / 法阵不动。
 * @param hostInv host 世界矩阵的逆（几何体的绑定姿势坐标就在 host 空间里）
 */
export function snapToSurface(parts: THREE.Mesh[], geometry: THREE.BufferGeometry, hostInv: THREE.Matrix4): void {
  if (parts.length === 0) return;
  const probe = new THREE.Mesh(geometry, _probeMat);
  probe.updateMatrixWorld(true);
  for (const m of parts) {
    const mat = m.material as THREE.MeshBasicMaterial;
    if (mat.blending !== THREE.NormalBlending) continue;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    if (m.geometry.boundingSphere!.radius > 0.15) continue;
    const parent = m.parent!;
    _rel.multiplyMatrices(hostInv, parent.matrixWorld);
    _p.copy(m.position).applyMatrix4(_rel);
    _d.set(0, 0, 1).transformDirection(_rel);
    _ray.set(_p.clone().addScaledVector(_d, 0.3), _d.clone().negate());
    _ray.far = 0.6;
    const hit = _ray.intersectObject(probe, false)[0];
    if (!hit || hit.point.distanceTo(_p) > 0.25) continue;
    hit.point.addScaledVector(_d, 0.006).applyMatrix4(_rel.invert());
    m.position.copy(hit.point);
    // 贴图里已经画了发光的眼睛，发光件只负责前摇提亮：缩小后落在画好的眼睛里，不再像一副方框眼镜
    m.scale.multiplyScalar(GLOW_SCALE);
  }
}

/**
 * @param host buildModel 返回的模型根（关节的祖先）
 * @param lodScale LOD 切换距离倍率（低画质 < 1，更早切到低模）
 */
export function attachSkinnedBody(host: THREE.Object3D, rig: HumanoidRig, asset: LoadedAsset, lodScale = 1): SkinnedBody | null {
  const joints = new Map<string, THREE.Object3D>(HUMANOID_JOINTS.map((k) => [k, rig[k]]));
  const jointSet = new Set(joints.values());

  // 每级 LOD 的骨骼顺序按 GLB 的 skin.joints；必须能全部映射到游戏关节
  const order: THREE.Object3D[][] = [];
  for (const src of asset.lods) {
    const sk = (src as THREE.SkinnedMesh).skeleton;
    if (!sk) return null;
    const bones = sk.bones.map((b) => joints.get(b.name));
    if (bones.some((b) => !b)) {
      console.warn(`[assets] ${asset.id} 的骨骼与人形关节对不上：${sk.bones.map((b) => b.name).join(',')}`);
      return null;
    }
    order.push(bones as THREE.Object3D[]);
  }

  // 绑定姿势下求逆绑定矩阵（相对 host，与 host 当前的世界变换无关），然后还原姿势
  const saved = HUMANOID_JOINTS.map((k) => [rig[k].position.clone(), rig[k].rotation.clone()] as const);
  const bp = asset.entry.bindPose;
  if (bp) applyBindPose(rig, bp.armSpreadL, bp.armSpreadR);
  else applyBindPose(rig);
  host.updateWorldMatrix(true, true);
  _inv.copy(host.matrixWorld).invert();
  const inverseOf = new Map<THREE.Object3D, THREE.Matrix4>();
  for (const j of jointSet) inverseOf.set(j, new THREE.Matrix4().multiplyMatrices(_inv, j.matrixWorld).invert());

  // 隐藏被取代的程序化身体部件；保留的身体发光件（眼睛、面甲缝）吸附到美术网格表面
  const keepGlow = asset.entry.keepGlow;
  const kept: THREE.Mesh[] = [];
  host.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !jointSet.has(m.parent as THREE.Object3D)) return;
    const glow = (m.material as THREE.Material).type === 'MeshBasicMaterial';
    if (!glow || keepGlow !== 'all') m.visible = false;
    else kept.push(m);
  });
  snapToSurface(kept, asset.lods[0].geometry, _inv);

  HUMANOID_JOINTS.forEach((k, i) => {
    rig[k].position.copy(saved[i][0]);
    rig[k].rotation.copy(saved[i][1]);
  });

  const material = ((asset.lods[0].material as THREE.MeshStandardMaterial).clone());
  const b = asset.entry.bounds;
  const height = b.max[1] - b.min[1];
  const sphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height * 0.85);
  const lod = new THREE.LOD();
  lod.name = `${asset.id}_lod`;
  const skeletons: THREE.Skeleton[] = [];
  asset.lods.forEach((src, i) => {
    const bones = order[i];
    const inverses = bones.map((j) => inverseOf.get(j)!.clone());
    const geometry = articulationGeometry(asset.id, src.geometry, bones.map(b => HUMANOID_JOINTS.find(k => rig[k] === b)!), inverses);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = src.name;
    const skeleton = new THREE.Skeleton(bones as unknown as THREE.Bone[], inverses);
    skeletons.push(skeleton);
    mesh.bind(skeleton, new THREE.Matrix4());
    // 程序动画会把手臂举过头顶：用静态的宽松包围球做视锥剔除，避免逐帧按骨骼重算
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
