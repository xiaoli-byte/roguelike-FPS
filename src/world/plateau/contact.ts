/**
 * 物件和地面的交界（docs/art/reference-tingyuyuan.md 第四节第 6 项）：石头、柱子、房子「插在地上」那条硬边。
 *
 * 1. 占地距离场：把碰撞世界里落在地上的物件（方盒 / 圆柱，离地太高的桥面、栈道不算）按 0.5 m 一格栅格化，
 *    两遍倒角距离变换，存成一张 R8 贴图（0..MAX_DIST 米），整张图一张。地面着色器（patchMaterial 的 contact 选项）
 *    据此在物件脚下加一圈湿暗带、外面一圈苔藓 / 砂砾，用噪声打散，不是一个死圆。
 * 2. 沿每个物件的地面线撒一圈实例化的小碎石（一次绘制），把交界线盖住。
 *
 * 只在建场景时算一次（静态物件）；首领战里临时出现的东西不管。
 */
import * as THREE from 'three';
import type { HeightGrid } from './grid';
import { WORLD_UNIFORMS, patchMaterial } from './materials';
import type { Collider, CollisionWorld } from './walker';

/** 距离场的分辨率（米 / 格）和记录的最远距离（米） */
const RES = 0.5;
export const CONTACT_MAX_DIST = 4;

function footprint(c: Collider, x: number, z: number): number {
  if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) - c.r;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  const qx = Math.abs(lx) - c.hx, qz = Math.abs(lz) - c.hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** 落在地上的物件：没关掉、底面贴着地（离地不超过 0.6 m）、不是平得像地板的薄片 */
function grounded(c: Collider, terrain: HeightGrid): boolean {
  if (c.off) return false;
  const g = terrain.heightAt(c.x, c.z);
  if (c.y0 > g + 0.6) return false;
  return c.y1 - Math.max(c.y0, g) > 0.25;
}

export interface ContactField {
  /** 撒在交界线上的碎石（已经加进场景） */
  pebbles: THREE.InstancedMesh | null;
  /** 参与的物件数 */
  count: number;
}

export interface ContactOptions {
  /** 碎石的颜色（缺省取地表岩层的平均色，见 WORLD_UNIFORMS.uLayerCol） */
  pebbleColor?: THREE.ColorRepresentation;
  /** 碎石上限 */
  maxPebbles?: number;
}

export function buildContactField(scene: THREE.Scene, world: CollisionWorld, terrain: HeightGrid, opts: ContactOptions = {}): ContactField {
  const cols = world.list.filter(c => grounded(c, terrain));
  // ── 1. 距离场
  const minX = terrain.minX, minZ = terrain.minZ;
  const W = Math.ceil((terrain.maxX - minX) / RES) + 1, H = Math.ceil((terrain.maxZ - minZ) / RES) + 1;
  const BIG = 1e6;
  const d = new Float32Array(W * H).fill(BIG);
  for (const c of cols) {
    const ext = (c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.r) + RES;
    const i0 = Math.max(0, Math.floor((c.x - ext - minX) / RES)), i1 = Math.min(W - 1, Math.ceil((c.x + ext - minX) / RES));
    const j0 = Math.max(0, Math.floor((c.z - ext - minZ) / RES)), j1 = Math.min(H - 1, Math.ceil((c.z + ext - minZ) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const f = footprint(c, minX + i * RES, minZ + j * RES);
      const k = j * W + i;
      if (f < d[k]) d[k] = Math.max(0, f);
    }
  }
  // 两遍倒角距离（1、√2）：格子里已经有精确值的（物件边上一格）保留，往外传
  const D1 = RES, D2 = RES * Math.SQRT2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + D1);
    if (j > 0) {
      v = Math.min(v, d[k - W] + D1);
      if (i > 0) v = Math.min(v, d[k - W - 1] + D2);
      if (i < W - 1) v = Math.min(v, d[k - W + 1] + D2);
    }
    d[k] = v;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let v = d[k];
    if (i < W - 1) v = Math.min(v, d[k + 1] + D1);
    if (j < H - 1) {
      v = Math.min(v, d[k + W] + D1);
      if (i < W - 1) v = Math.min(v, d[k + W + 1] + D2);
      if (i > 0) v = Math.min(v, d[k + W - 1] + D2);
    }
    d[k] = v;
  }
  const bytes = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) bytes[k] = Math.round(Math.min(1, d[k] / CONTACT_MAX_DIST) * 255);
  const tex = new THREE.DataTexture(bytes, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  WORLD_UNIFORMS.uContactTex.value = tex;
  // 格子中心对齐：uv = (xz − min + RES/2) / (尺寸 × RES)
  (WORLD_UNIFORMS.uContactXf.value as THREE.Vector4).set(minX - RES / 2, minZ - RES / 2, 1 / (W * RES), 1 / (H * RES));

  // ── 2. 交界线上的碎石
  const max = opts.maxPebbles ?? 6000;
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const spots: [number, number, number][] = [];
  const add = (x: number, z: number, size: number): void => {
    if (spots.length >= max) return;
    if (terrain.waterDepthAt(x, z) > 0.03) return;
    if (world.list.some(c => !c.off && c.y0 < terrain.heightAt(x, z) + 0.6 && Math.abs(c.x - x) < 30 && Math.abs(c.z - z) < 30 && footprint(c, x, z) < -0.02)) return;
    spots.push([x, z, size]);
  };
  for (const c of cols) {
    if (spots.length >= max) break;
    const step = 0.55;
    const ring = (px: number, pz: number, nx: number, nz: number): void => {
      // 成簇：按位置的低频起伏决定这一段撒几颗（有的地方一堆、有的地方空着，不是一排）
      const dens = 0.5 + 0.5 * Math.sin(px * 0.73 + pz * 1.31) * Math.cos(px * 0.37 - pz * 0.91);
      const n = dens < 0.3 ? 0 : dens < 0.62 ? 1 : 2 + (rnd() < 0.5 ? 1 : 0);
      for (let q = 0; q < n; q++) {
        // 贴着边往外 0–0.8 m，大的靠里、小的散在外面；小石子多、大块少
        const out = Math.pow(rnd(), 1.6) * 0.8;
        const size = 0.04 + Math.pow(rnd(), 3) * 0.26 * (1 - out * 0.7);
        add(px + nx * (out + size * 0.5) + (rnd() - 0.5) * 0.25, pz + nz * (out + size * 0.5) + (rnd() - 0.5) * 0.25, size);
      }
    };
    if (c.kind === 'cyl') {
      const n = Math.max(6, Math.round((Math.PI * 2 * c.r) / step));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
        ring(c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r, Math.cos(a), Math.sin(a));
      }
    } else {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      // 局部 → 世界：x = cx + lx·cos + lz·sin，z = cz − lx·sin + lz·cos（footprint 的逆）
      const toW = (lx: number, lz: number): [number, number] => [c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs];
      const edges: [number, number, number, number, number][] = [
        [-c.hx, c.hz, c.hx, c.hz, 0], [c.hx, -c.hz, c.hx, c.hz, 1], [-c.hx, -c.hz, c.hx, -c.hz, 2], [-c.hx, -c.hz, -c.hx, c.hz, 3],
      ];
      for (const [ax, az, bx, bz, e] of edges) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / step));
        const [nlx, nlz] = e === 0 ? [0, 1] : e === 1 ? [1, 0] : e === 2 ? [0, -1] : [-1, 0];
        const [nwx, nwz] = toW(nlx, nlz), [ox, oz] = toW(0, 0);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const [px, pz] = toW(ax + (bx - ax) * t, az + (bz - az) * t);
          ring(px, pz, nwx - ox, nwz - oz);
        }
      }
    }
  }
  let pebbles: THREE.InstancedMesh | null = null;
  if (spots.length && WORLD_UNIFORMS.uContactOn.value !== 0) {
    const base = new THREE.Color(opts.pebbleColor ?? (() => {
      const v = (WORLD_UNIFORMS.uLayerCol.value as THREE.Vector3[])[1];
      return new THREE.Color(v.x, v.y, v.z);
    })());
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }));
    pebbles = new THREE.InstancedMesh(geo, mat, spots.length);
    pebbles.name = 'contact-pebbles';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    spots.forEach(([x, z, size], i) => {
      e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
      q.setFromEuler(e);
      s.set(size * (0.8 + rnd() * 0.5), size * (0.45 + rnd() * 0.35), size * (0.8 + rnd() * 0.5));
      p.set(x, terrain.heightAt(x, z) + s.y * 0.25, z);
      pebbles!.setMatrixAt(i, m.compose(p, q, s));
      c.copy(base).multiplyScalar(0.62 + rnd() * 0.5);
      pebbles!.setColorAt(i, c);
    });
    pebbles.instanceMatrix.needsUpdate = true;
    if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
    pebbles.receiveShadow = true;
    pebbles.castShadow = false;
    pebbles.frustumCulled = false;
    scene.add(pebbles);
  }
  return { pebbles, count: cols.length };
}
