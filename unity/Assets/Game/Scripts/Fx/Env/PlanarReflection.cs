using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 平面反射（彩林海子的镜面湖，着色器 Spiritfire/MirrorLake）：挂在水面物体上，水面高度 = 本物体的世界 y。
    /// 每台相机开始渲染前（RenderPipelineManager.beginCameraRendering），用一台隐藏的镜像相机把场景沿水面翻过来画进一张低分辨率贴图，
    /// 设成全局 _PlanarReflectionTex（并置 _PlanarReflectionOn = 1），水面着色器按屏幕坐标取样。
    ///   · 斜裁剪面（oblique projection）贴着水面切掉水下的东西；镜像后三角形绕序反了，渲染期间 GL.invertCulling；
    ///   · 镜像相机不画水面本身（Water 层）、不画第一人称层，不做后处理（主相机的后处理会作用在整张画面上，包括水面）；
    ///   · 画倒影期间 LOD 偏置乘 <see cref="lodBias"/>（倒影里的远树早一点换低模）；
    ///   · 水面不在视野里、相机在水下、正交相机（俯视地图）时不画，_PlanarReflectionOn = 0，水面退回天空反射探针；
    ///   · <see cref="Enabled"/> = false（画质设置可关）时同样退回。
    /// [ExecuteAlways]：编辑器里的场景视图和审核截图（Camera.Render）也有倒影。
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class PlanarReflection : MonoBehaviour
    {
        /// <summary>全局开关（画质设置用）：关掉后所有水面退回反射探针</summary>
        public static bool Enabled = true;

        [Tooltip("倒影贴图分辨率 = 相机像素 × 这个比例")]
        [Range(0.2f, 1f)] public float resolutionScale = 0.5f;
        [Tooltip("倒影里画哪些层（还会去掉 Water 层和第一人称层）")]
        public LayerMask reflectLayers = ~0;
        [Tooltip("裁剪面比水面低多少（米）：太小水岸会漏出一条缝，太大水下的东西会画进倒影")]
        public float clipOffset = 0.06f;
        [Tooltip("画倒影期间 LOD 偏置乘这个数")]
        [Range(0.1f, 2f)] public float lodBias = 0.5f;
        [Tooltip("倒影相机的远裁面上限（米）")]
        public float farClip = 1500f;
        [Tooltip("倒影里画实时投影")]
        public bool renderShadows = true;
        [Tooltip("水面渲染器：不在视野里时不画倒影（空 = 本物体上的 Renderer）")]
        public Renderer surface;

        static readonly int TexId = Shader.PropertyToID("_PlanarReflectionTex");
        static readonly int OnId = Shader.PropertyToID("_PlanarReflectionOn");
        static readonly Plane[] frustum = new Plane[6];

        Camera reflCam;
        RenderTexture rt;
        bool rendering;

        void OnEnable()
        {
            if (!surface) surface = GetComponent<Renderer>();
            RenderPipelineManager.beginCameraRendering += OnBeginCamera;
        }

        void OnDisable()
        {
            RenderPipelineManager.beginCameraRendering -= OnBeginCamera;
            Shader.SetGlobalFloat(OnId, 0);
            if (reflCam) DestroyImmediate(reflCam.gameObject);
            reflCam = null;
            if (rt)
            {
                rt.Release();
                DestroyImmediate(rt);
            }
            rt = null;
        }

        void OnBeginCamera(ScriptableRenderContext context, Camera cam)
        {
            if (rendering || cam == reflCam || cam.cameraType == CameraType.Reflection || cam.cameraType == CameraType.Preview) return;
            if (cam.TryGetComponent<UniversalAdditionalCameraData>(out var camData) && camData.renderType == CameraRenderType.Overlay) return;
            float y = transform.position.y;
            if (!Enabled || cam.orthographic || cam.transform.position.y <= y + 0.02f || !SurfaceVisible(cam))
            {
                Shader.SetGlobalFloat(OnId, 0);
                return;
            }
            rendering = true;
            float lod = QualitySettings.lodBias;
            try
            {
                EnsureCamera();
                EnsureTarget(cam);
                Setup(cam, y);
                QualitySettings.lodBias = lod * lodBias;
                PauseFeatures();
                GL.invertCulling = true;
#pragma warning disable CS0618 // RenderSingleCamera 已标过时，但 URP 17 里仍是在 beginCameraRendering 里嵌套画一台相机的唯一同步做法
                UniversalRenderPipeline.RenderSingleCamera(context, reflCam);
#pragma warning restore CS0618
                Shader.SetGlobalTexture(TexId, rt);
                Shader.SetGlobalFloat(OnId, 1);
            }
            catch (System.Exception e)
            {
                Shader.SetGlobalFloat(OnId, 0);
                Debug.LogException(e, this);
            }
            finally
            {
                GL.invertCulling = false;
                ResumeFeatures();
                QualitySettings.lodBias = lod;
                rendering = false;
            }
        }

        static readonly System.Collections.Generic.List<ScriptableRendererFeature> paused = new();

        /// <summary>
        /// 画倒影期间临时停掉贴花和 SSAO：嵌套渲染（RenderSingleCamera）里这两个特性取不到相机颜色目标（贴花 Pass 空引用、整张倒影作废），
        /// 倒影里也不需要弹孔和环境遮蔽。画完原样恢复（主相机在这之后才搭自己的 Pass）
        /// </summary>
        static void PauseFeatures()
        {
            paused.Clear();
            if (GraphicsSettings.currentRenderPipeline is not UniversalRenderPipelineAsset urp) return;
            foreach (var data in urp.rendererDataList)
            {
                if (!data) continue;
                foreach (var f in data.rendererFeatures)
                {
                    if (!f || !f.isActive || f is not (DecalRendererFeature or ScreenSpaceAmbientOcclusion)) continue;
                    f.SetActive(false);
                    paused.Add(f);
                }
            }
        }

        static void ResumeFeatures()
        {
            foreach (var f in paused)
                if (f) f.SetActive(true);
            paused.Clear();
        }

        bool SurfaceVisible(Camera cam)
        {
            if (!surface) return true;
            GeometryUtility.CalculateFrustumPlanes(cam, frustum);
            return GeometryUtility.TestPlanesAABB(frustum, surface.bounds);
        }

        void EnsureCamera()
        {
            if (reflCam) return;
            var go = new GameObject("Planar Reflection Camera") { hideFlags = HideFlags.HideAndDontSave };
            reflCam = go.AddComponent<Camera>();
            reflCam.enabled = false;
            var data = go.AddComponent<UniversalAdditionalCameraData>();
            data.renderType = CameraRenderType.Base;
            data.renderPostProcessing = false;
            data.antialiasing = AntialiasingMode.None;
            data.requiresColorOption = CameraOverrideOption.Off;
            data.requiresDepthOption = CameraOverrideOption.Off;
            data.renderShadows = renderShadows;
        }

        void EnsureTarget(Camera cam)
        {
            int w = Mathf.Max(64, Mathf.RoundToInt(cam.pixelWidth * resolutionScale));
            int h = Mathf.Max(64, Mathf.RoundToInt(cam.pixelHeight * resolutionScale));
            var format = cam.allowHDR ? RenderTextureFormat.DefaultHDR : RenderTextureFormat.Default;
            if (rt && rt.width == w && rt.height == h && rt.format == format) return;
            if (rt)
            {
                rt.Release();
                DestroyImmediate(rt);
            }
            rt = new RenderTexture(w, h, 24, format) { name = "_PlanarReflectionTex", hideFlags = HideFlags.HideAndDontSave, useMipMap = false, autoGenerateMips = false };
            rt.Create();
        }

        void Setup(Camera cam, float y)
        {
            reflCam.CopyFrom(cam);
            reflCam.cameraType = CameraType.Game;
            reflCam.enabled = false;
            reflCam.targetTexture = rt;
            reflCam.useOcclusionCulling = false;
            reflCam.allowMSAA = false;
            reflCam.clearFlags = CameraClearFlags.Skybox;
            reflCam.farClipPlane = Mathf.Min(cam.farClipPlane, farClip);
            int mask = reflectLayers & cam.cullingMask;
            int water = LayerMask.NameToLayer("Water");
            if (water >= 0) mask &= ~(1 << water);
            int fp = LayerMask.NameToLayer("FirstPerson");
            if (fp >= 0) mask &= ~(1 << fp);
            reflCam.cullingMask = mask;
            if (reflCam.TryGetComponent<UniversalAdditionalCameraData>(out var data)) data.renderShadows = renderShadows;

            // 沿水面（y = 常数）镜像：位置、朝向翻过来，世界 → 相机矩阵右乘反射矩阵
            var camT = cam.transform;
            var p = camT.position;
            // 位置 / 朝向只给 LOD、地形树距离这些按相机位置算的东西用（渲染与裁剪用下面覆盖的矩阵）
            reflCam.transform.SetPositionAndRotation(new Vector3(p.x, 2 * y - p.y, p.z), Quaternion.LookRotation(Vector3.Scale(camT.forward, new Vector3(1, -1, 1))));
            var reflection = Matrix4x4.identity;
            reflection.m11 = -1;
            reflection.m13 = 2 * y;
            reflCam.worldToCameraMatrix = cam.worldToCameraMatrix * reflection;
            // 斜裁剪面：贴着水面（略低 clipOffset）把水下的东西切掉
            var w2c = reflCam.worldToCameraMatrix;
            var planePos = new Vector3(0, y - clipOffset, 0);
            var cpos = w2c.MultiplyPoint(planePos);
            var cnormal = w2c.MultiplyVector(Vector3.up).normalized;
            var clip = new Vector4(cnormal.x, cnormal.y, cnormal.z, -Vector3.Dot(cpos, cnormal));
            reflCam.projectionMatrix = cam.CalculateObliqueMatrix(clip);
        }
    }
}
