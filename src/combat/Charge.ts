/**
 * 带电（第四章「雪域天路」，Unity Combat/Charge.cs：Charge + ChargeState；docs/level-design/chuanzang-combat-v1.md 1.2）：
 *   · 状态：带电有持续秒数（apply 可续时长，取剩余与新给的较大者，不累加），也可以常驻（hold：夔一直带电、举父举着雷石、连鼓灵的雷心）；
 *   · 反应：就元素反应而言，带电 = 身上有雷殛（Reactions 经 ReactionHost.isCharged 读）——燎的火一碰就是焚雷，蚀化一碰就是封脉；
 *     带电本身不挂雷殛状态，不吃雷殛的 3 层眩晕、弹射，也不吃雷殛标记的 ×1.15；
 *   · 电会传：带电的怪被打死时，把电放给 8 m 内最近的 2 个同伴（它们带电 6 秒、挨 6 点雷伤，深度 1、不再附着、不弹射），
 *     连锁有上限：每次传电跳数 +1，到 4 就不再往下传。首领不接电、首领倒下也不放电（有自己的死亡演出）；
 *   · 视觉：身上噼啪（Unity 是边缘光换成紫红雷光 + 贴身短电弧；网页换成贴身的紫红小电火花，全场每秒限 14 下，边缘光随 M11b）。
 * 第四章的高原敌（world/plateau/play 的 Foe）自己有一份 charge()：适配层（PlateauFoeAdapter）把它的 charged() 挂到 `foeCharged`，这里一并读。
 * 所有入口对已死 / 不可选中的目标都是空操作。纯逻辑部分（ChargeBook）不碰场景，node --test 直接测。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../core/types';

export const CHARGE = {
  /** 传电给同伴时的带电秒数（combat 1.2「它们也带电 6 秒」） */
  DefaultSeconds: 6,
  /** 传电半径（米）与每次传电打的伤害 */
  ArcRadius: 8,
  ArcDamage: 6,
  /** 每次传给几个同伴 */
  ArcTargets: 2,
  /** 连锁跳数上限：第 0 跳是被直接打爆的那只放出去的电 */
  MaxHops: 4,
  /** 贴身电弧全场每秒最多几下 */
  ArcsPerSecond: 14,
} as const;

/** 紫红雷光（邪火紫红，C4-4）：传电电弧与噼啪 */
export const CHARGE_COLOR = 0xff59e6;

/** 一只单位的带电状态（Unity ChargeState 的数据部分） */
export class ChargeState {
  left = 0;
  hop = 0;
  source: unknown = null;
  readonly holds = new Set<object>();
  /** 噼啪计时 */
  nextPulse = 0;

  get active(): boolean {
    return this.left > 0 || this.holds.size > 0;
  }

  /** 剩余秒数（常驻 +∞，不带电 0） */
  get remaining(): number {
    return !this.active ? 0 : this.holds.size > 0 ? Infinity : this.left;
  }

  /** 新的电（不是传来的）把跳数归零；传来的电取较小的跳数（离源头更近的那份算数） */
  add(seconds: number, source: unknown, fromHop: number): void {
    this.hop = !this.active ? fromHop : Math.min(this.hop, fromHop);
    this.left = Math.max(this.left, seconds);
    this.source = source;
  }
}

type Alive = Pick<IEnemy, 'alive' | 'untargetable'>;

function valid(e: Alive | null | undefined): boolean {
  return !!e && e.alive && !e.untargetable;
}

/** 带电账本：哪只单位带着电、还剩多久、常驻持有（不碰场景） */
export class ChargeBook<E extends Alive = IEnemy> {
  private readonly states = new Map<E, ChargeState>();
  /** 开始带电（从不带电变成带电的那一刻；续时长不再发） */
  onCharged: ((e: E) => void) | null = null;

  state(e: E): ChargeState | null {
    return this.states.get(e) ?? null;
  }

  private ensure(e: E): ChargeState {
    let s = this.states.get(e);
    if (!s) this.states.set(e, s = new ChargeState());
    return s;
  }

  /** 让目标带电 seconds 秒（已经带电时取剩余与 seconds 的较大者）；返回是否带上了 */
  apply(e: E, seconds: number, source: unknown = null, hop = 0): boolean {
    if (!valid(e) || !(seconds > 0) || !Number.isFinite(seconds)) return false;
    const s = this.ensure(e);
    const was = s.active;
    s.add(seconds, source, hop);
    if (!was) this.onCharged?.(e);
    return true;
  }

