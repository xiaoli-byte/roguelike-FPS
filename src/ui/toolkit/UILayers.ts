/**
 * 界面的四层（照译 Unity G/UI/Toolkit/UILayers.cs）。每层一个面板，按 sortingOrder 叠：
 *   Hud      战斗 HUD、伤害数字、头顶血条
 *   Overlay  横幅、全屏闪光、中央大字这类不接输入的叠层
 *   Modal    由 UIRouter 管的界面（暂停、设置、三选一、菜单…）
 *   Toast    提示队列，最上面是黑幕（换关时盖住一切）
 * 缩放：四层都按参考分辨率 1920×1080、Expand 缩放——倍率 = min(宽 / 1920, 高 / 1080)，面板逻辑尺寸在任何分辨率下都不小于 1920×1080，
 * 按 1920×1080 写的样式（src/ui/css/screens/*.css）在哪个分辨率下都一样排版。
 *
 * 本文件不 import 任何模块（测试按 data: URL 直接加载）。
 */

export const UILayer = { Hud: 0, Overlay: 1, Modal: 2, Toast: 3 } as const;
export type UILayer = (typeof UILayer)[keyof typeof UILayer];

export const LAYER_COUNT = 4;
/** 设计分辨率：USS / CSS 里的像素值都按 1920×1080 写 */
export const REFERENCE_RESOLUTION = { x: 1920, y: 1080 } as const;

const NAMES = ['Hud', 'Overlay', 'Modal', 'Toast'] as const;
const ORDERS = [0, 100, 200, 300] as const;

/** 全部层（从下到上） */
export const ALL_LAYERS: readonly UILayer[] = [UILayer.Hud, UILayer.Overlay, UILayer.Modal, UILayer.Toast];

export function layerName(layer: UILayer): string {
  return NAMES[layer];
}

/** PanelSettings.sortingOrder：大的画在上面、先收到输入（网页换成层容器的 z-index 次序） */
export function sortingOrder(layer: UILayer): number {
  return ORDERS[layer];
}

/** 只有界面层接鼠标 / 手柄；其余层所有元素都不挡点击 */
export function interactive(layer: UILayer): boolean {
  return layer === UILayer.Modal;
}

/** 面板在 width×height 屏幕上的缩放倍率（Expand：min(宽 / 1920, 高 / 1080)）；屏幕像素 ÷ 它 = 面板逻辑尺寸 */
export function layerScale(width: number, height: number): number {
  const s = Math.min(width / REFERENCE_RESOLUTION.x, height / REFERENCE_RESOLUTION.y);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** 面板逻辑尺寸（设计像素）：两边都不小于 1920×1080 */
export function panelSize(width: number, height: number): { x: number; y: number; scale: number } {
  const scale = layerScale(width, height);
  return { x: width / scale, y: height / scale, scale };
}
