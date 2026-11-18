/**
 * 熔岩 v2 的纯逻辑（Unity G/World/LavaBody.cs 一比一：LavaTuning / LavaBody / LavaGeometry / LavaTide / LavaLevelDriver /
 * LavaContactTracker / LavaEnemyRule，外加 LavaVolume.BuildMesh 的顶点数据）。不依赖 three、不依赖场景：测试直接构造。
 *
 * 坐标：网页世界坐标（Unity x 取反）。导出器把盒的朝向 yaw 也取了反（mechanisms.json 的 yaw = −Unity eulerAngles.y），
 * 本地 x 方向的量（流向 flow.x）取反，所以 ToLocal / ToWorld 的公式和 C# 原样一致（推导见 docs/threejs-migration.md 4.5）。
 */

export interface V3 { x: number; y: number; z: number }

export type LavaShape = 'box' | 'disc';

/** 熔岩判定的数值（Unity LavaTuning；= Three.js 旧 LAVA 表判定用的部分） */
export const LavaTuning = {
  /** 脚底离熔岩面多高以内算「站在熔岩上」 */
  StandRise: 0.3,
  /** 脚底低于熔岩面这么多时不着地也算掉进熔岩 */
  Submerge: 0.15,
  /** 安全落脚点离熔岩至少多远 */
  SafeMargin: 1,
  /** 敌人被击退后多长时间内落进熔岩算「被打进去」 */
  KnockWindow: 0.6,
  /** 一帧水平位移超过这么多算传送 */
  TeleportStep: 4,
  /** 扫掠判定的采样间距 */
  SweepStep: 0.25,
  /** 熔岩面画在判定高度上方多少 */
  SurfaceLift: 0.04,
  /** 涨潮高出基准面多少时导航挖洞 */
  CarveRise: 0.35,
  /** 查地面时从熔岩面往上多高开始往下打射线 */
  ProbeTop: 16,
} as const;

const DEG2RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
/** Unity Mathf.Approximately */
export function approximately(a: number, b: number): boolean {
  return Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), Number.EPSILON * 8);
}
/** Unity Mathf.Repeat */
export function repeat(t: number, length: number): number {
  return clamp(t - Math.floor(t / length) * length, 0, length);
}
/** Unity Mathf.MoveTowards */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  return Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta;
}

/**
 * 一片熔岩的判定体：平面形状（盒 / 圆，绕 Y 转 yaw 度）+ 熔岩面 level + 往下 depth 米。
 * 「某点是不是熔岩」= 平面上在形状里，且高度在 [level − depth, level + rise] 之间。
 */
export class LavaBody {
  shape: LavaShape = 'box';
  /** 形状中心（只用 XZ） */
  center: V3 = { x: 0, y: 0, z: 0 };
  /** 绕 Y 的朝向（度） */
  yaw = 0;
  /** 盒：宽 × 长（全长）；圆：x = 半径 */
  size: [number, number] = [10, 10];
  level = 0;
  depth = 3;
  enabled = true;
  /** 来源（LavaVolume 运行时；测试里为 null） */
  owner: unknown = null;
  private cachedYaw = NaN;
  private cos = 1;
  private sin = 0;

  constructor(shape: LavaShape = 'box', center: V3 = { x: 0, y: 0, z: 0 }, size: [number, number] = [10, 10], level = 0, yaw = 0, depth = 3) {
    this.shape = shape;
    this.center = { x: center.x, y: center.y, z: center.z };
    this.size = [size[0], size[1]];
    this.level = level;
    this.yaw = yaw;
    this.depth = depth;
  }

  private trig(): void {
    if (this.yaw === this.cachedYaw) return;
    this.cachedYaw = this.yaw;
    const r = this.yaw * DEG2RAD;
    this.cos = Math.cos(r);
    this.sin = Math.sin(r);
  }

