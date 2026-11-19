/**
 * 首领定义（Unity BossDef.cs 的网页版，docs/threejs-migration.md M6）：难度定档、阶段表、生命刻度、形态、招式调度参数、狂怒、召唤上限、
 * 破防条、领主梯度、登场 / 溃散参数。纯数据 + 纯计算（不碰场景），node --test 直接测。
 *
 * 招式在 Unity 里是 BossMove 子类的工厂；网页把「调度 + 时间轴参数」拆成纯数据 {@link BossMoveSpec}（定义、模拟、测试读它），
 * 运行时的招式对象（framework/BossMove.ts）由具体首领按 spec 造。
 */

export interface BossVitals {
  hp: number;
  shield: number;
  armor: number;
}

export function bossVitals(hp: number, shield = 0, armor = 0): BossVitals {
  return { hp, shield, armor };
}

export function vitalsTotal(v: BossVitals): number {
  return v.hp + v.shield + v.armor;
}

export function scaleVitals(v: BossVitals, k: number): BossVitals {
  return { hp: v.hp * k, shield: v.shield * k, armor: v.armor * k };
}

export function lerpVitals(a: BossVitals, b: BossVitals, t: number): BossVitals {
  const u = Math.min(1, Math.max(0, t));
  return { hp: a.hp + (b.hp - a.hp) * u, shield: a.shield + (b.shield - a.shield) * u, armor: a.armor + (b.armor - a.armor) * u };
}

/** 定档：某个难度下的三层数值（见 {@link BossDef.vitalsAt}） */
export interface BossVitalsTier {
  difficulty: number;
  vitals: BossVitals;
}

/**
 * 一次阶段转换：生命层跌到 at 以下时，等当前招式收尾（最多 phaseWait 秒），然后进入 seconds 秒的转换演出（不可选中、霸体）。
 * form 不为空时在演出的 swapAt 秒换形。
 */
export interface BossPhaseDef {
  at: number;
  form?: string | null;
  seconds: number;
  /** 演出的第几秒换形（负数 = 演出时长的 40%） */
  formSwapAt: number;
  anim: string;
  sfx: string | null;
  shake: number;
  toast?: string | null;
  /** 新阶段的喘息倍率（越小出招越密） */
  restScale: number;
  /** 演出结束后第一招 */
  firstMove?: string | null;
}

export function bossPhase(p: Partial<BossPhaseDef> & { at: number }): BossPhaseDef {
  return { seconds: 2.4, formSwapAt: -1, anim: 'roar', sfx: 'boss_roar', shake: 0.45, restScale: 1, ...p };
}

/** 换形时刻（秒）：没写时取演出时长的 40% */
export function phaseSwapAt(p: BossPhaseDef): number {
  return p.formSwapAt >= 0 ? Math.min(p.formSwapAt, p.seconds) : p.seconds * 0.4;
}

/** 生命刻度事件（不是阶段）：生命层第一次跌到 at 以下时调 onMark；tick = 血条上也画一道刻度 */
export interface BossMark {
  at: number;
  id: string;
  tick?: boolean;
}

export interface BossFormDef {
  id: string;
  name?: string | null;
  prefab?: string;
  scale?: number;
  proxyPrefab?: string;
  proxyScale?: number;
  weakBone?: string;
  weakRadius?: number;
  shieldRestore?: number;
  armorRestore?: number;
  firstMove?: string | null;
  flying?: boolean;
}

/**
 * 一招的调度与时间轴参数（Unity BossMove 的公共字段）。plan 是「某个阶段节奏下的时间轴」（击杀用时模拟按它排招）
 */
export interface BossMoveSpec {
  id: string;
  name?: string;
  cooldown: number;
  recovery: number;
  firstDelay: number;
  weight: number;
  minPhase: number;
  maxPhase: number;
  forms?: string[] | null;
  stunnable: boolean;
  windup: number;
  active: number;
  recover: number;
}

/** BossMove 的缺省值（同 Unity：冷却 6、喘息 1.2、权重 1、前摇 1 / 出手 0.3 / 收招 0.6） */
export function bossMove(p: Partial<BossMoveSpec> & { id: string }): BossMoveSpec {
  return {
    cooldown: 6, recovery: 1.2, firstDelay: 0, weight: 1, minPhase: 0, maxPhase: Number.MAX_SAFE_INTEGER, forms: null, stunnable: false,
    windup: 1, active: 0.3, recover: 0.6, ...p,
  };
}

/** 破防条配置（framework/BreakBar.ts） */
export interface BreakBarDef {
  max: number;
  growth: number;
  seconds: number;
  takenMult: number;
  pose: string;
  label: string;
  weakFill: number;
  reactionFill: number;
  /**
   * 只在出招中的某些段才填（Unity BreakBarDef.fillWhen；null = 任何时候都填）：化蛇只在张嘴时。参数是首领本身（BossBrain），
   * 返回 false 这一次伤害不往条里填；抛异常按不填算
   */
  fillWhen: ((brain: unknown) => boolean) | null;
}

