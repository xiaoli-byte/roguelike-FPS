import type { RunRoute } from './RunRoute';
import { UNITY_STAGES } from '../world/UnityStages';

/**
 * 整局的关卡规划表（Unity RunPlan.cs 的代码表与只看规划表的规则，一比一）。
 * 当前局路线相关的规则（First / Next / Final…按路线答）在 RunPlan.ts；RunRoute 在 RunRoute.ts。
 * 章从 1 起、关序从 0 起（同 Unity StageSpec）；网页 StageNode 的 chapter 从 0 起，换算在 RunPlan.ts。
 */

/** 关卡种类：开放大图 / 章末首领场 */
export type StageKind = 'field' | 'boss';

/**
 * 一关（docs/unity-parity.md 4.6，D1–D4）：编号「章-关」、标题、章名、场景路径、配乐、种类、难度、清关奖励、有没有补给营。
 * 场景路径是 Unity 的 Assets 相对路径（只作标识；网页按 {@link StageSpec.map} 的编号读场景文档）。
 */
export class StageSpec {
  /** 编号「1-1」（备选图「1-A」） */
  readonly code: string;
  readonly title: string;
  /** 章名（章节卡、结算用） */
  readonly chapterName: string;
  /** 场景路径（Assets/Scenes/…unity） */
  readonly scene: string;
  /** 进关时的配乐 id（calm / combat / boss） */
  readonly music: string;
  readonly kind: StageKind;
  /** 章（1 起） */
  readonly chapter: number;
  /** 章内关序（0 起，首领场 = 3） */
  readonly index: number;
  /** 在整张表里的位置（0 起） */
  readonly order: number;
  /** 难度 = 1 + 0.8 ×（章 − 1）+ 0.16 × 关序（D1）：章末 1.48 / 2.28 / 3.08 */
  readonly difficulty: number;
  /** 清关奖励（奖励串）：开放图给秘卷，首领给武器 */
  readonly clearReward: string;
  /**
   * 这一关里有首领前的补给营（完整商店 + 安全区）：第一章在 1-3 末段的寺院塔院（1-4 月牙泉入口只是安全起步台），
   * 第二、三章在首领场自己的门槛外（2-4 雪岭营地、3-4 炉心外的营地）
   */
  readonly supplyCamp: boolean;
  /**
   * 这一关用的地图：规划表里的原关。规划表里的关 = 自己；每局路线（{@link RunRoute}）的槽位 = 这一局抽到这个位置的那张图
   * （编号 / 关序 / 位置 / 难度跟槽位走，场景 / 标题 / 种类 / 配乐 / 奖励 / 补给营跟地图走）
   */
  readonly map: StageSpec;
  /** 所属的每局路线（规划表里的关 = null：RunPlan.next 等按规划表原顺序走） */
  readonly route: RunRoute | null;
  /**
   * 备选图（{@link POOL}）：不在规划表的主线上（生涯第一局、调试局不走它），只在每局路线洗牌时和本章的主图一起抽，
   * 抽中了就占一个开放图槽位。编号是「章-字母」（「1-A」），路线上的槽位照常按位置编号
   */
  readonly alt: boolean;

  private constructor(fields: {
    code: string; title: string; chapterName: string; scene: string; music: string; kind: StageKind; chapter: number; index: number;
    order: number; clearReward: string; supplyCamp: boolean; map: StageSpec | null; route: RunRoute | null; alt: boolean;
  }) {
    this.code = fields.code;
    this.title = fields.title;
    this.chapterName = fields.chapterName;
    this.scene = fields.scene;
    this.music = fields.music;
    this.kind = fields.kind;
    this.chapter = fields.chapter;
    this.index = fields.index;
    this.order = fields.order;
    this.clearReward = fields.clearReward;
    this.supplyCamp = fields.supplyCamp;
    this.map = fields.map ?? this;
    this.route = fields.route;
    this.alt = fields.alt;
    this.difficulty = difficulty(fields.chapter, fields.index);
  }

  /** 规划表里的一关 / 备选图（altCode 非空） */
  static table(order: number, chapter: number, index: number, title: string, chapterName: string, scene: string, kind: StageKind,
    music: string, clearReward: string, supplyCamp = false, altCode: string | null = null): StageSpec {
    const alt = !!altCode;
    return new StageSpec({ code: alt ? altCode! : `${chapter}-${index + 1}`, title, chapterName, scene, music, kind, chapter, index, order,
      clearReward, supplyCamp, map: null, route: null, alt });
  }

  /** 每局路线的槽位：第 order 个位置、章内关序 index，用地图 map */
  static slot(map: StageSpec, route: RunRoute, order: number, index: number): StageSpec {
    const m = map.map;
    return new StageSpec({ code: `${m.chapter}-${index + 1}`, title: m.title, chapterName: m.chapterName, scene: m.scene, music: m.music,
      kind: m.kind, chapter: m.chapter, index, order, clearReward: m.clearReward, supplyCamp: m.supplyCamp, map: m, route, alt: false });
  }

  /** 「1-1 · 古道穿越戈壁」 */
  get label(): string { return `${this.code} · ${this.title}`; }
  get isBoss(): boolean { return this.kind === 'boss'; }
  toString(): string { return this.label; }
}

