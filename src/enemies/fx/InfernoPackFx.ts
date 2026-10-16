/**
 * 第三章群怪（炭童、祸斗）的贴合特效与投掷物：
 *
 * - 炭块：炭童从自己肩上掰下的红炭（不规则多面体 + 裂缝里透出的熔岩光），抛物线飞向落点（落点亮朱红预警圈），
 *   落地炸开一小团火、留下一片烧 2 秒的地火。余烬炭堆、复燃时飞回去拼合的炭块用同一个形状。
 * - 地火：流动的熔岩贴花 + 一簇跳动的火舌 + 火星，每 0.5 秒结算一次站在里面的玩家；登记到 FireFeed，
 *   祸斗吃掉时火舌一下子缩没、伤害立刻停。
 * - 炭块拼合：炭堆复燃时几块炭从堆上跳起来、飞回炭童身上。
 * - 吸火：祸斗吃火时火舌和火星被一股一股吸进嘴里。
 * - 吐火：地面朱红扇形预警（前摇期间由内向外填满），喷出时一串火舌沿扇形往外冲、贴地拖出火星。
 * - 命中球：长条四足身体用几颗挂在骨骼上的球做命中判定（竖直胶囊包不住）。
 *
 * 预警色用饱和的朱红 + 黄白芯：玄武岩地面很暗，加法叠加的朱红最醒目；熔岩橙的地面上浅橙会被吃掉，所以不用橙色预警。
 * 几何体模块级缓存，炭块 / 火舌走对象池（挂在 ctx.stageGroup 上，换关时被摘下，下次取用时重新挂上）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { clamp01, raySphere } from '../../core/math';
import { blastPlayer, zonePlayer } from '../Hazards';
import { flat } from '../Models';
import { GroundDecal } from '../bosses/Visuals';
import { FLAME_FX_TIME, createFlameTongue, type FlameTongue } from './FlameFx';
import { registerFloorFire, type FloorFireHandle } from '../inferno/FireFeed';

export const INFERNO = {
  coal: 0x2a211e, coalHi: 0x4a3a32, crack: 0xff5a14, crackHot: 0xffd27a, ember: 0xff7a2a, spark: 0xffb040,
  smoke: 0x3a302c, ash: 0x6a5c54, burn: 0xff6a1a,
  /** 地面预警：饱和朱红（加法叠加在黑色玄武岩上最醒目） */
  warn: 0xff2a12,
  /** 吐火扇形的芯色 */
  warnHot: 0xffe060,
};

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _chest = new THREE.Vector3();

interface Pooled {
  obj: THREE.Object3D;
  busy: boolean;
}

function acquire(pool: Pooled[], ctx: GameContext, make: () => THREE.Object3D): Pooled {
  let p = pool.find((x) => !x.busy);
  if (!p) {
    p = { obj: make(), busy: false };
    pool.push(p);
  }
  p.busy = true;
  if (p.obj.parent !== ctx.stageGroup) ctx.stageGroup.add(p.obj);
  p.obj.visible = true;
  p.obj.scale.setScalar(1);
  return p;
}

function release(p: Pooled): void {
  p.busy = false;
  p.obj.visible = false;
}

// ───────────────────────────── 炭块 ─────────────────────────────

let coalGeo: THREE.BufferGeometry | null = null;
/** 不规则的炭块（按方向拉伸的十二面体，半径约 1） */
export function coalGeometry(): THREE.BufferGeometry {
  if (coalGeo) return coalGeo;
  const g = new THREE.DodecahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const k = 0.8 + 0.3 * Math.abs(Math.sin(_p.x * 5.3 + _p.y * 7.7 + _p.z * 2.9));
    _p.multiplyScalar(k);
    _p.y *= 0.85;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  coalGeo = g;
  return g;
}

/**
 * 一块炭（半径 1，用 scale 定大小）：黑炭外壳（低多边形、受光）+ 稍大一圈的加法发光层（裂缝里的熔岩光，
 * 只在棱角处露出来）。返回 { group, glow }：glow 的颜色由调用方写（越亮越热）。
 */
