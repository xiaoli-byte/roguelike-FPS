import type { GameContext, IMeta, MetaSave, RunState, RunSummary, StatKey, TalentDef } from '../core/types';
import type { Stats } from '../core/Stats';
import { SaveService, intList, intMap, nonNeg, nonNegInt, stringList, type SaveFile, type SaveSection } from '../core/SaveService';
import { isWhiteboxMode } from '../world/WhiteboxMode';

/**
 * 局外成长（Unity G/Progression/Meta/MetaSave.cs + CareerStats.cs 照译）：魂晶、天赋、英雄解锁是存档文件里的「meta」段，
 * 生涯统计是「career」段；每个档（正式 / 调试）各一份，落盘、备份、迁移都在 core/SaveService.ts。
 *   · 正式档 spiritfire.save/profile.json；白盒检视页和调试局（?debugStage）只碰调试档 profile.dev.json，永远不碰正式档。
 *   · M11d 之前的老存档（localStorage gunflame.meta.v1 / gunflame.whitebox.meta.v1）第一次读时按信封 v1 迁过来，老键不动。
 *   · 一局结束 {@link MetaProgress.bankRun}：魂晶入账 + 记生涯 + 写盘，同一局只结算一次（run.flags 上记 {@link BANKED_FLAG}）。
 *   · 天赋按开局快照生效（run.talents）：暂离期间在主菜单买的天赋照常进元进度，继续征程仍按快照，下一局开局才生效。
 * {@link MetaProgress.save} 仍是界面读的那个形状（{essence, talents, unlockedHeroes, stats}），是当前档两段的活视图。
 */

/** 默认解锁的英雄（D8：三人全开） */
export const DEFAULT_HEROES: readonly string[] = ['fox', 'falcon', 'bear'];
/** 每级价格（魂晶），下标 = 当前等级 */
export const TALENT_COSTS: readonly number[] = [60, 120, 200, 300, 450];
const TALENT_MAX = TALENT_COSTS.length;
/** 天赋在属性表里的来源名 */
export const TALENT_SOURCE = 'talent';
/** 通关额外给的魂晶 */
export const VICTORY_ESSENCE_BONUS = 200;
/** run.flags 上的标记：这一局已经结算过（防止阵亡和放弃各结一次） */
export const BANKED_FLAG = 'meta.banked';

function talentCost(level: number): number {
  return TALENT_COSTS[Math.max(0, Math.min(TALENT_COSTS.length - 1, Math.floor(level)))];
}

function talent(id: string, name: string, stat: StatKey, perLevel: number, description: string): TalentDef {
  return { id, name, description, maxLevel: TALENT_MAX, stat, perLevel, cost: talentCost };
}

/** 局外天赋（10 项，每项 5 级） */
export const TALENTS: readonly TalentDef[] = [
  talent('vitality', '生命强化', 'maxHp', 8, '每级生命上限 +8'),
  talent('barrier', '护盾强化', 'maxShield', 6, '每级护盾上限 +6'),
  talent('mastery', '武器精通', 'damagePct', 0.04, '每级武器伤害 +4%'),
  talent('lethal', '致命', 'critChance', 0.02, '每级暴击率 +2%'),
  talent('swift', '迅捷', 'moveSpeed', 0.15, '每级移动速度 +0.15'),
  talent('reload', '装填', 'reloadSpeedPct', 0.05, '每级换弹速度 +5%'),
  talent('affinity', '元素亲和', 'elementChancePct', 0.03, '每级元素触发率 +3%'),
  talent('haste', '技能急速', 'skillHaste', 0.05, '每级技能急速 +5%'),
  talent('wealth', '财富', 'coinGainPct', 0.08, '每级灵石获取 +8%'),
  talent('fortune', '幸运', 'luck', 1, '每级幸运 +1（更容易出现高稀有度的武器与秘卷）'),
];

const talentDef = (id: string): TalentDef | undefined => TALENTS.find(t => t.id === id);

