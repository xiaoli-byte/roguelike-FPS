import { ROAMING_ESSENCE_PER_STAGE, roamingCoinCap } from './Economy';

/**
 * 一只敌人的击杀奖励倍率（Unity RewardScale.cs 一比一；docs/balance.md 第十二节「怪要多之后的经济」）：战斗导演给两类怪挂——
 *   · 据点加量后的怪：整个据点的灵石 / 魂晶总量不变，平摊到加量后的每一只（coins = essence = 原只数 ÷ 加量后只数）；
 *     驻守点（路遇）再 × Economy.ROADSIDE_REWARD_MULT；
 *   · 游荡怪（roaming）：倍率 1，但每关游荡怪的灵石 / 魂晶有上限（{@link claimRoamingCoins}）。
 * Loot 掉灵石、Combat 结魂晶时读它；小数按概率取整，期望不变。
 * Unity 是挂在敌人身上的组件；网页按敌人对象记在 WeakMap 里（敌人移除后自动回收）。
 * 游荡怪的每关额度在 Unity 是 CombatDirector 的静态量，这里放在一起，免得 Loot / Combat 依赖世界层。
 */
export interface RewardScale {
  /** 灵石倍率 */
  coins: number;
  /** 魂晶倍率 */
  essence: number;
  /** 游荡怪（每关有上限） */
  roaming: boolean;
}

const scales = new WeakMap<object, RewardScale>();

/** 这只敌人的倍率（没挂为 null） */
export function rewardScaleOf(enemy: object | null | undefined): RewardScale | null {
  return enemy ? scales.get(enemy) ?? null : null;
}

/** 挂上 / 改写倍率（roaming 只会从假变真） */
export function applyRewardScale(enemy: object | null | undefined, coins: number, essence: number, roaming = false): RewardScale | null {
  if (!enemy) return null;
  let r = scales.get(enemy);
  if (!r) scales.set(enemy, r = { coins: 1, essence: 1, roaming: false });
  r.coins = Math.max(0, coins);
  r.essence = Math.max(0, essence);
  r.roaming ||= roaming;
  return r;
}

type Roll = { nextDouble(): number } | { next(): number };

function roll(rng: Roll | null | undefined): number {
  if (!rng) return Math.random();
  return 'nextDouble' in rng ? rng.nextDouble() : rng.next();
}

/** amount × mult，小数部分按概率进位（0.4 只 → 40% 给 1），期望 = amount × mult */
export function scaleReward(amount: number, mult: number, rng?: Roll | null): number {
  if (amount <= 0 || mult <= 0) return 0;
  if (Math.abs(mult - 1) < 1e-6) return amount;
  const v = Math.fround(amount * Math.fround(mult));
  const whole = Math.floor(v);
  const frac = Math.fround(v - whole);
  return whole + (roll(rng) < frac ? 1 : 0);
}

// ───────────── 游荡怪的奖励上限（Unity CombatDirector 的静态额度）─────────────

let roamingCoins = 0, roamingEssence = 0;

/** 这一关游荡怪已经给出去的灵石 / 魂晶 */
export function roamingCoinsGiven(): number { return roamingCoins; }
export function roamingEssenceGiven(): number { return roamingEssence; }

/** 新的一关：游荡怪奖励额度清零（战斗导演进关时调；测试手动调） */
export function resetRoamingBudget(): void {
  roamingCoins = roamingEssence = 0;
}

/** 游荡怪想掉 want 灵石：这一关游荡怪的灵石额度（Economy.roamingCoinCap(章)）里还剩多少就给多少（章从 0 起） */
export function claimRoamingCoins(want: number, chapter: number): number {
  const give = Math.min(Math.max(roamingCoinCap(chapter) - roamingCoins, 0), Math.max(0, want));
  roamingCoins += give;
  return give;
}

/** 游荡怪想给 want 魂晶：这一关游荡怪的魂晶额度里还剩多少就给多少 */
export function claimRoamingEssence(want: number): number {
  const give = Math.min(Math.max(ROAMING_ESSENCE_PER_STAGE - roamingEssence, 0), Math.max(0, want));
  roamingEssence += give;
  return give;
}

/** 击杀灵石过倍率（Unity LootDirector.OnKilled）：据点摊薄 / 驻守点减半，游荡怪再扣每关额度 */
export function scaleKillCoins(enemy: object, coins: number, chapter: number, rng?: Roll | null): number {
  const s = rewardScaleOf(enemy);
  if (!s) return coins;
  let out = scaleReward(coins, s.coins, rng);
  if (s.roaming) out = claimRoamingCoins(out, chapter);
  return out;
}

/** 击杀魂晶过倍率（Unity KillResolver.Resolve） */
export function scaleKillEssence(enemy: object, essence: number): number {
  const s = rewardScaleOf(enemy);
  if (!s) return essence;
  let out = scaleReward(essence, s.essence);
  if (s.roaming) out = claimRoamingEssence(out);
  return out;
}
