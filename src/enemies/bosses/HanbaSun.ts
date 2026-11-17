/**
 * 旱魃的太阳三件套（Unity Hanba/HanbaSunDriver.cs、SunRing.cs、SunExposure.cs）。
 *
 * {@link HanbaSunDriver}：场景主方向光（太阳）的驱动——经 framework/StageHooks 的 sun 钩子拿到 UnityEnvironmentView 建的主光、环境光、雾，不伸手进场景视图：
 *   · 高度 driveTo：保持方位角，几秒内把仰角平滑推到目标（一阶段午后低太阳 30°，三阶段 85°）。日晒判定和真实阴影读的都是这盏光，一起变。
 *   · 亮度 setDim / flash：日蚀压到一成多（环境光、雾色、天空一起按 envAt 压暗），复燃猛亮再落回；restore 回到第一次接手时的仰角与亮度。
 *   · 一盏光一个驱动（挂在光上，不挂在首领上）：首领倒下、物体回收之后，复原的那一段还能接着跑完；换关时场景视图撤钩子、驱动随之失效。
 * {@link SunRing}：背后的日轮——炽度（光晕跟着亮）、转速、日蚀（黑盘 + 淡日冕，不直射）、升顶（离开身体、沿弧线升到场地上空、轮面朝下、放大、点一盏点光）、
 *   坠落碎裂（倒下时）。模型是 HanbaModel 的 sunring 支点（正式美术的 SM_BossPart_HanbaSunRing 挂在它上面）。
 *   与 Unity 的差异：骨骼采样防穿模没有移植（程序化支点固定在身后 1.8 m、头顶 4 m，正好是 Unity 的跟随距离）；跟随的滞后 / 浮动简化成浮动。
 * {@link SunExposure}：日晒与荫蔽——每 0.1 s 从胸口、眼睛两个探针沿太阳方向打射线（被沙丘、楼阁、岩石挡住 = 影子），再看日轮直射（距离内、无遮挡）；
 *   每个探针各占一半，日光与日轮的增益相加，脚下有水时 × 0.5，交给日晒灼烧（HanbaSunburn）叠层。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { stageHooks, type StageSunHook } from './framework/StageHooks';
import { sunExposure, SunburnInstance } from './HanbaSunburn';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

// ───────────────────────────── 太阳驱动 ─────────────────────────────

/** 主光压到最暗（倍率 0）时环境亮度留几成 */
export const ENV_FLOOR = 0.3;

/** 主光倍率 → 环境倍率：压暗时按 ENV_FLOOR 到 1 插值，亮过原亮度（复燃强光）时环境不跟着亮 */
export function envAt(dim: number): number {
  return dim >= 1 ? 1 : ENV_FLOOR + (1 - ENV_FLOOR) * Math.min(1, Math.max(0, dim));
}

export function elevationOf(toSun: THREE.Vector3): number {
  const n = toSun.clone().normalize();
  return Math.asin(Math.min(1, Math.max(-1, n.y))) / DEG;
}

export function azimuthOf(toSun: THREE.Vector3): number {
  return Math.atan2(toSun.x, toSun.z) / DEG;
}

/** 仰角 / 方位角（度）→ 指向太阳的单位向量 */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = elevationDeg * DEG, a = azimuthDeg * DEG;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

const drivers = new WeakMap<THREE.DirectionalLight, HanbaSunDriver>();

export class HanbaSunDriver {
  readonly light: THREE.DirectionalLight;
  readonly originalElevation: number;
  private readonly originalAzimuth: number;
  private readonly originalIntensity: number;
  private readonly distance: number;
  private readonly ambients: { light: THREE.Light; intensity: number }[];
  private fogColor: THREE.Color | null = null;
  private bgColor: THREE.Color | null = null;
  /** 天空盒背景的原亮度：第一次压暗时记下，之后都以它为基准（不能每次重读，已压暗的值再乘 k 会层层复合到全黑） */
  private bgIntensity: number | null = null;
  private fromElev = 0;
  private toElev = 0;
  private azimuth = 0;
  private moveT = 0;
  private moveSeconds = 1;
  moving = false;
  dim = 1;
  private dimFrom = 1;
  private dimTo = 1;
  private dimT = 0;
  private dimSeconds = 1;
  private dimming = false;
  private flashBack = -1;
  private flashHold = 0;
  env = 1;
  drives = 0;
  private cancelTask: (() => void) | null = null;

