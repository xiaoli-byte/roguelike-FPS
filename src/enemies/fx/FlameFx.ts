/**
 * 火系怪的「贴合模型」火焰特效（火浣鼠起用，见 docs/art/enemy-roster-v2.md）：
 *
 * - applyFlameFur：在美术材质上叠一层毛尖自发光。按贴图颜色识别雕塑感的火苗毛（浅金 / 亮橙），只让这部分发光，
 *   再叠一层沿模型向上流动的闪烁。亮度由调用方每帧写 glow（平时微亮，前摇、滚动时最亮）。
 * - FlameTongue：程序化的火舌片（朝镜头的面片，形状由噪声扭动，底部白热、顶部转红），挂在骨骼上跟着动。
 * - spawnFlamePillar / spawnScorch / tongue 对象池：爆炸火柱、余火上跳动的小火苗、地面焦痕。
 *
 * 所有火舌共享一个时间 uniform（FLAME_FX_TIME），调用方每帧写 ctx.time.now。着色器按源码缓存，实例只多一份 uniform。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { GroundDecal } from '../bosses/Visuals';

export const FLAME_FX_TIME = { value: 0 };

const NOISE = /* glsl */ `
float ffHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
float ffNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ffHash(i), ffHash(i + vec3(1, 0, 0)), f.x), mix(ffHash(i + vec3(0, 1, 0)), ffHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ffHash(i + vec3(0, 0, 1)), ffHash(i + vec3(1, 0, 1)), f.x), mix(ffHash(i + vec3(0, 1, 1)), ffHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

// ───────────── 毛尖自发光 ─────────────

export interface FlameFurHandle {
  /** 发光强度（0 = 不亮；约 1 = 前摇 / 滚动时的最亮） */
  glow: { value: number };
}

/**
 * 在材质上叠火苗毛自发光（保留材质原有的 onBeforeCompile，例如角色边缘光）。
 * 识别规则在线性空间：亮度高、偏暖（红远大于蓝）、绿不太低 = 浅金 / 亮橙的火苗；深红的底毛和奶白的肚皮不亮。
 */
export function applyFlameFur(material: THREE.MeshStandardMaterial, color = 0xffa040): FlameFurHandle {
  const glow = { value: 0.5 };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uFlameTime = FLAME_FX_TIME;
    shader.uniforms.uFlameGlow = glow;
    shader.uniforms.uFlameColor = { value: new THREE.Color(color) };
    shader.vertexShader = 'varying vec3 vFlamePos;\n' + shader.vertexShader.replace(
      '#include <skinning_vertex>', '#include <skinning_vertex>\n  vFlamePos = transformed;');
    shader.fragmentShader = 'uniform float uFlameTime;\nuniform float uFlameGlow;\nuniform vec3 uFlameColor;\nvarying vec3 vFlamePos;\n'
      + NOISE + shader.fragmentShader.replace('#include <opaque_fragment>', `
        {
          vec3 fc = diffuseColor.rgb;
          float lum = max(fc.r, max(fc.g, fc.b));
          float flame = smoothstep(0.7, 0.95, lum) * smoothstep(0.45, 0.75, fc.r - fc.b) * smoothstep(0.12, 0.35, fc.g);
          float n = ffNoise(vFlamePos * 9.0 - vec3(0.0, uFlameTime * 2.6, 0.0));
          float n2 = ffNoise(vFlamePos * 21.0 - vec3(0.0, uFlameTime * 5.0, 0.0));
          outgoingLight += uFlameColor * flame * uFlameGlow * (0.45 + 0.8 * n + 0.35 * n2);
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${prevKey}+flamefur`;
  material.needsUpdate = true;
  return { glow };
}

// ───────────── 火舌片 ─────────────

const TONGUE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // 朝镜头的面片：底边中点在原点，按模型矩阵的缩放放大（跟着骨骼与整体缩放）
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(modelViewMatrix[0].xyz), sy = length(modelViewMatrix[1].xyz);
  mv.xy += position.xy * vec2(sx, sy);
  gl_Position = projectionMatrix * mv;
}`;
const TONGUE_FRAG = /* glsl */ `
uniform float uTime; uniform float uSeed; uniform float uAlpha; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uTip;
varying vec2 vUv;
${NOISE}
void main() {
  float h = vUv.y;
  float t = uTime * 2.4 + uSeed * 13.0;
  float n = ffNoise(vec3(vUv.x * 3.0 + uSeed * 7.0, h * 2.6 - t, uSeed));
  float n2 = ffNoise(vec3(vUv.x * 7.0, h * 5.0 - t * 1.7, uSeed + 3.0));
  // 越往上摆得越厉害；水滴形轮廓：底部圆、顶部收尖，顶端被噪声啃出火苗边
  float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 0.9 * h;
  float width = 1.05 * sqrt(max(h, 0.0)) * (1.0 - h * 0.85) + 0.04;
  float body = smoothstep(width, width * 0.55, abs(x));
  body *= smoothstep(1.0, 0.55 + 0.3 * n2, h) * smoothstep(0.0, 0.08, h);
  float core = smoothstep(width * 0.55, 0.0, abs(x)) * smoothstep(0.75, 0.1, h);
  vec3 col = mix(uMid, uTip, smoothstep(0.35, 1.0, h));
  col = mix(col, uHot, core);
  float a = body * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * (1.2 + core), a);
}`;

let tongueGeo: THREE.BufferGeometry | null = null;

export type FlameTongue = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

/** 一片火舌（底边中点为原点、高 1、宽 0.6，用 scale 定大小）。材质由调用方持有（dispose） */
export function createFlameTongue(seed = Math.random(), hot = 0xfff1c0, mid = 0xffa030, tip = 0xd8401a): FlameTongue {
  if (!tongueGeo) {
    tongueGeo = new THREE.PlaneGeometry(0.6, 1, 1, 1);
    tongueGeo.translate(0, 0.5, 0);
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: TONGUE_VERT, fragmentShader: TONGUE_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: FLAME_FX_TIME, uSeed: { value: seed }, uAlpha: { value: 1 },
      uHot: { value: new THREE.Color(hot) }, uMid: { value: new THREE.Color(mid) }, uTip: { value: new THREE.Color(tip) },
    },
  });
  const m = new THREE.Mesh(tongueGeo, mat);
  m.frustumCulled = false;
  m.renderOrder = 4;
  m.castShadow = false;
  return m;
}

