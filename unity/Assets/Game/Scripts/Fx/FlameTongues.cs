using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一片火舌（FX4；Three.js FlameFx.createFlameTongue）：朝镜头的噪声火苗面片（SF_FxFlame，半加法 HDR：叠色的同时压暗一点身后），底边中点在挂点上、往上窜。
    /// 挂在骨骼上的常驻火舌（火浣鼠尾火、镇墓兽背上的日火、祸斗 / 炭童头顶的火）用 <see cref="Attach"/>，调用方每帧给亮度和大小；
    /// 一次性的地面火苗 / 火柱见 <see cref="FlameTongues"/>。大小 = Three.js 的 scale（网格宽 0.6、高 1），世界尺寸（抵消父骨骼缩放）。
    /// </summary>
    public sealed class FlameTongue : MonoBehaviour
    {
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int HotId = Shader.PropertyToID("_Hot");
        static readonly int MidId = Shader.PropertyToID("_Mid");
        static readonly int TipId = Shader.PropertyToID("_Tip");

        /// <summary>Three.js 默认三色：白热芯 0xfff1c0、橙 0xffa030、暗红尖 0xd8401a</summary>
        public static readonly Color DefaultHot = Hex.Rgb(0xfff1c0), DefaultMid = Hex.Rgb(0xffa030), DefaultTip = Hex.Rgb(0xd8401a);

        internal MeshRenderer mr;
        MaterialPropertyBlock block;
        internal float seed, alpha = 1;
        internal Vector3 size = Vector3.one;
        bool dirty = true, world = true;
        Color hot = DefaultHot, mid = DefaultMid, tip = DefaultTip;

        public float Alpha => alpha;

        /// <summary>在 parent 的局部坐标 local 处挂一片火舌；size = 世界尺寸的 scale（x 宽、y 高；宽 = 0.6 × x 米）</summary>
        public static FlameTongue Attach(Transform parent, Vector3 local, Vector3 size, Color? hot = null, Color? mid = null, Color? tip = null)
        {
            if (!parent || !Application.isPlaying) return null;
            var t = Create("Flame Tongue", parent);
            t.transform.localPosition = local;
            t.size = size;
            t.SetColors(hot ?? DefaultHot, mid ?? DefaultMid, tip ?? DefaultTip);
            return t;
        }

        internal static FlameTongue Create(string name, Transform parent)
        {
            var go = new GameObject(name);
            go.layer = parent ? parent.gameObject.layer : 0;
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = FlameTongues.Quad;
            var t = go.AddComponent<FlameTongue>();
            t.mr = go.AddComponent<MeshRenderer>();
            t.mr.sharedMaterial = FxMaterials.Get(FxMaterialKind.Flame);
            t.mr.shadowCastingMode = ShadowCastingMode.Off;
            t.mr.receiveShadows = false;
            t.mr.lightProbeUsage = LightProbeUsage.Off;
            t.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            t.block = new MaterialPropertyBlock();
            t.seed = Random.value;
            return t;
        }

        public void SetColors(Color h, Color m, Color t)
        {
            hot = h;
            mid = m;
            tip = t;
            dirty = true;
        }

        /// <summary>亮度 0..1（0 = 不画）与大小（世界尺寸的 scale）</summary>
        public void Set(float a, Vector3 s)
        {
            if (!Mathf.Approximately(a, alpha)) dirty = true;
            alpha = Mathf.Clamp01(a);
            size = s;
        }

        /// <summary>只改亮度</summary>
        public void Set(float a)
        {
            if (!Mathf.Approximately(a, alpha)) dirty = true;
            alpha = Mathf.Clamp01(a);
        }

        /// <summary>size 按父物体的局部尺寸算（不抵消父缩放：一次性火苗挂在不缩放的特效根下，没区别）</summary>
        internal void LocalSize(bool on) => world = !on;

        internal void Apply()
        {
            bool show = alpha > 0.005f && size.y > 0.005f;
            if (mr.enabled != show) mr.enabled = show;
            if (!show) return;
            var s = size;
            if (world && transform.parent)
            {
                var ps = transform.parent.lossyScale;
                s = new Vector3(s.x / Mathf.Max(1e-4f, Mathf.Abs(ps.x)), s.y / Mathf.Max(1e-4f, Mathf.Abs(ps.y)), s.z / Mathf.Max(1e-4f, Mathf.Abs(ps.z)));
            }
            transform.localScale = new Vector3(Mathf.Max(1e-3f, s.x), Mathf.Max(1e-3f, s.y), Mathf.Max(1e-3f, s.z));
            if (!dirty) return;
            dirty = false;
            mr.GetPropertyBlock(block);
            block.SetVector(ParamsId, new Vector4(seed, alpha, 0, 0));
            block.SetColor(HotId, hot);
            block.SetColor(MidId, mid);
            block.SetColor(TipId, tip);
            mr.SetPropertyBlock(block);
        }

        void LateUpdate() => Apply();
    }

    /// <summary>
    /// 一次性的火舌组（FX4；Three.js FlameFx.spawnGroundFlames / spawnFlamePillar）：
    ///   <see cref="Ground"/>：地上一簇一跳一跳的火苗，持续若干秒（最后 0.6 s 收小熄灭；火浣鼠余火、镇墓兽犁出的日火裂痕、爆炸残焰、地火）；
    ///   <see cref="Pillar"/>：一圈火舌从爆心猛地蹿起再收回（约 0.7 s）。
    /// 火舌走对象池，挂在常驻的特效根下（不缩放），换关清场。句柄可以提前熄灭（0.3 s 收掉：地火被祸斗吃了）。
    /// </summary>
    public sealed class FlameTongues : MonoBehaviour
    {
        const int MaxTongues = 160;

        static Mesh quad;
        static FlameTongues instance;
        static readonly Stack<FlameTongue> pool = new();

        /// <summary>宽 0.6、高 1 的四边形，底边中点在原点（包围盒放大成能装下任意朝向的面片）</summary>
        public static Mesh Quad
        {
            get
            {
                if (quad) return quad;
                quad = new Mesh { name = "Flame Tongue Quad" };
                quad.vertices = new[] { new Vector3(-0.3f, 0, 0), new Vector3(0.3f, 0, 0), new Vector3(-0.3f, 1, 0), new Vector3(0.3f, 1, 0) };
                quad.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) };
                quad.triangles = new[] { 0, 2, 1, 2, 3, 1 };
                quad.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(2.2f, 2.2f, 2.2f));
                return quad;
            }
        }

        internal sealed class Group : FxSlot
        {
            public FlameTongues owner;
            public readonly List<FlameTongue> items = new();
            public readonly List<Vector3> bases = new();
            public readonly List<float> phase = new(), delay = new(), height = new();
            public bool pillar;
            public float age, duration, kill = -1;

            public override void CancelFx()
            {
                if (active && kill < 0) kill = age;
            }
        }

        readonly List<Group> groups = new();
        int live;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            pool.Clear();
        }

        static FlameTongues Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<FlameTongues>();
            return instance;
        }

        /// <summary>场上一次性火舌的片数（测试用）</summary>
        public static int ActiveCount => instance ? instance.live : 0;

        FlameTongue Take()
        {
            FlameTongue t = null;
            while (pool.Count > 0 && !t) t = pool.Pop();
            if (!t) t = FlameTongue.Create("Flame", transform);
            t.gameObject.SetActive(true);
            t.seed = Random.value;
            t.LocalSize(true);
            t.SetColors(FlameTongue.DefaultHot, FlameTongue.DefaultMid, FlameTongue.DefaultTip);
            live++;
            return t;
        }

        void Give(FlameTongue t)
        {
            if (!t) return;
            t.gameObject.SetActive(false);
            pool.Push(t);
            live--;
        }

        /// <summary>
        /// 地上一簇跳动的火苗：count 片撒在 center 周围 radius 内（贴地），持续 duration 秒；size = 火苗大小（Three.js 0.5 ≈ 半米高）。
        /// 颜色缺省同 Three.js（白热 → 橙 → 暗红）
        /// </summary>
        public static FxHandle Ground(Vector3 center, float radius, int count, float duration, float size = 0.5f, Color? hot = null, Color? mid = null, Color? tip = null)
        {
            if (!Fx.Finite(center) || count <= 0 || !(duration > 0)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            count = Mathf.Clamp(Mathf.RoundToInt(count * Mathf.Lerp(0.6f, 1f, Fx.Density)), 1, 24);
            if (self.live + count > MaxTongues) return FxHandle.None;
            var g = self.TakeGroup();
            g.pillar = false;
            g.duration = duration;
            for (int i = 0; i < count; i++)
            {
                var t = self.Take();
                if (hot.HasValue) t.SetColors(hot.Value, mid ?? FlameTongue.DefaultMid, tip ?? FlameTongue.DefaultTip);
                float a = Random.value * Mathf.PI * 2, r = Mathf.Sqrt(Random.value) * radius;
                var p = center + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                float gy = Fx.GroundY(p + Vector3.up * 0.8f, 2f);
                if (!float.IsNegativeInfinity(gy) && Mathf.Abs(gy - center.y) < 0.8f) p.y = gy;
                p.y += 0.02f;
                t.transform.position = p;
                g.items.Add(t);
                g.bases.Add(new Vector3(size * Random.Range(0.6f, 1.2f), 0, 0));
                g.phase.Add(Random.value * 10f);
                g.delay.Add(0);
                g.height.Add(0);
            }
            self.Step(g, 0);
            return new FxHandle(g);
        }

        /// <summary>爆炸火柱：一圈 7 片火舌从 ground 猛地蹿起（0.12 s 到顶）、随后收矮变细淡出（约 0.7 s）；radius = 散布、height = 中间那片的高度</summary>
        public static FxHandle Pillar(Vector3 ground, float radius, float height, Color? hot = null, Color? mid = null, Color? tip = null)
        {
            if (!Fx.Finite(ground) || !(height > 0)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            const int n = 7;
            if (self.live + n > MaxTongues) return FxHandle.None;
            var g = self.TakeGroup();
            g.pillar = true;
            g.duration = 0.8f;
            for (int i = 0; i < n; i++)
            {
                var t = self.Take();
                if (hot.HasValue) t.SetColors(hot.Value, mid ?? FlameTongue.DefaultMid, tip ?? FlameTongue.DefaultTip);
                float a = i / (float)n * Mathf.PI * 2 + Random.value * 0.4f, r = i == 0 ? 0 : radius * Random.Range(0.35f, 0.75f);
                t.transform.position = ground + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                g.items.Add(t);
                g.bases.Add(Vector3.zero);
                g.phase.Add(0);
                g.delay.Add(i == 0 ? 0 : Random.value * 0.08f);
                g.height.Add(height * (i == 0 ? 1 : Random.Range(0.55f, 0.9f)));
            }
            self.Step(g, 0);
            return new FxHandle(g);
        }

        Group TakeGroup()
        {
            Group g = null;
            foreach (var x in groups)
                if (!x.active)
                {
                    g = x;
                    break;
                }
            if (g == null)
            {
                g = new Group { owner = this };
                groups.Add(g);
            }
            g.Claim();
            g.age = 0;
            g.kill = -1;
            g.items.Clear();
            g.bases.Clear();
            g.phase.Clear();
            g.delay.Clear();
            g.height.Clear();
            return g;
        }

        void Step(Group g, float dt)
        {
            g.age += dt;
            float killK = g.kill >= 0 ? Mathf.Clamp01(1 - (g.age - g.kill) / 0.3f) : 1;
            for (int i = 0; i < g.items.Count; i++)
            {
                var t = g.items[i];
                if (!t) continue;
                if (g.pillar)
                {
                    const float life = 0.7f;
                    float u = Mathf.Max(0, g.age - g.delay[i]) / life;
                    float rise = u < 0.17f ? u / 0.17f : 1 - (u - 0.17f) / 0.83f * 0.6f;
                    float h = g.height[i];
                    float w = h * 0.55f * (1 - u * 0.5f);
                    t.Set(Mathf.Max(0, 1 - u * u) * killK, new Vector3(w, Mathf.Max(0.01f, h * rise), w));
                }
                else
                {
                    float fadeIn = Mathf.Min(1, g.age / 0.2f);
                    float fadeOut = Mathf.Clamp01((g.duration - g.age) / 0.6f) * killK;
                    float pulse = 0.75f + 0.35f * Mathf.Sin(g.age * 9 + g.phase[i]) + 0.15f * Mathf.Sin(g.age * 23 + g.phase[i] * 2);
                    float s = g.bases[i].x * fadeIn * fadeOut;
                    t.Set(0.9f * fadeOut, new Vector3(s * 0.9f, s * pulse * 1.4f, s));
                }
                t.Apply();
            }
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            foreach (var g in groups)
            {
                if (!g.active) continue;
                Step(g, dt);
                bool done = g.age >= g.duration + 0.1f || (g.kill >= 0 && g.age - g.kill > 0.3f);
                if (!done) continue;
                foreach (var t in g.items) Give(t);
                g.items.Clear();
                g.active = false;
            }
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            if (!instance) return;
            foreach (var g in instance.groups)
            {
                if (!g.active) continue;
                foreach (var t in g.items) instance.Give(t);
                g.items.Clear();
                g.active = false;
            }
        }
    }
}
