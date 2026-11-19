/**
 * 天气（Unity WeatherProfiles.cs + WeatherDirector.cs）：
 *   基础值 = 这张图的雾与主光（网页：环境搭好时的 scene.fog / 太阳；和 Unity 构建器写进 WeatherDirector 的 base* 同值）+ 盛行风；
 *   逐层插值：区域风暴（强度 = 风暴周期 × 玩家离区域的远近）→ 软边界白化（BoundaryZone.playerWhiteout）；
 *   写出去：雾的颜色 / 起止、主光亮度 / 颜色、每种天气一层后处理（ColorAdjustments，权重 = 强度，走 PostStack 的 postEffects.addLayer）、
 *   风（植被着色器的 uSflWindDir）、跟着相机的天气粒子（风沙 / 雪 / 灰）、远幕（以相机为心的球，盖住天空与远景剪影）、风暴来向的沙墙。
 * 沙暴里远程锁定距离收到 25 m（lockOnRange / canLockOn；敌人 AI 读，随 M5 接上）。
 * 与 Unity 的差异：风声（程序生成的棕噪声循环）没做——src/audio 不在这一期（windSound 照算，留给音频接）；WindZone 没有对应物。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { stylizedShared } from '../UnityStylizedLit';
import type { V3 } from './LavaCore';
import type { WeatherData, WeatherRegionData } from './MechanismData';

export type WeatherParticles = 'none' | 'sand' | 'snow' | 'ash';
type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/** 一种天气的目标值（Unity WeatherProfile） */
export interface WeatherProfile {
  id: string;
  title: string;
  fogColor: RGB;
  fogStart: number;
  fogEnd: number;
  sunMult: number;
  sunTint: RGB;
  postExposure: number;
  contrast: number;
  saturation: number;
  colorFilter: RGB;
  wind: number;
  particles: WeatherParticles;
  particleRate: number;
  particleColor: RGBA;
  particleSpeed: number;
  dome: number;
  windSound: number;
  /** 远程锁定距离上限（米）；Infinity = 不限 */
  visibility: number;
}

const P = (o: Partial<WeatherProfile> & Pick<WeatherProfile, 'id' | 'title'>): WeatherProfile => ({
  fogColor: [0.88, 0.76, 0.6], fogStart: 40, fogEnd: 260, sunMult: 1, sunTint: [1, 1, 1], postExposure: 0, contrast: 0, saturation: 0,
  colorFilter: [1, 1, 1], wind: 0, particles: 'none', particleRate: 0, particleColor: [1, 1, 1, 1], particleSpeed: 12, dome: 0, windSound: 0,
  visibility: Infinity, ...o,
});

