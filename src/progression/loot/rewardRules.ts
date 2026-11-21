import type { Rarity, RewardKey, RewardType, StageType } from '../../core/types';
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

// ───────────── 奖励串（Unity RewardRegistry / WeaponReward）─────────────

/** 奖励串的种类（第一段）：'weapon:min=3' → 'weapon' */
export function rewardKey(reward: RewardType): RewardKey {
  return reward.startsWith('weapon:') ? 'weapon' : reward as RewardKey;
}

/** 解析后的武器奖励（Unity WeaponReward.Spec）：id = 指定武器（null = 随机）；rarity = 固定品质（null = 按章节表掷）；minRarity = 保底 */
export interface WeaponRewardSpec {
  id: string | null;
  rarity: Rarity | null;
  minRarity: Rarity;
}

const clampRarity = (r: number): Rarity => Math.max(0, Math.min(RARITY_NAMES.length - 1, r)) as Rarity;
/** C# int.TryParse 的整数写法（前后空白、正负号） */
const INT = /^\s*[+-]?\d+\s*$/;

/**
 * 武器奖励串的参数（Unity WeaponReward.Parse）：
 *   'weapon'               不指定（品质按章节表 + 幸运掷）；
 *   'weapon:min=N'         保底品质 N（0–4，超出夹住）；
 *   'weapon:<id>'          指定武器、普通品质（关卡里写死的教学奖励，旧写法）；
 *   'weapon:<id>:N'        指定武器、固定品质 N；
 *   'weapon:<id>:min=N'    指定武器、按章节表掷品质且不低于 N。
 * 参数顺序随意，空段跳过，第一个不是数字 / min= 的段当武器 id，其余未知参数忽略
 */
export function parseWeaponReward(reward: string): WeaponRewardSpec {
  const args = reward.split(':');
  let id: string | null = null, rarity: Rarity | null = null, minRarity: Rarity = 0, hasMin = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i].trim();
    if (!a) continue;
    if (a.startsWith('min=') && INT.test(a.slice(4))) {
      minRarity = clampRarity(Number(a.slice(4)));
      hasMin = true;
    } else if (INT.test(a)) rarity = clampRarity(Number(a));
    else id ??= a;
  }
  // 旧写法 'weapon:<id>'：指定武器、普通品质
  if (id !== null && rarity === null && !hasMin) rarity = 0;
  return { id, rarity, minRarity };
}

/**
 * 奖励串 → WeaponSystem.roll 的参数（Unity EconomyConfig.ApplyTier + WeaponReward.Grant）：
 * 不带参数的 'weapon' 按关卡档位保底（首领 / 精英，weaponRewardMinRarity）；带参数的（关卡里写死的）原样，不再套档位保底
 */
export function weaponRewardRoll(reward: RewardType, stageType: StageType, chapter: number): { defId?: string; rarity?: Rarity; minRarity?: Rarity } {
  if (reward === 'weapon') {
    const min = weaponRewardMinRarity(stageType, chapter);
    return min !== undefined ? { minRarity: min } : {};
  }
  const spec = parseWeaponReward(reward);
  const out: { defId?: string; rarity?: Rarity; minRarity?: Rarity } = {};
  if (spec.id !== null) out.defId = spec.id;
  if (spec.rarity !== null) out.rarity = spec.rarity;
  if (spec.minRarity > 0) out.minRarity = spec.minRarity;
  return out;
}

/**
 * 宝箱提示（Unity WeaponReward.Hint）：不带参数的 'weapon' 同 {@link weaponRewardHint}（按关卡档位）；
 * 指定了武器显示名字（「精良 · 腐蚀炮」/「左轮（稀有及以上）」/ 普通品质只写名字），否则「一把随机武器」/「一把史诗及以上品质的武器」/「一把传说品质的武器」。
 * nameOf：武器 id → 名字（查不到返回 undefined，按没指定武器说）
 */
export function weaponRewardHintFor(reward: RewardType, stageType: StageType, chapter: number, nameOf?: (id: string) => string | undefined): string {
  if (reward === 'weapon') return weaponRewardHint(stageType, chapter);
  const spec = parseWeaponReward(reward);
  const name = spec.id !== null ? nameOf?.(spec.id) : undefined;
  if (name !== undefined) {
    if (spec.rarity !== null) return spec.rarity > 0 ? `${RARITY_NAMES[spec.rarity]} · ${name}` : name;
    return spec.minRarity > 0 ? `${name}（${RARITY_NAMES[spec.minRarity]}及以上）` : name;
  }
  const min = spec.rarity ?? spec.minRarity;
  if (min <= 0) return '一把随机武器';
  return min >= RARITY_NAMES.length - 1 || spec.rarity !== null ? `一把${RARITY_NAMES[min]}品质的武器` : `一把${RARITY_NAMES[min]}及以上品质的武器`;
}
