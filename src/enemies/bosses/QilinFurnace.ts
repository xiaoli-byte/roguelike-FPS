/**
 * 祝融炉心殿的几何（Unity Qilin/QilinFurnace.cs 逐项照搬；3-4，docs/level-design/maps/3-4.md）：熔池圆心（殿内地面）、熔池 / 殿墙 / 外环跑道半径、
 * 四条放射状熔岩渠的方位与渠上窄桥、四个象限（相邻两条渠的中线：锁扣、饮熔点、吊鼎的四个角都在象限中线上）、炉口（炭童）与高排烟口（神火飞鸦）。
 * 角度一律世界 yaw（度）：yaw = atan2(dx, dz)，0 = 北（+Z）、90 = 东（+X）；网页世界坐标与 Unity 一致（UnityLevelLibrary.unityPoint 不翻轴）。
 * 来源：Unity 由关卡构建器（Level_3_4.BuildArena）把它挂在首领场地上，场景导出器没写它——网页按场景文档的首领场地（bosses[0] 的圆心 / 地面）
 * 配 Level_3_4 的常量建一份（{@link QilinFurnace.level34}）；白盒炉心殿（inferno-5，QilinArena.locateFurnace 反推）换算过来（{@link QilinFurnace.fromLegacy}）；
 * 都没有时按场地尺寸推一份（{@link QilinFurnace.createRuntime}，同 Unity CreateRuntime）。
 * 另含两段纯计算（Unity 的 EditMode 测试守着）：熔流轮转的两条熔流带（QilinFlood.Strips）与焚身吐息的落点 / 扫向（BurnSweep.Plan）。
 */
import * as THREE from 'three';
import type { Furnace } from './QilinArena';

const DEG = Math.PI / 180;

