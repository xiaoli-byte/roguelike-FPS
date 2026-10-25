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
    /// 2-3 瑶池冰湖（docs/level-design/maps/2-3.md；docs/unity-parity.md M23、D3 / D27；Three.js V2 frost-3-v2 只取教学点）：
    /// 西王母的瑶池冻成一整片椭圆冰面（168 × 116 m），四面是昆仑雪岭。关卡坐标 = 世界 XZ（米，x 东、z 北），冰面 y = 0。
    ///
    ///   出生·南岸栈桥 (0, −88) → 踏上冰面 → A 湖心冰光 (0, −10)：湖心亭白玉台（+3.2 m，东西两坡）与南北两座小岛是冰面上仅有的高处
    ///   → B 西岸祭坛 (−104, 4)：岸上 +3 m 的祭坛台（东坡、北坡）；C 东岸船坞 (96, −6)：两条码头伸进冰面、冻船湾、+2.8 m 船屋台——B / C 顺序自选
    ///   → 两岸都肃清后 D 瑶台 (0, 78) 才有守军：半圆台 +4.2 m、一层玉阶 +1.6、二层玉阶 +3.6（出口祭坛在上面）。
    /// A / B / C 必清、顺序不限，D 写 requires = { B, C }（D27：开放图任意顺序）。藏宝：西北湖面的冻船（惊动伏兵，可选场地）、东南岸的渔营（无守军）。
    ///
    /// 动态环境是冰面（L8）：整片湖按行切成长条 SurfaceZone（<see cref="LevelKit.IceSheet"/>），冲刺余速在冰上滑出约 8 m；
    /// 两处冰窟窿和三个冰钓窟窿是开放水面（WaterVolume，涉水减速，能拿来刹车），大冰窟窿围一圈冰窟边缘段（掩体 + 预警）。
    /// 边界（D14，没有空气墙）：游玩区是一个起伏的椭圆，界外 8–13 m 内陡升成 16–30 m 的雪崖（崖面切几级够不着的窄雪台），边界外 2 m 起就叠雪峰——
    /// 比任何能站的面高 10 m 以上，L5 防越界由地形保证；
    /// 软边界（风雪推回、白化）沿同一个遮罩只做兜底。场景只放环境和标记（D17 / L1）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 2-3 瑶池冰湖（或 bridge.sh level 2-3）。冒烟：bridge.sh playtest map-2-3（Map23Suite）。
    /// </summary>
    [LevelBuilder("2-3", ScenePath)]
    public static class Level_2_3
    {
        public const string Dir = "Assets/Levels/L2_3_Yaochi";
        public const string ScenePath = "Assets/Scenes/L2_3_Yaochi.unity";
        const string Name = "L2_3";

        // 高度场里 Base 米 = 世界 y 0（冰面）；地形外缘落到远景地面 FarY。最高处 ≈ 岸 5 + 崖 30 + 雪峰 36 + Base 14 = 85 m，留余量不削峰顶
        const float Base = 14f, HeightRange = 100f, FarY = -3f;
        static readonly Vector2 Origin = new(-256, -256), Size = new(512, 512);
        /// <summary>雾（主题默认 25 / 210 m）：调远，出生点看 190 m 外的瑶台还剩轮廓</summary>
        const float FogStart = 50f, FogEnd = 340f;
        /// <summary>盛行风（风吹去的方向）：北冥方向来的北风，往南吹</summary>
        static readonly Vector2 Wind = new Vector2(0.25f, -1f).normalized;

        /// <summary>软边界（L3）：主题 Frost（风雪白化），等值线在崖面上，26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = FrostBounds();

        static LevelKit.BoundarySpec FrostBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Frost";
            return b;
        }

        // ───────────── 冰湖与游玩区 ─────────────
        const float LakeY = 0f, LakeShoreWidth = 12f, LakeIrregular = 0.06f;
        const int LakeSeed = 23;
        static readonly Vector2 LakeC = new(0, 0), LakeR = new(84, 58);
        /// <summary>游玩区椭圆（外面是连续雪崖），半径起伏 ±4%（不是一圈圆规画的看台）</summary>
        static readonly Vector2 EnvC = new(0, 4), EnvR = new(146, 108);
        const float EnvIrregular = 0.04f;
        static readonly Vector2[] Envelope = BuildEnvelope();

        // ── 雪岭（界外）：坡脚碎石坡 → 崖面 → 窄雪台 → 雪峰 ──
        /// <summary>坡脚内侧碎石坡：高、宽（米，能走）</summary>
        const float RimApron = 0.9f, RimApronWidth = 3f;
        /// <summary>崖高（坡脚以上）与崖面宽（界外米数）的范围：低频噪声在两端之间变</summary>
        const float CliffMin = 16f, CliffMax = 30f, FaceMin = 8f, FaceMax = 13f;
        /// <summary>崖面的沟：崖面宽按中频噪声最多放宽 FaceGully（坡脚不动，崖面上部往后退；只放宽不收窄，陡坎不会窄过高度格）</summary>
        const float FaceGully = 0.45f;
        /// <summary>
        /// 窄雪台：坡脚以上 LedgeFirst 米起每 LedgeStep 米一级（都比二段跳 2.7 m 高得多），陡坎占一级的比例在两值之间变（台面宽窄不一）。
        /// 陡坎水平宽要 ≥ 1 m（两个 0.5 m 高度格），不然网格在斜着走的坎上会锯齿成一排尖刺。
        /// 第一级的高度沿边界在 LedgeFirst … LedgeFirst + LedgePhase 之间慢慢漂，雪台只出现在约一半的崖段（不是一圈圈同心的看台）
        /// </summary>
        const float LedgeFirst = 6f, LedgePhase = 2f, LedgeStep = 5.5f, LedgeRiserMin = 0.55f, LedgeRiserMax = 0.7f;
        /// <summary>雪峰：边界外 PeakStart 米起、PeakRun 米内升满，再高 PeakMin–PeakMax 米（山脊噪声）</summary>
        const float PeakStart = 2f, PeakRun = 40f, PeakMin = 6f, PeakMax = 36f;

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = new(0, -88), SiteA = new(0, -10), SiteB = new(-104, 4), SiteC = new(96, -6), SiteD = new(0, 78), SiteG = new(-44, 18);
        const float SpawnPadR = 10f;

        // ── 栈桥（出生）与码头（C）：只填不挖的路堤 ──
        static readonly Vector2 PierRoot = new(0, -74), PierTip = new(0, -46);
        const float PierHalf = 3f, PierTipY = 1.2f, JettyEdge = 0.8f;
        static readonly (Vector2 root, Vector2 tip)[] Jetties = { (new Vector2(98, -22), new Vector2(70, -22)), (new Vector2(100, 16), new Vector2(74, 16)) };
        const float JettyHalf = 2.5f, JettyTipY = 1.3f;

        // ── A 湖心：白玉台（圆）+ 湖心亭 + 两座小岛 ──
        static readonly Vector2 PavC = new(0, 8);
        /// <summary>白玉台半径、侧壁宽、台面高；湖心亭 ×1.4（ch2-kit 建议），底在冰面下 0.2 m，自带台基被白玉台包住</summary>
        const float PavR = 11f, PavEdge = 1.2f, PavY = 3.2f, PavScale = 1.4f, PavBase = -0.2f, PavHeight = 11f;
        /// <summary>白玉台台沿的挡土墙：墙心半径、每段的方位间隔（度，东西两道坡处留口）、横 / 纵缩放（栏板高出台面约 1 m）、底埋进冰面的米数</summary>
        const float PavWallR = 11.8f, PavWallStep = 30f, PavWallSx = 0.9f, PavWallSy = 0.69f, PavWallSink = 0.3f;
        /// <summary>小岛：中心、半径、高出冰面、噪声种子（北小岛、南小岛）</summary>
        static readonly (Vector2 c, float r, float h, int seed)[] Islets = { (new Vector2(24, 26), 6f, 1.7f, 31), (new Vector2(-26, -14), 5.5f, 1.5f, 32) };

        /// <summary>冰窟窿（圆心、半径、碗底在冰面下几米）：前两处是大冰窟窿（围冰窟边缘），后三处是渔营外的冰钓窟窿</summary>
        static readonly (Vector2 c, float r, float depth)[] Holes =
        {
            (new Vector2(48, -12), 4.2f, 1f), (new Vector2(-52, -26), 3.6f, 1f),
            (new Vector2(52, -38), 1.2f, 0.9f), (new Vector2(45, -33), 1.1f, 0.9f), (new Vector2(57, -31), 1.0f, 0.9f),
        };
        const int LeadHoles = 2;
        const float HoleRimSlope = 1.6f, HoleDrop = 0.08f;

        // ── B 西岸祭坛台 ──
        static readonly Vector2 StageC = new(-121, 4), StageHalf = new(6, 9);
        const float StageRise = 3f, StageEdge = 1f;

        // ── C 船屋台 ──
        static readonly Vector2 BoatC = new(124, 6), BoatHalf = new(7, 6);
        const float BoatRise = 2.8f, BoatEdge = 0.9f;
        /// <summary>东岸灯塔（离崖 ≥ 8 m，椭圆起伏加大后往里挪）</summary>
        static readonly Vector2 LighthouseAt = new(118, -28);

        // ── D 瑶台：半圆台（平边朝南、对着湖）+ 两层玉阶 ──
        static readonly Vector2 YaoC = new(0, 68);
        /// <summary>半圆台半径、台面高、前沿侧壁宽（陡）、两翼与后沿的缓坡宽</summary>
        const float YaoR = 34f, YaoY = 4.2f, YaoEdge = 0.9f, YaoFlank = 7f;
        static readonly Vector2 Dais1C = new(0, 90), Dais1Half = new(18, 7), Dais2C = new(0, 94), Dais2Half = new(9, 4.5f);
        const float Dais1Y = YaoY + 1.6f, Dais2Y = YaoY + 3.6f, DaisEdge = 0.9f;
        static readonly Vector2 ShrineAt = new(0, 96.6f);
        static readonly Vector2[] TowerAt = { new(-27, 93), new(27, 93) };

        // ── 藏宝 ──
        static readonly Vector2 JunkC = new(-52, 30), JunkPoi = new(-45, 23), CampPoi = new(68, -57);
        const float JunkYaw = 70f, JunkBase = -1.4f;

        // ── 冒烟测试的探针（Map23Suite）──
        /// <summary>冰面滑行起点（往 +x 滑 16 m 都是空冰）、岸上对照起点（出生平台，往 +x）</summary>
        static readonly Vector2 IceProbe = new(-40, -40), LandProbe = new(-6, -92);

        // ───────────── 派生高度（不含噪声的地面，见 Land0）─────────────
        static readonly float SpawnY = Land0(Spawn), PierRootY = Land0(PierRoot);
        static readonly float StageY = Land0(StageC) + StageRise, BoatY = Land0(BoatC) + BoatRise;
        static readonly float[] JettyRootY = Jetties.Select(j => Land0(j.root)).ToArray();

        /// <summary>坡道（脚 → 顶，宽，两端的世界 y）：只填不挖，剖面同 1-2</summary>
        static readonly (string name, Vector2 foot, Vector2 top, float width, float footY, float topY)[] Ramps = BuildRamps();

        static (string, Vector2, Vector2, float, float, float)[] BuildRamps() => new[]
        {
            ("栈桥头坡道", new Vector2(0, -34.5f), new Vector2(0, -43.2f), 5f, LakeY, PierTipY), // 顶压在桥头圆端（半宽 3 m）里，不在圆端边上留陡坎
            ("湖心亭西坡", new Vector2(-25, 8), new Vector2(-10.2f, 8), 5f, LakeY, PavY),
            ("湖心亭东坡", new Vector2(25, 8), new Vector2(10.2f, 8), 5f, LakeY, PavY),
            ("北小岛雪坡", new Vector2(14.45f, 16.45f), new Vector2(20.8f, 22.8f), 4f, LakeY, LakeY + Islets[0].h),
            ("南小岛雪坡", new Vector2(-12.8f, -14), new Vector2(-21.8f, -14), 4f, LakeY, LakeY + Islets[1].h),
            ("祭坛台东坡", new Vector2(-102, 4), new Vector2(-115.6f, 4), 5f, Land0(new Vector2(-102, 4)), StageY),
            ("祭坛台北坡", new Vector2(-121, 27), new Vector2(-121, 13.6f), 4.5f, Land0(new Vector2(-121, 27)), StageY),
            ("船屋台南坡", new Vector2(124, -15), new Vector2(124, -0.6f), 5f, Land0(new Vector2(124, -15)), BoatY),
            ("船屋台西坡", new Vector2(104, 6), new Vector2(117.6f, 6), 5f, Land0(new Vector2(104, 6)), BoatY),
            ("瑶台正中坡", new Vector2(0, 53), new Vector2(0, 68.6f), 6f, Land0(new Vector2(0, 53)), YaoY),
            ("瑶台西坡", new Vector2(-22, 54), new Vector2(-22, 68.6f), 4.5f, Land0(new Vector2(-22, 54)), YaoY),
            ("瑶台东坡", new Vector2(22, 54), new Vector2(22, 68.6f), 4.5f, Land0(new Vector2(22, 54)), YaoY),
            ("一层玉阶西坡", new Vector2(-14, 75.5f), new Vector2(-14, 83.4f), 4f, YaoY, Dais1Y),
            ("一层玉阶东坡", new Vector2(14, 75.5f), new Vector2(14, 83.4f), 4f, YaoY, Dais1Y),
            ("二层玉阶西坡", new Vector2(-17, 93), new Vector2(-9.4f, 93), 3.5f, Dais1Y, Dais2Y),
            ("二层玉阶东坡", new Vector2(17, 93), new Vector2(9.4f, 93), 3.5f, Dais1Y, Dais2Y),
        };

        // ── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深；取发布后的包围盒）──
        const string PavilionId = "SM_Tripo_FrostLakePavilion", JunkId = "SM_Tripo_FrostSeaJunk", SkiffId = "SM_Env_FrozenSkiff",
            ShardsId = "SM_Tripo_FrostIcicleShards", MastRuinId = "SM_Tripo_FrostSeaMastRuin", DeckId = "SM_Env_TravelDeck",
            WayshrineId = "SM_Env_FrostWayshrine", JadeWallId = "SM_Tripo_FrostJadeRetainingWall", LighthouseId = "SM_Tripo_FrostSeaLighthouse",
            ShrineId = "SM_Tripo_FrostPortalShrine", TowerId = "SM_Tripo_FrostCornerTower", ColumnId = "SM_Tripo_FrostColumn",
            LanternId = "SM_Tripo_FrostIceLantern", BoneLanternId = "SM_Tripo_FrostSeaBoneLantern", FishRackId = "SM_Tripo_FrostSeaFishRack",
            YurtId = "SM_Tripo_FrostSeaYurt", PearlHoardId = "SM_Tripo_FrostSeaPearlHoard", JadeHoardId = "SM_Tripo_FrostJadeHoard",
            PineId = "SM_Env_FrostPine";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [PavilionId] = new(8.42f, 11f, 8.12f), [JunkId] = new(5.82f, 15.33f, 9.74f), [SkiffId] = new(2.03f, 1.54f, 3.85f),
            [ShardsId] = new(1.68f, 1f, 1.23f), [MastRuinId] = new(2.16f, 1.58f, 1.19f), [DeckId] = new(5.52f, 0.73f, 3.88f),
            [WayshrineId] = new(4.19f, 4.84f, 3.3f), [JadeWallId] = new(7.02f, 6.5f, 2.26f), [LighthouseId] = new(6.18f, 12.78f, 5.81f),
            [ShrineId] = new(10.46f, 10.93f, 2.94f), [TowerId] = new(6.7f, 13.15f, 5.58f), [ColumnId] = new(1.77f, 4.91f, 1.64f),
            [LanternId] = new(0.9f, 2.36f, 0.89f), [BoneLanternId] = new(1f, 2.36f, 0.72f), [FishRackId] = new(1.41f, 1.54f, 0.73f),
            [YurtId] = new(3.16f, 3.42f, 3.09f), [PearlHoardId] = new(1.83f, 1.72f, 1.29f), [JadeHoardId] = new(2.82f, 1.72f, 1.67f),
            [PineId] = new(2.62f, 4.53f, 2.18f),
            ["SM_Tripo_FrostOfferings"] = new(1.74f, 1.54f, 1.3f), ["SM_Prop_FrostPrayerCairn"] = new(1.05f, 1.97f, 0.72f),
            ["SM_Prop_FrostShrine"] = new(0.94f, 1.91f, 0.93f), ["SM_Tripo_FrostColumnRuin"] = new(4.08f, 1.58f, 2.1f),
            ["SM_Tripo_FrostCoverWall"] = new(5.57f, 2.47f, 1.49f),
        };

        // ── 第二章 V2 阵容 ──
        const string Fuzhu = "fuzhu", Jelly = "lantern_jelly", Haozhi = "haozhi", Jiaoren = "jiaoren", Qingniao = "qingniao", Puffer = "ice_puffer",
            Xingxing = "xingxing", Crab = "frost_crab", Fox = "fox_witch", XuanGui = "xuangui";

        /// <summary>
        /// 刷怪站位（标记名、场地键、位置、角色、lane、高台、散开半径）。lane 0 = 正面（湖心亭方向 / 台上），1 = 东或南翼，2 = 西或北翼。
        /// 高台站位只给会飞的（冰灯水母、冰河豚、三青鸟）；贴地的远程站在坡道走得上去的高处（祭坛台、船屋台、二层玉阶）。
        /// 全部离道具 ≥ 2.5 m，C / D 的站位放得下精英玄冰巨蟹 / 精英旋龟（半径 1.9 m）。
        /// </summary>
        static readonly (string name, string site, Vector2 at, StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_A_Precision_E", "A", new Vector2(26, 2), StationRole.Precision, 1, false, 1.8f),
            ("Enemy_A_Precision_W", "A", new Vector2(-28, 0), StationRole.Precision, 2, false, 1.8f),
            ("Enemy_A_Support_Air", "A", new Vector2(-8, -8), StationRole.Support, 0, true, 1.5f),
            ("Enemy_A_Ranged_Air", "A", new Vector2(14, 24), StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_A_Assault_E", "A", new Vector2(36, -6), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_A_Assault_W", "A", new Vector2(-38, -22), StationRole.Assault, 2, false, 2.2f),
            ("Enemy_A_Flank_SE", "A", new Vector2(22, -32), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_A_Flank_SW", "A", new Vector2(-22, -34), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_B_Stage_Ranged", "B", new Vector2(-119, 10), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_B_Stage_Precision", "B", new Vector2(-119, -2), StationRole.Precision, 0, false, 1.2f),
            ("Enemy_B_Lake_N", "B", new Vector2(-86, 22), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_B_Lake_S", "B", new Vector2(-86, -16), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_B_Shore_N", "B", new Vector2(-106, 26), StationRole.Assault, 2, false, 2.2f),
            ("Enemy_B_Shore_S", "B", new Vector2(-108, -18), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_B_Air", "B", new Vector2(-96, 22), StationRole.Flank, 2, true, 1.5f),
            ("Enemy_C_Assault_Dock", "C", new Vector2(108, -6), StationRole.Assault, 0, false, 2.2f),
            ("Enemy_C_Precision_Roof", "C", new Vector2(126, 6), StationRole.Precision, 0, false, 1.2f),
            ("Enemy_C_Flank_S", "C", new Vector2(84, -34), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_C_Flank_N", "C", new Vector2(90, 28), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_C_Support_Air", "C", new Vector2(114, -20), StationRole.Support, 1, true, 1.5f),
            ("Enemy_C_Ranged_Air", "C", new Vector2(78, -3), StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_D_Support_W", "D", new Vector2(-14, 87), StationRole.Support, 2, false, 1.2f),
            ("Enemy_D_Support_E", "D", new Vector2(14, 87), StationRole.Support, 1, false, 1.2f),
            ("Enemy_D_Precision_Top", "D", new Vector2(-5, 91.5f), StationRole.Precision, 0, false, 1f),
            ("Enemy_D_Assault_W", "D", new Vector2(-22, 76), StationRole.Assault, 2, false, 2.2f),
            ("Enemy_D_Assault_E", "D", new Vector2(22, 76), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_D_Flank_W", "D", new Vector2(-30, 84), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_D_Flank_E", "D", new Vector2(30, 84), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_D_Air", "D", new Vector2(0, 64), StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_G_Flank_A", "G", new Vector2(-34, 32), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_G_Flank_B", "G", new Vector2(-62, 12), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_G_Precision", "G", new Vector2(-30, 14), StationRole.Precision, 0, false, 2.2f),
        };

        /// <summary>岸上的行走线（散布避让用；冰面上本来就不散布）</summary>
        static readonly Vector2[][] ShoreLines =
        {
            new[] { Spawn, PierRoot },
            new[] { new Vector2(-84, 4), SiteB, StageC },
            new[] { new Vector2(-121, 27), StageC },
            new[] { new Vector2(84, -6), SiteC, new Vector2(104, 6), BoatC },
            new[] { new Vector2(124, -15), BoatC },
            new[] { new Vector2(0, 53), SiteD, Dais2C },
            new[] { new Vector2(56, -42), CampPoi },
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        static Vector2[] BuildEnvelope()
        {
            // 角向噪声归一到 ±1 再乘起伏比例：起伏真的到 ±4%（噪声本身很少超过 ±0.5）
            const int n = 72;
            var wob = new float[n];
            float peak = 1e-4f;
            for (int i = 0; i < n; i++)
            {
                wob[i] = Loop(i * 2 * Mathf.PI / n, 7, 3, 19);
                peak = Mathf.Max(peak, Mathf.Abs(wob[i]));
            }
            var pts = new Vector2[n];
            for (int i = 0; i < n; i++)
            {
                float a = i * 2 * Mathf.PI / n;
                float k = 1 + EnvIrregular * wob[i] / peak;
                pts[i] = EnvC + new Vector2(Mathf.Cos(a) * EnvR.x, Mathf.Sin(a) * EnvR.y) * k;
            }
            return pts;
        }

        /// <summary>岸上地面（不含噪声）：离湖岸 0–56 m 从 1.8 m 缓升到 5 m</summary>
        static float LandRaw(float edgeDist) => 1.8f + 3.2f * Smooth(0, 56, Mathf.Max(0, edgeDist));

        /// <summary>不含噪声、不含地貌件的地面：湖内是冰面，岸带渐变到岸上地面（坡道两端、台面高度从这里取，避免递归）</summary>
        static float Land0(Vector2 p)
        {
            float k = LakeShore(p, LakeC, LakeR, LakeShoreWidth, LakeIrregular, LakeSeed, out _, out _, out float ed);
            return Mathf.Lerp(LakeY, LandRaw(ed), k);
        }

        /// <summary>湖面遮罩（0–1；冰面牵引区按 &gt; 0.5 铺）</summary>
        static float LakeMask(Vector2 p)
        {
            LakeShore(p, LakeC, LakeR, LakeShoreWidth, LakeIrregular, LakeSeed, out float lake, out _);
            return lake;
        }

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：椭圆多边形 + 一点细噪声</summary>
        static float Inside(Vector2 p) => LevelKit.PolygonSigned(p, Envelope) + Fbm(p, 12, 2, 41) * 0.8f;

        /// <summary>可玩区遮罩（世界 XZ，软边界与 L5 共用）：等值线 0.2 落在崖面上（界外约 1.7 m）</summary>
        static float Playable(Vector2 p) => Smooth(-4, 4, Inside(p));

        /// <summary>
        /// 界外的雪岭，相对岸上地面（ins = 离边界的有符号距离，界内为正）：坡脚内侧 3 m 碎石坡（0.9 m，能走）→ 界外 8–13 m 内陡升 16–30 m 的崖
        /// （崖高、崖面宽是同一个低频噪声，宽跟着高走，崖面始终陡）→ 边界外 2 m 起就叠雪峰（再高 6–36 m，山脊噪声），崖顶不留一圈平台。
        /// 坡脚以上 6–8 m 起按 5.5 m 一级切窄雪台（台面平、陡坎是岩，约一半崖段有）：最低一级比坡脚高 6 m 以上，二段跳（2.7 m）够不着，级与级之间也跳不上去；
        /// 只切崖高以内，崖顶以上的雪峰不切——远景没有削平的台面。崖面宽再按中频噪声放宽（沟），雪台跟着前后错动，不是一圈圈同心的看台。
        /// </summary>
        static float Rim(Vector2 p, float ins) => Rim(p, ins, out _);

        /// <summary>
        /// 同上，另给 lip = 雪台台沿的积雪带（0–1）：台面前段 + 下面那道陡坎的上半截。台沿是 0.5 m 高度格上斜着走的锐边，网格会锯齿成一排小三角，
        /// 坡度规则会把其中平的几片涂成雪、陡的涂成岩（一排白牙）；这一带统一给雪，台沿从下面看是一条连续的雪线
        /// </summary>
        static float Rim(Vector2 p, float ins, out float lip)
        {
            var (cliffH, _) = CliffAt(p);
            float faceW = FaceWidth(p);
            // 崖面剖面近乎直线（直线 65% + S 形 35%）：每级雪台的水平宽差不多，坡脚一离开碎石坡就陡
            float t = Mathf.Clamp01(-ins / faceW);
            float face = cliffH * Mathf.Lerp(t, t * t * (3 - 2 * t), 0.35f);
            float peakH = Mathf.Lerp(PeakMin, PeakMax, Ridged(p, 90, 4, 37));
            float rel = face + peakH * Smooth(-PeakStart, -PeakStart - PeakRun, ins);
            // 雪台只在一部分崖段出现，第一级高度沿边界漂；离下一道台沿还差多少（未切台的高度，米）：台沿之上 above、之下 below
            float first = LedgeFirst + LedgePhase * Smooth(-0.4f, 0.4f, Fbm(p, 55, 2, 51));
            float keep = Smooth(-0.2f, 0.1f, Fbm(p, 70, 2, 49)) * (1 - Smooth(cliffH - 2, cliffH + 2, rel)), above = 99, below = first - rel;
            if (rel > first)
            {
                float riser = Mathf.Lerp(LedgeRiserMin, LedgeRiserMax, Smooth(-0.4f, 0.4f, Fbm(p, 35, 2, 47)));
                float q = (rel - first) / LedgeStep, frac = q - Mathf.Floor(q);
                (above, below) = (frac * LedgeStep, (1 - frac) * LedgeStep);
                rel = Mathf.Lerp(rel, first + Terrace(rel - first, LedgeStep, riser), keep);
            }
            lip = keep * Mathf.Max(1 - Smooth(1.6f, 3f, above), 1 - Smooth(0.6f, 2f, below)) * Smooth(0, -1.5f, ins);
            return RimApron * Smooth(RimApronWidth, 0, ins) + rel;
        }

        /// <summary>崖高（坡脚以上 16–30 m）与崖面宽（8–13 m）：同一个低频噪声沿边界慢慢变，宽跟着高走——崖面坡度处处差不多（约 63–66°，含雪峰更陡）</summary>
        static (float height, float face) CliffAt(Vector2 p)
        {
            float n = Smooth(-0.4f, 0.4f, Fbm(p, 80, 2, 31));
            return (Mathf.Lerp(CliffMin, CliffMax, n), Mathf.Lerp(FaceMin, FaceMax, n));
        }

        /// <summary>崖面实际的水平宽：CliffAt 的宽再按中频噪声放宽（沟）</summary>
        static float FaceWidth(Vector2 p) => CliffAt(p).face * (1 + FaceGully * Smooth(-0.1f, 0.45f, Fbm(p, 22, 3, 45)));

        /// <summary>矩形台的遮罩（台面 1、侧壁 edge 米内落到 0）</summary>
        static float RectMask(Vector2 p, Vector2 c, Vector2 half, float edge) =>
            1 - Smooth(0, edge, Mathf.Max(0, LevelKit.BoxSdf(p, c - half, c + half)));

        /// <summary>半圆瑶台的遮罩：前沿（平边，对着湖）是陡壁，两翼与后沿是缓坡并进岸</summary>
        static float YaoMask(Vector2 p)
        {
            float front = 1 - Smooth(0, YaoEdge, YaoC.y - p.y);
            float arc = 1 - Smooth(0, YaoFlank, Vector2.Distance(p, YaoC) - YaoR);
            return Mathf.Min(front, arc);
        }

        static float Raise(float h, float y, float mask) => mask > 0 ? Mathf.Max(h, Mathf.Lerp(h, y, mask)) : h;

        /// <summary>路堤（栈桥 / 码头）：root → tip 的线段，半宽 half，侧壁 JettyEdge 米；面高从 rootY 线性降到 tipY，只填不挖</summary>
        static float Jetty(float h, Vector2 p, Vector2 root, Vector2 tip, float half, float rootY, float tipY, ref float mask)
        {
            float d = LevelKit.SegmentDistance(p, root, tip, out float t);
            float m = 1 - Smooth(half, half + JettyEdge, d);
            if (m <= 0) return h;
            mask = Mathf.Max(mask, m);
            return Raise(h, Mathf.Lerp(rootY, tipY, t), m);
        }

        /// <summary>码头面在 x 处的高度（摆桥面木板用）</summary>
        static float JettyTop(int i, float x)
        {
            var (root, tip) = Jetties[i];
            return Mathf.Lerp(JettyRootY[i], JettyTipY, Mathf.InverseLerp(root.x, tip.x, x));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();

            // ── 冰湖 + 岸：湖内绝对平（冰面），岸带 12 m 缓升到岸上地面 ──
            float k = LakeShore(p, LakeC, LakeR, LakeShoreWidth, LakeIrregular, LakeSeed, out float lake, out float shoreMask, out float ed);
            float land = LandRaw(ed) + Fbm(p, 40, 3, 1) * 0.4f + Fbm(p, 10, 2, 2) * 0.08f;
            float h = Mathf.Lerp(LakeY, land, k);

            // ── 出生平台（压平）──
            float pad = 1 - Smooth(SpawnPadR, SpawnPadR + 4, Vector2.Distance(p, Spawn));
            if (pad > 0) h = Mathf.Lerp(h, SpawnY, pad);

            // ── 冰窟窿：只挖湖面，碗底在冰面下 depth 米 ──
            float hole = 0;
            if (lake > 0.5f)
                foreach (var (c, r, depth) in Holes)
                {
                    float d = Vector2.Distance(p, c);
                    if (d >= r) continue;
                    float m = 1 - Smooth(r - Mathf.Min(HoleRimSlope, r), r, d);
                    h -= depth * m;
                    hole = Mathf.Max(hole, m);
                }

            // ── 湖心亭白玉台（圆，侧壁陡）──
            float pav = 1 - Smooth(PavR, PavR + PavEdge, Vector2.Distance(p, PavC));
            h = Raise(h, PavY, pav);

            // ── 小岛（岩，顶平侧陡，边缘被噪声啃得不规则）──
            float isleBody = 0, isleTop = 0;
            foreach (var (c, r, ih, seed) in Islets)
            {
                float d = Vector2.Distance(p, c);
                if (d > r + 3) continue;
                float m = 1 - Smooth(r - 0.5f, r + 0.3f, d + Fbm(p, 7, 2, seed) * 0.8f);
                if (m <= 0) continue;
                float top = LakeY + ih * (1 + Fbm(p, 5, 2, seed + 4) * 0.04f);
                h = Mathf.Max(h, Mathf.Lerp(h, top, Mathf.Pow(m, 0.6f)));
                isleBody = Mathf.Max(isleBody, m);
                isleTop = Mathf.Max(isleTop, Smooth(0.92f, 0.99f, m));
            }

            // ── 栈桥、码头（路堤）──
            float jetty = 0;
            h = Jetty(h, p, PierRoot, PierTip, PierHalf, PierRootY, PierTipY, ref jetty);
            for (int i = 0; i < Jetties.Length; i++) h = Jetty(h, p, Jetties[i].root, Jetties[i].tip, JettyHalf, JettyRootY[i], JettyTipY, ref jetty);

            // ── 祭坛台、船屋台、瑶台、两层玉阶（台面写成绝对高度，台下岸的起伏不影响台面）──
            float stage = RectMask(p, StageC, StageHalf, StageEdge);
            h = Raise(h, StageY, stage);
            float boat = RectMask(p, BoatC, BoatHalf, BoatEdge);
            h = Raise(h, BoatY, boat);
            float yao = YaoMask(p);
            h = Raise(h, YaoY, yao);
            float dais1 = RectMask(p, Dais1C, Dais1Half, DaisEdge), dais2 = RectMask(p, Dais2C, Dais2Half, DaisEdge);
            h = Raise(h, Dais1Y, dais1);
            h = Raise(h, Dais2Y, dais2);

            // ── 坡道（只填）──
            float rampAny = 0;
            foreach (var r in Ramps)
            {
                var (t, m) = Ramp(p, r.foot, r.top, r.width, 2.5f);
                if (m <= 0) continue;
                float target = Mathf.Lerp(r.footY, r.topY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                rampAny = Mathf.Max(rampAny, m);
            }

            // ── 雪崖 + 雪峰（界外）──
            float ins = Inside(p), lip = 0;
            if (ins < RimApronWidth) h = Mathf.Max(h, land + Rim(p, ins, out lip));

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Frost：岩 → 冰 → 冻土 → 雪）──
            float plat = Mathf.Max(Mathf.Max(Mathf.Max(pav, stage), Mathf.Max(boat, yao)), Mathf.Max(Mathf.Max(dais1, dais2), jetty));
            float tops = Mathf.Max(Mathf.Max(Smooth(0.85f, 0.99f, pav), Smooth(0.85f, 0.99f, Mathf.Max(stage, boat))),
                Mathf.Max(Smooth(0.85f, 0.99f, Mathf.Max(dais1, dais2)), Smooth(0.85f, 0.99f, jetty)));
            // 冻土碎石读路：岸带 0.65、台面 0.65、坡道 0.6、瑶台 0.5，多出来的给雪（这些面上雪的倾向拉满）；出生平台是开场第一眼，雪 0.8。
            // 冰原地表改成雪按高度盖住碎石之后（TerrainTextureGen.FrozenSoil），冻土要过六成才露出成片的石块、雪填在石缝里，五成以下基本是雪面只露石尖
            float yaoTop = Smooth(0.85f, 0.99f, yao), shoreBand = shoreMask * (1 - plat);
            s.fluid = lake * (1 - Mathf.Max(plat, isleBody)) * (1 - hole) * (1 - rampAny);
            s.shore = Mathf.Max(shoreBand * 0.65f, hole);
            s.packed = Mathf.Max(Mathf.Max(tops * 0.65f, rampAny * 0.6f), yaoTop * 0.5f);
            float snowFill = Mathf.Max(Mathf.Max(shoreBand, tops), Mathf.Max(rampAny, yaoTop));
            s.sand = Mathf.Max(Mathf.Max(isleTop * 0.85f, pad * 0.8f), Mathf.Max(snowFill, lip));
            // 雪岭不再强制岩带：交给章节的坡度规则（陡坎是岩、缓处积雪）；窄雪台的台沿一带直接给雪（见 Rim）
            s.rock = isleBody * (1 - isleTop) * 0.9f;
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 2-3 瑶池冰湖", priority = 71)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>构建期的地形（摆件、标记贴地用）</summary>
        static LevelKit.TerrainSet ts;

        static Vector3 OnGround(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);

        /// <summary>生成场景 → 软边界 → 烘焙 NavMesh → 验收规则集 → 截图；返回不合格项数</summary>
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
                // 远景：雪峰两圈，北面（北冥方向）压低一道缺口；地形外的远景地面接环脚
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, EnvC, FarY, 760, 5);
                backdrop.gapAngle = 90;
                backdrop.gapWidth = 26;
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY, theme.groundA, 3000);

                // 软边界（没有空气墙）：雪崖本身封边，风雪推回 + 白化只兜底
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：北风，常态风力 0.35；动态环境是冰面，不放风暴区（unity-maps-v1：每张图最多一个）
                LevelKit.Weather(env, theme, Wind, 0.35f);

                var ice = LevelKit.IceSheet(world, p => LakeMask(p) > 0.5f, new Rect(LakeC - LakeR * 1.1f, LakeR * 2.2f), LakeY);
                var waters = BuildHoles(world, kit, props);
                var pavTop = BuildLakeCentre(kit, props);
                BuildPier(props);
                var wayshrineTop = BuildAltar(kit, props);
                var lighthouseTop = BuildDock(kit, props);
                var (shrine, exitTop) = BuildYaotai(kit, props);
                var mastTop = BuildJunk(kit);
                BuildFishingCamp(props);
                BuildScatter(props, theme, new[] { (OnGround(Spawn, 1.62f), pavTop), (OnGround(Spawn, 1.62f), mastTop) });
                BuildMarkers(markers, pavTop);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝湖心亭）+ 自举标记
                var spawnAt = OnGround(Spawn, 0.05f);
                var look = pavTop - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.normalized);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();
                var objective = BuildEncounters(markers);
                BuildCaches(markers, objective);
                var portal = BuildExit(shrine, objective, markers);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                // 构建设置：Core 第 0、RunPlan 的关卡按顺序（parity 4.12）
                LevelBuilders.SyncBuildSettings();

                var rep = new LevelKit.Report();
                rep.Line("2-3 瑶池冰湖 · 验收");
                rep.Line($"高度：出生平台 {OnGround(Spawn).y:F1}，栈桥头 {OnGround(PierTip).y:F1}，冰面 {OnGround(SiteA).y:F2}，白玉台 {OnGround(PavC + new Vector2(0, -8.5f)).y:F1}，" +
                         $"北 / 南小岛 {OnGround(Islets[0].c).y:F1} / {OnGround(Islets[1].c).y:F1}，冰窟窿底 {OnGround(Holes[0].c).y:F1}");
                rep.Line($"高度：祭坛台 {OnGround(StageC).y:F1}（岸 {OnGround(SiteB).y:F1}），船屋台 {OnGround(BoatC + new Vector2(-2, -2)).y:F1}（岸 {OnGround(SiteC).y:F1}），" +
                         $"码头头 {OnGround(Jetties[0].tip + new Vector2(1, 0)).y:F1} / {OnGround(Jetties[1].tip + new Vector2(1, 0)).y:F1}，" +
                         $"瑶台 {OnGround(SiteD).y:F1}，一层 / 二层玉阶 {OnGround(new Vector2(-12, 90)).y:F1} / {OnGround(new Vector2(-5, 92)).y:F1}");
                ReportRim(rep);
                LevelValidator.Run(Spec(pavTop, wayshrineTop, lighthouseTop, exitTop, mastTop), rep);
                CheckSceneContents(rep, scene, ice, waters, portal);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_2-3_report.txt");

                if (review) Review(spawnAt, spawnRot, pavTop, wayshrineTop, lighthouseTop, exitTop, mastTop);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        /// <summary>
        /// 雪岭实测（报告用）：边界半径的起伏、沿边界一圈的崖高（坡脚 → 崖面顶，含已经叠上的雪峰）、最低雪台离坡脚的高度；
        /// 高的件离边界（坡脚）的距离——角楼、灯塔要 ≥ 8 m（上不去也不贴崖）
        /// </summary>
        static void ReportRim(LevelKit.Report rep)
        {
            float wMin = float.MaxValue, wMax = float.MinValue, hMin = float.MaxValue, hMax = float.MinValue;
            foreach (var q in Envelope)
            {
                var d = q - EnvC;
                float k = Mathf.Sqrt(d.x * d.x / (EnvR.x * EnvR.x) + d.y * d.y / (EnvR.y * EnvR.y)) - 1;
                (wMin, wMax) = (Mathf.Min(wMin, k), Mathf.Max(wMax, k));
                // 沿径向往外走到离边界一个崖面宽处（椭圆斜边上径向不是法向，按 Inside 量）
                float w = FaceWidth(q), s = 0;
                while (s < 40 && Inside(q + d.normalized * s) > -w) s += 0.5f;
                float rise = OnGround(q + d.normalized * s).y - OnGround(q).y;
                (hMin, hMax) = (Mathf.Min(hMin, rise), Mathf.Max(hMax, rise));
            }
            rep.Line($"雪岭：边界半径 {EnvR.x:F0} × {EnvR.y:F0}，起伏 {wMin * 100:+0.0;-0.0}% … {wMax * 100:+0.0;-0.0}%；坡脚 → 崖面顶 {hMin:F0}–{hMax:F0} m；" +
                     $"窄雪台从坡脚以上 {LedgeFirst:F0}–{LedgeFirst + LedgePhase:F0} m 起每级 {LedgeStep:F1} m（二段跳 2.7 m 够不着）");
            var tall = new (string name, Vector2 at, float r, float min)[]
            {
                ("灯塔", LighthouseAt, 3.2f, 8), ("西角楼", TowerAt[0], 3.5f, 8), ("东角楼", TowerAt[1], 3.5f, 8),
                ("出口祭坛", ShrineAt, 5.3f, 4), ("船屋台", BoatC + new Vector2(BoatHalf.x + BoatEdge, 0), 0, 4),
                ("祭坛台", StageC - new Vector2(StageHalf.x + StageEdge, 0), 0, 4), ("出生平台", Spawn - new Vector2(0, SpawnPadR), 0, 4),
            };
            var parts = new List<string>();
            foreach (var (name, at, r, min) in tall)
            {
                float gap = Inside(at) - r;
                parts.Add($"{name} {gap:F1} m");
                if (gap < min) rep.Fail($"{name}离边界（坡脚）只有 {gap:F1} m（应 ≥ {min:F0} m）");
            }
            rep.Line($"离边界（坡脚）：{string.Join("，", parts)}");
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 pavTop, Vector3 wayshrineTop, Vector3 lighthouseTop, Vector3 exitTop, Vector3 mastTop)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => OnGround(q, dy);
            // 审核截图用临时机位（与玩家同一套相机 + 第一人称 rig），截完删掉
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_2-3", new[]
                {
                    ("Aerial", new Vector3(-60, 150, -190), new Vector3(0, 0, 10), false),
                    ("Map", new Vector3(EnvC.x, 430, EnvC.y - 1), new Vector3(EnvC.x, 0, EnvC.y), false),
                    ("Spawn", E(Spawn), pavTop, true),
                    ("PierTip", E(PierTip), pavTop - Vector3.up * 6, false),
                    ("LakeCentre", E(new Vector2(0, -24)), OnGround(PavC, 4), false),
                    ("Pavilion", E(PavC + new Vector2(-8.5f, -2)), wayshrineTop, false),
                    ("IceHole", E(Holes[0].c + new Vector2(-10, -6)), OnGround(Holes[0].c, 0.5f), false),
                    ("Altar", E(new Vector2(-88, 2)), wayshrineTop, false),
                    ("AltarStage", E(StageC + new Vector2(2, -4)), OnGround(PavC, 6), false),
                    ("Dock", E(new Vector2(70, -4)), lighthouseTop, false),
                    ("Boathouse", E(BoatC + new Vector2(-3, -3)), OnGround(new Vector2(78, 0), 1), false),
                    ("Junk", E(new Vector2(-30, 12)), mastTop, false),
                    ("FishingCamp", E(new Vector2(50, -46)), OnGround(CampPoi, 1.5f), false),
                    ("Yaotai", E(new Vector2(0, 46)), exitTop, false),
                    ("Dais", E(new Vector2(-5, 91)), OnGround(PavC, 8), false),
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
        /// 摆一件资产：底面中心 = (q, baseY)；有 Prefab 就按 scale（可非均匀）摆，没有就放设计尺寸 × scale 的白盒（LevelKit.PlaceOrBox，Placeholder 标签）
        /// </summary>
        static GameObject PutAt(string id, Transform parent, Vector2 q, float baseY, float yaw, Vector3 scale)
        {
            var size = DesignSize.TryGetValue(id, out var d) ? Vector3.Scale(d, scale) : scale * 2;
            var go = LevelKit.PlaceOrBox(id, parent, At(q, baseY), size, yaw);
            if (!go) return null;
            if (!IsPlaceholder(go)) go.transform.localScale = scale;
            go.isStatic = true;
            return go;
        }

        static GameObject PutAt(string id, Transform parent, Vector2 q, float baseY, float yaw, float scale = 1) => PutAt(id, parent, q, baseY, yaw, Vector3.one * scale);

        /// <summary>贴地摆：底面往地下埋 sink 米</summary>
        static GameObject Put(string id, Transform parent, Vector2 q, float yaw, float scale = 1, float sink = 0.15f) =>
            PutAt(id, parent, q, OnGround(q).y - sink, yaw, scale);

        /// <summary>
        /// 冰窟窿：两处大冰窟窿（水体 + 冰窟边缘 6 段放 4 段，东西两头留下水的口子，冰板压到 0.75 倍高 = 1.65 m 的掩体），
        /// 渔营外三个冰钓窟窿（水体 + 旁边码着凿出来的冰块）。返回全部水体
        /// </summary>
        static List<WaterVolume> BuildHoles(Transform world, Transform kit, Transform props)
        {
            var root = new GameObject("Ice Holes").transform;
            root.SetParent(world, false);
            var waters = new List<WaterVolume>();
            for (int i = 0; i < Holes.Length; i++)
            {
                var (c, r, depth) = Holes[i];
                bool lead = i < LeadHoles;
                var w = LevelKit.IceHole(root, lead ? $"Ice Hole {i + 1}" : $"Fishing Hole {i - LeadHoles + 1}", At(c, LakeY), r, depth, HoleDrop);
                waters.Add(w);
                if (lead)
                    LevelKit.IceHoleRing(kit, At(c, LakeY), r, 6, 0.75f, 0,
                        a => Mathf.Abs(Mathf.DeltaAngle(a, 0)) > 30 && Mathf.Abs(Mathf.DeltaAngle(a, 180)) > 30);
                else
                {
                    var side = new Vector2(Mathf.Cos(i * 1.7f), Mathf.Sin(i * 1.7f));
                    PutAt(ShardsId, props, c + side * (r + 1.3f), LakeY - 0.1f, i * 47f, 0.9f);
                }
            }
            return waters;
        }

        /// <summary>
        /// A 湖心：湖心亭（×1.4，台阶朝东西）、白玉台台沿一圈白玉挡土墙（10 段，坡道处留口）、台上的冰灯、两座小岛上的雪松、冰面上冻住的小船、冰棱碎块、桅杆残段；
        /// 返回亭顶（地标视线目标）
        /// </summary>
        static Vector3 BuildLakeCentre(Transform kit, Transform props)
        {
            var pav = PutAt(PavilionId, kit, PavC, LakeY + PavBase, 0, PavScale);
            if (pav && !IsPlaceholder(pav)) pav.name = $"{PavilionId} (Lake Pavilion)";
            // 白玉台台沿：每 30° 一段白玉挡土墙，东（0°）西（180°）两道坡处留口，共 10 段；正面朝外，底埋进冰面
            for (float a = 0; a < 360f - 1f; a += PavWallStep)
            {
                if (Mathf.Abs(Mathf.DeltaAngle(a, 0)) < 1f || Mathf.Abs(Mathf.DeltaAngle(a, 180)) < 1f) continue;
                var dir = new Vector2(Mathf.Cos(a * Mathf.Deg2Rad), Mathf.Sin(a * Mathf.Deg2Rad));
                PutAt(JadeWallId, kit, PavC + dir * PavWallR, LakeY - PavWallSink, 90f - a, new Vector3(PavWallSx, PavWallSy, 1));
            }
            foreach (float x in new[] { -9.2f, 9.2f })
            foreach (float dz in new[] { -3.6f, 3.6f })
                PutAt(LanternId, props, new Vector2(x, PavC.y + dz), PavY - 0.05f, x < 0 ? 90 : -90);
            Put(PineId, props, new Vector2(26, 28), 40, 1.2f, 0.2f);
            Put(PineId, props, new Vector2(-28, -15), 160, 1.1f, 0.2f);
            // 冰面上冻住的小船（底埋进冰 0.35 m）
            foreach (var (q, yaw) in new[] { (new Vector2(-12, -24), 30f), (new Vector2(16, -20), -25f), (new Vector2(38, 6), 80f), (new Vector2(-40, 12), 115f), (new Vector2(6, 38), 10f) })
                PutAt(SkiffId, props, q, LakeY - 0.35f, yaw, 1.4f);
            // 冰棱碎块（湖面上冻起的冰脊块）、桅杆残段
            foreach (var (q, yaw) in new[] { (new Vector2(-4, -26), 20f), (new Vector2(30, -14), 110f), (new Vector2(-30, -4), 200f) })
                PutAt(ShardsId, props, q, LakeY - 0.1f, yaw, 1.7f);
            foreach (var (q, yaw) in new[] { (new Vector2(-16, 36), 30f), (new Vector2(40, 24), 150f) })
                PutAt(MastRuinId, props, q, LakeY - 0.1f, yaw, 1.4f);
            return At(PavC, LakeY + PavBase + PavHeight * PavScale - 1.5f);
        }

        /// <summary>南岸栈桥：路堤面上铺旅道木板（宽沿 x，长沿 z，顶面高出路堤 5 cm），桥根两侧冰灯；出生平台边上的经幡石堆、小祠</summary>
        static void BuildPier(Transform props)
        {
            float deckH = DesignSize[DeckId].y;
            for (float z = PierRoot.y + 2; z <= PierTip.y - 1.5f; z += 3.9f)
            {
                float top = Mathf.Lerp(PierRootY, PierTipY, Mathf.InverseLerp(PierRoot.y, PierTip.y, z));
                PutAt(DeckId, props, new Vector2(0, z), top - deckH + 0.05f, 0);
            }
            Put(LanternId, props, new Vector2(-4.6f, -75.5f), 0, 1, 0.1f);
            Put(LanternId, props, new Vector2(4.6f, -75.5f), 0, 1, 0.1f);
            Put("SM_Prop_FrostPrayerCairn", props, new Vector2(-9, -83), 20, 1, 0.1f);
            Put("SM_Prop_FrostPrayerCairn", props, new Vector2(9, -84), -30, 1, 0.1f);
            Put("SM_Prop_FrostShrine", props, new Vector2(12, -94), -60, 1.2f, 0.1f);
        }

        /// <summary>B 西岸祭坛：台上经幡祠（×1.4，正面朝湖）、供品、两根玉柱（歇脚点），台东沿白玉挡土墙两段（坡道处留口），岸上掩体墙、断柱、石堆；返回祠顶</summary>
        static Vector3 BuildAltar(Transform kit, Transform props)
        {
            var shrineAt = new Vector2(-124.5f, 4);
            PutAt(WayshrineId, kit, shrineAt, StageY - 0.1f, 90, 1.4f);
            PutAt("SM_Tripo_FrostOfferings", props, new Vector2(-124.5f, -1.5f), StageY - 0.05f, 90);
            PutAt("SM_Tripo_FrostOfferings", props, new Vector2(-124.5f, 9.5f), StageY - 0.05f, 90);
            PutAt(ColumnId, kit, new Vector2(-116.8f, -4.2f), StageY - 0.05f, 0);
            PutAt(ColumnId, kit, new Vector2(-116.8f, 12.2f), StageY - 0.05f, 0);
            foreach (float z in new[] { -2f, 10f })
                JadeWall(kit, new Vector2(-114.1f, z), new Vector2(-112.8f, z), 90, 0.86f, StageY);
            Put("SM_Tripo_FrostCoverWall", props, new Vector2(-97, -9), 80, 1, 0.1f);
            Put("SM_Tripo_FrostCoverWall", props, new Vector2(-97, 15), 100, 1, 0.1f);
            Put("SM_Tripo_FrostColumnRuin", props, new Vector2(-111, -14), 20, 1, 0.1f);
            Put("SM_Prop_FrostPrayerCairn", props, new Vector2(-108, 17), 10, 1, 0.1f);
            Put("SM_Prop_FrostPrayerCairn", props, new Vector2(-112, -8), 70, 1, 0.1f);
            return At(shrineAt, StageY - 0.1f + DesignSize[WayshrineId].y * 1.4f - 0.8f);
        }

        /// <summary>
        /// 白玉挡土墙一段：立在台沿外（at = 墙心，foot = 墙前的坡脚，取它的地面当底），正面朝外（yaw），沿墙长按 sx 放大，
        /// 纵向按落差缩放——墙顶（含栏板）比台面高约 1 m
        /// </summary>
        static GameObject JadeWall(Transform parent, Vector2 at, Vector2 foot, float yaw, float sx, float topY)
        {
            float baseY = OnGround(foot).y - 0.3f;
            float sy = Mathf.Clamp((topY + 1f - baseY) / DesignSize[JadeWallId].y, 0.25f, 1.5f);
            return PutAt(JadeWallId, parent, at, baseY, yaw, new Vector3(sx, sy, 1));
        }

        /// <summary>C 东岸船坞：两条码头的木板、冻船湾的小船、灯塔、毡房、鱼架、骨灯、桅杆残段；返回灯塔顶</summary>
        static Vector3 BuildDock(Transform kit, Transform props)
        {
            float deckH = DesignSize[DeckId].y;
            for (int i = 0; i < Jetties.Length; i++)
            {
                var (root, tip) = Jetties[i];
                for (float x = root.x - 2; x >= tip.x + 1.5f; x -= 3.9f)
                    PutAt(DeckId, props, new Vector2(x, root.y), JettyTop(i, x) - deckH + 0.05f, 90, new Vector3(0.92f, 1, 1));
            }
            PutAt(BoneLanternId, props, new Vector2(72.5f, -20.3f), JettyTop(0, 72.5f) - 0.05f, 0);
            PutAt(BoneLanternId, props, new Vector2(76.5f, 17.7f), JettyTop(1, 76.5f) - 0.05f, 0);
            foreach (var (q, yaw) in new[] { (new Vector2(74, -13), 90f), (new Vector2(76, 7), 80f), (new Vector2(72, -29), 95f), (new Vector2(75, 22), 85f) })
                PutAt(SkiffId, props, q, LakeY - 0.35f, yaw, 1.4f);
            var lighthouseAt = LighthouseAt;
            var lh = Put(LighthouseId, kit, lighthouseAt, -50, 1, 0.2f);
            Put(YurtId, props, new Vector2(112, 22), -120, 1, 0.1f);
            Put(FishRackId, props, new Vector2(104, -30), 15, 1, 0.05f);
            Put(FishRackId, props, new Vector2(108, -33), 15, 1, 0.05f);
            PutAt(FishRackId, props, new Vector2(120, 10.5f), BoatY - 0.05f, 0);
            PutAt(FishRackId, props, new Vector2(129, 10.5f), BoatY - 0.05f, 0);
            Put(MastRuinId, props, new Vector2(88, 3), 30, 1.4f, 0.1f);
            float baseY = lh ? lh.transform.position.y : OnGround(lighthouseAt).y;
            return At(lighthouseAt, baseY + DesignSize[LighthouseId].y - 1.5f);
        }

        /// <summary>
        /// D 瑶台：前沿白玉挡土墙 6 段（三道坡处留口）、台面两根玉柱（歇脚点）、正中坡顶两盏冰灯、台后两座角楼、二层玉阶上的出口祭坛（面朝南）；
        /// 返回祭坛和祭坛顶
        /// </summary>
        static (GameObject shrine, Vector3 top) BuildYaotai(Transform kit, Transform props)
        {
            foreach (float x in new[] { -28.5f, -15.5f, -7.5f, 7.5f, 15.5f, 28.5f })
                JadeWall(kit, new Vector2(x, 67f), new Vector2(x, 65.4f), 180, 1.14f, YaoY);
            PutAt(ColumnId, kit, new Vector2(-20, 80), YaoY - 0.05f, 0);
            PutAt(ColumnId, kit, new Vector2(20, 80), YaoY - 0.05f, 0);
            PutAt(LanternId, props, new Vector2(-4.6f, 70.5f), YaoY - 0.05f, 180);
            PutAt(LanternId, props, new Vector2(4.6f, 70.5f), YaoY - 0.05f, 180);
            foreach (var t in TowerAt) Put(TowerId, kit, t, 180, 1, 0.3f);
            var shrine = PutAt(ShrineId, kit, ShrineAt, Dais2Y - 0.05f, 180);
            return (shrine, At(ShrineAt, Dais2Y + DesignSize[ShrineId].y - 1.5f));
        }

        /// <summary>冻船（藏宝）：大帆船冻在西北湖面，底埋进冰 1.4 m；返回桅顶</summary>
        static Vector3 BuildJunk(Transform kit)
        {
            var junk = PutAt(JunkId, kit, JunkC, LakeY + JunkBase, JunkYaw);
            if (junk && !IsPlaceholder(junk)) junk.name = $"{JunkId} (Frozen Junk)";
            return At(JunkC, LakeY + JunkBase + DesignSize[JunkId].y - 1f);
        }

        /// <summary>渔营：毡房、鱼架、拖上岸的冰船、骨灯（藏宝点和宝物堆在 BuildCaches）</summary>
        static void BuildFishingCamp(Transform props)
        {
            Put(YurtId, props, new Vector2(76, -64), -40, 1, 0.1f);
            Put(FishRackId, props, new Vector2(62, -61), 20, 1, 0.05f);
            Put(FishRackId, props, new Vector2(65, -65), 20, 1, 0.05f);
            Put(SkiffId, props, new Vector2(59, -53), -50, 1.4f, 0.1f);
            Put(BoneLanternId, props, new Vector2(71, -53), 0, 1, 0.05f);
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：冰棱、冻石（细节，不挡人）避开台面、坡道、冰窟窿；雪松（大件，带碰撞）只在岸上的游玩区里，
        /// 避开场地、站位、坡道、台、藏宝、营地和地标视线的走廊（4 m）
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme, (Vector3 a, Vector3 b)[] extraSight)
        {
            float RouteDist(Vector2 p)
            {
                float best = float.MaxValue;
                foreach (var line in ShoreLines) best = Mathf.Min(best, Polyline(p, line).dist);
                return best;
            }
            float Keep(Vector2 p)
            {
                float k = Mathf.Max(1 - Smooth(PavR, PavR + 3, Vector2.Distance(p, PavC)), RectMask(p, StageC, StageHalf + Vector2.one * 2, 2));
                k = Mathf.Max(k, Mathf.Max(RectMask(p, BoatC, BoatHalf + Vector2.one * 2, 2), YaoMask(p)));
                foreach (var (c, r, _) in Holes) k = Mathf.Max(k, 1 - Smooth(r, r + 3, Vector2.Distance(p, c)));
                // 界外不撒：崖面的窄雪台是平的，撒上去会排成一行行冰棱
                return (1 - k) * Smooth(-1, 1, Inside(p));
            }
            var details = LevelKit.ScatterPresets.Details(theme.key);
            foreach (var r in details)
            {
                var w = r.where;
                r.where = pt => (w?.Invoke(pt) ?? 1) * Keep(pt.p);
            }
            LevelKit.ScatterDetails(ts, details, RouteDist, 1f, 160f);

            var pines = LevelKit.ScatterPresets.Boulders(theme.key);
            var pw = pines.where;
            var avoid = new List<(Vector2 c, float r)>
            {
                (Spawn, 16), (SiteB, 18), (SiteC, 18), (StageC, 16), (BoatC, 15), (SiteD, 30), (Dais2C, 22), (SiteG, 10),
                (CampPoi, 16), (JunkPoi, 8), (LighthouseAt, 9), (new Vector2(112, 22), 6), (TowerAt[0], 7), (TowerAt[1], 7),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            var sight = new List<(Vector2 a, Vector2 b)>
            {
                (PavC, new Vector2(-124.5f, 4)), (PavC, LighthouseAt), (new Vector2(0, 46), ShrineAt),
            };
            foreach (var (a, b) in extraSight) sight.Add((new Vector2(a.x, a.z), new Vector2(b.x, b.z)));
            pines.where = pt =>
            {
                var q = pt.p;
                if (Inside(q) < 5 || LakeMask(q) > 0.05f) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(q, c) < r) return 0;
                foreach (var rp in Ramps)
                    if (Polyline(q, new[] { rp.foot, rp.top }).dist < rp.width * 0.5f + 4) return 0;
                foreach (var (a, b) in sight)
                    if (LevelKit.SegmentDistance(q, a, b, out _) < 4) return 0;
                return pw?.Invoke(pt) ?? 1;
            };
            var area = new Rect(EnvC - EnvR, EnvR * 2);
            LevelKit.ScatterProps(ts, props, pines, area, 10f, RouteDist);
        }

        static void BuildMarkers(Transform root, Vector3 pavTop)
        {
            GameObject Mk(string name, Vector3 at)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = at;
                return go;
            }
            Mk("Site_Spawn", OnGround(Spawn));
            Mk("Site_A_LakeCentre", OnGround(SiteA));
            Mk("Site_B_Altar", OnGround(SiteB));
            Mk("Site_C_Dock", OnGround(SiteC));
            Mk("Site_D_Yaotai", OnGround(SiteD));
            Mk("Site_G_JunkGuard", OnGround(SiteG));
            Mk("Site_Exit", OnGround(ShrineAt));
            foreach (var a in Anchors) Mk(a.name, OnGround(a.at));
            // 地标（冒烟测试看亭顶是否可见）与测试探针（冰面滑行、岸上对照、冰窟窿；朝向 = 滑行方向）
            Mk("Landmark_LakePavilion", pavTop);
            Mk("Probe_IceSlide", OnGround(IceProbe)).transform.rotation = Quaternion.LookRotation(Vector3.right);
            Mk("Probe_LandSlide", OnGround(LandProbe)).transform.rotation = Quaternion.LookRotation(Vector3.right);
            Mk("Probe_OpenWater", At(Holes[0].c, LakeY));
            // 三青鸟的歇脚点：祭坛台、瑶台的玉柱顶
            float colH = DesignSize[ColumnId].y;
            Mk("PerchPoint_Altar_S", At(new Vector2(-116.8f, -4.2f), StageY - 0.05f + colH));
            Mk("PerchPoint_Altar_N", At(new Vector2(-116.8f, 12.2f), StageY - 0.05f + colH));
            Mk("PerchPoint_Yaotai_W", At(new Vector2(-20, 80), YaoY - 0.05f + colH));
            Mk("PerchPoint_Yaotai_E", At(new Vector2(20, 80), YaoY - 0.05f + colH));
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/2-3.md §7，遭遇框架 v2）：A / B / C / D 必清，A、B、C 顺序不限，D 要 B 和 C 都肃清（requires）；
        /// G 是冻船藏宝的伏兵（可选、不自动触发）。难度由 RunPlan 给（2-3 = 2.12），场地不写死。站位标记挂 SpawnAnchor（<see cref="Anchors"/>）。
        /// </summary>
        static LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(string key, string title, Vector2 at, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset = default)
            {
                var site = new GameObject($"Site {key} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = OnGround(at);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                var list = new List<Transform>();
                foreach (var a in Anchors)
                {
                    if (a.site != key) continue;
                    var m = markers.Find(a.name);
                    var sa = m.GetComponent<SpawnAnchor>();
                    if (!sa) sa = m.gameObject.AddComponent<SpawnAnchor>();
                    (sa.role, sa.lane, sa.elevated, sa.spread) = (a.role, a.lane, a.elevated, a.spread);
                    list.Add(m);
                }
                site.anchors = list.ToArray();
                return site;
            }
            WaveEntry E(string id, int n) => EncounterSpec.E(id, n);
            WaveSpec Wave(string label, params WaveEntry[] entries) => EncounterSpec.Wave(label, entries);

            var sA = Site("A", "湖心冰光", SiteA, 22, 32, EncounterSpec.Of(
                    Wave("冰光隔湖", E(Fuzhu, 2), E(Jelly, 1), E(Haozhi, 2)).Hint("夫诸隔着冰面蓄力射冰光——躲到湖心亭或小岛后面，断开水母的连线"),
                    Wave("冰上冲锋", E(Haozhi, 2), E(Jiaoren, 3), E(Qingniao, 1)).After(1, 1.8f).Hint("豪彘在冰上刹不住——侧冲让开，看它滑过去"))
                .Gather(0.6f).Distance(10, 40), "weapon");
            var sB = Site("B", "西岸祭坛", SiteB, 22, 28, EncounterSpec.Of(
                    Wave("岸边鲛群", E(Jiaoren, 4), E(Puffer, 2)).Hint("鲛人冲上岸先投矛再突刺，河豚从湖面飘来——上祭坛拉开距离"),
                    Wave("祭坛护法", E(Xingxing, 3), E(Fuzhu, 1), E(Puffer, 1)).After(1, 1.6f).Hint("狌狌会扒着台沿翻上祭坛——站高也不安全"))
                .Gather(0.4f).Distance(10, 34), "scroll", new Vector3(0, 0, 10));
            var sC = Site("C", "东岸船坞", SiteC, 22, 30, EncounterSpec.Of(
                    Wave("船坞巨蟹", E(Crab, 1), E(Jiaoren, 3), E(Fuzhu, 1)).Hint("巨蟹竖着巨钳横着走——在冻船之间绕到它身后打背缝"),
                    Wave("灯塔下", E(Puffer, 2), E(Jelly, 1), E(Jiaoren, 2), E(Qingniao, 1)).After(1, 1.8f).Hint("先打水母的灯芯，断开它给同伴的回血"))
                .Gather(0.6f).Distance(10, 36).Elites(1, "frenzied"), "upgrade");
            var sD = Site("D", "瑶台", SiteD, 24, 30, EncounterSpec.Of(
                    Wave("狐巫冰壁", E(Fox, 2), E(Xingxing, 2), E(Qingniao, 1)).Hint("狐巫在立冰壁——打碎她的铜镜，冰壁就立不起来"),
                    Wave("冰甲旋龟", E(XuanGui, 1).Elite("shielded"), E(Haozhi, 2), E(Fuzhu, 1), E(Jelly, 1)).After(1, 2f)
                        .Hint("精英旋龟缩壳旋转，会在冰壁之间反弹——等它过热翻倒再打散热孔"))
                .Gather(1.5f).Distance(10, 36), "weapon:min=1");
            sD.requires = new[] { sB, sC };
            var sG = Site("G", "冻船伏兵", SiteG, 14, 18, EncounterSpec.Of(
                    Wave("冰下伏兵", E(Jiaoren, 2), E(Puffer, 1), E(Fuzhu, 1).Elite("swift")).Hint("冻船里埋着伏兵"))
                .Gather(0.4f).Distance(8, 28), "");
            sG.autoTrigger = false;
            sG.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "渡过瑶池";
            objective.required = new[] { sA, sB, sC, sD };
            objective.optional = new[] { sG };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 藏宝（CachePOI）：东南岸渔营（无守军，灵石，宝物堆 = 珍珠堆）；西北湖面的冻船（惊动伏兵 G，肃清后给灵兽封印，宝物堆 = 玉器堆）。
        /// 模型放在藏宝点旁 2 m，宝箱从藏宝点本身冒出来
        /// </summary>
        static void BuildCaches(Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            CachePOI Cache(string title, Vector2 at, Vector2 from, string reward, EncounterSite guardSite, string modelId, Vector2 modelOffset, float modelScale)
            {
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                var face = (from - at).normalized;
                var rot = Quaternion.LookRotation(new Vector3(face.x, 0, face.y));
                poi.transform.SetPositionAndRotation(OnGround(at), rot);
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = 14;
                var mAt = at + modelOffset;
                float baseY = OnGround(mAt).y - 0.1f;
                var model = PutAt(modelId, poi.transform, mAt, baseY, rot.eulerAngles.y, modelScale);
                if (model)
                {
                    // Prefab 按父物体的局部坐标摆（藏宝点自己有位置和朝向），这里按世界坐标放回去
                    model.name = "Model";
                    model.transform.SetPositionAndRotation(At(mAt, baseY), rot);
                }
                return poi;
            }
            Cache("岸边渔营", CampPoi, new Vector2(56, -44), "coins", null, PearlHoardId, new Vector2(1.8f, -1.5f), 1f);
            Cache("冻船", JunkPoi, new Vector2(-36, 14), "pet", guard, JadeHoardId, new Vector2(-2f, -1.5f), 0.8f);
        }

        /// <summary>出口传送门：嵌在二层玉阶上出口祭坛的正面（没有祭坛模型时自己立石门框），关卡目标完成后升起、落清关宝箱</summary>
        static ExitPortal BuildExit(GameObject shrine, LevelObjective objective, Transform markers)
        {
            var portal = new GameObject("Exit Portal").AddComponent<ExitPortal>();
            portal.transform.SetParent(markers, false);
            var face = shrine ? shrine.transform.forward : Vector3.back;
            face.y = 0;
            face.Normalize();
            var at = ShrineAt + new Vector2(face.x, face.z) * 1.2f;
            portal.transform.SetPositionAndRotation(OnGround(at), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
            return portal;
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查本关的件（冰面牵引区、冰窟窿水体、遭遇、藏宝、出口）；顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, List<SurfaceZone> ice, List<WaterVolume> waters, ExitPortal portal)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");

            int sites = Count<EncounterSite>(), caches = Count<CachePOI>(), portals = Count<ExitPortal>(), zones = Count<SurfaceZone>(), pools = Count<WaterVolume>();
            float iceArea = ice.Sum(z => z.transform.localScale.x * z.transform.localScale.z);
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1），藏宝 {caches}，出口 {portals}；冰面牵引区 {zones} 条（约 {iceArea:F0} m²），冰窟窿水体 {pools} 处");
            if (sites != 5) rep.Fail($"遭遇场地有 {sites} 个（应为 5）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2：渔营、冻船）");
            if (portals != 1 || !portal || !portal.objective) rep.Fail($"出口传送门 {portals} 个（应 1，且接上 LevelObjective）");
            else rep.Line($"✓ 出口传送门在二层玉阶，接关卡目标（必清 {portal.objective.required.Length} 处，可选 {portal.objective.optional.Length} 处）；下一关 {RunPlan.Next(RunPlan.Get("2-3"))?.Label ?? "?"}");
            if (zones == 0 || iceArea < 8000) rep.Fail($"冰面牵引区只有 {zones} 条、{iceArea:F0} m²（湖面约 15000 m²）");
            if (pools < Holes.Length || waters.Count(w => w) < Holes.Length) rep.Fail($"冰窟窿水体 {pools} 处（应为 {Holes.Length}）");
            var d = portal && portal.objective ? portal.objective.required.FirstOrDefault(s => s && s.requires != null && s.requires.Length > 0) : null;
            if (!d || d.requires.Length != 2) rep.Fail("瑶台没有写 requires（应为西岸祭坛 + 东岸船坞）");
            else rep.Line($"✓ 「{d.title}」requires = {string.Join(" + ", d.requires.Select(s => s.title))}，其余必清场地顺序不限");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线路点（出生 → 栈桥头 → 冰面 → 白玉台 → 南小岛 → 祭坛 → 祭坛台 → 北小岛 → 船坞 → 南码头 → 船屋台 → 瑶台 → 两层玉阶 → 出口）、
        /// 坡道坡度、5 条地标视线、场地尺寸 / 掩体 / 层数阈值（只防退化，实测看报告）。可玩区遮罩与软边界同一个；界外是 18 m 以上的连续雪崖，防越界由地形保证。
        /// 站位、宝箱落点、藏宝、出口、占位件由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec(Vector3 pavTop, Vector3 wayshrineTop, Vector3 lighthouseTop, Vector3 exitTop, Vector3 mastTop)
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var spec = new LevelSpec
                {
                    id = "2-3", title = "瑶池冰湖", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        S("出生·南岸栈桥（缓冲）", Spawn, 30, combat: false),
                        S("A 湖心冰光", SiteA, 64, cover: 4, layers: 3, overlook: true),
                        S("B 西岸祭坛", SiteB, 48, cover: 3, layers: 2, overlook: true),
                        S("C 东岸船坞", SiteC, 52, cover: 4, layers: 2, overlook: true),
                        S("D 瑶台", SiteD, 48, cover: 3, layers: 2, overlook: true),
                    },
                }
                .Route("出生·南岸栈桥", G(Spawn)).Route("栈桥头", G(PierTip + new Vector2(0, -2))).Route("A 冰面", G(SiteA))
                .Route("A 湖心亭白玉台", G(PavC + new Vector2(0, -8.5f))).Route("A 南小岛顶", G(Islets[1].c))
                .Route("B 西岸祭坛", G(SiteB)).Route("B 祭坛台", G(StageC + new Vector2(2, 0)))
                .Route("A 北小岛顶", G(Islets[0].c)).Route("C 东岸船坞", G(SiteC)).Route("C 南码头", G(new Vector2(86, -22)))
                .Route("C 船屋台", G(BoatC + new Vector2(0, -2))).Route("D 瑶台", G(SiteD)).Route("D 一层玉阶", G(new Vector2(-12, 86)))
                .Route("D 二层玉阶", G(new Vector2(-5, 91))).Route("出口", G(ShrineAt + new Vector2(0, -4.7f)))
                .Sight("出生 → 湖心亭", G(Spawn, 1.62f), pavTop, 6, PavilionId)
                .Sight("出生 → 冻船桅杆", G(Spawn, 1.62f), mastTop, 5, JunkId)
                .Sight("湖心亭台 → 西岸经幡祠", At(PavC + new Vector2(-9, 0), PavY + 1.62f), wayshrineTop, 5, WayshrineId)
                .Sight("湖心亭台 → 东岸灯塔", At(PavC + new Vector2(9, 0), PavY + 1.62f), lighthouseTop, 6, LighthouseId)
                .Sight("湖面北岸 → 瑶台出口祭坛", G(new Vector2(0, 46), 1.62f), exitTop, 6, ShrineId);
            spec.slopePaths.Add(new SlopePath { name = "栈桥", points = new[] { PierRoot, PierTip } });
            foreach (var r in Ramps) spec.slopePaths.Add(new SlopePath { name = r.name, points = new[] { r.foot, r.top } });
            return spec;
        }
    }
}
