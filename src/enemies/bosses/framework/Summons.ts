/**
 * 首领的召唤物（Unity Summons.cs）：
 *   spawn：先在落点画预警，warn 秒后经 ctx.enemies.spawn 生成（同首领的难度）；上限 = 首领定义的 summonCap（在场 + 预警中合计）与每次召唤可选的同种上限；
 *     落点优先用场地召唤点（没有时绕首领一圈），都夹进场地、贴到导航网格。
 *   崩解：首领倒下时全部（含还在预警的）静默处决——'purge' 标签：不掉落、不给魂晶、不计击杀（同 BossBase.killMinions）；
 *     标了 despawnOnPhase 的那批在转阶段时崩解。
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy } from '../../../core/types';
import { attackDirector } from '../../AttackTokens';

export interface SummonOptions {
  /** 落点预警时长（秒） */
  warn: number;
  minRadius: number;
  maxRadius: number;
  /** 同种同时在场的上限（0 = 只受首领总上限约束） */
  cap: number;
  elite: boolean;
  despawnOnPhase: boolean;
  usePoints: boolean;
  warnColor: number | null;
}

export function summonOptions(o: Partial<SummonOptions> = {}): SummonOptions {
  return { warn: 0.8, minRadius: 4, maxRadius: 8, cap: 0, elite: false, despawnOnPhase: false, usePoints: true, warnColor: null, ...o };
}

/** 召唤物看到的首领 */
export interface SummonHost {
  readonly ctx: GameContext;
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  readonly facing: number;
  readonly level: number;
  readonly summonCap: number;
  readonly warnColor: number;
  /** 场地召唤点（没有为空） */
  summonPoints(): readonly THREE.Vector3[];
  /** 点夹进场地（离边界 margin 米） */
  clampToArena(v: THREE.Vector3, margin: number): THREE.Vector3;
}

interface Pending {
  id: string;
  pos: THREE.Vector3;
  at: number;
  o: SummonOptions;
  cancelWarn: (() => void) | null;
}

const _v = new THREE.Vector3();

export class Summons {
  private readonly live: IEnemy[] = [];
  private readonly pending: Pending[] = [];
  private readonly phaseBound = new Set<IEnemy>();
  totalSpawned = 0;
  /** 生成了一只（首领染沙魇之类） */
  onSpawned: ((e: IEnemy) => void) | null = null;

  constructor(private readonly owner: SummonHost) {}

  get cap(): number {
    return Math.max(0, this.owner.summonCap);
  }

  get alive(): number {
    this.prune();
    return this.live.length;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get liveList(): readonly IEnemy[] {
    this.prune();
    return this.live;
  }

  count(enemyId: string): number {
    this.prune();
    let n = 0;
    for (const e of this.live) if (e.def.id === enemyId) n++;
    for (const p of this.pending) if (p.id === enemyId) n++;
    return n;
  }

  /** 召唤 count 只（受上限约束，可能少召或不召）；返回实际排进预警的数量 */
  spawn(enemyId: string, count: number, o: SummonOptions): number {
    const owner = this.owner;
    if (!owner.alive || count <= 0) return 0;
    this.prune();
    let room = this.cap - this.live.length - this.pending.length;
    if (o.cap > 0) room = Math.min(room, o.cap - this.count(enemyId));
    count = Math.min(count, room);
    if (count <= 0) return 0;
    const ctx = owner.ctx;
    const maxR = o.maxRadius > 0 ? o.maxRadius : 8;
    const minR = Math.min(maxR, Math.max(0, o.minRadius));
    const points = o.usePoints ? owner.summonPoints() : [];
    const start = Math.floor(Math.random() * 1024);
    const now = ctx.time.now;
    for (let i = 0; i < count; i++) {
      const pos = new THREE.Vector3();
      if (points.length > 0) {
        pos.copy(points[(start + i) % points.length]);
        if (i >= points.length) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
          pos.x += Math.sin(a) * r;
          pos.z += Math.cos(a) * r;
        }
      } else {
        const a = (i / count) * Math.PI * 2 + (Math.random() * 0.8 - 0.4) + owner.facing;
        const r = minR + Math.random() * (maxR - minR);
        pos.set(owner.position.x + Math.sin(a) * r, owner.position.y, owner.position.z + Math.cos(a) * r);
      }
      owner.clampToArena(pos, 2.5);
      if (ctx.nav.nearestWalkable(pos, _v) && _v.distanceToSquared(pos) <= 16) pos.copy(_v);
      const warn = Math.max(0, o.warn);
      const cancelWarn = warn > 0 ? ctx.fx.groundWarning(pos, 1.2, warn, o.warnColor ?? owner.warnColor) : null;
      this.pending.push({ id: enemyId, pos, at: now + warn, o, cancelWarn: typeof cancelWarn === 'function' ? cancelWarn : null });
    }
    if (!(o.warn > 0)) this.tick();
    return count;
  }

