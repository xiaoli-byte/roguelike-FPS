/**
 * 冰甲旋龟（xuangui，第二章 · 昆仑雪墟的坦克）：《山海经》的旋龟——鸟首蛇尾的黑龟，被昆仑的寒气冻成一座会走的冰堡。
 * 冰川色的冰壳盖在青铜龟甲上，壳缘一圈短冰刺；鹰喙鸟头在前，尾巴是一条眼口发青紫光的蛇（弱点在身后）；
 * 壳顶一个散热孔，旋转之后过热、喷青紫霜气（第二个弱点）。格挡靠身体本身（正面鸟喙和冰壳），不持盾。
 * 用户要求坦克「有压迫感」：美术按 1.7 米高、3.5 米长制作，游戏里整体放大 1.5 倍（约 2.6 米高、5.3 米长），
 * 血厚甲厚、不吃击退，与三彩镇墓兽同档（docs/art/enemy-roster-v2.md「冰甲旋龟 · 旋壳冲撞」）。
 *
 * - 冰壳推进：慢慢爬近（每秒约 1.2 弧度转身），正面来的伤害只吃 15%（冰壳上迸冰屑、脆响）；绕到身后打蛇尾。
 * - 冰喙猛啄：贴脸时缩颈 0.45 秒，鸟头猛啄出去（正面别贴脸）。
 * - 蛇尾反咬：玩家在身后约 4 米内时，蛇尾高高扬起 0.4 秒（蛇头眼口亮起），然后往后一口咬下——绕后要打了就走。
 * - 缩壳旋转：8–25 米、看得见玩家、冷却好时缩头缩脚缩尾，壳缘冰刺亮起 0.8 秒（脚下预警圈、朝玩家一条直线预警）；
 *   随后整只换成单独建模的旋壳（SM_EnemyPart_XuanGuiShell，挂点 shell），像锯片一样高速旋转滑向玩家，
 *   只做很弱的追踪，撞墙按墙面法线反弹，最多反弹 2 次（第 3 次撞墙停下）；身后每隔一段留下一块 3 秒的滑冰带
 *   （玩家踩上去移动打滑）。撞到玩家重伤加击飞（同一次旋转里 0.8 秒内不会重复命中）。旋转中只吃 40% 伤害。
 * - 过热翻倒：旋转结束后侧翻在地、壳顶对着玩家，散热孔喷青紫霜气 2.4 秒，四脚乱蹬、翻不过身——
 *   这段时间不格挡，弱点判定移到散热孔上：**最好的输出窗口**。之后用 0.6 秒翻回来。
 * - 开场就转：出生后第一次旋转的冷却只有 1–1.8 秒，远远地先来一记招牌旋壳。
 * - 近身也会转：玩家一直贴在 8 米内（啄了 2 次，或贴身超过 4 秒）、旋转冷却好时，
 *   旋龟喷着鼻息往后退 0.9 秒（拉开 2 米左右，撞墙就地开转），再照常缩壳预警 0.8 秒、旋转——贴脸卡位不再安全。
 * - 精英：旋转更快、多反弹一次。
 *
 * 状态机：advance → peckWindup → peck → advance
 *         advance → biteWindup → bite → advance
 *         advance → retract → spin → overheat → rightself → advance
 *         advance → backoff → retract → spin → …（近身旋转）
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { FROST, createGlowDisc, dropIcePatch, frostVapour, iceCrack, iceShards, type GlowDisc } from '../fx/FrostTankFx';

export const XUANGUI_DEF: ScaledEnemyDef = {
  id: 'xuangui',
  name: '冰甲旋龟',
  hp: 560,
  armor: 220,
  speed: 1.8,
  radius: 1.0,
  height: 1.2,
  damage: 36,
  coins: [8, 12],
  essence: 3,
  // 弱点 = 身后的蛇头（静止时离地约 1.5 米，模型单位）；过热翻倒时判定移到壳顶散热孔
  headY: 1.5,
  headRadius: 0.32,
  knockbackResist: 1,
  color: 0x8fd8ff,
  // 美术按 1.7 米高、3.5 米长制作，游戏里放大到约 2.6 米高：命中盒、弱点、特效一起放大
  scale: 1.5,
};

/** 正面格挡：来自正面这个夹角（余弦）以内的伤害乘以 GUARD_FACTOR；旋转时全方位乘以 SPIN_ARMOR */
const GUARD_FACTOR = 0.15;
const GUARD_COS = 0.3;
const SPIN_ARMOR = 0.4;
/** 推进时转身的角速度（弧度/秒） */
const TURN_RATE = 1.2;
/** 冰喙猛啄：触发距离、命中距离（米，从中心算）、前摇、伤害倍率、击退 */
const PECK_RANGE = 3.4;
const PECK_REACH = 3.9;
const PECK_WINDUP = 0.45;
const PECK_MULT = 1.0;
const PECK_KNOCK = 8;
/** 蛇尾反咬：玩家在身后（朝向余弦小于 BITE_BEHIND）这个距离内；前摇、伤害倍率、冷却 */
const BITE_RANGE = 4.2;
const BITE_REACH = 4.7;
const BITE_BEHIND = -0.35;
const BITE_WINDUP = 0.4;
const BITE_MULT = 0.7;
const BITE_COOLDOWN = [1.8, 2.6] as const;
/** 缩壳旋转：触发距离（米）、缩壳前摇、冷却、速度（起转 → 满速）、追踪角速度、最长时间、反弹次数 */
const SPIN_RANGE = [8, 25] as const;
const SPIN_WINDUP = 0.8;
const SPIN_COOLDOWN = [6, 8] as const;
/** 出生后第一次旋转的冷却（秒）：开场就亮招牌（以 1.8 米/秒爬近，13 米外出生的旋龟此时还在 8 米外） */
const SPIN_FIRST_CD = [1, 1.8] as const;
/** 近身旋转：在 8 米内啄满这么多次，或累计贴身这么久（秒），旋转冷却好时先后退再转 */
const CLOSE_SPIN_PECKS = 2;
const CLOSE_SPIN_TIME = 4;
/** 后退：最长时间、速度（米/秒）、退到这个距离就提前开始缩壳 */
const BACKOFF_TIME = 0.9;
const BACKOFF_SPEED = 2.6;
const BACKOFF_RANGE = 6;
const SPIN_START = 6;
const SPIN_SPEED = 12.5;
const SPIN_RAMP = 22;
const SPIN_HOMING = 0.35;
const SPIN_MAX_TIME = 3.6;
const SPIN_BOUNCES = 2;
const SPIN_MULT = 1.25;
const SPIN_KNOCK = 11;
/** 同一次旋转里两次命中玩家的最短间隔（秒） */
const SPIN_HIT_GAP = 0.8;
/** 旋壳自转角速度（弧度/秒） */
const SPIN_RATE = 14;
/** 滑冰带：每滑过多远留一块、半径（模型单位，乘体型）、持续 */
const ICE_STEP = 1.3;
const ICE_RADIUS = 0.75;
const ICE_TIME = 3;
/** 过热翻倒、翻回来的时长；侧翻角度（弧度） */
const OVERHEAT_TIME = 2.4;
const RIGHTSELF_TIME = 0.6;
const FLIP_ROLL = 1.1;
/** 侧翻支点（模型空间：右侧壳缘贴地处），壳顶转向生物右侧（-X）；翻倒时让 -X 朝向玩家 */
const FLIP_PIVOT = new THREE.Vector3(-1.05, 0.25, 0);
/** 弱点位置（模型空间，未缩放；按美术网格实测）：蛇头中心、壳顶散热孔中心 */
const SNAKE_POINT = new THREE.Vector3(0, 1.52, -1.6);
const VENT_POINT = new THREE.Vector3(0, 1.63, 0.25);
/** 散热孔辉光半径（模型单位） */
const VENT_RADIUS = 0.3;
/** 脚步震屏：这个距离（米）内能感觉到 */
const STEP_SHAKE_RANGE = 20;