export function createCoalChunk(): { group: THREE.Group; glow: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(coalGeometry(), flat(INFERNO.coal, { rough: 0.9, emissive: 0x3a0e04 })));
  const glow = new THREE.MeshBasicMaterial({
    color: INFERNO.crack, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const shell = new THREE.Mesh(coalGeometry(), glow);
  shell.scale.setScalar(1.07);
  shell.rotation.set(0.5, 1.1, 0.2);
  shell.renderOrder = 2;
  g.add(shell);
  return { group: g, glow };
}

const coalPool: (Pooled & { glow: THREE.MeshBasicMaterial })[] = [];

function acquireCoal(ctx: GameContext): Pooled & { glow: THREE.MeshBasicMaterial } {
  let p = coalPool.find((x) => !x.busy);
  if (!p) {
    const c = createCoalChunk();
    p = { obj: c.group, busy: false, glow: c.glow };
    coalPool.push(p);
  }
  p.busy = true;
  if (p.obj.parent !== ctx.stageGroup) ctx.stageGroup.add(p.obj);
  p.obj.visible = true;
  p.glow.color.setHex(INFERNO.crack);
  return p;
}

export interface CoalSpec {
  from: THREE.Vector3;
  target: THREE.Vector3;
  flightTime: number;
  /** 炭块半径（米） */
  size: number;
  /** 落地炸开的伤害半径（米） */
  radius: number;
  damage: number;
  /** 落地留下的地火：半径、秒数、每 0.5 秒一跳的伤害 */
  burnRadius: number;
  burnTime: number;
  burnDamage: number;
  source: IEnemy | null;
}

/** 正在飞的炭块（测试与调试用） */
export interface CoalFlight {
  readonly done: boolean;
  /** 落地后留下的地火（没落地 / 半路撞墙时为 null） */
  readonly fire: FloorFireHandle | null;
}

/** 抛出炭块：抛物线飞向落点（朱红预警圈同步填满），落地炸开、留下一片地火；半路砸到玩家 / 撞墙当场炸开 */
export function launchCoal(ctx: GameContext, spec: CoalSpec): CoalFlight {
  const T = Math.max(0.3, spec.flightTime);
  const g = 22;
  const pos = spec.from.clone();
  const vel = new THREE.Vector3().subVectors(spec.target, spec.from).divideScalar(T);
  vel.y += 0.5 * g * T;
  const slot = acquireCoal(ctx);
  const obj = slot.obj;
  obj.scale.setScalar(spec.size);
  obj.position.copy(pos);
  const spin = new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
  const cancelWarning = ctx.fx.groundWarning(spec.target, spec.radius, T, INFERNO.warn);
  let age = 0;
  let trail = 0;
  const state = { done: false, fire: null as FloorFireHandle | null };
  const burst = (at: THREE.Vector3, landed: boolean): void => {
    state.done = true;
    if (!landed) cancelWarning();
    release(slot);
    blastPlayer(ctx, at, spec.radius, spec.damage, 'fire', spec.source, 0.4, 0.3, 3);
    ctx.fx.burst(at, INFERNO.spark, 14, 4, 0.5, 0.07, 6);
    ctx.fx.burst(at, INFERNO.ember, 8, 2, 0.6, 0.2, -1);
    ctx.fx.burst(at, INFERNO.coal, 6, 2.5, 0.6, 0.06, 9);
    ctx.audio.play('land', { position: at, volume: 0.6, pitch: 1.3 });
    // 落地 / 砸在玩家身上 / 撞墙：炭块碎在脚下的地面上烧起来（悬空太高就不留）
    const gy = ctx.world.groundHeight(at.x, at.z, at.y + (landed ? 1 : 0.2));
    if (!Number.isFinite(gy) || at.y - gy > 2.2) return;
    const ground = new THREE.Vector3(at.x, gy, at.z);
    state.fire = spawnFloorFire(ctx, ground, spec.burnRadius, spec.burnTime, spec.burnDamage, spec.source);
  };
  ctx.tasks.add((dt) => {
    if (state.done) return true;
    age += dt;
    _p.copy(pos);
    vel.y -= g * dt;
    pos.addScaledVector(vel, dt);
    obj.position.copy(pos);
    obj.rotation.x += spin.x * dt;
    obj.rotation.y += spin.y * dt;
    obj.rotation.z += spin.z * dt;
    slot.glow.color.setHex(Math.sin(age * 40) > 0 ? INFERNO.crackHot : INFERNO.crack);
    trail += dt;
    if (trail > 0.05) {
      trail = 0;
      ctx.fx.burst(pos, INFERNO.ember, 1, 0.3, 0.35, 0.12 * spec.size / 0.12, -0.5);
      ctx.fx.burst(pos, INFERNO.smoke, 1, 0.2, 0.5, 0.16, -0.8);
    }
    const p = ctx.player;
    _chest.set(p.position.x, p.position.y + p.height * 0.5, p.position.z);
    if (p.alive && pos.distanceTo(_chest) < spec.size + p.radius + 0.25) {
      burst(pos.clone(), false);
      return true;
    }
    if (age > 0.08 && ctx.world.segmentBlocked(_p, pos)) {
      burst(_p.clone(), false);
      return true;
    }
    if (age >= T) {
      const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 1.5);
      if (!Number.isFinite(gy) || pos.y <= gy + spec.size || age >= T + 0.8) {
        if (Number.isFinite(gy)) pos.y = Math.max(gy, Math.min(pos.y, gy + spec.size));
        burst(pos.clone(), true);
        return true;
      }
    }
    return false;
  });
  return state;
}

