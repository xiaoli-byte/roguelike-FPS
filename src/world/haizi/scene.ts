/**
 * 4-4 神山海子的场景组装：地形瓦片、镜面湖、四根导雷石柱、湖岸掩体与经幡、湖心岛灵火坛、天空、远景、草与碎石。
 * 湖面用平面反射（three/examples 的 Reflector，半分辨率）：近处像镜子一样映着神山，俯看时是牛奶海的乳白青灰；
 * setTint / setGlow 把湖水变成通电的紫红（雷泽雷神二阶段「雷泽」）。
 * 光和色照概念图 docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg：黎明，湖盆在冷调阴影里，只有神山上半截吃到金光（DAWN）；
 * 西北偏西的冰斗壁上一条冰舌（glacier.ts）。
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { buildMountains, buildSky } from '../plateau/backdrop';
import { srgb } from '../plateau/fx';
import { FlagSystem } from '../plateau/flags';
import { GeoBuilder } from '../plateau/geo';
import { buildPlacements, type Animated, type MapIcon, type SmokeEmitter } from '../plateau/landmarks';
import { WORLD_UNIFORMS, materials, patchMaterial } from '../plateau/materials';
import { GrassField, buildStaticScatter } from '../plateau/scatter';
import type { CollisionWorld } from '../plateau/walker';
import { buildCliffs } from './cliffs';
import { buildGlacier } from './glacier';
import { MATTE, buildFarMatte, matteCamera } from './farMatte';
import { buildPaintProjector } from './paintProject';
import { DAWN, FLAG_LINES, ISLAND, LAKE, PEAKS, PILLARS, PLACEMENTS, SACRED_PEAK, type PillarSpec } from './spec';
import { buildFarTerrain, type HaiziTerrain } from './terrain';

// ───────────────────────────── 湖面 ─────────────────────────────

const LAKE_VS = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const LAKE_FS = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uTint;
uniform float uTintMix;
uniform float uGlow;
uniform float uRipple;
uniform float uShoreR;
uniform float uIslandR;
uniform sampler2D tFar;
uniform mat4 uFarVP;
uniform vec3 uFarEye;
uniform vec4 uFarUV;
uniform vec3 uFarK;
uniform vec4 uFarPlane;
uniform float uFlash;
#define RIPPLES 40
uniform vec4 uRip[RIPPLES];
varying vec4 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 动态涟漪（waterFx.ts 往 uRip 里写，每个 = 圆心 x、z，起始时间，强度）：一圈往外推，圈后面拖几道越来越长的细波，
// 越走越淡、越远越弱。返回水面坡度（扰动反射），crest = 浪峰（亮一点），foam = 刚溅起那一下的白沫圈
vec2 rippleField(vec2 p, float t, out float crest, out float foam) {
  vec2 g = vec2(0.0);
  crest = 0.0; foam = 0.0;
  for (int i = 0; i < RIPPLES; i++) {
    vec4 R = uRip[i];
    if (R.w <= 0.0) continue;
    float age = t - R.z;
    float life = 1.4 + 1.6 * min(R.w, 1.0);
    if (age < 0.0 || age > life) continue;
    vec2 dv = p - R.xy;
    float d = length(dv);
    float front = 0.12 + age * (0.8 + 0.9 * min(R.w, 1.5));
    float x = d - front;
    if (x > 0.45 || x < -1.6 - age * 0.8) continue;
    float fade = 1.0 - age / life;
    fade *= fade;
    float env = exp(-x * x / (0.08 + 0.3 * age));
    float a = R.w * fade * env / (1.0 + d * 0.7);
    float k = 12.0 - 4.0 * min(age, 1.5);
    g += (dv / max(d, 1e-3)) * (a * cos(x * k));
    crest += a * max(0.0, sin(x * k));
    foam += R.w * smoothstep(0.4, 0.0, age) * exp(-x * x * 7.0) / (1.0 + d * 1.5);
  }
  return g;
}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float r = length(p);
  // 两层细浪（风吹的皱纹）扰动反射坐标：近看有涟漪，远看还是镜子
  vec2 w = vec2(n(p * 0.35 + vec2(t * 0.25, t * 0.13)), n(p * 0.45 - vec2(t * 0.19, -t * 0.21))) - 0.5;
  w += (vec2(n(p * 1.6 + t * 0.6), n(p * 1.7 - t * 0.5)) - 0.5) * 0.45;
  vec4 uv = vUv;
  uv.xy += w * uRipple * uv.w;
  float rCrest, rFoam;
  vec2 rg = rippleField(p, t, rCrest, rFoam);
  uv.xy += rg * 0.13 * uv.w;
  vec4 tr = texture2DProj(tDiffuse, uv);
  vec3 view = normalize(cameraPosition - vWorld);
  // 远山倒影（概念图湖里那道金顶）：按真实几何，神山（仰角 10–21°）的倒影落在离岸 9 m 以内的水面上，出生点根本看不到。
  // 画里是把远景的倒影往地平线压扁了——这里照做：反射方向的仰角乘 uFarK.x 再去查远山绘景（farMatte.ts 的贴图，按那台相机投影）。
  // 只盖在天和布景上（反射贴图的透明通道：天 0、冰斗壁 / 地形 0.5、柱子 / 湖心岛 / 雷神这些近处的东西 1，近处的倒影不动）；
  // 布景只在神山方位附近盖（缺口那片坡的倒影让给金顶，两侧冰斗壁的倒影留着）
  if (uFarK.x > 0.0) {
    vec3 rd = vec3(-view.x, view.y, -view.z);
    rd.xz += w * uRipple * 6.0 + rg * 1.6;
    float el = atan(rd.y, length(rd.xz)) * uFarK.x;
    vec3 fd = vec3(normalize(rd.xz) * cos(el), sin(el)).xzy;
    // 从水面这一点出发打到绘景那张竖直面上（uFarPlane = 相机水平朝前 xz、板的距离）：玩家走开后倒影和山一起有视差，上下对得齐
    vec2 fw = uFarPlane.xy;
    float tt = (uFarPlane.z - dot(vWorld.xz - uFarEye.xz, fw)) / max(dot(fd.xz, fw), 0.05);
    vec4 fc = uFarVP * vec4(vec3(vWorld.x, uFarEye.y, vWorld.z) + fd * tt, 1.0);
    vec2 cu = vec2(fc.x / fc.w * 0.5 + 0.5, 0.5 - fc.y / fc.w * 0.5);
    vec2 st = vec2((cu.x - uFarUV.x) / (uFarUV.y - uFarUV.x), (cu.y - uFarUV.z) / (uFarUV.w - uFarUV.z));
    if (dot(fd.xz, fw) > 0.05 && fc.w > 0.0 && el < 1.2 && st.x > 0.0 && st.x < 1.0 && st.y > 0.0 && st.y < 1.0) {
      vec4 far = texture2D(tFar, vec2(st.x, 1.0 - st.y));
      float gray = dot(far.rgb, vec3(0.299, 0.587, 0.114));
      far.rgb = mix(far.rgb, vec3(gray) * 0.42, uFarK.z * 0.85) + vec3(0.9, 0.85, 1.0) * uFlash * 0.18;
      float wSky = 1.0 - smoothstep(0.1, 0.4, tr.a);
      float wScene = (1.0 - smoothstep(0.6, 0.9, tr.a)) * (1.0 - smoothstep(0.1, 0.17, abs(cu.x - uFarK.y)));
      tr.rgb = mix(tr.rgb, far.rgb, max(wSky, wScene) * far.a);
    }
  }
  vec3 refl = tr.rgb * vec3(0.9, 0.97, 0.97);
  float fres = 0.08 + 0.92 * pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  // 牛奶海的乳白青绿：湖心深、近岸和湖心岛周围浅
  vec3 body = mix(uDeep, uShallow, smoothstep(30.0, uShoreR, r));
  body = mix(body, uShallow, 1.0 - smoothstep(uIslandR, uIslandR + 7.0, r));
  body *= 0.92 + 0.16 * n(p * 0.08 + t * 0.02);
  // 镜面湖（概念图里冰舌和金顶的倒影清清楚楚）：倒影占得多，湖色只透一层
  vec3 col = mix(body, refl, clamp(0.5 + fres, 0.0, 0.97));
  // 岸线和湖心岛边一圈细碎的白浪
  float foam = smoothstep(1.6, 0.0, abs(r - uShoreR)) + smoothstep(1.2, 0.0, abs(r - uIslandR));
  foam *= smoothstep(0.45, 0.8, n(p * 1.3 + vec2(t * 0.4, -t * 0.3)));
  col = mix(col, vec3(0.92, 0.96, 0.97), clamp(foam, 0.0, 1.0) * 0.55);
  // 涟漪：浪峰映出更多天光（斜着看更明显），刚溅起那一圈带白沫
  col += vec3(0.8, 0.88, 0.92) * min(rCrest, 1.0) * (0.25 + 0.6 * fres);
  // 迎着视线的坡面映的是更低处（暗一点）、背着的映天（亮一点）：圈的明暗交替
  col *= 1.0 + clamp(dot(rg, normalize(vWorld.xz - cameraPosition.xz)) * 2.2, -0.22, 0.22);
  col = mix(col, vec3(0.93, 0.97, 0.98), clamp(rFoam, 0.0, 1.0) * 0.65);
  // 通电（雷泽）：整片偏紫红，水面上一道道游走的电纹，一圈圈从湖心往外推
  col = mix(col, uTint * 0.6 + col * 0.4, uTintMix);
  float vein = 1.0 - smoothstep(0.0, 0.045, abs(n(p * 0.16 + vec2(t * 0.35, -t * 0.27)) - 0.5));
  vein += 1.0 - smoothstep(0.0, 0.03, abs(n(p * 0.42 - vec2(t * 0.6, t * 0.45)) - 0.5));
  float pulse = 0.5 + 0.5 * sin(t * 5.0 - r * 0.35);
  col += uTint * uGlow * (vein * 1.4 + 0.25 * pulse);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (hex: THREE.ColorRepresentation): THREE.Vector3 => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };

/** 镜面湖：一张半径 96 m 的圆盘（岸上的部分被地形盖住，涨水时自然漫上岸） */
export class LakeSurface {
  readonly mesh: Reflector;
  private readonly mat: THREE.ShaderMaterial;
  private rise = 0;

