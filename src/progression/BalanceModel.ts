import {
  AMMO_CRATE_PRICE, BOSS_COINS_MAX, BOSS_COINS_MIN, BOSS_ESSENCE, CHEST_COINS_MAX, CHEST_COINS_MIN, DEFAULT_ESSENCE, ELITE_ESSENCE_MULT,
  ELITE_KILL_COIN_MULT, ESSENCE_PER_STAGE, POTION_PRICE, RARITY, ROADSIDE_REWARD_MULT, WEAPON_PRICE, killChapterMult, rewardChapterMult, shopChapterMult,
} from './Economy';
import { VICTORY_ESSENCE_BONUS, talentTotalCost } from './Meta';
import { playable } from './RunPlan';
import { STAGES, canonical, type StageSpec } from './StagePlan';
import type { EnemyDef } from '../core/types';
import { allEnemyIds, getEnemyDef } from '../enemies/Registry';

/**
 * I3 平衡模型（Unity G/Core/BalanceModel.cs 照译 + EconomyConfig.Project 的经济投影；docs/balance.md；docs/threejs-migration.md 4.7）：
 * 把经济、魂晶、首领用时、逐关难度放到同一组假设上算。
 *   · 编制：{@link STAGE_LOADS} 是各张开放大图的实际遭遇（Unity 从场景里的 EncounterSite 统计），首领场只算首领本身 + {@link BOSS_STAGE_ADDS} 只杂兵；
 *   · 参考秒伤：{@link referenceDps} = 武器裸秒伤 90 × 装备倍率（1 + 1.15 ×（难度 − 1））× 武器之外 1.6 × 输出占比 0.8；
 *   · 装备计划：{@link GEAR} 是每个首领前「正常玩」能拿到的武器，倍率要贴着参考曲线（±15%），花钱的那部分要在补给营的预算里；
 *   · 补给营：{@link CAMPS} 的预算 = 上一家店之后挣到的灵石，要够买计划里的强化和一瓶药，又买不下整店的货。
 * 只算期望值：不含商店消费以外的花销、灵宠、灵石获取天赋（投影里另给）、炭童复燃和蜃楼蟾分身这类不掉落的单位。
 *
 * 敌人 / 首领的数值不在这个模块里：{@link setBalanceData} 把定义表喂进来——游戏里 ?debug 的 __balance() 取网页的敌人注册表
 * （{@link registryBalanceData}），测试读 Unity 冻结的定义表（tests/fixtures/gameplay-defs.json，同形状；两边的值由 tests/unity-defs-parity 对照）。
 * 首领击杀用时（依赖四个首领的定档模型）在 BalanceBosses.ts。
 */

// ───────────── 定义表（注入）─────────────

export interface BalanceEnemy {
  id: string;
  hp: number;
  armor: number;
  shield: number;
  /** 击杀灵石 [lo, hi] */
  coins: readonly [number, number];
  /** 击杀魂晶（缺省 1） */
  essence?: number;
  /** 冲锋型（升格权重 × 1.5） */
  charger?: boolean;
}

export interface BalanceBoss {
  id: string;
  rewards?: { coins?: readonly [number, number]; essence?: number } | null;
}

let enemies = new Map<string, BalanceEnemy>();
let bosses = new Map<string, BalanceBoss>();

/** 换上定义表（{@link balanceDataFromDefs} 的结果、冻结定义表的 enemies / bosses，或同形状的数据）；null = 清空 */
export function setBalanceData(data: { enemies?: readonly BalanceEnemy[]; bosses?: readonly BalanceBoss[] } | null): void {
  enemies = new Map((data?.enemies ?? []).map(e => [e.id, e]));
  bosses = new Map((data?.bosses ?? []).map(b => [b.id, b]));
}

/** 网页的敌人定义 → 定义表：首领（isBoss）只要奖励（灵石 / 魂晶），其余要生命、护甲、护盾、灵石、魂晶、冲锋 */
export function balanceDataFromDefs(defs: Iterable<EnemyDef>): { enemies: BalanceEnemy[]; bosses: BalanceBoss[] } {
  const out: { enemies: BalanceEnemy[]; bosses: BalanceBoss[] } = { enemies: [], bosses: [] };
  for (const d of defs) {
    if (d.isBoss) out.bosses.push({ id: d.id, rewards: { coins: d.coins, essence: d.essence } });
    else out.enemies.push({ id: d.id, hp: d.hp, armor: d.armor ?? 0, shield: d.shield ?? 0, coins: d.coins, essence: d.essence, charger: d.charger });
  }
  return out;
}

/** 敌人注册表里现有的全部定义（游戏启动时已登记）→ 定义表 */
export function registryBalanceData(): { enemies: BalanceEnemy[]; bosses: BalanceBoss[] } {
  return balanceDataFromDefs(allEnemyIds().map(id => getEnemyDef(id)).filter((d): d is EnemyDef => !!d));
}

