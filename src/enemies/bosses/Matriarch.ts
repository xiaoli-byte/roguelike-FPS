/**
 * 霜翼妖后（第二章 Boss，飞行）。
 *
 * 招式：
 *  - 冰棱螺旋弹幕：升空蓄力 → 自转并向下倾斜地喷出 3 臂（二阶段 4 臂、中途反转）螺旋冰棱，弹道在玩家距离处约胸口高。
 *  - 冰枪齐射：身后浮现 5（二阶段 7）支冰枪，各自的瞄准线追踪玩家，发射前 0.3 秒逐支锁定（持续移动即可闪避）。
 *  - 俯冲：高空盘旋并画出直线预警 → 沿线低空俯冲撞击（侧移 / 冲刺躲开；撞上掩体会眩晕）。二阶段连续两次并散射冰棱。
 *  - 寒霜新星：降到低空蓄力（地面预警圈）→ 近身爆发；之后在低空停留片刻（输出窗口）。
 *  - 召唤冰晶：在场地各处召唤可击毁的冰晶，存活时持续为妖后回复护盾。
 * 阶段：50% 展开极寒之翼（变紫、回复部分护盾、召唤冰晶）；此后弹幕更密，且 4 秒未受伤会自行再生护盾。
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { damp, rotateTowards, TAU } from '../../core/math';
import { BossBase } from './BossBase';
import { IceCrystal } from './IceCrystal';
import { buildMatriarch, FROST, FROST_RAGE, type MatriarchRig } from './MatriarchModel';
import type { BeamMesh } from './Visuals';
import { easeOutCubic, geo, span, std } from './parts';

export const MATRIARCH_DEF: EnemyDef = {
  id: 'boss_matriarch',
  name: '霜翼妖后',
  hp: 3200,
  shield: 1800,
  speed: 7,
  radius: 1.3,
  height: 3.4,
  flying: true,
  damage: 12,
  coins: [60, 100],
  essence: 60,
  isBoss: true,
  headY: 2.94,
  headRadius: 0.45,
  knockbackResist: 1,
  color: 0x8fe3ff,
};

const WARN = 0x7fd8ff;
const SHARD = 0x9fe8ff;
const LOCK = 0xff5a7a;
const MAX_LANCES = 7;
const MAX_CRYSTALS = 4;

const _v = new THREE.Vector3();
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _calm = new THREE.Color(FROST);
const _rage = new THREE.Color(FROST_RAGE);
const _col = new THREE.Color();

const P = {
  bodyRX: 0, torsoX: 0, headX: 0, headY: 0,
  armLX: 0, armLZ: 0, armRX: 0, armRZ: 0, foreL: 0, foreR: 0,
  flapBase: 0.15, flapAmp: 0.35, flapRate: 5, fold: 0.1, lam: 8,
};

function resetPose(): void {
  P.bodyRX = 0; P.torsoX = 0; P.headX = 0; P.headY = 0;
  P.armLX = -0.15; P.armLZ = -0.25; P.armRX = -0.15; P.armRZ = 0.25; P.foreL = -0.3; P.foreR = -0.3;
  P.flapBase = 0.15; P.flapAmp = 0.35; P.flapRate = 5; P.fold = 0.1; P.lam = 8;
}

type DiveStage = 'aim' | 'dive' | 'recover' | 'crash';

export class Matriarch extends BossBase {
  private rig!: MatriarchRig;
  /** 目标离地高度（脚底） */
  private hoverTarget = 4.2;
  private orbitSign: 1 | -1 = 1;
  private orbitTimer = 4;
  private flapPhase = 0;
  private chill = 0;
  private chargeGlow = 0;
  private entranceFxAcc = 0;
  private entranceRoared = false;
  private deathShattered = false;
  private transFxAcc = 0;

  // 螺旋弹幕
  private spinAngle = 0;
  private spinDir: 1 | -1 = 1;
  private spinVisual = 0;
  private fireAcc = 0;
  private emitCount = 0;
  private spiralDur = 3.2;

  // 冰枪
  private lanceCount = 5;
  private lanceVolleys = 1;
  private lanceAim = 1;
  private volleyLen = 2;
  private readonly lanceMeshes: THREE.Mesh[] = [];
  private readonly lanceActive: boolean[] = [];
  private readonly lanceLocked: boolean[] = [];
  private readonly lanceTargets: THREE.Vector3[] = [];
  private readonly lanceLines: (BeamMesh | null)[] = [];

  // 俯冲
  private diveStage: DiveStage = 'aim';
  private stageT = 0;
  private divesLeft = 1;
  private diveTele = 1;
  private diveYaw = 0;
  private diveDX = 0;
  private diveDZ = 1;
  private diveLen = 20;
  private diveTravel = 0;
  private diveHit = false;
  private trailAcc = 0;

  // 新星
  private novaWind = 1.2;
  private readonly novaCenter = new THREE.Vector3();

  // 冰晶
  private crystals: IceCrystal[] = [];
  private readonly crystalPts: THREE.Vector3[] = [];
  private crystalAnnounced = false;
  private crystalWant = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, MATRIARCH_DEF, opts);
    this.thresholds = [0.5];
    this.spawnDuration = 2.6;
    this.deathDuration = 2.6;
    this.transitionDuration = 2.2;
    this.accel = 22;
    for (let i = 0; i < MAX_LANCES; i++) {
      this.lanceActive.push(false);
      this.lanceLocked.push(false);
      this.lanceTargets.push(new THREE.Vector3());
      this.lanceLines.push(null);
    }
    for (let i = 0; i < MAX_CRYSTALS; i++) this.crystalPts.push(new THREE.Vector3());
    this.registerMoves();
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    const { root, rig } = buildMatriarch();
    this.rig = rig;
    this.weakAnchor = rig.head;
    this.muzzleAnchor = rig.core;
    this.hitShapes = [
      { anchor: rig.head, radius: 0.45, halfHeight: 0, weak: true },
      { anchor: rig.chest, radius: 0.55, halfHeight: 0.25, weak: false },
      { anchor: rig.skirt, radius: 0.75, halfHeight: 0, weak: false },
      { anchor: rig.tail, radius: 0.42, halfHeight: 0, weak: false },
      { anchor: rig.wingAnchorL, radius: 0.85, halfHeight: 0, weak: false },
      { anchor: rig.wingAnchorR, radius: 0.85, halfHeight: 0, weak: false },
    ];
    return root;
  }

  protected override onModelReady(): void {
    const mat = std(0xd8f8ff, { emissive: 0x5ad0ff, ei: 0.9, rough: 0.2, metal: 0.1 });
    for (let i = 0; i < MAX_LANCES; i++) {
      const lance = new THREE.Mesh(geo.octa(0.5), mat);
      lance.scale.set(0.28, 0.28, 2.4);
      this.lanceMeshes.push(lance);
    }
    this.flyTargetY = this.floorY() + this.hoverTarget;
  }

  // ───────────── 招式 ─────────────

  private registerMoves(): void {
    // 冰棱螺旋弹幕
    this.addMove({
      id: 'spiral', cooldown: 9, recovery: 1.3,
      weight: () => 2.6,
      start: () => {
        this.setAnim('spin', true);
        this.hoverTarget = 4.6;
        this.spinAngle = this.facing;
        this.spinVisual = 0;
        this.spinDir = this.ctx.rng.sign();
        this.fireAcc = 0;
        this.emitCount = 0;
        this.spiralDur = this.phase >= 1 ? 3.8 : 3.2;
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.2 });
        this.getMuzzle(_m);
        this.ctx.fx.burst(_m, SHARD, 16, 3, 0.8, 0.3, -1);
      },
      tick: (t, dt) => {
        this.stopMoving();
        const charge = 0.8;
        if (t < charge) {
          this.chargeGlow = t / charge;
          this.spinVisual += dt * 6 * this.chargeGlow * this.spinDir;
          return false;
        }
        this.chargeGlow = 1;
        const u = t - charge;
        const dir = this.phase >= 1 && u > this.spiralDur * 0.5 ? -this.spinDir : this.spinDir;
        const rate = this.phase >= 1 ? 2.2 : 1.8;
        this.spinAngle += dir * rate * dt;
        this.spinVisual += dir * 9 * dt;
        const interval = this.phase >= 1 ? 0.1 : 0.12;
        this.fireAcc += dt;
        while (this.fireAcc >= interval) {
          this.fireAcc -= interval;
          this.emitSpiral();
        }
        return u >= this.spiralDur;
      },
      end: () => {
        this.chargeGlow = 0;
        this.hoverTarget = 4.2;
        // 把自转角规约回 (-PI, PI]，避免收招时反向狂转
        const r = this.spinVisual % TAU;
        this.spinVisual = r > Math.PI ? r - TAU : r < -Math.PI ? r + TAU : r;
        this.rig.body.rotation.y = this.spinVisual;
      },
    }, 1.5);

    // 冰枪齐射
    this.addMove({
      id: 'lances', cooldown: 5.5, recovery: 1.1,
      weight: () => 2.4,
      start: () => {
        this.setAnim('cast', true);
        this.lanceCount = this.phase >= 1 ? 7 : 5;
        this.lanceVolleys = this.phase >= 1 ? 2 : 1;
        this.lanceAim = this.phase >= 1 ? 0.85 : 1.0;
        this.volleyLen = this.lanceAim + this.lanceCount * 0.12 + 0.45;
        this.hoverTarget = 3.3;
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.4 });
      },
      tick: (t, dt) => {
        this.stopMoving();
        this.facePlayer(4, dt);
        for (let v = 0; v < this.lanceVolleys; v++) {
          const base = v * this.volleyLen;
          if (this.at(base)) this.summonLances();
          for (let i = 0; i < this.lanceCount; i++) {
            const fireAt = base + this.lanceAim + i * 0.12;
            if (this.at(fireAt - 0.3)) this.lockLance(i);
            if (this.at(fireAt)) this.fireLance(i);
          }
        }
        this.updateLances();
        return t >= this.lanceVolleys * this.volleyLen;
      },
      end: () => {
        this.clearLances();
        this.hoverTarget = 4.2;
      },
    }, 0.5);

    // 俯冲
    this.addMove({
      id: 'dive', cooldown: 7, recovery: 1.0,
      weight: () => (this.distToPlayerXZ() > 6 ? 2.2 : 1),
      start: () => {
        this.divesLeft = this.phase >= 1 ? 2 : 1;
        this.diveTele = this.phase >= 1 ? 0.85 : 1.0;
        this.beginDiveAim();
      },
      tick: (_t, dt) => this.tickDive(dt),
      end: () => {
        this.accel = 22;
        this.hoverTarget = 4.2;
      },
    }, 4);

    // 寒霜新星
    this.addMove({
      id: 'nova', cooldown: 10, recovery: 1.4,
      weight: () => (this.distToPlayerXZ() < 10 ? 4 : 1.2),
      start: () => {
        this.setAnim('novaCharge', true);
        this.novaWind = this.phase >= 1 ? 0.95 : 1.2;
        this.hoverTarget = 1.5;
        this.novaCenter.set(this.position.x, this.floorY(), this.position.z);
        this.hazards.groundWarning(this.novaCenter.x, this.novaCenter.y, this.novaCenter.z, 7.5, this.novaWind, WARN);
        this.ctx.audio.play('telegraph', { position: this.position });
      },
      tick: (t, dt) => {
        this.stopMoving();
        if (t < this.novaWind) {
          this.chargeGlow = t / this.novaWind;
          this.trailAcc += dt;
          if (this.trailAcc >= 0.08) {
            this.trailAcc = 0;
            const a = Math.random() * TAU;
            _v.set(this.position.x + Math.sin(a) * 3, this.position.y + 1.5, this.position.z + Math.cos(a) * 3);
            this.ctx.fx.burst(_v, SHARD, 3, 3, 0.4, 0.25, 0);
          }
        }
        if (this.at(this.novaWind)) this.novaBlast();
        if (t >= this.novaWind + 1.2) this.hoverTarget = 4.2;
        return t >= this.novaWind + 1.5;
      },
      end: () => {
        this.chargeGlow = 0;
        this.hoverTarget = 4.2;
      },
    }, 3);

    // 召唤冰晶
    this.addMove({
      id: 'crystals', cooldown: 18, recovery: 1.0,
      weight: () => (this.aliveCrystals() < 2 ? 3 : 0),
      start: () => {
        this.setAnim('summon', true);
        this.hoverTarget = 5;
        this.pickCrystalPoints();
        this.ctx.audio.play('telegraph', { position: this.position, pitch: 1.1 });
      },
      tick: (t) => {
        this.stopMoving();
        if (this.at(0.9)) this.spawnCrystals();
        return t >= 1.6;
      },
      end: () => {
        this.hoverTarget = 4.2;
      },
    }, 8);
  }

  // ── 螺旋 ──

  private emitSpiral(): void {
    const arms = this.phase >= 1 ? 4 : 3;
    this.getMuzzle(_m);
    const pl = this.ctx.player.position;
    const dist = Math.max(5, Math.hypot(pl.x - _m.x, pl.z - _m.z));
    const pitch = Math.atan2(_m.y - (pl.y + 1.05), dist);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const speed = this.phase >= 1 ? 12 : 11;
    for (let k = 0; k < arms; k++) {
      const a = this.spinAngle + (k / arms) * TAU;
      _d.set(Math.sin(a) * cp, -sp, Math.cos(a) * cp);
      _v.copy(_m).addScaledVector(_d, 0.9);
      this.fireProjectile(_v, _d, speed, 8, { color: SHARD, visual: 'shard', radius: 0.28, lifetime: 2.8, scale: 1.2 });
    }
    if (this.emitCount++ % 3 === 0) this.ctx.audio.play('enemy_shot', { position: this.position, volume: 0.35, pitch: 1.4 });
  }

  // ── 冰枪 ──

  private lanceSlot(i: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.lanceCount;
    const th = n > 1 ? -1.1 + (2.2 * i) / (n - 1) : 0;
    const lx = Math.sin(th) * 1.9;
    const ly = 2.4 + Math.cos(th) * 1.1 + Math.sin(this.age * 3 + i) * 0.06;
    const lz = -0.3;
    const f = this.facing;
    const c = Math.cos(f);
    const s = Math.sin(f);
    return out.set(this.position.x + lx * c + lz * s, this.position.y + ly, this.position.z - lx * s + lz * c);
  }

  private summonLances(): void {
    for (let i = 0; i < this.lanceCount; i++) {
      const lance = this.lanceMeshes[i];
      this.lanceSlot(i, lance.position);
      this.ctx.stageGroup.add(lance);
      lance.visible = true;
      this.lanceActive[i] = true;
      this.lanceLocked[i] = false;
      this.hazards.releaseBeam(this.lanceLines[i]);
      this.lanceLines[i] = this.hazards.beam(WARN, 0xe8fdff);
      this.ctx.fx.burst(lance.position, SHARD, 5, 2, 0.4, 0.25, 0);
    }
    this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 1.5, volume: 0.6 });
  }

  private lockLance(i: number): void {
    if (!this.lanceActive[i]) return;
    const pl = this.ctx.player;
    this.lanceLocked[i] = true;
    this.lanceTargets[i].set(pl.position.x + pl.velocity.x * 0.25, pl.position.y + 1.1, pl.position.z + pl.velocity.z * 0.25);
    const line = this.lanceLines[i];
    if (line) {
      line.setColor(LOCK);
      line.setCoreColor(0xffe0e6);
    }
  }

  private fireLance(i: number): void {
    if (!this.lanceActive[i]) return;
    const lance = this.lanceMeshes[i];
    _d.subVectors(this.lanceTargets[i], lance.position).normalize();
    this.fireProjectile(lance.position, _d, 42, 13, { color: 0xbff4ff, visual: 'shard', radius: 0.3, scale: 2.2, lifetime: 2 });
    this.ctx.fx.burst(lance.position, SHARD, 6, 3, 0.35, 0.25, 0);
    this.ctx.audio.play('enemy_shot', { position: this.position, pitch: 1.6, volume: 0.7 });
    this.lanceActive[i] = false;
    lance.removeFromParent();
    this.hazards.releaseBeam(this.lanceLines[i]);
    this.lanceLines[i] = null;
  }

  private updateLances(): void {
    const pl = this.ctx.player.position;
    for (let i = 0; i < this.lanceCount; i++) {
      if (!this.lanceActive[i]) continue;
      const lance = this.lanceMeshes[i];
      this.lanceSlot(i, lance.position);
      const target = this.lanceTargets[i];
      if (!this.lanceLocked[i]) target.set(pl.x, pl.y + 1.1, pl.z);
      lance.lookAt(target);
      const line = this.lanceLines[i];
      if (line) {
        const locked = this.lanceLocked[i];
        line.set(lance.position, target, locked ? 0.045 : 0.022);
        line.setOpacity(locked ? 0.95 : 0.5);
        line.flicker(locked ? 0.75 + 0.25 * Math.sin(this.animT * 40) : 1);
      }
    }
  }

  private clearLances(): void {
    for (let i = 0; i < MAX_LANCES; i++) {
      this.lanceActive[i] = false;
      this.lanceMeshes[i]?.removeFromParent();
      this.hazards.releaseBeam(this.lanceLines[i]);
      this.lanceLines[i] = null;
    }
  }

  // ── 俯冲 ──

  private beginDiveAim(): void {
    this.diveStage = 'aim';
    this.stageT = 0;
    this.hoverTarget = 5.2;
    this.setAnim('diveReady', true);
    const pl = this.ctx.player.position;
    let dx = pl.x - this.position.x;
    let dz = pl.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      dx = Math.sin(this.facing);
      dz = Math.cos(this.facing);
    } else {
      dx /= d;
      dz /= d;
    }
    this.diveDX = dx;
    this.diveDZ = dz;
    this.diveYaw = Math.atan2(dx, dz);
    this.diveLen = Math.max(6, Math.min(d + 8, this.distToArenaEdge(this.position.x, this.position.z, dx, dz, 2.5)));
    this.hazards.lineWarning(this.position.x, this.floorY(), this.position.z, this.diveYaw, this.diveLen, 1.7, this.diveTele, WARN);
    this.ctx.audio.play('telegraph', { position: this.position });
    this.ctx.audio.play('enemy_alert', { position: this.position, pitch: 1.3 });
  }

  private tickDive(dt: number): boolean {
    this.stageT += dt;
    if (this.diveStage === 'aim') {
      this.stopMoving();
      this.facing = rotateTowards(this.facing, this.diveYaw, 5 * dt);
      if (this.stageT >= this.diveTele) {
        this.diveStage = 'dive';
        this.stageT = 0;
        this.diveTravel = 0;
        this.diveHit = false;
        this.accel = 90;
        this.hoverTarget = 1.0;
        this.velocity.y = Math.min(this.velocity.y, -8);
        this.setAnim('dive', true);
        this.ctx.audio.play('enemy_charge', { position: this.position, pitch: 1.2 });
        this.rig.skirt.getWorldPosition(_prev);
      }
      return false;
    }
    if (this.diveStage === 'dive') {
      this.setMove(this.diveDX, this.diveDZ, 24);
      this.facing = this.diveYaw;
      this.diveTravel += Math.hypot(this.velocity.x, this.velocity.z) * dt;
      this.rig.skirt.getWorldPosition(_v);
      if (!this.diveHit && this.hazards.segmentHitsPlayer(_prev, _v, 1.25)) {
        this.diveHit = true;
        this.hazards.hurt(26, 'none', this.position);
        this.ctx.player.applyImpulse(_d.set(this.diveDX * 12, 5, this.diveDZ * 12));
        this.ctx.fx.shake(0.5, 0.35);
        this.ctx.audio.play('enemy_melee', { position: this.position, pitch: 0.8 });
      }
      _prev.copy(_v);
      this.trailAcc += dt;
      if (this.trailAcc >= 0.04) {
        this.trailAcc = 0;
        this.ctx.fx.burst(_v, SHARD, 3, 1.5, 0.5, 0.3, -1);
      }
      const crashed = this.moveResult.hitWall && this.stageT > 0.15;
      if (this.diveTravel >= this.diveLen || crashed || this.stageT > 2.5) {
        this.accel = 22;
        this.stageT = 0;
        this.stopMoving();
        if (this.phase >= 1) this.shardRing(10, 12);
        if (crashed) {
          this.diveStage = 'crash';
          this.setAnim('crash', true);
          this.hoverTarget = 1.6;
          this.ctx.fx.shake(0.45, 0.4);
          this.ctx.fx.burst(_v, 0xd8f6ff, 20, 7, 0.8, 0.35, 12);
          this.ctx.audio.play('boss_slam', { position: this.position, pitch: 1.2 });
        } else {
          this.diveStage = 'recover';
          this.setAnim('idle');
          this.hoverTarget = 4.2;
        }
      }
      return false;
    }
    this.stopMoving();
    this.facePlayer(3, dt);
    const wait = this.diveStage === 'crash' ? 1.2 : 0.55;
    if (this.stageT >= wait) {
      this.divesLeft--;
      if (this.divesLeft > 0) {
        this.diveTele = 0.75;
        this.beginDiveAim();
        return false;
      }
      return true;
    }
    return false;
  }

  /** 水平一圈冰棱（胸口高度） */
  private shardRing(n: number, speed: number): void {
    const y = this.floorY() + 1.15;
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      _d.set(Math.sin(a), 0, Math.cos(a));
      _v.set(this.position.x + _d.x * 1.2, y, this.position.z + _d.z * 1.2);
      this.fireProjectile(_v, _d, speed, 8, { color: SHARD, visual: 'shard', radius: 0.28, lifetime: 2.6, scale: 1.2 });
    }
    this.ctx.audio.play('enemy_shot', { position: this.position, pitch: 1.2, volume: 0.6 });
  }

  // ── 新星 ──

  private novaBlast(): void {
    this.setAnim('novaRelease', true);
    this.chargeGlow = 0;
    const c = this.novaCenter;
    this.hazards.blast(c.x, c.y, c.z, 7.5, 22, { maxHeight: 3.5, knockback: 10, knockUp: 4 });
    const fx = this.ctx.fx;
    fx.ring(new THREE.Vector3(c.x, c.y + 0.1, c.z), 8, WARN, 0.6);
    this.getBodyCenter(_v);
    fx.explosion(_v.clone(), 3, SHARD);
    fx.burst(_v, 0xd8f6ff, 30, 11, 0.9, 0.35, 6);
    fx.shake(0.5, 0.4);
    this.ctx.audio.play('explosion', { position: this.position, pitch: 1.3 });
    this.ctx.audio.play('shield_break', { position: this.position, pitch: 0.7 });
    if (this.phase >= 1) this.shardRing(16, 13);
  }

  // ── 冰晶 ──

  private aliveCrystals(): number {
    let n = 0;
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      if (c.alive) this.crystals[n++] = c;
    }
    this.crystals.length = n;
    return n;
  }

  private pickCrystalPoints(): void {
    const alive = this.aliveCrystals();
    this.crystalWant = Math.max(0, Math.min(MAX_CRYSTALS - alive, this.phase >= 1 ? 4 : 3));
    const center = this.arenaCenter(_v);
    const cx = center.x;
    const cz = center.z;
    const floor = this.floorY();
    const pl = this.ctx.player.position;
    const rng = this.ctx.rng;
    const start = rng.range(0, TAU);
    for (let i = 0; i < this.crystalWant; i++) {
      const p = this.crystalPts[i];
      for (let tries = 0; tries < 6; tries++) {
        const a = start + (i / Math.max(1, this.crystalWant)) * TAU + rng.range(-0.3, 0.3) + tries * 0.5;
        const r = rng.range(9, 15);
        p.set(cx + Math.sin(a) * r, floor, cz + Math.cos(a) * r);
        this.clampToArena(p, 3);
        if (Math.hypot(p.x - pl.x, p.z - pl.z) > 5) break;
      }
      const tmp = new THREE.Vector3();
      if (this.ctx.nav.nearestWalkable(p, tmp)) p.set(tmp.x, tmp.y, tmp.z);
      this.hazards.groundWarning(p.x, p.y, p.z, 1.6, 0.9, WARN);
    }
  }

  private spawnCrystals(): void {
    let n = 0;
    for (let i = 0; i < this.crystalWant; i++) {
      const e = this.ctx.enemies.spawn('boss_ice_crystal', { position: this.crystalPts[i].clone(), level: this.level });
      if (e instanceof IceCrystal) {
        e.owner = this;
        this.crystals.push(e);
        this.minions.push(e);
        n++;
      }
    }
    if (n > 0) {
      this.ctx.audio.play('enemy_spawn', { position: this.position, pitch: 1.3 });
      if (!this.crystalAnnounced) {
        this.crystalAnnounced = true;
        this.ctx.ui.toast('寒霜冰晶正在为妖后回复护盾——击碎它们！', '#8fe3ff');
      }
    }
  }

  // ───────────── 阶段 ─────────────

  protected override onPhase(_phase: number): void {
    this.ctx.ui.toast('霜翼妖后展开了极寒之翼！', '#b9a4ff');
    this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.3);
    this.hoverTarget = 5;
    this.getBodyCenter(_v);
    this.ctx.fx.burst(_v, FROST_RAGE, 30, 9, 1.0, 0.4, 0);
    this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 12, FROST_RAGE, 0.9);
    this.clearLances();
    this.queueMove('crystals');
  }

  protected override transitionTick(t: number, dt: number): void {
    this.facePlayer(2, dt);
    this.transFxAcc += dt;
    if (t > 0.1 && t < 1.8 && this.transFxAcc >= 0.2) {
      this.transFxAcc = 0;
      this.ctx.fx.shake(0.15, 0.2);
      this.getBodyCenter(_v);
      this.ctx.fx.burst(_v, FROST_RAGE, 6, 6, 0.6, 0.3, 0);
    }
  }

  protected override restFactor(): number {
    return this.phase >= 1 ? 0.75 : 1;
  }

  // ───────────── 常规行为 ─────────────

  protected override idle(dt: number): void {
    const pl = this.ctx.player.position;
    this.orbitTimer -= dt;
    if (this.orbitTimer <= 0 || (this.moveResult.hitWall && this.orbitTimer < 3)) {
      this.orbitSign = this.orbitSign > 0 ? -1 : 1;
      this.orbitTimer = this.ctx.rng.range(3.5, 6.5);
    }
    const th = Math.atan2(this.position.x - pl.x, this.position.z - pl.z) + this.orbitSign * 0.55;
    _v.set(pl.x + Math.sin(th) * 13, 0, pl.z + Math.cos(th) * 13);
    this.clampToArena(_v, 5);
    this.moveTo(_v, this.def.speed * 0.8, 0.5);
    this.facePlayer(3, dt);
    this.hoverTarget = 4.2;
  }

  protected override passive(dt: number): void {
    const bob = this.anim === 'dive' ? 0 : Math.sin(this.age * 1.1) * 0.35;
    this.flyTargetY = this.floorY() + this.hoverTarget + bob;

    // 冰晶供能 / 二阶段自愈护盾
    const n = this.aliveCrystals();
    if (this.shield < this.maxShield) {
      let rate = n * 0.012;
      if (this.phase >= 1 && this.ctx.time.now - this.lastHurtTime > 4) rate += 0.03;
      if (rate > 0) this.shield = Math.min(this.maxShield, this.shield + this.maxShield * rate * dt);
    }

    const target = this.phase >= 1 ? 1 : 0;
    if (Math.abs(this.chill - target) > 0.002) {
      this.chill = damp(this.chill, target, 1.6, dt);
      _col.copy(_calm).lerp(_rage, this.chill);
      this.setRoleColor('wingGlow', _col);
      this.setRoleColor('coreHalo', _col);
      this.setRoleColor('crownHalo', _col);
      this.setRoleColor('shard', _col);
      this.setRoleColor('gem', _col);
    }
  }

  // ───────────── 登场 / 动画 ─────────────

  protected override entrance(t: number, dt: number): void {
    const rig = this.rig;
    const d = span(t, 0, 0.7);
    const e = 1 - easeOutCubic(d);
    rig.body.position.y = 16 * e;
    rig.body.rotation.y = e * 7;
    if (t >= 1) {
      rig.body.position.y = 0;
      rig.body.rotation.y = 0;
      return;
    }
    this.entranceFxAcc += dt;
    if (d < 1 && this.entranceFxAcc >= 0.06) {
      this.entranceFxAcc = 0;
      this.getBodyCenter(_v);
      _v.y += rig.body.position.y;
      this.ctx.fx.burst(_v, SHARD, 4, 2, 0.6, 0.35, -1);
    }
    if (t >= 0.72 && !this.entranceRoared) {
      this.entranceRoared = true;
      this.setAnim('roar', true);
      this.ctx.audio.play('boss_roar', { position: this.position, pitch: 1.35 });
      this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.floorY() + 0.1, this.position.z), 12, WARN, 1.0);
      this.getBodyCenter(_v);
      this.ctx.fx.burst(_v, 0xd8f6ff, 30, 10, 1.0, 0.35, 2);
      this.ctx.fx.shake(0.4, 0.8);
    } else if (!this.entranceRoared) {
      this.setAnim('summon');
    }
    this.animate(dt);
  }

  protected override onEntranceEnd(): void {
    this.setAnim('idle');
    this.restLeft = 1.0;
    this.ctx.ui.banner(this.displayName, '霜雪古寺之主', 2.4);
  }

  protected override animate(dt: number): void {
    const rig = this.rig;
    const a = this.anim;
    const t = this.animT;
    resetPose();

    // 飞行前倾
    const fwd = this.velocity.x * Math.sin(this.facing) + this.velocity.z * Math.cos(this.facing);
    P.bodyRX = Math.max(-0.25, Math.min(0.35, fwd * 0.04));
    P.headX = 0.1;

    if (a === 'spin') {
      P.armLZ = -1.35; P.armRZ = 1.35; P.armLX = P.armRX = -0.2; P.foreL = P.foreR = 0;
      P.flapBase = 0.35; P.flapAmp = 0.12; P.flapRate = 9;
    } else if (a === 'cast') {
      P.armRX = -1.7; P.armRZ = 0.2; P.foreR = 0; P.armLX = -2.4; P.armLZ = -0.4; P.foreL = -0.2;
      P.flapBase = 0.4; P.flapAmp = 0.2;
    } else if (a === 'diveReady') {
      P.bodyRX = -0.3; P.armLX = P.armRX = 0.5; P.armLZ = -0.6; P.armRZ = 0.6;
      P.flapBase = 0.7; P.flapAmp = 0.1; P.flapRate = 3; P.fold = 0;
    } else if (a === 'dive') {
      P.bodyRX = 1.05; P.headX = -0.6; P.armLX = P.armRX = 0.9; P.armLZ = -0.15; P.armRZ = 0.15;
      P.flapBase = -0.1; P.flapAmp = 0.05; P.flapRate = 12; P.fold = 1.1; P.lam = 12;
    } else if (a === 'crash') {
      P.bodyRX = 0.4; P.headX = 0.5; P.flapBase = -0.4; P.flapAmp = 0.05; P.flapRate = 2;
      P.armLX = P.armRX = 0.3; P.foreL = P.foreR = -0.1;
    } else if (a === 'novaCharge') {
      P.armLX = -1.3; P.armLZ = 0.55; P.armRX = -1.3; P.armRZ = -0.55; P.foreL = P.foreR = -0.6;
      P.fold = -0.7; P.flapBase = 0.2; P.flapAmp = 0.06; P.flapRate = 14; P.headX = 0.3;
    } else if (a === 'novaRelease') {
      P.armLZ = -1.5; P.armRZ = 1.5; P.armLX = P.armRX = -0.6; P.foreL = P.foreR = 0;
      P.flapBase = 0.6; P.flapAmp = 0.15; P.fold = 0; P.headX = -0.4; P.lam = t < 0.15 ? 22 : 8;
    } else if (a === 'summon') {
      P.armLX = P.armRX = -2.8; P.armLZ = -0.35; P.armRZ = 0.35; P.foreL = P.foreR = -0.2;
      P.flapBase = 0.5; P.flapAmp = 0.25; P.headX = -0.35;
    } else if (a === 'roar') {
      P.headX = -0.55 + Math.sin(this.age * 30) * 0.04; P.armLZ = -1.2; P.armRZ = 1.2; P.armLX = P.armRX = -0.4;
      P.flapBase = 0.8; P.flapAmp = 0.2; P.flapRate = 8; P.fold = -0.1;
    }

    const k = 1 - Math.exp(-P.lam * dt);
    rig.body.rotation.x += (P.bodyRX - rig.body.rotation.x) * k;
    rig.body.rotation.y = a === 'spin' ? this.spinVisual : rig.body.rotation.y + (0 - rig.body.rotation.y) * k;
    rig.torso.rotation.x += (P.torsoX - rig.torso.rotation.x) * k;
    rig.head.rotation.x += (P.headX - rig.head.rotation.x) * k;
    rig.armL.rotation.x += (P.armLX - rig.armL.rotation.x) * k;
    rig.armL.rotation.z += (P.armLZ - rig.armL.rotation.z) * k;
    rig.armR.rotation.x += (P.armRX - rig.armR.rotation.x) * k;
    rig.armR.rotation.z += (P.armRZ - rig.armR.rotation.z) * k;
    rig.foreL.rotation.x += (P.foreL - rig.foreL.rotation.x) * k;
    rig.foreR.rotation.x += (P.foreR - rig.foreR.rotation.x) * k;

    // 翅膀扇动
    this.flapPhase += dt * P.flapRate;
    const flap = P.flapBase + Math.sin(this.flapPhase) * P.flapAmp;
    const wk = 1 - Math.exp(-10 * dt);
    rig.wingL.rotation.z += (-flap - rig.wingL.rotation.z) * wk;
    rig.wingR.rotation.z += (flap - rig.wingR.rotation.z) * wk;
    rig.wingL.rotation.y += (-P.fold - rig.wingL.rotation.y) * wk;
    rig.wingR.rotation.y += (P.fold - rig.wingR.rotation.y) * wk;

    // 发光与环绕冰棱
    rig.orbit.rotation.y += dt * (1.2 + this.chill * 0.8);
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 4);
    rig.coreHalo.scale.setScalar(1 + pulse * 0.15 + this.chargeGlow * 1.3);
    rig.crownHalo.scale.setScalar(1 + pulse * 0.2);
  }

  // ───────────── 死亡 ─────────────

  protected override animateDeath(t: number): void {
    const rig = this.rig;
    rig.body.rotation.x = Math.min(1.4, t * 2);
    rig.body.rotation.y += this.ctx.time.dt * 3;
    rig.wingL.rotation.z = 0.5 * t;
    rig.wingR.rotation.z = -0.5 * t;
    rig.wingL.rotation.y = -1.2 * t;
    rig.wingR.rotation.y = 1.2 * t;
    rig.head.rotation.x = 0.6 * t;
    this.setRoleOpacity('coreHalo', 0.35 * Math.max(0, 1 - t));
    this.setRoleOpacity('crownHalo', 0.3 * Math.max(0, 1 - t));
    if (t >= 0.78) {
      const s = Math.max(0.01, 1 - (t - 0.78) / 0.22);
      this.model.scale.setScalar(s);
      if (!this.deathShattered) {
        this.deathShattered = true;
        this.getBodyCenter(_v);
        this.ctx.fx.burst(_v, 0xd8f6ff, 44, 11, 1.2, 0.45, 12);
        this.ctx.fx.burst(_v, FROST, 20, 6, 0.9, 0.3, 4);
        this.ctx.audio.play('shield_break', { position: this.position, pitch: 0.6, volume: 1 });
      }
    }
  }

  protected override onBossDispose(): void {
    this.clearLances();
  }
}
