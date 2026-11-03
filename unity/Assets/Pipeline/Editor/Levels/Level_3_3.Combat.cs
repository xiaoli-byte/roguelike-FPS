using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // 3-3 遭遇、风闸、藏宝、熔流闸、领主战（docs/level-design/maps/3-3.md 第 4–6 节；编组按 ch3-v2.md 第 4 节，出场方式先用「现身」，S1 落地后切换）
    public static partial class Level_3_3
    {
        // ───────────── 站位 ─────────────
        sealed class AnchorDef
        {
            public string name;
            public Vector2 at;
            public StationRole role;
            public int lane;
            public bool elevated;
            /// <summary>世界 y（站在不是地形的面上：吊车走道）；NaN = 贴地形</summary>
            public float y = float.NaN;
        }

        static AnchorDef A(string name, float x, float z, StationRole role, int lane, bool elevated = false, float y = float.NaN) =>
            new() { name = name, at = new Vector2(x, z), role = role, lane = lane, elevated = elevated, y = y };

        /// <summary>
        /// 刷怪站位（标记名 → 位置、角色、lane、高台）。高台站位只给飞的（毕方、神火飞鸦）；炉坛、检修台、闸前楼台是坡道走得上去的地面站位，
        /// 远程 / 炮击 / 辅助按角色站上去；吊车走道上的那个站位直接给世界高度。每个站位离掩体件 ≥ 2 m（铁牛半径约 1.3 m × 1.25 精英）。
        /// 编号：1 ① 范场、7 B1 瀑下桥（路遇）、3 ③ 浇包吊坊、2 ② 鼓风正殿、4 ④ 鼓风正殿二、6 ⑥ 神范前庭、5 废范龛（可选）
        /// </summary>
        /// <summary>B1 东岸的铁柱（毕方栖点）：避开出生点看神范、王座的两条视线（要在 AnchorDefs 之前初始化）</summary>
        static readonly Vector2 PerchB1 = new(111, 61);

        static readonly AnchorDef[] AnchorDefs =
        {
            // ① 范场：铜匠躲在西排范列后、傀儡守着两张铸床，炭童在渣堆旁；第二波祸斗从西坡和 B1 方向包上来
            A("Enemy_1_Founder", 37, 55, StationRole.Support, 0),
            A("Enemy_1_ArtyA", 33, 43, StationRole.Artillery, 1),
            A("Enemy_1_ArtyB", 56, 70, StationRole.Artillery, 2),
            A("Enemy_1_FrontA", 48, 47, StationRole.Assault, 0),
            A("Enemy_1_FrontB", 55, 62.5f, StationRole.Assault, 1),
            A("Enemy_1_SlagW", 35, 61, StationRole.Assault, 2),
            A("Enemy_1_SlagS", 46, 32, StationRole.Assault, 1),
            A("Enemy_1_FlankN", 35, 76, StationRole.Flank, 0),
            A("Enemy_1_FlankE", 77, 51, StationRole.Flank, 2),
            // B1 瀑下桥（路遇）：炭童守两头桥头，毕方栖在东岸铁柱
            A("Enemy_7_WestN", 94, 53, StationRole.Assault, 0),
            A("Enemy_7_WestS", 95, 50.5f, StationRole.Assault, 1),
            A("Enemy_7_EastN", 113, 52, StationRole.Assault, 2),
            A("Enemy_7_EastS", 118, 50, StationRole.Flank, 0),
            A("Enemy_7_Perch", PerchB1.x, PerchB1.y, StationRole.Precision, 0, true),
            // ③ 浇包吊坊：第一波从工棚后（增援门）冲出来、顺着浇铸槽冲向玩家；第二波铁牛从东壁铸门走出、马面守在吊车走道
            A("Enemy_3_ShedN", 190, 62, StationRole.Assault, 0),
            A("Enemy_3_ShedS", 190, 46, StationRole.Assault, 1),
            A("Enemy_3_GateMid", 190, 54, StationRole.Flank, 2),
            A("Enemy_3_TroughN", 166, 63, StationRole.Assault, 2),
            A("Enemy_3_TroughS", 166, 49, StationRole.Flank, 1),
            A("Enemy_3_Ox", 189, 54, StationRole.Assault, 0),
            A("Enemy_3_Crane", CraneX, 66, StationRole.Ranged, 0, false, T2 + 0.05f),
            A("Enemy_3_North", 156, 68, StationRole.Assault, 1),
            // ② 鼓风正殿：傩巫在北炉坛上跳傩，祸斗从大炉两侧（殿后炉窟）出来，炭童在风箱道；第二波马面从南北两排扶壁下来
            A("Enemy_2_Altar", 18, 155, StationRole.Support, 0),
            A("Enemy_2_KilnN", 36, 153, StationRole.Flank, 1),
            A("Enemy_2_KilnS", 30, 139.5f, StationRole.Flank, 2),
            A("Enemy_2_LaneN", 46, 157, StationRole.Assault, 0),
            A("Enemy_2_LaneS", 56, 137, StationRole.Assault, 1),
            A("Enemy_2_Aisle", 49, 146, StationRole.Assault, 2),
            A("Enemy_2_EaveN", 62, 158, StationRole.Ranged, 0),
            A("Enemy_2_EaveS", 50, 132, StationRole.Ranged, 1),
            // ④ 鼓风正殿（二）：祸斗沿风箱道吃炉门喷出的地火，傩巫上南炉坛，飞鸦从殿顶屋架间扑下来、傀儡上检修台，末波精英铁牛从大炉炉门走出来
            A("Enemy_4_LaneN", 40, 156, StationRole.Assault, 0),
            A("Enemy_4_LaneS", 62, 137, StationRole.Assault, 1),
            A("Enemy_4_Altar", 19, 132, StationRole.Support, 2),
            A("Enemy_4_Service", 78, 156, StationRole.Artillery, 1),
            A("Enemy_4_AirN", 42, 156, StationRole.Support, 0, true),
            A("Enemy_4_AirS", 56, 136, StationRole.Flank, 2, true),
            A("Enemy_4_Furnace", 25, 139, StationRole.Assault, 0),
            A("Enemy_4_Aisle", 49, 146, StationRole.Flank, 1),
            // ⑥ 神范前庭：精英马面守在闸前楼台、傀儡扎马在前庭，飞鸦从王座方向（东、北）飞下来
            A("Enemy_6_Tower", 88, 188, StationRole.Ranged, 0),
            A("Enemy_6_ArtyA", 66, 203, StationRole.Artillery, 1),
            A("Enemy_6_ArtyB", 70, 204, StationRole.Artillery, 2),
            A("Enemy_6_AirA", 92, 204, StationRole.Support, 0, true),
            A("Enemy_6_AirB", 94, 180, StationRole.Support, 1, true),
            A("Enemy_6_AirC", 80, 209, StationRole.Flank, 2, true),
            // 废范龛守军（可选）
            A("Enemy_5_Founder", 17, 204, StationRole.Support, 0),
            A("Enemy_5_Arty", 26, 200, StationRole.Artillery, 1),
            A("Enemy_5_A", 24, 190, StationRole.Assault, 2),
            A("Enemy_5_B", 16, 192.5f, StationRole.Assault, 0),
            A("Enemy_5_C", 33, 192, StationRole.Flank, 1),
        };

        /// <summary>两处藏宝：废范残兵（有守军）、炉工私藏（前庭西南角，风闸旁，无人看守）</summary>
        static readonly Vector2 ScrapCache = new(16, 199), ForgeCache = new(60, 178);

        static void BuildMarkers(LevelKit.TerrainSet set, Transform root)
        {
            Marker(root, "Site_Spawn", set.OnGround(Spawn.x, Spawn.y));
            Marker(root, "Site_1_Fan", set.OnGround(FanSite.x, FanSite.y));
            Marker(root, "Site_7_FallBridge", new Vector3(RoadSite.x, BridgeById("B1").DeckY, RoadSite.y));
            Marker(root, "Site_3_Ladle", set.OnGround(LadleSite.x, LadleSite.y));
            Marker(root, "Site_2_Hall", set.OnGround(HallSite.x, HallSite.y));
            Marker(root, "Site_6_Forecourt", set.OnGround(ForecourtSite.x, ForecourtSite.y));
            Marker(root, "Site_5_Scrap", set.OnGround(ScrapSite.x, ScrapSite.y));
            Marker(root, "Site_Lord", set.OnGround(ArenaCenter.x, ArenaCenter.y));
            foreach (var a in AnchorDefs)
            {
                var pos = float.IsNaN(a.y) ? set.OnGround(a.at.x, a.at.y) : new Vector3(a.at.x, a.y, a.at.y);
                var t = Marker(root, a.name, pos);
                var sa = t.gameObject.AddComponent<SpawnAnchor>();
                (sa.role, sa.lane, sa.elevated) = (a.role, a.lane, a.elevated);
            }
        }

        // ───────────── 遭遇 ─────────────

        sealed class Sites
        {
            public EncounterSite fan, road, ladle, hall, hall2, forecourt, scrap;
            public LevelObjective objective;
        }

        /// <summary>
        /// 遭遇（遭遇框架 v2；编组按 ch3-v2.md 第 4 节，每波 ≤ 3 种、同时在场远程 ≤ 3；出场方式先用「现身」，S1 落地后换埋伏 / 余烬起身 / 熔岩爬出 / 飞临 / 跃下 / 增援门）：
        ///   ① 范场 12：G09 教学版（铜匠 ×1 + 炮仗 ×2 + 炭童 ×3）→ G01（炭童 ×4 + 祸斗 ×2）；
        ///   B1 瀑下桥（路遇，不计目标）6：G11（炭童 ×5 + 毕方 ×1）；
        ///   ③ 浇包吊坊 10：G02 变体（精英祸斗·迅捷 + 祸斗 ×2 + 炭童 ×3，教熔流闸）→ G08（铁牛 + 马面 + 炭童 ×2）；
        ///   ② 鼓风正殿 12：G10 三面傩阵（傩巫 + 祸斗 ×3 + 炭童 ×3）→ G05（马面 ×2 + 炭童 ×3）；
        ///   ④ 鼓风正殿（二）12：风闸拉开后才触发——炉门吃火（傩巫 + 祸斗 ×3）→ G07（飞鸦 ×4 + 炮仗）→ 精英铁牛·坚盾 + 炭童 ×2；
        ///   ⑥ 神范前庭 6：G12（精英马面·狂暴 + 炮仗 ×2 + 飞鸦 ×3）；
        ///   废范龛（可选，调查藏宝时惊动）5：精英铜匠·爆裂 + 炮仗 + 炭童 ×3。
        /// 必清 52 只、精英 3；路遇 6；可选 5、精英 1。之后神范台的熔心魔将（首领宝箱 + 清关宝箱）。
        /// </summary>
        static Sites BuildEncounters(LevelKit.TerrainSet set, Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            EncounterSite Site(int index, string title, Vector2 center, float trigger, float arena, EncounterSpec spec, string reward, Vector3 chestOffset = default, float y = float.NaN)
            {
                var site = new GameObject($"Site {index} · {title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = float.IsNaN(y) ? set.OnGround(center.x, center.y) : new Vector3(center.x, y, center.y);
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
            // 编组取 InfernoSquads（S2）；出场方式先统一用「现身」（S1 的埋伏 / 余烬起身 / 熔岩爬出 / 飞临 / 跃下 / 增援门落地后去掉 Appear 这一层）
            WaveSpec W(WaveSpec w) => w.AllVia(SpawnMode.Appear);

            var s = new Sites();
            s.fan = Site(1, "范场", FanSite, 24, 30, EncounterSpec.Of(
                    W(InfernoSquads.G09(founder: 1, firecracker: 2, tantong: 3))
                        .Hint("熔铜匠躲在范列后给炮仗傀儡浇铜甲——绕过去或从吊梁上打它背上的坩埚；铜甲刚浇上、还通红的时候一打就碎"),
                    W(InfernoSquads.G01(tantong: 4, huodou: 2)).After(1, 1.8f))
                .Gather(0.4f).Distance(10, 30), "scroll", new Vector3(5, 0, -4));
            s.road = Site(7, "瀑下桥", RoadSite, 9, 18, EncounterSpec.Of(
                    W(InfernoSquads.G11(tantong: 5, bifang: 1))
                        .Hint("别停在桥上——冲到对岸掩体，或者把炭童打回熔铜里；毕方栖在东岸铁柱上"))
                .Gather(0.3f).Distance(6, 24), "", default, BridgeById("B1").DeckY);
            s.road.AsRoadside(9, 18);
            s.ladle = Site(3, "浇包吊坊", LadleSite, 26, 32, EncounterSpec.Of(
                    W(InfernoSquads.G02(huodou: 3, tantong: 3, eliteAffix: "swift")).Named("快犬冲槽")
                        .Hint("射断吊车下发亮的吊钩——浇包一倒，熔铜顺着浇铸槽冲下去，槽里和槽边的一起烧掉"),
                    W(InfernoSquads.G08(ironOx: 1, mamian: 1, tantong: 2)).After(1, 1.8f)
                        .Hint("马面在吊车走道上甩钩——先缴它的锁；铁牛吸气时顶着吸力打它敞开的炉门"))
                .Gather(0.45f).Distance(10, 32), "weapon", new Vector3(-10, 0, 0));
            s.hall = Site(2, "鼓风正殿", HallSite, 28, 36, EncounterSpec.Of(
                    W(InfernoSquads.G10(nuo: 1, huodou: 3, tantong: 3)),
                    W(InfernoSquads.G05(mamian: 2, huodou: 0, tantong: 3)).After(1, 1.8f)
                        .Hint("马面甩钩把人拖出掩体——绕风箱断视线，打它甩链时发亮的锁芯"))
                .Gather(0.5f).Distance(10, 34), "weapon", new Vector3(0, 0, -14));
            s.hall2 = Site(4, "鼓风正殿 · 炉门守军", HallSite, 28, 36, EncounterSpec.Of(
                    W(InfernoSquads.G10(nuo: 1, huodou: 3, tantong: 0)).Named("炉门吃火").Hint("炉门往风箱道喷的地火是祸斗的饭——先碎傩巫的面"),
                    W(InfernoSquads.G07(fireCrow: 4, firecracker: 1)).After(1, 1.6f)
                        .Hint("神火飞鸦从殿顶屋架间俯冲——空中打爆一只会连炸一串，还能炸到检修台上的傀儡"),
                    W(InfernoSquads.G08(ironOx: 1, mamian: 0, tantong: 2, eliteAffix: "shielded")).Named("炉前精英").After(1, 2f)
                        .Hint("精英铁牛从大炉里走出来——先破盾，再趁它吸气打炉门"))
                .Gather(0.6f).Distance(10, 34), "weapon:min=1", new Vector3(0, 0, 13));
            // 第二次进殿：要求第一次已清，开局不自动触发（风闸拉开后由 FoundryWindGate 打开）
            s.hall2.requires = new[] { s.hall };
            s.hall2.autoTrigger = false;
            s.forecourt = Site(6, "神范前庭", ForecourtSite, 20, 26, EncounterSpec.Of(
                    W(InfernoSquads.G12("frenzied", firecracker: 2, fireCrow: 3))
                        .Hint("王座降火：飞鸦从熔岩柱方向扑下来——引到傀儡头顶打爆，一串连爆；狂暴的马面要速杀"))
                .Gather(0.5f).Distance(8, 30), "scroll", new Vector3(-8, 0, -3));
            s.forecourt.requires = new[] { s.hall2 };
            s.scrap = Site(5, "废范守军", ScrapSite, 14, 20, EncounterSpec.Of(
                    W(InfernoSquads.G09(founder: 1, firecracker: 1, tantong: 3, founderAffix: "volatile")).Named("废范守军")
                        .Hint("精英熔铜匠死了会炸——拉开距离打它的坩埚"))
                .Gather(0.4f).Distance(8, 22), "");
            s.scrap.autoTrigger = false;
            s.scrap.optional = true;

            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(root, false);
            objective.title = "肃清铸范大坊";
            objective.required = new[] { s.fan, s.ladle, s.hall, s.hall2, s.forecourt };
            objective.optional = new[] { s.scrap };
            objective.autoCollect = false;
            s.objective = objective;
            return s;
        }

        /// <summary>风闸：前庭西南角崖边，朝南俯瞰鼓风正殿（看得见风箱鼓起来）；链柱是现成的 ChainObelisk，拉杆运行时拼</summary>
        static FoundryWindGate BuildWindGate(LevelKit.TerrainSet set, Transform markers, Transform props, Sites sites, Hall hall, List<LavaVolume> tides)
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
            gate.firstVisit = sites.hall;
            gate.secondVisit = sites.hall2;
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
        /// 支路藏宝（CachePOI）：废范龛一处有守军（调查时惊动「废范守军」，肃清后出宝箱，武器保底精良）；前庭西南角一处炉工私藏（风闸旁，无人看守，强化）。
        /// 模型用现成资产（Model 子物体），放在藏宝点旁 2.5–3 m
        /// </summary>
        static void BuildCaches(LevelKit.TerrainSet set, Transform markers, Sites sites)
        {
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
            Cache("废范残兵", ScrapCache, 90, "weapon:min=1", sites.scrap, HoardId, new Vector2(-2.6f, 0), HoardSize);
            Cache("炉工私藏", ForgeCache, 270, "upgrade", null, StallId, new Vector2(-2.6f, 1f), StallSize);
        }

        /// <summary>③ 的两口浇包（熔流闸 S4）：吊在浇包吊车横梁下，射断吊钩 → 浇包倾倒 → 熔流顺浇铸槽往西冲 6 s；一口各一次</summary>
        static List<LavaSluice> BuildSluices(Transform props)
        {
            var root = new GameObject("③ Lava Sluices · 熔流闸").transform;
            root.SetParent(props, false);
            return Sluices.Select(sp => LevelKit.PlaceLavaSluice(Dir, sp, root, _ => T1)).ToList();
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
        /// 神范台领主战（原样）：首领场地（矩形，x 108–196、z 120–208；只给 boss_warlord）、熔铜渠（只有神范台的浅渠和熔池会漫）、首领关流程（目标完成前关着）、
        /// 南侧入场触发区、两扇熔铁闸（白盒，开战时从闸前桥、东铸北桥的桥头升起封住，结算后落回去；场景里关着，不挡导航烘焙）、清关宝箱落点、出口点（神范前）
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
            arena.perchPoints = new[] { Point("Perch_Dais", G(ExitAt), new Vector2(-1, -1)) };
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
            var b5 = BridgeById("B5").center;
            var b6 = BridgeById("B6").center;
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
            var entryTrigger = new GameObject("Lord Threshold · 西南入场区").transform;
            entryTrigger.SetParent(markers, false);
            entryTrigger.position = G(new Vector2(156, 138), 2f);
            var threshold = entryTrigger.gameObject.AddComponent<BoxCollider>();
            threshold.isTrigger = true;
            threshold.size = new Vector3(80, 6, 36);
            enc.threshold = threshold;
            enc.thresholdInset = 2f;
            enc.gates = gates;
            enc.warnSeconds = 2.5f;
            enc.warnText = "神范台的熔铜沸腾了——熔心魔将自神范中醒来！";
            enc.tetherSlack = 8f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
            // 必清场地肃清前不开打（FoundryLordGate 在目标完成时打开）
            enc.enabled = false;

            var lg = go.AddComponent<FoundryLordGate>();
            lg.objective = objective;
            lg.encounter = enc;
            lg.clearChestPoint = clearPoint;
            return new Lord { arena = arena, encounter = enc, gate = lg, channels = channels, gates = gates };
        }
    }
}
