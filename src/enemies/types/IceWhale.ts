/**
 * 冰鲸（ice_whale，第二章 · 北冥冰海的炮击怪）：搁浅在岸冰上的幼鲸，背上结着厚冰壳、藤壶和几根残鱼叉。
 * 按真实的鲸 + 海豹上岸的姿态做：没有后肢，靠两只大前鳍撑地、一耸一耸地往前拖（前鳍撑起前身 → 身体前冲 →
 * 肚皮落回冰面滑一小段 → 前鳍收回前伸），尾干上下摆、尾鳍上下拍（鲸是上下摆尾，不是左右）。笨重、迟缓、哀伤。
 *
 * - 冰柱雨：12–26 米（26 米内不需要视线），喷气孔胀亮 1 秒（喷气孔鼓起、冒白气，抬头蓄势），随后喷气孔猛地冲起
 *   一道约 9 米高的冰雾气柱，5 根冰柱（精英 7 根）跟着冲上天；5 个落点立刻亮出电光蓝预警圈，
 *   约 1.35–2 秒内依次从高空砸下（头顶来的，掩体挡不住，走出圈就躲开）。
 *   落点分布：玩家预判位置一处、玩家左右两侧各一处（封横移）、玩家朝冰鲸看时视野里再随机两处（不砸看不见的身后）。
 * - 冰棱阵：每个落点长出一簇冰棱，持续 5 秒，阻挡移动（不挡子弹和视线）——场地被分割，要绕路。
 * - 翻身拍击：玩家贴到 5.5 米内时，前身昂起、两只前鳍高举 0.8 秒（脚下亮出预警圈），然后整个前身砸回冰面：
 *   身前重击，再推出一圈贴地扩散的冰冲击波（9 米，跳起或掩体能躲）。
 * - 弱点 = 头顶的喷气孔（头部判定挂在 blowhole 骨上，胀亮时更大更亮）：站在高处更好打。
 *   身体很长，头、尾干、尾鳍、前鳍各有命中球（跟着骨骼走）。
 *
 * - 身长避墙：头、尾各一个探测盒（共用碰撞代码不变），转身不把头尾扫进墙，顶进墙就沿身体轴线挪出来。
 *
 * 状态机：move → swell → spout → recover → move
 *         move → rear → slam → recover → move
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, clamp01, damp, raySphere } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import { FROST, FROST_FX_TIME, applyIceGlow, createFrostGlow, launchIcePillars, spawnIceShockwave,
  type FrostGlow, type IceGlowHandle } from '../fx/FrostRangedFx';

export const ICE_WHALE_DEF: ScaledEnemyDef = {
  id: 'ice_whale',
  name: '冰鲸',
  // 美术按体长约 4.8 米（高 2.6 米含残鱼叉）制作，游戏里放大 1.1 倍：约 5.2 米长，下面的尺寸都是放大前的值
  scale: 1.1,
  hp: 340,
  speed: 1.7,
  radius: 1.05,
  height: 2.0,
  damage: 22,
  coins: [4, 7],
  essence: 2,
  // 弱点 = 头顶喷气孔（球心离地约 2.2），判定球挂在 blowhole 骨上
  headY: 2.2,
  headRadius: 0.28,
  knockbackResist: 1,
  color: 0x7fd8ff,
};

/** 保持距离（米）：太近后撤，太远靠近，区间内原地转向玩家 */
const MIN_RANGE = 12;
const MAX_RANGE = 26;
/** 不需要视线的炮击距离、最近 / 最远炮击距离 */
const BLIND_FIRE_RANGE = 26;
const FIRE_RANGE = [6, 32] as const;
const SWELL_TIME = 1.0;
const SPOUT_TIME = 0.55;
const VOLLEY_COOLDOWN = [6, 8] as const;
const RECOVER_TIME = 1.1;
/** 冰柱：数量、首个落地时间、相邻间隔、砸中半径 */
const PILLARS = 5;
const PILLARS_ELITE = 7;
const PILLAR_FIRST = 1.35;
const PILLAR_STAGGER = 0.16;
const PILLAR_RADIUS = 2.0;
/** 随机落点的扇面半角（弧度）：以「玩家 → 冰鲸」方向为中心，保证落点在玩家看冰鲸时的视野里 */
const RANDOM_SPREAD = 1.75;
/** 冰棱阵：分布半径、持续、高度（米，未乘精英缩放） */
const FIELD = { radius: 1.3, duration: 5, height: 1.9 };
/** 翻身拍击：触发距离、前摇、爆心半径（模型单位）、冲击波 */
const SLAM_RANGE = 5.5;
const REAR_TIME = 0.8;
const SLAM_TIME = 0.35;
const SLAM_CORE = 3.0;
const SLAM_CORE_MULT = 1.3;
const WAVE_RADIUS = 9;
const WAVE_SPEED = 13;
const WAVE_MULT = 0.8;
const SLAM_COOLDOWN = [4, 6] as const;
/** 转身角速度（弧度/秒）：慢 */
const TURN_RATE = 1.2;
/**
 * 爬行（海豹式）：一个周期的时长；撑地前冲段（只在这段前进，其余时间肚皮滑行减速），
 * 前冲段与其余时间的移速倍率（整段平均约等于 1）。
 */
