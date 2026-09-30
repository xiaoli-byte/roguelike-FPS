/**
 * 爆骸虫（bomber）：迂回冲向玩家；2.5 米内点燃引信（0.6 秒：停步、膨胀闪烁、地面预警），
 * 随后自爆（4 米，按距离衰减）并死亡。被玩家提前击杀时爆炸只伤害其他敌人。
 * 背上发光的囊是弱点（头部判定）。
 *
 * 状态机：chase → fuse → （自爆）
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { attackDirector } from '../AttackTokens';
import { blastPlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';

export const BOMBER_DEF: EnemyDef = {
  id: 'bomber',
  name: '爆骸虫',
  hp: 45,
  speed: 8.5,
  radius: 0.5,
  height: 0.85,
  damage: 30,
  coins: [2, 3],
  essence: 1,
  headY: 0.72,
  headRadius: 0.38,
  knockbackResist: 0,
  color: 0xff7a2a,
};

const TRIGGER_RANGE = 2.5;
const FUSE_TIME = 0.6;
const BLAST_RADIUS = 4;
/** 被提前击杀时，对其他敌人的爆炸基础伤害（× 等级） */
const DEATH_BLAST_BASE = 45;

const C = {
  shell: 0xd9cdb0, plate: 0xa89878, belly: 0x5a3a2a, leg: 0x3a2a20, mandible: 0xe8e0c8,
  sac: 0xb0401a, sacHot: 0xffe070, eye: 0xff4020, eyeHot: 0xffffa0,
};

const _c = new THREE.Vector3();

interface Leg {
  pivot: THREE.Group;
  side: number;
  phase: number;
}

