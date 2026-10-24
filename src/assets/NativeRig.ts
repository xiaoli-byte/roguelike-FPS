/**
 * 原生骨架（清单 skeleton.mode = 'native'）：美术资产自带一套语义骨骼（Tripo 自动绑定 + 管线重整，见
 * art/pipeline/build_tripo_creature.py），敌人代码按骨骼名直接驱动，不再蒙皮到程序化关节上（对比 PartsRig）。
 *
 * - 资产已是米制、脚底原点、面朝 +Z，直接挂在 buildModel 的模型根下；程序化的实体部件隐藏，发光件保留（由敌人自己摆放）。
 * - NativePose 把「绕模型空间的轴转多少」换算成骨骼局部旋转：每帧先 reset() 回到绑定姿势，再按父到子的顺序叠加。
 */
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset } from './AssetLibrary';
import type { SkinnedBody } from './SkinnedBody';

export interface NativeBody extends SkinnedBody {
  readonly pose: NativePose;
  /**
   * 弱点发光壳（管线导出的 <asset>_GlowShell：弱点区域外推 1 厘米的蒙皮薄壳）。加法混合、用本体贴图，
   * 跟着骨骼一起鼓起；敌人每帧设 opacity。没有时为 null。
   */
  readonly glowShell: THREE.MeshBasicMaterial | null;
  /**
   * 有几块分开的发光区域时（雷泽雷神的神面、腹鼓），每块一个发光壳 <asset>_GlowShell_<名字>，按名字取（各自一个材质槽）；
   * 只有一块不带名字的 <asset>_GlowShell 时为空，用 glowShell。
   */
  readonly glowShells: Readonly<Record<string, THREE.MeshBasicMaterial>>;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

interface BoneRest {
  bone: THREE.Bone;
  q: THREE.Quaternion;
  p: THREE.Vector3;
  s: THREE.Vector3;
  /** 绑定姿势下父骨骼在模型空间的朝向（逆） */
  parentInv: THREE.Quaternion;
  parentQ: THREE.Quaternion;
  /** 父骨骼在模型空间的缩放（米 → 父局部单位） */
  parentScale: number;
  /** 绑定姿势下骨骼在模型空间的位置与朝向 */
  hostPos: THREE.Vector3;
  hostQ: THREE.Quaternion;
}

export class NativePose {
  private readonly rest = new Map<string, BoneRest>();

