/**
 * 神火飞鸦（fire_crow，第三章 · 祝融火狱的自爆怪，炉宫）：明代「神火飞鸦」火箭活了过来——竹篾扎骨、黑漆纸糊的乌鸦，
 * 肚子是一只透着熔岩光的纸竹火药鼓（弱点：整个肚子），两翼下各挂两根竹火箭筒。3–5 只一群，从远处直线俯冲自爆。
 * 按真实乌鸦的样子飞：纸翼以扑翼为主，盘旋时几下扑扇接一段滑翔，身体略微前倾、转弯时侧倾；尾扇张开当舵；
 * 腿收在肚子下面。翅下四根火箭筒一直喷着火星，点火时猛地喷亮。
 *
 * - 盘旋：成群在 8–14 米高处绕着玩家转圈（同一方向，各自的半径、相位），翅下火箭喷着火星。
 * - 点火（轮流）：整群每 1.5–3 秒轮到一只（还要拿到远程令牌）：尖啸、眼睛变红、翅下火箭猛地喷亮 0.7 秒，原地悬停；
 *   这一刻玩家所在的地面点被锁定，地面沿它的俯冲线亮出一条朱红线，落点亮出 3 米预警圈。
 * - 俯冲：点火结束后沿直线高速俯冲，冲向锁定的那个点（不追踪，横移就躲开）。
 * - 撞地爆：撞地、撞墙或贴到玩家（1 米）时炸开（3 米），地上留 3 秒燃烧的纸灰（站在上面每 0.5 秒烧一下）。
 *   自己撞死不算玩家击杀、不掉落。
 * - 空中打爆：被打死时在空中炸开（3 米），炸伤附近所有敌人——旁边的飞鸦被炸死就接着炸（连环爆），炮仗傀儡掉血；
 *   不伤玩家（奖励在空中打掉它）。被炮仗傀儡的死亡爆炸引爆时同样在空中炸开（见 inferno/ExplosiveChain.ts）。
 * - 弱点 = 肚子的火药鼓（命中球，打中算爆头）；头、两翼内段是身体命中球。血量约 20，一枪死。
 *
 * 美术网格只用正背视图生成，翅膀是一张竖直的纸面：运行时把两翼绕翼梁转 90°（WING_PITCH），下沿甩到身后成为
 * 水平翼面的后缘，翅下的火箭筒随之指向身后。
 *
 * 状态机：circle → ignite → dive →（撞地 / 撞墙 / 贴脸）自爆
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { blastPlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { FROST_FX_TIME, Spring, applyFrostGlow, hitAnchor, raycastSpheres, type FrostGlowHandle, type HitSphere } from '../fx/FrostSkirmishFx';
import { DiveLine, INFERNO, createJetFlame, gunpowderBlast, spawnPaperAsh, type JetFlame } from '../fx/InfernoBlastFx';
import { chainBlast, detonateKin, type ExplosiveKin } from '../inferno/ExplosiveChain';

export const FIRE_CROW_DEF: ScaledEnemyDef = {
  id: 'fire_crow',
  name: '神火飞鸦',
  // 美术按翼展 1.6 米（脚爪到冠顶 0.9 米）制作，游戏里放大 1.2 倍：翼展约 1.9 米；下面的尺寸都是放大前的值
  scale: 1.2,
  hp: 20,
  speed: 9,
  radius: 0.3,
  height: 0.9,
  flying: true,
  // 撞地爆的伤害
  damage: 22,
  coins: [1, 2],
  essence: 1,
  // 弱点 = 肚子的火药鼓：判定球心在鼓心（离脚底 0.43）
  headY: 0.43,
  headRadius: 0.24,
  knockbackResist: 0.2,
  color: 0xff7a2a,
};

/** 盘旋高度（离地 / 离玩家脚底，米）、绕圈半径、角速度（弧度/秒） */
const ALTITUDE = [8, 14] as const;
const ORBIT_R = [7, 10] as const;
const ORBIT_W = 0.5;
/** 出生时脚底至少离地这么高（模型单位，乘体型） */
const SPAWN_ALT = 2.5;
/** 点火：前摇、能点火的水平距离、整群轮流的间隔（秒） */
const IGNITE_TIME = 0.7;
const IGNITE_RANGE = 28;
const FLOCK_GAP = [1.5, 3] as const;
/** 俯冲：速度、竖直速度上限（飞行积分的上限是 1.5 × def.speed）、最长时间、贴脸判定（身体中心到玩家胸口） */
const DIVE_SPEED = 20;
const DIVE_VY_MAX = 13;
const DIVE_MAX_TIME = 2.4;
const DIVE_HIT = 1.0;
/** 撞地爆：半径、燃烧纸灰（半径、持续、每跳伤害占撞击伤害的比例） */
const BLAST_RADIUS = 3;
const ASH = { radius: 1.6, time: 3, mult: 0.15 } as const;
/** 空中打爆：半径、对敌人的基础伤害（× 等级，精英 ×1.5）、击退 */
const AIR_RADIUS = 3;
const AIR_BASE = 30;
const AIR_KNOCK = 3;
/** 两翼绕翼梁的转角：美术网格的竖直纸翼 → 水平翼面（后缘朝后） */
export const WING_PITCH = Math.PI / 2;