// ───────────────────────────── 地火 ─────────────────────────────

const tonguePool: FlameTongue[] = [];

function acquireTongue(parent: THREE.Object3D): FlameTongue {
  const t = tonguePool.pop() ?? createFlameTongue();
  t.material.uniforms.uSeed.value = Math.random();
  t.material.uniforms.uAlpha.value = 1;
  t.visible = true;
  parent.add(t);
  return t;
}

function releaseTongue(t: FlameTongue): void {
  t.removeFromParent();
  t.visible = false;
  tonguePool.push(t);
}

/**
 * 一片地火：流动的熔岩贴花、一簇跳动的火舌、火星；每 0.5 秒对站在里面的玩家结算 damage 点火伤。
 * 登记到 FireFeed（祸斗能吃）：被吃掉时火舌 0.3 秒内缩没、伤害立刻停。返回登记句柄。
 */
export function spawnFloorFire(ctx: GameContext, ground: THREE.Vector3, radius: number, seconds: number, damage: number, source: IEnemy | null): FloorFireHandle {
  const decal = GroundDecal.acquire(ctx.stageGroup, INFERNO.burn).circle(ground.x, ground.y, ground.z, radius);
  decal.pattern = 1;
  const n = Math.max(3, Math.round(radius * 5));
  const items: { t: FlameTongue; base: number; phase: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = acquireTongue(ctx.stageGroup);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 0.75;
    t.position.set(ground.x + Math.cos(a) * r, ground.y + 0.02, ground.z + Math.sin(a) * r);
    items.push({ t, base: 0.55 * (0.6 + Math.random() * 0.6), phase: Math.random() * 10 });
  }
  let t = 0, tick = 0.5, sparks = 0;
  let out = -1;
  const handle = registerFloorFire(ctx, ground, radius, seconds, () => {
    out = 0;
  });
  ctx.tasks.add((dt) => {
    t += dt;
    FLAME_FX_TIME.value = ctx.time.now;
    decal.time = t;
    const life = out >= 0 ? Math.max(0, 1 - out / 0.3) : Math.min(1, Math.max(0, (seconds - t) / 0.6));
    decal.opacity = (t < 0.15 ? t / 0.15 : 1) * life;
    for (const it of items) {
      const pulse = 0.75 + 0.35 * Math.sin(t * 9 + it.phase) + 0.15 * Math.sin(t * 23 + it.phase * 2);
      const s = it.base * Math.min(1, t / 0.2) * life;
      it.t.scale.set(s * 0.9, Math.max(0.01, s * pulse * 1.4), s);
      it.t.material.uniforms.uAlpha.value = 0.9 * life;
    }
    if (out >= 0) {
      out += dt;
    } else {
      tick -= dt;
      if (tick <= 0) {
        tick += 0.5;
        zonePlayer(ctx, ground, radius, damage, 'fire', source);
      }
      sparks += dt;
      if (sparks > 0.12 && t < seconds - 0.4) {
        sparks = 0;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * radius;
        _p.set(ground.x + Math.cos(a) * rr, ground.y + 0.1, ground.z + Math.sin(a) * rr);
        ctx.fx.burst(_p, Math.random() < 0.5 ? INFERNO.ember : INFERNO.spark, 1, 1.0, 0.6, 0.07, -3);
      }
    }
    if ((out >= 0 && out >= 0.3) || t >= seconds) {
      for (const it of items) releaseTongue(it.t);
      decal.release();
      handle.remove();
      return true;
    }
    return false;
  });
  return handle;
}

// ───────────────────────────── 炭块拼合 / 吸火 ─────────────────────────────

/**
 * 炭堆复燃：count 块炭从 from（炭堆）跳起来，沿弧线飞回 to()（站起来的炭童身体，每帧取当前位置），约 0.55 秒。
 */
