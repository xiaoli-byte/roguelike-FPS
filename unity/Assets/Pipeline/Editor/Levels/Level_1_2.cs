using Spiritfire.Art;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;
using SG = Spiritfire.Game;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-2 雅丹迷城（docs/level-design/maps/1-2.md；unity-maps-v1 §1-2；parity 3.10「12 m 走廊改成 2–3 条平行的干河道」）：
    /// 局部坐标 (u, v)：u 沿主风向（风从西北吹向东南，<see cref="W"/>），v 是它的左手；世界 XZ = u·W + v·S（<see cref="L(float, float)"/>）。
    ///
    ///   出生·沙垭口 (2, 0) → 扇面分出北 / 中 / 南三条干河道，河道间是顺风拉长的雅丹岛（狮身雅丹、NC2、CS1、CS2、CS3）
    ///   → ① 河口三叉 (96, −3)：三条河道经两道缺口互通，河心砾石洲 +1.3 m、低雅丹 M1 顶 +4 m（背风沙坡）
    ///   → ② 屋脊之海 (170, 34)：下沉 1.6 m 的沙盆，平顶屋链横穿（屋面 3.2 m、间距 3.8 m），两道积沙坡上屋顶，三块流沙坑
    ///   → ③ 塔尖广场 (212, −8)：半埋佛塔坐在两级环台上（+2.5 / +5 m），塔顶离广场 18.6 m——全图地标
    ///   → ④ 岩拱门 (260, 4)：岩壁收成漏斗，北侧 +3 m 岩台，天然岩拱下穿过 → 出口祭坛 (300, 1)，东缘矮岩脊外是低地，看得见古城。
    ///
    /// 边界（D14，没有空气墙）：游玩区是一个闭合多边形（+ 两个藏宝岩龛），界外 4.5 m 内陡升成 15–21 m 的连续岩壁，崖顶是雅丹台地——
    /// 比任何能站的面高 9 m 以上，二段跳也上不去，L5 防越界由地形本身保证；软边界沿同一个遮罩只做兜底。拱门外东缘是 6 m 的矮岩脊（看古城）。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、场地与站位、遭遇、藏宝、出口、自举标记；玩家、HUD、各系统在 Core 场景。
    /// 生成：Spiritfire ▸ Levels ▸ Build 1-2 雅丹迷城（或 bridge.sh level 1-2）。冒烟：bridge.sh playtest map-1-2（Map12Suite）。
    /// </summary>
    [LevelBuilder("1-2", ScenePath)]
    public static class Level_1_2
    {
        public const string Dir = "Assets/Levels/L1_2_Yardang";
        public const string ScenePath = "Assets/Scenes/L1_2_Yardang.unity";
        const string Name = "L1_2";

        // 高度场里 Base 米 = 世界 y 0；拱外低地 / 远景地面在 PlainY
        const float Base = 14f, HeightRange = 64f, PlainY = -6f;
        static readonly Vector2 Origin = new(-129, -338), Size = new(512, 512);
        /// <summary>雾（主题默认 40 / 260 m）：调远，出生点看 234 m 外的塔尖还剩轮廓</summary>
        const float FogStart = 60f, FogEnd = 360f;

        /// <summary>主风向（风吹去的方向，西北 → 东南）= 局部 +u；S = 局部 +v</summary>
        static readonly Vector2 W = new Vector2(0.82f, -0.57f).normalized;
        static readonly Vector2 S = new(-W.y, W.x);

        /// <summary>软边界（L3）：等值线在岩壁面上，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = LevelKit.BoundarySpec.Default;

        // ───────────── 坐标 ─────────────
        static Vector2 L(float u, float v) => W * u + S * v;
        static Vector2 L(Vector2 q) => W * q.x + S * q.y;
        static Vector2 ToLocal(Vector2 w) => new(Vector2.Dot(w, W), Vector2.Dot(w, S));
        /// <summary>局部方向 → 世界方向</summary>
        static Vector2 Dir2(Vector2 d) => W * d.x + S * d.y;
        /// <summary>让 Prefab 的 +Z 朝局部方向 d 的偏航角</summary>
        static float YawZ(Vector2 d)
        {
            var w = Dir2(d);
            return Mathf.Atan2(w.x, w.y) * Mathf.Rad2Deg;
        }
        /// <summary>让 Prefab 的 +X 朝局部方向 d 的偏航角</summary>
        static float YawX(Vector2 d)
        {
            var w = Dir2(d);
            return Mathf.Atan2(-w.y, w.x) * Mathf.Rad2Deg;
        }

        // ───────────── 场地（局部坐标）─────────────
        static readonly Vector2 Spawn = new(2, 0), Site1 = new(96, -3), Site2 = new(170, 34), Site3 = new(212, -8), Site4 = new(260, 4),
            Site5 = new(124, -50), Exit = new(300, 1), ArchC = new(280, 5), CacheA = new(104, 70), CacheB = new(126, -68);

        /// <summary>游玩区多边形（北沿自西向东，再南沿自东向西）：外面是连续岩壁</summary>
        static readonly Vector2[] Envelope =
        {
            new(-8, 14), new(8, 16), new(22, 30), new(36, 52), new(52, 60), new(80, 62), new(100, 60), new(124, 63), new(146, 74), new(170, 76),
            new(194, 74), new(210, 58), new(226, 44), new(240, 34), new(256, 26), new(266, 18), new(272, 13), new(288, 13), new(298, 18), new(310, 18),
            new(310, -8), new(298, -8), new(288, -3), new(272, -3), new(264, -12), new(254, -32), new(246, -48), new(232, -52), new(214, -50), new(196, -54),
            new(176, -58), new(150, -60), new(120, -60), new(90, -62), new(60, -60), new(40, -54), new(24, -32), new(10, -16), new(-8, -14),
        };
        /// <summary>藏宝岩龛（并进游玩区的圆盘）：北 = 商队遗物，南 = 供养窟</summary>
        static readonly (Vector2 c, float r)[] Alcoves = { (new Vector2(104, 67), 8), (new Vector2(126, -66), 8) };

        /// <summary>地面纵断面（u → 世界 y）：垭口 +3 → 河道 0 → 汇流 −0.6 → 广场 +1 → 拱门 +1.5</summary>
        static readonly Vector2[] TrendKeys =
        {
            new(-8, 3), new(6, 3), new(34, 0), new(140, -0.6f), new(186, -0.6f), new(206, 1f), new(262, 1f), new(300, 1.5f), new(330, 1.5f),
        };

        // ── 干河道（宽 22 m，刻下 0.4 m）──
        const float BraidHalf = 11f;
        static readonly PathSpline[] Braids =
        {
            new(new Vector2[] { new(16, 0), new(40, 0), new(70, -2), new(100, -3), new(130, -5), new(160, -7), new(190, -8) }),
            new(new Vector2[] { new(20, 8), new(32, 30), new(48, 42), new(70, 46), new(100, 46), new(130, 46), new(150, 46), new(162, 45) }),
            new(new Vector2[] { new(20, -8), new(32, -30), new(48, -42), new(72, -46), new(100, -47), new(130, -47), new(160, -44), new(186, -36), new(204, -24) }),
        };

        // ── 雅丹岛（地形）：长轴沿 u，迎风头在 −u ──
        static readonly LevelKit.YardangIsland[] Islands =
        {
            new(new Vector2(126, 21), 19, 8, 18, 3.4f, 12), // NC2：北、中河道之间
            new(new Vector2(60, -22), 20, 8, 16, 3.2f, 13), // CS1：中、南河道之间
            new(new Vector2(130, -25), 20, 8, 13, 3.0f, 14), // CS2
            new(new Vector2(170, -24), 13, 5.5f, 9, 2.6f, 15), // CS3：汇流前（塔尖视线从它上方越过）
            new(new Vector2(62, 19), 13, 4.2f, 1.2f, 2.5f, 16), // 狮身雅丹脚下的沙裙（Prefab 立在上面）
        };
        static readonly Vector2 SphinxC = new(62, 19);
        /// <summary>① 低雅丹 M1（4 m，顶是俯射层）与它背风端的沙坡</summary>
        static readonly Vector2 M1 = new(98, 6);
        /// <summary>① 河心砾石洲（+1.3 m，两头缓坡）</summary>
        static readonly Vector2 Bar = new(90, -10), BarHalf = new(10, 3);

        // ── ② 屋脊之海 ──
        const float BasinY = -1.6f;
        /// <summary>平顶屋面（Prefab ×1.8 屋面 3.6 m，底座埋进沙 0.4 m）</summary>
        const float RoofY = BasinY + 3.2f;
        static readonly Vector2 BasinC = new(172, 44), BasinR = new(32, 22);
        static readonly Vector2[] FlatRoofs = { new(152, 45.5f), new(162.2f, 48.5f), new(172.4f, 45.5f), new(182.6f, 48.5f), new(192.8f, 45.5f) };
        static readonly Vector2[] Halls = { new(152, 28), new(180, 62) };
        static readonly Vector2[] Houses = { new(186, 30), new(160, 62), new(198, 62) };
        static readonly Vector2[] Finials = { new(176, 20), new(150, 57), new(134, 52) };
        static readonly (Vector2 c, float r)[] Pits = { (new Vector2(160, 34), 4.5f), (new Vector2(196, 36), 4f), (new Vector2(188, 55), 3.5f) };

        // ── ③ 塔尖广场 ──
        /// <summary>广场、环台一层（比广场高 2.6 m：俯射层门槛 2.5 m 留一点余量）、环台二层（与佛塔第一层台面齐平）</summary>
        const float PlazaY = 1f, Tier1Y = 3.6f, Tier2Y = 6f, PlazaR = 24f;
        static readonly Vector2 StupaC = new(236, -24), Lobe1 = new(226, -13), Lobe2 = new(250.1f, -14.6f);
        const float Tier1R = 16.5f, Lobe1R = 8f, Lobe2R = 6f, Tier2R = 11.6f;
        const float StupaScale = 1.7f, StupaBaseY = 0.9f, StupaHeight = 11f;

        // ── ④ 岩拱门 ──
        static readonly Vector2 ShelfC = new(258, 17), ShelfHalf = new(6, 3.5f);
        const float ShelfH = 3f, ArchScale = 1.4f;

        // ── 拱外低地（看古城）──
        static readonly Vector2 PocketC = new(292, 5);
        /// <summary>古城寺塔剪影（局部坐标，地形之外，立在远景地面上）</summary>
        static readonly Vector2 CityPagoda = new(560, 60);
        static readonly float CityAzimuth = Mathf.Atan2(CityPagoda.y - PocketC.y, CityPagoda.x - PocketC.x) * Mathf.Rad2Deg;

        // ── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深）──
        const string StupaId = "SM_Tripo_DesertStupaBuried", SphinxId = "SM_Tripo_DesertYardangSphinx", ArchId = "SM_Tripo_DesertRockArch",
            RoofFlatId = "SM_Tripo_DesertBuriedRoofFlat", RoofHallId = "SM_Tripo_DesertBuriedRoofHall", RoofHouseId = "SM_Tripo_DesertBuriedRoofHouse",
            FinialId = "SM_Tripo_DesertFinial", ShrineId = "SM_Tripo_DesertPortalShrine", PagodaId = "SM_Tripo_DesertTemplePagoda",
            TowerId = "SM_Tripo_DesertCornerTower", FleetId = "SM_Tripo_DesertYardangFleet";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [StupaId] = new(9.45f, 11f, 8.88f), [SphinxId] = new(9.56f, 13f, 17.48f), [ArchId] = new(15.68f, 13f, 6.62f),
            [RoofFlatId] = new(3.56f, 3.6f, 3.86f), [RoofHallId] = new(6.48f, 5.5f, 3.7f), [RoofHouseId] = new(4.76f, 4.5f, 3.16f),
            [FinialId] = new(2.53f, 5.5f, 2.28f), [ShrineId] = new(9.68f, 11f, 3.3f),
            ["SM_Tripo_DesertColumnRuin"] = new(4.24f, 1.56f, 3.36f), ["SM_Tripo_DesertColumn"] = new(1.88f, 5f, 1.88f),
            ["SM_Prop_DesertReliquary"] = new(1.52f, 2.46f, 0.58f), ["SM_Prop_DesertUrns"] = new(0.82f, 0.84f, 0.79f),
            ["SM_Tripo_DesertCaravanWreck"] = new(3.8f, 1.82f, 4.04f), ["SM_Tripo_DesertGoodsPile"] = new(1.68f, 1.6f, 1.28f),
            ["SM_Env_DesertSandstone"] = new(3.38f, 2.88f, 2.55f),
        };

        // ── 第一章阵容 ──
        const string Jerboa = "jerboa_blade", Scorpion = "scorpion_archer", Toad = "mirage_toad", TombBeast = "tomb_beast", Apsara = "apsara", FireRat = "fire_rat",
            Wraith = "sand_wraith";

        /// <summary>
        /// 刷怪站位（标记名、属于哪个场地、局部坐标、角色、lane、高台、散开半径）。高台只给邪飞天（第一章其余敌人都贴地）；
        /// 贴地的远程站在 NavMesh 走得上去的高处（M1 顶、西北外凸台、北岩台）。全部离道具 ≥ 4 m、离岩壁 ≥ 5 m，放得下精英镇墓兽。
        /// </summary>
        static readonly (string name, int site, Vector2 at, SG.StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_1_FlankN_Gap", 1, new Vector2(92, 28), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_1_FlankS_Gap", 1, new Vector2(96, -28), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_1_Ranged_Far", 1, new Vector2(120, -2), SG.StationRole.Ranged, 0, false, 2.2f),
            ("Enemy_1_Ranged_Mesa", 1, new Vector2(97, 6), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_1_Bar", 1, new Vector2(92, -10), SG.StationRole.Auto, 0, false, 1.5f),
            ("Enemy_2_FlankW", 2, new Vector2(142, 36), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_2_FlankE", 2, new Vector2(200, 24), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_2_Ranged_North", 2, new Vector2(172, 55), SG.StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_2_Support_Drift", 2, new Vector2(144.5f, 45.5f), SG.StationRole.Support, 0, true, 1.2f),
            ("Enemy_2_Street", 2, new Vector2(184, 38), SG.StationRole.Auto, 0, false, 1.5f),
            ("Enemy_3_Assault_Far", 3, new Vector2(232, 3), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_3_FlankN", 3, new Vector2(206, 14), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_3_FlankS", 3, new Vector2(198, -32), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_3_Ranged_Lobe", 3, new Vector2(226, -11), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_3_Support_Lobe", 3, new Vector2(221, -16), SG.StationRole.Support, 0, true, 1.2f),
            ("Enemy_3_Artillery", 3, new Vector2(244, 4), SG.StationRole.Artillery, 0, false, 2.2f),
            ("Enemy_4_Gate", 4, new Vector2(268, 5), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_4_Ranged_Shelf", 4, new Vector2(258, 17), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_4_FlankN", 4, new Vector2(247, 24), SG.StationRole.Flank, 1, false, 1.8f),
            ("Enemy_4_FlankS", 4, new Vector2(262, -2), SG.StationRole.Flank, 2, false, 1.8f),
            ("Enemy_4_Artillery", 4, new Vector2(246, 11), SG.StationRole.Artillery, 0, false, 1.8f),
            ("Enemy_5_Flank", 5, new Vector2(110, -52), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_5_Ranged", 5, new Vector2(126, -40), SG.StationRole.Ranged, 0, false, 2.2f),
            ("Enemy_5_Auto", 5, new Vector2(140, -50), SG.StationRole.Auto, 2, false, 2.2f),
        };

        /// <summary>主线（局部坐标）：散布避让用</summary>
        static readonly Vector2[] RouteLine =
        {
            Spawn, new(40, 0), Site1, new(116, 6), new(137, 45.5f), new(152, 45.5f), Site2, new(196, 10), Site3, new(207, -17), new(218.5f, -15),
            new(253, 5), Site4, ArchC, Exit,
        };

        /// <summary>坡道（局部坐标，脚 → 顶，宽，两端的世界 y）：只填不挖，按 1-1 的沙坡剖面插值</summary>
        static readonly (string name, Vector2 foot, Vector2 top, float width, float footY, float topY, bool sand)[] Ramps = BuildRamps();

        static (string, Vector2, Vector2, float, float, float, bool)[] BuildRamps() => new[]
        {
            ("① 低丘背风沙坡", new Vector2(116, 6), new Vector2(104, 6), 5f, Ground0(new Vector2(116, 6)), Ground0(M1) + 4f, true),
            ("② 西侧积沙坡", new Vector2(137, 45.5f), new Vector2(148.6f, 45.5f), 6f, Ground0(new Vector2(137, 45.5f)), RoofY + 0.5f, true),
            ("② 东侧积沙坡", new Vector2(207, 45.5f), new Vector2(196.2f, 45.5f), 6f, Ground0(new Vector2(207, 45.5f)), RoofY + 0.5f, true),
            ("③ 环台坡道 P1", new Vector2(207, -17), new Vector2(218.5f, -15), 6f, PlazaY, Tier1Y, false),
            ("③ 环台坡道 P2", new Vector2(252.2f, -13.2f), new Vector2(245.2f, -17.9f), 4.5f, Tier1Y, Tier2Y, false),
            ("③ 环台坡道 P3", new Vector2(253, 5), new Vector2(251, -9.5f), 6f, Ground0(new Vector2(253, 5)), Tier1Y, false),
            ("④ 岩台坡道", new Vector2(243, 17), new Vector2(252.5f, 17), 5f, Ground0(new Vector2(243, 17)), Ground0(ShelfC) + ShelfH, false),
        };

        /// <summary>雅丹台地上的远处雅丹脊（局部坐标，风向 +u）：崖顶天际线</summary>
        static readonly YardangSpec OuterField = new()
        {
            wind = Vector2.right, spacing = 34, length = 90, width = 22, height = 14, edge = 4, density = 0.85f, meander = 8, seed = 21,
        };

        // ───────────── 地貌（局部坐标 → 世界 y）─────────────

        static float Trend(float u)
        {
            if (u <= TrendKeys[0].x) return TrendKeys[0].y;
            for (int i = 0; i + 1 < TrendKeys.Length; i++)
            {
                var a = TrendKeys[i];
                var b = TrendKeys[i + 1];
                if (u <= b.x) return Mathf.Lerp(a.y, b.y, Smooth(0, 1, (u - a.x) / (b.x - a.x)));
            }
            return TrendKeys[^1].y;
        }

        /// <summary>干河道下切（米，≥ 0）与河床遮罩（0–1）：扇面（u &lt; 26）不切</summary>
        static float RiverCut(Vector2 q, out float riverbed)
        {
            float cut = 0;
            riverbed = 0;
            foreach (var b in Braids)
            {
                var (d, _) = b.Nearest(q, BraidHalf + 8);
                if (d > BraidHalf + 8) continue;
                riverbed = Mathf.Max(riverbed, 1 - Smooth(BraidHalf - 2, BraidHalf + 3, d));
                cut = Mathf.Max(cut, 1 - Smooth(0, BraidHalf + 4, d));
            }
            return 0.4f * cut * Smooth(26, 40, q.x);
        }

        /// <summary>不含噪声、不含地貌件的地面（坡道两端的绝对高度、Prefab 底座从这里取，避免递归）</summary>
        static float Ground0(Vector2 q) => Trend(q.x) - RiverCut(q, out _);

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：多边形 + 岩龛，边界线带噪声摆动（④ 漏斗、拱门、拱外看古城的方向不摆）</summary>
        static float Inside(Vector2 q)
        {
            float ins = LevelKit.PolygonSigned(q, Envelope);
            float calm = Mathf.Max(Disc(q, new Vector2(272, 5), 26, 12), Disc(q, new Vector2(306, 8), 14, 8));
            ins += (Fbm(q, 18, 3, 41) * 2.2f + Fbm(q, 5, 2, 43) * 0.7f) * (1 - calm);
            foreach (var (c, r) in Alcoves) ins = Mathf.Max(ins, r - Vector2.Distance(q, c));
            return ins;
        }

        /// <summary>可玩区遮罩（世界 XZ，软边界与 L5 共用）：等值线 0.2 落在岩壁面上（界外约 1.7 m）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(ToLocal(world)));

        /// <summary>拱门外看古城的低处扇区（0–1）：出口平台东缘的岩脊只有 6 m，脊外落到低地</summary>
        static float EastWedge(Vector2 q)
        {
            var d = q - PocketC;
            float r = d.magnitude;
            if (r < 4) return 0;
            float a = Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg;
            return Smooth(40, 25, Mathf.Abs(Mathf.DeltaAngle(a, CityAzimuth))) * Smooth(4, 10, r);
        }

        static float Ellipse(Vector2 q, Vector2 c, Vector2 r)
        {
            var d = q - c;
            return Mathf.Sqrt(d.x * d.x / (r.x * r.x) + d.y * d.y / (r.y * r.y));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            var q = ToLocal(p);

            // ── 地面：纵断面 + 低频起伏 − 河道下切 ──
            float cut = RiverCut(q, out float riverbed);
            float h = Trend(q.x) + Fbm(q, 45, 3, 1) * 0.3f + Fbm(q, 11, 2, 2) * 0.08f - cut;

            // ── ① 河心砾石洲（+1.3 m，沿 u 拉长，两头缓坡入水）──
            float bar = 1 - Smooth(0.55f, 1f, Ellipse(q, Bar, BarHalf));
            h += 1.3f * bar;

            // ── 雅丹岛 ──
            float islandBody = 0, islandTop = 0;
            foreach (var isl in Islands)
            {
                h += LevelKit.YardangIslandHeight(q, isl, out float b, out float t);
                if (isl.height > 2)
                {
                    islandBody = Mathf.Max(islandBody, b);
                    islandTop = Mathf.Max(islandTop, t);
                }
            }

            // ── ① 低雅丹 M1（4 m）──
            float mesa = Mesa(q, M1, 9, 4.5f, 0, 4, 1.5f, 7);
            h += mesa;
            float mesaBody = Smooth(0.3f, 1.0f, mesa), mesaTop = Smooth(3.4f, 3.85f, mesa);

            // ── ② 屋脊之海：下沉沙盆 + 流沙坑 ──
            float basin = 1 - Smooth(0.72f, 1f, Ellipse(q, BasinC, BasinR));
            if (basin > 0) h = Mathf.Lerp(h, BasinY + Fbm(q, 20, 2, 5) * 0.12f, basin);
            float pit = 0;
            foreach (var (c, r) in Pits)
            {
                float k = 1 - Smooth(0, r, Vector2.Distance(q, c));
                pit = Mathf.Max(pit, k);
                h -= 0.5f * k * k;
            }

            // ── ③ 夯土广场 + 两级环台 ──
            float court = 1 - Smooth(PlazaR - 4, PlazaR + 6, Vector2.Distance(q, Site3));
            if (court > 0) h = Mathf.Lerp(h, PlazaY + Fbm(q, 9, 2, 6) * 0.04f, court);
            float dStupa = Vector2.Distance(q, StupaC);
            float od1 = Mathf.Min(dStupa - Tier1R, Mathf.Min(Vector2.Distance(q, Lobe1) - Lobe1R, Vector2.Distance(q, Lobe2) - Lobe2R));
            float tier1 = 1 - Smooth(-0.2f, 1.2f, od1), tier2 = 1 - Smooth(-0.2f, 1.0f, dStupa - Tier2R);
            if (tier1 > 0) h = Mathf.Max(h, Mathf.Lerp(h, Tier1Y, tier1));
            if (tier2 > 0) h = Mathf.Max(h, Mathf.Lerp(h, Tier2Y, tier2));

            // ── ④ 北岩台（+3 m）──
            float pv = Plateau(q, ShelfC, ShelfHalf, 0, ShelfH, 1.0f, Array.Empty<(Vector2, Vector2, float)>());
            if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(h, Ground0(ShelfC) + pv, Smooth(0, 0.8f, pv)));
            float shelfTop = Smooth(ShelfH - 0.4f, ShelfH - 0.05f, pv);

            // ── 坡道（只填）──
            float rampSand = 0, rampAny = 0;
            foreach (var r in Ramps)
            {
                var (t, m) = Ramp(q, r.foot, r.top, r.width, 2.5f);
                if (m <= 0) continue;
                float target = Mathf.Lerp(r.footY, r.topY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                rampAny = Mathf.Max(rampAny, m);
                if (r.sand) rampSand = Mathf.Max(rampSand, m);
            }

            // ── 沙纹：垭口扇面、沙盆、岩龛（坡道、流沙坑、广场上没有）──
            float ins = Inside(q);
            float alcove = 0;
            foreach (var (c, r) in Alcoves) alcove = Mathf.Max(alcove, 1 - Smooth(r - 3, r + 2, Vector2.Distance(q, c)));
            float fan = (1 - Smooth(30, 44, q.x)) * Smooth(0, 4, ins);
            float rippleZone = Mathf.Max(Mathf.Max(fan, basin), alcove) * (1 - rampAny) * (1 - pit) * (1 - court);
            if (rippleZone > 0) h += Dunes(q, Vector2.right, 12, 0.45f, 9) * rippleZone;

            // ── 外缘岩壁 + 雅丹台地 + 拱外低地 ──
            float wedge = 0, crestBody = 0, crestTop = 0;
            if (ins < 3f)
            {
                wedge = EastWedge(q);
                float high = 15f + 6f * (Fbm(q, 60, 2, 31) * 0.5f + 0.5f);
                float rimH = Mathf.Lerp(high, 6f, wedge);
                h = Mathf.Max(h, Trend(q.x) + LevelKit.RimProfile(ins, 0.9f, 3f, rimH, 4.5f));
                if (ins < -6f)
                {
                    float crest = Yardangs(q, OuterField, out crestBody, out crestTop) * Smooth(-6, -16, ins) * (1 - wedge);
                    h += crest;
                }
                if (wedge > 0) h = Mathf.Lerp(h, PlainY + Fbm(q, 80, 2, 51) * 1.5f, wedge * Smooth(-5.5f, -20f, ins));
            }

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Desert：岩 → 夯土 → 沙 → 剩下是砾石）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            float tierTop = Mathf.Max(Smooth(0.9f, 0.99f, tier1), Smooth(0.9f, 0.99f, tier2)) * (1 - rampSand);
            float pocket = Smooth(262, 272, q.x) * inside;
            s.packed = Mathf.Max(Mathf.Max(riverbed * 0.8f * (1 - basin) * (1 - bar), court * 0.9f), Mathf.Max(tierTop * 0.85f, Mathf.Max(islandTop * 0.75f, mesaTop * 0.75f)));
            s.packed = Mathf.Max(s.packed, Mathf.Max(shelfTop * 0.8f, Mathf.Max(pocket * 0.5f, (rampAny - rampSand) * 0.7f)));
            float patches = Smooth(0.2f, 0.5f, Fbm(q, 28, 3, 7)) * 0.6f * (1 - riverbed) * (1 - court);
            s.sand = Mathf.Max(Mathf.Max(basin * 0.95f, rampSand * 0.95f), Mathf.Max(Mathf.Max(fan, alcove) * 0.85f, patches));
            s.sand = Mathf.Max(s.sand, Smooth(3, 0, ins) * inside * 0.55f);
            // 台地上雅丹脊之间的沙（崖面本身是岩）
            s.sand = Mathf.Max(s.sand, (1 - inside) * Smooth(-8, -14, ins) * 0.45f * (1 - crestBody) * (1 - wedge));
            s.sand = Mathf.Max(s.sand, wedge * Smooth(-6, -20, ins) * 0.8f);
            s.sand *= 1 - Mathf.Max(court, tierTop);
            float cliffBand = Smooth(0.5f, -1.5f, ins) * (1 - Smooth(-7, -10, ins));
            s.rock = Mathf.Max(Mathf.Max(islandBody * (1 - islandTop), mesaBody * (1 - mesaTop)), Mathf.Max(cliffBand, crestBody * (1 - crestTop)));
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-2 雅丹迷城", priority = 61)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>构建期的地形（摆件、标记贴地用）</summary>
        static LevelKit.TerrainSet ts;

        static Vector3 OnGround(Vector2 q, float dy = 0)
        {
            var w = L(q);
            return ts.OnGround(w.x, w.y, dy);
        }

        static Vector3 At(Vector2 q, float y)
        {
            var w = L(q);
            return new Vector3(w.x, y, w.y);
        }

        /// <summary>生成场景 → 烘焙 NavMesh → 验收规则集 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var kit = new GameObject("Kit").transform;
            var props = new GameObject("Props").transform;
            var world = new GameObject("World").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            RenderSettings.fogStartDistance = FogStart;
            RenderSettings.fogEndDistance = FogEnd;
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Desert, eval = Eval,
            }, env);
            try
            {
                // 远景：雅丹台地外是戈壁台地环，朝古城方向压低一道缺口；拱外低地接远景地面
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, L(150, 5), PlainY, 760, 3);
                var cityDir = Dir2(CityPagoda - PocketC);
                backdrop.gapAngle = Mathf.Atan2(cityDir.y, cityDir.x) * Mathf.Rad2Deg;
                backdrop.gapWidth = 30;
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);
                var cityTop = BuildFarLandmarks(env, backdrop);

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：西北盛行风，1-2 的动态环境是流沙，不放沙暴区（unity-maps-v1：每张图最多一个）
                LevelKit.Weather(env, theme, W, 0.3f);

                BuildRiverbeds(kit, props);
                BuildRoofSea(kit, world);
                var spireTop = BuildPlaza(kit, props);
                var (shrine, archLintel) = BuildArch(kit);
                BuildScatter(props, theme);
                BuildMarkers(markers);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝塔尖）+ 自举标记
                var spawnAt = OnGround(Spawn, 0.05f);
                var look = Dir2(StupaC - Spawn).normalized;
                var spawnRot = Quaternion.LookRotation(new Vector3(look.x, 0, look.y));
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<SG.PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<SG.LevelBootstrap>();
                var objective = BuildEncounters(markers);
                BuildExit(shrine, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                // 构建设置只补进本场景（顺序由 levels 命令按 RunPlan 重排，parity 4.12）
                if (!EditorBuildSettings.scenes.Any(s => s.path == ScenePath))
                    EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

                var rep = new LevelKit.Report();
                rep.Line("1-2 雅丹迷城 · 验收");
                rep.Line($"高度：垭口 {ts.GroundY(L(Spawn).x, L(Spawn).y):F1}，① 河口 {OnGround(Site1).y:F1}，M1 顶 {OnGround(M1).y:F1}，沙盆 {OnGround(Site2).y:F1}（屋面 {RoofY:F1}），" +
                         $"广场 {OnGround(Site3).y:F1}，环台 {OnGround(Lobe1).y:F1} / {OnGround(StupaC + new Vector2(0, -10f)).y:F1}，岩台 {OnGround(ShelfC).y:F1}，拱下 {OnGround(ArchC).y:F1}");
                LevelValidator.Run(Spec(spireTop, archLintel, cityTop), rep);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_1-2_report.txt");

                if (review) Review(spawnAt, spawnRot, spireTop, archLintel, cityTop);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 spireTop, Vector3 archLintel, Vector3 cityTop)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => OnGround(q, dy);
            var center = L(150, 5);
            // 审核截图用临时机位（与玩家同一套相机 + 第一人称 rig），截完删掉
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_1-2", new[]
                {
                    ("Aerial", At(new Vector2(-40, -150), 150), At(new Vector2(160, 0), 0), false),
                    ("Map", new Vector3(center.x, 430, center.y - 1), new Vector3(center.x, 0, center.y), false),
                    ("Spawn", E(Spawn), spireTop, true),
                    ("RiverFork", E(new Vector2(70, -2)), OnGround(new Vector2(120, 0), 2), false),
                    ("MesaTop", E(M1 + new Vector2(2, 0)), spireTop, false),
                    ("RoofSea", E(new Vector2(140, 45.5f)), OnGround(new Vector2(185, 45), 2), false),
                    ("RoofTop", At(FlatRoofs[2], RoofY + 1.62f), spireTop, false),
                    ("Plaza", E(new Vector2(196, 4)), spireTop - Vector3.up * 6, false),
                    ("Terrace", E(StupaC + new Vector2(8.5f, 5.5f)), archLintel, false),
                    ("ArchCourt", E(new Vector2(244, 6)), archLintel, false),
                    ("UnderArch", E(ArchC), cityTop, false),
                    ("CacheA", E(new Vector2(104, 50)), OnGround(CacheA, 1), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");

        /// <summary>
        /// 摆一件 ART3 资产：底面中心 = 局部坐标 q、世界 y = baseY；有 Prefab 就按 scale（可非均匀）摆，
        /// 没有就放设计尺寸 × scale 的白盒（LevelKit.PlaceOrBox，Placeholder 标签，验收会列出来）
        /// </summary>
        static GameObject Kit(string id, Transform parent, Vector2 q, float baseY, float yaw, Vector3 scale)
        {
            var size = DesignSize.TryGetValue(id, out var d) ? Vector3.Scale(d, scale) : scale * 2;
            var go = LevelKit.PlaceOrBox(id, parent, At(q, baseY), size, yaw);
            if (!go) return null;
            if (!IsPlaceholder(go)) go.transform.localScale = scale;
            go.isStatic = true;
            return go;
        }

        static GameObject Kit(string id, Transform parent, Vector2 q, float baseY, float yaw, float scale = 1) =>
            Kit(id, parent, q, baseY, yaw, Vector3.one * scale);

        static void BuildRiverbeds(Transform kit, Transform props)
        {
            // 狮身雅丹：北、中河道分叉处的岛，头（+Z）朝出生点；沿长轴拉到 28 m、高 15 m，脚下是地形沙裙
            Kit(SphinxId, kit, SphinxC, Ground0(SphinxC) - 0.3f, YawZ(Vector2.left), new Vector3(1f, 1.15f, 1.6f));
            // 迷路商队：中河道里的残车与货堆（① 的掩体）
            Kit("SM_Tripo_DesertCaravanWreck", props, new Vector2(80, 3), OnGround(new Vector2(80, 3)).y - 0.2f, YawZ(new Vector2(1, 0.4f)), 1.3f);
            Kit("SM_Tripo_DesertGoodsPile", props, new Vector2(82, 7.5f), OnGround(new Vector2(82, 7.5f)).y - 0.1f, 40, 1.2f);
            // 岛脚的落石（全遮掩体）
            var rocks = new[] { (new Vector2(72, -12), 20f), (new Vector2(112, -12), 75f), (new Vector2(86, 24), 140f), (new Vector2(106, -20), 210f) };
            foreach (var (q, yaw) in rocks) Kit("SM_Env_DesertSandstone", props, q, OnGround(q).y - 0.3f, yaw, 0.85f);
        }

        static void BuildRoofSea(Transform kit, Transform world)
        {
            // 平顶屋链：+X 沿 u，隔一座掉头（屋顶小间左右交替）；屋面 = 沙盆 + 3.2 m
            for (int i = 0; i < FlatRoofs.Length; i++)
            {
                var go = Kit(RoofFlatId, kit, FlatRoofs[i], RoofY - 3.6f, YawX(Vector2.right) + (i % 2 == 0 ? 0 : 180), 1.8f);
                if (go && !IsPlaceholder(go)) go.name = $"{RoofFlatId} (Roof {i + 1})";
            }
            // 歇山顶 / 两坡顶：只露檐口以上（掩体），塔刹半埋 1.2 m
            foreach (var q in Halls) Kit(RoofHallId, kit, q, BasinY - 3.6f, YawX(Vector2.right), 1.5f);
            for (int i = 0; i < Houses.Length; i++) Kit(RoofHouseId, kit, Houses[i], BasinY - 2.6f, YawX(Vector2.right) + (i == 1 ? 180 : 0), 1.4f);
            foreach (var q in Finials) Kit(FinialId, kit, q, OnGround(q).y - 1.2f, 25);
            // 流沙（L8）：地表下陷由地形给，组件运行时自己铺流沙面
            foreach (var (c, r) in Pits)
            {
                var pit = LevelKit.QuicksandPit(world, OnGround(c), r);
                pit.name = $"Quicksand ({c.x:F0}, {c.y:F0})";
            }
        }

        /// <summary>③ 佛塔与广场掩体；返回塔尖（地标视线的目标）</summary>
        static Vector3 BuildPlaza(Transform kit, Transform props)
        {
            // 半埋佛塔 ×1.7：底座埋进两级环台，第一层台面（+5 m）与二层环台齐平；正面（台阶）朝广场
            Kit(StupaId, kit, StupaC, StupaBaseY, YawZ(Site3 - StupaC), StupaScale);
            Kit("SM_Tripo_DesertColumnRuin", props, new Vector2(204, 4), PlazaY - 0.15f, 20);
            Kit("SM_Tripo_DesertColumnRuin", props, new Vector2(222, 6), PlazaY - 0.15f, 140);
            Kit("SM_Tripo_DesertColumnRuin", props, new Vector2(198, -22), PlazaY - 0.15f, 70);
            var fallen = Kit("SM_Tripo_DesertColumn", props, new Vector2(214, -26), PlazaY, 0);
            if (fallen && !IsPlaceholder(fallen))
            {
                fallen.transform.rotation = Quaternion.Euler(0, YawX(new Vector2(1, 0.3f)), 88);
                fallen.transform.position += Vector3.up * 0.6f;
            }
            Kit("SM_Prop_DesertReliquary", props, new Vector2(206, -26), PlazaY - 0.05f, YawZ(Site3 - new Vector2(206, -26)));
            Kit("SM_Prop_DesertUrns", props, new Vector2(196, 10), OnGround(new Vector2(196, 10)).y - 0.05f, 30);
            return At(StupaC, StupaBaseY + StupaHeight * StupaScale - 0.8f);
        }

        /// <summary>④ 岩拱（碰撞换成两柱 + 拱楣三个盒子，洞口一定穿得过）与出口祭坛；返回祭坛和拱楣中点</summary>
        static (GameObject shrine, Vector3 lintel) BuildArch(Transform kit)
        {
            float archBase = OnGround(ArchC).y - 0.3f;
            float yaw = YawZ(Vector2.right); // 洞口前后沿 u 通透
            if (ShowcaseSceneBuilder.Prefab(ArchId))
            {
                var arch = ShowcaseSceneBuilder.Place(ArchId, kit, At(ArchC, archBase), yaw, ArchScale);
                PrefabUtility.UnpackPrefabInstance(arch, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                foreach (var c in arch.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
                var col = new GameObject($"{ArchId} Collision") { layer = arch.layer };
                col.transform.SetParent(arch.transform, false);
                col.isStatic = true;
                arch.isStatic = true;
                // 局部（未缩放）：宽 ±7.84、深 ±3.31、高 13；洞口 ±3.1、高 7.6（Tripo 概念：洞口 6 m 宽、7.5 m 高）
                void Box(Vector3 center, Vector3 size)
                {
                    var b = col.AddComponent<BoxCollider>();
                    b.center = center;
                    b.size = size;
                }
                Box(new Vector3(-5.47f, 6.5f, 0), new Vector3(4.74f, 13f, 6.62f));
                Box(new Vector3(5.47f, 6.5f, 0), new Vector3(4.74f, 13f, 6.62f));
                Box(new Vector3(0, 10.3f, 0), new Vector3(6.2f, 5.4f, 6.62f));
            }
            else
            {
                // 没有 Prefab：三块白盒（两柱 + 拱楣），同样穿得过
                LevelKit.EnsureTag(LevelKit.PlaceholderTag);
                var m = LevelKit.Mat(LevelKit.PlaceholderDir, "Placeholder", new Color(0.93f, 0.93f, 0.9f));
                var right = new Vector3(Dir2(Vector2.up).x, 0, Dir2(Vector2.up).y); // 拱的宽度方向 = 局部 v
                var b0 = At(ArchC, archBase);
                foreach (int side in new[] { -1, 1 })
                    LevelKit.Box($"Placeholder · {ArchId} Pillar", kit, b0 + right * (side * 5.47f * ArchScale), new Vector3(4.74f, 13f, 6.62f) * ArchScale, yaw, m, 0.1f)
                        .tag = LevelKit.PlaceholderTag;
                var lintel = LevelKit.Box($"Placeholder · {ArchId} Lintel", kit, b0 + Vector3.up * (7.6f * ArchScale), new Vector3(6.2f, 5.4f, 6.62f) * ArchScale, yaw, m, 0);
                lintel.tag = LevelKit.PlaceholderTag;
                Debug.LogWarning($"[Level] 缺少 Prefab {ArchId}，岩拱放了三块占位白盒");
            }
            var shrine = Kit(ShrineId, kit, Exit, OnGround(Exit).y - 0.15f, YawZ(Vector2.left));
            return (shrine, At(ArchC, archBase + 10.3f * ArchScale));
        }

        /// <summary>远景地标：台地上的舰形雅丹、拱外低地上古城的寺塔与角楼剪影；返回寺塔塔尖</summary>
        static Vector3 BuildFarLandmarks(Transform env, LevelKit.BackdropSpec backdrop)
        {
            foreach (var (q, scale) in new[] { (new Vector2(60, 98), 2.0f), (new Vector2(200, -92), 2.2f) })
            {
                var w = L(q);
                var fleet = ShowcaseSceneBuilder.Place(FleetId, env, new Vector3(w.x, ts.GroundY(w.x, w.y) - 1.5f, w.y), YawZ(Vector2.right), scale);
                if (fleet) fleet.isStatic = true;
            }
            const float pagodaScale = 2.7f;
            LevelKit.BackdropImpostor(backdrop, PagodaId, env, At(CityPagoda, PlainY), YawZ(PocketC - CityPagoda), pagodaScale, 0.5f);
            LevelKit.BackdropImpostor(backdrop, TowerId, env, At(new Vector2(528, 26), PlainY), YawZ(PocketC - new Vector2(528, 26)), 3f, 0.5f);
            LevelKit.BackdropImpostor(backdrop, TowerId, env, At(new Vector2(545, 98), PlainY), YawZ(PocketC - new Vector2(545, 98)), 3f, 0.55f);
            // 视线目标取塔顶下 3 m：拱下眼高看过去，越过 6 m 矮岩脊还留 2 m
            return At(CityPagoda, PlainY + 22.16f * pagodaScale - 3f);
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：砾石、骆驼刺、红柳避开主线、广场、环台、流沙坑；巨砾（带碰撞）只在游玩区里、场地中心 / 站位 / 坡道 / 藏宝以外
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            float RouteDist(Vector2 world) => Polyline(ToLocal(world), RouteLine).dist;
            float Keep(Vector2 world)
            {
                var q = ToLocal(world);
                float k = 1 - Smooth(PlazaR - 2, PlazaR + 4, Vector2.Distance(q, Site3));
                k = Mathf.Max(k, 1 - Smooth(Tier1R, Tier1R + 3, Vector2.Distance(q, StupaC)));
                foreach (var (c, r) in Pits) k = Mathf.Max(k, 1 - Smooth(r, r + 2, Vector2.Distance(q, c)));
                return 1 - k;
            }
            var details = LevelKit.ScatterPresets.Details(theme.key);
            foreach (var r in details)
            {
                var w = r.where;
                r.where = pt => (w?.Invoke(pt) ?? 1) * Keep(pt.p);
            }
            LevelKit.ScatterDetails(ts, details, RouteDist, 1f, 160f);

            var boulders = LevelKit.ScatterPresets.Boulders(theme.key);
            var bw = boulders.where;
            var avoid = new List<(Vector2 c, float r)>
            {
                (Spawn, 14), (Site1, 7), (Site2, 7), (Site3, PlazaR + 4), (Site4, 8), (Site5, 6), (StupaC, Tier1R + 6), (BasinC, 34), (ArchC, 20), (Exit, 16),
                (CacheA, 8), (CacheB, 8), (M1, 14), (Bar, 12),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            boulders.where = pt =>
            {
                var q = ToLocal(pt.p);
                if (Inside(q) < 5) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(q, c) < r) return 0;
                foreach (var rp in Ramps)
                    if (Polyline(q, new[] { rp.foot, rp.top }).dist < rp.width * 0.5f + 4) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            // 游玩区的世界包围盒
            float x0 = float.MaxValue, z0 = float.MaxValue, x1 = float.MinValue, z1 = float.MinValue;
            foreach (var e in Envelope)
            {
                var w = L(e);
                x0 = Mathf.Min(x0, w.x); x1 = Mathf.Max(x1, w.x);
                z0 = Mathf.Min(z0, w.y); z1 = Mathf.Max(z1, w.y);
            }
            LevelKit.ScatterProps(ts, props, boulders, Rect.MinMaxRect(x0, z0, x1, z1), 10f, RouteDist);
        }

        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector2 q)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = OnGround(q);
            }
            Mk("Site_Spawn", Spawn);
            Mk("Site_1_RiverFork", Site1);
            Mk("Site_2_RoofSea", Site2);
            Mk("Site_3_SpirePlaza", Site3);
            Mk("Site_4_RockArch", Site4);
            Mk("Site_5_CacheGuard", Site5);
            Mk("Site_Exit", Exit);
            foreach (var a in Anchors) Mk(a.name, a.at);
            // 地标标记（冒烟测试看塔尖是否可见）：塔尖世界位置
            var spire = new GameObject("Landmark_StupaSpire");
            spire.transform.SetParent(root, false);
            spire.transform.position = At(StupaC, StupaBaseY + StupaHeight * StupaScale - 0.8f);
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/1-2.md §5，遭遇框架 v2）：四个必清场地任意顺序，⑤ 是藏宝 B 的守军（可选、不自动触发）。
        /// 难度由 RunPlan 给（1-2 = 1.16），场地不写死。站位标记挂 SpawnAnchor（<see cref="Anchors"/>）。
        /// 沙魇（EN1）：② 屋脊之海首波的两只跳鼠换成沙魇（只数不变）——沙盆是流沙地，沙魇潜沙逼近；屋面比沙盆高 3.2 m，
        /// 超过它潜沙突袭的 2.5 m 高差，上屋顶就是解法（同一句提示管流沙和沙魇）。1-1 ② 先见过一只，这里第一次成对。
        /// </summary>
        static SG.LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            SG.EncounterSite Site(int index, string title, Vector2 at, float trigger, float arena, SG.EncounterSpec spec, string reward)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<SG.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = OnGround(at);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.requires = Array.Empty<SG.EncounterSite>();
                var list = new List<Transform>();
                foreach (var a in Anchors)
                {
                    if (a.site != index) continue;
                    var m = markers.Find(a.name);
                    var sa = m.GetComponent<SG.SpawnAnchor>();
                    if (!sa) sa = m.gameObject.AddComponent<SG.SpawnAnchor>();
                    (sa.role, sa.lane, sa.elevated, sa.spread) = (a.role, a.lane, a.elevated, a.spread);
                    list.Add(m);
                }
                site.anchors = list.ToArray();
                return site;
            }
            SG.WaveEntry E(string id, int n) => SG.EncounterSpec.E(id, n);
            SG.WaveSpec Wave(string label, params SG.WaveEntry[] entries) => SG.EncounterSpec.Wave(label, entries);

            var s1 = Site(1, "河口三叉", Site1, 22, 30, SG.EncounterSpec.Of(
                    Wave("河口伏击", E(Jerboa, 3), E(Scorpion, 2)).Hint("跳鼠从两侧河道的缺口包抄——背靠岩丘、守住缺口"),
                    Wave("侧河道包抄", E(Jerboa, 3), E(FireRat, 2)).After(1, 1.6f).Hint("火浣鼠滚过来会炸——上河心洲拉开距离"))
                .Gather(0.4f), "weapon");
            var s2 = Site(2, "屋脊之海", Site2, 22, 30, SG.EncounterSpec.Of(
                    Wave("沙下的街", E(FireRat, 3), E(Wraith, 2), E(Apsara, 1)).Hint("流沙会往下拖，沙魇从沙里钻出来——从积沙坡上屋顶走"),
                    Wave("飞天降临", E(Apsara, 1), E(FireRat, 2), E(Scorpion, 2)).After(1, 2f).Hint("先打飞天的琵琶，她在给同伴加护"))
                .Gather(0.6f), "scroll");
            var s3 = Site(3, "塔尖广场", Site3, 24, 30, SG.EncounterSpec.Of(
                    Wave("镇墓", E(TombBeast, 1), E(Jerboa, 3), E(Scorpion, 1)).Hint("镇墓兽正面格挡——绕到背后打裂缝"),
                    Wave("塔前混编", E(TombBeast, 1).Elite("shielded"), E(Toad, 1), E(Apsara, 1), E(Jerboa, 2)).After(1, 2f)
                        .Hint("精英镇墓兽带护盾——先打琵琶，别站在蜃楼蟾的落点"))
                .Gather(1.5f), "weapon:min=1");
            var s4 = Site(4, "岩拱门", Site4, 20, 24, SG.EncounterSpec.Of(
                    Wave("守门小队", E(Scorpion, 2), E(Jerboa, 3), E(FireRat, 1), E(Toad, 1)).Hint("拱门下是唯一的出路——先清岩台上的弩卫"))
                .Gather(0.4f).Elites(1, "volatile"), "upgrade");
            var s5 = Site(5, "供养窟守军", Site5, 14, 16, SG.EncounterSpec.Of(
                    Wave("供养窟守军", E(Jerboa, 2), E(Scorpion, 1).Elite("swift"), E(FireRat, 1)))
                .Gather(0.4f), "");
            s5.autoTrigger = false;
            s5.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<SG.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿越雅丹迷城";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;

            // 藏宝：A 在北河道的岩龛里（直接给），B 在南河道的岩龛里（惊动 ⑤ 守军，肃清后给灵兽封印）
            SG.CachePOI Cache(string name, string title, Vector2 at, Vector2 from, string reward, SG.EncounterSite guard, float discover)
            {
                var c = new GameObject(name).AddComponent<SG.CachePOI>();
                c.transform.SetParent(root, false);
                var face = Dir2(from - at).normalized;
                c.transform.SetPositionAndRotation(OnGround(at), Quaternion.LookRotation(new Vector3(face.x, 0, face.y)));
                c.title = title;
                c.reward = reward;
                c.guard = guard;
                c.discoverRadius = discover;
                return c;
            }
            Cache("Cache A · 商队遗物", "商队遗物", CacheA, new Vector2(104, 50), "coins", null, 14);
            Cache("Cache B · 供养窟", "供养窟", CacheB, Site5, "pet", s5, 12);
            return objective;
        }

        /// <summary>出口传送门：嵌在出口祭坛正面（没有祭坛模型时自己立石门框），关卡目标完成后升起、落清关宝箱</summary>
        static void BuildExit(GameObject shrine, SG.LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<SG.ExitPortal>();
            var face = shrine ? shrine.transform.forward : new Vector3(Dir2(Vector2.left).x, 0, Dir2(Vector2.left).y);
            face.y = 0;
            face.Normalize();
            var at = L(Exit) + new Vector2(face.x, face.z) * 1.2f;
            portal.transform.SetPositionAndRotation(ts.OnGround(at.x, at.y), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；顺带重新生成 GameDatabase（同 1-1）</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<SG.PlayerSpawn>(), boots = Count<SG.LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            void None<T>(string what) where T : Component
            {
                int n = Count<T>();
                if (n > 0) rep.Fail($"场景里有 {n} 个 {what}（应在 Core 场景）");
            }
            None<SG.PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<SG.Hud>("HUD");
            None<SG.GameSession>("会话");
            None<SG.EnemyCatalog>("敌人目录（改由 GameDatabase 提供）");
            int sites = Count<SG.EncounterSite>(), pits = Count<SG.Quicksand>(), caches = Count<SG.CachePOI>(), portals = Count<SG.ExitPortal>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1），流沙 {pits}，藏宝 {caches}，出口 {portals}");
            if (sites != 5) rep.Fail($"遭遇场地有 {sites} 个（应为 5）");
            if (pits < 3) rep.Fail($"屋脊之海的流沙只有 {pits} 块（应为 3）");
            if (portals != 1) rep.Fail($"出口传送门有 {portals} 个（应为 1）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线路点（含 M1 顶、积沙坡顶、环台一 / 二层、岩台、拱下）、坡道坡度、6 条地标视线、
        /// 场地尺寸 / 掩体 / 层数阈值（只防退化，实测看报告）。可玩区遮罩与软边界同一个；界外是 15 m 以上的连续岩壁，防越界由地形保证。
        /// 站位、宝箱落点、藏宝、出口、占位件由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec(Vector3 spireTop, Vector3 archLintel, Vector3 cityTop)
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec Site(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var spec = new LevelSpec
                {
                    id = "1-2", title = "雅丹迷城", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        Site("出生·沙垭口（缓冲）", Spawn, 30, combat: false),
                        Site("① 河口三叉", Site1, 56, cover: 4, layers: 3, overlook: true),
                        Site("② 屋脊之海", Site2, 52, cover: 4, layers: 2, overlook: true),
                        Site("③ 塔尖广场", Site3, 50, cover: 3, layers: 3, overlook: true),
                        Site("④ 岩拱门", Site4, 40, cover: 2, layers: 2, overlook: true),
                    },
                }
                .Route("出生·沙垭口", G(Spawn)).Route("① 河口三叉", G(Site1)).Route("① 低丘 M1 顶", G(M1 + new Vector2(2, 0)))
                .Route("② 西侧积沙坡顶", G(new Vector2(146, 45.5f))).Route("② 屋脊之海", G(Site2))
                .Route("③ 塔尖广场", G(Site3)).Route("③ 环台一层（西北外凸台）", G(Lobe1)).Route("③ 环台二层", G(StupaC + new Vector2(7.5f, 5)))
                .Route("④ 岩拱门", G(Site4)).Route("④ 北岩台", G(ShelfC)).Route("④ 拱下", G(ArchC)).Route("出口", G(Exit + new Vector2(-4.5f, 0)))
                .Sight("出生 → 塔尖", G(Spawn, 1.62f), spireTop, 6, StupaId)
                .Sight("出生 → 狮身雅丹", G(Spawn, 1.62f), At(SphinxC + new Vector2(-12, 0), Ground0(SphinxC) + 11f), 6, SphinxId)
                .Sight("① 河口 → 塔尖", G(new Vector2(80, -3), 1.62f), spireTop, 6, StupaId)
                .Sight("② 屋脊之海 → 塔尖", G(Site2, 1.62f), spireTop, 6, StupaId)
                .Sight("③ 广场 → 岩拱", G(Site3, 1.62f), archLintel, 6, ArchId)
                .Sight("④ 拱下 → 古城寺塔", G(ArchC + new Vector2(-4, 0), 1.62f), cityTop, 8, PagodaId);
            spec.slopePaths.Add(new SlopePath { name = "入口沙垭口", points = new[] { L(Spawn), L(40, 0) } });
            foreach (var r in Ramps) spec.slopePaths.Add(new SlopePath { name = r.name, points = new[] { L(r.foot), L(r.top) } });
            return spec;
        }
    }
}
