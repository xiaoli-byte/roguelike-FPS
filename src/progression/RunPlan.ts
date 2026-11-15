import type { GameContext, IRunPlan, RewardType, RunState, StageNode, StageType, ThemeId } from '../core/types';
import { UNITY_FINAL_STAGE, UNITY_STAGES, type UnityStage } from '../world/UnityStages';

const THEMES: readonly ThemeId[] = ['desert', 'frost', 'inferno'];
const CHAPTER_DIFFICULTY_SLOPE = 0.8;
const STAGE_DIFFICULTY_SLOPE = 0.16;

const STAGE_TYPE_NAMES: Record<StageType, string> = {
  combat: '战斗', elite: '精英战', treasure: '宝藏', shop: '商店', boss: '首领战',
};
const REWARD_NAMES: Record<RewardType, string> = {
  scroll: '秘卷', weapon: '武器', coins: '金币', heal: '治疗', upgrade: '强化', none: '无',
};

function fromUnity(stage: UnityStage): StageNode {
  return { chapter: stage.chapter, index: stage.index, type: stage.type, reward: stage.reward, theme: THEMES[Math.max(0, Math.min(THEMES.length - 1, stage.chapter))] };
}

export class RunPlanner implements IRunPlan {
  constructor(readonly ctx: GameContext) {}

  createRun(heroId: string, seed: number): RunState {
    const stage = fromUnity(UNITY_STAGES[0]);
    const run: RunState = {
      heroId, seed: seed >>> 0, chapter: stage.chapter, stageIndex: stage.index, stage,
      coins: 0, kills: 0, damageDealt: 0, time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {},
    };
    run.difficulty = this.difficultyFor(run.stage);
    return run;
  }

  firstStage(_run: RunState): StageNode {
    const requested = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('debugStage');
    const stage = requested ? UNITY_STAGES.find(candidate => candidate.available && `${candidate.chapter + 1}-${candidate.index + 1}` === requested) : undefined;
    return fromUnity(stage ?? UNITY_STAGES[0]);
  }

  nextOptions(run: RunState): StageNode[] {
    const available = UNITY_STAGES.filter(stage => stage.available);
    const current = available.findIndex(stage => stage.chapter === run.stage.chapter && stage.index === run.stage.index);
    const next = current >= 0 ? available[current + 1] : undefined;
    return next ? [fromUnity(next)] : [];
  }

  isFinalStage(node: StageNode): boolean {
    return node.chapter === UNITY_FINAL_STAGE.chapter && node.index === UNITY_FINAL_STAGE.index;
  }

  difficultyFor(node: StageNode): number {
    return 1 + node.chapter * CHAPTER_DIFFICULTY_SLOPE + node.index * STAGE_DIFFICULTY_SLOPE;
  }

  themeFor(chapter: number): ThemeId {
    return THEMES[Math.max(0, Math.min(THEMES.length - 1, chapter))];
  }

  stageLabel(node: StageNode): string {
    const stage = UNITY_STAGES.find(candidate => candidate.chapter === node.chapter && candidate.index === node.index);
    return `${node.chapter + 1}-${node.index + 1} · ${stage?.title ?? '未知关卡'} · ${STAGE_TYPE_NAMES[node.type] ?? node.type}`;
  }

  rewardLabel(reward: RewardType): string {
    return REWARD_NAMES[reward] ?? '无';
  }
}