  /** 常驻带电：返回撤销函数；多个来源可以同时持有，全部撤掉才停。目标无效时返回空函数 */
  hold(e: E, source: unknown = null): () => void {
    if (!valid(e)) return () => {};
    const s = this.ensure(e);
    const was = s.active;
    if (!was) s.hop = 0;
    const handle = {};
    s.holds.add(handle);
    s.source = source;
    if (!was) this.onCharged?.(e);
    return () => { s.holds.delete(handle); };
  }

  isCharged(e: E): boolean {
    if (!e || !e.alive) return false;
    return this.states.get(e)?.active === true;
  }

  remaining(e: E): number {
    if (!e || !e.alive) return 0;
    return this.states.get(e)?.remaining ?? 0;
  }

  /** 立刻清掉计时的电（常驻的持有不动） */
  clearTimed(e: E): void {
    const s = this.states.get(e);
    if (s) s.left = 0;
  }

  /** 推进计时；不再带电、也没人持有的条目丢掉 */
  tick(dt: number, each?: (e: E, s: ChargeState) => void): void {
    for (const [e, s] of this.states) {
      if (s.left > 0) s.left = Math.max(0, s.left - dt);
      if (!e.alive || !s.active) {
        this.states.delete(e);
        continue;
      }
      each?.(e, s);
    }
  }

  /** 单位死了：清掉它的电，返回死前是否带电与它的跳数（Unity ChargeState.OnDied） */
  died(e: E): { was: boolean; hop: number } {
    const s = this.states.get(e);
    if (!s) return { was: false, hop: 0 };
    const was = s.left > 0 || s.holds.size > 0;
    const hop = s.hop;
    this.states.delete(e);
    return { was, hop };
  }

  clear(): void {
    this.states.clear();
  }

  get size(): number {
    return this.states.size;
  }
}

/**
 * 传电目标（Unity Charge.Arc）：from 的电是第 hop 跳传来的，这次传出去的是第 hop + 1 跳；hop + 1 > maxHops 时不传。
 * candidates 已按到 from 的距离从近到远排好（首领、无效的在这里跳过）；返回最多 ArcTargets 个
 */
export function arcTargets<E extends Alive & { isBoss?: boolean }>(fromHop: number, candidates: readonly E[], maxHops: number = CHARGE.MaxHops): { hop: number; targets: E[] } {
  const hop = fromHop + 1;
  if (hop > maxHops) return { hop, targets: [] };
  const targets: E[] = [];
  for (const t of candidates) {
    if (targets.length >= CHARGE.ArcTargets) break;
    if (!valid(t) || t.isBoss) continue;
    targets.push(t);
  }
  return { hop, targets };
}

const _p = new THREE.Vector3();
const _cand = new THREE.Vector3();

/**
 * 传电的候选名单，照 Unity Charge.Arc 里的 `ReactionSystem.Nearest(c, radius, ArcTargets + 2, from, false, near)`：
 * 活着、可选中、不是 from，身体中心离 center 不超过 radius（不加敌人半径），按距离由近到远只取前 ArcTargets + 2 个。
 * 首领照样占名额（Unity 在这 4 个里再跳过首领），交给 arcTargets 过滤。out 会被清空后填充
 */
export function arcCandidates<E extends Alive & { getBodyCenter(out: THREE.Vector3): THREE.Vector3 }>(
  center: THREE.Vector3,
  radius: number,
  pool: readonly E[],
  from: unknown,
  out: E[] = [],
): E[] {
  out.length = 0;
  if (!(radius > 0)) return out;
  const count = CHARGE.ArcTargets + 2;
  const r2 = radius * radius;
  const dist: number[] = [];
  const cand: E[] = [];
  for (const e of pool) {
    if (e === from || !valid(e)) continue;
    const d2 = e.getBodyCenter(_cand).distanceToSquared(center);
    if (d2 > r2) continue;
    cand.push(e);
    dist.push(d2);
  }
  while (out.length < count) {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < bd) {
        bd = dist[i];
        bi = i;
      }
    }
    if (bi < 0) break;
    dist[bi] = Infinity;
    out.push(cand[bi]);
  }
  return out;
}

/** 本局的带电系统（Combat 持有）；ctx.combat 是测试桩时为 null */
export function chargeSystem(ctx: Pick<GameContext, 'combat'>): ChargeSystem | null {
  const c = (ctx.combat as unknown as { charge?: unknown } | undefined)?.charge;
  return c instanceof ChargeSystem ? c : null;
}

/** 运行时：账本 + 传电 + 噼啪（Combat 持有、每帧推进） */
export class ChargeSystem {
  readonly book = new ChargeBook<IEnemy>();
  private tokens = 0;
  private readonly near: IEnemy[] = [];
  private readonly picked: IEnemy[] = [];
  /** 走到「选目标」那一步的 arc() 次数：外层传电据此看出途中有没有重入（见 arc） */
  private arcs = 0;

