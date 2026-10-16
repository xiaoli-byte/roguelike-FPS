/**
 * 火鼍（tuo，第三章 · 祝融火狱的坦克，火坛）：《西游记》黑水河的鼍龙，在祝融火狱的熔岩河里成了一条巨鳄（扬子鳄的样子）。
 * 宽吻、满嘴乱牙，眼和鼻孔高在头顶；背上一块块冷却的玄武岩甲，甲缝里流着熔岩，脊背一道发亮的熔岩接缝（弱点）。
 * 用户要求坦克「有压迫感」：美术按高 1.9 米（含背棘）、长 4.3 米制作，游戏里放大 1.3 倍（约 5.5 米长），
 * 血厚、不吃击退（docs/art/enemy-roster-v2.md「火鼍 · 潜熔与岩甲」）。只该刷在有熔岩河的房间（没有熔岩也能当陆上坦克打）。
 *
 * - 潜熔：沉进熔岩，只露出脊背接缝和两眼，在熔岩里游（7 米/秒，自己在熔岩掩码上寻路，见 inferno/lavaSwim.ts），
 *   拖出一道熔岩波纹。这时只有露出熔岩的脊背打得到，伤害减半。
 * - 伏击扑咬：玩家在岸边、离它 7 米内：岸边熔岩鼓起、冒泡 0.6 秒（地上一条品红扑击线），冲上岸扑咬（1.5 倍伤害）。
 *   玩家一直躲着岸边超过 8 秒，它也会自己爬上岸来找人。
 * - 岩甲：背上 8 块玄武岩甲（左右两列 × 前后四排）各有血量，整体只吃 25% 伤害；打碎一块，那里露出发亮的熔肉，受伤 ×2。
 *   甲片不拆网格：着色器按顶点的绑定位置分区（区域 ID），碎了的那一区改成熔肉发光，加碎石特效。
 * - 回熔：碎了 3 块以上、附近有熔岩：爬回熔岩（爬的时候追着打），5 秒内碎甲重新长出（先红后黑），然后接着潜游伏击。
 *   上岸 7 秒后（甲没碎够）也会回熔岩再找机会伏击。
 * - 甩尾：玩家在它侧后 5 米内：尾巴先往一边蓄 0.55 秒（身后半圈预警），再横扫 180°，把人击退约 4 米——
 *   优先朝最近的熔岩扫，扫进熔岩就是熔岩自己的伤害和托回（LavaSystem）。起跳躲得过。
 * - 鼍鸣：血量低于 40% 时一次：仰头闷吼，贴地震波（起跳躲过），附近岸边溅起几处燃烧的火点。
 * - 步态：鳄类的高位爬行，对角步，脊柱一节节左右摆成 S 形；游的时候四肢收在身侧，尾巴大幅摆动推进。
 *
 * 状态机：enter → toLava → (regrow →) swim → surge → lunge → bite → land
 *         land → biteWindup → bite / sweepWindup → sweep / roar → land
 *         land → toLava（碎甲 ≥ 3 或上岸太久）
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import type { WhiteboxLava } from '../../world/WhiteboxTypes';
import { clamp01, raySphere, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { INFERNO, basaltShards, fireSpot, lavaBubbles, moltenSplash, smokePuff } from '../fx/InfernoTankFx';
import { LavaRoute, bankPoint, isLava, lavaOf, nearestLava } from '../inferno/lavaSwim';

export const TUO_DEF: ScaledEnemyDef = {
  id: 'tuo',
  name: '火鼍',
  hp: 650,
  armor: 120,
  speed: 2,
  radius: 0.9,
  height: 1.5,
  damage: 38,
  coins: [9, 13],
  essence: 3,
  // 弱点 = 脊背中段的熔岩接缝（模型单位，离地约 1.55）；身体命中盒是沿脊柱的一串球（见 raycastHit）
  headY: 1.55,
  headRadius: 0.3,
  knockbackResist: 1,
  color: 0xff5a1a,
  // 美术按 1.9 米（含背棘）制作，游戏里放大 1.3 倍：命中盒、弱点、特效一起放大
  scale: 1.3,
};

/** 伤害倍率：完好的岩甲 ×0.25、碎甲露出的熔肉 ×2、脊背接缝 ×0.5（爆头另算暴击）、潜在熔岩里一律 ×0.5 */
const PLATE_ARMOR = 0.25;
const FLESH_FACTOR = 2;
const SEAM_FACTOR = 0.5;
const SUBMERGED_FACTOR = 0.5;
/** 每块岩甲的血量（按打在甲上、减伤前的伤害算）：最大生命的这个比例 */
const PLATE_HP = 0.1;
const PLATES = 8;
/** 碎甲达到这么多块就回熔岩长甲 */
const RETREAT_BROKEN = 3;
/** 陆上：转身角速度（弧度/秒）、停步距离（米） */
const TURN_RATE = 1.3;
const STOP_DIST = 2.6;
/** 熔岩里：游速、转身、重新寻路间隔、伏击距离与冷却、躲岸多久后自己上岸 */
const SWIM_SPEED = 7;
const SWIM_TURN = 3.2;
const REPLAN = 0.5;
const AMBUSH_RANGE = 7;
const AMBUSH_COOLDOWN = [2.5, 3.5] as const;
const EMERGE_AFTER = 8;
const EMERGE_DIST = 11;
/** 伏击：鼓泡前摇、扑击速度与最长时间、扑咬命中距离（米，中心算）与倍率 */
const SURGE_TIME = 0.6;
const LUNGE_SPEED = 14;
const LUNGE_MAX = 0.55;
const AMBUSH_REACH = 3.4;
const AMBUSH_MULT = 1.5;
/** 陆上扑咬：触发距离、命中距离、前摇、倍率、冷却 */
const BITE_RANGE = 3.1;
const BITE_REACH = 3.6;
const BITE_WINDUP = 0.45;
const BITE_COOLDOWN = [1.8, 2.6] as const;
/** 甩尾：触发距离、命中距离、前摇、倍率、击退（水平 / 上抛速度）、冷却 */
const SWEEP_RANGE = 5.2;
const SWEEP_REACH = 5.6;
const SWEEP_WINDUP = 0.55;
const SWEEP_MULT = 0.8;
const SWEEP_KNOCK = 10;
const SWEEP_UP = 3.5;
const SWEEP_COOLDOWN = [3, 4] as const;
/** 甩尾优先把人扫向这个距离内的熔岩 */
const SWEEP_LAVA_SEEK = 7;
/** 鼍鸣：血量阈值、前摇、震波半径与速度、伤害倍率、火点（个数、半径、持续、伤害） */
const ROAR_HP = 0.4;
const ROAR_WINDUP = 0.8;
const ROAR_RADIUS = 10;
const ROAR_SPEED = 16;
const ROAR_MULT = 0.6;
const FIRE_SPOTS = 5;
const FIRE_SPOT_R = 1.3;
const FIRE_SPOT_TIME = 4;
/** 回熔：碎甲重新长出的时长；上岸后多久回熔岩伏击（玩家躲着岸边爬上来找人时更久） */
const REGROW_TIME = 5;
const LAND_STAY = 7;
const LAND_STAY_EMERGED = 12;
const LAVA_SEEK = 20;
/** 潜下去的深度（模型单位）：只露背和眼 */
const SINK = 1.0;
/** 美术网格的中心在包围盒中心，长尾巴让它偏前：整体往后挪，让前后脚的中点落在逻辑位置上 */
const ART_SHIFT_Z = -0.45;

