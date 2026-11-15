import * as THREE from 'three';
import type { ArenaInfo, GameContext, INavGrid } from '../core/types';
import type { UnitySceneDocument } from './UnityLevelLibrary';

interface NavTriangle {
  a: number;
  b: number;
  c: number;
  cx: number;
  cz: number;
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function distanceSquared(x: number, z: number, px: number, pz: number): number {
  const dx = x - px, dz = z - pz;
  return dx * dx + dz * dz;
}

export class UnityNavMesh implements INavGrid {
  private readonly vertices: THREE.Vector3[];
  private readonly triangles: NavTriangle[] = [];
  private readonly edges = new Map<string, { left: number; right: number; next: number }[]>();
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private readonly heapPosition: Int32Array;
  private readonly nearestPoint = new THREE.Vector3();
  private search = 0;
  private heapSize = 0;

  constructor(private readonly ctx: GameContext, document: UnitySceneDocument) {
    const navigation = document.navigation;
    const welded = new Map<string, number>();
    const remap: number[] = [];
    const vertices: THREE.Vector3[] = [];
    for (const point of navigation.vertices) {
      const key = point.map(value => Math.round(value * 10000)).join(':');
      let index = welded.get(key);
      if (index === undefined) {
        index = vertices.length;
        welded.set(key, index);
        vertices.push(new THREE.Vector3(point[0], point[1], point[2]));
      }
      remap.push(index);
    }
    this.vertices = vertices;
    for (let i = 0; i < navigation.indices.length; i += 3) {
      const index = this.triangles.length;
      const a = remap[navigation.indices[i]], b = remap[navigation.indices[i + 1]], c = remap[navigation.indices[i + 2]];
      const va = this.vertices[a], vb = this.vertices[b], vc = this.vertices[c];
      this.triangles.push({ a, b, c, cx: (va.x + vb.x + vc.x) / 3, cz: (va.z + vb.z + vc.z) / 3 });
      this.addEdge(a, b, index);
      this.addEdge(b, c, index);
      this.addEdge(c, a, index);
    }
    const count = this.triangles.length;
    this.g = new Float64Array(count);
    this.f = new Float64Array(count);
    this.parent = new Int32Array(count);
    this.stamp = new Uint32Array(count);
    this.closed = new Uint32Array(count);
    this.heap = new Int32Array(count + 1);
    this.heapPosition = new Int32Array(count);
  }

  build(_arena: ArenaInfo): void {}

  isWalkable(x: number, z: number): boolean {
    return this.containing(x, 0, z, false) >= 0;
  }

  nearestWalkable(point: THREE.Vector3, out: THREE.Vector3): boolean {
    const index = this.nearestTriangle(point);
    if (index < 0) return false;
    this.closest(index, point, out);
    return true;
  }

  randomWalkable(center: THREE.Vector3, minR: number, maxR: number, out: THREE.Vector3): boolean {
    const lo = Math.max(0, Math.min(minR, maxR)), hi = Math.max(lo, Math.max(minR, maxR));
    for (let attempt = 0; attempt < 64 && this.triangles.length > 0; attempt++) {
      const angle = this.ctx.rng.next() * Math.PI * 2;
      const radius = Math.sqrt(lo * lo + this.ctx.rng.next() * (hi * hi - lo * lo));
      this.nearestPoint.set(center.x + Math.sin(angle) * radius, center.y, center.z + Math.cos(angle) * radius);
      const index = this.nearestTriangle(this.nearestPoint);
      if (index < 0) continue;
      this.closest(index, this.nearestPoint, out);
      const distance = Math.hypot(out.x - center.x, out.z - center.z);
      if (distance >= lo && distance <= hi) return true;
    }
    return this.nearestWalkable(center, out);
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): boolean {
    out.length = 0;
    const start = this.nearestTriangle(from);
    const finish = this.nearestTriangle(to);
    if (start < 0 || finish < 0) return false;
    this.closest(start, from, this.nearestPoint);
    const startPoint = this.nearestPoint.clone();
    const exactGoal = this.containing(to.x, to.y, to.z, true) >= 0;
    const endPoint = exactGoal ? to.clone() : this.closest(finish, to, new THREE.Vector3()).clone();
    if (start === finish) {
      out.push(endPoint);
      return true;
    }
    const route = this.findTriangles(start, finish);
    if (route.length === 0) {
      this.closest(start, from, endPoint);
      out.push(endPoint);
      return false;
    }
    const left: THREE.Vector3[] = [startPoint], right: THREE.Vector3[] = [startPoint];
    for (let i = 1; i < route.length; i++) {
      const previous = this.triangles[route[i - 1]], current = this.triangles[route[i]];
      const previousCenter = new THREE.Vector3(previous.cx, 0, previous.cz);
      const direction = new THREE.Vector3(current.cx - previous.cx, 0, current.cz - previous.cz);
      const common = [previous.a, previous.b, previous.c].filter(index => index === current.a || index === current.b || index === current.c);
      if (common.length !== 2) continue;
      let a = this.vertices[common[0]], b = this.vertices[common[1]];
      if (cross(previousCenter.x, previousCenter.z, a.x, a.z, previousCenter.x + direction.x, previousCenter.z + direction.z) < 0) {
        const swap = a; a = b; b = swap;
      }
      left.push(a); right.push(b);
    }
    left.push(endPoint); right.push(endPoint);
    this.funnel(left, right, out);
    if (out.length === 0 || out[out.length - 1].distanceToSquared(endPoint) > 1e-8) out.push(endPoint);
    return true;
  }

