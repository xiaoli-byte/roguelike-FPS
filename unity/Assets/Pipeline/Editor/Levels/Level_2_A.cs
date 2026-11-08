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
    /// 2-A 玄冰裂谷（第二章备选图，docs/level-design/maps/2-A.md；每局路线的图池 RunPlan.Pool）：昆仑雪墟北坡一条古冰川的冰舌。
    /// 关卡坐标 = 世界 XZ（米，x 东、z 北）。游玩区是起伏的椭圆（中心 (0, 6)、半径 150 × 112 m），外面是同 2-3 的雪崖 + 雪峰。
    ///
    ///   出生·冰碛营地 (−76, −50) → B 冰封角楼 (−18, −40)：半埋的古祠台基 +2.4 m，两座角楼插出冰面
    ///   / A 冰塔林 (−82, 26)：十座冰塔，塔间巷子，四座有雪坡上顶 / C 冰碛垄 (88, −24)：两道冰碛垄夹一条垄沟
    ///   / D 冰川源头 (22, 72)：4.5 m 冰坎（三道雪坡），坎上牌楼、玉柱，周期白毛风 → 出口祭坛 (58, 88)。四个据点先后不限。
    /// 冰裂缝：主裂谷自西向东横贯（宽 11、深 7.5 m，缝底积雪能走，两头收浅），西 / 东两处雪桥、中段冰桥（显式碰撞盒）、两处积雪坡；
    /// 另有四道窄裂缝。冰缝底 / 冰面 / 冰塔顶·冰碛垄·冰坎三层。藏宝：主裂谷缝底的冰缝遗骨（无守军）、西北冰面的冰封经幡祠（守军 G）。
    ///
    /// 摆怪三类（maps/2-A.md §8）：驻守点 = 四处路遇小队（AsRoadside + 埋伏：冰桥头、冰塔林东缘、冰碛垄尾、冰坎西头），开局就站在场上；
    /// 据点 = 四个必清场地各 3 波，波次从场地自己的站位进场（台基上埋伏、冰塔 / 台基 / 冰碛垄顶跃下、牌楼后增援门、飞行敌人飞临）；
    /// 入场点 = 游荡怪群（CombatDirector）进场的 7 处 MonsterEntry（缝口积雪坡、冰塔顶 / 冰坎跃下、垄背后、两处飞临）。
    /// 布局变体（<see cref="LevelLayout"/>）：main 自冰碛营地入；reverse 自冰川源头入（北头祭坛前出生 → 西南营地旁的新祭坛，B / D 编制奖励对调）。
    /// 冰壁的分层：章节规则把陡坡涂成岩，这张图换成自己的规则（<see cref="GlacierSplat"/>）——样本的 gravelBias 记「冰壁」，陡处改涂冰层。
    /// 生成：Spiritfire ▸ Levels ▸ Build 2-A 玄冰裂谷（或 bridge.sh level 2-A）。
    /// </summary>
    [LevelBuilder("2-A", ScenePath)]
    public static class Level_2_A
    {
        public const string Dir = "Assets/Levels/L2_A_Crevasse";
        public const string ScenePath = "Assets/Scenes/L2_A_Crevasse.unity";
        const string Name = "L2_A";

        // 高度场里 Base 米 = 世界 y 0；冰缝挖到 −8，冰坎顶约 12，崖 + 雪峰再高 66
        const float Base = 16f, HeightRange = 104f, FarY = -3f;
        static readonly Vector2 Origin = new(-256, -256), Size = new(512, 512);
        const float FogStart = 55f, FogEnd = 360f;
        /// <summary>盛行风：冰川上游（北）吹下来的下降风</summary>
        static readonly Vector2 Wind = new Vector2(0.2f, -1f).normalized;
        static readonly LevelKit.BoundarySpec Bounds = FrostBounds();

        static LevelKit.BoundarySpec FrostBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Frost";
            return b;
        }

        // ───────────── 游玩区与雪岭（同 2-3）─────────────
        static readonly Vector2 EnvC = new(0, 6), EnvR = new(150, 112);
        const float EnvIrregular = 0.05f;
        static readonly Vector2[] Envelope = BuildEnvelope();
        const float RimApron = 0.9f, RimApronWidth = 3f;
        const float CliffMin = 16f, CliffMax = 30f, FaceMin = 8f, FaceMax = 13f, FaceGully = 0.45f;
        const float LedgeFirst = 6f, LedgePhase = 2f, LedgeStep = 5.5f, LedgeRiserMin = 0.55f, LedgeRiserMax = 0.7f;
        const float PeakStart = 2f, PeakRun = 40f, PeakMin = 8f, PeakMax = 40f;

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = new(-76, -50), SiteB = new(-18, -40), SiteA = new(-82, 26), SiteC = new(88, -24), SiteD = new(22, 72),
            SiteG = new(-60, 78), ExitAt = new(58, 88), RevExitAt = new(-84, -66), CrevCache = new(-50, -9);
        const float SpawnPadR = 9f;
        /// <summary>出口祭坛朝向（正面 +Z 朝西南的冰原）、逆行祭坛朝向（朝东北）</summary>
        const float ExitYaw = -128f, RevExitYaw = 54f;
        static Vector2 YawDir(float yaw) => new(Mathf.Sin(yaw * Mathf.Deg2Rad), Mathf.Cos(yaw * Mathf.Deg2Rad));
        static Vector2 RevSpawn => ExitAt + YawDir(ExitYaw) * 7.5f;

        // ── 冰裂缝：折线、宽、深、两头收浅的长度；spans = 雪桥（陡边平顶）/ 积雪坡（缓坡下到缝底），按世界点投影到缝上 ──
        sealed class Crevasse
        {
            public string name;
            public List<Vector2> path;
            public float width, depth, taper, length;
            public (Vector2 at, float half, bool drift)[] spans;
            public float[] spanAlong;
        }

        const float CrevWall = 1.2f;
        static readonly Crevasse Great = MakeCrevasse("主裂谷", new[]
            {
                new Vector2(-140, -6), new Vector2(-110, -12), new Vector2(-70, -14), new Vector2(-38, -6), new Vector2(-6, 6), new Vector2(26, 12),
                new Vector2(58, 8), new Vector2(90, 18), new Vector2(126, 30),
            }, 11f, 7.5f, 18f,
            (new Vector2(-100, -12), 3.5f, false), (new Vector2(-68, -14), 3f, true), (new Vector2(40, 11), 3f, true), (new Vector2(78, 13), 3.5f, false));
        static readonly Crevasse[] Crevasses =
        {
            Great,
            MakeCrevasse("冰塔林北缝", new[] { new Vector2(-114, 58), new Vector2(-94, 64), new Vector2(-76, 61), new Vector2(-62, 64) }, 5f, 5f, 10f,
                (new Vector2(-90, 63.5f), 3f, false)),
            MakeCrevasse("中北缝", new[] { new Vector2(-44, 40), new Vector2(-22, 33), new Vector2(-2, 35) }, 5f, 5f, 10f),
            MakeCrevasse("东北缝", new[] { new Vector2(38, 34), new Vector2(58, 41), new Vector2(78, 46) }, 5.5f, 5.5f, 10f, (new Vector2(58, 41), 2.5f, true)),
            MakeCrevasse("南缝", new[] { new Vector2(6, -70), new Vector2(30, -80), new Vector2(56, -76) }, 5f, 5f, 10f, (new Vector2(30, -80), 3f, false)),
        };
        /// <summary>主裂谷中段的冰桥：桥心（缝上）、桥面宽、两头搭到缝沿外的米数</summary>
        static readonly Vector2 BridgeAt = new(10, 9);
        const float BridgeWidth = 5.5f, BridgeLand = 1.6f, BridgeSy = 0.62f;

        static Crevasse MakeCrevasse(string name, Vector2[] ctrl, float width, float depth, float taper, params (Vector2 at, float half, bool drift)[] spans)
        {
            var path = Spline(ctrl, 6);
            float len = 0;
            for (int i = 0; i + 1 < path.Count; i++) len += Vector2.Distance(path[i], path[i + 1]);
            var along = new float[spans.Length];
            for (int i = 0; i < spans.Length; i++) along[i] = Polyline(spans[i].at, path).t * len;
            return new Crevasse { name = name, path = path, width = width, depth = depth, taper = taper, length = len, spans = spans, spanAlong = along };
        }

        // ── A 冰塔林：中心、半尺寸、偏航、高（冰面以上）、雪坡方向（0 无，1 +x，2 −x，3 +z，4 −z，局部轴）──
        static readonly (Vector2 c, Vector2 half, float yaw, float h, int ramp)[] Seracs =
        {
            (new Vector2(-98, 16), new Vector2(4f, 5.5f), 20, 5.5f, 2),
            (new Vector2(-84, 9), new Vector2(3f, 3.5f), -10, 3.4f, 0),
            (new Vector2(-68, 20), new Vector2(5f, 4f), 35, 6f, 4),
            (new Vector2(-91, 35), new Vector2(3.5f, 3.5f), 0, 4.6f, 0),
            (new Vector2(-74, 41), new Vector2(4f, 5f), -25, 5.2f, 4),
            (new Vector2(-106, 37), new Vector2(3f, 5f), 45, 6.5f, 0),
            (new Vector2(-59, 36), new Vector2(3f, 3f), 10, 3.2f, 0),
            (new Vector2(-87, 51), new Vector2(5f, 3f), 15, 4.2f, 0),
            (new Vector2(-64, 52), new Vector2(3f, 4f), -40, 5.5f, 1),
            (new Vector2(-111, 22), new Vector2(3f, 4f), 60, 4f, 0),
        };
        const float SeracEdge = 0.8f, SeracRampW = 4.4f, SeracRampRun = 3.4f;

        // ── B 冰封台基 ──
        static readonly Vector2 MoundC = new(-18, -42), MoundHalf = new(14, 10);
        const float MoundYaw = 15f, MoundH = 2.4f, MoundEdge = 1f;

        // ── C 冰碛垄：折线、半宽、高；豁口（世界点、半宽）──
        static readonly (Vector2[] path, float half, float h, Vector2 gap)[] Ridges =
        {
            (new[] { new Vector2(70, -64), new Vector2(74, -34), new Vector2(80, -4) }, 9f, 4.5f, new Vector2(74, -40)),
            (new[] { new Vector2(102, -66), new Vector2(104, -36), new Vector2(110, -8) }, 9f, 5f, new Vector2(105, -20)),
        };
        const float GapHalf = 5f;

        // ── D 冰坎：坎线 z(x)、高、东西两头淡出的 x 范围 ──
        const float StepH = 4.5f, StepEdge = 1.2f;
        static float StepFace(float x) => 60f + 3f * Mathf.Sin(x / 23f);
        static float StepFade(float x) => Smooth(-62, -44, x) * Smooth(88, 72, x);

        /// <summary>
        /// 坡道（脚 → 顶，宽，两端世界 y（不含冰面噪声），顶面是否也带冰面噪声）：冰塔雪坡、台基三道坡、冰坎三道坡。
        /// 坡脚落在带噪声的冰面上，坡道目标高度跟着同一份噪声走（<see cref="SurfaceNoise"/>），两头都不留坎；冰塔顶 / 台基顶是绝对高度，顶头不加噪声
        /// </summary>
        static readonly (string name, Vector2 foot, Vector2 top, float width, float footY, float topY, bool topNoise)[] Ramps = BuildRamps();

        static (string, Vector2, Vector2, float, float, float, bool)[] BuildRamps()
        {
            var list = new List<(string, Vector2, Vector2, float, float, float, bool)>();
            for (int i = 0; i < Seracs.Length; i++)
            {
                var (c, half, yaw, h, side) = Seracs[i];
                if (side == 0) continue;
                var (ax, ext) = SeracAxis(yaw, half, side);
                var top = c + ax * (ext - 0.4f);
                var foot = c + ax * (ext + SeracRampRun * h);
                list.Add(($"冰塔 {i + 1} 雪坡", foot, top, SeracRampW, Land0(foot), Land0(c) + h, false));
            }
            float topB = Land0(MoundC) + MoundH;
            var (mx, mz) = Axes(MoundYaw);
            list.Add(("台基南坡", MoundC - mz * (MoundHalf.y + 9.5f), MoundC - mz * (MoundHalf.y - 0.5f), 5f, Land0(MoundC - mz * (MoundHalf.y + 9.5f)), topB, false));
            list.Add(("台基北坡", MoundC + mz * (MoundHalf.y + 9.5f), MoundC + mz * (MoundHalf.y - 0.5f), 5f, Land0(MoundC + mz * (MoundHalf.y + 9.5f)), topB, false));
            list.Add(("台基西坡", MoundC - mx * (MoundHalf.x + 9.5f), MoundC - mx * (MoundHalf.x - 0.5f), 5f, Land0(MoundC - mx * (MoundHalf.x + 9.5f)), topB, false));
            foreach (float x in new[] { -24f, 16f, 50f })
            {
                float z = StepFace(x);
                // 坡顶正好落在坎线上方 0.9 m（坎面过渡带之外）：坡道在坎面处已经升满，坎上平台不会比坡道高出一截
                var foot = new Vector2(x, z - 15f);
                var top = new Vector2(x, z + 0.9f);
                list.Add(($"冰坎雪坡 x{x:F0}", foot, top, 6f, Land0(foot), Land0(top) + StepH * StepFade(x), true));
            }
            return list.ToArray();
        }

        static (Vector2 x, Vector2 z) Axes(float yaw)
        {
            float a = yaw * Mathf.Deg2Rad;
            return (new Vector2(Mathf.Cos(a), Mathf.Sin(a)), new Vector2(-Mathf.Sin(a), Mathf.Cos(a)));
        }

        static (Vector2 axis, float extent) SeracAxis(float yaw, Vector2 half, int side)
        {
            var (x, z) = Axes(yaw);
            return side switch
            {
                1 => (x, half.x), 2 => (-x, half.x), 3 => (z, half.y), _ => (-z, half.y),
            };
        }

        // ── 资产 ID 与设计尺寸 ──
        const string ShrineId = "SM_Tripo_FrostPortalShrine", TowerId = "SM_Tripo_FrostCornerTower", ColumnId = "SM_Tripo_FrostColumn",
            JadeWallId = "SM_Tripo_FrostJadeRetainingWall", GatewayId = "SM_Tripo_FrostGateway", WayshrineId = "SM_Env_FrostWayshrine",
            TentId = "SM_Tripo_FrostPrayerTent", LanternId = "SM_Tripo_FrostIceLantern", CairnId = "SM_Prop_FrostPrayerCairn",
            BarricadeId = "SM_Tripo_FrostBarricade", ShardsId = "SM_Tripo_FrostIcicleShards", PillarId = "SM_Tripo_FrostIcePillar",
            IceBridgeId = "SM_Tripo_FrostIceBridge", BlockId = "SM_Tripo_FrostPlatformBlock", CoverWallId = "SM_Tripo_FrostCoverWall",
            ColumnRuinId = "SM_Tripo_FrostColumnRuin", OfferingsId = "SM_Tripo_FrostOfferings", JadeHoardId = "SM_Tripo_FrostJadeHoard",
            PineId = "SM_Env_FrostPine", SmallShrineId = "SM_Prop_FrostShrine";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [ShrineId] = new(10.46f, 10.93f, 2.94f), [TowerId] = new(6.7f, 13.15f, 5.58f), [ColumnId] = new(1.77f, 4.91f, 1.64f),
            [JadeWallId] = new(7.02f, 6.5f, 2.26f), [GatewayId] = new(12f, 11.15f, 3.9f), [WayshrineId] = new(4.19f, 4.84f, 3.3f),
            [TentId] = new(4f, 3.53f, 3.86f), [LanternId] = new(0.9f, 2.36f, 0.89f), [CairnId] = new(1.05f, 1.97f, 0.72f),
            [BarricadeId] = new(4.44f, 1.18f, 0.41f), [ShardsId] = new(1.68f, 1f, 1.23f), [PillarId] = new(2.52f, 5.46f, 2.69f),
            [IceBridgeId] = new(10.03f, 6.92f, 8.96f), [BlockId] = new(4.94f, 2.93f, 4.97f), [CoverWallId] = new(5.57f, 2.47f, 1.49f),
            [ColumnRuinId] = new(4.08f, 1.58f, 2.1f), [OfferingsId] = new(1.74f, 1.54f, 1.3f), [JadeHoardId] = new(2.82f, 1.72f, 1.67f),
            [PineId] = new(2.62f, 4.53f, 2.18f), [SmallShrineId] = new(0.94f, 1.91f, 0.93f),
        };

        // ── 第二章阵容 ──
        const string Fuzhu = "fuzhu", Jelly = "lantern_jelly", Haozhi = "haozhi", Jiaoren = "jiaoren", Qingniao = "qingniao", Puffer = "ice_puffer",
            Xingxing = "xingxing", Crab = "frost_crab", Fox = "fox_witch", XuanGui = "xuangui", Whale = "ice_whale";

        /// <summary>
        /// 刷怪站位（标记名、场地键、位置、角色、lane、高台、散开半径）。高台站位只给会飞的；贴地的远程站在雪坡走得上去的冰塔顶 / 台基 / 垄顶。
        /// lane 0 = 正面，1 = 东或南翼，2 = 西或北翼
        /// </summary>
        static readonly (string name, string site, Vector2 at, StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_B_Precision_Top", "B", new Vector2(-14, -44), StationRole.Precision, 0, false, 1.5f),
            ("Enemy_B_Ranged_Top", "B", new Vector2(-22, -38), StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_B_Assault_E", "B", new Vector2(6, -50), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_B_Assault_W", "B", new Vector2(-42, -30), StationRole.Assault, 2, false, 2.2f),
            ("Enemy_B_Flank_NE", "B", new Vector2(4, -26), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_B_Flank_SW", "B", new Vector2(-44, -54), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_B_Support_Air", "B", new Vector2(-10, -28), StationRole.Support, 1, true, 1.5f),
            ("Enemy_B_Ranged_Air", "B", new Vector2(-32, -44), StationRole.Ranged, 2, true, 1.5f),
            ("Enemy_A_Precision_S3", "A", new Vector2(-68, 20), StationRole.Precision, 1, false, 1.2f),
            ("Enemy_A_Precision_S1", "A", new Vector2(-99, 15), StationRole.Precision, 2, false, 1.2f),
            ("Enemy_A_Ranged_S5", "A", new Vector2(-73, 42), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_A_Assault_C", "A", new Vector2(-80, 25), StationRole.Assault, 0, false, 2.2f),
            ("Enemy_A_Flank_E", "A", new Vector2(-56, 24), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_A_Flank_W", "A", new Vector2(-100, 2), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_A_Support_Air", "A", new Vector2(-86, 22), StationRole.Support, 0, true, 1.5f),
            ("Enemy_A_Ranged_Air", "A", new Vector2(-78, 50), StationRole.Ranged, 2, true, 1.5f),
            ("Enemy_C_Assault_Valley", "C", new Vector2(88, -14), StationRole.Assault, 0, false, 2.2f),
            ("Enemy_C_Assault_S", "C", new Vector2(89, -40), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_C_Precision_R1", "C", new Vector2(76, -24), StationRole.Precision, 2, false, 1.2f),
            ("Enemy_C_Precision_R2", "C", new Vector2(104, -32), StationRole.Precision, 1, false, 1.2f),
            ("Enemy_C_Flank_N", "C", new Vector2(96, 6), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_C_Flank_E", "C", new Vector2(118, -30), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_C_Support_Air", "C", new Vector2(96, -20), StationRole.Support, 0, true, 1.5f),
            ("Enemy_C_Ranged_Air", "C", new Vector2(82, -34), StationRole.Ranged, 2, true, 1.5f),
            ("Enemy_D_Assault_W", "D", new Vector2(8, 76), StationRole.Assault, 2, false, 2.2f),
            ("Enemy_D_Assault_E", "D", new Vector2(38, 72), StationRole.Assault, 1, false, 2.2f),
            ("Enemy_D_Precision_Gate", "D", new Vector2(24, 84), StationRole.Precision, 0, false, 1.2f),
            ("Enemy_D_Flank_W", "D", new Vector2(-6, 86), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_D_Flank_E", "D", new Vector2(46, 82), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_D_Support_W", "D", new Vector2(2, 70), StationRole.Support, 2, false, 1.5f),
            ("Enemy_D_Ranged_Air", "D", new Vector2(22, 68), StationRole.Ranged, 0, true, 1.5f),
            ("Enemy_D_Support_Air", "D", new Vector2(34, 80), StationRole.Support, 1, true, 1.5f),
            ("Enemy_G_Flank_A", "G", new Vector2(-48, 84), StationRole.Flank, 1, false, 2.2f),
            ("Enemy_G_Flank_B", "G", new Vector2(-72, 70), StationRole.Flank, 2, false, 2.2f),
            ("Enemy_G_Precision", "G", new Vector2(-62, 90), StationRole.Precision, 0, false, 2f),
        };

        /// <summary>
        /// 据点的出场方式站位（标记名、场地键、落地点、角色、方式、高台、辅助点 xz、辅助点高度（NaN = 贴地）、落地点抬高（NaN = 贴地））：
        /// 埋伏 = 开局站在台基 / 猎人营上；跃下 = 落地点在冰塔 / 台基 / 冰碛垄脚，辅助点是顶上的起跳点；增援门 = 集结点在牌楼前，辅助点是牌楼后视线外的出生点；
        /// 飞临 = 空中站位，辅助点是天上的入场点
        /// </summary>
        static readonly (string name, string site, Vector2 at, StationRole role, SpawnMode mode, bool elevated, Vector2 aux, float auxLift)[] ModeAnchors =
        {
            // B 冰封台基：台上的埋伏哨、从台基东西两沿跃下、飞临
            ("Mode_B_Post1", "B", new Vector2(-14, -44), StationRole.Assault, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_B_Post2", "B", new Vector2(-22, -38), StationRole.Ranged, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_B_Post3", "B", new Vector2(-8, -41), StationRole.Assault, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_B_Post4", "B", new Vector2(-28, -40), StationRole.Flank, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_B_DropW", "B", new Vector2(-34.1f, -52.5f), StationRole.Flank, SpawnMode.Drop, false, new Vector2(-29.3f, -51.2f), 0.05f),
            ("Mode_B_DropE", "B", new Vector2(-0.5f, -36.5f), StationRole.Assault, SpawnMode.Drop, false, new Vector2(-5.4f, -37.8f), 0.05f),
            ("Mode_B_Fly1", "B", new Vector2(-8, -26), StationRole.Support, SpawnMode.FlyIn, true, new Vector2(20, -10), 22f),
            ("Mode_B_Fly2", "B", new Vector2(-34, -54), StationRole.Ranged, SpawnMode.FlyIn, true, new Vector2(-60, -78), 22f),
            // A 冰塔林：四座冰塔顶跃下、飞临
            ("Mode_A_DropS3", "A", new Vector2(-75, 17), StationRole.Assault, SpawnMode.Drop, false, new Vector2(-70.6f, 19.2f), 0.05f),
            ("Mode_A_DropS1", "A", new Vector2(-87, 27), StationRole.Flank, SpawnMode.Drop, false, new Vector2(-95.5f, 16.9f), 0.05f),
            ("Mode_A_DropS5", "A", new Vector2(-67, 37.8f), StationRole.Assault, SpawnMode.Drop, false, new Vector2(-71.6f, 40f), 0.05f),
            ("Mode_A_DropS4", "A", new Vector2(-85, 29.5f), StationRole.Flank, SpawnMode.Drop, false, new Vector2(-89f, 33f), 0.05f),
            ("Mode_A_Fly1", "A", new Vector2(-86, 22), StationRole.Support, SpawnMode.FlyIn, true, new Vector2(-110, 60), 22f),
            ("Mode_A_Fly2", "A", new Vector2(-64, 30), StationRole.Ranged, SpawnMode.FlyIn, true, new Vector2(-40, 68), 24f),
            // C 冰碛垄：猎人遗营的埋伏、从两道垄顶跃下进垄沟、飞临
            ("Mode_C_Post1", "C", new Vector2(88, -7), StationRole.Assault, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_C_Post2", "C", new Vector2(94, -7), StationRole.Ranged, SpawnMode.Ambush, false, default, float.NaN),
            ("Mode_C_DropR1", "C", new Vector2(82, -30), StationRole.Assault, SpawnMode.Drop, false, new Vector2(75.6f, -30), 0.1f),
            ("Mode_C_DropR1N", "C", new Vector2(85, -12), StationRole.Flank, SpawnMode.Drop, false, new Vector2(78.4f, -12), 0.1f),
            ("Mode_C_DropR2", "C", new Vector2(97, -22), StationRole.Flank, SpawnMode.Drop, false, new Vector2(104.6f, -22), 0.1f),
            ("Mode_C_Fly", "C", new Vector2(92, -36), StationRole.Support, SpawnMode.FlyIn, true, new Vector2(110, -56), 20f),
            // D 冰川源头：牌楼后的增援门（视线外出生、从牌楼下冲出）、飞临
            ("Mode_D_GateC", "D", new Vector2(18, 84), StationRole.Assault, SpawnMode.Gate, false, new Vector2(18, 97), float.NaN),
            ("Mode_D_GateE", "D", new Vector2(42, 84), StationRole.Flank, SpawnMode.Gate, false, new Vector2(48, 98), float.NaN),
            ("Mode_D_Fly1", "D", new Vector2(22, 68), StationRole.Ranged, SpawnMode.FlyIn, true, new Vector2(-10, 108), 20f),
            ("Mode_D_Fly2", "D", new Vector2(34, 80), StationRole.Support, SpawnMode.FlyIn, true, new Vector2(80, 110), 20f),
        };

        /// <summary>
        /// 驻守点：路遇小队（AsRoadside，可选、不计目标、不落宝箱），全员埋伏——开局就站在场上、玩家先看见，走近 / 开枪整组苏醒。
        /// 摆在兴趣点上（冰桥头、冰塔林东缘、冰碛垄尾、冰坎西头），离出生点 ≥ 60 m；posts 是站岗点，face 是站岗朝向（来路方向）
        /// </summary>
        static readonly (string key, string title, Vector2 at, float trigger, float arena, Vector2[] posts, Vector2 face)[] Roadsides =
        {
            ("R1", "冰桥头守卫", new Vector2(12, 21), 13f, 16f, new[] { new Vector2(8, 20), new Vector2(14, 22), new Vector2(10, 24), new Vector2(16, 26) }, new Vector2(10, 9)),
            ("R2", "冰塔哨", new Vector2(-48, 8), 13f, 16f, new[] { new Vector2(-50, 6), new Vector2(-46, 10), new Vector2(-44, 4), new Vector2(-52, 12) }, new Vector2(-18, -40)),
            ("R3", "垄尾猎群", new Vector2(88, -60), 13f, 16f, new[] { new Vector2(86, -58), new Vector2(90, -62), new Vector2(84, -63), new Vector2(91, -56) }, new Vector2(60, -84)),
            ("R4", "冰坎西头", new Vector2(-36, 48), 13f, 16f, new[] { new Vector2(-38, 46), new Vector2(-32, 50), new Vector2(-40, 51), new Vector2(-34, 44) }, new Vector2(-82, 26)),
        };

        /// <summary>
        /// 入场点（MonsterEntry）：游荡怪群（CombatDirector，正式的局才跑）只从这里进场。名字、落地点、进场后朝向、方式、起跳点 xz（跃下）与高度、只放飞行敌人。
        /// 都离出生点 ≥ 30 m（两种走法的出生点都算），不在安全区里
        /// </summary>
        static readonly (string label, Vector2 at, Vector2 toward, SpawnMode mode, Vector2 from, float fromLift, bool flyers)[] Entries =
        {
            ("主裂谷西积雪坡口", new Vector2(-66, -2), new Vector2(-40, 20), SpawnMode.Appear, default, float.NaN, false),
            ("主裂谷东积雪坡口", new Vector2(42, 22), new Vector2(20, 44), SpawnMode.Appear, default, float.NaN, false),
            ("冰塔顶", new Vector2(-79, 4), new Vector2(-50, -10), SpawnMode.Drop, new Vector2(-84, 9), 0.05f, false),
            ("冰碛垄背后", new Vector2(118, -40), new Vector2(88, -24), SpawnMode.Appear, default, float.NaN, false),
            ("冰坎跃下", new Vector2(0, 49), new Vector2(-10, 20), SpawnMode.Drop, new Vector2(0, 61.5f), 0.05f, false),
            ("南缝东头", new Vector2(62, -70), new Vector2(30, -50), SpawnMode.Appear, default, float.NaN, false),
            ("北天飞临", new Vector2(-30, 18), new Vector2(-18, -20), SpawnMode.FlyIn, default, float.NaN, true),
            ("雪峰下飞临", new Vector2(60, -48), new Vector2(30, -40), SpawnMode.FlyIn, default, float.NaN, true),
        };

        /// <summary>主要走法（散布避让用）</summary>
        static readonly Vector2[][] RouteLines =
        {
            new[] { Spawn, new Vector2(-48, -46), SiteB },
            new[] { SiteB, new Vector2(-30, -20), new Vector2(-68, -14), new Vector2(-82, 10), SiteA },
            new[] { SiteB, new Vector2(10, -4), new Vector2(10, 22), new Vector2(16, 50), SiteD },
            new[] { SiteB, new Vector2(30, -60), SiteC },
            new[] { SiteC, new Vector2(78, 13), new Vector2(50, 50), SiteD },
            new[] { SiteA, new Vector2(-90, 63.5f), SiteG, new Vector2(-24, 62), SiteD },
            new[] { SiteD, ExitAt },
            new[] { Spawn, RevExitAt },
        };

        // ───────────── 地貌 ─────────────

        static Vector2[] BuildEnvelope()
        {
            const int n = 72;
            var wob = new float[n];
            float peak = 1e-4f;
            for (int i = 0; i < n; i++)
            {
                wob[i] = Loop(i * 2 * Mathf.PI / n, 7, 3, 71);
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

        /// <summary>不含噪声的冰面：由南向北缓升 6 m，中间微凸 1.2 m（坡道两端、台面高度从这里取）</summary>
        static float Land0(Vector2 p) => 6f * Smooth(-120, 120, p.y) + 1.2f * (1 - Mathf.Clamp01(p.x * p.x / (150f * 150f)));

        static float Inside(Vector2 p) => LevelKit.PolygonSigned(p, Envelope) + Fbm(p, 12, 2, 41) * 0.8f;

        static float Playable(Vector2 p) => Smooth(-4, 4, Inside(p));

        static float Rim(Vector2 p, float ins, out float lip)
        {
            var (cliffH, _) = CliffAt(p);
            float faceW = FaceWidth(p);
            float t = Mathf.Clamp01(-ins / faceW);
            float face = cliffH * Mathf.Lerp(t, t * t * (3 - 2 * t), 0.35f);
            float peakH = Mathf.Lerp(PeakMin, PeakMax, Ridged(p, 90, 4, 37));
            float rel = face + peakH * Smooth(-PeakStart, -PeakStart - PeakRun, ins);
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

        static (float height, float face) CliffAt(Vector2 p)
        {
            float n = Smooth(-0.4f, 0.4f, Fbm(p, 80, 2, 31));
            return (Mathf.Lerp(CliffMin, CliffMax, n), Mathf.Lerp(FaceMin, FaceMax, n));
        }

        static float FaceWidth(Vector2 p) => CliffAt(p).face * (1 + FaceGully * Smooth(-0.1f, 0.45f, Fbm(p, 22, 3, 45)));

        /// <summary>旋转矩形台的遮罩（台面 1、侧壁 edge 米内落到 0）</summary>
        static float RotRect(Vector2 p, Vector2 c, Vector2 half, float yaw, float edge)
        {
            var (ax, az) = Axes(yaw);
            var d = p - c;
            float lx = Vector2.Dot(d, ax), lz = Vector2.Dot(d, az);
            float ox = Mathf.Max(0, Mathf.Abs(lx) - half.x), oz = Mathf.Max(0, Mathf.Abs(lz) - half.y);
            return 1 - Smooth(0, edge, Mathf.Sqrt(ox * ox + oz * oz));
        }

        static float Raise(float h, float y, float mask) => mask > 0 ? Mathf.Max(h, Mathf.Lerp(h, y, mask)) : h;

        /// <summary>冰坎遮罩（坎上 1）</summary>
        static float StepMask(Vector2 p) => Smooth(-StepEdge * 0.5f, StepEdge * 0.5f, p.y - StepFace(p.x) + Fbm(p, 9, 2, 63) * 0.35f) * StepFade(p.x);

        /// <summary>冰碛垄高度（不含豁口外的冰面）与遮罩</summary>
        static float RidgeAt(Vector2 p, out float mask)
        {
            float best = 0;
            mask = 0;
            foreach (var (path, half, h, gap) in Ridges)
            {
                var (d, t) = Polyline(p, path);
                if (d > half) continue;
                float end = Smooth(0, 0.12f, t) * Smooth(1, 0.88f, t);
                float g = 1 - Smooth(GapHalf, GapHalf + 4, Vector2.Distance(p, gap));
                float m = Smooth(half, 0, d) * end * (1 - g);
                float v = h * m * (1 + Fbm(p, 8, 2, 77) * 0.12f);
                if (v > best) best = v;
                mask = Mathf.Max(mask, m);
            }
            return best;
        }

        /// <summary>
        /// 冰裂缝下挖量（米，正数）：缝心平底、两壁 CrevWall 米宽近乎竖直，两头 taper 米内收浅到冰面；雪桥处缝断开（桥两侧是陡壁），积雪坡处缓缓收浅。
        /// wall = 冰壁带（0–1，分层涂冰），floor = 缝底（0–1，积雪）
        /// </summary>
        static float CrevasseCut(Vector2 p, out float wall, out float floor)
        {
            float best = 0;
            wall = floor = 0;
            foreach (var c in Crevasses)
            {
                var (d, t) = Polyline(p, c.path);
                float hw = c.width * 0.5f;
                if (d > hw + 0.6f) continue;
                float along = t * c.length;
                float k = Smooth(0, c.taper, along) * Smooth(0, c.taper, c.length - along);
                for (int i = 0; i < c.spans.Length; i++)
                {
                    float s = Mathf.Abs(along - c.spanAlong[i]);
                    float half = c.spans[i].half;
                    float m = c.spans[i].drift ? 1 - Smooth(half, half + c.depth * 1.9f, s) : 1 - Smooth(half, half + 0.9f, s);
                    k *= 1 - m;
                }
                float cross = 1 - Smooth(hw - CrevWall, hw, d);
                float cut = c.depth * k * cross;
                if (cut > best)
                {
                    best = cut;
                    floor = (1 - Smooth(hw - CrevWall - 0.6f, hw - CrevWall, d)) * Smooth(0.5f, 2f, cut);
                }
                // 冰壁带：缝沿内外各一点（缝沿也是蓝冰），只在缝真的有深度处
                float w = Smooth(hw - CrevWall - 0.3f, hw - CrevWall + 0.3f, d) * (1 - Smooth(hw + 0.2f, hw + 0.6f, d));
                wall = Mathf.Max(wall, w * Smooth(0.6f, 2f, c.depth * k));
            }
            return best;
        }

        /// <summary>冰面噪声（Land0 之外）：大起伏 + 细纹 + 中部一道道横向的冰川弧拱（坡道目标也加这一份）</summary>
        static float SurfaceNoise(Vector2 p, float ins) =>
            Fbm(p, 55, 3, 3) * 0.9f + Fbm(p, 14, 2, 4) * 0.15f + Mathf.Sin(p.y * 0.24f + Fbm(p, 40, 2, 5) * 2.2f) * 0.22f * Smooth(12, 30, ins);

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float ins = Inside(p);

            // ── 冰面：南低北高、中间微凸 + 噪声 ──
            float noise = SurfaceNoise(p, ins);
            float h = Land0(p) + noise;
            float glacier = Smooth(12, 30, ins);

            // ── 侧碛：贴崖脚一圈碎石垄 ──
            float marg = Smooth(26, 8, ins) * Smooth(-3, 3, ins);
            h += (2.4f + Fbm(p, 9, 2, 6) * 0.6f) * marg;

            // ── 出生平台 ──
            float pad = 1 - Smooth(SpawnPadR, SpawnPadR + 4, Vector2.Distance(p, Spawn));
            if (pad > 0) h = Mathf.Lerp(h, Land0(Spawn) + 2.4f * Smooth(26, 8, Inside(Spawn)) * Smooth(-3, 3, Inside(Spawn)), pad);

            // ── C 冰碛垄 ──
            float ridge = RidgeAt(p, out float ridgeMask);
            h += ridge;

            // ── D 冰坎 ──
            float step = StepMask(p);
            h += StepH * step;

            // ── B 冰封台基 ──
            float mound = RotRect(p, MoundC, MoundHalf, MoundYaw, MoundEdge);
            float moundTop = Land0(MoundC) + MoundH;
            h = Raise(h, moundTop, mound);

            // ── A 冰塔（台面写成绝对高度，侧壁陡） ──
            float serac = 0, seracTop = 0;
            foreach (var (c, half, yaw, sh, _) in Seracs)
            {
                // 侧壁按噪声进退 ±0.7 m（不是一块块方砖），台面四角也跟着啃掉一点
                float m = RotRect(p, c, half - Vector2.one * (0.7f * Fbm(p, 3.5f, 2, 83 + c.x * 0.1f)), yaw, SeracEdge);
                if (m <= 0) continue;
                float top = Land0(c) + sh + Fbm(p, 4, 2, 81) * 0.15f;
                h = Raise(h, top, m);
                serac = Mathf.Max(serac, m);
                seracTop = Mathf.Max(seracTop, Smooth(0.9f, 0.99f, m));
            }

            // ── 坡道（只填）──
            float rampAny = 0;
            foreach (var r in Ramps)
            {
                var (t, m) = Ramp(p, r.foot, r.top, r.width, 2.2f);
                if (m <= 0) continue;
                float target = Mathf.Lerp(r.footY + noise, r.topY + (r.topNoise ? noise : 0), Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                rampAny = Mathf.Max(rampAny, m);
            }

            // ── 冰裂缝（下挖，最后挖：桥面另有碰撞盒）──
            float cut = CrevasseCut(p, out float iceWall, out float crevFloor);
            h -= cut;

            // ── 雪崖 + 雪峰（界外）──
            float lip = 0;
            if (ins < RimApronWidth) h = Mathf.Max(h, Land0(p) + 2.4f + Rim(p, ins, out lip));

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层：冰面以雪为主、风刮秃的蓝冰斑；冰壁（缝壁、冰塔侧壁、冰坎坎面、台基侧壁）在 gravelBias 里，陡处换冰层（GlacierSplat）──
            // 冰坎坎面：只取坎线两侧的过渡（坎两头淡出处 step 是 0–1 之间的常数，不能拿 step 本身算，不然整片崖面都涂成冰）
            float face = Smooth(-StepEdge * 0.5f, StepEdge * 0.5f, p.y - StepFace(p.x) + Fbm(p, 9, 2, 63) * 0.35f);
            float wallBand = Mathf.Max(iceWall, Mathf.Max(serac * (1 - Smooth(0.9f, 0.99f, serac)), face * (1 - face) * 4f * StepFade(p.x)));
            wallBand = Mathf.Max(wallBand, mound * (1 - Smooth(0.9f, 0.99f, mound)));
            s.gravelBias = Mathf.Clamp01(wallBand * 1.4f);
            float blueIce = Smooth(0.12f, 0.38f, Fbm(p, 45, 3, 61)) * glacier * (1 - rampAny) * (1 - seracTop) * (1 - crevFloor);
            s.fluid = blueIce * 0.85f;
            float medial = (1 - Smooth(2.5f, 6f, Mathf.Abs(p.x - 30 - 10 * Mathf.Sin(p.y / 40f)))) * glacier * 0.55f;
            s.packed = Mathf.Max(Mathf.Max(marg * 0.85f, ridgeMask * 0.8f), Mathf.Max(medial, rampAny * 0.5f));
            s.sand = Mathf.Max(Mathf.Max(0.72f * (1 - marg * 0.6f) * (1 - ridgeMask * 0.5f), crevFloor * 0.95f),
                Mathf.Max(Mathf.Max(seracTop, Smooth(0.9f, 0.99f, mound)) * 0.9f, Mathf.Max(lip, pad * 0.7f)));
            return s;
        }

        /// <summary>这张图的分层规则：章节冰原规则 + 冰壁（gravelBias）在陡处改涂冰层（章节规则会把陡坡全涂成岩）</summary>
        static Vector4 GlacierSplat(in LevelKit.Sample s, in LevelKit.SplatContext c)
        {
            var v = LevelKit.Splat.Frost(s, c);
            float w = Mathf.Clamp01(s.gravelBias) * Smooth(18, 38, c.slope);
            return w > 0 ? Vector4.Lerp(v, new Vector4(0, 0, 1, 0), w) : v;
        }

        static readonly LevelKit.Ground GlacierGround = new()
        {
            key = "Frost", layers = TerrainTextureGen.Frost, rule = GlacierSplat, shadowTint = ShowcaseTheme.Frost.groundShadowTint, macroStrength = 0.14f,
            rockScale = 16f, steepTriplanar = true, rockWarp = 0.3f, rockDetile = 0.45f, lightNormalRadius = 3f, lightNormalBlend = 0.75f,
        };

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 2-A 玄冰裂谷", priority = 74)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        static LevelKit.TerrainSet ts;

        static Vector3 OnGround(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);

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
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = GlacierGround, eval = Eval,
            }, env);
            try
            {
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, EnvC, FarY, 760, 7);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY, theme.groundA, 3000);
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：下降风；动态环境 = D 冰川源头的周期白毛风（每张图一个）
                LevelKit.Weather(env, theme, Wind, 0.35f, Blizzard());

                BuildCamp(props);
                var towerTop = BuildMound(kit, props);
                BuildSeracs(kit, props);
                BuildMoraine(props);
                var (shrine, gateTop, exitTop) = BuildSource(kit, props);
                var bridgeAim = BuildIceBridge(kit);
                BuildScatter(props, theme);
                BuildMarkers(markers);
                BuildModeAnchors(markers);
                BuildEntries(markers);

                var spawnAt = OnGround(Spawn, 0.05f);
                var look = towerTop - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.normalized);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();
                var objective = BuildEncounters(markers);
                BuildCaches(markers, kit, objective);
                var portal = LevelKit.PortalAt("Exit Portal", markers, (x, z) => ts.OnGround(x, z), shrine, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                var rev = BuildLayout(kit, markers, playerSpawn, portal, objective);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                var rep = new LevelKit.Report();
                rep.Line("2-A 玄冰裂谷 · 验收");
                rep.Line($"高度：出生 {OnGround(Spawn).y:F1}，B 台基 {OnGround(MoundC).y:F1}，A 冰面 {OnGround(SiteA).y:F1}，C 垄沟 {OnGround(SiteC).y:F1}，" +
                         $"D 坎上 {OnGround(SiteD).y:F1}（坎下 {OnGround(new Vector2(22, 50)).y:F1}），出口 {OnGround(ExitAt).y:F1}");
                rep.Line($"主裂谷：缝沿 {OnGround(new Vector2(-50, -2)).y:F1}，缝底 {OnGround(CrevCache).y:F1}（长 {Great.length:F0} m），冰桥处缝底 {OnGround(BridgeAt).y:F1}");
                ReportRim(rep);
                LevelValidator.Run(Spec(towerTop, gateTop, exitTop, bridgeAim), rep);
                LevelKit.CheckEntries(rep, scene);
                CheckEntryDistances(rep);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_2-A_report.txt");

                if (review) Review(spawnAt, spawnRot, towerTop, gateTop, exitTop, bridgeAim);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static WeatherDirector.Region Blizzard() => new()
        {
            name = "D 冰川源头白毛风", center = OnGroundRaw(SiteD), radius = 34, fade = 26, profile = WeatherProfiles.Blizzard, from = Vector2.up,
            calm = 24, warn = 7, storm = 16, abate = 6, firstDelay = 8, armRadius = 90,
        };

        /// <summary>天气区在地形摆完之前建：中心高度按不含噪声的冰面 + 冰坎算</summary>
        static Vector3 OnGroundRaw(Vector2 q) => At(q, Land0(q) + StepH * StepFade(q.x));

        static void ReportRim(LevelKit.Report rep)
        {
            var tall = new (string name, Vector2 at, float r, float min)[]
            {
                ("出口祭坛", ExitAt, 5.3f, 4), ("逆行祭坛", RevExitAt, 5.3f, 4), ("出生平台", Spawn, SpawnPadR, 2),
                ("西南角楼", MoundC - Axes(MoundYaw).x * 8 - Axes(MoundYaw).z * 5, 3.5f, 8), ("牌楼", new Vector2(18, 90), 6f, 6),
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

        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 towerTop, Vector3 gateTop, Vector3 exitTop, Vector3 bridgeAim)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => OnGround(q, dy);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                var face = YawDir(ExitYaw);
                LevelKit.Capture(cam, fpRig, "level_2-A", new[]
                {
                    ("Aerial", new Vector3(-80, 160, -200), new Vector3(0, 0, 10), false),
                    ("Map", new Vector3(EnvC.x, 440, EnvC.y - 1), new Vector3(EnvC.x, 0, EnvC.y), false),
                    ("Spawn", E(Spawn), towerTop, true),
                    ("Mound", E(new Vector2(-13, -60)), towerTop, false),
                    ("MoundTop", E(new Vector2(-16, -44), MoundH + 1.62f - (OnGround(new Vector2(-16, -44)).y - OnGround(MoundC).y)), bridgeAim, false),
                    ("GreatCrevasse", E(new Vector2(-40, -18)), OnGround(new Vector2(-62, -12), -3), false),
                    ("CrevasseFloor", E(CrevCache + new Vector2(10, 1)), OnGround(CrevCache + new Vector2(-8, -1), 1), false),
                    ("IceBridge", E(new Vector2(4, -10)), bridgeAim, false),
                    ("Seracs", E(new Vector2(-60, 8)), OnGround(SiteA, 3), false),
                    ("SeracTop", E(new Vector2(-68, 20), 0) + Vector3.up * 1.62f, gateTop, false),
                    ("Moraine", E(new Vector2(88, -46)), OnGround(new Vector2(90, 0), 2), false),
                    ("RidgeTop", E(new Vector2(104, -32)), gateTop, false),
                    ("IceStep", E(new Vector2(20, 44)), gateTop, false),
                    ("Source", E(new Vector2(8, 74)), exitTop, false),
                    ("GuardShrine", E(new Vector2(-46, 66)), OnGround(SiteG, 2), false),
                    ("RevSpawn", E(RevSpawn), OnGround(new Vector2(10, 40), 2), true),
                    ("RevExit", E(new Vector2(-62, -50)), OnGround(RevExitAt, 5), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");

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

        static GameObject Put(string id, Transform parent, Vector2 q, float yaw, float scale = 1, float sink = 0.15f) =>
            PutAt(id, parent, q, OnGround(q).y - sink, yaw, scale);

        static float YawTo(Vector2 from, Vector2 to)
        {
            var d = to - from;
            return Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;
        }

        /// <summary>出生·冰碛营地：两顶经幡帐篷、石堆、冰灯、拒马、冰棱碎块</summary>
        static void BuildCamp(Transform props)
        {
            Put(TentId, props, new Vector2(-92, -44), YawTo(new Vector2(-92, -44), SiteB), 1.1f, 0.2f);
            Put(TentId, props, new Vector2(-62, -58), YawTo(new Vector2(-62, -58), SiteB) + 20, 1.1f, 0.2f);
            Put(CairnId, props, new Vector2(-84, -41), 20, 1, 0.1f);
            Put(CairnId, props, new Vector2(-68, -46), -40, 1, 0.1f);
            Put(LanternId, props, new Vector2(-70, -52), 0, 1, 0.1f);
            Put(LanternId, props, new Vector2(-80, -57), 0, 1, 0.1f);
            Put(BarricadeId, props, new Vector2(-58, -48), 70, 1, 0.1f);
            Put(ShardsId, props, new Vector2(-54, -40), 30, 1.6f, 0.1f);
        }

        /// <summary>B 冰封台基：两座角楼斜插出冰面（下沉 3.5 m）、东沿一排玉柱、南沿白玉栏（坡道处留口）、四周的断柱 / 掩体墙 / 冰棱碎块；返回角楼顶</summary>
        static Vector3 BuildMound(Transform kit, Transform props)
        {
            var (mx, mz) = Axes(MoundYaw);
            float top = Land0(MoundC) + MoundH;
            // Axes 的 x 轴在世界里是 (cos, sin)，Prefab 的偏航让 +Z 朝 mz：yaw = atan2(mz.x, mz.y)
            float yaw = Mathf.Atan2(mz.x, mz.y) * Mathf.Rad2Deg;
            var towerSW = MoundC - mx * 8 - mz * 5;
            var towerNE = MoundC + mx * 8.5f + mz * 5;
            PutAt(TowerId, kit, towerSW, top - 3.5f, yaw + 180, 1f);
            PutAt(TowerId, kit, towerNE, top - 4.2f, yaw, 1f);
            foreach (float k in new[] { -6f, -1.5f, 3f })
                PutAt(ColumnId, kit, MoundC + mx * 12.6f + mz * k, top - 0.05f, yaw);
            foreach (float k in new[] { -10f, -4.6f, 4.6f, 10f })
            {
                var at = MoundC - mz * (MoundHalf.y + 0.7f) + mx * k;
                float baseY = OnGround(at - mz * 1.6f).y - 0.3f;
                float sy = Mathf.Clamp((top + 1f - baseY) / DesignSize[JadeWallId].y, 0.25f, 1.5f);
                PutAt(JadeWallId, kit, at, baseY, yaw + 180, new Vector3(0.75f, sy, 1));
            }
            foreach (var (q, y) in new[] { (new Vector2(0, -56), 20f), (new Vector2(-40, -63), 100f), (new Vector2(-2, -30), 70f) })
                Put(CoverWallId, props, q, y, 1, 0.15f);
            foreach (var (q, y) in new[] { (new Vector2(-30, -26), 40f), (new Vector2(10, -42), 130f) })
                Put(ColumnRuinId, props, q, y, 1, 0.1f);
            foreach (var (q, y) in new[] { (new Vector2(-8, -58), 10f), (new Vector2(-40, -40), 80f), (new Vector2(12, -34), 200f), (new Vector2(-31, -17), 60f) })
                Put(ShardsId, props, q, y, 1.7f, 0.1f);
            return At(towerNE, top - 4.2f + DesignSize[TowerId].y - 1f);
        }

        /// <summary>A 冰塔林：冰塔是地形（侧壁冰层），塔脚散冰柱、冰棱碎块当矮掩体</summary>
        static void BuildSeracs(Transform kit, Transform props)
        {
            foreach (var (q, y, s) in new[] { (new Vector2(-78, 2), 20f, 1.1f), (new Vector2(-94, 26), 140f, 0.9f), (new Vector2(-62, 28), 60f, 1.2f), (new Vector2(-104, 6), 200f, 1f) })
                Put(PillarId, kit, q, y, s, 0.2f);
            foreach (var (q, y) in new[] { (new Vector2(-76, 30), 30f), (new Vector2(-88, 18), 100f), (new Vector2(-66, 44), 170f), (new Vector2(-96, 44), 250f) })
                Put(ShardsId, props, q, y, 1.7f, 0.1f);
        }

        /// <summary>C 冰碛垄：猎人遗营（倒伏的帐篷、石堆、拒马）、垄上的经幡石堆</summary>
        static void BuildMoraine(Transform props)
        {
            Put(TentId, props, new Vector2(90, -2), 200, 1f, 0.6f);
            Put(BarricadeId, props, new Vector2(80, -40), 10, 1, 0.1f);
            Put(BarricadeId, props, new Vector2(98, -44), -20, 1, 0.1f);
            Put(CairnId, props, new Vector2(75, -10), 0, 1, 0.1f);
            Put(CairnId, props, new Vector2(106, -44), 0, 1, 0.1f);
            Put(SmallShrineId, props, new Vector2(88, -52), 0, 1.3f, 0.1f);
            Put(CoverWallId, props, new Vector2(92, -22), 80, 1, 0.15f);
            Put(CoverWallId, props, new Vector2(88, -33), 100, 1, 0.15f);
            Put(BlockId, props, new Vector2(85, -48), 20, 1, 0.3f);
            Put(ColumnRuinId, props, new Vector2(66, -40), 60, 1, 0.1f);
            Put(ShardsId, props, new Vector2(84, -16), 30, 1.6f, 0.1f);
        }

        /// <summary>D 冰川源头：坎上牌楼、两对玉柱、经幡祠、台块掩体、坡顶冰灯、出口祭坛（面朝西南）；返回祭坛、牌楼顶、祭坛顶</summary>
        static (GameObject shrine, Vector3 gateTop, Vector3 exitTop) BuildSource(Transform kit, Transform props)
        {
            var gateAt = new Vector2(18, 90);
            Put(GatewayId, kit, gateAt, 180, 1f, 0.3f);
            foreach (var q in new[] { new Vector2(4, 80), new Vector2(32, 80), new Vector2(-8, 74), new Vector2(44, 70) })
                Put(ColumnId, kit, q, 0, 1, 0.1f);
            Put(WayshrineId, kit, new Vector2(-16, 84), 160, 1.2f, 0.2f);
            Put(OfferingsId, props, new Vector2(-12, 80), 160, 1, 0.05f);
            foreach (var (q, y) in new[] { (new Vector2(12, 70), 10f), (new Vector2(30, 66), 30f), (new Vector2(-2, 92), 0f) })
                Put(BlockId, props, q, y, 1, 0.3f);
            foreach (float x in new[] { -24f, 16f, 50f })
            {
                float z = StepFace(x) + 2.6f;
                Put(LanternId, props, new Vector2(x - 3.8f, z), 180, 1, 0.1f);
                Put(LanternId, props, new Vector2(x + 3.8f, z), 180, 1, 0.1f);
            }
            var shrine = Put(ShrineId, kit, ExitAt, ExitYaw, 1, 0.15f);
            float gy = OnGround(gateAt).y - 0.3f, ey = OnGround(ExitAt).y - 0.15f;
            return (shrine, At(gateAt, gy + DesignSize[GatewayId].y - 1.5f), At(ExitAt, ey + DesignSize[ShrineId].y - 1.5f));
        }

        /// <summary>
        /// 主裂谷中段的冰桥：走行面是显式碰撞盒（两头搭到缝沿外 BridgeLand 米、顶面取两岸冰面较高的），两件冰桥半跨（细头对接）只做外观、压扁到 BridgeSy；
        /// 桥下离缝底还有 4 m 多（走缝底不碰头）。返回桥心上方的视线目标
        /// </summary>
        static Vector3 BuildIceBridge(Transform kit)
        {
            var root = new GameObject("主裂谷冰桥").transform;
            root.SetParent(kit, false);
            var (_, t) = Polyline(BridgeAt, Great.path);
            int i = Mathf.Clamp(Mathf.FloorToInt(t * (Great.path.Count - 1)), 0, Great.path.Count - 2);
            var tangent = (Great.path[i + 1] - Great.path[i]).normalized;
            var axis = new Vector2(-tangent.y, tangent.x);
            float halfSpan = Great.width * 0.5f + BridgeLand;
            var a2 = BridgeAt - axis * halfSpan;
            var b2 = BridgeAt + axis * halfSpan;
            float top = Mathf.Max(OnGround(a2 - axis * 0.5f).y, OnGround(b2 + axis * 0.5f).y) + 0.03f;
            LevelKit.Deck("冰桥桥面 Collision", root, At(a2 - axis * 0.8f, top), At(b2 + axis * 0.8f, top), BridgeWidth, 1.2f);
            var d = DesignSize[IceBridgeId];
            float yaw = Mathf.Atan2(axis.x, axis.y) * Mathf.Rad2Deg - 90f; // 局部 +X 沿桥轴
            foreach (int side in new[] { -1, 1 })
            {
                var c = BridgeAt + axis * (side * (halfSpan * 0.5f - 0.5f));
                var scale = new Vector3(halfSpan / d.x, BridgeSy, (BridgeWidth + 0.6f) / d.z);
                var go = PutAt(IceBridgeId, root, c, top - d.y * BridgeSy, yaw, scale);
                if (!go) continue;
                go.name = IsPlaceholder(go) ? go.name : $"{IceBridgeId} ({(side < 0 ? "南半" : "北半")})";
                if (!IsPlaceholder(go))
                {
                    // 厚头 = 底面低的那头，要朝岸（side 方向）；局部 +X 在世界里是 axis
                    var (minus, plus) = LevelKit.ProbeEnds(go, d.x * 0.4f, new[] { -1.5f, 0f, 1.5f }, -1f, true);
                    bool thickPlus = !float.IsNaN(plus) && (float.IsNaN(minus) || plus < minus);
                    if (thickPlus != side > 0) go.transform.rotation = Quaternion.Euler(0, yaw + 180, 0);
                }
                LevelKit.VisualOnly(go);
            }
            // 桥头冰柱：两头各一对，立在桥面两侧外 1.2 m（远处一眼看出这里能过缝）
            foreach (int side in new[] { -1, 1 })
            foreach (int lat in new[] { -1, 1 })
            {
                var q = BridgeAt + axis * (side * (halfSpan + 1.2f)) + tangent * (lat * (BridgeWidth * 0.5f + 1.4f));
                Put(PillarId, root, q, side * 37 + lat * 61, 1.15f, 0.3f);
            }
            return At(BridgeAt, top + 1.2f);
        }

        /// <summary>散布：冰棱 / 冻石细节避开冰缝、冰塔顶、台面、坡道；雪松只长在侧碛和冰碛垄上，避开场地、站位、走法和视线</summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            float RouteDist(Vector2 p)
            {
                float best = float.MaxValue;
                foreach (var line in RouteLines) best = Mathf.Min(best, Polyline(p, line).dist);
                return best;
            }
            float Keep(Vector2 p)
            {
                float cut = CrevasseCut(p, out _, out _);
                float k = Mathf.Max(Smooth(0.2f, 1f, cut), RotRect(p, MoundC, MoundHalf + Vector2.one * 2, MoundYaw, 2));
                foreach (var (c, half, yaw, _, _) in Seracs) k = Mathf.Max(k, RotRect(p, c, half + Vector2.one * 1.5f, yaw, 1.5f));
                foreach (var r in Ramps) k = Mathf.Max(k, Ramp(p, r.foot, r.top, r.width + 2, 1).mask);
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
                (Spawn, 16), (SiteB, 26), (SiteA, 34), (SiteC, 14), (SiteD, 30), (SiteG, 10), (ExitAt, 12), (RevExitAt, 12), (RevSpawn, 8),
                (new Vector2(-92, -44), 6), (new Vector2(-62, -58), 6), (new Vector2(90, -2), 6),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            foreach (var a in ModeAnchors) avoid.Add((a.at, 5));
            foreach (var r in Roadsides)
                foreach (var q in r.posts)
                    avoid.Add((q, 5));
            foreach (var e in Entries) avoid.Add((e.at, 6));
            var sight = new List<(Vector2 a, Vector2 b)> { (Spawn, MoundC), (new Vector2(104, -32), new Vector2(18, 90)), (new Vector2(20, 44), ExitAt) };
            pines.where = pt =>
            {
                var q = pt.p;
                float ins = Inside(q);
                if (ins < 4) return 0;
                RidgeAt(q, out float rm);
                float onMoraine = Mathf.Max(Smooth(24, 14, ins), Smooth(0.35f, 0.7f, rm));
                if (onMoraine <= 0) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(q, c) < r) return 0;
                foreach (var rp in Ramps)
                    if (Polyline(q, new[] { rp.foot, rp.top }).dist < rp.width * 0.5f + 4) return 0;
                foreach (var (a, b) in sight)
                    if (LevelKit.SegmentDistance(q, a, b, out _) < 4) return 0;
                if (CrevasseCut(q, out _, out _) > 0.1f) return 0;
                return onMoraine * (pw?.Invoke(pt) ?? 1);
            };
            var area = new Rect(EnvC - EnvR, EnvR * 2);
            LevelKit.ScatterProps(ts, props, pines, area, 11f, RouteDist);
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
            Mk("Site_Spawn", OnGround(Spawn));
            Mk("Site_A_Seracs", OnGround(SiteA));
            Mk("Site_B_Mound", OnGround(SiteB));
            Mk("Site_C_Moraine", OnGround(SiteC));
            Mk("Site_D_Source", OnGround(SiteD));
            Mk("Site_G_Shrine", OnGround(SiteG));
            Mk("Site_Exit", OnGround(ExitAt));
            foreach (var a in Anchors) Mk(a.name, OnGround(a.at));
            // 三青鸟的歇脚点：台基东沿、坎上的玉柱顶
            var (mx, mz) = Axes(MoundYaw);
            float colH = DesignSize[ColumnId].y, top = Land0(MoundC) + MoundH;
            Mk("PerchPoint_Mound_N", At(MoundC + mx * 12.6f + mz * 3f, top - 0.05f + colH));
            Mk("PerchPoint_Mound_S", At(MoundC + mx * 12.6f - mz * 6f, top - 0.05f + colH));
            Mk("PerchPoint_Source_W", OnGround(new Vector2(4, 80), colH - 0.1f));
            Mk("PerchPoint_Source_E", OnGround(new Vector2(32, 80), colH - 0.1f));
        }

        /// <summary>据点出场方式站位（<see cref="ModeAnchors"/>）：朝场地中心；跃下给起跳点、增援门给门后出生点、飞临给天上的入场点</summary>
        static void BuildModeAnchors(Transform markers)
        {
            foreach (var m in ModeAnchors)
            {
                var a = SpawnAnchor.Create(markers, m.name, OnGround(m.at), m.role, 0, m.elevated, m.mode == SpawnMode.Ambush ? 1.2f : 2f).Via(m.mode);
                a.LookAt(OnGround(SiteCenter(m.site)));
                var aux = float.IsNaN(m.auxLift) ? OnGround(m.aux) : OnGround(m.aux, m.auxLift);
                switch (m.mode)
                {
                    case SpawnMode.Drop:
                        a.DropFrom(aux);
                        break;
                    case SpawnMode.Gate:
                        a.Gate(aux);
                        break;
                    case SpawnMode.FlyIn:
                        a.Entry(aux);
                        break;
                }
            }
        }

        static Vector2 SiteCenter(string key) => key switch
        {
            "A" => SiteA, "B" => SiteB, "C" => SiteC, "D" => SiteD, _ => SiteG,
        };

        /// <summary>入场点（<see cref="Entries"/>）：贴地落地点；跃下的起跳点在冰塔 / 冰坎顶</summary>
        static void BuildEntries(Transform markers)
        {
            var root = new GameObject("Monster Entries").transform;
            root.SetParent(markers, false);
            foreach (var e in Entries)
            {
                Vector3? from = e.mode == SpawnMode.Drop ? OnGround(e.from, e.fromLift) : null;
                LevelKit.Entry(root, e.label, OnGround(e.at), OnGround(e.toward), e.mode, from, e.flyers ? 6f : 4f, e.flyers);
            }
        }

        /// <summary>入场点离两种走法的出生点都 ≥ 30 m（CheckEntries 只量主走法那个）</summary>
        static void CheckEntryDistances(LevelKit.Report rep)
        {
            int bad = 0;
            foreach (var e in Entries)
            foreach (var (name, sp) in new[] { ("主走法出生", Spawn), ("逆行出生", RevSpawn) })
            {
                float d = Vector2.Distance(e.at, sp);
                if (d >= 30) continue;
                rep.Fail($"入场点「{e.label}」离{name}只有 {d:F0} m（应 ≥ 30 m）");
                bad++;
            }
            if (bad == 0) rep.Line($"✓ 入场点 {Entries.Length} 处离两种走法的出生点都 ≥ 30 m");
        }

        static EncounterSpec specOpening, specFinale;

        /// <summary>
        /// 遭遇：A / B / C / D 必清、先后不限（开放图规则），每处 3 波（怪多：四处合计约 90 只）；G 是冰封经幡祠的守军（可选、不自动触发）。
        /// 难度由槽位给（运行时），场地不写死。B 是主走法的开场（给武器），D 是终局（精英旋龟）；逆行变体两边对调（<see cref="BuildLayout"/>）
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
                foreach (var a in ModeAnchors)
                    if (a.site == key)
                        list.Add(markers.Find(a.name));
                site.anchors = list.ToArray();
                return site;
            }
            WaveEntry E(string id, int n) => EncounterSpec.E(id, n);
            const SpawnMode Ambush = SpawnMode.Ambush, Drop = SpawnMode.Drop, Gate = SpawnMode.Gate, FlyIn = SpawnMode.FlyIn;
            WaveSpec Wave(string label, params WaveEntry[] entries) => EncounterSpec.Wave(label, entries);

            // 开场 / 终局两套编制给 B、D 共用（逆行变体对调）：方式按两处场地都有的站位写，场地里没有这种站位的条目退回现身
            specOpening = EncounterSpec.Of(
                    Wave("冰下伏兵", E(Jiaoren, 4).Via(Ambush), E(Haozhi, 2), E(Puffer, 2).Via(FlyIn)).Hint("冻鲛人早就守在高处——先清掉守哨，别被围在冰面上"),
                    Wave("两翼包抄", E(Xingxing, 3).Via(Drop), E(Fuzhu, 2), E(Qingniao, 1).Via(FlyIn)).After(2, 1.6f).Hint("雪狌狌从高处跃下包抄——夫诸在远处蓄力射冰光，找掩体断视线"),
                    Wave("冰面涌出", E(Jiaoren, 3).Via(Gate), E(Haozhi, 2), E(Jelly, 1).Via(FlyIn)).After(2, 1.8f).Hint("先打冰灯水母的灯芯，断开它给同伴的回血"))
                .Gather(0.6f).Distance(10, 38);
            specFinale = EncounterSpec.Of(
                    Wave("风雪前锋", E(Jiaoren, 4).Via(Gate), E(Haozhi, 3), E(Puffer, 2).Via(FlyIn)).Hint("白毛风里看不远——近战借风雪扑上来，退到柱子后面"),
                    Wave("狐巫冰壁", E(Fox, 2), E(Xingxing, 3).Via(Drop), E(Qingniao, 2).Via(FlyIn)).After(2, 1.8f).Hint("狐巫在立冰壁——打碎她的铜镜，冰壁就立不起来"),
                    Wave("冰甲旋龟", E(XuanGui, 1).Elite("shielded"), E(Whale, 1), E(Fuzhu, 2), E(Jelly, 1).Via(FlyIn), E(Jiaoren, 2).Via(Gate)).After(2, 2f)
                        .Hint("精英旋龟缩壳旋转——等它过热翻倒再打散热孔；冰鲸的冰柱能挡子弹也能挡它"))
                .Gather(1.2f).Distance(10, 40);

            var sB = Site("B", "冰封角楼", SiteB, 22, 32, specOpening, "weapon");
            var sA = Site("A", "冰塔林", SiteA, 22, 32, EncounterSpec.Of(
                    Wave("塔间游猎", E(Xingxing, 4).Via(Drop), E(Haozhi, 3)).Hint("雪狌狌从冰塔顶跃下——别追进巷子，站到有雪坡的塔顶上"),
                    Wave("冰塔顶", E(Fuzhu, 2), E(Qingniao, 2).Via(FlyIn), E(Puffer, 2).Via(FlyIn)).After(2, 1.6f).Hint("夫诸占了塔顶——从雪坡冲上去，或绕到塔后断它视线"),
                    Wave("狐巫", E(Fox, 2), E(Jiaoren, 3).Via(Drop), E(Xingxing, 2).Via(Drop)).After(2, 1.8f).Hint("狐巫的冰壁能把巷子封死——先打铜镜"))
                .Gather(0.6f).Distance(10, 36), "scroll", new Vector3(0, 0, -6));
            var sC = Site("C", "冰碛垄", SiteC, 22, 32, EncounterSpec.Of(
                    Wave("垄沟冲锋", E(Haozhi, 3), E(Jiaoren, 2).Via(Ambush), E(Jiaoren, 2), E(Fuzhu, 1)).Hint("猎人营里守着冻鲛人，豪彘顺着垄沟冲——上垄顶侧身让开"),
                    Wave("巨蟹", E(Crab, 1), E(Xingxing, 3).Via(Drop), E(Puffer, 2).Via(FlyIn)).After(2, 1.8f).Hint("巨蟹竖着巨钳横着走——绕到它身后打背缝"),
                    Wave("垄顶压制", E(Fuzhu, 2), E(Jelly, 1).Via(FlyIn), E(Jiaoren, 3).Via(Drop), E(Qingniao, 1).Via(FlyIn)).After(2, 1.8f).Hint("两道垄顶都有夫诸，还有鲛人从垄顶跳下——别站在垄沟正中"))
                .Gather(0.6f).Distance(10, 38).Elites(1, "frenzied"), "upgrade");
            var sD = Site("D", "冰川源头", SiteD, 24, 32, specFinale, "weapon:min=1");
            var sG = Site("G", "冰封经幡祠守军", SiteG, 14, 20, EncounterSpec.Of(
                    Wave("祠前守军", E(Jiaoren, 3), E(Puffer, 2), E(Fuzhu, 1).Elite("swift"), E(Xingxing, 2)).Hint("经幡祠里埋着伏兵"))
                .Gather(0.4f).Distance(8, 28), "");
            sG.autoTrigger = false;
            sG.optional = true;

            // 驻守点：路遇小队（可选、不计目标、不落宝箱），全员埋伏在站岗点上
            var roadsideSpecs = new Dictionary<string, EncounterSpec>
            {
                ["R1"] = EncounterSpec.Of(Wave("冰桥守卫", E(Jiaoren, 3).Via(Ambush), E(Fuzhu, 1).As(StationRole.Precision).Via(Ambush), E(Haozhi, 2)).Hint("桥头有守卫——过桥前先清掉，桥上没处躲")),
                ["R2"] = EncounterSpec.Of(Wave("冰塔哨", E(Xingxing, 3).Via(Ambush), E(Haozhi, 2).Via(Ambush))),
                ["R3"] = EncounterSpec.Of(Wave("垄尾猎群", E(Jiaoren, 3).Via(Ambush), E(Haozhi, 2).Via(Ambush))),
                ["R4"] = EncounterSpec.Of(Wave("冰坎西头", E(Jiaoren, 3).Via(Ambush), E(Fuzhu, 1).As(StationRole.Precision).Via(Ambush))),
            };
            foreach (var r in Roadsides)
            {
                var site = new GameObject($"Roadside {r.key} · {r.title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = OnGround(r.at);
                site.title = r.title;
                site.spec = roadsideSpecs[r.key].Gather(0.3f).Distance(6, 24);
                site.requires = Array.Empty<EncounterSite>();
                var list = new List<Transform>();
                for (int i = 0; i < r.posts.Length; i++)
                {
                    var role = i == r.posts.Length - 1 ? StationRole.Precision : StationRole.Auto;
                    var a = SpawnAnchor.Create(markers, $"Roadside_{r.key}_Post{i + 1}", OnGround(r.posts[i]), role, 0, false, 1.2f).Via(SpawnMode.Ambush);
                    a.LookAt(OnGround(r.face));
                    list.Add(a.transform);
                }
                site.anchors = list.ToArray();
                site.AsRoadside(r.trigger, r.arena);
            }

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿过玄冰裂谷";
            objective.required = new[] { sB, sA, sC, sD };
            objective.optional = new[] { sG };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>藏宝：主裂谷缝底的冰缝遗骨（无守军，灵石）；西北冰面半埋的冰封经幡祠（守军 G，肃清后给灵兽封印）</summary>
        static void BuildCaches(Transform markers, Transform kit, LevelObjective objective)
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
                    model.name = "Model";
                    model.transform.SetPositionAndRotation(At(mAt, baseY), rot);
                }
                return poi;
            }
            Cache("冰缝遗骨", CrevCache, CrevCache + new Vector2(8, 1), "coins", null, JadeHoardId, new Vector2(-1.8f, 0.6f), 0.8f);
            Cache("冰封经幡祠", SiteG + new Vector2(2, -5), SiteG + new Vector2(6, -12), "pet", guard, OfferingsId, new Vector2(1.6f, 0.6f), 1f);
            // 半埋的经幡祠（下沉 1.4 m）
            var shrineAt = SiteG + new Vector2(-1, 2);
            PutAt(WayshrineId, kit, shrineAt, OnGround(shrineAt).y - 1.4f, YawTo(shrineAt, SiteG + new Vector2(6, -12)), 1.3f);
        }

        /// <summary>
        /// 布局变体（docs/level-design/run-variety.md §2）：main = 自冰碛营地入（西南营地 → 北头祭坛）；reverse = 自冰川源头入
        /// （北头祭坛前出生 → 西南营地旁的新祭坛），B / D 的编制和奖励对调。在 NavMesh 烘焙之后调：逆行的祭坛不进导航网格
        /// </summary>
        static ExitPortal BuildLayout(Transform kit, Transform markers, PlayerSpawn mainSpawn, ExitPortal mainExit, LevelObjective objective)
        {
            var sB = objective.required[0];
            var sD = objective.required[3];
            var revSpawn = LevelKit.SpawnMarker("PlayerSpawn · 逆行", markers, OnGround(RevSpawn, 0.05f), OnGround(new Vector2(10, 40)));
            var shrine = Put(ShrineId, kit, RevExitAt, RevExitYaw, 1, 0.15f);
            shrine.name = IsPlaceholder(shrine) ? shrine.name : "Exit · 逆行 Shrine";
            LevelKit.CarveObstacle(shrine);
            var portal = LevelKit.PortalAt("Exit · 逆行 Portal", markers, (x, z) => ts.OnGround(x, z), shrine, objective);
            LevelKit.Layout(markers,
                new LevelLayout.Variant { id = "main", title = "自冰碛营地入", spawn = mainSpawn, exit = mainExit },
                new LevelLayout.Variant
                {
                    id = "reverse", title = "自冰川源头入", spawn = revSpawn, exit = portal,
                    only = new[] { shrine },
                    sites = new[] { LevelKit.Override(sD, specOpening, sB.reward), LevelKit.Override(sB, specFinale, sD.reward) },
                });
            return portal;
        }

        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 2) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 2：主走法 + 逆行）");
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
            if (spawns == 2 && boots == 1) rep.Line("✓ PlayerSpawn ×2（主走法 / 逆行各一）、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");

            int sites = Count<EncounterSite>(), caches = Count<CachePOI>(), portals = Count<ExitPortal>(), layouts = Count<LevelLayout>();
            int enemies = 0;
            foreach (var s in Object.FindObjectsByType<EncounterSite>(FindObjectsInactive.Include))
                if (s.gameObject.scene == scene && s.spec != null)
                    foreach (var w in s.spec.waves)
                        foreach (var e in w.entries)
                            enemies += e.count;
            int roadside = Object.FindObjectsByType<EncounterSite>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene && c.roadside);
            int entries = Count<MonsterEntry>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 守军 1 + 路遇 {roadside}，编制合计 {enemies} 只），藏宝 {caches}，出口 {portals}，布局表 {layouts}，怪物入场点 {entries}");
            if (sites != 5 + Roadsides.Length) rep.Fail($"遭遇场地有 {sites} 个（应为 {5 + Roadsides.Length}）");
            if (roadside < 3 || roadside > 5) rep.Fail($"路遇小队 {roadside} 处（应为 3–5）");
            if (entries < 5 || entries > 8) rep.Fail($"怪物入场点 {entries} 个（应为 5–8）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2）");
            if (portals != 2) rep.Fail($"出口传送门有 {portals} 个（应为 2：主走法 + 逆行）");
            if (layouts != 1) rep.Fail($"布局表有 {layouts} 个（应为 1）");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>验收规则集的声明：主线路点（含两种走法的出生 → 出口、冰缝底、冰桥、雪桥、冰塔顶、垄顶、冰坎）、坡道坡度、地标视线、场地阈值</summary>
        static LevelSpec Spec(Vector3 towerTop, Vector3 gateTop, Vector3 exitTop, Vector3 bridgeAim)
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var (mx, mz) = Axes(MoundYaw);
            var spec = new LevelSpec
                {
                    id = "2-A", title = "玄冰裂谷", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        S("出生·冰碛营地（缓冲）", Spawn, 26, combat: false),
                        S("B 冰封角楼", SiteB, 56, cover: 3, layers: 2, overlook: true),
                        S("A 冰塔林", SiteA, 56, cover: 3, layers: 2, overlook: true),
                        S("C 冰碛垄", SiteC, 52, cover: 2, layers: 2, overlook: true),
                        S("D 冰川源头", SiteD, 56, cover: 3, layers: 2, overlook: true),
                    },
                }
                .Route("出生·冰碛营地", G(Spawn)).Route("B 台基南坡脚", G(MoundC - mz * (MoundHalf.y + 10f))).Route("B 台基顶", G(MoundC + mx * 2))
                .Route("B 北坡脚", G(MoundC + mz * (MoundHalf.y + 10f))).Route("主裂谷冰桥南", G(BridgeAt + new Vector2(-1, -9)))
                .Route("主裂谷冰桥北", G(BridgeAt + new Vector2(1, 9))).Route("中北缝东头", G(new Vector2(6, 38)))
                .Route("冰坎坡脚", G(new Vector2(16, StepFace(16) - 15.5f))).Route("D 冰川源头", G(SiteD)).Route("出口", G(ExitAt + YawDir(ExitYaw) * 4.5f))
                .Route("逆行·出生", G(RevSpawn)).Route("东北缝积雪坡", G(new Vector2(58, 41))).Route("主裂谷东雪桥", G(new Vector2(78, 13)))
                .Route("C 冰碛垄", G(SiteC)).Route("C 东垄顶", G(new Vector2(104, -32))).Route("南缝雪桥", G(new Vector2(30, -80)))
                .Route("主裂谷西积雪坡", G(new Vector2(-68, -14))).Route("冰缝遗骨", G(CrevCache + new Vector2(3, 0)))
                .Route("主裂谷西雪桥", G(new Vector2(-100, -12))).Route("A 冰塔林", G(SiteA)).Route("A 冰塔顶", G(new Vector2(-68, 20)))
                .Route("冰塔林北缝雪桥", G(new Vector2(-90, 63.5f))).Route("G 经幡祠", G(SiteG + new Vector2(4, -8)))
                .Route("逆行·出口祭坛", G(RevExitAt + YawDir(RevExitYaw) * 4.5f)).Route("路遇·冰塔哨", G(Roadsides[1].at)).Route("路遇·冰坎西头", G(Roadsides[3].at))
                .Route("路遇·冰桥头", G(Roadsides[0].at)).Route("路遇·垄尾", G(Roadsides[2].at))
                .Sight("出生 → B 角楼", G(Spawn, 1.62f), towerTop, 6, TowerId)
                .Sight("B 台基 → 冰桥", G(MoundC + mz * 6, MoundH + 1.62f - (OnGround(MoundC + mz * 6).y - OnGround(MoundC).y)), bridgeAim, 5)
                .Sight("A 冰塔顶 → D 牌楼", G(new Vector2(-68, 20), 1.62f), gateTop, 8, GatewayId)
                .Sight("C 垄顶 → D 牌楼", G(new Vector2(104, -32), 1.62f), gateTop, 8, GatewayId)
                .Sight("冰坎下 → 出口祭坛", G(new Vector2(20, 44), 1.62f), exitTop, 6, ShrineId);
            foreach (var r in Ramps) spec.slopePaths.Add(new SlopePath { name = r.name, points = new[] { r.foot, r.top } });
            return spec;
        }
    }
}
