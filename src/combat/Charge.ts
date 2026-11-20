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

const _c = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();

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

  /** 传电：from 可以已死。返回传到了几个 */
  arc(from: IEnemy, fromHop: number, radius: number = CHARGE.ArcRadius): number {
    const ctx = this.ctx;
    from.getBodyCenter(_c);
    const near = this.near;
    near.length = 0;
    const found = ctx.enemies.queryRadius(_c, radius, near);
    const list = (found === near ? near : [...found]).filter(e => e !== from);
    const dist = new Map<IEnemy, number>();
    for (const e of list) dist.set(e, e.getBodyCenter(_to).distanceToSquared(_c));
    list.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const { hop, targets } = arcTargets(fromHop, list);
    near.length = 0;
    let n = 0;
    for (const t of targets) {
      n++;
      const to = t.getBodyCenter(new THREE.Vector3());
      ctx.fx.lightning(_c, to, CHARGE_COLOR);
      this.book.apply(t, CHARGE.DefaultSeconds, from, hop);
      const dir = to.clone().sub(_c);
      if (dir.lengthSq() > 1e-6) dir.normalize();
      else dir.set(0, 1, 0);
      ctx.combat.damageEnemy(t, {
        base: CHARGE.ArcDamage, element: 'shock', source: 'status', canCrit: false, procDepth: 1, tags: ['chain'],
        point: to, direction: dir,
      });
      if (n === 1) ctx.audio.play('shock_zap', { position: _c, volume: 0.65, pitch: 0.9 + Math.random() * 0.25 });
    }
    return n;
  }
}
