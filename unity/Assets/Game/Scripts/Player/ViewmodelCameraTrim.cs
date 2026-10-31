using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 枪模叠加相机的裁剪（第二批 E 路，docs/performance-unity.md「第一人称渲染」）：叠加相机只画 FirstPerson 层，但 URP 的渲染特性是按渲染器挂的，
    /// 它照样跑一遍 SSAO（为枪模单独做深度法线预通道 + 遮蔽 + 模糊）和屏幕空间贴花，还要一张深度图。这些对枪模没用：
    /// 枪模没有 SSAO 也几乎看不出（实测枪模区平均差 &lt; 1/255），贴花本来就不该投到枪上，第一人称层没有采样深度图的着色器。
    /// 所以渲染这类相机时（<see cref="IsViewmodel"/>：叠加相机、只渲染 FirstPerson 层）临时把 SSAO / 贴花特性关掉、渲染完原样还原，
    /// 并让它不要深度图（<see cref="UniversalAdditionalCameraData.requiresDepthOption"/> = Off；PlayerFactory 搭相机时已经写好，这里兜底旧场景里烘好的相机）。
    /// 主相机、画质档对 SSAO 的开关（<see cref="QualityProfile.ApplyTo"/>）都不受影响：只在这台相机的 begin / endCameraRendering 之间改，结束就还原。
    /// 世界画面逐像素不变（主相机和第二遍后处理照旧）。
    /// </summary>
    public static class ViewmodelCameraTrim
    {
        /// <summary>关掉时测对照用（playtest perf-fp）</summary>
        public static bool Disabled;

        static readonly List<ScriptableRendererFeature> switchedOff = new();
        static UniversalRenderPipelineAsset cachedAsset;
        static readonly List<ScriptableRendererFeature> trimmable = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Boot()
        {
            Disabled = false;
            switchedOff.Clear();
            cachedAsset = null;
            trimmable.Clear();
            RenderPipelineManager.beginCameraRendering -= Begin;
            RenderPipelineManager.beginCameraRendering += Begin;
            RenderPipelineManager.endCameraRendering -= End;
            RenderPipelineManager.endCameraRendering += End;
        }

        /// <summary>枪模相机：叠加相机，只渲染 FirstPerson 层</summary>
        public static bool IsViewmodel(Camera cam, out UniversalAdditionalCameraData data)
        {
            data = null;
            return cam && cam.cameraType == CameraType.Game && cam.cullingMask == 1 << Layers.FirstPerson
                   && cam.TryGetComponent(out data) && data.renderType == CameraRenderType.Overlay;
        }

        /// <summary>这台相机渲染时要临时关掉的特性：SSAO、屏幕空间贴花</summary>
        public static bool Trimmable(ScriptableRendererFeature f) => f is ScreenSpaceAmbientOcclusion or DecalRendererFeature;

        static void Begin(ScriptableRenderContext ctx, Camera cam)
        {
            if (Disabled || !IsViewmodel(cam, out var data)) return;
            if (Application.isPlaying && data.requiresDepthOption != CameraOverrideOption.Off) data.requiresDepthOption = CameraOverrideOption.Off;
            if (GraphicsSettings.currentRenderPipeline is not UniversalRenderPipelineAsset asset) return;
            if (asset != cachedAsset)
            {
                // 资产里的全部渲染器（本工程每个资产只有一个）：同 QualityProfile.FindSsao 的找法
                cachedAsset = asset;
                trimmable.Clear();
                foreach (var rd in asset.rendererDataList)
                    if (rd)
                        foreach (var f in rd.rendererFeatures)
                            if (f && Trimmable(f)) trimmable.Add(f);
            }
            switchedOff.Clear();
            foreach (var f in trimmable)
                if (f && f.isActive)
                {
                    f.SetActive(false);
                    switchedOff.Add(f);
                }
        }

        static void End(ScriptableRenderContext ctx, Camera cam)
        {
            if (switchedOff.Count == 0) return;
            foreach (var f in switchedOff)
                if (f) f.SetActive(true);
            switchedOff.Clear();
        }
    }
}