const CRAWL_PERIOD = 1.5;
const PUSH = [0.12, 0.52] as const;
const PUSH_SPEED = 1.9;
const DRAG_SPEED = 0.4;
/** 前鳍：一次划多远（模型单位）、抬多高 */
const FLIPPER_SWEEP = 0.5;
const FLIPPER_LIFT = 0.28;
/**
 * 身长避墙：移动碰撞体只是约 2 米见方的盒子，身体却约 5.2 米长。沿朝向在头、尾各放一个探测盒
 * （中心离身体中心多远、半宽、离地高度与高度，模型单位，乘体型）：转身会把头 / 尾扫进墙里就不转，
 * 已经顶进墙里就沿身体轴线往外挪（CLEAR_PUSH 米/秒），往前爬头要撞墙时朝空的一侧拐。
 */
const HEAD_PROBE = 2.1;
const TAIL_PROBE = 2.15;
const PROBE_HALF = 0.4;
const PROBE_Y = 0.4;
const PROBE_H = 1.1;
const CLEAR_PUSH = 1.4;
const STEER_RATE = 1.0;

/**
 * 美术网格实测（模型空间、未缩放；Blender (x, y, z) → (x, z, -y)）：喷气孔中心、两只前鳍掌心、命中球。
 */
const BLOWHOLE = [0, 2.22, 1.66] as const;
const FLIPPER_PADS = [[1.46, 0.08, 1.5], [-1.46, 0.08, 1.5]] as const;
const HIT_SPHERES = [
  { bone: 'head', at: [0, 1.15, 1.55], r: 0.95 },
  { bone: 'tail_1', at: [0, 0.9, -1.15], r: 0.62 },
  { bone: 'fluke', at: [0, 1.35, -1.95], r: 0.62 },
  { bone: 'hand_L', at: [1.45, 0.25, 1.45], r: 0.45 },
  { bone: 'hand_R', at: [-1.45, 0.25, 1.45], r: 0.45 },
] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();

const C = {
  skin: 0x2f4a66, belly: 0xd8dde4, crust: 0xcfeaf8, barnacle: 0x8a8070, harpoon: 0x5a4636,
  hole: 0x3fb8e0, holeHot: 0xeaffff, eye: 0xf2f2e8, eyeHot: 0xffffff,
};

export class IceWhale extends StandardEnemy {
  protected body!: THREE.Group;
  protected head!: THREE.Group;
  protected readonly flippers: { pivot: THREE.Group; side: number }[] = [];
  protected readonly tail: THREE.Group[] = [];
  private holeGlow!: THREE.Mesh;
  private holeAnchor!: THREE.Object3D;
  private readonly padAnchors: THREE.Object3D[] = [];
  private readonly hitAnchors: { o: THREE.Object3D; r: number }[] = [];

