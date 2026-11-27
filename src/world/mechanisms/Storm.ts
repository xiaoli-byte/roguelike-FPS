/**
 * 第四章雷暴（Unity PlateauStorm.cs + LightningStrike.cs + Conductor.cs）：
 *   导体（经幡杆、碉楼…）：落点在 attractRadius 内、顶比落点高 1 m 以上的导体里最高的那根把雷引走（劈在顶上，伤害按导体的溅电）；
 *     被劈中充电（chargePerStrike），每秒掉 drainPerSecond，电量 ≥ chargedAt 时冒电弧。
 *   落雷：排一道雷（预警 warn 秒：危险填充圈 + 紫红雷标），落下时画雷柱、闪光、震屏，按半径伤玩家（距离衰减到 0.6）、给落点里的敌人带电。
 *   雷暴：多个来源同时要雷暴（夔、大鹗、4-2 地图）各拿一张票，强度取最大；票有入场条件、渐入 / 渐出、退场回调；
 *     强度 ≥ strikesFrom 时按间隔在玩家周围 20–110 m 落雷；主光压暗（只剩 1 − darken）、雾往青灰收、环境光跟着压、一层后处理（压曝光、降饱和、偏冷）、
 *     斜雨丝跟着相机；每道雷劈下时天空闪一下。
 * 第四章三领主（夔 / 飞廉 / 化蛇）还没并进网页的首领框架（M6 待办）：雷暴现在没有来源会开——机关系统挂了调试入口
 * （window.__mechanisms.storm()），领主接进来以后直接 begin()。带电（Charge）状态随 M8。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { ConductorData } from './MechanismData';
import type { PostLayerFn } from './Weather';
import { stylizedShared } from '../UnityStylizedLit';
import { THUNDER } from './Telegraph';

const _v = new THREE.Vector3();
const THUNDER_CORE = 0xfff2fb;

/** 导体（Unity Conductor） */
export class Conductor {
  charge = 0;
  strikes = 0;
  lastStruckAt = -Infinity;
  private crackle = 0;
  enabled = true;

  constructor(readonly d: Pick<ConductorData, 'height' | 'attractRadius' | 'canCharge' | 'chargePerStrike' | 'drainPerSecond' | 'chargedAt' | 'splashRadius' | 'splashDamage'>
    & { position: readonly number[]; scenePath?: string }) {}

  get base(): THREE.Vector3 { return new THREE.Vector3(this.d.position[0], this.d.position[1], this.d.position[2]); }
  get top(): THREE.Vector3 { return this.base.setY(this.d.position[1] + this.d.height); }
  get charged(): boolean { return this.d.canCharge && this.charge >= this.d.chargedAt && this.charge > 0; }

  addCharge(amount: number): void {
    if (!this.d.canCharge || !Number.isFinite(amount)) return;
    this.charge = Math.min(1, Math.max(0, this.charge + amount));
  }

  discharge(): number {
    const k = this.charge;
    this.charge = 0;
    return k;
  }

  onStruck(now: number): void {
    this.strikes++;
    this.lastStruckAt = now;
    this.addCharge(this.d.chargePerStrike);
  }

  update(ctx: GameContext | null, dt: number): void {
    if (this.charge > 0 && this.d.drainPerSecond > 0) this.charge = Math.max(0, this.charge - this.d.drainPerSecond * dt);
    if (!ctx || !this.charged) return;
    this.crackle -= dt;
    if (this.crackle > 0) return;
    this.crackle = (0.4 + (0.12 - 0.4) * this.charge) * (0.7 + Math.random() * 0.6);
    const top = this.top;
    if (ctx.camera.position.distanceToSquared(top) > 80 * 80) return;
    const down = top.clone().add(_v.set(Math.random() - 0.5, -(0.8 + Math.random() * Math.max(0.2, this.d.height * 0.4 - 0.8)), Math.random() - 0.5));
    ctx.fx.lightning(top, down, THUNDER);
  }

