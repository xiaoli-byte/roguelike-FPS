using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using static Spiritfire.Art.Editor.Levels.Landform;
using static Spiritfire.Game.InfernoSquads;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-A 赤焰灰原（第三章备选图，docs/level-design/maps/3-A.md；进每局路线的图池，docs/level-design/run-variety.md §1）：
    /// 关卡坐标 = 世界 XZ（米；x 向东、z 向北），熔岩面 y = 0，灰原面约 +2.6。游玩区约 275 × 240 m（x −138…140、z −122…120），外圈是火山口崖，
    /// 崖外东北是冒烟的大火山（全图地标）。一条主熔岩河从火山方向斜穿灰原、在中部分出一条东去的支流，把灰原切成西、东北、东南三块陆地，
    /// 只有六道天然玄武岩堤能过（D1–D6）：
    ///
    ///   出生 · 灰坡眺台 (−106,−93) +8 → 路遇 a 灰坡余烬 → ① 玄武柱林 (−70,−20)：十余丛玄武岩柱 + +4 柱台
    ///   → ④ 熔渠铸坊 (−57,75)：铸坊熔渠穿场而过（两道小堤），浇包吊车门架跨渠、炉塔、工棚、铸床
    ///   → D2 北堤（路遇 c）→ ③ 祝融残殿 (66,80)：+4 殿台、半埋祝融像、残墙火坛 → D3 东堤（路遇 d）
    ///   → ② 火口丘 (82,−62)：+6.5 小火山锥，火口一口间歇熔泉、锥脚两口 → D5 远东堤（路遇 e）→ 出口祭坛 (106,92)。
    ///   ①–④ 先后不限（不写 requires）；藏宝 A 灰下遗宝（东南角，无守军）、B 烬穴遗藏（西缘，惊动 ⑤ 守军）。
    ///
    /// 布局变体（<see cref="LevelLayout"/>）：main「自灰坡入」= 上面这条；reverse「自火山口入」：东北角祭坛前出生 → 西南眺台上的新祭坛（NavMesh 烘焙后摆），
    /// ③ 换开场编制、给武器，① 换终局编制（两只精英）、给保底精良武器。
    /// 怪要多（用户 11-08：射得爽 = 武器牛逼，怪少了不爽）：必清 4 处各 3 波约 72 只，路遇 5 处约 29 只，可选守军约 11 只；编组全取 <see cref="InfernoSquads"/>。
    /// 场景只放环境和标记（D17 / L1）。生成：Spiritfire ▸ Levels ▸ Build 3-A 赤焰灰原（或 bridge.sh level 3-A）。
    /// </summary>
    [LevelBuilder("3-A", ScenePath)]
    public static class Level_3_A
    {
        public const string Dir = "Assets/Levels/L3_A_AshPlain";
        public const string ScenePath = "Assets/Scenes/L3_A_AshPlain.unity";
        const string Name = "L3_A";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0；远景大火山峰顶约 +78，所以高度范围给到 96 m；地形外缘落回远景地面 PlainY</summary>
        const float Base = 12f, HeightRange = 96f, PlainY = 6f;
        static readonly Vector2 Origin = new(-200, -200), Size = new(400, 400);
        /// <summary>雾：灰原开阔、远景大火山在 360 m 外，雾拉远（大火山读成雾里的剪影）</summary>
        const float FogStart = 70f, FogEnd = 560f;
        /// <summary>风从东北的大火山吹向西南（落灰、烟柱都朝这边偏）</summary>
        static readonly Vector2 Wind = new Vector2(-0.55f, -0.83f).normalized;
        static readonly LevelKit.BoundarySpec Bounds = InfernoBounds();

        static LevelKit.BoundarySpec InfernoBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Inferno";
            return b;
        }

        // ───────────── 高度（世界 y）─────────────
        const float LavaY = 0f, BedY = -1.2f, GroundY0 = 2.6f, DeckY = 2.8f;
        /// <summary>火山口崖：坡脚以上 20–26 m，崖面 5.5 m 宽</summary>
        const float WallH = 20f, WallVar = 6f, WallFace = 5.5f;

        /// <summary>游玩区多边形（火山口底）：外面是崖</summary>
        static readonly Vector2[] Envelope =
        {
            new(-120, -118), new(-60, -122), new(0, -120), new(60, -122), new(110, -118), new(134, -96), new(140, -50), new(138, 0), new(140, 50),
            new(132, 92), new(112, 116), new(60, 120), new(0, 118), new(-60, 120), new(-112, 112), new(-134, 80), new(-138, 30), new(-136, -30), new(-138, -80),
        };

        // ───────────── 熔岩河 ─────────────
        /// <summary>主熔岩河：从东北崖下（大火山方向）涌出，斜穿灰原，从南崖下流走；汇流口 (4, 20) 分出东去的支流</summary>
        static readonly List<Vector2> RiverMain = Spline(new[]
        {
            new Vector2(50, 165), new Vector2(40, 128), new Vector2(28, 90), new Vector2(14, 52), new Vector2(4, 20), new Vector2(0, -14), new Vector2(10, -50),
            new Vector2(26, -86), new Vector2(36, -128), new Vector2(44, -165),
        }, 8);
        static readonly List<Vector2> RiverEast = Spline(new[]
        {
            new Vector2(4, 22), new Vector2(40, 26), new Vector2(76, 16), new Vector2(106, 24), new Vector2(148, 30), new Vector2(185, 36),
        }, 8);
        /// <summary>铸坊熔渠：西北崖脚的熔泉 → 穿过 ④ 铸坊 → 东南端一口熔池</summary>
        static readonly List<Vector2> ForgeChannel = Spline(new[]
        {
            new Vector2(-104, 112), new Vector2(-88, 98), new Vector2(-66, 84), new Vector2(-44, 72), new Vector2(-26, 62),
        }, 8);
        static readonly Vector2 ChannelPool = new(-24, 61);
        const float MainHalf = 7f, EastHalf = 5.5f, ChannelHalf = 3.2f, PoolR = 6f, RiverShoulder = 6f, ChannelShoulder = 3f;

        /// <summary>铸坊熔渠在 ④ 里的直段：起点 (−66,84) → (−44,72)，方向 / 西南侧法线（构建器按「沿渠 s 米、离渠中线 off 米」摆件）</summary>
        static readonly Vector2 ChanA = new(-66, 84), ChanB = new(-44, 72);
        static Vector2 ChanDir => (ChanB - ChanA).normalized;
        /// <summary>熔渠西南侧的单位法线（off &gt; 0 = 西南岸，off &lt; 0 = 东北岸）</summary>
        static Vector2 ChanN => new Vector2(ChanDir.y, -ChanDir.x).y < 0 ? new Vector2(ChanDir.y, -ChanDir.x) : new Vector2(-ChanDir.y, ChanDir.x);
        static Vector2 OnChan(float s, float off) => ChanA + ChanDir * s + ChanN * off;
        /// <summary>熔渠方向的偏航（Prefab +Z 朝东北岸）与 +X 沿渠的偏航</summary>
        static float ChanFaceNE => YawZ(-ChanN);
        static float ChanAlongX => -Mathf.Atan2(ChanDir.y, ChanDir.x) * Mathf.Rad2Deg;
        /// <summary>+X 横跨熔渠的偏航（浇包吊车门架：两条腿各落一岸）</summary>
        static float ChanAcrossX => -Mathf.Atan2(ChanN.y, ChanN.x) * Mathf.Rad2Deg;

        // ───────────── 玄武岩堤（样条 + 纵断面，只填不挖）─────────────
        sealed class Dike
        {
            public string id, label;
            public PathSpline path;
            public float half, shoulder;
            public bool route = true;
        }

        static Dike MakeDike(string id, string label, float half, Vector2[] ctrl, bool route = true)
        {
            var heights = new float[ctrl.Length];
            for (int i = 0; i < ctrl.Length; i++) heights[i] = i == 0 || i == ctrl.Length - 1 ? GroundY0 : DeckY;
            return new Dike { id = id, label = label, half = half, shoulder = 3f, route = route, path = new PathSpline(ctrl, 6).WithHeights(heights, 0, 15f) };
        }

        static readonly Dike D1 = MakeDike("D1", "南堤", 4.5f, new[] { new Vector2(-16, -41), new Vector2(-2, -44), new Vector2(10, -47.5f), new Vector2(26, -51) });
        static readonly Dike D2 = MakeDike("D2", "北堤", 4.5f, new[] { new Vector2(2, 64), new Vector2(14, 68), new Vector2(26, 72), new Vector2(40, 76) });
        static readonly Dike D3 = MakeDike("D3", "东堤", 4.5f, new[] { new Vector2(74, -2), new Vector2(76, 9), new Vector2(77, 22), new Vector2(78, 34) });
        static readonly Dike D4 = MakeDike("D4", "远南堤", 4f, new[] { new Vector2(10, -91), new Vector2(23, -94), new Vector2(34, -97), new Vector2(48, -100) });
        static readonly Dike D5 = MakeDike("D5", "远东堤", 4f, new[] { new Vector2(118, 8), new Vector2(119, 19), new Vector2(121, 31), new Vector2(122, 44) });
        static readonly Dike D6 = MakeDike("D6", "汇流堤", 4f, new[] { new Vector2(-10, 30), new Vector2(3, 34), new Vector2(14, 37), new Vector2(26, 40) });
        /// <summary>铸坊熔渠上的两道小堤（④ 里，沿渠 3 m / 21 m 处横跨）</summary>
        static readonly Dike F1 = MakeDike("F1", "铸坊西堤", 2.5f, new[] { OnChan(3, 9), OnChan(3, 0), OnChan(3, -9) }, false);
        static readonly Dike F2 = MakeDike("F2", "铸坊东堤", 2.5f, new[] { OnChan(24, 9), OnChan(24, 0), OnChan(24, -9) }, false);
        static readonly Dike[] Dikes = { D1, D2, D3, D4, D5, D6, F1, F2 };

        // ───────────── 台地（柱台、殿台、眺台、出口台）─────────────
        sealed class Terrace
        {
            public string name;
            public Vector2 c, half;
            public float rise, edge;
            public (Vector2 foot, Vector2 top, float width)[] ramps;
            public float TopY => GroundY0 + rise;
        }

        static readonly Terrace Overlook = new()
        {
            name = "灰坡眺台", c = new Vector2(-108, -95), half = new Vector2(9, 8), rise = 5.5f, edge = 1.6f,
            ramps = new[] { (new Vector2(-79, -95), new Vector2(-99, -95), 8f) },
        };
        static readonly Terrace ColumnTable = new()
        {
            name = "柱台", c = new Vector2(-84, -30), half = new Vector2(7, 5), rise = 4.2f, edge = 1.2f,
            ramps = new[] { (new Vector2(-60, -30), new Vector2(-77f, -30), 6f), (new Vector2(-84, -8), new Vector2(-84, -25f), 5f) },
        };
        static readonly Terrace Temple = new()
        {
            name = "殿台", c = new Vector2(70, 88), half = new Vector2(14, 10), rise = 4f, edge = 2.5f,
            ramps = new[] { (new Vector2(70, 62), new Vector2(70, 79f), 8f), (new Vector2(39, 88), new Vector2(57f, 88), 6f) },
        };
        static readonly Terrace ExitPad = new()
        {
            name = "出口台", c = new Vector2(106, 92), half = new Vector2(6, 6), rise = 0.9f, edge = 3f, ramps = Array.Empty<(Vector2, Vector2, float)>(),
        };
        static readonly Terrace[] Terraces = { Overlook, ColumnTable, Temple, ExitPad };
        static readonly (Vector2 foot, Vector2 top, float width)[] NoRamps = Array.Empty<(Vector2, Vector2, float)>();

        // ───────────── 火口丘（② 的小火山锥）─────────────
        static readonly Vector2 ConeC = new(82, -62);
        const float ConeRim = 6.5f, ConeRimR = 9f, ConeBase = 27f, CraterFloor = 3.4f, CraterR = 3.5f;

        // ───────────── 远景大火山 ─────────────
        static readonly Vector2 VolcanoC = new(150, 160);
        const float VolcanoPeak = 78f, VolcanoR = 100f, VolcanoCraterR = 13f, VolcanoCraterDepth = 9f;

        // ───────────── 场地中心与关键点 ─────────────
        static readonly Vector2 Spawn = new(-106, -93);
        static readonly Vector2 S1 = new(-70, -20), S2 = ConeC, S3 = new(66, 80);
        /// <summary>④ 中心：熔渠西南岸、两座工棚之间的空地（沿渠 12 m、离渠中线 13 m）</summary>
        static Vector2 S4 => OnChan(12, 13);
        static readonly Vector2 ExitAt = ExitPad.c;
        const float ExitYaw = -135f;
        /// <summary>逆行变体的出口祭坛：西南眺台的后沿、面朝东北（主走法里停用）</summary>
        static readonly Vector2 RevExitAt = new(-112.5f, -99f);
        const float RevExitYaw = 45f;
        static Vector2 ExitFace => new(Mathf.Sin(ExitYaw * Mathf.Deg2Rad), Mathf.Cos(ExitYaw * Mathf.Deg2Rad));
        static Vector2 RevSpawn => ExitAt + ExitFace * 6.5f;
        static readonly Vector2 StatueAt = new(70, 93.5f);
        const float StatueScale = 1.4f, StatueSink = 3f;
        static readonly Vector2 GuardSite = new(-106, 30), CacheA = new(108, -96), CacheB = new(-114, 31);
        static readonly Vector2 RoadA = new(-84, -66), RoadB = new(-14, -43), RoadC = new(4, 63), RoadD = new(74, -4), RoadE = new(118, 6);
        /// <summary>入场点「柱林北 · 余烬」的渣堆位置</summary>
        static readonly Vector2 EntryEmber = new(-84, 30);

        // ───────────── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深）─────────────
        const string ColumnsId = "SM_Tripo_InfernoBasaltColumns", RibId = "SM_Tripo_InfernoRockRib", SegmentId = "SM_Tripo_InfernoCausewaySegment",
            ColumnId = "SM_Tripo_InfernoColumn", StatueId = "SM_Tripo_InfernoZhurong", ShrineId = "SM_Tripo_InfernoPortalShrine", RampartId = "SM_Tripo_InfernoRampart",
            TowerId = "SM_Tripo_InfernoFurnaceTower", StallId = "SM_Tripo_InfernoForgeStall", BarricadeId = "SM_Tripo_InfernoBarricade",
            CoverWallId = "SM_Tripo_InfernoCoverWall", CauldronId = "SM_Tripo_InfernoCauldronRuin", IngotId = "SM_Tripo_InfernoIngotPile",
            AltarId = "SM_Tripo_InfernoFireAltar", HoardId = "SM_Tripo_InfernoTreasureHoard", ObeliskId = "SM_Prop_InfernoChainObelisk", CrucibleId = "SM_Prop_InfernoCrucible",
            GatewayId = "SM_Tripo_InfernoGateway", ShedId = "SM_Tripo_InfernoWorkShed", BellowsId = "SM_Tripo_InfernoBellows", BedId = "SM_Tripo_InfernoCastingBed",
            MouldId = "SM_Tripo_InfernoCastingMould", CraneId = "SM_Tripo_InfernoLadleCrane", BreakId = "SM_Tripo_InfernoCausewayBreak";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            [ColumnsId] = new(6.63f, 9f, 6.52f), [RibId] = new(9.37f, 16f, 7.54f), [SegmentId] = new(8.48f, 5f, 4.14f), [BreakId] = new(8.7f, 5f, 8.77f),
            [ColumnId] = new(1.97f, 4.93f, 1.81f), [StatueId] = new(7.8f, 15.43f, 6.83f), [ShrineId] = new(7.59f, 10.68f, 2.15f), [RampartId] = new(7.59f, 8.82f, 2.36f),
            [TowerId] = new(6.13f, 12.86f, 4.99f), [StallId] = new(2.6f, 3.47f, 1.63f), [BarricadeId] = new(3.56f, 1.18f, 0.47f), [CoverWallId] = new(3.42f, 2.48f, 0.89f),
            [CauldronId] = new(3.11f, 1.54f, 1.53f), [IngotId] = new(2.18f, 1.52f, 1.81f), [AltarId] = new(1.13f, 2.36f, 1.15f), [HoardId] = new(2.31f, 1.71f, 1.56f),
            [ObeliskId] = new(1.08f, 2.13f, 1.08f), [CrucibleId] = new(1.27f, 0.99f, 1.28f), [GatewayId] = new(11.31f, 10.75f, 2.2f),
            [ShedId] = new(8.5f, 7f, 6.3f), [BellowsId] = new(9.26f, 5f, 4.02f), [BedId] = new(5.28f, 1.4f, 2.09f), [MouldId] = new(2.33f, 2.8f, 1.25f),
            [CraneId] = new(17.22f, 13f, 8.09f),
        };

        const float ColumnH = 4.93f, ColumnSink = 0.25f, AltarBig = 1.3f;

        // ───────────── 刷怪站位 ─────────────
        /// <summary>
        /// 站位（名字、场地、位置、角色、出场方式、高台、辅助点、辅助点高、站位离地高）。场地编号：1–4 必清，5 烬穴守军，11–15 路遇 a–e。
        /// 现身站位（Appear）给没写出场方式的条目；埋伏 / 余烬 / 增援门 / 跃下 / 飞临 / 熔岩爬出照 <see cref="InfernoSquads"/> 各编组的写法摆。
        /// 余烬起身的站位上摆渣堆（BuildSites）；熔岩爬出的站位在熔岩岸上（冒出点自动在站位外 3–8 m 的熔岩里找）；栖柱顶的站位 lift = 柱高。
        /// </summary>
        static readonly (string name, int site, Vector2 at, StationRole role, SpawnMode mode, bool elevated, Vector2 aux, float auxY, float lift)[] Anchors = BuildAnchors();

        const float Perch = ColumnH - ColumnSink + 0.05f;

        static (string, int, Vector2, StationRole, SpawnMode, bool, Vector2, float, float)[] BuildAnchors()
        {
            var list = new List<(string, int, Vector2, StationRole, SpawnMode, bool, Vector2, float, float)>();
            const float N = float.NaN;
            void A(string name, int site, Vector2 at, StationRole role, SpawnMode mode = SpawnMode.Appear, bool elevated = false, Vector2 aux = default,
                float auxY = N, float lift = N) => list.Add((name, site, at, role, mode, elevated, aux, auxY, lift));

            // ① 玄武柱林：四面现身位、柱台上远程位；毕方栖在三根栖柱顶（埋伏）；渣堆余烬；三条增援门 lane；马面从柱台沿跃下；炮仗埋在柱台上；飞鸦飞临栖柱
            A("Enemy_1_N", 1, new Vector2(-70, 2), StationRole.Assault);
            A("Enemy_1_E", 1, new Vector2(-48, -16), StationRole.Flank);
            A("Enemy_1_W", 1, new Vector2(-96, -8), StationRole.Flank);
            A("Enemy_1_S", 1, new Vector2(-62, -44), StationRole.Assault);
            A("Enemy_1_Table", 1, new Vector2(-86, -28), StationRole.Ranged);
            A("Mode_1_PerchE", 1, new Vector2(-55, -11), StationRole.Precision, SpawnMode.Ambush, true, lift: Perch);
            A("Mode_1_PerchW", 1, new Vector2(-91, -7), StationRole.Precision, SpawnMode.Ambush, true, lift: Perch);
            A("Mode_1_PerchS", 1, new Vector2(-72, -36), StationRole.Precision, SpawnMode.Ambush, true, lift: Perch);
            A("Mode_1_Ember1", 1, new Vector2(-65, -12), StationRole.Auto, SpawnMode.Ember);
            A("Mode_1_Ember2", 1, new Vector2(-78, -19), StationRole.Auto, SpawnMode.Ember);
            A("Mode_1_Ember3", 1, new Vector2(-59, -28), StationRole.Auto, SpawnMode.Ember);
            A("Mode_1_Ember4", 1, new Vector2(-75, -2), StationRole.Auto, SpawnMode.Ember);
            A("Mode_1_GateE", 1, new Vector2(-47, -22), StationRole.Assault, SpawnMode.Gate, aux: new Vector2(-34, -20));
            A("Mode_1_GateN", 1, new Vector2(-66, 4), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(-64, 18));
            A("Mode_1_GateS", 1, new Vector2(-58, -46), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(-54, -60));
            A("Mode_1_DropS", 1, new Vector2(-84, -39), StationRole.Ranged, SpawnMode.Drop, aux: new Vector2(-84, -34), auxY: ColumnTable.TopY);
            A("Mode_1_DropE", 1, new Vector2(-73, -25), StationRole.Ranged, SpawnMode.Drop, aux: new Vector2(-78f, -26), auxY: ColumnTable.TopY);

            // ② 火口丘：锥脚四面现身位、火口缘远程位；炮仗一窝埋在北缘；马面埋在南缘；铁牛从锥脚东西两头的增援门走出；飞鸦飞临锥脚栖柱
            A("Enemy_2_W", 2, new Vector2(58, -58), StationRole.Assault);
            A("Enemy_2_N", 2, new Vector2(84, -36), StationRole.Flank);
            A("Enemy_2_E", 2, new Vector2(106, -66), StationRole.Flank);
            A("Enemy_2_S", 2, new Vector2(78, -88), StationRole.Assault);
            A("Enemy_2_Rim", 2, new Vector2(82, -53.5f), StationRole.Ranged);
            A("Mode_2_Pod1", 2, new Vector2(80, -53), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_2_Pod2", 2, new Vector2(83, -52.5f), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_2_Pod3", 2, new Vector2(85.5f, -54.5f), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_2_Post", 2, new Vector2(82, -70.5f), StationRole.Ranged, SpawnMode.Ambush);
            A("Mode_2_GateW", 2, new Vector2(56, -66), StationRole.Assault, SpawnMode.Gate, aux: new Vector2(44, -70));
            A("Mode_2_GateE", 2, new Vector2(108, -56), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(120, -52));
            A("Mode_2_SkyNW", 2, new Vector2(64, -44), StationRole.Precision, SpawnMode.FlyIn, true, lift: Perch);
            A("Mode_2_SkySE", 2, new Vector2(100, -80), StationRole.Precision, SpawnMode.FlyIn, true, lift: Perch);

            // ③ 祝融残殿：台下三面现身位、台上远程位；傩巫埋在神像前；毕方栖在三根残柱顶；渣堆余烬；三条增援门；马面从台沿跃下；炮仗埋在台上；飞鸦飞临残柱
            A("Enemy_3_SW", 3, new Vector2(50, 70), StationRole.Assault);
            A("Enemy_3_SE", 3, new Vector2(88, 68), StationRole.Flank);
            A("Enemy_3_W", 3, new Vector2(42, 96), StationRole.Flank);
            A("Enemy_3_E", 3, new Vector2(94, 86), StationRole.Assault);
            A("Enemy_3_Deck", 3, new Vector2(70, 84), StationRole.Ranged);
            A("Mode_3_Nuo", 3, new Vector2(70, 87.5f), StationRole.Support, SpawnMode.Ambush);
            A("Mode_3_Ember1", 3, new Vector2(53, 82), StationRole.Auto, SpawnMode.Ember);
            A("Mode_3_Ember2", 3, new Vector2(87, 80), StationRole.Auto, SpawnMode.Ember);
            A("Mode_3_Ember3", 3, new Vector2(60, 70), StationRole.Auto, SpawnMode.Ember);
            A("Mode_3_Ember4", 3, new Vector2(80, 70), StationRole.Auto, SpawnMode.Ember);
            A("Mode_3_GateSW", 3, new Vector2(48, 66), StationRole.Assault, SpawnMode.Gate, aux: new Vector2(40, 56));
            A("Mode_3_GateE", 3, new Vector2(96, 78), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(108, 76));
            A("Mode_3_GateNW", 3, new Vector2(46, 102), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(38, 110));
            A("Mode_3_DropW", 3, new Vector2(52, 90), StationRole.Ranged, SpawnMode.Drop, aux: new Vector2(57, 91), auxY: Temple.TopY);
            A("Mode_3_DropE", 3, new Vector2(88, 90), StationRole.Ranged, SpawnMode.Drop, aux: new Vector2(83, 91), auxY: Temple.TopY);
            A("Mode_3_Pod1", 3, new Vector2(64, 81), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_3_Pod2", 3, new Vector2(76, 81), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_3_SkyW", 3, new Vector2(59, 96), StationRole.Precision, SpawnMode.FlyIn, true, lift: Perch);
            A("Mode_3_SkyE", 3, new Vector2(81, 96), StationRole.Precision, SpawnMode.FlyIn, true, lift: Perch);
            A("Mode_3_SkySW", 3, new Vector2(52, 76), StationRole.Precision, SpawnMode.FlyIn, true, lift: Perch);

            // ④ 熔渠铸坊：两岸现身位；火鼍 / 炭童从熔渠爬出；马面埋在东北岸炉台；铜匠埋在范列后、炮仗埋在铸床上；渣堆余烬；三条增援门（炉塔后、两岸外侧）
            A("Enemy_4_SW", 4, OnChan(1, 11.5f), StationRole.Assault);
            A("Enemy_4_SE", 4, OnChan(31, 11), StationRole.Flank);
            A("Enemy_4_NW", 4, OnChan(1, -13.5f), StationRole.Flank);
            A("Enemy_4_NE", 4, OnChan(22, -13), StationRole.Assault);
            A("Mode_4_Lava1", 4, OnChan(11.5f, 6.8f), StationRole.Auto, SpawnMode.LavaCrawl);
            A("Mode_4_Lava2", 4, OnChan(-7.5f, 7f), StationRole.Auto, SpawnMode.LavaCrawl);
            A("Mode_4_Lava3", 4, OnChan(11.5f, -7.5f), StationRole.Auto, SpawnMode.LavaCrawl);
            A("Mode_4_Lava4", 4, OnChan(34, -7.5f), StationRole.Auto, SpawnMode.LavaCrawl);
            A("Mode_4_Post", 4, OnChan(26, -16.5f), StationRole.Ranged, SpawnMode.Ambush);
            A("Mode_4_Founder", 4, OnChan(30, 14.5f), StationRole.Support, SpawnMode.Ambush);
            A("Mode_4_Pod1", 4, OnChan(9f, 8.4f), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_4_Pod2", 4, OnChan(6.5f, 8.4f), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_4_Ember1", 4, OnChan(9, 15), StationRole.Auto, SpawnMode.Ember);
            A("Mode_4_Ember2", 4, OnChan(14, 18), StationRole.Auto, SpawnMode.Ember);
            A("Mode_4_Ember3", 4, OnChan(33, 16), StationRole.Auto, SpawnMode.Ember);
            A("Mode_4_GateW", 4, OnChan(-11, 9), StationRole.Assault, SpawnMode.Gate, aux: OnChan(-21, 13));
            A("Mode_4_GateS", 4, OnChan(12, 22), StationRole.Flank, SpawnMode.Gate, aux: OnChan(12, 34));
            A("Mode_4_GateNE", 4, OnChan(31, -15), StationRole.Flank, SpawnMode.Gate, aux: OnChan(37, -27));

            // ⑤ 烬穴守军（可选）：炮仗一窝、两条增援门
            A("Enemy_5_A", 5, new Vector2(-100, 22), StationRole.Assault);
            A("Enemy_5_B", 5, new Vector2(-100, 39), StationRole.Flank);
            A("Mode_5_Pod1", 5, new Vector2(-116, 38), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_5_Pod2", 5, new Vector2(-118, 35.5f), StationRole.Artillery, SpawnMode.Ambush);
            A("Mode_5_GateS", 5, new Vector2(-98, 18), StationRole.Assault, SpawnMode.Gate, aux: new Vector2(-92, 6));
            A("Mode_5_GateN", 5, new Vector2(-98, 44), StationRole.Flank, SpawnMode.Gate, aux: new Vector2(-94, 56));

            // 路遇 a（灰坡余烬）：坡脚渣堆
            A("Mode_11_Ember1", 11, RoadA + new Vector2(-5, 3), StationRole.Auto, SpawnMode.Ember);
            A("Mode_11_Ember2", 11, RoadA + new Vector2(4, 5), StationRole.Auto, SpawnMode.Ember);
            A("Mode_11_Ember3", 11, RoadA + new Vector2(6, -4), StationRole.Auto, SpawnMode.Ember);
            A("Mode_11_Ember4", 11, RoadA + new Vector2(-3, -6), StationRole.Auto, SpawnMode.Ember);
            A("Mode_11_Gate", 11, RoadA + new Vector2(14, 6), StationRole.Flank, SpawnMode.Gate, aux: RoadA + new Vector2(26, 12));
            // 驻守点 b–e（堤头守卫）：开局就站在堤头（埋伏，玩家先看见），走近 / 开枪整组苏醒；第二波炭童从堤两侧熔岩爬出、毕方栖在堤头栖柱顶（e 是火鼍）
            void Garrison(int site, Vector2 head, Vector2 facing, bool artillery)
            {
                var f = facing.normalized;
                var side = new Vector2(f.y, -f.x);
                A($"Mode_{site}_PostA", site, head + side * 3.5f, StationRole.Auto, SpawnMode.Ambush);
                A($"Mode_{site}_PostB", site, head - side * 3.5f, StationRole.Auto, SpawnMode.Ambush);
                A($"Mode_{site}_PostC", site, head - f * 3f + side * 1.5f, StationRole.Flank, SpawnMode.Ambush);
                A($"Mode_{site}_PostD", site, head - f * 3f - side * 2f, StationRole.Auto, SpawnMode.Ambush);
                A($"Mode_{site}_PostR", site, head - f * 6.5f, artillery ? StationRole.Artillery : StationRole.Ranged, SpawnMode.Ambush);
                if (artillery) A($"Mode_{site}_PostR2", site, head - f * 6.5f + side * 2.5f, StationRole.Artillery, SpawnMode.Ambush);
            }
            Garrison(12, RoadB, new Vector2(-1, 0.1f), false);
            Garrison(13, RoadC, new Vector2(-1, -0.2f), true);
            Garrison(14, RoadD, new Vector2(0.2f, -1), false);
            Garrison(15, RoadE, new Vector2(0, -1), false);
            void Shore(int site, string tag, List<Vector2> river, float half, Vector2 near, float side)
            {
                for (int k = 0; k < 3; k++)
                {
                    var p = near + new Vector2(-side * 0, 0) + new Vector2(k * 5 - 5, k * 2 - 2);
                    list.Add(($"Mode_{site}_Lava{k + 1}", site, Bank(river, p, half, 4.5f), StationRole.Auto, SpawnMode.LavaCrawl, false, default, N, N));
                }
            }
            Shore(12, "b", RiverMain, MainHalf, new Vector2(-2, -38), 1);
            A("Mode_12_Perch", 12, RoadB + new Vector2(-6, 6), StationRole.Precision, SpawnMode.Ambush, true, lift: Perch);
            Shore(13, "c", RiverMain, MainHalf, new Vector2(8, 52), 1);
            Shore(14, "d", RiverEast, EastHalf, new Vector2(70, 8), 1);
            A("Mode_14_Perch", 14, RoadD + new Vector2(-7, -5), StationRole.Precision, SpawnMode.Ambush, true, lift: Perch);
            Shore(15, "e", RiverEast, EastHalf, new Vector2(124, 16), 1);
            return list.ToArray();
        }

        /// <summary>河岸上的落脚点：离 near 最近的河中线点，沿它指向 near 的方向挪到 半宽 + off 米</summary>
        static Vector2 Bank(List<Vector2> river, Vector2 near, float half, float off)
        {
            PolylineClosest(near, river, out _, out var c, out _);
            var d = near - c;
            if (d.sqrMagnitude < 1e-4f) d = Vector2.right;
            return c + d.normalized * (half + off);
        }

        static Vector2 SiteCenter(int site) => site switch
        {
            1 => S1, 2 => S2, 3 => S3, 4 => S4, 5 => GuardSite, 11 => RoadA, 12 => RoadB, 13 => RoadC, 14 => RoadD, 15 => RoadE, _ => Vector2.zero,
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：多边形，崖线带噪声摆动</summary>
        static float Inside(Vector2 q)
        {
            float ins = LevelKit.PolygonSigned(q, Envelope);
            return ins + Fbm(q, 22, 3, 61) * 2.2f + Fbm(q, 6, 2, 63) * 0.6f;
        }

        /// <summary>可玩区遮罩（软边界与 L5 共用）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        /// <summary>灰原面：+2.6 上下 ±1 的缓起伏 + 细碎的落灰波纹</summary>
        static float PlainHeight(Vector2 q) => GroundY0 + Fbm(q, 46, 3, 7) * 0.9f + Fbm(q, 13, 2, 9) * 0.25f;

        /// <summary>按到河中线的距离挖河床：半宽内是河床，肩宽内缓坡回到地面；河岸线带噪声</summary>
        static float Carve(Vector2 q, float h, float d, float half, float shoulder, ref float river)
        {
            d += Fbm(q, 9, 2, 13) * 1.1f;
            float t = Smooth(half, half + shoulder, d);
            river = Mathf.Max(river, 1 - t);
            return Mathf.Min(h, Mathf.Lerp(BedY, h, t));
        }

        static LevelKit.Sample Eval(Vector2 q)
        {
            var s = new LevelKit.Sample();
            float plain = PlainHeight(q);
            float h = plain;

            // ── 熔岩河、铸坊熔渠、熔池 ──
            float river = 0;
            h = Carve(q, h, Polyline(q, RiverMain).dist, MainHalf, RiverShoulder, ref river);
            h = Carve(q, h, Polyline(q, RiverEast).dist, EastHalf, RiverShoulder, ref river);
            h = Carve(q, h, Polyline(q, ForgeChannel).dist, ChannelHalf, ChannelShoulder, ref river);
            h = Carve(q, h, Vector2.Distance(q, ChannelPool), PoolR, 4f, ref river);

            // ── 火口丘：外坡 +6.5（缓坡可走上缘），火口 +3.4 ──
            float coneTop = 0;
            float dc = Vector2.Distance(q, ConeC);
            if (dc < ConeBase + 2)
            {
                float coneH = dc >= ConeRimR
                    ? ConeRim * (1 - Smooth(ConeRimR, ConeBase, dc))
                    : Mathf.Lerp(CraterFloor, ConeRim, Smooth(CraterR, ConeRimR, dc));
                coneH += Fbm(q, 5, 2, 71) * 0.25f * Smooth(ConeBase, ConeRimR, dc);
                h = Mathf.Max(h, GroundY0 + coneH);
                coneTop = 1 - Smooth(ConeRimR - 1.5f, ConeRimR + 2f, Mathf.Abs(dc - ConeRimR) + ConeRimR - 1.5f);
            }

            // ── 台地 + 坡道：台脚和坡脚一圈压平到 GroundY0（灰原的起伏不在坡脚留台阶），坡道按缓入缓出的纵断面单独填 ──
            float terraceTop = 0, rampAny = 0;
            foreach (var tr in Terraces)
            {
                var dq = q - tr.c;
                float ox = Mathf.Max(0, Mathf.Abs(dq.x) - tr.half.x), oz = Mathf.Max(0, Mathf.Abs(dq.y) - tr.half.y);
                float apron = 1 - Smooth(tr.edge + 1f, tr.edge + 9f, Mathf.Sqrt(ox * ox + oz * oz));
                foreach (var (foot, top, width) in tr.ramps)
                {
                    var ab = top - foot;
                    var start = foot - ab.normalized * 5f;
                    var se = top - start;
                    float tt = Mathf.Clamp01(Vector2.Dot(q - start, se) / se.sqrMagnitude);
                    float rd = Vector2.Distance(q, start + se * tt);
                    apron = Mathf.Max(apron, 1 - Smooth(width * 0.5f + 1.5f, width * 0.5f + 8f, rd));
                }
                if (apron > 0 && h > LavaY + 0.8f) h = Mathf.Lerp(h, GroundY0, apron);
                float pv = Plateau(q, tr.c, tr.half, 0, tr.rise, tr.edge, NoRamps);
                if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(h, GroundY0 + pv, Smooth(0, 0.6f, pv)));
                terraceTop = Mathf.Max(terraceTop, Smooth(tr.rise * 0.6f, tr.rise - 0.05f, pv));
                foreach (var (foot, top, width) in tr.ramps)
                {
                    var (t, m) = Ramp(q, foot, top, width, 1.6f);
                    if (m <= 0) continue;
                    float target = Mathf.Lerp(GroundY0, tr.TopY, Smooth(0, 1, t) * 0.25f + t * 0.75f);
                    h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                    rampAny = Mathf.Max(rampAny, m);
                }
            }

            // ── 玄武岩堤（只填不挖）──
            float deck = 0;
            foreach (var d in Dikes)
            {
                var (dist, t) = d.path.Nearest(q, d.half + d.shoulder);
                float m = 1 - Smooth(d.half, d.half + d.shoulder, dist);
                if (m <= 0) continue;
                float top = d.path.HeightAt(t);
                h = Mathf.Max(h, Mathf.Lerp(h, top, m));
                deck = Mathf.Max(deck, 1 - Smooth(d.half - 0.8f, d.half + 0.4f, dist));
            }

            // ── 火山口崖 + 崖外远景（大火山）──
            float ins = Inside(q);
            if (ins < 4f)
            {
                float wallH = WallH + WallVar * (Fbm(q, 60, 2, 31) * 0.5f + 0.5f);
                float foot = Mathf.Max(h, BedY);
                h = Mathf.Max(h, foot + LevelKit.RimProfile(ins, 1f, 3f, wallH, WallFace));
                if (ins < -12f) h = Mathf.Lerp(h, PlainY + Fbm(q, 70, 2, 51) * 2f, Smooth(-12f, -95f, ins));
                float vd = Vector2.Distance(q, VolcanoC);
                if (vd < VolcanoR)
                {
                    float cone = VolcanoPeak * Mathf.Pow(1 - Smooth(VolcanoCraterR, VolcanoR, vd), 1.35f);
                    cone -= VolcanoCraterDepth * (1 - Smooth(VolcanoCraterR * 0.5f, VolcanoCraterR, vd));
                    cone += Ridged(q, 18, 3, 77) * 3f * Smooth(VolcanoR, VolcanoCraterR, vd);
                    h = Mathf.Max(h, Mathf.Lerp(h, PlainY + cone, Smooth(-2f, -14f, ins)));
                }
            }

            // ── 熔岩河穿过火山口崖：崖上切出窄峡口（肩宽 2.5 m，峡壁近乎直立），熔岩从峡口流进流出 ──
            if (ins < 6f)
            {
                float gorge = 0;
                float sh = Mathf.Lerp(2.5f, RiverShoulder, Smooth(0f, 6f, ins));
                h = Carve(q, h, Polyline(q, RiverMain).dist, MainHalf, sh, ref gorge);
                h = Carve(q, h, Polyline(q, RiverEast).dist, EastHalf, sh, ref gorge);
            }

            // ── 地形外缘 30 m 内落回远景地面 ──
            var local = q - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 30, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Inferno：陡坡自动玄武岩）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            s.fluid = 1 - Smooth(LavaY + 0.05f, LavaY + 0.45f, h);
            float band = Smooth(LavaY + 0.25f, LavaY + 0.6f, h) * (1 - Smooth(1.4f, 2.2f, h));
            s.shore = band * (1 - deck) * inside;
            s.packed = Mathf.Max(Mathf.Max(deck * 0.9f, terraceTop * 0.85f), Mathf.Max(coneTop * 0.5f, rampAny * 0.8f));
            // 落灰：灰原大部分是灰（细噪声调成块），河岸和堤面、台面少
            float ash = 0.55f + Fbm(q, 18, 2, 17) * 0.35f;
            s.sand = Mathf.Clamp01(ash) * inside * (1 - deck) * (1 - band * 0.8f) * (1 - terraceTop * 0.6f);
            float cliffBand = Smooth(0.5f, -1.5f, ins) * (1 - Smooth(-7, -10, ins));
            s.rock = Mathf.Max(cliffBand, coneTop * 0.3f);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-A 赤焰灰原", priority = 75)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        static LevelKit.TerrainSet ts;
        static Vector3 G(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        /// <summary>生成场景 → 烘焙 NavMesh（人形 + 火鼍）→ 布局变体 → 验收 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Inferno;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var arch = new GameObject("Architecture").transform;
            var props = new GameObject("Props").transform;
            var world = new GameObject("World").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            RenderSettings.fogStartDistance = FogStart;
            RenderSettings.fogEndDistance = FogEnd;
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            try
            {
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, Vector2.zero, PlainY, 760, 9);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);

                // 熔岩（L7）：一片盒子盖住整个火山口底，灰原、堤、台靠高度排除；河面用暗壳材质（暗色结壳、亮缝只做危险提示）
                var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Ash Plain Rivers", center = new Vector3(0, LavaY, 0), shape = LavaShape.Box, size = new Vector2(300, 270), depth = 2.5f, depthShore = true,
                }, world);
                if (lava.surface && LevelKit.Ch3LavaCrust(Dir, "RiverCrust", 0.12f, 0.07f, 1.4f) is { } crust) lava.surface.sharedMaterial = crust;

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                LevelKit.Weather(env, theme, Wind, LevelKit.InfernoLight.AshWindOpen, new WeatherDirector.Region
                {
                    name = "火山落灰", center = new Vector3(20, 0, 10), radius = 150, fade = 60, profile = WeatherProfiles.Ashfall,
                    from = -Wind, calm = 60, warn = 8, storm = 18, abate = 8, firstDelay = 50, armRadius = 360, loop = true,
                });

                var smokeAt = BuildVolcano(env);
                var statueHead = BuildSites(arch, props, markers);
                BuildDikeFacades(arch);
                BuildScatter(env, theme);
                BuildMarkers(markers);

                var spawnAt = G(Spawn, 0.05f);
                var look = smokeAt - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.sqrMagnitude > 1e-4f ? look.normalized : Vector3.forward);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

                var rep = new LevelKit.Report();
                rep.Line("3-A 赤焰灰原 · 验收（第三章备选图）");
                var objective = BuildEncounters(markers, rep);
                BuildGeysers(world, objective);
                BuildCaches(markers, objective);
                var portal = BuildExit(markers, arch, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                var walkNav = LevelKit.BakeNavMesh(Dir, Name, env);
                if (!NavMesh.SamplePosition(G(Spawn), out _, 4f, LavaField.WalkerFilter()))
                {
                    rep.Warn("人形导航网格烘完在出生点采不到：重烘一次");
                    Object.DestroyImmediate(walkNav.gameObject);
                    LevelKit.BakeNavMesh(Dir, Name, env);
                }
                LevelKit.BakeLavaNavMesh(Dir, Name, env);
                BuildEntries(markers);
                BuildLayout(arch, markers, playerSpawn, portal, objective);
                BuildGuideLamps(props);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                rep.Line($"高度：眺台 {G(Spawn).y:F1}，灰原 {G(new Vector2(-40, -70)).y:F1}，柱台 {G(ColumnTable.c).y:F1}，殿台 {G(Temple.c).y:F1}，" +
                         $"火口丘缘 {G(ConeC + new Vector2(0, ConeRimR)).y:F1} / 火口 {G(ConeC).y:F1}，堤面 {G(D1.path.At(0.5f)).y:F1}，河床 {G(new Vector2(0, -14)).y:F1}");
                LevelValidator.Run(Spec(statueHead, smokeAt), rep);
                LevelKit.ValidateLava(rep);
                LevelKit.CheckEntries(rep, scene);
                CheckEntryDistances(rep, scene);
                CheckSceneContents(rep, scene, portal);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_3-A_report.txt");

                if (review) Review(spawnAt, spawnRot, statueHead, smokeAt);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 statueHead, Vector3 smokeAt)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-A", new[]
                {
                    ("Aerial", new Vector3(-170, 140, -180), new Vector3(10, 0, 0), false),
                    ("Map", new Vector3(0, 420, -1), new Vector3(0, 0, 0), false),
                    ("Spawn", E(Spawn), smokeAt, true),
                    ("ColumnForest", E(new Vector2(-50, -46)), G(ColumnTable.c, 4), false),
                    ("TableTop", E(ColumnTable.c + new Vector2(1, 0)), statueHead, false),
                    ("Forge", E(OnChan(10, -26), 3f), G(OnChan(14, 8), 4), false),
                    ("NorthDike", E(D2.path.At(0.1f)), statueHead, false),
                    ("Temple", E(new Vector2(70, 56)), statueHead, false),
                    ("TempleDeck", E(Temple.c + new Vector2(0, -6)), G(ExitAt, 5), false),
                    ("EastDike", E(D3.path.At(0.9f)), G(ConeC, 5), false),
                    ("Cone", E(new Vector2(52, -40)), G(ConeC, 5), false),
                    ("ConeRim", E(ConeC + new Vector2(0, -ConeRimR)), smokeAt, false),
                    ("SouthDike", E(D1.path.At(0.05f)), G(D1.path.At(1f), 2), false),
                    ("CacheB", E(GuardSite + new Vector2(12, -6)), G(CacheB, 1), false),
                    ("RevSpawn", E(RevSpawn), G(S3, 4), true),
                    ("RevExit", E(new Vector2(-82, -90)), G(RevExitAt, 5), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆放 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");
        static Material PlaceholderMat => LevelKit.Ch3Placeholder(Dir);

        static GameObject Put(string id, Transform parent, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, float? baseY = null)
        {
            var size = (DesignSize.TryGetValue(id, out var d) ? d : Vector3.one * 2) * scale;
            var p = baseY.HasValue ? At(at, baseY.Value) : G(at, -sink * scale);
            var go = LevelKit.PlaceOrBox(id, parent, p, size, yaw, scale, PlaceholderMat);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>栖柱（火狱石柱）：桩底埋 0.25 m，桩顶补一块平的落脚碰撞，桩顶放 <see cref="PerchPoint"/>。返回桩顶点</summary>
        static Vector3 PerchPillar(string name, Transform parent, Transform markers, Vector2 at, float yaw)
        {
            float baseY = G(at).y - ColumnSink;
            var go = Put(ColumnId, parent, at, yaw, 1, 0, baseY);
            if (go) go.name = $"{(IsPlaceholder(go) ? go.name : ColumnId)} ({name})";
            float top = baseY + ColumnH;
            var cap = new GameObject($"Perch Cap · {name}") { isStatic = true };
            cap.transform.SetParent(parent, false);
            cap.transform.position = new Vector3(at.x, top - 0.15f, at.y);
            cap.AddComponent<BoxCollider>().size = new Vector3(1.5f, 0.3f, 1.5f);
            var m = new GameObject($"{PerchPoint.MarkerPrefix}_{name}");
            m.transform.SetParent(markers, false);
            m.transform.position = new Vector3(at.x, top + 0.02f, at.y);
            m.AddComponent<PerchPoint>().radius = 0.7f;
            return new Vector3(at.x, top, at.y);
        }

        /// <summary>远景大火山：火口烟柱（放大的烽燧烟）+ 火口熔光；返回烟柱根</summary>
        static Vector3 BuildVolcano(Transform env)
        {
            var crater = At(VolcanoC, ts.GroundY(VolcanoC.x, VolcanoC.y) + 2f);
            var smoke = LevelKit.Smoke(Dir, env, crater, new Color(0.22f, 0.17f, 0.16f, 0.85f));
            if (smoke)
            {
                smoke.name = "Volcano Smoke";
                smoke.transform.localScale = Vector3.one * 7f;
                var main = smoke.main;
                main.scalingMode = ParticleSystemScalingMode.Local;
            }
            LevelKit.Ch3PointLight(env, "Volcano Crater Glow", crater + Vector3.up * 4f, new LevelKit.Ch3PointGlow(60f, 6f));
            return crater + Vector3.up * 30f;
        }

        /// <summary>四个据点、出生眺台、藏宝点的摆件；返回祝融像头部（视线用）</summary>
        static Vector3 BuildSites(Transform arch, Transform props, Transform markers)
        {
            var rng = new System.Random(3301);
            float Yaw() => (float)rng.NextDouble() * 360f;
            float Sc(float a, float b) => a + (b - a) * (float)rng.NextDouble();

            // ── 出生 · 灰坡眺台：两座火坛、锁魂碑 ──
            var spawnRoot = new GameObject("出生 · 灰坡眺台").transform;
            spawnRoot.SetParent(props, false);
            Put(AltarId, spawnRoot, Spawn + new Vector2(-4, 5), 45, AltarBig);
            Put(AltarId, spawnRoot, Spawn + new Vector2(5, -4), 45, AltarBig);
            Put(ObeliskId, spawnRoot, Overlook.c + new Vector2(-7, 6), 20, 1.3f);
            LevelKit.Ch3PointLight(spawnRoot, "Spawn Altar Glow", G(Spawn + new Vector2(0.5f, 0.5f), 2.5f), LevelKit.InfernoGlows.Altar);
            // 路遇 a 的坡脚渣堆
            foreach (var a in Anchors.Where(a => a.site == 11 && a.mode == SpawnMode.Ember))
                Put(rng.Next(2) == 0 ? CauldronId : IngotId, spawnRoot, a.at + new Vector2(1.8f, 1.8f), Yaw(), 0.9f);

            // ── ① 玄武柱林 ──
            var s1 = new GameObject("① 玄武柱林").transform;
            s1.SetParent(arch, false);
            foreach (var c in new[]
                     {
                         new Vector2(-62, -5), new Vector2(-75, -10), new Vector2(-92, -16), new Vector2(-55, -24), new Vector2(-66, -38), new Vector2(-50, -36),
                         new Vector2(-78, -46), new Vector2(-58, 6), new Vector2(-82, 6), new Vector2(-97, -28), new Vector2(-69, -21), new Vector2(-45, -8),
                         new Vector2(-94, 2),
                     })
                Put(ColumnsId, s1, c, Yaw(), Sc(0.95f, 1.25f), 0.4f);
            Put(RibId, s1, ColumnTable.c + new Vector2(-10, -3), 95, 0.9f, 1f);
            Put(AltarId, s1, ColumnTable.c + new Vector2(-3, 1.5f), 0, AltarBig, 0, ColumnTable.TopY - 0.1f);
            Put(AltarId, s1, ColumnTable.c + new Vector2(3, -2), 0, AltarBig, 0, ColumnTable.TopY - 0.1f);
            Put(BarricadeId, s1, new Vector2(-60, -14), 70);
            Put(BarricadeId, s1, new Vector2(-79, -14), -20);
            Put(CoverWallId, s1, new Vector2(-68, -37.5f), 10);
            Put(CoverWallId, s1, new Vector2(-78, 0), 80);

            // ── ② 火口丘 ──
            var s2 = new GameObject("② 火口丘").transform;
            s2.SetParent(arch, false);
            for (int i = 0; i < 8; i++)
            {
                float a = (i * 45f + 22.5f) * Mathf.Deg2Rad;
                var p = ConeC + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * (ConeBase - 4f + (i % 2) * 3f);
                Put(ColumnsId, s2, p, Yaw(), Sc(0.9f, 1.15f), 0.4f);
            }
            foreach (var (p, yaw) in new[] { (new Vector2(78, -53), 0f), (new Vector2(88, -55.5f), 40f), (new Vector2(75, -70), 160f), (new Vector2(89, -69), 210f) })
            {
                var dir = p - ConeC;
                Put(CoverWallId, s2, p, YawZ(dir), 1f, 0.3f);
            }
            Put(BarricadeId, s2, new Vector2(64, -64), 90);
            Put(BarricadeId, s2, new Vector2(100, -60), 90);
            Put(CauldronId, s2, new Vector2(70, -80), Yaw());
            Put(IngotId, s2, new Vector2(96, -42), Yaw());
            Put(CauldronId, s2, new Vector2(60, -48), Yaw());
            Put(RibId, s2, ConeC + new Vector2(-3, 30), 200, 0.7f, 1.5f);

            // ── ③ 祝融残殿 ──
            var s3 = new GameObject("③ 祝融残殿").transform;
            s3.SetParent(arch, false);
            float deck = Temple.TopY;
            Put(StatueId, s3, StatueAt, 180, StatueScale, 0, deck - StatueSink);
            Put(RampartId, s3, new Vector2(57.5f, 92), 90, 0.9f, 0, deck - 1.2f);
            Put(RampartId, s3, new Vector2(82.5f, 92), -90, 0.9f, 0, deck - 1.2f);
            Put(RampartId, s3, new Vector2(60, 79.2f), 180, 0.75f, 0, deck - 1.5f);
            Put(RampartId, s3, new Vector2(80, 79.2f), 180, 0.75f, 0, deck - 1.5f);
            foreach (var p in new[] { new Vector2(63, 84), new Vector2(77, 84), new Vector2(64, 90.5f), new Vector2(76, 90.5f) })
                Put(AltarId, s3, p, 0, AltarBig, 0, deck - 0.1f);
            Put(GatewayId, s3, new Vector2(70, 61), 180, 1f, 0.2f);
            Put(ObeliskId, s3, new Vector2(65.5f, 80.5f), 0, 1.1f, 0, deck - 0.1f);
            Put(ObeliskId, s3, new Vector2(74.5f, 80.5f), 0, 1.1f, 0, deck - 0.1f);
            foreach (var p in new[] { new Vector2(47, 72), new Vector2(93, 72), new Vector2(45, 98), new Vector2(95, 96), new Vector2(58, 62), new Vector2(84, 60) })
                Put(ColumnsId, s3, p, Yaw(), Sc(0.85f, 1.05f), 0.4f);
            LevelKit.Ch3PointLight(s3, "Temple Altar Glow", At(new Vector2(70, 87), deck + 3f), LevelKit.InfernoGlows.Altar);

            // ── ④ 熔渠铸坊 ──
            var s4 = new GameObject("④ 熔渠铸坊").transform;
            s4.SetParent(arch, false);
            Put(TowerId, s4, OnChan(-6, 12), ChanFaceNE, 1f, 0.3f);
            Put(ShedId, s4, OnChan(2, 17), ChanFaceNE, 1.1f, 0.2f);
            Put(ShedId, s4, OnChan(22, 17), ChanFaceNE, 1.1f, 0.2f);
            Put(BedId, s4, OnChan(8, 11), ChanAlongX, 1.2f, 0.1f);
            Put(BedId, s4, OnChan(15, 11), ChanAlongX, 1.2f, 0.1f);
            for (int i = 0; i < 4; i++) Put(MouldId, s4, OnChan(20 + i * 2.6f, 11), ChanAlongX, 1.2f, 0.1f);
            Put(CraneId, s4, OnChan(18, 0), ChanAcrossX, 1f, 0.1f);
            Put(BellowsId, s4, OnChan(12, -13), YawZ(ChanN), 1.2f, 0.2f);
            Put(StallId, s4, OnChan(4, -10), YawZ(ChanN), 1.1f);
            Put(StallId, s4, OnChan(28, -9.5f), YawZ(ChanN), 1.1f);
            Put(IngotId, s4, OnChan(-1, -12), Yaw());
            Put(CrucibleId, s4, OnChan(20, -12), Yaw(), 1.4f);
            Put(CoverWallId, s4, OnChan(-3, -15), ChanAlongX);
            Put(CoverWallId, s4, OnChan(37, -12), ChanAlongX);
            Put(BarricadeId, s4, OnChan(-3, 8), ChanAlongX);
            Put(BarricadeId, s4, OnChan(31, 7), ChanAlongX);
            Put(CoverWallId, s4, OnChan(11, 16.5f), ChanAlongX);
            Put(CoverWallId, s4, OnChan(8, -18.5f), ChanAlongX);
            Put(CoverWallId, s4, OnChan(19, -18.5f), ChanAlongX);
            Put(ColumnsId, s4, OnChan(17, 26), Yaw(), 0.9f, 0.4f);
            Put(ColumnsId, s4, OnChan(-3, 25), Yaw(), 0.9f, 0.4f);
            Put(ColumnsId, s4, OnChan(9, 30), Yaw(), 0.85f, 0.4f);
            Put(ColumnsId, s4, OnChan(31, -23), Yaw(), 0.9f, 0.4f);
            foreach (var a in Anchors.Where(a => a.site == 4 && a.mode == SpawnMode.Ember))
                Put(rng.Next(2) == 0 ? CauldronId : IngotId, s4, a.at + new Vector2(1.8f, -1.8f), Yaw(), 0.9f);
            LevelKit.Ch3PointLight(s4, "Forge Furnace Glow", G(OnChan(-6, 9), 3f), LevelKit.InfernoGlows.Furnace);

            // ── 各据点 / 路遇的渣堆（余烬起身）──
            foreach (var a in Anchors.Where(a => (a.site == 1 || a.site == 3) && a.mode == SpawnMode.Ember))
                Put(rng.Next(2) == 0 ? CauldronId : IngotId, a.site == 1 ? s1 : s3, a.at + new Vector2(1.8f, 1.8f), Yaw(), 0.9f);

            // ── 栖柱（毕方埋伏 / 飞临）──
            var perched = new HashSet<Vector2>();
            foreach (var a in Anchors)
                if (!float.IsNaN(a.lift) && perched.Add(a.at))
                    PerchPillar(a.name, a.site <= 4 ? (a.site == 1 ? s1 : a.site == 2 ? s2 : a.site == 3 ? s3 : s4) : props, markers, a.at, Yaw());

            // ── 驻守点 e：远东堤南头的两座火坛 ──
            Put(AltarId, props, RoadE + new Vector2(-4.5f, 4f), 180, AltarBig);
            Put(AltarId, props, RoadE + new Vector2(4.5f, 4f), 180, AltarBig);
            LevelKit.Ch3PointLight(props, "Garrison Altar Glow", G(RoadE + new Vector2(0, 4), 2.5f), LevelKit.InfernoGlows.Altar);
            // ── 入场点：柱林北的渣堆（余烬起身）──
            for (int k = 0; k < 3; k++) Put(k == 1 ? IngotId : CauldronId, props, EntryEmber + new Vector2(k * 3f - 3f, (k % 2) * 2f), Yaw(), 0.9f);

            // ── ⑤ 烬穴（可选守军）：炮仗窝的掩体 ──
            var s5 = new GameObject("⑤ 烬穴").transform;
            s5.SetParent(props, false);
            Put(RibId, s5, CacheB + new Vector2(-8, 4), 70, 0.8f, 1f);
            Put(CoverWallId, s5, GuardSite + new Vector2(-6, 8), 20);
            Put(ColumnsId, s5, GuardSite + new Vector2(8, 0), Yaw(), 0.9f, 0.4f);

            var deckTop = At(StatueAt, deck - StatueSink + DesignSize[StatueId].y * StatueScale * 0.86f);
            return deckTop;
        }

        /// <summary>堤的立面：每道大堤在熔岩里的一段两侧贴玄武岩堤道段（堤面本身是地形）；断堤端头摆在 D4 两端外的熔岩里当远景</summary>
        static void BuildDikeFacades(Transform arch)
        {
            var root = new GameObject("玄武岩堤立面").transform;
            root.SetParent(arch, false);
            int n = 0;
            const float step = 10.5f, scaleX = 1.25f;
            foreach (var d in new[] { D1, D2, D3, D4, D5, D6 })
            {
                float len = d.path.length;
                for (float sd = step * 0.5f; sd < len; sd += step)
                {
                    float t = sd / len;
                    var c = d.path.At(t);
                    var c2 = d.path.At(Mathf.Min(1, t + 0.02f));
                    var dir = (c2 - c).normalized;
                    var side = new Vector2(dir.y, -dir.x);
                    foreach (int sgn in new[] { -1, 1 })
                    {
                        var p = c + side * sgn * (d.half + 0.4f);
                        if (ts.GroundY(p.x + side.x * sgn * 2.5f, p.y + side.y * sgn * 2.5f) > 0.6f) continue; // 只贴熔岩那一段
                        var go = Put(SegmentId, root, p, YawZ(side * sgn), 1f, 0, BedY - 0.5f);
                        if (!go) continue;
                        if (!IsPlaceholder(go)) go.transform.localScale = new Vector3(scaleX, 1f, 1f);
                        n++;
                    }
                }
            }
            Debug.Log($"[Level] 3-A 堤道立面 {n} 段");
        }

        static void BuildScatter(Transform env, ShowcaseTheme theme)
        {
            var keep = new List<(Vector2 c, float r)>
            {
                (Spawn, 12), (S1, 26), (S2, 28), (S3, 26), (S4, 24), (GuardSite, 12), (CacheA, 6), (CacheB, 6), (ExitAt, 10), (RevExitAt, 6),
            };
            float Keep(Vector2 p)
            {
                foreach (var (c, r) in keep)
                    if (Vector2.Distance(p, c) < r) return 0.25f;
                return 1;
            }
            var details = LevelKit.ScatterPresets.Details(theme.key);
            foreach (var r in details)
            {
                var w = r.where;
                r.where = pt => (w?.Invoke(pt) ?? 1) * Keep(pt.p);
            }
            var counts = LevelKit.ScatterDetails(ts, details, RouteDist, 1f, 160f);

            var boulders = LevelKit.ScatterPresets.Boulders(theme.key);
            var bw = boulders.where;
            var avoid = new List<(Vector2 c, float r)>(keep);
            foreach (var a in Anchors) avoid.Add((a.at, 5));
            boulders.where = pt =>
            {
                float ins = Inside(pt.p);
                if (ins < 1 || ins > 12) return 0;
                if (ts.GroundY(pt.p.x, pt.p.y) < 1.4f) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(pt.p, c) < r) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            var big = LevelKit.ScatterProps(ts, env, boulders, new Rect(-140, -124, 282, 246), 11f, RouteDist);
            Debug.Log($"[Level] 3-A 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}；崖脚玄武岩块 {big.Count}");
        }

        /// <summary>离最近一道堤 / 主线路段的距离（米，散布避让）</summary>
        static float RouteDist(Vector2 p)
        {
            float d = float.MaxValue;
            foreach (var k in Dikes) d = Mathf.Min(d, k.path.Nearest(p, 40).dist - k.half);
            var r = RouteXZ();
            for (int i = 0; i + 1 < r.Length; i++)
            {
                var a = r[i].at;
                var b = r[i + 1].at;
                var ab = b - a;
                float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / Mathf.Max(1e-4f, ab.sqrMagnitude));
                d = Mathf.Min(d, Vector2.Distance(p, a + ab * t) - 3f);
            }
            return Mathf.Max(0, d);
        }

        /// <summary>标记：场地中心、站位（SpawnAnchor，含出场方式）、熔岩探针</summary>
        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector3 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = p;
            }
            Mk("Site_Spawn", G(Spawn));
            Mk("Site_1_ColumnForest", G(S1));
            Mk("Site_2_CinderCone", G(S2));
            Mk("Site_3_ZhurongHall", G(S3));
            Mk("Site_4_ForgeChannel", G(S4));
            Mk("Site_5_EmberDen", G(GuardSite));
            Mk("Site_Exit", G(ExitAt));
            Mk("Lava_Probe", At(new Vector2(0, -14), LavaY));
            foreach (var a in Anchors)
            {
                var at = float.IsNaN(a.lift) ? G(a.at) : G(a.at, a.lift);
                var sa = SpawnAnchor.Create(root, a.name, at, a.role, 0, a.elevated, a.mode == SpawnMode.Ambush ? 1.2f : 2f).Via(a.mode);
                sa.LookAt(G(SiteCenter(a.site)));
                switch (a.mode)
                {
                    case SpawnMode.Drop:
                        sa.DropFrom(float.IsNaN(a.auxY) ? G(a.aux) : At(a.aux, a.auxY));
                        break;
                    case SpawnMode.Gate:
                        sa.Gate(G(a.aux));
                        break;
                }
            }
        }

        // ───────────── 怪物入场点（游荡怪群只从这里进场）─────────────

        /// <summary>
        /// 入场点（<see cref="MonsterEntry"/>，docs/level-design/maps/3-A.md §4）：熔岩河 / 铸坊熔渠的岸（熔岩爬出）、柱林北的渣堆（余烬起身）、
        /// 火口丘锥脚（现身）、柱丛顶（跃下）、北岸开阔处（火鸦飞临，只给飞行敌人）。都离两种走法的出生点 ≥ 30 m
        /// </summary>
        static void BuildEntries(Transform markers)
        {
            var root = new GameObject("Monster Entries").transform;
            root.SetParent(markers, false);
            void Lava(string label, List<Vector2> river, float half, Vector2 near, Vector2 toward)
            {
                var at = Bank(river, near, half, 4.5f);
                LevelKit.Entry(root, label, G(at), G(toward), SpawnMode.LavaCrawl, null, 4f);
            }
            Lava("主河西岸 · 熔岩爬出", RiverMain, MainHalf, new Vector2(-8, -4), new Vector2(-40, -10));
            Lava("主河东岸 · 熔岩爬出", RiverMain, MainHalf, new Vector2(26, -68), new Vector2(52, -70));
            Lava("支流北岸 · 熔岩爬出", RiverEast, EastHalf, new Vector2(56, 36), new Vector2(60, 62));
            Lava("铸坊熔渠 · 熔岩爬出", ForgeChannel, ChannelHalf, new Vector2(-96, 92), new Vector2(-80, 62));
            LevelKit.Entry(root, "柱林北 · 余烬", G(EntryEmber + new Vector2(0, -3)), G(new Vector2(-70, 4)), SpawnMode.Ember, null, 3.5f);
            LevelKit.Entry(root, "火口丘锥脚", G(ConeC + new Vector2(-20, -24)), G(new Vector2(40, -60)), SpawnMode.Appear, null, 4f);
            var columnTop = G(new Vector2(-97, -28), 5.4f);
            LevelKit.Entry(root, "柱丛顶 · 跃下", G(new Vector2(-97, -34.5f)), G(new Vector2(-70, -50)), SpawnMode.Drop, columnTop, 2.5f);
            LevelKit.Entry(root, "北岸 · 火鸦飞临", G(new Vector2(40, 104)), G(S3), SpawnMode.FlyIn, null, 6f, true);
        }

        // ───────────── 遭遇 ─────────────

        static EncounterSpec openingS1, finaleS1, openingS3, finaleS3;

        static LevelObjective BuildEncounters(Transform markers, LevelKit.Report rep)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = G(center);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.difficulty = 0;
                site.requires = Array.Empty<EncounterSite>();
                var list = new List<Transform>();
                foreach (var a in Anchors)
                    if (a.site == index)
                        list.Add(markers.Find(a.name));
                list.RemoveAll(t => !t);
                site.anchors = list.ToArray();
                return site;
            }

            // ① 玄武柱林：主走法开场（给武器）；逆行终局（两只精英，给保底精良武器）
            openingS1 = EncounterSpec.Of(
                    G04(bifang: 2, tantong: 4).Hint("毕方栖在柱顶——「毕」一声就换掩体，柱台上看得见三根栖柱"),
                    G02(huodou: 4, tantong: 2).After(1, 1.6f),
                    G05(mamian: 2, huodou: 2, tantong: 2).Hint("马面从柱台上跳下来——断它的视线、打锁芯").After(1, 1.8f))
                .Gather(0.6f).Distance(10, 32);
            finaleS1 = EncounterSpec.Of(
                    G04(bifang: 3, tantong: 4),
                    G02(huodou: 4, tantong: 2, eliteAffix: Swift).After(1, 1.6f),
                    G05(mamian: 2, huodou: 2, tantong: 2, eliteAffix: Frenzied).Hint("精英马面从柱台跃下——先速杀它，狂暴之后别拖").After(1, 2f))
                .Gather(0.6f).Distance(10, 32);
            // ③ 祝融残殿：主走法终局；逆行开场
            finaleS3 = EncounterSpec.Of(
                    G10(nuo: 1, huodou: 3, tantong: 3, eliteAffix: Shielded).Hint("精英傩巫在神像前跳傩——先破盾、打碎面具"),
                    G14(bifang: 2, fireCrow: 4).Hint("毕方和飞鸦从残柱上盘下来——横移打毕方的腿").After(1, 1.6f),
                    G12(Frenzied, firecracker: 2, fireCrow: 3).After(1, 2f))
                .Gather(0.6f).Distance(10, 34);
            openingS3 = EncounterSpec.Of(
                    G10(nuo: 1, huodou: 3, tantong: 3).Hint("傩巫在神像前跳傩——看光环颜色，先打碎面具"),
                    G14(bifang: 2, fireCrow: 3).After(1, 1.6f),
                    G05(mamian: 2, huodou: 2, tantong: 2).After(1, 1.8f))
                .Gather(0.6f).Distance(10, 34);

            var s1 = Site(1, "玄武柱林", S1, 21, 28, openingS1, "weapon", new Vector3(3, 0, 3));
            var s2 = Site(2, "火口丘", S2, 22, 30, EncounterSpec.Of(
                    G06(firecracker: 3, tantong: 4).Hint("炮仗傀儡扎堆埋在火口北缘——引信烧着时打火药仓"),
                    G08(ironOx: 1, mamian: 1, tantong: 3).After(1, 1.8f),
                    G07(fireCrow: 5, firecracker: 1).Hint("神火鸦群从锥脚的柱顶飞过来——火口里的熔泉喷发时别站在圈里").After(1, 1.8f))
                .Gather(0.6f).Distance(10, 34), "scroll", new Vector3(0, 0, -14));
            var s3 = Site(3, "祝融残殿", S3, 21, 28, finaleS3, "weapon:min=1", new Vector3(0, 0, -12));
            var s4 = Site(4, "熔渠铸坊", S4, 20, 26, EncounterSpec.Of(
                    G03(tuo: 1, mamian: 1, tantong: 3).Hint("火鼍潜在熔渠里——别背对熔渠站，引它上岸打脊背"),
                    G09(founder: 1, firecracker: 2, tantong: 3).After(1, 1.8f),
                    G02(huodou: 4, tantong: 2).After(1, 1.6f))
                .Gather(0.6f).Distance(9, 30), "upgrade", new Vector3(-3, 0, -4));
            var s5 = Site(5, "烬穴守军", GuardSite, 13, 18, EncounterSpec.Of(
                    G06(firecracker: 3, tantong: 3, eliteAffix: Volatile).Named("烬穴炮阵").Hint("守着烬穴遗藏的一窝炮仗——精英傀儡会自爆，拉开距离"),
                    G02(huodou: 3, tantong: 2).After(1, 1.6f))
                .Gather(0.4f).Distance(7, 24), "", Vector3.zero);
            s5.autoTrigger = false;
            s5.optional = true;

            var ra = Site(11, "灰坡 · 余烬", RoadA, 13, 16, EncounterSpec.Of(G01(tantong: 6, huodou: 1)).Gather(0.3f).Distance(7, 22), "", Vector3.zero).AsRoadside(13f, 16f);
            // 驻守点（堤头守卫）：第一波开局就站在堤头（埋伏），第二波从熔岩爬上岸
            WaveSpec Post(string label, string hint, string ranged, int rangedN, int huodou, int tantong) => EncounterSpec.Wave(label,
                    EncounterSpec.E(ranged, rangedN).As(ranged == Firecracker ? StationRole.Artillery : StationRole.Ranged).Via(SpawnMode.Ambush),
                    EncounterSpec.E(Huodou, huodou).As(StationRole.Flank).Via(SpawnMode.Ambush),
                    EncounterSpec.E(Tantong, tantong).Via(SpawnMode.Ambush))
                .Hint(hint);
            var rb = Site(12, "南堤头守卫", RoadB, 14, 18, EncounterSpec.Of(
                    Post("南堤头守卫", "堤头站着一队守卫——先打马面的锁芯，别在堤上被两头夹", Mamian, 1, 2, 3),
                    G11(tantong: 4, bifang: 1).After(1, 1.2f))
                .Gather(0.3f).Distance(6, 24), "", Vector3.zero).AsRoadside(14f, 18f);
            var rc = Site(13, "北堤头守卫", RoadC, 14, 18, EncounterSpec.Of(
                    Post("北堤头守卫", "两只炮仗傀儡守着北堤头——打火药仓，一炸一片", Firecracker, 2, 1, 4),
                    G11(tantong: 5, bifang: 0).After(1, 1.2f))
                .Gather(0.3f).Distance(6, 24), "", Vector3.zero).AsRoadside(14f, 18f);
            var rd = Site(14, "东堤头守卫", RoadD, 14, 18, EncounterSpec.Of(
                    Post("东堤头守卫", "东堤头的守卫——马面会甩勾魂索，别站在它和熔岩之间", Mamian, 1, 2, 3),
                    G11(tantong: 4, bifang: 1).After(1, 1.2f))
                .Gather(0.3f).Distance(6, 24), "", Vector3.zero).AsRoadside(14f, 18f);
            var re = Site(15, "火坛前守卫", RoadE, 14, 18, EncounterSpec.Of(
                    Post("火坛前守卫", "两座火坛前站着守卫——火鼍还潜在支流里，离岸远一点", Mamian, 1, 1, 4),
                    G03(tuo: 1, mamian: 0, tantong: 3).Named("岸边伏鼍").After(1, 1.2f))
                .Gather(0.3f).Distance(6, 24), "", Vector3.zero).AsRoadside(14f, 18f);

            rep.Section("编组（InfernoSquads 自查：每波 ≤ 3 种、远程 ≤ 3）");
            int bad = 0;
            foreach (var s in new[] { s1, s2, s3, s4, s5, ra, rb, rc, rd, re })
            {
                bad += InfernoSquads.Check(s.spec, s.title, rep.Fail);
                rep.Line($"· {s.title}{(s.roadside ? "（路遇）" : s.optional ? "（可选）" : "")}：{s.spec.Total} 只 — " +
                         string.Join("；", s.spec.waves.Select(InfernoSquads.Describe)));
            }
            bad += InfernoSquads.Check(finaleS1, "玄武柱林（逆行终局）", rep.Fail);
            bad += InfernoSquads.Check(openingS3, "祝融残殿（逆行开场）", rep.Fail);
            int required = s1.spec.Total + s2.spec.Total + s3.spec.Total + s4.spec.Total;
            int elites = new[] { s1, s2, s3, s4 }.Sum(s => s.spec.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count)));
            int roadside = ra.spec.Total + rb.spec.Total + rc.spec.Total + rd.spec.Total + re.spec.Total;
            string sum = $"必清 4 处 {required} 只、精英 {elites}；路遇（余烬 1 + 驻守 4）{roadside} 只；可选 {s5.spec.Total} 只；逆行：柱林 {finaleS1.Total} / 残殿 {openingS3.Total}";
            if (bad == 0 && required >= 64 && elites == 2) rep.Line($"✓ {sum}（怪要多：3-1 必清约 46）");
            else rep.Fail($"{sum}（要求每波 ≤ 3 种 / 远程 ≤ 3、必清 ≥ 64、精英 2）");
            int posted = new[] { rb, rc, rd, re }.Sum(s => s.spec.waves[0].entries.Where(e => e.via == SpawnMode.Ambush).Sum(e => e.count));
            rep.Line($"驻守点 4 处（堤头 / 火坛前，开局就站在场上）首波 {posted} 只");

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "穿越赤焰灰原";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>间歇熔泉：火口丘火口里一口、锥脚两口，只在 ② 交战时喷</summary>
        static void BuildGeysers(Transform world, LevelObjective objective)
        {
            var site = objective.required[1];
            int i = 0;
            foreach (var (p, period, phase) in new[] { (ConeC, 7f, 0f), (ConeC + new Vector2(-17, -12), 9f, 3f), (ConeC + new Vector2(16, 13), 9f, 6f) })
                LevelKit.PlaceLavaGeyser(Dir, $"Geyser {++i}", world, G(p), new LevelKit.GeyserSpec
                {
                    period = period, phase = phase, startActive = false, activeSite = site, seed = 40 + i,
                });
        }

        /// <summary>藏宝（CachePOI）：A 灰下遗宝（东南角，无守军；秘卷）；B 烬穴遗藏（西缘，调查惊动 ⑤ 守军；武器保底精良）</summary>
        static void BuildCaches(Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            void Cache(string title, Vector2 at2, Vector2 face, string reward, EncounterSite guardSite, string modelId, float modelScale, float discover)
            {
                var at = G(at2);
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                poi.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(face.x, 0, face.y)));
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = discover;
                var mAt = at2 - face.normalized * 1.6f;
                var model = Put(modelId, poi.transform, mAt, YawZ(face), modelScale, 0, at.y - 0.05f);
                if (model) model.name = "Model";
            }
            Cache("灰下遗宝", CacheA, new Vector2(-1, 1), "scroll", null, HoardId, 0.9f, 12);
            Cache("烬穴遗藏", CacheB, new Vector2(1, 0), "weapon:min=1", guard, CrucibleId, 1.8f, 12);
        }

        /// <summary>主走法的出口：东北角出口台上的祭坛 + 传送门</summary>
        static ExitPortal BuildExit(Transform markers, Transform arch, LevelObjective objective)
        {
            var shrine = Put(ShrineId, arch, ExitAt, ExitYaw, 1, 0.1f);
            if (shrine && !IsPlaceholder(shrine)) shrine.name = "Exit Shrine";
            var portal = LevelKit.PortalAt("Exit Portal", markers, (x, z) => ts.OnGround(x, z), shrine, objective, 1.4f);
            LevelKit.Ch3PointLight(arch, "Exit Shrine Glow", G(ExitAt + ExitFace * 2f, 3f), LevelKit.InfernoGlows.Gate);
            return portal;
        }

        /// <summary>
        /// 布局变体（docs/level-design/run-variety.md §2）：main = 西南眺台 → 东北角祭坛；reverse = 东北角祭坛前 → 西南眺台上的新祭坛，
        /// ① / ③ 的编制和奖励对调（场地本来就先后不限）。NavMesh 烘焙之后调：逆行的祭坛不进导航网格，运行时由 NavMeshObstacle 挖洞
        /// </summary>
        static void BuildLayout(Transform arch, Transform markers, PlayerSpawn mainSpawn, ExitPortal mainExit, LevelObjective objective)
        {
            var s1 = objective.required[0];
            var s3 = objective.required[2];
            var revSpawn = LevelKit.SpawnMarker("PlayerSpawn · 逆行", markers, G(RevSpawn, 0.05f), G(S3));
            var shrine = Put(ShrineId, arch, RevExitAt, RevExitYaw, 1, 0.1f, Overlook.TopY - 0.1f);
            if (shrine && !IsPlaceholder(shrine)) shrine.name = "Exit · 逆行 Shrine";
            LevelKit.CarveObstacle(shrine);
            var portal = LevelKit.PortalAt("Exit · 逆行 Portal", markers, (x, z) => ts.OnGround(x, z), shrine, objective, 1.4f);
            LevelKit.Layout(markers,
                new LevelLayout.Variant { id = "main", title = "自灰坡入", spawn = mainSpawn, exit = mainExit },
                new LevelLayout.Variant
                {
                    id = "reverse", title = "自火山口入", spawn = revSpawn, exit = portal,
                    only = new[] { shrine },
                    sites = new[] { LevelKit.Override(s3, openingS3, s1.reward), LevelKit.Override(s1, finaleS1, s3.reward) },
                });
        }

        // ───────────── 本关的检查 ─────────────

        /// <summary>入场点离逆行的出生点也要 ≥ 30 m（CheckEntries 只量场景里第一个在场的出生点 = 主走法）</summary>
        static void CheckEntryDistances(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            var rev = G(RevSpawn);
            int near = 0;
            foreach (var root in scene.GetRootGameObjects())
                foreach (var e in root.GetComponentsInChildren<MonsterEntry>(true))
                {
                    var p = e.transform.position;
                    float d = Vector2.Distance(new Vector2(p.x, p.z), new Vector2(rev.x, rev.z));
                    if (d < 30f)
                    {
                        near++;
                        rep.Fail($"入场点「{e.label}」离逆行出生点只有 {d:F0} m（应 ≥ 30 m）");
                    }
                }
            if (near == 0) rep.Line("✓ 入场点离逆行出生点都 ≥ 30 m");
        }

        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, ExitPortal portal)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 2) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 2：主走法 + 逆行）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            void None<T>(string what) where T : Component
            {
                int c = Count<T>();
                if (c > 0) rep.Fail($"场景里有 {c} 个 {what}（应在 Core 场景）");
            }
            None<PlayerVitals>("玩家");
            None<Camera>("相机");
            None<AudioListener>("音频监听");
            None<Hud>("HUD");
            None<GameSession>("会话");
            None<EnemyCatalog>("敌人目录（改由 GameDatabase 提供）");
            if (spawns == 2 && boots == 1) rep.Line("✓ PlayerSpawn ×2（主走法 / 逆行各一）、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            int sites = Count<EncounterSite>(), lavas = Count<LavaVolume>(), caches = Count<CachePOI>(), portals = Count<ExitPortal>(), perches = Count<PerchPoint>(),
                layouts = Count<LevelLayout>(), geysers = Count<LavaGeyser>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1 + 路遇 5），熔岩 {lavas} 片，藏宝 {caches}，出口 {portals}，栖落点 {perches}，熔泉 {geysers}，布局表 {layouts}");
            if (sites != 10) rep.Fail($"遭遇场地有 {sites} 个（应为 10）");
            if (lavas != 1) rep.Fail($"熔岩有 {lavas} 片（应为 1）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2）");
            if (geysers != 3) rep.Fail($"熔泉有 {geysers} 口（应为 3）");
            if (layouts != 1) rep.Fail($"布局表有 {layouts} 个（应为 1）");
            if (portals != 2 || !portal || !portal.objective) rep.Fail($"出口传送门 {portals} 个（应 2：主走法 + 逆行，且接上 LevelObjective）");
            else rep.Line("✓ 出口传送门：东北角祭坛（主走法）+ 西南眺台祭坛（逆行）");
            if (perches < 10) rep.Fail($"栖落点只有 {perches} 处（应 ≥ 10）");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>主线路点（主走法；L5 主线连通按这串量，引导灯沿它摆）</summary>
        static (string name, Vector2 at)[] RouteXZ() => new[]
        {
            ("出生 · 灰坡眺台", Spawn), ("眺台坡脚", new Vector2(-78, -94)), ("路遇 a", RoadA + new Vector2(8, 4)),
            ("① 柱林南", new Vector2(-62, -40)), ("① 柱台", ColumnTable.c), ("① 柱林北", new Vector2(-70, 4)),
            ("西岸北段", new Vector2(-62, 40)), ("④ 西南岸", OnChan(12, 13)), ("④ 西堤", OnChan(3, 0)), ("④ 东北岸", OnChan(14, -9)),
            ("北堤西头", D2.path.At(0)), ("北堤", D2.path.At(0.5f)), ("北堤东头", D2.path.At(1)),
            ("③ 殿台坡脚", new Vector2(70, 64)), ("③ 殿台", Temple.c), ("③ 东侧", new Vector2(94, 78)),
            ("东堤北头", D3.path.At(1)), ("东堤", D3.path.At(0.5f)), ("东堤南头", D3.path.At(0)),
            ("② 火口丘北脚", new Vector2(84, -34)), ("② 火口丘缘", ConeC + new Vector2(0, ConeRimR)), ("② 火口", ConeC),
            ("② 东脚", new Vector2(106, -52)), ("远东堤南头", D5.path.At(0)), ("远东堤", D5.path.At(0.5f)), ("远东堤北头", D5.path.At(1)),
            ("出口", ExitAt + ExitFace * 3.5f),
        };

        /// <summary>
        /// 青金引导灯（只放在主路上、每 30 m 一盏）：沿主线路点之间的直线每 30 m 一个灯位，站在路右侧 2.8 m；
        /// 落在熔岩 / 河岸上、场地里、出生点和出口旁边的跳过
        /// </summary>
        static void BuildGuideLamps(Transform parent)
        {
            var root = new GameObject("引导灯").transform;
            root.SetParent(parent, false);
            var r = RouteXZ();
            var spots = new List<(Vector3 at, float yaw)>();
            var skip = new List<(Vector2 c, float r)> { (Spawn, 12), (S1, 22), (S2, 24), (S3, 22), (S4, 20), (ExitAt, 10) };
            float carry = 15f;
            for (int i = 0; i + 1 < r.Length; i++)
            {
                var a = r[i].at;
                var b = r[i + 1].at;
                float len = Vector2.Distance(a, b);
                if (len < 1e-3f) continue;
                var dir = (b - a) / len;
                var right = new Vector2(dir.y, -dir.x);
                float s = carry;
                for (; s < len; s += 30f)
                {
                    var p = a + dir * s + right * 2.8f;
                    if (ts.GroundY(p.x, p.y) < 1.6f) continue;
                    if (skip.Any(k => Vector2.Distance(p, k.c) < k.r)) continue;
                    spots.Add((G(p), YawZ(dir)));
                }
                carry = s - len;
            }
            LevelKit.GuideLamps(Dir, root, spots);
            Debug.Log($"[Level] 3-A 引导灯 {spots.Count} 盏");
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线（含逆行的出生 → 出口）、六道堤与坡道的坡度、地标视线、场地尺寸 / 掩体 / 层数、
        /// 主线节拍（出生 → 首战 ≤ 60 m、相邻两拍空白 ≤ 110 m）。可玩区遮罩与软边界同一个
        /// </summary>
        static LevelSpec Spec(Vector3 statueHead, Vector3 smokeAt)
        {
            SiteSpec Site(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat,
                    minCoverReach = combat && cover > 0 ? 0.8f : -1f, maxLavaShare = combat && cover > 0 ? 0.35f : -1f };
            var shrineTop = G(ExitAt, DesignSize[ShrineId].y * 0.8f);
            var spec = new LevelSpec
            {
                id = "3-A", title = "赤焰灰原", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                playable = Playable, escapeMargin = Bounds.EscapeMargin, placeholders = PlaceholderPolicy.Fail,
                mapArea = new Rect(-146, -130, 294, 258),
                sites =
                {
                    Site("出生 · 灰坡眺台（缓冲）", Spawn, 18, combat: false),
                    Site("① 玄武柱林", S1, 48, cover: 6, layers: 3, overlook: true),
                    Site("② 火口丘", S2, 50, cover: 6, layers: 3, overlook: true),
                    Site("③ 祝融残殿", S3, 46, cover: 6, layers: 3, overlook: true),
                    Site("④ 熔渠铸坊", S4, 44, cover: 6, layers: 2),
                },
            }
                .Sight("出生 → 大火山烟柱", G(Spawn, 1.62f), smokeAt, 12)
                .Sight("① 柱林北口 → 祝融像", G(new Vector2(-66, 8), 1.62f), statueHead, 8, StatueId)
                .Sight("北堤 → 祝融像", G(D2.path.At(0.2f), 1.62f), statueHead, 6, StatueId)
                .Sight("③ 殿台东南角 → 出口祭坛", At(new Vector2(78, 82), Temple.TopY + 1.62f), shrineTop, 6, ShrineId)
                .Sight("② 火口丘缘 → 大火山", G(ConeC + new Vector2(0, ConeRimR), 1.62f), smokeAt, 12);
            foreach (var (rname, xz) in RouteXZ()) spec.Route(rname, G(xz));
            spec.Route("逆行 · 出生", G(RevSpawn)).Route("逆行 · ③ 殿台坡脚", G(new Vector2(70, 64))).Route("逆行 · 汇流堤", G(D6.path.At(0.5f)))
                .Route("逆行 · ① 柱林", G(new Vector2(-62, -40))).Route("逆行 · 眺台坡脚", G(new Vector2(-78, -94)))
                .Route("逆行 · 眺台祭坛前", G(RevExitAt + new Vector2(Mathf.Sin(RevExitYaw * Mathf.Deg2Rad), Mathf.Cos(RevExitYaw * Mathf.Deg2Rad)) * 4f));
            spec.Route("藏宝 A", G(CacheA)).Route("远南堤", G(D4.path.At(0.5f))).Route("藏宝 B", G(CacheB + new Vector2(2, 0)));
            spec.Beat("出生 · 眺台", G(Spawn), BeatKind.Reveal, 9)
                .Beat("路遇 a · 灰坡余烬", G(RoadA), BeatKind.Roadside, 13)
                .Beat("① 玄武柱林", G(S1), BeatKind.Fight, 21)
                .Beat("藏宝 B 岔口", G(new Vector2(-96, 22)), BeatKind.Cache, 8)
                .Beat("④ 熔渠铸坊", G(S4), BeatKind.Fight, 20)
                .Beat("路遇 c · 北堤", G(RoadC), BeatKind.Roadside, 12)
                .Beat("③ 祝融残殿", G(S3), BeatKind.Fight, 21)
                .Beat("路遇 d · 东堤", G(RoadD), BeatKind.Roadside, 12)
                .Beat("② 火口丘", G(S2), BeatKind.Fight, 22)
                .Beat("路遇 e · 远东堤", G(RoadE), BeatKind.Roadside, 12)
                .Beat("出口祭坛", G(ExitAt), BeatKind.Exit);
            foreach (var d in Dikes)
                spec.slopePaths.Add(new SlopePath { name = $"{d.id} {d.label}", points = d.path.points, maxSlope = 16f });
            foreach (var tr in Terraces)
                foreach (var (foot, top, _) in tr.ramps)
                    spec.slopePaths.Add(new SlopePath { name = $"{tr.name}坡道", points = new[] { foot, top } });
            return spec;
        }
    }
}
