import * as THREE from 'three';
import type {
  DamageRequest, DamageResult, Element, GameContext, GameEvents, IEnemy, IncomingDamageModifier, OutgoingDamageModifier,
  Rarity, ScrollDef, StatKey,
} from '../../core/types';

/**
 * 秘卷实现工具：
 *  - ScrollScope：一次 apply 期间注册的所有属性修饰 / 事件 / 修饰器 / 常驻任务，dispose 时统一撤销。
 *  - TimedBuff / 条件开关：用独立 source 叠加的临时属性。
 *  - 触发类辅助：procDepth、强度成长、附近敌人查询、内置冷却。
 */

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

/** 同一秘卷内限时增益的独立属性来源 */
export class TimedBuff {
  private until = -1;
  private active = false;

  constructor(
    private readonly ctx: GameContext,
    readonly source: string,
    private readonly mods: readonly (readonly [StatKey, number])[],
  ) {}

  /** 触发 / 刷新持续时间 */
  trigger(duration: number): void {
    this.until = Math.max(this.until, this.ctx.time.now + duration);
    if (!this.active) {
      this.active = true;
      const stats = this.ctx.player.stats;
      for (const [k, v] of this.mods) stats.add(k, v, this.source);
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 每帧检查到期（由 scope 的常驻任务驱动） */
  tick(): void {
    if (this.active && this.ctx.time.now >= this.until) this.end();
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    this.until = -1;
    this.ctx.player.stats.removeSource(this.source);
  }
}

/** 根据条件每帧开关的属性修饰 */
class StatToggle {
  private on = false;
  constructor(
    private readonly ctx: GameContext,
    readonly source: string,
    private readonly mods: readonly (readonly [StatKey, number])[],
    private readonly predicate: () => boolean,
  ) {}

  tick(): void {
    const want = this.ctx.player.alive && this.predicate();
    if (want === this.on) return;
    this.on = want;
    const stats = this.ctx.player.stats;
    if (want) for (const [k, v] of this.mods) stats.add(k, v, this.source);
    else stats.removeSource(this.source);
  }

  end(): void {
    if (this.on) this.ctx.player.stats.removeSource(this.source);
    this.on = false;
  }
}

export class ScrollScope {
  readonly source: string;
  private disposers: (() => void)[] = [];
  private subSources: string[] = [];
  private buffs: TimedBuff[] = [];
  private toggles: StatToggle[] = [];
  private tickerInstalled = false;
  private cooldowns = new Map<string, number>();

  constructor(readonly ctx: GameContext, readonly id: string) {
    this.source = `scroll:${id}`;
  }

  /** 属性修饰（source = scroll:<id>） */
  stat(key: StatKey, value: number): void {
    this.ctx.player.stats.add(key, value, this.source);
  }

  on<K extends keyof GameEvents>(type: K, fn: Handler<K>): void {
    this.disposers.push(this.ctx.events.on(type, fn));
  }

  /**
   * 「击杀时」效果统一走这里：跳过静默处决（tags 含 'purge'，EnemyManager.killAll 清场），
   * 首领倒下时被一并清掉的爪牙不触发任何击杀效果。
   */
  onKill(fn: Handler<'enemy:killed'>): void {
    this.on('enemy:killed', (payload) => {
      if (isPurgeKill(payload.result)) return;
      fn(payload);
    });
  }

  outgoing(fn: OutgoingDamageModifier): void {
    this.disposers.push(this.ctx.combat.addOutgoingModifier(fn));
  }

  /**
   * 受伤修饰器。Combat 按函数参数个数排序：不读 amount 的（零参数，如固定倍率）在前，
   * 读 amount 的（声明了参数）在后并能看到接近最终值的伤害——所以不需要 amount 时不要声明参数。
   */
  incoming(fn: IncomingDamageModifier): void {
    this.disposers.push(this.ctx.combat.addIncomingModifier(fn));
  }

  /** 常驻逐帧任务（跨关卡保留，卸载时取消） */
  task(fn: (dt: number) => void): void {
    this.disposers.push(this.ctx.tasks.add((dt) => {
      fn(dt);
      return false;
    }, true));
  }

  /** 常驻定时任务 */
  every(interval: number, fn: () => void): void {
    this.disposers.push(this.ctx.tasks.every(interval, () => {
      fn();
    }, Infinity, true));
  }

  /** 限时增益（独立 source，刷新持续时间，不叠加数值） */
  buff(mods: readonly (readonly [StatKey, number])[]): TimedBuff {
    const b = new TimedBuff(this.ctx, `${this.source}#buff${this.buffs.length}`, mods);
    this.buffs.push(b);
    this.subSources.push(b.source);
    this.installTicker();
    return b;
  }

  /** 条件属性：predicate 为真时生效 */
  toggle(mods: readonly (readonly [StatKey, number])[], predicate: () => boolean): void {
    const t = new StatToggle(this.ctx, `${this.source}#toggle${this.toggles.length}`, mods, predicate);
    this.toggles.push(t);
    this.subSources.push(t.source);
    this.installTicker();
  }

  /** 内置冷却：key 在 seconds 秒内只返回一次 true */
  ready(key: string, seconds: number): boolean {
    const now = this.ctx.time.now;
    const next = this.cooldowns.get(key) ?? -Infinity;
    if (now < next) return false;
    this.cooldowns.set(key, now + seconds);
    return true;
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]();
      } catch (err) {
        console.error(`[Scroll] dispose of ${this.id} threw`, err);
      }
    }
    this.disposers.length = 0;
    for (const b of this.buffs) b.end();
    for (const t of this.toggles) t.end();
    const stats = this.ctx.player.stats;
    stats.removeSource(this.source);
    for (const s of this.subSources) stats.removeSource(s);
  }

  private installTicker(): void {
    if (this.tickerInstalled) return;
    this.tickerInstalled = true;
    this.task(() => {
      for (const b of this.buffs) b.tick();
      for (const t of this.toggles) t.tick();
    });
  }
}

