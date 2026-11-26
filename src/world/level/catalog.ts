/**
 * 关卡目录（网页的「构建设置」）：主线 16 关 + 每章的备选图（pool: true，每局路线洗牌时和本章主图一起抽）。
 * available = 关卡数据已在 public/assets/levels/<id>/level.json（{@link levelUrl}）；4-2 / 4-4 还没有。
 * 2026-11-26 去 Unity 依赖时由 Unity 导出的 manifest.json 一次性转来（之后这里就是源头，加图直接改这张表）。
 * 局路线只看 id / available / pool（StagePlan.setStageCatalog）；关卡名、章节、类型、奖励在 UnityStages.ts（R2 时并进来）。
 */
export interface LevelCatalogEntry {
  id: string;
  available: boolean;
  pool?: boolean;
}

export const LEVEL_CATALOG: readonly LevelCatalogEntry[] = [
  { id: '1-1', available: true },
  { id: '1-2', available: true },
  { id: '1-3', available: true },
  { id: '1-4', available: true },
  { id: '2-1', available: true },
  { id: '2-2', available: true },
  { id: '2-3', available: true },
  { id: '2-4', available: true },
  { id: '3-1', available: true },
  { id: '3-2', available: true },
  { id: '3-3', available: true },
  { id: '3-4', available: true },
  { id: '4-1', available: true },
  { id: '4-2', available: false },
  { id: '4-3', available: true },
  { id: '4-4', available: false },
  { id: '1-A', available: true, pool: true },
  { id: '2-A', available: true, pool: true },
  { id: '3-A', available: true, pool: true },
];

/** 一张图的关卡数据文件（相对站点根，不带 BASE_URL） */
export function levelUrl(id: string): string {
  return `assets/levels/${id}/level.json`;
}