export function balanceEnemy(id: string): BalanceEnemy | null {
  return enemies.get(id) ?? null;
}

// ───────────── 参考秒伤 ─────────────

/** 主力武器的裸秒伤（普通、身体、含换弹、不含暴击、不含元素克制）：裂风步枪实测 89.4 */
export const BASE_DPS = 90;
/** 难度每 +1 的装备成长（品质、强化、秘卷合计）；真正在输出的时间占比（= BossBalance.Uptime） */
export const GEAR_GROWTH = 1.15, UPTIME = 0.8;
/** 武器之外的输出（技能、持续伤害、英雄被动 × 随机暴击）：四个首领浸泡的几何平均 1.61 */
export const KIT_MULT = 1.6;
/** 首领击杀用时、一张开放大图纯输出的目标带（秒） */
export const BOSS_MIN_SECONDS = 60, BOSS_MAX_SECONDS = 120, FIELD_MIN_SECONDS = 35, FIELD_MAX_SECONDS = 75;
/** 装备计划贴着参考曲线的容差、首领用时要扛住的秒伤偏差（构筑好坏） */
export const GEAR_TOLERANCE = 0.15, DPS_SPREAD = 0.15;
/** 首领浸泡实测（Unity BossBalance.Soak，2026-10-30）：[关, 难度, 首领可选中时的秒伤] */
export const BOSS_SOAK: readonly (readonly [string, number, number])[] = [['1-4', 1.48, 220], ['2-4', 2.28, 405], ['3-3', 2.92, 435], ['3-4', 3.08, 480]];

/** 某难度下的装备倍率：1 + 1.15 ×（难度 − 1） */
export function gearMult(difficulty: number): number {
  return 1 + GEAR_GROWTH * (Math.max(1, difficulty) - 1);
}

/** 某难度下主力武器的身体秒伤（装备后、不含暴击、不含技能） */
export function bodyDps(difficulty: number): number {
  return BASE_DPS * gearMult(difficulty);
}

/** 某难度下目标可选中、一直在打时的秒伤：1-4 约 223、2-4 约 356、3-3 约 462、3-4 约 488 */
export function targetableDps(difficulty: number): number {
  return bodyDps(difficulty) * KIT_MULT;
}

/** 某难度下的参考秒伤（实际打在目标上的平均秒伤，扣掉躲招换位）：1-4 约 179、2-4 约 285、3-3 约 370、3-4 约 391 */
export function referenceDps(difficulty: number): number {
  return targetableDps(difficulty) * UPTIME;
}

// ───────────── 编制表 ─────────────

/** 一种敌人在一关里的只数、其中写定的精英只数 */
export interface Squad {
  readonly enemy: string;
  readonly count: number;
  readonly elites: number;
}

/** 一张开放大图的编制：全部遭遇场地合计、精英升格只数、灵石窖藏数、强化奖励数（场地宝箱 + 窖藏） */
export interface StageLoad {
  readonly code: string;
  readonly promote: number;
  readonly coinCaches: number;
  readonly upgrades: number;
  readonly squads: readonly Squad[];
  /** 驻守点（路遇小队）的编制：战斗用时照算，灵石 / 魂晶 × 0.5 */
  readonly roadside: readonly Squad[];
}

const S = (enemy: string, count: number, elites = 0): Squad => ({ enemy, count, elites });
const L = (code: string, promote: number, coinCaches: number, upgrades: number, squads: Squad[], roadside: Squad[] = []): StageLoad =>
  ({ code, promote, coinCaches, upgrades, squads, roadside });

/**
 * 开放大图的实际编制（前三章九张 2026-10-30 按 Unity 场景统计；第四章按设计文档 / M1 生成的 4-1）。
 * 首领场（1-4 / 2-4 / 3-4 / 4-4）不在表里；3-3 末尾的熔心魔将、4-1 三领主、4-2 大鹗另算（{@link lordsOf}）。
 */
