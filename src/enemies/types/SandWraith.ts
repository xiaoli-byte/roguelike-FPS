import * as THREE from 'three';
import type { GameContext, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { JerboaBlade } from './JerboaBlade';
import type { ScaledEnemyDef } from '../EnemyBase';
import { GroundDecal } from '../bosses/Visuals';

export const SAND_WRAITH_DEF: ScaledEnemyDef = {
  id: 'sand_wraith', name: '沙魇', scale: 1.4, hp: 55, speed: 5.6, damage: 12,
  radius: 0.34, height: 1.1, headY: 0.92, headRadius: 0.19, knockbackResist: 0.2,
  coins: [1, 3], essence: 1, color: 0xd9b27a,
};

const _target = new THREE.Vector3(), _direction = new THREE.Vector3();

export class SandWraith extends JerboaBlade {
  private burrowCd: number;
  private sink = 1;
  private wraithWindTime = 0.35;
  private wraithRecoverTime = 0.45;
  private wraithZigzagTimer = 0;
  private dustAt = 0;
  private fountainAt = 0;
  private chained = false;
  private warning: GroundDecal | null = null;
  private readonly tunnelTarget = new THREE.Vector3();
  private readonly eruptAt = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, opts);
    this.state = 'stalk';
    this.burrowCd = ctx.rng.range(1, 3.5);
    this.spawnDuration = 0.7;
    this.accel = 20;
  }

  get untargetable(): boolean {
    return this.sink > 0.8 && ['sink', 'burrow', 'surface', 'erupt'].includes(this.state);
  }

  protected override artId(): string {
    return 'jerboa_blade';
  }

  protected override afterInit(): void {
    super.afterInit();
    const sand = new THREE.Color(0xd9b27a);
    this.model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial) material.color.lerp(sand, 0.55);
      }
    });
  }

  protected override ai(dt: number): void {
    const distance = this.distToPlayerXZ();
    this.burrowCd -= dt * this.attackRate;
    switch (this.state) {
      case 'stalk': {
        this.sink = 0;
        this.glowTarget[0] = 0.15 + Math.sin(this.age * 3) * 0.1;
        if (this.cooldown <= 0 && this.sees && distance <= 1.9 && this.verticalReach(1.6) && this.requestAttack('melee', 1.2)) {
          this.wraithWindTime = this.windup(0.35, 0.24);
          this.setState('slashWindup');
          break;
        }
        if (this.burrowCd <= 0 && distance >= 3 && distance <= 16 && this.verticalReach(2.5) && (this.sees || distance < 10) && this.requestAttack('melee', 5)) {
          this.chained = false;
          this.beginSink();
          break;
        }
        this.wraithZigzagTimer -= dt;
        if (this.wraithZigzagTimer <= 0) {
          this.wraithZigzagTimer = this.ctx.rng.range(0.5, 0.9);
          this.strafeSign = -this.strafeSign || 1;
        }
        if (distance > 5.5 || !this.sees) {
          this.approachPlayer(this.speed, 1.2);
          this.faceMovement(9, dt);
        } else if (this.cooldown > 0.3) {
          this.keepRange(2.4, 5, this.speed * 0.85, this.strafeSign);
          this.faceTravel(dt);
        } else {
          this.approachPlayer(this.speed, 0.8);
          this.faceTravel(dt);
        }
        this.dustAt -= dt;
        if (this.dustAt <= 0) {
          this.dustAt = this.ctx.rng.range(0.1, 0.18);
          _target.copy(this.position).y += this.ctx.rng.range(0.4, 1.1) * this.sizeScale;
          this.ctx.fx.burst(_target, 0xd9b27a, 1, 0.4, 0.8, 0.08 * this.sizeScale, 3);
        }
        break;
      }
      case 'sink':
        this.stopMoving();
        this.facePlayer(5.24, dt);
        this.sink = this.smooth(this.stateTime / 0.45);
        this.glowTarget[0] = 0.6;
        if (this.stateTime >= 0.45) {
          this.sink = 1;
          this.tunnelTarget.copy(this.ctx.player.position);
          this.setState('burrow');
        }
        break;
      case 'burrow': {
        this.glowTarget[0] = 0.15;
        if (distance > 3) this.tunnelTarget.copy(this.ctx.player.position);
        this.navigate(this.tunnelTarget, 9, 0.9);
        this.faceMovement(12, dt);
        this.dustAt -= dt;
        if (this.dustAt <= 0) {
          this.dustAt = 0.07;
          this.ctx.fx.burst(this.position, 0xd9b27a, 3, 0.7, 0.4, 0.12, -1);
        }
        if (distance < 1.4 || this.position.distanceToSquared(this.tunnelTarget) < 0.81 || this.stateTime >= 2.4) this.beginSurface();
        break;
      }
      case 'surface':
        this.stopMoving();
        this.glowTarget[0] = 0.5 + this.stateTime / this.wraithWindTime * 0.5;
        if (this.warning) {
          this.warning.time = this.stateTime;
          this.warning.fill = this.stateTime / this.wraithWindTime;
        }
        this.fountainAt -= dt;
        if (this.fountainAt <= 0) {
          this.fountainAt = 0.06;
          const a = this.ctx.rng.next() * Math.PI * 2, r = Math.sqrt(this.ctx.rng.next()) * this.eruptRadius() * 0.6;
          _target.set(this.eruptAt.x + Math.sin(a) * r, this.eruptAt.y + 0.1, this.eruptAt.z + Math.cos(a) * r);
          this.ctx.fx.burst(_target, 0xe2c896, 2, 1.2, 0.5, 0.22 * this.sizeScale, -6);
        }
        if (this.stateTime >= this.wraithWindTime) this.erupt();
        break;
      case 'erupt':
        this.facePlayer(7, dt);
        this.sink = 1 - this.smooth(this.stateTime / 0.22);
        this.glowTarget[0] = 0.8;
        if (this.stateTime >= 0.38) {
          this.sink = 0;
          if (this.isElite && !this.chained && distance >= 4 && distance <= 16 && this.requestAttack('melee', 5)) {
            this.chained = true;
            this.beginSink();
            break;
          }
          this.wraithRecoverTime = 0.7;
          this.burrowCd = this.ctx.rng.range(5.5, 7.5);
          this.setState('recover');
        }
        break;
      case 'slashWindup':
        this.glowTarget[0] = 1;
        this.facePlayer(8, dt);
        if (distance > 1) this.setMove(this.ctx.player.position.x - this.position.x, this.ctx.player.position.z - this.position.z, this.speed * 0.5);
        else this.stopMoving();
        if (this.stateTime >= this.wraithWindTime) {
          this.melee(1.6, this.def.damage, 0.2);
          this.crossSlashFx();
          this.setState('slash');
        }
        break;
      case 'slash':
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 1.5);
        if (this.stateTime >= 0.16) {
          this.wraithRecoverTime = 0.45;
          this.setState('recover');
        }
        break;
      case 'recover':
        this.stopMoving();
        this.facePlayer(3.8, dt);
        this.sink = 0;
        this.glowTarget[0] = 0.1;
        if (this.stateTime >= this.wraithRecoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(1.2, 2.2);
          this.setState('stalk');
        }
        break;
      default:
        this.sink = 0;
        this.setState('stalk');
    }
  }

  private smooth(t: number): number {
    const v = clamp01(t);
    return v * v * (3 - 2 * v);
  }

  private eruptRadius(): number {
    return this.isElite ? 2.6 : 2.2;
  }

  private beginSink(): void {
    this.sink = 0;
    this.releaseWarning();
    this.setState('sink');
  }

  private beginSurface(): void {
    this.wraithWindTime = this.windup(0.6, 0.35);
    this.eruptAt.copy(this.position);
    this.releaseWarning();
    this.warning = GroundDecal.acquire(this.ctx.stageGroup, 0xd9b27a).circle(this.eruptAt.x, this.eruptAt.y, this.eruptAt.z, this.eruptRadius());
    this.warning.fill = 0;
    this.setState('surface');
  }

  private erupt(): void {
    const radius = this.eruptRadius();
    this.melee(radius, this.def.damage * 1.3, -1);
    _direction.subVectors(this.ctx.player.position, this.position).setY(0);
    if (_direction.lengthSq() <= radius * radius && _direction.lengthSq() > 1e-5) {
      _direction.normalize().multiplyScalar(6);
      _direction.y = 3.5;
      this.ctx.player.applyImpulse(_direction);
    }
    this.ctx.fx.ring(this.position, radius, 0xd9b27a, 0.55);
    this.ctx.fx.burst(this.position, 0xd9b27a, 22, 4.5, 1.1, 0.35, 4);
    this.ctx.fx.shake(0.25, 0.2);
    this.releaseWarning();
    this.setState('erupt');
  }

  private releaseWarning(): void {
    this.warning?.release();
    this.warning = null;
  }

  protected override cancelAttack(): void {
    this.sink = 0;
    this.releaseWarning();
    this.setState('stalk');
  }

  protected override onDispose(): void {
    this.releaseWarning();
    super.onDispose();
  }

  protected override pose(dt: number): void {
    super.pose(dt);
    this.model.position.y = -this.sink * 1.3;
  }
}
