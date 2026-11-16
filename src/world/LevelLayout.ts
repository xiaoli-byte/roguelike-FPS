import type { RunState } from '../core/types';
import { RunRng } from '../progression/RunRng';
import { routeOf, stageCodeOf } from '../progression/RunPlan';
import type { UnityEncounter, UnityLayoutVariant, UnitySceneDocument } from './UnityLevelLibrary';

/**
 * 图内布局变体（Unity LevelLayout.cs 一比一；docs/level-design/run-variety.md §2）：同一张开放大图在不同的局里从不同的地方进、
 * 从不同的地方出、按不同的先后打据点。地形 / 套件 / 光照不变；变的是「这一局怎么走这张图」——
 *   · 出生点（variant.spawn）和出口（variant.exit）：场景里每个变体的出生标记 / 出口祭坛都摆好，只留这一局抽中的那套；
 *   · 据点先后（variant.requires）：反着走时把「② ③ 要求 ①」反过来；
 *   · 只在某个变体里有的物体（variant.only：出口祭坛、藏宝点、可选场地、装饰）和要藏起来的物体（variant.hide）；
 *   · 场地的编制 / 奖励（variant.sites）：难度曲线跟着走法走——先打的场地用开场编制、给第二把枪，最后打的用终局编制。
 * 第一个变体 = 设计稿的走法（主变体）。
 *
 * 抽哪个：这一局有路线（正式开局）时按随机流 {@link LAYOUT_STREAM} 掷（只由种子 + 槽位编号决定 → 同一局里重来本关 / 续玩还是同一个变体）；
 * 没有路线的局（调试局、生涯第一局）用主变体。{@link setLayoutForce} 可以指定（测试 / 网址 ?variant=reverse）。
 *
 * 网页：场景文档是数据，所以「停用物体」= 从文档里滤掉路径落在停用物体下的导出项（渲染件、碰撞体、据点、出口、宝箱、营地、入场点…），
 * 在 StageDirector 搭场景之前生效：停用的出生点 / 出口 / 场地从一开始就不在场。文档没有 layout 时原样返回。
 */

/** 抽变体用的随机流名 */
export const LAYOUT_STREAM = 'layout';

let force: string | null = null;
let forceResolved = false;

/** 指定变体 id（null = 正常抽）：测试 / 调试在加载关卡之前设，用完设回 null。缺省读网址 ?variant= */
export function layoutForce(): string | null {
  if (!forceResolved) {
    forceResolved = true;
    force = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('variant');
  }
  return force;
}

export function setLayoutForce(id: string | null): void {
  forceResolved = true;
  force = id && id.trim() ? id.trim() : null;
}

/**
 * 抽变体（纯函数）：force 命中某个 id（不分大小写）→ 它；这一局有路线 → 按 {@link LAYOUT_STREAM} 流按权重掷；否则 0（主变体）
 */
export function pickLayoutVariant(list: readonly (Pick<UnityLayoutVariant, 'id' | 'weight'> | null)[] | null | undefined,
  forced: string | null, run: RunState | null): number {
  if (!list || list.length === 0) return -1;
  if (forced) {
    const wanted = forced.toLowerCase();
    for (let i = 0; i < list.length; i++) if (list[i] && list[i]!.id.toLowerCase() === wanted) return i;
    console.warn(`[LevelLayout] 没有变体 ${forced}，按正常规则抽`);
  }
  if (!run || !routeOf(run)) return 0;
  // 每次现算一条新流（不用 runStream 的缓存）：同一局第几次进这一关、之前掷过几次都不影响，只看种子 + 槽位编号
  const rng = RunRng.stream(run.seed, `${stageCodeOf(run)}/${LAYOUT_STREAM}`);
  let total = 0;
  for (const v of list) if (v && v.weight > 0) total += Math.fround(v.weight);
  if (total <= 0) return 0;
  let r = rng.nextDouble() * total;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (!v || v.weight <= 0) continue;
    r -= Math.fround(v.weight);
    if (r <= 0) return i;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i]!.weight > 0) return i;
  return 0;
}

