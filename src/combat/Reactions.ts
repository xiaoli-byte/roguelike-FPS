/**
 * 元素反应系统（docs/arsenal-expansion.md 第 2 节）：焚雷 / 熔金 / 封脉 / 归墟，引爆与崩解，强制反应。
 *
 * - 判定入口（tryReact / detonate / trigger）都只入队、不同步造成伤害；效果在 Combat.update 开头的 flush() 执行，
 *   每条执行完毕后派发 'enemy:reaction'（已在伤害管线之外，监听者可以直接造成伤害）。
 * - 防递归：附着 depth >= 2 不反应；反应伤害一律 procDepth = depth + 1、source 'status'（不会再附着元素）；
 *   扩散出去的元素以 depth + 1 附着，最多再连锁一级。连锁条目（depth >= 1）延后 0.15 秒执行。
 * - 引爆：直接引爆延后到下一次 flush（约一帧）；引爆冷却内同一击的再次引爆（满蓄 / 点穴 / 破势）并入未执行的那次，取较高强度。
 * - 预算：每帧接受 8 次反应（含引爆、强制）、大爆炸特效 3 个、浮字 4 个（Feedback）、熔池同时 4 个、队列 32 条。
 * - 冷却逐敌人、逐反应计时（WeakMap 存「就绪时刻」）：实际冷却 = 基础冷却 / (1 + reactionHaste)，最低 0.3 秒。
 * - 两两反应不消耗状态；归墟消耗灼烧（结清剩余伤害）与雷殛，保留蚀化。
 * - 热路径：伤害标签为模块级静态数组，向量用模块级临时变量，待执行条目走对象池；传给 damageEnemy 的 point 一律 clone。
 */
import * as THREE from 'three';
import type {
  DamageRequest, DamageResult, DetonateOpts, DetonateOutcome, Element, ExplosionOptions, GameContext, IEnemy,
  ReactionId, StatusId, TriggerReactionOpts,
} from '../core/types';
import { ELEMENT_COLORS, REACTION_COLORS, REACTION_NAMES, REACTION_TAG } from '../core/types';
import { clamp } from '../core/math';
import type { StatusSystem } from './Status';
import type { HitFeedback } from './Feedback';
import { lineClear } from './Blast';
import { ReactionPoolVisual } from '../fx/ReactionPool';

// ───────────── 总则常量 ─────────────

export const MAX_REACTION_DEPTH = 2, FRAME_BUDGET = 8, BIG_FX_BUDGET = 3, LABEL_BUDGET = 4,
  CASCADE_DELAY = 0.15, ABYSS_WINDUP = 0.35, MAX_POOLS = 4, QUEUE_CAP = 32, ICD_FLOOR = 0.3,
  DETONATE_ICD = 0.5, SEAL_STUN_ICD = 3.5;

/**
 * 直接引爆（depth 0）推迟到下一次 flush 执行（约一帧）：同一击的满蓄 / 点穴（同帧）与「破势」
 * （武器词条在下一帧结算）都能并入同一次引爆、取较高强度，而不是先到的弱引爆占掉 0.5 秒引爆冷却。
 */
const DETONATE_MERGE_DELAY = 1e-4;

/** B = clamp(k × Pin, floor × S, cap × S) × scale；icd 为基础冷却（秒） */
export const REACTION_TUNING: Record<ReactionId, { k: number; floor: number; cap: number; icd: number }> = {
  thunderfire: { k: 1.0, floor: 14, cap: 80, icd: 1.0 },
  meltdown:    { k: 1.0, floor: 14, cap: 100, icd: 1.2 },
  veinseal:    { k: 1.0, floor: 14, cap: 90, icd: 1.2 },
  abyss:       { k: 1.5, floor: 40, cap: 320, icd: 6.0 },
};

/** 两两反应的优先级 */
export const PAIR_PRIORITY: readonly ReactionId[] = ['thunderfire', 'meltdown', 'veinseal'];

/** 两两反应的组成状态 */
const PAIR_MEMBERS: Readonly<Record<ReactionId, readonly [StatusId, StatusId]>> = {
  thunderfire: ['burn', 'shock'],
  meltdown: ['burn', 'corrode'],
  veinseal: ['shock', 'corrode'],
  abyss: ['burn', 'shock'], // 不参与两两判定，只为类型完整
};

/** 两个状态组成的两两反应（纯函数）；同一状态或非元素状态返回 null */
export function pairOf(a: StatusId, b: StatusId): ReactionId | null {
  if (a === b) return null;
  const burn = a === 'burn' || b === 'burn';
  const shock = a === 'shock' || b === 'shock';
  const corrode = a === 'corrode' || b === 'corrode';
  if (burn && shock) return 'thunderfire';
  if (burn && corrode) return 'meltdown';
  if (shock && corrode) return 'veinseal';
  return null;
}

/** 反应威力 B（纯函数，不含 scale）：clamp(k × pin, floor × S, cap × S) */
export function reactionBase(id: ReactionId, pin: number, S: number): number {
  const t = REACTION_TUNING[id];
  const p = Number.isFinite(pin) ? Math.max(0, pin) : 0;
  return clamp(t.k * p, t.floor * S, t.cap * S);
}

// ───────────── 各反应参数 ─────────────

/** 焚雷：爆炸 / 扩散半径、周围份额、扩散灼烧、击退、雷弧数 */
const TF_RADIUS = 3.0;
const TF_SPLASH = 0.6;
const TF_SPREAD_BURN = 0.2;
const TF_KNOCKBACK = 7;
const TF_MAX_ARCS = 4;
const TF_ARC_COLOR = 0x6fd8ff;

/** 熔金：对护甲中心伤害倍率、熔池半径 / 跳数 / 间隔 / 跳伤 / 附蚀 */
const MG_ARMOR_MULT = 2;
const POOL_RADIUS = 2.5;
const POOL_TICK = 0.5;
const POOL_TICKS = 6;
const POOL_LIFE = POOL_TICK * POOL_TICKS;
const POOL_DAMAGE = 0.12;
const POOL_CORRODE = 0.25;
/** 敌人脚底高于池面多少以内算站在池里 */
const POOL_HEIGHT = 1.5;
const POOL_EMBER = 0xffa040;

/** 封脉：对护盾中心伤害倍率、眩晕 / 减速、首领脉滞、导流 */
const VS_SHIELD_MULT = 2;
const VS_STUN = 0.7;
const VS_SLOW = 0.4;
const VS_SLOW_DURATION = 3;
const VS_BOSS_VULN = 1.12;
const VS_BOSS_VULN_DURATION = 4;
const VS_CONDUCT_RANGE = 8;
const VS_CONDUCT_TARGETS = 3;
const VS_CONDUCT_DAMAGE = 0.3;
const VS_CONDUCT_CORRODE = 0.35;

/** 归墟：余波半径 / 份额（中心已死 0.6，否则 0.3）/ 击退、天雷高度、预警半径 */
const AB_RADIUS = 3.0;
const AB_SPLASH_DEAD = 0.6;
const AB_SPLASH = 0.3;
const AB_KNOCKBACK = 9;
const AB_BOLT_HEIGHT = 7;
const AB_WARN_RADIUS = 1.6;
const AB_ELEMENTS: readonly Element[] = ['fire', 'shock', 'corrode'];

/** 崩解：各状态取剩余伤害 / 强度的份额，单次上限 30S */
const COLLAPSE_BURN = 0.3;
const COLLAPSE_CORRODE = 0.3;
const COLLAPSE_SHOCK = 0.5;
const COLLAPSE_CAP = 30;

/** 飞行敌人离地超过这个高度时，地面类表现画在它脚下的空中 */
const AIR_GAP = 1.2;

/** 伤害标签（模块级静态数组，热路径不分配；不要修改其内容） */
const TAGS: Readonly<Record<ReactionId | 'pool' | 'collapse', string[]>> = {
  thunderfire: [REACTION_TAG, 'thunderfire'],
  meltdown: [REACTION_TAG, 'meltdown'],
  veinseal: [REACTION_TAG, 'veinseal'],
  abyss: [REACTION_TAG, 'abyss'],
  pool: [REACTION_TAG, 'meltdown', 'dot'],
  collapse: [REACTION_TAG, 'collapse'],
};

const STATUS_ELEMENT: Readonly<Record<'burn' | 'shock' | 'corrode', Element>> = { burn: 'fire', shock: 'shock', corrode: 'corrode' };

// ───────────── 对外接口 ─────────────

/** 由 Combat 实现 */
export interface ReactionHost {
  damageEnemy(enemy: IEnemy, req: DamageRequest): DamageResult | null;
  explode(center: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number;
  /** 反应扩散出去的元素附着（会再判定反应）；power 由 Combat 钳到最大生命 × 0.5 */
  attachFromReaction(enemy: IEnemy, sid: 'burn' | 'shock' | 'corrode', power: number, depth: number, weaponUid?: number): void;
}

/** 引发反应的那次附着的来源信息（只在判定时同步读取，调用方可以复用同一个对象） */
export interface AttachSource {
  weaponUid?: number;
  /** 反应威力倍率（「万象」0.6），缺省 1 */
  scale?: number;
  /** 反应中心（缺省为敌人身体中心） */
  point?: THREE.Vector3;
}

// ───────────── 内部数据 ─────────────

type IcdKey = ReactionId | 'sealStun' | 'detonate';
type IcdRec = Partial<Record<IcdKey, number>>;
type Origin = 'status' | 'detonate' | 'forced';

interface Pending {
  kind: 'reaction' | 'collapse';
  id: ReactionId;
  /** 崩解的状态 */
  collapse: 'burn' | 'shock' | 'corrode' | null;
  enemy: IEnemy | null;
  /** 入队时的反应中心（自有向量，复用） */
  point: THREE.Vector3;
  /** 反应：Pin；崩解（雷殛）：重新弹射用的雷殛强度 */
  pin: number;
  depth: number;
  weaponUid: number | undefined;
  scale: number;
  /** 反应：直接指定的 B；崩解：已算好的崩解伤害 */
  fixedBase: number | null;
  mult: number;
  /** 归墟消耗灼烧的结清值 */
  cash: number;
  /** 入队于击杀那一击（中心伤害与控制跳过） */
  killed: boolean;
  at: number;
  origin: Origin;
  tag: string | undefined;
  /** 入队时的 ctx.time.frame（引爆合并只认本帧 / 上一帧入队的条目） */
  frame: number;
}

interface Pool {
  center: THREE.Vector3;
  radius: number;
  base: number;
  depth: number;
  weaponUid: number | undefined;
  /** 已被本池附过蚀化的敌人 */
  touched: WeakSet<IEnemy>;
  ended: boolean;
  ticks: number;
  age: number;
  acc: number;
  pulse: number;
  vis: ReactionPoolVisual;
}

/** debug 计数器（?debug 时挂到 window.__rx） */
interface RxDebug {
  accepted: number;
  dropped: number;
  byId: Record<ReactionId | 'collapse', number>;
  perSec: { accepted: number; dropped: number };
  /** 单帧接受数的历史最大值（应 <= 8） */
  frameMax: number;
  /** 单帧大爆炸特效数的历史最大值（应 <= 3） */
  bigFxFrameMax: number;
  queue: number;
  pools: number;
  reset(): void;
}

const _center = new THREE.Vector3();
const _ev = new THREE.Vector3();
const _g = new THREE.Vector3();
const _p = new THREE.Vector3();
const _to = new THREE.Vector3();
const _top = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lbl = new THREE.Vector3();
const _exclude = new Set<IEnemy>();

function isLive(e: IEnemy): boolean {
  return e.alive && e.hp > 0;
}

function finite(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

function hasOther(s: StatusId, hb: boolean, hs: boolean, hc: boolean): boolean {
  return s === 'burn' ? hb : s === 'shock' ? hs : s === 'corrode' ? hc : false;
}

export class ReactionSystem {
  private icd = new WeakMap<IEnemy, IcdRec>();
  /** 封脉首领「脉滞」截止时刻 */
  private vuln = new WeakMap<IEnemy, number>();
  private readonly queue: Pending[] = [];
  private readonly spare: Pending[] = [];
  private readonly batch: Pending[] = [];
  private readonly pools: Pool[] = [];
  private readonly near: IEnemy[] = [];
  private readonly nearDist: number[] = [];
  private readonly picked: IEnemy[] = [];
  private readonly poolBuf: IEnemy[] = [];
  private frame = -1;
  private used = 0;
  private bigFxUsed = 0;
  private flushing = false;
  /** clear() 计数：flush 中途被清场时停止执行剩余条目 */
  private epoch = 0;
  // 当前执行中的反应的统计（flush 不可重入，用字段即可）
  private hits = 0;
  private stunned = false;
  // debug
  private readonly rx: RxDebug;
  private debugChecked = false;
  private secStart = 0;
  private secAccepted = 0;
  private secDropped = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly host: ReactionHost,
    private readonly status: StatusSystem,
    private readonly feedback: HitFeedback,
  ) {
    const rx: RxDebug = {
      accepted: 0, dropped: 0,
      byId: { thunderfire: 0, meltdown: 0, veinseal: 0, abyss: 0, collapse: 0 },
      perSec: { accepted: 0, dropped: 0 },
      frameMax: 0, bigFxFrameMax: 0, queue: 0, pools: 0,
      reset: () => {
        rx.accepted = 0;
        rx.dropped = 0;
        for (const k of Object.keys(rx.byId) as (keyof RxDebug['byId'])[]) rx.byId[k] = 0;
        rx.frameMax = 0;
        rx.bigFxFrameMax = 0;
      },
    };
    this.rx = rx;
  }

  // ───────────── 判定：元素附着 ─────────────

  /**
   * 元素附着前的反应判定（Combat.attach 调用，必须在 status.apply 之前）。
   * 成功时记录冷却、（归墟）消耗状态、入队并返回反应 id；incoming 由调用方照常附着。
   */
  tryReact(enemy: IEnemy, incoming: StatusId, pin: number, depth: number, src: AttachSource | null, killed: boolean): ReactionId | null {
    if (depth >= MAX_REACTION_DEPTH) return null;
    if (incoming !== 'burn' && incoming !== 'shock' && incoming !== 'corrode') return null;
    if (!killed && !isLive(enemy)) return null;
    const st = enemy.statuses;
    const hb = incoming !== 'burn' && st.has('burn');
    const hs = incoming !== 'shock' && st.has('shock');
    const hc = incoming !== 'corrode' && st.has('corrode');
    const others = (hb ? 1 : 0) + (hs ? 1 : 0) + (hc ? 1 : 0);
    if (others === 0) return null;

    const now = this.ctx.time.now;
    let id: ReactionId | null = null;
    if (others === 2 && !killed && this.ready(enemy, 'abyss', now)) {
      id = 'abyss';
    } else {
      for (let i = 0; i < PAIR_PRIORITY.length; i++) {
        const pid = PAIR_PRIORITY[i];
        const m = PAIR_MEMBERS[pid];
        const a = m[0];
        const b = m[1];
        const formed = (a === incoming && hasOther(b, hb, hs, hc)) || (b === incoming && hasOther(a, hb, hs, hc));
        if (formed && this.ready(enemy, pid, now)) {
          id = pid;
          break;
        }
      }
    }
    if (!id || !this.canAccept()) return null;

    this.arm(enemy, id, now);
    const p = this.alloc();
    p.kind = 'reaction';
    p.id = id;
    p.enemy = enemy;
    if (src?.point) p.point.copy(src.point);
    else enemy.getBodyCenter(p.point);
    p.pin = Number.isFinite(pin) ? Math.max(0, pin) : 0;
    p.depth = depth;
    p.weaponUid = src?.weaponUid;
    p.scale = Math.max(0, finite(src?.scale, 1));
    p.killed = killed;
    p.origin = 'status';
    let delay = depth > 0 ? CASCADE_DELAY : 0;
    if (id === 'abyss') {
      p.cash = this.consumeForAbyss(enemy, hb, hs);
      delay += ABYSS_WINDUP;
      this.windup(enemy, p.point, delay);
    }
    p.at = now + delay;
    this.push(p);
    return id;
  }

  // ───────────── 判定：强制反应 ─────────────

  /** ICombat.triggerReaction：不需要、也不消耗元素状态 */
  trigger(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean {
    if (!enemy || !REACTION_TUNING[id]) return false;
    const depth = opts?.depth ?? 0;
    if (depth >= MAX_REACTION_DEPTH) return false;
    const now = this.ctx.time.now;
    const live = isLive(enemy);
    const useIcd = live && !opts?.ignoreIcd;
    if (useIcd && !this.ready(enemy, id, now)) return false;
    if (!this.canAccept()) return false;
    if (useIcd) this.arm(enemy, id, now);

    const p = this.alloc();
    p.kind = 'reaction';
    p.id = id;
    p.enemy = enemy;
    if (opts?.point) p.point.copy(opts.point);
    else enemy.getBodyCenter(p.point);
    p.pin = Math.max(0, finite(power, 0));
    p.depth = depth;
    p.weaponUid = opts?.weaponUid;
    p.scale = Math.max(0, finite(opts?.scale, 1));
    p.fixedBase = opts?.fixedBase !== undefined && Number.isFinite(opts.fixedBase) ? Math.max(0, opts.fixedBase) : null;
    p.killed = !live;
    p.origin = 'forced';
    p.tag = opts?.tag;
    let delay = depth > 0 ? CASCADE_DELAY : 0;
    if (id === 'abyss') {
      delay += ABYSS_WINDUP;
      this.windup(enemy, p.point, delay);
    }
    p.at = now + delay;
    this.push(p);
    return true;
  }

  // ───────────── 判定：引爆 ─────────────

  /** ICombat.detonate：引发身上已有状态的反应，或单一状态「崩解」。只入队 */
  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null {
    if (!enemy || !isLive(enemy)) return null;
    const depth = opts.depth ?? 0;
    if (depth >= MAX_REACTION_DEPTH) return null;
    const now = this.ctx.time.now;
    // 引爆冷却中：同一击的另一次引爆并入还没执行的那次（取较高强度），否则拒绝
    if (!this.ready(enemy, 'detonate', now)) return this.mergeDetonate(enemy, opts);
    const st = enemy.statuses;
    const hb = st.has('burn');
    const hs = st.has('shock');
    const hc = st.has('corrode');
    const n = (hb ? 1 : 0) + (hs ? 1 : 0) + (hc ? 1 : 0);
    if (n === 0) return null;
    if (!this.canAccept()) return null;

    const mult = Math.max(0, finite(opts.mult, 1));
    const pin = Math.min(Math.max(0, finite(opts.power, 0)), enemy.maxHp * 0.5) * mult;
    this.rec(enemy).detonate = now + DETONATE_ICD;

    let id: ReactionId | null = null;
    if (n === 3 && this.ready(enemy, 'abyss', now)) {
      id = 'abyss';
    } else if (n >= 2) {
      for (let i = 0; i < PAIR_PRIORITY.length; i++) {
        const pid = PAIR_PRIORITY[i];
        const m = PAIR_MEMBERS[pid];
        const a = m[0];
        const b = m[1];
        if (hasOther(a, hb, hs, hc) && hasOther(b, hb, hs, hc) && this.ready(enemy, pid, now)) {
          id = pid;
          break;
        }
      }
    }

    const p = this.alloc();
    p.enemy = enemy;
    enemy.getBodyCenter(p.point);
    p.depth = depth;
    p.weaponUid = opts.weaponUid;
    p.origin = 'detonate';
    p.mult = mult;
    let delay = depth > 0 ? CASCADE_DELAY : DETONATE_MERGE_DELAY;
    let outcome: DetonateOutcome;
    if (id) {
      this.arm(enemy, id, now);
      p.kind = 'reaction';
      p.id = id;
      p.pin = pin;
      if (id === 'abyss') {
        p.cash = this.consumeForAbyss(enemy, hb, hs);
        delay += ABYSS_WINDUP;
        this.windup(enemy, p.point, delay);
      }
      outcome = id;
    } else {
      // 崩解：灼烧 > 蚀化 > 雷殛，不消耗状态；伤害在入队时按当前剩余量算好
      const sid: 'burn' | 'shock' | 'corrode' = hb ? 'burn' : hc ? 'corrode' : 'shock';
      p.kind = 'collapse';
      p.collapse = sid;
      if (sid === 'shock') p.pin = st.get('shock')?.power ?? 0;
      p.fixedBase = this.collapseRaw(enemy, sid, p.pin) * mult;
      outcome = 'collapse';
    }
    p.at = now + delay;
    this.push(p);
    return outcome;
  }

  /**
   * 引爆冷却内的又一次引爆：同一敌人有本帧 / 上一帧入队、尚未执行的引爆时（同一击的满蓄与点穴在同帧，
   * 「破势」在下一帧到达）并入它，强度取较高者，返回那次的结果；不占帧预算。没有可并入的条目返回 null。
   */
  private mergeDetonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null {
    const q = this.queue;
    const minFrame = this.ctx.time.frame - 1;
    for (let i = 0; i < q.length; i++) {
      const p = q[i];
      if (p.origin !== 'detonate' || p.enemy !== enemy || p.frame < minFrame) continue;
      const mult = Math.max(0, finite(opts.mult, 1));
      if (p.kind === 'collapse') {
        if (p.collapse) p.fixedBase = Math.max(p.fixedBase ?? 0, this.collapseRaw(enemy, p.collapse, p.pin) * mult);
      } else {
        const pin = Math.min(Math.max(0, finite(opts.power, 0)), enemy.maxHp * 0.5) * mult;
        if (pin > p.pin) p.pin = pin;
      }
      if (mult > p.mult) p.mult = mult;
      if (p.weaponUid === undefined) p.weaponUid = opts.weaponUid;
      return p.kind === 'collapse' ? 'collapse' : p.id;
    }
    return null;
  }

  /** 崩解伤害（未乘 mult）：灼烧 / 蚀化取剩余持续伤害的 30%，雷殛取强度的 50%，上限 30S */
  private collapseRaw(enemy: IEnemy, sid: 'burn' | 'shock' | 'corrode', shockPower: number): number {
    const cap = COLLAPSE_CAP * this.strength();
    if (sid === 'burn') return Math.min(COLLAPSE_BURN * this.status.dotRemaining(enemy, 'burn'), cap);
    if (sid === 'corrode') return Math.min(COLLAPSE_CORRODE * this.status.dotRemaining(enemy, 'corrode'), cap);
    return Math.min(COLLAPSE_SHOCK * shockPower, cap);
  }

  /** 封脉首领「脉滞」：受到玩家方所有伤害 ×1.12（Combat 第 2 步与 previewMultiplier 乘入） */
  vulnMult(enemy: IEnemy): number {
    const t = this.vuln.get(enemy);
    return t !== undefined && this.ctx.time.now < t ? VS_BOSS_VULN : 1;
  }

  // ───────────── 执行 ─────────────

  /** Combat.update 开头调用：执行 at <= now 的条目（队列快照），每条执行完派发 'enemy:reaction' */
  flush(): void {
    this.syncFrame();
    this.publishDebug();
    const q = this.queue;
    if (q.length === 0 || this.flushing) return;
    const now = this.ctx.time.now;
    const batch = this.batch;
    let w = 0;
    for (let i = 0; i < q.length; i++) {
      const p = q[i];
      if (p.at <= now) batch.push(p);
      else q[w++] = p;
    }
    q.length = w;
    if (batch.length === 0) return;

    this.flushing = true;
    const epoch = this.epoch;
    try {
      for (let i = 0; i < batch.length; i++) {
        const p = batch[i];
        if (this.epoch === epoch) {
          try {
            if (p.kind === 'collapse') this.runCollapse(p);
            else this.runReaction(p);
          } catch (err) {
            console.error('[Reactions] reaction threw', p.kind, p.id, err);
          }
        }
        this.release(p);
      }
    } finally {
      batch.length = 0;
      this.flushing = false;
    }
  }

  private runReaction(p: Pending): void {
    const enemy = p.enemy;
    if (!enemy) return;
    const id = p.id;
    const B = p.fixedBase !== null ? p.fixedBase : reactionBase(id, p.pin, this.strength()) * p.scale;
    if (!(B > 0)) return;
    const centerAlive = !p.killed && isLive(enemy);
    const c = _center;
    if (centerAlive) enemy.getBodyCenter(c);
    else c.copy(p.point);
    this.hits = 0;
    this.stunned = false;

    switch (id) {
      case 'thunderfire':
        this.runThunderfire(p, enemy, c, B, centerAlive);
        break;
      case 'meltdown':
        this.runMeltdown(p, enemy, c, B, centerAlive);
        break;
      case 'veinseal':
        this.runVeinseal(p, enemy, c, B, centerAlive);
        break;
      case 'abyss':
        this.runAbyss(p, enemy, c, B, centerAlive);
        break;
    }
    this.label(enemy, REACTION_NAMES[id], REACTION_COLORS[id], id === 'abyss');

    _ev.copy(c);
    this.ctx.events.emit('enemy:reaction', {
      enemy,
      reaction: id,
      point: _ev,
      base: B,
      depth: p.depth,
      hits: this.hits,
      weaponUid: p.weaponUid,
      origin: p.origin,
      tag: p.tag,
      centerKilled: !isLive(enemy),
      stunned: this.stunned,
    });
  }

  // 焚雷：中心火焰 + 金色爆炸（周围 0.6B）+ 雷弧，并点燃周围敌人（可连锁次级焚雷 / 熔金）
  private runThunderfire(p: Pending, enemy: IEnemy, c: THREE.Vector3, B: number, centerAlive: boolean): void {
    const ctx = this.ctx;
    const color = REACTION_COLORS.thunderfire;
    const R = TF_RADIUS * this.radiusMult();
    if (centerAlive && this.hit(enemy, B, 'fire', TAGS.thunderfire, p)) this.hits++;

    // 周围敌人（自有缓冲：后面的伤害可能嵌套查询 / 击杀）
    const near = this.near;
    this.query(c, R, near);
    let arcs = 0;
    for (let i = 0; i < near.length && arcs < TF_MAX_ARCS; i++) {
      const e = near[i];
      if (e === enemy || !e.alive) continue;
      e.getBodyCenter(_to);
      if (!lineClear(ctx.world, c, _to)) continue;
      ctx.fx.lightning(c, _to, TF_ARC_COLOR);
      arcs++;
    }

    const big = this.bigFx();
    _exclude.clear();
    _exclude.add(enemy);
    try {
      this.hits += this.host.explode(c, R, {
        base: TF_SPLASH * B, element: 'fire', source: 'status', canCrit: false, procDepth: p.depth + 1,
        tags: TAGS.thunderfire, weaponUid: p.weaponUid, knockback: TF_KNOCKBACK,
      }, { exclude: _exclude, falloff: 0.6, noFx: !big, color });
    } finally {
      _exclude.clear();
    }

    // 扩散：给周围存活敌人附着灼烧（depth + 1，可再引发一级反应）
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e === enemy || !e.alive) continue;
      this.host.attachFromReaction(e, 'burn', TF_SPREAD_BURN * B, p.depth + 1, p.weaponUid);
    }
    near.length = 0;

    if (!big) {
      ctx.fx.burst(c, color, 18, 7, 0.45, 0.13, 2);
      ctx.fx.ring(this.ground(enemy, c, _g), R, color, 0.4);
    }
    ctx.audio.play('shock_zap', { volume: 0.5, pitch: 1.1, position: c });
  }

  // 熔金：中心蚀化（有护甲 ×2）+ 脚下熔池（6 跳火焰，首跳附蚀）
  private runMeltdown(p: Pending, enemy: IEnemy, c: THREE.Vector3, B: number, centerAlive: boolean): void {
    const ctx = this.ctx;
    if (centerAlive && this.hit(enemy, B * (enemy.armor > 0 ? MG_ARMOR_MULT : 1), 'corrode', TAGS.meltdown, p)) this.hits++;
    this.spawnPool(enemy, c, B, p.depth, p.weaponUid);
    ctx.fx.burst(c, REACTION_COLORS.meltdown, 14, 4, 0.6, 0.14, 12);
    ctx.fx.burst(c, ELEMENT_COLORS.corrode, 8, 2.5, 0.7, 0.1, 8);
    ctx.audio.play('skill_fire', { volume: 0.55, pitch: 0.75, position: c });
    ctx.audio.play('corrode_tick', { volume: 0.7, position: c });
  }

  // 封脉：中心雷电（有护盾 ×2）+ 眩晕 / 减速（首领改为脉滞）+ 向最近 3 名敌人导流蚀化
  private runVeinseal(p: Pending, enemy: IEnemy, c: THREE.Vector3, B: number, centerAlive: boolean): void {
    const ctx = this.ctx;
    const color = REACTION_COLORS.veinseal;
    const now = ctx.time.now;
    if (centerAlive) {
      if (this.hit(enemy, B * (enemy.shield > 0 ? VS_SHIELD_MULT : 1), 'shock', TAGS.veinseal, p)) this.hits++;
      if (isLive(enemy)) {
        if (!enemy.isBoss) {
          if (this.ready(enemy, 'sealStun', now)) {
            this.rec(enemy).sealStun = now + SEAL_STUN_ICD;
            this.stunned = this.status.apply(enemy, 'stun', 0, VS_STUN, p.depth + 1);
          }
          this.status.apply(enemy, 'slow', VS_SLOW, VS_SLOW_DURATION, p.depth + 1);
        } else {
          this.vuln.set(enemy, now + VS_BOSS_VULN_DURATION);
        }
      }
    }

    // 导流：8 米内最近的 3 名有视线的敌人（先选定再结算伤害）
    const near = this.near;
    const dist = this.nearDist;
    const picked = this.picked;
    this.query(c, VS_CONDUCT_RANGE, near);
    dist.length = near.length;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      dist[i] = e === enemy || !e.alive ? Infinity : e.getBodyCenter(_to).distanceToSquared(c);
    }
    picked.length = 0;
    while (picked.length < VS_CONDUCT_TARGETS) {
      let bi = -1;
      let bd = Infinity;
      for (let i = 0; i < near.length; i++) {
        if (dist[i] < bd) {
          bd = dist[i];
          bi = i;
        }
      }
      if (bi < 0) break;
      dist[bi] = Infinity;
      const e = near[bi];
      e.getBodyCenter(_to);
      if (lineClear(ctx.world, c, _to)) picked.push(e);
    }
    near.length = 0;
    dist.length = 0;
    for (let i = 0; i < picked.length; i++) {
      const e = picked[i];
      if (!e.alive) continue;
      e.getBodyCenter(_to);
      ctx.fx.lightning(c, _to, color);
      _dir.subVectors(_to, c);
      if (_dir.lengthSq() > 1e-8) _dir.normalize();
      else _dir.set(0, 1, 0);
      const r = this.host.damageEnemy(e, {
        base: VS_CONDUCT_DAMAGE * B, element: 'shock', source: 'status', canCrit: false, procDepth: p.depth + 1,
        tags: TAGS.veinseal, weaponUid: p.weaponUid, point: _to.clone(), direction: _dir.clone(),
      });
      if (r) this.hits++;
      if (e.alive) this.host.attachFromReaction(e, 'corrode', VS_CONDUCT_CORRODE * B, p.depth + 1, p.weaponUid);
    }
    picked.length = 0;