  private addEdge(a: number, b: number, triangle: number): void {
    const low = Math.min(a, b), high = Math.max(a, b);
    const key = `${low}:${high}`;
    const list = this.edges.get(key) ?? [];
    list.push({ left: low, right: high, next: triangle });
    this.edges.set(key, list);
  }

  private neighbours(index: number): number[] {
    const triangle = this.triangles[index];
    const result: number[] = [];
    for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      for (const edge of this.edges.get(key) ?? []) if (edge.next !== index && !result.includes(edge.next)) result.push(edge.next);
    }
    return result;
  }

  private containing(x: number, y: number, z: number, checkHeight: boolean): number {
    let best = -1, vertical = Infinity;
    for (let i = 0; i < this.triangles.length; i++) {
      const triangle = this.triangles[i];
      const a = this.vertices[triangle.a], b = this.vertices[triangle.b], c = this.vertices[triangle.c];
      const ab = cross(a.x, a.z, b.x, b.z, x, z), bc = cross(b.x, b.z, c.x, c.z, x, z), ca = cross(c.x, c.z, a.x, a.z, x, z);
      if ((ab < -1e-5 || bc < -1e-5 || ca < -1e-5) && (ab > 1e-5 || bc > 1e-5 || ca > 1e-5)) continue;
      const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(determinant) < 1e-8) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / determinant;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / determinant;
      const height = u * a.y + v * b.y + (1 - u - v) * c.y;
      const difference = Math.abs(height - y);
      if (!checkHeight || difference < 3) {
        if (difference < vertical) { best = i; vertical = difference; }
      }
    }
    return best;
  }

  private nearestTriangle(point: THREE.Vector3): number {
    const containing = this.containing(point.x, point.y, point.z, true);
    if (containing >= 0) return containing;
    let best = -1, distance = Infinity;
    for (let i = 0; i < this.triangles.length; i++) {
      this.closest(i, point, this.nearestPoint);
      const candidate = this.nearestPoint.distanceToSquared(point);
      if (candidate < distance) { distance = candidate; best = i; }
    }
    return best;
  }

  private closest(index: number, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const triangle = this.triangles[index];
    const a = this.vertices[triangle.a], b = this.vertices[triangle.b], c = this.vertices[triangle.c];
    const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(determinant) < 1e-8) return out.copy(a);
    const u = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / determinant;
    const v = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / determinant;
    const w = 1 - u - v;
    if (u >= 0 && v >= 0 && w >= 0) return out.set(point.x, u * a.y + v * b.y + w * c.y, point.z);
    let distance = Infinity;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const dx = q.x - p.x, dz = q.z - p.z;
      const length = dx * dx + dz * dz;
      const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.z - p.z) * dz) / length)) : 0;
      const x = p.x + t * dx, z = p.z + t * dz;
      const candidate = distanceSquared(x, z, point.x, point.z);
      if (candidate < distance) {
        distance = candidate;
        out.set(x, p.y + t * (q.y - p.y), z);
      }
    }
    return out;
  }

  private findTriangles(start: number, finish: number): number[] {
    if (++this.search === 0xffffffff) {
      this.search = 1;
      this.stamp.fill(0);
      this.closed.fill(0);
    }
    const id = this.search;
    this.heapSize = 0;
    this.parent[start] = -1;
    this.g[start] = 0;
    this.f[start] = this.heuristic(start, finish);
    this.stamp[start] = id;
    this.push(start);
    while (this.heapSize > 0) {
      const current = this.pop();
      if (current === finish) {
        const route: number[] = [];
        for (let index = finish; index >= 0; index = this.parent[index]) route.push(index);
        return route.reverse();
      }
      this.closed[current] = id;
      for (const next of this.neighbours(current)) {
        if (this.closed[next] === id) continue;
        const a = this.triangles[current], b = this.triangles[next];
        const score = this.g[current] + Math.hypot(a.cx - b.cx, a.cz - b.cz);
        if (this.stamp[next] === id && score >= this.g[next]) continue;
        if (this.stamp[next] !== id) this.heapPosition[next] = 0;
        this.stamp[next] = id;
        this.parent[next] = current;
        this.g[next] = score;
        this.f[next] = score + this.heuristic(next, finish);
        if (this.heapPosition[next] > 0 && this.heap[this.heapPosition[next]] === next) this.siftUp(this.heapPosition[next]);
        else this.push(next);
      }
    }
    return [];
  }

  private heuristic(a: number, b: number): number {
    const ta = this.triangles[a], tb = this.triangles[b];
    return Math.hypot(ta.cx - tb.cx, ta.cz - tb.cz);
  }

  private push(index: number): void {
    const position = ++this.heapSize;
    this.heap[position] = index;
    this.heapPosition[index] = position;
    this.siftUp(position);
  }

  private siftUp(position: number): void {
    const index = this.heap[position];
    while (position > 1) {
      const parent = position >> 1, other = this.heap[parent];
      if (this.f[other] <= this.f[index]) break;
      this.heap[position] = other;
      this.heapPosition[other] = position;
      position = parent;
    }
    this.heap[position] = index;
    this.heapPosition[index] = position;
  }

  private pop(): number {
    const result = this.heap[1];
    this.heapPosition[result] = 0;
    const tail = this.heap[this.heapSize--];
    if (this.heapSize === 0) return result;
    let position = 1;
    while (position * 2 <= this.heapSize) {
      let child = position * 2;
      if (child < this.heapSize && this.f[this.heap[child + 1]] < this.f[this.heap[child]]) child++;
      if (this.f[tail] <= this.f[this.heap[child]]) break;
      this.heap[position] = this.heap[child];
      this.heapPosition[this.heap[position]] = position;
      position = child;
    }
    this.heap[position] = tail;
    this.heapPosition[tail] = position;
    return result;
  }

  private funnel(left: THREE.Vector3[], right: THREE.Vector3[], out: THREE.Vector3[]): void {
    let apex = left[0], portalLeft = left[0], portalRight = right[0];
    let apexIndex = 0, leftIndex = 0, rightIndex = 0;
    for (let i = 1; i < left.length; i++) {
      const nextLeft = left[i], nextRight = right[i];
      if (cross(apex.x, apex.z, portalRight.x, portalRight.z, nextRight.x, nextRight.z) <= 0) {
        if (apex.distanceToSquared(portalRight) < 1e-8 || cross(apex.x, apex.z, portalLeft.x, portalLeft.z, nextRight.x, nextRight.z) > 0) {
          portalRight = nextRight;
          rightIndex = i;
        } else {
          out.push(portalLeft.clone());
          apex = portalLeft;
          apexIndex = leftIndex;
          portalLeft = apex;
          portalRight = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
      if (cross(apex.x, apex.z, portalLeft.x, portalLeft.z, nextLeft.x, nextLeft.z) >= 0) {
        if (apex.distanceToSquared(portalLeft) < 1e-8 || cross(apex.x, apex.z, portalRight.x, portalRight.z, nextLeft.x, nextLeft.z) < 0) {
          portalLeft = nextLeft;
          leftIndex = i;
        } else {
          out.push(portalRight.clone());
          apex = portalRight;
          apexIndex = rightIndex;
          portalLeft = apex;
          portalRight = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
        }
      }
    }
  }
}
