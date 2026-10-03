/**
 * 敌人状态系统：灼烧 / 雷殛 / 蚀化 / 眩晕 / 减速（DESIGN.md 第 5 节）。
 *
 * - 状态实例存放在 enemy.statuses（UI 读取图标与层数），额外的内部数据（每层灼烧强度、减速列表、
 *   链式冷却、首领眩晕抗性、粒子计时）放在 WeakMap 里，敌人被回收后自动释放。
 * - 每帧先把 slowMult / damageTakenMult 重置为 1 再按状态写入，保证不会累积。
 * - 持续伤害走 Combat.damageEnemy（source 'status'、不暴击、procDepth 1）。
 * - 元素反应的判定在 Combat.attach（施加之前）；这里只提供「归墟」消耗与「崩解」所需的剩余伤害查询。
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, Element, GameContext, IEnemy, StatusId, StatusInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp } from '../core/math';
import { lineClear } from './Blast';

// ───────────── 数值 ─────────────

export const BURN_DURATION = 4;
export const BURN_TICK = 0.5;
export const BURN_RATIO = 0.22;
export const BURN_MAX_STACKS = 3;

export const SHOCK_MARK_DURATION = 3;
export const SHOCK_CHAIN_RANGE = 8;
export const SHOCK_CHAIN_TARGETS = 3;
export const SHOCK_CHAIN_RATIO = 0.5;
export const SHOCK_STUN_STACKS = 3;
export const SHOCK_STUN_DURATION = 0.8;
/** 同一个敌人两次向外弹射之间的最短间隔（防止高射速武器刷屏） */
const SHOCK_CHAIN_COOLDOWN = 0.2;

export const CORRODE_DURATION = 5;
export const CORRODE_TICK = 0.5;
export const CORRODE_RATIO = 0.08;
export const CORRODE_DAMAGE_TAKEN = 1.2;
export const CORRODE_SLOW = 0.8;

const SLOW_DEFAULT_DURATION = 2;
const SLOW_MAX = 0.9;
const SLOW_MAX_ENTRIES = 4;
const STUN_DEFAULT_DURATION = 1;

/** power 上限 = 敌人最大生命 × 0.5 */
export const STATUS_POWER_CAP = 0.5;

/** 首领：眩晕时长 × 0.35，眩晕结束后 3 秒内免疫，避免被控死 */
const BOSS_STUN_SCALE = 0.35;
const BOSS_STUN_IMMUNITY = 3;
/** 精英：眩晕时长 × 0.75 */
const ELITE_STUN_SCALE = 0.75;

/** 每帧最多为多少个敌人生成状态粒子 */
const FX_BUDGET_PER_FRAME = 6;

const CHAIN_TAGS = ['chain'];

// ───────────── 内部数据 ─────────────

interface SlowEntry {
  power: number;
  remaining: number;
}

interface StatusData {
  /** 每层灼烧各自的强度（每层独立计入 DOT） */
  burnPowers: number[];
  slows: SlowEntry[];
  chainReadyAt: number;
  stunImmuneUntil: number;
  fxTimer: number;
}

/** Combat 暴露给状态系统的伤害入口 */
export interface DamageSink {
  damageEnemy(enemy: IEnemy, req: DamageRequest): DamageResult | null;
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();

function makeInstance(id: StatusId, remaining: number, tickTimer: number): StatusInstance {
  return { id, stacks: 0, remaining, tickTimer, power: 0 };
}

export class StatusSystem {
  private data = new WeakMap<IEnemy, StatusData>();
  private readonly queryBuf: IEnemy[] = [];
  private tickSoundAt: Record<'burn' | 'corrode', number> = { burn: -1, corrode: -1 };
  private zapSoundAt = -1;

  constructor(private readonly ctx: GameContext, private readonly sink: DamageSink) {}

  // ───────────── 施加 ─────────────