  private swellTime = SWELL_TIME;
  private rearTime = REAR_TIME;
  private recoverTime = RECOVER_TIME;
  private slamCd: number;
  private spouted = false;
  private slammed = false;
  private spoutAge = Infinity;
  private slamAge = Infinity;
  private warnCancel: (() => void) | null = null;
  private mistAcc = 0;
  /** 爬行相位（0..1）；停下时把这一耸做完再停 */
  private crawl = 0;
  private lastPlant = [false, false];
  private prevFacing = 0;
  // 平滑后的姿态参数
  private pSwell = 0;
  private pRear = 0;
  private pLookYaw = 0;
  // 贴合模型的特效
  private iceGlow: IceGlowHandle | null = null;
  private holeStar: FrostGlow | null = null;
  private holeStarBase = 1;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, ICE_WHALE_DEF, opts);
    this.walkScale = 0.6;
    this.stepRate = 0.6;
    this.accel = 10;
    this.slamCd = 0;
    this.cooldown = ctx.rng.range(1.5, 3.0);
  }

  /** 只在前鳍撑地前冲时前进（整段平均移速不变） */
  override get speed(): number {
    const pushing = this.crawl >= PUSH[0] && this.crawl < PUSH[1];
    return super.speed * (pushing ? PUSH_SPEED : DRAG_SPEED);
  }

  // ───────────── 白模（?classic / 资产未就绪） ─────────────

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin, { rough: 0.7 }), belly = flat(C.belly), crust = flat(C.crust, { rough: 0.3, emissive: 0x0a2030 });
    // 身体：圆滚滚的长椭球，肚皮贴地
    const body = joint(root, 0, 0.95, -0.2);
    this.body = body;
    part(body, Geo.ico(1.0, 2), skin, 0, 0, 0).scale.set(0.95, 0.9, 1.5);
    part(body, Geo.ico(0.9, 1), belly, 0, -0.35, 0.2).scale.set(0.95, 0.6, 1.5);
    for (let i = 0; i < 5; i++) part(body, Geo.cone(0.16, 0.45, 5), crust, (i % 2 ? 0.25 : -0.2), 0.85 - i * 0.04, 0.6 - i * 0.35, -0.3, 0, 0);
    part(body, Geo.cyl(0.04, 0.04, 1.4, 5), flat(C.harpoon), 0.35, 1.1, -0.2, -0.6, 0, -0.3);
    // 头：圆钝的大头，喷气孔在头顶（弱点）
    const head = joint(body, 0, 0.1, 1.25);
    this.head = head;
    part(head, Geo.ico(0.85, 2), skin, 0, 0.05, 0.35).scale.set(0.95, 0.95, 1.1);
    part(head, Geo.ico(0.7, 1), belly, 0, -0.45, 0.55).scale.set(1, 0.5, 1.2);
    for (const s of [1, -1]) this.glowPart(head, Geo.ico(0.07, 0), C.eye, C.eyeHot, s * 0.55, 0.15, 0.75, 1);
    this.holeGlow = this.glowPart(head, Geo.cyl(0.2, 0.24, 0.12, 10), C.hole, C.holeHot, 0, 0.82, 0.25, 0);
    this.holeAnchor = joint(head, 0, 0.9, 0.25);
    this.setHeadAnchor(this.holeAnchor, 0, 0, 0);
    // 两只大前鳍：根在身体两侧，掌心平铺在冰上
    for (const s of [1, -1]) {
      const pivot = joint(body, s * 0.75, -0.2, 1.0);
      part(pivot, Geo.box(1.0, 0.18, 0.55), skin, s * 0.45, -0.3, 0.1, 0, 0, -s * 0.7);
      part(pivot, Geo.box(0.7, 0.12, 0.8), crust, s * 0.8, -0.7, 0.3, 0, -s * 0.3, 0);
      this.flippers.push({ pivot, side: s });
      this.padAnchors.push(joint(pivot, s * 0.85, -0.75, 0.35));
    }
    // 尾干两节 + 上翘的尾鳍
    let parent: THREE.Object3D = body;
    for (let i = 0; i < 3; i++) {
      const seg = joint(parent, 0, i === 0 ? -0.05 : 0, i === 0 ? -1.3 : -0.45);
      const r = 0.5 - i * 0.14;
      if (i < 2) part(seg, Geo.cyl(r * 0.8, r, 0.5, 8), skin, 0, 0, -0.22, Math.PI / 2, 0, 0);
      else {
        for (const s of [1, -1]) part(seg, Geo.box(0.8, 0.08, 0.5), crust, s * 0.4, 0.2, -0.3, 0.5, s * 0.4, 0);
      }
      this.tail.push(seg);
      parent = seg;
    }
    this.hitAnchors.push({ o: joint(head, 0, 0, 0.35), r: 0.95 }, { o: this.tail[0], r: 0.62 }, { o: this.tail[2], r: 0.62 });
    return root;
  }

  // ───────────── 美术身体 ─────────────

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    this.holeGlow.visible = false;
    this.head.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    const host = this.model.children[0];
    host.updateWorldMatrix(true, true);
    const hostScale = host.getWorldScale(new THREE.Vector3()).x;
    const anchor = (bone: string, at: readonly number[]): THREE.Object3D | null => {
      const b = n.pose.bone(bone);
      if (!b) return null;
      const o = new THREE.Object3D();
      b.add(o);
      o.position.copy(b.worldToLocal(host.localToWorld(_p.set(at[0], at[1], at[2]))));
      return o;
    };
    const hole = anchor('blowhole', BLOWHOLE);
    if (hole) {
      this.holeAnchor = hole;
      this.setHeadAnchor(hole, 0, 0, 0);
    }
    this.padAnchors.length = 0;
    FLIPPER_PADS.forEach((at, i) => {
      const o = anchor(i === 0 ? 'hand_L' : 'hand_R', at);
      if (o) this.padAnchors.push(o);
    });
    this.hitAnchors.length = 0;
    for (const h of HIT_SPHERES) {
      const o = anchor(h.bone, h.at);
      if (o) this.hitAnchors.push({ o, r: h.r });
    }
    this.iceGlow = applyIceGlow(n.materials[0]);
    if (n.glowShell) n.glowShell.color.setHex(0x8af0ff);
    const star = createFrostGlow();
    this.holeAnchor.add(star);
    star.position.y = 0.05 / Math.max(1e-6, this.holeAnchor.getWorldScale(_q).x) * hostScale;
    this.holeStarBase = (0.7 * hostScale) / Math.max(1e-6, this.holeAnchor.getWorldScale(_q).x);
    star.scale.setScalar(this.holeStarBase);
    this.holeStar = star;
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const facing0 = this.facing;
    this.decide(dt);
    this.keepBodyClear(facing0, dt);
  }

  /** 头 / 尾探测盒（朝向 yaw、沿身体轴线 along 米处）是否顶在墙里 */
  bodyProbeBlocked(yaw: number, along: number): boolean {
    const k = this.sizeScale;
    const x = this.position.x + Math.sin(yaw) * along, z = this.position.z + Math.cos(yaw) * along;
    return this.ctx.world.overlapsBody(x, this.position.y + PROBE_Y * k, z, PROBE_HALF * k, PROBE_H * k) !== null;
  }

  /**
   * 身长避墙（在 AI 决定好这一帧的朝向和移动之后）：
   * 1. 这一帧的转身会把头或尾新扫进墙里 → 撤销这次转身；
   * 2. 头在墙里、尾不在 → 沿身体轴线往后挪；尾在墙里、头不在 → 往前挪（去掉往墙里走的分量）；
   * 3. 往前爬、前方头要撞墙 → 朝空的一侧拐。
   */
  private keepBodyClear(facing0: number, dt: number): void {
    const k = this.sizeScale;
    const head = HEAD_PROBE * k, tail = -TAIL_PROBE * k;
    let hb = this.bodyProbeBlocked(this.facing, head);
    let tb = this.bodyProbeBlocked(this.facing, tail);
    // 转身被撤销时，往远离那堵墙的方向挪一点，腾出转身的地方
    let room = 0;
    if ((hb || tb) && this.facing !== facing0) {
      const hb0 = this.bodyProbeBlocked(facing0, head), tb0 = this.bodyProbeBlocked(facing0, tail);
      if ((hb && !hb0) || (tb && !tb0)) {
        room = hb && !hb0 ? -1 : 1;
        this.facing = facing0;
        hb = hb0;
        tb = tb0;
      }
    }
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const push = hb && !tb ? -1 : tb && !hb ? 1 : room;
    if (push !== 0) {
      const along = this.desiredX * fx + this.desiredZ * fz;
      if (along * push < 0) {
        this.desiredX -= along * fx;
        this.desiredZ -= along * fz;
      }
      this.desiredX += fx * push * CLEAR_PUSH;
      this.desiredZ += fz * push * CLEAR_PUSH;
    }
    // 往前爬时看前方一小段：头要撞墙就朝空的一侧拐
    const fwd = this.desiredX * fx + this.desiredZ * fz;
    if (!hb && fwd > 0.2 && this.bodyProbeBlocked(this.facing, head + 0.8 * k)) {
      const l = this.bodyProbeBlocked(this.facing + 0.5, head), r = this.bodyProbeBlocked(this.facing - 0.5, head);
      if (l !== r) this.facing += (l ? -1 : 1) * STEER_RATE * dt;
    }
  }

  private decide(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.slamCd > 0) this.slamCd -= dt;
    this.spoutAge += dt;
    this.slamAge += dt;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0.15 + 0.08 * Math.sin(this.age * 1.6);
        if (this.slamCd <= 0 && d < SLAM_RANGE * (this.isElite ? 1.2 : 1) && this.verticalReach(1.6)) {
          this.beginRear();
          break;
        }
        const canLob = this.sees || d <= BLIND_FIRE_RANGE;
        if (!canLob && this.seekSight(MIN_RANGE - 3, MAX_RANGE, this.speed, 2 * this.sizeScale)) {
          this.faceMovement(TURN_RATE, dt);
          break;
        }
        this.crawlRange(d, dt);
        if (this.cooldown <= 0 && canLob && d >= FIRE_RANGE[0] && d <= FIRE_RANGE[1]) {
          if (this.requestAttack('heavy', SWELL_TIME + SPOUT_TIME + 1.5)) {
            this.swellTime = this.windup(SWELL_TIME, 0.7);
            this.setState('swell');
            this.ctx.audio.play('boss_roar', { position: this.position, volume: 0.45, pitch: 1.6 });
          } else {
            this.cooldown = this.ctx.rng.range(0.6, 1.2);
          }
        }
        break;
      }
      case 'swell': {
        this.stopMoving();
        this.facePlayer(TURN_RATE * 0.6, dt);
        const t = clamp01(this.stateTime / this.swellTime);
        this.glowTarget[0] = 0.3 + 0.7 * t;
        // 喷气孔冒白气、越来越急
        this.mistAcc += dt * (3 + 14 * t);
        if (this.mistAcc >= 1) {
          this.mistAcc = 0;
          this.holeAnchor.getWorldPosition(_p);
          this.ctx.fx.burst(_p, t > 0.6 ? FROST.spark : FROST.mist, 2, 0.8 + 1.5 * t, 0.5, (0.15 + 0.2 * t) * this.sizeScale, -2);
        }
        if (this.stateTime >= this.swellTime) {
          this.spouted = false;
          this.setState('spout');
        }
        break;
      }
      case 'spout': {
        this.stopMoving();
        this.glowTarget[0] = 1;
        if (!this.spouted) {
          this.spouted = true;
          this.spout();
        }
        if (this.stateTime >= SPOUT_TIME) {
          this.recoverTime = RECOVER_TIME;
          this.setState('recover');
        }
        break;
      }
      case 'rear': {
        this.stopMoving();
        this.facePlayer(TURN_RATE * 0.8, dt);
        this.glowTarget[0] = 0.4 + 0.5 * clamp01(this.stateTime / this.rearTime);
        if (this.stateTime >= this.rearTime) {
          this.slammed = false;
          this.setState('slam');
        }
        break;
      }
      case 'slam': {
        this.stopMoving();
        if (!this.slammed && this.stateTime >= SLAM_TIME * 0.6) {
          this.slammed = true;
          this.slam();
        }
        if (this.stateTime >= SLAM_TIME) {
          this.recoverTime = RECOVER_TIME + 0.2;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.facePlayer(TURN_RATE * 0.5, dt);
        this.glowTarget[0] = 0.2;
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          if (this.cooldown <= 0.5) this.rollCooldown(VOLLEY_COOLDOWN[0], VOLLEY_COOLDOWN[1]);
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  /** 保持距离：太远爬近（导航），太近爬开，区间内原地慢慢转向玩家 */
  private crawlRange(d: number, dt: number): void {
    const pl = this.ctx.player.position;
    if (d > MAX_RANGE) {
      this.navigate(pl, this.speed, MAX_RANGE - 2);
      this.faceMovement(TURN_RATE, dt);
    } else if (d < MIN_RANGE) {
      const dx = this.position.x - pl.x, dz = this.position.z - pl.z;
      // 背离玩家（略带横向），找可走点爬过去
      const s = this.strafeSign * 0.5;
      _t.set(this.position.x + (dx - dz * s) * 0.5, this.position.y, this.position.z + (dz + dx * s) * 0.5);
      this.navigate(_t, this.speed, 0.5);
      this.faceMovement(TURN_RATE, dt);
    } else {
      this.stopMoving();
      this.facePlayer(TURN_RATE * 0.7, dt);
    }
  }

  /** 喷出冰柱雨：落点 = 玩家预判、左右两侧、周围随机 */
  private spout(): void {
    const ctx = this.ctx;
    this.holeAnchor.getWorldPosition(_p);
    const targets = this.pickTargets(this.isElite ? PILLARS_ELITE : PILLARS);
    const times = targets.map((_, i) => PILLAR_FIRST + i * PILLAR_STAGGER);
    // 打乱落地顺序（不总是先砸玩家脚下）
    for (let i = times.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng.range(0, i + 0.999));
      [times[i], times[j]] = [times[j], times[i]];
    }
    launchIcePillars(ctx, {
      from: _p, targets, times, radius: PILLAR_RADIUS * (this.isElite ? 1.15 : 1), damage: this.def.damage * this.damageMult,
      source: this, field: FIELD, scale: this.isElite ? 1.15 : 1,
    });
    this.spoutAge = 0;
    ctx.audio.play('explosion', { position: _p, volume: 0.5, pitch: 1.7 });
    ctx.audio.play('shot_launcher', { position: _p, volume: 0.9, pitch: 0.5 });
  }

  /** 落点：地面点，彼此至少相隔 2.6 米，离自己至少 4 米 */
  pickTargets(count: number): THREE.Vector3[] {
    const ctx = this.ctx;
    const pl = ctx.player;
    const out: THREE.Vector3[] = [];
    let fx = pl.position.x - this.position.x, fz = pl.position.z - this.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const cands: [number, number][] = [
      [pl.position.x + pl.velocity.x * 0.6, pl.position.z + pl.velocity.z * 0.6],
      [pl.position.x - fz * 4.2, pl.position.z + fx * 4.2],
      [pl.position.x + fz * 4.2, pl.position.z - fx * 4.2],
      [pl.position.x + fx * 4.0, pl.position.z + fz * 4.0],
    ];
    // 周围的随机点：落在玩家朝冰鲸看时的视野里（以「玩家 → 冰鲸」为中心 ±100° 的扇面，3–6.5 米），
    // 不砸到玩家看不见的身后；黄金比打散方向和半径，再加一点随机抖动
    const toWhale = Math.atan2(-fx, -fz);
    const u0 = ctx.rng.range(0, 1);
    for (let i = 0; i < 16; i++) {
      const u = (u0 + i * 0.618034) % 1;
      const a = toWhale + (u * 2 - 1) * RANDOM_SPREAD + ctx.rng.range(-0.2, 0.2);
      const r = 3 + ((i * 0.381966 + 0.5) % 1) * 3.5 + ctx.rng.range(-0.3, 0.3);
      cands.push([pl.position.x + Math.sin(a) * r, pl.position.z + Math.cos(a) * r]);
    }
    // 第 4 个固定点（玩家身后）只给精英：普通冰鲸用随机点
    if (count < 7) cands.splice(3, 1);
    for (const [x, z] of cands) {
      if (out.length >= count) break;
      _t.set(x, pl.position.y, z);
      if (!ctx.nav.nearestWalkable(_t, _q)) _q.copy(_t);
      if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) < 4 + this.radius) continue;
      if (out.some((o) => Math.hypot(o.x - _q.x, o.z - _q.z) < 2.6)) continue;
      const gy = ctx.world.groundHeight(_q.x, _q.z, pl.position.y + 2);
      out.push(new THREE.Vector3(_q.x, Number.isFinite(gy) ? gy : pl.position.y, _q.z));
    }
    return out;
  }

  private beginRear(): void {
    this.rearTime = this.windup(REAR_TIME, 0.6);
    this.setState('rear');
    this.stopMoving();
    this.slamCd = this.ctx.rng.range(SLAM_COOLDOWN[0], SLAM_COOLDOWN[1]);
    this.slamFront(_p);
    this.warnCancel = this.ctx.fx.groundWarning(_p, SLAM_CORE * this.sizeScale, this.rearTime + SLAM_TIME * 0.6, FROST.warnSolid);
    this.ctx.audio.play('boss_roar', { position: this.position, volume: 0.6, pitch: 1.2 });
  }

  /** 拍击的爆心：身前约 1.6 米（模型单位）的地面 */
  private slamFront(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(0, 0, 1.6, out);
  }

  private slam(): void {
    const ctx = this.ctx;
    this.warnCancel = null;
    this.slamFront(_p);
    const k = this.sizeScale;
    const r = SLAM_CORE * k;
    const pl = ctx.player.position;
    const dd = Math.hypot(pl.x - _p.x, pl.z - _p.z);
    const hit = ctx.player.alive && dd <= r + ctx.player.radius && pl.y - _p.y < 1.4 && pl.y - _p.y > -1;
    if (hit) {
      ctx.combat.damagePlayer(this.def.damage * this.damageMult * SLAM_CORE_MULT, 'none', this, _p);
      const inv = dd > 0.05 ? 1 / dd : 0;
      ctx.player.applyImpulse(_q.set((pl.x - _p.x) * inv * 9, 4.5, (pl.z - _p.z) * inv * 9));
    }
    // 爆心已经吃了重击的玩家不再被冲击波打第二次
    spawnIceShockwave(ctx, {
      center: _p, maxRadius: WAVE_RADIUS * (this.isElite ? 1.2 : 1), speed: WAVE_SPEED,
      damage: hit ? 0 : this.def.damage * this.damageMult * WAVE_MULT, source: this, knockback: 8,
    });
    ctx.fx.burst(_q.set(_p.x, _p.y + 0.3, _p.z), FROST.shard, 26, 8, 0.8, 0.15 * k, 14);
    ctx.fx.burst(_q, FROST.snow, 12, 4, 0.9, 0.5 * k, -0.5);
    ctx.fx.shake(0.45, 0.35);
    ctx.audio.play('boss_slam', { position: _p, volume: 0.9, pitch: 0.9 });
    this.slamAge = 0;
  }

  protected override cancelAttack(): void {
    this.warnCancel?.();
    this.warnCancel = null;
    // 已经喷出的冰柱照样落下（预警随冰柱兑现）
    if (this.state === 'swell' || this.state === 'spout' || this.state === 'rear' || this.state === 'slam' || this.state === 'recover') {
      this.setState('move');
      this.rollCooldown(2, 3);
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (this.iceGlow) this.iceGlow.glow.value = 0;
    this.getBodyCenter(_p);
    const k = this.sizeScale;
    this.ctx.fx.burst(_p, FROST.shard, 30, 5, 1.0, 0.16 * k, 8);
    this.ctx.fx.burst(_p, FROST.mist, 12, 2, 1.4, 0.7 * k, -0.6);
    // 最后一口气：喷气孔喷出一股白雾
    this.holeAnchor.getWorldPosition(_q);
    this.ctx.fx.burst(_q, FROST.mist, 14, 4, 1.2, 0.4 * k, -6);
  }

  protected override onDispose(): void {
    super.onDispose();
    this.warnCancel?.();
    this.warnCancel = null;
    this.holeStar?.material.dispose();
    this.holeStar = null;
  }

  protected override animateDeath(t: number): void {
    // 侧翻、沉下去（瘪下去）
    const e = t * t;
    this.model.rotation.z = e * 0.9;
    this.model.position.y = -e * 0.6;
    const s = this.sizeScale;
    this.model.scale.set(s * (1 + 0.1 * e), Math.max(0.01, s * (1 - 0.5 * e)), s);
    if (this.holeStar) this.holeStar.material.uniforms.uAlpha.value *= 0.8;
  }

  /** 头、尾干、尾鳍、前鳍的命中球（跟着骨骼走），与默认的身体胶囊 + 喷气孔判定一起算 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const base = super.raycastHit(origin, dir, maxDist, out);
    if (!this.alive || this.age < this.spawnDuration) return base;
    let best = -1;
    for (const h of this.hitAnchors) {
      h.o.getWorldPosition(_t);
      const t = raySphere(origin, dir, _t, h.r * this.sizeScale);
      if (t >= 0 && t <= maxDist && (best < 0 || t < best)) best = t;
    }
    if (best < 0) return base;
    if (!base) {
      out.distance = best;
      out.headshot = false;
      return true;
    }
    if (out.headshot ? best < out.distance - this.headRadius * 0.5 : best < out.distance) {
      out.distance = best;
      out.headshot = false;
    }
    return true;
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    // 爬行相位：想移动（或原地转身）时循环；停下时把这一耸做完
    const yawRate = dt > 0 ? Math.abs(angleDiff(this.prevFacing, this.facing)) / dt : 0;
    this.prevFacing = this.facing;
    const wants = Math.hypot(this.desiredX, this.desiredZ) > 0.05 || yawRate > 0.25;
    if (wants || this.crawl > 0) {
      this.crawl += dt / (CRAWL_PERIOD / Math.sqrt(Math.max(0.5, this.speedMult)));
      if (this.crawl >= 1) this.crawl = wants ? this.crawl - 1 : 0;
    }
    const swelling = this.state === 'swell';
    const st = swelling ? clamp01(this.stateTime / this.swellTime) : 0;
    this.pSwell = damp(this.pSwell, swelling ? st : 0, swelling ? 12 : 5, dt);
    const rearing = this.state === 'rear';
    const rt = rearing ? clamp01(this.stateTime / this.rearTime) : 0;
    // 昂起慢、砸下快
    this.pRear = rearing ? damp(this.pRear, Math.sin(rt * Math.PI * 0.5), 10, dt) : damp(this.pRear, 0, 30, dt);
    const pl = this.ctx.player.position;
    const want = angleDiff(this.facing, Math.atan2(pl.x - this.position.x, pl.z - this.position.z));
    this.pLookYaw = damp(this.pLookYaw, clamp(want, -0.5, 0.5), 3, dt);

    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();

    // 喷气孔：平时微光，胀亮时越来越亮，喷出瞬间最亮
    FROST_FX_TIME.value = this.ctx.time.now;
    const flash = Math.exp(-this.spoutAge * 5);
    const heat = Math.max(this.pSwell, flash);
    if (this.iceGlow) this.iceGlow.glow.value = 0.4 + 1.8 * heat;
    const shell = this.nativeBody?.glowShell;
    if (shell) shell.opacity = clamp01(0.1 + 0.04 * Math.sin(this.age * 1.8) + 0.6 * heat);
    if (this.holeStar) {
      this.holeStar.scale.setScalar(this.holeStarBase * (0.5 + 1.2 * heat) * (1 + 0.06 * Math.sin(this.age * 23)));
      this.holeStar.material.uniforms.uAlpha.value = 0.2 + 0.8 * heat;
    }
    // 平时偶尔从喷气孔呼出一小团白气
    if (this.state === 'move' && Math.sin(this.age * 0.9 + this.id) > 0.995) {
      this.holeAnchor.getWorldPosition(_p);
      this.ctx.fx.burst(_p, FROST.mist, 3, 1.2, 0.9, 0.3 * this.sizeScale, -3);
    }
  }

  /**
   * 美术骨骼动画（模型空间：X = 鲸的左侧，Y = 上，Z = 前；绕 +X 正转 = 前端下压）。
   * 爬行：前鳍撑地段（两骨 IK 把腕钉在冰上、相对身体往后划）前身抬起前冲，回收段前鳍抬起前伸、前身落回冰面；
   * 尾干与尾鳍上下摆（波沿尾巴往后传）。胀亮：抬头、喷气孔鼓起；喷出：甩头、喷气孔收缩。
   * 昂起：整个前身绕腰抬起、两只前鳍高举；拍击：前身砸回冰面、前鳍拍地。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    void dt;
    const h = this.crawl;
    const moving = h > 0 ? 1 : 0;
    // 撑地段（前冲）与回收段
    const push = h >= PUSH[0] && h < PUSH[1] ? Math.sin(Math.PI * (h - PUSH[0]) / (PUSH[1] - PUSH[0])) : 0;
    const plant = h < PUSH[1] + 0.05 ? 1 : 0;
    const rec = h >= PUSH[1] ? Math.sin(Math.PI * (h - PUSH[1]) / (1 - PUSH[1])) : 0;
    const sw = this.pSwell, rear = this.pRear;
    const spout = Math.exp(-this.spoutAge * 7) * (this.spoutAge < 2 ? 1 : 0);
    const slam = Math.exp(-this.slamAge * 6) * (this.slamAge < 2 ? 1 : 0);
    const breathe = Math.sin(this.age * 1.1);

    // 前身：撑地时抬起（绕腰），回收时落回；昂起时大幅抬起；拍击瞬间压扁
    P.translate('root', 0, 0.06 * push * moving - 0.06 * slam, 0);
    P.rotate('hips', AX, -0.03 * push - 0.32 * rear + 0.06 * slam - 0.08 * sw);
    P.rotate('chest', AX, -0.08 * push + 0.03 * rec - 0.22 * rear + 0.1 * slam - 0.05 * sw + 0.012 * breathe);
    P.rotate('head', AX, 0.05 * push - 0.18 * sw + 0.24 * spout - 0.12 * rear + 0.12 * slam - 0.12 * this.hurtKick);
    P.rotate('head', AY, this.pLookYaw * 0.6);
    P.rotate('chest', AY, this.pLookYaw * 0.3);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(this.age * 6) * 0.08);
    // 喷气孔：胀亮鼓起并抖动，喷出瞬间收缩
    const hole = 1 + 0.4 * sw + 0.05 * sw * Math.sin(this.age * 31) - 0.3 * spout;
    P.scale('blowhole', Math.max(0.6, hole), Math.max(0.6, 1 + 0.25 * sw - 0.2 * spout), Math.max(0.6, hole));
    // 尾巴：上下摆（鲸的摆尾），爬行时随前冲节奏，平时慢慢摆；昂起时尾巴压低撑地，胀亮时翘起
    const wave = this.age * 1.4 + h * Math.PI * 2 * moving;
    const tailAmp = 0.06 + 0.1 * moving;
    // （腰抬前身时尾巴跟着往下压：尾干反向抬回来，尾鳍贴着冰面撑住）
    P.rotate('tail_1', AX, tailAmp * Math.sin(wave) + 0.3 * rear + 0.03 * push + 0.16 * sw);
    P.rotate('tail_2', AX, tailAmp * 1.3 * Math.sin(wave - 0.8) + 0.06 * rear + 0.15 * sw);
    P.rotate('fluke', AX, tailAmp * 1.8 * Math.sin(wave - 1.6) + 0.2 * sw + 0.25 * slam);

    // 前鳍
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      const s = i === 0 ? 1 : -1;
      const u = `upperarm_${side}`, l = `forearm_${side}`, e = `hand_${side}`;
      if (rear > 0.02 || slam > 0.05) {
        // 昂起：前鳍向外上方高举；拍击：狠狠拍回地面（略压过头）
        P.rotate(u, AZ, s * (1.1 * rear - 0.15 * slam));
        P.rotate(l, AZ, s * 0.35 * rear);
        P.rotate(e, AZ, s * 0.2 * rear);
        if (rear > 0.5) continue;
      }
      const rest = P.restPosition(e);
      if (!rest) continue;
      let dz: number, dy: number;
      if (plant && h < PUSH[1]) {
        // 撑地：腕钉在冰上，相对身体从前往后划
        const k = (h - 0) / PUSH[1];
        dz = FLIPPER_SWEEP * (0.5 - k) * moving;
        dy = 0;
      } else {
        // 回收：抬起前伸
        const k = (h - PUSH[1]) / (1 - PUSH[1]);
        dz = FLIPPER_SWEEP * (-0.5 + k * k * (3 - 2 * k)) * moving;
        dy = rec * FLIPPER_LIFT * moving;
      }
      // 胀亮时两鳍撑开撑稳
      _t.set(rest.x + s * 0.08 * sw, rest.y + dy, rest.z + dz);
      P.twoBoneIK(u, l, e, _t, 1);
      // 鳍落地扬雪
      const down = moving > 0 && h < PUSH[1];
      if (down && !this.lastPlant[i]) this.padSnow(i);
      this.lastPlant[i] = down;
    }
  }

  private padSnow(i: number): void {
    const a = this.padAnchors[i];
    if (!a) return;
    a.getWorldPosition(_p);
    _p.y = this.position.y + 0.1;
    this.ctx.fx.burst(_p, FROST.snow, 6, 1.8, 0.5, 0.2 * this.sizeScale, 4);
  }

  /** 白模动画：前身随爬行起伏、前鳍划动、尾巴上下摆；昂起拍击、胀亮抬头 */
  private poseBlockout(): void {
    const h = this.crawl;
    const push = h >= PUSH[0] && h < PUSH[1] ? Math.sin(Math.PI * (h - PUSH[0]) / (PUSH[1] - PUSH[0])) : 0;
    const rear = this.pRear, sw = this.pSwell;
    const spout = Math.exp(-this.spoutAge * 7);
    const slam = Math.exp(-this.slamAge * 6);
    this.body.position.y = 0.95 + 0.06 * push - 0.06 * slam;
    this.body.rotation.x = -0.08 * push - 0.45 * rear + 0.1 * slam - this.hurtKick * 0.1;
    this.body.rotation.z = this.stunTime > 0 ? Math.sin(this.age * 6) * 0.08 : 0;
    this.head.rotation.set(-0.2 * sw + 0.25 * spout, this.pLookYaw * 0.6, 0);
    for (const f of this.flippers) {
      const swing = h < PUSH[1] ? (0.5 - h / PUSH[1]) : (-0.5 + (h - PUSH[1]) / (1 - PUSH[1]));
      f.pivot.rotation.set(0, f.side * swing * 0.6 * (h > 0 ? 1 : 0), f.side * (1.0 * rear - 0.15 * slam));
    }
    const wave = this.age * 1.4 + h * Math.PI * 2;
    this.tail.forEach((seg, i) => {
      seg.rotation.x = (0.08 + 0.06 * i) * Math.sin(wave - i * 0.8) + 0.12 * sw + (i === 0 ? 0.4 : 0) * rear;
    });
    this.holeGlow.scale.setScalar(1 + 0.5 * sw - 0.3 * spout);
  }
}
