import * as THREE from 'three';

/**
 * 静态碰撞世界：一组轴对齐包围盒（AABB）+ XZ 平面均匀网格加速。
 * 玩家 / 敌人都用「脚底中心 + 半宽 + 高度」的 AABB 做运动碰撞；
 * 射线（子弹、视线）与 AABB 做 slab 求交。
 */
export interface StaticBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** 'floor' | 'wall' | 'cover' | 'platform' | 'pillar' | 'prop' ... */
  tag: string;
  /** 为 true 时不阻挡射线与投射物（例如只阻挡移动的空气墙） */
  noRaycast?: boolean;
  /** 查询去重用 */
  _stamp: number;
}

export interface MoveResult {
  onGround: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
  stepped: boolean;
  /** 最后一次着地的地面高度 */
  groundY: number;
  /** 本次移动中撞到的墙的法线（水平），未撞墙为 0 向量 */
  wallNormal: THREE.Vector3;
}

export interface WorldRayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  box: StaticBox;
}

const EPS = 1e-4;
const CELL = 4;

function cellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}

export class CollisionWorld {
  readonly boxes: StaticBox[] = [];
  /** 每次增删自增，NavGrid 等可据此判断是否需要重建 */
  version = 0;

  private grid = new Map<number, StaticBox[]>();
  private stamp = 1;
  private scratch: StaticBox[] = [];