  /**
   * 施加状态。depth 为触发这一击的 procDepth（只有 0 才会触发雷殛弹射）。
   * burn / shock / corrode 的 power 会被钳制到敌人最大生命 × 0.5；
   * slow 的 power 为减速比例（0.3 = 减速 30%，>1 时按百分数解释）；stun 只看 duration。
   * 返回是否成功施加。
   */
  apply(enemy: IEnemy, id: StatusId, power: number, duration: number | undefined, depth: number): boolean {
    if (!enemy.alive || enemy.hp <= 0) return false;
    const d = this.ensure(enemy);
    const st = enemy.statuses;
    const p = clamp(Number.isFinite(power) ? power : 0, 0, enemy.maxHp * STATUS_POWER_CAP);

    switch (id) {
      case 'burn': {
        const dur = duration ?? BURN_DURATION;
        let inst = st.get('burn');
        if (!inst) {
          inst = makeInstance('burn', 0, BURN_TICK);
          st.set('burn', inst);
          d.burnPowers.length = 0;
        }
        if (d.burnPowers.length < BURN_MAX_STACKS) {
          d.burnPowers.push(p);
        } else {
          // 满层：用更强的一击替换最弱的一层
          let wi = 0;
          for (let i = 1; i < d.burnPowers.length; i++) if (d.burnPowers[i] < d.burnPowers[wi]) wi = i;
          if (p > d.burnPowers[wi]) d.burnPowers[wi] = p;
        }
        inst.stacks = d.burnPowers.length;
        inst.remaining = Math.max(inst.remaining, dur);
        inst.power = sum(d.burnPowers);
        this.emitApplied(enemy, 'burn', inst.stacks);
        return true;
      }

      case 'shock': {
        let inst = st.get('shock');
        if (!inst) {
          inst = makeInstance('shock', 0, 0);
          st.set('shock', inst);
        }
        inst.stacks += 1;
        inst.remaining = Math.max(inst.remaining, duration ?? SHOCK_MARK_DURATION);
        inst.power = Math.max(inst.power, p);
        const stacks = inst.stacks;
        const now = this.ctx.time.now;
        if (depth <= 0 && now >= d.chainReadyAt) {
          d.chainReadyAt = now + SHOCK_CHAIN_COOLDOWN;
          this.chainFrom(enemy, p, depth);
        }
        this.emitApplied(enemy, 'shock', stacks);
        // 叠满：眩晕并清空层数（弹射可能已经击杀了自己身上的连锁目标，这里再检查一次）
        if (stacks >= SHOCK_STUN_STACKS && enemy.alive) {
          st.delete('shock');
          this.stun(enemy, d, SHOCK_STUN_DURATION);
        }
        return true;
      }

      case 'corrode': {
        const dur = duration ?? CORRODE_DURATION;
        let inst = st.get('corrode');
        if (!inst) {
          inst = makeInstance('corrode', 0, CORRODE_TICK);
          st.set('corrode', inst);
        }
        inst.stacks = 1;
        inst.remaining = Math.max(inst.remaining, dur);
        inst.power = Math.max(inst.power, p);
        this.emitApplied(enemy, 'corrode', 1);
        return true;
      }

      case 'stun':
        return this.stun(enemy, d, duration ?? STUN_DEFAULT_DURATION);

      case 'slow': {
        let strength = Number.isFinite(power) ? power : 0;
        if (strength > 1) strength /= 100;
        strength = clamp(strength, 0, SLOW_MAX);
        if (strength <= 0) return false;
        const dur = duration ?? SLOW_DEFAULT_DURATION;
        if (d.slows.length < SLOW_MAX_ENTRIES) {
          d.slows.push({ power: strength, remaining: dur });
        } else {
          // 替换「强度 × 剩余时间」最小的一条
          let wi = 0;
          for (let i = 1; i < d.slows.length; i++) {
            if (d.slows[i].power * d.slows[i].remaining < d.slows[wi].power * d.slows[wi].remaining) wi = i;
          }
          d.slows[wi].power = strength;
          d.slows[wi].remaining = dur;
        }
        let inst = st.get('slow');
        if (!inst) {
          inst = makeInstance('slow', 0, 0);
          st.set('slow', inst);
        }
        inst.stacks = d.slows.length;
        inst.remaining = Math.max(inst.remaining, dur);
        inst.power = Math.max(inst.power, strength);
        this.emitApplied(enemy, 'slow', inst.stacks);
        return true;
      }
    }
    return false;
  }

