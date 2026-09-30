/**
 * Boss 危险物集合（每个 Boss 实例一份）。
 *
 *  - wave：低矮扩散冲击波环（可限定扇形），贴地玩家被扫到受伤一次；跳起 / 站上掩体 / 被掩体挡住可躲。
 *  - zone：持续伤害区（火焰地带、熔岩外圈），先预警 arm 秒，之后由 ctx.tasks 每 interval 秒检测一次。
 *  - lob：带地面预警的抛物线巨石 / 天降陨石，落地范围伤害。
 *  - erupt：延时地刺（地面预警 → 破土伤害）。
 *  - lineWarning / sectorWarning：长条 / 扇形贴地预警。
 *  - beam：光束网格句柄（由招式每帧摆放，配合 segmentHitsPlayer 判定）。
 *
 * 所有物体挂 ctx.stageGroup；所有任务的取消函数都被记录，clear() 一次性取消并移除（Boss 死亡 / 释放时调用）。
 * 伤害一律经 ctx.combat.damagePlayer，并自动乘上 owner.damageMult。
 */
import * as THREE from 'three';
import type { Element, GameContext } from '../../core/types';
import type { EnemyBase } from '../EnemyBase';
import { angleDiff, clamp01 } from '../../core/math';
import { acquireWaveWallMaterial, BeamMesh, GroundDecal, releaseWaveWallMaterial, waveWallGeometry } from './Visuals';
import { geo, glow, std } from './parts';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _imp = new THREE.Vector3();

// ───────────── 规格 ─────────────

export interface WaveSpec {
  x: number; y: number; z: number;
  /** 扩散速度（米/秒） */
  speed: number;
  maxRadius: number;
  /** 基础伤害（自动乘 damageMult） */
  damage: number;
  color: number;
  startRadius?: number;
  /** 环带厚度，缺省 0.9 */
  width?: number;
  /** 离地多高以内会被扫到（玩家脚底高度），缺省 0.85 */
  height?: number;
  /** 扇形中心朝向（facing 约定）与半角；缺省整圈 */
  arcCenter?: number;
  arcHalf?: number;
  /** 命中时向外击退（米/秒） */
  knockback?: number;
  element?: Element;
  /** 沿环扬起的尘土 / 火星颜色（缺省不扬） */
  dust?: number;
}

export interface ZoneSpec {
  x: number; y: number; z: number;
  radius: number;
  /** >0 时为环带（外圈熔岩） */
  innerRadius?: number;
  /** 生效时长（不含预警与消散） */
  duration: number;
  /** 预警时长（期间不伤害），缺省 0.4 */
  arm?: number;
  /** 每次检测的基础伤害 */
  damage: number;
  /** 检测间隔，缺省 0.5 */
  interval?: number;
  color: number;
  element?: Element;
  /** 冒出火星粒子的颜色（缺省不冒） */
  embers?: number;
  /** 玩家脚底离地多高以内算站在里面，缺省 0.6 */
  maxHeight?: number;
}

export interface ZoneHandle {
  readonly ended: boolean;
  /** 提前结束（进入消散） */
  expire(): void;
}

export interface LobSpec {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** 飞行时间 */
  time: number;
  /** 抛物线额外顶点高度（陨石为 0：直线坠落） */
  arc: number;
  radius: number;
  damage: number;
  color: number;
  kind: 'boulder' | 'meteor' | 'ice';
  /** 是否画地面预警，缺省 true */
  warn?: boolean;
  element?: Element;
  scale?: number;
  onLand?: (p: THREE.Vector3) => void;
}

export interface EruptSpec {
  x: number; y: number; z: number;
  radius: number;
  delay: number;
  damage: number;
  color: number;
  kind: 'rock' | 'ice';
  /** 离地多高以内会被刺中，缺省 1.3 */
  height?: number;
  sound?: boolean;
}

export interface BlastOpts {
  /** 玩家脚底高于中心多少以内会被命中，缺省 = 半径 */
  maxHeight?: number;
  knockback?: number;
  knockUp?: number;
  element?: Element;
}

