/**
 * 战斗核心：伤害管线（倍率 → 暴击 → 分层 → 反馈 → 元素附着 → 吸血 → 击退 → 死亡）、
 * 玩家受伤结算、范围爆炸、状态推进、元素反应与伤害修饰器。
 *
 * 所有伤害一律经过这里（DESIGN.md 14.3）。击杀计数、伤害统计、击杀魂晶、killHeal / killShield / lifesteal
 * 都在这里结算；金币掉落由掉落系统监听 'enemy:killed' 处理。
 *
 * 元素附着统一走私有 attach()：先判定元素反应（ReactionSystem.tryReact，只入队），再照常施加状态。
 * 反应效果在 update() 开头的 reactions.flush() 执行（docs/arsenal-expansion.md 第 2 节）。
 */
import * as THREE from 'three';
import type {
  DamageRequest, DamageResult, DetonateOpts, DetonateOutcome, Element, ExplosionOptions, GameContext,
  ICombat, IEnemy, IncomingDamageModifier, OutgoingDamageModifier, ReactionId, StatusApplyOpts, StatusId,
  TriggerReactionOpts,
} from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01 } from '../core/math';
import {
  applyLayers, ELEMENT_STATUS, isDot, LAYER_COLORS, layerMultiplier, newLayerOutcome,
  SHOCK_MARK_BONUS, statMultiplier, topLayer,
} from './DamageCalc';
import { STATUS_POWER_CAP, StatusSystem } from './Status';
import { HitFeedback } from './Feedback';
import { blastPlayer, explosionShake, lineClear } from './Blast';
import { ReactionSystem } from './Reactions';
import type { AttachSource, ReactionHost } from './Reactions';

/** 单次吸血上限：最大生命的 5%（至少 2 点） */
const LIFESTEAL_CAP_RATIO = 0.05;
/** 爆炸嵌套上限（连锁自爆等） */
const MAX_EXPLODE_DEPTH = 6;
/** 爆炸默认颜色（物理） */
const EXPLOSION_COLOR = 0xffa040;

const _num = new THREE.Vector3();
const _spark = new THREE.Vector3();
const _kb = new THREE.Vector3();
const _c = new THREE.Vector3();

/** 附着来源（attach → tryReact 同步读取后即不再引用，可复用） */
const _hitSrc: AttachSource = { weaponUid: undefined, scale: undefined, point: undefined };
const _applySrc: AttachSource = { weaponUid: undefined, scale: undefined, point: undefined };
const _rxSrc: AttachSource = { weaponUid: undefined, scale: undefined, point: undefined };

export class Combat implements ICombat, ReactionHost {
  private outgoing: OutgoingDamageModifier[] = [];
  private incoming: IncomingDamageModifier[] = [];
  private readonly status: StatusSystem;
  private readonly feedback: HitFeedback;
  private readonly reactions: ReactionSystem;
  private readonly layerOut = newLayerOutcome();
  private explodeDepth = 0;
  private readonly queryBufs: IEnemy[][] = [];
  /** 最近一次 attach 引发的反应（attach 末尾写入，调用方立即读取） */
  private lastReaction: ReactionId | null = null;

  constructor(readonly ctx: GameContext) {
    this.status = new StatusSystem(ctx, this);
    this.feedback = new HitFeedback(ctx);
    this.reactions = new ReactionSystem(ctx, this, this.status, this.feedback);
  }

  // ───────────── 生命周期 ─────────────

  update(dt: number): void {
    // 先执行到期的反应（武器 / 投射物本帧引发的反应同帧可见），再推进状态
    this.reactions.flush();
    this.feedback.flush();
    this.status.update(dt);
    this.feedback.flush();
  }

  /** 换关 / 新开一局：清掉反应队列 / 熔池、状态内部数据与待刷新的反馈。修饰器由安装方自行移除，这里不动。 */
  clear(): void {
    this.reactions.clear();
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

    // 1) 暴击（状态伤害不暴击）
    let isCrit = false;
    if (!statusSource) {
      isCrit = !!req.forceCrit || !!req.headshot || (req.canCrit !== false && ctx.rng.next() < stats.get('critChance'));
    }

    // 2) 倍率（含封脉首领「脉滞」易伤）
    let mult = statMultiplier(stats, enemy, req) * enemy.damageTakenMult * this.reactions.vulnMult(enemy);
    if (req.element === 'shock' && enemy.statuses.has('shock')) mult *= SHOCK_MARK_BONUS;
    if (isCrit) mult *= (req.critMult ?? 2) * stats.mult('critDamagePct');
    mult *= this.outgoingMultiplier(enemy, req, isCrit);
    const raw = Math.max(0, Number.isFinite(req.base) ? req.base : 0) * mult;

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
      reaction: null,
    };

    if (effective <= 0) {
      if (req.base > 0 && !dot) this.feedback.immune(enemy, req.point);
      return result;
    }

