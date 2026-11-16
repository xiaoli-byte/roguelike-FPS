import type { RunState } from '../core/types';
import type { RunRng } from './RunRng';

/**
 * 经济数值表（Unity EconomyConfig.cs 一比一，docs/unity-parity.md D16 / D24）。
 * 数值本来就照 Three.js Loot.ts / loot/rewardRules.ts / DESIGN.md 4 / 11 节定的；章一律从 0 起（第一章 = 0，同网页 run.chapter）。
 *   击杀灵石：EnemyDef.coins [lo, hi] 掷整数 × 精英 3 × (1 + 0.15 × 章)；首领没写时 60–100（首领包另加 2 弹药 + 2 生命）。
 *   一次性奖励（宝箱灵石、强化 / 秘卷满层转灵石）：× (1 + 0.35 × 章)；宝箱灵石 60–120，精英场 × 1.4。
 *   灵石获取（coinGainPct）在 Unity 里只在入账时乘一次（{@link creditCoins}，小数部分累计到下一次）。
 * Unity 新加、网页原来没有的：游荡怪每关的灵石 / 魂晶额度（{@link roamingCoinCap} / {@link ROAMING_ESSENCE_PER_STAGE}）、
 * 驻守点（路遇）奖励 × {@link ROADSIDE_REWARD_MULT}；接在 RewardScale.ts 和 StageDirector 上。
 * 投影（Unity Project / FormatProjection）依赖 BalanceModel 的逐关编制，那张表还没迁，不在这里。
 */

/** 宝箱档位：普通场地 / 有精英的场地 / 首领场（决定保底品质、灵石加成与提示行） */
export type ChestTier = 'normal' | 'elite' | 'boss';
/** 敌人档位（Unity Rank） */
export type Rank = 'normal' | 'elite' | 'boss';
/** 稀有度（Unity Rarity：Common 0 … Legendary 4） */
export const RARITY = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as const;

// ───────────── 击杀 ─────────────

/** 击杀灵石的章节系数：× (1 + 0.15 × 章)（敌人数量本身已随章节增长，系数取小） */
export const KILL_CHAPTER_COIN = 0.15;
/** 精英击杀灵石倍数 */
export const ELITE_KILL_COIN_MULT = 3;
/** 首领定义没写灵石时的范围 */
export const BOSS_COINS_MIN = 60, BOSS_COINS_MAX = 100;
/** 首领包：额外掉的弹药 / 生命个数，以及抛撒力度 */
export const BOSS_PACK_AMMO = 2, BOSS_PACK_HEALTH = 2;
export const BOSS_COIN_TOSS = 2.2, ELITE_COIN_TOSS = 1.4;
/** 击杀掉弹药：平时 30%，所有武器（弹匣 + 备弹）都低于 35% 时 50%；生命 10%。精英必掉两样 */
export const AMMO_DROP_CHANCE = 0.3, AMMO_DROP_CHANCE_LOW = 0.5, LOW_AMMO_FRAC = 0.35, HEALTH_DROP_CHANCE = 0.1;
/** 掉落的弹药包补充每把枪备弹上限的比例；生命包缺省回复最大生命的比例 */
export const AMMO_PICKUP_FRAC = 0.25, HEALTH_PICKUP_FRAC = 0.15;
/** 精英掉灵兽封印的概率（Unity 独有，灵宠随 M9） */
export const ELITE_PET_CHANCE = 0.06;
/** 击杀魂晶：首领没写时 60、精英 × 5、普通缺省 1（Unity KillResolver） */
export const BOSS_ESSENCE = 60, ELITE_ESSENCE_MULT = 5, DEFAULT_ESSENCE = 1;

// ───────────── 一次性奖励 ─────────────

/** 一次性奖励（宝箱灵石、强化 / 秘卷满层转灵石）的章节系数：× (1 + 0.35 × 章) */
export const REWARD_CHAPTER_COIN = 0.35;
/** 宝箱灵石范围、精英场倍数、抛撒力度 */
export const CHEST_COINS_MIN = 60, CHEST_COINS_MAX = 120;
export const ELITE_CHEST_COIN_MULT = 1.4, CHEST_COIN_TOSS = 1.7;
/** 强化台 / 强化奖励在武器满级时改发的灵石基数 */
export const UPGRADE_FALLBACK_COINS = 80;
/** 秘卷全部满层时每张卡改发的灵石基数（× 张数） */
export const SCROLL_FALLBACK_COINS_PER_CARD = 40;
/** 每进入新的一关补给的备弹比例 */
export const STAGE_AMMO_REFILL = 0.35;

// ───────────── 掉落物 ─────────────