/** 天气预设（Unity WeatherProfiles.Build，原样） */
export const WEATHER_PROFILES: Readonly<Record<string, WeatherProfile>> = Object.fromEntries([
  P({ id: 'sandstorm', title: '沙暴', fogColor: [0.74, 0.57, 0.37], fogStart: 2, fogEnd: 32, sunMult: 0.45, sunTint: [1, 0.8, 0.58],
    postExposure: 0.05, contrast: -12, saturation: -22, colorFilter: [1, 0.9, 0.76], wind: 1, particles: 'sand', particleRate: 900,
    particleColor: [0.82, 0.66, 0.45, 0.55], particleSpeed: 16, dome: 1, windSound: 1, visibility: 25 }),
  P({ id: 'haze', title: '薄尘', fogColor: [0.86, 0.74, 0.58], fogStart: 25, fogEnd: 160, sunMult: 0.85, sunTint: [1, 0.93, 0.82],
    contrast: -4, saturation: -6, colorFilter: [1, 0.96, 0.9], wind: 0.45, particles: 'sand', particleRate: 120,
    particleColor: [0.85, 0.72, 0.52, 0.3], particleSpeed: 8, dome: 0.3, windSound: 0.3 }),
  P({ id: 'whiteout-desert', title: '风沙（软边界）', fogColor: [0.93, 0.84, 0.7], fogStart: 0, fogEnd: 22, sunMult: 0.7, sunTint: [1, 0.93, 0.82],
    postExposure: 0.6, contrast: -25, saturation: -35, colorFilter: [1, 0.96, 0.9], wind: 1, particles: 'sand', particleRate: 700,
    particleColor: [0.92, 0.82, 0.66, 0.5], particleSpeed: 18, dome: 1, windSound: 0.85 }),
  P({ id: 'whiteout-frost', title: '风雪（软边界）', fogColor: [0.9, 0.94, 1], fogStart: 0, fogEnd: 20, sunMult: 0.75, sunTint: [0.92, 0.96, 1],
    postExposure: 0.7, contrast: -28, saturation: -40, colorFilter: [0.95, 0.98, 1], wind: 1, particles: 'snow', particleRate: 900,
    particleColor: [0.9, 0.95, 1, 0.75], particleSpeed: 14, dome: 1, windSound: 0.9 }),
  P({ id: 'whiteout-inferno', title: '烟尘（软边界）', fogColor: [0.26, 0.19, 0.23], fogStart: 0, fogEnd: 24, sunMult: 0.6, sunTint: [0.96, 0.8, 0.76],
    postExposure: -0.2, contrast: -15, saturation: -25, colorFilter: [0.98, 0.86, 0.86], wind: 0.8, particles: 'ash', particleRate: 600,
    particleColor: [0.34, 0.25, 0.29, 0.6], particleSpeed: 9, dome: 1, windSound: 0.7 }),
  P({ id: 'blizzard', title: '风雪', fogColor: [0.82, 0.88, 0.96], fogStart: 4, fogEnd: 55, sunMult: 0.55, sunTint: [0.9, 0.95, 1],
    postExposure: 0.15, contrast: -14, saturation: -25, colorFilter: [0.94, 0.98, 1], wind: 0.9, particles: 'snow', particleRate: 800,
    particleColor: [0.9, 0.95, 1, 0.72], particleSpeed: 11, dome: 0.9, windSound: 0.8, visibility: 40 }),
  P({ id: 'ashfall', title: '落灰', fogColor: [0.23, 0.17, 0.22], fogStart: 12, fogEnd: 120, sunMult: 0.8, sunTint: [0.98, 0.86, 0.84],
    contrast: -6, saturation: -10, colorFilter: [0.97, 0.9, 0.92], wind: 0.3, particles: 'ash', particleRate: 160,
    particleColor: [0.36, 0.27, 0.31, 0.55], particleSpeed: 2.5, dome: 0.3, windSound: 0.2 }),
].map(p => [p.id, p]));

export function weatherProfile(id: string | null | undefined): WeatherProfile | null {
  if (!id) return null;
  const k = id.toLowerCase();
  return WEATHER_PROFILES[k] ?? null;
}

/** 软边界白化用哪套（按章节主题；雪域的软边界是风雪） */
export function whiteoutFor(theme: string): string {
  return theme === 'Frost' || theme === 'Plateau' ? 'whiteout-frost' : theme === 'Inferno' ? 'whiteout-inferno' : 'whiteout-desert';
}

/** 天气的可插值部分（Unity WeatherState） */
export interface WeatherState {
  fogColor: RGB;
  fogStart: number;
  fogEnd: number;
  sunMult: number;
  sunTint: RGB;
  wind: number;
  dome: number;
  sound: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (x: number): number => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

/** Unity WeatherState.Lerp */
export function lerpWeather(a: WeatherState, p: WeatherProfile | null, t: number): WeatherState {
  if (!p || !(t > 0)) return a;
  t = clamp01(t);
  return {
    fogColor: [lerp(a.fogColor[0], p.fogColor[0], t), lerp(a.fogColor[1], p.fogColor[1], t), lerp(a.fogColor[2], p.fogColor[2], t)],
    fogStart: lerp(a.fogStart, p.fogStart, t),
    fogEnd: lerp(a.fogEnd, p.fogEnd, t),
    sunMult: lerp(a.sunMult, a.sunMult * p.sunMult, t),
    sunTint: [lerp(a.sunTint[0], a.sunTint[0] * p.sunTint[0], t), lerp(a.sunTint[1], a.sunTint[1] * p.sunTint[1], t), lerp(a.sunTint[2], a.sunTint[2] * p.sunTint[2], t)],
    wind: lerp(a.wind, Math.max(a.wind, p.wind), t),
    dome: lerp(a.dome, Math.max(a.dome, p.dome), t),
    sound: lerp(a.sound, Math.max(a.sound, p.windSound), t),
  };
}

export type StormPhase = 'idle' | 'calm' | 'warning' | 'storm' | 'abating';

/** 区域风暴（Unity WeatherDirector.Region）：玩家走到 armRadius 内开始计时，firstDelay 秒后第一次预警；平静 → 预警 → 风暴 → 消退循环 */
export class StormRegion {
  phase: StormPhase = 'idle';
  phaseT = 0;