/** 一组天赋等级（快照）下的属性修正（按注册顺序；等级夹在 0..满级，0 级和不认识的 id 不出修正；Unity MetaSave.TalentMods） */
export function talentMods(levels: Readonly<Record<string, number>> | null | undefined): { key: StatKey; value: number }[] {
  const mods: { key: StatKey; value: number }[] = [];
  if (!levels) return mods;
  for (const t of TALENTS) {
    const raw = levels[t.id];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const lv = Math.max(0, Math.min(t.maxLevel, Math.floor(raw)));
    if (lv > 0) mods.push({ key: t.stat, value: t.perLevel * lv });
  }
  return mods;
}

/**
 * 把一组天赋修正写进属性表（来源 talent，先整体撤掉旧的再加）。和属性表里现有的完全一样时什么都不做，返回 false
 * （Unity MetaSave.ApplyMods：重复套用不让属性表的版本号变，生命 / 护盾上限不会被撤掉再加回）
 */
export function applyTalentMods(stats: Stats, want: readonly { key: StatKey; value: number }[]): boolean {
  const have = stats.modsFrom(TALENT_SOURCE);
  const same = have.length === want.length && have.every((m, i) => m.key === want[i].key && Math.abs(m.value - want[i].value) <= 1e-6);
  if (same) return false;
  stats.removeSource(TALENT_SOURCE);
  for (const m of want) stats.add(m.key, m.value, TALENT_SOURCE);
  return true;
}

/** 天赋全部升满的总价（10 项 × 1130 = 11300；Unity BalanceModel.TalentTotal） */
export function talentTotalCost(): number {
  let sum = 0;
  for (const t of TALENTS) for (let lv = 0; lv < t.maxLevel; lv++) sum += t.cost(lv);
  return sum;
}

// ───────────── meta 段 ─────────────

/** 存档的「meta」段：魂晶余额、天赋等级、已解锁英雄（Unity MetaSave 的存档部分） */
export class MetaSection implements SaveSection {
  static readonly SectionKey = 'meta';
  readonly key = MetaSection.SectionKey;
  readonly version = 1;

  essence = 0;
  /** 天赋 id → 等级（只记 > 0 的；不认识的 id 原样保留：新版本加的天赋，降级再升级不丢） */
  talents: Record<string, number> = {};
  unlockedHeroes: string[] = [...DEFAULT_HEROES];
  /** 所属文件（正式档 / 调试档） */
  file: SaveFile | null = null;

  bind(file: SaveFile): void {
    this.file = file;
  }

  /** 某项天赋的等级（夹在 0..满级；不认识的 id 为 0） */
  talentLevel(id: string): number {
    const def = talentDef(id);
    return def ? Math.max(0, Math.min(def.maxLevel, this.talents[id] ?? 0)) : 0;
  }

  /** 当前全部天赋等级的快照（id → 等级，只记 > 0 的，按注册顺序）：开局锁定天赋用（run.talents） */
  talentSnapshot(): Record<string, number> {
    const snap: Record<string, number> = {};
    for (const t of TALENTS) {
      const lv = this.talentLevel(t.id);
      if (lv > 0) snap[t.id] = lv;
    }
    return snap;
  }

  /** 加魂晶（结算、调试）：只改内存，由调用方写盘 */
  addEssence(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.essence = Math.min(2147483647, this.essence + Math.round(amount));
  }

  spend(price: number): boolean {
    if (price < 0 || this.essence < price) return false;
    this.essence -= price;
    return true;
  }

  capture(): unknown {
    const talents: Record<string, number> = {};
    for (const [id, lv] of Object.entries(this.talents)) if (lv > 0) talents[id] = lv;
    return { essence: this.essence, talents, unlockedHeroes: [...this.unlockedHeroes] };
  }

  /**
   * v1：{ essence, talents: { id: 等级 }, unlockedHeroes: [id…] }（与 M11d 之前的网页存档同名，迁移直接搬过来）。
   * 宽容读取：坏字段当 0 / 空；默认英雄总在表里；不认识的天赋 id 原样保留。
   */
  restore(data: unknown): void {
    this.essence = 0;
    this.talents = {};
    this.unlockedHeroes = [...DEFAULT_HEROES];
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    const o = data as Record<string, unknown>;
    this.essence = nonNegInt(o.essence);
    for (const [id, lv] of Object.entries(intMap(o.talents))) {
      const def = talentDef(id);
      this.talents[id] = def ? Math.min(def.maxLevel, lv) : lv;
    }
    for (const h of stringList(o.unlockedHeroes)) if (!this.unlockedHeroes.includes(h)) this.unlockedHeroes.push(h);
  }
}