  /** 落点 point 被哪根导体引走（Unity Conductor.Best：attractRadius 内、顶比落点高 1 m 以上，取顶最高的） */
  static best(point: { x: number; y: number; z: number }, among: readonly Conductor[], exclude: Conductor | null = null): Conductor | null {
    let best: Conductor | null = null, bestY = -Infinity;
    for (const c of among) {
      if (c === exclude || !c.enabled) continue;
      const dx = c.d.position[0] - point.x, dz = c.d.position[2] - point.z;
      if (dx * dx + dz * dz > c.d.attractRadius * c.d.attractRadius) continue;
      const top = c.d.position[1] + c.d.height;
      if (top < point.y + 1 || top <= bestY) continue;
      best = c;
      bestY = top;
    }
    return best;
  }

  static nearestCharged(point: { x: number; z: number }, radius: number, among: readonly Conductor[]): Conductor | null {
    let best: Conductor | null = null, bd = radius * radius;
    for (const c of among) {
      if (!c.charged) continue;
      const dx = c.d.position[0] - point.x, dz = c.d.position[2] - point.z, d = dx * dx + dz * dz;
      if (d > bd) continue;
      bd = d;
      best = c;
    }
    return best;
  }
}

export interface StrikeOptions {
  warn?: number;
  radius?: number;
  damage?: number;
  ignoreConductors?: boolean;
  exclude?: Conductor | null;
  chargeFoes?: number;
  foeDamage?: number;
  noTelegraph?: boolean;
  height?: number;
  onLanded?: (info: StrikeInfo) => void;
}

export interface StrikeInfo {
  point: THREE.Vector3;
  aimed: THREE.Vector3;
  boltEnd: THREE.Vector3;
  radius: number;
  damage: number;
  conductor: Conductor | null;
  playerDamage: number;
}

interface Pending { point: THREE.Vector3; aimed: THREE.Vector3; conductor: Conductor | null; opts: StrikeOptions; warn: number; age: number; cancel: (() => void) | null }

export const STRIKE_DEFAULTS = { warn: 1.2, radius: 3.2, damage: 18, height: 60, maxPending: 48, markWidth: 0.35 } as const;

/** 落雷（Unity LightningStrike） */
export class LightningStrikes {
  count = 0;
  private readonly pending: Pending[] = [];
  private readonly landed: ((info: StrikeInfo) => void)[] = [];

  constructor(private readonly ctx: GameContext, private readonly conductors: () => readonly Conductor[]) {}

  onLanded(fn: (info: StrikeInfo) => void): void { this.landed.push(fn); }
  get pendingCount(): number { return this.pending.length; }

  /** 往下找地面（从 30 m 高打 80 m） */
  private ground(p: THREE.Vector3): THREE.Vector3 {
    const g = this.ctx.world.groundHeight(p.x, p.z, p.y + 30);
    return Number.isFinite(g) && g >= p.y - 50 ? new THREE.Vector3(p.x, g, p.z) : p.clone();
  }

  strike(pos: THREE.Vector3, o: StrikeOptions = {}): void {
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
    if (this.pending.length >= STRIKE_DEFAULTS.maxPending) this.land(0);
    const opts: StrikeOptions = { ...o, radius: o.radius && o.radius > 0 ? o.radius : STRIKE_DEFAULTS.radius, height: o.height && o.height > 0 ? o.height : STRIKE_DEFAULTS.height };
    const aimed = this.ground(pos);
    const conductor = o.ignoreConductors ? null : Conductor.best(aimed, this.conductors(), o.exclude ?? null);
    const point = conductor ? conductor.base : aimed;
    const warn = Math.max(0, Number.isFinite(o.warn ?? NaN) ? o.warn! : 0);
    let cancel: (() => void) | null = null;
    if (!o.noTelegraph && warn > 0) {
      const r = conductor ? conductor.d.splashRadius : opts.radius!;
      const fill = this.ctx.fx.groundWarning(point, r, warn, 0xff1c24);
      const mark = this.ctx.fx.groundWarning(point, r + STRIKE_DEFAULTS.markWidth, warn, THUNDER);
      cancel = () => { fill(); mark(); };
    }
    this.pending.push({ point, aimed, conductor, opts, warn, age: 0, cancel });
    if (warn <= 0) this.land(this.pending.length - 1);
  }