export const STAGE_LOADS: readonly StageLoad[] = [
  L('1-1', 0, 1, 1, [S('jerboa_blade', 17), S('scorpion_archer', 5, 1), S('tomb_beast', 2, 1), S('apsara', 1), S('mirage_toad', 3), S('sand_wraith', 1), S('fire_rat', 6)],
    [S('fire_rat', 2), S('jerboa_blade', 10), S('scorpion_archer', 3), S('sand_wraith', 1), S('mirage_toad', 1)]),
  L('1-2', 1, 1, 1, [S('scorpion_archer', 8, 1), S('jerboa_blade', 16), S('fire_rat', 9), S('mirage_toad', 2), S('tomb_beast', 2, 1), S('apsara', 3), S('sand_wraith', 2)],
    [S('jerboa_blade', 9), S('sand_wraith', 1), S('scorpion_archer', 3), S('fire_rat', 2), S('mirage_toad', 1)]),
  L('1-3', 1, 0, 1, [S('jerboa_blade', 17), S('sand_wraith', 3), S('scorpion_archer', 8, 1), S('fire_rat', 8), S('tomb_beast', 3, 1), S('apsara', 2), S('mirage_toad', 3)],
    [S('scorpion_archer', 3), S('jerboa_blade', 10), S('sand_wraith', 1), S('fire_rat', 2), S('mirage_toad', 1)]),
  L('2-1', 1, 1, 1, [S('ice_whale', 1), S('jiaoren', 16), S('qingniao', 4), S('frost_crab', 2, 1), S('fuzhu', 5, 1), S('xingxing', 10), S('lantern_jelly', 3), S('fox_witch', 2),
    S('haozhi', 5), S('ice_puffer', 3), S('xuangui', 1)], [S('haozhi', 2), S('xingxing', 5), S('fuzhu', 4), S('jiaoren', 5)]),
  L('2-2', 1, 0, 1, [S('xuangui', 2, 1), S('fuzhu', 4, 1), S('xingxing', 21), S('fox_witch', 2), S('haozhi', 8), S('qingniao', 7)], [S('xingxing', 10), S('haozhi', 4), S('fuzhu', 2)]),
  L('2-3', 1, 1, 1, [S('jiaoren', 14), S('ice_puffer', 6), S('fuzhu', 6, 1), S('frost_crab', 1), S('lantern_jelly', 3), S('qingniao', 3), S('xingxing', 5), S('haozhi', 6),
    S('fox_witch', 2), S('xuangui', 1, 1)], [S('jiaoren', 6), S('fuzhu', 2), S('xingxing', 5), S('haozhi', 3)]),
  L('3-1', 0, 0, 1, [S('huodou', 15, 1), S('tantong', 24), S('tuo', 2), S('mamian', 6, 2), S('bifang', 5)], [S('tantong', 12), S('bifang', 3)]),
  L('3-2', 0, 1, 1, [S('mamian', 5, 2), S('tantong', 19), S('huodou', 4), S('bifang', 2), S('fire_crow', 9), S('iron_ox', 2, 1), S('firecracker', 6)], [S('tantong', 5), S('bifang', 1)]),
  L('3-3', 0, 0, 1, [S('founder', 2, 1), S('firecracker', 6), S('tantong', 23), S('nuo', 2), S('huodou', 11, 1), S('mamian', 4, 1), S('fire_crow', 7), S('iron_ox', 2, 1)],
    [S('tantong', 5), S('bifang', 1)]),
  L('4-1', 0, 0, 1, [S('aoyin', 2), S('leiyak', 3), S('jufu', 5), S('marmot', 10), S('manman', 3), S('liangu', 3), S('tiangou', 10), S('dijiang', 7)]),
  L('4-2', 1, 1, 1, [S('jufu', 4), S('tiangou', 10), S('liangu', 3), S('manman', 4), S('dijiang', 6), S('aoyin', 1), S('leiyak', 2), S('marmot', 6)]),
  L('4-3', 0, 0, 1, [S('tiangou', 8), S('jufu', 5), S('liangu', 2), S('marmot', 9), S('dijiang', 5), S('manman', 2), S('aoyin', 2), S('leiyak', 3)]),
];

/** 首领 / 领主的 id */
export const HANBA_ID = 'boss_hanba', KUNPENG_ID = 'boss_kunpeng', WARLORD_ID = 'boss_warlord', QILIN_ID = 'boss_qilin';
export const KUI_ID = 'boss_kui', FEILIAN_ID = 'boss_feilian', HUASHE_ID = 'boss_huashe', DAE_ID = 'boss_dae', LEIZE_ID = 'boss_leize';
/** 四个首领（按出场顺序） */
export const BOSS_IDS: readonly string[] = [HANBA_ID, KUNPENG_ID, WARLORD_ID, QILIN_ID];

/** 首领场里随首领出来的杂兵（召唤的沙魇、炭童、飞鸦……）按这么多只普通单位算 */
export const BOSS_STAGE_ADDS = 8;
/** 精英的生命倍率（同敌人刷出时）、无属性打护甲的倍率 */
export const ELITE_HP_MULT = 2.6, ARMOR_MULT = 0.75;

export function stageLoad(code: string): StageLoad | null {
  return STAGE_LOADS.find(s => s.code === code) ?? null;
}

/** 这一行编制里的敌人都已经在定义表里 */
export function rosterReady(load: StageLoad | null): boolean {
  return !!load && load.squads.every(q => enemies.has(q.enemy));
}

