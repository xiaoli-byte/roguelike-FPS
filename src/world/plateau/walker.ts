/**
 * 检视页的第一人称移动（数值同 PlayerController：7.5 m/s，起跳 8.6 m/s，重力 26，冲刺 22 m/s × 0.18 s）。
 * 碰撞：地形高度 + 斜坡上限 40°（更陡会滑下来）；建筑是带高度区间的方块 / 圆柱，walkable 的顶面可以站；
 * 深水（> 1.1 m）走不进去。没有空气墙：离开盆地爬到雪山高处会进入风雪，被风推回（软边界）。
 * 只为看场景，不追求和正式游戏的碰撞完全一致。
 */
import * as THREE from 'three';
import { MAP } from './spec';
import { basinDistance, type Terrain } from './terrain';

export interface BoxCollider { kind: 'box'; x: number; z: number; hx: number; hz: number; yaw: number; y0: number; y1: number; walkable: boolean }
export interface CylCollider { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; walkable: boolean }
export type Collider = BoxCollider | CylCollider;

const CELL = 8;
export const STEP = 0.45;
const RADIUS = 0.35;
const HEIGHT = 1.8;
export const EYE = 1.62;
const MAX_SLOPE = Math.tan((40 * Math.PI) / 180);

export class CollisionWorld {
  readonly list: Collider[] = [];
  private grid = new Map<number, Collider[]>();

  constructor(readonly terrain: Terrain) {}

  add(c: Collider): void {
    this.list.push(c);
    const ext = c.kind === 'box' ? Math.hypot(c.hx, c.hz) : c.r;
    const i0 = Math.floor((c.x - ext) / CELL), i1 = Math.floor((c.x + ext) / CELL);
    const j0 = Math.floor((c.z - ext) / CELL), j1 = Math.floor((c.z + ext) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * 4096 + j;
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, cell = []);
      cell.push(c);
    }
  }

  private near(x: number, z: number): Collider[] {
    const out = new Set<Collider>();
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const cell = this.grid.get((i + a) * 4096 + (j + b));
      if (cell) for (const c of cell) out.add(c);
    }
    return [...out];
  }

  /** 点到碰撞体水平轮廓的距离（内部为负） */
  private footprintDist(c: Collider, x: number, z: number): number {
    if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) - c.r;
    const dx = x - c.x, dz = z - c.z;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const qx = Math.abs(lx) - c.hx, qz = Math.abs(lz) - c.hz;
    const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0);
  }

  /** 这一点是否在任何碰撞体的占地范围内（散布避让用，不看高度） */
  occupied(x: number, z: number, pad = 0.2): boolean {
    for (const c of this.near(x, z)) if (this.footprintDist(c, x, z) < pad) return true;
    return false;
  }

  /** 脚下的地面：地形，或脚底以下 STEP 范围内可站立的顶面 */
  groundAt(x: number, z: number, feetY: number): number {
    let g = this.terrain.heightAt(x, z);
    for (const c of this.near(x, z)) {
      if (!c.walkable || c.y1 > feetY + STEP + 0.01 || c.y1 <= g) continue;
      if (this.footprintDist(c, x, z) <= 0.05) g = c.y1;
    }
    return g;
  }

  /** 身体（脚 + STEP 到头顶）是否与不可通行的碰撞体相交 */
  blocked(x: number, z: number, feetY: number): boolean {
    for (const c of this.near(x, z)) {
      if (c.y1 <= feetY + STEP || c.y0 >= feetY + HEIGHT) continue;
      if (this.footprintDist(c, x, z) < RADIUS) return true;
    }
    return false;
  }
}

export interface WalkInput {
  forward: number; right: number; up: number;
  jump: boolean; dash: boolean; fast: boolean;
}

export class Walker {
  readonly feet = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  vy = 0;
  grounded = false;
  fly = false;
  doubleJump = false;
  /** 风雪强度 0..1（软边界），给画面做白雾 */
  wind = 0;
  private jumps = 0;
  private dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector2();
  private carry = new THREE.Vector2();

  constructor(private readonly world: CollisionWorld) {}

  place(x: number, z: number, y?: number): void {
    this.feet.set(x, y ?? this.world.groundAt(x, z, 1e4), z);
    this.vy = 0;
    this.carry.set(0, 0);
    this.grounded = true;
  }

