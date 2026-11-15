import * as THREE from 'three';
import type { StaticBox } from './Collision';

export interface UnityTriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  normal: THREE.Vector3;
  depth: number;
}

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const ab = new THREE.Vector3(), ac = new THREE.Vector3(), bc = new THREE.Vector3();
const axis = new THREE.Vector3(), best = new THREE.Vector3(), normal = new THREE.Vector3();
const edge = new THREE.Vector3(), delta = new THREE.Vector3(), cross = new THREE.Vector3();
const edges: THREE.Vector3[] = [];
const bases = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

function point(mesh: UnityTriangleMesh, index: number, out: THREE.Vector3): THREE.Vector3 {
  return out.fromArray(mesh.positions, mesh.indices[index] * 3);
}

function separates(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, axis: THREE.Vector3, hx: number, hy: number, hz: number, best: THREE.Vector3, current: number): number {
  const lengthSq = axis.lengthSq();
  if (lengthSq < 1e-12) return current;
  axis.multiplyScalar(1 / Math.sqrt(lengthSq));
  const pa = a.dot(axis), pb = b.dot(axis), pc = c.dot(axis);
  const r = hx * Math.abs(axis.x) + hy * Math.abs(axis.y) + hz * Math.abs(axis.z);
  const overlap = Math.min(r, Math.max(pa, pb, pc)) - Math.max(-r, Math.min(pa, pb, pc));
  if (overlap < -1e-5) return -1;
  if (overlap > 1e-5 && overlap < current) best.copy(axis).multiplyScalar(pa + pb + pc > 0 ? -1 : 1);
  return Math.min(current, Math.max(0, overlap));
}

export function overlapUnityTriangles(box: StaticBox, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  const mesh = box.triangles!;
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  const hx = (maxX - minX) * 0.5, hy = (maxY - minY) * 0.5, hz = (maxZ - minZ) * 0.5;
  let depth = Infinity;
  best.set(0, 0, 0);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    point(mesh, i, a); a.x -= cx; a.y -= cy; a.z -= cz;
    point(mesh, i + 1, b); b.x -= cx; b.y -= cy; b.z -= cz;
    point(mesh, i + 2, c); c.x -= cx; c.y -= cy; c.z -= cz;
    ab.subVectors(b, a); ac.subVectors(c, a); bc.subVectors(c, b);
    edges[0] = ab; edges[1] = bc; edges[2] = ac;
    normal.crossVectors(ab, ac);
    let next = separates(a, b, c, normal, hx, hy, hz, best, depth);
    for (const e of edges) {
      for (const basis of bases) {
        axis.crossVectors(e, basis);
        next = separates(a, b, c, axis, hx, hy, hz, best, depth);
        if (next < 0) break;
      }
      if (next < 0) break;
    }
    for (const basis of bases) {
      next = separates(a, b, c, basis, hx, hy, hz, best, depth);
      if (next < 0) break;
    }
    if (next >= 0) depth = next;
  }
  if (depth === Infinity) return false;
  mesh.depth = depth;
  mesh.normal.copy(best);
  return true;
}

export function rayUnityTriangles(box: StaticBox, origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number, outNormal: THREE.Vector3): number {
  const mesh = box.triangles!;
  let nearest = maxDist;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    point(mesh, i, a); point(mesh, i + 1, b); point(mesh, i + 2, c);
    ab.subVectors(b, a); ac.subVectors(c, a);
    normal.crossVectors(direction, ac);
    const determinant = ab.dot(normal);
    if (Math.abs(determinant) < 1e-9) continue;
    delta.subVectors(origin, a);
    const u = delta.dot(normal) / determinant;
    if (u < 0 || u > 1) continue;
    cross.crossVectors(delta, ab);
    const v = direction.dot(cross) / determinant;
    if (v < 0 || u + v > 1) continue;
    const distance = ac.dot(cross) / determinant;
    if (distance < 0 || distance >= nearest) continue;
    nearest = distance;
    outNormal.crossVectors(ab, ac).normalize();
    if (outNormal.dot(direction) > 0) outNormal.negate();
  }
  return nearest;
}

export function sphereUnityTriangles(box: StaticBox, position: THREE.Vector3, radius: number): boolean {
  const mesh = box.triangles!;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    point(mesh, i, a); point(mesh, i + 1, b); point(mesh, i + 2, c);
    ab.subVectors(b, a); ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();
    const distance = delta.subVectors(position, a).dot(normal);
    if (Math.abs(distance) >= radius) continue;
    edge.copy(position).addScaledVector(normal, -distance);
    const baryA = ab.dot(ab), baryB = ab.dot(ac), baryC = ac.dot(ac);
    delta.subVectors(edge, a);
    const baryD = ab.dot(delta), baryE = ac.dot(delta);
    const divisor = baryA * baryC - baryB * baryB;
    if (Math.abs(divisor) < 1e-12) continue;
    const v = (baryC * baryD - baryB * baryE) / divisor;
    const w = (baryA * baryE - baryB * baryD) / divisor;
    if (v >= 0 && w >= 0 && v + w <= 1) return true;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      edge.subVectors(q, p);
      const t = THREE.MathUtils.clamp(delta.subVectors(position, p).dot(edge) / Math.max(edge.lengthSq(), 1e-12), 0, 1);
      cross.copy(p).addScaledVector(edge, t);
      if (cross.distanceToSquared(position) < radius * radius) return true;
    }
  }
  return false;
}

export function groundUnityTriangles(box: StaticBox, x: number, z: number, fromY: number): number {
  const mesh = box.triangles!;
  let height = -Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    point(mesh, i, a); point(mesh, i + 1, b); point(mesh, i + 2, c);
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < 1e-12) continue;
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
    const y = u * a.y + v * b.y + w * c.y;
    if (y <= fromY + 0.05 && y > height) height = y;
  }
  return height;
}
