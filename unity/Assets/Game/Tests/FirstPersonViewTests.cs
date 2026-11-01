using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第一人称渲染（第二批 E 路，docs/performance-unity.md「第一人称渲染」）：枪模不再是叠加相机。
    /// 主相机的相机栈是空的，枪模那台相机只提供投影参数（60°、近裁 0.01、远裁 20、只画 FirstPerson 层），由 <see cref="FirstPersonView"/> 在主相机里画、
    /// 和世界走同一遍后处理；对照用的 <see cref="FirstPersonView.LegacyOverlay"/> 能把它放回相机栈、再拿出来。
    /// </summary>
    public sealed class FirstPersonViewTests
    {
        GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root) Object.DestroyImmediate(root);
        }

        Camera Build()
        {
            root = new GameObject("FirstPersonViewTests");
            return PlayerFactory.CreateCamera(root.transform);
        }

        [Test]
        public void CreateCamera_ViewmodelIsNotStacked()
        {
            var main = Build();
            var data = main.GetUniversalAdditionalCameraData();
            Assert.AreEqual(CameraRenderType.Base, data.renderType);
            Assert.IsTrue(data.renderPostProcessing, "主相机做后处理（世界和枪模共用这一遍）");
            Assert.AreEqual(0, main.cullingMask & (1 << Layers.FirstPerson), "主相机自己不剔除 / 不画 FirstPerson 层");
            Assert.IsFalse(FirstPersonView.LegacyOverlay, "默认是单相机 + 枪模 pass");
            Assert.AreEqual(0, data.cameraStack.Count, "主相机的相机栈是空的（以前叠着枪模相机，世界被后处理两遍）");

            var vm = FirstPersonView.ViewCamera(main);
            Assert.IsNotNull(vm, "主相机下有枪模视图");
            Assert.IsNotNull(vm.GetComponent<FirstPersonView>());
            Assert.AreEqual(60f, vm.fieldOfView, 1e-4f, "枪模竖直视角 60°（Three.js 版 viewCamera）");
            Assert.AreEqual(0.01f, vm.nearClipPlane, 1e-6f);
            Assert.AreEqual(20f, vm.farClipPlane, 1e-4f);
            Assert.AreEqual(1 << Layers.FirstPerson, vm.cullingMask);
            var vd = vm.GetUniversalAdditionalCameraData();
            Assert.AreEqual(CameraRenderType.Overlay, vd.renderType, "保持叠加类型：不在相机栈里，URP 不会单独渲染它");
            Assert.IsFalse(vd.renderPostProcessing);
            Assert.AreEqual(main, vm.GetComponent<FirstPersonView>().Owner);
        }

        [Test]
        public void LegacyOverlay_PutsCameraBackAndTakesItOut()
        {
            var main = Build();
            var stack = main.GetUniversalAdditionalCameraData().cameraStack;
            var vm = FirstPersonView.ViewCamera(main);
            bool was = FirstPersonView.LegacyOverlay;
            try
            {
                FirstPersonView.LegacyOverlay = true;
                Assert.Contains(vm, stack, "对照模式：枪模相机回到相机栈");
                Assert.IsTrue(vm.GetUniversalAdditionalCameraData().renderPostProcessing, "对照模式：和以前一样，枪模相机再后处理一遍");
                FirstPersonView.LegacyOverlay = false;
                Assert.AreEqual(0, stack.Count);
                Assert.IsFalse(vm.GetUniversalAdditionalCameraData().renderPostProcessing);
            }
            finally
            {
                FirstPersonView.LegacyOverlay = was;
            }
        }

        [Test]
        public void ViewCamera_FindsLegacyOverlayToo()
        {
            root = new GameObject("FirstPersonViewTests");
            var main = new GameObject("Main Camera").AddComponent<Camera>();
            main.transform.SetParent(root.transform, false);
            var vm = new GameObject("Viewmodel Camera").AddComponent<Camera>();
            vm.transform.SetParent(main.transform, false);
            vm.cullingMask = 1 << Layers.FirstPerson;
            Assert.AreEqual(vm, FirstPersonView.ViewCamera(main), "旧场景里烘好的叠加枪模相机也认");
        }
    }
}
