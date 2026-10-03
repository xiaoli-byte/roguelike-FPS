/**
 * 战斗核心：伤害管线（倍率 → 暴击 → 分层 → 反馈 → 元素附着 → 吸血 → 击退 → 死亡）、
 * 玩家受伤结算、范围爆炸、状态推进与伤害修饰器。
 *
 * 所有伤害一律经过这里（DESIGN.md 14.3）。击杀计数、伤害统计、击杀魂晶、killHeal / killShield / lifesteal
 * 都在这里结算；金币掉落由掉落系统监听 'enemy:killed' 处理。
 * 不可选中（enemy.untargetable）的敌人不受任何伤害与状态；带 'purge' 标签的静默处决不计入玩家战果（见 PURGE_TAG）。
 *
 * 事件顺序（同步）：enemy:shieldBroken / enemy:armorBroken → enemy:statusApplied → enemy:damaged →
 * enemy:killed（此时 enemy.statuses 仍保留死亡瞬间的状态，派发完才清空）。
 */
import * as THREE from 'three';
import type {
  DamageRequest, DamageResult, Element, ExplosionOptions, GameContext, ICombat, IEnemy,
  IncomingDamageModifier, OutgoingDamageModifier, StatusId,
} from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01 } from '../core/math';
import {
  applyLayers, dotStatMultiplier, ELEMENT_STATUS, hasTag, isDot, LAYER_COLORS, layerMultiplier, newLayerOutcome,
  SHOCK_MARK_BONUS, statMultiplier, topLayer, withTag,
} from './DamageCalc';
import { STATUS_POWER_CAP, StatusSystem } from './Status';
import { HitFeedback } from './Feedback';
import { blastPlayer, explosionShake, lineClear } from './Blast';

/** 单次吸血上限：最大生命的 5%（至少 2 点） */
const LIFESTEAL_CAP_RATIO = 0.05;
/** 爆炸嵌套上限（连锁自爆等） */
const MAX_EXPLODE_DEPTH = 6;
/** 爆炸默认颜色（物理） */
const EXPLOSION_COLOR = 0xffa040;
/**
 * 「处决」：基础伤害达到此值，或带 'purge' 标签（EnemyManager.killAll 清场）。
 * 照常结算，但不弹伤害数字、命中火花与命中 / 击杀音效（敌人自己的死亡特效照常），
 * 避免首领倒下时残余爪牙一齐冒数字、刷音效。
 */
const EXECUTE_BASE = 1e6;
/**
 * 'purge'（静默处决）在「处决」之外还不算玩家的战果：不附着元素、不吸血、不计伤害统计、
 * 不派发破盾 / 破甲事件，击杀时不计击杀数、不给魂晶、不触发 killHeal / killShield。
 * enemy:damaged / enemy:killed 照常派发（result.request 带原请求），由监听者自行按 tags 过滤。
 */
const PURGE_TAG = 'purge';

function isExecute(req: DamageRequest, base: number): boolean {
  return !(base < EXECUTE_BASE) || hasTag(req, PURGE_TAG);
}

