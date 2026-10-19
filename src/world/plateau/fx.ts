/**
 * 会动的环境：溪流（冰川融水，乳白青绿）、海子（青绿色）、煨桑的白烟。
 * 都是自写着色器、不受雾影响——它们离玩家都不远，雾几乎为零。
 */
import * as THREE from 'three';
import type { SmokeEmitter } from './landmarks';
import { LAKES, RIVER } from './spec';
import type { Terrain } from './terrain';
import { WORLD_UNIFORMS } from './materials';
import { windAt, type WindSample } from './wind';

/** 自写着色器不做色彩空间转换，直接输出 sRGB，所以 uniform 也给 sRGB 分量 */
export const srgb = (hex: THREE.ColorRepresentation): THREE.Vector3 => {
  const o = { r: 0, g: 0, b: 0 };
  new THREE.Color(hex).getRGB(o, THREE.SRGBColorSpace);
  return new THREE.Vector3(o.r, o.g, o.b);
};

const WATER_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uFlow;
uniform float uRadial;
varying vec2 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float across = uRadial > 0.5 ? clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0) : abs(vUv.x - 0.5) * 2.0;
  vec3 col = mix(uDeep, uShallow, smoothstep(0.15, 0.95, across));
  vec2 p = uRadial > 0.5 ? vWorld.xz * 0.35 + vec2(uTime * 0.05, uTime * 0.03) : vec2(vUv.x * 4.0, vUv.y * 1.6 - uTime * uFlow);
  float s = n(p * vec2(1.0, 0.35)) * 0.6 + n(p * 2.7 + 3.0) * 0.4;
  float foam = smoothstep(0.62, 0.86, s) * (uRadial > 0.5 ? 0.25 : 0.75);
  float edge = smoothstep(0.7, 1.0, across) * (uRadial > 0.5 ? 0.35 : 0.5);
  col = mix(col, uFoam, foam + edge * 0.6);
  // 天光反射：越平越亮
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
  col = mix(col, vec3(0.74, 0.86, 0.95), fres * 0.3);
  gl_FragColor = vec4(col, 0.86);
}`;

export function waterMaterial(deep: string, shallow: string, flow: number, radial: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    uniforms: {
      uTime: WORLD_UNIFORMS.uTime,
      uDeep: { value: srgb(deep) }, uShallow: { value: srgb(shallow) }, uFoam: { value: srgb('#eef6f4') },
      uFlow: { value: flow }, uRadial: { value: radial ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}

export function buildWater(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  // 溪流：沿中线的条带，宽度略大于河床，两岸地形会盖住边缘
  const S = terrain.river, W = terrain.riverWater;
  const half = RIVER.channelHalf + 0.9;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < S.length; i++) {
    const p = S[i];
    const nx = -p.tz, nz = p.tx;
    // 岸比水面低的地方，水面边缘贴着岸走，不悬空
    const ax = p.x + nx * half, az = p.z + nz * half, bx = p.x - nx * half, bz = p.z - nz * half;
    const ya = Math.min(W[i], terrain.heightAt(ax, az) + 0.03), yb = Math.min(W[i], terrain.heightAt(bx, bz) + 0.03);
    pos.push(ax, ya, az, bx, yb, bz);
    uv.push(0, p.s / 6, 1, p.s / 6);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.setIndex(idx);
  sg.computeBoundingSphere();
  const stream = new THREE.Mesh(sg, waterMaterial('#4a8f9e', '#8fbfc4', 0.9, false));
  stream.renderOrder = 2;
  group.add(stream);
  LAKES.forEach((L, n) => {
    // 湖面：椭圆，稍大于湖盆（岸边地形会盖住多出来的部分）
    const pg = new THREE.CircleGeometry(1, 64);
    pg.rotateX(-Math.PI / 2);
    pg.scale(L.rx * 1.2, 1, L.rz * 1.2);
    pg.rotateY(-L.rot);
    const lake = new THREE.Mesh(pg, waterMaterial(L.deep, L.shallow, 0, true));
    lake.position.set(L.x, terrain.lakeLevel[n], L.z);
    lake.name = `lake.${L.id}`;
    lake.renderOrder = 2;
    group.add(lake);
  });
  return group;
}

// ───────────────────────────── 桑烟 ─────────────────────────────

const SMOKE_VS = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * 900.0 / -mv.z, 260.0);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FS = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.6) * vAlpha;
  gl_FragColor = vec4(vec3(0.97, 0.96, 0.94), a);
}`;

interface Puff { e: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number }

export class Smoke {
  readonly points: THREE.Points;
  private readonly puffs: Puff[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private seed = 5;
  private readonly winds: WindSample[];

  constructor(private readonly emitters: SmokeEmitter[]) {
    this.winds = emitters.map(e => windAt(e.x, e.z));
    emitters.forEach((em, e) => {
      const n = em.steam ? 22 : em.big ? 120 : 45;
      const life = em.steam ? 3.2 : em.big ? 11 : 5.5;
      for (let i = 0; i < n; i++) {
        const p = this.spawn(e);
        p.age = (i / n) * life;
        this.advance(p, p.age);
        this.puffs.push(p);
      }
    });
    const n = this.puffs.length;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.write();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawn(e: number): Puff {
    const em = this.emitters[e];
    return {
      e, x: em.x + (this.rand() - 0.5) * 0.4, y: em.y, z: em.z + (this.rand() - 0.5) * 0.4,
      vx: (this.rand() - 0.5) * 0.4, vy: (em.steam ? 0.8 : em.big ? 3.6 : 2.2) + this.rand() * 0.8, vz: (this.rand() - 0.5) * 0.4,
      age: 0, life: (em.steam ? 3.2 : em.big ? 11 : 5.5) * (0.8 + this.rand() * 0.4), size: em.steam ? 0.8 : em.big ? 1.6 : 0.9,
    };
  }

  private advance(p: Puff, dt: number): void {
    const big = this.emitters[p.e].big;
    p.age += dt;
    const rise = p.y - this.emitters[p.e].y;
    // 越高风越大，烟柱顺着当地风向弯；离飞廉越近弯得越厉害
    const w = this.winds[p.e];
    const wind = (0.25 + Math.min(1, rise / 18) * (big ? 1.5 : 1.0)) * (1 + 2.5 * w.strength);
    p.x += (p.vx + wind * w.dx) * dt;
    p.z += (p.vz + wind * w.dz) * dt;
    p.y += p.vy * dt;
    p.vy *= Math.max(0, 1 - dt * 0.12);
  }

  update(dt: number): void {
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      this.advance(p, dt);
      if (p.age >= p.life) this.puffs[i] = this.spawn(p.e);
    }
    this.write();
  }

  private write(): void {
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      const t = p.age / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.alpha[i] = Math.min(1, t * 6) * (1 - t) * (this.emitters[p.e].steam ? 0.3 : this.emitters[p.e].big ? 0.42 : 0.5);
      this.size[i] = p.size * (1 + t * (this.emitters[p.e].big ? 4.5 : 3));
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
    g.getAttribute('aSize').needsUpdate = true;
  }
}