  /** 预警到点的生成出来（首领每帧调） */
  tick(): void {
    if (this.pending.length === 0) return;
    if (!this.owner.alive) {
      this.clearPending();
      return;
    }
    const ctx = this.owner.ctx;
    const now = ctx.time.now;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (now < p.at) continue;
      this.pending.splice(i--, 1);
      let e: IEnemy | null = null;
      try {
        e = ctx.enemies.spawn(p.id, { position: p.pos, level: this.owner.level, elite: p.o.elite || undefined });
      } catch (err) {
        console.error('[Summons] spawn threw', err);
      }
      if (!e) continue;
      this.live.push(e);
      if (p.o.despawnOnPhase) this.phaseBound.add(e);
      this.totalSpawned++;
      try {
        this.onSpawned?.(e);
      } catch (err) {
        console.error('[Summons] onSpawned threw', err);
      }
    }
  }

  /** 转阶段：标了 despawnOnPhase 的那批崩解（还在预警的也取消） */
  despawnPhaseBound(): number {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (!this.pending[i].o.despawnOnPhase) continue;
      this.pending[i].cancelWarn?.();
      this.pending.splice(i, 1);
    }
    const list = [...this.phaseBound].filter(e => e.alive);
    this.phaseBound.clear();
    return purgeEnemies(list);
  }

  /** 全部崩解（首领倒下 / 被移除）：静默处决在场的，取消预警中的 */
  despawnAll(): number {
    this.clearPending();
    this.prune();
    const list = [...this.live];
    this.live.length = 0;
    this.phaseBound.clear();
    return purgeEnemies(list);
  }

  /** 把一只不走召唤上限的随从（邪飞天）也登记成「随首领崩解」 */
  adopt(e: IEnemy): void {
    if (!this.live.includes(e)) this.live.push(e);
  }

  private clearPending(): void {
    for (const p of this.pending) p.cancelWarn?.();
    this.pending.length = 0;
  }

  private prune(): void {
    for (let i = this.live.length - 1; i >= 0; i--) if (!this.live[i].alive) this.live.splice(i, 1);
    for (const e of this.phaseBound) if (!e.alive) this.phaseBound.delete(e);
  }
}

/** 静默处决（'purge'：不经伤害管线、不派发 enemy:killed、不掉落；期间 attackDirector.purging，爆裂词缀不发动） */
export function purgeEnemies(list: readonly IEnemy[]): number {
  const was = attackDirector.purging;
  attackDirector.purging = true;
  let n = 0;
  try {
    for (const e of list) {
      if (!e.alive) continue;
      try {
        e.onKilled(purgeResult());
        n++;
      } catch (err) {
        console.error('[Summons] purge threw', err);
      }
    }
  } finally {
    attackDirector.purging = was;
  }
  return n;
}

function purgeResult(): DamageResult {
  return {
    request: { base: 0, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] },
    dealt: 0, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
  };
}
