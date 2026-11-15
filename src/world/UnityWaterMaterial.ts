import * as THREE from 'three';
import { Atmosphere } from './Atmosphere';
import type { GameContext } from '../core/types';
import type { UnityEnvironment } from './UnityLevelLibrary';

type Properties = { unityFloats?: Record<string, number>; unityColors?: Record<string, [number, number, number, number]>; unityVectors?: Record<string, [number, number, number, number]> };

function color(properties: Properties, name: string, fallback: [number, number, number, number]): THREE.Color {
  const rgba = properties.unityColors?.[name] ?? fallback;
  return new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
}

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vEye;
uniform float uTime;
uniform float uWaveHeight;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec3 p = position;
  vec4 world = modelMatrix * vec4(p, 1.0);
  if (normal.y > 0.5) world.y += uWaveHeight * 0.5 * (sin(world.x * 0.9 + uTime * 1.3) + sin(world.z * 1.1 - uTime * 1.1));
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  vEye = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoamColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uAlpha;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uFoamAmount;
uniform float uGloss;
uniform vec4 uFlow;
uniform float uShoreFoam;
uniform float uShoreDepth;
uniform float uDeepDepth;
uniform float uSparkle;
uniform float uRippleStrength;
uniform float uSwirl;
uniform float uSwirlSpeed;
uniform vec4 uSwirlCenter;
uniform float uFade;
uniform float uEdgeSoft;
uniform sampler2D uDepth;
uniform float uDepthValid;
uniform vec2 uNearFar;
uniform vec2 uViewport;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vEye;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float waveHeight(vec2 p, float t, vec2 flow) {
  float a = valueNoise(p + flow * t + vec2(0.0, t * uWaveSpeed * 0.3));
  float b = valueNoise(p * 2.1 - flow * t * 0.6 + vec2(t * uWaveSpeed * 0.45, 7.3));
  float c = valueNoise(p * 4.3 + flow * t * 1.4 + vec2(-t * uWaveSpeed * 0.7, t * uWaveSpeed * 0.5) + 19.1);
  return a * 0.55 + b * 0.3 + c * 0.15;
}
float linearDepth(float z) { return uNearFar.x * uNearFar.y / (uNearFar.y - z * (uNearFar.y - uNearFar.x)); }
void main() {
  float t = uTime;
  vec3 baseN = normalize(vNormal);
  bool top = baseN.y > 0.5;
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 xz = vWorld.xz, xz0 = xz;
  float swirlMask = 0.0, sandBands = 0.0;
  if (uSwirl > 0.001) {
    vec2 d = xz - uSwirlCenter.xy;
    float r = length(d), radius = max(uSwirlCenter.w, 0.5);
    float angle = t * uSwirlSpeed * (1.5 / (0.3 + r / radius));
    float sn = sin(angle), cs = cos(angle);
    vec2 rotated = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    xz = mix(xz, uSwirlCenter.xy + rotated, uSwirl);
    swirlMask = clamp(1.0 - r / radius, 0.0, 1.0) * uSwirl;
    float theta = atan(d.y, d.x);
    float arms = fract(theta / 6.2831 * 4.0 + log(max(r, 0.05)) * 1.6 + t * uSwirlSpeed * 0.6);
    float spiral = smoothstep(0.0, 0.18, arms) * (1.0 - smoothstep(0.35, 0.6, arms));
    float rings = 1.0 - smoothstep(0.0, 0.22, abs(fract(r * 0.9 + t * uSwirlSpeed * 0.7) - 0.5));
    float body = clamp(r / radius, 0.0, 1.0);
    sandBands = uSwirl * (spiral * (1.0 - body) * 0.9 + rings * smoothstep(0.35, 0.9, body) * (1.0 - smoothstep(0.92, 1.0, body)) * 0.5);
  }
  float scale = max(uWaveScale, 0.05);
  vec2 flow = uFlow.xy * uFlow.z / scale;
  vec2 p = xz / scale;
  const float e = 0.08;
  float h = waveHeight(p, t, flow), hx = waveHeight(p + vec2(e, 0.0), t, flow), hz = waveHeight(p + vec2(0.0, e), t, flow);
  vec3 bumped = vec3((h - hx) / e * 0.12, 1.0, (h - hz) / e * 0.12);
  vec3 N = top ? normalize(bumped) : baseN;
  vec2 suv = gl_FragCoord.xy / uViewport;
  float sceneEye = linearDepth(texture2D(uDepth, suv).x);
  float thick = max(0.0, sceneEye - vEye);
  if (uDepthValid < 0.5 || sceneEye <= 0.0) thick = 100.0;
  float vertical = thick * clamp(abs(V.y) + 0.15, 0.0, 1.0);
  float deep01 = clamp(vertical / max(0.1, uDeepDepth), 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  float tone = clamp(deep01 * 0.75 + fres * 0.45 + (h - 0.5) * 0.35, 0.0, 1.0);
  if (uSwirl < 0.5) tone = floor(tone * 3.0 + 0.5) / 3.0 * 0.85 + tone * 0.15;
  else tone = clamp(0.3 + fres * 0.6 + (h - 0.5) * 0.5, 0.0, 1.0);
  vec3 col = mix(uShallow, uDeep, tone);
  col = mix(col, uDeep, swirlMask * 0.55);
  col = mix(col, uFoamColor, sandBands * 0.55);
  col = mix(col, uDeep * 0.82, sandBands * swirlMask * 0.35);
  float foam = smoothstep(0.66, 0.8, h) * uFoamAmount;
  float shore = 0.0;
  if (top && uSwirl < 0.5 && uShoreFoam > 0.001) {
    float sd = max(0.05, uShoreDepth), s01 = clamp(vertical / sd, 0.0, 1.0);
    float n1 = valueNoise(xz0 * 2.3 + vec2(t * 0.25, -t * 0.2));
    float edgeFoam = step(s01, 0.16 + 0.22 * n1);
    float lines = step(0.76, fract(s01 * 2.2 - t * 0.35 + n1 * 0.4)) * step(s01, 0.55) * step(0.4, n1);
    shore = clamp(edgeFoam + lines * 0.8, 0.0, 1.0) * uShoreFoam;
    foam = max(foam, shore);
  }
  col = mix(col, uFoamColor, foam);
  float ndl = clamp(dot(N, uSunDirection), 0.0, 1.0) * 0.5 + 0.5;
  vec3 lit = col * (uSunColor * ndl * 0.8 + uAmbient * 0.5);
  vec3 H = normalize(uSunDirection + V);
  float ndh = clamp(dot(N, H), 0.0, 1.0);
  float spec = smoothstep(0.992, 0.996, ndh) * 1.6 * uGloss;
  float glint = 0.0;
  if (top && uSparkle > 0.001 && uSwirl < 0.5) {
    vec2 gc = floor(xz0 * 1.1), gf = fract(xz0 * 1.1);
    float gh = hash21(gc + 3.7);
    vec2 gp = 0.2 + 0.6 * vec2(hash21(gc + 11.1), gh);
    float tw = clamp(sin(t * (2.0 + gh * 3.0) + gh * 40.0) * 3.0 - 2.0, 0.0, 1.0);
    float dot_ = 1.0 - smoothstep(0.0, 0.045, length(gf - gp));
    float lobe = smoothstep(0.95, 0.995, ndh);
    glint = dot_ * tw * lobe * step(0.8, gh) * uSparkle * (1.0 - foam);
  }
  lit += uSunColor * (spec + glint * 2.2) * (1.0 - uSwirl * 0.8);
  lit = mix(lit, uAmbient * 1.1, fres * mix(0.25, 0.45, deep01) * uGloss);
  float alpha = mix(uAlpha * mix(0.8, 1.05, clamp(deep01 * 2.0, 0.0, 1.0)), max(uAlpha, 0.88), clamp(fres + deep01 * 0.6, 0.0, 1.0));
  if (uSwirl > 0.5) alpha = clamp(mix(uAlpha, max(uAlpha, 0.88), fres), 0.0, 1.0);
  alpha = clamp(alpha + foam * 0.5, 0.0, 1.0);
  float edge = 1.0;
  if (uEdgeSoft > 0.001) edge = 1.0 - smoothstep(1.0 - uEdgeSoft, 1.0, length(vUv - 0.5) * 2.0);
  alpha *= edge * uFade;
  gl_FragColor = vec4(lit, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createUnityWaterMaterial(source: THREE.MeshStandardMaterial, environment: UnityEnvironment): THREE.ShaderMaterial {
  const properties = source.userData as Properties;
  const floats = properties.unityFloats ?? {};
  const vectors = properties.unityVectors ?? {};
  const flow = vectors._Flow ?? [0, 0, 0, 1];
  const swirl = vectors._SwirlCenter ?? [0, 0, 2, 6];
  const sun = environment.sun;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uShallow: { value: color(properties, '_ShallowColor', [0.24, 0.62, 0.72, 0.5]) },
    uDeep: { value: color(properties, '_DeepColor', [0.05, 0.22, 0.4, 0.88]) },
    uFoamColor: { value: color(properties, '_FoamColor', [0.9, 0.97, 1, 1]) },
    uSunDirection: { value: new THREE.Vector3(...(sun?.forward ?? [0, -1, 0])).negate() },
    uSunColor: { value: color({ unityColors: { sun: sun?.color ?? [1, 1, 1, 1] } }, 'sun', [1, 1, 1, 1]).multiplyScalar(sun?.intensity ?? 1) },
    uAmbient: { value: color(properties, '_AmbientColor', environment.ambient.equator).multiplyScalar(environment.ambient.intensity) },
    uAlpha: { value: floats._Alpha ?? 0.72 },
    uWaveScale: { value: floats._WaveScale ?? 3 },
    uWaveSpeed: { value: floats._WaveSpeed ?? 0.6 },
    uWaveHeight: { value: floats._WaveHeight ?? 0.035 },
    uFoamAmount: { value: floats._FoamAmount ?? 0.35 },
    uGloss: { value: floats._Gloss ?? 1 },
    uFlow: { value: new THREE.Vector4(-flow[0], flow[1], flow[2], flow[3]) },
    uShoreFoam: { value: floats._ShoreFoam ?? 0.85 },
    uShoreDepth: { value: floats._ShoreDepth ?? 0.3 },
    uDeepDepth: { value: floats._DeepDepth ?? 2.5 },
    uSparkle: { value: floats._Sparkle ?? 1 },
    uRippleStrength: { value: floats._RippleStrength ?? 1 },
    uSwirl: { value: floats._Swirl ?? 0 },
    uSwirlSpeed: { value: floats._SwirlSpeed ?? 0.5 },
    uSwirlCenter: { value: new THREE.Vector4(-swirl[0], swirl[1], swirl[2], swirl[3]) },
    uFade: { value: floats._Fade ?? 1 },
    uEdgeSoft: { value: floats._EdgeSoft ?? 0 },
    uDepth: { value: null },
    uDepthValid: { value: 0 },
    uNearFar: { value: new THREE.Vector2(0.05, 3000) },
    uViewport: { value: new THREE.Vector2(1, 1) },
  }]);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, side: source.side, fog: true,
  });
  // 空气透视层的共享 uniform 原样挂上（不经 UniformsUtils.merge 克隆），否则这层对自写着色器不生效
  Object.assign(material.uniforms, Atmosphere.uniforms);
  material.name = source.name;
  material.userData.unityWater = true;
  return material;
}