// ───────────── career 段 ─────────────

/**
 * 存档的「career」段：生涯统计。前五项和 M11d 之前的网页存档同名同义（局数、胜场、最远章节（1 起，0 = 没开过局）、单局最多清关、总击杀）；
 * 照 Unity 多记：阵亡（含放弃）与各章阵亡数、最快通关、单局最多击杀、总用时、总伤害、累计魂晶、各英雄的局数 / 胜场。
 */
export class CareerSection implements SaveSection {
  static readonly SectionKey = 'career';
  readonly key = CareerSection.SectionKey;
  readonly version = 1;

  runs = 0;
  wins = 0;
  /** 到达过的最远章节（1 起；0 = 从没开过局） */
  bestChapter = 0;
  /** 单局最多清关数 */
  bestStages = 0;
  totalKills = 0;
  /** 没通关就结束的局（阵亡、放弃） */
  deaths = 0;
  /** 单局最多击杀 */
  mostKills = 0;
  /** 最快通关用时（秒；0 = 还没通关过） */
  fastestWin = 0;
  /** 累计游玩时间（秒）、累计伤害、累计获得的魂晶（含已经花掉的） */
  totalTime = 0;
  totalDamage = 0;
  totalEssence = 0;
  /** 各章阵亡数（下标 = 章 − 1） */
  deathsByChapter: number[] = [];
  heroRuns: Record<string, number> = {};
  heroWins: Record<string, number> = {};

  deathsInChapter(chapter: number): number {
    return chapter >= 1 && chapter <= this.deathsByChapter.length ? this.deathsByChapter[chapter - 1] : 0;
  }

  runsAs(heroId: string): number {
    return this.heroRuns[heroId] ?? 0;
  }

  winsAs(heroId: string): number {
    return this.heroWins[heroId] ?? 0;
  }

  get winRate(): number {
    return this.runs > 0 ? this.wins / this.runs : 0;
  }

  /** 记一局（chapter 从 1 起，同 Unity RunSummary）。只改内存，由 bankRun 统一写盘 */
  record(s: { victory: boolean; heroId?: string; chapter: number; stagesCleared: number; kills: number; time: number; damageDealt: number; essenceEarned: number }): void {
    this.runs++;
    const kills = Math.max(0, Math.floor(s.kills) || 0);
    if (s.victory) {
      this.wins++;
      if (s.time > 0 && (this.fastestWin <= 0 || s.time < this.fastestWin)) this.fastestWin = s.time;
      if (s.heroId) this.heroWins[s.heroId] = this.winsAs(s.heroId) + 1;
    } else {
      this.deaths++;
      if (s.chapter >= 1) {
        while (this.deathsByChapter.length < s.chapter) this.deathsByChapter.push(0);
        this.deathsByChapter[s.chapter - 1]++;
      }
    }
    if (s.heroId) this.heroRuns[s.heroId] = this.runsAs(s.heroId) + 1;
    this.bestChapter = Math.max(this.bestChapter, s.chapter);
    this.bestStages = Math.max(this.bestStages, s.stagesCleared);
    this.totalKills += kills;
    this.mostKills = Math.max(this.mostKills, kills);
    this.totalTime += Math.max(0, s.time || 0);
    this.totalDamage += Math.max(0, s.damageDealt || 0);
    this.totalEssence += Math.max(0, s.essenceEarned || 0);
  }

  capture(): unknown {
    return {
      runs: this.runs, wins: this.wins, bestChapter: this.bestChapter, bestStages: this.bestStages, totalKills: this.totalKills,
      deaths: this.deaths, deathsByChapter: [...this.deathsByChapter], mostKills: this.mostKills, fastestWin: this.fastestWin,
      totalTime: this.totalTime, totalDamage: this.totalDamage, totalEssence: this.totalEssence,
      heroRuns: { ...this.heroRuns }, heroWins: { ...this.heroWins },
    };
  }