    // 表现：双层收紧光环 + 头顶青光
    const g = this.ground(enemy, c, _g).clone();
    ctx.fx.ring(g, 1.6, color, 0.35);
    ctx.tasks.delay(0.1, () => ctx.fx.ring(g, 1.6, color, 0.35));
    enemy.getHeadCenter(_p);
    _p.y += 0.3;
    ctx.fx.burst(_p, color, 10, 2, 0.5, 0.08, 0);
    ctx.audio.play('skill_shock', { volume: 0.5, pitch: 0.8, position: c });
    ctx.audio.play('shock_zap', { volume: 0.6, pitch: 0.7, position: c });
  }

  // 归墟：结清灼烧 + 三段（火 / 雷 / 蚀）各 B/3 + 余波；不扩散元素
  private runAbyss(p: Pending, enemy: IEnemy, c: THREE.Vector3, B: number, centerAlive: boolean): void {
    const ctx = this.ctx;
    const color = REACTION_COLORS.abyss;
    if (centerAlive) {
      if (p.cash > 0) {
        enemy.getBodyCenter(_p);
        this.host.damageEnemy(enemy, {
          base: p.cash, element: 'fire', source: 'status', canCrit: false, procDepth: p.depth + 1,
          weaponUid: p.weaponUid, point: _p.clone(),
        });
      }
      let any = false;
      for (let i = 0; i < AB_ELEMENTS.length; i++) {
        if (!isLive(enemy)) break;
        if (this.hit(enemy, B / 3, AB_ELEMENTS[i], TAGS.abyss, p)) any = true;
      }
      if (any) this.hits++;
    }

    const R = AB_RADIUS * this.radiusMult();
    const big = this.bigFx();
    _exclude.clear();
    _exclude.add(enemy);
    try {
      this.hits += this.host.explode(c, R, {
        base: (isLive(enemy) ? AB_SPLASH : AB_SPLASH_DEAD) * B, element: 'none', source: 'status', canCrit: false,
        procDepth: p.depth + 1, tags: TAGS.abyss, weaponUid: p.weaponUid, knockback: AB_KNOCKBACK,
      }, { exclude: _exclude, falloff: 0.6, noFx: !big, color });
    } finally {
      _exclude.clear();
    }

    // 表现：三色天雷劈下 + 紫环 + 屏震
    for (let i = 0; i < AB_ELEMENTS.length; i++) {
      const a = (i / AB_ELEMENTS.length) * Math.PI * 2 + Math.random() * 0.6;
      _top.set(c.x + Math.cos(a) * 0.7, c.y + AB_BOLT_HEIGHT, c.z + Math.sin(a) * 0.7);
      ctx.fx.lightning(_top, c, ELEMENT_COLORS[AB_ELEMENTS[i]]);
    }
    ctx.fx.ring(this.ground(enemy, c, _g), 3, color, 0.5);
    if (!big) ctx.fx.burst(c, color, 22, 6, 0.5, 0.14, 0);
    ctx.fx.shake(0.3, 0.25);
    ctx.audio.play('hit_crit', { volume: 0.8, position: c });
  }

  // 崩解：单一状态（或组合都在冷却）的引爆，不消耗状态、不派发事件
  private runCollapse(p: Pending): void {
    const enemy = p.enemy;
    const sid = p.collapse;
    if (!enemy || !sid || !isLive(enemy)) return;
    const ctx = this.ctx;
    const el = STATUS_ELEMENT[sid];
    const color = ELEMENT_COLORS[el];
    const base = p.fixedBase ?? 0;
    if (base > 0) this.hit(enemy, base, el, TAGS.collapse, p);
    if (sid === 'shock' && p.pin > 0) this.status.chainFrom(enemy, p.pin, p.depth);
    enemy.getBodyCenter(_center);
    ctx.fx.burst(_center, color, 14, 6, 0.3, 0.1, 0);
    ctx.fx.ring(this.ground(enemy, _center, _g), 1.5, 0xffffff, 0.25);
    ctx.audio.play('hit_crit', { volume: 0.8, pitch: 0.8, position: _center });
    this.label(enemy, '崩解', color, false);
  }

  // ───────────── 熔池 ─────────────

  private spawnPool(enemy: IEnemy, c: THREE.Vector3, B: number, depth: number, weaponUid: number | undefined): void {
    const ctx = this.ctx;
    // 同时最多 4 个：第 5 个生成时结束最旧的
    while (this.pools.length >= MAX_POOLS) {
      const old = this.pools[0];
      this.endPool(old);
    }
    const center = this.ground(enemy, c, new THREE.Vector3());
    center.y += 0.05;
    const radius = POOL_RADIUS * this.radiusMult();
    const vis = ReactionPoolVisual.acquire(ctx.stageGroup);
    vis.place(center, radius);
    vis.animate(0, POOL_LIFE, 0);
    const pool: Pool = {
      center, radius, base: B, depth, weaponUid, touched: new WeakSet(),
      ended: false, ticks: 0, age: 0, acc: 0, pulse: 0, vis,
    };
    this.pools.push(pool);
    // 关卡任务（非常驻）：每 0.5 秒一跳共 6 跳，逐帧推进视觉；换关时 ctx.tasks.clear 会移除它
    ctx.tasks.add((dt) => this.stepPool(pool, dt));
  }

  private stepPool(pool: Pool, dt: number): boolean {
    if (pool.ended) return true;
    pool.age += dt;
    pool.acc += dt;
    pool.pulse = Math.max(0, pool.pulse - dt * 4);
    while (pool.acc >= POOL_TICK) {
      pool.acc -= POOL_TICK;
      this.tickPool(pool);
      if (pool.ended) return true;
      if (pool.ticks >= POOL_TICKS) {
        this.endPool(pool);
        return true;
      }
    }
    pool.vis.animate(pool.age, POOL_LIFE, pool.pulse);
    return false;
  }

  private tickPool(pool: Pool): void {
    const ctx = this.ctx;
    pool.ticks++;
    pool.pulse = 1;
    const cx = pool.center.x;
    const cz = pool.center.z;

    // 先筛出站在池里的敌人（水平距离 + 脚底高度），再结算伤害（伤害可能嵌套查询 / 击杀）
    const buf = this.poolBuf;
    this.query(pool.center, pool.radius + POOL_HEIGHT + 1, buf);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
      const e = buf[i];
      const dx = e.position.x - cx;
      const dz = e.position.z - cz;
      const rr = pool.radius + e.radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      const dy = e.position.y - pool.center.y;
      if (dy < -1 || dy > POOL_HEIGHT) continue;
      buf[n++] = e;
    }
    buf.length = n;
    const dmg = POOL_DAMAGE * pool.base;
    for (let i = 0; i < n; i++) {
      const e = buf[i];
      if (!e.alive) continue;
      e.getHeadCenter(_p);
      _p.x += (Math.random() - 0.5) * e.radius;
      _p.z += (Math.random() - 0.5) * e.radius;
      _p.y += 0.2 + Math.random() * 0.25;
      this.host.damageEnemy(e, {
        base: dmg, element: 'fire', source: 'status', canCrit: false, procDepth: pool.depth + 1,
        tags: TAGS.pool, weaponUid: pool.weaponUid, point: _p.clone(),
      });
      if (e.alive && !pool.touched.has(e)) {
        pool.touched.add(e);
        this.host.attachFromReaction(e, 'corrode', POOL_CORRODE * pool.base, pool.depth + 1, pool.weaponUid);
      }
    }
    buf.length = 0;

    // 表现：熔池光环 + 上升火星（纯视觉随机）
    ctx.fx.ring(pool.center, pool.radius, REACTION_COLORS.meltdown, 0.5);
    for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * pool.radius * 0.85;
      _p.set(cx + Math.cos(a) * r, pool.center.y + 0.1, cz + Math.sin(a) * r);
      ctx.fx.burst(_p, POOL_EMBER, 4, 1.5, 0.6, 0.1, -3);
    }
    if (pool.ticks % 2 === 0) ctx.audio.play('burn_tick', { volume: 0.3, position: pool.center });
  }

  private endPool(pool: Pool): void {
    pool.ended = true;
    pool.vis.release();
    const i = this.pools.indexOf(pool);
    if (i >= 0) this.pools.splice(i, 1);
  }

  // ───────────── 工具 ─────────────

  /** 半径查询，结果保证落在自有缓冲 out 里（后续伤害可能嵌套查询 / 击杀，不能用共享结果） */
  private query(center: THREE.Vector3, radius: number, out: IEnemy[]): IEnemy[] {
    const found = this.ctx.enemies.queryRadius(center, radius, out);
    if (found !== out) {
      out.length = 0;
      for (let i = 0; i < found.length; i++) out.push(found[i]);
    }
    return out;
  }

  /** 反应对单个敌人的伤害（source 'status'、不暴击、procDepth + 1、带反应标签） */
  private hit(e: IEnemy, base: number, element: Element, tags: string[], p: Pending): DamageResult | null {
    e.getBodyCenter(_p);
    return this.host.damageEnemy(e, {
      base, element, source: 'status', canCrit: false, procDepth: p.depth + 1,
      tags, weaponUid: p.weaponUid, point: _p.clone(),
    });
  }

  /** 归墟消耗：灼烧结清（返回结清值）、雷殛移除；蚀化保留 */
  private consumeForAbyss(enemy: IEnemy, burn: boolean, shock: boolean): number {
    const cash = burn ? this.status.consume(enemy, 'burn') : 0;
    if (shock) this.status.consume(enemy, 'shock');
    return cash;
  }

  /** 归墟收束预警：紫色地面预警圈 + 提示音 */
  private windup(enemy: IEnemy, point: THREE.Vector3, duration: number): void {
    const ctx = this.ctx;
    ctx.fx.groundWarning(this.ground(enemy, point, _g), AB_WARN_RADIUS, duration, REACTION_COLORS.abyss);
    ctx.audio.play('telegraph', { volume: 0.5, pitch: 1.4, position: point });
  }

  private label(enemy: IEnemy, text: string, color: number, big: boolean): void {
    // 抬到血条（头顶 +0.6 附近）之上，避开自身爆炸最亮的核心
    enemy.getHeadCenter(_lbl);
    _lbl.y += 1.05;
    this.feedback.reactionLabel(enemy, _lbl, text, color, big);
  }

  /** 「地面点」：c 正下方的地面；飞行敌人离地较高时取它脚底高度（画在空中） */
  private ground(enemy: IEnemy | null, c: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const fromY = enemy ? enemy.position.y : c.y;
    const g = this.ctx.world.groundHeight(c.x, c.z, fromY + 0.1);
    const gy = Number.isFinite(g) ? g : (this.ctx.stage?.arena?.floorY ?? fromY);
    return out.set(c.x, fromY - gy > AIR_GAP ? fromY : gy, c.z);
  }

  /** 关卡强度系数 S（与 ScrollKit.procScale 相同公式） */
  private strength(): number {
    const d = this.ctx.run?.difficulty ?? 1;
    return 1 + Math.max(0, d - 1) * 0.85;
  }

  private radiusMult(): number {
    return this.ctx.player.stats.mult('explosionRadiusPct');
  }

  private rec(enemy: IEnemy): IcdRec {
    let r = this.icd.get(enemy);
    if (!r) {
      r = {};
      this.icd.set(enemy, r);
    }
    return r;
  }

  private ready(enemy: IEnemy, key: IcdKey, now: number): boolean {
    const t = this.icd.get(enemy)?.[key];
    return t === undefined || now >= t;
  }

  /** 记录反应冷却：基础冷却 / (1 + reactionHaste)，最低 0.3 秒 */
  private arm(enemy: IEnemy, id: ReactionId, now: number): void {
    const haste = this.ctx.player.stats.get('reactionHaste');
    const cd = Math.max(ICD_FLOOR, REACTION_TUNING[id].icd / Math.max(0.05, 1 + haste));
    this.rec(enemy)[id] = now + cd;
  }

  private syncFrame(): void {
    const f = this.ctx.time.frame;
    if (f === this.frame) return;
    this.frame = f;
    this.used = 0;
    this.bigFxUsed = 0;
  }

  /** 帧预算 / 队列上限；被拒绝时计入 dropped */
  private canAccept(): boolean {
    this.syncFrame();
    if (this.used >= FRAME_BUDGET || this.queue.length >= QUEUE_CAP) {
      this.rx.dropped++;
      this.secDropped++;
      return false;
    }
    return true;
  }

  /** 本帧是否还有大爆炸特效预算 */
  private bigFx(): boolean {
    this.syncFrame();
    if (this.bigFxUsed >= BIG_FX_BUDGET) return false;
    this.bigFxUsed++;
    if (this.bigFxUsed > this.rx.bigFxFrameMax) this.rx.bigFxFrameMax = this.bigFxUsed;
    return true;
  }

  private push(p: Pending): void {
    p.frame = this.ctx.time.frame;
    this.queue.push(p);
    this.used++;
    const rx = this.rx;
    rx.accepted++;
    this.secAccepted++;
    rx.byId[p.kind === 'collapse' ? 'collapse' : p.id]++;
    if (this.used > rx.frameMax) rx.frameMax = this.used;
  }

  private alloc(): Pending {
    const p: Pending = this.spare.pop() ?? {
      kind: 'reaction', id: 'thunderfire', collapse: null, enemy: null, point: new THREE.Vector3(), pin: 0, depth: 0,
      weaponUid: undefined, scale: 1, fixedBase: null, mult: 1, cash: 0, killed: false, at: 0, origin: 'status', tag: undefined,
      frame: -1,
    };
    p.kind = 'reaction';
    p.id = 'thunderfire';
    p.collapse = null;
    p.enemy = null;
    p.point.set(0, 0, 0);
    p.pin = 0;
    p.depth = 0;
    p.weaponUid = undefined;
    p.scale = 1;
    p.fixedBase = null;
    p.mult = 1;
    p.cash = 0;
    p.killed = false;
    p.at = 0;
    p.origin = 'status';
    p.tag = undefined;
    p.frame = -1;
    return p;
  }

  private release(p: Pending): void {
    p.enemy = null;
    this.spare.push(p);
  }

  /** ?debug 时把计数器挂到 window.__rx，并每秒结算一次 perSec */
  private publishDebug(): void {
    const rx = this.rx;
    if (!this.debugChecked) {
      this.debugChecked = true;
      if (this.ctx.game?.debug) (window as unknown as Record<string, unknown>).__rx = rx;
    }
    const now = this.ctx.time.now;
    if (now - this.secStart >= 1 || now < this.secStart) {
      rx.perSec.accepted = this.secAccepted;
      rx.perSec.dropped = this.secDropped;
      this.secAccepted = 0;
      this.secDropped = 0;
      this.secStart = now;
    }
    rx.queue = this.queue.length;
    rx.pools = this.pools.length;
  }

  // ───────────── 生命周期 ─────────────

  /** 换关 / 新开一局（Combat.clear 调用）：清空队列、冷却 / 脉滞、熔池与帧计数 */
  clear(): void {
    this.epoch++;
    for (let i = 0; i < this.queue.length; i++) this.release(this.queue[i]);
    this.queue.length = 0;
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      pool.ended = true;
      pool.vis.release();
    }
    this.pools.length = 0;
    this.icd = new WeakMap();
    this.vuln = new WeakMap();
    this.near.length = 0;
    this.nearDist.length = 0;
    this.picked.length = 0;
    this.poolBuf.length = 0;
    _exclude.clear();
    this.frame = -1;
    this.used = 0;
    this.bigFxUsed = 0;
    this.secAccepted = 0;
    this.secDropped = 0;
    this.secStart = this.ctx.time.now;
  }
}