/** Mathf.DeltaAngle：b − a 折到 (−180, 180] */
export function deltaAngle(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Mathf.Repeat(t, len) */
function repeat(t: number, len: number): number {
  return t - Math.floor(t / len) * len;
}

export class QilinFurnace {
  /** 熔池圆心（殿内地面） */
  readonly center = new THREE.Vector3();
  poolRadius = 7;
  wallRadius = 24;
  trackRadius = 20.8;
  bridgeInner = 10;
  bridgeOuter = 14;
  channelHalfWidth = 0.8;
  channelYaws: number[] = [-135, -45, 45, 135];
  /** 炉口（地面点）：饮熔时炭童从这里钻出 */
  mouths: THREE.Vector3[] = [];
  /** 高排烟口（空中点）：焚身的神火飞鸦 */
  vents: THREE.Vector3[] = [];
  /** 真的有炉心殿（场景 / 白盒），false = 按场地推的兜底 */
  found = true;

  constructor(center?: THREE.Vector3) {
    if (center) this.center.copy(center);
  }

  // ───────────── 来源 ─────────────

  /** 3-4 祝融炉心（Level_3_4：熔池 7、殿墙 24、跑道 20.8、窄桥 10–14、渠半宽 0.8 在对角线；炉口 ±72° 21.5 m、排烟口 ±110° 23.5 m 离地 12 m） */
  static level34(center: THREE.Vector3): QilinFurnace {
    const f = new QilinFurnace(center);
    for (const s of [-1, 1]) {
      f.mouths.push(f.point(s * 72, 21.5));
      f.vents.push(f.point(s * 110, 23.5).setY(center.y + 12));
    }
    return f;
  }

  /** 测试场 / 关卡没放时按场地推一份（Unity CreateRuntime）：殿墙 = 场地尺度，熔池 = 墙的 0.29，窄桥在池外 3–7 m，跑道离墙 3.2 m */
  static createRuntime(center: THREE.Vector3, extent: number): QilinFurnace {
    const f = new QilinFurnace(center);
    f.wallRadius = Math.max(8, extent);
    f.poolRadius = Math.min(9, Math.max(2, f.wallRadius * 0.29));
    f.bridgeInner = f.poolRadius + 3;
    f.bridgeOuter = f.poolRadius + 7;
    f.trackRadius = Math.max(f.bridgeOuter + 3, f.wallRadius - 3.2);
    f.found = false;
    return f;
  }

  /** 白盒炉心殿（QilinArena.locateFurnace 的弧度结果）换算过来 */
  static fromLegacy(l: Furnace): QilinFurnace {
    const f = new QilinFurnace(l.center);
    f.poolRadius = l.pool;
    f.wallRadius = l.wall;
    f.bridgeInner = l.bridge[0];
    f.bridgeOuter = l.bridge[1];
    f.trackRadius = Math.max(l.bridge[1] + 3, l.wall - 3.2);
    f.channelYaws = l.channels.map(a => a / DEG).sort((a, b) => a - b);
    f.found = l.found;
    return f;
  }

  // ───────────── 几何（Unity QilinFurnace 同名方法）─────────────

  get floorY(): number {
    return this.center.y;
  }

  get quadrantCount(): number {
    return this.channelYaws.length;
  }

  /** 第 i 个象限的中线方位（度）：在 channelYaws[i] 与 channelYaws[i + 1] 之间（最后一个跨过 180°） */
  quadrantYaw(i: number): number {
    const n = this.quadrantCount;
    if (n === 0) return 0;
    i = ((i % n) + n) % n;
    const a = this.channelYaws[i], b = i + 1 < n ? this.channelYaws[i + 1] : this.channelYaws[0] + 360;
    return deltaAngle(0, (a + b) * 0.5);
  }

  /** 圆心朝 yaw（度）方向、离圆心 dist 米的点（殿内地面高度） */
  point(yawDeg: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = yawDeg * DEG, c = this.center;
    return out.set(c.x + Math.sin(a) * dist, c.y, c.z + Math.cos(a) * dist);
  }

  yawOf(p: { x: number; z: number }): number {
    return Math.atan2(p.x - this.center.x, p.z - this.center.z) / DEG;
  }

  radiusOf(p: { x: number; z: number }): number {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z);
  }

  /** p 落在哪个象限（离哪条象限中线最近） */
  quadrantOf(p: { x: number; z: number }): number {
    const a = this.yawOf(p);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.quadrantCount; i++) {
      const d = Math.abs(deltaAngle(a, this.quadrantYaw(i)));
      if (d >= bestD) continue;
      bestD = d;
      best = i;
    }
    return best;
  }

  /** 俯视（北朝上）顺时针的下一个象限：+Z 北、+X 东，顺时针 = 方位角递增 */
  clockwiseNext(q: number): number {
    const n = this.quadrantCount;
    let best = q, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === q) continue;
      const d = repeat(this.quadrantYaw(i) - this.quadrantYaw(q), 360);
      if (d <= 0.01 || d >= bestD) continue;
      bestD = d;
      best = i;
    }
    return best;
  }

  /** 点 p 在熔岩渠上（池外、窄桥以外的那两段；margin 往外扩） */
  onChannel(p: { x: number; z: number }, margin = 0): boolean {
    const r = this.radiusOf(p);
    if (r < this.poolRadius || r > this.wallRadius + 1) return false;
    if (r > this.bridgeInner - this.channelHalfWidth && r < this.bridgeOuter + this.channelHalfWidth) return false;
    const a = this.yawOf(p) * DEG;
    for (const y of this.channelYaws) {
      const d = Math.abs(Math.sin(a - y * DEG)) * r;
      if (d <= this.channelHalfWidth + margin && Math.cos(a - y * DEG) > 0) return true;
    }
    return false;
  }

  /** 离 yaw 最近的炉口（没有返回 null） */
  mouthNear(yawDeg: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestD = Infinity;
    for (const m of this.mouths) {
      const d = Math.abs(deltaAngle(this.yawOf(m), yawDeg));
      if (d >= bestD) continue;
      bestD = d;
      best = m;
    }
    return best;
  }
}

// ───────────── 熔流轮转（Unity QilinFlood 的常量与 Strips）─────────────

export const FLOOD = {
  /** 预警、涨着（狂怒）、象限之间的间隔（狂怒）（秒） */
  WarnSeconds: 1.5, OnSeconds: 6, OnSecondsRage: 4, GapSeconds: 0.6, GapSecondsRage: 0.3,
  /** 涨宽后的熔岩带总宽（米，含渠本身）、平时沉在地面下多深、涨到地面以上多高、涨 / 退用时 */
  FloodWidth: 4, SunkDepth: 1.6, Rise: 0.03, RiseSeconds: 0.5, RecedeSeconds: 0.6,
  /** 熔流带内侧压进渠里多少（米）、外端伸进殿墙多少 */
  Overlap: 0.1, WallTuck: 0.8,
} as const;