  /** 世界 XZ → 形状局部坐标 */
  toLocal(x: number, z: number): [number, number] {
    this.trig();
    const dx = x - this.center.x, dz = z - this.center.z;
    return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos];
  }

  /** 形状局部坐标 → 世界（y 取熔岩面） */
  toWorld(lx: number, lz: number): V3 {
    this.trig();
    return { x: this.center.x + lx * this.cos + lz * this.sin, y: this.level, z: this.center.z - lx * this.sin + lz * this.cos };
  }

  /** 盒的半宽 / 半长；圆的 (半径, 半径) */
  get halfExtents(): [number, number] {
    return this.shape === 'disc' ? [this.size[0], this.size[0]] : [this.size[0] * 0.5, this.size[1] * 0.5];
  }

  /** 到形状边缘的距离：里面为正，外面为负 */
  inset(x: number, z: number): number {
    const [lx, lz] = this.toLocal(x, z);
    if (this.shape === 'disc') return this.size[0] - Math.hypot(lx, lz);
    const ax = Math.abs(lx) - this.size[0] * 0.5, az = Math.abs(lz) - this.size[1] * 0.5;
    if (ax <= 0 && az <= 0) return -Math.max(ax, az);
    return -Math.hypot(Math.max(ax, 0), Math.max(az, 0));
  }

  contains(x: number, z: number, margin = 0): boolean {
    return this.inset(x, z) >= -margin;
  }

  /** 形状上离 (x, z) 最近的点（y 取熔岩面） */
  closestPoint(x: number, z: number): V3 {
    let [lx, lz] = this.toLocal(x, z);
    if (this.shape === 'disc') {
      const m = Math.hypot(lx, lz);
      if (m > this.size[0]) { lx = lx / m * this.size[0]; lz = lz / m * this.size[0]; }
    } else {
      const hx = this.size[0] * 0.5, hz = this.size[1] * 0.5;
      lx = clamp(lx, -hx, hx);
      lz = clamp(lz, -hz, hz);
    }
    return this.toWorld(lx, lz);
  }

  touches(feet: V3, rise: number = LavaTuning.StandRise): boolean {
    return this.enabled && feet.y <= this.level + rise && feet.y >= this.level - this.depth && this.contains(feet.x, feet.z);
  }

  submerged(feet: V3): boolean {
    return this.enabled && feet.y < this.level - LavaTuning.Submerge && feet.y >= this.level - this.depth && this.contains(feet.x, feet.z);
  }

  near(feet: V3, margin: number): boolean {
    return this.enabled && feet.y <= this.level + LavaTuning.StandRise + margin && feet.y >= this.level - this.depth - margin
      && this.contains(feet.x, feet.z, margin);
  }

  /** 世界 XZ 的外接矩形 { x, z, width, height }（x / z = 最小角） */
  get worldRect(): { x: number; z: number; width: number; height: number } {
    const [hx, hz] = this.halfExtents;
    if (this.shape === 'disc') return { x: this.center.x - hx, z: this.center.z - hz, width: hx * 2, height: hz * 2 };
    this.trig();
    const ex = Math.abs(hx * this.cos) + Math.abs(hz * this.sin), ez = Math.abs(hx * this.sin) + Math.abs(hz * this.cos);
    return { x: this.center.x - ex, z: this.center.z - ez, width: ex * 2, height: ez * 2 };
  }
}

/** 地面探测：(x, z) 处、高度 [bottom, top] 之间最高的朝上表面；没有返回 null */
export type LavaGroundProbe = (x: number, z: number, top: number, bottom: number) => number | null;