  clear(): void {
    for (const p of this.pending) p.cancel?.();
    this.pending.length = 0;
  }

  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (i >= this.pending.length) continue;
      const p = this.pending[i];
      p.age += dt;
      if (p.age >= p.warn) this.land(i);
    }
  }

  private land(i: number): void {
    const p = this.pending[i], o = p.opts, ctx = this.ctx;
    this.pending.splice(i, 1);
    const c = p.conductor && p.conductor.enabled ? p.conductor : null;
    const end = c ? c.top : p.point.clone();
    const info: StrikeInfo = {
      point: p.point, aimed: p.aimed, boltEnd: end, conductor: c, radius: c ? c.d.splashRadius : o.radius!, damage: c ? c.d.splashDamage : o.damage ?? 0, playerDamage: 0,
    };
    this.count++;
    this.bolt(end, info.point, info.radius, o.height!);
    if (info.damage > 0) info.playerDamage = this.blastPlayer(info.point, info.radius, info.damage);
    if ((o.chargeFoes ?? 0) > 0 || (o.foeDamage ?? 0) > 0) this.hitFoes(info.point, info.radius, o);
    if (c) c.onStruck(ctx.time.now);
    try { o.onLanded?.(info); } catch (err) { console.error('[Lightning] onLanded 出错', err); }
    for (const fn of this.landed) {
      try { fn(info); } catch (err) { console.error('[Lightning] Landed 出错', err); }
    }
  }

  /** Unity Combat.BlastPlayer(中心 + 0.3, 半径, 伤害, 衰减 0.6, 雷)：距离线性衰减到边上 0.6 */
  private blastPlayer(at: THREE.Vector3, radius: number, damage: number): number {
    const p = this.ctx.player;
    if (!p.alive) return 0;
    const c = at.clone().setY(at.y + 0.3);
    const d = p.position.distanceTo(c);
    if (d > radius) return 0;
    const k = 1 - (1 - 0.6) * Math.min(1, d / Math.max(0.01, radius));
    return this.ctx.combat.damagePlayer(damage * k, 'shock', null, c);
  }

  private hitFoes(at: THREE.Vector3, radius: number, o: StrikeOptions): void {
    for (const e of this.ctx.enemies.queryRadius(at, radius)) {
      if (!e.alive) continue;
      // 带电（Charge）随 M8：先按雷殛状态挂上
      if ((o.chargeFoes ?? 0) > 0) this.ctx.combat.applyStatus(e, 'shock', 0, o.chargeFoes);
      if ((o.foeDamage ?? 0) > 0) this.ctx.combat.damageEnemy(e, { base: o.foeDamage!, element: 'shock', source: 'status', canCrit: false, procDepth: 1 });
    }
  }

  private bolt(end: THREE.Vector3, ground: THREE.Vector3, radius: number, height: number): void {
    const ctx = this.ctx, R = (k: number) => (Math.random() * 2 - 1) * k;
    const top = end.clone().add(_v.set(R(8), height, R(8)));
    const a = top.clone().lerp(end, 0.38).add(_v.set(R(4), 0, R(4)));
    const b = top.clone().lerp(end, 0.74).add(_v.set(R(2.2), 0, R(2.2)));
    ctx.fx.lightning(top, a, THUNDER);
    ctx.fx.lightning(a, b, THUNDER);
    ctx.fx.lightning(b, end, THUNDER);
    ctx.fx.lightning(b, end, THUNDER_CORE);
    ctx.fx.burst(end, 0xff9ee8, 14, 7, 0.35, 0.12, 4);
    ctx.fx.ring(ground.clone().setY(ground.y + 0.05), Math.max(1.2, radius), THUNDER, 0.3);
    ctx.audio.play('shock_zap', { position: end, volume: 1, pitch: 0.55 });
    if (ctx.player.position.distanceTo(end) < 26) ctx.fx.shake(0.22, 0.3);
  }
}

export interface PlateauStormSpec {
  center?: THREE.Vector3;
  aroundPlayer?: boolean;
  strikeMin?: number;
  strikeMax?: number;
  intervalMin?: number;
  intervalMax?: number;
  warn?: number;
  strikeRadius?: number;
  damage?: number;
  chargeFoes?: number;
  strikesFrom?: number;
  fadeIn?: number;
  fadeOut?: number;
  darken?: number;
  rain?: number;
  enterWhen?: (() => boolean) | null;
  onEnter?: (() => void) | null;
  onExit?: (() => void) | null;
  onStrike?: ((info: StrikeInfo) => void) | null;
}

