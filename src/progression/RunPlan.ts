import type { GameContext, IRunPlan, RewardType, RunState, StageNode, StageType, ThemeId } from '../core/types';
import { CHAPTER_COUNT, STAGES_PER_CHAPTER } from '../core/types';
import { Rng } from '../core/Rng';
import { getStageDesign } from '../world/StageDesign';
import { usesAuthoredLayout } from '../world/WhiteboxMode';
import { getWhiteboxPlan } from '../world/WhiteboxGen';

/**
 * 一局的关卡规划（DESIGN.md 第 3 节）：
 *  - 每章第 0 关固定「战斗 · 秘卷」；第 1–3 关为 2–3 个分支出口；第 3 关后只有通往 Boss 的门。
 *  - 每章必有一次商店选项（第 2 或第 3 关），宝藏每章最多出现一次。
 *  - 两个及以上的战斗类出口同时包含普通战斗与精英战（稳妥 / 高风险高回报），奖励尽量互不相同。
 *  - Boss 关奖励武器（高稀有度），清关后通往下一章第 0 关；最终 Boss 之后没有出口。
 *
 * 所有随机都由 (种子, 章节, 关卡) 派生，同一关多次调用 nextOptions 结果一致。
 */

const THEMES: readonly ThemeId[] = ['desert', 'frost', 'inferno'];
const BOSS_INDEX = STAGES_PER_CHAPTER - 1;
/** 难度倍率的章节斜率（0.9 → 0.8：缓和第二、三章交界的难度断崖） */
const CHAPTER_DIFFICULTY_SLOPE = 0.8;
/** 难度倍率的关卡斜率 */
const STAGE_DIFFICULTY_SLOPE = 0.12;

const STAGE_TYPE_NAMES: Record<StageType, string> = {
  combat: '战斗',
  elite: '精英战',
  treasure: '宝藏',
  shop: '商店',
  boss: '首领战',
};

const REWARD_NAMES: Record<RewardType, string> = {
  scroll: '秘卷',
  weapon: '武器',
  coins: '金币',
  heal: '治疗',
  upgrade: '强化',
  none: '无',
};

type Weighted = readonly (readonly [RewardType, number])[];

/** 各关卡类型的奖励权重 */
const REWARD_WEIGHTS: Record<'combat' | 'elite' | 'treasure', Weighted> = {
  combat: [['scroll', 4], ['weapon', 2.6], ['coins', 2], ['heal', 1.3], ['upgrade', 1.5]],
  elite: [['scroll', 4], ['weapon', 3.6], ['upgrade', 2], ['heal', 0.8]],
  treasure: [['scroll', 3], ['weapon', 3], ['coins', 2], ['upgrade', 1.5], ['heal', 1]],
};

/** DESIGN 约定的派生种子 */
function rngFor(seed: number, chapter: number, index: number): Rng {
  return new Rng(seed ^ (chapter * 7919 + index * 104729 + 911));
}

interface ChapterPlan {
  /** 必定出现商店选项的关卡序号（2 或 3） */
  shopAt: number;
  /** 出现宝藏选项的关卡序号（1..3），-1 = 本章没有 */
  treasureAt: number;
}

export class RunPlanner implements IRunPlan {
  constructor(readonly ctx: GameContext) {}

  createRun(heroId: string, seed: number): RunState {
    const run: RunState = {
      heroId,
      seed: seed >>> 0,
      chapter: 0,
      stageIndex: 0,
      stage: this.node(0, 0, 'combat', 'scroll'),
      coins: 0,
      kills: 0,
      damageDealt: 0,
      time: 0,
      stagesCleared: 0,
      essence: 0,
      difficulty: 1,
      flags: {},
    };
    run.difficulty = this.difficultyFor(run.stage);
    return run;
  }

  firstStage(_run: RunState): StageNode {
    return this.node(0, 0, 'combat', 'scroll');
  }

  nextOptions(run: RunState): StageNode[] {
    const cur = run.stage;
    if (cur.index >= BOSS_INDEX) {
      if (cur.chapter >= CHAPTER_COUNT - 1) return [];
      return [this.node(cur.chapter + 1, 0, 'combat', 'scroll')];
    }
    const next = cur.index + 1;
    if (next >= BOSS_INDEX) return [this.node(cur.chapter, BOSS_INDEX, 'boss', 'weapon')];
    return this.branchOptions(run.seed, cur.chapter, cur.index, next);
  }

