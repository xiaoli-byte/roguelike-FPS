/**
 * 触发类词条与传说特性：监听 Combat 的伤害 / 击杀 / 元素反应事件，按 weaponUid 找到对应武器实例。
 *
 * - 「武器伤害」= 武器直接命中（source 'weapon'），或武器投射物的爆炸（source 'explosion' 且 tags 含 'weapon'），
 *   见 isWeaponReq。只有直接命中（procDepth 0）会触发命中类效果；「连环爆」按 procDepth < 2 允许有限连锁。
 * - 会再次造成伤害 / 施加状态的效果（爆头爆炸、弹射、连环爆、万象 / 副元素附着、破势引爆、涅槃、蛊种传染）放进队列，
 *   在下一次武器更新时执行，避免在 Combat 的结算 / 事件派发过程中重入。
 * - 同帧合并：同一帧内武器对同一敌人的直接伤害累加进 dealtNow；flush 时换成 dealtPrev，
 *   副元素附着与引爆的强度取「上一帧对该敌人的总伤害」（一发霰弹 / 一次爆炸按整发计）。
 * - 「猎首」「乘隙」「化合」「轮回」「鼎沸」通过 outgoing modifier 生效（投射物 / 爆炸在发射时不知道目标）。
 * - 「回元」「疾化」「化盾」「鼎沸」监听 'enemy:reaction'，只认归属于本武器的反应；「蛊种」任何来源的反应都会传染。
 * - 斩击（魔刀千刃，tags 含 'slash'）：副元素 / 万象几率按远程形态的命中频率抽取，斩击命中时乘 R.meleeHitScale 归一化；
 *   弹射几率不再按弹体数折算（一段斩击对每名敌人只结算一次）。
 */
import * as THREE from 'three';
import type {
  DamageRequest, DamageResult, DetonateOpts, Element, GameContext, GameEvents, IEnemy, OutgoingDamageModifier,
  ReactionId, StatusApplyOpts, StatusId, TriggerReactionOpts, WeaponForm, WeaponInstance,
} from '../core/types';
import { ELEMENT_COLORS, REACTION_TAG } from '../core/types';
import { hitsPerShot } from './WeaponDefs';
import { novaDamage, type ResolvedWeapon } from './WeaponStats';

/** 每把武器的运行时状态（不存进 WeaponInstance） */
export interface WeaponRuntime {
  /** 累计射击次数（「天命」） */
  shots: number;
  /** 「狂热」层数与最近一次叠层时间 */
  frenzy: number;
  frenzyTime: number;
  /** 最近一次爆头爆炸时间（霰弹多弹丸同帧只炸一次） */
  lastHeadBlast: number;
  /** 切走时记录的射击冷却结束时间（切回后恢复，防止快速切枪绕过射速） */
  readyAt: number;
  /** 元素轮转进度（三才转轮） */
  cycleIndex: number;
  /** 「疾化」射速加成截止时间 */
  rxnHasteUntil: number;
  /** 双形态武器（魔刀千刃）的当前形态，按实例保存（切走再切回保持）；新实例为 'melee'；普通武器忽略 */
  form: WeaponForm;
}

export interface EffectHost {
  find(uid: number): WeaponInstance | null;
  resolve(inst: WeaponInstance): ResolvedWeapon;
  runtime(inst: WeaponInstance): WeaponRuntime;
  /** 回填弹匣 */
  refill(inst: WeaponInstance, rounds: number): void;
}

type ProcKind = 'headBlast' | 'ricochet' | 'nova' | 'status' | 'sub' | 'detonate' | 'nirvana' | 'echo';

interface Proc {
  kind: ProcKind;
  uid: number;
  /** 弹射源 / 附着与引爆目标；涅槃为死者；蛊种传染为带种的敌人（选目标时排除） */
  enemy: IEnemy | null;
  point: THREE.Vector3;
  base: number;
  element: Element;
  elementChance: number;
  critMult: number;
  depth: number;
  radius: number;
  status: StatusId;
  /** 威力比例（蛊种传染：fixedBase = base × scale） */
  scale: number;
  /** 涅槃 / 蛊种传染要引发的反应 */
  reaction: ReactionId;
  /** 引爆强度倍率（破势） */
  mult: number;
  /** 蛊种传染：执行时选中的目标 */
  target: IEnemy | null;
}

