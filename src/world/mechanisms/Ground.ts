/**
 * 地面类机关：流沙（Unity Quicksand.cs）、地表牵引区（SurfaceZone.cs）、安全区（SafeZone.cs + SupplyCamp 的那一圈）。
 *
 * 流沙：圆形，脚踩进去就被往圆心拖（边上 pullEdge → 圆心 pullCore m/s，走碰撞世界的 moveBody），走路速度越往里越慢（slowEdge → slowCore），
 *   芯里跳不起来；在芯里「下沉度」按 sinkTime 秒涨满（离开芯 0.8/s 回落），涨满就被吞（扣 burst，沉 0.6 s 后托回）；
 *   敌人同样被拖、变慢（每 0.1 s 续 0.3 s），不会被吞；圈里不记安全落脚点。
 * 地表牵引（冰面 / 冻地）：玩家站在上面时地面加速 × accel、刹车 × friction（网页：玩家这一帧想要的速度变化只保留 accel / friction 那一份）；
 *   敌人移速变化同样变慢（网页没有 NavMeshAgent 的加速度：按 enemyAccel 把速度往上一帧拉）、急转按概率滑倒（眩晕 0.6 s + 顺惯性滑出去）。
 * 安全区：一圈敌人进不来（每 0.1 s 把身体进了圈的非首领挪到圈外 1.5 m 的导航点）；玩家进出时提示补给营。
 * 与 Unity 的差异：导航上不挖洞（地面敌人寻路还会往圈里走，靠挪出去兜底）；流沙面（Spiritfire/Water 漩涡模式的贴地圆片）没有，
 *   1-2 的流沙坑靠地形下陷 + 沙色地表读出来。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import type { V3 } from './LavaCore';
import type { MechanismHost } from './Host';
import type { QuicksandData, SafeZoneData, SupplyCampData, SurfaceProfile, SurfaceZoneData, ZoneArea } from './MechanismData';

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ───────────────────────────── 流沙 ─────────────────────────────

/** 流沙的几何与手感（纯函数，测试直接调；Unity Quicksand 的 Depth01 / PullAt / SlowAt） */
export const QuicksandMath = {
  /** 水平离圆心的比例（圆外 > 1）与竖直是否在沙面附近 */
  depth01(q: QuicksandData, feet: V3): { r01: number; vertical: boolean } {
    const c = q.position;
    return { r01: Math.hypot(feet.x - c[0], feet.z - c[2]) / Math.max(0.01, q.radius), vertical: feet.y <= c[1] + q.above && feet.y >= c[1] - q.below };
  },
  /** 离圆心 r 处的拉力（m/s）：边上 pullEdge，圆心 pullCore */
  pullAt(q: QuicksandData, r01: number): number {
    return r01 > 1 ? 0 : lerp(q.pullCore, q.pullEdge, clamp01(r01));
  },
  /** 离圆心 r 处的走路速度倍率 */
  slowAt(q: QuicksandData, r01: number): number {
    return r01 > 1 ? 1 : lerp(q.slowCore, q.slowEdge, clamp01((r01 * q.radius - q.coreRadius) / Math.max(0.01, q.radius - q.coreRadius)));
  },
  /** 脚下的流沙（最深的那个） */
  at(all: readonly QuicksandData[], feet: V3): { q: QuicksandData; r01: number } | null {
    let best: QuicksandData | null = null, r = Number.MAX_VALUE;
    for (const q of all) {
      const d = QuicksandMath.depth01(q, feet);
      if (!d.vertical || d.r01 > 1 || d.r01 >= r) continue;
      r = d.r01;
      best = q;
    }
    return best ? { q: best, r01: r } : null;
  },
};

const SAND = '#dbb880', SAND_HEX = 0xdbb880;
const SOURCE = 'mechanism.quicksand';

export class QuicksandField {
  /** 玩家的下沉度 0..1、这一帧踩在流沙里、被吞的次数 */
  playerSink = 0;
  playerInside = false;
  swallowed = 0;
  private enemyTimer = 0;
  private warnedAt = -10;
  private nextPuff = 0;
  private slow = 1;
  private jumpLocked = false;
  private readonly hazardOff: () => void;
  private readonly enemySlow = new Map<IEnemy, { mult: number; until: number }>();

