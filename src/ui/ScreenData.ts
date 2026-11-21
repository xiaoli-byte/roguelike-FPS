/**
 * 各界面的数据映射（M11c 第二期）：把游戏数据换算成界面上的文字 / 标签 / 行，不碰 DOM。
 * 关卡卡片（Unity StageCardScreen）、整局结算（SummaryScreen）、主菜单生涯统计（MainMenuScreen）、天赋行（TalentScreen）、
 * 秘卷三选一卡面（ScrollChoiceScreen）、选英雄技能行（HeroSelectScreen）、武器卡（WeaponCard）。
 * 本文件不 import 运行时模块（测试按 data: URL 直接加载）。
 */

const CN = '零一二三四五六七八九';
/** 中文数字（1–99） */
export function cnNum(n: number): string {
  if (!(n >= 0 && n <= 99) || !Number.isInteger(n)) return String(n);
  if (n < 10) return CN[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (t === 1 ? '' : CN[t]) + '十' + (o === 0 ? '' : CN[o]);
}

/** 「第一章」（Unity GameSession.ChapterName；chapter 从 1 起） */
export function chapterTitle(chapter: number): string {
  return `第${cnNum(Math.max(1, chapter))}章`;
}

const fmtInt = (v: number) => {
  const n = Math.round(Number.isFinite(v) ? v : 0);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? '-' + s : s;
};
const fmt1 = (v: number) => String(Math.round((Number.isFinite(v) ? v : 0) * 10) / 10);

// ───────────── 关卡卡片 ─────────────

/** 一关里界面要的部分（progression/StagePlan 的 StageSpec） */
export interface StageBrief {
  /** 「1-2 · 雅丹石阵」 */
  label: string;
  title: string;
  /** 章（1 起）与章名 */
  chapter: number;
  chapterName: string;
  difficulty: number;
  isBoss: boolean;
  supplyCamp: boolean;
  /** 清关奖励的显示名（空 = 不显示） */
  rewardLabel: string;
}

/** 关间结算卡的内容 */
export interface StageCardInfo {
  /** 刚打完的这一关 / 下一关（没有为 null） */
  stage: StageBrief | null;
  next: StageBrief | null;
  /** 不在规划表里的关卡的标题 */
  title?: string;
  /** 本关用时（秒，游戏时间） */
  time: number;
  /** 本关击杀、本关灵石净变化（= 现在 − 进关时，含花掉的）、现有灵石、秘卷总层数、本关新得的秘卷层数 */
  kills: number;
  coinsDelta: number;
  coins: number;
  scrolls: number;
  scrollsGained: number;
  /** 下一关能加载（否则「继续」= 带着进度再走一遍本关） */
  nextReady: boolean;
}

export interface StageCardView {
  chapter: string;
  title: string;
  /** 四格：图标名、标签、数值、小字 */
  stats: { icon: 'hourglass' | 'skull' | 'coin' | 'spark'; label: string; value: string; sub: string }[];
  nextLabel: string;
  nextTitle: string;
  tags: { text: string; cls: string }[];
  continueText: string;
  boss: boolean;
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

export function stageCardView(info: StageCardInfo): StageCardView {
  const s = info.stage, n = info.next;
  const tags: { text: string; cls: string }[] = [];
  const tag = (text: string, cls = '') => tags.push({ text, cls });
  let nextLabel = '', nextTitle = '（没有下一关）', continueText = '再走一遍本关';
  if (n) {
    nextLabel = '下 一 关';
    nextTitle = info.nextReady ? n.label : `${n.label}（制作中）`;
    if (s && n.chapter !== s.chapter) tag(`新章节 · ${chapterTitle(n.chapter)} ${n.chapterName}`, 'sf-stagecard__tag--chapter');
    const dd = s ? n.difficulty - s.difficulty : 0;
    tag(s ? `难度 ${n.difficulty.toFixed(2)}（${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(2)}）` : `难度 ${n.difficulty.toFixed(2)}`);
    if (n.isBoss) tag('首领关', 'sf-stagecard__tag--boss');
    if (n.supplyCamp) tag(n.isBoss ? '门外有补给营' : '关内有补给营', 'sf-stagecard__tag--camp');
    if (n.rewardLabel) tag(`清关奖励 · ${n.rewardLabel}`);
    continueText = info.nextReady ? '继续' : '再走一遍本关';
  }
  return {
    chapter: s ? `${chapterTitle(s.chapter)} · ${s.chapterName}` : '',
    title: s ? s.label : info.title ?? '本关',
    stats: [
      { icon: 'hourglass', label: '用时', value: clock(info.time), sub: '' },
      { icon: 'skull', label: '击杀', value: fmtInt(info.kills), sub: '' },
      { icon: 'coin', label: '灵石', value: (info.coinsDelta >= 0 ? '+' : '−') + fmtInt(Math.abs(info.coinsDelta)), sub: `现有 ${fmtInt(info.coins)}` },
      { icon: 'spark', label: '秘卷', value: `${info.scrolls} 层`, sub: info.scrollsGained > 0 ? `本关 +${info.scrollsGained}` : '本关未得' },
    ],
    nextLabel, nextTitle, tags, continueText, boss: !!n?.isBoss,
  };
}

// ───────────── 整局结算 ─────────────

export interface SummaryLike {
  victory: boolean;
  /** 章 / 章内关序（0 起，网页 RunSummary） */
  chapter: number;
  stageIndex: number;
}

/** 止步处：「止步于 第一章 · 第 2 关（标题）」/ 首领关 / 胜利「已击败全部首领」；spec = 止步的那一关（查不到为 null），last = 它是整张表的最后一关 */
export function reachText(s: SummaryLike, spec: Pick<StageBrief, 'label' | 'title' | 'isBoss'> | null, last: boolean): string {
  if (s.victory) return !spec || last ? '已击败全部首领' : `试玩通关 · ${spec.label}`;
  const stageNo = spec?.isBoss ? '首领关' : `第 ${s.stageIndex + 1} 关`;
  return `止步于 ${chapterTitle(s.chapter + 1)} · ${stageNo}${spec ? `（${spec.title}）` : ''}`;
}

/** 题记 */
export function epitaphText(victory: boolean, demoWin: boolean, chapters: number): string {
  return !victory ? '魂火未熄，再入轮回' : demoWin ? '首章已破，余火待燃' : `${cnNum(chapters)}章尽破，烈焰长明`;
}

/** 魂晶来源说明：通关奖励 > 0 时分列 */
export function essenceNote(earned: number, victoryBonus: number): string {
  return victoryBonus > 0
    ? `局内收集 ${fmtInt(Math.max(0, earned - victoryBonus))} + 通关奖励 ${fmtInt(victoryBonus)}，已存入魂晶`
    : '局内收集的魂晶已存入，回主菜单可在「天赋」里花掉';
}

// ───────────── 主菜单 ─────────────

export interface CareerLike {
  runs: number;
  wins: number;
  bestChapter: number;
  bestStages: number;
  totalKills: number;
}

/** 生涯统计五项；没有出征记录返回 null（界面写「尚无出征记录…」） */
export function careerItems(c: CareerLike | null | undefined): { k: string; v: string }[] | null {
  if (!c || !(c.runs > 0)) return null;
  return [
    { k: '出征', v: `${fmtInt(c.runs)} 次` },
    { k: '通关', v: `${fmtInt(c.wins)} 次` },
    { k: '最远', v: c.bestChapter > 0 ? chapterTitle(c.bestChapter) : '—' },
    { k: '最多清关', v: `${fmtInt(c.bestStages)} 关` },
    { k: '累计斩敌', v: fmtInt(c.totalKills) },
  ];
}

export function firstRunText(playable: number, demo: boolean, finalLabel: string): string {
  return demo ? `尚无出征记录。试玩版共 ${playable} 关，到 ${finalLabel} 为止。` : `尚无出征记录。共 ${playable} 关，击败沿途全部首领即可通关。`;
}

/** 用时 m:ss（≥ 1 小时 h:mm:ss；同 Unity ScreenKit.Clock） */
function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** 主菜单上那一局未完成的征程（续玩档，M11d） */
export interface SuspendedLike {
  stageLabel: string;
  heroName: string;
  time: number;
  coins: number;
}

/**
 * 主菜单「继续征程」/「开始游戏」的小字（Unity MainMenuScreen.Refresh）：有未完成的征程时写「关卡 · 英雄 · 用时 · 灵石」，
 * 「开始游戏」写明会放弃它；没有时「继续征程」不显示
 */
export function menuHints(s: SuspendedLike | null | undefined): { continueHint: string; startHint: string } {
  if (!s) return { continueHint: '', startHint: '选择英雄，踏入第一章' };
  return {
    continueHint: `${s.stageLabel} · ${s.heroName} · 用时 ${clockText(s.time)} · 灵石 ${fmtInt(s.coins)}`,
    startHint: '放弃未完成的征程（按败北结算），重新选择英雄',
  };
}

// ───────────── 天赋 ─────────────

export interface TalentLike {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  perLevel: number;
  cost(level: number): number;
}

export interface TalentRowView {
  level: string;
  maxed: boolean;
  cost: number;
  short: boolean;
  now: string;
  next: string;
  tooltip: string;
  pips: boolean[];
}

/** 天赋一行：等级、价格、当前 / 下一级效果（fmt = 按属性格式写增量：+12%、+20） */
export function talentRow(t: TalentLike, level: number, essence: number, fmt: (value: number) => string): TalentRowView {
  const maxed = level >= t.maxLevel;
  const cost = maxed ? 0 : t.cost(level);
  return {
    level: `${level} / ${t.maxLevel}`, maxed, cost, short: !maxed && essence < cost,
    now: `当前 ${fmt(t.perLevel * level)}`,
    next: maxed ? '' : `下一级 ${fmt(t.perLevel * (level + 1))}`,
    tooltip: maxed ? '' : essence >= cost ? `花费 ${cost} 魂晶强化` : `还差 ${cost - essence} 魂晶`,
    pips: Array.from({ length: t.maxLevel }, (_, k) => k < level),
  };
}

/** 已点亮的总级数 / 全部级数 */
export function talentTotals(talents: readonly TalentLike[], level: (id: string) => number): { owned: number; total: number } {
  let owned = 0, total = 0;
  for (const t of talents) {
    owned += Math.min(t.maxLevel, Math.max(0, level(t.id)));
    total += t.maxLevel;
  }
  return { owned, total };
}

// ───────────── 秘卷三选一 ─────────────

export interface ScrollLike {
  id: string;
  name: string;
  description: string;
  rarity: number;
  maxStacks: number;
  tags?: string[];
  heroOnly?: string;
  /** 高风险卷的收益 / 代价两段（ScrollDef.upside / downside，Unity LegendScroll.upside / downside） */
  upside?: string;
  downside?: string;
}

export interface ScrollCardView {
  cur: number;
  max: number;
  next: number;
  /** 「新得」/「升层」 */
  state: string;
  /** 竖排稀有度印（每字一行） */
  rarityVertical: string;
  upside: string;
  /** 代价行（没有为空串；不带「代价：」前缀，卡面前面另放「代价」小签） */
  downside: string;
  /** 层数菱形：owned / next / empty；唯一卷为空表 */
  pips: ('owned' | 'next' | 'empty')[];
  count: string;
}

/** 代价行的前缀与颜色（Unity LegendScroll.DownsidePrefix / DownsideHex；同 progression/scrolls/ScrollKit 的 DOWNSIDE_PREFIX / DOWNSIDE_COLOR） */
export const DOWNSIDE_PREFIX = '代价：';
export const DOWNSIDE_COLOR = '#ff6a50';

type ScrollText = Pick<ScrollLike, 'description' | 'upside' | 'downside'>;

/** 按层数填一段模板（同秘卷描述的 {n} 占位，dom.fillStacks） */
const fillN = (template: string | undefined, stacks: number): string => (template ?? '').replace(/\{n\}/g, String(stacks));

/** 描述里另起一行的「代价：…」（legendText 拼出来的格式；Unity 描述里是红色富文本 <color=#ff6a50>代价：…</color>） */
const DOWNSIDE_LINE = /(?:^|\n)[ \t]*代价[:：][ \t]*([^\n]*)/;

/**
 * 说明拆成收益和代价（Unity ScrollChoiceScreen.SplitDownside）：高风险卷（有 downside）用 upside / downside 两段按层数填；
 * 别的卷从描述里摘出「代价：…」那一行（去掉前缀），没有就整段是收益
 */
export function splitDownside(def: ScrollText, stacks: number): { upside: string; downside: string } {
  if (def.downside) return { upside: fillN(def.upside, stacks), downside: fillN(def.downside, stacks) };
  const full = fillN(def.description, stacks);
  const m = DOWNSIDE_LINE.exec(full);
  if (!m) return { upside: full, downside: '' };
  return { upside: (full.slice(0, m.index) + full.slice(m.index + m[0].length)).trim(), downside: m[1].trim() };
}

/**
 * 整段说明的富文本（Unity ScrollDef.Describe(n)：收益 + 换行 + <color=#ff6a50>代价：…</color>），给图鉴这类直接显示整段说明的富文本标签；
 * 没有代价的卷就是填好层数的描述
 */
export function scrollRichText(def: ScrollText, stacks: number): string {
  const { upside, downside } = splitDownside(def, stacks);
  return downside ? `${upside}\n<color=${DOWNSIDE_COLOR}>${DOWNSIDE_PREFIX}${downside}</color>` : upside;
}

export function scrollCardView(def: ScrollLike, owned: number, rarityName: string): ScrollCardView {
  const cur = Math.max(0, owned), max = Math.max(1, def.maxStacks), next = Math.min(max, cur + 1);
  const { upside, downside } = splitDownside(def, next);
  const pips: ('owned' | 'next' | 'empty')[] = [];
  if (max > 1) for (let k = 0; k < max; k++) pips.push(k < cur ? 'owned' : k < next ? 'next' : 'empty');
  return {
    cur, max, next, state: cur > 0 ? '升层' : '新得', rarityVertical: [...rarityName].join('\n'), upside, downside, pips,
    count: max > 1 ? (cur >= max ? `层数 ${cur} / ${max}（已满）` : `层数 ${cur} → ${next} / ${max}`) : cur > 0 ? '唯一 · 已持有' : '唯一',
  };
}

// ───────────── 选英雄 ─────────────

const TIMING_TAIL = /\s*(?:\d+\s*次充能[，,]\s*)?(?:每次充能|冷却)\s*[\d.]+\s*秒[。.]?\s*$/;

/** 技能行：名字旁的「冷却 N 秒 · M 次充能」，描述去掉末尾重复的冷却说明 */
export function skillRow(s: { name: string; description: string; cooldown: number; charges: number } | null, secondary: boolean): { name: string; meta: string; desc: string } {
  if (!s) return { name: '—', meta: '', desc: '' };
  const meta: string[] = [];
  if (s.cooldown > 0) meta.push(`冷却 ${fmt1(s.cooldown)} 秒`);
  if (secondary || s.charges > 1) meta.push(`${Math.max(1, s.charges)} 次充能`);
  const d = s.cooldown > 0 ? s.description.replace(TIMING_TAIL, '') : s.description;
  return { name: s.name, meta: meta.join(' · '), desc: d || s.description };
}

/** 属性对比条：这位英雄的值占全体英雄最大值的比例（0..1） */
export function barRatio(value: number, all: readonly number[]): number {
  let max = 0;
  for (const v of all) max = Math.max(max, v);
  return max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
}