let depthTarget: THREE.WebGLRenderTarget | null = null;
let depthMaterial: THREE.ShaderMaterial | null = null;

export function renderUnityWaterDepth(ctx: GameContext, materials: ReadonlySet<THREE.ShaderMaterial>): void {
  if (materials.size === 0) return;
  const renderer = ctx.renderer;
  const size = renderer.getSize(new THREE.Vector2());
  const width = Math.min(1024, Math.max(1, Math.floor(size.x * renderer.getPixelRatio())));
  const height = Math.min(1024, Math.max(1, Math.floor(size.y * renderer.getPixelRatio())));
  if (!depthTarget || depthTarget.width !== width || depthTarget.height !== height) {
    depthTarget?.dispose();
    depthTarget = new THREE.WebGLRenderTarget(width, height, { depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType) });
  }
  depthMaterial ??= new THREE.ShaderMaterial({
    vertexShader: 'varying float vDepth; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vDepth=-p.z;gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying float vDepth; void main(){gl_FragColor=vec4(vDepth,0.0,0.0,1.0);}',
    side: THREE.DoubleSide,
  });
  const target = renderer.getRenderTarget();
  const override = ctx.scene.overrideMaterial;
  const shadows = renderer.shadowMap.autoUpdate;
  const hidden: { object: THREE.Object3D; visible: boolean }[] = [];
  ctx.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    if (!meshMaterials.some(material => material.userData.unityWater)) return;
    hidden.push({ object, visible: object.visible });
    object.visible = false;
  });
  ctx.scene.overrideMaterial = depthMaterial;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(depthTarget);
  renderer.render(ctx.scene, ctx.camera);
  renderer.setRenderTarget(target);
  renderer.shadowMap.autoUpdate = shadows;
  ctx.scene.overrideMaterial = override;
  for (const item of hidden) item.object.visible = item.visible;
  for (const material of materials) {
    material.uniforms.uDepth.value = depthTarget.depthTexture;
    material.uniforms.uDepthValid.value = 1;
    material.uniforms.uNearFar.value.set(ctx.camera.near, ctx.camera.far);
    material.uniforms.uViewport.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
  }
}
