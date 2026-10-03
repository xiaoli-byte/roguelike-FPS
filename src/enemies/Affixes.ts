/**
 * 精英词缀：迅捷 swift / 坚盾 shielded / 爆裂 volatile / 狂暴 frenzied。
 * 由 StandardEnemy.init 在模型与材质就绪后创建控制器；控制器负责数值、视觉与死亡效果。
 * 视觉部件使用缓存几何体 + 实例材质（交给 ownMaterial，随敌人一起释放）。
 */
import * as THREE from 'three';
import type { DamageResult } from '../core/types';
import type { Rng } from '../core/Rng';
import type { StandardEnemy } from './StandardEnemy';
import { Geo, newAdditive, part } from './Models';
import { blastPlayer } from './Hazards';

export type AffixId = 'swift' | 'shielded' | 'volatile' | 'frenzied';
export const AFFIX_IDS: readonly AffixId[] = ['swift', 'shielded', 'volatile', 'frenzied'];
export const AFFIX_NAMES: Record<AffixId, string> = { swift: '迅捷', shielded: '坚盾', volatile: '爆裂', frenzied: '狂暴' };
export const AFFIX_COLORS: Record<AffixId, number> = { swift: 0x49d8ff, shielded: 0x4f8dff, volatile: 0xff6a1f, frenzied: 0xff2a18 };

/** 与敌人自身机制重复的词缀不随机给它 */
const EXCLUDE: Record<string, readonly AffixId[]> = { bomber: ['volatile'] };

export function isAffixId(s: unknown): s is AffixId {
  return typeof s === 'string' && (AFFIX_IDS as readonly string[]).includes(s);
}

export function rollAffix(rng: Rng, defId: string): AffixId {
  const ex = EXCLUDE[defId];
  const pool = ex ? AFFIX_IDS.filter((a) => !ex.includes(a)) : AFFIX_IDS;
  return rng.pick(pool);
}

export interface AffixController {
  update(dt: number): void;
  onHurt(r: DamageResult): void;
  /** 死亡时（非清场） */
  onDeath(r: DamageResult): void;
  dispose(): void;
}

export function createAffix(e: StandardEnemy, id: AffixId): AffixController {
  switch (id) {
    case 'swift': return new SwiftAffix(e);
    case 'shielded': return new ShieldedAffix(e);
    case 'volatile': return new VolatileAffix(e);
    case 'frenzied': return new FrenziedAffix(e);
  }
}

const _v = new THREE.Vector3();

// ───────────── 迅捷：+50% 移速与攻速，青色风旋 ─────────────

class SwiftAffix implements AffixController {
  private readonly swirls: THREE.Mesh[] = [];
  private trailTimer = 0;

  constructor(private readonly e: StandardEnemy) {
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
  }

  onHurt(): void {}
  onDeath(): void {}
  dispose(): void {}
}

// ───────────── 坚盾：额外大量护盾，脱战 4 秒后回盾，蓝色护罩 ─────────────

class ShieldedAffix implements AffixController {
  private readonly bubble: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private flash = 0;
  private regenerating = false;

  constructor(private readonly e: StandardEnemy) {
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

  constructor(private readonly e: StandardEnemy) {
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

  constructor(private readonly e: StandardEnemy) {
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