  constructor(private readonly ctx: GameContext) {
    ctx.events?.on('enemy:killed', ({ enemy }) => this.onKilled(enemy));
  }

  /** 带电（含高原敌自己的 charge()） */
  isCharged(e: IEnemy): boolean {
    if (this.book.isCharged(e)) return true;
    const foe = (e as { foeCharged?: () => boolean }).foeCharged;
    return typeof foe === 'function' && e.alive && foe.call(e) === true;
  }

  apply(e: IEnemy, seconds: number, source: unknown = null): boolean {
    return this.book.apply(e, seconds, source, 0);
  }

  hold(e: IEnemy, source: unknown = null): () => void {
    return this.book.hold(e, source);
  }

  update(dt: number): void {
    this.tokens = Math.min(3, this.tokens + dt * CHARGE.ArcsPerSecond);
    this.book.tick(dt, (e, s) => {
      s.nextPulse -= dt;
      if (s.nextPulse > 0) return;
      s.nextPulse = 0.08 + Math.random() * 0.22;
      if (this.tokens < 1) return;
      this.tokens -= 1;
      // 噼啪：贴身一撮紫红电火花（Unity 边缘光脉冲 + 贴身短电弧）
      e.getBodyCenter(_p);
      _p.x += (Math.random() - 0.5) * e.radius;
      _p.y += (Math.random() - 0.3) * e.height * 0.5;
      _p.z += (Math.random() - 0.5) * e.radius;
      this.ctx.fx.burst(_p, CHARGE_COLOR, 3, 2.2, 0.16, 0.05, 0);
    });
  }

  clear(): void {
    this.book.clear();
  }

  private onKilled(enemy: IEnemy): void {
    const { was, hop } = this.book.died(enemy);
    if (!was || enemy.isBoss) return;
    this.arc(enemy, hop);
  }

  /**
   * 传电：from 可以已死。返回传到了几个。
   * 重入照 Unity Charge.Arc：Unity 的候选名单 `near` 是全场共用的静态表，半径无效或跳数到顶时直接 return、不碰它；
   * 否则一进来就 near.Clear()、走完再 near.Clear()。所以这一跳打死了某只带电的（传电的 6 点雷伤打死目标本身，或击杀连带打死别的），
   * Died 同步重入的那次 Arc 会把 near 清空，外层 `i < near.Count` 随即为假，剩下的目标不再传（由重入的那次放电接着传）。
   * 网页的名单是各自的数组，靠 `arcs` 计数看出重入，照样在这一跳之后停下
   */
  arc(from: IEnemy, fromHop: number, radius: number = CHARGE.ArcRadius): number {
    // Unity：`!(radius > 0)` 与 `hop > maxHops` 都在 near.Clear() 之前 return 0
    if (!(radius > 0) || fromHop + 1 > CHARGE.MaxHops) return 0;
    const pass = ++this.arcs;
    const ctx = this.ctx;
    // 起点自己留一份：下面的 damageEnemy 可能打死另一只带电的，同步重入 arc() 会改写共用的临时向量（之后的音效还要用 c）
    const c = from.getBodyCenter(new THREE.Vector3());
    const near = this.near;
    near.length = 0;
    // queryRadius 的范围是「radius + 敌人半径」，比 Unity 宽；只当粗筛，再照 Unity Nearest 按身体中心 ≤ radius 取最近 ArcTargets + 2 个
    const found = ctx.enemies.queryRadius(c, radius, near);
    const list = arcCandidates(c, radius, found, from, this.picked);
    const { hop, targets } = arcTargets(fromHop, list);
    near.length = 0;
    list.length = 0;
    let n = 0;
    for (const t of targets) {
      n++;
      const to = t.getBodyCenter(new THREE.Vector3());
      ctx.fx.lightning(c, to, CHARGE_COLOR);
      this.book.apply(t, CHARGE.DefaultSeconds, from, hop);
      const dir = to.clone().sub(c);
      if (dir.lengthSq() > 1e-6) dir.normalize();
      else dir.set(0, 1, 0);
      ctx.combat.damageEnemy(t, {
        base: CHARGE.ArcDamage, element: 'shock', source: 'status', canCrit: false, procDepth: 1, tags: ['chain'],
        point: to, direction: dir,
      });
      if (n === 1) ctx.audio.play('shock_zap', { position: c, volume: 0.65, pitch: 0.9 + Math.random() * 0.25 });
      // 途中重入过 arc()（Unity 的 near 已被清空）：这一跳到此为止
      if (this.arcs !== pass) break;
    }
    return n;
  }
}