  private constructor(private readonly ctx: GameContext, private readonly hook: StageSunHook) {
    this.light = hook.light;
    const to = this.toSun(new THREE.Vector3());
    this.originalElevation = elevationOf(to);
    this.originalAzimuth = azimuthOf(to);
    this.originalIntensity = hook.light.intensity;
    this.distance = Math.max(20, hook.light.position.distanceTo(hook.light.target.position));
    this.ambients = hook.ambients.map(l => ({ light: l, intensity: l.intensity }));
    this.toElev = this.originalElevation;
  }

  /** 场景主光的驱动（没有登记主光时为 null）；第一次要的时候记下原朝向、原亮度 */
  static find(ctx: GameContext): HanbaSunDriver | null {
    const hook = stageHooks.sun;
    if (!hook) return null;
    let d = drivers.get(hook.light);
    if (!d) {
      d = new HanbaSunDriver(ctx, hook);
      drivers.set(hook.light, d);
    }
    return d;
  }

  /** 指向太阳的单位向量 */
  toSun(out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(this.light.position, this.light.target.position).normalize();
  }

  get elevation(): number {
    return elevationOf(this.toSun(_v));
  }

  get azimuthNow(): number {
    return azimuthOf(this.toSun(_v));
  }

  get targetElevation(): number {
    return this.toElev;
  }

  /** 保持方位角，seconds 秒内把仰角推到 elevationDeg（1–89°） */
  driveTo(elevationDeg: number, seconds: number): void {
    this.fromElev = this.elevation;
    this.toElev = Math.min(89, Math.max(1, elevationDeg));
    this.azimuth = this.azimuthNow;
    this.moveT = 0;
    this.moveSeconds = Math.max(0.01, seconds);
    this.moving = true;
    this.drives++;
    this.ensureTask();
    if (seconds <= 0.01) this.step(0.02);
  }

  /** 亮度倍率在 seconds 秒内变到 k */
  setDim(k: number, seconds: number): void {
    this.flashBack = -1;
    this.dimFrom = this.dim;
    this.dimTo = Math.max(0, k);
    this.dimT = 0;
    this.dimSeconds = Math.max(0.01, seconds);
    this.dimming = true;
    this.ensureTask();
  }

  /** 猛地亮到 peak 倍、停 hold 秒，再用 back 秒落回 1 */
  flash(peak: number, hold: number, back: number): void {
    this.dimming = false;
    this.dim = Math.max(this.dim, peak);
    this.apply();
    this.flashHold = Math.max(0, hold);
    this.flashBack = Math.max(0.01, back);
    this.ensureTask();
  }

  /** seconds 秒内回到第一次接手时的仰角与亮度 */
  restore(seconds: number): void {
    this.driveTo(this.originalElevation, seconds);
    this.azimuth = this.originalAzimuth;
    this.setDim(1, seconds);
  }

  private ensureTask(): void {
    if (this.cancelTask) return;
    this.cancelTask = this.ctx.tasks.add((dt) => {
      if (stageHooks.sun !== this.hook) {
        this.cancelTask = null;
        return true;
      }
      this.step(dt);
      if (this.moving || this.dimming || this.flashBack > 0) return false;
      this.cancelTask = null;
      return true;
    });
  }

