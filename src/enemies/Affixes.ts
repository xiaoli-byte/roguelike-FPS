/**
 * 精英词缀：迅捷 swift / 坚盾 shielded / 爆裂 volatile / 狂暴 frenzied。
 * 由 StandardEnemy.init（第四章由 PlateauFoeAdapter.init）在模型与材质就绪后创建控制器；控制器负责数值、视觉与死亡效果。
 * 控制器只通过 AffixHost 读写那只敌人（Unity EliteHost）：两种身体都能装词缀。
 * 视觉部件使用缓存几何体 + 实例材质（交给 ownMaterial，随敌人一起释放）。
 */
import * as THREE from 'three';
import type { DamageResult } from '../core/types';
import type { Rng } from '../core/Rng';
import type { GameContext, IEnemy } from '../core/types';
import { Geo, newAdditive, part } from './Models';
import { blastPlayer } from './Hazards';
import { attackDirector } from './AttackTokens';
import { EliteTornado, TORNADO, TornadoLook, tornadoColor } from './EliteTornado';
import { spawnSlashArc } from './fx/SlashArc';
import { GroundDecal } from './bosses/Visuals';

export type AffixId = 'swift' | 'shielded' | 'volatile' | 'frenzied';
export const AFFIX_IDS: readonly AffixId[] = ['swift', 'shielded', 'volatile', 'frenzied'];
export const AFFIX_NAMES: Record<AffixId, string> = { swift: '迅捷', shielded: '坚盾', volatile: '爆裂', frenzied: '狂暴' };
export const AFFIX_COLORS: Record<AffixId, number> = { swift: 0x49d8ff, shielded: 0x4f8dff, volatile: 0xff6a1f, frenzied: 0xff2a18 };

export function isAffixId(s: unknown): s is AffixId {
  return typeof s === 'string' && (AFFIX_IDS as readonly string[]).includes(s);
}

/**
 * 随机一个精英词缀；exclude = 与敌人自身机制重复、不随机给它的（定义表的 affixExclusions，同 Unity EnemyDef.affixExclusions）。
 * 全被排除时返回 null（同 Unity EliteAffixes.Roll）
 */
export function rollAffix(rng: Rng, exclude?: readonly string[]): AffixId | null {
  const pool = exclude?.length ? AFFIX_IDS.filter((a) => !exclude.includes(a)) : AFFIX_IDS;
  return pool.length ? rng.pick(pool) : null;
}

/**
 * 词缀装到的那只敌人（Unity EliteHost）：受伤体（生命 / 护盾）、加成倍率（移速 / 攻速 / 伤害）、身体（着色、挂件的父节点）、
 * 设计尺寸（def.radius / height，挂件按它摆，model 的缩放会再乘上去）。StandardEnemy 与第四章的 PlateauFoeAdapter 都满足
 */
export interface AffixHost extends IEnemy {
  readonly ctx: GameContext;
  readonly model: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly sizeScale: number;
  readonly lastHurtTime: number;
  speedMult: number;
  attackRate: number;
  damageMult: number;
  frenzied: boolean;
  affixAttackBusy: boolean;
  tintBody(color: number, intensity: number, persistent?: boolean): void;
  ownMaterial<T extends THREE.Material>(m: T): T;
}

export interface AffixController {
  update(dt: number): void;
  onHurt(r: DamageResult): void;
  /** 死亡时（非清场） */
  onDeath(r: DamageResult): void;
  dispose(): void;
}

