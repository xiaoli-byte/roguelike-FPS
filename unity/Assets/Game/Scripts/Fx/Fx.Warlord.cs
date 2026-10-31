using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将的色阶（docs/art/vfx/warlord.md §1；fx-style §2.1 火 + §2.2 第三章熔火）：母题是熔铜铠甲、地火之心、战阵号令、陨火，
    /// 形状语言「重、方、斩」——刀光是暗月牙托亮刃，熔铜是铜橙色，烟是紫褐色，碎屑是方块（铜渣、铁片）。
    /// 每层只用三阶：亮芯 / 主色 / 暗边（或烟）。狂怒（20%）整体换挡成白热铜：亮芯更白、主色更亮更黄、暗边转赤。
    /// 和火麒麟（玄鳞 + 圣火：青黑鳞光、金白圣焰、圆 / 环的宝鼎母题）分开：魔将只用铜和铁、方和月牙。
    /// </summary>
    public static class WarlordPalette
    {
        /// <summary>常态：亮芯（白热铜）/ 主色（熔铜橙）/ 暗边（赭红）</summary>
        public static readonly Color Hot = Hex.Rgb(0xffe6a6), Copper = Hex.Rgb(0xff8a2e), Deep = Hex.Rgb(0xb8461a);
        /// <summary>狂怒：亮芯 / 主色 / 暗边</summary>
        public static readonly Color FuryHot = Hex.Rgb(0xfff6dc), FuryCopper = Hex.Rgb(0xffb24a), FuryDeep = Hex.Rgb(0xff4a14);
        /// <summary>紫褐烟（第三章烟色）、暗月牙（刀光底下的暗衬，偏紫不发黑）、铁渣（方块碎屑）</summary>
        public static readonly Color Smoke = Hex.Rgb(0x4e3442), Under = new(0.13f, 0.045f, 0.06f), Slag = Hex.Rgb(0x3a2a26);

        /// <summary>
        /// 写进网格顶点色的颜色要先转成线性：工程是线性色彩空间，粒子着色器把顶点色当线性值用——直接写 sRGB 的铜橙（0.54 的绿）会显示成 0.76，
        /// 整弯月牙冲成奶白（第一次实拍就是这样；通用刀光 SlashArc 也有同样的问题）
        /// </summary>
        public static Color Vertex(Color c) => FxVertexColor.Linear(c);

        public static Color HotAt(float fury) => Color.Lerp(Hot, FuryHot, fury);
        public static Color CopperAt(float fury) => Color.Lerp(Copper, FuryCopper, fury);
        public static Color DeepAt(float fury) => Color.Lerp(Deep, FuryDeep, fury);
    }

    /// <summary>
    /// 熔心魔将的招式特效入口（首领与精英动作 · 特效调优 W 路；设计单 docs/art/vfx/warlord.md）。只管外观，不碰判定：
    /// 判定、危险物、预警都在招式里（Reference/WarlordMoves.cs、Warlord/Moves），这里由 <see cref="WarlordBrain"/> 在释放帧那一刻调。
    /// 粒子走 <see cref="Burst"/> / 预设（都过 <see cref="FxBudget"/>），刀光是自己的月牙 <see cref="WarlordArc"/>（池化），大剑拖影见 <see cref="WarlordBlade"/>。
    /// fury = 0..1 狂怒换挡程度（色阶从熔铜转白热铜）。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>
        /// 主形 · 暗月牙托亮刃（<see cref="WarlordArc"/>）：一弯两头尖、中间厚的月牙——底下垫一层更大的暗紫褐月牙（普通混合，亮沙 / 熔岩上都压得出来），
        /// 中间是实色的熔铜色块（普通混合，不靠加法叠白），外缘一道白热刃口（加法）。arc = 弧长（弧度），dir = 1 从右往左扫（俯视逆时针）/ -1 反向，
        /// tilt = 绕前方轴倾斜（弧度：斜劈 / 竖劈），width = 月牙最厚处（米），pitchDeg = 整弯往前低头的角度（度：水平的横扫月牙朝玩家那一侧压低一点，
        /// 第一人称里不再是一条贴着视线的细线）
        /// </summary>
        public static FxHandle WarlordCrescent(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float fury, float life = 0.32f,
            float pitchDeg = 0f) =>
            WarlordArc.Spawn(center, yawDeg, radius, arc, dir, tilt, width, life, fury, pitchDeg);

        /// <summary>
        /// 点缀 · 方块铜渣：沿 dir 甩出去的几块方铜渣（铁片预设，铜色）+ 一小撮拉丝火星。chunk = false 只放火星（一圈里只让一处放铁片预设，省粒子系统）
        /// </summary>
        public static void WarlordShards(Vector3 at, Vector3 dir, float size, float fury, bool chunk = true)
        {
            if (!Finite(at)) return;
            if (chunk) Basalt(at, 0.55f * size, Color.Lerp(WarlordPalette.Slag, WarlordPalette.Deep, 0.35f));
            var d = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.up;
            Burst(at + d * 0.3f, WarlordPalette.CopperAt(fury), Mathf.RoundToInt(7 * size), 7f * Mathf.Sqrt(size), 0.35f, 0.08f, 10f);
        }

        /// <summary>
        /// 第三章的地裂（第二批收尾 C 路）：方形裂纹贴花（<see cref="CrackDecals"/>：方坑 + 方折主裂纹 + 一圈方石板缝，铜橙裂光、紫褐焦边，
        /// 从坑心往外蔓延、慢慢冷成暗铜缝）。radius = 裂纹最远处的半径（米）；fallback = 贴不上（关了 / 材质缺失）时退回一滩熔铜贴花（以前的样子）
        /// </summary>
        public static FxHandle Ch3Crack(Vector3 ground, float radius, float fury = 0f, float life = 6f, float heat = 1f, bool fallback = true)
        {
            if (!Finite(ground)) return FxHandle.None;
            var h = CrackDecals.Place(ground, radius / 0.9f, life, heat, fury);
            return h.Alive || !fallback ? h : MoltenSplat(ground, radius * 0.77f, heat, life);
        }

        /// <summary>
        /// 重击落地（跃击落点 / 竖劈入地）：主形 = 贴地卡通粗环（压暗的铜色）+ 熔铜冠；次级 = 方形裂纹贴花（<see cref="Ch3Crack"/>）+ 一圈紫褐尘团；
        /// 点缀 = 一圈方铜渣往外崩、火星。
        /// 不用通用砸地预设（它的裂纹贴花是一圈白色放射纹，读成旱魃的日轮）；第三章的地裂以前借熔铜贴花，现在是自己的方形裂纹（坑里那一汪就是熔铜）。
        /// 闪光压低贴地，不盖住砸下来的身体
        /// </summary>
        public static void WarlordImpact(Vector3 ground, float radius, float fury)
        {
            if (!Finite(ground)) return;
            Burst(ground + Vector3.up * 0.3f, WarlordPalette.Smoke, Mathf.RoundToInt(3 + radius), 3.5f + radius, 0.7f, 0.6f, -0.8f);
            MoltenBurst(ground + Vector3.up * 0.3f, radius * 0.5f, false, WarlordPalette.CopperAt(fury));
            Ch3Crack(ground, radius * 1.1f, fury);
            Ring(ground + Vector3.up * 0.08f, radius * 1.15f, WarlordPalette.DeepAt(fury), 0.42f);
            // 方铜渣：中心一蓬铁片预设（一个粒子系统），外圈每个方向只甩火星
            Basalt(ground + Vector3.up * 0.2f, 0.35f * radius, Color.Lerp(WarlordPalette.Slag, WarlordPalette.Deep, 0.35f));
            int n = Mathf.Clamp(Mathf.RoundToInt(radius), 4, 6);
            float a0 = Random.value * Mathf.PI * 2f;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i / (float)n * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Sin(a), 0.6f, Mathf.Cos(a));
                WarlordShards(ground + new Vector3(d.x, 0, d.z) * radius * 0.45f + Vector3.up * 0.2f, d, 0.6f, fury, false);
            }
            Flash(ground + Vector3.up * 0.5f, WarlordPalette.CopperAt(fury), 6f, radius * 2.4f, 0.22f);
        }

        /// <summary>
        /// 竖劈入地的裂地线：从 from 沿 dir 一节一节往前崩开的熔铜裂口（每 0.04 s 一节：熔铜小冠 + 方铜渣 + 贴地火舌），读作「这一刀劈到哪」。
        /// 计时挂在特效根下的一次性序列上（<see cref="WarlordFxSequence"/>），不占首领身上的倒下时间轴
        /// </summary>
        public static void WarlordCleave(Vector3 from, Vector3 dir, float length, float fury)
        {
            if (!Finite(from)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            int n = Mathf.Clamp(Mathf.RoundToInt(length / 1.5f), 2, 4);
            var seq = WarlordFxSequence.Start();
            if (!seq) return;
            for (int i = 0; i < n; i++)
            {
                float k = (i + 1) / (float)n;
                var p = from + dir * (length * k);
                float gy = GroundY(p + Vector3.up * 2f, 4f);
                if (!float.IsNegativeInfinity(gy)) p.y = gy;
                float s = Mathf.Lerp(1f, 0.6f, k);
                seq.At(i * 0.04f, () =>
                {
                    MoltenSplat(p, 0.9f * s, 1f, 4f);
                    WarlordShards(p + Vector3.up * 0.15f, Vector3.up + dir * 0.4f, s, fury, k >= 0.99f);
                    if (k >= 0.99f) FlameTongues.Ground(p, 0.6f, 3, 0.7f, 0.45f, WarlordPalette.HotAt(fury), WarlordPalette.CopperAt(fury), WarlordPalette.DeepAt(fury));
                });
            }
        }

        /// <summary>
        /// 号令天火（陨石雨举剑那一刻）：剑尖一道冲天的熔铜光柱（主形，0.45 s 收掉）、剑尖一闪、头顶天上一团火光（陨火从那里来）
        /// </summary>
        public static void WarlordBeacon(Vector3 tip, float fury)
        {
            if (!Finite(tip)) return;
            var sky = tip + Vector3.up * 26f;
            Beam(tip, sky, WarlordPalette.CopperAt(fury), 0.55f, 0.45f);
            Beam(tip, sky, WarlordPalette.HotAt(fury), 0.18f, 0.32f);
            Flash(tip, WarlordPalette.CopperAt(fury), 8f, 9f, 0.25f);
            Burst(tip, WarlordPalette.HotAt(fury), 10, 6f, 0.35f, 0.1f, -4f);
            Burst(sky, WarlordPalette.CopperAt(fury), 16, 5f, 0.7f, 0.5f, 0f);
        }

        /// <summary>
        /// 狂怒换挡的那一下（20%，转阶段咆哮炸开的那一帧）：白热冲击粗环 + 紫褐烟环 + 全身往外喷的熔铜火星 + 一闪；之后的常驻样子见 <see cref="WarlordBlade"/> 与 WarlordBrain
        /// </summary>
        public static void WarlordFuryShift(Vector3 feet, Vector3 chest)
        {
            if (!Finite(feet)) return;
            Ring(feet + Vector3.up * 0.1f, 9f, WarlordPalette.FuryDeep, 0.55f);
            Ring(feet + Vector3.up * 0.12f, 5f, WarlordPalette.FuryHot, 0.35f, false);
            WarlordSmoke(feet + Vector3.up * 0.4f, 2.6f, 6);
            MoltenBurst(chest, 1.6f, false, WarlordPalette.FuryCopper);
            Burst(chest, WarlordPalette.FuryHot, 26, 11f, 0.5f, 0.12f, 2f);
            Flash(chest, WarlordPalette.FuryCopper, 10f, 14f, 0.35f);
        }

        /// <summary>紫褐烟团（收招、刹停、落地后的余韵）：几团慢慢往上飘、很快淡掉的烟</summary>
        public static void WarlordSmoke(Vector3 at, float radius, int count = 4)
        {
            if (!Finite(at)) return;
            for (int i = 0; i < count; i++)
            {
                var o = Random.insideUnitSphere * radius;
                o.y = Mathf.Abs(o.y) * 0.3f;
                Burst(at + o, WarlordPalette.Smoke, 1, 0.6f, 0.8f, 0.42f * Mathf.Clamp(radius, 0.6f, 1.6f), -1.2f);
            }
        }
    }

    /// <summary>一次性的特效时间轴：挂在特效根下，按 at 秒放一串动作，放完自己销毁（换关清场时随特效根一起没了）</summary>
    public sealed class WarlordFxSequence : MonoBehaviour
    {
        readonly List<(float at, System.Action run)> steps = new();
        float t;

        public static WarlordFxSequence Start()
        {
            var rt = FxRuntime.Ensure();
            if (!rt || !Application.isPlaying) return null;
            var go = new GameObject("Warlord Fx Sequence");
            go.transform.SetParent(rt.transform, false);
            return go.AddComponent<WarlordFxSequence>();
        }

        public WarlordFxSequence At(float at, System.Action run)
        {
            if (run != null) steps.Add((Mathf.Max(0, at), run));
            return this;
        }

        void Update()
        {
            t += Time.deltaTime;
            for (int i = steps.Count - 1; i >= 0; i--)
            {
                if (t < steps[i].at) continue;
                var run = steps[i].run;
                steps.RemoveAt(i);
                try
                {
                    run();
                }
                catch (System.Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (steps.Count == 0) Destroy(gameObject);
        }
    }

    /// <summary>
    /// 熔心魔将的月牙刀光（主形 · 暗月牙托亮刃，设计单 §1.3）：通用刀光 <see cref="SlashArc"/> 是等宽的加法光带，在 3-3 的暗红打光里容易叠成一片发白的浅带；
    /// 这里是专门的「月牙」——两头尖、中间厚（厚度按 sin^0.7 收），三层：
    ///   暗衬（普通混合，暗紫褐，比本体大一圈、略往外偏）→ 本体（普通混合的熔铜实色块：内缘赭红、外缘熔铜，两阶软阶梯）→ 刃口（加法，外缘一道白热线，刀头那一段最亮）。
    /// 时间：第一帧刀头就已经扫到 40%（释放帧亮芯第一帧到峰值），前 40% 寿命刀头缓出扫到尽头，之后刀尾从起点往刀头收掉、整体略往外扩。
    /// 池化（最多 10 道，满了复用最老的），网格顶点数固定，复用时只重写顶点位置 / 颜色。纯视觉，不做判定。
    /// </summary>
    public sealed class WarlordArc : MonoBehaviour, IFxSlot
    {
        const int Segments = 32, Rows = 4, MaxArcs = 10;
        /// <summary>每一圈在厚度方向的位置（0 = 内缘、1 = 外缘）</summary>
        static readonly float[] RowAt = { 0f, 0.45f, 0.86f, 1f };
        static readonly List<WarlordArc> pool = new();

        Mesh under, body, edge;
        MeshRenderer underR, bodyR, edgeR;
        Vector3[] pu, pb;
        Color[] cu, cb, ce;
        float age, life, radius, arc, width, fury;
        int dir, gen;
        bool active;

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;
        void IFxSlot.CancelFx() => life = Mathf.Min(life, age + 0.06f);
        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) { }
        void IFxSlot.MoveFx(Vector3 position) => transform.position = position;

        public static FxHandle Spawn(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float life, float fury, float pitchDeg = 0f)
        {
            if (!Fx.Finite(center) || !(radius > 0.1f)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            var s = Take(rt.transform);
            s.gen++;
            s.active = true;
            s.age = 0;
            s.life = Mathf.Max(0.08f, life);
            s.radius = radius;
            s.arc = Mathf.Clamp(arc, 0.2f, Mathf.PI * 2f);
            s.width = Mathf.Clamp(width, 0.1f, radius * 0.8f);
            s.dir = dir >= 0 ? 1 : -1;
            s.fury = Mathf.Clamp01(fury);
            s.transform.SetPositionAndRotation(center,
                Quaternion.Euler(0, yawDeg, 0) * Quaternion.AngleAxis(pitchDeg, Vector3.right) * Quaternion.AngleAxis(-tilt * Mathf.Rad2Deg, Vector3.forward));
            s.transform.localScale = Vector3.one;
            s.gameObject.SetActive(true);
            s.Paint();
            return new FxHandle(s);
        }

        static WarlordArc Take(Transform parent)
        {
            WarlordArc oldest = null;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.active) return x;
                if (!oldest || x.age / x.life > oldest.age / oldest.life) oldest = x;
            }
            if (pool.Count >= MaxArcs && oldest) return oldest;
            var go = new GameObject("Warlord Arc");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var a = go.AddComponent<WarlordArc>();
            a.Init();
            pool.Add(a);
            return a;
        }

        void Init()
        {
            int n = (Segments + 1) * Rows;
            pu = new Vector3[n];
            pb = new Vector3[n];
            cu = new Color[n];
            cb = new Color[n];
            ce = new Color[n];
            var uv = new Vector2[n];
            for (int i = 0; i <= Segments; i++)
                for (int k = 0; k < Rows; k++)
                    uv[i * Rows + k] = new Vector2(i / (float)Segments, RowAt[k]);
            var idx = new int[Segments * (Rows - 1) * 6];
            int w = 0;
            for (int i = 0; i < Segments; i++)
                for (int k = 0; k < Rows - 1; k++)
                {
                    int a = i * Rows + k, b = a + Rows;
                    idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                    idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
                }
            under = Make("Under", uv, idx, pu, cu);
            body = Make("Body", uv, idx, pb, cb);
            edge = Make("Edge", uv, idx, pb, ce);
            underR = AddRenderer("Under", under, FxMaterials.AlphaBlend, -2);
            bodyR = AddRenderer("Body", body, FxMaterials.AlphaBlend, -1);
            edgeR = AddRenderer("Edge", edge, FxMaterials.Additive, 0);
        }

        static Mesh Make(string name, Vector2[] uv, int[] idx, Vector3[] pos, Color[] col)
        {
            var m = new Mesh { name = "Warlord Arc " + name };
            m.MarkDynamic();
            m.vertices = pos;
            m.uv = uv;
            m.colors = col;
            m.triangles = idx;
            return m;
        }

        MeshRenderer AddRenderer(string name, Mesh m, Material mat, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return r;
        }

        void Paint()
        {
            float t = age / life;
            // 刀头：第一帧已在 40%，前 40% 寿命缓出扫到尽头；刀尾：35% 寿命起从起点往刀头收
            float head = Mathf.Lerp(0.4f, 1.12f, 1f - Mathf.Pow(1f - Mathf.Clamp01(t / 0.4f), 2.4f));
            float tail = Mathf.Clamp01((t - 0.35f) / 0.65f) * 1.15f;
            float grow = 1f + 0.08f * t;
            var hot = WarlordPalette.Vertex(WarlordPalette.HotAt(fury));
            var copper = WarlordPalette.Vertex(WarlordPalette.CopperAt(fury));
            var deep = WarlordPalette.Vertex(WarlordPalette.DeepAt(fury));
            var underC = WarlordPalette.Vertex(WarlordPalette.Under);
            for (int i = 0; i <= Segments; i++)
            {
                float u = i / (float)Segments;
                float a = (u - 0.5f) * arc * -dir;
                float sn = Mathf.Sin(a), cs = Mathf.Cos(a);
                // 两头尖、中间厚
                float thick = width * Mathf.Pow(Mathf.Max(0f, Mathf.Sin(Mathf.PI * u)), 0.7f);
                bool on = u <= head && u >= tail;
                float lead = on ? Mathf.Clamp01(1f - (head - u) * 3.5f) : 0f;
                float soft = on ? Mathf.Clamp01((head - u) * 12f) * Mathf.Clamp01((u - tail) * 6f) : 0f;
                for (int k = 0; k < Rows; k++)
                {
                    int v = i * Rows + k;
                    float r = (radius - thick * (1f - RowAt[k])) * grow;
                    pb[v] = new Vector3(sn * r, 0, cs * r);
                    float ru = (radius + width * 0.12f - thick * 1.18f * (1f - RowAt[k])) * grow;
                    pu[v] = new Vector3(sn * ru, 0, cs * ru);
                    // 暗衬：整弯压暗，外缘最浓
                    var cU = underC;
                    cU.a = soft * (k == 0 ? 0.35f : k == 3 ? 0.75f : 0.88f);
                    cu[v] = cU;
                    // 本体：内缘赭红 → 外缘熔铜（两阶实色，普通混合；不提亮，免得在泛光里冲成奶白），刀头一段略偏亮
                    var cB = k <= 1 ? deep : copper;
                    cB = Color.Lerp(cB, copper, lead * 0.4f * (k / 3f));
                    cB.a = soft * (k == 0 ? 0f : k == 1 ? 0.85f : k == 2 ? 0.95f : 0.55f);
                    cb[v] = cB;
                    // 刃口：只在最外一圈（厚度的外 14%）白热，刀头一段更亮
                    var cE = hot;
                    cE.a = soft * (k == 3 ? 0.85f : k == 2 ? 0.12f + 0.3f * lead : 0f);
                    ce[v] = cE;
                }
            }
            under.vertices = pu;
            under.colors = cu;
            under.RecalculateBounds();
            body.vertices = pb;
            body.colors = cb;
            body.RecalculateBounds();
            edge.vertices = pb;
            edge.colors = ce;
            edge.RecalculateBounds();
        }

        void Update()
        {
            if (!active) return;
            age += Time.deltaTime;
            if (age >= life)
            {
                active = false;
                gameObject.SetActive(false);
                return;
            }
            Paint();
        }

        void OnDestroy()
        {
            pool.Remove(this);
            if (under) Destroy(under);
            if (body) Destroy(body);
            if (edge) Destroy(edge);
        }
    }

    /// <summary>
    /// 熔心大剑（SM_BossWeapon_Greatsword，Unity 侧原来没挂上：部件骨架没有 socket_greatsword）+ 焰刃的常驻特效（设计单 §2）：
    ///   · 挂件：按蒙皮的绑定姿势（bindpose）把大剑对到握点骨 j_0_1_21_1_5 上（两份资产同一套导出，资产空间一致）；再按剑尖骨校一次朝向；
    ///   · 焰刃：剑身自发光走正式的 _E 发光遮罩（第二批收尾 C 路：art/pipeline/tools/emission_mask.py 的 warlord_sword，
    ///     R = 剑脊熔铜纹、G = 刃口；剑格 / 剑柄 / 配重不亮），写 SF_StylizedLit 的发光遮罩段（_GlowMask / _GlowMaskColor0..1，默认全黑跳过）。
    ///     平时剑脊留一点余烬、刃口几乎不亮；前摇（<see cref="Heat"/>）烧亮，狂怒（<see cref="Fury"/>）剑脊转亮铜、刃口白热。
    ///     （原来借底色贴图当 _EmissionMap，但大剑材质没开 _EMISSION 关键字，属性块开不了关键字——那层自发光其实一直没画出来。）
    ///     边光同步转白热；剑尖滴铜火星；狂怒时剑身两片火舌；
    ///   · 拖影（次级 · 暗月牙托亮刃，跟着真实的刀走）：<see cref="Smear"/> 起到 <see cref="EndSmear"/> 止，每帧记下剑身，
    ///     相邻两帧之间按握点插 3 份弧线（转角 slerp），画成两层带子：普通混合的暗衬（整条刀带压暗）+ 加法的亮刃（靠剑尖那一半最亮），0.2 s 内淡掉。
    /// 预算：拖影是一个对象两张固定顶点数的网格；火星走 <see cref="Fx.Burst"/>（<see cref="FxBudget"/>）；低画质拖影段数减半、不插值。
    /// </summary>
    public sealed class WarlordBlade : MonoBehaviour
    {
        static readonly int GlowMaskId = Shader.PropertyToID("_GlowMask"), Glow0Id = Shader.PropertyToID("_GlowMaskColor0"),
            Glow1Id = Shader.PropertyToID("_GlowMaskColor1"), GlowShimmerId = Shader.PropertyToID("_GlowMaskShimmer"),
            RimColorId = Shader.PropertyToID("_RimColor"), RimStrengthId = Shader.PropertyToID("_RimStrength");

        /// <summary>剑身发光遮罩的贴图名（BC 去掉 _BC；Resources/Fx/GlowMasks/&lt;名&gt;_E.png）</summary>
        public const string MaskKey = "T_BossWeapon_Greatsword";

        const int MaxSamples = 40, Rows = 4;
        /// <summary>带子的四圈：沿剑身的位置（握点 → 剑尖 = 0..1）、亮刃亮度、白热程度、暗衬浓度</summary>
        static readonly float[] RowAt = { 0.3f, 0.72f, 0.96f, 1.06f };
        static readonly float[] RowEdge = { 0f, 0.55f, 1f, 0f };
        static readonly float[] RowHot = { 0f, 0.15f, 1f, 0.5f };
        static readonly float[] RowUnder = { 0.25f, 0.8f, 1f, 0.6f };

        public Transform grip, tip;
        /// <summary>前摇烧亮程度（0..1，WarlordBrain 每帧写）与狂怒换挡（0..1）</summary>
        public float Heat, Fury;
        [Tooltip("剑身走 _E 发光遮罩（关掉 = 只有边光；审阅截图切改前 / 改后用）")] public bool maskGlow = true;
        /// <summary>此刻写出去的剑脊 / 刃口发光强度（线性倍率，测试用）</summary>
        public float SpineGlow { get; private set; }
        public float EdgeGlow { get; private set; }
        /// <summary>剑身拿到了正式的发光遮罩</summary>
        public bool HasMask => emissionMask;
        /// <summary>剑长（米，握点 → 剑尖）</summary>
        public float Length { get; private set; } = 2.7f;
        /// <summary>拖影正在记录 / 还有没淡完的段</summary>
        public bool Smearing => smearing;
        public int SmearCount { get; private set; }

        Renderer[] renderers;
        MaterialPropertyBlock block;
        Texture2D emissionMask;
        Color rimBase = new(1f, 0.95f, 0.85f);
        float rimStrengthBase = 0.3f, emberAcc;
        readonly FlameTongue[] flames = new FlameTongue[2];

        // 拖影
        struct Sample
        {
            public Vector3 g, d;
            public float t;
        }

        readonly List<Sample> samples = new();
        bool smearing;
        float smearUntil;
        Mesh mesh, underMesh;
        MeshRenderer addR, underR;
        Vector3[] pos;
        Color[] colAdd, colUnder;
        GameObject trailGo;

        public Vector3 Tip => tip ? tip.position : transform.position;
        public Vector3 Grip => grip ? grip.position : transform.position;
        public Vector3 Dir => (Tip - Grip).sqrMagnitude > 1e-6f ? (Tip - Grip).normalized : -transform.up;

        /// <summary>
        /// 把熔心大剑挂到握点骨上：prefab = 挂件预制体（EnemyCatalog.Attachments 里 bind = boss_warlord / greatsword 的那个），
        /// body = 本体的蒙皮渲染器（取握点骨的绑定姿势），tipBone = 剑尖骨（校朝向）。失败返回 null
        /// </summary>
        public static WarlordBlade Attach(GameObject prefab, Transform gripBone, Transform tipBone, SkinnedMeshRenderer body)
        {
            if (!prefab || !gripBone) return null;
            var inst = Instantiate(prefab, gripBone, false);
            inst.name = prefab.name;
            foreach (var c in inst.GetComponentsInChildren<Collider>(true))
            {
                c.enabled = false;
                Destroy(c);
            }
            // 绑定姿势：握点骨在蒙皮空间里的样子 = bindpose⁻¹；大剑网格的「资产空间」= 本体网格的资产空间，原点放在握点（剑柄），剑尖朝下
            var meshNode = inst.GetComponentInChildren<MeshRenderer>(true);
            int bi = body && body.bones != null ? System.Array.IndexOf(body.bones, gripBone) : -1;
            if (bi >= 0 && bi < body.sharedMesh.bindposes.Length && meshNode)
            {
                var bind = body.sharedMesh.bindposes[bi];
                var gripInSmr = bind.inverse.GetColumn(3);
                var swordMeshToRoot = inst.transform.worldToLocalMatrix * meshNode.transform.localToWorldMatrix;
                var rootLocal = bind * Matrix4x4.Translate(gripInSmr) * swordMeshToRoot.inverse;
                inst.transform.localPosition = rootLocal.GetColumn(3);
                inst.transform.localRotation = rootLocal.rotation;
                inst.transform.localScale = rootLocal.lossyScale;
            }
            var blade = inst.AddComponent<WarlordBlade>();
            blade.grip = gripBone;
            blade.tip = tipBone;
            blade.Init(meshNode);
            return blade;
        }

        void Init(Renderer meshNode)
        {
            // 校朝向：剑身（挂件资产空间的 -Y = 根节点的 -Y；网格节点带导入的轴向换算，不能用它的轴）对准握点 → 剑尖骨
            if (tip && grip && meshNode)
            {
                var want = tip.position - grip.position;
                var have = -transform.up;
                if (want.sqrMagnitude > 1e-4f)
                {
                    float off = Vector3.Angle(have, want);
                    if (off > 4f) transform.rotation = Quaternion.FromToRotation(have, want.normalized) * transform.rotation;
                    Length = want.magnitude;
                    if (off > 4f) Debug.Log($"[WarlordBlade] 绑定姿势对出来的剑身和剑尖骨差 {off:F1}°，已校正");
                }
            }
            // 只有大剑自己的网格（拖影挂在特效根下、火舌挂在握点骨上，都不在这里）
            var list = new List<Renderer>();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (r is MeshRenderer or SkinnedMeshRenderer && !r.GetComponent<FlameTongue>())
                    list.Add(r);
            renderers = list.ToArray();
            block = new MaterialPropertyBlock();
            var mat = meshNode ? meshNode.sharedMaterial : null;
            if (mat)
            {
                // 正式遮罩只配正式大剑的贴图（白盒 / 别的贴图没有遮罩：只走边光）
                var bc = mat.HasProperty("_BaseMap") ? mat.GetTexture("_BaseMap") : mat.mainTexture;
                if (bc && bc.name.StartsWith(MaskKey, System.StringComparison.Ordinal) && mat.HasProperty(GlowMaskId)) emissionMask = GlowMask.LoadMask(MaskKey);
                if (mat.HasProperty(RimColorId)) rimBase = mat.GetColor(RimColorId);
                if (mat.HasProperty(RimStrengthId)) rimStrengthBase = mat.GetFloat(RimStrengthId);
            }
            BuildTrail();
        }

        void Update()
        {
            float dt = Time.deltaTime;
            float glow = Mathf.Clamp01(Mathf.Max(Heat, Fury * 0.75f));
            var hot = WarlordPalette.HotAt(Fury);
            var copper = WarlordPalette.CopperAt(Fury);
            // 剑身发光遮罩：剑脊熔铜纹平时留一点余烬（熔铜橙），前摇烧亮、狂怒转亮铜带一点白；刃口平时几乎不亮，前摇烧成白热铜、狂怒常亮白热。
            // 层色转线性再乘强度、按向量写（同 GlowMask：SetColor 会把 > 1 的强度也做一遍伽马换算）
            bool lit = maskGlow && emissionMask;
            SpineGlow = lit ? 0.3f + 1.7f * glow + 0.5f * Fury : 0;
            EdgeGlow = lit ? 0.1f + 1.5f * glow + 1.2f * Fury : 0;
            var spine = (Vector4)(Color.Lerp(copper, hot, 0.3f * Fury).linear * SpineGlow);
            var edge = (Vector4)(Color.Lerp(copper, hot, 0.45f + 0.55f * Fury).linear * EdgeGlow);
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                if (emissionMask) block.SetTexture(GlowMaskId, emissionMask);
                block.SetVector(Glow0Id, spine);
                block.SetVector(Glow1Id, edge);
                // 剑脊的熔铜沿剑身流动闪烁，刃口稳一点
                block.SetVector(GlowShimmerId, new Vector4(0.4f, 0.15f, 0f, 7f));
                block.SetColor(RimColorId, Color.Lerp(rimBase, hot, glow));
                block.SetFloat(RimStrengthId, Mathf.Lerp(rimStrengthBase, 1.6f, glow));
                r.SetPropertyBlock(block);
            }
            // 剑尖滴铜火星（烧亮时更密）
            emberAcc += dt * (0.8f + 5f * glow);
            if (emberAcc >= 1f)
            {
                emberAcc = 0;
                Fx.Burst(Vector3.Lerp(Grip, Tip, Random.Range(0.55f, 1f)), copper, 2, 1.2f, 0.45f, 0.07f, 6f);
            }
            // 狂怒：剑身两片火舌（火苗永远往上窜）
            for (int i = 0; i < flames.Length; i++)
            {
                if (Fury < 0.01f && !flames[i]) continue;
                if (!flames[i] && grip)
                {
                    flames[i] = FlameTongue.Attach(grip, Vector3.zero, Vector3.one, WarlordPalette.FuryHot, WarlordPalette.FuryCopper, WarlordPalette.FuryDeep);
                    if (!flames[i]) continue;
                }
                float at = i == 0 ? 0.42f : 0.8f;
                flames[i].transform.position = Vector3.Lerp(Grip, Tip, at);
                float s = (i == 0 ? 1.15f : 0.9f) * (0.85f + 0.15f * Mathf.Sin(Time.time * 9f + i));
                flames[i].Set(Fury * 0.9f, new Vector3(s, s * 1.6f, s));
            }
        }

        // ───────────── 拖影 ─────────────

        /// <summary>开始记拖影（片段的 smear 事件），最长 seconds 秒后自己停</summary>
        public void Smear(float seconds = 0.35f)
        {
            if (!smearing) samples.Clear();
            smearing = true;
            smearUntil = Time.time + Mathf.Max(0.05f, seconds);
            SmearCount++;
            Record();
        }

        /// <summary>停止记录（片段的 smearEnd 事件 / 释放帧之后）：已有的段 0.2 s 内淡掉</summary>
        public void EndSmear() => smearing = false;

        void Record()
        {
            if (!grip || !tip) return;
            var s = new Sample { g = Grip, d = Dir, t = Time.time };
            bool fine = QualityProfile.Current.particleDensity > 0.5f;
            if (samples.Count > 0 && fine)
            {
                // 相邻两帧之间插 3 份：握点线性、剑身方向 slerp（大剑挥过的是弧，不是弦）
                var p = samples[^1];
                for (int k = 1; k <= 3; k++)
                {
                    float u = k / 4f;
                    samples.Add(new Sample { g = Vector3.Lerp(p.g, s.g, u), d = Vector3.Slerp(p.d, s.d, u), t = Mathf.Lerp(p.t, s.t, u) });
                }
            }
            samples.Add(s);
            while (samples.Count > MaxSamples) samples.RemoveAt(0);
        }

        void LateUpdate()
        {
            if (smearing)
            {
                if (Time.time > smearUntil) smearing = false;
                else Record();
            }
            const float Fade = 0.2f;
            samples.RemoveAll(x => Time.time - x.t > Fade + 0.12f);
            bool show = samples.Count >= 2;
            if (addR) addR.enabled = show;
            if (underR) underR.enabled = show;
            if (!show) return;
            PaintTrail(Fade);
        }

        void BuildTrail()
        {
            trailGo = new GameObject("Blade Smear");
            trailGo.transform.SetParent(FxRuntime.Ensure() ? FxRuntime.Ensure().transform : null, false);
            int n = MaxSamples * Rows;
            pos = new Vector3[n];
            colAdd = new Color[n];
            colUnder = new Color[n];
            var uv = new Vector2[n];
            for (int i = 0; i < MaxSamples; i++)
                for (int k = 0; k < Rows; k++)
                    uv[i * Rows + k] = new Vector2(i / (float)(MaxSamples - 1), RowEdge[k] > 0 ? 0.6f + 0.4f * RowEdge[k] : k == 0 ? 0f : 1f);
            var idx = new int[(MaxSamples - 1) * (Rows - 1) * 6];
            int w = 0;
            for (int i = 0; i < MaxSamples - 1; i++)
                for (int k = 0; k < Rows - 1; k++)
                {
                    int a = i * Rows + k, b = a + Rows;
                    idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                    idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
                }
            mesh = NewMesh("Blade Smear", uv, idx, colAdd);
            underMesh = NewMesh("Blade Smear Underlay", uv, idx, colUnder);
            underR = AddRenderer(trailGo, "Under", underMesh, FxMaterials.AlphaBlend, -1);
            addR = AddRenderer(trailGo, "Edge", mesh, FxMaterials.Additive, 0);
        }

        Mesh NewMesh(string name, Vector2[] uv, int[] idx, Color[] col)
        {
            var m = new Mesh { name = name };
            m.MarkDynamic();
            m.vertices = pos;
            m.uv = uv;
            m.colors = col;
            m.triangles = idx;
            return m;
        }

        static MeshRenderer AddRenderer(GameObject parent, string name, Mesh m, Material mat, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.enabled = false;
            return r;
        }

        void PaintTrail(float fade)
        {
            float now = Time.time, len = Length;
            var hot = WarlordPalette.Vertex(WarlordPalette.HotAt(Fury));
            var tint = WarlordPalette.Vertex(WarlordPalette.CopperAt(Fury));
            var under = WarlordPalette.Vertex(WarlordPalette.Under);
            int count = samples.Count;
            for (int i = 0; i < MaxSamples; i++)
            {
                // 最旧的在前；不足 MaxSamples 时多出来的点叠在最新一段上（零面积）
                var s = samples[Mathf.Clamp(i - (MaxSamples - count), 0, count - 1)];
                float age = now - s.t;
                float life = Mathf.Clamp01(1f - age / fade);
                float head = i >= MaxSamples - 6 ? 1f : 0.6f;
                for (int k = 0; k < Rows; k++)
                {
                    int v = i * Rows + k;
                    pos[v] = s.g + s.d * (len * RowAt[k]);
                    float a = life * life * RowEdge[k];
                    var c = Color.Lerp(tint, hot, RowHot[k] * head);
                    c.a = Mathf.Clamp01(a * 1.2f);
                    colAdd[v] = c;
                    var u = under;
                    u.a = Mathf.Clamp01(life * RowUnder[k] * 0.7f);
                    colUnder[v] = u;
                }
            }
            mesh.vertices = pos;
            mesh.colors = colAdd;
            mesh.RecalculateBounds();
            underMesh.vertices = pos;
            underMesh.colors = colUnder;
            underMesh.RecalculateBounds();
        }

        void OnDestroy()
        {
            if (trailGo) Destroy(trailGo);
            if (mesh) Destroy(mesh);
            if (underMesh) Destroy(underMesh);
            foreach (var f in flames)
                if (f)
                    Destroy(f.gameObject);
        }
    }
}
