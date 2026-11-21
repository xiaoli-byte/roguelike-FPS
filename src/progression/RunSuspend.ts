import type { RunState, RunSummary, WeaponSave } from '../core/types';
import { SaveService } from '../core/SaveService';
import { BANKED_FLAG, DEFAULT_HEROES, MetaSection, bankRun, onRunBanked } from './Meta';
import { enterStage, inPlay, routeOf, specOf, stageCodeOf } from './RunPlan';
import { canonical, ready, type StageSpec } from './StagePlan';

/**
 * 中途续玩（Unity G/Core/RunSuspend.cs 照译，I5；docs/unity-parity.md 3.1「中途续玩」；docs/threejs-migration.md 4.7）：
 * 每关开头把进关快照写进续玩档，主菜单「继续征程」从那一关开头接着打。
 *
 * 写：Game 每进一关（关卡搭好、玩家就位之后）拍一份进关快照（{@link RunState} 加上 scrolls / weapons / hp / shield）调 {@link write}：
 *   关卡、英雄、种子、武器（品质 / 强化 / 元素 / 弹药 / 词条）、秘卷层数（按获得顺序）、灵石、魂晶、生命护盾、用时 / 伤害 / 击杀 / 清关数、
 *   标记、开局锁定的天赋（run.talents）、这一局的路线。随机流不用另存：只由「种子 + 关卡编号 + 流名」决定，读回来同样从起点开始。
 *   已经结算过的局不写；调试局（?debugStage）只在调试档开着时（白盒检视页 / SaveService.forceDev）写 run.dev.json。
 * 删：一局结束（{@link bankRun}：阵亡、放弃、胜利、开新局时放弃旧局）就删掉那个档的续玩档。暂离（暂停菜单「返回主菜单」）不结算，续玩档留着。
 * 防损坏：localStorage.setItem 是原子的，不需要 Unity 的 .tmp + 替换；读的时候任何一步不对（空、不是 JSON、缺字段、英雄 / 关卡不存在、
 *   已经结算过）都当坏档：挪成 .corrupt 留作排查，记下原因给主菜单提示一次（{@link takeProblem}），不崩溃。版本比本程序新的档原样留着。
 *
 *   { "version": 2, "game": "spiritfire", "kind": "run", "build": "0.1.0", "savedAt": "2026-11-21T…Z",
 *     "stage": "1-2", "label": "1-2 · …", "hero": "fox", "run": { 局状态 } }
 * 键名：存档根/run.json（正式档）、run.dev.json（调试档），和 profile.json 同一个根。
 * 与 Unity 的差异：run 里章从 0 起（网页 RunState）、当前关写成 stageCode + map（地图编号）；没有灵宠（M9）；
 * 版本 1（没有天赋快照）的档网页没出过，读到时照 Unity 按读档那一刻档里的天赋补上。
 */
export type SuspendStatus =
  /** 没有续玩档 */
  | 'none'
  /** 读到了，可以继续 */
  | 'ok'
  /** 坏了：挪成 .corrupt，不再提供「继续征程」 */
  | 'corrupt'
  /** 来自更新的版本：原样留着，这个版本不读也不删 */
  | 'newer';

/** 一份续玩档（主菜单「继续征程」显示、读回） */
export interface SuspendedRun {
  run: RunState;
  /** 写盘时间（UTC，ISO 8601） */
  savedAt: string;
  /** 属于调试档（run.dev.json） */
  dev: boolean;
  stage: StageSpec;
}

export const RUN_SUSPEND_VERSION = 2;
/** 从这个版本起续玩档里带天赋快照 */
export const TALENT_SNAPSHOT_VERSION = 2;
export const RUN_MAIN_NAME = 'run', RUN_DEV_NAME = 'run.dev';
/** 武器强化上限、品质档数、元素（校验用；= Unity WeaponLibrary.MaxUpgrade / Rarity.Names / Element） */
export const MAX_WEAPON_UPGRADE = 5, RARITY_COUNT = 5;
export const ELEMENTS: readonly string[] = ['none', 'fire', 'shock', 'corrode'];

