// 离线采样用的英雄演出特效桩：特效（光柱、粒子、拖尾）用 canvas 贴图，与骨骼动作无关，全部空操作。
export function createShowFx() {
  return { bind() {}, update() {}, reset() {}, dispose() {} };
}
