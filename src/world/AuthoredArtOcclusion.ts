/** Narrow ray-only apertures for reviewed art alcoves. Movement remains the approved whitebox. */
import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import type { SceneArchitecturePlacement } from './LevelTypes';
import type { CollisionWorld, RayWindowBounds, StaticBox, WorldRayHit, WorldRayWindow } from './Collision';
import { architectureAssetBounds, architectureMatrix } from './SceneArchitecture';

export interface ArtRayWindowSpec {
  id: string;
  bounds: RayWindowBounds;
  /** Required new art. Neighbouring visible walls/guards are collected by bounds too. */
  placementIndices: number[];
}

interface TreeNode { bounds: THREE.Box3; left?: TreeNode; right?: TreeNode; triangles?: number[] }
interface WindowState extends WorldRayWindow { ready: boolean; tree: TriangleTree | null; unregister: () => void }

function box(bounds: RayWindowBounds): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ), new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ));
}

function envelopeBounds(p: SceneArchitecturePlacement): THREE.Box3 {
  const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
  const x = (p.envelope.width * c + p.envelope.depth * s) * p.s * .5;
  const z = (p.envelope.width * s + p.envelope.depth * c) * p.s * .5;
  return new THREE.Box3(new THREE.Vector3(p.x - x, p.y, p.z - z),
    new THREE.Vector3(p.x + x, p.y + p.envelope.height * p.s, p.z + z));
}

/** Fixed world-space LOD1 triangles; no library geometry/material is edited or disposed. */
class TriangleTree {
  readonly root: TreeNode;
  nodeTests = 0;
  triangleTests = 0;
  private readonly ray = new THREE.Ray();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly stack: TreeNode[] = [];

  constructor(private readonly positions: Float32Array, private readonly owners: StaticBox[]) {
    const bounds = owners.map((_, i) => new THREE.Box3().setFromArray(positions.subarray(i * 9, i * 9 + 9)));
    const build = (triangles: number[]): TreeNode => {
      const union = new THREE.Box3(); for (const i of triangles) union.union(bounds[i]);
      if (triangles.length <= 16) return { bounds: union, triangles };
      const size = union.getSize(new THREE.Vector3()), axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
      triangles.sort((a, b) => bounds[a].min[axis] + bounds[a].max[axis] - bounds[b].min[axis] - bounds[b].max[axis]);
      const split = Math.floor(triangles.length / 2);
      return { bounds: union, left: build(triangles.slice(0, split)), right: build(triangles.slice(split)) };
    };
    this.root = build(owners.map((_, i) => i));
  }

  private intersects(bounds: THREE.Box3, near: number, far: number): boolean {
    for (let axis = 0; axis < 3; axis++) {
      const origin = this.ray.origin.getComponent(axis), direction = this.ray.direction.getComponent(axis);
      const min = bounds.min.getComponent(axis), max = bounds.max.getComponent(axis);
      if (Math.abs(direction) < 1e-9) { if (origin < min || origin > max) return false; continue; }
      let a = (min - origin) / direction, b = (max - origin) / direction;
      if (a > b) { const swap = a; a = b; b = swap; }
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return false;
    }
    return true;
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, near: number, far: number, out: WorldRayHit): boolean {
    this.ray.set(origin, direction); this.nodeTests = this.triangleTests = 0;
    this.stack.length = 0; this.stack.push(this.root);
    let found = false, best = far;
    while (this.stack.length) {
      const node = this.stack.pop()!; this.nodeTests++;
      if (!this.intersects(node.bounds, near, best)) continue;
      if (!node.triangles) { this.stack.push(node.left!, node.right!); continue; }
      for (const i of node.triangles) {
        this.triangleTests++;
        this.a.fromArray(this.positions, i * 9); this.b.fromArray(this.positions, i * 9 + 3); this.c.fromArray(this.positions, i * 9 + 6);
        if (!this.ray.intersectTriangle(this.a, this.b, this.c, false, this.point)) continue;
        const distance = this.delta.subVectors(this.point, origin).dot(direction);
        if (distance < near - 1e-5 || distance > best + 1e-5) continue;
        best = Math.max(near, distance); found = true;
        out.distance = best; out.point.copy(this.point); out.box = this.owners[i];
        THREE.Triangle.getNormal(this.a, this.b, this.c, out.normal);
        if (out.normal.dot(direction) > 0) out.normal.negate();
      }
    }
    return found;
  }
}

