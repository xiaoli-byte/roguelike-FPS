using NUnit.Framework;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// I4 渲染性能设置（docs/unity-parity.md I4，docs/performance.md「Unity 固定机位基线」）：
    ///   PC 管线开 GPU Resident Drawer（实例化绘制）和 GPU 遮挡剔除，渲染路径是 Forward+（GRD 的前提）；
    ///   BatchRendererGroup 变体 = Keep All（否则编辑器里 GRD 不启用，打包时 DOTS 实例化变体全被剥掉）；
    ///   关卡主材质的着色器带 DOTS 实例化（SF_StylizedLit 含 DOTS.hlsl），GRD 才接得住关卡几何。
    /// 移动端管线不开（GRD 在移动 GPU 上收益不稳，另测）。
    /// </summary>
    public sealed class RenderPerfSettingsTests
    {
        [Test]
        public void PcPipeline_UsesGpuResidentDrawerWithOcclusion()
        {
            var pc = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
            Assert.IsNotNull(pc, "PC_RPAsset 不在了？");
            Assert.AreEqual(GPUResidentDrawerMode.InstancedDrawing, pc.gpuResidentDrawerMode, "PC 管线应开 GPU Resident Drawer");
            Assert.IsTrue(pc.gpuResidentDrawerEnableOcclusionCullingInCameras, "PC 管线应开 GPU 遮挡剔除");
            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/Settings/PC_Renderer.asset");
            Assert.IsNotNull(renderer, "PC_Renderer 不在了？");
            Assert.AreEqual(RenderingMode.ForwardPlus, renderer.renderingMode, "GRD 要求 Forward+");
            Assert.IsTrue(pc.IsGPUResidentDrawerSupportedBySRP(out string why, out _), $"URP 不支持 GRD：{why}");
        }

        [Test]
        public void BatchRendererGroupVariants_KeepAll() =>
            Assert.AreEqual(BatchRendererGroupStrippingMode.KeepAll, EditorGraphicsSettings.batchRendererGroupShaderStrippingMode,
                "Graphics 设置的 BatchRendererGroup Variants 应为 Keep All");

        [Test]
        public void StylizedLit_SupportsDotsInstancing()
        {
            string path = "Assets/Art/Shaders/SF_StylizedLit.shader";
            Assert.IsNotNull(AssetDatabase.LoadAssetAtPath<UnityEngine.Shader>(path), "SF_StylizedLit 不在了？");
            StringAssert.Contains("ShaderLibrary/DOTS.hlsl", System.IO.File.ReadAllText(path), "SF_StylizedLit 应包含 DOTS.hlsl（DOTS 实例化变体）");
        }
    }
}