  constructor(private readonly terrain: HaiziTerrain, width: number, height: number) {
    this.mesh = new Reflector(new THREE.CircleGeometry(96, 128), {
      textureWidth: width, textureHeight: height, clipBias: 0.003, multisample: 0,
      shader: {
        name: 'HaiziLake',
        uniforms: {
          color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
          uTime: { value: 0 }, uDeep: { value: lin(LAKE.deep) }, uShallow: { value: lin(LAKE.shallow) },
          uTint: { value: lin('#ff4fd8') }, uTintMix: { value: 0 }, uGlow: { value: 0 }, uRipple: { value: 0.005 },
          uShoreR: { value: terrain.shorelineR(0) }, uIslandR: { value: 8.3 },
          tFar: { value: null }, uFarVP: { value: new THREE.Matrix4() }, uFarEye: { value: new THREE.Vector3() },
          uFarUV: { value: new THREE.Vector4(0, 1, 0, 1) }, uFarK: { value: new THREE.Vector3(0, 0.5, 0) },
          uFarPlane: { value: new THREE.Vector4(0, -1, 1500, 0) }, uFlash: { value: 0 },
        },
        vertexShader: LAKE_VS,
        fragmentShader: LAKE_FS,
      },
    });
    this.mesh.name = 'lake';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = LAKE.level;
    this.mat = this.mesh.material as THREE.ShaderMaterial;
    this.mat.uniforms.uTime = WORLD_UNIFORMS.uTime;
    this.mat.uniforms.uFlash = WORLD_UNIFORMS.uFlash;
    this.mat.uniforms.uRip = { value: this.ripples };
  }

