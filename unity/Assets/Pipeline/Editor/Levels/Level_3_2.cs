using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using static Spiritfire.Art.Editor.Levels.Landform;
using static Spiritfire.Game.InfernoSquads;
using Object = UnityEngine.Object;
using SG = Spiritfire.Game;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-2 铸神井 v2（docs/level-design/maps/3-2.md；上位设计 docs/level-design/ch3-v2.md 第 5.2 节）：
    /// 祝融铸神兵的竖井，四层同心环台——井口栈台 T0 +32（出生，正南）、上层工坊环 T1 +22、中层风箱环 T2 +11、井底 T3 0（熔岩井面 −2.5）；
    /// 井心吊着悬炉锻台（+17，26 × 26 m 甲板，走得上去打），出口在井底北壁的铸门：一路往下。
    /// 关卡坐标 = 世界 XZ，井心在原点，井底 y = 0；方位 θ 从 +X（正东）逆时针（从上往下看）计，<see cref="P"/> 换成世界坐标。
    ///
    ///   出生 · 井口栈台 θ −90（+32）→ 东旋坡（凿进井壁，+32 → +22）→ ① 炮工坊窟 θ −10（T1 东，窟凿到 r 84，炮台 +25.5）
    ///   → T1 东北 → 北链桥（θ 45，T1 崖台 → 甲板北口，② 肃清后崩断）→ ② 悬炉锻台（+17，甲板 / 炉坛 +18.4 / 北桥头锻楼 +20.5）
    ///   → 西吊臂（θ 135，甲板 → T2，下跳 6 m）→ ③ 风箱窟 θ 140（T2 西北，窟凿到 r 76，检修台 +14.5）
    ///   → T2 西南（熔泉池边，路遇 G11）→ 熔瀑栈道（T2 θ 250 → T3 θ 175）→ ④ 熔泉炉坛 θ 100（T3 北半环，吊臂台 +4）→ 井底铸门 θ 30。
    ///   支路：东壁栈架（T1 → T2 东，⑤ 铸范库在栈架脚）；藏宝 A 炼渣龛（T1 θ 192）；南链桥（T1 θ 225 ↔ 甲板南口，常设）；
    ///   升降台（T3 θ −60 ↔ T1，MovingPlatform OnRide，井底敲锣通电）——回程捷径。
    ///
    /// 边界（D14，没有空气墙）：T1 外沿以外就是火山口内壁，7 m 内升到 47 m 的崖顶；窟、龛、栈台、东旋坡是凿进井壁的「碗」，
    /// 地形 = 各碗的下包络（min），碗壁陡、爬不上去。软边界沿同一个遮罩只做兜底。场景只放环境和标记（D17 / L1）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-2 铸神井（或 bridge.sh level 3-2）。冒烟：bridge.sh playtest map-3-2（Map32Suite）。
    /// </summary>
    [LevelBuilder("3-2", ScenePath)]
    public static class Level_3_2
    {
        public const string Dir = "Assets/Levels/L3_2_ForgeWell";
        public const string ScenePath = "Assets/Scenes/L3_2_ForgeWell.unity";
        const string Name = "L3_2";

        // 高度场里 Base 米 = 世界 y 0（井底）；火山口外的熔岩台地 / 远景地面在 PlainY
        const float Base = 6f, HeightRange = 64f, PlainY = 26f;
        static readonly Vector2 Origin = new(-192, -192), Size = new(384, 384);
        /// <summary>雾（主题默认 18 / 170 m）：调远一点，井口看得见井底的铸门</summary>
        const float FogStart = 36f, FogEnd = 260f;

        static LevelKit.BoundarySpec Bounds
        {
            get
            {
                var b = LevelKit.BoundarySpec.Default;
                b.theme = "Inferno";
                return b;
            }
        }

        // ───────────── 四层 ─────────────
        /// <summary>各层台面高：井口栈台、上层工坊环、悬炉甲板、中层风箱环、井底、熔岩井面</summary>
        public const float T0Y = 32f, T1Y = 22f, DeckY = 17f, T2Y = 11f, T3Y = 0f, LavaY = -2.5f;
        /// <summary>
        /// 半径：熔岩井（地形洞）、井沿压平到、T3 外沿（T2 陡坎脚）、T2 内沿、T2 外沿（T1 陡坎脚）、T1 内沿、T1 外沿（井壁脚）。
        /// 陡坎 11 m 高、1.5 m 宽（约 80°）：爬不上去、跳下去不摔伤，任何一处环台沿都能下跳一层
        /// </summary>
        const float WellR = 20f, RimR = 22f, T3Out = 34f, T2In = 35.5f, T2Out = 47f, T1In = 48.5f, WallR = 60f;
        /// <summary>北崖段（θ 13–80）：没有 T2，T3 直接 22 m 的崖升到 T1；T1 在这一段往里伸到 r 40（北链桥头、井底铸门都在这段崖上）</summary>
        const float CliffFrom = 13f, CliffTo = 80f, CliffBlend = 3f, CliffT1In = 40f;
        /// <summary>崖顶高、井壁坡面宽</summary>
        const float Crest = 47f, Face = 7f;
        /// <summary>陡坎线的噪声摆动（米）</summary>
        const float Wobble = 0.7f;

        /// <summary>方位 θ（度，正东 0、逆时针）+ 半径 r → 世界 XZ</summary>
        static Vector2 P(float th, float r)
        {
            float a = th * Mathf.Deg2Rad;
            return new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r;
        }

        static Vector2 Dir2(float th) => P(th, 1f);
        /// <summary>θ 处的切向（逆时针）</summary>
        static Vector2 Tan(float th) => P(th + 90f, 1f);
        static float Theta(Vector2 p) => Mathf.Atan2(p.y, p.x) * Mathf.Rad2Deg;
        /// <summary>a − b 折到 (−180, 180]</summary>
        static float DeltaDeg(float a, float b) => Mathf.DeltaAngle(b, a);
        /// <summary>让 Prefab 的 +Z 朝 d 的偏航角</summary>
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;
        /// <summary>让 Prefab 的 +X 朝 d 的偏航角</summary>
        static float YawX(Vector2 d) => Mathf.Atan2(-d.y, d.x) * Mathf.Rad2Deg;
        /// <summary>正面朝井心</summary>
        static float FaceIn(float th) => YawZ(-Dir2(th));
        /// <summary>长边顺着环（+X 沿逆时针切向）</summary>
        static float AlongT(float th) => YawX(Tan(th));

        // ───────────── 方位 ─────────────
        const float SpawnTh = -90f, Site1Th = -10f, NorthBridgeTh = 45f, ArmTh = 135f, Site3Th = 140f, PoolTh = 215f, Site4Th = 100f,
            GateTh = 28f, CraneTh = 66f, LiftTh = -60f, Site5Th = -42f, CacheATh = 192f, SouthBridgeTh = 225f;

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = P(SpawnTh + 5f, 66f), Lookout = P(SpawnTh + 5f, 64.2f),
            Site1 = P(Site1Th - 4f, 66f), Site2 = Vector2.zero, Site3 = P(Site3Th, 56f), Site4 = P(Site4Th, 31f), Site5 = P(Site5Th, 41f),
            RoadsideAt = P(PoolTh, 38.5f);

        // ───────────── 凿进井壁的碗（窟 / 龛 / 栈台）：中心方位、径向起止、切向半宽、底面高、壁面宽 ─────────────
        struct Bowl
        {
            public string name;
            public float th, rFrom, rTo, half, floor, face;
            public Vector2 C => P(th, (rFrom + rTo) * 0.5f);
            public float HalfR => (rTo - rFrom) * 0.5f;

            /// <summary>有符号距离（碗内为正）：沿 θ 方向的圆角矩形</summary>
            public float Sdf(Vector2 p)
            {
                var q = p - C;
                float u = Vector2.Dot(q, Dir2(th)), v = Vector2.Dot(q, Tan(th));
                const float round = 2f;
                float dx = Mathf.Abs(u) - (HalfR - round), dz = Mathf.Abs(v) - (half - round);
                float outside = new Vector2(Mathf.Max(dx, 0), Mathf.Max(dz, 0)).magnitude + Mathf.Min(Mathf.Max(dx, dz), 0) - round;
                return -outside;
            }
        }

        static readonly Bowl[] Bowls =
        {
            new() { name = "井口栈台", th = SpawnTh, rFrom = 58f, rTo = 79f, half = 11f, floor = T0Y, face = 5f },
            new() { name = "① 炮工坊窟", th = Site1Th, rFrom = 58f, rTo = 84f, half = 22f, floor = T1Y, face = 4f },
            new() { name = "③ 风箱窟", th = Site3Th, rFrom = 44f, rTo = 76f, half = 23f, floor = T2Y, face = 4f },
            new() { name = "藏宝 A · 炼渣龛", th = CacheATh, rFrom = 58f, rTo = 72f, half = 4.5f, floor = T1Y, face = 3.5f },
            new() { name = "井底铸门龛", th = GateTh, rFrom = 32.5f, rTo = 43f, half = 6.2f, floor = T3Y, face = 3f },
        };

        // ── 东旋坡（T0 → T1，凿进井壁，宽 7 m）：折线（世界 XZ，坡顶 → 坡脚）──
        static readonly Vector2[] EastRamp =
        {
            P(-81f, 69f), P(-74f, 68f), P(-66f, 66f), P(-58f, 63f), P(-51f, 59.5f), P(-47f, 57.5f), P(-44f, 55.5f),
        };
        const float EastRampHalf = 3.5f;

        // ── 横坡（贴着陡坎脚斜着上下一层，脚 → 顶）：东壁栈架（T2 东 ↔ T1）、熔瀑栈道（T3 西 ↔ T2 西南）──
        struct Slant
        {
            public string name;
            public float thFoot, thTop, rAlong, rTop, footY, topY, half, wallR;
        }

        static readonly Slant[] Slants =
        {
            new() { name = "东壁栈架（T2 东 ↔ T1）", thFoot = -32f, thTop = 8f, rAlong = 43f, rTop = T1In + 1.2f, footY = T2Y, topY = T1Y, half = 2.6f, wallR = T2Out },
            new() { name = "熔瀑栈道（T3 西 ↔ T2 西南）", thFoot = 155f, thTop = 230f, rAlong = 30.5f, rTop = T2In + 1.2f, footY = T3Y, topY = T2Y, half = 3f, wallR = T3Out },
        };
        const float SlantOvershoot = 0.3f;

        static Vector2[] SlantPath(in Slant s)
        {
            const int N = 22;
            var o = new Vector2[N + 1];
            for (int i = 0; i <= N; i++)
            {
                float u = i / (float)N, th = Mathf.Lerp(s.thFoot, s.thTop, u);
                float r = u < 0.85f ? s.rAlong : Mathf.Lerp(s.rAlong, s.rTop, (u - 0.85f) / 0.15f);
                o[i] = P(th, r);
            }
            return o;
        }

        static readonly Vector2[][] SlantPaths = Slants.Select(s => SlantPath(s)).ToArray();

        // ── 俯射台（方台 + 两头 / 一头的坡）：名字、中心 θ / r、径向 / 切向半宽、台面高、坡长、哪头有坡（−1 顺时针端、+1 逆时针端）──
        struct Deck2
        {
            public string name;
            public float th, r, halfR, halfT, baseY, top, ramp;
            public int[] ends;
            /// <summary>没坡的台阶：台顶不进导航（<see cref="BuildStepNoNav"/>）；体块往背后（朝井外）多盖几米（地形往陡坎多填 3 m；背后贴着更高的台时只盖到台脚）</summary>
            public bool noNav;
            public float noNavBack;
        }

        static readonly Deck2[] Platforms =
        {
            new() { name = "① 炮台", th = Site1Th - 0.5f, r = 79.5f, halfR = 3f, halfT = 8f, baseY = T1Y, top = T1Y + 3.5f, ramp = 11f, ends = new[] { -1, 1 } },
            new() { name = "① 炮台前沿", th = Site1Th - 0.5f, r = 75.3f, halfR = 1.3f, halfT = 8f, baseY = T1Y, top = T1Y + 1.4f, ramp = 0f, ends = Array.Empty<int>(), noNav = true, noNavBack = 0f },
            new() { name = "③ 检修台", th = Site3Th + 10f, r = 72.3f, halfR = 2.8f, halfT = 8f, baseY = T2Y, top = T2Y + 3.5f, ramp = 11f, ends = new[] { -1 } },
            new() { name = "③ 风箱侧台", th = Site3Th + 14f, r = 63f, halfR = 3f, halfT = 4f, baseY = T2Y, top = T2Y + 1.4f, ramp = 0f, ends = Array.Empty<int>(), noNav = true, noNavBack = 2.9f },
            new() { name = "④ 吊臂台", th = CraneTh, r = 31.2f, halfR = 2.6f, halfT = 5f, baseY = T3Y, top = T3Y + 4f, ramp = 10f, ends = new[] { 1 } },
            new() { name = "④ 炉坛", th = 115f, r = 26.5f, halfR = 3f, halfT = 3.5f, baseY = T3Y, top = T3Y + 1.3f, ramp = 0f, ends = Array.Empty<int>(), noNav = true, noNavBack = 2.9f },
        };

        static Vector2 PlatformEnd(in Deck2 d, int sgn, float extra) => P(d.th, d.r) + Tan(d.th) * (sgn * (d.halfT + extra));

        /// <summary>俯射台的坡：顺着环（同一半径的弧）从坡脚爬到台沿（第 0 点 = 坡脚）；直的切线坡会越走越往外、爬到陡坎上</summary>
        static Vector2[] PlatformRampPath(in Deck2 d, int sgn)
        {
            const int N = 10;
            float thTop = d.th + sgn * (d.halfT - 0.5f) / d.r * Mathf.Rad2Deg, thFoot = d.th + sgn * (d.halfT + d.ramp) / d.r * Mathf.Rad2Deg;
            var o = new Vector2[N + 1];
            for (int i = 0; i <= N; i++) o[i] = P(Mathf.Lerp(thFoot, thTop, i / (float)N), d.r);
            return o;
        }

        static readonly Vector2[][][] PlatformRamps = Platforms.Select(d => d.ends.Select(sgn => PlatformRampPath(d, sgn)).ToArray()).ToArray();

        /// <summary>炼渣堆（θ, r, 半径, 高）：台阶层 + 矮掩体 + 余烬起身的渣堆</summary>
        static readonly (float th, float r, float radius, float h)[] Mounds =
        {
            (-21f, 61f, 3f, 1.3f), (-5f, 67.5f, 2.6f, 1.2f),
            (-150f, 52f, 3f, 1.2f), (-120f, 54f, 3f, 1.2f),
        };

        // ── 铸槽（① / ③ 窟里沿径向的一道熔铁槽：名字、方位、径向起止、半宽、所在层高）──
        static readonly (string name, float th, float r0, float r1, float half, float floorY)[] Troughs =
        {
            ("① 铸槽", Site1Th + 10f, 61.5f, 71f, 1.3f, T1Y), ("③ 铸槽", Site3Th - 4f, 48.5f, 55.5f, 1.3f, T2Y),
        };
        const float TroughDepth = 1.1f;

        // ── 熔泉池（T2 西南，T1 陡坎脚；熔瀑从 T1 沿泻进来）──
        const float PoolHalfR = 2.4f, PoolHalfT = 4.6f, PoolBed = 1.4f, PoolR = 44.5f;
        static readonly Vector2 PoolC = P(PoolTh, PoolR);
        const float PoolLevel = T2Y - 0.35f;
        /// <summary>熔瀑：三条错开的窄带（沿池子长边的横移 m、顶端在 T1 沿下多深 m、顶 / 底全宽 m、往岩壁里缩、相位种子）</summary>
        static readonly (float offset, float drop, float wTop, float wBottom, float back, int seed)[] FallBands =
        {
            (0.2f, 1.6f, 1.0f, 3.2f, 0f, 11), (-2.8f, 4.5f, 0.6f, 1.9f, 0.12f, 23), (3.1f, 3.4f, 0.7f, 2.1f, 0.12f, 37),
        };

        // ── 悬炉锻台：甲板（井心，偏航 45°：北口朝 θ 45、西吊臂朝 θ 135、南口朝 θ 225、东口朝 θ −45）──
        /// <summary>链桥 / 吊臂接到甲板的那一头离甲板中心多远（压进甲板板边 0.2 m）</summary>
        const float DeckMouth = 12.3f;
        const float DeckYaw = 45f, DeckHalf = 13f, DeckSlab = 1.5f, KerbH = 0.6f, KerbT = 0.4f, KerbEdge = 12.8f, GapHalf = 2f;
        /// <summary>正式件（ch3-kit 第 0 / 2 / 3 节）：等比 ×1.48；发布尺度甲板顶 6.32；四角链柱台 3.5 × 1.7 × 3.6 在 (±6.96, ±6.82)，SOCKET_Chain 在 8.0</summary>
        const float ForgeScale = 1.48f, ForgeDeckAbove = 6.32f, ChainSocketAbove = (8.0f - 6.32f) * 1.48f;
        static readonly Vector2 PillarAt = new(6.96f * 1.48f, 6.82f * 1.48f);
        static readonly Vector3 PillarSize = new(3.5f * 1.48f, 1.7f * 1.48f, 3.6f * 1.48f);
        const float HearthHalf = 3f, HearthH = 1.4f, FurnaceR = 1.75f, FurnaceH = 4f;
        /// <summary>北桥头锻楼（甲板上，俯射 +3.5）：甲板局部中心、半宽、台面高出甲板</summary>
        /// <summary>北桥头锻楼：跨在北口上的平台（甲板局部中心、宽 × 深）、台面高出甲板；西侧铁梯坡</summary>
        static readonly Vector2 TowerLocal = new(0f, 9.5f), TowerSize = new(10f, 6f);
        const float TowerRise = 3.5f, TowerStairLen = 8.5f, TowerStairHalf = 1.1f;
        /// <summary>链桥宽、西吊臂宽 / 伸到多远（离井心）</summary>
        const float BridgeWidth = 4f, ArmWidth = 4f, ArmTo = 40.5f;
        static readonly Vector2 NorthHead = P(NorthBridgeTh, CliffT1In + 0.6f), SouthHead = P(SouthBridgeTh, T1In + 0.8f);

        /// <summary>甲板局部 (x, z) → 世界 XZ（+Z = 北口 θ 45）</summary>
        static Vector2 DeckPt(float x, float z) => DeckPt(new Vector2(x, z));

        static Vector2 DeckPt(Vector2 l)
        {
            var fwd = Dir2(NorthBridgeTh);
            var right = Dir2(NorthBridgeTh - 90f);
            return right * l.x + fwd * l.y;
        }

        // ── 炉坛升降台（T3 θ −60 ↔ T1）：台面中心离井心、台面边长 / 厚、上站栈桥（台面外沿 → T1）──
        const float LiftR = 27f, LiftDeck = 7f, LiftThickness = 0.5f, LiftPost = 5.3f, HeadframeTop = 31f;
        static readonly Vector2 LiftXZ = P(LiftTh, LiftR);

        // ── 井底铸门：门板（熔铁闸门 10 × 9 × 1.4）离井心、出口传送门离井心 ──
        const float GateR = 38.2f, PortalR = 35f;
        static readonly Vector2 GateAt = P(GateTh, GateR), PortalAt = P(GateTh, PortalR), GateBehind = P(GateTh, 41f);

        // ── 四口间歇熔泉（④，S3 落地后接上）──
        static readonly float[] GeyserThetas = { 80f, 98f, 132f, 150f };
        const float GeyserR = 23.5f;

        // ── 资产 ID ──
        const string HangingForgeId = "SM_Tripo_InfernoHangingForge", RockRibId = "SM_Tripo_InfernoRockRib", SpiralLedgeId = "SM_Tripo_InfernoSpiralLedge",
            BellowsId = "SM_Tripo_InfernoBellows", CastingBedId = "SM_Tripo_InfernoCastingBed", MoltenGateId = "SM_Tripo_InfernoMoltenGate",
            ScaffoldId = "SM_Tripo_InfernoScaffold", LadleCraneId = "SM_Tripo_InfernoLadleCrane", BasaltColumnsId = "SM_Tripo_InfernoBasaltColumns",
            ZhurongId = "SM_Tripo_InfernoZhurong", FoundryId = "SM_Env_InfernoFoundry", ColumnId = "SM_Tripo_InfernoColumn", AltarId = "SM_Tripo_InfernoFireAltar",
            CoverWallId = "SM_Tripo_InfernoCoverWall", BarricadeId = "SM_Tripo_InfernoBarricade", IngotsId = "SM_Tripo_InfernoIngotPile",
            HoardId = "SM_Tripo_InfernoTreasureHoard", StallId = "SM_Tripo_InfernoForgeStall", CrucibleId = "SM_Prop_InfernoCrucible",
            ObeliskId = "SM_Prop_InfernoChainObelisk", AnvilId = "SM_Prop_Anvil", FurnaceTowerId = "SM_Tripo_InfernoFurnaceTower",
            CauldronId = "SM_Tripo_InfernoCauldronRuin", KilnMouthId = "SM_Tripo_InfernoKilnMouth";
        const float BellowsScale = 1.5f;

        /// <summary>第三章 ART6 / v2 地图件的登记尺寸（缺 Prefab 时放这个尺寸的白盒；registry.toml「第三章地图件」「第三章 v2 地图件」）</summary>
        static readonly Dictionary<string, Vector3> Registered = new()
        {
            [HangingForgeId] = new(26f, 8f, 26f), [RockRibId] = new(9f, 16f, 12f), [SpiralLedgeId] = new(14f, 7f, 8f), [BellowsId] = new(18f, 5f, 8f),
            [CastingBedId] = new(8f, 1.4f, 5f), [MoltenGateId] = new(10f, 9f, 1.4f), [ScaffoldId] = new(12f, 10f, 8f), [LadleCraneId] = new(18f, 16f, 8f),
            [BasaltColumnsId] = new(8f, 9f, 7f), [KilnMouthId] = new(16f, 12f, 5f),
        };

        // ───────────── 地貌 ─────────────

        /// <summary>北崖段权重（0 = 普通三层环，1 = T3 直接崖到 T1）</summary>
        static float CliffW(float th) => Smooth(CliffFrom - CliffBlend, CliffFrom + CliffBlend, th) * (1 - Smooth(CliffTo - CliffBlend, CliffTo + CliffBlend, th));

        /// <summary>环台剖面：r（已摆动）、北崖权重 → 高度</summary>
        static float Profile(float r, float wCliff)
        {
            float normal = r < T3Out ? T3Y
                : r < T2In ? T3Y + (T2Y - T3Y) * Smooth(T3Out, T2In, r)
                : r < T2Out ? T2Y
                : r < T1In ? T2Y + (T1Y - T2Y) * Smooth(T2Out, T1In, r)
                : T1Y;
            float cliff = r < T3Out ? T3Y : r < CliffT1In ? T3Y + (T1Y - T3Y) * Smooth(T3Out, CliffT1In, r) : T1Y;
            return Mathf.Lerp(normal, cliff, wCliff);
        }

        /// <summary>陡坎线不摆动的地方（桥头、升降台、坡顶、熔瀑、铸门、吊臂落点）</summary>
        static float Calm(Vector2 p)
        {
            float k = 0;
            foreach (var (c, r) in CalmSpots) k = Mathf.Max(k, Disc(p, c, r, 4f));
            return k;
        }

        static readonly (Vector2 c, float r)[] CalmSpots =
        {
            (NorthHead, 7f), (SouthHead, 6f), (P(LiftTh, 36f), 10f), (P(Slants[0].thTop, T1In), 6f), (P(Slants[1].thTop, T2In), 6f),
            (P(PoolTh, T1In), 7f), (P(GateTh, 36f), 10f), (P(ArmTh, 38f), 6f), (P(CraneTh, T3Out), 9f), (P(Site3Th, 46f), 14f),
        };

        /// <summary>崖顶：47 m 上下起伏的山脊，往外落到熔岩台地。dout = 离可玩区多远</summary>
        static float CrestHeight(Vector2 p, float r, float dout)
        {
            float swell = (Fbm(p, 120f, 3, 41) * 7f + Fbm(p, 45f, 2, 43) * 2.5f) * Smooth(10f, 36f, dout);
            float ridge = Crest + (Ridged(p, 26f, 3, 7) - 0.4f) * 5f + swell;
            float plain = PlainY + Fbm(p, 60f, 2, 9) * 2f + Fbm(p, 110f, 2, 45) * 4f;
            return Mathf.Lerp(ridge, plain, Smooth(118f, 170f, r));
        }

        /// <summary>
        /// 一个「碗」在 p 处挖出的面：碗里 = 底面高，碗外 = 底面高沿壁面宽升到崖顶（smoothstep）。整个井 = 各碗的下包络（min）：
        /// 环台本身（剖面 + 井壁）、栈台、窟、龛、东旋坡都是碗，碗壁都陡（爬不上去），碗与碗之间不夹沟
        /// </summary>
        static float Carve(float inside, float floor, float face, float crest) =>
            inside >= 0 ? floor : floor + (Mathf.Max(crest, floor) - floor) * Smooth(0f, face, -inside);

        /// <summary>东旋坡：离折线距离、沿线参数</summary>
        static float EastRampLevel(float t) => Mathf.Lerp(T0Y, T1Y, t);

        /// <summary>离游玩区边界的有符号距离（界内为正）：环台外沿 ∪ 各碗 ∪ 东旋坡</summary>
        static float Inside(Vector2 p)
        {
            float best = WallR - p.magnitude;
            foreach (var b in Bowls) best = Mathf.Max(best, b.Sdf(p));
            best = Mathf.Max(best, EastRampHalf - Polyline(p, EastRamp).dist);
            return best;
        }

        /// <summary>可玩区遮罩（软边界与 L5 共用）：等值线 0.2 落在井壁坡面上</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        static bool WellHole(Vector2 p) => p.magnitude < WellR;

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float r = p.magnitude, th = Theta(p);
            float calm = Calm(p);
            float rr = r + Fbm(p, 22f, 2, 32) * Wobble * (1 - calm);
            float wCliff = CliffW(th);

            // ── 碗的下包络 ──
            float insRing = WallR - rr;
            float union = insRing;
            foreach (var b in Bowls) union = Mathf.Max(union, b.Sdf(p));
            var (rampD, rampT) = Polyline(p, EastRamp);
            float insRamp = EastRampHalf - rampD;
            union = Mathf.Max(union, insRamp);
            float crest = CrestHeight(p, r, Mathf.Max(0, -union));

            float h = Carve(insRing, insRing >= 0 ? Profile(rr, wCliff) : T1Y, Face, crest);
            foreach (var b in Bowls) h = Mathf.Min(h, Carve(b.Sdf(p), b.floor, b.face, crest));
            h = Mathf.Min(h, Carve(insRamp, EastRampLevel(rampT), 5f, crest));
            // 东旋坡下半段压在 T1 上：坡面只填不挖（不被 T1 的 22 m 削掉一半宽）
            {
                float m = 1 - Smooth(EastRampHalf - 0.6f, EastRampHalf + 1.2f, rampD);
                if (m > 0) h = Mathf.Max(h, Mathf.Lerp(h, EastRampLevel(rampT), m));
            }
            float wall = Smooth(-0.5f, 2f, -union);
            float crestTop = Smooth(Face + 1f, Face + 7f, -union);

            // ── 地面细起伏（井沿、桥头、升降台一带压平）──
            float settle = (1 - calm) * Smooth(RimR, RimR + 3f, r) * Smooth(-1f, 1f, union);
            h += Fbm(p, 12f, 2, 33) * 0.1f * settle;

            // ── 炼渣堆 ──
            float slag = 0;
            foreach (var (mth, mr, rad, mh) in Mounds)
            {
                float d = Vector2.Distance(p, P(mth, mr));
                if (d >= rad) continue;
                float k = Mathf.Pow(1 - Smooth(0, rad, d), 1.2f);
                h += mh * k;
                slag = Mathf.Max(slag, k);
            }

            // ── 俯射台（只填）──
            float deck = 0;
            for (int pi = 0; pi < Platforms.Length; pi++)
            {
                var pl = Platforms[pi];
                var q = p - P(pl.th, pl.r);
                float lr = Vector2.Dot(q, Dir2(pl.th)), lt = Vector2.Dot(q, Tan(pl.th));
                // 背后（朝井外）多填 3 m：台面顶到岩壁 / 陡坎长到台面高为止，不夹沟
                float ox = lr > 0 ? Mathf.Max(0, lr - pl.halfR - 3f) : Mathf.Max(0, -lr - pl.halfR), oz = Mathf.Max(0, Mathf.Abs(lt) - pl.halfT);
                float outside = Mathf.Sqrt(ox * ox + oz * oz);
                if (outside < 1f)
                {
                    float m = 1 - Smooth(0, 1f, outside);
                    h = Mathf.Max(h, Mathf.Lerp(h, pl.top, m));
                    deck = Mathf.Max(deck, m);
                }
                foreach (var path in PlatformRamps[pi])
                {
                    var (dist, t) = Polyline(p, path);
                    float m = 1 - Smooth(2.25f, 4.25f, dist);
                    if (m <= 0) continue;
                    float target = Mathf.Lerp(pl.baseY, pl.top, Mathf.Min(1f, t / 0.92f));
                    h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                    deck = Mathf.Max(deck, m);
                }
            }

            // ── 横坡（只填，按弧长线性；贴陡坎那侧的坡肩全高填到陡坎）──
            float ramp = 0;
            for (int i = 0; i < Slants.Length; i++)
            {
                var sl = Slants[i];
                var (d, t) = Polyline(p, SlantPaths[i]);
                float u = Mathf.InverseLerp(sl.thFoot, sl.thTop, sl.thFoot < sl.thTop ? UnwrapNear(th, (sl.thFoot + sl.thTop) * 0.5f) : th);
                bool wallSide = u >= 0 && u < 0.85f && r > sl.rAlong;
                float shoulder = wallSide ? Mathf.Max(0, sl.wallR - sl.rAlong - sl.half + 0.8f) : 0f;
                float fade = 2.2f;
                if (d > sl.half + shoulder + fade) continue;
                float m = 1 - Smooth(sl.half + shoulder, sl.half + shoulder + fade, d);
                float target = Mathf.Lerp(sl.footY, sl.topY + SlantOvershoot, t);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                ramp = Mathf.Max(ramp, m);
            }

            // ── 铸槽（挖到熔岩面下 1.1 m，1 m 岸坡）──
            float trough = 0;
            foreach (var tr in Troughs)
            {
                var q = p - P(tr.th, (tr.r0 + tr.r1) * 0.5f);
                float lr = Vector2.Dot(q, Dir2(tr.th)), lt = Vector2.Dot(q, Tan(tr.th));
                float ox = Mathf.Max(0, Mathf.Abs(lr) - (tr.r1 - tr.r0) * 0.5f), oz = Mathf.Max(0, Mathf.Abs(lt) - tr.half);
                float outside = Mathf.Sqrt(ox * ox + oz * oz);
                if (outside >= 1f) continue;
                float bed = tr.floorY - 0.35f - TroughDepth;
                h = Mathf.Min(h, Mathf.Lerp(bed, h, Smooth(0, 1f, outside)));
                trough = Mathf.Max(trough, 1 - Smooth(0, 0.5f, outside));
            }

            // ── 熔泉池（T2 西南：挖到熔岩面下 1.4 m，2 m 岸坡）──
            float pool = 0, poolShore = 0;
            {
                var q = p - PoolC;
                float lr = Vector2.Dot(q, Dir2(PoolTh)), lt = Vector2.Dot(q, Tan(PoolTh));
                float ox = Mathf.Max(0, Mathf.Abs(lr) - PoolHalfR), oz = Mathf.Max(0, Mathf.Abs(lt) - PoolHalfT);
                // 靠井壁那边（lr > 0）一直挖到 T1 陡坎脚：熔瀑落进池子，不落在一道干坎上
                if (lr > 0) ox = Mathf.Max(0, lr - (T2Out + 0.6f - PoolR));
                float outside = Mathf.Sqrt(ox * ox + oz * oz);
                if (outside < 2f && r < T1In)
                {
                    float bed = PoolLevel - PoolBed;
                    h = Mathf.Min(h, Mathf.Lerp(bed, h, Smooth(0, 2f, outside)));
                    pool = 1 - Smooth(0, 0.6f, outside);
                }
                poolShore = 1 - Smooth(1.5f, 5f, outside);
            }

            // ── 熔岩井：洞，井沿一圈压平 ──
            if (r < RimR + 1f)
            {
                h = Mathf.Lerp(T3Y, h, Smooth(RimR - 1f, RimR + 1f, r));
                if (WellHole(p)) s.hole = 1;
            }

            // ── 地形外缘 30 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 30, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Inferno）──
            float inside = Smooth(-0.5f, 1.5f, union);
            float riser = Mathf.Max(Riser(rr, T3Out, T2In) * (1 - wCliff), Mathf.Max(Riser(rr, T2Out, T1In) * (1 - wCliff), Riser(rr, T3Out, CliffT1In) * wCliff));
            float top0 = inside * (1 - riser);
            s.packed = Mathf.Max(top0 * 0.45f, Mathf.Max(deck * 0.85f, ramp * 0.8f));
            s.sand = Mathf.Max((1 - inside) * 0.55f * (1 - wall * 0.5f), slag * 0.9f);
            s.sand = Mathf.Max(s.sand, top0 * Smooth(0.15f, 0.55f, Fbm(p, 22f, 3, 37)) * 0.6f);
            s.sand = Mathf.Max(s.sand, crestTop * Smooth(-0.2f, 0.5f, Fbm(p, 45f, 3, 49)) * 0.7f);
            s.rock = Mathf.Max(riser * inside * 0.55f, wall * 0.6f * (1 - crestTop));
            s.fluid = Mathf.Max(Mathf.Max(pool, trough), s.hole);
            float wellShore = (1 - Smooth(WellR, WellR + 5f, r)) * (1 - s.hole);
            s.shore = Mathf.Max(wellShore, poolShore * (1 - pool));
            return s;
        }

        static float Riser(float r, float a, float b) => Smooth(a - 0.6f, a + 0.2f, r) * (1 - Smooth(b - 0.2f, b + 0.6f, r));

        /// <summary>把 θ 展开到 near 附近（±180°）</summary>
        static float UnwrapNear(float th, float near) => near + DeltaDeg(th, near);

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-2 铸神井", priority = 69)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        static LevelKit.TerrainSet ts;

        static Vector3 OnGround(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);
        static float GroundY(Vector2 q) => ts.GroundY(q.x, q.y);

        /// <summary>最上面的可站立面（地形、甲板、桥、台）：从 fromY 往下打射线；打不到就退回地形</summary>
        static Vector3 Surf(Vector2 q, float fromY = 60f, float dy = 0)
        {
            Physics.SyncTransforms();
            if (Physics.Raycast(At(q, fromY), Vector3.down, out var hit, fromY + 20f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return hit.point + Vector3.up * dy;
            return OnGround(q, dy);
        }

        static Material darkIron, deckPlate, placeholderMat, glowMat, lampMat, wood;

        /// <summary>生成场景 → 烘焙 NavMesh → 验收规则集 + 熔岩 + 升降台 + 链桥 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Inferno;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            LevelKit.ResetChainCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var kit = new GameObject("Kit").transform;
            var props = new GameObject("Props").transform;
            var world = new GameObject("World").transform;
            var markers = new GameObject("Markers").transform;

            darkIron = LevelKit.Mat(Dir, "ForgeIron", new Color(0.17f, 0.14f, 0.15f), 0.6f);
            deckPlate = LevelKit.Mat(Dir, "DeckPlate", new Color(0.24f, 0.19f, 0.17f), 0.8f);
            // 白盒用暗玄武岩色（默认的白在火狱的泛光下刺眼，同 3-1 / 3-3）
            placeholderMat = LevelKit.Mat(Dir, "Ch3Placeholder", new Color(0.36f, 0.3f, 0.27f), 0.85f);
            glowMat = LevelKit.GlowMat(Dir, "ForgeGlow", new Color(1f, 0.5f, 0.2f), new Color(4f, 1.4f, 0.35f));
            lampMat = LevelKit.GlowMat(Dir, "LiftLamp", new Color(1f, 0.6f, 0.25f), new Color(3f, 1.3f, 0.3f));
            wood = LevelKit.Mat(Dir, "CharredWood", new Color(0.2f, 0.15f, 0.12f), 0.9f);

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            RenderSettings.fogStartDistance = FogStart;
            RenderSettings.fogEndDistance = FogEnd;
            WellLighting(theme, world);
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            try
            {
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, Vector2.zero, PlainY, 700, 5);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                LevelKit.Weather(env, theme, new Vector2(0.4f, 1f), 0.2f);

                BuildWell(world);
                var forge = BuildHangingForge(kit, world, markers);
                var (northBridge, southBridge) = BuildBridges(world);
                var arm = BuildArm(world);
                BuildLavaFall(world);
                BuildTroughs(world, markers);
                BuildStepNoNav(world);
                var (gate, gateCarve, gateGlow, gateLight) = BuildExitGate(kit, world);
                var lift = BuildLift(world);
                BuildSites(kit, props, markers);
                BuildScatter(props, theme);
                BuildMarkers(markers);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝井心的悬炉）+ 自举标记
                var spawnAt = OnGround(Spawn, 0.05f);
                var look = (Vector2.zero - Spawn).normalized;
                var spawnRot = Quaternion.LookRotation(new Vector3(look.x, 0, look.y));
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<SG.PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<SG.LevelBootstrap>();

                var director = new GameObject("Forge Well Director").AddComponent<SG.ForgeWellDirector>();
                director.transform.SetParent(world, false);
                var (objective, s2, s4) = BuildEncounters(markers, director);
                director.geysers = BuildGeysers(world, markers, s4);
                BuildExit(objective);
                WireDirector(director, s2, s4, objective, northBridge, forge, arm, gate, gateCarve, gateGlow, gateLight);
                var gong = BuildLiftGong(world, lift);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                LevelKit.BakeLavaNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                if (!EditorBuildSettings.scenes.Any(sc => sc.path == ScenePath))
                    EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

                var rep = new LevelKit.Report();
                rep.Line("3-2 铸神井 v2 · 验收");
                rep.Line($"高度：井口栈台 {GroundY(Spawn):F1}，① 炮工坊窟 {GroundY(Site1):F1}（炮台 {GroundY(P(Site1Th, 79.5f)):F1}），② 甲板 {Surf(DeckPt(4f, -8f), 30f).y:F1}，" +
                         $"③ 风箱窟 {GroundY(Site3):F1}（检修台 {GroundY(P(Site3Th, 72.3f)):F1}），④ 熔泉炉坛 {GroundY(Site4):F1}（吊臂台 {GroundY(P(CraneTh, 31.2f)):F1}），" +
                         $"熔岩井面 {LavaY:F1}，熔泉池面 {PoolLevel:F2}，升降台 {lift.path[0].y:F2} → {lift.path[^1].y:F2}，井底铸门 {GroundY(PortalAt):F1}，崖顶 {GroundY(P(-90f, 95f)):F1}");
                LevelValidator.Run(Spec(), rep);
                DiagnoseAnchors(rep);
                DiagnoseRoute(rep);
                LevelKit.ValidateLava(rep);
                CheckLift(rep, lift, gong);
                CheckBridges(rep, northBridge, southBridge, lift);
                CheckDeck(rep);
                CheckSiteMetrics(rep);
                CheckSquads(rep, scene);
                CheckSiteCenters(rep, scene);
                CheckSteps(rep);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_3-2_report.txt");

                if (review) Review(spawnAt, spawnRot, lift);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        /// <summary>井里的光：主光抬到俯角 58°、从南边照进来；熔岩井、熔泉池、悬炉炉腹、铸门各一盏不投影的橙色点光</summary>
        static void WellLighting(ShowcaseTheme theme, Transform world)
        {
            var sun = RenderSettings.sun;
            if (sun)
            {
                sun.transform.rotation = Quaternion.Euler(58f, 15f, 0);
                sun.intensity = theme.sunIntensity * 1.15f;
            }
            Point(world, "Lava Well Light", new Vector3(0, 2.5f, 0), 40f, 6f);
            var pool = PoolC;
            Point(world, "Lava Fall Light", new Vector3(pool.x, PoolLevel + 4f, pool.y), 16f, 3.5f);
        }

        static Light Point(Transform parent, string name, Vector3 at, float range, float intensity, Color? color = null)
        {
            var l = new GameObject(name).AddComponent<Light>();
            l.transform.SetParent(parent, false);
            l.transform.position = at;
            l.type = LightType.Point;
            l.color = color ?? new Color(1f, 0.46f, 0.16f);
            l.range = range;
            l.intensity = intensity;
            l.shadows = LightShadows.None;
            return l;
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, SG.MovingPlatform lift)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => Surf(q, 60f, dy);
            var forge = new Vector3(0, DeckY + 3f, 0);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-2", new[]
                {
                    ("Aerial", new Vector3(-120, 120, -140), new Vector3(0, 4, 8), false),
                    ("Map", new Vector3(0, 340, -1), new Vector3(0, 0, 0), false),
                    ("Spawn", E(Spawn), forge, true),
                    ("Lookout", E(Lookout), At(P(-110f, 16.5f), LavaY), false),
                    ("Kiln", E(P(-34f, 57f)), OnGround(P(Site1Th, 78f), 3f), false),
                    ("NorthBridge", E(P(NorthBridgeTh, 43f)), forge, false),
                    ("Deck", E(DeckPt(0, 10f)), At(DeckPt(0, -8f), DeckY + 1.5f), false),
                    ("Arm", E(DeckPt(-10f, 0)), OnGround(Site3, 3f), false),
                    ("Bellows", E(P(Site3Th, 44f)), OnGround(P(Site3Th, 68f), 3f), false),
                    ("LavaFall", E(P(PoolTh - 14f, 38f)), At(P(PoolTh, 46f), PoolLevel + 4f), false),
                    ("FallRamp", E(P(250f, 36.5f)), OnGround(P(175f, 30f), 1f), false),
                    ("ForgeAltar", E(P(160f, 27f)), OnGround(P(GateTh, 36f), 4f), false),
                    ("Gate", E(P(GateTh, 24f)), OnGround(P(GateTh, 38f), 4f), false),
                    ("LiftTop", lift.path[^1] + Vector3.up * 1.62f + (Vector3)(At(Dir2(LiftTh), 0) * 9f), forge, false),
                    ("Crest", At(P(-60f, 70f), T0Y + 14f), OnGround(P(-60f, 130f)), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");

        static Vector3 SizeOf(string id) => Registered.TryGetValue(id, out var s) ? s : ShowcaseSceneBuilder.DesignBounds(id).size;

        /// <summary>摆一件资产：底面中心 = q、世界 y = baseY；有 Prefab 就按 scale 摆，没有就放登记尺寸 × scale 的暗色白盒</summary>
        /// <summary>非等比缩放摆一件（正式件按 ch3-kit「建议摆放」回到设计占地；白盒按登记尺寸）</summary>
        static GameObject KitScaled(string id, Transform parent, Vector2 q, float baseY, float yaw, Vector3 scale)
        {
            var go = Kit(id, parent, q, baseY, yaw);
            if (go && !IsPlaceholder(go)) go.transform.localScale = scale;
            return go;
        }

        static GameObject Kit(string id, Transform parent, Vector2 q, float baseY, float yaw, float scale = 1f)
        {
            var size = SizeOf(id) * scale;
            if (size.sqrMagnitude < 0.01f) size = Vector3.one * 2 * scale;
            var go = LevelKit.PlaceOrBox(id, parent, At(q, baseY), size, yaw, scale, placeholderMat);
            if (!go) return null;
            go.isStatic = true;
            return go;
        }

        /// <summary>贴地摆（底面埋进地面 sink 米）</summary>
        static GameObject Prop(string id, Transform parent, Vector2 q, float yaw, float scale = 1, float sink = 0.1f) =>
            Kit(id, parent, q, GroundY(q) - sink, yaw, scale);

        /// <summary>摆在最上面的可站立面上（甲板、台）</summary>
        static GameObject PropOn(string id, Transform parent, Vector2 q, float fromY, float yaw, float scale = 1, float sink = 0.05f) =>
            Kit(id, parent, q, Surf(q, fromY).y - sink, yaw, scale);

        /// <summary>熔岩井：熔岩面（LavaVolume 圆，熔岩面 −2.5，下面放接人板）、地形洞一圈的井壁衬里 + 熔岩光带</summary>
        static void BuildWell(Transform world)
        {
            LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "Well", center = new Vector3(0, LavaY, 0), shape = SG.LavaShape.Disc,
                size = new Vector2(WellR + 1f, 0), depth = 2f, depthShore = false, catchFloor = true,
            }, world);
            var basalt = LevelKit.Mat(Dir, "WellLining", new Color(0.13f, 0.1f, 0.11f), 0.95f);
            var glow = LevelKit.GlowMat(Dir, "WellGlowBand", new Color(1f, 0.45f, 0.15f), new Color(3.2f, 1.1f, 0.25f));
            LevelKit.WellLining(Dir, "Well Lining", world, Circle(WellR + 0.6f, 128), -0.12f, LavaY - 1.2f, basalt);
            LevelKit.WellLining(Dir, "Well Glow Band", world, Circle(WellR + 0.52f, 128), LavaY + 0.9f, LavaY - 0.3f, glow);
        }

        static List<Vector2> Circle(float r, int n)
        {
            var o = new List<Vector2>(n);
            for (int i = 0; i < n; i++) o.Add(P(360f * i / n, r));
            return o;
        }

        /// <summary>
        /// 悬炉锻台（ART6 SM_Tripo_InfernoHangingForge 改，承重；实测见 docs/art/ch3-kit.md 第 0 / 2 节）：整件等比 ×1.48 → 26 m 宽，
        /// 底面 = 炉腹最低点，甲板顶在底面上 9.35 m（发布尺度 6.32 × 1.48）；甲板顶 +17、偏航 45°。网格碰撞拆掉，碰撞全是自己的盒子：
        /// 甲板板（25.6 × 25，贴着网格甲板的 17.3 × 16.8 × 1.48）、四角链柱台（网格的 3.5 × 1.7 × 3.6 × 1.48，在 (±10.3, ±10.1)，柱顶放毕方栖点）。
        /// 网格没画的要素自己做（第 6 节）：0.6 m 铁矮栏（每边正中留 4 m 缺口——北 / 南接链桥、西接吊臂、东口直通熔岩井 = 击退带）、
        /// 中心炉坛（6 m 见方 1.4 m 铁台阶 + 熔炉 SM_Env_InfernoFoundry ×1.2 = 全遮）、北桥头锻楼（跨在北口上的 9 × 6 m 平台 +3.5，
        /// 链桥从它底下进甲板，西侧一道 22° 铁梯坡下来）。四条巨链从网格的 SOCKET_Chain 拉到崖顶铁柱。没有 Prefab 时同样的盒子带暗色白盒外观。
        /// 返回炉腹（演出喷火星的地方）
        /// </summary>
        static Transform BuildHangingForge(Transform kit, Transform world, Transform markers)
        {
            var root = new GameObject("Hanging Forge").transform;
            root.SetParent(kit, false);
            bool art = ShowcaseSceneBuilder.Prefab(HangingForgeId);
            if (art)
            {
                var go = Kit(HangingForgeId, root, Vector2.zero, DeckY - ForgeDeckAbove * ForgeScale, DeckYaw, ForgeScale);
                if (go)
                    foreach (var c in go.GetComponentsInChildren<Collider>(true))
                        Object.DestroyImmediate(c);
            }
            GameObject Part(string name, Vector2 local, Vector3 size, float baseY, Material m, bool visible)
            {
                var go = LevelKit.Box(name, root, At(DeckPt(local), baseY), size, DeckYaw, m, 0f);
                if (!visible) Object.DestroyImmediate(go.GetComponent<MeshRenderer>());
                return go;
            }
            if (!art) LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var slab = Part(art ? "Deck Collision" : $"Placeholder · {HangingForgeId}", Vector2.zero, new Vector3(25.6f, DeckSlab, 25f), DeckY - DeckSlab, placeholderMat, !art);
            if (!art) slab.tag = LevelKit.PlaceholderTag;
            if (!art)
            {
                var belly = Part("Forge Belly", Vector2.zero, new Vector3(16f, 2f, 16f), DeckY - DeckSlab - 2f, darkIron, true);
                Object.DestroyImmediate(belly.GetComponent<Collider>());
            }
            // 四角链柱台（网格自带，碰撞自己补）+ 柱顶栖点
            int pi = 0;
            foreach (var (sx, sz) in new[] { (1, 1), (-1, 1), (-1, -1), (1, -1) })
            {
                var c = new Vector2(sx * PillarAt.x, sz * PillarAt.y);
                NotWalkable(Part($"Chain Pillar {++pi}", c, PillarSize, DeckY, placeholderMat, !art));
                var m = new GameObject($"{SG.PerchPoint.MarkerPrefix}_ForgePillar{pi}");
                m.transform.SetParent(markers, false);
                m.transform.position = At(DeckPt(c), DeckY + PillarSize.y + 0.02f);
                m.AddComponent<SG.PerchPoint>().radius = 1.2f;
            }
            // 矮栏（网格没画，自己做，看得见）：每边两段，正中留 4 m 缺口，角上让给链柱台
            float segEnd = PillarAt.x - PillarSize.x * 0.5f - 0.1f;
            float segLen = segEnd - GapHalf, segMid = GapHalf + segLen * 0.5f;
            foreach (var (nx, nz) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
                foreach (int side in new[] { -1, 1 })
                {
                    var c = nx != 0 ? new Vector2(nx * (KerbEdge - KerbT * 0.5f), side * segMid) : new Vector2(side * segMid, nz * (KerbEdge - KerbT * 0.5f));
                    var size = nx != 0 ? new Vector3(KerbT, KerbH, segLen) : new Vector3(segLen, KerbH, KerbT);
                    Part($"Kerb {(nx > 0 ? "E" : nx < 0 ? "W" : nz > 0 ? "N" : "S")}{(side < 0 ? "a" : "b")}", c, size, DeckY, darkIron, true);
                }
            // 中心炉坛：铁台阶 + 熔炉（全遮）；顶上不进导航
            NotWalkable(Part("Hearth Base", Vector2.zero, new Vector3(HearthHalf * 2, HearthH, HearthHalf * 2), DeckY, darkIron, true));
            var furnace = Kit(FoundryId, root, Vector2.zero, DeckY + HearthH - 0.05f, DeckYaw + 180f, 1.2f);
            if (furnace)
            {
                NotWalkable(furnace);
                if (IsPlaceholder(furnace)) furnace.transform.localScale = new Vector3(FurnaceR * 2, FurnaceH, FurnaceR * 2);
            }
            Point(root, "Hearth Light", At(Vector2.zero, DeckY + HearthH + 5.5f), 18f, 2.6f);

            // 北桥头锻楼（自己做）：跨在北口上的平台，四根铁腿（链桥从腿之间进甲板，净空 3.1 m），西侧铁梯坡往南下到甲板
            var tower = new GameObject("Bridgehead Forge Tower").transform;
            tower.SetParent(root, false);
            float towerTop = DeckY + TowerRise;
            LevelKit.Box("Tower Floor", tower, At(DeckPt(TowerLocal), towerTop - 0.4f), new Vector3(TowerSize.x, 0.4f, TowerSize.y), DeckYaw, deckPlate, 0f);
            foreach (var (lx, lz) in new[] { (1, 1), (-1, 1), (-1, -1), (1, -1) })
                LevelKit.Box("Tower Leg", tower, At(DeckPt(TowerLocal + new Vector2(lx * (TowerSize.x * 0.5f - 0.3f), lz * (TowerSize.y * 0.5f - 0.3f))), DeckY),
                    new Vector3(0.5f, TowerRise - 0.4f, 0.5f), DeckYaw, darkIron, 0f);
            // 朝井外一侧（北沿）一道 1.2 m 铁女墙：楼上的马面有掩体
            LevelKit.Box("Tower Parapet", tower, At(DeckPt(TowerLocal + new Vector2(0, TowerSize.y * 0.5f - 0.15f)), towerTop), new Vector3(TowerSize.x, 1.2f, 0.3f), DeckYaw, darkIron, 0f);
            var stairTop = new Vector2(-(HearthHalf + TowerStairHalf + 0.25f), TowerLocal.y - TowerSize.y * 0.5f);
            var stairFoot = stairTop + new Vector2(0, -TowerStairLen);
            float slope = Mathf.Atan2(TowerRise, TowerStairLen) * Mathf.Rad2Deg;
            var stair = GameObject.CreatePrimitive(PrimitiveType.Cube);
            stair.name = "Tower Stair";
            stair.transform.SetParent(tower, false);
            float len = Mathf.Sqrt(TowerRise * TowerRise + TowerStairLen * TowerStairLen);
            stair.transform.SetPositionAndRotation(At(DeckPt((stairTop + stairFoot) * 0.5f), DeckY + TowerRise * 0.5f - 0.15f),
                Quaternion.Euler(0, DeckYaw, 0) * Quaternion.Euler(-slope, 0, 0));
            stair.transform.localScale = new Vector3(TowerStairHalf * 2, 0.3f, len + 0.4f);
            stair.GetComponent<MeshRenderer>().sharedMaterial = deckPlate;
            stair.isStatic = true;

            // 甲板陈设：两段高掩体（铁板屏风）、两座铁砧、一堆锭
            PropOn(AnvilId, root, DeckPt(6.5f, 3.5f), DeckY + 3f, DeckYaw + 20f, 1.2f);
            PropOn(AnvilId, root, DeckPt(-5f, -6.5f), DeckY + 3f, DeckYaw - 30f, 1.2f);
            PropOn(IngotsId, root, DeckPt(5f, -10f), DeckY + 3f, DeckYaw + 60f);
            PropOn(CoverWallId, root, DeckPt(8.5f, -2.5f), DeckY + 3f, DeckYaw + 90f);
            PropOn(CoverWallId, root, DeckPt(-2f, -9f), DeckY + 3f, DeckYaw);

            // 四条巨链：链柱台的 SOCKET_Chain → 崖顶铁柱
            var chains = new GameObject("Hanging Forge Chains").transform;
            chains.SetParent(kit, false);
            int ci = 0;
            foreach (var (sx, sz) in new[] { (1, 1), (-1, 1), (-1, -1), (1, -1) })
            {
                var c = DeckPt(new Vector2(sx * PillarAt.x, sz * PillarAt.y));
                float th = Theta(c);
                if (Mathf.Abs(DeltaDeg(th, SpawnTh)) < 20f) th = SpawnTh + 22f;
                var anchor = P(th, 96f);
                float gy = GroundY(anchor);
                Kit(ColumnId, kit, anchor, gy - 0.3f, FaceIn(th), 1.3f);
                var from = At(c, DeckY + ChainSocketAbove);
                var to = At(anchor, gy - 0.3f + 4.93f * 1.3f);
                LevelKit.Chain(Dir, $"Forge {++ci}", chains, from, to, 5f, 1.4f);
            }

            var bellyAt = new GameObject("Forge Belly").transform;
            bellyAt.SetParent(world, false);
            bellyAt.position = new Vector3(0, DeckY - DeckSlab - 1.2f, 0);
            Point(world, "Forge Belly Light", new Vector3(0, DeckY - DeckSlab - 3.5f, 0), 24f, 3f);
            if (!art)
            {
                var glowRing = LevelKit.Cylinder("Forge Belly Glow", root, new Vector3(0, DeckY - DeckSlab - 2.05f, 0), 5.5f, 0.2f, Quaternion.identity, glowMat);
                Object.DestroyImmediate(glowRing.GetComponent<Collider>());
            }
            return bellyAt;
        }

        /// <summary>导航烘焙时这块碰撞体顶上不算可走（炉坛台阶 / 熔炉 / 链柱台顶：人能跳上去，敌人的导航不要一块孤岛）</summary>
        static void NotWalkable(GameObject go)
        {
            var mod = go.AddComponent<NavMeshModifier>();
            mod.overrideArea = true;
            mod.area = 1;
        }

        /// <summary>甲板上的空地（场地中心落点、验收、套件用；甲板正中是炉坛）</summary>
        static Vector3 DeckFloor => At(DeckPt(4f, -8f), DeckY);
        /// <summary>主线在甲板上的路点：北口 → 西口之间（炉坛西南、锻楼铁梯坡外）</summary>
        static Vector3 DeckRoute => At(DeckPt(-8.5f, -3f), DeckY);

        /// <summary>
        /// 两座链桥（BreakableSpan 桥板，烘焙时在导航网格上）：北链桥 T1 崖台 → 甲板北口（Signal：② 肃清后由 ForgeWellDirector 崩断），
        /// 南链桥 T1 西南 → 甲板南口（常设，不会断）。两侧没有栏杆、只有吊链当扶手（击退带）；桥头各一块铁板落脚
        /// </summary>
        static (SG.BreakableSpan north, SG.BreakableSpan south) BuildBridges(Transform world)
        {
            var root = new GameObject("Chain Bridges").transform;
            root.SetParent(world, false);
            var plank = LevelKit.Mat(Dir, "BridgePlate", new Color(0.21f, 0.17f, 0.15f), 0.8f);
            SG.BreakableSpan Bridge(string name, Vector2 head, float headY, Vector2 mouth, int count, bool breakable)
            {
                var from = At(head, headY);
                var to = At(mouth, DeckY);
                var span = LevelKit.PlaceBreakableSpan(name, root, from, to, BridgeWidth, count, 0.45f, plank, darkIron);
                span.triggers = breakable ? SG.BreakableSpan.Trigger.Signal : SG.BreakableSpan.Trigger.None;
                span.kind = SG.Destructible.Kind.Wood;
                span.displayName = name;
                span.warnTime = 0.55f;
                span.chainDelay = 0.16f;
                span.fallLimit = 40f;
                // 桥头落脚板（固定）：桥板接到地形上不出坎
                var dir = (mouth - head).normalized;
                LevelKit.Box($"{name} · Head Plate", root, At(head - dir * 1.2f, headY - 0.5f), new Vector3(BridgeWidth + 0.6f, 0.5f, 3.4f), YawZ(dir), darkIron, 0f);
                // 扶手吊链（没有碰撞）
                var side = new Vector2(dir.y, -dir.x);
                foreach (int s in new[] { -1, 1 })
                    LevelKit.Chain(Dir, $"{name} Rail {(s < 0 ? "L" : "R")}", root, from + (Vector3)At(side * (s * BridgeWidth * 0.5f), 0) + Vector3.up * 1.1f,
                        to + (Vector3)At(side * (s * BridgeWidth * 0.5f), 0) + Vector3.up * 1.1f, 0.8f, 0.7f);
                return span;
            }
            // 桥板压进甲板板 0.2 m（甲板板 25.6 × 25：z ±12.5），不留缝
            var north = Bridge("North Chain Bridge", NorthHead, T1Y, DeckPt(0, DeckMouth), 9, true);
            var south = Bridge("South Chain Bridge", SouthHead, T1Y, DeckPt(0, -DeckMouth), 12, false);
            return (north, south);
        }

        /// <summary>
        /// 西吊臂：甲板西口伸出去的铁梁走道（4 m 宽、没有栏杆），一直伸到 T2 上空（r 40.5，比 T2 高 6 m）——走到头跳下去就是 ③ 风箱窟门口。
        /// 下跳在导航上是一条只给玩家走的单向连线（区域 29：不会爬的敌人登记时去掉这一位，地面敌人不跟着跳），主线验收按它连通。
        /// 吊臂头挂一只吊钩（② 肃清后放下来，指往下走）。返回吊钩
        /// </summary>
        static Transform BuildArm(Transform world)
        {
            var root = new GameObject("West Crane Arm").transform;
            root.SetParent(world, false);
            var dir = Dir2(ArmTh);
            float from = DeckMouth, to = ArmTo;
            var mid = dir * ((from + to) * 0.5f);
            LevelKit.Box("Arm Walkway", root, At(mid, DeckY - 0.8f), new Vector3(ArmWidth, 0.8f, to - from), YawZ(dir), deckPlate, 0f);
            // 梁下两道箱梁（外观）
            foreach (int s in new[] { -1, 1 })
            {
                var g = LevelKit.Box("Arm Girder", root, At(mid + Tan(ArmTh) * (s * (ArmWidth * 0.5f - 0.3f)), DeckY - 2.2f), new Vector3(0.5f, 1.4f, to - from), YawZ(dir), darkIron, 0f);
                Object.DestroyImmediate(g.GetComponent<Collider>());
            }
            // 吊臂头：一根短柱 + 滑轮 + 吊钩（吊钩没有碰撞）
            var tip = dir * (to - 0.8f);
            LevelKit.Box("Arm Tip Post", root, At(tip + Tan(ArmTh) * (ArmWidth * 0.5f - 0.3f), DeckY), new Vector3(0.6f, 3.2f, 0.6f), YawZ(dir), darkIron, 0f);
            var hook = new GameObject("Arm Hook").transform;
            hook.SetParent(root, false);
            var hookUp = At(dir * (to + 0.6f), DeckY + 2.5f);
            hook.position = hookUp;
            var h1 = LevelKit.Box("Hook Block", hook, hookUp + Vector3.down * 0.6f, new Vector3(0.9f, 0.9f, 0.9f), YawZ(dir), darkIron, 0f);
            Object.DestroyImmediate(h1.GetComponent<Collider>());
            var h2 = LevelKit.Cylinder("Hook Lamp", hook, hookUp + Vector3.down * 1.0f, 0.3f, 0.3f, Quaternion.identity, lampMat);
            Object.DestroyImmediate(h2.GetComponent<Collider>());
            foreach (var t in hook.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
            // 下跳连线（玩家用）
            var link = new GameObject("Arm Drop Link");
            link.transform.SetParent(root, false);
            link.transform.position = At(dir * (to - 1.2f), DeckY);
            var l = link.AddComponent<NavMeshLink>();
            l.agentTypeID = 0;
            l.startPoint = Vector3.zero;
            var land = At(dir * (to + 2.2f), T2Y);
            l.endPoint = land - link.transform.position;
            l.width = ArmWidth - 1f;
            l.bidirectional = false;
            l.area = SG.PackCoordinator.ClimbArea;
            l.autoUpdate = false;
            return hook;
        }

        /// <summary>熔泉池（T2 西南，LavaVolume 盒）+ 从 T1 沿的裂缝贴着陡坎泻下来的三条熔岩窄带（只是画）</summary>
        static void BuildLavaFall(Transform world)
        {
            var tg = Tan(PoolTh);
            var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "Fall Pool", center = At(PoolC + Dir2(PoolTh) * 1f, PoolLevel), shape = SG.LavaShape.Box, yaw = YawZ(tg),
                size = new Vector2(PoolHalfR * 2 + 4f, PoolHalfT * 2 + 2f), depth = PoolBed + 0.6f, depthShore = true, flow = new Vector2(0, -0.25f),
            }, world);
            lava.gameObject.name = "Lava · 熔泉池";
            var mat = LevelKit.LavaMaterial();
            if (!mat) return;
            var fall = new GameObject("Lava Fall").transform;
            fall.SetParent(world, false);
            for (int i = 0; i < FallBands.Length; i++)
            {
                var mesh = FallBandMesh(FallBands[i]);
                mesh.name = $"Mesh_LavaFall_{i + 1}";
                LevelKit.SaveAsset(mesh, $"{Dir}/Lava/Mesh_LavaFall_{i + 1}.asset");
                var band = new GameObject($"Lava Fall Band {i + 1}");
                band.transform.SetParent(fall, false);
                band.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = band.AddComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                band.isStatic = true;
            }
        }

        /// <summary>
        /// ① / ③ 的铸槽（LavaVolume 盒）：窟里一道 2.6 m 宽的熔铁槽，两岸没有栏——被击退进去的地面敌人烧死。
        /// 每个战斗场地放一个 Knock_Edge 标记（站在岸上、朝着熔岩），冒烟 / 验收按它找击退带
        /// </summary>
        static void BuildTroughs(Transform world, Transform markers)
        {
            foreach (var tr in Troughs)
            {
                var c = P(tr.th, (tr.r0 + tr.r1) * 0.5f);
                var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = tr.name, center = At(c, tr.floorY - 0.35f), shape = SG.LavaShape.Box, yaw = YawZ(Dir2(tr.th)),
                    size = new Vector2(tr.half * 2 + 1.2f, tr.r1 - tr.r0 + 1.2f), depth = TroughDepth + 0.4f, depthShore = true, flow = new Vector2(0, 0.3f),
                }, world);
                lava.gameObject.name = $"Lava · {tr.name}";
            }
            void Knock(string name, Vector2 at, float y, Vector2 toward)
            {
                var m = new GameObject(name);
                m.transform.SetParent(markers, false);
                m.transform.SetPositionAndRotation(At(at, y), Quaternion.LookRotation(new Vector3(toward.x, 0, toward.y)));
            }
            var t1 = Troughs[0];
            Knock("Knock_Edge_1", P(t1.th, (t1.r0 + t1.r1) * 0.5f) - Tan(t1.th) * (t1.half + 2.2f), T1Y, Tan(t1.th));
            Knock("Knock_Edge_2", DeckPt(DeckHalf - 1.4f, 0), DeckY, Dir2(NorthBridgeTh - 90f));
            var t3 = Troughs[1];
            Knock("Knock_Edge_3", P(t3.th, (t3.r0 + t3.r1) * 0.5f) + Tan(t3.th) * (t3.half + 2.2f), T2Y, -Tan(t3.th));
            Knock("Knock_Edge_4", P(Site4Th + 15f, RimR + 1.2f), T3Y, -Dir2(Site4Th + 15f));
        }

        /// <summary>smoothstep 的反函数：s = 3x² − 2x³ → x（0–1）</summary>
        static float InvSmooth(float s) => 0.5f - Mathf.Sin(Mathf.Asin(1f - 2f * Mathf.Clamp01(s)) / 3f);

        /// <summary>
        /// 一条熔瀑窄带（世界坐标网格）：从熔岩池面下 0.3 m 贴着 T1 陡坎一直爬到裂缝口——每一行按陡坎的 smoothstep 剖面反算坡面在哪、往井心让 0.9 → 0.45 m；
        /// 上窄下宽，左右边线各自带噪声摆动。着色器数据同 <see cref="SG.LavaVolume.BuildMesh"/>（uv1 = 半宽 / 很长 / 盒 / 不按深度，uv2 = 往下流 3 m/s）
        /// </summary>
        static Mesh FallBandMesh((float offset, float drop, float wTop, float wBottom, float back, int seed) b)
        {
            const int Rows = 30, Cols = 6;
            const float Stretch = 3f, Flow = 3f;
            var tg = Tan(PoolTh);
            float yBottom = PoolLevel - 0.3f, yTop = T1Y - b.drop;
            var verts = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            float along = 0;
            var prevCenter = Vector3.zero;
            for (int j = 0; j <= Rows; j++)
            {
                float v = j / (float)Rows, y = Mathf.Lerp(yBottom, yTop, v);
                float half = 0.5f * Mathf.Lerp(b.wBottom, b.wTop, Mathf.Pow(v, 0.8f)) * Mathf.Lerp(1f, 0.3f, Smooth(0.9f, 1f, v));
                float wl = half * (1 + 0.25f * (Mathf.PerlinNoise(v * 5f + b.seed, 3.1f) * 2 - 1));
                float wr = half * (1 + 0.25f * (Mathf.PerlinNoise(v * 5f + b.seed, 7.7f) * 2 - 1));
                float c = b.offset + 0.3f * Mathf.Sin(v * Mathf.PI * 1.4f + b.seed);
                float gap = Mathf.Lerp(0.9f, 0.45f, v) - b.back;
                Vector3 Surface(float x)
                {
                    float k = y <= T2Y ? 0f : InvSmooth((y - T2Y) / (T1Y - T2Y));
                    var q = P(PoolTh, T2Out + (T1In - T2Out) * k - gap) + tg * x;
                    return new Vector3(q.x, y, q.y);
                }
                var center = Surface(c);
                if (j > 0) along += Vector3.Distance(prevCenter, center);
                prevCenter = center;
                for (int i = 0; i <= Cols; i++)
                {
                    float u = -1f + 2f * i / Cols;
                    float w = u < 0 ? wl : u > 0 ? wr : (wl + wr) * 0.5f;
                    float x = c + u * w;
                    verts.Add(Surface(x));
                    uv0.Add(new Vector2(u * w * Stretch, along));
                    uv1.Add(new Vector4(w * Stretch, 1000f, 0, 0));
                    uv2.Add(new Vector4(0, -Flow, b.seed * 0.37f, 0));
                }
            }
            var tris = new List<int>();
            for (int j = 0; j < Rows; j++)
            for (int i = 0; i < Cols; i++)
            {
                int a = j * (Cols + 1) + i, bb = a + 1, cc = a + Cols + 1, d = cc + 1;
                tris.Add(a); tris.Add(bb); tris.Add(cc);
                tris.Add(bb); tris.Add(d); tris.Add(cc);
            }
            var mesh = new Mesh();
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uv0);
            mesh.SetUVs(1, uv1);
            mesh.SetUVs(2, uv2);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// 井底铸门（出口）：北崖脚凿进去的龛，龛底 = T3；熔铁闸门（ART6 白盒 10 × 9 × 1.4）立在龛里，正面朝井心。
        /// 门板的碰撞不进导航烘焙（门后那截龛底也在网格上），关着时挂一个挖洞障碍把门洞挖掉；ForgeWellDirector 开门时撤掉。
        /// 门缝的光（两条发光竖缝 + 一盏点光）开门前亮起。返回门板、挖洞障碍、门缝光、点光
        /// </summary>
        static (Transform gate, NavMeshObstacle carve, GameObject[] glow, Light light) BuildExitGate(Transform kit, Transform world)
        {
            var root = new GameObject("Exit Forge Gate").transform;
            root.SetParent(world, false);
            float yaw = FaceIn(GateTh);
            var gate = new GameObject("Gate Leaf").transform;
            gate.SetParent(root, false);
            gate.position = At(GateAt, T3Y);
            // 闸板正式件 6.83 m 宽：X ×1.46 撑满 10 m 门洞（门框没建，用自己的铁门柱 + 门楣）
            var leaf = KitScaled(MoltenGateId, gate, GateAt, T3Y - 0.2f, yaw, new Vector3(1.46f, 1f, 1f));
            foreach (var t in gate.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
            gate.gameObject.AddComponent<NavMeshModifier>().ignoreFromBuild = true;
            var carveGo = new GameObject("Gate Nav Carve");
            carveGo.transform.SetParent(root, false);
            carveGo.transform.SetPositionAndRotation(At(GateAt, T3Y), Quaternion.Euler(0, yaw, 0));
            var carve = carveGo.AddComponent<NavMeshObstacle>();
            carve.shape = NavMeshObstacleShape.Box;
            carve.center = new Vector3(0, 2f, 0);
            carve.size = new Vector3(11f, 4f, 2.4f);
            carve.carving = true;
            carve.carveOnlyStationary = false;
            carve.enabled = false; // 运行时 ForgeWellDirector.Awake 打开（编辑期关着，L5 看到的是开门后的网格）
            // 门两侧的门柱（铁）+ 门楣
            var tg = Tan(GateTh);
            foreach (int s in new[] { -1, 1 })
                LevelKit.Box("Gate Jamb", root, At(GateAt + tg * (s * 5.6f) + Dir2(GateTh) * 0.3f, T3Y), new Vector3(1.2f, 10.5f, 2.2f), yaw, darkIron, 0.2f);
            LevelKit.Box("Gate Lintel", root, At(GateAt + Dir2(GateTh) * 0.3f, T3Y + 9.6f), new Vector3(12.4f, 1.6f, 2.4f), yaw, darkIron, 0f);
            // 门缝的光：门板两侧各一条竖缝 + 门后一盏点光
            var glow = new List<GameObject>();
            foreach (int s in new[] { -1, 1 })
            {
                var slit = LevelKit.Box("Gate Slit Glow", root, At(GateAt + tg * (s * 5.05f) - Dir2(GateTh) * 0.2f, T3Y), new Vector3(0.18f, 9f, 0.3f), yaw, glowMat, 0f);
                Object.DestroyImmediate(slit.GetComponent<Collider>());
                slit.isStatic = false;
                glow.Add(slit);
            }
            var light = Point(root, "Gate Light", At(GateBehind, T3Y + 4f), 22f, 0f, new Color(1f, 0.62f, 0.28f));
            // 门前两座火坛
            foreach (int s in new[] { -1, 1 }) Prop(AltarId, kit, P(GateTh, 33.5f) + tg * (s * 7.6f), FaceIn(GateTh));
            return (gate, carve, glow.ToArray(), light);
        }

        /// <summary>
        /// 炉坛升降台（通用 <see cref="SG.MovingPlatform"/>，OnRide；替代 3-2 旧的 ForgeWellLift）：台面 7 × 7 m，第 0 点 = 井底下站（导航按它烘），
        /// 第 1 点 = T1 高度（+22），上站接一座 4 m 宽的固定栈桥跨过 T2 搭到 T1 内沿。开局没通电：井底下站旁边的铜锣敲响后通电（回程捷径从下面打开）。
        /// 井架两根立柱在台面两侧 5.3 m 外，横梁在 +31。
        /// </summary>
        static SG.MovingPlatform BuildLift(Transform world)
        {
            var rd = Dir2(LiftTh);
            var tg = Tan(LiftTh);
            float yaw = YawZ(rd);
            float low = float.MinValue;
            foreach (var (a, b) in new[] { (-1, -1), (-1, 1), (1, -1), (1, 1) })
                low = Mathf.Max(low, GroundY(LiftXZ + tg * (a * LiftDeck * 0.45f) + rd * (b * LiftDeck * 0.45f)));
            low += 0.25f;
            float high = T1Y;
            var lift = LevelKit.PlaceMovingPlatform("Forge Lift", world, new[] { At(LiftXZ, low), At(LiftXZ, high) }, yaw, new Vector2(LiftDeck, LiftDeck), LiftThickness,
                deckPlate, darkIron, "EW");
            lift.mode = SG.MovingPlatform.Mode.OnRide;
            lift.speed = 4f;
            lift.accel = 2.5f;
            lift.departDelay = 0.8f;
            lift.callRadius = 6.5f;
            lift.startPowered = false;
            lift.onSignal = SG.MovingPlatform.SignalAction.Power;
            lift.poweredToast = "炉坛升降台通电了 · 井底 ↔ 上层工坊环";
            // 台面上两盏灯（通电后亮）
            var deck = lift.deck;
            var lamps = new List<GameObject>();
            foreach (int s in new[] { -1, 1 })
            {
                var lamp = GameObject.CreatePrimitive(PrimitiveType.Cube);
                lamp.name = "Lamp";
                lamp.transform.SetParent(deck, false);
                lamp.transform.localPosition = new Vector3(s * (LiftDeck * 0.5f - 0.1f), 1.2f, -LiftDeck * 0.5f + 0.3f);
                lamp.transform.localScale = new Vector3(0.35f, 0.3f, 0.35f);
                lamp.GetComponent<MeshRenderer>().sharedMaterial = lampMat;
                Object.DestroyImmediate(lamp.GetComponent<Collider>());
                lamp.isStatic = false;
                lamps.Add(lamp);
            }
            var dl = new GameObject("Deck Light").AddComponent<Light>();
            dl.transform.SetParent(deck, false);
            dl.transform.localPosition = new Vector3(0, 2.5f, 0);
            dl.type = LightType.Point;
            dl.color = new Color(1f, 0.55f, 0.2f);
            dl.range = 10f;
            dl.intensity = 2.5f;
            dl.shadows = LightShadows.None;
            lamps.Add(dl.gameObject);
            lift.poweredOnly = lamps.ToArray();

            // 上站栈桥（固定）：台面外沿 → T1 内沿里 1 m，两侧 1 m 铁栏
            float g0 = LiftR + LiftDeck * 0.5f + 0.05f, g1 = T1In + 1.2f;
            var gw = P(LiftTh, (g0 + g1) * 0.5f);
            LevelKit.Box("Lift Gangway", world, At(gw, high - 0.6f), new Vector3(4f, 0.6f, g1 - g0), yaw, deckPlate, 0f);
            foreach (int s in new[] { -1, 1 })
                LevelKit.Box("Gangway Rail", world, At(gw + tg * (s * 1.92f), high), new Vector3(0.15f, 1f, g1 - g0 - 1.6f), yaw, darkIron, 0f);
            // 井架
            var headframe = new GameObject("Lift Headframe").transform;
            headframe.SetParent(world, false);
            foreach (int s in new[] { -1, 1 })
            {
                var c = LiftXZ + tg * (s * LiftPost);
                LevelKit.Box("Headframe Post", headframe, At(c, GroundY(c) - 0.3f), new Vector3(0.9f, HeadframeTop - GroundY(c) + 0.3f, 0.9f), yaw, darkIron, 0f);
            }
            LevelKit.Box("Headframe Crossbeam", headframe, At(LiftXZ, HeadframeTop - 1.2f), new Vector3(LiftPost * 2 + 1.2f, 1.2f, 1f), yaw, darkIron, 0f);
            return lift;
        }

        /// <summary>井底下站旁的铜锣（SceneActivator 按钮）：敲响 → 升降台通电（MovingPlatform.onSignal = Power）</summary>
        static SG.SceneActivator BuildLiftGong(Transform world, SG.MovingPlatform lift)
        {
            var at = P(LiftTh + 12f, LiftR - 1.5f);
            var gong = LevelKit.PlaceGong("Lift Gong", world, OnGround(at), FaceIn(LiftTh + 12f), wood, LevelKit.Mat(Dir, "Bronze", new Color(0.55f, 0.36f, 0.16f), 0.4f), lampMat);
            gong.title = "升降台铜锣";
            gong.verb = "敲响";
            gong.hint = "炉坛升降台通电：井底 ↔ 上层工坊环";
            gong.targets = new MonoBehaviour[] { lift };
            return gong;
        }

        /// <summary>各场地的地貌件、掩体、陈设（③ ④ 的巨型件、栈架、岩肋都是登记件白盒）</summary>
        static void BuildSites(Transform kit, Transform props, Transform markers)
        {
            // 井口栈台：两座火坛、铸炉摊、一根锁魂碑（眺台记号）
            Prop(AltarId, props, P(SpawnTh - 7f, 72f), FaceIn(SpawnTh - 7f));
            Prop(AltarId, props, P(SpawnTh + 7f, 72f), FaceIn(SpawnTh + 7f));
            Prop(StallId, props, P(SpawnTh - 4f, 76f), FaceIn(SpawnTh - 4f));
            Prop(ObeliskId, props, P(SpawnTh - 6f, 65.5f), 20f);

            // ① 炮工坊窟：窟口两道岩肋；窟里的掩体都离窟壁 / 炮台前沿 ≥ 3 m（不和墙连成一片）：两段高掩体、铸炉摊、两堆可破坏货堆；
            // 环台上两根铁柱、一张铸床；炮台后两座火坛，窟后两座炉道口（第二波增援门）
            foreach (float dth in new[] { -16f, 16f })
            {
                float th = Site1Th + dth;
                Kit(RockRibId, kit, P(th, 61f), GroundY(P(th, 61f)) - 0.3f, FaceIn(th), 0.8f);
            }
            Prop(CoverWallId, props, P(Site1Th, 66f), AlongT(Site1Th));
            Prop(CoverWallId, props, P(Site1Th - 11f, 69f), AlongT(Site1Th - 11f) + 15f);
            Prop(StallId, props, P(Site1Th + 16f, 70f), FaceIn(Site1Th + 16f));
            var cargo = LevelKit.Mat(Dir, "Cargo", new Color(0.3f, 0.22f, 0.16f), 0.9f);
            foreach (float dth in new[] { -5f, 6f })
            {
                var q = P(Site1Th + dth, 59.5f);
                LevelKit.PlaceDestructible($"Kiln Cargo {dth:+0;-0}", props, OnGround(q), AlongT(Site1Th + dth), new Vector3(2.4f, 2f, 2f), SG.Destructible.Kind.Wood, cargo, 60f);
            }
            Prop(ColumnId, props, P(Site1Th - 14f, 54f), FaceIn(Site1Th - 14f));
            Prop(ColumnId, props, P(Site1Th + 14f, 54f), FaceIn(Site1Th + 14f));
            Prop(IngotsId, props, P(Site1Th + 16f, 63f), 40f);
            Prop(CrucibleId, props, P(Site1Th - 7f, 62.5f), 10f);
            foreach (float dth in new[] { -11f, 11f }) Prop(AltarId, props, P(Site1Th + dth, 82.5f), FaceIn(Site1Th + dth));
            foreach (float dth in new[] { -13f, 13f }) Prop(FurnaceTowerId, kit, P(Site1Th + dth, 85.5f), FaceIn(Site1Th + dth), 0.8f);

            // T1 东：栈架三座（白盒，背面嵌进 T1 陡坎，正面露在陡坎上；坡道是地形）
            // 正式件 8.2 × 10 × 5.2、层间竖梯（ch3-kit 第 6 节）：等比 ×1.12，背面嵌进 T1 陡坎，只当立面；走的是前面的地形坡
            foreach (float th in new[] { -22f, -8f, 6f })
                Kit(ScaffoldId, kit, P(th, T2Out + 2.2f), T2Y - 0.1f, FaceIn(th), 1.12f);

            // ⑤ 铸范库（T2 东南，栈架脚）：一道岩肋围出库口、残鼎、锭堆
            Kit(RockRibId, kit, P(Site5Th - 9f, 47.5f), T2Y - 0.3f, FaceIn(Site5Th - 9f), 0.85f);
            Prop(CauldronId, props, P(Site5Th + 4f, 44f), FaceIn(Site5Th));
            Prop(IngotsId, props, P(Site5Th - 2f, 45.2f), 60f);
            Prop(CoverWallId, props, P(Site5Th + 2f, 38f), AlongT(Site5Th));

            // ③ 风箱窟：窟口两道岩肋、横卧的巨型风箱、三根铁柱、两段高掩体、窟后炉门（铁牛从这里出来）、检修台两座火坛
            foreach (float dth in new[] { -20f, 20f })
            {
                float th = Site3Th + dth;
                Kit(RockRibId, kit, P(th, 48.5f), T2Y - 0.3f, FaceIn(th), 0.8f);
            }
            // 正式件 9.26 × 5 × 4.02：等比 ×1.5（13.9 × 7.5 × 6，横卧全遮）
            Prop(BellowsId, kit, P(Site3Th, 64f), AlongT(Site3Th), BellowsScale);
            foreach (var (dth, r) in new[] { (-16f, 62f), (-18f, 69f), (13f, 57f) }) Prop(ColumnId, props, P(Site3Th + dth, r), FaceIn(Site3Th + dth));
            Prop(CoverWallId, props, P(Site3Th - 8f, 53f), AlongT(Site3Th - 8f));
            Prop(CoverWallId, props, P(Site3Th + 8f, 54f), AlongT(Site3Th + 8f));
            // 窟后炉门：炉窟门脸（锦上添花件，拱门贯通，背面贴岩壁）×0.8
            Prop(KilnMouthId, kit, P(Site3Th - 12f, 77.5f), FaceIn(Site3Th - 12f), 0.8f);
            foreach (float dth in new[] { 5f, 16f }) Prop(AltarId, props, P(Site3Th + dth, 74.8f), FaceIn(Site3Th + dth));
            KitScaled(CastingBedId, kit, P(Site3Th - 11f, 49.5f), GroundY(P(Site3Th - 11f, 49.5f)) - 0.1f, AlongT(Site3Th - 11f), new Vector3(1.5f, 1f, 2.4f));

            // 熔泉池边（路遇）：池边一根铁柱（毕方栖点）、一道矮障
            var perch = P(PoolTh + 9f, 41f);
            Prop(ColumnId, props, perch, FaceIn(PoolTh + 9f), 1.1f);
            var pm = new GameObject($"{SG.PerchPoint.MarkerPrefix}_PoolColumn");
            pm.transform.SetParent(markers, false);
            pm.transform.position = At(perch, GroundY(perch) + 4.93f * 1.1f + 0.02f);
            pm.AddComponent<SG.PerchPoint>().radius = 0.7f;
            Prop(BarricadeId, props, P(PoolTh - 9f, 38f), AlongT(PoolTh - 9f));
            Prop(CoverWallId, props, P(PoolTh - 13f, 39f), AlongT(PoolTh - 13f));

            // ④ 熔泉炉坛：吊臂台后的浇包吊车（白盒，嵌进北崖）、炉坛台上的熔炉和坩埚；独立的全遮（离陡坎 ≥ 5 m）：三根铁柱、两丛玄武岩柱
            Kit(LadleCraneId, kit, P(CraneTh, T3Out + 4.5f), T3Y - 0.2f, FaceIn(CraneTh), 1.02f);
            Prop(FoundryId, kit, P(115f, 27f), FaceIn(115f));
            Prop(CrucibleId, props, P(110f, 25.5f), 30f, 1.1f);
            foreach (var (th, r) in new[] { (55f, 24.5f), (89f, 26.5f), (141f, 28f) }) Prop(ColumnId, props, P(th, r), FaceIn(th));
            Prop(BasaltColumnsId, kit, P(15f, 27.5f), FaceIn(15f), 0.85f);

            // 熔瀑栈道：栈道脚一座火坛、坡顶一道矮障
            Prop(AltarId, props, P(151f, 27.5f), FaceIn(151f));
            Prop(BarricadeId, props, P(237f, 38.5f), AlongT(237f));

            // 藏宝 A 炼渣龛：宝堆、锭堆
            Prop(HoardId, kit, P(CacheATh, 70.5f), FaceIn(CacheATh));
            Prop(IngotsId, kit, P(CacheATh, 70.6f) + Tan(CacheATh) * 2.6f, 50f);
            // ⑤ 藏宝 B 宝堆
            Prop(HoardId, kit, P(Site5Th - 4f, 45.5f), FaceIn(Site5Th - 4f));

            // T1 沿岸：南链桥头、北链桥头、升降台栈桥头各一座火坛（远看是一串光点）
            foreach (float th in new[] { SouthBridgeTh + 7f, NorthBridgeTh - 9f, LiftTh + 6f }) Prop(AltarId, props, P(th, 53f), FaceIn(th));

            // 祝融像：出口铸门正上方的崖顶（出生点隔着整口井看过去）
            var zAt = P(GateTh, WallR + 22f);
            var statue = Kit(ZhurongId, kit, zAt, GroundY(zAt) - 0.6f, FaceIn(GateTh), 1.5f);
            if (statue && !IsPlaceholder(statue)) statue.name = $"{ZhurongId} (Crest)";
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：余烬石、火山渣避开主路、横坡、俯射台、熔泉池、井沿；玄武岩块只在环台外半圈和崖顶、场地 / 站位 / 坡 / 龛以外
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            var lines = new List<IReadOnlyList<Vector2>> { EastRamp, Circle(T1In + 5f, 96), Circle(T2In + 5f, 96), Circle(RimR + 6f, 96) };
            lines.AddRange(SlantPaths);
            float RouteDist(Vector2 w)
            {
                float best = float.MaxValue;
                foreach (var l in lines) best = Mathf.Min(best, Polyline(w, l).dist);
                return best;
            }
            float Keep(Vector2 w)
            {
                float k = 0;
                foreach (var pl in Platforms) k = Mathf.Max(k, Disc(w, P(pl.th, pl.r), pl.halfT + 4f, 3f));
                k = Mathf.Max(k, Disc(w, PoolC, PoolHalfT + 3f, 2f));
                k = Mathf.Max(k, Disc(w, LiftXZ, 9f, 3f));
                k = Mathf.Max(k, 1 - Smooth(RimR, RimR + 3f, w.magnitude));
                return 1 - k;
            }
            var details = LevelKit.ScatterPresets.Details(theme.key);
            foreach (var r in details)
            {
                var wh = r.where;
                r.where = pt => (wh?.Invoke(pt) ?? 1) * Keep(pt.p);
            }
            LevelKit.ScatterDetails(ts, details, RouteDist, 1f, 150f);

            var boulders = LevelKit.ScatterPresets.Boulders(theme.key);
            var bw = boulders.where;
            var avoid = new List<(Vector2 c, float r)>
            {
                (Spawn, 14), (Lookout, 6), (Site1, 26), (Site3, 26), (Site4, 24), (Site5, 10), (RoadsideAt, 12), (PortalAt, 12), (LiftXZ, 14), (PoolC, 12),
                (NorthHead, 10), (SouthHead, 10), (P(CacheATh, 66f), 8), (Vector2.zero, RimR + 6),
            };
            boulders.where = pt =>
            {
                float ins = Inside(pt.p);
                bool rim = ins > 3f && ins < 8f && pt.p.magnitude > T1In + 2f;
                bool crest = ins < -18f;
                if (!rim && !crest) return 0;
                foreach (var (c, rr) in avoid)
                    if (Vector2.Distance(pt.p, c) < rr) return 0;
                if (Polyline(pt.p, EastRamp).dist < EastRampHalf + 4f) return 0;
                foreach (var sp in SlantPaths)
                    if (Polyline(pt.p, sp).dist < 7f) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            LevelKit.ScatterProps(ts, props, boulders, new Rect(-150, -150, 300, 300), 10f, RouteDist);
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
            Mk("Site_1_Kiln", OnGround(Site1));
            Mk("Site_2_HangingForge", DeckFloor);
            Mk("Site_3_Bellows", OnGround(Site3));
            Mk("Site_4_GeyserAltar", OnGround(Site4));
            Mk("Site_5_MouldStore", OnGround(Site5));
            Mk("Site_Exit", OnGround(PortalAt));
            Mk("Landmark_HangingForge", new Vector3(0, DeckY + 3f, 0));
            Mk("Landmark_ExitGate", At(GateAt, T3Y + 4.5f));
            Mk("Lookout_WellRim", OnGround(Lookout));
            Mk("Lookout_Gate", OnGround(P(SpawnTh - 5f, 64.2f)));
            Mk("Lava_WellCentre", At(P(-110f, 16.5f), LavaY));
            // 冒烟套件用：甲板东口（击退带）、北链桥头 / 南链桥头、升降台上站栈桥头、西吊臂头
            Mk("Deck_EastGap", At(DeckPt(DeckHalf - 1.4f, 0), DeckY));
            Mk("Bridge_NorthHead", At(NorthHead, T1Y));
            Mk("Bridge_SouthHead", At(SouthHead, T1Y));
            Mk("Lift_TopLanding", At(P(LiftTh, T1In + 3f), T1Y));
            Mk("Arm_Tip", At(Dir2(ArmTh) * (ArmTo - 1.5f), DeckY));
        }

        // ───────────── 遭遇 ─────────────

        /// <summary>一个站位：名字、场地、位置（世界，地面 / 甲板面）、角色、lane、高台、散开、出场方式、辅助点（entry / dropFrom / gate 后的点）</summary>
        sealed class Station
        {
            public string name;
            public int site;
            public Vector3 at;
            public SG.StationRole role;
            public int lane;
            public bool elevated;
            public float spread = 2f;
            public SG.SpawnMode mode;
            public Vector3? aux;
            public Vector3 facing;
            public bool door;
        }

        static readonly List<Station> Stations = new();

        static void Add(string name, int site, Vector3 at, SG.StationRole role, int lane = 0, SG.SpawnMode mode = SG.SpawnMode.Appear, Vector3? aux = null,
            bool elevated = false, float spread = 2f, Vector3 facing = default, bool door = false) =>
            Stations.Add(new Station { name = name, site = site, at = at, role = role, lane = lane, mode = mode, aux = aux, elevated = elevated, spread = spread, facing = facing, door = door });

        /// <summary>
        /// 站位（ch3-v2 4.2 出场方式；S1 接口已落地，表现在 S1 阶段 2 接上——之前各方式退回现身，用的还是这些站位）。
        /// 每个场地的贴地站位都在自己那一层（不把地面敌人刷到上 / 下一层）；跨层压力交给飞行敌人和玩家自己下跳。
        /// </summary>
        static void DefineStations()
        {
            Stations.Clear();
            var up = Vector3.up;
            // ① 炮工坊窟（T1 东）
            var kilnMouth = OnGround(P(Site1Th, 56f));
            for (int i = 0; i < 3; i++)
                Add($"Enemy_1_Battery_{i + 1}", 1, OnGround(P(Site1Th - 2.5f + 2.5f * i, 79.5f)), SG.StationRole.Artillery, 0, SG.SpawnMode.Ambush, spread: 0.8f,
                    facing: kilnMouth - OnGround(P(Site1Th, 79.5f)));
            Add("Enemy_1_AssaultL", 1, OnGround(P(Site1Th - 12f, 64f)), SG.StationRole.Assault, 1);
            Add("Enemy_1_AssaultR", 1, OnGround(P(Site1Th + 5f, 64f)), SG.StationRole.Assault, 2);
            Add("Enemy_1_Front", 1, OnGround(P(Site1Th, 72f)), SG.StationRole.Auto, 0);
            Add("Enemy_1_GateL", 1, OnGround(P(Site1Th - 9f, 71f)), SG.StationRole.Assault, 1, SG.SpawnMode.Gate, OnGround(P(Site1Th - 12f, 75.5f)));
            Add("Enemy_1_GateR", 1, OnGround(P(Site1Th + 14f, 73f)), SG.StationRole.Flank, 2, SG.SpawnMode.Gate, OnGround(P(Site1Th + 13f, 76.8f)));
            Add("Enemy_1_Ember", 1, OnGround(P(-21f, 61f)), SG.StationRole.Assault, 1, SG.SpawnMode.Ember);
            Add("Enemy_1_Ember2", 1, OnGround(P(-5f, 67.5f)), SG.StationRole.Assault, 2, SG.SpawnMode.Ember);

            // ② 悬炉锻台（甲板 +17）：飞临（井口排烟孔方向）、马面从锻楼跃下、炭童从炉坛余烬起身
            var sky = new Vector3(0, T0Y + 18f, 0);
            int k = 0;
            foreach (var (lx, lz) in new[] { (6.5f, 5.5f), (-6.5f, -4.5f), (6.5f, -6.5f) })
            {
                var at = At(DeckPt(lx, lz), DeckY);
                Add($"Enemy_2_Fly_{++k}", 2, at, k == 1 ? SG.StationRole.Precision : SG.StationRole.Auto, k - 1, SG.SpawnMode.FlyIn,
                    sky + new Vector3(lx * 2.4f, 0, lz * 2.4f), elevated: k == 1, spread: 1.5f);
            }
            Add("Enemy_2_Perch", 2, At(DeckPt(TowerLocal), DeckY + TowerRise), SG.StationRole.Precision, 1, SG.SpawnMode.FlyIn, sky + Vector3.left * 18f, elevated: true, spread: 1.2f);
            Add("Enemy_2_Drop", 2, At(DeckPt(-2f, 5f), DeckY), SG.StationRole.Ranged, 0, SG.SpawnMode.Drop,
                At(DeckPt(TowerLocal), DeckY + TowerRise), spread: 1.2f);
            Add("Enemy_2_Drop2", 2, At(DeckPt(2.5f, 5f), DeckY), SG.StationRole.Ranged, 0, SG.SpawnMode.Drop, At(DeckPt(TowerLocal), DeckY + TowerRise), spread: 1.2f);
            Add("Enemy_2_EmberE", 2, At(DeckPt(5.6f, 0), DeckY), SG.StationRole.Assault, 1, SG.SpawnMode.Ember, spread: 1.2f);
            Add("Enemy_2_EmberS", 2, At(DeckPt(0, -5.6f), DeckY), SG.StationRole.Assault, 2, SG.SpawnMode.Ember, spread: 1.2f);
            Add("Enemy_2_Deck", 2, At(DeckPt(-7f, -2f), DeckY), SG.StationRole.Auto, 0, spread: 1.5f);
            Add("Enemy_2_Deck2", 2, At(DeckPt(6f, -8f), DeckY), SG.StationRole.Auto, 2, spread: 1.5f);

            // ③ 风箱窟（T2 西北）
            Add("Enemy_3_KilnDoor", 3, OnGround(P(Site3Th - 12f, 67.5f)), SG.StationRole.Assault, 0, SG.SpawnMode.Gate, OnGround(P(Site3Th - 12f, 73.5f)), spread: 1.5f);
            Add("Enemy_3_Catwalk", 3, OnGround(P(Site3Th + 13f, 72.3f)), SG.StationRole.Ranged, 0, SG.SpawnMode.Ambush, spread: 1f,
                facing: OnGround(P(Site3Th, 46f)) - OnGround(P(Site3Th + 13f, 72.3f)));
            Add("Enemy_3_FrontL", 3, OnGround(P(Site3Th - 14f, 55f)), SG.StationRole.Assault, 1);
            Add("Enemy_3_FrontR", 3, OnGround(P(Site3Th + 10f, 47.5f)), SG.StationRole.Flank, 2);
            Add("Enemy_3_Front", 3, OnGround(P(Site3Th, 47f)), SG.StationRole.Auto, 0);
            var bellowsTop = P(Site3Th, 64f);
            float bellowsTopY = T2Y + 5f * BellowsScale;
            Add("Enemy_3_DropL", 3, OnGround(P(Site3Th - 7f, 57.5f)), SG.StationRole.Artillery, 1, SG.SpawnMode.Drop, At(bellowsTop - Tan(Site3Th) * 4f, bellowsTopY));
            Add("Enemy_3_DropR", 3, OnGround(P(Site3Th + 7f, 58f)), SG.StationRole.Artillery, 2, SG.SpawnMode.Drop, At(bellowsTop + Tan(Site3Th) * 4f, bellowsTopY));

            // 路遇 · 熔瀑栈道（T2 西南，熔泉池边）：炭童从池里爬出来、毕方已栖在池边铁柱上
            foreach (var (dth, i) in new[] { (-6f, 1), (0f, 2), (6f, 3) })
                Add($"Enemy_R_Crawl_{i}", 9, OnGround(P(PoolTh + dth, 39.2f)), SG.StationRole.Assault, i - 1, SG.SpawnMode.LavaCrawl, At(P(PoolTh + dth * 0.6f, PoolR), PoolLevel));
            Add("Enemy_R_Perch", 9, OnGround(P(PoolTh + 9f, 38.5f)), SG.StationRole.Precision, 0, SG.SpawnMode.Ambush, elevated: true, spread: 1f);
            Add("Enemy_R_Walk", 9, OnGround(P(PoolTh - 4f, 37.5f)), SG.StationRole.Auto, 0, spread: 1.5f);

            // ④ 熔泉炉坛（T3 北半环）：飞鸦从悬炉底下盘出、傀儡 / 马面埋伏在吊臂台、精英铁牛从井底铸门走出（站位都避开四口熔泉和吊臂台的坡）
            var underDeck = new Vector3(0, DeckY - 6f, 0);
            Add("Enemy_4_FlyE", 4, OnGround(P(101f, 30f)), SG.StationRole.Auto, 2, SG.SpawnMode.FlyIn, underDeck + At(P(101f, 6f), 0));
            Add("Enemy_4_FlyN", 4, OnGround(P(128f, 30.5f)), SG.StationRole.Auto, 0, SG.SpawnMode.FlyIn, underDeck + At(P(128f, 6f), 0));
            Add("Enemy_4_FlyW", 4, OnGround(P(145f, 31.5f)), SG.StationRole.Auto, 1, SG.SpawnMode.FlyIn, underDeck + At(P(145f, 6f), 0));
            var craneTop = OnGround(P(CraneTh - 2f, 31.2f));
            Add("Enemy_4_Crane", 4, craneTop, SG.StationRole.Artillery, 0, SG.SpawnMode.Ambush, spread: 1f, facing: OnGround(Site4) - craneTop);
            Add("Enemy_4_Crane2", 4, OnGround(P(CraneTh + 5f, 31.2f)), SG.StationRole.Ranged, 0, SG.SpawnMode.Ambush, spread: 1f, facing: OnGround(Site4) - craneTop);
            Add("Enemy_4_Gate", 4, OnGround(P(GateTh, 30.5f)), SG.StationRole.Assault, 0, SG.SpawnMode.Gate, At(GateBehind, T3Y), spread: 1.5f, door: true);
            Add("Enemy_4_FrontW", 4, OnGround(P(145f, 31.5f)), SG.StationRole.Assault, 1);
            Add("Enemy_4_FrontN", 4, OnGround(P(128f, 30.5f)), SG.StationRole.Auto, 0);
            Add("Enemy_4_FrontE", 4, OnGround(P(101f, 30f)), SG.StationRole.Flank, 2);

            // ⑤ 铸范库（T2 东南，可选守军）
            Add("Enemy_5_Ranged", 5, OnGround(P(Site5Th - 3f, 44f)), SG.StationRole.Ranged, 0);
            Add("Enemy_5_Flank", 5, OnGround(P(Site5Th + 9f, 39f)), SG.StationRole.Flank, 1);
            Add("Enemy_5_Auto", 5, OnGround(P(Site5Th - 12f, 39.5f)), SG.StationRole.Auto, 2);
        }

        /// <summary>
        /// 遭遇（ch3-v2 5.2 场地表，编组库 S2 InfernoSquads）：四个必清场地任意顺序，路遇一处，⑤ 铸范库守军（可选、藏宝 B 惊动）。
        /// 难度由 RunPlan 给（3-2 = 2.76）；精英写死：② 精英马面·迅捷、④ 精英熔炉铁牛·狂暴，⑤ 精英马面·坚盾（可选）。
        /// </summary>
        static (SG.LevelObjective objective, SG.EncounterSite deck, SG.EncounterSite forge) BuildEncounters(Transform markers, SG.ForgeWellDirector director)
        {
            DefineStations();
            var root = new GameObject("Encounters").transform;
            Physics.SyncTransforms();
            SG.EncounterSite Site(int index, string title, Vector3 at, float trigger, float arena, SG.EncounterSpec spec, string reward)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<SG.EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = at;
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.requires = Array.Empty<SG.EncounterSite>();
                var list = new List<Transform>();
                foreach (var st in Stations)
                {
                    if (st.site != index) continue;
                    var a = SG.SpawnAnchor.Create(markers, st.name, st.at, st.role, st.lane, st.elevated, st.spread).Via(st.mode);
                    if (st.facing.sqrMagnitude > 0.01f) a.Facing(st.facing);
                    if (st.aux.HasValue)
                        switch (st.mode)
                        {
                            case SG.SpawnMode.FlyIn:
                            case SG.SpawnMode.LavaCrawl:
                                a.Entry(st.aux.Value);
                                break;
                            case SG.SpawnMode.Drop:
                                a.DropFrom(st.aux.Value);
                                break;
                            case SG.SpawnMode.Gate:
                                a.Gate(st.aux.Value, st.door ? director : null);
                                break;
                        }
                    list.Add(a.transform);
                }
                site.anchors = list.ToArray();
                return site;
            }

            // ① 炮工坊窟：G06 一窝蜂炮阵（炮仗 ×3 扎堆埋伏在炮台 + 炭童 ×4）→ G02 轻（祸斗 ×3 + 炭童 ×2，窟后炉道增援门）
            var s1 = Site(1, "炮工坊窟", OnGround(Site1), 25, 26, SG.EncounterSpec.Of(
                    G06(firecracker: 3, tantong: 4),
                    G02(huodou: 3, tantong: 2).After(1, 1.6f))
                .Gather(0.5f).Distance(10, 32), "weapon");
            // ② 悬炉锻台：G14 毕方鸦阵（毕方 ×2 + 飞鸦 ×4，飞临）→ G05 轻（精英马面·迅捷 + 马面 ×1 从锻楼跃下 + 炭童 ×3 从炉坛余烬起身）
            var w2b = G05(mamian: 2, huodou: 0, tantong: 0, eliteAffix: Swift).Plus(SG.EncounterSpec.E(Tantong, 3).Via(SG.SpawnMode.Ember));
            w2b.hint = "精英马面会把人往甲板缺口拖——缺口外就是熔岩井；先打锁芯，把炭童从缺口打下去";
            var s2 = Site(2, "悬炉锻台", At(Vector2.zero, DeckY), 16, 18, SG.EncounterSpec.Of(
                    G14(bifang: 2, fireCrow: 4),
                    w2b.After(1, 1.8f))
                .Gather(0.6f).Distance(6, 24), "scroll");
            s2.chestOffset = DeckFloor - At(Vector2.zero, DeckY);
            // ③ 风箱窟：G08 鼓风铁牛（铁牛第一次出现，不配精英）→ G06 轻（炮仗 ×2 从风箱顶跃下 + 炭童 ×2）
            var w3b = G06(firecracker: 2, tantong: 2).Named("风箱顶炮仗");
            foreach (var e in w3b.entries)
                if (e.enemy == Firecracker) e.via = SG.SpawnMode.Drop;
            var s3 = Site(3, "风箱窟", OnGround(Site3), 22, 26, SG.EncounterSpec.Of(
                    G08(ironOx: 1, mamian: 1, tantong: 3),
                    w3b.After(1, 1.6f))
                .Gather(0.5f).Distance(10, 30), "weapon:min=1");
            s3.chestOffset = At(P(Site3Th, 50f) - Site3, 0);
            // 路遇 · 熔瀑栈道：G11 熔流伏兵（炭童 ×5 从熔泉池爬出 + 毕方 ×1 栖在池边铁柱）
            var road = Site(9, "熔瀑栈道", OnGround(RoadsideAt), 12, 16, SG.EncounterSpec.Of(G11(tantong: 5, bifang: 1)).Gather(0.3f).Distance(6, 24), "");
            road.AsRoadside(12f, 16f);
            // ④ 熔泉炉坛：G07 神火鸦群（飞鸦 ×5 从悬炉底下盘出 + 炮仗 ×1 埋伏在吊臂台）→ G08 精英（精英铁牛·狂暴从井底铸门走出 + 马面 ×1 + 炭童 ×3）
            var w4b = G08(ironOx: 1, mamian: 1, tantong: 3, eliteAffix: Frenzied).Named("铸门铁牛");
            w4b.hint = "井底铸门开了——精英铁牛低头走出来；先缴马面的索，再顶着吸力打敞开的炉门";
            var s4 = Site(4, "熔泉炉坛", OnGround(Site4), 16, 24, SG.EncounterSpec.Of(
                    G07(fireCrow: 5, firecracker: 1),
                    w4b.After(1, 2f))
                .Gather(1f).Distance(8, 32), "upgrade");
            // ⑤ 铸范库守军（可选，藏宝 B 惊动）
            var s5 = Site(5, "铸范库守军", OnGround(Site5), 14, 18, SG.EncounterSpec.Of(
                    SG.EncounterSpec.Wave("铸范库守军", SG.EncounterSpec.E(Mamian, 1).Elite(Shielded), SG.EncounterSpec.E(Tantong, 2), SG.EncounterSpec.E(Huodou, 1)))
                .Gather(0.4f).Distance(8, 26), "");
            s5.autoTrigger = false;
            s5.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<SG.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "下到铸神井底";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;

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
            Cache("Cache A · 炼渣龛", "炼渣里的金块", P(CacheATh, 68.5f), P(CacheATh, 56f), "coins", null, 14);
            Cache("Cache B · 铸范库", "铸范库秘藏", P(Site5Th - 4f, 43.5f), Site5, "scroll", s5, 14);
            return (objective, s2, s4);
        }

        /// <summary>
        /// ④ 熔泉炉坛的四口间歇熔泉（S3 <see cref="LevelKit.PlaceLavaGeyser"/>）：贴着井沿（r 23.5），周期 8 s、相位错开 1/4——交战时每 2 s 有一口在喷；
        /// 只在 ④ 交战时按周期喷（肃清后停，目标完成时由 ForgeWellDirector 齐喷一次），射爆岩壳随时能喷。被掀起来的敌人往外飘，常常落进熔岩井
        /// </summary>
        static SG.LavaGeyser[] BuildGeysers(Transform world, Transform markers, SG.EncounterSite forgeSite)
        {
            var root = new GameObject("Lava Geysers").transform;
            root.SetParent(world, false);
            var list = new List<SG.LavaGeyser>();
            for (int i = 0; i < GeyserThetas.Length; i++)
            {
                var at = OnGround(P(GeyserThetas[i], GeyserR));
                var g = LevelKit.PlaceLavaGeyser(Dir, $"Lava Geyser {i + 1}", root, at, new LevelKit.GeyserSpec
                {
                    period = 8f, phase = i * 0.25f, startActive = false, activeSite = forgeSite, radius = 3f, height = 9f, seed = i + 1,
                });
                list.Add(g);
                var m = new GameObject($"Geyser_{i + 1}");
                m.transform.SetParent(markers, false);
                m.transform.position = at;
            }
            return list.ToArray();
        }

        /// <summary>出口传送门：井底铸门前（龛口），面朝井心；关卡目标完成后升起、落清关宝箱（门框就是铸门，不另立石框）</summary>
        static void BuildExit(SG.LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<SG.ExitPortal>();
            var face = new Vector3(-Dir2(GateTh).x, 0, -Dir2(GateTh).y);
            portal.transform.SetPositionAndRotation(OnGround(PortalAt), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = false;
        }

        static void WireDirector(SG.ForgeWellDirector d, SG.EncounterSite deckSite, SG.EncounterSite forgeSite, SG.LevelObjective objective, SG.BreakableSpan north,
            Transform belly, Transform hook, Transform gate, NavMeshObstacle carve, GameObject[] glow, Light light)
        {
            d.deckSite = deckSite;
            d.forgeSite = forgeSite;
            d.objective = objective;
            d.northBridge = north;
            d.collapseFrom = north ? north.segments.Length - 1 : -1;
            d.bridgeMid = (At(NorthHead, T1Y) + At(DeckPt(0, DeckHalf), DeckY)) * 0.5f;
            d.forgeBelly = belly;
            d.hook = hook;
            d.hookUp = hook ? hook.position : Vector3.zero;
            d.hookDown = At(Dir2(ArmTh) * (ArmTo + 0.6f), T2Y + 1.6f);
            d.gate = gate;
            d.gateCarve = carve;
            d.gateGlow = glow;
            d.gateLight = light;
        }

        // ───────────── 验收（本关专有）─────────────

        /// <summary>升降台：两站高差、接上铜锣、下站 / 上站栈桥都在导航网格上且从出生点走得到、竖直通道净空、上站与栈桥齐平</summary>
        static void CheckLift(LevelKit.Report rep, SG.MovingPlatform lift, SG.SceneActivator gong)
        {
            rep.Section("炉坛升降台（MovingPlatform · OnRide）");
            var low = lift.path[0];
            var high = lift.path[^1];
            float rise = high.y - low.y;
            rep.Line($"下站 y {low.y:F2} → 上站 y {high.y:F2}（升 {rise:F1} m，{rise / Mathf.Max(0.1f, lift.speed):F1} s + 加减速），开局{(lift.startPowered ? "通电" : "没通电")}，" +
                     $"铜锣 {(gong && gong.targets.Contains(lift) ? "接上了" : "没接")}");
            if (rise < 20f) rep.Fail($"升降台只升 {rise:F1} m（应约 22 m：井底 → T1）");
            if (!gong || !gong.targets.Contains(lift)) rep.Fail("升降台没有接上井底的铜锣");
            Physics.SyncTransforms();
            if (!LevelContext.NavPoint(OnGround(Spawn), 4f, out var spawnNav)) rep.Fail("出生点附近没有 NavMesh");
            else
                foreach (var (what, at) in new[] { ("下站台面", low), ("上站栈桥", At(P(LiftTh, T1In - 1.5f), high.y)) })
                {
                    if (!LevelContext.NavPoint(at, 1.5f, out var q)) rep.Fail($"升降台{what} 1.5 m 内没有 NavMesh");
                    else if (LevelContext.NavPath(spawnNav, q, out float len) != NavMeshPathStatus.PathComplete) rep.Fail($"出生点走不到升降台{what}");
                    else rep.Line($"✓ 出生点 → 升降台{what}：路径 {len:F0} m");
                }
            var own = new HashSet<Collider>(lift.GetComponentsInChildren<Collider>(true));
            var half = new Vector3(LiftDeck * 0.5f - 0.1f, 0.9f, LiftDeck * 0.5f - 0.1f);
            var rot = lift.deck ? lift.deck.rotation : Quaternion.identity;
            var blockers = new HashSet<string>();
            for (float y = low.y + 1.2f; y <= high.y + 1.0f; y += 0.5f)
                foreach (var c in Physics.OverlapBox(new Vector3(low.x, y, low.z), half, rot, LevelContext.BlockMask, QueryTriggerInteraction.Ignore))
                    if (!own.Contains(c) && c is not TerrainCollider) blockers.Add(c.name);
            if (blockers.Count > 0) rep.Fail($"升降台竖直通道被挡：{string.Join("、", blockers.Take(4))}");
            else rep.Line("✓ 升降台竖直通道（台面以上 1.8 m 的整段）没有碰撞体挡着");
            float gangTop = LevelContext.GroundY(At(P(LiftTh, LiftR + LiftDeck * 0.5f + 1f), high.y + 0.5f), 1.5f);
            if (Mathf.Abs(gangTop - high.y) > 0.1f) rep.Fail($"上站台面 y {high.y:F2} 和栈桥 y {gangTop:F2} 没对齐");
            else rep.Line($"✓ 上站台面与栈桥齐平（差 {Mathf.Abs(gangTop - high.y):F2} m）");
        }

        /// <summary>
        /// 链桥：两座桥都在导航网格上；北链桥塌了以后 T1 / T3 / 甲板仍然连通——把北链桥的桥板碰撞关掉、重烘一份临时导航网格，
        /// 查甲板 ↔ T1（南链桥）、T3 ↔ 甲板（经南链桥）、T3 ↔ T1（升降台不在网格上，走熔瀑栈道 + 东壁栈架绕回）都走得通；查完删掉临时网格、恢复碰撞
        /// </summary>
        static void CheckBridges(LevelKit.Report rep, SG.BreakableSpan north, SG.BreakableSpan south, SG.MovingPlatform lift)
        {
            rep.Section("链桥（北链桥塌后仍连通）");
            var deck = DeckFloor;
            var t1North = At(P(NorthBridgeTh, CliffT1In + 4f), T1Y);
            var t1South = At(P(SouthBridgeTh, T1In + 4f), T1Y);
            var t3 = OnGround(Site4);
            var spawn = OnGround(Spawn);
            foreach (var (what, a, b) in new[] { ("北链桥头 → 甲板", t1North, deck), ("南链桥头 → 甲板", t1South, deck) })
            {
                if (!LevelContext.NavPoint(a, 2f, out var pa) || !LevelContext.NavPoint(b, 2f, out var pb)) rep.Fail($"{what}：两头不在导航网格上");
                else if (LevelContext.NavPath(pa, pb, out float len) != NavMeshPathStatus.PathComplete) rep.Fail($"{what} 不连通");
                else rep.Line($"✓ {what}：{len:F0} m");
            }
            // 北链桥塌了：关掉桥板碰撞，临时重烘
            var cols = north ? north.GetComponentsInChildren<Collider>(true).Where(c => c.enabled).ToList() : new List<Collider>();
            foreach (var c in cols) c.enabled = false;
            var temp = new GameObject("NavMesh (北链桥塌后 · 临时)");
            NavMeshDataInstance inst = default;
            try
            {
                var settings = NavMesh.GetSettingsByID(0);
                var sources = new List<NavMeshBuildSource>();
                var markups = new List<NavMeshBuildMarkup>();
                foreach (var mod in Object.FindObjectsByType<NavMeshModifier>(FindObjectsInactive.Exclude))
                    if (mod.ignoreFromBuild) markups.Add(new NavMeshBuildMarkup { root = mod.transform, ignoreFromBuild = true });
                var bounds = new Bounds(new Vector3(0, 10, 0), new Vector3(Size.x, 90, Size.y));
                int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
                int mask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
                NavMeshBuilder.CollectSources(bounds, mask, NavMeshCollectGeometry.PhysicsColliders, 0, markups, sources);
                var data = NavMeshBuilder.BuildNavMeshData(settings, sources, bounds, Vector3.zero, Quaternion.identity);
                // 原来的网格先拿掉（同一代理类型会叠在一起），查完再放回
                var surfaces = Object.FindObjectsByType<NavMeshSurface>(FindObjectsInactive.Exclude).Where(s => s.agentTypeID == 0).ToList();
                foreach (var s in surfaces) s.RemoveData();
                inst = NavMesh.AddNavMeshData(data);
                try
                {
                    var checks = new[]
                    {
                        ("甲板 → T1（南链桥）", deck, t1South),
                        ("T3 ④ → 甲板（熔瀑栈道 / 东壁栈架 → T1 → 南链桥）", t3, deck),
                        ("T3 ④ → T1 北链桥头（走路绕回，升降台是捷径）", t3, t1North),
                        ("出生点 → 甲板", spawn, deck),
                    };
                    foreach (var (what, a, b) in checks)
                    {
                        if (!LevelContext.NavPoint(a, 3f, out var pa) || !LevelContext.NavPoint(b, 3f, out var pb)) rep.Fail($"北链桥塌后 · {what}：两头不在导航网格上");
                        else if (LevelContext.NavPath(pa, pb, out float len) != NavMeshPathStatus.PathComplete) rep.Fail($"北链桥塌后 · {what} 不连通");
                        else rep.Line($"✓ 北链桥塌后 · {what}：{len:F0} m");
                    }
                    if (LevelContext.NavPoint(At(P(NorthBridgeTh, 26f), DeckY + 0.5f), 1f, out _)) rep.Fail("北链桥塌后桥面上还有导航网格（桥板碰撞没关掉？）");
                    else rep.Line("✓ 北链桥塌后桥面上没有导航网格");
                }
                finally
                {
                    NavMesh.RemoveNavMeshData(inst);
                    foreach (var s in surfaces) s.AddData();
                }
            }
            catch (Exception e)
            {
                rep.Fail($"北链桥塌后的连通检查出错：{e.Message}");
                Debug.LogException(e);
            }
            finally
            {
                foreach (var c in cols) c.enabled = true;
                Object.DestroyImmediate(temp);
                Physics.SyncTransforms();
            }
            rep.Line($"北链桥 {(north ? north.segments.Length : 0)} 段（{(north ? north.triggers.ToString() : "无")}），南链桥 {(south ? south.segments.Length : 0)} 段（{(south ? south.triggers.ToString() : "无")}，常设）；" +
                     $"升降台 {lift.path[0].y:F1} ↔ {lift.path[^1].y:F1}（回程捷径，导航网格按下站烘，不算连通）");
        }

        /// <summary>
        /// 悬炉甲板（规则集的高差 / 掩体按场地圆量，甲板下面是熔岩井接人板，量不准）：在甲板上逐格打射线，只认甲板本层——
        /// 甲板 / 炉坛台阶 / 锻楼三层的面积、俯射层占比、全遮（≥ 2.6 m 的炉坛、链柱、锻楼）几处、缺口几处（击退带）
        /// </summary>
        static void CheckDeck(LevelKit.Report rep)
        {
            rep.Section("② 悬炉锻台（甲板本层）");
            Physics.SyncTransforms();
            float floor = 0, step = 0, over = 0;
            const float cell = 0.5f;
            for (float x = -DeckHalf; x <= DeckHalf; x += cell)
            for (float z = -DeckHalf; z <= DeckHalf; z += cell)
            {
                var q = DeckPt(x, z);
                if (!Physics.Raycast(At(q, DeckY + 8f), Vector3.down, out var hit, 12f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (hit.normal.y < 0.7f) continue;
                float dh = hit.point.y - DeckY;
                if (dh < -0.3f) continue;
                if (dh < 1f) floor += cell * cell;
                else if (dh < 2.5f) step += cell * cell;
                else if (dh < 4.6f) over += cell * cell;
            }
            float total = floor + step + over;
            string msg = $"甲板 {floor:F0} m² · 台阶（炉坛 +1.4）{step:F0} m² · 俯射（锻楼 +3.5）{over:F0} m²，俯射占 {over / Mathf.Max(1, total):P0}";
            if (floor < 300 || step < 20 || over < 20) rep.Fail($"{msg} —— 三层不全");
            else rep.Line($"✓ {msg}（3 层）");
            int tall = Physics.OverlapBox(At(Vector2.zero, DeckY + 2.2f), new Vector3(DeckHalf, 0.4f, DeckHalf), Quaternion.Euler(0, DeckYaw, 0), SG.Layers.WorldMask,
                QueryTriggerInteraction.Ignore).Count(c => c is not TerrainCollider && !c.name.StartsWith("Tower "));
            rep.Line($"{(tall >= 6 ? "✓" : "·")} 甲板上 2.2 m 高处能全遮的 {tall} 处（炉坛熔炉、四座链柱台、两段铁板屏风；锻楼细腿、铁梯坡不算；ch3-v2 2.6 要求场地 ≥ 6 处全遮）");
            if (tall < 6) rep.Fail($"甲板上能全遮的东西只有 {tall} 处（< 6）");
            int gaps = 0;
            foreach (var (gx, gz) in new[] { (1f, 0f), (-1f, 0f), (0f, 1f), (0f, -1f) })
            {
                var probe = At(DeckPt(gx * (KerbEdge - KerbT * 0.5f), gz * (KerbEdge - KerbT * 0.5f)), DeckY + 0.3f);
                if (!Physics.CheckSphere(probe, 0.2f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)) gaps++;
            }
            rep.Line($"{(gaps == 4 ? "✓" : "·")} 矮栏缺口 {gaps}/4（北 / 南接链桥、西接吊臂、东口直通熔岩井）");
            if (gaps < 4) rep.Fail($"甲板矮栏缺口只有 {gaps} 处（应为 4）");
            // 东口外：正下方是熔岩井
            var east = DeckPt(DeckHalf + 1.5f, 0);
            bool lavaBelow = east.magnitude < WellR - 1f;
            rep.Line($"{(lavaBelow ? "✓" : "✗")} 东口外 1.5 m（离井心 {east.magnitude:F1} m）正下方是熔岩井（r {WellR:F0}）");
            if (!lavaBelow) rep.Fail("甲板东口外不是熔岩井（击退落井不成立）");
        }

        /// <summary>
        /// 各战斗场地本层的量（规则集按场地圆量，会混进上 / 下层）：可站立格只认场地那一层（± 6 m），熔岩占比、
        /// 可站立格离最近的全遮（≥ 1.7 m 的陡面）≤ 8 m 的比例（S5 CoverReach 落地前自己量）
        /// </summary>
        static void CheckSiteMetrics(LevelKit.Report rep)
        {
            rep.Section("场地本层（熔岩占比 / 掩体可达，S5 落地前自查）");
            var pools = Object.FindObjectsByType<SG.LavaVolume>(FindObjectsInactive.Exclude).Where(v => v.shape == SG.LavaShape.Box).ToArray();
            foreach (var (name, c, size, floorY) in new[]
                     {
                         ("① 炮工坊窟", Site1, 48f, T1Y), ("② 悬炉锻台", Site2, 30f, DeckY), ("③ 风箱窟", Site3, 46f, T2Y), ("④ 熔泉炉坛", Site4, 40f, T3Y),
                     })
            {
                float R = size * 0.5f;
                int stand = 0, lava = 0, near = 0;
                const float cell = 1f;
                var walls = new List<Vector2>();
                // 先找全遮：在场地层 + 1.7 m 高处 8 向打 1.5 m 射线打到陡面的格
                for (float x = -R; x <= R; x += cell)
                for (float z = -R; z <= R; z += cell)
                {
                    var q = c + new Vector2(x, z);
                    if (new Vector2(x, z).magnitude > R) continue;
                    if (!Physics.Raycast(At(q, floorY + 6f), Vector3.down, out var hit, 12f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    if (hit.point.y > floorY + 6f) continue;
                    if (hit.point.y < floorY - 3f || hit.normal.y < 0.7f)
                    {
                        if (q.magnitude < WellR && hit.point.y < floorY - 3f) { stand++; lava++; }
                        continue;
                    }
                    stand++;
                    bool lavaHere = false;
                    foreach (var v in pools)
                    {
                        var lp = v.transform.InverseTransformPoint(hit.point);
                        if (Mathf.Abs(lp.x) < v.size.x * 0.5f && Mathf.Abs(lp.z) < v.size.y * 0.5f && hit.point.y < v.transform.position.y + 0.3f) lavaHere = true;
                    }
                    if (lavaHere) lava++;
                    for (int k = 0; k < 8; k++)
                    {
                        var d = Quaternion.Euler(0, k * 45, 0) * Vector3.forward;
                        if (Physics.Raycast(hit.point + Vector3.up * 1.7f, d, out var w, 1.5f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore) && w.normal.y < 0.5f)
                        {
                            walls.Add(q);
                            break;
                        }
                    }
                }
                for (float x = -R; x <= R; x += cell)
                for (float z = -R; z <= R; z += cell)
                {
                    var q = c + new Vector2(x, z);
                    if (new Vector2(x, z).magnitude > R) continue;
                    if (!Physics.Raycast(At(q, floorY + 6f), Vector3.down, out var hit, 12f, SG.Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    if (hit.point.y > floorY + 6f || hit.point.y < floorY - 3f || hit.normal.y < 0.7f) continue;
                    foreach (var w in walls)
                        if ((w - q).sqrMagnitude <= 64f)
                        {
                            near++;
                            break;
                        }
                }
                int dry = Mathf.Max(1, stand - lava);
                float lavaShare = stand > 0 ? lava / (float)stand : 0, reach = near / (float)dry;
                string msg = $"{name}：本层可站立 {stand} m²，熔岩 {lava} m²（{lavaShare:P0}），离全遮 ≤ 8 m 的 {reach:P0}";
                bool bad = lavaShare > 0.35f || reach < 0.8f;
                if (bad) rep.Warn($"{msg} —— ch3-v2 2.9：熔岩 ≤ 35%、掩体可达 ≥ 80%");
                else rep.Line($"✓ {msg}");
            }
        }

        /// <summary>编组自查（S2 InfernoSquads.Check）：每波 ≤ 3 种、远程 ≤ 3、同时在场 ≤ 10；必清只数、精英数</summary>
        static void CheckSquads(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Section("编组（S2 自查）");
            var sites = Object.FindObjectsByType<SG.EncounterSite>(FindObjectsInactive.Include).Where(s => s.gameObject.scene == scene).OrderBy(s => s.name).ToArray();
            int required = 0, elites = 0;
            foreach (var s in sites)
            {
                int bad = Check(s.spec, s.title, rep.Fail);
                int n = s.spec.waves.Sum(w => w.entries.Sum(e => e.count));
                int el = s.spec.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count));
                if (!s.optional) { required += n; elites += el; }
                rep.Line($"{(bad == 0 ? "✓" : "✗")} {s.title}（{(s.roadside ? "路遇" : s.optional ? "可选" : "必清")}）：{n} 只，精英 {el}；" +
                         string.Join("；", s.spec.waves.Select((w, i) => $"第 {i + 1} 波 {Describe(w)}")));
            }
            rep.Line($"必清合计 {required} 只、精英 {elites}（ch3-v2 7.4：约 43 / 2）");
            if (elites != 2) rep.Fail($"必清精英 {elites} 只（应为 2：② 精英马面·迅捷、④ 精英铁牛·狂暴）");
        }

        /// <summary>主线相邻路点走不通时：路径停在哪、离目标多远、目标附近最近的导航网格边；顺带打一条 ③ 窟口的径向高度剖面</summary>
        static void DiagnoseRoute(LevelKit.Report rep)
        {
            var spec = Spec();
            var route = spec.route;
            for (int i = 0; i + 1 < route.Count; i++)
            {
                if (!LevelContext.NavPoint(route[i].pos, 4f, out var a) || !LevelContext.NavPoint(route[i + 1].pos, 4f, out var b)) continue;
                var path = new NavMeshPath();
                NavMesh.CalculatePath(a, b, LevelContext.Walker, path);
                if (path.status == NavMeshPathStatus.PathComplete) continue;
                var last = path.corners.Length > 0 ? path.corners[^1] : a;
                string edge = NavMesh.FindClosestEdge(b, out var e, LevelContext.Walker) ? $"{LevelContext.At(e.position)}（{e.distance:F1} m）" : "无";
                rep.Line($"  诊断 {route[i].name} → {route[i + 1].name}：起 {LevelContext.At(a)} 终 {LevelContext.At(b)}，路径停在 {LevelContext.At(last)}（离终点 {Vector3.Distance(last, b):F1} m），" +
                         $"反向 {LevelContext.NavPath(b, a, out _)}，终点最近的网格边 {edge}");
            }
            var prof = new List<string>();
            for (float r = 36f; r <= 64f; r += 2f) prof.Add($"{r:0}:{GroundY(P(Site3Th, r)):F1}{(LevelContext.NavPoint(At(P(Site3Th, r), GroundY(P(Site3Th, r))), 0.6f, out _) ? "" : "×")}");
            rep.Line($"  ③ 窟口径向剖面（r:地面高，× = 0.6 m 内没有导航）：{string.Join(" ", prof)}");
        }

        static void DiagnoseAnchors(LevelKit.Report rep)
        {
            if (!LevelContext.NavPoint(OnGround(Spawn), 4f, out var spawn)) return;
            foreach (var st in Stations)
            {
                if (!LevelContext.NavPoint(st.at, 2.5f, out var at)) continue;
                var path = new NavMeshPath();
                NavMesh.CalculatePath(spawn, at, LevelContext.Walker, path);
                if (path.status == NavMeshPathStatus.PathComplete) continue;
                var last = path.corners.Length > 0 ? path.corners[^1] : spawn;
                string edge = NavMesh.FindClosestEdge(at, out var e, LevelContext.Walker) ? $"{LevelContext.At(e.position)}（{e.distance:F1} m）" : "无";
                rep.Line($"  诊断 {st.name}：路径 {path.corners.Length} 个拐点，停在 {LevelContext.At(last)}（离锚点 {Vector3.Distance(last, at):F1} m）；" +
                         $"反向 {LevelContext.NavPath(at, spawn, out _)}；最近的导航网格边 {edge}");
            }
        }

        /// <summary>场地中心都在和出生点连通的人形导航网格上、必清场地两两走得通（同旧版，机器人打完一个直接去下一个，顺序不固定）</summary>
        /// <summary>
        /// 没坡的台阶（① 炮台前沿、③ 风箱侧台、④ 炉坛，+1.3 / +1.4 m）：玩家单跳上得去、敌人上不去——台顶不进导航（NotWalkable 体块）。
        /// 不然台顶是一块导航孤岛：玩家站上去时场地的出生站位都「走不到玩家」（待出场的要等 6 s 才放宽），被瞬移 / 兜底采样到台顶的敌人也下不来。
        /// 体块从台脚上 0.7 m 起（台下的地面不受影响），背后多 noNavBack（① 前沿背后就是炮台的台脚，不多盖，不碰炮台和它的坡），四周多 0.3 m（台沿的陡坡）
        /// </summary>
        static void BuildStepNoNav(Transform world)
        {
            foreach (var pl in Platforms)
            {
                if (!pl.noNav) continue;
                float back = pl.noNavBack;
                float lr0 = -pl.halfR - 0.3f, lr1 = pl.halfR + back, y0 = pl.baseY + 0.7f, y1 = pl.top + 2.2f;
                var c = P(pl.th, pl.r + (lr0 + lr1) * 0.5f);
                var radial = Dir2(pl.th);
                var go = new GameObject($"NoNav · {pl.name}");
                go.transform.SetParent(world, false);
                go.transform.SetPositionAndRotation(new Vector3(c.x, (y0 + y1) * 0.5f, c.y), Quaternion.LookRotation(new Vector3(radial.x, 0, radial.y)));
                var v = go.AddComponent<NavMeshModifierVolume>();
                v.size = new Vector3((pl.halfT + 0.3f) * 2f, y1 - y0, lr1 - lr0);
                v.center = Vector3.zero;
                v.area = 1;
            }
        }

        /// <summary>每座俯射台 / 台阶的台顶：有坡的要和出生点连通；没坡的要么不进导航（noNav），要么连通——不许有导航孤岛</summary>
        static void CheckSteps(LevelKit.Report rep)
        {
            rep.Section("俯射台 / 台阶（导航孤岛）");
            var filter = SG.LavaField.WalkerFilter();
            if (!NavMesh.SamplePosition(OnGround(Spawn), out var start, 4f, filter))
            {
                rep.Fail("出生点附近没有导航网格");
                return;
            }
            var path = new NavMeshPath();
            foreach (var pl in Platforms)
            {
                var c = P(pl.th, pl.r);
                var top = new Vector3(c.x, pl.top, c.y);
                bool onTop = NavMesh.SamplePosition(top, out var hit, 1.2f, filter) && Mathf.Abs(hit.position.y - pl.top) < 0.5f;
                string kind = pl.ends.Length > 0 ? $"{pl.ends.Length} 道坡" : "没坡";
                if (!onTop)
                {
                    if (pl.ends.Length > 0) rep.Fail($"{pl.name}（{kind}）：台顶没有导航网格");
                    else rep.Line($"✓ {pl.name}（{kind}，+{pl.top - pl.baseY:F1} m）：台顶不进导航（玩家跳上去，敌人在台下）");
                    continue;
                }
                NavMesh.CalculatePath(start.position, hit.position, filter, path);
                bool linked = path.status == NavMeshPathStatus.PathComplete;
                if (linked) rep.Line($"✓ {pl.name}（{kind}，+{pl.top - pl.baseY:F1} m）：台顶和出生点连通");
                else rep.Fail($"{pl.name}（{kind}，+{pl.top - pl.baseY:F1} m）：台顶是导航孤岛（玩家站上去时出生站位都走不到玩家）");
            }
        }

        static void CheckSiteCenters(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Section("场地中心连通（NavMesh，人形代理，不蹚熔岩）");
            var filter = SG.LavaField.WalkerFilter(SG.LavaField.DryAreaMask);
            if (!NavMesh.SamplePosition(OnGround(Spawn), out var start, 4f, filter))
            {
                rep.Fail("出生点附近没有导航网格");
                return;
            }
            var path = new NavMeshPath();
            static string F(Vector3 v) => $"({v.x:F0}, {v.y:F1}, {v.z:F0})";
            var sites = Object.FindObjectsByType<SG.EncounterSite>(FindObjectsInactive.Include).Where(s => s.gameObject.scene == scene).OrderBy(s => s.name).ToArray();
            var at = new Dictionary<SG.EncounterSite, Vector3>();
            foreach (var site in sites)
            {
                var c = site.transform.position;
                if (!NavMesh.SamplePosition(c, out var hit, 8f, filter))
                {
                    rep.Fail($"{site.title}：中心 {F(c)} 8 m 内没有人形导航网格");
                    continue;
                }
                at[site] = hit.position;
                NavMesh.CalculatePath(start.position, hit.position, filter, path);
                if (path.status == NavMeshPathStatus.PathComplete) rep.Line($"✓ {site.title}：中心 {F(c)} → 网格 {F(hit.position)}，和出生点连通");
                else rep.Fail($"{site.title}：中心 {F(c)} 和出生点不连通（{path.status}）");
            }
            var required = sites.Where(s => !s.optional && at.ContainsKey(s)).ToArray();
            int pairs = 0, broken = 0;
            foreach (var a in required)
                foreach (var b in required)
                {
                    if (a == b) continue;
                    pairs++;
                    NavMesh.CalculatePath(at[a], at[b], filter, path);
                    if (path.status == NavMeshPathStatus.PathComplete) continue;
                    broken++;
                    var stop = path.corners.Length > 0 ? path.corners[^1] : at[a];
                    rep.Fail($"{a.title} → {b.title} 不连通（{path.status}，停在 {F(stop)}）");
                }
            if (broken == 0) rep.Line($"✓ 必清场地两两 {pairs} 条（双向）都走得通");
            // T2 环 / T1 环逐段（每 10°）查连通：断在哪一段
            foreach (var (ring, r, y, from, to) in new[] { ("T2", 39.5f, T2Y, 80f, 375f), ("T1", 54f, T1Y, -200f, 112f) })
            {
                var cuts = new List<string>();
                for (float th = from; th + 10f <= to; th += 10f)
                {
                    var a = At(P(th, r), y);
                    var b = At(P(th + 10f, r), y);
                    if (!NavMesh.SamplePosition(a, out var ha, 3f, filter) || !NavMesh.SamplePosition(b, out var hb, 3f, filter))
                    {
                        cuts.Add($"θ {th:0}–{th + 10:0}（没有网格）");
                        continue;
                    }
                    NavMesh.CalculatePath(ha.position, hb.position, filter, path);
                    float len = 0;
                    for (int k = 0; k + 1 < path.corners.Length; k++) len += Vector3.Distance(path.corners[k], path.corners[k + 1]);
                    if (path.status != NavMeshPathStatus.PathComplete) cuts.Add($"θ {th:0}–{th + 10:0}（{path.status}，停在 {F(path.corners.Length > 0 ? path.corners[^1] : ha.position)}）");
                    else if (len > 40f) cuts.Add($"θ {th:0}–{th + 10:0}（绕路 {len:F0} m）");
                }
                rep.Line($"· {ring} 环逐段（r {r:0}）：{(cuts.Count == 0 ? "全通" : string.Join("；", cuts))}");
            }
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；顺带重新生成 GameDatabase</summary>
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
            int sites = Count<SG.EncounterSite>(), caches = Count<SG.CachePOI>(), portals = Count<SG.ExitPortal>(), lava = Count<SG.LavaVolume>(),
                lifts = Count<SG.MovingPlatform>(), spans = Count<SG.BreakableSpan>(), directors = Count<SG.ForgeWellDirector>(), geysers = Count<SG.LavaGeyser>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 路遇 1 + 可选 1），藏宝 {caches}，出口 {portals}，熔岩 {lava}（熔岩井 + 熔泉池 + 两道铸槽），升降台 {lifts}，链桥 {spans}，演出 {directors}，间歇熔泉 {geysers}");
            if (geysers != 4) rep.Fail($"间歇熔泉有 {geysers} 口（应为 4：④ 熔泉炉坛）");
            if (sites != 6) rep.Fail($"遭遇场地有 {sites} 个（应为 6）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 个（应为 2）");
            if (portals != 1) rep.Fail($"出口传送门有 {portals} 个（应为 1）");
            if (lava != 4) rep.Fail($"熔岩有 {lava} 片（应为 4：熔岩井、熔泉池、① / ③ 铸槽）");
            // 击退带：每个战斗场地一个 Knock_Edge（岸上 → 朝前 1.5 m 是熔岩）
            var vols = Object.FindObjectsByType<SG.LavaVolume>(FindObjectsInactive.Include).Where(v => v.gameObject.scene == scene).ToArray();
            for (int k = 1; k <= 4; k++)
            {
                var m = GameObject.Find($"Knock_Edge_{k}");
                if (!m)
                {
                    rep.Fail($"缺少 Knock_Edge_{k}（场地 {k} 的击退带）");
                    continue;
                }
                var q = m.transform.position + m.transform.forward * 2.6f;
                bool hitLava = vols.Any(v =>
                {
                    var lp = v.transform.InverseTransformPoint(q);
                    return v.shape == SG.LavaShape.Disc ? new Vector2(lp.x, lp.z).magnitude < v.size.x : Mathf.Abs(lp.x) < v.size.x * 0.5f && Mathf.Abs(lp.z) < v.size.y * 0.5f;
                });
                if (!hitLava) rep.Fail($"Knock_Edge_{k} 前面 2.6 m 不是熔岩");
                else rep.Line($"✓ Knock_Edge_{k}：岸上 {LevelContext.At(m.transform.position)} → 前面 2.6 m 是熔岩（击退带）");
            }
            if (lifts != 1) rep.Fail($"升降台有 {lifts} 座（应为 1）");
            if (spans != 2) rep.Fail($"链桥有 {spans} 座（应为 2）");
            if (directors != 1) rep.Fail($"ForgeWellDirector 有 {directors} 个（应为 1）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（L5）的声明：主线路点（ch3-v2 5.2 关键路线：出生 → 东旋坡 → ① → 北链桥 → ② → 西吊臂跳下 → ③ → 熔泉池边 → 熔瀑栈道 → ④ → 井底铸门）、
        /// 主线节拍（S5 PacingCheck）、坡度路径、地标视线、场地尺寸 / 掩体 / 层数阈值、S5 的掩体可达 / 熔岩占比阈值。
        /// ② 甲板下面是熔岩井接人板、规则集按场地圆量高差会量到它：甲板的层数 / 掩体由 <see cref="CheckDeck"/> 单独量。
        /// 占位：ART6 / v2 件到货前列清单（Warn），美术到齐后改 Fail。
        /// </summary>
        static LevelSpec Spec()
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec Site(string name, Vector3 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = c, size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat,
                    minCoverReach = combat ? 0.8f : -1f, maxLavaShare = combat ? 0.35f : -1f };
            // 悬炉的瞄点：炉坛熔炉顶（北桥头锻楼的台面在 +20.5，瞄甲板高度会被楼板挡住）
            var forge = new Vector3(0, DeckY + 5f, 0);
            // 主线 / 节拍走甲板空地上的路点；② 的场地圆用甲板中心（圆整个在熔岩井里，只量到甲板 + 接人板，不切进 T3 环台）
            var deck = DeckRoute;
            var armTip = At(Dir2(ArmTh) * (ArmTo - 1.5f), DeckY);
            var spec = new LevelSpec
                {
                    id = "3-2", title = "铸神井", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin, placeholders = PlaceholderPolicy.Warn,
                    sites =
                    {
                        Site("出生·井口栈台（缓冲）", G(Spawn), 20, combat: false),
                        Site("① 炮工坊窟", G(Site1), 48, cover: 6, layers: 3, overlook: true),
                        Site("② 悬炉锻台", At(Vector2.zero, DeckY), 30, cover: -1, layers: -1, overlook: false),
                        Site("③ 风箱窟", G(Site3), 46, cover: 6, layers: 3, overlook: true),
                        Site("④ 熔泉炉坛", G(Site4), 40, cover: 6, layers: 3, overlook: true),
                    },
                }
                .Route("出生·井口栈台", G(Spawn)).Route("东旋坡顶", G(EastRamp[0])).Route("东旋坡脚", G(EastRamp[^1]))
                .Route("① 炮工坊窟", G(Site1)).Route("北链桥头", At(NorthHead + Dir2(NorthBridgeTh) * 2f, T1Y)).Route("② 悬炉锻台", deck)
                .Route("西吊臂头", armTip).Route("③ 风箱窟", G(Site3)).Route("熔泉池边", G(RoadsideAt)).Route("熔瀑栈道顶", G(SlantPaths[1][^1]))
                .Route("熔瀑栈道脚", G(SlantPaths[1][0])).Route("④ 熔泉炉坛", G(Site4)).Route("井底铸门", G(PortalAt))
                .Beat("① 炮工坊窟", G(Site1), BeatKind.Fight, 23f)
                .Beat("北链桥 · 揭示悬炉", At(NorthHead, T1Y), BeatKind.Reveal)
                .Beat("② 悬炉锻台", deck, BeatKind.Fight, 14f)
                .Beat("西吊臂 · 下跳", armTip, BeatKind.Reveal)
                .Beat("③ 风箱窟", G(Site3), BeatKind.Fight, 20f)
                .Beat("路遇 · 熔瀑栈道", G(RoadsideAt), BeatKind.Roadside, 10f)
                .Beat("④ 熔泉炉坛", G(Site4), BeatKind.Fight, 14f)
                .Beat("井底铸门", G(PortalAt), BeatKind.Exit)
                .Sight("出生 → 悬炉", G(Spawn, 1.62f), forge, 9, HangingForgeId)
                .Sight("井口栈台 → 井底铸门", G(P(SpawnTh - 5f, 64.2f), 1.62f), At(GateAt, T3Y + 4.5f), 4, MoltenGateId)
                .Sight("井口眺台 → 熔岩井", G(Lookout, 1.62f), At(P(-110f, 16.5f), LavaY + 0.1f), 2)
                .Sight("① 窟口 → 悬炉", G(P(Site1Th, 56f), 1.62f), forge, 9, HangingForgeId)
                .Sight("北链桥头 → 悬炉", At(NorthHead, T1Y + 1.62f), forge, 9, HangingForgeId)
                .Sight("② 甲板 → ③ 窟口", At(DeckPt(-9f, -6f), DeckY + 1.62f), G(P(Site3Th, 50f), 1.5f), 3)
                .Sight("③ 窟口 → 熔瀑", G(P(Site3Th + 25f, 41f), 1.62f), At(P(PoolTh, T2Out + 0.6f), T2Y + 5f), 3)
                .Sight("④ 炉坛 → 井底铸门", G(Site4, 1.62f), At(GateAt, T3Y + 4.5f), 4, MoltenGateId)
                .Sight("④ 炉坛 → 升降台井架", G(P(20f, 24f), 1.62f), At(LiftXZ, HeadframeTop - 0.6f), 2);
            // ② 甲板下面整块是熔岩井：S5 的熔岩占比按列量会把甲板算成熔岩（89%），只报告；甲板本层的熔岩占比由 CheckSiteMetrics 量（0%）
            foreach (var st in spec.sites)
                if (st.name.StartsWith("②")) st.maxLavaShare = -1f;
            spec.slopePaths.Add(new SlopePath { name = "东旋坡（T0 → T1）", points = EastRamp, maxSlope = 16f });
            for (int i = 0; i < Slants.Length; i++) spec.slopePaths.Add(new SlopePath { name = Slants[i].name, points = SlantPaths[i] });
            for (int i = 0; i < Platforms.Length; i++)
                foreach (var path in PlatformRamps[i])
                    spec.slopePaths.Add(new SlopePath { name = $"{Platforms[i].name}坡道", points = path });
            return spec;
        }
    }
}
