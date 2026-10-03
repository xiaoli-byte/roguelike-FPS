/**
 * 沙暴巨像（第一章 Boss）。
 *
 * 招式：
 *  - 砸地冲击波：双拳高举 → 砸地（落点小范围重击）+ 低矮扩散冲击波环（跳过）；二阶段起双环。
 *  - 巨石投掷：蹲身掬石 → 连续甩出 5（二阶段 7）颗带地面预警的抛物巨石，首颗预判玩家位置。
 *  - 眼部扫射：独眼蓄力并画出瞄准线 → 膝盖高度的水平光束绕身旋转一圈多（跳过 / 躲掩体后）。
 *  - 践踏：玩家贴身过久时抬腿预警 → 6 米范围震地击退（看准时机起跳可躲）。
 *  - 裂地岩刺（二阶段起）：双拳捶地，3（三阶段 5）道岩刺沿扇形依次破土。
 * 阶段：50% 核心过载（变红、加快、召唤刀客），25% 再次召唤刀客并进一步加快。
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import type { StaticBox, WorldRayHit } from '../../world/Collision';
import { angleDiff, clamp, damp, rotateTowards, TAU } from '../../core/math';
import { BossBase } from './BossBase';
import { buildColossus, COLOSSUS_EYE, COLOSSUS_EYE_RAGE, type ColossusRig } from './ColossusModel';
import type { BeamMesh } from './Visuals';
import { easeInQuad, easeOutCubic, span } from './parts';

export const COLOSSUS_DEF: EnemyDef = {
  id: 'boss_colossus',
  name: '沙暴巨像',
  hp: 3000,
  armor: 1500,
  speed: 2.4,
  radius: 2.1,
  height: 5.4,
  damage: 22,
  coins: [60, 100],
  essence: 60,
  isBoss: true,
  headY: 4.9,
  headRadius: 0.72,
  knockbackResist: 1,
  color: 0xffa640,
};

const WARN = 0xff7a2a;
const SAND = 0xd9b27a;
const BEAM = 0xffa040;
const WAVE = 0xffb060;
/** 扫射光束：离地高度、判定半径、起点（身前距离）与射程 */
const BEAM_Y = 0.55;
const BEAM_RADIUS = 0.22;
const BEAM_START = 3;
const BEAM_RANGE = 36;
/** 裂地岩刺：单根半径、扇形间隔、首根破土前的预警时长、沿线逐根间隔 */
const SPIKE_RADIUS = 1.15;
const FISSURE_SPREAD = 0.42;
const FISSURE_WARN = 0.85;
const FISSURE_STEP = 0.075;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };
const _calm = new THREE.Color(COLOSSUS_EYE);
const _rage = new THREE.Color(COLOSSUS_EYE_RAGE);
const _col = new THREE.Color();

/** 每帧的姿态目标（模块级复用） */
const P = {
  bodyY: 0, torsoX: 0, torsoY: 0, torsoZ: 0, headX: 0, headY: 0,
  shLX: 0, shLZ: 0, shRX: 0, shRZ: 0, elL: 0, elR: 0,
  legL: 0, legR: 0, knL: 0, knR: 0, lam: 8,
};

function resetPose(): void {
  P.bodyY = 0; P.torsoX = 0; P.torsoY = 0; P.torsoZ = 0; P.headX = 0; P.headY = 0;
  P.shLX = 0; P.shLZ = -0.12; P.shRX = 0; P.shRZ = 0.12; P.elL = -0.15; P.elR = -0.15;
  P.legL = 0; P.legR = 0; P.knL = 0; P.knR = 0; P.lam = 8;
}

export class Colossus extends BossBase {
  private rig!: ColossusRig;
  private walkPhase = 0;
  private lastStep = 0;
  private closeTime = 0;
  private rage = 0;
  private eyeBoost = 0;
  private sandAcc = 0;
  private entranceFxAcc = 0;
  private entranceRoared = false;
  private entranceRumble = false;
  private transFxAcc = 0;

