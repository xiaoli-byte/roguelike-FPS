/**
 * 祸斗（huodou，第三章 · 祝融火狱的群怪，火坛一侧）：志怪里食火、吐火的黑犬，火灾的凶兆。以中国细犬为原型：
 * 深而窄的胸、收紧的细腰、细长的四肢、长窄吻、垂耳、鞭尾；短毛烧成哑光的炭黑，颈上一圈雕塑感的大簇鬃毛，
 * 两侧肋间裂开一道道口子，里面是发亮的熔火腹（弱点：从侧面打，吃过火后更大更亮），嘴和喉咙透熔岩橙光，
 * 项圈上挂一只发黑的铜铃。和炭童同为群怪：炭童扑脸、抛炭、复燃；祸斗三四只一群包抄，还会吃掉地上的火变强。
 *
 * - 包抄：同一群按编号分角色——一只守在玩家正前方 6 米吠叫（吸引视线），其余绕到玩家的两侧和身后 4.5 米；
 *   绕到身后（玩家视野外）时会低吼（听声辨位）。就位、冷却好了就从侧后扑上来。
 * - 扑咬：3 米内压低前身 0.3 秒（张嘴、肋间火光一亮），扑出约 2.5 米咬一口；收势 0.55 秒。
 * - 食火：8 米内有火（炭童的余烬炭堆、抛炭留下的地火、其他敌人登记的地火、熔岩边）就跑过去，侧身对着玩家低头吃 1 秒：
 *   火被一股一股吸进嘴里，炭堆 / 地火被吃掉（炭童彻底死）。每吃一次体型大一圈、火腹更亮更大，最多 3 次。
 *   吃的时候侧腹正对着玩家，是打弱点的好时机。
 * - 吐火：吃过火才会。腹部起伏、喉咙发亮 0.6 秒（地面朱红扇形预警由内向外填满），喷出 0.8 秒扇形火（半角 26°，
 *   射程 6.5 + 1.5 × 吃火次数 米，每 0.2 秒一跳火伤，掩体能挡）；喷完肚子就空了（体型、火光回到原样），收势 0.9 秒（输出窗口）。
 * - 步态（真实细犬）：慢时对角小跑；追击时双悬空奔跑——后腿蹬地后身体伸展腾空、前腿落地后身体收拢再腾空，腰椎大幅屈伸。
 *
 * 状态机：run → biteWindup → bite → recover → run
 *         run → seekFire → eat → run
 *         run → spitWindup → spit → recover → run
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { Geo, flat, joint, part } from '../Models';
import { FLAME_FX_TIME, applyFlameFur, createFlameTongue, type FlameFurHandle, type FlameTongue } from '../fx/FlameFx';
import { BreathCone, INFERNO, hostAnchor, raycastSpheres, suckFire, type HitSphere } from '../fx/InfernoPackFx';
import { findFire, findLavaEdge, type FireSource } from '../inferno/FireFeed';
import { SpringTail, mix, smooth } from '../frost/PackMotion';

export const HUODOU_DEF: ScaledEnemyDef = {
  id: 'huodou',
  name: '祸斗',
  // 美术按头高 1.1 米、体长 1.0 米（不含垂下的鞭尾）制作，游戏里放大 1.2 倍：头高约 1.3 米、连尾全长约 1.4 米
  scale: 1.2,
  hp: 70,
  speed: 8,
  radius: 0.32,
  height: 0.95,
  damage: 12,
  coins: [1, 3],
  essence: 1,
  // 命中判定是挂在骨骼上的几颗球（长条身体）；headY 只用于视线和头顶血条
  headY: 0.92,
  headRadius: 0.12,
  knockbackResist: 0,
  color: 0xff6a1a,
};

/** 包抄：正面守位距离、侧后包抄距离、就位判定、各角色相对玩家视线的方位（弧度，0 = 正前方） */
const FRONT_R = 6;
const FLANK_R = 4.5;
const SLOT_ARRIVE = 1.8;
const SLOT_ANGLES = [0, 1.4, -1.4, Math.PI, 2.35, -2.35] as const;
/** 吠叫间隔、低吼间隔、低吼判定（在玩家视线后方：与视线夹角余弦小于这个值） */
const BARK_GAP = [1.0, 1.6] as const;
const GROWL_GAP = 3.5;
const BEHIND_COS = -0.3;
/** 扑咬：触发距离、前摇、扑出速度 / 最长时间、命中距离、收势 */
const BITE_RANGE = 3;
const BITE_WINDUP = 0.3;
const BITE_SPEED = 10;
const BITE_TIME = 0.3;
const BITE_HIT = 1.3;
const BITE_RECOVER = 0.55;
/** 食火：找火的距离、吃的时长、最多吃几次、吃完的间隔、站位离火多远（米，放大前）、跑过去的超时 */
const EAT_SEEK = 8;
const EAT_TIME = 1;
export const MAX_MEALS = 3;
const EAT_GAP = 1.2;
const EAT_REACH = 0.35;
const SEEK_TIMEOUT = 3.5;
/** 每吃一次：体型、火腹判定球放大多少 */
const GROW_PER_MEAL = 0.08;
const WEAK_PER_MEAL = 0.15;
/** 吐火：前摇、喷火时长、跳伤间隔、每跳伤害倍率、扇形半角、射程（基础 + 每次吃火）、收势 */
const SPIT_WINDUP = 0.6;
const SPIT_TIME = 0.8;
const SPIT_TICK = 0.2;
const SPIT_TICK_MULT = 0.3;
const SPIT_HALF = 0.45;
const SPIT_RANGE = [6.5, 1.5] as const;
const SPIT_RECOVER = 0.9;
/** 美术网格实测（模型单位，脚底原点，面朝 +Z）：嘴、胸、肋间火腹 */
const MOUTH = new THREE.Vector3(0, 0.87, 0.47);
const BODY = new THREE.Vector3(0, 0.6, 0.05);
const FLANK = new THREE.Vector3(0.075, 0.56, 0.1);
/**
 * 步态（美术骨骼）：每条腿一个相位（触地起点），触地段脚往后扫、腾空段抬脚前摆，脚位用两骨 IK 解
 * （前腿 upperarm→forearm→腕；后腿 thigh→shin→跗关节，跖骨保持竖直）。
 * 小跑：对角步（左前 + 右后同相）；奔跑：双悬空——后腿一对先落地（左先右后），半个周期后前腿一对落地。
 */
const GAIT_FREQ = [1.9, 3.1] as const;
const GAIT_DUTY = [0.55, 0.28] as const;
const GAIT_SWEEP = 0.46;
const GAIT_LIFT = [0.06, 0.13] as const;
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, trot: 0, gallop: 0.5 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, trot: 0.5, gallop: 0.6 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, trot: 0.5, gallop: 0 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, trot: 0, gallop: 0.1 },
] as const;
/** 肋间火腹上的火舌（模型空间）：每侧两片，跟着吃火次数变大 */
const FLANK_TONGUES = [
  { bone: 'chest', at: [0.085, 0.55, 0.12] },
  { bone: 'spine', at: [0.08, 0.6, -0.02] },
  { bone: 'chest', at: [-0.085, 0.55, 0.12] },
  { bone: 'spine', at: [-0.08, 0.6, -0.02] },
] as const;

const C = {
  coat: 0x2a2624, coatHi: 0x3c3532, ruff: 0x302a28, belly: 0xff7a22, bellyHot: 0xffe08a, collar: 0xa8281e, bell: 0x6a5a3a,
  eye: 0xff7a1a, eyeHot: 0xfff2b0, claw: 0x141010,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Huodou extends StandardEnemy {
  /** 同一群的角色分配（敌人 id → 编号，按 id 排序）与刷新时间 */
  private static roles = new Map<number, number>();
  private static roleStamp = -Infinity;

  private body!: THREE.Group;
  private chestJ!: THREE.Group;
  private neckJ!: THREE.Group;
  private headJ!: THREE.Group;
  private jawJ!: THREE.Group;
  private readonly legJ: { upper: THREE.Group; lower: THREE.Group; front: boolean; side: number }[] = [];
  private readonly tailJ: THREE.Group[] = [];
  private readonly bellyGlows: THREE.Mesh[] = [];
  private readonly hits: HitSphere[] = [];
  /** 吃过几次火（0..3），吐火后清零 */
  meals = 0;
  /** 体型成长（随吃火次数平滑变化） */
  private growth = 1;
  private eatCooldown = 0;
  /** 正在去吃 / 正在吃的火 */
  fireTarget: FireSource | null = null;
  private readonly stand = new THREE.Vector3();
  private eatYaw = 0;
  private windTime = BITE_WINDUP;
  private recoverTime = 0.5;
  private biteHit = false;
  private readonly biteDir = new THREE.Vector3();
  private spitYaw = 0;
  private spitRange: number = SPIT_RANGE[0];
  private spitTick = 0;
  /** 本次吐火的扇形（测试与调试用） */
  cone: BreathCone | null = null;
  private barkTimer = 0;
  private growlTimer = 0;
  /** 最近一次低吼的时间（测试用） */
  lastGrowl = -Infinity;
  private readonly slot = new THREE.Vector3();
  private gait = 0;
  private tailSpring: SpringTail | null = null;
  private fur: FlameFurHandle | null = null;
  private readonly tongues: { m: FlameTongue; base: number; phase: number }[] = [];
  private mouthTongue: { m: FlameTongue; base: number } | null = null;
  private mouthAnchor: THREE.Object3D | null = null;
  private bellSwing = 0;
  private bellVel = 0;
  private lastFacing = 0;
  // 平滑后的姿态参数
  private pGallop = 0;
  private pCrouch = 0;
  private pEat = 0;
  private pSpit = 0;
  private pBark = 0;
  private pGrowl = 0;
  private pLunge = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, HUODOU_DEF, opts);
    this.accel = 26;
    this.walkScale = 0.9;
    this.stepRate = 2.4;
    this.cooldown = ctx.rng.range(0.8, 1.8);
    this.barkTimer = ctx.rng.range(0.3, 1.2);
    this.lastFacing = this.facing;
  }

  // ───────────── 模型（白模兜底：?classic 或资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const coat = flat(C.coat, { rough: 0.85 }), hi = flat(C.coatHi, { rough: 0.8 }), ruff = flat(C.ruff, { rough: 0.9 });
    const claw = flat(C.claw, { rough: 0.5 });
    // 身体：深胸 + 收紧的腰 + 臀（以腰为根）
    const body = joint(root, 0, 0.72, -0.05);
    this.body = body;
    part(body, Geo.ico(0.1, 1), coat, 0, -0.02, 0).scale.set(0.9, 1, 1.6);
    part(body, Geo.ico(0.12, 1), coat, 0, 0, -0.2).scale.set(0.95, 1, 1.1);
    const chest = joint(body, 0, 0, 0.18);
    this.chestJ = chest;
    part(chest, Geo.ico(0.16, 1), coat, 0, -0.08, 0.04).scale.set(0.7, 1.15, 1.1);
    // 肋间火腹：两侧各三道发光裂口
    for (const s of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const g = this.glowPart(chest, Geo.box(0.012, 0.16, 0.03), C.belly, C.bellyHot, s * 0.105, -0.12, -0.04 - i * 0.07, 1);
        g.rotation.x = 0.35;
        this.bellyGlows.push(g);
      }
    }
    // 颈与鬃毛、项圈、铜铃
    const neck = joint(chest, 0, 0.02, 0.12);
    neck.rotation.x = -0.7;
    this.neckJ = neck;
    part(neck, Geo.cyl(0.06, 0.08, 0.26, 7, 'bottom'), coat, 0, 0, 0);
    for (let i = 0; i < 5; i++) part(neck, Geo.cone(0.05, 0.14, 4), ruff, (i % 2 ? 1 : -1) * 0.04, 0.05 + i * 0.04, -0.05, -1.9, 0, 0);
    part(neck, Geo.torus(0.085, 0.02, 4, 10), flat(C.collar), 0, 0.03, 0, Math.PI / 2 - 0.2, 0, 0);
    part(neck, Geo.cone(0.035, 0.06, 6), flat(C.bell, { metal: 0.6, rough: 0.4 }), 0, -0.04, 0.09);
    // 头：长窄吻、垂耳、发光小眼；下颌单独一节
    const head = joint(neck, 0, 0.26, 0);
    head.rotation.x = 0.7;
    this.headJ = head;
    part(head, Geo.ico(0.075, 1), coat, 0, 0.02, 0).scale.set(0.95, 0.95, 1.15);
    part(head, Geo.cyl(0.03, 0.05, 0.2, 6), coat, 0, -0.01, 0.13, Math.PI / 2, 0, 0);
    for (const s of [1, -1]) {
      this.glowPart(head, Geo.ico(0.014, 1), C.eye, C.eyeHot, s * 0.04, 0.035, 0.07);
      part(head, Geo.box(0.02, 0.1, 0.06), hi, s * 0.065, 0.0, -0.03, 0.2, 0, s * 0.35);
    }
    const jaw = joint(head, 0, -0.035, 0.05);
    this.jawJ = jaw;
    part(jaw, Geo.cyl(0.02, 0.035, 0.17, 6), coat, 0, -0.005, 0.08, Math.PI / 2, 0, 0);
    this.glowPart(jaw, Geo.box(0.04, 0.01, 0.15), C.belly, C.bellyHot, 0, 0.012, 0.08, 1);
    this.setHeadAnchor(head, 0, 0.03, 0.03);
    // 四条细长腿：前腿在胸下，后腿在臀下（膝朝前、跗关节朝后）
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(front ? chest : body, s * 0.075, front ? -0.1 : -0.02, front ? 0.0 : -0.24);
        part(upper, Geo.cyl(0.045, 0.03, 0.3, 6, 'top'), coat, 0, 0, 0);
        const lower = joint(upper, 0, -0.3, 0);
        part(lower, Geo.cyl(0.025, 0.02, 0.3, 6, 'top'), coat, 0, 0, 0);
        part(lower, Geo.box(0.05, 0.03, 0.08), coat, 0, -0.31, 0.03);
        for (let k = 0; k < 4; k++) part(lower, Geo.cone(0.006, 0.03, 4), claw, (k - 1.5) * 0.012, -0.315, 0.075, Math.PI / 2, 0, 0);
        this.legJ.push({ upper, lower, front, side: s });
      }
    }
    // 鞭尾五节
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 5; i++) {
      const seg = joint(parent, 0, i === 0 ? 0.0 : -0.1, i === 0 ? -0.33 : 0);
      seg.rotation.x = i === 0 ? 0.5 : 0.15;
      part(seg, Geo.cyl(0.018 - i * 0.002, 0.022 - i * 0.002, 0.1, 5, 'top'), coat, 0, 0, 0);
      this.tailJ.push(seg);
      parent = seg;
    }
    return root;
  }

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    P?.reset();
    const at = (bone: string, fallback: THREE.Object3D): THREE.Object3D => P?.bone(bone) ?? fallback;
    // 命中球：两侧肋间火腹（弱点）+ 胸、腰、臀、颈、头 + 四条腿
    this.hits.push({ anchor: hostAnchor(at('chest', this.chestJ), host, FLANK.x, FLANK.y, FLANK.z), r: 0.11, head: true });
    this.hits.push({ anchor: hostAnchor(at('chest', this.chestJ), host, -FLANK.x, FLANK.y, FLANK.z), r: 0.11, head: true });
    this.hits.push({ anchor: hostAnchor(at('chest', this.chestJ), host, 0, 0.62, 0.24), r: 0.16, head: false });
    this.hits.push({ anchor: hostAnchor(at('spine', this.body), host, 0, 0.68, -0.04), r: 0.12, head: false });
    this.hits.push({ anchor: hostAnchor(at('hips', this.body), host, 0, 0.66, -0.24), r: 0.14, head: false });
    this.hits.push({ anchor: hostAnchor(at('neck', this.neckJ), host, 0, 0.82, 0.27), r: 0.1, head: false });
    this.hits.push({ anchor: hostAnchor(at('head', this.headJ), host, 0, 0.93, 0.38), r: 0.11, head: false });
    for (const s of [1, -1]) {
      this.hits.push({ anchor: hostAnchor(at(s > 0 ? 'forearm_L' : 'forearm_R', this.legJ[s > 0 ? 0 : 1].lower), host, s * 0.075, 0.28, 0.2), r: 0.07, head: false });
      this.hits.push({ anchor: hostAnchor(at(s > 0 ? 'shin_L' : 'shin_R', this.legJ[s > 0 ? 2 : 3].lower), host, s * 0.065, 0.38, -0.25), r: 0.08, head: false });
    }
    this.mouthAnchor = hostAnchor(at('head', this.headJ), host, MOUTH.x, MOUTH.y, MOUTH.z);
    if (!n || !P) return;
    // 白模身体整组隐藏（含发光件）
    this.body.visible = false;
    // 视线 / 头顶血条：跟着头骨
    const headBone = P.bone('head');
    if (headBone) this.setHeadAnchor(hostAnchor(headBone, host, 0, 0.95, 0.33), 0, 0, 0);
    // 炭黑毛里的熔岩光（火腹裂口、嘴和喉咙、眼睛）：按贴图颜色识别的自发光
    if (n.materials[0]) this.fur = applyFlameFur(n.materials[0], 0xff7a22);
    host.updateWorldMatrix(true, true);
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    const attach = (bone: THREE.Object3D, x: number, y: number, z: number, size: number): { m: FlameTongue; base: number } => {
      const m = createFlameTongue(Math.random(), 0xfff0c0, 0xff9a30, 0xd8401a);
      bone.add(m);
      m.position.copy(bone.worldToLocal(host.localToWorld(_v.set(x, y, z))));
      const base = (size * hostScale) / Math.max(1e-6, bone.getWorldScale(_w).x);
      m.scale.setScalar(base);
      return { m, base };
    };
    for (const f of FLANK_TONGUES) {
      const b = P.bone(f.bone);
      if (!b) continue;
      const t = attach(b, f.at[0], f.at[1], f.at[2], 0.1);
      this.tongues.push({ ...t, phase: Math.random() * 10 });
    }
    const jaw = P.bone('jaw') ?? headBone;
    if (jaw) this.mouthTongue = attach(jaw, MOUTH.x, MOUTH.y - 0.02, MOUTH.z - 0.02, 0.12);
    // 鞭尾弹簧骨骼
    const tails = [1, 2, 3, 4, 5].map((i) => P.bone(`tail_${i}`));
    if (tails.every((b): b is THREE.Bone => !!b)) {
      this.tailSpring = new SpringTail(tails, { stiffness: [5, 3.6, 2.6, 1.9, 1.4], drag: 0.28, gravity: 0.35, maxBend: 0.55, clearance: 0.05 });
    }
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale * this.growth, origin, dir, maxDist, out, 1 + WEAK_PER_MEAL * this.meals);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(BODY.x, BODY.y * this.growth, BODY.z, out);
  }

  /** 嘴（世界坐标） */
  mouth(out: THREE.Vector3): THREE.Vector3 {
    if (this.mouthAnchor && this.age >= this.spawnDuration) return this.mouthAnchor.getWorldPosition(out);
    return this.localPoint(MOUTH.x, MOUTH.y, MOUTH.z, out);
  }

  /** 当前吐火射程（米） */
  get spitReach(): number {
    return SPIT_RANGE[0] + SPIT_RANGE[1] * Math.max(1, this.meals);
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const ctx = this.ctx;
    const d = this.distToPlayerXZ();
    if (this.eatCooldown > 0) this.eatCooldown -= dt;
    this.growlTimer -= dt;
    switch (this.state) {
      case 'run':
        this.run(dt, d);
        break;
      case 'biteWindup': {
        // 压低前身、张嘴，火腹一亮
        this.stopMoving();
        this.facePlayer(10, dt);
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        if (this.stateTime >= this.windTime) this.launchBite();
        break;
      }
      case 'bite':
        this.setMove(this.biteDir.x, this.biteDir.z, BITE_SPEED);
        this.glowTarget[0] = 1;
        if (!this.biteHit && d <= BITE_HIT + 0.4 && this.verticalReach(1.4)) {
          this.biteHit = this.melee(BITE_HIT, this.def.damage, 0.3);
          if (this.biteHit) {
            this.playerChest(_v);
            ctx.fx.burst(_v, INFERNO.spark, 8, 3, 0.3, 0.06, 4);
          }
        }
        if (this.stateTime >= BITE_TIME || this.biteHit || (this.moveResult.hitWall && this.stateTime > 0.1)) {
          this.stopMoving();
          this.velocity.x *= 0.3;
          this.velocity.z *= 0.3;
          this.accel = 26;
          this.recoverTime = BITE_RECOVER;
          this.setState('recover');
        }
        break;
      case 'seekFire': {
        const src = this.fireTarget;
        if (!src || !src.edible() || (src.claimedBy !== null && src.claimedBy !== this.id) || this.stateTime > SEEK_TIMEOUT) {
          this.dropFire();
          break;
        }
        const dx = this.stand.x - this.position.x, dz = this.stand.z - this.position.z;
        const len = Math.hypot(dx, dz);
        if (len <= 0.35 || (len <= 1.0 && this.stateTime > 1.5)) {
          this.startEat();
          break;
        }
        if (len < 2.5) this.setMove(dx, dz, this.speed * Math.min(1, 0.4 + len * 0.4));
        else this.navigate(this.stand, this.speed * 1.05, 0.3);
        this.faceMovement(10, dt);
        break;
      }
      case 'eat': {
        // 低头吃火：侧腹对着玩家（站位就是按这个挑的）
        const src = this.fireTarget;
        this.stopMoving();
        this.facing = this.eatYaw + Math.sin(this.stateTime * 9) * 0.03;
        this.glowTarget[0] = 0.4 + 0.4 * clamp01(this.stateTime / EAT_TIME);
        if (!src || !src.edible()) {
          this.dropFire();
          break;
        }
        if (this.stateTime >= EAT_TIME) this.finishEat(src);
        break;
      }
      case 'spitWindup': {
        // 腹部起伏、喉咙发亮；朝向锁死（扇形预警与喷火方向一致）
        this.stopMoving();
        this.facing = this.spitYaw;
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        this.cone?.arm(t);
        if (this.stateTime >= this.windTime) {
          this.cone?.fire();
          this.spitTick = 0;
          this.setState('spit');
          ctx.audio.play('skill_fire', { position: this.position, volume: 0.9, pitch: 0.8 });
        }
        break;
      }
      case 'spit':
        this.stopMoving();
        this.facing = this.spitYaw;
        this.glowTarget[0] = 1;
        this.spitTick -= dt;
        if (this.spitTick <= 0) {
          this.spitTick += SPIT_TICK;
          this.breathDamage();
        }
        if (this.stateTime >= SPIT_TIME) {
          this.cone?.release();
          this.cone = null;
          // 肚子空了：体型、火光回到原样
          this.meals = 0;
          this.releaseAttack();
          this.rollCooldown(1.8, 2.8);
          this.recoverTime = SPIT_RECOVER;
          this.setState('recover');
        }
        break;
      case 'recover':
        this.stopMoving();
        this.glowTarget[0] = 0.15;
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('run');
        }
        break;
      default:
        this.setState('run');
    }
  }

  /** 追击：近了扑咬；吃过火就吐火；身边有火就去吃；否则按角色包抄 */
  private run(dt: number, d: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.glowTarget[0] = 0.15 + 0.1 * this.meals;
    const reach = this.verticalReach(1.4);
    if (this.cooldown <= 0 && this.sees && reach && this.onGround && d <= BITE_RANGE && this.requestAttack('melee', 1.4)) {
      this.windTime = this.windup(BITE_WINDUP, 0.22);
      this.setState('biteWindup');
      ctx.audio.play('enemy_alert', { position: this.position, volume: 0.5, pitch: 1.1 });
      return;
    }
    if (this.meals > 0 && this.cooldown <= 0 && this.sees && reach && this.onGround && d >= 2 && d <= this.spitReach * 0.85
      && this.requestAttack('ranged', SPIT_WINDUP + SPIT_TIME + 0.5)) {
      this.startSpit();
      return;
    }
    if (this.meals < MAX_MEALS && this.eatCooldown <= 0 && this.onGround && !(d < BITE_RANGE + 0.5 && this.cooldown <= 0)) {
      const src = findFire(ctx, this.position, EAT_SEEK, this.id) ?? findLavaEdge(ctx, this.position, EAT_SEEK);
      if (src && this.claimFire(src)) return;
    }
    if (!this.sees && this.blindTime > 0.6) {
      this.approachPlayer(this.speed, 2);
      this.faceMovement(8, dt);
      return;
    }
    // 包抄：按角色去玩家正前方 / 两侧 / 身后的站位
    const role = this.role();
    const fwdX = -Math.sin(pl.yaw), fwdZ = -Math.cos(pl.yaw);
    const ang = SLOT_ANGLES[role % SLOT_ANGLES.length];
    const r = role === 0 ? FRONT_R : FLANK_R;
    const sx = fwdX * Math.cos(ang) - fwdZ * Math.sin(ang), sz = fwdX * Math.sin(ang) + fwdZ * Math.cos(ang);
    this.slot.set(pl.position.x + sx * r, this.position.y, pl.position.z + sz * r);
    if (!ctx.nav.isWalkable(this.slot.x, this.slot.z)) ctx.nav.nearestWalkable(this.slot, this.slot);
    const toSlot = Math.hypot(this.slot.x - this.position.x, this.slot.z - this.position.z);
    // 绕到身后：低吼
    const dx = this.position.x - pl.position.x, dz = this.position.z - pl.position.z;
    const behind = (dx * fwdX + dz * fwdZ) / Math.max(0.01, d) < BEHIND_COS;
    if (behind && d < 10 && this.growlTimer <= 0) {
      this.growlTimer = GROWL_GAP;
      this.lastGrowl = ctx.time.now;
      this.pGrowl = 1;
      ctx.audio.play('enemy_alert', { position: this.position, volume: 0.7, pitch: 0.42 });
    }
    if (role === 0) {
      // 正面：守在前方吠叫，玩家冲过来就咬（冷却好了自己压上去）
      this.barkTimer -= dt;
      if (this.barkTimer <= 0 && this.sees && d < 14) {
        this.barkTimer = ctx.rng.range(BARK_GAP[0], BARK_GAP[1]);
        this.pBark = 1;
        ctx.audio.play('enemy_alert', { position: this.position, volume: 0.6, pitch: 0.95 });
      }
      if (this.cooldown <= 0 && d < FRONT_R + 1) this.approachPlayer(this.speed, 1.5);
      else if (toSlot > 1) this.navigate(this.slot, this.speed, 0.6);
      else this.keepRange(FRONT_R - 1, FRONT_R + 1, this.speed * 0.4, 0.5);
      if (d < 12) this.facePlayer(8, dt);
      else this.faceMovement(8, dt);
      return;
    }
    // 侧后：先绕到位，就位且冷却好了就扑上来
    if (this.cooldown <= 0 && (toSlot <= SLOT_ARRIVE || d <= BITE_RANGE + 1.5)) {
      this.approachPlayer(this.speed, 1.5);
      this.faceMovement(10, dt);
      return;
    }
    if (toSlot > 0.8) {
      // 绕：离玩家太近时先往外拐一点，免得从玩家脸前穿过去
      if (d < r - 1) {
        const px = dx / Math.max(0.01, d), pz = dz / Math.max(0.01, d);
        _v.set(this.slot.x - this.position.x, 0, this.slot.z - this.position.z).normalize();
        this.setMove(_v.x + px * 0.6, _v.z + pz * 0.6, this.speed);
      } else this.navigate(this.slot, this.speed, 0.5);
      this.faceMovement(10, dt);
    } else {
      this.stopMoving();
      this.facePlayer(6, dt);
    }
  }

  /** 本只在群里的编号（同一群按 id 排序；每半秒刷新一次） */
  private role(): number {
    const now = this.ctx.time.now;
    if (now - Huodou.roleStamp > 0.5 || now < Huodou.roleStamp) {
      Huodou.roleStamp = now;
      Huodou.roles.clear();
      const pack = this.ctx.enemies.list.filter((e): e is Huodou => e instanceof Huodou && e.alive);
      pack.sort((a, b) => a.id - b.id);
      pack.forEach((e, i) => Huodou.roles.set(e.id, i));
    }
    return Huodou.roles.get(this.id) ?? 0;
  }

  /** 占住一处火，挑站位：侧身对着玩家（嘴对着火、身体与玩家视线垂直）；熔岩边就近站在岸上 */
  private claimFire(src: FireSource): boolean {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const reach = EAT_REACH * this.sizeScale * this.growth + (src.kind === 'lava' ? 0 : src.radius * 0.3);
    if (src.kind === 'lava') {
      // 熔岩格中心 → 最近的可走格（岸边）
      if (!ctx.nav.nearestWalkable(src.position, this.stand)) return false;
      if (Math.hypot(this.stand.x - src.position.x, this.stand.z - src.position.z) > 3) return false;
      this.stand.y = this.position.y;
    } else {
      let px = -(pl.z - src.position.z), pz = pl.x - src.position.x;
      const len = Math.hypot(px, pz);
      if (len < 1e-3) { px = 1; pz = 0; } else { px /= len; pz /= len; }
      // 挑离自己近的那一侧
      if ((this.position.x - src.position.x) * px + (this.position.z - src.position.z) * pz < 0) { px = -px; pz = -pz; }
      this.stand.set(src.position.x + px * reach, this.position.y, src.position.z + pz * reach);
      if (!ctx.nav.isWalkable(this.stand.x, this.stand.z)) ctx.nav.nearestWalkable(this.stand, this.stand);
    }
    if (src.kind !== 'lava') src.claimedBy = this.id;
    this.fireTarget = src;
    this.setState('seekFire');
    return true;
  }

  private dropFire(): void {
    const src = this.fireTarget;
    if (src && src.claimedBy === this.id) src.claimedBy = null;
    this.fireTarget = null;
    if (this.state === 'seekFire' || this.state === 'eat') {
      this.eatCooldown = 0.6;
      this.setState('run');
    }
  }

  private startEat(): void {
    const src = this.fireTarget!;
    this.stopMoving();
    this.eatYaw = Math.atan2(src.position.x - this.position.x, src.position.z - this.position.z);
    this.facing = this.eatYaw;
    this.setState('eat');
    _v.copy(src.position);
    _v.y += 0.1;
    suckFire(this.ctx, _v.clone(), () => this.mouth(_t), EAT_TIME * 0.9);
    this.ctx.audio.play('burn_tick', { position: this.position, volume: 0.8, pitch: 0.6 });
  }

  /** 吃完：火被吃掉，体型大一圈、火腹更亮 */
  private finishEat(src: FireSource): void {
    src.consume();
    src.claimedBy = null;
    this.fireTarget = null;
    this.meals = Math.min(MAX_MEALS, this.meals + 1);
    this.eatCooldown = EAT_GAP;
    this.setState('run');
    this.rollCooldown(0.3, 0.7);
    this.getBodyCenter(_v);
    this.ctx.fx.burst(_v, INFERNO.spark, 18, 3, 0.45, 0.07, -1);
    this.ctx.fx.burst(_v, INFERNO.ember, 6, 1.4, 0.5, 0.25, -1);
    this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.7, pitch: 0.6 });
  }

  private startSpit(): void {
    const pl = this.ctx.player.position;
    this.spitYaw = Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
    this.facing = this.spitYaw;
    this.spitRange = this.spitReach;
    this.windTime = this.windup(SPIT_WINDUP, 0.45);
    this.cone?.release();
    this.cone = new BreathCone(this.ctx, this.position.clone(), this.spitYaw, this.spitRange, SPIT_HALF, MOUTH.y * this.sizeScale * this.growth * 0.95);
    this.setState('spitWindup');
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 0.75 });
  }

  /** 吐火的一跳：玩家在扇形里（距离、角度、高差）且嘴到胸口没有遮挡 */
  private breathDamage(): boolean {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p.alive) return false;
    const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > this.spitRange + p.radius) return false;
    if (Math.abs(p.position.y - this.position.y) > 1.8) return false;
    if (d > 0.4) {
      const a = Math.atan2(dx, dz) - this.spitYaw;
      const da = Math.atan2(Math.sin(a), Math.cos(a));
      // 扇形边缘留一点玩家身宽
      if (Math.abs(da) > SPIT_HALF + Math.atan2(p.radius, d)) return false;
    }
    this.mouth(_v);
    this.playerChest(_w);
    if (ctx.world.segmentBlocked(_v, _w)) return false;
    ctx.combat.damagePlayer(this.def.damage * SPIT_TICK_MULT * this.damageMult, 'fire', this, this.position);
    return true;
  }

  private launchBite(): void {
    const pl = this.ctx.player;
    let dx = pl.position.x + pl.velocity.x * 0.12 - this.position.x;
    let dz = pl.position.z + pl.velocity.z * 0.12 - this.position.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    dx /= len;
    dz /= len;
    this.biteDir.set(dx, 0, dz);
    this.facing = Math.atan2(dx, dz);
    this.biteHit = false;
    this.accel = 70;
    this.velocity.x = dx * BITE_SPEED * 0.6;
    this.velocity.z = dz * BITE_SPEED * 0.6;
    this.setState('bite');
    this.ctx.audio.play('dash', { position: this.position, volume: 0.45, pitch: 1.1 });
  }

  protected override cancelAttack(): void {
    this.accel = 26;
    this.cone?.release();
    this.cone = null;
    if (this.fireTarget && this.fireTarget.claimedBy === this.id) this.fireTarget.claimedBy = null;
    this.fireTarget = null;
    if (this.state !== 'run' && this.state !== 'idle') {
      this.setState('run');
      this.rollCooldown(0.6, 1.2);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    for (const t of this.tongues) t.m.visible = false;
    if (this.mouthTongue) this.mouthTongue.m.visible = false;
    if (attackDirector.purging) return;
    // 火腹炸开：一团火星（吃得越多越大）
    this.getBodyCenter(_v);
    this.ctx.fx.burst(_v, INFERNO.spark, 14 + this.meals * 8, 3 + this.meals, 0.5, 0.07, 2);
    this.ctx.fx.burst(_v, INFERNO.ember, 4 + this.meals * 3, 1.5, 0.6, 0.25, -1);
  }

  protected override onDispose(): void {
    super.onDispose();
    this.cone?.release();
    this.cone = null;
    for (const t of this.tongues) t.m.material.dispose();
    this.tongues.length = 0;
    this.mouthTongue?.m.material.dispose();
    this.mouthTongue = null;
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const k = 1 - Math.exp(-14 * dt);
    this.growth = damp(this.growth, 1 + GROW_PER_MEAL * this.meals, 5, dt);
    const host = this.model.children[0];
    host.scale.setScalar(this.growth);
    this.pGallop = damp(this.pGallop, st === 'run' || st === 'seekFire' ? smooth((sp / this.speed - 0.45) / 0.3) : 0, 6, dt);
    const wind = st === 'biteWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    this.pCrouch = mix(this.pCrouch, st === 'biteWindup' ? wind : st === 'recover' ? 0.3 : 0, k);
    this.pLunge = mix(this.pLunge, st === 'bite' ? 1 : 0, 1 - Math.exp(-24 * dt));
    this.pEat = mix(this.pEat, st === 'eat' ? 1 : 0, k);
    this.pSpit = mix(this.pSpit, st === 'spitWindup' ? 0.5 + 0.5 * clamp01(this.stateTime / this.windTime) : st === 'spit' ? 1 : 0, k);
    this.pBark = damp(this.pBark, 0, 7, dt);
    this.pGrowl = damp(this.pGrowl, 0, 1.5, dt);
    // 铜铃：转身、加减速时晃
    let turn = this.facing - this.lastFacing;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.lastFacing = this.facing;
    this.bellVel += (-this.bellSwing * 60 - this.bellVel * 6) * dt + turn * 4 + (st === 'bite' ? dt * 10 : 0);
    this.bellSwing = Math.max(-0.4, Math.min(0.4, this.bellSwing + this.bellVel * dt));
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, sp);
    else this.poseBlockout(sp);

    // 火光：肋间火腹随吃火次数变亮变大，吐火前摇时一鼓一鼓；嘴里的火吐火时蹿出来
    FLAME_FX_TIME.value = this.ctx.time.now;
    const heave = this.state === 'spitWindup' ? 0.5 + 0.5 * Math.sin(this.stateTime * 22) : 0;
    const belly = 0.25 + 0.25 * this.meals + 0.5 * heave + 0.3 * this.glowLevel[0];
    this.glowTarget[1] = clamp01(belly);
    for (const tg of this.tongues) {
      const flick = 1 + 0.15 * Math.sin(this.age * 14 + tg.phase) + 0.08 * Math.sin(this.age * 33 + tg.phase * 2);
      const grow = 0.5 + 0.35 * this.meals + 0.6 * heave;
      tg.m.scale.set(tg.base * grow * 0.8, tg.base * grow * flick, tg.base * grow);
      tg.m.material.uniforms.uAlpha.value = clamp01(0.25 + 0.22 * this.meals + 0.4 * heave);
      tg.m.visible = this.alive;
    }
    if (this.mouthTongue) {
      const m = Math.max(this.pSpit, this.pEat * 0.4, this.meals > 0 ? 0.15 : 0);
      const s = this.mouthTongue.base * (0.3 + 1.2 * m) * (1 + 0.15 * Math.sin(this.age * 25));
      this.mouthTongue.m.scale.set(s * 0.8, s, s);
      this.mouthTongue.m.material.uniforms.uAlpha.value = clamp01(m * 1.3);
      this.mouthTongue.m.visible = this.alive && m > 0.05;
    }
    if (this.fur) this.fur.glow.value = 0.35 + 0.25 * this.meals + 0.6 * Math.max(this.pSpit, heave) + 0.06 * Math.sin(this.age * 6);
    // 奔跑时爪下扬起火星和灰
    if (this.pGallop > 0.5 && this.onGround && Math.random() < dt * 10) {
      this.localPoint((Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.6, _v);
      this.ctx.fx.burst(_v, Math.random() < 0.6 ? INFERNO.ash : INFERNO.spark, 2, 1.2, 0.4, 0.06, 2);
    }
  }

  /**
   * 美术骨骼动画（犬类四足）。模型空间：X = 祸斗左侧，Y = 上，Z = 前；绕 +X 正转 = 前倾（低头）/ 肢体向后摆。
   * - 小跑：对角步，身体平稳、头随步子轻点；
   * - 双悬空奔跑：后腿一对落地 → 身体伸展腾空 → 前腿一对落地 → 身体收拢腾空；腰椎（spine）大幅屈伸、骨盆反向摆动、
   *   肩胛跟着前腿前后浮动，颈和头反向补偿保持视线；身体在两次腾空时抬起；
   * - 扑咬：压低前身（肩胛下沉、前腿屈、颈前伸）、张嘴 → 扑出时全身拉直；吃火：低头到地、下颌一舔一舔；
   * - 吐火：前摇时胸腹起伏、头先抬再压低对准玩家，喷火时张大嘴；吠叫：仰头一下一下；低吼：压低头、耳后摆。
   */
  private poseNative(n: NativeBody, dt: number, sp: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const st = this.state;
    const g = this.pGallop;
    const c = this.pCrouch;
    const eat = this.pEat;
    const spit = this.pSpit;
    const lunge = this.pLunge;
    const move = clamp01(sp / 1.2);
    const sn = clamp01(sp / this.speed);
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * g;
    const grounded = this.onGround;
    if (move > 0.05) this.gait = (this.gait + freq * dt * move) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * g;
    const sweep = Math.min(GAIT_SWEEP, (sp * duty) / (freq * this.sizeScale * this.growth)) * (1 - eat);
    const lift = (GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * g) * move;
    const u0 = this.gait;
    // 双悬空奔跑：u≈0.95 收拢腾空（腰椎屈），u≈0.45 伸展腾空（腰椎伸）
    const flex = Math.cos((u0 - 0.95) * Math.PI * 2) * g;
    const bounce = Math.cos((u0 - 0.45) * Math.PI * 4) * g;
    const trotBob = Math.abs(Math.sin(u0 * Math.PI * 2)) * (1 - g) * sn;
    const breathe = Math.sin(t * (2.2 + 3 * this.meals * 0.3));
    const heave = st === 'spitWindup' ? Math.sin(this.stateTime * 22) : 0;

    // 身体：起伏、屈伸；扑咬前压低前身；吃火时前身下沉；受击、眩晕
    P.translate('hips', 0, 0.035 * bounce + 0.012 * trotBob - 0.02 * c - 0.05 * eat + breathe * 0.003, 0);
    P.rotate('hips', AX, -0.12 * flex - 0.1 * c + 0.22 * eat + 0.04 * lunge - this.hurtKick * 0.15);
    P.rotate('spine', AX, 0.24 * flex + 0.18 * c + 0.1 * eat - 0.15 * lunge + heave * 0.03);
    P.rotate('chest', AX, 0.06 * flex + 0.08 * c + 0.12 * eat - this.hurtKick * 0.25 + heave * 0.04);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(t * 8) * 0.15);
    // 肩胛：跟着前腿前后浮动；扑咬前下沉
    for (const s of ['L', 'R'] as const) P.rotate(`scapula_${s}`, AX, 0.12 * flex + 0.15 * c);
    // 颈、头：补偿身体的屈伸保持视线；吃火低头；吐火先抬头再压低；吠叫仰头；低吼压低
    const bark = this.pBark, growl = this.pGrowl * (1 - eat);
    P.rotate('neck', AX, -0.3 * flex - 0.1 * g + 0.45 * c + 0.95 * eat + spit * (st === 'spit' ? 0.25 : -0.15) - 0.25 * bark + 0.3 * growl);
    P.rotate('head', AX, -0.05 * flex + 0.45 * eat + (st === 'spit' ? -0.2 : 0.1 * spit) - 0.15 * bark - 0.15 * growl - this.hurtKick * 0.25);
    P.rotate('head', AY, this.stunTime > 0 ? Math.sin(t * 9) * 0.3 : Math.sin(t * 1.3) * 0.08 * (1 - move));
    // 下颌：扑咬张嘴、吃火一舔一舔、吐火大张、吠叫一合
    const lap = eat * (0.1 + 0.12 * Math.abs(Math.sin(this.stateTime * 14)));
    const jaw = Math.max(0.3 * c + 0.3 * lunge, lap, st === 'spit' ? 0.3 : 0.12 * spit * (1 + heave), 0.25 * bark * Math.abs(Math.sin(t * 30)));
    P.rotate('jaw', AX, Math.min(0.3, jaw));
    // 铜铃
    P.rotate('bell', AX, this.bellSwing * 0.6 + Math.sin(t * 9) * 0.03 * move);
    P.rotate('bell', AZ, this.bellSwing);

    // 腿 IK：触地段从前往后扫，腾空段抬脚前摆（奔跑时前腿前伸、后腿收到肚下）；扑咬前前腿屈、后腿蹬
    for (const leg of LEGS) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const off = leg.trot + (leg.gallop - leg.trot) * g;
      const u = (u0 + off) % 1;
      let dz: number, dy: number;
      if (u < duty) {
        dz = sweep * (0.5 - u / duty);
        dy = 0;
      } else {
        const s = (u - duty) / (1 - duty);
        dz = sweep * (-0.5 + smooth(s));
        dy = Math.sin(s * Math.PI) * lift;
      }
      if (!grounded) {
        // 扑出 / 落下时：前腿前伸、后腿后蹬
        dz = leg.front ? 0.15 : -0.15;
        dy = 0.08;
      }
      if (leg.front) dz += 0.06 * eat - 0.05 * c;
      else dz += 0.05 * c;
      const side = rest.x > 0 ? 1 : -1;
      _t.set(rest.x + side * 0.015 * eat, rest.y + dy - (leg.front ? 0.03 * c : 0), rest.z + dz);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1);
      // 腾空段：脚掌 / 后脚趾往后翻（犬类收爪）
      if (u >= duty && grounded) {
        const s = (u - duty) / (1 - duty);
        const curl = Math.sin(s * Math.PI) * (0.5 + 0.5 * g);
        if (leg.front) P.rotateCurrent(leg.e, AX, -curl * 0.8);
        else P.rotateCurrent(leg.e === 'foot_L' ? 'toe_L' : 'toe_R', AX, -curl * 0.7);
      }
    }
    // 鞭尾：奔跑时向后拉平、小跑时轻摆、吠叫 / 吃火时摇；惯性交给弹簧骨骼
    P.rotate('tail_1', AX, 0.3 * g + 0.1 * sn + 0.15 * spit - 0.2 * growl);
    P.rotate('tail_1', AY, Math.sin(t * (4 + 6 * eat)) * (0.1 + 0.25 * eat + 0.15 * bark));
    if (this.tailSpring) {
      if (this.age < this.spawnDuration) this.tailSpring.reset();
      else this.tailSpring.step(dt, this.position, grounded ? this.position.y : -Infinity, this.sizeScale * this.growth);
    }
  }

  /** 白模动画：小跑 / 奔跑（身体屈伸）、扑咬压低、吃火低头、吐火张嘴 */
  private poseBlockout(sp: number): void {
    const amp = Math.min(1.2, sp / Math.max(1, this.def.speed));
    const ph = this.walkPhase * 1.6;
    const g = this.pGallop;
    const flex = Math.sin(ph) * g;
    this.body.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.03 * amp - 0.04 * this.pCrouch;
    this.body.rotation.x = 0.1 * this.pCrouch + 0.08 * this.pEat - this.hurtKick * 0.2;
    this.body.rotation.z = this.stunTime > 0 ? Math.sin(this.age * 8) * 0.15 : 0;
    this.chestJ.rotation.x = 0.2 * flex;
    this.neckJ.rotation.x = -0.7 + 0.9 * this.pEat + 0.3 * this.pCrouch - 0.2 * this.pBark;
    this.headJ.rotation.x = 0.7 + 0.2 * this.pEat;
    this.jawJ.rotation.x = Math.max(0.3 * this.pCrouch + 0.3 * this.pLunge, this.state === 'spit' ? 0.35 : 0, this.pEat * 0.15 * Math.abs(Math.sin(this.age * 14)));
    for (const l of this.legJ) {
      const off = g > 0.5 ? (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : 0.3) : (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph + off);
      l.upper.rotation.x = swing * (0.5 + 0.4 * g) * amp;
      l.lower.rotation.x = (l.front ? 1 : -1) * Math.max(0, -swing) * 0.6 * amp;
    }
    for (const [i, seg] of this.tailJ.entries()) {
      seg.rotation.x = (i === 0 ? 0.5 - 0.3 * g : 0.15);
      seg.rotation.y = Math.sin(this.age * 4 - i * 0.7) * 0.15;
    }
    for (const b of this.bellyGlows) b.scale.set(1, 1 + 0.25 * this.meals, 1);
  }
}
