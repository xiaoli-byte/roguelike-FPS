import type { GameContext, IMeta, MetaSave, RunSummary, StatKey, TalentDef } from '../core/types';
import type { Stats } from '../core/Stats';
import { isWhiteboxMode } from '../world/WhiteboxMode';

/**
 * 局外成长：魂晶、天赋、英雄解锁与生涯统计，存 localStorage。
 * 读写全部 try/catch；存档损坏或版本不符时回退为默认存档。
 */

// Whitebox debug controls and boss testing must never award progress to a real save.
const STORAGE_KEY = isWhiteboxMode() ? 'gunflame.whitebox.meta.v1' : 'gunflame.meta.v1';
/** 默认解锁的英雄 */
const DEFAULT_HEROES: readonly string[] = ['fox', 'falcon', 'bear'];
/** 每级价格（魂晶），下标 = 当前等级 */
const TALENT_COSTS: readonly number[] = [60, 120, 200, 300, 450];
const TALENT_MAX = TALENT_COSTS.length;
const TALENT_SOURCE = 'talent';

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
  talent('wealth', '财富', 'coinGainPct', 0.08, '每级金币获取 +8%'),
  talent('fortune', '幸运', 'luck', 1, '每级幸运 +1（更容易出现高稀有度的武器与秘卷）'),
];

function defaultSave(): MetaSave {
  return {
    version: 1,
    essence: 0,
    talents: {},
    unlockedHeroes: [...DEFAULT_HEROES],
    stats: { runs: 0, wins: 0, bestChapter: 0, bestStages: 0, totalKills: 0 },
  };
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** 把任意 JSON 数据规整为合法存档；结构不符返回 null */
function sanitize(raw: unknown): MetaSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const save = defaultSave();
  save.essence = nonNegInt(r.essence);

  const talents = r.talents;
  if (talents && typeof talents === 'object') {
    for (const t of TALENTS) {
      const lv = nonNegInt((talents as Record<string, unknown>)[t.id]);
      if (lv > 0) save.talents[t.id] = Math.min(t.maxLevel, lv);
    }
  }

  if (Array.isArray(r.unlockedHeroes)) {
    for (const h of r.unlockedHeroes) {
      if (typeof h === 'string' && h.length > 0 && !save.unlockedHeroes.includes(h)) save.unlockedHeroes.push(h);
    }
  }

  const st = r.stats;
  if (st && typeof st === 'object') {
    const s = st as Record<string, unknown>;
    save.stats.runs = nonNegInt(s.runs);
    save.stats.wins = nonNegInt(s.wins);
    save.stats.bestChapter = nonNegInt(s.bestChapter);
    save.stats.bestStages = nonNegInt(s.bestStages);
    save.stats.totalKills = nonNegInt(s.totalKills);
  }
  return save;
}

function loadSave(): MetaSave {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSave();
    const parsed = sanitize(JSON.parse(raw));
    if (parsed) return parsed;
    console.warn('[Meta] 存档格式无效，已回退为默认存档');
  } catch (err) {
    console.warn('[Meta] 读取存档失败，已回退为默认存档', err);
  }
  return defaultSave();
}

export class MetaProgress implements IMeta {
  readonly save: MetaSave;
  readonly talents: readonly TalentDef[] = TALENTS;

  constructor(readonly ctx: GameContext) {
    this.save = loadSave();
  }

  talentLevel(id: string): number {
    return this.save.talents[id] ?? 0;
  }

  /** 下一级价格；已满级或不存在返回 null（UI 可选用） */
  nextTalentCost(id: string): number | null {
    const def = this.talents.find((t) => t.id === id);
    if (!def) return null;
    const lv = this.talentLevel(id);
    return lv >= def.maxLevel ? null : def.cost(lv);
  }

  buyTalent(id: string): boolean {
    const def = this.talents.find((t) => t.id === id);
    if (!def) return false;
    const lv = this.talentLevel(id);
    if (lv >= def.maxLevel) return false;
    const cost = def.cost(lv);
    if (this.save.essence < cost) return false;
    this.save.essence -= cost;
    this.save.talents[id] = lv + 1;
    this.persist();
    return true;
  }

  isHeroUnlocked(id: string): boolean {
    return this.save.unlockedHeroes.includes(id);
  }

  unlockHero(id: string, cost: number): boolean {
    if (this.isHeroUnlocked(id)) return true;
    const price = Math.max(0, Math.round(cost));
    if (this.save.essence < price) return false;
    this.save.essence -= price;
    this.save.unlockedHeroes.push(id);
    this.persist();
    return true;
  }

  addEssence(n: number): void {
    if (!Number.isFinite(n) || n <= 0) return;
    this.save.essence += Math.round(n);
  }

  applyTalents(stats: Stats): void {
    stats.removeSource(TALENT_SOURCE);
    for (const t of this.talents) {
      const lv = this.talentLevel(t.id);
      if (lv > 0) stats.add(t.stat, t.perLevel * lv, TALENT_SOURCE);
    }
  }

  /**
   * 记录一局。bestChapter 为到达过的最高章节（1 起计，0 = 从未开局），
   * bestStages 为单局最多清关数。
   */
  recordRun(summary: RunSummary): void {
    const st = this.save.stats;
    st.runs++;
    if (summary.victory) st.wins++;
    st.bestChapter = Math.max(st.bestChapter, summary.chapter + 1);
    st.bestStages = Math.max(st.bestStages, summary.stagesCleared);
    st.totalKills += Math.max(0, Math.floor(summary.kills));
  }

  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.save));
    } catch (err) {
      console.warn('[Meta] 保存存档失败', err);
    }
  }
}