/**
 * 美术网格实测（模型空间、未缩放；Blender (x, y, z) → (x, z, -y)）：火药鼓、翅下四个火箭筒口、命中球。
 */
const DRUM = new THREE.Vector3(0, 0.43, 0.12);
const JETS = [
  { bone: 'wing_1_L', at: new THREE.Vector3(0.379, 0.2, 0.115) }, { bone: 'wing_1_L', at: new THREE.Vector3(0.447, 0.2, 0.115) },
  { bone: 'wing_1_R', at: new THREE.Vector3(-0.379, 0.2, 0.115) }, { bone: 'wing_1_R', at: new THREE.Vector3(-0.447, 0.2, 0.115) },
] as const;
const HITS = [
  { bone: 'body', at: DRUM, r: 0.24, head: true },
  { bone: 'head', at: new THREE.Vector3(0, 0.72, 0.22), r: 0.14, head: false },
  { bone: 'wing_1_L', at: new THREE.Vector3(0.36, 0.56, 0.11), r: 0.17, head: false },
  { bone: 'wing_1_R', at: new THREE.Vector3(-0.36, 0.56, 0.11), r: 0.17, head: false },
] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const SIDES = ['L', 'R'] as const;

const C = {
  paper: 0x1e1a1e, edge: 0xc8281e, bamboo: 0xb8925a, beak: 0x2a2428, drum: 0xff8a30, drumHot: 0xffe0a0, eye: 0xffb030, eyeHot: 0xff2a2a,
};

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** 整群的点火轮次（每个对局上下文一份）：next = 下一只最早什么时候能点火 */
const flocks = new WeakMap<GameContext, { next: number }>();

function flockOf(ctx: GameContext): { next: number } {
  let f = flocks.get(ctx);
  if (!f) {
    f = { next: -Infinity };
    flocks.set(ctx, f);
  }
  return f;
}

/** 在 parent 上挂一个与模型空间同向、同尺度的插槽（host 空间坐标） */
function alignedSocket(parent: THREE.Object3D, host: THREE.Object3D, at: THREE.Vector3): THREE.Object3D {
  const a = new THREE.Object3D();
  parent.add(a);
  host.updateWorldMatrix(true, true);
  a.position.copy(parent.worldToLocal(host.localToWorld(_t.copy(at))));
  a.quaternion.copy(parent.getWorldQuaternion(_qa).invert().multiply(host.getWorldQuaternion(_qb)));
  a.scale.setScalar(host.getWorldScale(_q).x / Math.max(1e-6, parent.getWorldScale(_p).x));
  return a;
}