  // ───────────── 构建 ─────────────

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tag = 'wall', noRaycast = false): StaticBox {
    const b: StaticBox = {
      minX: Math.min(minX, maxX), minY: Math.min(minY, maxY), minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY), maxZ: Math.max(minZ, maxZ),
      tag, noRaycast, _stamp: 0,
    };
    this.boxes.push(b);
    this.insert(b);
    this.version++;
    return b;
  }

  /** 以中心 + 尺寸添加（cy 为盒子几何中心的高度） */
  addCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tag = 'wall', noRaycast = false): StaticBox {
    return this.addBox(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, tag, noRaycast);
  }

  /** 以底面中心 + 尺寸添加（y 为底面高度） */
  addFromBottom(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, tag = 'wall', noRaycast = false): StaticBox {
    return this.addBox(cx - sx / 2, y, cz - sz / 2, cx + sx / 2, y + sy, cz + sz / 2, tag, noRaycast);
  }

  remove(b: StaticBox): void {
    const i = this.boxes.indexOf(b);
    if (i < 0) return;
    this.boxes.splice(i, 1);
    this.rebuildGrid();
    this.version++;
  }

  clear(): void {
    this.boxes.length = 0;
    this.grid.clear();
    this.version++;
  }

  private insert(b: StaticBox): void {
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(b);
      }
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const b of this.boxes) this.insert(b);
  }

  /** 查询与 XZ 矩形相交的候选盒（结果写入 out，已去重） */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: StaticBox[] = []): StaticBox[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    // 超大查询直接返回全部
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) {
      for (const b of this.boxes) out.push(b);
      return out;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(cellKey(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (b._stamp === s) continue;
          b._stamp = s;
          out.push(b);
        }
      }
    }
    return out;
  }

  // ───────────── 重叠 ─────────────

  /** AABB 是否与任意静态盒重叠 */
  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): StaticBox | null {
    const list = this.query(minX, minZ, maxX, maxZ, this.scratch);
    for (const b of list) {
      if (minX < b.maxX - EPS && maxX > b.minX + EPS &&
          minY < b.maxY - EPS && maxY > b.minY + EPS &&
          minZ < b.maxZ - EPS && maxZ > b.minZ + EPS) return b;
    }
    return null;
  }

  /** 以脚底中心的实体包围盒测试重叠 */
  overlapsBody(x: number, y: number, z: number, halfW: number, height: number): StaticBox | null {
    return this.overlaps(x - halfW, y, z - halfW, x + halfW, y + height, z + halfW);
  }

  /** 球是否与静态几何重叠（投射物用） */
  sphereOverlaps(c: THREE.Vector3, r: number): boolean {
    const list = this.query(c.x - r, c.z - r, c.x + r, c.z + r, this.scratch);
    for (const b of list) {
      if (b.noRaycast) continue;
      const dx = Math.max(b.minX - c.x, 0, c.x - b.maxX);
      const dy = Math.max(b.minY - c.y, 0, c.y - b.maxY);
      const dz = Math.max(b.minZ - c.z, 0, c.z - b.maxZ);
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    return false;
  }

  pointInside(p: THREE.Vector3): boolean {
    return this.overlaps(p.x - EPS * 2, p.y - EPS * 2, p.z - EPS * 2, p.x + EPS * 2, p.y + EPS * 2, p.z + EPS * 2) !== null;
  }

  /**
   * (x,z) 处、不高于 fromY 的最高地面高度；halfW>0 时按方形脚底取最高。没有地面返回 -Infinity。
   */
  groundHeight(x: number, z: number, fromY: number, halfW = 0): number {
    const list = this.query(x - halfW, z - halfW, x + halfW, z + halfW, this.scratch);
    let best = -Infinity;
    for (const b of list) {
      if (x - halfW < b.maxX && x + halfW > b.minX && z - halfW < b.maxZ && z + halfW > b.minZ) {
        if (b.maxY <= fromY + 0.05 && b.maxY > best) best = b.maxY;
      }
    }
    return best;
  }

  // ───────────── 运动 ─────────────

  /**
   * 移动一个脚底中心的 AABB 实体（原地修改 pos）。轴分离求解 + 台阶自动抬升 + 下台阶贴地。
   * @param wasOnGround 上一帧是否着地（决定能否上台阶、下台阶贴地）
   */
  moveBody(
    pos: THREE.Vector3,
    halfW: number,
    height: number,
    delta: THREE.Vector3,
    wasOnGround: boolean,
    stepHeight = 0.45,
    out?: MoveResult,
  ): MoveResult {
    const r: MoveResult = out ?? { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: -Infinity, wallNormal: new THREE.Vector3() };
    r.onGround = false;
    r.hitWall = false;
    r.hitCeiling = false;
    r.stepped = false;
    r.wallNormal.set(0, 0, 0);

    const maxComp = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
    const steps = Math.min(12, Math.max(1, Math.ceil(maxComp / Math.max(0.05, halfW * 0.8))));
    const sx = delta.x / steps, sy = delta.y / steps, sz = delta.z / steps;
    let grounded = wasOnGround;

    for (let i = 0; i < steps; i++) {
      if (sx !== 0) this.moveAxis(pos, halfW, height, 0, sx, grounded ? stepHeight : 0, r);
      if (sz !== 0) this.moveAxis(pos, halfW, height, 2, sz, grounded ? stepHeight : 0, r);
      if (sy !== 0) this.moveAxis(pos, halfW, height, 1, sy, 0, r);
      if (r.onGround) grounded = true;
    }

    // 下台阶 / 下坡贴地
    if (wasOnGround && !r.onGround && delta.y <= 0 && !r.hitCeiling) {
      const gy = this.groundHeight(pos.x, pos.z, pos.y + 0.01, halfW - EPS * 10);
      if (gy > -Infinity && pos.y - gy <= stepHeight + 0.05 && pos.y - gy >= -0.01) {
        if (!this.overlapsBody(pos.x, gy + EPS, pos.z, halfW, height)) {
          pos.y = gy + EPS;
          r.onGround = true;
          r.groundY = gy;
        }
      }
    }
    if (r.wallNormal.lengthSq() > 0) r.wallNormal.normalize();
    return r;
  }

  private moveAxis(pos: THREE.Vector3, hw: number, h: number, axis: 0 | 1 | 2, d: number, stepHeight: number, r: MoveResult): void {
    if (axis === 0) pos.x += d;
    else if (axis === 1) pos.y += d;
    else pos.z += d;

    for (let iter = 0; iter < 6; iter++) {
      const b = this.overlapsBody(pos.x, pos.y, pos.z, hw, h);
      if (!b) return;

      if (axis === 1) {
        if (d < 0) {
          pos.y = b.maxY + EPS;
          r.onGround = true;
          r.groundY = b.maxY;
        } else {
          pos.y = b.minY - h - EPS;
          r.hitCeiling = true;
        }
        continue;
      }

      // 水平：先尝试上台阶
      const rise = b.maxY - pos.y;
      if (stepHeight > 0 && rise > 0 && rise <= stepHeight) {
        const ny = b.maxY + EPS;
        if (!this.overlapsBody(pos.x, ny, pos.z, hw, h)) {
          pos.y = ny;
          r.stepped = true;
          r.onGround = true;
          r.groundY = b.maxY;
          continue;
        }
      }

      r.hitWall = true;
      if (axis === 0) {
        if (d > 0) { pos.x = b.minX - hw - EPS; r.wallNormal.x -= 1; }
        else { pos.x = b.maxX + hw + EPS; r.wallNormal.x += 1; }
      } else {
        if (d > 0) { pos.z = b.minZ - hw - EPS; r.wallNormal.z -= 1; }
        else { pos.z = b.maxZ + hw + EPS; r.wallNormal.z += 1; }
      }
    }
  }

  // ───────────── 射线 ─────────────

  /** 射线与静态几何求交（dir 必须归一化）。未命中返回 null。out 可复用以避免分配。 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out?: WorldRayHit): WorldRayHit | null {
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const list = this.query(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez), this.scratch);

    let bestT = maxDist;
    let bestBox: StaticBox | null = null;
    let bestAxis = -1;
    let bestSign = 0;

    for (const b of list) {
      if (b.noRaycast) continue;
      let tmin = 0;
      let tmax = bestT;
      let axis = -1;
      let sign = 0;
      let miss = false;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
        const dd = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
        const mn = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ;
        const mx = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
        if (Math.abs(dd) < 1e-9) {
          if (o < mn || o > mx) { miss = true; break; }
          continue;
        }
        const inv = 1 / dd;
        let t1 = (mn - o) * inv;
        let t2 = (mx - o) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = dd > 0 ? -1 : 1; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss) continue;
      if (tmin < bestT || (bestBox === null && tmin <= bestT)) {
        bestT = tmin;
        bestBox = b;
        bestAxis = axis;
        bestSign = sign;
      }
    }

    if (!bestBox) return null;
    const hit: WorldRayHit = out ?? { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: bestBox };
    hit.distance = bestT;
    hit.box = bestBox;
    hit.point.copy(origin).addScaledVector(dir, bestT);
    if (bestAxis < 0) hit.normal.copy(dir).multiplyScalar(-1); // 起点在盒内
    else hit.normal.set(bestAxis === 0 ? bestSign : 0, bestAxis === 1 ? bestSign : 0, bestAxis === 2 ? bestSign : 0);
    return hit;
  }

  /** a → b 之间是否被静态几何遮挡 */
  segmentBlocked(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-6) return false;
    _dir.multiplyScalar(1 / len);
    return this.raycast(a, _dir, len - 0.01, _hit) !== null;
  }
}

const _dir = new THREE.Vector3();
const _hit: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };
