/**
 * 第一章重做版的开关（没有依赖，关卡排程 / 关卡导演都能轻量引用）。
 * 重做版做完美术之前用网址 `redo=1` 打开；`desert=0` 一律关。开着时这几张图的场景文档由白盒编出来，
 * 不读 Unity 导出的场景清单 / 场景文件（用户 2026-11-26：「以后unity是要删除的」）。
 */
export const REDO_STAGE_IDS: readonly string[] = ['1-1', '1-2', '1-3', '1-4', '1-A'];

export function redoEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  const p = new URLSearchParams(location.search);
  return p.get('desert') !== '0' && p.get('redo') === '1';
}

/** 这张图走重做版 */
export function redoStage(id: string): boolean {
  return REDO_STAGE_IDS.includes(id) && redoEnabled();
}
