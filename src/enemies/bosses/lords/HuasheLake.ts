/**
 * 圣湖（Unity Huashe/HuasheLake.cs；化蛇的擂台；chuanzang-combat-v1.md 4.3「水」）：水位、游线、涨水面。纯逻辑（地面 / 水体由调用方注入），node 测试直接测。
 *   · 湖：场景里名为 Water_HolyLake 的水体（或包住擂台中心的那片水）——水面高度 = 基础水位，水平范围（含朝向）= 湖的椭圆；
 *     没有湖时（测试场）按擂台中心、地面高度当一片「虚拟湖」（基础水位 = 地面，半轴 = 擂台半径 × 0.62 / 0.48）。
 *   · 游线：绕湖心游。真湖沿每条射线实测湖岸（地面高出水面 0.6 m），游线取 岸 − 5.5 m（前后平滑；夹在 0.62 倍椭圆和 岸 − 3 m 之间）；
 *     量不到岸用椭圆 max(湖半轴 × 0.62, 湖半轴 − 5.5 m)。湖心岛（4-1 的岛心由关卡给）不在游线上：离岛不到 岛半径 + 3 m 的点往外推开。
 *     游速按网页的线速度（0.62 倍椭圆上的角速度 × 半径）折算。
 *   · 水位 = 基础 + 常驻涨水（二阶段 +1.2 m）+ 吼叫涨水（+0.8 m）。
 * 网页的朝向：yaw = 水体四元数绕 Y 的角（网页世界，Unity 的镜像）——椭圆对称，镜像后形状不变，游线参数 a 只是方向反过来。
 */
import * as THREE from 'three';

export const LAKE_NAME = 'Water_HolyLake';
/** 游线离湖岸（米）；网页 0.62 倍更贴岸时取 0.62 倍 */
export const SHORE_GAP = 5.5, MIN_SHORE_GAP = 3, ISLAND_CLEAR = 3;
const SAMPLES = 180;
const TAU = Math.PI * 2;

/** 湖水体（场景里的水：中心、尺寸、朝向） */
export interface LakeWater {
  name: string;
  center: THREE.Vector3;
  scale: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** 量地面：(x, z) 处、从 fromY 往下的地面高度（没有地面返回 null） */
export type GroundProbe = (x: number, z: number, fromY: number) => number | null;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class HuasheLake {
  /** 湖心（湖椭圆的中心，水面高度） */
  readonly center = new THREE.Vector3();
  readonly swimCenter = new THREE.Vector3();
  baseLevel = 0;
  rx = 30;
  rz = 22;
  /** 湖的朝向（弧度，网页 yaw） */
  yaw = 0;
  /** 场景里摆了湖（false = 测试场的虚拟湖） */
  real = false;
  swimRx = 0;
  swimRz = 0;
  swimRateScale = 1;
  island: THREE.Vector3 | null = null;
  islandRadius = 0;
  islandPushed = 0;
  shoreMeasured = 0;
  /** 常驻涨水 / 吼叫涨水（米） */
  flood = 0;
  surge = 0;
  private readonly swim: THREE.Vector3[] = [];
  private readonly bottom: number[] = [];

  /**
   * @param arenaCenter 擂台中心（地面高）；arenaRadius 擂台半径
   * @param water 场景里的湖（null = 虚拟湖）
   * @param ground 量地面（null = 平地，虚拟湖）
   * @param island 湖心岛的岛心（水平位置；null = 没有岛）
   */
  constructor(arenaCenter: THREE.Vector3, arenaRadius: number, water: LakeWater | null, readonly ground: GroundProbe | null, island: THREE.Vector3 | null = null) {
    if (water) {
      this.real = true;
      this.baseLevel = water.center.y + Math.abs(water.scale.y) / 2;
      this.center.set(water.center.x, this.baseLevel, water.center.z);
      this.rx = Math.abs(water.scale.x) / 2;
      this.rz = Math.abs(water.scale.z) / 2;
      this.yaw = _e.setFromQuaternion(_q.copy(water.quaternion), 'YXZ').y;
    } else {
      this.center.copy(arenaCenter);
      this.baseLevel = arenaCenter.y;
      this.rx = arenaRadius * 0.62;
      this.rz = arenaRadius * 0.48;
      this.yaw = 0;
    }
    this.swimCenter.copy(this.center);
    if (island && this.real) {
      this.island = new THREE.Vector3(island.x, this.center.y, island.z);
      this.islandRadius = this.measureIsland(this.island);
    }
    this.swimRx = Math.max(this.rx * 0.62, this.rx - SHORE_GAP);
    this.swimRz = Math.max(this.rz * 0.62, this.rz - SHORE_GAP);
    this.swimRateScale = (this.rx + this.rz) * 0.62 / Math.max(1, this.swimRx + this.swimRz);
    this.buildSwimLine();
  }

  get level(): number {
    return this.baseLevel + this.flood + this.surge;
  }

  /** 椭圆局部 (lx, lz) → 世界偏移（绕 Y 转 yaw） */
  private rot(lx: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(lx, 0, lz).applyAxisAngle(Y, this.yaw);
  }

  /** 世界偏移 → 椭圆局部 */
  private unrot(dx: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(dx, 0, dz).applyAxisAngle(Y, -this.yaw);
  }

  private groundAt(x: number, z: number): number | null {
    return this.ground ? this.ground(x, z, this.baseLevel + 30) : null;
  }

  /** 岛的半径：从岛心往 16 个方向走，地面低于基础水位 0.5 m 的地方为岸（最多 30 m） */
  private measureIsland(c: THREE.Vector3): number {
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      const dx = Math.sin(a), dz = Math.cos(a);
      let r = 0.5;
      for (; r < 30; r += 0.5) {
        const g = this.groundAt(c.x + dx * r, c.z + dz * r);
        if (g === null || g < this.baseLevel - 0.5) break;
      }
      sum += r;
    }
    return sum / 16;
  }

