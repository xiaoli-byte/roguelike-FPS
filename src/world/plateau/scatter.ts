/**
 * 散布（GPU 实例化）。
 * 草与野花：地图有 600 × 500 m，全铺会有几十万丛，所以按 32 m 区块跟着镜头流式生成（半径约 110 m），
 * 区块内容由区块坐标做种子，来回走看到的是同一片草。
 * 高山杜鹃、碎石：数量有限，全图一次生成。建筑占地内都不放。
 */
import * as THREE from 'three';
import { patchMaterial } from './materials';
import { fbm, smoothstep, type Terrain } from './terrain';

type Rand = () => number;

function rng(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把每个三角形再反向复制一份：薄片两面都朝上受光，不用 DoubleSide（它会把背面法线翻成朝下） */
function twoSided(pos: number[], col: number[], nrm: number[]): void {
  const n = pos.length / 9;
  for (let t = 0; t < n; t++) {
    for (const v of [0, 2, 1]) {
      const k = t * 3 + v;
      pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
      nrm.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
    }
  }
}

function sheet(pos: number[], col: number[], nrm: number[]): THREE.BufferGeometry {
  twoSided(pos, col, nrm);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** 一簇草：5 片细叶，根部暗、叶尖亮；法线朝上，光照和地面一致 */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const r = rng(3);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, lean = 0.15 + r() * 0.35, w = 0.04 + r() * 0.035, h = 0.6 + r() * 0.4;
    const ox = Math.cos(a) * r() * 0.12, oz = Math.sin(a) * r() * 0.12;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.15, 1.15, 1.0);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  return sheet(pos, col, nrm);
}

/** 一小簇花：三朵花头，每朵五片向外斜开的花瓣（不画茎：实例颜色会把茎也染成花色） */
function flowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const heads: [number, number, number][] = [[0, 0.24, 0], [0.12, 0.17, 0.06], [-0.08, 0.2, -0.1]];
  for (const [hx, hy, hz] of heads) {
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * Math.PI * 2, a1 = a0 + 1.0;
      pos.push(hx, hy, hz,
        hx + Math.cos(a0) * 0.085, hy + 0.05, hz + Math.sin(a0) * 0.085,
        hx + Math.cos(a1) * 0.085, hy + 0.05, hz + Math.sin(a1) * 0.085);
      col.push(1.3, 1.25, 1.0, 1, 1, 1, 1, 1, 1);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  return sheet(pos, col, nrm);
}

function blobGeometry(detail: number, seed: number, squash: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + (Math.sin(v.x * 3.3 + seed) * Math.cos(v.z * 2.9 - seed) + Math.sin(v.y * 4.1 + seed)) * 0.13;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * squash, v.z);
  }
  g.translate(0, squash * 0.6, 0);
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.computeVertexNormals();
  ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count * 3).fill(1), 3));
  return ng;
}

