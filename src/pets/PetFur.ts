import * as THREE from 'three';
import type { PetFurData } from './PetDefsData';

/**
 * 灵宠的壳层毛发（网页没有 Unity 的 Spiritfire/FurShell 着色器：这里做一个接近的版本，差异见 docs/threejs-migration.md 灵宠对照清单）。
 * Unity（Pipeline/Runtime/FurShells.cs + SF_FurShell.shader + SF_Fur.hlsl + 导入时的 FurBake）：
 *   LOD0 蒙皮网格追加 N 个壳层材质槽，同一个已蒙皮的网格沿法线推出 (i+1)/N × 毛长 × 遮罩，再顺毛向梳、按重力下垂；
 *   片元按绑定空间的发丝图案（两套错开的抖动格子、锥形发丝、沿毛向拉长、毛簇噪声）算覆盖率，AlphaToMask 写成柔边发丝；根部压暗、发梢提亮。
 *   遮罩 / 毛向由 FurBake 在导入时按蒙皮权重烘进 UV2–4。
 * 网页：
 *   · 遮罩、毛向在加载时按同一套规则现算（蒙皮权重 × fur.bones 每骨倍数、排除球 / 长方体的软边；毛向 = 权重加权的骨骼方向，
 *     躯干一组反过来、再往下偏 flowDroop、投影到切平面），存成网格属性（同一资产只算一次，几何体共享）；
 *   · 每层一个共享骨架的 SkinnedMesh（材质只差层号），顶点着色器在蒙皮之后推出去，片元照 SFFurShellAlpha 算覆盖率，
 *     没有 MSAA 的 alpha-to-coverage，改成按 0.5 阈值丢弃（发丝边是硬的）；没有 Kajiya-Kay 顺发丝高光、没有轮廓发丝面片（fins）；
 *   · 层数：画质档 fur = 'shells' 用 fur.shells（16），'fins'（中档：Unity 只开轮廓面片）用 4 层代替，'none' 不长毛。
 */

/** Unity M_Pet_*_FurShell.mat 的根部压暗 / 发梢提亮（八只灵宠的壳层材质一样） */
export const FUR_ROOT_SHADE = 0.8;
export const FUR_TIP_LIGHT = 0.06;
/** 中档（Unity 只开轮廓发丝面片）用几层壳代替 */
export const FUR_MEDIUM_SHELLS = 4;
/** 躯干一组：毛往后、往下顺（FurBake.Axial） */
const AXIAL = /^(hips|spine|chest|neck|head|body)/i;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _f = new THREE.Vector3();

function wildcard(pattern: string): RegExp {
  return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
}

/** 每骨倍数（后写的覆盖先写的；没写的 1）——FurSettings.BoneMultiplier */
export function boneMultiplier(fur: PetFurData, bone: string): number {
  let m = 1;
  for (const [pattern, mult] of fur.bones) if (wildcard(pattern).test(bone)) m = mult;
  return m;
}

/** 骨架坐标（Blender：前 −Y、左 +X、上 +Z）→ 网页模型空间（glTF：前 +Z、左 +X、上 +Y） */
export function rigToModel(p: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[2], -p[1]);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 给蒙皮网格的几何体烘遮罩与毛向（furMask：0–1；furFlow：网格局部空间的毛向），同一几何体只做一次。
 * 返回 网格局部单位 → 米 的比例（毛长换算用）
 */
