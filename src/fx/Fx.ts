/**
 * 特效系统（IFx 实现）：把粒子、火花拖尾、线状特效、贴地特效、闪光组合成玩法需要的各种反馈（伤害数字转交 UI 的 HUD 部件）。
 *
 * 结构：
 *  - glow（加法粒子，4000）/ smoke（普通混合粒子：烟、尘、碎屑，1500）
 *  - sparks（拉丝火花）+ trails（tracer / beam / lightning）→ 共用一个 RibbonBatch
 *  - ground（冲击波环、预警圈、法阵、光柱、弹孔）、flashes（闪光球 + ≤3 点光源）
 * 所有特效物体挂在常驻的 fx 根节点（直接在 ctx.scene 下，不在 stageGroup），换关由 clear() 统一清掉。
 * 暂停 / 模态框期间特效冻结（与玩法时间同步，预警圈不会「偷跑」）。
 * 所有入口都丢弃非有限的向量 / 参数（NaN 写进点光源会让整个场景的受光材质出错）。
 */
import * as THREE from 'three';
import type { DamageNumberOpts, GameContext, IFx } from '../core/types';
import { clamp01 } from '../core/math';
import {
  ParticlePool, particleScaleUniform,
  STYLE_CHUNK, STYLE_DUST, STYLE_EMBER, STYLE_FIREBALL, STYLE_FLAME, STYLE_GLINT, STYLE_GLOW, STYLE_GLYPH, STYLE_LINGER, STYLE_MOTE, STYLE_SKITTER,
  STYLE_BLAST_SMOKE, STYLE_SMOKE, STYLE_SPARK, SHAPE_GLOW, SHAPE_SMOKE, FADE_SMOKE, type ParticleStyle,
} from './Particles';
import { SealEffects, type SealHandle, type SealOptions } from './Seal';
import { SparkStreaks } from './Sparks';
import { RibbonBatch } from './Ribbons';
import { TrailEffects } from './Trails';
import { GroundEffects } from './Ground';
import { FlashEffects } from './Flash';
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
// 元素色（core/types.ts 的 ELEMENT_COLORS）：弹着点按颜色认元素，留下各自的后果
const EL_FIRE = 0xff6a1f;
const EL_SHOCK = 0x6fd8ff;
const EL_CORRODE = 0x9dff4a;
const SOOT = 0x3a2a26;
const EMBER_SPOT = 0xff6b1a;
/** 雷的暗边（fx-style 2.1：靛紫）：垫在电弧底下的一小团暗底，亮地面上电弧才读得出来 */
const SHOCK_UNDER = 0x2a2f6e;

// 余韵层的限流（docs/art/fx-style.md 5.5）：任何一层被限掉都不影响读感
const AFTER_PER_FRAME = 3;
const WAKE_PER_FRAME = 12;
const THROUGH_PER_FRAME = 4;
const DEATH_PER_FRAME = 3;
const LATERS = 48;
const SOULS = 96;

/** 慢半拍才出的层（烟、尘、第二响）：闪光过去之后再升起来 */
const enum LaterKind { Dust, Soot, Arc, Bubbles, Fume, DeathEcho, SkillEcho, DustRing, BlastSmoke }
interface Later {
  t: number; kind: LaterKind;
  x: number; y: number; z: number; nx: number; ny: number; nz: number;
  color: number; s: number;
}
/** 被吸过去的光点：先迸开悬一悬，再盘旋着飞向目标，到了就消失 */
interface Soul {
  live: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; hang: number; pull: number; swirl: number; size: number;
  r: number; g: number; b: number;
  target: THREE.Vector3; offY: number;
}

const EMITTERS = 32;
const SPAWN_DURATION = 0.7;
/** 相机震动上限（玩家相机把强度钳在 2；单次写入不超过这个值，时长不超过 3 秒） */
const SHAKE_MAX = 1.5;
const SHAKE_MAX_TIME = 3;
/** burst 的中心闪光只给「一下子迸出」的爆发（低数量的持续发射——烟迹、灼烧火苗——不加） */
const BURST_FLASH_MIN_COUNT = 6;
/** 参数非法、什么都没生成时返回的取消函数 */
const NOOP = (): void => {};
/** 喷火器火舌（Unity FlameCone Flames：Glow 贴图、加法、上浮 3、阻尼 1.2、长到 5.5 倍、烟式淡出） */
const STYLE_JET: ParticleStyle = { gravity: -3, drag: 1.2, grow: 5.5, alpha: 0.95, shape: SHAPE_GLOW, fade: FADE_SMOKE, bounce: false };
/** 喷火器的烟（Unity FlameCone Smoke：透明、上浮 2.2、阻尼 1.8、长到 3.2 倍、不透明度 0.32） */
const STYLE_JET_SMOKE: ParticleStyle = { gravity: -2.2, drag: 1.8, grow: 3.2, alpha: 0.32, shape: SHAPE_SMOKE, fade: FADE_SMOKE, bounce: false };

