/**
 * 马面狱卒（mamian，第三章 · 祝融火狱 / 炉宫的远程钩拉怪）：民间传说里的马头狱卒，如今是祝融火狱的看守。
 * 2.5 米高、佝偻细长的马头人身：长马脸、黑鬃、鼻孔和小眼透着炭火光，炭灰色的皮肤，黑短褂系朱红腰带，头戴两翅官帽；
 * 左小臂套着一只沉重的黑铁腕铐，铐上的锁芯透着熔岩橙光（弱点），铐上铆着的铁链缠了几圈、末端是带倒刺的勾魂钩。
 * **手从不握链**：勾魂索是从左腕铐里放出来的运行时程序化链节（甩圈、掷出、拖拽、横扫都是腕铐带着链子走）。
 * 动作：平时佝偻着在 10–20 米外踱步，马头盯着玩家，耳朵、鬃毛、下颌、衣摆和垂带随动作晃（弹簧骨骼）。
 *
 * - 勾魂索（有视线、冷却约 8 秒、拿到重击令牌）：左臂高举，链子从腕铐里放出来在头顶甩圈 0.9 秒，链节从腕铐往外逐节烧红、
 *   呼呼作响，锁芯越来越亮（前摇）；然后掷出钩子（飞行可见，20 米/秒，射程 22 米）。横移躲钩、断开视线或冲刺都能躲。
 * - 拖拽：钩中玩家后往它身前拖 1.2 秒（约 8 米，停在身前 2.4 米），拖的时候整条链子发红。
 *   拖拽中射中链子（链子中段，腕铐和玩家脚边那一小段不算）就把链子打断，马面踉跄一下、链子要等下一轮冷却；
 *   跳起或冲刺也能挣脱。拖的路线上有熔岩时，拖到熔岩岸边 1.2 米处就停（链子被扯住），不会把玩家直接拖进熔岩；
 *   中途链子被墙挡住、玩家被传送走也会脱钩。
 * - 锁链横扫：玩家在 4 米内（包括刚被拖过来）：链子贴地抡一圈（0.5 秒预警圈，起跳或退出 4.4 米能躲），伤害并把人甩开。
 * - 缴械：腕上锁芯累计吃到最大生命 30% 的伤害，锁芯炸开、铁链掉在地上，改用双拳近战（更快、更莽）；之后弱点换成马头。
 * - 弱点 = 左腕铁铐上的锁芯（甩链时最亮）。身体是挂在骨骼上的一串命中球。
 *
 * 状态机：move → spin → throw →（钩中）drag →（4 米内）sweepWind → sweep → recover → move
 *                          ↘（落空）reel → recover
 *         move →（4 米内）sweepWind → sweep → recover
 *         （锁芯碎）→ staggered → brawl → punchWind → punch → brawl
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import { FROST_FX_TIME, Spring, applyFrostGlow, hitAnchor, raycastSpheres, type FrostGlowHandle, type HitSphere } from '../fx/FrostSkirmishFx';
import { segmentHitsPlayer } from '../fx/FrostRangedFx';
import { SpringTail } from '../frost/PackMotion';
import { ChainLinks, INFERNO, chainShotHits, dropChain } from '../fx/InfernoRangedFx';

export const MAMIAN_DEF: ScaledEnemyDef = {
  id: 'mamian',
  name: '马面狱卒',
  // 美术按 2.1 米（官帽顶）制作，游戏里放大 1.2 倍：约 2.5 米高
  scale: 1.2,
  hp: 140,
  speed: 4,
  radius: 0.38,
  height: 1.95,
  // 勾魂钩命中的伤害（拖拽才是主要威胁）；横扫、重拳按倍率
  damage: 12,
  coins: [3, 6],
  essence: 1,
  // 弱点 = 左腕锁芯（放大前离地 1.165 米）
  headY: 1.165,
  headRadius: 0.1,
  knockbackResist: 0.45,
  color: 0xff5a2a,
};

/** 保持距离（米） */
const RANGE = [10, 20] as const;
/** 勾魂索：甩圈前摇、冷却、钩速、射程、判定半径、出手距离 */
const SPIN_TIME = 0.9;
const HOOK_COOLDOWN = [7.5, 8.5] as const;
const HOOK_SPEED = 20;
const HOOK_RANGE = 22;
const HOOK_RADIUS = 0.35;
const THROW_RANGE = [5, 21] as const;
/** 拖拽：时长、最远距离、速度、停在身前多远、熔岩岸边留多远 */
const DRAG_TIME = 1.2;
const DRAG_DIST = 8;
const DRAG_SPEED = 7.4;
const DRAG_STOP = 2.4;
const LAVA_MARGIN = 1.2;
const REEL_TIME = 0.45;
const RECOVER_TIME = 0.55;
const STAGGER_TIME = 0.8;
/** 锁链横扫：触发距离、伤害半径、预警、出手、伤害倍率、冷却 */
const SWEEP_TRIGGER = 4;
const SWEEP_RADIUS = 4.4;
const SWEEP_WIND = 0.5;
const SWEEP_TIME = 0.35;
const SWEEP_MULT = 1.6;
const SWEEP_COOLDOWN = [3, 4] as const;
/** 缴械：锁芯累计伤害比例；之后的重拳 */
const LOCK_BREAK = 0.3;
const BRAWL_SPEED = 1.4;
const PUNCH_RANGE = 2.1;
const PUNCH_WIND = 0.32;
const PUNCH_RECOVER = 0.38;
const PUNCH_MULT = 1.5;
const PUNCH_COOLDOWN = [0.5, 0.9] as const;
/** 链子被射中的判定半径（米）；链根（腕铐）和玩家脚边各留多少不算 */
const CHAIN_HIT_R = 0.24;
const CHAIN_SKIP_ROOT = 1.0;
const CHAIN_SKIP_TIP = 0.6;