// ───────────── 瞬时火舌（对象池） ─────────────

const pool: FlameTongue[] = [];

function acquire(parent: THREE.Object3D): FlameTongue {
  const t = pool.pop() ?? createFlameTongue();
  t.material.uniforms.uSeed.value = Math.random();
  t.visible = true;
  parent.add(t);
  return t;
}

function release(t: FlameTongue): void {
  t.removeFromParent();
  t.visible = false;
  pool.push(t);
}

/**
 * 一组在地面上跳动的火舌：count 片撒在 radius 内，持续 duration 秒（最后 0.6 秒收小熄灭）。
 * 用于火浣鼠死后的余火、爆炸后的残焰。
 */
export function spawnGroundFlames(ctx: GameContext, center: THREE.Vector3, radius: number, count: number, duration: number, size = 0.5): void {
  const items: { t: FlameTongue; base: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = acquire(ctx.stageGroup);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    t.position.set(center.x + Math.cos(a) * r, center.y + 0.02, center.z + Math.sin(a) * r);
    items.push({ t, base: size * (0.6 + Math.random() * 0.6), phase: Math.random() * 10 });
  }
  let age = 0;
  ctx.tasks.add((dt) => {
    age += dt;
    FLAME_FX_TIME.value = ctx.time.now;
    const fadeIn = Math.min(1, age / 0.2);
    const fadeOut = Math.min(1, Math.max(0, (duration - age) / 0.6));
    for (const it of items) {
      // 一跳一跳地蹿高：高度随时间起伏
      const pulse = 0.75 + 0.35 * Math.sin(age * 9 + it.phase) + 0.15 * Math.sin(age * 23 + it.phase * 2);
      const s = it.base * fadeIn * fadeOut;
      it.t.scale.set(s * 0.9, s * pulse * 1.4, s);
      it.t.material.uniforms.uAlpha.value = 0.9 * fadeOut;
    }
    if (age >= duration) {
      for (const it of items) release(it.t);
      return true;
    }
    return false;
  });
}

/** 爆炸火柱：一圈火舌从爆心猛地蹿起再收回（约 0.7 秒） */
export function spawnFlamePillar(ctx: GameContext, ground: THREE.Vector3, radius: number, height: number): void {
  const items: { t: FlameTongue; delay: number; h: number }[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = acquire(ctx.stageGroup);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, r = i === 0 ? 0 : radius * (0.35 + Math.random() * 0.4);
    t.position.set(ground.x + Math.cos(a) * r, ground.y, ground.z + Math.sin(a) * r);
    items.push({ t, delay: i === 0 ? 0 : Math.random() * 0.08, h: height * (i === 0 ? 1 : 0.55 + Math.random() * 0.35) });
  }
  let age = 0;
  const life = 0.7;
  ctx.tasks.add((dt) => {
    age += dt;
    FLAME_FX_TIME.value = ctx.time.now;
    for (const it of items) {
      const u = Math.max(0, age - it.delay) / life;
      // 0.12 秒内蹿到最高，随后收矮、变细、淡出
      const rise = u < 0.17 ? u / 0.17 : 1 - (u - 0.17) / 0.83 * 0.6;
      const w = it.h * 0.55 * (1 - u * 0.5);
      it.t.scale.set(w, Math.max(0.01, it.h * rise), w);
      it.t.material.uniforms.uAlpha.value = Math.max(0, 1 - u * u);
    }
    if (age >= life + 0.1) {
      for (const it of items) release(it.t);
      return true;
    }
    return false;
  });
}

/** 地面焦痕：深褐色的圆形烧痕，duration 秒内慢慢淡掉 */
export function spawnScorch(ctx: GameContext, ground: THREE.Vector3, radius: number, duration = 6): void {
  const decal = GroundDecal.acquire(ctx.stageGroup, 0x2a160c).circle(ground.x, ground.y - 0.01, ground.z, radius);
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    decal.opacity = 0.75 * Math.min(1, t / 0.1) * Math.max(0, 1 - Math.max(0, t - duration * 0.5) / (duration * 0.5));
    if (t >= duration) {
      decal.release();
      return true;
    }
    return false;
  });
}

/** 贴地扩散的火环冲击波（约 0.4 秒从 0 扩到 radius） */
export function spawnFireRing(ctx: GameContext, ground: THREE.Vector3, radius: number): void {
  const decal = GroundDecal.acquire(ctx.stageGroup, 0xffa040).circle(ground.x, ground.y, ground.z, 0.2, 0);
  let t = 0;
  const life = 0.4;
  ctx.tasks.add((dt) => {
    t += dt;
    const u = Math.min(1, t / life);
    const e = 1 - (1 - u) * (1 - u);
    const outer = 0.2 + radius * e;
    decal.setRadii(outer, Math.max(0, outer - 0.35 - 0.4 * (1 - u)));
    decal.opacity = 1 - u * u;
    if (u >= 1) {
      decal.release();
      return true;
    }
    return false;
  });
}