/** 一组熔岩的查询（Unity LavaGeometry） */
export const LavaGeometry = {
  touches(bodies: readonly LavaBody[], feet: V3, rise: number = LavaTuning.StandRise): boolean {
    for (const b of bodies) if (b && b.touches(feet, rise)) return true;
    return false;
  },

  submerged(bodies: readonly LavaBody[], feet: V3): boolean {
    for (const b of bodies) if (b && b.submerged(feet)) return true;
    return false;
  },

  near(bodies: readonly LavaBody[], feet: V3, margin: number): boolean {
    for (const b of bodies) if (b && b.near(feet, margin)) return true;
    return false;
  },

  /** (x, z) 上方哪片熔岩的熔岩面（几片重叠取最高的）；不在任何熔岩上返回 null */
  surfaceAt(bodies: readonly LavaBody[], x: number, z: number): { y: number; body: LavaBody } | null {
    let y = -Infinity;
    let body: LavaBody | null = null;
    for (const b of bodies) {
      if (!b || !b.enabled || !b.contains(x, z) || b.level <= y) continue;
      y = b.level;
      body = b;
    }
    return body ? { y, body } : null;
  },

  /** 线段 a → b（脚底）是否经过熔岩：每 SweepStep 米采一个点 */
  sweep(bodies: readonly LavaBody[], a: V3, b: V3, rise: number = LavaTuning.StandRise): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / LavaTuning.SweepStep));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (LavaGeometry.touches(bodies, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, rise)) return true;
    }
    return false;
  },

  /**
   * (x, z) 是不是熔岩：在某片熔岩的形状里，且那里的地面不高出熔岩面 standRise；下面什么都没有也算。
   * groundY = 地面高度（没有地面时是熔岩面；不是熔岩时 NaN）
   */
  isLavaAt(bodies: readonly LavaBody[], x: number, z: number, probe: LavaGroundProbe | null): { lava: boolean; groundY: number } {
    const s = LavaGeometry.surfaceAt(bodies, x, z);
    if (!s) return { lava: false, groundY: NaN };
    const g = probe ? probe(x, z, s.y + LavaTuning.ProbeTop, s.y - s.body.depth - 0.5) : null;
    if (g === null || g === undefined) return { lava: true, groundY: s.y };
    return { lava: LavaGeometry.touches(bodies, { x, y: g, z }), groundY: g };
  },

  /** 从熔岩里 from 出发，最近的能站的非熔岩点（一圈圈往外找） */
  nearestShore(bodies: readonly LavaBody[], from: V3, maxDist: number, probe: LavaGroundProbe | null, step = 0.5): V3 | null {
    if (!(maxDist > 0) || !probe) return null;
    step = Math.max(0.1, step);
    for (let r = step; r <= maxDist + 1e-4; r += step) {
      const n = Math.max(12, Math.ceil(r * Math.PI * 2));
      const a0 = r * 0.37;
      for (let k = 0; k < n; k++) {
        const a = a0 + k * Math.PI * 2 / n;
        const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
        if (LavaGeometry.isLavaAt(bodies, x, z, probe).lava) continue;
        let top = from.y + LavaTuning.ProbeTop;
        const s = LavaGeometry.surfaceAt(bodies, x, z);
        if (s) top = Math.max(top, s.y + LavaTuning.ProbeTop);
        const g = probe(x, z, top, from.y - 40);
        if (g === null || g === undefined) continue;
        return { x, y: g, z };
      }
    }
    return null;
  },

  /** 从熔岩点 from 朝 to 直线走，第一个不是熔岩的点 */
  bankToward(bodies: readonly LavaBody[], from: V3, to: V3, maxDist: number, probe: LavaGroundProbe | null): V3 | null {
    let dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3 || !probe) return null;
    dx /= len;
    dz /= len;
    const step = LavaTuning.SweepStep, reach = Math.min(maxDist, len + 1);
    for (let s = step; s <= reach + 1e-4; s += step) {
      const x = from.x + dx * s, z = from.z + dz * s;
      if (LavaGeometry.isLavaAt(bodies, x, z, probe).lava) continue;
      const g = probe(x, z, from.y + LavaTuning.ProbeTop, from.y - 40);
      if (g === null || g === undefined) continue;
      return { x, y: g, z };
    }
    return null;
  },

  /** 从岸上 from 出发，maxDist 内最近的熔岩点与同一方向上紧挨着它的岸边点 */
  nearestLava(bodies: readonly LavaBody[], from: V3, maxDist: number, probe: LavaGroundProbe | null, step = 0.75): { lava: V3; bank: V3 } | null {
    if (bodies.length === 0) return null;
    const here = LavaGeometry.isLavaAt(bodies, from.x, from.z, probe);
    if (here.lava) {
      const p = { x: from.x, y: Number.isNaN(here.groundY) ? from.y : here.groundY, z: from.z };
      return { lava: p, bank: { ...p } };
    }
    let any = false;
    for (const b of bodies) if (b && b.enabled && b.inset(from.x, from.z) >= -maxDist) { any = true; break; }
    if (!any) return null;
    step = Math.max(0.1, step);
    for (let r = step; r <= maxDist + 1e-4; r += step) {
      const n = Math.max(16, Math.ceil(r * Math.PI * 2 / 1.2));
      for (let k = 0; k < n; k++) {
        const a = k * Math.PI * 2 / n;
        const cx = Math.cos(a), cz = Math.sin(a);
        const x = from.x + cx * r, z = from.z + cz * r;
        const hit = LavaGeometry.isLavaAt(bodies, x, z, probe);
        if (!hit.lava) continue;
        const lava = { x, y: hit.groundY, z };
        let bank: V3 = { x: from.x, y: from.y, z: from.z };
        for (let s = r - LavaTuning.SweepStep; s > 0; s -= LavaTuning.SweepStep) {
          const bx = from.x + cx * s, bz = from.z + cz * s;
          if (LavaGeometry.isLavaAt(bodies, bx, bz, probe).lava) continue;
          const bg = probe ? probe(bx, bz, from.y + LavaTuning.ProbeTop, from.y - 40) : null;
          bank = bg !== null && bg !== undefined ? { x: bx, y: bg, z: bz } : { x: bx, y: from.y, z: bz };
          break;
        }
        return { lava, bank };
      }
    }
    return null;
  },
};

