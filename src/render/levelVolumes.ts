/**
 * 各关的后处理 Volume（URP Volume 的网页版数据；参数语义、单位和混合规则见 UrpVolume.ts，用法见 PostScene.ts）。
 *
 * 2026-11-26 从 Unity 关卡导出的 volumes.json 一次性转来，之后这里就是唯一来源，直接改这张表：
 *   · profiles：Volume Profile，键是短名；Unity 里每张图各拷一份、内容相同的几份合成了一份（注释里写着哪几张图在用；组件的先后不影响混合）。
 *     每个组件只列勾了 override 的参数，active = false 的组件整个不起作用；
 *   · scenes：每张图摆的 Volume（全局 / 局部、优先级、权重、混合距离；局部 Volume 的盒子是网页坐标）；
 *   · pipeline：调色 LUT 的模式和尺寸等（照原工程的渲染管线设置）。
 * 没有条目的图用本章基准图的全局 Volume（{@link levelVolumeScene}），后处理照常接管。
 * 写成 TS 模块而不是 JSON：node --test 的加载器不认不带 import attribute 的 JSON。
 */
import type { SceneVolumeData, VolumesDocument } from './UrpVolume';

export const LEVEL_VOLUMES: VolumesDocument = {
  pipeline: { colorGradingMode: 'LowDynamicRange', lutSize: 32, hdr: true, msaa: 4 },
  profiles: {
    // 1-1、1-2、1-3、1-4、1-A
    'desert': {
      Tonemapping: { active: true, mode: 1 },
      Bloom: { active: true, threshold: 1, intensity: 0.496, scatter: 0.65, clamp: 65472, tint: [1, 0.9, 0.78, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      ColorAdjustments: { active: true, postExposure: -0.919, contrast: 24.4, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: -11 },
      WhiteBalance: { active: true, temperature: -9.5, tint: -0.5 },
      LiftGammaGain: { active: true, lift: [1, 1, 1, -0.007], gamma: [1, 1, 1, 0.258], gain: [1, 1, 1, -0.084] },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.276, smoothness: 0.45, rounded: false },
      FirstPersonExposure: { active: true, multiplier: 2.755, gamma: 1.2, effects: 1.3, effectsSaturation: 1.15, flash: 1 },
    },
    // 2-1、2-2、2-3、2-4、2-A
    'frost': {
      Tonemapping: { active: true, mode: 1 },
      Bloom: { active: true, threshold: 1, intensity: 0.311, scatter: 0.65, clamp: 65472, tint: [0.85, 0.93, 1, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      ColorAdjustments: { active: true, postExposure: -0.827, contrast: 17.2, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: -6.1 },
      WhiteBalance: { active: true, temperature: -21.8, tint: 3.6 },
      LiftGammaGain: { active: true, lift: [1, 1, 1, -0.004], gamma: [1, 1, 1, 0.111], gain: [1, 1, 1, -0.107] },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.278, smoothness: 0.45, rounded: false },
      FirstPersonExposure: { active: true, multiplier: 2.86, gamma: 1.2, effects: 1.4, effectsSaturation: 1.15, flash: 1 },
    },
    // 2-A
    'crevasse-look': {
      ColorAdjustments: { active: true, postExposure: -0.62, contrast: 23, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 0 },
      ShadowsMidtonesHighlights: { active: true, shadows: [1, 1.02, 1.06, 0.06], midtones: [1, 1, 1, 0], highlights: [1, 1, 1, -0.04], shadowsStart: 0, shadowsEnd: 0.3, highlightsStart: 0.55, highlightsEnd: 1 },
    },
    // 3-1、3-2、3-3、3-4、3-A
    'inferno': {
      Tonemapping: { active: true, mode: 1 },
      Bloom: { active: true, threshold: 1.05, intensity: 0.55, scatter: 0.65, clamp: 65472, tint: [1, 0.78, 0.55, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      ColorAdjustments: { active: true, postExposure: 0.25, contrast: 30, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 4 },
      WhiteBalance: { active: true, temperature: -4, tint: 3 },
      LiftGammaGain: { active: true, lift: [1, 1, 1, 0.01], gamma: [1, 1, 1, 0], gain: [1, 1, 1, 0] },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.22, smoothness: 0.45, rounded: false },
      FirstPersonExposure: { active: true, multiplier: 2, gamma: 1.08, effects: 1.1, effectsSaturation: 1, flash: 1 },
    },
    // 3-3
    'fire-god-throne': {
      ColorAdjustments: { active: true, contrast: 26, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 10 },
      WhiteBalance: { active: true, temperature: 12, tint: 2 },
      Bloom: { active: true, threshold: 0.95, intensity: 0.95, scatter: 0.7, clamp: 65472, tint: [1, 1, 1, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.25, smoothness: 0.48, rounded: false },
    },
    // 4-1
    'plateau': {
      Tonemapping: { active: true, mode: 1 },
      Bloom: { active: true, threshold: 1, intensity: 0.45, scatter: 0.65, clamp: 65472, tint: [0.95, 0.97, 1, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      ColorAdjustments: { active: true, postExposure: -0.35, contrast: 20, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 0 },
      WhiteBalance: { active: true, temperature: -14, tint: 6 },
      LiftGammaGain: { active: true, lift: [1, 1, 1, 0], gamma: [1, 1, 1, 0], gain: [1, 1, 1, 0] },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.18, smoothness: 0.45, rounded: false },
      FirstPersonExposure: { active: true, multiplier: 1, gamma: 1, effects: 1, effectsSaturation: 1, flash: 1 },
    },
    // 4-3
    'larch-lake': {
      Tonemapping: { active: true, mode: 1 },
      Bloom: { active: true, threshold: 1.1, intensity: 0.35, scatter: 0.65, clamp: 65472, tint: [1, 0.97, 0.92, 1], highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0 },
      ColorAdjustments: { active: true, postExposure: -0.2, contrast: 16, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 8 },
      WhiteBalance: { active: true, temperature: 3, tint: 0 },
      LiftGammaGain: { active: true, lift: [1, 1, 1, 0], gamma: [1, 1, 1, 0], gain: [1, 1, 1, 0] },
      Vignette: { active: true, color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0.16, smoothness: 0.45, rounded: false },
      FirstPersonExposure: { active: true, multiplier: 1, gamma: 1, effects: 1, effectsSaturation: 1, flash: 1 },
    },
  },
  scenes: {
    '1-1': { volumes: [{ name: 'Global Volume', profile: 'desert', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '1-2': { volumes: [{ name: 'Global Volume', profile: 'desert', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '1-3': { volumes: [{ name: 'Global Volume', profile: 'desert', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '1-4': { volumes: [{ name: 'Global Volume', profile: 'desert', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '2-1': { volumes: [{ name: 'Global Volume', profile: 'frost', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '2-2': { volumes: [{ name: 'Global Volume', profile: 'frost', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '2-3': { volumes: [{ name: 'Global Volume', profile: 'frost', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '2-4': { volumes: [{ name: 'Global Volume', profile: 'frost', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '3-1': { volumes: [{ name: 'Global Volume', profile: 'inferno', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '3-2': { volumes: [{ name: 'Global Volume', profile: 'inferno', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '3-3': {
      volumes: [
        { name: 'Local Volume · 火神王座', profile: 'fire-god-throne', global: false, priority: 20, weight: 1, blendDistance: 48, boxes: [{ center: [-152, 28, 164], halfSize: [68, 50, 68], rotation: [0, 0, 0, 1] }] },
        { name: 'Global Volume', profile: 'inferno', global: true, priority: 0, weight: 1, blendDistance: 0 },
      ],
    },
    '3-4': { volumes: [{ name: 'Global Volume', profile: 'inferno', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '4-1': { volumes: [{ name: 'Global Volume', profile: 'plateau', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '4-3': { volumes: [{ name: 'Global Volume', profile: 'larch-lake', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '1-A': { volumes: [{ name: 'Global Volume', profile: 'desert', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
    '2-A': {
      volumes: [
        { name: 'Global Volume', profile: 'frost', global: true, priority: 0, weight: 1, blendDistance: 0 },
        { name: 'Local Look Volume（2-A）', profile: 'crevasse-look', global: true, priority: 5, weight: 1, blendDistance: 0 },
      ],
    },
    '3-A': { volumes: [{ name: 'Global Volume', profile: 'inferno', global: true, priority: 0, weight: 1, blendDistance: 0 }] },
  },
};

/** 每章的基准图：没有自己条目的图（新图、备选图）先用它的全局 Volume */
export const CHAPTER_BASE_SCENE: Readonly<Record<number, string>> = { 1: '1-1', 2: '2-1', 3: '3-1', 4: '4-1' };

/**
 * 关卡 id 的 Volume：有自己的条目就用自己的；没有就用本章基准图的全局 Volume（局部 Volume 的盒子是那张图的坐标，不带过来）。
 * id 不是「章-关」的形式、或者本章没有基准图 = null（后处理不接管）。source = 实际用的是哪张图的条目。
 */
export function levelVolumeScene(id: string): { scene: SceneVolumeData; source: string } | null {
  const own = LEVEL_VOLUMES.scenes[id];
  if (own) return { scene: own, source: id };
  const chapter = /^(\d+)-/.exec(id)?.[1];
  const base = chapter ? CHAPTER_BASE_SCENE[Number(chapter)] : undefined;
  const scene = base ? LEVEL_VOLUMES.scenes[base] : undefined;
  return base && scene ? { scene: { volumes: scene.volumes.filter(v => v.global) }, source: base } : null;
}
