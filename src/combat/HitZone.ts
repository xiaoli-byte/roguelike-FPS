/**
 * 多段命中区（Unity Enemies/HitZone.cs + EnemyBody.ZoneAt / ZoneIncoming / OnDamaged 的分区部分）：战斗契约里的「命中区」。
 *   · 倍率 multiplier：落在这一区的伤害乘上它（< 0.5 记为「格挡」）；持续伤害、没有命中点的不算区；
 *   · 弱点 weakpoint：必定暴击；运行时 setWeakPoint 切换（火麒麟碎鳞、炉门开合）；
 *   · 启停 active：关掉 = 打不到、也不挡子弹；
 *   · 朝向门 facing（'front' / 'back'，cos ≥ facingCos，缺省 0.34 ≈ ±70°）：门外这一区按普通部位（×1、不是弱点）——
 *     倍率按这一击的方向判，弱点按玩家视点判（命中扫描读弱点时还没有伤害请求）；
 *   · 半径缩放 setRadiusScale（炉门开合、蓄力鼓胀）；
 *   · 计数：累计落在这一区的实际伤害，到 breakAt 发一次 broke（断腿、碎甲、琴碎），每一下都发 damaged。
 * 分区（{@link HitZoneSet.zoneAt}）：按命中点找（形状表面 / 内部，容差 0.08 m），优先级高的先、同优先级取近的；
 *   弱点命中先在弱点区里找，非弱点命中不落在弱点区；容差内没有时退而取 0.5 m 内最近的普通区。
 * 射线（{@link HitZoneSet.raycast}）按弱点规则（同 Unity WeakpointRule：先进身体、往前 1.5 m 内穿过同一单位的弱点就按弱点算）。
 *
 * 网页的敌人（M5）各自用 raycastHit / guardFactor / armourFactor 实现同样的数（见 docs/threejs-migration.md 4.4），
 * 新移植的敌人挂 `hitZones`（{@link HitZoneSet}）即接进 Combat：Combat.damageEnemy 读 `enemy.hitZones` 分区、乘倍率、记数。
 * 纯逻辑（只用 three 的 Vector3），node --test 直接测。
 */
import * as THREE from 'three';

export type ZoneFacing = 'any' | 'front' | 'back';

/** 分区的命中点容差（米，Unity EnemyBody.ZoneTolerance） */
export const ZONE_TOLERANCE = 0.08;
/** 容差内没有时，退而取多远内最近的普通区（Unity EnemyBody.ZoneFallback） */
export const ZONE_FALLBACK = 0.5;
/** 弱点规则：身体命中之后再往前看多远（米，Unity WeakpointRule.Window） */
export const WEAKPOINT_WINDOW = 1.5;
/** 朝向门的缺省半角余弦（Unity HitZone.facingCos） */
export const FACING_COS = 0.34;
/** 乘积低于这个记为「格挡」（Unity Damageable.ApplyLayers） */
export const BLOCK_BELOW = 0.5;

/** 命中区的几何（世界坐标，每次查询现取：挂在会动的骨骼上时由提供者每帧算） */
export interface ZoneShape {
  /** 点到形状的距离（在内部 / 表面上为 0）；scale = 半径缩放 */
  distance(p: THREE.Vector3, scale: number): number;
  /** 射线进入形状的距离（−1 = 不中；起点在内部为 0） */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, scale: number): number;
  /** 形状中心（朝向门判弱点用） */
  center(out: THREE.Vector3): THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/** 球：center() 每次现取 */
export function sphereShape(center: (out: THREE.Vector3) => THREE.Vector3, radius: number): ZoneShape {
  return {
    distance(p, s) {
      return Math.max(0, center(_a).distanceTo(p) - radius * s);
    },
    raycast(o, d, max, s) {
      return raySphereEnter(o, d, center(_a), radius * s, max);
    },
    center: out => center(out),
  };
}

/** 胶囊（线段 a–b + 半径） */
export function capsuleShape(a: (out: THREE.Vector3) => THREE.Vector3, b: (out: THREE.Vector3) => THREE.Vector3, radius: number): ZoneShape {
  return {
    distance(p, s) {
      a(_a);
      b(_b);
      return Math.max(0, Math.sqrt(distSqPointSeg(p, _a, _b)) - radius * s);
    },
    raycast(o, d, max, s) {
      a(_a);
      b(_b);
      return rayCapsuleEnter(o, d, _a, _b, radius * s, max);
    },
    center(out) {
      a(_a);
      b(_b);
      return out.addVectors(_a, _b).multiplyScalar(0.5);
    },
  };
}

/** 朝向的参考系：水平朝前方向（世界） */
export type FacingFrame = (out: THREE.Vector3) => THREE.Vector3;

