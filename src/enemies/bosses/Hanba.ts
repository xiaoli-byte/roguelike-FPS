import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp, rotateTowards, TAU } from '../../core/math';
import type { StaticBox, WorldRayHit } from '../../world/Collision';
import { BossBase } from './BossBase';
import { buildHanba, type HanbaRig } from './HanbaModel';
import type { BeamMesh } from './Visuals';

export const HANBA_DEF: EnemyDef = {
  id: 'boss_hanba', name: '旱魃 · 赤地之源', hp: 7700 / 1.48, shield: 3850 / 1.48,
  speed: 4.2, radius: 0.9, height: 4.5, damage: 15, coins: [60, 100], essence: 60,
  isBoss: true, flying: true, headY: 2.8, headRadius: 0.2, knockbackResist: 1, color: 0xffd27a,
};

const SUN = 0xffe2a0, SAND = 0xd9b27a, WARN = 0xffa23d;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const _ray: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };

export class Hanba extends BossBase {
  private rig!: HanbaRig;
  private aim: BeamMesh | null = null;
  private beam: BeamMesh | null = null;
  private shaft: BeamMesh | null = null;
  private sweepYaw = 0;
  private sweepSign: 1 | -1 = 1;
  private sweepStart = 0;
  private sweepRange = 16;
  private swept = 0;
  private nextBeamHit = 0;
  private weakGrace = 0;
  private ventTimer = 3;
  private eclipseLeft = 0;
  private sunTick = 0;
  private sunburn = 0;
  private apsara: IEnemy | null = null;
  private flareLeft = 0;
  private solarFactor = 1;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, HANBA_DEF, opts);
    this.thresholds = [0.6, 0.3];
    this.spawnDuration = 4;
    this.deathDuration = 4.2;
    this.hoverHeight = 0.55;
    this.restLeft = 1.2;
    this.registerMoves();
  }

  protected override buildModel(): THREE.Object3D {
    this.rig = buildHanba();
    this.weakAnchor = this.rig.pearl;
    this.muzzleAnchor = this.rig.hub;
    this.hitShapes = [
      { anchor: this.rig.pearl, radius: 0.2, halfHeight: 0, weak: false },
      { anchor: this.rig.body, radius: 0.68, halfHeight: 1.4, weak: false },
    ];
    this.shaft = this.hazards.beam(0xffc46a);
    this.shaft.setOpacity(0);
    return this.rig.root;
  }

  private pace(): number {
    return [1, 1.2, 1.4][Math.min(this.phase, 2)];
  }

  protected override restFactor(): number {
    return [1, 0.85, 0.7][Math.min(this.phase, 2)];
  }

  private registerMoves(): void {
    this.addMove({
      id: 'sun_sweep', cooldown: 9, recovery: 1,
      weight: () => this.distToPlayerXZ() > 6 ? 2.4 : 0.96,
      start: () => {
        const pace = this.pace();
        this.sweepRange = clamp(this.distToPlayerXZ(), 7, 26);
        this.sweepSign = this.ctx.rng.next() < 0.5 ? -1 : 1;
        this.sweepStart = this.yawToPlayer() - this.sweepSign * 55 * Math.PI / 180;
        this.sweepYaw = this.sweepStart;
        this.swept = 0;
        this.nextBeamHit = 0;
        this.aim = this.hazards.beam(0xffc060);
        this.hazards.sectorWarning(this.position.x, this.groundAt(this.position.x, this.position.z), this.position.z,
          this.yawToPlayer(), 55 * Math.PI / 180, this.sweepRange + 2, 1.4 / pace, WARN);
      },
      tick: (t, dt) => {
        const wind = 1.4 / this.pace();
        if (t < wind) {
          this.facing = rotateTowards(this.facing, this.sweepStart, 2.62 * dt);
          this.rig.hub.getWorldPosition(_a);
          this.sweepEnd(this.sweepStart, _b);
          this.aim?.set(_a, _b, 0.035 + t / wind * 0.035);
          return false;
        }
        if (!this.beam) {
          this.hazards.releaseBeam(this.aim); this.aim = null;
          this.beam = this.hazards.beam(0xfff0b8);
          this.ctx.fx.shake(0.35, 0.35);
          this.ctx.audio.play('shot_beam', { position: this.position, pitch: 0.5 });
        }
        const previous = this.sweepYaw;
        const step = Math.min(110 * Math.PI / 180 - this.swept, 48 * Math.PI / 180 * this.pace() * dt);
        this.sweepYaw += this.sweepSign * step;
        this.swept += step;
        this.facing = this.sweepYaw;
        this.rig.hub.getWorldPosition(_a);
        const pieces = Math.max(1, Math.ceil(step * this.sweepRange / 0.5));
        for (let i = 1; i <= pieces; i++) {
          const yaw = previous + (this.sweepYaw - previous) * i / pieces;
          this.sweepEnd(yaw, _b);
          if (this.ctx.time.now >= this.nextBeamHit && this.hazards.segmentHitsPlayer(_a, _b, 0.85)) {
            this.nextBeamHit = this.ctx.time.now + 0.45;
            this.hazards.hurt(15 * 0.85, 'fire', _a);
            this.sunburn = Math.max(this.sunburn, 0.5);
          }
        }
        this.beam.set(_a, _b, 0.45);
        return this.swept >= 110 * Math.PI / 180 - 1e-5 && t >= wind + 1;
      },
      end: () => { this.hazards.releaseBeam(this.aim); this.hazards.releaseBeam(this.beam); this.aim = this.beam = null; },
    });
    this.addMove({
      id: 'hot_wind', cooldown: 7, recovery: 1.1,
      weight: () => this.distToPlayerXZ() < 20 ? 2.6 : 0.65,
      start: () => {
        this.facing = this.yawToPlayer();
        this.hazards.sectorWarning(this.position.x, this.floorY(), this.position.z, this.facing, 38 * Math.PI / 180, 22, 1.1 / this.pace(), SAND);
      },
      tick: t => {
        const wind = 1.1 / this.pace();
        if (this.at(wind)) this.gust(1, 15);
        if (this.phase >= 1 && this.at(wind + 0.35)) this.gust(0.5, 7.5);
        return t >= wind + 22 / 26 + (this.phase >= 1 ? 0.45 : 0.25);
      },
    });
    this.addMove({
      id: 'sand_wraiths', cooldown: 18, recovery: 1.2,
      weight: () => {
        this.pruneMinions();
        return this.minions.length + (this.phase >= 1 ? 4 : 3) <= 6 ? 1.6 : 0;
      },
      start: () => this.hazards.groundWarning(this.position.x, this.floorY(), this.position.z, 3.4, 1.6 / this.pace(), SAND),
      tick: t => {
        const wind = 1.6 / this.pace();
        if (this.at(wind)) {
          const roster = ['sand_wraith', 'sand_wraith', 'scorpion_archer', 'sand_wraith'];
          for (const id of roster.slice(0, this.phase >= 1 ? 4 : 3)) this.summon(id, 1, 4, 9, 6);
          this.ctx.fx.ring(this.position, 8, SAND, 0.8);
        }
        return t >= wind + 0.3;
      },
    }, 5);
    this.addMove({
      id: 'scorch_crack', cooldown: 8, recovery: 1,
      weight: () => this.phase >= 1 ? this.distToPlayerXZ() > 4 ? 2.2 : 0.66 : 0,
      start: () => {
        this.facing = this.yawToPlayer();
        for (const offset of this.phase >= 2 ? [0, -28, 28] : [0]) {
          const yaw = this.facing + offset * Math.PI / 180;
          const length = clamp(this.distToPlayerXZ() + 8, 14, 28);
          this.hazards.lineWarning(this.position.x, this.floorY(), this.position.z, yaw, length, 1.3, 1.2 / this.pace(), WARN,
            length / 18 + 0.45 + Math.ceil(length / 1.5) * 0.035);
          this.crack(yaw, length);
        }
      },
      tick: t => t >= 1.2 / this.pace() + clamp(this.distToPlayerXZ() + 8, 14, 28) / 18 + 0.45 + Math.ceil(clamp(this.distToPlayerXZ() + 8, 14, 28) / 1.5) * 0.035 + 0.15,
    });
    this.addMove({
      id: 'apsara_call', cooldown: 30, recovery: 1.2,
      weight: () => this.phase >= 1 && (!this.apsara || !this.apsara.alive) ? 1.4 : 0,
      start: () => this.hazards.groundWarning(this.position.x + Math.cos(this.facing) * 6, this.floorY(), this.position.z - Math.sin(this.facing) * 6, 1.8, 1.8 / this.pace(), SUN),
      tick: t => {
        const wind = 1.8 / this.pace();
        if (this.at(wind)) {
          _a.set(this.position.x + Math.cos(this.facing) * 6, this.floorY(), this.position.z - Math.sin(this.facing) * 6);
          if (!this.ctx.nav.nearestWalkable(_a, _a)) _a.y = this.floorY();
          this.apsara = this.ctx.enemies.spawn('apsara', { position: _a.clone(), level: this.level });
          if (this.apsara) this.minions.push(this.apsara);
          this.ctx.ui.toast('邪飞天以琵琶为旱魃护体——先打碎她的琵琶！', '#ffd27a');
        }
        return t >= wind + 0.4;
      },
    });
    this.addMove({
      id: 'eclipse', cooldown: 24, recovery: 1.4,
      weight: () => this.phase >= 2 ? 1.8 : 0,
      start: () => {
        this.hazards.groundWarning(this.position.x, this.floorY(), this.position.z, 7, 0.667 + 3 + 0.267, 0xfff2c8);
      },
      tick: t => {
        if (this.at(0.667)) {
          this.eclipseLeft = 3;
          this.ctx.ui.toast('日蚀！心口泉珠显露——集火！日轮复燃前躲进深影', '#ffe2a0');
        }
        if (this.at(3.934)) {
          this.flareLeft = 0.9;
          this.rig.hub.getWorldPosition(_a);
          if (!this.ctx.world.segmentBlocked(_a, this.ctx.player.eye)) {
            this.hazards.hurt(15 * 1.6, 'fire', _a);
            this.sunburn = Math.max(this.sunburn, 2.5);
          }
          this.ctx.fx.explosion(_a, 6, SUN);
          this.ctx.fx.shake(0.7, 0.6);
        }
        return t >= 4.5;
      },
    });
  }

  private gust(damage: number, knockback: number): void {
    this.hazards.wave({
      x: this.position.x, y: this.floorY(), z: this.position.z, speed: 26, maxRadius: 22, startRadius: 1.4,
      width: 3, height: 4.5, damage: 15 * damage, color: 0xffc070, arcCenter: this.facing,
      arcHalf: 38 * Math.PI / 180, knockback, element: 'fire', dust: SAND,
    });
  }

  private crack(yaw: number, length: number): void {
    const n = Math.ceil(length / 1.5), end = length / 18 + 0.45;
    let hit = false;
    for (let i = 1; i <= n; i++) {
      const x = this.position.x + Math.sin(yaw) * i * 1.5, z = this.position.z + Math.cos(yaw) * i * 1.5;
      const y = this.groundAt(x, z);
      this.hazards.later(i * 1.5 / 18, () => this.ctx.fx.burst(_a.set(x, y + 0.15, z), WARN, 3, 2.2, 0.6, 0.14, -0.5));
      this.hazards.later(end + i * 0.035, () => {
        this.ctx.fx.explosion(_a.set(x, y + 0.3, z), 1.7, WARN);
        if (!hit) hit = this.hazards.blast(x, y, z, 1.7, 15 * 1.25, { maxHeight: 2.5, knockUp: 5.5, knockback: 3, element: 'fire' });
      });
    }
  }

  private groundAt(x: number, z: number): number {
    const y = this.ctx.world.groundHeight(x, z, this.position.y + 25, 0.1);
    return Number.isFinite(y) ? y : this.floorY();
  }

  private sweepEnd(yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const x = this.position.x + Math.sin(yaw) * this.sweepRange, z = this.position.z + Math.cos(yaw) * this.sweepRange;
    out.set(x, this.groundAt(x, z), z);
    this.rig.hub.getWorldPosition(_a);
    _dir.subVectors(out, _a);
    const distance = _dir.length();
    if (distance < 0.1) return out;
    _dir.multiplyScalar(1 / distance);
    const hit = this.ctx.world.raycast(_a, _dir, Math.max(0, distance - 0.05), _ray);
    return hit ? out.copy(hit.point) : out;
  }

  protected override idle(dt: number): void {
    const distance = this.distToPlayerXZ();
    const direction = distance < 10 ? -1 : distance > 18 ? 1 : 0;
    _dir.subVectors(this.ctx.player.position, this.position).setY(0).normalize();
    this.setMove(_dir.x * direction - _dir.z * 0.35, _dir.z * direction + _dir.x * 0.35, 4.2);
    this.facePlayer(1.8, dt);
  }

  protected override entrance(t: number): void {
    this.model.position.y = -4 * (1 - t);
    this.rig.ring.scale.setScalar(Math.max(0.01, t));
    if (t >= 1) this.rig.ring.scale.setScalar(1);
  }

  protected override onPhase(phase: number): void {
    this.transitionDuration = phase === 1 ? 3.2 : 3.6;
    this.transitionLeft = this.transitionDuration;
    this.ctx.events.emit('enemy:bossPhase', { enemy: this, phase });
    this.weakpointDamageMult = 1;
    this.eclipseLeft = 0;
    this.ctx.ui.toast(phase === 1 ? '二 · 焦土：泉水尽涸，泉床龟裂' : '三 · 赤地千里：烈日当头', '#ffd27a');
    this.queueMove(phase === 1 ? 'apsara_call' : 'eclipse');
    if (phase >= 2) this.rig.ring.position.y = 28;
  }

  protected override passive(dt: number): void {
    this.rig.ring.rotation.z += dt * (this.eclipseLeft > 0 ? 0.1 : 0.55 + this.phase * 0.2);
    this.rig.armL.rotation.x = this.rig.armR.rotation.x = this.current ? -0.9 : -0.15;
    this.rig.disc.visible = this.eclipseLeft <= 0;
    this.eclipseLeft = Math.max(0, this.eclipseLeft - dt);
    this.flareLeft = Math.max(0, this.flareLeft - dt);
    this.setSolar(this.eclipseLeft > 0 ? 0.12 : this.flareLeft > 0 ? 1 + this.flareLeft / 0.9 * 1.4 : 1);
    if (this.current === null && this.restLeft > 0) this.weakGrace = 0.6;
    else this.weakGrace = Math.max(0, this.weakGrace - dt);
    const exposed = this.weakGrace > 0 || this.eclipseLeft > 0 || this.stunTime > 0;
    this.hitShapes[0].weak = exposed;
    this.rig.pearl.visible = exposed;
    this.weakpointDamageMult = this.eclipseLeft > 0 ? 3 : 1;
    this.damageTakenMult = this.apsara?.alive ? 0.2 : this.stunTime > 0 ? 1.3 : 1;
    if (this.phase >= 1) {
      this.ventTimer -= dt;
      if (this.ventTimer <= 0) {
        this.ventTimer = this.phase >= 2 ? 3.2 : 4.5;
        for (let i = 0; i < (this.phase >= 2 ? 3 : 2); i++) {
          const x = this.ctx.player.position.x + this.ctx.rng.range(-7, 7), z = this.ctx.player.position.z + this.ctx.rng.range(-7, 7);
          this.hazards.zone({ x, y: this.groundAt(x, z), z, radius: 2.2, duration: 0.35, arm: 1.1, damage: 9, interval: 0.35, color: WARN, element: 'fire', embers: WARN });
        }
      }
    }
    this.sunTick -= dt;
    this.sunburn = Math.max(0, this.sunburn - dt);
    if (this.sunTick <= 0) {
      this.sunTick = 0.1;
      this.rig.hub.getWorldPosition(_a);
      const visible = this.distToPlayerXZ() <= (this.phase >= 2 ? 70 : 24) && !this.ctx.world.segmentBlocked(_a, this.ctx.player.eye);
      this.shaft?.set(_a, this.ctx.player.eye, 0.12);
      this.shaft?.setOpacity(visible && this.eclipseLeft <= 0 ? 0.16 : 0);
      if (visible && this.eclipseLeft <= 0) this.sunburn += 0.1;
    }
    if (this.sunburn >= 0.5) {
      this.sunburn -= 0.5;
      this.hazards.hurt(1.5, 'fire', this.rig.hub.getWorldPosition(_a));
    }
  }

  private setSolar(factor: number): void {
    if (Math.abs(this.solarFactor - factor) < 1e-4) return;
    this.solarFactor = factor;
    this.ctx.scene.backgroundIntensity = factor;
    this.ctx.scene.traverse(object => {
      if (!(object instanceof THREE.DirectionalLight)) return;
      if (typeof object.userData.unityBaseIntensity !== 'number') object.userData.unityBaseIntensity = object.intensity;
      object.intensity = object.userData.unityBaseIntensity * factor;
    });
  }

  protected override onBossDeath(_result: DamageResult): void {
    this.setSolar(1);
    this.hazards.releaseBeam(this.aim); this.hazards.releaseBeam(this.beam); this.hazards.releaseBeam(this.shaft);
    this.aim = this.beam = this.shaft = null;
    this.eclipseLeft = 0;
    this.weakpointDamageMult = 1;
  }

  protected override onBossDispose(): void {
    this.setSolar(1);
    this.hazards.releaseBeam(this.aim); this.hazards.releaseBeam(this.beam); this.hazards.releaseBeam(this.shaft);
    this.aim = this.beam = this.shaft = null;
  }

  protected override animateDeath(t: number): void {
    this.rig.ring.rotation.z += t * TAU;
    this.model.position.y = -t * 1.8;
    this.model.rotation.z = t * 0.8;
  }
}