/** 一条熔流带（世界坐标）：盒中心（殿内地面高度）、朝向（= 渠的方位，度）、宽 × 长；预警条带的起点、长、半宽；贴着的渠 */
export interface FloodStrip {
  center: THREE.Vector3;
  yaw: number;
  size: { x: number; y: number };
  from: THREE.Vector3;
  length: number;
  halfWidth: number;
  channel: number;
}

/**
 * 象限 q 的两条熔流带（Unity QilinFlood.Strips）：夹着它的两条渠各一条，朝象限一侧，
 * 横向从渠中线外 (渠半宽 − 0.1) 到 (4 − 渠半宽)，纵向从窄桥外端 + 0.15 到殿墙外 0.8（只淹外段，窄桥以内不动）
 */
export function floodStrips(f: QilinFurnace, q: number): FloodStrip[] {
  const out: FloodStrip[] = [];
  const n = f.quadrantCount;
  if (n === 0) return out;
  q = ((q % n) + n) % n;
  const r0 = f.bridgeOuter + 0.15, r1 = f.wallRadius + FLOOD.WallTuck;
  const near = Math.max(0, f.channelHalfWidth - FLOOD.Overlap), far = Math.max(near + 0.5, FLOOD.FloodWidth - f.channelHalfWidth);
  for (let k = 0; k < 2; k++) {
    const ch = (q + k) % n;
    const a = f.channelYaws[ch];
    // 渠在象限的低方位一侧（k = 0）→ 往方位增大的方向涨；高方位一侧（k = 1）→ 往方位减小的方向涨
    const s = k === 0 ? 1 : -1;
    const rad = a * DEG;
    const dx = Math.sin(rad), dz = Math.cos(rad);
    const tx = Math.cos(rad) * s, tz = -Math.sin(rad) * s;
    const mid = (near + far) * 0.5;
    const c = f.center;
    const rc = (r0 + r1) * 0.5;
    out.push({
      center: new THREE.Vector3(c.x + dx * rc + tx * mid, c.y, c.z + dz * rc + tz * mid),
      yaw: a,
      size: { x: far - near, y: r1 - r0 },
      from: new THREE.Vector3(c.x + dx * r0 + tx * mid, c.y, c.z + dz * r0 + tz * mid),
      length: Math.max(0.5, f.wallRadius - r0),
      halfWidth: (far - near) * 0.5,
      channel: ch,
    });
  }
  return out;
}

/** 熔流带（盒）里有没有 p（XZ） */
export function inStrip(s: FloodStrip, p: { x: number; z: number }): boolean {
  const dx = p.x - s.center.x, dz = p.z - s.center.z;
  const a = s.yaw * DEG;
  const fx = Math.sin(a), fz = Math.cos(a);
  const rx = Math.cos(a), rz = -Math.sin(a);
  return Math.abs(dx * rx + dz * rz) <= s.size.x * 0.5 && Math.abs(dx * fx + dz * fz) <= s.size.y * 0.5;
}

// ───────────── 焚身吐息的计划（Unity BurnSweep.Plan）─────────────

/** 吐息落点离池边多远（米） */
export const SWEEP_SPOT_OUT = 2.2;

/**
 * 象限 q 的对岸落点（象限中线反方向、熔池外 2.2 m），从落点看夹着象限的两条渠在殿墙内 1 m 处的端点——
 * 起扫方位取离玩家远的那一端、收扫取近的那一端；射程 = 两端较远的距离 + 2 m
 */
export function sweepPlan(f: QilinFurnace, q: number, player: { x: number; z: number }): { spot: THREE.Vector3; yaw0: number; yaw1: number; range: number } {
  const n = f.quadrantCount;
  q = ((q % n) + n) % n;
  const spot = f.point(f.quadrantYaw(q) + 180, f.poolRadius + SWEEP_SPOT_OUT);
  const a = f.point(f.channelYaws[q], f.wallRadius - 1);
  const b = f.point(f.channelYaws[(q + 1) % n], f.wallRadius - 1);
  const yawFrom = (to: { x: number; z: number }) => Math.atan2(to.x - spot.x, to.z - spot.z) / DEG;
  const ya = yawFrom(a), yb = yawFrom(b), yp = yawFrom(player);
  const nearA = Math.abs(deltaAngle(yp, ya)) < Math.abs(deltaAngle(yp, yb));
  return {
    spot,
    yaw0: nearA ? yb : ya,
    yaw1: nearA ? ya : yb,
    range: Math.max(Math.hypot(a.x - spot.x, a.z - spot.z), Math.hypot(b.x - spot.x, b.z - spot.z)) + 2,
  };
}
