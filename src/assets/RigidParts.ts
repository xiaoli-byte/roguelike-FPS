/**
 * 刚体部件资产的运行时接入（第一人称武器 / 掉落模型）。
 *
 * 管线对刚体资产（rig_rigid）做了刚体分段：美术网格的每个面只属于一个部件、100% 跟随一根骨骼。
 * 所以运行时不需要蒙皮：按骨骼把网格拆成几块普通网格，分别挂到程序化模型里对应的节点下，
 * 弹匣、转轮、泵动护木等照旧由原来的程序动画驱动。没有骨骼贴图，换枪 / 丢枪时也不用逐实例释放。
 *
 * 拆分结果按资产缓存（同一份 buildModel 代码构建出的模型绑定姿势相同），实例之间共享几何体与材质——调用方不要 dispose。
 */
import * as THREE from 'three';
import type { LoadedAsset } from './AssetLibrary';
import { applyArtEnvironment } from './ArtEnvironment';
import { jointPaths } from './PartsRig';

interface Piece {
  /** 关节路径名 */
  joint: string;
  /** 每级 LOD 的几何体（关节局部空间）；该级没有这个部件时为 null */
  geos: (THREE.BufferGeometry | null)[];
}

interface Split {
  pieces: Piece[];
  material: THREE.MeshStandardMaterial;
}

const cache = new Map<string, Split | null>();
const FINGERPRINT_TOLERANCE = 2e-3;
const _v = new THREE.Vector3();
const _hostInv = new THREE.Matrix4();
const _toLocal = new THREE.Matrix4();
const _nrm = new THREE.Matrix3();

/** 骨架指纹：清单里的每个关节路径都存在、静止局部位置一致 */
function fingerprintOk(asset: LoadedAsset, paths: Map<string, THREE.Object3D>): boolean {
  for (const [name, pos] of asset.entry.rig?.joints ?? []) {
    const o = paths.get(name);
    if (!o || o.position.distanceTo(_v.fromArray(pos)) > FINGERPRINT_TOLERANCE) {
      console.warn(`[assets] ${asset.id} 骨架指纹不符（${name}），模型代码可能改过，保留程序化模型`);
      return false;
    }
  }
  return true;
}

/** 按骨骼拆分一级 LOD：每根骨骼一块几何体，顶点转到该关节的局部空间（host 处在绑定姿势） */
function splitLod(src: THREE.SkinnedMesh, paths: Map<string, THREE.Object3D>): Map<string, THREE.BufferGeometry> {
  const g = src.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const tan = g.getAttribute('tangent');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const index = g.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vid = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // 每个顶点的主导骨骼（刚体分段后只有一个非零权重）
  const boneOf = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (sw.getComponent(v, k) > sw.getComponent(v, best)) best = k;
    boneOf[v] = si.getComponent(v, best);
  }
  const tris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const b = boneOf[vid(t, 0)];
    let list = tris.get(b);
    if (!list) tris.set(b, (list = []));
    list.push(t);
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [b, list] of tris) {
    const name = src.skeleton.bones[b]?.name;
    const joint = name ? paths.get(name) : undefined;
    if (!joint) continue;
    // 模型空间 → 关节局部空间：src.matrixWorld 把网格放进模型空间，再乘 (host⁻¹ · joint)⁻¹
    _toLocal.multiplyMatrices(_hostInv, joint.matrixWorld).invert().multiply(src.matrixWorld);
    _nrm.getNormalMatrix(_toLocal);
    const remap = new Map<number, number>();
    const idx: number[] = [];
    for (const t of list) for (let k = 0; k < 3; k++) {
      const v = vid(t, k);
      let nv = remap.get(v);
      if (nv === undefined) remap.set(v, (nv = remap.size));
      idx.push(nv);
    }
    const n = remap.size;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    const T = tan ? new Float32Array(n * 4) : null;
    for (const [v, nv] of remap) {
      _v.fromBufferAttribute(pos, v).applyMatrix4(_toLocal).toArray(P, nv * 3);
      if (nor) _v.fromBufferAttribute(nor, v).applyMatrix3(_nrm).normalize().toArray(N, nv * 3);
      if (uv) { U[nv * 2] = uv.getX(v); U[nv * 2 + 1] = uv.getY(v); }
      if (tan && T) {
        _v.set(tan.getX(v), tan.getY(v), tan.getZ(v)).transformDirection(_toLocal).toArray(T, nv * 4);
        T[nv * 4 + 3] = tan.getW(v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (nor) geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    if (T) geo.setAttribute('tangent', new THREE.BufferAttribute(T, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    out.set(name!, geo);
  }
  return out;
}

function buildSplit(host: THREE.Object3D, asset: LoadedAsset, paths: Map<string, THREE.Object3D>): Split | null {
  const levels: Map<string, THREE.BufferGeometry>[] = [];
  for (const src of asset.lods) {
    if (!(src as THREE.SkinnedMesh).skeleton) return null;
    levels.push(splitLod(src as THREE.SkinnedMesh, paths));
  }
  const joints = new Set(levels.flatMap((l) => [...l.keys()]));
  const pieces: Piece[] = [...joints].map((joint) => ({ joint, geos: levels.map((l) => l.get(joint) ?? null) }));
  const material = (asset.lods[0].material as THREE.MeshStandardMaterial).clone();
  return { pieces, material };
}

export interface RigidArt {
  /** 本实例使用的材质：有自发光遮罩时是实例副本（调用方改 emissive 颜色，移除时 dispose），否则是资产共享材质 */
  material: THREE.MeshStandardMaterial;
  /** 资产带自发光遮罩（T_*_E）：程序化发光平板已隐藏，由调用方给 material.emissive 着色 */
  emissive: boolean;
}

/**
 * 把刚体部件资产挂到程序化模型上；返回 null 表示没接上（调用方保留程序化模型）。
 * @param host buildModel 返回的模型根（必须还处在构建姿势：在任何动画运行之前调用）
 * @param keepNames 不隐藏的子树（按节点名）：中空瞄具、弩箭、弓弦等仍由程序化部件负责
 */
export function attachRigidParts(host: THREE.Object3D, asset: LoadedAsset, keepNames: readonly string[] = []): RigidArt | null {
  if (!asset.entry.rig) return null;
  const paths = jointPaths(host);
  if (!fingerprintOk(asset, paths)) return null;
  host.updateWorldMatrix(true, true);
  _hostInv.copy(host.matrixWorld).invert();
  let split = cache.get(asset.id);
  if (split === undefined) {
    split = buildSplit(host, asset, paths);
    cache.set(asset.id, split);
  }
  if (!split) return null;

  // 带自发光遮罩的资产：发光改由贴图里的雕刻纹路承担（实例材质着色），程序化发光平板一并隐藏
  const emissive = !!split.material.emissiveMap;
  const kept = new Set<THREE.Object3D>();
  for (const n of keepNames) host.getObjectByName(n)?.traverse((o) => kept.add(o));
  host.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || kept.has(m)) return;
    if (emissive || (m.material as THREE.Material).type !== 'MeshBasicMaterial') m.visible = false;
  });

  const mat = emissive ? split.material.clone() : split.material;
  if (emissive) mat.emissive.setRGB(0, 0, 0);
  const surfaces: THREE.Mesh[] = [];
  for (const piece of split.pieces) {
    const joint = paths.get(piece.joint);
    if (!joint) continue;
    const lod = new THREE.LOD();
    lod.name = `${asset.id}_${piece.joint}`;
    piece.geos.forEach((geo, i) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, mat);
      // 环境贴图要渲染器：第一次绘制时补上（武器模型在没有渲染器的地方构建）
      if (!mat.envMap) mesh.onBeforeRender = (renderer) => { if (!mat.envMap) applyArtEnvironment(mat, renderer); };
      lod.addLevel(mesh, asset.entry.lodDistance[i] ?? i * 6);
      if (i === 0) surfaces.push(mesh);
    });
    joint.add(lod);
  }
  host.updateWorldMatrix(true, true);
  if (!emissive) snapGlowsToSurface(host, asset, surfaces, kept);
  return { material: mat, emissive };
}