  /**
   * 雷殛弹射：从 source 向 8 米内最多 3 个其他敌人放闪电（需要视线），造成 power × 0.5 雷电伤害。
   * 弹射伤害 procDepth + 1，不会再次弹射。source 已死亡时也可以调用（击杀一击同样弹射）。
   */
  chainFrom(source: IEnemy, power: number, depth: number): void {
    if (power <= 0) return;
    const ctx = this.ctx;
    source.getBodyCenter(_from);
    const found = ctx.enemies.queryRadius(_from, SHOCK_CHAIN_RANGE, this.queryBuf);

    // 按距离保留最近的若干个候选（多留几个给视线被挡的情况）。
    // 拷贝到局部数组：后续伤害可能嵌套触发新的查询。
    const keep = SHOCK_CHAIN_TARGETS * 2;
    const picked: IEnemy[] = [];
    const dists: number[] = [];
    for (let i = 0; i < found.length; i++) {
      const e = found[i];
      if (e === source || !e.alive) continue;
      const dsq = e.position.distanceToSquared(source.position);
      let j: number;
      if (picked.length < keep) {
        picked.push(e);
        dists.push(dsq);
        j = picked.length - 1;
      } else {
        if (dsq >= dists[keep - 1]) continue;
        j = keep - 1;
        picked[j] = e;
        dists[j] = dsq;
      }
      while (j > 0 && dists[j - 1] > dists[j]) {
        const te = picked[j - 1];
        picked[j - 1] = picked[j];
        picked[j] = te;
        const td = dists[j - 1];
        dists[j - 1] = dists[j];
        dists[j] = td;
        j--;
      }
    }
    this.queryBuf.length = 0;

    let zapped = 0;
    for (let i = 0; i < picked.length && zapped < SHOCK_CHAIN_TARGETS; i++) {
      const target = picked[i];
      if (!target.alive) continue;
      source.getBodyCenter(_from);
      target.getBodyCenter(_to);
      if (!lineClear(ctx.world, _to, _from, 0.1)) continue;
      ctx.fx.lightning(_from, _to, ELEMENT_COLORS.shock);
      _dir.subVectors(_to, _from);
      if (_dir.lengthSq() > 1e-8) _dir.normalize();
      else _dir.set(0, 1, 0);
      zapped++;
      this.sink.damageEnemy(target, {
        base: power * SHOCK_CHAIN_RATIO,
        element: 'shock',
        source: 'status',
        canCrit: false,
        procDepth: depth + 1,
        tags: CHAIN_TAGS,
        point: _to.clone(),
        direction: _dir.clone(),
      });
    }
    if (zapped > 0) {
      const now = ctx.time.now;
      if (now - this.zapSoundAt > 0.06) {
        this.zapSoundAt = now;
        ctx.audio.play('shock_zap', { position: source.position, volume: 0.65, pitch: 0.9 + Math.random() * 0.25 });
      }
    }
  }

  // ───────────── 元素反应支持（docs/arsenal-expansion.md 2.2 / 2.5） ─────────────

  /**
   * 消耗状态（只有「归墟」会调用）。
   * burn：返回剩余伤害的结清值 Σ各层强度 × 0.22 × ceil(剩余秒 / 0.5)（≤ 1.76 × Σ），并清空灼烧；
   * shock：直接移除，返回 0（雷殛没有结清值）。蚀化设计上永不被消耗，不提供。
   */
  consume(enemy: IEnemy, id: 'burn' | 'shock'): number {
    const st = enemy.statuses;
    if (id === 'shock') {
      st.delete('shock');
      return 0;
    }
    const cash = this.dotRemaining(enemy, 'burn');
    st.delete('burn');
    const d = this.data.get(enemy);
    if (d) d.burnPowers.length = 0;
    return cash;
  }