/** 这一行编制的击杀数（场地 + 驻守点） */
export function loadKills(load: StageLoad): number {
  let n = 0;
  for (const q of load.squads) n += q.count;
  for (const q of load.roadside) n += q.count;
  return n;
}

/** 首领场的首领 id（1-4 旱魃、2-4 鲲鹏、3-4 火麒麟、4-4 雷泽雷神）；开放大图 null */
export function bossOf(s: StageSpec | null): string | null {
  if (!s || !s.isBoss) return null;
  return s.chapter === 1 ? HANBA_ID : s.chapter === 2 ? KUNPENG_ID : s.chapter === 4 ? LEIZE_ID : QILIN_ID;
}

/** 开放大图里的领主（3-3 熔心魔将；4-1 夔、飞廉、化蛇；4-2 大鹗）；没有为空 */
export function lordsOf(s: StageSpec | null): readonly string[] {
  switch (s?.code) {
    case '3-3': return [WARLORD_ID];
    case '4-1': return [KUI_ID, FEILIAN_ID, HUASHE_ID];
    case '4-2': return [DAE_ID];
    default: return [];
  }
}

// ───────────── 逐关估算 ─────────────

/** 一关的期望收支（灵石已乘章节系数、未乘灵石获取） */
export interface StageEstimate {
  stage: StageSpec;
  kills: number;
  /** 精英只数（升格按期望，可以是小数） */
  elites: number;
  killCoins: number;
  cacheCoins: number;
  bossCoins: number;
  essence: number;
  /** 杂兵总有效耐久（生命 + 护甲 ÷ 0.75 + 护盾，精英 × 2.6，已 × 难度）、按参考秒伤打完的秒数（开放大图） */
  fieldEhp: number;
  fieldSeconds: number;
  /** 灵石合计 */
  coins: number;
}

const mid = (range: readonly [number, number]): number => (range[0] + range[1]) * 0.5;
/** 有效耐久：生命 + 护甲 ÷ 0.75（无属性打护甲）+ 护盾 */
const bulk = (d: BalanceEnemy): number => d.hp + d.armor / ARMOR_MULT + d.shield;
/** 升格权重：耐久，冲锋型再 × 1.5 */
const heft = (d: BalanceEnemy): number => Math.max(1, d.hp + d.armor + d.shield) * (d.charger ? 1.5 : 1);
/** 这只敌人值多少魂晶：定义的 essence（没写按 1）× 精英 5 */
const essenceOf = (d: BalanceEnemy, elite: boolean): number => Math.max(0, d.essence ?? DEFAULT_ESSENCE) * (elite ? ELITE_ESSENCE_MULT : 1);

function kill(e: StageEstimate, def: BalanceEnemy, n: number, elite: boolean, difficulty: number, killMult: number, reward = 1): void {
  if (n <= 0) return;
  if (elite) e.elites += n;
  e.killCoins += n * mid(def.coins) * (elite ? ELITE_KILL_COIN_MULT : 1) * killMult * reward;
  e.essence += n * essenceOf(def, elite) * reward;
  e.fieldEhp += n * bulk(def) * (elite ? ELITE_HP_MULT : 1) * difficulty;
}

function addField(e: StageEstimate, load: StageLoad, difficulty: number, killMult: number): void {
  // 升格：每只按耐久加权从普通单位里抽一只升为精英（「重型优先」：耐久加权、冲锋型 × 1.5），取期望
  let total = 0;
  for (const q of load.squads) {
    const d = enemies.get(q.enemy);
    if (d && q.count > q.elites) total += heft(d) * (q.count - q.elites);
  }
  for (const q of load.squads) {
    const def = enemies.get(q.enemy);
    if (!def) continue;
    const normals = q.count - q.elites;
    const up = total > 0 ? Math.min(normals, load.promote * heft(def) * normals / total) : 0;
    e.kills += q.count;
    kill(e, def, q.elites + up, true, difficulty, killMult);
    kill(e, def, normals - up, false, difficulty, killMult);
  }
  // 驻守点：不参与升格，奖励减半
  for (const q of load.roadside) {
    const def = enemies.get(q.enemy);
    if (!def) continue;
    e.kills += q.count;
    kill(e, def, q.elites, true, difficulty, killMult, ROADSIDE_REWARD_MULT);
    kill(e, def, q.count - q.elites, false, difficulty, killMult, ROADSIDE_REWARD_MULT);
  }
}

function addBoss(e: StageEstimate, id: string | null, ch: number): void {
  const rewards = id ? bosses.get(id)?.rewards : null;
  let coins: readonly [number, number] = rewards?.coins ?? [BOSS_COINS_MIN, BOSS_COINS_MAX];
  if (!(coins[1] > 0)) coins = [BOSS_COINS_MIN, BOSS_COINS_MAX];
  e.bossCoins += mid(coins) * killChapterMult(ch);
  e.essence += rewards && (rewards.essence ?? 0) > 0 ? rewards.essence! : BOSS_ESSENCE;
}