    if (result.shieldBroken) {
      ctx.events.emit('enemy:shieldBroken', { enemy });
      enemy.getBodyCenter(_c);
      ctx.fx.burst(_c, LAYER_COLORS.shield, 16, 5, 0.45, 0.09, 3);
      this.feedback.breakSound('shield', _c);
    }
    if (result.armorBroken) {
      ctx.events.emit('enemy:armorBroken', { enemy });
      enemy.getBodyCenter(_c);
      ctx.fx.burst(_c, LAYER_COLORS.armor, 12, 4.5, 0.6, 0.12, 16);
      this.feedback.breakSound('armor', _c);
    }

    // 4) 元素附着与反应判定（放在事件之前，好让监听者看到 statusApplied / reaction）
    if (!statusSource && req.element !== 'none') {
      const chance = (req.elementChance ?? 0) + stats.get('elementChancePct');
      if (chance > 0 && ctx.rng.next() < chance) {
        const sid = ELEMENT_STATUS[req.element];
        if (sid) {
          const power = Math.min(effective, enemy.maxHp * STATUS_POWER_CAP);
          _hitSrc.weaponUid = req.weaponUid;
          if (this.attach(enemy, sid, power, depth, _hitSrc, killed)) result.statusApplied = sid;
          result.reaction = this.lastReaction;
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
    let numPos: THREE.Vector3;
    if (req.point) numPos = req.point;
    else {
      enemy.getHeadCenter(_num);
      _num.y += 0.35;
      numPos = _num;
    }
    this.feedback.number(enemy, numPos, effective, isCrit, req.element, mainLayer);
    if (!dot) {
      const color = req.element !== 'none'
        ? ELEMENT_COLORS[req.element]
        : firstLayer === 'health' ? (enemy.def.color ?? LAYER_COLORS.health) : LAYER_COLORS[firstLayer];
      if (req.point) _spark.copy(req.point);
      else enemy.getBodyCenter(_spark);
      this.feedback.spark(_spark, color, isCrit);
      this.feedback.hitSound(firstLayer, isCrit);
    }
    ctx.run.damageDealt += dealt;

    // 7) 吸血（只对武器直接伤害）
    if (req.source === 'weapon' && depth === 0 && dealt > 0) {
      const ls = stats.get('lifesteal');
      const p = ctx.player;
      if (ls > 0 && p.alive) {
        const cap = Math.max(2, p.maxHp() * LIFESTEAL_CAP_RATIO);
        const heal = Math.min(dealt * ls, cap);
        if (heal > 0) p.heal(heal);
      }
    }

    // 8) 击退
    if (req.knockback && req.knockback > 0 && req.direction) {
      _kb.copy(req.direction).multiplyScalar(req.knockback);
      enemy.knockback(_kb);
    }

    // 9) 死亡（嵌套的监听者可能已经处理过这个敌人）
    if (killed && enemy.alive) this.kill(enemy, result);
    return result;
  }

  private kill(enemy: IEnemy, result: DamageResult): void {
    const ctx = this.ctx;
    this.status.onKilled(enemy);
    try {
      enemy.onKilled(result);
    } catch (err) {
      console.error('[Combat] enemy.onKilled threw', err);
    }
    const run = ctx.run;
    run.kills++;
    const essence = (enemy.def.essence ?? (enemy.isBoss ? 60 : 1)) * (enemy.isElite ? 5 : 1);
    run.essence += essence;

    const p = ctx.player;
    if (p.alive) {
      const kh = p.stats.get('killHeal');
      if (kh > 0) p.heal(kh);
      const ks = p.stats.get('killShield');
      if (ks > 0) p.addShield(ks);
    }
    ctx.events.emit('enemy:killed', { enemy, result });
    this.feedback.killSound(enemy.isElite || enemy.isBoss);
    if (enemy.isElite && !enemy.isBoss) {
      enemy.getBodyCenter(_c);
      explosionShake(ctx, _c, 2, 0.8);
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
    let m = statMultiplier(stats, enemy, req) * enemy.damageTakenMult * this.reactions.vulnMult(enemy);
    if (req.element === 'shock' && enemy.statuses.has('shock')) m *= SHOCK_MARK_BONUS;
    m *= this.outgoingMultiplier(enemy, req, false);
    return m * layerMultiplier(stats, req.element, topLayer(enemy));
  }

  // ───────────── 伤害：敌人 → 玩家 ─────────────

  damagePlayer(amount: number, element: Element, source: IEnemy | null, from?: THREE.Vector3 | null): number {
    const p = this.ctx.player;
    if (!p.alive || !(amount > 0)) return 0;
    let a = amount;
    const mods = this.incoming;
    for (let i = 0; i < mods.length; i++) {
      try {
        const m = mods[i](a, element, source);
        if (Number.isFinite(m)) a *= Math.max(0, m);
      } catch (err) {
        console.error('[Combat] incoming modifier threw', err);
      }
    }
    a *= 1 - clamp(p.stats.get('damageReduction'), 0, 0.8);
    if (!(a > 0)) return 0;
    return p.takeDamage(a, element, source, from ?? null);
  }

  // ───────────── 范围爆炸 ─────────────

  /**
   * 玩家方范围伤害。radius 为最终半径（调用方已计入 explosionRadiusPct）。
   * 伤害按「爆心到敌人胶囊表面」的距离线性衰减到边缘的 falloff 比例；身体中心与头部都被墙挡住的敌人不受伤。
   */
  explode(center: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number {
    const ctx = this.ctx;
    if (!(radius > 0)) return 0;
    const falloff = clamp01(opts?.falloff ?? 0.5);

    if (!opts?.noFx) {
      const color = opts?.color ?? (req.element !== 'none' ? ELEMENT_COLORS[req.element] : EXPLOSION_COLOR);
      ctx.fx.explosion(center, radius, color);
      ctx.audio.play('explosion', { position: center, volume: clamp(0.5 + radius * 0.09, 0.5, 1), pitch: clamp(1.25 - radius * 0.06, 0.75, 1.2) });
      explosionShake(ctx, center, radius);
    }

    let hits = 0;
    if (this.explodeDepth < MAX_EXPLODE_DEPTH) {
      const depth = this.explodeDepth++;
      let buf = this.queryBufs[depth];
      if (!buf) this.queryBufs[depth] = buf = [];
      try {
        const found = ctx.enemies.queryRadius(center, radius, buf);
        if (found !== buf) {
          buf.length = 0;
          for (let i = 0; i < found.length; i++) buf.push(found[i]);
        }
        const exclude = opts?.exclude;
        const baseKb = req.knockback ?? 3 + radius * 1.5;
        const n = buf.length;
        for (let i = 0; i < n; i++) {
          const e = buf[i];
          if (!e.alive || (exclude && exclude.has(e))) continue;
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
          const dir = new THREE.Vector3(dx, 0.35, dz).normalize();
          const point = e.getHeadCenter(new THREE.Vector3());
          point.y += 0.2;
          const r = this.damageEnemy(e, {
            ...req,
            base: req.base * k,
            headshot: false,
            point,
            direction: dir,
            knockback: baseKb * k,
          });
          if (r) hits++;
        }
      } finally {
        buf.length = 0;
        this.explodeDepth--;
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
   * 直接施加状态。burn / shock / corrode 先判定元素反应（强度钳到最大生命 × 0.5）；stun / slow 直接施加。
   * 不会同步造成反应伤害（反应只入队），可在任意事件回调里调用。现有调用不传 opts，行为不变（多了反应判定）。
   */
  applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number, opts?: StatusApplyOpts): void {
    const depth = opts?.depth ?? 0;
    if (id === 'burn' || id === 'shock' || id === 'corrode') {
      _applySrc.weaponUid = opts?.weaponUid;
      _applySrc.scale = opts?.reactionScale;
      this.attach(enemy, id, Math.min(power, enemy.maxHp * STATUS_POWER_CAP), depth, _applySrc, false, duration);
    } else {
      this.status.apply(enemy, id, power, duration, depth);
    }
  }

  // ───────────── 元素反应 ─────────────

  /**
   * 元素附着的统一入口：先判定反应（必须在 apply 之前——雷殛第 3 层会自删并眩晕；击杀那一击状态还没清空），
   * 再照常施加。killed（击杀那一击）时状态没有意义，只做雷殛弹射（现有规则）。
   * 返回状态是否施加成功；引发的反应写入 this.lastReaction（末尾写，嵌套调用不会覆盖调用方读到的值）。
   */
  private attach(
    enemy: IEnemy, sid: StatusId, power: number, depth: number, src: AttachSource | null, killed: boolean, duration?: number,
  ): boolean {
    const rx = sid === 'burn' || sid === 'shock' || sid === 'corrode'
      ? this.reactions.tryReact(enemy, sid, power, depth, src, killed)
      : null;
    let applied = false;
    if (killed) {
      if (sid === 'shock') {
        this.status.chainFrom(enemy, power, depth);
        applied = true;
      }
    } else {
      applied = this.status.apply(enemy, sid, power, duration, depth);
    }
    this.lastReaction = rx;
    return applied;
  }

  /** ReactionHost：反应扩散出去的元素（焚雷点燃、熔池附蚀、封脉导流），同样会判定反应 */
  attachFromReaction(enemy: IEnemy, sid: 'burn' | 'shock' | 'corrode', power: number, depth: number, weaponUid?: number): void {
    _rxSrc.weaponUid = weaponUid;
    this.attach(enemy, sid, Math.min(power, enemy.maxHp * STATUS_POWER_CAP), depth, _rxSrc, false);
  }

  triggerReaction(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean {
    return this.reactions.trigger(enemy, id, power, opts);
  }

  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null {
    return this.reactions.detonate(enemy, opts);
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

  addIncomingModifier(fn: IncomingDamageModifier): () => void {
    this.incoming = [...this.incoming, fn];
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