  constructor(private readonly host: MechanismHost, readonly all: readonly QuicksandData[]) {
    this.hazardOff = host.safe.registerHazard(feet => QuicksandMath.at(all, feet) !== null);
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.tickPlayer(dt);
    this.enemyTimer -= dt;
    if (this.enemyTimer <= 0) {
      this.enemyTimer = 0.1;
      this.tickEnemies();
    }
    // 敌人移速：限时 0.3 s，每 0.1 s 续一次（Unity world.quicksand 通道）
    const now = this.host.ctx.time.now;
    for (const [e, s] of this.enemySlow) {
      if (!e.alive || now > s.until) { this.enemySlow.delete(e); continue; }
      e.slowMult = Math.min(e.slowMult, s.mult);
    }
  }

  private setPlayerSlow(mult: number, lockJump: boolean): void {
    const p = this.host.ctx.player;
    if (Math.abs(mult - this.slow) > 0.005 || lockJump !== this.jumpLocked) {
      p.stats.removeSource(SOURCE);
      if (mult < 1) p.stats.add('moveSpeed', -p.stats.getBase('moveSpeed') * (1 - mult), SOURCE);
      if (lockJump) p.stats.add('jumpVelocity', -p.stats.getBase('jumpVelocity'), SOURCE);
      this.slow = mult;
      this.jumpLocked = lockJump;
    }
  }

  private tickPlayer(dt: number): void {
    const ctx = this.host.ctx, p = ctx.player;
    if (!p.alive || this.host.safe.sinking) {
      this.playerInside = false;
      this.playerSink = Math.max(0, this.playerSink - dt);
      this.setPlayerSlow(1, false);
      return;
    }
    const feet = p.position;
    const hit = QuicksandMath.at(this.all, feet);
    this.playerInside = !!hit;
    if (!hit) {
      this.playerSink = Math.max(0, this.playerSink - dt * 0.8);
      this.setPlayerSlow(1, false);
      return;
    }
    const { q, r01 } = hit;
    const core = r01 * q.radius <= q.coreRadius;
    this.setPlayerSlow(QuicksandMath.slowAt(q, r01), core);
    // 拉力：往圆心拖（贴地时带一点向下，不被拖得离地）
    const dx = q.position[0] - feet.x, dz = q.position[2] - feet.z, dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      const step = Math.min(dist, QuicksandMath.pullAt(q, r01) * dt);
      _d.set(dx / dist * step, p.onGround ? -step : 0, dz / dist * step);
      ctx.world.moveBody(p.position, p.radius, p.height, _d, p.onGround, 0.35);
    }
    // 下沉：芯里涨，芯外回落
    this.playerSink = core ? this.playerSink + dt / Math.max(0.2, q.sinkTime) : Math.max(0, this.playerSink - dt * 0.8);
    const now = ctx.time.now;
    if (core) {
      if (now - this.warnedAt > 4) {
        this.warnedAt = now;
        ctx.ui.toast('流沙！冲刺脱身', SAND);
      }
      if (now >= this.nextPuff) {
        this.nextPuff = now + 0.25;
        ctx.fx.burst(_v.copy(feet).setY(feet.y + 0.15), SAND_HEX, 6, 2.2, 0.5, 0.22, 4);
        ctx.fx.shake(0.08 + 0.12 * this.playerSink, 0.15);
      }
    }
    if (this.playerSink >= 1) {
      this.playerSink = 0;
      this.swallowed++;
      this.setPlayerSlow(1, false);
      this.host.safe.sink({
        burst: q.burst, tick: 0, tickTimes: [], sinkTime: 0.6, grace: 1, element: 'none', flash: [0.62, 0.46, 0.28, 0.6], sound: 'land',
      });
    }
  }

  private tickEnemies(): void {
    const ctx = this.host.ctx, now = ctx.time.now;
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.flying) continue;
      const hit = QuicksandMath.at(this.all, e.position);
      if (!hit) continue;
      this.enemySlow.set(e, { mult: QuicksandMath.slowAt(hit.q, hit.r01), until: now + 0.3 });
      // 拉力：每 0.1 s 给 0.8 × 拉力的冲量 ≈ 以拉力的速度漂向圆心
      const dx = hit.q.position[0] - e.position.x, dz = hit.q.position[2] - e.position.z;
      const l = Math.hypot(dx, dz);
      if (l * l > 0.04) e.knockback(_d.set(dx / l, 0, dz / l).multiplyScalar(QuicksandMath.pullAt(hit.q, hit.r01) * 0.8));
    }
  }

  dispose(): void {
    this.hazardOff();
    this.host.ctx.player.stats.removeSource(SOURCE);
  }
}