/** 熔岩面的涨落阶段 */
export type LavaTidePhase = 'low' | 'warning' | 'rising' | 'high' | 'falling';

/** 自动涨落（Unity LavaTide）：低位 → 预警 → 涨 → 高位 → 退，循环；offset 错开相位 */
export interface LavaTide {
  enabled: boolean;
  height: number;
  lowHold: number;
  warn: number;
  rise: number;
  highHold: number;
  fall: number;
  offset: number;
}

export const LavaTides = {
  none(): LavaTide {
    return { enabled: false, height: 0, lowHold: 0, warn: 0, rise: 0, highHold: 0, fall: 0, offset: 0 };
  },
  /** 3-3 熔铜渠的默认节奏：低 8 s、预警 1.5 s、2.5 s 涨 1.2 m、高 5 s、3 s 退 */
  channel(): LavaTide {
    return { enabled: true, height: 1.2, lowHold: 8, warn: 1.5, rise: 2.5, highHold: 5, fall: 3, offset: 0 };
  },
  period(t: LavaTide): number {
    return Math.max(0, t.lowHold) + Math.max(0, t.warn) + Math.max(0, t.rise) + Math.max(0, t.highHold) + Math.max(0, t.fall);
  },
  ease(x: number): number {
    x = clamp01(x);
    return x * x * (3 - 2 * x);
  },
  /** t 秒时的涨幅 0..1 与阶段 */
  sample(t: LavaTide, time: number): { k: number; phase: LavaTidePhase } {
    const period = LavaTides.period(t);
    if (!(period > 0)) return { k: 0, phase: 'low' };
    let u = repeat(time + t.offset, period);
    const lo = Math.max(0, t.lowHold), w = Math.max(0, t.warn), up = Math.max(0, t.rise), hi = Math.max(0, t.highHold), dn = Math.max(0, t.fall);
    if (u < lo) return { k: 0, phase: 'low' };
    u -= lo;
    if (u < w) return { k: 0, phase: 'warning' };
    u -= w;
    if (u < up) return { k: LavaTides.ease(u / up), phase: 'rising' };
    u -= up;
    if (u < hi) return { k: 1, phase: 'high' };
    u -= hi;
    return { k: dn > 0 ? 1 - LavaTides.ease(clamp01(u / dn)) : 0, phase: 'falling' };
  },
};

/** 熔岩面高度的推进（Unity LavaLevelDriver）：脚本 moveTo 优先，否则按 tide 自动涨落 */
export class LavaLevelDriver {
  tide: LavaTide;
  readonly baseLevel: number;
  level: number;
  /** 正在去的高度（预警中也已经是新目标） */
  target: number;
  phase: LavaTidePhase = 'low';
  scripted = false;
  private from = 0;
  private warnLeft = 0;
  private moveT = 0;
  private moveTime = 0;
  private clock = 0;

  constructor(baseLevel: number, tide: LavaTide = LavaTides.none()) {
    this.baseLevel = this.level = this.target = baseLevel;
    this.tide = tide;
  }

  /** 预警 warn 秒后，seconds 秒内移到 target（缓入缓出） */
  moveTo(target: number, seconds: number, warn = 0): void {
    if (!Number.isFinite(target)) return;
    this.scripted = true;
    this.from = this.level;
    this.target = target;
    this.warnLeft = Math.max(0, Number.isFinite(warn) ? warn : 0);
    this.moveTime = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.moveT = 0;
    this.phase = this.warnLeft > 0 ? 'warning' : this.moving();
  }

  snap(level: number): void {
    if (!Number.isFinite(level)) return;
    this.scripted = true;
    this.from = this.target = this.level = level;
    this.warnLeft = this.moveT = this.moveTime = 0;
    this.phase = this.settled();
  }

  releaseToTide(): void {
    this.scripted = false;
    this.clock = 0;
  }

