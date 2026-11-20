/**
 * 坠落回收（Unity Player/SafeGround.cs 的玩家部分：安全落脚点 + Recover(HazardSpec.Fall)）：
 *   · 记录：站在地面上、不在冲刺 / 突进中、脚下与四周 0.5 m 都有静止地面（不是移动平台）——每 0.2 s 记一次，留最近 8 个，离上一个不到 1.5 m 原地更新；
 *   · 出界：低于出界线（关卡的 killY，与「记录过的最低安全点以下 40 m」取更低者），或高速下坠（< −20 m/s）且脚下 400 m 内什么都没有（掉进虚空，
 *     每 0.1 s 查一次；只在 Unity 图上查——老竞技场有的地方没有地面碰撞盒）→ 托回最近的安全点，扣 10% 最大生命（先托回再扣：
 *     真被扣死也死在安全点上），1 s 无敌，闪屏、托回声；
 *   · Unity 图上有地图机关时（world/mechanisms 的 SafeGround，熔岩用的那一份，带危险区登记）直接交给它托回（同一套安全点环）；
 *     没有时用这里自己的环。
 * 坐标 / 速度变成 NaN 时同样托回（速度清零）。
 */
import * as THREE from 'three';
import type { GameContext, IPlayer } from '../core/types';

/** Unity HazardSpec.Fall：立刻托回，扣 10% 最大生命，1 s 无敌 */
export const FALL_SPEC = {
  burst: 0.1, tick: 0, tickTimes: [] as number[], sinkTime: 0, grace: 1, element: 'none' as const,
  flash: [0.05, 0.04, 0.04, 0.7] as [number, number, number, number], sound: 'land',
};

export const SAFE = {
  RecordInterval: 0.2,
  EdgeProbe: 0.5,
  Spacing: 1.5,
  Ring: 8,
  /** 超过这个时长的无敌视为调试无敌：坠落不扣血 */
  DebugInvuln: 5,
  /** 高速下坠（m/s）时才检查脚下是不是虚空、往下查多远 */
  AbyssFallSpeed: 20,
  AbyssProbe: 400,
  AbyssCheckInterval: 0.1,
  /** 出界线至少在最低安全点以下多少米 */
  BelowSafe: 40,
} as const;

/** 机关系统的安全落脚点（world/mechanisms/SafeGround）：有它时由它托回 */
export interface SafeGroundLike {
  recover(spec: typeof FALL_SPEC): void;
}

/** UnitySceneView 建好地图机关后挂上、卸载时摘掉 */
export const fallRecoveryHooks = { safe: null as SafeGroundLike | null };

/** 出界线：killY 与「最低安全点以下 40 m」取更低者（Unity SafeGround.KillLine） */
export function killLine(killY: number, minSafeY: number): number {
  return Math.min(killY, minSafeY - SAFE.BelowSafe);
}

type Player = Pick<IPlayer, 'position' | 'velocity' | 'alive' | 'onGround' | 'isDashing' | 'isLunging' | 'invulnerableTime' | 'maxHp' | 'teleport'>;

export class FallRecovery {
  private readonly ring: THREE.Vector3[] = Array.from({ length: SAFE.Ring }, () => new THREE.Vector3());
  private count = 0;
  private head = 0;
  private readonly origin = new THREE.Vector3();
  private minSafeY = Infinity;
  private nextRecord = 0;
  private nextAbyss = 0;
  /** 本关被托回的次数（调试 / 测试） */
  recoveries = 0;

  constructor(private readonly ctx: GameContext, private readonly player: Player) {}

  /** 出生 / 换关 / 传送：清掉旧的记录，以 feet 为进场位置 */
  resetTo(feet: THREE.Vector3): void {
    this.count = this.head = 0;
    this.origin.copy(feet);
    this.minSafeY = feet.y;
  }

  get lastSafe(): THREE.Vector3 {
    return this.count > 0 ? this.ring[(this.head - 1 + SAFE.Ring) % SAFE.Ring] : this.origin;
  }

  /** 每帧（运动之后）：记安全点、查出界；出界时托回并返回 true */
  update(): boolean {
    const p = this.player;
    if (!p.alive) return false;
    const pos = p.position;
    const v = p.velocity;
    if (!Number.isFinite(v.x + v.y + v.z)) v.set(0, 0, 0);
    const arena = this.ctx.stage?.arena;
    const floorY = arena?.floorY ?? 0;
    const line = killLine(arena?.killY ?? floorY - 25, this.minSafeY);
    if (!Number.isFinite(pos.x + pos.y + pos.z) || pos.y < line || (arena?.killY !== undefined && this.fallingIntoVoid())) {
      this.recover();
      return true;
    }
    const now = this.ctx.time.now;
    if (now >= this.nextRecord && p.onGround && !p.isDashing && !p.isLunging && this.isSafeSpot(pos)) {
      this.nextRecord = now + SAFE.RecordInterval;
      this.record(pos);
    }
    return false;
  }