export function createAffix(e: AffixHost, id: AffixId): AffixController {
  switch (id) {
    case 'swift': return new SwiftAffix(e);
    case 'shielded': return new ShieldedAffix(e);
    case 'volatile': return new VolatileAffix(e);
    case 'frenzied': return new FrenziedAffix(e);
  }
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ───────────── 迅捷：+50% 移速与攻速，青色风旋；定期蓄风挥出一道直线前行的龙卷（Unity EliteAffix_Swift） ─────────────

/** 迅捷的龙卷（测试 / 冒烟读：蓄风中、放出过几次、最近一道） */
export interface SwiftTornadoState {
  readonly winding: boolean;
  readonly released: number;
  readonly last: EliteTornado | null;
}

export class SwiftAffix implements AffixController, SwiftTornadoState {
  private readonly swirls: THREE.Mesh[] = [];
  private trailTimer = 0;
  /** 龙卷：冷却、蓄风剩余、收招剩余、是否拿着重击名额 */
  private tornadoCd: number;
  private windLeft = 0;
  private recovery = 0;
  private token = false;
  private readonly lockedDir = new THREE.Vector3();
  private readonly windOrigin = new THREE.Vector3();
  private warning: GroundDecal | null = null;
  private charge: TornadoLook | null = null;
  released = 0;
  last: EliteTornado | null = null;

  get winding(): boolean {
    return this.windLeft > 0;
  }

  constructor(private readonly e: AffixHost) {
    this.tornadoCd = e.ctx.rng.range(TORNADO.firstMin, TORNADO.firstMax);
    e.speedMult *= 1.5;
    e.attackRate *= 1.5;
    e.tintBody(0x0b4a5c, 0.55, true);
    const mat = e.ownMaterial(newAdditive(AFFIX_COLORS.swift, 0.75));
    const r = e.def.radius * 1.35;
    for (let i = 0; i < 2; i++) {
      const m = part(e.model, Geo.torus(r, 0.028, 3, 20, Math.PI * 1.1), mat, 0, e.def.height * (0.3 + i * 0.32), 0, Math.PI / 2, 0, i * Math.PI);
      this.swirls.push(m);
    }
  }

  update(dt: number): void {
    this.swirls[0].rotation.z += dt * 7;
    this.swirls[1].rotation.z -= dt * 9;
    const e = this.e;
    this.trailTimer -= dt;
    if (this.trailTimer <= 0 && Math.hypot(e.velocity.x, e.velocity.z) > 3) {
      this.trailTimer = 0.14;
      _v.set(e.position.x, e.position.y + e.height * 0.4, e.position.z);
      e.ctx.fx.burst(_v, AFFIX_COLORS.swift, 2, 0.6, 0.35, 0.06, 0);
    }
    this.tickTornado(dt);
  }

  /** 龙卷（Unity Swift.TickTornado）：收招 → 蓄风 → 冷却 → 找机会（4–24 m、高差 ≤ 4 m、看得见、拿到重击名额） */
  private tickTornado(dt: number): void {
    const e = this.e;
    if (!(dt > 0)) return;
    if (this.recovery > 0) {
      this.recovery -= dt;
      if (this.recovery <= 0) e.affixAttackBusy = false;
    }
    if (this.windLeft > 0) {
      if (this.interrupted()) {
        this.cancelTornado();
        return;
      }
      this.windLeft -= dt;
      const k = 1 - Math.min(1, Math.max(0, this.windLeft / TORNADO.windup));
      if (this.warning) {
        this.warning.time = TORNADO.windup - this.windLeft;
        this.warning.fill = k;
      }
      if (this.charge) {
        this.charge.group.position.copy(this.ground(e.position, _w));
        this.charge.group.scale.setScalar(0.25 + 0.35 * k);
        this.charge.opacity = 0.4 + 0.6 * k;
        this.charge.update(dt, 0.6 + k);
      }
      if (this.windLeft <= 0) this.releaseTornado();
      return;
    }
    if (this.recovery > 0) return;
    this.tornadoCd -= dt;
    if (this.tornadoCd > 0 || this.interrupted() || attackDirector.holding(e.id)) return;
    const ctx = e.ctx;
    const pp = ctx.player.position;
    const ox = pp.x - e.position.x, oz = pp.z - e.position.z, oy = pp.y - e.position.y;
    const distance = Math.hypot(ox, oz);
    if (distance < TORNADO.minDistance || distance > TORNADO.maxDistance || Math.abs(oy) > TORNADO.maxRise) return;
    e.getBodyCenter(_v);
    _w.set(pp.x, pp.y + 1.2, pp.z);
    if (ctx.world.segmentBlocked(_v, _w)) return;
    if (!attackDirector.tryAcquire(e.id, 'heavy', ctx.time.now, TORNADO.windup + 0.4, ctx.run.chapter)) return;

    this.token = true;
    e.affixAttackBusy = true;
    this.lockedDir.set(ox / distance, 0, oz / distance);
    this.ground(e.position, this.windOrigin);
    this.windLeft = TORNADO.windup;
    const yaw = Math.atan2(this.lockedDir.x, this.lockedDir.z);
    this.warning = GroundDecal.acquire(ctx.stageGroup, AFFIX_COLORS.swift)
      .rect(this.windOrigin.x, this.windOrigin.y, this.windOrigin.z, yaw, TORNADO.range, TORNADO.radius);
    this.warning.fill = 0;
    this.charge = new TornadoLook(tornadoColor(ctx.run.chapter), 4.6, 1.2);
    this.charge.group.position.copy(this.windOrigin);
    this.charge.group.scale.setScalar(0.25);
    ctx.stageGroup.add(this.charge.group);
    ctx.audio.play('telegraph', { position: e.position, volume: 0.8 });
    ctx.audio.play('enemy_charge', { position: e.position, volume: 0.65, pitch: 1.25 });
  }

  /** 蓄风被打断：死了、被灵宠嘲讽、眩晕、玩家阵亡（Unity Swift.Interrupted） */
  private interrupted(): boolean {
    const e = this.e;
    return !e.alive || !!e.taunted || e.stunTime > 0 || !e.ctx.player.alive;
  }

  /** 脚下地面（往下 12 m 找，抬 4 cm）；没有地面用原高度 */
  private ground(at: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const gy = this.e.ctx.world.groundHeight(at.x, at.z, at.y + 2);
    out.set(at.x, Number.isFinite(gy) && gy > at.y - 10 ? gy + 0.04 : at.y, at.z);
    return out;
  }

  private releaseTornado(): void {
    const e = this.e;
    const ctx = e.ctx;
    this.warning?.release();
    this.warning = null;
    this.charge?.dispose();
    this.charge = null;
    const d = this.lockedDir;
    const at = _v.copy(this.windOrigin).addScaledVector(d, e.radius + 0.65);
    this.last = EliteTornado.spawn(ctx, e, at, d, TORNADO.baseDamage * e.damageMult);
    this.released++;
    const yaw = Math.atan2(d.x, d.z);
    e.getBodyCenter(_w).addScaledVector(d, 0.45);
    spawnSlashArc(ctx, { center: _w, yaw, radius: 2.15 * e.sizeScale, arc: 1.55, width: 0.62 * e.sizeScale, duration: 0.28, color: 0xc6e7dc });
    _w.copy(at).y += 0.5;
    ctx.fx.burst(_w, AFFIX_COLORS.swift, 8, 4, 0.35, 0.12, 0);
    ctx.fx.burst(at, tornadoColor(ctx.run.chapter), 12, 3, 0.6, 0.18, -1);
    ctx.fx.shake(0.22, 0.25);
    ctx.audio.play('enemy_melee', { position: e.position, volume: 0.9 });
    ctx.audio.play('boss_slam', { position: at, volume: 0.45, pitch: 1.35 });
    if (this.token) {
      attackDirector.release(e.id);
      this.token = false;
    }
    this.tornadoCd = ctx.rng.range(TORNADO.cooldownMin, TORNADO.cooldownMax);
    this.recovery = TORNADO.recovery;
  }

  private cancelTornado(): void {
    const e = this.e;
    this.warning?.release();
    this.warning = null;
    this.charge?.dispose();
    this.charge = null;
    this.windLeft = this.recovery = 0;
    e.affixAttackBusy = false;
    if (this.token) {
      attackDirector.release(e.id);
      this.token = false;
    }
  }

  onHurt(): void {}

  onDeath(): void {
    this.cancelTornado();
  }

  dispose(): void {
    this.cancelTornado();
  }
}

// ───────────── 坚盾：额外大量护盾，脱战 4 秒后回盾，蓝色护罩 ─────────────

class ShieldedAffix implements AffixController {
  private readonly bubble: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private flash = 0;
  private regenerating = false;

  constructor(private readonly e: AffixHost) {
    const extra = Math.round(e.maxHp * 0.6);
    e.maxShield += extra;
    e.shield += extra;
    e.tintBody(0x0a2a66, 0.35, true);
    this.mat = e.ownMaterial(newAdditive(AFFIX_COLORS.shielded, 0.2));
    const r = Math.max(e.def.radius * 1.7, e.def.height * 0.62);
    this.bubble = part(e.model, Geo.ico(1, 1), this.mat, 0, e.def.height * 0.5, 0);
    this.bubble.scale.setScalar(r);
  }

  update(dt: number): void {
    const e = this.e;
    const now = e.ctx.time.now;
    if (e.shield < e.maxShield && now - e.lastHurtTime > 4) {
      if (!this.regenerating) {
        this.regenerating = true;
        e.getBodyCenter(_v);
        e.ctx.fx.burst(_v, AFFIX_COLORS.shielded, 10, 2.5, 0.5, 0.08, 0);
      }
      e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.22 * dt);
    } else {
      this.regenerating = false;
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    const frac = e.maxShield > 0 ? e.shield / e.maxShield : 0;
    this.bubble.visible = frac > 0.01 || this.flash > 0.01;
    this.mat.opacity = 0.05 + frac * 0.16 + this.flash * 0.45 + (this.regenerating ? 0.06 * (1 + Math.sin(now * 12)) : 0);
    this.bubble.rotation.y += dt * 0.6;
  }

  onHurt(r: DamageResult): void {
    if (r.layer === 'shield') this.flash = 1;
    if (r.shieldBroken) {
      this.e.getBodyCenter(_v);
      this.e.ctx.fx.burst(_v, AFFIX_COLORS.shielded, 22, 5, 0.6, 0.1, 6);
    }
  }

  onDeath(): void {}
  dispose(): void {}
}

// ───────────── 爆裂：环绕余烬；死亡后 1 秒（地面预警）爆炸伤害玩家 ─────────────

const VOLATILE_RADIUS = 4.5;
const VOLATILE_FUSE = 1.0;
const VOLATILE_DAMAGE = 26;

class VolatileAffix implements AffixController {
  private readonly embers: THREE.Mesh[] = [];
  private t = Math.random() * 10;

  constructor(private readonly e: AffixHost) {
    e.tintBody(0x5a1a04, 0.5, true);
    const mat = e.ownMaterial(newAdditive(AFFIX_COLORS.volatile, 1));
    for (let i = 0; i < 3; i++) this.embers.push(part(e.model, Geo.octa(0.09), mat));
    this.update(0);
  }

  update(dt: number): void {
    this.t += dt;
    const e = this.e;
    const r = e.def.radius * 1.35;
    const h = e.def.height * 0.6;
    for (let i = 0; i < this.embers.length; i++) {
      const a = this.t * 2.6 + (i * Math.PI * 2) / 3;
      const m = this.embers[i];
      m.position.set(Math.cos(a) * r, h + Math.sin(this.t * 3 + i * 2) * 0.18, Math.sin(a) * r);
      m.rotation.y += dt * 5;
    }
    e.tintBody(0x7a2406, 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * 6)));
  }

  onHurt(): void {}

  onDeath(): void {
    const e = this.e;
    const ctx = e.ctx;
    // 预警圈画在死亡位置正下方的地面 / 台面上（飞行单位死在半空时也一样）
    const gy = ctx.world.groundHeight(e.position.x, e.position.z, e.position.y + 0.1);
    const floor = ctx.stage.arena?.floorY ?? 0;
    const y = Number.isFinite(gy) ? gy : Math.min(e.position.y, floor);
    const c = new THREE.Vector3(e.position.x, y + 0.05, e.position.z);
    const damage = VOLATILE_DAMAGE * e.damageMult;
    ctx.fx.groundWarning(c, VOLATILE_RADIUS, VOLATILE_FUSE, AFFIX_COLORS.volatile);
    ctx.audio.play('telegraph', { position: c, volume: 0.8 });
    ctx.tasks.delay(VOLATILE_FUSE, () => {
      c.y += 0.8;
      ctx.fx.explosion(c, VOLATILE_RADIUS, AFFIX_COLORS.volatile);
      ctx.audio.play('explosion', { position: c });
      blastPlayer(ctx, c, VOLATILE_RADIUS, damage, 'fire', e, 0.5, 0.7);
    });
  }

  dispose(): void {}
}