/** 每把武器的反应类运行时状态（本文件私有；只有 cycleIndex / rxnHasteUntil 放在共享的 WeaponRuntime） */
interface RxState {
  /** 「轮回」下次可附着的时间与轮转序号 */
  lunhuiAt: number;
  lunhuiIdx: number;
  /** 「破势」上次引爆时间 */
  lastDetonate: number;
  /** 「回元」「化盾」上次生效时间 */
  lastRefill: number;
  lastShield: number;
  /** 「鼎沸」层数与最近一次叠层时间 */
  boil: number;
  boilTime: number;
}

/** 敌人身上的蛊种 */
interface Seed {
  until: number;
  value: number;
  uid: number;
}

type ElementStatus = 'burn' | 'shock' | 'corrode';

/** 元素状态（也是「万象」与「轮回」的附着顺序） */
const ELEMENT_STATUSES: readonly ElementStatus[] = ['burn', 'shock', 'corrode'];
const ELEMENT_TO_STATUS: Readonly<Record<Element, ElementStatus | null>> = {
  none: null,
  fire: 'burn',
  shock: 'shock',
  corrode: 'corrode',
};
const HEAD_BLAST_RADIUS = 2.2;
const RICOCHET_RANGE = 10;
const RICOCHET_DAMAGE = 0.5;
const FRENZY_MAX = 10;
/** 附着 / 引爆强度上限 = 敌人最大生命 × 0.5（与状态系统一致） */
const POWER_CAP = 0.5;
/** 「万象」附着引发的反应威力倍率 */
const PRISM_REACTION_SCALE = 0.6;
/** 「破势」同一把武器两次引爆的最短间隔 */
const DETONATE_ICD = 1.5;
/** 斩击伤害请求的标签（魔刀千刃的斩击与武器技能都带） */
const SLASH_TAG = 'slash';
/** 归一化后的「每次命中几率」上限 */
const PER_HIT_CAP = 0.75;
/** 「回元」「化盾」最短间隔 */
const RXN_PROC_GAP = 0.3;
/** 「疾化」持续时间 */
const RXN_HASTE_TIME = 3;
/** 「鼎沸」层数上限与清空时间 */
const BOIL_MAX = 8;
const BOIL_WINDOW = 4;
/** 「轮回」对本武器引发的「归墟」的伤害倍率 */
const LUNHUI_ABYSS_MULT = 1.5;
/** 「涅槃」引发的反应深度（中心已死，只结算范围部分；范围击杀为 status 来源，不会再触发涅槃） */
const NIRVANA_DEPTH = 1;
/** 蛊种持续时间、传染范围与连线颜色 */
const SEED_DURATION = 6;
const ECHO_RANGE = 8;
const ECHO_COLOR = 0x9dff4a;
/** 与反应系统一致：depth >= 2 的强制反应会被拒绝（蛊种不为必被拒绝的传染消耗自己） */
const REACTION_MAX_DEPTH = 2;
/**
 * 「合璧」同一敌人两次强制附着的最短间隔 = 最短的两两反应冷却（焚雷 1 秒 / (1 + 反应急速)，最低 0.3 秒）。
 * 更频繁的附着不会多引发反应，却会让雷殛每 3 发叠满眩晕一次（高射速雷属性武器实测眩晕覆盖率 97%）。
 */
const BOND_GAP = 1.0;
const BOND_GAP_FLOOR = 0.3;

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

// 复用的选项对象（Combat 同步读取字段、不持有引用；每处只改会变的字段）
const _subOpts: StatusApplyOpts = { depth: 0, weaponUid: 0 };
const _prismOpts: StatusApplyOpts = { depth: 0, weaponUid: 0, reactionScale: PRISM_REACTION_SCALE };
const _detonateOpts: DetonateOpts = { power: 0, mult: 1, depth: 0, weaponUid: 0 };
const _nirvanaOpts: TriggerReactionOpts = { depth: NIRVANA_DEPTH, weaponUid: 0, point: undefined, ignoreIcd: true, tag: 'nirvana' };
const _echoOpts: TriggerReactionOpts = { depth: 1, weaponUid: 0, fixedBase: 0, tag: 'echo' };

function blastColor(e: Element): number {
  return e === 'none' ? 0xffa040 : ELEMENT_COLORS[e];
}

function hasTag(req: DamageRequest, tag: string): boolean {
  const t = req.tags;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === tag) return true;
  return false;
}