  private step(dt: number): void {
    if (!(dt > 0)) return;
    if (this.moving) {
      this.moveT += dt;
      const u = Math.min(1, this.moveT / this.moveSeconds);
      const e = this.fromElev + (this.toElev - this.fromElev) * (u * u * (3 - 2 * u));
      sunDirection(e, this.azimuth, _v);
      this.light.position.copy(this.light.target.position).addScaledVector(_v, this.distance);
      this.light.updateMatrixWorld();
      if (u >= 1) this.moving = false;
    }
    if (this.flashBack > 0) {
      this.flashHold -= dt;
      if (this.flashHold <= 0) {
        const back = this.flashBack;
        this.flashBack = -1;
        this.setDim(1, back);
      }
    } else if (this.dimming) {
      this.dimT += dt;
      const u = Math.min(1, this.dimT / this.dimSeconds);
      this.dim = this.dimFrom + (this.dimTo - this.dimFrom) * u;
      if (u >= 1) this.dimming = false;
    }
    this.apply();
  }

  private apply(): void {
    this.light.intensity = this.originalIntensity * this.dim;
    const k = envAt(this.dim);
    if (Math.abs(k - this.env) < 1e-3) return;
    this.env = k;
    for (const a of this.ambients) a.light.intensity = a.intensity * k;
    const scene = this.hook.scene;
    const fog = scene.fog as (THREE.Fog | THREE.FogExp2 | null);
    if (fog) {
      this.fogColor ??= fog.color.clone();
      fog.color.copy(this.fogColor).multiplyScalar(k);
    }
    if (scene.background instanceof THREE.Color) {
      this.bgColor ??= scene.background.clone();
      scene.background.copy(this.bgColor).multiplyScalar(k);
    } else if (scene.background) {
      this.bgIntensity ??= scene.backgroundIntensity;
      scene.backgroundIntensity = this.bgIntensity * k;
    }
  }
}

// ───────────────────────────── 日轮 ─────────────────────────────

/** 正式日轮的世界半径（米，直径 6 m） */
export const RING_WORLD_RADIUS = 3;
const DISC_COLOR = new THREE.Color().setRGB(0.035, 0.04, 0.1, THREE.SRGBColorSpace);
const GLOW_COLOR = new THREE.Color(1, 0.86, 0.52);