  /**
   * v1 = 老网页存档 stats 的超集（老存档迁过来只有前五项，其余为 0）。宽容读取：坏字段当 0。
   * 老存档没有「阵亡」：迁过来时按 局数 − 胜场 补上（各章阵亡数无从得知，留空）。
   */
  restore(data: unknown): void {
    this.runs = this.wins = this.bestChapter = this.bestStages = this.totalKills = this.deaths = this.mostKills = 0;
    this.fastestWin = this.totalTime = this.totalDamage = this.totalEssence = 0;
    this.deathsByChapter = [];
    this.heroRuns = {};
    this.heroWins = {};
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    const o = data as Record<string, unknown>;
    this.runs = nonNegInt(o.runs);
    this.wins = Math.min(this.runs, nonNegInt(o.wins));
    this.bestChapter = nonNegInt(o.bestChapter);
    this.bestStages = nonNegInt(o.bestStages);
    this.totalKills = nonNegInt(o.totalKills);
    this.deaths = o.deaths !== undefined && o.deaths !== null ? nonNegInt(o.deaths) : this.runs - this.wins;
    this.deathsByChapter = intList(o.deathsByChapter);
    this.mostKills = nonNegInt(o.mostKills);
    this.fastestWin = nonNeg(o.fastestWin);
    this.totalTime = nonNeg(o.totalTime);
    this.totalDamage = nonNeg(o.totalDamage);
    this.totalEssence = Math.floor(nonNeg(o.totalEssence));
    this.heroRuns = intMap(o.heroRuns);
    this.heroWins = intMap(o.heroWins);
  }
}

// ───────────── 结算 ─────────────

/**
 * 从局状态出一份结算（Unity RunSummary.From）：魂晶 = 局内收集 + 胜利奖励 200。
 * 秘卷 / 武器只有 id（续玩档里放弃的局没有运行时对象）；当前局由 Game.endRun 换成带名字和稀有度的。
 */
export function runSummaryFrom(run: RunState, victory: boolean): RunSummary {
  return {
    victory,
    heroId: run.heroId,
    chapter: run.chapter,
    stageIndex: run.stageIndex,
    stagesCleared: run.stagesCleared,
    kills: run.kills,
    damageDealt: Math.round(run.damageDealt),
    time: run.time,
    coins: run.coins,
    essenceEarned: Math.max(0, Math.round(run.essence)) + (victory ? VICTORY_ESSENCE_BONUS : 0),
    scrolls: Object.entries(run.scrolls ?? {}).filter(([, n]) => n > 0).map(([id, stacks]) => ({ id, name: id, rarity: 0, stacks })),
    weapons: (run.weapons ?? []).filter(w => !!w.id).map(w => w.id),
  };
}

/** 一局结束之后（结算写盘之后）要做的事：续玩档在这里删（progression/RunSuspend.ts 挂上） */
type RunEndedHook = (run: RunState, summary: RunSummary) => void;
const runEndedHooks: RunEndedHook[] = [];

export function onRunBanked(hook: RunEndedHook): () => void {
  runEndedHooks.push(hook);
  return () => {
    const i = runEndedHooks.indexOf(hook);
    if (i >= 0) runEndedHooks.splice(i, 1);
  };
}

/**
 * 一局结束（阵亡 / 放弃 = false，最终首领倒下 = true）：魂晶入账（局内收集 + 胜利奖励）→ 记生涯 → 写盘。
 * 调试局记进调试档，永远不碰正式档。同一局只结算一次：已经结算过返回 null。summary 缺省按 {@link runSummaryFrom} 出。
 */
export function bankRun(run: RunState | null | undefined, victory: boolean, summary?: RunSummary): RunSummary | null {
  if (!run || (run.flags?.[BANKED_FLAG] ?? 0) !== 0) return null;
  run.flags ??= {};
  run.flags[BANKED_FLAG] = 1;
  const s = summary ?? runSummaryFrom(run, victory);
  const file = SaveService.profileFor(run);
  file.section(MetaSection).addEssence(s.essenceEarned);
  file.section(CareerSection).record({ ...s, chapter: s.chapter + 1 });
  file.save();
  for (const hook of [...runEndedHooks]) {
    try {
      hook(run, s);
    } catch (err) {
      console.error(err);
    }
  }
  return s;
}

// ───────────── IMeta ─────────────