export function bakeFur(mesh: THREE.SkinnedMesh, fur: PetFurData): number {
  const geo = mesh.geometry;
  const scale = new THREE.Vector3();
  mesh.bindMatrix.decompose(_p, new THREE.Quaternion(), scale);
  const k = Math.max(1e-6, Math.max(scale.x, scale.y, scale.z));
  if (geo.userData.furBaked) return k;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
  const bones = mesh.skeleton.bones;
  const nb = bones.length;
  // 绑定姿势下各骨骼的位置（网格局部空间）与方向
  const bindInv = mesh.bindMatrixInverse;
  const head: THREE.Vector3[] = [];
  for (let j = 0; j < nb; j++) {
    _m.copy(mesh.skeleton.boneInverses[j]).invert().premultiply(bindInv);
    head.push(new THREE.Vector3().setFromMatrixPosition(_m));
  }
  const index = new Map<THREE.Object3D, number>();
  bones.forEach((b, j) => index.set(b, j));
  const dir: THREE.Vector3[] = [];
  const mult: number[] = [];
  for (let j = 0; j < nb; j++) {
    const kids = bones[j].children.filter((c) => index.has(c)).map((c) => index.get(c)!);
    const d = new THREE.Vector3();
    if (kids.length > 0) {
      for (const c of kids) d.add(_f.subVectors(head[c], head[j]));
    } else {
      const parent = bones[j].parent && index.has(bones[j].parent!) ? index.get(bones[j].parent!)! : -1;
      if (parent >= 0) d.subVectors(head[j], head[parent]);
    }
    if (d.lengthSq() < 1e-10) d.set(0, -1, 0);
    d.normalize();
    const name = bones[j].name.replace(/^.*:/, '');
    if (AXIAL.test(name)) d.negate();
    dir.push(d);
    mult.push(boneMultiplier(fur, name));
  }
  // 排除区（模型空间米 → 网格局部）
  const toLocal = (v: THREE.Vector3) => v.applyMatrix4(bindInv);
  const exclude = fur.exclude.map((e) => ({ c: toLocal(rigToModel(e.center)), r: e.radius / k }));
  const boxes = fur.excludeBoxes.map((e) => {
    const a = toLocal(rigToModel(e.min)), b = toLocal(rigToModel(e.max));
    return new THREE.Box3(a.clone().min(b), a.clone().max(b));
  });
  const n = pos.count;
  const mask = new Float32Array(n);
  const flow = new Float32Array(n * 3);
  const down = new THREE.Vector3(0, -1, 0).transformDirection(bindInv);
  for (let v = 0; v < n; v++) {
    _p.fromBufferAttribute(pos, v);
    _n.fromBufferAttribute(nrm, v).normalize();
    _f.set(0, 0, 0);
    let m = 0, wsum = 0;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(v, c);
      const bi = si.getComponent(v, c);
      if (!(w > 0) || bi < 0 || bi >= nb) continue;
      _f.addScaledVector(dir[bi], w);
      m += mult[bi] * w;
      wsum += w;
    }
    m = wsum > 0 ? m / wsum : 1;
    for (const e of exclude) m *= smoothstep(0, 1, Math.max(0, Math.min(1, (_p.distanceTo(e.c) - e.r * 0.6) / (e.r * 0.4))));
    // 长方体外 2 厘米内渐变
    for (const b of boxes) m *= smoothstep(0, 1, b.distanceToPoint(_p) * k / 0.02);
    if (_f.lengthSq() > 1e-10) _f.normalize();
    _f.addScaledVector(down, fur.flowDroop);
    _f.addScaledVector(_n, -_f.dot(_n));
    if (_f.lengthSq() < 1e-8) _f.copy(down).addScaledVector(_n, -down.dot(_n));
    if (_f.lengthSq() < 1e-8) _f.set(1, 0, 0);
    _f.normalize();
    mask[v] = Math.max(0, Math.min(1, m));
    flow[v * 3] = _f.x;
    flow[v * 3 + 1] = _f.y;
    flow[v * 3 + 2] = _f.z;
  }
  geo.setAttribute('furMask', new THREE.BufferAttribute(mask, 1));
  geo.setAttribute('furFlow', new THREE.BufferAttribute(flow, 3));
  geo.userData.furBaked = true;
  return k;
}

