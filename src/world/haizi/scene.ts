/**
 * 4-4 神山海子的场景组装：地形瓦片、镜面湖、四根导雷石柱、湖岸掩体与经幡、湖心岛灵火坛、天空、远景、草与碎石。
 * 湖面用平面反射（three/examples 的 Reflector，半分辨率）：近处像镜子一样映着神山，俯看时是牛奶海的乳白青绿；
 * setTint / setGlow 把湖水变成通电的紫红（雷泽雷神二阶段「雷泽」）。
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { buildMountains, buildSky } from '../plateau/backdrop';
import { FlagSystem } from '../plateau/flags';
import { GeoBuilder } from '../plateau/geo';
import { buildPlacements, type Animated, type MapIcon, type SmokeEmitter } from '../plateau/landmarks';
import { WORLD_UNIFORMS, materials } from '../plateau/materials';
import { GrassField, buildStaticScatter } from '../plateau/scatter';
import type { CollisionWorld } from '../plateau/walker';
import { FLAG_LINES, ISLAND, LAKE, PEAKS, PILLARS, PLACEMENTS, type PillarSpec } from './spec';
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
varying vec4 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
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
  vec3 refl = texture2DProj(tDiffuse, uv).rgb * 0.92;
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = 0.08 + 0.92 * pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  // 牛奶海的乳白青绿：湖心深、近岸和湖心岛周围浅
  vec3 body = mix(uDeep, uShallow, smoothstep(30.0, uShoreR, r));
  body = mix(body, uShallow, 1.0 - smoothstep(uIslandR, uIslandR + 7.0, r));
  body *= 0.92 + 0.16 * n(p * 0.08 + t * 0.02);
  vec3 col = mix(body, refl, clamp(0.3 + fres, 0.0, 0.95));
  // 岸线和湖心岛边一圈细碎的白浪
  float foam = smoothstep(1.6, 0.0, abs(r - uShoreR)) + smoothstep(1.2, 0.0, abs(r - uIslandR));
  foam *= smoothstep(0.45, 0.8, n(p * 1.3 + vec2(t * 0.4, -t * 0.3)));
  col = mix(col, vec3(0.92, 0.96, 0.97), clamp(foam, 0.0, 1.0) * 0.55);
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
          uTint: { value: lin('#ff4fd8') }, uTintMix: { value: 0 }, uGlow: { value: 0 }, uRipple: { value: 0.012 },
          uShoreR: { value: terrain.shorelineR(0) }, uIslandR: { value: 8.3 },
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

  /** 湖水染色：color 是目标颜色，mix 0..1（0 = 原色） */
  setTint(color: THREE.ColorRepresentation, mix: number): void {
    const c = new THREE.Color(color);
    (this.mat.uniforms.uTint.value as THREE.Vector3).set(c.r, c.g, c.b);
    this.mat.uniforms.uTintMix.value = mix;
  }

  /** 通电的电纹亮度 0..1（颜色跟 setTint 的颜色） */
  setGlow(k: number): void { this.mat.uniforms.uGlow.value = k; }

  /** 每帧：雷暴时浪大一点 */
  update(): void {
    this.mat.uniforms.uRipple.value = 0.012 + 0.028 * WORLD_UNIFORMS.uStorm.value;
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
  const mesh = new THREE.Mesh(sky.geometry, m);
  mesh.scale.copy(sky.scale);
  mesh.renderOrder = sky.renderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'sky-linear';
  return mesh;
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
    b.cyl('plain', r1 + 0.03, r1 + 0.03, 0.035, '#7a3a6c', 0, y + h * 0.58 + 0.08, 0, 8, undefined, Math.PI / 8);
    y += h;
    b.cyl('gold', r1 + 0.06, r1 + 0.06, 0.12, '#6f5530', 0, y, 0, 16);
    y += 0.12;
  }
  b.cyl('gold', 0.55, 0.78, 0.4, '#6f5530', 0, y, 0, 12);
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
  const crystalMat = new THREE.MeshStandardMaterial({ color: '#c9b4ff', emissive: '#ff4fd8', emissiveIntensity: 0.12, roughness: 0.18, metalness: 0.05, flatShading: true });
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
      crystalMat.emissiveIntensity = 0.12 + 2.6 * this.charge;
      crystalMat.color.set(this.charge > 0.95 ? '#fff0ff' : '#c9b4ff');
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
}

/**
 * 把整张图装进 scene，碰撞体填进 world。
 * reflectW / reflectH：湖面反射贴图的分辨率（建议画布的一半）。
 */
export function buildHaizi(scene: THREE.Scene, terrain: HaiziTerrain, world: CollisionWorld, reflectW: number, reflectH: number): HaiziScene {
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'terrain';
  for (const g of terrain.buildTiles(96)) {
    const m = new THREE.Mesh(g, materials().terrain);
    m.receiveShadow = true; m.castShadow = true;
    terrainGroup.add(m);
  }
  scene.add(terrainGroup);
  const sky = buildSky();
  const skyLin = linearSky(sky);
  scene.add(sky, skyLin, buildMountains(PEAKS), buildFarTerrain(terrain));

  const lake = new LakeSurface(terrain, reflectW, reflectH);
  // 反射那一遍换成线性色的天空，渲染完换回来
  const reflect = lake.mesh.onBeforeRender;
  lake.mesh.onBeforeRender = function (renderer, sc, camera, geometry, material, group) {
    sky.visible = false; skyLin.visible = true;
    skyLin.position.copy(sky.position);
    reflect.call(this, renderer, sc, camera, geometry, material, group);
    sky.visible = true; skyLin.visible = false;
  };
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
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2, rr = ISLAND.r - 2.2;
    const x = ISLAND.x + Math.cos(a) * rr, z = ISLAND.z + Math.sin(a) * rr;
    b.rock('plain', 0.35 + (k % 3) * 0.12, k % 2 ? '#e9e5dc' : '#bdb6aa', x, terrain.heightAt(x, z) - 0.1, z, 0.6, k + 3);
  }
  scene.add(b.build('landmarks'), flags.build(), extra);

  const occupied = (x: number, z: number): boolean => world.occupied(x, z);
  const scatter = buildStaticScatter(terrain, occupied);
  scene.add(scatter.group);
  const grass = new GrassField(terrain, occupied);
  scene.add(grass.group);
  return { sky, lake, pillars, conductors, anim, flags, grass, scatter, icons };
}