/** 美术网格实测（模型空间、未缩放；Blender (x, y, z) → (x, z, -y)） */
const LOCK = [0.515, 1.165, 0.03] as const;
const CHAIN_ROOT = [0.52, 1.06, 0.05] as const;
const HITS = [
  { bone: 'head', at: [0, 1.82, 0.06], r: 0.17 },
  { bone: 'head', at: [0, 1.69, 0.19], r: 0.1 },
  { bone: 'neck', at: [0, 1.55, 0.0], r: 0.12 },
  { bone: 'chest', at: [0, 1.35, 0.0], r: 0.25 },
  { bone: 'spine', at: [0, 1.1, 0.0], r: 0.25 },
  { bone: 'hips', at: [0, 0.86, 0.0], r: 0.26 },
  { bone: 'thigh_L', at: [0.17, 0.62, 0.0], r: 0.17 },
  { bone: 'thigh_R', at: [-0.17, 0.62, 0.0], r: 0.17 },
  { bone: 'shin_L', at: [0.24, 0.28, -0.02], r: 0.12 },
  { bone: 'shin_R', at: [-0.24, 0.28, -0.02], r: 0.12 },
  { bone: 'arm_L', at: [0.32, 1.33, -0.03], r: 0.1 },
  { bone: 'arm_R', at: [-0.32, 1.33, -0.03], r: 0.1 },
  { bone: 'forearm_L', at: [0.43, 1.17, -0.01], r: 0.13 },
  { bone: 'forearm_R', at: [-0.44, 1.13, 0.0], r: 0.09 },
  { bone: 'hand_L', at: [0.54, 0.9, 0.03], r: 0.09 },
  { bone: 'hand_R', at: [-0.54, 0.9, 0.03], r: 0.09 },
] as const;
/** 步态 */
const GAIT_FREQ = [0.8, 1.7] as const;
const GAIT_STRIDE = 0.55;
const GAIT_LIFT = 0.12;
const GAIT_DUTY = 0.6;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const C = {
  skin: 0x5a5660, coat: 0x1e1c22, sash: 0xc0281e, pants: 0x3a2a24, wrap: 0xd8ccb0, mane: 0x18161c, cap: 0x141218,
  iron: 0x2e2a28, lock: 0xff8a20, lockHot: 0xfff0b0, eye: 0xff7a20, eyeHot: 0xffe0a0,
};

interface BlockLimb { upper: THREE.Group; lower: THREE.Group; side: number }

export class Mamian extends StandardEnemy {
  private readonly hits: HitSphere[] = [];
  private lockSphere: HitSphere | null = null;
  private headSphere: HitSphere | null = null;
  private lockAnchor!: THREE.Object3D;
  private rootAnchor!: THREE.Object3D;
  private headAnchorObj!: THREE.Object3D;
  private glow: FrostGlowHandle | null = null;
  private mane: SpringTail | null = null;
  private robeF: SpringTail | null = null;
  private robeB: SpringTail | null = null;
  private readonly earSpring = new Spring(40, 0.35);
  private readonly fingerAxes: Record<'L' | 'R', THREE.Vector3[]> = { L: [], R: [] };
  private readonly curl = { L: 0.25, R: 0.25 };
  private offFired: (() => void) | null = null;
  // 白模
  private torsoJ!: THREE.Group;
  private headJ!: THREE.Group;
  private readonly armsJ: BlockLimb[] = [];
  private readonly legsJ: BlockLimb[] = [];
  private lockGlow!: THREE.Mesh;