/** 武器伤害：武器直接命中，或武器投射物的爆炸（Projectiles 把原 source 'weapon' 放进了 tags） */
function isWeaponReq(req: DamageRequest): boolean {
  return req.weaponUid !== undefined && (req.source === 'weapon' || (req.source === 'explosion' && hasTag(req, 'weapon')));
}

/** 副元素每次命中几率：k = 1（普通命中）时原样；斩击乘归一化系数并封顶 */
function subChance(v: number, k: number): number {
  return k === 1 ? v : Math.min(PER_HIT_CAP, v * k);
}

/** 敌人身上元素状态（灼烧 / 雷殛 / 蚀化）的种数 */
function countElementStatuses(e: IEnemy): number {
  const s = e.statuses;
  return (s.has('burn') ? 1 : 0) + (s.has('shock') ? 1 : 0) + (s.has('corrode') ? 1 : 0);
}

/** 敌人身上是否有除 s 以外的元素状态 */
function hasOtherElement(e: IEnemy, s: ElementStatus): boolean {
  for (let i = 0; i < ELEMENT_STATUSES.length; i++) {
    const x = ELEMENT_STATUSES[i];
    if (x !== s && e.statuses.has(x)) return true;
  }
  return false;
}

/** 身上已有状态对应的反应：三种齐聚 → 归墟；否则 焚雷 > 熔金 > 封脉；不足两种 → null */
function statusReaction(e: IEnemy): ReactionId | null {
  const s = e.statuses;
  const b = s.has('burn');
  const k = s.has('shock');
  const c = s.has('corrode');
  if (b && k && c) return 'abyss';
  if (b && k) return 'thunderfire';
  if (b && c) return 'meltdown';
  if (k && c) return 'veinseal';
  return null;
}

function newProc(): Proc {
  return {
    kind: 'headBlast', uid: 0, enemy: null, point: new THREE.Vector3(), base: 0, element: 'none',
    elementChance: 0, critMult: 2, depth: 1, radius: 0, status: 'burn',
    scale: 1, reaction: 'thunderfire', mult: 1, target: null,
  };
}

export class AffixEffects {
  private queue: Proc[] = [];
  private spare: Proc[] = [];
  private readonly pool: Proc[] = [];
  private readonly exclude = new Set<IEnemy>();
  private modOff: (() => void) | null = null;
  /** 同帧合并：本帧 / 上一帧武器直接伤害（procDepth 0）按敌人累加 */
  private dealtNow = new Map<IEnemy, number>();
  private dealtPrev = new Map<IEnemy, number>();
  private readonly rxStates = new WeakMap<WeaponInstance, RxState>();
  private readonly seeds = new WeakMap<IEnemy, Seed>();
  /** 「合璧」各敌人下次可强制附着的时刻 */
  private readonly bondAt = new WeakMap<IEnemy, number>();

  constructor(
    private readonly ctx: GameContext,
    private readonly host: EffectHost,
  ) {}

  init(): void {
    const ev = this.ctx.events;
    ev.on('enemy:damaged', ({ enemy, result }) => this.onDamaged(enemy, result));
    ev.on('enemy:killed', ({ enemy, result }) => this.onKilled(enemy, result));
    ev.on('enemy:reaction', (e) => this.onReaction(e));
    this.installModifier();
  }

  /**
   * 注册（或重新注册）武器伤害修饰器。换关时调用一次：
   * 先移除旧的再添加，因此无论 Combat.clear() 是否清空修饰器都只会存在一份。
   */
  installModifier(): void {
    if (this.modOff) this.modOff();
    this.modOff = this.ctx.combat.addOutgoingModifier(this.weaponModifier);
  }

