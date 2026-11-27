import * as THREE from 'three';
import type { DesertPart, Rgb } from './spec';

/**
 * 地面散布（level-art.md「细节」；照第一章构图概念图的近景：压暗的砾石路肩、枯草一丛丛、碎石、古道上的两道车辙）。
 *   - 枯草：一丛 7 片细叶，根暗梢亮（干草的土黄），顶点着色器里随风摆；
 *   - 碎石：低多边形的小石块（0.08–0.5 m），几种灰褐 / 赭色；
 *   - 路面：沿每条路贴地的一条带，乘法混合压暗——中间两道车辙、两边一溜砾石路肩（断断续续，不是两条直线）。
 * 草和石按 96 m 一块分组（每块每样一个实例网格，看不见的块整块剔掉），离镜头 70–90 m 以外缩没（远处是几个像素的细点，会闪）。
 * 背光面补一点自发光（场景里没有给标准材质的环境光，同 banners.ts）。
 */
export interface ScatterSurface {
  /** 渲染高度（地形网格） */
  height(x: number, z: number): number;
  /** 这一点的地面（白盒材质名：sand / dune / gravel / road / mud / rock / earth / stone …）；null = 不放（压在体块下、水里、图外） */
  kind(x: number, z: number): string | null;
}

export interface ScatterRoad {
  pts: [number, number][];
  /** 路面半宽（m） */
  half: number;
}

export interface GroundScatterOptions {
  /** 散布范围 [x0, z0, x1, z1] */
  bounds: [number, number, number, number];
  roads: ScatterRoad[];
  wind: [number, number];
  /** 枯草密度（丛 / m²，按地面材质；没写的 = 0） */
  grass?: Partial<Record<string, number>>;
  /** 碎石密度（块 / m²） */
  pebbles?: Partial<Record<string, number>>;
  /** 路肩：路边多宽算路肩（m），路肩上额外加的草 / 石密度 */
  shoulder?: { width: number; grass: number; pebbles: number };
  /** 这些圆里密度减半（据点场地中心：交战区不要满地碎东西） */
  calm?: { x: number; z: number; r: number }[];
  /** 枯草颜色：根、梢（sRGB） */
  grassColor?: [Rgb, Rgb];
  pebbleColors?: Rgb[];
  /** 车辙 + 路肩压暗带；false = 不要 */
  ruts?: boolean;
  /** 车辙 / 路肩压暗的颜色（sRGB，乘到地面上） */
  rutTint?: Rgb;
  seed?: number;
  low?: boolean;
}