export const CHAPTERS = 4, STAGES_PER_CHAPTER = 4;
export const CHAPTER_SLOPE = 0.8, STAGE_SLOPE = 0.16;
/** 试玩版缺省到哪一关（第一章首领 · 旱魃） */
export const DEMO_DEFAULT = '1-4';
/** 网址参数：?demoEnd=1-4；?demo = {@link DEMO_DEFAULT}（Unity 的命令行 -demoEnd / -demo） */
export const DEMO_END_ARG = 'demoEnd', DEMO_ARG = 'demo';

/** 难度 = 1 + 0.8 ×（章 − 1）+ 0.16 × 关序（章从 1 起，关序从 0 起；网页用双精度，和原 RunPlanner.difficultyFor 一致） */
export function difficulty(chapter: number, index: number): number {
  return 1 + CHAPTER_SLOPE * (chapter - 1) + STAGE_SLOPE * index;
}

function build(): StageSpec[] {
  const Ch1 = '赤沙古道', Ch2 = '昆仑雪墟', Ch3 = '祝融火狱', Ch4 = '雪域天路';
  const list: StageSpec[] = [];
  const add = (chapter: number, title: string, chapterName: string, scene: string, kind: StageKind = 'field', supply = false, at = -1): void => {
    let index = list.filter(s => s.chapter === chapter).length;
    if (at >= 0) index = at;
    const boss = kind === 'boss';
    list.push(StageSpec.table(list.length, chapter, index, title, chapterName, `Assets/Scenes/${scene}.unity`, kind,
      boss ? 'boss' : 'calm', boss ? 'weapon' : 'scroll', supply));
  };
  // 第一章（D2；补给营在 1-3 末段的寺院塔院）
  add(1, '古道穿越戈壁', Ch1, 'L1_1_GobiRoad');
  add(1, '雅丹迷城', Ch1, 'L1_2_Yardang');
  add(1, '沉沙古城', Ch1, 'L1_3_SunkenCity', 'field', true);
  add(1, '鸣沙山月牙泉 · 旱魃', Ch1, 'L1_4_Crescent', 'boss');
  // 第二章（D3；补给营在 2-4 首领场门槛外）
  add(2, '冰瀑栈道', Ch2, 'L2_1_Icefall');
  add(2, '昆仑天阙 · 开明九门', Ch2, 'L2_2_Kunlun');
  add(2, '瑶池冰湖', Ch2, 'L2_3_Yaochi');
  add(2, '北冥冰台 · 鲲鹏', Ch2, 'L2_4_Beiming', 'boss', true);
  // 第三章（D4；3-3 终点是熔心魔将领主战，D5；补给营在 3-4 首领场门槛外）
  add(3, '熔湖堤道', Ch3, 'L3_1_Causeway');
  add(3, '铸神井', Ch3, 'L3_2_ForgeWell');
  add(3, '铸范大坊', Ch3, 'L3_3_Foundry');
  add(3, '祝融炉心 · 火麒麟', Ch3, 'L3_4_Zhurong', 'boss', true);
  // 第四章（C4-1 / C4-2：4-1 三领主开放盆地、4-2 大鹗三江口、4-3 彩林海子（2026-11-07 用户定：川西秋林镜面湖，占了原计划雪域宫堡的位置，
  // 见 docs/level-design/maps/4-3.md）；补给营在 4-4 神山海子的门槛外）
  add(4, '折多垭口·天路草甸', Ch4, 'L4_1_Zheduo');
  add(4, '大渡河·铁索桥峡谷', Ch4, 'L4_2_Dadu');
  add(4, '彩林海子', Ch4, 'L4_3_Cailin');
  add(4, '神山海子 · 雷泽雷神', Ch4, 'L4_4_Haizi', 'boss', true, 3);
  return list;
}

/**
 * 备选图（docs/level-design/run-variety.md §1.1，2026-11-08）：每章多一张开放图进图池，每局路线从「主图 + 备选图」里抽满本章的开放图槽位。
 * 场景没建好（{@link ready} 为假）时不进图池，路线照旧只在主图里洗。order 从 1000 起（不在主线上）
 */
function buildPool(): StageSpec[] {
  const Ch1 = '赤沙古道', Ch2 = '昆仑雪墟', Ch3 = '祝融火狱';
  const list: StageSpec[] = [];
  const alt = (code: string, chapter: number, title: string, chapterName: string, scene: string): void => {
    list.push(StageSpec.table(1000 + list.length, chapter, 0, title, chapterName, `Assets/Scenes/${scene}.unity`, 'field', 'calm', 'scroll', false, code));
  };
  alt('1-A', 1, '千佛崖', Ch1, 'L1_A_GrottoCliff');
  alt('2-A', 2, '玄冰裂谷', Ch2, 'L2_A_Crevasse');
  alt('3-A', 3, '赤焰灰原', Ch3, 'L3_A_AshPlain');
  return list;
}

