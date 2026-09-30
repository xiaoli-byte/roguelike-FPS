/**
 * 天空与大气：渐变天空穹顶（含云与太阳光晕）、远山环、跟随相机的环境粒子（沙尘 / 飘雪 / 余烬）。
 * 天空不做色调映射：雾色在 three.js 中也是不经色调映射直接混入输出的，这样地平线与雾无缝衔接。
 */
import * as THREE from 'three';
import type { ThemeDef } from '../core/types';
import type { GeoBatch } from './Batch';
import { Tpl } from './Batch';
import type { LevelLayout } from './LevelGen';
import type { ThemeStyle } from './Themes';

type Rand = () => number;

// ───────────────────────────── 天空穹顶 ─────────────────────────────

let skyGeo: THREE.SphereGeometry | null = null;

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloud;
uniform float uTime;
uniform float uCloudAmt;
uniform float uCloudSpeed;
uniform float uSunGlow;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float h = d.y;
  vec3 col = mix(uBottom, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  // 地平线：恰好等于雾色，与远处被雾吞没的几何无缝衔接
  col = mix(col, uHorizon, exp(-max(h, 0.0) * 11.0));
  // 云层（平面投影的 fbm）
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.2) * 1.4 + vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.37);
    float n = fbm(uv);
    float cl = smoothstep(0.62 - uCloudAmt * 0.3, 0.95, n) * smoothstep(0.02, 0.3, h);
    col = mix(col, uCloud, cl * uCloudAmt);
  }
  // 太阳与光晕
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 3.0 * uSunGlow + pow(s, 24.0) * 0.25 * uSunGlow + pow(s, 4.0) * 0.1 * uSunGlow);
  if (h < 0.0) col = uHorizon;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(theme: ThemeDef, st: ThemeStyle, center: THREE.Vector3) {
    if (!skyGeo) skyGeo = new THREE.SphereGeometry(430, 40, 20);
    const sunDir = new THREE.Vector3(st.sunDir[0], st.sunDir[1], st.sunDir[2]).normalize();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(theme.skyTop) },
        uBottom: { value: new THREE.Color(theme.skyBottom) },
        uHorizon: { value: new THREE.Color(theme.fogColor) },
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Color(theme.sun) },
        uCloud: { value: new THREE.Color(st.cloud.color) },
        uTime: { value: 0 },
        uCloudAmt: { value: st.cloud.amount },
        uCloudSpeed: { value: st.cloud.speed },
        uSunGlow: { value: st.sunGlow },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(skyGeo, this.material);
    this.mesh.name = 'sky';
    this.mesh.position.copy(center);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  update(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ───────────────────────────── 远山 ─────────────────────────────

/** 竞技场外的一圈远山（进 'far' 合批，受雾影响，不投影） */
export function drawFarRing(b: GeoBatch, L: LevelLayout, theme: ThemeDef, st: ThemeStyle, rand: Rand): void {
  const base = L.half + 55;
  const n = 30;
  b.aoBase = -1000;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.15;
    const R = base + rand() * 45;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    const h = 28 + rand() * 42;
    const r = 18 + rand() * 22;
    const ry = rand() * Math.PI;
    switch (L.theme) {
      case 'desert': {
        // 平顶台地 + 前景沙丘
        const topR = 0.55 + rand() * 0.25;
        b.add('far', Tpl.cyl(7, topR), x, 0, z, r, h * 0.75, r * (0.7 + rand() * 0.4), st.far, 0, ry, 0);
        b.add('far', Tpl.cyl(7, 0.9), x, h * 0.75, z, r * topR * 0.96, 1.2, r * topR * 0.96 * 0.9, st.farCap, 0, ry, 0);
        b.add('far', Tpl.mound(), x * 0.86, -2, z * 0.86, r * 1.3, 9 + rand() * 6, r * 0.8, theme.floor, 0, ry, 0);
        break;
      }
      case 'frost': {
        b.add('far', Tpl.cone(6), x, 0, z, r, h, r * 0.9, st.far, 0, ry, 0);
        b.add('far', Tpl.cone(6), x, h * 0.58, z, r * 0.43, h * 0.43, r * 0.9 * 0.43, st.farCap, 0, ry, 0);
        if (rand() < 0.5) b.add('far', Tpl.cone(5), x * 1.04 + 12, 0, z * 1.04, r * 0.6, h * 0.7, r * 0.55, st.far, 0, ry + 1, 0);
        break;
      }
      default: {
        // 熔火：黑色尖峰 + 发光峰顶，偶尔一座火山口
        const hh = h * (1.1 + rand() * 0.4);
        b.add('far', Tpl.cone(5), x, 0, z, r * 0.7, hh, r * 0.6, st.far, 0, ry, 0);
        if (rand() < 0.35) b.add('glow', Tpl.cone(5), x, hh * 0.8, z, r * 0.7 * 0.2, hh * 0.2, r * 0.6 * 0.2, st.farCap, 0, ry, 0);
        if (i % 7 === 3) {
          b.add('far', Tpl.cyl(8, 0.3), x * 1.1, 0, z * 1.1, r * 1.6, h * 0.8, r * 1.5, st.far, 0, ry, 0);
          b.add('glow', Tpl.cyl(8, 0.9), x * 1.1, h * 0.8 - 0.5, z * 1.1, r * 1.6 * 0.3, 1.2, r * 1.5 * 0.3, st.farCap, 0, ry, 0);
        }
      }
    }
  }
  b.aoBase = 0;
}