  // 招式状态
  private slamWind = 1;
  private readonly slamPoint = new THREE.Vector3();
  private stompWind = 0.8;
  private throwCount = 5;
  private beamCharge = 1;
  private beamAngle = 0;
  /** 上一帧的光束角度（扫掠判定用，避免低帧率时光束一帧扫过玩家却没判到） */
  private beamPrevAngle = 0;
  private beamSign: 1 | -1 = 1;
  private beamSpeed = 1.35;
  private beamSweep = TAU;
  private beamNextHit = 0;
  private beamFxAcc = 0;
  private beamSoundAcc = 0;
  private beamMain: BeamMesh | null = null;
  private beamSlant: BeamMesh | null = null;
  private aimA: BeamMesh | null = null;
  private aimB: BeamMesh | null = null;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, COLOSSUS_DEF, opts);
    this.thresholds = [0.5, 0.25];
    this.spawnDuration = 3.0;
    this.deathDuration = 3.4;
    this.transitionDuration = 2.3;
    this.accel = 12;
    this.registerMoves();
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    const { root, rig } = buildColossus();
    this.rig = rig;
    this.weakAnchor = rig.head;
    this.muzzleAnchor = rig.eyeHalo;
    this.hitShapes = [
      { anchor: rig.head, radius: 0.72, halfHeight: 0, weak: true },
      { anchor: rig.chest, radius: 1.05, halfHeight: 0.2, weak: false },
      { anchor: rig.shoulderL, radius: 0.72, halfHeight: 0, weak: false },
      { anchor: rig.shoulderR, radius: 0.72, halfHeight: 0, weak: false },
      { anchor: rig.belly, radius: 1.05, halfHeight: 0.35, weak: false },
      { anchor: rig.kneeL, radius: 0.58, halfHeight: 0.95, weak: false },
      { anchor: rig.kneeR, radius: 0.58, halfHeight: 0.95, weak: false },
      { anchor: rig.upperArmL, radius: 0.5, halfHeight: 0.5, weak: false },
      { anchor: rig.upperArmR, radius: 0.5, halfHeight: 0.5, weak: false },
      { anchor: rig.fistL, radius: 0.66, halfHeight: 0, weak: false },
      { anchor: rig.fistR, radius: 0.66, halfHeight: 0, weak: false },
    ];
    return root;
  }

  // ───────────── 招式 ─────────────

  private registerMoves(): void {
    // 砸地冲击波
    this.addMove({
      id: 'slam', cooldown: 5.5, recovery: 1.3,
      weight: () => (this.distToPlayerXZ() < 22 ? 3 : 1.6),
      start: () => {
        this.setAnim('slamUp', true);
        this.slamWind = this.phase >= 1 ? 0.8 : 1.0;
        const f = this.facing;
        const floor = this.floorY();
        this.slamPoint.set(this.position.x + Math.sin(f) * 3.3, floor, this.position.z + Math.cos(f) * 3.3);
        this.hazards.groundWarning(this.slamPoint.x, floor, this.slamPoint.z, 3.6, this.slamWind, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t) => {
        if (this.at(this.slamWind)) this.slamImpact(true);
        if (this.phase >= 1 && this.at(this.slamWind + 0.6)) this.slamImpact(false);
        return t >= this.slamWind + (this.phase >= 1 ? 1.2 : 0.75);
      },
    }, 1.0);

    // 巨石投掷
    this.addMove({
      id: 'boulders', cooldown: 7, recovery: 1.1,
      weight: () => (this.distToPlayerXZ() > 9 ? 3 : 1),
      start: () => {
        this.setAnim('throw', true);
        this.throwCount = this.phase >= 1 ? 7 : 5;
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t, dt) => {
        if (t < 0.8) this.facePlayer(2, dt);
        for (let i = 0; i < this.throwCount; i++) if (this.at(0.85 + i * 0.14)) this.throwBoulder(i);
        return t >= 0.85 + this.throwCount * 0.14 + 0.45;
      },
    }, 2.5);

    // 眼部扫射
    this.addMove({
      id: 'beam', cooldown: 13, recovery: 1.4,
      weight: () => 2.4,
      start: () => {
        this.setAnim('beam', true);
        this.beamCharge = this.phase >= 1 ? 0.95 : 1.2;
        this.beamSign = this.ctx.rng.sign();
        this.beamAngle = this.yawToPlayer() - this.beamSign * 1.25;
        this.beamSpeed = this.phase >= 2 ? 1.95 : this.phase >= 1 ? 1.7 : 1.35;
        this.beamSweep = TAU * (this.phase >= 1 ? 1.2 : 1.0) + 1.25;
        this.beamNextHit = 0;
        this.aimA = this.hazards.beam(0xff5020, 0xffd6a8);
        this.aimB = this.hazards.beam(0xff5020, 0xffd6a8);
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 0.8 });
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 0.6 });
      },
      tick: (t, dt) => {
        if (t < this.beamCharge) {
          this.facing = rotateTowards(this.facing, this.beamAngle, 3 * dt);
          const u = t / this.beamCharge;
          this.eyeBoost = u;
          this.updateAim(u);
          return false;
        }
        if (this.at(this.beamCharge)) this.fireBeam();
        this.beamPrevAngle = this.beamAngle;
        this.beamAngle += this.beamSign * this.beamSpeed * dt;
        this.facing = this.beamAngle;
        this.eyeBoost = 1;
        this.updateBeam(dt);
        return t - this.beamCharge >= this.beamSweep / this.beamSpeed;
      },
      end: () => this.releaseBeams(),
    }, 5);

    // 践踏（反贴身）
    this.addMove({
      id: 'stomp', cooldown: 4.5, recovery: 0.9,
      weight: () => (this.closeTime > 0.9 ? 8 : this.distToPlayerXZ() < 6.5 ? 3 : 0),
      start: () => {
        this.setAnim('stompUp', true);
        this.stompWind = this.phase >= 1 ? 0.62 : 0.78;
        this.hazards.groundWarning(this.position.x, this.floorY(), this.position.z, 6.2, this.stompWind, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t) => {
        if (this.at(this.stompWind)) this.stompImpact();
        return t >= this.stompWind + 0.7;
      },
    });

    // 裂地岩刺（二阶段起）
    this.addMove({
      id: 'fissure', cooldown: 8, recovery: 1.2,
      weight: () => (this.phase >= 1 ? 2.8 : 0),
      start: () => {
        this.setAnim('punch', true);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t, dt) => {
        if (t < 0.45) this.facePlayer(2.4, dt);
        if (this.at(0.62)) this.castFissure();
        return t >= 1.35;
      },
    });
  }

  private slamImpact(first: boolean): void {
    const p = this.slamPoint;
    const fx = this.ctx.fx;
    let crushed = false;
    if (first) {
      this.setAnim('slamDown', true);
      crushed = this.hazards.blast(p.x, p.y, p.z, 3.6, 30, { maxHeight: 2.2, knockback: 9, knockUp: 5 });
      _v.set(p.x, p.y + 0.3, p.z);
      fx.explosion(_v, 3.2, SAND);
      fx.shake(0.7, 0.5);
      this.ctx.audio.play('boss_slam', { position: this.position, volume: 1 });
    } else {
      fx.shake(0.35, 0.3);
      this.ctx.audio.play('boss_slam', { position: this.position, volume: 0.7, pitch: 1.2 });
    }
    _v.set(p.x, p.y + 0.3, p.z);
    fx.burst(_v, SAND, 22, 8, 1.0, 0.4, 14);
    this.hazards.wave({
      x: p.x, y: p.y, z: p.z,
      speed: this.phase >= 1 ? 13 : 11.5, maxRadius: 34, startRadius: 1.5,
      damage: 20, color: WAVE, width: 0.9, height: 0.85, knockback: 5, dust: SAND,
      // 被落点重击砸飞的玩家落地前跳不起来，紧随其后的第一道波不再追加伤害
      spare: crushed,
    });
  }

  private throwBoulder(i: number): void {
    const pl = this.ctx.player;
    const rng = this.ctx.rng;
    const floor = this.floorY();
    if (i === 0) {
      _v.set(pl.position.x + pl.velocity.x * 0.8, 0, pl.position.z + pl.velocity.z * 0.8);
    } else {
      const a = rng.range(0, TAU);
      const r = rng.range(2.5, 8.5);
      _v.set(pl.position.x + Math.sin(a) * r, 0, pl.position.z + Math.cos(a) * r);
    }
    this.clampToArena(_v, 2);
    const gy = this.ctx.world.groundHeight(_v.x, _v.z, floor + 30);
    _v.y = Number.isFinite(gy) ? gy : floor;
    const fist = i % 2 === 0 ? this.rig.fistR : this.rig.fistL;
    fist.getWorldPosition(_a);
    const dist = Math.hypot(_v.x - _a.x, _v.z - _a.z);
    this.hazards.lob({
      from: _a, to: _v,
      time: 1.05 + dist * 0.022 + i * 0.02,
      arc: 5 + dist * 0.28,
      radius: 3.0, damage: 22, color: WARN, kind: 'boulder',
    });
    this.ctx.fx.burst(_a, SAND, 6, 4, 0.5, 0.3, 10);
    this.ctx.audio.play('skill_throw', { position: this.position, pitch: 0.55, volume: 0.8 });
  }

  private updateAim(u: number): void {
    const floor = this.floorY();
    const a = this.beamAngle;
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    this.rig.eyeHalo.getWorldPosition(_eye);
    _a.set(this.position.x + sx * BEAM_START, floor + BEAM_Y, this.position.z + cz * BEAM_START);
    _dir.set(sx, 0, cz);
    const hit = this.ctx.world.raycast(_a, _dir, BEAM_RANGE, _hit);
    _b.copy(_a).addScaledVector(_dir, hit ? hit.distance : BEAM_RANGE);
    const r = 0.025 + 0.035 * u;
    const flick = 0.55 + 0.45 * Math.sin(this.animT * (18 + 20 * u));
    if (this.aimA) {
      this.aimA.set(_eye, _a, r);
      this.aimA.setOpacity(0.35 + 0.5 * u);
      this.aimA.flicker(flick);
    }
    if (this.aimB) {
      this.aimB.set(_a, _b, r);
      this.aimB.setOpacity(0.3 + 0.5 * u);
      this.aimB.flicker(flick);
    }
  }

  private fireBeam(): void {
    this.hazards.releaseBeam(this.aimA);
    this.hazards.releaseBeam(this.aimB);
    this.aimA = null;
    this.aimB = null;
    this.beamPrevAngle = this.beamAngle;
    this.beamMain = this.hazards.beam(BEAM, 0xfff0d0);
    this.beamSlant = this.hazards.beam(BEAM, 0xfff0d0);
    this.ctx.audio.play('shot_beam', { position: this.position, pitch: 0.5, volume: 0.9 });
    this.ctx.fx.shake(0.25, 0.3);
  }

  private updateBeam(dt: number): void {
    const floor = this.floorY();
    const a = this.beamAngle;
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    this.rig.eyeHalo.getWorldPosition(_eye);
    _a.set(this.position.x + sx * BEAM_START, floor + BEAM_Y, this.position.z + cz * BEAM_START);
    _dir.set(sx, 0, cz);
    const hit = this.ctx.world.raycast(_a, _dir, BEAM_RANGE, _hit);
    _b.copy(_a).addScaledVector(_dir, hit ? hit.distance : BEAM_RANGE);
    const flick = 0.85 + 0.15 * Math.sin(this.animT * 47);
    if (this.beamMain) {
      this.beamMain.set(_a, _b, 0.26);
      this.beamMain.flicker(flick);
    }
    if (this.beamSlant) {
      this.beamSlant.set(_eye, _a, 0.22);
      this.beamSlant.flicker(flick);
    }
    const now = this.ctx.time.now;
    if (now >= this.beamNextHit && (this.hazards.segmentHitsPlayer(_eye, _a, 0.24) || this.beamSweepHits(this.beamPrevAngle, a, floor))) {
      this.hazards.hurt(16, 'fire', _eye);
      this.beamNextHit = now + 0.5;
    }
    this.beamFxAcc += dt;
    if (this.beamFxAcc >= 0.05) {
      this.beamFxAcc = 0;
      this.ctx.fx.burst(_b, BEAM, 3, 4, 0.35, 0.25, 6);
      this.ctx.fx.burst(_a, SAND, 2, 3, 0.4, 0.3, 4);
    }
    this.beamSoundAcc += dt;
    if (this.beamSoundAcc >= 0.35) {
      this.beamSoundAcc = 0;
      this.ctx.audio.play('shot_beam', { position: this.position, pitch: 0.55, volume: 0.4 });
    }
  }

  /**
   * 膝盖高度光束的扫掠判定：本帧光束从 prevA 转到 curA 扫过的扇区是否覆盖玩家。
   * 与逐帧线段判定一致，但不会因为低帧率（一帧转过一两米）而让光束「跳过」玩家。
   * 高度：光束中心离地 0.55 米、半径 0.22 米，玩家脚底离地约 0.77 米以上即可跳过；掩体挡光。
   */
  private beamSweepHits(prevA: number, curA: number, floor: number): boolean {
    const pl = this.ctx.player;
    if (!pl.alive) return false;
    const dx = pl.position.x - this.position.x;
    const dz = pl.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    const reach = BEAM_RADIUS + pl.radius;
    const h = pl.position.y - floor;
    const lo = h + pl.radius;
    const hi = h + Math.max(pl.radius, pl.height - pl.radius);
    const gap = Math.max(0, lo - BEAM_Y, BEAM_Y - hi);
    if (gap >= reach) return false;
    const lateral = Math.sqrt(reach * reach - gap * gap);
    if (d < BEAM_START - lateral || d > BEAM_START + BEAM_RANGE + lateral) return false;
    const tol = Math.asin(Math.min(1, lateral / d));
    const sweep = curA - prevA;
    const delta = angleDiff(prevA, Math.atan2(dx, dz));
    if (delta < Math.min(0, sweep) - tol || delta > Math.max(0, sweep) + tol) return false;
    const k = Math.min(1, BEAM_START / d);
    _v.set(this.position.x + dx * k, floor + BEAM_Y, this.position.z + dz * k);
    _w.set(pl.position.x, floor + BEAM_Y, pl.position.z);
    return !this.ctx.world.segmentBlocked(_v, _w);
  }

  private releaseBeams(): void {
    this.hazards.releaseBeam(this.aimA);
    this.hazards.releaseBeam(this.aimB);
    this.hazards.releaseBeam(this.beamMain);
    this.hazards.releaseBeam(this.beamSlant);
    this.aimA = this.aimB = this.beamMain = this.beamSlant = null;
    this.eyeBoost = 0;
  }

  private stompImpact(): void {
    this.setAnim('stompDown', true);
    const floor = this.floorY();
    const x = this.position.x;
    const z = this.position.z;
    const crushed = this.hazards.blast(x, floor, z, 6.2, 24, { maxHeight: 1.1, knockback: 13, knockUp: 6 });
    _v.set(x, floor + 0.1, z);
    this.ctx.fx.ring(_v, 6.5, SAND, 0.5);
    _v.set(x, floor + 0.3, z);
    this.ctx.fx.burst(_v, SAND, 26, 9, 0.9, 0.4, 14);
    this.ctx.fx.shake(0.6, 0.45);
    this.ctx.audio.play('boss_slam', { position: this.position });
    if (this.phase >= 1) {
      this.hazards.wave({ x, y: floor, z, speed: 12, maxRadius: 16, startRadius: 6.2, damage: 16, color: WAVE, width: 0.8, height: 0.8, dust: SAND, spare: crushed });
    }
    this.closeTime = 0;
  }

  /**
   * 3（三阶段 5）道岩刺沿扇形由近到远依次破土。每道用一条长条预警（填满后保持到最后一根破土），
   * 不再给每根刺单独画圆形预警（5 × 12 个会挤爆特效模块的预警池）。同一次施放最多命中玩家一次。
   */
  private castFissure(): void {
    this.setAnim('punchDown', true);
    const floor = this.floorY();
    const lines = this.phase >= 2 ? 5 : 3;
    const mid = (lines - 1) / 2;
    const volley = { hit: false };
    for (let l = 0; l < lines; l++) {
      const yaw = this.facing + (l - mid) * FISSURE_SPREAD;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      const maxD = this.distToArenaEdge(this.position.x, this.position.z, dx, dz, 1.5);
      let n = 0;
      for (let j = 0; j < 12; j++) {
        const d = 3.2 + j * 2.1;
        if (d > maxD) break;
        const x = this.position.x + dx * d;
        const z = this.position.z + dz * d;
        const gy = this.ctx.world.groundHeight(x, z, floor + 4);
        this.hazards.erupt({
          x, y: Number.isFinite(gy) ? gy : floor, z,
          radius: SPIKE_RADIUS, delay: FISSURE_WARN + j * FISSURE_STEP, damage: 20, color: WARN, kind: 'rock',
          sound: l === Math.floor(mid) && j % 3 === 0, warn: false, volley,
        });
        n++;
      }
      if (n > 0) {
        const start = 3.2 - SPIKE_RADIUS;
        const len = 2.1 * (n - 1) + SPIKE_RADIUS * 2;
        // 地刺已排好破土任务，招式被打断后照常破土：预警随危险物兑现（'hazard'），只在 Boss 死亡时撤回
        this.hazards.lineWarning(
          this.position.x + dx * start, floor, this.position.z + dz * start, yaw, len, SPIKE_RADIUS,
          FISSURE_WARN, WARN, (n - 1) * FISSURE_STEP + 0.1, 'hazard',
        );
      }
    }
    this.rig.fistL.getWorldPosition(_a);
    this.rig.fistR.getWorldPosition(_b);
    _a.add(_b).multiplyScalar(0.5);
    _a.y = floor + 0.2;
    this.ctx.fx.explosion(_a.clone(), 2.2, SAND);
    this.ctx.fx.shake(0.5, 0.35);
    this.ctx.audio.play('boss_slam', { position: this.position, pitch: 0.9 });
  }

  // ───────────── 阶段 ─────────────

  protected override onPhase(phase: number): void {
    const ui = this.ctx.ui;
    if (phase === 1) ui.toast('沙暴巨像的核心开始过载，召来了沙匪！', '#ff8a3d');
    else ui.toast('沙暴巨像濒临崩毁，召来了更多沙匪！', '#ff6a2a');
    this.hazards.later(1.0, () => {
      if (!this.alive) return;
      const n = this.summon('grunt', phase === 1 ? 3 : 4, 5, 9, 6);
      if (n > 0) this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 10, SAND, 0.8);
    });
  }

  protected override transitionTick(t: number, dt: number): void {
    this.facePlayer(1, dt);
    this.transFxAcc += dt;
    if (t > 0.2 && t < 1.8 && this.transFxAcc >= 0.22) {
      this.transFxAcc = 0;
      this.ctx.fx.shake(0.22, 0.2);
      const a = Math.random() * TAU;
      _v.set(this.position.x + Math.sin(a) * 2.6, this.floorY() + 0.3, this.position.z + Math.cos(a) * 2.6);
      this.ctx.fx.burst(_v, SAND, 8, 5, 0.8, 0.4, 6);
    }
  }

  protected override restFactor(): number {
    return this.phase >= 2 ? 0.6 : this.phase >= 1 ? 0.72 : 1;
  }

  // ───────────── 常规行为 ─────────────

  protected override idle(dt: number): void {
    this.facePlayer(1.4, dt);
    const d = this.distToPlayerXZ();
    if (d > 13) this.moveTo(this.ctx.player.position, this.def.speed * (this.phase >= 1 ? 1.2 : 1), 10);
    else this.stopMoving();
  }

  protected override passive(dt: number): void {
    if (this.distToPlayerXZ() < 7) this.closeTime += dt;
    else this.closeTime = Math.max(0, this.closeTime - dt * 2);
    const target = this.phase >= 1 ? 1 : 0;
    if (Math.abs(this.rage - target) > 0.002) {
      this.rage = damp(this.rage, target, 1.6, dt);
      _col.copy(_calm).lerp(_rage, this.rage);
      this.setRoleColor('eye', _col);
      this.setRoleColor('eyeHalo', _col);
      this.setRoleColor('rune', _col);
      this.setRoleColor('coreHalo', _col);
      _col.copy(_calm).lerp(_rage, this.rage * 0.7).offsetHSL(0, 0, 0.1);
      this.setRoleColor('core', _col);
    }
    // 身上不时飘落的流沙
    this.sandAcc += dt;
    if (this.sandAcc >= 0.3) {
      this.sandAcc = 0;
      const a = Math.random() * TAU;
      _v.set(this.position.x + Math.sin(a) * 1.3, this.position.y + 2 + Math.random() * 2.5, this.position.z + Math.cos(a) * 1.3);
      this.ctx.fx.burst(_v, SAND, 2, 0.6, 1.1, 0.18, 3);
    }
  }

  // ───────────── 登场 / 动画 ─────────────

  protected override entrance(t: number, dt: number): void {
    const rig = this.rig;
    const rise = span(t, 0, 0.7);
    rig.body.position.y = -6.4 * (1 - easeOutCubic(rise));
    if (t >= 1) {
      rig.body.position.y = 0;
      return;
    }
    const fx = this.ctx.fx;
    this.entranceFxAcc += dt;
    if (rise < 1 && this.entranceFxAcc >= 0.12) {
      this.entranceFxAcc = 0;
      fx.shake(0.18, 0.2);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        _v.set(this.position.x + Math.sin(a) * 2.8, this.floorY() + 0.2, this.position.z + Math.cos(a) * 2.8);
        fx.burst(_v, SAND, 6, 5, 0.9, 0.45, 8);
      }
    }
    if (!this.entranceRumble && dt > 0) {
      this.entranceRumble = true;
      this.ctx.audio.play('boss_slam', { position: this.position, pitch: 0.45, volume: 0.9 });
    }
    if (t >= 0.72 && !this.entranceRoared) {
      this.entranceRoared = true;
      this.setAnim('roar', true);
      this.ctx.audio.play('boss_roar', { position: this.position });
      fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 14, SAND, 1.0);
      fx.shake(0.6, 1.0);
    } else if (!this.entranceRoared) {
      this.setAnim('rise');
    }
    this.animate(dt);
  }

  protected override onEntranceEnd(): void {
    this.setAnim('idle');
    this.restLeft = 1.2;
    // 名称横幅已由关卡导演在刷出时显示，这里只补一条弱点提示
    this.ctx.ui.toast('荒漠遗迹的守护者——头部独眼是弱点', '#ffb347');
  }

  protected override animate(dt: number): void {
    const rig = this.rig;
    const a = this.anim;
    const t = this.animT;
    resetPose();

    // 行走
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const walk = Math.min(1, speed / 1.5);
    this.walkPhase += speed * dt * 1.25;
    const s = Math.sin(this.walkPhase);
    if (walk > 0.05) {
      P.legL = -s * 0.38 * walk;
      P.legR = s * 0.38 * walk;
      P.knL = Math.max(0, Math.cos(this.walkPhase)) * 0.45 * walk;
      P.knR = Math.max(0, -Math.cos(this.walkPhase)) * 0.45 * walk;
      P.shLX = s * 0.22 * walk;
      P.shRX = -s * 0.22 * walk;
      P.bodyY = (Math.abs(Math.cos(this.walkPhase)) * 0.1 - 0.05) * walk;
      P.torsoZ = s * 0.04 * walk;
      const sign = s >= 0 ? 1 : -1;
      if (sign !== this.lastStep && walk > 0.5) this.footstep(sign);
      this.lastStep = sign;
    }

    const breathe = Math.sin(this.age * 1.6);
    P.torsoX += 0.04 + breathe * 0.02;
    if (a === 'idle') {
      const yawOff = angleDiff(this.facing, this.yawToPlayer());
      P.headY = clamp(yawOff, -0.6, 0.6);
      P.headX = 0.08;
    } else if (a === 'slamUp') {
      P.shLX = P.shRX = -2.7; P.elL = P.elR = -0.4; P.torsoX = -0.2; P.headX = -0.15; P.bodyY = 0.1; P.lam = 5;
    } else if (a === 'slamDown') {
      P.shLX = P.shRX = -0.95; P.elL = P.elR = 0; P.torsoX = 0.5; P.bodyY = -0.55;
      P.knL = P.knR = 0.55; P.legL = P.legR = -0.35; P.headX = -0.25; P.lam = t < 0.12 ? 28 : 7;
    } else if (a === 'throw') {
      if (t < 0.85) {
        P.shLX = P.shRX = -0.6; P.elL = P.elR = -0.5; P.torsoX = 0.45; P.bodyY = -0.35; P.knL = P.knR = 0.4; P.legL = P.legR = -0.2; P.lam = 7;
      } else {
        P.shRX = -1.4 + Math.sin(t * 22) * 0.45;
        P.shLX = -1.4 + Math.sin(t * 22 + Math.PI) * 0.45;
        P.elL = P.elR = -0.2; P.torsoX = -0.05; P.headX = -0.2; P.lam = 16;
      }
    } else if (a === 'beam') {
      P.headX = 0.3; P.torsoX = 0.12; P.shLZ = -0.5; P.shRZ = 0.5; P.shLX = P.shRX = -0.35; P.elL = P.elR = -0.3;
      P.knL = P.knR = 0.15; P.bodyY = -0.1; P.lam = 6;
    } else if (a === 'stompUp') {
      P.legR = -0.95; P.knR = 1.15; P.torsoX = -0.12; P.torsoZ = 0.12; P.shLZ = -0.55; P.shRZ = 0.55; P.bodyY = 0.08; P.lam = 7;
    } else if (a === 'stompDown') {
      P.legR = 0.05; P.knR = 0; P.bodyY = -0.25; P.torsoX = 0.2; P.shLZ = -0.3; P.shRZ = 0.3; P.lam = t < 0.1 ? 26 : 8;
    } else if (a === 'punch') {
      P.shLX = P.shRX = -2.4; P.elL = P.elR = -0.2; P.torsoX = -0.15; P.bodyY = 0.05; P.lam = 7;
    } else if (a === 'punchDown') {
      P.shLX = P.shRX = -0.35; P.elL = P.elR = 0; P.torsoX = 0.75; P.bodyY = -0.7; P.knL = P.knR = 0.7; P.legL = P.legR = -0.4;
      P.lam = t < 0.1 ? 26 : 7;
    } else if (a === 'roar') {
      P.shLZ = -1.05; P.shRZ = 1.05; P.shLX = P.shRX = -0.55; P.elL = P.elR = -0.6; P.headX = -0.5;
      P.torsoX = -0.22 + Math.sin(this.age * 35) * 0.02; P.lam = 6;
    } else if (a === 'rise') {
      P.shLX = -2.3 + Math.sin(this.age * 3) * 0.2; P.shRX = -2.3 - Math.sin(this.age * 3) * 0.2; P.headX = -0.3; P.lam = 6;
    }

    const k = 1 - Math.exp(-P.lam * dt);
    rig.hips.position.y += (2.35 + P.bodyY - rig.hips.position.y) * k;
    rig.torso.position.y += (2.75 + P.bodyY - rig.torso.position.y) * k;
    rig.torso.rotation.x += (P.torsoX - rig.torso.rotation.x) * k;
    rig.torso.rotation.y += (P.torsoY - rig.torso.rotation.y) * k;
    rig.torso.rotation.z += (P.torsoZ - rig.torso.rotation.z) * k;
    rig.head.rotation.x += (P.headX - rig.head.rotation.x) * k;
    rig.head.rotation.y += (P.headY - rig.head.rotation.y) * k;
    rig.shoulderL.rotation.x += (P.shLX - rig.shoulderL.rotation.x) * k;
    rig.shoulderL.rotation.z += (P.shLZ - rig.shoulderL.rotation.z) * k;
    rig.shoulderR.rotation.x += (P.shRX - rig.shoulderR.rotation.x) * k;
    rig.shoulderR.rotation.z += (P.shRZ - rig.shoulderR.rotation.z) * k;
    rig.elbowL.rotation.x += (P.elL - rig.elbowL.rotation.x) * k;
    rig.elbowR.rotation.x += (P.elR - rig.elbowR.rotation.x) * k;
    rig.legL.rotation.x += (P.legL - rig.legL.rotation.x) * k;
    rig.legR.rotation.x += (P.legR - rig.legR.rotation.x) * k;
    rig.kneeL.rotation.x += (P.knL - rig.kneeL.rotation.x) * k;
    rig.kneeR.rotation.x += (P.knR - rig.kneeR.rotation.x) * k;

    // 浮石 / 冠石 / 发光
    rig.orbit.rotation.y += dt * (0.35 + this.rage * 0.45);
    rig.orbit.position.y = 3.3 + Math.sin(this.age * 0.9) * 0.15;
    rig.crown.rotation.y += dt * 1.3;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * (3 + this.rage * 4));
    rig.eyeHalo.scale.setScalar(1 + this.eyeBoost * 1.4 + pulse * 0.1);
    rig.coreHalo.scale.setScalar(0.9 + pulse * 0.2 + this.rage * 0.25);
  }

  private footstep(sign: number): void {
    const foot = sign > 0 ? this.rig.footL : this.rig.footR;
    foot.getWorldPosition(_v);
    _v.y = this.floorY() + 0.15;
    this.ctx.fx.burst(_v, SAND, 5, 3, 0.6, 0.35, 8);
    if (this.distToPlayerXZ() < 26) this.ctx.fx.shake(0.07, 0.15);
    this.ctx.audio.play('footstep', { position: this.position, pitch: 0.45, volume: 0.9 });
  }

  // ───────────── 死亡 ─────────────

  protected override animateDeath(t: number): void {
    const rig = this.rig;
    const shakeT = span(t, 0, 0.4);
    const fall = easeInQuad(span(t, 0.35, 1));
    const jitter = (1 - fall) * (shakeT > 0 ? 0.09 : 0);
    rig.body.position.x = Math.sin(this.deathTime * 70) * jitter;
    rig.body.position.y = -fall * 5.8;
    this.model.rotation.x = fall * 0.45;
    rig.torso.rotation.x = 0.2 + fall * 0.5;
    rig.head.rotation.x = 0.3 + fall * 0.4;
    rig.shoulderL.rotation.z = -0.2 - fall * 0.9;
    rig.shoulderR.rotation.z = 0.2 + fall * 0.9;
    rig.shoulderL.rotation.x = -0.4 * shakeT;
    rig.shoulderR.rotation.x = -0.4 * shakeT;
    rig.orbit.position.y = 3.3 - fall * 2.8;
    const glow = Math.max(0, 1 - t * 1.2) * (0.6 + 0.4 * Math.sin(this.deathTime * 30));
    this.setRoleOpacity('eyeHalo', 0.45 * glow);
    this.setRoleOpacity('coreHalo', 0.35 * glow);
    if (this.deathTime < 2.2 && Math.random() < 0.3) {
      _v.set(this.position.x + (Math.random() - 0.5) * 3, this.floorY() + 0.3, this.position.z + (Math.random() - 0.5) * 3);
      this.ctx.fx.burst(_v, SAND, 5, 5, 0.8, 0.4, 6);
    }
  }

  protected override onBossDispose(): void {
    this.releaseBeams();
  }
}