  /**
   * 持续伤害的剩余总量（不修改状态）：
   * burn = Σ各层强度 × 0.22 × ceil(剩余秒 / 0.5)；corrode = 强度 × 0.08 × ceil(剩余秒 / 0.5)。
   */
  dotRemaining(enemy: IEnemy, id: 'burn' | 'corrode'): number {
    const inst = enemy.statuses.get(id);
    if (!inst || !(inst.remaining > 0)) return 0;
    if (id === 'burn') {
      const d = this.data.get(enemy);
      const total = d && d.burnPowers.length > 0 ? sum(d.burnPowers) : inst.power;
      return total * BURN_RATIO * Math.ceil(inst.remaining / BURN_TICK);
    }
    return inst.power * CORRODE_RATIO * Math.ceil(inst.remaining / CORRODE_TICK);
  }

  private stun(enemy: IEnemy, d: StatusData, seconds: number): boolean {
    let dur = seconds;
    const now = this.ctx.time.now;
    if (enemy.isBoss) {
      if (now < d.stunImmuneUntil) return false;
      dur *= BOSS_STUN_SCALE;
      d.stunImmuneUntil = now + dur + BOSS_STUN_IMMUNITY;
    } else if (enemy.isElite) {
      dur *= ELITE_STUN_SCALE;
    }
    if (!(dur > 0)) return false;
    enemy.stunTime = Math.max(enemy.stunTime, dur);
    let inst = enemy.statuses.get('stun');
    if (!inst) {
      inst = makeInstance('stun', 0, 0);
      enemy.statuses.set('stun', inst);
    }
    inst.stacks = 1;
    inst.remaining = enemy.stunTime;
    enemy.getHeadCenter(_p);
    _p.y += 0.25;
    this.ctx.fx.burst(_p, 0xffe27a, 8, 1.8, 0.45, 0.08, -1);
    this.emitApplied(enemy, 'stun', 1);
    return true;
  }

  private emitApplied(enemy: IEnemy, status: StatusId, stacks: number): void {
    this.ctx.events.emit('enemy:statusApplied', { enemy, status, stacks });
  }

  // ───────────── 推进 ─────────────

  update(dt: number): void {
    const list = this.ctx.enemies.list;
    let fxBudget = FX_BUDGET_PER_FRAME;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) {
        if (e.statuses.size > 0) e.statuses.clear();
        continue;
      }
      e.slowMult = 1;
      e.damageTakenMult = 1;
      const st = e.statuses;
      if (st.size === 0) continue;
      const d = this.ensure(e);

      // 1) 先写入倍率，让本帧的 DOT 也吃到蚀化的易伤
      let taken = 1;
      let slow = 1;
      const cor = st.get('corrode');
      if (cor) {
        taken *= CORRODE_DAMAGE_TAKEN;
        slow = Math.min(slow, CORRODE_SLOW);
      }
      const sl = st.get('slow');
      if (sl) {
        let strongest = 0;
        let longest = 0;
        for (let k = d.slows.length - 1; k >= 0; k--) {
          const s = d.slows[k];
          s.remaining -= dt;
          if (s.remaining <= 0) {
            d.slows.splice(k, 1);
            continue;
          }
          if (s.power > strongest) strongest = s.power;
          if (s.remaining > longest) longest = s.remaining;
        }
        if (d.slows.length === 0) {
          st.delete('slow');
        } else {
          sl.stacks = d.slows.length;
          sl.remaining = longest;
          sl.power = strongest;
          slow = Math.min(slow, 1 - strongest);
        }
      }
      e.damageTakenMult = taken;
      e.slowMult = slow;

      // 2) 眩晕（stunTime 由 EnemyBase 递减）
      const stun = st.get('stun');
      if (stun) {
        stun.remaining = e.stunTime;
        if (e.stunTime <= 0) st.delete('stun');
      }

      // 3) 雷殛标记
      const sh = st.get('shock');
      if (sh) {
        sh.remaining -= dt;
        if (sh.remaining <= 0) st.delete('shock');
      }