const VERT_DECL = /* glsl */ `
attribute float furMask;
attribute vec3 furFlow;
uniform float uFurH;
uniform float uFurLen;
uniform float uFurComb;
uniform float uFurDroop;
uniform float uFurK;
varying vec3 vFurBind;
varying vec3 vFurFlowBind;
varying float vFurMask;
varying vec3 vFurN;
varying vec3 vFurV;
`;

const VERT_BODY = /* glsl */ `
#include <skinning_vertex>
{
  vFurBind = position * uFurK;
  vFurFlowBind = furFlow;
  vFurMask = furMask;
  float furLen = uFurLen * furMask;
  vec3 furN = normalize(objectNormal);
  #ifdef USE_SKINNING
    vec3 furComb = normalize((skinMatrix * vec4(furFlow, 0.0)).xyz);
  #else
    vec3 furComb = furFlow;
  #endif
  // 世界的「下」换到物体空间（模型矩阵只有均匀缩放：转置 = 逆的方向部分）
  vec3 furGrav = normalize((vec4(0.0, -1.0, 0.0, 0.0) * modelMatrix).xyz);
  transformed += (furN * uFurH + (furComb * uFurComb + furGrav * uFurDroop) * (uFurH * uFurH)) * furLen;
  vec4 furW = modelMatrix * vec4(transformed, 1.0);
  vFurN = normalize(mat3(modelMatrix) * furN);
  vFurV = cameraPosition - furW.xyz;
}
`;

const FRAG_DECL = /* glsl */ `
uniform float uFurH;
uniform float uFurDensity;
uniform float uFurThickness;
uniform float uFurStretch;
uniform float uFurFacing;
uniform float uFurRoot;
uniform float uFurTip;
varying vec3 vFurBind;
varying vec3 vFurFlowBind;
varying float vFurMask;
varying vec3 vFurN;
varying vec3 vFurV;
vec3 furHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float furValue(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = furHash33(i).x, b = furHash33(i + vec3(1,0,0)).x, c = furHash33(i + vec3(0,1,0)).x, d = furHash33(i + vec3(1,1,0)).x;
  float e = furHash33(i + vec3(0,0,1)).x, f1 = furHash33(i + vec3(1,0,1)).x, g = furHash33(i + vec3(0,1,1)).x, h = furHash33(i + vec3(1,1,1)).x;
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float furStrandSD(vec3 p, vec3 n, float h, float thickness, float clump) {
  vec3 r = furHash33(floor(p));
  vec3 e = fract(p) - (0.3 + 0.4 * r);
  e -= n * dot(e, n);
  float top = (0.45 + 0.55 * fract(r.x * 13.7 + r.z * 5.3)) * clump;
  float rad = thickness * pow(clamp(1.0 - h / max(top, 0.05), 0.0, 1.0), 0.75);
  return rad - length(e);
}
float furShellAlpha(vec3 bindPos, vec3 flowBind, float density, float h, float thickness, float stretch) {
  vec3 q = (bindPos - flowBind * (dot(bindPos, flowBind) * (1.0 - stretch))) * density;
  vec3 dqx = dFdx(q), dqy = dFdy(q);
  vec3 cr = cross(dqx, dqy);
  vec3 n = dot(cr, cr) > 1e-12 ? normalize(cr) : vec3(0.0, 1.0, 0.0);
  float clump = mix(0.5, 1.0, furValue(q * 0.17));
  float sd = max(furStrandSD(q, n, h, thickness, clump), furStrandSD(q + 0.5, n, h, thickness, clump));
  float aa = clamp(sd / max(fwidth(sd), 1e-4) + 0.5, 0.0, 1.0);
  float rad = thickness * pow(clamp(1.0 - h / (0.75 * clump), 0.0, 1.0), 0.75);
  float avg = clamp(6.2832 * rad * rad, 0.0, 1.0) * clamp(1.0 - 1.4 * h, 0.0, 1.0);
  float far = clamp((max(length(dqx), length(dqy)) - 0.35) / 0.4, 0.0, 1.0);
  return mix(aa, avg, far);
}
`;

