/**
 * 毕方（bifang，第三章 · 祝融火狱 / 火坛的远程怪）：《山海经》「其状如鹤，一足，赤文青质而白喙」，见则其邑有讹火。
 * 这里是一只 2.4 米高的黑底朱纹独脚火鹤：S 形长颈、白喙里衔着一颗炭火（弱点），双翼收拢贴身，单腿立在柱顶。
 * 和三青鸟一眼分开：它**从不悬停**——要么单足立在柱顶 / 高台 / 栏杆上，要么扇几下翅膀做一段短滑翔换到另一处高点。
 * 动作按真鹤：站着时身体前倾、颈部 S 形缓缓起伏、头稳稳盯住目标；起飞前屈腿下蹲、张翅；滑翔时身体放平、腿向后拖。
 *
 * - 栖高：找玩家 12–28 米外、比玩家所在地面高 3 米以上（找不到就 1.6 米以上的高台，再不行就地面）的落脚点，
 *   扇翅短滑翔过去（滑翔途中不射，从起飞算起 2 秒内不能射）。
 * - 毕方鸣 · 火矛（约每 3.5 秒，拿到远程令牌）：第一声「毕」——脖子缩成 S 形、喙里的炭火越来越亮，喙尖到玩家胸口亮起一根
 *   淡金色瞄准细线（0.8 秒，前 70% 跟着玩家转，之后锁死并转成白热）；第二声「方」——长喙一啄，射出一支快速火矛（直线，不追踪）。
 *   听到第一声就横移或躲进掩体。
 * - 讹火：火矛打空，打中的墙面 / 地面留一个火点烧 3 秒（站上去每 0.5 秒烫一下）；打中玩家会点燃 2 秒。
 * - 断足坠落：那条腿累计吃到最大生命 25% 的伤害，腿一软从高处摔下来，在地上扑腾 2.5 秒（输出窗口），然后再飞回高处。
 *   站着时腿最显眼，比身体好打（腿的命中球比画出来的腿粗一圈）。
 * - 换栖：被打掉 30% 血、玩家爬上和它差不多高的地方（9 米内）、或者 2.5 秒看不到玩家，就滑翔到另一处高点。
 * - 弱点 = 喙里衔的炭火（命中球挂在 head 骨上），难打、伤害最高。身体 / 颈 / 头 / 尾 / 腿是挂在骨骼上的几颗命中球。
 *
 * 状态机：perch → cryBi →（火矛）cryFang → recover → perch
 *         perch → takeoff → glide → land → perch
 *         （腿断）→ fall → downed → takeoff → …
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import { FROST_FX_TIME, applyFrostGlow, hitAnchor, raycastSpheres, type FrostGlowHandle, type HitSphere } from '../fx/FrostSkirmishFx';
import { SpringTail } from '../frost/PackMotion';
import { AimLine, INFERNO, launchFireSpear, tickInfernoFx } from '../fx/InfernoRangedFx';

export const BIFANG_DEF: ScaledEnemyDef = {
  id: 'bifang',
  name: '毕方',
  // 美术按 2.0 米（冠顶）制作，游戏里放大 1.2 倍：约 2.4 米高
  scale: 1.2,
  hp: 90,
  // 滑翔的参考速度（飞行单位的竖直速度上限 = 1.5 倍；毕方的位移全由滑翔弧线驱动）
  speed: 7,
  radius: 0.3,
  height: 1.4,
  // 不悬停：只用飞行单位的「无重力」来站在柱顶、走滑翔弧线；高度每帧由 flyTargetY 钉在落脚点上
  flying: true,
  // 火矛
  damage: 20,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 喙里的炭火（放大前离脚底 1.445 米）
  headY: 1.445,
  headRadius: 0.09,
  knockbackResist: 0.5,
  color: 0xff6a2a,
};

/** 落脚点：离玩家的水平距离、比玩家所在地面高多少（优先 / 最低）、落脚面最小边长 */
const PERCH_RANGE = [12, 28] as const;
const PERCH_HIGH = 3.2;
const PERCH_LOW = 1.6;
const PERCH_MIN_SIZE = 0.6;
/** 地面落脚点（没有高处时）离玩家的距离 */
const GROUND_RANGE = [14, 24] as const;
/** 毕方鸣：前摇、跟踪段比例、出手后的收势、冷却 */
const CRY_TIME = 0.8;
const TRACK_FRAC = 0.7;
const PECK_TIME = 0.18;
const RECOVER_TIME = 0.5;
const CRY_COOLDOWN = [2.3, 2.9] as const;
const FIRE_RANGE = [6, 34] as const;
/** 火矛：速度、射程、判定半径；点燃与讹火 */
const SPEAR_SPEED = 42;
const SPEAR_RANGE = 46;
const SPEAR_RADIUS = 0.3;
const IGNITE = { duration: 2, tick: 3 };
const EMBER_FIRE = { radius: 0.9, duration: 3, tick: 4 };
/** 换栖：掉血比例、玩家同高判定、看不到玩家多久、起飞后多久不能射 */
const MOVE_HURT = 0.3;
const SAME_HEIGHT = 1.3;
const SAME_HEIGHT_RANGE = 9;
const BLIND_MOVE = 2.5;
const NO_FIRE_AFTER_MOVE = 2;
/** 起飞下蹲、落地缓冲、滑翔时长范围 */
const TAKEOFF_TIME = 0.35;
const LAND_TIME = 0.3;
const GLIDE_TIME = [0.8, 2.6] as const;
const GLIDE_SPEED = 10;
const GLIDE_MAX = 34;
/** 断足：腿累计伤害比例、坠落时长、地上扑腾时长 */
const LEG_BREAK = 0.25;
const FALL_TIME = 0.7;
const DOWNED_TIME = 2.5;