// 模块级临时量（热路径零分配）
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _hot = new THREE.Color();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _buf = new THREE.Vector2();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _c4 = new THREE.Color();

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
  private readonly emitters: Emitter[] = [];
  private emitterStamp = 0;
  private time = 0;
  private readonly seals = new SealEffects();
  private readonly laters: Later[] = [];
  private readonly souls: Soul[] = [];
  private soulsLive = 0;
  private afterN = 0;
  private wakeN = 0;
  private throughN = 0;
  private deathN = 0;
  private shotFrame = -1;
  private shotCount = 0;
  private airAt = -10;
  private kickAt = -10;
  private markAt = -10;
  private lightAt = -10;
  /** 余韵层的累计计数（自查用）：气浪 / 扬尘 / 光屑 / 落点余韵 / 击穿 / 死亡余韵 / 魂火发出 / 魂火到达 */
  readonly stats = { air: 0, kick: 0, wake: 0, after: 0, through: 0, death: 0, souls: 0, arrived: 0 };
  /** 上次预编译时的雾类型（0 无 / 1 线性 / 2 指数），变化时重新预编译 */
  private compiledFog = -1;

  constructor(readonly ctx: GameContext) {
    this.root.name = 'fx';
    this.trails = new TrailEffects(this.glow, this.sparks);
    this.glow.points.renderOrder = ORDER_GLOW;
    this.smoke.points.renderOrder = ORDER_SMOKE;
    this.root.add(this.smoke.points, this.glow.points, this.ribbons.mesh, this.ground.group, this.flashes.group, this.seals.group);
    for (let i = 0; i < LATERS; i++) this.laters.push({ t: -1, kind: LaterKind.Dust, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, color: 0, s: 1 });
    for (let i = 0; i < SOULS; i++) {
      this.souls.push({
        live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 2, hang: 0.2, pull: 40, swirl: 0.5, size: 0.12, r: 1, g: 1, b: 1,
        target: _camPos, offY: 0,
      });
    }
    // 法印写出时，领笔的亮点沿外圈甩出光屑
    this.seals.onGlint = (pos, radial, normal, color) => {
      mixColor(color, WHITE, 0.45, _c4);
      const sp = rand(0.6, 1.6), up = rand(0.6, 1.8);
      this.glow.spawn(
        STYLE_GLINT, pos.x, pos.y, pos.z, radial.x * sp + normal.x * up, radial.y * sp + normal.y * up, radial.z * sp + normal.z * up,
        _c4, rand(0.07, 0.12), rand(0.25, 0.45),
      );
    };
    for (let i = 0; i < EMITTERS; i++) {
      this.emitters.push({ active: false, x: 0, y: 0, z: 0, color: new THREE.Color(), age: 0, acc: 0, finale: false, stamp: 0 });
    }
  }

  init(): void {
    const ctx = this.ctx;
    ctx.scene.add(this.root);
    this.flashes.attachLights(ctx.scene);
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
    this.impactAfter(px, py, pz, n, color, s);
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
    this.hitThrough(px, py, pz, crit);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = DEFAULT_TRACER, width = 0.05): void {
    if (!finite3(from) || !finite3(to)) return;
    const w = Math.min(0.5, posOr(width, 0.05));
    this.trails.tracer(from, to, color, w);
    this.tracerWake(from, to, color, w);
    this.shotWorld(from, to, color, w);
  }

  explosion(center: THREE.Vector3, radius: number, color = DEFAULT_EXPLOSION): void {
    if (!finite3(center)) return;
    const r = Math.min(12, Math.max(0.4, posOr(radius, 1)));
    const d = this.density();
    const cx = center.x, cy = center.y, cz = center.z;
    hexToColor(color, _c);
    hexToColor(HOT_YELLOW, _hot);

    // 闪光：白热亮芯第一帧到峰值、0.07 秒就没（fx-style 5.6「越亮的越短」）；闪光球收到 0.6r、0.22 秒
    this.flashes.sphere(center, r * 0.2, r * 0.6, color, 0.22);
    this.flashes.sphere(center, r * 0.12, r * 0.4, HOT_YELLOW, 0.12);
    this.glow.spawn(STYLE_GLOW, cx, cy, cz, 0, 0, 0, WHITE, r * 0.9, 0.07);

    // 火团：加法的光团只留一小簇亮芯，火的形状和颜色交给火舌（火舌遮住身后一部分，亮地面上也是橙色、有轮廓）。
    // 原来是 12 + 6r 团加法光团（4.5 米的爆炸 39 团、每团长到 4.7 米、往外甩 5–14 m/s），叠起来是没有形状的一整团白：
    // 检视页雪地上，爆点正后方的敌人从 0.05 到 0.3 秒完全看不见
    const fire = Math.min(24, Math.round((6 + r * 2.5) * d));
    for (let i = 0; i < fire; i++) {
      randomDir(_dir);
      const off = r * 0.2 * Math.random();
      const sp = r * rand(0.6, 1.6);
      mixColor(_hot, _c, Math.random(), _c2);
      this.glow.spawn(
        STYLE_FIREBALL,
        cx + _dir.x * off, cy + _dir.y * off, cz + _dir.z * off,
        _dir.x * sp, _dir.y * sp + 1.2, _dir.z * sp,
        _c2, r * rand(0.22, 0.4), rand(0.18, 0.35),
      );
    }
    const tongues = Math.min(16, Math.round((5 + r * 1.5) * d));
    for (let i = 0; i < tongues; i++) {
      randomDir(_dir);
      if (_dir.y < 0) _dir.y = -_dir.y * 0.4;
      const off = r * 0.25 * Math.random();
      const sp = r * rand(0.4, 1.1);
      this.glow.spawn(
        STYLE_FLAME,
        cx + _dir.x * off, cy + _dir.y * off * 0.5, cz + _dir.z * off,
        _dir.x * sp, _dir.y * sp + 1.0, _dir.z * sp,
        _c, Math.min(1.8, r * rand(0.22, 0.36)), rand(0.25, 0.4),
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
    // 烟：等闪光过去（0.06 秒）再出，往上冒而不是往四周铺（见 updateLaters 的 BlastSmoke）。
    // 原来是 7 + 2.5r 团（4.5 米的爆炸 18 团）、每团直径 0.4–0.7r 再长到 2.2 倍、横着甩出去 0.4–1.1r m/s、活 2 秒，
    // 在爆点后面立起一堵六七米宽的墙：检视页里 4.5 米爆炸后 0.6 秒，正后方敌人的剪影还有一半被盖着
    this.later(LaterKind.BlastSmoke, 0.06, cx, cy, cz, null, color, r);
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

  /** 伤害数字是界面的 HUD 部件（ui/hud/DamageNumbers，M11c）：这里只转交给 UI（旧的 DOM 数字 fx/DamageNumbers 不再挂） */
  damageNumber(pos: THREE.Vector3, amount: number, opts?: DamageNumberOpts): void {
    if (!this.ctx.settings.damageNumbers) return;
    this.ctx.ui?.damageNumber?.(pos, amount, opts);
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
    // 镜头手感（player/CameraRig，Unity CameraShake 的 trauma 声部）：原始强度交给它，设置「震屏强度」在出画面时乘
    const add = (fx as unknown as { addShake?: (strength: number, duration: number) => void }).addShake;
    if (typeof add === 'function' && intensity > 0 && duration > 0) add(intensity, duration);
    // 旧通道照写（首领登场演出读 shakeIntensity / shakeTime）
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
    const grounded = py - _p.y < s * 1.5;
    if (grounded) this.ground.ring(_p, s * 1.2, color, 0.38, false);
    this.deathAfter(pos, _p.y, grounded, color, s);
  }

  // ───────────── 余韵与世界回应（docs/art/fx-style.md 第五节） ─────────────

  private later(kind: LaterKind, delay: number, x: number, y: number, z: number, n: THREE.Vector3 | null, color: number, s: number): void {
    for (const l of this.laters) {
      if (l.t >= 0) continue;
      l.t = delay; l.kind = kind;
      l.x = x; l.y = y; l.z = z;
      l.nx = n ? n.x : 0; l.ny = n ? n.y : 1; l.nz = n ? n.z : 0;
      l.color = color; l.s = s;
      return;
    }
  }

  /** 一盏短灯（照亮周围）：全场只有三盏，0.06 秒内不重复点 */
  private afterLight(x: number, y: number, z: number, color: number, peak: number, distance: number, life: number): void {
    if (this.ctx.settings.quality === 'low' || this.time - this.lightAt < 0.06) return;
    this.lightAt = this.time;
    this.flashes.light(_t2.set(x, y, z), color, peak, distance, life);
  }

  /**
   * 弹着点的余韵：无元素 = 还在蹦的火星 + 余温 + 慢半拍的一小团尘；火 = 几条火舌舔上来 + 余烬 + 晚一拍的烟；
   * 雷 = 电弧贴着表面爬两拍 + 光屑；蚀 = 蚀液往下滴 + 冒泡 + 一小团绿烟。重弹和元素弹再闪一盏短灯。每帧最多 3 处。
   */
  private impactAfter(px: number, py: number, pz: number, n: THREE.Vector3, color: number, s: number): void {
    if (this.afterN >= AFTER_PER_FRAME) return;
    this.afterN++;
    this.stats.after++;
    const rs = Math.sqrt(s);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.3, _hot);
    const el = color === EL_FIRE ? 1 : color === EL_SHOCK ? 2 : color === EL_CORRODE ? 3 : 0;
    if (el === 1) {
      const flames = Math.min(3, 1 + Math.round(s));
      for (let i = 0; i < flames; i++) {
        const sp = rand(0.3, 0.9);
        this.glow.spawn(
          STYLE_FLAME, px + n.x * 0.05 + jitter(0.08), py + n.y * 0.05, pz + n.z * 0.05 + jitter(0.08),
          n.x * sp + jitter(0.3), n.y * sp + 0.9, n.z * sp + jitter(0.3), _c, rand(0.28, 0.42) * rs, rand(0.35, 0.6),
        );
      }
      const embers = this.count(Math.min(8, 2 + 2 * s));
      for (let i = 0; i < embers; i++) {
        randomDir(_dir).addScaledVector(n, 0.6).normalize();
        const sp = rand(1, 3);
        this.glow.spawn(STYLE_EMBER, px, py, pz, _dir.x * sp, _dir.y * sp + 1.2, _dir.z * sp, _c, rand(0.05, 0.09), rand(0.7, 1.2));
      }
      this.later(LaterKind.Soot, 0.12, px, py, pz, n, color, s);
    } else if (el === 2) {
      this.arcs(px, py, pz, n, color, 3, 0.22 * rs);
      this.later(LaterKind.Arc, 0.07, px, py, pz, n, color, s);
      for (let i = 0; i < 3; i++) {
        randomDir(_dir).addScaledVector(n, 0.7).normalize();
        const sp = rand(2, 5);
        this.glow.spawn(STYLE_GLINT, px, py, pz, _dir.x * sp, _dir.y * sp, _dir.z * sp, _hot, rand(0.07, 0.11), rand(0.2, 0.35));
      }
    } else if (el === 3) {
      const drops = this.count(Math.min(6, 2 + 2 * s));
      for (let i = 0; i < drops; i++) {
        randomDir(_dir).addScaledVector(n, 0.8).normalize();
        const sp = rand(1.5, 3.5);
        this.glow.spawn(STYLE_SKITTER, px, py, pz, _dir.x * sp, _dir.y * sp + 1, _dir.z * sp, _c, rand(0.07, 0.11), rand(0.5, 0.8), 9);
      }
      this.later(LaterKind.Bubbles, 0.1, px, py, pz, n, color, s);
      this.later(LaterKind.Fume, 0.08, px, py, pz, n, color, s);
    } else {
      const skitter = Math.min(4, 1 + Math.round(s));
      for (let i = 0; i < skitter; i++) {
        randomDir(_dir);
        const d = _dir.dot(n);
        if (d < 0) _dir.addScaledVector(n, -2 * d);
        _dir.addScaledVector(n, 0.5).normalize();
        const sp = rand(3, 7) * rs;
        this.glow.spawn(STYLE_SKITTER, px, py, pz, _dir.x * sp, _dir.y * sp + 1.5, _dir.z * sp, _hot, rand(0.05, 0.08), rand(0.5, 0.9));
      }
      // 余温：弹孔上一小团慢慢暗下去的橙光
      hexToColor(EMBER_SPOT, _c2);
      this.glow.spawn(STYLE_LINGER, px, py, pz, 0, 0, 0, _c2, 0.2 * rs, rand(0.4, 0.5));
      this.later(LaterKind.Dust, 0.05, px, py, pz, n, color, s);
    }
    if (s >= 1.15 || el !== 0) this.afterLight(px + n.x * 0.25, py + n.y * 0.25, pz + n.z * 0.25, color, el !== 0 ? 7 : 5, 3.2, 0.09);
  }

  /** 贴着表面爬的几道小电弧（法线所在平面里随机方向）；底下垫一小团很快散掉的靛紫暗底（加法的电弧叠在亮沙地、雪地上会淡到看不见） */
  private arcs(px: number, py: number, pz: number, n: THREE.Vector3, color: number, count: number, reach: number): void {
    hexToColor(SHOCK_UNDER, _c3);
    this.smoke.spawn(STYLE_SMOKE, px + n.x * 0.05, py + n.y * 0.05, pz + n.z * 0.05, 0, 0, 0, _c3, Math.max(0.3, reach * 1.6), 0.28, 0);
    for (let i = 0; i < count; i++) {
      randomDir(_dir);
      _dir.addScaledVector(n, -_dir.dot(n));
      if (_dir.lengthSq() < 1e-4) continue;
      _dir.normalize();
      const len = reach * rand(0.7, 1.6);
      _t1.set(px + n.x * 0.04, py + n.y * 0.04, pz + n.z * 0.04);
      _t2.copy(_t1).addScaledVector(_dir, len).addScaledVector(n, rand(0, 0.08));
      this.trails.lightning(_t1, _t2, color);
    }
  }

  /**
   * 弹道沿途掉下的光屑：从 4 米外开始、每 5–7 米一颗，横向慢慢飘开，0.16–0.3 秒熄灭；远处的略大。
   * 整条曳光 0.1 秒就没了，光屑多留 0.2 秒，读得出走向。细的（霰弹弹丸）每条只掉一颗。每帧最多 12 颗。
   */
  private tracerWake(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number): void {
    if (this.wakeN >= WAKE_PER_FRAME) return;
    _t1.subVectors(to, from);
    const len = _t1.length();
    if (!(len >= 6)) return;
    _t1.multiplyScalar(1 / len);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.5, _hot);
    const end = Math.min(len - 1, 34);
    const pellet = width < 0.016;
    // 粗曳光（左轮、狙击）一发最多 4 颗；细的（冲锋枪连射）2 颗、间隔拉开——实测 13 发 / 秒各掉 4 颗会在远处攒成一片散点
    const thin = width < 0.028;
    const cap = pellet ? 1 : thin ? 2 : 4;
    let t = pellet ? rand(4, Math.max(4.5, end)) : rand(4, thin ? 9 : 6);
    for (let i = 0; i < cap && t < end && this.wakeN < WAKE_PER_FRAME; i++) {
      const size = rand(0.07, 0.11) * (1 + t / 25);
      this.glow.spawn(
        STYLE_GLINT, from.x + _t1.x * t, from.y + _t1.y * t, from.z + _t1.z * t,
        _t1.x * 2 + jitter(1), _t1.y * 2 + jitter(1), _t1.z * 2 + jitter(1), _hot, size, rand(0.16, 0.3),
      );
      this.wakeN++;
      this.stats.wake++;
      t += thin ? rand(9, 13) : rand(5, 7);
    }
  }

  /**
   * 开枪对世界的回应（曳光从相机 1.6 米内出发 = 玩家开的枪，每帧只算一次）：往前推开的气浪丝（从枪口前 0.9 米起，不挡视野）；
   * 枪口前下方 2.6 米内有地面就掀起一片尘。重枪每发都有，轻枪气浪隔发、扬尘每 5 发。
   */
  private shotWorld(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number): void {
    const frame = this.ctx.time.frame;
    if (frame === this.shotFrame) return;
    const cam = this.ctx.camera.position;
    if (from.distanceToSquared(cam) > 1.6 * 1.6) return;
    _t1.subVectors(to, from);
    const len = _t1.length();
    if (!(len > 2)) return;
    _t1.multiplyScalar(1 / len);
    this.shotFrame = frame;
    this.shotCount++;
    // 分量：细的一束 = 霰弹（重），其余按曳光粗细
    const pellet = width < 0.016;
    const w = pellet ? 1.4 : Math.min(1.6, Math.max(0.4, width / 0.03));
    const heavy = w >= 0.9;
    if (this.time - this.airAt >= 0.045 && (heavy || (this.shotCount & 1) === 0)) {
      this.airAt = this.time;
      this.stats.air++;
      // 垂直于枪管的两个方向
      _t2.set(0, 1, 0).cross(_t1);
      if (_t2.lengthSq() < 1e-4) _t2.set(1, 0, 0);
      _t2.normalize();
      _p.crossVectors(_t1, _t2);
      if (color === EL_FIRE || color === EL_SHOCK || color === EL_CORRODE) mixColor(hexToColor(color, _c), WHITE, 0.55, _c4);
      else _c4.setRGB(1, 0.95, 0.85);
      _c4.multiplyScalar(0.85);
      const n = this.count(w * 5);
      const cone = pellet ? 0.22 : 0.1;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
        const ca = Math.cos(a), sa = Math.sin(a);
        const sx = _t2.x * ca + _p.x * sa, sy = _t2.y * ca + _p.y * sa, sz = _t2.z * ca + _p.z * sa;
        const off = rand(0.9, 1.7), spread = r * 0.14 * (0.6 + w), sp = rand(16, 26);
        this.sparks.spawn(
          from.x + _t1.x * off + sx * spread, from.y + _t1.y * off + sy * spread, from.z + _t1.z * off + sz * spread,
          (_t1.x + sx * r * cone) * sp, (_t1.y + sy * r * cone) * sp, (_t1.z + sz * r * cone) * sp,
          _c4, rand(0.16, 0.28), 0.022 + 0.008 * w, 0,
        );
      }
    }
    if (this.time - this.kickAt >= 0.12 && (heavy || this.shotCount % 5 === 0)) {
      const gx = from.x + _t1.x * 1.6, gz = from.z + _t1.z * 1.6, top = from.y + _t1.y * 1.6;
      const gy = this.ctx.world.groundHeight(gx, gz, top + 0.1);
      const drop = top - gy;
      if (Number.isFinite(gy) && drop > -0.1 && drop < 2.6) {
        this.kickAt = this.time;
        this.stats.kick++;
        const near = 1 - clamp01(drop / 2.6);
        const k = w * (0.5 + 0.7 * near);
        const fl = Math.hypot(_t1.x, _t1.z) || 1;
        const fx = _t1.x / fl, fz = _t1.z / fl;
        hexToColor(DUST, _c2);
        const puffs = this.count(Math.min(3, 1 + 1.4 * k));
        for (let i = 0; i < puffs; i++) {
          const sp = rand(1.2, 3.2) * Math.sqrt(k);
          const shade = rand(0.85, 1.15);
          _c3.setRGB(_c2.r * shade, _c2.g * shade, _c2.b * shade);
          this.smoke.spawn(
            STYLE_DUST, gx + jitter(0.3), gy + 0.06, gz + jitter(0.3), fx * sp + jitter(0.8), rand(0.5, 1.4), fz * sp + jitter(0.8),
            _c3, rand(0.24, 0.4) * Math.sqrt(k), rand(0.5, 0.85),
          );
        }
        hexToColor(CHUNK_DARK, _c3);
        const grit = this.count(Math.min(8, 1 + 3 * k));
        for (let i = 0; i < grit; i++) {
          const sp = rand(2, 5);
          this.smoke.spawn(STYLE_CHUNK, gx + jitter(0.2), gy + 0.05, gz + jitter(0.2), fx * sp + jitter(1.5), rand(1.5, 3.5), fz * sp + jitter(1.5), _c3, rand(0.03, 0.05), rand(0.4, 0.7));
        }
      }
    }
  }

  /** 打中敌人：沿子弹来的方向（相机 → 命中点）从背后带出去的一束，而不是原地一个球。每帧最多 4 束 */
  private hitThrough(px: number, py: number, pz: number, crit: boolean): void {
    if (this.throughN >= THROUGH_PER_FRAME) return;
    const cam = this.ctx.camera.position;
    _t1.set(px - cam.x, py - cam.y, pz - cam.z);
    const dist = _t1.length();
    if (!(dist > 0.5) || dist > 60) return;
    _t1.multiplyScalar(1 / dist);
    this.throughN++;
    this.stats.through++;
    // _c / _hot 还是 enemyHit 设的命中色
    const n = this.count(crit ? 6 : 3);
    for (let i = 0; i < n; i++) {
      randomDir(_dir).multiplyScalar(0.4).add(_t1).normalize();
      const sp = rand(7, 14);
      this.sparks.spawn(px + _t1.x * 0.15, py + _t1.y * 0.15, pz + _t1.z * 0.15, _dir.x * sp, _dir.y * sp, _dir.z * sp, i & 1 ? _c : _hot, rand(0.12, 0.22), 0.018, 8);
    }
    for (let i = 0; i < 2; i++) {
      randomDir(_dir).multiplyScalar(0.55).add(_t1).normalize();
      const sp = rand(3, 6);
      this.glow.spawn(STYLE_SPARK, px, py, pz, _dir.x * sp, _dir.y * sp + 1, _dir.z * sp, _c, rand(0.06, 0.1), rand(0.3, 0.5), 9);
    }
  }

  /**
   * 击杀之后的几层：敌人色的短灯；慢 0.09 秒的第二响（符点散开往上飘 + 余烬 + 一下小闪）；魂火先迸开再盘旋着归到玩家身上；
   * 够大的敌人在脚下留一块焦痕。每帧最多 3 个。
   */
  private deathAfter(pos: THREE.Vector3, groundY: number, grounded: boolean, color: number, s: number): void {
    if (this.deathN >= DEATH_PER_FRAME) return;
    this.deathN++;
    this.stats.death++;
    this.afterLight(pos.x, pos.y, pos.z, color, 8 + 2 * s, 3 + 1.2 * s, 0.16);
    this.later(LaterKind.DeathEcho, 0.09, pos.x, pos.y, pos.z, null, color, s);
    const cam = this.ctx.camera.position;
    if (pos.distanceToSquared(cam) < 45 * 45) {
      hexToColor(color, _c4);
      mixColor(_c4, WHITE, 0.4, _c4);
      const n = Math.min(10, Math.max(4, Math.round(3 + 2 * s)));
      // 归到胸口（相机下方 0.35 米）：不往脸上飞
      for (let i = 0; i < n; i++) {
        this.soul(pos.x + jitter(0.25), pos.y + jitter(0.25), pos.z + jitter(0.25), 3 + 0.6 * s, _c4, cam, -0.35, 0.24, 42, 0.55, 0.11 + 0.015 * s);
      }
    }
    if (grounded && s >= 1 && this.time - this.markAt > 0.15) {
      this.markAt = this.time;
      _t2.set(pos.x, groundY, pos.z);
      _n.set(0, 1, 0);
      this.ground.hole(_t2, _n, Math.min(3.2, s * 0.9), 0.35, 8);
    }
  }

  private soul(
    x: number, y: number, z: number, speed: number, color: THREE.Color, target: THREE.Vector3, offY: number,
    hang: number, pull: number, swirl: number, size: number, inward = false,
  ): void {
    for (const o of this.souls) {
      if (o.live) continue;
      o.live = true;
      o.x = x; o.y = y; o.z = z;
      if (inward) {
        // 收拢：先沿切向慢慢转
        const dx = x - target.x, dz = z - target.z, l = Math.hypot(dx, dz) || 1;
        const sp = rand(0.5, 1.5);
        o.vx = (-dz / l) * sp; o.vy = 0.3; o.vz = (dx / l) * sp;
      } else {
        randomDir(_dir);
        const sp = speed * rand(0.55, 1);
        o.vx = _dir.x * sp; o.vy = Math.abs(_dir.y) * sp * 0.8 + 0.6; o.vz = _dir.z * sp;
      }
      o.age = 0;
      o.life = inward ? 1.6 : 2.2;
      o.hang = hang * rand(0.7, 1.4);
      o.pull = pull * rand(0.8, 1.2);
      o.swirl = swirl * (inward || Math.random() < 0.5 ? 1 : -1) * rand(0.6, 1.2);
      o.size = size * rand(0.75, 1.15);
      o.r = color.r; o.g = color.g; o.b = color.b;
      o.target = target;
      o.offY = offY;
      this.soulsLive++;
      this.stats.souls++;
      return;
    }
  }

  private updateSouls(dt: number): void {
    if (this.soulsLive === 0) return;
    const slow = Math.exp(-0.9 * dt), slowHang = Math.exp(-4.5 * dt);
    let live = 0;
    for (const o of this.souls) {
      if (!o.live) continue;
      o.age += dt;
      const dx = o.target.x - o.x, dy = o.target.y + o.offY - o.y, dz = o.target.z - o.z;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (o.age >= o.life) {
        o.live = false;
        continue;
      }
      if (o.age < o.hang) {
        // 迸开的那一下：很快慢下来，悬一悬
        o.vx *= slowHang; o.vy = o.vy * slowHang + 1.2 * dt; o.vz *= slowHang;
      } else if (r < 0.45) {
        o.live = false;
        this.stats.arrived++;
        continue;
      } else {
        // 吸力随距离衰减；切向（绕竖直轴）只在头 0.45 秒有、之后收掉，横向速度持续被阻尼掉：
        // 先盘一小段弧，然后直奔目标（切向一直加的话会绕着目标转圈、永远到不了）
        const ux = dx / r, uy = dy / r, uz = dz / r;
        const sw = o.swirl * Math.max(0, 1 - (o.age - o.hang) / 0.45);
        const acc = (o.pull / (1 + r * 0.12)) * dt;
        o.vx = o.vx * slow + (ux + uz * sw) * acc;
        o.vy = o.vy * slow + uy * acc;
        o.vz = o.vz * slow + (uz - ux * sw) * acc;
        const along = o.vx * ux + o.vy * uy + o.vz * uz, keep = Math.exp(-5 * dt);
        o.vx = ux * along + (o.vx - ux * along) * keep;
        o.vy = uy * along + (o.vy - uy * along) * keep;
        o.vz = uz * along + (o.vz - uz * along) * keep;
      }
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      live++;
      // 每帧沿这一步走过的路留几小团很快暗下去的光：连起来是一道彗尾。飞得快时一步的距离比光团大，只留一团会断成一串圆点
      const k = o.age / o.life;
      _c4.setRGB(o.r, o.g, o.b).multiplyScalar(1 - k * k);
      const stepLen = Math.sqrt(o.vx * o.vx + o.vy * o.vy + o.vz * o.vz) * dt;
      const dots = Math.min(4, Math.max(1, Math.ceil(stepLen / (o.size * 0.6))));
      for (let j = 0; j < dots; j++) {
        const back = (j / dots) * dt;
        this.glow.spawn(STYLE_LINGER, o.x - o.vx * back, o.y - o.vy * back, o.z - o.vz * back, 0, 0, 0, _c4, o.size, 0.13);
      }
    }
    this.soulsLive = live;
  }

  private updateLaters(dt: number): void {
    for (const l of this.laters) {
      if (l.t < 0) continue;
      l.t -= dt;
      if (l.t > 0) continue;
      l.t = -1;
      const rs = Math.sqrt(l.s);
      _n.set(l.nx, l.ny, l.nz);
      switch (l.kind) {
        case LaterKind.Dust: {
          hexToColor(DUST, _c2);
          const sp = rand(0.4, 0.9);
          this.smoke.spawn(
            STYLE_DUST, l.x + l.nx * 0.06, l.y + l.ny * 0.06, l.z + l.nz * 0.06, l.nx * sp + jitter(0.2), l.ny * sp + 0.5, l.nz * sp + jitter(0.2),
            _c2, rand(0.32, 0.5) * rs, rand(0.9, 1.4),
          );
          break;
        }
        case LaterKind.Soot: {
          hexToColor(SOOT, _c2);
          this.smoke.spawn(
            STYLE_SMOKE, l.x + l.nx * 0.08, l.y + l.ny * 0.08, l.z + l.nz * 0.08, l.nx * 0.4 + jitter(0.2), l.ny * 0.4 + 0.6, l.nz * 0.4 + jitter(0.2),
            _c2, rand(0.3, 0.4) * rs, rand(0.8, 1.1),
          );
          break;
        }
        case LaterKind.Arc:
          this.arcs(l.x, l.y, l.z, _n, l.color, 2, 0.34 * rs);
          break;
        case LaterKind.Bubbles: {
          hexToColor(l.color, _c);
          for (let i = 0; i < 3; i++) {
            this.glow.spawn(STYLE_MOTE, l.x + jitter(0.15), l.y + jitter(0.08), l.z + jitter(0.15), jitter(0.2), rand(0.2, 0.6), jitter(0.2), _c, rand(0.05, 0.09), rand(0.5, 0.9));
          }
          break;
        }
        case LaterKind.Fume: {
          hexToColor(0x4a6a2a, _c2);
          this.smoke.spawn(STYLE_SMOKE, l.x + l.nx * 0.08, l.y + l.ny * 0.08, l.z + l.nz * 0.08, jitter(0.2), 0.5, jitter(0.2), _c2, rand(0.3, 0.45) * rs, rand(0.8, 1.2));
          break;
        }
        case LaterKind.DeathEcho: {
          hexToColor(l.color, _c);
          mixColor(_c, WHITE, 0.35, _hot);
          this.glow.spawn(STYLE_GLOW, l.x, l.y, l.z, 0, 0, 0, _hot, l.s * 0.8, 0.1);
          const glyphs = Math.min(6, Math.max(2, Math.round(1 + 1.2 * l.s)));
          for (let i = 0; i < glyphs; i++) {
            randomDir(_dir);
            const sp = rand(0.4, 1.2), off = l.s * 0.35 * Math.random();
            this.glow.spawn(
              STYLE_GLYPH, l.x + _dir.x * off, l.y + Math.abs(_dir.y) * off, l.z + _dir.z * off, _dir.x * sp, Math.abs(_dir.y) * sp + 0.8, _dir.z * sp,
              _hot, rand(0.2, 0.3) * rs, rand(0.8, 1.2),
            );
          }
          const embers = this.count(Math.min(12, 3 + 2 * l.s));
          for (let i = 0; i < embers; i++) {
            randomDir(_dir);
            const sp = rand(1, 2.5), off = l.s * 0.3 * Math.random();
            this.glow.spawn(
              STYLE_EMBER, l.x + _dir.x * off, l.y + Math.abs(_dir.y) * off, l.z + _dir.z * off, _dir.x * sp, Math.abs(_dir.y) * sp + 1, _dir.z * sp,
              _c, rand(0.06, 0.1), rand(0.9, 1.5),
            );
          }
          break;
        }
        case LaterKind.BlastSmoke: {
          // 爆炸的烟（l.s = 半径）：3 + r 团、最多 10 团，直径 0.2–0.32r（不超过 2.4 米）；
          // 挤在爆心 0.3r 以内，横向只有 0.15–0.4r m/s，主要往上冒，活 0.9–1.5 秒
          const r = l.s;
          hexToColor(SMOKE_DARK, _c3);
          hexToColor(l.color, _c);
          mixColor(_c3, _c, 0.18, _c3);
          const puffs = Math.min(10, Math.max(2, Math.round((3 + r) * this.density())));
          for (let i = 0; i < puffs; i++) {
            const a = Math.random() * Math.PI * 2, off = r * 0.3 * Math.sqrt(Math.random());
            const ca = Math.cos(a), sa = Math.sin(a), sp = r * rand(0.15, 0.4);
            const shade = rand(0.75, 1.2);
            _c2.setRGB(_c3.r * shade, _c3.g * shade, _c3.b * shade);
            this.smoke.spawn(
              STYLE_BLAST_SMOKE,
              l.x + ca * off, l.y + rand(0, 0.4) + r * 0.08, l.z + sa * off,
              ca * sp, rand(1.8, 3) + r * 0.12, sa * sp,
              _c2, Math.min(2.4, r * rand(0.2, 0.32)), rand(0.9, 1.5),
            );
          }
          break;
        }
        case LaterKind.DustRing: {
          // 砸地的第二响：沿半径一圈尘团（章节环境色）升起来，中间飘几枚符点；l.s = 半径
          hexToColor(DUST, _c2);
          const puffs = this.count(Math.min(7, 3 + l.s * 0.7));
          const a0 = Math.random() * Math.PI * 2;
          for (let i = 0; i < puffs; i++) {
            const a = a0 + (i / puffs) * Math.PI * 2 + jitter(0.3), rr = l.s * rand(0.45, 0.7), sp = rand(0.8, 1.8);
            const shade = rand(0.85, 1.15);
            _c3.setRGB(_c2.r * shade, _c2.g * shade, _c2.b * shade);
            this.smoke.spawn(STYLE_DUST, l.x + Math.cos(a) * rr, l.y + 0.15, l.z + Math.sin(a) * rr, Math.cos(a) * sp, rand(0.6, 1.3), Math.sin(a) * sp, _c3, rand(0.5, 0.8), rand(0.9, 1.4));
          }
          hexToColor(l.color, _c);
          mixColor(_c, WHITE, 0.35, _hot);
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2, off = l.s * rand(0.1, 0.35);
            this.glow.spawn(STYLE_GLYPH, l.x + Math.cos(a) * off, l.y + rand(0.2, 0.6), l.z + Math.sin(a) * off, Math.cos(a) * 0.8, rand(0.8, 1.6), Math.sin(a) * 0.8, _hot, rand(0.24, 0.32), rand(0.9, 1.3));
          }
          break;
        }
        case LaterKind.SkillEcho: {
          // 技能落点的第二响：金色符点散开往上飘 + 晚出的烟
          hexToColor(0xffd27a, _hot);
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2, off = rand(0.4, 1.2) * rs, sp = rand(1, 2.5);
            this.glow.spawn(
              STYLE_GLYPH, l.x + Math.cos(a) * off, l.y + rand(0.1, 0.5), l.z + Math.sin(a) * off, Math.cos(a) * sp, rand(0.7, 1.7), Math.sin(a) * sp,
              _hot, rand(0.24, 0.34), rand(0.9, 1.3),
            );
          }
          hexToColor(SOOT, _c2);
          // 烟只补 1–2 小团：爆炸本体已经有烟，再多就把落点附近的敌人盖住了
          const puffs = Math.min(2, this.count(1 + l.s));
          for (let i = 0; i < puffs; i++) {
            this.smoke.spawn(STYLE_SMOKE, l.x + jitter(0.5 * rs), l.y + rand(0.1, 0.4), l.z + jitter(0.5 * rs), jitter(0.5), rand(0.8, 1.4), jitter(0.5), _c2, rand(0.5, 0.75) * rs, rand(1, 1.5));
          }
          break;
        }
      }
    }
  }

  // ───────────── 技能用的分层入口（IFxExtras，见 ./extras.ts） ─────────────

  /** 画一枚法印（见 Seal.ts）：center 贴地时传地面点，normal 为空 = 朝上 */
  seal(center: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, color: number, opts?: SealOptions): SealHandle {
    return this.seals.spawn(center, normal, radius, color, opts);
  }

  /** 蓄力：center 周围 radius 的一圈光点盘旋着向 target（+ offY）收拢 */
  gather(center: THREE.Vector3, color: number, count: number, radius: number, target: THREE.Vector3, offY = 1): void {
    if (!finite3(center) || !(radius > 0)) return;
    hexToColor(color, _c4);
    const n = this.count(count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * rand(0.6, 1);
      this.soul(center.x + Math.cos(a) * r, center.y + rand(0.1, 1.1), center.z + Math.sin(a) * r, 0, _c4, target, offY, 0.14, 30, 0.9, 0.09, true);
    }
  }

  /** 出手：沿 dir 的一束拉丝火星 + 一闪 */
  castSparks(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    if (!finite3(pos) || !finite3(dir)) return;
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.4, _hot);
    this.glow.spawn(STYLE_GLOW, pos.x, pos.y, pos.z, 0, 0, 0, _hot, 0.35, 0.08);
    _t1.copy(dir).normalize();
    for (let i = 0; i < 5; i++) {
      randomDir(_dir).multiplyScalar(0.45).add(_t1).normalize();
      const sp = rand(5, 10);
      this.sparks.spawn(pos.x, pos.y, pos.z, _dir.x * sp, _dir.y * sp, _dir.z * sp, i & 1 ? _c : _hot, rand(0.15, 0.3), 0.018, 5);
    }
  }

  /** 飞行物身后落下的一条火舌（每隔一小段距离调一次）：带走飞行速度的 12% 再往上窜；偶尔甩一颗火星 */
  flameShed(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.32): void {
    if (!finite3(pos) || !finite3(vel)) return;
    hexToColor(color, _c);
    this.glow.spawn(
      STYLE_FLAME, pos.x + jitter(0.06), pos.y + jitter(0.06), pos.z + jitter(0.06), vel.x * 0.12 + jitter(0.6), vel.y * 0.12 + 0.8, vel.z * 0.12 + jitter(0.6),
      _c, size * rand(0.8, 1.25), rand(0.22, 0.38),
    );
    if (Math.random() < 0.3) {
      mixColor(_c, WHITE, 0.3, _hot);
      this.glow.spawn(STYLE_EMBER, pos.x, pos.y, pos.z, vel.x * 0.25 + jitter(3), vel.y * 0.25 + jitter(3), vel.z * 0.25 + jitter(3), _hot, rand(0.05, 0.09), rand(0.5, 1));
    }
  }

  /**
   * 砸地（土系技能落点，radius = 波及半径）：碎石往外往上崩、落地还会滚；0.07 秒后沿半径一圈尘团升起来，中间飘几枚符点。
   * 冲击环、裂纹、震屏由调用方原有的 shockwave 出，这里只补它没有的层。
   */
  earthBurst(center: THREE.Vector3, color: number, radius: number): void {
    if (!finite3(center) || !(radius > 0)) return;
    const r = Math.min(12, radius), rs = Math.sqrt(r / 4);
    hexToColor(CHUNK_DARK, _c3);
    hexToColor(color, _c);
    const chunks = this.count(Math.min(20, 6 + 2 * r));
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2, off = r * rand(0.1, 0.45), sp = rand(3, 8) * rs;
      const shade = rand(0.7, 1.3);
      _c2.setRGB(_c3.r * shade, _c3.g * shade, _c3.b * shade);
      this.smoke.spawn(STYLE_CHUNK, center.x + Math.cos(a) * off, center.y + 0.1, center.z + Math.sin(a) * off, Math.cos(a) * sp, rand(4, 9) * rs, Math.sin(a) * sp, _c2, rand(0.09, 0.2), rand(0.9, 1.5));
    }
    // 贴地往外窜的拉丝火星（技能色）：读出「力是从中心往外的」
    const streaks = this.count(Math.min(14, 4 + 1.5 * r));
    for (let i = 0; i < streaks; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(8, 15) * rs;
      this.sparks.spawn(center.x, center.y + 0.15, center.z, Math.cos(a) * sp, rand(0.5, 2.5), Math.sin(a) * sp, _c, rand(0.18, 0.35), 0.022, 9);
    }
    this.later(LaterKind.DustRing, 0.07, center.x, center.y, center.z, null, color, r);
    this.afterLight(center.x, center.y + 0.6, center.z, color, 7, 4 + r * 0.6, 0.14);
  }

  /**
   * 落雷点 / 雷系出手（scale ≈ 1）：电弧贴着地面往外爬两拍，光屑迸开，一盏短灯；可选一枚雷色符点往上飘。
   * 主闪电由调用方的 lightning 出。
   */
  arcBurst(center: THREE.Vector3, color: number, scale = 1): void {
    if (!finite3(center)) return;
    const k = Math.min(3, Math.max(0.3, posOr(scale, 1))), rs = Math.sqrt(k);
    _n.set(0, 1, 0);
    this.arcs(center.x, center.y, center.z, _n, color, 4, 0.5 * rs);
    this.later(LaterKind.Arc, 0.08, center.x, center.y, center.z, _n, color, k * 2.2);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.5, _hot);
    const glints = this.count(8);
    for (let i = 0; i < glints; i++) {
      randomDir(_dir);
      const sp = rand(2, 6) * rs;
      this.glow.spawn(STYLE_GLINT, center.x, center.y + 0.1, center.z, _dir.x * sp, Math.abs(_dir.y) * sp + 0.5, _dir.z * sp, _hot, rand(0.08, 0.13), rand(0.2, 0.4));
    }
    for (let i = 0; i < 2; i++) {
      this.glow.spawn(STYLE_GLYPH, center.x + jitter(0.4 * rs), center.y + rand(0.2, 0.5), center.z + jitter(0.4 * rs), jitter(0.5), rand(0.8, 1.5), jitter(0.5), _hot, rand(0.22, 0.3), rand(0.7, 1.1));
    }
    this.afterLight(center.x, center.y + 0.5, center.z, color, 8, 4.5, 0.12);
  }

  /** 火系命中（火灵）：一闪 → 火舌窜起 + 火星 → 余烬；带一盏短灯 */
  flameHit(pos: THREE.Vector3, color: number, scale = 1): void {
    if (!finite3(pos)) return;
    const k = Math.min(3, Math.max(0.3, posOr(scale, 1))), rs = Math.sqrt(k);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.45, _hot);
    this.glow.spawn(STYLE_GLOW, pos.x, pos.y, pos.z, 0, 0, 0, _hot, 0.7 * k, 0.09);
    for (let i = 0; i < 3; i++) {
      // 火舌不大于 0.45 米：命中点就在敌人身上，九团火灵连中时再大会把上半身盖住一瞬
      this.glow.spawn(STYLE_FLAME, pos.x + jitter(0.15), pos.y + jitter(0.1), pos.z + jitter(0.15), jitter(0.8), rand(1, 2.2), jitter(0.8), _c, rand(0.3, 0.45) * rs, rand(0.3, 0.5));
    }
    const sparks = this.count(6);
    for (let i = 0; i < sparks; i++) {
      randomDir(_dir);
      const sp = rand(6, 12);
      this.sparks.spawn(pos.x, pos.y, pos.z, _dir.x * sp, _dir.y * sp, _dir.z * sp, i & 1 ? _c : _hot, rand(0.12, 0.25), 0.018, 10);
    }
    const embers = this.count(6);
    for (let i = 0; i < embers; i++) {
      randomDir(_dir);
      const sp = rand(2, 5);
      this.glow.spawn(STYLE_EMBER, pos.x, pos.y, pos.z, _dir.x * sp, Math.abs(_dir.y) * sp + 0.5, _dir.z * sp, _c, rand(0.06, 0.1), rand(0.6, 1.1));
    }
    this.afterLight(pos.x, pos.y, pos.z, color, 8, 4, 0.14);
  }

  /**
   * 火系技能落点（燃爆雷，scale = 半径 / 4.5）：甩出去的火舌、落地还会蹦的炭火；0.08 秒后第二响（金色符点 + 烟）。
   * 爆炸本体（火球、闪光、震屏）由 explosion 出，这里只补它没有的层。
   */
  flameBurst(pos: THREE.Vector3, color: number, scale = 1): void {
    if (!finite3(pos)) return;
    const k = Math.min(3, Math.max(0.3, posOr(scale, 1))), rs = Math.sqrt(k);
    hexToColor(color, _c);
    mixColor(_c, WHITE, 0.35, _hot);
    // 甩得远的几条火舌（爆炸本体已经有贴着爆心的火舌，这里只补往外甩出去的，少而短）
    const flames = this.count(Math.min(10, 2 + 3 * k));
    for (let i = 0; i < flames; i++) {
      randomDir(_dir);
      if (_dir.y < -0.2) _dir.y = -_dir.y * 0.5;
      const sp = rand(3.5, 7) * rs, off = 0.5 * k * Math.random();
      this.glow.spawn(STYLE_FLAME, pos.x + _dir.x * off, pos.y + _dir.y * off, pos.z + _dir.z * off, _dir.x * sp, _dir.y * sp + 1.2, _dir.z * sp, _c, rand(0.4, 0.65) * rs, rand(0.3, 0.5));
    }
    const cinders = this.count(Math.min(22, 6 + 8 * k));
    for (let i = 0; i < cinders; i++) {
      randomDir(_dir);
      if (_dir.y < -0.2) _dir.y = -_dir.y * 0.5;
      const sp = rand(5, 12) * rs;
      this.glow.spawn(STYLE_SKITTER, pos.x, pos.y, pos.z, _dir.x * sp, _dir.y * sp + 3, _dir.z * sp, i % 3 === 0 ? _hot : _c, rand(0.08, 0.13), rand(0.9, 1.6));
    }
    this.later(LaterKind.SkillEcho, 0.08, pos.x, pos.y, pos.z, null, color, k);
  }

  // ───────────── 玩家移动 / 武器（M8：Unity MovementFx、FlameCone） ─────────────

  /** 一道拉长的光痕（冲刺风痕、二段跳火星）：沿速度拉长，不受重力 */
  streak(pos: THREE.Vector3, vel: THREE.Vector3, color: number, life: number, width = 0.04): void {
    if (!finite3(pos) || !finite3(vel)) return;
    hexToColor(color, _c);
    this.sparks.spawn(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, _c, life, width, 0);
  }

  /** 一团扬尘（冲刺 / 落地）：慢慢长大、淡出 */
  dust(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, life: number): void {
    if (!finite3(pos) || !finite3(vel)) return;
    hexToColor(color, _c);
    this.smoke.spawn(STYLE_DUST, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, _c, size, life);
  }

  /** 喷火器的一颗火舌（Unity FlameCone 的 Flames 发射器：加法、往上浮、阻尼、长到 5.5 倍）；smoke = 烟（透明、慢慢升） */
  flameJet(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, life: number, smoke = false): void {
    if (!finite3(pos) || !finite3(vel)) return;
    if (smoke) {
      hexToColor(color, _c);
      this.smoke.spawn(STYLE_JET_SMOKE, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, _c, size, life);
      return;
    }
    hexToColor(color, _c);
    this.glow.spawn(STYLE_JET, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, _c, size, life);
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
    ctx.renderer.getDrawingBufferSize(_buf);
    particleScaleUniform.value = _buf.y / (2 * Math.tan((cam.fov * Math.PI) / 360));

    const floorY = this.floorY();
    this.glow.update(d, floorY);
    this.smoke.update(d, floorY);
    this.sparks.update(d, floorY);
    if (d > 0) {
      this.updateEmitters(d);
      this.updateLaters(d);
      this.updateSouls(d);
    }
    this.afterN = this.wakeN = this.throughN = this.deathN = 0;

    // 线状特效先占批次容量，火花拖尾在后（容量不足时先丢火花）
    this.ribbons.begin(_camPos, this.time);
    this.trails.update(d, this.ribbons);
    this.sparks.render(this.ribbons);
    this.ribbons.end();

    this.ground.update(d);
    this.flashes.update(d);
    this.seals.update(d);
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
    this.seals.clear();
    for (const e of this.emitters) e.active = false;
    for (const l of this.laters) l.t = -1;
    for (const o of this.souls) o.live = false;
    this.soulsLive = 0;
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