let glowTexture: THREE.Texture | null = null;
function glowTex(): THREE.Texture | null {
  if (glowTexture || typeof document === 'undefined') return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,200,0.6)');
  grad.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export class SunRing {
  /** 平时的转速（度 / 秒）、平时的炽度、炽度追目标的速度（每秒） */
  spinSpeed = 20;
  idleBlaze = 0.35;
  blazeRate = 3;
  /** 升顶后的体型倍率 */
  risenScale = 1.5;
  lightRange = 75;
  lightIntensity = 6;

  blaze = 0.35;
  private blazeTarget = 0.35;
  private spinMult = 1;
  private spinNow = 1;
  angle = 0;
  eclipsed = false;
  risen = false;
  shattered = false;
  private dead = false;
  private rising = false;
  private falling = false;
  private riseT = 0;
  private riseSeconds = 1;
  private fallT = 0;
  private fallSeconds = 1;
  private readonly riseFrom = new THREE.Vector3();
  private readonly riseTo = new THREE.Vector3();
  private readonly riseRotFrom = new THREE.Quaternion();
  private readonly riseRotTo = new THREE.Quaternion();
  private scaleFrom = 1;
  private scaleTo = 1;
  private glowBoost = 1;
  private floatT = 0;
  private readonly glow: THREE.Sprite | null;
  private readonly disc: THREE.Mesh;
  private sun: THREE.PointLight | null = null;
  /** 跟随时日轮在模型里的本地位置（升顶后不再用） */
  private readonly followPos: THREE.Vector3;

  constructor(private readonly ctx: GameContext, readonly pivot: THREE.Object3D) {
    this.followPos = pivot.position.clone();
    const tex = glowTex();
    this.glow = tex ? new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: GLOW_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })) : null;
    if (this.glow) {
      this.glow.renderOrder = 5;
      ctx.stageGroup.add(this.glow);
    }
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: DISC_COLOR, side: THREE.DoubleSide, fog: false }));
    this.disc.visible = false;
    ctx.stageGroup.add(this.disc);
  }

  /** 轮心（世界） */
  center(out: THREE.Vector3): THREE.Vector3 {
    return this.pivot.getWorldPosition(out);
  }

  /** 轮面法线（世界：支点本地 +Z） */
  facing(out: THREE.Vector3): THREE.Vector3 {
    this.pivot.updateWorldMatrix(true, false);
    return out.set(0, 0, 1).transformDirection(this.pivot.matrixWorld);
  }

  /** 轮面内的两根轴（右、上）与世界半径（升顶后放大） */
  frame(right: THREE.Vector3, up: THREE.Vector3): number {
    this.pivot.updateWorldMatrix(true, false);
    right.set(1, 0, 0).transformDirection(this.pivot.matrixWorld);
    up.set(0, 1, 0).transformDirection(this.pivot.matrixWorld);
    return RING_WORLD_RADIUS * (this.risen ? Math.max(1, this.risenScale) : 1);
  }

  get riseProgress(): number {
    return !this.risen ? 0 : this.rising ? Math.min(1, this.riseT / Math.max(0.01, this.riseSeconds)) : 1;
  }

  setBlaze(target: number, spin = 1): void {
    if (this.dead || this.eclipsed) return;
    this.blazeTarget = Math.min(1, Math.max(0, target));
    this.spinMult = Math.max(0, spin);
  }

  idle(): void {
    this.setBlaze(this.idleBlaze, 1);
  }

  flash(value = 1): void {
    if (this.dead || this.eclipsed) return;
    this.blaze = Math.max(this.blaze, Math.min(1, Math.max(0, value)));
  }

  extinguish(): void {
    this.dead = true;
    this.blazeTarget = 0;
    this.spinMult = 0;
    this.eclipsed = false;
    this.disc.visible = false;
  }

  /** 日蚀：炽度立刻掐到 0、转速两成、轮毂前立起黑盘；关 = 黑盘收起，炽度回到平时 */
  setEclipse(on: boolean): void {
    if (this.dead && on) return;
    this.eclipsed = on;
    if (on) {
      this.blazeTarget = 0;
      this.blaze = 0;
      this.spinMult = 0.2;
    } else if (!this.dead) {
      this.blazeTarget = this.idleBlaze;
      this.spinMult = 1;
    }
    this.disc.visible = on;
  }

  /** 升顶：日轮换挂到场景里，seconds 秒内沿弧线升到 target、轮面朝下、放大，并点一盏点光 */
  rise(target: THREE.Vector3, seconds: number): void {
    if (this.dead) return;
    if (!this.risen) {
      this.ctx.stageGroup.attach(this.pivot);
      this.sun = new THREE.PointLight(0xffd68c, 0, this.lightRange, 0);
      this.pivot.add(this.sun);
    }
    this.risen = true;
    this.rising = true;
    this.riseT = 0;
    this.riseSeconds = Math.max(0.05, seconds);
    this.riseFrom.copy(this.pivot.position);
    this.riseRotFrom.copy(this.pivot.quaternion);
    this.riseTo.copy(target);
    // 轮面法线（本地 Z）朝下，轮的「上」朝北
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    this.riseRotTo.setFromRotationMatrix(m);
    this.scaleFrom = this.pivot.scale.x;
    this.scaleTo = Math.max(0.1, this.risenScale);
    this.glowBoost = 1.8;
  }

  /** 升起的日轮砸回 ground（首领倒下）：加速坠落，落地碎成金沙；没升顶时什么都不做 */
  fall(ground: THREE.Vector3, seconds = 1.1): void {
    if (!this.risen || this.shattered) return;
    this.rising = false;
    this.falling = true;
    this.fallT = 0;
    this.fallSeconds = Math.max(0.05, seconds);
    this.riseFrom.copy(this.pivot.position);
    this.riseTo.copy(ground).setY(ground.y + RING_WORLD_RADIUS * 0.6);
  }

  private shatter(): void {
    this.falling = false;
    this.shattered = true;
    const at = this.pivot.getWorldPosition(new THREE.Vector3());
    const fx = this.ctx.fx;
    fx.burst(at, 0xf2c761, 40, 11, 1.3, 0.4, 12);
    fx.burst(at, 0xd9b27a, 30, 7, 1.1, 0.5, 6);
    fx.ring(_v.set(at.x, at.y - RING_WORLD_RADIUS * 0.6 + 0.1, at.z), 9, 0xffe2a0, 0.8);
    fx.shake(0.7, 0.6);
    this.ctx.audio.play('boss_slam', { position: at, pitch: 0.7 });
    this.ctx.audio.play('explosion', { position: at, volume: 0.9, pitch: 0.6 });
    this.pivot.visible = false;
    if (this.glow) this.glow.visible = false;
  }

  /** 每帧（首领倒下后由演出层接着推，直到坠落碎完） */
  update(dt: number): void {
    if (!(dt > 0)) return;
    if (this.rising) {
      this.riseT += dt;
      const u = Math.min(1, this.riseT / this.riseSeconds);
      const e = u * u * (3 - 2 * u);
      this.pivot.position.lerpVectors(this.riseFrom, this.riseTo, e).y += Math.sin(u * Math.PI) * 2;
      this.pivot.quaternion.slerpQuaternions(this.riseRotFrom, this.riseRotTo, e);
      this.pivot.scale.setScalar(this.scaleFrom + (this.scaleTo - this.scaleFrom) * e);
      if (u >= 1) this.rising = false;
    } else if (!this.risen) {
      // 跟随：在身后上方轻轻浮动（Unity 的位置 / 偏航滞后简化掉）
      this.floatT += dt;
      this.pivot.position.copy(this.followPos);
      this.pivot.position.y += Math.sin(this.floatT * 0.3 * Math.PI * 2) * 0.12;
    }
    if (this.falling) {
      this.fallT += dt;
      const u = Math.min(1, this.fallT / this.fallSeconds);
      this.pivot.position.lerpVectors(this.riseFrom, this.riseTo, u * u);
      this.pivot.rotateOnWorldAxis(_w.set(1, 0, 0), 140 * DEG * dt);
      if (u >= 1) this.shatter();
    }
    if (this.sun) {
      const k = this.eclipsed ? 0.04 : this.blaze;
      this.sun.intensity = this.dead ? Math.max(0, this.sun.intensity - this.lightIntensity * dt) : this.lightIntensity * 0.4 * this.riseProgress * (0.25 + 0.75 * k);
    }
    this.blaze += Math.sign(this.blazeTarget - this.blaze) * Math.min(Math.abs(this.blazeTarget - this.blaze), this.blazeRate * dt);
    this.spinNow += Math.sign(this.spinMult - this.spinNow) * Math.min(Math.abs(this.spinMult - this.spinNow), 2 * dt);
    this.angle += this.spinSpeed * this.spinNow * dt;
    // 自转：支点只带位置 / 朝向，转的是它下面的轮体（程序化轮 + 正式美术挂件）
    for (const c of this.pivot.children) if (c !== this.sun) c.rotation.z = this.angle * DEG;
    const center = this.center(_v);
    const k = this.risen ? 1 + (this.risenScale - 1) * this.riseProgress : 1;
    if (this.eclipsed) {
      const n = this.facing(_w);
      this.disc.position.copy(center).addScaledVector(n, 0.62 * k + 0.05);
      this.disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.disc.scale.setScalar(RING_WORLD_RADIUS * 1.25 * k);
    }
    if (this.glow && !this.shattered) {
      this.glow.position.copy(center);
      const mat = this.glow.material;
      mat.opacity = this.eclipsed ? 0.1 : Math.min(1, 0.08 + this.blaze * 0.75) * (0.9 + 0.1 * Math.sin(this.ctx.time.now * 6.3));
      const s = RING_WORLD_RADIUS * 3.2 * (0.55 + this.blaze * 0.65) * (this.eclipsed ? 1.15 : this.glowBoost) * k;
      this.glow.scale.setScalar(s);
    }
  }

  /** 日轮还在动（坠落中）——首领物体回收之后演出层据此继续推 */
  get busy(): boolean {
    return this.falling || this.rising;
  }

  dispose(): void {
    this.glow?.removeFromParent();
    this.glow?.material.dispose();
    this.disc.removeFromParent();
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    if (this.risen) this.pivot.removeFromParent();
  }
}