  private moving(): LavaTidePhase { return this.target >= this.from ? 'rising' : 'falling'; }
  private settled(): LavaTidePhase { return this.level > this.baseLevel + 0.01 ? 'high' : 'low'; }

  /** 推进 dt 秒；返回熔岩面高度是否变了 */
  step(dt: number): boolean {
    if (!(dt > 0)) return false;
    const before = this.level;
    if (this.scripted) {
      if (this.warnLeft > 0) {
        this.warnLeft -= dt;
        if (this.warnLeft > 0) {
          this.phase = 'warning';
          return false;
        }
        dt = -this.warnLeft;
        this.warnLeft = 0;
      }
      if (this.moveT < this.moveTime) {
        this.moveT = Math.min(this.moveTime, this.moveT + dt);
        this.level = this.from + (this.target - this.from) * LavaTides.ease(this.moveT / this.moveTime);
      } else this.level = this.target;
      this.phase = approximately(this.level, this.target) && this.moveT >= this.moveTime ? this.settled() : this.moving();
    } else if (this.tide.enabled && LavaTides.period(this.tide) > 0) {
      this.clock += dt;
      const s = LavaTides.sample(this.tide, this.clock);
      this.phase = s.phase;
      this.level = this.baseLevel + this.tide.height * s.k;
      this.target = s.phase === 'warning' || s.phase === 'rising' || s.phase === 'high' ? this.baseLevel + this.tide.height : this.baseLevel;
    }
    return !approximately(this.level, before);
  }

  /** 涨着或将要涨过基准面 CarveRise：盖住的地面应当从导航上挖掉 */
  get flooding(): boolean {
    return Math.max(this.level, this.target) > this.baseLevel + LavaTuning.CarveRise;
  }
}

/** 玩家踩进熔岩的判定（Unity LavaContactTracker） */
export class LavaContactTracker {
  private prev: V3 = { x: 0, y: 0, z: 0 };
  private prevGrounded = false;
  private valid = false;

  reset(): void {
    this.valid = false;
    this.prevGrounded = false;
  }

  /** 推进一帧：feet = 脚底，grounded = 贴地。返回这一帧是否踩进熔岩 */
  step(bodies: readonly LavaBody[], feet: V3, grounded: boolean): boolean {
    let touching = (grounded && LavaGeometry.touches(bodies, feet)) || LavaGeometry.submerged(bodies, feet);
    if (!touching && grounded && this.prevGrounded && this.valid) {
      const step = Math.hypot(feet.x - this.prev.x, feet.z - this.prev.z);
      if (step < LavaTuning.TeleportStep && LavaGeometry.sweep(bodies, this.prev, feet)) touching = true;
    }
    this.prev = { x: feet.x, y: feet.y, z: feet.z };
    this.prevGrounded = grounded;
    this.valid = true;
    return touching;
  }
}

export type LavaEnemyAction = 'none' | 'burn' | 'pushBack';

/** 敌人与熔岩的规则（Unity LavaEnemyRule） */
export const LavaEnemyRule = {
  knocked(launchedUp: boolean, knockedBack: boolean): boolean {
    return launchedUp || knockedBack;
  },
  decide(immune: boolean, inLava: boolean, now: number, knockAt: number): LavaEnemyAction {
    if (immune || !inLava) return 'none';
    return now - knockAt <= LavaTuning.KnockWindow ? 'burn' : 'pushBack';
  },
};

/** 掉进危险区的处理参数（Unity HazardSpec） */
export interface HazardSpec {
  burst: number;
  tick: number;
  tickTimes: readonly number[];
  sinkTime: number;
  grace: number;
  element: 'none' | 'fire';
  /** 闪屏颜色（r, g, b, a） */
  flash: readonly [number, number, number, number];
  sound: string;
}

export const HazardSpecs = {
  /** 熔岩：12% + 两跳 1.5%（0.2 / 0.4 s），0.5 s 后托回，1 s 无敌 */
  lava(): HazardSpec {
    return { burst: 0.12, tick: 0.015, tickTimes: [0.2, 0.4], sinkTime: 0.5, grace: 1, element: 'fire', flash: [1, 0.42, 0.1, 0.45], sound: 'skill_fire' };
  },
  /** 掉出世界：立刻托回，扣 10%，1 s 无敌 */
  fall(): HazardSpec {
    return { burst: 0.1, tick: 0, tickTimes: [], sinkTime: 0, grace: 1, element: 'none', flash: [0.05, 0.04, 0.04, 0.7], sound: 'land' };
  },
};