  constructor(model: THREE.Object3D, private readonly host: THREE.Object3D) {
    host.updateWorldMatrix(true, true);
    const hostInv = host.getWorldQuaternion(new THREE.Quaternion()).invert();
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    model.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone) return;
      const parentQ = hostInv.clone().multiply(b.parent!.getWorldQuaternion(new THREE.Quaternion()));
      this.rest.set(b.name, {
        bone: b, q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone(),
        parentQ, parentInv: parentQ.clone().invert(),
        parentScale: b.parent!.getWorldScale(new THREE.Vector3()).x / hostScale,
        hostPos: host.worldToLocal(b.getWorldPosition(new THREE.Vector3())),
        hostQ: hostInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())),
      });
    });
  }

  /** 骨骼当前在模型空间的位置（会先刷新它与祖先的世界矩阵） */
  hostPosition(name: string, out: THREE.Vector3): THREE.Vector3 {
    const r = this.rest.get(name)!;
    r.bone.updateWorldMatrix(true, false);
    return this.host.worldToLocal(r.bone.getWorldPosition(out));
  }

  /** 绑定姿势下骨骼在模型空间的位置 */
  restPosition(name: string): THREE.Vector3 | null {
    return this.rest.get(name)?.hostPos ?? null;
  }

  /** 父骨骼当前在模型空间的朝向 */
  private parentHostQ(r: BoneRest, out: THREE.Quaternion): THREE.Quaternion {
    r.bone.parent!.updateWorldMatrix(true, false);
    this.host.getWorldQuaternion(_q3).invert();
    return out.copy(_q3).multiply(r.bone.parent!.getWorldQuaternion(_q2));
  }

  /** 按父骨骼「当前」朝向，在模型空间绕 axis 转动（IK 用：父骨骼已动过时依然精确） */
  private rotateExact(r: BoneRest, axis: THREE.Vector3, angle: number): void {
    if (!(Math.abs(angle) > 1e-6)) return;
    const pq = this.parentHostQ(r, new THREE.Quaternion());
    _q.setFromAxisAngle(axis, angle);
    r.bone.quaternion.premultiply(pq.clone().invert().multiply(_q).multiply(pq));
    r.bone.updateWorldMatrix(false, true);
  }

  /**
   * 两骨 IK：把 end 骨骼的关节（踝 / 腕）拉到模型空间的 target，膝 / 肘保持当前弯曲平面；
   * 然后把 end 的朝向按 footWeight 拉回绑定姿势（脚掌贴地）。超出腿长时伸直指向目标。
   */
  twoBoneIK(upper: string, lower: string, end: string, target: THREE.Vector3, footWeight = 1): void {
    const ru = this.rest.get(upper), rl = this.rest.get(lower), re = this.rest.get(end);
    if (!ru || !rl || !re) return;
    this.hostPosition(upper, _a);
    this.hostPosition(lower, _b);
    this.hostPosition(end, _c);
    _t.copy(target);
    const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
    const d = THREE.MathUtils.clamp(_a.distanceTo(_t), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    // 1) 膝角：余弦定理，绕当前弯曲平面的法线转小腿
    _u.subVectors(_a, _b);
    _w.subVectors(_c, _b);
    _n.crossVectors(_u, _w);
    if (_n.lengthSq() < 1e-10) {
      // 腿伸得笔直：用绑定姿势的弯曲平面
      _n.crossVectors(_v.subVectors(ru.hostPos, rl.hostPos), _w.subVectors(re.hostPos, rl.hostPos));
    }
    _n.normalize();
    const cur = _u.angleTo(_w.subVectors(_c, _b));
    const want = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    this.rotateExact(rl, _n, want - cur);
    // 2) 大腿：把踝指向目标
    this.hostPosition(end, _c);
    _u.subVectors(_c, _a);
    _w.subVectors(_t, _a);
    _n.crossVectors(_u, _w);
    if (_n.lengthSq() > 1e-12) this.rotateExact(ru, _n.normalize(), _u.angleTo(_w));
    // 3) 脚掌回到绑定朝向（贴地）
    if (footWeight > 0) {
      const pq = this.parentHostQ(re, new THREE.Quaternion());
      _q.copy(pq).invert().multiply(re.hostQ);
      re.bone.quaternion.slerp(_q, footWeight);
      re.bone.updateWorldMatrix(false, true);
    }
  }

  has(name: string): boolean {
    return this.rest.has(name);
  }

  bone(name: string): THREE.Bone | null {
    return this.rest.get(name)?.bone ?? null;
  }

  /** 全部骨骼回到绑定姿势 */
  reset(): void {
    for (const r of this.rest.values()) {
      r.bone.quaternion.copy(r.q);
      r.bone.position.copy(r.p);
      r.bone.scale.copy(r.s);
    }
  }

  /** 绕模型空间的轴（单位向量：X = 生物左侧，Y = 上，Z = 前）在骨骼自身关节处转 angle 弧度；同一骨骼可多次叠加 */
  rotate(name: string, axis: THREE.Vector3, angle: number): void {
    const r = this.rest.get(name);
    if (!r || angle === 0) return;
    // 局部增量 = 父朝向⁻¹ · R · 父朝向（以绑定姿势的父朝向换算；父骨骼自身的动画照常向下传递）
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(r.parentInv).multiply(_q).multiply(r.parentQ);
    r.bone.quaternion.premultiply(_q2);
  }

  /** 在模型空间平移骨骼（米） */
  translate(name: string, x: number, y: number, z: number): void {
    const r = this.rest.get(name);
    if (!r) return;
    _v.set(x, y, z).applyQuaternion(r.parentInv).divideScalar(r.parentScale || 1);
    r.bone.position.add(_v);
  }

  /** 相对绑定姿势缩放骨骼（子骨骼跟着缩放） */
  scale(name: string, x: number, y = x, z = x): void {
    const r = this.rest.get(name);
    if (!r) return;
    r.bone.scale.set(r.s.x * x, r.s.y * y, r.s.z * z);
  }

  /** 绕模型空间的 axis 转 angle：按父骨骼「当前」朝向换算（父骨骼已被 IK 等动过时用，例如绕前臂扭转手腕） */
  rotateCurrent(name: string, axis: THREE.Vector3, angle: number): void {
    const r = this.rest.get(name);
    if (r) this.rotateExact(r, axis, angle);
  }

  /** 骨骼当前在模型空间的朝向 */
  hostQuaternion(name: string, out: THREE.Quaternion): THREE.Quaternion {
    const r = this.rest.get(name)!;
    r.bone.updateWorldMatrix(true, false);
    this.host.getWorldQuaternion(_q3).invert();
    return out.copy(_q3).multiply(r.bone.getWorldQuaternion(_q2));
  }

  /** 绑定姿势下骨骼在模型空间的朝向 */
  restQuaternion(name: string): THREE.Quaternion | null {
    return this.rest.get(name)?.hostQ ?? null;
  }

  /** 世界高度 worldY 在模型空间里的高度（模型根只绕竖直轴转，与水平位置无关） */
  hostHeight(worldY: number): number {
    this.host.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(this.host.matrixWorld).setY(worldY);
    return this.host.worldToLocal(_v).y;
  }

  /**
   * 贴地保护：骨骼上的轮廓点（骨骼局部坐标，见 boneHull）若低于模型空间高度 floor，就在关节处绕模型空间的 axis
   * 把骨骼转到最低点刚好贴地。sign 限定转向（+1 / −1：只往离开地面的一侧转），单次最多转 maxAngle；
   * 往这个方向转并不会抬高的点（例如在关节正下方或背后）不归这根骨骼管，跳过。转完别的点可能变成最低，最多迭代 3 次。
   * 按骨骼「当前」的父朝向换算，放在 IK 和其它动画之后调用。
   */
  liftAbove(name: string, pts: readonly THREE.Vector3[], axis: THREE.Vector3, floor: number, sign: 1 | -1, maxAngle = 0.9): void {
    const r = this.rest.get(name);
    if (!r || pts.length === 0) return;
    for (let iter = 0; iter < 3; iter++) {
      r.bone.updateWorldMatrix(true, false);
      _m4.copy(this.host.matrixWorld).invert().multiply(r.bone.matrixWorld);
      _c.setFromMatrixPosition(_m4);
      let lowY = floor - 1e-4, found = false;
      for (const p of pts) {
        _v.copy(p).applyMatrix4(_m4);
        if (!(_v.y < lowY)) continue;
        // 绕 axis 转 θ 后该点的高度变化率（θ = 0 处）= (axis × 相对向量).y，转向要能把它抬高
        _u.subVectors(_v, _c);
        if (sign * _n.crossVectors(axis, _u).y <= 1e-5) continue;
        lowY = _v.y;
        _t.copy(_u);
        found = true;
      }
      if (!found) return;
      // 相对向量拆成平行 / 垂直于轴两部分：y(θ) = 关节高 + 平行.y + A·cosθ + B·sinθ，解 y(θ) = floor
      const par = axis.dot(_t);
      _w.copy(_t).addScaledVector(axis, -par);
      _n.crossVectors(axis, _w);
      const A = _w.y, B = _n.y, R = Math.hypot(A, B);
      if (R < 1e-6) return;
      const C = floor - _c.y - par * axis.y;
      const d = Math.atan2(B, A), e = Math.acos(THREE.MathUtils.clamp(C / R, -1, 1));
      let best = Infinity;
      for (const th of [d + e, d - e]) {
        const x = THREE.MathUtils.euclideanModulo(th + Math.PI, Math.PI * 2) - Math.PI;
        if (x * sign > 0 && Math.abs(x) < Math.abs(best)) best = x;
      }
      if (!(Math.abs(best) <= maxAngle)) best = sign * maxAngle;
      this.rotateExact(r, axis, best);
    }
  }
}

