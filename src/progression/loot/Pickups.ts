import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { TAU } from '../../core/math';
import { makeAmmoModel, makeCoinModel, makeHealthModel } from './assets';
import { groundAt, stepToss } from './physics';
import type { TossState } from './physics';

/**
 * 可拾取物：金币 / 弹药 / 生命。
 * 抛出 → 重力与落地弹跳 → 浮动旋转；进入拾取范围后被吸向玩家，接触即拾取。
 * 生命 / 弹药只在玩家需要时才会被吸取。对象池复用模型。
 */

export type PickupKind = 'coin' | 'ammo' | 'health';

const MAX_PICKUPS = 240;
const COLLECT_DIST = 0.55;
const REST_HEIGHT: Record<PickupKind, number> = { coin: 0.22, ammo: 0.16, health: 0.3 };
/** 清关之后才掉出的金币：落地展示一下再自动吸取 */
const VACUUM_LATE_DELAY = 1.1;
const SPIN: Record<PickupKind, number> = { coin: 2.6, ammo: 1.2, health: 1.6 };

interface Pickup extends TossState {
  kind: PickupKind;
  obj: THREE.Object3D;
  /** 金币数 / 弹药比例 / 回复量（<=0 表示拾取时按最大生命 15%） */
  value: number;
  age: number;
  settled: boolean;
  magnet: boolean;
  magnetSpeed: number;
  phase: number;
  spinDir: number;
  /** 到达该时间后无视范围自动吸取（清关后吸金币） */
  vacuumAt: number;
}

const _target = new THREE.Vector3();
const _to = new THREE.Vector3();

export class PickupManager {
  private list: Pickup[] = [];
  private pool: Record<PickupKind, Pickup[]> = { coin: [], ammo: [], health: [] };
  private lastCoinSfx = -Infinity;
  private coinCombo = 0;

  constructor(private readonly ctx: GameContext, private readonly group: THREE.Group) {}

  get count(): number {
    return this.list.length;
  }

  /** 生成一个拾取物；数量达到上限返回 false */
  spawn(kind: PickupKind, pos: THREE.Vector3, value: number, burst = 1): boolean {
    if (this.list.length >= MAX_PICKUPS) return false;
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return false;
    if (!Number.isFinite(value)) value = 0;
    const p = this.pool[kind].pop() ?? this.create(kind);
    // 面额越大的铜钱越大，静止高度随之抬高，避免竖立时插进地面
    const scale = kind === 'coin' ? 0.85 + Math.min(0.9, (value - 1) * 0.07) : 1;
    const rest = kind === 'coin' ? 0.06 + 0.17 * scale : REST_HEIGHT[kind];
    p.rest = rest;
    p.pos.copy(pos);
    const g = groundAt(this.ctx, pos.x, pos.z, pos.y + 0.5);
    if (p.pos.y < g + rest) p.pos.y = g + rest;

    const a = Math.random() * TAU;
    const h = (1.1 + Math.random() * 2.3) * burst;
    p.vel.set(Math.cos(a) * h, 3.6 + Math.random() * 2.4 * Math.min(1.6, burst), Math.sin(a) * h);
    p.value = value;
    p.age = 0;
    p.settled = false;
    p.magnet = false;
    p.magnetSpeed = 0;
    p.phase = Math.random() * TAU;
    p.spinDir = Math.random() < 0.5 ? -1 : 1;
    // 已清关（清关后的宝箱金币、宝藏 / 商店关）掉出的金币落地后自动吸取，免得漏捡
    p.vacuumAt = kind === 'coin' && this.ctx.stage.cleared ? this.ctx.time.now + VACUUM_LATE_DELAY + Math.random() * 0.4 : Infinity;

    p.obj.position.copy(p.pos);
    p.obj.rotation.set(0, Math.random() * TAU, 0);
    p.obj.scale.setScalar(scale);
    this.group.add(p.obj);
    this.list.push(p);
    return true;
  }

  /** 金币拆成多枚抛出；超过数量上限的部分直接入账 */
  dropCoins(pos: THREE.Vector3, amount: number, burst = 1): void {
    const total = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    if (total <= 0) return;
    const maxPieces = total >= 60 ? 22 : 14;
    const pieces = Math.max(1, Math.min(maxPieces, Math.ceil(total / 3)));
    const base = Math.floor(total / pieces);
    const rem = total - base * pieces;
    let overflow = 0;
    for (let i = 0; i < pieces; i++) {
      const v = base + (i < rem ? 1 : 0);
      if (v <= 0) continue;
      if (!this.spawn('coin', pos, v, burst)) overflow += v;
    }
    if (overflow > 0) this.creditCoins(overflow);
  }