/** 场上掉落物上限：超出的灵石直接入账，弹药 / 生命丢弃 */
export const MAX_PICKUPS = 240;
/** 一笔灵石拆成几颗：每颗约 3，最多 14 颗（≥ 60 的大笔最多 22 颗） */
export const COIN_PIECE_VALUE = 3, MAX_COIN_PIECES = 14, MAX_COIN_PIECES_LARGE = 22, LARGE_COIN_AMOUNT = 60;
/** 清场后吸取的延迟（秒，另加 0–0.4 s 随机）、已清场后才掉出的灵石落地展示的时间 */
export const VACUUM_DELAY = 0.8, LATE_VACUUM_DELAY = 1.1;
/** 首领倒下后多久把场上掉落物吸向玩家（秒，另加 0–0.4 s 随机） */
export const BOSS_VACUUM_DELAY = 1.6;

// ───────────── 商店参照 ─────────────

/** 武器价格（按稀有度）× (1 + 0.25 × 章)，取整到 5 */
export const WEAPON_PRICE: readonly number[] = [60, 100, 160, 240, 360];
export const SHOP_CHAPTER_PRICE = 0.25;
export const SCROLL_PRICE_MIN = 80, SCROLL_PRICE_MAX = 220, POTION_PRICE = 40, AMMO_CRATE_PRICE = 20;

// ───────────── 魂晶（局外）─────────────

/** 每清一关 / 胜利额外的魂晶 */
export const ESSENCE_PER_STAGE = 10, ESSENCE_VICTORY = 200;

/**
 * 游荡怪（CombatDirector）每关的灵石额度基数（× 击杀章节系数，{@link roamingCoinCap}）：约一张开放图击杀灵石的四分之一，
 * 一局多出约一成半灵石（docs/balance.md 第十二节）；额度用完游荡怪只掉弹药 / 生命
 */
export const ROAMING_COINS_PER_STAGE = 35;
/** 游荡怪每关最多给的魂晶（一局多约 70，天赋节奏快不到一成） */
export const ROAMING_ESSENCE_PER_STAGE = 8;

/**
 * 驻守点（路遇小队，UnityEncounter.roadside）的击杀灵石 / 魂晶倍率：驻守点是「怪要多」加的怪，奖励减半，
 * 不让每张图多出来的十几只怪把灵石 / 魂晶推出平衡带（docs/balance.md 第十二节）
 */
export const ROADSIDE_REWARD_MULT = 0.5;

