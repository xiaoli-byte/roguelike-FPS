import * as THREE from 'three';
import type { DesertPart, Rgb } from './spec';

/**
 * 天边的沙暴墙（1-1 概念图「出生第一眼」右侧天际那一道褐黄的尘墙；level-art.md「特效」）：
 * 远处一段圆弧形的竖带，片元里用滚动的分形噪声画出翻涌的尘团——底下浓、顶沿被噪声啃成一团团的云头，两头淡出；
 * 朝太阳的一侧尘团边上发亮，背阳的一侧压暗。一次绘制调用，不吃场景雾（它在雾终点之外），自己按地平线色做空气透视。
 *
 *   const storm = new StormWall({ center: [210, 160], azimuth: [35, 100], distance: 750, height: 90, baseY: 0 });
 *   group.add(storm.mesh);  // 每帧 storm.update(dt, t)
 */
export interface StormWallOptions {
  /** 圆弧的圆心（世界 XZ，一般是图中心） */
  center: [number, number];
  /** 方位角段（度，同 farLayer / spec.ts：0 = +Z，90 = +X），从第一个转到第二个 */
  azimuth: [number, number];
  /** 离圆心多远（m） */
  distance: number;
  /** 尘墙高（m，墙顶被噪声啃掉约三成，实际轮廓更低） */
  height: number;
  /** 墙脚的世界高度 */
  baseY: number;
  /** 受光面 / 背光面的颜色（sRGB），默认暖褐黄 / 深褐灰 */
  lit?: Rgb;
  shade?: Rgb;
  /** 往地平线色里化多少 0..1，默认 0.35 */
  haze?: number;
  /** 地平线色（sRGB），默认暖灰 */
  horizon?: Rgb;
  /** 不透明度，默认 0.92 */
  opacity?: number;
  /** 太阳的方位角（度，同上）：尘团朝它的那一侧发亮 */
  sunAzimuth?: number;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vAz;
attribute float aAz;
void main() {
  vUv = uv;
  vAz = aAz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHorizon;
uniform float uHaze;
uniform float uOpacity;
uniform float uSunAz;
uniform float uSpan;
varying vec2 vUv;
varying float vAz;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  // 横向按弧长铺（uSpan = 弧长 / 高），纵向 0 = 墙脚、1 = 墙顶
  vec2 p = vec2(vUv.x * uSpan * 2.2, vUv.y * 2.2);
  float t = uTime;
  // 两层：慢慢往一侧卷、往上翻
  float a = fbm(p + vec2(t * 0.012, -t * 0.02));
  float b = fbm(p * 1.9 + vec2(-t * 0.02, -t * 0.035) + a * 1.3);
  float billow = a * 0.6 + b * 0.4;
  // 墙顶的轮廓：被噪声啃成一团团云头
  float top = 0.48 + 0.42 * billow;
  float body = 1.0 - smoothstep(top - 0.18, top + 0.04, vUv.y);
  // 两头淡出
  float ends = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.78, 1.0, vUv.x));
  float alpha = body * ends * uOpacity * (0.75 + 0.25 * b);
  if (alpha < 0.004) discard;
  // 尘团的受光：噪声的梯度近似成一个朝上 / 朝太阳的法线，越朝太阳越亮；墙脚更暗（尘最厚）
  float dx = fbm(p + vec2(0.06, 0.0) + vec2(t * 0.012, -t * 0.02)) - a;
  float side = clamp(0.5 + 0.5 * cos(radians(vAz - uSunAz)), 0.0, 1.0);
  float light = clamp(0.45 + billow * 0.6 + vUv.y * 0.35 - dx * 6.0 * (side - 0.5), 0.0, 1.0);
  vec3 col = mix(uShade, uLit, light * mix(0.7, 1.0, side));
  // 空气透视：往地平线色里化，墙脚化得多（贴着地平线的那一溜最淡）
  col = mix(col, uHorizon, uHaze * (1.0 - 0.5 * vUv.y));
  gl_FragColor = vec4(col, alpha);
}`;

export class StormWall implements DesertPart {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;

  constructor(o: StormWallOptions) {
    const [a0, a1] = o.azimuth, seg = 64;
    const pos: number[] = [], uv: number[] = [], az: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, a = (a0 + (a1 - a0) * t) * Math.PI / 180;
      const x = o.center[0] + Math.sin(a) * o.distance, z = o.center[1] + Math.cos(a) * o.distance;
      // 墙脚压到地平线下 10 m：远景地面的起伏不会在墙脚漏出一条缝
      pos.push(x, o.baseY - 10, z, x, o.baseY + o.height, z);
      uv.push(t, 0, t, 1);
      az.push(a0 + (a1 - a0) * t, a0 + (a1 - a0) * t);
    }
    for (let i = 0; i < seg; i++) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('aAz', new THREE.Float32BufferAttribute(az, 1));
    geometry.setIndex(idx);
    geometry.computeBoundingSphere();
    const span = Math.abs(a1 - a0) * Math.PI / 180 * o.distance / o.height;
    const v3 = (c: Rgb): THREE.Vector3 => new THREE.Vector3(...c);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uLit: { value: v3(o.lit ?? [0.86, 0.66, 0.44]) },
        uShade: { value: v3(o.shade ?? [0.5, 0.38, 0.29]) },
        uHorizon: { value: v3(o.horizon ?? [0.9, 0.78, 0.62]) },
        uHaze: { value: o.haze ?? 0.35 },
        uOpacity: { value: o.opacity ?? 0.92 },
        uSunAz: { value: o.sunAzimuth ?? 90 },
        uSpan: { value: span },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'DesertStormWall';
    this.mesh.frustumCulled = false;
    // 远景剪影（farLayer）之后、近处半透明之前画
    this.mesh.renderOrder = -8;
  }

  update(_dt: number, t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