/** 某章编制里普通单位的平均击杀灵石（首领场杂兵用）：取这一章各张大图的平均 */
function averageNormalCoins(ch: number): number {
  let sum = 0, n = 0;
  for (const s of STAGES) {
    const load = s.chapter - 1 !== ch || s.isBoss ? null : stageLoad(s.code);
    if (!load) continue;
    for (const q of load.squads) {
      const def = enemies.get(q.enemy);
      if (!def) continue;
      sum += mid(def.coins) * q.count;
      n += q.count;
    }
  }
  return n > 0 ? sum / n : 3;
}

/** 某一关的估算（规划表里的关；不在编制表里的开放大图按空编制） */
export function estimateStage(s: StageSpec, bossStageAdds = BOSS_STAGE_ADDS): StageEstimate {
  const e: StageEstimate = { stage: s, kills: 0, elites: 0, killCoins: 0, cacheCoins: 0, bossCoins: 0, essence: 0, fieldEhp: 0, fieldSeconds: 0, coins: 0 };
  const ch = s.chapter - 1;
  const killMult = killChapterMult(ch);
  if (s.isBoss) {
    e.kills = bossStageAdds + 1;
    e.killCoins = bossStageAdds * averageNormalCoins(ch) * killMult;
    e.essence = bossStageAdds * DEFAULT_ESSENCE;
    addBoss(e, bossOf(s), ch);
  } else {
    const load = stageLoad(s.code);
    if (load) addField(e, load, s.difficulty, killMult);
    e.cacheCoins = (load?.coinCaches ?? 0) * (CHEST_COINS_MIN + CHEST_COINS_MAX) * 0.5 * rewardChapterMult(ch);
    for (const lord of lordsOf(s)) addBoss(e, lord, ch);
    e.fieldSeconds = e.fieldEhp / referenceDps(s.difficulty);
  }
  e.essence += ESSENCE_PER_STAGE;
  e.coins = e.killCoins + e.cacheCoins + e.bossCoins;
  return e;
}

/** 整表的估算（主线顺序，含还没建好的第四章） */
export function estimateRun(bossStageAdds = BOSS_STAGE_ADDS): StageEstimate[] {
  return STAGES.map(s => estimateStage(s, bossStageAdds));
}

// ───────────── 魂晶 ─────────────

/** 天赋全部升满的总价（10 项 × 1130 = 11300） */
export function talentTotal(): number {
  return talentTotalCost();
}

/**
 * 打到某一关（含）为止的魂晶：通关 = 最后一关 + 胜利奖励；阵亡 = 前面清掉的关 + 这一关的一半击杀（不含清关 +10）。
 * 只算这一局真的会走的关（RunPlan.playable：场景建好一关算一关）；route 缺省 = 当前的可走路线
 */
export function runEssence(diedAt: string | null = null, route: readonly string[] | null = null): number {
  const codes = new Set(route ?? playable().map(s => s.code));
  let sum = 0;
  for (const e of estimateRun()) {
    if (!codes.has(e.stage.code)) continue;
    if (diedAt !== null && e.stage.code === diedAt) return sum + (e.essence - ESSENCE_PER_STAGE) * 0.5;
    sum += e.essence;
  }
  return sum + VICTORY_ESSENCE_BONUS;
}

// ───────────── 装备计划与补给营 ─────────────

/** 武器的品质伤害倍率、强化（= Unity WeaponLibrary：每级 +12%、最多 5 级、基价 50 ×（级 + 1）×（1 + 0.3 × 章）） */
export const RARITY_DAMAGE: readonly number[] = [1, 1.15, 1.35, 1.6, 1.9];
export const MAX_UPGRADE = 5, UPGRADE_STEP = 0.12, UPGRADE_BASE_COST = 50, UPGRADE_CHAPTER_STEP = 0.3;
/** 武器品质的章节权重表（Unity WeaponRoller.ChapterRarity）、幸运的折算 */
export const CHAPTER_RARITY: readonly (readonly number[])[] = [[58, 32, 8, 2, 0.4], [28, 36, 24, 9, 3], [10, 26, 32, 22, 10]];
export const LUCK_COMMON_DIV = 0.12, LUCK_RARITY_MUL = 0.15;
/** 商店的秘卷价（按稀有度；Unity ShopPricing.ScrollPrice） */
export const SCROLL_PRICE: readonly number[] = [80, 110, 145, 185, 220];
const RARITY_COUNT = 5;
const clampRarity = (r: number): number => Math.max(0, Math.min(RARITY_COUNT - 1, Math.floor(r)));

