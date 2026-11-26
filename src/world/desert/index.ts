import type { UnitySceneDocument } from '../UnityLevelLibrary';
import type { DesertMapArt } from './spec';
import { REDO_STAGE_IDS, redoEnabled, redoStage } from './redo/active';

/**
 * 第一章美术层（docs/art/level-art.md）。2026-11-25 起整章重做：版面按 src/world/desert/whitebox/ 的白盒编成场景文档（redo/），
 * 玩法数据读 redo/play.ts（从 Unity 导出一次性搬来；用户 2026-11-26：「以后unity是要删除的」——重做版不读 unity-levels 的任何东西）。
 * 重做版做完美术之前用网址 `redo=1` 打开（检视页、游戏都认）；不带就是 Unity 原样。
 * 挂点：StageDirector 取文档（desertDocument）并改文档（prepareDesertArt + patchDesertDocument），UnityEnvironmentView 读空气 / 云天 / 光柱覆写，
 * MechanismSystem 取 / 改机关数据，UnitySceneView 建运行时层（DesertArtLayer），氛围摆位读 layout。
 */
const redoCache = new Map<string, DesertMapArt | null>();
let redoModule: typeof import('./redo/runtime') | null = null;

export { redoEnabled };

/** 这张图的规格；没有或被关掉返回 null */
export function desertArt(id: string): DesertMapArt | null {
  if (!REDO_STAGE_IDS.includes(id) || !redoEnabled() || !redoModule) return null;
  if (!redoCache.has(id)) redoCache.set(id, redoModule.redoArt(id));
  return redoCache.get(id) ?? null;
}

/** 改文档之前要异步备好的东西：重做版先编译白盒、建新做的件 */
export async function prepareDesertArt(id: string): Promise<void> {
  if (!redoStage(id)) return;
  redoModule ??= await import('./redo/runtime');
  await redoModule.prepareRedo(id);
}

/** 重做版的整份场景文档（已改好、带新件的碰撞）；这张图不走重做版返回 null（照旧读 Unity 导出的） */
export function desertDocument(id: string): Promise<UnitySceneDocument> | null {
  if (!redoStage(id)) return null;
  return prepareDesertArt(id).then(() => redoModule!.redoDocument(id));
}

export { patchDesertDocument, patchDesertMechanisms, isDesertPatched } from './document';
export { DesertArtLayer } from './layer';
export type { DesertMapArt, DesertPart, DesertBuild, DesertLight, DesertLayoutTuning } from './spec';