export class HitZone {
  multiplier: number;
  weakpoint: boolean;
  facing: ZoneFacing = 'any';
  facingCos = FACING_COS;
  priority: number;
  /** 累计伤害到这个值发 broke（≤ 0 = 不计） */
  breakAt = 0;
  active = true;
  /** 累计落在这一区的实际伤害（resetCount 清零） */
  damageTaken = 0;
  broken = false;
  radiusScale = 1;
  /** 每挨一下：区、实际伤害、是否格挡 */
  readonly damaged: ((zone: HitZone, dealt: number, blocked: boolean) => void)[] = [];
  /** 累计到 breakAt（每次 resetCount 之后最多一次） */
  readonly broke: ((zone: HitZone) => void)[] = [];
  /** 朝向参考系（缺省 = 所属敌人的朝向，由 HitZoneSet 给） */
  frame: FacingFrame | null;

  constructor(
    readonly id: string,
    readonly shape: ZoneShape,
    opts: { multiplier?: number; weakpoint?: boolean; priority?: number; facing?: ZoneFacing; facingCos?: number; breakAt?: number; frame?: FacingFrame } = {},
  ) {
    this.multiplier = opts.multiplier ?? 1;
    this.weakpoint = opts.weakpoint ?? false;
    this.priority = opts.priority ?? 0;
    this.facing = opts.facing ?? 'any';
    this.facingCos = opts.facingCos ?? FACING_COS;
    this.breakAt = opts.breakAt ?? 0;
    this.frame = opts.frame ?? null;
  }

  setActive(on: boolean): void { this.active = on; }
  setWeakPoint(on: boolean): void { this.weakpoint = on; }

  setRadiusScale(scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.radiusScale = scale;
  }

  /**
   * 朝向门：shotDirection = 这一击飞行的方向（从出手者指向目标）。front：从参考系正前方 cos ≥ facingCos 打来；back：从正后方。
   * 没有门总是通过；方向退化（零向量）时有门的不通过
   */
  facingPasses(shotDirection: THREE.Vector3 | null | undefined, frame: FacingFrame | null = this.frame): boolean {
    if (this.facing === 'any') return true;
    if (!shotDirection || !frame) return false;
    const fx = -shotDirection.x, fz = -shotDirection.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-3) return false;
    frame(_d);
    const wl = Math.hypot(_d.x, _d.z);
    if (wl < 1e-3) return false;
    const dot = (fx * _d.x + fz * _d.z) / (fl * wl);
    return this.facing === 'front' ? dot >= this.facingCos : dot <= -this.facingCos;
  }

  /** 这一击落在这一区时的伤害倍率：朝向门外按普通部位（1） */
  multiplierFor(direction: THREE.Vector3 | null | undefined): number {
    return this.facingPasses(direction) ? this.multiplier : 1;
  }

  /** 现在按弱点算：启用、是弱点、朝向门对玩家视点通过（视点 → 区中心的方向） */
  weakNow(eye: THREE.Vector3 | null): boolean {
    if (!this.weakpoint || !this.active) return false;
    if (this.facing === 'any') return true;
    if (!eye) return false;
    return this.facingPasses(this.shape.center(_c).sub(eye));
  }

  distance(p: THREE.Vector3): number {
    return this.shape.distance(p, this.radiusScale);
  }

  /** 这一区挨了一下（结果已结算）：累计、发 damaged，到 breakAt 发一次 broke */
  record(dealt: number, blocked = false): void {
    if (dealt > 0) this.damageTaken += dealt;
    for (const fn of this.damaged) {
      try { fn(this, dealt, blocked); } catch (err) { console.error('[HitZone] damaged listener threw', err); }
    }
    if (this.broken || !(this.breakAt > 0) || this.damageTaken < this.breakAt) return;
    this.broken = true;
    for (const fn of this.broke) {
      try { fn(this); } catch (err) { console.error('[HitZone] broke listener threw', err); }
    }
  }

  resetCount(): void {
    this.damageTaken = 0;
    this.broken = false;
  }
}

export interface ZoneRayHit {
  zone: HitZone;
  /** 命中距离（先进身体时 = 身体的距离） */
  distance: number;
  /** 按弱点算（弱点规则） */
  weak: boolean;
  /** 弱点命中时是弱点区，否则是最先打到的区 */
  hitZone: HitZone;
}

/** 一只敌人的命中区（Unity EnemyBody 的分区部分） */
export class HitZoneSet {
  readonly zones: HitZone[] = [];

  /** forward：敌人的水平朝前方向（朝向门缺省参考系） */
  constructor(readonly forward: FacingFrame | null = null) {}

  add(zone: HitZone): HitZone {
    if (!zone.frame && this.forward) zone.frame = this.forward;
    this.zones.push(zone);
    return zone;
  }

  /** 有倍率不是 1 的区（要在敌人侧结算） */
  get affectsDamage(): boolean {
    return this.zones.some(z => z.multiplier !== 1);
  }