export class FireCrow extends StandardEnemy implements ExplosiveKin {
  readonly explosiveKin = true as const;

  // 白模关节
  private bodyJ!: THREE.Group;
  private headJ!: THREE.Group;
  private tailJ!: THREE.Group;
  private drumGlow!: THREE.Mesh;
  private readonly wingJ: THREE.Group[][] = [];
  private readonly eyeGlows: THREE.Mesh[] = [];
  // 运行时部件
  private readonly jets: JetFlame[] = [];
  private readonly hits: HitSphere[] = [];
  private drumAnchor!: THREE.Object3D;
  private glow: FrostGlowHandle | null = null;
  // 行为
  private readonly altitude: number;
  private readonly orbitR: number;
  private readonly orbitPhase: number;
  private readonly bobPhase: number;
  private readonly orbitCenter = new THREE.Vector3();
  private orbitInit = false;
  private climb = 0;
  /** 点火时锁定的落点（地面）与俯冲速度 */
  readonly diveTarget = new THREE.Vector3();
  readonly diveVel = new THREE.Vector3();
  readonly diveStart = new THREE.Vector3();
  private igniteTime = IGNITE_TIME;
  private line: DiveLine | null = null;
  private warning: (() => void) | null = null;
  private crashed = false;
  private primed = false;
  private detonated = false;
  // 姿态
  private flapPhase = 0;
  private readonly sAmp = new Spring(30, 0.9);
  private readonly sSweep = new Spring(40, 0.8);
  private readonly sPitch = new Spring(30, 0.8);
  private readonly sBank = new Spring(25, 0.8);
  private readonly sTail = new Spring(50, 0.35);
  private headYaw = 0;
  private headPitch = 0;
  private jetLevel = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FIRE_CROW_DEF, opts);
    this.altitude = ctx.rng.range(ALTITUDE[0], ALTITUDE[1]);
    this.orbitR = ctx.rng.range(ORBIT_R[0], ORBIT_R[1]);
    // 各只错开相位（黄金角），整群围成一圈
    this.orbitPhase = (this.id * 2.399963) % (Math.PI * 2);
    this.bobPhase = ctx.rng.range(0, Math.PI * 2);
    this.hoverHeight = this.altitude;
    this.accel = 10;
    this.deathDuration = 0.35;
    this.cooldown = ctx.rng.range(0.8, 1.8);
    this.setState('circle');
    // 出生就在半空
    const pos = this.position;
    const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 1);
    const want = (Number.isFinite(gy) ? gy : pos.y) + SPAWN_ALT * this.sizeScale;
    if (pos.y < want && !ctx.world.overlapsBody(pos.x, want, pos.z, this.radius, this.height)) pos.y = want;
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const paper = flat(C.paper, { rough: 0.7 }), edge = flat(C.edge, { rough: 0.6 }), bamboo = flat(C.bamboo, { rough: 0.8 });
    const body = joint(root, DRUM.x, DRUM.y, DRUM.z);
    this.bodyJ = body;
    // 火药鼓（肚子）+ 黑纸背
    part(body, Geo.ico(0.22, 1), bamboo, 0, 0, 0).scale.set(0.95, 1, 0.9);
    this.drumGlow = this.glowPart(body, Geo.ico(0.2, 1), C.drum, C.drumHot, 0, -0.01, 0.04, 0);
    part(body, Geo.ico(0.2, 1), paper, 0, 0.14, -0.08).scale.set(0.9, 0.7, 1.2);
    // 头：粗喙、红金眼
    const head = joint(body, 0, 0.21, 0.08);
    this.headJ = head;
    part(head, Geo.ico(0.12, 1), paper, 0, 0.08, 0.04);
    part(head, Geo.cone(0.045, 0.16, 5), flat(C.beak, { rough: 0.4 }), 0, 0.05, 0.2, Math.PI / 2, 0, 0);
    for (const s of [1, -1]) this.eyeGlows.push(this.glowPart(head, Geo.ico(0.025, 1), C.eye, C.eyeHot, s * 0.06, 0.1, 0.12, 1));
    // 两翼（白模直接做成水平翼面）：内段带两根火箭筒，外段红边
    for (const s of [1, -1]) {
      const w1 = joint(body, s * 0.19, 0.27, -0.01);
      part(w1, Geo.box(0.32, 0.02, 0.36), paper, s * 0.16, 0, -0.16);
      part(w1, Geo.cyl(0.015, 0.015, 0.32, 5), bamboo, s * 0.16, 0.01, 0, 0, 0, Math.PI / 2);
      for (const x of [0.19, 0.26]) part(w1, Geo.cyl(0.04, 0.04, 0.32, 6), edge, s * x, -0.06, -0.12, Math.PI / 2, 0, 0);
      const w2 = joint(w1, s * 0.31, 0, 0);
      part(w2, Geo.box(0.3, 0.02, 0.3), paper, s * 0.15, 0, -0.14);
      part(w2, Geo.box(0.3, 0.025, 0.06), edge, s * 0.15, 0, -0.3);
      this.wingJ.push([w1, w2]);
    }
    // 尾扇
    const tail = joint(body, 0, 0.05, -0.2);
    this.tailJ = tail;
    part(tail, Geo.box(0.26, 0.02, 0.3), paper, 0, 0, -0.15);
    part(tail, Geo.box(0.28, 0.025, 0.06), edge, 0, 0, -0.3);
    this.drumAnchor = body;
    this.setHeadAnchor(body, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    const fallback = (bone: string): THREE.Object3D => bone === 'head' ? this.headJ
      : bone === 'wing_1_L' ? this.wingJ[0][0] : bone === 'wing_1_R' ? this.wingJ[1][0] : this.bodyJ;
    const at = (bone: string): THREE.Object3D => P?.bone(bone) ?? fallback(bone);
    if (n) {
      this.bodyJ.visible = false;
      this.drumAnchor = hitAnchor(at('body'), host, DRUM.x, DRUM.y, DRUM.z);
      this.setHeadAnchor(this.drumAnchor, 0, 0, 0);
      this.glow = applyFrostGlow(n.materials[0], 'fire_crow', [
        // 火药鼓：纸缝里透出的熔岩橙（点火时更亮）
        { color: 0xff8a2a, hue: [0.07, 0.07], minSat: 0.4, minVal: 0.45, sphere: { center: [DRUM.x, DRUM.y, DRUM.z], radius: 0.27 }, shimmer: 0.5 },
        // 红金眼：点火时变红发亮
        { color: 0xff2a1a, hue: [0.08, 0.1], minSat: 0.45, minVal: 0.5, box: { min: [-0.12, 0.66, 0.16], max: [0.12, 0.84, 0.36], soft: 0.03 }, shimmer: 0.3 },
      ]);
    }
    // 翅下四个火箭筒口的尾焰：美术版挂在 wing_1 骨上与模型同向的插槽里（筒口朝下，翼面转平后朝后）
    JETS.forEach((j, i) => {
      const jet = createJetFlame(i);
      const s = j.at.x > 0 ? 1 : -1;
      if (n) {
        alignedSocket(at(j.bone), host, j.at).add(jet.group);
        jet.group.rotation.x = Math.PI;
      } else {
        const w1 = this.wingJ[s > 0 ? 0 : 1][0];
        const g = joint(w1, s * (Math.abs(j.at.x) - 0.19 - 0.07), -0.06, -0.3);
        g.add(jet.group);
        jet.group.rotation.x = -Math.PI / 2;
      }
      jet.group.scale.setScalar(0.32);
      this.jets.push(jet);
    });
    for (const h of HITS) {
      const parent = at(h.bone);
      this.hits.push({ anchor: n ? hitAnchor(parent, host, h.at.x, h.at.y, h.at.z) : this.blockoutAnchor(parent, h.bone, h.at), r: h.r, head: h.head });
    }
  }

  /** 白模的命中锚点（白模翼面本来就是水平的：翼内段的球放在翼梁后面） */
  private blockoutAnchor(parent: THREE.Object3D, bone: string, at: THREE.Vector3): THREE.Object3D {
    const host = this.model.children[0];
    if (bone.startsWith('wing')) return hitAnchor(parent, host, at.x, 0.7, -0.05);
    return hitAnchor(parent, host, at.x, at.y, at.z);
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    if (this.drumAnchor && this.alive && this.age >= this.spawnDuration) return this.drumAnchor.getWorldPosition(out);
    return this.localPoint(DRUM.x, DRUM.y, DRUM.z, out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.getBodyCenter(out);
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    switch (this.state) {
      case 'chase':
      case 'circle': {
        this.glowTarget[0] = 0.15;
        this.circle(dt);
        const d = this.distToPlayerXZ();
        if (this.cooldown <= 0 && this.sees && d <= IGNITE_RANGE && d > 2 && this.position.y > pl.position.y + 2) {
          const flock = flockOf(this.ctx);
          if (this.ctx.time.now >= flock.next && this.requestAttack('ranged', IGNITE_TIME + DIVE_MAX_TIME + 0.3)) {
            flock.next = this.ctx.time.now + this.ctx.rng.range(FLOCK_GAP[0], FLOCK_GAP[1]);
            this.startIgnite();
          } else {
            this.cooldown = this.ctx.rng.range(0.25, 0.6);
          }
        }
        break;
      }
      case 'ignite': {
        // 原地悬停、盯住锁定的落点：尖啸、眼睛变红、火箭猛喷，俯冲线逐渐填满
        this.stopMoving();
        this.faceTowards(this.diveTarget, 6, dt);
        const t = clamp01(this.stateTime / this.igniteTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.line?.update(t);
        if (this.stateTime >= this.igniteTime) this.startDive();
        break;
      }
      case 'dive': {
        // 沿直线俯冲（不追踪）：速度在开始时定死，每帧原样保持
        this.getBodyCenter(_c);
        this.playerChest(_p);
        const gy = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
        const ground = Number.isFinite(gy) && this.position.y <= gy + 0.15;
        const hitPlayer = pl.alive && _c.distanceTo(_p) <= DIVE_HIT * this.sizeScale;
        const blocked = this.stateTime > 0.08 && (this.moveResult.hitWall || this.moveResult.onGround);
        if (hitPlayer || ground || blocked || this.stateTime >= DIVE_MAX_TIME) {
          this.crash();
          break;
        }
        this.velocity.copy(this.diveVel);
        this.setMove(this.diveVel.x, this.diveVel.z, Math.hypot(this.diveVel.x, this.diveVel.z));
        this.flyTargetY = this.position.y + this.diveVel.y / 3;
        this.facing = Math.atan2(this.diveVel.x, this.diveVel.z);
        this.glowTarget[0] = 1;
        break;
      }
      default:
        this.setState('circle');
    }
  }

  /** 盘旋：绕着（缓慢跟随的）玩家转圈，高度随玩家抬升；看不到玩家、撞到东西时升高 */
  private circle(dt: number): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    if (!this.orbitInit) {
      this.orbitCenter.copy(pl);
      this.orbitInit = true;
    }
    this.orbitCenter.x = damp(this.orbitCenter.x, pl.x, 1.2, dt);
    this.orbitCenter.z = damp(this.orbitCenter.z, pl.z, 1.2, dt);
    const a = this.orbitPhase + ORBIT_W * ctx.time.now;
    _t.set(this.orbitCenter.x + Math.sin(a) * this.orbitR, 0, this.orbitCenter.z + Math.cos(a) * this.orbitR);
    const dx = _t.x - this.position.x, dz = _t.z - this.position.z;
    const d = Math.hypot(dx, dz);
    this.setMove(dx, dz, Math.min(this.speed, 1.5 + d * 1.6));
    this.faceMovement(3.5, dt);
    const floor = ctx.stage.arena?.floorY ?? 0;
    if (this.moveResult.hitWall) this.climb = 1.2;
    else this.climb = Math.max(0, this.climb - dt);
    let y = Math.max(floor, pl.y) + this.altitude;
    if (this.blindTime > 0.8) y += 2;
    if (this.climb > 0) y += 2.5;
    this.flyTargetY = y + Math.sin(this.age * 1.3 + this.bobPhase) * 0.35;
  }

  /** 点火：锁定玩家这一刻脚下的地面点，亮出俯冲线和落点预警 */
  private startIgnite(): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const gy = ctx.world.groundHeight(pl.x, pl.z, pl.y + 0.5);
    this.diveTarget.set(pl.x, Number.isFinite(gy) ? gy : pl.y, pl.z);
    this.igniteTime = this.windup(IGNITE_TIME, 0.5);
    this.setState('ignite');
    this.stopMoving();
    // 俯冲线：从飞鸦脚下的地面投影到落点
    const sy = ctx.world.groundHeight(this.position.x, this.position.z, this.position.y);
    _c.set(this.position.x, Number.isFinite(sy) ? sy : this.diveTarget.y, this.position.z);
    this.line = new DiveLine(ctx, _c, this.diveTarget, 0.3, 0);
    this.getBodyCenter(_p);
    const eta = this.igniteTime + _p.distanceTo(this.diveTarget) / DIVE_SPEED + 0.1;
    this.warning = ctx.fx.groundWarning(this.diveTarget, BLAST_RADIUS, eta, INFERNO.warn);
    ctx.audio.play('telegraph', { position: this.position, volume: 1, pitch: 2.4 });
    ctx.fx.burst(_p, INFERNO.gold, 10, 3, 0.4, 0.05, 2);
  }

  /** 俯冲：速度一次定死（指向锁定点，竖直分量不超过积分上限） */
  private startDive(): void {
    this.getBodyCenter(_c);
    this.diveStart.copy(_c);
    _p.set(this.diveTarget.x, this.diveTarget.y + 0.25, this.diveTarget.z).sub(_c);
    if (_p.lengthSq() < 1e-4) _p.set(0, -1, 0);
    _p.normalize();
    const speed = Math.min(DIVE_SPEED, DIVE_VY_MAX / Math.max(1e-3, Math.abs(_p.y)));
    this.diveVel.copy(_p).multiplyScalar(speed);
    this.accel = 200;
    this.setState('dive');
    this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.9, pitch: 1.7 });
  }

  /** 撞地 / 撞墙 / 贴脸：炸开、留下燃烧纸灰，自身死亡（不经过 combat：不算玩家击杀、不掉落） */
  private crash(): void {
    if (this.crashed || !this.alive) return;
    this.crashed = true;
    this.detonated = true;
    const ctx = this.ctx;
    // 预警如期兑现：让它自然收尾
    this.warning = null;
    this.line?.release();
    this.line = null;
    const center = this.getBodyCenter(new THREE.Vector3());
    blastPlayer(ctx, center, BLAST_RADIUS, this.def.damage * this.damageMult, 'fire', this, 0.5, 0.6, 6);
    gunpowderBlast(ctx, center, BLAST_RADIUS, 1.1);
    const gy = ctx.world.groundHeight(center.x, center.z, center.y + 0.5);
    if (Number.isFinite(gy) && center.y - gy < 2.5) {
      spawnPaperAsh(ctx, new THREE.Vector3(center.x, gy, center.z), ASH.radius, ASH.time, this.def.damage * this.damageMult * ASH.mult, this);
    }
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    const req: DamageRequest = { base: 0, element: 'none', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    };
    this.onKilled(res);
  }

  /** 被同伴引爆（连环爆）：delay 秒后在空中炸开 */
  chainDetonate(delay: number): void {
    if (this.primed || !this.alive) return;
    this.primed = true;
    this.tintBody(0xff7a20, 0.9);
    this.ctx.tasks.delay(delay, () => detonateKin(this.ctx, this));
  }

  protected override cancelAttack(): void {
    const warn = this.warning;
    this.warning = null;
    warn?.();
    this.line?.release();
    this.line = null;
    if (this.alive && (this.state === 'ignite' || this.state === 'dive')) {
      // 眩晕 / 清理 / 玩家死亡：熄火，回到盘旋
      this.accel = 10;
      this.setState('circle');
      this.rollCooldown(1.2, 2.2);
    }
  }

  /** 空中被打爆：炸伤附近所有敌人（同类被炸死就接着炸），不伤玩家 */
  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (this.detonated || attackDirector.purging) return;
    this.detonated = true;
    const center = this.getBodyCenter(new THREE.Vector3());
    gunpowderBlast(this.ctx, center, AIR_RADIUS, 0.9);
    chainBlast(this.ctx, {
      center, radius: AIR_RADIUS, base: AIR_BASE * this.level * (this.isElite ? 1.5 : 1), knockback: AIR_KNOCK,
      mode: 'damage', source: this,
    });
  }

  protected override onDispose(): void {
    super.onDispose();
    this.line?.release();
    this.line = null;
    for (const j of this.jets) j.dispose();
    this.jets.length = 0;
  }

  protected override animateDeath(t: number): void {
    // 炸开：一下鼓胀后碎没
    const s = this.sizeScale * (t < 0.3 ? 1 + t : Math.max(0.01, 1.3 * (1 - (t - 0.3) / 0.7)));
    this.model.scale.setScalar(s);
    for (const j of this.jets) j.set(0, this.ctx.time.now);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    const ignite = st === 'ignite' ? clamp01(this.stateTime / this.igniteTime) : 0;
    const dive = st === 'dive';
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const sn = Math.sin(this.facing), cs = Math.cos(this.facing);
    const lat = this.velocity.x * cs - this.velocity.z * sn;
    // 扑翼：盘旋时几下扑扇接一段滑翔（乌鸦），点火时翅膀张开发抖，俯冲时收翅后掠
    const glide = 0.5 + 0.5 * Math.sin(this.age * 0.9 + this.bobPhase);
    let freq = 2.4, amp = 0.55 * (glide > 0.55 ? 1 : 0.25);
    if (st === 'ignite') { freq = 9; amp = 0.12; }
    if (dive) { freq = 1; amp = 0.04; }
    if (!this.alive) { freq = 6; amp = 0.4; }
    this.flapPhase += dt * freq * Math.PI * 2;
    const a = this.sAmp.step(amp, dt);
    const flap = a * Math.sin(this.flapPhase) + 0.08;
    const flap2 = a * 0.6 * Math.sin(this.flapPhase - 0.8);
    const sweep = this.sSweep.step(dive ? 0.75 : st === 'ignite' ? -0.1 : 0.1, dt);
    // 身体：盘旋略前倾、转弯侧倾；俯冲时机头顺着速度朝下；点火时昂起
    const descent = dive ? Math.atan2(-this.diveVel.y, Math.max(0.5, Math.hypot(this.diveVel.x, this.diveVel.z))) : 0;
    const pitch = this.sPitch.step(dive ? descent : 0.22 + 0.02 * sp - 0.35 * ignite - 0.3 * this.hurtKick, dt);
    const bank = this.sBank.step(clamp(-lat * 0.08, -0.6, 0.6) + (this.stunTime > 0 ? Math.sin(this.age * 9) * 0.4 : 0), dt);
    const host = this.model.children[0];
    host.rotation.set(clamp(pitch, -0.8, 1.45), 0, bank);
    // 绕火药鼓的鼓心转：抵消绕脚底原点转带来的位移
    _c.copy(DRUM).applyEuler(host.rotation);
    host.position.set(DRUM.x - _c.x, DRUM.y - _c.y, DRUM.z - _c.z);
    // 头：盯住玩家（偏航限幅）；点火尖啸时昂头抖动
    const pl = this.ctx.player.position;
    const want = clamp(angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z)), -0.8, 0.8);
    this.headYaw = damp(this.headYaw, dive ? 0 : want, 8, dt);
    this.headPitch = damp(this.headPitch, -pitch * 0.5 - 0.35 * ignite + (ignite > 0 ? Math.sin(this.age * 40) * 0.08 : 0), 10, dt);
    const tail = this.sTail.step(dive ? 0.15 : 0.05 * Math.sin(this.age * 2 + this.bobPhase) - 0.15 * ignite, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody.pose, flap, flap2, sweep, tail);
    else this.poseBlockout(flap, flap2, sweep, tail);

    // 火箭尾焰：平时喷火星，点火猛喷，俯冲全开
    this.jetLevel = damp(this.jetLevel, this.alive ? (dive ? 2.2 : st === 'ignite' ? 1.2 + 1.2 * ignite : 0.7) : 0, 12, dt);
    for (const j of this.jets) j.set(this.jetLevel, this.ctx.time.now);
    FROST_FX_TIME.value = this.ctx.time.now;
    const alive = this.alive ? 1 : 0.3;
    if (this.glow) {
      this.glow.strength[0].value = (0.6 + 1.2 * ignite + (dive ? 1.4 : 0)) * alive * (0.9 + 0.1 * Math.sin(this.age * 5));
      this.glow.strength[1].value = (0.1 + 2.4 * ignite + (dive ? 2 : 0)) * alive;
    }
    this.drumGlow.scale.setScalar(1 + 0.25 * ignite + (dive ? 0.3 : 0));
    this.glowTarget[1] = ignite > 0 || dive ? 1 : 0;
  }

  /**
   * 美术骨骼动画（模型空间：X = 飞鸦的左侧，Y = 上，Z = 前）。wing_1 先绕翼梁（X）转 WING_PITCH 把竖直纸翼放平，
   * 再绕前后轴（Z）扑、绕竖轴（Y）后掠；外段 wing_2 按父骨骼当前朝向在模型空间里扑、掠（滞后一点）。
   * 尾扇绕 X 抬到身后（绑定姿势里斜垂向后下）；腿收到肚子下面。
   */
  private poseNative(P: NativePose, flap: number, flap2: number, sweep: number, tail: number): void {
    P.reset();
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const s = i === 0 ? 1 : -1;
      P.rotate(`wing_1_${side}`, AX, WING_PITCH);
      P.rotate(`wing_1_${side}`, AZ, s * flap);
      P.rotate(`wing_1_${side}`, AY, s * sweep * 0.8);
      P.rotateCurrent(`wing_2_${side}`, AZ, s * flap2);
      P.rotateCurrent(`wing_2_${side}`, AY, s * sweep * 0.4);
      P.rotate(`leg_${side}`, AX, 1.5);
    }
    P.rotate('tail', AX, 0.7 + tail);
    P.rotate('head', AY, this.headYaw);
    P.rotate('head', AX, this.headPitch);
  }

  private poseBlockout(flap: number, flap2: number, sweep: number, tail: number): void {
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const [w1, w2] = this.wingJ[i];
      w1.rotation.set(0, s * sweep * 0.8, s * flap);
      w2.rotation.set(0, s * sweep * 0.4, s * flap2);
    }
    this.tailJ.rotation.set(-0.1 + tail, 0, 0);
    this.headJ.rotation.set(this.headPitch, this.headYaw, 0);
    for (const e of this.eyeGlows) e.scale.setScalar(1 + this.glowLevel[1] * 0.8);
  }
}