export class AuthoredArtOcclusion {
  readonly stats = { windows: 0, candidates: 0, triangles: 0, queries: 0, lastNodeTests: 0, lastTriangleTests: 0 };
  private readonly states: WindowState[] = [];
  private disposed = false;

  constructor(world: CollisionWorld, private readonly placements: readonly SceneArchitecturePlacement[],
    private readonly specs: readonly ArtRayWindowSpec[], private readonly onReady: (id: string) => void = () => {}) {
    for (const spec of specs) {
      const state: WindowState = {
        bounds: { ...spec.bounds }, replaceTag: 'whitebox-wall', ready: false, tree: null, unregister: () => {},
        raycast: (origin, direction, near, far, out) => {
          if (!state.tree) return false;
          const hit = state.tree.raycast(origin, direction, near, far, out);
          this.stats.queries++; this.stats.lastNodeTests = state.tree.nodeTests; this.stats.lastTriangleTests = state.tree.triangleTests;
          return hit;
        },
      };
      state.unregister = world.addRayWindow(state); this.states.push(state);
    }
    this.build();
    if (this.states.some(state => !state.ready)) void AssetLibrary.preload().then(() => { if (!this.disposed) this.build(); });
  }

  private build(): void {
    for (const [index, spec] of this.specs.entries()) {
      const state = this.states[index]; if (state.ready) continue;
      const region = box(spec.bounds);
      if (!spec.placementIndices.length || spec.placementIndices.some(i => !this.placements[i] || !AssetLibrary.get(this.placements[i].assetId))) continue;
      // A once-per-window broad phase. The runtime ray never scans the full scene's instances.
      const candidates = this.placements.filter(p => envelopeBounds(p).intersectsBox(region));
      if (!candidates.length || candidates.some(p => !AssetLibrary.get(p.assetId))) continue;
      const sourceBounds = new Map<string, THREE.Box3>();
      const packed: number[] = [], owners: StaticBox[] = [];
      const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], triangleBounds = new THREE.Box3();
      for (const p of candidates) {
        const asset = AssetLibrary.get(p.assetId)!, source = asset.lods[Math.min(1, asset.lods.length - 1)];
        let bounds = sourceBounds.get(asset.id);
        if (!bounds) { bounds = architectureAssetBounds(asset.lods); sourceBounds.set(asset.id, bounds); }
        const transform = architectureMatrix(source, p, bounds), geometry = source.geometry;
        const position = geometry.getAttribute('position'), indices = geometry.getIndex();
        const envelope = envelopeBounds(p);
        const owner: StaticBox = { minX: envelope.min.x, minY: envelope.min.y, minZ: envelope.min.z,
          maxX: envelope.max.x, maxY: envelope.max.y, maxZ: envelope.max.z, tag: `authored-art:${asset.id}`, noRaycast: false, _stamp: 0 };
        for (let i = 0, count = indices?.count ?? position.count; i < count; i += 3) {
          triangleBounds.makeEmpty();
          for (let corner = 0; corner < 3; corner++) {
            vertices[corner].fromBufferAttribute(position, indices ? indices.getX(i + corner) : i + corner).applyMatrix4(transform);
            triangleBounds.expandByPoint(vertices[corner]);
          }
          if (!triangleBounds.intersectsBox(region)) continue;
          for (const vertex of vertices) packed.push(vertex.x, vertex.y, vertex.z);
          owners.push(owner);
        }
      }
      if (!owners.length) continue; // Missing or invalid art fails closed, including its visible loading support.
      state.tree = new TriangleTree(new Float32Array(packed), owners);
      this.stats.candidates += candidates.length; this.stats.triangles += owners.length; this.stats.windows++;
      state.ready = true; this.onReady(spec.id);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.states) { state.unregister(); state.ready = false; state.tree = null; }
    this.states.length = 0;
  }
}
