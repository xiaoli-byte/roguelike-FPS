import type { GameContext, IRunPlan, RewardType, RunState, StageNode, StageType, ThemeId } from '../core/types';
import { CHAPTER_COUNT, STAGES_PER_CHAPTER } from '../core/types';
import { getStageDesign } from '../world/StageDesign';
import { usesAuthoredLayout, usesRedesignLayout } from '../world/WhiteboxMode';
import { getWhiteboxPlan } from '../world/WhiteboxGen';

/**
 * 一局的关卡规划（DESIGN.md 第 3 节）：
 *  - 每章四个普通关依序推进，清关后只有一个主线出口；随后迎战首领。
 *  - 可选挑战与物资留在关内探索支路，商店位于首领前的安全补给区。
 *  - 普通关清场提供秘卷成长；出口不预告下一关奖励。
 *  - Boss 关奖励武器（高稀有度），清关后通往下一章第 0 关；最终 Boss 之后没有出口。
 *
 * 主线顺序固定，同一关多次调用 nextOptions 结果一致。
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
    return [this.node(cur.chapter, next, 'combat', 'scroll')];
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
    return `${node.chapter + 1}-${node.index + 1} · ${usesAuthoredLayout() ? getWhiteboxPlan(node, usesRedesignLayout(node.theme)).title : getStageDesign(node).title} · ${STAGE_TYPE_NAMES[node.type] ?? node.type}`;
  }

  rewardLabel(reward: RewardType): string {
    return REWARD_NAMES[reward] ?? '无';
  }

  // ───────────── 内部 ─────────────

  private node(chapter: number, index: number, type: StageType, reward: RewardType): StageNode {
    return { chapter, index, type, reward, theme: this.themeFor(chapter) };
  }

}