export class Bomber extends StandardEnemy {
  private body!: THREE.Group;
  private sac!: THREE.Mesh;
  private legs: Leg[] = [];
  private fuseTime = FUSE_TIME;
  private detonated = false;
  private weave = Math.random() * 10;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, BOMBER_DEF, opts);
    this.deathDuration = 0.35;
    this.accel = 36;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const body = joint(root, 0, 0.42, 0);
    this.body = body;
    // 甲壳（压扁的二十面体）
    const shell = part(body, Geo.ico(0.38), flat(C.shell), 0, 0, 0);
    shell.scale.set(1, 0.72, 1.3);
    part(body, Geo.box(0.46, 0.2, 0.62), flat(C.belly), 0, -0.12, 0);
    for (let i = 0; i < 3; i++) {
      part(body, Geo.box(0.62 - i * 0.08, 0.06, 0.16), flat(C.plate), 0, 0.22 - i * 0.02, -0.28 + i * 0.2, 0.2, 0, 0);
    }
    // 背上的爆囊（弱点）
    this.sac = this.glowPart(body, Geo.ico(0.25, 1), C.sac, C.sacHot, 0, 0.3, -0.08);
    // 头部与颚
    const head = joint(body, 0, -0.02, 0.5);
    part(head, Geo.box(0.3, 0.22, 0.26), flat(C.plate), 0, 0, 0);
    this.glowPart(head, Geo.box(0.06, 0.05, 0.02), C.eye, C.eyeHot, 0.08, 0.05, 0.135);
    this.glowPart(head, Geo.box(0.06, 0.05, 0.02), C.eye, C.eyeHot, -0.08, 0.05, 0.135);
    for (const s of [1, -1]) {
      part(head, Geo.cone(0.04, 0.2, 4), flat(C.mandible), s * 0.1, -0.08, 0.2, Math.PI / 2 + 0.2, 0, -s * 0.35);
    }
    // 六条腿
    for (let i = 0; i < 3; i++) {
      for (const s of [1, -1]) {
        const pivot = joint(body, s * 0.3, -0.06, 0.25 - i * 0.25);
        part(pivot, Geo.box(0.05, 0.5, 0.05, 'top'), flat(C.leg), 0, 0, 0, 0, 0, s * 1.0);
        this.legs.push({ pivot, side: s, phase: i * 2.1 + (s > 0 ? 0 : Math.PI) });
      }
    }
    return root;
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase': {
        this.glowTarget[0] = 0.15 + 0.1 * Math.sin(this.age * 5);
        if (d <= TRIGGER_RANGE && this.verticalReach(2) && this.sees) {
          this.fuseTime = this.windup(FUSE_TIME, 0.45);
          this.setState('fuse');
          this.ctx.fx.groundWarning(this.position.clone(), BLAST_RADIUS, this.fuseTime, 0xff4a1a);
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.9, pitch: 1.3 });
          this.stopMoving();
          break;
        }
        if (d > 5 && this.sees) {
          // 远处蛇形迂回，近处直扑
          this.weave += dt * 5;
          const dx = pl.position.x - this.position.x;
          const dz = pl.position.z - this.position.z;
          const w = Math.sin(this.weave) * 0.55;
          if (this.directPathClear(pl.position)) this.setMove(dx - dz * w, dz + dx * w, this.speed);
          else this.navigate(pl.position, this.speed, 0.5);
        } else {
          this.navigate(pl.position, this.speed, 0.5);
        }
        this.faceMovement(12, dt);
        break;
      }
      case 'fuse': {
        this.stopMoving();
        this.facePlayer(6, dt);
        const t = clamp01(this.stateTime / this.fuseTime);
        // 越来越快的闪烁
        const flick = Math.sin(this.stateTime * (18 + t * 40)) > 0 ? 1 : 0.35;
        this.glowTarget[0] = flick;
        this.glowLevel[0] = flick;
        this.tintBody(0xff5a1a, 0.2 + t * 0.9 * flick);
        if (this.stateTime >= this.fuseTime) this.detonate();
        break;
      }
      default:
        this.setState('chase');
    }
  }

  /** 自爆：伤害玩家、特效、自身死亡（不经过 combat，所以不算玩家击杀、不掉落） */
  private detonate(): void {
    if (this.detonated || !this.alive) return;
    this.detonated = true;
    this.getBodyCenter(_c);
    this.ctx.fx.explosion(_c.clone(), BLAST_RADIUS, 0xff6a1f);
    this.ctx.audio.play('explosion', { position: _c });
    blastPlayer(this.ctx, _c, BLAST_RADIUS, this.def.damage * this.damageMult, 'fire', this, 0.5, 0.8);
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    const req: DamageRequest = { base: 0, element: 'fire', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'fire', statusApplied: null,
    };
    this.onKilled(res);
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    if (this.detonated || attackDirector.purging) return;
    // 被提前击杀：稍后爆炸伤害周围其他敌人（延后结算，避免在 combat 结算中递归，同时形成连锁节奏）。
    // 特效与音效由 combat.explode 负责（未设置 noFx）。
    this.detonated = true;
    const ctx = this.ctx;
    const center = this.getBodyCenter(new THREE.Vector3());
    const base = DEATH_BLAST_BASE * this.level * (this.isElite ? 1.5 : 1);
    ctx.tasks.delay(0.08, () => {
      ctx.combat.explode(center, BLAST_RADIUS, {
        base, element: 'fire', source: 'explosion', procDepth: 1, elementChance: 0.5, canCrit: false,
      }, { playerDamage: 0, color: 0xff6a1f, falloff: 0.5 });
    });
  }

  protected override animateDeath(t: number): void {
    // 爆开：迅速膨胀后缩没
    const s = this.sizeScale * (t < 0.3 ? 1 + t * 1.2 : Math.max(0.01, 1.36 * (1 - (t - 0.3) / 0.7)));
    this.model.scale.setScalar(s);
  }

  protected override cancelAttack(): void {
    // 被眩晕时引信熄灭（地面预警已经播完，不能再无预警爆炸），醒来后重新点燃
    if (this.state === 'fuse') {
      this.setState('chase');
      this.restoreTint();
      this.glowTarget[0] = 0;
    }
  }

  protected override pose(dt: number): void {
    const fusing = this.state === 'fuse';
    const t = fusing ? clamp01(this.stateTime / this.fuseTime) : 0;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const skitter = this.walkPhase * 2.2;
    const amp = Math.min(1, sp / 4);
    for (const l of this.legs) {
      const ph = skitter + l.phase;
      l.pivot.rotation.y = Math.sin(ph) * 0.45 * amp;
      l.pivot.rotation.x = Math.max(0, Math.cos(ph)) * 0.3 * amp;
      if (fusing) l.pivot.rotation.z = -l.side * (0.25 + 0.1 * Math.sin(this.age * 50));
      else l.pivot.rotation.z = 0;
    }
    // 起伏 + 受击后仰 + 引信膨胀抖动
    const bob = Math.abs(Math.sin(skitter)) * 0.04 * amp;
    this.body.position.y = 0.42 + bob;
    this.body.rotation.x = -this.hurtKick * 0.35 + (fusing ? -0.15 : 0);
    const swell = 1 + t * 0.35 + (fusing ? Math.sin(this.age * 60) * 0.03 : 0);
    this.body.scale.set(swell, swell * (1 + t * 0.1), swell);
    this.sac.scale.setScalar(1 + t * 0.5 + 0.06 * Math.sin(this.age * 7));
    if (this.stunTime > 0) this.body.rotation.z = Math.sin(this.age * 8) * 0.25;
    else this.body.rotation.z = Math.sin(this.walkPhase) * 0.05 * amp;
  }
}
