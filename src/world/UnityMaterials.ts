import * as THREE from 'three';
import { Atmosphere } from './Atmosphere';
import { createUnityWaterMaterial } from './UnityWaterMaterial';
import { createStylizedFoliage, createStylizedLit, materialMarks, type UnityMaterialProperties } from './UnityStylizedLit';
import type { UnityEnvironment } from './UnityLevelLibrary';

type Properties = UnityMaterialProperties;

function color(properties: Properties, name: string, fallback: [number, number, number, number]): THREE.Color {
  const rgba = materialMarks(properties).colors[name] ?? fallback;
  return new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
}

const VERTEX = /* glsl */ `
attribute vec4 _lava_info;
attribute vec4 _lava_flow;
varying vec2 vLocal;
varying vec4 vInfo;
varying vec4 vFlow;
#include <fog_pars_vertex>
void main() {
  vLocal = vec2(uv.x, 1.0 - uv.y);
  vInfo = _lava_info;
  vFlow = _lava_flow;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uCrust;
uniform vec3 uDeep;
uniform vec3 uHot;
uniform vec3 uCore;
uniform float uEmission;
uniform float uNoiseScale;
uniform float uWarpScale;
uniform float uPlateScale;
uniform float uFlowSpeed;
uniform float uAgitation;
uniform float uCrackWidth;
uniform float uMoltenAmount;
uniform float uFlowStretch;
uniform float uBubbleRate;
uniform float uEdgeGlow;
uniform float uShoreWidth;
uniform vec3 uShadowTint;
uniform float uShadowLift;
uniform float uAmbientStrength;
varying vec2 vLocal;
varying vec4 vInfo;
varying vec4 vFlow;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float fbm2(vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.07 + vec2(3.1, 7.7)) * 0.35; }
vec3 plates(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(h21(n + g), h21(n + g + 19.19));
    float h = o.x;
    o = 0.5 + 0.38 * sin(t * 0.22 + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = h; } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2, id);
}
vec3 ramp(float temperature) {
  vec3 c = uDeep * smoothstep(0.17, 0.23, temperature);
  c = mix(c, uHot, smoothstep(0.44, 0.5, temperature));
  c = mix(c, uCore, smoothstep(0.8, 0.86, temperature));
  return c;
}
void main() {
  float agitation = clamp(uAgitation, 0.0, 1.0);
  float t = uTime * uFlowSpeed * (1.0 + agitation * 1.5);
  float speed = length(vFlow.xy);
  vec2 flowDirection = speed > 0.001 ? vFlow.xy / speed : vec2(0.0, 1.0);
  vec2 perpendicular = vec2(flowDirection.y, -flowDirection.x);
  float stretch = clamp((speed - 0.5) / 2.5, 0.0, 1.0) * uFlowStretch;
  vec2 p0 = vLocal + vFlow.z * 37.0;
  vec2 pf = vec2(dot(p0, perpendicular), dot(p0, flowDirection) - speed * uTime);
  vec2 w = vec2(pf.x, pf.y * mix(1.0, 0.28, stretch));
  vec2 q = vec2(fbm2(w * uWarpScale + vec2(t * 0.04, 0.0)), fbm2(w * uWarpScale + vec2(5.2, 1.3) - vec2(0.0, t * 0.035)));
  vec2 wp = w + (q - 0.5) * 5.0;
  float heat = fbm(wp * uNoiseScale * 0.8 + vec2(t * 0.05, -t * 0.04));
  float edge = vInfo.z < 0.5 ? min(vInfo.x - abs(vLocal.x), vInfo.y - abs(vLocal.y)) : vInfo.x - length(vLocal);
  float rim = 1.0 - smoothstep(0.1, max(0.11, uShoreWidth), edge);
  float contact = vInfo.w > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.3, edge);
  float fwPlate = max(fwidth(w.x), fwidth(w.y)) * uPlateScale * 0.75;
  float detail = clamp(1.6 - fwPlate * 18.0, 0.0, 1.0);
  vec3 v = plates(wp * uPlateScale * 0.75, t);
  float gap = v.y - v.x;
  float crackWidth = (uCrackWidth + 0.1 * smoothstep(0.4, 0.7, heat) + agitation * 0.08 + stretch * 0.12) * (1.0 - rim * 0.6);
  crackWidth = max(crackWidth, fwPlate * 1.5);
  float crack = 1.0 - smoothstep(crackWidth * 0.4, crackWidth, gap);
  float core = 1.0 - smoothstep(0.0, crackWidth * 0.4, gap);
  float bleed = 1.0 - smoothstep(0.0, crackWidth * 2.5 + 0.06, gap);
  crack = mix(0.3, crack, detail);
  core *= detail;
  float c0 = 0.72 - uMoltenAmount * 0.25;
  float open = smoothstep(c0 - 0.06, c0 + 0.06, heat + agitation * 0.12 + stretch * 0.3) * (1.0 - rim);
  float streak = fbm2(vec2(wp.x * 1.1, wp.y * 0.3 - t * 0.55) + q * 2.0);
  float bubble = 0.0, popRing = 0.0;
  vec2 bp = pf / 3.0, bc = floor(bp), bf = fract(bp);
  float h = h21(bc + 7.13);
  float period = (3.0 + h * 5.0) / max(0.2, uBubbleRate * (1.0 + agitation * 1.5));
  float cycle = uTime / period + h * 13.7;
  float phase = fract(cycle);
  float on = step(0.55 - agitation * 0.25, h21(bc + floor(cycle) * 0.731));
  vec2 center = 0.25 + 0.5 * vec2(h21(bc + 3.3), h21(bc + 9.1));
  float radius = length(bf - center) * 3.0;
  float rad = 0.12 + 0.5 * smoothstep(0.0, 0.85, phase);
  float swell = phase < 0.88 ? 1.0 : 0.0;
  bubble = (1.0 - smoothstep(rad * 0.7, rad, radius)) * swell * on;
  float popRadius = rad + (phase - 0.88) * 9.0;
  popRing = phase >= 0.88 ? (1.0 - smoothstep(0.0, 0.1, abs(radius - popRadius))) * (1.0 - (phase - 0.88) / 0.12) * on : 0.0;
  float wet = clamp(open + crack + 0.25, 0.0, 1.0) * (1.0 - rim);
  bubble *= wet * detail;
  popRing *= wet * detail;
  float crustTemperature = 0.08 + heat * 0.14 + bleed * 0.32;
  float moltenTemperature = 0.52 + streak * 0.42;
  float temperature = mix(crustTemperature, moltenTemperature, open);
  temperature = max(temperature, crack * (0.5 + core * 0.45));
  temperature = max(temperature, bubble * 0.86);
  temperature = max(temperature, popRing * 0.95);
  temperature = max(temperature, contact * uEdgeGlow * 0.72 * (0.85 + 0.15 * sin(t * 2.3 + heat * 9.0)));
  temperature = clamp(temperature + agitation * 0.12, 0.0, 1.0);
  float pulse = 0.9 + 0.1 * sin(t * (1.6 + agitation * 2.0) + heat * 7.0);
  vec3 glow = ramp(temperature) * uEmission * pulse * (1.0 + agitation * 0.35);
  float crustMask = 1.0 - smoothstep(0.17, 0.3, temperature);
  vec3 albedo = uCrust * (0.7 + 0.6 * v.z) * (0.85 + 0.3 * smoothstep(0.1, 0.6, v.x));
  vec3 crust = albedo * mix(uShadowTint, vec3(1.0), uShadowLift) * uAmbientStrength;
  gl_FragColor = vec4(crust * crustMask + glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function applyUnityMaterial(source: THREE.MeshStandardMaterial, environment?: UnityEnvironment): THREE.Material {
  const properties = source.userData as Properties;
  // 风格化光照（SF_StylizedLit / SF_Foliage → UnityStylizedLit.ts）：场景件、草皮、树冠
  if (materialMarks(properties).shader === 'Spiritfire/StylizedLit') return createStylizedLit(source, environment);
  if (materialMarks(properties).shader === 'Spiritfire/Foliage') return createStylizedFoliage(source, environment);
  if (materialMarks(properties).shader === 'Spiritfire/Water' && environment) return createUnityWaterMaterial(source, environment);
  if (materialMarks(properties).shader === 'Spiritfire/Backdrop') {
    return new THREE.MeshBasicMaterial({
      color: color(properties, '_Tint', [1, 1, 1, 1]),
      vertexColors: (materialMarks(properties).floats._UseVertexColor ?? 1) > 0.5 && source.vertexColors,
      side: source.side,
      fog: false,
    });
  }
  if (materialMarks(properties).shader !== 'Spiritfire/Lava') return source;
  const floats = materialMarks(properties).floats;
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uCrust: { value: color(properties, '_CrustColor', [0.085, 0.06, 0.05, 1]) },
      uDeep: { value: color(properties, '_DeepColor', [0.42, 0.045, 0.01, 1]) },
      uHot: { value: color(properties, '_HotColor', [1, 0.33, 0.035, 1]) },
      uCore: { value: color(properties, '_CoreColor', [1, 0.82, 0.38, 1]) },
      uEmission: { value: floats._Emission ?? 1.55 },
      uNoiseScale: { value: floats._NoiseScale ?? 0.28 },
      uWarpScale: { value: floats._WarpScale ?? 0.11 },
      uPlateScale: { value: floats._PlateScale ?? 0.32 },
      uFlowSpeed: { value: floats._FlowSpeed ?? 1 },
      uAgitation: { value: floats._Agitation ?? 0 },
      uCrackWidth: { value: floats._CrackWidth ?? 0.1 },
      uMoltenAmount: { value: floats._MoltenAmount ?? 0.35 },
      uFlowStretch: { value: floats._FlowStretch ?? 1 },
      uBubbleRate: { value: floats._BubbleRate ?? 1 },
      uEdgeGlow: { value: floats._EdgeGlow ?? 1 },
      uShoreWidth: { value: floats._ShoreWidth ?? 1.5 },
      uShadowTint: { value: color(properties, '_ShadowTint', [0.66, 0.5, 0.52, 1]) },
      uShadowLift: { value: floats._ShadowLift ?? 0.3 },
      uAmbientStrength: { value: floats._AmbientStrength ?? 1 },
    }]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    side: source.side,
  });
  // 空气透视层的共享 uniform 原样挂上（不经 UniformsUtils.merge 克隆），否则这层对自写着色器不生效
  Object.assign(material.uniforms, Atmosphere.uniforms);
  material.name = source.name;
  return material;
}

export function applyUnityMaterialQuality(material: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): void {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap]) {
    if (texture && texture.anisotropy < anisotropy) {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }
  material.needsUpdate = true;
}
