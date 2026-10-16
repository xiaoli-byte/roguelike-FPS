/**
 * 变脸傩巫（nuo，第三章 · 祝融火狱 · 火坛的辅助）：祭火的傩巫，戴着整张脸大的木雕傩面（面具就是头部模型的一部分），
 * 跳火傩给同伴加成，川剧变脸一样隔一阵换一张脸。设计见 docs/art/enemy-roster-v2.md「变脸傩巫 · 三面」。
 *
 * - 跳傩：离玩家 12–20 米、躲在同伴身后踩着鼓点跳傩舞（每拍一跺脚、腰铃 / 脚铃响），16 米内的同伴脚下一圈和面具同色的光环
 *   （SupportBuffs 光环登记：多只傩巫同脸不叠加，按乘法撤下）：
 *   - 赤面（怒）：同伴伤害 ×1.35、攻速 ×1.25，红光环；
 *   - 黑面（刚）：同伴受到的伤害 ×0.6，黑光环；
 *   - 金面（疾）：同伴移速 ×1.3、每秒回 2% 最大生命，金光环。
 * - 变脸（约每 8 秒）：大袖往脸上一抹（0.5 秒，这一下脸被袖子挡住，打不到面具），一团火光盖住换脸，换成下一张脸。
 *   换脸靠本体材质里按面具区域换配色（applyNuoMask），眼睛的自发光颜色随脸变。
 * - 碎面：当前这张脸累计吃到最大生命 25% 的伤害（只算从正面打中面具；换脸时清零）就裂开：这张脸的加成立刻撤掉、
 *   以后不再换回这张脸（挑最要命的那张打碎），她捂脸踉跄 2 秒，6 秒内不能再变脸；面具上多一圈发红的裂纹。三张都碎了就只剩吐火。
 * - 吐火（玩家进 7 米）：后仰蓄火 0.55 秒（面前半圆预警），面具嘴里喷出一道 6 米火柱，1 秒内从一侧扫到另一侧（扫半圈）；
 *   火柱被墙挡住就到墙为止。
 * - 弱点：面具（头部判定挂在 mask 骨上），只能从正面打——从背后打到头算身体。
 *
 * 动作：踩鼓点的傩舞（交替跺脚、胯随拍顿、双臂交替扬起）；大袖、背后长飘带、两侧飘带、羽冠是弹簧骨骼，跟着舞步甩；
 * 变脸时右手大袖从脸前抹过；碎面时双手捂脸、膝盖发软；吐火时先后仰再探头，头随火柱扫过去。
 *
 * 状态机：enter → dance → wipe → dance；spitWindup → spit → dance；碎面时 cover → dance
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { BuffRegistry, type Buffable, type BuffMods } from '../SupportBuffs';
import { BeamMesh, GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { Sway } from '../fx/FrostSupportFx';
import { FLAME_FX_TIME, createFlameTongue, type FlameTongue } from '../fx/FlameFx';
import { INFERNO_SUPPORT as C, applyNuoMask, spawnFirePool, type NuoMaskHandle } from '../fx/InfernoSupportFx';

export const NUO_DEF: ScaledEnemyDef = {
  id: 'nuo',
  name: '变脸傩巫',
  hp: 130,
  speed: 4,
  radius: 0.32,
  height: 1.75,
  // 吐火：每秒 2.5 倍
  damage: 9,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 傩面（美术 1.34 米处）
  headY: 1.36,
  headRadius: 0.15,
  knockbackResist: 0.25,
  color: C.red,
  // 美术按 1.8 米制作（含羽冠），游戏里放大约 1.2 倍
  scale: 1.2,
};

/** 三张脸：光环倍率、光环颜色、换脸着色（null = 原贴图）、眼睛自发光颜色 */
export interface NuoFace {
  readonly id: 'red' | 'black' | 'gold';
  readonly name: string;
  readonly aura: BuffMods;
  /** 每秒回复同伴最大生命的比例 */
  readonly regen: number;
  readonly ring: number;
  readonly paint: [number, number, number] | null;
  readonly trim: [number, number, number] | null;
  readonly eye: number;
}
export const FACES: readonly NuoFace[] = [
  { id: 'red', name: '赤面', aura: { damage: 1.35, rate: 1.25, speed: 1, taken: 1 }, regen: 0, ring: 0xff3a1a, paint: null, trim: null, eye: 0xffa040 },
  { id: 'black', name: '黑面', aura: { damage: 1, rate: 1, speed: 1, taken: 0.6 }, regen: 0, ring: 0x140a10, paint: [0.03, 0.025, 0.035], trim: [0.85, 0.6, 0.18], eye: 0xc080ff },
  { id: 'gold', name: '金面', aura: { damage: 1, rate: 1, speed: 1.3, taken: 1 }, regen: 0.02, ring: 0xffc840, paint: [1.0, 0.6, 0.1], trim: [1.0, 0.92, 0.7], eye: 0xfff2a0 },
];

/** 跳傩 */
export const DANCE = { aura: 16, keep: [12, 20] as const, beat: 0.75, behind: 3 } as const;
/** 变脸 */
export const FACE_CHANGE = { every: [7.5, 8.5] as const, wipe: 0.5 } as const;
/** 碎面：当前这张脸累计承受的伤害（相对最大生命）；踉跄与禁变脸时长 */
export const MASK_BREAK = { frac: 0.25, cover: 2, lock: 6 } as const;
/** 吐火 */
export const SPIT = { trigger: 7, range: 6, windup: 0.55, sweep: 1.0, halfArc: Math.PI / 2, width: 0.3, tick: 0.1, dps: 2.5, cooldown: 5 } as const;
/** 火柱扫过的地面留下小片余火（登记成地火，祸斗会来吃） */
const SPIT_EMBER = { every: 0.3, radius: 0.7, life: 2.5, dmg: 0.2 } as const;
const ENTER_TIME = 0.8;

