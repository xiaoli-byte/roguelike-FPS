/**
 * 画质档参数表（Unity G/Core/QualityProfile.cs 照译，F4；docs/unity-parity.md 3.13「画质档」；docs/threejs-migration.md 4.7）。
 * 三档（低 / 中 / 高）与设置里的「画质」同名同档：一档 = 一行参数。「高」= Unity 工程里 PC_RPAsset / PC 画质级的原值，中、低只往下砍。
 *
 * 网页怎么用这张表（{@link webQuality}，Game.applySettings / resize 执行）：
 *   · renderScale → 渲染比例：像素比 = min(设备像素比, 这一档的上限) × renderScale（Unity 降分辨率后用 FSR 1.0 放大锐化，网页由浏览器双线性放大，不锐化）；
 *   · detailCullDistance / scatterCullFog → 距离剔除（core/CullLayers.ts）；
 *   · 其余列（MSAA、阴影距离 / 级联 / 精度、SSAO、闪光灯、粒子、贴花、状态外观、毛发、lodBias、mip、地形、Bloom）原样留在表里，
 *     由各自的系统在迁到的那一期读：后处理的 MSAA 采样数（render/PostStack：高 4 / 其余 2）、阴影（world/UnityEnvironment）、粒子与灯光池（M11b）、毛发（M11a）。
 *     现在这些系统还各自看 ctx.settings.quality === 'low' | 'high'，数值和表里不一样的地方列在 docs/threejs-migration.md 4.7。
 */
export type QualityLevel = 'low' | 'medium' | 'high';
export type FurTier = 'none' | 'fins' | 'shells';
export type UpscalingFilter = 'auto' | 'fsr';
export type SmaaQuality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  readonly level: QualityLevel;
  readonly label: string;
  // ── 分辨率 / 抗锯齿 ──
  /** 渲染比例（界面不受影响） */
  readonly renderScale: number;
  /** 放大滤镜：比例 < 1 时 FSR 1.0；= 1 时 auto（不放大） */
  readonly upscaling: UpscalingFilter;
  /** FSR 锐化强度（0..1） */
  readonly fsrSharpness: number;
  /** STP：始终 false（相机叠加下不生效） */
  readonly stp: boolean;
  /** MSAA 采样数（1 / 2 / 4） */
  readonly msaa: number;
  /** 主相机 SMAA 质量 */
  readonly smaa: SmaaQuality;
  // ── 阴影 / 光照 ──
  readonly shadowDistance: number;
  readonly shadowCascades: number;
  readonly shadowResolution: number;
  readonly softShadows: boolean;
  /** 附加光（点光 / 聚光）投影 */
  readonly additionalLightShadows: boolean;
  /** 同时亮着的闪光灯上限（FxLightPool） */
  readonly fxLights: number;
  /** 屏幕空间环境光遮蔽 */
  readonly ssao: boolean;
  // ── 粒子 ──
  /** 每层发射颗数的倍率 */
  readonly particleDensity: number;
  /** 同屏粒子总上限 */
  readonly particleCap: number;
  /** 每种粒子风格自己的上限倍率 */
  readonly styleCapScale: number;
  /** 弹孔 / 焦痕上限 */
  readonly decalCap: number;
  /** 状态外观全场每帧发射上限 */
  readonly statusEmitPerFrame: number;
  // ── 几何 / 贴图 ──
  readonly fur: FurTier;
  readonly lodBias: number;
  /** 贴图 mip 下限（0 = 原尺寸，1 = 一半） */
  readonly textureMipLimit: number;
  /** 地形细节（草、芦苇）密度倍率；1 = 不覆盖关卡设置 */
  readonly terrainDetailDensity: number;
  /** 地形细节最远距离（米）；0 = 不覆盖 */
  readonly terrainDetailDistance: number;
  /** 地形网格像素误差；0 = 不覆盖 */
  readonly terrainPixelError: number;
  /** 小件层的剔除距离（米） */
  readonly detailCullDistance: number;
  /** 散布层的剔除距离 = 雾终点 × 这个比例（1 = 雾完全吞掉之后才剔） */
  readonly scatterCullFog: number;
  // ── 后处理 ──
  /** Bloom 降到四分之一分辨率（否则沿用关卡的 Half） */
  readonly bloomQuarter: boolean;
  /** Bloom 最多迭代次数；0 = 不覆盖关卡 */
  readonly bloomMaxIterations: number;
}