  /**
   * 「猎首」「乘隙」「化合」「轮回」（归墟）「鼎沸」。
   * 反应伤害（带 'reaction' 标签、有武器归属）只吃化合 / 轮回 / 鼎沸；武器伤害吃猎首 / 乘隙 / 鼎沸。
   */
  private readonly weaponModifier: OutgoingDamageModifier = (enemy, req) => {
    if (req.weaponUid === undefined) return 1;
    const inst = this.host.find(req.weaponUid);
    if (!inst) return 1;
    const R = this.host.resolve(inst);
    const boil = R.legendary === 'lg_boil' ? this.boilMult(inst, R) : 1;
    let m = 1;
    if (hasTag(req, REACTION_TAG)) {
      if (R.rxnDmg > 0) m *= 1 + R.rxnDmg;
      if (R.legendary === 'lg_lunhui' && hasTag(req, 'abyss')) m *= LUNHUI_ABYSS_MULT;
      return m * boil;
    }
    if (!isWeaponReq(req)) return 1;
    if (R.hunter > 0 && (enemy.isBoss || enemy.isElite)) m *= 1 + R.hunter;
    // 修饰器在附着之前调用：统计的是命中前身上的状态
    if (R.statusHunter > 0) m *= 1 + R.statusHunter * countElementStatuses(enemy);
    return m * boil;
  };

  /** 执行上一帧累积的触发效果 */
  flush(): void {
    // 同帧合并：dealtPrev = 上一帧全部武器直接伤害；dealtNow 换成上次执行完已清空的那张表
    const frame = this.dealtNow;
    this.dealtNow = this.dealtPrev;
    this.dealtPrev = frame;
    if (this.queue.length > 0) {
      const list = this.queue;
      this.queue = this.spare;
      this.spare = list;
      for (const p of list) {
        try {
          this.run(p);
        } catch (err) {
          console.error('[Weapons] proc failed', p.kind, err);
        }
        p.enemy = null;
        p.target = null;
        this.pool.push(p);
      }
      list.length = 0;
    }
    this.dealtPrev.clear();
  }

  /** 丢弃未执行的触发（换关） */
  clear(): void {
    for (const p of this.queue) {
      p.enemy = null;
      p.target = null;
      this.pool.push(p);
    }
    this.queue.length = 0;
    this.dealtNow.clear();
    this.dealtPrev.clear();
  }

  // ───────────── 事件 ─────────────

