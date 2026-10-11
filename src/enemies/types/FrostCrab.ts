/**
 * 玄冰巨蟹（frost_crab，第二章 · 北冥冰海的坦克）：冰海里的巨蟹，墨蓝的厚甲上结着海冰和藤壶，背上还拖着一截沉船的木杆。
 * 右边一只扁平的巨钳竖在脸前当墙，左边一只小钳；八条步足横着走；背后甲壳和腹节之间一道发青光的鳃缝是弱点。
 * 格挡靠身体本身（巨钳和甲壳），不持盾。美术按 2.2 米（含木杆）制作，游戏里整体放大 1.5 倍（约 3 米宽、3.3 米高），
 * 血厚甲厚、不吃击退，与三彩镇墓兽同档（docs/art/enemy-roster-v2.md「北冥五怪 · 战斗设计」）。
 *
 * - 钳墙推进：始终把巨钳对着玩家（每秒约 1.1 弧度转身），身子却是横着走——一阵往左、一阵往右地斜着逼近，
 *   正面来的伤害只吃 15%（打在巨钳上迸冰屑、脆响）；转身慢，绕到身后打背缝。
 * - 夹击：贴身时巨钳张开、高高抬起 0.6 秒（身前扇形预警），然后猛地夹下：重伤，并把人甩向一侧。看到钳子张开就后撤。
 *   夹完收钳 0.7 秒，这段时间巨钳放下、不格挡。
 * - 横扫：玩家绕到侧面 / 身后 5.5 米内时，小钳往外一扬 0.5 秒，然后横扫一圈，推出一道贴地扩散的冰屑冲击环（跳起能躲）。
 * - 掀壳：血量低于 35% 时巨钳碎裂（冰屑和蟹壳四溅、巨钳整只崩掉）：不再夹击，正面减伤只剩一半，
 *   走得更快、转得更快、横扫冷却减半——更狂暴，但输出窗口变大。
 * - 精英：夹击后立刻补一记横扫。
 *
 * 状态机：advance → grabWindup → grab → grabRecover → advance
 *         advance → sweepWindup → sweep → advance
 *         （低于 35%）任意 → shellBreak → advance（之后没有夹击）
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
import { FROST, frostVapour, iceCrack, iceShards } from '../fx/FrostTankFx';

export const FROST_CRAB_DEF: ScaledEnemyDef = {
  id: 'frost_crab',
  name: '玄冰巨蟹',
  hp: 620,
  armor: 200,
  speed: 2.4,
  radius: 1.0,
  height: 1.6,
  damage: 40,
  coins: [8, 12],
  essence: 3,
  // 弱点 = 背后的发光鳃缝（静止时离地约 1 米，在身体后方，模型单位）
  headY: 1.0,
  headRadius: 0.36,
  knockbackResist: 1,
  color: 0x5fe8e0,
  // 美术按 2.2 米（含背上木杆）制作，游戏里放大 1.5 倍：命中盒、弱点、特效一起放大
  scale: 1.5,
};

/** 正面格挡：来自正面这个夹角（余弦）以内的伤害乘以 GUARD_FACTOR；巨钳碎了只剩 BROKEN_GUARD */
const GUARD_FACTOR = 0.15;
const BROKEN_GUARD = 0.5;
const GUARD_COS = 0.25;
/** 转身角速度（弧度/秒）、横走时前进分量占比、换方向的间隔（秒） */
const TURN_RATE = 1.1;
const FORWARD_SHARE = 0.45;
const SIDE_SWITCH = [1.6, 2.8] as const;
/** 夹击：触发距离、命中距离（米，从中心算）、扇形半角余弦、前摇、伤害倍率、甩出速度、收钳时长、冷却 */
const GRAB_RANGE = 4.0;
const GRAB_REACH = 4.4;
const GRAB_COS = 0.6;
const GRAB_WINDUP = 0.6;
const GRAB_MULT = 1.6;
const GRAB_FLING = 11;
const GRAB_RECOVER = 0.7;
const GRAB_COOLDOWN = [3.5, 4.5] as const;
/** 横扫：触发距离（米）、前摇、冲击环起止半径与速度（米）、伤害倍率、击退、冷却 */
const SWEEP_RANGE = 5.5;
const SWEEP_WINDUP = 0.5;
const SWEEP_INNER = 1.4;
const SWEEP_RADIUS = 6.5;
const SWEEP_SPEED = 18;
const SWEEP_MULT = 0.75;
const SWEEP_KNOCK = 7;
const SWEEP_COOLDOWN = [4, 5] as const;
/** 跳起高于这个高度（米）就躲过冲击环 */
const SWEEP_JUMP_CLEAR = 0.6;
/** 掀壳：血量比例阈值、移速 / 转身倍率、碎钳演出时长 */
const BREAK_AT = 0.35;
const BREAK_SPEED = 1.35;
const BREAK_TURN = 1.4;
const BREAK_TIME = 0.9;
/** 弱点位置（模型空间，未缩放；按美术网格实测）：背后鳃缝中心 */
const VENT_POINT = new THREE.Vector3(0, 1.0, -0.95);
/** 脚步震屏：这个距离（米）内能感觉到 */
const STEP_SHAKE_RANGE = 18;

