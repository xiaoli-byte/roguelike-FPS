/**
 * 特效系统（IFx 实现）：把粒子、火花拖尾、线状特效、贴地特效、闪光与伤害数字组合成玩法需要的各种反馈。
 *
 * 结构：
 *  - glow（加法粒子，4000）/ smoke（普通混合粒子：烟、尘、碎屑，1500）
 *  - sparks（拉丝火花）+ trails（tracer / beam / lightning）→ 共用一个 RibbonBatch
 *  - ground（冲击波环、预警圈、法阵、光柱、弹孔）、flashes（闪光球 + ≤3 点光源）
 *  - numbers（DOM 伤害数字）
 * 所有特效物体挂在常驻的 fx 根节点（直接在 ctx.scene 下，不在 stageGroup），换关由 clear() 统一清掉。
 * 暂停 / 模态框期间特效冻结（与玩法时间同步，预警圈不会「偷跑」）。
 * 所有入口都丢弃非有限的向量 / 参数（NaN 写进点光源会让整个场景的受光材质出错）。
 */
import * as THREE from 'three';
import type { DamageNumberOpts, GameContext, IFx } from '../core/types';
import { clamp01 } from '../core/math';
import {
  ParticlePool, particleScaleUniform,
  STYLE_CHUNK, STYLE_DUST, STYLE_EMBER, STYLE_FIREBALL, STYLE_GLOW, STYLE_MOTE, STYLE_SMOKE, STYLE_SPARK,
} from './Particles';
import { SparkStreaks } from './Sparks';
import { RibbonBatch } from './Ribbons';
import { TrailEffects } from './Trails';
import { GroundEffects } from './Ground';
import { FlashEffects } from './Flash';
import { DamageNumbers } from './DamageNumbers';
import {
  ORDER_GLOW, ORDER_SMOKE, WARM_WHITE, WHITE, finite3, hexToColor, isDustColor, jitter, mixColor, posOr, rand, randomDir,
} from './shared';

const DEFAULT_IMPACT = 0xffc98a;
const DEFAULT_HIT = 0xffd2a0;
const DEFAULT_TRACER = 0xffe0a0;
const DEFAULT_EXPLOSION = 0xff8a3a;
const DEFAULT_RING = 0xffd9a0;
const DEFAULT_WARNING = 0xff3030;
const DEFAULT_BEAM = 0x6fd8ff;
const DEFAULT_LIGHTNING = 0x8fe3ff;
const DEFAULT_ENEMY = 0xff4455;
const DUST = 0x8c8274;
const SMOKE_DARK = 0x2b2623;
const CHUNK_DARK = 0x3b322b;
const HOT_YELLOW = 0xffe38a;

const EMITTERS = 32;
const SPAWN_DURATION = 0.7;
/** 相机震动上限（玩家相机把强度钳在 2；单次写入不超过这个值，时长不超过 3 秒） */
const SHAKE_MAX = 1.5;
const SHAKE_MAX_TIME = 3;
/** burst 的中心闪光只给「一下子迸出」的爆发（低数量的持续发射——烟迹、灼烧火苗——不加） */
const BURST_FLASH_MIN_COUNT = 6;
/** 参数非法、什么都没生成时返回的取消函数 */
const NOOP = (): void => {};

// 模块级临时量（热路径零分配）
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _hot = new THREE.Color();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _buf = new THREE.Vector2();

/** 出生特效的持续发射器 */
interface Emitter {
  active: boolean;
  x: number; y: number; z: number;
  color: THREE.Color;
  age: number;
  acc: number;
  finale: boolean;
  stamp: number;
}

export class FxSystem implements IFx {
  private readonly root = new THREE.Group();
  private readonly glow = new ParticlePool(4000, true);
  private readonly smoke = new ParticlePool(1500, false);
  private readonly sparks = new SparkStreaks(1400);
  private readonly ribbons = new RibbonBatch(2600);
  private readonly trails: TrailEffects;
  private readonly ground = new GroundEffects();
  private readonly flashes = new FlashEffects();
  private readonly numbers = new DamageNumbers();
  private readonly emitters: Emitter[] = [];
  private emitterStamp = 0;
  private time = 0;
  /** 上次预编译时的雾类型（0 无 / 1 线性 / 2 指数），变化时重新预编译 */
  private compiledFog = -1;