  private fallingIntoVoid(): boolean {
    const p = this.player;
    const now = this.ctx.time.now;
    if (p.velocity.y > -SAFE.AbyssFallSpeed || now < this.nextAbyss) return false;
    this.nextAbyss = now + SAFE.AbyssCheckInterval;
    const pos = p.position;
    const g = this.ctx.world.groundHeight(pos.x, pos.z, pos.y + 0.5);
    return !(g > pos.y + 0.5 - SAFE.AbyssProbe);
  }

  /** 脚下 0.6 m 往下 1.4 m 有地面；移动平台不算 */
  private groundAt(x: number, y: number, z: number): number | null {
    const g = this.ctx.world.groundHeight(x, z, y + 0.6);
    if (!(g >= y - 0.8)) return null;
    for (const b of this.ctx.world.query?.(x, z, x, z) ?? []) {
      if ((b as { tag?: string }).tag === 'platform' && Math.abs((b as { maxY: number }).maxY - g) < 0.05) return null;
    }
    return g;
  }

  private isSafeSpot(feet: THREE.Vector3): boolean {
    if (this.groundAt(feet.x, feet.y, feet.z) === null) return false;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5;
      if (this.groundAt(feet.x + Math.cos(a) * SAFE.EdgeProbe, feet.y, feet.z + Math.sin(a) * SAFE.EdgeProbe) === null) return false;
    }
    return true;
  }

  private record(feet: THREE.Vector3): void {
    this.minSafeY = Math.min(this.minSafeY, feet.y);
    if (this.count > 0) {
      const last = (this.head - 1 + SAFE.Ring) % SAFE.Ring;
      if (this.ring[last].distanceToSquared(feet) < SAFE.Spacing * SAFE.Spacing) {
        this.ring[last].copy(feet);
        return;
      }
    }
    this.ring[this.head].copy(feet);
    this.head = (this.head + 1) % SAFE.Ring;
    this.count = Math.min(SAFE.Ring, this.count + 1);
  }

  /** 从新到旧找第一个仍有地面的点；都没有时退回进场位置 */
  pickRecoveryPoint(): THREE.Vector3 {
    for (let k = 1; k <= this.count; k++) {
      const p = this.ring[(this.head - k + SAFE.Ring * 2) % SAFE.Ring];
      if (this.groundAt(p.x, p.y, p.z) !== null) return p;
    }
    return this.origin;
  }

  /** 掉出世界：托回安全点，按 Fall 规格扣血 */
  recover(): void {
    this.recoveries++;
    const hook = fallRecoveryHooks.safe;
    if (hook) {
      try {
        hook.recover(FALL_SPEC);
        return;
      } catch (err) {
        console.error('[FallRecovery] 机关的安全落脚点托回出错，改用玩家自己的', err);
      }
    }
    const ctx = this.ctx;
    const p = this.player;
    const to = this.pickRecoveryPoint().clone();
    if (!Number.isFinite(to.x + to.y + to.z)) to.copy(ctx.stage?.arena?.playerSpawn ?? new THREE.Vector3(0, 1, 0));
    p.teleport(to.setY(to.y + 0.05));
    p.velocity.set(0, 0, 0);
    p.invulnerableTime = Math.max(p.invulnerableTime, FALL_SPEC.grace);
    ctx.audio.play('dash', { volume: 0.5, pitch: 0.8 });
    // 先托回再扣血：真被扣死也死在安全点上；无视托回的短无敌，调试无敌照样生效
    const saved = p.invulnerableTime;
    if (saved <= SAFE.DebugInvuln && p.alive) {
      p.invulnerableTime = 0;
      try {
        ctx.combat.damagePlayer(p.maxHp() * FALL_SPEC.burst, FALL_SPEC.element, null, p.position);
      } finally {
        p.invulnerableTime = Math.max(p.invulnerableTime, saved);
      }
    }
    const flash = (ctx.ui as unknown as { screenFlash?: (c: readonly [number, number, number, number], s: number) => void }).screenFlash;
    if (typeof flash === 'function') flash.call(ctx.ui, FALL_SPEC.flash, 0.45);
  }
}
