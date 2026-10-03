/**
 * 熔心魔将（第三章 Boss，最终 Boss）。
 *
 * 招式：
 *  - 烈焰冲锋：直线预警 → 高速冲锋（撞上掩体会硬直），沿途留下持续燃烧的火焰地带；二阶段起连冲两次。
 *  - 扇形火焰横扫：扇形预警 → 挥刃放出贴地火焰弧（跳过 / 离开扇区）；二阶段起反手再扫一次并射出扇形火弹。
 *  - 陨石雨：举剑引天火，大量带地面预警的陨石坠落（部分预判玩家走位）；二阶段起落点留下火焰。
 *  - 跃击：蹲伏 → 跃向玩家（落点预警）→ 砸地重击 + 扩散冲击波；二阶段起落点燃起火焰。
 *    落点总在竞技场地面上：玩家站在高台 / 掩体上时落到最近的地面空位（其余招式的预警、火浪、火弹都以地面为基准）。
 *  - 焰刃连斩：贴身时 3（三阶段 4）连斩，每斩带短扇形预警与前摇。
 *  - 熔岩涌动（二阶段起）：外圈大范围熔岩（预警 2.2 秒后持续 10 秒，站上掩体 / 靠近中心可躲）。
 * 阶段：50% 引动熔岩（立即熔岩涌动）；20% 狂怒——陨石更频繁、战斗中持续落下零星陨石、连斩更多。
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { angleDiff, clamp, damp, rotateTowards, TAU } from '../../core/math';
import { BossBase, type BossMove } from './BossBase';
import type { ZoneHandle } from './Hazards';
import { buildWarlord, EMBER, EMBER_FURY, EMBER_RAGE, type WarlordRig } from './WarlordModel';
import { easeInQuad, span } from './parts';

export const WARLORD_DEF: EnemyDef = {
  id: 'boss_warlord',
  name: '熔心魔将',
  hp: 4000,
  shield: 1000,
  // 1500 → 1100：魔将物理有效生命比妖后高约 70%，而玩家倍率只高约 30%，冲锋枪 / 霰弹 / 机炮的魔将战超出 120 秒目标
  armor: 1100,
  speed: 4.6,
  radius: 1.3,
  height: 3.6,
  damage: 24,
  coins: [60, 100],
  essence: 60,
  isBoss: true,
  headY: 3.28,
  headRadius: 0.45,
  knockbackResist: 1,
  color: 0xff5a1f,
};

/** 与 EnemyBase 的重力一致（跃击弹道计算用） */
const GRAVITY = 26;
const WARN = 0xff4a1a;
const FIRE = 0xff6a1f;
const EMBERS = 0xffa040;
const LAVA = 0xff4a10;
/** 横扫扇形半角、火浪最大半径（预警半径 = 火浪最大半径 + 环带半宽 + 玩家半径） */
const SWEEP_HALF = 1.13;
const SWEEP_RADIUS = 13;
const SWEEP_WIDTH = 1.3;
const SWEEP_WARN_RADIUS = 14;
/** 冲锋：预警长条半宽 = 命中判定（玩家中心到魔将中心的水平距离） */
const CHARGE_HALF_WIDTH = 1.7;
/** 连斩：每斩前摇、间隔、扇形半径与半角（判定与预警一致） */
const COMBO_WINDUP = 0.5;
const COMBO_PER = 0.72;
const COMBO_RANGE = 4.8;
const COMBO_HALF = 0.9;
/** 跃击落点与预警圈中心偏差超过此值（被掩体挡住半路落地）时不结算落点重击，只放冲击波 */
const LEAP_MISS = 2.5;
/** 跃击落点 / 魔将脚下地面高出竞技场地面超过此值，视为站在高台 / 掩体上 */
const LEAP_HIGH = 0.5;
/** 弹道被掩体挡住时依次尝试的滞空时间倍率（越长弧顶越高） */
const LEAP_ARCS = [1, 1.25, 1.5];

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c0 = new THREE.Color(EMBER);
const _c1 = new THREE.Color(EMBER_RAGE);
const _c2 = new THREE.Color(EMBER_FURY);
const _col = new THREE.Color();

const P = {
  bodyY: 0, torsoX: 0, torsoY: 0, headX: 0, headY: 0,
  legL: 0, legR: 0, knL: 0, knR: 0,
  sX: 0, sZ: 0, sElb: 0, swX: 0, oX: 0, oZ: 0, oElb: 0, capeX: 0, lam: 8,
};

function resetPose(): void {
  P.bodyY = 0; P.torsoX = 0.05; P.torsoY = 0; P.headX = 0; P.headY = 0;
  P.legL = 0; P.legR = 0; P.knL = 0; P.knR = 0;
  P.sX = -0.35; P.sZ = -0.12; P.sElb = -0.5; P.swX = -1.0;
  P.oX = -0.1; P.oZ = 0.18; P.oElb = -0.4; P.capeX = 0.08; P.lam = 8;
}

type ChargeStage = 'aim' | 'run' | 'recover' | 'crash';
type LeapStage = 'crouch' | 'air' | 'land';

export class Warlord extends BossBase {
  private rig!: WarlordRig;
  private walkPhase = 0;
  private lastStep = 0;
  private fury = 0;
  private bladeGlow = 0;
  private flameAcc = 0;
  private bgMeteorAcc = 0;
  private entranceImpact = false;
  private entranceRoared = false;
  private transFxAcc = 0;
  private meteorMove: BossMove | null = null;

  // 冲锋
  private chargeStage: ChargeStage = 'aim';
  private stageT = 0;
  private chargesLeft = 1;
  private chargeTele = 0.9;
  private chargeYaw = 0;
  private chargeDX = 0;
  private chargeDZ = 1;
  private chargeLen = 20;
  private chargeTravel = 0;
  private chargeHit = false;
  private trailDist = 0;
  private trailFx = 0;

  // 横扫
  private sweepTele = 0.85;
  private sweepYaw = 0;
  private sweepYaw2 = 0;
  private sweeps = 1;

  // 陨石
  private meteorCount = 10;
  private meteorDur = 3.2;