// ───────────────────────────── 地表牵引 ─────────────────────────────

export const SurfaceProfiles = {
  ice(): SurfaceProfile { return { id: 'ice', title: '冰面', accel: 0.15, friction: 0.1, enemyAccel: 0.2, stumble: 0.35 }; },
  frost(): SurfaceProfile { return { id: 'frost', title: '冻地', accel: 0.25, friction: 0.2, enemyAccel: 0.35, stumble: 0.2 }; },
  normal(): SurfaceProfile { return { id: 'normal', title: '地面', accel: 1, friction: 1, enemyAccel: 1, stumble: 0 }; },
  /** 按强度 k 插值到地面（限时冻带淡出） */
  scaled(p: SurfaceProfile, k: number): SurfaceProfile {
    k = clamp01(k);
    return { id: p.id, title: p.title, accel: lerp(1, p.accel, k), friction: lerp(1, p.friction, k), enemyAccel: lerp(1, p.enemyAccel, k), stumble: p.stumble * k };
  },
};

const _inv = new THREE.Matrix4(), _l = new THREE.Vector3(), _top = new THREE.Vector3();

/** 一块牵引区的几何（Unity ZoneArea：Box = 挂件的单位立方体，Disc = 以位置为心的圆；竖直看顶面上下 above / below） */
export class ZoneShape {
  private readonly matrix = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  readonly top: number;

  constructor(readonly area: ZoneArea, matrix: readonly number[], private readonly center: readonly number[]) {
    this.matrix.fromArray(matrix as number[]);
    this.inverse.copy(this.matrix).invert();
    this.top = area.shape === 'box' ? _top.set(0, 0.5, 0).applyMatrix4(this.matrix).y : center[1];
  }

  /** 水平在区域里的程度：Box 1 / −1；Disc 1 − r / R，区域外 −1 */
  horizontal(p: V3): number {
    if (this.area.shape === 'box') {
      _l.set(p.x, p.y, p.z).applyMatrix4(this.inverse);
      return Math.abs(_l.x) <= 0.5 && Math.abs(_l.z) <= 0.5 ? 1 : -1;
    }
    const r = Math.hypot(p.x - this.center[0], p.z - this.center[2]);
    return r <= this.area.radius ? 1 - r / Math.max(0.01, this.area.radius) : -1;
  }

  contains(feet: V3): boolean {
    if (this.horizontal(feet) < 0) return false;
    return feet.y <= this.top + this.area.above && feet.y >= this.top - this.area.below;
  }
}

interface Zone { shape: ZoneShape; profile: SurfaceProfile; lifetime: number; fadeTime: number; age: number }

/** 场上的牵引区：脚下最滑的那块（按 accel × friction 取小） */
export function sampleSurface(zones: readonly Zone[], feet: V3): SurfaceProfile | null {
  let best: SurfaceProfile | null = null;
  for (const z of zones) {
    if (!z.shape.contains(feet)) continue;
    const strength = z.lifetime > 0 && z.fadeTime > 0 ? clamp01((z.lifetime - z.age) / z.fadeTime) : 1;
    const s = SurfaceProfiles.scaled(z.profile, strength);
    if (!best || s.accel * s.friction < best.accel * best.friction) best = s;
  }
  return best;
}

/** 一帧的地面速度变化按牵引打折（Unity MotorFrame 的 groundAccelMult / groundFrictionMult 落到网页的「速度变化只保留一份」） */
export function tractionVelocity(prevX: number, prevZ: number, wantX: number, wantZ: number, p: SurfaceProfile): [number, number] {
  // 速度变大（加速）按 accel、变小（刹车 / 超速回落）按 friction
  const prevSpeed = Math.hypot(prevX, prevZ), wantSpeed = Math.hypot(wantX, wantZ);
  const k = wantSpeed > prevSpeed + 1e-4 ? p.accel : p.friction;
  return [prevX + (wantX - prevX) * k, prevZ + (wantZ - prevZ) * k];
}