  /** 水位偏移（米）：地形的 waterLevelAt、湖面网格、岸线白浪一起变 */
  setRise(v: number): void {
    this.rise = v;
    this.terrain.lakeRise = v;
    this.mesh.position.y = LAKE.level + v;
    this.mat.uniforms.uShoreR.value = this.terrain.shorelineR(v);
    this.mat.uniforms.uIslandR.value = Math.max(0, 8.3 - v * 0.9);
  }
  get level(): number { return LAKE.level + this.rise; }

  /** 动态涟漪（和着色器里 RIPPLES 一样多，环形缓冲：最老的被顶掉） */
  private readonly ripples = Array.from({ length: 40 }, () => new THREE.Vector4(0, 0, -1e3, 0));
  private rippleNext = 0;

  /**
   * 在水面 (x, z) 起一圈涟漪。strength：0.1 = 站着不动时腿边的细纹，0.3 = 一步，1 = 跳进水里，1.5 封顶。
   * 时间用 WORLD_UNIFORMS.uTime（和着色器同一个钟）
   */
  addRipple(x: number, z: number, strength: number): void {
    this.ripples[this.rippleNext].set(x, z, WORLD_UNIFORMS.uTime.value, Math.min(1.5, strength));
    this.rippleNext = (this.rippleNext + 1) % this.ripples.length;
  }

