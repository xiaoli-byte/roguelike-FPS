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
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-1 熔湖堤道（docs/level-design/maps/3-1.md；docs/unity-parity.md M31、3.10「3-x 改成火山口、岛和堤道」；Three.js V2 inferno-1-v2 只取教学点）：
    /// 关卡坐标 = 世界 XZ（米；x 向东、z 向北），熔岩面 y = 0。火山口底约 294 × 250 m，中间一整片熔岩湖（湖椭圆 108 × 80 m，熔岩岸线再往外约 6 m）：
    ///
    ///   出生·渡口台 (0,−101) +7 m：南崖下的锥形土台，俯瞰整片湖 → 南岸东西两个渡口
    ///   → ① 税关墩 (−58,−22)：墩顶 +2.2、税亭台 +5.2；炭童群 + 祸斗
    ///   → ② 锚链墩 (62,−14)：4 根 5 m 锚链桩（毕方栖点，桩顶各拖一条巨链没入熔岩）、绞盘台 +5.2
    ///   → ③ 镇湖鼎台 (−4,30)：三条堤道交汇的墩，倾覆巨鼎、鼎台 +5.2
    ///   → ④ 宫门码头 (0,108)：北岸码头 +2.4，南缘缓坡入湖（火鼍潜游岸线），东西鼓楼台 +5.9，北面出口神龛、宫墙、角楼；北崖顶坐着祝融神像（全图地标）。
    /// 八条堤道（C1–C8）把南岸、三座墩、东西两岸、码头、湖心石龛连成网：堤面比熔岩高 0.9 m，两侧 4 m 宽的堤肩缓坡直接没入熔岩——
    /// 人形导航网格从堤肩连到熔岩区，击退沿导航网格把敌人推下去（L7 判烧死）；墩的边缘也是没入熔岩的缓坡。四个必清场地任意顺序。
    ///
    /// 边界（D14，没有空气墙）：火山口底多边形外 5.5 m 内陡升成 21–27 m 的崖，崖顶外是火山口外坡；软边界沿同一个遮罩只做兜底。熔岩在游玩区里，掉下去由 L7 托回。
    /// 第三章新模型暂缓（docs/art/ch3-kit.md）：堤道、墩、台全部是地形；登记过的堤墩 / 堤道段只在不承重的地方 PlaceOrBox 占位（湖心石龛的墩、湖里两段旧堤残段）。
    /// 场景只放环境和标记（D17 / L1）。生成：Spiritfire ▸ Levels ▸ Build 3-1 熔湖堤道（或 bridge.sh level 3-1）。冒烟：bridge.sh playtest map-3-1（Map31Suite）。
    /// </summary>
    [LevelBuilder("3-1", ScenePath)]
    public static class Level_3_1
    {
        public const string Dir = "Assets/Levels/L3_1_Causeway";
        public const string ScenePath = "Assets/Scenes/L3_1_Causeway.unity";
        const string Name = "L3_1";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（湖床 −0.9 也在高度场里）；火山口外坡落到远景地面 PlainY</summary>
        const float Base = 10f, HeightRange = 64f, PlainY = 6f;
        static readonly Vector2 Origin = new(-256, -248), Size = new(512, 512);
        /// <summary>雾（主题默认 18 / 170 m）：调远，出生点隔着整片湖看得见宫门和崖顶神像</summary>
        const float FogStart = 50f, FogEnd = 330f;
        /// <summary>常风：从北崖（火山主峰方向）吹向南，周期落灰从北边压过来</summary>
        static readonly Vector2 Wind = new Vector2(-0.3f, -0.95f).normalized;
        /// <summary>软边界（L3）：等值线在崖面上，烟尘白化（火狱主题），26 m 外兜底碰撞；越界验收按兜底环算</summary>
        static readonly LevelKit.BoundarySpec Bounds = InfernoBounds();

        static LevelKit.BoundarySpec InfernoBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Inferno";
            return b;
        }

        // ───────────── 高度（世界 y）─────────────
        /// <summary>熔岩面、湖床、堤面、湖边岸、码头、墩顶、湖心石龛的墩面（白盒顶）</summary>
        const float LavaY = 0f, BedY = -0.9f, DeckY = 0.9f, ShoreY = 1.6f, QuayY = 2.4f, IsleTop = 2.2f, PierTop = 1.6f;
        /// <summary>岸上碎屑坡：湖边 +1.6 往崖脚升 3.6 m（离湖边 14 → 42 m）</summary>
        const float TalusRise = 3.6f;
        /// <summary>崖：坡脚以上 21–27 m，崖面 5.5 m 宽（≈ 76°），坡脚内侧 3 m 宽、1 m 高的碎屑坡</summary>
        const float WallH = 21f, WallVar = 6f, WallFace = 5.5f;

        // ───────────── 湖 ─────────────
        static readonly Vector2 LakeC = new(0, 8), LakeR = new(108, 80);
        /// <summary>岸带宽（湖床 → 岸上，≤ 17°）、湖岸不规则度、噪声种子</summary>
        const float LakeShoreW = 12f, LakeIrregular = 0.05f;
        const int LakeSeed = 7;
        /// <summary>L7 熔岩盒：盖住整片湖（岸、墩、堤靠高度排除）</summary>
        static readonly Vector2 LavaBox = new(240, 186);
        const float LavaDepth = 2.5f;

        // ───────────── 场地 ─────────────
        static readonly Vector2 Spawn = new(0, -101), QuaySite = new(0, 108), GuardSite = new(-127, 30);
        /// <summary>出生土台：台顶 +7（半径 8 m），四面 0.26（14.6°）缓坡</summary>
        const float MoundY = 7f, MoundR = 8f, MoundGrade = 0.26f;
        /// <summary>码头压平区（2.4 m），北缘贴崖</summary>
        static readonly Vector2 QuayMin = new(-42, 99), QuayMax = new(42, 133);
        /// <summary>堤道在岸上的端点：南岸东西渡口、西岸、东岸、码头登岸口</summary>
        static readonly Vector2 FerryW = new(-30, -86), FerryE = new(30, -86), ShoreW = new(-124, -28), ShoreE = new(128, -8), Landing = new(2, 100);
        /// <summary>出口神龛（贴北崖，正面朝南）、北崖顶的祝融神像</summary>
        static readonly Vector2 ShrineAt = new(0, 126), StatueAt = new(0, 152);
        const float StatueScale = 1.6f;
        /// <summary>西壁岩龛（藏宝 B）</summary>
        static readonly Vector2 AlcoveC = new(-149, 30), CacheB = new(-150, 30);
        const float AlcoveR = 8f;

        /// <summary>火山口底（游玩区）多边形：外面是崖。北缘在码头一段拉直，宫墙贴得齐</summary>
        static readonly Vector2[] Envelope =
        {
            new(147, 10), new(143, 40), new(131, 70), new(110, 96), new(80, 116), new(48, 131), new(16, 133), new(-16, 133), new(-48, 131),
            new(-80, 116), new(-110, 96), new(-131, 70), new(-143, 40), new(-147, 10), new(-143, -20), new(-131, -50), new(-110, -76), new(-80, -98),
            new(-46, -112), new(-18, -117), new(18, -117), new(46, -112), new(80, -98), new(110, -76), new(131, -50), new(143, -20),
        };

        // ───────────── 墩 ─────────────
        /// <summary>玄武岩墩：顶平（rt 内），四周 ring 米宽的缓坡没入湖床（≤ 33°，墩的边缘就是熔岩，没有墙）</summary>
        readonly struct Isle
        {
            public readonly string name;
            public readonly Vector2 c;
            public readonly float rt, ring, top, wobble;
            public readonly int seed;

            public Isle(string name, Vector2 c, float rt, float ring, float top, float wobble, int seed)
            {
                this.name = name;
                this.c = c;
                this.rt = rt;
                this.ring = ring;
                this.top = top;
                this.wobble = wobble;
                this.seed = seed;
            }
        }

        static readonly Isle Toll = new("① 税关墩", new Vector2(-58, -22), 17, 8, IsleTop, 0.6f, 11);
        static readonly Isle Anchor = new("② 锚链墩", new Vector2(62, -14), 20, 8, IsleTop, 0.6f, 12);
        static readonly Isle Hub = new("③ 镇湖鼎台", new Vector2(-4, 30), 16, 8, IsleTop, 0.6f, 13);
        /// <summary>湖心石龛：地形小墩（+1.45）上压一块堤墩白盒（10 × 3 × 10，顶面 +1.6，C8 窄堤平接）</summary>
        static readonly Isle Islet = new("湖心石龛", new Vector2(20, -36), 4.5f, 6, PierTop - 0.15f, 0.25f, 14);
        static readonly Isle[] Isles = { Toll, Anchor, Hub, Islet };

        // ───────────── 台（地形台基 + 坡道）─────────────
        readonly struct Terrace
        {
            public readonly string name;
            public readonly Vector2 c, half, foot, top;
            public readonly float baseY, rise, rampWidth;

            public Terrace(string name, Vector2 c, Vector2 half, float baseY, float rise, Vector2 foot, Vector2 top, float rampWidth)
            {
                this.name = name;
                this.c = c;
                this.half = half;
                this.baseY = baseY;
                this.rise = rise;
                this.foot = foot;
                this.top = top;
                this.rampWidth = rampWidth;
            }

            public float TopY => baseY + rise;
        }

        static readonly Terrace TollTerrace = new("① 税亭台", new Vector2(-63, -16), new Vector2(6, 5), IsleTop, 3f, new Vector2(-46, -16), new Vector2(-56.5f, -16), 5f);
        // 坡顶都停在台基边外 0.5 m：坡道按自己的延伸段压进台面，盖住台基边 1 m 的软边（不在坡顶留一道小坎）
        static readonly Terrace WinchTerrace = new("② 绞盘台", new Vector2(63, -14), new Vector2(6, 6), IsleTop, 3f, new Vector2(45, -14), new Vector2(56.5f, -14), 5f);
        static readonly Terrace CauldronTerrace = new("③ 鼎台", new Vector2(-4, 33), new Vector2(6.5f, 4), IsleTop, 3f, new Vector2(-4, 18), new Vector2(-4, 28.5f), 5f);
        static readonly Terrace DrumW = new("④ 西鼓楼台", new Vector2(-25, 113), new Vector2(5.5f, 5), QuayY, 3.5f, new Vector2(-7.5f, 110.5f), new Vector2(-19f, 110.5f), 4.5f);
        static readonly Terrace DrumE = new("④ 东鼓楼台", new Vector2(25, 113), new Vector2(5.5f, 5), QuayY, 3.5f, new Vector2(7.5f, 110.5f), new Vector2(19f, 110.5f), 4.5f);
        static readonly Terrace[] Terraces = { TollTerrace, WinchTerrace, CauldronTerrace, DrumW, DrumE };
        static readonly (Vector2 foot, Vector2 top, float width)[] NoRamps = Array.Empty<(Vector2, Vector2, float)>();

        // ───────────── 堤道 ─────────────
        /// <summary>一条堤道：样条 + 纵断面（只填不挖），堤面半宽 half，两侧 <see cref="CausewayEdge"/> 米宽的堤肩缓坡没入熔岩</summary>
        sealed class Causeway
        {
            public string id, label;
            public PathSpline path;
            public float half;
        }

        /// <summary>堤肩宽（堤面 0.9 → 湖床 −0.9，≤ 38°：人形导航网格连到熔岩区，击退推得下去）；上墩 / 上岸 / 登码头的引坡长度（9°）</summary>
        const float CausewayEdge = 4f, IsleRamp = 7.7f, ShoreRamp = 6f, LandingRamp = 9.5f, IsletRamp = 9.4f, IsletFace = 5f;

        static Vector2 Edge(in Isle i, Vector2 toward, float off) => i.c + (toward - i.c).normalized * (i.rt + off);

        /// <summary>
        /// a0（高 h0）→ a1（堤面）→ 中点（侧偏 bend 米）→ b1（堤面）→ b0（高 hb）；纵断面按弧长线性插值、限坡 12°。
        /// 不做滑动平均：端点要正好等于墩顶 / 岸上的高度（不然堤头会把墩顶削出一个浅碟），9° 的引坡折点走起来无感
        /// </summary>
        static Causeway Make(string id, string label, float half, float bend, Vector2 a0, float h0, Vector2 a1, Vector2 b1, Vector2 b0, float hb)
        {
            var dir = (b1 - a1).normalized;
            var mid = (a1 + b1) * 0.5f + new Vector2(-dir.y, dir.x) * bend;
            var path = new PathSpline(new[] { a0, a1, mid, b1, b0 }, 6).WithHeights(new[] { h0, DeckY, DeckY, DeckY, hb }, 0, 12f);
            return new Causeway { id = id, label = label, path = path, half = half };
        }

        static Causeway[] BuildCauseways()
        {
            Causeway IsleToIsle(string id, string label, Isle a, Isle b, float bend) =>
                Make(id, label, 4f, bend, Edge(a, b.c, -0.5f), a.top, Edge(a, b.c, IsleRamp), Edge(b, a.c, IsleRamp), Edge(b, a.c, -0.5f), b.top);
            Causeway ShoreToIsle(string id, string label, Vector2 shore, Isle b, float bend)
            {
                var u = (b.c - shore).normalized;
                return Make(id, label, 4f, bend, shore, Ground0(shore), shore + u * ShoreRamp, Edge(b, shore, IsleRamp), Edge(b, shore, -0.5f), b.top);
            }
            var toLanding = (Landing - Edge(Hub, Landing, 0)).normalized;
            var toAnchor = (Anchor.c - Islet.c).normalized;
            return new[]
            {
                ShoreToIsle("C1", "南岸西堤", FerryW, Toll, 3f),
                ShoreToIsle("C2", "南岸东堤", FerryE, Anchor, -3f),
                IsleToIsle("C3", "西中堤", Toll, Hub, 5f),
                IsleToIsle("C4", "东中堤", Anchor, Hub, -5f),
                Make("C5", "北堤（御道）", 4.5f, 4f, Edge(Hub, Landing, -0.5f), Hub.top, Edge(Hub, Landing, IsleRamp), Landing - toLanding * LandingRamp, Landing, QuayY),
                ShoreToIsle("C6", "西岸堤", ShoreW, Toll, 3f),
                ShoreToIsle("C7", "东岸堤", ShoreE, Anchor, -3f),
                Make("C8", "石龛窄堤", 3.5f, 0f, Edge(Anchor, Islet.c, -0.5f), Anchor.top, Edge(Anchor, Islet.c, IsleRamp), Islet.c + toAnchor * IsletRamp,
                    Islet.c + toAnchor * IsletFace, PierTop),
            };
        }

        /// <summary>八条堤道（放在所有字段之后：纵断面要用岸上的地面高度 <see cref="Ground0"/>）</summary>
        static readonly Causeway[] Causeways = BuildCauseways();

        // ───────────── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深；已有 Prefab 的取导出包围盒）─────────────
        const string PierId = "SM_Tripo_InfernoCausewayPier", SegmentId = "SM_Tripo_InfernoCausewaySegment", ChainLinkId = "SM_Prop_InfernoChainLink",
            ColumnId = "SM_Tripo_InfernoColumn", StatueId = "SM_Tripo_InfernoZhurong", ShrineId = "SM_Tripo_InfernoPortalShrine", RampartId = "SM_Tripo_InfernoRampart",
            TowerId = "SM_Tripo_InfernoFurnaceTower", StallId = "SM_Tripo_InfernoForgeStall", BarricadeId = "SM_Tripo_InfernoBarricade",
            CoverWallId = "SM_Tripo_InfernoCoverWall", CauldronId = "SM_Tripo_InfernoCauldronRuin", IngotId = "SM_Tripo_InfernoIngotPile",
            AltarId = "SM_Tripo_InfernoFireAltar", HoardId = "SM_Tripo_InfernoTreasureHoard", ObeliskId = "SM_Prop_InfernoChainObelisk", CrucibleId = "SM_Prop_InfernoCrucible";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            // 第三章暂缓件（registry reference_dimensions，ART6）
            [PierId] = new(20f, 6f, 20f), [SegmentId] = new(12f, 5f, 12f),
            // 已导出的火狱套件（ArtAssetInfo.designBounds）
            [ChainLinkId] = new(0.65f, 0.99f, 0.19f), [ColumnId] = new(1.97f, 4.93f, 1.81f), [StatueId] = new(7.8f, 15.43f, 6.83f),
            [ShrineId] = new(7.59f, 10.68f, 2.15f), [RampartId] = new(7.59f, 8.82f, 2.36f), [TowerId] = new(6.13f, 12.86f, 4.99f),
            [StallId] = new(2.6f, 3.47f, 1.63f), [BarricadeId] = new(3.56f, 1.18f, 0.47f), [CoverWallId] = new(3.42f, 2.48f, 0.89f),
            [CauldronId] = new(3.11f, 1.54f, 1.53f), [IngotId] = new(2.18f, 1.52f, 1.81f), [AltarId] = new(1.13f, 2.36f, 1.15f),
            [HoardId] = new(2.31f, 1.71f, 1.56f), [ObeliskId] = new(1.08f, 2.13f, 1.08f), [CrucibleId] = new(1.27f, 0.99f, 1.28f),
        };

        /// <summary>锚链桩（SM_Tripo_InfernoColumn）的高；桩底埋进地面 0.25 m</summary>
        const float ColumnH = 4.93f, ColumnSink = 0.25f;
        /// <summary>巨链：链环放大倍数（节距 0.68 m × 倍数）、垂度、链尾没入熔岩的半径（离墩心）</summary>
        const float ChainScale = 1.3f, ChainSag = 1.2f, ChainReach = 27f;

        // ── 第三章阵容（V2）──
        const string Tantong = "tantong", Huodou = "huodou", Bifang = "bifang", Tuo = "tuo", Mamian = "mamian", Firecracker = "firecracker", FireCrow = "fire_crow";

        /// <summary>
        /// 刷怪站位（标记名、属于哪个场地、位置、角色、lane、高台、散开半径）。全部在墩顶 / 码头的平地上，离熔岩岸线 ≥ 5 m、离摆件 ≥ 2 m；
        /// 高台站位只给会飞的（毕方、飞鸦）且在台顶的导航网格上；马面、炮仗傀儡这类贴地远程站在坡道走得上去的台顶。
        /// 毕方不在桩顶出生（桩顶没有导航网格），出生后自己飞上锚链桩（PerchPoint）。
        /// </summary>
        static readonly (string name, int site, Vector2 at, StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            // ① 税关墩：三个堤头方向的炭童 / 祸斗，税亭台上的马面
            ("Enemy_1_North", 1, new Vector2(-56, -8), StationRole.Assault, 0, false, 2f),
            ("Enemy_1_South", 1, new Vector2(-64, -36), StationRole.Assault, 1, false, 2f),
            ("Enemy_1_FlankW", 1, new Vector2(-73, -16), StationRole.Flank, 1, false, 2f),
            ("Enemy_1_FlankE", 1, new Vector2(-44, -27), StationRole.Flank, 2, false, 2f),
            ("Enemy_1_Terrace", 1, new Vector2(-61, -15), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_1_Center", 1, new Vector2(-58, -27), StationRole.Auto, 0, false, 1.5f),
            // ② 锚链墩：绞盘台上的毕方（起飞找桩），墩北 / 墩南正面，西 / 东侧翼，东北炮位
            ("Enemy_2_Terrace", 2, new Vector2(63, -14), StationRole.Precision, 0, true, 1.2f),
            ("Enemy_2_North", 2, new Vector2(62, 1), StationRole.Assault, 0, false, 2f),
            ("Enemy_2_South", 2, new Vector2(70, -31), StationRole.Assault, 1, false, 2f),
            ("Enemy_2_FlankW", 2, new Vector2(48, -9), StationRole.Flank, 1, false, 1.5f),
            ("Enemy_2_FlankE", 2, new Vector2(76, -19), StationRole.Flank, 2, false, 1.5f),
            ("Enemy_2_Artillery", 2, new Vector2(70, 0), StationRole.Artillery, 0, false, 1.5f),
            // ③ 镇湖鼎台：鼎台上的马面 / 飞鸦，北堤头正面，西 / 东侧翼，南面炮位
            ("Enemy_3_Terrace", 3, new Vector2(-4, 34), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_3_TerraceAir", 3, new Vector2(0, 35), StationRole.Flank, 0, true, 1f),
            ("Enemy_3_North", 3, new Vector2(-4, 43), StationRole.Assault, 0, false, 2f),
            ("Enemy_3_West", 3, new Vector2(-15.3f, 36.5f), StationRole.Flank, 1, false, 1.5f),
            ("Enemy_3_East", 3, new Vector2(8.8f, 32.3f), StationRole.Flank, 2, false, 1.5f),
            ("Enemy_3_South", 3, new Vector2(2.5f, 18.7f), StationRole.Artillery, 1, false, 1.5f),
            // ④ 宫门码头：南缘岸上（火鼍从这里爬进熔岩），鼓楼台远程 / 炮位，东西侧翼，神龛前
            ("Enemy_4_Beach", 4, new Vector2(-14, 101), StationRole.Assault, 0, false, 2f),
            ("Enemy_4_BeachE", 4, new Vector2(17, 99), StationRole.Assault, 1, false, 2f),
            ("Enemy_4_TerraceW", 4, new Vector2(-25, 113), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_4_TerraceE", 4, new Vector2(25, 113), StationRole.Artillery, 0, false, 1.2f),
            ("Enemy_4_FlankW", 4, new Vector2(-35, 104), StationRole.Flank, 1, false, 2f),
            ("Enemy_4_FlankE", 4, new Vector2(35, 104), StationRole.Flank, 2, false, 2f),
            ("Enemy_4_Gate", 4, new Vector2(0, 116), StationRole.Auto, 0, false, 1.5f),
            // ⑤ 熔铸遗址守军（可选，调查藏宝 B 时惊动）
            ("Enemy_5_A", 5, new Vector2(-124, 22), StationRole.Flank, 1, false, 2f),
            ("Enemy_5_B", 5, new Vector2(-131, 40), StationRole.Assault, 0, false, 2f),
            ("Enemy_5_C", 5, new Vector2(-118, 34), StationRole.Artillery, 0, false, 1.5f),
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        /// <summary>
        /// 不含墩、堤、台的口底（岸上碎屑坡 + 码头压平 + 出生土台）；k = 湖岸遮罩（湖床 0 → 岸上 1），rho = 离湖椭圆的米数（湖内为负），quay = 码头遮罩
        /// </summary>
        static float Floor(Vector2 q, out float k, out float rho, out float quay)
        {
            k = LakeShore(q, LakeC, LakeR, LakeShoreW, LakeIrregular, LakeSeed, out _, out _, out rho);
            float f = ShoreY + TalusRise * Smooth(14, 42, rho) + Fbm(q, 40, 3, 3) * 0.35f * Smooth(10, 22, rho);
            quay = 1 - Smooth(0, 5, LevelKit.BoxSdf(q, QuayMin, QuayMax));
            f = Mathf.Lerp(f, QuayY, quay);
            float dm = Vector2.Distance(q, Spawn);
            return Mathf.Max(f, MoundY - MoundGrade * Mathf.Max(0, dm - MoundR));
        }

        /// <summary>岸上的地面高度（堤道在岸上的端点从这里取，不递归）</summary>
        static float Ground0(Vector2 q) => Floor(q, out _, out _, out _);

        /// <summary>墩的高度（离墩太远返回 −∞）；top = 墩顶遮罩，ring = 坡腰遮罩</summary>
        static float IsleHeight(Vector2 q, in Isle i, out float top, out float ring)
        {
            top = ring = 0;
            float d = Vector2.Distance(q, i.c);
            if (d > i.rt + i.ring + 3) return float.MinValue;
            d += Fbm(q, 14, 2, i.seed) * i.wobble;
            float t = Mathf.Clamp01((d - i.rt) / i.ring);
            float sm = Smooth(0, 1, t);
            top = 1 - Smooth(-1f, 0.5f, d - i.rt);
            ring = (1 - top) * (1 - Smooth(0.85f, 1f, t));
            return i.top - (i.top - BedY) * sm + Fbm(q, 6, 2, i.seed + 3) * 0.04f * (1 - sm);
        }

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：多边形 + 西壁岩龛，崖线带噪声摆动（码头一段不摆）</summary>
        static float Inside(Vector2 q)
        {
            float ins = LevelKit.PolygonSigned(q, Envelope);
            float calm = Disc(q, new Vector2(0, 128), 46, 10);
            ins += (Fbm(q, 18, 3, 41) * 1.6f + Fbm(q, 5, 2, 43) * 0.5f) * (1 - calm);
            return Mathf.Max(ins, AlcoveR - Vector2.Distance(q, AlcoveC));
        }

        /// <summary>可玩区遮罩（软边界与 L5 共用）：等值线 0.2 落在崖面上（界外约 1.7 m）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        static LevelKit.Sample Eval(Vector2 q)
        {
            var s = new LevelKit.Sample();

            // ── 口底 + 湖床 ──
            float floor = Floor(q, out float k, out float rho, out float quay);
            float hb = Mathf.Lerp(BedY, floor, k);
            float moundTop = 1 - Smooth(MoundR - 1, MoundR + 1, Vector2.Distance(q, Spawn));

            // ── 墩 ──
            float hi = float.MinValue, plateau = 0, ringMask = 0;
            foreach (var isle in Isles)
            {
                hi = Mathf.Max(hi, IsleHeight(q, isle, out float top, out float ring));
                plateau = Mathf.Max(plateau, top);
                ringMask = Mathf.Max(ringMask, ring);
            }

            // ── 堤道 ──
            // 先让堤道「压」住它脚下的墩坡腰和湖岸：比纵断面高的那部分按堤面遮罩削到纵断面（上墩 / 上岸的引坡始终是 9°，
            // 不会在墩沿、岸边先顺着更陡的坡腰走一段）；再只填不挖地铺堤身和堤肩
            int nc = Causeways.Length;
            Span<float> cm = stackalloc float[nc];
            Span<float> ct = stackalloc float[nc];
            float deck = 0, cwAny = 0;
            for (int i = 0; i < nc; i++)
            {
                var cw = Causeways[i];
                var (d, t) = cw.path.Nearest(q, cw.half + CausewayEdge);
                float m = 1 - Smooth(cw.half, cw.half + CausewayEdge, d);
                cm[i] = m;
                if (m <= 0) continue;
                float top = ct[i] = cw.path.HeightAt(t);
                if (hb > top) hb = Mathf.Lerp(hb, top, m);
                if (hi > top) hi = Mathf.Lerp(hi, top, m);
                cwAny = Mathf.Max(cwAny, m);
                deck = Mathf.Max(deck, 1 - Smooth(cw.half - 0.8f, cw.half + 0.4f, d));
            }
            float h = Mathf.Max(hb, hi);
            for (int i = 0; i < nc; i++)
                if (cm[i] > 0)
                    h = Mathf.Max(h, Mathf.Lerp(h, ct[i], cm[i]));

            // ── 台基 + 坡道 ──
            float terraceTop = 0, rampAny = 0;
            foreach (var tr in Terraces)
            {
                float pv = Plateau(q, tr.c, tr.half, 0, tr.rise, 1.0f, NoRamps);
                if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(h, tr.baseY + pv, Smooth(0, 0.8f, pv)));
                terraceTop = Mathf.Max(terraceTop, Smooth(tr.rise - 0.4f, tr.rise - 0.05f, pv));
                var (t, m) = Ramp(q, tr.foot, tr.top, tr.rampWidth, 2.5f);
                if (m <= 0) continue;
                float target = Mathf.Lerp(tr.baseY, tr.TopY, Smooth(0, 1, t) * 0.3f + t * 0.7f);
                h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                rampAny = Mathf.Max(rampAny, m);
            }

            // ── 崖 + 火山口外坡 ──
            float ins = Inside(q);
            if (ins < 4f)
            {
                float wallH = WallH + WallVar * (Fbm(q, 60, 2, 31) * 0.5f + 0.5f);
                h = Mathf.Max(h, floor + LevelKit.RimProfile(ins, 1f * (1 - quay), 3f, wallH, WallFace));
                if (ins < -12f) h = Mathf.Lerp(h, PlainY + Fbm(q, 70, 2, 51) * 2f, Smooth(-12f, -95f, ins));
            }

            // ── 地形外缘 30 m 内落回远景地面 ──
            var local = q - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 30, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Inferno：岩 → 结壳熔岩 → 火山灰 → 剩下是冷却熔岩）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            s.fluid = 1 - Smooth(LavaY + 0.05f, LavaY + 0.45f, h);
            float band = Smooth(LavaY + 0.25f, LavaY + 0.6f, h) * (1 - Smooth(1.7f, 2.5f, h));
            s.shore = band * (1 - deck) * (1 - plateau) * (1 - quay) * inside;
            s.packed = Mathf.Max(Mathf.Max(deck * 0.9f, plateau * 0.7f), Mathf.Max(quay * 0.85f, terraceTop * 0.85f));
            s.packed = Mathf.Max(s.packed, Mathf.Max(rampAny * 0.8f, moundTop * 0.55f));
            s.sand = Mathf.Max(Smooth(16, 30, rho) * 0.65f * (1 - quay) * (1 - moundTop) * inside, (1 - inside) * Smooth(-8, -16, ins) * 0.5f);
            float cliffBand = Smooth(0.5f, -1.5f, ins) * (1 - Smooth(-7, -10, ins));
            s.rock = Mathf.Max(cliffBand, ringMask * 0.3f * (1 - cwAny));
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-1 熔湖堤道", priority = 71)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>构建期的地形（摆件、标记贴地用）</summary>
        static LevelKit.TerrainSet ts;

        static Vector3 G(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);

        /// <summary>让 Prefab 的 +Z 朝世界 XZ 方向 d 的偏航角</summary>
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        /// <summary>生成场景 → 熔岩 → 软边界 → 烘焙 NavMesh（人形 + 熔岩生物）→ 验收（L5 规则集 + 熔岩 + 本关的熔湖检查）→ 截图；返回不合格项数</summary>
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
                // 远景：玄武岩脊 + 两圈火山锥；火山口外坡落到远景地面
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, LakeC, PlainY, 760, 5);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);

                // 熔岩（L7）：一片盒子盖住整片湖，墩、堤、岸靠高度排除；NavMesh 的 Lava 区由它的体积标出
                var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Causeway Lake", center = new Vector3(LakeC.x, LavaY, LakeC.y), shape = LavaShape.Box, size = LavaBox, depth = LavaDepth, depthShore = true,
                }, world);

                // 软边界（没有空气墙）：等值线在崖面上，烟尘推回 + 白化，兜底环在 26 m 外
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                // 天气：北风；周期落灰（火山口上空飘灰，雾收到 12 / 120 m，不限远程锁定）。动态环境是熔岩本身
                LevelKit.Weather(env, theme, Wind, 0.25f, new WeatherDirector.Region
                {
                    name = "火山落灰", center = new Vector3(0, 0, 20), radius = 150, fade = 60, profile = WeatherProfiles.Ashfall,
                    from = new Vector2(0.3f, 0.95f).normalized, calm = 55, warn = 8, storm = 20, abate = 8, firstDelay = 40, armRadius = 400, loop = true,
                });

                var statueHead = BuildLandmarks(env);
                BuildFerry(props, markers);
                BuildToll(arch, props, markers);
                BuildAnchorPier(arch, props, markers);
                BuildHub(arch, props, markers);
                var shrine = BuildQuay(arch, props, markers);
                BuildIslet(arch, props);
                BuildShores(props, markers);
                BuildLakeRuins(world);
                BuildScatter(env, theme);
                BuildMarkers(markers);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝北崖顶的祝融神像）+ 自举标记
                var spawnAt = G(Spawn, 0.05f);
                var look = statueHead - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.sqrMagnitude > 1e-4f ? look.normalized : Vector3.forward);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

                var objective = BuildEncounters(markers);
                BuildCaches(markers, objective);
                var portal = BuildExit(markers, shrine, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                LevelKit.BakeLavaNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                var rep = new LevelKit.Report();
                rep.Line("3-1 熔湖堤道 · 验收");
                rep.Line($"高度：渡口台 {G(Spawn).y:F1}，西 / 东渡口 {G(FerryW).y:F1} / {G(FerryE).y:F1}，① 墩顶 {G(Toll.c + new Vector2(4, -6)).y:F1}（税亭台 {G(TollTerrace.c).y:F1}），" +
                         $"② 墩顶 {G(Anchor.c + new Vector2(0, 12)).y:F1}（绞盘台 {G(WinchTerrace.c).y:F1}），③ 墩顶 {G(Hub.c + new Vector2(8, -6)).y:F1}（鼎台 {G(CauldronTerrace.c).y:F1}），" +
                         $"码头 {G(QuaySite).y:F1}（鼓楼台 {G(DrumW.c).y:F1}），湖心 {G(LakeC).y:F1}（熔岩面 {LavaY:F1}）");
                LevelValidator.Run(Spec(statueHead), rep); // 主线、坡度、视线 + L5 规则集，见文件末尾的 Spec
                LevelKit.ValidateLava(rep);
                CheckLake(rep, lava);
                CheckSceneContents(rep, scene, portal);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项（占位件是第三章新模型暂缓造成的，见 docs/art/ch3-kit.md）");
                rep.Save($"{LevelKit.ReviewDir}/level_3-1_report.txt");

                if (review) Review(spawnAt, spawnRot, statueHead);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
            }
        }

        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 statueHead)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-1", new[]
                {
                    ("Aerial", new Vector3(-150, 170, -230), new Vector3(0, 0, 10), false),
                    ("Map", new Vector3(0, 420, 7), new Vector3(0, 0, 8), false),
                    ("Spawn", E(Spawn), statueHead, true),
                    ("FerryWest", E(FerryW + new Vector2(2, 4)), G(Toll.c, 3), false),
                    ("CausewayC3", E(Causeways[2].path.At(0.35f)), G(Hub.c, 4), false),
                    ("TollTerrace", E(TollTerrace.c + new Vector2(4, 0)), G(Hub.c, 4), false),
                    ("AnchorPier", E(Anchor.c + new Vector2(-4, 12)), G(Anchor.c + new Vector2(8.5f, -8.5f), 5), false),
                    ("HubTerrace", E(CauldronTerrace.c), statueHead, false),
                    ("Islet", E(Causeways[7].path.At(0.3f)), G(Islet.c, 1), false),
                    ("QuayBeach", E(Landing + new Vector2(-2, 2)), G(ShrineAt, 6), false),
                    ("DrumTerrace", E(DrumW.c + new Vector2(-3, 2)), G(Anchor.c, 3), false),
                    ("CacheB", E(GuardSite + new Vector2(8, 0)), G(CacheB, 1), false),
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
        /// 按 id 摆一件：底面中心 = at、世界 y = baseY（不给时贴地再往下埋 sink × scale）。有 Prefab 就按 scale 摆，
        /// 没有就放设计尺寸 × scale 的白盒（LevelKit.PlaceOrBox，Placeholder 标签，验收会列出来）
        /// </summary>
        static GameObject Put(string id, Transform parent, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, float? baseY = null)
        {
            var size = (DesignSize.TryGetValue(id, out var d) ? d : Vector3.one * 2) * scale;
            var p = baseY.HasValue ? At(at, baseY.Value) : G(at, -sink * scale);
            // 白盒用暗玄武岩色（默认的白在火狱的泛光下刺眼，同 3-3）
            var go = LevelKit.PlaceOrBox(id, parent, p, size, yaw, scale, LevelKit.Mat(Dir, "Ch3Placeholder", new Color(0.36f, 0.3f, 0.27f), 0.85f));
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>
        /// 锚链桩 / 毕方栖柱：桩底埋 0.25 m，桩顶补一块平的落脚碰撞（Tripo 网格的柱头不一定平），桩顶放 <see cref="PerchPoint"/> 标记（E3）。返回桩顶点
        /// </summary>
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

        /// <summary>地面上（台顶、码头）的栖落点标记：毕方换栖时优先挑它</summary>
        static void PerchMarker(Transform markers, string name, Vector3 at)
        {
            var m = new GameObject($"{PerchPoint.MarkerPrefix}_{name}");
            m.transform.SetParent(markers, false);
            m.transform.position = at + Vector3.up * 0.02f;
            m.AddComponent<PerchPoint>().radius = 1.5f;
        }

        /// <summary>
        /// 巨链（SM_Prop_InfernoChainLink，已发布）：a → b 一条下垂的链，链环沿切线摆、每隔一节绕自身长轴转 90°；纯装饰，拆掉碰撞（不挡导航、不挡毕方落脚）。
        /// 链环的原点在底端（长 0.99 m 沿 +Y）。没有链环 Prefab 时跳过（不放白盒）。返回链环数
        /// </summary>
        static int Chain(Transform parent, string name, Vector3 a, Vector3 b, float sag, float scale)
        {
            if (!ShowcaseSceneBuilder.Prefab(ChainLinkId))
            {
                Debug.LogWarning($"[Level] 缺少 Prefab {ChainLinkId}：{name} 不放链");
                return 0;
            }
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
                link.isStatic = true;
            }
            return n;
        }

        /// <summary>北崖顶的祝融神像（全图地标）；返回神像头部（视线目标）</summary>
        static Vector3 BuildLandmarks(Transform env)
        {
            float baseY = G(StatueAt).y - 0.6f;
            Put(StatueId, env, StatueAt, 180, StatueScale, 0, baseY);
            return At(StatueAt, baseY + DesignSize[StatueId].y * StatueScale * 0.86f);
        }

        /// <summary>出生·渡口台与南岸两个渡口：台顶两座火坛、渡口锁魂碑与货堆、两根栖柱</summary>
        static void BuildFerry(Transform props, Transform markers)
        {
            var root = new GameObject("出生 · 南岸渡口").transform;
            root.SetParent(props, false);
            Put(AltarId, root, Spawn + new Vector2(-6, -3), 180);
            Put(AltarId, root, Spawn + new Vector2(6, -3), 180);
            Put(ObeliskId, root, new Vector2(-36, -88), 30);
            Put(ObeliskId, root, new Vector2(36, -88), -30);
            Put(IngotId, root, new Vector2(-16, -90), 30);
            PerchPillar("FerryW", root, markers, new Vector2(-46, -92), 15);
            PerchPillar("FerryE", root, markers, new Vector2(46, -92), -15);
        }

        /// <summary>
        /// ① 税关墩：税亭（税亭台上）、税亭台顶坡道口两侧的火坛；墩南半圈离墩心 12 m 的残墙 / 税卡拒马 / 锚链桩（相隔约 10 m，
        /// L5 掩体检查把 2 m 内的掩体旁站位并成一处，三件各算一处）、北面一堆铁锭（扣下的货）
        /// </summary>
        static void BuildToll(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("① 税关墩").transform;
            root.SetParent(arch, false);
            Put(StallId, root, new Vector2(-66, -16), 90, 1.3f);
            Put(AltarId, root, new Vector2(-58.5f, -19.5f), 90, 1, 0, TollTerrace.TopY - 0.05f);
            Put(AltarId, root, new Vector2(-58.5f, -12.5f), 90, 1, 0, TollTerrace.TopY - 0.05f);
            var p = new GameObject("① 掩体").transform;
            p.SetParent(props, false);
            var wall = new Vector2(-67.8f, -28.9f);
            var barricade = new Vector2(-58, -34);
            Put(CoverWallId, p, wall, YawZ(Toll.c - wall), 1.2f);
            Put(BarricadeId, p, barricade, YawZ(Toll.c - barricade), 1.2f);
            Put(IngotId, p, new Vector2(-63, -8), 60);
            PerchPillar("Toll", root, markers, new Vector2(-48.2f, -28.9f), 0);
        }

        /// <summary>② 锚链墩：4 根锚链桩（毕方栖点）、锁魂碑、残墙、倾覆小鼎、绞盘台火坛；每根桩顶拖一条巨链没入熔岩</summary>
        static void BuildAnchorPier(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("② 锚链墩").transform;
            root.SetParent(arch, false);
            // 桩在半径 16 m 的 45° / 125° / 225° / 315° 方位（125° 让开 C4 堤头），锁魂碑在桩外 2.5 m；桩与桩、桩与绞盘台隔得够远，
            // L5 掩体检查里各算一处。链尾避开堤头（C7 5°、C4 146°、C8 208°、C2 246°）
            (float pillar, float chain)[] posts = { (45, 60), (125, 100), (225, 178), (315, 300) };
            int links = 0;
            foreach (var (pa, ca) in posts)
            {
                var dir = new Vector2(Mathf.Cos(pa * Mathf.Deg2Rad), Mathf.Sin(pa * Mathf.Deg2Rad));
                var at = Anchor.c + dir * 16f;
                var top = PerchPillar($"Anchor{pa:0}", root, markers, at, pa);
                Put(ObeliskId, root, Anchor.c + dir * 18.5f, pa + 90);
                var cdir = new Vector2(Mathf.Cos(ca * Mathf.Deg2Rad), Mathf.Sin(ca * Mathf.Deg2Rad));
                var from = top + new Vector3(cdir.x, 0, cdir.y) * 0.6f - Vector3.up * 0.4f;
                var to = At(Anchor.c + cdir * ChainReach, LavaY - 0.6f);
                links += Chain(root, $"Anchor{pa:0}", from, to, ChainSag, ChainScale);
            }
            Debug.Log($"[Level] 3-1 锚链墩：巨链 4 条共 {links} 节");
            Put(AltarId, root, new Vector2(58.5f, -9.5f), 0, 1, 0, WinchTerrace.TopY - 0.05f);
            Put(AltarId, root, new Vector2(67.5f, -18.5f), 0, 1, 0, WinchTerrace.TopY - 0.05f);
            var p = new GameObject("② 掩体").transform;
            p.SetParent(props, false);
            Put(CoverWallId, p, new Vector2(65, -30), 0, 1.2f);
            Put(CauldronId, p, new Vector2(75.5f, -13), 90, 1.6f);
        }

        /// <summary>
        /// ③ 镇湖鼎台：倾覆巨鼎（×2.4，3.7 m 高的全遮掩体）、鼎台火坛；C5 堤头两侧的拒马与残墙、东缘的铁锭堆、C3 堤头南侧一根栖柱
        /// （和鼎台侧壁、巨鼎都隔开 5.5 m 以上，L5 掩体检查里各算一处）
        /// </summary>
        static void BuildHub(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("③ 镇湖鼎台").transform;
            root.SetParent(arch, false);
            Put(CauldronId, root, new Vector2(-14, 30), 90, 2.4f, 0.2f);
            Put(AltarId, root, new Vector2(-9.5f, 30), 180, 1, 0, CauldronTerrace.TopY - 0.05f);
            Put(AltarId, root, new Vector2(1.5f, 30), 180, 1, 0, CauldronTerrace.TopY - 0.05f);
            PerchPillar("Hub", root, markers, new Vector2(-10, 17), 20);
            var p = new GameObject("③ 掩体").transform;
            p.SetParent(props, false);
            Put(BarricadeId, p, new Vector2(5, 43), 0, 1.2f);
            Put(CoverWallId, p, new Vector2(-11, 43.5f), 0, 1.2f);
            Put(IngotId, p, new Vector2(11, 28), 40);
        }

        /// <summary>④ 宫门码头：出口神龛（贴北崖，正面朝南）、宫墙 ×6、角楼 ×2、码头拒马（夹着 C5 登岸口）、倾覆鼎、货堆、火坛；鼓楼台外角放栖落点。返回神龛</summary>
        static GameObject BuildQuay(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("④ 宫门码头").transform;
            root.SetParent(arch, false);
            var shrine = Put(ShrineId, root, ShrineAt, 180, 1, 0.1f);
            float wallW = DesignSize[RampartId].x;
            for (int i = 0; i < 3; i++)
            {
                float x = DesignSize[ShrineId].x * 0.5f + 0.3f + wallW * (i + 0.5f);
                Put(RampartId, root, new Vector2(-x, 128), 180, 1, 0.3f);
                Put(RampartId, root, new Vector2(x, 128), 180, 1, 0.3f);
            }
            Put(TowerId, root, new Vector2(-31, 124), 180, 1, 0.3f);
            Put(TowerId, root, new Vector2(31, 124), 180, 1, 0.3f);
            Put(AltarId, root, new Vector2(-6, 120), 180);
            Put(AltarId, root, new Vector2(6, 120), 180);
            Put(AltarId, root, new Vector2(-40, 101), 180);
            Put(AltarId, root, new Vector2(40, 101), 180);
            var p = new GameObject("④ 掩体").transform;
            p.SetParent(props, false);
            Put(BarricadeId, p, new Vector2(-6, 103), 0, 1.2f);
            Put(BarricadeId, p, new Vector2(10, 103), 0, 1.2f);
            Put(CauldronId, p, new Vector2(24, 100), 10, 1.4f);
            Put(IngotId, p, new Vector2(-14, 121), 20);
            Put(IngotId, p, new Vector2(14, 121), -20);
            PerchMarker(markers, "DrumW", At(new Vector2(-29.5f, 117), DrumW.TopY));
            PerchMarker(markers, "DrumE", At(new Vector2(29.5f, 117), DrumE.TopY));
            return shrine;
        }

        /// <summary>湖心石龛：堤墩白盒（ART6 暂缓，×0.5 = 10 × 3 × 10，顶面 +1.6，正对 C8 窄堤）+ 两座火坛（宝藏堆是藏宝点的模型，见 BuildCaches）</summary>
        static void BuildIslet(Transform arch, Transform props)
        {
            var root = new GameObject("湖心石龛").transform;
            root.SetParent(arch, false);
            var toAnchor = (Anchor.c - Islet.c).normalized;
            var pier = Put(PierId, root, Islet.c, YawZ(toAnchor), 0.5f, 0, PierTop - DesignSize[PierId].y * 0.5f);
            if (pier) pier.name = IsPlaceholder(pier) ? $"{pier.name}（湖心石龛的墩）" : $"{PierId} (Islet)";
            var side = new Vector2(-toAnchor.y, toAnchor.x);
            Put(AltarId, props, Islet.c + side * 3.2f - toAnchor * 1.5f, YawZ(toAnchor), 1, 0, PierTop - 0.05f);
            Put(AltarId, props, Islet.c - side * 3.2f - toAnchor * 1.5f, YawZ(toAnchor), 1, 0, PierTop - 0.05f);
        }

        /// <summary>东西两岸：堤道登岸处各一根栖柱；西岸熔铸遗址（⑤ 守军、藏宝 B 的岩龛）的掩体与坩埚</summary>
        static void BuildShores(Transform props, Transform markers)
        {
            var root = new GameObject("两岸").transform;
            root.SetParent(props, false);
            PerchPillar("ShoreW", root, markers, new Vector2(-132, -20), 30);
            PerchPillar("ShoreE", root, markers, new Vector2(134, 2), -30);
            Put(ObeliskId, root, ShoreW + new Vector2(-4, 6), 0);
            Put(ObeliskId, root, ShoreE + new Vector2(4, 6), 0);
            Put(CoverWallId, root, new Vector2(-119, 27), 0, 1.2f);
            Put(IngotId, root, new Vector2(-136, 37), 15);
            Put(CrucibleId, root, new Vector2(-140, 24), 0, 1.5f);
            Put(CrucibleId, root, new Vector2(-141, 35), 40, 1.5f);
        }

        /// <summary>湖里两段旧堤残段（堤道段白盒，ART6 暂缓）：顶面 +0.7，不在任何路线上</summary>
        static void BuildLakeRuins(Transform world)
        {
            var root = new GameObject("旧堤残段").transform;
            root.SetParent(world, false);
            float baseY = LavaY + 0.7f - DesignSize[SegmentId].y;
            Put(SegmentId, root, new Vector2(-5, -30), 70, 1, 0, baseY);
            Put(SegmentId, root, new Vector2(36, 44), 25, 1, 0, baseY);
        }

        /// <summary>散布（L4 章节默认）：余烬石在熔岩岸、火山渣在灰地，墩顶 / 码头稀一些、台与渡口台上没有；玄武岩块（带碰撞）只在崖脚碎屑坡上</summary>
        static void BuildScatter(Transform env, ShowcaseTheme theme)
        {
            float Keep(Vector2 p)
            {
                if (Vector2.Distance(p, Spawn) < MoundR + 2) return 0;
                foreach (var tr in Terraces)
                    if (LevelKit.BoxSdf(p, tr.c - tr.half, tr.c + tr.half) < 1.5f) return 0;
                foreach (var isle in Isles)
                    if (Vector2.Distance(p, isle.c) < isle.rt) return 0.35f;
                return LevelKit.BoxSdf(p, QuayMin, QuayMax) < 0 ? 0.3f : 1;
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
            var avoid = new List<(Vector2 c, float r)>
            {
                (Spawn, 22), (FerryW, 10), (FerryE, 10), (ShoreW, 10), (ShoreE, 10), (GuardSite, 18), (AlcoveC, 12), (Landing, 10),
            };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            boulders.where = pt =>
            {
                if (Inside(pt.p) < 5) return 0;
                Floor(pt.p, out _, out float rho, out float quay);
                if (rho < 16 || quay > 0) return 0;
                if (LevelKit.BoxSdf(pt.p, QuayMin, QuayMax) < 6) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(pt.p, c) < r) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            var big = LevelKit.ScatterProps(ts, env, boulders, new Rect(-147, -117, 294, 250), 10f, RouteDist);
            Debug.Log($"[Level] 3-1 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}；崖脚玄武岩块 {big.Count}");
        }

        /// <summary>离最近一条堤道堤面的距离（米，散布避让）</summary>
        static float RouteDist(Vector2 p)
        {
            float d = float.MaxValue;
            foreach (var cw in Causeways) d = Mathf.Min(d, cw.path.Nearest(p, 40).dist - cw.half);
            return Mathf.Max(0, d);
        }

        /// <summary>
        /// 标记：场地中心、站位（SpawnAnchor）、全图地标、击退冒烟用的堤肩点 Knock_Edge（C3 中段，正对熔岩，地面比熔岩高 0.65 m：
        /// 往外推 1.1 m 就落进熔岩——Map31Suite 在这里把一只祸斗打下去）
        /// </summary>
        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector3 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = p;
            }
            Mk("Site_Spawn", G(Spawn));
            Mk("Site_1_Toll", G(Toll.c));
            Mk("Site_2_Anchor", G(Anchor.c));
            Mk("Site_3_Hub", G(Hub.c));
            Mk("Site_4_Quay", G(QuaySite));
            Mk("Site_5_Foundry", G(GuardSite));
            Mk("Site_Islet", At(Islet.c, PierTop));
            Mk("Site_Exit", G(ShrineAt));
            Mk("Landmark_Zhurong", At(StatueAt, G(StatueAt).y + DesignSize[StatueId].y * StatueScale * 0.86f));
            foreach (var a in Anchors)
            {
                var go = new GameObject(a.name);
                go.transform.SetParent(root, false);
                go.transform.position = G(a.at);
                var sa = go.AddComponent<SpawnAnchor>();
                (sa.role, sa.lane, sa.elevated, sa.spread) = (a.role, a.lane, a.elevated, a.spread);
            }

            var (center, normal) = KnockEdge();
            var knock = new GameObject("Knock_Edge");
            knock.transform.SetParent(root, false);
            knock.transform.SetPositionAndRotation(center, Quaternion.LookRotation(new Vector3(normal.x, 0, normal.y)));
        }

        /// <summary>C3 中段堤肩上、地面比熔岩高 0.65 m 的点与指向熔岩的水平方向</summary>
        static (Vector3 at, Vector2 outward) KnockEdge()
        {
            var cw = Causeways[2];
            var c = cw.path.At(0.5f);
            var tan = cw.path.TangentAt(0.5f);
            var n = new Vector2(-tan.y, tan.x);
            for (float sd = cw.half; sd <= cw.half + CausewayEdge; sd += 0.05f)
            {
                var p = c + n * sd;
                if (ts.GroundY(p.x, p.y) <= LavaY + 0.65f) return (G(p), n);
            }
            return (G(c + n * (cw.half + 0.8f)), n);
        }

        /// <summary>
        /// 遭遇（docs/level-design/maps/3-1.md §5，遭遇框架 v2；第三章 V2 阵容）：四个必清场地任意顺序，⑤ 是藏宝 B 的守军（可选、不自动触发）。
        /// 难度由 RunPlan 给（3-1 = 2.60），场地不写死。必清 46 只（①11 / ②10 / ③13 / ④12），精英：③ 写死 1、④ 升格 1（只落在最后一波，不会是火鼍）。
        /// </summary>
        static LevelObjective BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector3 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = center;
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                var list = new List<Transform>();
                foreach (var a in Anchors)
                    if (a.site == index)
                        list.Add(markers.Find(a.name));
                site.anchors = list.ToArray();
                return site;
            }
            WaveEntry E(string id, int n) => EncounterSpec.E(id, n);
            WaveSpec Wave(string label, params WaveEntry[] entries) => EncounterSpec.Wave(label, entries);

            // 场地中心都取墩顶 / 码头的地面（②③ 的墩心在台上：中心挪到台下的墩顶）
            var s1 = Site(1, "税关墩", G(Toll.c), 22, 26, EncounterSpec.Of(
                    Wave("税关炭童", E(Tantong, 5), E(Huodou, 1)).Hint("炭童从三个堤头围上来；倒下碎成余烬，4 秒内补一枪或踩散，不然复燃"),
                    Wave("祸斗吃火", E(Tantong, 2), E(Huodou, 2), E(Mamian, 1)).After(1, 1.6f).Hint("祸斗吃了熔岩边的火会吐火——把它们从墩边打下熔岩"))
                .Gather(0.4f).Distance(10, 32), "weapon", new Vector3(4, 0, -4));
            var s2 = Site(2, "锚链墩", G(Anchor.c + new Vector2(0, 10)), 25, 28, EncounterSpec.Of(
                    Wave("锚链毕方", E(Bifang, 2), E(Tantong, 3)).Hint("毕方立在锚链桩顶，「毕」一声就横移——打它那条腿把它打下来"),
                    Wave("桩下齐射", E(Bifang, 1), E(Firecracker, 1), E(Huodou, 2), E(Tantong, 1)).After(1, 2f).Hint("炮仗傀儡在墩边齐射——打腹部火药仓，别站在熔岩边挨炸"))
                .Gather(0.6f).Distance(10, 34), "scroll", new Vector3(0, 0, 2));
            var s3 = Site(3, "镇湖鼎台", G(Hub.c + new Vector2(6, -8)), 21, 25, EncounterSpec.Of(
                    Wave("狱卒巡湖", E(Mamian, 2), E(Tantong, 3), E(FireCrow, 2)).Hint("勾魂索会把你往马面身前拖——别站在它和熔岩之间，射断链子挣脱"),
                    Wave("鼎前混编", E(Mamian, 1).Elite("shielded"), E(Huodou, 2), E(FireCrow, 2), E(Firecracker, 1)).After(1, 2f)
                        .Hint("精英狱卒带护盾——先打俯冲的飞鸦，鼎台上看得清整座墩"))
                .Gather(0.6f).Distance(10, 32), "weapon:min=1", new Vector3(2, 0, 2));
            var s4 = Site(4, "宫门码头", G(QuaySite), 22, 30, EncounterSpec.Of(
                    Wave("码头火鼍", E(Tuo, 1), E(Tantong, 3), E(Huodou, 1))
                        .Hint("火鼍潜在码头边的熔岩里，岸边鼓泡就是要扑——退到宫墙下打它的脊背，别背对熔岩站"),
                    Wave("宫门守卫", E(Mamian, 1), E(FireCrow, 3), E(Tantong, 2), E(Firecracker, 1)).After(1, 2f).Hint("鼓楼台是俯射位——先清台上的炮仗傀儡"))
                .Gather(0.6f).Distance(10, 36).Elites(1, "frenzied"), "upgrade", new Vector3(0, 0, 4));
            var s5 = Site(5, "熔铸遗址守军", G(GuardSite), 14, 18, EncounterSpec.Of(
                    Wave("熔铸遗址守军", E(Huodou, 2), E(Tantong, 2), E(Firecracker, 1).Elite("swift")).Hint("守着熔铸遗藏的一小队"))
                .Gather(0.4f).Distance(8, 26), "", Vector3.zero);
            s5.autoTrigger = false;
            s5.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "渡过熔湖堤道";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>
        /// 藏宝（CachePOI）：A 湖心石龛（无守军，C8 窄堤死路，秘卷——从出生点就看得见宝藏堆）；
        /// B 熔铸遗藏（西壁岩龛，调查时惊动 ⑤ 守军，肃清后出宝箱，武器保底精良）。模型是 Model 子物体，放在藏宝点旁，宝箱从藏宝点本身冒出来
        /// </summary>
        static void BuildCaches(Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            void Cache(string title, Vector3 at, Vector2 face, string reward, EncounterSite guardSite, string modelId, Vector2 modelOffset, float modelScale, float discover)
            {
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                poi.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(face.x, 0, face.y)));
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = discover;
                var mAt = new Vector2(at.x, at.z) + modelOffset;
                var model = Put(modelId, poi.transform, mAt, YawZ(face), modelScale, 0, at.y - 0.05f);
                if (!model) return;
                // Prefab 是按父物体的局部坐标摆的（藏宝点不在原点）：改回世界坐标；白盒本来就是世界坐标
                if (!IsPlaceholder(model)) model.transform.SetPositionAndRotation(At(mAt, at.y - 0.05f), Quaternion.Euler(0, YawZ(face), 0));
                model.name = "Model";
            }
            var toAnchor = (Anchor.c - Islet.c).normalized;
            Cache("湖心石龛", At(Islet.c, PierTop), toAnchor, "scroll", null, HoardId, -toAnchor * 2.6f, 0.8f, 12);
            Cache("熔铸遗藏", G(CacheB), Vector2.right, "weapon:min=1", guard, CrucibleId, new Vector2(-3, 0), 1.8f, 12);
        }

        /// <summary>出口传送门：嵌在出口神龛正面（没有神龛模型时自己立石门框），关卡目标完成后升起、落清关宝箱；下一关读 RunPlan = 3-2</summary>
        static ExitPortal BuildExit(Transform markers, GameObject shrine, LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<ExitPortal>();
            portal.transform.SetParent(markers, false);
            var face = shrine && !IsPlaceholder(shrine) ? shrine.transform.forward : Vector3.back;
            face.y = 0;
            face.Normalize();
            var at = ShrineAt + new Vector2(face.x, face.z) * 1.4f;
            portal.transform.SetPositionAndRotation(G(at), Quaternion.LookRotation(-face));
            portal.objective = objective;
            portal.buildFrame = !shrine || IsPlaceholder(shrine);
            return portal;
        }

        // ───────────── 本关的检查 ─────────────

        /// <summary>
        /// 熔湖地貌（maps/3-1.md §8）：堤道高出熔岩、沿堤坡度；湖床低于熔岩面；墩顶高度；只走非熔岩区从出生点到各场地 / 石龛 / 出口有完整路径；
        /// 击退冒烟点 Knock_Edge 往外是熔岩，且人形导航网格从标记连到 Lava 区（击退推得下去）
        /// </summary>
        static void CheckLake(LevelKit.Report rep, LavaVolume lava)
        {
            rep.Section("熔湖地貌（3-1）");
            foreach (var cw in Causeways)
            {
                float lowest = float.MaxValue, worst = 0;
                Vector2 worstAt = default;
                for (float sd = 0; sd <= cw.path.length; sd += 1f)
                {
                    var p = cw.path.At(sd / cw.path.length);
                    lowest = Mathf.Min(lowest, ts.GroundY(p.x, p.y));
                    var q = cw.path.At(Mathf.Min(1, (sd + 2f) / cw.path.length));
                    float run = Vector2.Distance(p, q);
                    if (run < 0.5f) continue;
                    float g = Mathf.Atan(Mathf.Abs(ts.GroundY(q.x, q.y) - ts.GroundY(p.x, p.y)) / run) * Mathf.Rad2Deg;
                    if (g > worst) { worst = g; worstAt = p; }
                }
                string msg = $"{cw.id} {cw.label}：长 {cw.path.length:F0} m、宽 {cw.half * 2:F0} m，最低处高出熔岩 {lowest - LavaY:F2} m，沿堤最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})";
                if (lowest - LavaY < 0.6f || worst > 14f) rep.Fail($"{msg}（要求 ≥ 0.6 m、≤ 14°）");
                else rep.Line($"✓ {msg}");
            }

            // 湖床：湖椭圆里、离墩和堤够远的点都低于熔岩面 0.5 m 以上
            int n = 0, under = 0;
            for (float x = -LakeR.x; x <= LakeR.x; x += 4)
            for (float z = LakeC.y - LakeR.y; z <= LakeC.y + LakeR.y; z += 4)
            {
                var q = new Vector2(x, z);
                LakeShore(q, LakeC, LakeR, LakeShoreW, LakeIrregular, LakeSeed, out _, out _, out float edge);
                if (edge > -1f) continue;
                bool near = false;
                foreach (var isle in Isles) near |= Vector2.Distance(q, isle.c) < isle.rt + isle.ring + 1;
                foreach (var cw in Causeways) near |= cw.path.Nearest(q, cw.half + CausewayEdge + 1).dist < cw.half + CausewayEdge + 1;
                if (near) continue;
                n++;
                if (ts.GroundY(q.x, q.y) <= LavaY - 0.5f) under++;
            }
            if (n == 0 || under < n * 0.98f) rep.Fail($"湖床 {under}/{n} 点低于熔岩面 0.5 m 以上（地形露出熔岩面）");
            else rep.Line($"✓ 湖床 {under}/{n} 点低于熔岩面 0.5 m 以上");
            foreach (var isle in Isles)
            {
                if (isle.name == Islet.name) continue;
                var q = isle.c + new Vector2(isle.rt * 0.6f, -isle.rt * 0.45f);
                float y = ts.GroundY(q.x, q.y);
                if (Mathf.Abs(y - isle.top) > 0.4f) rep.Fail($"{isle.name} 墩顶 y {y:F2}（设计 {isle.top:F1}）");
                else rep.Line($"✓ {isle.name} 墩顶 y {y:F2}，高出熔岩 {y - LavaY:F1} m");
            }

            // 只走非熔岩区：堤道是通的，不用蹚熔岩（人形代理的网格：火鼍的网格也在湖上，不过滤会落错网格）
            int area = LevelKit.LavaNavArea;
            var dry = LavaField.WalkerFilter(area >= 0 ? NavMesh.AllAreas & ~(1 << area) : NavMesh.AllAreas);
            if (area < 0) rep.Warn("NavMesh 没有 Lava 区域：非熔岩路径与击退检查按全部区域算（重启编辑器让 NavMeshAreas.asset 生效后重建）");

            // 火鼍的网格只铺在熔岩里：墩顶、码头、渡口这些干地上采不到（LevelKit.BakeLavaNavMesh 的干地封顶）
            var swim = LevelKit.LavaSwimmerAgentType();
            if (swim.HasValue)
            {
                var swimAll = new NavMeshQueryFilter { agentTypeID = swim.Value, areaMask = NavMesh.AllAreas };
                var dryProbes = new (string name, Vector3 at)[]
                {
                    ("① 墩顶", G(Toll.c + new Vector2(4, -6))), ("② 墩顶", G(Anchor.c + new Vector2(0, 12))), ("③ 墩顶", G(Hub.c + new Vector2(8, -6))),
                    ("④ 码头", G(QuaySite)), ("C3 堤面", G(Causeways[2].path.At(0.5f))), ("西渡口", G(FerryW)),
                };
                var wet = dryProbes.Where(d => NavMesh.SamplePosition(d.at, out _, 1.5f, swimAll)).Select(d => d.name).ToList();
                if (wet.Count > 0) rep.Fail($"火鼍（LavaSwimmer）的导航网格铺到了干地上：{string.Join("、", wet)}（不带过滤的导航查询会落错网格）");
                else rep.Line($"✓ 火鼍的导航网格只在熔岩里（{dryProbes.Length} 处干地 1.5 m 内都采不到）");
            }
            if (!NavMesh.SamplePosition(G(Spawn), out var sh, 4, dry)) rep.Fail("出生点 4 m 内没有非熔岩的导航网格");
            else
            {
                var goals = new (string name, Vector3 at)[]
                {
                    ("① 税关墩", G(Toll.c + new Vector2(4, -4))), ("② 锚链墩", G(Anchor.c + new Vector2(0, 12))), ("③ 镇湖鼎台", G(Hub.c + new Vector2(8, -6))),
                    ("④ 宫门码头", G(QuaySite)), ("湖心石龛", At(Islet.c, PierTop)), ("出口", G(ShrineAt + new Vector2(0, -5))), ("⑤ 熔铸遗址", G(GuardSite)),
                };
                foreach (var (gname, at) in goals)
                {
                    var path = new NavMeshPath();
                    bool ok = NavMesh.SamplePosition(at, out var gh, 4, dry) && NavMesh.CalculatePath(sh.position, gh.position, dry, path) &&
                              path.status == NavMeshPathStatus.PathComplete;
                    float len = 0;
                    for (int i = 0; i + 1 < path.corners.Length; i++) len += Vector3.Distance(path.corners[i], path.corners[i + 1]);
                    if (ok) rep.Line($"✓ 出生点 → {gname}：只走非熔岩区 {len:F0} m");
                    else rep.Fail($"出生点 → {gname}：只走非熔岩区走不到（{path.status}）——堤道断了？");
                }
            }

            // 击退冒烟点：往外 2.5 m 是熔岩，人形导航网格从标记连到 Lava 区
            var knock = GameObject.Find("Knock_Edge");
            if (!knock)
            {
                rep.Fail("没有 Knock_Edge 标记");
                return;
            }
            var kp = knock.transform.position;
            var kd = knock.transform.forward;
            var outside = kp + kd * 2.5f;
            float og = ts.GroundY(outside.x, outside.z);
            bool lavaGeom = og <= LavaY + LavaTuning.StandRise && lava && lava.Body.Contains(outside.x, outside.z);
            string where = $"Knock_Edge {LevelContext.At(kp)} 地面 y {kp.y:F2}，往外 2.5 m 地面 y {og:F2}";
            if (!lavaGeom) rep.Fail($"{where}：往外不是熔岩");
            else if (area < 0) rep.Line($"· {where}（没有 Lava 区域，导航连通没查）");
            else
            {
                var path = new NavMeshPath();
                bool from = NavMesh.SamplePosition(kp, out var kh, 1.5f, LavaField.WalkerFilter());
                bool to = NavMesh.SamplePosition(outside + Vector3.up * 0.3f, out var lh, 2f, LavaField.WalkerFilter(1 << area));
                bool linked = from && to && NavMesh.CalculatePath(kh.position, lh.position, LavaField.WalkerFilter(), path) && path.status == NavMeshPathStatus.PathComplete;
                if (linked) rep.Line($"✓ {where}：堤肩的导航网格连到 Lava 区（击退推得下去）");
                else rep.Fail($"{where}：堤肩的导航网格连不到 Lava 区（起点 {from}、熔岩点 {to}、路径 {path.status}）——堤肩太陡，击退推不下去");
            }
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查本关的件（熔岩、场地、藏宝、出口、栖落点、击退标记），顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, ExitPortal portal)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            int sites = Count<EncounterSite>(), lavas = Count<LavaVolume>(), caches = Count<CachePOI>(), portals = Count<ExitPortal>(), perches = Count<PerchPoint>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1），熔岩 {lavas} 片，藏宝 {caches}，出口 {portals}，栖落点 {perches}");
            if (sites != 5) rep.Fail($"遭遇场地有 {sites} 个（应为 5）");
            if (lavas != 1) rep.Fail($"熔岩有 {lavas} 片（应为 1：整片湖一个熔岩盒）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2）");
            if (portals != 1 || !portal || !portal.objective) rep.Fail($"出口传送门 {portals} 个（应 1，且接上 LevelObjective）");
            else rep.Line($"✓ 出口传送门在宫门神龛前；下一关 {RunPlan.Next(RunPlan.Get("3-1"))?.Label ?? "?"}");
            if (perches < 8) rep.Fail($"栖落点只有 {perches} 处（锚链桩、栖柱、鼓楼台应 ≥ 8）");
            if (!GameObject.Find("Knock_Edge")) rep.Fail("没有 Knock_Edge 标记（击退冒烟用）");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 交给 L5 规则集（<see cref="LevelValidator"/>）的声明：主线 12 个路点（出生 → 西渡口 → ① 墩顶 → 税亭台 → ③ 墩顶 → 鼎台 → ② 墩顶 → 绞盘台 → 湖心石龛 → 码头 → 西鼓楼台 → 出口），
        /// 坡度路径（8 条堤道 ≤ 15°，5 条台坡道、2 条出生下坡 ≤ 24°），7 条地标视线，场地尺寸 / 掩体 / 层数取 maps/3-1.md 场地表。
        /// 可玩区遮罩与软边界同一个；崖本身翻不出去，越界按兜底环算（escapeMargin = 兜底距离 + 2 m）。
        /// 占位件按默认策略判不合格（第三章新模型暂缓：湖心石龛的墩、两段旧堤残段，见 docs/art/ch3-kit.md）。
        /// L5 的可达性栅格不认识熔岩：湖床被当成能站的地面（场地面积、层数里含湖床那一圈，只防退化）。
        /// </summary>
        static LevelSpec Spec(Vector3 statueHead)
        {
            SiteSpec Site(string name, Vector3 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = c, size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var shrineLintel = At(ShrineAt + new Vector2(0, -1), QuayY + DesignSize[ShrineId].y * 0.8f);
            var stallTop = At(new Vector2(-66, -16), TollTerrace.TopY + DesignSize[StallId].y * 1.3f * 0.7f);
            var toAnchor = (Anchor.c - Islet.c).normalized;
            var hoard = At(Islet.c - toAnchor * 2.6f, PierTop + 1.0f);
            var spec = new LevelSpec
                {
                    id = "3-1", title = "熔湖堤道", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    sites =
                    {
                        Site("出生·渡口台（缓冲）", G(Spawn), 24, combat: false),
                        Site("① 税关墩", G(Toll.c), 48, cover: 4, layers: 3, overlook: true),
                        // 场地圆盘取墩心（掩体、层数按整座墩算；遭遇的场地中心另取台下的墩顶，见 BuildEncounters）
                        Site("② 锚链墩", G(Anchor.c), 50, cover: 4, layers: 3, overlook: true),
                        Site("③ 镇湖鼎台", G(Hub.c), 44, cover: 4, layers: 3, overlook: true),
                        Site("④ 宫门码头", G(QuaySite), 60, cover: 4, layers: 2, overlook: true),
                    },
                }
                .Route("出生·渡口台", G(Spawn)).Route("西渡口", G(FerryW)).Route("① 税关墩", G(Toll.c + new Vector2(4, -4)))
                .Route("① 税亭台", G(new Vector2(-60, -15))).Route("③ 镇湖鼎台", G(Hub.c + new Vector2(8, -6))).Route("③ 鼎台", G(new Vector2(-4, 35)))
                .Route("② 锚链墩", G(Anchor.c + new Vector2(0, 12))).Route("② 绞盘台", G(new Vector2(64, -10))).Route("湖心石龛", At(Islet.c, PierTop))
                .Route("④ 宫门码头", G(new Vector2(0, 106))).Route("④ 西鼓楼台", G(new Vector2(-26, 114))).Route("出口", G(ShrineAt + new Vector2(0, -4.5f)))
                .Sight("出生 → 祝融神像", G(Spawn, 1.62f), statueHead, 8, StatueId)
                .Sight("出生 → 宫门神龛", G(Spawn, 1.62f), shrineLintel, 6, ShrineId)
                .Sight("出生 → 湖心石龛", G(Spawn, 1.62f), hoard, 4)
                .Sight("① 税亭台 → 祝融神像", G(new Vector2(-59, -15), 1.62f), statueHead, 8, StatueId)
                .Sight("② 锚链墩 → 宫门神龛", G(Anchor.c + new Vector2(0, 16), 1.62f), shrineLintel, 6, ShrineId)
                .Sight("③ 鼎台 → 祝融神像", G(new Vector2(-4, 35), 1.62f), statueHead, 8, StatueId)
                .Sight("④ 码头 → ① 税亭", G(Landing + new Vector2(-2, 3), 1.62f), stallTop, 4, StallId);
            foreach (var cw in Causeways) spec.slopePaths.Add(new SlopePath { name = $"{cw.id} {cw.label}", points = cw.path.points, maxSlope = 15f });
            foreach (var tr in Terraces) spec.slopePaths.Add(new SlopePath { name = $"{tr.name}坡道", points = new[] { tr.foot, tr.top } });
            spec.slopePaths.Add(new SlopePath { name = "渡口台 → 西渡口", points = new[] { Spawn, FerryW } });
            spec.slopePaths.Add(new SlopePath { name = "渡口台 → 东渡口", points = new[] { Spawn, FerryE } });
            return spec;
        }
    }
}