// ───────────────────────────── 日晒 ─────────────────────────────

export interface ExposureOwner {
  readonly ctx: GameContext;
  readonly alive: boolean;
  readonly introDone: boolean;
  readonly damageMult: number;
}

export class SunExposure {
  static readonly Interval = 0.1;
  static readonly ChestFraction = 0.55;
  /** 朝太阳查遮挡的射线长度（米；Unity 400，网页按 1-4 的沙山范围截到 220，射线过长时查询的格子太多） */
  static readonly MaxRay = 220;

  shaftGain = 1;
  ringGain = 0.6;
  ringRange = 14;
  ringBlazeRange = 24;
  waterFactor = 0.5;
  damagePerStack = 0.6;
  active = true;

  samples = 0;
  exposedSamples = 0;
  lastShaft = 0;
  lastRing = 0;
  lastWater = 1;
  lastGain = 0;
  exposedSeconds = 0;
  private timer = 0;
  private flashAt = 0;
  private hinted = false;
  readonly burn: SunburnInstance;

  constructor(private readonly owner: ExposureOwner, private readonly ring: SunRing, private readonly driver: () => HanbaSunDriver | null,
    hurt: (damage: number, from: { x: number; y: number; z: number } | null) => void,
    private readonly flash: (color: string, alpha: number, seconds: number) => void) {
    this.burn = new SunburnInstance(hurt);
  }

