import type { GameContext, IRunPlan, RewardKey, RewardType, RunState, StageNode, StageType, ThemeId } from '../core/types';
import { RunRng } from './RunRng';
import { RunRoute } from './RunRoute';
import {
  STAGES, StageSpec, canonical, canonicalFinal, canonicalForScene, canonicalLastReady, getDemoEnd, ready, setStageCatalog,
  stageCatalogVersion, type StageCatalogEntry,
} from './StagePlan';

/**
 * 局流程（Unity RunPlan.cs 里按当前局路线答的那一半 + RunState.cs 的路线 / 关卡 / 随机流）。规划表本身在 StagePlan.ts，路线在 RunRoute.ts。
 *
 * 当前局有路线时，{@link first} / {@link get} / {@link forScene} / {@link final} / {@link playable} 都按这条路线答，
 * {@link next} / {@link isFinal} 等按槽位所属的路线答（StageSpec.route）；没有局、调试局、生涯第一局按规划表原顺序：
 * 场景还没建好的关（StagePlan.ready 为假）不在路线上——next 跳过它、final / isLast 落在最后一个建好的关上。
 *
 * 试玩开关（I1）：StagePlan 的 DemoEnd（网页 = 网址 ?demoEnd=1-4 / ?demo）设成某一关后，这一关就是「最后一关」——
 * isFinal 为真、next 到此为止：打完 1-4 的首领直接走胜利结算。
 *
 * {@link RunPlanner} 是 IRunPlan 的实现（Game 用）：正式开局按局种子排路线（生涯第一局不排 = 设计顺序），
 * ?debugStage=1-2 直接进某张图 = 调试局（不排路线、不刷游荡怪）。
 */

// ───────────── 当前局（Unity RunState.Current）─────────────

let current: RunState | null = null;

/** 设当前局（RunPlanner 开局时设；测试手动设，用完设回 null） */
export function setCurrentRun(run: RunState | null): void {
  current = run;
}

export function currentRun(): RunState | null {
  return current;
}

/** 当前局的路线（没开局 / 调试局 / 生涯第一局 = null：按规划表原顺序） */
export function currentRoute(): RunRoute | null {
  return routeOf(current);
}

// ───────────── 按当前局路线答（Unity RunPlan 的静态属性）─────────────

/** 完整版的最后一关：当前局路线的最后一关；没有路线时是表里最后一个建好的关 */
export function lastReady(): StageSpec {
  return currentRoute()?.last ?? canonicalLastReady();
}

/** 第一关：当前局路线的第一个槽位；没有路线时是规划表的 1-1 */
export function first(): StageSpec {
  return currentRoute()?.first ?? STAGES[0];
}

/** 试玩开关开着（DemoEnd 指向表里的一关，而且在完整版的最后一关之前） */
export function isDemo(): boolean {
  const r = currentRoute();
  if (r) return r.isDemo;
  const d = canonical(getDemoEnd());
  return !!d && d.order < canonicalLastReady().order;
}

/** 这一局的最后一关：试玩版 = DemoEnd，完整版 = 最后一个建好的关 */
export function final(): StageSpec {
  return currentRoute()?.final ?? canonicalFinal();
}

/** 这一局要走的关卡（第一关 … final，跳过还没建好的关） */
export function playable(): readonly StageSpec[] {
  const r = currentRoute();
  if (r) return r.playable;
  const end = final().order;
  const list: StageSpec[] = [];
  for (let i = 0; i <= end && i < STAGES.length; i++) if (i === end || ready(STAGES[i])) list.push(STAGES[i]);
  return list;
}

/** 这一关在不在这一局的路线上；路线的槽位按它的路线答，规划表的关按规划表原顺序答 */
export function inPlay(s: StageSpec | null | undefined): boolean {
  if (!s) return false;
  if (s.route) return s.route.inPlay(s);
  if (s.alt) return false;
  const end = canonicalFinal().order;
  return s.order <= end && (s.order === end || ready(s));
}

/** 下一关（跳过还没建好的关）；这一局的最后一关之后返回 null */
export function next(s: StageSpec | null | undefined): StageSpec | null {
  if (s?.route) return s.route.next(s);
  if (!s || s.alt || isFinal(s)) return null;
  const end = canonicalFinal().order;
  for (let i = s.order + 1; i <= end && i < STAGES.length; i++) if (i === end || ready(STAGES[i])) return STAGES[i];
  return null;
}

/** 这一局的最后一关：打完 = 胜利结算 */
export function isFinal(s: StageSpec | null | undefined): boolean {
  return s?.route ? s.route.isFinal(s) : !!s && !s.alt && s.order >= canonicalFinal().order;
}

/** 完整版的最后一关（最后一个建好的关：击败全部首领） */
export function isLast(s: StageSpec | null | undefined): boolean {
  return s?.route ? s.route.isLast(s) : !!s && !s.alt && s.order >= canonicalLastReady().order;
}

/** 按编号取（「1-2」）：当前局路线上的那个槽位；没有路线 / 路线里没有这个编号时取规划表 */
export function get(code: string | null | undefined): StageSpec | null {
  return currentRoute()?.get(code) ?? canonical(code);
}