  eye(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.feet).setY(this.feet.y + (this.fly ? 0 : EYE)); }

  lookAt(target: THREE.Vector3): void {
    const e = this.eye(new THREE.Vector3());
    const d = target.clone().sub(e);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  update(dt: number, inp: WalkInput): void {
    const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    const wish = new THREE.Vector2().addScaledVector(fwd, inp.forward).addScaledVector(right, inp.right);
    if (wish.lengthSq() > 1) wish.normalize();
    if (this.fly) {
      const speed = inp.fast ? 60 : 16;
      const cp = Math.cos(this.pitch);
      this.feet.x += (wish.x * (inp.forward !== 0 ? cp : 1)) * speed * dt;
      this.feet.z += (wish.y * (inp.forward !== 0 ? cp : 1)) * speed * dt;
      this.feet.y += (inp.forward * Math.sin(this.pitch) + inp.up) * speed * dt;
      this.feet.y = Math.max(this.feet.y, this.world.terrain.heightAt(this.feet.x, this.feet.z) + 0.5);
      return;
    }
    // 冲刺：固定 0.18 s，结束保留 45% 速度
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (inp.dash && this.dashCd <= 0) {
      this.dashT = 0.18; this.dashCd = 0.9;
      this.dashDir.copy(wish.lengthSq() > 0.01 ? wish : fwd).normalize();
    }
    let vx: number, vz: number;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDir.x * 22; vz = this.dashDir.y * 22;
      if (this.dashT <= 0) this.carry.set(vx * 0.45, vz * 0.45);
    } else {
      this.carry.multiplyScalar(Math.max(0, 1 - dt * 6));
      vx = wish.x * 7.5 + this.carry.x; vz = wish.y * 7.5 + this.carry.y;
    }
    // 跳跃
    if (inp.jump) {
      if (this.grounded) { this.vy = 8.6; this.grounded = false; this.jumps = this.doubleJump ? 1 : 0; }
      else if (this.jumps > 0) { this.vy = 8.2; this.jumps--; }
    }
    // 水平移动：分小步，逐轴尝试
    const dist = Math.hypot(vx, vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.2));
    for (let s = 0; s < n; s++) {
      const sx = (vx * dt) / n, sz = (vz * dt) / n;
      if (!this.tryMove(sx, sz)) {
        if (!this.tryMove(sx, 0)) this.tryMove(0, sz);
      }
    }
    // 软边界：离开盆地太远就起风雪，把人往盆地里推
    const d = basinDistance(this.feet.x, this.feet.z);
    this.wind = Math.min(1, Math.max(0, (d - MAP.softBoundary) / 14));
    if (this.wind > 0) {
      const e = 1.5, x = this.feet.x, z = this.feet.z;
      const gx = basinDistance(x + e, z) - basinDistance(x - e, z), gz = basinDistance(x, z + e) - basinDistance(x, z - e);
      const gl = Math.hypot(gx, gz) || 1;
      const push = (4 + 18 * this.wind) * dt;
      this.tryMove((-gx / gl) * push, (-gz / gl) * push, true);
    }
    // 站在超过坡度上限的陡坡上（不是可站立的顶面）会往下滑
    if (this.grounded && this.feet.y <= this.world.terrain.heightAt(this.feet.x, this.feet.z) + 0.02) {
      const t = this.world.terrain, e = 0.5, x = this.feet.x, z = this.feet.z;
      const gx = (t.heightAt(x + e, z) - t.heightAt(x - e, z)) / (2 * e), gz = (t.heightAt(x, z + e) - t.heightAt(x, z - e)) / (2 * e);
      const g = Math.hypot(gx, gz);
      if (g > MAX_SLOPE * 1.08) {
        const sx = (-gx / g) * 6 * dt, sz = (-gz / g) * 6 * dt;
        if (!this.world.blocked(x + sx, z + sz, this.feet.y)) { this.feet.x += sx; this.feet.z += sz; }
      }
    }
    // 垂直
    this.vy -= 26 * dt;
    this.feet.y += this.vy * dt;
    const g = this.world.groundAt(this.feet.x, this.feet.z, this.feet.y);
    if (this.feet.y <= g) {
      this.feet.y = g; this.vy = 0; this.grounded = true;
    } else if (this.grounded && this.vy <= 0 && this.feet.y - g < 0.6) {
      this.feet.y = g; this.vy = 0;
    } else {
      this.grounded = false;
    }
  }

  private tryMove(dx: number, dz: number, forced = false): boolean {
    if (dx === 0 && dz === 0) return true;
    const x = this.feet.x + dx, z = this.feet.z + dz;
    if (this.world.blocked(x, z, this.feet.y)) return false;
    if (this.world.terrain.waterDepthAt(x, z) > 1.1 && this.world.terrain.waterDepthAt(this.feet.x, this.feet.z) <= 1.1) return false;
    if (forced) { this.feet.x = x; this.feet.z = z; return true; }
    // 空中也一样：前方地面高过脚底 STEP 就是撞墙，不能吸附上去
    if (!this.grounded && this.world.groundAt(x, z, this.feet.y) > this.feet.y + STEP + 0.01) return false;
    if (this.grounded) {
      const g0 = this.feet.y;
      const g1 = this.world.groundAt(x, z, this.feet.y);
      const rise = g1 - g0;
      const run = Math.hypot(dx, dz);
      // 台阶（可站立顶面）允许 STEP；地形本身按坡度限制
      const terrainRise = this.world.terrain.heightAt(x, z) - this.world.terrain.heightAt(this.feet.x, this.feet.z);
      if (rise > STEP + 0.01) return false;
      if (g1 <= this.world.terrain.heightAt(x, z) + 0.01 && terrainRise > 0.02 && terrainRise / run > MAX_SLOPE) return false;
    }
    this.feet.x = x; this.feet.z = z;
    return true;
  }
}
