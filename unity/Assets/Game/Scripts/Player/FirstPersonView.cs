using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 枪模视图（第二批 E 路，docs/performance-unity.md「第一人称渲染」）：取代原来叠在主相机上的枪模相机。
    /// 挂在「Viewmodel Camera」物体上（主相机的子物体）。那台 Camera 组件留着，只当投影参数和开关：竖直视角 60°、近裁 0.01、远裁 20、姿态跟着主相机
    /// （首领登场收枪时 BossIntroDirector 转它、停用它）；它不在主相机的相机栈里，URP 不会单独渲染它。
    /// 主相机开始渲染时（<see cref="RenderPipelineManager.beginCameraRendering"/>）按这台相机的视锥剔除 FirstPerson 层，往主相机的渲染器里插一个
    /// <see cref="Pass"/>：透明物体之后、后处理之前，清掉深度（不穿墙），用枪模的视角 / 近远裁剪画 FirstPerson 层的不透明 + 透明物体，再还原主相机的矩阵。
    /// 所以枪模、枪口火焰、碎刃、技能手和世界走同一遍后处理（以前世界被主相机和枪模相机各后处理一遍，见文档）。
    /// 和以前的枪模相机一致的地方：不接收阴影（那台相机不渲染阴影）、不吃 SSAO（屏幕空间遮蔽是世界的）、不受贴花影响、FOV 与主相机的 FOV 设置无关。
    /// 旧场景里烘好的「叠加枪模相机」在 Play 时自动迁移（从相机栈里拿掉、补挂本组件），编辑器里存的场景不动。
    /// </summary>
    [ExecuteAlways, DisallowMultipleComponent, RequireComponent(typeof(Camera))]
    public sealed class FirstPersonView : MonoBehaviour
    {
        /// <summary>对照用（playtest perf-fp）：true = 回到以前的叠加相机（枪模相机放回主相机的栈里、两遍后处理），本组件不画</summary>
        public static bool LegacyOverlay
        {
            get => legacyOverlay;
            set
            {
                if (legacyOverlay == value) return;
                legacyOverlay = value;
                foreach (var v in Active)
                    if (v) v.ApplyMode();
            }
        }

        static bool legacyOverlay;
        static readonly List<FirstPersonView> Active = new();
        static bool hooked;

        Camera view;
        Camera owner;
        Pass pass;

        /// <summary>
        /// 当前的第一人称曝光补偿（关卡 Volume 上的 <see cref="FirstPersonExposure"/>，主相机最近一次渲染时读的；没有 = 1）。
        /// SF_StylizedLit 由枪模 pass 的全局变量补；枪口火焰、刀光这类粒子 / 网格特效自己乘到颜色上
        /// </summary>
        public static float Exposure { get; private set; } = 1f;

        /// <summary>第一人称层粒子 / 网格特效的补偿（<see cref="FirstPersonExposure.effects"/>：刀光、刀上光点、枪口火焰的星芒）</summary>
        public static float EffectsExposure { get; private set; } = 1f;

        /// <summary>枪口火焰白芯的补偿 = <see cref="EffectsExposure"/> × <see cref="FirstPersonExposure.flash"/></summary>
        public static float FlashExposure { get; private set; } = 1f;

        /// <summary>枪口火焰颜色的饱和度补偿（<see cref="FirstPersonExposure.effectsSaturation"/>）</summary>
        public static float EffectsSaturation { get; private set; } = 1f;

        /// <summary>第一人称那份枪口火焰的颜色：绕亮度按 <see cref="EffectsSaturation"/> 拉饱和度，再乘 <see cref="EffectsExposure"/>（白芯 <see cref="FlashExposure"/>）。全部 1 时原样返回</summary>
        public static Color GradeEffect(Color c, bool hot)
        {
            float s = EffectsSaturation;
            if (!Mathf.Approximately(s, 1f))
            {
                float l = 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
                c.r = Mathf.Max(0, l + (c.r - l) * s);
                c.g = Mathf.Max(0, l + (c.g - l) * s);
                c.b = Mathf.Max(0, l + (c.b - l) * s);
            }
            float e = hot ? FlashExposure : EffectsExposure;
            return new Color(c.r * e, c.g * e, c.b * e, c.a);
        }

        static MaterialPropertyBlock exposureBlock;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        /// <summary>
        /// 第一人称层里用 URP 粒子着色器的特效（刀光、刀上光点）按 <see cref="EffectsExposure"/> 提亮：_BaseColor = (系数, 系数, 系数, 1)。
        /// 系数 1 时清掉属性块（输出和以前一样）。applied 记上一次写的值，没变就不写
        /// </summary>
        public static void ApplyExposure(Renderer r, ref float applied)
        {
            if (!r) return;
            float k = EffectsExposure;
            if (Mathf.Approximately(k, applied)) return;
            applied = k;
            if (Mathf.Approximately(k, 1f))
            {
                r.SetPropertyBlock(null);
                return;
            }
            exposureBlock ??= new MaterialPropertyBlock();
            exposureBlock.Clear();
            exposureBlock.SetColor(BaseColorId, new Color(k, k, k, 1f));
            r.SetPropertyBlock(exposureBlock);
        }

        /// <summary>枪模的投影参数（视角、近远裁剪、姿态）</summary>
        public Camera View => view;

        /// <summary>画它的主相机（父物体上的相机）</summary>
        public Camera Owner => owner;

        /// <summary>主相机下的枪模视图（没有 = null）</summary>
        public static FirstPersonView For(Camera main)
        {
            if (!main) return null;
            foreach (var v in Active)
                if (v && v.owner == main) return v;
            return main.GetComponentInChildren<FirstPersonView>(true);
        }

        /// <summary>主相机下的枪模相机（投影参数）：新做法是 <see cref="FirstPersonView"/> 所在的相机，旧场景是主相机子物体里只渲染 FirstPerson 层的相机</summary>
        public static Camera ViewCamera(Camera main)
        {
            if (!main) return null;
            var v = For(main);
            if (v) return v.GetComponent<Camera>();
            foreach (var c in main.GetComponentsInChildren<Camera>(true))
                if (c != main && c.cullingMask == 1 << Layers.FirstPerson) return c;
            return null;
        }

        /// <summary>把 cam 设成枪模视图：叠加相机类型（万一被放进相机栈也不会单独出图）、不进相机栈、补挂本组件</summary>
        public static FirstPersonView Setup(Camera cam)
        {
            if (!cam) return null;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderType = CameraRenderType.Overlay;
            data.renderShadows = false;
            data.renderPostProcessing = false;
            data.requiresDepthOption = CameraOverrideOption.Off;
            data.requiresColorOption = CameraOverrideOption.Off;
            var v = cam.GetComponent<FirstPersonView>();
            if (!v) v = cam.gameObject.AddComponent<FirstPersonView>();
            v.Bind();
            return v;
        }

        void OnEnable()
        {
            Bind();
            if (!Active.Contains(this)) Active.Add(this);
            Hook();
        }

        void OnDisable()
        {
            Active.Remove(this);
            Unstack();
        }

        void Bind()
        {
            view = GetComponent<Camera>();
            owner = transform.parent ? transform.parent.GetComponentInParent<Camera>() : null;
            ApplyMode();
        }

        /// <summary>按 <see cref="LegacyOverlay"/> 把枪模相机放进 / 拿出主相机的相机栈</summary>
        void ApplyMode()
        {
            if (!owner || !view) return;
            var vd = view.GetUniversalAdditionalCameraData();
            if (legacyOverlay && isActiveAndEnabled)
            {
                var stack = owner.GetUniversalAdditionalCameraData().cameraStack;
                vd.renderPostProcessing = true;
                if (stack != null && !stack.Contains(view)) stack.Add(view);
            }
            else
            {
                Unstack();
                vd.renderPostProcessing = false;
            }
        }

        void Unstack()
        {
            if (!owner || !view) return;
            var stack = owner.GetUniversalAdditionalCameraData().cameraStack;
            if (stack != null && stack.Contains(view)) stack.Remove(view);
        }

        // ───────────── 钩子 ─────────────

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            legacyOverlay = false;
            Exposure = EffectsExposure = FlashExposure = EffectsSaturation = 1f;
            Hook();
        }

        static void Hook()
        {
            if (hooked) return;
            hooked = true;
            RenderPipelineManager.beginContextRendering += BeginContext;
            RenderPipelineManager.beginCameraRendering += BeginCamera;
        }

        /// <summary>Play 时把旧场景里烘好的叠加枪模相机迁移过来（每帧开头、任何相机读相机栈之前）</summary>
        static void BeginContext(ScriptableRenderContext ctx, List<Camera> cameras)
        {
            // 叠加相机（对照）下不补偿：枪模相机自己走一遍以前的后处理
            if (legacyOverlay) Exposure = EffectsExposure = FlashExposure = EffectsSaturation = 1f;
            if (!Application.isPlaying || legacyOverlay) return;
            foreach (var cam in cameras)
            {
                if (!cam || cam.cameraType != CameraType.Game || !cam.TryGetComponent<UniversalAdditionalCameraData>(out var data)) continue;
                if (data.renderType != CameraRenderType.Base) continue;
                var stack = data.cameraStack;
                if (stack == null || stack.Count == 0) continue;
                for (int i = stack.Count - 1; i >= 0; i--)
                {
                    var c = stack[i];
                    if (c && c.cullingMask == 1 << Layers.FirstPerson && !c.GetComponent<FirstPersonView>())
                    {
                        stack.RemoveAt(i);
                        Setup(c);
                    }
                }
            }
        }

        static void BeginCamera(ScriptableRenderContext ctx, Camera cam)
        {
            if (legacyOverlay || !cam) return;
            for (int i = 0; i < Active.Count; i++)
            {
                var v = Active[i];
                if (v && v.owner == cam) v.Enqueue(ctx, cam);
            }
        }

        void Enqueue(ScriptableRenderContext ctx, Camera cam)
        {
            if (!view || !view.enabled || !view.gameObject.activeInHierarchy) return;
            var data = cam.GetUniversalAdditionalCameraData();
            var renderer = data ? data.scriptableRenderer : null;
            if (renderer == null) return;
            // 视锥按主相机的画幅（渲染到贴图时画幅可能和屏幕不同）
            if (!Mathf.Approximately(view.aspect, cam.aspect)) view.aspect = cam.aspect;
            if (!view.TryGetCullingParameters(out var p)) return;
            p.cullingMask = 1u << Layers.FirstPerson;
            p.shadowDistance = 0;
            p.cullingOptions &= ~(CullingOptions.ShadowCasters | CullingOptions.OcclusionCull);
            pass ??= new Pass();
            pass.cull = ctx.Cull(ref p);
            pass.view = view;
            renderer.EnqueuePass(pass);
        }

        // ───────────── 渲染 pass ─────────────

        /// <summary>在主相机里画 FirstPerson 层：清深度 → 换成枪模的视角 / 投影 → 不透明 + 透明 → 还原</summary>
        sealed class Pass : ScriptableRenderPass
        {
            internal CullingResults cull;
            internal Camera view;

            static readonly List<ShaderTagId> Tags = new() { new("SRPDefaultUnlit"), new("UniversalForward"), new("UniversalForwardOnly") };
            static readonly int ProjectionParams = Shader.PropertyToID("_ProjectionParams");
            static readonly int ZBufferParams = Shader.PropertyToID("_ZBufferParams");
            static readonly int CameraPos = Shader.PropertyToID("_WorldSpaceCameraPos");
            /// <summary>SF_StylizedLit 的第一人称曝光补偿（系数 − 1；0 = 不乘）：只在画 FirstPerson 层时设，画完归零</summary>
            static readonly int ExposureDelta = Shader.PropertyToID("_FirstPersonExposureDelta");
            static readonly int GammaDelta = Shader.PropertyToID("_FirstPersonGammaDelta");

            /// <summary>
            /// 枪模不接收阴影、不吃 SSAO（和以前的枪模相机一样）：画它时关掉这几个全局关键字。
            /// 后面只剩后处理，不用还原（下一台相机开头 URP 会重设这些关键字）
            /// </summary>
            static readonly GlobalKeyword[] Off =
            {
                GlobalKeyword.Create("_MAIN_LIGHT_SHADOWS"), GlobalKeyword.Create("_MAIN_LIGHT_SHADOWS_CASCADE"), GlobalKeyword.Create("_MAIN_LIGHT_SHADOWS_SCREEN"),
                GlobalKeyword.Create("_ADDITIONAL_LIGHT_SHADOWS"), GlobalKeyword.Create("_SCREEN_SPACE_OCCLUSION"),
            };

            public Pass()
            {
                renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing;
                profilingSampler = new ProfilingSampler("First Person Viewmodel");
            }

            sealed class Data
            {
                public RendererListHandle opaque, transparent;
                public TextureHandle color;
                public Matrix4x4 view, mainView, mainProj, vmProj;
                public float near, far, mainNear, mainFar, exposure, gamma;
                public Vector3 eye, mainEye;
            }

            public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
            {
                if (!view) return;
                var cameraData = frameData.Get<UniversalCameraData>();
                var renderingData = frameData.Get<UniversalRenderingData>();
                var lightData = frameData.Get<UniversalLightData>();
                var resources = frameData.Get<UniversalResourceData>();
                if (!resources.activeColorTexture.IsValid() || !resources.activeDepthTexture.IsValid()) return;

                using var builder = renderGraph.AddRasterRenderPass<Data>("First Person Viewmodel", out var d, profilingSampler);
                d.color = resources.activeColorTexture;
                builder.SetRenderAttachment(resources.activeColorTexture, 0, AccessFlags.Write);
                builder.SetRenderAttachmentDepth(resources.activeDepthTexture, AccessFlags.ReadWrite);

                var filter = new FilteringSettings(RenderQueueRange.opaque, 1 << Layers.FirstPerson);
                var ds = RenderingUtils.CreateDrawingSettings(Tags, renderingData, cameraData, lightData, SortingCriteria.CommonOpaque);
                d.opaque = renderGraph.CreateRendererList(new RendererListParams(cull, ds, filter));
                filter.renderQueueRange = RenderQueueRange.transparent;
                ds = RenderingUtils.CreateDrawingSettings(Tags, renderingData, cameraData, lightData, SortingCriteria.CommonTransparent);
                d.transparent = renderGraph.CreateRendererList(new RendererListParams(cull, ds, filter));
                builder.UseRendererList(d.opaque);
                builder.UseRendererList(d.transparent);
                builder.UseAllGlobalTextures(true);
                builder.AllowGlobalStateModification(true);

                var desc = cameraData.cameraTargetDescriptor;
                float aspect = desc.height > 0 ? (float)desc.width / desc.height : view.aspect;
                d.view = view.worldToCameraMatrix;
                d.near = view.nearClipPlane;
                d.far = view.farClipPlane;
                d.eye = view.transform.position;
                d.vmProj = Matrix4x4.Perspective(view.fieldOfView, aspect, d.near, d.far);
                d.mainView = cameraData.GetViewMatrix();
                d.mainProj = cameraData.GetProjectionMatrix();
                d.mainNear = cameraData.camera.nearClipPlane;
                d.mainFar = cameraData.camera.farClipPlane;
                d.mainEye = cameraData.worldSpaceCameraPos;
                var comp = VolumeManager.instance.stack?.GetComponent<FirstPersonExposure>();
                bool on = comp != null && comp.active;
                d.exposure = on ? comp.multiplier.value : 1f;
                d.gamma = on ? comp.gamma.value : 1f;
                Exposure = d.exposure;
                EffectsExposure = on ? comp.effects.value : 1f;
                EffectsSaturation = on ? comp.effectsSaturation.value : 1f;
                FlashExposure = EffectsExposure * (on ? comp.flash.value : 1f);

                builder.SetRenderFunc(static (Data d, RasterGraphContext ctx) =>
                {
                    var cmd = ctx.cmd;
                    bool flip = ctx.GetTextureUVOrigin(d.color) == TextureUVOrigin.BottomLeft;
                    cmd.ClearRenderTarget(RTClearFlags.Depth, Color.clear, 1f, 0);
                    foreach (var k in Off) cmd.SetKeyword(k, false);

                    RenderingUtils.SetViewAndProjectionMatrices(cmd, d.view, GL.GetGPUProjectionMatrix(d.vmProj, flip), true);
                    cmd.SetGlobalVector(ProjectionParams, new Vector4(flip ? -1 : 1, d.near, d.far, 1f / d.far));
                    cmd.SetGlobalVector(ZBufferParams, ZBuffer(d.near, d.far));
                    cmd.SetGlobalVector(CameraPos, d.eye);
                    cmd.SetGlobalFloat(ExposureDelta, d.exposure - 1f);
                    cmd.SetGlobalFloat(GammaDelta, d.gamma - 1f);
                    cmd.DrawRendererList(d.opaque);
                    cmd.DrawRendererList(d.transparent);
                    cmd.SetGlobalFloat(ExposureDelta, 0f);
                    cmd.SetGlobalFloat(GammaDelta, 0f);

                    RenderingUtils.SetViewAndProjectionMatrices(cmd, d.mainView, GL.GetGPUProjectionMatrix(d.mainProj, flip), true);
                    cmd.SetGlobalVector(ProjectionParams, new Vector4(flip ? -1 : 1, d.mainNear, d.mainFar, 1f / d.mainFar));
                    cmd.SetGlobalVector(ZBufferParams, ZBuffer(d.mainNear, d.mainFar));
                    cmd.SetGlobalVector(CameraPos, d.mainEye);
                });
            }

            /// <summary>同 URP ScriptableRenderer.SetPerCameraShaderVariables 的 _ZBufferParams（含反向 Z）</summary>
            static Vector4 ZBuffer(float near, float far)
            {
                float zc0 = 1f - far / near, zc1 = far / near;
                var z = new Vector4(zc0, zc1, zc0 / far, zc1 / far);
                if (SystemInfo.usesReversedZBuffer)
                {
                    z.y += z.x;
                    z.x = -z.x;
                    z.w += z.z;
                    z.z = -z.z;
                }
                return z;
            }
        }
    }
}