/** 美术网格实测（模型空间、未缩放；Blender (x, y, z) → (x, z, -y)） */
const EMBER = [0, 1.445, 0.4785] as const;
const BEAK_TIP = [0, 1.42, 0.575] as const;
const HITS = [
  { bone: 'head', at: [0, 1.63, 0.2], r: 0.13 },
  { bone: 'neck_3', at: [0, 1.32, 0.2], r: 0.09 },
  { bone: 'chest', at: [0, 1.02, 0.15], r: 0.26 },
  { bone: 'hips', at: [0, 0.88, -0.15], r: 0.25 },
  { bone: 'tail_1', at: [0, 0.72, -0.38], r: 0.14 },
] as const;
/** 腿的命中球（比画出来的腿粗：站着时它最显眼、比身体好打） */
const LEG_HITS = [
  { bone: 'shin', at: [0, 0.66, 0.07] },
  { bone: 'tarsus', at: [0, 0.5, 0.056] },
  { bone: 'tarsus', at: [0, 0.38, 0.057] },
  { bone: 'tarsus', at: [0, 0.26, 0.058] },
  { bone: 'tarsus', at: [0, 0.15, 0.06] },
] as const;
const LEG_R = 0.085;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();

const C = {
  plume: 0x1c1f2e, plumeDark: 0x121420, red: 0xd8281c, beak: 0xeee4d0, leg: 0x3a2a24, bronze: 0xa88a52,
  ember: 0xff8a20, emberHot: 0xfff0b0,
};

/** 同时在场的毕方各占一个落脚点（不挤到同一根柱子上）；按 ctx 区分，死掉 / 移除的不算 */
const claims = new Map<number, { ctx: GameContext; owner: { alive: boolean; removed: boolean }; at: THREE.Vector3 }>();

export class Bifang extends StandardEnemy {
  private readonly hits: HitSphere[] = [];
  private readonly legHits: HitSphere[] = [];
  private emberAnchor!: THREE.Object3D;
  private beakAnchor!: THREE.Object3D;
  private glow: FrostGlowHandle | null = null;
  private crest: SpringTail | null = null;
  private tail: SpringTail | null = null;
  // 白模关节
  private bodyJ!: THREE.Group;
  private readonly neckJ: THREE.Group[] = [];
  private headJ!: THREE.Group;
  private readonly wingJ: { s: number; g: THREE.Group }[] = [];
  private shinJ!: THREE.Group;
  private tarsusJ!: THREE.Group;
  private emberGlow!: THREE.Mesh;