  get running(): boolean {
    return this.active && this.owner.alive && this.owner.introDone;
  }

  /** 每层每跳的实际伤害（× 首领伤害倍率） */
  get damagePerStackNow(): number {
    return this.damagePerStack * this.owner.damageMult;
  }

  /** 日轮直射的距离：按炽度在平时与最炽之间插值 */
  get ringRangeNow(): number {
    const k = Math.min(1, Math.max(0, (this.ring.blaze - this.ring.idleBlaze) / Math.max(0.01, 1 - this.ring.idleBlaze)));
    return this.ringRange + (this.ringBlazeRange - this.ringRange) * k;
  }

  toSun(out: THREE.Vector3): THREE.Vector3 {
    const d = this.driver();
    return d ? d.toSun(out) : out.set(-0.12, 0.88, -0.45).normalize();
  }

  /** 日轮升到头顶后的日蚀：露天场地里它就是太阳，不晒 */
  get sunOut(): boolean {
    return this.ring.eclipsed && this.ring.risen;
  }

  /** 每帧：到点判定一次；灼烧层照常推进（倒下后也推，躲进影子慢慢消退） */
  update(dt: number): void {
    this.burn.tick(dt);
    if (!this.running) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = Math.max(0, this.timer + SunExposure.Interval);
    this.tick();
  }