  constructor(readonly ctx: GameContext) {
    this.root.name = 'fx';
    this.trails = new TrailEffects(this.glow, this.sparks);
    this.glow.points.renderOrder = ORDER_GLOW;
    this.smoke.points.renderOrder = ORDER_SMOKE;
    this.root.add(this.smoke.points, this.glow.points, this.ribbons.mesh, this.ground.group, this.flashes.group);
    for (let i = 0; i < EMITTERS; i++) {
      this.emitters.push({ active: false, x: 0, y: 0, z: 0, color: new THREE.Color(), age: 0, acc: 0, finale: false, stamp: 0 });
    }
  }

  init(): void {
    const ctx = this.ctx;
    ctx.scene.add(this.root);
    this.flashes.attachLights(ctx.scene);
    this.numbers.init(ctx.dom.world);
    // 换关时（黑幕中）预编译全部特效着色器，避免第一次爆炸卡顿
    ctx.events.on('stage:loaded', () => this.warmUp());
  }

  private warmUp(): void {
    // 低画质：把爆炸点光源整体移出光照计算。只在换关时切换——世界模块的灯光数量此时本来就会变、
    // 受光材质本来就要重编译；玩法中切换画质要到下一关才生效（与阴影、粒子数一致）。
    this.flashes.setLightsEnabled(this.ctx.settings.quality !== 'low');
    const fog = this.ctx.scene.fog;
    const key = !fog ? 0 : (fog as THREE.FogExp2).isFogExp2 ? 2 : 1;
    if (key === this.compiledFog) return;
    this.compiledFog = key;
    try {
      this.ctx.renderer.compile(this.root, this.ctx.camera, this.ctx.scene);
    } catch (err) {
      console.warn('[Fx] 预编译失败（不影响运行）', err);
    }
  }