// ───────────── 内部记录 ─────────────

interface Wave {
  x: number; y: number; z: number;
  speed: number; max: number; width: number; height: number;
  damage: number; element: Element; knockback: number;
  arcCenter: number; arcHalf: number;
  r: number; prevR: number; hit: boolean;
  dust: number; dustAcc: number;
  wall: THREE.Mesh; wallMat: THREE.MeshBasicMaterial; band: GroundDecal;
}

interface Zone extends ZoneHandle {
  ended: boolean;
  x: number; y: number; z: number;
  radius: number; inner: number;
  arm: number; duration: number; age: number;
  damage: number; element: Element; maxHeight: number;
  embers: number; emberAcc: number;
  decal: GroundDecal;
  cancelTick: () => void;
}

interface Lob {
  obj: THREE.Object3D;
  from: THREE.Vector3; to: THREE.Vector3;
  t: number; time: number; arc: number;
  radius: number; damage: number; color: number; element: Element;
  kind: LobSpec['kind'];
  spinX: number; spinZ: number; trailAcc: number;
  onLand?: (p: THREE.Vector3) => void;
}

interface Spike {
  obj: THREE.Group;
  baseY: number;
  age: number;
}

interface Telegraph {
  decal: GroundDecal;
  age: number;
  dur: number;
}

// ───────────── 共享材质（模块级，永不释放） ─────────────

const M = {
  get boulder() { return std(0x7d6048, { rough: 0.95 }); },
  get boulderRune() { return glow(0xffa53a); },
  get meteorCore() { return glow(0xffb05a); },
  get meteorHalo() { return glow(0xff4a12, 0.5, true); },
  get ice() { return std(0xbfefff, { emissive: 0x2f8fd8, ei: 0.55, rough: 0.25, metal: 0.1 }); },
  get rock() { return std(0x9a6d40, { rough: 0.95 }); },
};

// ───────────── 线段距离 ─────────────

/** 两线段最近距离的平方（Ericson, Real-Time Collision Detection 5.1.9） */
function segSegDistSq(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-8;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) return rx * rx + ry * ry + rz * rz;
  if (a <= EPS) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = p1.x + d1x * s - (p2.x + d2x * t);
  const dy = p1.y + d1y * s - (p2.y + d2y * t);
  const dz = p1.z + d1z * s - (p2.z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}

// ───────────── HazardSet ─────────────

export class HazardSet {
  private waves: Wave[] = [];
  private zones: Zone[] = [];
  private lobs: Lob[] = [];
  private spikes: Spike[] = [];
  private teles: Telegraph[] = [];
  private beams = new Set<BeamMesh>();
  private cancels = new Set<() => void>();
  private clock = 0;

  constructor(private readonly ctx: GameContext, private readonly owner: EnemyBase) {}

  private get parent(): THREE.Object3D {
    return this.ctx.stageGroup;
  }

  // ───────────── 伤害工具 ─────────────

  /** 对玩家造成伤害（自动乘 damageMult）。from 为伤害来源点（受击方向指示），会被复制 */
  hurt(base: number, element: Element = 'none', from: THREE.Vector3 | null = null): number {
    const p = this.ctx.player;
    if (!p.alive || !this.owner.alive) return 0;
    return this.ctx.combat.damagePlayer(base * this.owner.damageMult, element, this.owner, from ? from.clone() : null);
  }

