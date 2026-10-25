using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 画质与显示设置的执行方（F4）：
    ///   画质：跟着 <see cref="ArtQuality.Changed"/>，把 <see cref="QualityProfile"/> 的一行写到当前 URP 资产（渲染比例、FSR、MSAA、阴影、SSAO）
    ///   和 QualitySettings（lodBias、贴图 mip、地形覆盖）上；三档都用 PC 画质级（目标级不存在——移动平台排除了 PC 级——就不切级，只改参数）。
    ///   显示：<see cref="GameSettings.DisplayMode"/> / 分辨率 / <see cref="GameSettings.VSync"/> / <see cref="GameSettings.FrameCap"/>。
    ///     垂直同步开着时帧率上限不生效（同 Unity：vSyncCount &gt; 0 时 targetFrameRate 被忽略）。
    ///     编辑器里不切全屏 / 分辨率（Game 视图由编辑器管），垂直同步只在独立程序生效（编辑器的 Game 视图有自己的 VSync 开关）。
    /// 只在 Play 时生效：编辑器里的毛发对比截图（FurReview）照样只看毛发。
    /// <b>编辑器里不弄脏共享资产</b>：第一次改某个 URP 资产 / 画质级前记下原值，退出 Play 时全部还原（连同进 Play 前的画质级），
    /// 所以 PC_RPAsset、PC_Renderer、ProjectSettings/QualitySettings 磁盘上永远是工程里的原值。
    /// </summary>
    public static class GraphicsQuality
    {
        /// <summary>画质参数写完之后（GameplayVolumes 跟着改相机抗锯齿和 Bloom 档）</summary>
        public static event Action<QualityProfile> Applied;

        /// <summary>最近一次写上去的画质档（还没写过 = null）</summary>
        public static QualityProfile AppliedProfile { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Applied = null;
            AppliedProfile = null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            ArtQuality.Changed -= Apply;
            ArtQuality.Changed += Apply;
            GameSettings.Changed -= OnSetting;
            GameSettings.Changed += OnSetting;
#if UNITY_EDITOR
            int editorLevel = QualitySettings.GetQualityLevel();
            void Restore(UnityEditor.PlayModeStateChange s)
            {
                if (s != UnityEditor.PlayModeStateChange.EnteredEditMode) return;
                UnityEditor.EditorApplication.playModeStateChanged -= Restore;
                ArtQuality.Changed -= Apply;
                GameSettings.Changed -= OnSetting;
                RestoreOriginals(editorLevel);
            }
            UnityEditor.EditorApplication.playModeStateChanged += Restore;
#endif
            Apply(ArtQuality.Level);
            ApplyDisplay();
        }

        static void OnSetting(SettingDef d)
        {
            if (d == null || d == GameSettings.DisplayMode || d == GameSettings.ResolutionWidth || d == GameSettings.ResolutionHeight
                || d == GameSettings.VSync || d == GameSettings.FrameCap)
                ApplyDisplay();
        }

        /// <summary>当前在用的 URP 资产（画质级的覆盖，没有就是图形设置里的默认）</summary>
        public static UniversalRenderPipelineAsset ActiveAsset =>
            (QualitySettings.renderPipeline ?? GraphicsSettings.defaultRenderPipeline) as UniversalRenderPipelineAsset;

        static void Apply(ArtQualityLevel level)
        {
            if (!Application.isPlaying) return;
            var p = QualityProfile.For(level);
            int target = Array.IndexOf(QualitySettings.names, "PC");
            if (target >= 0 && target != QualitySettings.GetQualityLevel())
            {
                RememberQuality();
                QualitySettings.SetQualityLevel(target, true);
            }
            var asset = ActiveAsset;
            if (asset)
            {
                RememberAsset(asset);
                p.ApplyTo(asset);
            }
            RememberQuality();
            p.ApplyToQualitySettings();
            AppliedProfile = p;
            var h = Applied;
            if (h != null)
                foreach (Action<QualityProfile> fn in h.GetInvocationList())
                    try { fn(p); }
                    catch (Exception e) { Debug.LogException(e); }
        }

        // ───────────── 显示：全屏 / 分辨率 / 垂直同步 / 帧率上限 ─────────────

        /// <summary>显示模式选项（与 <see cref="GameSettings.DisplayMode"/> 的下标一一对应）</summary>
        public static readonly FullScreenMode[] DisplayModes = { FullScreenMode.ExclusiveFullScreen, FullScreenMode.FullScreenWindow, FullScreenMode.Windowed };

        /// <summary>帧率上限选项（与 <see cref="GameSettings.FrameCap"/> 的下标一一对应；-1 = 不限）</summary>
        public static readonly int[] FrameCaps = { 30, 60, 90, 120, 144, 165, 240, -1 };

        /// <summary>按设置算出的目标帧率（垂直同步开着时 = -1，交给显示器）</summary>
        public static int TargetFrameRate(bool vsync, int capIndex) =>
            vsync ? -1 : FrameCaps[Mathf.Clamp(capIndex, 0, FrameCaps.Length - 1)];

        /// <summary>设置里存的分辨率；没存过（0）= 桌面分辨率</summary>
        public static Vector2Int SavedResolution
        {
            get
            {
                int w = Mathf.RoundToInt(GameSettings.ResolutionWidth.Value), h = Mathf.RoundToInt(GameSettings.ResolutionHeight.Value);
                if (w > 0 && h > 0) return new Vector2Int(w, h);
                var r = Screen.currentResolution;
                return new Vector2Int(r.width, r.height);
            }
        }

        public static FullScreenMode SavedDisplayMode => DisplayModes[Mathf.Clamp(GameSettings.DisplayMode.Index, 0, DisplayModes.Length - 1)];

        /// <summary>把显示设置写出去（Play 时）</summary>
        public static void ApplyDisplay()
        {
            if (!Application.isPlaying) return;
            bool vsync = GameSettings.VSync.Bool;
            Application.targetFrameRate = TargetFrameRate(vsync, GameSettings.FrameCap.Index);
            if (Application.isEditor) return;
            QualitySettings.vSyncCount = vsync ? 1 : 0;
            var res = SavedResolution;
            var mode = SavedDisplayMode;
            if (Screen.fullScreenMode != mode || Screen.width != res.x || Screen.height != res.y)
                Screen.SetResolution(res.x, res.y, mode);
        }

        // ───────────── 编辑器：记原值、退出 Play 时还原 ─────────────

        struct AssetState
        {
            public float renderScale, shadowDistance, fsrSharpness;
            public UpscalingFilterSelection upscaling;
            public bool fsrOverride, softShadows, additionalShadows, ssao, hasSsao;
            public int msaa, cascades, shadowRes;
        }

        struct LevelState
        {
            public float lodBias, detailDensity, detailDistance, pixelError;
            public int mipLimit;
            public TerrainQualityOverrides terrain;
        }

        static readonly Dictionary<UniversalRenderPipelineAsset, AssetState> assets = new();
        static readonly Dictionary<int, LevelState> levels = new();

        static void RememberAsset(UniversalRenderPipelineAsset a)
        {
            if (!Application.isEditor || assets.ContainsKey(a)) return;
            var ao = QualityProfile.FindSsao(a);
            assets[a] = new AssetState
            {
                renderScale = a.renderScale, upscaling = a.upscalingFilter, fsrOverride = a.fsrOverrideSharpness, fsrSharpness = a.fsrSharpness,
                msaa = a.msaaSampleCount, shadowDistance = a.shadowDistance, cascades = a.shadowCascadeCount, shadowRes = a.mainLightShadowmapResolution,
                softShadows = a.supportsSoftShadows, additionalShadows = a.supportsAdditionalLightShadows, hasSsao = ao, ssao = ao && ao.isActive,
            };
        }

        static void RememberQuality()
        {
            int i = QualitySettings.GetQualityLevel();
            if (!Application.isEditor || levels.ContainsKey(i)) return;
            levels[i] = new LevelState
            {
                lodBias = QualitySettings.lodBias, mipLimit = QualitySettings.globalTextureMipmapLimit, terrain = QualitySettings.terrainQualityOverrides,
                detailDensity = QualitySettings.terrainDetailDensityScale, detailDistance = QualitySettings.terrainDetailDistance, pixelError = QualitySettings.terrainPixelError,
            };
        }

        static void RestoreOriginals(int editorLevel)
        {
            foreach (var (a, s) in assets)
            {
                if (!a) continue;
                a.renderScale = s.renderScale;
                a.upscalingFilter = s.upscaling;
                a.fsrOverrideSharpness = s.fsrOverride;
                a.fsrSharpness = s.fsrSharpness;
                a.msaaSampleCount = s.msaa;
                a.shadowDistance = s.shadowDistance;
                a.shadowCascadeCount = s.cascades;
                a.mainLightShadowmapResolution = s.shadowRes;
                QualityProfile.SetSoftShadows(a, s.softShadows);
                QualityProfile.SetAdditionalLightShadows(a, s.additionalShadows);
                if (s.hasSsao && QualityProfile.FindSsao(a) is { } ao) ao.SetActive(s.ssao);
            }
            assets.Clear();
            foreach (var (i, s) in levels)
            {
                if (i < 0 || i >= QualitySettings.count) continue;
                QualitySettings.SetQualityLevel(i, false);
                QualitySettings.lodBias = s.lodBias;
                QualitySettings.globalTextureMipmapLimit = s.mipLimit;
                QualitySettings.terrainQualityOverrides = s.terrain;
                QualitySettings.terrainDetailDensityScale = s.detailDensity;
                QualitySettings.terrainDetailDistance = s.detailDistance;
                QualitySettings.terrainPixelError = s.pixelError;
            }
            levels.Clear();
            if (QualitySettings.GetQualityLevel() != editorLevel) QualitySettings.SetQualityLevel(editorLevel, true);
            Application.targetFrameRate = -1;
            AppliedProfile = null;
        }
    }
}