/**
 * 取 LOD0 蒙皮网格上主要（权重 ≥ minWeight）蒙在骨骼 name 上的顶点，转成骨骼局部坐标（与姿势无关），
 * 再沿球面上 n 个均匀方向各取最远的点（≈ 凸包顶点）：任何朝向下的最低点都在其中。供 NativePose.liftAbove 用。
 */
export function boneHull(body: NativeBody, name: string, minWeight = 0.5, n = 64): THREE.Vector3[] {
  const bone = body.pose.bone(name);
  const root = body.lod.levels[0]?.object;
  if (!bone || !root) return [];
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const sm = mesh as THREE.SkinnedMesh | null;
  const j = sm ? sm.skeleton.bones.indexOf(bone) : -1;
  if (!sm || j < 0) return [];
  const pos = sm.geometry.getAttribute('position');
  const si = sm.geometry.getAttribute('skinIndex');
  const sw = sm.geometry.getAttribute('skinWeight');
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let q = 0; q < 4; q++) if (si.getComponent(i, q) === j) w += sw.getComponent(i, q);
    if (w >= minWeight) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(sm.bindMatrix).applyMatrix4(sm.skeleton.boneInverses[j]));
  }
  const out = new Set<THREE.Vector3>();
  const dir = new THREE.Vector3();
  for (let i = 0; i < n && pts.length > 0; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    dir.set(Math.cos(a) * r, y, Math.sin(a) * r);
    let best = pts[0], bd = -Infinity;
    for (const p of pts) {
      const s = p.dot(dir);
      if (s > bd) { bd = s; best = p; }
    }
    out.add(best);
  }
  return [...out];
}