const _num = new THREE.Vector3();
const _spark = new THREE.Vector3();
const _kb = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Combat implements ICombat {
  private outgoing: OutgoingDamageModifier[] = [];
  private incoming: IncomingDamageModifier[] = [];
  private readonly status: StatusSystem;
  private readonly feedback: HitFeedback;
  private readonly layerOut = newLayerOutcome();
  private explodeDepth = 0;
  /** 按 explode 嵌套深度分配的复用缓冲：查询结果与爆心副本 */
  private readonly queryBufs: IEnemy[][] = [];
  private readonly centerBufs: THREE.Vector3[] = [];

  constructor(readonly ctx: GameContext) {
    this.status = new StatusSystem(ctx, this);
    this.feedback = new HitFeedback(ctx);
  }

  // ───────────── 生命周期 ─────────────

  update(dt: number): void {
    this.feedback.flush();
    this.status.update(dt);
    this.feedback.flush();
  }

  /** 换关 / 新开一局：清掉状态内部数据与待刷新的反馈。修饰器由安装方自行移除，这里不动。 */
  clear(): void {
    this.status.clear();
    this.feedback.clear();
    this.explodeDepth = 0;
    for (const b of this.queryBufs) b.length = 0;
  }

  // ───────────── 伤害：玩家 → 敌人 ─────────────

  damageEnemy(enemy: IEnemy, req: DamageRequest): DamageResult | null {
    // hp <= 0 但仍 alive：正处于本帧的击杀结算中（嵌套调用），不再重复处理
    if (!enemy.alive || enemy.hp <= 0) return null;
    const ctx = this.ctx;
    const stats = ctx.player.stats;
    const statusSource = req.source === 'status';
    const dot = isDot(req);
    const depth = req.procDepth ?? 0;
    const base = Number.isFinite(req.base) ? Math.max(0, req.base) : 0;
    const purge = hasTag(req, PURGE_TAG);
    const execute = purge || isExecute(req, base);

    // 0) 不可选中（首领登场 / 转阶段等）：完全不结算。
    //    直接命中给一个「免疫」提示（同一敌人 0.4 秒最多一次）；DOT 跳伤与处决不提示
    if (enemy.untargetable) {
      if (base > 0 && !dot && !execute) this.feedback.immune(enemy, req.point);
      return null;
    }

    // 1) 暴击（状态伤害不暴击）
    let isCrit = false;
    if (!statusSource) {
      isCrit = !!req.forceCrit || !!req.headshot || (req.canCrit !== false && ctx.rng.next() < stats.get('critChance'));
    }

    // 2) 倍率
    let mult = statMultiplier(stats, enemy, req) * enemy.damageTakenMult;
    if (req.element === 'shock' && enemy.statuses.has('shock')) mult *= SHOCK_MARK_BONUS;
    if (isCrit) mult *= (Number.isFinite(req.critMult) ? Math.max(0, req.critMult!) : 2) * stats.mult('critDamagePct');
    mult *= this.outgoingMultiplier(enemy, req, isCrit);
    let raw = base * mult;
    if (!Number.isFinite(raw) || raw < 0) raw = 0;

    // 3) 分层结算（护盾 → 护甲 → 生命）
    const lo = applyLayers(stats, enemy, raw, req.element, this.layerOut);
    const dealt = lo.dealt;
    const effective = lo.effective;
    const firstLayer = lo.firstLayer;
    const mainLayer = lo.mainLayer;
    const killed = enemy.hp <= 0;
    const result: DamageResult = {
      request: req,
      dealt,
      isCrit,
      killed,
      layer: firstLayer,
      shieldBroken: lo.shieldBroken,
      armorBroken: lo.armorBroken,
      element: req.element,
      statusApplied: null,
    };

    if (effective <= 0) {
      if (base > 0 && !dot && !execute) this.feedback.immune(enemy, req.point);
      return result;
    }

    // 以下全是副作用：任何一步抛错都不能让「血量已归零但没死」的僵尸敌人留下来（会卡住清关）
    try {
      this.afterHit(enemy, req, result, effective, mainLayer, depth, dot, execute, purge);
    } catch (err) {
      console.error('[Combat] damage side effects threw', err);
    }

    // 9) 死亡（嵌套的监听者可能已经处理过这个敌人）
    if (killed && enemy.alive) this.kill(enemy, result);
    return result;
  }

  /** 分层结算之后的全部副作用：破层反馈、元素附着、回调与事件、伤害数字、吸血、击退 */
  private afterHit(
    enemy: IEnemy, req: DamageRequest, result: DamageResult, effective: number, mainLayer: DamageResult['layer'],
    depth: number, dot: boolean, execute: boolean, purge: boolean,
  ): void {
    const ctx = this.ctx;
    const stats = ctx.player.stats;
    const killed = result.killed;
    const firstLayer = result.layer;

    // 破盾 / 破甲事件不带请求，监听者无法识别静默处决，所以 purge 时不派发（result 上的标记照常保留）
    if (result.shieldBroken && !purge) {
      ctx.events.emit('enemy:shieldBroken', { enemy });
      if (!execute) {
        enemy.getBodyCenter(_c);
        ctx.fx.burst(_c, LAYER_COLORS.shield, 16, 5, 0.45, 0.09, 3);
        this.feedback.breakSound('shield', _c);
      }
    }
    if (result.armorBroken && !purge) {
      ctx.events.emit('enemy:armorBroken', { enemy });
      if (!execute) {
        enemy.getBodyCenter(_c);
        ctx.fx.burst(_c, LAYER_COLORS.armor, 12, 4.5, 0.6, 0.12, 16);
        this.feedback.breakSound('armor', _c);
      }
    }

    // 4) 元素附着（放在事件之前，好让监听者看到 statusApplied）
    if (!purge && req.source !== 'status' && req.element !== 'none') {
      const chance = (req.elementChance ?? 0) + stats.get('elementChancePct');
      if (chance > 0 && ctx.rng.next() < chance) {
        const sid = ELEMENT_STATUS[req.element];
        if (sid) {
          // power = 这一击的最终伤害（上限为最大生命 × 0.5），再除掉每一跳会重新乘上的属性倍率，避免重复计算
          const power = Math.min(effective, enemy.maxHp * STATUS_POWER_CAP) / dotStatMultiplier(stats, enemy, req.element);
          if (killed) {
            // 击杀的一击：附着没有意义，但直接命中（procDepth 0）的雷殛照样弹射
            if (sid === 'shock' && depth <= 0) {
              this.status.chainFrom(enemy, power, depth);
              result.statusApplied = sid;
            }
          } else if (this.status.apply(enemy, sid, power, undefined, depth)) {
            result.statusApplied = sid;
          }
        }
      }
    }

    // 5) 回调与事件
    try {
      enemy.onDamaged(result);
    } catch (err) {
      console.error('[Combat] enemy.onDamaged threw', err);
    }
    ctx.events.emit('enemy:damaged', { enemy, result });

    // 6) 反馈：伤害数字、命中火花、音效
    if (!execute) {
      let numPos: THREE.Vector3;
      if (req.point) numPos = req.point;
      else {
        enemy.getHeadCenter(_num);
        _num.y += 0.35;
        numPos = _num;
      }
      // DOT 跳伤（灼烧 / 蚀化）标记为 dot：小一号、暗一些、不弹跳；雷殛弹射按直接命中显示
      this.feedback.number(enemy, numPos, effective, result.isCrit, req.element, mainLayer, dot);
      if (!dot) {
        const color = req.element !== 'none'
          ? ELEMENT_COLORS[req.element]
          : firstLayer === 'health' ? (enemy.def.color ?? LAYER_COLORS.health) : LAYER_COLORS[firstLayer];
        if (req.point) _spark.copy(req.point);
        else enemy.getBodyCenter(_spark);
        this.feedback.spark(_spark, color, result.isCrit);
        this.feedback.hitSound(firstLayer, result.isCrit);
      }
    }
    if (!purge) ctx.run.damageDealt += result.dealt;

    // 7) 吸血（只对武器直接伤害，含武器投射物的爆炸；静默处决不吸）
    if (!purge && req.source === 'weapon' && depth === 0 && result.dealt > 0) {
      const ls = stats.get('lifesteal');
      const p = ctx.player;
      if (ls > 0 && p.alive) {
        const cap = Math.max(2, p.maxHp() * LIFESTEAL_CAP_RATIO);
        const heal = Math.min(result.dealt * ls, cap);
        if (heal > 0) p.heal(heal);
      }
    }

    // 8) 击退
    const kb = req.knockback;
    if (kb !== undefined && kb > 0 && Number.isFinite(kb) && req.direction && enemy.alive) {
      _kb.copy(req.direction).multiplyScalar(kb);
      enemy.knockback(_kb);
    }
  }

  private kill(enemy: IEnemy, result: DamageResult): void {
    const ctx = this.ctx;
    try {
      enemy.onKilled(result);
    } catch (err) {
      console.error('[Combat] enemy.onKilled threw', err);
    }
    // 子类回调抛错也必须让它死透，否则 aliveCount 永远不归零
    if (enemy.alive) enemy.alive = false;

    // 静默处决（清场）不算玩家的击杀：不计击杀数、不给魂晶、不触发击杀回复（与 EnemyManager.forceKill 口径一致）
    if (!hasTag(result.request, PURGE_TAG)) {
      const run = ctx.run;
      run.kills++;
      const essence = (enemy.def.essence ?? (enemy.isBoss ? 60 : 1)) * (enemy.isElite ? 5 : 1);
      if (essence > 0 && Number.isFinite(essence)) run.essence += essence;

      const p = ctx.player;
      try {
        if (p.alive) {
          const kh = p.stats.get('killHeal');
          if (kh > 0) p.heal(kh);
          const ks = p.stats.get('killShield');
          if (ks > 0) p.addShield(ks);
        }
      } catch (err) {
        console.error('[Combat] kill rewards threw', err);
      }
    }
    // 监听者（秘卷「野火燎原」「蚀爆」等）需要看到死亡瞬间的状态，所以事件派发完再清空
    ctx.events.emit('enemy:killed', { enemy, result });
    this.status.onKilled(enemy);
    if (isExecute(result.request, result.request.base)) return;
    try {
      this.feedback.killSound(enemy.isElite || enemy.isBoss);
      if (enemy.isElite && !enemy.isBoss) {
        enemy.getBodyCenter(_c);
        explosionShake(ctx, _c, 2, 0.8);
      }
    } catch (err) {
      console.error('[Combat] kill feedback threw', err);
    }
  }

  private outgoingMultiplier(enemy: IEnemy, req: DamageRequest, isCrit: boolean): number {
    const mods = this.outgoing;
    let m = 1;
    for (let i = 0; i < mods.length; i++) {
      try {
        const f = mods[i](enemy, req, isCrit);
        if (Number.isFinite(f)) m *= Math.max(0, f);
      } catch (err) {
        console.error('[Combat] outgoing modifier threw', err);
      }
    }
    return m;
  }

  previewMultiplier(enemy: IEnemy, req: DamageRequest): number {
    const stats = this.ctx.player.stats;
    let m = statMultiplier(stats, enemy, req) * enemy.damageTakenMult;
    if (req.element === 'shock' && enemy.statuses.has('shock')) m *= SHOCK_MARK_BONUS;
    m *= this.outgoingMultiplier(enemy, req, false);
    return m * layerMultiplier(stats, req.element, topLayer(enemy));
  }

  // ───────────── 伤害：敌人 → 玩家 ─────────────

  /**
   * 结算顺序：无敌 → 减伤（damageReduction，钳制到 [0, 0.8]）→ incoming 修饰器 → player.takeDamage。
   * 修饰器拿到的 amount 是已经算过减伤、以及所有「不看 amount」的修饰器（零参数函数）之后的值，
   * 因此「致命伤害」类判断（绝处逢生）看到的就是最终伤害。
   */
  damagePlayer(amount: number, element: Element, source: IEnemy | null, from?: THREE.Vector3 | null): number {
    const p = this.ctx.player;
    if (!p.alive || !(amount > 0) || !Number.isFinite(amount)) return 0;
    // 无敌（冲刺无敌帧、调试无敌、绝处逢生后的保护）：不扣血，也不触发修饰器的副作用
    if (p.invulnerableTime > 0) return 0;
    let a = amount * (1 - clamp(p.stats.get('damageReduction') || 0, 0, 0.8));
    const mods = this.incoming;
    for (let i = 0; i < mods.length && a > 0; i++) {
      try {
        const m = mods[i](a, element, source);
        if (Number.isFinite(m)) a *= Math.max(0, m);
      } catch (err) {
        console.error('[Combat] incoming modifier threw', err);
      }
    }
    if (!(a > 0)) return 0;
    return p.takeDamage(a, element, source, from ?? null);
  }

  // ───────────── 范围爆炸 ─────────────

  /**
   * 玩家方范围伤害。radius 为最终半径（调用方已计入 explosionRadiusPct）。
   * - 伤害按「爆心到敌人胶囊表面」的距离线性衰减到边缘的 falloff 比例；身体中心与头部都被墙挡住的敌人不受伤。
   * - 每个敌人收到的请求都带 'explosion' 标签（吃 explosionDamagePct），source / weaponUid / procDepth 保持原样。
   * - 击退只在 req.knockback 指定时施加（沿爆心向外，随距离衰减）；未指定 = 不击退，调用方可以自己推。
   * - 未设 noFx 时播放爆炸特效与音效（爆炸震屏由 fx.explosion 负责）。
   */
  explode(centerIn: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number {
    const ctx = this.ctx;
    if (!(radius > 0) || !Number.isFinite(radius)) return 0;
    if (!Number.isFinite(centerIn.x + centerIn.y + centerIn.z)) return 0;
    // 防止「玩家受伤 → 监听者再引爆 → 再伤玩家」之类的失控递归（超过敌人结算上限的嵌套只播特效和伤玩家）
    if (this.explodeDepth >= MAX_EXPLODE_DEPTH * 2) return 0;

    // 本次爆炸的嵌套层：整个函数（含末尾的 playerDamage）期间都占着，嵌套的 explode 拿到更深的一层
    const depth = this.explodeDepth++;
    try {
      // 结算期间 damageEnemy 会同步派发事件，监听者可能改写调用方传进来的共享临时向量：
      // 先拷到本层专用的临时向量（与 queryBufs 同样按深度分配），之后循环与 playerDamage 只用这份副本
      let center = this.centerBufs[depth];
      if (!center) this.centerBufs[depth] = center = new THREE.Vector3();
      center.copy(centerIn);
      return this.explodeAt(depth, center, radius, req, opts);
    } finally {
      this.explodeDepth = Math.max(0, this.explodeDepth - 1);
    }
  }

  private explodeAt(depth: number, center: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number {
    const ctx = this.ctx;
    const falloff = clamp01(opts?.falloff ?? 0.5);

    if (!opts?.noFx) {
      const color = opts?.color ?? (req.element !== 'none' ? ELEMENT_COLORS[req.element] : EXPLOSION_COLOR);
      ctx.fx.explosion(center, radius, color);
      ctx.audio.play('explosion', { position: center, volume: clamp(0.5 + radius * 0.09, 0.5, 1), pitch: clamp(1.25 - radius * 0.06, 0.75, 1.2) });
    }

    let hits = 0;
    if (depth < MAX_EXPLODE_DEPTH) {
      let buf = this.queryBufs[depth];
      if (!buf) this.queryBufs[depth] = buf = [];
      try {
        const found = ctx.enemies.queryRadius(center, radius, buf);
        if (found !== buf) {
          buf.length = 0;
          for (let i = 0; i < found.length; i++) buf.push(found[i]);
        }
        const exclude = opts?.exclude;
        const kb0 = req.knockback !== undefined && Number.isFinite(req.knockback) ? Math.max(0, req.knockback) : 0;
        const tags = req.source === 'explosion' || hasTag(req, 'explosion') ? req.tags : withTag(req.tags, 'explosion');
        const n = buf.length;
        for (let i = 0; i < n; i++) {
          const e = buf[i];
          // 不可选中的敌人（queryRadius 本应已跳过）不吃爆炸，也不刷「免疫」提示
          if (!e.alive || e.untargetable || (exclude && exclude.has(e))) continue;
          if (!this.exposed(e, center)) continue;
          // 距离按爆心到敌人竖直胶囊轴线的最近点计算（高大的首领在脚边挨炸也吃满伤害）
          const py = e.position.y;
          const lo = py + Math.min(e.radius, e.height * 0.5);
          const hi = Math.max(lo, py + e.height - e.radius);
          let dx = e.position.x - center.x;
          const dy = clamp(center.y, lo, hi) - center.y;
          let dz = e.position.z - center.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const surf = Math.max(0, dist - e.radius);
          const k = 1 - (1 - falloff) * clamp01(surf / radius);
          const h = Math.hypot(dx, dz);
          if (h > 1e-3) {
            dx /= h;
            dz /= h;
          } else {
            const a = Math.random() * Math.PI * 2;
            dx = Math.cos(a);
            dz = Math.sin(a);
          }
          // point / direction 交给事件监听者，可能被保留，所以每个敌人各自新建
          const dir = new THREE.Vector3(dx, 0.35, dz).normalize();
          const point = e.getHeadCenter(new THREE.Vector3());
          point.y += 0.2;
          const r = this.damageEnemy(e, {
            ...req,
            base: req.base * k,
            tags,
            headshot: false,
            point,
            direction: dir,
            knockback: kb0 * k,
          });
          if (r) hits++;
        }
      } finally {
        buf.length = 0;
      }
    }

    const pd = opts?.playerDamage ?? 0;
    if (pd > 0) blastPlayer(ctx, center, radius, pd, falloff, req.element, null);
    return hits;
  }

  /** 爆心能否打到敌人：身体中心或头部任一点无遮挡即可 */
  private exposed(e: IEnemy, center: THREE.Vector3): boolean {
    e.getBodyCenter(_c);
    if (lineClear(this.ctx.world, _c, center)) return true;
    e.getHeadCenter(_c);
    return lineClear(this.ctx.world, _c, center);
  }

  // ───────────── 状态 / 修饰器 ─────────────

  /**
   * 直接施加状态。burn / shock / corrode 的 power 视为「未计入元素伤害属性」的强度，每一跳结算时再乘元素 / 精英 / 首领加成；
   * slow 的 power 为减速比例（0.3 = −30%）；stun 只看 duration（首领与精英有抗性）。
   * 不可选中（enemy.untargetable）的敌人直接忽略；enemy.stunImmune 时 stun 直接忽略（不播特效、不派发事件）。
   */
  applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number): void {
    if (enemy.untargetable) return;
    this.status.apply(enemy, id, power, duration, 0);
  }

  addOutgoingModifier(fn: OutgoingDamageModifier): () => void {
    this.outgoing = [...this.outgoing, fn];
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const i = this.outgoing.indexOf(fn);
      if (i >= 0) {
        const next = this.outgoing.slice();
        next.splice(i, 1);
        this.outgoing = next;
      }
    };
  }

  /**
   * 注册受伤修饰器。不读取 amount 的修饰器（零参数函数，例如固定 ×0.5 减伤）排在前面，
   * 读取 amount 的排在后面，让后者看到尽量接近最终值的伤害。同类之间保持注册顺序。
   */
  addIncomingModifier(fn: IncomingDamageModifier): () => void {
    const list = this.incoming.slice();
    if (fn.length === 0) {
      let i = 0;
      while (i < list.length && list[i].length === 0) i++;
      list.splice(i, 0, fn);
    } else {
      list.push(fn);
    }
    this.incoming = list;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const i = this.incoming.indexOf(fn);
      if (i >= 0) {
        const next = this.incoming.slice();
        next.splice(i, 1);
        this.incoming = next;
      }
    };
  }
}
