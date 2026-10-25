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
    /// 2-2 昆仑天阙 · 开明九门（docs/level-design/maps/2-2.md；parity D3「2-2 合并 V2 的玉阶雪关和开明九门」、3.10、M22）：
    /// 关卡坐标 = 世界 XZ，x 向东、z 向北，z 就是上坡方向。一整面朝南的山坡被 L4 的阶梯坡（<see cref="Landform.SteppedSlope"/>）切成一级级 3.6 m 的白玉台地：
    ///
    ///   出生·山门 (−4, 4) y 0 → 下坡 S1（L1 3.6 / L2 7.2，F0 / F1W·F1E / F2C·F2E 之字台阶）→ ① 玉阶月台 (2, 50)：L1 中间 +3 m 的挡墙月台
    ///   → ② 九门外庭 (6, 104) y 10.8：北缘是九门挡土墙（S2 第一道墙），开三道门（西 / 中 / 东），封六道
    ///   → 上坡 S2（U1 14.4 / U2 18.0）：每道门接三段天阶（G0 / G1 / G2），U1、U2 上可以横着换路
    ///   → ③ 开明兽庭 (0, 214) y 21.6：十字四角是 +3.6 m 的墩台，中央 2.6 m 基座上坐着开明兽巨像；中门进南翼、西门进西翼、东门进东翼
    ///     （遭遇 / L5 的场地圆心在基座南坡道 (0, 202)：巨像脚下的导航网格是孤岛）
    ///   → 北翼神道（21.6 → 25.2）→ ④ 玉京殿前 (0, 282) y 25.2：两座殿前月台，北崖下天阙（青铜门阙）框住出口祭坛 (0, 300)。
    ///   藏宝：东路 U2 东端崖边小径尽头的钟亭（A，无守军）；西台地西缘凿进崖里的玉库（B，惊动 ⑤ 守军）。
    ///
    /// 台阶全部是 <see cref="LevelKit.TerraceFlight"/>（贴墙斜填的直台阶，只填不挖）；挡土墙在地形里是 1.2 m 宽的陡坎，
    /// 上面沿墙线连排 SM_Tripo_FrostJadeRetainingWall（<see cref="LevelKit.TerraceWallRuns"/>，台阶处自动断开）。
    /// 边界（D14，没有空气墙）：游玩区闭合多边形 + 两条岔道，线外 8–13 m 内陡升成比该处台面高 16–30 m 的雪岭绝壁（坡脚以上 10 m 起切窄雪台），防越界由地形保证；软边界（主题 Frost）只做兜底。
    /// 场景只放环境和标记（D17 / L1）。生成：Spiritfire ▸ Levels ▸ Build 2-2 昆仑天阙（或 bridge.sh level 2-2）。冒烟：bridge.sh playtest map-2-2（Map22Suite）。
    /// </summary>
    [LevelBuilder("2-2", ScenePath)]
    public static class Level_2_2
    {
        public const string Dir = "Assets/Levels/L2_2_Kunlun";
        public const string ScenePath = "Assets/Scenes/L2_2_Kunlun.unity";
        const string Name = "L2_2";

        // 高度场里 Base 米 = 世界 y 0；地形外缘落回远景地面 PlainY（山下的谷地）
        const float Base = 30f, HeightRange = 120f, PlainY = -24f;
        static readonly Vector2 Origin = new(-256, -136), Size = new(512, 512);
        /// <summary>雾（主题默认 25 / 210 m）：调远，出生点看 210 m 外的巨像还剩轮廓</summary>
        const float FogStart = 60f, FogEnd = 380f;
        /// <summary>盛行风（风吹去的方向）：从北面雪岭顺坡往下吹</summary>
        static readonly Vector2 Wind = new Vector2(0.35f, -0.94f).normalized;

        /// <summary>软边界（L3）：主题 Frost（风雪白化），等值线在绝壁面上，26 m 外兜底碰撞</summary>
        static readonly LevelKit.BoundarySpec Bounds = FrostBounds();

        static LevelKit.BoundarySpec FrostBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Frost";
            return b;
        }

        // ───────────── 台地（世界 y）─────────────
        /// <summary>每级抬高（= 挡土墙墙身高）与地形里陡坎的水平宽</summary>
        const float H = 3.6f, WallRun = 1.2f;
        const float L1Y = 3.6f, L2Y = 7.2f, CourtY = 10.8f, U1Y = 14.4f, U2Y = 18f, TopY = 21.6f, HallY = 25.2f;
        /// <summary>玉京殿前那一级的墙线（全宽）</summary>
        const float HallZ = 262f;

        /// <summary>下坡 S1（玉阶）：出生雪坳 → L1 → L2 → 外庭；台面进深 24 m</summary>
        static readonly SteppedSlopeSpec S1 = new()
        {
            origin = new Vector2(0, 30), angle = 90, shelfDepth = 24, stepHeight = H, wallRun = WallRun, steps = 3, bend = 2, seed = 22,
        };

        /// <summary>上坡 S2（天阶）：外庭 → U1 → U2 → 兽庭；第一道墙就是九门挡土墙，台面进深 18 m</summary>
        static readonly SteppedSlopeSpec S2 = new()
        {
            origin = new Vector2(0, 124), angle = 90, shelfDepth = 18, stepHeight = H, wallRun = WallRun, steps = 3, bend = 1.5f, seed = 23,
        };

        /// <summary>阶梯坡的横向坐标：上坡方向是 +z 时 across = −x（SteppedSlope 的 side = (−1, 0)）</summary>
        static float Across(float x) => -x;

        // ───────────── 场地（世界 XZ）─────────────
        static readonly Vector2 Spawn = new(-4, 4), Site1 = new(2, 50), Site2 = new(6, 104), Site3 = new(0, 214), Site4 = new(0, 282), Site5 = new(-74, 220),
            ShrineC = new(0, 300), GatewayC = new(0, 307.5f), CacheA = new(108.7f, 152), CacheB = new(-101, 220), BellC = new(113, 152);
        /// <summary>
        /// ③ 开明兽庭的场地中心（遭遇触发圈 / 刷怪兜底圈的圆心、L5 场地圆心）：基座南坡道上、基座南沿前 2 m（地形，和出生点连通）。
        /// 不用 <see cref="Site3"/>：那是巨像的位置，脚下的导航网格被巨像围成孤岛（整局冒烟：从出生点没有完整路径，传送到中心刷不出怪）
        /// </summary>
        static readonly Vector2 CourtCenter = Site3 + new Vector2(0, -12);

        /// <summary>游玩区多边形（南缘自西向东，东缘往北，北缘往西，西缘往南）：线外是连续的雪岭绝壁</summary>
        static readonly Vector2[] Envelope =
        {
            new(-30, -12), new(-8, -16), new(22, -12), new(30, 4), new(36, 22), new(62, 30), new(68, 54), new(78, 80), new(88, 86), new(90, 122),
            new(94, 128), new(96, 160), new(98, 166), new(98, 196), new(96, 232), new(94, 258), new(86, 266), new(80, 296), new(60, 308), new(20, 312),
            new(-20, 312), new(-60, 308), new(-82, 296), new(-88, 266), new(-96, 258), new(-98, 232), new(-98, 166), new(-96, 160), new(-94, 128), new(-90, 122),
            new(-88, 86), new(-78, 80), new(-66, 54), new(-60, 30), new(-36, 22), new(-32, 4),
        };

        /// <summary>岔道（并进游玩区的胶囊）：东 = U2 东端通钟亭的崖边小径，西 = 西台地西缘的玉库</summary>
        static readonly (Vector2 a, Vector2 b, float r)[] Spurs = { (new Vector2(90, 152), new Vector2(112, 152), 6.5f), (new Vector2(-90, 220), new Vector2(-106, 220), 8f) };

        // ── 兽庭：十字四角的墩台（+3.6 m）；NW / NE 往北压进殿前那一级，接缝处不塌 ──
        static readonly (Vector2 min, Vector2 max)[] Bastions =
        {
            (new Vector2(-48, 162.4f), new Vector2(-16, 198)), (new Vector2(16, 162.4f), new Vector2(48, 198)),
            (new Vector2(-48, 230), new Vector2(-16, 266)), (new Vector2(16, 230), new Vector2(48, 266)),
        };
        /// <summary>北翼神道：21.6（z 230）→ 25.2（z 262）的缓坡</summary>
        static readonly Vector2 ArmMin = new(-16, 226), ArmMax = new(16, 266);
        const float ArmZ0 = 230, ArmZ1 = 262;

        /// <summary>巨像基座（+2.6 m，比俯射层门槛 2.5 m 高一点）</summary>
        static readonly Vector2 PedMin = new(-10, 204), PedMax = new(10, 224);
        const float PedY = TopY + 2.6f;
        /// <summary>① 挡墙月台（+3.0 m：雪狌狌翻得上来，攀爬上限 3.5 m）</summary>
        static readonly Vector2 StageMin = new(-20, 40), StageMax = new(16, 47);
        const float StageY = L1Y + 3f;
        /// <summary>④ 东西殿前月台（+3.0 m，夹着出口祭坛；离殿前中心 ≤ 26 m，是殿前场地的俯射层）</summary>
        static readonly (Vector2 min, Vector2 max)[] HallPlatforms = { (new Vector2(-36, 286), new Vector2(-16, 296)), (new Vector2(16, 286), new Vector2(36, 296)) };
        const float PlatformY = HallY + 3f;

        // ── 九门：三道开着的门（天阶 x、宽）与门阙；六道封门 ──
        static readonly (string name, string code, float x, float width)[] Gates = { ("西门", "W", -58, 8), ("中门", "C", 0, 12), ("东门", "E", 58, 8) };
        const float TowerScale = 1.15f, TowerHalfW = 3.35f * TowerScale;

        /// <summary>门阙的 x：门 g 的 side 侧（−1 西、+1 东），离天阶边 1.5 m</summary>
        static float TowerX(int g, int side) => Gates[g].x + side * (Gates[g].width * 0.5f + 1.5f + TowerHalfW);
        static readonly float[] SealedGates = { -79.5f, -38, -22, 22, 38, 79.5f };

        // ───────────── 台阶（全部只填不挖；坡 ≤ 17°）─────────────
        static readonly LevelKit.TerraceFlight[] Flights = BuildFlights();

        static LevelKit.TerraceFlight[] BuildFlights()
        {
            LevelKit.TerraceFlight S1F(string name, int k, float x, float width) => LevelKit.FlightOverWall(name, S1, k, Across(x), 0, width, 15);
            LevelKit.TerraceFlight S2F(string name, int k, float x, float width) => LevelKit.FlightOverWall(name, S2, k, Across(x), CourtY, width, 14);
            LevelKit.TerraceFlight Abs(string name, Vector2 foot, Vector2 top, float footY, float topY, float width) => new(name, foot, top, footY, topY, width);
            return new[]
            {
                // 玉阶（之字）
                S1F("F0 雪坳 → L1", 0, -6, 10),
                S1F("F1W L1 → L2", 1, -44, 8), S1F("F1E L1 → L2", 1, 40, 8),
                S1F("F2C L2 → 外庭", 2, -2, 10), S1F("F2E L2 → 外庭", 2, 44, 8),
                // 三道门的天阶：中路三段首尾相接，西路 / 东路每级往外偏 4 m
                S2F("G0W 西门", 0, -58, 8), S2F("G0C 中门", 0, 0, 12), S2F("G0E 东门", 0, 58, 8),
                S2F("G1W 西天阶", 1, -62, 8), S2F("G1C 中天阶", 1, 0, 12), S2F("G1E 东天阶", 1, 62, 8),
                S2F("G2W 西天阶顶", 2, -66, 8), S2F("G2C 中天阶顶", 2, 0, 12), S2F("G2E 东天阶顶", 2, 66, 8),
                // 南翼上 SW / SE 墩台（墩台东西面在 x ±16，坡顶压过墙顶 0.4 m）
                Abs("SW 墩台台阶", new Vector2(-3, 174), new Vector2(-17, 174), TopY, HallY, 6),
                Abs("SE 墩台台阶", new Vector2(3, 188), new Vector2(17, 188), TopY, HallY, 6),
                // 巨像基座南北坡道（北坡道脚在神道上）
                Abs("基座南坡道", new Vector2(0, 192.9f), new Vector2(0, 204.9f), TopY, PedY, 6),
                Abs("基座北坡道", new Vector2(0, 235.1f), new Vector2(0, 223.1f), ArmY(235.1f), PedY, 6),
                // ① 挡墙月台东西坡道
                Abs("月台西坡道", new Vector2(-31.2f, 43.5f), new Vector2(-19.2f, 43.5f), L1Y, StageY, 6),
                Abs("月台东坡道", new Vector2(27.2f, 43.5f), new Vector2(15.2f, 43.5f), L1Y, StageY, 6),
                // ④ 殿前月台坡道
                Abs("西殿前月台坡道", new Vector2(-23, 274.4f), new Vector2(-23, 286.9f), HallY, PlatformY, 6),
                Abs("东殿前月台坡道", new Vector2(23, 274.4f), new Vector2(23, 286.9f), HallY, PlatformY, 6),
            };
        }

        static LevelKit.TerraceFlight FlightNamed(string prefix) => Flights.First(f => f.name.StartsWith(prefix));

        // ── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深；正面 +Z）──
        const string WallId = "SM_Tripo_FrostJadeRetainingWall", KaimingId = "SM_Tripo_FrostKaiming", GatewayId = "SM_Tripo_FrostGateway",
            ShrineId = "SM_Tripo_FrostPortalShrine", TowerId = "SM_Tripo_FrostCornerTower", SealedGateId = "SM_Env_FrostGate", BlockId = "SM_Tripo_FrostPlatformBlock",
            PillarId = "SM_Tripo_FrostIcePillar", BellId = "SM_Tripo_FrostBellPavilion", HoardId = "SM_Tripo_FrostJadeHoard", RampartId = "SM_Tripo_FrostRampart",
            LanternId = "SM_Tripo_FrostIceLantern";

        /// <summary>巨像、天阙按「+Z 是正面」朝南摆；模型正面不是 +Z 时改这两个</summary>
        const float KaimingYaw = 180f, GatewayYaw = 180f;
        const float KaimingScale = 1.5f, GatewayScale = 2.2f;
        /// <summary>挡土墙段：墙身占整件高度的比例（墙身 5.4 m + 栏板 1.1 m）、进深缩放、轴心往高处挪、往地下埋</summary>
        const float WallBody = 5.4f / 6.5f, WallDepth = 0.8f, WallShift = 0.25f, WallSink = 0.15f, WallParapet = 1.0f;

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [WallId] = new(7.02f, 6.5f, 2.26f), [KaimingId] = new(8.13f, 15.54f, 7.88f), [GatewayId] = new(12f, 11.15f, 3.9f), [ShrineId] = new(10.46f, 10.93f, 2.94f),
            [TowerId] = new(6.7f, 13.15f, 5.58f), [SealedGateId] = new(10.92f, 6.6f, 2.28f), [BlockId] = new(4.94f, 2.93f, 4.97f), [PillarId] = new(2.52f, 5.46f, 2.69f),
            [BellId] = new(5.14f, 8.5f, 5.1f), [HoardId] = new(2.82f, 1.72f, 1.67f), [RampartId] = new(7.82f, 8.82f, 2.58f), [LanternId] = new(0.9f, 2.36f, 0.89f),
            ["SM_Tripo_FrostOfferings"] = new(1.74f, 1.54f, 1.3f), ["SM_Tripo_FrostCoverWall"] = new(5.57f, 2.47f, 1.49f),
            ["SM_Tripo_FrostBarricade"] = new(4.44f, 1.18f, 0.41f), ["SM_Tripo_FrostColumnRuin"] = new(4.08f, 1.58f, 2.1f),
            ["SM_Tripo_FrostIcicleShards"] = new(1.68f, 1f, 1.23f), ["SM_Tripo_FrostPrayerTent"] = new(4f, 3.53f, 3.86f),
            ["SM_Prop_FrostPrayerCairn"] = new(1.05f, 1.97f, 0.72f), ["SM_Env_FrostWayshrine"] = new(4.19f, 4.84f, 3.3f),
        };

        // ── 第二章阵容 ──
        const string Xingxing = "xingxing", Qingniao = "qingniao", Haozhi = "haozhi", Fuzhu = "fuzhu", XuanGui = "xuangui", FoxWitch = "fox_witch";

        /// <summary>
        /// 刷怪站位（标记名、属于哪个场地、世界 XZ、角色、lane、高台、散开半径）。高台只给飞的青鸟（第二章其余都贴地）；
        /// 贴地的远程 / 精确站在 NavMesh 走得上去的高处（L2、U1、SE 墩台、东殿前月台）。全部离道具 ≥ 4 m、离挡土墙 ≥ 5 m，放得下精英旋龟。
        /// </summary>
        static readonly (string name, int site, Vector2 at, SG.StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_1_L2_W", 1, new Vector2(-26, 64), SG.StationRole.Assault, 1, false, 2.2f),
            ("Enemy_1_L2_E", 1, new Vector2(28, 66), SG.StationRole.Assault, 2, false, 2.2f),
            ("Enemy_1_L2_Ranged", 1, new Vector2(16, 70), SG.StationRole.Ranged, 0, false, 2f),
            ("Enemy_1_FlankW", 1, new Vector2(-32, 36), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_1_FlankE", 1, new Vector2(32, 35.5f), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_1_Stage", 1, new Vector2(-2, 43.5f), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_2_U1_W", 2, new Vector2(-30, 133), SG.StationRole.Ranged, 1, false, 2f),
            ("Enemy_2_U1_E", 2, new Vector2(32, 133), SG.StationRole.Precision, 2, false, 2f),
            ("Enemy_2_Perch", 2, new Vector2(-16, 134), SG.StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_2_FlankW", 2, new Vector2(-42, 98), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_2_FlankE", 2, new Vector2(52, 96), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_2_Assault", 2, new Vector2(26, 114), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_3_North", 3, new Vector2(0, 248), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_3_WestArm", 3, new Vector2(-38, 214), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_3_EastArm", 3, new Vector2(38, 214), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_3_SE_Bastion", 3, new Vector2(32, 182), SG.StationRole.Precision, 2, false, 2f),
            ("Enemy_3_SW_Bastion", 3, new Vector2(-32, 182), SG.StationRole.Ranged, 1, true, 1.5f),
            ("Enemy_3_Support", 3, new Vector2(-8, 244), SG.StationRole.Support, 0, false, 2f),
            ("Enemy_4_Assault_W", 4, new Vector2(-8, 287), SG.StationRole.Assault, 1, false, 2.2f),
            ("Enemy_4_Assault_E", 4, new Vector2(10, 285), SG.StationRole.Assault, 2, false, 2.2f),
            ("Enemy_4_Platform_W", 4, new Vector2(-28, 292), SG.StationRole.Ranged, 1, true, 1.5f),
            ("Enemy_4_Platform_E", 4, new Vector2(28, 292), SG.StationRole.Precision, 2, false, 1.5f),
            ("Enemy_4_Support", 4, new Vector2(-11, 295), SG.StationRole.Support, 0, false, 1.5f),
            ("Enemy_4_FlankW", 4, new Vector2(-66, 276), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_4_FlankE", 4, new Vector2(66, 276), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_5_Flank", 5, new Vector2(-70, 236), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_5_Ranged", 5, new Vector2(-78, 202), SG.StationRole.Ranged, 0, false, 2.2f),
            ("Enemy_5_Auto", 5, new Vector2(-60, 222), SG.StationRole.Auto, 2, false, 2.2f),
        };

        /// <summary>路线标记（冒烟测试读）：三道门的门脚 / 天阶顶、东路的 U1 / U2 平台、钟亭小径、东西两翼口</summary>
        static readonly (string name, Vector2 at)[] RouteMarks =
        {
            ("Route_GateW_Foot", new Vector2(-58, 104)), ("Route_GateW_Top", new Vector2(-66, 170)), ("Route_WestArm", new Vector2(-54, 214)),
            ("Route_GateC_Foot", new Vector2(0, 104)), ("Route_GateC_Top", new Vector2(0, 170)),
            ("Route_GateE_Foot", new Vector2(58, 104)), ("Route_GateE_U1", new Vector2(60, 128)), ("Route_GateE_U2", new Vector2(64, 147.5f)),
            ("Route_Bell", new Vector2(100, 152)), ("Route_GateE_Top", new Vector2(66, 170)), ("Route_EastArm", new Vector2(54, 214)),
        };

        /// <summary>主线与两条侧路（散布避让用）</summary>
        static readonly Vector2[][] RouteLines =
        {
            new[] { Spawn, new(-6, 20), new(-6, 34), Site1, new(-2, 70), new(-2, 84), Site2, new(0, 128), new(0, 170), new(0, 200), Site3, new(0, 250), Site4, ShrineC },
            new[] { new Vector2(-44, 40), new(-44, 60), new(-58, 104), new(-62, 140), new(-66, 170), new(-54, 214), new(-100, 220) },
            new[] { new Vector2(40, 40), new(44, 84), new(58, 104), new(62, 140), new(110, 152), new(66, 170), new(54, 214) },
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        /// <summary>北翼神道的高度</summary>
        static float ArmY(float z) => TopY + H * Mathf.Clamp01((z - ArmZ0) / (ArmZ1 - ArmZ0));

        /// <summary>殿前那一级（全宽）</summary>
        static float HallStep(Vector2 q) => H * Smooth(HallZ - WallRun * 0.5f, HallZ + WallRun * 0.5f, q.y);

        /// <summary>台地本身（两段阶梯坡 + 殿前一级，不含墩台、台阶）：绝壁跟着它一级级往上走</summary>
        static float Level(Vector2 q) =>
            SteppedSlope(q, S1, out _, out _, out _, out _) + SteppedSlope(q, S2, out _, out _, out _, out _) + HallStep(q);

        /// <summary>
        /// 台地的上包络（只随 z 变）：每道墙最早可能到顶的位置（墙线弯曲按最大幅度算）连到下一级，线性插值——处处 ≥ <see cref="Level"/>。
        /// 绝壁顶往外换成它当基准：阶梯坡在横向是无限延伸的，直接用 Level 会在外面的雪岭上留下一道道笔直的台阶线。
        /// </summary>
        static readonly Vector2[] TrendKnots = BuildTrend();

        static Vector2[] BuildTrend()
        {
            var k = new List<Vector2> { new(S1.origin.y - Mathf.Abs(S1.bend) - 4, 0) };
            foreach (var (s, baseY) in new[] { (S1, 0f), (S2, CourtY) })
                for (int i = 0; i < s.steps; i++)
                    k.Add(new Vector2(s.origin.y + i * (s.shelfDepth + s.wallRun) - Mathf.Abs(s.bend) + s.wallRun, baseY + (i + 1) * s.stepHeight));
            k.Add(new Vector2(HallZ + WallRun * 0.5f, HallY));
            return k.ToArray();
        }

        static float Trend(float z) => LevelKit.Piecewise(z, TrendKnots);

        /// <summary>矩形台（墩台、基座、月台）的遮罩：边线居中、edge 米宽的陡坎</summary>
        static float BoxMask(Vector2 q, Vector2 min, Vector2 max, float edge) => 1 - Smooth(-edge * 0.5f, edge * 0.5f, LevelKit.BoxSdf(q, min, max));

        /// <summary>游玩区内的地面分量（分层 / 散布用）：edge = 台阶两侧的陡边与台基 / 墩台 / 基座的边沿（露岩和碎石，不铺雪）</summary>
        struct Parts
        {
            public float wall, flight, paved, block, edge;
        }

        /// <summary>矩形台遮罩的边沿带（遮罩 0.5 处最大）</summary>
        static float EdgeBand(float mask) => 4f * mask * (1 - mask);

        /// <summary>不含噪声、不含绝壁的地面（台阶两端、摆件底座、挡土墙段都从这里取）</summary>
        static float Ground0(Vector2 q) => Interior(q, out _);

        static float Interior(Vector2 q, out Parts m)
        {
            m = default;
            float a = SteppedSlope(q, S1, out _, out float w1, out _, out _);
            float b = SteppedSlope(q, S2, out _, out float w2, out _, out _);
            float h = a + b + HallStep(q);

            // ── 兽庭：墩台（+3.6）、北翼神道、基座 ──
            float bastion = 0;
            foreach (var (min, max) in Bastions) bastion = Mathf.Max(bastion, BoxMask(q, min, max, WallRun));
            if (bastion > 0) h = Mathf.Max(h, Mathf.Lerp(h, HallY, bastion));
            float arm = BoxMask(q, ArmMin, ArmMax, WallRun);
            if (arm > 0) h = Mathf.Max(h, Mathf.Lerp(h, ArmY(q.y), arm));
            float ped = BoxMask(q, PedMin, PedMax, 1f);
            if (ped > 0) h = Mathf.Max(h, Mathf.Lerp(h, PedY, ped));

            // ── ① 挡墙月台、④ 殿前月台 ──
            float stage = BoxMask(q, StageMin, StageMax, 0.8f);
            if (stage > 0) h = Mathf.Max(h, Mathf.Lerp(h, StageY, stage));
            float plat = 0;
            foreach (var (min, max) in HallPlatforms) plat = Mathf.Max(plat, BoxMask(q, min, max, 0.8f));
            if (plat > 0) h = Mathf.Max(h, Mathf.Lerp(h, PlatformY, plat));
            m.block = Mathf.Max(Mathf.Max(ped, stage), plat);
            // 殿前那一级的墙在北翼神道、NW / NE 墩台底下是埋着的（神道和墩台已经接平），那里不是墙
            m.wall = Mathf.Max(Mathf.Max(w1, w2), (1 - Mathf.Abs(Smooth(HallZ - 0.6f, HallZ + 0.6f, q.y) * 2 - 1)) * (1 - Mathf.Max(arm, bastion)));
            // 墩台的边沿只算比四周高的那几面（NW / NE 墩台在 z 262 以北和殿前接平，不是边）
            float bastionEdge = EdgeBand(bastion) * (1 - Smooth(HallZ - 1, HallZ + 1, q.y));
            m.edge = Mathf.Max(Mathf.Max(bastionEdge, EdgeBand(ped)), Mathf.Max(EdgeBand(stage), EdgeBand(plat)));

            // ── 台阶（只填）：两侧 2.5 m 的陡边（遮罩 0.1–0.9）算边沿 ──
            foreach (var f in Flights)
            {
                h = LevelKit.ApplyFlight(q, h, f, 2.5f, out float fm);
                m.flight = Mathf.Max(m.flight, fm);
                m.edge = Mathf.Max(m.edge, Smooth(0.03f, 0.2f, fm) * (1 - Smooth(0.8f, 0.97f, fm)));
            }

            // 铺砌面：外庭、兽庭十字、殿前（分层用）
            float cross = Mathf.Max(BoxMask(q, new Vector2(-16, 163), new Vector2(16, 262), 2f), BoxMask(q, new Vector2(-48, 198), new Vector2(48, 230), 2f));
            float paved = Mathf.Max(cross, Smooth(HallZ - 1, HallZ + 2, q.y));
            paved = Mathf.Max(paved, 0.7f * BoxMask(q, new Vector2(-95, 84), new Vector2(95, 122), 3f));
            m.paved = Mathf.Max(paved, Mathf.Max(bastion, m.block));
            m.wall *= 1 - m.flight;
            return h;
        }

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：多边形 + 岔道，边界线带噪声摆动（天阙、山门一带不摆）</summary>
        static float Inside(Vector2 q)
        {
            float ins = LevelKit.PolygonSigned(q, Envelope);
            float calm = Mathf.Max(Disc(q, GatewayC, 30, 10), Disc(q, new Vector2(-4, -12), 14, 6));
            ins += (Fbm(q, 22, 3, 61) * 2f + Fbm(q, 6, 2, 63) * 0.5f) * (1 - calm);
            foreach (var (a, b, r) in Spurs) ins = Mathf.Max(ins, r - LevelKit.SegmentDistance(q, a, b, out _));
            return ins;
        }

        /// <summary>可玩区遮罩（世界 XZ，软边界与 L5 共用）：等值线 0.2 落在绝壁面上（界外约 1.7 m）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        // ───────────── 雪岭（界外）：坡脚碎石坡 → 崖面（窄雪台）→ 雪峰；天阙背后是一座带侧脊的山 ─────────────
        /// <summary>坡脚内侧碎石坡：高、宽（米，能走）</summary>
        const float RimApron = 0.9f, RimApronWidth = 3f;
        /// <summary>崖高（坡脚以上）与崖面宽（界外米数）：同一个低频噪声在两端之间变，宽跟着高走（崖面坡度处处差不多，约 63–66°；再叠 FaceGully 的沟后 55–66°）</summary>
        const float CliffMin = 16f, CliffMax = 30f, FaceMin = 8f, FaceMax = 13f;
        /// <summary>崖面的沟：崖面宽按中频噪声最多放宽 FaceGully（坡脚不动，崖面上部往后退；只放宽不收窄），雪台跟着前后错动，不是一圈圈同心的看台</summary>
        const float FaceGully = 0.35f;
        /// <summary>
        /// 窄雪台：坡脚以上 LedgeFirst 米起每 LedgeStep 米一级，陡坎占一级的比例在两值之间变（台面宽窄不一）。
        /// 雪台沿崖面连成一圈（跟着台地往上爬），只要有一处够得着就能沿着它走出图：最低一级要比崖脚附近任何能站的东西
        /// （挡土墙栏板 +0.7 m、九门外的山门顶 6.3 m、低一级台地挨着高一级的崖）再加二段跳 2.7 m 都高，所以从 10 m 起（2-3 是空湖岸，6 m 就够）
        /// </summary>
        const float LedgeFirst = 10f, LedgeStep = 5.5f, LedgeRiserMin = 0.42f, LedgeRiserMax = 0.58f;
        /// <summary>雪峰：边界外 PeakStart 米起、PeakRun 米内升满，再高 PeakMin–PeakMax 米（山脊噪声）——崖顶不留一圈平台</summary>
        const float PeakStart = 3f, PeakRun = 35f, PeakMin = 6f, PeakMax = 30f;
        /// <summary>天阙背后的崖高：门阙顶（殿前 + 24.5 m）不能高过崖顶，不然站上门顶就能走出图（≥ 27 m）</summary>
        const float GateCliff = 30f;
        /// <summary>天阙背后的山：峰顶偏东北（不对称），两道侧脊（终点、脊高、半宽）往西南长、往东南短</summary>
        static readonly Vector2 SummitC = new(9, 338);
        const float SummitH = 26f, SummitR = 36f;
        static readonly (Vector2 end, float h, float w)[] GateSpurs = { (new Vector2(-42, 318), 15f, 10f), (new Vector2(36, 325), 10f, 7f) };

        /// <summary>崖高与崖面宽：低频噪声沿边界慢慢变；天阙背后拉到最高（GateCliff）</summary>
        static (float height, float face) CliffAt(Vector2 p)
        {
            float n = Mathf.Max(Smooth(-0.4f, 0.4f, Fbm(p, 80, 2, 31)), Disc(p, GatewayC, 20, 20));
            return (Mathf.Lerp(CliffMin, GateCliff, n), Mathf.Lerp(FaceMin, FaceMax, n));
        }

        /// <summary>
        /// 天阙背后的山（相对崖顶，米）：峰是凹面的锥（峰尖陡、坡往下渐缓，二次方），两道侧脊是尖棱（横截面 1.5 次方），表面再叠山脊噪声——
        /// 陡的棱和峰顶交给分层规则变岩，缓的坡和脊间的凹处积雪
        /// </summary>
        static float GateMassif(Vector2 p)
        {
            float k = Mathf.Clamp01(1 - Vector2.Distance(p, SummitC) / SummitR);
            float m = SummitH * k * k;
            foreach (var (end, hh, w) in GateSpurs)
            {
                float d = LevelKit.SegmentDistance(p, SummitC, end, out float t);
                float x = Mathf.Clamp01(1 - d / w);
                m = Mathf.Max(m, hh * Mathf.Pow(1 - t, 0.8f) * Mathf.Pow(x, 1.5f));
            }
            return m + 6f * (Ridged(p, 16, 3, 41) - 0.35f) * Smooth(1f, 8f, m);
        }

        /// <summary>
        /// 界外的雪岭，相对崖脚（ins = 离边界的有符号距离，界内为正）：坡脚内侧 3 m 碎石坡（0.9 m，能走）→ 界外 8–13 m 内陡升 16–30 m 的崖 →
        /// 边界外 3 m 起叠雪峰（再高 6–30 m）/ 天阙背后的山（取两者高的）。坡脚以上 10 m 起按 5.5 m 一级切窄雪台（台面平、陡坎是岩），
        /// 最低一级比坡脚高 10.9 m（含碎石坡），站在栏板、山门顶上二段跳也够不着，级与级之间也跳不上去；只切崖高以内，崖顶以上的雪峰不切。
        /// </summary>
        static float Rim(Vector2 p, float ins)
        {
            var (cliffH, faceW) = CliffAt(p);
            faceW *= 1 + FaceGully * Smooth(-0.1f, 0.45f, Fbm(p, 22, 3, 45));
            // 崖面剖面近乎直线（直线 65% + S 形 35%）：每级雪台的水平宽差不多，坡脚一离开碎石坡就陡
            float t = Mathf.Clamp01(-ins / faceW);
            float rel = cliffH * Mathf.Lerp(t, t * t * (3 - 2 * t), 0.35f);
            float peaks = Mathf.Lerp(PeakMin, PeakMax, Ridged(p, 70, 3, 9)) * Smooth(-PeakStart, -PeakStart - PeakRun, ins);
            rel += Mathf.Max(peaks, GateMassif(p) * Smooth(-2f, -12f, ins));
            if (rel > LedgeFirst)
            {
                float riser = Mathf.Lerp(LedgeRiserMin, LedgeRiserMax, Smooth(-0.4f, 0.4f, Fbm(p, 35, 2, 47)));
                float keep = 1 - Smooth(cliffH - 2, cliffH + 2, rel);
                rel = Mathf.Lerp(rel, LedgeFirst + Terrace(rel - LedgeFirst, LedgeStep, riser), keep);
            }
            return RimApron * Smooth(RimApronWidth, 0, ins) + rel;
        }

        static readonly Vector2[] Dirs4 = { Vector2.up, Vector2.down, Vector2.left, Vector2.right };

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float h = Interior(p, out var m);
            float ins = Inside(p);

            // 墙脚：往四个方向 2 m 处的地面比这里高出 0.8–2 m（挡土墙、墩台、台基、台阶侧边的脚下）——碎石只铺在这一带
            float foot = 0;
            if (ins > -1f)
                foreach (var d in Dirs4)
                    foot = Mathf.Max(foot, Smooth(0.8f, 2f, Ground0(p + d * 2f) - h));

            // 台面上的薄雪起伏（台阶、台基、铺砌面上没有）
            float drift = (1 - m.flight) * (1 - m.paved) * (1 - m.wall) * Smooth(1.5f, 4f, ins);
            if (drift > 0) h += Fbm(p, 9, 2, 5) * 0.08f * drift;

            // ── 外缘绝壁 + 再往外的雪岭：崖脚贴着台地一级级走；崖面往上换成台地的上包络（崖顶是连续的斜线），
            //    台阶线既不在崖顶上留方块、也不延伸进外面的雪岭 ──
            if (ins < 3f)
            {
                float lvl = Level(p);
                float rimBase = Mathf.Lerp(lvl, Mathf.Max(lvl, Trend(p.y)), Smooth(-0.5f, -4.5f, ins));
                h = Mathf.Max(h, rimBase + Rim(p, ins));
            }

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Frost：岩 → 冰 → 冻土 → 雪）──
            // 台面、庭院、台阶面以压实的雪为主；冻土碎石只在墙脚、台阶两侧的陡边、台基边沿、崖脚碎石坡（满铺冻土时碎石点满地，像豹纹）。
            // 界外不强制岩带：交给章节的坡度规则（陡的崖面、棱是岩，窄雪台和缓坡积雪）
            float inside = Smooth(-0.5f, 1.5f, ins);
            float scree = Smooth(RimApronWidth, 0.5f, ins);
            float tread = Smooth(0.9f, 0.99f, m.flight) * (1 - m.edge);
            s.rock = m.wall * inside;
            s.packed = inside * Mathf.Max(Mathf.Max(foot * 0.75f, m.edge * 0.6f), Mathf.Max(scree * 0.6f, tread * 0.25f));
            s.sand = inside * 0.95f * (1 - m.edge);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 2-2 昆仑天阙", priority = 66)]
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

        /// <summary>巨像头部（地标视线的目标）、天阙门楣</summary>
        static Vector3 KaimingHead => At(Site3 + new Vector2(0, 1), PedY + 15.54f * KaimingScale * 0.82f);
        static Vector3 TianqueLintel => At(GatewayC, HallY + 8.6f * GatewayScale);

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
                // 远景：近处岩脊 + 两圈雪峰；山下谷地接远景地面
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(0, 150), PlainY, 760, 5);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：北面雪岭顺坡下来的风；2-2 没有动态环境（变化来自高差），不放风暴区
                LevelKit.Weather(env, theme, Wind, 0.35f);

                int walls = BuildRetainingWalls(kit);
                BuildNineGates(kit, props);
                BuildStage(kit, props);
                BuildCourt(kit, props);
                var shrine = BuildHall(kit, props);
                BuildCaches(kit, props);
                BuildSpawnHollow(props);
                BuildScatter(props, theme);
                BuildMarkers(markers);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝巨像）+ 自举标记
                var spawnAt = OnGround(Spawn, 0.05f);
                var look = KaimingHead - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.normalized);
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
                rep.Line("2-2 昆仑天阙 · 开明九门 · 验收");
                rep.Line($"高度：雪坳 {OnGround(Spawn).y:F1}，L1 {OnGround(new Vector2(-30, 44)).y:F1}，L2 {OnGround(new Vector2(-20, 68)).y:F1}，外庭 {OnGround(Site2).y:F1}，" +
                         $"U1 {OnGround(new Vector2(-30, 133)).y:F1}，U2 {OnGround(new Vector2(-30, 152)).y:F1}，兽庭 {OnGround(new Vector2(-38, 214)).y:F1}，" +
                         $"墩台 {OnGround(new Vector2(-32, 182)).y:F1}，基座 {OnGround(new Vector2(8, 214)).y:F1}，殿前 {OnGround(Site4).y:F1}，殿前月台 {OnGround(new Vector2(-28, 292)).y:F1}");
                rep.Line($"挡土墙段 {walls} 段；台阶 {Flights.Length} 段，最陡（剖面）{Flights.Max(f => f.MaxGrade):F1}°");
                foreach (var g in Gates)
                {
                    var f0 = FlightNamed("G0" + g.code);
                    rep.Line($"  {g.name}：天阶脚 ({f0.foot.x:F0}, {f0.foot.y:F1}) → 顶 ({f0.top.x:F0}, {f0.top.y:F1})，宽 {g.width:F0} m");
                }
                LevelValidator.Run(Spec(), rep);
                CheckSiteCenters(rep, scene);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_2-2_report.txt");

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
            var center = new Vector2(0, 148);
            // 审核截图用临时机位（与玩家同一套相机 + 第一人称 rig），截完删掉
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_2-2", new[]
                {
                    ("Aerial", At(new Vector2(-150, -120), 170), At(new Vector2(0, 170), 10), false),
                    ("Map", new Vector3(center.x, 470, center.y - 1), new Vector3(center.x, 0, center.y), false),
                    ("Spawn", E(Spawn), KaimingHead, true),
                    ("Stage", E(new Vector2(-30, 36)), OnGround(new Vector2(0, 62), 3), false),
                    ("NineGates", E(new Vector2(4, 92)), OnGround(new Vector2(0, 126), 6), false),
                    ("GateEast", E(new Vector2(52, 100)), OnGround(new Vector2(62, 150), 2), false),
                    ("Tianjie", E(new Vector2(0, 128)), KaimingHead, false),
                    ("BellPath", E(new Vector2(84, 152)), OnGround(BellC, 4), false),
                    ("CourtSouth", E(new Vector2(0, 176)), KaimingHead, false),
                    ("CourtEast", E(new Vector2(52, 214)), KaimingHead - Vector3.up * 8, false),
                    ("Bastion", E(new Vector2(-30, 186)), OnGround(new Vector2(20, 230), 2), false),
                    ("Treasury", E(new Vector2(-80, 220)), OnGround(new Vector2(-108, 220), 1), false),
                    ("Hall", E(new Vector2(0, 250)), TianqueLintel, false),
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
        /// 摆一件资产：底面中心 = q、世界 y = baseY；有 Prefab 就按 scale（可非均匀）摆，
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

        static GameObject Kit(string id, Transform parent, Vector2 q, float baseY, float yaw, float scale = 1) => Kit(id, parent, q, baseY, yaw, Vector3.one * scale);

        /// <summary>贴地摆（底面埋进地面 sink 米）</summary>
        static GameObject KitOnGround(string id, Transform parent, Vector2 q, float yaw, float scale = 1, float sink = 0.1f) =>
            Kit(id, parent, q, OnGround(q).y - sink, yaw, scale);

        /// <summary>
        /// 挡土墙：S1、S2 的六道墙线（SteppedSlopeWalls，含弯曲）、墩台的三面、殿前那一级对着东西台地的两段，
        /// 每条线按地面高差切成墙段（台阶处自动断开），一段一件白玉挡土墙。S2 最后一道墙在 SW / SE 墩台下面换成墩台南面（7.2 m 高墙）。返回段数。
        /// </summary>
        static int BuildRetainingWalls(Transform kit)
        {
            var root = new GameObject("Retaining Walls").transform;
            root.SetParent(kit, false);
            var boxMat = LevelKit.Mat(Dir, "JadeWallPlaceholder", new Color(0.84f, 0.87f, 0.85f));
            Func<Vector2, bool> Keep = p => Inside(p) >= 2.5f;
            // S2 最后一道墙在 SW / SE 墩台下面由墩台南面代替
            Func<Vector2, bool> KeepUnderBastions = p => Keep(p) && !(Mathf.Abs(p.x) > 15f && Mathf.Abs(p.x) < 49f);
            var lines = new List<(string name, IReadOnlyList<Vector2> line, Func<Vector2, bool> keep)>();
            foreach (var (k, line) in SteppedSlopeWalls(S1, 110, 1f)) lines.Add(($"S1 Wall {k}", line, Keep));
            foreach (var (k, line) in SteppedSlopeWalls(S2, 110, 1f)) lines.Add(($"S2 Wall {k}", line, k == 2 ? KeepUnderBastions : Keep));
            for (int i = 0; i < Bastions.Length; i++)
            {
                var (min, max) = Bastions[i];
                bool south = i < 2;
                float zTop = south ? max.y : min.y, zFar = south ? min.y : Mathf.Min(max.y, HallZ);
                // 对着兽庭的一面、东西两面；南墩台再加一道南面（S2 最后一道墙在这里）
                lines.Add(($"Bastion {i} Court", LevelKit.TerraceEdge(new Vector2(min.x, zTop), new Vector2(max.x, zTop)), Keep));
                lines.Add(($"Bastion {i} West", LevelKit.TerraceEdge(new Vector2(min.x, zFar), new Vector2(min.x, zTop)), Keep));
                lines.Add(($"Bastion {i} East", LevelKit.TerraceEdge(new Vector2(max.x, zFar), new Vector2(max.x, zTop)), Keep));
                if (south) lines.Add(($"Bastion {i} South", LevelKit.TerraceEdge(new Vector2(min.x, min.y), new Vector2(max.x, min.y)), Keep));
            }
            lines.Add(("Hall West", LevelKit.TerraceEdge(new Vector2(-104, HallZ), new Vector2(-48, HallZ)), Keep));
            lines.Add(("Hall East", LevelKit.TerraceEdge(new Vector2(48, HallZ), new Vector2(104, HallZ)), Keep));

            int count = 0;
            foreach (var (name, line, keep) in lines)
            {
                var runs = LevelKit.TerraceWallRuns(line, Ground0, keep);
                var parent = new GameObject(name).transform;
                parent.SetParent(root, false);
                foreach (var r in runs)
                    if (LevelKit.PlaceTerraceWall(WallId, parent, r, WallBody, WallDepth, WallShift, WallSink, WallParapet, boxMat))
                        count++;
            }
            return count;
        }

        /// <summary>九门：三道开着的门两侧各一座门阙，门与门之间六道封门（贴着挡土墙立）</summary>
        static void BuildNineGates(Transform kit, Transform props)
        {
            var root = new GameObject("Nine Gates").transform;
            root.SetParent(kit, false);
            for (int g = 0; g < Gates.Length; g++)
                foreach (int side in new[] { -1, 1 })
                {
                    var c = LevelKit.SteppedWallPoint(S2, 0, Across(TowerX(g, side)));
                    var go = Kit(TowerId, root, c, CourtY - 0.3f, 180, TowerScale);
                    if (go) go.name = $"{TowerId} ({Gates[g].name}{(side < 0 ? "西" : "东")}阙)";
                }
            foreach (float x in SealedGates)
            {
                var c = LevelKit.SteppedWallPoint(S2, 0, Across(x));
                var at = c - new Vector2(0, WallRun * 0.5f + 0.15f + DesignSize[SealedGateId].z * 0.5f + 0.1f);
                var go = Kit(SealedGateId, root, at, CourtY - 0.2f, 180);
                if (go) go.name = $"{SealedGateId} (封门 {x:F0})";
            }
            // 外庭掩体：残墙、矮石栏、倒柱；西南角朝圣者的经幡帐与供品；中门两侧冰灯
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(-22, 96), 10);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(34, 108), -15);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(-8, 92), 0);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(18, 94), 0);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(-44, 112), 90);
            KitOnGround("SM_Tripo_FrostColumnRuin", props, new Vector2(-64, 96), 30);
            KitOnGround("SM_Tripo_FrostColumnRuin", props, new Vector2(70, 102), -20);
            KitOnGround("SM_Tripo_FrostPrayerTent", props, new Vector2(-76, 90), 60);
            KitOnGround("SM_Tripo_FrostOfferings", props, new Vector2(-70, 98), 20);
            KitOnGround(LanternId, props, new Vector2(-9.5f, 107), 0);
            KitOnGround(LanternId, props, new Vector2(9.5f, 107), 0);
        }

        /// <summary>白玉台基模块铺满一块矩形台（顶面比地形台面高 2 cm，看到的是台基铺面）：月台、基座、殿前月台</summary>
        static void PodiumBlocks(Transform parent, string name, Vector2 min, Vector2 max, float topY, float bottomY)
        {
            var root = new GameObject(name).transform;
            root.SetParent(parent, false);
            var d = DesignSize[BlockId];
            var size = max - min;
            int nx = Mathf.Max(1, Mathf.RoundToInt(size.x / d.x)), nz = Mathf.Max(1, Mathf.RoundToInt(size.y / d.z));
            float h = topY + 0.02f - bottomY;
            var scale = new Vector3(size.x / nx / d.x, h / d.y, size.y / nz / d.z);
            // 模块的轴心不在包围盒中心（+0.18 m 偏移），摆的时候补回来
            var pivot = new Vector2(0.184f * scale.x, 0.183f * scale.z);
            for (int i = 0; i < nx; i++)
            for (int j = 0; j < nz; j++)
            {
                var c = min + new Vector2((i + 0.5f) * size.x / nx, (j + 0.5f) * size.y / nz) - pivot;
                Kit(BlockId, root, c, bottomY, 0, scale);
            }
        }

        /// <summary>① 挡墙月台的台基与 L1 / L2 的掩体</summary>
        static void BuildStage(Transform kit, Transform props)
        {
            PodiumBlocks(kit, "Stage Podium", StageMin, StageMax, StageY, L1Y - 0.4f);
            KitOnGround("SM_Tripo_FrostColumnRuin", props, new Vector2(-44, 33), 15);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(18, 35), -8);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(-18, 36), 0);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(-16, 61), 5);
            KitOnGround("SM_Tripo_FrostColumnRuin", props, new Vector2(54, 61), 80);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(-44, 70), 0);
        }

        /// <summary>③ 开明兽庭：基座台基、巨像、四角冰柱、南墩台角楼、掩体与冰灯</summary>
        static void BuildCourt(Transform kit, Transform props)
        {
            PodiumBlocks(kit, "Kaiming Podium", PedMin, PedMax, PedY, TopY - 0.4f);
            var statue = Kit(KaimingId, kit, Site3, PedY - 0.05f, KaimingYaw, KaimingScale);
            if (statue && !IsPlaceholder(statue)) statue.name = $"{KaimingId} (开明兽巨像)";
            foreach (var c in new[] { new Vector2(-13.5f, 200.5f), new Vector2(13.5f, 200.5f), new Vector2(-13.5f, 227.5f), new Vector2(13.5f, 227.5f) })
                KitOnGround(PillarId, kit, c, c.x * 7 + c.y, 1.2f, 0.2f);
            // 南墩台外角的角楼：和中天阶一起像一道门
            Kit(TowerId, kit, new Vector2(-42.5f, 168), HallY - 0.2f, 180, TowerScale);
            Kit(TowerId, kit, new Vector2(42.5f, 168), HallY - 0.2f, 180, TowerScale);
            // 掩体：南翼冰棱碎块、西翼倒柱、东翼矮石栏、北翼残墙
            KitOnGround("SM_Tripo_FrostIcicleShards", props, new Vector2(10, 172), 30, 1.7f);
            KitOnGround("SM_Tripo_FrostIcicleShards", props, new Vector2(-10, 192), 200, 1.7f);
            KitOnGround("SM_Tripo_FrostColumnRuin", props, new Vector2(-30, 222), 90);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(30, 206), 90);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(12, 252), 0);
            foreach (var c in new[] { new Vector2(-12, 166), new Vector2(12, 166), new Vector2(-48, 202), new Vector2(-48, 226), new Vector2(48, 202), new Vector2(48, 226) })
                KitOnGround(LanternId, props, c, 0);
        }

        /// <summary>④ 玉京殿前：殿前月台台基、出口祭坛、天阙、殿立面（城墙段）、殿角楼、掩体；返回出口祭坛</summary>
        static GameObject BuildHall(Transform kit, Transform props)
        {
            for (int i = 0; i < HallPlatforms.Length; i++)
                PodiumBlocks(kit, i == 0 ? "Hall Platform West" : "Hall Platform East", HallPlatforms[i].min, HallPlatforms[i].max, PlatformY, HallY - 0.4f);
            var shrine = Kit(ShrineId, kit, ShrineC, HallY - 0.1f, 180);
            var gate = Kit(GatewayId, kit, GatewayC, HallY - 0.3f, GatewayYaw, GatewayScale);
            if (gate && !IsPlaceholder(gate)) gate.name = $"{GatewayId} (天阙)";
            float w = DesignSize[RampartId].x;
            foreach (int side in new[] { -1, 1 })
            {
                for (int i = 0; i < 5; i++)
                {
                    var c = new Vector2(side * (16.5f + w * (i + 0.5f)), 305.5f);
                    Kit(RampartId, kit, c, OnGround(c).y - 0.3f, 180);
                }
                Kit(TowerId, kit, new Vector2(side * 66, 298), OnGround(new Vector2(side * 66, 298)).y - 0.3f, 180, TowerScale);
            }
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(-6, 276), 0);
            KitOnGround("SM_Tripo_FrostBarricade", props, new Vector2(8, 272), 20);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(-54, 280), 90);
            KitOnGround("SM_Tripo_FrostCoverWall", props, new Vector2(56, 272), 90);
            KitOnGround(PillarId, props, new Vector2(-40, 268), 40, 1.1f, 0.2f);
            KitOnGround(PillarId, props, new Vector2(40, 268), 160, 1.1f, 0.2f);
            KitOnGround(LanternId, props, new Vector2(-7.5f, 299), 0);
            KitOnGround(LanternId, props, new Vector2(7.5f, 299), 0);
            return shrine;
        }

        /// <summary>藏宝点的景：东崖小径尽头的钟亭（台阶朝来路），西缘玉库（宝藏堆、供品、冰灯，库门两侧角楼）</summary>
        static void BuildCaches(Transform kit, Transform props)
        {
            Kit(BellId, kit, BellC, OnGround(BellC).y - 0.15f, -90);
            KitOnGround(HoardId, kit, new Vector2(-109, 220), 90, 1.2f);
            KitOnGround("SM_Tripo_FrostOfferings", props, new Vector2(-105, 214.5f), 30);
            KitOnGround(LanternId, props, new Vector2(-97, 214), 0);
            KitOnGround(LanternId, props, new Vector2(-97, 226), 0);
            // 库门两侧的角楼离绝壁 ≥ 6 m（角楼顶不能挨着崖顶）
            Kit(TowerId, kit, new Vector2(-88, 207.5f), TopY - 0.3f, 90, TowerScale);
            Kit(TowerId, kit, new Vector2(-88, 232.5f), TopY - 0.3f, 90, TowerScale);
        }

        /// <summary>出生雪坳：南侧来时的山门、路龛、经幡石堆、F0 台阶脚的冰灯</summary>
        static void BuildSpawnHollow(Transform props)
        {
            KitOnGround(SealedGateId, props, new Vector2(-4, -11.5f), 0, 1, 0.3f);
            KitOnGround("SM_Env_FrostWayshrine", props, new Vector2(-22, 8), 70);
            KitOnGround("SM_Prop_FrostPrayerCairn", props, new Vector2(12, 10), 20);
            KitOnGround("SM_Prop_FrostPrayerCairn", props, new Vector2(-18, 18), -30);
            KitOnGround("SM_Prop_FrostPrayerCairn", props, new Vector2(22, 22), 0);
            var f0 = FlightNamed("F0");
            KitOnGround(LanternId, props, f0.foot + new Vector2(-8.5f, -1.5f), 0);
            KitOnGround(LanternId, props, f0.foot + new Vector2(8.5f, -1.5f), 0);
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：冰棱、冻石避开台阶、铺砌面、台基；雪松（带碰撞）只长在绝壁脚下 4–18 m 的带里，
        /// 不进场地、不挡台阶、离挡土墙和站位远一点
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            float RouteDist(Vector2 p) => RouteLines.Min(l => Polyline(p, l).dist);
            float Keep(Vector2 p)
            {
                Interior(p, out var m);
                return (1 - m.flight) * (1 - m.block) * (1 - 0.7f * m.paved);
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
                (Spawn, 14), (Site1, 12), (Site2, 14), (Site3, 40), (Site4, 30), (Site5, 10), (CacheA, 12), (CacheB, 12), (ShrineC, 20), (BellC, 10),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            pines.where = pt =>
            {
                float ins = Inside(pt.p);
                if (ins < 4 || ins > 18) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(pt.p, c) < r) return 0;
                foreach (var (a, b, r) in Spurs)
                    if (LevelKit.SegmentDistance(pt.p, a, b, out _) < r + 4) return 0;
                foreach (var f in Flights)
                    if (Polyline(pt.p, new[] { f.foot, f.top }).dist < f.width * 0.5f + 5) return 0;
                // 离挡土墙 / 台沿 4 m 以上（四个方向的地面高差）
                float g = Ground0(pt.p);
                foreach (var d in new[] { Vector2.up, Vector2.down, Vector2.left, Vector2.right })
                    if (Mathf.Abs(Ground0(pt.p + d * 4) - g) > 0.8f) return 0;
                return pw?.Invoke(pt) ?? 1;
            };
            float x0 = Envelope.Min(e => e.x), x1 = Envelope.Max(e => e.x), z0 = Envelope.Min(e => e.y), z1 = Envelope.Max(e => e.y);
            LevelKit.ScatterProps(ts, props, pines, Rect.MinMaxRect(x0, z0, x1, z1), 8f, RouteDist);
        }

        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector3 at)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = at;
            }
            Mk("Site_Spawn", OnGround(Spawn));
            Mk("Site_1_JadeStage", OnGround(Site1));
            Mk("Site_2_NineGates", OnGround(Site2));
            Mk("Site_3_KaimingCourt", OnGround(CourtCenter));
            Mk("Site_4_JadeHall", OnGround(Site4));
            Mk("Site_5_TreasuryGuard", OnGround(Site5));
            Mk("Site_Exit", OnGround(ShrineC + new Vector2(0, -4)));
            foreach (var a in Anchors) Mk(a.name, OnGround(a.at));
            foreach (var (name, at) in RouteMarks) Mk(name, OnGround(at));
            // 地标标记（冒烟测试看巨像是否可见）
            Mk("Landmark_KaimingHead", KaimingHead);
            Mk("Landmark_Tianque", TianqueLintel);
            // 青鸟落脚点（PerchPoint 前缀自动认）：墩台角、殿前月台角、月台两端
            var perches = new[]
            {
                new Vector2(-19, 195), new Vector2(19, 195), new Vector2(-45, 195), new Vector2(45, 195), new Vector2(-33, 293), new Vector2(33, 293),
                new Vector2(-19, 293), new Vector2(19, 293), new Vector2(-17, 43.5f), new Vector2(13, 43.5f),
            };
            for (int i = 0; i < perches.Length; i++) Mk($"PerchPoint_{i + 1}", OnGround(perches[i], 0.05f));
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/2-2.md §6，遭遇框架 v2）：四个必清场地任意顺序，⑤ 是藏宝 B（玉库）的守军（可选、不自动触发）。
        /// 难度由 RunPlan 给（2-2 = 1.96），场地不写死。站位标记挂 SpawnAnchor（<see cref="Anchors"/>）。
        /// </summary>
        static SG.LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            SG.EncounterSite Site(int index, string title, Vector2 at, float trigger, float arena, SG.EncounterSpec spec, string reward, Vector2 chestOffset = default)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<SG.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = OnGround(at);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = new Vector3(chestOffset.x, 0, chestOffset.y);
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

            var s1 = Site(1, "玉阶月台", Site1, 22, 30, SG.EncounterSpec.Of(
                    Wave("月台狌狌群", E(Xingxing, 5), E(Qingniao, 1)).Hint("狌狌会翻上月台追人——高台不再安全"),
                    Wave("山上俯冲", E(Qingniao, 2), E(Xingxing, 2)).After(1, 1.6f).Hint("青鸟从山上俯冲——抬头打"))
                .Gather(0.4f).Distance(10, 42), "weapon");
            var s2 = Site(2, "九门外庭", Site2, 30, 34, SG.EncounterSpec.Of(
                    Wave("九门混战", E(Xingxing, 3), E(Qingniao, 1), E(Haozhi, 2)).Hint("抢门阙下的高处——豪彘冲过来会炸冰刺"),
                    Wave("门上冷箭", E(Fuzhu, 1), E(Xingxing, 2), E(Haozhi, 1)).After(1, 2f).Hint("夫诸在台上蓄力冰光——躲到门阙后断开视线"))
                .Gather(0.6f).Distance(10, 40), "scroll");
            // 圆心在基座南坡道（CourtCenter），宝箱仍落在 (−8, 184)：南翼西侧
            var s3 = Site(3, "开明兽庭", CourtCenter, 30, 36, SG.EncounterSpec.Of(
                    Wave("巨像旋壳", E(XuanGui, 1), E(Fuzhu, 1), E(Xingxing, 2)).Hint("旋龟正面打不动——绕到身后打蛇头，翻倒时打散热孔"),
                    Wave("兽庭合围", E(FoxWitch, 1), E(Xingxing, 2), E(Haozhi, 2), E(Qingniao, 1)).After(1, 2f).Hint("狐巫立冰壁护着同伴——先打碎她的铜镜"))
                .Gather(1.5f).Distance(10, 44).Elites(1, "frenzied"), "weapon:min=1", Site3 + new Vector2(-8, -30) - CourtCenter);
            var s4 = Site(4, "玉京殿前", Site4, 26, 32, SG.EncounterSpec.Of(
                    Wave("玉京禁卫", E(XuanGui, 1).Elite("shielded"), E(FoxWitch, 1), E(Qingniao, 2), E(Haozhi, 2)).Hint("先碎铜镜，再等旋龟翻倒"),
                    Wave("殿前援军", E(Xingxing, 3), E(Fuzhu, 1)).After(1, 2f).Hint("援军从两侧殿前月台上下来"))
                .Gather(0.6f).Distance(10, 40), "upgrade");
            var s5 = Site(5, "玉库守军", Site5, 14, 18, SG.EncounterSpec.Of(
                    Wave("玉库守军", E(Xingxing, 2), E(Fuzhu, 1).Elite("swift"), E(Haozhi, 1)))
                .Gather(0.4f), "");
            s5.autoTrigger = false;
            s5.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<SG.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "叩开天阙";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;

            // 藏宝：A 在东崖小径尽头的钟亭前（直接给），B 在西缘玉库里（惊动 ⑤ 守军，肃清后给灵兽封印）
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
            Cache("Cache A · 钟亭供奉", "钟亭供奉", CacheA, new Vector2(92, 152), "scroll", null, 12);
            Cache("Cache B · 玉库秘藏", "玉库秘藏", CacheB, Site5, "pet", s5, 12);
            return objective;
        }

        /// <summary>出口传送门：嵌在出口祭坛正面（没有祭坛模型时自己立石门框），关卡目标完成后升起、落清关宝箱</summary>
        static void BuildExit(GameObject shrine, SG.LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<SG.ExitPortal>();
            var face = shrine ? shrine.transform.forward : Vector3.back;
            face.y = 0;
            face.Normalize();
            var at = ShrineC + new Vector2(face.x, face.z) * 1.2f;
            portal.transform.SetPositionAndRotation(ts.OnGround(at.x, at.y), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
        }

        /// <summary>
        /// 遭遇场地的中心都在和出生点连通的导航网格上（整局冒烟发现 ③ 的中心原来声明在巨像脚下：那里吸附到的是巨像基座上被巨像围住的一小块孤岛，
        /// 从出生点没有完整路径，传送到中心的机器人在孤岛上刷不出怪）。吸附半径同 RunBot（8 m），只查人形代理的网格。
        /// </summary>
        static void CheckSiteCenters(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场地中心连通（NavMesh，从出生点） —");
            var filter = SG.LavaField.WalkerFilter();
            if (!UnityEngine.AI.NavMesh.SamplePosition(OnGround(Spawn), out var start, 4f, filter))
            {
                rep.Fail("出生点附近没有导航网格");
                return;
            }
            var path = new UnityEngine.AI.NavMeshPath();
            bool Connected(Vector3 p, out Vector3 at)
            {
                at = p;
                if (!UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 8f, filter)) return false;
                at = hit.position;
                return UnityEngine.AI.NavMesh.CalculatePath(start.position, at, filter, path) && path.status == UnityEngine.AI.NavMeshPathStatus.PathComplete;
            }
            static string F(Vector3 v) => $"({v.x:F0}, {v.y:F1}, {v.z:F0})";
            var sites = Object.FindObjectsByType<SG.EncounterSite>(FindObjectsInactive.Include).Where(s => s.gameObject.scene == scene).OrderBy(s => s.name);
            foreach (var site in sites)
            {
                var c = site.transform.position;
                bool ok = Connected(c, out var at);
                string msg = $"{site.title}：中心 {F(c)} → 网格 {F(at)}";
                if (ok) rep.Line($"✓ {msg}，和出生点连通");
                else rep.Fail($"{msg}，和出生点不连通（孤岛 / 附近没有网格）");
            }
            // 参考（不判）：巨像脚下（③ 原来声明的中心）
            var statue = OnGround(Site3);
            bool island = !Connected(statue, out var statueAt);
            rep.Line($"· 巨像脚下 {F(statue)} → 网格 {F(statueAt)}：{(island ? "不连通（被巨像围住的孤岛），场地中心不能放这里" : "连通")}");
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
            int sites = Count<SG.EncounterSite>(), caches = Count<SG.CachePOI>(), portals = Count<SG.ExitPortal>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1），藏宝 {caches}，出口 {portals}");
            if (sites != 5) rep.Fail($"遭遇场地有 {sites} 个（应为 5）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2）");
            if (portals != 1) rep.Fail($"出口传送门有 {portals} 个（应为 1）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线路点（含三道门的天阶顶、月台、U1、墩台、基座、神道、殿前月台、两处藏宝）、
        /// 全部台阶与神道的坡度、6 条地标视线、场地尺寸 / 掩体 / 层数阈值（只防退化，实测看报告）。可玩区遮罩与软边界同一个；
        /// 界外是比台面高 16 m 以上的绝壁，防越界由地形保证。站位、宝箱落点、藏宝、出口、占位件由检查项自己从场景里找。
        /// </summary>
        static LevelSpec Spec()
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec Site(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            Vector3 TowerTop(float x) => At(LevelKit.SteppedWallPoint(S2, 0, Across(x)), CourtY + 13.15f * TowerScale * 0.7f);
            var spec = new LevelSpec
                {
                    id = "2-2", title = "昆仑天阙 · 开明九门", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        Site("出生·山门（缓冲）", Spawn, 30, combat: false),
                        Site("① 玉阶月台", Site1, 52, cover: 4, layers: 3, overlook: true),
                        Site("② 九门外庭", Site2, 52, cover: 4, layers: 3, overlook: true),
                        Site("③ 开明兽庭", CourtCenter, 64, cover: 4, layers: 3, overlook: true),
                        Site("④ 玉京殿前", Site4, 52, cover: 3, layers: 3, overlook: true),
                    },
                }
                .Route("出生·山门", G(Spawn)).Route("F0 顶（L1）", G(new Vector2(-6, 34))).Route("① 玉阶月台", G(Site1)).Route("① 挡墙月台顶", G(new Vector2(-2, 43.5f)))
                .Route("L2（F1W 顶）", G(new Vector2(-44, 62))).Route("② 九门外庭", G(Site2)).Route("U1", G(new Vector2(-30, 133)))
                .Route("西门天阶顶", G(new Vector2(-66, 170))).Route("东门天阶顶", G(new Vector2(66, 170))).Route("中门天阶顶（南翼）", G(new Vector2(0, 176)))
                .Route("SW 墩台", G(new Vector2(-32, 182))).Route("SE 墩台", G(new Vector2(32, 182)))
                .Route("③ 开明兽庭（场地中心）", G(CourtCenter)).Route("基座顶", G(new Vector2(8, 214)))
                .Route("西翼", G(new Vector2(-38, 214))).Route("③ 开明兽庭（北翼神道）", G(new Vector2(0, 246))).Route("④ 玉京殿前", G(Site4))
                .Route("西殿前月台", G(new Vector2(-28, 292))).Route("东殿前月台", G(new Vector2(28, 292))).Route("出口祭坛前", G(ShrineC + new Vector2(0, -4.5f)))
                .Route("藏宝 A · 钟亭", G(CacheA)).Route("藏宝 B · 玉库", G(CacheB))
                .Sight("出生 → 巨像", G(Spawn, 1.62f), KaimingHead, 6, KaimingId)
                .Sight("① 挡墙月台 → 巨像", G(new Vector2(-2, 43.5f), 1.62f), KaimingHead, 6, KaimingId)
                .Sight("② 中门前 → 巨像", G(new Vector2(0, 100), 1.62f), KaimingHead, 6, KaimingId)
                .Sight("② 外庭 → 西门阙", G(Site2, 1.62f), TowerTop(TowerX(0, 1)), 6, TowerId)
                .Sight("② 外庭 → 东门阙", G(Site2, 1.62f), TowerTop(TowerX(2, -1)), 6, TowerId)
                .Sight("③ 北翼 → 天阙", G(new Vector2(0, 238), 1.62f), TianqueLintel, 6, GatewayId);
            foreach (var f in Flights) spec.slopePaths.Add(new SlopePath { name = f.name, points = new[] { f.foot, f.top } });
            // 神道中线上是基座北坡道，坡度路径走它东边 10 m
            spec.slopePaths.Add(new SlopePath { name = "北翼神道", points = new[] { new Vector2(10, ArmZ0 - 2), new Vector2(10, ArmZ1 + 4) } });
            return spec;
        }
    }
}