/** 抽中的布局（文档没有 layout 时 variant = null、index = -1、document = 原文档） */
export interface AppliedLayout {
  document: UnitySceneDocument;
  variant: UnityLayoutVariant | null;
  index: number;
  /** 全部据点（含被停用的），已按变体换好编制：战斗导演收怪物表用（Unity 收 GetComponentsInChildren(true)） */
  allEncounters: UnityEncounter[];
}

/** 层级路径 scenePath 在物体 root 下（等于它或以「它/」开头） */
export function underPath(scenePath: string | undefined, root: string): boolean {
  return !!scenePath && (scenePath === root || scenePath.startsWith(`${root}/`));
}

/** 按这一局抽变体并摆场景（{@link pickLayoutVariant} + {@link applyLevelLayout}） */
export function chooseLevelLayout(document: UnitySceneDocument, run: RunState | null, forced = layoutForce()): AppliedLayout {
  const variants = document.layout?.variants;
  if (!variants || variants.length === 0) return { document, variant: null, index: -1, allEncounters: document.encounters };
  return applyLevelLayout(document, pickLayoutVariant(variants, forced, run));
}

/**
 * 按变体 index 摆场景：停用别的变体的出生点 / 出口 / 专属物体，藏起本变体要藏的，改写场地先后、换编制 / 奖励，
 * 再从各场地的 requires 里去掉停用的场地。返回新文档（原文档不动）
 */
export function applyLevelLayout(document: UnitySceneDocument, index: number): AppliedLayout {
  const variants = document.layout?.variants;
  const v = variants?.[index];
  if (!variants || !v) return { document, variant: null, index: -1, allEncounters: document.encounters };

  const keep = new Set<string>();
  const keepPath = (path: string | null | undefined): void => { if (path) keep.add(path); };
  keepPath(v.spawn?.scenePath);
  keepPath(v.exit);
  for (const path of v.only ?? []) keepPath(path);

  // 别的变体专属的物体：不在本变体里就停用；本变体要藏的也停用
  const off = new Set<string>();
  const offPath = (path: string | null | undefined): void => { if (path && !keep.has(path)) off.add(path); };
  for (const other of variants) {
    if (!other || other === v) continue;
    offPath(other.spawn?.scenePath);
    offPath(other.exit);
    for (const path of other.only ?? []) offPath(path);
  }
  for (const path of v.hide ?? []) offPath(path);
  const active = (item: { scenePath?: string }): boolean => {
    for (const root of off) if (underPath(item.scenePath, root)) return false;
    return true;
  };

  // 场地编制 / 奖励（改的是本局这份拷贝）
  const overrides = new Map((v.sites ?? []).map(o => [o.site, o]));
  const allEncounters = document.encounters.map(site => {
    const o = overrides.get(site.title);
    if (!o) return site;
    return { ...site, ...(o.spec ? { waves: o.spec.waves } : {}), ...(o.reward !== null && o.reward !== undefined ? { reward: o.reward } : {}) };
  });
  const encounters = allEncounters.filter(active);
  const live = new Set(encounters.map(site => site.title));
  const rewrites = new Map((v.requires ?? []).map(r => [r.site, r.requires]));
  for (let i = 0; i < encounters.length; i++) {
    const site = encounters[i];
    const requires = rewrites.get(site.title) ?? site.requires;
    // 前置场地被停用了：从 requires 里去掉（不然那个场地永远等不到前置）
    const kept = (requires ?? []).filter(title => live.has(title));
    if (kept !== site.requires) encounters[i] = { ...site, requires: kept };
  }

  const result: UnitySceneDocument = {
    ...document,
    spawn: v.spawn ? { position: v.spawn.position, forward: v.spawn.forward } : document.spawn,
    renderers: document.renderers.filter(active),
    colliders: document.colliders.filter(active),
    platforms: document.platforms.filter(active),
    water: document.water.filter(active),
    activators: document.activators.filter(active),
    encounters,
    exits: document.exits.filter(active),
    caches: document.caches.filter(active),
    camps: document.camps.filter(active),
    entries: document.entries?.filter(active),
  };
  console.info(`[LevelLayout] ${document.id}：变体 ${v.title ? `${v.id}（${v.title}）` : v.id}（共 ${variants.length} 种）`);
  return { document: result, variant: v, index, allEncounters };
}