/** C# Mathf.RoundToInt：四舍六入、正好 .5 取偶 */
export function roundToInt(v: number): number {
  const f = Math.floor(v), d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const f32 = Math.fround;

/** 这一章每关游荡怪的灵石额度 */
export function roamingCoinCap(chapter: number): number {
  return roundToInt(f32(ROAMING_COINS_PER_STAGE * killChapterMult(chapter)));
}

// ───────────── 公式 ─────────────

/**
 * 清关魂晶 +{@link ESSENCE_PER_STAGE}：首领倒下结算时发（force，每场首领一次），开放大图在出口结算时发——本关已经发过就不再发。
 * 发过的关记在本局标记上。返回是否发了
 */
export function creditStageEssence(run: RunState | null | undefined, stageCode: string, force = false): boolean {
  if (!run) return false;
  const key = `stage_essence:${stageCode}`;
  if (!force && (run.flags?.[key] ?? 0) !== 0) return false;
  run.flags ??= {};
  run.flags[key] = 1;
  run.essence += ESSENCE_PER_STAGE;
  return true;
}

/** 击杀灵石章节系数 1 + 0.15 × 章（C# float） */
export function killChapterMult(chapter: number): number {
  return f32(1 + f32(f32(KILL_CHAPTER_COIN) * Math.max(0, chapter)));
}

/** 一次性奖励章节系数 1 + 0.35 × 章 */
export function rewardChapterMult(chapter: number): number {
  return f32(1 + f32(f32(REWARD_CHAPTER_COIN) * Math.max(0, chapter)));
}

/** 商店价格章节系数 1 + 0.25 × 章 */
export function shopChapterMult(chapter: number): number {
  return f32(1 + f32(f32(SHOP_CHAPTER_PRICE) * Math.max(0, chapter)));
}

type IntRng = Pick<RunRng, 'int'> | { int(min: number, max: number): number };

/** 某敌人这次掉多少灵石（灵石获取加成不在这里乘）：定义的 [lo, hi] 掷整数 × 精英 3 × 章节系数，四舍五入 */
export function killCoins(range: readonly [number, number], rank: Rank, chapter: number, rng: IntRng | null): number {
  let [lo, hi] = range;
  if (rank === 'boss' && hi <= 0) {
    lo = BOSS_COINS_MIN;
    hi = BOSS_COINS_MAX;
  }
  if (hi <= 0) return 0;
  let base = rng ? rng.int(Math.max(0, lo), Math.max(0, hi)) : Math.floor(Math.max(0, lo) + Math.random() * (Math.max(0, hi) - Math.max(0, lo) + 1));
  if (rank === 'elite') base *= ELITE_KILL_COIN_MULT;
  return roundToInt(f32(base * killChapterMult(chapter)));
}

/** 宝箱灵石：60–120 × 章节系数 × 精英场 1.4（灵石获取入账时乘） */
export function chestCoins(tier: ChestTier, chapter: number, rng: IntRng | null): number {
  const base = rng ? rng.int(CHEST_COINS_MIN, CHEST_COINS_MAX) : Math.floor(CHEST_COINS_MIN + Math.random() * (CHEST_COINS_MAX - CHEST_COINS_MIN + 1));
  return roundToInt(f32(f32(base * rewardChapterMult(chapter)) * (tier === 'elite' ? f32(ELITE_CHEST_COIN_MULT) : 1)));
}

/** 一次性奖励的灵石（基数 × 章节系数）：强化满级转灵石、秘卷全满层转灵石 */
export function rewardCoins(baseAmount: number, chapter: number): number {
  return roundToInt(f32(baseAmount * rewardChapterMult(chapter)));
}

/** 武器奖励的保底品质（同 TS weaponRewardMinRarity）：首领第一章史诗、第二章起传说；精英精良；其余不保底（0） */
export function weaponMinRarity(tier: ChestTier, chapter: number): number {
  return tier === 'boss' ? (chapter >= 1 ? RARITY.legendary : RARITY.epic) : tier === 'elite' ? RARITY.uncommon : RARITY.common;
}

/** 秘卷奖励的保底稀有度：精英 / 首领 1（精良），其余 0 */
export function scrollMinRarity(tier: ChestTier): number {
  return tier === 'normal' ? RARITY.common : RARITY.uncommon;
}

/** 奖励串拆参数（Unity RewardRegistry.Split：按冒号） */
export function splitReward(reward: string | null | undefined): string[] {
  return reward ? reward.split(':') : [''];
}

/**
 * 把宝箱档位写进奖励串（发放和提示共用，保证提示与实际一致）：
 *   "weapon"（没指定 id / 品质 / 保底）→ "weapon:min=N"；"scroll"（没写 min）→ "scroll:min=1"；"coins" → "coins:tier=elite"。
 * 关卡里写死的奖励（指定了武器 id、品质或保底）原样保留。
 */
export function applyTier(reward: string, tier: ChestTier, chapter: number): string {
  if (!reward || tier === 'normal') return reward;
  const args = splitReward(reward);
  switch (args[0]) {
    case 'weapon': {
      if (args.length > 1) return reward;
      const min = weaponMinRarity(tier, chapter);
      return min > 0 ? `weapon:min=${min}` : reward;
    }
    case 'scroll':
      if (args.some(a => a.startsWith('min='))) return reward;
      return `${reward}:min=${scrollMinRarity(tier)}`;
    case 'coins':
      if (args.some(a => a.startsWith('tier='))) return reward;
      return `${reward}:tier=${tier === 'boss' ? 'boss' : 'elite'}`;
    default:
      return reward;
  }
}

/** 奖励串里的 tier=…（没有为 normal） */
export function tierOf(args: readonly string[] | null | undefined): ChestTier {
  for (const a of args ?? []) {
    if (a === 'tier=elite') return 'elite';
    if (a === 'tier=boss') return 'boss';
  }
  return 'normal';
}

/** 奖励串里的整数参数 key=N（没有为 fallback） */
export function intArg(args: readonly string[] | null | undefined, key: string, fallback: number): number {
  const prefix = `${key}=`;
  for (const a of args ?? []) {
    if (!a?.startsWith(prefix)) continue;
    const text = a.substring(prefix.length);
    if (/^[+-]?\d+$/.test(text.trim())) return Number.parseInt(text, 10);
  }
  return fallback;
}

/** 击杀魂晶（Unity KillResolver.EssenceFor）：首领没写时 60，精英 × 5，普通缺省 1 */
export function essenceFor(essence: number | undefined, rank: Rank): number {
  const base = rank === 'boss' ? (essence !== undefined && essence > 0 ? essence : BOSS_ESSENCE) : essence ?? DEFAULT_ESSENCE;
  return Math.max(0, base) * (rank === 'elite' ? ELITE_ESSENCE_MULT : 1);
}

// ───────────── 入账 ─────────────

let carry = 0;
let carryRun: RunState | null = null;

/**
 * 灵石入账：× 灵石获取（gain = 1 + coinGainPct，下限 0.05），只在这里乘一次。小数部分留到下一次（同一局内），
 * 一颗 1 灵石 × 1.08 不会因为四舍五入白白丢掉加成。返回实际入账数
 */
export function creditCoins(run: RunState, baseAmount: number, gain: number): number {
  if (baseAmount <= 0) return 0;
  if (run !== carryRun) {
    carryRun = run;
    carry = 0;
  }
  carry = f32(carry + f32(baseAmount * f32(Math.max(0.05, gain))));
  const whole = Math.floor(carry + 1e-4);
  carry = Math.max(0, f32(carry - whole));
  if (whole > 0) run.coins += whole;
  return whole;
}