/**
 * 角色立体感（风格化射击游戏的常用做法）：
 * - 边缘光：视线掠过表面的地方（轮廓）加一圈暖白亮边，按本体颜色调和，站在阴影里也能读出形体、和背景分开；
 * - 加重 AO：褶皱、甲片下沿、关节缝在环境光下压得更暗（贴图 AO 本身偏淡）。
 * 着色器只在本材质上扩展，同一套参数共用一个程序。
 */
const RIM = { color: new THREE.Color(1.0, 0.88, 0.66), strength: 0.9, power: 2.4 };
const AO_STRENGTH = 1.2;

export function applyCharacterShading(material: THREE.MeshStandardMaterial): void {
  if (material.aoMap) material.aoMapIntensity = AO_STRENGTH;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: RIM.color };
    shader.uniforms.rimStrength = { value: RIM.strength };
    shader.uniforms.rimPower = { value: RIM.power };
    shader.fragmentShader = 'uniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;\n'
      + shader.fragmentShader.replace('#include <opaque_fragment>', `
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), rimPower);
        outgoingLight += rimColor * rimF * rimStrength * (0.3 + 0.7 * diffuseColor.rgb);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'character-rim';
}

function lodMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const named: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    const k = m.isSkinnedMesh ? /_LOD(\d+)$/.exec(m.name) : null;
    if (k) named[Number(k[1])] = m;
  });
  return named.filter(Boolean);
}

/**
 * @param host buildModel 返回的模型根（脚底原点、面朝 +Z）
 * @returns 资产不是原生骨架或没有 LOD 网格时返回 null（调用方保留程序化模型）
 */
export function attachNativeBody(host: THREE.Object3D, asset: LoadedAsset, lodScale = 1): NativeBody | null {
  if (asset.entry.skeleton?.mode !== 'native') return null;
  const model = clone(asset.gltf.scene) as THREE.Object3D;
  const meshes = lodMeshes(model);
  if (meshes.length === 0) return null;

  // 隐藏被取代的程序化实体部件；发光件（MeshBasicMaterial）保留，由敌人挂到原生骨骼上
  host.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).type !== 'MeshBasicMaterial') m.visible = false;
  });
  host.add(model);

  const material = (meshes[0].material as THREE.MeshStandardMaterial).clone();
  applyCharacterShading(material);
  const b = asset.entry.bounds;
  const center = new THREE.Vector3().fromArray(b.min).add(_v.fromArray(b.max)).multiplyScalar(0.5);
  // 跳跃 / 鼓囊会超出绑定姿势的包围盒：剔除球放大一些
  const radius = new THREE.Vector3().fromArray(b.max).sub(_v.fromArray(b.min)).length() * 0.85;
  const sphere = new THREE.Sphere(center, radius);
  const lod = new THREE.LOD();
  lod.name = `${asset.id}_lod`;
  meshes[0].parent!.add(lod);
  lod.position.copy(meshes[0].position);
  lod.quaternion.copy(meshes[0].quaternion);
  lod.scale.copy(meshes[0].scale);
  meshes.forEach((mesh, i) => {
    mesh.material = material;
    mesh.castShadow = true;
    mesh.boundingSphere = sphere;
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    lod.addLevel(mesh, (asset.entry.lodDistance[i] ?? i * 15) * lodScale, 0.1);
  });
  // 弱点发光壳：与本体同一套骨骼，加法混合、用本体贴图，平时透明度为 0
  let glowShell: THREE.MeshBasicMaterial | null = null;
  const glowShells: Record<string, THREE.MeshBasicMaterial> = {};
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    const named = m.isSkinnedMesh ? /_GlowShell(?:_(\w+))?$/.exec(m.name) : null;
    if (!named) return;
    const mat = new THREE.MeshBasicMaterial({
      map: material.map, color: 0xffa64a, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    if (named[1]) glowShells[named[1]] = mat;
    glowShell ??= mat;
    m.material = mat;
    m.castShadow = false;
    m.boundingSphere = sphere;
    m.renderOrder = 2;
  });
  const pose = new NativePose(model, host);
  return {
    lod,
    pose,
    glowShell,
    glowShells,
    materials: [material],
    dispose: () => {
      for (const m of meshes) m.skeleton.dispose();
      (glowShell as THREE.MeshBasicMaterial | null)?.dispose();
      for (const m of Object.values(glowShells)) m.dispose();
    },
  };
}
