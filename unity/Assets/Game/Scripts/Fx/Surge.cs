using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>涌流体积的材质感（SF_FxSurge 的模式）</summary>
    public enum SurgeKind
    {
        /// <summary>水：半透明青绿 + 白沫</summary>
        Water,
        /// <summary>沙：赭黄颗粒</summary>
        Sand,
        /// <summary>熔浆 / 熔铜：暗壳 + 发光熔流纹</summary>
        Molten,
        /// <summary>火：半加法的火舌条纹</summary>
        Fire,
    }

    /// <summary>涌流体积的网格形状</summary>
    public enum SurgeShape
    {
        /// <summary>柱：底粗顶略细、顶上一圈鼓起的水冠（水柱、熔浆柱、沙瀑）</summary>
        Column,
        /// <summary>冠：往外翻的喇叭口（破水 / 砸地溅起的一圈水花、熔铜冠）</summary>
        Crown,
        /// <summary>弧幕：一段竖直的圆弧面（水墙、冰浪、沙幕）</summary>
        Sheet,
        /// <summary>圆盘：平放的环（水面漩涡、白沫圈）</summary>
        Disk,
        /// <summary>锥尾：底在挂点、尖朝运动的反方向（下坠火尾、跃出时甩出的熔浆尾）</summary>
        Trail,
        /// <summary>穹顶：水面隆起的半球（破水前一刻）</summary>
        Dome,
    }

    /// <summary>
    /// 涌流体积（特效打磨 C 路）：首领登场 / 招式里的水柱、水墙、白沫漩涡、熔浆柱、熔铜冠、下坠火尾——程序网格 + SF_FxSurge（流动条纹、软轮廓、消散）。
    /// 每个实例的生命 = 涌起（rise，缓出放大）→ 停留（hold，轻微起伏）→ 收尾（fall：塌落的会一边变矮一边化掉，不塌的只化掉）。
    /// 池化（上限按画质：高 40 / 低 20，满了不再生成），换关清场；返回的句柄 Cancel = 立刻进入收尾，MoveTo = 挪位置。
    /// 粒子（水花、熔滴、白沫）由调用方另外发，这里只管「一整块」的体积。
    /// </summary>
    public sealed class Surge : MonoBehaviour
    {
        static readonly int ColorAId = Shader.PropertyToID("_ColorA");
        static readonly int ColorBId = Shader.PropertyToID("_ColorB");
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int Params2Id = Shader.PropertyToID("_Params2");
        static readonly int ShapeId = Shader.PropertyToID("_Shape");

        /// <summary>按材质感的缺省两色（A = 本体 / 暗壳 / 边，B = 白沫 / 熔流 / 芯）</summary>
        public static Color DefaultA(SurgeKind k) => k switch
        {
            SurgeKind.Water => new Color(0.42f, 0.76f, 0.82f, 1),
            SurgeKind.Sand => new Color(0.55f, 0.37f, 0.19f, 1),
            // 第三章底色：暗紫褐的壳（暗部偏冷不发黑）
            SurgeKind.Molten => new Color(0.17f, 0.06f, 0.09f, 1),
            // 火的暗边：赭红
            _ => new Color(0.8f, 0.19f, 0.05f, 1),
        };

        public static Color DefaultB(SurgeKind k) => k switch
        {
            SurgeKind.Water => new Color(0.96f, 1f, 1f, 1),
            SurgeKind.Sand => new Color(0.93f, 0.76f, 0.5f, 1),
            // 亮芯金黄（克制：HDR 只到 1.7，主色是芯的 0.6 倍 = 铜橙）
            SurgeKind.Molten => new Color(1.7f, 0.62f, 0.1f, 1),
            _ => new Color(1.35f, 0.85f, 0.3f, 1),
        };

        internal sealed class Slot : FxSlot
        {
            public Surge owner;
            public GameObject go;
            public MeshFilter mf;
            public MeshRenderer mr;
            public MaterialPropertyBlock block;
            public SurgeShape shape;
            public SurgeKind kind;
            public Vector3 pos;
            public Quaternion rot;
            public float radius, height, rise, hold, fall, flow, spin, grow, alpha, age, seed, add;
            public bool collapse;
            public Color a, b;
            public Vector4 p2, shapeParams;
            // 锥尾跟随
            public Transform follow;
            public Vector3 offset, lastFollow, vel;
            public float maxLen, until;
            public bool trail;

            public override void CancelFx()
            {
                if (!active) return;
                float end = rise + hold;
                if (age < end) hold = Mathf.Max(0, age - rise);
                if (trail) until = Mathf.Min(until, age);
            }

            public override void MoveFx(Vector3 position) => pos = position;
        }

        const int CapHigh = 40, CapLow = 20;
        static Surge instance;
        static readonly Dictionary<int, Mesh> meshes = new();
        readonly List<Slot> slots = new();
        int live;

        /// <summary>对照开关（性能开 / 关对照用）：true = 不生成任何涌流体积（水柱 / 熔浆柱 / 火尾…），只剩粒子</summary>
        public static bool Off;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            meshes.Clear();
            Off = false;
        }

        static Surge Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<Surge>();
            return instance;
        }

        /// <summary>场上的涌流体积数（测试 / 性能统计用）</summary>
        public static int ActiveCount => instance ? instance.live : 0;

        void Awake() => SceneManager.sceneUnloaded += OnUnloaded;

        void OnDestroy() => SceneManager.sceneUnloaded -= OnUnloaded;

        void OnUnloaded(Scene _) => ClearAll();

        // ───────────── 入口 ─────────────

        /// <summary>
        /// 柱（水柱、熔浆柱、沙瀑）：从 ground 往上涌到 height 米（rise 秒缓出）、停 hold 秒、fall 秒里塌回去并化掉；flow = 条纹流速（正往上涌、负往下淌）
        /// </summary>
        public static FxHandle Column(Vector3 ground, float radius, float height, SurgeKind kind, float rise = 0.25f, float hold = 0.4f, float fall = 0.6f,
            Color? a = null, Color? b = null, float flow = 1.6f, float alpha = 1f) =>
            Spawn(SurgeShape.Column, kind, ground, Quaternion.Euler(0, Random.value * 360f, 0), radius, height, rise, hold, fall, flow, 0, 1f, true, a, b, alpha);

        /// <summary>冠（一圈往外翻的水花 / 熔铜冠）：life 秒里口径扩到 radius × 1.5、先窜高再塌落</summary>
        public static FxHandle Crown(Vector3 ground, float radius, float height, SurgeKind kind, float life = 0.7f, Color? a = null, Color? b = null, float alpha = 1f) =>
            Spawn(SurgeShape.Crown, kind, ground, Quaternion.Euler(0, Random.value * 360f, 0), radius, height, life * 0.22f, life * 0.18f, life * 0.6f, 2.2f, 0, 1.5f,
                true, a, b, alpha);

        /// <summary>
        /// 弧幕（水墙、冰浪、沙幕）：中心 center、朝 yaw（弧在 center 前方 radius 米处），arcDeg 度的一段弧，高 height；
        /// grow &gt; 1 = 整个寿命里半径线性放大到 radius × grow（跟着冲击波前沿往外推的浪 / 沙墙：grow = 1 + 射程 / 起始半径）
        /// </summary>
        public static FxHandle Sheet(Vector3 center, float yaw, float radius, float arcDeg, float height, SurgeKind kind, float rise, float hold, float fall,
            Color? a = null, Color? b = null, float flow = 1.4f, float alpha = 1f, float grow = 1f)
        {
            int arc = Mathf.Clamp(Mathf.RoundToInt(arcDeg / 15f) * 15, 15, 360);
            return Spawn(SurgeShape.Sheet, kind, center, Quaternion.Euler(0, yaw, 0), radius, height, rise, hold, fall, flow, 0, Mathf.Max(0.1f, grow), grow <= 1f, a, b,
                alpha, arc);
        }

        /// <summary>圆盘（水面漩涡、白沫圈）：外半径 outer、life 秒，spin 度 / 秒地转，flow 负 = 往中心收；grow = 寿命里外半径放大到几倍</summary>
        public static FxHandle Disk(Vector3 center, float outer, SurgeKind kind, float life, float spin = 60f, float flow = -0.8f, float grow = 1f,
            Color? a = null, Color? b = null, float alpha = 0.85f)
        {
            float rise = Mathf.Min(0.35f, life * 0.25f), fall = Mathf.Min(0.8f, life * 0.35f);
            return Spawn(SurgeShape.Disk, kind, center, Quaternion.Euler(0, Random.value * 360f, 0), outer, 1f, rise, Mathf.Max(0, life - rise - fall), fall, flow,
                spin, grow, false, a, b, alpha);
        }

        /// <summary>
        /// 平放的窄环带（扇翼狂风的冻风带、贴地旋转的风环）：inner..outer 米、life 秒，spin 度 / 秒地转，flow 正 = 条纹往外走
        /// </summary>
        public static FxHandle Annulus(Vector3 center, float inner, float outer, SurgeKind kind, float life, float spin = 120f, float flow = 0.8f,
            Color? a = null, Color? b = null, float alpha = 0.7f)
        {
            if (!(outer > 0)) return FxHandle.None;
            int frac = Mathf.Clamp(Mathf.RoundToInt(Mathf.Clamp01(inner / outer) * 20f), 1, 19) * 5;
            float rise = Mathf.Min(0.4f, life * 0.2f), fall = Mathf.Min(0.6f, life * 0.25f);
            return Spawn(SurgeShape.Disk, kind, center, Quaternion.Euler(0, Random.value * 360f, 0), outer, 1f, rise, Mathf.Max(0, life - rise - fall), fall, flow, spin,
                1f, false, a, b, alpha, frac);
        }

        /// <summary>
        /// 锥（吞吸的气流漏斗、吐息）：尖在 apex，朝 dir 张开 length 米、口径 radius；flow 正 = 条纹从口往尖走（吸进去），负 = 往外喷
        /// </summary>
        public static FxHandle Cone(Vector3 apex, Vector3 dir, float length, float radius, SurgeKind kind, float rise, float hold, float fall, Color? a = null,
            Color? b = null, float flow = 2f, float alpha = 0.6f)
        {
            if (!Fx.Finite(apex) || !Fx.Finite(dir) || dir.sqrMagnitude < 1e-6f || !(length > 0)) return FxHandle.None;
            dir = dir.normalized;
            // 锥尾网格：底（v = 0，半径 1）在原点、尖（v = 1）在 +y：底放在口上、+y 朝尖
            return Spawn(SurgeShape.Trail, kind, apex + dir * length, Quaternion.FromToRotation(Vector3.up, -dir), radius, length, rise, hold, fall, flow, 0, 1f,
                false, a, b, alpha);
        }

        /// <summary>穹顶（破水前水面隆起）：rise 秒鼓起到 height、停 hold、fall 秒里塌掉</summary>
        public static FxHandle Dome(Vector3 center, float radius, float height, SurgeKind kind, float rise, float hold, float fall, Color? a = null, Color? b = null,
            float alpha = 0.9f) =>
            Spawn(SurgeShape.Dome, kind, center, Quaternion.Euler(0, Random.value * 360f, 0), radius, height, rise, hold, fall, 0.8f, 0, 1.15f, true, a, b, alpha);

        /// <summary>
        /// 锥尾（下坠火尾、跃出时甩出的熔浆尾）：底挂在 follow 的 offset 处，尖朝运动的反方向，长度随速度（最长 maxLength 米）；duration 秒后（或句柄 Cancel）0.3 s 收掉
        /// </summary>
        public static FxHandle Trail(Transform follow, Vector3 offset, float radius, float maxLength, SurgeKind kind, float duration, Color? a = null, Color? b = null,
            float alpha = 1f)
        {
            if (!follow) return FxHandle.None;
            var h = Spawn(SurgeShape.Trail, kind, follow.position + offset, Quaternion.identity, radius, 0.01f, 0.08f, 1e4f, 0.18f, 2.4f, 0, 1f, false, a, b, alpha);
            var s = instance ? instance.LastSpawned : null;
            if (s != null && h.Alive)
            {
                s.trail = true;
                s.follow = follow;
                s.offset = offset;
                s.lastFollow = follow.position + offset;
                s.vel = Vector3.zero;
                s.maxLen = Mathf.Max(0.5f, maxLength);
                s.until = Mathf.Max(0.05f, duration);
            }
            return h;
        }

        Slot LastSpawned { get; set; }

        static FxHandle Spawn(SurgeShape shape, SurgeKind kind, Vector3 pos, Quaternion rot, float radius, float height, float rise, float hold, float fall, float flow,
            float spin, float grow, bool collapse, Color? a, Color? b, float alpha, int arc = 0)
        {
            if (Off || !Fx.Finite(pos) || !(radius > 0) || !(height > 0)) return FxHandle.None;
            var self = Get();
            if (!self) return FxHandle.None;
            int cap = Fx.Density < 0.6f ? CapLow : CapHigh;
            if (self.live >= cap) return FxHandle.None;
            var mat = FxMaterials.Get(FxMaterialKind.Surge);
            if (!FxMaterials.Usable(mat) || mat.shader.name != FxMaterials.ShaderSurge) return FxHandle.None;
            var s = self.Take(mat);
            s.Claim();
            s.shape = shape;
            s.kind = kind;
            s.pos = pos;
            s.rot = rot;
            s.radius = radius;
            s.height = height;
            s.rise = Mathf.Max(0.02f, rise);
            s.hold = Mathf.Max(0, hold);
            s.fall = Mathf.Max(0.05f, fall);
            s.flow = flow;
            s.spin = spin;
            s.grow = grow;
            s.collapse = collapse;
            s.alpha = alpha;
            s.age = 0;
            s.seed = Random.value * 10f;
            s.a = a ?? DefaultA(kind);
            s.b = b ?? DefaultB(kind);
            // 火只半加法（纯加法会叠成一片白）；熔浆几乎是普通混合
            s.add = kind == SurgeKind.Fire ? 0.35f : kind == SurgeKind.Molten ? 0.08f : 0f;
            s.trail = false;
            s.follow = null;
            // 每种形状的条纹密度 / 软边 / 两端渐隐
            (float nu, float nv, float soft, float top, float bot, float rim) = shape switch
            {
                SurgeShape.Column => (7f, 2.2f, 0.45f, 0.7f, 0.06f, 0.4f),
                SurgeShape.Crown => (12f, 1.4f, 0.3f, 0.55f, 0.05f, 0.4f),
                SurgeShape.Sheet => (Mathf.Max(4f, arc / 12f), 1.8f, 0.25f, 0.62f, 0.05f, 0.35f),
                SurgeShape.Disk => (14f, 1.6f, 0.04f, 0.8f, 0.25f, 0f),
                SurgeShape.Trail => (5f, 1.6f, 0.1f, 0.3f, 0.02f, 0.2f),
                _ => (9f, 1.6f, 0.5f, 0.85f, 0.02f, 0.5f),
            };
            s.p2 = new Vector4(nu, nv, soft, s.add);
            s.shapeParams = new Vector4(top, bot, 0, rim);
            s.mf.sharedMesh = MeshFor(shape, arc);
            self.live++;
            self.LastSpawned = s;
            self.Step(s, 0);
            s.go.SetActive(true);
            return new FxHandle(s);
        }

        Slot Take(Material mat)
        {
            foreach (var x in slots)
                if (!x.active)
                    return x;
            var go = new GameObject("Surge");
            go.transform.SetParent(transform, false);
            go.SetActive(false);
            var s = new Slot { owner = this, go = go, block = new MaterialPropertyBlock() };
            s.mf = go.AddComponent<MeshFilter>();
            s.mr = go.AddComponent<MeshRenderer>();
            s.mr.sharedMaterial = mat;
            s.mr.shadowCastingMode = ShadowCastingMode.Off;
            s.mr.receiveShadows = false;
            s.mr.lightProbeUsage = LightProbeUsage.Off;
            s.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            s.mr.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            slots.Add(s);
            return s;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var s in slots)
            {
                if (!s.active) continue;
                s.age += dt;
                if (!Step(s, dt)) Release(s);
            }
        }

        /// <summary>按年龄摆形状、写参数；返回 false = 播完了</summary>
        bool Step(Slot s, float dt)
        {
            float H, R, alpha, dis = 0;
            var t = s.go.transform;
            if (s.trail)
            {
                if (!s.follow) s.until = Mathf.Min(s.until, s.age);
                var p = s.follow ? s.follow.position + s.offset : s.lastFollow;
                if (dt > 0)
                {
                    var v = (p - s.lastFollow) / dt;
                    s.vel = Vector3.Lerp(s.vel, v, 1 - Mathf.Exp(-dt * 14f));
                }
                s.lastFollow = p;
                float speed = s.vel.magnitude;
                float len = Mathf.Clamp(speed * 0.16f, 0.2f, s.maxLen);
                float k = Mathf.Min(1, s.age / s.rise);
                float end = s.age > s.until ? Mathf.Clamp01(1 - (s.age - s.until) / s.fall) : 1;
                if (end <= 0) return false;
                // 尖朝速度的反方向；几乎不动时朝上
                var back = speed > 0.5f ? -s.vel / speed : Vector3.up;
                t.SetPositionAndRotation(p, Quaternion.FromToRotation(Vector3.up, back));
                float r = s.radius * Mathf.Lerp(0.6f, 1f, k);
                // 收尾时长度跟着一起缩（落地那一下火尾不能还竖在头顶）
                t.localScale = new Vector3(r, Mathf.Max(0.05f, len * k * end * end), r);
                alpha = s.alpha * k * end;
                dis = 1 - end;
                Write(s, alpha, dis);
                return true;
            }
            float life = s.rise + s.hold + s.fall;
            if (s.age >= life) return false;
            float u = Mathf.Clamp01(s.age / life);
            if (s.age < s.rise)
            {
                float k = s.age / s.rise;
                float e = 1 - (1 - k) * (1 - k) * (1 - k);
                H = e;
                R = Mathf.Lerp(0.55f, 1f, e);
                alpha = Mathf.Min(1, s.age / 0.06f);
            }
            else if (s.age < s.rise + s.hold)
            {
                float w = s.age - s.rise;
                H = 1 + 0.04f * Mathf.Sin(w * 9f + s.seed);
                R = 1 + 0.03f * Mathf.Sin(w * 7f + s.seed * 2f);
                alpha = 1;
            }
            else
            {
                float k = (s.age - s.rise - s.hold) / s.fall;
                H = s.collapse ? 1 - 0.85f * k * k : 1;
                R = s.collapse ? 1 + 0.25f * k : 1;
                alpha = 1 - k * k;
                dis = k;
            }
            R *= Mathf.Lerp(1, s.grow, u);
            var rot = s.rot;
            if (s.spin != 0) rot = Quaternion.Euler(0, s.spin * s.age, 0) * s.rot;
            t.SetPositionAndRotation(s.pos, rot);
            float r0 = s.radius * R;
            t.localScale = s.shape == SurgeShape.Disk ? new Vector3(r0, 1, r0) : new Vector3(r0, Mathf.Max(0.02f, s.height * H), r0);
            Write(s, alpha * s.alpha, dis);
            return true;
        }

        static void Write(Slot s, float alpha, float dissolve)
        {
            var b = s.block;
            b.Clear();
            b.SetColor(ColorAId, s.a);
            b.SetColor(ColorBId, s.b);
            b.SetVector(ParamsId, new Vector4(s.seed, Mathf.Clamp01(alpha), s.flow, (int)s.kind));
            b.SetVector(Params2Id, s.p2);
            var sp = s.shapeParams;
            sp.z = Mathf.Clamp01(dissolve);
            b.SetVector(ShapeId, sp);
            s.mr.SetPropertyBlock(b);
        }

        void Release(Slot s)
        {
            s.active = false;
            s.follow = null;
            if (s.go) s.go.SetActive(false);
            live--;
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            if (!instance) return;
            foreach (var s in instance.slots)
                if (s.active)
                    instance.Release(s);
        }

        // ───────────── 网格 ─────────────

        const int Segs = 24, Rings = 10;

        /// <summary>某种形状的单位网格（QilinFx 这类常驻、自己驱动的体积借用）</summary>
        internal static Mesh MeshFor(SurgeShape shape, int arc = 0)
        {
            int key = (int)shape * 1000 + arc;
            if (meshes.TryGetValue(key, out var m) && m) return m;
            m = shape switch
            {
                SurgeShape.Disk => BuildDisk(arc > 0 ? arc / 100f : 0.22f),
                SurgeShape.Sheet => BuildSheet(arc),
                _ => BuildRevolve(shape),
            };
            m.hideFlags = HideFlags.DontSave;
            meshes[key] = m;
            return m;
        }

        /// <summary>绕 y 轴旋转的形状：半径剖面 r(v)、高度 y(v)，单位尺寸（底面半径 ≈ 1、高 1），u 绕一圈</summary>
        static Mesh BuildRevolve(SurgeShape shape)
        {
            int n = (Segs + 1) * (Rings + 1);
            var verts = new Vector3[n];
            var norms = new Vector3[n];
            var uvs = new Vector2[n];
            for (int j = 0; j <= Rings; j++)
            {
                float v = j / (float)Rings;
                Profile(shape, v, out float r, out float y);
                Profile(shape, Mathf.Min(1, v + 0.02f), out float r2, out float y2);
                Profile(shape, Mathf.Max(0, v - 0.02f), out float r1, out float y1);
                float dr = r2 - r1, dy = Mathf.Max(1e-4f, y2 - y1);
                for (int i = 0; i <= Segs; i++)
                {
                    float u = i / (float)Segs;
                    float a = u * Mathf.PI * 2f;
                    float c = Mathf.Cos(a), sn = Mathf.Sin(a);
                    int k = j * (Segs + 1) + i;
                    verts[k] = new Vector3(c * r, y, sn * r);
                    norms[k] = new Vector3(c * dy, -dr, sn * dy).normalized;
                    uvs[k] = new Vector2(u, v);
                }
            }
            var m = new Mesh { name = "Surge " + shape, vertices = verts, normals = norms, uv = uvs, triangles = Grid(Segs, Rings) };
            m.RecalculateBounds();
            return m;
        }

        static void Profile(SurgeShape shape, float v, out float r, out float y)
        {
            y = v;
            switch (shape)
            {
                case SurgeShape.Column:
                    // 底粗顶略细，顶上一圈鼓起的冠
                    r = 1f - 0.22f * v + 0.24f * Mathf.Exp(-Mathf.Pow((v - 0.9f) / 0.08f, 2f));
                    break;
                case SurgeShape.Crown:
                    r = 0.55f + 0.62f * Mathf.Pow(v, 0.7f);
                    break;
                case SurgeShape.Trail:
                    r = Mathf.Pow(1f - v, 0.75f) + 0.02f;
                    break;
                case SurgeShape.Dome:
                {
                    float a = v * Mathf.PI * 0.5f;
                    r = Mathf.Cos(a);
                    y = Mathf.Sin(a);
                    break;
                }
                default:
                    r = 1f;
                    break;
            }
        }

        /// <summary>弧幕：在 z 前方半径 1 处、张角 arc 度的一段竖直圆弧面（u 沿弧、v 自下而上）</summary>
        static Mesh BuildSheet(int arc)
        {
            int segs = Mathf.Clamp(arc / 6, 6, 60);
            int n = (segs + 1) * (Rings + 1);
            var verts = new Vector3[n];
            var norms = new Vector3[n];
            var uvs = new Vector2[n];
            float half = arc * 0.5f * Mathf.Deg2Rad;
            for (int j = 0; j <= Rings; j++)
            {
                float v = j / (float)Rings;
                // 往上稍微往前卷（浪头）
                float lean = 0.12f * v * v;
                for (int i = 0; i <= segs; i++)
                {
                    float u = i / (float)segs;
                    float a = Mathf.Lerp(-half, half, u);
                    float sn = Mathf.Sin(a), c = Mathf.Cos(a);
                    int k = j * (segs + 1) + i;
                    verts[k] = new Vector3(sn * (1 + lean), v, c * (1 + lean));
                    norms[k] = new Vector3(sn, -0.15f, c).normalized;
                    uvs[k] = new Vector2(u, v);
                }
            }
            var m = new Mesh { name = "Surge Sheet " + arc, vertices = verts, normals = norms, uv = uvs, triangles = Grid(segs, Rings) };
            m.RecalculateBounds();
            return m;
        }

        /// <summary>平放的圆环：内半径 inner、外半径 1（u 绕一圈，v 由内向外）</summary>
        static Mesh BuildDisk(float inner)
        {
            const int rings = 6;
            int n = (Segs + 1) * (rings + 1);
            var verts = new Vector3[n];
            var norms = new Vector3[n];
            var uvs = new Vector2[n];
            for (int j = 0; j <= rings; j++)
            {
                float v = j / (float)rings;
                float r = Mathf.Lerp(inner, 1f, v);
                for (int i = 0; i <= Segs; i++)
                {
                    float u = i / (float)Segs;
                    float a = u * Mathf.PI * 2f;
                    int k = j * (Segs + 1) + i;
                    verts[k] = new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                    norms[k] = Vector3.up;
                    uvs[k] = new Vector2(u, v);
                }
            }
            var m = new Mesh { name = "Surge Disk", vertices = verts, normals = norms, uv = uvs, triangles = Grid(Segs, rings) };
            m.RecalculateBounds();
            return m;
        }

        static int[] Grid(int segs, int rings)
        {
            var tris = new int[segs * rings * 6];
            int t = 0;
            for (int j = 0; j < rings; j++)
            for (int i = 0; i < segs; i++)
            {
                int a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
                tris[t++] = a;
                tris[t++] = c;
                tris[t++] = b;
                tris[t++] = b;
                tris[t++] = c;
                tris[t++] = d;
            }
            return tris;
        }
    }
}