let problem: string | null = null;
let last: { dev: boolean; seed: number; stage: string; hero: string } | null = null;
let heroExists: (id: string) => boolean = id => DEFAULT_HEROES.includes(id);
let installed: (() => void) | null = null;
const writtenListeners: ((stageCode: string) => void)[] = [];

export const RunSuspend = {
  /** 写盘开关（测试关掉它模拟「旧版本没有续玩档」；缺省开） */
  enabled: true,

  /** 认英雄的办法（Game 挂上 ctx.heroes；缺省认默认三位） */
  setHeroLookup(fn: ((id: string) => boolean) | null): void {
    heroExists = fn ?? (id => DEFAULT_HEROES.includes(id));
  },

  /** 挂上「一局结束就删续玩档」的钩子（幂等；Game 构造时调，测试手动调） */
  ensureInstalled(): void {
    installed ??= onRunBanked(run => discard(devFor(run)));
  },

  /** 测试：回到初始状态 */
  reset(): void {
    problem = null;
    last = null;
    this.enabled = true;
    installed?.();
    installed = null;
    writtenListeners.length = 0;
    heroExists = id => DEFAULT_HEROES.includes(id);
  },

  /** 写了一份续玩档（关卡编号；测试用） */
  onWritten(fn: (stageCode: string) => void): void {
    writtenListeners.push(fn);
  },
};

// ───────────── 文件 ─────────────

/** 续玩档的键（正式档 run.json / 调试档 run.dev.json，和 profile.json 同一个根） */
export function pathFor(dev: boolean): string {
  return `${SaveService.root}/${dev ? RUN_DEV_NAME : RUN_MAIN_NAME}.json`;
}

export function corruptPathFor(dev: boolean): string {
  return `${pathFor(dev)}.corrupt`;
}

/** 主菜单现在用的是调试档（forceDev / 白盒检视页；主菜单里没有局） */
export function menuDev(): boolean {
  return SaveService.profileFor(null) === SaveService.dev;
}

/** 某一局的续玩档在哪个档里（同 SaveService.profileFor） */
export function devFor(run: { dev?: boolean } | null | undefined): boolean {
  return SaveService.profileFor(run) === SaveService.dev;
}