// ───────────── 熔岩面网格（LavaVolume.BuildMesh） ─────────────

/** 网格一格最大边长（米） */
export const LAVA_MESH_CELL = 4;

export interface LavaMeshData {
  /** 局部坐标（网页：本地 x 已镜像），y = 0 */
  positions: Float32Array;
  /** 三角形（从上面看是正面：cross(b − a, c − a).y > 0） */
  indices: Uint32Array;
  /** uv0 = Unity 局部 XZ（米） */
  uv: Float32Array;
  /** uv1 = (半宽, 半长, 形状 0 盒 / 1 圆, 岸边按深度 0 / 1) */
  info: Float32Array;
  /** uv2 = (流动 x, 流动 z, 相位种子, 0) */
  flow: Float32Array;
}

/**
 * 熔岩面网格（Unity LavaVolume.BuildMesh 的顶点数据）：盒是 size 大小的网格，圆是同心环。
 * flow 是网页的流向（导出器已把本地 x 取反）；网格顶点按网页局部坐标出（x = −Unity 局部 x），uv0 仍是 Unity 局部 XZ（着色器的图案坐标）
 */
export function buildLavaMesh(shape: LavaShape, size: readonly [number, number], depthShore: boolean, flow: readonly [number, number] = [0, 0]): LavaMeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const half: [number, number] = shape === 'disc' ? [size[0], size[0]] : [size[0] * 0.5, size[1] * 0.5];
  if (shape === 'disc') {
    const r = Math.max(0.1, size[0]);
    const rings = Math.max(1, Math.ceil(r / LAVA_MESH_CELL));
    const segs = clamp(Math.ceil(r * Math.PI * 2 / LAVA_MESH_CELL), 24, 256);
    verts.push(0, 0);
    for (let i = 1; i <= rings; i++) {
      const rr = r * i / rings;
      for (let k = 0; k < segs; k++) {
        const a = k * Math.PI * 2 / segs;
        verts.push(Math.sin(a) * rr, Math.cos(a) * rr);
      }
    }
    for (let k = 0; k < segs; k++) tris.push(0, 1 + k, 1 + (k + 1) % segs);
    for (let i = 1; i < rings; i++) {
      const inner = 1 + (i - 1) * segs, outer = 1 + i * segs;
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % segs;
        const a = inner + k, b = inner + k1, c = outer + k, d = outer + k1;
        tris.push(a, c, d, a, d, b);
      }
    }
  } else {
    const w = Math.max(0.1, size[0]), l = Math.max(0.1, size[1]);
    const nx = clamp(Math.ceil(w / LAVA_MESH_CELL), 1, 128), nz = clamp(Math.ceil(l / LAVA_MESH_CELL), 1, 128);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) verts.push(-w * 0.5 + w * i / nx, -l * 0.5 + l * j / nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      tris.push(a, c, d, a, d, b);
    }
  }
  const n = verts.length / 2;
  const positions = new Float32Array(n * 3), uv = new Float32Array(n * 2), info = new Float32Array(n * 4), flowArr = new Float32Array(n * 4);
  const seed = repeat(half[0] * 0.731 + half[1] * 0.377, 1) * 10;
  for (let i = 0; i < n; i++) {
    const ux = verts[i * 2], uz = verts[i * 2 + 1];
    // Unity 局部 (ux, uz) → 网页局部 (−ux, uz)
    positions[i * 3] = -ux;
    positions[i * 3 + 2] = uz;
    // glTF 的 uv 纵向翻转（网页着色器 vLocal = (uv.x, 1 − uv.y)）
    uv[i * 2] = ux;
    uv[i * 2 + 1] = 1 - uz;
    info.set([half[0], half[1], shape === 'disc' ? 1 : 0, depthShore ? 1 : 0], i * 4);
    flowArr.set([flow[0], flow[1], seed, 0], i * 4);
  }
  // 镜像后绕向反过来：每个三角形交换后两个顶点，保持从上面看是正面
  for (let i = 0; i < tris.length; i += 3) {
    const t = tris[i + 1];
    tris[i + 1] = tris[i + 2];
    tris[i + 2] = t;
  }
  return { positions, indices: Uint32Array.from(tris), uv, info, flow: flowArr };
}