/** 全部关卡（主线顺序，整表 16 关，不受试玩开关和场景有没有建好影响：经济投影用） */
export const STAGES: readonly StageSpec[] = build();
/**
 * 备选图（每章多出来的开放图，{@link StageSpec.alt}）：每局路线洗牌时和本章主图一起抽，抽满本章的开放图槽位
 * （槽位数 = 本章建好的主图数）。不在主线上：经济投影、规划表原顺序都不算它们
 */
export const POOL: readonly StageSpec[] = buildPool();
/** 主线 + 备选图（按编号 / 场景查图用） */
export const ALL_MAPS: readonly StageSpec[] = [...STAGES, ...POOL];

// ───────────── 场景建好了没有（Unity：SceneFlow.CanLoad = 构建设置里有）─────────────

/** 场景清单里的一项（public/assets/unity-levels/manifest.json 的 stages[]；备选图带 pool: true） */
export interface StageCatalogEntry {
  id: string;
  available?: boolean;
  pool?: boolean;
}

let catalog: ReadonlyMap<string, StageCatalogEntry> | null = null;
let catalogVersion = 0;

/**
 * 换上场景清单（网页的「构建设置」）：主线图按 available、备选图要 pool: true 且 available 才算建好。
 * null = 回到清单读到之前的缺省（UnityStages.ts 的 available；备选图一律算没建好）
 */
export function setStageCatalog(entries: readonly StageCatalogEntry[] | null): void {
  catalog = entries ? new Map(entries.map(entry => [entry.id, entry])) : null;
  catalogVersion++;
}

/** 场景清单读到了没有 */
export function hasStageCatalog(): boolean {
  return catalog !== null;
}

/** 清单换过几次（路线按哪一版清单排的） */
export function stageCatalogVersion(): number {
  return catalogVersion;
}

/** 缺省判定：场景清单里导出了这张图（清单读到之前按 UnityStages.ts；备选图只认清单里 pool: true 的） */
export function sceneExported(s: StageSpec): boolean {
  if (catalog) {
    const entry = catalog.get(s.map.code);
    return !!entry && entry.available !== false && (!s.map.alt || entry.pool === true);
  }
  if (s.map.alt) return false;
  return UNITY_STAGES.some(stage => stage.available && stage.chapter === s.map.chapter - 1 && stage.index === s.map.index);
}

/** 某一关的场景能不能进（null = {@link sceneExported}）。测试换成固定规则，用完设回 null */
let sceneReady: ((s: StageSpec) => boolean) | null = null;
export function setSceneReady(f: ((s: StageSpec) => boolean) | null): void {
  sceneReady = f;
}

/** 这一关的场景已经建好、能进 */
export function ready(s: StageSpec | null | undefined): boolean {
  if (!s) return false;
  const f = sceneReady;
  return f ? f(s) : sceneExported(s);
}

// ───────────── 试玩开关（I1）─────────────

let demoEnd: string | null = null;
let demoResolved = false;

/** 网址参数 → 试玩终点（纯函数）：?demoEnd=1-4 / ?demoEnd（不写关卡 = 缺省终点）/ ?demo */
export function resolveDemoEnd(search: string | null | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  for (const [key, value] of params) {
    if (key.toLowerCase() === DEMO_END_ARG.toLowerCase()) return normalize(value) ?? DEMO_DEFAULT;
    if (key.toLowerCase() === DEMO_ARG) return DEMO_DEFAULT;
  }
  return null;
}

function normalize(code: string | null | undefined): string | null {
  return !code || !code.trim() ? null : code.trim();
}

/** 试玩版的最后一关编号（null = 完整版）。设成不在表里的编号等于关掉。缺省按网址解析一次 */
export function getDemoEnd(): string | null {
  if (!demoResolved) {
    demoResolved = true;
    demoEnd = resolveDemoEnd(typeof location === 'undefined' ? null : location.search);
  }
  return demoEnd;
}

export function setDemoEnd(value: string | null | undefined): void {
  demoResolved = true;
  demoEnd = normalize(value);
}

// ───────────── 规划表原顺序（不看当前局路线）─────────────

/** 规划表里按编号取（含备选图）；没有则 null */
export function canonical(code: string | null | undefined): StageSpec | null {
  if (!code) return null;
  return ALL_MAPS.find(s => s.code === code) ?? null;
}

/** 规划表里按场景路径取（不区分大小写，斜杠方向不限） */
export function canonicalForScene(scenePath: string | null | undefined): StageSpec | null {
  if (!scenePath) return null;
  const p = scenePath.replace(/\\/g, '/').toLowerCase();
  return ALL_MAPS.find(s => s.scene.toLowerCase() === p) ?? null;
}

/** 规划表原顺序下的最后一关：表里最后一个建好的关（一个都没建好时是表的最后一关） */
export function canonicalLastReady(): StageSpec {
  for (let i = STAGES.length - 1; i >= 0; i--) if (ready(STAGES[i])) return STAGES[i];
  return STAGES[STAGES.length - 1];
}

/** 规划表原顺序下这一局的最后一关（试玩终点在完整版最后一关之前时是它） */
export function canonicalFinal(): StageSpec {
  const d = canonical(getDemoEnd()), last = canonicalLastReady();
  return d && d.order < last.order ? d : last;
}
