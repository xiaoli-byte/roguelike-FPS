/**
 * 远景：高原天空（深蓝天顶、浅色地平线、积云）、一圈远山、贡嘎主峰与周围雪峰。
 * 远山用场景雾做空气透视；天空着色器直接输出 sRGB，地平线颜色与雾色相同，天地衔接处没有接缝。
 */
import * as THREE from 'three';
import { srgb } from './fx';
import { WORLD_UNIFORMS, patchMaterial } from './materials';
import { GONGGA } from './spec';
import { fbm, gonggaWindow, passWindow, ridged, smoothstep, type Terrain } from './terrain';

export const SKY = {
  top: '#2a63c6',
  mid: '#5d97df',
  horizon: '#c9e0f1',
  /** 雷暴时的地平线 / 雾色 */
  stormHorizon: '#6d7384',
  sunDir: new THREE.Vector3(-0.52, 0.74, 0.42).normalize(),
};

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uTime;
uniform float uStorm; uniform float uFlash; uniform vec3 uStormHorizon;
varying vec3 vDir;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p = p * 2.02 + 7.3; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, y));
  col = mix(col, uTop, smoothstep(0.18, 0.85, y));
  if (y < 0.0) col = uHorizon;
  // 太阳
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.96, 0.86) * (pow(s, 1400.0) * 4.0 + pow(s, 60.0) * 0.18 + pow(s, 6.0) * 0.06) * (1.0 - uStorm);
  // 雷暴：铅灰带紫的天，越往天顶越暗
  vec3 stormSky = mix(uStormHorizon, vec3(0.14, 0.13, 0.2), smoothstep(0.0, 0.7, y));
  col = mix(col, stormSky, uStorm);
  // 积云：投到一张高空平面上
  if (y > 0.0) {
    vec2 p = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(p + vec2(4.0, 1.0));
    float m = smoothstep(0.5 - uStorm * 0.32, 0.72 - uStorm * 0.22, c) * smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.75, 1.0, y) * 0.5 * (1.0 - uStorm));
    float shade = smoothstep(0.5, 0.85, fbm(p * 1.7 + 2.0));
    vec3 cloud = mix(vec3(1.0, 1.0, 1.0), vec3(0.74, 0.8, 0.88), shade * 0.7);
    cloud = mix(cloud, mix(vec3(0.36, 0.35, 0.44), vec3(0.18, 0.17, 0.25), shade), uStorm);
    cloud += vec3(1.0, 0.95, 0.85) * pow(s, 8.0) * 0.25;
    col = mix(col, cloud, m * 0.92);
  }
  col += vec3(0.95, 0.85, 1.0) * uFlash * 0.85;
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    uniforms: {
      uTop: { value: srgb(SKY.top) }, uMid: { value: srgb(SKY.mid) }, uHorizon: { value: srgb(SKY.horizon) },
      uSunDir: { value: SKY.sunDir }, uTime: WORLD_UNIFORMS.uTime,
      uStorm: WORLD_UNIFORMS.uStorm, uFlash: WORLD_UNIFORMS.uFlash, uStormHorizon: { value: srgb(SKY.stormHorizon) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.scale.setScalar(4000);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  return sky;
}

// ───────────────────────────── 山 ─────────────────────────────

const ROCK = new THREE.Color('#6f6a66');
const ROCK_COOL = new THREE.Color('#5d6470');
const SNOW = new THREE.Color('#f6f9fd');
const SNOW_SHADE = new THREE.Color('#c9d7ea');
const HILL = new THREE.Color('#4f7d3a');
const HILL_FAR = new THREE.Color('#5d7f5a');

function colorFor(out: THREE.Color, y: number, slope: number, snowLine: number, green: number, n: number): void {
  out.copy(ROCK).lerp(ROCK_COOL, n);
  const g = (1 - smoothstep(snowLine * 0.25, snowLine * 0.55, y)) * green;
  out.lerp(n > 0.5 ? HILL : HILL_FAR, g);
  const snow = smoothstep(snowLine - 20, snowLine + 15, y + (n - 0.5) * 60) * (1 - smoothstep(0.95, 1.25, slope) * 0.7);
  out.lerp(SNOW, snow);
  if (snow > 0.2 && slope > 0.7) out.lerp(SNOW_SHADE, 0.35);
}

/** 单座山峰：径向网格；ridges 条主山脊把圆锥切成金字塔；sharp 越大越尖 */
function peak(o: { x: number; z: number; height: number; radius: number; ridges: number; sharp: number; seed: number; snow: number; green: number }): THREE.BufferGeometry {
  const rings = 34, segs = 72;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const base = -60;
  // 山脊和噪声的起伏都随 t → 0 收敛到 1，峰顶是圆的，不会冒出一根针
  const hAt = (t: number, a: number): number => {
    const ridge = Math.pow(Math.abs(Math.cos((a * o.ridges) / 2 + o.seed)), 0.6);
    const k = Math.min(1, t * 4);
    const prof = Math.pow(Math.max(0, 1 - t), o.sharp) * (1 - 0.28 * (1 - ridge) * k);
    const nx = Math.cos(a) * t * 3 + o.seed, nz = Math.sin(a) * t * 3 - o.seed;
    return o.height * prof * (1 + (0.28 * ridged(nx, nz, 4, o.seed | 0) - 0.14) * k);
  };
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const y = hAt(t, a);
      pos.push(o.x + Math.cos(a) * o.radius * t, base + y, o.z + Math.sin(a) * o.radius * t);
      const y2 = hAt(Math.min(1, t + 1 / rings), a);
      const slope = Math.atan(Math.abs(y - y2) / (o.radius / rings));
      colorFor(c, y, slope, o.height * o.snow, o.green, fbm(Math.cos(a) * 4 * t + o.seed, Math.sin(a) * 4 * t, 2, 3));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * segs + s, b = r * segs + ((s + 1) % segs), cc = (r + 1) * segs + ((s + 1) % segs), d = (r + 1) * segs + s;
    idx.push(a, b, d, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 一圈连续的远山：北、东是雪山，南、西是绿色山丘 */
function ring(): THREE.BufferGeometry {
  const segs = 360, rows = 10;
  const R0 = 1100, R1 = 3000;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const radius = (t: number): number => R0 + (R1 - R0) * Math.pow(t, 1.25);
  const hAt = (a: number, t: number): { y: number; snowy: number } => {
    // 方位：a = 0 指向 +x（东），a = -π/2 指向 −z（北）
    const north = Math.max(0, -Math.sin(a));
    const east = Math.max(0, Math.cos(a));
    const snowy = Math.min(1, north * 1.2 + east * 0.5);
    const R = radius(t);
    const amp = (90 + 260 * snowy) * (1 - 0.8 * gonggaWindow(Math.cos(a) * R, Math.sin(a) * R));
    const n = ridged(Math.cos(a) * 6 + t * 2, Math.sin(a) * 6 + t * 2, 5, 21);
    const swell = Math.sin(t * Math.PI) * 0.6 + t * 0.5;
    return { y: amp * n * swell + 20 * fbm(a * 9, t * 5, 3, 22), snowy };
  };
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const R = radius(t);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const { y, snowy } = hAt(a, t);
      pos.push(Math.cos(a) * R, -50 + y, Math.sin(a) * R);
      const slope = Math.abs(y - hAt(a + 0.02, t).y) / (R * 0.02);
      colorFor(c, y, Math.atan(slope), snowy > 0.3 ? 210 : 520, 1 - snowy * 0.6, fbm(a * 7, t * 3, 2, 23));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rows; r++) for (let s = 0; s < segs; s++) {
    const a = r * segs + s, b = r * segs + ((s + 1) % segs), cc = (r + 1) * segs + ((s + 1) % segs), d = (r + 1) * segs + s;
    idx.push(a, d, b, b, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 外围地形：把高度图四周到远山之间接起来（不然鸟瞰时地图是一座孤岛）。
 * 在高度图边缘取边缘高度，向外 260 m 内过渡到起伏的远丘；贡嘎视窗里压低，不挡主峰。
 */
export function buildFarTerrain(terrain: Terrain): THREE.Mesh {
  const R = 1400, cell = 14;
  const n = Math.round((2 * R) / cell) + 1;
  const pos = new Float32Array(n * n * 3);
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * cell, z = -R + j * cell, k = j * n + i;
    const cx = Math.min(terrain.maxX, Math.max(terrain.minX, x)), cz = Math.min(terrain.maxZ, Math.max(terrain.minZ, z));
    const d = Math.hypot(x - cx, z - cz);
    let y: number;
    if (d < 1e-6) { y = terrain.heightAt(x, z) - 6; inside[k] = 1; }
    else {
      const edge = terrain.heightAt(cx, cz);
      const north = smoothstep(100, -700, z), east = smoothstep(100, 800, x);
      const amp = (60 + 170 * Math.max(north, east * 0.7)) * (1 - 0.85 * Math.max(gonggaWindow(x, z), passWindow(x, z)));
      const hills = 10 + amp * ridged(x * 0.0032, z * 0.0032, 5, 41) + 25 * fbm(x * 0.01, z * 0.01, 3, 42);
      const t = smoothstep(0, 260, d);
      y = edge + (hills - edge) * t + (ridged(x * 0.02, z * 0.02, 3, 43) - 0.4) * 10 * Math.min(1, d / 80);
    }
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
  }
  const col = new Float32Array(n * n * 3);
  const c = new THREE.Color(), edgeCol = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const y = pos[k * 3 + 1], z = pos[k * 3 + 2], x = pos[k * 3];
    const yr = i < n - 1 ? pos[(k + 1) * 3 + 1] : y, yd = j < n - 1 ? pos[(k + n) * 3 + 1] : y;
    const slope = Math.atan(Math.hypot(yr - y, yd - y) / cell);
    const north = smoothstep(100, -700, z);
    const nz = fbm(x * 0.004, z * 0.004, 2, 44);
    // 草坡 → 陡处岩石 → 雪线以上积雪（雪线与高度图衔接：北侧约 50 m，往南升高）
    c.copy(nz > 0.5 ? HILL : HILL_FAR).lerp(ROCK, smoothstep(0.55, 0.85, slope) * 0.85);
    const line = 52 + 110 * (1 - north) + (fbm(x * 0.006, z * 0.006, 3, 45) - 0.5) * 50;
    const snow = smoothstep(line - 8, line + 12, y) * (1 - smoothstep(0.9, 1.2, slope) * 0.6);
    c.lerp(slope > 0.7 ? SNOW_SHADE : SNOW, snow);
    // 紧贴高度图的一圈沿用边缘颜色，接缝看不出来
    const cx = Math.min(terrain.maxX, Math.max(terrain.minX, x)), cz = Math.min(terrain.maxZ, Math.max(terrain.minZ, z));
    const d = Math.hypot(x - cx, z - cz);
    if (d < 90) {
      const ti = Math.min(terrain.nx - 1, Math.round((cx - terrain.minX) / terrain.step));
      const tj = Math.min(terrain.nz - 1, Math.round((cz - terrain.minZ) / terrain.step));
      const tk = (tj * terrain.nx + ti) * 3;
      edgeCol.setRGB(terrain.colors[tk], terrain.colors[tk + 1], terrain.colors[tk + 2]);
      c.lerp(edgeCol, 1 - smoothstep(10, 90, d));
    }
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, cc = a + n + 1, d = a + n;
    if (inside[a] && inside[b] && inside[cc] && inside[d]) continue;
    idx.push(a, cc, b, a, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true })));
  mesh.name = 'far-terrain';
  return mesh;
}

export function buildMountains(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mountains';
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const ringMesh = new THREE.Mesh(ring(), mat);
  group.add(ringMesh);
  const peaks = [
    { x: GONGGA.x, z: GONGGA.z, height: GONGGA.height, radius: GONGGA.radius, ridges: 3, sharp: 1.55, seed: 1.3, snow: 0.38, green: 0 },
    { x: 230, z: -1560, height: 430, radius: 560, ridges: 4, sharp: 1.3, seed: 2.1, snow: 0.45, green: 0.2 },
    { x: 720, z: -1880, height: 520, radius: 640, ridges: 3, sharp: 1.4, seed: 3.7, snow: 0.42, green: 0 },
    { x: 940, z: -1460, height: 380, radius: 560, ridges: 4, sharp: 1.2, seed: 4.4, snow: 0.5, green: 0.2 },
    { x: 40, z: -1760, height: 360, radius: 600, ridges: 3, sharp: 1.25, seed: 5.2, snow: 0.5, green: 0.2 },
    { x: 580, z: -1360, height: 250, radius: 460, ridges: 5, sharp: 1.15, seed: 6.6, snow: 0.6, green: 0.35 },
    { x: 1350, z: -760, height: 300, radius: 560, ridges: 4, sharp: 1.3, seed: 7.9, snow: 0.5, green: 0.2 },
    { x: -950, z: -1050, height: 260, radius: 620, ridges: 4, sharp: 1.15, seed: 8.3, snow: 0.6, green: 0.4 },
    { x: -1150, z: 560, height: 170, radius: 700, ridges: 5, sharp: 1.0, seed: 9.1, snow: 1.4, green: 1 },
    { x: 220, z: 1300, height: 150, radius: 760, ridges: 5, sharp: 1.0, seed: 10.4, snow: 1.4, green: 1 },
  ];
  for (const p of peaks) group.add(new THREE.Mesh(peak(p), mat));
  return group;
}