/** 模型空间（未缩放，three 坐标：X = 生物左，Y = 上，Z = 前）：面具中心、嘴 */
const MASK_C = new THREE.Vector3(0, 1.34, 0.17);
const MOUTH = new THREE.Vector3(0, 1.27, 0.21);

const COL = { robe: 0xa8281c, robeDark: 0x2a1c20, skin: 0xb07a58, mask: 0xc0301e, feather: 0x5a2418, bell: 0xb08a48 };

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Side = 'L' | 'R';
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3(), _h4 = new THREE.Vector3();
const _scratch: IEnemy[] = [];
const _allies: IEnemy[] = [];
const _live = new Set<IEnemy>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** 临界阻尼弹簧：姿态权重的缓入缓出 */
class Ease {
  x = 0;
  private v = 0;
  constructor(private readonly w: number) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30), w = this.w;
    this.v += (w * w * (target - this.x) - 2 * w * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

// ───────────── 光环登记（每张脸一档；多只傩巫同脸不叠加） ─────────────

type BuffAlly = IEnemy & Buffable;
const NO_MODS = { damage: 1, rate: 1, speed: 1, taken: 1 };
export const faceAura = FACES.map((f) => new BuffRegistry<BuffAlly, Nuo>(f.aura, NO_MODS));
const takenInstalled = new WeakSet<object>();
/** 同一只同伴一帧只回一次血（几只金面傩巫不叠加） */
const regenFrame = new WeakMap<IEnemy, number>();
/** 同伴脚下的光环贴花：每张脸一套（黑面是实色暗环 + 一圈紫边） */
const ringFx = FACES.map(() => new Map<IEnemy, GroundDecal[]>());

function installTakenModifier(ctx: GameContext): void {
  if (takenInstalled.has(ctx)) return;
  takenInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy) => faceAura.reduce((m, r) => m * r.taken(enemy as BuffAlly), 1));
}

// ───────────── 傩巫 ─────────────

interface HandState {
  side: Side;
  axes: THREE.Vector3[];
  curl: number[];
}

export class Nuo extends StandardEnemy {
  /** 当前戴的脸（FACES 下标） */
  face = 0;
  /** 打碎过的脸 */
  readonly broken = [false, false, false];
  /** 正在加成的同伴 */
  readonly auraTargets = new Set<IEnemy>();
  /** 换脸着色（美术身体就绪后才有） */
  mask: NuoMaskHandle | null = null;
  private faceTimer: number;
  private lockUntil = -9;
  private maskDamage = 0;
  private spitCd: number;
  private windTime = 1;
  private beatIndex = -1;
  private swapped = false;
  private hitAt = -9;
  private swapAt = -9;
  private spitYaw = 0;
  private spitSign = 1;
  private spitTick = 0;
  private emberTimer = 0;
  private spitDecal: GroundDecal | null = null;
  private jet: BeamMesh | null = null;
  private tongues: FlameTongue[] = [];
  private readonly mouthLocal = new THREE.Vector3();

  /** 白模部件 */
  private body!: THREE.Group;
  private classicHead!: THREE.Group;
  private classicMask!: THREE.Mesh;
  private classicArms: THREE.Group[] = [];
  private eyes: THREE.Mesh[] = [];

