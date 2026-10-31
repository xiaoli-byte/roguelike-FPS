using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第四章雷魅的调色板（docs/art/vfx/foes-ch4.md 0.2）：腐化雷光「邪火紫红、白芯」三阶 + 高原环境色。
    /// 写顶点色前一律过 <see cref="V"/>（线性色彩空间，见 <see cref="FxVertexColor"/>）
    /// </summary>
    public static class PlateauPalette
    {
        /// <summary>亮芯粉白 / 主色紫红 / 暗边靛紫（与 TelegraphPalette.Thunder / ThunderBacking 同色）</summary>
        public static readonly Color Core = Hex.Rgb(0xfff2fb), Bolt = Hex.Rgb(0xff4fd8), Deep = Hex.Rgb(0x4a1a6e);
        /// <summary>静电护盾淡紫、红鼓加速珊瑚红</summary>
        public static readonly Color Shield = Hex.Rgb(0xc79bff), Haste = Hex.Rgb(0xff8f7a);
        /// <summary>高原尘灰褐、雪粒冷白、草屑青绿、石块</summary>
        public static readonly Color Dust = Hex.Rgb(0x9a8a6c), Snow = Hex.Rgb(0xe6edf4), Grass = Hex.Rgb(0x6f8f3e), Rock = Hex.Rgb(0x6e665e);
        /// <summary>羽毛（灰白 / 墨褐）、鼓（木 / 皮）、帝江红皮</summary>
        public static readonly Color FeatherLight = Hex.Rgb(0xe9e4da), FeatherDark = Hex.Rgb(0x4a3e36), DrumWood = Hex.Rgb(0x8a6a3a), DrumSkin = Hex.Rgb(0xc8a070);
        public static readonly Color Skin = Hex.Rgb(0xc0402a), Shadow = new(0.11f, 0.07f, 0.12f, 1f);
        /// <summary>燎的火（蓑毛燃烧）：主色橙红 / 金黄 / 赭红烟</summary>
        public static readonly Color Fire = Hex.Rgb(0xff6a1a), FireHot = Hex.Rgb(0xffd24a), FireSmoke = Hex.Rgb(0x5a3a2a);

        public static Color V(Color c) => FxVertexColor.Linear(c);
        public static Color A(Color c, float a) => new(c.r, c.g, c.b, a);
    }

    public static partial class Fx
    {
        // ───────────── 雷刃（主形：折线锯齿 + 少量分叉，粗细有对比，三阶色）─────────────

        /// <summary>
        /// 一道紫红雷刃（<see cref="PlateauBoltFx"/>）：from → to，width = 身的宽度（米），life 秒（≤ 0 = 常驻，直到 Cancel；句柄 Retarget 挪两端），
        /// branches 分叉数（0–2），taper = 起点相对终点的粗细（0.45 = 起点细、到终点粗：天上劈下来的雷越到地上越粗；&gt; 1 反过来）。
        /// essential = false 的是点缀（身上噼啪、电场爬电）：按 FxBudget 让路
        /// </summary>
        public static FxHandle PlateauBolt(Vector3 from, Vector3 to, float width = 0.08f, float life = 0.18f, int branches = 1, float taper = 1f, bool essential = true)
        {
            if (!Finite(from) || !Finite(to)) return FxHandle.None;
            if (!essential && FxBudget.Allow(Mathf.Max(1, Mathf.RoundToInt(Density)), false) <= 0) return FxHandle.None;
            return PlateauBoltFx.Spawn(from, to, width, life, branches, taper);
        }

        /// <summary>常驻电弧（电网、比翼、鼓点连线）：句柄每帧 Retarget，Cancel 时 0.08 s 缩回两端</summary>
        public static FxHandle PlateauArc(Vector3 from, Vector3 to, float width = 0.05f) => PlateauBolt(from, to, width, 0, 0, 1f);

        /// <summary>天上劈到地上的一道粗雷刃（吞雷、装饰雷）：顶上细、到地上粗，两道分叉，落点一闪</summary>
        public static void PlateauSkyBolt(Vector3 ground, float height = 16f, float width = 0.22f)
        {
            if (!Finite(ground)) return;
            var top = ground + new Vector3(Random.Range(-2f, 2f), height, Random.Range(-2f, 2f));
            PlateauBolt(top, ground, width, 0.2f, 2, 0.45f);
            Flash(ground + Vector3.up, PlateauPalette.Bolt, 8, 10, 0.14f);
        }

        /// <summary>出手闪光（白星）：0.25 s 后就打（combat 0.2）</summary>
        public static void PlateauGlint(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            Play("Flare", at, Vector3.up, PlateauPalette.Core, Mathf.Max(0.4f, size));
            Play("ToonBurst", at, Vector3.up, PlateauPalette.Bolt, Mathf.Max(0.3f, size * 0.6f));
        }

        /// <summary>带电的噼啪：中心 radius 内随机两点之间一道短雷刃（点缀，过预算就不出）</summary>
        public static void PlateauCrackle(Vector3 center, float radius)
        {
            if (!Finite(center)) return;
            var a = center + new Vector3(Random.Range(-1f, 1f), Random.Range(-0.6f, 1f), Random.Range(-1f, 1f)) * radius;
            var b = center + new Vector3(Random.Range(-1f, 1f), Random.Range(-0.6f, 1f), Random.Range(-1f, 1f)) * radius;
            PlateauBolt(a, b, 0.03f, Random.Range(0.08f, 0.14f), 0, 1f, false);
        }

        /// <summary>一圈往外的短雷刃（雷球砸地的环、球雷、雷球熄灭时放的小电）：count 道，从 radius 处往外伸 length</summary>
        public static void PlateauArcRing(Vector3 center, float radius, int count, float length, float life = 0.2f, float width = 0.05f)
        {
            if (!Finite(center)) return;
            int n = Mathf.Max(1, Mathf.RoundToInt(count * Mathf.Lerp(0.5f, 1f, Mathf.Clamp01(FxBudget.StyleCapScale))));
            float a0 = Random.value * Mathf.PI * 2;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i * Mathf.PI * 2 / n + Random.Range(-0.15f, 0.15f);
                var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                var p0 = center + dir * radius + Vector3.up * 0.15f;
                var p1 = center + dir * (radius + length) + Vector3.up * Random.Range(0.1f, 0.6f);
                PlateauBolt(p0, p1, width, life * Random.Range(0.8f, 1.2f), 0, 1.3f, i % 3 != 0);
            }
        }

        // ───────────── 贴地 / 立体的形（符印、电场、影子、声环、球壳）─────────────

        /// <summary>天狗雷标：符印圆（圈 + 四齿 + 震卦三爻），跟着人走、定格后齿往里收（<see cref="PlateauShapeHandle.Lock"/>）</summary>
        public static PlateauShapeHandle PlateauSigil(Vector3 center, float radius) =>
            PlateauShape.Spawn(PlateauShape.Kind.Sigil, center, Vector3.up, radius, float.PositiveInfinity, 40f);

        /// <summary>雷石电场：圈 + 四齿 + 淡紫底，圈里每 0.08 s 爬一道贴地短雷刃，seconds 秒（最后 1 s 淡出）</summary>
        public static PlateauShapeHandle PlateauField(Vector3 center, float radius, float seconds) =>
            PlateauShape.Spawn(PlateauShape.Kind.Field, center, Vector3.up, radius, seconds, 18f);

        /// <summary>穷奇滑翔的影子（暗紫褐软边圆；句柄每帧 MoveTo / SetRadius / SetAlpha）</summary>
        public static PlateauShapeHandle PlateauShadow(Vector3 center, float radius) =>
            PlateauShape.Spawn(PlateauShape.Kind.Shadow, center, Vector3.up, radius, float.PositiveInfinity, 0);

        /// <summary>焦痕（落雷、雷石落点、砸地）：暗紫褐的星芒斑，seconds 秒淡掉</summary>
        public static void PlateauScorch(Vector3 center, float radius, float seconds = 3f) =>
            PlateauShape.Spawn(PlateauShape.Kind.Scorch, center, Vector3.up, radius, seconds, 0);

        /// <summary>啸獭尖啸：三圈竖直的声环从 at 往外扩到 maxRadius（0.6 s，一圈比一圈晚 0.08 s）</summary>
        public static void PlateauScream(Vector3 at, float maxRadius)
        {
            if (!Finite(at)) return;
            for (int i = 0; i < 3; i++)
            {
                int k = i;
                PlateauFxSeq.After(0.08f * i, () =>
                {
                    var h = PlateauShape.Spawn(PlateauShape.Kind.Wall, at - Vector3.up * 0.4f, Vector3.up, 1.2f, 0.6f, 0);
                    h.Grow(maxRadius * (1f - 0.12f * k), 0.6f, 1.1f);
                });
            }
        }

        /// <summary>鼓面一闪：在 at 处、法线 normal 的平面上一圈往外扩的环（0.25 s）</summary>
        public static void PlateauFaceFlash(Vector3 at, Vector3 normal, float radius, Color color)
        {
            if (!Finite(at)) return;
            var h = PlateauShape.Spawn(PlateauShape.Kind.Ring, at, normal, radius * 0.3f, 0.25f, 0);
            h.Grow(radius, 0.25f, 1f);
            h.SetColor(color);
        }

        /// <summary>帝江球雷：一个紫红球壳从 0.5 扩到 radius（0.25 s）+ 一圈放射雷刃 + 中心白闪；fire = 被火打死的（火 + 紫红两层）</summary>
        public static void PlateauBallLightning(Vector3 center, float radius, bool fire = false)
        {
            if (!Finite(center)) return;
            var h = PlateauShape.Spawn(PlateauShape.Kind.Sphere, center, Vector3.up, 0.5f, 0.28f, 0);
            h.Grow(radius, 0.25f, 1f);
            if (fire)
            {
                Play("ToonFire", center, Vector3.up, PlateauPalette.Fire, radius * 0.5f);
                Play("ToonSmoke", center, Vector3.up, PlateauPalette.FireSmoke, radius * 0.35f);
            }
            int n = Mathf.RoundToInt(12 * Mathf.Clamp01(FxBudget.StyleCapScale + 0.2f));
            for (int i = 0; i < n; i++)
            {
                var d = Random.onUnitSphere;
                if (d.y < -0.3f) d.y = -d.y;
                PlateauBolt(center + d * 0.3f, center + d * radius * Random.Range(0.8f, 1.1f), 0.06f, Random.Range(0.14f, 0.22f), 0, 1.4f, i % 2 == 1);
            }
            Play("ToonBurst", center, Vector3.up, PlateauPalette.Core, radius * 0.45f);
            Flash(center, PlateauPalette.Bolt, 9, radius * 3f, 0.16f);
            Burst(center, PlateauPalette.Bolt, 20, 8, 0.4f, 0.1f, 6);
        }

        // ───────────── 月牙（切割：四角挑、翼刃、爪痕）─────────────

        /// <summary>
        /// 紫红月牙（<see cref="PlateauCrescentFx"/>，暗衬托亮刃）：center 圆心、yaw 中线朝向（度）、radius 半径、arc 弧长（弧度）、dir 扫的方向（±1）、
        /// tilt 绕中线侧倾（弧度）、width 厚度、life 秒、pitch 绕横轴俯仰（度：−90 = 竖直的月牙）
        /// </summary>
        public static FxHandle PlateauCrescent(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float life = 0.2f, float pitchDeg = 0)
        {
            if (!Finite(center)) return FxHandle.None;
            return PlateauCrescentFx.Spawn(center, yawDeg, radius, arc, dir, tilt, width, life, pitchDeg);
        }

        /// <summary>三道爪痕（扑咬、爪击）：at 处、朝 forward，斜着往下划的三道小月牙</summary>
        public static void PlateauClaw(Vector3 at, Vector3 forward, float size, int dir = 1)
        {
            if (!Finite(at)) return;
            forward.y = 0;
            if (forward.sqrMagnitude < 1e-4f) forward = Vector3.forward;
            forward.Normalize();
            var right = new Vector3(forward.z, 0, -forward.x);
            float yaw = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg;
            for (int i = -1; i <= 1; i++)
                PlateauCrescent(at + right * (i * 0.22f * size) - forward * 0.35f * size, yaw, 0.55f * size, 1.5f, dir, 0.35f * dir, 0.12f * size, 0.14f, -62f);
        }

        // ───────────── 点缀（土、毛、羽、火）─────────────

        /// <summary>方块土团 + 灰褐尘（钻洞、踩踏、落石）</summary>
        public static void PlateauDirt(Vector3 at, float size, int chunks = 8)
        {
            if (!Finite(at)) return;
            Burst(at + Vector3.up * 0.1f, PlateauPalette.Dust, Mathf.Max(2, chunks / 2), 3 * size, 0.6f, 0.35f * size, 2);
            Play("Chunk", at, Vector3.up, PlateauPalette.Rock, size * Mathf.Clamp(chunks / 8f, 0.4f, 2f));
            Play("ToonDust", at + Vector3.up * 0.05f, Vector3.up, PlateauPalette.Dust, size);
        }

        /// <summary>羽毛（蛮蛮受击 / 坠地）：灰白、墨褐两种，慢慢飘落</summary>
        public static void PlateauFeathers(Vector3 at, int count)
        {
            if (!Finite(at)) return;
            float s = Mathf.Clamp(count / 6f, 0.4f, 3f);
            Play("Paper", at, Vector3.up, PlateauPalette.FeatherLight, s);
            Play("Paper", at, Vector3.up, PlateauPalette.FeatherDark, s * 0.6f);
        }

        /// <summary>蓑毛燃烧：一簇往上窜的卡通火舌 + 赭红烟</summary>
        public static void PlateauFurFlame(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            Play("ToonFlame", at, Vector3.up, PlateauPalette.Fire, size);
            if (Random.value < 0.4f) Play("Smoke", at + Vector3.up * 0.3f, Vector3.up, PlateauPalette.FireSmoke, size * 0.6f);
        }

        /// <summary>紫红电火花（毛尖炸毛、线上冒火花）</summary>
        public static void PlateauSparks(Vector3 at, int count, float speed = 3f, float size = 0.08f)
        {
            if (!Finite(at)) return;
            Burst(at, PlateauPalette.Bolt, count, speed, 0.3f, size, 4);
        }
    }

    // ═══════════════════════════════ 雷刃 ═══════════════════════════════

    /// <summary>
    /// 第四章的雷刃（设计单 0.1「折线锯齿 + 少量分叉、粗细有对比」，fx-style §3 雷；不是「细锯齿线 + 加法光晕」的占位）：
    /// 一条面向相机的带子，三层——暗衬（普通混合，靛紫，宽 2.4 倍）→ 身（普通混合，紫红）→ 芯（加法，粉白，宽 0.38 倍）。
    /// 折线：每段交替往两侧折（锯齿），振幅中间大、两头收；每节宽度随机 0.6–1.4 倍（粗细对比）、两端收尖。
    /// 短寿命的每 0.035–0.05 s 重抖一次、亮度 (1 − k²) × 闪烁；常驻的（电网、比翼）每 0.06–0.08 s 重抖，Cancel 时 0.08 s 缩回两端。
    /// 池化（上限 48 × 画质，满了复用最老的短寿命雷刃），网格顶点数固定；低画质去掉暗衬和分叉。
    /// </summary>
    public sealed class PlateauBoltFx : MonoBehaviour, IFxSlot
    {
        const int MaxSeg = 16, BranchSeg = 4, MaxBranches = 2;
        /// <summary>每层最多的点：主干 + 分叉，每段之后多一个断开用的零宽点</summary>
        const int MaxPts = MaxSeg + 2 + MaxBranches * (BranchSeg + 2);
        static readonly List<PlateauBoltFx> pool = new();
        static Camera cam;
        static int camFrame = -1;

        public static int MaxBolts => Mathf.Max(16, Mathf.RoundToInt(48 * FxBudget.StyleCapScale));
        /// <summary>累计生成过几道（冒烟测试用）</summary>
        public static int Spawned { get; private set; }
        public static int Active
        {
            get
            {
                int n = 0;
                foreach (var x in pool)
                    if (x && x.active)
                        n++;
                return n;
            }
        }

        Mesh shade, core;
        Vector3[] vs, vc;
        Color[] cs, cc;
        readonly Vector3[] pts = new Vector3[MaxSeg + 1];
        readonly float[] wid = new float[MaxSeg + 1];
        readonly Vector3[,] bpts = new Vector3[MaxBranches, BranchSeg + 1];
        readonly Vector3[] tmp = new Vector3[BranchSeg + 1];
        Vector3 a, b;
        float width, life, age, rejitter, flicker, taper, cancelAt = -1;
        int n, nb, gen;
        bool active, persistent, lowQ;

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;

        void IFxSlot.CancelFx()
        {
            if (!active) return;
            if (persistent)
            {
                if (cancelAt < 0) cancelAt = age;
            }
            else life = Mathf.Min(life, age + 0.05f);
        }

        void IFxSlot.RetargetFx(Vector3 from, Vector3 to)
        {
            if (!Fx.Finite(from) || !Fx.Finite(to)) return;
            a = from;
            b = to;
        }

        void IFxSlot.MoveFx(Vector3 position)
        {
            var d = position - a;
            a += d;
            b += d;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            pool.Clear();
            Spawned = 0;
            cam = null;
            camFrame = -1;
        }

        public static FxHandle Spawn(Vector3 from, Vector3 to, float width, float life, int branches, float taper)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            var s = Take(rt.transform);
            if (!s) return FxHandle.None;
            s.gen++;
            s.active = true;
            s.a = from;
            s.b = to;
            s.width = Mathf.Clamp(width, 0.01f, 1.5f);
            s.persistent = !(life > 0);
            s.life = s.persistent ? float.PositiveInfinity : Mathf.Clamp(life, 0.04f, 3f);
            s.age = 0;
            s.cancelAt = -1;
            s.taper = Mathf.Clamp(taper, 0.2f, 3f);
            s.lowQ = FxBudget.StyleCapScale < 0.75f;
            s.nb = s.lowQ ? 0 : Mathf.Clamp(branches, 0, MaxBranches);
            s.gameObject.SetActive(true);
            s.Jitter();
            s.Paint();
            Spawned++;
            return new FxHandle(s);
        }

        static PlateauBoltFx Take(Transform parent)
        {
            PlateauBoltFx oldest = null;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.active) return x;
                if (!x.persistent && (!oldest || x.age / x.life > oldest.age / oldest.life)) oldest = x;
            }
            if (pool.Count >= MaxBolts) return oldest;
            var go = new GameObject("Plateau Bolt");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var s = go.AddComponent<PlateauBoltFx>();
            s.Init();
            pool.Add(s);
            return s;
        }

        void Init()
        {
            // 每层每个点两个顶点；暗衬 + 身在一张网格（普通混合，先画暗衬），芯一张（加法）
            vs = new Vector3[MaxPts * 4];
            cs = new Color[MaxPts * 4];
            vc = new Vector3[MaxPts * 2];
            cc = new Color[MaxPts * 2];
            shade = new Mesh { name = "Plateau Bolt Shade" };
            shade.MarkDynamic();
            core = new Mesh { name = "Plateau Bolt Core" };
            core.MarkDynamic();
            shade.vertices = vs;
            shade.colors = cs;
            shade.triangles = Strips(MaxPts, 2);
            core.vertices = vc;
            core.colors = cc;
            core.triangles = Strips(MaxPts, 1);
            Add("Shade", shade, FxMaterials.AlphaBlend, 0);
            Add("Core", core, FxMaterials.Additive, 1);
        }

        /// <summary>layers 层、每层 pts 个点的带子索引（相邻点之间两个三角形；段与段之间靠零宽点断开）</summary>
        static int[] Strips(int pts, int layers)
        {
            var idx = new List<int>();
            for (int l = 0; l < layers; l++)
                for (int i = 0; i < pts - 1; i++)
                {
                    int v = (l * pts + i) * 2;
                    idx.Add(v); idx.Add(v + 1); idx.Add(v + 2);
                    idx.Add(v + 1); idx.Add(v + 3); idx.Add(v + 2);
                }
            return idx.ToArray();
        }

        void Add(string name, Mesh m, Material mat, int order)
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
        }

        /// <summary>重新抖一次折线（锯齿 + 分叉 + 每节宽度）</summary>
        void Jitter()
        {
            var d = b - a;
            float len = d.magnitude;
            n = Mathf.Clamp(Mathf.RoundToInt(len / 0.45f), 3, MaxSeg);
            var axis = len > 1e-4f ? d / len : Vector3.up;
            var p1 = Vector3.Cross(axis, Mathf.Abs(axis.y) < 0.9f ? Vector3.up : Vector3.right).normalized;
            var p2 = Vector3.Cross(axis, p1);
            float amp = Mathf.Clamp(len * 0.085f, 0.04f, 1.4f);
            float sgn = Random.value < 0.5f ? 1 : -1;
            for (int i = 0; i <= n; i++)
            {
                float t = i / (float)n;
                float env = Mathf.Pow(Mathf.Sin(Mathf.PI * t), 0.6f);
                sgn = -sgn;
                float x = sgn * Random.Range(0.35f, 1f) * amp * env, y = Random.Range(-0.4f, 0.4f) * amp * env;
                pts[i] = a + d * t + p1 * x + p2 * y;
                wid[i] = Random.Range(0.6f, 1.4f);
            }
            for (int k = 0; k < nb; k++)
            {
                int at = Mathf.Clamp(Mathf.RoundToInt(n * Random.Range(0.25f, 0.7f)), 1, n - 1);
                var dir = (axis + (p1 * Random.Range(-1f, 1f) + p2 * Random.Range(-1f, 1f)).normalized * 0.9f).normalized;
                float bl = len * Random.Range(0.15f, 0.3f);
                var o = pts[at];
                var q1 = Vector3.Cross(dir, p2).normalized;
                for (int i = 0; i <= BranchSeg; i++)
                {
                    float t = i / (float)BranchSeg;
                    bpts[k, i] = o + dir * bl * t + q1 * ((i % 2 == 0 ? 1 : -1) * Random.Range(0.2f, 0.6f) * amp * 0.5f * t);
                }
            }
            flicker = Random.Range(0.7f, 1f);
            rejitter = persistent ? Random.Range(0.06f, 0.08f) : Random.Range(0.035f, 0.05f);
        }

        void Paint()
        {
            if (camFrame != Time.frameCount)
            {
                camFrame = Time.frameCount;
                cam = Camera.main;
            }
            var eye = cam ? cam.transform.position : a + Vector3.back * 10;
            float k = persistent ? 0f : Mathf.Clamp01(age / life);
            float retract = persistent && cancelAt >= 0 ? Mathf.Clamp01((age - cancelAt) / 0.08f) : 0;
            float bright = (1 - k * k) * (1 - retract) * flicker;
            var under = PlateauPalette.V(PlateauPalette.A(PlateauPalette.Deep, (lowQ ? 0 : 0.6f) * bright));
            var body = PlateauPalette.V(PlateauPalette.A(PlateauPalette.Bolt, bright));
            var hot = PlateauPalette.V(PlateauPalette.A(PlateauPalette.Core, bright));
            int w = 0;
            WriteStrip(pts, n + 1, ref w, eye, under, body, hot, retract, true);
            for (int kb = 0; kb < nb; kb++)
            {
                for (int i = 0; i <= BranchSeg; i++) tmp[i] = bpts[kb, i];
                WriteStrip(tmp, BranchSeg + 1, ref w, eye, under, body, hot, retract, false);
            }
            // 剩下的点塌成零宽（不画）
            var last = w > 0 ? vs[(w - 1) * 2] : a;
            for (; w < MaxPts; w++) Collapse(w, last);
            shade.vertices = vs;
            shade.colors = cs;
            shade.RecalculateBounds();
            core.vertices = vc;
            core.colors = cc;
            core.RecalculateBounds();
        }

        void Collapse(int w, Vector3 p)
        {
            int v = w * 2, vb = (MaxPts + w) * 2;
            vs[v] = vs[v + 1] = p;
            vs[vb] = vs[vb + 1] = p;
            vc[v] = vc[v + 1] = p;
            cs[v] = cs[v + 1] = cs[vb] = cs[vb + 1] = Color.clear;
            cc[v] = cc[v + 1] = Color.clear;
        }

        /// <summary>写一段带子（count 个点）到第 w 个点起，段尾接一个零宽点（和下一段断开）</summary>
        void WriteStrip(Vector3[] p, int count, ref int w, Vector3 eye, Color under, Color body, Color hot, float retract, bool main)
        {
            if (w + count + 1 > MaxPts) return;
            float baseW = main ? width : width * 0.55f;
            float tMax = Mathf.Max(taper, 1f);
            for (int i = 0; i < count; i++)
            {
                float t = i / (float)(count - 1);
                var pt = p[i];
                if (retract > 0) pt = Vector3.Lerp(pt, t < 0.5f ? a : b, retract);
                var prev = p[Mathf.Max(0, i - 1)];
                var nxt = p[Mathf.Min(count - 1, i + 1)];
                var dir = nxt - prev;
                var side = Vector3.Cross(dir, eye - pt);
                side = side.sqrMagnitude > 1e-8f ? side.normalized : Vector3.right;
                // 粗细：起点 × taper → 终点 × 1（按较粗的一端归一），每节随机 0.6–1.4，两端收尖；分叉从根往梢收
                float prof = main ? Mathf.Lerp(taper, 1f, t) / tMax : 1f - t * 0.85f;
                float tip = main ? Mathf.Sqrt(Mathf.Clamp01(Mathf.Min(t, 1 - t) * 7f + 0.12f)) : 1f;
                float ww = baseW * prof * tip * (main ? wid[Mathf.Min(i, wid.Length - 1)] : 1f);
                bool edge = !main && (i == 0 || i == count - 1);
                int v = w * 2, vb = (MaxPts + w) * 2;
                // 暗衬（层 0）
                vs[v] = pt - side * ww * 1.2f;
                vs[v + 1] = pt + side * ww * 1.2f;
                cs[v] = cs[v + 1] = edge ? Color.clear : under;
                // 身（层 1）
                vs[vb] = pt - side * ww * 0.5f;
                vs[vb + 1] = pt + side * ww * 0.5f;
                cs[vb] = cs[vb + 1] = edge ? Color.clear : body;
                // 芯
                vc[v] = pt - side * ww * 0.19f;
                vc[v + 1] = pt + side * ww * 0.19f;
                cc[v] = cc[v + 1] = edge ? Color.clear : hot;
                w++;
            }
            if (w < MaxPts)
            {
                Collapse(w, vs[(w - 1) * 2]);
                w++;
            }
        }

        void Update()
        {
            if (!active) return;
            float dt = Time.deltaTime;
            age += dt;
            bool done = persistent ? cancelAt >= 0 && age - cancelAt >= 0.08f : age >= life;
            if (done)
            {
                active = false;
                gameObject.SetActive(false);
                return;
            }
            rejitter -= dt;
            if (rejitter <= 0) Jitter();
            Paint();
        }

        void OnDestroy()
        {
            pool.Remove(this);
            if (shade) Destroy(shade);
            if (core) Destroy(core);
        }
    }

    // ═══════════════════════════════ 形（贴地 / 立体）═══════════════════════════════

    /// <summary>形的句柄（值类型）：池里的形被复用后所有操作都是空操作</summary>
    public readonly struct PlateauShapeHandle
    {
        readonly PlateauShape s;
        readonly int gen;

        internal PlateauShapeHandle(PlateauShape s)
        {
            this.s = s;
            gen = s ? s.Gen : 0;
        }

        public bool Alive => s && s.Gen == gen && s.Active;
        public void MoveTo(Vector3 center) { if (Alive) s.MoveTo(center); }
        public void SetRadius(float r) { if (Alive) s.radius = Mathf.Max(0.01f, r); }
        public void SetAlpha(float a) { if (Alive) s.alpha = Mathf.Clamp01(a); }
        public void SetColor(Color c) { if (Alive) s.tint = c; }
        /// <summary>定格（雷标：四齿往里收、不再转）</summary>
        public void Lock() { if (Alive) s.Lock(); }
        /// <summary>在 seconds 秒内把半径缓出到 to（power = 缓出曲线次方，1 = 线性）</summary>
        public void Grow(float to, float seconds, float power) { if (Alive) s.Grow(to, seconds, power); }
        /// <summary>淡出收掉（0.15 s）</summary>
        public void End() { if (Alive) s.End(); }
    }

    /// <summary>
    /// 第四章的「形」（池化；共享的单位网格 + 每个实例的半径 / 透明 / 转动）：
    ///   Sigil 雷标符印（圈 + 四齿 + 震卦三爻 ☳；定格后换成齿收进、外加一道细环的网格）、Field 电场（圈 + 四齿 + 淡底，圈里爬电）、
    ///   Shadow 影子（软边暗盘）、Scorch 焦痕（星芒暗斑）、Wall 声环（竖直的环带，上下淡、中间亮）、Ring 平面细环（鼓面一闪）、Sphere 球壳（球雷）。
    /// 贴地的形底下都垫一圈靛紫暗衬（雪地上也读得出，设计单第 9 节）；颜色写在顶点色里（线性），透明 / 着色走 MaterialPropertyBlock。
    /// 贴地的按落点的地面法线摆正。上限 16 × 画质（满了复用最老的有寿命的形）。
    /// </summary>
    public sealed class PlateauShape : MonoBehaviour, IFxSlot
    {
        public enum Kind { Sigil, Field, Shadow, Scorch, Wall, Ring, Sphere }

        static readonly List<PlateauShape> pool = new();
        static readonly Dictionary<int, Mesh> meshes = new();
        static MaterialPropertyBlock block;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), ColorId = Shader.PropertyToID("_Color");
        public static int MaxShapes => Mathf.Max(8, Mathf.RoundToInt(16 * FxBudget.StyleCapScale));
        public static int Spawned { get; private set; }

        Kind kind;
        MeshFilter mf;
        MeshRenderer mr;
        internal float radius = 1, alpha = 1;
        internal Color tint = Color.white;
        float life, age, spin, angle, growFrom, growTo, growTime, growPow = 1, endAt = -1, crawl;
        bool locked, ground;
        int gen;
        Vector3 normal = Vector3.up;

        internal int Gen => gen;
        internal bool Active => this && gameObject.activeSelf;
        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => Active;
        void IFxSlot.CancelFx() => End();
        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) => MoveTo(to);
        void IFxSlot.MoveFx(Vector3 position) => MoveTo(position);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            pool.Clear();
            meshes.Clear();
            Spawned = 0;
        }

        public static PlateauShapeHandle Spawn(Kind kind, Vector3 center, Vector3 normal, float radius, float life, float spinDeg)
        {
            if (!Fx.Finite(center)) return default;
            var rt = FxRuntime.Ensure();
            if (!rt) return default;
            var s = Take(rt.transform);
            if (!s) return default;
            s.gen++;
            s.kind = kind;
            s.mf.sharedMesh = MeshFor(kind, false);
            s.mr.sharedMaterial = kind == Kind.Ring ? FxMaterials.Additive : FxMaterials.AlphaBlend;
            s.radius = Mathf.Max(0.05f, radius);
            s.alpha = 1;
            s.tint = Color.white;
            s.life = life > 0 ? life : float.PositiveInfinity;
            s.age = 0;
            s.spin = spinDeg;
            s.angle = Random.value * 360f;
            s.growTime = 0;
            s.endAt = -1;
            s.locked = false;
            s.crawl = 0;
            s.normal = normal.sqrMagnitude > 1e-6f ? normal.normalized : Vector3.up;
            s.ground = kind is Kind.Sigil or Kind.Field or Kind.Shadow or Kind.Scorch;
            s.gameObject.SetActive(true);
            s.MoveTo(center);
            s.Apply();
            Spawned++;
            return new PlateauShapeHandle(s);
        }

        static PlateauShape Take(Transform parent)
        {
            PlateauShape oldest = null;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.Active) return x;
                if (!float.IsInfinity(x.life) && (!oldest || x.age / x.life > oldest.age / oldest.life)) oldest = x;
            }
            if (pool.Count >= MaxShapes) return oldest;
            var go = new GameObject("Plateau Shape");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var s = go.AddComponent<PlateauShape>();
            s.mf = go.AddComponent<MeshFilter>();
            s.mr = go.AddComponent<MeshRenderer>();
            s.mr.shadowCastingMode = ShadowCastingMode.Off;
            s.mr.receiveShadows = false;
            s.mr.lightProbeUsage = LightProbeUsage.Off;
            s.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            pool.Add(s);
            return s;
        }

        internal void MoveTo(Vector3 center)
        {
            if (!Fx.Finite(center)) return;
            if (ground && Physics.Raycast(center + Vector3.up * 2.5f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                // 贴地：落点的地面高度与法线（坡上不插进地里）
                center = hit.point + hit.normal * (kind == Kind.Shadow ? 0.05f : 0.07f);
                normal = hit.normal;
            }
            transform.position = center;
        }

        internal void Lock()
        {
            if (locked || kind != Kind.Sigil) return;
            locked = true;
            mf.sharedMesh = MeshFor(kind, true);
        }

        internal void Grow(float to, float seconds, float power)
        {
            growFrom = radius;
            growTo = Mathf.Max(0.05f, to);
            growTime = Mathf.Max(0.01f, seconds);
            growPow = Mathf.Max(0.2f, power);
            age = 0;
        }

        internal void End()
        {
            if (endAt < 0) endAt = age;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if ((endAt >= 0 && age - endAt >= 0.15f) || age >= life)
            {
                gameObject.SetActive(false);
                return;
            }
            if (!locked) angle += spin * dt;
            if (growTime > 0)
            {
                float k = Mathf.Clamp01(age / growTime);
                radius = Mathf.Lerp(growFrom, growTo, 1f - Mathf.Pow(1f - k, growPow));
            }
            if (kind == Kind.Field)
            {
                // 电场里爬电：每 0.08 s 一道贴地短雷刃（点缀）
                crawl -= dt;
                if (crawl <= 0)
                {
                    crawl = 0.08f;
                    float a = Random.value * Mathf.PI * 2, r = Random.Range(0.1f, 0.85f) * radius;
                    var p = transform.position + new Vector3(Mathf.Sin(a) * r, 0.08f, Mathf.Cos(a) * r);
                    var q = p + new Vector3(Random.Range(-1f, 1f), Random.Range(0f, 0.4f), Random.Range(-1f, 1f)).normalized * Random.Range(0.6f, 1.4f);
                    Fx.PlateauBolt(p, q, 0.04f, 0.1f, 0, 1f, false);
                }
            }
            Apply();
        }

        void Apply()
        {
            var rot = kind is Kind.Wall or Kind.Sphere ? Quaternion.Euler(0, angle, 0) : Quaternion.FromToRotation(Vector3.up, normal) * Quaternion.Euler(0, angle, 0);
            transform.rotation = rot;
            transform.localScale = kind == Kind.Wall ? new Vector3(radius, 1.4f + radius * 0.06f, radius) : Vector3.one * radius;
            // 透明：出现 0.08 s 淡入；有寿命的尾段淡出（电场最后 1 s）；End 之后 0.15 s 淡出
            float a = alpha * (growTime > 0 ? 1f : Mathf.Clamp01(age / 0.08f));
            if (!float.IsInfinity(life))
            {
                float tail = kind == Kind.Field ? Mathf.Min(1f, life * 0.3f) : life * (kind is Kind.Wall or Kind.Ring or Kind.Sphere ? 0.6f : 0.35f);
                a *= Mathf.Clamp01((life - age) / Mathf.Max(0.01f, tail));
            }
            if (endAt >= 0) a *= Mathf.Clamp01(1 - (age - endAt) / 0.15f);
            block ??= new MaterialPropertyBlock();
            block.Clear();
            var c = new Color(tint.r, tint.g, tint.b, tint.a * a);
            block.SetColor(BaseColorId, c);
            block.SetColor(ColorId, c);
            mr.SetPropertyBlock(block);
        }

        // ───────────── 单位网格（顶点色已转线性）─────────────

        static Mesh MeshFor(Kind kind, bool locked)
        {
            int key = (int)kind * 2 + (locked ? 1 : 0);
            if (meshes.TryGetValue(key, out var m) && m) return m;
            var b = new ShapeBuilder();
            var deep = PlateauPalette.A(PlateauPalette.Deep, 0.55f);
            var bolt = PlateauPalette.A(PlateauPalette.Bolt, 0.95f);
            var hot = PlateauPalette.A(PlateauPalette.Core, 0.9f);
            switch (kind)
            {
                case Kind.Sigil:
                {
                    float tooth = locked ? 0.58f : 0.7f;
                    // 暗衬（先画）
                    b.Annulus(0.84f, 1.08f, 48, deep, deep);
                    b.Teeth(4, 1.02f, tooth - 0.06f, 0.24f, deep, 45f);
                    b.Trigram(0.62f, 0.13f, deep, 1.25f);
                    // 身
                    b.Annulus(0.9f, 1.0f, 48, bolt, bolt);
                    b.Teeth(4, 0.97f, tooth, 0.16f, bolt, 45f);
                    b.Trigram(0.62f, 0.09f, bolt, 1f);
                    // 圈内缘一道亮线
                    b.Annulus(0.895f, 0.915f, 48, hot, hot);
                    if (locked) b.Annulus(1.12f, 1.16f, 48, bolt, bolt);
                    break;
                }
                case Kind.Field:
                    b.Disc(0.9f, 32, PlateauPalette.A(PlateauPalette.Bolt, 0.16f), PlateauPalette.A(PlateauPalette.Deep, 0.3f));
                    b.Annulus(0.86f, 1.06f, 40, deep, deep);
                    b.Annulus(0.92f, 1.0f, 40, bolt, bolt);
                    b.Teeth(4, 0.97f, 0.78f, 0.12f, bolt, 0f);
                    break;
                case Kind.Shadow:
                {
                    var c0 = PlateauPalette.Shadow;
                    b.Disc(1f, 32, PlateauPalette.A(c0, 0.75f), PlateauPalette.A(c0, 0f), 0.55f);
                    break;
                }
                case Kind.Scorch:
                {
                    var c0 = new Color(0.16f, 0.1f, 0.15f, 0.6f);
                    b.Star(1f, 12, 0.55f, c0, PlateauPalette.A(c0, 0f));
                    break;
                }
                case Kind.Wall:
                    b.Band(1f, 40, PlateauPalette.A(PlateauPalette.Deep, 0f), bolt, PlateauPalette.A(PlateauPalette.Core, 0.85f));
                    break;
                case Kind.Ring:
                    b.Annulus(0.82f, 1f, 32, PlateauPalette.A(PlateauPalette.Core, 0f), PlateauPalette.A(PlateauPalette.Core, 0.9f));
                    break;
                case Kind.Sphere:
                    b.Sphere(1f, 18, 10, PlateauPalette.A(PlateauPalette.Bolt, 0.42f));
                    break;
            }
            m = b.Build("Plateau Shape " + kind + (locked ? " Locked" : ""));
            meshes[key] = m;
            return m;
        }

        /// <summary>拼单位网格（XZ 平面为地面，+Y 朝上）；颜色进来是 sRGB，写成线性顶点色</summary>
        sealed class ShapeBuilder
        {
            readonly List<Vector3> v = new();
            readonly List<Color> c = new();
            readonly List<int> t = new();

            int V(Vector3 p, Color col)
            {
                v.Add(p);
                c.Add(PlateauPalette.V(col));
                return v.Count - 1;
            }

            void Quad(int a, int b, int cc, int d)
            {
                t.Add(a); t.Add(b); t.Add(cc);
                t.Add(a); t.Add(cc); t.Add(d);
                // 两面都画（贴地的从下面看不到；竖直 / 球壳从里外都看得见）
                t.Add(a); t.Add(cc); t.Add(b);
                t.Add(a); t.Add(d); t.Add(cc);
            }

            public void Annulus(float r0, float r1, int seg, Color inner, Color outer)
            {
                int s = v.Count;
                for (int i = 0; i <= seg; i++)
                {
                    float a = i * Mathf.PI * 2 / seg;
                    var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                    V(d * r0, inner);
                    V(d * r1, outer);
                }
                for (int i = 0; i < seg; i++)
                {
                    int a = s + i * 2;
                    Quad(a, a + 1, a + 3, a + 2);
                }
            }

            public void Disc(float r, int seg, Color center, Color edge, float soft = 0f)
            {
                int s = V(Vector3.zero, center);
                int ring0 = v.Count;
                float rIn = soft > 0 ? r * (1 - soft) : r;
                for (int i = 0; i <= seg; i++)
                {
                    float a = i * Mathf.PI * 2 / seg;
                    V(new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * rIn, soft > 0 ? center : edge);
                }
                for (int i = 0; i < seg; i++)
                {
                    t.Add(s); t.Add(ring0 + i); t.Add(ring0 + i + 1);
                    t.Add(s); t.Add(ring0 + i + 1); t.Add(ring0 + i);
                }
                if (soft > 0) Annulus(rIn, r, seg, center, edge);
            }

            /// <summary>count 个往里指的三角齿：外沿 rOut、齿尖 rIn、底宽 w，第一个齿在 yaw0 度</summary>
            public void Teeth(int count, float rOut, float rIn, float w, Color col, float yaw0)
            {
                for (int i = 0; i < count; i++)
                {
                    float a = (yaw0 + i * 360f / count) * Mathf.Deg2Rad;
                    var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                    var side = new Vector3(d.z, 0, -d.x);
                    int p0 = V(d * rOut - side * w * 0.5f, col), p1 = V(d * rOut + side * w * 0.5f, col), p2 = V(d * rIn, col);
                    t.Add(p0); t.Add(p2); t.Add(p1);
                    t.Add(p0); t.Add(p1); t.Add(p2);
                }
            }

            /// <summary>震卦 ☳（下阳上两阴）：三道横杠，杠长 len、杠粗 th，scale 整体放大（暗衬用）</summary>
            public void Trigram(float len, float th, Color col, float scale)
            {
                float gap = 0.2f * scale;
                for (int row = 0; row < 3; row++)
                {
                    float z = (row - 1) * gap;
                    if (row == 0) Bar(-len * 0.5f * scale, len * 0.5f * scale, z, th * scale, col);
                    else
                    {
                        Bar(-len * 0.5f * scale, -len * 0.08f * scale, z, th * scale, col);
                        Bar(len * 0.08f * scale, len * 0.5f * scale, z, th * scale, col);
                    }
                }
            }

            void Bar(float x0, float x1, float z, float th, Color col)
            {
                int a = V(new Vector3(x0, 0, z - th * 0.5f), col), b = V(new Vector3(x1, 0, z - th * 0.5f), col);
                int cc = V(new Vector3(x1, 0, z + th * 0.5f), col), d = V(new Vector3(x0, 0, z + th * 0.5f), col);
                Quad(a, d, cc, b);
            }

            public void Star(float r, int points, float inner, Color center, Color edge)
            {
                int s = V(Vector3.zero, center);
                int r0 = v.Count;
                for (int i = 0; i <= points * 2; i++)
                {
                    float a = i * Mathf.PI / points;
                    float rr = (i % 2 == 0 ? r : r * inner) * (i % 4 == 0 ? 1f : 0.88f);
                    V(new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * rr, Color.Lerp(center, edge, i % 2 == 0 ? 1f : 0.4f));
                }
                for (int i = 0; i < points * 2; i++)
                {
                    t.Add(s); t.Add(r0 + i); t.Add(r0 + i + 1);
                    t.Add(s); t.Add(r0 + i + 1); t.Add(r0 + i);
                }
            }

            /// <summary>竖直环带（半径 1、高 1，原点在环底中心）：下沿 → 中间亮线 → 上沿，上下淡</summary>
            public void Band(float r, int seg, Color edge, Color mid, Color line)
            {
                float[] ys = { 0f, 0.42f, 0.5f, 0.58f, 1f };
                Color[] cols = { edge, mid, line, mid, edge };
                int s = v.Count, rows = ys.Length;
                for (int i = 0; i <= seg; i++)
                {
                    float a = i * Mathf.PI * 2 / seg;
                    var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                    for (int k = 0; k < rows; k++) V(d + Vector3.up * ys[k], cols[k]);
                }
                for (int i = 0; i < seg; i++)
                    for (int k = 0; k < rows - 1; k++)
                    {
                        int a = s + i * rows + k, b = a + rows;
                        Quad(a, a + 1, b + 1, b);
                    }
            }

            public void Sphere(float r, int seg, int rings, Color col)
            {
                int s = v.Count;
                for (int j = 0; j <= rings; j++)
                {
                    float phi = Mathf.PI * j / rings;
                    for (int i = 0; i <= seg; i++)
                    {
                        float th = Mathf.PI * 2 * i / seg;
                        V(new Vector3(Mathf.Sin(phi) * Mathf.Sin(th), Mathf.Cos(phi), Mathf.Sin(phi) * Mathf.Cos(th)) * r, col);
                    }
                }
                for (int j = 0; j < rings; j++)
                    for (int i = 0; i < seg; i++)
                    {
                        int a = s + j * (seg + 1) + i, b = a + seg + 1;
                        Quad(a, b, b + 1, a + 1);
                    }
            }

            public Mesh Build(string name)
            {
                var m = new Mesh { name = name };
                m.SetVertices(v);
                m.SetColors(c);
                m.SetTriangles(t, 0);
                m.RecalculateBounds();
                return m;
            }
        }
    }

    // ═══════════════════════════════ 月牙 ═══════════════════════════════

    /// <summary>
    /// 紫红月牙（四角挑、穷奇翼刃、爪痕；设计单「尖角、月牙 = 切割」）：两头尖、中间厚，三层——
    /// 暗衬（普通混合，靛紫，比本体大一圈）→ 本体（普通混合，内缘靛紫 → 外缘紫红两阶）→ 刃口（加法，外缘粉白，刀头最亮）。
    /// 时间：第一帧刀头已在 40%（释放帧亮芯第一帧到峰值），前 40% 寿命扫到尽头，之后刀尾往刀头收。池化（最多 8 × 画质）。
    /// </summary>
    public sealed class PlateauCrescentFx : MonoBehaviour, IFxSlot
    {
        const int Segments = 24, Rows = 4;
        static readonly float[] RowAt = { 0f, 0.45f, 0.86f, 1f };
        static readonly List<PlateauCrescentFx> pool = new();
        public static int MaxArcs => Mathf.Max(4, Mathf.RoundToInt(8 * FxBudget.StyleCapScale));
        public static int Spawned { get; private set; }

        Mesh under, body, edge;
        Vector3[] pu, pb;
        Color[] cu, cb, ce;
        float age, life, radius, arc, width;
        int dir, gen;
        bool active;

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;
        void IFxSlot.CancelFx() => life = Mathf.Min(life, age + 0.05f);
        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) { }
        void IFxSlot.MoveFx(Vector3 position) => transform.position = position;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            pool.Clear();
            Spawned = 0;
        }

        public static FxHandle Spawn(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float life, float pitchDeg)
        {
            if (!(radius > 0.05f)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            var s = Take(rt.transform);
            if (!s) return FxHandle.None;
            s.gen++;
            s.active = true;
            s.age = 0;
            s.life = Mathf.Max(0.06f, life);
            s.radius = radius;
            s.arc = Mathf.Clamp(arc, 0.2f, Mathf.PI * 2f);
            s.width = Mathf.Clamp(width, 0.04f, radius * 0.8f);
            s.dir = dir >= 0 ? 1 : -1;
            s.transform.SetPositionAndRotation(center,
                Quaternion.Euler(0, yawDeg, 0) * Quaternion.AngleAxis(pitchDeg, Vector3.right) * Quaternion.AngleAxis(-tilt * Mathf.Rad2Deg, Vector3.forward));
            s.gameObject.SetActive(true);
            s.Paint();
            Spawned++;
            return new FxHandle(s);
        }

        static PlateauCrescentFx Take(Transform parent)
        {
            PlateauCrescentFx oldest = null;
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
            var go = new GameObject("Plateau Crescent");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var a = go.AddComponent<PlateauCrescentFx>();
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
            var idx = new int[Segments * (Rows - 1) * 12];
            int w = 0;
            for (int i = 0; i < Segments; i++)
                for (int k = 0; k < Rows - 1; k++)
                {
                    int a = i * Rows + k, b = a + Rows;
                    // 两面
                    idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                    idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
                    idx[w++] = a; idx[w++] = b; idx[w++] = a + 1;
                    idx[w++] = a + 1; idx[w++] = b; idx[w++] = b + 1;
                }
            under = Make("Under", idx, pu, cu);
            body = Make("Body", idx, pb, cb);
            edge = Make("Edge", idx, pb, ce);
            AddR(under, FxMaterials.AlphaBlend, -2);
            AddR(body, FxMaterials.AlphaBlend, -1);
            AddR(edge, FxMaterials.Additive, 0);
        }

        static Mesh Make(string name, int[] idx, Vector3[] pos, Color[] col)
        {
            var m = new Mesh { name = "Plateau Crescent " + name };
            m.MarkDynamic();
            m.vertices = pos;
            m.colors = col;
            m.triangles = idx;
            return m;
        }

        void AddR(Mesh m, Material mat, int order)
        {
            var go = new GameObject(m.name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
        }

        void Paint()
        {
            float t = age / life;
            float head = Mathf.Lerp(0.4f, 1.12f, 1f - Mathf.Pow(1f - Mathf.Clamp01(t / 0.4f), 2.4f));
            float tail = Mathf.Clamp01((t - 0.35f) / 0.65f) * 1.15f;
            float grow = 1f + 0.08f * t;
            var hot = PlateauPalette.V(PlateauPalette.Core);
            var bolt = PlateauPalette.V(PlateauPalette.Bolt);
            var deep = PlateauPalette.V(PlateauPalette.Deep);
            for (int i = 0; i <= Segments; i++)
            {
                float u = i / (float)Segments;
                float a = (u - 0.5f) * arc * -dir;
                float sn = Mathf.Sin(a), cs = Mathf.Cos(a);
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
                    var cU = deep;
                    cU.a = soft * (k == 0 ? 0.3f : k == 3 ? 0.65f : 0.8f);
                    cu[v] = cU;
                    var cB = k <= 1 ? deep : bolt;
                    cB.a = soft * (k == 0 ? 0f : k == 1 ? 0.85f : k == 2 ? 0.95f : 0.6f);
                    cb[v] = cB;
                    var cE = hot;
                    cE.a = soft * (k == 3 ? 0.9f : k == 2 ? 0.12f + 0.35f * lead : 0f);
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

    // ═══════════════════════════════ 球（雷球、雷心）═══════════════════════════════

    /// <summary>
    /// 挂在骨骼上的发光球（獓狠角间雷球、连鼓灵雷心、举父的雷石光）：实心球（纯色，紫红 → 粉白）+ 加法光晕片。
    /// <see cref="level"/> 0..1 = 亮度（攒电、前摇），<see cref="size"/> = 球半径（米，世界尺寸），<see cref="pulse"/> 呼吸幅度。
    /// </summary>
    public sealed class PlateauOrb : MonoBehaviour
    {
        public float level, size = 0.4f, pulse = 0.08f, glowScale = 3.2f;
        public bool visible = true;
        Renderer solid, glowR;
        Transform glow;
        float seed;

        public static PlateauOrb Attach(Transform parent, Vector3 localPos, float size)
        {
            var go = new GameObject("Plateau Orb");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            var o = go.AddComponent<PlateauOrb>();
            o.size = size;
            var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            s.name = "Solid";
            var c = s.GetComponent<Collider>();
            if (Application.isPlaying) Destroy(c);
            else DestroyImmediate(c);
            s.transform.SetParent(go.transform, false);
            o.solid = s.GetComponent<Renderer>();
            o.solid.sharedMaterial = FxMaterials.Unlit;
            o.solid.shadowCastingMode = ShadowCastingMode.Off;
            o.glow = FxMaterials.GlowSprite(go.transform, 1f, PlateauPalette.Bolt);
            o.glowR = o.glow.GetComponent<Renderer>();
            o.seed = Random.value * 10f;
            o.LateUpdate();
            return o;
        }

        void LateUpdate()
        {
            if (!solid) return;
            solid.enabled = glowR.enabled = visible;
            if (!visible) return;
            // 父骨骼可能被缩放（体型 / 精英）：按世界尺寸摆
            float parentScale = transform.parent ? Mathf.Abs(transform.parent.lossyScale.x) : 1f;
            float k = 1f + pulse * Mathf.Sin(Time.time * 12f + seed);
            float r = size * k / Mathf.Max(1e-3f, parentScale);
            solid.transform.localScale = Vector3.one * r * 2f;
            glow.localScale = Vector3.one * r * glowScale * (0.8f + 0.5f * level);
            FxMaterials.Tint(solid, Color.Lerp(PlateauPalette.Bolt, PlateauPalette.Core, Mathf.Clamp01(level * 0.85f)));
            FxMaterials.Tint(glowR, PlateauPalette.A(Color.Lerp(PlateauPalette.Bolt, PlateauPalette.Core, level * 0.5f), 0.35f + 0.55f * Mathf.Clamp01(level)));
        }
    }

    // ═══════════════════════════════ 时序 ═══════════════════════════════

    /// <summary>特效的小时序（一圈一圈晚 0.08 s 的声环、雷球砸地之后再放一圈雷刃）：挂在 Fx 根物体上</summary>
    public sealed class PlateauFxSeq : MonoBehaviour
    {
        static PlateauFxSeq instance;
        readonly List<(float at, Action fn)> list = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => instance = null;

        public static void After(float seconds, Action fn)
        {
            if (fn == null) return;
            if (seconds <= 0)
            {
                fn();
                return;
            }
            if (!instance)
            {
                var rt = FxRuntime.Ensure();
                if (!rt) return;
                instance = rt.gameObject.GetComponent<PlateauFxSeq>();
                if (!instance) instance = rt.gameObject.AddComponent<PlateauFxSeq>();
            }
            instance.list.Add((Time.time + seconds, fn));
        }

        void Update()
        {
            for (int i = list.Count - 1; i >= 0; i--)
            {
                if (Time.time < list[i].at) continue;
                var fn = list[i].fn;
                list.RemoveAt(i);
                try
                {
                    fn();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
        }
    }
}
