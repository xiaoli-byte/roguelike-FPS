/**
 * 程序化白模的拼装工具：按材质分桶收集基本体，统一转成非索引几何、写顶点色与「米制」UV，最后每桶合并成一个网格。
 * 米制 UV：按面法线做平面投影，贴图在所有物件上同样大小（石片不会因物件尺寸被拉伸）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { materials, type MaterialKey } from './materials';

export type ColorLike = THREE.ColorRepresentation;

export interface PartOpts {
  /** 贴图每米重复次数的倒数（默认 2.4 米一张） */
  tile?: number;
  /** 顶点色随机明暗幅度 */
  jitter?: number;
  /** 圆柱类用环绕 UV（u = 弧长） */
  wrapUV?: boolean;
}

export function mat4(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  return m;
}

const tmpColor = new THREE.Color();

export class GeoBuilder {
  private readonly buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
  private seed = 1;
  /** 当前局部坐标系（地标的落点与朝向）；UV 在局部坐标里算，之后才变换到世界 */
  private frame: THREE.Matrix4 | null = null;
  private frameYaw = 0;

  setFrame(x: number, y: number, z: number, yaw: number): this {
    this.frame = mat4(x, y, z, yaw);
    this.frameYaw = yaw;
    return this;
  }

  clearFrame(): this { this.frame = null; this.frameYaw = 0; return this; }

  /** 局部坐标 → 世界坐标 */
  world(lx: number, ly: number, lz: number): THREE.Vector3 {
    const v = new THREE.Vector3(lx, ly, lz);
    return this.frame ? v.applyMatrix4(this.frame) : v;
  }

  get yaw(): number { return this.frameYaw; }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  add(key: MaterialKey, geo: THREE.BufferGeometry, color: ColorLike, m?: THREE.Matrix4, opts: PartOpts = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g === geo) g = geo.clone();
    geo.dispose();
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const n = pos.count;
    const tile = opts.tile ?? 2.4;
    // 米制 UV：按三角形面法线选投影平面
    const uv = new Float32Array(n * 2);
    if (opts.wrapUV && g.getAttribute('uv')) {
      const src = g.getAttribute('uv') as THREE.BufferAttribute;
      const box = new THREE.Box3().setFromBufferAttribute(pos);
      const circ = Math.PI * Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      for (let i = 0; i < n; i++) { uv[i * 2] = src.getX(i) * circ / tile; uv[i * 2 + 1] = pos.getY(i) / tile; }
    } else {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
      for (let f = 0; f < n; f += 3) {
        a.fromBufferAttribute(pos, f); b.fromBufferAttribute(pos, f + 1); c.fromBufferAttribute(pos, f + 2);
        fn.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
        const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let k = 0; k < 3; k++) {
          const i = f + k;
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          let u: number, v: number;
          if (ay >= ax && ay >= az) { u = x; v = z; }
          else if (ax >= az) { u = z; v = y; }
          else { u = x; v = y; }
          uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
        }
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const col = new Float32Array(n * 3);
    tmpColor.set(color);
    const jitter = opts.jitter ?? 0.05;
    for (let f = 0; f < n; f += 3) {
      const k = 1 + (this.rand() - 0.5) * 2 * jitter;
      for (let v = 0; v < 3; v++) {
        col[(f + v) * 3] = tmpColor.r * k; col[(f + v) * 3 + 1] = tmpColor.g * k; col[(f + v) * 3 + 2] = tmpColor.b * k;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // 只保留合并需要的属性
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (this.frame) g.applyMatrix4(this.frame);
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, list = []);
    list.push(g);
    return this;
  }

  /** 以底面中心为原点的方块 */
  box(key: MaterialKey, w: number, h: number, d: number, color: ColorLike, x: number, y: number, z: number, ry = 0, opts?: PartOpts, rx = 0, rz = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(key, g, color, mat4(x, y, z, ry, rx, rz), opts);
  }

  /** 以底面中心为原点的圆柱 / 圆台 */
  cyl(key: MaterialKey, rTop: number, rBot: number, h: number, color: ColorLike, x: number, y: number, z: number, seg = 10, opts?: PartOpts, ry = 0, rx = 0, rz = 0): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
    g.translate(0, h / 2, 0);
    return this.add(key, g, color, mat4(x, y, z, ry, rx, rz), { wrapUV: true, ...opts });
  }

  /** 两点之间的细杆（绳、梁、木杆） */
  rod(key: MaterialKey, a: THREE.Vector3, b: THREE.Vector3, r: number, color: ColorLike, seg = 5): this {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1));
    return this.add(key, g, color, m);
  }

  /** 旋转体：profile 是 [半径, 高度] 列表（自下而上） */
  lathe(key: MaterialKey, profile: [number, number][], color: ColorLike, x: number, y: number, z: number, seg = 16, opts?: PartOpts): this {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    return this.add(key, g, color, mat4(x, y, z), { wrapUV: true, ...opts });
  }

  /** 随机变形的石块（玛尼堆、巨石、碎石） */
  rock(key: MaterialKey, r: number, color: ColorLike, x: number, y: number, z: number, squash = 0.7, seed = 1, detail = 1): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = 1 + (Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 + seed * 1.3) + Math.sin(v.y * 4.3 + seed * 0.7)) * 0.12;
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x, v.y * squash, v.z);
    }
    g.computeVertexNormals();
    g.translate(0, r * squash * 0.75, 0);
    return this.add(key, g, color, mat4(x, y, z, seed * 1.7), { jitter: 0.1 });
  }

  isEmpty(): boolean { return this.buckets.size === 0; }

  build(name: string, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const M = materials();
    for (const [key, list] of this.buckets) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, M[key]);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.name = `${name}.${key}`;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}