  /** 清关后把场上掉落物全部吸向玩家（弹药 / 生命仍只在需要时才被吸取） */
  vacuumCoins(delay: number): void {
    const now = this.ctx.time.now;
    for (const p of this.list) {
      p.vacuumAt = now + delay + Math.random() * 0.4;
    }
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    const ctx = this.ctx;
    const player = ctx.player;
    const now = ctx.time.now;
    const alive = player.alive;
    const radius = Math.max(0.5, player.stats.get('pickupRadius'));
    const r2 = radius * radius;
    _target.set(player.position.x, player.position.y + 0.9, player.position.z);
    const wantHealth = alive && player.hp < player.maxHp() - 0.01;
    const wantAmmo = alive && this.needsAmmo();
    const floorY = ctx.stage.arena?.floorY ?? 0;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const wants = alive && (p.kind === 'coin' || (p.kind === 'health' ? wantHealth : wantAmmo));

      if (p.magnet && !wants) {
        // 吸取途中不再需要（例如已回满血）：落回地面
        p.magnet = false;
        p.settled = false;
        p.vel.set(0, 0, 0);
      }
      if (!p.magnet && wants && p.age > 0.3 && (p.pos.distanceToSquared(_target) < r2 || now >= p.vacuumAt)) {
        p.magnet = true;
        p.magnetSpeed = 3;
      }

      if (p.magnet) {
        _to.subVectors(_target, p.pos);
        const d = _to.length();
        p.magnetSpeed = Math.min(32, p.magnetSpeed + 48 * dt);
        const step = p.magnetSpeed * dt;
        if (d <= COLLECT_DIST + step) {
          this.collect(p);
          this.release(i);
          continue;
        }
        p.pos.addScaledVector(_to, step / d);
        p.obj.position.copy(p.pos);
        p.obj.rotation.y += dt * 10;
        continue;
      }

      if (!p.settled && !Number.isNaN(stepToss(ctx, p, dt))) p.settled = true;

      if (p.pos.y < floorY - 6) {
        // 掉出世界：金币直接入账，其余丢弃
        if (p.kind === 'coin') this.creditCoins(p.value);
        this.release(i);
        continue;
      }

      if (p.settled) {
        p.obj.position.set(p.pos.x, p.pos.y + 0.06 + Math.sin(now * 2.6 + p.phase) * 0.06, p.pos.z);
        p.obj.rotation.y += SPIN[p.kind] * p.spinDir * dt;
      } else {
        p.obj.position.copy(p.pos);
        p.obj.rotation.y += SPIN[p.kind] * 3 * p.spinDir * dt;
      }
    }
  }

  clear(): void {
    for (const p of this.list) {
      p.obj.removeFromParent();
      this.pool[p.kind].push(p);
    }
    this.list.length = 0;
  }

  /** 金币入账（改 run.coins 并广播） */
  creditCoins(v: number): void {
    const ctx = this.ctx;
    const amount = Math.round(v);
    if (amount <= 0) return;
    ctx.run.coins += amount;
    ctx.events.emit('coins:changed', { coins: ctx.run.coins, delta: amount });
    ctx.events.emit('pickup', { kind: 'coin', amount });
    const now = ctx.time.now;
    if (now - this.lastCoinSfx > 0.05) {
      this.coinCombo = now - this.lastCoinSfx < 0.45 ? Math.min(12, this.coinCombo + 1) : 0;
      this.lastCoinSfx = now;
      ctx.audio.play('pickup_coin', { volume: 0.5, pitch: 1 + this.coinCombo * 0.04 });
    }
  }

  // ───────────── 内部 ─────────────

  private collect(p: Pickup): void {
    const ctx = this.ctx;
    switch (p.kind) {
      case 'coin':
        this.creditCoins(p.value);
        break;
      case 'ammo': {
        const frac = p.value > 0 ? p.value : 0.25;
        ctx.weapons.addAmmoFraction(frac);
        ctx.events.emit('pickup', { kind: 'ammo', amount: frac });
        ctx.audio.play('pickup_ammo', { volume: 0.8 });
        ctx.fx.burst(p.pos, 0xd9a441, 8, 2, 0.35, 0.06, 2);
        break;
      }
      case 'health': {
        const amount = p.value > 0 ? p.value : ctx.player.maxHp() * 0.15;
        const healed = ctx.player.heal(amount);
        ctx.events.emit('pickup', { kind: 'health', amount: healed });
        ctx.audio.play('pickup_health', { volume: 0.85 });
        ctx.fx.burst(p.pos, 0xff5a6a, 10, 2.2, 0.4, 0.07, -1);
        break;
      }
    }
  }

  /** 交换删除（从尾部遍历时安全） */
  private release(i: number): void {
    const p = this.list[i];
    p.obj.removeFromParent();
    this.pool[p.kind].push(p);
    const last = this.list.length - 1;
    if (i !== last) this.list[i] = this.list[last];
    this.list.pop();
  }

  private needsAmmo(): boolean {
    const w = this.ctx.weapons;
    for (const inst of w.slots) {
      if (inst && inst.reserve < w.reserveCapacity(inst)) return true;
    }
    return false;
  }

  private create(kind: PickupKind): Pickup {
    const obj = kind === 'coin' ? makeCoinModel() : kind === 'ammo' ? makeAmmoModel() : makeHealthModel();
    return {
      kind, obj,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rest: REST_HEIGHT[kind],
      value: 0, age: 0, settled: false, magnet: false, magnetSpeed: 0, phase: 0, spinDir: 1, vacuumAt: Infinity,
    };
  }
}
