/**
 * 正式游戏的第四章改用网页原生的高原场景（src/world/plateau/stage/）：哪几张图、开没开。
 * 先用网址 `plateau=1` 打开（同第一章重做版的 `redo=1`），不带就照旧读 Unity 导出的场景。
 */
export const PLATEAU_STAGE_IDS: readonly string[] = ['4-1', '4-4'];

export function plateauEnabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('plateau') === '1';
}

/** 这张图走网页原生的高原场景 */
export function plateauStage(id: string): boolean {
  return PLATEAU_STAGE_IDS.includes(id) && plateauEnabled();
}
