using System.Reflection;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>毛发档（只是把 <see cref="ArtQuality"/> 的规则写进画质表，便于汇报和测试；实际由 ArtQuality / FurShells 执行）</summary>
    public enum FurTier { None, Fins, Shells }

    /// <summary>
    /// 画质档参数表（F4；docs/unity-parity.md 3.13「画质档」）。三档（低 / 中 / 高）与设置里的「画质」同名同档，档位本身仍存在 <see cref="ArtQuality"/>。
    /// 一档 = 一行参数，<see cref="GraphicsQuality"/> 在 Play 时把它写到当前 URP 资产与 QualitySettings 上，FX 预算（<see cref="FxBudget"/>、
    /// <see cref="Fx.Density"/>、<see cref="FxLightPool.Capacity"/>）直接读这里，毛发跟着 ArtQuality。
    /// <para>「高」= 工程里 PC_RPAsset / PC 画质级的原值（关卡观感以它为准，雪地 / 熔岩着色器都是在这一档调的），中、低只往下砍。</para>
    /// <para>取舍：</para>
    /// <list type="bullet">
    /// <item>三档都用 PC 资产（Forward+）。以前「低」切 Mobile 资产，但 Mobile 不出深度图：熔岩、预警圈、弹孔贴花都要采样场景深度，在低档会坏；
    ///   Forward 每物体 4 盏灯的上限也会吞掉闪光灯池。Mobile 资产留给真正的移动平台。</item>
    /// <item>不用 STP：URP 的 TAA / STP 要求基础相机没有叠加相机，我们的枪模是叠加相机（Viewmodel Camera），开了也不生效。
    ///   降分辨率的档改用 FSR 1.0（空间放大 + RCAS 锐化，支持相机叠加）。UI Toolkit 不受渲染比例影响，始终原生分辨率。</item>
    /// <item>后处理不整体关：色调映射是关卡观感的一部分，关了 HDR 直接过曝。低档只把 Bloom 降到四分之一分辨率、少迭代，关掉 SSAO。</item>
    /// <item>地形：基础图距离不动（关卡故意设 2000 m，保证始终走自定义地形着色器），只降细节密度 / 距离和像素误差。</item>
    /// </list>
    /// </summary>
    public sealed class QualityProfile
    {
        public ArtQualityLevel level;
        public string label;

        // ── 分辨率 / 抗锯齿 ──
        /// <summary>渲染比例（UI 不受影响）</summary>
        public float renderScale;
        /// <summary>放大滤镜：比例 &lt; 1 时用 FSR 1.0；= 1 时 Auto（不放大）</summary>
        public UpscalingFilterSelection upscaling;
        /// <summary>FSR 锐化强度（0..1，只在 FSR 时有意义）</summary>
        public float fsrSharpness;
        /// <summary>STP：始终 false（见类注释：相机叠加下不生效）</summary>
        public bool stp;
        /// <summary>MSAA 采样数（1 / 2 / 4）</summary>
        public int msaa;
        /// <summary>主相机 SMAA 质量</summary>
        public AntialiasingQuality smaa;

        // ── 阴影 / 光照 ──
        public float shadowDistance;
        public int shadowCascades;
        public int shadowResolution;
        public bool softShadows;
        /// <summary>附加光（点光 / 聚光）投影</summary>
        public bool additionalLightShadows;
        /// <summary>同时亮着的闪光灯上限（FxLightPool；Forward+ 没有每物体灯数上限，「灯数」就是这个）</summary>
        public int fxLights;
        /// <summary>屏幕空间环境光遮蔽（PC 渲染器上的 SSAO 特性）</summary>
        public bool ssao;

        // ── 粒子（FX1 / FX2 预算）──
        /// <summary>每层发射颗数的倍率</summary>
        public float particleDensity;
        /// <summary>同屏粒子总上限</summary>
        public int particleCap;
        /// <summary>每种粒子风格自己的上限倍率</summary>
        public float styleCapScale;
        /// <summary>弹孔 / 焦痕上限</summary>
        public int decalCap;
        /// <summary>状态外观全场每帧发射上限</summary>
        public int statusEmitPerFrame;

        // ── 几何 / 贴图 ──
        public FurTier fur;
        public float lodBias;
        /// <summary>贴图 mip 下限（0 = 原尺寸，1 = 一半）</summary>
        public int textureMipLimit;
        /// <summary>地形细节（草、芦苇）密度倍率；1 = 不覆盖关卡设置</summary>
        public float terrainDetailDensity;
        /// <summary>地形细节最远距离（米）；0 = 不覆盖</summary>
        public float terrainDetailDistance;
        /// <summary>地形网格像素误差；0 = 不覆盖</summary>
        public float terrainPixelError;

        // ── 后处理 ──
        /// <summary>Bloom 降到四分之一分辨率（否则沿用关卡的 Half）</summary>
        public bool bloomQuarter;
        /// <summary>Bloom 最多迭代次数；0 = 不覆盖关卡</summary>
        public int bloomMaxIterations;

        public static readonly QualityProfile Low = new()
        {
            level = ArtQualityLevel.Low, label = "低",
            renderScale = 0.7f, upscaling = UpscalingFilterSelection.FSR, fsrSharpness = 0.85f, msaa = 1, smaa = AntialiasingQuality.Medium,
            shadowDistance = 45, shadowCascades = 1, shadowResolution = 1024, softShadows = false, additionalLightShadows = false, fxLights = 3, ssao = false,
            particleDensity = 0.45f, particleCap = 1500, styleCapScale = 0.5f, decalCap = 40, statusEmitPerFrame = 24,
            fur = FurTier.None, lodBias = 1f, textureMipLimit = 1, terrainDetailDensity = 0.5f, terrainDetailDistance = 90, terrainPixelError = 6,
            bloomQuarter = true, bloomMaxIterations = 4,
        };

        public static readonly QualityProfile Medium = new()
        {
            level = ArtQualityLevel.Medium, label = "中",
            renderScale = 0.85f, upscaling = UpscalingFilterSelection.FSR, fsrSharpness = 0.8f, msaa = 2, smaa = AntialiasingQuality.High,
            shadowDistance = 70, shadowCascades = 2, shadowResolution = 2048, softShadows = true, additionalLightShadows = false, fxLights = 6, ssao = true,
            particleDensity = 0.75f, particleCap = 3000, styleCapScale = 0.75f, decalCap = 80, statusEmitPerFrame = 48,
            fur = FurTier.Fins, lodBias = 1.5f, textureMipLimit = 0, terrainDetailDensity = 0.75f, terrainDetailDistance = 150, terrainPixelError = 4,
            bloomQuarter = false, bloomMaxIterations = 0,
        };

        /// <summary>= PC_RPAsset / PC 画质级的原值（EditMode 测试核对），关卡观感以它为准</summary>
        public static readonly QualityProfile High = new()
        {
            level = ArtQualityLevel.High, label = "高",
            renderScale = 1f, upscaling = UpscalingFilterSelection.Auto, fsrSharpness = 0.92f, msaa = 4, smaa = AntialiasingQuality.High,
            shadowDistance = 90, shadowCascades = 4, shadowResolution = 2048, softShadows = true, additionalLightShadows = true, fxLights = 8, ssao = true,
            particleDensity = 1f, particleCap = 5000, styleCapScale = 1f, decalCap = 140, statusEmitPerFrame = 80,
            fur = FurTier.Shells, lodBias = 2f, textureMipLimit = 0, terrainDetailDensity = 1f, terrainDetailDistance = 0, terrainPixelError = 0,
            bloomQuarter = false, bloomMaxIterations = 0,
        };

        public static QualityProfile For(ArtQualityLevel l) => l switch
        {
            ArtQualityLevel.Low => Low,
            ArtQualityLevel.Medium => Medium,
            _ => High,
        };

        /// <summary>当前画质档</summary>
        public static QualityProfile Current => For(ArtQuality.Level);

        /// <summary>三档（低 → 高）</summary>
        public static readonly QualityProfile[] All = { Low, Medium, High };

        /// <summary>改了地形的哪些项（不覆盖的项保持关卡自己的设置）</summary>
        public TerrainQualityOverrides TerrainOverrides =>
            (terrainDetailDensity < 0.999f ? TerrainQualityOverrides.DetailDensity : 0)
            | (terrainDetailDistance > 0 ? TerrainQualityOverrides.DetailDistance : 0)
            | (terrainPixelError > 0 ? TerrainQualityOverrides.PixelError : 0);

        public override string ToString() =>
            $"{label}：渲染 {renderScale:0.##}×{(renderScale < 0.999f ? " FSR" : "")}、MSAA {msaa}×、阴影 {shadowDistance:0} m / {shadowCascades} 级 / {shadowResolution}{(softShadows ? " 软" : " 硬")}" +
            $"{(additionalLightShadows ? " + 附加光投影" : "")}、SSAO {(ssao ? "开" : "关")}、闪光灯 {fxLights}、粒子 {particleDensity:0.##}× / 上限 {particleCap}、毛发 {fur}、" +
            $"lodBias {lodBias:0.#}、mip {textureMipLimit}{(bloomQuarter ? "、Bloom 1/4" : "")}";

        // ───────────── 写到 URP 资产上 ─────────────

        static readonly FieldInfo SoftShadowsField = typeof(UniversalRenderPipelineAsset).GetField("m_SoftShadowsSupported", BindingFlags.Instance | BindingFlags.NonPublic);
        static readonly PropertyInfo AdditionalShadowsProp = typeof(UniversalRenderPipelineAsset).GetProperty("supportsAdditionalLightShadows");

        /// <summary>软阴影开关（URP 的 setter 是 internal）</summary>
        public static bool GetSoftShadows(UniversalRenderPipelineAsset a) => a.supportsSoftShadows;

        public static void SetSoftShadows(UniversalRenderPipelineAsset a, bool on)
        {
            if (SoftShadowsField != null) SoftShadowsField.SetValue(a, on);
        }

        public static void SetAdditionalLightShadows(UniversalRenderPipelineAsset a, bool on)
        {
            var set = AdditionalShadowsProp?.GetSetMethod(true);
            if (set != null) set.Invoke(a, new object[] { on });
        }

        /// <summary>资产上的 SSAO 特性（默认渲染器的；没有则 null）</summary>
        public static ScriptableRendererFeature FindSsao(UniversalRenderPipelineAsset a)
        {
            if (!a) return null;
            foreach (var data in a.rendererDataList)
            {
                if (!data) continue;
                foreach (var f in data.rendererFeatures)
                    if (f is ScreenSpaceAmbientOcclusion) return f;
            }
            return null;
        }

        /// <summary>把这一档写到 URP 资产上（只改内存里的值；编辑器里由 GraphicsQuality 在退出 Play 时还原）</summary>
        public void ApplyTo(UniversalRenderPipelineAsset a)
        {
            if (!a) return;
            a.renderScale = renderScale;
            a.upscalingFilter = renderScale < 0.999f ? upscaling : UpscalingFilterSelection.Auto;
            a.fsrOverrideSharpness = renderScale < 0.999f;
            a.fsrSharpness = fsrSharpness;
            a.msaaSampleCount = msaa;
            a.shadowDistance = shadowDistance;
            a.shadowCascadeCount = shadowCascades;
            a.mainLightShadowmapResolution = shadowResolution;
            SetSoftShadows(a, softShadows);
            SetAdditionalLightShadows(a, additionalLightShadows);
            var ao = FindSsao(a);
            if (ao) ao.SetActive(ssao);
        }

        /// <summary>写 QualitySettings（当前画质级）：lodBias、贴图 mip、地形覆盖</summary>
        public void ApplyToQualitySettings()
        {
            QualitySettings.lodBias = lodBias;
            QualitySettings.globalTextureMipmapLimit = textureMipLimit;
            var t = TerrainOverrides;
            QualitySettings.terrainQualityOverrides = t;
            if ((t & TerrainQualityOverrides.DetailDensity) != 0) QualitySettings.terrainDetailDensityScale = terrainDetailDensity;
            if ((t & TerrainQualityOverrides.DetailDistance) != 0) QualitySettings.terrainDetailDistance = terrainDetailDistance;
            if ((t & TerrainQualityOverrides.PixelError) != 0) QualitySettings.terrainPixelError = terrainPixelError;
        }
    }
}
