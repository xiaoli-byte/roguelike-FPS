using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-A 千佛崖（第一章备选图，docs/level-design/maps/1-A.md；进每局路线的图池，docs/level-design/run-variety.md §1.1）：
    /// 敦煌莫高窟式的千佛断崖。关卡坐标 = 世界 XZ（米），游玩区约 300 × 210 m，地形 440 × 380 m，外缘 40 m 落回远景地面。
    ///
    ///   崖线 z ≈ 140（<see cref="Cz"/>）：崖脚（y 0）→ 下崖壁 2.2 m 宽升 8 m → 窟檐层（y 8，进深 10–16 m）→ 上崖壁 2.6 m 宽升 10 m → 崖顶（y 18）。
    ///   两层崖壁都贴着二层回廊件当窟檐；东西两头崖壁塌成长沙坡，三层在两头直接连通。
    ///   ① 大佛窟前 (150, Cz−16)：x 140–160 把下崖壁和窟檐层整段切到崖脚，敦煌坐像（0.85 倍）背靠 18 m 后壁，窟口是广场；
    ///   ② 西崖窟檐 (78, 窟檐层)：西段窟檐层，崖脚和崖顶都能打到；
    ///   ③ 崖顶塔院 (190, 崖顶)：寺塔立在 2.4 m 的塔基台上（南、西两条坡道）；
    ///   ④ 河洲驼队 (240, 宕泉河)：干河床里的河心沙洲，残车、货堆。
    ///   ①–④ 必清、先后不限；藏宝：西段窟檐层最西头「藏经洞」（无守军）、南岸「河滩遗骸」（守军，调查时惊动）。出口祭坛在崖顶东头。
    ///   坡道：崖脚 → 窟檐层两道垂直贴崖的积沙坡（x 64、x 228）；窟檐层 → 崖顶两道顺崖凿出的斜道（西 x 98 → 132、东 x 206 → 172）；两头塌崖沙坡。
    ///
    /// 怪的三类摆法（用户 11-08：哪些地方能安排怪物、哪些作为据点刷多轮、哪些作为怪物入场点；docs/level-design/maps/1-A.md §4）：
    ///   驻守点 = 4 处路遇埋伏小队（<see cref="EncounterSite.AsRoadside"/>，开局就站在窟檐拐角 / 河床 / 崖顶 / 下寺遗址，走近或开枪整组苏醒）；
    ///   据点 = ①–④ 多波，波次从场地自己的站位进场（跃下：窟檐层 → 崖脚、崖顶 → 窟檐层、河岸 → 河床；飞临：飞天从崖顶上空飞进来）；
    ///   入场点 = 8 个 <see cref="MonsterEntry"/>（窟檐层 / 崖顶跃下、宕泉河上下游、南岸沙丘背后、崖顶北沙山、西头塌崖沙坡、崖顶上空飞临），游荡怪群只从这里进场。
    /// 布局变体（<see cref="LevelLayout"/>）：main「自宕泉南岸入」= 西南沙丘出生、崖顶东头出口；reverse「自崖顶入」= 崖顶东头祭坛前出生、
    /// ③ 先打（开场编制、给武器）、② 最后（终局编制、给保底精良）、西南岸新立的出口祭坛（NavMesh 烘焙之后摆）。
    /// 场景只放环境和标记（D17 / L1）。生成：Spiritfire ▸ Levels ▸ Build 1-A 千佛崖（或 bridge.sh level 1-A）。
    /// </summary>
    [LevelBuilder("1-A", ScenePath)]
    public static class Level_1_A
    {
        public const string Dir = "Assets/Levels/L1_A_GrottoCliff";
        public const string ScenePath = "Assets/Scenes/L1_A_GrottoCliff.unity";
        const string Name = "L1_A";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（河床挖到 −1.6 也在范围内）；远景地面 y = FarY</summary>
        const float Base = 12f, HeightRange = 64f, FarY = 1f;
        static readonly Vector2 Origin = new(-80, -70), Size = new(440, 380);
        /// <summary>风从西北偏北吹向东南：沙从崖顶往崖脚、往河床落</summary>
        static readonly Vector2 Wind = new Vector2(0.6f, -0.8f).normalized;
        static readonly LevelKit.BoundarySpec Bounds = LevelKit.BoundarySpec.Default;
        /// <summary>游玩区（等值线外起风推回）</summary>
        static readonly Vector2 PlayMin = new(4, 4), PlayMax = new(300, 212);

        // ───────────── 崖 ─────────────
        const float LedgeY = 8f, TopY = 18f;
        /// <summary>下崖壁 / 上崖壁的水平宽度（8 m / 10 m 的高差，≈ 75°，翻不上去）</summary>
        const float W1 = 2.2f, W2 = 2.6f;

        /// <summary>崖脚线（下崖壁起点）的 z</summary>
        static float Cz(float x) => 140 + 3.5f * Mathf.Sin(x / 41f + 0.6f) + 1.5f * Mathf.Sin(x / 17f);

        /// <summary>窟檐层进深（10–16 m）</summary>
        static float Depth(float x) => 13 + 3 * Mathf.Sin(x / 29f + 1.3f);

        /// <summary>崖壁完整度：中段 1，两头塌成沙坡</summary>
        static float CliffMask(float x) => Smooth(18, 42, x) * (1 - Smooth(262, 290, x));

        static float U(Vector2 p) => p.y - Cz(p.x);
        static Vector2 AtU(float x, float u) => new(x, Cz(x) + u);
        /// <summary>窟檐层上的点：f = 0 前沿 … 1 后壁脚</summary>
        static Vector2 Ledge(float x, float f) => AtU(x, W1 + Depth(x) * f);
        /// <summary>崖顶上的点：离崖顶前沿 back 米</summary>
        static Vector2 Top(float x, float back) => AtU(x, W1 + Depth(x) + W2 + back);
        /// <summary>崖脚前的点：离下崖壁 dist 米</summary>
        static Vector2 Below(float x, float dist) => AtU(x, -dist);

        /// <summary>崖面朝外（朝南）的方向</summary>
        static Vector2 Outward(float x)
        {
            float dz = Cz(x + 0.5f) - Cz(x - 0.5f);
            return new Vector2(dz, -1).normalized;
        }

        static float YawOf(Vector2 dir) => Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;
        static float YawToward(Vector2 from, Vector2 to) => YawOf(to - from);

        // ───────────── 大佛窟 ─────────────
        const float NicheX = 150, NicheHalf = 10, ColossusScale = 0.85f;
        static readonly Vector3 ColossusSize = new(11.97f, 20f, 9.76f);
        static Vector2 ColossusAt => AtU(NicheX, W1 + Depth(NicheX) - ColossusSize.z * ColossusScale * 0.5f - 0.6f);

        static float NicheMask(Vector2 p)
        {
            float u = U(p), d = Depth(p.x);
            return (1 - Smooth(NicheHalf, NicheHalf + 1.2f, Mathf.Abs(p.x - NicheX))) * (1 - Smooth(W1 + d - 0.4f, W1 + d + 0.4f, u)) * Smooth(-16, -8, u);
        }

        // ───────────── 坡道 ─────────────
        /// <summary>崖脚 → 窟檐层：垂直贴崖的积沙坡（坡脚离崖 28 m，8 m 高 ≈ 14°）</summary>
        static readonly (Vector2 foot, Vector2 top)[] SandRamps = { (Below(64, 28), AtU(64, W1 + 1.5f)), (Below(228, 28), AtU(228, W1 + 1.5f)) };
        const float SandRampWidth = 7f;

        /// <summary>
        /// 窟檐层 → 崖顶：顺崖凿出的斜道——贴着上崖壁脚（窟檐层靠里 <see cref="StairUc"/>）跟着崖线走，x0（坡脚，y 8）→ x1（坡顶，y 18），10 m 高 / 34 m ≈ 16°；
        /// 坡顶最后一段往崖顶一侧加宽，盖过上崖壁接上崖顶。占窟檐层靠里约 5 m，前沿留走道。
        /// （第一版用世界坐标里的直线斜着穿崖壁：崖壁 2.6 m 内升 10 m，比坡快，坡面被崖壁顶出 40° 的坎——导航绕了 190 m）
        /// </summary>
        static readonly (float x0, float x1)[] StairX = { (98, 132), (206, 172) };
        const float StairHalf = 2.25f, StairEdge = 1.5f;

        /// <summary>斜道中线离崖脚线的距离（窟檐层后壁脚往前 2.4 m）</summary>
        static float StairUc(float x) => W1 + Depth(x) - 2.4f;

        static Vector2 StairFoot(int i) => AtU(StairX[i].x0, StairUc(StairX[i].x0));
        static Vector2 StairTop(int i) => Top(StairX[i].x1, 2.5f);

        /// <summary>斜道中线（坡度验收 / 散布避让用）：沿 x 每 4 m 一点，最后接到崖顶</summary>
        static List<Vector2> StairLine(int i)
        {
            var (x0, x1) = StairX[i];
            var pts = new List<Vector2>();
            int n = Mathf.CeilToInt(Mathf.Abs(x1 - x0) / 4f);
            for (int k = 0; k <= n; k++)
            {
                float x = Mathf.Lerp(x0, x1, k / (float)n);
                pts.Add(AtU(x, StairUc(x)));
            }
            pts.Add(StairTop(i));
            return pts;
        }

        /// <summary>斜道在 p 处的目标高度与覆盖权重（只填不挖，调用方 max(h, lerp(h, 目标, 权重))）</summary>
        static float StairHeight(Vector2 p, out float mask)
        {
            mask = 0;
            float best = 0;
            float u = U(p);
            foreach (var (x0, x1) in StairX)
            {
                float len = Mathf.Abs(x1 - x0);
                float t = (p.x - x0) / (x1 - x0);
                if (t < -0.2f || t > 1.2f) continue;
                float uc = StairUc(p.x);
                float along = Smooth(-StairEdge / len, 0, t) * (1 - Smooth(1, 1 + StairEdge / len, t));
                // 坡顶段（t ≥ 0.86）往崖顶一侧加宽到崖顶前沿以里 1.5 m：盖住上崖壁
                float wide = Smooth(0.86f, 0.94f, t) * (1 - Smooth(1.02f, 1.08f, t));
                float upper = Mathf.Lerp(uc + StairHalf, W1 + Depth(p.x) + W2 + 1.5f, wide);
                float lat = u < uc ? uc - u : Mathf.Max(0, u - upper + StairHalf);
                float m = (1 - Smooth(StairHalf, StairHalf + StairEdge, lat)) * along;
                if (m > mask)
                {
                    mask = m;
                    best = Mathf.Lerp(LedgeY, TopY, Mathf.Clamp01(t));
                }
            }
            return best;
        }

        // ───────────── 崖顶 ─────────────
        static readonly Vector2 PagodaAt = Top(192, 22), PagodaHalf = new(13, 10);
        const float PagodaPlatH = 2.4f;
        static readonly (Vector2 foot, Vector2 top, float width)[] PagodaRamps =
        {
            (PagodaAt + new Vector2(0, -PagodaHalf.y - 9.5f), PagodaAt + new Vector2(0, -PagodaHalf.y + 0.5f), 6),
            (PagodaAt + new Vector2(-PagodaHalf.x - 9.5f, 0), PagodaAt + new Vector2(-PagodaHalf.x + 0.5f, 0), 6),
        };
        static readonly Vector2 StupaAt = Top(92, 20), TowerAt = Top(238, 30);
        static readonly (Vector2 foot, Vector2 top, float width)[] NoRamps = Array.Empty<(Vector2, Vector2, float)>();

        // ───────────── 宕泉河 ─────────────
        static readonly Vector2[] RiverCtrl =
        {
            new(-40, 66), new(10, 72), new(60, 66), new(110, 74), new(160, 70), new(210, 80), new(250, 76), new(300, 82), new(360, 78),
        };
        static readonly List<Vector2> River = Spline(RiverCtrl);
        const float RiverWidth = 14f, RiverDepth = 1.6f, RiverBank = 3f;

        /// <summary>河道中线在 x 处的 z（控制点线性插值，摆件 / 站位用）</summary>
        static float RiverZ(float x)
        {
            for (int i = 0; i + 1 < RiverCtrl.Length; i++)
                if (x <= RiverCtrl[i + 1].x)
                    return Mathf.Lerp(RiverCtrl[i].y, RiverCtrl[i + 1].y, Mathf.InverseLerp(RiverCtrl[i].x, RiverCtrl[i + 1].x, x));
            return RiverCtrl[^1].y;
        }

        static readonly Vector2 BarAt = new(240, RiverZ(240)), BarR = new(15, 4.5f);

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = new(30, 28);
        static readonly Vector2 Site1 = Below(NicheX, 16), Site2 = Ledge(78, 0.5f), Site3 = Top(190, 12), Site4 = BarAt;
        /// <summary>河滩遗骸（守军场地中心 = 藏宝点）、藏经洞（西段窟檐层最西头）</summary>
        static readonly Vector2 GuardCache = new(112, 56), SutraCave = Ledge(48, 0.6f);
        /// <summary>出口祭坛：崖顶东头，正面朝西南（从斜道 / 东头沙坡上来都看得见门）</summary>
        static readonly Vector2 ExitAt = Top(274, 26);
        const float ExitYaw = -125, ExitDoorOffset = 1.2f;
        static Vector2 ExitFace => new(Mathf.Sin(ExitYaw * Mathf.Deg2Rad), Mathf.Cos(ExitYaw * Mathf.Deg2Rad));
        /// <summary>逆行变体：在东头祭坛前 6 m 出生；出口祭坛立在西南岸（面朝东北的崖）</summary>
        static Vector2 RevSpawn => ExitAt + ExitFace * 6f;
        static readonly Vector2 RevExitAt = new(16, 18);
        const float RevExitYaw = 45;

        // ───────────── 地貌 ─────────────
        static float Ground0(Vector2 p) => 0.35f * Fbm(p, 60, 3, 1) + 0.15f * Fbm(p, 14, 2, 2);

        static float Playable(Vector2 p)
        {
            float s = LevelKit.BoxSdf(p, PlayMin, PlayMax) + 2.5f * Fbm(p, 26, 2, 61);
            return 1 - Smooth(0, 6, s);
        }

        /// <summary>崖的高度（相对原地面）：完整处是两层崖壁，两头塌成沙坡；大佛窟里切到崖脚</summary>
        static float CliffHeight(Vector2 p, out float wall, out float ledge, out float top)
        {
            float u = U(p), d = Depth(p.x), cm = CliffMask(p.x);
            float lower = Smooth(0, W1, u), upper = Smooth(W1 + d, W1 + d + W2, u);
            float cliff = LedgeY * lower + (TopY - LedgeY) * upper;
            float slope = TopY * Smooth(-40, 22, u);
            float h = Mathf.Lerp(slope, cliff, cm);
            float niche = NicheMask(p);
            h *= 1 - niche;
            // 崖壁（上岩石层）、窟檐层面、崖顶面
            float wl = Smooth(-0.3f, 0.4f, u) * (1 - Smooth(W1 - 0.4f, W1 + 0.3f, u));
            float wu = Smooth(W1 + d - 0.3f, W1 + d + 0.4f, u) * (1 - Smooth(W1 + d + W2 - 0.4f, W1 + d + W2 + 0.3f, u));
            float nicheWall = niche > 0.05f && niche < 0.95f ? 1 : 0;
            wall = Mathf.Max(Mathf.Max(wl, wu) * cm * (1 - niche), nicheWall * Smooth(-2, 2, u));
            ledge = Smooth(W1 + 0.3f, W1 + 1, u) * (1 - Smooth(W1 + d - 1, W1 + d - 0.3f, u)) * cm * (1 - niche);
            top = Smooth(W1 + d + W2, W1 + d + W2 + 1, u);
            return h;
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float g = Ground0(p);
            float u = U(p);

            // ── 1. 宕泉河（干河床）+ 河心沙洲 ──
            float river = Channel(p, River, RiverWidth, RiverDepth, RiverBank);
            float bar = 1 - Smooth(0, 3, LevelKit.EllipseSdf(p, BarAt, BarR));
            river = Mathf.Max(river, Mathf.Lerp(river, -0.7f, bar));
            float h = g + river;

            // ── 2. 南岸沙垄（出生点、遗骸周围留平）──
            float southPlain = 1 - Smooth(50, 64, p.y);
            float drifts = Dunes(p, Wind, 16, 1.1f, 9) * southPlain * Smooth(0.25f, 0.6f, Fbm(p, 40, 2, 11) * 0.5f + 0.5f)
                           * (1 - Disc(p, Spawn, 10, 6)) * (1 - Disc(p, GuardCache, 10, 6)) * (1 - Disc(p, RevExitAt, 9, 5));
            h += Mathf.Max(0, drifts);

            // ── 3. 崖 + 崖脚积沙裙 ──
            float cliff = CliffHeight(p, out float wall, out float ledgeTop, out float clifftop);
            float niche = NicheMask(p);
            float apron = 1.2f * Smooth(-10, 0, u) * (1 - Smooth(0, 0.6f, u)) * CliffMask(p.x) * (1 - niche);
            h += cliff + apron;

            // ── 4. 坡道（只填）：崖脚积沙坡、崖壁斜道 ──
            float sandRamp = 0, stair = 0;
            foreach (var (foot, top) in SandRamps)
            {
                var (t, m) = Ramp(p, foot, top, SandRampWidth, 2f);
                if (m <= 0) continue;
                float target = Mathf.Lerp(Ground0(foot), LedgeY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                sandRamp = Mathf.Max(sandRamp, m);
            }
            {
                float target = StairHeight(p, out float m);
                if (m > 0) h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                stair = m;
            }

            // ── 5. 崖顶塔基台 + 两条坡道 ──
            float pv = Plateau(p, PagodaAt, PagodaHalf, 0, PagodaPlatH, 0.6f, NoRamps);
            if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(h, TopY + PagodaPlatH, pv / PagodaPlatH));
            float platRamp = 0;
            foreach (var (foot, top, width) in PagodaRamps)
            {
                var (t, m) = Ramp(p, foot, top, width, 1.5f);
                if (m <= 0) continue;
                h = Mathf.Max(h, Mathf.Lerp(h, Mathf.Lerp(TopY, TopY + PagodaPlatH, t), m));
                platRamp = Mathf.Max(platRamp, m);
            }

            // ── 6. 游玩区外：沙丘 / 沙山抬升（软边界的风沙把人推回）──
            float outer = 1 - Playable(p);
            float big = Dunes(p, Wind, 60, 10, 5, 0.7f) * Smooth(0, 0.7f, outer);
            h += Smooth(0, 1, outer) * 4f + Mathf.Max(0, big);

            // ── 7. 地形外缘 40 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY, h, Smooth(0, 40, edgeDist));
            s.h = Base + h;

            // ── 分层倾向 ──
            float riverBed = Smooth(0.6f, 1.2f, -river);
            float plaza = Disc(p, Site1, 16, 6) + niche;
            float court = 1 - Smooth(0, 6, LevelKit.BoxSdf(p, PagodaAt - PagodaHalf - new Vector2(10, 10), PagodaAt + PagodaHalf + new Vector2(10, 8)));
            float platTop = Smooth(PagodaPlatH - 0.5f, PagodaPlatH - 0.1f, pv);
            s.packed = Mathf.Max(Mathf.Max(ledgeTop * 0.8f, riverBed * 0.9f), Mathf.Max(Mathf.Clamp01(plaza) * 0.85f, Mathf.Max(court * clifftop * 0.7f,
                Mathf.Max(stair * 0.9f, Mathf.Max(platTop, platRamp * 0.8f)))));
            float sandy = Mathf.Max(Mathf.Max(Smooth(0.25f, 1.4f, drifts), sandRamp * 0.95f), Mathf.Max(Smooth(0.3f, 1.2f, apron) * 0.8f, Smooth(0.2f, 0.8f, outer)));
            float slopeSand = (1 - CliffMask(p.x)) * Smooth(-40, 0, u) * (1 - Smooth(20, 26, u));
            float patches = 0.5f * Smooth(0.2f, 0.55f, Fbm(p, 24, 3, 7) * 0.5f + 0.5f);
            s.sand = Mathf.Max(Mathf.Max(sandy, slopeSand * 0.9f), patches * (1 - ledgeTop) * (1 - riverBed)) * (1 - Mathf.Clamp01(plaza) * 0.8f) * (1 - platTop) * (1 - stair);
            s.rock = Mathf.Max(wall, bar * 0);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-A 千佛崖", priority = 63)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 软边界 → 烘焙 NavMesh → 布局变体 → 验收（L5 规则集）→ 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var arch = new GameObject("Architecture").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                ground = LevelKit.Ground.Desert, eval = Eval,
            }, env);

            // 远景：沙丘 + 两圈赭红台地；地形外的远景地面在雾里接上环脚；北面崖后两座雅丹「舰队」剪影
            var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(150, 110), FarY - 0.5f, 760, 4);
            LevelKit.Backdrop(backdrop, env);
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY - 0.05f, theme.groundA);
            LevelKit.BackdropImpostor(backdrop, "SM_Tripo_DesertYardangFleet", env, new Vector3(60, FarY - 2, 420), 200, 2.6f, 0.5f);
            LevelKit.BackdropImpostor(backdrop, "SM_Tripo_DesertYardangFleet", env, new Vector3(300, FarY - 2, 400), 215, 2.2f, 0.55f);

            // 软边界（没有空气墙）：游玩区外地形抬成沙丘 / 沙山，等值线外风沙推回 + 兜底环
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            // 天气：西北盛行风，常态风力 0.3（沙从崖顶扬下来）；不设区域风暴
            LevelKit.Weather(env, theme, Wind, 0.3f);

            BuildCliff(set, arch, props);
            BuildClifftop(set, arch, props);
            BuildPlain(set, arch, props);
            BuildScatter(set, env);
            BuildMarkers(set, markers);
            var shrine = Put("SM_Tripo_DesertPortalShrine", arch, set, ExitAt, ExitYaw, 1f, 0.15f, new Vector3(9.7f, 11, 3.3f));
            if (shrine) shrine.name = "Exit Shrine";

            // 玩家在 Core 场景（L1）：这里只放出生标记（面朝大佛窟与崖顶寺塔）+ 自举标记
            var spawnAt = set.OnGround(Spawn.x, Spawn.y, 0.05f);
            var pagodaTop = new Vector3(PagodaAt.x, TopY + PagodaPlatH + 20f, PagodaAt.y);
            var spawnRot = Quaternion.LookRotation(Flat(pagodaTop - spawnAt) + Flat(set.OnGround(NicheX, ColossusAt.y) - spawnAt) * 0.6f);
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            var objective = BuildEncounters(set, markers);
            BuildCaches(set, markers, objective);
            BuildEntries(set, markers);
            var portal = LevelKit.PortalAt("Exit Portal", markers, set.First, shrine, objective, ExitDoorOffset);

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            BuildLayout(set, props, markers, playerSpawn, portal, objective);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("1-A 千佛崖 · 验收");
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            rep.Line($"崖脚 y = {set.GroundY(Site1.x, Site1.y):F1}，窟檐层 y = {set.GroundY(Site2.x, Site2.y):F1}，崖顶 y = {set.GroundY(Site3.x, Site3.y):F1}，" +
                     $"塔基台 y = {set.GroundY(PagodaAt.x - 9, PagodaAt.y):F1}，大佛窟底 y = {set.GroundY(NicheX, Cz(NicheX) + 3):F1}，河床 y = {set.GroundY(200, RiverZ(200)):F1}，" +
                     $"沙洲 y = {set.GroundY(BarAt.x, BarAt.y):F1}");
            foreach (var (foot, top) in SandRamps.Concat(new[] { (StairFoot(0), StairTop(0)), (StairFoot(1), StairTop(1)) }))
                rep.Line($"坡道 ({foot.x:F0}, {foot.y:F0}) → ({top.x:F0}, {top.y:F0})：{set.GroundY(foot.x, foot.y):F1} → {set.GroundY(top.x, top.y):F1} m");
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线 + L5 规则集，见文件末尾的 Spec
            LevelKit.CheckEntries(rep, scene);
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_1-A_report.txt");

            if (review)
            {
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var colossusHead = G(ColossusAt, 15);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_1-A", new[]
                    {
                        ("Aerial", new Vector3(-30, 150, -70), new Vector3(150, 0, 130), false),
                        ("Map", new Vector3(152, 420, 107), new Vector3(152, 0, 108), false),
                        ("Spawn", E(Spawn), pagodaTop, true),
                        ("RiverCross", E(new Vector2(92, 52)), G(Site1, 6), false),
                        ("NichePlaza", E(Below(NicheX, 36)), colossusHead, false),
                        ("CliffFromBelow", E(Below(96, 26)), G(Ledge(96, 0.5f), 2), false),
                        ("LedgeWest", E(Ledge(56, 0.45f)), G(Ledge(112, 0.45f), 1), false),
                        ("SutraCave", E(Ledge(64, 0.45f)), G(SutraCave, 1), false),
                        ("StairwayWest", E(StairFoot(0)), G(StairTop(0), 2), false),
                        ("TopStupa", E(Top(124, 8)), G(StupaAt, 6), false),
                        ("Courtyard", E(Top(160, 8)), pagodaTop - Vector3.up * 8, false),
                        ("TopToRiver", E(Top(232, 3)), G(Site4, 1), false),
                        ("RiverCamp", E(new Vector2(244, RiverZ(244) - 34)), G(Site4, 1), false),
                        ("EastSlope", E(new Vector2(286, 122)), G(ExitAt, 5), false),
                        ("RevSpawn", E(RevSpawn), G(Site3, 2), true),
                        ("RevExit", E(new Vector2(40, 38)), G(RevExitAt, 4), false),
                    });
                }
                finally
                {
                    Object.DestroyImmediate(preview);
                }
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v : Vector3.forward;
        }

        /// <summary>
        /// L1 规则：关卡场景只有环境和标记——每种走法一个 PlayerSpawn、一个自举标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录；
        /// 另查出口传送门（每种走法一个）和藏宝点。顺带重新生成 GameDatabase
        /// </summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), portals = Count<ExitPortal>(), caches = Count<CachePOI>();
            if (spawns != 2) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 2：主走法 + 逆行）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (portals != 2) rep.Fail($"出口传送门有 {portals} 个（应为 2：主走法 + 逆行）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 个（应为 2）");
            void None<T>(string what) where T : Component
            {
                int n = Count<T>();
                if (n > 0) rep.Fail($"场景里有 {n} 个 {what}（应在 Core 场景）");
            }
            None<PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<Hud>("HUD");
            None<GameSession>("会话");
            None<EnemyCatalog>("敌人目录（改由 GameDatabase 提供）");
            if (spawns == 2 && boots == 1 && portals == 2)
                rep.Line("✓ PlayerSpawn ×2、出口 ×2（主走法 / 逆行各一）、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        // ───────────── 摆放 ─────────────
        /// <summary>按 id 摆到地形上（底面往下埋 sink × scale）；缺 Prefab 时放 size × scale 的占位白盒（验收会列出来）</summary>
        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, Vector3? size = null)
        {
            var go = LevelKit.PlaceOrBox(id, parent, set.OnGround(at.x, at.y, -sink * scale), (size ?? new Vector3(3, 3, 3)) * scale, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>摆在指定高度（窟檐层、崖顶的件，不随地形噪声抬落）</summary>
        static GameObject PutAt(string id, Transform parent, Vector2 at, float y, float yaw, float scale, Vector3 size)
        {
            var go = LevelKit.PlaceOrBox(id, parent, new Vector3(at.x, y, at.y), size * scale, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        static readonly Vector3 CloisterSize = new(6.17f, 7.5f, 2.85f), ParapetSize = new(1.89f, 1.1f, 0.38f);
        static readonly Vector3 CoverWallSize = new(4.9f, 2.6f, 1f), ColumnRuinSize = new(4.2f, 1.6f, 3.4f), GoodsSize = new(1.7f, 1.6f, 1.3f);

        /// <summary>
        /// 一排窟檐（二层回廊件，前敞后实，背贴崖壁）：x0 → x1 之间按件宽排满，每件按崖线切向转正；u = 件中心离崖脚线的距离，baseY = 件底面高度
        /// </summary>
        static int Eaves(Transform parent, float x0, float x1, Func<float, float> uOf, Func<Vector2, float> baseY, float scale)
        {
            float w = CloisterSize.x * scale;
            int n = Mathf.Max(1, Mathf.FloorToInt((x1 - x0) / w));
            float start = (x0 + x1) * 0.5f - n * w * 0.5f + w * 0.5f;
            for (int i = 0; i < n; i++)
            {
                float x = start + i * w;
                var at = AtU(x, uOf(x));
                var go = LevelKit.PlaceOrBox("SM_Tripo_DesertCloister", parent, new Vector3(at.x, baseY(at), at.y), CloisterSize * scale, YawOf(Outward(x)), scale);
                if (go) go.isStatic = true;
            }
            return n;
        }

        static void BuildCliff(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Grotto Cliff").transform;
            root.SetParent(arch, false);
            // 下崖壁的窟檐：崖脚一层回廊（1.05 倍，顶低于窟檐层面），避开两道积沙坡和大佛窟
            const float lowScale = 1.05f, highScale = 1.25f;
            float lowU = -CloisterSize.z * lowScale * 0.5f + 0.5f;
            var low = new GameObject("Eaves · Lower").transform;
            low.SetParent(root, false);
            int nLow = 0;
            foreach (var (a, b) in new[] { (40f, 56f), (78f, 134f), (166f, 220f), (238f, 258f) })
                nLow += Eaves(low, a, b, _ => lowU, at => set.GroundY(at.x, at.y) - 0.15f, lowScale);
            // 上崖壁的窟檐：窟檐层上一层回廊（1.25 倍，背贴上崖壁），避开两道斜道
            var high = new GameObject("Eaves · Upper").transform;
            high.SetParent(root, false);
            int nHigh = 0;
            // 西段在 x 62–80 留一段空崖：崖顶跃下的落点（② 的跃下站位）不压在窟檐屋顶上
            foreach (var (a, b) in new[] { (44f, 62f), (80f, 92f), (212f, 258f) })
                nHigh += Eaves(high, a, b, x => W1 + Depth(x) - CloisterSize.z * highScale * 0.5f + 0.5f, _ => LedgeY - 0.1f, highScale);

            // 窟檐层前沿的矮栏墙（低掩体，断续摆，跳得下去）
            var rail = new GameObject("Ledge Parapets").transform;
            rail.SetParent(root, false);
            int nRail = 0;
            for (float x = 46; x <= 256; x += 9)
            {
                if (Mathf.Abs(x - 64) < 8 || Mathf.Abs(x - 228) < 8 || (x > 134 && x < 166)) continue;
                var at = AtU(x, W1 + 0.6f);
                PutAt("SM_Tripo_DesertBeaconParapet", rail, at, LedgeY - 0.05f, YawOf(Outward(x)), 1.2f, ParapetSize);
                nRail++;
            }

            // 窟檐层上的掩体：货堆、塌柱、半埋塔刹（离站位 ≥ 2 m）
            PutAt("SM_Tripo_DesertGoodsPile", props, Ledge(70, 0.55f), LedgeY - 0.05f, 15, 1.2f, GoodsSize);
            PutAt("SM_Tripo_DesertColumnRuin", props, Ledge(91, 0.35f), LedgeY - 0.1f, 80, 1f, ColumnRuinSize);
            // ② 西段窟檐层的掩体：跃下落点之间一段矮墙、东头一道拒马；崖脚一段矮墙
            PutAt("SM_Tripo_DesertCoverWall", props, Ledge(72, 0.62f), LedgeY - 0.3f, YawOf(Outward(72)) + 90, 1f, CoverWallSize);
            PutAt("SM_Tripo_DesertBarricade", props, Ledge(84, 0.62f), LedgeY - 0.1f, YawOf(Outward(84)) + 90, 1f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Tripo_DesertCoverWall", props, set, Below(90, 20), 10, 1f, 0.3f, CoverWallSize);
            PutAt("SM_Prop_DesertUrns", props, Ledge(102, 0.3f), LedgeY - 0.05f, 0, 1.2f, new Vector3(0.8f, 0.8f, 0.8f));
            PutAt("SM_Tripo_DesertGoodsPile", props, Ledge(182, 0.35f), LedgeY - 0.05f, -20, 1.2f, GoodsSize);
            PutAt("SM_Tripo_DesertColumnRuin", props, Ledge(232, 0.4f), LedgeY - 0.1f, 20, 1f, ColumnRuinSize);
            PutAt("SM_Tripo_DesertFinial", props, Ledge(260, 0.45f), LedgeY - 1.2f, 30, 1f, new Vector3(2.5f, 5.5f, 2.3f));

            // ① 大佛窟：坐像背靠后壁、朝南；窟口广场的香炉、碑、火盆、矮墙、塌柱
            var niche = new GameObject("① Great Buddha Niche").transform;
            niche.SetParent(root, false);
            var colossus = LevelKit.PlaceOrBox("SM_Tripo_DesertSeatedColossus", niche, set.OnGround(ColossusAt.x, ColossusAt.y, -0.2f), ColossusSize * ColossusScale,
                180, ColossusScale);
            if (colossus) colossus.isStatic = true;
            Put("SM_Prop_DesertIncenseBurner", niche, set, Below(NicheX, 10), 0, 1.6f, 0.05f, new Vector3(1.3f, 2.6f, 1.2f));
            Put("SM_Prop_DesertStele", niche, set, Below(NicheX - 13, 9), 170, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            Put("SM_Prop_DesertStele", niche, set, Below(NicheX + 13, 9), 190, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            Put("SM_Tripo_DesertBrazier", niche, set, Below(NicheX - 8, 2), 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
            Put("SM_Tripo_DesertBrazier", niche, set, Below(NicheX + 8, 2), 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
            Put("SM_Tripo_DesertCoverWall", props, set, Below(138, 22), 15, 1f, 0.3f, CoverWallSize);
            Put("SM_Tripo_DesertCoverWall", props, set, Below(161, 21), -20, 1f, 0.3f, CoverWallSize);
            Put("SM_Tripo_DesertColumnRuin", props, set, Below(144, 30), 60, 1f, 0.2f, ColumnRuinSize);
            Put("SM_Tripo_DesertColumnRuin", props, set, Below(176, 26), -30, 1f, 0.2f, ColumnRuinSize);
            Put("SM_Tripo_DesertGoodsPile", props, set, Below(124, 26), 30, 1.2f, 0.15f, GoodsSize);
            Put("SM_Tripo_DesertFinial", props, set, Below(120, 34), 25, 1f, 1.4f, new Vector3(2.5f, 5.5f, 2.3f));

            // 藏经洞：西段窟檐层最西头，窟檐下的舍利龛（藏宝点模型由 BuildCaches 挂）
            Debug.Log($"[Level] 1-A 窟檐：崖脚 {nLow} 跨、窟檐层 {nHigh} 跨，栏墙 {nRail} 段");
        }

        static void BuildClifftop(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Clifftop").transform;
            root.SetParent(arch, false);
            // ③ 塔院：寺塔立在塔基台上（门朝南，望得见崖下）；台下两通碑、四个火盆，北、东两面夯土院墙残段，院里矮墙与货堆
            float platTop = TopY + PagodaPlatH;
            var pagoda = PutAt("SM_Tripo_DesertTemplePagoda", root, PagodaAt, platTop - 0.2f, 180, 1f, new Vector3(9.9f, 22.2f, 10.1f));
            if (pagoda) pagoda.name = "Temple Pagoda (landmark)";
            Put("SM_Prop_DesertStele", root, set, PagodaAt + new Vector2(-6, -PagodaHalf.y - 6), 180, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            Put("SM_Prop_DesertStele", root, set, PagodaAt + new Vector2(6, -PagodaHalf.y - 6), 180, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            foreach (var c in new[] { new Vector2(-1, -1), new Vector2(1, -1), new Vector2(-1, 1), new Vector2(1, 1) })
                PutAt("SM_Tripo_DesertBrazier", root, PagodaAt + Vector2.Scale(PagodaHalf - new Vector2(1.6f, 1.6f), c), platTop - 0.05f, 0, 1f, new Vector3(1.3f, 2.4f, 1.2f));
            PutAt("SM_Prop_DesertIncenseBurner", root, PagodaAt + new Vector2(0, -7.5f), platTop - 0.05f, 0, 1.3f, new Vector3(1.3f, 2.6f, 1.2f));
            var wall = new Vector3(4.87f, 3.2f, 0.99f);
            foreach (var (at, yaw) in new[]
                     {
                         (PagodaAt + new Vector2(-14, 20), 0f), (PagodaAt + new Vector2(-4, 21), 0f), (PagodaAt + new Vector2(8, 20), 5f),
                         (PagodaAt + new Vector2(26, 8), 90f), (PagodaAt + new Vector2(26, -4), 95f),
                     })
                Put("SM_Tripo_DesertPosthouseWall", root, set, at, yaw, 1f, 0.2f, wall);
            Put("SM_Tripo_DesertCoverWall", props, set, PagodaAt + new Vector2(-20, -8), 70, 1f, 0.3f, CoverWallSize);
            Put("SM_Tripo_DesertCoverWall", props, set, PagodaAt + new Vector2(18, -14), -15, 1f, 0.3f, CoverWallSize);
            Put("SM_Tripo_DesertColumnRuin", props, set, PagodaAt + new Vector2(-10, 15), 20, 1f, 0.2f, ColumnRuinSize);
            Put("SM_Tripo_DesertGoodsPile", props, set, PagodaAt + new Vector2(20, 12), 0, 1.2f, 0.15f, GoodsSize);

            // 西段崖顶：半埋佛塔 + 碑（第二地标）；东段崖顶：烽火角楼残迹（崖顶空段的引力点）、出口祭坛旁一对火盆
            var stupa = Put("SM_Tripo_DesertStupaBuried", root, set, StupaAt, 160, 1f, 0.5f, new Vector3(9.5f, 11, 8.9f));
            if (stupa) stupa.name = "Buried Stupa";
            Put("SM_Prop_DesertStele", root, set, StupaAt + new Vector2(-2, -10), 170, 1f, 0.05f, new Vector3(1.7f, 3.8f, 2.1f));
            Put("SM_Prop_DesertIncenseBurner", root, set, StupaAt + new Vector2(5, -9), 0, 1.2f, 0.05f, new Vector3(1.3f, 2.6f, 1.2f));
            Put("SM_Tripo_DesertCornerTower", root, set, TowerAt, 20, 1f, 0.4f, new Vector3(7.4f, 13, 5.3f));
            var side = new Vector2(ExitFace.y, -ExitFace.x);
            Put("SM_Tripo_DesertBrazier", root, set, ExitAt + ExitFace * 3.5f + side * 6.5f, 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
            Put("SM_Tripo_DesertBrazier", root, set, ExitAt + ExitFace * 3.5f - side * 6.5f, 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
        }

        static void BuildPlain(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Lower Temple & River").transform;
            root.SetParent(arch, false);
            // 崖下下寺遗址：沙里露出屋顶的殿堂、民居，塌柱、矮墙（崖脚到河之间的兴趣点）
            Put("SM_Tripo_DesertBuriedRoofHall", root, set, new Vector2(102, 108), 172, 1.4f, 1.8f / 1.4f, new Vector3(6.5f, 5.5f, 3.7f));
            Put("SM_Tripo_DesertBuriedRoofHouse", root, set, new Vector2(80, 98), -12, 1.4f, 1.6f / 1.4f, new Vector3(4.8f, 4.5f, 3.2f));
            Put("SM_Tripo_DesertBuriedRoofHouse", root, set, new Vector2(196, 104), 20, 1.4f, 1.6f / 1.4f, new Vector3(4.8f, 4.5f, 3.2f));
            Put("SM_Tripo_DesertBuriedRoofFlat", root, set, new Vector2(214, 116), 8, 1.6f, 1.2f / 1.6f, new Vector3(3.6f, 3.6f, 3.9f));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(118, 98), -20, 1f, 0.2f, ColumnRuinSize);
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(92, 120), 5, 1f, 0.3f, CoverWallSize);
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(184, 118), -10, 1f, 0.3f, CoverWallSize);

            // ④ 河洲驼队：沙洲上两辆残车、货堆、火盆，两岸拒马与陶罐
            var camp = new GameObject("④ River Caravan").transform;
            camp.SetParent(root, false);
            Put("SM_Tripo_DesertCaravanWreck", camp, set, BarAt + new Vector2(-6, 0.5f), 15, 1.3f, 0.25f, new Vector3(3.8f, 1.8f, 4));
            Put("SM_Tripo_DesertCaravanWreck", camp, set, BarAt + new Vector2(7, -0.8f), -60, 1.3f, 0.25f, new Vector3(3.8f, 1.8f, 4));
            Put("SM_Tripo_DesertGoodsPile", camp, set, BarAt + new Vector2(1, 1.8f), 30, 1.2f, 0.15f, GoodsSize);
            Put("SM_Tripo_DesertBrazier", camp, set, BarAt + new Vector2(13, 0.5f), 0, 1f, 0.05f, new Vector3(1.3f, 2.4f, 1.2f));
            Put("SM_Tripo_DesertBarricade", camp, set, new Vector2(232, RiverZ(232) + 12), 10, 1f, 0.15f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Tripo_DesertBarricade", camp, set, new Vector2(252, RiverZ(252) - 12), -10, 1f, 0.15f, new Vector3(4.8f, 1.2f, 1.2f));
            Put("SM_Tripo_DesertGoodsPile", camp, set, new Vector2(260, RiverZ(260) + 13), -30, 1.2f, 0.15f, GoodsSize);
            Put("SM_Prop_DesertUrns", camp, set, new Vector2(222, RiverZ(222) - 11), 0, 1.2f, 0.1f, new Vector3(0.8f, 0.8f, 0.8f));
            Put("SM_Tripo_DesertCoverWall", props, set, new Vector2(244, RiverZ(244) + 14), 0, 1f, 0.3f, CoverWallSize);

            // 南岸：出生点旁的断碑与残墙（来路），河滩遗骸（藏宝的残车由 BuildCaches 挂模型）、几座小雅丹压住南边天际线
            Put("SM_Tripo_DesertPosthouseWall", root, set, new Vector2(48, 20), 60, 1f, 0.2f, new Vector3(4.87f, 3.2f, 0.99f));
            Put("SM_Tripo_DesertColumnRuin", props, set, new Vector2(44, 40), 30, 1f, 0.2f, ColumnRuinSize);
            Put("SM_Tripo_DesertCaravanWreck", root, set, GuardCache + new Vector2(-7, 4), 40, 1.3f, 0.25f, new Vector3(3.8f, 1.8f, 4));
            Put("SM_Tripo_DesertBarricade", props, set, GuardCache + new Vector2(6, -6), 20, 1f, 0.15f, new Vector3(4.8f, 1.2f, 1.2f));
            foreach (var (at, yaw, scale) in new[] { (new Vector2(170, 22), 30f, 1.3f), (new Vector2(240, 30), 15f, 1.2f), (new Vector2(286, 44), 100f, 1.3f) })
                Put("SM_Tripo_DesertYardangSmall", root, set, at, yaw, scale, 0.4f, new Vector3(3.8f, 4, 5.7f));
        }

        static void BuildScatter(LevelKit.TerrainSet set, Transform env)
        {
            // 散布：砾石、骆驼刺、红柳避开广场、坡道、塔基台、出生点；巨砾只撒在南岸和崖下（不进场地）
            float Clear(Vector2 p)
            {
                float d = Vector2.Distance(p, Site1) - 18;
                foreach (var (foot, top) in SandRamps) d = Mathf.Min(d, LevelKit.SegmentDistance(p, foot, top, out _) - SandRampWidth * 0.5f - 1);
                StairHeight(p, out float stairMask);
                if (stairMask > 0.01f) d = 0;
                d = Mathf.Min(d, LevelKit.BoxSdf(p, PagodaAt - PagodaHalf - new Vector2(10, 10), PagodaAt + PagodaHalf + new Vector2(10, 4)));
                d = Mathf.Min(d, Vector2.Distance(p, Spawn) - 8);
                d = Mathf.Min(d, Vector2.Distance(p, ExitAt) - 10);
                d = Mathf.Min(d, Vector2.Distance(p, RevExitAt) - 8);
                if (Mathf.Abs(p.x - NicheX) < NicheHalf + 3) d = Mathf.Min(d, U(p) > -12 ? 0 : d);
                return Mathf.Max(0, d);
            }
            var counts = LevelKit.ScatterDetails(set, LevelKit.ScatterPresets.Details("Desert"), Clear, 1f, 180f);
            var boulders = LevelKit.ScatterPresets.Boulders("Desert");
            var where = boulders.where;
            boulders.where = pt => (where?.Invoke(pt) ?? 1) * (U(pt.p) < -18 ? 1 : 0) * Playable(pt.p)
                                   * (1 - Disc(pt.p, Spawn, 12, 4)) * (1 - Disc(pt.p, Site1, 26, 4)) * (1 - Disc(pt.p, Site4, 30, 4)) * (1 - Disc(pt.p, GuardCache, 18, 4));
            var big = LevelKit.ScatterProps(set, env, boulders, new Rect(10, 10, 285, 110), 9f, Clear);
            Debug.Log($"[Level] 1-A 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}；巨砾 {big.Count}");
        }

        // ───────────── 遭遇 ─────────────
        /// <summary>一个刷怪站位：位置、角色、lane、高台；出场方式（跃下给起跳点、飞临给入场点、埋伏给站岗朝向）</summary>
        sealed class AnchorDef
        {
            public string name;
            public Vector2 at;
            public StationRole role;
            public int lane;
            public bool elevated;
            public SpawnMode mode;
            /// <summary>跃下的起跳点（窟檐层前沿 / 崖顶前沿 / 河岸）、飞临的入场点（崖顶上空，离地 +12 m）、埋伏的站岗朝向目标</summary>
            public Vector2 other;

            public AnchorDef(string name, Vector2 at, StationRole role, int lane = 0, bool elevated = false)
            {
                this.name = name;
                this.at = at;
                this.role = role;
                this.lane = lane;
                this.elevated = elevated;
            }

            public AnchorDef Drop(Vector2 from)
            {
                mode = SpawnMode.Drop;
                other = from;
                return this;
            }

            public AnchorDef Fly(Vector2 from)
            {
                mode = SpawnMode.FlyIn;
                other = from;
                return this;
            }

            public AnchorDef Ambush(Vector2 facing)
            {
                mode = SpawnMode.Ambush;
                other = facing;
                return this;
            }
        }

        /// <summary>路遇埋伏小队（驻守点）的中心：西段河床、下寺遗址、西段崖顶（佛塔与西斜道顶之间）、东段窟檐层拐角——离必清据点 ≥ 触发 + 场地半径</summary>
        static readonly Vector2 RoadRiver = new(70, RiverZ(70)), RoadRuins = new(94, 100), RoadStupa = Top(124, 16), RoadLedge = Ledge(246, 0.5f);

        /// <summary>
        /// 刷怪站位（标记名 → 位置、角色、lane、高台、出场方式）。高台站位只给邪飞天（第一章其余敌人都贴地）；窟檐层、崖顶、塔基台是坡道走得上去的地面站位，
        /// 蝎卫 / 蜃楼蟾按「远程 / 炮击」角色站上去，从上往下压崖脚。跃下站位的落点在下一层、起跳点在上一层的前沿（窟檐层 8 m、崖顶 10 m、河岸 1.6 m）；
        /// 飞临站位给飞天，入场点在崖顶上空。埋伏站位是路遇小队开局站岗的位置，朝向来人的方向。每个站位离掩体件 ≥ 2 m。
        /// </summary>
        static List<AnchorDef> AnchorDefs() => new()
        {
            // ① 大佛窟前：窟口正面、广场两翼、南面正面；窟檐层东西两段远程；两处从窟檐层前沿跃下；广场东南蜃楼蟾；飞天从崖顶上空飞临窟口
            new("Enemy_1_NicheMouth", Below(NicheX, 4), StationRole.Assault),
            new("Enemy_1_West", Below(128, 14), StationRole.Flank, 1),
            new("Enemy_1_East", Below(172, 14), StationRole.Flank, 2),
            new("Enemy_1_South", Below(NicheX, 36), StationRole.Assault, 1),
            new("Enemy_1_LedgeW", Ledge(136, 0.45f), StationRole.Ranged),
            new("Enemy_1_LedgeE", Ledge(170, 0.4f), StationRole.Ranged, 1),
            new AnchorDef("Enemy_1_DropW", Below(136, 6), StationRole.Assault).Drop(Ledge(136, 0.12f)),
            new AnchorDef("Enemy_1_DropE", Below(164, 6), StationRole.Flank, 2).Drop(Ledge(164, 0.12f)),
            new("Enemy_1_Toad", Below(164, 32), StationRole.Artillery),
            new AnchorDef("Enemy_1_Air", Below(NicheX, 6), StationRole.Support, 0, true).Fly(Top(NicheX - 20, 10)),
            // ② 西崖窟檐：窟檐层两头正面，崖顶跃下两处，崖脚侧翼 / 远程，崖顶远程往下压，崖脚西南蜃楼蟾，飞天飞临
            new("Enemy_2_LedgeW", Ledge(58, 0.5f), StationRole.Assault),
            new("Enemy_2_LedgeE", Ledge(96, 0.4f), StationRole.Assault, 1),
            new AnchorDef("Enemy_2_DropA", Ledge(66, 0.35f), StationRole.Assault).Drop(Top(66, 1f)),
            new AnchorDef("Enemy_2_DropB", Ledge(76, 0.3f), StationRole.Flank, 1).Drop(Top(76, 1f)),
            new("Enemy_2_Below", Below(80, 12), StationRole.Flank, 1),
            new("Enemy_2_BelowE", Below(104, 18), StationRole.Ranged, 2),
            new("Enemy_2_Top", Top(78, 5), StationRole.Ranged),
            new("Enemy_2_Toad", Below(46, 20), StationRole.Artillery),
            new AnchorDef("Enemy_2_Air", Ledge(86, 0.3f), StationRole.Support, 0, true).Fly(Top(60, 14)),
            // ③ 崖顶塔院：塔院南、北正面，东西侧翼，塔基台上两处远程，东北蜃楼蟾，飞天从北沙山上空飞临
            new("Enemy_3_South", Top(174, 6), StationRole.Assault),
            new("Enemy_3_North", PagodaAt + new Vector2(0, 16), StationRole.Assault, 1),
            new("Enemy_3_West", PagodaAt + new Vector2(-28, 8), StationRole.Flank, 1),
            new("Enemy_3_East", PagodaAt + new Vector2(22, -6), StationRole.Flank, 2),
            new("Enemy_3_PlatformW", PagodaAt + new Vector2(-8, 6), StationRole.Ranged),
            new("Enemy_3_PlatformE", PagodaAt + new Vector2(9, -6), StationRole.Ranged, 1),
            new("Enemy_3_Toad", PagodaAt + new Vector2(18, 16), StationRole.Artillery),
            new AnchorDef("Enemy_3_Air", PagodaAt + new Vector2(0, -13), StationRole.Support, 0, true).Fly(PagodaAt + new Vector2(10, 26)),
            // ④ 河洲驼队：沙洲两头正面，河床两头侧翼，南北两岸远程，北岸跃下河床一处，西南岸蜃楼蟾，飞天飞临
            new("Enemy_4_BarW", BarAt + new Vector2(-12, 0), StationRole.Assault),
            new("Enemy_4_BarE", BarAt + new Vector2(12, -2), StationRole.Assault, 1),
            new("Enemy_4_FlankW", new Vector2(214, RiverZ(214)), StationRole.Flank, 1),
            new("Enemy_4_FlankE", new Vector2(266, RiverZ(266)), StationRole.Flank, 2),
            new("Enemy_4_NorthBank", new Vector2(236, RiverZ(236) + 18), StationRole.Ranged),
            new("Enemy_4_SouthBank", new Vector2(248, RiverZ(248) - 18), StationRole.Ranged, 1),
            new AnchorDef("Enemy_4_DropN", new Vector2(256, RiverZ(256) + 4), StationRole.Assault, 1).Drop(new Vector2(256, RiverZ(256) + 12)),
            new("Enemy_4_Toad", new Vector2(224, RiverZ(224) - 20), StationRole.Artillery),
            new AnchorDef("Enemy_4_Air", BarAt + new Vector2(0, 5), StationRole.Support, 0, true).Fly(new Vector2(250, RiverZ(250) + 40)),
            // 河滩遗骸守军（可选）
            new("Enemy_5_Ranged", GuardCache + new Vector2(-8, -12), StationRole.Ranged),
            new("Enemy_5_FlankA", GuardCache + new Vector2(14, 4), StationRole.Flank, 1),
            new("Enemy_5_FlankB", GuardCache + new Vector2(-16, 6), StationRole.Flank, 2),
            new("Enemy_5_Assault", GuardCache + new Vector2(10, -12), StationRole.Assault),
            // 驻守点：路遇埋伏小队（开局就站着，朝来人的方向）
            new AnchorDef("Enemy_6_A", RoadRiver + new Vector2(-4, 0.5f), StationRole.Assault).Ambush(Spawn),
            new AnchorDef("Enemy_6_B", RoadRiver + new Vector2(4, -1), StationRole.Flank, 1).Ambush(Spawn),
            new AnchorDef("Enemy_6_C", RoadRiver + new Vector2(0, 2.5f), StationRole.Assault, 2).Ambush(Spawn),
            new AnchorDef("Enemy_7_A", RoadRuins + new Vector2(-5, -3), StationRole.Assault).Ambush(new Vector2(70, 70)),
            new AnchorDef("Enemy_7_B", RoadRuins + new Vector2(4, -4), StationRole.Flank, 1).Ambush(new Vector2(110, 70)),
            new AnchorDef("Enemy_7_C", RoadRuins + new Vector2(0, 5), StationRole.Artillery).Ambush(Site1),
            new AnchorDef("Enemy_8_A", RoadStupa + new Vector2(-3, -3), StationRole.Ranged).Ambush(Top(132, 4)),
            new AnchorDef("Enemy_8_B", RoadStupa + new Vector2(4, 1), StationRole.Assault, 1).Ambush(Top(132, 4)),
            new AnchorDef("Enemy_8_C", RoadStupa + new Vector2(-1, 5), StationRole.Ranged, 2).Ambush(Top(132, 4)),
            new AnchorDef("Enemy_9_A", RoadLedge + new Vector2(-5, 0), StationRole.Assault).Ambush(Ledge(228, 0.45f)),
            new AnchorDef("Enemy_9_B", RoadLedge + new Vector2(4, 0.5f), StationRole.Ranged, 1).Ambush(Ledge(228, 0.45f)),
            new AnchorDef("Enemy_9_C", RoadLedge + new Vector2(0, -2.5f), StationRole.Flank, 2).Ambush(Ledge(214, 0.45f)),
        };

        static void BuildMarkers(LevelKit.TerrainSet set, Transform root)
        {
            void Mk(string name, Vector2 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = set.OnGround(p.x, p.y);
            }
            Mk("Site_Spawn", Spawn);
            Mk("Site_1_GreatBuddha", Site1);
            Mk("Site_2_LedgeWest", Site2);
            Mk("Site_3_PagodaCourt", Site3);
            Mk("Site_4_RiverCaravan", Site4);
            Mk("Site_5_RiverWreck", GuardCache);
            Mk("Site_Exit", ExitAt);
            foreach (var a in AnchorDefs())
            {
                var at = set.OnGround(a.at.x, a.at.y);
                var sa = SpawnAnchor.Create(root, a.name, at, a.role, a.lane, a.elevated).Via(a.mode);
                switch (a.mode)
                {
                    case SpawnMode.Drop:
                        sa.DropFrom(set.OnGround(a.other.x, a.other.y, 0.05f)).LookAt(at + (at - set.OnGround(a.other.x, a.other.y)));
                        break;
                    case SpawnMode.FlyIn:
                        sa.Entry(set.OnGround(a.other.x, a.other.y, 12f));
                        break;
                    case SpawnMode.Ambush:
                        sa.LookAt(set.OnGround(a.other.x, a.other.y));
                        break;
                }
            }
        }

        /// <summary>
        /// 怪物入场点（<see cref="MonsterEntry"/>）：据点之外的游荡怪群（CombatDirector，正式的局才跑）只从这里进场，摆在怪「从哪来」看得懂的地方——
        /// 窟檐层 / 崖顶前沿跃下、宕泉河上下游、南岸沙丘背后、崖顶北面的沙山、西头塌崖沙坡、崖顶上空（只给飞天）。离出生点 ≥ 30 m
        /// </summary>
        static void BuildEntries(LevelKit.TerrainSet set, Transform root)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var parent = new GameObject("Monster Entries").transform;
            parent.SetParent(root, false);
            // 跃下的入场点都摆在窟檐的空档上（起跳和落点之间没有窟檐屋顶）
            LevelKit.Entry(parent, "窟檐层跃下（西段）", G(Below(74, 6)), G(Below(74, 30)), SpawnMode.Drop, G(Ledge(74, 0.12f)));
            LevelKit.Entry(parent, "崖顶跃下（东段窟檐层）", G(Ledge(262, 0.5f)), G(Ledge(230, 0.5f)), SpawnMode.Drop, G(Top(262, 1f)));
            LevelKit.Entry(parent, "宕泉河上游", G(new Vector2(18, RiverZ(18))), G(new Vector2(60, RiverZ(60))));
            LevelKit.Entry(parent, "宕泉河下游", G(new Vector2(288, RiverZ(288))), G(new Vector2(250, RiverZ(250))));
            LevelKit.Entry(parent, "南岸沙丘背后", G(new Vector2(160, 14)), G(new Vector2(160, 50)));
            LevelKit.Entry(parent, "崖顶北沙山", G(Top(150, 40)), G(Top(150, 10)));
            LevelKit.Entry(parent, "西头塌崖沙坡", G(AtU(20, 6)), G(AtU(60, -10)));
            LevelKit.Entry(parent, "崖顶上空（飞天）", G(Top(120, 20)), G(Below(120, 20)), SpawnMode.FlyIn, null, 6f, true);
        }

        static EncounterSpec revOpeningTop, revFinaleLedge;

        /// <summary>
        /// 遭遇（第一章 V2 阵容：跳鼠刀兵 = 刀客、蝎尾弩卫 = 弩手、三彩镇墓兽 = 盾卫、火浣鼠 = 爆骸、蜃楼蟾 = 炮击、邪飞天 = 护佑、沙魇 = 潜行）。
        /// 用户 11-08：射得爽 = 武器牛逼、怪要多——四个据点都是 2–3 波、比 1-1 / 1-3 足：
        ///   ① 大佛窟前 15：窟前伏兵（窟檐层蝎卫压制）→ 佛前蜃影（蜃楼蟾 + 火浣鼠）→ 飞天护法（飞天 + 沙魇）；
        ///   ② 西崖窟檐 13：栈道守卫 → 窟里扑出（火浣鼠顺窟檐层滚）→ 崖顶滚火（沙魇 + 崖脚蜃楼蟾）；
        ///   ④ 河洲驼队 12：驼队残兵 → 河床伏沙（镇墓兽顺河床冲），升格 1 只精英；
        ///   ③ 崖顶塔院 17：塔院守卫 → 飞天赐福 → 千佛护法（写死精英镇墓兽 + 精英蝎卫）；
        ///   ⑤ 河滩遗骸守军 5（可选，调查藏宝时惊动，迅捷精英蝎卫）；
        ///   ⑥–⑨ 驻守点（路遇埋伏小队，各 3 只）：河床伏兵、下寺遗址、崖顶伏兵、窟檐拐角。
        /// 进场方式：① 末波跳鼠从窟檐层跃下、飞天从崖顶飞临；② 第二波跳鼠从崖顶跃下、第三波飞天飞临；③ 第二波飞天飞临；④ 第二波跳鼠从北岸跃下、飞天飞临。
        /// 必清 59 只，可选 5 + 12 只。奖励：① 武器、② 秘卷、④ 强化、③ 武器（保底精良）、遗骸藏宝 武器（保底精良）、藏经洞 秘卷。
        /// 关卡目标：①–④ 必清、先后不限。难度不写死（site.difficulty = 0，运行时按槽位）。
        /// </summary>
        static LevelObjective BuildEncounters(LevelKit.TerrainSet set, Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset = default)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = set.OnGround(center.x, center.y);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                var anchors = new List<Transform>();
                foreach (Transform m in markers)
                    if (m.name.StartsWith($"Enemy_{index}_"))
                        anchors.Add(m);
                site.anchors = anchors.ToArray();
                return site;
            }
            WaveEntry E(string enemy, int count, float delay = -1) => EncounterSpec.E(enemy, count, delay);

            var s1 = Site(1, "大佛窟前", Site1, 22, 30, EncounterSpec.Of(
                    EncounterSpec.Wave("窟前伏兵", E("jerboa_blade", 4), E("scorpion_archer", 2, 1f)).Hint("蝎卫在窟檐层上压制：贴着崖脚的回廊推进"),
                    EncounterSpec.Wave("佛前蜃影", E("mirage_toad", 2), E("fire_rat", 3, 0.8f)).After(2, 1.4f).Hint("蜃楼蟾在广场边吊射，火浣鼠滚进来逼走位"),
                    EncounterSpec.Wave("飞天护法", E("apsara", 1).Via(SpawnMode.FlyIn), E("jerboa_blade", 2).Via(SpawnMode.Drop), E("sand_wraith", 1)).After(1, 1.8f)
                        .Hint("飞天从崖顶飞下来、跳鼠从窟檐层跃下——先打飞天的琵琶"))
                .Gather(0.4f).Distance(10, 34), "weapon", new Vector3(0, 0, -8));
            var s2 = Site(2, "西崖窟檐", Site2, 20, 28, EncounterSpec.Of(
                    EncounterSpec.Wave("栈道守卫", E("jerboa_blade", 3), E("scorpion_archer", 2, 1f)).Hint("窟檐层上近身，崖脚和崖顶都有弩卫——借回廊的柱子挡"),
                    EncounterSpec.Wave("崖顶跃下", E("jerboa_blade", 2).Via(SpawnMode.Drop), E("fire_rat", 3, 0.6f)).After(2, 1.4f).Hint("跳鼠从崖顶跳下来，火浣鼠顺着窟檐层滚——跳下崖脚躲开也行"),
                    EncounterSpec.Wave("飞天赐福", E("apsara", 1).Via(SpawnMode.FlyIn), E("sand_wraith", 2), E("mirage_toad", 1)).After(1, 1.6f)
                        .Hint("蜃楼蟾在崖脚吊射窟檐层：别贴着栏墙站，先打飞天"))
                .Gather(0.4f).Distance(10, 32), "scroll");
            var s3 = Site(3, "崖顶塔院", Site3, 24, 30, EncounterSpec.Of(
                    EncounterSpec.Wave("塔院守卫", E("tomb_beast", 1), E("jerboa_blade", 3), E("scorpion_archer", 2, 1f)).Hint("镇墓兽正面格挡——上塔基台绕到它背后"),
                    EncounterSpec.Wave("飞天赐福", E("apsara", 1).Via(SpawnMode.FlyIn), E("fire_rat", 3), E("mirage_toad", 1, 1f)).After(2, 1.6f).Hint("先打飞天的琵琶，再清火浣鼠"),
                    EncounterSpec.Wave("千佛护法", E("tomb_beast", 1).Elite(), E("scorpion_archer", 1).Elite(), E("jerboa_blade", 2), E("sand_wraith", 1)).After(1, 2f)
                        .Hint("精英护法——塔基台上有俯射位"))
                .Gather(0.6f).Distance(10, 34), "weapon:min=1");
            var s4 = Site(4, "河洲驼队", Site4, 22, 30, EncounterSpec.Of(
                    EncounterSpec.Wave("驼队残兵", E("jerboa_blade", 3), E("scorpion_archer", 2, 1f), E("fire_rat", 2, 1.4f)).Hint("沙洲上的残车是掩体，两岸有弩卫"),
                    EncounterSpec.Wave("河床伏沙", E("sand_wraith", 2), E("tomb_beast", 1), E("jerboa_blade", 2, 0.8f).Via(SpawnMode.Drop), E("apsara", 1, 1.2f).Via(SpawnMode.FlyIn))
                        .After(2, 1.6f).Hint("镇墓兽顺河床冲过来：侧闪，打背后的裂缝；飞天从北岸飞来"))
                .Gather(0.4f).Distance(10, 34).Elites(1), "upgrade");
            var guard = Site(5, "遗骸守军", GuardCache, 14, 20, EncounterSpec.Of(
                    EncounterSpec.Wave("遗骸守军", E("scorpion_archer", 1).Elite("swift"), E("jerboa_blade", 3), E("sand_wraith", 1)).Hint("守着驼队遗骸的一小队，沙里还伏着沙魇"))
                .Gather(0.4f).Distance(8, 26), "");
            guard.autoTrigger = false;
            guard.optional = true;

            // 驻守点：路遇埋伏小队（不计目标、不落宝箱；开局就站着，走近 / 开枪整组苏醒）——西段河床、下寺遗址、西段崖顶佛塔旁、东段窟檐层拐角
            WaveEntry A(string enemy, int count) => E(enemy, count).Via(SpawnMode.Ambush);
            Site(6, "河床伏兵", RoadRiver, 12, 16, EncounterSpec.Of(EncounterSpec.Wave("河床伏兵", A("jerboa_blade", 2), A("fire_rat", 1))
                    .Hint("干河床里趴着一小队——先手打掉火浣鼠")).Gather(0.3f).Distance(6, 22), "").AsRoadside(12f, 16f);
            Site(7, "下寺遗址", RoadRuins, 12, 16, EncounterSpec.Of(EncounterSpec.Wave("下寺遗址", A("jerboa_blade", 2), A("mirage_toad", 1))
                    .Hint("蜃楼蟾蹲在屋脊后面")).Gather(0.3f).Distance(6, 22), "").AsRoadside(12f, 16f);
            Site(8, "崖顶伏兵", RoadStupa, 12, 16, EncounterSpec.Of(EncounterSpec.Wave("崖顶伏兵", A("scorpion_archer", 2), A("jerboa_blade", 1))
                    .Hint("崖顶上的弩卫——贴着斜道口的崖壁打")).Gather(0.3f).Distance(6, 22), "").AsRoadside(12f, 16f);
            Site(9, "窟檐拐角", RoadLedge, 12, 16, EncounterSpec.Of(EncounterSpec.Wave("窟檐拐角", A("jerboa_blade", 2), A("scorpion_archer", 1))
                    .Hint("窟檐层拐角后面守着一队")).Gather(0.3f).Distance(6, 22), "").AsRoadside(12f, 16f);

            // 逆行走法（BuildLayout）：③ 先打 → 开场编制、给武器；② 最后打 → 终局编制（精英护法）、给保底精良武器
            revOpeningTop = EncounterSpec.Of(
                    EncounterSpec.Wave("塔院守卫", E("jerboa_blade", 4), E("scorpion_archer", 2, 1f)).Hint("塔基台上有弩卫——从坡道冲上去或绕到台后"),
                    EncounterSpec.Wave("飞天赐福", E("apsara", 1), E("fire_rat", 3, 0.8f)).After(2, 1.6f).Hint("先打飞天的琵琶，再清火浣鼠"))
                .Gather(0.6f).Distance(10, 34);
            revFinaleLedge = EncounterSpec.Of(
                    EncounterSpec.Wave("栈道守卫", E("jerboa_blade", 3), E("scorpion_archer", 2, 1f), E("mirage_toad", 1, 1.2f)).Hint("窟檐层上近身，崖脚和崖顶都有弩卫"),
                    EncounterSpec.Wave("窟里扑出", E("fire_rat", 3), E("sand_wraith", 2, 0.8f)).After(2, 1.4f).Hint("火浣鼠顺着窟檐层滚过来"),
                    EncounterSpec.Wave("千佛护法", E("tomb_beast", 1).Elite(), E("scorpion_archer", 1).Elite(), E("jerboa_blade", 2)).After(1, 2f)
                        .Hint("精英护法——退上崖壁斜道居高临下"))
                .Gather(0.4f).Distance(10, 32);

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿过千佛崖";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { guard };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 支路藏宝（CachePOI）：南岸河滩遗骸有守军（调查时惊动「遗骸守军」，肃清后出宝箱，武器保底精良）；西段窟檐层最西头的藏经洞无人看守（秘卷）——
        /// 奖励走窟檐层的人。模型（宝藏堆 / 舍利龛）放在藏宝点旁 2 m，宝箱从藏宝点本身冒出来
        /// </summary>
        static void BuildCaches(LevelKit.TerrainSet set, Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            CachePOI Cache(string title, Vector2 at, float yaw, string reward, EncounterSite guardSite, string modelId, Vector2 modelOffset, float modelScale, Vector3 size)
            {
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                poi.transform.SetPositionAndRotation(set.OnGround(at.x, at.y), Quaternion.Euler(0, yaw, 0));
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = 14;
                var mAt = at + modelOffset;
                var model = LevelKit.PlaceOrBox(modelId, poi.transform, set.OnGround(mAt.x, mAt.y, -0.1f), size * modelScale, yaw, modelScale);
                if (model)
                {
                    model.name = "Model";
                    model.transform.SetPositionAndRotation(set.OnGround(mAt.x, mAt.y, -0.1f), Quaternion.Euler(0, yaw, 0));
                    model.isStatic = true;
                }
                return poi;
            }
            Cache("河滩遗骸", GuardCache, 200, "weapon:min=1", guard, "SM_Tripo_DesertTreasureHoard", new Vector2(2.5f, 1.2f), 0.7f, new Vector3(2.6f, 1.8f, 1.9f));
            Cache("藏经洞", SutraCave, YawOf(Outward(SutraCave.x)), "scroll", null, "SM_Prop_DesertReliquary", new Vector2(2.2f, 1.2f), 1f, new Vector3(1.5f, 2.5f, 0.6f));
        }

        /// <summary>
        /// 布局变体（docs/level-design/run-variety.md §2）：main = 西南沙丘出生 → 崖顶东头出口；reverse = 崖顶东头祭坛前出生 → 西南岸新立的出口祭坛，
        /// ③ / ② 的编制和奖励对调、① 改给秘卷（场地本来就先后不限，不改 requires）。在 NavMesh 烘焙之后调：逆行的祭坛不进导航网格，运行时由 NavMeshObstacle 挖洞
        /// </summary>
        static void BuildLayout(LevelKit.TerrainSet set, Transform props, Transform markers, PlayerSpawn mainSpawn, ExitPortal mainExit, LevelObjective objective)
        {
            var (s1, s2, s3) = (objective.required[0], objective.required[1], objective.required[2]);
            var revSpawn = LevelKit.SpawnMarker("PlayerSpawn · 逆行", markers, set.First, RevSpawn, Site3);
            var (shrine, portal) = LevelKit.VariantExit("SM_Tripo_DesertPortalShrine", props, markers, set.First, RevExitAt, RevExitYaw, new Vector3(9.7f, 11, 3.3f),
                objective, "Exit · 逆行", ExitDoorOffset);
            LevelKit.Layout(markers,
                new LevelLayout.Variant { id = "main", title = "自宕泉南岸入", spawn = mainSpawn, exit = mainExit },
                new LevelLayout.Variant
                {
                    id = "reverse", title = "自崖顶入", spawn = revSpawn, exit = portal,
                    only = new[] { shrine },
                    sites = new[]
                    {
                        LevelKit.Override(s3, revOpeningTop, s1.reward), LevelKit.Override(s2, revFinaleLedge, s3.reward), LevelKit.Override(s1, null, s2.reward),
                    },
                });
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 交给 L5 规则集（<see cref="LevelValidator"/>）的声明：主线路点（出生 → 遗骸 → 过河 → ① → 西积沙坡 → ② → 藏经洞 → 西斜道 → 半埋佛塔 → ③ 塔基台 →
        /// 东斜道 → 东积沙坡 → ④ → 东头沙坡 → 出口；逆行：东头祭坛前 → ③ → ① → 西南岸出口祭坛），四道坡道 + 两头塌崖沙坡的坡度，6 条地标视线。
        /// 软边界没有空气墙：越界按远处的兜底环算（escapeMargin = 兜底距离 + 2 m）
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var pagodaTop = new Vector3(PagodaAt.x, TopY + PagodaPlatH + 20f, PagodaAt.y);
            var colossusHead = G(ColossusAt, 15);
            float westX = 10, eastX = 294;
            var spec = new LevelSpec
                {
                    id = "1-A", title = "千佛崖", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    slopePaths =
                    {
                        new SlopePath { name = "西积沙坡", points = new[] { SandRamps[0].foot, SandRamps[0].top } },
                        new SlopePath { name = "东积沙坡", points = new[] { SandRamps[1].foot, SandRamps[1].top } },
                        new SlopePath { name = "西崖壁斜道", points = StairLine(0) },
                        new SlopePath { name = "东崖壁斜道", points = StairLine(1) },
                        new SlopePath { name = "西头塌崖沙坡", points = new[] { Below(westX, 34), Top(westX, 6) } },
                        new SlopePath { name = "东头塌崖沙坡", points = new[] { Below(eastX, 34), Top(eastX, 6) } },
                        new SlopePath { name = "塔基台南坡道", points = new[] { PagodaRamps[0].foot, PagodaRamps[0].top } },
                    },
                    sites =
                    {
                        S("出生·宕泉南岸（缓冲）", Spawn, 30, combat: false),
                        S("① 大佛窟前", Site1, 48, cover: 3, layers: 2, overlook: true),
                        S("② 西崖窟檐", Site2, 40, cover: 3, layers: 2, overlook: true),
                        S("③ 崖顶塔院", Site3, 46, cover: 3, layers: 2, overlook: true),
                        S("④ 河洲驼队", Site4, 48, cover: 3),
                    },
                }
                .Route("出生·宕泉南岸", G(Spawn)).Route("藏宝·河滩遗骸", G(GuardCache + new Vector2(0, -4))).Route("过河", G(new Vector2(130, RiverZ(130))))
                .Route("① 大佛窟前", G(Site1)).Route("西积沙坡脚", G(SandRamps[0].foot)).Route("西积沙坡顶", G(Ledge(64, 0.45f)))
                .Route("② 西崖窟檐", G(Site2)).Route("藏宝·藏经洞", G(SutraCave + Outward(SutraCave.x) * 2.5f)).Route("西崖壁斜道脚", G(StairFoot(0)))
                .Route("西崖壁斜道顶", G(Top(134, 4))).Route("半埋佛塔", G(StupaAt + new Vector2(4, -10))).Route("③ 塔基台", G(PagodaAt + new Vector2(-9, -5)))
                .Route("东崖壁斜道顶", G(Top(170, 4))).Route("东崖壁斜道脚", G(StairFoot(1))).Route("东积沙坡顶", G(Ledge(228, 0.45f)))
                .Route("东积沙坡脚", G(SandRamps[1].foot)).Route("④ 河洲驼队", G(Site4)).Route("东头塌崖沙坡", G(Below(eastX - 4, 10)))
                .Route("出口祭坛前", G(ExitAt + ExitFace * 4.5f))
                // 逆行变体：东头祭坛前出生 → ③ → ① → 西南岸的出口祭坛前
                .Route("逆行·出生", G(RevSpawn)).Route("③ 塔院南", G(Site3)).Route("① 大佛窟前", G(Site1))
                .Route("逆行·出口祭坛", G(RevExitAt + new Vector2(Mathf.Sin(RevExitYaw * Mathf.Deg2Rad), Mathf.Cos(RevExitYaw * Mathf.Deg2Rad)) * 4.5f))
                .Sight("出生 → 崖顶寺塔", G(Spawn, 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("出生 → 大佛", G(Spawn, 1.62f), colossusHead, 6, "SM_Tripo_DesertSeatedColossus")
                .Sight("① 窟口 → 大佛", G(Below(NicheX, 30), 1.62f), colossusHead, 6, "SM_Tripo_DesertSeatedColossus")
                .Sight("② 窟檐层 → 寺塔", G(Ledge(100, 0.3f), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda")
                .Sight("③ 崖顶前沿 → 河洲驼队", G(Top(222, 2), 1.62f), G(Site4, 1.5f), 6)
                .Sight("④ 河洲 → 寺塔", G(BarAt + new Vector2(-14, 0), 1.62f), pagodaTop, 6, "SM_Tripo_DesertTemplePagoda");
            return spec;
        }
    }
}