  isFinalStage(node: StageNode): boolean {
    return node.chapter >= CHAPTER_COUNT - 1 && node.index >= BOSS_INDEX;
  }

  /**
   * DESIGN 第 3 节：1 + 章节 × 0.8 + 关卡 × 0.12。
   * 第 0–3 关：第一章 1.00–1.36，第二章 1.80–2.16，第三章 2.60–2.96；首领关（第 4 关）再 +0.12（1.48 / 2.28 / 3.08）。
   */
  difficultyFor(node: StageNode): number {
    return 1 + node.chapter * CHAPTER_DIFFICULTY_SLOPE + node.index * STAGE_DIFFICULTY_SLOPE;
  }

  themeFor(chapter: number): ThemeId {
    return THEMES[Math.max(0, Math.min(THEMES.length - 1, chapter))];
  }

  stageLabel(node: StageNode): string {
    return `${node.chapter + 1}-${node.index + 1} · ${usesAuthoredLayout() ? getWhiteboxPlan(node).title : getStageDesign(node).title} · ${STAGE_TYPE_NAMES[node.type] ?? node.type}`;
  }

  rewardLabel(reward: RewardType): string {
    return REWARD_NAMES[reward] ?? '无';
  }

  // ───────────── 内部 ─────────────

  private node(chapter: number, index: number, type: StageType, reward: RewardType): StageNode {
    return { chapter, index, type, reward, theme: this.themeFor(chapter) };
  }

  /** 章节级决定：商店在哪一关、宝藏在哪一关（index 取一个不会与关卡冲突的值） */
  private chapterPlan(seed: number, chapter: number): ChapterPlan {
    const r = rngFor(seed, chapter, STAGES_PER_CHAPTER);
    const shopAt = r.chance(0.5) ? 2 : 3;
    const treasureAt = r.chance(0.8) ? r.int(1, BOSS_INDEX - 1) : -1;
    return { shopAt, treasureAt };
  }

  private branchOptions(seed: number, chapter: number, fromIndex: number, next: number): StageNode[] {
    const plan = this.chapterPlan(seed, chapter);
    const r = rngFor(seed, chapter, fromIndex);
    const out: StageNode[] = [];

    if (next === plan.shopAt) out.push(this.node(chapter, next, 'shop', 'none'));
    if (next === plan.treasureAt) out.push(this.node(chapter, next, 'treasure', this.pickReward(r, 'treasure')));

    const target = out.length >= 2 ? 3 : r.int(2, 3);
    // 精英关概率随章节与关卡推进上升
    const eliteChance = Math.min(0.6, 0.3 + chapter * 0.12 + (next >= 2 ? 0.08 : 0));
    for (let attempt = 0; out.length < target && attempt < 40; attempt++) {
      const type: 'combat' | 'elite' = r.chance(eliteChance) ? 'elite' : 'combat';
      const reward = this.pickReward(r, type);
      if (out.some((o) => o.type === type && o.reward === reward)) continue;
      // 前若干次尽量让战斗类出口的奖励互不相同，给玩家真正的选择
      if (attempt < 16 && out.some((o) => o.reward === reward)) continue;
      out.push(this.node(chapter, next, type, reward));
    }
    this.mixFightTypes(out);
    return r.shuffle(out);
  }

  /**
   * 两个及以上的战斗类出口若全是同一种（全普通 / 全精英），把其中一个换成另一种，
   * 保证总有「稳妥」与「高风险高回报」两条路可选。精英关没有「金币」奖励，换成精英时跳过金币门。
   */
  private mixFightTypes(out: StageNode[]): void {
    const fights = out.filter((o) => o.type === 'combat' || o.type === 'elite');
    if (fights.length < 2 || fights.some((o) => o.type !== fights[0].type)) return;
    const to: StageType = fights[0].type === 'elite' ? 'combat' : 'elite';
    for (let i = fights.length - 1; i >= 0; i--) {
      const f = fights[i];
      if (to === 'elite' && !REWARD_WEIGHTS.elite.some(([rw]) => rw === f.reward)) continue;
      f.type = to;
      return;
    }
  }

  private pickReward(r: Rng, type: 'combat' | 'elite' | 'treasure'): RewardType {
    return r.weighted(REWARD_WEIGHTS[type], (e) => e[1])[0];
  }
}