  /** 以 (x,y,z) 为中心的范围伤害（水平半径 + 高度限制），返回是否命中 */
  blast(x: number, y: number, z: number, radius: number, damage: number, o: BlastOpts = {}): boolean {
    const p = this.ctx.player;
    if (!p.alive) return false;
    const dx = p.position.x - x;
    const dz = p.position.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius + p.radius) return false;
    const h = p.position.y - y;
    if (h > (o.maxHeight ?? radius) || h < -1.5) return false;
    this.hurt(damage, o.element ?? 'none', _a.set(x, y + 0.5, z));
    if (o.knockback || o.knockUp) {
      const inv = d > 0.05 ? 1 / d : 0;
      const k = o.knockback ?? 0;
      p.applyImpulse(_imp.set(dx * inv * k, o.knockUp ?? 0, dz * inv * k));
    }
    return true;
  }

  /** 带半径的线段是否与玩家胶囊相交 */
  segmentHitsPlayer(a: THREE.Vector3, b: THREE.Vector3, radius: number): boolean {
    const p = this.ctx.player;
    if (!p.alive) return false;
    const pr = p.radius;
    _c.set(p.position.x, p.position.y + pr, p.position.z);
    _d.set(p.position.x, p.position.y + Math.max(pr, p.height - pr), p.position.z);
    const r = radius + pr;
    return segSegDistSq(a, b, _c, _d) <= r * r;
  }

  /** 玩家脚底相对 y 的高度 */
  playerHeightAbove(y: number): number {
    return this.ctx.player.position.y - y;
  }

  // ───────────── 任务（全部可在 clear 时取消） ─────────────

  /** sec 秒后执行一次 */
  later(sec: number, fn: () => void): () => void {
    const c = this.ctx.tasks.delay(sec, () => {
      this.cancels.delete(c);
      fn();
    });
    this.cancels.add(c);
    return c;
  }

  /** 每 interval 秒执行一次，持续 duration 秒 */
  repeat(interval: number, duration: number, fn: () => void): () => void {
    let acc = 0;
    let elapsed = 0;
    const c = this.ctx.tasks.add((dt) => {
      acc += dt;
      elapsed += dt;
      while (acc >= interval) {
        acc -= interval;
        fn();
      }
      if (elapsed >= duration) {
        this.cancels.delete(c);
        return true;
      }
      return false;
    });
    this.cancels.add(c);
    return c;
  }

  // ───────────── 预警 ─────────────

  /** 圆形地面预警（交给 Fx 绘制） */
  groundWarning(x: number, y: number, z: number, radius: number, duration: number, color: number): void {
    this.ctx.fx.groundWarning(new THREE.Vector3(x, y, z), radius, duration, color);
  }

  /** 长条预警：从 (x,z) 朝 yaw 延伸 length，duration 秒内由近到远填满 */
  lineWarning(x: number, y: number, z: number, yaw: number, length: number, halfWidth: number, duration: number, color: number): void {
    const decal = GroundDecal.acquire(this.parent, color).rect(x, y, z, yaw, length, halfWidth);
    decal.fill = 0;
    this.teles.push({ decal, age: 0, dur: duration });
  }

  /** 扇形预警 */
  sectorWarning(x: number, y: number, z: number, yaw: number, halfAngle: number, radius: number, duration: number, color: number): void {
    const decal = GroundDecal.acquire(this.parent, color).circle(x, y, z, radius, 0, yaw, halfAngle);
    decal.fill = 0;
    this.teles.push({ decal, age: 0, dur: duration });
  }

  // ───────────── 冲击波 ─────────────

  wave(s: WaveSpec): void {
    const arcHalf = s.arcHalf ?? Math.PI;
    const full = arcHalf >= Math.PI - 1e-3;
    const wallMat = acquireWaveWallMaterial(s.color);
    const wall = new THREE.Mesh(waveWallGeometry(arcHalf), wallMat);
    wall.position.set(s.x, s.y + 0.02, s.z);
    if (!full) wall.rotation.y = s.arcCenter ?? 0;
    wall.frustumCulled = false;
    wall.renderOrder = 4;
    const r0 = s.startRadius ?? 0.5;
    wall.scale.set(r0, 0.01, r0);
    this.parent.add(wall);
    const band = GroundDecal.acquire(this.parent, s.color).circle(s.x, s.y, s.z, r0 + 0.4, 0, s.arcCenter ?? 0, full ? Math.PI : arcHalf);
    band.fill = 1.1;
    band.soft = 0.3;
    this.waves.push({
      x: s.x, y: s.y, z: s.z,
      speed: s.speed, max: s.maxRadius, width: s.width ?? 0.9, height: s.height ?? 0.85,
      damage: s.damage, element: s.element ?? 'none', knockback: s.knockback ?? 0,
      arcCenter: s.arcCenter ?? 0, arcHalf: full ? Math.PI : arcHalf,
      r: r0, prevR: r0, hit: false,
      dust: s.dust ?? -1, dustAcc: 0,
      wall, wallMat, band,
    });
  }

  private stepWave(w: Wave, dt: number): boolean {
    w.prevR = w.r;
    w.r = Math.min(w.max, w.r + w.speed * dt);
    const fade = 1 - clamp01((w.r - w.max * 0.72) / (w.max * 0.28));
    w.wall.scale.set(w.r, w.height * 1.2, w.r);
    w.wallMat.opacity = 0.95 * fade;
    w.band.setRadii(w.r + w.width * 0.5, Math.max(0.02, w.r - w.width * 0.5));
    w.band.opacity = 0.95 * fade;
    w.band.time = this.clock;
    if (!w.hit) this.checkWave(w);
    if (w.dust >= 0) {
      w.dustAcc += dt;
      if (w.dustAcc >= 0.06) {
        w.dustAcc = 0;
        const a = w.arcHalf >= Math.PI ? Math.random() * Math.PI * 2 : w.arcCenter + (Math.random() * 2 - 1) * w.arcHalf;
        _b.set(w.x + Math.sin(a) * w.r, w.y + 0.2, w.z + Math.cos(a) * w.r);
        this.ctx.fx.burst(_b, w.dust, 3, 2.5, 0.45, 0.3, 4);
      }
    }
    if (w.r >= w.max) {
      w.wall.removeFromParent();
      releaseWaveWallMaterial(w.wallMat);
      w.band.release();
      return false;
    }
    return true;
  }

  private checkWave(w: Wave): void {
    const p = this.ctx.player;
    if (!p.alive) return;
    const h = p.position.y - w.y;
    if (h > w.height || h < -1.5) return;
    const dx = p.position.x - w.x;
    const dz = p.position.z - w.z;
    const d = Math.hypot(dx, dz);
    const lo = w.prevR - w.width * 0.5;
    const hi = w.r + w.width * 0.5;
    if (d + p.radius < lo || d - p.radius > hi) return;
    if (w.arcHalf < Math.PI) {
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(w.arcCenter, ang)) > w.arcHalf + p.radius / Math.max(0.5, d)) return;
    }
    // 掩体挡波
    if (d > 1.2) {
      _a.set(w.x, w.y + 0.45, w.z);
      _b.set(p.position.x, w.y + 0.45, p.position.z);
      if (this.ctx.world.segmentBlocked(_a, _b)) return;
    }
    w.hit = true;
    this.hurt(w.damage, w.element, _a.set(w.x, w.y + 0.5, w.z));
    if (w.knockback > 0 && d > 0.05) p.applyImpulse(_imp.set((dx / d) * w.knockback, 3.5, (dz / d) * w.knockback));
  }

  // ───────────── 持续伤害区 ─────────────

  zone(s: ZoneSpec): ZoneHandle {
    const decal = GroundDecal.acquire(this.parent, s.color).circle(s.x, s.y, s.z, s.radius, s.innerRadius ?? 0);
    decal.soft = 0.45;
    decal.fill = 0;
    decal.opacity = 0;
    const arm = s.arm ?? 0.4;
    const zone: Zone = {
      ended: false,
      x: s.x, y: s.y, z: s.z,
      radius: s.radius, inner: s.innerRadius ?? 0,
      arm, duration: s.duration, age: 0,
      damage: s.damage, element: s.element ?? 'fire', maxHeight: s.maxHeight ?? 0.6,
      embers: s.embers ?? -1, emberAcc: 0,
      decal,
      cancelTick: () => {},
      expire: () => {
        if (zone.age < zone.arm + zone.duration) zone.duration = Math.max(0, zone.age - zone.arm);
        zone.cancelTick();
      },
    };
    zone.cancelTick = this.repeat(s.interval ?? 0.5, arm + s.duration, () => {
      if (zone.age >= zone.arm && zone.age < zone.arm + zone.duration) this.checkZone(zone);
    });
    this.zones.push(zone);
    return zone;
  }

  private checkZone(z: Zone): void {
    const p = this.ctx.player;
    if (!p.alive) return;
    const h = p.position.y - z.y;
    if (h > z.maxHeight || h < -1) return;
    const d = Math.hypot(p.position.x - z.x, p.position.z - z.z);
    if (d > z.radius + p.radius * 0.5) return;
    if (z.inner > 0 && d < z.inner - p.radius * 0.5) return;
    this.hurt(z.damage, z.element, null);
  }

  private stepZone(z: Zone, dt: number): boolean {
    z.age += dt;
    const live = z.arm + z.duration;
    const d = z.decal;
    d.time = this.clock;
    if (z.age < z.arm) {
      const u = z.age / Math.max(0.01, z.arm);
      d.pattern = 0;
      d.fill = u;
      d.opacity = 0.35 + 0.45 * u + 0.15 * Math.sin(this.clock * 16);
    } else if (z.age < live) {
      d.pattern = 1;
      d.opacity = Math.min(1, (z.age - z.arm) / 0.25);
    } else {
      z.ended = true;
      d.opacity = Math.max(0, 1 - (z.age - live) / 0.6);
    }
    if (z.embers >= 0 && z.age >= z.arm && z.age < live) {
      z.emberAcc += dt;
      const every = z.inner > 0 ? 0.05 : 0.2;
      while (z.emberAcc >= every) {
        z.emberAcc -= every;
        const a = Math.random() * Math.PI * 2;
        const rr = z.inner > 0 ? z.inner + Math.random() * Math.min(12, z.radius - z.inner) : Math.sqrt(Math.random()) * z.radius;
        _b.set(z.x + Math.sin(a) * rr, z.y + 0.1, z.z + Math.cos(a) * rr);
        this.ctx.fx.burst(_b, z.embers, 2, 1.2, 0.7, 0.22, -3);
      }
    }
    if (z.age >= live + 0.6) {
      z.ended = true;
      z.cancelTick();
      d.release();
      return false;
    }
    return true;
  }

  // ───────────── 抛射 / 坠落 ─────────────

  lob(s: LobSpec): void {
    let obj: THREE.Object3D;
    const sc = s.scale ?? 1;
    if (s.kind === 'meteor') {
      const g = new THREE.Group();
      const core = new THREE.Mesh(geo.ico(0.75, 0), M.meteorCore);
      const halo = new THREE.Mesh(geo.sphere(1.25, 10, 8), M.meteorHalo);
      g.add(core, halo);
      obj = g;
    } else if (s.kind === 'ice') {
      const m = new THREE.Mesh(geo.octa(0.7), M.ice);
      m.castShadow = true;
      obj = m;
    } else {
      const g = new THREE.Group();
      const rock = new THREE.Mesh(geo.dodeca(0.85), M.boulder);
      rock.castShadow = true;
      const rune = new THREE.Mesh(geo.box(0.9, 0.12, 0.12), M.boulderRune);
      rune.position.set(0, 0.2, 0.72);
      g.add(rock, rune);
      obj = g;
    }
    obj.scale.setScalar(sc * (0.9 + Math.random() * 0.25));
    obj.position.copy(s.from);
    this.parent.add(obj);
    if (s.warn !== false) this.groundWarning(s.to.x, s.to.y, s.to.z, s.radius, s.time, s.color);
    this.lobs.push({
      obj,
      from: s.from.clone(), to: s.to.clone(),
      t: 0, time: Math.max(0.2, s.time), arc: s.arc,
      radius: s.radius, damage: s.damage, color: s.color, element: s.element ?? 'none',
      kind: s.kind,
      spinX: (Math.random() - 0.5) * 8, spinZ: (Math.random() - 0.5) * 8, trailAcc: 0,
      onLand: s.onLand,
    });
  }

  private stepLob(l: Lob, dt: number): boolean {
    l.t += dt;
    const u = Math.min(1, l.t / l.time);
    const o = l.obj;
    o.position.lerpVectors(l.from, l.to, u);
    o.position.y += l.arc * 4 * u * (1 - u);
    o.rotation.x += l.spinX * dt;
    o.rotation.z += l.spinZ * dt;
    if (l.kind === 'meteor') {
      l.trailAcc += dt;
      if (l.trailAcc >= 0.06) {
        l.trailAcc = 0;
        this.ctx.fx.burst(o.position, l.color, 2, 1.6, 0.45, 0.45, -1);
      }
    }
    if (u < 1) return true;
    o.removeFromParent();
    this.land(l);
    return false;
  }

  private land(l: Lob): void {
    const p = l.to;
    this.blast(p.x, p.y, p.z, l.radius, l.damage, { maxHeight: l.radius * 0.9, element: l.element, knockback: 5, knockUp: 3.5 });
    const fx = this.ctx.fx;
    fx.explosion(new THREE.Vector3(p.x, p.y + 0.4, p.z), l.radius, l.color);
    _b.set(p.x, p.y + 0.3, p.z);
    const debris = l.kind === 'ice' ? 0xd8f6ff : l.kind === 'meteor' ? 0xffc070 : 0xb58a5a;
    fx.burst(_b, debris, 14, 7, 0.9, 0.35, 20);
    const pl = this.ctx.player.position;
    const dist = Math.hypot(pl.x - p.x, pl.z - p.z);
    if (dist < 24) fx.shake(0.06 + 0.32 * (1 - dist / 24), 0.25);
    this.ctx.audio.play('explosion', { position: new THREE.Vector3(p.x, p.y, p.z), volume: 0.7, pitch: l.kind === 'boulder' ? 0.75 : 1 });
    l.onLand?.(p);
  }

  // ───────────── 地刺 ─────────────

  erupt(s: EruptSpec): void {
    this.groundWarning(s.x, s.y, s.z, s.radius, s.delay, s.color);
    this.later(s.delay, () => this.spawnSpike(s));
  }

  private spawnSpike(s: EruptSpec): void {
    const g = new THREE.Group();
    const mat = s.kind === 'ice' ? M.ice : M.rock;
    for (let i = 0; i < 3; i++) {
      const h = (i === 0 ? 2.0 : 1.3) * s.radius;
      const cone = new THREE.Mesh(geo.cone(0.34 * s.radius, 1, 5), mat);
      cone.scale.y = h;
      const a = Math.random() * Math.PI * 2;
      const rr = i === 0 ? 0 : s.radius * 0.45;
      cone.position.set(Math.sin(a) * rr, h * 0.5 - 0.1, Math.cos(a) * rr);
      cone.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      cone.castShadow = true;
      g.add(cone);
    }
    g.position.set(s.x, s.y, s.z);
    g.scale.set(1, 0.01, 1);
    this.parent.add(g);
    this.spikes.push({ obj: g, baseY: s.y, age: 0 });
    this.blast(s.x, s.y, s.z, s.radius, s.damage, { maxHeight: s.height ?? 1.3, knockUp: 6.5, element: 'none' });
    _b.set(s.x, s.y + 0.3, s.z);
    this.ctx.fx.burst(_b, s.kind === 'ice' ? 0xd8f6ff : 0xc49a64, 8, 5, 0.6, 0.3, 16);
    if (s.sound) this.ctx.audio.play('boss_slam', { position: new THREE.Vector3(s.x, s.y, s.z), volume: 0.45, pitch: 1.3 });
  }

  private stepSpike(s: Spike, dt: number): boolean {
    s.age += dt;
    const o = s.obj;
    if (s.age < 0.09) o.scale.y = Math.max(0.01, s.age / 0.09);
    else if (s.age < 0.6) o.scale.y = 1;
    else o.position.y = s.baseY - ((s.age - 0.6) / 0.35) * 2.6;
    if (s.age >= 0.95) {
      o.removeFromParent();
      return false;
    }
    return true;
  }

  // ───────────── 光束句柄 ─────────────

  beam(color: number, coreColor?: number): BeamMesh {
    const b = BeamMesh.acquire(this.parent, color, coreColor);
    this.beams.add(b);
    return b;
  }

  releaseBeam(b: BeamMesh | null): void {
    if (!b) return;
    if (this.beams.delete(b)) b.release();
  }

  /**
   * 预热着色器：登场期间放出一组不可见的贴花 / 光墙 / 光束各渲染几帧再回收，
   * 避免第一次预警出现时编译着色器卡顿。
   */
  prewarm(): void {
    const decal = GroundDecal.acquire(this.parent, 0xffffff).circle(0, -50, 0, 1);
    decal.opacity = 0;
    const wallMat = acquireWaveWallMaterial(0xffffff);
    wallMat.opacity = 0;
    const wall = new THREE.Mesh(waveWallGeometry(Math.PI), wallMat);
    wall.position.set(0, -50, 0);
    wall.frustumCulled = false;
    this.parent.add(wall);
    const beam = this.beam(0xffffff);
    beam.setOpacity(0);
    _a.set(0, -50, 0);
    _b.set(0, -49, 0);
    beam.set(_a, _b, 0.1);
    this.later(0.4, () => {
      decal.release();
      wall.removeFromParent();
      releaseWaveWallMaterial(wallMat);
      this.releaseBeam(beam);
    });
  }

  // ───────────── 更新 / 清理 ─────────────

  /** 每帧推进（由 Boss 的 update 调用）。原地压缩数组，无分配 */
  update(dt: number): void {
    this.clock += dt;
    let n = 0;
    const waves = this.waves;
    for (let i = 0; i < waves.length; i++) if (this.stepWave(waves[i], dt)) waves[n++] = waves[i];
    waves.length = n;
    n = 0;
    const zones = this.zones;
    for (let i = 0; i < zones.length; i++) if (this.stepZone(zones[i], dt)) zones[n++] = zones[i];
    zones.length = n;
    n = 0;
    const lobs = this.lobs;
    for (let i = 0; i < lobs.length; i++) if (this.stepLob(lobs[i], dt)) lobs[n++] = lobs[i];
    lobs.length = n;
    n = 0;
    const spikes = this.spikes;
    for (let i = 0; i < spikes.length; i++) if (this.stepSpike(spikes[i], dt)) spikes[n++] = spikes[i];
    spikes.length = n;
    n = 0;
    const teles = this.teles;
    for (let i = 0; i < teles.length; i++) if (this.stepTele(teles[i], dt)) teles[n++] = teles[i];
    teles.length = n;
  }

  private stepTele(t: Telegraph, dt: number): boolean {
    t.age += dt;
    const u = t.age / Math.max(0.01, t.dur);
    const d = t.decal;
    d.time = this.clock;
    if (u < 1) {
      d.fill = u;
      d.opacity = 0.7 + 0.3 * Math.sin(this.clock * (10 + 12 * u)) * u;
      return true;
    }
    d.fill = 1.1;
    d.opacity = Math.max(0, 1 - (t.age - t.dur) / 0.2);
    if (t.age >= t.dur + 0.2) {
      d.release();
      return false;
    }
    return true;
  }

  /** 是否还有活动中的持续伤害区（例如判断熔岩外圈是否仍在） */
  activeZones(): number {
    let n = 0;
    for (const z of this.zones) if (!z.ended) n++;
    return n;
  }

  /** 取消全部任务并移除所有物体（Boss 死亡 / 释放时调用，可重复调用） */
  clear(): void {
    for (const c of this.cancels) c();
    this.cancels.clear();
    for (const w of this.waves) {
      w.wall.removeFromParent();
      releaseWaveWallMaterial(w.wallMat);
      w.band.release();
    }
    for (const z of this.zones) {
      z.ended = true;
      z.decal.release();
    }
    for (const l of this.lobs) l.obj.removeFromParent();
    for (const s of this.spikes) s.obj.removeFromParent();
    for (const t of this.teles) t.decal.release();
    for (const b of this.beams) b.release();
    this.waves.length = 0;
    this.zones.length = 0;
    this.lobs.length = 0;
    this.spikes.length = 0;
    this.teles.length = 0;
    this.beams.clear();
  }
}
