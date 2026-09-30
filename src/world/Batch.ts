/**
 * 静态几何合批：同材质的所有零件合并成一个网格（BufferGeometryUtils.mergeGeometries）。
 * 每个零件在合并前烘焙顶点色：基色 × 逐面明暗抖动 × 贴地假 AO，低多边形风格。
 * stone / wood 材质按世界坐标重算 UV，让砖石纹理在合并后的墙面上连续平铺。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type MatKey = 'stone' | 'rough' | 'wood' | 'lacquer' | 'metal' | 'gloss' | 'cloth' | 'glow' | 'far';

/** 按世界坐标重算 UV 的材质与其平铺尺寸（米 / 一张纹理） */
const WORLD_UV: Partial<Record<MatKey, number>> = { stone: 2, wood: 1.5 };

// ───────────────────────────── 模板几何（模块级缓存，永不释放） ─────────────────────────────

const templates = new Map<string, THREE.BufferGeometry>();

function tpl(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = templates.get(key);
  if (!g) {
    let geo = make();
    if (geo.index) {
      const ni = geo.toNonIndexed();
      geo.dispose();
      geo = ni;
    }
    geo.clearGroups();
    if (!geo.getAttribute('uv')) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.getAttribute('position').count) * 2), 2));
    }
    templates.set(key, geo);
    g = geo;
  }
  return g;
}