/**
 * 八足步态（美术骨骼）：交替四足支撑（L1 R2 L3 R4 一组、R1 L2 R3 L4 一组），触地段脚按「模型空间里的移动方向」往后扫，
 * 腾空段抬脚摆回去——横着走时脚就横着迈。步频随速度升高，一步里脚尖最多扫过多远（模型局部单位）、抬脚高度。
 */
const GAIT_FREQ = [1.4, 2.4] as const;
const GAIT_DUTY = 0.55;
const GAIT_SWEEP = 0.34;
const GAIT_LIFT = 0.16;
const LEGS = [1, 2, 3, 4].flatMap((i) => (['L', 'R'] as const).map((s) => ({
  u: `leg${i}_thigh_${s}`, l: `leg${i}_shin_${s}`, e: `leg${i}_foot_${s}`, side: s === 'L' ? 1 : -1,
  phase: ((i + (s === 'L' ? 0 : 1)) % 2) * 0.5,
})));

const C = {
  shell: 0x2f4a6a, shellDark: 0x1f3048, ice: 0xbfe8ff, barnacle: 0xd8ccb0, leg: 0x3a5576, eye: 0x5fe8ff, eyeHot: 0xe0ffff,
  vent: 0x3fb8c8, ventHot: 0xc8ffff, wood: 0x5a4430,
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

/** 每个 GameContext 只注册一次全局伤害修正（正面钳墙） */
const guardInstalled = new WeakSet<object>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

interface BlockLeg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  side: number;
  phase: number;
}

export class FrostCrab extends StandardEnemy {
  // 白模骨架（?classic 与资产缺失时的兜底）
  private body!: THREE.Group;
  private bigClaw!: THREE.Group;
  private bigJaw!: THREE.Group;
  private smallClaw!: THREE.Group;
  private legs: BlockLeg[] = [];
  private ventAnchor!: THREE.Object3D;

