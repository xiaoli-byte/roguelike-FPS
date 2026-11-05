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
    /// 3-1 熔湖堤道 · 熔湖关隘（第三章 v2，docs/level-design/ch3-v2.md 第 5.1 节；落地设计 docs/level-design/maps/3-1.md）：
    /// 关卡坐标 = 世界 XZ（米；x 向东、z 向北），熔岩面 y = 0。可玩区约 150 × 190 m（x −74…78、z −86…114），四处设防把熔湖截成几段：
    ///
    ///   出生 · 火口眺台 (6,−70) +18：一次远景（崖顶祝融像、宫门、关楼城台、湖心石龛的宝光）
    ///   → 之字坡（三折，+18 → +2，路遇 a：余烬起身）→ ① 渡口关楼 (−32,−30)：码头 +2、货垛 +3.4、关楼城台 +10（关楼是 Tripo 承重件，到货前白盒）
    ///   → C1 堤（穿过关楼门洞，堤肩是击退带）→ ② 税关墩 (16,12)：码头 +2、台阶 +3.5、税亭台 +6；北头断堤（断 12 m）+ 三块跳石 → 湖心石龛（藏宝 A）
    ///   → 低路 · 东石林（路遇 c：熔流伏兵）或 高路 · 东崖腰 +10（路遇 b：栖柱火矛；崖龛 ⑤ 熔铸遗址 = 藏宝 B 的守军）
    ///   → ③ 锚链大墩 (45,52)：下码头 +2、鼎台 +6（镇湖鼎，3-4 吊鼎的伏笔，三根锚链拉上东崖）、锁链台 +10（东接高路）
    ///   → 补给 · 御道坡脚 → 御道 → 吊桥过护城熔渠 → ④ 宫门瓮城 (−20,88)：下场 +2（渠岸）、上场 +6、城墙走道 +10、鼓楼台 +12 → 宫门（出口）。
    ///
    /// 边界（没有空气墙）：火山口底多边形外 5.5 m 内陡升成 20–26 m 的崖，软边界只兜底；熔岩在游玩区里，掉下去由 L7 托回。
    /// 场地之间都是熔岩：主路永远不要求过熔岩（堤、桥、御道连着），必须跳的只有藏宝 A 的三块跳石（支路）。
    /// 编组来自 <see cref="InfernoSquads"/>（S2）；出场方式（S1）的站位见 <see cref="Anchors"/>。场景只放环境和标记（D17 / L1）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-1 熔湖堤道（或 bridge.sh level 3-1）。冒烟：bridge.sh playtest map-3-1（Map31Suite）。
    /// </summary>
    [LevelBuilder("3-1", ScenePath)]
    public static class Level_3_1
    {
        public const string Dir = "Assets/Levels/L3_1_Causeway";
        public const string ScenePath = "Assets/Scenes/L3_1_Causeway.unity";
        const string Name = "L3_1";

        // ───────────── 尺度 ─────────────
        /// <summary>高度场里 Base 米 = 世界 y 0；火山口外坡落到远景地面 PlainY</summary>
        const float Base = 10f, HeightRange = 64f, PlainY = 6f;
        static readonly Vector2 Origin = new(-200, -196), Size = new(400, 400);
        static readonly Vector2 Wind = new Vector2(-0.3f, -0.95f).normalized;
        static readonly LevelKit.BoundarySpec Bounds = InfernoBounds();

        static LevelKit.BoundarySpec InfernoBounds()
        {
            var b = LevelKit.BoundarySpec.Default;
            b.theme = "Inferno";
            return b;
        }

        // ───────────── 高度（世界 y）─────────────
        const float LavaY = 0f, BedY = -1.1f, QuayY = 2f, DeckY = 1.4f;
        /// <summary>崖：坡脚以上 20–26 m，崖面 5.5 m 宽</summary>
        const float WallH = 20f, WallVar = 6f, WallFace = 5.5f;

        /// <summary>火山口底（游玩区）多边形：外面是崖。北缘在宫门后留一块 8 m 深的宫院（增援门的出生点）</summary>
        static readonly Vector2[] Envelope =
        {
            new(30, -86), new(44, -76), new(56, -60), new(66, -42), new(74, -18), new(79, 6), new(79, 24), new(77, 46), new(70, 62), new(56, 74),
            new(36, 82), new(18, 92), new(9, 104), new(2, 114), new(-8, 118), new(-32, 118), new(-46, 112), new(-56, 100), new(-62, 80), new(-64, 56),
            new(-65, 28), new(-65, 0), new(-66, -30), new(-64, -52), new(-58, -70), new(-42, -84), new(-16, -88), new(14, -88),
        };
        /// <summary>东崖腰的崖龛（⑤ 熔铸遗址 / 藏宝 B）：高路中段往东 14 m</summary>
        static readonly Vector2 NicheC = new(85, 14);
        const float NicheR = 8.5f;

        // ───────────── 出生 · 之字坡 ─────────────
        static readonly Vector2 Spawn = new(10, -71);
        const float SpawnY = 18f, OverlookR = 9f;
        /// <summary>南坡（之字坡所在的山体）：x −62…14、z −90…−44，高度随 z 从 +2 升到 +17</summary>
        static readonly Vector2[] SouthHill =
        {
            new(-64, -42), new(-30, -43), new(-8, -45), new(10, -50), new(18, -62), new(18, -80), new(10, -92), new(-30, -92), new(-66, -80), new(-70, -58),
        };
        /// <summary>之字坡：三折一条线（Both：挖 + 填），路宽 10 m</summary>
        static readonly PathSpline Zigzag = new PathSpline(new[]
        {
            new Vector2(3, -76), new Vector2(-22, -77), new Vector2(-42, -76), new Vector2(-52, -70), new Vector2(-48, -62), new Vector2(-30, -61),
            new Vector2(-10, -61), new Vector2(3, -59), new Vector2(4, -51), new Vector2(-14, -48), new Vector2(-36, -44),
        }, 6).WithHeights(new[] { 18f, 16.6f, 15.2f, 14.2f, 13.6f, 12f, 10.4f, 9.4f, 8.2f, 5.2f, 2.2f }, 2, 14f);
        const float ZigHalf = 5f, ZigShoulder = 2f;

        // ───────────── 陆块（不规则多边形，顶面平，四周缓坡没入湖床）─────────────
        readonly struct Land
        {
            public readonly string name;
            public readonly Vector2[] poly;
            public readonly float top, ring, wobble;
            public readonly int seed;

            public Land(string name, float top, float ring, float wobble, int seed, params Vector2[] poly)
            {
                this.name = name;
                this.top = top;
                this.ring = ring;
                this.wobble = wobble;
                this.seed = seed;
                this.poly = poly;
            }
        }

        static readonly Land FerryQuay = new("① 渡口码头", QuayY, 5f, 1.2f, 11,
            new(-62, -40), new(-54, -48), new(-36, -49), new(-20, -47), new(-10, -42), new(-5, -32), new(-3, -24), new(-5, -14), new(-12, -6), new(-22, -4),
            new(-30, -9), new(-44, -15), new(-58, -24));
        static readonly Land TollIsle = new("② 税关墩", QuayY, 5f, 0.6f, 12,
            new(2, 1), new(10, -7), new(22, -7), new(32, 1), new(34, 14), new(28, 26), new(14, 30), new(2, 26), new(-2, 14));
        static readonly Land AnchorIsle = new("③ 锚链大墩", QuayY, 5f, 1.2f, 13,
            new(28, 38), new(42, 34), new(56, 36), new(64, 44), new(67, 56), new(60, 66), new(46, 72), new(31, 70), new(25, 60), new(25, 48));
        static readonly Land Barbican = new("④ 宫门瓮城", QuayY, 5.5f, 0.6f, 14,
            new(-50, 72), new(6, 72), new(8, 112), new(-50, 112));
        static readonly Land Islet = new("湖心石龛", 1.5f, 3.5f, 0.3f, 15,
            new(-13.5f, 38), new(-9.5f, 38), new(-6.5f, 41), new(-7.5f, 45), new(-11.5f, 46), new(-14.5f, 43));
        /// <summary>⑤ 熔铸遗址的崖龛（+10，东崖腰高路往东）</summary>
        static readonly Land Niche = new("⑤ 熔铸遗址", 10f, 2f, 0.4f, 16,
            new(76, 4), new(86, 5), new(93, 10), new(93, 19), new(86, 24), new(76, 24));
        static readonly Land[] Lands = { FerryQuay, TollIsle, AnchorIsle, Barbican, Islet, Niche };
        static readonly Vector2 IsletC = new(-10.5f, 41.5f);

        /// <summary>藏宝 A 的三块跳石（熔岩上，顶 +0.9，半径 1.1，边到边约 1.5–2 m）：从断堤南段的堤头往西</summary>
        static readonly Vector2[] Stones = { new(3, 36), new(-0.5f, 37.5f), new(-4, 39) };
        const float StoneR = 1.1f, StoneTop = 0.9f;

        // ───────────── 台（地形台基 + 坡道）─────────────
        readonly struct Terrace
        {
            public readonly string name;
            public readonly Vector2 c, half;
            public readonly float yaw, baseY, rise, edge;
            public readonly (Vector2 foot, Vector2 top, float width)[] ramps;

            public Terrace(string name, Vector2 c, Vector2 half, float yaw, float baseY, float rise, float edge, params (Vector2, Vector2, float)[] ramps)
            {
                this.name = name;
                this.c = c;
                this.half = half;
                this.yaw = yaw;
                this.baseY = baseY;
                this.rise = rise;
                this.edge = edge;
                this.ramps = ramps;
            }

            public float TopY => baseY + rise;
        }

        // 坡道约定：坡顶点停在台边外 0.5 m（坡道的延伸段压进台面，盖住台边 1 m 的软边，不留小坎）；坡道垂直于台边上去
        // ① 货垛（两座都 +4.8 = 俯射层；关楼正式件的城台只有左右两块 2 m 宽的垛台）
        static readonly Terrace CargoW = new("① 西货垛", new Vector2(-46, -30), new Vector2(4.5f, 3.5f), 0, QuayY, 2.8f, 0.8f, (new Vector2(-46, -42.5f), new Vector2(-46, -34f), 3.5f));
        static readonly Terrace CargoS = new("① 南货垛", new Vector2(-22, -36), new Vector2(4f, 2.5f), 0, QuayY, 2.8f, 0.8f, (new Vector2(-35, -36), new Vector2(-26.5f, -36), 3.5f));
        // ② 税亭台 +6、东台阶 +3.5（四周留 ≥ 8 m 的码头，② 的东西两头走得通）
        static readonly Terrace TollTerrace = new("② 税亭台", new Vector2(12, 16), new Vector2(5.5f, 4.5f), 0, QuayY, 4f, 1f, (new Vector2(12, -0.5f), new Vector2(12, 11f), 5f));
        static readonly Terrace TollStepE = new("② 东台阶", new Vector2(26, 4), new Vector2(3f, 3f), 0, QuayY, 1.5f, 0.8f, (new Vector2(17.5f, 4), new Vector2(22.5f, 4), 3.5f));
        // ③ 鼎台 +6、锁链台 +10（坡道从鼎台北半边起）
        static readonly Terrace Cauldron = new("③ 鼎台", new Vector2(44, 54), new Vector2(8, 7), 0, QuayY, 4f, 1f,
            (new Vector2(44, 35f), new Vector2(44, 46.5f), 5.5f), (new Vector2(24.5f, 50), new Vector2(35.5f, 50), 5f));
        static readonly Terrace ChainDeck = new("③ 锁链台", new Vector2(60, 54), new Vector2(5f, 6f), 0, 6f, 4f, 1f, (new Vector2(42, 58.5f), new Vector2(54.5f, 58.5f), 4.5f));
        // ④ 上场 +6（中间御道坡 + 西侧坡）、炮位台 +7.5、城墙走道 +10（坡道垂直上墙）、鼓楼台 +12（沿走道上去）
        static readonly Terrace UpperWard = new("④ 上场", new Vector2(-21, 101), new Vector2(23, 15f), 0, QuayY, 4f, 1f,
            (new Vector2(-6, 83.3f), new Vector2(-17.5f, 83.3f), 5f), (new Vector2(-36, 83.3f), new Vector2(-24.5f, 83.3f), 5f));
        /// <summary>御道坡中间的平台（+6，两段坡在这里会合，正对宫门）</summary>
        static readonly Terrace RoadLanding = new("④ 御道坡平台", new Vector2(-21, 83.5f), new Vector2(3.5f, 2.6f), 0, QuayY, 4f, 1f);
        static readonly Terrace GunW = new("④ 西炮位台", new Vector2(-27, 96), new Vector2(3f, 2.5f), 0, 6f, 1.5f, 0.8f, (new Vector2(-27, 88.5f), new Vector2(-27, 93f), 3f));
        static readonly Terrace GunE = new("④ 东炮位台", new Vector2(-15, 96), new Vector2(3f, 2.5f), 0, 6f, 1.5f, 0.8f, (new Vector2(-15, 88.5f), new Vector2(-15, 93f), 3f));
        static readonly Terrace WallW = new("④ 西城墙走道", new Vector2(-47, 88), new Vector2(2.5f, 16f), 0, 6f, 4f, 1f, (new Vector2(-32, 90), new Vector2(-44f, 90), 3.5f));
        static readonly Terrace WallE = new("④ 东城墙走道", new Vector2(4, 88), new Vector2(2.5f, 16f), 0, 6f, 4f, 1f, (new Vector2(-10, 90), new Vector2(1f, 90), 3.5f));
        static readonly Terrace DrumW = new("④ 西鼓楼台", new Vector2(-46, 104), new Vector2(3.5f, 2.5f), 0, 10f, 2f, 0.8f, (new Vector2(-47, 95), new Vector2(-47, 101), 3.5f));
        static readonly Terrace DrumE = new("④ 东鼓楼台", new Vector2(3, 104), new Vector2(3.5f, 2.5f), 0, 10f, 2f, 0.8f, (new Vector2(4, 95), new Vector2(4, 101), 3.5f));
        static readonly Terrace[] Terraces = { CargoW, CargoS, TollTerrace, TollStepE, Cauldron, ChainDeck, UpperWard, RoadLanding, GunW, GunE, WallW, WallE, DrumW, DrumE };
        static readonly (Vector2 foot, Vector2 top, float width)[] NoRamps = Array.Empty<(Vector2, Vector2, float)>();

        // ───────────── 堤、桥、路（样条 + 纵断面）─────────────
        sealed class Way
        {
            public string id, label;
            public PathSpline path;
            public float half, shoulder;
            /// <summary>只填不挖（堤）；false = 挖 + 填（崖腰路、之字坡）</summary>
            public bool fillOnly = true;
            /// <summary>算主路（散布避让、坡度验收）</summary>
            public bool route = true;
        }

        static Way MakeWay(string id, string label, float half, float shoulder, Vector2[] ctrl, float[] heights, bool fillOnly = true, bool route = true) => new()
        {
            id = id, label = label, half = half, shoulder = shoulder, fillOnly = fillOnly, route = route,
            path = new PathSpline(ctrl, 6).WithHeights(heights, 0, 15f),
        };

        /// <summary>C1：从关楼门洞穿出，过 14 m 熔岩到 ② 西南角；堤肩 4.5 m 缓坡没入熔岩（击退带）</summary>
        static readonly Way C1 = MakeWay("C1", "关楼堤", 4.5f, 4.5f,
            new[] { new Vector2(-11, -12), new Vector2(-6, -6), new Vector2(-1, -1), new Vector2(2.5f, 2.5f), new Vector2(7, 7) }, new[] { QuayY, DeckY, 1.6f, QuayY, QuayY });
        /// <summary>东石林低路：② 东头 → 石林里绕一个弯（柱丛夹道、两侧熔岩、路遇 c）→ ③ 南码头</summary>
        static readonly Way Stoneforest = MakeWay("C2", "石林堤", 4f, 4f,
            new[] { new Vector2(31, 12), new Vector2(42, 9), new Vector2(52, 15), new Vector2(51, 27), new Vector2(44, 37) }, new[] { QuayY, DeckY, DeckY, DeckY, QuayY });
        /// <summary>断堤（② 北头 → 宫门方向）：只剩南段，堤头离御道的堤面 ≥ 16 m（二段跳也过不去）；两侧 1 m 陡肩（立面）</summary>
        static readonly Way BrokenS = MakeWay("C3", "断堤南段", 4f, 1f,
            new[] { new Vector2(12, 26), new Vector2(11, 29), new Vector2(10.5f, 31.5f) }, new[] { QuayY, DeckY, DeckY }, route: false);
        /// <summary>高路引坡：② 东南角 → 东崖腰（+2 → +10，≤ 14°）</summary>
        static readonly Way Spur = MakeWay("H1", "高路引坡", 4.5f, 3f,
            new[] { new Vector2(25, -2), new Vector2(36, -8), new Vector2(46, -12), new Vector2(54, -14), new Vector2(58, -14) }, new[] { QuayY, 5f, 8.2f, 10f, 10f }, route: false);
        /// <summary>东崖腰高路（+10，挖 + 填贴着东崖）：引坡 → 路遇 b → 锁链台</summary>
        static readonly Way Ledge = MakeWay("H2", "东崖腰高路", 6f, 3f,
            new[] { new Vector2(64, -12), new Vector2(69, -5), new Vector2(71, 6), new Vector2(71, 22), new Vector2(68, 36), new Vector2(62, 47) },
            new[] { 10f, 10f, 10f, 10f, 10f, 10f }, fillOnly: false, route: false);
        /// <summary>御道：③ 西北角 → 补给 → 吊桥南头（+2 → +3）</summary>
        static readonly Way Road = MakeWay("R1", "御道", 5f, 4f,
            new[] { new Vector2(33, 64), new Vector2(22, 62), new Vector2(6, 57), new Vector2(-10, 54), new Vector2(-15, 55) }, new[] { QuayY, 3f, 3f, 3f, 3f });
        static readonly Way[] Ways = { C1, Stoneforest, BrokenS, Spur, Ledge, Road };

        /// <summary>吊桥（程序铁桥，承重）：御道西头 → 瓮城下场，跨护城熔渠</summary>
        static readonly Vector2 BridgeS = new(-16, 58), BridgeN = new(-16, 75);
        const float BridgeW = 8f;

        // ───────────── 场地中心与关键点 ─────────────
        static readonly Vector2 FerryC = new(-32, -30), TollC = new(16, 10), AnchorC = new(48, 45), GateC = new(-20, 86);
        static readonly Vector2 GatehouseC = new(-14, -17);
        const float GatehouseYaw = 45f;
        /// <summary>出口：宫门（熔铁闸白盒 + 神龛）贴宫墙，宫墙 z = 106；闸后宫院是增援门的出生点</summary>
        static readonly Vector2 ShrineAt = new(-20, 105f), PalaceGate = new(-20, 109f), Courtyard = new(-20, 113.5f);
        const float PalaceWallZ = 109f;
        static readonly Vector2 StatueAt = new(-20, 126);
        const float StatueScale = 1.6f;
        static readonly Vector2 SupplyAt = new(22, 62);
        static readonly Vector2 RoadsideA = new(-44, -66), RoadsideB = new(71, 12), RoadsideC = new(49, 22), GuardSite = new(80, 14), CacheB = new(87, 14);

        // ───────────── 资产 ID 与设计尺寸（白盒用，米，宽 × 高 × 深）─────────────
        const string GatehouseId = "SM_Tripo_InfernoGatehouse", ColumnsId = "SM_Tripo_InfernoBasaltColumns", SegmentId = "SM_Tripo_InfernoCausewaySegment",
            BreakId = "SM_Tripo_InfernoCausewayBreak", RibId = "SM_Tripo_InfernoRockRib", MoltenGateId = "SM_Tripo_InfernoMoltenGate",
            CauldronBigId = "SM_Prop_QilinCauldron", ChainLockId = "SM_Prop_QilinChainLock", ChainLinkId = "SM_Prop_InfernoChainLink",
            ColumnId = "SM_Tripo_InfernoColumn", StatueId = "SM_Tripo_InfernoZhurong", ShrineId = "SM_Tripo_InfernoPortalShrine", RampartId = "SM_Tripo_InfernoRampart",
            TowerId = "SM_Tripo_InfernoFurnaceTower", StallId = "SM_Tripo_InfernoForgeStall", BarricadeId = "SM_Tripo_InfernoBarricade",
            CoverWallId = "SM_Tripo_InfernoCoverWall", CauldronId = "SM_Tripo_InfernoCauldronRuin", IngotId = "SM_Tripo_InfernoIngotPile",
            AltarId = "SM_Tripo_InfernoFireAltar", HoardId = "SM_Tripo_InfernoTreasureHoard", ObeliskId = "SM_Prop_InfernoChainObelisk", CrucibleId = "SM_Prop_InfernoCrucible",
            BlockId = "SM_Tripo_InfernoPlatformBlock", BlockBId = "SM_Tripo_InfernoPlatformBlockB", GatewayId = "SM_Tripo_InfernoGateway";

        static readonly Dictionary<string, Vector3> DesignSize = new()
        {
            // 第三章 v2 件（registry reference_dimensions；到货前白盒）
            [GatehouseId] = new(16f, 12f, 14f), [ColumnsId] = new(8f, 9f, 7f), [SegmentId] = new(12f, 5f, 12f), [BreakId] = new(12f, 5f, 12f),
            [RibId] = new(9f, 16f, 12f), [MoltenGateId] = new(10f, 9f, 1.4f), [CauldronBigId] = new(6.4f, 8f, 6.4f), [ChainLockId] = new(2f, 2.4f, 1.2f),
            // 已导出的火狱套件（ArtAssetInfo.designBounds）
            [ChainLinkId] = new(0.65f, 0.99f, 0.19f), [ColumnId] = new(1.97f, 4.93f, 1.81f), [StatueId] = new(7.8f, 15.43f, 6.83f),
            [ShrineId] = new(7.59f, 10.68f, 2.15f), [RampartId] = new(7.59f, 8.82f, 2.36f), [TowerId] = new(6.13f, 12.86f, 4.99f),
            [StallId] = new(2.6f, 3.47f, 1.63f), [BarricadeId] = new(3.56f, 1.18f, 0.47f), [CoverWallId] = new(3.42f, 2.48f, 0.89f),
            [CauldronId] = new(3.11f, 1.54f, 1.53f), [IngotId] = new(2.18f, 1.52f, 1.81f), [AltarId] = new(1.13f, 2.36f, 1.15f),
            [HoardId] = new(2.31f, 1.71f, 1.56f), [ObeliskId] = new(1.08f, 2.13f, 1.08f), [CrucibleId] = new(1.27f, 0.99f, 1.28f),
            [BlockId] = new(3.16f, 2.86f, 2.73f), [BlockBId] = new(2.86f, 2.89f, 2.14f), [GatewayId] = new(11.31f, 10.75f, 2.2f),
        };

        const float ColumnH = 4.93f, ColumnSink = 0.25f;
        /// <summary>掩体高度分级（composition.md 第 6 节）：场地里的锭堆缩到 1.29 m——原尺寸 1.52 m 看着像半掩体、实际挡得住头</summary>
        const float HalfIngot = 0.85f;
        /// <summary>火坛原尺寸 1.13 × 2.36 m，中景剪影像个站着的人：场地里放大到 1.47 × 3.07 m，读成柱状全掩体</summary>
        const float AltarBig = 1.3f;
        const float ChainScale = 2f;

        /// <summary>
        /// 刷怪站位（标记名、属于哪个场地、位置、角色、lane、高台、散开半径）。场地编号：1–4 必清，5 熔铸遗址守军，11–13 路遇 a / b / c。
        /// 阶段 1 全部是「现身」站位；出场方式（S1）的站位在 <see cref="ModeAnchors"/>。高台站位只给会飞的（毕方、飞鸦）且在台顶的导航网格上。
        /// </summary>
        static readonly (string name, int site, Vector2 at, StationRole role, int lane, bool elevated, float spread)[] Anchors =
        {
            // ① 渡口关楼：西坡（之字坡脚）、东滩两条 lane，关楼前、货垛
            ("Enemy_1_WestSlope", 1, new Vector2(-50, -38), StationRole.Assault, 0, false, 2f),
            ("Enemy_1_EastBeach", 1, new Vector2(-12, -36), StationRole.Flank, 1, false, 2f),
            ("Enemy_1_Gate", 1, new Vector2(-25, -25), StationRole.Assault, 0, false, 2f),
            ("Enemy_1_North", 1, new Vector2(-40, -18), StationRole.Flank, 2, false, 2f),
            ("Enemy_1_Cargo", 1, new Vector2(-36, -32), StationRole.Auto, 0, false, 1.5f),
            // ② 税关墩：码头环四周、税亭台（远程）
            ("Enemy_2_North", 2, new Vector2(18, 24), StationRole.Assault, 0, false, 2f),
            ("Enemy_2_East", 2, new Vector2(29, 12), StationRole.Flank, 1, false, 2f),
            ("Enemy_2_South", 2, new Vector2(14, -2), StationRole.Assault, 1, false, 2f),
            ("Enemy_2_West", 2, new Vector2(2, 12), StationRole.Flank, 2, false, 2f),
            ("Enemy_2_Terrace", 2, new Vector2(9, 15), StationRole.Ranged, 0, false, 1.2f),
            // ③ 锚链大墩：下码头南 / 西 / 北、鼎台、锁链台（远程 / 精确）
            ("Enemy_3_South", 3, new Vector2(52, 39), StationRole.Assault, 0, false, 2f),
            ("Enemy_3_West", 3, new Vector2(30, 60), StationRole.Flank, 1, false, 2f),
            ("Enemy_3_North", 3, new Vector2(48, 66), StationRole.Assault, 1, false, 2f),
            ("Enemy_3_Cauldron", 3, new Vector2(49, 51), StationRole.Ranged, 0, false, 1.5f),
            ("Enemy_3_ChainDeck", 3, new Vector2(60, 54), StationRole.Precision, 0, true, 1.2f),
            // ④ 宫门瓮城：下场两侧、上场、两侧城墙走道（远程）
            ("Enemy_4_LowW", 4, new Vector2(-39, 80.5f), StationRole.Assault, 0, false, 2f),
            ("Enemy_4_LowE", 4, new Vector2(-2, 78), StationRole.Flank, 1, false, 2f),
            ("Enemy_4_Upper", 4, new Vector2(-20, 96), StationRole.Assault, 0, false, 2f),
            ("Enemy_4_WallW", 4, new Vector2(-47, 84), StationRole.Ranged, 0, false, 1.2f),
            ("Enemy_4_WallE", 4, new Vector2(4, 84), StationRole.Ranged, 1, false, 1.2f),
            ("Enemy_4_DrumW", 4, new Vector2(-46, 104), StationRole.Precision, 0, true, 1.2f),
            ("Enemy_4_DrumE", 4, new Vector2(3, 104), StationRole.Precision, 1, true, 1.2f),
            // ⑤ 熔铸遗址守军（崖龛 +10）
            ("Enemy_5_A", 5, new Vector2(78, 8), StationRole.Assault, 0, false, 2f),
            ("Enemy_5_B", 5, new Vector2(78, 18), StationRole.Flank, 1, false, 2f),
            ("Enemy_5_C", 5, new Vector2(86, 14), StationRole.Ranged, 0, false, 1.5f),
            // 路遇 a（之字坡第一折）、b（东崖腰）、c（石林堤）
            ("Enemy_11_A", 11, new Vector2(-46, -60), StationRole.Assault, 0, false, 2f),
            ("Enemy_11_B", 11, new Vector2(-34, -61), StationRole.Assault, 1, false, 2f),
            ("Enemy_12_A", 12, new Vector2(70, 22), StationRole.Assault, 0, false, 2f),
            ("Enemy_12_B", 12, new Vector2(71, 4), StationRole.Flank, 1, false, 2f),
            ("Enemy_12_Sky", 12, new Vector2(70, 14), StationRole.Precision, 0, true, 1.2f),
            ("Enemy_13_A", 13, new Vector2(48, 28), StationRole.Assault, 0, false, 1.5f),
            ("Enemy_13_B", 13, new Vector2(43, 11), StationRole.Assault, 1, false, 1.5f),
        };

        /// <summary>
        /// 出场方式（S1）的站位：名字、场地、站位（XZ）、角色、方式、高台、辅助点（XZ）、辅助点高（NaN = 贴地；跃下的起跳点给世界 y）、站位高（NaN = 贴地，栖柱顶给离地高）。
        ///   余烬起身：站位 = 渣堆；熔岩爬出：站位 = 上岸后的落脚点（冒出点自动在站位外 3–8 m 的熔岩里找）；
        ///   埋伏：站位 = 站岗点（毕方在栖柱顶，站位高 = 柱高），朝场地中心；跃下：辅助点 = 墙头 / 台沿；增援门：辅助点 = 门后出生点；
        ///   飞临：站位 = 鼓楼台（毕方落脚），入场点自动（从场地外侧 22 m、高 14 m 处飞来）。
        /// </summary>
        static readonly (string name, int site, Vector2 at, StationRole role, SpawnMode mode, bool elevated, Vector2 aux, float auxY, float lift)[] ModeAnchors =
        {
            // 路遇 a · 之字坡第一折：渣堆余烬起身
            ("Mode_11_Ember1", 11, new Vector2(-47, -61), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_11_Ember2", 11, new Vector2(-38, -61.5f), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_11_Ember3", 11, new Vector2(-30, -61), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_11_Ember4", 11, new Vector2(-50, -67), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            // ① 第一波 G02 黑犬包抄：西坡、东滩、关楼门洞三条 lane（增援门 = 视线外的出生点）；第二波 G01 余烬潮：码头渣堆
            ("Mode_1_GateW", 1, new Vector2(-50, -36), StationRole.Assault, SpawnMode.Gate, false, new Vector2(-61, -33), float.NaN, float.NaN),
            ("Mode_1_GateE", 1, new Vector2(-14, -40), StationRole.Flank, SpawnMode.Gate, false, new Vector2(-6, -47), float.NaN, float.NaN),
            ("Mode_1_GateN", 1, new Vector2(-24, -24), StationRole.Flank, SpawnMode.Gate, false, new Vector2(-10, -13), float.NaN, float.NaN),
            ("Mode_1_Ember1", 1, new Vector2(-40, -32), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_1_Ember2", 1, new Vector2(-30, -25), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_1_Ember3", 1, new Vector2(-28, -42), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_1_Ember4", 1, new Vector2(-44, -22), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_1_Ember5", 1, new Vector2(-36, -40), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_1_Ember6", 1, new Vector2(-18, -31), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            // ② 第一波：火鼍、炭童从墩边熔岩爬出；第二波：马面埋伏在税亭台、炭童爬出、祸斗从两头堤上冲进来
            ("Mode_2_LavaW", 2, new Vector2(2, 9), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_2_LavaS", 2, new Vector2(15, -4), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_2_LavaN", 2, new Vector2(8, 27), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_2_LavaE", 2, new Vector2(33, 9), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_2_Post", 2, new Vector2(9, 15), StationRole.Ranged, SpawnMode.Ambush, false, default, float.NaN, float.NaN),
            ("Mode_2_GateE", 2, new Vector2(28, 10), StationRole.Flank, SpawnMode.Gate, false, new Vector2(38, 10), float.NaN, float.NaN),
            ("Mode_2_GateW", 2, new Vector2(6, 4), StationRole.Flank, SpawnMode.Gate, false, new Vector2(-3, -4), float.NaN, float.NaN),
            // ③ 第一波 G04：毕方已栖在三根锚链桩顶（埋伏）、炭童余烬起身；第二波 G05：精英马面从锁链台跃下，祸斗从御道 / 石林两头冲进
            ("Mode_3_PerchS", 3, new Vector2(36, 40), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH - ColumnSink + 0.05f),
            ("Mode_3_PerchW", 3, new Vector2(29, 56), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH - ColumnSink + 0.05f),
            ("Mode_3_PerchN", 3, new Vector2(54, 68), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH - ColumnSink + 0.05f),
            ("Mode_3_Ember1", 3, new Vector2(40, 41), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_3_Ember2", 3, new Vector2(56, 40), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_3_Ember3", 3, new Vector2(32, 63), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_3_Ember4", 3, new Vector2(49, 66), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_3_DropS", 3, new Vector2(49, 44), StationRole.Ranged, SpawnMode.Drop, false, new Vector2(57, 49.5f), 10f, float.NaN),
            ("Mode_3_DropN", 3, new Vector2(53, 64), StationRole.Ranged, SpawnMode.Drop, false, new Vector2(58, 59), 10f, float.NaN),
            ("Mode_3_GateNW", 3, new Vector2(31, 61), StationRole.Flank, SpawnMode.Gate, false, new Vector2(23, 62), float.NaN, float.NaN),
            ("Mode_3_GateS", 3, new Vector2(42, 38), StationRole.Flank, SpawnMode.Gate, false, new Vector2(47, 27), float.NaN, float.NaN),
            // ④ 第一波：马面从两侧城墙走道跃下，炭童、火鼍从护城熔渠爬出；第二波：宫门熔铁闸升起、祸斗从宫院冲出，毕方飞临鼓楼台
            ("Mode_4_DropW", 4, new Vector2(-38, 80), StationRole.Ranged, SpawnMode.Drop, false, new Vector2(-46.5f, 81), 10f, float.NaN),
            ("Mode_4_DropE", 4, new Vector2(-4, 78), StationRole.Ranged, SpawnMode.Drop, false, new Vector2(3.5f, 82), 10f, float.NaN),
            ("Mode_4_Moat1", 4, new Vector2(-38, 75), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_4_Moat2", 4, new Vector2(-24, 74.5f), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_4_Moat3", 4, new Vector2(-15, 75), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_4_Gate1", 4, new Vector2(-20, 99), StationRole.Assault, SpawnMode.Gate, false, new Vector2(-20, 113.5f), float.NaN, float.NaN),
            ("Mode_4_Gate2", 4, new Vector2(-16, 101), StationRole.Flank, SpawnMode.Gate, false, new Vector2(-16, 114), float.NaN, float.NaN),
            ("Mode_4_SkyW", 4, new Vector2(-46, 104), StationRole.Precision, SpawnMode.FlyIn, true, default, float.NaN, float.NaN),
            ("Mode_4_SkyE", 4, new Vector2(3, 104), StationRole.Precision, SpawnMode.FlyIn, true, default, float.NaN, float.NaN),
            // 路遇 b · 东崖腰：毕方栖在两根栖柱顶，炭童余烬起身
            ("Mode_12_PerchS", 12, new Vector2(66, 0), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH - ColumnSink + 0.05f),
            ("Mode_12_PerchN", 12, new Vector2(66, 26), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH - ColumnSink + 0.05f),
            ("Mode_12_Ember1", 12, new Vector2(71, 8), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_12_Ember2", 12, new Vector2(71, 17), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            ("Mode_12_Ember3", 12, new Vector2(70, 28), StationRole.Auto, SpawnMode.Ember, false, default, float.NaN, float.NaN),
            // 路遇 c · 石林堤：炭童从堤两侧熔岩爬出，毕方栖在铁柱顶
            ("Mode_13_Lava1", 13, new Vector2(43, 11), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_13_Lava2", 13, new Vector2(51, 18), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_13_Lava3", 13, new Vector2(47, 29), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_13_Lava4", 13, new Vector2(36, 12), StationRole.Auto, SpawnMode.LavaCrawl, false, default, float.NaN, float.NaN),
            ("Mode_13_Perch", 13, new Vector2(42, 28), StationRole.Precision, SpawnMode.Ambush, true, default, float.NaN, ColumnH * 1.2f - ColumnSink + 0.05f),
        };

        // ───────────── 地貌（世界 XZ → 世界 y）─────────────

        /// <summary>离游玩区边界的有符号距离（界内为正，米）：多边形 + 东崖龛，崖线带噪声摆动（宫门一段不摆）</summary>
        static float Inside(Vector2 q)
        {
            float ins = LevelKit.PolygonSigned(q, Envelope);
            float calm = Disc(q, new Vector2(-20, 114), 24, 8);
            ins += (Fbm(q, 18, 3, 41) * 1.6f + Fbm(q, 5, 2, 43) * 0.5f) * (1 - calm);
            return Mathf.Max(ins, NicheR - Vector2.Distance(q, NicheC));
        }

        /// <summary>可玩区遮罩（软边界与 L5 共用）</summary>
        static float Playable(Vector2 world) => Smooth(-4, 4, Inside(world));

        /// <summary>陆块高度（离陆块太远返回 −∞）；top = 顶面遮罩</summary>
        static float LandHeight(Vector2 q, in Land l, out float top)
        {
            top = 0;
            float d = LevelKit.PolygonSigned(q, l.poly);
            if (d < -(l.ring + 3)) return float.MinValue;
            d += Fbm(q, 11, 2, l.seed) * l.wobble;
            float t = Mathf.Clamp01(-d / l.ring);
            top = 1 - Smooth(-1f, 0.5f, -d);
            return l.top - (l.top - BedY) * Smooth(0, 1, t) + Fbm(q, 6, 2, l.seed + 3) * 0.05f * (1 - t);
        }

        /// <summary>南坡山体：+2（北缘接码头）→ +17（南崖脚）；东缘没入熔岩</summary>
        static float HillHeight(Vector2 q, out float inside)
        {
            float d = LevelKit.PolygonSigned(q, SouthHill);
            inside = Smooth(-6, 0, d);
            if (d < -8) return float.MinValue;
            float h = QuayY + 15f * Smooth(-46, -82, q.y) + Fbm(q, 16, 2, 21) * 0.4f;
            float t = Mathf.Clamp01(-d / 6f);
            return Mathf.Lerp(h, BedY, Smooth(0, 1, t));
        }

        static LevelKit.Sample Eval(Vector2 q)
        {
            var s = new LevelKit.Sample();
            float h = BedY + Fbm(q, 9, 2, 5) * 0.15f;
            float packed = 0, landTop = 0;

            // ── 陆块 ──
            foreach (var l in Lands)
            {
                float lh = LandHeight(q, l, out float top);
                if (lh > h) h = lh;
                landTop = Mathf.Max(landTop, top);
            }
            float hill = HillHeight(q, out float hillIn);
            if (hill > h) h = hill;
            // 出生眺台 +18（北、东两面是崖）
            float od = Vector2.Distance(q, Spawn);
            float overlook = SpawnY - Mathf.Max(0, od - OverlookR) * 3.2f;
            if (overlook > h) h = Mathf.Lerp(h, overlook, Smooth(OverlookR + 8, OverlookR, od));
            float overlookTop = 1 - Smooth(OverlookR - 1, OverlookR + 0.5f, od);
            // 跳石
            foreach (var st in Stones)
            {
                float sd = Vector2.Distance(q, st);
                if (sd < StoneR + 1.2f) h = Mathf.Max(h, Mathf.Lerp(BedY, StoneTop, 1 - Smooth(StoneR, StoneR + 1.2f, sd)));
            }

            // ── 之字坡（挖 + 填）──
            float zig = 0;
            {
                var (d, t) = Zigzag.Nearest(q, ZigHalf + ZigShoulder);
                float m = 1 - Smooth(ZigHalf, ZigHalf + ZigShoulder, d);
                if (m > 0)
                {
                    h = Mathf.Lerp(h, Zigzag.HeightAt(t), m);
                    zig = 1 - Smooth(ZigHalf - 1, ZigHalf + 0.3f, d);
                }
            }

            // ── 堤、崖腰路、御道 ──
            float deck = 0;
            foreach (var w in Ways)
            {
                var (d, t) = w.path.Nearest(q, w.half + w.shoulder);
                float m = 1 - Smooth(w.half, w.half + w.shoulder, d);
                if (m <= 0) continue;
                float top = w.path.HeightAt(t);
                if (w.fillOnly) h = Mathf.Max(h, Mathf.Lerp(h, top, m));
                else h = Mathf.Lerp(h, top, m);
                deck = Mathf.Max(deck, 1 - Smooth(w.half - 0.8f, w.half + 0.4f, d));
            }

            // ── 台基 + 坡道 ──
            float terraceTop = 0, rampAny = 0;
            foreach (var tr in Terraces)
            {
                float pv = Plateau(q, tr.c, tr.half, tr.yaw, tr.rise, tr.edge, NoRamps);
                if (pv > 0) h = Mathf.Max(h, Mathf.Lerp(h, tr.baseY + pv, Smooth(0, 0.6f, pv)));
                terraceTop = Mathf.Max(terraceTop, Smooth(tr.rise - 0.3f, tr.rise - 0.05f, pv));
                foreach (var (foot, top, width) in tr.ramps)
                {
                    var (t, m) = Ramp(q, foot, top, width, 1.6f);
                    if (m <= 0) continue;
                    float target = Mathf.Lerp(tr.baseY, tr.TopY, Smooth(0, 1, t) * 0.25f + t * 0.75f);
                    h = Mathf.Max(h, Mathf.Lerp(h, target, m));
                    rampAny = Mathf.Max(rampAny, m);
                }
            }

            // ── 崖 + 火山口外坡 ──
            float ins = Inside(q);
            if (ins < 4f)
            {
                float wallH = WallH + WallVar * (Fbm(q, 60, 2, 31) * 0.5f + 0.5f);
                float foot = Mathf.Max(h, BedY);
                h = Mathf.Max(h, foot + LevelKit.RimProfile(ins, 1f, 3f, wallH, WallFace));
                if (ins < -12f) h = Mathf.Lerp(h, PlainY + Fbm(q, 70, 2, 51) * 2f, Smooth(-12f, -95f, ins));
            }

            // ── 地形外缘 30 m 内落回远景地面 ──
            var local = q - Origin;
            float edgeDist = Mathf.Min(Mathf.Min(local.x, Size.x - local.x), Mathf.Min(local.y, Size.y - local.y));
            h = Mathf.Lerp(PlainY + 0.5f, h, Smooth(0, 30, edgeDist));
            s.h = h + Base;

            // ── 分层倾向（章节规则 Splat.Inferno：陡坡自动玄武岩）──
            float inside = Smooth(-0.5f, 1.5f, ins);
            s.fluid = 1 - Smooth(LavaY + 0.05f, LavaY + 0.45f, h);
            float band = Smooth(LavaY + 0.25f, LavaY + 0.6f, h) * (1 - Smooth(1.6f, 2.4f, h));
            s.shore = band * (1 - deck) * (1 - landTop) * inside;
            packed = Mathf.Max(Mathf.Max(deck * 0.9f, zig * 0.75f), Mathf.Max(terraceTop * 0.85f, rampAny * 0.8f));
            packed = Mathf.Max(packed, Mathf.Max(overlookTop * 0.6f, landTop * 0.35f));
            s.packed = packed;
            s.sand = Mathf.Max(hillIn * 0.35f * (1 - zig), (1 - inside) * Smooth(-8, -16, ins) * 0.5f);
            float cliffBand = Smooth(0.5f, -1.5f, ins) * (1 - Smooth(-7, -10, ins));
            s.rock = cliffBand;
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

        static LevelKit.TerrainSet ts;

        static Vector3 G(Vector2 q, float dy = 0) => ts.OnGround(q.x, q.y, dy);
        static Vector3 At(Vector2 q, float y) => new(q.x, y, q.y);
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        /// <summary>生成场景 → 熔岩 → 软边界 → 烘焙 NavMesh（人形 + 熔岩生物）→ 验收（L5 规则集 + 熔岩 + 本关的关隘检查）→ 截图；返回不合格项数</summary>
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
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            try
            {
                var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(0, 14), PlainY, 760, 5);
                LevelKit.Backdrop(backdrop, env);
                LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), PlainY, theme.groundA, 3000);

                // 熔岩（L7）：一片盒子盖住整个火山口底，陆块、堤、台靠高度排除
                var lava = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Causeway Lake", center = new Vector3(2, LavaY, 13), shape = LavaShape.Box, size = LavaBox, depth = 2.5f, depthShore = true,
                }, world);

                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
                LevelKit.Weather(env, theme, Wind, 0.25f, new WeatherDirector.Region
                {
                    name = "火山落灰", center = new Vector3(0, 0, 14), radius = 120, fade = 50, profile = WeatherProfiles.Ashfall,
                    from = new Vector2(0.3f, 0.95f).normalized, calm = 55, warn = 8, storm = 20, abate = 8, firstDelay = 40, armRadius = 320, loop = true,
                });

                var statueHead = BuildLandmarks(env);
                BuildSpawnAndZigzag(props, markers);
                BuildFerry(arch, props, markers);
                BuildToll(arch, props, markers);
                BuildIsletAndBrokenCauseway(arch, props, world);
                BuildStoneforest(arch, props, markers);
                BuildHighRoad(arch, props, markers);
                BuildAnchorIsle(arch, props, markers);
                BuildRoadAndBridge(arch, props, world);
                var gate = BuildBarbican(arch, props, markers);
                BuildScatter(env, theme);
                BuildMarkers(markers);
                BuildModeAnchors(markers, gate);

                var spawnAt = G(Spawn, 0.05f);
                var look = statueHead - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.sqrMagnitude > 1e-4f ? look.normalized : Vector3.forward);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

                var rep = new LevelKit.Report();
                rep.Line("3-1 熔湖堤道 · 熔湖关隘 · 验收（ch3-v2）");
                var objective = BuildEncounters(markers, rep);
                BuildCaches(markers, objective);
                var portal = BuildExit(markers, arch, objective);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                // 先试烘一遍人形网格（不存盘）找导航孤岛、盖好不可走体块，再正式烘焙、存盘一次（同一路径存两次会偶发丢网格）
                var probeNav = ProbeNavMesh(env);
                NoNavIslands(world, statueHead, rep);
                Object.DestroyImmediate(probeNav.gameObject);
                var walkNav = LevelKit.BakeNavMesh(Dir, Name, env);
                if (!NavMesh.SamplePosition(G(Spawn), out _, 4f, LavaField.WalkerFilter()))
                {
                    rep.Warn("人形导航网格烘完在出生点采不到：重烘一次");
                    Object.DestroyImmediate(walkNav.gameObject);
                    LevelKit.BakeNavMesh(Dir, Name, env);
                }
                LevelKit.BakeLavaNavMesh(Dir, Name, env);
                BuildGuideLamps(props);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                rep.Line($"高度：眺台 {G(Spawn).y:F1}，之字坡第一折 {G(new Vector2(-48, -68)).y:F1} / 第二折 {G(new Vector2(-4, -56)).y:F1}，" +
                         $"① 码头 {G(FerryC).y:F1}（货垛 {G(CargoW.c).y:F1}），② 码头 {G(TollC + new Vector2(-6, 0)).y:F1}（税亭台 {G(TollTerrace.c).y:F1}），" +
                         $"③ 码头 {G(new Vector2(34, 44)).y:F1}（鼎台 {G(Cauldron.c + new Vector2(-5, -4)).y:F1}、锁链台 {G(ChainDeck.c).y:F1}），" +
                         $"高路 {G(new Vector2(71, 12)).y:F1}，④ 下场 {G(new Vector2(-30, 78)).y:F1} / 上场 {G(new Vector2(-20, 96)).y:F1} / 城墙 {G(WallW.c).y:F1} / 鼓楼台 {G(DrumW.c).y:F1}");
                LevelValidator.Run(Spec(statueHead), rep);
                LevelKit.ValidateLava(rep);
                CheckPass(rep, lava);
                CheckNavIslands(rep, statueHead);
                CheckComposition(rep, statueHead, arch, props);
                CheckSceneContents(rep, scene, portal);
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
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

        /// <summary>L7 熔岩盒：盖住整个火山口底（陆块、堤、台、崖靠高度排除）</summary>
        static readonly Vector2 LavaBox = new(160, 206);

        /// <summary>改后截图（与改前同名的 12 个机位，docs/art/review/ch3-v2/3-1/ 拼对照）</summary>
        static void Review(Vector3 spawnAt, Quaternion spawnRot, Vector3 statueHead)
        {
            Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                LevelKit.Capture(cam, fpRig, "level_3-1", new[]
                {
                    ("Aerial", new Vector3(-120, 120, -150), new Vector3(0, 0, 14), false),
                    ("Map", new Vector3(2, 330, 13), new Vector3(2, 0, 14), false),
                    ("Spawn", E(Spawn), statueHead, true),
                    ("FerryWest", E(new Vector2(-30, -45)), G(GatehouseC, 6), false),
                    ("CausewayC3", E(C1.path.At(0.15f)), G(TollTerrace.c, 4), false),
                    ("TollTerrace", E(TollTerrace.c + new Vector2(-3, 2)), G(AnchorC, 6), false),
                    ("AnchorPier", E(new Vector2(40, 36)), G(Cauldron.c, 5), false),
                    ("HubTerrace", E(ChainDeck.c + new Vector2(-2, 2)), G(ShrineAt, 6), false),
                    ("Islet", E(BrokenS.path.At(0.95f)), G(IsletC, 1), false),
                    ("QuayBeach", E(BridgeS + new Vector2(1, -3)), G(ShrineAt, 6), false),
                    ("DrumTerrace", E(WallW.c + new Vector2(0, -8)), G(GatehouseC, 6), false),
                    ("CacheB", E(new Vector2(71, 8)), G(CacheB, 1), false),
                    ("GatehouseFrame", E(GatehouseC + (GatehouseC - TollTerrace.c).normalized * 9f), G(TollTerrace.c, 4), false),
                    ("PalaceFrame", E(PalaceGate + new Vector2(0, -16)), At(Courtyard, UpperWard.TopY + 3f), false),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }

        // ───────────── 摆件 ─────────────

        static bool IsPlaceholder(GameObject go) => go && go.name.StartsWith("Placeholder");

        // 程序件材质：第三章共用调色板（LevelKit.InfernoLook，美术清理路统一管颜色）
        static Material PlaceholderMat => LevelKit.Ch3Placeholder(Dir);
        static Material IronMat => LevelKit.Ch3Iron(Dir);
        static Material CrateMat => LevelKit.Ch3Crate(Dir);

        /// <summary>按 id 摆一件：底面中心 = at、世界 y = baseY（不给时贴地再往下埋 sink × scale）。没有 Prefab 就放设计尺寸 × scale 的白盒</summary>
        static GameObject Put(string id, Transform parent, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, float? baseY = null)
        {
            var size = (DesignSize.TryGetValue(id, out var d) ? d : Vector3.one * 2) * scale;
            var p = baseY.HasValue ? At(at, baseY.Value) : G(at, -sink * scale);
            var go = LevelKit.PlaceOrBox(id, parent, p, size, yaw, scale, PlaceholderMat);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>栖柱：桩底埋 0.25 m，桩顶补一块平的落脚碰撞，桩顶放 <see cref="PerchPoint"/>。返回桩顶点</summary>
        static Vector3 PerchPillar(string name, Transform parent, Transform markers, Vector2 at, float yaw, float scale = 1f)
        {
            float baseY = G(at).y - ColumnSink;
            var go = Put(ColumnId, parent, at, yaw, scale, 0, baseY);
            if (go) go.name = $"{(IsPlaceholder(go) ? go.name : ColumnId)} ({name})";
            float top = baseY + ColumnH * scale;
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

        static void PerchMarker(Transform markers, string name, Vector3 at, float radius = 1.5f)
        {
            var m = new GameObject($"{PerchPoint.MarkerPrefix}_{name}");
            m.transform.SetParent(markers, false);
            m.transform.position = at + Vector3.up * 0.02f;
            m.AddComponent<PerchPoint>().radius = radius;
        }

        /// <summary>巨链（SM_Prop_InfernoChainLink）：a → b 一条下垂的链，纯装饰、拆掉碰撞。返回链环数</summary>
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
                foreach (var r in link.GetComponentsInChildren<Renderer>(true)) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                link.isStatic = true;
            }
            return n;
        }

        /// <summary>白盒部件：在 root 下放一块（局部坐标系 = root 的 XZ 朝向，min / max 是局部包围盒，米）</summary>
        static GameObject Part(Transform root, string name, Vector3 min, Vector3 max, Material m, Quaternion? tilt = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.localPosition = (min + max) * 0.5f;
            go.transform.localRotation = tilt ?? Quaternion.identity;
            go.transform.localScale = max - min;
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            go.isStatic = true;
            return go;
        }

        /// <summary>斜板（坡道 / 石阶）：局部 from → to（底面中线的两端）、宽 width、厚 thick</summary>
        static GameObject Slab(Transform root, string name, Vector3 from, Vector3 to, float width, float thick, Material m)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(root, false);
            var d = to - from;
            var rot = Quaternion.LookRotation(d.normalized, Vector3.up);
            go.transform.localRotation = rot;
            go.transform.localPosition = (from + to) * 0.5f - rot * Vector3.up * (thick * 0.5f);
            go.transform.localScale = new Vector3(width, thick, d.magnitude);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            go.isStatic = true;
            return go;
        }

        /// <summary>
        /// 渡口关楼（ch3-v2 6.2，承重件）：有 Prefab 就摆 Prefab；没有时搭一个能用的白盒——两座墩子夹 8 m 门洞（堤道从门洞穿过）、
        /// 门楣、+8 平顶城台（四周 1.1 m 女墙，两侧留口）、后角两座小亭、两侧外挂石阶（前角 → 后角，约 30°）。整组标占位。返回城台顶面世界 y
        /// </summary>
        static float BuildGatehouse(Transform parent, Vector2 c, float yaw, float baseY)
        {
            if (ShowcaseSceneBuilder.Prefab(GatehouseId))
                return BuildGatehouseModel(parent, c, yaw, baseY);
            GatehouseTops.Clear();
            GatehouseTops.Add(At(c, baseY + 8f));
            LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var root = new GameObject($"Placeholder · {GatehouseId}（白盒：门洞 8 m、城台 +8、两侧石阶）").transform;
            root.SetParent(parent, false);
            root.SetPositionAndRotation(At(c, baseY), Quaternion.Euler(0, yaw, 0));
            root.tag = LevelKit.PlaceholderTag;
            root.gameObject.isStatic = true;
            var m = PlaceholderMat;
            const float sink = 1.5f;
            Part(root, "西墩", new Vector3(-8, -sink, -7), new Vector3(-4, 8, 7), m);
            Part(root, "东墩", new Vector3(4, -sink, -7), new Vector3(8, 8, 7), m);
            Part(root, "门楣", new Vector3(-4, 6, -7), new Vector3(4, 8, 7), m);
            Part(root, "前女墙西", new Vector3(-8, 8, -7), new Vector3(-1.5f, 9.1f, -6.4f), m);
            Part(root, "前女墙东", new Vector3(1.5f, 8, -7), new Vector3(8, 9.1f, -6.4f), m);
            Part(root, "后女墙", new Vector3(-8, 8, 6.4f), new Vector3(8, 9.1f, 7), m);
            Part(root, "西女墙", new Vector3(-8, 8, -7), new Vector3(-7.4f, 9.1f, 2.5f), m);
            Part(root, "东女墙", new Vector3(7.4f, 8, -7), new Vector3(8, 9.1f, 2.5f), m);
            Part(root, "西亭", new Vector3(-5.6f, 8, 4f), new Vector3(-3.2f, 12, 6.4f), m);
            Part(root, "东亭", new Vector3(3.2f, 8, 4f), new Vector3(5.6f, 12, 6.4f), m);
            // 石阶：贴外侧墙根，从门脸前 4.5 m 的地面起坡（30°）到后段的外挑平台（与城台同高，城台侧边在后段 4.5 m 留口）
            Slab(root, "西石阶", new Vector3(-9.2f, 0, -11.5f), new Vector3(-9.2f, 8, 2.5f), 2.4f, 1.2f, m);
            Slab(root, "东石阶", new Vector3(9.2f, 0, -11.5f), new Vector3(9.2f, 8, 2.5f), 2.4f, 1.2f, m);
            Part(root, "西石阶顶", new Vector3(-10.4f, 6.8f, 2.4f), new Vector3(-8, 8, 7), m);
            Part(root, "东石阶顶", new Vector3(8, 6.8f, 2.4f), new Vector3(10.4f, 8, 7), m);
            return baseY + 8f;
        }

        /// <summary>关楼城台上能站的点（世界坐标；正式件按射线实测的两块城台，白盒是城台中心）：验收从出生点走到这里</summary>
        static readonly List<Vector3> GatehouseTops = new();

        /// <summary>关楼 Tripo 件的城台在发布尺度 9.94 m（docs/art/ch3-kit.md 第 2 节）：等比 ×0.805 让城台正好 +8</summary>
        const float GatehouseScale = 0.805f;
        static Material BasaltMat => LevelKit.Ch3Basalt(Dir);

        /// <summary>
        /// 关楼正式件：等比 ×0.805（城台 +8），件里没有画外挂石阶——在门脸前、左右两块城台正前方各补一道 2.6 m 宽的玄武岩石阶（约 34°）。
        /// 城台的左右两块位置按射线实测（往下打到 +8 ± 0.6 的面），打不到就按件的设计位置（±5 m）
        /// </summary>
        static float BuildGatehouseModel(Transform parent, Vector2 c, float yaw, float baseY)
        {
            Put(GatehouseId, parent, c, yaw, GatehouseScale, 0, baseY);
            Physics.SyncTransforms();
            float top = baseY + 8f;
            var rot = Quaternion.Euler(0, yaw, 0);
            var origin = At(c, baseY);
            bool TopAt(float lx, float lz)
            {
                var wp = origin + rot * new Vector3(lx, 0, lz);
                wp.y = top + 6f;
                return Physics.Raycast(wp, Vector3.down, out var h, 12f, ~0, QueryTriggerInteraction.Ignore) && Mathf.Abs(h.point.y - top) < 0.6f;
            }
            var spans = new List<(float a, float b)>();
            float? start = null;
            for (float lx = -9f; lx <= 9.01f; lx += 0.25f)
            {
                bool hit = TopAt(lx, 0);
                if (hit && start == null) start = lx;
                if ((!hit || lx >= 9f) && start != null)
                {
                    if (lx - start.Value >= 1.5f) spans.Add((start.Value, lx));
                    start = null;
                }
            }
            var centers = spans.Count >= 2 ? new[] { (spans[0].a + spans[0].b) * 0.5f, (spans[^1].a + spans[^1].b) * 0.5f } : new[] { -5f, 5f };
            GatehouseTops.Clear();
            foreach (float cx in centers) GatehouseTops.Add(origin + rot * new Vector3(cx, 8f, 0));
            var stairs = new GameObject("关楼石阶（程序，件里没画）").transform;
            stairs.SetParent(parent, false);
            stairs.SetPositionAndRotation(origin, rot);
            stairs.gameObject.isStatic = true;
            foreach (float cx in centers)
            {
                float zf = 0;
                while (zf > -6f && TopAt(cx, zf - 0.25f)) zf -= 0.25f;
                Slab(stairs, cx < 0 ? "西石阶" : "东石阶", new Vector3(cx, 0, zf - 12f), new Vector3(cx, 8, zf + 0.3f), 2.6f, 1.2f, BasaltMat);
            }
            Debug.Log($"[Level] 3-1 关楼：城台 {spans.Count} 块（{string.Join("、", spans.Select(sp => $"{sp.a:F1}…{sp.b:F1}"))}），石阶在 x {string.Join(" / ", centers.Select(x => x.ToString("F1")))}");
            return top;
        }

        /// <summary>崖顶祝融像（全图地标）；返回神像头部（视线目标）</summary>
        static Vector3 BuildLandmarks(Transform env)
        {
            float baseY = G(StatueAt).y - 0.6f;
            Put(StatueId, env, StatueAt, 180, StatueScale, 0, baseY);
            return At(StatueAt, baseY + DesignSize[StatueId].y * StatueScale * 0.86f);
        }

        /// <summary>出生眺台两座火坛；之字坡第一折的渣堆（路遇 a 的余烬起身位）、第二折的锁魂碑</summary>
        static void BuildSpawnAndZigzag(Transform props, Transform markers)
        {
            var root = new GameObject("出生 · 之字坡").transform;
            root.SetParent(props, false);
            Put(AltarId, root, Spawn + new Vector2(-5, -4), 0);
            Put(AltarId, root, Spawn + new Vector2(5, -4), 0);
            Put(ObeliskId, root, new Vector2(-3, -62), 30, 1.3f);
            // 渣堆 ×3：坩埚残渣（矮掩体），余烬起身的炭童从这里拼起来
            Put(CauldronId, root, new Vector2(-48, -63), 20, 1.2f);
            Put(IngotId, root, new Vector2(-38, -59), 70);
            Put(CauldronId, root, new Vector2(-30, -63), -30, 1.1f);
            PerchPillar("Zig", root, markers, new Vector2(-53, -74), 10);
        }

        /// <summary>
        /// ① 渡口关楼：关楼（白盒 / Tripo）骑在码头东北角，门洞对着 C1；码头上坍墙 ×2、货堆 ×3（2 件可破坏）、拒马 ×2、锚链桩、火坛；
        /// 两块货垛台（+3.4）。东南段码头岸是无护栏熔岩岸（击退带）
        /// </summary>
        static void BuildFerry(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("① 渡口关楼").transform;
            root.SetParent(arch, false);
            float top = BuildGatehouse(root, GatehouseC, GatehouseYaw, QuayY - 0.05f);
            var gateTop = At(GatehouseC, top);
            PerchMarker(markers, "Gatehouse", gateTop + new Vector3(0, 0, 0), 2f);
            var p = new GameObject("① 掩体").transform;
            p.SetParent(props, false);
            // 全遮掩体彼此隔开 ≥ 6 m（L5 掩体数把 2 格内相邻的掩体旁站位连成一处）：关楼、西货垛、西南平台块、西北坍墙、北平台块、码头中间的坍墙、关楼前的锚链桩
            Put(BlockId, p, new Vector2(-55, -42), 10);
            Put(CoverWallId, p, new Vector2(-56, -20), 70, 1.2f);
            Put(BlockBId, p, new Vector2(-36, -16), -15);
            Put(CoverWallId, p, new Vector2(-32, -30), 60, 1.2f);
            Put(BarricadeId, p, new Vector2(-24, -14), 0, 1.2f);
            Put(BarricadeId, p, new Vector2(-10, -38), 60, 1.2f);
            Put(IngotId, p, new Vector2(-46, -22), 30, HalfIngot);
            PerchPillar("Ferry", root, markers, new Vector2(-27, -23), 0);
            Crate(p, "货堆（可破坏）", new Vector2(-35.5f, -26.5f), 20); // 和码头中间的坍墙成簇
            Crate(p, "货堆（可破坏）", new Vector2(-16, -42), -10);
        }

        /// <summary>可破坏货堆（木箱白盒 1.3 m = 半掩体，只认爆炸 + 近战；碎了有小概率掉弹药）</summary>
        static void Crate(Transform parent, string name, Vector2 at, float yaw)
        {
            var d = LevelKit.PlaceDestructible(name, parent, G(at), yaw, new Vector3(1.8f, 1.3f, 1.6f), Destructible.Kind.Wood, CrateMat, 60f);
            d.accepts = Destructible.DamageKind.Explosion | Destructible.DamageKind.Melee;
            d.ammoChance = 0.35f;
        }

        /// <summary>可破坏补给坩埚：外观用 SM_Prop_InfernoCrucible，碰撞用圆柱；碎了掉弹药 / 生命</summary>
        static void SupplyCrucible(Transform parent, Vector2 at, float yaw, float ammo, float health)
        {
            var d = LevelKit.PlaceDestructible("补给坩埚（可破坏）", parent, G(at), yaw, new Vector3(1.6f, 1.3f, 1.6f), Destructible.Kind.Metal, IronMat, 20f, false);
            d.ammoChance = ammo;
            d.healthChance = health;
            d.weakTo = Destructible.DamageKind.Explosion;
            var model = ShowcaseSceneBuilder.Place(CrucibleId, d.intact.transform, G(at), yaw, 1.3f);
            if (model)
            {
                foreach (var r in d.intact.GetComponentsInChildren<MeshRenderer>(true))
                    if (r.gameObject.name == "Body") r.enabled = false;
                foreach (var col in model.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(col);
            }
        }

        /// <summary>② 税关墩：税亭（税亭台上）、玄武岩柱丛 ×2、锚链桩 ×2、矮护墙 ×3、镇湖碑；台口两座火坛</summary>
        static void BuildToll(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("② 税关墩").transform;
            root.SetParent(arch, false);
            Put(StallId, root, TollTerrace.c + new Vector2(1.5f, 2), 180, 1.4f, 0, TollTerrace.TopY - 0.05f);
            Put(AltarId, root, TollTerrace.c + new Vector2(-4.5f, -3.5f), 180, AltarBig, 0, TollTerrace.TopY - 0.05f);
            Put(AltarId, root, TollTerrace.c + new Vector2(4.5f, -3.5f), 180, AltarBig, 0, TollTerrace.TopY - 0.05f);
            Put(ColumnsId, root, new Vector2(5, 24), 30, 0.75f, 0.3f);
            Put(ColumnsId, root, new Vector2(24, 25), -40, 0.7f, 0.3f);
            PerchPillar("TollW", root, markers, new Vector2(8, -3), 0);
            PerchPillar("TollE", root, markers, new Vector2(31, 4), 0);
            var p = new GameObject("② 掩体").transform;
            p.SetParent(props, false);
            Put(CoverWallId, p, new Vector2(3, 5), 90, 1.2f);
            Put(CoverWallId, p, new Vector2(21, -3), 0, 1.2f);
            Put(CoverWallId, p, new Vector2(22, 14), 90, 1.2f);
            Put(CoverWallId, p, new Vector2(11, 26), 0, 1.2f);
            Put(ObeliskId, p, new Vector2(29, 19), 0, 1.6f);
            Put(IngotId, p, new Vector2(4, 16), 40, HalfIngot);
        }

        /// <summary>湖心石龛（藏宝 A，宝藏堆在藏宝点上）+ 断堤：两段断堤的端头（断堤端头白盒）、南段堤道段立面（风险 4 的实测点）</summary>
        static void BuildIsletAndBrokenCauseway(Transform arch, Transform props, Transform world)
        {
            var root = new GameObject("断堤 · 湖心石龛").transform;
            root.SetParent(arch, false);
            Put(AltarId, props, IsletC + new Vector2(-1.5f, 2.8f), 150, 1, 0, 1.45f);
            Put(AltarId, props, IsletC + new Vector2(2.2f, 1.6f), 210, 1, 0, 1.45f);
            // 断口两端：南段堤头一件、御道南坡一件断堤端头（顶面比堤面低 0.15 m），断口朝向对方
            var headS = BrokenS.path.At(1f);
            var dirS = BrokenS.path.TangentAt(1f);
            Put(BreakId, root, headS - dirS * 1.5f, YawZ(dirS), 0.7f, 0, DeckY - 0.15f - DesignSize[BreakId].y * 0.7f);
            var roadT = Road.path.Nearest(headS).t;
            var roadP = Road.path.At(roadT);
            var toHead = (headS - roadP).normalized;
            var stubAt = roadP + toHead * (Road.half + 2.5f);
            Put(BreakId, root, stubAt, YawZ(toHead), 0.7f, 0, 3f - 0.15f - DesignSize[BreakId].y * 0.7f);
            // 断堤南段中部一节堤道段立面（顶面 = 堤面 −0.05，比堤面宽 1 m）：风险 4 实测——击退能不能把敌人从 1 m 立面推进熔岩
            var mid = BrokenS.path.At(0.5f);
            var tan = BrokenS.path.TangentAt(0.5f);
            var seg = Put(SegmentId, root, mid, YawZ(tan), 0.75f, 0, DeckY - 0.05f - DesignSize[SegmentId].y * 0.75f);
            if (seg) seg.name = $"{seg.name}（立面实测段）";
            var probe = new GameObject("Facade_Edge");
            probe.transform.SetParent(world, false);
            var n = new Vector2(tan.y, -tan.x);
            probe.transform.SetPositionAndRotation(At(mid + n * 4.2f, DeckY), Quaternion.LookRotation(new Vector3(n.x, 0, n.y)));

            // 跳石在导航上不连：放一条导航链接（堤头 ↔ 石龛），验收的交互净空和机器人寻路认它；玩家照样要跳
            var head = BrokenS.path.At(1f);
            var from = G(head + (Stones[0] - head).normalized * 3f);
            var to = G(IsletC + (Stones[2] - IsletC).normalized * 2.5f);
            var linkGo = new GameObject("NavLink · 跳石");
            linkGo.SetActive(false); // 先填好区域再启用：NavMeshLink 启用时登记，之后改 area 不生效
            linkGo.transform.SetParent(world, false);
            linkGo.transform.position = from;
            var link = linkGo.AddComponent<Unity.AI.Navigation.NavMeshLink>();
            link.agentTypeID = LavaField.WalkerAgentType;
            link.startPoint = Vector3.zero;
            link.endPoint = to - from;
            link.width = 1.2f;
            link.bidirectional = true;
            link.autoUpdate = false;
            // 链接算 Lava 区：只走非熔岩区的寻路（机器人、主路验收）不会借它抄近路，交互净空（全部区域）照样认
            if (LevelKit.LavaNavArea >= 0) link.area = LevelKit.LavaNavArea;
            linkGo.SetActive(true);
        }

        /// <summary>东石林：玄武岩柱丛 ×5 立在堤两侧的熔岩里，一根铁柱是毕方的栖点</summary>
        static void BuildStoneforest(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("东石林").transform;
            root.SetParent(arch, false);
            Put(ColumnsId, root, new Vector2(39, 22), 20, 0.85f, 0, -1.2f);
            Put(ColumnsId, root, new Vector2(61, 24), -30, 0.9f, 0, -1.2f);
            Put(ColumnsId, root, new Vector2(49, 1), 60, 0.8f, 0, -1.2f);
            Put(ColumnsId, root, new Vector2(34, 30), 10, 0.7f, 0, -1.2f);
            Put(ColumnsId, root, new Vector2(60, 8), -50, 0.75f, 0, -1.2f);
            PerchPillar("Stoneforest", root, markers, new Vector2(42, 28), 0, 1.2f);
        }

        /// <summary>东崖腰高路：岩肋 ×2（白盒，贴崖）、毕方栖柱 ×2；崖龛 ⑤ 熔铸遗址的残墙、坩埚、铁锭</summary>
        static void BuildHighRoad(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("东崖腰高路").transform;
            root.SetParent(arch, false);
            Put(RibId, root, new Vector2(78, -2), -90, 0.8f, 0, 9.8f);
            Put(RibId, root, new Vector2(76, 32), -100, 0.8f, 0, 9.8f);
            PerchPillar("LedgeS", root, markers, new Vector2(66, 0), 0);
            PerchPillar("LedgeN", root, markers, new Vector2(66, 26), 0);
            var p = new GameObject("⑤ 熔铸遗址").transform;
            p.SetParent(props, false);
            Put(CoverWallId, p, new Vector2(80, 8), 80, 1.2f);
            Put(CoverWallId, p, new Vector2(81, 21), 100, 1.2f);
            Put(IngotId, p, new Vector2(88, 18), 15, HalfIngot);
            Put(CrucibleId, p, new Vector2(89, 10), 0, 1.5f);
        }

        /// <summary>
        /// ③ 锚链大墩：镇湖鼎（白盒 / 吊鼎件，半沉在鼎台上）三根锚链拉上东崖（锁扣白盒），锚链桩 ×3、岩肋、矮护墙 ×4；锁链台两座火坛
        /// </summary>
        static void BuildAnchorIsle(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("③ 锚链大墩").transform;
            root.SetParent(arch, false);
            var cauldronAt = new Vector2(43, 52);
            Put(CauldronBigId, root, cauldronAt, 200, 1f, 0, Cauldron.TopY - 2.6f);
            var rim = At(cauldronAt, Cauldron.TopY - 2.6f + DesignSize[CauldronBigId].y * 0.92f);
            int links = 0;
            foreach (float z in new[] { 42f, 52f, 62f })
            {
                // 锚点：东崖面上 +24 的地方（沿 x 往东找地面高过 24 m 的第一格）
                float x = 66;
                while (x < 100 && ts.GroundY(x, z) < 24f) x += 0.5f;
                var lockAt = new Vector2(x - 0.8f, z);
                Put(ChainLockId, root, lockAt, -90, 1.2f, 0, 23.5f);
                links += Chain(root, $"镇湖锚链 z{z:0}", rim + new Vector3(1.5f, 0, (z - cauldronAt.y) * 0.08f), At(lockAt, 24.8f), 2.2f, ChainScale);
            }
            Debug.Log($"[Level] 3-1 镇湖鼎：锚链 3 条共 {links} 节");
            Put(AltarId, root, ChainDeck.c + new Vector2(-3, -4), 270, AltarBig, 0, ChainDeck.TopY - 0.05f);
            Put(AltarId, root, ChainDeck.c + new Vector2(-3, 4), 270, AltarBig, 0, ChainDeck.TopY - 0.05f);
            PerchPillar("AnchorS", root, markers, new Vector2(36, 40), 0);
            PerchPillar("AnchorW", root, markers, new Vector2(29, 56), 0);
            PerchPillar("AnchorN", root, markers, new Vector2(54, 68), 0);
            PerchMarker(markers, "ChainDeck", At(ChainDeck.c + new Vector2(2, 0), ChainDeck.TopY));
            var p = new GameObject("③ 掩体").transform;
            p.SetParent(props, false);
            Put(RibId, p, new Vector2(64, 40), -60, 0.55f);
            Put(CoverWallId, p, new Vector2(32, 46), 90, 1.2f);
            Put(CoverWallId, p, new Vector2(52, 41), 10, 1.2f);
            Put(CoverWallId, p, new Vector2(38, 64), 0, 1.2f);
            Put(CoverWallId, p, new Vector2(56, 64), 30, 1.2f);
            Put(BlockId, p, new Vector2(30, 46), 20);
        }

        /// <summary>御道（补给坩埚 ×3、火坛、锁魂碑）+ 吊桥（程序铁桥：铁板桥面 + 两侧铁栏，跨护城熔渠）</summary>
        static void BuildRoadAndBridge(Transform arch, Transform props, Transform world)
        {
            var root = new GameObject("御道 · 吊桥").transform;
            root.SetParent(arch, false);
            var p = new GameObject("补给 · 御道坡脚").transform;
            p.SetParent(props, false);
            SupplyCrucible(p, SupplyAt + new Vector2(-2, 3), 0, 1f, 0f);
            SupplyCrucible(p, SupplyAt + new Vector2(1.5f, 3.5f), 40, 0f, 1f);
            SupplyCrucible(p, SupplyAt + new Vector2(4, 1.5f), 80, 0.6f, 0.6f);
            Put(AltarId, p, SupplyAt + new Vector2(-4, -3), 0);
            Put(ObeliskId, p, new Vector2(8, 55), 0, 1.4f);

            // 吊桥：桥面从御道北头（+3）到瓮城下场（+2），8 m 宽；两侧 1 m 铁栏中段各开 3 m 缺口（击退带）
            var bridge = new GameObject("吊桥").transform;
            bridge.SetParent(root, false);
            var a = At(BridgeS, G(BridgeS).y);
            var b = At(BridgeN, G(BridgeN).y);
            bridge.SetPositionAndRotation(a, Quaternion.LookRotation(new Vector3(b.x - a.x, 0, b.z - a.z)));
            float len = Vector2.Distance(BridgeS, BridgeN);
            var m = IronMat;
            Slab(bridge, "桥面", new Vector3(0, 0.02f, -1), new Vector3(0, b.y - a.y + 0.02f, len + 1), BridgeW, 0.7f, m);
            for (int side = -1; side <= 1; side += 2)
            {
                float x = side * (BridgeW * 0.5f - 0.15f);
                float y0 = 0.02f, y1 = b.y - a.y + 0.02f;
                Part(bridge, side < 0 ? "西栏南" : "东栏南", new Vector3(x - 0.15f, y0, 0), new Vector3(x + 0.15f, y0 + 1.1f, len * 0.5f - 1.5f), m);
                Part(bridge, side < 0 ? "西栏北" : "东栏北", new Vector3(x - 0.15f, y1, len * 0.5f + 1.5f), new Vector3(x + 0.15f, y1 + 1.1f, len), m);
            }
            // 吊链：桥北头两根链拉上瓮城下场的两根铁柱
            for (int side = -1; side <= 1; side += 2)
            {
                var post = BridgeN + new Vector2(side * 5.5f, 1.5f);
                Put(ColumnId, root, post, 0, 1.1f, 0.25f);
                Chain(root, $"吊桥链 {(side < 0 ? "西" : "东")}", At(post, G(post).y + ColumnH * 1.05f), At(BridgeS + new Vector2(side * 3.6f, 3f), G(BridgeS).y + 0.6f), 0.4f, 1.4f);
            }
        }

        /// <summary>
        /// ④ 宫门瓮城：宫墙（城墙件 ×6）+ 宫门（门洞件 + 熔铁闸白盒，闸后是宫院）+ 出口神龛；鼓楼 ×2（鼓楼台后）；
        /// 下场渠岸的护城渠矮墙（拒马、锭堆，留口）、上场的铸范 / 掩体墙、炮位台火坛。返回熔铁闸（增援门的门，MovingPlatform）
        /// </summary>
        /// <summary>
        /// 宫门熔铁闸（④ 第二波的增援门）：移动平台做的门（Signal / Advance：收到一次信号升 8.5 m 停住），竖着的闸板 8.5 × 9 × 1.2 m；
        /// 不进导航烘焙（门洞的导航网格连着宫院，门升起后祸斗直接冲出来）。熔铁闸 Tripo 件到货前是白盒（整组标占位）
        /// </summary>
        static MovingPlatform BuildPalaceGate(Transform root, float floor)
        {
            var at = PalaceGate + new Vector2(0, 0.6f);
            const float h = 9f, lift = 8.5f;
            var door = LevelKit.PlaceMovingPlatform($"Placeholder · {MoltenGateId}（宫门熔铁闸，会升起）", root,
                new[] { At(at, floor + h - 0.2f), At(at, floor + h - 0.2f + lift) }, 180, new Vector2(8.5f, 1.2f), h, PlaceholderMat, PlaceholderMat);
            door.mode = MovingPlatform.Mode.Signal;
            door.onSignal = MovingPlatform.SignalAction.Advance;
            door.speed = 4f;
            door.accel = 6f;
            door.dwell = 0;
            door.gameObject.AddComponent<Unity.AI.Navigation.NavMeshModifier>().ignoreFromBuild = true;
            if (ShowcaseSceneBuilder.Prefab(MoltenGateId))
            {
                // 熔铁闸正式件（闸板 6.83 × 9 × 1.33）：X 拉到 8.5 m 挂在门板下，白盒板只留碰撞
                door.name = "宫门熔铁闸（会升起）";
                var plate = ShowcaseSceneBuilder.Place(MoltenGateId, door.deck, door.deck.position + Vector3.down * h, 180, 1f);
                if (plate)
                {
                    plate.transform.SetPositionAndRotation(door.deck.position + Vector3.down * h, Quaternion.Euler(0, 180, 0));
                    plate.transform.localScale = Vector3.Scale(plate.transform.localScale, new Vector3(8.5f / 6.83f, 1f, 1f));
                    foreach (var col in plate.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(col);
                }
                foreach (var r in door.deck.GetComponentsInChildren<MeshRenderer>(true))
                    if (!plate || !r.transform.IsChildOf(plate.transform)) r.enabled = false;
            }
            else
            {
                LevelKit.EnsureTag(LevelKit.PlaceholderTag);
                door.gameObject.tag = LevelKit.PlaceholderTag;
            }
            return door;
        }

        static MovingPlatform BuildBarbican(Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("④ 宫门瓮城").transform;
            root.SetParent(arch, false);
            float floor = UpperWard.TopY;
            float wallW = DesignSize[RampartId].x;
            for (int i = 0; i < 2; i++)
            {
                float x = DesignSize[GatewayId].x * 0.5f + wallW * (i + 0.5f) - 0.2f;
                Put(RampartId, root, new Vector2(-20 - x, PalaceWallZ + 0.6f), 180, 1, 0, floor - 0.3f);
                Put(RampartId, root, new Vector2(-20 + x, PalaceWallZ + 0.6f), 180, 1, 0, floor - 0.3f);
            }
            Put(GatewayId, root, PalaceGate, 180, 1, 0, floor - 0.1f);
            var gate = BuildPalaceGate(root, floor);
            Put(TowerId, root, new Vector2(-45, 110), 180, 1f, 0, floor - 0.3f);
            Put(TowerId, root, new Vector2(5, 110), 180, 0.8f, 0, floor - 0.3f); // 不对称：东鼓楼矮一截（地标从东西两侧看轮廓不同）
            PerchMarker(markers, "DrumW", At(DrumW.c, DrumW.TopY));
            PerchMarker(markers, "DrumE", At(DrumE.c, DrumE.TopY));
            PerchMarker(markers, "WallW", At(WallW.c + new Vector2(0, -8), WallW.TopY));
            PerchMarker(markers, "WallE", At(WallE.c + new Vector2(0, -8), WallE.TopY));
            Put(AltarId, root, GunW.c + new Vector2(0, 1.5f), 180, AltarBig, 0, GunW.TopY - 0.05f);
            Put(AltarId, root, GunE.c + new Vector2(0, 1.5f), 180, AltarBig, 0, GunE.TopY - 0.05f);
            Put(AltarId, root, ShrineAt + new Vector2(-6, -2), 180, AltarBig, 0, floor - 0.05f);
            Put(AltarId, root, ShrineAt + new Vector2(6, -2), 180, AltarBig, 0, floor - 0.05f);

            var p = new GameObject("④ 掩体").transform;
            p.SetParent(props, false);
            // 下场：渠岸矮墙（拒马、锭堆、坍墙，中间留吊桥口和两处缺口）
            Put(BarricadeId, p, new Vector2(-40, 76.5f), 0, 1.2f);
            Put(BarricadeId, p, new Vector2(-29, 76.5f), 0, 1.2f);
            Put(IngotId, p, new Vector2(-35, 77.5f), 10, HalfIngot);
            Put(CoverWallId, p, new Vector2(-31, 80), 0, 1.2f);
            Put(CoverWallId, p, new Vector2(-6, 75.5f), 0, 1.2f);
            Put(BlockId, p, new Vector2(4, 77), 0);
            Put(BlockBId, p, new Vector2(-44, 79), 0);
            // 上场：两侧掩体墙（西墙旁一堆锭），宫门正前留白
            Put(CoverWallId, p, new Vector2(-28, 99), 0, 1.2f);
            Put(CoverWallId, p, new Vector2(-12, 99), 0, 1.2f);
            Put(IngotId, p, new Vector2(-24.5f, 101), 0, HalfIngot); // 贴西掩体墙成簇，宫门正前留白
            PerchPillar("BarbicanW", root, markers, new Vector2(-40, 96), 0);
            PerchPillar("BarbicanE", root, markers, new Vector2(-3, 96), 0);
            return gate;
        }

        /// <summary>散布（L4 章节默认）：余烬石在熔岩岸、火山渣在灰地；台、眺台上没有；玄武岩块（带碰撞）只在崖脚、远离路和站位</summary>
        static void BuildScatter(Transform env, ShowcaseTheme theme)
        {
            float Keep(Vector2 p)
            {
                if (Vector2.Distance(p, Spawn) < OverlookR + 2) return 0;
                foreach (var tr in Terraces)
                    if (Vector2.Distance(p, tr.c) < Mathf.Max(tr.half.x, tr.half.y) + 1.5f) return 0;
                foreach (var l in Lands)
                    if (LevelKit.PolygonSigned(p, l.poly) > 2) return 0.35f;
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
            var avoid = new List<(Vector2 c, float r)> { (Spawn, 16), (FerryC, 30), (TollC, 26), (AnchorC, 28), (GateC, 34), (NicheC, 12), (SupplyAt, 10) };
            foreach (var a in Anchors) avoid.Add((a.at, 6));
            boulders.where = pt =>
            {
                float ins = Inside(pt.p);
                if (ins < 1 || ins > 10) return 0;
                if (ts.GroundY(pt.p.x, pt.p.y) < 1.2f) return 0;
                foreach (var (c, r) in avoid)
                    if (Vector2.Distance(pt.p, c) < r) return 0;
                return bw?.Invoke(pt) ?? 1;
            };
            var big = LevelKit.ScatterProps(ts, env, boulders, new Rect(-76, -88, 164, 202), 10f, RouteDist);
            Debug.Log($"[Level] 3-1 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}；崖脚玄武岩块 {big.Count}");
        }

        /// <summary>离最近一条路（之字坡、堤、高路、御道）路面的距离（米，散布避让）</summary>
        static float RouteDist(Vector2 p)
        {
            float d = Zigzag.Nearest(p, 40).dist - ZigHalf;
            foreach (var w in Ways) d = Mathf.Min(d, w.path.Nearest(p, 40).dist - w.half);
            return Mathf.Max(0, d);
        }

        /// <summary>
        /// 标记：场地中心、站位（SpawnAnchor）、地标、熔岩探针、击退点 Knock_Edge（C1 堤肩，Map31Suite 在这里打一只进熔岩）与
        /// 每个必清场地的 Knock_Edge_1…4（场地的无护栏熔岩岸，验收查导航网格连到 Lava 区）
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
            Mk("Site_1_Ferry", G(FerryC));
            Mk("Site_2_Toll", G(TollC));
            Mk("Site_3_Anchor", G(AnchorC));
            Mk("Site_4_Barbican", G(GateC));
            Mk("Site_5_Foundry", G(GuardSite));
            Mk("Site_Islet", G(IsletC));
            Mk("Site_Exit", G(ShrineAt));
            Mk("Lava_Probe", At(new Vector2(-40, 20), LavaY));
            for (int i = 0; i < Stones.Length; i++) Mk($"Stone_{i + 1}", At(Stones[i], StoneTop));
            foreach (var a in Anchors)
            {
                var sa = SpawnAnchor.Create(root, a.name, G(a.at), a.role, a.lane, a.elevated, a.spread);
                sa.LookAt(G(SiteCenter(a.site)));
            }
            var (c, n) = KnockEdge(C1, 0.5f, +1);
            Knock(root, "Knock_Edge", c, n);
            foreach (var (name, at, outward) in KnockSpots)
            {
                var (kc, kn) = ShoreEdge(at, outward);
                Knock(root, name, kc, kn);
            }
        }

        /// <summary>出场方式的站位（<see cref="ModeAnchors"/>）：朝场地中心；跃下 / 增援门的辅助点；④ 的增援门挂宫门熔铁闸</summary>
        static void BuildModeAnchors(Transform markers, MonoBehaviour palaceDoor)
        {
            foreach (var m in ModeAnchors)
            {
                var at = float.IsNaN(m.lift) ? G(m.at) : G(m.at, m.lift);
                var a = SpawnAnchor.Create(markers, m.name, at, m.role, 0, m.elevated, m.mode == SpawnMode.Ambush ? 1.2f : 2f).Via(m.mode);
                a.LookAt(G(SiteCenter(m.site)));
                var aux = float.IsNaN(m.auxY) ? G(m.aux) : At(m.aux, m.auxY);
                switch (m.mode)
                {
                    case SpawnMode.Drop:
                        a.DropFrom(aux);
                        break;
                    case SpawnMode.Gate:
                        a.Gate(aux, m.site == 4 ? palaceDoor : null);
                        break;
                }
            }
        }

        static void Knock(Transform root, string name, Vector3 at, Vector2 outward)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(outward.x, 0, outward.y)));
        }

        /// <summary>每个必清场地的无护栏熔岩岸（起点在场地里、朝熔岩的方向）</summary>
        static readonly (string name, Vector2 at, Vector2 outward)[] KnockSpots =
        {
            ("Knock_Edge_1", new Vector2(-12, -36), new Vector2(1, 0.2f)),
            ("Knock_Edge_2", new Vector2(2, 10), new Vector2(-1, 0.1f)),
            ("Knock_Edge_3", new Vector2(30, 52), new Vector2(-1, 0)),
            ("Knock_Edge_4", new Vector2(-30, 76), new Vector2(0, -1)),
        };

        /// <summary>从 at 沿 outward 走到地面比熔岩高 0.65 m 的地方（击退点），返回该点与水平朝向</summary>
        static (Vector3 at, Vector2 outward) ShoreEdge(Vector2 at, Vector2 outward)
        {
            outward.Normalize();
            for (float s = 0; s < 30; s += 0.1f)
            {
                var p = at + outward * s;
                if (ts.GroundY(p.x, p.y) <= LavaY + 0.65f) return (G(p), outward);
            }
            return (G(at), outward);
        }

        /// <summary>堤肩上地面比熔岩高 0.65 m 的点与指向熔岩的水平方向（side = ±1 选左右）</summary>
        static (Vector3 at, Vector2 outward) KnockEdge(Way w, float t, int side)
        {
            var c = w.path.At(t);
            var tan = w.path.TangentAt(t);
            var n = new Vector2(-tan.y, tan.x) * side;
            for (float sd = w.half; sd <= w.half + w.shoulder + 2; sd += 0.05f)
            {
                var p = c + n * sd;
                if (ts.GroundY(p.x, p.y) <= LavaY + 0.65f) return (G(p), n);
            }
            return (G(c + n * (w.half + 0.8f)), n);
        }

        static Vector2 SiteCenter(int site) => site switch
        {
            1 => FerryC, 2 => TollC, 3 => AnchorC, 4 => GateC, 5 => GuardSite, 11 => RoadsideA, 12 => RoadsideB, 13 => RoadsideC, _ => Vector2.zero,
        };

        /// <summary>
        /// 遭遇（maps/3-1.md §5，编组库 InfernoSquads）：必清 4（① 13 / ② 10 / ③ 11 / ④ 12 = 46，精英 ③④ 各写死 1），
        /// 路遇 3（a 之字坡必经、b 高路 / c 石林二选一），⑤ 熔铸遗址守军（可选，藏宝 B 调查惊动）。每个编排过一遍 <see cref="InfernoSquads.Check"/>
        /// </summary>
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
                site.requires = Array.Empty<EncounterSite>();
                var list = new List<Transform>();
                foreach (var a in Anchors)
                    if (a.site == index)
                        list.Add(markers.Find(a.name));
                foreach (var m in ModeAnchors)
                    if (m.site == index)
                        list.Add(markers.Find(m.name));
                list.RemoveAll(t => !t);
                site.anchors = list.ToArray();
                return site;
            }

            var s1 = Site(1, "渡口关楼", FerryC, 20, 26, EncounterSpec.Of(
                    G02(),
                    G01().After(1, 1.6f))
                .Gather(0.6f).Distance(10, 30), "weapon", new Vector3(3, 0, 3));
            var s2 = Site(2, "税关墩", TollC, 20, 24, EncounterSpec.Of(
                    G03(tuo: 1, mamian: 0, tantong: 3).Named("湖中伏鼍").Hint("火鼍潜在墩边的熔岩里——别背对熔岩站，引它上岸打脊背"),
                    G03(tuo: 0, mamian: 1, tantong: 3).Plus(EncounterSpec.E(Huodou, 2).As(StationRole.Flank).Via(SpawnMode.Gate)).Named("狱卒巡岸")
                        .Hint("马面在税亭台上甩勾魂索——射断链子，别站在它和熔岩之间").After(1, 1.8f))
                .Gather(0.6f).Distance(10, 30), "scroll", new Vector3(4, 0, -9));
            var s3 = Site(3, "锚链大墩", AnchorC, 21, 26, EncounterSpec.Of(
                    G04(),
                    G05(mamian: 2, huodou: 2, tantong: 0, eliteAffix: Shielded).Hint("精英狱卒带护盾——先破盾，锁链台上看得清整座墩").After(1, 2f))
                .Gather(0.6f).Distance(10, 32), "weapon:min=1", new Vector3(0, 0, -12));
            var s4 = Site(4, "宫门瓮城", GateC, 20, 26, EncounterSpec.Of(
                    EncounterSpec.Wave("守城",
                            EncounterSpec.E(Mamian, 2).As(StationRole.Ranged).Via(SpawnMode.Drop),
                            EncounterSpec.E(Tantong, 3).Via(SpawnMode.LavaCrawl),
                            EncounterSpec.E(Tuo, 1).Via(SpawnMode.LavaCrawl).NoHoldBack())
                        .Hint("马面从城墙上跳下来，火鼍在护城渠里——上到上场，离渠远一点"),
                    G02(huodou: 4, tantong: 0, eliteAffix: Swift).Plus(EncounterSpec.E(Bifang, 2).As(StationRole.Precision).Via(SpawnMode.FlyIn))
                        .Named("宫门增援").Hint("宫门熔铁闸升起，精英祸斗领着黑犬冲出来——毕方落在鼓楼上").After(1, 2f))
                .Gather(0.6f).Distance(10, 32), "upgrade", new Vector3(-8, 0, 2));
            var s5 = Site(5, "熔铸遗址守军", GuardSite, 12, 14, EncounterSpec.Of(
                    EncounterSpec.Wave("熔铸遗址守军", EncounterSpec.E(Huodou, 2), EncounterSpec.E(Tantong, 3), EncounterSpec.E(Mamian, 1).Elite(Frenzied))
                        .Hint("守着熔铸遗藏的一小队——精英马面狂暴了别拖"))
                .Gather(0.4f).Distance(6, 22), "", Vector3.zero);
            s5.autoTrigger = false;
            s5.optional = true;

            var ra = Site(11, "之字坡 · 余烬", RoadsideA, 12, 14, EncounterSpec.Of(G01(tantong: 4, huodou: 0)).Gather(0.3f).Distance(7, 22), "", Vector3.zero).AsRoadside(12f, 14f);
            var rb = Site(12, "崖腰 · 栖柱", RoadsideB, 12, 16, EncounterSpec.Of(G04(bifang: 2, tantong: 3)).Gather(0.3f).Distance(8, 26), "", Vector3.zero).AsRoadside(12f, 16f);
            var rc = Site(13, "石林 · 熔流伏兵", RoadsideC, 11, 14, EncounterSpec.Of(G11()).Gather(0.3f).Distance(7, 24), "", Vector3.zero).AsRoadside(11f, 14f);

            rep.Section("编组（InfernoSquads 自查：每波 ≤ 3 种、远程 ≤ 3）");
            int bad = 0;
            foreach (var s in new[] { s1, s2, s3, s4, s5, ra, rb, rc })
            {
                bad += InfernoSquads.Check(s.spec, s.title, rep.Fail);
                rep.Line($"· {s.title}{(s.roadside ? "（路遇）" : s.optional ? "（可选）" : "")}：{s.spec.Total} 只 — " +
                         string.Join("；", s.spec.waves.Select(InfernoSquads.Describe)));
            }
            int required = s1.spec.Total + s2.spec.Total + s3.spec.Total + s4.spec.Total;
            int elites = new[] { s1, s2, s3, s4 }.Sum(s => s.spec.waves.Sum(w => w.entries.Where(e => e.elite).Sum(e => e.count)));
            string sum = $"必清 4 处 {required} 只、精英 {elites}；路遇 3 处 {ra.spec.Total + rb.spec.Total + rc.spec.Total} 只；可选 {s5.spec.Total} 只";
            if (bad == 0 && required >= 40 && required <= 50 && elites == 2) rep.Line($"✓ {sum}");
            else rep.Fail($"{sum}（要求每波 ≤ 3 种 / 远程 ≤ 3、必清约 46、精英 2）");

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "破熔湖关隘";
            objective.required = new[] { s1, s2, s3, s4 };
            objective.optional = new[] { s5 };
            objective.autoCollect = false;
            return objective;
        }

        /// <summary>藏宝（CachePOI）：A 湖心石龛（无守军，三块跳石；秘卷）；B 熔铸遗藏（东崖龛，调查惊动 ⑤ 守军，武器保底精良）</summary>
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
                if (!IsPlaceholder(model)) model.transform.SetPositionAndRotation(At(mAt, at.y - 0.05f), Quaternion.Euler(0, YawZ(face), 0));
                model.name = "Model";
            }
            Cache("湖心石龛", G(IsletC), new Vector2(1, -0.3f), "scroll", null, HoardId, new Vector2(-1.2f, 1.2f), 0.8f, 10);
            Cache("熔铸遗藏", G(CacheB), Vector2.left, "weapon:min=1", guard, CrucibleId, new Vector2(2.5f, 0), 1.8f, 12);
        }

        /// <summary>出口传送门：嵌在宫门神龛正面（没有神龛模型时自己立门框），目标完成后升起；下一关读 RunPlan = 3-2</summary>
        static ExitPortal BuildExit(Transform markers, Transform arch, LevelObjective objective)
        {
            var shrine = Put(ShrineId, arch, ShrineAt, 180, 1, 0.1f);
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
        /// 熔湖关隘（maps/3-1.md §8）：堤与路高出熔岩、沿路坡度；陆块顶面高度；只走非熔岩区从出生点到各场地 / 石龛 / 出口的路径完整；
        /// 断堤断口 ≥ 11 m（二段跳也过不去）；火鼍网格只在熔岩里；各击退点往外是熔岩、人形导航网格连到 Lava 区；各场地的熔岩占比（≤ 35%）
        /// </summary>
        static void CheckPass(LevelKit.Report rep, LavaVolume lava)
        {
            rep.Section("熔湖关隘（3-1）");
            foreach (var w in Ways)
            {
                float lowest = float.MaxValue, worst = 0;
                Vector2 worstAt = default;
                for (float sd = 0; sd <= w.path.length; sd += 1f)
                {
                    var p = w.path.At(sd / w.path.length);
                    lowest = Mathf.Min(lowest, ts.GroundY(p.x, p.y));
                    var q = w.path.At(Mathf.Min(1, (sd + 2f) / w.path.length));
                    float run = Vector2.Distance(p, q);
                    if (run < 0.5f) continue;
                    float g = Mathf.Atan(Mathf.Abs(ts.GroundY(q.x, q.y) - ts.GroundY(p.x, p.y)) / run) * Mathf.Rad2Deg;
                    if (g > worst) { worst = g; worstAt = p; }
                }
                string msg = $"{w.id} {w.label}：长 {w.path.length:F0} m、宽 {w.half * 2:F0} m，最低处高出熔岩 {lowest - LavaY:F2} m，沿路最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})";
                if (lowest - LavaY < 0.6f || (worst > 16f && w != BrokenS)) rep.Fail($"{msg}（要求 ≥ 0.6 m、≤ 16°）");
                else rep.Line($"✓ {msg}");
            }
            {
                float worst = 0;
                for (float sd = 0; sd + 2 <= Zigzag.length; sd += 1f)
                {
                    var p = Zigzag.At(sd / Zigzag.length);
                    var q = Zigzag.At((sd + 2) / Zigzag.length);
                    float run = Vector2.Distance(p, q);
                    if (run < 0.5f) continue;
                    worst = Mathf.Max(worst, Mathf.Atan(Mathf.Abs(ts.GroundY(q.x, q.y) - ts.GroundY(p.x, p.y)) / run) * Mathf.Rad2Deg);
                }
                string msg = $"之字坡：长 {Zigzag.length:F0} m，+{G(Spawn).y:F0} → +{G(Zigzag.At(1)).y:F0}，沿路最陡 {worst:F0}°";
                if (worst > 18f) rep.Fail($"{msg}（≤ 18°）");
                else rep.Line($"✓ {msg}");
            }
            // 断口：南段堤头的堤面边 → 御道堤面边（二段跳同高最远 15.3 m，御道还高 2 m：断口 ≥ 15.5 m 才跳不过去）
            var head = BrokenS.path.At(1);
            float gap = Road.path.Nearest(head).dist - Road.half - BrokenS.half;
            if (gap < 15.5f) rep.Fail($"断堤断口 {gap:F1} m（< 15.5 m，二段跳跳得过去）");
            else rep.Line($"✓ 断堤断口 {gap:F1} m（堤面到御道堤面；看得见、到不了：逼玩家选高 / 低路）");

            int area = LevelKit.LavaNavArea;
            var dry = LavaField.WalkerFilter(area >= 0 ? NavMesh.AllAreas & ~(1 << area) : NavMesh.AllAreas);
            if (area < 0) rep.Warn("NavMesh 没有 Lava 区域：非熔岩路径与击退检查按全部区域算");
            var swim = LevelKit.LavaSwimmerAgentType();
            if (swim.HasValue)
            {
                var swimAll = new NavMeshQueryFilter { agentTypeID = swim.Value, areaMask = NavMesh.AllAreas };
                var dryProbes = new (string name, Vector3 at)[]
                {
                    ("① 码头", G(FerryC)), ("② 码头", G(TollC + new Vector2(-6, 0))), ("③ 码头", G(new Vector2(34, 44))), ("④ 上场", G(new Vector2(-20, 96))),
                    ("C1 堤面", G(C1.path.At(0.5f))), ("御道", G(Road.path.At(0.5f))),
                };
                var wet = dryProbes.Where(d => NavMesh.SamplePosition(d.at, out _, 1.5f, swimAll)).Select(d => d.name).ToList();
                if (wet.Count > 0) rep.Fail($"火鼍（LavaSwimmer）的导航网格铺到了干地上：{string.Join("、", wet)}");
                else rep.Line($"✓ 火鼍的导航网格只在熔岩里（{dryProbes.Length} 处干地 1.5 m 内都采不到）");
                if (!NavMesh.SamplePosition(At(new Vector2(-24, 63), 0), out _, 3f, swimAll)) rep.Fail("火鼍的导航网格在护城熔渠 (−24, 63) 采不到（④ 第一波火鼍在这里）");
                else rep.Line("✓ 护城熔渠里有火鼍的导航网格");
            }
            if (!NavMesh.SamplePosition(G(Spawn), out var sh, 4, dry)) rep.Fail("出生点 4 m 内没有非熔岩的导航网格");
            else
            {
                var goals = new (string name, Vector3 at)[]
                {
                    ("① 渡口关楼", G(FerryC)), ("① 关楼城台", GatehouseTops.Count > 0 ? GatehouseTops[0] : At(GatehouseC, QuayY + 8f)), ("② 税关墩", G(TollC)), ("② 税亭台", G(TollTerrace.c)),
                    ("③ 锚链大墩", G(AnchorC)), ("③ 锁链台", G(ChainDeck.c)), ("高路 · 路遇 b", G(RoadsideB)), ("⑤ 熔铸遗址", G(GuardSite)),
                    ("湖心石龛（跳石）", G(IsletC)), ("④ 宫门瓮城", G(GateC)), ("④ 鼓楼台", G(DrumW.c)), ("出口", G(ShrineAt + new Vector2(0, -3))),
                };
                foreach (var (gname, at) in goals)
                {
                    var path = new NavMeshPath();
                    bool ok = NavMesh.SamplePosition(at, out var gh, 4, dry) && NavMesh.CalculatePath(sh.position, gh.position, dry, path) &&
                              path.status == NavMeshPathStatus.PathComplete;
                    float len = 0;
                    for (int i = 0; i + 1 < path.corners.Length; i++) len += Vector3.Distance(path.corners[i], path.corners[i + 1]);
                    // 石龛隔着跳石：导航网格不连，允许不完整（玩家跳过去，主线不经过）
                    if (ok) rep.Line($"✓ 出生点 → {gname}：只走非熔岩区 {len:F0} m");
                    else if (gname.StartsWith("湖心石龛")) rep.Line($"· 出生点 → {gname}：导航不连（跳石，支路）");
                    else rep.Fail($"出生点 → {gname}：只走非熔岩区走不到（{path.status}，最远到 {(path.corners.Length > 0 ? LevelContext.At(path.corners[^1]) : "—")}）");
                }
            }

            // ④ 御道坡剖面（诊断）：沿 x = −21 从下场到上场，每 2 m 的地面高、导航网格高、从下场东侧能不能走到
            if (NavMesh.SamplePosition(G(new Vector2(-16, 79)), out var lowE, 3, dry))
            {
                var cells = new List<string>();
                for (float z = 72; z <= 94; z += 2)
                {
                    var q = new Vector2(-21, z);
                    var path = new NavMeshPath();
                    bool on = NavMesh.SamplePosition(G(q), out var nh, 1.5f, dry);
                    bool ok = on && NavMesh.CalculatePath(lowE.position, nh.position, dry, path) && path.status == NavMeshPathStatus.PathComplete;
                    cells.Add($"z{z:0}:{ts.GroundY(q.x, q.y):F1}{(on ? $"/{nh.position.y:F1}" : "/—")}{(ok ? "✓" : "✗")}");
                }
                rep.Line($"· ④ 御道坡剖面（x −21，地面 / 导航 / 从吊桥北头走到）：{string.Join(" ", cells)}");
            }

            // 击退点：往外 2.5 m 是熔岩，人形导航网格从标记连到 Lava 区
            foreach (var name in new[] { "Knock_Edge", "Knock_Edge_1", "Knock_Edge_2", "Knock_Edge_3", "Knock_Edge_4" })
            {
                var knock = GameObject.Find(name);
                if (!knock)
                {
                    rep.Fail($"没有 {name} 标记");
                    continue;
                }
                var kp = knock.transform.position;
                var kd = knock.transform.forward;
                var outside = kp + kd * 2.5f;
                float og = ts.GroundY(outside.x, outside.z);
                bool lavaGeom = og <= LavaY + LavaTuning.StandRise && lava && lava.Body.Contains(outside.x, outside.z);
                string where = $"{name} {LevelContext.At(kp)} 地面 y {kp.y:F2}，往外 2.5 m 地面 y {og:F2}";
                if (!lavaGeom) rep.Fail($"{where}：往外不是熔岩");
                else if (area < 0) rep.Line($"· {where}（没有 Lava 区域，导航连通没查）");
                else
                {
                    var path = new NavMeshPath();
                    bool from = NavMesh.SamplePosition(kp, out var kh, 1.5f, LavaField.WalkerFilter());
                    bool to = NavMesh.SamplePosition(outside + Vector3.up * 0.3f, out var lh, 2f, LavaField.WalkerFilter(1 << area));
                    bool linked = from && to && NavMesh.CalculatePath(kh.position, lh.position, LavaField.WalkerFilter(), path) && path.status == NavMeshPathStatus.PathComplete;
                    if (linked) rep.Line($"✓ {where}：导航网格连到 Lava 区（击退推得下去）");
                    else rep.Fail($"{where}：导航网格连不到 Lava 区（起点 {from}、熔岩点 {to}、路径 {path.status}）");
                }
            }
            // 风险 4：堤道段立面（断堤南段）——立面外是不是熔岩、导航连不连（击退走 agent.Move，只沿导航网格推）
            var facade = GameObject.Find("Facade_Edge");
            if (facade && area >= 0)
            {
                var fp = facade.transform.position;
                var fo = fp + facade.transform.forward * 2.5f;
                var path = new NavMeshPath();
                bool from = NavMesh.SamplePosition(fp, out var fh, 1.5f, LavaField.WalkerFilter());
                bool to = NavMesh.SamplePosition(fo, out var lh2, 2f, LavaField.WalkerFilter(1 << area));
                bool linked = from && to && NavMesh.CalculatePath(fh.position, lh2.position, LavaField.WalkerFilter(), path) && path.status == NavMeshPathStatus.PathComplete;
                rep.Line($"· 风险 4 · 堤道段立面（断堤南段，堤道段顶 = 堤面，外侧 1 m 陡肩）：立面边 → 外侧熔岩的导航{(linked ? "连通" : "不连")}" +
                         "（击退走 agent.Move，只沿导航网格推；实测见 map-3-1 的「立面击退」）");
            }

            // 各场地的熔岩占比（ch3-v2 2.7：战斗场地 ≤ 35%）：场地圆里按 1 m 栅格数地面低于熔岩面 + 0.3 的格
            foreach (var (sname, c, r) in new[] { ("① 渡口关楼", FerryC, 23f), ("② 税关墩", TollC, 22f), ("③ 锚链大墩", AnchorC, 24f), ("④ 宫门瓮城", GateC, 24f) })
            {
                int n = 0, wet = 0;
                for (float x = -r; x <= r; x += 1)
                for (float z = -r; z <= r; z += 1)
                {
                    if (x * x + z * z > r * r) continue;
                    var p = c + new Vector2(x, z);
                    if (Inside(p) < 0) continue;
                    n++;
                    if (ts.GroundY(p.x, p.y) < LavaY + 0.3f) wet++;
                }
                float share = n > 0 ? wet / (float)n : 0;
                string msg = $"{sname}：熔岩占场地 {share:P0}（{wet}/{n} m²，直径 {r * 2:F0} m）";
                if (share > 0.35f) rep.Fail($"{msg}（≤ 35%）");
                else rep.Line($"✓ {msg}");
            }
            // 全图熔岩与干地
            {
                int lavaN = 0, dryN = 0;
                for (float x = -76; x <= 88; x += 1)
                for (float z = -88; z <= 114; z += 1)
                {
                    var p = new Vector2(x, z);
                    if (Inside(p) < 0) continue;
                    if (ts.GroundY(x, z) < LavaY + 0.3f) lavaN++;
                    else dryN++;
                }
                rep.Line($"全图（崖内）：熔岩 {lavaN:N0} m²（{lavaN / (float)Mathf.Max(1, lavaN + dryN):P0}），干地 {dryN:N0} m²（含之字坡、高路、台的坡面）");
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
            int destructibles = Count<Destructible>();
            rep.Line($"遭遇场地 {sites}（必清 4 + 可选 1 + 路遇 3），熔岩 {lavas} 片，藏宝 {caches}，出口 {portals}，栖落点 {perches}，可破坏 {destructibles}");
            if (sites != 8) rep.Fail($"遭遇场地有 {sites} 个（应为 8）");
            if (lavas != 1) rep.Fail($"熔岩有 {lavas} 片（应为 1）");
            if (caches != 2) rep.Fail($"藏宝点有 {caches} 处（应为 2）");
            if (destructibles < 5) rep.Fail($"可破坏件只有 {destructibles} 件（① 货堆 2 + 补给坩埚 3）");
            if (portals != 1 || !portal || !portal.objective) rep.Fail($"出口传送门 {portals} 个（应 1，且接上 LevelObjective）");
            else rep.Line($"✓ 出口传送门在宫门神龛前；下一关 {RunPlan.Next(RunPlan.Get("3-1"))?.Label ?? "?"}");
            if (perches < 10) rep.Fail($"栖落点只有 {perches} 处（应 ≥ 10）");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>主线路点（L5 主线连通按这串量；引导灯沿它摆）</summary>
        static (string name, Vector2 at)[] RouteXZ() => new[]
        {
            ("出生 · 火口眺台", Spawn), ("之字坡第一折", new Vector2(-48, -68)), ("之字坡第二折", new Vector2(-4, -56)),
            ("① 渡口码头", new Vector2(-36, -40)), ("① 关楼门洞", GatehouseC), ("C1 关楼堤", C1.path.At(0.5f)),
            ("② 税关墩", new Vector2(10, 6)), ("② 东头", new Vector2(28, 12)), ("石林堤", Stoneforest.path.At(0.5f)),
            ("③ 下码头", new Vector2(44, 38)), ("③ 鼎台", Cauldron.c + new Vector2(-5, -4)), ("③ 西北角", new Vector2(32, 62)),
            ("补给 · 御道坡脚", SupplyAt), ("吊桥南头", BridgeS), ("④ 下场", new Vector2(-16, 79)),
            ("④ 上场", new Vector2(-21, 93)), ("出口", ShrineAt + new Vector2(0, -3)),
        };

        /// <summary>
        /// 青金引导灯（S6，ch3-v2 2.3：只放在主路上、每 25–40 m 一盏；熔岩橙不指路）：沿主线路点之间只走非熔岩区的导航路径每 30 m 一盏，
        /// 站在路右侧 2.8 m；落在熔岩里、台边、场地正中的跳过。吊桥两头各一盏桥头灯
        /// </summary>
        static void BuildGuideLamps(Transform parent)
        {
            var root = new GameObject("引导灯 · 主路").transform;
            root.SetParent(parent, false);
            int area = LevelKit.LavaNavArea;
            var dry = LavaField.WalkerFilter(area >= 0 ? NavMesh.AllAreas & ~(1 << area) : NavMesh.AllAreas);
            var route = RouteXZ();
            var corners = new List<Vector3>();
            for (int i = 0; i + 1 < route.Length; i++)
            {
                var path = new NavMeshPath();
                if (!NavMesh.SamplePosition(G(route[i].at), out var a, 4, dry) || !NavMesh.SamplePosition(G(route[i + 1].at), out var b, 4, dry)) continue;
                if (!NavMesh.CalculatePath(a.position, b.position, dry, path)) continue;
                foreach (var c in path.corners)
                    if (corners.Count == 0 || Vector3.Distance(corners[^1], c) > 0.5f) corners.Add(c);
            }
            var spots = new List<(Vector3 at, float yaw)>();
            foreach (var (at, yaw) in LevelKit.GuideTrail(corners, 30f, 14f, 12f, 2.8f))
            {
                var q = new Vector2(at.x, at.z);
                var g = G(q);
                if (g.y < LavaY + 0.8f || Mathf.Abs(g.y - at.y) > 1.2f) continue;
                bool inSite = false;
                foreach (var c in new[] { FerryC, TollC, AnchorC, GateC })
                    inSite |= Vector2.Distance(q, c) < 8f;
                if (inSite) continue;
                spots.Add((g, yaw));
            }
            var lamps = LevelKit.GuideLamps(Dir, root, spots);
            var mid = (BridgeS + BridgeN) * 0.5f;
            var along = (BridgeN - BridgeS).normalized;
            lamps.AddRange(LevelKit.GuideBridgeHeads(Dir, root, mid, along, Vector2.Distance(BridgeS, BridgeN), BridgeW, (G(BridgeS).y + G(BridgeN).y) * 0.5f + 0.05f));
            Debug.Log($"[Level] 3-1 引导灯：主路 {spots.Count} 盏 + 吊桥头 2 盏（共 {lamps.Count}）");
        }

        // ───────────── 验收声明 ─────────────
        /// <summary>
        /// 构图自查（用户的构图要求：节奏感、留白、尺度对比）——只出数字和提醒，不算不合格：
        ///   1) 收放：沿主线（只走非熔岩区的导航路径）每 5 m 量一次左右可走宽度（导航射线，各 ≤ 30 m），窄 ＜ 14 m、开 ≥ 24 m，列出收放段落；同一档连续超过 90 m 提醒；
        ///   2) 巨型剪影：主线每 10 m 站一次（眼高 1.62 m），看不看得见崖顶祝融像 / 宫门神龛（物理射线，碰到的点离目标 ≤ 4 m 算看见）；
        ///   3) 小件成簇：每个必清场地里的小件（Prefab 根和可破坏物、包围盒最长边 ≤ 4 m），包围盒间隙 ≤ 3 m 连成一簇，报簇数、单件数和 Clark–Evans 比（＜ 1 成簇、≈ 1 随机、＞ 1 均匀），＞ 1.15 提醒
        /// </summary>
        static void CheckComposition(LevelKit.Report rep, Vector3 statueHead, Transform arch, Transform props)
        {
            rep.Section("构图自查（收放 / 巨型剪影 / 小件成簇）");
            int area = LevelKit.LavaNavArea;
            var dry = LavaField.WalkerFilter(area >= 0 ? NavMesh.AllAreas & ~(1 << area) : NavMesh.AllAreas);
            var route = RouteXZ();
            var pts = new List<Vector3>();
            var path = new NavMeshPath();
            for (int i = 0; i + 1 < route.Length; i++)
            {
                if (!NavMesh.SamplePosition(G(route[i].at), out var a, 4f, dry) || !NavMesh.SamplePosition(G(route[i + 1].at), out var b, 4f, dry)) continue;
                if (!NavMesh.CalculatePath(a.position, b.position, dry, path) || path.corners.Length < 2) continue;
                if (pts.Count == 0) pts.Add(path.corners[0]);
                for (int k = 1; k < path.corners.Length; k++) pts.Add(path.corners[k]);
            }
            // 等距重采样（5 m）
            var samples = new List<(Vector3 p, Vector3 dir, float at)>();
            float acc = 0, next = 0;
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                var seg = pts[i + 1] - pts[i];
                float len = new Vector2(seg.x, seg.z).magnitude;
                if (len < 1e-3f) continue;
                var dir = new Vector3(seg.x, 0, seg.z) / len;
                while (next <= acc + len)
                {
                    samples.Add((Vector3.Lerp(pts[i], pts[i + 1], (next - acc) / len), dir, next));
                    next += 5f;
                }
                acc += len;
            }
            if (samples.Count < 4)
            {
                rep.Warn($"构图自查：主线采样只有 {samples.Count} 个点，跳过");
                return;
            }

            // 1) 收放：15 m 半径圆盘里（1.5 m 一格）同层（高差 ≤ 2.5 m）非熔岩可走面的比例——堤、之字坡、门洞读成窄，场地读成开
            float Openness(Vector3 p)
            {
                int tot = 0, ok = 0;
                for (float dx = -15f; dx <= 15f; dx += 1.5f)
                for (float dz = -15f; dz <= 15f; dz += 1.5f)
                {
                    if (dx * dx + dz * dz > 225f) continue;
                    tot++;
                    if (NavMesh.SamplePosition(p + new Vector3(dx, 0, dz), out var h, 1.2f, dry) && Mathf.Abs(h.position.y - p.y) <= 2.5f) ok++;
                }
                return tot > 0 ? (float)ok / tot : 0;
            }
            var runs = new List<(string kind, float from, float to)>();
            float openSum = 0;
            foreach (var (p, dir, at) in samples)
            {
                float o = Openness(p);
                openSum += o;
                string kind = o < 0.4f ? "窄" : o >= 0.65f ? "开" : "中";
                if (runs.Count > 0 && runs[^1].kind == kind) runs[^1] = (kind, runs[^1].from, at + 5f);
                else runs.Add((kind, at, at + 5f));
            }
            // 不到 10 m 的小段并进前一段（一个掩体挡一下不算收）
            var merged = new List<(string kind, float from, float to)>();
            foreach (var r in runs)
            {
                if (merged.Count > 0 && (r.to - r.from < 10f || merged[^1].kind == r.kind)) merged[^1] = (merged[^1].kind, merged[^1].from, r.to);
                else merged.Add(r);
            }
            int narrow = merged.Count(r => r.kind == "窄"), open = merged.Count(r => r.kind == "开");
            var longest = merged.OrderByDescending(r => r.to - r.from).First();
            rep.Line($"收放（15 m 圆盘可走比例，窄 ＜ 40%、开 ≥ 65%，平均 {100f * openSum / samples.Count:F0}%）：主线 {acc:F0} m 分成 {merged.Count} 段（窄 {narrow}、开 {open}、中 {merged.Count - narrow - open}）：" +
                     string.Join(" → ", merged.Select(r => $"{r.kind}{r.to - r.from:F0}")) +
                     $"；最长一段「{longest.kind}」{longest.to - longest.from:F0} m（{longest.from:F0}–{longest.to:F0} m）");
            if (longest.to - longest.from > 90f) rep.Warn($"收放：同一宽度档连续 {longest.to - longest.from:F0} m（{longest.kind}，{longest.from:F0}–{longest.to:F0} m）");
            else rep.Line("✓ 收放交替：没有连续超过 90 m 的同一宽度档");

            // 2) 巨型剪影
            var shrineLintel = At(ShrineAt, UpperWard.TopY + DesignSize[ShrineId].y * 0.8f);
            var targets = new (string name, Vector3 at)[] { ("崖顶祝融像", statueHead), ("宫门神龛", shrineLintel) };
            int stations = 0, either = 0;
            var seen = new int[targets.Length];
            for (int i = 0; i < samples.Count; i += 2)
            {
                var eye = samples[i].p + Vector3.up * 1.62f;
                stations++;
                bool any = false;
                for (int t = 0; t < targets.Length; t++)
                {
                    bool vis = !Physics.Linecast(eye, targets[t].at, out var hit, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore) ||
                               Vector3.Distance(hit.point, targets[t].at) <= 4f;
                    if (!vis) continue;
                    seen[t]++;
                    any = true;
                }
                if (any) either++;
            }
            rep.Line($"巨型剪影：主线 {stations} 个站点（每 10 m）——" + string.Join("、", targets.Select((t, k) => $"看得见{t.name} {100f * seen[k] / stations:F0}%")) +
                     $"，两者至少一个 {100f * either / stations:F0}%");
            if (either < stations * 0.6f) rep.Warn($"巨型剪影：主线上只有 {100f * either / stations:F0}% 的位置看得见祝融像或宫门（目标 ≥ 60%）");
            else rep.Line("✓ 巨型剪影：主线多数位置看得见祝融像或宫门");

            // 引导线：每条堤 / 路从起点到终点的走向，和从终点望宫门的方向的夹角（≤ 30° 算收敛到宫门）
            var gate2 = PalaceGate;
            var lines = new List<string>();
            int converge = 0;
            foreach (var w in Ways)
            {
                var a0 = w.path.At(0f);
                var a1 = w.path.At(1f);
                var d = a1 - a0;
                var toGate = gate2 - a1;
                if (Vector2.Dot(d, toGate) < 0 && (gate2 - a0).sqrMagnitude < toGate.sqrMagnitude)
                {
                    (a0, a1) = (a1, a0);
                    d = -d;
                    toGate = gate2 - a1;
                }
                float ang = Vector2.Angle(d, toGate);
                if (ang <= 30f) converge++;
                lines.Add($"{w.id} {w.label} {ang:F0}°");
            }
            rep.Line($"引导线：堤 / 路走向与望宫门方向的夹角——{string.Join("、", lines)}；≤ 30°（收敛到宫门）{converge}/{Ways.Length} 条");

            // 3) 小件成簇
            var smalls = new List<Bounds>();
            foreach (var root in new[] { arch, props })
            {
                if (!root) continue;
                foreach (var tr in root.GetComponentsInChildren<Transform>(true))
                {
                    if (!PrefabUtility.IsAnyPrefabInstanceRoot(tr.gameObject) && !tr.GetComponent<Destructible>()) continue;
                    if (tr.parent && tr.parent.GetComponentInParent<Destructible>()) continue;
                    var rs = tr.GetComponentsInChildren<Renderer>();
                    if (rs.Length == 0) continue;
                    var bb = rs[0].bounds;
                    foreach (var r in rs) bb.Encapsulate(r.bounds);
                    if (Mathf.Max(bb.size.x, Mathf.Max(bb.size.y, bb.size.z)) > 4f) continue;
                    smalls.Add(bb);
                }
            }
            static float Flat2(Vector3 a, Vector3 b) => Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));
            // 掩体高度分级（composition.md 第 6 节第 2、6 条）：可翻越 ≤ 1.0 m、半掩 1.0–1.45 m、全掩 ≥ 2.3 m，中间的 1.45–2.3 m 是「看着像半掩、其实挡头」的含糊档；
            // 高 1.45–2.6 m、水平最宽 ≤ 1.4 m 的竖件在中景剪影上像人
            var tiers = new List<string>();
            var vague = new List<string>();
            var humanoid = new List<string>();
            foreach (var root in new[] { arch, props })
            {
                if (!root) continue;
                foreach (var tr in root.GetComponentsInChildren<Transform>(true))
                {
                    bool prefab = PrefabUtility.IsAnyPrefabInstanceRoot(tr.gameObject);
                    if (!prefab && !tr.GetComponent<Destructible>()) continue;
                    if (tr.parent && tr.parent.GetComponentInParent<Destructible>()) continue;
                    var rs = tr.GetComponentsInChildren<Renderer>();
                    if (rs.Length == 0) continue;
                    var bb = rs[0].bounds;
                    foreach (var r in rs) bb.Encapsulate(r.bounds);
                    bool inSite = Object.FindObjectsByType<EncounterSite>(FindObjectsInactive.Include)
                        .Any(x => !x.optional && !x.roadside && Flat2(bb.center, x.transform.position) <= x.arenaRadius);
                    if (!inSite) continue;
                    float h = bb.size.y, wide = Mathf.Max(bb.size.x, bb.size.z), thin = Mathf.Min(bb.size.x, bb.size.z);
                    string name = tr.name.Replace("(Clone)", "").Trim();
                    if (h > 1.45f && h < 2.3f && wide > 1.4f) vague.Add($"{name} {h:F2} m");
                    if (h >= 1.45f && h <= 2.6f && wide <= 1.4f) humanoid.Add($"{name} {h:F2}×{wide:F2} m");
                    tiers.Add(h <= 1.0f ? "翻" : h <= 1.45f ? "半" : h >= 2.3f ? "全" : "糊");
                }
            }
            rep.Line($"掩体高度分级（必清场地里的件）：可翻越 {tiers.Count(t => t == "翻")}、半掩 {tiers.Count(t => t == "半")}、全掩 {tiers.Count(t => t == "全")}、含糊（1.45–2.3 m）{tiers.Count(t => t == "糊")}" +
                     (vague.Count > 0 ? $"——{string.Join("、", vague.Distinct())}" : ""));
            if (vague.Count > 0) rep.Warn($"掩体高度分级：{vague.Count} 件在 1.45–2.3 m 的含糊档");
            else rep.Line("✓ 掩体高度分级：没有含糊档的件");
            if (humanoid.Count > 0) rep.Warn($"中景假人形：{string.Join("、", humanoid.Distinct())}");
            else rep.Line("✓ 中景假人形：场地里没有 1.45–2.6 m 高、≤ 1.4 m 宽的竖件");
            foreach (var site in Object.FindObjectsByType<EncounterSite>(FindObjectsInactive.Include).Where(x => !x.optional && !x.roadside).OrderBy(x => x.name))
            {
                var c = site.transform.position;
                float r = site.arenaRadius;
                var inside = smalls.Where(q => Flat2(q.center, c) <= r).ToList();
                if (inside.Count < 3)
                {
                    rep.Line($"· {site.title}：小件 {inside.Count} 件（太少，不算成簇）");
                    continue;
                }
                float meanNn = 0;
                for (int i = 0; i < inside.Count; i++)
                {
                    float best = float.MaxValue;
                    for (int j = 0; j < inside.Count; j++)
                        if (j != i) best = Mathf.Min(best, Flat2(inside[i].center, inside[j].center));
                    meanNn += best;
                }
                meanNn /= inside.Count;
                float expected = 0.5f / Mathf.Sqrt(inside.Count / (Mathf.PI * r * r));
                float ce = meanNn / expected;
                // 单链聚类：包围盒水平间隙 ≤ 3 m 的连成一簇
                static float Gap(Bounds a, Bounds b) => Mathf.Max(0f, Mathf.Max(Mathf.Max(a.min.x - b.max.x, b.min.x - a.max.x), Mathf.Max(a.min.z - b.max.z, b.min.z - a.max.z)));
                var label = Enumerable.Range(0, inside.Count).ToArray();
                int Find(int x)
                {
                    while (label[x] != x) x = label[x] = label[label[x]];
                    return x;
                }
                for (int i = 0; i < inside.Count; i++)
                    for (int j = i + 1; j < inside.Count; j++)
                        if (Gap(inside[i], inside[j]) <= 3f) label[Find(j)] = Find(i);
                var groups = Enumerable.Range(0, inside.Count).GroupBy(Find).Select(g => g.Count()).ToList();
                int singles = groups.Count(g => g == 1);
                rep.Line($"· {site.title}：小件 {inside.Count} 件 → {groups.Count} 簇（最大 {groups.Max()} 件，单件 {singles}），Clark–Evans {ce:F2}");
                if (ce > 1.15f) rep.Warn($"小件成簇：{site.title} 的小件偏均匀（Clark–Evans {ce:F2}）");
            }
        }

        /// <summary>人形导航网格的一块（按顶点焊接分块）：面积、面积最大的三角形重心、包围盒、和出生点连不连通、玩家最省力怎么上去</summary>
        struct NavBlock
        {
            public Vector3 at;
            public float area;
            public Bounds bounds;
            public bool linked;
            public Move tier;
        }

        /// <summary>
        /// 导航分块（照搬 3-4 的 CheckNavIslands / 3-2 的 CheckSteps 的做法）：人形网格（<see cref="LevelContext.Walker"/>）按顶点焊接成块，
        /// 和出生点不连通的每块取面积最大的三角形重心，按可达性洪泛（附近 1.5 m、高差 0.8 m 内的可站立面档位）看玩家怎么上去。&lt; 0.25 m² 的碎块不算
        /// </summary>
        static List<NavBlock> NavBlocks(LevelContext ctx, Vector3 start)
        {
            var filter = LevelContext.Walker;
            var tri = NavMesh.CalculateTriangulation();
            var v = tri.vertices;
            var idx = tri.indices;
            var weld = new Dictionary<Vector3Int, int>();
            var root = new int[v.Length];
            for (int i = 0; i < v.Length; i++)
            {
                var key = new Vector3Int(Mathf.RoundToInt(v[i].x * 50f), Mathf.RoundToInt(v[i].y * 50f), Mathf.RoundToInt(v[i].z * 50f));
                if (!weld.TryGetValue(key, out int w)) weld[key] = w = i;
                root[i] = w;
            }
            int Find(int a)
            {
                while (root[a] != a) a = root[a] = root[root[a]];
                return a;
            }
            for (int t = 0; t + 2 < idx.Length; t += 3)
            {
                if ((filter.areaMask & (1 << tri.areas[t / 3])) == 0) continue;
                int a = Find(idx[t]), b = Find(idx[t + 1]), c = Find(idx[t + 2]);
                root[b] = a;
                root[Find(c)] = Find(a);
            }
            var blocks = new Dictionary<int, (float area, float best, Vector3 at, Bounds b)>();
            for (int t = 0; t + 2 < idx.Length; t += 3)
            {
                if ((filter.areaMask & (1 << tri.areas[t / 3])) == 0) continue;
                Vector3 a = v[idx[t]], b = v[idx[t + 1]], c = v[idx[t + 2]];
                float area = Vector3.Cross(b - a, c - a).magnitude * 0.5f;
                int k = Find(idx[t]);
                if (!blocks.TryGetValue(k, out var e)) e.b = new Bounds(a, Vector3.zero);
                e.area += area;
                e.b.Encapsulate(a);
                e.b.Encapsulate(b);
                e.b.Encapsulate(c);
                if (area > e.best)
                {
                    e.best = area;
                    e.at = (a + b + c) / 3f;
                }
                blocks[k] = e;
            }
            var reach = ctx.Reach;
            var list = new List<NavBlock>();
            foreach (var e in blocks.Values.OrderByDescending(b => b.area))
            {
                if (e.area < 0.25f) continue;
                if (!NavMesh.SamplePosition(e.at, out var hit, 0.3f, filter)) continue; // 不是人形代理的网格（火鼍）
                bool linked = LevelContext.NavPath(start, hit.position, out _) == NavMeshPathStatus.PathComplete;
                list.Add(new NavBlock { at = hit.position, area = e.area, bounds = e.b, linked = linked, tier = linked ? Move.Walk : ctx.TierAt(reach, hit.position, 1.5f, 0.8f) });
            }
            return list;
        }

        /// <summary>试烘的人形导航网格（设置同 <see cref="LevelKit.BakeNavMesh"/>，不存盘）：只用来找导航孤岛，用完删掉</summary>
        static Unity.AI.Navigation.NavMeshSurface ProbeNavMesh(Transform parent)
        {
            var go = new GameObject("NavMesh (probe)");
            go.transform.SetParent(parent, false);
            var nav = go.AddComponent<Unity.AI.Navigation.NavMeshSurface>();
            nav.collectObjects = Unity.AI.Navigation.CollectObjects.All;
            nav.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            nav.layerMask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
            nav.BuildNavMesh();
            return nav;
        }

        /// <summary>
        /// 导航孤岛自动处理（S1：出场站位要走得到玩家）：烘完人形网格后，玩家步行 / 跳 / 冲刺上得去、却和出生点不连通的块——道具顶面（平台块、吊鼎沿、城墙件顶）、
        /// 关楼门脸和石阶之间的夹缝、跳石——各盖一个不可走体块（NavMeshModifierVolume，包围盒外扩 0.2 m、上下各 0.4 m），返回盖了几块；调用方随后重烘。
        /// 玩家站在这些地方时，出生选点取的「玩家导航点」落到旁边连通的网格上，不再卡 6 s 放宽
        /// </summary>
        static int NoNavIslands(Transform world, Vector3 statueHead, LevelKit.Report rep)
        {
            var ctx = new LevelContext(Spec(statueHead));
            if (ctx.SpawnNav is not Vector3 start) return 0;
            var parent = new GameObject("NoNav · 导航孤岛").transform;
            parent.SetParent(world, false);
            int n = 0;
            var notes = new List<string>();
            foreach (var b in NavBlocks(ctx, start))
            {
                if (b.linked || b.tier > Move.Dash) continue;
                var go = new GameObject($"NoNav · {LevelContext.At(b.at)} y {b.at.y:F1}");
                go.transform.SetParent(parent, false);
                go.transform.position = b.bounds.center;
                var vol = go.AddComponent<Unity.AI.Navigation.NavMeshModifierVolume>();
                vol.size = b.bounds.size + new Vector3(0.4f, 0.8f, 0.4f);
                vol.center = Vector3.zero;
                vol.area = 1; // Not Walkable
                n++;
                notes.Add($"{LevelContext.At(b.at)} y {b.at.y:F1}（{b.area:F1} m²，{ReachFlood.Label(b.tier)}）");
            }
            if (n == 0) Object.DestroyImmediate(parent.gameObject);
            rep.Line(n > 0 ? $"导航孤岛：{n} 块台顶 / 夹缝盖成不进导航后重烘——{string.Join("；", notes)}" : "导航孤岛：没有要盖的");
            return n;
        }

        /// <summary>验收：玩家步行 / 跳 / 冲刺站得上去的地方没有导航孤岛（要么连通，要么不进导航）；只有二段跳上得去的提醒；玩家上不去的只列数</summary>
        static void CheckNavIslands(LevelKit.Report rep, Vector3 statueHead)
        {
            rep.Section("导航孤岛（台顶 / 台阶：要么连通，要么不进导航）");
            var ctx = new LevelContext(Spec(statueHead));
            if (ctx.SpawnNav is not Vector3 start)
            {
                rep.Fail("出生点附近没有导航网格");
                return;
            }
            int linked = 0, unreachable = 0, doubleJump = 0, bad = 0;
            var notes = new List<string>();
            foreach (var b in NavBlocks(ctx, start))
            {
                if (b.linked)
                {
                    linked++;
                    continue;
                }
                string at = $"{LevelContext.At(b.at)} y {b.at.y:F1}（{b.area:F1} m²）";
                if (b.tier <= Move.Dash)
                {
                    bad++;
                    rep.Fail($"导航孤岛 {at}：玩家{ReachFlood.Label(b.tier)}上得去，出场站位走不到（修坡连通，或这块顶面不进导航）");
                }
                else if (b.tier == Move.DoubleJump)
                {
                    doubleJump++;
                    rep.Warn($"导航孤岛 {at}：只有二段跳上得去");
                }
                else
                {
                    unreachable++;
                    if (notes.Count < 6) notes.Add(at);
                }
            }
            rep.Line($"人形导航网格 {linked} 块和出生点连通；孤岛：玩家上得去 {bad} 块、只有二段跳 {doubleJump} 块、玩家上不去 {unreachable} 块" +
                     (notes.Count > 0 ? $"（{string.Join("；", notes)}{(unreachable > notes.Count ? " …" : "")}）" : ""));
            if (bad == 0) rep.Line("✓ 玩家步行 / 跳 / 冲刺站得上去的地方没有导航孤岛（S1 出场站位都走得到玩家）");
        }

        /// <summary>
        /// 交给 L5 规则集的声明：主线路点（出生 → 之字坡 → ① → C1 → ② → 石林 → ③ → 补给 → 吊桥 → ④ → 宫门）、坡度路径、地标视线、
        /// 场地尺寸 / 掩体 / 层数 / 掩体可达 / 熔岩占比、主线节拍（S5 PacingCheck）。第三章 v2 地图件已到齐（66b52e57）：占位件按 Fail 验收。
        /// </summary>
        static LevelSpec Spec(Vector3 statueHead)
        {
            SiteSpec Site(string name, Vector2 c, float size, int cover = -1, int layers = -1, bool overlook = false, bool combat = true) =>
                new() { name = name, center = G(c), size = size, minCover = cover, minLayers = layers, overlook = overlook, combat = combat,
                    minCoverReach = combat && cover > 0 ? 0.8f : -1f, maxLavaShare = combat && cover > 0 ? 0.35f : -1f };
            var shrineLintel = At(ShrineAt, UpperWard.TopY + DesignSize[ShrineId].y * 0.8f);
            var gateTop = At(GatehouseC, QuayY + 12.4f);
            var hoard = G(IsletC + new Vector2(-1.2f, 1.2f), 1.0f);
            var cauldronTop = At(new Vector2(43, 52), Cauldron.TopY - 2.6f + DesignSize[CauldronBigId].y + 0.3f);
            var spec = new LevelSpec
                {
                    id = "3-1", title = "熔湖堤道", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = Bounds.EscapeMargin, placeholders = PlaceholderPolicy.Fail,
                    mapArea = new Rect(-80, -92, 172, 214),
                    sites =
                    {
                        Site("出生 · 火口眺台（缓冲）", Spawn, 20, combat: false),
                        Site("① 渡口关楼", FerryC, 46, cover: 6, layers: 3, overlook: true),
                        Site("② 税关墩", TollC, 42, cover: 6, layers: 3, overlook: true),
                        Site("③ 锚链大墩", AnchorC, 44, cover: 6, layers: 3, overlook: true),
                        Site("④ 宫门瓮城", GateC, 46, cover: 6, layers: 3, overlook: true),
                    },
                }

                .Sight("出生 → 祝融神像", G(Spawn, 1.62f), statueHead, 8, StatueId)
                .Sight("出生 → 宫门神龛", G(Spawn, 1.62f), shrineLintel, 6, ShrineId)
                .Sight("出生 → 关楼城台", G(Spawn, 1.62f), gateTop, 4)
                .Sight("出生 → 湖心石龛宝光", G(Spawn, 1.62f), hoard, 4)
                .Sight("② 断堤头 → 镇湖鼎", G(BrokenS.path.At(0.9f), 1.62f), cauldronTop, 4.5f)
                .Sight("③ 锁链台 → 宫门", G(ChainDeck.c, 1.62f), shrineLintel, 6, ShrineId)
                .Sight("④ 城墙走道 → 关楼（回望来路）", G(WallW.c + new Vector2(0, -10), 1.62f), gateTop, 5);
            foreach (var (rname, xz) in RouteXZ()) spec.Route(rname, G(xz));
            spec.Beat("出生 · 眺台", G(Spawn), BeatKind.Reveal, OverlookR)
                .Beat("路遇 a · 之字坡", G(RoadsideA), BeatKind.Roadside, 12)
                .Beat("① 渡口关楼", G(FerryC), BeatKind.Fight, 20)
                .Beat("② 税关墩", G(TollC), BeatKind.Fight, 20)
                .Beat("断堤揭示", G(BrokenS.path.At(0.9f)), BeatKind.Reveal)
                .Beat("路遇 c · 石林", G(RoadsideC), BeatKind.Roadside, 11)
                .Beat("③ 锚链大墩", G(AnchorC), BeatKind.Fight, 21)
                .Beat("补给 · 御道坡脚", G(SupplyAt), BeatKind.Supply, 4)
                .Beat("④ 宫门瓮城", G(GateC), BeatKind.Fight, 20)
                .Beat("宫门", G(ShrineAt), BeatKind.Exit);
            spec.slopePaths.Add(new SlopePath { name = "之字坡", points = Zigzag.points, maxSlope = 18f });
            foreach (var w in Ways)
                if (w != BrokenS)
                    spec.slopePaths.Add(new SlopePath { name = $"{w.id} {w.label}", points = w.path.points, maxSlope = 16f });
            foreach (var tr in Terraces)
                foreach (var (foot, top, _) in tr.ramps)
                    spec.slopePaths.Add(new SlopePath { name = $"{tr.name}坡道", points = new[] { foot, top } });
            return spec;
        }
    }
}