const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _center = new THREE.Vector3();
const _q = new THREE.Quaternion();
const SNAP_MAX = 0.03;
const SNAP_GAP = 0.0004;

/**
 * 保留的发光件（稀有度条、元素能量槽）是贴着程序化枪身的薄板，美术网格的表面位置和它不一样，会悬空或埋进去。
 * 沿发光件最薄的轴（板面法线）从外向里发射线，打到美术网格最外层，把板的内表面贴到命中点外侧一点；
 * 移动超过 SNAP_MAX（模型空间米）就放弃，保持原位。
 */
function snapGlowsToSurface(host: THREE.Object3D, asset: LoadedAsset, surfaces: THREE.Mesh[], kept: Set<THREE.Object3D>): void {
  const b = asset.entry.bounds;
  _center.fromArray(b.min).add(_v.fromArray(b.max)).multiplyScalar(0.5).applyMatrix4(host.matrixWorld);
  const hostScale = host.matrixWorld.getMaxScaleOnAxis();
  host.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || kept.has(m) || (m.material as THREE.Material).type !== 'MeshBasicMaterial') return;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (mat.blending !== THREE.NormalBlending || mat.side === THREE.DoubleSide) return; // 加法光环、双面发光环不动
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    m.geometry.boundingBox!.getSize(_size).multiply(m.scale);
    const axis = _size.x <= _size.y && _size.x <= _size.z ? 0 : _size.y <= _size.z ? 1 : 2;
    const half = _size.getComponent(axis) / 2;
    m.getWorldPosition(_c);
    m.getWorldQuaternion(_q);
    _n.set(0, 0, 0).setComponent(axis, 1).applyQuaternion(_q);
    if (_n.dot(_v.subVectors(_c, _center)) < 0) _n.negate(); // 朝外
    _ray.set(_v.copy(_c).addScaledVector(_n, 0.1 * hostScale), _n.clone().negate());
    _ray.far = 0.2 * hostScale;
    const hit = _ray.intersectObjects(surfaces, false)[0];
    if (!hit) return;
    const target = hit.point.addScaledVector(_n, half * hostScale + SNAP_GAP * hostScale);
    if (target.distanceTo(_c) > SNAP_MAX * hostScale) return;
    m.position.copy(m.parent!.worldToLocal(target));
    m.updateMatrixWorld();
  });
}
