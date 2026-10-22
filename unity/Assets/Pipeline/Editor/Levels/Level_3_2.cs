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
    /// 3-2 铸神井（docs/level-design/maps/3-2.md；parity 3.10「火山陷坑、螺旋岩台、升降台」、M32；Three.js inferno-2-v2 只取教学点）：
    /// 祝融铸神兵的竖井——一口火山口，井壁凿成一圈半的宽螺旋岩台（鹦鹉螺式：最上一圈从井口起就是 24 m 整宽，外沿跟着螺旋往里收），
    /// 每绕一圈降 14 m，陡坎爬不上去、可以跳下去；井底中央是熔岩井（地形洞 + 接人板），井心上空吊着悬炉，在哪一圈都看得见。
    /// 关卡坐标 = 世界 XZ，井心在原点，井底 y = 0；方位 φ 从井口栈台（正南）起逆时针（从上往下看）沿螺旋下行方向计，<see cref="P"/> 换成世界坐标。
    ///
    ///   出生 · 井口栈台 φ 0.03（+21 m，岩台开端，三面岩壁的龛）—— 眺台跳台 φ 0.055 俯瞰熔岩井
    ///   → ① 上环 · 炼渣回廊 φ 0.225（+18 m）：贴岩壁的回廊渣台 +3 m、炼渣堆
    ///   → 东横坡（φ 0.307 上环沿 ↔ φ 0.165 下环，沿陡坎脚斜下 12 m）→ ③ 下环 · 熔瀑 φ 0.135（+5 m）：熔瀑从井壁裂缝泻进熔岩池
    ///   → 下环继续下行到井底 φ 0.5 → ④ 井底炉坛（井沿栈桥伸进熔岩井，炉在桥头；两侧都是熔岩）、炉坛吊臂台 +3 m
    ///   → ② 上环 · 风口 φ 0.655（+12 m，西横坡从井底上来）：巨型风箱、风口检修台 +3.5 m
    ///   ⑤ 铸范库（φ 0.875 岩壁里凿的库，可选守军 + 藏宝 B）；藏宝 A 炼渣龛（φ 0.40）。
    ///   出口：④ 肃清后炉坛升降台通电，从井底直上 14 m 到上环 φ 0.5 的栈桥头，正对出口铸门（岩壁龛里的出口祭坛，上方崖顶立祝融像）。
    ///
    /// 边界（D14，没有空气墙）：螺旋外沿以外就是火山口内壁，从岩台面 7 m 内陡升到 40 m 的崖顶（比任何能站的面高 19 m 以上）；
    /// 井口栈台背后是螺旋开端的接缝岩壁。软边界沿同一个遮罩只做兜底。场景只放环境和标记（D17 / L1）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-2 铸神井（或 bridge.sh level 3-2）。冒烟：bridge.sh playtest map-3-2（Map32Suite）。
    /// </summary>
    [LevelBuilder("3-2", ScenePath)]
    public static class Level_3_2
    {
        public const string Dir = "Assets/Levels/L3_2_ForgeWell";
        public const string ScenePath = "Assets/Scenes/L3_2_ForgeWell.unity";
        const string Name = "L3_2";

        // 高度场里 Base 米 = 世界 y 0（井底）；火山口外的熔岩台地 / 远景地面在 PlainY
        const float Base = 6f, HeightRange = 56f, PlainY = 22f;
        static readonly Vector2 Origin = new(-256, -256), Size = new(512, 512);
        /// <summary>雾（主题默认 18 / 170 m）：调远，井口隔着 170 m 看得见对面的出口和祝融像</summary>
        const float FogStart = 40f, FogEnd = 320f;

        /// <summary>软边界（L3）：等值线在内壁坡脚外 1.8 m（壁面上），26 m 外兜底碰撞；白化用火狱烟尘</summary>
        static LevelKit.BoundarySpec Bounds
        {
            get
            {
                var b = LevelKit.BoundarySpec.Default;
                b.theme = "Inferno";
                return b;
            }
        }

        // ───────────── 螺旋岩台 ─────────────
        /// <summary>开端正南、逆时针下行；每圈降 14 m、一圈半到井底（井深 21 m）；岩台 24 m + 陡坎 4 m；开端内缘 68 m（外沿 92 → 一圈后 64 m）</summary>
        static readonly LevelKit.SpiralWellSpec Well = new()
        {
            center = Vector2.zero, startAngle = -90f, step = 14f, turns = 1.5f, ledge = 24f, riser = 4f, startRadius = 68f, wobble = 0.8f, seed = 32,
        };
        /// <summary>崖顶高、内壁坡面宽（米）；开端接缝两侧多宽（圈的分数）直接是整壁；藏宝龛 / 出口龛的侧壁坡面宽</summary>
        const float Crest = 40f, Face = 7f, SeamBand = 0.035f, NicheFace = 4.2f;

        static Vector2 P(float phi, float r) => LevelKit.SpiralPoint(Well, phi, r);
        static float Lv(float t) => LevelKit.SpiralLevel(Well, t);
        static float Inner(float t) => LevelKit.SpiralInner(Well, t);
        static float Outer(float phi) => LevelKit.SpiralOuter(Well, phi);
        static Vector2 Rad(float phi) => LevelKit.SpiralRadial(Well, phi);
        static Vector2 Tan(float phi) => LevelKit.SpiralTangent(Well, phi);
        /// <summary>让 Prefab 的 +Z 朝 d 的偏航角</summary>
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;
        /// <summary>让 Prefab 的 +X 朝 d 的偏航角</summary>
        static float YawX(Vector2 d) => Mathf.Atan2(-d.y, d.x) * Mathf.Rad2Deg;
        /// <summary>正面朝井心</summary>
        static float FaceIn(float phi) => YawZ(-Rad(phi));
        /// <summary>长边顺着螺旋（+X 沿下行方向）</summary>
        static float AlongT(float phi) => YawX(Tan(phi));

        // ───────────── 熔岩井 + 井底炉坛 ─────────────
        /// <summary>熔岩井（地形洞）半径、熔岩面、衬里外扩；炉坛栈桥（井沿伸进井里的岩舌，正北）半宽、桥头离井心</summary>
        const float WellR = 18f, LavaY = -2.5f, LiningPad = 0.6f, PierPhi = 0.5f, PierHalf = 4f, PierTip = 9f;
        /// <summary>悬炉（井心上空，底面 y）</summary>
        const float ForgeBaseY = 22f;

        // ───────────── 场地（φ, r）─────────────
        static readonly Vector2 Spawn = P(0.03f, 72.5f), Lookout = P(0.055f, 69f),
            Site1 = P(0.225f, 73.7f), Site2 = P(0.655f, 61.7f), Site3 = P(0.135f, 45f), Site4 = P(0.5f, 32f), Site5 = P(0.865f, 57f);

        // ── 炉坛升降台：井底 φ 0.5、r 46（陡坎脚在 50）→ 上环沿（内缘 54，+14 m）──
        static readonly Vector2 LiftXZ = P(0.5f, 46f);
        const float DeckSize = 7f, DeckThickness = 0.5f, GangwayFrom = 49.6f, GangwayTo = 56.5f, GangwayWidth = 5f, PostOffset = 5.3f, HeadframeTop = 24.2f;

        // ── 岩壁里凿的龛（φ, 深, 半宽）：藏宝 A 炼渣龛、铸范库（藏宝 B + ⑤ 守军）、出口铸门龛 ──
        static readonly (string name, float phi, float depth, float half)[] Niches =
        {
            ("藏宝 A · 炼渣龛", 0.40f, 12f, 4.5f), ("铸范库", 0.875f, 12f, 4.5f), ("出口铸门龛", 0.5f, 6f, 7f),
        };
        static readonly Vector2 CacheA = P(0.40f, Outer(0.40f) + 7f), CacheB = P(0.875f, Outer(0.875f) + 8.5f);
        /// <summary>出口祭坛（铸门龛里，正面朝井心）与门前</summary>
        static readonly Vector2 ShrineAt = P(0.5f, Outer(0.5f) + 3.2f), ExitFront = P(0.5f, Outer(0.5f) - 2f);
        /// <summary>崖顶的祝融像（出口正上方）</summary>
        static readonly Vector2 ZhurongAt = P(0.5f, Outer(0.5f) + 19f);
        const float ZhurongScale = 1.6f;

        // ── 熔瀑（③）：井壁裂缝泻下的熔岩落进陡坎脚的熔岩池 ──
        const float PoolPhi = 0.125f, PoolOffset = 3.2f, PoolHalfR = 3f, PoolHalfT = 8f, PoolBed = 1.4f, FallWidth = 7f;
        static readonly Vector2 PoolC = P(PoolPhi, Inner(PoolPhi) - 4f - PoolOffset);
        /// <summary>熔岩池面：池子下行端（最低）的下环岩台高 − 0.35 m</summary>
        static readonly float PoolLevel = Lv(1 + PoolPhi + PoolHalfT / (2 * Mathf.PI * (Inner(PoolPhi) - 4f - PoolOffset))) - 0.35f;

        // ── 横坡（沿陡坎脚斜着上下一圈，脚 → 顶）──
        /// <summary>横坡：名字、折线（世界 XZ，脚 → 顶，沿陡坎脚、最后一段跨过陡坎爬上岩台沿）、两端高、半宽</summary>
        static readonly (string name, Vector2[] path, float footY, float topY, float half)[] Ramps =
        {
            ("东横坡（③ 下环 ↔ ① 上环）", RampPath(0.165f, 0.307f), Lv(1.165f), Lv(0.307f), 3.5f),
            ("西横坡（井底 ↔ ② 上环）", RampPath(0.595f, 0.717f), 0f, Lv(0.717f), 3.5f),
        };

        /// <summary>横坡顶端比岩台沿多填 0.3 m：坡面在跨过陡坎时一直高过陡坎上沿的圆角，不在沿口出一道坎（只填不挖，顶上那 0.3 m 在 2.5 m 宽的坡肩里落回岩台面）</summary>
        const float RampOvershoot = 0.3f;

        /// <summary>横坡中线：φ 从脚到顶，前 85% 贴着陡坎脚（离上环内缘 8 → 6.5 m），最后 15% 跨过陡坎爬到岩台沿内 0.6 m</summary>
        static Vector2[] RampPath(float phiFoot, float phiTop)
        {
            const int N = 18;
            var o = new Vector2[N + 1];
            for (int i = 0; i <= N; i++)
            {
                float u = i / (float)N, phi = Mathf.Lerp(phiFoot, phiTop, u);
                o[i] = P(phi, Inner(phi) - RampOffset(u));
            }
            return o;
        }

        static float RampOffset(float u) => u < 0.85f ? Mathf.Lerp(8f, 6.5f, u / 0.85f) : Mathf.Lerp(6.5f, -0.6f, (u - 0.85f) / 0.15f);

        /// <summary>横坡上 φ 处的中线点（站位用）</summary>
        static Vector2 OnRamp(int i, float phi)
        {
            var (phiFoot, phiTop) = i == 0 ? (0.165f, 0.307f) : (0.595f, 0.717f);
            float u = Mathf.InverseLerp(phiFoot, phiTop, phi);
            return P(phi, Inner(phi) - RampOffset(u));
        }

        // ── 俯射台（贴岩壁 / 陡坎脚的方台，两头顺着螺旋各一道坡）──
        /// <summary>名字、中心 (φ, r)、径向 / 切向半宽、高出所在岩台、两头坡长</summary>
        static readonly (string name, float phi, float r, float halfR, float halfT, float rise, float ramp)[] Platforms =
        {
            ("① 回廊渣台", 0.245f, Outer(0.245f) - 5f, 4f, 8f, 3f, 12f),
            ("② 风口检修台", 0.675f, Outer(0.675f) - 5f, 4f, 8f, 3.5f, 12f),
            ("④ 炉坛吊臂台", 0.40f, 47f, 4f, 7f, 3f, 12f),
        };
        static readonly float[] PlatformBase = Platforms.Select(pl => LevelKit.SpiralWell(P(pl.phi, pl.r), Well, out _, 1f)).ToArray();
        static readonly (Vector2 foot, Vector2 top, float footY)[][] PlatformRamps = Platforms.Select(pl =>
        {
            var c = P(pl.phi, pl.r);
            var tg = Tan(pl.phi);
            return new[] { -1f, 1f }.Select(sgn =>
            {
                var foot = c + tg * (sgn * (pl.halfT + pl.ramp));
                return (foot, c + tg * (sgn * (pl.halfT - 0.5f)), LevelKit.SpiralWell(foot, Well, out _, 1f));
            }).ToArray();
        }).ToArray();

        /// <summary>炼渣堆（φ, r, 半径, 高）：台阶层 + 矮掩体；都离螺旋中线 ≥ 1 m、离岩台沿 ≥ 0.5 m</summary>
        static readonly (float phi, float r, float radius, float h)[] Mounds =
        {
            (0.20f, 66.5f, 5.5f, 1.5f), (0.27f, 66f, 5f, 1.4f),
            (0.615f, 56.5f, 5f, 1.6f), (0.70f, 54f, 4.5f, 1.4f),
            (0.10f, 43f, 4.5f, 1.5f),
            (0.565f, 30f, 5f, 1.6f), (0.43f, 27f, 4.5f, 1.4f),
        };

        // ── 岩肋（井壁伸出的关口，把 24 m 岩台收到 12 m）与岩台沿件（眺台 / 场地边的凿边）──
        static readonly float[] RibPhis = { 0.13f, 0.455f, 0.79f };
        static readonly float[] LedgeLipPhis = { 0.055f, 0.21f, 0.61f };

        // ── 吊链锚点（崖顶四角）──
        static readonly float[] ChainPhis = { 0.375f, 0.625f, 0.875f, 0.125f };

        // ── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深）──
        const string HangingForgeId = "SM_Tripo_InfernoHangingForge", RockRibId = "SM_Tripo_InfernoRockRib", SpiralLedgeId = "SM_Tripo_InfernoSpiralLedge",
            BellowsId = "SM_Tripo_InfernoBellows", ShrineId = "SM_Tripo_InfernoPortalShrine", ZhurongId = "SM_Tripo_InfernoZhurong",
            FoundryId = "SM_Env_InfernoFoundry", ColumnId = "SM_Tripo_InfernoColumn", AltarId = "SM_Tripo_InfernoFireAltar",
            CoverWallId = "SM_Tripo_InfernoCoverWall", BarricadeId = "SM_Tripo_InfernoBarricade", IngotsId = "SM_Tripo_InfernoIngotPile",
            HoardId = "SM_Tripo_InfernoTreasureHoard", StallId = "SM_Tripo_InfernoForgeStall", CrucibleId = "SM_Prop_InfernoCrucible",
            ObeliskId = "SM_Prop_InfernoChainObelisk";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            // ART6 第三章件（暂缓建模，只有登记 + 概念：缺 Prefab 时放这个尺寸的白盒）
            [HangingForgeId] = new(16f, 8f, 16f), [RockRibId] = new(9f, 16f, 12f), [SpiralLedgeId] = new(14f, 7f, 8f), [BellowsId] = new(18f, 5f, 8f),
            // 已有的火狱套件（验收报告里的实测尺寸）
            [ShrineId] = new(7.59f, 10.68f, 2.15f), [ZhurongId] = new(7.8f, 15.43f, 6.83f), [FoundryId] = new(3.83f, 4.53f, 3.24f),
            [ColumnId] = new(1.97f, 4.93f, 1.81f), [AltarId] = new(1.13f, 2.36f, 1.15f), [CoverWallId] = new(3.42f, 2.48f, 0.89f),
            [BarricadeId] = new(3.56f, 1.18f, 0.47f), [IngotsId] = new(2.18f, 1.52f, 1.81f), [HoardId] = new(2.31f, 1.71f, 1.56f),
            [StallId] = new(2.6f, 3.47f, 1.63f), [CrucibleId] = new(1.27f, 0.99f, 1.28f), [ObeliskId] = new(1.08f, 2.13f, 1.08f),
        };

        // ── 第三章阵容（V2）──
        const string Tantong = "tantong", Huodou = "huodou", Mamian = "mamian", Firecracker = "firecracker", FireCrow = "fire_crow", Bifang = "bifang",
            IronOx = "iron_ox";

        /// <summary>
        /// 刷怪站位（标记名、场地、φ / r、角色、lane、高台、散开半径）。每个场地都在自己那一圈上（不把贴地的敌人刷到另一圈——
        /// 马面从下面一圈甩索会把人从岩台沿拖下去）；贴地的远程站在走得上去的俯射台 / 横坡上，毕方（栖落飞行）站横坡高处。
        /// 全部离岩台沿 ≥ 4 m、离道具 ≥ 4 m，放得下精英熔炉铁牛（半径 1.66 m、高 4 m）。
        /// </summary>
        static readonly (string name, int site, Vector2 at, SG.StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            ("Enemy_1_FlankCW", 1, P(0.175f, 73f), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_1_FlankCCW", 1, P(0.30f, 72f), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_1_Ranged_Deck", 1, P(0.245f, Outer(0.245f) - 5f), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_1_Assault", 1, P(0.24f, 66.5f), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_1_Auto", 1, P(0.16f, 70f), SG.StationRole.Auto, 0, false, 1.8f),
            ("Enemy_2_Artillery_Deck", 2, P(0.675f, Outer(0.675f) - 5f), SG.StationRole.Artillery, 0, false, 1.2f),
            ("Enemy_2_Artillery_Far", 2, P(0.66f, 58f), SG.StationRole.Artillery, 0, false, 1.5f),
            ("Enemy_2_Ranged", 2, P(0.745f, 64f), SG.StationRole.Ranged, 0, false, 1.8f),
            ("Enemy_2_FlankCW", 2, P(0.575f, 56f), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_2_FlankCCW", 2, P(0.735f, 55f), SG.StationRole.Flank, 2, false, 2.2f),
            ("Enemy_2_Assault", 2, P(0.645f, 55.5f), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_3_Assault", 3, P(0.13f, 47f), SG.StationRole.Assault, 0, false, 2f),
            ("Enemy_3_FlankCW", 3, P(0.07f, 50f), SG.StationRole.Flank, 1, false, 2.2f),
            ("Enemy_3_FlankCCW", 3, P(0.19f, 40f), SG.StationRole.Flank, 2, false, 2f),
            ("Enemy_3_Ranged_Ramp", 3, OnRamp(0, 0.215f), SG.StationRole.Ranged, 0, false, 1f),
            ("Enemy_3_Precision_Ramp", 3, OnRamp(0, 0.25f), SG.StationRole.Precision, 0, true, 1f),
            ("Enemy_3_Auto", 3, P(0.155f, 47.5f), SG.StationRole.Auto, 0, false, 1.5f),
            ("Enemy_4_AssaultW", 4, P(0.60f, 29f), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_4_AssaultE", 4, P(0.40f, 34f), SG.StationRole.Assault, 0, false, 2.2f),
            ("Enemy_4_FlankN", 4, P(0.53f, 35f), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_4_Ranged_Deck", 4, P(0.40f, 47f), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_4_Artillery", 4, P(0.68f, 32f), SG.StationRole.Artillery, 0, false, 2f),
            ("Enemy_4_Auto", 4, P(0.47f, 31f), SG.StationRole.Auto, 2, false, 2f),
            ("Enemy_5_Ranged", 5, P(0.875f, Outer(0.875f) - 1f), SG.StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_5_Flank", 5, P(0.83f, 55f), SG.StationRole.Flank, 1, false, 2f),
            ("Enemy_5_Auto", 5, P(0.905f, 53f), SG.StationRole.Auto, 2, false, 2f),
        };

        /// <summary>螺旋中线（上环 + 下环到并进井底前），散布避让、坡度验收用</summary>
        static readonly List<Vector2> UpperLine = LevelKit.SpiralPath(Well, 0.02f, 1.0f, Well.ledge * 0.5f);
        static readonly List<Vector2> LowerLine = LevelKit.SpiralPath(Well, 1.0f, 1.36f, Well.ledge * 0.5f);

        // ───────────── 地貌 ─────────────

        /// <summary>陡坎线不摆动的地方：升降台、熔瀑、井口眺台、两条横坡的坡顶（要和摆件、跳台、坡对齐）</summary>
        static float Calm(Vector2 p) =>
            Mathf.Max(Mathf.Max(Disc(p, P(0.5f, 51f), 13f, 6f), Mathf.Max(Disc(p, P(PoolPhi, Inner(PoolPhi) - 2f), 12f, 6f), Disc(p, P(0.055f, 67f), 9f, 5f))),
                Mathf.Max(Disc(p, P(0.307f, Inner(0.307f)), 8f, 5f), Disc(p, P(0.717f, Inner(0.717f)), 8f, 5f)));

        /// <summary>龛（岩壁里凿进去的方坑）：有符号距离（龛内为正），龛底高 = 龛口那一圈岩台高</summary>
        static float NicheInside(Vector2 p, out float level)
        {
            float best = float.MinValue;
            level = 0;
            foreach (var (_, phi, depth, half) in Niches)
            {
                var c = P(phi, Outer(phi) + depth * 0.5f - 1f);
                var q = p - c;
                float lr = Vector2.Dot(q, Rad(phi)), lt = Vector2.Dot(q, Tan(phi));
                float dx = Mathf.Abs(lr) - (depth * 0.5f + 1f), dz = Mathf.Abs(lt) - half;
                float outside = new Vector2(Mathf.Max(dx, 0), Mathf.Max(dz, 0)).magnitude + Mathf.Min(Mathf.Max(dx, dz), 0);
                if (-outside > best)
                {
                    best = -outside;
                    level = Lv(phi);
                }
            }
            return best;
        }

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：螺旋外沿（含开端接缝）∪ 三个龛</summary>
        static float Inside(Vector2 p) => Mathf.Max(LevelKit.SpiralInside(Well, p), NicheInside(p, out _));

        /// <summary>可玩区遮罩（世界 XZ，软边界与 L5 共用）：等值线 0.2 落在内壁坡面上（外沿外约 1.8 m）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        /// <summary>熔岩井（地形洞）：井心半径 WellR 以内，除了正北的炉坛栈桥</summary>
        static bool WellHole(Vector2 p) => (p - Well.center).magnitude < WellR && !OnPier(p);

        static bool OnPier(Vector2 p)
        {
            var q = p - Well.center;
            float along = Vector2.Dot(q, Rad(PierPhi)), across = Vector2.Dot(q, Tan(PierPhi));
            return Mathf.Abs(across) < PierHalf && along > PierTip;
        }

        /// <summary>崖顶：40 m 上下起伏的山脊，125 m 外往外落到熔岩台地</summary>
        static float CrestHeight(Vector2 p, float r) =>
            Mathf.Lerp(Crest + (Ridged(p, 30f, 3, 7) - 0.4f) * 6f, PlainY + Fbm(p, 60f, 2, 9) * 2f, Smooth(125f, 200f, r));

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float r = (p - Well.center).magnitude;
            float calm = Calm(p);
            float phi = LevelKit.SpiralPhi(Well, p);
            float h = LevelKit.SpiralWell(p, Well, out var o, calm);
            float insN = NicheInside(p, out float nicheLv);
            float ins = Mathf.Max(o.inside, insN);
            float wall = 0;

            // ── 内壁 / 龛 ──
            if (o.inside < 0)
            {
                if (insN >= 0) h = nicheLv;
                else
                {
                    float dout = -ins;
                    float crest = CrestHeight(p, r);
                    float baseLv, k;
                    if (insN > o.inside)
                    {
                        baseLv = nicheLv;
                        k = Smooth(0, NicheFace, dout);
                    }
                    else
                    {
                        // 接缝一侧（绕了一圈回来那边）直接是整壁：井口栈台背后是一道竖直的崖
                        baseLv = Lv(phi);
                        k = Mathf.Max(Smooth(0, Face, dout), Smooth(1 - SeamBand, 1, phi));
                    }
                    h = baseLv + (crest - baseLv) * k;
                    wall = k;
                }
            }

            // ── 岩台面的细起伏（井沿、升降台一带压平）──
            float settle = (1 - calm) * Smooth(WellR + 1f, WellR + 5f, r) * Smooth(-1f, 1f, ins);
            h += Fbm(p, 12f, 2, 33) * 0.12f * (1 - o.riser) * settle;

            // ── 炼渣堆 ──
            float slag = 0;
            foreach (var (mp, mr, rad, mh) in Mounds)
            {
                float d = Vector2.Distance(p, P(mp, mr));
                if (d >= rad) continue;
                float k = Mathf.Pow(1 - Smooth(0, rad, d), 1.2f);
                h += mh * k;
                slag = Mathf.Max(slag, k);
            }

            // ── 俯射台 + 两头的坡（只填）──
            float deck = 0;
            for (int i = 0; i < Platforms.Length; i++)
            {
                var pl = Platforms[i];
                var q = p - P(pl.phi, pl.r);
                float lr = Vector2.Dot(q, Rad(pl.phi)), lt = Vector2.Dot(q, Tan(pl.phi));
                float ox = Mathf.Max(0, Mathf.Abs(lr) - pl.halfR), oz = Mathf.Max(0, Mathf.Abs(lt) - pl.halfT);
                float outside = Mathf.Sqrt(ox * ox + oz * oz);
                float top = PlatformBase[i] + pl.rise;
                if (outside < 1f)
                {
                    float m = 1 - Smooth(0, 1f, outside);
                    h = Mathf.Max(h, Mathf.Lerp(h, top, m));
                    deck = Mathf.Max(deck, m);
                }
                foreach (var (foot, rtop, footY) in PlatformRamps[i])
                {
                    var (t, m) = Ramp(p, foot, rtop, 5f, 2f);
                    if (m <= 0) continue;
                    // 坡在离台沿 0.8 m 处就到顶（台沿侧壁的过渡落在平的坡顶上，不出一道坎）
                    float target = Mathf.Lerp(footY, top, Mathf.Min(1f, t / 0.92f));
                    h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                    deck = Mathf.Max(deck, m);
                }
            }

            // ── 横坡（只填，按弧长线性）──
            float ramp = 0;
            foreach (var (_, path, footY, topY, half) in Ramps)
            {
                var (d, t) = Polyline(p, path);
                if (d > half + 2.5f) continue;
                float m = 1 - Smooth(half, half + 2.5f, d);
                float target = Mathf.Lerp(footY, topY + RampOvershoot, t);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                ramp = Mathf.Max(ramp, m);
            }

            // ── ③ 熔岩池（挖到熔岩面下 1.4 m，2 m 宽的岸坡）──
            float pool = 0, poolShore = 0;
            {
                var q = p - PoolC;
                float lr = Vector2.Dot(q, Rad(PoolPhi)), lt = Vector2.Dot(q, Tan(PoolPhi));
                float ox = Mathf.Max(0, Mathf.Abs(lr) - PoolHalfR), oz = Mathf.Max(0, Mathf.Abs(lt) - PoolHalfT);
                float outside = Mathf.Sqrt(ox * ox + oz * oz);
                if (outside < 2f)
                {
                    float bed = PoolLevel - PoolBed;
                    h = Mathf.Min(h, Mathf.Lerp(bed, h, Smooth(0, 2f, outside)));
                    pool = 1 - Smooth(0, 0.6f, outside);
                }
                poolShore = 1 - Smooth(1.5f, 6f, outside);
            }

            // ── 熔岩井：洞（栈桥除外），井沿一圈压平 ──
            if (r < WellR + 4f)
            {
                h = Mathf.Lerp(0f, h, Smooth(WellR + 1f, WellR + 4f, r));
                if (WellHole(p)) s.hole = 1;
            }

            // ── 地形外缘 36 m 内落回远景地面 ──
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 36, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Inferno：岩 → 余烬 → 灰 → 其余是玄武岩碎）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            float ledgeTop = inside * (1 - o.riser);
            s.packed = Mathf.Max(ledgeTop * 0.5f, Mathf.Max(deck * 0.85f, ramp * 0.8f));
            s.sand = Mathf.Max((1 - inside) * 0.55f * (1 - wall * 0.5f), slag * 0.9f);
            s.sand = Mathf.Max(s.sand, ledgeTop * Smooth(0.15f, 0.55f, Fbm(p, 22f, 3, 37)) * 0.6f);
            s.rock = Mathf.Max(o.riser * inside * 0.55f, wall * 0.6f);
            s.fluid = Mathf.Max(pool, s.hole);
            float wellShore = (1 - Smooth(WellR, WellR + 6f, r)) * (1 - s.hole);
            s.shore = Mathf.Max(wellShore, poolShore * (1 - pool));
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-2 铸神井", priority = 69)]
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
        static float GroundY(Vector2 q) => ts.GroundY(q.x, q.y);

        /// <summary>生成场景 → 烘焙 NavMesh → 验收规则集 + 熔岩 + 升降台 → 截图；返回不合格项数</summary>
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
                // 远景：火山口外是熔岩台地 + 两圈火山锥（崖顶 40 m 挡住大半，只露火山锥的尖）
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, Well.center, PlainY, 760, 5);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：井里的热风往上卷（盛行风只给白化 / 散布摆动一个方向），3-2 的动态环境是熔岩，不放区域风暴
                LevelKit.Weather(env, theme, new Vector2(0.4f, 1f), 0.2f);

                BuildWell(kit, world);
                BuildLavaFall(world);
                BuildLedges(kit, props);
                var lift = BuildLift(world);
                var (shrine, zhurongTop) = BuildExitAndCrest(kit);
                BuildScatter(props, theme);
                BuildMarkers(markers, zhurongTop);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝井心的悬炉）+ 自举标记
                var spawnAt = OnGround(Spawn, 0.05f);
                var look = (Well.center - Spawn).normalized;
                var spawnRot = Quaternion.LookRotation(new Vector3(look.x, 0, look.y));
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<SG.PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<SG.LevelBootstrap>();
                var objective = BuildEncounters(markers);
                lift.powerSite = objective.required.FirstOrDefault(x => x && x.title == "井底炉坛");
                BuildExit(shrine, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                LevelKit.BakeLavaNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                // 构建设置只补进本场景（顺序由 levels 命令按 RunPlan 重排，parity 4.12）
                if (!EditorBuildSettings.scenes.Any(sc => sc.path == ScenePath))
                    EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

                var rep = new LevelKit.Report();
                rep.Line("3-2 铸神井 · 验收");
                rep.Line($"高度：井口栈台 {GroundY(Spawn):F1}，① 回廊 {GroundY(Site1):F1}（渣台 {GroundY(P(0.245f, Outer(0.245f) - 5f)):F1}），" +
                         $"② 风口 {GroundY(Site2):F1}，③ 熔瀑 {GroundY(Site3):F1}（熔岩池面 {PoolLevel:F2}），④ 炉坛 {GroundY(Site4):F1}（熔岩井面 {LavaY:F1}），" +
                         $"升降台 {lift.lowPosition.y:F2} → {lift.highPosition.y:F2}，出口铸门 {GroundY(ExitFront):F1}，崖顶 {GroundY(ZhurongAt):F1}");
                LevelValidator.Run(Spec(zhurongTop), rep);
                LevelKit.ValidateLava(rep);
                CheckLift(rep, lift);
                CheckSceneContents(rep, scene);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_3-2_report.txt");

                if (review) Review(spawnAt, spawnRot, lift, zhurongTop);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        /// <summary>
        /// 井里的光：主光抬到俯角 58°、从南边照进来（北壁、出口、祝融像受光，井口栈台看过去是亮面；主题默认 20° 的低太阳会让整口井都在崖影里），
        /// 熔岩井、熔瀑、悬炉炉腹各一盏不投影的橙色点光
        /// </summary>
        static void WellLighting(ShowcaseTheme theme, Transform world)
        {
            var sun = RenderSettings.sun;
            if (sun)
            {
                sun.transform.rotation = Quaternion.Euler(58f, 15f, 0);
                sun.intensity = theme.sunIntensity * 1.15f;
            }
            Light Point(string name, Vector3 at, float range, float intensity)
            {
                var l = new GameObject(name).AddComponent<Light>();
                l.transform.SetParent(world, false);
                l.transform.position = at;
                l.type = LightType.Point;
                l.color = new Color(1f, 0.46f, 0.16f);
                l.range = range;
                l.intensity = intensity;
                l.shadows = LightShadows.None;
                return l;
            }
            Point("Lava Well Light", new Vector3(Well.center.x, 3f, Well.center.y), 46f, 6f);
            Point("Forge Belly Light", new Vector3(Well.center.x, ForgeBaseY - 3f, Well.center.y), 26f, 3f);
            var pool = PoolC + Rad(PoolPhi) * 1.5f;
            Point("Lava Fall Light", new Vector3(pool.x, PoolLevel + 4f, pool.y), 18f, 4f);
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, SG.ForgeWellLift lift, Vector3 zhurongTop)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => OnGround(q, dy);
            var forge = new Vector3(Well.center.x, ForgeBaseY + 4f, Well.center.y);
            var lava = new Vector3(Well.center.x, LavaY, Well.center.y - 4f);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-2", new[]
                {
                    ("Aerial", new Vector3(-150, 150, -170), new Vector3(0, 0, 10), false),
                    ("Map", new Vector3(Well.center.x, 380, Well.center.y - 1), new Vector3(Well.center.x, 0, Well.center.y), false),
                    ("Spawn", E(Spawn), forge, true),
                    ("Lookout", E(Lookout), lava, false),
                    ("SlagGallery", E(P(0.17f, 74f)), OnGround(P(0.26f, 70f), 2), false),
                    ("EastRamp", E(OnRamp(0, 0.29f)), OnGround(Site3, 1), false),
                    ("LavaFall", E(P(0.17f, 47f)), At(P(PoolPhi, Inner(PoolPhi) - 3f), PoolLevel + 5f), false),
                    ("ForgeAltar", E(P(0.5f, 40f)), OnGround(P(PierPhi, PierTip + 2.5f), 2.5f), false),
                    ("LiftTop", lift.highPosition + Vector3.up * 1.62f + new Vector3(0, 0, 9f), forge, false),
                    ("WindVent", E(P(0.60f, 60f)), OnGround(P(0.68f, 66f), 2), false),
                    ("Exit", E(P(0.5f, 62f)), zhurongTop, false),
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
        /// 摆一件资产：底面中心 = q、世界 y = baseY；有 Prefab 就按 scale 摆，没有就放设计尺寸 × scale 的白盒
        /// （LevelKit.PlaceOrBox，Placeholder 标签，验收会列出来——第三章新件暂缓建模，ART6 件全部先是白盒）
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

        /// <summary>贴地摆（底面埋进地面 sink 米）</summary>
        static GameObject Prop(string id, Transform parent, Vector2 q, float yaw, float scale = 1, float sink = 0.1f) =>
            Kit(id, parent, q, GroundY(q) - sink, yaw, scale);

        /// <summary>
        /// 熔岩井：熔岩面（LavaVolume 圆，熔岩面 y −2.5，下面放接人板）、地形洞一圈的井壁衬里 + 熔岩光带、炉坛栈桥头的熔炉与火坛、
        /// 井心上空的悬炉（ART6 白盒）+ 炉腹火口 + 四条巨链拉到崖顶四角的铁柱
        /// </summary>
        static void BuildWell(Transform kit, Transform world)
        {
            LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "Well", center = new Vector3(Well.center.x, LavaY, Well.center.y), shape = SG.LavaShape.Disc,
                size = new Vector2(WellR + LiningPad + 0.4f, 0), depth = 2f, depthShore = false, catchFloor = true,
            }, world);

            var basalt = LevelKit.Mat(Dir, "WellLining", new Color(0.13f, 0.1f, 0.11f), 0.95f);
            var glow = LevelKit.GlowMat(Dir, "WellGlowBand", new Color(1f, 0.45f, 0.15f), new Color(3.2f, 1.1f, 0.25f));
            LevelKit.WellLining(Dir, "Well Lining", world, WellLoop(LiningPad), -0.12f, LavaY - 1.2f, basalt);
            LevelKit.WellLining(Dir, "Well Glow Band", world, WellLoop(LiningPad - 0.08f), LavaY + 0.9f, LavaY - 0.3f, glow);

            // 炉坛：栈桥头的熔炉（面朝来路）、桥根两侧火坛、桥上两口坩埚
            var tip = P(PierPhi, PierTip + 2.6f);
            Kit(FoundryId, kit, tip, -0.1f, YawZ(Rad(PierPhi)), 1.3f);
            var tg = Tan(PierPhi);
            var root = P(PierPhi, WellR + 3.5f);
            foreach (int side in new[] { -1, 1 })
            {
                Prop(AltarId, kit, root + tg * (side * 6.5f), FaceIn(PierPhi));
                Prop(CrucibleId, kit, P(PierPhi, PierTip + 6.5f) + tg * (side * 2.6f), side * 30f);
            }

            // 悬炉：井心上空 22–30 m，四角吊链拉到崖顶的铁柱；炉腹一圈火口（自发光、无碰撞）
            Kit(HangingForgeId, kit, Well.center, ForgeBaseY, 0f);
            var belly = LevelKit.Cylinder("Forge Belly Glow", kit, new Vector3(Well.center.x, ForgeBaseY - 0.15f, Well.center.y), 5.5f, 0.3f,
                Quaternion.identity, LevelKit.GlowMat(Dir, "ForgeBelly", new Color(1f, 0.5f, 0.2f), new Color(4f, 1.4f, 0.35f)));
            Object.DestroyImmediate(belly.GetComponent<Collider>());
            var chains = new GameObject("Hanging Forge Chains").transform;
            chains.SetParent(kit, false);
            for (int i = 0; i < ChainPhis.Length; i++)
            {
                float phi = ChainPhis[i];
                var anchor = P(phi, Outer(phi) + 10f);
                float gy = GroundY(anchor);
                Kit(ColumnId, kit, anchor, gy - 0.3f, FaceIn(phi), 1.2f);
                var dir = (anchor - Well.center).normalized;
                var corner = Well.center + dir * 9.9f; // 炉台四角的吊环（方台 16 m，角在 ±8, ±8）
                var from = new Vector3(corner.x, ForgeBaseY + 7.6f, corner.y);
                var to = new Vector3(anchor.x, gy - 0.3f + 4.93f * 1.2f, anchor.y);
                LevelKit.Chain(Dir, $"Forge {i + 1}", chains, from, to, 6f);
            }
        }

        /// <summary>
        /// 熔岩井洞口轮廓（世界 XZ，首尾相接）：圆弧（半径 WellR + pad）绕开正北的炉坛栈桥，再沿栈桥两侧（往桥里缩 pad）和桥头一圈。
        /// pad &gt; 0 = 藏在地形下面（衬里），地形洞的锯齿边看不到缝
        /// </summary>
        static List<Vector2> WellLoop(float pad)
        {
            var o = new List<Vector2>();
            var ax = Rad(PierPhi);
            var tg = Tan(PierPhi);
            float R = WellR + pad, half = PierHalf - pad, tipAlong = PierTip + pad;
            float rootAlong = Mathf.Sqrt(Mathf.Max(0, R * R - half * half));
            // 栈桥东侧（+tg）的弧端点，绕远离栈桥的一侧一整圈到西侧端点
            float a0 = Mathf.Atan2(half, rootAlong), a1 = 2 * Mathf.PI - a0;
            const int Segs = 96;
            for (int i = 0; i <= Segs; i++)
            {
                float a = Mathf.Lerp(a0, a1, i / (float)Segs);
                o.Add(Well.center + (ax * Mathf.Cos(a) + tg * Mathf.Sin(a)) * R);
            }
            // 西侧 → 桥头 → 东侧（回到起点）
            o.Add(Well.center + ax * tipAlong - tg * half);
            o.Add(Well.center + ax * tipAlong + tg * half);
            return o;
        }

        /// <summary>③ 熔瀑：陡坎脚的熔岩池（LavaVolume 盒，按岸坡深度算硬壳）+ 从井壁裂缝斜着泻下来的熔岩面（只是画，没有判定）</summary>
        static void BuildLavaFall(Transform world)
        {
            var rd = Rad(PoolPhi);
            var tg = Tan(PoolPhi);
            var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "Fall Pool", center = At(PoolC, PoolLevel), shape = SG.LavaShape.Box, yaw = YawZ(tg),
                size = new Vector2(PoolHalfR * 2 + 2f, PoolHalfT * 2 + 2f), depth = PoolBed + 0.6f, depthShore = true,
                flow = new Vector2(0, -0.25f),
            }, world);
            lava.gameObject.name = "Lava · 熔瀑池";

            // 熔瀑：从上环岩台沿下 2.5 m 的裂缝，贴着陡坎（离坡面 ≥ 1 m）斜落进池子
            float foot = Inner(PoolPhi) - Well.riser;
            var bottom = At(P(PoolPhi, foot - 1.2f), PoolLevel - 0.1f);
            var top = At(P(PoolPhi, foot + 2.4f), Lv(PoolPhi) - 2.5f);
            var axis = top - bottom;
            var mat = LevelKit.LavaMaterial();
            if (!mat) return;
            var mesh = SG.LavaVolume.BuildMesh(SG.LavaShape.Box, new Vector2(FallWidth, axis.magnitude), false, new Vector2(0, -2.2f));
            mesh.name = "Mesh_LavaFall";
            LevelKit.SaveAsset(mesh, $"{Dir}/Lava/Mesh_LavaFall.asset");
            var fall = new GameObject("Lava Fall");
            fall.transform.SetParent(world, false);
            var inward = new Vector3(-rd.x, 0, -rd.y);
            fall.transform.SetPositionAndRotation((top + bottom) * 0.5f, Quaternion.LookRotation(axis.normalized, inward));
            fall.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = fall.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            fall.isStatic = true;
        }

        /// <summary>岩台上的件：三道岩肋（白盒）、岩台沿件（白盒）、② 巨型风箱（白盒）、各场地的掩体 / 火坛 / 锭堆、井口栈台的铸炉摊</summary>
        static void BuildLedges(Transform kit, Transform props)
        {
            // 岩肋：背面嵌进内壁 1.5 m，正面朝井心，把岩台收成 12 m 的关口
            foreach (float phi in RibPhis)
            {
                var c = P(phi, Outer(phi) - 6f + 1.5f);
                var rib = Kit(RockRibId, kit, c, LevelKit.SpiralWell(c, Well, out _, 1f) - 0.3f, FaceIn(phi));
                if (rib && !IsPlaceholder(rib)) rib.name = $"{RockRibId} (φ {phi:0.###})";
            }
            // 岩台沿件：前沿探出陡坎 2 m，顶面比岩台低 0.25 m（埋在岩台面下，只露凿出来的沿口）
            foreach (float phi in LedgeLipPhis)
            {
                float halfPhi = 7f / (2 * Mathf.PI * Inner(phi));
                float top = Lv(phi + halfPhi) - 0.25f;
                Kit(SpiralLedgeId, kit, P(phi, Inner(phi) + 2f), top - 7f, FaceIn(phi));
            }

            // 井口栈台：两座火坛、贴壁的铸炉摊；眺台边一根锁魂碑（跳台记号）
            Prop(AltarId, props, P(0.012f, 80.5f), FaceIn(0.012f));
            Prop(AltarId, props, P(0.08f, 82f), FaceIn(0.08f));
            Prop(StallId, props, P(0.045f, Outer(0.045f) - 3.2f), FaceIn(0.045f));
            Prop(ObeliskId, props, P(0.075f, 70f), 20f);

            // ① 炼渣回廊：渣台前两段高掩体、两道矮障、两堆锭、渣台后一座火坛
            Prop(CoverWallId, props, P(0.232f, 74.5f), AlongT(0.232f));
            Prop(CoverWallId, props, P(0.258f, 74.5f), AlongT(0.258f));
            Prop(BarricadeId, props, P(0.185f, 69f), AlongT(0.185f));
            Prop(BarricadeId, props, P(0.295f, 67.5f), AlongT(0.295f));
            Prop(IngotsId, props, P(0.19f, 80f), 30f);
            Prop(IngotsId, props, P(0.30f, 80f), 110f);
            Prop(AltarId, props, P(0.245f, Outer(0.245f) - 2.2f), FaceIn(0.245f));

            // ② 风口：巨型风箱（ART6 白盒）贴壁横卧、喷口朝下行方向；检修台后一座火坛；两段高掩体、一道矮障
            var bellowsAt = P(0.60f, Outer(0.60f) - 4.5f);
            Kit(BellowsId, kit, bellowsAt, LevelKit.SpiralWell(bellowsAt, Well, out _, 1f) - 0.2f, AlongT(0.60f));
            Prop(AltarId, props, P(0.675f, Outer(0.675f) - 1.6f), FaceIn(0.675f));
            Prop(CoverWallId, props, P(0.69f, 63.5f), AlongT(0.69f));
            Prop(CoverWallId, props, P(0.635f, 63f), AlongT(0.635f));
            Prop(BarricadeId, props, P(0.72f, 60f), AlongT(0.72f));

            // ③ 熔瀑：池边一道矮障、岩台沿一堆锭
            Prop(BarricadeId, props, P(0.145f, 50.5f), AlongT(0.145f));
            Prop(IngotsId, props, P(0.075f, 41f), 20f);

            // ④ 井底炉坛：两段高掩体、两道矮障、一堆锭（栈桥、熔炉、火坛在 BuildWell）
            Prop(CoverWallId, props, new Vector2(12f, 33f), YawX(Tan(LevelKit.SpiralPhi(Well, new Vector2(12f, 33f)))));
            Prop(CoverWallId, props, new Vector2(-12f, 38f), YawX(Tan(LevelKit.SpiralPhi(Well, new Vector2(-12f, 38f)))));
            Prop(BarricadeId, props, new Vector2(-20f, 33f), 35f);
            Prop(BarricadeId, props, new Vector2(18f, 22f), -60f);
            Prop(IngotsId, props, new Vector2(-11f, 42f), 75f);
        }

        /// <summary>
        /// 炉坛升降台（运行时 <see cref="SG.ForgeWellLift"/>，maps/3-2.md §6）：台面 7 × 7 m 放在下站（井底，台面顶高出地面 0.25 m）；
        /// 上站接一段 5 m 宽的固定栈桥搭到上环岩台沿；两根 24 m 的井架立柱 + 横梁 + 两个滑轮，两根吊索随台面伸缩。
        /// 台面、栏杆、灯不是静态物体（会动）；④ 井底炉坛肃清后通电（构建器在遭遇建好后补上 powerSite）。
        /// </summary>
        static SG.ForgeWellLift BuildLift(Transform world)
        {
            var iron = LevelKit.Mat(Dir, "ForgeIron", new Color(0.17f, 0.14f, 0.15f), 0.6f);
            var plate = LevelKit.Mat(Dir, "LiftDeck", new Color(0.24f, 0.19f, 0.17f), 0.8f);
            var lampMat = LevelKit.GlowMat(Dir, "LiftLamp", new Color(1f, 0.6f, 0.25f), new Color(3f, 1.3f, 0.3f));
            var rd = Rad(0.5f);
            var tg = Tan(0.5f);
            float yaw = YawZ(rd);

            // 下站：台面四角里最高的地面 + 0.25 m；上站：栈桥头（上环内缘外 1.5 m）的地面
            float low = float.MinValue;
            foreach (var (a, b) in new[] { (-1, -1), (-1, 1), (1, -1), (1, 1) })
                low = Mathf.Max(low, GroundY(LiftXZ + tg * (a * DeckSize * 0.45f) + rd * (b * DeckSize * 0.45f)));
            low += 0.25f;
            float high = GroundY(P(0.5f, Inner(0.5f) + 1.5f));

            var root = new GameObject("Forge Lift").transform;
            root.SetParent(world, false);
            root.position = At(LiftXZ, low);
            var lift = root.gameObject.AddComponent<SG.ForgeWellLift>();

            // 台面（会动）
            var deck = new GameObject("Deck").transform;
            deck.SetParent(root, false);
            deck.SetPositionAndRotation(At(LiftXZ, low), Quaternion.Euler(0, yaw, 0));
            GameObject Part(string name, Vector3 local, Vector3 size, Material m)
            {
                var go = LevelKit.Box(name, deck, deck.TransformPoint(local - Vector3.up * size.y * 0.5f), size, yaw, m, 0);
                go.isStatic = false;
                return go;
            }
            Part("Deck Slab", new Vector3(0, -DeckThickness * 0.5f, 0), new Vector3(DeckSize, DeckThickness, DeckSize), plate);
            foreach (int side in new[] { -1, 1 })
            {
                Part(side < 0 ? "Rail W" : "Rail E", new Vector3(side * (DeckSize * 0.5f - 0.08f), 0.55f, 0), new Vector3(0.15f, 1.1f, DeckSize - 0.2f), iron);
                var lamp = Part(side < 0 ? "Lamp W" : "Lamp E", new Vector3(side * (DeckSize * 0.5f - 0.08f), 1.25f, -DeckSize * 0.5f + 0.3f), new Vector3(0.35f, 0.3f, 0.35f), lampMat);
                Object.DestroyImmediate(lamp.GetComponent<Collider>());
            }
            var body = deck.gameObject.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;
            var deckLight = new GameObject("Deck Light").AddComponent<Light>();
            deckLight.transform.SetParent(deck, false);
            deckLight.transform.localPosition = new Vector3(0, 2.5f, 0);
            deckLight.type = LightType.Point;
            deckLight.color = new Color(1f, 0.55f, 0.2f);
            deckLight.range = 10f;
            deckLight.intensity = 2.5f;
            deckLight.shadows = LightShadows.None;
            var lamps = deck.GetComponentsInChildren<Transform>(true).Where(t => t.name.StartsWith("Lamp")).Select(t => t.gameObject).Append(deckLight.gameObject).ToArray();
            foreach (var t in deck.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;

            // 上站栈桥（固定）：从台面外沿外 0.1 m 搭到上环岩台沿里 2.5 m，两侧矮栏（靠岩台那头留口）
            var gw = P(0.5f, (GangwayFrom + GangwayTo) * 0.5f);
            LevelKit.Box("Lift Gangway", root, At(gw, high - 0.6f), new Vector3(GangwayWidth, 0.6f, GangwayTo - GangwayFrom), yaw, plate, 0);
            foreach (int side in new[] { -1, 1 })
            {
                var c = P(0.5f, GangwayFrom + 2.6f) + tg * (side * (GangwayWidth * 0.5f - 0.1f));
                LevelKit.Box(side < 0 ? "Gangway Rail W" : "Gangway Rail E", root, At(c, high), new Vector3(0.15f, 1f, 4.4f), yaw, iron, 0);
            }

            // 井架：两根立柱 + 横梁 + 两个滑轮（滑轮、吊索没有碰撞）
            var headframe = new GameObject("Headframe").transform;
            headframe.SetParent(root, false);
            foreach (int side in new[] { -1, 1 })
                LevelKit.Box(side < 0 ? "Post W" : "Post E", headframe, At(LiftXZ + tg * (side * PostOffset), GroundY(LiftXZ + tg * (side * PostOffset)) - 0.3f),
                    new Vector3(0.9f, HeadframeTop + 0.3f, 0.9f), yaw, iron, 0);
            LevelKit.Box("Crossbeam", headframe, At(LiftXZ, HeadframeTop - 1.2f), new Vector3(PostOffset * 2 + 1.2f, 1.2f, 1f), yaw, iron, 0);
            var cables = new List<Transform>();
            var tops = new List<Vector3>();
            var anchors = new List<Vector3>();
            foreach (int side in new[] { -1, 1 })
            {
                var x = LiftXZ + tg * (side * 3.2f);
                var sheave = LevelKit.Cylinder("Sheave", headframe, At(x, HeadframeTop + 0.6f), 0.8f, 0.35f,
                    Quaternion.FromToRotation(Vector3.up, new Vector3(tg.x, 0, tg.y)), iron);
                Object.DestroyImmediate(sheave.GetComponent<Collider>());
                var top = At(x, HeadframeTop - 1.2f);
                var cable = LevelKit.Cylinder(side < 0 ? "Cable W" : "Cable E", root, top + Vector3.down * 5f, 0.07f, 10f, Quaternion.identity, iron);
                Object.DestroyImmediate(cable.GetComponent<Collider>());
                cable.isStatic = false;
                cables.Add(cable.transform);
                tops.Add(top);
                anchors.Add(new Vector3(side * 3.2f, 1.1f, 0));
            }

            lift.deck = deck;
            lift.deckSize = new Vector2(DeckSize, DeckSize);
            lift.deckThickness = DeckThickness;
            lift.lowPosition = At(LiftXZ, low);
            lift.highPosition = At(LiftXZ, high);
            lift.poweredOnly = lamps;
            lift.cables = cables.ToArray();
            lift.cableTops = tops.ToArray();
            lift.cableAnchors = anchors.ToArray();
            // 编辑器里先把吊索摆到下站的长度（运行时每帧由组件更新）
            for (int i = 0; i < cables.Count; i++)
            {
                var a = tops[i];
                var b = deck.TransformPoint(anchors[i]);
                cables[i].SetPositionAndRotation((a + b) * 0.5f, Quaternion.identity);
                cables[i].localScale = new Vector3(0.14f, Vector3.Distance(a, b) * 0.5f, 0.14f);
            }
            return lift;
        }

        /// <summary>出口铸门龛（出口祭坛 + 两座火坛）、两处藏宝龛里的锭堆 / 宝堆、崖顶的祝融像（出口正上方，全图地标）；返回祭坛和祝融像胸口</summary>
        static (GameObject shrine, Vector3 zhurongTop) BuildExitAndCrest(Transform kit)
        {
            var shrine = Kit(ShrineId, kit, ShrineAt, GroundY(ShrineAt) - 0.15f, FaceIn(0.5f));
            foreach (int side in new[] { -1, 1 })
                Prop(AltarId, kit, P(0.5f, Outer(0.5f) + 1.5f) + Tan(0.5f) * (side * 5.6f), FaceIn(0.5f));

            Prop(HoardId, kit, P(0.40f, Outer(0.40f) + 9.5f), FaceIn(0.40f));
            Prop(IngotsId, kit, P(0.403f, Outer(0.40f) + 4.5f), 50f);
            Prop(HoardId, kit, P(0.875f, Outer(0.875f) + 10.5f), FaceIn(0.875f));
            Prop(IngotsId, kit, P(0.879f, Outer(0.875f) + 6f), 140f);

            float gy = GroundY(ZhurongAt);
            var statue = Kit(ZhurongId, kit, ZhurongAt, gy - 0.6f, FaceIn(0.5f), ZhurongScale);
            if (statue && !IsPlaceholder(statue)) statue.name = $"{ZhurongId} (Crest)";
            return (shrine, At(ZhurongAt, gy + 15.43f * ZhurongScale * 0.62f));
        }

        /// <summary>
        /// 散布（L4 章节默认规则）：余烬石、火山渣避开螺旋中线、横坡、俯射台、熔岩池、井沿；玄武岩块（带碰撞）只在岩台外半圈和崖顶、场地 / 站位 / 坡 / 龛以外
        /// </summary>
        static void BuildScatter(Transform props, ShowcaseTheme theme)
        {
            var lines = new List<IReadOnlyList<Vector2>> { UpperLine, LowerLine };
            foreach (var rp in Ramps) lines.Add(rp.path);
            float RouteDist(Vector2 w)
            {
                float best = float.MaxValue;
                foreach (var l in lines) best = Mathf.Min(best, Polyline(w, l).dist);
                return best;
            }
            float Keep(Vector2 w)
            {
                float k = 0;
                for (int i = 0; i < Platforms.Length; i++) k = Mathf.Max(k, Disc(w, P(Platforms[i].phi, Platforms[i].r), Platforms[i].halfT + 4f, 3f));
                k = Mathf.Max(k, Disc(w, PoolC, PoolHalfT + 3f, 2f));
                k = Mathf.Max(k, Disc(w, LiftXZ, 9f, 3f));
                k = Mathf.Max(k, 1 - Smooth(WellR + 2f, WellR + 5f, (w - Well.center).magnitude));
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
                (Spawn, 14), (Lookout, 6), (Site1, 10), (Site2, 10), (Site3, 10), (Site4, 24), (Site5, 8), (CacheA, 8), (CacheB, 8), (ExitFront, 12),
                (LiftXZ, 14), (PoolC, 14), (Well.center, WellR + 8),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            foreach (var pl in Platforms) avoid.Add((P(pl.phi, pl.r), pl.halfT + pl.ramp + 3));
            foreach (float phi in RibPhis) avoid.Add((P(phi, Outer(phi) - 6f), 10));
            boulders.where = pt =>
            {
                float ins = Inside(pt.p);
                // 岩台外半圈（靠内壁 3–9 m）或崖顶（界外 20 m 以上）；不上陡坎、不进坑底
                bool rim = ins > 3f && ins < 9f;
                bool crest = ins < -20f;
                if (!rim && !crest) return 0;
                foreach (var (c, rr) in avoid)
                    if (Vector2.Distance(pt.p, c) < rr) return 0;
                foreach (var rp in Ramps)
                    if (Polyline(pt.p, rp.path).dist < rp.half + 5f) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            LevelKit.ScatterProps(ts, props, boulders, new Rect(-150, -150, 300, 300), 10f, RouteDist);
        }

        static void BuildMarkers(Transform root, Vector3 zhurongTop)
        {
            void Mk(string name, Vector3 at)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = at;
            }
            Mk("Site_Spawn", OnGround(Spawn));
            Mk("Site_1_SlagGallery", OnGround(Site1));
            Mk("Site_2_WindVent", OnGround(Site2));
            Mk("Site_3_LavaFall", OnGround(Site3));
            Mk("Site_4_ForgeAltar", OnGround(Site4));
            Mk("Site_5_MouldStore", OnGround(Site5));
            Mk("Site_Exit", OnGround(ExitFront));
            foreach (var a in Anchors) Mk(a.name, OnGround(a.at));
            // 地标标记（冒烟测试看悬炉 / 祝融像 / 熔岩是否可见）
            Mk("Landmark_HangingForge", new Vector3(Well.center.x, ForgeBaseY + 4f, Well.center.y));
            Mk("Landmark_Zhurong", zhurongTop);
            Mk("Lookout_WellRim", OnGround(Lookout));
            Mk("Lava_WellCentre", new Vector3(Well.center.x, LavaY, Well.center.y - 4f));
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/3-2.md §5，遭遇框架 v2；第三章 V2 阵容）：四个必清场地任意顺序，⑤ 是铸范库（藏宝 B）的守军（可选、不自动触发）。
        /// 难度由 RunPlan 给（3-2 = 2.76），场地不写死；熔章 3-2 精英上限 2：③ 升格 1 只（小队词缀迅捷）、④ 写死精英熔炉铁牛（狂暴）。
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

            var s1 = Site(1, "炼渣回廊", Site1, 22, 26, SG.EncounterSpec.Of(
                    Wave("回廊炭童", E(Tantong, 4), E(Huodou, 2)).Hint("炭童倒下留一堆余烬——4 秒不补刀会复燃，祸斗也会来吃"),
                    Wave("祸斗包抄", E(Huodou, 3), E(Tantong, 2), E(Mamian, 1)).After(1, 1.6f).Hint("吃过火的祸斗会喷火——从侧面打它肋间的火腹"))
                .Gather(0.4f).Distance(10, 32), "weapon");
            var s2 = Site(2, "风口", Site2, 22, 26, SG.EncounterSpec.Of(
                    Wave("风口炮阵", E(Firecracker, 2), E(Tantong, 3)).Hint("两只炮仗傀儡挨在一起——打爆一只会连环炸到另一只"),
                    Wave("勾魂索", E(Mamian, 2), E(Huodou, 2), E(Bifang, 1)).After(1, 2f).Hint("马面甩索会把人拖到岩台沿——射断链子、跳或冲刺挣脱"))
                .Gather(0.5f).Distance(10, 32), "scroll");
            var s3 = Site(3, "熔瀑", Site3, 20, 24, SG.EncounterSpec.Of(
                    Wave("熔瀑伏兵", E(Tantong, 3), E(Huodou, 2), E(Bifang, 1)).Hint("毕方停在横坡上——先打它的腿；把炭童、祸斗打进熔瀑池"),
                    Wave("坡上压阵", E(Firecracker, 1), E(Mamian, 1), E(Tantong, 3)).After(1, 1.6f).Hint("傀儡在横坡上齐射——贴着陡坎绕到坡下"))
                .Gather(0.4f).Distance(10, 30).Elites(1, "swift"), "weapon:min=1");
            var s4 = Site(4, "井底炉坛", Site4, 20, 26, SG.EncounterSpec.Of(
                    Wave("飞鸦盘旋", E(FireCrow, 4), E(Tantong, 3)).Hint("飞鸦俯冲前地上先亮一条朱红线——横移躲开，空中打爆会炸到同伴"),
                    Wave("熔炉铁牛", E(IronOx, 1).Elite("frenzied"), E(FireCrow, 2), E(Mamian, 1), E(Firecracker, 1)).After(1, 2f)
                        .Hint("铁牛仰头吸气时炉门敞开——顶着吸力往炉门里打；栈桥两侧都是熔岩"))
                .Gather(1.2f).Distance(10, 34), "upgrade");
            var s5 = Site(5, "铸范库守军", Site5, 14, 18, SG.EncounterSpec.Of(
                    Wave("铸范库守军", E(Mamian, 1).Elite("shielded"), E(Tantong, 2), E(Huodou, 1)))
                .Gather(0.4f).Distance(8, 26), "");
            s5.autoTrigger = false;
            s5.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<SG.LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "下到铸神井底";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;

            // 藏宝：A 在上环 φ 0.40 的炼渣龛里（直接给），B 在 φ 0.875 的铸范库里（惊动 ⑤ 守军，肃清后给秘卷）
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
            Cache("Cache A · 炼渣龛", "炼渣里的金块", CacheA, P(0.40f, 70f), "coins", null, 14);
            Cache("Cache B · 铸范库", "铸范库秘藏", CacheB, Site5, "scroll", s5, 14);
            return objective;
        }

        /// <summary>出口传送门：嵌在出口祭坛正面（没有祭坛模型时自己立石门框），关卡目标完成后升起、落清关宝箱</summary>
        static void BuildExit(GameObject shrine, SG.LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<SG.ExitPortal>();
            var face = shrine ? shrine.transform.forward : new Vector3(-Rad(0.5f).x, 0, -Rad(0.5f).y);
            face.y = 0;
            face.Normalize();
            var at = ShrineAt + new Vector2(face.x, face.z) * 1.2f;
            portal.transform.SetPositionAndRotation(ts.OnGround(at.x, at.y), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
        }

        /// <summary>
        /// 升降台验收：两站高差、台面在下站的导航网格上、出生点走得到下站和上站栈桥（走路的路线绕螺旋，升降台只是捷径）、
        /// 台面上下行的整段竖直空间（井架立柱之间）没有碰撞体挡着、上站台面和栈桥对齐
        /// </summary>
        static void CheckLift(LevelKit.Report rep, SG.ForgeWellLift lift)
        {
            rep.Section("炉坛升降台（ForgeWellLift）");
            float rise = lift.highPosition.y - lift.lowPosition.y;
            rep.Line($"下站 y {lift.lowPosition.y:F2} → 上站 y {lift.highPosition.y:F2}（升 {rise:F1} m，{rise / Mathf.Max(0.1f, lift.speed):F1} s + 加减速），通电场地「{(lift.powerSite ? lift.powerSite.title : "无")}」");
            if (rise < 10f) rep.Fail($"升降台只升 {rise:F1} m（应约 14 m：井底 → 上环岩台沿）");
            if (!lift.powerSite) rep.Fail("升降台没有接上通电场地（④ 井底炉坛）");
            Physics.SyncTransforms();
            var spawn = OnGround(Spawn);
            if (!LevelContext.NavPoint(spawn, 4f, out var spawnNav)) rep.Fail("出生点附近没有 NavMesh");
            else
            {
                foreach (var (what, at) in new[] { ("下站台面", lift.lowPosition), ("上站栈桥", At(P(0.5f, GangwayTo - 1.5f), lift.highPosition.y)) })
                {
                    if (!LevelContext.NavPoint(at, 1.5f, out var q)) rep.Fail($"升降台{what} 1.5 m 内没有 NavMesh");
                    else if (LevelContext.NavPath(spawnNav, q, out float len) != UnityEngine.AI.NavMeshPathStatus.PathComplete) rep.Fail($"出生点走不到升降台{what}");
                    else rep.Line($"✓ 出生点 → 升降台{what}：路径 {len:F0} m");
                }
            }
            // 竖直通道：台面沿途扫一遍（不含台面自己、吊索、井架）
            var own = new HashSet<Collider>(lift.GetComponentsInChildren<Collider>(true));
            var half = new Vector3(DeckSize * 0.5f - 0.1f, 0.9f, DeckSize * 0.5f - 0.1f);
            var rot = lift.deck ? lift.deck.rotation : Quaternion.identity;
            var blockers = new HashSet<string>();
            for (float y = lift.lowPosition.y + 1.2f; y <= lift.highPosition.y + 1.0f; y += 0.5f)
                foreach (var c in Physics.OverlapBox(new Vector3(lift.lowPosition.x, y, lift.lowPosition.z), half, rot, LevelContext.BlockMask, QueryTriggerInteraction.Ignore))
                    if (!own.Contains(c) && c is not TerrainCollider) blockers.Add(c.name);
            if (blockers.Count > 0) rep.Fail($"升降台竖直通道被挡：{string.Join("、", blockers.Take(4))}");
            else rep.Line("✓ 升降台竖直通道（台面以上 1.8 m 的整段）没有碰撞体挡着");
            var deckTopHigh = lift.highPosition.y;
            var gangwayTop = LevelContext.GroundY(At(P(0.5f, GangwayFrom + 1f), deckTopHigh + 0.5f), 1.5f);
            if (Mathf.Abs(gangwayTop - deckTopHigh) > 0.1f) rep.Fail($"上站台面 y {deckTopHigh:F2} 和栈桥 y {gangwayTop:F2} 没对齐");
            else rep.Line($"✓ 上站台面与栈桥齐平（差 {Mathf.Abs(gangwayTop - deckTopHigh):F2} m）");
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；顺带重新生成 GameDatabase（同 1-x）</summary>
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
            int sites = Count<SG.EncounterSite>(), caches = Count<SG.CachePOI>(), portals = Count<SG.ExitPortal>(), lava = Count<SG.LavaVolume>(), lifts = Count<SG.ForgeWellLift>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1），藏宝 {caches}，出口 {portals}，熔岩 {lava}（熔岩井 + 熔瀑池），升降台 {lifts}");
            if (sites != 5) rep.Fail($"遭遇场地有 {sites} 个（应为 5）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 个（应为 2）");
            if (portals != 1) rep.Fail($"出口传送门有 {portals} 个（应为 1）");
            if (lava != 2) rep.Fail($"熔岩有 {lava} 片（应为 2：熔岩井、熔瀑池）");
            if (lifts != 1) rep.Fail($"升降台有 {lifts} 座（应为 1）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给验收规则集（<see cref="LevelValidator"/>，L5）的声明：主线路点（出生 → ① → 东横坡 → ③ → 下环 → ④ → 升降台下站 → 西横坡 → ② → 出口铸门）、
        /// 坡度路径（螺旋中线两段、两条横坡、三座俯射台的六道坡）、地标视线（悬炉全程、祝融像、眺台俯瞰熔岩井、③ 望熔瀑、④ 望升降台井架、② 望出口祭坛），
        /// 场地尺寸 / 掩体 / 层数阈值（只防退化，实测看报告）。可玩区遮罩与软边界同一个；界外是 19 m 以上的内壁，防越界由地形保证。
        /// 站位、宝箱落点、藏宝、出口、占位件由检查项自己从场景里找。占位：ART6 件暂缓建模，按默认 Fail 列出来（maps/3-2.md §9）。
        /// </summary>
        static LevelSpec Spec(Vector3 zhurongTop)
        {
            Vector3 G(Vector2 q, float dy = 0) => OnGround(q, dy);
            SiteSpec Site(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var forge = new Vector3(Well.center.x, ForgeBaseY - 0.5f, Well.center.y);
            var lavaTarget = new Vector3(Well.center.x, LavaY + 0.1f, Well.center.y - 4f);
            var fallMid = At(P(PoolPhi, Inner(PoolPhi) - Well.riser + 0.6f), (PoolLevel + Lv(PoolPhi) - 2.5f) * 0.5f);
            var spec = new LevelSpec
                {
                    id = "3-2", title = "铸神井", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        Site("出生·井口栈台（缓冲）", Spawn, 30, combat: false),
                        Site("① 炼渣回廊", Site1, 48, cover: 3, layers: 3, overlook: true),
                        Site("② 风口", Site2, 48, cover: 3, layers: 3, overlook: true),
                        Site("③ 熔瀑", Site3, 46, cover: 3, layers: 2, overlook: true),
                        Site("④ 井底炉坛", Site4, 44, cover: 3, layers: 2, overlook: true),
                    },
                }
                .Route("出生·井口栈台", G(Spawn)).Route("① 炼渣回廊", G(Site1)).Route("东横坡顶", G(P(0.307f, Inner(0.307f) + 3f)))
                .Route("东横坡脚", G(Ramps[0].path[0])).Route("③ 熔瀑", G(Site3)).Route("下环尽头", G(P(0.45f, 36f)))
                .Route("④ 井底炉坛", G(Site4)).Route("升降台下站", G(LiftXZ)).Route("西横坡脚", G(Ramps[1].path[0]))
                .Route("西横坡顶", G(P(0.717f, Inner(0.717f) + 3f))).Route("② 风口", G(Site2)).Route("出口铸门", G(ExitFront))
                .Sight("出生 → 悬炉", G(Spawn, 1.62f), forge, 9, HangingForgeId)
                .Sight("出生 → 祝融像", G(Spawn, 1.62f), zhurongTop, 6, ZhurongId)
                .Sight("井口眺台 → 熔岩井", G(Lookout, 1.62f), lavaTarget, 2)
                .Sight("① 回廊 → 悬炉", G(P(0.17f, 74f), 1.62f), forge, 9, HangingForgeId)
                .Sight("② 风口 → 悬炉", G(P(0.60f, 60f), 1.62f), forge, 9, HangingForgeId)
                .Sight("③ 熔瀑 → 悬炉", G(Site3, 1.62f), forge, 9, HangingForgeId)
                .Sight("③ 熔瀑 → 熔瀑", G(Site3, 1.62f), fallMid, 2)
                .Sight("④ 炉坛 → 升降台井架", G(Site4, 1.62f), At(LiftXZ, HeadframeTop - 0.6f), 2)
                .Sight("② 风口 → 出口祭坛", G(P(0.60f, 62f), 1.62f), At(ShrineAt, GroundY(ShrineAt) + 8f), 4, ShrineId);
            spec.slopePaths.Add(new SlopePath { name = "螺旋岩台（上环中线）", points = UpperLine });
            spec.slopePaths.Add(new SlopePath { name = "螺旋岩台（下环中线）", points = LowerLine });
            foreach (var rp in Ramps) spec.slopePaths.Add(new SlopePath { name = rp.name, points = rp.path });
            for (int i = 0; i < Platforms.Length; i++)
                foreach (var (foot, top, _) in PlatformRamps[i])
                    spec.slopePaths.Add(new SlopePath { name = $"{Platforms[i].name}坡道", points = new[] { foot, top } });
            return spec;
        }
    }
}