  // 跃击
  private leapStage: LeapStage = 'crouch';
  private leapCrouch = 0.48;
  private leapAir = 1;
  private leapVX = 0;
  private leapVZ = 0;
  private readonly leapTarget = new THREE.Vector3();
  /** 跃击落点预警的取消函数（提前落地 / 被掩体挡下时撤回） */
  private leapWarn: (() => void) | null = null;

  // 连斩
  private comboCount = 3;
  private comboYaw = 0;

  // 熔岩
  private lava: ZoneHandle | null = null;
  private lavaAnnounced = false;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, WARLORD_DEF, opts);
    this.thresholds = [0.5, 0.2];
    this.spawnDuration = 2.4;
    this.deathDuration = 3.2;
    this.transitionDuration = 2.2;
    this.accel = 30;
    this.registerMoves();
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    const { root, rig } = buildWarlord();
    this.rig = rig;
    this.weakAnchor = rig.weak;
    this.muzzleAnchor = rig.bladeTip;
    this.hitShapes = [
      { anchor: rig.weak, radius: 0.45, halfHeight: 0, weak: true },
      { anchor: rig.chest, radius: 0.6, halfHeight: 0.15, weak: false },
      { anchor: rig.hips, radius: 0.58, halfHeight: 0, weak: false },
      { anchor: rig.kneeL, radius: 0.3, halfHeight: 0.42, weak: false },
      { anchor: rig.kneeR, radius: 0.3, halfHeight: 0.42, weak: false },
      { anchor: rig.pauldronL, radius: 0.46, halfHeight: 0, weak: false },
      { anchor: rig.pauldronR, radius: 0.46, halfHeight: 0, weak: false },
    ];
    return root;
  }

  // ───────────── 招式 ─────────────

  private registerMoves(): void {
    // 烈焰冲锋
    this.addMove({
      id: 'charge', cooldown: 7, recovery: 1.1,
      weight: () => (this.elevated() ? 0 : this.distToPlayerXZ() > 7 ? 3 : 1),
      start: () => {
        this.chargesLeft = this.phase >= 1 ? 2 : 1;
        this.chargeTele = this.phase >= 1 ? 0.75 : 0.9;
        this.beginChargeAim();
      },
      tick: (_t, dt) => this.tickCharge(dt),
      end: () => {
        this.accel = 30;
      },
    }, 1.5);

    // 扇形火焰横扫
    this.addMove({
      id: 'sweep', cooldown: 5, recovery: 1.1,
      weight: () => (this.elevated() ? 0 : this.distToPlayerXZ() < 14 ? 3 : 1.2),
      start: () => {
        this.setAnim('sweepReady', true);
        this.sweepTele = this.phase >= 1 ? 0.7 : 0.85;
        this.sweepYaw = this.yawToPlayer();
        this.sweeps = this.phase >= 1 ? 2 : 1;
        this.hazards.sectorWarning(this.position.x, this.floorY(), this.position.z, this.sweepYaw, SWEEP_HALF, SWEEP_WARN_RADIUS, this.sweepTele, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t, dt) => {
        const tele = this.sweepTele;
        if (t < tele) {
          this.facing = rotateTowards(this.facing, this.sweepYaw, 8 * dt);
          this.bladeGlow = t / tele;
        }
        if (this.at(tele)) this.sweepStrike(this.sweepYaw, false);
        if (this.sweeps > 1) {
          if (this.at(tele + 0.2)) {
            this.setAnim('sweepReady2', true);
            this.sweepYaw2 = this.yawToPlayer();
            this.hazards.sectorWarning(this.position.x, this.floorY(), this.position.z, this.sweepYaw2, SWEEP_HALF, SWEEP_WARN_RADIUS, 0.55, WARN);
            this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.2 });
          }
          if (t > tele + 0.2 && t < tele + 0.75) this.facing = rotateTowards(this.facing, this.sweepYaw2, 8 * dt);
          if (this.at(tele + 0.75)) this.sweepStrike(this.sweepYaw2, true);
        }
        return t >= tele + (this.sweeps > 1 ? 1.35 : 0.8);
      },
      end: () => {
        this.bladeGlow = 0;
      },
    }, 0.5);

    // 陨石雨
    this.meteorMove = {
      id: 'meteor', cooldown: 11, recovery: 1.0,
      weight: () => 2.2 + (this.phase >= 2 ? 1.5 : 0),
      start: () => {
        this.setAnim('raise', true);
        this.meteorCount = this.phase >= 2 ? 20 : this.phase >= 1 ? 14 : 10;
        this.meteorDur = this.phase >= 2 ? 3.6 : this.phase >= 1 ? 3.4 : 3.2;
        this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.2, volume: 0.6 });
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t, dt) => {
        const s0 = 0.8;
        if (t < s0) {
          this.bladeGlow = t / s0;
          this.flameAcc += dt;
          if (this.flameAcc >= 0.06) {
            this.flameAcc = 0;
            this.rig.bladeTip.getWorldPosition(_v);
            this.ctx.fx.burst(_v, EMBERS, 4, 5, 0.6, 0.3, -12);
          }
        }
        for (let i = 0; i < this.meteorCount; i++) if (this.at(s0 + (i * this.meteorDur) / this.meteorCount)) this.dropMeteor(i % 3 === 0, 3, 15);
        return t >= s0 + this.meteorDur + 0.3;
      },
      end: () => {
        this.bladeGlow = 0;
      },
    };
    this.addMove(this.meteorMove, 5);

    // 跃击（站在高台上时优先用它跳回地面）
    this.addMove({
      id: 'leap', cooldown: 8, recovery: 1.1,
      weight: () => (this.elevated() ? 10 : this.distToPlayerXZ() > 8 ? 2.6 : 1.2),
      start: () => {
        this.setAnim('crouch', true);
        this.leapStage = 'crouch';
        this.stageT = 0;
        this.leapCrouch = this.phase >= 1 ? 0.38 : 0.48;
        this.leapAir = this.planLeap(this.leapTarget, this.phase >= 1 ? 0.85 : 1.0);
        this.leapWarn = this.hazards.groundWarning(this.leapTarget.x, this.leapTarget.y, this.leapTarget.z, 5, this.leapCrouch + this.leapAir, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (_t, dt) => this.tickLeap(dt),
      end: () => {
        this.accel = 30;
        this.leapWarn = null;
      },
    }, 3);

    // 焰刃连斩（贴身）
    this.addMove({
      id: 'combo', cooldown: 3.5, recovery: 0.9,
      weight: () => (!this.elevated() && this.distToPlayerXZ() < 5.5 ? 6 : 0),
      start: () => {
        this.comboCount = this.phase >= 2 ? 4 : 3;
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.1 });
      },
      tick: (t, dt) => {
        const per = COMBO_PER;
        for (let i = 0; i < this.comboCount; i++) {
          const b = i * per;
          if (this.at(b)) {
            this.setAnim(i % 2 === 0 ? 'slashA' : 'slashB', true);
            this.bladeGlow = 1;
            this.comboYaw = this.yawToPlayer();
            this.hazards.sectorWarning(this.position.x, this.floorY(), this.position.z, this.comboYaw, COMBO_HALF, COMBO_RANGE, COMBO_WINDUP, WARN);
          }
          if (this.at(b + COMBO_WINDUP)) this.comboStrike();
        }
        const local = t % per;
        if (local < COMBO_WINDUP) this.facing = rotateTowards(this.facing, this.comboYaw, 10 * dt);
        // 出刀后小幅前冲（在下一斩的预警画出之前完成，预警位置 = 判定位置）
        if (local >= COMBO_WINDUP && local < COMBO_WINDUP + 0.14 && t < this.comboCount * per) this.setMove(Math.sin(this.facing), Math.cos(this.facing), 5);
        else this.stopMoving();
        return t >= this.comboCount * per + 0.25;
      },
      end: () => {
        this.bladeGlow = 0;
      },
    });

    // 熔岩涌动（二阶段起）
    this.addMove({
      id: 'lava', cooldown: 22, recovery: 0.6,
      weight: () => (this.phase >= 1 && !this.lavaActive() ? 2.5 : 0),
      start: () => {
        this.setAnim('plant', true);
        this.ctx.audio.play('boss_roar', { position: this.position, volume: 0.8 });
        const c = this.arenaCenter(_v);
        // 预警 3 秒：从竞技场角落（距中心约 40 米）跑回 15 米内圈约需 3.4 秒，配合冲刺或就近站上掩体即可躲开
        this.lava = this.hazards.zone({
          x: c.x, y: this.floorY(), z: c.z,
          radius: 60, innerRadius: 15,
          arm: 3.0, duration: 10, damage: 5, interval: 0.5,
          color: LAVA, embers: EMBERS, element: 'fire', maxHeight: 0.8,
        });
        if (!this.lavaAnnounced) {
          this.lavaAnnounced = true;
          this.ctx.ui.toast('熔岩正在涌向外圈——靠近中心或站上高处！', '#ff6a2a');
        }
      },
      tick: (t) => {
        if (this.at(0.45)) {
          this.ctx.fx.shake(0.4, 1.6);
          this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 15, LAVA, 1.0);
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 0.7 });
        }
        return t >= 1.3;
      },
    });
  }

  // ── 冲锋 ──

  private beginChargeAim(): void {
    this.chargeStage = 'aim';
    this.stageT = 0;
    this.setAnim('chargeReady', true);
    const pl = this.ctx.player;
    let dx = pl.position.x + pl.velocity.x * 0.3 - this.position.x;
    let dz = pl.position.z + pl.velocity.z * 0.3 - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      dx = Math.sin(this.facing);
      dz = Math.cos(this.facing);
    } else {
      dx /= d;
      dz /= d;
    }
    this.chargeDX = dx;
    this.chargeDZ = dz;
    this.chargeYaw = Math.atan2(dx, dz);
    const edge = this.distToArenaEdge(this.position.x, this.position.z, dx, dz, 1.5);
    this.chargeLen = clamp(Math.min(d + 6, 26), Math.min(8, edge), Math.max(2, edge));
    this.hazards.lineWarning(this.position.x, this.floorY(), this.position.z, this.chargeYaw, this.chargeLen, CHARGE_HALF_WIDTH, this.chargeTele, WARN);
    this.ctx.audio.play('telegraph', { position: this.position });
    this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.7 });
  }

  private tickCharge(dt: number): boolean {
    this.stageT += dt;
    if (this.chargeStage === 'aim') {
      this.stopMoving();
      this.facing = rotateTowards(this.facing, this.chargeYaw, 6 * dt);
      this.bladeGlow = this.stageT / this.chargeTele;
      if (this.stageT >= this.chargeTele) {
        this.chargeStage = 'run';
        this.stageT = 0;
        this.chargeTravel = 0;
        this.chargeHit = false;
        this.trailDist = 1.5;
        this.accel = 160;
        this.setAnim('charge', true);
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.55, volume: 1 });
        this.ctx.fx.shake(0.2, 0.25);
      }
      return false;
    }
    if (this.chargeStage === 'run') {
      this.setMove(this.chargeDX, this.chargeDZ, 20);
      this.facing = this.chargeYaw;
      const step = Math.hypot(this.velocity.x, this.velocity.z) * dt;
      this.chargeTravel += step;
      this.trailDist += step;
      const floor = this.floorY();
      if (this.trailDist >= 2.4) {
        this.trailDist = 0;
        this.hazards.zone({ x: this.position.x, y: floor, z: this.position.z, radius: 1.6, duration: 6, arm: 0.25, damage: 5, color: FIRE, embers: EMBERS });
      }
      const pl = this.ctx.player;
      if (!this.chargeHit && pl.alive) {
        const dxp = pl.position.x - this.position.x;
        const dzp = pl.position.z - this.position.z;
        // 判定半径与预警长条半宽一致：玩家中心站在预警外就不会被撞到
        if (Math.hypot(dxp, dzp) < CHARGE_HALF_WIDTH && pl.position.y - this.position.y < 2.8) {
          this.chargeHit = true;
          this.hazards.hurt(28, 'fire', this.position);
          const side = dxp * this.chargeDZ - dzp * this.chargeDX >= 0 ? 1 : -1;
          pl.applyImpulse(_d.set(this.chargeDX * 13 + this.chargeDZ * 5 * side, 6, this.chargeDZ * 13 - this.chargeDX * 5 * side));
          this.ctx.fx.shake(0.55, 0.35);
          this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.6 });
        }
      }
      this.trailFx += dt;
      if (this.trailFx >= 0.04) {
        this.trailFx = 0;
        _v.set(this.position.x, floor + 0.3, this.position.z);
        this.ctx.fx.burst(_v, EMBERS, 4, 3, 0.5, 0.35, -4);
      }
      const crashed = this.moveResult.hitWall && this.stageT > 0.12;
      if (this.chargeTravel >= this.chargeLen || crashed || this.stageT > 2.2) {
        this.accel = 30;
        this.stageT = 0;
        this.stopMoving();
        if (crashed) {
          this.chargeStage = 'crash';
          this.setAnim('crash', true);
          _v.set(this.position.x + this.chargeDX * 1.2, this.position.y + 1.5, this.position.z + this.chargeDZ * 1.2);
          this.ctx.fx.explosion(_v.clone(), 2, FIRE);
          this.ctx.fx.shake(0.55, 0.4);
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 1.1 });
        } else {
          this.chargeStage = 'recover';
          this.setAnim('idle');
        }
      }
      return false;
    }
    this.stopMoving();
    this.facePlayer(3, dt);
    this.bladeGlow = 0;
    if (this.stageT >= (this.chargeStage === 'crash' ? 1.0 : 0.45)) {
      this.chargesLeft--;
      if (this.chargesLeft > 0) {
        this.chargeTele = 0.65;
        this.beginChargeAim();
        return false;
      }
      return true;
    }
    return false;
  }

  // ── 横扫 ──

  private sweepStrike(yaw: number, withBolts: boolean): void {
    this.setAnim(withBolts ? 'sweepBack' : 'sweep', true);
    this.bladeGlow = 1;
    const floor = this.floorY();
    const x = this.position.x;
    const z = this.position.z;
    // 火浪高 1.0 米：玩家脚底离地 1 米以上即可跳过（跳跃顶点约 1.42 米，可用窗口约 0.36 秒）
    this.hazards.wave({
      x, y: floor, z, speed: 16, maxRadius: SWEEP_RADIUS, startRadius: 1,
      arcCenter: yaw, arcHalf: SWEEP_HALF, width: SWEEP_WIDTH, height: 1.0,
      damage: 24, color: FIRE, element: 'fire', knockback: 6, dust: EMBERS,
    });
    for (let i = -2; i <= 2; i++) {
      const a = yaw + i * 0.45;
      _v.set(x + Math.sin(a) * 2.8, floor + 1, z + Math.cos(a) * 2.8);
      this.ctx.fx.burst(_v, FIRE, 5, 5, 0.45, 0.35, -2);
    }
    if (withBolts) {
      // 贴地火弹（膝盖高度）与火浪同速同向：同一次起跳即可一并躲过，射程更远，逼扇区外的玩家也起跳
      for (let k = -3; k <= 3; k++) {
        const a = yaw + k * 0.16;
        _d.set(Math.sin(a), 0, Math.cos(a));
        _v.set(x + _d.x * 1.5, floor + 0.55, z + _d.z * 1.5);
        this.fireProjectile(_v, _d, 16, 10, { color: FIRE, visual: 'flame', radius: 0.3, lifetime: 2.2, element: 'fire', scale: 1.3 });
      }
    }
    this.ctx.fx.shake(0.35, 0.3);
    this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.6 });
    this.ctx.audio.play('skill_fire', { position: this.position, pitch: 0.8, volume: 0.8 });
  }

  // ── 陨石 ──

  private dropMeteor(predict: boolean, minR: number, maxR: number): void {
    const pl = this.ctx.player;
    const rng = this.ctx.rng;
    if (predict) {
      _v.set(pl.position.x + pl.velocity.x * 1.1, 0, pl.position.z + pl.velocity.z * 1.1);
    } else {
      const a = rng.range(0, TAU);
      const r = rng.range(minR, maxR);
      _v.set(pl.position.x + Math.sin(a) * r, 0, pl.position.z + Math.cos(a) * r);
    }
    this.clampToArena(_v, 2);
    const floor = this.floorY();
    const gy = this.ctx.world.groundHeight(_v.x, _v.z, floor + 30);
    _v.y = Number.isFinite(gy) ? gy : floor;
    _a.set(_v.x + rng.range(-7, 7), _v.y + 30, _v.z + rng.range(-7, 7));
    const leaveFire = this.phase >= 1;
    this.hazards.lob({
      from: _a, to: _v, time: 1.25, arc: 0,
      radius: 3, damage: 22, color: FIRE, kind: 'meteor', element: 'fire',
      onLand: leaveFire
        ? (p) => {
            this.hazards.zone({ x: p.x, y: p.y, z: p.z, radius: 2.2, duration: 3.5, arm: 0.1, damage: 4, color: FIRE, embers: EMBERS });
          }
        : undefined,
    });
  }

  // ── 跃击 ──

  /**
   * 魔将在高处（站在高台 / 掩体顶上，或正从上面落下）。冲锋 / 横扫 / 连斩的预警、火浪、火弹都以竞技场地面为基准，
   * 在高处时不出这几招，优先用跃击跳回地面（或走下高台后再出）。
   */
  private elevated(): boolean {
    return this.position.y > this.floorY() + LEAP_HIGH;
  }

  /** 魔将的身体能否稳稳落在 (x,z) 的竞技场地面上：脚底以上 LEAP_HIGH 米到头顶之间不与任何静态几何重叠 */
  private landingClear(x: number, z: number): boolean {
    const floor = this.floorY();
    const halfW = this.radius * 0.85 + 0.15;
    return this.ctx.world.overlapsBody(x, floor + LEAP_HIGH, z, halfW, this.height - LEAP_HIGH) === null;
  }

  /** 落点 (x,z) 处的地面高度：只认不高于 LEAP_HIGH 的地面（低矮台阶 / 坡道），否则就是竞技场地面 */
  private leapGroundY(x: number, z: number): number {
    const floor = this.floorY();
    const gy = this.ctx.world.groundHeight(x, z, floor + LEAP_HIGH, 0.8);
    return Number.isFinite(gy) && gy >= floor ? gy : floor;
  }

  /**
   * 规划跃击：写入落点并返回滞空时间。保证魔将始终落在竞技场地面上出招
   * （其余招式的预警、火浪、火弹都以地面为基准）。
   *  1. 预判玩家 0.35 秒后的位置。落点地面高于竞技场地面 LEAP_HIGH 以上（玩家站在高台 / 掩体上），
   *     或魔将的身体在那里放不下时，改用导航网格最近的可走地面格（ctx.nav.nearestWalkable）。
   *  2. 该点放得下、且某条弧线（滞空 base × LEAP_ARCS）全程不撞静态几何时直接采用。
   *  3. 否则在周围 1.2–4.8 米的环上，由近到远找离玩家最近、放得下且弹道畅通的点
   *     （可走格按普通单位大小划分，魔将体型更大；弹道擦过高台 / 掩体会被挡下或落到台顶上）。
   *  4. 仍找不到时只要求放得下、用 base 滞空（万一落到高处，elevated() 会让下一招跳回地面）。
   */
  private planLeap(out: THREE.Vector3, base: number): number {
    const pl = this.ctx.player;
    const floor = this.floorY();
    const px = pl.position.x + pl.velocity.x * 0.35;
    const pz = pl.position.z + pl.velocity.z * 0.35;
    out.set(px, floor, pz);
    this.clampToArena(out, 3);
    if (!this.landingClear(out.x, out.z) && this.ctx.nav.nearestWalkable(out, _a)) {
      out.x = _a.x;
      out.z = _a.z;
      this.clampToArena(out, 3);
    }
    const cx = out.x;
    const cz = out.z;
    let T = this.leapAirTo(cx, cz, base);
    if (T > 0) {
      out.y = this.leapGroundY(cx, cz);
      return T;
    }
    for (let pass = 0; pass < 2; pass++) {
      const needPath = pass === 0;
      if (!needPath && this.landingClear(cx, cz)) break;
      let best = Infinity;
      for (let ring = 1; ring <= 4 && best === Infinity; ring++) {
        const r = ring * 1.2;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          _b.set(cx + Math.sin(a) * r, floor, cz + Math.cos(a) * r);
          this.clampToArena(_b, 3);
          const d = (_b.x - px) * (_b.x - px) + (_b.z - pz) * (_b.z - pz);
          if (d >= best) continue;
          const t = needPath ? this.leapAirTo(_b.x, _b.z, base) : this.landingClear(_b.x, _b.z) ? base : -1;
          if (t < 0) continue;
          best = d;
          T = t;
          out.x = _b.x;
          out.z = _b.z;
        }
      }
      if (best < Infinity) break;
    }
    out.y = this.leapGroundY(out.x, out.z);
    return T > 0 ? T : base;
  }

  /** 落点 (x,z) 放得下魔将时，返回第一条全程不撞静态几何的弧线的滞空时间（base × LEAP_ARCS）；否则 -1 */
  private leapAirTo(x: number, z: number, base: number): number {
    if (!this.landingClear(x, z)) return -1;
    const y = this.leapGroundY(x, z);
    for (const k of LEAP_ARCS) {
      const T = base * k;
      if (this.leapPathClear(x, y, z, T)) return T;
    }
    return -1;
  }

  /**
   * 以滞空时间 T 从当前位置跃向 (tx,ty,tz) 的弹道（与 tickLeap 的初速度一致）上，身体是否始终不与静态几何重叠。
   * 按弹道长度（水平距离 + 升降高度）约每 0.25 米取一个样本：下落段竖直速度可达 20 米/秒，
   * 只按水平距离采样会漏掉擦过高台边角的情况。
   * 留余量：逐帧积分的重力让实际弹道比解析解低 g·t·dt/2（帧时长上限 0.05 秒时为 0.65·t 米），
   * 脚底按此下探、身体加宽 0.15 米；下探不低于起落点地面，免得把地面本身算成障碍。
   */
  private leapPathClear(tx: number, ty: number, tz: number, T: number): boolean {
    const x0 = this.position.x;
    const y0 = this.position.y;
    const z0 = this.position.z;
    const vy = (GRAVITY * T) / 2 + (ty - y0) / T;
    const halfW = this.radius * 0.85 + 0.15;
    const minFoot = Math.min(y0, ty) + 0.05;
    const len = Math.hypot(tx - x0, tz - z0) + (GRAVITY * T * T) / 4 + Math.abs(ty - y0);
    const steps = clamp(Math.ceil(len / 0.25), 16, 160);
    const w = this.ctx.world;
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      const t = u * T;
      const y = y0 + vy * t - 0.5 * GRAVITY * t * t;
      const foot = Math.max(minFoot, y - 0.65 * t);
      if (w.overlapsBody(x0 + (tx - x0) * u, foot, z0 + (tz - z0) * u, halfW, this.height + (y - foot)) !== null) return false;
    }
    return true;
  }

  private tickLeap(dt: number): boolean {
    this.stageT += dt;
    const tgt = this.leapTarget;
    if (this.leapStage === 'crouch') {
      this.stopMoving();
      this.faceTowards(tgt, 8, dt);
      if (this.stageT >= this.leapCrouch) {
        const T = this.leapAir;
        this.leapVX = (tgt.x - this.position.x) / T;
        this.leapVZ = (tgt.z - this.position.z) / T;
        this.velocity.set(this.leapVX, (GRAVITY * T) / 2 + (tgt.y - this.position.y) / T, this.leapVZ);
        this.desiredX = this.leapVX;
        this.desiredZ = this.leapVZ;
        this.accel = 400;
        this.leapStage = 'air';
        this.stageT = 0;
        this.setAnim('leap', true);
        _v.set(this.position.x, this.position.y + 0.2, this.position.z);
        this.ctx.fx.burst(_v, EMBERS, 16, 6, 0.6, 0.4, 6);
        this.ctx.audio.play('jump', { position: this.position, pitch: 0.5, volume: 1 });
      }
      return false;
    }
    if (this.leapStage === 'air') {
      this.desiredX = this.leapVX;
      this.desiredZ = this.leapVZ;
      this.faceTowards(tgt, 8, dt);
      if ((this.stageT > 0.15 && this.onGround) || this.stageT > this.leapAir + 0.8) this.leapLand();
      return false;
    }
    this.stopMoving();
    return this.stageT >= 0.7;
  }

  private leapLand(): void {
    // 比预定滞空时间明显更早落地 = 中途被掩体挡下（逐帧积分本身只会早一两帧）
    const early = this.leapStage === 'air' && this.stageT < this.leapAir - 0.12;
    this.leapStage = 'land';
    this.stageT = 0;
    this.accel = 30;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.stopMoving();
    this.setAnim('land', true);
    const x = this.position.x;
    const y = this.position.y;
    const z = this.position.z;
    const tgt = this.leapTarget;
    // 只有落在预警圈附近才结算落点重击（被掩体挡住半路落地时，没有预警的位置不该突然爆炸）
    const onMark = Math.hypot(x - tgt.x, z - tgt.z) <= LEAP_MISS;
    // 落点重击不会在预警圈兑现（落偏）或明显早于预警填满：撤回还没填满的落点预警
    if (!onMark || early) this.leapWarn?.();
    this.leapWarn = null;
    const crushed = onMark && this.hazards.blast(x, y, z, 5, 30, { maxHeight: 1.8, knockback: 12, knockUp: 6, element: 'fire' });
    // 被重击挑飞的玩家落地前跳不起来，紧随其后的冲击波不再追加伤害。
    // 冲击波始终贴着竞技场地面扩散（落在掩体顶上时也一样），地面上的玩家才能看清并跳过
    this.hazards.wave({ x, y: this.floorY(), z, speed: 14, maxRadius: 20, startRadius: 5, damage: 16, color: FIRE, element: 'fire', dust: EMBERS, width: 0.9, height: 0.85, spare: crushed });
    _v.set(x, y + 0.5, z);
    this.ctx.fx.explosion(_v, 4.5, FIRE);
    this.ctx.fx.shake(0.9, 0.55);
    this.ctx.audio.play('boss_slam', { position: this.position, volume: 1 });
    this.ctx.audio.play('explosion', { position: this.position, pitch: 0.7 });
    if (this.phase >= 1) this.hazards.zone({ x, y, z, radius: 4, duration: 5, arm: 0.3, damage: 5, color: FIRE, embers: EMBERS });
    // 兜底：弹道被意外挡下而落在了高台上——下一招直接跃回地面（落点总在竞技场地面上）
    if (this.onGround && this.elevated()) this.queueMove('leap');
  }

  // ── 连斩 ──

  /** 连斩判定：与扇形预警同一个扇区（半径 COMBO_RANGE、半角 COMBO_HALF，按玩家半径放宽） */
  private comboStrike(): void {
    const pl = this.ctx.player;
    let hit = false;
    if (pl.alive) {
      const dx = pl.position.x - this.position.x;
      const dz = pl.position.z - this.position.z;
      const d = Math.hypot(dx, dz);
      const dy = pl.position.y - this.position.y;
      if (d <= COMBO_RANGE + pl.radius * 0.5 && dy < this.height && dy > -1.5) {
        const off = d > 0.05 ? Math.abs(angleDiff(this.comboYaw, Math.atan2(dx, dz))) : 0;
        if (off <= COMBO_HALF + Math.atan2(pl.radius, Math.max(0.5, d))) hit = this.hazards.hurt(18, 'fire', this.position) > 0;
      }
    }
    if (hit) {
      _d.set(Math.sin(this.comboYaw) * 7, 3, Math.cos(this.comboYaw) * 7);
      pl.applyImpulse(_d);
      this.ctx.fx.shake(0.3, 0.2);
      this.ctx.audio.play('enemy_melee', { position: this.position });
    } else {
      this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.75, volume: 0.8 });
    }
    const floor = this.floorY();
    for (let i = -1; i <= 1; i++) {
      const a = this.facing + i * 0.55;
      _v.set(this.position.x + Math.sin(a) * 2.8, floor + 1.1, this.position.z + Math.cos(a) * 2.8);
      this.ctx.fx.burst(_v, FIRE, 6, 5, 0.4, 0.35, -2);
    }
  }

  private lavaActive(): boolean {
    return this.lava !== null && !this.lava.ended;
  }

  // ───────────── 阶段 ─────────────

  protected override onPhase(phase: number): void {
    if (phase === 1) {
      this.ctx.ui.toast('熔心魔将引动了熔岩！', '#ff6a2a');
      this.queueMove('lava');
    } else {
      this.ctx.ui.toast('熔心魔将陷入狂怒——陨石将更加频繁！', '#ff4020');
      if (this.meteorMove) this.meteorMove.cooldown = 7;
      this.queueMove('meteor');
    }
    this.getBodyCenter(_v);
    this.ctx.fx.burst(_v, FIRE, 40, 10, 1.0, 0.45, -2);
    this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 12, FIRE, 0.9);
  }

  protected override transitionTick(t: number, dt: number): void {
    this.facePlayer(1.5, dt);
    this.transFxAcc += dt;
    if (t > 0.15 && t < 1.8 && this.transFxAcc >= 0.18) {
      this.transFxAcc = 0;
      this.ctx.fx.shake(0.2, 0.2);
      const a = Math.random() * TAU;
      _v.set(this.position.x + Math.sin(a) * 1.5, this.position.y + 0.5 + Math.random() * 2.5, this.position.z + Math.cos(a) * 1.5);
      this.ctx.fx.burst(_v, FIRE, 6, 5, 0.6, 0.35, -6);
    }
  }

  protected override restFactor(): number {
    return this.phase >= 2 ? 0.6 : this.phase >= 1 ? 0.8 : 1;
  }

  // ───────────── 常规行为 ─────────────

  protected override idle(dt: number): void {
    this.facePlayer(3.5, dt);
    const d = this.distToPlayerXZ();
    const speed = this.def.speed * (this.phase >= 2 ? 1.25 : this.phase >= 1 ? 1.1 : 1);
    if (d > 7) this.moveTo(this.ctx.player.position, speed, 5);
    else this.stopMoving();
  }

  protected override passive(dt: number): void {
    // 狂怒：零星陨石
    if (this.phase >= 2 && this.transitionLeft <= 0) {
      this.bgMeteorAcc += dt;
      if (this.bgMeteorAcc >= 2.4) {
        this.bgMeteorAcc = 0;
        this.dropMeteor(false, 1.5, 6);
      }
    }
    const target = this.phase;
    if (Math.abs(this.fury - target) > 0.002) {
      this.fury = damp(this.fury, target, 1.5, dt);
      if (this.fury <= 1) _col.copy(_c0).lerp(_c1, this.fury);
      else _col.copy(_c1).lerp(_c2, this.fury - 1);
      this.setRoleColor('ember', _col);
      this.setRoleColor('blade', _col);
      this.setRoleColor('eye', _col);
      this.setRoleColor('coreHalo', _col);
      this.setRoleColor('flame', _col);
    }
    // 焰刃火星
    this.flameAcc += dt;
    const every = 0.12 - this.bladeGlow * 0.07;
    if (this.flameAcc >= every) {
      this.flameAcc = 0;
      this.rig.bladeBase.getWorldPosition(_a);
      this.rig.bladeTip.getWorldPosition(_b);
      _v.lerpVectors(_a, _b, Math.random());
      this.ctx.fx.burst(_v, EMBERS, 2 + Math.round(this.bladeGlow * 2), 1.2, 0.5, 0.2, -5);
    }
  }

  // ───────────── 登场 / 动画 ─────────────

  protected override entrance(t: number, dt: number): void {
    const rig = this.rig;
    const fall = span(t, 0, 0.4);
    rig.body.position.y = 34 * (1 - easeInQuad(fall));
    if (t >= 1) {
      rig.body.position.y = 0;
      return;
    }
    const fx = this.ctx.fx;
    const floor = this.floorY();
    if (fall < 1) {
      this.setAnim('leap');
      this.flameAcc += dt;
      if (this.flameAcc >= 0.03) {
        this.flameAcc = 0;
        _v.set(this.position.x, this.position.y + rig.body.position.y + 1.5, this.position.z);
        fx.burst(_v, FIRE, 6, 3, 0.5, 0.5, -2);
      }
    } else if (!this.entranceImpact) {
      this.entranceImpact = true;
      this.setAnim('land', true);
      fx.explosion(new THREE.Vector3(this.position.x, floor + 0.5, this.position.z), 6, FIRE);
      fx.ring(new THREE.Vector3(this.position.x, floor + 0.1, this.position.z), 14, FIRE, 0.9);
      _v.set(this.position.x, floor + 0.3, this.position.z);
      fx.burst(_v, EMBERS, 50, 12, 1.2, 0.45, 12);
      fx.shake(1.0, 0.8);
      this.ctx.audio.play('boss_slam', { position: this.position, volume: 1 });
      this.ctx.audio.play('explosion', { position: this.position, volume: 1, pitch: 0.6 });
    }
    if (t >= 0.7 && !this.entranceRoared) {
      this.entranceRoared = true;
      this.setAnim('roar', true);
      this.ctx.audio.play('boss_roar', { position: this.position });
      fx.shake(0.45, 0.8);
    }
    this.animate(dt);
  }

  protected override onEntranceEnd(): void {
    this.setAnim('idle');
    this.restLeft = 1.0;
    // 名称横幅已由关卡导演在刷出时显示，这里只补一条弱点提示
    this.ctx.ui.toast('熔火深渊的统帅——角盔是弱点', '#ff7a2a');
  }
  protected override animate(dt: number): void {
    const rig = this.rig;
    const a = this.anim;
    const t = this.animT;
    resetPose();

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const walk = this.onGround ? Math.min(1, speed / 2.5) : 0;
    this.walkPhase += speed * dt * (a === 'charge' ? 0.9 : 1.6);
    const s = Math.sin(this.walkPhase);
    if (walk > 0.05) {
      P.legL = -s * 0.5 * walk;
      P.legR = s * 0.5 * walk;
      P.knL = Math.max(0, Math.cos(this.walkPhase)) * 0.6 * walk;
      P.knR = Math.max(0, -Math.cos(this.walkPhase)) * 0.6 * walk;
      P.oX = s * 0.3 * walk - 0.1;
      P.bodyY = (Math.abs(Math.cos(this.walkPhase)) * 0.08 - 0.04) * walk;
      P.capeX = 0.08 + speed * 0.03;
      const sign = s >= 0 ? 1 : -1;
      if (sign !== this.lastStep && walk > 0.5 && a !== 'charge') this.ctx.audio.play('footstep', { position: this.position, pitch: 0.6, volume: 0.7 });
      this.lastStep = sign;
    }

    if (a === 'idle') {
      P.headY = clamp(angleDiff(this.facing, this.yawToPlayer()), -0.5, 0.5);
      P.torsoX += Math.sin(this.age * 1.8) * 0.02;
    } else if (a === 'chargeReady') {
      P.bodyY = -0.25; P.knL = P.knR = 0.55; P.legL = -0.45; P.legR = 0.35; P.torsoX = 0.35;
      P.sX = 0.9; P.sElb = -0.2; P.swX = -0.3; P.oX = -0.8; P.oZ = 0.4; P.lam = 9;
    } else if (a === 'charge') {
      P.torsoX = 0.5; P.sX = 0.9; P.sElb = -0.2; P.swX = -0.3; P.oX = -0.6; P.oZ = 0.3; P.capeX = 0.9; P.lam = 12;
    } else if (a === 'crash') {
      P.torsoX = -0.3; P.headX = -0.3; P.sX = 0.3; P.swX = -0.2; P.knL = P.knR = 0.3; P.bodyY = -0.1; P.lam = 10;
    } else if (a === 'sweepReady') {
      P.torsoY = -0.8; P.sX = -0.4; P.sZ = -1.3; P.sElb = -0.2; P.swX = -0.2; P.knL = P.knR = 0.3; P.bodyY = -0.12; P.lam = 9;
    } else if (a === 'sweep') {
      P.torsoY = 1.0; P.sX = -0.6; P.sZ = -1.3; P.sElb = -0.1; P.swX = -0.2; P.knL = P.knR = 0.3; P.bodyY = -0.15; P.lam = t < 0.15 ? 24 : 8;
    } else if (a === 'sweepReady2') {
      P.torsoY = 1.0; P.sX = -0.6; P.sZ = -1.0; P.swX = -0.3; P.knL = P.knR = 0.3; P.lam = 8;
    } else if (a === 'sweepBack') {
      P.torsoY = -0.9; P.sX = -0.7; P.sZ = -1.2; P.swX = -0.2; P.knL = P.knR = 0.3; P.bodyY = -0.15; P.lam = t < 0.15 ? 24 : 8;
    } else if (a === 'raise') {
      P.sX = -3.0; P.sZ = -0.15; P.sElb = 0; P.swX = 0; P.oZ = 0.9; P.oX = -0.4; P.headX = -0.4; P.torsoX = -0.15; P.lam = 7;
    } else if (a === 'crouch') {
      P.bodyY = -0.45; P.knL = P.knR = 0.95; P.legL = P.legR = -0.55; P.torsoX = 0.4; P.sX = 0.6; P.swX = -0.5; P.oX = 0.4; P.lam = 10;
    } else if (a === 'leap') {
      P.legL = P.legR = -0.9; P.knL = P.knR = 1.3; P.sX = -2.8; P.sElb = -0.2; P.swX = -0.2; P.torsoX = -0.25; P.capeX = 0.6; P.lam = 9;
    } else if (a === 'land' || a === 'plant') {
      P.bodyY = a === 'land' ? -0.55 : -0.3; P.knL = P.knR = a === 'land' ? 1.0 : 0.6; P.legL = P.legR = -0.5;
      P.torsoX = a === 'land' ? 0.6 : 0.35; P.sX = -1.2; P.sElb = 0; P.swX = -0.6; P.oX = -0.4; P.oZ = 0.6;
      P.headX = a === 'plant' ? -0.35 : 0; P.lam = t < 0.1 ? 24 : 8;
    } else if (a === 'slashA') {
      if (t < COMBO_WINDUP) {
        P.torsoY = -0.6; P.sX = -2.3; P.sZ = -0.4; P.sElb = -0.3; P.swX = -0.3; P.lam = 10;
      } else {
        P.torsoY = 0.5; P.sX = -0.5; P.sZ = 0.2; P.swX = -1.2; P.torsoX = 0.3; P.bodyY = -0.1; P.lam = 26;
      }
    } else if (a === 'slashB') {
      if (t < COMBO_WINDUP) {
        P.torsoY = 0.7; P.sX = -1.2; P.sZ = -1.2; P.swX = -0.3; P.lam = 10;
      } else {
        P.torsoY = -0.8; P.sX = -1.3; P.sZ = 0.1; P.swX = -0.6; P.torsoX = 0.25; P.bodyY = -0.1; P.lam = 26;
      }
    } else if (a === 'roar') {
      P.sX = -2.4; P.sZ = -0.6; P.swX = 0; P.oZ = 1.1; P.oX = -0.5; P.headX = -0.5;
      P.torsoX = -0.25 + Math.sin(this.age * 32) * 0.02; P.lam = 6;
    }

    const k = 1 - Math.exp(-P.lam * dt);
    rig.hips.position.y += (1.62 + P.bodyY - rig.hips.position.y) * k;
    rig.torso.position.y += (1.9 + P.bodyY - rig.torso.position.y) * k;
    rig.torso.rotation.x += (P.torsoX - rig.torso.rotation.x) * k;
    rig.torso.rotation.y += (P.torsoY - rig.torso.rotation.y) * k;
    rig.head.rotation.x += (P.headX - rig.head.rotation.x) * k;
    rig.head.rotation.y += (P.headY - rig.head.rotation.y) * k;
    rig.legL.rotation.x += (P.legL - rig.legL.rotation.x) * k;
    rig.legR.rotation.x += (P.legR - rig.legR.rotation.x) * k;
    rig.kneeL.rotation.x += (P.knL - rig.kneeL.rotation.x) * k;
    rig.kneeR.rotation.x += (P.knR - rig.kneeR.rotation.x) * k;
    rig.armS.rotation.x += (P.sX - rig.armS.rotation.x) * k;
    rig.armS.rotation.z += (P.sZ - rig.armS.rotation.z) * k;
    rig.elbowS.rotation.x += (P.sElb - rig.elbowS.rotation.x) * k;
    rig.sword.rotation.x += (P.swX - rig.sword.rotation.x) * k;
    rig.armO.rotation.x += (P.oX - rig.armO.rotation.x) * k;
    rig.armO.rotation.z += (P.oZ - rig.armO.rotation.z) * k;
    rig.elbowO.rotation.x += (P.oElb - rig.elbowO.rotation.x) * k;
    rig.cape.rotation.x += (P.capeX + Math.sin(this.age * 2.3) * 0.04 - rig.cape.rotation.x) * k;

    // 发光
    const pulse = 0.5 + 0.5 * Math.sin(this.age * (4 + this.fury * 3));
    rig.coreHalo.scale.setScalar(0.9 + pulse * 0.25 + this.fury * 0.2);
    rig.crest.scale.set(1, 1 + Math.sin(this.age * 21) * 0.18 + this.fury * 0.35, 1);
    this.setRoleOpacity('bladeHalo', 0.2 + this.bladeGlow * 0.45 + this.fury * 0.08);
  }

  // ───────────── 死亡 ─────────────

  protected override animateDeath(t: number): void {
    const rig = this.rig;
    const kneel = Math.min(1, t / 0.4);
    rig.kneeL.rotation.x = 1.4 * kneel;
    rig.kneeR.rotation.x = 0.4 * kneel;
    rig.legL.rotation.x = -0.2 * kneel;
    rig.legR.rotation.x = -1.2 * kneel;
    rig.hips.position.y = 1.62 - 0.75 * kneel;
    rig.torso.position.y = 1.9 - 0.75 * kneel;
    rig.torso.rotation.x = 0.45 * kneel;
    rig.torso.rotation.y *= 0.9;
    rig.head.rotation.x = 0.5 * kneel;
    rig.armS.rotation.x = -1.1 * kneel;
    rig.sword.rotation.x = -0.5 * kneel;
    rig.body.position.x = Math.sin(this.deathTime * 60) * 0.04 * span(t, 0.4, 0.85);
    // 熔心过载：发白发亮
    _col.copy(_c1).lerp(_c2, span(t, 0.3, 0.85));
    this.setRoleColor('ember', _col);
    this.setRoleColor('coreHalo', _col);
    rig.coreHalo.scale.setScalar(1 + span(t, 0.3, 0.88) * 2.5);
    if (t > 0.88) this.model.scale.setScalar(Math.max(0.01, 1 - (t - 0.88) / 0.12));
  }
}