/** Unity PlateauStormSpec 的缺省值 */
export function stormSpec(o: PlateauStormSpec = {}): Required<Omit<PlateauStormSpec, 'center' | 'enterWhen' | 'onEnter' | 'onExit' | 'onStrike'>> & PlateauStormSpec {
  return {
    aroundPlayer: true, strikeMin: 20, strikeMax: 110, intervalMin: 2.5, intervalMax: 6.5, warn: 1.2, strikeRadius: 3.2, damage: 0, chargeFoes: 8,
    strikesFrom: 0.6, fadeIn: 3, fadeOut: 4, darken: 0.8, rain: 1, ...o,
  };
}

export type StormStage = 'waiting' | 'fadingIn' | 'full' | 'fadingOut' | 'done';

export class StormTicket {
  stage: StormStage = 'waiting';
  level = 0;
  nextStrike: number;
  constructor(readonly spec: ReturnType<typeof stormSpec>) {
    this.nextStrike = 0.5 + Math.random();
  }
  /** 开始退场（还在等入场条件的直接作废，不回调） */
  end(): void {
    if (this.stage === 'waiting') { this.stage = 'done'; return; }
    if (this.stage === 'fadingIn' || this.stage === 'full') this.stage = 'fadingOut';
  }
  get done(): boolean { return this.stage === 'done'; }
}

/** 雷暴满强度时：雾色 / 雾终点、后处理、环境光下限、雨量 */
export const STORM = {
  fog: [0.36, 0.37, 0.45] as const, fogEnd: 160, fogStart: 8, postExposure: -0.35, contrast: 6, saturation: -28,
  colorFilter: [0.86, 0.9, 1] as const, envFloor: 0.45, rainRate: 1400,
};

/** 一张票推进一帧（纯逻辑；返回要不要在这一帧落一道雷） */
export function stepTicket(t: StormTicket, dt: number, random: () => number = Math.random): boolean {
  const s = t.spec;
  switch (t.stage) {
    case 'waiting': {
      let go = true;
      try { go = !s.enterWhen || s.enterWhen(); } catch { go = true; }
      if (!go) return false;
      t.stage = 'fadingIn';
      s.onEnter?.();
      break;
    }
    case 'fadingIn':
      t.level = Math.min(1, t.level + dt / Math.max(0.01, s.fadeIn));
      if (t.level >= 1) t.stage = 'full';
      break;
    case 'fadingOut':
      t.level = Math.max(0, t.level - dt / Math.max(0.01, s.fadeOut));
      if (t.level <= 0) {
        t.stage = 'done';
        s.onExit?.();
        return false;
      }
      break;
  }
  if ((t.stage === 'fadingIn' || t.stage === 'full') && t.level >= s.strikesFrom) {
    t.nextStrike -= dt;
    if (t.nextStrike <= 0) {
      const lo = Math.max(0.2, s.intervalMin), hi = Math.max(s.intervalMin, s.intervalMax);
      t.nextStrike = lo + (hi - lo) * random();
      return true;
    }
  }
  return false;
}

/**
 * 关卡自己画天气（第四章网页原生的高原场景：plateau/stage/layer.ts 挂上）：挂上以后雷暴照样管票、落雷、导体、伤害，
 * 但不再压暗主光、改雾、压环境光、加后期层、画线段雨——强度和闪光每帧交给它，由高原自己的天气画出来（光、雾、天色、GPU 雨、淋湿）
 */
export const stormVisuals: { external: ((level: number, flash: number) => void) | null } = { external: null };

export class PlateauStorm {
  level = 0;
  flash = 0;
  readonly tickets: StormTicket[] = [];
  private sunBase = NaN;
  private lastSun = NaN;
  private fogBase: { color: THREE.Color; near: number; far: number } | null = null;
  private lastFog: { color: THREE.Color; near: number; far: number } | null = null;
  private layer: { priority: number; weight: number; overrides: Record<string, unknown> } | null = null;
  private layerOff: (() => void) | null = null;
  private rain: THREE.LineSegments | null = null;
  private readonly rainPos: Float32Array;
  private readonly rainCount = 900;
  private ambientBase: number[] | null = null;
  private shBase: THREE.Vector3[] | null = null;

