/**
 * 安全落脚点与危险区下沉（Unity G/Player/SafeGround.cs 中机关用到的部分）：
 *   · 记录：站在可走的地面上、不在冲刺 / 突进中、脚下与四周 0.5 m 都有静止的地面（不是移动平台），也不在任何已登记的危险区里
 *     （registerHazard：熔岩、流沙、软边界起风线外……）——每 0.2 s 记一次，留最近 8 个，离上一个不到 1.5 m 原地更新；
 *   · sink(spec)：踩进危险区——瞬间扣血 + 闪屏 + 嘶响，锁住身体 sinkTime 秒（期间按 tickTimes 跳伤），托回最近仍安全的点并给 grace 秒无敌；
 *   · recover(spec)：立刻托回（不下沉），先托回再扣血。
 * 伤害走正常的玩家受伤流程，但无视冲刺 / 托回的短无敌；调试无敌（> 5 s）照样生效。
 * 坠落出界（killY / 虚空）仍由网页原有的玩家逻辑管，不在这里（Unity 的 Fall 规格保留给 Recover 用）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { HazardSpec, V3 } from './LavaCore';
import type { ScreenFlash } from './Parts';

const RING = 8;
const DEBUG_INVULN = 5;

export class SafeGround {
  recordInterval = 0.2;
  edgeProbe = 0.5;
  spacing = 1.5;
  /** 本关被托回的次数 */
  recoveries = 0;
  private readonly hazards: ((feet: V3) => boolean)[] = [];
  private readonly ring: THREE.Vector3[] = Array.from({ length: RING }, () => new THREE.Vector3());
  private count = 0;
  private head = 0;
  private readonly origin = new THREE.Vector3();
  private nextRecord = 0;
  private sinkingSpec: HazardSpec | null = null;
  private sinkT = 0;
  private sinkTicks = 0;
  private readonly recovered: ((at: THREE.Vector3) => void)[] = [];

  constructor(private readonly ctx: GameContext, private readonly flash: ScreenFlash) {
    this.origin.copy(ctx.player.position);
  }

  get sinking(): boolean { return this.sinkingSpec !== null; }

  get lastSafe(): THREE.Vector3 {
    return this.count > 0 ? this.ring[(this.head - 1 + RING) % RING] : this.origin;
  }

  /** 登记危险区（脚底 → 是否危险）；返回撤销函数 */
  registerHazard(fn: (feet: V3) => boolean): () => void {
    this.hazards.push(fn);
    return () => {
      const i = this.hazards.indexOf(fn);
      if (i >= 0) this.hazards.splice(i, 1);
    };
  }

  isHazard(feet: V3): boolean {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      try {
        if (this.hazards[i]?.(feet)) return true;
      } catch (err) {
        console.error('[SafeGround] 危险区查询出错', err);
      }
    }
    return false;
  }

  onRecovered(fn: (at: THREE.Vector3) => void): void { this.recovered.push(fn); }

  resetTo(feet: THREE.Vector3): void {
    this.count = this.head = 0;
    this.origin.copy(feet);
  }

  update(dt: number): void {
    const p = this.ctx.player;
    if (!p.alive) {
      this.endSink();
      return;
    }
    if (this.sinkingSpec) {
      this.updateSink(dt);
      return;
    }
    const now = this.ctx.time.now;
    if (now >= this.nextRecord && p.onGround && !p.isDashing && !p.isLunging && this.isSafeSpot(p.position)) {
      this.nextRecord = now + this.recordInterval;
      this.record(p.position);
    }
  }

  private groundAt(x: number, y: number, z: number): number | null {
    // Unity：脚下 0.6 m 往下打 1.4 m、法线朝上（≥ 0.7）的世界层；移动平台（刚体）不算
    const g = this.ctx.world.groundHeight(x, z, y + 0.6);
    if (!(g >= y - 0.8)) return null;
    for (const b of this.ctx.world.query(x, z, x, z)) {
      if (b.tag === 'platform' && Math.abs(b.maxY - g) < 0.05) return null;
    }
    return g;
  }

  private isSafeSpot(feet: THREE.Vector3): boolean {
    if (this.isHazard(feet)) return false;
    if (this.groundAt(feet.x, feet.y, feet.z) === null) return false;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5;
      const x = feet.x + Math.cos(a) * this.edgeProbe, z = feet.z + Math.sin(a) * this.edgeProbe;
      const g = this.groundAt(x, feet.y, z);
      if (g === null || this.isHazard({ x, y: g, z })) return false;
    }
    return true;
  }

  private record(feet: THREE.Vector3): void {
    if (this.count > 0) {
      const last = (this.head - 1 + RING) % RING;
      if (this.ring[last].distanceToSquared(feet) < this.spacing * this.spacing) {
        this.ring[last].copy(feet);
        return;
      }
    }
    this.ring[this.head].copy(feet);
    this.head = (this.head + 1) % RING;
    this.count = Math.min(RING, this.count + 1);
  }

  /** 从新到旧找第一个仍然安全的点；都不安全时退回进场位置 */
  pickRecoveryPoint(): THREE.Vector3 {
    for (let k = 1; k <= this.count; k++) {
      const p = this.ring[(this.head - k + RING * 2) % RING];
      if (!this.isHazard(p) && this.groundAt(p.x, p.y, p.z) !== null) return p;
    }
    return this.origin;
  }

  /** 踩进危险区：瞬间扣血 + 闪屏，锁住身体 sinkTime 秒，然后托回。已经在下沉中时忽略 */
  sink(spec: HazardSpec): boolean {
    const p = this.ctx.player;
    if (this.sinkingSpec || !p.alive) return false;
    this.recoveries++;
    if (spec.flash[3] > 0) this.flash.flash(spec.flash, 0.6);
    if (spec.sound) this.ctx.audio.play(spec.sound as never, { volume: 0.95, pitch: 0.7 });
    this.ctx.fx.shake(0.45, 0.3);
    this.scorch(spec.burst, spec.element);
    if (!p.alive) return true;
    if (!(spec.sinkTime > 0)) {
      this.lift(spec);
      return true;
    }
    this.sinkingSpec = spec;
    this.sinkT = 0;
    this.sinkTicks = 0;
    return true;
  }

  /** 立刻托回安全点（不下沉），先托回再按 spec.burst 扣血 */
  recover(spec: HazardSpec): void {
    if (this.sinkingSpec) this.endSink();
    this.recoveries++;
    this.lift(spec);
    this.scorch(spec.burst, spec.element);
    if (spec.flash[3] > 0) this.flash.flash(spec.flash, 0.45);
  }

  private updateSink(dt: number): void {
    const spec = this.sinkingSpec!;
    const p = this.ctx.player;
    // 下沉期间站着不动（Unity：锁身体、移速归零；视角照常）
    p.velocity.x = 0;
    p.velocity.z = 0;
    this.sinkT += dt;
    while (this.sinkTicks < spec.tickTimes.length && this.sinkT >= spec.tickTimes[this.sinkTicks]) {
      this.sinkTicks++;
      this.scorch(spec.tick, spec.element);
      this.ctx.audio.play('burn_tick', { volume: 0.9, pitch: 0.7 });
      if (!p.alive) {
        this.endSink();
        return;
      }
    }
    if (this.sinkT >= spec.sinkTime) {
      this.endSink();
      this.lift(spec);
    }
  }

  private endSink(): void {
    this.sinkingSpec = null;
  }

  private lift(spec: HazardSpec): void {
    const p = this.ctx.player;
    const to = this.pickRecoveryPoint().clone();
    p.teleport(to.clone().setY(to.y + 0.05));
    p.velocity.set(0, 0, 0);
    p.invulnerableTime = Math.max(p.invulnerableTime, spec.grace);
    this.ctx.audio.play('dash', { volume: 0.5, pitch: 0.8 });
    for (const fn of this.recovered) {
      try { fn(to); } catch (err) { console.error('[SafeGround] 托回回调出错', err); }
    }
  }

  /** 按最大生命比例扣血：无视冲刺 / 托回的短无敌，调试无敌照样生效 */
  private scorch(fraction: number, element: HazardSpec['element']): void {
    const p = this.ctx.player;
    if (!(fraction > 0) || !p.alive) return;
    const saved = p.invulnerableTime;
    if (saved > DEBUG_INVULN) return;
    p.invulnerableTime = 0;
    try {
      this.ctx.combat.damagePlayer(p.maxHp() * fraction, element, null, p.position);
    } finally {
      p.invulnerableTime = Math.max(p.invulnerableTime, saved);
    }
  }
}