function getItem(key: string): string | null {
  try {
    return SaveService.storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function removeItem(key: string): void {
  try {
    const s = SaveService.storage;
    if (!s) return;
    if (s.removeItem) s.removeItem(key);
    else if (s.getItem(key) !== null) s.setItem(key, '');
  } catch (e) {
    console.warn(`[RunSuspend] 删不掉 ${key}：${(e as Error)?.message ?? e}`);
  }
}

/** 有没有续玩档（不读内容） */
export function exists(dev: boolean): boolean {
  const text = getItem(pathFor(dev));
  return text !== null && text !== '';
}

// ───────────── 写 ─────────────

/** 这一局要不要写续玩档：没结算过、关卡在规划表里；调试局只在调试档开着时写 */
export function shouldWrite(run: RunState | null | undefined): boolean {
  return RunSuspend.enabled && !!run && (run.flags?.[BANKED_FLAG] ?? 0) === 0 && !!specOf(run, run.stage) && (!run.dev || menuDev());
}

/** 续玩档里的 run（章从 0 起；当前关 = 槽位编号 + 地图编号） */
function serializeRun(run: RunState): Record<string, unknown> {
  const finite = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const out: Record<string, unknown> = {
    heroId: run.heroId, seed: run.seed >>> 0,
    chapter: run.chapter, stage: run.stageIndex, stageCode: stageCodeOf(run), map: run.stage?.map ?? stageCodeOf(run),
    difficulty: finite(run.difficulty, 1), time: finite(run.time), damageDealt: finite(run.damageDealt),
    coins: finite(run.coins), essence: finite(run.essence), kills: finite(run.kills), stagesCleared: finite(run.stagesCleared),
    dev: !!run.dev,
    flags: { ...(run.flags ?? {}) },
    scrolls: { ...(run.scrolls ?? {}) },
    weapons: (run.weapons ?? []).map(w => ({ ...w, affixes: w.affixes ? JSON.parse(JSON.stringify(w.affixes)) : [] })),
    hp: finite(run.hp, -1), shield: finite(run.shield, -1),
  };
  if (run.talents) out.talents = { ...run.talents };
  if (run.route && run.route.length > 0) out.route = [...run.route];
  return out;
}

/** 写一份续玩档（快照原样写，不改它）；失败打警告返回 false */
export function write(snapshot: RunState | null | undefined, dev: boolean): boolean {
  if (!snapshot) return false;
  const path = pathFor(dev);
  try {
    const store = SaveService.storage;
    if (!store) return false;
    const stage = specOf(snapshot, snapshot.stage);
    const code = stageCodeOf(snapshot);
    const root = {
      version: RUN_SUSPEND_VERSION, game: 'spiritfire', kind: 'run', build: SaveService.build,
      savedAt: new Date().toISOString(), stage: code, label: stage?.label ?? code, hero: snapshot.heroId,
      run: serializeRun(snapshot),
    };
    store.setItem(path, JSON.stringify(root, null, 2));
    last = { dev, seed: snapshot.seed >>> 0, stage: code, hero: snapshot.heroId };
    for (const fn of [...writtenListeners]) {
      try {
        fn(code);
      } catch (e) {
        console.error(e);
      }
    }
    return true;
  } catch (e) {
    console.warn(`[RunSuspend] 写 ${path} 失败：${(e as Error)?.message ?? e}`);
    return false;
  }
}

/**
 * 这一局现在能不能「暂离」（回主菜单不结算、下次从本关开头继续）：盘上有它这一关的续玩档。
 * 调试局（没写档）、已经结算过的局返回 false——那就只能按「回主菜单 = 结算」走
 */
export function canSuspend(run: RunState | null | undefined): boolean {
  if (!run || !shouldWrite(run)) return false;
  const dev = devFor(run);
  return !!last && last.dev === dev && last.seed === run.seed >>> 0 && last.stage === stageCodeOf(run) && last.hero === run.heroId && exists(dev);
}

/** 删掉续玩档（一局结束、开新局放弃旧局、测试） */
export function discard(dev: boolean): void {
  removeItem(pathFor(dev));
  if (last && last.dev === dev) last = null;
}

// ───────────── 读 ─────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

function intDict(v: unknown, what: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (v === undefined || v === null) return out;
  if (!isObject(v)) throw new Error(`${what} 不是对象`);
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what} ${k} 不是数`);
    out[k] = Math.trunc(n);
  }
  return out;
}

/** 续玩档里的 run → 局状态；字段类型不对就抛异常（按坏档处理） */
function deserializeRun(o: Record<string, unknown>): RunState & { stageCode: string; map: string } {
  if (typeof o.heroId !== 'string') throw new Error('缺少英雄');
  if (typeof o.stageCode !== 'string' || !o.stageCode) throw new Error('缺少关卡编号');
  if (o.weapons !== undefined && o.weapons !== null && !Array.isArray(o.weapons)) throw new Error('weapons 不是数组');
  if (o.route !== undefined && o.route !== null && (!Array.isArray(o.route) || o.route.some(c => typeof c !== 'string'))) throw new Error('route 不是编号数组');
  const weapons: WeaponSave[] = ((o.weapons as unknown[] | null) ?? []).map(w => {
    if (!isObject(w)) throw new Error('有一把枪不是对象');
    return {
      id: typeof w.id === 'string' ? w.id : '', rarity: num(w.rarity, 0), level: num(w.level, 0),
      element: typeof w.element === 'string' ? w.element : 'none', mag: num(w.mag, 0), reserve: num(w.reserve, 0),
      active: w.active === true, affixes: Array.isArray(w.affixes) ? w.affixes : [],
    };
  });
  const run = {
    heroId: o.heroId, seed: num(o.seed, 0) >>> 0,
    chapter: num(o.chapter, 0), stageIndex: num(o.stage, 0),
    stage: { chapter: 0, index: 0, type: 'combat', reward: 'none', theme: 'desert' },
    difficulty: num(o.difficulty, 1), time: num(o.time, 0), damageDealt: num(o.damageDealt, 0),
    coins: num(o.coins, 0), essence: num(o.essence, 0), kills: num(o.kills, 0), stagesCleared: num(o.stagesCleared, 0),
    dev: o.dev === true || undefined,
    flags: intDict(o.flags, '标记'),
    scrolls: intDict(o.scrolls, '秘卷'),
    weapons,
    hp: num(o.hp, -1), shield: num(o.shield, -1),
    stageCode: o.stageCode, map: typeof o.map === 'string' && o.map ? o.map : o.stageCode,
  } as RunState & { stageCode: string; map: string };
  if (o.talents !== undefined && o.talents !== null) run.talents = intDict(o.talents, '天赋快照');
  if (Array.isArray(o.route) && o.route.length > 0) run.route = [...(o.route as string[])];
  return run;
}

/** 读回来的局能不能用：英雄、关卡都还在；关卡在这个版本的路线里；还没结算过；数值不离谱。不对就抛异常（按坏档处理）。返回这一关 */
function validate(run: RunState & { stageCode: string; map: string }): StageSpec {
  if (!run.heroId || !heroExists(run.heroId)) throw new Error(`英雄 ${run.heroId || '（空）'} 不存在`);
  const route = routeOf(run);
  if (run.route && run.route.length > 0 && !route) throw new Error(`关卡路线 ${run.route.join(',')} 里有不认识的关`);
  // 路线上的槽位按这一局的路线查（试玩版终点之后的不算）；没有路线的按规划表（调试直接进的备选图按地图编号）
  const stage = route?.get(run.stageCode) ?? canonical(run.map) ?? canonical(run.stageCode);
  if (!stage) throw new Error(`关卡 ${run.stageCode || '（空）'} 不在规划表里`);
  if (!stage.alt && !inPlay(stage)) throw new Error(`关卡 ${stage.code} 不在这个版本的路线里`);
  if (stage.alt && !ready(stage)) throw new Error(`关卡 ${stage.code} 这个版本没有`);
  // 路线里每张图的场景都要在这个版本里（换了版本删了图 = 这条路线走不完）
  if (route) for (const s of route.playable) if (!ready(s.map)) throw new Error(`路线上的 ${s.code} ${s.title} 这个版本没有`);
  if ((run.flags[BANKED_FLAG] ?? 0) !== 0) throw new Error('这一局已经结算过');
  if (run.coins < 0 || run.essence < 0 || run.kills < 0 || run.stagesCleared < 0) throw new Error('数值是负的');
  if (![run.time, run.damageDealt, run.hp, run.shield, run.coins, run.essence, run.kills, run.stagesCleared].every(v => Number.isFinite(v)) || run.time < 0)
    throw new Error('数值不合法');
  for (const w of run.weapons ?? []) {
    if (!w.id) throw new Error('有一把枪没有 id');
    if (!Number.isInteger(w.rarity) || w.rarity < 0 || w.rarity >= RARITY_COUNT) throw new Error(`${w.id} 的品质 ${w.rarity} 不合法`);
    if (!Number.isInteger(w.level) || w.level < 0 || w.level > MAX_WEAPON_UPGRADE) throw new Error(`${w.id} 的强化 +${w.level} 不合法`);
    if (!ELEMENTS.includes(w.element)) throw new Error(`${w.id} 的元素 ${w.element} 不合法`);
    if (!(w.mag >= 0) || !(w.reserve >= 0)) throw new Error(`${w.id} 的弹药是负的`);
  }
  if (run.talents) for (const [k, v] of Object.entries(run.talents)) if (!k || v < 0) throw new Error(`天赋快照 ${k || '（空）'} = ${v} 不合法`);
  // 章 / 关序 / 难度以规划表为准（档里的只是冗余）
  enterStage(run, stage);
  return stage;
}

/** 读续玩档（不改盘上的东西）：ok 时 result 是读回来的局（每次都是新对象）；corrupt / newer 时 error 写原因 */
export function read(dev: boolean): { status: SuspendStatus; result?: SuspendedRun; error?: string } {
  const text = getItem(pathFor(dev));
  // 空串 = 没有 removeItem 的存储后端「删掉」的档
  if (text === null || text === '') return { status: 'none' };
  try {
    if (!text.trim()) throw new Error('空文件');
    const o: unknown = JSON.parse(text);
    if (!isObject(o)) throw new Error('顶层不是对象');
    if (!Number.isSafeInteger(o.version) || (o.version as number) < 1) throw new Error('缺少版本号');
    const version = o.version as number;
    if (version > RUN_SUSPEND_VERSION) return { status: 'newer', error: `续玩档来自更新的版本（v${version} > v${RUN_SUSPEND_VERSION}）` };
    if (o.game !== 'spiritfire' || o.kind !== 'run') throw new Error('不是灵火破晓的续玩档');
    if (!isObject(o.run)) throw new Error('缺少 run');
    const run = deserializeRun(o.run);
    const stage = validate(run);
    run.dev = run.dev || dev || undefined;
    // v1 的档没有开局天赋快照：按现在档里的天赋补上（从继续征程起锁定）
    if (version < TALENT_SNAPSHOT_VERSION && !run.talents) run.talents = SaveService.profileFor(run).section(MetaSection).talentSnapshot();
    const clean: Record<string, unknown> = run as unknown as Record<string, unknown>;
    delete clean.stageCode;
    delete clean.map;
    return { status: 'ok', result: { run, savedAt: typeof o.savedAt === 'string' ? o.savedAt : '', dev, stage } };
  } catch (e) {
    return { status: 'corrupt', error: (e as Error)?.message ?? String(e) };
  }
}

function moveAside(dev: boolean): void {
  const path = pathFor(dev);
  try {
    const text = getItem(path);
    if (text !== null) SaveService.storage?.setItem(corruptPathFor(dev), text);
  } catch (e) {
    console.warn(`[RunSuspend] 挪开坏档 ${path} 失败（${(e as Error)?.message ?? e}），直接删掉`);
  }
  removeItem(path);
  if (last && last.dev === dev) last = null;
}

/** 主菜单用：读续玩档；坏档挪成 .corrupt、记下原因（{@link takeProblem} 提示一次）并返回 null；没有档 / 版本更新也返回 null */
export function peek(dev: boolean): SuspendedRun | null {
  const r = read(dev);
  switch (r.status) {
    case 'ok':
      return r.result ?? null;
    case 'corrupt':
      if (!SaveService.quiet) console.warn(`[RunSuspend] ${pathFor(dev)} 读不了（${r.error}），丢弃；坏文件留在 .corrupt`);
      moveAside(dev);
      problem = '上次的征程存档已损坏，无法继续，已丢弃';
      return null;
    case 'newer':
      problem ??= '上次的征程来自更新的版本，这个版本无法继续';
      return null;
    default:
      return null;
  }
}

/** 上一次读档发现的问题（读一次就清掉；主菜单提示一次） */
export function takeProblem(): string | null {
  const p = problem;
  problem = null;
  return p;
}

/** 继续征程读回来的那一局算作「刚写过」：暂停里还能再暂离（Unity 里是进关时重写一遍续玩档，网页同样会重写，这里只是不依赖先后） */
export function adopt(s: SuspendedRun): void {
  last = { dev: s.dev, seed: s.run.seed >>> 0, stage: stageCodeOf(s.run), hero: s.run.heroId };
}

// ───────────── 放弃 ─────────────

/**
 * 放弃续玩档里的那一局（开新局时）：按失败结算（魂晶照常入账、记一局败北）再删档。没有档 / 坏档只删档。返回结算（没有为 null）
 */
export function forfeit(dev: boolean): RunSummary | null {
  const s = peek(dev);
  let summary: RunSummary | null = null;
  if (s) {
    try {
      summary = bankRun(s.run, false);
    } catch (e) {
      console.error(e);
    }
  }
  discard(dev);
  return summary;
}
