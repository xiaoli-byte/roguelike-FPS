import type { DesertMapArt } from './spec';

/**
 * 第一章美术层（docs/art/level-art.md）。2026-11-25 起整章重做：版面按 src/world/desert/whitebox/ 的白盒重新编成场景文档（redo/），
 * 旧的 Unity 场景只留玩法数据（波次、奖励）。重做版做完之前用网址 `redo=1` 打开（检视页、游戏都认）；不带就是 Unity 原样。
 * 挂点：StageDirector / unityMapLab 改文档（prepareDesertArt + patchDesertDocument），UnityEnvironmentView 读空气 / 云天 / 光柱覆写，
 * MechanismSystem 改机关数据（patchDesertMechanisms），UnitySceneView 建运行时层（DesertArtLayer），氛围摆位读 layout。
 */
const REDO_IDS = new Set(['1-1', '1-2', '1-3', '1-4', '1-A']);
const redoCache = new Map<string, DesertMapArt | null>();

function params(): URLSearchParams | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search);
}

/** 重做版开了没有（网址 redo=1；desert=0 一律关） */
export function redoEnabled(): boolean {
  const p = params();
  return !!p && p.get('desert') !== '0' && p.get('redo') === '1';
}

let redoModule: typeof import('./redo/runtime') | null = null;

/** 这张图的规格；没有或被关掉返回 null */
export function desertArt(id: string): DesertMapArt | null {
  if (!REDO_IDS.has(id) || !redoEnabled() || !redoModule) return null;
  if (!redoCache.has(id)) redoCache.set(id, redoModule.redoArt(id));
  return redoCache.get(id) ?? null;
}

/** 改文档之前要异步备好的东西：重做版先编译白盒、建新做的件 */
export async function prepareDesertArt(id: string): Promise<void> {
  if (!REDO_IDS.has(id) || !redoEnabled()) return;
  redoModule ??= await import('./redo/runtime');
  await redoModule.prepareRedo(id);
}

export { patchDesertDocument, patchDesertMechanisms, isDesertPatched } from './document';
export { DesertArtLayer } from './layer';
export type { DesertMapArt, DesertPart, DesertBuild, DesertLight, DesertLayoutTuning } from './spec';