export class SurfaceField {
  readonly zones: Zone[];
  playerSurface: SurfaceProfile = SurfaceProfiles.normal();
  playerOnSurface = false;
  stumbles = 0;
  private enemyTimer = 0;
  private prevX = 0;
  private prevZ = 0;
  private prevFrame = -10;
  private readonly enemies = new Map<IEnemy, { vx: number; vz: number; nextStumble: number }>();

  constructor(private readonly host: MechanismHost, data: readonly SurfaceZoneData[]) {
    this.zones = data.map(d => ({ shape: new ZoneShape(d.area, d.matrix, d.position), profile: d.profile, lifetime: d.lifetime, fadeTime: d.fadeTime, age: 0 }));
  }

  update(dt: number): void {
    for (const z of this.zones) z.age += dt;
    this.tickPlayer();
    this.enemyTimer -= dt;
    const tick = this.enemyTimer <= 0;
    if (tick) this.enemyTimer = 0.1;
    this.tickEnemies(dt, tick);
  }

  /**
   * 玩家：站在地上、在牵引区里时，这一帧玩家控制器算出来的速度变化（相对上一帧记下的速度）只保留 accel / friction 那一份——
   * 起步拖、急停滑、冲刺余速滑得更远（同网页 FrostRangedFx 的冰面做法；冲刺 / 突进中不改）
   */
  private tickPlayer(): void {
    const ctx = this.host.ctx, p = ctx.player, v = p.velocity;
    const frame = ctx.time.frame;
    const s = p.alive && p.onGround ? sampleSurface(this.zones, p.position) : null;
    this.playerOnSurface = !!s;
    this.playerSurface = s ?? SurfaceProfiles.normal();
    if (s && !p.isDashing && !p.isLunging && this.prevFrame === frame - 1) {
      const [nx, nz] = tractionVelocity(this.prevX, this.prevZ, v.x, v.z, s);
      v.x = nx;
      v.z = nz;
    }
    this.prevX = v.x;
    this.prevZ = v.z;
    this.prevFrame = frame;
  }

  private tickEnemies(dt: number, tick: boolean): void {
    const ctx = this.host.ctx, now = ctx.time.now;
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.flying) continue;
      const s = sampleSurface(this.zones, e.position);
      let st = this.enemies.get(e);
      if (!s) {
        if (st) this.enemies.delete(e);
        continue;
      }
      if (!st) {
        st = { vx: e.velocity.x, vz: e.velocity.z, nextStumble: 0 };
        this.enemies.set(e, st);
      }
      // 加速度 × enemyAccel：速度变化只保留一份（转向、停下都慢）
      const k = Math.max(0.05, s.enemyAccel);
      const nx = st.vx + (e.velocity.x - st.vx) * k, nz = st.vz + (e.velocity.z - st.vz) * k;
      const wantX = e.velocity.x, wantZ = e.velocity.z;
      e.velocity.x = nx;
      e.velocity.z = nz;
      st.vx = nx;
      st.vz = nz;
      if (tick) this.tryStumble(e, st, s, nx, nz, wantX, wantZ, now);
      void dt;
    }
  }

  /** 急转打滑：实际速度与想去的方向差 60° 以上、速度 > 2.5 m/s、冷却过了，按概率滑倒（首领不滑倒） */
  private tryStumble(e: IEnemy, st: { nextStumble: number }, s: SurfaceProfile, vx: number, vz: number, wx: number, wz: number, now: number): void {
    if (s.stumble <= 0 || now < st.nextStumble || e.isBoss) return;
    const v = Math.hypot(vx, vz), w = Math.hypot(wx, wz);
    if (v < 2.5 || w < 0.5) return;
    if ((vx * wx + vz * wz) / (v * w) > 0.5) return;
    st.nextStumble = now + 3;
    if (Math.random() > s.stumble) return;
    this.stumble(e, vx, vz);
  }

  stumble(e: IEnemy, vx: number, vz: number): void {
    const ctx = this.host.ctx;
    this.stumbles++;
    if (!e.stunImmune) ctx.combat.applyStatus(e, 'stun', 0, 0.6);
    e.knockback(_d.set(vx * 0.8, 0, vz * 0.8));
    ctx.fx.burst(_v.copy(e.position).setY(e.position.y + 0.2), 0xc7edff, 10, 3.5, 0.5, 0.1, 9);
    ctx.fx.damageNumber(_v.copy(e.position).setY(e.position.y + 1.6), 0, { kind: 'reaction', text: '滑倒', color: 0xc7edff });
  }
}