/** 首领前的装备计划：武器品质、强化等级（其中在补给营花钱买的级数）、秘卷伤害加成 */
export interface GearPlan {
  readonly before: string;
  readonly rarity: number;
  readonly level: number;
  readonly paidLevels: number;
  readonly scrollDamage: number;
  readonly why: string;
}

/** 这份装备的伤害倍率 = 品质 ×（1 + 0.12 × 强化）×（1 + 秘卷） */
export function gearPlanMult(g: GearPlan): number {
  return RARITY_DAMAGE[clampRarity(g.rarity)] * (1 + UPGRADE_STEP * g.level) * (1 + g.scrollDamage);
}

/**
 * 每个首领前「正常玩」的装备：品质取宝箱保底（第一章精英场保底精良、旱魃保底史诗、鲲鹏起保底传说），
 * 强化先用沿途的强化奖励（每张大图一次），不够的在补给营买
 */
export const GEAR: readonly GearPlan[] = [
  { before: '1-4', rarity: RARITY.uncommon, level: 3, paidLevels: 0, scrollDamage: 0, why: '第一章精英场保底精良；1-1 / 1-2 / 1-3 各一次强化奖励' },
  { before: '2-4', rarity: RARITY.epic, level: 4, paidLevels: 1, scrollDamage: 0.05, why: '旱魃保底史诗；2-1 / 2-2 / 2-3 三次强化奖励 + 2-4 门外补给营买一级；第二章两三张伤害秘卷' },
  { before: '3-3', rarity: RARITY.legendary, level: 3, paidLevels: 0, scrollDamage: 0.1, why: '鲲鹏保底传说；3-1 / 3-2 / 3-3 三次强化奖励（3-3 的窖藏在领主战之前）' },
  { before: '3-4', rarity: RARITY.legendary, level: 4, paidLevels: 1, scrollDamage: 0.1, why: '3-4 门外补给营再买一级' },
  { before: '4-4', rarity: RARITY.legendary, level: 5, paidLevels: 1, scrollDamage: 0.3, why: '4-1 / 4-2 两次强化奖励 + 4-4 门外补给营买到满级；第三、四章累计的伤害秘卷' },
];

/** 一家补给营：在哪一关、预算从哪一关之后算起（null = 从头）、为哪个首领备战（对应 {@link GEAR} 的 before） */
export interface Camp {
  readonly at: string;
  readonly after: string | null;
  readonly gear: string;
}

/** 四家补给营：1-3 末段（预算含 1-3，为旱魃备战）、2-4 / 3-4 / 4-4 门外（预算不含本关首领） */
export const CAMPS: readonly Camp[] = [
  { at: '1-3', after: null, gear: '1-4' }, { at: '2-4', after: '1-3', gear: '2-4' }, { at: '3-4', after: '2-4', gear: '3-4' }, { at: '4-4', after: '3-4', gear: '4-4' },
];

/** 补给营所在的章（0 起） */
export function campChapter(camp: Camp): number {
  return (canonical(camp.at)?.chapter ?? 1) - 1;
}

/** 到这家店时，上一家店之后挣到的灵石（期望，不含上一家店剩下的） */
export function campBudget(camp: Camp, coinGainPct = 0): number {
  let sum = 0;
  let counting = camp.after === null;
  const gain = Math.max(0.05, 1 + coinGainPct);
  for (const e of estimateRun()) {
    const s = e.stage;
    if (counting) {
      if (s.code === camp.at) {
        if (!s.isBoss) sum += e.coins * gain;
        break;
      }
      sum += e.coins * gain;
    } else if (s.code === camp.after) {
      counting = true;
      // 上一家店在首领门外：那一关的首领灵石是逛完店之后才挣的，算进下一家店的预算
      if (s.isBoss) sum += e.bossCoins * gain;
    }
  }
  return sum;
}

/** 商店价（Unity ShopPricing.Price）：max(5, round(基价 × (1 + 0.25 × 章) / 5) × 5)，.5 进位 */
export function shopPrice(basePrice: number, chapter: number): number {
  return Math.max(5, Math.floor(basePrice * shopChapterMult(chapter) / 5 + 0.5) * 5);
}

/** 强化一级的价格（当前 level 级 → 下一级） */
export function upgradeCost(level: number, chapter: number): number {
  return Math.floor(UPGRADE_BASE_COST * (level + 1) * (1 + UPGRADE_CHAPTER_STEP * chapter) + 0.5);
}

/** 这家店要花的钱：计划里在这里买的强化 + 一瓶战备药剂 */
export function campPlanned(camp: Camp): number {
  const ch = campChapter(camp);
  let cost = shopPrice(POTION_PRICE, ch);
  for (const g of GEAR) {
    if (g.before !== camp.gear) continue;
    for (let lv = g.level - g.paidLevels; lv < g.level; lv++) cost += upgradeCost(lv, ch);
  }
  return cost;
}

