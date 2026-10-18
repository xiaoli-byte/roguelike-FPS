/**
 * 第四章各张图共用的高度网格：1 m 一格的高度场 + 每格的颜色、地表材质权重、长草程度、到可玩区边界的有符号距离。
 * 4-1 的盆地（terrain.ts）和 4-2 的峡谷（world/gorge/terrain.ts）都继承它，
 * 行走、散布、天气、怪物摆放只依赖这里的接口。网格三角化方向固定，heightAt() 与渲染网格逐三角形一致。
 */
import * as THREE from 'three';

export interface GridBounds { minX: number; maxX: number; minZ: number; maxZ: number }

export abstract class HeightGrid {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly step = 1;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  /** 每个顶点：适合长草的程度 0..1 */
  readonly grass: Float32Array;
  /** 每个顶点：到可玩区边界的有符号距离（区内为负；4-1 是盆地轮廓，4-2 是峡谷坡顶） */
  readonly basin: Float32Array;
  readonly colors: Float32Array;
  /** 每个顶点的地表材质权重（草、岩、雪 / 冰、土 / 碎石），着色器按它混合细节贴图 */
  readonly mat: Float32Array;

  constructor(bounds: GridBounds) {
    this.minX = bounds.minX; this.maxX = bounds.maxX; this.minZ = bounds.minZ; this.maxZ = bounds.maxZ;
    this.nx = Math.round((this.maxX - this.minX) / this.step) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / this.step) + 1;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.grass = new Float32Array(n);
    this.basin = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.mat = new Float32Array(n * 4);
  }

  protected idx(i: number, j: number): number { return j * this.nx + i; }
  protected X(i: number): number { return this.minX + i * this.step; }
  protected Z(j: number): number { return this.minZ + j * this.step; }

  /** 水面高度；没有水返回 −∞ */
  abstract waterLevelAt(x: number, z: number): number;

  /** 水深（没有水为 0） */
  waterDepthAt(x: number, z: number): number {
    return Math.max(0, this.waterLevelAt(x, z) - this.heightAt(x, z));
  }

  /** 网格三角形内插（与网格的三角化方向一致） */
  heightAt(x: number, z: number): number {
    const gx = Math.min(this.nx - 1.0001, Math.max(0, (x - this.minX) / this.step));
    const gz = Math.min(this.nz - 1.0001, Math.max(0, (z - this.minZ) / this.step));
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const ha = this.h[this.idx(i, j)], hb = this.h[this.idx(i + 1, j)];
    const hc = this.h[this.idx(i + 1, j + 1)], hd = this.h[this.idx(i, j + 1)];
    return fx >= fz ? ha + (hb - ha) * fx + (hc - hb) * fz : ha + (hc - hd) * fx + (hd - ha) * fz;
  }

  /** 坡度角（弧度），中心差分 */
  slopeAt(x: number, z: number): number {
    const e = 0.75;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(gx, gz));
  }

  /** 一块矩形地基下的最低地形高度（建筑用它落地，避免悬空） */
  footprintMin(x: number, z: number, hx: number, hz: number, yaw: number): number {
    let m = Infinity;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
      const lx = a * hx, lz = b * hz;
      m = Math.min(m, this.heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    return m;
  }

  /**
   * 地形网格切成 tile × tile 米的瓦片（共用顶点属性，只分索引），做视锥剔除；
   * 外圈再加 40 m 的下垂裙边，和外围远景地形接不严时不露缝。
   */
  buildTiles(tile = 96): THREE.BufferGeometry[] {
    const { nx, nz } = this;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      pos[k * 3] = this.X(i); pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = this.Z(j);
    }
    // 法线（与三角化无关的中心差分足够）
    const nrm = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      const gx = (this.h[this.idx(Math.min(nx - 1, i + 1), j)] - this.h[this.idx(Math.max(0, i - 1), j)]) / 2;
      const gz = (this.h[this.idx(i, Math.min(nz - 1, j + 1))] - this.h[this.idx(i, Math.max(0, j - 1))]) / 2;
      const l = Math.hypot(gx, 1, gz);
      nrm[k * 3] = -gx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -gz / l;
    }
    // 裙边顶点
    const ring: number[] = [];
    for (let i = 0; i < nx; i++) ring.push(this.idx(i, 0));
    for (let j = 1; j < nz; j++) ring.push(this.idx(nx - 1, j));
    for (let i = nx - 2; i >= 0; i--) ring.push(this.idx(i, nz - 1));
    for (let j = nz - 2; j > 0; j--) ring.push(this.idx(0, j));
    const base = nx * nz, total = base + ring.length;
    const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3), M = new Float32Array(total * 4);
    P.set(pos); N.set(nrm); C.set(this.colors); M.set(this.mat);
    ring.forEach((v, r) => {
      const o = (base + r) * 3;
      for (let q = 0; q < 3; q++) {
        P[o + q] = pos[v * 3 + q] - (q === 1 ? 40 : 0);
        N[o + q] = nrm[v * 3 + q];
        C[o + q] = this.colors[v * 3 + q] * 0.7;
      }
      for (let q = 0; q < 4; q++) M[(base + r) * 4 + q] = this.mat[v * 4 + q];
    });
    const posAttr = new THREE.BufferAttribute(P, 3), nrmAttr = new THREE.BufferAttribute(N, 3), colAttr = new THREE.BufferAttribute(C, 3);
    const matAttr = new THREE.BufferAttribute(M, 4);
    const out: THREE.BufferGeometry[] = [];
    const make = (index: number[], box: THREE.Box3): void => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr); g.setAttribute('normal', nrmAttr); g.setAttribute('color', colAttr); g.setAttribute('aMat', matAttr);
      g.setIndex(index);
      g.boundingBox = box;
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      out.push(g);
    };
    const tilesX = Math.ceil((nx - 1) / tile), tilesZ = Math.ceil((nz - 1) / tile);
    for (let tz = 0; tz < tilesZ; tz++) for (let tx = 0; tx < tilesX; tx++) {
      const index: number[] = [];
      const box = new THREE.Box3();
      const i0 = tx * tile, i1 = Math.min(nx - 1, i0 + tile), j0 = tz * tile, j1 = Math.min(nz - 1, j0 + tile);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const a = this.idx(i, j), b = this.idx(i + 1, j), cc = this.idx(i + 1, j + 1), d = this.idx(i, j + 1);
        index.push(a, cc, b, a, d, cc);
      }
      let lo = Infinity, hi = -Infinity;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = this.h[this.idx(i, j)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      box.min.set(this.X(i0), lo - 40, this.Z(j0)); box.max.set(this.X(i1), hi, this.Z(j1));
      make(index, box);
    }
    const skirt: number[] = [];
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r], b = ring[(r + 1) % ring.length], cc = base + r, d = base + ((r + 1) % ring.length);
      skirt.push(a, cc, b, b, cc, d);
    }
    make(skirt, new THREE.Box3(new THREE.Vector3(this.minX, -100, this.minZ), new THREE.Vector3(this.maxX, 300, this.maxZ)));
    return out;
  }

  /** 视线检查：沿线段步进，任何一点被地形挡住就算不可见（出了高度图就不再检查） */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return true;
      if (this.heightAt(x, z) > ay + (by - ay) * t) return false;
    }
    return true;
  }
}