/** 按场景路径取：当前局路线上用这个场景的槽位，没有路线 / 不在路线上时取规划表 */
export function forScene(scenePath: string | null | undefined): StageSpec | null {
  return currentRoute()?.forScene(scenePath) ?? canonicalForScene(scenePath);
}

// ───────────── 局状态（Unity RunState：路线、进关、随机流）─────────────

const routeCache = new WeakMap<RunState, RunRoute>();
const streamCache = new WeakMap<RunState, Map<string, RunRng>>();

/** 这一局的关卡路线（run.route 为空 = null：按规划表原顺序；有编号不在规划表里 = null） */
export function routeOf(run: RunState | null | undefined): RunRoute | null {
  if (!run?.route || run.route.length === 0) return null;
  let r = routeCache.get(run);
  if (!r || !r.matches(run.route)) {
    const restored = RunRoute.fromMaps(run.route);
    if (!restored) return null;
    routeCache.set(run, r = restored);
  }
  return r;
}

/** 当前关的编号（槽位编号「1-2」；没有路线时直接进的备选图是「1-A」） */
export function stageCodeOf(run: RunState): string {
  return codeOf(run, run.stage);
}

function codeOf(run: RunState | null, node: StageNode): string {
  const slot = `${node.chapter + 1}-${node.index + 1}`;
  if (!node.map || node.map === slot) return slot;
  const map = canonical(node.map);
  // 路线上的槽位按位置编号；不在路线上的备选图（调试直接进）用自己的编号
  return routeOf(run)?.forMap(map)?.code ?? (map?.alt ? map.code : slot);
}

/** 网页的关卡节点 → 这一局的 StageSpec（路线上的槽位优先；不在路线上时按规划表） */
export function specOf(run: RunState | null, node: StageNode | null | undefined): StageSpec | null {
  if (!node) return null;
  const route = routeOf(run);
  const code = codeOf(run, node);
  if (route) {
    const slot = route.get(code);
    if (slot && (!node.map || slot.map.code === node.map)) return slot;
    const byMap = route.forMap(canonical(node.map ?? code));
    if (byMap) return byMap;
  }
  return canonical(node.map ?? code);
}

const THEMES: readonly ThemeId[] = ['desert', 'frost', 'inferno'];

/** StageSpec → 网页关卡节点（章从 0 起；map = 场景文档 id） */
export function toNode(s: StageSpec): StageNode {
  return {
    chapter: s.chapter - 1, index: s.index, type: s.isBoss ? 'boss' : 'combat', reward: s.clearReward as RewardType,
    theme: THEMES[Math.max(0, Math.min(THEMES.length - 1, s.chapter - 1))], map: s.map.code,
  };
}

/** 进入某一关：记下章 / 关序 / 节点 / 难度 */
export function enterStage(run: RunState, s: StageSpec | null | undefined): void {
  if (!s) return;
  run.chapter = s.chapter - 1;
  run.stageIndex = s.index;
  run.stage = toNode(s);
  run.difficulty = s.difficulty;
}

/**
 * 开一局（Unity RunState.Begin）：route = 这一局的关卡路线（正式开局用 RunRoute.build 按同一个种子排；null = 规划表原顺序）；
 * first = 从哪一关开始（null = 路线的第一关；给的是规划表的关时换成路线上用同一张图的槽位）。设为当前局
 */
export function beginRun(run: RunState, first: StageSpec | null = null, route: RunRoute | null = null, dev = false): RunState {
  run.dev = dev || undefined;
  if (route) run.route = [...route.maps];
  else delete run.route;
  const r = routeOf(run);
  if (!r) enterStage(run, first ?? STAGES[0]);
  else enterStage(run, !first ? r.first : first.route === r ? first : r.forMap(first) ?? r.first);
  current = run;
  return run;
}

/**
 * 这一局的某个随机流（同局种子 + 当前关 + 流名 → 同一序列；同一关里多次取到的是同一个对象，接着往下掷）。
 * 例：runStream(ctx.run, 'loot').chance(0.3)
 */
export function runStream(run: RunState, name: string): RunRng {
  let streams = streamCache.get(run);
  if (!streams) streamCache.set(run, streams = new Map());
  const key = `${stageCodeOf(run)}/${name}`;
  let r = streams.get(key);
  if (!r) streams.set(key, r = RunRng.stream(run.seed, key));
  return r;
}

// ───────────── IRunPlan ─────────────

const STAGE_TYPE_NAMES: Record<StageType, string> = {
  combat: '战斗', elite: '精英战', treasure: '宝藏', shop: '商店', boss: '首领战',
};
const REWARD_NAMES: Record<RewardKey, string> = {
  scroll: '秘卷', weapon: '武器', coins: '灵石', heal: '治疗', upgrade: '强化', pet: '灵宠', none: '无',
};

/** 读场景清单（备选图的 pool 标记在里面）；返回 null = 读不到，按 UnityStages.ts 走 */
export type StageCatalogLoader = () => Promise<readonly StageCatalogEntry[] | null>;