/** 某品质在某章的抽取权重（Unity WeaponRoller.RarityWeight） */
export function rarityWeight(chapter: number, rarity: number, luck: number, minRarity = 0): number {
  if (rarity < minRarity || rarity < 0 || rarity >= RARITY_COUNT) return 0;
  const row = CHAPTER_RARITY[Math.max(0, Math.min(CHAPTER_RARITY.length - 1, chapter))];
  luck = Math.max(0, luck);
  return rarity === 0 ? row[rarity] / (1 + LUCK_COMMON_DIV * luck) : row[rarity] * (1 + LUCK_RARITY_MUL * luck * rarity);
}

function expectedWeaponPrice(chapter: number, minRarity: number): number {
  let total = 0, sum = 0;
  for (let r = 0; r < RARITY_COUNT; r++) {
    const w = rarityWeight(chapter, r, 0, minRarity);
    total += w;
    sum += w * shopPrice(WEAPON_PRICE[r], chapter);
  }
  return total > 0 ? sum / total : 0;
}

/** 整店货价的期望（进店时）：两把武器（左边按章节稀有度表、右边带保底）、1.5 张秘卷（按稀有）、药剂、弹药箱、主力从进店时的等级强化到满级 */
export function shelfValue(camp: Camp): number {
  const ch = campChapter(camp);
  const w1 = expectedWeaponPrice(ch, RARITY.common), w2 = expectedWeaponPrice(ch, ch >= 1 ? RARITY.rare : RARITY.uncommon);
  const scrolls = 1.5 * shopPrice(SCROLL_PRICE[RARITY.rare], ch);
  let level = 0;
  for (const g of GEAR) if (g.before === camp.gear) level = g.level - g.paidLevels;
  let upgrades = 0;
  for (let lv = level; lv < MAX_UPGRADE; lv++) upgrades += upgradeCost(lv, ch);
  return w1 + w2 + scrolls + shopPrice(POTION_PRICE, ch) + shopPrice(AMMO_CRATE_PRICE, ch) + upgrades;
}

// ───────────── 经济投影（Unity EconomyConfig.Project / FormatProjection）─────────────

/** 投影的可调假设：编制按各关实际遭遇（{@link STAGE_LOADS}），这里只留表里没有的 */
export interface ProjectionInputs {
  /** 首领场里随首领出来的杂兵击杀数 */
  killsPerBossStage: number;
  /** 灵石获取加成（0 = 无） */
  coinGainPct: number;
}

export const PROJECTION_DEFAULT: ProjectionInputs = { killsPerBossStage: BOSS_STAGE_ADDS, coinGainPct: 0 };

/** 一章的收入估算 */
export interface ChapterIncome {
  chapter: number;
  fieldStages: number;
  bossStages: number;
  kills: number;
  killCoins: number;
  chestCoins: number;
  bossCoins: number;
  essence: number;
  /** 灵石合计 */
  total: number;
  /** 这一章的收入够买几把稀有武器（商店价 × 章节系数） */
  rareWeapons: number;
}

/**
 * 按规划表估每章收入（期望值，不含商店消费、灵宠、调试）：逐关用 {@link estimateStage}——
 *   击杀 = 各关实际编制的灵石区间中点（精英 × 3）× (1 + 0.15 × 章)；窖藏 = 灵石窖藏数 × 90 × (1 + 0.35 × 章)；
 *   首领（含领主）= 灵石中点 × (1 + 0.15 × 章)；魂晶 = 各敌人定义（精英 × 5）+ 首领 60 + 每关 10。灵石 × 灵石获取。
 */
export function projectEconomy(p: ProjectionInputs = PROJECTION_DEFAULT): ChapterIncome[] {
  const rows = new Map<number, ChapterIncome>();
  const gain = Math.max(0.05, 1 + p.coinGainPct);
  for (const s of STAGES) {
    const ch = s.chapter - 1;
    let r = rows.get(ch);
    if (!r) rows.set(ch, r = { chapter: ch, fieldStages: 0, bossStages: 0, kills: 0, killCoins: 0, chestCoins: 0, bossCoins: 0, essence: 0, total: 0, rareWeapons: 0 });
    const e = estimateStage(s, p.killsPerBossStage);
    if (s.isBoss) r.bossStages++;
    else r.fieldStages++;
    r.kills += e.kills;
    r.killCoins += e.killCoins * gain;
    r.chestCoins += e.cacheCoins * gain;
    r.bossCoins += e.bossCoins * gain;
    r.essence += e.essence;
  }
  const list = [...rows.values()].sort((a, b) => a.chapter - b.chapter);
  for (const r of list) {
    r.total = r.killCoins + r.chestCoins + r.bossCoins;
    r.rareWeapons = r.total / (WEAPON_PRICE[RARITY.rare] * shopChapterMult(r.chapter));
  }
  return list;
}

