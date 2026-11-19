/**
 * 龙卷风柱（Unity Feilian/FeilianTornado.cs；飞廉二阶段起；chuanzang-combat-v1.md 4.2 tornado）：从风涡落下、3.5 m/s 追人，碰到卷起来甩出去（8，网页值）；寿命 9 s。
 * 火龙卷：被火打中（燃爆雷 / 火元素的伤害打在柱身上）→ 变橙 8 s，不再追人，被风吸向飞廉（6 m/s），经过它 3.5 m 内每 0.5 s 烧它 40（换算）并挂灼烧。
 * 柱身：一个登记在敌人管理器里的「柱子」（boss_feilian_tornado：不掉落、不给奖励、血量打不掉、不是首领），子弹 / 爆炸打在柱身上就能点火；
 * 外观是 LordFx.Spiral。生命周期由飞廉管（散掉 = 静默移除）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../../core/types';
import { EnemyBase } from '../../EnemyBase';
import { FeilianPalette, FeilianTornadoBody } from './FeilianPlans';
import { LordFx, Spiral } from './LordFx';

export const FEILIAN_TORNADO_DEF: EnemyDef = {
  id: 'boss_feilian_tornado',
  name: '龙卷风柱',
  hp: 1e6,
  speed: 0,
  radius: 1.4,
  height: FeilianTornadoBody.Height * 0.7,
  flying: true,
  damage: 0,
  coins: [0, 0],
  essence: 0,
  headY: FeilianTornadoBody.Height * 0.35,
  headRadius: 0.01,
  knockbackResist: 1,
  color: FeilianPalette.Wind,
};

/** 飞廉这边要的接口（Feilian.ts 实现） */
export interface TornadoOwner {
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  readonly ctx: GameContext;
  readonly webScale: number;
  readonly playerDashing: boolean;
  readonly fdef: { tornadoSpeed: number; fireLife: number; fireSpeed: number; fireTick: number; fireDamage: number; fireRadius: number; damage: number };
  groundAt(p: THREE.Vector3): number;
  clampToArena(v: THREE.Vector3, margin: number): THREE.Vector3;
  moveDamage(mult: number): number;
  hurtFromHazard(damage: number, from: THREE.Vector3): number;
  pushPlayer(impulse: THREE.Vector3): void;
  burnSelf(damage: number, from: THREE.Vector3): void;
  tell(key: string, text: string, color: number, cooldown?: number, seconds?: number): void;
  onTornadoIgnited(): void;
  forgetTornado(t: FeilianTornado): void;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class FeilianTornado extends EnemyBase {
  owner: TornadoOwner | null = null;
  life = 9;
  fireLeft = 0;
  burnHits = 0;
  playerHits = 0;
  private tick = 0;
  private look: Spiral | null = null;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FEILIAN_TORNADO_DEF, opts);
    this.spawnDuration = 0.3;
    this.deathDuration = 0.5;
    this.flyTargetY = opts.position.y;
  }

  get burning(): boolean {
    return this.fireLeft > 0;
  }

  protected override buildModel(): THREE.Object3D {
    const g = new THREE.Group();
    this.look = new Spiral(FeilianPalette.Wind, FeilianTornadoBody.Radius * 0.55, FeilianTornadoBody.Radius * 1.9, FeilianTornadoBody.Height, 280, 4, 4.5, 0.1);
    g.add(this.look.group);
    return g;
  }

  override init(): void {
    super.init();
    this.model.scale.setScalar(1);
    LordFx.snowCrown(this.ctx, this.position, 1.2);
  }

  /** 柱身挨打：血量回满；火元素就点着 */
  override onDamaged(result: DamageResult): void {
    super.onDamaged(result);
    this.hp = this.maxHp;
    const el = result.request.element;
    if (el === 'fire' || result.request.tags?.includes('fire')) this.ignite();
  }

  /** 点着：变火龙卷（已经在烧就续满） */
  ignite(): void {
    const o = this.owner;
    if (!o || !o.alive || !this.alive) return;
    const first = this.fireLeft <= 0;
    this.fireLeft = o.fdef.fireLife;
    this.life = Math.max(this.life, this.fireLeft);
    this.look?.setFire(true, FeilianPalette.Fire);
    if (!first) return;
    this.ctx.fx.explosion(_a.copy(this.position).setY(this.position.y + 3), 2, FeilianPalette.Fire);
    o.tell('feilian_fire', '火龙卷！风把它吸回飞廉那里', FeilianPalette.Fire, 8, 2);
    o.onTornadoIgnited();
  }

  /** 立刻散掉（seconds 秒渐隐） */
  dissipate(seconds = 0.5): void {
    this.life = Math.min(this.life, seconds);
  }

  protected override think(dt: number): void {
    this.stopMoving();
    this.velocity.set(0, 0, 0);
    this.life -= dt;
    this.tick -= dt;
    const o = this.owner;
    if (!o || !o.alive || this.life <= 0) {
      this.vanish();
      return;
    }
    const d = o.fdef;
    let target: THREE.Vector3, speed: number;
    if (this.fireLeft > 0) {
      this.fireLeft -= dt;
      target = o.position;
      speed = d.fireSpeed;
      if (this.fireLeft <= 0) this.look?.setFire(false);
    } else {
      target = this.ctx.player.position;
      speed = d.tornadoSpeed;
    }
    const p = _a.copy(this.position);
    const tx = target.x - p.x, tz = target.z - p.z;
    const dist = Math.hypot(tx, tz);
    if (dist > 0.05) {
      const step = Math.min(dist, speed * dt);
      p.x += tx / dist * step;
      p.z += tz / dist * step;
    }
    o.clampToArena(p, 1);
    p.y = o.groundAt(p);
    this.position.copy(p);
    this.flyTargetY = p.y;
    if (this.life < 0.5) this.look?.setAlpha(this.life / 0.5);
    if (this.tick > 0) return;
    if (this.fireLeft > 0) {
      // 火龙卷烧飞廉
      if (Math.hypot(o.position.x - p.x, o.position.z - p.z) < d.fireRadius) {
        this.tick = d.fireTick;
        this.burnHits++;
        o.burnSelf(d.fireDamage * o.webScale, p);
      }
      return;
    }
    // 卷到玩家：甩出去
    const pl = this.ctx.player;
    if (!pl.alive || o.playerDashing) return;
    const fx = pl.position.x - p.x, fz = pl.position.z - p.z;
    if (Math.hypot(fx, fz) > FeilianTornadoBody.HitRadius || pl.position.y > p.y + FeilianTornadoBody.Height * 0.6) return;
    this.tick = FeilianTornadoBody.HitTick;
    const dmg = o.moveDamage(FeilianTornadoBody.WebDamage / Math.max(1, d.damage));
    if (o.hurtFromHazard(dmg, p) > 0) this.playerHits++;
    // 侧向甩：Cross(up, toPlayer)
    const len = Math.hypot(fx, fz) || 1;
    _b.set(fz / len * 5 + fx / len * 2, 7, -fx / len * 5 + fz / len * 2);
    o.pushPlayer(_b);
  }

  override update(dt: number): void {
    super.update(dt);
    this.look?.update(dt);
  }

  /** 静默移除（不算击杀、不掉落） */
  vanish(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.look?.fadeOut(0.5);
    this.owner?.forgetTornado(this);
  }

  protected override animateDeath(t: number): void {
    this.look?.setAlpha(1 - t);
  }

  protected override onDispose(): void {
    this.look?.dispose();
    this.look = null;
    this.owner?.forgetTornado(this);
  }
}