// ───────────────────────────── 环境粒子 ─────────────────────────────

const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uScale;
uniform float uSpeed;
uniform float uHeight;
uniform float uBox;
uniform float uDrift;
uniform float uFlicker;
uniform vec3 uCenter;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  float sp = uSpeed * (0.6 + aSeed * 0.8);
  p.y = mod(p.y + uTime * sp, uHeight);
  p.x += sin(uTime * 0.6 + aSeed * 40.0) * uDrift;
  p.z += cos(uTime * 0.5 + aSeed * 23.0) * uDrift;
  // 以相机为中心、水平环绕的粒子盒
  vec2 rel = mod(p.xz - uCenter.xz + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = vec3(uCenter.x + rel.x, p.y, uCenter.z + rel.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + aSeed * 0.8) * uScale / max(0.2, -mv.z), 1.0, 26.0);
  float edge = 1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(rel));
  vAlpha = smoothstep(0.0, 1.0, p.y) * (1.0 - smoothstep(uHeight - 3.0, uHeight, p.y)) * edge;
  vAlpha *= mix(1.0, 0.55 + 0.45 * sin(uTime * (2.0 + aSeed * 5.0) + aSeed * 30.0), uFlicker);
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export class Particles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;

  constructor(st: ThemeStyle, quality: 'low' | 'medium' | 'high', rand: Rand) {
    const p = st.particle;
    const base = quality === 'low' ? 260 : quality === 'medium' ? 600 : 1000;
    const count = Math.round(base * p.density);
    const box = 46;
    const height = p.kind === 'snow' ? 18 : 14;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * box;
      pos[i * 3 + 1] = rand() * height;
      pos[i * 3 + 2] = (rand() - 0.5) * box;
      seed[i] = rand();
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: p.size },
        uScale: { value: 600 },
        uSpeed: { value: p.speed },
        uHeight: { value: height },
        uBox: { value: box },
        uDrift: { value: p.kind === 'snow' ? 0.9 : p.kind === 'ember' ? 0.6 : 1.4 },
        uFlicker: { value: p.kind === 'ember' ? 1 : 0 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(p.color) },
        uOpacity: { value: p.opacity },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'ambientParticles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(t: number, camera: THREE.PerspectiveCamera, pixelHeight: number): void {
    const u = this.material.uniforms;
    u.uTime.value = t;
    (u.uCenter.value as THREE.Vector3).copy(camera.position);
    u.uScale.value = pixelHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