  // 行为
  /** 当前落脚点（脚底）与是否在高处 */
  readonly perch = new THREE.Vector3();
  perchHigh = false;
  private readonly glideFrom = new THREE.Vector3();
  private readonly glideTo = new THREE.Vector3();
  private glideTime = 1;
  private glideApex = 1;
  private glideToHigh = false;
  private readonly glideVel = new THREE.Vector3();
  private readonly fallTo = new THREE.Vector3();
  private moveRetry = 0;
  /** 自上次换栖起被打掉的血、腿累计吃到的伤害 */
  hurtSinceMove = 0;
  legDamage = 0;
  private cryTime = CRY_TIME;
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  private readonly aimPoint = new THREE.Vector3();
  aimLine: AimLine | null = null;
  private fireAge = Infinity;
  // 姿态
  private pCrouch = 0;
  private pGlide = 0;
  private pS = 0;
  private pPeck = 0;
  private pDown = 0;
  private pFlap = 0;
  private pYaw = 0;
  private pPitch = 0;
  private flapPhase = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, BIFANG_DEF, opts);
    this.accel = 30;
    this.deathDuration = 1.1;
    this.cooldown = ctx.rng.range(1.2, 2.0);
    // 出生在地面（飞行单位的出生点可能在半空：落到脚下的地面上）：站在原地，一出生就去找高处
    const gy = ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 1);
    if (Number.isFinite(gy)) this.position.y = gy;
    this.perch.copy(this.position);
    this.flyTargetY = this.position.y;
    this.setState('perch');
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const plume = flat(C.plume, { rough: 0.8 }), dark = flat(C.plumeDark, { rough: 0.85 }), red = flat(C.red, { rough: 0.7 });
    const beak = flat(C.beak, { rough: 0.4 }), leg = flat(C.leg, { rough: 0.6 }), bronze = flat(C.bronze, { metal: 0.6, rough: 0.4 });
    // 身体（前倾的卵形）、尾扇
    const body = joint(root, 0, 0.95, 0);
    this.bodyJ = body;
    part(body, Geo.ico(0.24, 2), plume, 0, 0, 0).scale.set(0.85, 0.95, 1.5);
    part(body, Geo.ico(0.16, 1), red, 0, -0.02, 0.2).scale.set(0.7, 1.1, 0.6);
    for (let i = 0; i < 3; i++) part(body, Geo.cone(0.05, 0.4, 4), i === 1 ? red : dark, (i - 1) * 0.06, -0.18, -0.42, -1.1, 0, (i - 1) * 0.2);
    // 收拢的双翼：贴在身体两侧，翼尖朱红
    for (const s of [1, -1]) {
      const g = joint(body, s * 0.17, 0.12, 0.12);
      part(g, Geo.box(0.06, 0.24, 0.55), dark, s * 0.03, -0.1, -0.2, 0.35, 0, 0);
      part(g, Geo.cone(0.05, 0.28, 4), red, s * 0.03, -0.3, -0.5, -1.2, 0, 0);
      this.wingJ.push({ s, g });
    }
    // S 形颈：三节
    let parent: THREE.Object3D = body;
    const neckAt = [[0, 0.18, 0.22], [0, 0.16, 0.02], [0, 0.15, -0.03]] as const;
    for (let i = 0; i < 3; i++) {
      const n = joint(parent, neckAt[i][0], neckAt[i][1], neckAt[i][2]);
      part(n, Geo.cyl(0.05, 0.065, 0.18, 6, 'bottom'), i === 1 ? red : plume, 0, 0, 0);
      this.neckJ.push(n);
      parent = n;
    }
    this.neckJ[0].rotation.x = 0.35;
    this.neckJ[1].rotation.x = -0.45;
    this.neckJ[2].rotation.x = -0.2;
    // 头：白喙衔炭火、朱红冠羽
    const head = joint(parent, 0, 0.18, 0);
    this.headJ = head;
    part(head, Geo.ico(0.1, 1), plume, 0, 0.04, 0).scale.set(0.9, 1, 1.15);
    part(head, Geo.cone(0.04, 0.34, 6), beak, 0, -0.02, 0.24, Math.PI / 2 + 0.35, 0, 0);
    for (let i = 0; i < 3; i++) part(head, Geo.cone(0.03, 0.22 - i * 0.04, 4, 'bottom'), red, 0, 0.1, -0.02 - i * 0.05, -0.5 - i * 0.3, 0, 0);
    this.emberGlow = this.glowPart(head, Geo.ico(0.06, 1), C.ember, C.emberHot, 0, -0.12, 0.27, 0);
    this.emberAnchor = this.emberGlow;
    this.beakAnchor = joint(head, 0, -0.1, 0.38);
    // 单腿：胫（铜饰关节）→ 跗跖长杆 → 四趾
    const shin = joint(root, 0, 0.72, 0.08);
    this.shinJ = shin;
    part(shin, Geo.cyl(0.035, 0.05, 0.16, 6, 'top'), bronze, 0, 0, 0);
    const tarsus = joint(shin, 0, -0.155, -0.025);
    this.tarsusJ = tarsus;
    part(tarsus, Geo.cyl(0.022, 0.026, 0.41, 5, 'top'), leg, 0, 0, 0);
    part(tarsus, Geo.cyl(0.035, 0.035, 0.04, 6), bronze, 0, -0.4, 0);
    for (let k = 0; k < 4; k++) {
      const a = k === 3 ? Math.PI : (k - 1) * 0.55;
      part(tarsus, Geo.cone(0.018, 0.2, 4), leg, Math.sin(a) * 0.09, -0.52, Math.cos(a) * 0.09, Math.PI / 2, a, 0);
    }
    this.setHeadAnchor(this.emberGlow, 0, 0, 0);
    return root;
  }

  // ───────────── 美术身体 ─────────────

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    if (n) {
      this.bodyJ.visible = false;
      this.shinJ.visible = false;
    }
    const classic: Record<string, THREE.Object3D> = {
      head: this.headJ, neck_3: this.neckJ[1], chest: this.bodyJ, hips: this.bodyJ, tail_1: this.bodyJ,
      shin: this.shinJ, tarsus: this.tarsusJ,
    };
    const at = (bone: string): THREE.Object3D => P?.bone(bone) ?? classic[bone] ?? this.bodyJ;
    if (P) {
      this.emberAnchor = hitAnchor(at('head'), host, EMBER[0], EMBER[1], EMBER[2]);
      this.beakAnchor = hitAnchor(at('head'), host, BEAK_TIP[0], BEAK_TIP[1], BEAK_TIP[2]);
    }
    this.hits.push({ anchor: this.emberAnchor, r: BIFANG_DEF.headRadius!, head: true });
    for (const h of HITS) this.hits.push({ anchor: hitAnchor(at(h.bone), host, h.at[0], h.at[1], h.at[2]), r: h.r, head: false });
    for (const h of LEG_HITS) {
      const s: HitSphere = { anchor: hitAnchor(at(h.bone), host, h.at[0], h.at[1], h.at[2]), r: LEG_R, head: false };
      this.legHits.push(s);
      this.hits.push(s);
    }
    this.setHeadAnchor(this.emberAnchor, 0, 0, 0);
    if (!n || !P) return;
    // 炭火常亮（弱点），冠羽、翼尖、尾尖的朱红火纹微亮
    this.glow = applyFrostGlow(n.materials[0], 'bifang', [
      { color: 0xffa040, hue: [0.09, 0.07], minSat: 0.4, minVal: 0.5, sphere: { center: [EMBER[0], EMBER[1], EMBER[2]], radius: 0.1 }, shimmer: 0.45 },
      { color: 0xff4a1a, hue: [0.0, 0.05], minSat: 0.55, minVal: 0.45, box: { min: [-0.12, 1.72, -0.25], max: [0.12, 2.05, 0.2], soft: 0.04 }, shimmer: 0.6 },
      { color: 0xff4a1a, hue: [0.0, 0.05], minSat: 0.55, minVal: 0.45, box: { min: [-0.3, 0.5, -0.6], max: [0.3, 0.8, -0.1], soft: 0.06 }, shimmer: 0.6 },
    ]);
    const bones = (names: string[]): THREE.Bone[] => names.map((b) => P.bone(b)).filter((b): b is THREE.Bone => !!b);
    const crest = bones(['crest_1', 'crest_2']);
    if (crest.length === 2) this.crest = new SpringTail(crest, { stiffness: [5, 3.5], drag: 0.3, gravity: 0.15, maxBend: 0.35, clearance: 0 });
    const tail = bones(['tail_1', 'tail_2']);
    if (tail.length === 2) this.tail = new SpringTail(tail, { stiffness: [4.5, 3], drag: 0.3, gravity: 0.3, maxBend: 0.3, clearance: 0.05 });
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.hits.length > 3 && this.alive) return this.hits[3].anchor.getWorldPosition(out);
    return this.localPoint(0, 1.0, 0.1, out);
  }

  /** 火矛出射点：喙尖 */
  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    this.beakAnchor.updateWorldMatrix(true, false);
    return this.beakAnchor.getWorldPosition(out);
  }

  /** 世界坐标点是否落在腿的命中范围里（腿受伤累计用） */
  hitOnLeg(p: THREE.Vector3): boolean {
    const r = LEG_R * this.sizeScale * 1.35;
    for (const h of this.legHits) {
      h.anchor.getWorldPosition(_t);
      if (_t.distanceToSquared(p) <= r * r) return true;
    }
    return false;
  }

  // ───────────── AI ─────────────

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    this.hurtSinceMove += r.dealt;
    const standing = this.state === 'perch' || this.state === 'cryBi' || this.state === 'cryFang' || this.state === 'recover' || this.state === 'land';
    const pt = r.request.point;
    if (standing && pt && !r.request.headshot && this.hitOnLeg(pt)) {
      this.legDamage += r.dealt;
      // 腿中枪：抽一下
      this.pCrouch = Math.min(1, this.pCrouch + 0.35);
    }
  }

  protected override ai(dt: number): void {
    this.fireAge += dt;
    if (this.moveRetry > 0) this.moveRetry -= dt;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
      case 'perch': {
        this.hold(this.perch);
        this.facePlayer(4, dt);
        this.glowTarget[0] = 0.25;
        if (this.legBroken()) break;
        if (this.wantsToMove(d) && this.moveRetry <= 0 && this.startMove()) break;
        if (this.cooldown <= 0 && this.sees && d >= FIRE_RANGE[0] && d <= FIRE_RANGE[1] && this.facingDot() > 0.94) {
          if (this.requestAttack('ranged', CRY_TIME + PECK_TIME + RECOVER_TIME + 0.5)) this.beginCry();
          else this.cooldown = this.ctx.rng.range(0.3, 0.7);
        }
        break;
      }
      case 'cryBi': {
        this.hold(this.perch);
        if (this.legBroken()) break;
        const t = clamp01(this.stateTime / this.cryTime);
        const locked = t >= TRACK_FRAC;
        if (!locked) this.facePlayer(5, dt);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.updateAim(locked, t);
        if (this.stateTime >= this.cryTime) this.fire();
        break;
      }
      case 'cryFang': {
        this.hold(this.perch);
        if (this.stateTime >= PECK_TIME) this.setState('recover');
        break;
      }
      case 'recover': {
        this.hold(this.perch);
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.3;
        if (this.legBroken()) break;
        if (this.stateTime >= RECOVER_TIME / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(CRY_COOLDOWN[0], CRY_COOLDOWN[1]);
          this.setState('perch');
        }
        break;
      }
      case 'takeoff': {
        this.hold(this.perch);
        this.faceTowards(this.glideTo, 8, dt);
        if (this.stateTime >= TAKEOFF_TIME) {
          this.setState('glide');
          this.ctx.audio.play('jump', { position: this.position, volume: 0.5, pitch: 1.4 });
          this.localPoint(0, 0.9, -0.1, _p);
          this.ctx.fx.burst(_p, INFERNO.ash, 8, 2.2, 0.5, 0.1, 2);
        }
        break;
      }
      case 'glide': {
        const u = clamp01(this.stateTime / this.glideTime);
        // 匀速略带缓入缓出的弧线：中段最高
        const s = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
        _p.lerpVectors(this.glideFrom, this.glideTo, s);
        _p.y += this.glideApex * Math.sin(Math.PI * s);
        this.glideVel.subVectors(_p, this.position).divideScalar(Math.max(dt, 1e-4));
        this.position.copy(_p);
        this.velocity.set(0, 0, 0);
        this.stopMoving();
        this.flyTargetY = _p.y;
        this.faceTowards(this.glideTo, 6, dt);
        if (u >= 1) {
          this.perch.copy(this.glideTo);
          this.perchHigh = this.glideToHigh;
          this.setState('land');
          this.ctx.audio.play('land', { position: this.position, volume: 0.5, pitch: 1.3 });
          _p.set(this.perch.x, this.perch.y + 0.05, this.perch.z);
          this.ctx.fx.burst(_p, INFERNO.spark, 10, 2.5, 0.4, 0.06, 3);
        }
        break;
      }
      case 'land': {
        this.hold(this.perch);
        this.facePlayer(7, dt);
        if (this.legBroken()) break;
        if (this.stateTime >= LAND_TIME) this.setState('perch');
        break;
      }
      case 'fall': {
        // 腿一软：从落脚点翻下来，抛物线落到柱脚
        const u = clamp01(this.stateTime / FALL_TIME);
        _p.lerpVectors(this.glideFrom, this.fallTo, u);
        _p.y = this.glideFrom.y + (this.fallTo.y - this.glideFrom.y) * u * u + 0.6 * Math.sin(Math.PI * u) * (1 - u);
        this.position.copy(_p);
        this.velocity.set(0, 0, 0);
        this.stopMoving();
        this.flyTargetY = _p.y;
        if (u >= 1) {
          this.perch.copy(this.fallTo);
          this.perchHigh = false;
          this.setState('downed');
          this.ctx.fx.shake(0.15, 0.2);
          this.ctx.audio.play('land', { position: this.position, volume: 0.8, pitch: 0.7 });
          _p.set(this.perch.x, this.perch.y + 0.1, this.perch.z);
          this.ctx.fx.burst(_p, INFERNO.ash, 14, 3, 0.6, 0.14, 2);
        }
        break;
      }
      case 'downed': {
        // 在地上扑腾：输出窗口
        this.hold(this.perch);
        this.glowTarget[0] = 0.15;
        if (this.stateTime >= DOWNED_TIME) {
          this.legDamage = 0;
          this.hurtSinceMove = 0;
          this.setState('perch');
          this.moveRetry = 0;
          if (!this.startMove()) this.moveRetry = 1;
        }
        break;
      }
      default:
        this.setState('perch');
    }
  }

  /** 钉在落脚点上（不悬停、不被推下柱顶）。被关卡瞬移走了（卡住后的回收点）：落到新位置脚下的地面上，再重新找高处 */
  private hold(p: THREE.Vector3): void {
    if (this.position.distanceToSquared(p) > 1.5 * 1.5) {
      const gy = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
      p.set(this.position.x, Number.isFinite(gy) ? gy : this.position.y, this.position.z);
      this.perchHigh = false;
      this.moveRetry = 0;
    }
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.stopMoving();
    this.flyTargetY = p.y;
  }

  /** 腿累计伤害到 25%：从落脚点摔下来（在地面上就地扑倒） */
  private legBroken(): boolean {
    if (this.legDamage < LEG_BREAK * this.maxHp) return false;
    this.legDamage = 0;
    this.clearAim();
    this.releaseAttack();
    this.glideFrom.copy(this.perch);
    this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.9, pitch: 2.6 });
    _p.copy(this.position);
    _p.y += 0.4 * this.sizeScale;
    this.ctx.fx.burst(_p, INFERNO.spark, 12, 3, 0.4, 0.07, 4);
    if (this.perchHigh && this.pickFallSpot()) {
      this.setState('fall');
    } else {
      this.fallTo.copy(this.perch);
      this.setState('downed');
    }
    this.cooldown = Math.max(this.cooldown, 1.0);
    return true;
  }

  /** 摔落点：柱脚外侧朝玩家一边、可走的地面；找不到就落在柱顶上 */
  private pickFallSpot(): boolean {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    let dx = pl.x - this.perch.x, dz = pl.z - this.perch.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    for (const r of [1.4, 2.2, 3.2]) {
      for (const off of [0, 0.6, -0.6, 1.3, -1.3]) {
        const c = Math.cos(off), sn = Math.sin(off);
        const x = this.perch.x + (dx * c - dz * sn) * r, z = this.perch.z + (dx * sn + dz * c) * r;
        const gy = ctx.world.groundHeight(x, z, this.perch.y - 0.4);
        if (!Number.isFinite(gy) || gy > this.perch.y - 0.8) continue;
        if (!ctx.nav.isWalkable(x, z)) continue;
        this.fallTo.set(x, gy, z);
        return true;
      }
    }
    return false;
  }

  /** 是否该换栖 */
  private wantsToMove(d: number): boolean {
    if (this.hurtSinceMove >= MOVE_HURT * this.maxHp) return true;
    const pl = this.ctx.player.position;
    if (this.perchHigh && Math.abs(pl.y - this.perch.y) < SAME_HEIGHT && d < SAME_HEIGHT_RANGE) return true;
    if (this.blindTime > BLIND_MOVE) return true;
    if (!this.perchHigh) return true;
    return d < PERCH_RANGE[0] * 0.55 || d > PERCH_RANGE[1] + 8;
  }

  /** 找下一个落脚点并起飞；找不到返回 false（过一会儿再找） */
  private startMove(): boolean {
    const found = this.findPerch(_q);
    if (found === 'none') {
      this.moveRetry = 1.5;
      return false;
    }
    // 已经站在地上、又只找到地面落脚点：不来回乱跳，等会儿再看
    if (found === 'ground' && !this.perchHigh && this.hurtSinceMove < MOVE_HURT * this.maxHp
      && this.blindTime <= BLIND_MOVE && this.distToPlayerXZ() >= GROUND_RANGE[0] * 0.6) {
      this.moveRetry = 2;
      return false;
    }
    this.glideFrom.copy(this.perch);
    this.glideTo.copy(_q);
    this.glideToHigh = found === 'high';
    const dist = Math.hypot(_q.x - this.perch.x, _q.z - this.perch.z);
    this.glideTime = clamp(dist / GLIDE_SPEED, GLIDE_TIME[0], GLIDE_TIME[1]);
    this.glideApex = 0.8 + 0.06 * dist + Math.max(0, _q.y - this.perch.y) * 0.25;
    claims.set(this.id, { ctx: this.ctx, owner: this, at: this.glideTo.clone() });
    this.hurtSinceMove = 0;
    this.releaseAttack();
    this.clearAim();
    this.cooldown = Math.max(this.cooldown, NO_FIRE_AFTER_MOVE);
    this.setState('takeoff');
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.35, pitch: 2.2 });
    return true;
  }

  /**
   * 落脚点：玩家 12–28 米内、顶面比玩家脚下高 3.2 米以上（找不到就 1.6 米以上）、顶上有落脚空间、看得到玩家、
   * 滑翔路线不被挡、不和别的毕方抢同一处；都没有就在玩家 14–24 米外找一块看得到玩家的地面。
   */
  findPerch(out: THREE.Vector3): 'high' | 'low' | 'ground' | 'none' {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const k = this.sizeScale;
    let best = Infinity, kind: 'high' | 'low' | 'none' = 'none';
    const boxes = ctx.world.query(pl.x - PERCH_RANGE[1], pl.z - PERCH_RANGE[1], pl.x + PERCH_RANGE[1], pl.z + PERCH_RANGE[1]);
    for (const b of boxes) {
      if (b.noRaycast || b.tag === 'floor') continue;
      const top = b.maxY;
      const rise = top - pl.y;
      if (rise < PERCH_LOW || rise > 14) continue;
      if (b.maxX - b.minX < PERCH_MIN_SIZE || b.maxZ - b.minZ < PERCH_MIN_SIZE) continue;
      // 落在顶面上离玩家最近的那一侧（站在边上俯视）
      const m = 0.3;
      const x = clamp(pl.x, b.minX + m, b.maxX - m), z = clamp(pl.z, b.minZ + m, b.maxZ - m);
      const d = Math.hypot(x - pl.x, z - pl.z);
      if (d < PERCH_RANGE[0] || d > PERCH_RANGE[1]) continue;
      if (Math.hypot(x - this.perch.x, z - this.perch.z) < 2 && Math.abs(top - this.perch.y) < 0.5) continue;
      if (this.claimed(x, z)) continue;
      if (ctx.world.groundHeight(x, z, top + 0.1) < top - 0.05) continue;
      if (ctx.world.overlaps(x - 0.25, top + 0.1, z - 0.25, x + 0.25, top + 2.0 * k, z + 0.25)) continue;
      _t.set(x, top + 1.4 * k, z);
      if (ctx.world.segmentBlocked(_t, ctx.player.eye)) continue;
      const high = rise >= PERCH_HIGH;
      // 打分：高处优先、离 20 米越近越好、离自己越近越好（滑翔短）
      const score = (high ? 0 : 20) + Math.abs(d - 20) * 0.6 + Math.hypot(x - this.position.x, z - this.position.z) * 0.15 + ctx.rng.range(0, 2);
      if (score >= best) continue;
      _u.set(x, top, z);
      if (!this.glidePathClear(this.perch, _u)) continue;
      best = score;
      out.copy(_u);
      kind = high ? 'high' : 'low';
    }
    if (kind !== 'none') return kind;
    for (let i = 0; i < 8; i++) {
      if (!ctx.nav.randomWalkable(pl, GROUND_RANGE[0], GROUND_RANGE[1], _u)) continue;
      const gy = ctx.world.groundHeight(_u.x, _u.z, Math.max(pl.y, _u.y) + 3);
      if (!Number.isFinite(gy)) continue;
      if (this.claimed(_u.x, _u.z)) continue;
      _t.set(_u.x, gy + 1.4 * k, _u.z);
      if (ctx.world.segmentBlocked(_t, ctx.player.eye)) continue;
      _u.y = gy;
      if (!this.glidePathClear(this.perch, _u)) continue;
      out.copy(_u);
      return 'ground';
    }
    return 'none';
  }

  private claimed(x: number, z: number): boolean {
    for (const [id, c] of claims) {
      if (!c.owner.alive || c.owner.removed) {
        claims.delete(id);
        continue;
      }
      if (id !== this.id && c.ctx === this.ctx && Math.hypot(c.at.x - x, c.at.z - z) < 2.5) return true;
    }
    return false;
  }

  /** 滑翔弧线（身体中心高度）逐段不被挡、离自己不超过 34 米 */
  private glidePathClear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist > GLIDE_MAX) return false;
    const apex = 0.8 + 0.06 * dist + Math.max(0, b.y - a.y) * 0.25;
    const lift = 0.9 * this.sizeScale;
    const n = 8;
    _p.set(a.x, a.y + lift, a.z);
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      _t.lerpVectors(a, b, s);
      _t.y += apex * Math.sin(Math.PI * s) + lift;
      if (this.ctx.world.segmentBlocked(_p, _t)) return false;
      _p.copy(_t);
    }
    return true;
  }

  private beginCry(): void {
    this.cryTime = this.windup(CRY_TIME, 0.55);
    this.setState('cryBi');
    this.aimLine?.release();
    this.aimLine = new AimLine(this.ctx);
    this.updateAim(false, 0);
    // 第一声「毕」
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.9, pitch: 1.9 });
    this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.7, pitch: 2.4 });
  }

  /** 瞄准：跟踪段对准玩家胸口（不带提前量），锁定后方向不变 */
  private updateAim(locked: boolean, t: number): void {
    const pl = this.ctx.player;
    this.getMuzzle(_p);
    if (!locked) {
      this.aimPoint.set(pl.position.x, pl.position.y + Math.min(1.1, pl.height * 0.6), pl.position.z);
      this.aimDir.subVectors(this.aimPoint, _p).normalize();
    }
    const hit = this.ctx.world.raycast(_p, this.aimDir, SPEAR_RANGE);
    _t.copy(_p).addScaledVector(this.aimDir, hit ? hit.distance : Math.min(SPEAR_RANGE, _p.distanceTo(this.aimPoint) + 3));
    this.aimLine?.update(_p, _t, t, locked, this.ctx.time.now);
  }

  private clearAim(): void {
    this.aimLine?.release();
    this.aimLine = null;
  }

  /** 第二声「方」：长喙一啄，射出火矛 */
  private fire(): void {
    this.getMuzzle(_p);
    const k = this.isElite ? 1.25 : 1;
    launchFireSpear(this.ctx, {
      from: _p, dir: this.aimDir, speed: SPEAR_SPEED, range: SPEAR_RANGE, radius: SPEAR_RADIUS * k,
      damage: this.def.damage * this.damageMult, source: this,
      ignite: { duration: IGNITE.duration, tick: IGNITE.tick * this.damageMult },
      fire: { radius: EMBER_FIRE.radius, duration: EMBER_FIRE.duration, tick: EMBER_FIRE.tick * this.damageMult }, scale: k,
    });
    this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.8, pitch: 1.6 });
    this.ctx.fx.burst(_p, INFERNO.core, 10, 2.5, 0.25, 0.08, 0);
    this.clearAim();
    this.fireAge = 0;
    this.setState('cryFang');
  }

  protected override cancelAttack(): void {
    this.clearAim();
    if (this.alive && (this.state === 'cryBi' || this.state === 'cryFang' || this.state === 'recover')) {
      this.setState('perch');
      this.rollCooldown(1.0, 1.8);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    claims.delete(this.id);
    this.clearAim();
    this.getBodyCenter(_p);
    this.ctx.fx.burst(_p, INFERNO.ember, 18, 4, 0.7, 0.1, -1);
    this.ctx.fx.burst(_p, INFERNO.smoke, 8, 1.4, 1.0, 0.3, -0.6);
  }

  protected override onDispose(): void {
    super.onDispose();
    claims.delete(this.id);
    this.clearAim();
  }

  protected override animateDeath(t: number): void {
    // 中弹后翻倒摔下（死亡期间受重力），收翅缩没
    this.model.rotation.z = t * 1.6;
    this.model.rotation.x = -t * 0.5;
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3)));
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const cry = st === 'cryBi' ? clamp01(this.stateTime / this.cryTime) : 0;
    const peck = st === 'cryFang' ? Math.sin(Math.PI * clamp01(this.stateTime / PECK_TIME)) : 0;
    const takeoff = st === 'takeoff' ? clamp01(this.stateTime / TAKEOFF_TIME) : 0;
    const landing = st === 'land' ? 1 - clamp01(this.stateTime / LAND_TIME) : 0;
    const glide = st === 'glide' ? 1 : 0;
    const downed = st === 'downed' || st === 'fall' ? 1 : 0;
    this.pCrouch = damp(this.pCrouch, Math.max(takeoff * 1.0, landing * 0.8), 14, dt);
    this.pGlide = damp(this.pGlide, glide, 8, dt);
    this.pS = damp(this.pS, Math.min(1, cry * 2.2), cry > 0 ? 12 : 8, dt);
    this.pPeck = damp(this.pPeck, peck, 30, dt);
    this.pDown = damp(this.pDown, downed, 6, dt);
    this.pFlap = damp(this.pFlap, Math.max(takeoff, landing, downed * 0.8, st === 'fall' ? 1 : 0), 10, dt);
    this.flapPhase += dt * (8 + 10 * this.pFlap);
    // 头盯住玩家（偏航限幅）；毕声时按瞄准方向俯仰
    const pl = this.ctx.player.position;
    const yaw = clamp(angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z)), -1.0, 1.0) * (1 - this.pGlide);
    this.pYaw = damp(this.pYaw, yaw, 6, dt);
    this.getMuzzle(_p);
    const pitch = st === 'cryBi' || st === 'cryFang'
      ? Math.atan2(this.aimDir.y, Math.hypot(this.aimDir.x, this.aimDir.z))
      : clamp(Math.atan2(pl.y + 1.2 - _p.y, Math.max(1, this.distToPlayerXZ())), -0.8, 0.5);
    this.pPitch = damp(this.pPitch, pitch * (1 - this.pDown), 6, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();

    // 炭火：平时常亮、毕声越蓄越亮、啄出瞬间最亮
    FROST_FX_TIME.value = this.ctx.time.now;
    tickInfernoFx(this.ctx.time.now);
    const flash = Math.exp(-this.fireAge * 7);
    const heat = Math.max(this.glowLevel[0], flash);
    const alive = this.alive ? 1 : 0.15;
    if (this.glow) {
      this.glow.strength[0].value = (0.8 + 1.8 * heat + 0.1 * Math.sin(this.age * 6)) * alive;
      this.glow.strength[1].value = (0.25 + 0.5 * this.pS) * alive;
      this.glow.strength[2].value = (0.18 + 0.4 * this.pGlide) * alive;
    }
    this.glowTarget[0] = Math.max(this.glowTarget[0], heat * 0.8);
  }

  /**
   * 美术骨骼（模型空间：X = 鸟的左侧，Y = 上，Z = 前；绕 +X 正转 = 前端下压）：
   * 颈 6 节分段弯成 S（毕声收颈蓄势）、啄出时整条颈前送；头盯住目标；单腿下蹲用两骨 IK 钉住脚掌；
   * 收拢的翅膀起飞 / 扑腾时小幅扇动、滑翔时半张（翅膀和身体是一张皮，张开角度限制在 0.6 弧度内）；冠羽、尾扇弹簧骨骼。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const crouch = this.pCrouch, glide = this.pGlide, S = this.pS, peck = this.pPeck, down = this.pDown;
    const breathe = Math.sin(t * 2.1);
    // 身体：站立时前倾、呼吸；下蹲压低；滑翔放平；倒地侧躺（tail 一侧着地）
    P.translate('hips', 0, -0.12 * crouch - 0.38 * down + 0.006 * breathe, 0);
    P.rotate('hips', AX, 0.08 * crouch + 0.35 * glide - 0.12 * S + 0.1 * peck - this.hurtKick * 0.25);
    P.rotate('hips', AZ, down * (1.05 + 0.12 * Math.sin(t * 9)) + (this.stunTime > 0 ? Math.sin(t * 8) * 0.12 : 0));
    // 颈：S 形起伏 + 毕声收颈 + 方声前送；头抵消身体前倾、盯住目标
    const idle = 0.05 * Math.sin(t * 1.3);
    P.rotate('neck_1', AX, 0.35 * S + 0.12 * peck + idle - 0.3 * glide);
    P.rotate('neck_2', AX, 0.2 * S + 0.12 * peck);
    P.rotate('neck_3', AX, -0.45 * S + 0.15 * peck - idle);
    P.rotate('neck_4', AX, -0.45 * S + 0.15 * peck);
    P.rotate('neck_5', AX, -0.25 * S + 0.12 * peck);
    P.rotate('neck_6', AX, 0.1 * peck);
    const yaw = this.pYaw;
    for (const b of ['neck_4', 'neck_5', 'neck_6'] as const) P.rotate(b, AY, yaw * 0.18);
    P.rotate('head', AY, yaw * 0.46);
    // 头的俯仰：抵消颈部弯曲后对准目标（正 pitch = 抬头）
    P.rotate('head', AX, 0.42 * S - this.pPitch * 0.8 + 0.1 * glide - 0.06 * idle);
    if (down > 0.02) P.rotate('neck_2', AZ, -0.5 * down * Math.sin(t * 7));
    // 翅膀：起飞 / 落地 / 倒地扑腾，滑翔半张
    const beat = Math.sin(this.flapPhase) * this.pFlap;
    const raise = clamp(0.45 * glide + 0.3 * this.pFlap + 0.28 * beat, -0.1, 0.62);
    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R';
      P.rotate(`wing_1_${side}`, AZ, s * raise);
      P.rotate(`wing_2_${side}`, AZ, s * raise * 0.45);
      P.rotate(`wing_3_${side}`, AZ, s * raise * 0.3);
      P.rotate(`wing_1_${side}`, AY, -s * 0.15 * glide);
    }
    // 腿：站立时 IK 钉住脚掌（下蹲时跗关节向后折）；滑翔时向后拖；倒地时乱蹬
    const toes = P.restPosition('toes');
    if (glide > 0.02 || down > 0.02) {
      P.rotate('thigh', AX, 0.9 * glide + 0.5 * down * Math.sin(t * 13));
      P.rotate('tarsus', AX, -0.7 * glide - 0.6 * down);
      P.rotate('toes', AX, 0.8 * glide + 0.4 * down);
    }
    if (toes && glide < 0.98 && down < 0.98) {
      _t.copy(toes);
      P.twoBoneIK('shin', 'tarsus', 'toes', _t, 1 - Math.max(glide, down));
    }
    // 冠羽、尾扇：弹簧（倒地 / 出生时从动画姿势重新起算）
    if (this.age < this.spawnDuration || this.state === 'fall') {
      this.crest?.reset();
      this.tail?.reset();
    } else {
      const g = this.onGround ? this.position.y : -Infinity;
      this.crest?.step(dt, this.position, -Infinity, this.sizeScale);
      this.tail?.step(dt, this.position, g, this.sizeScale);
    }
  }

  /** 白模动画：身体前倾、S 颈收放、单腿屈伸、翅膀扇动 */
  private poseBlockout(): void {
    const S = this.pS, peck = this.pPeck, crouch = this.pCrouch, glide = this.pGlide, down = this.pDown;
    this.bodyJ.position.y = 0.95 - 0.12 * crouch - 0.4 * down;
    this.bodyJ.rotation.set(0.35 * glide - 0.12 * S - this.hurtKick * 0.25, 0, down * 1.05);
    this.neckJ[0].rotation.set(0.35 + 0.35 * S + 0.15 * peck - 0.3 * glide, this.pYaw * 0.3, 0);
    this.neckJ[1].rotation.set(-0.45 - 0.5 * S + 0.2 * peck, this.pYaw * 0.3, 0);
    this.neckJ[2].rotation.set(-0.2 - 0.3 * S + 0.15 * peck, 0, 0);
    this.headJ.rotation.set(0.3 + 0.5 * S - this.pPitch * 0.8, this.pYaw * 0.4, 0);
    const raise = clamp(0.45 * glide + 0.3 * this.pFlap + 0.28 * Math.sin(this.flapPhase) * this.pFlap, -0.1, 0.62);
    for (const w of this.wingJ) w.g.rotation.set(0, 0, w.s * raise);
    this.shinJ.position.y = 0.72 - 0.12 * crouch;
    this.shinJ.rotation.x = -0.35 * crouch + 0.9 * glide;
    this.tarsusJ.rotation.x = 0.7 * crouch - 0.7 * glide;
  }
}