  private onDamaged(enemy: IEnemy, result: DamageResult): void {
    const req = result.request;
    if (!isWeaponReq(req)) return;
    if ((req.procDepth ?? 0) > 0) return;
    // 同帧合并：累加本帧武器对该敌人的直接伤害
    if (result.dealt > 0) this.dealtNow.set(enemy, (this.dealtNow.get(enemy) ?? 0) + result.dealt);
    const inst = this.host.find(req.weaponUid as number);
    if (!inst) return;
    const R = this.host.resolve(inst);
    const ctx = this.ctx;
    const now = ctx.time.now;
    /** 这一击之后敌人仍存活（击杀的一击 killed 为 true，但 alive 要到伤害管线末尾才置 false） */
    const live = !result.killed && enemy.alive;
    /** 斩击：命中频率归一化系数（普通命中 1） */
    const slash = hasTag(req, SLASH_TAG);
    const k = slash ? R.meleeHitScale : 1;

    // 命中回盾
    if (R.hitShield > 0 && result.dealt > 0 && ctx.player.alive) ctx.player.addShield(result.dealt * R.hitShield);

    // 狂热：命中叠层（同一帧的多弹丸只算一层）
    if (R.legendary === 'lg_frenzy') {
      const rt = this.host.runtime(inst);
      if (rt.frenzy === 0 || now - rt.frenzyTime > 0.05) rt.frenzy = Math.min(FRENZY_MAX, rt.frenzy + 1);
      rt.frenzyTime = now;
    }

    // 爆头爆炸
    if (R.headBlast > 0 && req.headshot) {
      const rt = this.host.runtime(inst);
      if (now - rt.lastHeadBlast > 0.08) {
        rt.lastHeadBlast = now;
        const p = this.allocFor('headBlast', inst, R, req.element);
        if (req.point) p.point.copy(req.point);
        else enemy.getHeadCenter(p.point);
        p.base = R.perShot * R.headBlast;
        p.radius = HEAD_BLAST_RADIUS * R.blastMult;
        p.depth = 1;
      }
    }

    // 弹射：多弹丸武器按 1/√弹丸数 折算几率（斩击不折算）
    if (R.ricochet > 0 && ctx.rng.next() < (slash ? R.ricochet : R.ricochet / Math.sqrt(hitsPerShot(R.def)))) {
      const p = this.allocFor('ricochet', inst, R, req.element);
      p.enemy = enemy;
      if (req.point) p.point.copy(req.point);
      else enemy.getBodyCenter(p.point);
      p.base = req.base * RICOCHET_DAMAGE;
      p.depth = 1;
    }

    // 万象：各元素独立判定（附着引发的反应威力 ×0.6）
    if (R.legendary === 'lg_prism' && enemy.alive) {
      const chance = slash ? Math.min(PER_HIT_CAP, R.legendaryValue * k) : R.legendaryValue;
      for (const s of ELEMENT_STATUSES) {
        if (ctx.rng.next() >= chance) continue;
        const p = this.allocFor('status', inst, R);
        p.enemy = enemy;
        p.status = s;
        p.base = Math.max(1, result.dealt);
        p.depth = 0;
      }
    }

    if (live) {
      // 副·焚 / 副·雷 / 副·蚀：这一击没附着同种状态时掷骰
      if (R.subFire > 0 && result.statusApplied !== 'burn' && ctx.rng.next() < subChance(R.subFire, k)) this.queueSub(inst, R, enemy, 'burn', result.dealt);
      if (R.subShock > 0 && result.statusApplied !== 'shock' && ctx.rng.next() < subChance(R.subShock, k)) this.queueSub(inst, R, enemy, 'shock', result.dealt);
      if (R.subCorrode > 0 && result.statusApplied !== 'corrode' && ctx.rng.next() < subChance(R.subCorrode, k)) this.queueSub(inst, R, enemy, 'corrode', result.dealt);

      // 合璧：命中带有其他元素状态的敌人时必定附加本发元素（三才转轮按本发实际元素）；
      // 同一敌人按最短反应冷却限频（见 BOND_GAP）
      if (R.legendary === 'lg_bond') {
        const s = ELEMENT_TO_STATUS[req.element];
        if (s && result.statusApplied !== s && hasOtherElement(enemy, s) && now >= (this.bondAt.get(enemy) ?? -1)) {
          const gap = Math.max(BOND_GAP_FLOOR, BOND_GAP / Math.max(0.05, 1 + ctx.player.stats.get('reactionHaste')));
          this.bondAt.set(enemy, now + gap);
          this.queueSub(inst, R, enemy, s, result.dealt);
        }
      }

      // 轮回：每 legendaryValue 秒依次附加灼烧、雷殛、蚀化
      if (R.legendary === 'lg_lunhui') {
        const st = this.rx(inst);
        if (now >= st.lunhuiAt) {
          st.lunhuiAt = now + R.legendaryValue;
          const s = ELEMENT_STATUSES[st.lunhuiIdx++ % ELEMENT_STATUSES.length];
          this.queueSub(inst, R, enemy, s, result.dealt);
        }
      }

      // 破势：暴击或爆头时引爆目标身上的元素状态
      if (R.detonate > 0 && (req.headshot || result.isCrit) && countElementStatuses(enemy) > 0) {
        const st = this.rx(inst);
        if (now - st.lastDetonate >= DETONATE_ICD) {
          st.lastDetonate = now;
          const p = this.allocFor('detonate', inst, R);
          p.enemy = enemy;
          p.base = result.dealt;
          p.mult = R.detonate;
          p.depth = 0;
        }
      }

      // 蛊种：种下（或刷新）蛊种，不入队
      if (R.seed > 0) {
        let sd = this.seeds.get(enemy);
        if (!sd) {
          sd = { until: 0, value: 0, uid: 0 };
          this.seeds.set(enemy, sd);
        }
        sd.until = now + SEED_DURATION;
        sd.value = R.seed;
        sd.uid = inst.uid;
      }
    }

    // 涅槃：击杀身负两种以上元素状态的敌人（此时状态还没清空），于尸身引发对应反应
    if (R.legendary === 'lg_nirvana' && result.killed) {
      const id = statusReaction(enemy);
      if (id) {
        const p = this.allocFor('nirvana', inst, R);
        p.enemy = enemy;
        enemy.getBodyCenter(p.point);
        p.reaction = id;
        p.base = enemy.maxHp * R.legendaryValue;
        p.depth = NIRVANA_DEPTH;
      }
    }
  }