const FRAG_BODY = /* glsl */ `
#include <map_fragment>
{
  vec3 fN = normalize(vFurN);
  vec3 fV = normalize(vFurV);
  float facing = clamp(dot(fN, fV), 0.0, 1.0);
  float hEff = clamp(uFurH + uFurFacing * facing * facing * (1.0 - uFurH), 0.0, 1.0);
  float fa = furShellAlpha(vFurBind, normalize(vFurFlowBind), uFurDensity, hEff, uFurThickness, uFurStretch)
           * clamp((vFurMask - 0.05) * 10.0, 0.0, 1.0);
  if (fa < 0.5) discard;
  diffuseColor.rgb *= mix(uFurRoot, 1.0 + uFurTip, uFurH);
}
`;

/** 一层壳的材质（材质只差层号；同一套程序共用） */
function shellMaterial(base: THREE.MeshStandardMaterial, fur: PetFurData, k: number, index: number, count: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: base.map, color: base.color.clone(), roughness: Math.max(0.6, base.roughness), metalness: 0,
    aoMap: base.aoMap, aoMapIntensity: base.aoMapIntensity,
  });
  const uniforms = {
    uFurH: { value: (index + 1) / Math.max(1, count) },
    uFurLen: { value: fur.length / k },
    uFurComb: { value: fur.comb },
    uFurDroop: { value: fur.droop },
    uFurK: { value: k },
    uFurDensity: { value: fur.density },
    uFurThickness: { value: fur.thickness },
    uFurStretch: { value: fur.stretch },
    uFurFacing: { value: fur.facing },
    uFurRoot: { value: FUR_ROOT_SHADE },
    uFurTip: { value: FUR_TIP_LIGHT },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <skinning_vertex>', VERT_BODY);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('#include <map_fragment>', FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'pet-fur-shell';
  mat.userData.furUniforms = uniforms;
  return mat;
}

export interface PetFurShells {
  readonly shells: THREE.SkinnedMesh[];
  dispose(): void;
}

/**
 * 给 LOD0 蒙皮网格加 count 层壳（共享骨架与几何体）。count ≤ 0 / 不是蒙皮网格时返回 null
 */
export function attachFurShells(mesh: THREE.SkinnedMesh, fur: PetFurData, count: number): PetFurShells | null {
  if (!mesh?.isSkinnedMesh || count <= 0) return null;
  const base = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  if (!base) return null;
  let k: number;
  try {
    k = bakeFur(mesh, fur);
  } catch (err) {
    console.warn('[pets] 毛发遮罩没烘出来，不长毛', err);
    return null;
  }
  const shells: THREE.SkinnedMesh[] = [];
  const mats: THREE.Material[] = [];
  const parent = mesh.parent ?? mesh;
  for (let i = 0; i < count; i++) {
    const mat = shellMaterial(base, fur, k, i, count);
    const s = new THREE.SkinnedMesh(mesh.geometry, mat);
    s.name = `${mesh.name}_FurShell${i}`;
    s.position.copy(mesh.position);
    s.quaternion.copy(mesh.quaternion);
    s.scale.copy(mesh.scale);
    s.bind(mesh.skeleton, mesh.bindMatrix);
    s.castShadow = false;
    s.receiveShadow = true;
    s.frustumCulled = mesh.frustumCulled;
    if (mesh.boundingSphere) s.boundingSphere = mesh.boundingSphere;
    // 由外向内画：外层先写深度，被它挡住的内层片元在深度测试就被丢掉（Unity renderQueue 同理）
    s.renderOrder = 1 + (count - 1 - i) * 0.001;
    parent.add(s);
    shells.push(s);
    mats.push(mat);
  }
  return {
    shells,
    dispose: () => {
      for (const s of shells) s.removeFromParent();
      for (const m of mats) m.dispose();
    },
  };
}