export interface ScrollSpec {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  maxStacks: number;
  tags?: string[];
  heroOnly?: string;
  /** 以层数 n（>=1）安装效果 */
  setup(s: ScrollScope, n: number, ctx: GameContext): void;
}

/** 由规格生成 ScrollDef：apply 创建作用域并返回其 dispose */
export function scroll(spec: ScrollSpec): ScrollDef {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    rarity: spec.rarity,
    maxStacks: spec.maxStacks,
    tags: spec.tags,
    heroOnly: spec.heroOnly,
    apply(ctx: GameContext, stacks: number): () => void {
      const scope = new ScrollScope(ctx, spec.id);
      try {
        spec.setup(scope, Math.max(1, Math.floor(stacks)), ctx);
      } catch (err) {
        console.error(`[Scroll] apply of ${spec.id} threw`, err);
      }
      return () => scope.dispose();
    },
  };
}

// ───────────── 触发类辅助 ─────────────

export function depthOf(req: DamageRequest): number {
  return req.procDepth ?? 0;
}

/** 契约约定的静默处决标签：掉落与「击杀时」效果都应忽略这类击杀 */
export const PURGE_TAG = 'purge';

/** 静默处决（EnemyManager.killAll 清场等）：不掉落、不触发击杀效果 */
export function isPurgeKill(result: DamageResult): boolean {
  // 契约上 request 必有；防御一下手工派发的残缺事件
  const tags = result.request?.tags;
  return Array.isArray(tags) && tags.includes(PURGE_TAG);
}

/** 玩家武器的直接命中（非衍生） */
export function isDirectWeaponHit(result: DamageResult): boolean {
  return result.request.source === 'weapon' && depthOf(result.request) === 0;
}

/** 固定数值类秘卷伤害随关卡强度成长的系数 */
export function procScale(ctx: GameContext): number {
  const d = ctx.run.difficulty;
  return 1 + (Number.isFinite(d) ? Math.max(0, d - 1) : 0) * 0.85;
}

