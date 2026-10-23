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
    /// 3-3 铸范大坊 · 鼓风正殿（docs/level-design/maps/3-3.md；docs/unity-parity.md D4 / D5 / D14 / D25、M33；V2 inferno-3 铸范大坊 + inferno-4 鼓风正殿）。
    /// 一座开在火山口底的露天大铸坊：北壁正中的炉闸放出熔铜，主渠南下汇进横贯全场的横渠，再分成东西两条渠流到南壁——地上的熔铜把铸坊切成五块：
    /// 南半三张铸床（废范场 / 中央铸床 / 东铸床），北半是鼓风正殿（西）与神范台（东）。渠上没有墙，隔着熔铜什么都看得见；铁桥是走位线。
    /// 关卡坐标 = 世界 XZ（米），铸床床面 y = 0；火山口底 200 × 214 m（x 0–200、z 0–214），四周是 24 m 的火山口壁（地形，翻不上去，没有空气墙）。
    ///
    ///   出生 · 南闸门 (100,7)（2.5 m 闸台，正对浇包吊台、远望神范）
    ///   → ① 中央铸床 (100,64)：火鼍在东西两渠里换边潜游，浇包吊台 3 m 是看它脊背的高点
    ///   → ③ 东铸床 (166,62)：三排铸范挡直射挡不住炮仗齐射，铸铁墙台 3.5 m（毕方栖柱）
    ///   → ② 鼓风正殿（一）(48,152)：两台瘪着的巨型风箱把殿分成南北两条风箱道，熔炉铁牛在道里推进；西头炉坛 3.5 m、东头检修台 3 m
    ///   → 风闸台 (86,205)：拉开风闸——风箱鼓起、炉门轮流往两条风箱道喷火、全图熔铜渠开始涨落（<see cref="FoundryWindGate"/>）
    ///   → ④ 鼓风正殿（二）：同一座殿换了一批守军（祸斗吃道上的火、傩巫、神火飞鸦、精英铁牛）
    ///   → ⑤ 神范台 (152,164)：熔心魔将领主战（BossEncounter，熔铁闸封住两座进场桥；十字浅渠 + 中央熔池会被魔将引得漫上渠岸，<see cref="FoundryChannels"/>），
    ///     胜利后出口在神范前升起（<see cref="FoundryLordGate"/>：四处必清场地肃清前神范台不开打）。
    /// ①–④ 必清（④ 要求 ② 已清、风闸已拉），③ 与 ① 顺序不限；西南废范场有一队守军守着藏宝（可选），风闸台上还有一处炉工私藏。
    /// 场景只放环境和标记（D17 / L1）。第三章新模型暂缓（ART6，docs/art/ch3-kit.md）：铸范、铸床、风箱、熔铁闸、铁桥都是 PlaceOrBox 白盒，
    /// 报告列出来；全部到齐后占位检查自动收紧成不合格。生成：Spiritfire ▸ Levels ▸ Build 3-3 铸范大坊（或 bridge.sh level 3-3）。
    /// </summary>
    [LevelBuilder("3-3", ScenePath)]
    public static class Level_3_3
    {
        public const string Dir = "Assets/Levels/L3_3_Foundry";
        public const string ScenePath = "Assets/Scenes/L3_3_Foundry.unity";
        const string Name = "L3_3";
        /// <summary>领主（WarlordDef.Id；写字面量，构建器不依赖首领单元的文件）</summary>
        const string BossId = "boss_warlord";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0（铸渠渠底 −2.4 也在范围内）；地形外缘落回远景地面 FarY</summary>
        const float Base = 6f, HeightRange = 48f, FarY = 2f;
        static readonly Vector2 Origin = new(-68, -61), Size = new(336, 336);
        /// <summary>火山口底（可玩区）与火山口壁：壁在 RimWall 米内从床面升到 RimTop</summary>
        static readonly Vector2 FloorMin = new(0, 0), FloorMax = new(200, 214);
        const float RimTop = 24f, RimWall = 9f;
        /// <summary>热风从北壁炉闸往南吹（火星、灰烬的方向）</summary>
        static readonly Vector2 Wind = new Vector2(0.15f, -1f).normalized;

        static LevelKit.BoundarySpec Bounds
        {
            get
            {
                var b = LevelKit.BoundarySpec.Default;
                b.theme = "Inferno";
                return b;
            }
        }

        // ───────────── 熔铜渠 ─────────────
        /// <summary>
        /// 一条渠：中线两端（地形沿它挖槽，两端伸进火山口壁）、半宽、熔岩基准面、渠底、熔岩沿轴的范围、渠岸（领主战的漫溢带）。
        /// 铸坊的渠（field）：8 m 宽、约 54° 的斜壁（2.6 m 内从渠底升到床面：人走不上来，火鼍扑岸爬得上来）、熔岩面低于床面 1 m——只能走桥；
        /// 神范台的十字浅渠（arena）：8 m 宽、缓坡（魔将冲锋能冲过去）、
        /// 熔岩面低于床面 0.45 m，两侧各 3 m 渠岸会被魔将引得漫上来
        /// </summary>
        sealed class Channel
        {
            public string name;
            public Vector2 a, b;
            public float half, lava, floor, strip, lo, hi;
            public bool arena;
            /// <summary>熔岩沿轴的流向（+1 = 朝 b 端）</summary>
            public float flow;
            public bool NS => Mathf.Abs(b.x - a.x) < 0.01f;
            public float Yaw => NS ? 0f : 90f;
            public Vector2 At(float t) => NS ? new Vector2(a.x, t) : new Vector2(t, a.y);
        }

        /// <summary>
        /// 铸坊渠的截面。熔岩面、壁宽按火鼍（TuoAI）定：它潜在熔岩面下 1.0 × 体型 1.3 m，伏击要求和岸上玩家的高差 ≤ 2.5 m（熔岩面 −1.0 → 潜着 −2.3）；
        /// 扑岸时把法线 y &lt; 0.5（陡过 60°）的面当墙停下——原来 0.8 m 的陡壁（最陡 77°）、−1.4 的熔岩面让它既伏击不了、也爬不上岸，
        /// 只能泡在渠里贴着渠壁挨打。壁宽 2.6 m：smoothstep 最陡处约 54°（人和地面敌人的 45° 走不上来，火鼍爬得上来）
        /// </summary>
        const float FieldHalf = 4f, FieldLava = -1.0f, FieldFloor = -2.4f, FieldWall = 2.6f;
        const float ArenaHalf = 4f, ArenaLava = -0.45f, ArenaFloor = -0.6f, ArenaBank = 2f, BankStrip = 3f;
        /// <summary>领主战漫溢：比基准面高 0.75 m（熔岩面 +0.3，渠岸床面上的人站进熔岩）</summary>
        const float SurgeRise = 0.75f;
        /// <summary>铸坊渠的自动涨落（风闸拉开后才开）：只在渠里涨 0.6 m（高位 −0.4，加站立判定 0.3 仍低于床面），漫不上铸床</summary>
        const float TideHeight = 0.6f;

        static readonly Channel Cross = new() { name = "横渠", a = new(-8, 110), b = new(208, 110), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = -3, hi = 203, flow = 1 };
        static readonly Channel Trunk = new() { name = "主渠", a = new(100, 110), b = new(100, 222), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = 114, hi = 217, flow = -1 };
        static readonly Channel WestC = new() { name = "西渠", a = new(62, -8), b = new(62, 110), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = -3, hi = 106, flow = -1 };
        static readonly Channel EastC = new() { name = "东渠", a = new(138, -8), b = new(138, 110), half = FieldHalf, lava = FieldLava, floor = FieldFloor, lo = -3, hi = 106, flow = -1 };
        static readonly Channel ArenaX = new()
        {
            name = "神范南北渠", a = new(152, 110), b = new(152, 222), half = ArenaHalf, lava = ArenaLava, floor = ArenaFloor, strip = BankStrip, lo = 114, hi = 217, arena = true, flow = -1,
        };
        static readonly Channel ArenaZ = new()
        {
            name = "神范东西渠", a = new(100, 164), b = new(208, 164), half = ArenaHalf, lava = ArenaLava, floor = ArenaFloor, strip = BankStrip, lo = 104, hi = 203, arena = true, flow = -1,
        };
        static readonly Channel[] Channels = { Cross, Trunk, WestC, EastC, ArenaX, ArenaZ };
        /// <summary>神范台中央熔池：渠半径 7 m，漫溢圈 10 m</summary>
        static readonly Vector2 Basin = new(152, 164);
        const float BasinR = 7f;

        /// <summary>桥：跨哪条渠、沿渠轴的位置、桥宽。铸坊的桥 12 m 长（渠 8 m + 两头各压 2 m 床面）、0.8 m 厚；神范台的桥 0.4 m 厚</summary>
        sealed class Bridge
        {
            public string id, name;
            public Channel ch;
            public float at, width;
            public Vector2 Center => ch.At(at);
            public float Span => ch.half * 2f + 4f;
            public float Thick => ch.arena ? 0.4f : 0.8f;
        }

        static readonly Bridge[] Bridges =
        {
            new() { id = "B1", name = "东桥", ch = EastC, at = 52, width = 12 },
            new() { id = "B2", name = "西桥", ch = WestC, at = 84, width = 10 },
            new() { id = "B3", name = "殿前桥", ch = Cross, at = 82, width = 12 },
            new() { id = "B4", name = "废范北桥", ch = Cross, at = 24, width = 10 },
            new() { id = "B5", name = "闸前桥", ch = Trunk, at = 176, width = 10 },
            new() { id = "B6", name = "东铸北桥", ch = Cross, at = 178, width = 12 },
            new() { id = "AN", name = "神范北桥", ch = ArenaX, at = 190, width = 8 },
            new() { id = "AS", name = "神范南桥", ch = ArenaX, at = 138, width = 8 },
            new() { id = "AW", name = "神范西桥", ch = ArenaZ, at = 126, width = 8 },
            new() { id = "AE", name = "神范东桥", ch = ArenaZ, at = 178, width = 8 },
        };

        static Bridge BridgeById(string id) => Bridges.First(b => b.id == id);
        /// <summary>桥面比床面高 5 cm（压在床面上，不和地形面打架）</summary>
        const float DeckTop = 0.05f;

        // ───────────── 台 ─────────────
        sealed class Platform
        {
            public string name;
            public Vector2 min, max;
            public float h;
            public (Vector2 foot, Vector2 top, float width)[] ramps;
            public Vector2 Center => (min + max) * 0.5f;
            public Vector2 Half => (max - min) * 0.5f;
        }

        static readonly Platform GateTerrace = new() { name = "南闸门", min = new(86, 0), max = new(114, 16), h = 2.5f, ramps = new[] { (new Vector2(100, 27), new Vector2(100, 16.2f), 8f) } };
        static readonly Platform Ladle = new()
        {
            name = "浇包吊台", min = new(94, 60), max = new(106, 72), h = 3f,
            ramps = new[] { (new Vector2(100, 81.5f), new Vector2(100, 72.2f), 5f), (new Vector2(100, 50.5f), new Vector2(100, 59.8f), 5f) },
        };
        static readonly Platform WallTerrace = new() { name = "铸铁墙台", min = new(186, 40), max = new(198, 84), h = 3.5f, ramps = new[] { (new Vector2(192, 94.5f), new Vector2(192, 84.2f), 5f) } };
        static readonly Platform Altar = new() { name = "炉坛", min = new(12, 140), max = new(20, 164), h = 3.5f, ramps = new[] { (new Vector2(16, 129.5f), new Vector2(16, 139.8f), 5f) } };
        static readonly Platform Service = new() { name = "检修台", min = new(78, 144), max = new(86, 160), h = 3f, ramps = new[] { (new Vector2(82, 169f), new Vector2(82, 160.2f), 5f) } };
        static readonly Platform WindTerrace = new() { name = "风闸台", min = new(60, 190), max = new(92, 212), h = 2f, ramps = new[] { (new Vector2(64, 180.5f), new Vector2(64, 189.8f), 6f) } };
        static readonly Platform Dais = new() { name = "神范台", min = new(176, 192), max = new(198, 212), h = 3.5f, ramps = new[] { (new Vector2(184, 181f), new Vector2(184, 191.8f), 6f) } };
        static readonly Platform[] Platforms = { GateTerrace, Ladle, WallTerrace, Altar, Service, WindTerrace, Dais };

        // ───────────── 场地 / 标记 ─────────────
        static readonly Vector2 Spawn = new(100, 7);
        static readonly Vector2 CentralSite = new(100, 64), EastSite = new(166, 62), HallSite = new(48, 152), ScrapSite = new(28, 56), ArenaCenter = new(152, 164);
        /// <summary>神范台首领场地：矩形半宽 44 m（x 108–196、z 120–208，西、南两边外面就是主渠和横渠）</summary>
        static readonly Vector2 ArenaHalfSize = new(44, 44);
        static readonly Vector2 BossSpawnAt = new(174, 182), PlayerEntryAt = new(128, 144), ExitAt = new(184, 197), BossRewardAt = new(166, 192), ClearChestAt = new(172, 186);
        /// <summary>神范（巨型铸范，全图地标、出口在它前面）</summary>
        static readonly Vector2 MouldAt = new(192, 207);
        const float MouldYaw = 225f, MouldScale = 3f;

        // ───────────── 鼓风正殿 ─────────────
        static readonly Vector2 BellowsA = new(32, 152), BellowsB = new(64, 152);
        static readonly Vector3 BellowsSize = new(18, 5, 8);
        const float BellowsRest = 0.56f;
        static readonly float[] ButtressX = { 14, 34, 54, 74 };
        const float ButtressSouthZ = 123, ButtressNorthZ = 181, ButtressEastX = 92;
        static readonly float[] ButtressEastZ = { 136, 168 };
        static readonly Vector2[] HallColumns = { new(26, 134), new(50, 134), new(72, 134), new(26, 170), new(50, 170), new(72, 170) };
        /// <summary>炉门喷火的两条风箱道（第二次进殿）</summary>
        static readonly (Vector2 from, Vector2 to)[] FireLanes = { (new Vector2(24, 141), new Vector2(76, 141)), (new Vector2(24, 163), new Vector2(76, 163)) };
        static readonly Vector2 FurnaceAt = new(5, 152);
        static readonly Vector2 WindGateAt = new(86, 205);
        const float WindGateYaw = 225f;
        static readonly Vector2 SluiceAt = new(100, 215.5f);

        // ───────────── 美术 ID ─────────────
        // 第三章新件（ART6 暂缓，docs/art/ch3-kit.md：已登记、概念过审、未进 Tripo）——现在都是 PlaceOrBox 白盒
        const string MouldId = "SM_Tripo_InfernoCastingMould", BedId = "SM_Tripo_InfernoCastingBed", BellowsId = "SM_Tripo_InfernoBellows",
            GateId = "SM_Tripo_InfernoMoltenGate";
        /// <summary>铁桥：ART6 没有登记（恢复第三章美术时补一件），桥面顶在枢轴上方 0.8 m</summary>
        const string BridgeId = "SM_Tripo_InfernoIronBridge";
        static readonly string[] Ch3Kit = { MouldId, BedId, BellowsId, GateId, BridgeId };
        // 已有的祝融套件
        const string ColumnId = "SM_Tripo_InfernoColumn", ButtressId = "SM_Tripo_InfernoHallButtress", HallWallId = "SM_Tripo_InfernoHallWall",
            FurnaceId = "SM_Tripo_InfernoFurnaceTower", AltarId = "SM_Tripo_InfernoFireAltar", IngotsId = "SM_Tripo_InfernoIngotPile",
            CoverWallId = "SM_Tripo_InfernoCoverWall", BarricadeId = "SM_Tripo_InfernoBarricade", RuinId = "SM_Tripo_InfernoCauldronRuin",
            StallId = "SM_Tripo_InfernoForgeStall", HoardId = "SM_Tripo_InfernoTreasureHoard", CrucibleId = "SM_Prop_InfernoCrucible",
            ObeliskId = "SM_Prop_InfernoChainObelisk", GatewayId = "SM_Tripo_InfernoGateway";
        static readonly Vector3 MouldSize = new(3.2f, 2.8f, 2.2f), BedSize = new(8f, 1.4f, 5f), GateSize = new(10f, 9f, 1.4f),
            ColumnSize = new(1.97f, 4.93f, 1.81f), ButtressSize = new(4.51f, 17.84f, 3.74f), HallWallSize = new(8.17f, 15.8f, 2.57f),
            FurnaceSize = new(6.13f, 12.86f, 4.99f), AltarSize = new(1.13f, 2.36f, 1.15f), IngotsSize = new(2.18f, 1.52f, 1.81f),
            CoverWallSize = new(3.42f, 2.48f, 0.89f), BarricadeSize = new(3.56f, 1.18f, 0.47f), RuinSize = new(3.11f, 1.54f, 1.53f),
            StallSize = new(2.6f, 3.47f, 1.63f), HoardSize = new(2.31f, 1.71f, 1.56f), CrucibleSize = new(1.27f, 0.99f, 1.28f),
            ObeliskSize = new(1.08f, 2.13f, 1.08f), GatewaySize = new(11.31f, 10.75f, 2.2f);

        // ───────────── 地貌 ─────────────

        static float SegDist(Vector2 p, Vector2 a, Vector2 b) => LevelKit.SegmentDistance(p, a, b, out _);

        /// <summary>神范台区域（床面压平：渠岸的漫溢判定按床面 y 0 算）</summary>
        static float ArenaMask(Vector2 p) => 1 - Smooth(0, 6, LevelKit.BoxSdf(p, new Vector2(104, 114), new Vector2(200, 214)));

        /// <summary>可玩区：火山口底往壁里 1 m 以内（壁本身翻不上去；等值线外由软边界推回）</summary>
        static float Playable(Vector2 p) => 1 - Smooth(0, 4, LevelKit.BoxSdf(p, FloorMin + Vector2.one, FloorMax - Vector2.one));

        /// <summary>离最近一条铸坊渠 / 神范浅渠渠边的距离（米，渠内为负）与那条渠</summary>
        static float ChannelEdge(Vector2 p, out Channel nearest)
        {
            float best = float.MaxValue;
            nearest = null;
            foreach (var c in Channels)
            {
                float d = SegDist(p, c.a, c.b) - c.half;
                if (d >= best) continue;
                best = d;
                nearest = c;
            }
            return best;
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float arena = ArenaMask(p);
            float g = 0.1f * Fbm(p, 34, 2, 3) * (1 - arena);
            float h = g;

            // ── 台（闸台、吊台、墙台、炉坛、检修台、风闸台、神范台），坡道一起 ──
            float top = 0, rampMask = 0;
            foreach (var pl in Platforms)
            {
                float v = Plateau(p, pl.Center, pl.Half, 0, pl.h, 0.6f, pl.ramps);
                if (v <= 0) continue;
                h = Mathf.Max(h, g + v);
                top = Mathf.Max(top, Smooth(pl.h - 0.4f, pl.h - 0.05f, v));
                foreach (var (foot, tp, w) in pl.ramps)
                {
                    var (_, m) = Ramp(p, foot, tp, w, 0.6f);
                    rampMask = Mathf.Max(rampMask, m);
                }
            }

            // ── 熔铜渠：铸坊的渠斜壁深槽，神范台的十字浅渠缓坡 ──
            float trench = 0;
            foreach (var c in Channels)
            {
                float d = SegDist(p, c.a, c.b);
                float w = c.arena ? ArenaBank : FieldWall;
                if (d > c.half + 0.5f) continue;
                float k = Smooth(c.half - w, c.half, d);
                h = Mathf.Min(h, Mathf.Lerp(c.floor, h, k));
                trench = Mathf.Max(trench, 1 - k);
            }
            {
                float d = Vector2.Distance(p, Basin);
                if (d < BasinR + 0.5f)
                {
                    float k = Smooth(BasinR - ArenaBank, BasinR, d);
                    h = Mathf.Min(h, Mathf.Lerp(ArenaFloor, h, k));
                    trench = Mathf.Max(trench, 1 - k);
                }
            }
            float edge = ChannelEdge(p, out _);
            float bank = edge > 0 ? 1 - Smooth(0, 3.5f, edge) : 0;

            // ── 火山口壁：可玩区外 RimWall 米内升到 RimTop（60–75°，翻不上去），再往外是火山口顶（远处落回远景地面）──
            float outside = LevelKit.BoxSdf(p, FloorMin, FloorMax);
            float rock = 0;
            if (outside > -0.5f)
            {
                float rim = RimTop + 4f * Fbm(p, 40, 3, 7) + 3f * Ridged(p, 26, 3, 11);
                float k = Smooth(0, RimWall, outside);
                h = Mathf.Lerp(h, Mathf.Max(h, rim), k);
                rock = Smooth(0.5f, 3f, outside);
            }
            var local = p - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(FarY, h, Smooth(0, 36, edgeDist));
            s.h = Base + h;

            // ── 分层倾向：渠里结壳熔岩、渠边余烬岸、台面与坡道踩出的灰路、火山口壁玄武岩 ──
            s.fluid = Smooth(0.3f, 0.8f, trench);
            s.shore = bank * 0.8f;
            s.packed = Mathf.Max(top, rampMask * 0.9f);
            float patches = Smooth(0.1f, 0.5f, Fbm(p, 22, 3, 9)) * 0.6f;
            s.sand = patches * (1 - s.fluid) * (1 - top);
            s.rock = rock;
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-3 铸范大坊", priority = 73)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 软边界 → 烘焙 NavMesh（人形 + 熔岩生物）→ 验收（L5 + 熔岩）→ 截图；返回不合格项数</summary>
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
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            // 火山口壁 24 m：主题默认的低角度太阳会把半个铸坊压在壁影里，抬到 52°
            if (RenderSettings.sun) RenderSettings.sun.transform.rotation = Quaternion.Euler(52, 35, 0);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);

            // 远景：玄武岩脊 + 两圈火山锥；火山口壁外的远景地面在雾里接上环脚
            var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(100, 107), FarY - 0.5f, 760, 5);
            LevelKit.Backdrop(backdrop, env);
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY - 0.05f, theme.groundA);

            // 软边界（没有空气墙）：火山口壁本身翻不上去，等值线外热风推回 + 兜底环
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            LevelKit.Weather(env, theme, Wind, 0.2f);

            var lava = BuildLava(env);
            var decks = BuildBridges(arch);
            BuildGate(set, arch, props);
            BuildCentral(set, props);
            BuildEast(set, props, markers);
            BuildScrapYard(set, props);
            var hall = BuildHall(set, arch, props, markers);
            BuildWindTerrace(set, arch, props);
            var arenaProps = BuildArenaProps(set, arch, props);
            BuildScatter(set, env);
            BuildMarkers(set, markers);

            // 玩家在 Core 场景（L1）：这里只放出生标记 + 自举标记
            var spawnAt = set.OnGround(Spawn.x, Spawn.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(Vector3.forward);
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            var objective = BuildEncounters(set, markers);
            var gate = BuildWindGate(set, markers, props, objective, hall, lava.tides);
            BuildCaches(set, markers, objective);
            var lord = BuildLord(set, markers, objective, arenaProps, lava.surge);

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            LevelKit.BakeLavaNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("3-3 铸范大坊 · 鼓风正殿 · 验收");
            CheckGeometry(rep, set, lava, decks, hall, gate, lord);
            var spec = Spec(set);
            LevelValidator.Run(spec, rep); // 主线、坡度、视线 + L5 规则集，见文件末尾的 Spec
            LevelKit.ValidateLava(rep);
            CheckSceneContents(rep, scene, objective, gate, lord);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_3-3_report.txt");

            if (review)
            {
                Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var mouldTop = G(MouldAt, 6.5f);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_3-3", new[]
                    {
                        ("Aerial", new Vector3(100, 170, -70), new Vector3(100, 0, 110), false),
                        ("Map", new Vector3(100, 400, 107), new Vector3(100, 0, 107.5f), false),
                        ("Spawn", E(Spawn), G(Ladle.Center, 4), true),
                        ("SpawnMould", E(Spawn), mouldTop, false),
                        ("Central", E(new Vector2(84, 40)), G(Ladle.Center, 3), false),
                        ("EastBridge", E(new Vector2(146, 52)), G(EastSite, 2), false),
                        ("EastRows", E(new Vector2(150, 90)), G(new Vector2(176, 50), 1.5f), false),
                        ("HallSouth", E(new Vector2(44, 119)), G(FurnaceAt, 9), false),
                        ("HallLanes", E(new Vector2(80, 141)), G(new Vector2(20, 152), 3), false),
                        ("Altar", E(Altar.Center, Altar.h + 1.62f), G(BellowsB, 3), false),
                        ("WindTerrace", E(WindGateAt, WindTerrace.h + 1.62f), mouldTop, false),
                        ("Sluice", E(new Vector2(92, 196)), G(SluiceAt, 4), false),
                        ("ArenaNW", E(new Vector2(112, 176)), G(ArenaCenter, 1), false),
                        ("ArenaDais", E(ExitAt, Dais.h + 1.62f), G(ArenaCenter, 0), false),
                        ("ScrapYard", E(new Vector2(40, 90)), G(ScrapSite, 1), false),
                    });
                }
                finally
                {
                    Object.DestroyImmediate(preview);
                }
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        // ───────────── 摆放 ─────────────

        /// <summary>按 id 摆到地形上（底面往下埋 sink × scale）；缺 Prefab 时放 size × scale 的占位白盒（验收会列出来）</summary>
        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, Vector3? size = null, float dy = 0)
        {
            var go = LevelKit.PlaceOrBox(id, parent, set.OnGround(at.x, at.y, dy - sink * scale), (size ?? new Vector3(3, 3, 3)) * scale, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>占位白盒改名「id · 用途 (Placeholder)」：地标视线按名字前缀认（白盒默认叫「Placeholder · id」认不出来），占位检查仍按标签和名字列出来</summary>
        static void Label(GameObject go, string id, string what)
        {
            if (go && go.CompareTag(LevelKit.PlaceholderTag))
            {
                go.name = $"{id} · {what} (Placeholder)";
                // 第三章白盒换成暗铁色：默认的白色占位材质在火狱的 Bloom 下一片刺眼，读不出场景
                var r = go.GetComponent<MeshRenderer>();
                if (r) r.sharedMaterial = LevelKit.Mat(Dir, "Ch3Placeholder", new Color(0.36f, 0.3f, 0.27f), 0.85f);
            }
            else if (go) go.name = $"{go.name} · {what}";
        }

        static bool IsPlaceholder(GameObject go) => go && go.CompareTag(LevelKit.PlaceholderTag);

        // ───────────── 熔岩 ─────────────

        sealed class LavaSet
        {
            public readonly List<LavaVolume> tides = new(), surge = new(), still = new();
        }

        /// <summary>
        /// 熔岩：每条渠按桥切段（段在桥两侧各留 1 m），桥面下面另放一小段静止熔岩（桥上永远是干的：涨落的段不伸到桥下，挖洞的导航体也就碰不到桥面）。
        ///   铸坊的渠：盒宽 = 渠宽，自动涨落参数写好但先关着（风闸拉开后打开），几段错开相位；
        ///   神范台的十字浅渠：盒宽 = 渠宽 + 两侧各 3 m 渠岸，平时熔岩只在渠里，魔将引动时漫上渠岸（<see cref="FoundryChannels"/>）；中央熔池同理（漫溢圈 10 m）
        /// </summary>
        static LavaSet BuildLava(Transform env)
        {
            var root = new GameObject("Molten Channels").transform;
            root.SetParent(env, false);
            var set = new LavaSet();
            int phase = 0;
            foreach (var c in Channels)
            {
                var cuts = Bridges.Where(b => b.ch == c).Select(b => (b.at - b.width * 0.5f - 1f, b.at + b.width * 0.5f + 1f)).ToList();
                if (c == ArenaX) cuts.Add((Basin.y - BasinR - BankStrip, Basin.y + BasinR + BankStrip));
                if (c == ArenaZ) cuts.Add((Basin.x - BasinR - BankStrip, Basin.x + BasinR + BankStrip));
                int n = 0;
                foreach (var (s0, s1) in Spans(c.lo, c.hi, cuts))
                {
                    if (s1 - s0 < 1f) continue;
                    var mid = c.At((s0 + s1) * 0.5f);
                    float width = (c.half + c.strip) * 2f;
                    float sign = (c == Cross && (s0 + s1) * 0.5f < Trunk.a.x) ? -1f : c.flow;
                    var spec = new LevelKit.LavaSpec
                    {
                        name = $"{c.name} {++n}", center = new Vector3(mid.x, c.lava, mid.y), shape = LavaShape.Box, size = new Vector2(width, s1 - s0), yaw = c.Yaw,
                        depth = c.arena ? 1f : 1.6f, depthShore = !c.arena, flow = new Vector2(0, (c.arena ? 0.25f : 0.45f) * sign),
                    };
                    if (!c.arena)
                        spec.tide = new LavaTide
                        {
                            enabled = false, height = TideHeight, lowHold = 9, warn = 1.5f, rise = 2.5f, highHold = 4, fall = 3, offset = (phase++ % 4) * 4.1f,
                        };
                    var v = LevelKit.PlaceLava(Dir, spec, root);
                    (c.arena ? set.surge : set.tides).Add(v);
                }
            }
            // 中央熔池（漫溢圈 10 m）
            set.surge.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "神范熔池", center = new Vector3(Basin.x, ArenaLava, Basin.y), shape = LavaShape.Disc, size = new Vector2(BasinR + BankStrip, 0), depth = 1f, depthShore = false,
            }, root));
            // 桥下的静止熔岩。铸坊的桥：整段垫在桥下（桥底离渠底 1.6 m，桥下的渠底也有导航网格）；
            // 神范台的浅渠桥底离渠底只有 0.25 m，桥下没有导航网格——整段垫在桥下时中心采不到 Lava 区 / 熔岩生物网格，
            // 改成桥两侧各一小段（从桥面下 0.5 m 接到涨落段的端头）
            foreach (var b in Bridges)
            {
                var spans = b.ch.arena
                    ? new[] { (-b.width * 0.5f - 1f, -b.width * 0.5f + 0.5f, "侧"), (b.width * 0.5f - 0.5f, b.width * 0.5f + 1f, "侧") }
                    : new[] { (-b.width * 0.5f - 1f, b.width * 0.5f + 1f, "") };
                int k = 0;
                foreach (var (s0, s1, tag) in spans)
                {
                    var c = b.ch.At(b.at + (s0 + s1) * 0.5f);
                    set.still.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                    {
                        name = $"桥下 · {b.name}{(tag.Length > 0 ? $" {tag}{++k}" : "")}", center = new Vector3(c.x, b.ch.lava, c.y), shape = LavaShape.Box,
                        size = new Vector2(b.ch.half * 2f, s1 - s0), yaw = b.ch.Yaw,
                        depth = b.ch.arena ? 1f : 1.6f, depthShore = !b.ch.arena, flow = new Vector2(0, 0.3f * b.ch.flow),
                    }, root));
                }
            }
            return set;
        }

        /// <summary>[lo, hi] 去掉若干区间后剩下的段（按起点排序）</summary>
        static IEnumerable<(float, float)> Spans(float lo, float hi, List<(float a, float b)> cuts)
        {
            float at = lo;
            foreach (var (a, b) in cuts.OrderBy(c => c.a))
            {
                if (b <= at) continue;
                if (a > at) yield return (at, Mathf.Min(a, hi));
                at = Mathf.Max(at, b);
                if (at >= hi) yield break;
            }
            if (at < hi) yield return (at, hi);
        }

        // ───────────── 桥 ─────────────

        /// <summary>铁桥（ART6 没有这一件：白盒）：桥面顶 = 床面 + 5 cm，两头各压 2 m 床面；铸坊的桥 0.8 m 厚，神范台的 0.4 m</summary>
        static List<GameObject> BuildBridges(Transform arch)
        {
            var root = new GameObject("Iron Bridges").transform;
            root.SetParent(arch, false);
            var list = new List<GameObject>();
            foreach (var b in Bridges)
            {
                var c = b.Center;
                var size = b.ch.NS ? new Vector3(b.Span, b.Thick, b.width) : new Vector3(b.width, b.Thick, b.Span);
                // 白盒的顶 = 底面中心 y + 尺寸 y − 0.05（PlaceOrBox 往下埋 0.1 m）
                var go = LevelKit.PlaceOrBox(BridgeId, root, new Vector3(c.x, DeckTop - b.Thick + 0.05f, c.y), size, 0);
                Label(go, BridgeId, $"{b.id} {b.name}");
                list.Add(go);
            }
            return list;
        }

        // ───────────── 各区 ─────────────

        /// <summary>南闸门：火山口南壁上的闸楼（出生点背后），闸台两侧火坛</summary>
        static void BuildGate(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("South Gate").transform;
            root.SetParent(arch, false);
            Put(GatewayId, root, set, new Vector2(100, -1.5f), 0, 1f, 0.3f, GatewaySize);
            Put(AltarId, props, set, new Vector2(90, 10), 0, 1.2f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(110, 10), 0, 1.2f, 0.05f, AltarSize);
            Put(IngotsId, props, set, new Vector2(108, 4), 30, 1.1f, 0.1f, IngotsSize);
        }

        /// <summary>① 中央铸床：浇包吊台（3 m，台上一口大坩埚）、台两侧火坛、矮墙、拒马、锭堆、两张铸床</summary>
        static void BuildCentral(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("① Central Bed").transform;
            root.SetParent(props, false);
            var crucible = Put(CrucibleId, root, set, new Vector2(103, 68), 20, 2.6f, 0.02f, CrucibleSize);
            Label(crucible, CrucibleId, "浇包");
            Put(AltarId, root, set, new Vector2(91, 66), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(109, 62), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(84, 54), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(116, 54), 0, 1.3f, 0.05f, AltarSize);
            Put(CoverWallId, root, set, new Vector2(84, 80), 0, 1.1f, 0.2f, CoverWallSize);
            Put(CoverWallId, root, set, new Vector2(116, 80), 0, 1.1f, 0.2f, CoverWallSize);
            Put(BarricadeId, root, set, new Vector2(80, 98), 0, 1.2f, 0.1f, BarricadeSize);
            Put(BarricadeId, root, set, new Vector2(120, 98), 0, 1.2f, 0.1f, BarricadeSize);
            Put(IngotsId, root, set, new Vector2(88, 34), 15, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, root, set, new Vector2(112, 34), -25, 1.2f, 0.1f, IngotsSize);
            Label(Put(BedId, root, set, new Vector2(78, 40), 90, 1f, 0.1f, BedSize), BedId, "中央铸床");
            Label(Put(BedId, root, set, new Vector2(122, 90), 90, 1f, 0.1f, BedSize), BedId, "中央铸床");
        }

        /// <summary>③ 东铸床：三排铸范（每排两对，挡直射）、铸铁墙台上两根 5 m 立柱（毕方栖点）、两张铸床、火坛、锭堆</summary>
        static void BuildEast(LevelKit.TerrainSet set, Transform props, Transform markers)
        {
            var root = new GameObject("③ East Bed").transform;
            root.SetParent(props, false);
            foreach (float z in new[] { 48f, 62f, 76f })
            foreach (float cx in new[] { 154f, 170f })
            foreach (int side in new[] { -1, 1 })
                Label(Put(MouldId, root, set, new Vector2(cx + side * 1.6f, z), 180, 1f, 0.05f, MouldSize), MouldId, "范列");
            foreach (float z in new[] { 50f, 74f })
            {
                var col = Put(ColumnId, root, set, new Vector2(192, z), 0, 1f, 0.05f, ColumnSize);
                if (col) Marker(markers, $"PerchPoint_East_{z:0}", set.OnGround(192, z, ColumnSize.y - 0.05f));
            }
            Label(Put(BedId, root, set, new Vector2(154, 28), 0, 1f, 0.1f, BedSize), BedId, "东铸床");
            Label(Put(BedId, root, set, new Vector2(176, 96), 0, 1f, 0.1f, BedSize), BedId, "东铸床");
            Put(AltarId, root, set, new Vector2(148, 40), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(148, 84), 0, 1.3f, 0.05f, AltarSize);
            Put(IngotsId, root, set, new Vector2(160, 98), 40, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, root, set, new Vector2(184, 18), -10, 1.2f, 0.1f, IngotsSize);
        }

        /// <summary>废范场（西南）：碎鼎、倒伏的废范、矮墙、锭堆——没出炉的残兵埋在这里（可选守军 + 藏宝）</summary>
        static void BuildScrapYard(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Scrap Yard").transform;
            root.SetParent(props, false);
            Put(RuinId, root, set, new Vector2(12, 82), 20, 1.4f, 0.15f, RuinSize);
            Put(RuinId, root, set, new Vector2(42, 38), -30, 1.4f, 0.15f, RuinSize);
            Put(CoverWallId, root, set, new Vector2(30, 92), 0, 1.1f, 0.2f, CoverWallSize);
            Put(CoverWallId, root, set, new Vector2(10, 48), 90, 1.1f, 0.2f, CoverWallSize);
            Label(Put(MouldId, root, set, new Vector2(42, 72), 35, 1f, 0.3f, MouldSize), MouldId, "废范");
            Label(Put(MouldId, root, set, new Vector2(20, 26), -15, 1f, 0.3f, MouldSize), MouldId, "废范");
            Label(Put(MouldId, root, set, new Vector2(46, 18), 60, 1f, 0.3f, MouldSize), MouldId, "废范");
            Put(IngotsId, root, set, new Vector2(44, 100), 10, 1.2f, 0.1f, IngotsSize);
            Put(AltarId, root, set, new Vector2(30, 102), 0, 1.3f, 0.05f, AltarSize);
        }

        sealed class Hall
        {
            public Transform[] bellows;
            public Transform furnaceMouth;
            public Light[] lights;
        }

        /// <summary>
        /// 鼓风正殿（西北）：没有墙的殿——南北两排、东侧两根 18 m 扶壁柱围出殿的轮廓，柱间 15 m 的口子都能进；西头大炉（炉塔 × 1.3）与两段殿墙、炉坛 3.5 m；
        /// 两台巨型风箱（白盒，瘪着时 2.8 m 高的长掩体）把殿分成南北两条风箱道，中间 14 m 宽的十字口；道里六根 5 m 铁柱（飞鸦 / 毕方的栖点）；东头检修台 3 m。
        /// 风箱挂在各自的根节点下（底面贴地，按 Y 缩放：风闸拉开后鼓起来）
        /// </summary>
        static Hall BuildHall(LevelKit.TerrainSet set, Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("Blast Hall").transform;
            root.SetParent(arch, false);
            foreach (float x in ButtressX)
            {
                Label(Put(ButtressId, root, set, new Vector2(x, ButtressSouthZ), 0, 1f, 0.3f, ButtressSize), ButtressId, "南扶壁");
                Label(Put(ButtressId, root, set, new Vector2(x, ButtressNorthZ), 180, 1f, 0.3f, ButtressSize), ButtressId, "北扶壁");
            }
            foreach (float z in ButtressEastZ) Label(Put(ButtressId, root, set, new Vector2(ButtressEastX, z), 90, 1f, 0.3f, ButtressSize), ButtressId, "东扶壁");
            Put(HallWallId, root, set, new Vector2(4, 131), 90, 1f, 0.3f, HallWallSize);
            Put(HallWallId, root, set, new Vector2(4, 173), 90, 1f, 0.3f, HallWallSize);
            Label(Put(FurnaceId, root, set, FurnaceAt, 90, 1.3f, 0.2f, FurnaceSize), FurnaceId, "大炉");

            var bellows = new List<Transform>();
            foreach (var (c, tag) in new[] { (BellowsA, "A"), (BellowsB, "B") })
            {
                var b = new GameObject($"Bellows {tag}").transform;
                b.SetParent(root, false);
                b.position = set.OnGround(c.x, c.y, -0.1f);
                // PlaceOrBox 摆 Prefab 按父节点本地坐标、白盒按世界坐标：先摆在原点的父节点下，再保持世界位置挂到风箱根下
                var piece = LevelKit.PlaceOrBox(BellowsId, root, b.position, BellowsSize, 180);
                if (piece)
                {
                    piece.transform.SetParent(b, true);
                    Label(piece, BellowsId, $"风箱 {tag}");
                    foreach (var t in piece.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
                }
                b.gameObject.isStatic = false;
                b.localScale = new Vector3(1, BellowsRest, 1);
                bellows.Add(b);
            }

            foreach (var (c, i) in HallColumns.Select((c, i) => (c, i)))
            {
                var col = Put(ColumnId, root, set, c, i * 37f, 1f, 0.05f, ColumnSize);
                if (col) Marker(markers, $"PerchPoint_Hall_{i + 1}", set.OnGround(c.x, c.y, ColumnSize.y - 0.05f));
            }
            Put(AltarId, props, set, new Vector2(40, 128), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(58, 176), 0, 1.3f, 0.05f, AltarSize);
            Put(IngotsId, props, set, new Vector2(62, 127), 20, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, props, set, new Vector2(36, 177), -30, 1.2f, 0.1f, IngotsSize);

            // 炉口（火星、火光）：炉塔正面往东 4.5 m、离地 2.2 m；两盏不投影的炉光（风闸拉开前很暗）
            var mouth = new GameObject("Furnace Mouth").transform;
            mouth.SetParent(markers, false);
            mouth.position = set.OnGround(FurnaceAt.x + 5f, FurnaceAt.y, 2.2f);
            var lights = new List<Light>();
            foreach (float dz in new[] { -3.5f, 3.5f })
            {
                var l = new GameObject("Furnace Light").AddComponent<Light>();
                l.transform.SetParent(props, false);
                l.transform.position = set.OnGround(FurnaceAt.x + 6f, FurnaceAt.y + dz, 3f);
                l.type = LightType.Point;
                l.color = new Color(1f, 0.5f, 0.2f);
                l.intensity = 0.4f;
                l.range = 24f;
                l.shadows = LightShadows.None;
                lights.Add(l);
            }
            return new Hall { bellows = bellows.ToArray(), furnaceMouth = mouth, lights = lights.ToArray() };
        }

        /// <summary>风闸台（殿北、炉闸西侧，2 m）：风闸链柱；北壁正中的炉闸（熔铁闸门 × 1.2，白盒）压在主渠渠头，一盏常亮的熔铜光</summary>
        static void BuildWindTerrace(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Sluice").transform;
            root.SetParent(arch, false);
            var sluice = LevelKit.PlaceOrBox(GateId, root, new Vector3(SluiceAt.x, FieldFloor, SluiceAt.y), GateSize * 1.2f, 180, 1.2f);
            if (sluice) sluice.isStatic = true;
            Label(sluice, GateId, "炉闸");
            var l = new GameObject("Sluice Light").AddComponent<Light>();
            l.transform.SetParent(props, false);
            l.transform.position = new Vector3(SluiceAt.x, 2f, SluiceAt.y - 5f);
            l.type = LightType.Point;
            l.color = new Color(1f, 0.55f, 0.2f);
            l.intensity = 5f;
            l.range = 32f;
            l.shadows = LightShadows.None;
            Put(AltarId, props, set, new Vector2(62, 210), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(90, 192), 0, 1.3f, 0.05f, AltarSize);
            Put(IngotsId, props, set, new Vector2(76, 210), 0, 1.2f, 0.1f, IngotsSize);
        }

        /// <summary>
        /// 神范台（东北）：东北角神范台 3.5 m 上立着神范（巨型铸范 × 3，白盒，全图地标、出口在它前面）；四个象限各两件掩体（铸范 / 铸床）+ 一根 5 m 铁柱。
        /// 返回掩体点（给首领场地）
        /// </summary>
        static List<Vector2> BuildArenaProps(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Mould Dais").transform;
            root.SetParent(arch, false);
            var mould = LevelKit.PlaceOrBox(MouldId, root, set.OnGround(MouldAt.x, MouldAt.y, -0.1f), MouldSize * MouldScale, MouldYaw, MouldScale);
            if (mould) mould.isStatic = true;
            Label(mould, MouldId, "神范");
            MouldGlow(mould, props);
            var covers = new List<Vector2>();
            void Cover(string id, Vector2 at, float yaw, Vector3 size, string what)
            {
                Label(Put(id, root, set, at, yaw, 1f, 0.05f, size), id, what);
                covers.Add(at);
            }
            Cover(MouldId, new Vector2(124, 194), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(136, 180), 90, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(166, 178), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(122, 142), 90, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(136, 128), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(170, 146), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(188, 130), 90, MouldSize, "神范台掩体");
            Cover(BedId, new Vector2(132, 206), 0, BedSize, "神范台铸床");
            Cover(BedId, new Vector2(168, 128), 0, BedSize, "神范台铸床");
            foreach (var c in new[] { new Vector2(116, 204), new Vector2(164, 206), new Vector2(116, 152), new Vector2(190, 152) })
            {
                Put(ColumnId, root, set, c, 0, 1f, 0.05f, ColumnSize);
                covers.Add(c);
            }
            // 两只火坛夹着神范台坡道的坡脚（原来一只塞在台壁和坡道之间的夹角里，从台上看像埋进了台子）
            Put(AltarId, props, set, new Vector2(178.5f, 182.5f), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(189.5f, 182.5f), 0, 1.3f, 0.05f, AltarSize);
            return covers;
        }

        /// <summary>
        /// 神范是全图地标兼出口，可白盒是一块暗铁，在热雾里贴着同色的火山口壁根本读不出来（雾 18–170 m；出生点离它 220 m，雾外什么都看不见）：
        /// 白盒时在顶上加一口发亮的浇口熔铜、腰上一道发亮的合范缝（子物体，没有碰撞，不算占位件；正式件到了就不加），
        /// 再在神范前挂一盏不投影的熔铜光（正式件也留着）
        /// </summary>
        static void MouldGlow(GameObject mould, Transform props)
        {
            if (!mould) return;
            var at = mould.transform.position;
            if (IsPlaceholder(mould))
            {
                var hot = LevelKit.GlowMat(Dir, "MouldGlow", new Color(1f, 0.5f, 0.2f), new Color(4f, 1.4f, 0.35f));
                // 白盒是单位立方体按尺寸缩放（局部 y ∈ [−0.5, 0.5]）
                foreach (var (name, pos, scale) in new[]
                         {
                             ("神范 · 浇口熔铜", new Vector3(0, 0.58f, 0), new Vector3(0.42f, 0.2f, 0.42f)),
                             ("神范 · 合范缝", new Vector3(0, 0.08f, 0), new Vector3(1.02f, 0.05f, 1.02f)),
                         })
                {
                    var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    g.name = name;
                    Object.DestroyImmediate(g.GetComponent<Collider>());
                    g.transform.SetParent(mould.transform, false);
                    g.transform.localPosition = pos;
                    g.transform.localRotation = Quaternion.identity;
                    g.transform.localScale = scale;
                    var r = g.GetComponent<MeshRenderer>();
                    r.sharedMaterial = hot;
                    r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                    g.isStatic = true;
                }
            }
            var l = new GameObject("Mould Light").AddComponent<Light>();
            l.transform.SetParent(props, false);
            l.transform.position = at + new Vector3(-5f, 4f, -5f);
            l.type = LightType.Point;
            l.color = new Color(1f, 0.55f, 0.2f);
            l.intensity = 4f;
            l.range = 22f;
            l.shadows = LightShadows.None;
        }

        static void BuildScatter(LevelKit.TerrainSet set, Transform env)
        {
            // 细节散布（没有碰撞）：余烬石沿渠岸，火山渣在床面上；避开桥头、台、坡道
            float Clear(Vector2 p)
            {
                float d = float.MaxValue;
                foreach (var b in Bridges) d = Mathf.Min(d, Vector2.Distance(p, b.Center) - b.width);
                foreach (var pl in Platforms) d = Mathf.Min(d, LevelKit.BoxSdf(p, pl.min, pl.max) - 1f);
                d = Mathf.Min(d, LevelKit.BoxSdf(p, new Vector2(10, 124), new Vector2(90, 180)));
                return Mathf.Max(0, d);
            }
            var counts = LevelKit.ScatterDetails(set, LevelKit.ScatterPresets.Details("Inferno"), Clear, 1f, 160f);
            Debug.Log($"[Level] 3-3 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}");
        }

        static Transform Marker(Transform parent, string name, Vector3 pos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            return go.transform;
        }

        // ───────────── 遭遇 ─────────────
        /// <summary>
        /// 刷怪站位（标记名 → 位置、角色、lane、高台）。高台站位只给飞的（毕方、神火飞鸦）；吊台、墙台、炉坛、检修台是坡道走得上去的地面站位，
        /// 远程 / 炮击 / 辅助按角色站上去。火鼍的站位贴着渠边（它从岸上下熔岩潜游）。每个站位离掩体件 ≥ 2 m（铁牛半径约 1.3 m × 1.25 精英）。
        /// </summary>
        static readonly (string name, Vector2 at, StationRole role, int lane, bool elevated)[] AnchorDefs =
        {
            // ① 中央铸床：火鼍在东西两渠边，炭童从吊台南北包抄，吊台顶炮仗傀儡
            ("Enemy_1_TuoWest", new Vector2(71, 72), StationRole.Assault, 0, false),
            ("Enemy_1_TuoEast", new Vector2(129, 56), StationRole.Assault, 1, false),
            ("Enemy_1_North", new Vector2(100, 90), StationRole.Assault, 0, false),
            ("Enemy_1_South", new Vector2(100, 40), StationRole.Assault, 1, false),
            ("Enemy_1_FlankW", new Vector2(78, 52), StationRole.Flank, 2, false),
            ("Enemy_1_FlankE", new Vector2(122, 74), StationRole.Flank, 1, false),
            ("Enemy_1_LadleTop", new Vector2(98, 62), StationRole.Artillery, 0, false),
            // ② 鼓风正殿（一）：铁牛在风箱道，炭童从十字口和殿东口包抄，炉坛 / 检修台远程
            ("Enemy_2_NorthLane", new Vector2(40, 164), StationRole.Assault, 0, false),
            ("Enemy_2_SouthLane", new Vector2(60, 140), StationRole.Assault, 1, false),
            ("Enemy_2_Aisle", new Vector2(48, 152), StationRole.Flank, 2, false),
            ("Enemy_2_Altar", new Vector2(16, 152), StationRole.Ranged, 0, false),
            ("Enemy_2_Service", new Vector2(82, 152), StationRole.Ranged, 1, false),
            ("Enemy_2_EastMouth", new Vector2(84, 132), StationRole.Flank, 1, false),
            // ③ 东铸床：范列背后炮仗傀儡，熔铜匠躲在范后，墙台上空毕方，两翼炭童
            ("Enemy_3_RowWest", new Vector2(147, 62), StationRole.Assault, 0, false),
            ("Enemy_3_BehindN", new Vector2(182, 70), StationRole.Artillery, 1, false),
            ("Enemy_3_BehindS", new Vector2(182, 54), StationRole.Artillery, 2, false),
            ("Enemy_3_Founder", new Vector2(178, 62), StationRole.Support, 0, false),
            ("Enemy_3_Terrace", new Vector2(192, 62), StationRole.Precision, 0, true),
            ("Enemy_3_FlankN", new Vector2(160, 92), StationRole.Flank, 1, false),
            ("Enemy_3_FlankS", new Vector2(163, 35), StationRole.Flank, 2, false),
            // ④ 鼓风正殿（二）：祸斗沿风箱道吃火，傩巫上炉坛，飞鸦从殿顶俯冲，精英铁牛守炉门
            ("Enemy_4_NorthLane", new Vector2(30, 160), StationRole.Assault, 0, false),
            ("Enemy_4_SouthLane", new Vector2(66, 144), StationRole.Assault, 1, false),
            ("Enemy_4_Aisle", new Vector2(48, 152), StationRole.Flank, 2, false),
            ("Enemy_4_Altar", new Vector2(16, 146), StationRole.Support, 0, false),
            ("Enemy_4_Service", new Vector2(82, 148), StationRole.Ranged, 1, false),
            ("Enemy_4_West", new Vector2(26, 127), StationRole.Assault, 2, false),
            ("Enemy_4_AirNorth", new Vector2(38, 172), StationRole.Support, 1, true),
            ("Enemy_4_AirSouth", new Vector2(62, 131), StationRole.Flank, 2, true),
            // ⑤ 废范守军（可选）
            ("Enemy_5_Ranged", new Vector2(16, 66), StationRole.Ranged, 0, false),
            ("Enemy_5_FlankA", new Vector2(40, 48), StationRole.Flank, 1, false),
            ("Enemy_5_FlankB", new Vector2(15, 42), StationRole.Assault, 2, false),
            ("Enemy_5_Front", new Vector2(36, 64), StationRole.Assault, 0, false),
        };

        /// <summary>两处藏宝：废范残兵（有守军）、炉工私藏（风闸台上，无人看守）</summary>
        static readonly Vector2 ScrapCache = new(26, 56), ForgeCache = new(70, 206);

        static void BuildMarkers(LevelKit.TerrainSet set, Transform root)
        {
            Marker(root, "Site_Spawn", set.OnGround(Spawn.x, Spawn.y));
            Marker(root, "Site_1_Central", set.OnGround(CentralSite.x, CentralSite.y));
            Marker(root, "Site_2_Hall", set.OnGround(HallSite.x, HallSite.y));
            Marker(root, "Site_3_East", set.OnGround(EastSite.x, EastSite.y));
            Marker(root, "Site_5_Scrap", set.OnGround(ScrapSite.x, ScrapSite.y));
            Marker(root, "Site_Lord", set.OnGround(ArenaCenter.x, ArenaCenter.y));
            foreach (var a in AnchorDefs)
            {
                var t = Marker(root, a.name, set.OnGround(a.at.x, a.at.y));
                var sa = t.gameObject.AddComponent<SpawnAnchor>();
                (sa.role, sa.lane, sa.elevated) = (a.role, a.lane, a.elevated);
            }
        }

        /// <summary>
        /// 遭遇（遭遇框架 v2；第三章 V2 阵容）。3-3 的四场都由「熔铜切开的铸床」出题：
        ///   ① 中央铸床 8：火鼍第一次在渠里换边潜游 + 炭童；第二波炮仗傀儡上吊台齐射；
        ///   ② 鼓风正殿（一）7：熔炉铁牛在风箱道里吸气拉人 + 炭童；第二波马面甩钩；
        ///   ③ 东铸床 9：炮仗傀儡 + 熔铜匠浇铜甲 + 炭童；第二波毕方立在墙台立柱上点射；升格 1 只精英；
        ///   ④ 鼓风正殿（二）11：风闸拉开后才会触发——祸斗吃风箱道上的火、傩巫；神火飞鸦从殿顶俯冲；末波精英铁牛守炉门；
        ///   ⑤ 废范守军 4（可选，调查藏宝时惊动）。
        /// 必清 35 只，可选 4 只。奖励：① 秘卷、② 武器、③ 秘卷、④ 武器（保底精良）、废范藏宝 武器（保底精良）、炉工私藏 强化；
        /// 之后神范台的熔心魔将（首领宝箱 + 清关宝箱）。
        /// </summary>
        static LevelObjective BuildEncounters(LevelKit.TerrainSet set, Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset = default)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = set.OnGround(center.x, center.y);
                site.title = title;
                site.triggerRadius = trigger;
                site.arenaRadius = arena;
                site.spec = spec;
                site.reward = reward;
                site.chestOffset = chestOffset;
                site.requires = Array.Empty<EncounterSite>();
                var anchors = new List<Transform>();
                foreach (Transform m in markers)
                    if (m.name.StartsWith($"Enemy_{index}_"))
                        anchors.Add(m);
                site.anchors = anchors.ToArray();
                return site;
            }
            WaveEntry E(string enemy, int count, float delay = -1) => EncounterSpec.E(enemy, count, delay);

            var s1 = Site(1, "中央铸床", CentralSite, 26, 34, EncounterSpec.Of(
                    EncounterSpec.Wave("铸床火鼍", E("tuo", 1), E("tantong", 3)).Hint("火鼍在两侧铸渠里换边潜游——床沿鼓泡就是要扑，引它上岸到吊台下打脊背接缝"),
                    EncounterSpec.Wave("余烬复燃", E("tantong", 3), E("firecracker", 1)).After(2, 1.6f).Hint("炮仗傀儡在吊台上齐射——躲到台下或绕到侧面"))
                .Gather(0.4f).Distance(10, 34), "scroll", new Vector3(-12, 0, 0));
            var s2 = Site(2, "鼓风正殿", HallSite, 28, 36, EncounterSpec.Of(
                    EncounterSpec.Wave("风箱道铁牛", E("iron_ox", 1), E("tantong", 3)).Hint("铁牛吸气沿风箱道拉人——顶着吸力打它胸口的炉门"),
                    EncounterSpec.Wave("风箱两头", E("tantong", 2), E("mamian", 1)).After(1, 1.6f).Hint("马面甩钩把人拖出掩体——打断铁链挣脱"))
                .Gather(0.5f).Distance(10, 34), "weapon", new Vector3(0, 0, -16));
            var s3 = Site(3, "东铸床", EastSite, 26, 34, EncounterSpec.Of(
                    EncounterSpec.Wave("范列炮阵", E("firecracker", 2), E("founder", 1), E("tantong", 2)).Hint("熔铜匠给扎堆的傀儡浇铜甲——刚浇上时一打就碎，冷了就硬"),
                    EncounterSpec.Wave("墙台点射", E("bifang", 1), E("firecracker", 1), E("tantong", 2)).After(2, 1.6f).Hint("毕方立在铸铁墙台的柱顶点射——打它的腿把它打下来"))
                .Gather(0.4f).Distance(10, 34).Elites(1), "scroll", new Vector3(0, 0, 24));
            var s4 = Site(4, "鼓风正殿 · 炉门守军", HallSite, 28, 36, EncounterSpec.Of(
                    EncounterSpec.Wave("炉门守军", E("huodou", 3), E("nuo", 1)).Hint("祸斗在吃风箱道上的火——先碎傩巫的金面"),
                    EncounterSpec.Wave("飞鸦扑殿", E("fire_crow", 3), E("huodou", 1)).After(1, 1.6f).Hint("神火飞鸦成群俯冲，空中打爆一只会连环炸到旁边的"),
                    EncounterSpec.Wave("炉前精英", E("iron_ox", 1).Elite(), E("tantong", 2)).After(1, 2f).Hint("精英铁牛守着炉门——吸气时顶着打它胸口"))
                .Gather(0.6f).Distance(10, 34), "weapon:min=1", new Vector3(0, 0, 16));
            // 第二次进殿：要求第一次已清，开局不自动触发（风闸拉开后由 FoundryWindGate 打开）
            s4.requires = new[] { s2 };
            s4.autoTrigger = false;
            var guard = Site(5, "废范守军", ScrapSite, 16, 24, EncounterSpec.Of(
                    EncounterSpec.Wave("废范守军", E("mamian", 1), E("tantong", 3)).Hint("守着废范残兵的狱卒"))
                .Gather(0.4f).Distance(8, 26), "");
            guard.autoTrigger = false;
            guard.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "肃清铸范大坊";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { guard };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>风闸：风闸台东北角，朝西南（看得见炉闸、主渠和对岸的神范台）；链柱是现成的 ChainObelisk，拉杆运行时拼</summary>
        static FoundryWindGate BuildWindGate(LevelKit.TerrainSet set, Transform markers, Transform props, LevelObjective objective, Hall hall, List<LavaVolume> tides)
        {
            var at = set.OnGround(WindGateAt.x, WindGateAt.y);
            var go = new GameObject("Wind Gate · 风闸");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(at, Quaternion.Euler(0, WindGateYaw, 0));
            var post = Put(ObeliskId, props, set, WindGateAt - new Vector2(Mathf.Sin(WindGateYaw * Mathf.Deg2Rad), Mathf.Cos(WindGateYaw * Mathf.Deg2Rad)) * 0.9f,
                WindGateYaw, 1.5f, 0.05f, ObeliskSize);
            if (post) post.name = $"{post.name} · 风闸链柱";
            var pivot = new GameObject("Lever Pivot").transform;
            pivot.SetParent(go.transform, false);
            pivot.localPosition = new Vector3(0, 1.3f, 0.6f);
            var gate = go.AddComponent<FoundryWindGate>();
            gate.firstVisit = objective.required[1];
            gate.secondVisit = objective.required[3];
            gate.bellows = hall.bellows;
            gate.bellowsRest = BellowsRest;
            gate.lever = pivot;
            gate.furnaceMouth = hall.furnaceMouth;
            gate.furnaceLights = hall.lights;
            gate.tides = tides.ToArray();
            gate.laneFrom = FireLanes.Select(l => set.OnGround(l.from.x, l.from.y)).ToArray();
            gate.laneTo = FireLanes.Select(l => set.OnGround(l.to.x, l.to.y)).ToArray();
            return gate;
        }

        /// <summary>
        /// 支路藏宝（CachePOI）：废范场一处有守军（调查时惊动「废范守军」，肃清后出宝箱，武器保底精良）；风闸台西头一处炉工私藏（无人看守，强化）。
        /// 模型用现成资产（Model 子物体），放在藏宝点旁 2.5–3 m
        /// </summary>
        static void BuildCaches(LevelKit.TerrainSet set, Transform markers, LevelObjective objective)
        {
            var guard = objective.optional.FirstOrDefault();
            void Cache(string title, Vector2 at, float yaw, string reward, EncounterSite guardSite, string modelId, Vector2 modelOffset, Vector3 size)
            {
                var poi = new GameObject($"Cache · {title}").AddComponent<CachePOI>();
                poi.transform.SetParent(markers, false);
                poi.transform.SetPositionAndRotation(set.OnGround(at.x, at.y), Quaternion.Euler(0, yaw, 0));
                poi.title = title;
                poi.reward = reward;
                poi.guard = guardSite;
                poi.discoverRadius = 14;
                var mAt = at + modelOffset;
                var model = LevelKit.PlaceOrBox(modelId, poi.transform, set.OnGround(mAt.x, mAt.y, -0.1f), size, yaw);
                if (!model) return;
                model.name = "Model";
                model.transform.SetPositionAndRotation(set.OnGround(mAt.x, mAt.y, -0.1f), Quaternion.Euler(0, yaw, 0));
                model.isStatic = true;
            }
            Cache("废范残兵", ScrapCache, 90, "weapon:min=1", guard, HoardId, new Vector2(-2.6f, 0), HoardSize);
            Cache("炉工私藏", ForgeCache, 180, "upgrade", null, StallId, new Vector2(-3f, 1.2f), StallSize);
        }

        sealed class Lord
        {
            public BossArena arena;
            public BossEncounter encounter;
            public FoundryLordGate gate;
            public FoundryChannels channels;
            public GameObject[] gates;
        }

        /// <summary>
        /// 神范台领主战：首领场地（矩形，x 108–196、z 120–208；只给 boss_warlord）、熔铜渠（会漫的那 9 片熔岩）、首领关流程（目标完成前关着）、
        /// 两扇熔铁闸（白盒，开战时从闸前桥、东铸北桥的桥头升起封住，结算后落回去；场景里关着，不挡导航烘焙）、清关宝箱落点、出口点（神范前）
        /// </summary>
        static Lord BuildLord(LevelKit.TerrainSet set, Transform markers, LevelObjective objective, List<Vector2> covers, List<LavaVolume> surge)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var root = new GameObject("BossArena · 神范台").transform;
            root.SetParent(markers, false);
            root.SetPositionAndRotation(new Vector3(ArenaCenter.x, 0, ArenaCenter.y), Quaternion.identity);
            var arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Box;
            arena.halfSize = ArenaHalfSize;
            Transform Point(string name, Vector3 pos, Vector2 facing)
            {
                var p = new GameObject(name).transform;
                p.SetParent(root, false);
                p.position = pos;
                if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(new Vector3(facing.x, 0, facing.y));
                return p;
            }
            arena.bossSpawn = Point("BossSpawn", G(BossSpawnAt), new Vector2(-1, -1));
            arena.playerEntry = Point("PlayerEntry", G(PlayerEntryAt), new Vector2(1, 1));
            arena.summonPoints = Array.Empty<Transform>();
            arena.coverPoints = covers.Select((c, i) =>
            {
                // 掩体点站在掩体朝场地中心的那一侧 2.5 m
                var toCenter = (ArenaCenter - c).normalized;
                return Point($"Cover_{i + 1}", G(c + toCenter * 2.5f), toCenter);
            }).ToArray();
            arena.perchPoints = new[] { Point("Perch_Dais", G(ExitAt) , new Vector2(-1, -1)) };
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                float a = (22.5f + i * 45f) * Mathf.Deg2Rad;
                var off = new Vector2(Mathf.Sin(a), Mathf.Cos(a)) * 38f;
                return Point($"Edge_{i + 1}", G(ArenaCenter + off), -off);
            }).ToArray();

            var channels = root.gameObject.AddComponent<FoundryChannels>();
            channels.surge = surge.ToArray();
            channels.rise = SurgeRise;

            // 熔铁闸：闸前桥的东头、东铸北桥的北头
            var gateRoot = new GameObject("Lord Gates · 熔铁闸").transform;
            gateRoot.SetParent(markers, false);
            var b5 = BridgeById("B5").Center;
            var b6 = BridgeById("B6").Center;
            var gA = LevelKit.PlaceOrBox(GateId, gateRoot, new Vector3(b5.x + Trunk.half + 2.6f, 0, b5.y), GateSize, 90);
            var gB = LevelKit.PlaceOrBox(GateId, gateRoot, new Vector3(b6.x, 0, b6.y + Cross.half + 3.5f), new Vector3(GateSize.x * 1.2f, GateSize.y, GateSize.z), 0, 1.2f);
            Label(gA, GateId, "闸前桥封门");
            Label(gB, GateId, "东铸北桥封门");
            var gates = new[] { gA, gB }.Where(g => g).ToArray();
            foreach (var g in gates)
            {
                foreach (var t in g.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
                g.SetActive(false);
            }

            var exitPoint = Point("Lord Exit · 神范前", G(ExitAt), new Vector2(-1, -1));
            exitPoint.SetParent(markers, true);
            var rewardPoint = Point("Lord Reward", G(BossRewardAt), new Vector2(-1, -1));
            rewardPoint.SetParent(markers, true);
            var clearPoint = Point("Lord Clear Chest", G(ClearChestAt), new Vector2(-1, -1));
            clearPoint.SetParent(markers, true);

            var go = new GameObject("Boss Encounter · 熔心魔将");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2f;
            enc.gates = gates;
            enc.warnSeconds = 2.5f;
            enc.warnText = "神范台的熔铜沸腾了——熔心魔将自神范中醒来！";
            enc.tetherSlack = 8f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
            // 四处必清场地肃清前不开打（FoundryLordGate 在目标完成时打开）
            enc.enabled = false;

            var lg = go.AddComponent<FoundryLordGate>();
            lg.objective = objective;
            lg.encounter = enc;
            lg.clearChestPoint = clearPoint;
            return new Lord { arena = arena, encounter = enc, gate = lg, channels = channels, gates = gates };
        }

        // ───────────── 自查 ─────────────

        /// <summary>白盒自查：关键高度、渠深、桥面贴床、熔岩分段、涨落参数、风箱与风闸接线、领主战接线、第三章占位件清单</summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, LavaSet lava, List<GameObject> decks, Hall hall, FoundryWindGate gate, Lord lord)
        {
            rep.Section("地形 · 熔铜渠 · 桥");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("中央铸床床面", Y(new Vector2(84, 66)), 0, 0.3f);
            Near("东铸床床面", Y(new Vector2(160, 40)), 0, 0.3f);
            Near("鼓风正殿地面", Y(new Vector2(48, 141)), 0, 0.3f);
            Near("神范台床面", Y(new Vector2(130, 186)), 0, 0.05f);
            foreach (var pl in Platforms) Near($"{pl.name}台顶", Y(pl.Center + new Vector2(0.5f, 0.5f)), pl.h, 0.35f);
            foreach (var c in Channels)
            {
                var mid = c.At(c.arena ? (c.lo + c.hi) * 0.5f + 10f : (c.lo + c.hi) * 0.5f + 3f);
                Near($"{c.name}渠底", Y(mid), c.floor, 0.3f);
            }
            Near("神范熔池池底", Y(Basin), ArenaFloor, 0.2f);
            // 渠壁：渠边外 1 m 已在床面；最陡处 45–58°——人和地面敌人走不上来（45°），火鼍扑岸爬得上来（TuoAI 把陡过 60° 的面当墙）
            float wallTop = Y(new Vector2(EastC.a.x + EastC.half + 1f, 30));
            float steep = 0;
            for (float x = EastC.a.x + 0.5f; x < EastC.a.x + EastC.half + 0.5f; x += 0.1f)
                steep = Mathf.Max(steep, Mathf.Atan2(Mathf.Abs(Y(new Vector2(x + 0.1f, 30)) - Y(new Vector2(x, 30))), 0.1f) * Mathf.Rad2Deg);
            if (wallTop < -0.3f) rep.Fail($"东渠渠边外 1 m 还在坡上（y = {wallTop:F2}）：铸床边会是一道斜坡");
            else if (steep < 45f || steep > 58f) rep.Fail($"东渠渠壁最陡 {steep:F0}°（应在 45–58°：再缓人能走下渠，再陡火鼍爬不上岸）");
            else rep.Line($"✓ 铸坊渠壁最陡 {steep:F0}°（人走不上来、火鼍爬得上岸），渠边外 1 m 已在床面（y = {wallTop:F2}）");

            // 编辑器里 LavaVolume 不登记进 LavaField（OnEnable 不跑）：自己收一份判定体
            var bodies = lava.tides.Concat(lava.surge).Concat(lava.still).Where(v => v).Select(v => v.Body).ToList();

            // 桥：桥面贴床（两头落脚点与桥面高差 ≤ 0.2 m），桥面不在任何熔岩判定里
            int badDeck = 0;
            foreach (var b in Bridges)
            {
                var c = b.Center;
                var axis = b.ch.NS ? Vector2.right : Vector2.up;
                float half = b.Span * 0.5f;
                float y0 = Y(c - axis * (half + 0.8f)), y1 = Y(c + axis * (half + 0.8f));
                var top = new Vector3(c.x, DeckTop, c.y);
                bool dry = !LavaGeometry.Touches(bodies, top + Vector3.up * 0.02f);
                if (Mathf.Abs(y0 - DeckTop) > 0.2f || Mathf.Abs(y1 - DeckTop) > 0.2f || !dry)
                {
                    badDeck++;
                    rep.Fail($"{b.id} {b.name}：两头床面 y {y0:F2} / {y1:F2}，桥面 {DeckTop:F2}{(dry ? "" : "，桥面在熔岩判定里")}");
                }
            }
            if (badDeck == 0) rep.Line($"✓ {Bridges.Length} 座铁桥：桥面与两头床面齐平（±0.2 m），桥面干燥（主线 {Bridges.Count(b => !b.ch.arena)} 座、神范台 {Bridges.Count(b => b.ch.arena)} 座）");
            int placeholderDecks = decks.Count(IsPlaceholder);
            rep.Line($"熔岩：铸坊渠 {lava.tides.Count} 段（自动涨落，风闸拉开前关着，涨 {TideHeight} m 只在渠里）、神范台 {lava.surge.Count} 片（领主战漫溢 +{SurgeRise} m）、桥下静止 {lava.still.Count} 片");
            foreach (var v in lava.tides)
                if (v.tide.enabled || !(v.tide.height > 0)) rep.Fail($"{v.name}：自动涨落应写好参数、开局关着（enabled {v.tide.enabled}，height {v.tide.height}）");
            // 渠岸在基准面时是干的，漫溢后是熔岩
            var strip = new Vector3(ArenaX.a.x + ArenaHalf + 1.5f, 0.02f, 200f);
            bool dryLow = !LavaGeometry.Touches(bodies, strip);
            var saved = bodies.Select(b => (b, b.level)).ToList();
            foreach (var v in lava.surge) v.Body.level = v.BaseLevel + SurgeRise;
            bool wetHigh = LavaGeometry.Touches(bodies, strip);
            foreach (var (b, l) in saved) b.level = l;
            if (!dryLow || !wetHigh) rep.Fail($"神范台渠岸：基准面时干燥 {dryLow}、漫溢后算熔岩 {wetHigh}（应为 true / true）");
            else rep.Line($"✓ 神范台渠岸 ({strip.x:F1}, {strip.z:F0})：基准面时干燥，漫溢 +{SurgeRise} m 后算熔岩");

            rep.Section("鼓风正殿 · 风闸 · 领主战");
            rep.Line($"风箱 {hall.bellows.Length} 台（瘪着 × {BellowsRest}），风闸接线：第一次 {gate.firstVisit?.title}、第二次 {gate.secondVisit?.title}（autoTrigger {gate.secondVisit?.autoTrigger}），" +
                     $"风箱道 {gate.laneFrom.Length} 条、涨落渠 {gate.tides.Length} 段");
            if (hall.bellows.Length != 2 || gate.laneFrom.Length != 2 || gate.tides.Length != lava.tides.Count) rep.Fail("风闸接线不全（风箱 2 台、风箱道 2 条、涨落渠 = 铸坊渠段数）");
            if (gate.secondVisit && gate.secondVisit.autoTrigger) rep.Fail("第二次进殿开局就会自动触发（应等风闸）");
            var enc = lord.encounter;
            rep.Line($"领主战：{enc.bossId}，场地 {lord.arena.halfSize.x * 2:F0} × {lord.arena.halfSize.y * 2:F0} m，熔铜渠 {lord.channels.Count} 片，熔铁闸 {lord.gates.Length} 扇，" +
                     $"首领关流程开局{(enc.enabled ? "开着 ✗" : "关着 ✓")}，出口点 {enc.exitPoint?.position}");
            if (enc.enabled) rep.Fail("首领关流程开局就开着（应等关卡目标完成，由 FoundryLordGate 打开）");
            if (lord.gates.Length != 2) rep.Fail($"熔铁闸 {lord.gates.Length} 扇（应 2：闸前桥、东铸北桥）");
            if (lord.gates.Any(g => g.activeSelf)) rep.Fail("熔铁闸在场景里是开着的（会挡导航烘焙，应关着由 BossEncounter 升起）");

            rep.Section("第三章专用件（ART6 暂缓，docs/art/ch3-kit.md）");
            var missing = Ch3Kit.Where(id => !ShowcaseSceneBuilder.Prefab(id)).ToList();
            int boxes = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None).Count(t => t.CompareTag(LevelKit.PlaceholderTag));
            rep.Line(missing.Count == 0
                ? "✓ 第三章专用件都有 Prefab"
                : $"⚠ 缺 {missing.Count} 件第三章专用件的 Prefab：{string.Join("、", missing)}——摆成 PlaceOrBox 白盒 {boxes} 个（铁桥 {placeholderDecks} 座），占位检查只列清单；到齐后自动收紧成不合格");
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查 3-3 自己的件（目标图、风闸、领主战、藏宝，没有场景出口）。顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, LevelObjective objective, FoundryWindGate gate, Lord lord)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include, FindObjectsSortMode.None).Count(c => c.gameObject.scene == scene);
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

            int arenas = Count<BossArena>(), encs = Count<BossEncounter>(), gates = Count<FoundryLordGate>(), winds = Count<FoundryWindGate>(),
                chans = Count<FoundryChannels>(), portals = Count<ExitPortal>(), caches = Count<CachePOI>(), objectives = Count<LevelObjective>();
            if (arenas != 1 || encs != 1 || gates != 1 || winds != 1 || chans != 1 || objectives != 1)
                rep.Fail($"BossArena {arenas} / BossEncounter {encs} / FoundryLordGate {gates} / FoundryWindGate {winds} / FoundryChannels {chans} / LevelObjective {objectives}（各应为 1）");
            // 场景里不放 ExitPortal：它会接上关卡目标、肃清据点就开门；出口由领主战结算后立在神范前（同 1-4）
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（3-3 的出口由领主战结算后立）");
            if (caches != 2) rep.Fail($"藏宝点 {caches} 处（应为 2）");
            if (objective.required.Length != 4 || objective.optional.Length != 1) rep.Fail($"目标图：必清 {objective.required.Length}、可选 {objective.optional.Length}（应为 4 / 1）");
            else rep.Line($"✓ 目标图：必清 {string.Join("、", objective.required.Select(s => s.title))}；可选 {objective.optional[0].title}；藏宝 {caches} 处；下一关 {RunPlan.Next(RunPlan.Get("3-3"))?.Label ?? "?"}");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 交给 L5 规则集的声明：主线（出生 → ① → 东桥 → ③ → 墙台 → 殿前桥 → ② → 炉坛 → 风闸台 → 闸前桥 → 神范台四象限 → 神范台顶 → 东铸北桥），
        /// 坡度路径（七个台的坡道），4 条地标视线（南闸门看浇包与神范、风闸台看神范、殿南口看大炉），场地尺寸取 maps/3-3.md 场地表。
        /// 第三章新件暂缓：缺 Prefab 时占位只列清单（Warn），到齐后收紧成 Fail。软边界没有空气墙：越界按兜底环算，火山口壁本身翻不出去
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            // 桥上的路点取桥面（地形在桥下是渠底：按地形贴地会落进渠里，采到渠底的熔岩导航区）
            Vector3 Deck(string id)
            {
                var c = BridgeById(id).Center;
                return new Vector3(c.x, DeckTop, c.y);
            }
            SiteSpec S(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat };
            var mouldTop = G(MouldAt, 6.5f);
            bool kitReady = Ch3Kit.All(id => ShowcaseSceneBuilder.Prefab(id));
            var spec = new LevelSpec
                {
                    id = "3-3", title = "铸范大坊", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin,
                    placeholders = kitReady ? PlaceholderPolicy.Fail : PlaceholderPolicy.Warn,
                    sites =
                    {
                        S("南闸门（缓冲）", Spawn + new Vector2(0, 4), 24, combat: false),
                        S("① 中央铸床", CentralSite, 56, cover: 4, layers: 2, overlook: true),
                        S("③ 东铸床", EastSite, 52, cover: 4, layers: 2, overlook: true),
                        S("②④ 鼓风正殿", HallSite, 60, cover: 4, layers: 2, overlook: true),
                        S("⑤ 神范台（领主战）", ArenaCenter, 80, cover: 4, layers: 2, overlook: true),
                        S("废范场（可选）", ScrapSite, 44, cover: 2),
                    },
                }
                .Route("出生 · 南闸门", G(Spawn)).Route("闸台坡脚", G(GateTerrace.ramps[0].foot + new Vector2(0, 2)))
                .Route("① 浇包吊台顶", G(Ladle.Center + new Vector2(-3, -3))).Route("① 东侧", G(new Vector2(126, 52)))
                .Route("东桥", Deck("B1")).Route("③ 范列", G(new Vector2(162, 56)))
                .Route("③ 铸铁墙台", G(new Vector2(192, 66))).Route("③ 北侧", G(new Vector2(170, 90)))
                .Route("东桥（回）", Deck("B1")).Route("殿前桥", Deck("B3"))
                .Route("② 南风箱道", G(new Vector2(60, 141))).Route("② 十字口", G(HallSite)).Route("② 炉坛", G(Altar.Center))
                .Route("② 北风箱道", G(new Vector2(40, 166))).Route("风闸台", G(WindGateAt + new Vector2(-4, -3)))
                .Route("闸前桥", Deck("B5")).Route("⑤ 西北象限", G(new Vector2(126, 186)))
                .Route("⑤ 神范北桥", Deck("AN")).Route("⑤ 东北象限", G(new Vector2(170, 186)))
                .Route("⑤ 神范台顶（出口）", G(ExitAt)).Route("⑤ 神范东桥", Deck("AE"))
                .Route("⑤ 东南象限", G(new Vector2(176, 140))).Route("东铸北桥", Deck("B6"))
                .Route("③ 东铸床北头", G(new Vector2(178, 100)))
                .Sight("南闸门 → 浇包吊台", G(Spawn, 1.62f), G(new Vector2(103, 68), Ladle.h + 2.2f), 6, CrucibleId)
                .Sight("南闸门 → 神范", G(Spawn, 1.62f), mouldTop, 8, MouldId)
                .Sight("风闸台 → 神范", G(WindGateAt + new Vector2(-4, -3), 1.62f), mouldTop, 8, MouldId)
                .Sight("殿南口 → 大炉", G(new Vector2(44, 119), 1.62f), G(FurnaceAt, 14f), 6, FurnaceId);
            foreach (var pl in Platforms)
                foreach (var (foot, top, _) in pl.ramps)
                    spec.slopePaths.Add(new SlopePath { name = $"{pl.name}坡道", points = new[] { foot + (foot - top).normalized * 1.5f, top } });
            return spec;
        }
    }
}