  /**
   * 这一击落在哪个命中区（Unity EnemyBody.ZoneAt）：持续伤害 / 没有命中点的不算区（调用方先过滤），
   * 弱点命中先在弱点区里找；否则在普通区里按容差找，没有再退到 0.5 m 内最近的普通区
   */
  zoneAt(point: THREE.Vector3 | null | undefined, weak = false): HitZone | null {
    if (this.zones.length === 0 || !point || !Number.isFinite(point.x + point.y + point.z)) return null;
    if (weak) {
      const w = this.pick(point, true, ZONE_TOLERANCE, false);
      if (w) return w;
    }
    return this.pick(point, false, ZONE_TOLERANCE, false) ?? this.pick(point, false, ZONE_FALLBACK, true);
  }

  private pick(p: THREE.Vector3, weakZones: boolean, within: number, nearestOnly: boolean): HitZone | null {
    let best: HitZone | null = null;
    let bestD = Infinity;
    for (const z of this.zones) {
      if (!z.active || z.weakpoint !== weakZones) continue;
      const d = z.distance(p);
      if (d > within) continue;
      if (nearestOnly) {
        if (d >= bestD) continue;
        best = z;
        bestD = d;
        continue;
      }
      if (best && (z.priority < best.priority || (z.priority === best.priority && d >= bestD))) continue;
      best = z;
      bestD = d;
    }
    return best;
  }

  /**
   * 射线打命中区（命中扫描 / 投射物）：最近的普通区 = 身体；弱点区（weakNow）在身体之前、或在身体之后 1.5 m 内被穿过，就按弱点算。
   * eye = 玩家视点（朝向门判弱点）
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, eye: THREE.Vector3 | null): ZoneRayHit | null {
    let body: HitZone | null = null, bodyT = Infinity;
    let weak: HitZone | null = null, weakT = Infinity;
    for (const z of this.zones) {
      if (!z.active) continue;
      const t = z.shape.raycast(origin, dir, maxDist + WEAKPOINT_WINDOW, z.radiusScale);
      if (t < 0) continue;
      if (z.weakNow(eye)) {
        if (t < weakT) { weakT = t; weak = z; }
      } else if (t < bodyT) {
        bodyT = t;
        body = z;
      }
    }
    if (body && bodyT > maxDist) body = null;
    const w = weakHit(body ? bodyT : -1, weak ? weakT : -1, maxDist);
    if (w.distance < 0) return null;
    const hitZone = w.weak ? weak! : body!;
    return { zone: hitZone, hitZone, distance: w.distance, weak: w.weak };
  }
}

/**
 * 弱点规则（Unity WeakpointRule）：tb = 身体命中距离、th = 弱点命中距离（−1 = 不中）。
 * 弱点先中 → 弱点；先进身体、往前 window 米内穿过弱点 → 按弱点算，距离仍是身体的；否则身体。
 * 只中弱点但超出 maxDist 的不算。返回 distance −1 = 都没中
 */
export function weakHit(tb: number, th: number, maxDist: number, window = WEAKPOINT_WINDOW): { distance: number; weak: boolean } {
  const bodyOk = tb >= 0 && tb <= maxDist;
  if (th >= 0 && (!bodyOk || th <= tb) && th <= maxDist) return { distance: th, weak: true };
  if (bodyOk) return { distance: tb, weak: th >= 0 && th < tb + window };
  return { distance: -1, weak: false };
}

// ───────────── 几何 ─────────────

function distSqPointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz;
}

/** 射线进入球的距离（起点在内部为 0；不中 −1） */
export function raySphereEnter(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, max: number): number {
  const mx = o.x - c.x, my = o.y - c.y, mz = o.z - c.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return 0;
  const b = mx * d.x + my * d.y + mz * d.z;
  if (b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= max ? t : -1;
}

/** 射线进入胶囊的距离（两端球 + 圆柱身解析求交；起点在内部为 0；不中 −1） */
export function rayCapsuleEnter(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, max: number): number {
  // 两端的球 + 圆柱：取最小的进入距离
  let best = Infinity;
  const ts = raySphereEnter(o, d, a, r, max);
  if (ts >= 0) best = ts;
  const tb = raySphereEnter(o, d, b, r, max);
  if (tb >= 0 && tb < best) best = tb;
  // 圆柱（无限长，限制在线段投影范围内）
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
  const al = Math.sqrt(ax * ax + ay * ay + az * az);
  if (al > 1e-6) {
    const ux = ax / al, uy = ay / al, uz = az / al;
    const ox = o.x - a.x, oy = o.y - a.y, oz = o.z - a.z;
    const dd = d.x * ux + d.y * uy + d.z * uz;
    const od = ox * ux + oy * uy + oz * uz;
    const px = d.x - dd * ux, py = d.y - dd * uy, pz = d.z - dd * uz;
    const qx = ox - od * ux, qy = oy - od * uy, qz = oz - od * uz;
    const A = px * px + py * py + pz * pz;
    const B = 2 * (px * qx + py * qy + pz * qz);
    const C = qx * qx + qy * qy + qz * qz - r * r;
    if (C <= 0 && od >= 0 && od <= al) return 0;
    if (A > 1e-12) {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        const s = od + t * dd;
        if (t >= 0 && t <= max && s >= 0 && s <= al && t < best) best = t;
      }
    }
  }
  return best <= max ? best : -1;
}