/** 身体命中球（网格坐标：X = 生物左侧，Y = 上，Z = 前；挂到对应骨骼上，跟着摆动） */
const HIT_SPHERES: readonly { bone: string; p: readonly [number, number, number]; r: number }[] = [
  { bone: 'head', p: [0, 0.88, 1.75], r: 0.42 },
  { bone: 'chest', p: [0, 0.95, 1.05], r: 0.62 },
  { bone: 'spine', p: [0, 0.98, 0.4], r: 0.72 },
  { bone: 'hips', p: [0, 0.9, -0.2], r: 0.62 },
  { bone: 'tail_2', p: [0, 0.75, -0.85], r: 0.42 },
  { bone: 'tail_4', p: [0, 0.68, -1.45], r: 0.32 },
];
const SEAM_POINT = new THREE.Vector3(0, 1.55, 0.45);
/** 岩甲分区：四排（网格 Z 区间，前 → 后）× 左右两列；顶点 |x| 在 [SEAM_HALF, PLATE_HALF]、高于 PLATE_Y 的属于甲区 */
const PLATE_BANDS: readonly (readonly [number, number])[] = [[0.85, 1.35], [0.35, 0.85], [-0.15, 0.35], [-0.65, -0.15]];
const PLATE_BONES = ['chest', 'spine', 'spine', 'hips'] as const;
const PLATE_HALF = 0.62;
const SEAM_HALF = 0.06;
const PLATE_Y = 1.0;

/**
 * 步态（美术骨骼）：鳄类的高位爬行是对角步（左前 + 右后一起），触地比例高；脚相对身体最多扫过多远（模型局部单位）、抬脚高度。
 */
