using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 按图层的剔除距离（I4；docs/performance-unity.md「剔除」）：关卡场景加载时把小件和散布件挪到两个专用图层，主相机按画质档给这两层设
    /// <see cref="Camera.layerCullDistances"/>（球面距离），远处的小东西不进渲染，大件（建筑、崖壁、地标、远景）永远不剔。
    /// 这是「远景 impostor」的替代：工程规定模型不减面、只发一级 _LOD0（2026-10-25），所以远处不换低模，只按距离不画小件。
    ///   小件 <see cref="Detail"/>（图层 8）：包围盒最长边 ≤ <see cref="DetailMaxSize"/> m（碎石、罐子、灯笼、小摆件）；
    ///   散布 <see cref="Scatter"/>（图层 9）：≤ <see cref="ScatterMaxSize"/> m（巨砾、灌丛、矮树、货堆、掩体石）。
    /// 只动关卡场景里 Default 层的静态 MeshRenderer：蒙皮、粒子、线、地形、水 / 角色 / 第一人称层、带刚体 / 动画 / 可受伤 / 可交互组件的都不动。
    /// 这两层和 Default 一样参与碰撞、子弹、视线、地面检测（Layers 的遮罩都是「除了某几层」），只是渲染多了一个距离上限。
    /// 距离（<see cref="QualityProfile"/>）：高档小件 120 m、散布到雾终点（被雾吞掉之后才剔，看不出来），中 / 低档往近收。
    /// L5 的 PerfBudgetCheck 用同一个 <see cref="Classify"/> 估算构建出来的关卡。
    /// GPU 常驻绘制接管的渲染器不认 layerCullDistances（它的剔除只看图层遮罩）：那部分由 URP 资产的「小网格屏占比」剔除兜底。
    /// </summary>
    public static class CullLayers
    {
        public const int Detail = 8, Scatter = 9;
        public const string DetailName = "Detail", ScatterName = "Scatter";
        public const float DetailMaxSize = 1.6f, ScatterMaxSize = 6f;
        /// <summary>雾没开 / 雾终点异常时散布层的距离上限</summary>
        public const float ScatterFallback = 400f;

        /// <summary>最近一次给场景分层的结果（测试 / 报告用）：小件、散布各多少个</summary>
        public static int LastDetail { get; private set; }
        public static int LastScatter { get; private set; }

        /// <summary>关掉按图层剔除（对照测试 / 截图用；关掉时两层距离写 0 = 跟着相机远裁）</summary>
        public static bool Disabled
        {
            get => disabled;
            set
            {
                disabled = value;
                applied = null;
            }
        }

        static bool disabled;
        static Camera applied;
        static QualityProfile appliedProfile;
        static float appliedFog = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            SceneManager.sceneLoaded -= OnLoaded;
            Application.onBeforeRender -= Refresh;
            applied = null;
            appliedProfile = null;
            appliedFog = -1;
            disabled = false;
            LastDetail = LastScatter = 0;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            SceneManager.sceneLoaded -= OnLoaded;
            SceneManager.sceneLoaded += OnLoaded;
            Application.onBeforeRender -= Refresh;
            Application.onBeforeRender += Refresh;
            for (int i = 0; i < SceneManager.sceneCount; i++) OnLoaded(SceneManager.GetSceneAt(i), LoadSceneMode.Additive);
        }

        static void OnLoaded(Scene s, LoadSceneMode mode)
        {
            if (!Application.isPlaying || !s.IsValid() || s.name == SceneFlow.CoreName) return;
            Apply(s);
            applied = null; // 新关卡的雾终点可能不一样：下一帧重设距离
        }

        /// <summary>这个渲染器归哪一层（-1 = 不动）</summary>
        public static int Classify(Renderer r)
        {
            if (r is not MeshRenderer || !r.enabled) return -1;
            var go = r.gameObject;
            if (go.layer != 0) return go.layer == Detail || go.layer == Scatter ? go.layer : -1;
            if (r.GetComponentInParent<Rigidbody>() || r.GetComponentInParent<Animator>() || r.GetComponentInParent<Damageable>()
                || r.GetComponentInParent<IInteractable>() != null)
                return -1;
            var size = r.bounds.size;
            float m = Mathf.Max(size.x, Mathf.Max(size.y, size.z));
            if (m <= 0.001f) return -1;
            return m <= DetailMaxSize ? Detail : m <= ScatterMaxSize ? Scatter : -1;
        }

        /// <summary>给一个场景分层（返回挪了几个）</summary>
        public static int Apply(Scene s)
        {
            int detail = 0, scatter = 0;
            var roots = new List<GameObject>();
            s.GetRootGameObjects(roots);
            var buf = new List<MeshRenderer>();
            foreach (var root in roots)
            {
                root.GetComponentsInChildren(true, buf);
                foreach (var r in buf)
                {
                    if (r.gameObject.layer != 0) continue;
                    int layer = Classify(r);
                    if (layer < 0) continue;
                    r.gameObject.layer = layer;
                    if (layer == Detail) detail++;
                    else scatter++;
                }
            }
            LastDetail = detail;
            LastScatter = scatter;
            return detail + scatter;
        }

        /// <summary>这一档的两层剔除距离（米）：小件固定距离，散布 = 雾终点 × 比例（没开雾用 <see cref="ScatterFallback"/>）</summary>
        public static (float detail, float scatter) Distances(QualityProfile p, float fogEnd)
        {
            float fog = fogEnd > 50 && fogEnd < 5000 ? fogEnd : ScatterFallback;
            return (p.detailCullDistance, Mathf.Max(p.detailCullDistance, fog * p.scatterCullFog));
        }

        /// <summary>当前关卡的雾终点（线性雾才有；没开雾 = 0）</summary>
        public static float FogEnd => RenderSettings.fog && RenderSettings.fogMode == FogMode.Linear ? RenderSettings.fogEndDistance : 0;

        /// <summary>把这一档的剔除距离写到相机上（球面距离：转头时不会忽隐忽现）</summary>
        public static void ApplyTo(Camera cam, QualityProfile p, float fogEnd)
        {
            if (!cam || p == null) return;
            var d = cam.layerCullDistances;
            if (d == null || d.Length != 32) d = new float[32];
            var (detail, scatter) = disabled ? (0f, 0f) : Distances(p, fogEnd);
            d[Detail] = detail;
            d[Scatter] = scatter;
            cam.layerCullDistances = d;
            cam.layerCullSpherical = true;
        }

        /// <summary>每帧渲染前：主相机换了、画质档换了、雾终点变了才重写</summary>
        static void Refresh()
        {
            var cam = Camera.main;
            if (!cam) return;
            var p = GraphicsQuality.AppliedProfile ?? QualityProfile.Current;
            float fog = FogEnd;
            if (cam == applied && p == appliedProfile && Mathf.Abs(fog - appliedFog) < 1f) return;
            ApplyTo(cam, p, fog);
            applied = cam;
            appliedProfile = p;
            appliedFog = fog;
        }
    }
}