/** 秘卷爆炸的半径同样吃「爆炸范围」加成（武器与技能的爆炸由各自系统计入） */
export function blastRadius(ctx: GameContext, base: number): number {
  return base * ctx.player.stats.mult('explosionRadiusPct');
}

const ELEMENT_STAT: Record<Exclude<Element, 'none'>, StatKey> = {
  fire: 'fireDamagePct', shock: 'shockDamagePct', corrode: 'corrodeDamagePct',
};

/**
 * 由一次命中推出状态强度，与 Combat 自己附着元素时的口径一致（Combat.afterHit 的
 * min(effective, maxHp × STATUS_POWER_CAP) ÷ dotStatMultiplier）：取这一击的实际伤害（上限最大生命 × 0.5），
 * 再除掉每一跳结算时会重新乘上的元素 / 精英 / 首领属性倍率，避免同一份加成算两次。
 * 调用方只在未击杀的命中上使用，此时 dealt 与 Combat 用的 effective 相等（没有溢出）。
 * 灼烧改为每层独立计时后，power 仍是「单层」强度，每 0.5 秒按 Σ各层 power × BURN_RATIO 结算，口径不变。
 */
export function statusPowerFrom(ctx: GameContext, enemy: IEnemy, result: DamageResult): number {
  const stats = ctx.player.stats;
  let m = 1;
  if (result.element !== 'none') m *= stats.mult('elementDamagePct') * stats.mult(ELEMENT_STAT[result.element]);
  if (enemy.isElite) m *= stats.mult('eliteDamagePct');
  if (enemy.isBoss) m *= stats.mult('bossDamagePct');
  const p = Math.min(result.dealt, enemy.maxHp * 0.5) / (m > 0 && Number.isFinite(m) ? m : 1);
  return Number.isFinite(p) ? Math.max(0, p) : 0;
}

/** 敌人当前总耐久比例（生命 + 护盾 + 护甲） */
export function enemyHealthFrac(e: IEnemy): number {
  const max = e.maxHp + e.maxShield + e.maxArmor;
  if (max <= 0) return 0;
  return (Math.max(0, e.hp) + Math.max(0, e.shield) + Math.max(0, e.armor)) / max;
}

export function playerHpFrac(ctx: GameContext): number {
  const max = ctx.player.maxHp();
  return max > 0 ? Math.max(0, ctx.player.hp) / max : 0;
}

/** 敌人到玩家的水平距离 */
export function enemyDistance(ctx: GameContext, e: IEnemy): number {
  const p = ctx.player.position;
  return Math.hypot(e.position.x - p.x, e.position.z - p.z);
}

const _query: IEnemy[] = [];
const _center = new THREE.Vector3();

/** center 半径内离 center 最近、且不是 exclude 的活着的敌人 */
export function nearestOther(ctx: GameContext, center: THREE.Vector3, radius: number, exclude: IEnemy | null): IEnemy | null {
  _query.length = 0;
  const list = ctx.enemies.queryRadius(center, radius, _query);
  let best: IEnemy | null = null;
  let bestD = Infinity;
  for (const e of list) {
    if (e === exclude || !e.alive) continue;
    const d = e.position.distanceToSquared(center);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  _query.length = 0;
  return best;
}

/** 对半径内所有活着的敌人（除 exclude）执行 fn */
export function forEachNear(ctx: GameContext, center: THREE.Vector3, radius: number, exclude: IEnemy | null, fn: (e: IEnemy) => void): void {
  _query.length = 0;
  const list = ctx.enemies.queryRadius(center, radius, _query);
  // 复制一份：fn 内的伤害可能改动管理器列表
  const copy = list.slice();
  _query.length = 0;
  for (const e of copy) {
    if (e === exclude || !e.alive) continue;
    fn(e);
  }
}

/** 敌人身体中心（写入共享临时向量，调用方需立即使用或拷贝） */
export function bodyCenter(e: IEnemy, out: THREE.Vector3 = _center): THREE.Vector3 {
  return e.getBodyCenter(out);
}