  private land(x: number, z: number): boolean {
    const g = this.groundAt(x, z);
    return g !== null && g > this.baseLevel + 0.6;
  }

  /** 从 c 沿 dir 往外，第一处地面高出基础水位 0.6 m 的距离（湖心岛那一圈跳过）；找不到为 −1 */
  private shoreAlong(c: THREE.Vector3, dx: number, dz: number, from: number, to: number): number {
    let prev = -1;
    for (let r = from; r <= to; r += 1) {
      const x = c.x + dx * r, z = c.z + dz * r;
      if (this.island && Math.hypot(x - this.island.x, z - this.island.z) < this.islandRadius + 1.5) {
        prev = -1;
        continue;
      }
      if (!this.land(x, z)) {
        prev = r;
        continue;
      }
      if (prev < 0) return r;
      let lo = prev, hi = r;
      for (let k = 0; k < 2; k++) {
        const mid = (lo + hi) * 0.5;
        if (this.land(c.x + dx * mid, c.z + dz * mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    return -1;
  }

  /** 游线采样：椭圆 → 真湖按实测湖岸贴过去 → 不出湖 → 离岛 ≥ 岛半径 + 3 m；顺带记下湖底高度 */
  private buildSwimLine(): void {
    this.islandPushed = 0;
    this.shoreMeasured = 0;
    const keep = Math.min(this.islandRadius + ISLAND_CLEAR, Math.min(this.rx, this.rz) * 0.5);
    const dirs: THREE.Vector3[] = [];
    let rad: number[] = [];
    const cap: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const a = i * TAU / SAMPLES;
      const off = this.rot(Math.cos(a) * this.swimRx, Math.sin(a) * this.swimRz, new THREE.Vector3());
      const len = off.length();
      rad.push(len);
      cap.push(Infinity);
      dirs.push(len > 1e-3 ? off.divideScalar(len) : new THREE.Vector3(0, 0, 1));
      if (!this.real) continue;
      const web = this.rot(Math.cos(a) * this.rx * 0.62, Math.sin(a) * this.rz * 0.62, _v).length();
      const shore = this.shoreAlong(this.swimCenter, dirs[i].x, dirs[i].z, web * 0.5, Math.max(this.rx, this.rz) * 1.6);
      if (shore < 0) continue;
      this.shoreMeasured++;
      cap[i] = shore - MIN_SHORE_GAP;
      rad[i] = Math.min(Math.max(shore - SHORE_GAP, Math.min(web, shore - MIN_SHORE_GAP)), shore - MIN_SHORE_GAP);
    }
    if (this.shoreMeasured > 0) {
      const sm: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        let s = 0;
        for (let k = -4; k <= 4; k++) s += rad[(i + k + SAMPLES) % SAMPLES];
        // 平滑之后再按本条射线的岸收一次：岸边凸出来的地方不能被两边拉出去
        sm.push(Math.min(s / 9, cap[i]));
      }
      rad = sm;
    }
    this.swim.length = 0;
    this.bottom.length = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const p = new THREE.Vector3().copy(this.swimCenter).addScaledVector(dirs[i], rad[i]);
      this.insideLake(p, MIN_SHORE_GAP);
      if (this.island) {
        const dx = p.x - this.island.x, dz = p.z - this.island.z;
        const d = Math.hypot(dx, dz);
        if (d < keep) {
          const ux = d > 1e-2 ? dx / d : dirs[i].x, uz = d > 1e-2 ? dz / d : dirs[i].z;
          p.set(this.island.x + ux * keep, p.y, this.island.z + uz * keep);
          this.insideLake(p, MIN_SHORE_GAP);
          this.islandPushed++;
        }
      }
      p.y = this.center.y;
      this.swim.push(p);
      const g = this.groundAt(p.x, p.z);
      this.bottom.push(g ?? this.baseLevel - 10);
    }
  }

  /** 把一点收回湖椭圆里（离岸至少 gap 米，按较短半轴折算） */
  private insideLake(p: THREE.Vector3, gap: number): THREE.Vector3 {
    const l = this.unrot(p.x - this.center.x, p.z - this.center.z, _v);
    const k = 1 - gap / Math.max(1, Math.min(this.rx, this.rz));
    const r = Math.sqrt((l.x / this.rx) ** 2 + (l.z / this.rz) ** 2);
    if (r <= k || r < 1e-4) return p;
    const w = this.rot(l.x * k / r, l.z * k / r, _v);
    p.x = this.center.x + w.x;
    p.z = this.center.z + w.z;
    return p;
  }

  /** 游线上第 a（弧度）处的点（水面下 depth 米，潜下去时不穿湖底）；yaw 写切线朝向（度，网页 yaw） */
  swimPoint(a: number, depth: number, out = new THREE.Vector3(), yaw?: { deg: number }): THREE.Vector3 {
    const u = (((a / TAU) % 1) + 1) % 1 * SAMPLES;
    const i = Math.floor(u) % SAMPLES, j = (i + 1) % SAMPLES;
    const f = u - Math.floor(u);
    out.lerpVectors(this.swim[i], this.swim[j], f);
    if (yaw) {
      const n = this.swim[(i + 2) % SAMPLES], p = this.swim[(i + SAMPLES - 1) % SAMPLES];
      yaw.deg = Math.atan2(n.x - p.x, n.z - p.z) * 180 / Math.PI;
    }
    let y = this.level + depth;
    // 真湖里贴岸那一圈湖底只有 1.5–2 m：潜下去不穿湖底
    if (this.real && depth < -0.5) y = Math.max(y, Math.min(this.bottom[i] + (this.bottom[j] - this.bottom[i]) * f + 0.5, this.level - 0.5));
    out.y = y;
    return out;
  }

  /** 某点在游线上的参数（弧度，绕游线中心的那个方向） */
  angleOf(p: THREE.Vector3): number {
    const l = this.unrot(p.x - this.swimCenter.x, p.z - this.swimCenter.z, _v);
    return Math.atan2(l.z / Math.max(1, this.swimRz), l.x / Math.max(1, this.swimRx));
  }

  /** 在湖的椭圆 × k 以内（水平） */
  inLake(p: THREE.Vector3, k = 1): boolean {
    const l = this.unrot(p.x - this.center.x, p.z - this.center.z, _v);
    const a = l.x / (this.rx * k), b = l.z / (this.rz * k);
    return a * a + b * b < 1;
  }
}