  private onKilled(enemy: IEnemy, result: DamageResult): void {
    const req = result.request;
    if (!isWeaponReq(req)) return;
    const inst = this.host.find(req.weaponUid as number);
    if (!inst) return;
    const R = this.host.resolve(inst);
    const depth = req.procDepth ?? 0;

    if (R.killRefill > 0 && depth === 0) this.host.refill(inst, Math.max(1, Math.round(R.magCap * R.killRefill)));

    if (R.legendary === 'lg_nova' && depth < 2) {
      const p = this.allocFor('nova', inst, R, req.element);
      enemy.getBodyCenter(p.point);
      p.base = novaDamage(R);
      p.radius = R.legendaryValue * R.blastMult;
      p.depth = depth + 1;
      p.elementChance = p.element === 'none' ? 0 : 1;
    }
  }

  /** 'enemy:reaction'：在 Combat 的反应 flush 中、效果执行完毕后派发（不在伤害管线内） */
  private onReaction(e: GameEvents['enemy:reaction']): void {
    const ctx = this.ctx;
    const now = ctx.time.now;

    // 蛊种：任何来源的反应都会传染给附近 1 名敌人（传染出的反应不再传染）
    if (e.tag !== 'echo' && e.depth + 1 < REACTION_MAX_DEPTH) {
      const sd = this.seeds.get(e.enemy);
      if (sd && sd.until > now) {
        sd.until = -1;
        const p = this.alloc('echo', sd.uid);
        p.enemy = e.enemy;
        p.point.copy(e.point);
        p.reaction = e.reaction;
        p.base = e.base;
        p.scale = sd.value;
        p.depth = e.depth + 1;
      }
    }

    // 以下只认归属于本武器的反应
    if (e.weaponUid === undefined) return;
    const inst = this.host.find(e.weaponUid);
    if (!inst) return;
    const R = this.host.resolve(inst);
    const st = this.rx(inst);

    // 回元
    if (R.rxnRefill > 0 && now - st.lastRefill > RXN_PROC_GAP) {
      st.lastRefill = now;
      this.host.refill(inst, Math.max(1, Math.round(R.magCap * R.rxnRefill)));
    }
    // 疾化（WeaponSystem 读取 rxnHasteUntil 加射速）
    if (R.rxnHaste > 0) this.host.runtime(inst).rxnHasteUntil = now + RXN_HASTE_TIME;
    // 化盾
    if (R.rxnShield > 0 && now - st.lastShield > RXN_PROC_GAP && ctx.player.alive) {
      st.lastShield = now;
      ctx.player.addShield(R.rxnShield);
    }
    // 鼎沸：叠层（4 秒未触发则从 0 重新叠）
    if (R.legendary === 'lg_boil') {
      st.boil = Math.min(BOIL_MAX, (now - st.boilTime > BOIL_WINDOW ? 0 : st.boil) + 1);
      st.boilTime = now;
    }
  }

  // ───────────── 内部 ─────────────

  private rx(inst: WeaponInstance): RxState {
    let st = this.rxStates.get(inst);
    if (!st) {
      st = { lunhuiAt: -99, lunhuiIdx: 0, lastDetonate: -99, lastRefill: -99, lastShield: -99, boil: 0, boilTime: -99 };
      this.rxStates.set(inst, st);
    }
    return st;
  }

  /** 「鼎沸」当前倍率 */
  private boilMult(inst: WeaponInstance, R: ResolvedWeapon): number {
    const st = this.rx(inst);
    return this.ctx.time.now - st.boilTime <= BOIL_WINDOW ? 1 + st.boil * R.legendaryValue : 1;
  }

  /** 附着 / 引爆强度：上一帧武器对该敌人的总伤害（同帧合并），没有记录时用入队时这一击的伤害 */
  private mergedPower(enemy: IEnemy, base: number): number {
    return Math.min(this.dealtPrev.get(enemy) ?? base, enemy.maxHp * POWER_CAP);
  }

  /** 副元素类附着入队：同一武器对同一敌人的同种状态在队列里只留一条（一发霰弹 / 一次爆炸只附着一次） */
  private queueSub(inst: WeaponInstance, R: ResolvedWeapon, enemy: IEnemy, s: ElementStatus, base: number): void {
    const q = this.queue;
    for (let i = 0; i < q.length; i++) {
      const o = q[i];
      if (o.kind === 'sub' && o.uid === inst.uid && o.enemy === enemy && o.status === s) return;
    }
    const p = this.allocFor('sub', inst, R);
    p.enemy = enemy;
    p.status = s;
    p.base = base;
    p.depth = 0;
  }

