/**
 * 战斗核心：伤害管线（倍率 → 暴击 → 分层 → 反馈 → 元素附着 → 吸血 → 击退 → 死亡）、
 * 玩家受伤结算、范围爆炸、状态推进、元素反应与伤害修饰器。
 *
 * 所有伤害一律经过这里（DESIGN.md 14.3）。击杀计数、伤害统计、击杀魂晶、killHeal / killShield / lifesteal
 * 都在这里结算；金币掉落由掉落系统监听 'enemy:killed' 处理。
 * 不可选中（enemy.untargetable）的敌人不受任何伤害、状态与元素反应；带 'purge' 标签的静默处决不计入玩家战果（见 PURGE_TAG）。
 *
 * 事件顺序（同步）：enemy:shieldBroken / enemy:armorBroken → enemy:statusApplied → enemy:damaged →
 * enemy:killed（此时 enemy.statuses 仍保留死亡瞬间的状态，派发完才清空）。
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
  applyLayers, dotStatMultiplier, ELEMENT_STATUS, hasTag, isDot, isPetHit, LAYER_COLORS, layerMultiplier, newLayerOutcome,
  REACTION_TAG, SHOCK_MARK_BONUS, statMultiplier, topLayer, withTag,
  reactionPowerFromStatus,
} from './DamageCalc';
import { forcedWeakpoint } from './PetContract';
import { BLOCK_BELOW, type HitZoneSet } from './HitZone';
import { ChargeSystem } from './Charge';
import { STATUS_DOT_ELEMENT, STATUS_POWER_CAP, StatusSystem } from './Status';
import { HitFeedback } from './Feedback';
import { blastPlayer, explosionShake, lineClear } from './Blast';
import { scaleKillEssence } from '../progression/RewardScale';
import { ReactionSystem } from './Reactions';
import type { AttachSource, ReactionHost } from './Reactions';

/** 单次吸血上限：最大生命的 5%（至少 2 点） */
const LIFESTEAL_CAP_RATIO = 0.05;
/** 爆炸嵌套上限（连锁自爆等） */
const MAX_EXPLODE_DEPTH = 6;
/** 同一敌人两次「免疫」提示的最短间隔（Unity Combat.ImmuneFeedbackGap） */
export const IMMUNE_FEEDBACK_GAP = 0.4;
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
  /** 按 explode 嵌套深度分配的复用缓冲：查询结果与爆心副本 */
  private readonly queryBufs: IEnemy[][] = [];
  private readonly centerBufs: THREE.Vector3[] = [];
  /** 最近一次 attach 引发的反应（attach 末尾写入，调用方立即读取） */
  private lastReaction: ReactionId | null = null;
  /** 同一敌人上一次放行「免疫」提示的时间（Unity Combat.immuneAt：0.4 s 节流，只有放行的那一次派发 enemy:damaged） */
  private immuneAt = new WeakMap<IEnemy, number>();

  /** 第四章「带电」（Unity Charge / ChargeState）：账本、死亡传电、噼啪；反应判定经 isCharged 读 */
  readonly charge: ChargeSystem;

  constructor(readonly ctx: GameContext) {
    this.status = new StatusSystem(ctx, this);
    this.feedback = new HitFeedback(ctx);
    this.reactions = new ReactionSystem(ctx, this, this.status, this.feedback);
    this.charge = new ChargeSystem(ctx);
  }

  // ───────────── 生命周期 ─────────────

  update(dt: number): void {
    // 先执行到期的反应（武器 / 投射物本帧引发的反应同帧可见），再推进状态
    this.reactions.flush();
    this.feedback.flush();
    this.status.update(dt);
    this.charge.update(dt);
    this.feedback.flush();
  }

  /** 换关 / 新开一局：清掉反应队列 / 熔池、状态内部数据与待刷新的反馈。修饰器由安装方自行移除，这里不动。 */
  clear(): void {
    this.reactions.clear();
    this.status.clear();
    this.charge.clear();
    this.feedback.clear();
    this.immuneAt = new WeakMap();
    this.explodeDepth = 0;
    for (const b of this.queryBufs) b.length = 0;
  }

  /** ReactionHost：带电就反应而言等同带雷殛 */
  isCharged(enemy: IEnemy): boolean {
    return this.charge.isCharged(enemy);
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

    // 0) 不可选中（首领登场 / 转阶段、出生 0.7 s 等）：完全不结算，返回 immune 结果（Unity Combat.Immune）。
    //    直接命中给一个「免疫」提示并派发 enemy:damaged（同一敌人 0.4 秒最多一次）；DOT 跳伤与处决不提示
    if (enemy.untargetable) return this.immune(enemy, req, base, dot, execute);

    // 1) 弱点与暴击（Unity Combat.DamageEnemy）：命中弱点或被改判为弱点（白泽，PetContract）必暴；
    //    状态 / 反应伤害不暴击；灵宠不随机暴击（灵宠自己决定 forceCrit）
    const reaction = hasTag(req, REACTION_TAG);
    const weak = !!req.headshot || forcedWeakpoint(enemy, req, reaction);
    let isCrit = false;
    if (!statusSource && !reaction) {
      isCrit = !!req.forceCrit || weak || (req.canCrit !== false && !isPetHit(req) && ctx.rng.next() < stats.get('critChance'));
    }

    // 2) 倍率（含封脉首领「脉滞」易伤）
    let mult = statMultiplier(stats, enemy, req) * enemy.damageTakenMult * this.reactions.vulnMult(enemy);
    // 弱点：敌人自己的弱点区倍率（夔的鼓心、旱魃的日核…，同 Unity 命中盒 multiplier）× 玩家「弱点伤害」
    if (req.headshot) mult *= enemy.weakpointDamageMult ?? 1;
    if (weak) mult *= stats.mult('weakpointDamagePct');
    if (req.element === 'shock' && enemy.statuses.has('shock')) mult *= SHOCK_MARK_BONUS;
    if (isCrit) mult *= (Number.isFinite(req.critMult) ? Math.max(0, req.critMult!) : 2) * stats.mult('critDamagePct');
    mult *= this.outgoingMultiplier(enemy, req, isCrit);
    // 命中区（Unity EnemyBody.ZoneIncoming）：按命中点分区、乘这一区的倍率（朝向门外 ×1），< 0.5 记为格挡；持续伤害不算区
    const zones = statusSource ? null : (enemy as { hitZones?: HitZoneSet | null }).hitZones ?? null;
    const zone = zones ? zones.zoneAt(req.point, !!req.headshot) : null;
    let blocked = false;
    if (zone) {
      const zm = zone.multiplierFor(req.direction);
      if (Number.isFinite(zm)) mult *= Math.max(0, zm);
      blocked = zm < BLOCK_BELOW;
    }
    let raw = base * mult;
    if (!Number.isFinite(raw) || raw < 0) raw = 0;

    // 3) 分层结算（护盾 → 护甲 → 生命）
    const lo = applyLayers(stats, enemy, raw, req.element, this.layerOut, req.bypassShield === true);
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
    if (blocked) result.blocked = true;
    // 命中区计数（Unity EnemyBody.OnDamaged：免疫的不算，打出伤害或格挡才记）
    if (zone && (dealt > 0 || blocked)) zone.record(dealt, blocked);

    if (effective <= 0) {
      // 整发被命中区格挡掉：弹「格挡」（Unity DamageNumbers：blocked && total < 1 → Kind.Blocked，处决不弹）并照样派发
      // （Unity Combat：total > 0 || immune || blocked 才发 EnemyDamaged）。没被格挡的 0 伤害 Unity 不发事件、不弹字，这里也一样；
      // 「免疫」只留给不可选中（上面第 0 步）
      if (blocked) {
        if (!execute) this.feedback.blocked(enemy, req.point);
        ctx.events.emit('enemy:damaged', { enemy, result });
      }
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

  /**
   * 不可选中的敌人挨打（Unity Combat.Immune）：不结算（不掷暴击、不跑修饰器、不附着、不吸血），返回 immune = true 的结果。
   * 直接命中给「免疫」提示——同一敌人 0.4 s 最多一次，只有放行的这一次才派发 enemy:damaged；持续伤害跳伤、处决、0 伤害不提示。
   */
  private immune(enemy: IEnemy, req: DamageRequest, base: number, dot: boolean, execute: boolean): DamageResult {
    const result: DamageResult = {
      request: req,
      dealt: 0,
      isCrit: false,
      killed: false,
      layer: 'health',
      shieldBroken: false,
      armorBroken: false,
      element: req.element,
      statusApplied: null,
      reaction: null,
      immune: true,
    };
    if (!(base > 0) || dot || execute) return result;
    const now = this.ctx.time.now;
    const last = this.immuneAt.get(enemy);
    if (last !== undefined && now - last < IMMUNE_FEEDBACK_GAP && now >= last) return result;
    this.immuneAt.set(enemy, now);
    this.feedback.immune(enemy, req.point);
    this.ctx.events.emit('enemy:damaged', { enemy, result });
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

    // 4) 元素附着与反应判定（放在事件之前，好让监听者看到 statusApplied / reaction）
    if (!purge && req.source !== 'status' && req.element !== 'none') {
      const chance = (req.elementChance ?? 0) + stats.get('elementChancePct');
      if (chance > 0 && ctx.rng.next() < chance) {
        const sid = ELEMENT_STATUS[req.element];
        if (sid) {
          // 反应强度 = 这一击的最终伤害（上限为最大生命 × 0.5）：反应伤害带反应标签，只再乘 reactionDamagePct
          const pin = Math.min(effective, enemy.maxHp * STATUS_POWER_CAP);
          // 状态强度再除掉每一跳会重新乘上的属性倍率，避免重复计算
          const power = pin / dotStatMultiplier(stats, enemy, req.element);
          _hitSrc.weaponUid = req.weaponUid;
          if (this.attach(enemy, sid, power, depth, _hitSrc, killed, undefined, pin)) result.statusApplied = sid;
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
    if (!execute) {
      let numPos: THREE.Vector3;
      if (req.point) numPos = req.point;
      else {
        enemy.getHeadCenter(_num);
        _num.y += 0.35;
        numPos = _num;
      }
      // DOT 跳伤（灼烧 / 蚀化）标记为 dot：小一号、暗一些、不弹跳；雷殛弹射按直接命中显示。
      // 被格挡且总伤害不足 1：弹「格挡」不弹数字（Unity DamageNumbers：r.blocked && r.total < 1）
      if (result.blocked && result.dealt < 1) this.feedback.blocked(enemy, numPos);
      else this.feedback.number(enemy, numPos, effective, result.isCrit, req.element, mainLayer, dot);
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
      // 据点加量摊薄 / 驻守点减半 / 游荡怪每关上限（Unity KillResolver + RewardScale）
      const essence = scaleKillEssence(enemy, (enemy.def.essence ?? (enemy.isBoss ? 60 : 1)) * (enemy.isElite ? 5 : 1));
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
    let m = statMultiplier(stats, enemy, req) * enemy.damageTakenMult * this.reactions.vulnMult(enemy);
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
          if (r && !r.immune) hits++;
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
   * 由命中 / 反应伤害换算时用 statusPowerFromDealt（DamageCalc）。引发反应的强度 = power 乘回这些加成；
   * 施加前先判定元素反应（强度钳到最大生命 × 0.5；反应只入队，不会同步造成反应伤害，可在任意事件回调里调用）。
   * slow 的 power 为减速比例（0.3 = −30%）；stun 只看 duration（首领与精英有抗性）。stun / slow 不判定反应。
   * 不可选中（enemy.untargetable）的敌人直接忽略；enemy.stunImmune 时 stun 直接忽略（不播特效、不派发事件）。
   * 现有调用不传 opts，行为不变（多了反应判定）。
   */
  applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number, opts?: StatusApplyOpts): void {
    if (enemy.untargetable) return;
    const depth = opts?.depth ?? 0;
    if (id === 'burn' || id === 'shock' || id === 'corrode') {
      _applySrc.weaponUid = opts?.weaponUid;
      _applySrc.scale = opts?.reactionScale;
      const cap = enemy.maxHp * STATUS_POWER_CAP;
      const statusPower = Math.min(power, cap);
      // 反应强度要含属性加成（和命中伤害同一口径）：乘回状态每一跳才乘的倍率
      const pin = Math.min(reactionPowerFromStatus(this.ctx.player.stats, enemy, id, statusPower), cap);
      this.attach(enemy, id, statusPower, depth, _applySrc, false, duration, pin);
    } else {
      this.status.apply(enemy, id, power, duration, depth);
    }
  }

  // ───────────── 元素反应 ─────────────

  /**
   * 元素附着的统一入口：先判定反应（必须在 apply 之前——雷殛第 3 层会自删并眩晕；击杀那一击状态还没清空），
   * 再照常施加。killed（击杀那一击）时状态没有意义，只做直接命中（depth 0）的雷殛弹射（现有规则）。
   * power 为状态强度（不含元素 / 精英 / 首领属性倍率，见 Status.apply）；pin 为反应强度（默认同 power）。
   * 不可选中的敌人既不反应也不附着。
   * 返回状态是否施加成功；引发的反应写入 this.lastReaction（末尾写，嵌套调用不会覆盖调用方读到的值）。
   */
  private attach(
    enemy: IEnemy, sid: StatusId, power: number, depth: number, src: AttachSource | null, killed: boolean, duration?: number,
    pin: number = power,
  ): boolean {
    if (enemy.untargetable) {
      this.lastReaction = null;
      return false;
    }
    const rx = sid === 'burn' || sid === 'shock' || sid === 'corrode'
      ? this.reactions.tryReact(enemy, sid, pin, depth, src, killed)
      : null;
    let applied = false;
    if (killed) {
      if (sid === 'shock' && depth <= 0) {
        this.status.chainFrom(enemy, power, depth);
        applied = true;
      }
    } else {
      applied = this.status.apply(enemy, sid, power, duration, depth);
    }
    this.lastReaction = rx;
    return applied;
  }

  /**
   * ReactionHost：反应扩散出去的元素（焚雷点燃、熔池附蚀、封脉导流），同样会判定反应。
   * power 取自反应威力（已含属性加成），附着为状态时与直接命中一样先除掉每一跳会再乘的属性倍率。
   */
  attachFromReaction(enemy: IEnemy, sid: 'burn' | 'shock' | 'corrode', power: number, depth: number, weaponUid?: number): void {
    _rxSrc.weaponUid = weaponUid;
    const pin = Math.min(power, enemy.maxHp * STATUS_POWER_CAP);
    const statusPower = pin / dotStatMultiplier(this.ctx.player.stats, enemy, STATUS_DOT_ELEMENT[sid]);
    this.attach(enemy, sid, statusPower, depth, _rxSrc, false, undefined, pin);
  }

  triggerReaction(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean {
    if (enemy.untargetable) return false;
    return this.reactions.trigger(enemy, id, power, opts);
  }

  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null {
    if (enemy.untargetable) return null;
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
