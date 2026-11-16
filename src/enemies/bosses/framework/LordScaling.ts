/**
 * 领主梯度（Unity LordScaling.cs；第四章 4-1 三领主，C4-6）：这张图里已经打败了几个领主 → 下一个是第几个（n），
 * 血 × (1 + 0.15 n)、收招 × (1 − 0.1 n)（下限 0.5）、n ≥ 2 每阶段多一招变体。打败的记录存在本局 run.flags（lord.<图>.<首领 id>）。
 * 旱魃不按梯度（lordLevel 为空 = 0 档，倍率都是 1）。纯逻辑。
 */

export const LORD_HP_STEP = 0.15;
export const LORD_RECOVERY_STEP = 0.1;
export const LORD_VARIANT_FROM = 2;
const PREFIX = 'lord.';

export class LordTier {
  readonly index: number;

  constructor(index: number) {
    this.index = Math.max(0, Math.floor(index));
  }

  get hpMult(): number {
    return 1 + LORD_HP_STEP * this.index;
  }

  get recoveryMult(): number {
    return Math.max(0.5, 1 - LORD_RECOVERY_STEP * this.index);
  }

  get extraVariant(): boolean {
    return this.index >= LORD_VARIANT_FROM;
  }
}

/** 某张图里已经打败的领主数 */
export function lordsDefeated(flags: Record<string, number> | null | undefined, levelId: string | null | undefined): number {
  if (!flags || !levelId) return 0;
  const p = `${PREFIX}${levelId}.`;
  let n = 0;
  for (const [k, v] of Object.entries(flags)) if (v > 0 && k.startsWith(p)) n++;
  return n;
}

/** 某个首领的梯度：lordLevel 为空时是 0 档 */
export function lordTierFor(flags: Record<string, number> | null | undefined, lordLevel: string | null | undefined): LordTier {
  return new LordTier(lordLevel ? lordsDefeated(flags, lordLevel) : 0);
}

/** 记一次打败（同一个领主只算一次） */
export function recordLordDefeat(flags: Record<string, number> | null | undefined, levelId: string | null | undefined, bossId: string): void {
  if (!flags || !levelId || !bossId) return;
  flags[`${PREFIX}${levelId}.${bossId}`] = 1;
}