  constructor(readonly d: WeatherRegionData) {}

  get intensity(): number {
    const d = this.d;
    switch (this.phase) {
      case 'warning': return 0.12 * clamp01(this.phaseT / Math.max(0.01, d.warn));
      case 'storm': return smooth01(this.phaseT / 2.5);
      case 'abating': return 1 - clamp01(this.phaseT / Math.max(0.01, d.abate));
      default: return 0;
    }
  }

  get warning01(): number {
    const d = this.d;
    switch (this.phase) {
      case 'warning': return clamp01(this.phaseT / Math.max(0.01, d.warn));
      case 'storm': return 1;
      case 'abating': return 1 - clamp01(this.phaseT / Math.max(0.01, d.abate));
      default: return 0;
    }
  }

  weight(p: V3): number {
    const dist = Math.hypot(p.x - this.d.center[0], p.z - this.d.center[2]);
    return 1 - smooth01((dist - this.d.radius) / Math.max(0.01, this.d.fade));
  }

  at(p: V3): number { return this.intensity * this.weight(p); }

  private length(p: StormPhase): number {
    const d = this.d;
    return Math.max(0.01, p === 'calm' ? d.calm : p === 'warning' ? d.warn : p === 'storm' ? d.storm : p === 'abating' ? d.abate : Infinity);
  }

  tick(dt: number, player: V3): void {
    const d = this.d;
    if (this.phase === 'idle') {
      if (Math.hypot(player.x - d.center[0], player.z - d.center[2]) > d.armRadius) return;
      this.phase = 'calm';
      this.phaseT = Math.max(0, d.calm - d.firstDelay);
    }
    this.phaseT += dt;
    for (let guard = 0; guard < 4; guard++) {
      const len = this.length(this.phase);
      if (this.phaseT < len) break;
      this.phaseT -= len;
      const next: StormPhase = this.phase === 'calm' ? 'warning' : this.phase === 'warning' ? 'storm' : this.phase === 'storm' ? 'abating' : d.loop ? 'calm' : 'idle';
      this.phase = next;
      if (next === 'idle') {
        this.phase = 'calm';
        this.phaseT = -Infinity;
        break;
      }
    }
  }

  force(phase: StormPhase, t = 0): void {
    this.phase = phase;
    this.phaseT = Math.max(0, t);
  }
}

/** 晴天的远程锁定距离 */
export const CLEAR_LOCK_RANGE = 160;

/** 某点处的远程锁定距离上限（Unity WeatherDirector.LockOnRange） */
export function lockOnRange(regions: readonly StormRegion[], at: V3): number {
  let range = Infinity;
  for (const r of regions) {
    const p = weatherProfile(r.d.profile);
    if (!p || p.visibility === Infinity) continue;
    const lvl = r.at(at);
    if (lvl <= 0.05) continue;
    const k = smooth01((lvl - 0.15) / 0.6);
    range = Math.min(range, lerp(CLEAR_LOCK_RANGE, p.visibility, k));
  }
  return range;
}

export function canLockOn(regions: readonly StormRegion[], shooter: V3, target: V3): boolean {
  const range = Math.min(lockOnRange(regions, shooter), lockOnRange(regions, target));
  const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = target.z - shooter.z;
  return range === Infinity || dx * dx + dy * dy + dz * dz <= range * range;
}

// ───────────────────────────── 运行时 ─────────────────────────────

/**
 * Unity 的雾距离 → 网页：基础值对上网页此刻的值（空气透视层把起点推远了），往下收的时候按比例把这段差收掉（收到 0 时就是 0），
 * 往上放的时候差值原样加上。晴天 = 网页原样；沙暴（起点 2 m、终点 32 m）≈ Unity 的近处能见度
 */
export function remapFog(value: number, unityBase: number, webBase: number): number {
  if (value >= unityBase) return webBase + (value - unityBase);
  const t = unityBase > 0 ? value / unityBase : 0;
  return value + (webBase - unityBase) * t;
}

export type PostLayerFn = (layer: { priority: number; weight: number; overrides: Record<string, unknown> }) => () => void;

const srgb = (c: readonly number[]): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
const KINDS: WeatherParticles[] = ['sand', 'snow', 'ash'];
/** 每种天气粒子的存活上限（画质高；中 0.75、低 0.5） */
export const MAX_WEATHER_PARTICLES = 4000;

let spriteTex: THREE.DataTexture | null = null;
/** 粒子的圆形软点（16×16 径向渐变；不画成方块） */
function sprite(): THREE.DataTexture {
  if (spriteTex) return spriteTex;
  const n = 16, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.max(0, 1 - r) ** 1.4 * 255);
  }
  spriteTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  spriteTex.magFilter = spriteTex.minFilter = THREE.LinearFilter;
  spriteTex.needsUpdate = true;
  return spriteTex;
}

