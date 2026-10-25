using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃第一人称刀光（WC7；Three.js BladeView.ts 的 SwingTrail，外观参数走 FX1 预设 <see cref="BladeTrailPreset"/>）：
    /// 挂在第一人称视图里（相机空间、FirstPerson 层，由枪模相机画），视图每帧把这一帧走过的挥砍进度细分采样，
    /// 每个采样点记下刀身 35% 处（内沿）与伸长后的刀尖（外沿）的位置和外沿速度——刀光就是刀身扫过的那块面，和刀身严格同步。
    ///   · 横截面：内沿透明 → 七成处淡淡一层 → 外沿最亮（带身，普通混合：亮背景上也看得见；亮度集中在刃口一侧，像一弯月牙）→ 外缘一道加色光边；
    ///   · 亮度跟速度走（<see cref="FxTrailSpec.Brightness"/>）：出刀那两三帧满亮、收势越来越暗；最新的 0.04 s 再白热一点；
    ///   · 采样点活 0.16 s（游戏时间：顿帧时刀光跟着停住），新一段斩击另起一条（<see cref="Break"/>），旧的自然淡掉，不会被拉成一根线连过去。
    /// 网格顶点数固定（<see cref="FxTrailSpec.maxSamples"/> × 5：内沿、七成处、外沿、光边内侧、光边外侧），每帧只重写位置 / 颜色 / 索引。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BladeTrail : MonoBehaviour
    {
        struct Sample
        {
            public Vector3 inner, outer;
            public float age, bright;
            /// <summary>新的一条从这里开始（不与前一个采样点连成带子）</summary>
            public bool start;
        }

        const int Stride = 5;
        /// <summary>带身中间那一圈的位置（内沿 → 外沿的比例）与不透明度（占外沿的比例）</summary>
        const float MidAt = 0.7f, MidAlpha = 0.42f;

        FxTrailSpec spec;
        Sample[] samples;
        int count;
        bool breakNext = true;
        Mesh mesh;
        MeshRenderer meshRenderer;
        Vector3[] verts;
        Color[] colors;
        int[] body, fringe;

        /// <summary>现存的采样点数</summary>
        public int Count => count;
        /// <summary>最近一次 <see cref="ResetPeak"/> 以来推入的最高亮度（测试 / 套件读）</summary>
        public float PeakBrightness { get; private set; }
        /// <summary>最新一个采样点的亮度</summary>
        public float LastBrightness => count > 0 ? samples[count - 1].bright : 0;
        public FxTrailSpec Spec => spec;
        /// <summary>这一帧画出来了（至少两个相连的采样点）</summary>
        public bool Visible => meshRenderer && meshRenderer.enabled;

        /// <summary>预设缺失时的默认外观</summary>
        static readonly FxTrailSpec Fallback = new();

        /// <summary>外观参数：FX1 预设 <see cref="BladeTrailPreset"/>；没登记时用默认值</summary>
        public static FxTrailSpec ResolveSpec() => (Registry<FxPreset>.Get(BladeTrailPreset.PresetId) as FxTrailPreset)?.Trail ?? Fallback;

        public static BladeTrail Create(Transform parent)
        {
            var go = new GameObject("Blade Trail");
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<BladeTrail>();
            t.Init(ResolveSpec());
            return t;
        }

        void Init(FxTrailSpec s)
        {
            spec = s ?? Fallback;
            int n = Mathf.Clamp(spec.maxSamples, 4, 256);
            samples = new Sample[n];
            verts = new Vector3[n * Stride];
            colors = new Color[n * Stride];
            body = new int[(n - 1) * 12];
            fringe = new int[(n - 1) * 6];
            mesh = new Mesh { name = "Blade Trail", hideFlags = HideFlags.DontSave };
            mesh.MarkDynamic();
            mesh.vertices = verts;
            mesh.colors = colors;
            mesh.subMeshCount = 2;
            gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
            meshRenderer = gameObject.AddComponent<MeshRenderer>();
            meshRenderer.sharedMaterials = new[] { FxMaterials.AlphaBlend, FxMaterials.Additive };
            meshRenderer.shadowCastingMode = ShadowCastingMode.Off;
            meshRenderer.receiveShadows = false;
            meshRenderer.lightProbeUsage = LightProbeUsage.Off;
            meshRenderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            meshRenderer.enabled = false;
        }

        void OnDestroy()
        {
            if (mesh) Destroy(mesh);
        }

        /// <summary>全部清掉（切出这把刀、换关）</summary>
        public void Clear()
        {
            count = 0;
            breakNext = true;
            if (meshRenderer) meshRenderer.enabled = false;
        }

        /// <summary>下一个采样点另起一条（新一段斩击）</summary>
        public void Break() => breakNext = true;

        public void ResetPeak() => PeakBrightness = 0;

        /// <summary>推入一个采样点（父物体局部坐标）：内沿、外沿、外沿速度（米 / 秒）</summary>
        public void Push(Vector3 inner, Vector3 outer, float speed)
        {
            if (samples == null || !float.IsFinite(inner.x + inner.y + inner.z + outer.x + outer.y + outer.z)) return;
            if (count >= samples.Length)
            {
                System.Array.Copy(samples, 1, samples, 0, samples.Length - 1);
                count--;
                samples[0].start = true;
            }
            float b = spec.Brightness(speed);
            samples[count++] = new Sample { inner = inner, outer = outer, age = 0, bright = b, start = breakNext };
            breakNext = false;
            if (b > PeakBrightness) PeakBrightness = b;
        }

        /// <summary>每帧：采样点变老、过期的丢掉、重建网格（color = 这一刀的刀光色，人刀合一时偏白）</summary>
        public void Tick(float dt, Color color)
        {
            if (samples == null) return;
            for (int i = 0; i < count; i++) samples[i].age += dt;
            int dead = 0;
            while (dead < count && samples[dead].age > spec.life) dead++;
            if (dead > 0)
            {
                System.Array.Copy(samples, dead, samples, 0, count - dead);
                count -= dead;
                if (count > 0) samples[0].start = true;
            }
            if (count < 2 || !Rebuild(color))
            {
                if (meshRenderer.enabled) meshRenderer.enabled = false;
                return;
            }
            if (!meshRenderer.enabled) meshRenderer.enabled = true;
        }

        /// <summary>重写网格；没有相连的两点（画不出带子）返回 false</summary>
        bool Rebuild(Color color)
        {
            var white = Color.white;
            for (int i = 0; i < count; i++)
            {
                var s = samples[i];
                float life = Mathf.Clamp01(1 - s.age / Mathf.Max(0.01f, spec.life));
                float head = Mathf.Clamp01(1 - s.age / Mathf.Max(0.005f, spec.headTime));
                float fade = life * life;
                var hot = Color.Lerp(color, white, Mathf.Clamp01(spec.hotMix + spec.headHotMix * head));
                float k = spec.bodyIntensity * (0.55f + 0.45f * s.bright);
                int v = i * Stride;
                float a = fade * spec.bodyAlpha * s.bright;
                var mid = Color.Lerp(color, hot, 0.35f);
                verts[v] = s.inner;
                verts[v + 1] = Vector3.LerpUnclamped(s.inner, s.outer, MidAt);
                verts[v + 2] = s.outer;
                verts[v + 3] = s.outer;
                verts[v + 4] = s.outer + (s.outer - s.inner) * spec.fringe;
                colors[v] = new Color(color.r * k, color.g * k, color.b * k, 0);
                colors[v + 1] = new Color(mid.r * k, mid.g * k, mid.b * k, a * MidAlpha);
                colors[v + 2] = new Color(hot.r * k, hot.g * k, hot.b * k, a);
                // 外缘光边：加色，刃口那一侧亮（alpha = 强度）、向外收掉
                float f = spec.fringeIntensity;
                colors[v + 3] = new Color(hot.r * f, hot.g * f, hot.b * f, fade * s.bright);
                colors[v + 4] = new Color(hot.r * f, hot.g * f, hot.b * f, 0);
            }
            // 没用到的顶点叠到第一个点上：包围盒只算现存的采样
            for (int v = count * Stride; v < verts.Length; v++) verts[v] = samples[0].inner;
            int nb = 0, nf = 0;
            for (int i = 1; i < count; i++)
            {
                if (samples[i].start) continue;
                int a = (i - 1) * Stride, b = i * Stride;
                // 带身：内沿 → 七成处 → 外沿
                for (int r = 0; r < 2; r++)
                {
                    body[nb++] = a + r;
                    body[nb++] = a + r + 1;
                    body[nb++] = b + r;
                    body[nb++] = a + r + 1;
                    body[nb++] = b + r + 1;
                    body[nb++] = b + r;
                }
                // 外缘光边：光边内侧 → 外侧
                fringe[nf++] = a + 3;
                fringe[nf++] = a + 4;
                fringe[nf++] = b + 3;
                fringe[nf++] = a + 4;
                fringe[nf++] = b + 4;
                fringe[nf++] = b + 3;
            }
            if (nb == 0) return false;
            mesh.vertices = verts;
            mesh.colors = colors;
            mesh.SetTriangles(body, 0, nb, 0, false);
            mesh.SetTriangles(fringe, 0, nf, 1, false);
            mesh.RecalculateBounds();
            return true;
        }
    }
}
