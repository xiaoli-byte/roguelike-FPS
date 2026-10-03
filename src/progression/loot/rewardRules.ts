import type { Rarity, StageType } from '../../core/types';
import { RARITY_NAMES } from '../../core/types';

/**
 * 宝箱「武器」奖励的保底稀有度（LootSystem.grant 与宝箱交互提示共用，保证提示与实际发放一致）：
 *  - 首领：第一章保底史诗（3），第二章起保底传说（4）。最终首领之后 4 秒即结算，宝箱实际用不上。
 *  - 精英：保底精良（1）。
 *  - 其他：不保底，按章节权重随机。
 */
export function weaponRewardMinRarity(stageType: StageType, chapter: number): Rarity | undefined {
  if (stageType === 'boss') return chapter >= 1 ? 4 : 3;
  if (stageType === 'elite') return 1;
  return undefined;
}

/** 宝箱提示里的武器奖励说明 */
export function weaponRewardHint(stageType: StageType, chapter: number): string {
  const min = weaponRewardMinRarity(stageType, chapter);
  if (min === undefined || min <= 0) return '一把随机武器';
  const name = RARITY_NAMES[min] ?? '';
  return min >= RARITY_NAMES.length - 1 ? `一把${name}品质的武器` : `一把${name}及以上品质的武器`;
}