/** 跟着相机的天气粒子（一种一组 Points：发射盒 46 × 14 × 46 m 放在上风处，粒子顺风穿过视野，寿命 1.2–2.2 s） */
class ParticleLayer {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly material: THREE.PointsMaterial;
  private next = 0;
  private debt = 0;

  constructor(readonly kind: WeatherParticles, readonly cap: number, parent: THREE.Object3D) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.age = new Float32Array(cap).fill(1e9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.material = new THREE.PointsMaterial({
      size: kind === 'sand' ? 0.16 : kind === 'snow' ? 0.11 : 0.09, transparent: true, depthWrite: false, sizeAttenuation: true, fog: true,
      opacity: 0.6, map: sprite(),
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = `weather-${kind}`;
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    parent.add(this.points);
  }

  update(dt: number, rate: number, color: RGBA, speed: number, wind: THREE.Vector3, eye: THREE.Vector3): void {
    this.material.color.copy(srgb(color));
    this.material.opacity = color[3];
    // 发射
    this.debt = Math.min(this.cap, this.debt + rate * dt);
    const fall = this.kind === 'snow' ? -1.6 : this.kind === 'ash' ? -0.6 : -0.3;
    const cx = eye.x - wind.x * speed * 0.6, cy = eye.y + 2, cz = eye.z - wind.z * speed * 0.6;
    while (this.debt >= 1) {
      this.debt -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      this.pos[i * 3] = cx + (Math.random() - 0.5) * 46;
      this.pos[i * 3 + 1] = cy + (Math.random() - 0.5) * 14;
      this.pos[i * 3 + 2] = cz + (Math.random() - 0.5) * 46;
      const s = speed * (0.75 + Math.random() * 0.4);
      this.vel[i * 3] = wind.x * s;
      this.vel[i * 3 + 1] = fall + (Math.random() - 0.5) * 1.2;
      this.vel[i * 3 + 2] = wind.z * s;
      this.life[i] = 1.2 + Math.random();
      this.age[i] = 0;
    }
    // 推进（噪声扰动：snow 1.2、其余 0.8）
    const n = this.kind === 'snow' ? 1.2 : 0.8;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.pos[i * 3 + 1] > -1e8) this.pos[i * 3 + 1] = -1e9;
        continue;
      }
      this.age[i] += dt;
      this.pos[i * 3] += (this.vel[i * 3] + (Math.random() - 0.5) * n) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + (Math.random() - 0.5) * n) * dt;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  get alive(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.age[i] < this.life[i]) n++;
    return n;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** 沙墙：半径 1、高 1 的竖直圆弧（局部 +X 两侧各 70°），底部不透明、往上淡出（Unity ArcMesh） */
function arcGeometry(): THREE.BufferGeometry {
  const seg = 28, half = 70 * Math.PI / 180, rows = [0, 0.45, 1], alpha = [1, 0.75, 0];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let s = 0; s <= seg; s++) {
    const a = -half + 2 * half * s / seg;
    const edge = clamp01(Math.min(s, seg - s) / 5);
    for (let k = 0; k < rows.length; k++) {
      pos.push(Math.cos(a), rows[k], Math.sin(a));
      col.push(1, 1, 1, alpha[k] * edge);
    }
  }
  for (let s = 0; s < seg; s++) for (let k = 0; k + 1 < rows.length; k++) {
    const a0 = s * rows.length + k, a1 = a0 + 1, b0 = a0 + rows.length, b1 = b0 + 1;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

export interface WeatherHooks {
  /** 软边界白化 0..1 与往界内的方向（没有软边界时 0 / [0, 0]） */
  whiteout(): number;
  inward(p: V3): [number, number];
  addPostLayer: PostLayerFn | null;
}

export class WeatherDirector {
  readonly regions: StormRegion[];
  current: WeatherState;
  whiteoutWeight = 0;
  /** 风声 0..1（风声随音频接上之前只算不播） */
  windSound = 0;
  private readonly baseFog: { color: THREE.Color; near: number; far: number } | null;
  private readonly sun: THREE.DirectionalLight | null;
  private readonly baseSun: { intensity: number; color: THREE.Color } | null;
  private readonly group = new THREE.Group();
  private readonly layers = new Map<string, { weight: number; off: () => void; layer: { priority: number; weight: number; overrides: Record<string, unknown> } }>();
  private readonly particles = new Map<WeatherParticles, ParticleLayer>();
  private dome: THREE.Mesh | null = null;
  private readonly walls: (THREE.Mesh | null)[] = [];
  private arc: THREE.BufferGeometry | null = null;
  private readonly windVec = new THREE.Vector3(1, 0, 0);
  private readonly baseWind: THREE.Vector4;

  constructor(private readonly ctx: GameContext, readonly d: WeatherData, private readonly hooks: WeatherHooks, sun: THREE.DirectionalLight | null) {
    this.regions = d.regions.map(r => new StormRegion(r));
    const fog = ctx.scene.fog as THREE.Fog | null;
    this.baseFog = fog && (fog as THREE.Fog).isFog ? { color: fog.color.clone(), near: fog.near, far: fog.far } : null;
    this.sun = sun;
    this.baseSun = sun ? { intensity: sun.intensity, color: sun.color.clone() } : null;
    this.current = this.baseState();
    this.group.name = 'weather';
    ctx.scene.add(this.group);
    this.baseWind = stylizedShared.uSflWindDir.value.clone();
  }

  private baseState(): WeatherState {
    const d = this.d;
    return { fogColor: [d.baseFogColor[0], d.baseFogColor[1], d.baseFogColor[2]], fogStart: d.baseFogStart, fogEnd: d.baseFogEnd, sunMult: 1, sunTint: [1, 1, 1],
      wind: d.baseWind, dome: 0, sound: 0 };
  }

  /** 某点处最强的区域风暴强度 */
  stormAt(at: V3): number {
    let s = 0;
    for (const r of this.regions) s = Math.max(s, r.at(at));
    return s;
  }

  lockOnRange(at: V3): number { return lockOnRange(this.regions, at); }
  canLockOn(shooter: V3, target: V3): boolean { return canLockOn(this.regions, shooter, target); }

  /** 离 at 最近的区域风暴立刻进入某个阶段（调试） */
  forceNearest(at: V3, phase: StormPhase, t = 0): StormRegion | null {
    let best: StormRegion | null = null, bd = Infinity;
    for (const r of this.regions) {
      const dd = (r.d.center[0] - at.x) ** 2 + (r.d.center[1] - at.y) ** 2 + (r.d.center[2] - at.z) ** 2;
      if (dd < bd) { bd = dd; best = r; }
    }
    best?.force(phase, t);
    return best;
  }

  update(dt: number): void {
    const ctx = this.ctx, player = ctx.player.position, eye = ctx.camera.position;
    const d = this.d;
    const bl = Math.hypot(d.windDir[0], d.windDir[1]);
    const baseDir: [number, number] = bl > 1e-3 ? [d.windDir[0] / bl, d.windDir[1] / bl] : [1, 0];
    let s = this.baseState();
    let ax = baseDir[0] * Math.max(0.05, d.baseWind), az = baseDir[1] * Math.max(0.05, d.baseWind);
    const weights = new Map<string, number>();
    const emit = new Map<WeatherParticles, { rate: number; color: RGBA; speed: number }>();
    const accumulate = (p: WeatherProfile, w: number): void => {
      weights.set(p.id, Math.max(weights.get(p.id) ?? 0, w));
      if (p.particles === 'none' || !(p.particleRate > 0)) return;
      const e = emit.get(p.particles) ?? { rate: 0, color: p.particleColor, speed: p.particleSpeed };
      const rate = e.rate + p.particleRate * w;
      emit.set(p.particles, p.particleRate * w >= e.rate ? { rate, color: p.particleColor, speed: p.particleSpeed } : { rate, color: e.color, speed: e.speed });
    };
    for (const r of this.regions) {
      if (dt > 0) r.tick(dt, player);
      const p = weatherProfile(r.d.profile);
      const w = r.at(player);
      if (p && w > 0) {
        s = lerpWeather(s, p, w);
        accumulate(p, w);
        const fl = Math.hypot(r.d.from[0], r.d.from[1]) || 1;
        ax += -r.d.from[0] / fl * 2 * w;
        az += -r.d.from[1] / fl * 2 * w;
      }
      const far = r.warning01 * (1 - smooth01((Math.hypot(player.x - r.d.center[0], player.z - r.d.center[2]) - r.d.radius) / 90));
      s.sound = Math.max(s.sound, far * 0.55);
    }
    const white = this.hooks.whiteout();
    this.whiteoutWeight = white;
    if (white > 0) {
      const wp = weatherProfile(d.whiteoutProfile || whiteoutFor(d.theme));
      if (wp) {
        s = lerpWeather(s, wp, white);
        accumulate(wp, white);
        const [ix, iz] = this.hooks.inward(player);
        ax += ix * 3 * white;
        az += iz * 3 * white;
      }
    }
    this.current = s;
    this.windSound = s.sound;
    const al = Math.hypot(ax, az);
    const dir: [number, number] = al > 1e-3 ? [ax / al, az / al] : baseDir;
    this.windVec.set(dir[0], 0, dir[1]);
    this.writeFog(s);
    this.writeSun(s);
    // 植被风（Unity 全局 _WindDir：xy = Unity XZ 风向 → 网页 x 取反回去）
    stylizedShared.uSflWindDir.value.set(-dir[0], dir[1], s.wind, 0);
    this.updateLayers(weights);
    this.updateDome(eye, s);
    this.updateParticles(dt, emit, eye);
    this.updateWalls();
  }

  /** 雾：网页的空气透视层把线性雾起点推到 ≥ 120 m（UnityEnvironment）——天气只在这层之上按「基础 → 目标」的比例改，晴天时原样不动 */
  private writeFog(s: WeatherState): void {
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (!fog || !(fog as THREE.Fog).isFog || !this.baseFog) return;
    const d = this.d;
    fog.color.copy(srgb(s.fogColor));
    fog.near = remapFog(s.fogStart, d.baseFogStart, this.baseFog.near);
    fog.far = Math.max(fog.near + 1, remapFog(s.fogEnd, d.baseFogEnd, this.baseFog.far));
  }

  private writeSun(s: WeatherState): void {
    if (!this.sun || !this.baseSun) return;
    this.sun.intensity = this.baseSun.intensity * s.sunMult;
    this.sun.color.copy(this.baseSun.color).multiply(new THREE.Color(s.sunTint[0], s.sunTint[1], s.sunTint[2]));
  }

  private updateLayers(weights: Map<string, number>): void {
    const add = this.hooks.addPostLayer;
    if (!add) return;
    for (const [id, w] of weights) {
      let l = this.layers.get(id);
      if (!l) {
        const p = weatherProfile(id)!;
        const layer = { priority: id.startsWith('whiteout') ? 60 : 50, weight: w, overrides: {
          ColorAdjustments: { postExposure: p.postExposure, contrast: p.contrast, saturation: p.saturation, colorFilter: [...p.colorFilter, 1] },
        } };
        l = { weight: w, layer, off: add(layer) };
        this.layers.set(id, l);
      }
      l.layer.weight = w;
    }
    for (const [id, l] of this.layers) if (!weights.has(id)) l.layer.weight = 0;
  }

  private updateDome(eye: THREE.Vector3, s: WeatherState): void {
    const a = clamp01(s.dome);
    if (a <= 0.005) {
      if (this.dome) this.dome.visible = false;
      return;
    }
    if (!this.dome) {
      this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
      this.dome.name = 'weather-veil';
      this.dome.frustumCulled = false;
      this.dome.renderOrder = 1;
      this.group.add(this.dome);
    }
    this.dome.visible = true;
    this.dome.position.copy(eye);
    this.dome.scale.setScalar(Math.min(1200, Math.max(12, s.fogEnd * 1.02)));
    const m = this.dome.material as THREE.MeshBasicMaterial;
    m.color.copy(srgb(s.fogColor));
    m.opacity = a;
  }

  private updateParticles(dt: number, emit: Map<WeatherParticles, { rate: number; color: RGBA; speed: number }>, eye: THREE.Vector3): void {
    const q = this.ctx.settings.quality;
    const density = q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1;
    for (const kind of KINDS) {
      const e = emit.get(kind);
      let layer = this.particles.get(kind);
      if (!(e && e.rate > 0.5) && !layer) continue;
      if (!layer) {
        layer = new ParticleLayer(kind, Math.max(64, Math.round(MAX_WEATHER_PARTICLES * density)), this.group);
        this.particles.set(kind, layer);
      }
      layer.update(dt, (e?.rate ?? 0) * density, e?.color ?? [1, 1, 1, 0], e?.speed && e.speed > 0 ? e.speed : 10, this.windVec, eye);
    }
  }

  private updateWalls(): void {
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      const warnK = r.warning01;
      const sweep = r.phase === 'storm' ? clamp01(r.phaseT / 3) : r.phase === 'abating' ? 1 : 0;
      const alpha = r.phase === 'abating' ? 0 : warnK * (1 - sweep) * 0.85;
      let wall = this.walls[i] ?? null;
      if (alpha <= 0.01) {
        if (wall) wall.visible = false;
        continue;
      }
      if (!wall) {
        this.arc ??= arcGeometry();
        wall = new THREE.Mesh(this.arc, new THREE.MeshBasicMaterial({ transparent: true, vertexColors: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        wall.name = `sand-wall-${i}`;
        wall.frustumCulled = false;
        this.group.add(wall);
        this.walls[i] = wall;
      }
      wall.visible = true;
      const fl = Math.hypot(r.d.from[0], r.d.from[1]);
      const fx = fl > 1e-3 ? r.d.from[0] / fl : 1, fz = fl > 1e-3 ? r.d.from[1] / fl : 0;
      const radius = lerp(r.d.radius + 70, r.d.radius * 0.2, sweep), height = 8 + 34 * warnK;
      wall.position.set(r.d.center[0], r.d.center[1] - 3, r.d.center[2]);
      // 弧心（局部 +X）朝风暴来向
      wall.rotation.y = -Math.atan2(fz, fx);
      wall.scale.set(radius, height, radius);
      const p = weatherProfile(r.d.profile);
      const m = wall.material as THREE.MeshBasicMaterial;
      m.color.copy(srgb(p ? p.fogColor : [0.74, 0.57, 0.37]));
      m.opacity = alpha;
    }
  }

  dispose(): void {
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    if (fog && (fog as THREE.Fog).isFog && this.baseFog) {
      fog.color.copy(this.baseFog.color);
      fog.near = this.baseFog.near;
      fog.far = this.baseFog.far;
    }
    if (this.sun && this.baseSun) {
      this.sun.intensity = this.baseSun.intensity;
      this.sun.color.copy(this.baseSun.color);
    }
    stylizedShared.uSflWindDir.value.copy(this.baseWind);
    for (const l of this.layers.values()) l.off();
    this.layers.clear();
    for (const p of this.particles.values()) p.dispose();
    this.particles.clear();
    if (this.dome) {
      this.dome.geometry.dispose();
      (this.dome.material as THREE.Material).dispose();
    }
    for (const w of this.walls) if (w) (w.material as THREE.Material).dispose();
    this.arc?.dispose();
    this.group.removeFromParent();
  }
}