export const QUALITY_LOW: QualityProfile = {
  level: 'low', label: '低',
  renderScale: 0.7, upscaling: 'fsr', fsrSharpness: 0.85, stp: false, msaa: 1, smaa: 'medium',
  shadowDistance: 45, shadowCascades: 1, shadowResolution: 1024, softShadows: false, additionalLightShadows: false, fxLights: 3, ssao: false,
  particleDensity: 0.45, particleCap: 1500, styleCapScale: 0.5, decalCap: 40, statusEmitPerFrame: 24,
  fur: 'none', lodBias: 1, textureMipLimit: 1, terrainDetailDensity: 0.5, terrainDetailDistance: 90, terrainPixelError: 6,
  detailCullDistance: 60, scatterCullFog: 0.65,
  bloomQuarter: true, bloomMaxIterations: 4,
};

export const QUALITY_MEDIUM: QualityProfile = {
  level: 'medium', label: '中',
  renderScale: 0.85, upscaling: 'fsr', fsrSharpness: 0.8, stp: false, msaa: 2, smaa: 'high',
  shadowDistance: 70, shadowCascades: 2, shadowResolution: 2048, softShadows: true, additionalLightShadows: false, fxLights: 6, ssao: true,
  particleDensity: 0.75, particleCap: 3000, styleCapScale: 0.75, decalCap: 80, statusEmitPerFrame: 48,
  fur: 'fins', lodBias: 1.5, textureMipLimit: 0, terrainDetailDensity: 0.75, terrainDetailDistance: 150, terrainPixelError: 4,
  detailCullDistance: 90, scatterCullFog: 0.85,
  bloomQuarter: false, bloomMaxIterations: 0,
};

/** = PC_RPAsset / PC 画质级的原值，关卡观感以它为准 */
export const QUALITY_HIGH: QualityProfile = {
  level: 'high', label: '高',
  renderScale: 1, upscaling: 'auto', fsrSharpness: 0.92, stp: false, msaa: 4, smaa: 'high',
  shadowDistance: 90, shadowCascades: 4, shadowResolution: 2048, softShadows: true, additionalLightShadows: true, fxLights: 8, ssao: true,
  particleDensity: 1, particleCap: 5000, styleCapScale: 1, decalCap: 140, statusEmitPerFrame: 80,
  fur: 'shells', lodBias: 2, textureMipLimit: 0, terrainDetailDensity: 1, terrainDetailDistance: 0, terrainPixelError: 0,
  detailCullDistance: 120, scatterCullFog: 1,
  bloomQuarter: false, bloomMaxIterations: 0,
};

/** 三档（低 → 高） */
export const QUALITY_PROFILES: readonly QualityProfile[] = [QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH];

/** 某一档的参数（认不出来的按高，同 Unity QualityProfile.For） */
export function qualityProfile(level: QualityLevel | string | number | null | undefined): QualityProfile {
  if (level === 'low' || level === 0) return QUALITY_LOW;
  if (level === 'medium' || level === 1) return QUALITY_MEDIUM;
  return QUALITY_HIGH;
}

/** 改了地形的哪些项（不覆盖的项保持关卡自己的设置；Unity TerrainOverrides） */
export function terrainOverrides(p: QualityProfile): { detailDensity: boolean; detailDistance: boolean; pixelError: boolean } {
  return { detailDensity: p.terrainDetailDensity < 0.999, detailDistance: p.terrainDetailDistance > 0, pixelError: p.terrainPixelError > 0 };
}

/** 一行说明（Unity QualityProfile.ToString；日志 / 调试用） */
export function describeQuality(p: QualityProfile): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return `${p.label}：渲染 ${n(p.renderScale)}×${p.renderScale < 0.999 ? ' FSR' : ''}、MSAA ${p.msaa}×、阴影 ${Math.round(p.shadowDistance)} m / ${p.shadowCascades} 级 / ${p.shadowResolution}${p.softShadows ? ' 软' : ' 硬'}`
    + `${p.additionalLightShadows ? ' + 附加光投影' : ''}、SSAO ${p.ssao ? '开' : '关'}、闪光灯 ${p.fxLights}、粒子 ${n(p.particleDensity)}× / 上限 ${p.particleCap}、毛发 ${p.fur}、`
    + `lodBias ${Math.round(p.lodBias * 10) / 10}、mip ${p.textureMipLimit}${p.bloomQuarter ? '、Bloom 1/4' : ''}`;
}

/**
 * 设备像素比上限（网页独有：Unity 的渲染比例乘在屏幕分辨率上，浏览器的「屏幕分辨率」还要先乘设备像素比）：
 * 高分屏上低档按 1×、中档最多 1.5×、高档最多 2× 起算，再乘这一档的渲染比例
 */
export const DEVICE_PIXEL_RATIO_CAP: Readonly<Record<QualityLevel, number>> = { low: 1, medium: 1.5, high: 2 };

/** 这一档的渲染像素比：min(设备像素比, 这一档的上限) × 渲染比例（普通屏 = 0.7 / 0.85 / 1） */
export function renderPixelRatio(p: QualityProfile, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, DEVICE_PIXEL_RATIO_CAP[p.level]) * p.renderScale;
}