const GAIT_DUTY = 0.65;
const GAIT_SWEEP = 0.42;
const GAIT_LIFT = 0.1;
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, side: 1, phase: 0 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, side: -1, phase: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, side: -1, phase: 0.5 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, side: 1, phase: 0.5 },
] as const;
/** 摆动链：从头到尾（行进波从头传到尾） */
const WAVE = ['neck', 'chest', 'spine', 'hips', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'] as const;
const WAVE_AMP = [0.03, 0.05, 0.06, 0.06, 0.08, 0.1, 0.12, 0.13, 0.14, 0.15] as const;
const TAIL = ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'] as const;

const C = {
  basalt: 0x2b2421, hide: 0x7a2e1c, belly: 0x9a4a2a, claw: 0x2a201c, tooth: 0xe8dcc0, eye: 0xffa030, eyeHot: 0xfff0b0,
  seam: 0xff6a1a, seamHot: 0xffe08a, flesh: 0xff7a20, fleshHot: 0xfff0a0,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 每个 GameContext 只注册一次全局伤害修正（岩甲 / 熔肉 / 潜熔） */
const guardInstalled = new WeakSet<object>();
/** 已经算过岩甲分区（plateId 属性）的几何体：同一资产的实例共用 */
const platedGeometry = new WeakSet<THREE.BufferGeometry>();

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

export class Tuo extends StandardEnemy {
  // 白模骨架（?classic 与资产缺失时的兜底）
  private body!: THREE.Group;
  private head!: THREE.Group;
  private jaw!: THREE.Group;
  private spineJoints: THREE.Group[] = [];
  private legs: Leg[] = [];
  /** 白模的岩甲块与下面的熔肉块（按甲区编号） */
  private plateMeshes: THREE.Mesh[] = [];
  private fleshMeshes: THREE.Mesh[] = [];
  /** 命中球锚点、脊背接缝锚点、岩甲中心锚点 */
  private hitAnchors: { o: THREE.Object3D; r: number }[] = [];
  private seamAnchor!: THREE.Object3D;
  private plateAnchors: THREE.Object3D[] = [];
  /** 着色器里的甲区热度（0 = 完好的玄武岩，1 = 碎甲熔肉；回熔时 1 → 0，先红后黑） */
  readonly plateHeat: number[] = new Array(PLATES).fill(0);
  private readonly plateTime = { value: 0 };
  /** 每块岩甲剩余血量（减伤前的伤害） */
  readonly plateHp: number[];
  readonly broken: boolean[] = new Array(PLATES).fill(false);

  private readonly route = new LavaRoute();
  private replanAt = 0;
  private windTime = BITE_WINDUP;
  private ambushCd: number;
  private biteCd = 0.8;
  private sweepCd = 1;
  private roared = false;
  private landTime = 0;
  private emerged = false;
  private shoreWait = 0;
  private lungeTarget = new THREE.Vector3();
  private bank = new THREE.Vector3();
  private hasBank = false;
  private ambushBite = false;
  private sweepSide = 1;
  private sweepYaw = 0;
  private roarR = 0;
  private roarHit = false;
  private rippleAt = 0;
  private lane: GroundDecal | null = null;
  private ring: GroundDecal | null = null;
  private alerted = false;
  /** 最近一次咬 / 甩尾是否打中了玩家（测试与调试用） */
  struck = false;
  // 平滑后的姿态：下沉、张嘴、扑击前倾、甩尾、仰头吼、游泳收腿
  private pSink = 0;
  private pJaw = 0;
  private pLunge = 0;
  private pSweep = 0;
  private pRoar = 0;
  private pSwim = 0;
  private wave = 0;
  private gait = 0;
  private readonly legU = [0, 0, 0, 0];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, TUO_DEF, opts);
    this.walkScale = 0.3;
    this.stepRate = 0.9;
    this.plateHp = new Array(PLATES).fill(this.maxHp * PLATE_HP);
    this.ambushCd = ctx.rng.range(0.6, 1.2);
    this.state = 'enter';
    installGuard(ctx);
  }

  /** 熔岩生物：LavaSystem 不把它拉回岸上、不烧它（它自己在熔岩里游） */
  get swimsInLava(): boolean {
    return true;
  }

  /** 潜在熔岩里（只露脊背和眼） */
  get submerged(): boolean {
    return this.alive && (this.state === 'swim' || this.state === 'regrow' || this.state === 'surge');
  }

  /** 已经碎了几块岩甲 */
  get brokenCount(): number {
    let n = 0;
    for (const b of this.broken) if (b) n++;
    return n;
  }

  private get lava(): WhiteboxLava | null {
    return lavaOf(this.ctx);
  }

  /** 这次伤害的倍率：潜熔 ×0.5；碎甲熔肉 ×2；脊背接缝 ×0.5；完好的岩甲 ×0.25 */
  armourFactor(req: DamageRequest): number {
    if (req.source === 'status' || !this.alive) return 1;
    if (this.submerged) return SUBMERGED_FACTOR;
    const plate = req.point ? this.plateAt(req.point) : -1;
    if (plate >= 0 && this.broken[plate]) return FLESH_FACTOR;
    if (req.headshot) return SEAM_FACTOR;
    return PLATE_ARMOR;
  }

  /** 世界坐标点最近的岩甲（半径内），没有返回 -1 */
  plateAt(point: THREE.Vector3): number {
    let best = -1, bd = (0.5 * this.sizeScale) ** 2;
    for (let i = 0; i < this.plateAnchors.length; i++) {
      this.plateAnchors[i].getWorldPosition(_t);
      const d = _t.distanceToSquared(point);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** 第 i 块岩甲中心的世界坐标（测试与调试用） */
  plateCenter(i: number, out: THREE.Vector3): THREE.Vector3 {
    return this.plateAnchors[i].getWorldPosition(out);
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    const req = r.request;
    if (this.submerged || req.source === 'status' || !req.point || r.dealt <= 0) return;
    const i = this.plateAt(req.point);
    if (i < 0 || this.broken[i]) return;
    this.plateHp[i] -= r.dealt / PLATE_ARMOR;
    if (this.plateHp[i] <= 0) this.breakPlate(i);
  }

  /** 打碎一块岩甲：碎石 + 熔岩飞溅，那一区改成熔肉发光 */
  private breakPlate(i: number): void {
    this.broken[i] = true;
    this.plateHp[i] = 0;
    this.plateHeat[i] = 1;
    this.plateAnchors[i].getWorldPosition(_p);
    basaltShards(this.ctx, _p, this.sizeScale, 16, 6);
    moltenSplash(this.ctx, _p, this.sizeScale, 8);
    this.ctx.audio.play('shield_break', { position: _p, volume: 0.9, pitch: 0.55 });
    this.ctx.fx.shake(0.15, 0.15);
  }

  /** 身体命中：沿脊柱的一串球（长身体、长尾巴）+ 脊背接缝（爆头）；潜熔时熔岩面以下打不到 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    const surface = this.submerged ? this.position.y + 0.06 : -Infinity;
    const accept = (t: number): boolean => t >= 0 && t <= maxDist && origin.y + dir.y * t >= surface;
    this.getHeadCenter(_v);
    const th = raySphere(origin, dir, _v, this.headRadius);
    let best = -1, head = false;
    if (accept(th)) {
      best = th;
      head = true;
    }
    let tb = -1;
    for (const h of this.hitAnchors) {
      h.o.getWorldPosition(_t);
      const t = raySphere(origin, dir, _t, h.r * this.sizeScale);
      if (accept(t) && (tb < 0 || t < tb)) tb = t;
    }
    if (tb >= 0 && (best < 0 || tb < best - this.headRadius * 0.5)) {
      best = tb;
      head = false;
    }
    if (best < 0) return false;
    out.distance = best;
    out.headshot = head;
    return true;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    // host 整体往后挪（美术网格中心偏前），白模也按网格坐标摆
    const host = joint(root, 0, 0, ART_SHIFT_Z);
    const basalt = flat(C.basalt, { rough: 0.9 }), hide = flat(C.hide, { rough: 0.75 }), belly = flat(C.belly, { rough: 0.8 });
    const claw = flat(C.claw, { rough: 0.6 }), tooth = flat(C.tooth, { rough: 0.4 });
    // 躯干：前后两节（白模的脊柱摆动用），身体中心离地约 0.9
    const body = joint(host, 0, 0.9, 0.4);
    this.body = body;
    part(body, Geo.box(1.3, 0.75, 1.5), hide, 0, 0, 0);
    part(body, Geo.box(1.1, 0.2, 1.4), belly, 0, -0.42, 0);
    const chest = joint(body, 0, 0.02, 0.75);
    part(chest, Geo.box(1.1, 0.65, 0.7), hide, 0, 0, 0.2);
    // 头：宽吻、上下颌、乱牙、高眼
    const head = joint(chest, 0, 0, 0.6);
    this.head = head;
    part(head, Geo.box(0.7, 0.3, 0.9), hide, 0, 0.08, 0.45);
    for (const s of [1, -1]) {
      this.glowPart(head, Geo.ico(0.07, 1), C.eye, C.eyeHot, s * 0.2, 0.28, 0.2);
      for (let k = 0; k < 4; k++) part(head, Geo.cone(0.035, 0.12, 4), tooth, s * 0.3, -0.1, 0.25 + k * 0.17, Math.PI, 0, 0);
    }
    const jaw = joint(head, 0, -0.08, 0.05);
    part(jaw, Geo.box(0.62, 0.16, 0.85), belly, 0, -0.06, 0.4);
    this.jaw = jaw;
    // 尾巴：六节越来越细
    let parent: THREE.Object3D = body;
    this.spineJoints = [chest, body];
    for (let i = 0; i < 6; i++) {
      const seg = joint(parent, 0, i === 0 ? -0.05 : -0.02, i === 0 ? -0.8 : -0.32);
      part(seg, Geo.box(0.8 - i * 0.11, 0.5 - i * 0.06, 0.34), hide, 0, 0, -0.16);
      part(seg, Geo.cone(0.09, 0.22, 4), basalt, 0, 0.3 - i * 0.03, -0.16);
      this.spineJoints.push(seg);
      parent = seg;
    }
    // 四肢外展：上臂 / 大腿水平伸出，前臂 / 小腿向下
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(front ? chest : body, s * 0.55, -0.15, front ? 0.05 : -0.6);
        part(upper, Geo.box(0.36, 0.2, 0.22), hide, s * 0.15, 0, 0);
        const lower = joint(upper, s * 0.3, 0, 0);
        part(lower, Geo.cyl(0.11, 0.13, 0.55, 6, 'top'), hide, 0, 0, 0);
        for (const k of [-1, 0, 1]) part(lower, Geo.cone(0.04, 0.14, 4), claw, k * 0.08, -0.56, 0.12, Math.PI / 2, 0, 0);
        this.legs.push({ upper, lower, front, side: s });
      }
    }
    // 背上 8 块玄武岩甲 + 下面的熔肉（碎甲时露出来）
    for (let i = 0; i < PLATES; i++) {
      const band = PLATE_BANDS[i >> 1], side = i % 2 === 0 ? 1 : -1;
      const zc = (band[0] + band[1]) / 2;
      const par = zc > 0.85 ? chest : body;
      const lz = zc - 0.4 - (par === chest ? 0.75 : 0);
      this.plateMeshes.push(part(par, Geo.box(0.5, 0.2, 0.46), basalt, side * 0.3, 0.42, lz));
      const flesh = this.glowPart(par, Geo.box(0.44, 0.08, 0.4), C.flesh, C.fleshHot, side * 0.3, 0.38, lz, 2);
      flesh.visible = false;
      this.fleshMeshes.push(flesh);
      const a = joint(par, side * 0.3, 0.45, lz);
      this.plateAnchors.push(a);
    }
    // 脊背接缝（弱点）
    this.glowPart(body, Geo.box(0.08, 0.06, 1.8), C.seam, C.seamHot, 0, 0.42, 0.2, 1);
    this.seamAnchor = joint(body, SEAM_POINT.x, SEAM_POINT.y - 0.9, SEAM_POINT.z - 0.4);
    // 命中球（白模按身体分段近似）
    const blockHit: [THREE.Object3D, number, number, number, number][] = [
      [head, 0, 0, 0.45, 0.42], [chest, 0, 0, 0.2, 0.62], [body, 0, 0.05, 0, 0.72], [body, 0, 0, -0.6, 0.62],
      [this.spineJoints[3], 0, 0, -0.1, 0.42], [this.spineJoints[5], 0, 0, -0.1, 0.32],
    ];
    for (const [par, x, y, z, r] of blockHit) this.hitAnchors.push({ o: joint(par, x, y, z), r });
    this.setHeadAnchor(this.seamAnchor, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    // 命中球、接缝、岩甲中心改挂到骨骼上
    const hits: { o: THREE.Object3D; r: number }[] = [];
    for (const h of HIT_SPHERES) {
      const bone = n.pose.bone(h.bone);
      if (bone) hits.push({ o: this.anchorOn(bone, _v.set(h.p[0], h.p[1], h.p[2])), r: h.r });
    }
    if (hits.length === HIT_SPHERES.length) this.hitAnchors = hits;
    const spine = n.pose.bone('spine');
    if (spine) {
      this.seamAnchor = this.anchorOn(spine, SEAM_POINT);
      this.setHeadAnchor(this.seamAnchor, 0, 0, 0);
    }
    const centres = this.platePaint(n);
    for (let i = 0; i < PLATES; i++) {
      const bone = n.pose.bone(PLATE_BONES[i >> 1]);
      if (bone) this.plateAnchors[i] = this.anchorOn(bone, centres[i]);
    }
    // 白模的发光件、岩甲块按方块摆，对不上美术：收起
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
  }

  /**
   * 岩甲分区：按 LOD 网格顶点的绑定位置算出每个顶点属于哪块甲（plateId，-1 = 不是甲），写成几何体属性；
   * 本体材质的着色器按 uPlate[plateId] 把碎了的那一区画成熔肉发光（回熔时先红后黑）。返回每块甲的中心（网格坐标）。
   */
  private platePaint(n: NativeBody): THREE.Vector3[] {
    const sum = Array.from({ length: PLATES }, () => new THREE.Vector3());
    const cnt = new Array(PLATES).fill(0);
    for (const level of n.lod.levels) {
      const mesh = level.object as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!geo?.getAttribute('position')) continue;
      const pos = geo.getAttribute('position');
      const fresh = !platedGeometry.has(geo);
      const ids = fresh ? new Float32Array(pos.count) : (geo.getAttribute('plateId').array as Float32Array);
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const id = fresh ? plateOf(x, y, z) : ids[v];
        if (fresh) ids[v] = id;
        if (id >= 0 && level === n.lod.levels[0]) {
          sum[id].x += x; sum[id].y += y; sum[id].z += z;
          cnt[id]++;
        }
      }
      if (fresh) {
        geo.setAttribute('plateId', new THREE.BufferAttribute(ids, 1));
        platedGeometry.add(geo);
      }
    }
    const mat = n.materials[0];
    if (mat) {
      const prev = mat.onBeforeCompile;
      const heat = this.plateHeat, time = this.plateTime;
      mat.onBeforeCompile = (shader, renderer) => {
        prev.call(mat, shader, renderer);
        shader.uniforms.uPlate = { value: heat };
        shader.uniforms.uPlateTime = time;
        shader.vertexShader = 'attribute float plateId;\nflat varying float vPlate;\n'
          + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPlate = plateId;');
        shader.fragmentShader = `uniform float uPlate[${PLATES}];\nuniform float uPlateTime;\nflat varying float vPlate;\n`
          + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vPlate > -0.5) {
            float plateH = 0.0;
            for (int i = 0; i < ${PLATES}; i++) { if (abs(vPlate - float(i)) < 0.5) plateH = uPlate[i]; }
            if (plateH > 0.001) {
              // 1 = 刚碎的熔肉（黄白）；回熔时降到 0.5 是暗红的新壳，再到 0 变回黑玄武岩
              vec3 molten = mix(vec3(0.6, 0.07, 0.01), vec3(1.0, 0.62, 0.16), smoothstep(0.5, 1.0, plateH));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.025, 0.01), smoothstep(0.0, 0.5, plateH));
              totalEmissiveRadiance += molten * plateH * (1.5 + 0.35 * sin(uPlateTime * 5.0 + vPlate * 1.7));
            }
          }`);
      };
      mat.customProgramCacheKey = () => 'character-rim-tuo-plates';
      mat.needsUpdate = true;
    }
    return sum.map((s, i) => (cnt[i] > 0 ? s.divideScalar(cnt[i]) : new THREE.Vector3(i % 2 === 0 ? 0.3 : -0.3, 1.45,
      (PLATE_BANDS[i >> 1][0] + PLATE_BANDS[i >> 1][1]) / 2)));
  }

  /** 在骨骼下建一个锚点，位置按网格坐标（host 局部）给 */
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
    const st = this.state;
    if (st === 'biteWindup' || st === 'bite' || st === 'sweepWindup' || st === 'sweep' || st === 'roar' || st === 'lunge') {
      this.setState('land');
      this.accel = 14;
    } else if (st === 'surge') {
      this.setState('swim');
      this.ambushCd = AMBUSH_COOLDOWN[0];
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideWarnings();
  }

  private hideWarnings(): void {
    this.lane?.release();
    this.lane = null;
    this.ring?.release();
    this.ring = null;
  }

  private quake(strength: number, range: number, dur = 0.3): void {
    const k = clamp01(1 - this.distToPlayerXZ() / range);
    if (k > 0) this.ctx.fx.shake(strength * k, dur);
  }

  private yawToPlayer(): number {
    const pl = this.ctx.player.position;
    return Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
  }

  private floorY(): number {
    return this.ctx.stage?.arena?.floorY ?? this.position.y;
  }

  private onLava(): boolean {
    const L = this.lava;
    return !!L && isLava(L, this.position.x, this.position.z);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    const yawTo = this.yawToPlayer();
    this.ambushCd -= dt * this.attackRate;
    this.biteCd -= dt * this.attackRate;
    this.sweepCd -= dt * this.attackRate;
    if (!this.alerted && d < 28) {
      this.alerted = true;
      this.getHeadCenter(_p);
      this.ctx.audio.play('enemy_alert', { position: _p, volume: 0.8, pitch: 0.4 });
    }
    // 鼍鸣：血量第一次低于 40%（不在熔岩里、不在出招中）
    if (!this.roared && this.hp <= this.maxHp * ROAR_HP && this.state === 'land') {
      this.beginRoar();
      return;
    }
    switch (this.state) {
      case 'enter': {
        const L = this.lava;
        if (L && nearestLava(L, this.position, LAVA_SEEK, _t)) this.setState('toLava');
        else this.setState('land');
        break;
      }
      case 'toLava':
        this.toLavaStep(dt);
        break;
      case 'swim':
        this.swimStep(dt, d);
        break;
      case 'regrow':
        this.regrowStep(dt);
        break;
      case 'surge': {
        this.stopMoving();
        this.facing = rotateTowards(this.facing, yawTo, 4 * dt);
        const t = clamp01(this.stateTime / this.windTime);
        // 前 60% 跟着玩家，之后锁定扑击方向（侧移可躲）
        if (t < 0.6) this.lungeTarget.copy(this.ctx.player.position);
        this.updateLane(t);
        if (Math.floor(this.stateTime / 0.1) !== Math.floor((this.stateTime - dt) / 0.1)) {
          _p.copy(this.hasBank ? this.bank : this.position);
          _p.y = this.floorY();
          lavaBubbles(this.ctx, _p, 1.2 * this.sizeScale);
        }
        if (this.stateTime >= this.windTime) this.startLunge();
        break;
      }
      case 'lunge':
        this.lungeStep();
        break;
      case 'land':
        this.landStep(dt, d, yawTo);
        break;
      case 'biteWindup': {
        this.stopMoving();
        this.facePlayer(2, dt);
        if (this.stateTime >= this.windTime) this.bite(false);
        break;
      }
      case 'bite': {
        this.stopMoving();
        if (this.stateTime >= 0.45) this.toLand();
        break;
      }
      case 'sweepWindup': {
        this.stopMoving();
        this.updateRing(clamp01(this.stateTime / this.windTime));
        if (this.stateTime >= this.windTime) this.sweep();
        break;
      }
      case 'sweep': {
        this.stopMoving();
        if (this.stateTime >= 0.45) this.toLand();
        break;
      }
      case 'roar':
        this.roarStep(dt);
        break;
      default:
        this.setState('land');
    }
  }

  private toLand(): void {
    this.setState('land');
    this.accel = 14;
    this.hideWarnings();
    this.releaseAttack();
  }

  // ───────────── 熔岩：回熔、潜游、长甲 ─────────────

  /** 爬回熔岩：先走到最近的岸边（导航），再直线滑进去 */
  private toLavaStep(dt: number): void {
    const L = this.lava;
    if (!L || !nearestLava(L, this.position, LAVA_SEEK + 10, _t)) {
      this.toLand();
      return;
    }
    if (this.onLava()) {
      this.submerge();
      return;
    }
    this.accel = 14;
    const dist = Math.hypot(_t.x - this.position.x, _t.z - this.position.z);
    _t.y = this.position.y;
    if (dist > 3.5 && this.stateTime < 7) this.navigate(_t, this.speed * 1.3, 0.5);
    else this.setMove(_t.x - this.position.x, _t.z - this.position.z, this.speed * 1.6);
    this.faceMovement(TURN_RATE * 1.5, dt);
  }

  /** 滑进熔岩：熔岩溅起；有碎甲就先长甲，否则直接潜游 */
  private submerge(): void {
    this.hideWarnings();
    this.releaseAttack();
    this.emerged = false;
    this.shoreWait = 0;
    _p.set(this.position.x, this.floorY() + 0.2, this.position.z);
    moltenSplash(this.ctx, _p, this.sizeScale * 1.4, 16);
    this.ctx.fx.ring(_p, 2.2 * this.sizeScale, INFERNO.lava, 0.5);
    this.ctx.audio.play('skill_fire', { position: _p, volume: 0.8, pitch: 0.5 });
    this.setState(this.brokenCount > 0 ? 'regrow' : 'swim');
    this.replanAt = 0;
  }

  /** 熔岩里：沿熔岩寻路游向离玩家最近的岸；玩家在岸边够近就伏击，躲着岸太久就自己上岸 */
  private swimStep(dt: number, d: number): void {
    const L = this.lava;
    if (!L) {
      this.toLand();
      return;
    }
    const pl = this.ctx.player;
    this.accel = 10;
    this.ripple();
    const playerOnLava = isLava(L, pl.position.x, pl.position.z);
    if (this.ambushCd <= 0 && pl.alive && !playerOnLava && d <= AMBUSH_RANGE && this.verticalReach(2.5)
      && this.requestAttack('heavy', SURGE_TIME + LUNGE_MAX + 1)) {
      this.beginSurge(false);
      return;
    }
    this.shoreWait = d > EMERGE_DIST ? this.shoreWait + dt : Math.max(0, this.shoreWait - dt * 0.5);
    if (this.shoreWait >= EMERGE_AFTER && this.requestAttack('heavy', SURGE_TIME + LUNGE_MAX + 1)) {
      this.beginSurge(true);
      return;
    }
    if (!this.onLava()) {
      // 被挤上岸：回到最近的熔岩
      if (nearestLava(L, this.position, 6, _t)) this.setMove(_t.x - this.position.x, _t.z - this.position.z, SWIM_SPEED * 0.5);
      return;
    }
    this.replanAt -= dt;
    if (this.replanAt <= 0) {
      this.replanAt = REPLAN;
      this.route.plan(L, this.position, pl.position);
    }
    const pts = this.route.points;
    while (pts.length && Math.hypot(pts[0].x - this.position.x, pts[0].z - this.position.z) < 0.8) pts.shift();
    if (pts.length) {
      const wp = pts[0];
      const want = Math.atan2(wp.x - this.position.x, wp.z - this.position.z);
      this.facing = rotateTowards(this.facing, want, SWIM_TURN * dt);
      // 先转向再加速：大角度转弯时慢下来
      const align = Math.max(0.25, Math.cos(want - this.facing));
      this.setMove(Math.sin(this.facing), Math.cos(this.facing), SWIM_SPEED * align);
    } else {
      this.stopMoving();
      this.facing = rotateTowards(this.facing, this.yawToPlayer(), SWIM_TURN * 0.5 * dt);
    }
  }

  /** 潜熔时拖出的熔岩波纹 */
  private ripple(): void {
    const now = this.ctx.time.now;
    if (now - this.rippleAt < 0.3 || Math.hypot(this.velocity.x, this.velocity.z) < 0.5) return;
    this.rippleAt = now;
    this.localPoint(0, 0, -0.6, _p);
    _p.y = this.floorY() + 0.06;
    this.ctx.fx.ring(_p, 1.1 * this.sizeScale, INFERNO.lava, 0.6);
    this.ctx.fx.burst(_p, INFERNO.ember, 3, 1.5, 0.5, 0.08, -2);
  }

  /** 回熔长甲：5 秒内碎甲一块块长回来（先红后黑） */
  private regrowStep(dt: number): void {
    this.stopMoving();
    this.ripple();
    const t = clamp01(this.stateTime / REGROW_TIME);
    let k = 0;
    for (let i = 0; i < PLATES; i++) {
      if (!this.broken[i]) continue;
      // 错开：每块甲在自己的时间段里从熔肉冷成黑岩
      const start = (k * 0.12) % 0.4;
      this.plateHeat[i] = 1 - smooth((t - start) / (1 - start));
      k++;
    }
    if (Math.floor(this.stateTime / 0.4) !== Math.floor((this.stateTime - dt) / 0.4)) {
      this.getHeadCenter(_p);
      this.ctx.fx.burst(_p, INFERNO.ember, 4, 1.6, 0.6, 0.1, -3);
    }
    if (this.stateTime >= REGROW_TIME) {
      for (let i = 0; i < PLATES; i++) {
        this.broken[i] = false;
        this.plateHeat[i] = 0;
        this.plateHp[i] = this.maxHp * PLATE_HP;
      }
      this.setState('swim');
      this.replanAt = 0;
    }
  }

  // ───────────── 伏击扑咬 ─────────────

  private beginSurge(emerge: boolean): void {
    const L = this.lava;
    this.windTime = this.windup(SURGE_TIME, 0.45);
    this.setState('surge');
    this.stopMoving();
    this.emerged = emerge;
    this.shoreWait = 0;
    this.struck = false;
    this.lungeTarget.copy(this.ctx.player.position);
    this.hasBank = !!L && bankPoint(L, this.position, this.ctx.player.position, this.bank);
    this.hideWarnings();
    this.lane = GroundDecal.acquire(this.ctx.stageGroup, INFERNO.warn);
    this.lane.solid = true;
    this.updateLane(0);
    _p.copy(this.hasBank ? this.bank : this.position);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.9, pitch: 0.45 });
    this.ctx.audio.play('burn_tick', { position: _p, volume: 0.8, pitch: 0.4 });
  }

  /** 扑击线：从火鼍到锁定的扑击点 */
  private updateLane(t: number): void {
    if (!this.lane) return;
    const dx = this.lungeTarget.x - this.position.x, dz = this.lungeTarget.z - this.position.z;
    const len = Math.min(LUNGE_SPEED * LUNGE_MAX + 1, Math.hypot(dx, dz) + 1.5);
    this.lane.rect(this.position.x, this.floorY(), this.position.z, Math.atan2(dx, dz), len, 0.8 * this.sizeScale);
    this.lane.fill = t;
    this.lane.opacity = 0.3 + 0.5 * t;
  }

  private startLunge(): void {
    this.setState('lunge');
    this.hideWarnings();
    this.accel = 60;
    this.facing = Math.atan2(this.lungeTarget.x - this.position.x, this.lungeTarget.z - this.position.z);
    _p.set(this.position.x, this.floorY() + 0.3, this.position.z);
    moltenSplash(this.ctx, _p, this.sizeScale * 1.6, 22);
    this.ctx.fx.ring(_p, 2.6 * this.sizeScale, INFERNO.hot, 0.45);
    this.ctx.audio.play('enemy_charge', { position: _p, volume: 1, pitch: 0.6 });
    this.quake(0.35, 20, 0.25);
  }

  private lungeStep(): void {
    const dx = this.lungeTarget.x - this.position.x, dz = this.lungeTarget.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.setMove(Math.sin(this.facing), Math.cos(this.facing), LUNGE_SPEED);
    if (dist <= AMBUSH_REACH - 1 || this.distToPlayerXZ() <= AMBUSH_REACH - 1 || this.stateTime >= LUNGE_MAX
      || (this.stateTime > 0.1 && this.moveResult.hitWall)) {
      this.velocity.x *= 0.3;
      this.velocity.z *= 0.3;
      this.landTime = 0;
      this.ambushCd = this.ctx.rng.range(AMBUSH_COOLDOWN[0], AMBUSH_COOLDOWN[1]);
      this.bite(true);
    }
  }

  /** 咬：伏击扑咬 ×1.5，陆上扑咬 ×1 */
  private bite(ambush: boolean): void {
    this.setState('bite');
    this.ambushBite = ambush;
    this.accel = 14;
    const pl = this.ctx.player;
    this.localPoint(0, 0.8, 1.9, _p);
    this.ctx.audio.play('enemy_melee', { position: _p, volume: 1, pitch: 0.5 });
    const d = this.distToPlayerXZ();
    const reach = ambush ? AMBUSH_REACH : BITE_REACH;
    if (pl.alive && d <= reach + pl.radius && this.facingDot() > 0.4 && this.verticalReach(2)) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * (ambush ? AMBUSH_MULT : 1), 'none', this, _p);
      _v.set(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(ambush ? 7 : 5);
      _v.y = 3;
      pl.applyImpulse(_v);
      this.ctx.fx.shake(ambush ? 0.6 : 0.4, 0.25);
      moltenSplash(this.ctx, _b.copy(pl.position).setY(pl.position.y + 1), 0.8, 8);
    }
    this.biteCd = this.ctx.rng.range(BITE_COOLDOWN[0], BITE_COOLDOWN[1]);
    if (!ambush) this.releaseAttack();
  }

  // ───────────── 陆上 ─────────────

  private landStep(dt: number, d: number, yawTo: number): void {
    this.accel = 14;
    this.landTime += dt;
    const L = this.lava;
    // 回熔：碎甲够多，或上岸太久（甲没碎够也回去再伏击）
    const stay = this.emerged ? LAND_STAY_EMERGED : LAND_STAY;
    if (L && (this.brokenCount >= RETREAT_BROKEN || this.landTime >= stay) && nearestLava(L, this.position, LAVA_SEEK, _t)) {
      this.setState('toLava');
      this.releaseAttack();
      return;
    }
    this.facing = rotateTowards(this.facing, yawTo, TURN_RATE * dt);
    const fd = this.facingDot();
    if (this.sweepCd <= 0 && d <= SWEEP_RANGE && fd < 0.1 && this.verticalReach(1.8) && this.requestAttack('melee', 1.4)) {
      this.beginSweep();
      return;
    }
    if (this.biteCd <= 0 && d <= BITE_RANGE && fd > 0.75 && this.verticalReach(1.8) && this.requestAttack('melee', 1.2)) {
      this.windTime = this.windup(BITE_WINDUP, 0.3);
      this.setState('biteWindup');
      this.stopMoving();
      this.struck = false;
      this.localPoint(0, 0.9, 1.8, _p);
      this.ctx.audio.play('telegraph', { position: _p, volume: 0.6, pitch: 0.7 });
      return;
    }
    if (d > STOP_DIST) this.approachPlayer(this.speed, STOP_DIST);
    else this.stopMoving();
  }

  // ───────────── 甩尾 ─────────────

  private beginSweep(): void {
    this.windTime = this.windup(SWEEP_WINDUP, 0.4);
    this.setState('sweepWindup');
    this.stopMoving();
    this.struck = false;
    // 尾巴往玩家的反方向蓄力，横扫过身后半圈
    const pl = this.ctx.player.position;
    const lx = (pl.x - this.position.x) * Math.cos(this.facing) - (pl.z - this.position.z) * Math.sin(this.facing);
    this.sweepSide = lx >= 0 ? -1 : 1;
    this.sweepYaw = this.facing + Math.PI;
    this.hideWarnings();
    this.ring = GroundDecal.acquire(this.ctx.stageGroup, INFERNO.warn);
    this.ring.solid = true;
    this.updateRing(0);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.9 });
  }

  private updateRing(t: number): void {
    if (!this.ring) return;
    this.ring.circle(this.position.x, this.floorY(), this.position.z, SWEEP_REACH, this.radius * 0.5, this.sweepYaw, Math.PI / 2);
    this.ring.fill = t;
    this.ring.opacity = 0.3 + 0.5 * t;
  }

  private sweep(): void {
    this.setState('sweep');
    this.hideWarnings();
    const pl = this.ctx.player;
    this.localPoint(0, 0.5, -2.2, _p);
    this.ctx.fx.burst(_p, INFERNO.ember, 10, 6, 0.4, 0.08 * this.sizeScale, 6);
    this.ctx.audio.play('enemy_melee', { position: _p, volume: 1, pitch: 0.35 });
    this.quake(0.3, 18, 0.2);
    const d = this.distToPlayerXZ();
    const dy = pl.position.y - this.position.y;
    // 身后半圈（朝向余弦 < 0.2），起跳（离地 0.9 米以上）躲得过
    if (pl.alive && d <= SWEEP_REACH + pl.radius && this.facingDot() < 0.2 && dy > -1 && dy < 0.9) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * SWEEP_MULT, 'none', this, _p);
      this.sweepKnock(_v);
      pl.applyImpulse(_v);
      this.ctx.fx.shake(0.5, 0.25);
    }
    this.sweepCd = this.ctx.rng.range(SWEEP_COOLDOWN[0], SWEEP_COOLDOWN[1]);
  }

  /**
   * 甩尾的击退冲量：尾巴横扫的方向（切向）加一点往外；附近有熔岩就偏向最近的熔岩——扫进熔岩之后由 LavaSystem 结算
   * （火伤 + 托回），这里不另外扣血。
   */
  sweepKnock(out: THREE.Vector3): THREE.Vector3 {
    const pl = this.ctx.player.position;
    const dx = pl.x - this.position.x, dz = pl.z - this.position.z, len = Math.hypot(dx, dz) || 1;
    // 尾巴从 sweepSide 一侧扫向另一侧：切向 = 绕竖直轴的转向
    const tx = (-dz / len) * this.sweepSide, tz = (dx / len) * this.sweepSide;
    out.set(tx * 0.7 + (dx / len) * 0.5, 0, tz * 0.7 + (dz / len) * 0.5).normalize();
    const L = this.lava;
    if (L && nearestLava(L, pl, SWEEP_LAVA_SEEK, _f)) {
      _b.set(_f.x - pl.x, 0, _f.z - pl.z);
      const l = _b.length();
      if (l > 1e-3) out.lerp(_b.divideScalar(l), 0.75).normalize();
    }
    out.multiplyScalar(SWEEP_KNOCK);
    out.y = SWEEP_UP;
    return out;
  }

  // ───────────── 鼍鸣 ─────────────

  private beginRoar(): void {
    this.roared = true;
    this.setState('roar');
    this.stopMoving();
    this.hideWarnings();
    this.releaseAttack();
    this.roarR = 0;
    this.roarHit = false;
    this.getHeadCenter(_p);
    this.ctx.audio.play('boss_roar', { position: _p, volume: 0.9, pitch: 0.55 });
  }

  private roarStep(dt: number): void {
    this.stopMoving();
    if (this.stateTime < ROAR_WINDUP) {
      if (Math.floor(this.stateTime / 0.15) !== Math.floor((this.stateTime - dt) / 0.15)) {
        this.localPoint(0, 1.1, 1.9, _p);
        smokePuff(this.ctx, _p, this.sizeScale * 0.5, 3);
      }
      return;
    }
    if (this.roarR === 0) {
      _p.set(this.position.x, this.floorY() + 0.1, this.position.z);
      this.ctx.fx.ring(_p, ROAR_RADIUS, INFERNO.lava, ROAR_RADIUS / ROAR_SPEED);
      this.quake(0.6, 24, 0.5);
      this.splashFireSpots();
      this.roarR = 0.01;
    }
    const prev = this.roarR;
    this.roarR = Math.min(ROAR_RADIUS, this.roarR + ROAR_SPEED * dt);
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    // 贴地震波：波前扫过玩家时玩家在地上（离地 0.5 米内）就中
    if (!this.roarHit && pl.alive && d >= prev - 0.6 && d <= this.roarR + 0.6 && pl.position.y - this.position.y < 0.5 && pl.position.y - this.position.y > -1) {
      this.roarHit = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * ROAR_MULT, 'fire', this, this.position);
      _v.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z).normalize().multiplyScalar(5);
      _v.y = 4;
      pl.applyImpulse(_v);
    }
    if (this.roarR >= ROAR_RADIUS) this.toLand();
  }

  /** 附近岸边溅起几处燃烧的火点（有熔岩就挑熔岩边，没有就在周围） */
  private splashFireSpots(): void {
    const L = this.lava;
    let placed = 0;
    for (let k = 0; k < 24 && placed < FIRE_SPOTS; k++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
      const x = this.position.x + Math.sin(a) * r, z = this.position.z + Math.cos(a) * r;
      if (L && isLava(L, x, z)) continue;
      if (this.ctx.nav && !this.ctx.nav.isWalkable(x, z)) continue;
      if (L && k < 16 && !nearestLava(L, { x, z }, 3, _t)) continue;
      _p.set(x, this.floorY(), z);
      fireSpot(this.ctx, _p, FIRE_SPOT_R, FIRE_SPOT_TIME, this.def.damage * this.damageMult * 0.15);
      moltenSplash(this.ctx, _b.set(x, _p.y + 0.3, z), 1, 6);
      placed++;
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.hideWarnings();
    if (attackDirector.purging) return;
    const k = this.sizeScale;
    for (let i = 0; i < PLATES; i += 2) {
      this.plateAnchors[i].getWorldPosition(_p);
      basaltShards(this.ctx, _p, k, 10, 5);
    }
    this.getBodyCenter(_p);
    moltenSplash(this.ctx, _p, k * 1.4, 18);
    this.ctx.audio.play('shield_break', { position: _p, volume: 1, pitch: 0.45 });
    this.quake(0.45, 22, 0.35);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    let jaw = 0, lunge = 0, sweep = 0, roar = 0, rate = 8;
    const sink = st === 'swim' || st === 'regrow' ? 1 : st === 'surge' ? 0.8 : 0;
    if (st === 'surge') { lunge = 0.4 * clamp01(this.stateTime / this.windTime); jaw = 0.3; }
    else if (st === 'lunge') { lunge = 1; jaw = 1; rate = 20; }
    else if (st === 'biteWindup') { jaw = clamp01(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'bite') { jaw = this.stateTime < 0.08 ? 0.2 : 0; lunge = this.ambushBite ? Math.max(0, 1 - this.stateTime / 0.4) : 0.3; rate = 30; }
    else if (st === 'sweepWindup') { sweep = this.sweepSide * smooth(this.stateTime / this.windTime); rate = 14; }
    else if (st === 'sweep') { sweep = -this.sweepSide * (this.stateTime < 0.15 ? smooth(this.stateTime / 0.15) : 1 - smooth((this.stateTime - 0.15) / 0.3)); rate = 30; }
    else if (st === 'roar') { roar = this.stateTime < ROAR_WINDUP + 0.6 ? smooth(this.stateTime / 0.4) : 0; jaw = roar; rate = 10; }
    const k = 1 - Math.exp(-rate * dt);
    this.pSink = mix(this.pSink, sink, 1 - Math.exp(-(sink > this.pSink ? 3 : 10) * dt));
    this.pJaw = mix(this.pJaw, jaw, k);
    this.pLunge = mix(this.pLunge, lunge, k);
    this.pSweep = mix(this.pSweep, sweep, k);
    this.pRoar = mix(this.pRoar, roar, k);
    this.pSwim = mix(this.pSwim, st === 'swim' || st === 'regrow' || st === 'surge' ? 1 : 0, 1 - Math.exp(-4 * dt));
    this.plateTime.value = this.age;
    // 下沉：整只没进熔岩，只露背和眼
    const host = this.model.children[0];
    host.position.set(0, -SINK * this.pSink, ART_SHIFT_Z);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout(dt);
  }

  /** 行进波相位：陆上随步频，游泳时更快更大 */
  private advanceWave(dt: number): number {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const f = mix(0.35 * sp / this.sizeScale, 1.2 + 0.12 * sp, this.pSwim);
    this.wave = (this.wave + f * dt) % 1;
    return Math.min(1, sp / 0.6) * mix(1, 2.2, this.pSwim) + 0.15 * this.pSwim;
  }

  /** 白模动画：脊柱 S 形摆动、四肢对角爬行（游泳收腿）、张嘴、甩尾、碎甲 */
  private poseBlockout(dt: number): void {
    const amp = this.advanceWave(dt);
    const ph = this.wave * Math.PI * 2;
    for (const [i, j] of this.spineJoints.entries()) j.rotation.y = Math.sin(ph - i * 0.7) * 0.08 * amp * (1 + i * 0.15) + this.pSweep * (i >= 2 ? 0.3 : 0);
    this.head.rotation.x = -0.25 * this.pRoar - 0.1 * this.pLunge;
    this.jaw.rotation.x = 0.45 * this.pJaw;
    this.body.rotation.x = -0.08 * this.pLunge;
    const walk = (1 - this.pSwim) * Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / 1.5);
    for (const l of this.legs) {
      const off = (l.front === (l.side > 0) ? 0 : Math.PI);
      l.upper.rotation.y = Math.sin(ph + off) * 0.4 * walk * l.side + this.pSwim * 0.9 * -l.side;
      l.lower.rotation.x = 0.6 * this.pSwim;
    }
    for (let i = 0; i < PLATES; i++) {
      this.plateMeshes[i].visible = !this.broken[i] && this.plateHeat[i] < 0.5;
      this.fleshMeshes[i].visible = this.plateHeat[i] > 0;
    }
    this.glowTarget[2] = Math.max(...this.plateHeat);
  }

  /**
   * 美术骨骼动画（鳄形，creature_rigs/SK_Enemy_Tuo.json）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前端往下（下颌张开），负转 = 前端往上（仰头）。
   * - 步态：高位爬行，对角步；脊柱从头到尾一节节横摆（行进波，绕 Y），尾巴越往后摆幅越大。
   * - 潜游：四肢收到身侧往后贴（脚掌朝后），行进波加大加快，靠尾巴推进。
   * - 扑咬：前身抬起、下颌张开；甩尾：整条尾巴先往一边蓄、再横扫到另一边；鼍鸣：仰头张嘴。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const amp = this.advanceWave(dt);
    const ph = this.wave * Math.PI * 2;
    const swim = this.pSwim;
    // 行进波
    for (const [i, b] of WAVE.entries()) {
      const a = WAVE_AMP[i] * amp * (1 + swim * (i >= 4 ? 0.8 : 0.3));
      P.rotate(b, AY, Math.sin(ph - i * 0.65) * a);
    }
    // 甩尾：尾巴整条往一边蓄 / 扫
    for (const [i, b] of TAIL.entries()) P.rotate(b, AY, this.pSweep * (0.18 + i * 0.03));
    if (this.pSweep !== 0) P.rotate('hips', AY, this.pSweep * 0.12);
    // 扑击前身抬起、仰头吼
    P.rotate('chest', AX, -0.12 * this.pLunge - 0.08 * this.pRoar - this.hurtKick * 0.04);
    P.rotate('neck', AX, -0.1 * this.pLunge - 0.18 * this.pRoar);
    P.rotate('head', AX, -0.08 * this.pJaw - 0.15 * this.pRoar);
    P.rotate('jaw', AX, 0.42 * this.pJaw);
    // 看向玩家
    let dyaw = this.yawToPlayer() - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    if (this.state === 'land' || this.state === 'surge') P.rotate('head', AY, THREE.MathUtils.clamp(dyaw, -0.4, 0.4) * 0.6);
    // 腿：陆上对角步（两骨 IK）；游泳收在身侧往后贴
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const move = clamp01(sp / 0.5) * (1 - swim);
    const freq = 0.45 + 0.2 * sp / this.sizeScale;
    this.gait = (this.gait + freq * dt * move) % 1;
    const sweep = Math.min(GAIT_SWEEP, (sp * GAIT_DUTY) / (Math.max(0.3, freq) * this.sizeScale));
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
        dy = Math.sin(t * Math.PI) * GAIT_LIFT;
      }
      // 游泳：收向身体、抬到腹侧、往后贴
      const tuckX = -leg.side * 0.18 * swim, tuckY = 0.3 * swim, tuckZ = -(leg.front ? 0.3 : 0.4) * swim;
      _t.set(rest.x + tuckX, rest.y + dy * (1 - swim) + tuckY, rest.z + dz * (1 - swim) + tuckZ);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1 - 0.8 * swim);
    }
  }

  /** 一只脚落地：扬起火山灰，按距离轻震屏 */
  private footfall(bone: string): void {
    const b = this.nativeBody?.pose.bone(bone);
    if (!b) return;
    b.getWorldPosition(_p);
    _p.y = this.position.y + 0.05;
    this.ctx.fx.burst(_p, INFERNO.smoke, 3, 1.2, 0.5, 0.16 * this.sizeScale, 4);
    this.quake(0.04, 18, 0.1);
  }
}

/** 网格坐标（绑定姿势）里的顶点属于哪块岩甲：四排 × 左右两列，脊背接缝和身体下半、四肢、头尾都不算 */
function plateOf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  if (y < PLATE_Y || ax < SEAM_HALF || ax > PLATE_HALF) return -1;
  for (let b = 0; b < PLATE_BANDS.length; b++) {
    const [z0, z1] = PLATE_BANDS[b];
    if (z >= z0 && z < z1) return b * 2 + (x >= 0 ? 0 : 1);
  }
  return -1;
}

/** 岩甲 / 熔肉 / 潜熔：全局伤害修正，只对火鼍生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof Tuo ? enemy.armourFactor(req) : 1));
}