export function breakBarDef(p: Partial<BreakBarDef> = {}): BreakBarDef {
  return { max: 900, growth: 0.25, seconds: 4, takenMult: 1.3, pose: 'down', label: '破防', weakFill: 1, reactionFill: 1.5, fillWhen: null, ...p };
}

export interface BossIntroDef {
  seconds: number;
  anim: string;
  sfx: string | null;
  shake: number;
  /** 登场时打名字卡（登场演出自己打名字卡时关掉） */
  banner: boolean;
  /** 登场结束后到第一次出招的喘息（秒） */
  firstRest: number;
}

export interface BossDefeatDef {
  /** 溃散演出时长：期间每 0.2 s 一团爆炸，第 88% 时最后一下大爆炸 */
  seconds: number;
  /** 倒下瞬间的慢动作（倍率、真实秒数） */
  slowMo: number;
  slowMoSeconds: number;
  toast?: string | null;
  despawnAfter: number;
}

export interface BossRewards {
  essence: number;
  coins: [number, number];
  chest: string;
  healPlayer: boolean;
}

/** Unity DamageTable：伤害层 × 元素倍率（None 打护甲 75%；火克生命、雷克护盾、蚀克护甲） */
export const LAYER_MULT: Readonly<Record<string, readonly [number, number, number]>> = {
  none: [1, 0.75, 1],
  fire: [0.8, 1, 1.25],
  shock: [1.6, 0.8, 1],
  corrode: [1, 1.6, 1],
};

export function layerMult(element: string, layer: 'shield' | 'armor' | 'health'): number {
  const row = LAYER_MULT[element] ?? LAYER_MULT.none;
  return row[layer === 'shield' ? 0 : layer === 'armor' ? 1 : 2];
}

/** Unity EnemyAI.RoundHp：四舍五入（非有限数为 0） */
export function roundHp(v: number): number {
  return Number.isFinite(v) ? Math.floor(v + 0.5) : 0;
}