const n0 = (v: number): string => String(Math.round(v));

/** 投影表（日志 / 调试） */
export function formatProjection(rows: readonly ChapterIncome[], p: ProjectionInputs = PROJECTION_DEFAULT): string {
  const lines = [
    `[Economy] 每章收入投影（各关实际编制，首领场杂兵 ${p.killsPerBossStage} 只，灵石获取 +${n0(p.coinGainPct * 100)}%）`,
    '章 | 大图+首领 | 击杀 | 击杀灵石 | 窖藏灵石 | 首领灵石 | 合计 | 累计 | 稀有武器价 | 可买稀有武器 | 魂晶',
  ];
  let cumulative = 0;
  for (const r of rows) {
    cumulative += r.total;
    const price = Math.round(WEAPON_PRICE[RARITY.rare] * shopChapterMult(r.chapter) / 5) * 5;
    lines.push(`${r.chapter + 1} | ${r.fieldStages}+${r.bossStages} | ${n0(r.kills)} | ${n0(r.killCoins)} | ${n0(r.chestCoins)} | ${n0(r.bossCoins)} | `
      + `${n0(r.total)} | ${n0(cumulative)} | ${price} | ${r.rareWeapons.toFixed(1)} | ${n0(r.essence)}`);
  }
  return lines.join('\n');
}

// ───────────── 报告 ─────────────

const RARITY_NAMES = ['普通', '精良', '稀有', '史诗', '传说'];
const pct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

/**
 * 逐关估算、魂晶、装备计划、补给营、参考曲线对首领浸泡的推演（日志 / docs/balance.md 的数字来源）。
 * 首领击杀用时那一段在 BalanceBosses.ts（{@link bossLines} 由它传进来）
 */
export function balanceReport(bossLines: readonly string[] = []): string {
  const lines = ['[Balance] 逐关估算（期望值，灵石已乘章节系数）',
    '关 | 难度 | 击杀 | 精英 | 击杀灵石 | 窖藏灵石 | 首领灵石 | 灵石 | 累计 | 魂晶 | 累计魂晶 | 杂兵耐久 | 参考秒伤 | 战斗用时'];
  let coins = 0, essence = 0;
  for (const e of estimateRun()) {
    coins += e.coins;
    essence += e.essence;
    const s = e.stage;
    lines.push(`${s.code} | ${s.difficulty.toFixed(2)} | ${e.kills} | ${Math.round(e.elites * 10) / 10} | ${n0(e.killCoins)} | ${n0(e.cacheCoins)} | ${n0(e.bossCoins)} | ${n0(e.coins)} | ${n0(coins)} | `
      + `${n0(e.essence)} | ${n0(essence)} | ${n0(e.fieldEhp)} | ${n0(referenceDps(s.difficulty))} | ${s.isBoss ? '—' : n0(e.fieldSeconds)}`);
  }
  const win = runEssence();
  lines.push(`[Balance] 魂晶：通关一局 ${n0(win)}（含胜利 ${VICTORY_ESSENCE_BONUS}）；1-4 阵亡 ${n0(runEssence('1-4'))}、2-4 阵亡 ${n0(runEssence('2-4'))}、3-4 阵亡 ${n0(runEssence('3-4'))}；`
    + `天赋总价 ${talentTotal()}，约 ${(talentTotal() / Math.max(1, win)).toFixed(1)} 次通关`);
  lines.push('[Balance] 装备计划 | 倍率 | 参考曲线 | 偏差');
  for (const g of GEAR) {
    const want = gearMult(canonical(g.before)?.difficulty ?? 1), m = gearPlanMult(g);
    lines.push(`${g.before} 前：${RARITY_NAMES[clampRarity(g.rarity)]} +${g.level}（买 ${g.paidLevels} 级），秘卷 +${n0(g.scrollDamage * 100)}% | ×${m.toFixed(2)} | ×${want.toFixed(2)} | ${pct(m / want - 1)}`);
  }
  lines.push('[Balance] 补给营 | 预算 | 计划花销 | 整店货价 | 预算 / 整店');
  for (const c of CAMPS) {
    const budget = campBudget(c), shelf = shelfValue(c);
    lines.push(`${c.at} | ${n0(budget)} | ${campPlanned(c)} | ${n0(shelf)} | ${n0(budget / shelf * 100)}%`);
  }
  lines.push('[Balance] 参考曲线 vs 首领浸泡 | 难度 | 曲线可选中时秒伤 | 浸泡实测 | 曲线 / 实测');
  for (const [stage, d, dps] of BOSS_SOAK) lines.push(`${stage} | ${d.toFixed(2)} | ${n0(targetableDps(d))} | ${n0(dps)} | ${(targetableDps(d) / dps).toFixed(2)}`);
  lines.push(...bossLines);
  return lines.join('\n');
}