export function reassembleCoals(ctx: GameContext, from: THREE.Vector3, to: () => THREE.Vector3, count: number, size: number): void {
  const items: { slot: Pooled & { glow: THREE.MeshBasicMaterial }; start: THREE.Vector3; delay: number; spin: THREE.Vector3 }[] = [];
  for (let i = 0; i < count; i++) {
    const slot = acquireCoal(ctx);
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const start = new THREE.Vector3(from.x + Math.cos(a) * 0.25, from.y + 0.08, from.z + Math.sin(a) * 0.25);
    slot.obj.position.copy(start);
    slot.obj.scale.setScalar(size * (0.7 + Math.random() * 0.5));
    items.push({ slot, start, delay: i * 0.05, spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, 0) });
  }
  let t = 0;
  const DUR = 0.45;
  ctx.tasks.add((dt) => {
    t += dt;
    const target = to();
    let done = true;
    for (const it of items) {
      const u = clamp01((t - it.delay) / DUR);
      if (u < 1) done = false;
      const e = u * u * (3 - 2 * u);
      it.slot.obj.position.lerpVectors(it.start, target, e);
      it.slot.obj.position.y += Math.sin(u * Math.PI) * 0.6;
      it.slot.obj.rotation.x += it.spin.x * dt;
      it.slot.obj.rotation.y += it.spin.y * dt;
      it.slot.glow.color.setHex(u > 0.5 ? INFERNO.crackHot : INFERNO.crack);
    }
    if (done || t > 1.2) {
      for (const it of items) release(it.slot);
      ctx.fx.burst(target, INFERNO.spark, 16, 3, 0.4, 0.07, 2);
      return true;
    }
    return false;
  });
}

/** 吸火：从 from（火）到 mouth()（祸斗嘴，每帧取当前位置），火星和小火舌一股一股被吸进去，持续 duration 秒 */
export function suckFire(ctx: GameContext, from: THREE.Vector3, mouth: () => THREE.Vector3, duration: number): void {
  const streams: { t: FlameTongue; u: number; off: THREE.Vector3 }[] = [];
  let t = 0, emit = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    FLAME_FX_TIME.value = ctx.time.now;
    const m = mouth();
    emit -= dt;
    if (t < duration && emit <= 0) {
      emit = 0.07;
      const tg = acquireTongue(ctx.stageGroup);
      const a = Math.random() * Math.PI * 2;
      streams.push({ t: tg, u: 0, off: new THREE.Vector3(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3) });
      _p.copy(from).add(streams[streams.length - 1].off);
      ctx.fx.burst(_p, INFERNO.spark, 2, 0.8, 0.3, 0.06, 0);
    }
    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i];
      s.u += dt / 0.35;
      _p.copy(from).add(s.off);
      s.t.position.lerpVectors(_p, m, Math.min(1, s.u * s.u));
      const k = 0.35 * (1 - s.u * 0.7);
      s.t.scale.set(k * 0.7, k, k);
      s.t.material.uniforms.uAlpha.value = 0.95;
      if (s.u >= 1) {
        releaseTongue(s.t);
        streams.splice(i, 1);
      }
    }
    if (Math.random() < dt * 30) {
      _q.lerpVectors(from, m, Math.random());
      ctx.fx.burst(_q, INFERNO.ember, 1, 0.3, 0.25, 0.08, 0);
    }
    if (t >= duration && streams.length === 0) return true;
    return t > duration + 2;
  });
}

// ───────────────────────────── 吐火 ─────────────────────────────

/**
 * 祸斗的吐火：先在地面画朱红扇形预警（arm 前摇期间由内向外填满，芯色黄白），喷出时火舌沿扇形往外冲。
 * 纯视觉；伤害由祸斗按同一扇形结算。
 */
export class BreathCone {
  private decal: GroundDecal | null;
  private core: GroundDecal | null;
  private readonly jets: { t: FlameTongue; age: number; life: number; dir: THREE.Vector3; speed: number; from: THREE.Vector3 }[] = [];
  private firing = false;
  private emit = 0;
  private released = false;

  constructor(
    private readonly ctx: GameContext, readonly origin: THREE.Vector3, readonly yaw: number,
    readonly range: number, readonly halfAngle: number,
    /** 火舌出口（嘴）离地高度（米） */
    private readonly mouthHeight = 0.75,
  ) {
    this.decal = GroundDecal.acquire(ctx.stageGroup, INFERNO.warn).circle(origin.x, origin.y, origin.z, range, 0, yaw, halfAngle);
    this.core = GroundDecal.acquire(ctx.stageGroup, INFERNO.warnHot).circle(origin.x, origin.y + 0.005, origin.z, 0.1, 0, yaw, halfAngle * 0.35);
    this.decal.fill = 0;
    this.core.opacity = 0.6;
    ctx.tasks.add((dt) => this.tick(dt));
  }