/** 0xRRGGBB 往白色插值 t */
export function towardWhite(color: number, t: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export class BossDef {
  id = '';
  name = '';
  title: string | null = null;

  // ───────────── 数值 ─────────────
  /** 难度 1 的三层耐久（没有定档时按难度等比放大） */
  vitals: BossVitals = bossVitals(1000);
  /** 定档表（按难度升序）：有的话优先用它 */
  readonly tiers: BossVitalsTier[] = [];
  /** 基础伤害（难度 1；× (1 + (难度 − 1) × 0.55)） */
  damage = 12;
  speed = 5;
  element = 'none';
  color = 0xff8844;
  warnColor: number | null = null;

  radius = 1;
  height = 4;

  // ───────────── 阶段 / 形态 ─────────────
  readonly phases: BossPhaseDef[] = [];
  readonly marks: BossMark[] = [];
  readonly forms: BossFormDef[] = [];

  // ───────────── 招式调度 ─────────────
  readonly moves: BossMoveSpec[] = [];
  /** 越过阈值后最多再等当前招式多久（秒），之后强制打断 */
  phaseWait = 2;
  /** 刚出过的那一招的权重倍率（0 = 只要还有别的招可出就不连出同一招） */
  repeatWeight = 0;
  idleMinRange = 7;
  idleMaxRange = 14;
  /** 只有招式间隙能被眩晕；false = 整场免疫眩晕 */
  stunBetweenMoves = true;

  // ───────────── 狂怒 ─────────────
  enrageAfter = 0;
  enrageBelow = 0;
  enrageRestScale = 0.7;
  enrageWindupScale = 0.85;
  enrageDamageScale = 1.15;
  enrageToast: string | null = null;

  // ───────────── 召唤 / 破防 / 领主 ─────────────
  summonCap = 6;
  breakBar: BreakBarDef | null = null;
  lordLevel: string | null = null;
  phaseCinematic = true;

  rewards: BossRewards = { essence: 60, coins: [60, 100], chest: 'weapon', healPlayer: true };
  intro: BossIntroDef = { seconds: 2.6, anim: 'roar', sfx: 'boss_roar', shake: 0.45, banner: true, firstRest: 1.4 };
  defeat: BossDefeatDef = { seconds: 3.2, slowMo: 0.35, slowMoSeconds: 0.6, toast: null, despawnAfter: 1.5 };

  private ticksCache: number[] | null = null;

  get firstForm(): BossFormDef | null {
    return this.forms[0] ?? null;
  }

  form(formId: string | null | undefined): BossFormDef | null {
    if (!formId) return null;
    return this.forms.find(f => f.id === formId) ?? null;
  }

  move(id: string): BossMoveSpec | null {
    return this.moves.find(m => m.id === id) ?? null;
  }

  /** 预警色：写了 warnColor 用它，否则主题色往白提亮 25% */
  get warn(): number {
    return this.warnColor ?? towardWhite(this.color, 0.25);
  }

  /**
   * 某个难度下的三层耐久：有定档表时相邻两档之间按难度线性插值，低于第一档 / 高于最后一档按难度等比外推；
   * 没有定档表时 = vitals × 难度。难度非法时按 1
   */
  vitalsAt(difficulty: number): BossVitals {
    const d = Number.isFinite(difficulty) && difficulty > 0 ? Math.max(0.5, difficulty) : 1;
    const tiers = this.tiers;
    if (tiers.length === 0) return scaleVitals(this.vitals, d);
    const first = tiers[0];
    if (d <= first.difficulty || tiers.length === 1) {
      const anchor = d <= first.difficulty ? first : tiers[tiers.length - 1];
      return scaleVitals(anchor.vitals, d / Math.max(0.01, anchor.difficulty));
    }
    for (let i = 1; i < tiers.length; i++) {
      const a = tiers[i - 1], b = tiers[i];
      if (d > b.difficulty) continue;
      const t = (d - a.difficulty) / Math.max(1e-4, b.difficulty - a.difficulty);
      return lerpVitals(a.vitals, b.vitals, t);
    }
    const last = tiers[tiers.length - 1];
    return scaleVitals(last.vitals, d / Math.max(0.01, last.difficulty));
  }

  /** 血条刻度（降序、去重）：全部阶段阈值 + 标了 tick 的生命刻度 */
  get barTicks(): readonly number[] {
    if (this.ticksCache) return this.ticksCache;
    const l: number[] = [];
    for (const p of this.phases) if (p.at > 0 && p.at < 1) l.push(p.at);
    for (const m of this.marks) if (m.tick && m.at > 0 && m.at < 1) l.push(m.at);
    l.sort((a, b) => b - a);
    for (let i = l.length - 1; i > 0; i--) if (Math.abs(l[i] - l[i - 1]) < 1e-4) l.splice(i, 1);
    return (this.ticksCache = l);
  }

  get phaseCount(): number {
    return this.phases.length + 1;
  }

  /** 某个阶段的喘息倍率（阶段 0 = 1；第 i 阶段取 phases[i − 1].restScale） */
  restScaleAt(phase: number): number {
    return phase > 0 && phase - 1 < this.phases.length ? this.phases[phase - 1].restScale : 1;
  }

  /** 自检：id / 名字、形态、阶段阈值严格降序、引用的形态与招式存在、招式 id 唯一、定档升序、难度 1 耐久合法 */
  validate(): string[] {
    const errs: string[] = [];
    if (!this.id.trim()) errs.push('没有 id');
    else if (!this.id.startsWith('boss')) errs.push(`id「${this.id}」不以 boss 开头（配乐按这个前缀切 boss 曲）`);
    if (!this.name.trim()) errs.push('没有名字');
    if (this.forms.length === 0) errs.push('没有形态（至少一个，forms[0] 是初始形态）');
    const formIds = new Set<string>();
    for (const f of this.forms) {
      if (!f.id) errs.push('有形态没有 id');
      else if (formIds.has(f.id)) errs.push(`形态 id「${f.id}」重复`);
      else if (!((f.scale ?? 1) > 0) || !((f.proxyScale ?? 1) > 0)) errs.push(`形态 ${f.id} 的体型倍率 ≤ 0`);
      formIds.add(f.id);
    }
    let prev = 1;
    for (const p of this.phases) {
      if (!(p.at > 0 && p.at < 1)) errs.push(`阶段阈值 ${p.at} 不在 (0, 1) 内`);
      else if (!(p.at < prev)) errs.push(`阶段阈值没有严格降序（${p.at} 在 ${prev} 之后）`);
      prev = Math.min(prev, p.at);
      if (!(p.seconds >= 0)) errs.push(`阶段 ${p.at} 的演出时长 ${p.seconds} 非法`);
      if (p.form && !this.form(p.form)) errs.push(`阶段 ${p.at} 要换的形态 ${p.form} 不存在`);
    }
    const moveIds = new Set<string>();
    for (const m of this.moves) {
      if (!m.id) errs.push('有招式没有 id');
      else if (moveIds.has(m.id)) errs.push(`招式 id「${m.id}」重复`);
      moveIds.add(m.id);
      for (const fid of m.forms ?? []) if (!this.form(fid)) errs.push(`招式 ${m.id} 限定的形态 ${fid} 不存在`);
    }
    if (this.moves.length === 0) errs.push('没有招式');
    for (const p of this.phases) if (p.firstMove && !moveIds.has(p.firstMove)) errs.push(`阶段 ${p.at} 的第一招 ${p.firstMove} 不存在`);
    for (const f of this.forms) if (f.firstMove && !moveIds.has(f.firstMove)) errs.push(`形态 ${f.id} 的第一招 ${f.firstMove} 不存在`);
    for (let i = 1; i < this.tiers.length; i++) {
      if (!(this.tiers[i].difficulty > this.tiers[i - 1].difficulty)) errs.push('定档表没有按难度严格升序');
    }
    const v = this.vitalsAt(1);
    if (!(v.hp > 0) || !Number.isFinite(vitalsTotal(v))) errs.push(`难度 1 的耐久非法（${v.hp} / ${v.shield} / ${v.armor}）`);
    if (this.summonCap < 0) errs.push('召唤上限 < 0');
    return errs;
  }
}