/** 常用模板：box 以中心为原点；cyl / cone 底面在 y=0 */
export const Tpl = {
  box: (): THREE.BufferGeometry => tpl('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg: number, top = 1): THREE.BufferGeometry =>
    tpl(`cyl${seg}_${top}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1).translate(0, 0.5, 0)),
  cone: (seg: number): THREE.BufferGeometry => tpl(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg, 1).translate(0, 0.5, 0)),
  /** 轴对齐四棱锥：底面为 [-1,1]² 的正方形、底在 y=0、高 1（非等比缩放后仍是矩形底） */
  pyramid: (): THREE.BufferGeometry => tpl('pyramid', () => new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).scale(Math.SQRT2, 1, Math.SQRT2).translate(0, 0.5, 0)),
  sphere: (w: number, h: number): THREE.BufferGeometry => tpl(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** 下半球被压平的土丘 */
  mound: (): THREE.BufferGeometry => tpl('mound', () => new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
  octa: (): THREE.BufferGeometry => tpl('octa', () => new THREE.OctahedronGeometry(1, 0)),
  dodeca: (): THREE.BufferGeometry => tpl('dodeca', () => new THREE.DodecahedronGeometry(1, 0)),
  plane: (): THREE.BufferGeometry => tpl('plane', () => new THREE.PlaneGeometry(1, 1)),
  /** 立在 XY 平面、朝 +Z 的圆片 */
  disc: (seg: number): THREE.BufferGeometry => tpl(`disc${seg}`, () => new THREE.CircleGeometry(1, seg)),
};

// ───────────────────────────── 合批器 ─────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _UP = new THREE.Vector3(0, 1, 0);

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export class GeoBatch {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private frame = new THREE.Matrix4();
  private framed = false;
  /** 假 AO：aoBase 以上 aoHeight 米内由 aoMin 渐亮到 1 */
  aoBase = 0;
  aoHeight = 1.3;
  aoMin = 0.62;
  /** 明暗抖动幅度 */
  jitter = 0.07;

  constructor(private readonly rand: () => number) {}

  /** 设置局部坐标系（之后的 add 以此为父变换）；同时把 AO 基准设为 y */
  setFrame(x: number, y: number, z: number, yaw = 0, s = 1): this {
    _q.setFromAxisAngle(_UP, yaw);
    this.frame.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.framed = true;
    this.aoBase = y;
    return this;
  }

  clearFrame(): this {
    this.frame.identity();
    this.framed = false;
    this.aoBase = 0;
    return this;
  }

  /** 模板 + 局部位置 / 缩放 / 欧拉旋转（YXZ） */
  add(key: MatKey, geo: THREE.BufferGeometry, px: number, py: number, pz: number, sx: number, sy: number, sz: number, color: number, rx = 0, ry = 0, rz = 0): void {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
    if (this.framed) _m.premultiply(this.frame);
    this.push(key, geo, _m, color);
  }

  /** 中心 + 尺寸的盒子 */
  box(key: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, ry = 0, rx = 0, rz = 0): void {
    this.add(key, Tpl.box(), cx, cy, cz, sx, sy, sz, color, rx, ry, rz);
  }

  /** 最小 / 最大角点的盒子 */
  boxMM(key: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    this.add(key, Tpl.box(), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color);
  }

  /** 棱柱 / 圆台：底面中心 (cx, y0, cz)，半径 r，高 h；top 为顶面半径比例 */
  cyl(key: MatKey, seg: number, cx: number, y0: number, cz: number, r: number, h: number, color: number, top = 1, ry = 0): void {
    this.add(key, Tpl.cyl(seg, top), cx, y0, cz, r, h, r, color, 0, ry, 0);
  }

  cone(key: MatKey, seg: number, cx: number, y0: number, cz: number, r: number, h: number, color: number, ry = 0, rx = 0, rz = 0): void {
    this.add(key, Tpl.cone(seg), cx, y0, cz, r, h, r, color, rx, ry, rz);
  }

  sphere(key: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, w = 7, h = 5): void {
    this.add(key, Tpl.sphere(w, h), cx, cy, cz, sx, sy, sz, color);
  }

  /** 从 (x0,y0,z0) 到 (x1,y1,z1) 的细长方条（绳索、斜撑） */
  beam(key: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, thick: number, color: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    _p.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_UP, _p);
    _m.compose(_s.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _p.set(thick, len, thick));
    if (this.framed) _m.premultiply(this.frame);
    this.push(key, Tpl.box(), _m, color);
  }

  private push(key: MatKey, template: THREE.BufferGeometry, m: THREE.Matrix4, color: number): void {
    const g = template.clone();
    g.applyMatrix4(m);
    const pos = g.getAttribute('position').array as Float32Array;
    const n = pos.length / 3;
    const col = new Float32Array(n * 3);
    _c.setHex(color);
    const objF = 1 + (this.rand() - 0.5) * this.jitter * 1.4;
    const uvTile = WORLD_UV[key];
    const uv = uvTile ? (g.getAttribute('uv').array as Float32Array) : null;
    const salt = this.rand() * 17.0;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = t * 3;
      const i1 = i0 + 3;
      const i2 = i0 + 6;
      // 面法线（由位置求得，同一平面的两个三角形一致）
      const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
      const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const h = Math.sin(Math.round(nx * 20) * 12.9898 + Math.round(ny * 20) * 78.233 + Math.round(nz * 20) * 37.719 + salt) * 43758.5453;
      const faceF = (1 + ((h - Math.floor(h)) - 0.5) * 2 * this.jitter) * objF;
      const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
      for (let k = 0; k < 3; k++) {
        const vi = (t + k) * 3;
        const y = pos[vi + 1];
        const ao = this.aoMin + (1 - this.aoMin) * smooth01((y - this.aoBase) / this.aoHeight);
        const f = faceF * ao;
        col[vi] = _c.r * f;
        col[vi + 1] = _c.g * f;
        col[vi + 2] = _c.b * f;
        if (uv && uvTile) {
          const ui = (t + k) * 2;
          const x = pos[vi], z = pos[vi + 2];
          if (any >= anx && any >= anz) {
            uv[ui] = x / uvTile;
            uv[ui + 1] = z / uvTile;
          } else if (anx >= anz) {
            uv[ui] = z / uvTile;
            uv[ui + 1] = y / uvTile;
          } else {
            uv[ui] = x / uvTile;
            uv[ui + 1] = y / uvTile;
          }
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
  }

  /** 合并并生成网格；临时零件几何在合并后释放。返回的几何体由调用者负责释放 */
  build(materials: Record<MatKey, THREE.Material>): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      list.length = 0;
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.name = `arena:${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      const shadow = key !== 'far' && key !== 'glow';
      mesh.castShadow = shadow;
      mesh.receiveShadow = key !== 'far' && key !== 'glow';
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