  /** 判定一次：返回这次交给日晒灼烧的增益（0 = 没晒到） */
  tick(): number {
    this.samples++;
    const p = this.owner.ctx.player;
    if (!p.alive) {
      this.lastShaft = this.lastRing = this.lastGain = 0;
      return 0;
    }
    const feet = p.position;
    const chest = _probeChest.set(feet.x, feet.y + p.height * SunExposure.ChestFraction, feet.z);
    const head = _probeHead.copy(p.eye);
    const toSun = this.toSun(_toSun);
    const shaft = this.sunOut ? 0 : (this.shaftLit(chest, toSun) ? 0.5 : 0) + (this.shaftLit(head, toSun) ? 0.5 : 0);
    const ringShare = (this.ringLit(chest) ? 0.5 : 0) + (this.ringLit(head) ? 0.5 : 0);
    const depth = stageHooks.water?.depthAt(feet) ?? 0;
    const water = depth > 0.05 ? Math.min(1, Math.max(0, this.waterFactor)) : 1;
    const raw = shaft * this.shaftGain + ringShare * this.ringGain;
    this.lastShaft = shaft;
    this.lastRing = ringShare;
    this.lastWater = water;
    this.lastGain = raw * water;
    if (this.lastGain <= 0) return 0;
    this.exposedSamples++;
    this.exposedSeconds += this.lastGain * SunExposure.Interval;
    const from = ringShare > 0 ? this.ring.center(new THREE.Vector3()) : head.clone().addScaledVector(toSun, 20);
    sunExposure(this.burn, SunExposure.Interval, this.lastGain, this.damagePerStackNow, from);
    this.feedback();
    return this.lastGain;
  }

  /** 额外灼烧（扫射光束、旱风热浪、复燃强光打中时）：直接按 seconds 秒暴露叠层，不看影子 */
  burnFor(seconds: number, from: THREE.Vector3): boolean {
    return seconds > 0 && sunExposure(this.burn, seconds, 1, this.damagePerStackNow, from.clone());
  }

  /** 这一点朝太阳看得到天（世界几何遮挡） */
  shaftLit(point: THREE.Vector3, toSun: THREE.Vector3): boolean {
    if (toSun.y <= 0.02) return false;
    _v.copy(point).addScaledVector(toSun, 0.05);
    return !this.owner.ctx.world.raycast(_v, toSun, SunExposure.MaxRay, _hit as never);
  }

  /** 这一点被日轮直射：日轮没在日蚀里、在直射距离内、到轮心之间没有世界几何（首领身体不挡） */
  ringLit(point: THREE.Vector3): boolean {
    if (this.ring.eclipsed || this.ring.shattered) return false;
    const c = this.ring.center(_w);
    if (c.distanceToSquared(point) > this.ringRangeNow ** 2) return false;
    return lineClear(this.owner.ctx, point, c, 0.6);
  }

  /** 日蚀后的强光判定：看得到「太阳」——日轮升到头顶后 = 朝主光方向没被挡；没升顶时 = 到轮心之间没有遮挡 */
  seesSun(point: THREE.Vector3): boolean {
    if (this.shaftLit(point, this.toSun(_toSun))) return true;
    if (this.ring.risen) return false;
    return lineClear(this.owner.ctx, point, this.ring.center(_w), 0.6);
  }

  private feedback(): void {
    const ctx = this.owner.ctx;
    if (!this.hinted) {
      this.hinted = true;
      ctx.ui.toast('烈日灼身——躲进沙丘背阴面、楼阁或树荫的影子里，站在泉水里灼烧减半', '#ffd673');
    }
    if (this.burn.stacks < 7 || ctx.time.now < this.flashAt) return;
    this.flashAt = ctx.time.now + 1.2;
    this.flash('rgb(255,199,92)', 0.16, 0.35);
  }
}

const _probeChest = new THREE.Vector3(), _probeHead = new THREE.Vector3(), _toSun = new THREE.Vector3();

/** a → b 之间没有世界几何（b 端留 trim 米：轮毂本身 / 目标点不算挡） */
export function lineClear(ctx: GameContext, a: THREE.Vector3, b: THREE.Vector3, trim: number): boolean {
  const d = _seg.subVectors(b, a);
  const len = d.length();
  if (len <= trim + 1e-3) return true;
  d.multiplyScalar(1 / len);
  return !ctx.world.raycast(a, d, len - trim, _hit as never);
}

const _seg = new THREE.Vector3();
