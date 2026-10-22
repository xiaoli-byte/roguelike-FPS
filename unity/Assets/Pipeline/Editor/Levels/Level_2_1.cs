using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;
using SG = Spiritfire.Game;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 2-1 冰瀑栈道（docs/level-design/maps/2-1.md；unity-maps-v1 §2；parity 3.10「栈道段扩成 20–40 m 宽的阶地，每场战斗至少两条接近路线」、M21）：
    /// 关卡坐标 = 世界 XZ（米），峡谷轴线沿 +Z 往上游爬，x 横向（东为正）。V 形谷两岸是一级级台面（地形），台面之间是陡坎，坡道和栈道把它们串起来：
    ///
    ///   出生·冰河尾碛丘 (0, −4) → ① 冰河 (0, 74)：冰面 32 m 宽 + 砾石洲，西岸低台 WT 3.5 m 是俯射位
    ///   → R1 上东岸低台 E1（10）→ ② 东岸台地 (46, 92)：两个凿进绝壁的石龛 13.2 m，R2 栈道贴着绝壁上到中台
    ///   → ③ 冰桥 (0, 158)：两岸中台（20）之间 36 m 的冰桥，头顶冰拱垂下可以射落的冰棱（<see cref="SG.IcefallIcicle"/>）
    ///   → ④ 冰柱林 (34, 206)：东岸上台 E3（34），从西岸上台 W3（33）过断桥（4 m 断口，对岸高 1 m：跳 + 冲刺），或走 R5 栈道 / 环台绕过来
    ///   → ⑤ 瀑顶冰潭 (0, 250)：Ø45 的冰面，潭心冰岛立开明兽，四周 47.6 m 的石阶环台 → 出口祭坛 (0, 280)。
    /// 冰瀑三段叠成 45 m，背贴瀑口陡坎，是全图地标。五个必清场地任意顺序；藏宝 A 在谷底河槽尽头（冰瀑脚下），藏宝 B 在西岸低台北端（守军 ⑥）。
    ///
    /// 边界（D14，没有空气墙）：游玩区是一个闭合多边形 <see cref="Envelope"/>，界外 6 m 内陡升成绝壁，崖顶 34 m（下游）→ 72 m（冰潭），
    /// 比任何能站的面高 24 m 以上，L5 防越界由地形本身保证；软边界（风雪白化）沿同一个遮罩只做兜底。
    /// 场景只放环境和标记（D17 / L1）。生成：Spiritfire ▸ Levels ▸ Build 2-1 冰瀑栈道（或 bridge.sh level 2-1）。冒烟：bridge.sh playtest map-2-1（Map21Suite）。
    /// </summary>
    [LevelBuilder("2-1", ScenePath)]
    public static class Level_2_1
    {
        public const string Dir = "Assets/Levels/L2_1_Icefall";
        public const string ScenePath = "Assets/Scenes/L2_1_Icefall.unity";
        const string Name = "L2_1";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（冰河）；山原最高约 90 m；地形外缘落回 FarY（远景地面）</summary>
        const float Base = 8f, HeightRange = 100f, FarY = 64f;
        static readonly Vector2 Origin = new(-256, -128), Size = new(512, 512);
        /// <summary>雾（主题默认 25 / 210 m）：调远，出生点看 222 m 外的冰瀑还剩轮廓</summary>
        const float FogStart = 70f, FogEnd = 380f;
        /// <summary>风顺着峡谷往下游吹（风吹去的方向）</summary>
        static readonly Vector2 Wind = new(0, -1);
        /// <summary>软边界（L3）：冰原风雪白化，等值线在崖壁面上，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = FrostBounds();

        static LevelKit.BoundarySpec FrostBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Frost";
            return b;
        }

        // ───────────── 高度（世界 y）─────────────
        /// <summary>陡坎坡率（3.5 ≈ 74°：10 m 的坎水平 2.9 m）；瀑口用 12（≈ 85°，冰瀑贴着几乎竖直的壁）</summary>
        const float CliffSlope = 3.5f, HeadSlope = 12f;
        const float RiverY = 0, BankY = 0.4f, WtY = 3.5f, E1Y = 10f, BenchY = 20f, W3Y = 33f, E3Y = 34f, NicheY = 13.2f;
        const float PoolY = 45f, RingY = 47.6f, IslandY = 46.2f, DaisY = 37f;

        // ───────────── 台面（矩形，界外按坡率陡落；各台面取最大值）─────────────
        static readonly LevelKit.Shelf[] Shelves =
        {
            new("WT 西岸低台", new Vector2(-200, 24), new Vector2(-21, 134), WtY),
            new("W2 西岸中台", new Vector2(-200, 134), new Vector2(-15, 188), BenchY),
            new("W3 西岸上台", new Vector2(-200, 188), new Vector2(-17, 330), W3Y),
            new("E1 东岸低台", new Vector2(30, 38), new Vector2(200, 140), E1Y),
            new("E2 东岸中台", new Vector2(15, 140), new Vector2(200, 188), BenchY),
            new("E3 东岸上台", new Vector2(17, 188), new Vector2(200, 330), E3Y),
            new("南龛", new Vector2(57, 66), new Vector2(200, 74), NicheY),
            new("北龛", new Vector2(57, 80), new Vector2(200, 88), NicheY),
        };
        /// <summary>瀑口（冰潭从这里溢出，南面是冰瀑贴着的陡壁）</summary>
        static readonly LevelKit.Shelf Crest = new("瀑口", new Vector2(-17, 222), new Vector2(17, 330), PoolY);

        // ── ⑤ 冰潭：环台是圆台（挖掉瀑口那一块），中间挖出冰潭，潭心冰岛 ──
        static readonly Vector2 PoolC = new(0, 250);
        const float RingR = 36.5f, PoolR = 22.5f, IslandR = 8f;
        static readonly Vector2 GorgeHeadMin = new(-17, -10000), GorgeHeadMax = new(17, 240);
        static readonly Vector2 SpillMin = new(-15, 222), SpillMax = new(15, 250);

        // ── 地面细节 ──
        static readonly Vector2 Knoll = new(0, -4);
        static readonly Vector2 Bar = new(-4, 74), BarHalf = new(11, 3.5f);
        static readonly Vector2 MoundMin = new(37.5f, 106.5f), MoundMax = new(46.5f, 113.5f);
        static readonly Vector2 DaisMin = new(22.5f, 204), DaisMax = new(31.5f, 212);
        const float RiverZ0 = 22, RiverZ1 = 210;

        /// <summary>冰河半宽：① 一段 16 m，z 118–140 收到 7 m，之后是 14 m 宽的河槽</summary>
        static float RiverHalf(float z) => z <= 118 ? 16 : z >= 140 ? 7 : Mathf.Lerp(16, 7, (z - 118) / 22f);

        // ── 坡道（地形，挖填都做）──
        static readonly (string name, Vector2 foot, float footY, Vector2 top, float topY, float width)[] Ramps =
        {
            ("R1 冰河 → 东岸低台", new Vector2(24, 46), BankY, new Vector2(34, 76), E1Y, 7),
            ("WT 南坡", new Vector2(-12, 34), BankY, new Vector2(-27, 40), WtY, 6),
            ("WT 北坡", new Vector2(-12, 112), BankY, new Vector2(-27, 118), WtY, 6),
            ("R3 西岸冰碛坡", new Vector2(-42, 92), WtY, new Vector2(-42, 142), BenchY, 7),
            ("R6 东岸上台 → 环台", new Vector2(52, 206), E3Y, new Vector2(30, 242), RingY, 7),
            ("R7 西岸上台 → 环台", new Vector2(-52, 206), W3Y, new Vector2(-30, 242), RingY, 7),
            ("冰潭东石阶", new Vector2(18, 250), PoolY, new Vector2(28, 250), RingY, 6),
            ("冰潭西石阶", new Vector2(-18, 250), PoolY, new Vector2(-28, 250), RingY, 6),
            ("冰潭北石阶", new Vector2(0, 268), PoolY, new Vector2(0, 278), RingY, 6),
            ("南龛石阶", new Vector2(46, 70), E1Y, new Vector2(56.5f, 70), NicheY, 5),
            ("北龛石阶", new Vector2(46, 84), E1Y, new Vector2(56.5f, 84), NicheY, 5),
            ("冰台坡道", new Vector2(41, 208), E3Y, new Vector2(31, 208), DaisY, 5),
        };

        // ── 栈道（倾斜的碰撞盒 + 栈道套件外观）：front = 有栏杆的外侧（落差那边）──
        const float PlankWidth = 6f, PlankThick = 0.8f;
        static readonly (string name, Vector2 foot, float footY, Vector2 top, float topY, Vector2 front)[] PlankRoads =
        {
            ("R2 东岸栈道（低台 → 中台）", new Vector2(64, 98.5f), E1Y, new Vector2(64, 140.5f), BenchY, Vector2.left),
            ("R5 东岸栈道（中台 → 上台）", new Vector2(64, 146), BenchY, new Vector2(64, 188.5f), E3Y, Vector2.left),
            ("R4 西岸栈道（中台 → 上台）", new Vector2(-60, 145.5f), BenchY, new Vector2(-60, 188.5f), W3Y, Vector2.right),
        };

        // ── ③ 冰桥 + 冰拱 + 冰棱 ──
        const float BridgeZ = 158, BridgeHalfLen = 18, BridgeWidth = 8, BridgeThick = 2.5f;
        const float ArchTop = 31.5f, ArchHalfSpan = 25f, ArchWidth = 5.4f;
        static readonly Vector2 SpireW = new(-24, BridgeZ), SpireE = new(24, BridgeZ);
        static readonly float[] IcicleX = { -11, -5.5f, 0.5f, 6, 11.5f };

        // ── ④ 断桥：西段桥面 33（W3），x = 6 断开；4 m 断口；东段残桥 34（E3）──
        const float BrokenZ = 198, BrokenX0 = -20, GapX0 = 6, GapX1 = 10, BrokenX1 = 20, BrokenWidth = 6;

        // ───────────── 场地 / 藏宝 / 出口 ─────────────
        static readonly Vector2 Site1 = new(0, 74), Site2 = new(46, 92), Site3 = new(0, BridgeZ), Site4 = new(34, 206), Site5 = PoolC, Site6 = new(-28, 114);
        static readonly Vector2 CacheA = new(0, 204), CacheB = new(-30, 121), ExitAt = new(0, 280);
        static readonly Vector2 DashWest = new(5.2f, BrokenZ), DashEast = new(13f, BrokenZ);

        /// <summary>游玩区多边形（西岸自南往北，再绕冰潭北岸，东岸自北往南）：外面是连续绝壁</summary>
        static readonly Vector2[] Envelope = BuildEnvelope();

        static Vector2[] BuildEnvelope()
        {
            var pts = new List<Vector2>
            {
                new(-26, -16), new(-38, -2), new(-44, 20), new(-48, 50), new(-48, 100), new(-52, 124), new(-66, 140), new(-66, 214), new(-56, 240), new(-44, 258),
            };
            foreach (float a in new[] { 150f, 120f, 90f, 60f, 30f })
                pts.Add(PoolC + 35f * new Vector2(Mathf.Cos(a * Mathf.Deg2Rad), Mathf.Sin(a * Mathf.Deg2Rad)));
            pts.AddRange(new Vector2[] { new(44, 258), new(58, 240), new(70, 214), new(70, 90), new(68, 50), new(52, 16), new(38, -2), new(26, -16) });
            return pts.ToArray();
        }

        /// <summary>崖顶高度（按 z 分段，世界 y）：下游 34 → 72（冰潭）；任何能站的面离旁边崖顶 ≥ 24 m</summary>
        static readonly Vector2[] RimKeys = { new(20, 34), new(100, 44), new(160, 58), new(215, 72) };

        /// <summary>台面边线不摆动的地方：桥头、栈道两端、石龛、冰台（桥面 / 栈道面要和台面齐平）</summary>
        static readonly (Vector2 c, float r)[] CalmZones =
        {
            (new Vector2(-16, BridgeZ), 12), (new Vector2(16, BridgeZ), 12), (new Vector2(-18, BrokenZ), 10), (new Vector2(18, BrokenZ), 10),
            (new Vector2(64, 98.5f), 7), (new Vector2(64, 140.5f), 9), (new Vector2(64, 146), 7), (new Vector2(64, 188.5f), 9),
            (new Vector2(-60, 145.5f), 7), (new Vector2(-60, 188.5f), 9), (new Vector2(57, 77), 16), (new Vector2(27, 208), 10),
        };

        // ── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深）──
        const string IcefallBaseId = "SM_Tripo_FrostIcefallBase", IcefallMidId = "SM_Tripo_FrostIcefallMid", IcefallTopId = "SM_Tripo_FrostIcefallTop",
            IceBridgeId = "SM_Tripo_FrostIceBridge", IcicleId = "SM_Tripo_FrostIcicle", ShardsId = "SM_Tripo_FrostIcicleShards", PillarId = "SM_Tripo_FrostIcePillar",
            PlankId = "SM_Tripo_FrostPlankRoadStraight", BrokenId = "SM_Tripo_FrostPlankRoadBroken", PostId = "SM_Tripo_FrostPlankRoadPost",
            NicheId = "SM_Tripo_FrostPlankRoadNiche", CliffId = "SM_Tripo_FrostCanyonCliff", KaimingId = "SM_Tripo_FrostKaiming",
            ShrineId = "SM_Tripo_FrostPortalShrine", WayshrineId = "SM_Env_FrostWayshrine", TentId = "SM_Tripo_FrostPrayerTent",
            OfferingsId = "SM_Tripo_FrostOfferings", HoardId = "SM_Tripo_FrostJadeHoard", CoverWallId = "SM_Tripo_FrostCoverWall",
            BarricadeId = "SM_Tripo_FrostBarricade", LanternId = "SM_Tripo_FrostIceLantern", CairnId = "SM_Prop_FrostPrayerCairn";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [IcefallBaseId] = new(16.17f, 12f, 10.74f), [IcefallMidId] = new(15.87f, 16f, 5.17f), [IcefallTopId] = new(13.02f, 12f, 4.24f),
            [IceBridgeId] = new(10.03f, 6.92f, 8.96f), [IcicleId] = new(2.02f, 4.54f, 1.63f), [ShardsId] = new(1.68f, 1f, 1.23f),
            [PillarId] = new(2.52f, 5.46f, 2.69f), [PlankId] = new(8f, 3.49f, 6.21f), [BrokenId] = new(5f, 3.49f, 6.2f), [PostId] = new(6.24f, 9f, 1.24f),
            [NicheId] = new(7.48f, 8f, 3.96f), [CliffId] = new(14.17f, 19.74f, 7.84f), [KaimingId] = new(8.13f, 15.54f, 7.88f),
            [ShrineId] = new(10.46f, 10.93f, 2.94f), [WayshrineId] = new(4.19f, 4.84f, 3.3f), [TentId] = new(4f, 3.53f, 3.86f),
            [OfferingsId] = new(1.74f, 1.54f, 1.3f), [HoardId] = new(2.82f, 1.72f, 1.67f), [CoverWallId] = new(5.57f, 2.47f, 1.49f),
            [BarricadeId] = new(4.44f, 1.18f, 0.41f), [LanternId] = new(0.9f, 2.36f, 0.89f), [CairnId] = new(1.05f, 1.97f, 0.72f),
        };
        /// <summary>栈道直段 / 断头的桥面在模型里的高度（未缩放，registry：deck top at 2.4 m；实际按碰撞体探）</summary>
        const float PlankDeckLocal = 2.4f;

        // ── 第二章阵容 ──
        const string Jiaoren = "jiaoren", Xingxing = "xingxing", XuanGui = "xuangui", FrostCrab = "frost_crab", Qingniao = "qingniao", Puffer = "ice_puffer",
            Haozhi = "haozhi", Fuzhu = "fuzhu", IceWhale = "ice_whale", FoxWitch = "fox_witch", Jelly = "lantern_jelly";

        /// <summary>
        /// 刷怪站位（标记名、属于哪个场地、世界 XZ、角色、lane、高台、散开半径）。高台站位只给飞行单位（三青鸟、冰河豚、灯水母）；
        /// 贴地的远程站在 NavMesh 走得上去的高处（西岸低台、石龛、栈道、冰台、环台）。全部离道具 ≥ 4 m、离陡坎脚 ≥ 3 m。
        /// </summary>
        static readonly (string name, int site, Vector2 at, SG.StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_1_Ice_North", 1, new Vector2(4, 96), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_1_Ice_NE", 1, new Vector2(20, 88), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_1_Ice_NW", 1, new Vector2(-12, 92), SG.StationRole.Flank, 2, false, 2f),
            ("Enemy_1_Terrace", 1, new Vector2(-33, 80), SG.StationRole.Ranged, 0, false, 1.8f),
            ("Enemy_1_Bar", 1, new Vector2(-4, 74), SG.StationRole.Auto, 0, false, 1.5f),
            ("Enemy_1_Sky", 1, new Vector2(-36, 62), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_1_FlankE", 1, new Vector2(14, 58), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_1_FlankW", 1, new Vector2(-14, 58), SG.StationRole.Flank, 2, false, 2f),
            ("Enemy_2_PlankRoad", 2, new Vector2(64, 112), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_2_NicheS", 2, new Vector2(61, 70), SG.StationRole.Precision, 0, false, 1f),
            ("Enemy_2_NicheN", 2, new Vector2(61, 84), SG.StationRole.Ranged, 0, false, 1f),
            ("Enemy_2_North", 2, new Vector2(44, 124), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_2_FlankS", 2, new Vector2(38, 62), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_2_Mound", 2, new Vector2(42, 110), SG.StationRole.Auto, 2, false, 1.5f),
            ("Enemy_2_Sky", 2, new Vector2(50, 100), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_3_W_Assault", 3, new Vector2(-30, 160), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_3_W_Ranged", 3, new Vector2(-34, 172), SG.StationRole.Ranged, 0, false, 2f),
            ("Enemy_3_W_Support", 3, new Vector2(-34, 146), SG.StationRole.Support, 0, false, 2f),
            ("Enemy_3_E_FlankN", 3, new Vector2(32, 174), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_3_E_FlankS", 3, new Vector2(34, 146), SG.StationRole.Flank, 2, false, 2f),
            ("Enemy_3_Bridge", 3, new Vector2(-8, BridgeZ), SG.StationRole.Auto, 0, false, 1.2f),
            ("Enemy_3_Sky", 3, new Vector2(-26, 176), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_4_Dais", 4, new Vector2(27, 208), SG.StationRole.Support, 0, false, 1f),
            ("Enemy_4_Landing", 4, new Vector2(22, 199), SG.StationRole.Assault, 2, false, 1.5f),
            ("Enemy_4_East", 4, new Vector2(50, 197), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_4_North", 4, new Vector2(34, 223), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_4_Sky", 4, new Vector2(38, 196), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_4_Ring", 4, new Vector2(26, 236), SG.StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_5_Ring_N", 5, new Vector2(-12, 276), SG.StationRole.Artillery, 0, false, 1.5f),
            ("Enemy_5_Ring_E", 5, new Vector2(29, 256), SG.StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_5_Ring_W", 5, new Vector2(-29, 256), SG.StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_5_Ice_N", 5, new Vector2(0, 264), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_5_Ice_E", 5, new Vector2(14, 240), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_5_Ice_W", 5, new Vector2(-14, 240), SG.StationRole.Flank, 2, false, 2f),
            ("Enemy_5_Sky", 5, new Vector2(14, 272), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_6_A", 6, new Vector2(-24, 108), SG.StationRole.Auto, 0, false, 1.5f),
            ("Enemy_6_B", 6, new Vector2(-34, 104), SG.StationRole.Auto, 1, false, 1.5f),
            ("Enemy_6_C", 6, new Vector2(-27, 113), SG.StationRole.Auto, 2, false, 1.2f),
        };

        /// <summary>主线（世界 XZ）：散布避让用（断桥不在主线上，主线绕环台）</summary>
        static readonly Vector2[] RouteLine =
        {
            Knoll, new(0, 40), Site1, new(24, 46), new(34, 76), Site2, new(64, 98.5f), new(64, 146), new(30, 160), Site3, new(-30, 164),
            new(-60, 145.5f), new(-60, 188.5f), new(-40, 200), new(-52, 206), new(-30, 242), PoolC, new(30, 242), new(52, 206), Site4, ExitAt,
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        static float RimH(float z)
        {
            if (z <= RimKeys[0].x) return RimKeys[0].y;
            for (int i = 0; i + 1 < RimKeys.Length; i++)
            {
                var a = RimKeys[i];
                var b = RimKeys[i + 1];
                if (z <= b.x) return Mathf.Lerp(a.y, b.y, Smooth(0, 1, (z - a.x) / (b.x - a.x)));
            }
            return RimKeys[^1].y;
        }

        /// <summary>离游玩区边界的有符号距离（界内为正，米）</summary>
        static float Inside(Vector2 p) => LevelKit.PolygonSigned(p, Envelope);

        /// <summary>可玩区遮罩（世界 XZ，软边界与 L5 共用）：等值线 0.2 落在崖壁面上（界外约 1.7 m）</summary>
        static float Playable(Vector2 p) => Smooth(-4, 4, Inside(p));

        static float Calm(Vector2 p)
        {
            float c = 0;
            foreach (var (cc, r) in CalmZones) c = Mathf.Max(c, 1 - Smooth(r * 0.6f, r, Vector2.Distance(p, cc)));
            return c;
        }

        static float Ellipse(Vector2 q, Vector2 c, Vector2 r)
        {
            var d = q - c;
            return Mathf.Sqrt(d.x * d.x / (r.x * r.x) + d.y * d.y / (r.y * r.y));
        }

        /// <summary>冰河遮罩（0–1）：冰面在 RiverZ0 – RiverZ1 之间、半宽 RiverHalf(z) 以内</summary>
        static float IceBand(Vector2 p)
        {
            float hw = RiverHalf(p.y);
            return (1 - Smooth(hw - 1.5f, hw, Mathf.Abs(p.x))) * Smooth(RiverZ0 - 4, RiverZ0, p.y) * (1 - Smooth(RiverZ1 - 2, RiverZ1 + 2, p.y));
        }

        /// <summary>冰潭遮罩（圆潭 + 南边溢口）</summary>
        static float PoolMask(Vector2 p) =>
            Mathf.Max(1 - Smooth(PoolR - 0.3f, PoolR + 0.3f, Vector2.Distance(p, PoolC)), 1 - Smooth(-0.3f, 0.3f, LevelKit.BoxSdf(p, SpillMin, SpillMax)));

        /// <summary>台面 + 环台 + 瀑口（不含坡道、冰潭、崖壁）：坡道两端的高度、摆件贴地从这里取也行</summary>
        static float Terraces(Vector2 p, float wobble)
        {
            float h = float.NegativeInfinity;
            foreach (var s in Shelves) h = Mathf.Max(h, LevelKit.ShelfHeight(p, s, CliffSlope, wobble));
            h = Mathf.Max(h, LevelKit.ShelfHeight(p, Crest, HeadSlope));
            // 环台：圆台挖掉瀑口那一块（|x| < 17、z < 240 是冰瀑和溢口）
            float sdRing = Mathf.Min(RingR - Vector2.Distance(p, PoolC), LevelKit.BoxSdf(p, GorgeHeadMin, GorgeHeadMax));
            h = Mathf.Max(h, RingY - CliffSlope * Mathf.Max(0, -(sdRing + wobble)));
            return h;
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float calm = Calm(p);
            float wob = Fbm(p, 16, 2, 11) * 1.2f * (1 - calm);

            // ── 谷底：砾石滩 0.4、冰河 0、出生碛丘、河心砾石洲 ──
            float ice = IceBand(p);
            float h = BankY * (1 - ice) + Fbm(p, 12, 2, 3) * 0.08f * (1 - ice);
            float knoll = 4f * (1 - Smooth(6, 26, Vector2.Distance(p, Knoll)));
            h = Mathf.Max(h, knoll);
            float bar = 1 - Smooth(0.55f, 1f, Ellipse(p, Bar, BarHalf));
            h += 1.4f * bar;

            // ── 台面 + 陡坎 ──
            h = Mathf.Max(h, Terraces(p, wob));
            // ② 东岸低台上的碎石堆（+1.3，只在 E1 台面里）
            float mound = (1 - Smooth(0, 3, LevelKit.BoxSdf(p, MoundMin, MoundMax))) * Smooth(0, 1, Shelves[3].Inside(p));
            h += 1.3f * mound;
            // ④ 冰台（+3，正对断桥落脚处）
            h = Mathf.Max(h, DaisY - CliffSlope * Mathf.Max(0, LevelKit.BoxSdf(p, DaisMin, DaisMax)));

            // ── ⑤ 冰潭 + 潭心冰岛 ──
            float pool = PoolMask(p);
            h = Mathf.Lerp(h, PoolY, pool);
            float isl = 1 - Smooth(IslandR - 0.6f, IslandR + 0.6f, Vector2.Distance(p, PoolC));
            if (isl > 0) h = Mathf.Max(h, Mathf.Lerp(h, IslandY, isl));

            // ── 坡道（挖填都做，坡度处处一样）──
            float rampMask = 0;
            foreach (var r in Ramps)
            {
                h = LevelKit.CutRamp(p, h, r.foot, r.footY, r.top, r.topY, r.width, 2.5f, out float m);
                rampMask = Mathf.Max(rampMask, m);
            }

            // ── 台面细起伏（冰面、冰潭、坡道、桥头不加）──
            float flat = Mathf.Max(Mathf.Max(ice, pool), Mathf.Max(rampMask, calm));
            h += Fbm(p, 9, 2, 5) * 0.12f * (1 - flat);

            // ── 崖壁 + 山原：界外 6 m 内陡升到崖顶，崖顶外起岩脊 ──
            float ins = Inside(p);
            float rim = RimH(p.y) + 18f * Ridged(p, 70, 3, 21) * Smooth(-6, -50, ins);
            h = h + 0.6f * Smooth(3, 0, ins) + Mathf.Max(0, rim - h - 0.6f) * Smooth(0, -6, ins);

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Frost：岩 → 冰 → 冻土 → 雪）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            s.fluid = Mathf.Max(ice * (1 - rampMask), pool * (1 - isl)) * inside;
            float shoal = (1 - ice) * (1 - Smooth(1, 6, h)) * inside;
            s.packed = Mathf.Max(Mathf.Max(rampMask * 0.9f, bar * 0.8f), Mathf.Max(shoal * 0.6f, isl * 0.5f));
            s.sand = Smooth(2, 8, h) * 0.45f * (1 - rampMask) * inside;
            s.rock = Smooth(0.5f, -1.5f, ins) * (1 - Smooth(-7, -10, ins));
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 2-1 冰瀑栈道", priority = 71)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>构建期的地形（摆件、标记贴地用）</summary>
        static LevelKit.TerrainSet ts;
        /// <summary>构建期量到的地标点（视线目标、冒烟测试的标记）</summary>
        static Vector3 icefallAim, archAim, archEastAim, kaimingAim, shrineAim;

        static Vector3 OnGround(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);

        /// <summary>生成场景 → 烘焙 NavMesh → 验收规则集 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Frost;
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
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Frost, eval = Eval,
            }, env);
            try
            {
                // 远景：山原外是岩脊 + 两圈雪峰；地形外缘接远景地面
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(0, 130), FarY - 4, 760, 7);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY, theme.groundA, 3000);

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：顺峡谷往下游的风；2-1 的动态环境是冰面，不放风雪区（unity-maps-v1：每张图最多一个）
                LevelKit.Weather(env, theme, Wind, 0.35f);

                BuildIcefall(kit);
                BuildIceBridge(kit, world);
                BuildBrokenBridge(kit);
                foreach (var r in PlankRoads) PlankRoad(kit, r.name, r.foot, r.footY, r.top, r.topY, r.front);
                BuildNiches(kit);
                BuildPool(kit, props);
                var shrine = Kit(ShrineId, kit, OnGround(ExitAt, -0.15f), 180);
                shrineAim = shrine ? TopOf(shrine, 2.5f) : At(ExitAt, RingY + 8);
                BuildForest(kit);
                BuildRiver(props);
                BuildTerraceProps(props);
                BuildCliffs(kit);
                BuildIceZones(world);
                BuildScatter(props, theme);
                BuildMarkers(markers);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝冰瀑）+ 自举标记
                var spawnAt = OnGround(Knoll, 0.05f);
                var spawnRot = Quaternion.LookRotation(Vector3.forward);
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
                rep.Line("2-1 冰瀑栈道 · 验收");
                rep.Line($"高度：出生 {OnGround(Knoll).y:F1}，① 冰河 {OnGround(new Vector2(0, 60)).y:F2}，WT {OnGround(new Vector2(-33, 80)).y:F1}，E1 {OnGround(Site2).y:F1}，" +
                         $"石龛 {OnGround(new Vector2(61, 70)).y:F1}，E2 {OnGround(new Vector2(32, 160)).y:F1}，W2 {OnGround(new Vector2(-30, 160)).y:F1}，" +
                         $"W3 {OnGround(new Vector2(-40, 200)).y:F1}，E3 {OnGround(new Vector2(40, 204)).y:F1}，冰台 {OnGround(new Vector2(27, 208)).y:F1}，" +
                         $"冰潭 {OnGround(new Vector2(0, 236)).y:F2}，环台 {OnGround(new Vector2(-24, 262)).y:F1}，冰岛 {OnGround(new Vector2(5.5f, 250)).y:F1}");
                foreach (var r in Ramps) rep.Line($"坡道「{r.name}」纵断面 {LevelKit.RampGrade(r.foot, r.footY, r.top, r.topY):F1}°");
                foreach (var r in PlankRoads) rep.Line($"栈道「{r.name}」{LevelKit.RampGrade(r.foot, r.footY, r.top, r.topY):F1}°（碰撞盒）");
                rep.Line($"断桥：断口 {GapX1 - GapX0:F1} m，对岸高 {E3Y - W3Y:F1} m（跳 + 冲刺）");
                LevelValidator.Run(Spec(), rep);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_2-1_report.txt");

                if (review) Review(spawnAt, spawnRot);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => OnGround(q, dy);
            var center = new Vector3(0, 0, 135);
            // 审核截图用临时机位（与玩家同一套相机 + 第一人称 rig），截完删掉
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_2-1", new[]
                {
                    ("Aerial", new Vector3(-150, 170, -40), new Vector3(0, 20, 150), false),
                    ("Map", new Vector3(center.x, 460, center.z - 1), center, false),
                    ("Spawn", E(Knoll), icefallAim, true),
                    ("River", E(new Vector2(-6, 52)), archAim, false),
                    ("EastTerrace", E(new Vector2(42, 80)), new Vector3(64, 16, 120), false),
                    ("PlankRoad", At(new Vector2(64, 120), 15.2f + 1.62f), new Vector3(30, 22, 160), false),
                    ("BridgeEast", E(new Vector2(24, 152)), new Vector3(-24, 24, 160), false),
                    ("UnderArch", At(new Vector2(4, BridgeZ), BenchY + 1.62f), archAim, false),
                    ("BrokenGap", At(new Vector2(0, BrokenZ), W3Y + 1.62f), At(DashEast, E3Y + 1), false),
                    ("Forest", E(new Vector2(50, 196)), kaimingAim, false),
                    ("Pool", E(new Vector2(-14, 236)), shrineAim, false),
                    ("CacheA", E(new Vector2(0, 176)), OnGround(CacheA, 1), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");
        static Vector3 SizeOf(string id) => DesignSize.TryGetValue(id, out var d) ? d : Vector3.one * 2;

        /// <summary>
        /// 摆一件 ART5 资产：底面中心 = 世界坐标 pos、偏航 yaw；有 Prefab 就按 scale（可非均匀）摆，
        /// 没有就放设计尺寸 × scale 的白盒（LevelKit.PlaceOrBox，Placeholder 标签，验收会列出来）
        /// </summary>
        static GameObject Kit(string id, Transform parent, Vector3 pos, float yaw, Vector3 scale)
        {
            var go = LevelKit.PlaceOrBox(id, parent, pos, Vector3.Scale(SizeOf(id), scale), yaw);
            if (!go) return null;
            if (!IsPlaceholder(go))
            {
                // Place 写的是局部坐标：统一按世界坐标摆（父物体可能不在原点）
                go.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, yaw, 0));
                go.transform.localScale = scale;
            }
            go.isStatic = true;
            return go;
        }

        static GameObject Kit(string id, Transform parent, Vector3 pos, float yaw, float scale = 1) => Kit(id, parent, pos, yaw, Vector3.one * scale);

        /// <summary>任意朝向：底面中心 basePoint、旋转 rot（白盒的轴心在盒心，要按盒高补回去）</summary>
        static void Orient(GameObject go, Vector3 basePoint, Quaternion rot, float boxHeight)
        {
            if (!go) return;
            go.transform.rotation = rot;
            go.transform.position = IsPlaceholder(go) ? basePoint + rot * (Vector3.up * (boxHeight * 0.5f - 0.1f)) : basePoint;
        }

        /// <summary>摆件顶上一点（渲染包围盒顶往下 down 米，水平取包围盒中心）</summary>
        static Vector3 TopOf(GameObject go, float down = 0)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return go.transform.position;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return new Vector3(b.center.x, b.max.y - down, b.center.z);
        }

        /// <summary>让 +Z 朝水平方向 d 的偏航角（度）</summary>
        static float Yaw(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        static void NonStatic(GameObject go)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
        }

        /// <summary>把实例的走行面顶（局部 local 处，从上往下探）对齐到世界高度 targetY；探不到就不动</summary>
        static void AlignTop(GameObject go, Vector3 local, float targetY)
        {
            if (!go || IsPlaceholder(go)) return;
            float y = LevelKit.ProbeY(go, local + Vector3.up * 30f);
            if (!float.IsNaN(y)) go.transform.position += Vector3.up * (targetY - y);
        }

        /// <summary>冰瀑三段：横向拉到约 32 m、竖向 ×1.125 叠成 45 m，正面朝南，背面都埋进瀑口陡壁（壁 85°，背面统一在 z = 222.5）</summary>
        static void BuildIcefall(Transform kit)
        {
            var root = new GameObject("冰瀑").transform;
            root.SetParent(kit, false);
            const float back = 222.5f, sy = 1.125f;
            void Seg(string id, float baseY, float sx)
            {
                var d = SizeOf(id);
                var go = Kit(id, root, new Vector3(0, baseY, back - d.z * 0.5f), 180, new Vector3(sx, sy, 1));
                if (go) go.name = IsPlaceholder(go) ? go.name : $"{id} ({baseY:F0} m)";
            }
            Seg(IcefallBaseId, -0.3f, 1.9f);
            Seg(IcefallMidId, 12f * sy - 0.3f, 2.0f);
            Seg(IcefallTopId, 28f * sy - 0.3f, 2.5f);
            var top = root.GetComponentsInChildren<Transform>().Select(t => t.gameObject).FirstOrDefault(g => g.name.Contains(IcefallTopId));
            icefallAim = top ? TopOf(top, 1.5f) : new Vector3(0, PoolY - 1.5f, 220);
        }

        /// <summary>冰桥的一半（厚头朝岸）：side = −1 西半 / +1 东半，顶面 top，跨度 span（中心到岸）、宽 width。厚头朝向按碰撞体量底面判断</summary>
        static GameObject IceHalf(Transform parent, string name, int side, float top, float span, float width)
        {
            var d = SizeOf(IceBridgeId);
            var scale = new Vector3(span / d.x, 1, width / d.z);
            var go = Kit(IceBridgeId, parent, new Vector3(side * span * 0.5f, top - d.y, BridgeZ), 0, scale);
            if (!go) return null;
            go.name = IsPlaceholder(go) ? go.name : $"{IceBridgeId} ({name})";
            if (!IsPlaceholder(go))
            {
                // 厚头 = 底面低的那头；要朝 side 方向（岸那边）
                var (minus, plus) = LevelKit.ProbeEnds(go, d.x * 0.4f, new[] { -1.5f, 0f, 1.5f }, -1f, true);
                bool thickPlus = !float.IsNaN(plus) && (float.IsNaN(minus) || plus < minus);
                if (thickPlus != side > 0) go.transform.rotation = Quaternion.Euler(0, 180, 0);
            }
            return go;
        }

        /// <summary>
        /// ③ 冰桥：走行面是显式碰撞盒（36 × 8 m，顶 20 m，两头埋进两岸中台），两件冰桥半跨只做外观；桥上方是同一件模型拉长的冰拱（顶 31.5 m，两脚落在桥头的冰柱上，留碰撞），
        /// 拱底垂下 5 根冰棱（<see cref="SG.IcefallIcicle"/>：射落 → 砸地范围伤害 → 变成 1.6 m 的碎冰堆掩体）
        /// </summary>
        static void BuildIceBridge(Transform kit, Transform world)
        {
            var root = new GameObject("③ 冰桥").transform;
            root.SetParent(kit, false);
            LevelKit.DeckX("冰桥桥面 Collision", root, -BridgeHalfLen, BridgeHalfLen, BridgeZ, BenchY, BridgeWidth, BridgeThick);
            LevelKit.VisualOnly(IceHalf(root, "西半", -1, BenchY, BridgeHalfLen, BridgeWidth));
            LevelKit.VisualOnly(IceHalf(root, "东半", 1, BenchY, BridgeHalfLen, BridgeWidth));

            // 冰拱两脚：冰柱顶埋进拱脚 0.8 m
            float footBottom = ArchTop - SizeOf(IceBridgeId).y;
            float spireH = footBottom + 0.8f - (BenchY - 0.2f);
            foreach (var c in new[] { SpireW, SpireE })
                Kit(PillarId, root, At(c, BenchY - 0.2f), c.x < 0 ? 20 : 200, new Vector3(1.4f, spireH / SizeOf(PillarId).y, 1.4f));
            IceHalf(root, "冰拱西半", -1, ArchTop, ArchHalfSpan, ArchWidth);
            IceHalf(root, "冰拱东半", 1, ArchTop, ArchHalfSpan, ArchWidth);
            archAim = new Vector3(0, ArchTop - 0.5f, BridgeZ);
            archEastAim = new Vector3(12, ArchTop - 0.5f, BridgeZ);

            // 冰棱：挂点 = 拱底（从桥面往上打射线量），尖离桥面 ≥ 3.4 m（跳起来碰不到头）
            Physics.SyncTransforms();
            var icicles = new GameObject("冰棱").transform;
            icicles.SetParent(world, false);
            var d = SizeOf(IcicleId);
            for (int i = 0; i < IcicleX.Length; i++)
            {
                float x = IcicleX[i], z = BridgeZ + (i % 2 == 0 ? -1.2f : 1.2f);
                float under = Physics.Raycast(new Vector3(x, BenchY + 0.5f, z), Vector3.up, out var up, 20f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)
                    ? up.point.y
                    : footBottom + (ArchTop - 2.5f - footBottom) * (1 - Mathf.Abs(x) / ArchHalfSpan);
                float rootY = under + 0.3f;
                float s = Mathf.Clamp((rootY - (BenchY + 3.4f)) / d.y, 0.6f, 1f);
                float tip = d.y * s;

                var go = new GameObject($"Icicle {i + 1}");
                go.transform.SetParent(icicles, false);
                go.transform.position = new Vector3(x, rootY, z);
                var dmg = go.AddComponent<SG.Damageable>();
                dmg.maxHealth = 45;
                dmg.displayName = "冰棱";
                dmg.noReward = true;
                var ic = go.AddComponent<SG.IcefallIcicle>();

                // 挂着的冰棱：外观 + 胶囊碰撞（子弹打得中）
                var hang = Kit(IcicleId, go.transform, new Vector3(x, rootY - tip, z), i * 67f, s);
                LevelKit.VisualOnly(hang);
                if (hang && !IsPlaceholder(hang))
                {
                    var cap = hang.AddComponent<CapsuleCollider>();
                    cap.direction = 1;
                    cap.center = new Vector3(0, d.y * 0.5f, 0);
                    cap.height = d.y;
                    cap.radius = 0.6f;
                }
                else if (hang) hang.AddComponent<BoxCollider>();
                if (hang) hang.name = "Hanging";

                // 落点：冰棱正下方的桥面
                float ground = Physics.Raycast(new Vector3(x, rootY - tip - 0.05f, z), Vector3.down, out var hit, 30f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)
                    ? hit.point.y
                    : BenchY;
                var fallen = new GameObject("Fallen");
                fallen.transform.SetParent(go.transform, false);
                fallen.transform.position = new Vector3(x, ground, z);
                Kit(ShardsId, fallen.transform, new Vector3(x, ground - 0.05f, z), i * 67f + 90, 1.8f);
                SG.IcefallIcicle.AddObstacle(fallen, new Vector3(2.8f, 1.8f, 2.2f));

                ic.hanging = hang ? hang.transform : null;
                ic.fallen = fallen;
                ic.groundY = ground;
                ic.tipDepth = tip;
                NonStatic(go);
                fallen.SetActive(false);
            }
        }

        /// <summary>
        /// ④ 断桥：W3 → E3 的栈道桥。西段桥面 33 m（W3），到 x = 6 断开；4 m 断口；东段残桥 34 m（E3，高 1 m）——要跳 + 冲刺。
        /// 走行面是两个显式碰撞盒，栈道直段 / 断头只做外观（断头朝断口，按碰撞体探哪头的桥面缺了）
        /// </summary>
        static void BuildBrokenBridge(Transform kit)
        {
            var root = new GameObject("④ 断桥").transform;
            root.SetParent(kit, false);
            LevelKit.DeckX("断桥西段桥面 Collision", root, BrokenX0, GapX0, BrokenZ, W3Y, BrokenWidth, 1.2f);
            LevelKit.DeckX("断桥东段残桥面 Collision", root, GapX1, BrokenX1, BrokenZ, E3Y, BrokenWidth, 1.2f);
            var front = Vector3.forward; // 栏杆朝北（冰瀑那边）
            PlankStraight(root, new Vector3(-16, W3Y, BrokenZ), Vector3.right, front, 8f);
            PlankStraight(root, new Vector3(-8, W3Y, BrokenZ), Vector3.right, front, 8f);
            PlankStraight(root, new Vector3(-1.5f, W3Y, BrokenZ), Vector3.right, front, 5f);
            PlankBroken(root, new Vector3(GapX0 - 2.5f, W3Y, BrokenZ), 1);
            PlankBroken(root, new Vector3(GapX1 + 2.5f, E3Y, BrokenZ), -1);
            PlankStraight(root, new Vector3(17.5f, E3Y, BrokenZ), Vector3.right, front, 5f);
        }

        /// <summary>一段栈道直段（外观）：center = 桥面中心（世界，顶面高度），axis = 沿路方向，front = 栏杆朝向，length = 长（米）</summary>
        static GameObject PlankStraight(Transform parent, Vector3 center, Vector3 axis, Vector3 front, float length)
        {
            var d = SizeOf(PlankId);
            var up = Vector3.Cross(axis, Vector3.Cross(Vector3.up, axis)).normalized;
            if (up.y < 0) up = -up;
            var z = (front - up * Vector3.Dot(front, up)).normalized;
            var rot = Quaternion.LookRotation(z, up);
            var scale = new Vector3(length / d.x, 1, PlankWidth / d.z);
            var go = Kit(PlankId, parent, center, 0, scale);
            if (!go) return null;
            if (!IsPlaceholder(go) && !RailingOnPlusZ(go, d)) rot = Quaternion.AngleAxis(180, up) * rot;
            Orient(go, center - up * (IsPlaceholder(go) ? d.y * 0.5f : PlankDeckLocal), rot, d.y);
            AlignTop(go, Vector3.zero, center.y + 0.03f);
            LevelKit.VisualOnly(go);
            return go;
        }

        /// <summary>栈道断头（外观）：snap = 断口朝 +X（1）还是 −X（−1）；断头朝向按碰撞体探（两头各打 5 根，打到桥面的根数少的那头是断口）</summary>
        static void PlankBroken(Transform parent, Vector3 center, int snap)
        {
            var d = SizeOf(BrokenId);
            var go = Kit(BrokenId, parent, center - Vector3.up * PlankDeckLocal, 0, new Vector3(1, 1, PlankWidth / d.z));
            if (!go) return;
            if (!IsPlaceholder(go))
            {
                float deck = center.y - PlankDeckLocal + 1.2f;
                int Hits(float x)
                {
                    int n = 0;
                    foreach (float z in new[] { -2.4f, -1.2f, 0f, 1.2f, 2.4f })
                    {
                        float y = LevelKit.ProbeY(go, new Vector3(x, 30, z));
                        if (!float.IsNaN(y) && y > deck) n++;
                    }
                    return n;
                }
                bool snapPlus = Hits(d.x * 0.42f) <= Hits(-d.x * 0.42f);
                if (snapPlus != snap > 0) go.transform.rotation = Quaternion.Euler(0, 180, 0);
                AlignTop(go, Vector3.zero, center.y + 0.03f);
            }
            LevelKit.VisualOnly(go);
        }

        /// <summary>栈道直段的栏杆在 +Z 一侧（沿长边两侧各探 4 处顶面，高的那侧是栏杆）</summary>
        static bool RailingOnPlusZ(GameObject go, Vector3 d)
        {
            float Side(float z)
            {
                float best = float.NegativeInfinity;
                foreach (float x in new[] { -3f, -1f, 1f, 3f })
                {
                    float y = LevelKit.ProbeY(go, new Vector3(x, 30, z));
                    if (!float.IsNaN(y)) best = Mathf.Max(best, y);
                }
                return best;
            }
            float plus = Side(d.z * 0.5f - 0.2f), minus = Side(-d.z * 0.5f + 0.2f);
            return float.IsNegativeInfinity(minus) || plus >= minus;
        }

        /// <summary>
        /// 一条倾斜栈道：走行面是显式碰撞盒（foot → top，宽 6 m，坡脚再往下埋 1.5 m，坡顶和台面齐平），栈道直段铺满全长（外观），
        /// 离地 ≥ 3 m 的地方每 10 m 一座撑架（留碰撞：栈道下面的柱子是实物）
        /// </summary>
        static void PlankRoad(Transform kit, string name, Vector2 foot, float footY, Vector2 top, float topY, Vector2 front)
        {
            var root = new GameObject(name).transform;
            root.SetParent(kit, false);
            var a = At(foot, footY);
            var b = At(top, topY);
            LevelKit.Deck($"{name} 栈道面 Collision", root, a, b, PlankWidth, PlankThick, 1.5f);
            float len = Vector3.Distance(a, b);
            var fwd = (b - a) / len;
            var front3 = new Vector3(front.x, 0, front.y);
            int n = Mathf.Max(1, Mathf.RoundToInt(len / 8f));
            float seg = len / n;
            for (int i = 0; i < n; i++) PlankStraight(root, a + fwd * (seg * (i + 0.5f)), fwd, front3, seg + 0.05f);

            // 撑架：宽边横跨栈道
            var flat = new Vector3(fwd.x, 0, fwd.z).normalized;
            var pd = SizeOf(PostId);
            for (float s = 5; s < len - 2; s += 10)
            {
                var c = a + fwd * s;
                float ground = ts.GroundY(c.x, c.z);
                float height = c.y - PlankThick - ground + 0.3f;
                if (height < 3f) continue;
                var post = Kit(PostId, root, new Vector3(c.x, ground - 0.3f, c.z), 0, new Vector3(PlankWidth / pd.x, height / pd.y, 1));
                Orient(post, new Vector3(c.x, ground - 0.3f, c.z), Quaternion.LookRotation(flat), height);
            }
        }

        /// <summary>② 两个石龛：贴东岸绝壁的龛形岩件（地面 2.4 m × 1.2 = 龛台面 13.2 m），正面朝西</summary>
        static void BuildNiches(Transform kit)
        {
            var d = SizeOf(NicheId);
            const float s = 1.2f;
            foreach (float z in new[] { 70f, 84f })
            {
                float wallX = 69f;
                // 龛顶有悬出的岩檐，从上往下探会先打到它：龛台面按 registry 的 2.4 m × 缩放摆，不探
                Kit(NicheId, kit, new Vector3(wallX - d.z * s * 0.5f, NicheY - PlankDeckLocal * s, z), -90, s);
            }
        }

        /// <summary>⑤ 冰潭：潭心冰岛上的开明兽、香炉，冰面上的冰块，环台上的石掩墙与冰灯</summary>
        static void BuildPool(Transform kit, Transform props)
        {
            var kaiming = Kit(KaimingId, kit, At(PoolC, IslandY - 0.1f), 180, 1.25f);
            kaimingAim = kaiming ? TopOf(kaiming, 2.5f) : At(PoolC, IslandY + 17f);
            Kit(OfferingsId, props, At(new Vector2(0, 243.5f), IslandY - 0.05f), 180, 1.2f);
            foreach (var (q, yaw) in new[] { (new Vector2(-12, 233), 20f), (new Vector2(12, 233), 110f), (new Vector2(-17, 259), 200f), (new Vector2(17, 259), 290f) })
                Kit(ShardsId, props, At(q, PoolY - 0.1f), yaw, 2.0f);
            // 环台：石掩墙（面朝冰潭）、冰灯（避开石阶、坡道、出口）
            foreach (var q in new[] { new Vector2(20, 266), new Vector2(-20, 266), new Vector2(-24, 236) })
            {
                var to = PoolC - q;
                Kit(CoverWallId, props, OnGround(q, -0.1f), Yaw(to), 1f);
            }
            foreach (float a in new[] { 35f, 145f, -35f, -145f })
            {
                var q = PoolC + 33f * new Vector2(Mathf.Cos(a * Mathf.Deg2Rad), Mathf.Sin(a * Mathf.Deg2Rad));
                Kit(LanternId, props, OnGround(q, -0.05f), a, 1.2f);
            }
        }

        /// <summary>④ 冰柱林：E3 上 9 根冰柱（避开断桥落脚处、冰台、R5 / R6、站位）</summary>
        static void BuildForest(Transform kit)
        {
            var spots = new[]
            {
                (new Vector2(28, 196), 1.1f), (new Vector2(34, 191), 1.25f), (new Vector2(43, 192), 1f), (new Vector2(47, 201), 1.2f), (new Vector2(56, 212), 1.3f),
                (new Vector2(36, 216), 1.15f), (new Vector2(30, 221), 1f), (new Vector2(52, 226), 1.25f), (new Vector2(58, 220), 1.1f),
            };
            int i = 0;
            foreach (var (q, s) in spots) Kit(PillarId, kit, OnGround(q, -0.3f), i++ * 53f, s);
            // ① 冰河上的两根冰柱
            Kit(PillarId, kit, OnGround(new Vector2(10, 46), -0.2f), 15, 1.2f);
            Kit(PillarId, kit, OnGround(new Vector2(-10, 100), -0.2f), 75, 1.35f);
        }

        /// <summary>① 冰河：冰面上的冰块（掩体）；出生碛丘的祈愿石；藏宝 A 的冻供</summary>
        static void BuildRiver(Transform props)
        {
            var blocks = new[] { (new Vector2(8, 82), 10f), (new Vector2(-12, 82), 80f), (new Vector2(16, 72), 150f), (new Vector2(2, 60), 220f), (new Vector2(-6, 108), 300f) };
            foreach (var (q, yaw) in blocks) Kit(ShardsId, props, OnGround(q, -0.1f), yaw, 2.2f);
            Kit(CairnId, props, OnGround(new Vector2(-8, 2), -0.05f), 30);
            Kit(CairnId, props, OnGround(new Vector2(9, -2), -0.05f), 200);
            Kit(HoardId, props, OnGround(new Vector2(0, 208.5f), -0.05f), 180, 1.1f);
        }

        /// <summary>② / ③ 台面陈设与掩体；藏宝 B 的冰封驿亭</summary>
        static void BuildTerraceProps(Transform props)
        {
            // ② 东岸低台
            Kit(CoverWallId, props, OnGround(new Vector2(50, 80), -0.1f), 90);
            Kit(CoverWallId, props, OnGround(new Vector2(36, 96), -0.1f), 70);
            Kit(BarricadeId, props, OnGround(new Vector2(54, 112), -0.05f), 100);
            Kit(CairnId, props, OnGround(new Vector2(40, 86), -0.05f), 15);
            Kit(CairnId, props, OnGround(new Vector2(52, 100), -0.05f), 160);
            // ③ 两岸桥头的石掩墙（面朝桥）
            foreach (var q in new[] { new Vector2(-22, 150), new Vector2(-22, 166), new Vector2(22, 150), new Vector2(22, 166) })
                Kit(CoverWallId, props, OnGround(q, -0.1f), q.x < 0 ? 90 : -90);
            // 藏宝 B · 冰封驿亭（贴中台陡坎，面朝东南的冰河）
            Kit(WayshrineId, props, OnGround(new Vector2(-33, 126), -0.1f), 150);
            Kit(TentId, props, OnGround(new Vector2(-24, 128), -0.1f), 200);
            Kit(OfferingsId, props, OnGround(new Vector2(-36, 120), -0.05f), 120);
        }

        /// <summary>崖壁片：只做外观（去掉碰撞，不给人搭出落脚点），正面朝里贴在绝壁脚</summary>
        static void BuildCliffs(Transform kit)
        {
            var root = new GameObject("崖壁片").transform;
            root.SetParent(kit, false);
            var d = SizeOf(CliffId);
            const float s = 1.2f;
            var panels = new[]
            {
                (new Vector2(69, 60), -90f, E1Y), (new Vector2(70.5f, 128), -90f, E1Y), (new Vector2(70.5f, 172), -90f, BenchY), (new Vector2(70.5f, 206), -90f, E3Y),
                (new Vector2(-48, 70), 90f, WtY), (new Vector2(-66.5f, 166), 90f, BenchY), (new Vector2(-66.5f, 204), 90f, W3Y),
                (new Vector2(-24.5f, 275), Yaw(PoolC - new Vector2(-24.5f, 275)), RingY), (new Vector2(24.5f, 275), Yaw(PoolC - new Vector2(24.5f, 275)), RingY),
            };
            foreach (var (q, yaw, y) in panels)
            {
                var fwd = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                var pos = At(q, y - 0.5f) - fwd * (d.z * s * 0.5f);
                var go = Kit(CliffId, root, pos, yaw, s);
                LevelKit.VisualOnly(go);
            }
        }

        /// <summary>冰面（L8 SurfaceZone 冰面预设）：① 冰河、z 118–140 收窄段、河槽、冰潭（圆）+ 溢口</summary>
        static void BuildIceZones(Transform world)
        {
            var root = new GameObject("冰面").transform;
            root.SetParent(world, false);
            void Box(string name, Vector2 c, Vector2 size, float top)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.SetPositionAndRotation(new Vector3(c.x, top - 0.5f, c.y), Quaternion.identity);
                go.transform.localScale = new Vector3(size.x, 1, size.y);
                var z = go.AddComponent<SG.SurfaceZone>();
                z.profile = SG.SurfaceProfile.Ice;
                z.area = SG.ZoneArea.Box();
                z.lifetime = 0;
            }
            Box("冰面 · ① 冰河", new Vector2(0, (RiverZ0 + 118) * 0.5f), new Vector2(30, 118 - RiverZ0), RiverY);
            Box("冰面 · 收窄段", new Vector2(0, 129), new Vector2(18, 22), RiverY);
            Box("冰面 · 河槽", new Vector2(0, (140 + RiverZ1) * 0.5f), new Vector2(12, RiverZ1 - 140), RiverY);
            Box("冰面 · 溢口", new Vector2(0, 225), new Vector2(28, 6), PoolY);
            var pool = new GameObject("冰面 · ⑤ 冰潭");
            pool.transform.SetParent(root, false);
            pool.transform.position = At(PoolC, PoolY);
            var pz = pool.AddComponent<SG.SurfaceZone>();
            pz.profile = SG.SurfaceProfile.Ice;
            pz.area = SG.ZoneArea.Disc(PoolR - 0.5f);
            pz.lifetime = 0;
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：碎冰、雪石避开坡道、冰面、桥头；雪松（带碰撞）只在台面中间——离崖壁 ≥ 8 m、离陡坎边 ≥ 4 m，场地中心 / 站位 / 坡道 / 栈道 / 藏宝以外
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            float RouteDist(Vector2 p) => Polyline(p, RouteLine).dist;
            float Keep(Vector2 p)
            {
                float k = Mathf.Max(PoolMask(p), Calm(p));
                foreach (var r in Ramps) k = Mathf.Max(k, 1 - Smooth(r.width * 0.5f, r.width * 0.5f + 3, Polyline(p, new[] { r.foot, r.top }).dist));
                foreach (var r in PlankRoads) k = Mathf.Max(k, 1 - Smooth(PlankWidth * 0.5f, PlankWidth * 0.5f + 3, Polyline(p, new[] { r.foot, r.top }).dist));
                return 1 - k;
            }
            var details = LevelKit.ScatterPresets.Details(theme.key);
            foreach (var r in details)
            {
                var w = r.where;
                r.where = pt => (w?.Invoke(pt) ?? 1) * Keep(pt.p);
            }
            LevelKit.ScatterDetails(ts, details, RouteDist, 1f, 160f);

            var trees = LevelKit.ScatterPresets.Boulders(theme.key);
            var tw = trees.where;
            var avoid = new List<(Vector2 c, float r)>
            {
                (Knoll, 16), (Site1, 30), (Site2, 10), (Site3, 30), (Site4, 12), (PoolC, 40), (Site6, 10), (CacheA, 10), (CacheB, 10), (ExitAt, 12),
                (SpireW, 8), (SpireE, 8), (new Vector2(0, BrokenZ), 24), (new Vector2(27, 208), 10),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            // 地标视线的地面投影两侧 6 m 不长树（雪松会挡住出生 → 冰瀑、台地 → 冰拱这些视线）
            var sights = new[]
            {
                new[] { Knoll, new Vector2(0, 222) }, new[] { new Vector2(0, 50), Site3 }, new[] { new Vector2(44, 100), new Vector2(12, BridgeZ) },
                new[] { new Vector2(20, BridgeZ), new Vector2(0, 222) }, new[] { new Vector2(58, 192), PoolC }, new[] { new Vector2(-14, 236), ExitAt },
            };
            trees.where = pt =>
            {
                var q = pt.p;
                if (Inside(q) < 8) return 0;
                // 只在台面中间：离本级台面边 ≥ 4 m（不长在陡坎边上，也不长在冰河里）
                if (IceBand(q) > 0.01f) return 0;
                bool onShelf = Shelves.Any(s => s.Inside(q) > 4) && !Shelves.Any(s => s.Inside(q) > -4 && s.Inside(q) < 4);
                if (!onShelf) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(q, c) < r) return 0;
                foreach (var line in sights)
                    if (Polyline(q, line).dist < 6) return 0;
                foreach (var r in Ramps)
                    if (Polyline(q, new[] { r.foot, r.top }).dist < r.width * 0.5f + 5) return 0;
                foreach (var r in PlankRoads)
                    if (Polyline(q, new[] { r.foot, r.top }).dist < PlankWidth * 0.5f + 5) return 0;
                return tw?.Invoke(pt) ?? 1;
            };
            float x0 = Envelope.Min(e => e.x), x1 = Envelope.Max(e => e.x), z0 = Envelope.Min(e => e.y), z1 = Envelope.Max(e => e.y);
            LevelKit.ScatterProps(ts, props, trees, Rect.MinMaxRect(x0, z0, x1, z1), 12f, RouteDist);
        }

        static void BuildMarkers(Transform root)
        {
            GameObject Mk(string name, Vector3 at)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = at;
                return go;
            }
            Mk("Site_Spawn", OnGround(Knoll));
            Mk("Site_1_IceRiver", OnGround(Site1));
            Mk("Site_2_EastTerrace", OnGround(Site2));
            Mk("Site_3_IceBridge", At(Site3, BenchY));
            Mk("Site_4_PillarForest", OnGround(Site4));
            Mk("Site_5_FrozenPool", OnGround(new Vector2(0, 236)));
            Mk("Site_6_CacheGuard", OnGround(Site6));
            Mk("Site_Exit", OnGround(ExitAt));
            foreach (var a in Anchors) Mk(a.name, AnchorPos(a.at));
            // 地标标记（冒烟测试看冰瀑、开明兽是否可见）、断桥两头的落脚点（冒烟测试跳 + 冲刺）
            Mk("Landmark_IcefallTop", icefallAim);
            Mk("Landmark_Kaiming", kaimingAim);
            Mk("DashGap_West", At(DashWest, W3Y));
            Mk("DashGap_East", At(DashEast, E3Y));

            // 三青鸟的栖落点（PerchPoint）：从上往下打射线落在面上
            Physics.SyncTransforms();
            int perch = 0;
            void Perch(Vector2 q, float fromY, float minY)
            {
                if (!Physics.Raycast(At(q, fromY), Vector3.down, out var hit, fromY - minY + 1, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore) || hit.point.y < minY) return;
                var go = Mk($"PerchPoint_{++perch}", hit.point);
                go.AddComponent<SG.PerchPoint>();
            }
            Perch(new Vector2(0, BridgeZ), ArchTop + 6, ArchTop - 3);
            Perch(new Vector2(-17, BridgeZ), ArchTop + 6, ArchTop - 4);
            Perch(new Vector2(17, BridgeZ), ArchTop + 6, ArchTop - 4);
            Perch(new Vector2(kaimingAim.x, kaimingAim.z), kaimingAim.y + 6, IslandY + 8);
            Perch(ExitAt, RingY + 20, RingY + 5);
            Perch(new Vector2(-9, 214), 22, 6);
            Perch(new Vector2(9, 214), 22, 6);
            Perch(new Vector2(36, 216), E3Y + 12, E3Y + 2);
            Perch(new Vector2(56, 212), E3Y + 12, E3Y + 2);
            Perch(new Vector2(66, 70), NicheY + 14, NicheY + 3);
            Perch(new Vector2(66, 84), NicheY + 14, NicheY + 3);
            Perch(new Vector2(-10, 100), 12, 2);

            // 雪狌狌的上行攀爬连线（导航区域 29，只有会爬的走；PackCoordinator.ClimbArea）：两个石龛、冰台的坎
            var links = new GameObject("Climb Links").transform;
            links.SetParent(root, false);
            void Climb(string name, Vector3 from, Vector3 to)
            {
                var go = new GameObject(name);
                go.transform.SetParent(links, false);
                go.transform.position = from;
                var l = go.AddComponent<NavMeshLink>();
                l.agentTypeID = 0;
                l.startPoint = Vector3.zero;
                l.endPoint = to - from;
                l.width = 3f;
                l.bidirectional = false;
                l.area = SG.PackCoordinator.ClimbArea;
                l.autoUpdate = false;
            }
            Climb("Climb · 南龛", new Vector3(55f, E1Y, 70), new Vector3(58.2f, NicheY, 70));
            Climb("Climb · 北龛", new Vector3(55f, E1Y, 84), new Vector3(58.2f, NicheY, 84));
            Climb("Climb · 冰台", new Vector3(20.6f, E3Y, 208), new Vector3(23.6f, DaisY, 208));
        }

        /// <summary>站位贴地（栈道上的站位贴栈道面、桥上的贴桥面：从上往下打射线）</summary>
        static Vector3 AnchorPos(Vector2 q)
        {
            Physics.SyncTransforms();
            var g = OnGround(q);
            return Physics.Raycast(At(q, g.y + 25), Vector3.down, out var hit, 40, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore) && hit.point.y > g.y
                ? hit.point
                : g;
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/2-1.md §5，遭遇框架 v2）：五个必清场地任意顺序，⑥ 是藏宝 B 的守军（可选、不自动触发）。
        /// 难度由 RunPlan 给（2-1 = 1.80），场地不写死。站位标记挂 SpawnAnchor（<see cref="Anchors"/>）。
        /// </summary>
        static SG.LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            SG.EncounterSite Site(int index, string title, Vector3 at, float trigger, float arena, SG.EncounterSpec spec, string reward, Vector3 chestOffset)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<SG.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = at;
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
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
            SG.EncounterSpec Far(SG.EncounterSpec s, float max)
            {
                s.maxPlayerDistance = max;
                return s;
            }

            var s1 = Site(1, "冰河", OnGround(Site1), 24, 32, Far(SG.EncounterSpec.Of(
                    Wave("冰河伏击", E(Jiaoren, 4), E(Qingniao, 1)).Hint("冻鲛人贴着冰面滑过来——冰上急停会打滑，退到砾石洲上打"),
                    Wave("豪彘冲阵", E(Haozhi, 2), E(Jiaoren, 1), E(Qingniao, 1)).After(1, 1.6f).Hint("冰棘豪彘在冰上刹不住——侧身让开，它会滑倒"))
                .Gather(0.4f), 42), "weapon", new Vector3(0, 0, -10));
            var s2 = Site(2, "东岸台地", OnGround(Site2), 22, 28, Far(SG.EncounterSpec.Of(
                    Wave("栈道冷箭", E(Fuzhu, 2), E(Xingxing, 3)).Hint("夫诸在栈道和石龛上——雪狌狌会翻上石龛，高处不是安全区"),
                    Wave("狐巫结阵", E(FoxWitch, 1), E(Xingxing, 2), E(Puffer, 1)).After(1, 2f).Hint("先打九尾狐巫，她的冰壁会挡子弹"))
                .Gather(0.6f), 40), "scroll", Vector3.zero);
            var s3 = Site(3, "冰桥", At(Site3, BenchY), 24, 32, Far(SG.EncounterSpec.Of(
                    Wave("桥头夹击", E(XuanGui, 1), E(Jiaoren, 3), E(Qingniao, 1)).Hint("旋龟从对岸冲上桥——射落头顶的冰棱砸它，碎冰就是掩体"),
                    Wave("两端合围", E(FrostCrab, 1), E(Jiaoren, 2).As(SG.StationRole.Flank), E(Jelly, 1)).After(1, 2f)
                        .Hint("身后的桥头也来了敌人——冰拱脚和碎冰堆能挡"))
                .Gather(0.8f), 48), "weapon:min=1", Vector3.zero);
            var s4 = Site(4, "冰柱林", OnGround(Site4), 32, 30, Far(SG.EncounterSpec.Of(
                    Wave("冰柱林", E(FoxWitch, 1), E(Xingxing, 3), E(Jelly, 1)).Hint("断桥要跳起来再冲刺——冰台上的狐巫在等你落地"),
                    Wave("冰河豚群", E(Haozhi, 2), E(Puffer, 2), E(Fuzhu, 1)).After(1, 2f).Hint("冰河豚会撞上来自爆——在冰柱之间绕"))
                .Gather(0.6f).Elites(1, "frenzied"), 40), "upgrade", new Vector3(6, 0, -2));
            var s5 = Site(5, "瀑顶冰潭", OnGround(new Vector2(0, 236)), 28, 34, Far(SG.EncounterSpec.Of(
                    Wave("冰潭守望", E(IceWhale, 1), E(Jiaoren, 4), E(Qingniao, 1)).Hint("冰鲸在环台上架炮——冰面会让你滑，站上石阶打"),
                    Wave("开明之前", E(FrostCrab, 1).Elite("shielded"), E(Fuzhu, 1), E(Xingxing, 2), E(Jelly, 1)).After(1, 2f)
                        .Hint("精英玄冰巨蟹带护盾——先打灯水母"))
                .Gather(1.5f), 40), "scroll:min=1", Vector3.zero);
            var s6 = Site(6, "驿亭守军", OnGround(Site6), 14, 16, SG.EncounterSpec.Of(
                    Wave("驿亭守军", E(Jiaoren, 2), E(Fuzhu, 1).Elite("swift"), E(Haozhi, 1)))
                .Gather(0.4f), "", Vector3.zero);
            s6.autoTrigger = false;
            s6.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<SG.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "登上瀑顶冰潭";
            objective.required = new[] { s1, s2, s3, s4, s5 };
            objective.optional = new[] { s6 };
            objective.autoCollect = false;

            // 藏宝：A 在谷底河槽尽头的冰瀑脚下（直接给），B 是西岸低台北端的冰封驿亭（惊动 ⑥ 守军，肃清后给灵兽封印）
            SG.CachePOI Cache(string name, string title, Vector2 at, Vector2 from, string reward, SG.EncounterSite guard, float discover)
            {
                var c = new GameObject(name).AddComponent<SG.CachePOI>();
                c.transform.SetParent(root, false);
                var face = (from - at).normalized;
                c.transform.SetPositionAndRotation(OnGround(at), Quaternion.LookRotation(new Vector3(face.x, 0, face.y)));
                c.title = title;
                c.reward = reward;
                c.guard = guard;
                c.discoverRadius = discover;
                return c;
            }
            Cache("Cache A · 冰瀑下的冻供", "冰瀑下的冻供", CacheA, new Vector2(0, 176), "coins", null, 12);
            Cache("Cache B · 冰封驿亭", "冰封驿亭", CacheB, Site6, "pet", s6, 12);
            return objective;
        }

        /// <summary>出口传送门：嵌在出口祭坛正面（没有祭坛模型时自己立石门框），关卡目标完成后升起、落清关宝箱</summary>
        static void BuildExit(GameObject shrine, SG.LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<SG.ExitPortal>();
            var face = shrine ? shrine.transform.forward : Vector3.back;
            face.y = 0;
            face.Normalize();
            var at = new Vector2(ExitAt.x + face.x * 1.2f, ExitAt.y + face.z * 1.2f);
            portal.transform.SetPositionAndRotation(OnGround(at), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；顺带核对冰面、冰棱、藏宝、出口，并重新生成 GameDatabase（同 1-1）</summary>
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
            int sites = Count<SG.EncounterSite>(), ice = Count<SG.SurfaceZone>(), icicles = Count<SG.IcefallIcicle>(), caches = Count<SG.CachePOI>(),
                portals = Count<SG.ExitPortal>(), perches = Count<SG.PerchPoint>(), links = Count<NavMeshLink>();
            rep.Line($"遭遇场地 {sites}（必清 5 + 可选 1），冰面区域 {ice}，冰棱 {icicles}，藏宝 {caches}，出口 {portals}，栖落点 {perches}，攀爬连线 {links}");
            if (sites != 6) rep.Fail($"遭遇场地有 {sites} 个（应为 6）");
            if (ice < 4) rep.Fail($"冰面区域只有 {ice} 块（① 冰河、河槽、冰潭至少 4 块）");
            if (icicles != IcicleX.Length) rep.Fail($"冰棱有 {icicles} 根（应为 {IcicleX.Length}）");
            if (caches != 2) rep.Fail($"藏宝有 {caches} 处（应为 2）");
            if (portals != 1) rep.Fail($"出口传送门有 {portals} 个（应为 1）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线路点（含西岸低台、石龛、栈道中段、两个桥头、冰桥、断桥西段、冰台、环台）、坡道坡度、6 条地标视线、
        /// 场地尺寸 / 掩体 / 层数阈值。可玩区遮罩与软边界同一个；界外是 34–72 m 的连续绝壁，防越界由地形保证。
        /// 断桥不在主线上（NavMesh 过不去断口，④ 冰柱林的路点从断桥西段绕环台过去）。站位、宝箱落点、藏宝、出口、占位件由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec()
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec Site(string name, Vector3 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = c, size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var spec = new LevelSpec
                {
                    id = "2-1", title = "冰瀑栈道", playerSpawn = G(Knoll), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        Site("出生·冰河尾碛丘（缓冲）", G(Knoll), 30, combat: false),
                        Site("① 冰河", G(Site1), 56, cover: 4, layers: 3, overlook: true),
                        Site("② 东岸台地", G(Site2), 50, cover: 4, layers: 3, overlook: true),
                        Site("③ 冰桥", At(Site3, BenchY), 50, cover: 3, layers: 2, overlook: true),
                        Site("④ 冰柱林", G(Site4), 44, cover: 4, layers: 3, overlook: true),
                        Site("⑤ 瀑顶冰潭", G(new Vector2(0, 240)), 64, cover: 4, layers: 3, overlook: true),
                    },
                }
                .Route("出生·碛丘", G(Knoll)).Route("① 冰河", G(new Vector2(0, 62))).Route("① 西岸低台", G(new Vector2(-33, 80)))
                .Route("② 东岸台地", G(Site2)).Route("② 南龛", G(new Vector2(61, 70))).Route("② 栈道中段", AnchorPos(new Vector2(64, 120)))
                .Route("③ 东桥头", G(new Vector2(30, 160))).Route("③ 冰桥", At(Site3, BenchY)).Route("③ 西桥头", G(new Vector2(-30, 164)))
                .Route("④ 西岸上台", G(new Vector2(-40, 200))).Route("④ 断桥西段", At(new Vector2(-8, BrokenZ), W3Y))
                .Route("④ 冰柱林", G(new Vector2(40, 204))).Route("④ 冰台", G(new Vector2(27, 208)))
                .Route("⑤ 环台", G(new Vector2(-24, 262))).Route("⑤ 冰潭", G(new Vector2(0, 236))).Route("出口", G(new Vector2(0, 275)))
                .Sight("出生 → 冰瀑", G(Knoll, 1.62f), icefallAim, 6, IcefallTopId)
                .Sight("① 冰河 → 冰拱", G(new Vector2(0, 50), 1.62f), archAim, 6, IceBridgeId)
                .Sight("② 东岸台地 → 冰拱", G(new Vector2(44, 100), 1.62f), archEastAim, 6, IceBridgeId)
                .Sight("③ 东桥头 → 冰瀑", At(new Vector2(20, BridgeZ), BenchY + 1.62f), icefallAim, 6, IcefallTopId)
                .Sight("④ 东栈道口 → 开明兽", G(new Vector2(58, 192), 1.62f), kaimingAim, 6, KaimingId)
                .Sight("⑤ 冰潭 → 出口祭坛", G(new Vector2(-14, 236), 1.62f), shrineAim, 6, ShrineId);
            spec.slopePaths.Add(new SlopePath { name = "出生碛丘", points = new[] { Knoll, new Vector2(0, 30) } });
            foreach (var r in Ramps) spec.slopePaths.Add(new SlopePath { name = r.name, points = new[] { r.foot, r.top } });
            return spec;
        }
    }
}