  /** 前摇进度 0..1：扇形由内向外填满 */
  arm(t: number): void {
    if (!this.decal || !this.core) return;
    this.decal.fill = clamp01(t);
    this.decal.opacity = 0.75 + 0.25 * Math.sin(t * 30);
    this.core.setRadii(Math.max(0.1, this.range * clamp01(t)));
  }

  /** 开始喷：火舌从 mouth 沿扇形往外冲（直到 release） */
  fire(): void {
    this.firing = true;
    if (this.decal) this.decal.fill = 1;
  }

  /** 收起预警并停止喷火（已经喷出去的火舌飞完自己消失） */
  release(): void {
    this.firing = false;
    this.decal?.release();
    this.core?.release();
    this.decal = null;
    this.core = null;
    this.released = true;
  }

  private tick(dt: number): boolean {
    const ctx = this.ctx;
    FLAME_FX_TIME.value = ctx.time.now;
    if (this.firing) {
      this.emit -= dt;
      while (this.emit <= 0) {
        this.emit += 0.025;
        const a = this.yaw + (Math.random() * 2 - 1) * this.halfAngle * 0.85;
        const t = acquireTongue(ctx.stageGroup);
        const from = this.origin.clone();
        from.y += this.mouthHeight;
        this.jets.push({ t, age: 0, life: 0.38 + Math.random() * 0.12, dir: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), speed: this.range / 0.42, from });
      }
    }
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.age += dt;
      const u = j.age / j.life;
      const d = Math.min(this.range, j.speed * j.age);
      j.t.position.copy(j.from).addScaledVector(j.dir, d);
      // 越往外越贴地、越大，末端翻卷变淡
      j.t.position.y = j.from.y - this.mouthHeight * 0.85 * Math.min(1, u * 1.4);
      const s = 0.35 + 1.1 * u;
      j.t.scale.set(s * 1.1, s * (1.2 - 0.4 * u), s);
      j.t.material.uniforms.uAlpha.value = Math.max(0, 1 - u * u);
      if (Math.random() < dt * 12) ctx.fx.burst(j.t.position, INFERNO.spark, 1, 1.2, 0.4, 0.06, -2);
      if (u >= 1) {
        releaseTongue(j.t);
        this.jets.splice(i, 1);
      }
    }
    return this.released && this.jets.length === 0;
  }
}

// ───────────────────────────── 命中球 ─────────────────────────────

export interface HitSphere {
  anchor: THREE.Object3D;
  /** 半径（模型单位） */
  r: number;
  /** 弱点（算爆头） */
  head: boolean;
}

const _hv = new THREE.Vector3();
const _hw = new THREE.Vector3();

/**
 * 射线对一组命中球：取最近的一颗；弱点优先（只有身体球明显更近时才算身体），与 EnemyBase.raycastHit 的约定一致。
 * scale = 模型单位 → 世界的缩放（sizeScale × 体型成长）。
 */
export function raycastSpheres(
  spheres: readonly HitSphere[], scale: number, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
  out: { distance: number; headshot: boolean }, weakScale = 1,
): boolean {
  let bestHead = -1, bestBody = -1, headR = 0;
  for (const s of spheres) {
    s.anchor.getWorldPosition(_hv);
    const r = s.r * scale * (s.head ? weakScale : 1);
    const t = raySphere(origin, dir, _hv, r);
    if (t < 0 || t > maxDist) continue;
    if (s.head) {
      if (bestHead < 0 || t < bestHead) { bestHead = t; headR = r; }
    } else if (bestBody < 0 || t < bestBody) bestBody = t;
  }
  if (bestHead < 0 && bestBody < 0) return false;
  if (bestHead >= 0 && (bestBody < 0 || bestBody >= bestHead - headR * 0.5)) {
    out.distance = bestHead;
    out.headshot = true;
  } else {
    out.distance = bestBody;
    out.headshot = false;
  }
  return true;
}

/** 在 parent 上挂一个命中锚点 / 特效挂点，位置给的是 host（模型根）空间坐标 */
export function hostAnchor(parent: THREE.Object3D, host: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const a = new THREE.Object3D();
  parent.add(a);
  host.updateWorldMatrix(true, true);
  a.position.copy(parent.worldToLocal(host.localToWorld(_hw.set(x, y, z))));
  return a;
}