  /** 湖水染色：color 是目标颜色，mix 0..1（0 = 原色） */
  setTint(color: THREE.ColorRepresentation, mix: number): void {
    const c = new THREE.Color(color);
    (this.mat.uniforms.uTint.value as THREE.Vector3).set(c.r, c.g, c.b);
    this.mat.uniforms.uTintMix.value = mix;
  }

  /** 通电的电纹亮度 0..1（颜色跟 setTint 的颜色） */
  setGlow(k: number): void { this.mat.uniforms.uGlow.value = k; }

  /**
   * 远山倒影：tex = 远山绘景的贴图，cam = 画它的相机，uv = 贴图在概念图里的范围 [u0, u1, v0, v1]，
   * squash = 倒影往地平线压扁几倍（反射仰角乘它），center = 神山在概念图里的横向位置（0..1）
   */
  setFarReflection(tex: THREE.Texture, cam: THREE.PerspectiveCamera, uv: [number, number, number, number], squash: number, center: number): void {
    const u = this.mat.uniforms;
    u.tFar.value = tex;
    (u.uFarVP.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (u.uFarEye.value as THREE.Vector3).copy(cam.position);
    (u.uFarUV.value as THREE.Vector4).set(...uv);
    (u.uFarK.value as THREE.Vector3).set(squash, center, 0);
    const yaw = THREE.MathUtils.degToRad(MATTE.yawDeg);
    (u.uFarPlane.value as THREE.Vector4).set(-Math.sin(yaw), -Math.cos(yaw), MATTE.distance, 0);
  }

  /** 每帧：雷暴时浪大一点 */
  update(): void {
    (this.mat.uniforms.uFarK.value as THREE.Vector3).z = WORLD_UNIFORMS.uStorm.value;
    this.mat.uniforms.uRipple.value = 0.005 + 0.035 * WORLD_UNIFORMS.uStorm.value;
  }

  /** 反射贴图分辨率（画布尺寸变了时调） */
  resize(width: number, height: number): void { this.mesh.getRenderTarget().setSize(width, height); }
}

/**
 * 反射里用的天空：同一个着色器，颜色换成线性值。
 * 天空着色器直接输出 sRGB（屏幕上不再转换），但反射贴图里存的是线性色、湖面着色器最后统一转 sRGB——不换的话倒影里的天会发白。
 */
function linearSky(sky: THREE.Mesh): THREE.Mesh {
  const src = sky.material as THREE.ShaderMaterial;
  const m = src.clone();
  for (const k of ['uTime', 'uStorm', 'uFlash'] as const) m.uniforms[k] = WORLD_UNIFORMS[k];
  for (const k of ['uTop', 'uMid', 'uHorizon', 'uStormHorizon']) {
    const v = src.uniforms[k].value as THREE.Vector3;
    const c = new THREE.Color().setRGB(v.x, v.y, v.z, THREE.SRGBColorSpace);
    m.uniforms[k] = { value: new THREE.Vector3(c.r, c.g, c.b) };
  }
  // 反射贴图的透明通道是标记（湖面着色器用）：天 = 0
  m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4(col, 1.0);', 'gl_FragColor = vec4(col, 0.0);');
  const mesh = new THREE.Mesh(sky.geometry, m);
  mesh.scale.copy(sky.scale);
  mesh.renderOrder = sky.renderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'sky-linear';
  return mesh;
}

// ───────────────────────────── 黎明 ─────────────────────────────

/** 指向太阳的单位向量（4-4 的黎明，不用 4-1 的午后太阳） */
export const DAWN_SUN_DIR = new THREE.Vector3(...DAWN.sunDir).normalize();

/** 天空换成黎明的配色和太阳方向（要在 linearSky 克隆之前改） */
function dawnSky(sky: THREE.Mesh): void {
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.uTop.value = srgb(DAWN.sky.top);
  u.uMid.value = srgb(DAWN.sky.mid);
  u.uHorizon.value = srgb(DAWN.sky.horizon);
  u.uSunDir = { value: DAWN_SUN_DIR };
}

/**
 * 远山（顶点色）照概念图收拾：
 * - 切面着色（flatShading）：块面清楚的山，不是光滑的奶油锥；
 * - 金顶：from 以上、朝太阳的那一面往金色染。远景件，光直接烘进颜色——
 *   1.4 km 外的山不在阴影贴图范围里，实时光照做不出「湖盆还在阴影里、只有山尖亮」。
 */
function summitGlow(mountains: THREE.Object3D): void {
  const flat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
  mountains.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = flat; });
  const n = new THREE.Vector3();
  const gold = new THREE.Color(DAWN.summit.color), c = new THREE.Color(), center = new THREE.Vector3();
  const sunXZ = new THREE.Vector2(DAWN_SUN_DIR.x, DAWN_SUN_DIR.z).normalize(), out = new THREE.Vector2();
  const seen = new Set<THREE.BufferGeometry>();
  mountains.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || seen.has(m.geometry)) return;
    seen.add(m.geometry);
    const g = m.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute | undefined;
    if (!col) return;
    if (!g.attributes.normal) g.computeVertexNormals();
    const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
    // 朝向按顶点相对山心的水平方向判断（远山网格的法线有的朝下，材质是双面的，看不出来，但不能拿来判朝向）
    g.computeBoundingBox();
    g.boundingBox!.getCenter(center);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + m.position.y;
      out.set(pos.getX(i) - center.x, pos.getZ(i) - center.z);
      // 朝阳面亮、背阳面暗，直接烘进颜色（晨光太弱、远山又在雾里，实时光照拉不开棱线两侧的明暗）
      if (nor) {
        n.fromBufferAttribute(nor, i); if (n.y < 0) n.negate();
        const lit = Math.max(0, n.x * DAWN_SUN_DIR.x + n.z * DAWN_SUN_DIR.z) / Math.max(0.2, Math.hypot(n.x, n.z));
        c.fromBufferAttribute(col, i).multiplyScalar(0.82 + 0.22 * lit);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      const k = THREE.MathUtils.smoothstep(y, DAWN.summit.from, DAWN.summit.to);
      if (k <= 0) continue;
      const face = out.lengthSq() < 1 ? 0.6 : Math.max(0, out.normalize().dot(sunXZ) + 0.25);
      c.fromBufferAttribute(col, i).lerp(gold, Math.min(1, k * face * 1.6) * DAWN.summit.strength);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  });
}