  private windTime = GRAB_WINDUP;
  private grabCd: number;
  private sweepCd: number;
  private sideTimer = 0;
  private sideSign = 1;
  private sector: GroundDecal | null = null;
  private ring: GroundDecal | null = null;
  private blockFxAt = 0;
  private alerted = false;
  private chainSweep = false;
  /** 巨钳已碎（血量低于 35%） */
  broken = false;
  /** 最近一次夹击是否夹中了玩家（测试与调试用） */
  struck = false;
  // 平滑后的姿态：张钳、夹下、扬小钳、横扫、碎钳
  private pOpen = 0;
  private pSnap = 0;
  private pRaise = 0;
  private pSweep = 0;
  private pBreak = 0;
  private gait = 0;
  private readonly legU = new Array<number>(8).fill(0);

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FROST_CRAB_DEF, opts);
    this.walkScale = 0.5;
    this.stepRate = 1.4;
    this.grabCd = ctx.rng.range(1, 2);
    this.sweepCd = ctx.rng.range(1.5, 3);
    this.sideSign = ctx.rng.sign();
    installGuard(ctx);
  }

  override get speed(): number {
    return super.speed * (this.broken ? BREAK_SPEED : 1);
  }

  /** 钳墙格挡中（推进、各种前摇）；夹下后的收钳、碎钳演出不挡 */
  get guarding(): boolean {
    return this.alive && this.stunTime <= 0
      && (this.state === 'advance' || this.state === 'grabWindup' || this.state === 'sweepWindup' || this.state === 'sweep' || this.state === 'idle');
  }

  /** 这次伤害的倍率：正面被巨钳和甲壳挡住时大幅减伤（碎钳后只剩一半），打在钳上迸冰屑 */
  guardFactor(req: DamageRequest): number {
    if (req.source === 'status' || !this.guarding) return 1;
    if (req.direction) _v.set(-req.direction.x, 0, -req.direction.z);
    else _v.set(this.ctx.player.position.x - this.position.x, 0, this.ctx.player.position.z - this.position.z);
    const len = _v.length();
    if (len < 1e-4) return 1;
    _f.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (_v.dot(_f) / len < GUARD_COS) return 1;
    const now = this.ctx.time.now;
    if (now - this.blockFxAt > 0.07) {
      this.blockFxAt = now;
      this.localPoint(-0.45 + (Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 1.0, 1.3, _p);
      this.ctx.fx.burst(_p, FROST.ice, 6, 5, 0.3, 0.07 * this.sizeScale, 8);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.35, pitch: 2.0 });
    }
    return this.broken ? BROKEN_GUARD : GUARD_FACTOR;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const shell = flat(C.shell, { rough: 0.45 }), dark = flat(C.shellDark, { rough: 0.6 }), ice = flat(C.ice, { rough: 0.25 });
    const legMat = flat(C.leg, { rough: 0.5 }), barn = flat(C.barnacle, { rough: 0.8 });
    // 身体：宽扁的墨蓝甲壳，上面结着冰和藤壶，背上一截木杆（身体中心离地约 1.05）
    const body = joint(root, 0, 1.05, 0.15);
    this.body = body;
    part(body, Geo.ico(1, 2), shell, 0, 0.25, -0.1).scale.set(0.85, 0.5, 0.9);
    part(body, Geo.ico(1, 1), dark, 0, -0.15, -0.15).scale.set(0.6, 0.35, 0.7);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(body, Geo.cone(0.09, 0.4, 5, 'bottom'), ice, Math.sin(a) * 0.5, 0.55, Math.cos(a) * 0.5 - 0.1, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
      part(body, Geo.ico(0.06, 0), barn, Math.sin(a + 0.4) * 0.65, 0.4, Math.cos(a + 0.4) * 0.6 - 0.1);
    }
    part(body, Geo.box(0.07, 0.75, 0.07), flat(C.wood, { rough: 0.9 }), 0.05, 0.95, -0.55, 0.15, 0, 0.1);
    // 眼柄
    for (const s of [1, -1]) {
      part(body, Geo.cyl(0.035, 0.04, 0.35, 5, 'bottom'), dark, s * 0.2, 0.2, 0.62);
      this.glowPart(body, Geo.ico(0.07, 1), C.eye, C.eyeHot, s * 0.2, 0.58, 0.62);
    }
    // 背后鳃缝（弱点）
    this.ventAnchor = joint(body, 0, -0.05, -1.05);
    this.glowPart(this.ventAnchor, Geo.box(0.8, 0.18, 0.1), C.vent, C.ventHot, 0, 0, 0, 1);
    this.setHeadAnchor(this.ventAnchor, 0, 0, 0);
    // 巨钳（生物右侧 -X）：钳掌 + 上颚
    const arm = joint(body, -0.35, -0.1, 0.35);
    part(arm, Geo.cyl(0.12, 0.14, 0.45, 6), legMat, -0.12, 0, 0.15, Math.PI / 2, 0, 0.6);
    const claw = joint(arm, -0.3, 0.05, 0.4);
    this.bigClaw = claw;
    part(claw, Geo.ico(1, 1), shell, 0, -0.1, 0.35).scale.set(0.35, 0.45, 0.5);
    part(claw, Geo.box(0.62, 0.08, 0.8), ice, 0, 0.12, 0.45);
    const jaw = joint(claw, 0, 0.15, 0.1);
    this.bigJaw = jaw;
    part(jaw, Geo.ico(1, 1), shell, 0, 0.18, 0.35).scale.set(0.34, 0.25, 0.5);
    // 小钳（生物左侧 +X）
    const sArm = joint(body, 0.32, -0.25, 0.3);
    this.smallClaw = sArm;
    part(sArm, Geo.cyl(0.08, 0.1, 0.5, 6), legMat, 0.08, 0, 0.25, Math.PI / 2, 0, -0.3);
    part(sArm, Geo.cone(0.16, 0.55, 6), ice, 0.12, -0.15, 0.7, Math.PI / 2 + 0.5, 0, 0);
    part(sArm, Geo.cone(0.1, 0.4, 6), shell, 0.2, -0.05, 0.65, Math.PI / 2 + 0.2, 0, 0);
    // 八条步足：每侧四条，膝在最高处，脚尖是冰锥
    for (let i = 0; i < 4; i++) {
      for (const s of [1, -1]) {
        const z = 0.35 - i * 0.42;
        const upper = joint(body, s * 0.5, -0.1, z);
        upper.rotation.set(0, 0, s * 0.25);
        part(upper, Geo.box(0.42, 0.13, 0.15, 'center'), legMat, s * 0.2, 0, 0);
        const lower = joint(upper, s * 0.4, 0, 0);
        part(lower, Geo.cyl(0.07, 0.05, 0.75, 5, 'top'), legMat, 0, 0, 0);
        part(lower, Geo.cone(0.06, 0.28, 5), ice, 0, -0.85, 0, Math.PI, 0, 0);
        this.legs.push({ upper, lower, side: s, phase: ((i + (s > 0 ? 1 : 2)) % 2) * Math.PI });
      }
    }
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    const vent = n.pose.bone('vent');
    if (vent) {
      // 弱点判定跟着美术的鳃缝走；鳃缝的发光由发光壳负责，白模的发光条收起
      const host = this.model.children[0];
      host.updateWorldMatrix(true, true);
      const a = new THREE.Object3D();
      vent.add(a);
      a.position.copy(vent.worldToLocal(host.localToWorld(VENT_POINT.clone())));
      this.ventAnchor = a;
      this.setHeadAnchor(a, 0, 0, 0);
    }
    // 鳃缝发光壳：冰海的青色（管线默认的暖橙是镇墓兽日火的颜色）
    n.glowShell?.color.setHex(0x9ffcff);
    // 白模的眼睛、鳃缝发光件按方块摆，对不上美术（美术贴图自带青色的眼睛和鳃缝）：收起
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
  }

  protected override cancelAttack(): void {
    this.hideWarnings();
    this.releaseAttack();
    if (this.state !== 'advance' && this.state !== 'idle' && this.state !== 'shellBreak') {
      this.setState('advance');
      this.grabCd = Math.max(this.grabCd, 1.5);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideWarnings();
  }

  private hideWarnings(): void {
    this.sector?.release();
    this.sector = null;
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

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    const yawTo = this.yawToPlayer();
    this.grabCd -= dt * this.attackRate;
    this.sweepCd -= dt * this.attackRate * (this.broken ? 2 : 1);
    if (!this.alerted && this.sees && d < 28) {
      this.alerted = true;
      this.localPoint(0, 1.2, 0.8, _p);
      this.ctx.audio.play('enemy_alert', { position: _p, volume: 0.8, pitch: 0.45 });
    }
    if (!this.broken && this.hp / this.maxHp < BREAK_AT && this.state !== 'shellBreak') {
      this.breakClaw();
      return;
    }
    switch (this.state) {
      case 'advance': {
        this.accel = 16;
        this.glowTarget[1] = (this.broken ? 0.6 : 0.3) + 0.15 * Math.sin(this.age * 2.2);
        this.facing = rotateTowards(this.facing, yawTo, TURN_RATE * (this.broken ? BREAK_TURN : 1) * dt);
        const fd = this.facingDot();
        if (!this.broken && this.grabCd <= 0 && d <= GRAB_RANGE && fd > 0.75 && this.verticalReach(1.8) && this.requestAttack('melee', 2)) {
          this.beginGrab();
          break;
        }
        const flank = fd < 0.6 || this.broken;
        if (this.sweepCd <= 0 && d <= SWEEP_RANGE && flank && this.verticalReach(1.5) && this.requestAttack('melee', 1.5)) {
          this.beginSweep();
          break;
        }
        this.scuttle(dt, d);
        break;
      }
      case 'grabWindup': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        // 前 50% 还能对准玩家，之后锁定（后撤 / 侧移可躲）
        if (t < 0.5) this.facing = rotateTowards(this.facing, yawTo, 1.6 * dt);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.updateSector(t);
        if (this.stateTime >= this.windTime) this.grab();
        break;
      }
      case 'grab': {
        this.stopMoving();
        if (this.stateTime >= 0.2) this.setState('grabRecover');
        break;
      }
      case 'grabRecover': {
        this.stopMoving();
        this.glowTarget[0] = 0;
        if (this.stateTime >= GRAB_RECOVER) {
          if (this.chainSweep) {
            this.chainSweep = false;
            this.beginSweep();
          } else this.toAdvance();
        }
        break;
      }
      case 'sweepWindup': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.3 + 0.5 * t;
        if (this.ring) {
          this.ring.circle(this.position.x, this.position.y, this.position.z, SWEEP_RADIUS, SWEEP_INNER);
          this.ring.fill = t;
          this.ring.opacity = 0.55 + 0.4 * t;
        }
        if (this.stateTime >= this.windTime) this.sweep();
        break;
      }
      case 'sweep': {
        this.stopMoving();
        if (this.stateTime >= 0.45) this.toAdvance();
        break;
      }
      case 'shellBreak': {
        this.stopMoving();
        this.glowTarget[1] = 1;
        if (this.stateTime >= BREAK_TIME) this.toAdvance();
        break;
      }
      default:
        this.setState('advance');
    }
  }

  private toAdvance(): void {
    this.setState('advance');
    this.accel = 16;
    this.releaseAttack();
  }

  /**
   * 横着走：身体（巨钳）对着玩家，移动方向是「身体侧向为主、带一点前进」，一阵往左一阵往右；
   * 贴近后只横移不前进（钳墙堵脸），撞墙就换方向。
   */
  private scuttle(dt: number, d: number): void {
    this.sideTimer -= dt;
    if (this.sideTimer <= 0 || this.moveResult.hitWall) {
      if (this.sideTimer <= 0 || this.sideTimer < SIDE_SWITCH[0] - 0.6) this.sideSign = -this.sideSign;
      this.sideTimer = this.ctx.rng.range(SIDE_SWITCH[0], SIDE_SWITCH[1]);
    }
    const near = 2.6 * this.sizeScale * 0.8;
    if (!this.sees || this.blindTime > 0.5) {
      // 看不到玩家：走导航绕过来
      this.approachPlayer(this.speed, near);
      return;
    }
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    // 生物的左侧（模型 +X）在世界里是 (cos f, -sin f)
    const sx = Math.cos(this.facing) * this.sideSign, sz = -Math.sin(this.facing) * this.sideSign;
    const fwd = d > near ? FORWARD_SHARE : d < near * 0.8 ? -0.25 : 0;
    this.setMove(sx + fx * fwd, sz + fz * fwd, this.speed);
  }

  // ───────────── 夹击 ─────────────

  private beginGrab(): void {
    this.windTime = this.windup(GRAB_WINDUP, 0.45);
    this.setState('grabWindup');
    this.stopMoving();
    this.struck = false;
    this.hideWarnings();
    // 实色电光蓝 + 普通混合：浅色冰面上叠加的浅青预警会被地面吃掉，只剩巨钳的影子（像一团黑影）
    this.sector = GroundDecal.acquire(this.ctx.stageGroup, FROST.warnSolid);
    this.sector.solid = true;
    this.sector.soft = 0.15;
    this.updateSector(0);
    this.localPoint(-0.6, 1.4, 1.2, _p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.9, pitch: 0.6 });
  }

  /** 身前扇形预警：巨钳夹得到的范围 */
  private updateSector(t: number): void {
    if (!this.sector) return;
    this.sector.circle(this.position.x, this.position.y, this.position.z, GRAB_REACH, 0, this.facing, Math.acos(GRAB_COS));
    this.sector.fill = t;
    // 越接近夹下越亮，最后 30% 快闪
    this.sector.opacity = t < 0.7 ? 0.6 + 0.4 * t : 0.85 + 0.15 * Math.sin(this.stateTime * 40);
  }

  private grab(): void {
    this.setState('grab');
    this.hideWarnings();
    const pl = this.ctx.player;
    this.localPoint(-0.55, 1.0, 2.0, _p);
    this.ctx.audio.play('boss_slam', { position: _p, volume: 0.8, pitch: 1.2 });
    iceShards(this.ctx, _p, this.sizeScale * 0.8, 10, 5);
    this.quake(0.4, STEP_SHAKE_RANGE, 0.25);
    const d = this.distToPlayerXZ();
    if (pl.alive && d <= GRAB_REACH + pl.radius && this.facingDot() > GRAB_COS && this.verticalReach(2.2)) {
      this.struck = true;
      this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * GRAB_MULT, 'none', this, _p);
      // 夹住甩出：甩向巨钳那一侧（生物右侧 -X），带一点上抛
      _v.set(-Math.cos(this.facing), 0, Math.sin(this.facing)).multiplyScalar(GRAB_FLING);
      _v.addScaledVector(_f.set(Math.sin(this.facing), 0, Math.cos(this.facing)), 3);
      _v.y = 6;
      pl.applyImpulse(_v);
      pl.cameraPunch(0.6, -0.3);
      this.ctx.fx.shake(0.9, 0.35);
    }
    this.grabCd = this.ctx.rng.range(GRAB_COOLDOWN[0], GRAB_COOLDOWN[1]);
    this.chainSweep = this.isElite;
  }

  // ───────────── 横扫 ─────────────

  private beginSweep(): void {
    this.windTime = this.windup(SWEEP_WINDUP, 0.35);
    this.setState('sweepWindup');
    this.stopMoving();
    this.hideWarnings();
    this.ring = GroundDecal.acquire(this.ctx.stageGroup, FROST.warnSolid);
    this.ring.solid = true;
    this.localPoint(0.6, 1.0, 1.0, _p);
    this.ctx.audio.play('telegraph', { position: _p, volume: 0.8, pitch: 1.1 });
  }

  private sweep(): void {
    this.setState('sweep');
    this.hideWarnings();
    const ctx = this.ctx;
    const gy = ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
    const ground = new THREE.Vector3(this.position.x, Number.isFinite(gy) ? gy : this.position.y, this.position.z);
    ctx.audio.play('enemy_melee', { position: ground, volume: 1, pitch: 0.5 });
    ctx.fx.ring(ground, SWEEP_RADIUS, FROST.ice, SWEEP_RADIUS / SWEEP_SPEED);
    this.quake(0.35, STEP_SHAKE_RANGE, 0.25);
    this.launchWave(ground);
    this.sweepCd = ctx.rng.range(SWEEP_COOLDOWN[0], SWEEP_COOLDOWN[1]);
  }

  /** 贴地扩散的冰屑冲击环：波面扫过地上的玩家（只打一次）造成伤害并往外推；跳起能躲 */
  private launchWave(center: THREE.Vector3): void {
    const ctx = this.ctx;
    const dmg = this.def.damage * this.damageMult * SWEEP_MULT;
    const source = this;
    let r = SWEEP_INNER, prev = SWEEP_INNER, hit = false, fxAcc = 0;
    ctx.tasks.add((dt) => {
      prev = r;
      r = Math.min(SWEEP_RADIUS, r + SWEEP_SPEED * dt);
      const pl = ctx.player;
      if (!hit && pl.alive) {
        const dx = pl.position.x - center.x, dz = pl.position.z - center.z;
        const dist = Math.hypot(dx, dz);
        const rise = pl.position.y - center.y;
        if (dist >= prev - 0.4 && dist <= r + 0.4 && rise > -0.6 && rise < SWEEP_JUMP_CLEAR) {
          hit = true;
          ctx.combat.damagePlayer(dmg, 'none', source, center);
          _v.set(dx, 0, dz).normalize().multiplyScalar(SWEEP_KNOCK);
          _v.y = 4;
          pl.applyImpulse(_v);
        }
      }
      fxAcc += (r - prev) * 2.4;
      while (fxAcc >= 1) {
        fxAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        _p.set(center.x + Math.cos(a) * r, center.y + 0.15, center.z + Math.sin(a) * r);
        ctx.fx.burst(_p, Math.random() < 0.5 ? FROST.ice : FROST.snow, 2, 2.5, 0.45, 0.16, 8);
      }
      return r >= SWEEP_RADIUS;
    });
  }

  // ───────────── 掀壳 ─────────────

  /** 巨钳碎裂：冰屑和蟹壳四溅、巨钳整只崩掉；之后不再夹击，正面减伤只剩一半，走得更快、横扫更勤 */
  private breakClaw(): void {
    this.broken = true;
    this.hideWarnings();
    this.releaseAttack();
    this.setState('shellBreak');
    this.stopMoving();
    const ctx = this.ctx, k = this.sizeScale;
    const claw = this.nativeBody?.pose.bone('claw_R');
    if (claw) claw.getWorldPosition(_p);
    else this.localPoint(-0.65, 1.05, 0.9, _p);
    iceShards(ctx, _p, k, 30, 9);
    ctx.fx.burst(_p, C.shell, 16, 7, 1.0, 0.16 * k, 18);
    frostVapour(ctx, _p, k, 8, FROST.aqua);
    ctx.audio.play('shield_break', { position: _p, volume: 1, pitch: 0.55 });
    ctx.audio.play('boss_roar', { position: this.position, volume: 0.7, pitch: 1.3 });
    this.quake(0.7, 26, 0.45);
    if (!this.nativeBody) this.bigClaw.visible = false;
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.hideWarnings();
    if (attackDirector.purging) return;
    const ctx = this.ctx, k = this.sizeScale;
    const c = this.getBodyCenter(new THREE.Vector3());
    iceShards(ctx, c, k, 24, 8);
    ctx.fx.burst(c, C.shell, 18, 6, 1.1, 0.16 * k, 18);
    frostVapour(ctx, c, k, 8, FROST.aqua);
    const gy = ctx.world.groundHeight(c.x, c.z, c.y + 1);
    iceCrack(ctx, _t.set(c.x, Number.isFinite(gy) ? gy : this.position.y, c.z), 2.2 * k, 3);
    ctx.audio.play('shield_break', { position: c, volume: 1, pitch: 0.6 });
    this.quake(0.5, 24, 0.4);
  }

  // ───────────── 动画 ─────────────

  protected override pose(dt: number): void {
    const st = this.state;
    let open = 0, snap = 0, raise = 0, sweep = 0, rate = 10;
    if (st === 'grabWindup') { open = smooth(this.stateTime / this.windTime); rate = 16; }
    else if (st === 'grab') { snap = 1; rate = 40; }
    else if (st === 'grabRecover') { snap = Math.max(0, 1 - this.stateTime / GRAB_RECOVER); rate = 12; }
    else if (st === 'sweepWindup') { raise = smooth(this.stateTime / this.windTime); rate = 16; }
    else if (st === 'sweep') { sweep = clamp01(this.stateTime / 0.25); rate = 40; }
    const k = 1 - Math.exp(-rate * dt);
    this.pOpen = mix(this.pOpen, open, k);
    this.pSnap = mix(this.pSnap, snap, k);
    this.pRaise = mix(this.pRaise, raise, k);
    this.pSweep = st === 'sweep' ? sweep : mix(this.pSweep, 0, k);
    this.pBreak = mix(this.pBreak, this.broken ? 1 : 0, 1 - Math.exp(-14 * dt));
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseBlockout();
  }

  /** 白模动画：八足交替抬落、身子随步子晃；张钳、夹下、扬小钳横扫 */
  private poseBlockout(): void {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const amp = Math.min(1, sp / Math.max(1, this.def.speed));
    const ph = this.walkPhase * 1.6;
    this.body.rotation.set(-this.hurtKick * 0.1, 0, Math.sin(ph * 2) * 0.03 * amp);
    for (const l of this.legs) {
      const s = Math.sin(ph + l.phase);
      l.upper.rotation.z = l.side * (0.25 + Math.max(0, s) * 0.3 * amp);
      l.upper.rotation.y = Math.cos(ph + l.phase) * 0.2 * amp;
    }
    this.bigClaw.rotation.set(-0.35 * this.pOpen + 0.25 * this.pSnap, 0.1 * this.pOpen, 0);
    this.bigJaw.rotation.x = -0.6 * this.pOpen;
    this.smallClaw.rotation.y = 0.8 * this.pRaise - 2.2 * this.pSweep;
  }

  /**
   * 美术骨骼动画（蟹形，creature_rigs/SK_Enemy_FrostCrab.json）。模型空间：X = 生物左侧，Y = 上，Z = 前；
   * 绕 +X 负转 = 前端往上抬（张开上颚、抬钳）。
   * - 步态：交替四足支撑，脚尖沿「模型空间里的移动方向」扫（横着走就横着迈），腾空段抬脚；每组脚落地扬雪、轻震屏。
   * - 身体：步子起伏、往移动一侧微倾；受击后仰。
   * - 巨钳：夹击前摇上颚张开、整只钳抬起往外撇；夹下时上颚合拢、钳子往前一送；碎钳后钳骨缩没（只剩钳臂断茬）。
   * - 小钳：横扫前往外扬，横扫时从外侧一路扫到身前另一侧。
   * - 鳃缝发光壳：平时缓缓呼吸，碎钳后更亮。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const move = clamp01(sp / 0.6);
    const sn = clamp01(sp / (this.def.speed * BREAK_SPEED));
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    // 世界速度 → 模型空间（模型 +X = 世界 (cos f, -sin f)，+Z = 世界 (sin f, cos f)），再换成模型局部单位
    const cf = Math.cos(this.facing), sf = Math.sin(this.facing);
    let mx = (this.velocity.x * cf - this.velocity.z * sf) / this.sizeScale;
    let mz = (this.velocity.x * sf + this.velocity.z * cf) / this.sizeScale;
    const ml = Math.hypot(mx, mz);
    const stride = Math.min(GAIT_SWEEP, (ml * GAIT_DUTY) / Math.max(1e-3, freq));
    if (ml > 1e-4) {
      mx = (mx / ml) * stride;
      mz = (mz / ml) * stride;
    } else mx = mz = 0;
    const ph = this.gait * Math.PI * 2;
    // 身体：起伏、往移动一侧微倾、受击后仰
    P.translate('body', 0, -0.025 * move * (1 - Math.cos(ph * 2)) * 0.5 - 0.06 * this.pSnap, 0.05 * this.pSnap);
    P.rotate('body', AZ, -(mx / Math.max(1e-3, GAIT_SWEEP)) * 0.05 + Math.sin(ph * 2) * 0.015 * move);
    P.rotate('body', AX, -this.hurtKick * 0.06 + 0.04 * this.pSnap - 0.03 * this.pOpen);
    // 巨钳：张开（上颚上抬）、抬起往外撇；夹下时往前送；碎了缩没
    P.rotate('arm_R', AY, -0.18 * this.pOpen + 0.1 * this.pSnap);
    P.rotate('arm_R', AX, -0.12 * this.pOpen + 0.08 * this.pSnap);
    P.translate('arm_R', 0, 0, 0.18 * this.pSnap);
    P.rotate('claw_R', AX, -0.15 * this.pOpen + 0.06 * this.pSnap);
    P.rotate('pincer_R', AX, -0.4 * this.pOpen);
    if (this.pBreak > 0.01) P.scale('claw_R', Math.max(0.001, 1 - this.pBreak));
    // 小钳：扬起 → 横扫（绕竖轴从外侧扫到身前另一侧）
    P.rotate('arm_L', AY, 0.65 * this.pRaise - 1.3 * this.pSweep);
    P.rotate('arm_L', AX, -0.25 * this.pRaise + 0.1 * this.pSweep);
    P.rotate('claw_L', AY, 0.25 * this.pRaise - 0.4 * this.pSweep);
    // 八足 IK：触地段脚尖沿移动方向往后扫，腾空段抬脚摆回；夹击时前脚撑地、身子前压
    for (const [li, leg] of LEGS.entries()) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const u = (this.gait + leg.phase) % 1;
      // 每组（两组交替）只取一只脚报落地：扬雪、震屏
      if (move > 0.3 && li < 2 && this.legU[li] > GAIT_DUTY && u < GAIT_DUTY) this.footfall(leg.e);
      this.legU[li] = u;
      let s: number, dy: number;
      if (u < GAIT_DUTY) {
        s = 0.5 - u / GAIT_DUTY;
        dy = 0;
      } else {
        const t = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
        s = -0.5 + t * t * (3 - 2 * t);
        dy = Math.sin(t * Math.PI) * GAIT_LIFT * move;
      }
      _t.set(rest.x + mx * s, rest.y + dy, rest.z + mz * s);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 0.6);
    }
    if (n.glowShell) n.glowShell.opacity = clamp01(this.glowLevel[1]) * 0.9;
  }

  /** 一组脚落地：脚下扬雪，按距离轻震屏 */
  private footfall(bone: string): void {
    const b = this.nativeBody?.pose.bone(bone);
    if (!b) return;
    b.getWorldPosition(_p);
    _p.y = this.position.y + 0.05;
    this.ctx.fx.burst(_p, FROST.snow, 3, 1.2, 0.45, 0.14 * this.sizeScale, 6);
    this.quake(0.04, STEP_SHAKE_RANGE, 0.1);
    if (this.distToPlayerXZ() < STEP_SHAKE_RANGE) this.ctx.audio.play('footstep', { position: _p, volume: 0.4, pitch: 0.7 });
  }
}

/** 正面钳墙：全局伤害修正，只对巨蟹生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof FrostCrab ? enemy.guardFactor(req) : 1));
}