// ───────────────────────────── 安全区 ─────────────────────────────

/** 纯几何（Unity SafeZone.Inside / PushOut） */
export const SafeZoneMath = {
  inside(center: readonly number[], radius: number, height: number, p: V3, pad = 0): boolean {
    if (Math.abs(p.y - center[1]) > height) return false;
    const dx = p.x - center[0], dz = p.z - center[2], r = radius + pad;
    return dx * dx + dz * dz <= r * r;
  },
  /** 把 p 推到圈外：沿中心 → p 的水平方向到 半径 + extra 处（p 正在中心时朝 +X），高度不变 */
  pushOut(center: readonly number[], radius: number, p: V3, extra: number): V3 {
    let dx = p.x - center[0], dz = p.z - center[2];
    const l = Math.hypot(dx, dz);
    if (l * l > 1e-4) { dx /= l; dz /= l; } else { dx = 1; dz = 0; }
    return { x: center[0] + dx * (radius + extra), y: p.y, z: center[2] + dz * (radius + extra) };
  },
};

interface SafeZoneRt { d: SafeZoneData; radius: number; camp: SupplyCampData | null; inside: boolean; announced: boolean }

export class SafeZones {
  readonly zones: SafeZoneRt[];
  ejected = 0;
  private timer = 0;

  constructor(private readonly host: MechanismHost, data: readonly SafeZoneData[], camps: readonly SupplyCampData[]) {
    this.zones = data.map(d => {
      const camp = camps.find(c => c.scenePath === d.scenePath) ?? null;
      // SupplyCamp.Build：Zone.radius = max(Zone.radius, safeRadius)
      return { d, radius: camp ? Math.max(d.radius, camp.safeRadius) : d.radius, camp, inside: false, announced: false };
    });
  }

  contains(p: V3, pad = 0): boolean {
    return this.zones.some(z => SafeZoneMath.inside(z.d.position, z.radius, z.d.height, p, pad));
  }

  update(dt: number): void {
    const ctx = this.host.ctx, p = ctx.player;
    for (const z of this.zones) {
      const inside = p.alive && SafeZoneMath.inside(z.d.position, z.radius, z.d.height, p.position);
      if (inside !== z.inside) {
        z.inside = inside;
        // 补给营：玩家第一次走进营地时提示（Unity SupplyCamp.OnPlayerInside）
        if (inside && z.camp && !z.announced) {
          z.announced = true;
          ctx.ui.toast(`${z.camp.label} · 可购买武器、秘卷、强化与战备补给；进入主战区才会迎战首领`, '#a9dec7');
        }
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    for (const z of this.zones) {
      for (const e of ctx.enemies.list) {
        if (!e.alive || e.isBoss) continue;
        if (!SafeZoneMath.inside(z.d.position, z.radius, z.d.height, e.position, e.radius * 0.5)) continue;
        this.eject(z, e);
      }
    }
  }

  /** 挪出去：放到圈外最近的导航点（同 Unstick） */
  private eject(z: SafeZoneRt, e: IEnemy): void {
    const t = SafeZoneMath.pushOut(z.d.position, z.radius, e.position, e.radius + z.d.pushMargin);
    _v.set(t.x, t.y, t.z);
    if (this.host.ctx.nav.nearestWalkable(_v, _d) && _d.distanceTo(_v) <= 4 && !SafeZoneMath.inside(z.d.position, z.radius, z.d.height, _d, e.radius * 0.5)) _v.copy(_d);
    e.position.copy(_v);
    e.velocity.set(0, 0, 0);
    this.ejected++;
  }
}
