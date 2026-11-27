// 离线采样用的 AssetLibrary 桩：不加载任何 GLB（美术挂载由 EnemyArt 桩按清单直接搭骨架）。
export const AssetLibrary = {
  enabled: false,
  unavailable: () => true,
  get: () => null,
  findBound: () => null,
  findAttachments: () => [],
  preload: async () => {},
};