const TILE = 96;
const AMBIENT = 0.42;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一丛枯草：12 片细叶从中心往外弯（矮、蓬，概念图里那种一团干草），根部 0.5 倍色、梢 1.15 倍色（实例色再乘上去） */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const r = rng(7);
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2, lean = 0.35 + r() * 0.55, w = 0.014 + r() * 0.012, h = 0.22 + r() * 0.3;
    const ox = Math.cos(a) * r() * 0.08, oz = Math.sin(a) * r() * 0.08;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const mx = ox + Math.cos(a) * lean * h * 0.45, mz = oz + Math.sin(a) * lean * h * 0.45;
    const tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h;
    // 两段：根 → 中（宽）→ 梢（尖），叶子往外弯
    const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, wa: number, wb: number, ca: number, cb: number): void => {
      pos.push(ax - px * wa, ay, az - pz * wa, ax + px * wa, ay, az + pz * wa, bx + px * wb, by, bz + pz * wb);
      pos.push(ax - px * wa, ay, az - pz * wa, bx + px * wb, by, bz + pz * wb, bx - px * wb, by, bz - pz * wb);
      for (const c of [ca, ca, cb, ca, cb, cb]) col.push(c, c, c * 0.95);
      for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
    };
    quad(ox, 0, oz, mx, h * 0.55, mz, 1, 0.8, 0.5, 0.85);
    quad(mx, h * 0.55, mz, tx, h, tz, 0.8, 0.05, 0.85, 1.15);
  }
  // 两面都朝上受光：每个三角形反着再来一份（不用 DoubleSide，它会把背面法线翻成朝下）
  const n = pos.length / 9;
  for (let t = 0; t < n; t++) for (const v of [0, 2, 1]) {
    const k = t * 3 + v;
    pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
    nrm.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** 小石块：二十面体顶点随机推拉、压扁，平面着色 */
function pebbleGeometry(seed: number): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, 0);
  const r = rng(seed);
  const p = base.getAttribute('position');
  const key = (x: number, y: number, z: number): string => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const offs = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (!offs.has(k)) offs.set(k, 0.75 + r() * 0.5);
    const s = offs.get(k)!;
    p.setXYZ(i, p.getX(i) * s, Math.max(-0.3, p.getY(i) * s * 0.72), p.getZ(i) * s);
  }
  const g = base.toNonIndexed();
  base.dispose();
  g.computeVertexNormals();
  const cols = new Float32Array(g.getAttribute('position').count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

/** 标准材质 + 自发光补环境光 + 离镜头远了缩没 + （草）随风摆 */
function scatterMaterial(uniforms: Record<string, THREE.IUniform>, fade: [number, number], sway: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: new THREE.Color(AMBIENT, AMBIENT, AMBIENT) });
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec2 uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 wo = (modelMatrix * vec4(origin, 1.0)).xyz;
  float d = distance(cameraPosition.xz, wo.xz);
  transformed *= 1.0 - smoothstep(${fade[0].toFixed(1)}, ${fade[1].toFixed(1)}, d);
  ${sway ? `float k = position.y * position.y * 2.2;
  float ph = wo.x * 0.13 + wo.z * 0.17;
  float g = sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.9) * 0.25 + 0.55;
  transformed.xz += uWind * k * g * 0.18;` : ''}
}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= vColor.rgb;`);
  };
  return m;
}

const RUT_VERTEX = /* glsl */ `
attribute vec2 aRoad; // 横向偏移（m，带符号）, 沿路距离（m）
attribute float aHalf;
varying vec2 vRoad;
varying float vHalf;
varying vec3 vWorld;
void main() {
  vRoad = aRoad;
  vHalf = aHalf;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const RUT_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uShoulder;
varying vec2 vRoad;
varying float vHalf;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float u = vRoad.x, s = vRoad.y, au = abs(u);
  // 两道车辙：离路中线 ±0.85 m，宽约 0.4 m，沿路时深时浅
  float r = abs(au - 0.85 - 0.12 * (n(vec2(s * 0.07, 3.0)) - 0.5));
  float rut = (1.0 - smoothstep(0.06, 0.24, r)) * (0.45 + 0.55 * n(vec2(s * 0.35, u * 2.0)));
  // 路中间的土比两边略亮、两道车辙之间夹一溜浅色
  // 路肩：路边往外一溜砾石，内沿被噪声啃得断断续续，外沿淡出
  float ragged = (n(vec2(s * 0.22, u * 0.6)) - 0.5) * 1.6;
  float edge = smoothstep(vHalf - 1.1 + ragged, vHalf + 0.3 + ragged, au) * (1.0 - smoothstep(vHalf + uShoulder * 0.45, vHalf + uShoulder, au));
  float grit = 0.55 + 0.45 * n(vec2(s * 1.3, u * 1.3)) * n(vec2(s * 4.1, u * 4.3) + 7.0);
  // 整条路面再压一层灰褐（概念图的土路是压实的灰褐土，不是亮黄的沙），中间被车轮磨得略浅
  float bed = (1.0 - smoothstep(vHalf - 0.6, vHalf + 0.6, au)) * (0.16 + 0.08 * n(vec2(s * 0.5, u * 0.8))) * (1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.7, au)));
  float dark = max(max(rut * 0.48, edge * 0.55 * grit), bed);
  dark *= 1.0 - smoothstep(110.0, 170.0, distance(cameraPosition, vWorld));
  gl_FragColor = vec4(mix(vec3(1.0), uTint, dark), 1.0);
}`;

/** 一点到一串折线的最近距离 */
function roadDistance(x: number, z: number, roads: readonly ScatterRoad[]): number {
  let best = Infinity;
  for (const road of roads) for (let k = 0; k < road.pts.length - 1; k++) {
    const [ax, az] = road.pts[k], [bx, bz] = road.pts[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - road.half);
  }
  return best;
}

export class GroundScatter implements DesertPart {
  readonly group = new THREE.Group();
  /** 枯草丛数、碎石块数 */
  readonly counts = { grass: 0, pebbles: 0 };
  private readonly uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) } };
  private readonly owned: { dispose(): void }[] = [];

  constructor(surface: ScatterSurface, o: GroundScatterOptions) {
    this.group.name = 'DesertGroundScatter';
    const wl = Math.hypot(o.wind[0], o.wind[1]) || 1;
    this.uniforms.uWind.value.set(o.wind[0] / wl, o.wind[1] / wl);
    const r = rng(o.seed ?? 2711), thin = o.low ? 0.55 : 1;
    const [x0, z0, x1, z1] = o.bounds;
    const shoulder = o.shoulder ?? { width: 0, grass: 0, pebbles: 0 };
    type Inst = { x: number; y: number; z: number; s: number; yaw: number; tilt: number; c: Rgb };
    const tiles = new Map<string, { grass: Inst[]; pebbles: Inst[] }>();
    const tileOf = (x: number, z: number) => {
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      let t = tiles.get(key);
      if (!t) tiles.set(key, t = { grass: [], pebbles: [] });
      return t;
    };
    const calmAt = (x: number, z: number): number => (o.calm ?? []).some(c => Math.hypot(x - c.x, z - c.z) < c.r) ? 0.5 : 1;
    const slopeOk = (x: number, z: number, h: number): boolean => {
      const dx = surface.height(x + 0.7, z) - h, dz = surface.height(x, z + 0.7) - h;
      return Math.hypot(dx, dz) / 0.7 < 0.55;  // ≈ 29°
    };
    const [root, tip] = o.grassColor ?? [[0.52, 0.4, 0.26], [0.88, 0.69, 0.42]];
    const stones = o.pebbleColors ?? [[0.66, 0.59, 0.51], [0.73, 0.63, 0.5], [0.58, 0.51, 0.45], [0.76, 0.58, 0.42], [0.5, 0.44, 0.39]];
    // 抖动网格：每格按密度掷骰子（1 m 一格放碎石，1.4 m 一格放草）
    const place = (cell: number, density: (kind: string, road: number) => number, out: 'grass' | 'pebbles'): void => {
      for (let z = z0; z < z1; z += cell) for (let x = x0; x < x1; x += cell) {
        const px = x + r() * cell, pz = z + r() * cell;
        const kind = surface.kind(px, pz);
        if (!kind) continue;
        const road = o.roads.length ? roadDistance(px, pz, o.roads) : Infinity;
        const p = density(kind, road) * cell * cell * thin * calmAt(px, pz);
        if (p <= 0 || r() > p) continue;
        const y = surface.height(px, pz);
        if (!Number.isFinite(y) || !slopeOk(px, pz, y)) continue;
        if (out === 'grass') {
          const t = r();
          const c: Rgb = [root[0] + (tip[0] - root[0]) * t * 0.3, root[1] + (tip[1] - root[1]) * t * 0.3, root[2] + (tip[2] - root[2]) * t * 0.3];
          // 实例色 = 梢色的 0.85–1.1（几何里已经带了根暗梢亮）
          const k = 0.85 + r() * 0.25;
          tileOf(px, pz).grass.push({ x: px, y: y - 0.03, z: pz, s: 0.75 + r() * 0.7, yaw: r() * Math.PI * 2, tilt: 0, c: [tip[0] * k * 0.92 + c[0] * 0.08, tip[1] * k * 0.92 + c[1] * 0.08, tip[2] * k * 0.92 + c[2] * 0.08] });
        } else {
          const big = r() < 0.04;
          const s = big ? 0.24 + r() * 0.16 : 0.06 + r() * r() * 0.18;
          tileOf(px, pz).pebbles.push({ x: px, y: y - s * 0.18, z: pz, s, yaw: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.5, c: stones[Math.floor(r() * stones.length)] });
        }
      }
    };
    const inShoulder = (road: number): boolean => road > -0.6 && road < shoulder.width;
    place(1.4, (kind, road) => (o.grass?.[kind] ?? 0) + (inShoulder(road) ? shoulder.grass : 0) * (kind === 'rock' ? 0 : 1), 'grass');
    place(1, (kind, road) => (o.pebbles?.[kind] ?? 0) + (inShoulder(road) ? shoulder.pebbles : 0), 'pebbles');

    const tuft = tuftGeometry(), pebble = pebbleGeometry(5);
    const grassMat = scatterMaterial(this.uniforms, [55, 75], true), pebbleMat = scatterMaterial(this.uniforms, [70, 92], false);
    this.owned.push(tuft, pebble, grassMat, pebbleMat);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const build = (list: Inst[], geo: THREE.BufferGeometry, mat: THREE.Material, name: string, flat = 1): void => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        e.set(it.tilt, it.yaw, it.tilt * 0.6);
        q.setFromEuler(e);
        m4.compose(v.set(it.x, it.y, it.z), q, sc.set(it.s, it.s * flat, it.s));
        mesh.setMatrixAt(i, m4);
        col.setRGB(it.c[0], it.c[1], it.c[2], THREE.SRGBColorSpace);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = name;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.owned.push({ dispose: () => mesh.dispose() });
    };
    for (const [key, t] of tiles) {
      build(t.grass, tuft, grassMat, `DesertGroundScatter.grass ${key}`);
      build(t.pebbles, pebble, pebbleMat, `DesertGroundScatter.pebbles ${key}`);
      this.counts.grass += t.grass.length;
      this.counts.pebbles += t.pebbles.length;
    }

    if (o.ruts !== false && o.roads.length) this.buildRuts(surface, o);
  }

  /** 每条路一条贴地带：1.5 m 一节，横向 13 个点（路面 + 两边路肩），乘法混合 */
  private buildRuts(surface: ScatterSurface, o: GroundScatterOptions): void {
    const shoulder = o.shoulder?.width ?? 2.5;
    const pos: number[] = [], road: number[] = [], half: number[] = [], idx: number[] = [];
    const ACROSS = 13;
    for (const rd of o.roads) {
      // 折线按 1.5 m 重采样，记沿路距离
      const pts: { x: number; z: number; s: number; nx: number; nz: number }[] = [];
      let s = 0;
      for (let k = 0; k < rd.pts.length - 1; k++) {
        const [ax, az] = rd.pts[k], [bx, bz] = rd.pts[k + 1], len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        const nx = -(bz - az) / len, nz = (bx - ax) / len, steps = Math.max(1, Math.round(len / 1.5));
        for (let i = 0; i < steps + (k === rd.pts.length - 2 ? 1 : 0); i++) {
          const t = i / steps;
          pts.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + len * t, nx, nz });
        }
        s += len;
      }
      if (pts.length < 2) continue;
      const w = rd.half + shoulder, base = pos.length / 3;
      for (const p of pts) for (let c = 0; c < ACROSS; c++) {
        const u = (c / (ACROSS - 1) * 2 - 1) * w, x = p.x + p.nx * u, z = p.z + p.nz * u;
        const y = surface.height(x, z);
        pos.push(x, (Number.isFinite(y) ? y : 0) + 0.05, z);
        road.push(u, p.s);
        half.push(rd.half);
      }
      for (let i = 0; i < pts.length - 1; i++) for (let c = 0; c < ACROSS - 1; c++) {
        // 绕向：横向 u 朝路的左法线增大、b 沿路往前——(a, a+1, b) 才是朝上的面（反过来整条带背面朝上被剔掉）
        const a = base + i * ACROSS + c, b = a + ACROSS;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 2));
    g.setAttribute('aHalf', new THREE.Float32BufferAttribute(half, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const tint = o.rutTint ?? [0.6, 0.53, 0.46];
    const m = new THREE.ShaderMaterial({
      vertexShader: RUT_VERTEX, fragmentShader: RUT_FRAGMENT,
      uniforms: { uTint: { value: new THREE.Vector3(...tint) }, uShoulder: { value: shoulder } },
      transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'DesertGroundScatter.ruts';
    mesh.renderOrder = -10;
    this.group.add(mesh);
    this.owned.push(g, m);
  }

  update(_dt: number, t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.owned) d.dispose();
  }
}