  // 铁链与钩
  private chain: ChainLinks | null = null;
  readonly hookPos = new THREE.Vector3();
  private readonly hookVel = new THREE.Vector3();
  private hookOut = 0;
  private spinPhase = 0;
  private spinTime = SPIN_TIME;
  /** 拖拽：起点、方向、长度；链子被打断 / 玩家挣脱 */
  readonly dragStart = new THREE.Vector3();
  readonly dragDir = new THREE.Vector3();
  dragLen = 0;
  /** 拖拽为什么结束（测试 / 调试）：'done' | 'cut' | 'escape' | 'lava' | 'blocked' | 'teleport' */
  dragEnd = '';
  chainCut = false;
  private readonly lastPlayer = new THREE.Vector3();
  private sweepCd = 0;
  private sweepWarn: (() => void) | null = null;
  private sweepHit = false;
  private sweepYaw = 0;
  /** 锁芯累计伤害、已缴械 */
  lockDamage = 0;
  disarmed = false;
  private pendingDisarm = false;
  private punchSide = 1;
  private punchHit = false;
  // 姿态
  private gait = 0;
  private pRaise = 0;
  private pThrow = 0;
  private pHaul = 0;
  private pSweep = 0;
  private pPunch = 0;
  private pLean = 0;
  private pYaw = 0;
  private pPitch = 0;
  private snort = 0;
  private prevFacing = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, MAMIAN_DEF, opts);
    this.walkScale = 0.6;
    this.stepRate = 1.0;
    this.accel = 16;
    this.cooldown = ctx.rng.range(2.0, 3.5);
    this.setState('move');
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin, { rough: 0.8 }), coat = flat(C.coat, { rough: 0.85 }), sash = flat(C.sash, { rough: 0.7 });
    const pants = flat(C.pants), wrap = flat(C.wrap), mane = flat(C.mane), cap = flat(C.cap), iron = flat(C.iron, { metal: 0.7, rough: 0.5 });
    // 腿：大腿（灯笼裤）、小腿（绑腿）、草鞋
    for (const s of [1, -1]) {
      const upper = joint(root, s * 0.12, 0.94, 0);
      part(upper, Geo.cyl(0.11, 0.13, 0.45, 7, 'top'), pants, 0.04 * s, 0, 0);
      const lower = joint(upper, s * 0.09, -0.45, 0);
      part(lower, Geo.cyl(0.06, 0.075, 0.38, 6, 'top'), wrap, 0, 0, 0);
      part(lower, Geo.box(0.12, 0.05, 0.28), pants, 0, -0.4, 0.06);
      this.legsJ.push({ upper, lower, side: s });
    }
    // 躯干：短褂、朱红腰带、下摆
    const torso = joint(root, 0, 0.95, 0);
    this.torsoJ = torso;
    part(torso, Geo.box(0.42, 0.55, 0.26, 'bottom'), coat, 0, 0.05, 0);
    part(torso, Geo.box(0.44, 0.1, 0.28), sash, 0, 0.12, 0);
    part(torso, Geo.box(0.1, 0.55, 0.03), sash, 0, -0.2, 0.15);
    part(torso, Geo.box(0.46, 0.3, 0.3), coat, 0, -0.05, 0);
    // 马头：长脸前伸、鬃毛、官帽
    const head = joint(torso, 0, 0.66, 0);
    this.headJ = head;
    part(head, Geo.cyl(0.07, 0.09, 0.14, 6, 'bottom'), skin, 0, 0, 0);
    part(head, Geo.box(0.16, 0.2, 0.22), skin, 0, 0.2, 0.02);
    part(head, Geo.box(0.12, 0.12, 0.24), skin, 0, 0.12, 0.2, 0.3, 0, 0);
    part(head, Geo.box(0.06, 0.3, 0.12), mane, 0, 0.1, -0.14, 0.35, 0, 0);
    part(head, Geo.box(0.14, 0.14, 0.12), cap, 0, 0.36, 0.0);
    part(head, Geo.box(0.42, 0.03, 0.04), cap, 0, 0.32, -0.02);
    for (const s of [1, -1]) {
      part(head, Geo.cone(0.025, 0.12, 4, 'bottom'), skin, s * 0.05, 0.28, 0.06, -0.2, 0, -s * 0.2);
      this.glowPart(head, Geo.ico(0.018, 0), C.eye, C.eyeHot, s * 0.07, 0.22, 0.12, 1);
    }
    // 双臂：左小臂套铁铐（锁芯发光）
    for (const s of [1, -1]) {
      const upper = joint(torso, s * 0.25, 0.5, 0);
      part(upper, Geo.cyl(0.05, 0.065, 0.28, 6, 'top'), skin, 0, 0, 0);
      const lower = joint(upper, 0, -0.28, 0);
      part(lower, Geo.cyl(0.04, 0.05, 0.24, 6, 'top'), skin, 0, 0, 0);
      part(lower, Geo.box(0.09, 0.16, 0.05), skin, 0, -0.32, 0);
      if (s > 0) {
        part(lower, Geo.cyl(0.1, 0.1, 0.24, 8, 'top'), iron, 0, -0.01, 0);
        this.lockGlow = this.glowPart(lower, Geo.ico(0.06, 1), C.lock, C.lockHot, 0.1, -0.1, 0, 0);
        this.lockAnchor = this.lockGlow;
        this.rootAnchor = joint(lower, 0.08, -0.22, 0.03);
      }
      this.armsJ.push({ upper, lower, side: s });
    }
    this.headAnchorObj = joint(head, 0, 0.22, 0.05);
    this.setHeadAnchor(this.lockGlow, 0, 0, 0);
    return root;
  }

  // ───────────── 美术身体 ─────────────

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    if (n) {
      this.torsoJ.visible = false;
      for (const l of this.legsJ) l.upper.visible = false;
    }
    const classic: Record<string, THREE.Object3D> = {
      head: this.headJ, neck: this.headJ, chest: this.torsoJ, spine: this.torsoJ, hips: this.torsoJ,
      thigh_L: this.legsJ[0].upper, thigh_R: this.legsJ[1].upper, shin_L: this.legsJ[0].lower, shin_R: this.legsJ[1].lower,
      arm_L: this.armsJ[0].upper, arm_R: this.armsJ[1].upper, forearm_L: this.armsJ[0].lower, forearm_R: this.armsJ[1].lower,
      hand_L: this.armsJ[0].lower, hand_R: this.armsJ[1].lower,
    };
    const at = (bone: string): THREE.Object3D => P?.bone(bone) ?? classic[bone] ?? this.torsoJ;
    if (P) {
      this.lockAnchor = hitAnchor(at('lock'), host, LOCK[0], LOCK[1], LOCK[2]);
      this.rootAnchor = hitAnchor(P.bone('chain_L') ?? at('forearm_L'), host, CHAIN_ROOT[0], CHAIN_ROOT[1], CHAIN_ROOT[2]);
      this.headAnchorObj = hitAnchor(at('head'), host, 0, 1.82, 0.06);
    }
    this.lockSphere = { anchor: this.lockAnchor, r: MAMIAN_DEF.headRadius!, head: true };
    this.hits.push(this.lockSphere);
    for (const h of HITS) {
      const s: HitSphere = { anchor: hitAnchor(at(h.bone), host, h.at[0], h.at[1], h.at[2]), r: h.r, head: false };
      if (!this.headSphere) this.headSphere = s;
      this.hits.push(s);
    }
    this.setHeadAnchor(this.lockAnchor, 0, 0, 0);
    this.chain = new ChainLinks(this.ctx.stageGroup, 170, this.sizeScale);
    // 链子被射中：玩家开枪时检查瞄准射线（只在拖拽中）
    this.offFired = this.ctx.events?.on?.('weapon:fired', () => this.onPlayerFired()) ?? null;
    if (!n || !P) return;
    // 锁芯（弱点）常亮、甩链时更亮；眼睛、鼻孔的炭火光；腕铐上的熔岩裂纹
    this.glow = applyFrostGlow(n.materials[0], 'mamian', [
      { color: 0xffa040, hue: [0.09, 0.07], minSat: 0.4, minVal: 0.5, sphere: { center: [LOCK[0], LOCK[1], LOCK[2]], radius: 0.09 }, shimmer: 0.4 },
      { color: 0xff8a2a, hue: [0.08, 0.07], minSat: 0.45, minVal: 0.5, box: { min: [-0.12, 1.6, 0.0], max: [0.12, 1.95, 0.3], soft: 0.03 }, shimmer: 0.3 },
      { color: 0xff6a1a, hue: [0.07, 0.07], minSat: 0.5, minVal: 0.4, box: { min: [0.3, 0.98, -0.17], max: [0.62, 1.33, 0.16], soft: 0.03 }, shimmer: 0.6 },
    ]);
    if (n.glowShell) n.glowShell.color.setHex(0xffb060);
    const bones = (names: string[]): THREE.Bone[] => names.map((b) => P.bone(b)).filter((b): b is THREE.Bone => !!b);
    const mane = bones(['mane_1', 'mane_2', 'mane_3']);
    // 鬃毛内层贴着外衣后领：只能小幅摆（审稿：大角度会把后领拉成尖刺）
    if (mane.length === 3) this.mane = new SpringTail(mane, { stiffness: [6, 4.5, 3.5], drag: 0.35, gravity: 0.2, maxBend: 0.12, clearance: 0 });
    const f = bones(['robe_F1', 'robe_F2']);
    if (f.length === 2) this.robeF = new SpringTail(f, { stiffness: [5, 3.5], drag: 0.3, gravity: 0.35, maxBend: 0.22, clearance: 0.05 });
    const b = bones(['robe_B1', 'robe_B2']);
    if (b.length === 2) this.robeB = new SpringTail(b, { stiffness: [5, 3.5], drag: 0.3, gravity: 0.35, maxBend: 0.22, clearance: 0.05 });
    // 每根手指的弯曲轴（绑定姿势下：手指方向 × 掌心朝向）。左手掌心朝 −X（身体），右手朝 +X
    for (const side of ['L', 'R'] as const) {
      const m = side === 'L' ? 1 : -1;
      for (const fi of FINGERS) {
        const a = P.restPosition(`${fi}_1_${side}`), c = P.restPosition(`${fi}_2_${side}`);
        const ax = new THREE.Vector3(0, 0, -m);
        if (a && c) {
          const d = _v.subVectors(c, a).normalize();
          const palm = fi === 'thumb' ? _w.set(-m * 0.4, 0, -1).normalize() : _w.set(-m, 0, 0);
          ax.crossVectors(d, palm).normalize();
        }
        this.fingerAxes[side].push(ax);
      }
    }
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.hits.length > 4 && this.alive) return this.hits[4].anchor.getWorldPosition(out);
    return this.localPoint(0, 1.3, 0, out);
  }

  /** 链根：左腕铐上放链的位置（世界坐标） */
  chainRoot(out: THREE.Vector3): THREE.Vector3 {
    this.rootAnchor.updateWorldMatrix(true, false);
    return this.rootAnchor.getWorldPosition(out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.chainRoot(out);
  }

  // ───────────── AI ─────────────

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    if (!this.disarmed && r.request.headshot) {
      this.lockDamage += r.dealt;
      if (this.lockDamage >= LOCK_BREAK * this.maxHp) this.pendingDisarm = true;
    }
  }

  protected override ai(dt: number): void {
    if (this.sweepCd > 0) this.sweepCd -= dt;
    if (this.pendingDisarm && !this.disarmed) {
      this.disarm();
      return;
    }
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0.15;
        if (this.disarmed) {
          this.setState('brawl');
          break;
        }
        if (this.sweepCd <= 0 && d < SWEEP_TRIGGER * this.reach() && this.verticalReach(1.5)) {
          if (this.requestAttack('melee', SWEEP_WIND + SWEEP_TIME + 0.4)) {
            this.beginSweep();
            break;
          }
        }
        if (!this.sees && this.seekSight(RANGE[0] - 3, RANGE[1], this.speed, 1.9 * this.sizeScale)) {
          this.faceMovement(5, dt);
          break;
        }
        this.keepRange(RANGE[0], RANGE[1], this.speed, 0.45);
        if (Math.hypot(this.desiredX, this.desiredZ) > 0.5 && d > RANGE[1] + 2) this.faceMovement(4, dt);
        else this.facePlayer(3, dt);
        if (this.cooldown <= 0 && this.sees && d >= THROW_RANGE[0] && d <= THROW_RANGE[1] && this.verticalReach(5)) {
          if (this.requestAttack('heavy', SPIN_TIME + 3.2)) this.beginSpin();
          else this.cooldown = this.ctx.rng.range(0.4, 0.9);
        }
        break;
      }
      case 'spin': {
        this.stopMoving();
        this.facePlayer(4, dt);
        const t = clamp01(this.stateTime / this.spinTime);
        this.glowTarget[0] = 0.35 + 0.65 * t;
        this.spinPhase += dt * (9 + 12 * t);
        if (this.stateTime >= this.spinTime) this.throwHook();
        break;
      }
      case 'throw': {
        this.stopMoving();
        this.facePlayer(1.5, dt);
        this.flyHook(dt);
        break;
      }
      case 'drag': {
        this.stopMoving();
        this.facePlayer(6, dt);
        this.glowTarget[0] = 1;
        this.updateDrag();
        break;
      }
      case 'reel': {
        this.stopMoving();
        this.facePlayer(3, dt);
        this.chainRoot(_p);
        const k = clamp01(dt / Math.max(1e-3, REEL_TIME - this.stateTime + dt));
        this.hookPos.lerp(_p, k);
        if (this.stateTime >= REEL_TIME) {
          this.hookOut = 0;
          this.setState('recover');
        }
        break;
      }
      case 'staggered': {
        this.stopMoving();
        this.glowTarget[0] = 0;
        if (this.stateTime >= STAGGER_TIME * (this.disarmed ? 1.25 : 1)) this.setState(this.disarmed ? 'brawl' : 'recover');
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.facePlayer(3, dt);
        this.glowTarget[0] = 0.2;
        if (this.stateTime >= RECOVER_TIME / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('move');
        }
        break;
      }
      case 'sweepWind': {
        this.stopMoving();
        this.facePlayer(3, dt);
        this.spinPhase += dt * 14;
        if (this.stateTime >= SWEEP_WIND) {
          this.setState('sweep');
          this.sweepHit = false;
          this.sweepYaw = this.facing;
          this.ctx.audio.play('blade_swing', { position: this.position, volume: 1, pitch: 0.55 });
        }
        break;
      }
      case 'sweep': {
        this.stopMoving();
        // 抡一圈：身体跟着链子转一整圈
        const u = clamp01(this.stateTime / SWEEP_TIME);
        this.facing = this.sweepYaw + u * Math.PI * 2;
        if (!this.sweepHit) this.sweepStrike();
        if (u >= 1) {
          this.facing = this.sweepYaw;
          this.sweepCd = this.ctx.rng.range(SWEEP_COOLDOWN[0], SWEEP_COOLDOWN[1]);
          this.setState('recover');
        }
        break;
      }
      case 'brawl': {
        this.glowTarget[0] = 0.1;
        if (d <= PUNCH_RANGE * this.reach() && this.verticalReach(1.4)) {
          this.stopMoving();
          this.facePlayer(8, dt);
          if (this.cooldown <= 0 && this.facingDot() > 0.7) {
            if (this.requestAttack('melee', PUNCH_WIND + PUNCH_RECOVER + 0.2)) {
              this.setState('punchWind');
              this.punchSide = -this.punchSide;
              this.punchHit = false;
              this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.6, pitch: 1.3 });
            } else this.cooldown = 0.3;
          }
        } else {
          this.approachPlayer(this.speed * BRAWL_SPEED, PUNCH_RANGE * 0.85 * this.reach());
          this.faceMovement(8, dt);
        }
        break;
      }
      case 'punchWind': {
        this.facePlayer(6, dt);
        // 前冲半步
        const fwd = this.stateTime > PUNCH_WIND * 0.5 ? 3 : 0;
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), fwd);
        if (this.stateTime >= this.windup(PUNCH_WIND, 0.22)) {
          this.setState('punch');
          if (this.melee(PUNCH_RANGE * this.reach() + 0.3, this.def.damage * PUNCH_MULT, 0.4)) {
            this.punchHit = true;
            _v.set(Math.sin(this.facing) * 4, 1.5, Math.cos(this.facing) * 4);
            this.ctx.player.applyImpulse(_v);
            this.ctx.fx.shake(0.2, 0.15);
          }
        }
        break;
      }
      case 'punch': {
        this.stopMoving();
        if (this.stateTime >= PUNCH_RECOVER / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(PUNCH_COOLDOWN[0], PUNCH_COOLDOWN[1]);
          this.setState('brawl');
        }
        break;
      }
      default:
        this.setState(this.disarmed ? 'brawl' : 'move');
    }
  }

  /** 精英体型更大，触发距离也略大 */
  private reach(): number {
    return this.isElite ? 1.15 : 1;
  }

  private beginSpin(): void {
    this.spinTime = this.windup(SPIN_TIME, 0.6);
    this.spinPhase = 0;
    this.snort = 1;
    this.setState('spin');
    this.chainRoot(this.hookPos);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 0.75 });
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.7, pitch: 0.7 });
  }

  /** 甩圈时钩头的位置：腕铐上方一圈（半径 1 米，越转越快） */
  private spinHookPoint(out: THREE.Vector3): THREE.Vector3 {
    const k = this.sizeScale;
    this.chainRoot(out);
    const a = this.spinPhase;
    out.x += Math.cos(a) * 1.0 * k;
    out.z += Math.sin(a) * 1.0 * k;
    out.y += 0.35 * k;
    return out;
  }

  /** 掷出：从甩圈的位置朝玩家胸口（带一点提前量）飞出 */
  private throwHook(): void {
    const pl = this.ctx.player;
    this.spinHookPoint(this.hookPos);
    this.playerChest(_t);
    const tt = this.hookPos.distanceTo(_t) / HOOK_SPEED;
    _t.addScaledVector(pl.velocity, tt * 0.25);
    _t.y -= 0.15;
    this.hookVel.subVectors(_t, this.hookPos).normalize().multiplyScalar(HOOK_SPEED);
    this.hookOut = 0;
    // 掷出就进入冷却（钩中 / 落空都一样，约 8 秒一轮）
    this.rollCooldown(HOOK_COOLDOWN[0], HOOK_COOLDOWN[1]);
    this.setState('throw');
    this.ctx.audio.play('skill_throw', { position: this.position, volume: 0.9, pitch: 0.75 });
  }

  /** 钩头飞行：先撞墙就落空；碰到玩家（冲刺中不算）就钩住 */
  private flyHook(dt: number): void {
    const ctx = this.ctx;
    const step = HOOK_SPEED * dt;
    _p.copy(this.hookPos);
    _v.copy(this.hookVel).normalize();
    const hit = ctx.world.raycast(_p, _v, step);
    _q.copy(_p).addScaledVector(_v, hit ? hit.distance : step);
    const pl = ctx.player;
    if (pl.alive && !pl.isDashing && segmentHitsPlayer(ctx, _p, _q, HOOK_RADIUS * (this.isElite ? 1.15 : 1))) {
      this.hookPos.copy(_q);
      this.startDrag();
      return;
    }
    this.hookPos.copy(_q);
    this.hookOut += step;
    if (hit || this.hookOut >= HOOK_RANGE) {
      if (hit) {
        ctx.fx.burst(_q, INFERNO.spark, 10, 3.5, 0.3, 0.05, 6);
        ctx.audio.play('hit_armor', { position: _q, volume: 0.6, pitch: 0.7 });
      }
      this.setState('reel');
      ctx.audio.play('blade_recall', { position: this.position, volume: 0.6, pitch: 0.7 });
    }
  }

  /**
   * 钩中：伤害一次，规划拖拽——方向朝马面身前 2.4 米处，最远 8 米；路线上有熔岩就停在熔岩岸边 1.2 米处
   * （按导航网格的熔岩格二分查找）；能拖的距离太短就只扯一下、不拖。
   */
  private startDrag(): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    ctx.combat.damagePlayer(this.def.damage * this.damageMult, 'none', this, this.hookPos);
    ctx.fx.burst(this.hookPos, INFERNO.ember, 12, 3, 0.4, 0.08, 2);
    ctx.audio.play('hit_armor', { position: this.hookPos, volume: 0.9, pitch: 0.6 });
    const k = this.sizeScale / MAMIAN_DEF.scale!;
    const stop = DRAG_STOP * k;
    _t.set(this.position.x - pl.position.x, 0, this.position.z - pl.position.z);
    const dist = _t.length();
    this.dragStart.copy(pl.position);
    if (dist > 1e-3) this.dragDir.copy(_t).multiplyScalar(1 / dist);
    else this.dragDir.set(Math.sin(this.facing), 0, Math.cos(this.facing)).negate();
    let len = Math.min(DRAG_DIST, Math.max(0, dist - stop));
    const lava = ctx.nav?.crossesLava?.bind(ctx.nav);
    if (lava && len > 0) {
      _q.copy(pl.position).addScaledVector(this.dragDir, len);
      if (lava(pl.position, _q, 0.3)) {
        let lo = 0, hi = len;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          _q.copy(pl.position).addScaledVector(this.dragDir, mid);
          if (lava(pl.position, _q, 0.3)) hi = mid;
          else lo = mid;
        }
        len = Math.max(0, lo - LAVA_MARGIN);
      }
    }
    this.dragLen = len;
    this.dragEnd = '';
    this.chainCut = false;
    this.lastPlayer.copy(pl.position);
    this.setState('drag');
    ctx.audio.play('enemy_charge', { position: this.position, volume: 0.9, pitch: 0.55 });
    if (len < 0.6) {
      // 扯不动（身前就是熔岩 / 已经很近）：只扯一下
      this.endDrag(len <= 0 && dist > stop + 0.5 ? 'lava' : 'done');
    }
  }

  /**
   * 拖拽中：每帧把玩家的水平速度改成「朝马面 7.4 米/秒」（只用冲量接口，不改玩家代码）；
   * 拖满距离 / 1.2 秒、链子被射断、玩家跳起或冲刺、链子被墙挡住、前方就是熔岩、玩家被传送走（踩熔岩被托回）时结束。
   */
  private updateDrag(): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    if (!pl.alive) return this.endDrag('done');
    if (this.chainCut) return this.endDrag('cut');
    if (pl.isDashing || (!pl.onGround && pl.velocity.y > 1.5)) return this.endDrag('escape');
    if (pl.position.distanceTo(this.lastPlayer) > 3) return this.endDrag('teleport');
    this.lastPlayer.copy(pl.position);
    this.chainRoot(_p);
    this.playerChest(_q);
    _q.y -= 0.25;
    this.hookPos.copy(_q);
    if (ctx.world.segmentBlocked(_p, _q)) return this.endDrag('blocked');
    const moved = (pl.position.x - this.dragStart.x) * this.dragDir.x + (pl.position.z - this.dragStart.z) * this.dragDir.z;
    if (moved >= this.dragLen - 0.08 || this.stateTime >= DRAG_TIME) return this.endDrag('done');
    _t.copy(pl.position).addScaledVector(this.dragDir, 0.9);
    if (ctx.nav?.crossesLava?.(pl.position, _t, 0.3)) return this.endDrag('lava');
    // 快到终点时减速（不冲过头）
    const left = this.dragLen - moved;
    const speed = Math.min(DRAG_SPEED, 2 + left * 5);
    _v.set(this.dragDir.x * speed - pl.velocity.x, 0, this.dragDir.z * speed - pl.velocity.z);
    pl.applyImpulse(_v);
  }

  private endDrag(reason: string): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.dragEnd = reason;
    if (reason !== 'escape' && reason !== 'teleport' && pl.alive) {
      // 松开：把拖拽的速度收掉大半（停在身前，不滑过去）
      const along = pl.velocity.x * this.dragDir.x + pl.velocity.z * this.dragDir.z;
      if (along > 0.5) pl.applyImpulse(_v.set(-this.dragDir.x * along * 0.8, 0, -this.dragDir.z * along * 0.8));
    }
    if (reason === 'cut') {
      // 链子被打断：断链落地，马面踉跄
      this.chainRoot(_p);
      dropChain(ctx, this.chainPoints(_p, this.hookPos, 0.1), this.sizeScale);
      ctx.audio.play('pipa_snap', { position: this.hookPos, volume: 1, pitch: 0.6 });
      ctx.fx.burst(this.hookPos, INFERNO.spark, 16, 5, 0.4, 0.06, 6);
      this.hookOut = 0;
      this.releaseAttack();
      this.rollCooldown(HOOK_COOLDOWN[0], HOOK_COOLDOWN[1]);
      this.setState('staggered');
      return;
    }
    this.rollCooldown(HOOK_COOLDOWN[0], HOOK_COOLDOWN[1]);
    this.releaseAttack();
    // 刚被拖过来、就在 4 米内：马上接锁链横扫
    if (!this.disarmed && reason === 'done' && this.distToPlayerXZ() < SWEEP_TRIGGER * this.reach() && this.requestAttack('melee', SWEEP_WIND + SWEEP_TIME + 0.4)) {
      this.hookOut = 0;
      this.beginSweep();
      return;
    }
    this.setState('reel');
    ctx.audio.play('blade_recall', { position: this.position, volume: 0.6, pitch: 0.7 });
  }

  /** 玩家开枪：拖拽中瞄准射线打到链子中段就把链子打断 */
  onPlayerFired(): void {
    if (!this.alive || this.state !== 'drag' || this.chainCut) return;
    const pl = this.ctx.player;
    if (!pl.alive || typeof pl.getAimDirection !== 'function') return;
    pl.getAimDirection(_w);
    this.chainRoot(_p);
    const along = chainShotHits(this.ctx, pl.eye, _w, 80, _p, this.hookPos, CHAIN_HIT_R * this.sizeScale / MAMIAN_DEF.scale!, CHAIN_SKIP_ROOT, CHAIN_SKIP_TIP);
    if (along < 0) return;
    // 链子几乎顺着视线：这一枪其实打在马面身上（锁芯、手臂）时不算打链子——链子上的那一点要比打中马面的地方近 1.5 米以上
    const out = { distance: 0, headshot: false };
    if (this.raycastHit(pl.eye, _w, 80, out) && along > out.distance - 1.5) return;
    this.chainCut = true;
  }

  private beginSweep(): void {
    this.setState('sweepWind');
    this.sweepHit = false;
    this.chainRoot(this.hookPos);
    const r = SWEEP_RADIUS * this.sizeScale / MAMIAN_DEF.scale!;
    _p.set(this.position.x, this.position.y, this.position.z);
    this.sweepWarn?.();
    this.sweepWarn = this.ctx.fx.groundWarning(_p, r, SWEEP_WIND, INFERNO.warn);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 0.9 });
  }

  /** 横扫判定（出手第一帧）：4.4 米内、没跳起来（脚离地 < 0.9 米）的玩家被抡中、甩开 */
  private sweepStrike(): void {
    this.sweepHit = true;
    this.sweepWarn = null;
    const pl = this.ctx.player;
    const r = SWEEP_RADIUS * this.sizeScale / MAMIAN_DEF.scale!;
    const dx = pl.position.x - this.position.x, dz = pl.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    this.ctx.fx.ring(_p.set(this.position.x, this.position.y + 0.1, this.position.z), r, INFERNO.ember, 0.35);
    if (!pl.alive || d > r + pl.radius * 0.5) return;
    const feet = pl.position.y - this.position.y;
    if (feet > 0.9 || feet < -1.2) return;
    this.ctx.combat.damagePlayer(this.def.damage * SWEEP_MULT * this.damageMult, 'none', this, this.position);
    const inv = d > 1e-3 ? 1 / d : 0;
    pl.applyImpulse(_v.set(dx * inv * 7, 2.5, dz * inv * 7));
    this.ctx.fx.shake(0.3, 0.2);
  }

  /** 缴械：锁芯炸开，铁链掉在地上；之后改用双拳，弱点换成马头 */
  private disarm(): void {
    const ctx = this.ctx;
    this.pendingDisarm = false;
    this.disarmed = true;
    this.sweepWarn?.();
    this.sweepWarn = null;
    this.releaseAttack();
    this.lockAnchor.getWorldPosition(_p);
    ctx.fx.burst(_p, INFERNO.hot, 24, 5, 0.5, 0.1, 2);
    ctx.fx.burst(_p, INFERNO.core, 10, 3, 0.3, 0.14, 0);
    ctx.fx.shake(0.2, 0.2);
    ctx.audio.play('shield_break', { position: _p, volume: 1, pitch: 0.8 });
    ctx.audio.play('pipa_snap', { position: _p, volume: 0.9, pitch: 0.5 });
    // 铁链从腕铐上掉下来
    this.chainRoot(_p);
    _q.copy(_p);
    _q.y = this.position.y;
    _q.x += Math.sin(this.facing + 1.2) * 1.5;
    _q.z += Math.cos(this.facing + 1.2) * 1.5;
    dropChain(ctx, this.chainPoints(_p, _q, 0.4), this.sizeScale, 4);
    this.hookOut = 0;
    if (this.lockSphere) {
      this.lockSphere.head = false;
      this.lockSphere.r = 0.06;
    }
    if (this.headSphere) this.headSphere.head = true;
    this.setHeadAnchor(this.headAnchorObj, 0, 0, 0);
    this.speedMult *= 1.2;
    this.cooldown = 0.6;
    this.setState('staggered');
  }

  protected override cancelAttack(): void {
    this.sweepWarn?.();
    this.sweepWarn = null;
    if (this.state === 'drag') this.dragEnd = 'cancel';
    if (this.alive && ['spin', 'throw', 'drag', 'reel', 'sweepWind', 'sweep', 'punchWind', 'punch'].includes(this.state)) {
      this.hookOut = 0;
      this.setState(this.disarmed ? 'brawl' : 'move');
      this.rollCooldown(1.5, 2.5);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.sweepWarn?.();
    this.sweepWarn = null;
    if (this.chain?.visible) {
      this.chainRoot(_p);
      dropChain(this.ctx, this.chainPoints(_p, this.hookPos, 0.2), this.sizeScale, 2.5);
    }
    if (this.chain) this.chain.visible = false;
    this.getBodyCenter(_p);
    this.ctx.fx.burst(_p, INFERNO.ember, 16, 3.5, 0.7, 0.1, -1);
    this.ctx.fx.burst(_p, INFERNO.smoke, 8, 1.2, 1.0, 0.35, -0.6);
  }

  protected override onDispose(): void {
    super.onDispose();
    this.offFired?.();
    this.offFired = null;
    this.chain?.dispose();
    this.chain = null;
  }

  // ───────────── 铁链外观 ─────────────

  /** 链根 → 钩头的折线（中段下垂 sag 米，乘体型） */
  private chainPoints(root: THREE.Vector3, tip: THREE.Vector3, sag: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const n = 8;
    const s = sag * this.sizeScale * Math.min(1, root.distanceTo(tip) / 4);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = new THREE.Vector3().lerpVectors(root, tip, u);
      p.y -= s * Math.sin(Math.PI * u);
      pts.push(p);
    }
    return pts;
  }

  private updateChain(): void {
    const ch = this.chain;
    if (!ch) return;
    const st = this.state;
    const show = this.alive && !this.disarmed && (st === 'spin' || st === 'throw' || st === 'drag' || st === 'reel' || st === 'sweepWind' || st === 'sweep');
    ch.visible = show;
    if (!show) return;
    const root = this.chainRoot(_p);
    const k = this.sizeScale;
    let pts: THREE.Vector3[];
    let heat: (u: number) => number;
    let hookHeat = 0;
    if (st === 'spin' || st === 'sweepWind') {
      const t = st === 'spin' ? clamp01(this.stateTime / this.spinTime) : clamp01(this.stateTime / SWEEP_WIND);
      if (st === 'spin') this.spinHookPoint(this.hookPos);
      else {
        // 贴地小圈：腕铐外侧、腰高，越转越快
        const a = this.spinPhase;
        this.hookPos.set(root.x + Math.cos(a) * 1.1 * k, this.position.y + 0.6 * k, root.z + Math.sin(a) * 1.1 * k);
      }
      _q.lerpVectors(root, this.hookPos, 0.5);
      _q.y += 0.12 * k;
      pts = [root.clone(), _q.clone(), this.hookPos.clone()];
      // 从腕铐往外逐节烧红
      heat = (u) => clamp01((t * 1.4 - u) * 3);
      hookHeat = t;
    } else if (st === 'sweep') {
      const r = SWEEP_RADIUS * k / MAMIAN_DEF.scale!;
      const a = this.facing + Math.PI / 2;
      this.hookPos.set(this.position.x + Math.sin(a) * r, this.position.y + 0.55 * k, this.position.z + Math.cos(a) * r);
      pts = [root.clone(), this.hookPos.clone()];
      heat = () => 1;
      hookHeat = 1;
    } else {
      const taut = st === 'drag' ? 1 : st === 'throw' ? 0.6 : 0.2;
      pts = this.chainPoints(root, this.hookPos, 0.35 * (1 - taut));
      heat = st === 'drag' ? (u) => 0.75 + 0.25 * Math.sin(this.age * 30 - u * 12) : (u) => 0.5 * (1 - u);
      hookHeat = st === 'drag' ? 1 : 0.4;
    }
    ch.layout(pts, heat, hookHeat);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const spinT = st === 'spin' ? clamp01(this.stateTime / this.spinTime) : 0;
    const throwing = st === 'throw' ? 1 : 0;
    const haul = st === 'drag' ? 1 : 0;
    const sweep = st === 'sweepWind' || st === 'sweep' ? 1 : 0;
    const punch = st === 'punchWind' ? -0.35 : st === 'punch' ? 1 : 0;
    this.pRaise = damp(this.pRaise, spinT > 0 ? 1 : 0, 10, dt);
    this.pThrow = damp(this.pThrow, throwing || (st === 'reel' ? 0.5 : 0), 18, dt);
    this.pHaul = damp(this.pHaul, haul, 10, dt);
    this.pSweep = damp(this.pSweep, sweep, 12, dt);
    this.pPunch = damp(this.pPunch, punch, punch > 0 ? 28 : 12, dt);
    this.pLean = damp(this.pLean, -0.22 * haul + 0.12 * Math.max(0, punch) + 0.06 * spinT, 8, dt);
    this.snort = Math.max(0, this.snort - dt * 2.5);
    const pl = this.ctx.player.position;
    const yaw = clamp(angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z)), -1.0, 1.0) * (1 - this.pSweep);
    this.pYaw = damp(this.pYaw, yaw, 6, dt);
    const pitch = clamp(Math.atan2(pl.y + 1.4 - (this.position.y + 2.1 * this.sizeScale), Math.max(1, this.distToPlayerXZ())), -0.5, 0.4);
    this.pPitch = damp(this.pPitch, pitch, 5, dt);
    // 手：甩链时左手张开、重拳握拳、平时半握
    const fist = this.disarmed ? 1 : 0.3;
    this.curl.L = damp(this.curl.L, st === 'throw' ? 0 : this.pRaise > 0.5 ? 0.15 : fist, 10, dt);
    this.curl.R = damp(this.curl.R, this.disarmed || haul ? 1 : fist, 10, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();
    this.updateChain();

    // 锁芯：平时微亮，甩链越转越亮、拖拽最亮；缴械后熄灭。眼 / 鼻孔：怒时更亮
    FROST_FX_TIME.value = this.ctx.time.now;
    const lockHeat = this.disarmed || !this.alive ? 0 : Math.max(this.glowLevel[0], 0.3);
    if (this.glow) {
      this.glow.strength[0].value = this.disarmed ? 0 : 0.6 + 1.8 * lockHeat + 0.1 * Math.sin(this.age * 5);
      this.glow.strength[1].value = (0.5 + 0.6 * Math.max(this.pRaise, this.disarmed ? 0.8 : 0)) * (this.alive ? 1 : 0.2);
      this.glow.strength[2].value = this.disarmed ? 0.05 : 0.15 + 0.9 * Math.max(this.pRaise, this.pHaul);
    }
    const shell = this.nativeBody?.glowShell;
    if (shell) shell.opacity = this.disarmed ? 0 : clamp01(0.2 + 0.08 * Math.sin(this.age * 4) + 0.7 * lockHeat * lockHeat);
    this.lockGlow.visible = !this.disarmed;
    this.glowTarget[0] = Math.max(this.glowTarget[0], 0);
  }

  /**
   * 美术骨骼（模型空间：X = 马面的左侧，Y = 上，Z = 前；绕 +X 正转 = 向前 / 向下压，绕 +Z 正转 = 左侧往上抬）。
   * 腿：步态相位 + 两骨 IK（触地段脚往后扫、腾空段抬脚前摆）；躯干佝偻、拖拽时后仰；
   * 左臂：甩链高举过头（腕铐在头顶画圈）→ 掷出时向前甩直 → 拖拽时屈肘后拉；横扫时平举；右臂摆臂 / 平衡 / 重拳。
   * 手指各两节按弯曲轴握拳 / 张开；下颌、耳、鬃毛、衣摆垂带是弹簧骨骼（幅度受限，见 creature_rigs/SK_Enemy_Mamian.json）。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P: NativePose = n.pose;
    P.reset();
    const t = this.age;
    const yawRate = dt > 0 ? Math.abs(angleDiff(this.prevFacing, this.facing)) / dt : 0;
    this.prevFacing = this.facing;
    const sp = Math.max(Math.hypot(this.velocity.x, this.velocity.z), this.pSweep > 0.5 ? 0 : Math.min(1.0, yawRate * 0.4));
    const sn = clamp01(sp / Math.max(1, this.speed * 1.3));
    const move = clamp01(sp / 0.6);
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    const ph = this.gait * Math.PI * 2;
    const k = this.sizeScale;
    const stride = Math.min(GAIT_STRIDE, (sp * GAIT_DUTY) / (freq * k)) * move;
    const breathe = Math.sin(t * 1.9);
    const raise = this.pRaise, thr = this.pThrow, haul = this.pHaul, sweep = this.pSweep, punch = this.pPunch;

    // 身体：佝偻前倾、步子起伏；拖拽后仰；受击后仰；眩晕摇晃
    P.translate('hips', 0, Math.abs(Math.sin(ph)) * 0.02 * move - 0.05 * haul - 0.03 * sweep + breathe * 0.004, 0);
    P.rotate('hips', AX, this.pLean - this.hurtKick * 0.3);
    P.rotate('hips', AY, Math.sin(ph) * 0.06 * move);
    P.rotate('spine', AX, 0.06 + 0.02 * breathe);
    P.rotate('chest', AX, 0.1 - 0.15 * raise + 0.08 * thr);
    P.rotate('chest', AY, 0.25 * thr - 0.2 * haul + 0.3 * sweep + 0.3 * punch * this.punchSide);
    if (this.stunTime > 0 || this.state === 'staggered') P.rotate('hips', AZ, Math.sin(t * 8) * 0.1);
    // 头：盯住玩家；甩链时打响鼻（下颌一张）、耳朵向后贴
    P.rotate('neck', AX, -0.12 - this.pLean * 0.4);
    P.rotate('neck', AY, this.pYaw * 0.4);
    P.rotate('head', AY, this.pYaw * 0.5);
    P.rotate('head', AX, -this.pPitch * 0.7 + 0.06 * Math.sin(t * 1.1) - this.hurtKick * 0.25);
    P.rotate('jaw', AX, 0.1 * this.snort * (0.6 + 0.4 * Math.sin(t * 40)));
    const flick = this.earSpring.step(clamp((this.pYaw - this.earSpring.x) * 3, -0.4, 0.4), dt);
    const back = 0.45 * Math.max(raise, haul, sweep, this.disarmed ? 0.6 : 0);
    P.rotate('ear_L', AX, -back);
    P.rotate('ear_R', AX, -back);
    P.rotate('ear_L', AY, 0.2 * flick + 0.08 * Math.sin(t * 2.7));
    P.rotate('ear_R', AY, 0.2 * flick - 0.08 * Math.sin(t * 2.3 + 1));

    // 左臂（腕铐）：平时随步子摆；甩链高举（腕铐在头顶小圈晃）；掷出向前甩直；拖拽屈肘后拉；横扫平举
    const swing = Math.sin(ph) * 0.3 * move;
    const whirl = raise * 0.18;
    P.rotate('arm_L', AZ, 0.08 + 2.25 * raise * (1 - thr) + 1.35 * sweep + 0.25 * thr + Math.sin(this.spinPhase) * whirl);
    P.rotate('arm_L', AX, -swing * (1 - raise) - 1.45 * thr + 0.55 * haul + Math.cos(this.spinPhase) * whirl - 0.3 * sweep);
    P.rotate('forearm_L', AZ, 0.35 * raise * (1 - thr));
    P.rotate('forearm_L', AX, -0.25 - 0.15 * thr - 1.25 * haul);
    // 右臂：平衡 / 摆臂 / 重拳（左右交替：punchSide > 0 时右拳）
    const rp = this.punchSide > 0 ? punch : 0, lp = this.punchSide < 0 ? punch : 0;
    P.rotate('arm_R', AX, swing - 1.5 * rp - 0.4 * haul);
    P.rotate('arm_R', AZ, -0.1 - 0.35 * haul - 0.3 * raise);
    P.rotate('forearm_R', AX, -0.3 - 0.9 * Math.max(0, -rp) + 0.2 * rp);
    if (this.disarmed) {
      P.rotate('arm_L', AX, -1.5 * lp - 0.35);
      P.rotate('forearm_L', AX, -0.9 * Math.max(0, -lp) - 0.6);
      P.rotate('forearm_R', AX, -0.6);
    }
    // 手指：两节按弯曲轴握 / 张
    for (const side of ['L', 'R'] as const) {
      const axes = this.fingerAxes[side];
      const c = this.curl[side];
      for (let f = 0; f < FINGERS.length && f < axes.length; f++) {
        const thumb = f === 0;
        P.rotate(`${FINGERS[f]}_1_${side}`, axes[f], c * (thumb ? 0.5 : 1.0));
        P.rotate(`${FINGERS[f]}_2_${side}`, axes[f], c * (thumb ? 0.55 : 1.15));
      }
    }

    // 腿：IK（拖拽 / 横扫时扎马步：脚稍外撇、膝弯）
    const brace = Math.max(haul, sweep * 0.7);
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      const rest = P.restPosition(`foot_${side}`);
      if (!rest) continue;
      const u = (this.gait + i * 0.5) % 1;
      let dz = 0, dy = 0;
      if (move > 0.01) {
        if (u < GAIT_DUTY) dz = stride * (0.5 - u / GAIT_DUTY);
        else {
          const s = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
          dz = stride * (-0.5 + s * s * (3 - 2 * s));
          dy = Math.sin(s * Math.PI) * GAIT_LIFT * move;
        }
      }
      const m = side === 'L' ? 1 : -1;
      _t.set(rest.x + m * 0.06 * brace, rest.y + dy, rest.z + dz + (side === 'L' ? 0.12 : -0.08) * brace);
      P.rotate(`thigh_${side}`, AX, -0.08);
      P.rotate(`shin_${side}`, AX, 0.16);
      P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _t, 1);
      // 衣摆侧片随大腿摆
      P.rotate(`robe_${side}1`, AX, -dz * 0.6);
    }
    // 弹簧骨骼：鬃毛、前后垂带
    if (this.age < this.spawnDuration) {
      this.mane?.reset();
      this.robeF?.reset();
      this.robeB?.reset();
    } else {
      const g = this.onGround ? this.position.y : -Infinity;
      this.mane?.step(dt, this.position, -Infinity, k);
      this.robeF?.step(dt, this.position, g, k);
      this.robeB?.step(dt, this.position, g, k);
    }
  }

  /** 白模动画：走路摆臂摆腿；甩链左臂高举、掷出前甩、拖拽后拉、横扫平举 */
  private poseBlockout(): void {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const amp = clamp(sp / Math.max(1, this.speed), 0, 1.2);
    const ph = this.walkPhase * 1.4;
    const raise = this.pRaise, thr = this.pThrow, haul = this.pHaul, sweep = this.pSweep, punch = this.pPunch;
    this.torsoJ.rotation.set(0.1 + this.pLean - this.hurtKick * 0.3, 0.25 * thr - 0.2 * haul, this.stunTime > 0 ? Math.sin(this.age * 8) * 0.1 : 0);
    this.headJ.rotation.set(-this.pPitch * 0.7, this.pYaw * 0.8, 0);
    const [L, R] = this.armsJ;
    L.upper.rotation.set(-1.45 * thr + 0.55 * haul - Math.sin(ph) * 0.3 * amp * (1 - raise), 0, 2.4 * raise * (1 - thr) + 1.4 * sweep + 0.1);
    L.lower.rotation.set(-0.25 - 1.25 * haul, 0, 0.35 * raise);
    R.upper.rotation.set(Math.sin(ph) * 0.3 * amp - 1.5 * (this.punchSide > 0 ? punch : 0), 0, -0.1 - 0.35 * haul);
    R.lower.rotation.set(-0.3, 0, 0);
    for (const l of this.legsJ) {
      const s = Math.sin(ph + (l.side > 0 ? 0 : Math.PI));
      l.upper.rotation.x = s * 0.45 * amp;
      l.lower.rotation.x = Math.max(0, -s) * 0.6 * amp;
    }
  }
}