interface Inst { x: number; z: number; y: number; sc: number; rot: number; col: THREE.Color }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function fillInstances(mesh: THREE.InstancedMesh, list: Inst[], scaleY = 1, squashXZ = 1): void {
  list.forEach((o, n) => {
    _q.setFromAxisAngle(_up, o.rot);
    _s.set(o.sc * squashXZ, o.sc * scaleY, o.sc * squashXZ);
    _p.set(o.x, o.y, o.z);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(n, _m);
    mesh.setColorAt(n, o.col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

const FLOWER_COLS = ['#ec7fb5', '#a274d8', '#f2cf3a', '#f6f3ea', '#4a7fe0', '#e25b7a'].map(h => new THREE.Color(h));

// ───────────────────────────── 流式草地 ─────────────────────────────

interface Chunk { grass: THREE.InstancedMesh; flowers: THREE.InstancedMesh; n: number; ng: number; nf: number; cx: number; cz: number }

/** 打乱实例顺序：远处只画前一部分实例（mesh.count）时，抽稀是均匀的，不会切掉一块 */
function shuffle<T>(list: T[], r: Rand): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

export class GrassField {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly tuft = tuftGeometry();
  private readonly flower = flowerGeometry();
  private readonly grassMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { sway: 0.28 });
  private readonly flowerMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { sway: 0.5 });
  instances = 0;

  constructor(
    private readonly terrain: Terrain,
    private readonly occupied: (x: number, z: number) => boolean,
    private readonly size = 32,
    /** 流式半径；画质设置会改它 */
    public radius = 112,
  ) {
    this.group.name = 'grass-field';
  }

  get count(): number { return this.chunks.size; }

  /** 每帧调用：补齐镜头周围缺的区块（每帧最多建 4 块，近的先建），拆掉远的；远处的区块只画一部分实例 */
  update(cam: THREE.Vector3): void {
    const S = this.size, R = this.radius;
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      const k = d < 45 ? 1 : d < 75 ? 0.55 : 0.3;
      c.grass.count = Math.round(c.ng * k);
      c.flowers.count = Math.round(c.nf * (d < 60 ? 1 : 0.4));
    }
    const ci = Math.floor(cam.x / S), cj = Math.floor(cam.z / S), span = Math.ceil(R / S) + 1;
    const want: { key: string; i: number; j: number; d: number }[] = [];
    for (let j = cj - span; j <= cj + span; j++) for (let i = ci - span; i <= ci + span; i++) {
      const d = Math.hypot((i + 0.5) * S - cam.x, (j + 0.5) * S - cam.z);
      if (d < R) want.push({ key: `${i},${j}`, i, j, d });
    }
    want.sort((a, b) => a.d - b.d);
    let built = 0;
    for (const w of want) {
      if (this.chunks.has(w.key)) continue;
      if (built++ >= 4) break;
      this.chunks.set(w.key, this.build(w.i, w.j));
    }
    for (const [key, c] of this.chunks) {
      const [i, j] = key.split(',').map(Number);
      if (Math.hypot((i + 0.5) * S - cam.x, (j + 0.5) * S - cam.z) > R + 40) {
        this.group.remove(c.grass, c.flowers);
        c.grass.dispose(); c.flowers.dispose();
        this.instances -= c.n;
        this.chunks.delete(key);
      }
    }
  }

  private build(ci: number, cj: number): Chunk {
    const T = this.terrain, S = this.size;
    const r = rng((ci * 73856093) ^ (cj * 19349663) ^ 20261018);
    const grass: Inst[] = [], flowers: Inst[] = [];
    const i0 = Math.max(0, Math.floor((ci * S - T.minX) / T.step)), i1 = Math.min(T.nx - 2, Math.floor(((ci + 1) * S - T.minX) / T.step) - 1);
    const j0 = Math.max(0, Math.floor((cj * S - T.minZ) / T.step)), j1 = Math.min(T.nz - 2, Math.floor(((cj + 1) * S - T.minZ) / T.step) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * T.nx + i;
      const dOut = T.basin[k];
      if (dOut > 45) continue;
      const g = T.grass[k];
      const density = dOut <= 0 ? 1.0 : 1.0 * (1 - smoothstep(0, 40, dOut)) + 0.05;
      const tries = g * density;
      for (let t = 0; t < 2; t++) {
        if (r() > tries - t) break;
        const x = T.minX + (i + r()) * T.step, z = T.minZ + (j + r()) * T.step;
        if (this.occupied(x, z)) continue;
        const tc = new THREE.Color(T.colors[k * 3], T.colors[k * 3 + 1], T.colors[k * 3 + 2]);
        grass.push({ x, z, y: T.heightAt(x, z), sc: 0.35 + r() * 0.35, rot: r() * 6.28, col: tc.multiplyScalar(1.05 + r() * 0.2) });
      }
      const patch = fbm(i * 0.08 + 7, j * 0.08 - 3, 2, 31);
      if (g > 0.5 && dOut < 20 && r() < smoothstep(0.58, 0.8, patch) * 0.6) {
        const kind = Math.floor(fbm(i * 0.03, j * 0.03, 2, 32) * 6.9) % FLOWER_COLS.length;
        for (let f = 0; f < 3; f++) {
          const x = T.minX + (i + r()) * T.step, z = T.minZ + (j + r()) * T.step;
          if (this.occupied(x, z)) continue;
          flowers.push({ x, z, y: T.heightAt(x, z), sc: 0.55 + r() * 0.4, rot: r() * 6.28, col: FLOWER_COLS[(kind + (r() < 0.2 ? 1 : 0)) % FLOWER_COLS.length] });
        }
      }
    }
    shuffle(grass, r); shuffle(flowers, r);
    const gm = new THREE.InstancedMesh(this.tuft, this.grassMat, Math.max(1, grass.length));
    gm.count = grass.length;
    fillInstances(gm, grass);
    gm.receiveShadow = true;
    const fm = new THREE.InstancedMesh(this.flower, this.flowerMat, Math.max(1, flowers.length));
    fm.count = flowers.length;
    fillInstances(fm, flowers);
    fm.receiveShadow = true;
    this.group.add(gm, fm);
    this.instances += grass.length + flowers.length;
    return { grass: gm, flowers: fm, n: grass.length + flowers.length, ng: grass.length, nf: flowers.length, cx: (ci + 0.5) * S, cz: (cj + 0.5) * S };
  }
}

// ───────────────────────────── 全图散布：杜鹃、碎石 ─────────────────────────────

export interface ScatterStats { bushes: number; rocks: number }

export function buildStaticScatter(terrain: Terrain, occupied: (x: number, z: number) => boolean): { group: THREE.Group; stats: ScatterStats } {
  const group = new THREE.Group();
  group.name = 'scatter-static';
  const r = rng(20261019);
  const c = new THREE.Color();
  const bushes: Inst[] = [];
  const rocks: (Inst & { v: number })[] = [];
  const { nx, nz, minX, minZ, step } = terrain;
  for (let j = 0; j < nz - 1; j += 2) for (let i = 0; i < nx - 1; i += 2) {
    const k = j * nx + i;
    const dOut = terrain.basin[k];
    if (dOut > 70) continue;
    const g = terrain.grass[k];
    const x0 = minX + i * step, z0 = minZ + j * step;
    const slope = terrain.slopeAt(x0, z0);
    // 高山杜鹃：盆地边缘的山脚和丘坡上成丛长
    const bushP = (dOut > -25 && dOut < 30 ? 0.05 : 0.008) * smoothstep(0.1, 0.35, slope + 0.15) * (slope < 0.65 ? 1 : 0);
    if (g > 0.3 && r() < bushP) {
      const x = x0 + r() * 2, z = z0 + r() * 2;
      if (!occupied(x, z)) {
        const bloom = r() < 0.22;
        c.set(bloom ? '#a8587a' : '#3b6431').multiplyScalar(0.8 + r() * 0.3);
        const sc = 0.35 + r() * 0.5;
        bushes.push({ x, z, y: terrain.heightAt(x, z) - 0.1, sc, rot: r() * 6.28, col: c.clone() });
        for (let b = 0; b < 2; b++) {
          const a = r() * 6.28, d = sc * (0.7 + r() * 0.4);
          const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
          bushes.push({ x: bx, z: bz, y: terrain.heightAt(bx, bz) - 0.12, sc: sc * (0.6 + r() * 0.3), rot: r() * 6.28, col: c.clone().multiplyScalar(0.9 + r() * 0.2) });
        }
      }
    }
    // 碎石：陡坡、环山、偶尔草里
    const rockP = (slope > 0.6 ? 0.04 : 0.008) + (dOut > 8 ? 0.012 : 0);
    if (r() < rockP) {
      const x = x0 + r() * 2, z = z0 + r() * 2;
      if (!occupied(x, z) && terrain.waterDepthAt(x, z) < 0.2) {
        c.set('#9a958b').multiplyScalar(0.85 + r() * 0.3);
        rocks.push({ x, z, y: terrain.heightAt(x, z) - 0.1, sc: 0.15 + r() * r() * 0.7, rot: r() * 6.28, col: c.clone(), v: Math.floor(r() * 3) });
      }
    }
  }
  // 杜鹃 3000 多丛：用 20 面的低模、不投影（每丛 80 面又投影时占了全场三角形的近三成）
  const bushMesh = new THREE.InstancedMesh(blobGeometry(0, 2, 0.6), patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { rim: 0.15 }), bushes.length);
  fillInstances(bushMesh, bushes, 0.9, 1.1);
  bushMesh.castShadow = false; bushMesh.receiveShadow = true;
  group.add(bushMesh);
  const rockMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  for (let v = 0; v < 3; v++) {
    const list = rocks.filter(o => o.v === v);
    const mesh = new THREE.InstancedMesh(blobGeometry(0, v * 3.1 + 1, 0.55 + v * 0.1), rockMat, list.length);
    fillInstances(mesh, list, 1, 1.2);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, stats: { bushes: bushes.length, rocks: rocks.length } };
}