export class MetaProgress implements IMeta {
  readonly talents: readonly TalentDef[] = TALENTS;
  private view: { meta: MetaSection; career: CareerSection; save: MetaSave } | null = null;

  constructor(readonly ctx: GameContext) {
    // 白盒检视页 = Unity 的 -devprofile；调试局（run.dev）= 调试档
    SaveService.devSource = isWhiteboxMode;
    SaveService.currentRun = () => this.ctx?.run ?? null;
  }

  /** 当前档的 meta 段（当前局是调试局 / 白盒 → 调试档） */
  get meta(): MetaSection {
    return SaveService.profile.section(MetaSection);
  }

  /** 当前档的 career 段 */
  get career(): CareerSection {
    return SaveService.profile.section(CareerSection);
  }

  /** 界面读的存档形状：当前档两段的活视图（换档 / 换存储后自动跟过去） */
  get save(): MetaSave {
    const meta = this.meta, career = this.career;
    if (this.view && this.view.meta === meta && this.view.career === career) return this.view.save;
    const save = {
      version: 1 as const,
      get essence() { return meta.essence; },
      set essence(v: number) { meta.essence = nonNegInt(v); },
      get talents() { return meta.talents; },
      get unlockedHeroes() { return meta.unlockedHeroes; },
      stats: {
        get runs() { return career.runs; },
        get wins() { return career.wins; },
        get bestChapter() { return career.bestChapter; },
        get bestStages() { return career.bestStages; },
        get totalKills() { return career.totalKills; },
      },
    } as unknown as MetaSave;
    this.view = { meta, career, save };
    return save;
  }

  talentLevel(id: string): number {
    return this.meta.talentLevel(id);
  }

  /** 下一级价格；已满级或不存在返回 null（UI 可选用） */
  nextTalentCost(id: string): number | null {
    const def = talentDef(id);
    if (!def) return null;
    const lv = this.talentLevel(id);
    return lv >= def.maxLevel ? null : def.cost(lv);
  }

  buyTalent(id: string): boolean {
    const def = talentDef(id);
    if (!def) return false;
    const meta = this.meta, lv = meta.talentLevel(id);
    if (lv >= def.maxLevel) return false;
    if (!meta.spend(def.cost(lv))) return false;
    meta.talents[id] = lv + 1;
    this.persist();
    return true;
  }

  isHeroUnlocked(id: string): boolean {
    return this.meta.unlockedHeroes.includes(id);
  }

  unlockHero(id: string, cost: number): boolean {
    if (this.isHeroUnlocked(id)) return true;
    const meta = this.meta;
    if (!meta.spend(Math.max(0, Math.round(cost)))) return false;
    meta.unlockedHeroes.push(id);
    this.persist();
    return true;
  }

  addEssence(n: number): void {
    this.meta.addEssence(n);
  }

  /** 开局锁定天赋用的快照（Unity TalentHooks.Lock） */
  talentSnapshot(): Record<string, number> {
    return this.meta.talentSnapshot();
  }

  /**
   * 把天赋写进属性表（来源 talent，先整体撤掉旧的再加）。这一局有开局快照（run.talents）时按快照，
   * 没有（测试拼的局、老续玩档）按档里当前的天赋；等级夹在 0..满级，不认识的 id 不算。
   * 和属性表里现有的完全一样时什么都不做、返回 false（Unity MetaSave.ApplyMods：重复套用不动属性表）。
   */
  applyTalents(stats: Stats): boolean {
    const snapshot = this.ctx?.run?.talents;
    return applyTalentMods(stats, talentMods(snapshot ?? this.meta.talentSnapshot()));
  }

  /**
   * 记录一局（summary.chapter 从 0 起，记成从 1 起的最远章节）。bestStages 为单局最多清关数。
   * 只改内存；正常结算走 {@link bankRun}（入账 + 记录 + 写盘，同一局只结一次）。
   */
  recordRun(summary: RunSummary): void {
    this.career.record({ ...summary, chapter: summary.chapter + 1 });
  }

  /** 一局结束的结算（见模块的 {@link bankRun}）；已经结算过返回 null */
  bankRun(run: RunState, victory: boolean, summary?: RunSummary): RunSummary | null {
    return bankRun(run, victory, summary);
  }

  persist(): void {
    SaveService.profile.save();
  }
}