  private alloc(kind: ProcKind, uid: number): Proc {
    const p = this.pool.pop() ?? newProc();
    p.kind = kind;
    p.uid = uid;
    p.enemy = null;
    p.target = null;
    p.base = 0;
    p.element = 'none';
    p.elementChance = 0;
    p.critMult = 2;
    p.depth = 1;
    p.radius = 0;
    p.status = 'burn';
    p.scale = 1;
    p.reaction = 'thunderfire';
    p.mult = 1;
    this.queue.push(p);
    return p;
  }

  /** element：触发这次效果的那一击的实际元素（三才转轮逐发轮转，不能读 inst.element） */
  private allocFor(kind: ProcKind, inst: WeaponInstance, R: ResolvedWeapon, element: Element = inst.element): Proc {
    const p = this.alloc(kind, inst.uid);
    p.element = element;
    p.elementChance = R.elementChance;
    p.critMult = R.critMult;
    return p;
  }

  private run(p: Proc): void {
    const ctx = this.ctx;
    switch (p.kind) {
      case 'headBlast':
      case 'nova': {
        const req: DamageRequest = {
          base: p.base,
          element: p.element,
          source: 'weapon',
          elementChance: p.elementChance,
          canCrit: false,
          weaponUid: p.uid,
          procDepth: p.depth,
          knockback: p.kind === 'nova' ? 6 : 4,
        };
        const color = blastColor(p.element);
        ctx.combat.explode(p.point, p.radius, req, { color });
        if (p.kind === 'nova') ctx.fx.ring(p.point, p.radius, color, 0.45);
        ctx.audio.play('explosion', { position: p.point, volume: p.kind === 'nova' ? 0.6 : 0.45 });
        break;
      }
      case 'ricochet': {
        this.exclude.clear();
        if (p.enemy) this.exclude.add(p.enemy);
        const target = ctx.enemies.nearest(p.point, RICOCHET_RANGE, this.exclude);
        if (!target || !target.alive) break;
        target.getBodyCenter(_c);
        ctx.fx.tracer(p.point, _c, blastColor(p.element), 0.02);
        _d.subVectors(_c, p.point).normalize();
        ctx.combat.damageEnemy(target, {
          base: p.base,
          element: p.element,
          source: 'weapon',
          elementChance: p.elementChance,
          critMult: p.critMult,
          weaponUid: p.uid,
          point: _c.clone(),
          direction: _d.clone(),
          knockback: 0.5,
          procDepth: p.depth,
        });
        break;
      }
      case 'status': {
        const e = p.enemy;
        if (!e || !e.alive) break;
        _prismOpts.weaponUid = p.uid;
        ctx.combat.applyStatus(e, p.status, p.base, undefined, _prismOpts);
        break;
      }
      case 'sub': {
        const e = p.enemy;
        if (!e || !e.alive) break;
        _subOpts.weaponUid = p.uid;
        ctx.combat.applyStatus(e, p.status, this.mergedPower(e, p.base), undefined, _subOpts);
        break;
      }
      case 'detonate': {
        const e = p.enemy;
        if (!e || !e.alive) break;
        _detonateOpts.power = this.mergedPower(e, p.base);
        _detonateOpts.mult = p.mult;
        _detonateOpts.weaponUid = p.uid;
        ctx.combat.detonate(e, _detonateOpts);
        break;
      }
      case 'nirvana': {
        // 中心已死：只结算范围部分（反应系统 clone 中心点）
        if (!p.enemy) break;
        _nirvanaOpts.weaponUid = p.uid;
        _nirvanaOpts.point = p.point;
        ctx.combat.triggerReaction(p.enemy, p.reaction, p.base, _nirvanaOpts);
        _nirvanaOpts.point = undefined;
        break;
      }
      case 'echo': {
        this.exclude.clear();
        if (p.enemy) this.exclude.add(p.enemy);
        const t = ctx.enemies.nearest(p.point, ECHO_RANGE, this.exclude);
        this.exclude.clear();
        if (!t || !t.alive) break;
        p.target = t;
        _echoOpts.depth = p.depth;
        _echoOpts.weaponUid = p.uid;
        _echoOpts.fixedBase = p.base * p.scale;
        if (ctx.combat.triggerReaction(t, p.reaction, 0, _echoOpts)) {
          t.getBodyCenter(_c);
          ctx.fx.beam(p.point, _c, ECHO_COLOR, 0.06, 0.25);
        }
        break;
      }
    }
  }
}