/**
 * 四足步态（美术骨骼）：龟走得很慢，对角小跑、触地比例高；一步里脚掌相对身体最多扫过多远（模型局部单位）、抬脚高度。
 * 腿：上段、下段、末端骨骼名，对角相位。
 */
const GAIT_FREQ = 0.9;
const GAIT_DUTY = 0.7;
const GAIT_SWEEP = 0.38;
const GAIT_LIFT = 0.12;
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, side: 1, phase: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, side: -1, phase: 0.5 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, side: 1, phase: 0.5 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, side: -1, phase: 0 },
] as const;
const TAIL = ['tail_1', 'tail_2', 'tail_3', 'tail_4'] as const;

const C = {
  shell: 0x9fd6f0, scute: 0x3f6f62, skin: 0x2e3a4a, belly: 0xd8dde0, beak: 0xc9b98a, claw: 0xe8f4ff,
  eye: 0x7a6aff, eyeHot: 0xd8c8ff, snake: 0x6a5aff, snakeHot: 0xf0e0ff, spike: 0xd8f2ff, spikeHot: 0xffffff,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** 每个 GameContext 只注册一次全局伤害修正（正面格挡 / 旋壳） */
const guardInstalled = new WeakSet<object>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  front: boolean;
  side: number;
}

export class XuanGui extends StandardEnemy {
  // 白模骨架（?classic 与资产缺失时的兜底）
  private body!: THREE.Group;
  private head!: THREE.Group;
  private tail: THREE.Group[] = [];
  private legs: Leg[] = [];
  /** 旋壳挂点（美术旋壳挂在这里；白模是一个扁球壳 + 一圈冰刺） */
  private shellSocket!: THREE.Group;
  /** 弱点锚点：蛇头、壳顶散热孔（美术身体时换成骨骼上的锚点） */
  private snakeAnchor!: THREE.Object3D;
  private ventAnchor!: THREE.Object3D;
  private ventGlow: GlowDisc | null = null;