  /** 画质系数：低画质减少粒子数量 */
  private density(): number {
    const q = this.ctx.settings.quality;
    return q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.density()));
  }

  private floorY(): number {
    return this.ctx.stage?.arena?.floorY ?? 0;
  }

  /** (x,z) 处不高于 y 的地面高度（找不到时用竞技场地面） */
  private groundBelow(p: THREE.Vector3): number {
    const g = this.ctx.world.groundHeight(p.x, p.z, p.y + 0.1);
    return Number.isFinite(g) ? g : this.floorY();
  }

  // ───────────── IFx ─────────────

  impact(point: THREE.Vector3, normal: THREE.Vector3 | null, color = DEFAULT_IMPACT, size = 1): void {
    if (!finite3(point)) return;
    const s = Math.min(4, Math.max(0.2, posOr(size, 1)));
    // 弹孔朝向用 setFromUnitVectors，必须是单位向量；调用方传来的法线不保证归一化
    const nLen = finite3(normal) ? normal.length() : 0;
    const hasNormal = nLen > 1e-6;
    const n = hasNormal ? _n.copy(normal!).multiplyScalar(1 / nLen) : _n.set(0, 1, 0);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.45, _hot);
    const px = point.x + n.x * 0.03, py = point.y + n.y * 0.03, pz = point.z + n.z * 0.03;

    // 反射火花
    const sparks = this.count(5 + 4 * s);
    for (let i = 0; i < sparks; i++) {
      randomDir(_dir);
      if (hasNormal) {
        const d = _dir.dot(n);
        if (d < 0) _dir.addScaledVector(n, -2 * d);
        _dir.addScaledVector(n, 0.7).normalize();
      }
      const sp = rand(4, 12) * Math.sqrt(s);
      this.sparks.spawn(px, py, pz, _dir.x * sp, _dir.y * sp, _dir.z * sp, i & 1 ? _c : _hot, rand(0.12, 0.34), 0.02 * Math.sqrt(s), 14);
    }
    // 命中闪光
    this.glow.spawn(STYLE_GLOW, px + n.x * 0.03, py + n.y * 0.03, pz + n.z * 0.03, 0, 0, 0, _hot, 0.42 * s, 0.07);
    this.glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _c, 0.22 * s, 0.14);
    // 尘土
    hexToColor(DUST, _c2);
    const puffs = this.count(2 * Math.min(2, s));
    for (let i = 0; i < puffs; i++) {
      const sp = rand(0.6, 1.8);
      this.smoke.spawn(STYLE_DUST, px, py, pz, n.x * sp + jitter(0.5), n.y * sp + jitter(0.5) + 0.2, n.z * sp + jitter(0.5), _c2, rand(0.18, 0.3) * s, rand(0.45, 0.8));
    }
    // 小碎屑
    hexToColor(CHUNK_DARK, _c3);
    const chunks = this.count(2 * s);
    for (let i = 0; i < chunks; i++) {
      randomDir(_dir).addScaledVector(n, 1.2).normalize();
      const sp = rand(2.5, 6);
      this.smoke.spawn(STYLE_CHUNK, px, py, pz, _dir.x * sp, _dir.y * sp + 1, _dir.z * sp, _c3, rand(0.035, 0.07) * s, rand(0.5, 0.9));
    }
    // 弹孔（只有打在几何表面且是小型命中时）
    if (hasNormal && s <= 1.6) this.ground.hole(point, n, 0.11 * s + 0.04, 0.8);
  }

  enemyHit(point: THREE.Vector3, color = DEFAULT_HIT, crit = false): void {
    if (!finite3(point)) return;
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.55, _hot);
    const px = point.x, py = point.y, pz = point.z;
    const k = crit ? 1.7 : 1;
    // 闪光
    this.glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _hot, 0.36 * k, crit ? 0.1 : 0.07);
    // 能量溅射（带重力的发光粒）
    const motes = this.count(crit ? 9 : 4);
    for (let i = 0; i < motes; i++) {
      randomDir(_dir);
      const sp = rand(1.5, 4.5) * k;
      this.glow.spawn(STYLE_SPARK, px, py, pz, _dir.x * sp, _dir.y * sp + 1.5, _dir.z * sp, _c, rand(0.06, 0.11), rand(0.2, 0.4), 9);
    }
    // 碎块（敌人色）
    _c2.copy(_c).multiplyScalar(0.7);
    const chunks = this.count(crit ? 5 : 2);
    for (let i = 0; i < chunks; i++) {
      randomDir(_dir);
      const sp = rand(2, 5);
      this.smoke.spawn(STYLE_CHUNK, px, py, pz, _dir.x * sp, _dir.y * sp + 2, _dir.z * sp, _c2, rand(0.04, 0.08), rand(0.4, 0.8));
    }
    const sparks = this.count(crit ? 10 : 4);
    for (let i = 0; i < sparks; i++) {
      randomDir(_dir);
      const sp = rand(5, 11) * k;
      this.sparks.spawn(px, py, pz, _dir.x * sp, _dir.y * sp, _dir.z * sp, crit ? WARM_WHITE : _c, rand(0.08, 0.2), 0.018, 8);
    }
    if (crit) {
      // 暴击：金色星芒 + 白色核心
      hexToColor(0xffd24a, _c3);
      this.glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _c3, 1.0, 0.12);
      this.glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, WHITE, 0.45, 0.06);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
        const sp = rand(9, 13);
        this.sparks.spawn(px, py, pz, Math.cos(a) * sp, jitter(3) + 1, Math.sin(a) * sp, _c3, rand(0.1, 0.16), 0.026, 3);
      }
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = DEFAULT_TRACER, width = 0.05): void {
    if (!finite3(from) || !finite3(to)) return;
    this.trails.tracer(from, to, color, Math.min(0.5, posOr(width, 0.05)));
  }

  explosion(center: THREE.Vector3, radius: number, color = DEFAULT_EXPLOSION): void {
    if (!finite3(center)) return;
    const r = Math.min(12, Math.max(0.4, posOr(radius, 1)));
    const d = this.density();
    const cx = center.x, cy = center.y, cz = center.z;
    hexToColor(color, _c);
    hexToColor(HOT_YELLOW, _hot);

    // 闪光球：白热核心 + 主色火球
    this.flashes.sphere(center, r * 0.25, r * 0.95, color, 0.3);
    this.flashes.sphere(center, r * 0.15, r * 0.5, HOT_YELLOW, 0.15);
    this.glow.spawn(STYLE_GLOW, cx, cy, cz, 0, 0, 0, WHITE, r * 1.8, 0.1);

    // 火团
    const fire = Math.min(60, Math.round((12 + r * 6) * d));
    for (let i = 0; i < fire; i++) {
      randomDir(_dir);
      const off = r * 0.3 * Math.random();
      const sp = r * rand(1.2, 3.2);
      mixColor(_hot, _c, Math.random(), _c2);
      this.glow.spawn(
        STYLE_FIREBALL,
        cx + _dir.x * off, cy + _dir.y * off, cz + _dir.z * off,
        _dir.x * sp, _dir.y * sp + 1.2, _dir.z * sp,
        _c2, r * rand(0.35, 0.65), rand(0.3, 0.6),
      );
    }
    // 火花
    const sparks = Math.min(90, Math.round((22 + r * 8) * d));
    const spMul = 0.7 + Math.min(1.2, r * 0.12);
    for (let i = 0; i < sparks; i++) {
      randomDir(_dir);
      if (_dir.y < -0.2) _dir.y = -_dir.y * 0.5;
      const sp = rand(8, 22) * spMul;
      this.sparks.spawn(cx, cy, cz, _dir.x * sp, _dir.y * sp + 2, _dir.z * sp, i % 3 === 0 ? _hot : _c, rand(0.3, 0.9), 0.03, 14);
    }
    // 余烬
    const embers = Math.min(30, Math.round((8 + r * 3) * d));
    for (let i = 0; i < embers; i++) {
      randomDir(_dir);
      const sp = rand(2, 6);
      this.glow.spawn(STYLE_EMBER, cx + _dir.x * r * 0.4, cy + _dir.y * r * 0.3, cz + _dir.z * r * 0.4, _dir.x * sp, Math.abs(_dir.y) * sp + 1, _dir.z * sp, _c, rand(0.06, 0.12), rand(0.9, 1.7));
    }
    // 烟
    hexToColor(SMOKE_DARK, _c3);
    mixColor(_c3, _c, 0.18, _c3);
    const smoke = Math.min(26, Math.round((7 + r * 2.5) * d));
    for (let i = 0; i < smoke; i++) {
      randomDir(_dir);
      const off = r * 0.35 * Math.random();
      const sp = r * rand(0.4, 1.1);
      const shade = rand(0.7, 1.25);
      _c2.setRGB(_c3.r * shade, _c3.g * shade, _c3.b * shade);
      this.smoke.spawn(
        STYLE_SMOKE,
        cx + _dir.x * off, cy + Math.abs(_dir.y) * off, cz + _dir.z * off,
        _dir.x * sp, Math.abs(_dir.y) * sp + 0.8, _dir.z * sp,
        _c2, r * rand(0.4, 0.7), rand(1.1, 2.1),
      );
    }
    // 碎石
    hexToColor(CHUNK_DARK, _c3);
    const chunks = Math.min(22, Math.round((5 + r * 1.5) * d));
    for (let i = 0; i < chunks; i++) {
      randomDir(_dir);
      const sp = rand(5, 13);
      this.smoke.spawn(STYLE_CHUNK, cx, cy, cz, _dir.x * sp, Math.abs(_dir.y) * sp + 3, _dir.z * sp, _c3, rand(0.07, 0.17), rand(0.8, 1.4));
    }

    // 贴地：冲击波环 + 焦痕
    const gy = this.groundBelow(center);
    const height = cy - gy;
    if (height < r * 0.9) {
      _p.set(cx, gy, cz);
      this.ground.ring(_p, r * 1.5, color, 0.42, false);
      _n.set(0, 1, 0);
      this.ground.hole(_p, _n, r * 1.3, 1, 16);
    }

    // 点光源（低画质时光源在换关时已整体关闭；中途切到低画质也不再点亮）
    if (this.ctx.settings.quality !== 'low') {
      this.flashes.light(center, color, Math.min(90, 20 + r * 15), r * 5 + 4, 0.38);
    }

    // 按距离屏震（基线）。很多调用方（Combat 的 explosionShake、Boss 招式）还会自己再震一次，
    // shake 取 max：这里用平方衰减，贴脸的爆炸够有力，远处的（包括玩家自己打出去的榴弹）只是轻微一颤，
    // 不会盖过调用方有意给的强度。没有自己震屏的爆炸（爆骸虫、爆裂词缀）也有反馈。
    const cam = this.ctx.camera.position;
    const dist = Math.sqrt((cam.x - cx) ** 2 + (cam.y - cy) ** 2 + (cam.z - cz) ** 2);
    const k = clamp01(1 - dist / (r * 4 + 10));
    if (k > 0.05) this.shake(Math.min(0.85, (0.15 + 0.1 * r) * k * k), 0.22 + 0.2 * k + Math.min(0.15, r * 0.03));
  }

  damageNumber(pos: THREE.Vector3, amount: number, opts?: DamageNumberOpts): void {
    if (!this.ctx.settings.damageNumbers) return;
    this.numbers.spawn(pos, amount, opts, this.ctx.camera.position, this.ctx.time.frame);
  }

  burst(pos: THREE.Vector3, color: number, count = 12, speed = 4, life = 0.5, size = 0.12, gravity = 0): void {
    if (!finite3(pos) || !(count >= 1)) return;
    speed = Number.isFinite(speed) ? Math.max(0, speed) : 4;
    life = Math.min(5, posOr(life, 0.5));
    size = Math.min(3, posOr(size, 0.12));
    gravity = Number.isFinite(gravity) ? gravity : 0;
    const n = Math.min(240, this.count(count));
    if (isDustColor(color)) {
      this.dustBurst(pos, color, n, speed, life, size, gravity);
      return;
    }
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.5, _hot);
    for (let i = 0; i < n; i++) {
      randomDir(_dir);
      const sp = speed * rand(0.35, 1);
      this.glow.spawn(
        STYLE_GLOW, pos.x, pos.y, pos.z,
        _dir.x * sp, _dir.y * sp, _dir.z * sp,
        i % 4 === 0 ? _hot : _c, size * rand(0.7, 1.35), life * rand(0.7, 1.2), gravity,
      );
    }
    if (speed >= 5) {
      const s = Math.min(60, Math.round(n / 3));
      for (let i = 0; i < s; i++) {
        randomDir(_dir);
        const sp = speed * rand(0.8, 1.6);
        this.sparks.spawn(pos.x, pos.y, pos.z, _dir.x * sp, _dir.y * sp, _dir.z * sp, _c, life * rand(0.4, 0.8), 0.02, gravity > 0 ? gravity : 6);
      }
    }
    // 中心闪光：只给一下子迸出的爆发；按数量从小到大，不再固定 size×4（火箭烟迹每 0.05 秒一次时会变成一串发光球）
    if (count >= BURST_FLASH_MIN_COUNT) {
      this.glow.spawn(STYLE_GLOW, pos.x, pos.y, pos.z, 0, 0, 0, _hot, size * (2 + Math.min(2, count / 15)) + 0.12, Math.min(0.12, life * 0.3));
    }
  }

  /**
   * 沙尘 / 烟类 burst：普通混合的烟尘粒子（会膨胀、受阻力停住），速度快时带几块碎屑；不发光、不加闪光。
   * 参数含义与 burst 相同（size 视为尘团直径的基准）。
   */
  private dustBurst(pos: THREE.Vector3, color: number, n: number, speed: number, life: number, size: number, gravity: number): void {
    hexToColor(color, _c);
    // 尘土粒子受阻力很快减速：重力减半，避免「扬起来立刻砸回地面」
    const g = gravity * 0.5;
    for (let i = 0; i < n; i++) {
      randomDir(_dir);
      const sp = speed * rand(0.3, 1);
      const shade = rand(0.82, 1.12);
      _c2.setRGB(_c.r * shade, _c.g * shade, _c.b * shade);
      this.smoke.spawn(
        STYLE_DUST, pos.x, pos.y, pos.z,
        _dir.x * sp, Math.abs(_dir.y) * sp * 0.7 + speed * 0.12, _dir.z * sp,
        _c2, size * rand(1.3, 2.1), life * rand(0.9, 1.5), g,
      );
    }
    if (speed >= 5) {
      _c3.copy(_c).multiplyScalar(0.55);
      const chunks = Math.min(16, Math.round(n / 3));
      for (let i = 0; i < chunks; i++) {
        randomDir(_dir);
        const sp = speed * rand(0.6, 1.2);
        this.smoke.spawn(STYLE_CHUNK, pos.x, pos.y, pos.z, _dir.x * sp, Math.abs(_dir.y) * sp + 2, _dir.z * sp, _c3, Math.min(0.2, size * rand(0.25, 0.5)), rand(0.6, 1.1));
      }
    }
  }

  ring(center: THREE.Vector3, radius: number, color = DEFAULT_RING, duration = 0.5): void {
    if (!finite3(center) || !(radius > 0) || !Number.isFinite(radius)) return;
    // 竖直光墙只给中小型环（见 Ground.ring）
    this.ground.ring(center, Math.min(60, radius), color, Math.min(5, posOr(duration, 0.5)), true);
  }

  /**
   * 返回取消函数（攻击被打断时调用）：预警圈停止填充，约 0.1 秒内淡出并回收到池。
   * 取消函数只认这一次生成的预警：槽位被新预警复用、换关 clear 之后调用都无效；重复调用安全。
   */
  groundWarning(center: THREE.Vector3, radius: number, duration: number, color = DEFAULT_WARNING): () => void {
    if (!finite3(center) || !(radius > 0) || !Number.isFinite(radius)) return NOOP;
    // 时长非法时仍然给一个短预警，而不是一个永远填不满的圈
    return this.ground.warning(center, Math.min(60, radius), Math.min(30, posOr(duration, 0.5)), color);
  }

  /** 返回取消函数（提前结束光束，约 0.1 秒淡出）；规则同 groundWarning。每帧连续调用合并成的同一条光束共用一个取消函数。 */
  beam(from: THREE.Vector3, to: THREE.Vector3, color = DEFAULT_BEAM, width = 0.18, duration = 0.1): () => void {
    if (!finite3(from) || !finite3(to)) return NOOP;
    return this.trails.beam(from, to, color, Math.min(2, posOr(width, 0.18)), Math.min(10, posOr(duration, 0.1)), this.ctx.time.frame);
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3, color = DEFAULT_LIGHTNING): void {
    if (!finite3(from) || !finite3(to)) return;
    this.trails.lightning(from, to, color);
  }

  shake(intensity: number, duration = 0.2): void {
    const fx = this.ctx.cameraFx;
    const scaled = Math.min(SHAKE_MAX, intensity * this.ctx.settings.screenShake);
    // NaN 写进 shakeIntensity 会让相机位置变成 NaN（整个画面消失）
    if (!(scaled > 0) || !(duration > 0)) return;
    if (!Number.isFinite(fx.shakeIntensity) || !Number.isFinite(fx.shakeTime)) {
      fx.shakeIntensity = 0;
      fx.shakeTime = 0;
    }
    fx.shakeIntensity = Math.max(fx.shakeIntensity, scaled);
    fx.shakeTime = Math.max(fx.shakeTime, Math.min(SHAKE_MAX_TIME, duration));
  }

  spawnEffect(pos: THREE.Vector3, color = DEFAULT_ENEMY): void {
    if (!finite3(pos)) return;
    const gy = this.groundBelow(pos);
    // 飞行单位在空中出生：法阵画在它脚下的空中
    _p.set(pos.x, pos.y - gy > 1.2 ? pos.y : gy, pos.z);
    this.ground.circle(_p, 1.35, color, SPAWN_DURATION + 0.25);
    this.ground.band(_p, 0.6, 2.8, color, SPAWN_DURATION + 0.1, false);
    const e = this.takeEmitter();
    e.active = true;
    e.x = _p.x;
    e.y = _p.y;
    e.z = _p.z;
    hexToColor(color, e.color);
    e.age = 0;
    e.acc = 0;
    e.finale = false;
    e.stamp = ++this.emitterStamp;
  }

  deathEffect(pos: THREE.Vector3, color = DEFAULT_ENEMY, size = 1.2): void {
    if (!finite3(pos)) return;
    const s = Math.min(6, Math.max(0.5, posOr(size, 1.2)));
    const d = this.density();
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.5, _hot);
    const px = pos.x, py = pos.y, pz = pos.z;

    this.glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _hot, s * 1.5, 0.14);
    this.flashes.sphere(pos, s * 0.2, s * 0.7, color, 0.2);

    // 碎块
    const chunks = Math.min(50, Math.round((9 + 6 * s) * d));
    for (let i = 0; i < chunks; i++) {
      randomDir(_dir);
      const off = s * 0.25 * Math.random();
      const sp = rand(2.5, 7.5) * (0.8 + s * 0.15);
      const shade = rand(0.45, 1);
      _c2.setRGB(_c.r * shade, _c.g * shade, _c.b * shade);
      this.smoke.spawn(
        STYLE_CHUNK,
        px + _dir.x * off, py + _dir.y * off, pz + _dir.z * off,
        _dir.x * sp, Math.abs(_dir.y) * sp + rand(2, 5), _dir.z * sp,
        _c2, rand(0.07, 0.17) * Math.pow(s, 0.6), rand(0.9, 1.6),
      );
    }
    // 发光碎屑
    const motes = Math.min(50, Math.round((12 + 6 * s) * d));
    for (let i = 0; i < motes; i++) {
      randomDir(_dir);
      const sp = rand(1.5, 5.5);
      this.glow.spawn(STYLE_SPARK, px, py, pz, _dir.x * sp, _dir.y * sp + 1.5, _dir.z * sp, i & 1 ? _c : _hot, rand(0.07, 0.14), rand(0.35, 0.8), 7);
    }
    const sparks = Math.min(40, Math.round((8 + 4 * s) * d));
    for (let i = 0; i < sparks; i++) {
      randomDir(_dir);
      const sp = rand(6, 13);
      this.sparks.spawn(px, py, pz, _dir.x * sp, _dir.y * sp + 2, _dir.z * sp, _c, rand(0.2, 0.5), 0.022, 12);
    }
    // 烟
    hexToColor(SMOKE_DARK, _c3);
    mixColor(_c3, _c, 0.3, _c3);
    const smoke = Math.min(16, Math.round((4 + 2 * s) * d));
    for (let i = 0; i < smoke; i++) {
      randomDir(_dir);
      const sp = rand(0.5, 1.6);
      this.smoke.spawn(STYLE_SMOKE, px + _dir.x * s * 0.3, py + _dir.y * s * 0.2, pz + _dir.z * s * 0.3, _dir.x * sp, Math.abs(_dir.y) * sp + 0.6, _dir.z * sp, _c3, s * rand(0.5, 0.85), rand(0.9, 1.6));
    }
    // 魂火：几颗慢慢升起的光点
    const souls = s > 2 ? 4 : 2;
    for (let i = 0; i < souls; i++) {
      this.glow.spawn(STYLE_MOTE, px + jitter(s * 0.3), py, pz + jitter(s * 0.3), jitter(0.4), rand(0.5, 1.4), jitter(0.4), _hot, rand(0.12, 0.2), rand(0.9, 1.4), -1.5);
    }
    // 地面小冲击环
    _p.set(px, this.groundBelow(pos), pz);
    if (py - _p.y < s * 1.5) this.ground.ring(_p, s * 1.2, color, 0.38, false);
  }

  // ───────────── 生命周期 ─────────────

  update(dt: number): void {
    const ctx = this.ctx;
    const state = ctx.game.state;
    const frozen = state === 'paused' || state === 'modal';
    const d = frozen ? 0 : dt;
    this.time += d;

    // 相机矩阵在渲染前才会更新；这里手动刷新，保证投影与朝向是本帧的
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(_camFwd);
    ctx.renderer.getDrawingBufferSize(_buf);
    particleScaleUniform.value = _buf.y / (2 * Math.tan((cam.fov * Math.PI) / 360));

    const floorY = this.floorY();
    this.glow.update(d, floorY);
    this.smoke.update(d, floorY);
    this.sparks.update(d, floorY);
    if (d > 0) this.updateEmitters(d);

    // 线状特效先占批次容量，火花拖尾在后（容量不足时先丢火花）
    this.ribbons.begin(_camPos, this.time);
    this.trails.update(d, this.ribbons);
    this.sparks.render(this.ribbons);
    this.ribbons.end();

    this.ground.update(d);
    this.flashes.update(d);
    this.numbers.update(d, cam, _camPos, _camFwd, ctx.settings.damageNumbers);
  }

  clear(): void {
    this.glow.clear();
    this.smoke.clear();
    this.sparks.clear();
    this.trails.clear();
    this.ribbons.begin(_camPos, this.time);
    this.ribbons.end();
    this.ground.clear();
    this.flashes.clear();
    this.numbers.clear();
    for (const e of this.emitters) e.active = false;
  }

  // ───────────── 出生发射器 ─────────────

  private takeEmitter(): Emitter {
    let oldest = this.emitters[0];
    for (const e of this.emitters) {
      if (!e.active) return e;
      if (e.stamp < oldest.stamp) oldest = e;
    }
    return oldest;
  }

  private updateEmitters(dt: number): void {
    const rate = 42 * this.density();
    for (const e of this.emitters) {
      if (!e.active) continue;
      e.age += dt;
      if (e.age < SPAWN_DURATION) {
        // 从法阵边缘螺旋上升的光点
        e.acc += dt * rate;
        while (e.acc >= 1) {
          e.acc -= 1;
          const a = Math.random() * Math.PI * 2;
          const rr = rand(0.35, 1.25);
          const x = e.x + Math.cos(a) * rr, z = e.z + Math.sin(a) * rr;
          // 切向 + 向内，形成旋涡
          const tx = -Math.sin(a) * 1.4 - Math.cos(a) * 0.6;
          const tz = Math.cos(a) * 1.4 - Math.sin(a) * 0.6;
          this.glow.spawn(STYLE_MOTE, x, e.y + 0.05, z, tx, rand(1.8, 4.2), tz, e.color, rand(0.07, 0.14), rand(0.45, 0.85));
        }
      }
      if (!e.finale && e.age >= SPAWN_DURATION - 0.1) {
        // 现身：一圈外扩的光粒 + 闪光
        e.finale = true;
        mixColor(e.color, WHITE, 0.5, _hot);
        this.glow.spawn(STYLE_GLOW, e.x, e.y + 1, e.z, 0, 0, 0, _hot, 2.2, 0.16);
        const n = this.count(18);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const sp = rand(3, 5.5);
          this.glow.spawn(STYLE_SPARK, e.x, e.y + rand(0.3, 1.5), e.z, Math.cos(a) * sp, rand(-0.5, 1.5), Math.sin(a) * sp, e.color, rand(0.08, 0.13), rand(0.3, 0.5), 2);
        }
        _p.set(e.x, e.y, e.z);
        this.ground.ring(_p, 2, e.color.getHex(), 0.35, false);
      }
      if (e.age >= SPAWN_DURATION + 0.05) e.active = false;
    }
  }
}