  constructor(private readonly ctx: GameContext, private readonly strikes: LightningStrikes, private readonly sun: THREE.DirectionalLight | null,
    private readonly ambients: readonly THREE.Light[], private readonly addPostLayer: PostLayerFn | null, private readonly parent: THREE.Object3D) {
    this.rainPos = new Float32Array(this.rainCount * 6);
    strikes.onLanded(() => { if (this.level > 0.05) this.flash = 1; });
  }

  get active(): boolean { return this.tickets.length > 0; }

  begin(spec: PlateauStormSpec = {}): StormTicket {
    const t = new StormTicket(stormSpec(spec));
    this.tickets.push(t);
    return t;
  }

  stopAll(): void {
    this.tickets.length = 0;
    this.level = 0;
    this.flash = 0;
    this.restore();
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 4);
    this.level = 0;
    for (let i = this.tickets.length - 1; i >= 0; i--) {
      const t = this.tickets[i];
      if (stepTicket(t, dt)) this.strikeFor(t);
      if (t.done) { this.tickets.splice(i, 1); continue; }
      this.level = Math.max(this.level, t.level);
    }
    if (stormVisuals.external) {
      stormVisuals.external(this.level, this.flash);
      this.restore();
      this.updateRain(0, dt);
      return;
    }
    this.lateUpdate(dt);
  }

  private strikeFor(t: StormTicket): void {
    const s = t.spec;
    const c = s.aroundPlayer || !s.center ? this.ctx.player.position : s.center;
    const a = Math.random() * Math.PI * 2, d = Math.max(0, s.strikeMin) + Math.random() * (Math.max(s.strikeMin, s.strikeMax) - Math.max(0, s.strikeMin));
    this.strikes.strike(new THREE.Vector3(c.x + Math.cos(a) * d, c.y, c.z + Math.sin(a) * d),
      { warn: s.warn, radius: s.strikeRadius, damage: s.damage, chargeFoes: s.chargeFoes, onLanded: s.onStrike ?? undefined });
  }

  /** 天气覆盖：「这一帧的底 × 倍率」最后再写一次（天气导演先写过的就以它为底） */
  private lateUpdate(dt: number): void {
    const k = this.level;
    if (k <= 0.001 && this.flash <= 0.001) {
      this.restore();
      this.updateRain(0, dt);
      return;
    }
    let darken = 0, rain = 0;
    for (const t of this.tickets) {
      darken = Math.max(darken, t.spec.darken * t.level);
      rain = Math.max(rain, t.spec.rain * t.level);
    }
    if (this.sun) {
      const cur = this.sun.intensity;
      if (Number.isNaN(this.lastSun) || Math.abs(cur - this.lastSun) > 1e-4) this.sunBase = cur;
      this.sun.intensity = this.lastSun = this.sunBase * (1 - darken) + this.flash * 1.6;
    }
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (fog && (fog as THREE.Fog).isFog) {
      if (!this.lastFog || !fog.color.equals(this.lastFog.color) || fog.near !== this.lastFog.near || fog.far !== this.lastFog.far) {
        this.fogBase = { color: fog.color.clone(), near: fog.near, far: fog.far };
      }
      const b = this.fogBase!;
      const storm = new THREE.Color().setRGB(STORM.fog[0], STORM.fog[1], STORM.fog[2], THREE.SRGBColorSpace);
      fog.color.copy(b.color).lerp(storm, k * 0.85).add(new THREE.Color(0.25, 0.2, 0.3).multiplyScalar(this.flash));
      fog.far = b.far + (Math.min(b.far, STORM.fogEnd) - b.far) * k;
      fog.near = Math.min(fog.far - 1, b.near + (Math.min(b.near, STORM.fogStart) - b.near) * k);
      this.lastFog = { color: fog.color.clone(), near: fog.near, far: fog.far };
    }
    // 环境光跟着压（主光只剩两成时环境留 0.45）
    const env = 1 + (STORM.envFloor - 1) * Math.min(1, darken / 0.8) + this.flash * 0.35;
    this.ambientBase ??= this.ambients.map(a => a.intensity);
    this.ambients.forEach((a, i) => { a.intensity = this.ambientBase![i] * env; });
    // 风格化材质的三色环境光（Unity Trilight → 球谐 uSflAmbient0..2）也跟着压（Unity ApplyEnv 改的就是 RenderSettings 的三色环境）
    this.shBase ??= [stylizedShared.uSflAmbient0.value.clone(), stylizedShared.uSflAmbient1.value.clone(), stylizedShared.uSflAmbient2.value.clone()];
    stylizedShared.uSflAmbient0.value.copy(this.shBase[0]).multiplyScalar(env);
    stylizedShared.uSflAmbient1.value.copy(this.shBase[1]).multiplyScalar(env);
    stylizedShared.uSflAmbient2.value.copy(this.shBase[2]).multiplyScalar(env);
    if (this.addPostLayer) {
      if (!this.layer) {
        this.layer = { priority: 55, weight: k, overrides: { ColorAdjustments: { postExposure: STORM.postExposure, contrast: STORM.contrast, saturation: STORM.saturation, colorFilter: [...STORM.colorFilter, 1] } } };
        this.layerOff = this.addPostLayer(this.layer);
      }
      this.layer.weight = k;
    }
    this.updateRain(rain, dt);
  }

  private restore(): void {
    if (this.sun && !Number.isNaN(this.lastSun) && Math.abs(this.sun.intensity - this.lastSun) < 1e-4) this.sun.intensity = this.sunBase;
    this.lastSun = NaN;
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (fog && this.lastFog && this.fogBase) {
      if (fog.color.equals(this.lastFog.color)) fog.color.copy(this.fogBase.color);
      if (fog.near === this.lastFog.near) fog.near = this.fogBase.near;
      if (fog.far === this.lastFog.far) fog.far = this.fogBase.far;
    }
    this.lastFog = null;
    if (this.ambientBase) this.ambients.forEach((a, i) => { a.intensity = this.ambientBase![i]; });
    this.ambientBase = null;
    if (this.shBase) {
      stylizedShared.uSflAmbient0.value.copy(this.shBase[0]);
      stylizedShared.uSflAmbient1.value.copy(this.shBase[1]);
      stylizedShared.uSflAmbient2.value.copy(this.shBase[2]);
    }
    this.shBase = null;
    if (this.layer) this.layer.weight = 0;
  }

  /** 斜雨丝跟着相机（强度 × 雨量；Unity 每秒 1400 × 强度 × 画质） */
  private updateRain(k: number, dt: number): void {
    if (k <= 0.01) {
      if (this.rain) this.rain.visible = false;
      return;
    }
    if (!this.rain) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c6dc, transparent: true, opacity: 0.35, depthWrite: false }));
      this.rain.frustumCulled = false;
      this.rain.name = 'plateau-rain';
      this.parent.add(this.rain);
      for (let i = 0; i < this.rainCount; i++) this.respawnDrop(i, true);
    }
    this.rain.visible = true;
    const q = this.ctx.settings.quality, density = q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1;
    const shown = Math.round(this.rainCount * Math.min(1, k * density));
    this.rain.geometry.setDrawRange(0, shown * 2);
    for (let i = 0; i < shown; i++) {
      const o = i * 6;
      for (let j = 0; j < 2; j++) {
        this.rainPos[o + j * 3] += -2.2 * dt;
        this.rainPos[o + j * 3 + 1] += -22 * dt;
      }
      if (this.rainPos[o + 1] < this.ctx.camera.position.y - 8) this.respawnDrop(i, false);
    }
    (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private respawnDrop(i: number, scatter: boolean): void {
    const c = this.ctx.camera.position, o = i * 6;
    const x = c.x + (Math.random() - 0.5) * 40, z = c.z + (Math.random() - 0.5) * 40, y = c.y + (scatter ? Math.random() * 18 - 8 : 9 + Math.random() * 4);
    this.rainPos.set([x, y, z, x + 0.1, y + 0.9, z], o);
  }

  dispose(): void {
    this.stopAll();
    this.layerOff?.();
    if (this.rain) {
      this.rain.removeFromParent();
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
    }
  }
}