  private windTime = SPIN_WINDUP;
  private spinCd: number;
  private biteCd = 1;
  private spinYaw = 0;
  private spinDist = 0;
  private iceAt = 0;
  private bounces = 0;
  private lastBounce = -1;
  private lastSpinHit = -99;
  private spinAngle = 0;
  private ring: GroundDecal | null = null;
  private lane: GroundDecal | null = null;
  private blockFxAt = 0;
  private alerted = false;
  /** 近身压力：上次旋转以来啄了几次、在 8 米内贴了多久 */
  private closePecks = 0;
  private closeTime = 0;
  /** 最近一次啄 / 咬是否打中了玩家（测试与调试用） */
  struck = false;
  // 平滑后的姿态：缩壳、侧翻、啄、扬尾、过热
  private pRetract = 0;
  private pFlip = 0;
  private pPeck = 0;
  private pRear = 0;
  private pBite = 0;
  private pHeat = 0;
  private gait = 0;
  private readonly legU = [0, 0, 0, 0];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, XUANGUI_DEF, opts);
    this.walkScale = 0.4;
    this.stepRate = 0.9;
    this.spinCd = ctx.rng.range(SPIN_FIRST_CD[0], SPIN_FIRST_CD[1]);
    installGuard(ctx);
  }

  /** 缩壳旋转中（整只换成旋壳） */
  get spinning(): boolean {
    return this.state === 'spin';
  }

  /** 冰壳格挡中（推进、各种前摇）；旋转、过热、翻身不挡 */
  get guarding(): boolean {
    return this.alive && this.stunTime <= 0
      && (this.state === 'advance' || this.state === 'peckWindup' || this.state === 'peck' || this.state === 'biteWindup'
        || this.state === 'bite' || this.state === 'retract' || this.state === 'backoff' || this.state === 'idle');
  }

  /** 过热翻倒（散热孔是弱点） */
  get overheated(): boolean {
    return this.state === 'overheat';
  }

  /** 这次伤害的倍率：正面被冰壳挡住时大幅减伤（冰屑脆响）；旋转中的旋壳全方位减伤 */
  guardFactor(req: DamageRequest): number {
    if (req.source === 'status' || !this.alive) return 1;
    if (this.spinning) return SPIN_ARMOR;
    if (!this.guarding) return 1;
    if (req.direction) _v.set(-req.direction.x, 0, -req.direction.z);
    else _v.set(this.ctx.player.position.x - this.position.x, 0, this.ctx.player.position.z - this.position.z);
    const len = _v.length();
    if (len < 1e-4) return 1;
    _f.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (_v.dot(_f) / len < GUARD_COS) return 1;
    const now = this.ctx.time.now;
    if (now - this.blockFxAt > 0.07) {
      this.blockFxAt = now;
      this.localPoint((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.9, 1.3, _p);
      this.ctx.fx.burst(_p, FROST.ice, 6, 5, 0.3, 0.07 * this.sizeScale, 8);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.35, pitch: 2.4 });
    }
    return GUARD_FACTOR;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const shell = flat(C.shell, { rough: 0.3 }), scute = flat(C.scute, { rough: 0.5 }), skin = flat(C.skin, { rough: 0.7 });
    const belly = flat(C.belly, { rough: 0.6 }), beak = flat(C.beak, { rough: 0.4 }), claw = flat(C.claw, { rough: 0.3 });
    // 身体：高拱的冰壳盖在青铜龟甲上，下面一块白色腹甲（身体中心离地约 0.95）
    const body = joint(root, 0, 0.95, -0.1);
    this.body = body;
    part(body, Geo.ico(1, 2), scute, 0, 0.05, 0).scale.set(1.0, 0.62, 1.32);
    part(body, Geo.ico(1, 2), shell, 0, 0.15, 0).scale.set(0.86, 0.66, 1.1);
    part(body, Geo.box(1.3, 0.22, 2.1), belly, 0, -0.5, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      part(body, Geo.cone(0.12, 0.42, 5, 'bottom'), flat(C.spike, { rough: 0.25 }),
        Math.sin(a) * 0.98, -0.05, Math.cos(a) * 1.3, Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
    }
    // 壳顶散热孔（第二个弱点）：平时是一圈暗色的孔
    part(body, Geo.cyl(0.32, 0.36, 0.1, 10), skin, 0, 0.8, 0.35);
    this.ventAnchor = joint(body, 0, 0.84, 0.35);
    // 鹰喙鸟头
    const head = joint(body, 0, 0, 1.2);
    this.head = head;
    part(head, Geo.box(0.6, 0.55, 0.55), shell, 0, 0.05, 0.2);
    part(head, Geo.cone(0.16, 0.42, 5), beak, 0, -0.05, 0.6, Math.PI / 2, 0, 0);
    for (const s of [1, -1]) this.glowPart(head, Geo.ico(0.06, 1), C.eye, C.eyeHot, s * 0.2, 0.15, 0.42);
    // 四条象腿（三爪）
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(body, s * 0.6, -0.2, front ? 0.75 : -0.5);
        part(upper, Geo.cyl(0.24, 0.22, 0.45, 8, 'top'), skin, 0, 0, 0);
        const lower = joint(upper, 0, -0.45, 0);
        part(lower, Geo.cyl(0.26, 0.28, 0.32, 8, 'top'), skin, 0, 0, 0);
        for (const k of [-1, 0, 1]) part(lower, Geo.cone(0.06, 0.16, 5), claw, k * 0.12, -0.3, 0.24, Math.PI / 2, 0, 0);
        this.legs.push({ upper, lower, front, side: s });
      }
    }
    // 蛇尾：四节往后上翘，末端一个蛇头（弱点，眼口发光）
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 4; i++) {
      const seg = joint(parent, 0, i === 0 ? -0.15 : 0.08, i === 0 ? -0.95 : -0.25);
      seg.rotation.x = i === 0 ? 0 : 0.45;
      part(seg, Geo.cyl(0.13 - i * 0.015, 0.15 - i * 0.015, 0.3, 6), skin, 0, 0, -0.12, Math.PI / 2, 0, 0);
      this.tail.push(seg);
      parent = seg;
    }
    const snake = joint(parent, 0, 0.12, -0.2);
    part(snake, Geo.box(0.26, 0.2, 0.36), skin, 0, 0, -0.1);
    this.glowPart(snake, Geo.box(0.2, 0.06, 0.2), C.snake, C.snakeHot, 0, -0.05, -0.18, 2);
    for (const s of [1, -1]) this.glowPart(snake, Geo.ico(0.045, 1), C.snake, C.snakeHot, s * 0.1, 0.06, -0.12, 2);
    this.snakeAnchor = snake;
    this.setHeadAnchor(snake, 0, 0, -0.08);
    // 旋壳挂点：缩壳旋转时整只换成它（美术 SM_EnemyPart_XuanGuiShell，原点在壳底中心、贴地）
    const sock = joint(root, 0, 0, 0);
    sock.name = 'shell';
    part(sock, Geo.ico(1, 2), shell, 0, 0.7, 0).scale.set(1.22, 0.7, 1.25);
    const rim = joint(sock, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      part(rim, Geo.cone(0.13, 0.45, 5, 'bottom'), flat(C.spike, { rough: 0.25 }),
        Math.sin(a) * 1.15, 0.45, Math.cos(a) * 1.18, Math.cos(a) * 1.1, 0, -Math.sin(a) * 1.1);
    }
    sock.visible = false;
    this.shellSocket = sock;
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    // 美术旋壳挂上了：白模的壳和冰刺（嵌套的分组）都收起；没挂上（清单里没有旋壳）就用白模壳顶替
    const artShell = this.shellSocket.children.some((o) => (o as THREE.LOD).isLOD);
    this.shellSocket.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o.parent as THREE.LOD | null)?.isLOD) o.visible = !artShell;
    });
    let ventParent: THREE.Object3D = this.ventAnchor;
    if (n) {
      const snake = n.pose.bone('snake');
      const body = n.pose.bone('body');
      if (snake) {
        this.snakeAnchor = this.anchorOn(snake, SNAKE_POINT);
        this.setHeadAnchor(this.snakeAnchor, 0, 0, 0);
      }
      if (body) ventParent = this.ventAnchor = this.anchorOn(body, VENT_POINT);
      // 蛇头发光壳：青紫（管线默认的暖橙是镇墓兽日火的颜色）
      n.glowShell?.color.setHex(0xc8b4ff);
      // 白模的眼睛、蛇头发光件按方块摆，对不上美术（美术贴图自带青紫的眼口）：收起
      this.body.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = false;
      });
    }
    // 散热孔辉光：挂在 body 骨（或白模龟壳）上，过热时亮
    const disc = createGlowDisc(FROST.violet, 0xf4ecff);
    ventParent.add(disc.group);
    const ps = ventParent.getWorldScale(_v).x;
    const hs = host.getWorldScale(_f).x;
    disc.group.scale.setScalar((VENT_RADIUS * hs) / Math.max(1e-6, ps));
    disc.set(0);
    this.ventGlow = disc;
  }

  /** 在骨骼下建一个锚点，位置按模型空间给（换算到骨骼局部，骨骼的缩放各不相同） */
  private anchorOn(bone: THREE.Object3D, hostPoint: THREE.Vector3): THREE.Object3D {
    const host = this.model.children[0];
    const a = new THREE.Object3D();
    bone.add(a);
    a.position.copy(bone.worldToLocal(host.localToWorld(hostPoint.clone())));
    return a;
  }

  protected override cancelAttack(): void {
    this.hideWarnings();
    this.releaseAttack();
    if (this.state === 'spin') {
      // 旋转中被眩晕：直接停下，照样过热翻倒（输出窗口）
      this.endSpin();
      return;
    }
    if (this.state !== 'advance' && this.state !== 'idle' && this.state !== 'overheat' && this.state !== 'rightself') {
      this.setState('advance');
      this.accel = 18;
      this.spinCd = Math.max(this.spinCd, 2);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideWarnings();
    this.ventGlow?.dispose();
    this.ventGlow = null;
  }

  private hideWarnings(): void {
    this.ring?.release();
    this.ring = null;
    this.lane?.release();
    this.lane = null;
  }

  /** 震屏：按离玩家的距离衰减 */
  private quake(strength: number, range: number, dur = 0.3): void {
    const k = clamp01(1 - this.distToPlayerXZ() / range);
    if (k > 0) this.ctx.fx.shake(strength * k, dur);
  }

  private yawToPlayer(): number {
    const pl = this.ctx.player.position;
    return Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    const yawTo = this.yawToPlayer();
    this.spinCd -= dt * this.attackRate;
    this.biteCd -= dt * this.attackRate;
    if (!this.alerted && this.sees && d < 28) {
      this.alerted = true;
      this.getHeadCenter(_p);
      this.ctx.audio.play('enemy_alert', { position: _p, volume: 0.8, pitch: 0.55 });
    }
    switch (this.state) {
      case 'advance': {
        this.accel = 18;
        this.glowTarget[0] = 0.15;
        this.glowTarget[2] = 0.25 + 0.1 * Math.sin(this.age * 2.5);
        this.facing = rotateTowards(this.facing, yawTo, TURN_RATE * dt);
        const fd = this.facingDot();
        if (d < SPIN_RANGE[0]) this.closeTime += dt;
        else this.closeTime = Math.max(0, this.closeTime - dt);
        if (this.biteCd <= 0 && d <= BITE_RANGE && fd < BITE_BEHIND && this.verticalReach(2) && this.requestAttack('melee', 1.2)) {
          this.beginBite();
          break;
        }
        // 近身旋转：玩家贴着不走 → 后退拉开，再缩壳旋转
        if (this.spinCd <= 0 && d < SPIN_RANGE[0] && this.sees && this.verticalReach(1.5)
          && (this.closePecks >= CLOSE_SPIN_PECKS || this.closeTime >= CLOSE_SPIN_TIME)
          && this.requestAttack('heavy', BACKOFF_TIME + SPIN_WINDUP + SPIN_MAX_TIME + 0.5)) {
          this.beginBackoff();
          break;
        }
        if (this.cooldown <= 0 && d <= PECK_RANGE && fd > 0.7 && this.verticalReach(1.8) && this.requestAttack('melee', 1.2)) {
          this.beginPeck();
          break;
        }
        if (this.spinCd <= 0 && d >= SPIN_RANGE[0] && d <= SPIN_RANGE[1] && this.sees && this.verticalReach(1.5)
          && this.requestAttack('heavy', SPIN_WINDUP + SPIN_MAX_TIME + 0.5)) {
          this.beginSpin();
          break;
        }
        const stop = 2.6 * this.sizeScale * 0.7;
        if (d > stop) this.approachPlayer(this.speed, stop);
        else this.stopMoving();
        break;
      }
      case 'peckWindup': {
        this.stopMoving();
        this.facePlayer(2.2, dt);
        this.glowTarget[0] = 0.4 + 0.6 * clamp01(this.stateTime / this.windTime);
        if (this.stateTime >= this.windTime) this.peck();
        break;
      }
      case 'peck': {
        this.stopMoving();
        if (this.stateTime >= 0.45) this.toAdvance();
        break;
      }
      case 'biteWindup': {
        this.stopMoving();
        this.glowTarget[2] = 0.5 + 0.5 * clamp01(this.stateTime / this.windTime);
        if (this.stateTime >= this.windTime) this.bite();
        break;
      }
      case 'bite': {
        this.stopMoving();
        if (this.stateTime >= 0.4) this.toAdvance();
        break;
      }
      case 'backoff': {
        // 正面对着玩家往后退（冰壳照挡）；退够距离或撞墙就开始缩壳
        this.facing = rotateTowards(this.facing, yawTo, 2 * dt);
        this.accel = 14;
        this.setMove(-Math.sin(yawTo), -Math.cos(yawTo), BACKOFF_SPEED);
        if (Math.floor(this.stateTime / 0.3) !== Math.floor((this.stateTime - dt) / 0.3)) {
          this.localPoint(0, 1.0, 1.7, _p);
          frostVapour(this.ctx, _p, this.sizeScale * 0.5, 3, FROST.ice);
        }
        if (this.stateTime >= BACKOFF_TIME || d >= BACKOFF_RANGE || (this.stateTime > 0.15 && this.moveResult.hitWall)) {
          this.beginSpin();
        }
        break;
      }
      case 'retract': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        // 前 60% 还能对准玩家，之后锁定方向（侧移可躲）
        if (t < 0.6) this.facing = rotateTowards(this.facing, yawTo, 1.6 * dt);
        this.glowTarget[1] = t;
        this.updateWarnings(t);
        // 壳缘冰刺亮起：一圈冰屑往外迸
        if (Math.floor(this.stateTime / 0.12) !== Math.floor((this.stateTime - dt) / 0.12)) {
          const a = this.stateTime * 9;
          this.localPoint(Math.sin(a) * 1.2, 0.5, Math.cos(a) * 1.25, _p);
          this.ctx.fx.burst(_p, FROST.spike, 3, 3, 0.35, 0.08 * this.sizeScale, 2);
        }
        if (this.stateTime >= this.windTime) this.startSpin();
        break;
      }
      case 'spin':
        this.spinStep(dt);
        break;
      case 'overheat': {
        this.stopMoving();
        this.glowTarget[1] = 0.85 + 0.15 * Math.sin(this.age * 9);
        // 散热孔喷青紫霜气
        if (Math.floor(this.stateTime / 0.16) !== Math.floor((this.stateTime - dt) / 0.16)) {
          this.ventAnchor.getWorldPosition(_p);
          frostVapour(this.ctx, _p, this.sizeScale, 4);
        }
        if (this.stateTime >= OVERHEAT_TIME) {
          this.setState('rightself');
          this.ctx.audio.play('land', { position: this.position, volume: 0.8, pitch: 0.5 });
        }
        break;
      }
      case 'rightself': {
        this.stopMoving();
        this.glowTarget[1] = Math.max(0, 1 - this.stateTime / RIGHTSELF_TIME);
        if (this.stateTime >= RIGHTSELF_TIME) {
          this.setHeadAnchor(this.snakeAnchor, 0, 0, this.nativeBody ? 0 : -0.08);
          this.getBodyCenter(_p);
          this.ctx.fx.burst(_p.setY(this.position.y + 0.1), FROST.snow, 12, 3, 0.6, 0.2 * this.sizeScale, 6);
          this.quake(0.3, STEP_SHAKE_RANGE, 0.25);
          this.toAdvance();
          this.spinCd = this.ctx.rng.range(SPIN_COOLDOWN[0], SPIN_COOLDOWN[1]);
        }
        break;
      }
      default:
        this.setState('advance');
    }
  }

  private toAdvance(): void {
    this.setState('advance');
    this.accel = 18;
    this.releaseAttack();
  }

  // ───────────── 冰喙猛啄 ─────────────

  private beginPeck(): void {
    this.windTime = this.windup(PECK_WINDUP, 0.3);
    this.setState('peckWindup');
    this.stopMoving();
    this.struck = false;
    this.localPoint(0, 1.0, 1.6, _p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.6, pitch: 0.8 });
  }

  private peck(): void {
    this.setState('peck');
    const pl = this.ctx.player;
    this.localPoint(0, 0.9, 2.1, _p);
    this.ctx.audio.play('enemy_melee', { position: _p, volume: 0.9, pitch: 0.6 });
    this.ctx.fx.burst(_p, FROST.ice, 6, 4, 0.3, 0.08 * this.sizeScale, 6);
    const d = this.distToPlayerXZ();
    if (pl.alive && d <= PECK_REACH + pl.radius && this.facingDot() > 0.5 && this.verticalReach(2)) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * PECK_MULT, 'none', this, _p);
      _v.set(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(PECK_KNOCK);
      _v.y = 4;
      pl.applyImpulse(_v);
      this.ctx.fx.shake(0.5, 0.25);
    }
    this.closePecks++;
    this.rollCooldown(1.6, 2.4);
  }

  // ───────────── 蛇尾反咬 ─────────────

  private beginBite(): void {
    this.windTime = this.windup(BITE_WINDUP, 0.3);
    this.setState('biteWindup');
    this.stopMoving();
    this.struck = false;
    this.getHeadCenter(_p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.6, pitch: 1.6 });
    frostVapour(this.ctx, _p, this.sizeScale * 0.6, 3, FROST.cyan);
  }

  private bite(): void {
    this.setState('bite');
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    this.getHeadCenter(_p);
    this.ctx.audio.play('enemy_melee', { position: _p, volume: 0.8, pitch: 1.4 });
    if (pl.alive && d <= BITE_REACH + pl.radius && this.facingDot() < BITE_BEHIND + 0.15 && this.verticalReach(2.4)) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * BITE_MULT, 'none', this, _p);
      _v.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z).normalize().multiplyScalar(6);
      _v.y = 3;
      pl.applyImpulse(_v);
      this.ctx.fx.burst(pl.eye, FROST.violet, 8, 3, 0.4, 0.1, 2);
    }
    this.biteCd = this.ctx.rng.range(BITE_COOLDOWN[0], BITE_COOLDOWN[1]);
  }

  // ───────────── 缩壳旋转 ─────────────

  /** 近身旋转的第一步：低吼一声、喷鼻息，往后退开（令牌已在 advance 里拿到） */
  private beginBackoff(): void {
    this.setState('backoff');
    this.localPoint(0, 1.0, 1.7, _p);
    this.ctx.audio.play('enemy_alert', { position: _p, volume: 0.7, pitch: 0.45 });
    frostVapour(this.ctx, _p, this.sizeScale * 0.6, 5, FROST.ice);
  }

  private beginSpin(): void {
    this.windTime = this.windup(SPIN_WINDUP, 0.55);
    this.setState('retract');
    this.stopMoving();
    this.hideWarnings();
    // 实色饱和蓝（普通混合）：叠加的浅青色在浅色冰面上看不见
    this.ring = GroundDecal.acquire(this.ctx.stageGroup, FROST.warnSolid);
    this.lane = GroundDecal.acquire(this.ctx.stageGroup, FROST.warnSolid);
    this.ring.solid = true;
    this.lane.solid = true;
    this.updateWarnings(0);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.9, pitch: 0.55 });
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.6, pitch: 1.3 });
  }

  /** 预警：脚下一圈（旋壳的大小）+ 朝当前方向一条直线（只预告起步方向，反弹要自己看） */
  private updateWarnings(t: number): void {
    const k = this.sizeScale;
    if (this.ring) {
      this.ring.circle(this.position.x, this.position.y, this.position.z, 1.3 * k, 1.05 * k);
      this.ring.fill = t;
      this.ring.opacity = 0.3 + 0.5 * t;
    }
    if (this.lane) {
      const sx = Math.sin(this.facing), sz = Math.cos(this.facing);
      this.lane.rect(this.position.x + sx * 1.3 * k, this.position.y, this.position.z + sz * 1.3 * k, this.facing, 12, 0.9 * k);
      this.lane.fill = t;
      this.lane.opacity = 0.25 + 0.45 * t;
    }
  }

  private startSpin(): void {
    this.setState('spin');
    this.hideWarnings();
    this.spinYaw = this.facing;
    this.spinDist = 0;
    this.iceAt = 0;
    this.bounces = 0;
    this.lastBounce = -1;
    this.lastSpinHit = -99;
    this.closePecks = 0;
    this.closeTime = 0;
    this.accel = 60;
    this.swapToShell(true);
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 1, pitch: 0.7 });
    this.quake(0.3, STEP_SHAKE_RANGE, 0.25);
  }

  /** 身体 ↔ 旋壳：换的一瞬间用一团冰雾盖住 */
  private swapToShell(on: boolean): void {
    this.shellSocket.visible = on;
    if (this.nativeBody) this.nativeBody.lod.visible = !on;
    else this.body.visible = !on;
    this.ventGlow?.set(0);
    this.getBodyCenter(_p);
    iceShards(this.ctx, _p, this.sizeScale, 10, 4);
    frostVapour(this.ctx, _p, this.sizeScale, 6, FROST.ice);
  }

  /** 旋转一帧：弱追踪、加速到满速；撞墙按法线反弹（第 SPIN_BOUNCES + 1 次停下）；撞到玩家重伤击飞；身后留滑冰带 */
  private spinStep(dt: number): void {
    const elite = this.isElite;
    const maxSpeed = SPIN_SPEED * (elite ? 1.15 : 1);
    this.spinYaw = rotateTowards(this.spinYaw, this.yawToPlayer(), SPIN_HOMING * dt);
    const sp = Math.min(maxSpeed, SPIN_START + this.stateTime * SPIN_RAMP);
    this.setMove(Math.sin(this.spinYaw), Math.cos(this.spinYaw), sp);
    this.facing = this.spinYaw;
    this.glowTarget[1] = 1;
    this.spinDist += Math.hypot(this.velocity.x, this.velocity.z) * dt;
    while (this.spinDist - this.iceAt >= ICE_STEP) {
      this.iceAt += ICE_STEP;
      const gy = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
      _t.set(this.position.x, Number.isFinite(gy) ? gy : this.position.y, this.position.z);
      dropIcePatch(this.ctx, _t, ICE_RADIUS * this.sizeScale, ICE_TIME);
    }
    // 撞到玩家
    const pl = this.ctx.player;
    const now = this.ctx.time.now;
    if (pl.alive && now - this.lastSpinHit >= SPIN_HIT_GAP) {
      const dx = pl.position.x - this.position.x, dz = pl.position.z - this.position.z, dy = pl.position.y - this.position.y;
      if (Math.hypot(dx, dz) <= this.radius + pl.radius + 0.25 && dy > -1 && dy < 1.5 * this.sizeScale) {
        this.lastSpinHit = now;
        this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * SPIN_MULT, 'none', this, this.position);
        const len = Math.hypot(dx, dz) || 1;
        _v.set(Math.sin(this.spinYaw) * 0.6 + (dx / len) * 0.8, 0, Math.cos(this.spinYaw) * 0.6 + (dz / len) * 0.8)
          .normalize().multiplyScalar(SPIN_KNOCK);
        _v.y = 5;
        pl.applyImpulse(_v);
        this.ctx.fx.shake(0.8, 0.3);
        this.ctx.audio.play('boss_slam', { position: pl.position, volume: 0.7, pitch: 1.5 });
        iceShards(this.ctx, _p.copy(pl.position).setY(pl.position.y + 1), 1, 10, 6);
      }
    }
    // 撞墙反弹
    const mr = this.moveResult;
    if (mr.hitWall && this.stateTime > 0.12 && this.stateTime - this.lastBounce > 0.15) {
      this.lastBounce = this.stateTime;
      this.bounces++;
      this.localPoint(0, 0.6, 1.2, _p);
      iceShards(this.ctx, _p, this.sizeScale, 14, 7);
      this.ctx.audio.play('boss_slam', { position: _p, volume: 0.8, pitch: 1.1 });
      this.quake(0.45, STEP_SHAKE_RANGE, 0.25);
      if (this.bounces > SPIN_BOUNCES + (elite ? 1 : 0)) {
        this.endSpin();
        return;
      }
      _v.set(Math.sin(this.spinYaw), 0, Math.cos(this.spinYaw));
      _f.set(mr.wallNormal.x, 0, mr.wallNormal.z);
      if (_f.lengthSq() > 1e-6) {
        _f.normalize();
        const dot = _v.dot(_f);
        if (dot < 0) _v.addScaledVector(_f, -2 * dot);
        else _v.negate();
      } else _v.negate();
      this.spinYaw = Math.atan2(_v.x, _v.z);
      this.velocity.x = _v.x * sp;
      this.velocity.z = _v.z * sp;
    }
    if (this.stateTime >= SPIN_MAX_TIME) this.endSpin();
  }

  /** 旋转结束：换回身体，侧翻在地、壳顶散热孔对着玩家（弱点移到散热孔上） */
  private endSpin(): void {
    this.setState('overheat');
    this.releaseAttack();
    this.accel = 30;
    this.stopMoving();
    this.velocity.x *= 0.2;
    this.velocity.z *= 0.2;
    this.swapToShell(false);
    // 侧翻方向：让生物右侧（-X，壳顶翻向的一侧）朝着玩家，散热孔正对玩家
    this.facing = this.yawToPlayer() + Math.PI / 2;
    this.setHeadAnchor(this.ventAnchor, 0, 0, 0);
    const gy = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
    iceCrack(this.ctx, _t.set(this.position.x, Number.isFinite(gy) ? gy : this.position.y, this.position.z), 1.8 * this.sizeScale);
    this.ctx.audio.play('shield_break', { position: this.position, volume: 0.8, pitch: 0.6 });
    this.quake(0.5, STEP_SHAKE_RANGE, 0.35);
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.hideWarnings();
    if (attackDirector.purging) return;
    const ctx = this.ctx, k = this.sizeScale;
    const c = this.getBodyCenter(new THREE.Vector3());
    iceShards(ctx, c, k, 26, 8);
    frostVapour(ctx, c, k, 10);
    const gy = ctx.world.groundHeight(c.x, c.z, c.y + 1);
    iceCrack(ctx, _t.set(c.x, Number.isFinite(gy) ? gy : this.position.y, c.z), 2.2 * k, 3);
    ctx.audio.play('shield_break', { position: c, volume: 1, pitch: 0.5 });
    this.quake(0.5, 24, 0.4);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    let retract = 0, flip = 0, peck = 0, rear = 0, bite = 0, rate = 8;
    if (st === 'retract') { retract = smooth(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'spin') retract = 1;
    else if (st === 'overheat') { flip = smooth(this.stateTime / 0.35); retract = 0.35; rate = 12; }
    else if (st === 'rightself') { flip = 1 - smooth(this.stateTime / RIGHTSELF_TIME); rate = 12; }
    else if (st === 'peckWindup') { peck = -clamp01(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'peck') { peck = this.stateTime < 0.12 ? 1 : Math.max(0, 1 - (this.stateTime - 0.12) / 0.33); rate = 30; }
    else if (st === 'biteWindup') { rear = clamp01(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'bite') { bite = this.stateTime < 0.1 ? 1 : Math.max(0, 1 - (this.stateTime - 0.1) / 0.3); rate = 30; }
    const k = 1 - Math.exp(-rate * dt);
    this.pRetract = mix(this.pRetract, retract, st === 'spin' ? 1 : k);
    this.pFlip = st === 'overheat' || st === 'rightself' ? flip : mix(this.pFlip, 0, k);
    this.pPeck = mix(this.pPeck, peck, k);
    this.pRear = mix(this.pRear, rear, k);
    this.pBite = mix(this.pBite, bite, k);
    this.pHeat = mix(this.pHeat, clamp01(this.glowLevel[1]), 1 - Math.exp(-6 * dt));
    this.ventGlow?.set(st === 'spin' ? 0 : this.pHeat * (st === 'overheat' ? 1.2 : 0.4));

    // 侧翻：绕右侧壳缘贴地处转（白模与美术都挂在 host 下）
    const host = this.model.children[0];
    const roll = this.pFlip * FLIP_ROLL + (st === 'overheat' ? Math.sin(this.age * 11) * 0.04 * this.pFlip : 0);
    host.rotation.set(0, 0, roll);
    _q.setFromAxisAngle(AZ, roll);
    host.position.copy(FLIP_PIVOT).sub(_v.copy(FLIP_PIVOT).applyQuaternion(_q));
    // 旋壳自转
    if (st === 'spin') {
      this.spinAngle += SPIN_RATE * dt;
      this.shellSocket.rotation.y = this.spinAngle;
      // 壳缘冰刺一圈拖尾
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        this.localPoint(Math.sin(a) * 1.25, 0.45, Math.cos(a) * 1.25, _p);
        this.ctx.fx.burst(_p, FROST.spike, 1, 2.5, 0.3, 0.12 * this.sizeScale, 3);
      }
    }
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();
  }

  /** 白模动画：对角慢走；缩壳时头、腿、尾收进壳里；啄、扬尾、侧翻蹬腿 */
  private poseBlockout(): void {
    const amp = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / Math.max(1, this.def.speed)) * (1 - this.pRetract);
    const ph = this.walkPhase;
    const r = this.pRetract;
    this.body.rotation.set(-this.hurtKick * 0.1, 0, Math.sin(ph) * 0.03 * amp);
    this.head.position.set(0, 0, 1.2 - 0.7 * r + 0.35 * this.pPeck);
    this.head.rotation.x = 0.35 * Math.max(0, this.pPeck);
    const flail = this.state === 'overheat' ? 1 : 0;
    for (const l of this.legs) {
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      l.upper.position.y = -0.2 + 0.35 * r;
      l.upper.scale.setScalar(Math.max(0.05, 1 - 0.85 * r));
      l.upper.rotation.x = Math.sin(ph + off) * 0.35 * amp + flail * Math.sin(this.age * 14 + off) * 0.6;
    }
    for (const [i, seg] of this.tail.entries()) {
      seg.scale.setScalar(i === 0 ? Math.max(0.05, 1 - 0.85 * r) : 1);
      seg.rotation.x = (i === 0 ? 0 : 0.45) + 0.25 * this.pRear - 0.35 * this.pBite;
      seg.rotation.y = Math.sin(this.age * 2 - i * 0.7) * (0.12 + 0.4 * flail);
    }
  }

  /**
   * 美术骨骼动画（龟形四足，creature_rigs/SK_Enemy_XuanGui.json）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前端往下（低头），负转 = 前端往上。
   * - 步态：对角慢走，触地段脚往后扫、腾空段抬脚前摆（两骨 IK），每只脚落地扬雪、按距离震屏。
   * - 缩壳：鸟头整体退进壳里（颈骨后移），四脚收到壳下，蛇尾整条缩短卷进去。
   * - 冰喙猛啄：缩颈蓄力 → 猛地前伸、低头；蛇尾反咬：尾巴高高扬起 → 往后下方咬出去。
   * - 过热侧翻：四脚朝天乱蹬，蛇尾乱甩，鸟头左右甩；蛇头发光壳随蓄力 / 反咬变亮。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const r = this.pRetract;
    const move = clamp01(sp / 0.6) * (1 - r);
    this.gait = (this.gait + GAIT_FREQ * dt * move) % 1;
    const sweep = Math.min(GAIT_SWEEP, (sp * GAIT_DUTY) / (GAIT_FREQ * this.sizeScale)) * (1 - r);
    const lift = GAIT_LIFT * move;
    const flail = this.state === 'overheat' ? 1 : 0;
    const ph = this.gait * Math.PI * 2;

    // 身体：步子起伏、受击后仰；缩壳时整只往下沉一点（壳缘贴地）
    P.translate('body', 0, -0.02 * move * (1 - Math.cos(ph * 2)) * 0.5 - 0.25 * r, 0);
    P.rotate('body', AZ, Math.sin(ph) * 0.025 * move);
    P.rotate('body', AX, -this.hurtKick * 0.06);
    // 头：看向玩家；缩壳时整颗鸟头退进壳里；啄
    let dyaw = this.yawToPlayer() - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const look = this.state === 'advance' || this.state === 'peckWindup' ? THREE.MathUtils.clamp(dyaw, -0.6, 0.6) : 0;
    P.translate('neck', 0, -0.05 * r, -0.62 * r + 0.42 * this.pPeck);
    P.rotate('neck', AY, look * 0.8 + flail * Math.sin(this.age * 9) * 0.35);
    P.rotate('head', AX, 0.3 * Math.max(0, this.pPeck) - 0.15 * Math.max(0, -this.pPeck) - this.hurtKick * 0.2);
    // 蛇尾：平时缓缓摆，蛇头盯着身后；扬尾 → 咬；缩壳时整条缩进壳里；侧翻时乱甩
    P.scale('tail_1', Math.max(0.05, 1 - 0.9 * r));
    const wag = 0.08 + 0.35 * flail;
    for (const [i, b] of TAIL.entries()) {
      P.rotate(b, AX, 0.18 * this.pRear * (i + 1) - 0.28 * this.pBite * (i + 1) * 0.6);
      P.rotate(b, AY, wag * Math.sin(this.age * (1.8 + 5 * flail) - i * 0.8));
    }
    P.rotate('snake', AX, -0.35 * this.pRear + 0.55 * this.pBite);
    // 腿 IK：触地段从前往后扫、腾空段抬脚前摆；缩壳时收到壳下；侧翻时四脚乱蹬
    for (const [li, leg] of LEGS.entries()) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const u = (this.gait + leg.phase) % 1;
      if (move > 0.3 && this.legU[li] > GAIT_DUTY && u < GAIT_DUTY) this.footfall(leg.e);
      this.legU[li] = u;
      let dz: number, dy: number;
      if (u < GAIT_DUTY) {
        dz = sweep * (0.5 - u / GAIT_DUTY);
        dy = 0;
      } else {
        const t = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * lift;
      }
      const kick = flail * Math.sin(this.age * 13 + li * 1.7);
      _t.set(
        rest.x * (1 - 0.45 * r) + leg.side * 0.12 * kick,
        rest.y + dy + 0.5 * r + 0.2 * flail * (0.5 + 0.5 * kick),
        rest.z * (1 - 0.3 * r) + dz + 0.15 * kick,
      );
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1 - 0.6 * flail);
    }
    if (n.glowShell) n.glowShell.opacity = clamp01(Math.max(this.glowLevel[2], 0.25 + 0.75 * Math.max(this.pRear, this.pBite))) * 0.85;
  }

  /** 一只脚落地：脚下扬雪，按距离轻震屏 */
  private footfall(bone: string): void {
    const b = this.nativeBody?.pose.bone(bone);
    if (!b) return;
    b.getWorldPosition(_p);
    _p.y = this.position.y + 0.05;
    this.ctx.fx.burst(_p, FROST.snow, 4, 1.4, 0.5, 0.18 * this.sizeScale, 6);
    this.quake(0.05, STEP_SHAKE_RANGE, 0.12);
    if (this.distToPlayerXZ() < STEP_SHAKE_RANGE) this.ctx.audio.play('footstep', { position: _p, volume: 0.5, pitch: 0.4 });
  }
}

/** 正面格挡 / 旋壳减伤：全局伤害修正，只对旋龟生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof XuanGui ? enemy.guardFactor(req) : 1));
}