      // 4) 灼烧
      const burn = st.get('burn');
      if (burn) {
        burn.remaining -= dt;
        burn.tickTimer -= dt;
        if (burn.tickTimer <= 0) {
          burn.tickTimer += BURN_TICK;
          this.dot(e, 'fire', sum(d.burnPowers) * BURN_RATIO);
          if (!e.alive) continue;
        }
        if (burn.remaining <= 0) {
          st.delete('burn');
          d.burnPowers.length = 0;
        }
      }

      // 5) 蚀化
      if (cor && st.get('corrode') === cor) {
        cor.remaining -= dt;
        cor.tickTimer -= dt;
        if (cor.tickTimer <= 0) {
          cor.tickTimer += CORRODE_TICK;
          this.dot(e, 'corrode', cor.power * CORRODE_RATIO);
          if (!e.alive) continue;
        }
        if (cor.remaining <= 0) st.delete('corrode');
      }

      // 6) 稀疏的状态粒子
      if (fxBudget > 0 && this.emitFx(e, d, dt)) fxBudget--;
    }
  }

  private dot(e: IEnemy, element: Element, amount: number): void {
    if (!(amount > 0.01)) return;
    e.getHeadCenter(_p);
    _p.x += (Math.random() - 0.5) * e.radius;
    _p.z += (Math.random() - 0.5) * e.radius;
    _p.y += 0.2 + Math.random() * 0.25;
    this.sink.damageEnemy(e, {
      base: amount,
      element,
      source: 'status',
      canCrit: false,
      procDepth: 1,
      point: _p.clone(),
    });
    const key = element === 'fire' ? 'burn' : 'corrode';
    const now = this.ctx.time.now;
    if (now - this.tickSoundAt[key] > 0.22) {
      this.tickSoundAt[key] = now;
      this.ctx.audio.play(key === 'burn' ? 'burn_tick' : 'corrode_tick', { position: e.position, volume: 0.28, pitch: 0.9 + Math.random() * 0.2 });
    }
  }

  /** 返回本帧是否生成了粒子 */
  private emitFx(e: IEnemy, d: StatusData, dt: number): boolean {
    d.fxTimer -= dt;
    if (d.fxTimer > 0) return false;
    const st = e.statuses;
    const burn = st.get('burn');
    const cor = st.get('corrode');
    const shock = st.get('shock');
    if (!burn && !cor && !shock) {
      d.fxTimer = 0.2;
      return false;
    }
    e.getBodyCenter(_p);
    _p.x += (Math.random() - 0.5) * e.radius * 1.3;
    _p.z += (Math.random() - 0.5) * e.radius * 1.3;
    _p.y += (Math.random() - 0.3) * e.height * 0.45;
    if (burn) {
      d.fxTimer = 0.12 + Math.random() * 0.1;
      this.ctx.fx.burst(_p, ELEMENT_COLORS.fire, 1 + burn.stacks, 1.1, 0.5, 0.15, -3.5);
    } else if (cor) {
      d.fxTimer = 0.16 + Math.random() * 0.12;
      this.ctx.fx.burst(_p, ELEMENT_COLORS.corrode, 2, 0.6, 0.65, 0.1, 6);
    } else {
      d.fxTimer = 0.28 + Math.random() * 0.2;
      this.ctx.fx.burst(_p, ELEMENT_COLORS.shock, 2, 3.2, 0.14, 0.05, 0);
    }
    return true;
  }

  // ───────────── 生命周期 ─────────────

  /** 敌人死亡：清掉全部状态 */
  onKilled(enemy: IEnemy): void {
    enemy.statuses.clear();
    this.data.delete(enemy);
  }

  clear(): void {
    this.data = new WeakMap();
    this.queryBuf.length = 0;
    this.tickSoundAt.burn = -1;
    this.tickSoundAt.corrode = -1;
    this.zapSoundAt = -1;
  }

  private ensure(enemy: IEnemy): StatusData {
    let d = this.data.get(enemy);
    if (!d) {
      d = { burnPowers: [], slows: [], chainReadyAt: 0, stunImmuneUntil: -1, fxTimer: Math.random() * 0.1 };
      this.data.set(enemy, d);
    }
    return d;
  }
}

function sum(arr: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}