const loadManifest: StageCatalogLoader = async () => {
  const { UnityLevelLibrary } = await import('../world/UnityLevelLibrary');
  return (await UnityLevelLibrary.manifest()).stages;
};

export class RunPlanner implements IRunPlan {
  private catalog: Promise<void> | null = null;
  /** 每一局的路线是按哪一版场景清单排的（清单晚到时开局前重排） */
  private readonly routeVersion = new WeakMap<RunState, number>();

  constructor(readonly ctx: GameContext, private readonly loadCatalog: StageCatalogLoader = loadManifest) {
    // 浏览器里一启动就去读清单：玩家选英雄时通常已经读到
    if (typeof window !== 'undefined' && typeof fetch === 'function') void this.ensureCatalog();
  }

  private ensureCatalog(): Promise<void> {
    this.catalog ??= this.loadCatalog().then(entries => {
      if (entries) setStageCatalog(entries);
    }).catch(error => {
      // 读不到清单：主线按 UnityStages.ts，备选图不进图池（同 Unity：场景没建好就不进路线）
      console.warn('[RunPlan] 场景清单读取失败，备选图不进图池', error);
      this.catalog = null;
    });
    return this.catalog ?? Promise.resolve();
  }

  /**
   * 开局（Unity MenuFlow.StartRun）：每章的开放大图按种子洗牌、每张图抽一种走法（LevelLayout）；
   * 生涯第一局不带路线 = 规划表的设计顺序 + 主走法；?debugStage=1-2 = 调试局（不排路线，从那张图开始）
   */
  createRun(heroId: string, seed: number): RunState {
    const run: RunState = {
      heroId, seed: seed >>> 0, chapter: 0, stageIndex: 0, stage: toNode(STAGES[0]),
      coins: 0, kills: 0, damageDealt: 0, time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {},
    };
    const debug = this.debugStage();
    if (debug) return beginRun(run, debug, null, true);
    beginRun(run, null, this.shuffleRoute() ? RunRoute.build(run.seed) : null);
    this.routeVersion.set(run, stageCatalogVersion());
    return run;
  }

  async prepare(run: RunState): Promise<void> {
    await this.ensureCatalog();
    if (run.stagesCleared > 0) return;
    // ?debugStage=1-A：备选图要等清单才知道导出了没有
    const debug = this.debugStage();
    if (debug) {
      if (!run.dev || specOf(run, run.stage)?.map !== debug.map) beginRun(run, debug, null, true);
      return;
    }
    // 还没进过关的正式局：清单在开局之后才读到（备选图、主线可用性可能变了）按新清单重排；
    // 开局时没排路线（生涯第一局）、之后生涯局数变了（开新局时放弃旧征程记了一局败北）按现在的生涯补排——
    // Unity MenuFlow.StartRun 先 Forfeit 再 Begin，ShuffleRoute 读的是放弃之后的局数
    if (run.dev || run.stagesCleared > 0) return;
    if (run.route ? this.routeVersion.get(run) === stageCatalogVersion() : !this.shuffleRoute()) return;
    beginRun(run, null, RunRoute.build(run.seed));
    this.routeVersion.set(run, stageCatalogVersion());
  }

  /** 这一局要不要排路线：生涯打过至少一局才排（第一局按规划表的设计顺序和主走法）；读不到生涯时照常排 */
  private shuffleRoute(): boolean {
    const runs = this.ctx.meta?.save?.stats?.runs;
    return typeof runs === 'number' ? runs > 0 : true;
  }

  /** ?debugStage=1-2 / 1-A：调试直接进某张图（场景要导出了） */
  private debugStage(): StageSpec | null {
    const requested = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('debugStage');
    const s = canonical(requested);
    return s && ready(s) ? s : null;
  }

  firstStage(run: RunState): StageNode {
    current = run;
    return run.stage;
  }

  nextOptions(run: RunState): StageNode[] {
    const n = next(specOf(run, run.stage));
    return n ? [toNode(n)] : [];
  }

  isFinalStage(node: StageNode): boolean {
    return isFinal(specOf(this.ctx.run ?? current, node));
  }

  difficultyFor(node: StageNode): number {
    return specOf(this.ctx.run ?? current, node)?.difficulty ?? 1 + node.chapter * 0.8 + node.index * 0.16;
  }

  themeFor(chapter: number): ThemeId {
    return THEMES[Math.max(0, Math.min(THEMES.length - 1, chapter))];
  }

  stageLabel(node: StageNode): string {
    const s = specOf(this.ctx.run ?? current, node);
    return `${s?.code ?? `${node.chapter + 1}-${node.index + 1}`} · ${s?.title ?? '未知关卡'} · ${STAGE_TYPE_NAMES[node.type] ?? node.type}`;
  }

  rewardLabel(reward: RewardType): string {
    // 带参数的武器奖励（'weapon:min=1'，Unity WeaponReward）按种类叫「武器」（同 rewardRules.rewardKey；这里不 import 它，测试按模块名打桩）
    return REWARD_NAMES[(reward.startsWith('weapon:') ? 'weapon' : reward.startsWith('pet:') ? 'pet' : reward) as RewardKey] ?? '无';
  }
}