  private readonly hands: HandState[] = [];
  private readonly eWipe = new Ease(12);
  private readonly eCover = new Ease(10);
  private readonly eSpit = new Ease(9);
  private readonly eDance = new Ease(5);
  private readonly lean = new Sway(14, 5);
  private readonly robe = new Sway(18, 3.5);
  private readonly crown = new Sway(26, 3);
  private readonly ribbon = new Sway(10, 2.2);
  private readonly prevVel = new THREE.Vector3();
  private headYaw = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, NUO_DEF, opts);
    this.faceTimer = ctx.rng.range(FACE_CHANGE.every[0], FACE_CHANGE.every[1]);
    this.spitCd = ctx.rng.range(1, 2);
    this.deathDuration = 1.2;
    this.setState('enter');
    installTakenModifier(ctx);
  }

  /** BuffSource：当前这张脸碎了（或三张都碎了）就不再给加成 */
  get silenced(): boolean {
    return this.broken[this.face];
  }

  /** 当前的脸 */
  get currentFace(): NuoFace {
    return FACES[this.face];
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const robe = flat(COL.robe), dark = flat(COL.robeDark), skin = flat(COL.skin), feather = flat(COL.feather), bell = flat(COL.bell, { metal: 0.6 });
    // 白模：深色裤、红黑祭袍、大袖、羽冠、傩面（面具单独一块，按脸换颜色）
    const body = joint(root, 0, 0, 0);
    this.body = body;
    for (const s of [1, -1]) {
      part(body, Geo.cyl(0.08, 0.12, 0.6, 6, 'bottom'), dark, s * 0.13, 0.05, 0);
      part(body, Geo.box(0.12, 0.06, 0.22), skin, s * 0.15, 0.03, 0.06);
    }
    part(body, Geo.cone(0.38, 0.75, 8, 'bottom'), robe, 0, 0.2, 0);
    part(body, Geo.box(0.36, 0.42, 0.22), robe, 0, 1.0, 0.02);
    part(body, Geo.torus(0.2, 0.04, 6, 12), dark, 0, 0.84, 0.02).rotation.x = Math.PI / 2;
    for (const s of [1, -1]) part(body, Geo.ico(0.05, 0), bell, s * 0.12, 0.8, 0.2);
    const head = joint(body, 0, 1.23, 0.03);
    this.classicHead = head;
    part(head, Geo.ico(0.13, 1), dark, 0, 0.12, -0.02);
    this.classicMask = part(head, Geo.box(0.22, 0.26, 0.08), flat(COL.mask, { rough: 0.6 }), 0, 0.11, 0.13);
    for (const s of [1, -1]) {
      this.eyes.push(this.glowPart(head, Geo.ico(0.025, 0), 0x402010, FACES[0].eye, s * 0.05, 0.14, 0.18, 0));
      for (let i = 0; i < 3; i++) {
        const f = part(head, Geo.cone(0.03, 0.32, 4, 'bottom'), feather, s * (0.03 + i * 0.05), 0.3, -0.02);
        f.rotation.z = -s * (0.2 + i * 0.3);
      }
    }
    for (const s of [1, -1]) {
      const arm = joint(body, s * 0.18, 1.14, 0.02);
      arm.rotation.z = s * 0.6;
      part(arm, Geo.box(0.3, 0.12, 0.12), robe, s * 0.14, 0, 0);
      part(arm, Geo.box(0.3, 0.36, 0.06), robe, s * 0.17, -0.2, -0.02);
      part(arm, Geo.box(0.12, 0.05, 0.07), skin, s * 0.34, 0, 0.02);
      this.classicArms.push(arm);
    }
    this.setHeadAnchor(this.classicMask, 0, 0, 0.02);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (n) {
      this.body.visible = false;
      for (const e of this.eyes) e.visible = false;
      const P = n.pose;
      const mb = P.bone('mask');
      if (mb) this.setHeadAnchor(mb, 0, 0, 0);
      this.root.updateMatrixWorld(true);
      const host = this.model.children[0];
      const mouth = P.bone('mouth') ?? P.bone('head');
      if (mouth) mouth.worldToLocal(host.localToWorld(this.mouthLocal.copy(MOUTH)));
      this.initHands(P);
      this.initMask(n);
    }
    this.applyFace(true);
  }

  /** 本体材质叠换脸着色：LOD 网格按各自骨架里 mask 骨的下标算面具权重 */
  private initMask(n: NativeBody): void {
    const mat = n.materials[0] as THREE.MeshStandardMaterial | undefined;
    if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    const parts: { geometry: THREE.BufferGeometry; joint: number }[] = [];
    for (const lvl of n.lod.levels) {
      lvl.object.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || m.material !== mat) return;
        parts.push({ geometry: m.geometry, joint: m.skeleton.bones.findIndex((b) => b.name === 'mask') });
      });
    }
    if (parts.length) this.mask = applyNuoMask(mat, parts);
  }

  private initHands(P: NativePose): void {
    for (const side of ['L', 'R'] as const) {
      const m = side === 'L' ? 1 : -1;
      const palm = _w.set(-m, 0, 0);
      const axes: THREE.Vector3[] = [];
      for (const f of FINGERS) {
        const a = P.restPosition(`${f}_1_${side}`), b = P.restPosition(`${f}_2_${side}`);
        const ax = new THREE.Vector3(0, 0, m);
        if (a && b) {
          ax.crossVectors(_v.subVectors(b, a).normalize(), palm);
          if (ax.lengthSq() < 1e-6) ax.set(0, 0, m);
          ax.normalize();
        }
        axes.push(ax);
      }
      this.hands.push({ side, axes, curl: [0.2, 0.2, 0.2, 0.2, 0.2] });
    }
  }

  /** 把当前的脸画到面具上（着色器 / 白模面具颜色、眼睛颜色） */
  private applyFace(instant = false): void {
    const f = this.currentFace;
    if (this.mask) {
      if (f.paint && f.trim) {
        this.mask.paint.value.setRGB(...f.paint);
        this.mask.trim.value.setRGB(...f.trim);
        this.mask.swap.value = 1;
      } else this.mask.swap.value = 0;
      this.mask.eye.value.setHex(f.eye);
      this.mask.crack.value = this.broken.filter(Boolean).length;
    }
    const mm = this.classicMask.material as THREE.MeshStandardMaterial;
    if (mm && mm.color) mm.color.setHex(f.id === 'red' ? COL.mask : f.id === 'black' ? 0x181014 : 0xd8a030);
    void instant;
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    this.glowTarget[1] = 0;
    this.spitDecal?.release();
    this.spitDecal = null;
    this.jet?.release();
    this.jet = null;
    if (this.state === 'spitWindup' || this.state === 'spit') this.setState('dance');
  }

  protected override onDispose(): void {
    super.onDispose();
    this.dropAllAuras();
    this.clearTongues();
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const rate = this.attackRate;
    this.spitCd -= dt * rate;
    const now = this.ctx.time.now;
    if (now >= this.lockUntil && !this.allBroken) this.faceTimer -= dt;
    switch (this.state) {
      case 'enter': {
        this.stopMoving();
        this.facePlayer(2, dt);
        if (this.stateTime >= ENTER_TIME) this.setState('dance');
        break;
      }
      case 'dance': {
        this.glowTarget[0] = 0.3 + 0.2 * Math.max(0, Math.sin(this.age * Math.PI * 2 / DANCE.beat));
        if (this.spitCd <= 0 && this.distToPlayerXZ() < SPIT.trigger && this.verticalReach(2)
          && this.requestAttack('melee', SPIT.windup + SPIT.sweep + 0.4)) {
          this.beginSpit();
          break;
        }
        if (this.faceTimer <= 0 && !this.allBroken && now >= this.lockUntil) {
          this.windTime = FACE_CHANGE.wipe;
          this.swapped = false;
          this.setState('wipe');
          this.ctx.audio.play('skill_fire', { position: this.position, volume: 0.45, pitch: 1.4 });
          break;
        }
        this.positionBehindAllies();
        this.facePlayer(3, dt);
        this.beat();
        break;
      }
      case 'wipe': {
        this.stopMoving();
        this.facePlayer(3, dt);
        if (!this.swapped && this.stateTime >= FACE_CHANGE.wipe * 0.5) this.swapFace();
        if (this.stateTime >= FACE_CHANGE.wipe) {
          this.faceTimer = this.ctx.rng.range(FACE_CHANGE.every[0], FACE_CHANGE.every[1]);
          this.setState('dance');
        }
        break;
      }
      case 'cover': {
        this.stopMoving();
        if (this.stateTime >= MASK_BREAK.cover) this.setState('dance');
        break;
      }
      case 'spitWindup': {
        this.stopMoving();
        const k = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * k;
        this.glowTarget[1] = k;
        if (this.spitDecal) {
          this.spitDecal.circle(this.position.x, this.position.y, this.position.z, SPIT.range, 0.6, this.spitYaw, SPIT.halfArc);
          this.spitDecal.fill = k;
          this.spitDecal.time = this.age;
        }
        if (this.stateTime >= this.windTime) {
          this.spitDecal?.release();
          this.spitDecal = null;
          this.jet = BeamMesh.acquire(this.ctx.stageGroup, C.ember, C.moltenHot);
          this.spitTick = 0;
          this.emberTimer = SPIT_EMBER.every * 0.5;
          this.setState('spit');
          this.ctx.audio.play('skill_fire', { position: this.mouthWorld(_p), volume: 0.9, pitch: 0.8 });
        }
        break;
      }
      case 'spit': {
        this.stopMoving();
        this.glowTarget[1] = 1;
        this.updateJet(dt);
        if (this.stateTime >= SPIT.sweep) {
          this.jet?.release();
          this.jet = null;
          this.glowTarget[1] = 0;
          this.releaseAttack();
          this.spitCd = SPIT.cooldown;
          this.setState('dance');
        }
        break;
      }
      default:
        this.setState('dance');
    }
    this.updateAura(dt);
  }

  get allBroken(): boolean {
    return this.broken.every(Boolean);
  }

  /** 傩舞的鼓点：每拍一跺脚（脚下一圈小光环），隔拍腰铃响 */
  private beat(): void {
    const i = Math.floor(this.age / DANCE.beat);
    if (i === this.beatIndex) return;
    this.beatIndex = i;
    const ctx = this.ctx;
    const side = i % 2 === 0 ? 1 : -1;
    this.localPoint(side * 0.15, 0.05, 0.05, _p);
    if (!this.silenced) ctx.fx.ring(_p, 0.9, this.currentFace.id === 'black' ? 0x7040c0 : this.currentFace.ring, 0.3);
    ctx.audio.play(i % 2 === 0 ? 'pickup_coin' : 'footstep', { position: this.position, volume: 0.22, pitch: i % 2 === 0 ? 0.55 : 0.8 });
  }

  /** 躲在同伴身后：同伴质心再往远离玩家的方向退几米，离玩家至少 12 米；没有同伴就和玩家保持 12–20 米 */
  private positionBehindAllies(): void {
    const pl = this.ctx.player.position;
    const allies = this.alliesWithin(22);
    if (allies.length === 0) {
      this.keepRange(DANCE.keep[0], DANCE.keep[1], this.speed);
      return;
    }
    _q.set(0, 0, 0);
    for (const e of allies) _q.add(e.position);
    _q.multiplyScalar(1 / allies.length);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    const d = _v.length() || 1;
    _q.addScaledVector(_v, DANCE.behind / d);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    if (_v.length() < DANCE.keep[0]) _q.set(pl.x, _q.y, pl.z).addScaledVector(_v.normalize(), DANCE.keep[0]);
    if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) > 1.8) this.navigate(_q, this.speed, 1.2);
    else this.stopMoving();
  }

  private alliesWithin(range: number): IEnemy[] {
    _allies.length = 0;
    const list = this.ctx.enemies.queryRadius(this.position, range, _scratch);
    for (const e of list) if (e !== this && e.alive && !e.removed && !e.isBoss) _allies.push(e);
    _scratch.length = 0;
    return _allies;
  }

  // ───────────── 光环 ─────────────

  /** 每帧：范围内的同伴加上当前这张脸的光环、离开的撤下；金面回血；光环贴花跟着同伴走 */
  private updateAura(dt: number): void {
    const ctx = this.ctx, now = ctx.time.now;
    const reg = faceAura[this.face];
    _live.clear();
    if (this.alive && !this.silenced && this.stunTime <= 0) {
      for (const e of this.alliesWithin(DANCE.aura)) {
        if (Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z) <= DANCE.aura + e.radius) _live.add(e);
      }
    }
    for (const e of this.auraTargets) if (!_live.has(e)) reg.removeAura(e as BuffAlly, this, now);
    this.auraTargets.clear();
    const f = this.currentFace, fi = this.face;
    for (const e of _live) {
      this.auraTargets.add(e);
      const b = reg.addAura(e as BuffAlly, this, now);
      let rings = ringFx[fi].get(e);
      if (!rings) {
        rings = [GroundDecal.acquire(ctx.stageGroup, f.ring)];
        if (f.id === 'black') {
          rings[0].solid = true;
          rings.push(GroundDecal.acquire(ctx.stageGroup, 0x7040c0));
        }
        ringFx[fi].set(e, rings);
        const map = ringFx[fi];
        b.fx.onClear = () => {
          for (const r of map.get(e) ?? []) {
            r.solid = false;
            r.release();
          }
          map.delete(e);
        };
      }
      const r = Math.max(0.8, e.radius * 2.2);
      rings[0].circle(e.position.x, e.position.y, e.position.z, r, r - 0.3);
      rings[0].time = this.age;
      if (rings[1]) rings[1].circle(e.position.x, e.position.y + 0.01, e.position.z, r + 0.08, r - 0.04);
      if (f.regen > 0 && regenFrame.get(e) !== ctx.time.frame && e.hp < e.maxHp) {
        regenFrame.set(e, ctx.time.frame);
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * f.regen * dt);
      }
    }
    _live.clear();
    for (const r of faceAura) r.tick(now);
  }

  private dropAllAuras(): void {
    const now = this.ctx.time.now;
    for (const r of faceAura) r.dropSource(this, now);
    this.auraTargets.clear();
  }

  // ───────────── 变脸 / 碎面 ─────────────

  /** 换到下一张没碎的脸：旧脸的光环撤下，一团火光盖住换脸 */
  swapFace(): void {
    this.swapped = true;
    const now = this.ctx.time.now;
    faceAura[this.face].dropSource(this, now);
    this.auraTargets.clear();
    for (let k = 1; k <= 3; k++) {
      const next = (this.face + k) % 3;
      if (!this.broken[next]) {
        this.face = next;
        break;
      }
    }
    this.maskDamage = 0;
    this.swapAt = this.age;
    this.applyFace();
    const ctx = this.ctx;
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, C.ember, 22, 2.6, 0.45, 0.09, -2);
    ctx.fx.burst(_p, this.currentFace.id === 'black' ? 0x7040c0 : this.currentFace.ring, 12, 1.8, 0.5, 0.07, -1);
    ctx.audio.play('skill_fire', { position: _p, volume: 0.7, pitch: 1.2 });
    this.spawnTongues();
  }

  /** 当前这张脸累计受伤占碎面阈值的比例（测试 / 调试用） */
  get maskCrack(): number {
    return clamp01(this.maskDamage / (this.maxHp * MASK_BREAK.frac));
  }

  /** 面具在换脸那一下被袖子挡住 */
  get maskCovered(): boolean {
    return this.state === 'wipe';
  }

  /** 弱点是面具：从背后打到头、换脸被袖子挡住时都算打身体 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const hit = super.raycastHit(origin, dir, maxDist, out);
    if (!hit || !out.headshot) return hit;
    const along = dir.x * Math.sin(this.facing) + dir.z * Math.cos(this.facing);
    if (along > 0.2 || this.maskCovered) out.headshot = false;
    return hit;
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    if (!this.alive || !r.request.headshot || this.maskCovered || this.broken[this.face]) return;
    this.hitAt = this.age;
    this.maskDamage += r.dealt;
    if (this.maskDamage >= this.maxHp * MASK_BREAK.frac) this.breakFace();
    else this.ctx.audio.play('hit_armor', { position: this.getHeadCenter(_p), volume: 0.6, pitch: 1.4 });
  }

  /** 碎面：这张脸的加成立刻撤掉、以后不再换回来；捂脸踉跄 2 秒，6 秒内不能变脸 */
  private breakFace(): void {
    const ctx = this.ctx, now = ctx.time.now;
    this.broken[this.face] = true;
    this.maskDamage = 0;
    faceAura[this.face].dropSource(this, now);
    this.auraTargets.clear();
    this.cancelAttack();
    this.releaseAttack();
    this.lockUntil = now + MASK_BREAK.lock;
    this.faceTimer = 0; // 锁定一结束就换下一张脸（碎掉的这张没有加成）
    this.applyFace();
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, 0xb08050, 18, 3.5, 0.8, 0.07, 12);
    ctx.fx.burst(_p, C.ember, 14, 2.5, 0.5, 0.07, 2);
    ctx.audio.play('shield_break', { position: _p, volume: 0.9, pitch: 1.2 });
    ctx.audio.play('boss_roar', { position: this.position, volume: 0.3, pitch: 2.4 });
    this.setState('cover');
  }

  // ───────────── 吐火 ─────────────

  private beginSpit(): void {
    this.windTime = this.windup(SPIT.windup, 0.35);
    this.spitYaw = this.facing;
    // 从玩家那一侧的反面扫起（扫过玩家）
    const pl = this.ctx.player.position;
    const rel = wrapAngle(Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing);
    this.spitSign = rel >= 0 ? 1 : -1;
    this.setState('spitWindup');
    this.spitDecal?.release();
    this.spitDecal = GroundDecal.acquire(this.ctx.stageGroup, C.ember);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.5, pitch: 1.3 });
  }

  /** 当前火柱方向（水平角，与 facing 同约定）：从一侧扫到另一侧 */
  jetYaw(): number {
    const u = clamp01(this.stateTime / SPIT.sweep);
    return this.spitYaw + this.spitSign * (-SPIT.halfArc + 2 * SPIT.halfArc * smooth(u));
  }

  /** 火柱：从嘴到 6 米（或第一堵墙）；玩家在火柱上（角度差 < 宽度、有视线、高度差不大）每 0.1 秒烫一下 */
  private updateJet(dt: number): void {
    const ctx = this.ctx, pl = ctx.player;
    const yaw = this.jetYaw();
    this.facing = this.spitYaw;
    this.mouthWorld(_p);
    _v.set(Math.sin(yaw), -0.08, Math.cos(yaw)).normalize();
    const wall = ctx.world.raycast(_p, _v, SPIT.range);
    const reach = wall ? wall.distance : SPIT.range;
    _q.copy(_p).addScaledVector(_v, reach);
    if (this.jet) {
      this.jet.set(_p, _q, 0.16 * this.sizeScale);
      this.jet.flicker(0.7 + 0.3 * Math.sin(this.age * 41));
    }
    for (let i = 0; i < 2; i++) {
      _t.copy(_p).addScaledVector(_v, reach * Math.random());
      ctx.fx.burst(_t, i ? C.ember : C.molten, 1, 1.2, 0.3, 0.12, -2);
    }
    // 火柱落地的那一头留下小片余火
    this.emberTimer -= dt;
    if (this.emberTimer <= 0) {
      this.emberTimer += SPIT_EMBER.every;
      _t.copy(_p).addScaledVector(_v, reach * 0.85);
      const gy = ctx.world.groundHeight(_t.x, _t.z, _p.y + 0.5);
      if (Number.isFinite(gy) && _p.y - gy < 3) {
        _t.y = gy + 0.02;
        spawnFirePool(ctx, _t, SPIT_EMBER.radius, SPIT_EMBER.life, { playerDamage: this.def.damage * SPIT_EMBER.dmg * this.damageMult, allyFrac: 0, source: this, color: C.ember });
      }
    }
    this.spitTick -= dt;
    if (this.spitTick > 0) return;
    this.spitTick += SPIT.tick;
    if (!pl.alive) return;
    const dx = pl.position.x - this.position.x, dz = pl.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > reach + pl.radius + 0.3 || Math.abs(pl.position.y - this.position.y) > 2.5) return;
    const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
    if (off > SPIT.width + Math.atan2(pl.radius, Math.max(0.5, d))) return;
    this.playerChest(_t);
    if (ctx.world.segmentBlocked(_p, _t)) return;
    ctx.combat.damagePlayer(this.def.damage * SPIT.dps * SPIT.tick * this.damageMult, 'fire', this, _p);
  }

  /** 面具嘴部插槽的世界坐标 */
  mouthWorld(out: THREE.Vector3): THREE.Vector3 {
    const b = this.nativeBody?.pose.bone('mouth') ?? this.nativeBody?.pose.bone('head');
    if (b) {
      b.updateWorldMatrix(true, false);
      return b.localToWorld(out.copy(this.mouthLocal));
    }
    this.classicHead.updateWorldMatrix(true, false);
    return this.classicHead.localToWorld(out.set(0, 0.05, 0.18));
  }

  // ───────────── 死亡 ─────────────

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.dropAllAuras();
    this.clearTongues();
    if (attackDirector.purging) return;
    const ctx = this.ctx;
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, 0xb08050, 16, 3, 0.9, 0.07, 12);
    ctx.fx.burst(this.getBodyCenter(_q), C.ember, 22, 2.5, 1.2, 0.08, -1);
  }

  // ───────────── 换脸火光 ─────────────

  private spawnTongues(): void {
    this.clearTongues();
    for (let i = 0; i < 4; i++) {
      const t = createFlameTongue(Math.random());
      this.ctx.stageGroup.add(t);
      this.tongues.push(t);
    }
  }

  private clearTongues(): void {
    for (const t of this.tongues) {
      t.removeFromParent();
      t.material.dispose();
    }
    this.tongues.length = 0;
  }

  /** 换脸后 0.6 秒：几片火舌从面具前蹿起再收回，盖住换脸那一下 */
  private updateTongues(): void {
    if (this.tongues.length === 0) return;
    const u = (this.age - this.swapAt) / 0.6;
    if (u >= 1) {
      this.clearTongues();
      return;
    }
    FLAME_FX_TIME.value = this.ctx.time.now;
    this.getHeadCenter(_p);
    const s = this.sizeScale * 0.55 * Math.sin(Math.PI * clamp01(u * 1.1));
    this.tongues.forEach((t, i) => {
      const a = this.facing + (i - 1.5) * 0.5;
      t.position.set(_p.x + Math.sin(a) * 0.12 * this.sizeScale, _p.y - 0.18 * this.sizeScale, _p.z + Math.cos(a) * 0.12 * this.sizeScale);
      t.scale.set(s * 0.8, Math.max(0.01, s * (1.2 + 0.3 * i % 2)), s);
      t.material.uniforms.uAlpha.value = 1 - u * u;
    });
  }

  // ───────────── 动画 ─────────────

  private deathT = 0;

  /** 死亡：面具先裂开落下，人原地转半圈软倒，化成一团火星散去 */
  protected override animateDeath(t: number): void {
    const dt = Math.max(0, (t - this.deathT) * this.deathDuration);
    this.deathT = t;
    this.model.rotation.y = 1.4 * smooth(t / 0.7);
    this.model.position.y = -0.4 * smooth((t - 0.2) / 0.6) * this.sizeScale;
    const fade = smooth((t - 0.55) / 0.45);
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - fade)));
    if (dt > 0) this.pose(dt);
    if (Math.random() < dt * 30) {
      this.getBodyCenter(_p);
      _p.x += (Math.random() - 0.5) * 0.6;
      _p.z += (Math.random() - 0.5) * 0.6;
      this.ctx.fx.burst(_p, C.ember, 1, 0.8, 1, 0.08, -1.2);
    }
  }

  protected override pose(dt: number): void {
    const st = this.state;
    this.eWipe.step(st === 'wipe' ? 1 : 0, dt);
    this.eCover.step(st === 'cover' ? 1 : 0, dt);
    this.eSpit.step(st === 'spitWindup' ? -1 : st === 'spit' ? 1 : 0, dt);
    this.eDance.step(st === 'dance' || st === 'enter' ? 1 : 0.2, dt);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseClassic(dt);
    this.updateTongues();
    // 面具：眼睛按脸色亮，跺脚的拍子上一闪；换脸那一下整张面具一亮；被打中闪一下
    const swapFlash = Math.max(0, 1 - (this.age - this.swapAt) * 2.5);
    const hit = Math.max(0, 1 - (this.age - this.hitAt) * 6);
    const pulse = 0.5 + 0.5 * Math.max(0, Math.sin(this.age * Math.PI * 2 / DANCE.beat));
    const dead = !this.alive || this.broken[this.face];
    if (this.mask) this.mask.eyeGlow.value = dead ? 0.15 : 0.7 + 0.5 * pulse + 0.8 * this.glowLevel[1];
    const glow = this.nativeBody?.glowShell;
    if (glow) {
      glow.color.setHex(this.currentFace.id === 'black' ? 0x8040ff : this.currentFace.ring);
      glow.opacity = this.alive ? 0.9 * swapFlash + 0.5 * hit + 0.25 * this.glowLevel[1] : 0;
    }
    for (const e of this.eyes) e.scale.setScalar(1 + 0.4 * pulse);
  }

  /**
   * 美术骨骼动画（creature_rigs/SK_Enemy_Nuo.json）。模型空间：X = 生物左侧，Y = 上，Z = 前。
   * - 傩舞：按拍子交替跺脚（大腿抬、落地一顿），胯随拍下沉、上身左右拧，双臂交替从体侧扬起（手掌张开）。
   * - 变脸：右臂前抬、小臂折起，手和大袖从面具前横着抹过；头微低。
   * - 碎面：双臂抬到脸前、小臂折起捂脸，膝盖发软、全身发抖。
   * - 吐火：蓄火时后仰、吐火时探头前倾，头和胸跟着火柱扫过去。
   * - 弹簧：大袖按重力下垂并随舞步甩；羽冠、两侧飘带、背后长飘带、裙摆前后左右按惯性甩。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    const vz = this.velocity.x * sf + this.velocity.z * cf, vx = this.velocity.x * cf - this.velocity.z * sf;
    const h = Math.max(dt, 1e-3);
    const az = ((this.velocity.x - this.prevVel.x) * sf + (this.velocity.z - this.prevVel.z) * cf) / h;
    const ax = ((this.velocity.x - this.prevVel.x) * cf - (this.velocity.z - this.prevVel.z) * sf) / h;
    this.prevVel.copy(this.velocity);
    const dance = this.eDance.x * (this.alive ? 1 : 0), wipe = this.eWipe.x, cover = this.eCover.x, spit = this.eSpit.x;
    // 拍子：u 在一拍里 0 → 1；抬脚的那条腿交替
    const bt = t / DANCE.beat, u = bt - Math.floor(bt), leg = Math.floor(bt) % 2;
    const lift = Math.sin(Math.PI * Math.min(1, u / 0.6)) * (u < 0.6 ? 1 : 0);
    const thump = Math.exp(-14 * Math.max(0, u - 0.6)) * (u >= 0.6 ? 1 : 0);
    const twist = Math.sin(Math.PI * bt) * dance;
    this.lean.step(THREE.MathUtils.clamp(vz * 0.04, -0.12, 0.18), THREE.MathUtils.clamp(-vx * 0.04, -0.15, 0.15), dt);
    this.robe.step(THREE.MathUtils.clamp(-az * 0.012 - vz * 0.04, -0.4, 0.4) + 0.1 * thump * dance, THREE.MathUtils.clamp(ax * 0.012 + vx * 0.04, -0.3, 0.3) + 0.12 * twist, dt);
    this.crown.step(THREE.MathUtils.clamp(-az * 0.01, -0.3, 0.3) + 0.12 * thump * dance, 0.15 * twist + THREE.MathUtils.clamp(ax * 0.01, -0.3, 0.3), dt);
    this.ribbon.step(THREE.MathUtils.clamp(-az * 0.015 - vz * 0.05, -0.6, 0.6), THREE.MathUtils.clamp(ax * 0.015 + vx * 0.05, -0.5, 0.5) + 0.2 * twist, dt);
    const tremble = cover * Math.sin(t * 39) * 0.03;
    const breath = Math.sin(t * 1.5);
    const hurt = this.hurtKick;

    // 身体：胯随拍下沉，上身左右拧；吐火时后仰 → 前探；捂脸时弓身
    P.rotate('hips', AX, this.lean.x);
    P.rotate('hips', AZ, this.lean.y + 0.08 * (leg ? 1 : -1) * lift * dance);
    P.translate('hips', 0, -0.05 * thump * dance - 0.08 * cover, 0);
    P.rotate('spine', AY, 0.18 * twist);
    P.rotate('spine', AX, 0.02 * breath + 0.12 * spit + 0.15 * cover - 0.12 * hurt);
    P.rotate('chest', AY, 0.12 * twist);
    P.rotate('chest', AX, 0.08 * spit + 0.1 * cover + tremble);
    // 头：看玩家；吐火时随火柱扫
    const pl = this.ctx.player.position;
    let dyaw = wrapAngle(Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing);
    if (this.state === 'spit') dyaw = wrapAngle(this.jetYaw() - this.facing);
    const goal = THREE.MathUtils.clamp(dyaw, -0.9, 0.9) * (1 - cover) - 0.25 * twist;
    this.headYaw += (goal - this.headYaw) * (1 - Math.exp(-10 * dt));
    P.rotate('chest', AY, this.headYaw * 0.35 * Math.max(0, spit));
    P.rotate('neck', AY, this.headYaw * 0.45);
    P.rotate('head', AY, this.headYaw * 0.35);
    P.rotate('neck', AX, 0.1 * spit + 0.15 * wipe + 0.3 * cover);
    P.rotate('head', AX, 0.12 * spit + 0.08 * thump * dance + 0.15 * cover + tremble * 2);
    P.rotate('head', AZ, 0.1 * Math.sin(Math.PI * bt) * dance + tremble);

    // 腿：跺脚舞步（抬腿那条膝盖折起，落地一顿）+ 走路
    const ph = this.walkPhase, amp = this.walkAmp;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 'L' : 'R';
      const sw = Math.sin(ph + i * Math.PI), wl = Math.max(0, Math.cos(ph + i * Math.PI));
      const stomp = (leg === i ? lift : 0) * dance;
      P.rotate(`thigh_${s}`, AX, -0.4 * amp * sw - 0.1 * wl * amp - 0.7 * stomp + 0.12 * cover);
      P.rotate(`shin_${s}`, AX, 0.5 * amp * wl + 0.9 * stomp + 0.25 * cover);
      P.rotate(`foot_${s}`, AX, -0.3 * amp * wl - 0.2 * stomp);
    }
    // 裙摆
    const fwd = Math.max(0, Math.sin(ph), Math.sin(ph + Math.PI)) * amp + lift * dance * 0.6;
    const flutter = (k: number): number => 0.04 * Math.sin(t * 2 + k * 1.3);
    P.rotate('robe_F1', AX, -0.3 * fwd + Math.min(0.05, this.robe.x) + flutter(0));
    P.rotate('robe_F2', AX, this.robe.x * 0.5 + flutter(1));
    P.rotate('robe_B1', AX, 0.25 * fwd + Math.max(-0.05, this.robe.x) + flutter(2));
    P.rotate('robe_B2', AX, this.robe.x * 0.5 + flutter(3));
    for (let j = 0; j < 2; j++) {
      const s = j === 0 ? 'L' : 'R', m = j === 0 ? 1 : -1;
      P.rotate(`robe_${s}1`, AZ, m * Math.max(-0.05, this.robe.y * m) + flutter(4) * m + 0.1 * m * Math.abs(twist));
      P.rotate(`robe_${s}2`, AZ, this.robe.y * 0.5 + flutter(5) * m);
    }

    // 手臂：舞（交替从体侧扬起）、变脸（右臂抹脸）、捂脸（双手到脸前）、吐火（双臂后展）
    for (const hs of this.hands) {
      const left = hs.side === 'L', m = left ? 1 : -1, s = hs.side;
      const up = (left ? (leg === 0 ? lift : 0.3 * lift) : (leg === 1 ? lift : 0.3 * lift)) * dance;
      P.rotate(`arm_${s}`, AZ, m * (0.9 * up + 0.04 * breath + 0.5 * Math.max(0, spit)));
      P.rotate(`arm_${s}`, AX, 0.2 * Math.max(0, spit) - 0.15 * up);
      P.rotate(`forearm_${s}`, AX, -0.3 * up - 0.1);
      if (!left && wipe > 0.001) {
        // 抹脸：上臂前抬到肩高、往身前横拧，小臂折上来，手从右往左扫过面具
        const sweep = clamp01(this.stateTime / FACE_CHANGE.wipe);
        P.rotate(`arm_${s}`, AX, -1.45 * wipe);
        P.rotate(`arm_${s}`, AY, (0.2 + 0.9 * smooth(sweep)) * wipe);
        P.rotate(`forearm_${s}`, AX, -1.2 * wipe);
      }
      if (cover > 0.001) {
        P.rotate(`arm_${s}`, AX, -1.3 * cover);
        P.rotate(`arm_${s}`, AY, -m * 0.55 * cover);
        P.rotate(`forearm_${s}`, AX, -1.5 * cover + tremble * 4);
      }
      // 手指：舞时张开、抹脸时并拢伸直、捂脸时爪状
      for (let f = 0; f < 5; f++) {
        let g = 0.2;
        g = mix(g, -0.2, up);
        g = mix(g, 0.05, left ? 0 : wipe);
        g = mix(g, 0.55 + 0.08 * Math.sin(t * 31 + f), cover);
        hs.curl[f] = mix(hs.curl[f], g, 1 - Math.exp(-12 * dt));
        const c = hs.curl[f], axis = hs.axes[f], thumb = f === 0;
        P.rotate(`${FINGERS[f]}_1_${s}`, axis, c * (thumb ? 0.45 : 0.8));
        P.rotate(`${FINGERS[f]}_2_${s}`, axis, c * (thumb ? 0.5 : 0.95));
      }
      // 大袖：IK 之后按重力下垂，再叠舞步的甩动
      for (let i = 0; i < 2; i++) {
        const name = `sleeve_${s}${i + 1}`;
        if (!P.has(name)) continue;
        const a = P.hostPosition(name, _h1);
        const child = i === 0 ? `sleeve_${s}2` : null;
        const cur = child ? P.hostPosition(child, _h2).sub(a) : a.sub(P.hostPosition(`sleeve_${s}1`, _h2));
        if (cur.lengthSq() < 1e-8) continue;
        cur.normalize();
        const g2 = _h3.set(0.25 * this.robe.y + 0.15 * m * up + 0.06 * m + 0.05 * Math.sin(t * 1.7 + i), -1, -0.3 * this.robe.x + 0.1 * twist * m).normalize();
        const axis = _h4.crossVectors(cur, g2);
        const sin = axis.length();
        if (sin < 1e-5) continue;
        P.rotateCurrent(name, axis.divideScalar(sin), Math.atan2(sin, cur.dot(g2)) * 0.8);
      }
    }

    // 羽冠：两扇跟着头甩（弹簧），拍子上一颤
    P.rotate('feather_L', AZ, -0.12 * this.crown.y - 0.05 * thump * dance);
    P.rotate('feather_R', AZ, -0.12 * this.crown.y + 0.05 * thump * dance);
    P.rotate('feather_L', AX, 0.2 * this.crown.x + 0.03 * Math.sin(t * 2.2));
    P.rotate('feather_R', AX, 0.2 * this.crown.x + 0.03 * Math.sin(t * 2.2 + 1));
    // 飘带：两侧两节、背后三节（波从根往尖传）
    for (let k = 0; k < 2; k++) {
      const w = [0.6, 0.45][k];
      for (const [s, m] of [['L', 1], ['R', -1]] as const) {
        P.rotate(`ribbon_${s}${k + 1}`, AZ, (this.ribbon.y + 0.05 * Math.sin(t * 2 - k + m)) * w + m * 0.15 * cover);
        P.rotate(`ribbon_${s}${k + 1}`, AX, (this.ribbon.x + 0.06 * Math.sin(t * 1.6 - k)) * w);
      }
    }
    for (let k = 0; k < 3; k++) {
      const w = [0.5, 0.4, 0.35][k];
      P.rotate(`ribbon_B${k + 1}`, AX, (this.ribbon.x * 1.2 + 0.07 * Math.sin(t * 1.4 - k * 0.9) - 0.1 * Math.max(0, spit)) * w);
      P.rotate(`ribbon_B${k + 1}`, AZ, (this.ribbon.y + 0.06 * Math.sin(t * 1.2 - k * 0.8)) * w);
    }
  }

  /** 程序化白模（?classic 或资产未就绪）：舞步颠动、双臂交替扬起、抹脸、捂脸、吐火前探 */
  private poseClassic(dt: number): void {
    const t = this.age, dance = this.eDance.x;
    const bt = t / DANCE.beat, u = bt - Math.floor(bt), leg = Math.floor(bt) % 2;
    const lift = Math.sin(Math.PI * Math.min(1, u / 0.6)) * (u < 0.6 ? 1 : 0) * dance;
    this.body.position.y = 0.04 * lift;
    this.body.rotation.y = 0.2 * Math.sin(Math.PI * bt) * dance;
    this.body.rotation.x = 0.1 * this.eSpit.x + 0.15 * this.eCover.x - this.hurtKick * 0.15;
    for (let j = 0; j < this.classicArms.length; j++) {
      const s = j === 0 ? 1 : -1;
      const arm = this.classicArms[j];
      const up = (leg === j ? lift : 0.2 * lift);
      arm.rotation.z = s * (0.6 - 1.1 * up) - s * 1.0 * this.eCover.x;
      arm.rotation.y = (j === 1 ? -1.4 * this.eWipe.x : 0) + s * -0.8 * this.eCover.x;
    }
    this.classicHead.rotation.x = 0.2 * this.eCover.x + 0.1 * this.eSpit.x;
    void dt;
  }
}
