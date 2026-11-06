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
    /// 祝融火狱 3-1「熔湖关隘」场景套件的样板场景（docs/art/zhurong-kit-31.md）：只用这套 Tripo 大中小件 + 地形 + 熔岩搭出概念图
    /// （art/reviews/ch3-zhurong-scene-concepts/3-1-molten-lake-pass-v3.webp）那一屏，验收套件能不能拼出完整场景。
    /// 纯美术场景：没有玩家、遭遇、NavMesh；不进构建设置。世界坐标 x 向东、z 向北，熔岩面 y = 0。
    ///   南沿眺台（镜头）→ 左前渡口关楼 + 石码头台 → 两段双拱堤 → 湖心税关 → 一段堤 → 北岸码头 → 程序大台阶 → 宫门（主焦点）+ 宫墙 + 一高一矮两座鼓楼
    ///   → 崖顶祝融像（次焦点）；右侧镇鼎墩 + 楚式升鼎，四条巨链拉到东崖和墩角；火口一圈玄武岩峰；前景岩堆压暗框景。
    /// 远处另摆一排全套件（Kit Lineup），截套件总览。
    /// 构图规则：docs/art/composition.md（先大块面 → 引导线 → 光 → 色 → 小件最后摆）；色彩脚本：docs/art/ch3-look.md。
    /// 生成：bridge.sh level zr31（或 Spiritfire ▸ Levels ▸ Build ZR31）；截图 Assets/Art/_Review/zr31_*。
    /// </summary>
    [LevelBuilder("zr31", ScenePath)]
    public static class Level_ZhurongKit31
    {
        public const string Dir = "Assets/Levels/ZR31_MoltenLakePass";
        public const string ScenePath = "Assets/Scenes/ZR31_MoltenLakePass.unity";
        const string Name = "ZR31";
        const float Base = 12f, HeightRange = 80f, PlainY = 8f;
        static readonly Vector2 Origin = new(-200, -200), Size = new(400, 400);
        const float LavaY = 0f, BedY = -1.2f;

        const string K = "SM_Tripo_Zhurong";
        const string Statue = K + "Statue", Gate = K + "PalaceGate", Ferry = K + "FerryTower", Fort = K + "CustomsFort", Pier = K + "DingPier",
            Spire = K + "CliffSpire", Ding = K + "Ding", Drum = K + "DrumTower", Wall = K + "PalaceWall", Bridge = K + "ArchBridge",
            Landing = K + "Landing", Boulders = K + "Boulders", Lantern = K + "ParapetLantern", Brazier = K + "Brazier";
        const string ChainLinkId = "SM_Prop_InfernoChainLink";

        /// <summary>登记尺寸（缺 Prefab 时的白盒）</summary>
        static readonly Dictionary<string, Vector3> Reg = new()
        {
            [Statue] = new(14.6f, 28, 9.3f), [Gate] = new(22, 18, 8.2f), [Ferry] = new(14, 20, 12), [Fort] = new(29.3f, 14, 20.4f), [Pier] = new(14, 8, 14),
            [Spire] = new(43.6f, 45, 21.7f), [Ding] = new(6, 8, 4.5f), [Drum] = new(7, 20, 7), [Wall] = new(16.6f, 12, 4.8f), [Bridge] = new(24.7f, 7, 4.2f),
            [Landing] = new(14, 4, 10), [Boulders] = new(8, 4, 6), [Lantern] = new(1.05f, 1.6f, 1.05f), [Brazier] = new(2.1f, 1.4f, 2.1f),
        };

        // 布局（世界 XZ，米）
        static readonly Vector2 CraterC = new(5, 14), CraterR = new(70, 88);
        static readonly Vector2 Eye = new(-4, -60);
        const float LookoutY = 12f, ShelfY = 3f, IslandY = 2f, QuayY = 2f, TerraceY = 10f, CliffY = 34f;

        // 概念机位 = 概念图的镜头：竖直 FOV 55°（游戏里 70° 太广，地标全缩成小件），朝北偏西 13°、俯 6°，眼高 ≈ 熔岩面上 14.7 m。
        // 左前关楼、中间湖心税关、右前镇鼎、右后宫门与祝融像都按它们在概念图里的画面横坐标反算成「相对视轴的角度 + 距离」摆，
        // 宫门 / 祝融像 / 大台阶不动（它们在这个机位下正好落在概念图的位置），所以视轴偏西 13° 是由宫门和像的连线反推出来的
        const float ConceptYaw = -13f, ConceptPitch = -6f, ConceptFov = 55f, ConceptLift = 1f;
        static Vector2 FromEye(float rel, float d)
        {
            float a = (ConceptYaw + rel) * Mathf.Deg2Rad;
            return Eye + d * new Vector2(Mathf.Sin(a), Mathf.Cos(a));
        }
        // 关楼：画面左 1/4（相对视轴 −36°）、35 m（再近屋顶就出画）；税关：画面中线偏右（+4°）、70 m；镇鼎墩：画面右缘（+35°）、43 m
        static readonly Vector2 FerryAt = FromEye(-36, 35), IslandC = FromEye(4, 70), PierAt = FromEye(35, 43);
        // 双拱堤从关楼前的码头斜着伸向税关西南角（侧面的拱朝镜头）；第二段从税关东北角接北岸码头
        static readonly Vector2 CauseA = FromEye(-22, 33), CauseB = FromEye(0, 58), Cause2A = new(-4, 20), Cause2B = new(4, 35);
        const float StairX0 = 2, StairX1 = 18, StairZ0 = 38, StairZ1 = 52;
        static readonly Vector2 GateAt = new(10, 64), StatueAt = new(14, 94);
        // 西北峡口（概念图中线偏左那道峡谷 + 远处渡槽，相对视轴 −11°）：沿视线方向切穿火口壁，谷底从熔岩河升到远处平地
        static readonly Vector2 GorgeAt = new(-56, 57), GorgeDir = new Vector2(-0.407f, 0.914f).normalized;
        const float GorgeHalfW = 10, GorgeEdge = 14, AqueductAlong = 45;
        static float GorgeFloor(float along) => Mathf.Lerp(BedY, PlainY, Smooth(4, 70, along));

        static LevelKit.TerrainSet ts;

        [MenuItem("Spiritfire/Levels/Build ZR31 熔湖关隘套件样板", priority = 90)]
        public static void BuildMenu() => Build(true);

        static Vector3 G(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        // ───────────── 地形 ─────────────

        static float Disc(Vector2 q, Vector2 c, float r, float edge) => 1 - Smooth(r - edge, r, Vector2.Distance(q, c));

        static LevelKit.Sample Eval(Vector2 q)
        {
            var s = new LevelKit.Sample();
            float n = Fbm(q, 40, 3, 11);
            float h = BedY + n * 0.2f;

            // 火口壁：椭圆外 12% 内陡升到 +30 – 40；南侧（镜头身后）也是崖
            float e = new Vector2((q.x - CraterC.x) / CraterR.x, (q.y - CraterC.y) / CraterR.y).magnitude;
            float wallTop = 30 + Fbm(q, 70, 3, 3) * 10;
            float wall = Mathf.Lerp(BedY, wallTop, Smooth(0.98f, 1.12f, e));
            h = Mathf.Max(h, wall);
            float rock = Smooth(0.99f, 1.04f, e);

            // 南沿：岸台 +3（z < −42）→ 眺台 +12（z < −60）
            float shelf = Mathf.Lerp(BedY, ShelfY + n * 0.4f, 1 - Smooth(-46, -40, q.y));
            float lookout = Mathf.Lerp(ShelfY, LookoutY, 1 - Smooth(-58, -50, q.y));
            if (q.y < -40) h = Mathf.Max(h, q.y < -50 ? Mathf.Max(shelf, lookout) : shelf);
            // 渡口西岸、湖心岛（岛体主要由税关自带的岩基撑起，地形只给岸）
            h = Mathf.Max(h, Mathf.Lerp(BedY, ShelfY, Disc(q, FerryAt, 18, 6)));
            h = Mathf.Max(h, Mathf.Lerp(BedY, IslandY + n, Disc(q, IslandC, 17, 7)));
            // 北岸：码头 +2（z > 58）→ 台地 +10（z > 78，大台阶两侧是陡坎）→ 宫后崖 +34（z > 112）
            float quay = Mathf.Lerp(BedY, QuayY, Smooth(30, 36, q.y));
            float terrace = Mathf.Lerp(QuayY, TerraceY, Smooth(50, 53, q.y));
            float cliff = Mathf.Lerp(TerraceY, CliffY + Fbm(q, 50, 3, 8) * 6, Smooth(78, 90, q.y));
            if (q.y > 26) h = Mathf.Max(h, q.y > 76 ? Mathf.Max(terrace, cliff) : Mathf.Max(quay, terrace));
            // 西北峡口：沿 GorgeDir 切穿火口壁和北岸台地 / 宫后崖（这两项横贯全宽，所以要在它们之后切）；谷壁边缘加点噪声，不是一刀切的直槽
            var gq = q - GorgeAt;
            float along = Vector2.Dot(gq, GorgeDir), across = Mathf.Abs(gq.x * GorgeDir.y - gq.y * GorgeDir.x);
            if (along > -12)
            {
                float cut = (1 - Smooth(GorgeHalfW, GorgeHalfW + GorgeEdge, across + Fbm(q, 18, 2, 21) * 4)) * Smooth(-12, 0, along);
                h = Mathf.Lerp(h, Mathf.Min(h, GorgeFloor(along) + n * 0.3f), cut);
            }
            // 祝融像崖台（平顶）
            h = Mathf.Max(h, Mathf.Lerp(h, CliffY, Disc(q, StatueAt, 16, 6)));

            s.h = h + Base;   // 高度场的 0 对应世界 y = −Base（LevelKit.TerrainSpec.baseHeight）
            s.fluid = h < 0.3f ? 1 : 0;
            s.shore = Mathf.Clamp01(1 - Mathf.Abs(h - 0.8f) / 1.6f) * (1 - s.fluid);
            s.rock = Mathf.Max(rock, Smooth(4, 12, h) * Smooth(0.85f, 1, e));
            s.packed = (q.y > 34 && q.y < 76 && Mathf.Abs(q.x - GateAt.x) < 30) || (q.y < -50 && Mathf.Abs(q.x - Eye.x) < 14) ? 0.8f : 0;
            return s;
        }

        // ───────────── 构建 ─────────────

        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Inferno;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var big = new GameObject("Kit · 大").transform;
            var mid = new GameObject("Kit · 中").transform;
            var small = new GameObject("Kit · 小").transform;
            var fx = new GameObject("Lights").transform;
            var world = new GameObject("World").transform;
            var rep = new LevelKit.Report();
            rep.Line("ZR31 熔湖关隘 · 套件样板场景");

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            try
            {
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, CraterC, PlainY, 760, 7);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);
                var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Molten Lake", center = new Vector3(CraterC.x, LavaY, CraterC.y), shape = LavaShape.Box, size = CraterR * 2.1f, depth = 2.5f, depthShore = true,
                }, world);
                if (lava.surface && LevelKit.Ch3LavaCrust(Dir, "LakeCrust", molten: -0.6f, crack: 0.035f, emission: 1.0f, plateScale: 0.045f) is { } crust)
                {
                    // 概念图的熔湖 = 暗紫灰硬壳 + 几道细亮缝。近处的亮斑来自三处：热区化开的熔池（molten < 0 关掉）、
                    // 热区自动加宽的裂缝（_HeatCrackWiden 0.1 → 0.015）、壳上的冒泡亮点（_BubbleAmount 0.45 → 0.06）。
                    // 壳色提到暗紫灰（默认的近黑壳在缝少了以后整片发死）
                    crust.SetFloat("_HeatCrackWiden", 0.015f);
                    crust.SetFloat("_BubbleAmount", 0.06f);
                    crust.SetColor("_CrustColor", new Color(0.17f, 0.13f, 0.18f));
                    EditorUtility.SetDirty(crust);
                    AssetDatabase.SaveAssetIfDirty(crust);
                    lava.surface.sharedMaterial = crust;
                }

                // 1. 大块面：火口崖峰、宫门、关楼、税关、鼎墩、祝融像
                BuildSpires(big);
                var gate = PutH(Gate, big, G(GateAt, -0.2f), 180, 24, rep);
                var ferryYaw = YawZ(Eye - FerryAt) - 10;
                var ferry = PutH(Ferry, big, G(FerryAt, -0.3f), ferryYaw, 22, rep);
                PutH(Fort, big, At(IslandC, -0.8f), YawZ(Eye - IslandC) + 8, 17f, rep);
                float pierYaw = YawZ(Eye - PierAt) - 4;
                var pier = PutH(Pier, big, At(PierAt, -1.4f), pierYaw, 11f, rep);
                var statue = PutH(Statue, big, G(StatueAt, -0.3f), 180, 38, rep);

                // 2. 引导线：堤（关楼码头 → 湖心税关 → 北岸）、大台阶直指宫门；峡口里一道渡槽做远景层次
                PutH(Landing, mid, At(FerryAt + new Vector2(15.5f, 3), -0.6f), 73, 4.2f, rep);
                Causeway(mid, CauseA, CauseB, 1, rep);
                Causeway(mid, Cause2A, Cause2B, 1, rep);
                GrandStairs(mid);
                Walls(mid, gate, rep);
                {
                    // 渡槽：桥身横跨峡谷、两头埋进谷壁，拱脚落在谷底
                    var aq = GorgeAt + GorgeDir * AqueductAlong;
                    PutH(Bridge, mid, At(aq, GorgeFloor(AqueductAlong) - 0.5f), YawZ(GorgeDir), 18, rep);
                }

                // 3. 鼎 + 链（鼎墩顶上的阶式鼎座）
                if (pier)
                {
                    float top = TopAt(pier, PierAt + new Vector2(0, -1.5f), WorldBounds(pier).max.y);
                    var ding = PutH(Ding, mid, At(PierAt + new Vector2(0, -1.5f), top - 0.15f), pierYaw, 11f, rep);
                    if (ding)
                    {
                        var b = WorldBounds(ding);
                        var hi = new Vector3(b.center.x, b.max.y - 0.6f, b.center.z);
                        var side = Quaternion.Euler(0, pierYaw, 0) * Vector3.right * (b.extents.x * 0.85f);
                        int links = Chain(mid, "east-high", hi + side, new Vector3(74, 22, -4), 6, 2.2f)
                                  + Chain(mid, "east-low", hi + side, new Vector3(70, 15, -34), 5, 2.2f)
                                  + Chain(mid, "pier-W", hi - side, At(PierAt + new Vector2(-7, -6), top - 0.2f), 1.5f, 1.6f)
                                  + Chain(mid, "pier-N", hi - side, At(PierAt + new Vector2(-6, 7), top - 0.2f), 1.5f, 1.6f);
                        rep.Line($"镇湖鼎：鼎座顶 {top:F1}，四链共 {links} 环");
                    }
                }

                // 4. 小件最后摆：前景岩堆、火盆、栏墩灯（只放焦点和路线节点附近）
                // 前景岩堆放在眺台下的岸台上（顶面低于眼高，只压住画面下缘，不挡地平线）
                foreach (var (at, yaw, hgt) in new[] { (new Vector2(3, -46), 200f, 4.5f), (new Vector2(16, -50), 120f, 6f),
                                                       (new Vector2(32, 30), 250f, 6f), (new Vector2(-34, 36), 160f, 7f) })
                    PutH(Boulders, small, G(at, -0.6f), yaw, hgt, rep);
                foreach (var at in new[] { new Vector2(StairX0 - 1.2f, StairZ1 + 1.2f), new Vector2(StairX1 + 1.2f, StairZ1 + 1.2f) })
                {
                    PutH(Brazier, small, G(at, 0), 180, 1.5f, rep);
                    PointLight(fx, "Brazier", G(at, 2.4f), LevelKit.InfernoPalette.FireLight, 9, 2.2f);
                }
                if (gate)
                {
                    var gb = WorldBounds(gate);
                    foreach (var sx in new[] { -0.33f, 0.33f })
                    {
                        var p = new Vector3(gb.center.x + gb.size.x * sx, TopAt(gate, new Vector2(gb.center.x + gb.size.x * sx, gb.center.z), gb.max.y), gb.center.z);
                        PointLight(fx, "Gate glow", p + Vector3.up * 1.5f + Vector3.back * 3, LevelKit.InfernoPalette.FireLight, 14, 2.5f);
                    }
                    PointLight(fx, "Gate door", new Vector3(gb.center.x, gb.min.y + 6, gb.min.z - 4), LevelKit.InfernoPalette.FireLight, 16, 1.6f);
                }
                // 栏墩灯：大台阶脚两盏 + 堤两头各一对（堤头落在码头 / 税关岩基上，按实际顶面摆）
                var cd = (CauseB - CauseA).normalized;
                var cp = new Vector2(cd.y, -cd.x) * 3.4f;
                foreach (var at in new[] { new Vector2(StairX0 - 2, StairZ0 - 1), new Vector2(StairX1 + 2, StairZ0 - 1),
                                           CauseA - cd * 1.5f + cp, CauseA - cd * 1.5f - cp, CauseB + cd * 1.5f + cp, CauseB + cd * 1.5f - cp })
                {
                    var p = Surface(at);
                    if (p.y < LavaY + 0.3f) { rep.Line($"栏墩灯 {at} 脚下是熔岩，跳过"); continue; }
                    PutH(Lantern, small, p, 180, 1.6f, rep);
                    PointLight(fx, "Lantern", p + Vector3.up * 1.3f, LevelKit.InfernoPalette.LampLight, 6, 1.4f);
                }
                if (statue) PointLight(fx, "Statue crown", WorldBounds(statue).max - new Vector3(WorldBounds(statue).extents.x, 4, WorldBounds(statue).extents.z), LevelKit.InfernoPalette.FireLight, 22, 2f);
                if (ferry)
                {
                    // 关楼：楼阁里透出的火光 + 门洞暖光（概念图里关楼是左侧最暖的一块）
                    var fb = WorldBounds(ferry);
                    var toEye = (G(Eye) - fb.center).normalized;
                    PointLight(fx, "Ferry pavilion", new Vector3(fb.center.x, fb.max.y - fb.size.y * 0.3f, fb.center.z), LevelKit.InfernoPalette.FireLight, 14, 3f);
                    PointLight(fx, "Ferry door", new Vector3(fb.center.x, fb.min.y + 4, fb.center.z) + toEye * (fb.extents.x + 3), LevelKit.InfernoPalette.FireLight, 16, 3f);
                    PointLight(fx, "Ferry face", new Vector3(fb.center.x, fb.center.y, fb.center.z) + toEye * (fb.extents.x + 6), LevelKit.InfernoPalette.FireLight, 20, 2.5f);
                }
                // 熔岩反光：熔岩自发光不照物体，在拱下、税关和鼎墩脚下贴着熔岩面放几盏低矮的橙色点光，拱洞和墙脚才有概念图那圈火光
                foreach (var at in new[] { Vector2.Lerp(CauseA, CauseB, 0.3f), Vector2.Lerp(CauseA, CauseB, 0.75f), IslandC + new Vector2(-4, -13), PierAt + new Vector2(-6, -6) })
                    PointLight(fx, "Lava bounce", At(at, 0.6f), LevelKit.InfernoPalette.FireLight, 12, 2.2f);

                // 套件总览（远处一排）
                Lineup(rep);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                EditorSceneManager.SaveScene(scene, ScenePath);

                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/zr31_report.txt");
                if (review) Review(statue, gate);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static void Review(GameObject statue, GameObject gate)
        {
            var eye = G(Eye, 1.7f);
            var gateC = gate ? WorldBounds(gate).center : At(GateAt, 18);
            var statueC = statue ? WorldBounds(statue).center : At(StatueAt, 48);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, eye, Quaternion.LookRotation(gateC - eye), out var cam, out var fpRig);
            float playerFov = cam.fieldOfView;
            try
            {
                // 1 号图用概念图的镜头；其余机位用游戏视角（玩家实际看到的）
                var conceptPos = eye + Vector3.up * ConceptLift;
                float yaw = ConceptYaw * Mathf.Deg2Rad, pitch = ConceptPitch * Mathf.Deg2Rad;
                var conceptFwd = new Vector3(Mathf.Sin(yaw) * Mathf.Cos(pitch), Mathf.Sin(pitch), Mathf.Cos(yaw) * Mathf.Cos(pitch));
                cam.fieldOfView = ConceptFov;
                LevelKit.Capture(cam, fpRig, "zr31", new[] { ("Concept", conceptPos, conceptPos + conceptFwd * 100, false) });
                cam.fieldOfView = playerFov;
                LevelKit.Capture(cam, fpRig, "zr31", new[]
                {
                    ("Spawn", eye, gateC, false),
                    ("Causeway", At(CauseA + (CauseB - CauseA) * 0.05f, 7.5f), At(IslandC, 7), false),
                    ("Ding", At(CauseA + (CauseB - CauseA) * 0.5f, 9), At(PierAt, 12), false),
                    ("GateApproach", G(new Vector2(10, 34), 4.2f), gateC, false),
                    ("Statue", At(new Vector2(-22, 36), 10), statueC, false),
                    ("Aerial", new Vector3(-150, 150, -170), At(CraterC, 0), false),
                    ("Map", At(CraterC + new Vector2(0, -1), 360), At(CraterC, 0), false),
                    ("KitLarge", new Vector3((KitSplit + LineupX) * 0.5f, 16, -(KitSplit - LineupX) * 0.52f), new Vector3((KitSplit + LineupX) * 0.5f, 11, 0), false),
                    ("KitSmall", new Vector3((KitSplit + KitEnd) * 0.5f, 7, -(KitEnd - KitSplit) * 0.52f), new Vector3((KitSplit + KitEnd) * 0.5f, 3.5f, 0), false),
                }, firstIndex: 2);
            }
            finally
            {
                cam.fieldOfView = playerFov;
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static Bounds WorldBounds(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return new Bounds(go.transform.position, Vector3.zero);
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b;
        }

        /// <summary>摆一件：底面中心 = basePos，按包围盒等比缩放到目标高度（米）。没有 Prefab 就放登记尺寸的白盒并记一条</summary>
        static GameObject PutH(string id, Transform parent, Vector3 basePos, float yaw, float targetH, LevelKit.Report rep)
        {
            if (!ShowcaseSceneBuilder.Prefab(id))
            {
                var size = Reg.TryGetValue(id, out var r) ? r * (targetH / r.y) : Vector3.one * targetH;
                var box = LevelKit.PlaceOrBox(id, parent, basePos, size, yaw, 1, LevelKit.Ch3Placeholder(Dir));
                rep.Warn($"缺少 Prefab {id}：放了白盒");
                return box;
            }
            var go = ShowcaseSceneBuilder.Place(id, parent, basePos, yaw, 1);
            float h = WorldBounds(go).size.y;
            if (h > 0.01f) go.transform.localScale *= targetH / h;
            go.transform.position = basePos;
            go.isStatic = true;
            return go;
        }

        /// <summary>从上往下打射线找可站立顶面（打不到就用给的回退高度）</summary>
        static float TopAt(GameObject go, Vector2 xz, float fallback)
        {
            Physics.SyncTransforms();
            var hits = Physics.RaycastAll(new Vector3(xz.x, 400, xz.y), Vector3.down, 500);
            float best = float.NegativeInfinity;
            foreach (var hit in hits)
                if (hit.collider.transform.IsChildOf(go.transform) && hit.point.y > best) best = hit.point.y;
            return float.IsNegativeInfinity(best) ? fallback : best;
        }

        /// <summary>某点（世界 XZ）往下打射线的最高可站立面：地形或已摆的件（不算触发器，熔岩判定体是触发器）</summary>
        static Vector3 Surface(Vector2 xz)
        {
            Physics.SyncTransforms();
            float best = float.NegativeInfinity;
            foreach (var hit in Physics.RaycastAll(new Vector3(xz.x, 400, xz.y), Vector3.down, 500, ~0, QueryTriggerInteraction.Ignore))
                if (hit.point.y > best) best = hit.point.y;
            return float.IsNegativeInfinity(best) ? G(xz) : new Vector3(xz.x, best, xz.y);
        }

        static void BuildSpires(Transform parent)
        {
            // 峡口两侧的（−76,20）（−88,56）（−30,96）让开主机位看峡口的视线（相对视轴 −11°），夹出概念图中间那道峡谷
            var spots = new (Vector2 at, float yaw, float h)[]
            {
                (new(-60, -24), 20, 46), (new(-76, 20), 140, 50), (new(-30, 96), 75, 52), (new(-18, 104), 300, 46), (new(46, 98), 210, 56),
                (new(72, 50), 330, 50), (new(72, -26), 260, 42), (new(-54, -66), 100, 38), (new(50, -66), 15, 36), (new(-88, 56), 190, 44),
            };
            foreach (var (at, yaw, h) in spots)
                PutH(Spire, parent, G(at, -3), yaw, h, new LevelKit.Report());
        }

        /// <summary>a → b 的石拱堤：n 段首尾相接（桥长沿局部 X，按段长等比缩放）</summary>
        static void Causeway(Transform parent, Vector2 a, Vector2 b, int n, LevelKit.Report rep)
        {
            var d = b - a;
            float seg = d.magnitude / n;
            float yaw = YawZ(d) - 90;
            float targetH = Reg[Bridge].y * seg / Reg[Bridge].x;
            for (int i = 0; i < n; i++)
            {
                var c = a + d * ((i + 0.5f) / n);
                PutH(Bridge, parent, At(c, -1.6f), yaw, targetH, rep);
            }
            rep.Line($"堤 {a} → {b}：{n} 段 × {seg:F1} m");
        }

        /// <summary>宫门两翼：每侧两段宫墙，墙端一座鼓楼（西矮东高，地标不对称）</summary>
        static void Walls(Transform parent, GameObject gate, LevelKit.Report rep)
        {
            float halfGate = gate ? WorldBounds(gate).extents.x : 11;
            float segH = 15f, segW = Reg[Wall].x * segH / Reg[Wall].y;
            float z = GateAt.y + 1.5f;
            foreach (var side in new[] { -1, 1 })
            {
                for (int i = 0; i < 2; i++)
                {
                    float x = GateAt.x + side * (halfGate + segW * (i + 0.5f) - 0.6f);
                    var w = PutH(Wall, parent, G(new Vector2(x, z), -0.4f), 180, segH, rep);
                    if (w && i == 0) segW = WorldBounds(w).size.x;
                }
                float tx = GateAt.x + side * (halfGate + segW * 2 + 2.5f);
                PutH(Drum, parent, G(new Vector2(tx, z), -0.4f), 180, side < 0 ? 24f : 31f, rep);
            }
        }

        /// <summary>北岸大台阶（程序几何：台阶要和角色控制器尺度一致，不交给 Tripo）：码头 +2 → 台地 +10，两侧挡墙</summary>
        static void GrandStairs(Transform parent)
        {
            var root = new GameObject("Grand Stairs (procedural)").transform;
            root.SetParent(parent, false);
            var mat = LevelKit.Ch3Basalt(Dir);
            var cap = LevelKit.Ch3BasaltDeep(Dir);
            int steps = 20;
            float rise = (TerraceY - QuayY) / steps, run = (StairZ1 - StairZ0) / steps;
            for (int i = 0; i < steps; i++)
            {
                float y1 = QuayY + rise * (i + 1), z0 = StairZ0 + run * i;
                Box(root, $"Step {i}", new Vector3(StairX0, QuayY - 1.5f, z0), new Vector3(StairX1, y1, StairZ1 + 1), mat);
            }
            foreach (var (x0, x1) in new[] { (StairX0 - 2.2f, StairX0), (StairX1, StairX1 + 2.2f) })
                for (int i = 0; i < 4; i++)
                {
                    float z0 = StairZ0 - 1 + i * (StairZ1 - StairZ0 + 1) / 4f, z1 = z0 + (StairZ1 - StairZ0 + 1) / 4f;
                    float top = QuayY + (TerraceY - QuayY) * (i + 1) / 4f + 1.1f;
                    Box(root, "Side wall", new Vector3(x0, QuayY - 1.5f, z0), new Vector3(x1, top, z1), cap);
                }
        }

        static GameObject Box(Transform root, string name, Vector3 min, Vector3 max, Material m)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.position = (min + max) * 0.5f;
            go.transform.localScale = max - min;
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            go.isStatic = true;
            return go;
        }

        static void PointLight(Transform parent, string name, Vector3 at, Color c, float range, float intensity)
        {
            var go = new GameObject($"Light · {name}");
            go.transform.SetParent(parent, false);
            go.transform.position = at;
            var l = go.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = c;
            l.range = range;
            l.intensity = intensity;
            l.shadows = LightShadows.None;
        }

        /// <summary>巨链（SM_Prop_InfernoChainLink）：a → b 一条下垂的链，纯装饰、拆掉碰撞。返回链环数（同 Level_3_1.Chain）</summary>
        static int Chain(Transform parent, string name, Vector3 a, Vector3 b, float sag, float scale)
        {
            if (!ShowcaseSceneBuilder.Prefab(ChainLinkId)) return 0;
            var root = new GameObject($"Chain · {name}").transform;
            root.SetParent(parent, false);
            root.gameObject.isStatic = true;
            Vector3 P(float u) => Vector3.Lerp(a, b, u) - Vector3.up * (sag * 4 * u * (1 - u));
            const int samples = 240;
            var pts = new Vector3[samples + 1];
            var cum = new float[samples + 1];
            for (int i = 0; i <= samples; i++)
            {
                pts[i] = P(i / (float)samples);
                if (i > 0) cum[i] = cum[i - 1] + Vector3.Distance(pts[i - 1], pts[i]);
            }
            float pitch = 0.68f * scale, half = 0.495f * scale;
            int n = 0, seg = 0;
            for (float sd = half; sd < cum[samples] - half * 0.5f; sd += pitch, n++)
            {
                while (seg + 1 < samples && cum[seg + 1] < sd) seg++;
                float l = cum[seg + 1] - cum[seg];
                var c = Vector3.Lerp(pts[seg], pts[seg + 1], l > 1e-5f ? (sd - cum[seg]) / l : 0);
                var tan = (pts[seg + 1] - pts[seg]).normalized;
                var side = Vector3.Cross(tan, Vector3.up);
                if (side.sqrMagnitude < 1e-4f) side = Vector3.right;
                var fwd = Vector3.Cross(side.normalized, tan);
                var rot = Quaternion.LookRotation(fwd, tan) * Quaternion.AngleAxis((n & 1) * 90f, Vector3.up);
                var link = ShowcaseSceneBuilder.Place(ChainLinkId, root, c - tan * half, 0, scale);
                if (!link) break;
                link.transform.rotation = rot;
                PrefabUtility.UnpackPrefabInstance(link, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                foreach (var col in link.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(col);
                foreach (var r in link.GetComponentsInChildren<Renderer>(true)) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                link.isStatic = true;
            }
            return n;
        }

        // ───────────── 套件总览 ─────────────

        const float LineupX = 300;
        static float KitSplit = 400, KitEnd = 500;

        /// <summary>远处一块平台上按 大 → 中 → 小 一字排开，原始比例（缩放 1），截 Kit 总览</summary>
        static void Lineup(LevelKit.Report rep)
        {
            var root = new GameObject("Kit Lineup").transform;
            Box(root, "Lineup floor", new Vector3(LineupX - 20, -1, -40), new Vector3(LineupX + 300, 0, 40), LevelKit.Ch3BasaltDeep(Dir));
            float x = LineupX;
            foreach (var id in new[] { Statue, Gate, Ferry, Fort, Pier, Spire, Ding, Drum, Wall, Bridge, Landing, Boulders, Lantern, Brazier })
            {
                if (!ShowcaseSceneBuilder.Prefab(id)) { rep.Warn($"总览缺 {id}"); continue; }
                var go = ShowcaseSceneBuilder.Place(id, root, new Vector3(x, 0, 0), 180, 1);
                var b = WorldBounds(go);
                go.transform.position += new Vector3(x - b.min.x, 0, 0);
                b = WorldBounds(go);
                rep.Line($"{id}：{b.size.x:F1} × {b.size.y:F1} × {b.size.z:F1} m");
                x = b.max.x + 3;
                if (id == Spire) KitSplit = x - 1.5f;
                KitEnd = x;
            }
        }
    }
}
