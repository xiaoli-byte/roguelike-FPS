using NUnit.Framework;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// I4 渲染性能设置（docs/performance-unity.md「GPU 常驻绘制与 GPU 遮挡剔除」）：
    ///   PC 管线不开 GPU Resident Drawer、不开 GPU 遮挡剔除——两台机器实测 GPU 上没收益（RTX 5090 Laptop：GPU P50 2.98 对 3.06 ms，噪声内；
    ///   RTX 3070：绘制调用、三角面基本不降），主线程反而贵 0.6–2 ms，而这个项目的瓶颈在主线程；GRD 也不认按图层的剔除距离（CullLayers）。
    ///   要重新对照用 playtest perf-grd，在打包的游戏里复测之前不改这里。
    ///   BatchRendererGroup 变体回到默认（有 Entities Graphics 才保留）：GRD 关着就不用 Keep All，打包少编一批 DOTS 实例化变体。
    ///   以后要开 GRD 的前提仍然守着：渲染路径是 Forward+，关卡主材质的着色器带 DOTS 实例化（SF_StylizedLit 含 DOTS.hlsl），SRP Batcher 开着。
    /// 这些设置由 ShowcaseSceneBuilder.ConfigureProject 写入（每次生成关卡重申）。
    /// </summary>
    public sealed class RenderPerfSettingsTests
    {
        [Test]
        public void PcPipeline_GpuResidentDrawerAndOcclusionOff()
        {
            var pc = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/PC_RPAsset.asset");
            Assert.IsNotNull(pc, "PC_RPAsset 不在了？");
            Assert.AreEqual(GPUResidentDrawerMode.Disabled, pc.gpuResidentDrawerMode, "PC 管线不开 GPU Resident Drawer（实测主线程更贵、GPU 没收益）");
            Assert.IsFalse(pc.gpuResidentDrawerEnableOcclusionCullingInCameras, "PC 管线不开 GPU 遮挡剔除");
            Assert.IsTrue(pc.useSRPBatcher, "SRP Batcher 开着");
            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/Settings/PC_Renderer.asset");
            Assert.IsNotNull(renderer, "PC_Renderer 不在了？");
            Assert.AreEqual(RenderingMode.ForwardPlus, renderer.renderingMode, "Forward+（以后要开 GRD 的前提，也是闪光灯池不受每物体灯数限制的前提）");
        }

        [Test]
        public void BatchRendererGroupVariants_Default() =>
            Assert.AreEqual(BatchRendererGroupStrippingMode.KeepIfEntitiesGraphics, EditorGraphicsSettings.batchRendererGroupShaderStrippingMode,
                "GRD 关着时 BatchRendererGroup Variants 回到默认，不保留 DOTS 实例化变体");

        [Test]
        public void StylizedLit_SupportsDotsInstancing()
        {
            string path = "Assets/Art/Shaders/SF_StylizedLit.shader";
            Assert.IsNotNull(AssetDatabase.LoadAssetAtPath<UnityEngine.Shader>(path), "SF_StylizedLit 不在了？");
            StringAssert.Contains("ShaderLibrary/DOTS.hlsl", System.IO.File.ReadAllText(path), "SF_StylizedLit 应包含 DOTS.hlsl（以后开 GRD 时接得住关卡几何）");
        }
    }
}