// ───────────── 狂暴：生命低于 40% 时狂暴（移速 ×1.35、攻速 ×1.6、伤害 ×1.2），头顶血焰 ─────────────

class FrenziedAffix implements AffixController {
  private readonly aura: THREE.Mesh;
  private readonly auraMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor(private readonly e: AffixHost) {
    e.tintBody(0x2a0404, 0.3, true);
    this.auraMat = e.ownMaterial(newAdditive(AFFIX_COLORS.frenzied, 0.55));
    this.aura = part(e.model, Geo.cone(e.def.radius * 0.9, e.def.height * 0.55, 6), this.auraMat, 0, e.def.height * 0.72, 0);
    this.aura.visible = false;
  }

  update(dt: number): void {
    const e = this.e;
    this.t += dt;
    if (!e.frenzied) {
      if (e.alive && e.hp <= e.maxHp * 0.4) this.trigger();
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 11);
    e.tintBody(0xff2a10, 0.55 + pulse * 0.45);
    this.aura.rotation.y += dt * 4;
    this.aura.scale.set(1 + pulse * 0.12, 1 + Math.sin(this.t * 17) * 0.15, 1 + pulse * 0.12);
    this.auraMat.opacity = 0.35 + pulse * 0.3;
  }

  private trigger(): void {
    const e = this.e;
    e.frenzied = true;
    e.speedMult *= 1.35;
    e.attackRate *= 1.6;
    e.damageMult *= 1.2;
    e.tintBody(0xff2a10, 0.8, true);
    this.aura.visible = true;
    e.getBodyCenter(_v);
    e.ctx.fx.burst(_v, AFFIX_COLORS.frenzied, 26, 5, 0.6, 0.12, 2);
    e.ctx.fx.ring(e.position.clone(), 3.2, AFFIX_COLORS.frenzied, 0.5);
    e.ctx.audio.play('enemy_alert', { position: e.position, volume: 1, pitch: 0.8 });
  }

  onHurt(): void {}
  onDeath(): void {}
  dispose(): void {}
}