// ───────────────────────────── 导雷石柱 ─────────────────────────────

export interface Pillar {
  id: string; name: string;
  /** 柱脚（地面） */
  pos: THREE.Vector3;
  /** 柱顶雷晶的中心（引雷的导体点、劈向雷神的起点） */
  top: THREE.Vector3;
  /** 柱顶雷晶（单独的网格，材质每根独立，可以单独发光） */
  crystal: THREE.Mesh;
  /** 雷晶外面的辉光球（加色混合，充能越满越大越亮） */
  halo: THREE.Mesh;
  /** 充能 0..1：雷晶从暗紫到发白的紫红 */
  setCharge(k: number): void;
  charge: number;
}

/** 7 m 的古石柱：方台基 → 四段收分的八角石鼓（之间是青铜箍）→ 铜帽 → 四根石爪托着一块雷晶 */
function buildPillar(spec: PillarSpec, terrain: HaiziTerrain, world: CollisionWorld, b: GeoBuilder, extra: THREE.Group, anim: Animated[]): Pillar {
  const gy = terrain.footprintMin(spec.x, spec.z, 1.3, 1.3, 0) - 0.25;
  const yaw = Math.atan2(-spec.x, -spec.z);
  b.setFrame(spec.x, gy, spec.z, yaw);
  b.box('plain', 2.6, 0.7, 2.6, '#8d8e8a', 0, 0, 0);
  b.box('plain', 2.1, 0.35, 2.1, '#9a9b96', 0, 0.7, 0, Math.PI / 4);
  const H = spec.height;
  const drums = 4, top = H - 1.2;
  let y = 1.05;
  for (let k = 0; k < drums; k++) {
    const h = (top - 1.05) / drums - 0.12;
    const r0 = 0.95 - k * 0.07, r1 = r0 - 0.06;
    b.cyl('plain', r1, r0, h, k % 2 ? '#8a8c88' : '#979893', 0, y, 0, 8, undefined, Math.PI / 8);
    // 雷纹：石鼓上一圈刻出来的回纹带（暗）和一道紫红的平涂细线（之后着色器可以让它亮）
    b.cyl('plain', r1 + 0.015, r1 + 0.025, 0.2, '#4a4844', 0, y + h * 0.58, 0, 8, undefined, Math.PI / 8);
    b.cyl('plain', r1 + 0.03, r1 + 0.03, 0.035, '#4c4752', 0, y + h * 0.58 + 0.08, 0, 8, undefined, Math.PI / 8);
    y += h;
    b.cyl('gold', r1 + 0.06, r1 + 0.06, 0.12, '#4a4238', 0, y, 0, 16);
    y += 0.12;
  }
  b.cyl('gold', 0.55, 0.78, 0.4, '#4a4238', 0, y, 0, 12);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const p0 = b.world(Math.cos(a) * 0.5, y + 0.3, Math.sin(a) * 0.5), p1 = b.world(Math.cos(a) * 0.62, y + 1.2, Math.sin(a) * 0.62);
    const p2 = b.world(Math.cos(a) * 0.3, y + 1.75, Math.sin(a) * 0.3);
    b.clearFrame();
    b.rod('plain', p0, p1, 0.11, '#8a8c88');
    b.rod('plain', p1, p2, 0.08, '#8a8c88');
    b.setFrame(spec.x, gy, spec.z, yaw);
  }
  b.clearFrame();
  const center = new THREE.Vector3(spec.x, gy + y + 1.05, spec.z);
  // 平时是不发光的淡色晶石（概念图），被雷劈中充能才亮紫红
  const crystalMat = new THREE.MeshStandardMaterial({ color: '#d5dde6', emissive: '#ff4fd8', emissiveIntensity: 0, roughness: 0.35, metalness: 0.05, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crystalMat);
  crystal.scale.set(1, 1.7, 1);
  crystal.position.copy(center);
  crystal.castShadow = true;
  crystal.name = `pillar-crystal-${spec.id}`;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({
    color: '#ff6ae0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.position.copy(center);
  halo.visible = false;
  extra.add(crystal, halo);
  world.add({ kind: 'cyl', x: spec.x, z: spec.z, r: 1.0, y0: gy - 1, y1: gy + H, walkable: false });
  const pillar: Pillar = {
    id: spec.id, name: spec.name, pos: new THREE.Vector3(spec.x, gy + 0.25, spec.z), top: center, crystal, halo, charge: 0,
    setCharge(k: number) {
      this.charge = Math.min(1, Math.max(0, k));
      crystalMat.emissiveIntensity = 2.7 * this.charge;
      crystalMat.color.set(this.charge > 0.95 ? '#fff0ff' : this.charge > 0.02 ? '#d9c4ff' : '#d5dde6');
    },
  };
  anim.push({
    update: (t) => {
      crystal.rotation.y = t * (0.4 + pillar.charge * 2.2);
      crystal.position.y = center.y + Math.sin(t * 1.3 + spec.x) * 0.06;
      const k = pillar.charge;
      halo.visible = k > 0.02;
      halo.scale.setScalar(0.7 + 1.1 * k + 0.12 * k * Math.sin(t * 9));
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
    },
  });
  return pillar;
}

// ───────────────────────────── 组装 ─────────────────────────────

export interface HaiziScene {
  /** 天空（镜头每帧跟着走：sky.position = 镜头位置） */
  sky: THREE.Mesh;
  lake: LakeSurface;
  pillars: Pillar[];
  /** 引雷的导体：四根石柱顶的雷晶 + 达觉经幡杆顶 */
  conductors: THREE.Vector3[];
  /** 每帧要推进的小动画（灵火坛、雷晶） */
  anim: Animated[];
  flags: FlagSystem;
  grass: GrassField;
  scatter: ReturnType<typeof buildStaticScatter>;
  icons: MapIcon[];
  /** 远山绘景加载完（截图脚本等它）；失败也会变 true，只是没有远山 */
  farLoaded: boolean;
}

/**
 * 把整张图装进 scene，碰撞体填进 world。
 * reflectW / reflectH：湖面反射贴图的分辨率（建议画布的一半）。
 */
export function buildHaizi(scene: THREE.Scene, terrain: HaiziTerrain, world: CollisionWorld, reflectW: number, reflectH: number): HaiziScene {
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'terrain';
  // 投影绘景（paintProject.ts）：概念图从出生点相机投到冰斗壁、冰舌、缺口和远岸上。地形用自己的一份材质（共用的那份别的图也在用）
  const base = `${import.meta.env?.BASE_URL ?? '/'}`;
  const paint = buildPaintProjector(base);
  const terrainMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { detail: true, splat: true, sky: true, contact: true });
  paint.apply(terrainMat);
  for (const g of terrain.buildTiles(96)) {
    const m = new THREE.Mesh(g, terrainMat);
    m.receiveShadow = true; m.castShadow = true;
    terrainGroup.add(m);
  }
  scene.add(terrainGroup);
  const sky = buildSky();
  dawnSky(sky);
  const skyLin = linearSky(sky);
  // 神山和它两侧的远峰是一块绘景背景板（farMatte.ts，取自概念图），远山列表里的神山不再生成
  const mountains = buildMountains(PEAKS.filter(p => p.x !== SACRED_PEAK.x || p.z !== SACRED_PEAK.z));
  summitGlow(mountains);
  const far = buildFarMatte(base);
  const painted = [buildFarTerrain(terrain), buildCliffs(), buildGlacier()];
  for (const m of painted) paint.apply(m.material as THREE.Material);
  scene.add(sky, skyLin, mountains, far.mesh, ...painted);

  const lake = new LakeSurface(terrain, reflectW, reflectH);
  // 反射那一遍换成线性色的天空，渲染完换回来
  const reflect = lake.mesh.onBeforeRender;
  lake.mesh.onBeforeRender = function (renderer, sc, camera, geometry, material, group) {
    if (!paint.baked) paint.bake(renderer, sc as THREE.Scene, [lake.mesh, sky, skyLin]);
    // 远山绘景不进反射贴图：它的倒影由湖面着色器直接查贴图（压扁了的，见 LAKE_FS）
    const farOn = far.mesh.visible;
    sky.visible = false; skyLin.visible = true; far.mesh.visible = false;
    skyLin.position.copy(sky.position);
    reflect.call(this, renderer, sc, camera, geometry, material, group);
    sky.visible = true; skyLin.visible = false; far.mesh.visible = farOn;
  };
  void far.ready.then(() => {
    if (far.mesh.visible) lake.setFarReflection(far.texture, matteCamera(), [MATTE.u0, MATTE.u1, MATTE.v0, MATTE.v1], 2.2, 0.5);
  });
  scene.add(lake.mesh);

  const flags = new FlagSystem();
  const b = new GeoBuilder();
  const extra = new THREE.Group();
  extra.name = 'haizi-extra';
  const anim: Animated[] = [];
  const smoke: SmokeEmitter[] = [];
  const icons: MapIcon[] = [];
  const conductors: THREE.Vector3[] = [];
  const pillars = PILLARS.map(p => buildPillar(p, terrain, world, b, extra, anim));
  for (const p of pillars) conductors.push(p.top);
  buildPlacements({ terrain, b, flags, world, extra, anim, smoke, icons, conductors }, PLACEMENTS, FLAG_LINES);
  // 湖心岛：灵火坛四周一圈白石
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.2, rr = ISLAND.r - 1.6 + (k % 3) * 0.6;
    const x = ISLAND.x + Math.cos(a) * rr, z = ISLAND.z + Math.sin(a) * rr;
    b.rock('plain', 0.6 + (k % 4) * 0.22, k % 2 ? '#86837e' : '#76736f', x, terrain.heightAt(x, z) - 0.3, z, 0.7, k + 3);
  }
  scene.add(b.build('landmarks'), flags.build(), extra);

  const occupied = (x: number, z: number): boolean => world.occupied(x, z);
  const scatter = buildStaticScatter(terrain, occupied);
  scene.add(scatter.group);
  const grass = new GrassField(terrain, occupied);
  scene.add(grass.group);
  const out: HaiziScene = { sky, lake, pillars, conductors, anim, flags, grass, scatter, icons, farLoaded: false };
  void Promise.all([far.ready, paint.ready]).then(() => { out.farLoaded = true; });
  return out;
}
