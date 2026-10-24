using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 3-4 祝融炉心 · 火麒麟（docs/level-design/maps/3-4.md；V2 inferno-5 祝融炉心殿，D4 / D5；终章首领场）。
    /// 关卡坐标 = 世界 XZ（米），北 = +Z，炉心殿地面 y = 0；熔池圆心 = 世界原点。地形 160 × 160 m（2 × 2 块），火山岩壁顶 y ≈ 30–34。
    ///
    ///   出生 · 铸神前殿（南侧 72 × 52 m 的玄武岩台地，三面是火山岩壁）：祝融像坐在南端的祭台上，东侧是补给营（SupplyCamp + SafeZone + 商店）；
    ///   → 熔铁护城渠（东西横贯，熔岩面 y −0.6，渠床 −2.4）上唯一的一座桥（10 m 宽）；
    ///   → 门楼（SM_Tripo_InfernoGateway；开战后熔铁闸从地下升起封死）→ 祝融炉心殿：
    ///     直径 48 m 的圆殿（墙 = 现有的殿墙板 + 扶壁一圈，背后是 30 m 高的火山岩），殿心半径 7 m 的熔池（浅碟，熔岩面 y −0.1），
    ///     熔池上方吊着青铜巨鼎（<see cref="QilinCauldron"/>，鼎身中心离地 7.2 m），四条巨链从鼎角拉到东南西北四面外墙 12 m 高处的锁扣（<see cref="QilinLock"/>）；
    ///     四条 1.6 m 宽的放射状熔岩渠（西北 / 东北 / 东南 / 西南，与地面齐平的熔岩带）把地面切成四个象限，半径 10–14 m 处是没有熔岩的窄桥；
    ///     八根玄武岩柱在半径 13 m（每象限两根，唯一挡得住张鳞的东西）；半径 18–24 m 是外环跑道（不放任何东西）；
    ///     东北偏东 / 西北偏西各一座炉口（SM_Tripo_InfernoFurnaceTower：饮熔时炭童钻出），东南偏南 / 西南偏南两处高排烟口（二阶段神火飞鸦，BS5）；
    ///     北面一个神龛凹室（门楣下 16 m 宽的口），两侧各一座 2.6 m 的祭台（靠侧墙，从中间走道横着上坡，俯射层），神龛（SM_Tripo_InfernoPortalShrine）居中。
    ///
    /// 第三章新模型暂缓（用户 2026-10-22，docs/art/ch3-kit.md）：吊鼎、锁扣是运行时程序几何，熔铁闸门、两段门楣（圆殿外壳）是白盒占位，
    /// 巨链用已发布的链环 SM_Prop_InfernoChainLink（关卡里摆一个停用的模板，运行时按链长实例化）。占位清单只提醒（PlaceholderPolicy.Warn）。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、自举标记、补给营、首领场地（<see cref="BossArena"/> + <see cref="QilinFurnace"/>）、
    /// 吊鼎与四个锁扣、首领关流程（<see cref="BossEncounter"/>，首领 boss_qilin，熔铁闸是它的门；3-4 是最后一关，打完走胜利链）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 3-4 祝融炉心（或 bridge.sh level 3-4）。
    /// </summary>
    [LevelBuilder("3-4", ScenePath)]
    public static class Level_3_4
    {
        public const string Dir = "Assets/Levels/L3_4_Zhurong";
        public const string ScenePath = "Assets/Scenes/L3_4_Zhurong.unity";
        const string Name = "L3_4";
        /// <summary>首领（QilinDef.Id 的字面量：构建器不依赖首领单元的文件）</summary>
        const string BossId = "boss_qilin";

        // ── 高度（世界 y）──
        const float Base = 8f, HeightRange = 48f, RockTop = 30f;
        static readonly Vector2 Origin = new(-80, -116), Size = new(160, 160);

        // ── 炉心殿 ──
        const float HallR = 24f, RingR = 25.5f, FloorR = 27.5f, PoolR = 7f, PoolBed = 1.0f, PoolLava = -0.1f, TrackR = 20.8f;
        const float PillarR = 13f, PillarSpread = 20f, PillarH = 6f;
        const float BridgeIn = 10f, BridgeOut = 14f, ChannelHalf = 0.8f;
        static readonly float[] ChannelYaws = { -135f, -45f, 45f, 135f };
        /// <summary>锁扣：离地高度、离圆心（锁身中心）；吊鼎鼎身中心离地</summary>
        const float LockHeight = 12f, LockR = 23.1f, HangHeight = 7.2f;
        /// <summary>殿墙一圈 20 节（每 18° 一个扶壁、两扶壁之间一块墙板）；炉口、排烟口方位（度，左右对称）</summary>
        const int RingJoints = 20;
        const float FurnaceYaw = 72f, FurnaceR = 26.2f, MouthR = 21.5f, VentYaw = 110f, VentR = 23.5f, VentY = 12f;

        // ── 神龛凹室（北）──
        static readonly Vector2 ApseC = new(0, 30), ApseHalf = new(10, 9);
        const float PlatH = 2.6f;
        static readonly Vector2 PlatC = new(8.3f, 32f), PlatHalf = new(1.7f, 4.5f);
        /// <summary>
        /// 祭台前端往里伸出的观台（同高）：祭台本身藏在北口扶壁背后，从祭台上望殿心被扶壁挡住；观台的内沿伸到北口里（x ±4.6），
        /// 站在观台上隔着北口看得到熔池、巨鼎和对面半个殿（俯射层名副其实）。观台在坡道（z 30–33）南边，不挡坡道
        /// </summary>
        static readonly Vector2 BalconyC = new(5.7f, 28f), BalconyHalf = new(1.1f, 1.4f);
        static readonly Vector2 RampFoot = new(0.3f, 31.5f), RampTop = new(6.9f, 31.5f);
        const float RampWidth = 3f;
        static readonly Vector2 ShrineAt = new(0, 37.6f);
        const float ShrineScale = 0.9f;

        // ── 门楼、桥、护城渠、前殿（南）──
        static readonly Vector2 GateC = new(0, -25.5f), GateHalf = new(5.5f, 3.5f);
        const float GateZ = -26.6f, BridgeHalfW = 5f, BridgeZ0 = -46.5f, BridgeZ1 = -27.5f;
        const float MoatZ0 = -45.5f, MoatZ1 = -28f, MoatBed = 2.4f, MoatLava = -0.6f;
        static readonly Vector2 SouthC = new(0, -63), SouthHalf = new(36, 35);
        static readonly Vector2 DaisC = new(0, -92), DaisHalf = new(8, 5);
        const float DaisH = 1.0f, DaisSkirt = 4.5f;

        // ── 标记 ──
        static readonly Vector2 Spawn = new(-24, -84), Camp = new(16, -68), ForecourtN = new(0, -52);
        static readonly Vector2 BossSpawn = new(0, 11.5f), PlayerEntry = new(0, -19.5f), RewardAt = new(0, -12), ExitAt = new(0, 35f);
        const float ArenaRadius = 23.5f;

        // ── 美术 ID ──
        const string WallId = "SM_Tripo_InfernoHallWall", ButtressId = "SM_Tripo_InfernoHallButtress", GatewayId = "SM_Tripo_InfernoGateway",
            FurnaceId = "SM_Tripo_InfernoFurnaceTower", ColumnId = "SM_Tripo_InfernoColumn", ShrineId = "SM_Tripo_InfernoPortalShrine",
            StatueId = "SM_Tripo_InfernoZhurong", AltarId = "SM_Tripo_InfernoFireAltar", BarricadeId = "SM_Tripo_InfernoBarricade",
            StallId = "SM_Tripo_InfernoForgeStall", IngotId = "SM_Tripo_InfernoIngotPile", HoardId = "SM_Tripo_InfernoTreasureHoard",
            BasaltId = "SM_Env_InfernoBasalt", CrucibleId = "SM_Prop_InfernoCrucible", ChainLinkId = "SM_Prop_InfernoChainLink",
            // 第三章暂缓的件（registry 已登记、没出模型）：吊鼎、锁扣运行时程序几何；熔铁闸门白盒；圆殿外壳（门楣）白盒
            CauldronId = "SM_Prop_QilinCauldron", LockId = "SM_Prop_QilinChainLock", MoltenGateId = "SM_Tripo_InfernoMoltenGate",
            RoundHallId = "SM_Tripo_InfernoRoundHallWall";

        static readonly Vector3 WallSize = new(8.17f, 15.8f, 2.57f), ButtressSize = new(4.51f, 17.84f, 3.74f), GatewaySize = new(11.31f, 10.75f, 2.2f),
            FurnaceSize = new(6.13f, 12.86f, 4.99f), ShrineSize = new(7.59f, 10.68f, 2.15f), MoltenGateSize = new(11.4f, 9f, 1.4f);

        // ───────────── 地貌 ─────────────

        static float BoxSdf(Vector2 p, Vector2 c, Vector2 half)
        {
            float dx = Mathf.Abs(p.x - c.x) - half.x, dz = Mathf.Abs(p.y - c.y) - half.y;
            return new Vector2(Mathf.Max(dx, 0), Mathf.Max(dz, 0)).magnitude + Mathf.Min(Mathf.Max(dx, dz), 0);
        }

        /// <summary>开阔区（殿内、神龛、门楼、桥 + 护城渠 + 前殿）的有符号距离：里面为负，岩壁从 0 开始起</summary>
        static float Open(Vector2 p)
        {
            // 殿墙那一圈（墙板 / 扶壁背面到 26.8 m）也是平地：墙立在地上，岩体从墙背后起
            float hall = p.magnitude - FloorR;
            float apse = BoxSdf(p, ApseC, ApseHalf);
            float gate = BoxSdf(p, GateC, GateHalf);
            // 前殿：圆角 + 起伏的崖线（不是一个方坑）；护城渠一带保持直边
            float south = BoxSdf(p, SouthC, SouthHalf - new Vector2(8, 8)) - 8f + Fbm(p, 16, 3, 7) * 2f * Smooth(-50f, -62f, p.y);
            return Mathf.Min(Mathf.Min(hall, apse), Mathf.Min(gate, south));
        }

        /// <summary>可玩区（防越界 / 俯视图）：开阔区往岩壁里 2 m 以内算界内（岩壁 3–6 m 内陡升到 30 m，爬不上去，没有空气墙）</summary>
        static float Playable(Vector2 p) => 1 - Smooth(0, 2f, Open(p));

        /// <summary>点在第几条熔岩渠上（池外到窄桥内沿、窄桥外沿到殿墙这两段；不在渠上返回 0）</summary>
        static float ChannelMask(Vector2 p)
        {
            float best = 0;
            foreach (float y in ChannelYaws)
            {
                float a = y * Mathf.Deg2Rad;
                var d = new Vector2(Mathf.Sin(a), Mathf.Cos(a));
                float along = Vector2.Dot(p, d), across = Mathf.Abs(p.x * d.y - p.y * d.x);
                bool inner = along > PoolR - 0.6f && along < BridgeIn - ChannelHalf;
                bool outer = along > BridgeOut + ChannelHalf && along < HallR + 1f;
                if (!inner && !outer) continue;
                best = Mathf.Max(best, 1 - Smooth(ChannelHalf - 0.15f, ChannelHalf + 0.25f, across));
            }
            return best;
        }

        /// <summary>两座祭台（含观台）的台面高度；shrink = 往岩壁里的距离（岩壁从贴着它的台面起坡时用）</summary>
        static float PlatRaise(Vector2 p, float shrink)
        {
            float best = 0;
            foreach (float sx in new[] { -1f, 1f })
            {
                float sdf = Mathf.Min(BoxSdf(p, new Vector2(PlatC.x * sx, PlatC.y), PlatHalf), BoxSdf(p, new Vector2(BalconyC.x * sx, BalconyC.y), BalconyHalf));
                best = Mathf.Max(best, PlatH * (1 - Smooth(0, 0.3f, sdf - shrink)));
            }
            return best;
        }

        /// <summary>祝融像祭台（1 m，四周 4.5 m 缓坡）的抬高；shrink 同上</summary>
        static float DaisRaise(Vector2 p, float shrink) => DaisH * (1 - Smooth(0, DaisSkirt, BoxSdf(p, DaisC, DaisHalf) - shrink));

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float d = Open(p);
            float r = p.magnitude;
            float h;
            if (d > 0)
            {
                // 岩壁：靠殿的一侧 3 m 内陡升（殿墙背后的岩体），前殿一侧 4 m（崖），壁顶有起伏。
                // 从贴着岩壁的台面高度起坡（祭台贴着凹室侧墙、祝融像祭台贴着南崖）：从 0 起的话台子和崖脚之间会夹出一道缝
                float w = Mathf.Lerp(4f, 3f, Smooth(-60f, -38f, p.y));
                float top = RockTop + Fbm(p, 30, 3, 5) * 4f;
                float foot = Mathf.Max(PlatRaise(p, d), DaisRaise(p, d));
                h = foot + (top - foot) * Mathf.Pow(Smooth(0, w, d), 0.7f);
                s.rock = Smooth(0.2f, 1.2f, d);
            }
            else
            {
                h = 0;
                bool south = p.y < MoatZ0;
                if (south) h += Fbm(p, 14, 3, 2) * 0.12f * Smooth(0, 3, -d);
                // 熔池：浅碟，熔岩面 −0.1，池心 −1.0
                float pool = 1 - Smooth(PoolR - 1.4f, PoolR, r);
                h -= PoolBed * pool;
                // 护城渠：东西横贯（桥除外），渠床 −2.4、南岸陡坎
                float moat = 0;
                if (p.y > MoatZ0 - 1f && p.y < MoatZ1 && BoxSdf(p, SouthC, SouthHalf) <= 0)
                {
                    moat = Smooth(MoatZ0, MoatZ0 + 0.7f, p.y);
                    float bridge = p.y > BridgeZ0 && p.y < BridgeZ1 ? 1 - Smooth(BridgeHalfW, BridgeHalfW + 0.6f, Mathf.Abs(p.x)) : 0;
                    moat *= 1 - bridge;
                    h -= MoatBed * moat;
                }
                // 神龛两侧的祭台（2.6 m，靠凹室侧墙，前端伸出观台）+ 从中间走道横着上去的坡道（21°）
                float raise = PlatRaise(p, 0);
                foreach (float sx in new[] { -1f, 1f })
                {
                    var (t, mask) = Ramp(p, new Vector2(RampFoot.x * sx, RampFoot.y), new Vector2(RampTop.x * sx, RampTop.y), RampWidth, 0.4f);
                    raise = Mathf.Max(raise, PlatH * t * mask);
                }
                // 只在祭台 / 坡道上抬高（Max 到 0 会把熔池、护城渠挖下去的坑全部填平）
                if (raise > 1e-3f) h = Mathf.Max(h, raise);
                // 祝融像祭台（1 m，四周缓坡）
                h += DaisRaise(p, 0);
                float channel = r < HallR + 1f ? ChannelMask(p) : 0;
                s.fluid = Mathf.Max(Mathf.Max(Smooth(0.5f, 1f, pool), moat), channel);
                s.shore = Mathf.Max(Smooth(PoolR + 1.2f, PoolR, r) * (1 - pool), 0);
                bool inHall = r < HallR + 0.5f || BoxSdf(p, ApseC, ApseHalf) < 0 || BoxSdf(p, GateC, GateHalf) < 0 || (p.y > BridgeZ0 && Mathf.Abs(p.x) < BridgeHalfW);
                s.packed = inHall ? 0.85f : 0.35f;
            }
            s.h = h + Base;
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 3-4 祝融炉心", priority = 74)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh（人形 + 熔岩生物）→ 验收检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Inferno;
            ShowcaseSceneBuilder.ConfigureProject();
            System.IO.Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            // 火山口里：主光抬到 55°，殿内地面才照得到；暗部靠环境光与熔岩的辉光
            if (RenderSettings.sun) RenderSettings.sun.transform.rotation = Quaternion.Euler(55f, 30f, 0);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                heightRes = 257, splatRes = 256, tiles = new Vector2Int(2, 2), ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);
            LevelKit.Weather(env, theme, new Vector2(0.3f, 1f), 0.15f);

            var lava = BuildLava(env);
            var hall = BuildHall(set, props);
            BuildPillars(set, props);
            BuildApse(set, props);
            var gate = BuildGate(props);
            BuildBridgeAndForecourt(set, props);
            var furnace = BuildArena(set, markers, out var arena, out var exitPoint, out var rewardPoint);
            var cauldron = BuildCauldron(markers, furnace);
            BuildEncounter(markers, arena, gate, exitPoint, rewardPoint);
            var camp = BuildCamp(set, markers);
            BuildLights(env, furnace);

            // 玩家在 Core 场景（L1）：这里只放出生标记 + 自举标记
            var spawnAt = set.OnGround(Spawn.x, Spawn.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(Flat(new Vector3(0, 0, -26) - spawnAt));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            // 熔铁闸门开战才升起：烘导航时不能挡着门洞（BossEncounter.Start 也会把它收起）
            if (gate) gate.SetActive(false);
            LevelKit.BakeNavMesh(Dir, Name, env);
            // 火鼍网格按体积收集碰撞体（走物理场景）：这一帧刚摆好的地形块、殿墙还没同步进物理场景时收不到地面，烘出来是空的
            Physics.SyncTransforms();
            LevelKit.BakeLavaNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("3-4 祝融炉心 · 验收");
            CheckGeometry(rep, set, lava, hall, furnace, cauldron, gate, camp);
            LevelValidator.Run(Spec(set), rep); // 主线、坡度、视线 + L5 规则集（占位只提醒：第三章新模型暂缓）
            LevelKit.ValidateLava(rep);
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_3-4_report.txt");

            if (review)
            {
                Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                var ding = new Vector3(0, HangHeight, 0);
                try
                {
                    LevelKit.Capture(cam, fpRig, "level_3-4", new[]
                    {
                        ("Aerial", new Vector3(55, 110, -95), new Vector3(0, 0, -25), false),
                        ("Map", new Vector3(0, 260, -34), new Vector3(0, 0, -33.9f), false),
                        ("Spawn", E(Spawn), new Vector3(0, 6, -26), true),
                        ("Camp", E(new Vector2(4, -64)), G(Camp, 1), false),
                        ("Statue", E(new Vector2(-9, -79)), G(new Vector2(0, DaisC.y - 2f), 6f), false),
                        ("Bridge", E(new Vector2(0, -50)), new Vector3(0, 6, -25), false),
                        ("Entry", E(PlayerEntry), ding, true),
                        ("Track", E(new Vector2(-14, -14)), G(new Vector2(14, 14), 2), false),
                        ("Pillars", E(new Vector2(17, 4)), G(new Vector2(-12, 0), 2), false),
                        ("LockWest", E(new Vector2(17, -8.5f)), new Vector3(-LockR, LockHeight, 0), false),
                        ("Apse", E(new Vector2(0, 14)), G(ShrineAt, 5), false),
                        ("Overlook", E(BalconyC + new Vector2(-0.6f, -0.6f)), ding, false),
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

        // ───────────── 熔岩 ─────────────

        sealed class LavaSet
        {
            public LavaVolume pool;
            public readonly List<LavaVolume> moat = new(), channels = new();
        }

        /// <summary>熔岩渠的熔岩面材质：渠只有 1.6 m 宽，共用熔岩材质的岸边硬壳（形状边缘往里 1.5 m）会把整条渠盖成黑壳，这里收窄到 0.3 m</summary>
        const string ChannelLavaMat = Dir + "/M_Lava_Channel.mat";
        const float ChannelShoreWidth = 0.3f;

        /// <summary>
        /// 熔池（浅碟里的圆）、八段熔岩渠（与地面齐平的熔岩带，流向殿墙）、护城渠（东西横贯，桥两侧各一片：桥高出熔岩面 0.6 m，不算熔岩，
        /// 熔岩体也不跨过桥——否则桥面在熔岩体的形状里、它的中心落在桥上）
        /// </summary>
        static LavaSet BuildLava(Transform env)
        {
            var root = new GameObject("Lava").transform;
            root.SetParent(env, false);
            var l = new LavaSet
            {
                pool = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = "Molten Pool", center = new Vector3(0, PoolLava, 0), shape = LavaShape.Disc, size = new Vector2(PoolR, PoolR), depth = PoolBed + 0.5f,
                }, root),
            };
            float moatOut = SouthHalf.x + 2f, moatW = moatOut - BridgeHalfW;
            foreach (float sx in new[] { -1f, 1f })
                l.moat.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = $"Molten Moat {(sx < 0 ? "W" : "E")}", center = new Vector3(sx * (BridgeHalfW + moatW * 0.5f), MoatLava, (MoatZ0 + MoatZ1) * 0.5f),
                    size = new Vector2(moatW, MoatZ1 - MoatZ0 + 1f), depth = MoatBed + 0.3f, flow = new Vector2(0.25f * sx, 0),
                }, root));
            int i = 0;
            foreach (float yaw in ChannelYaws)
            {
                foreach (var (r0, r1, tag) in new[] { (PoolR - 0.6f, BridgeIn - ChannelHalf, "Inner"), (BridgeOut + ChannelHalf, HallR + 1f, "Outer") })
                {
                    float a = yaw * Mathf.Deg2Rad, mid = (r0 + r1) * 0.5f;
                    l.channels.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                    {
                        name = $"Channel {i} {tag}", center = new Vector3(Mathf.Sin(a) * mid, 0, Mathf.Cos(a) * mid), size = new Vector2(ChannelHalf * 2, r1 - r0),
                        yaw = yaw, depth = 0.6f, depthShore = false, flow = new Vector2(0, 0.4f),
                    }, root));
                }
                i++;
            }
            var mat = ChannelMaterial();
            if (mat)
                foreach (var v in l.channels)
                    if (v && v.surface)
                        v.surface.sharedMaterial = mat;
            return l;
        }

        /// <summary>熔岩渠材质：共用熔岩材质的副本（每次构建同步一遍），只把岸边硬壳收窄</summary>
        static Material ChannelMaterial()
        {
            var src = LevelKit.LavaMaterial();
            if (!src) return null;
            var mat = AssetDatabase.LoadAssetAtPath<Material>(ChannelLavaMat);
            if (!mat)
            {
                mat = new Material(src) { name = "M_Lava_Channel" };
                AssetDatabase.CreateAsset(mat, ChannelLavaMat);
            }
            else
            {
                mat.shader = src.shader;
                mat.CopyPropertiesFromMaterial(src);
            }
            if (mat.HasProperty("_ShoreWidth")) mat.SetFloat("_ShoreWidth", ChannelShoreWidth);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        // ───────────── 圆殿 ─────────────

        sealed class HallSet
        {
            public readonly List<GameObject> walls = new(), buttresses = new(), furnaces = new(), lintels = new();
            public GameObject gateway, shrine;
        }

        static Vector3 Ring(float yawDeg, float r, float y = 0)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a) * r, y, Mathf.Cos(a) * r);
        }

        static bool Near(float a, float b, float tol = 1f) => Mathf.Abs(Mathf.DeltaAngle(a, b)) < tol;

        /// <summary>
        /// 殿墙一圈：每 18° 一个扶壁（关节）、两扶壁之间一块殿墙板（8.17 m，正面朝殿心）。南门（180°）、北神龛口（0°）各空出一节半（两块墙板 + 中间扶壁），
        /// ±72° 的扶壁换成炉口（炉塔前沿离圆心 23.7 m，不压外环跑道）；南北两个口上方各压一段门楣（圆殿外壳白盒，锁扣挂在门楣上）
        /// </summary>
        static HallSet BuildHall(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Round Hall").transform;
            root.SetParent(props, false);
            var h = new HallSet();
            float step = 360f / RingJoints;
            for (int k = 0; k < RingJoints; k++)
            {
                float yaw = Mathf.DeltaAngle(0, k * step);
                if (Near(yaw, 0) || Near(yaw, 180)) continue;
                if (Near(Mathf.Abs(yaw), FurnaceYaw))
                {
                    var f = LevelKit.PlaceOrBox(FurnaceId, root, Ring(yaw, FurnaceR), FurnaceSize, yaw + 180f);
                    if (f) h.furnaces.Add(f);
                    continue;
                }
                var b = LevelKit.PlaceOrBox(ButtressId, root, Ring(yaw, RingR), ButtressSize, yaw + 180f);
                if (b) h.buttresses.Add(b);
            }
            for (int k = 0; k < RingJoints; k++)
            {
                float yaw = Mathf.DeltaAngle(0, k * step + step * 0.5f);
                if (Mathf.Abs(Mathf.DeltaAngle(yaw, 0)) < step || Mathf.Abs(Mathf.DeltaAngle(yaw, 180)) < step) continue;
                var w = LevelKit.PlaceOrBox(WallId, root, Ring(yaw, RingR), WallSize, yaw + 180f);
                if (w) h.walls.Add(w);
            }
            // 南门楼（正面朝殿外，开战后熔铁闸在它里面升起）
            h.gateway = LevelKit.PlaceOrBox(GatewayId, root, new Vector3(0, 0, -24.9f), GatewaySize, 180f);
            // 门楣：两扶壁之间、门楼 / 神龛口之上，到 22 m（圆殿外壳 SM_Tripo_InfernoRoundHallWall 暂缓：白盒）
            // 门楣的正面贴着锁扣的背板（锁身中心 LockR、背板背面再往外 0.63 m）：南北两个锁扣挂在门楣上，不是悬在门楣前面半米的空中
            float span = 2f * RingR * Mathf.Sin(step * Mathf.Deg2Rad) - 0.4f;
            const float lintelDepth = 2.5f;
            float lintelR = LockR + 0.63f + lintelDepth * 0.5f;
            foreach (var (z, y0, label) in new[] { (-lintelR, GatewaySize.y, "南门楼"), (lintelR, 10.5f, "北神龛口") })
            {
                var box = LevelKit.Box($"Placeholder · {RoundHallId}（{label}门楣）", root, new Vector3(0, y0, z), new Vector3(span, 22f - y0, lintelDepth), 0,
                    LevelKit.Mat(LevelKit.PlaceholderDir, "Placeholder", new Color(0.93f, 0.93f, 0.9f)), 0f);
                LevelKit.EnsureTag(LevelKit.PlaceholderTag);
                box.tag = LevelKit.PlaceholderTag;
                h.lintels.Add(box);
            }
            return h;
        }

        /// <summary>八根玄武岩柱（半径 13 m，每象限中线左右各 20°，直径约 2.4 m、高 6 m）：张鳞时唯一挡得住鳞刃的东西</summary>
        static void BuildPillars(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Basalt Pillars").transform;
            root.SetParent(props, false);
            float scale = PillarH / Mathf.Max(0.5f, ShowcaseSceneBuilder.DesignBounds(ColumnId).size.y);
            int i = 0;
            foreach (float q in new[] { 0f, 90f, 180f, -90f })
            foreach (float s in new[] { -1f, 1f })
            {
                var at = Ring(q + s * PillarSpread, PillarR);
                var go = LevelKit.PlaceOrBox(ColumnId, root, set.OnGround(at.x, at.z, -0.15f), new Vector3(2.4f, PillarH, 2.4f), i * 47f, scale);
                if (go) go.name = $"Pillar {++i} ({go.name})";
            }
        }

        /// <summary>北神龛凹室：神龛居中（正面朝南），两座祭台的边上各一座火坛</summary>
        static void BuildApse(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Shrine Apse").transform;
            root.SetParent(props, false);
            LevelKit.PlaceOrBox(ShrineId, root, set.OnGround(ShrineAt.x, ShrineAt.y, -0.1f), ShrineSize * ShrineScale, 180f, ShrineScale);
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(AltarId, root, set.OnGround(PlatC.x * sx, PlatC.y - 3.6f, -0.05f), new Vector3(1.13f, 2.36f, 1.15f), 180f);
        }

        /// <summary>熔铁闸门（BossEncounter 的门：开战从地下升起封死门洞，结算后落回去）。正式件 SM_Tripo_InfernoMoltenGate 暂缓：白盒</summary>
        static GameObject BuildGate(Transform props)
        {
            var gate = LevelKit.PlaceOrBox(MoltenGateId, props, new Vector3(0, 0, GateZ), MoltenGateSize, 0f);
            if (gate) gate.isStatic = false;
            return gate;
        }

        /// <summary>护城渠桥两侧的矮栏（拒马件）、桥头两座火坛；前殿：祝融像 + 祭台火坛、散放的玄武岩、锻摊货堆</summary>
        static void BuildBridgeAndForecourt(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Forecourt").transform;
            root.SetParent(props, false);
            for (float z = BridgeZ0 + 2.2f; z < BridgeZ1 - 1.5f; z += 3.7f)
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(BarricadeId, root, set.OnGround(sx * (BridgeHalfW - 0.4f), z, -0.05f), new Vector3(3.56f, 1.18f, 0.47f), 90f);
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(AltarId, root, set.OnGround(sx * 8.5f, BridgeZ0 - 3.5f, -0.05f), new Vector3(1.13f, 2.36f, 1.15f), 0f);
            // 祝融像：前殿南端的祭台上，面朝北（望着护城渠对岸的炉心殿）
            float statueScale = 1.2f;
            LevelKit.PlaceOrBox(StatueId, root, set.OnGround(DaisC.x, DaisC.y - 1.5f, -0.1f), new Vector3(7.8f, 15.4f, 6.8f) * statueScale, 0f, statueScale);
            foreach (float sx in new[] { -1f, 1f })
                LevelKit.PlaceOrBox(AltarId, root, set.OnGround(sx * 6f, DaisC.y + 3f, -0.05f), new Vector3(1.13f, 2.36f, 1.15f), 0f);
            var rng = new System.Random(34);
            foreach (var p in new[]
                     {
                         new Vector2(-32, -58), new Vector2(-31, -72), new Vector2(-30, -90), new Vector2(-18, -95), new Vector2(31, -56), new Vector2(32, -86),
                         new Vector2(20, -95), new Vector2(-12, -60),
                     })
                LevelKit.PlaceOrBox(BasaltId, root, set.OnGround(p.x, p.y, -0.3f), new Vector3(2.6f, 2.9f, 2.4f), (float)rng.NextDouble() * 360f,
                    0.8f + (float)rng.NextDouble() * 0.5f);
            LevelKit.PlaceOrBox(StallId, root, set.OnGround(30, -76, -0.05f), new Vector3(2.6f, 3.5f, 1.6f), -90f);
            LevelKit.PlaceOrBox(IngotId, root, set.OnGround(29, -63, -0.05f), new Vector3(2.2f, 1.5f, 1.8f), 200f);
            LevelKit.PlaceOrBox(HoardId, root, set.OnGround(30, -81, -0.05f), new Vector3(2.3f, 1.7f, 1.6f), 250f);
            LevelKit.PlaceOrBox(CrucibleId, root, set.OnGround(-16, -66, -0.05f), new Vector3(1.3f, 1f, 1.3f), 30f);
            LevelKit.PlaceOrBox(CrucibleId, root, set.OnGround(-14.5f, -67.5f, -0.05f), new Vector3(1.3f, 1f, 1.3f), 110f);
        }

        // ───────────── 标记 ─────────────

        static Transform Point(Transform parent, string name, Vector3 pos, Vector3 facing)
        {
            var p = new GameObject(name).transform;
            p.SetParent(parent, false);
            p.position = pos;
            facing.y = 0;
            if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(facing);
            return p;
        }

        /// <summary>
        /// 首领场地（<see cref="BossArena"/>，只给 boss_qilin）：圆心 = 熔池圆心、半径 23.5 m；同一物体上挂炉心殿几何（<see cref="QilinFurnace"/>）。
        /// 出生点在熔池北沿（池外 4.5 m，面朝南：麒麟从池心跃出落在这里）；玩家入场点在门楼里侧；召唤点 = 两座炉口前（炭童）；
        /// 掩体点 = 八根柱子背后；栖落点 = 神龛两座祭台、两处高排烟口；边缘点 = 外环跑道一圈 8 个。另给出口点（神龛前）与宝箱落点（熔池南侧）
        /// </summary>
        static QilinFurnace BuildArena(LevelKit.TerrainSet set, Transform markers, out BossArena arena, out Transform exitPoint, out Transform rewardPoint)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var root = new GameObject("BossArena").transform;
            root.SetParent(markers, false);
            root.position = Vector3.zero;
            arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Circle;
            arena.radius = ArenaRadius;
            arena.bossSpawn = Point(root, "BossSpawn", G(BossSpawn), Vector3.back);
            arena.playerEntry = Point(root, "PlayerEntry", G(PlayerEntry), Vector3.forward);
            var mouths = new List<Transform>();
            foreach (float s in new[] { -1f, 1f })
            {
                var m = Ring(s * FurnaceYaw, MouthR);
                mouths.Add(Point(root, $"Summon_Mouth{(s < 0 ? "W" : "E")}", G(new Vector2(m.x, m.z)), -m));
            }
            arena.summonPoints = mouths.ToArray();
            var covers = new List<Transform>();
            int ci = 0;
            foreach (float q in new[] { 0f, 90f, 180f, -90f })
            foreach (float s in new[] { -1f, 1f })
            {
                var c = Ring(q + s * PillarSpread, PillarR + 2.2f);
                covers.Add(Point(root, $"Cover_Pillar{++ci}", G(new Vector2(c.x, c.z)), c));
            }
            arena.coverPoints = covers.ToArray();
            var vents = new List<Transform>();
            foreach (float s in new[] { -1f, 1f })
            {
                var v = Ring(s * VentYaw, VentR, VentY);
                vents.Add(Point(root, $"Perch_Vent{(s < 0 ? "W" : "E")}", v, -v));
            }
            arena.perchPoints = new[]
            {
                // 栖落点在两座祭台伸进北口的观台上（隔着北口看得到殿心）
                Point(root, "Perch_AltarW", G(new Vector2(-BalconyC.x, BalconyC.y)), Vector3.back), Point(root, "Perch_AltarE", G(BalconyC), Vector3.back), vents[0], vents[1],
            };
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                var e = Ring(i * 45f + 22.5f, TrackR);
                return Point(root, $"Edge_{i + 1}", G(new Vector2(e.x, e.z)), -e);
            }).ToArray();
            var furnace = root.gameObject.AddComponent<QilinFurnace>();
            furnace.poolRadius = PoolR;
            furnace.wallRadius = HallR;
            furnace.trackRadius = TrackR;
            furnace.bridgeInner = BridgeIn;
            furnace.bridgeOuter = BridgeOut;
            furnace.channelHalfWidth = ChannelHalf;
            furnace.channelYaws = ChannelYaws.ToArray();
            furnace.mouths = mouths.ToArray();
            furnace.vents = vents.ToArray();
            exitPoint = Point(markers, "Boss Exit", G(ExitAt), Vector3.back);
            rewardPoint = Point(markers, "Boss Reward", G(RewardAt), Vector3.back);
            return furnace;
        }

        /// <summary>
        /// 吊鼎 + 四个锁扣：鼎在熔池圆心（运行时搭程序方鼎，挂 7.2 m）；锁扣在四个象限中线上、离圆心 23.1 m、离地 12 m，正面朝殿心
        /// （东西两个贴在扶壁上，南北两个挂在门楣上）。链环模板（SM_Prop_InfernoChainLink）停用摆在鼎下，运行时按链长实例化。
        /// 吊鼎、锁扣的正式件暂缓：各挂一个占位标记，占位清单里列出来
        /// </summary>
        static QilinCauldron BuildCauldron(Transform markers, QilinFurnace furnace)
        {
            LevelKit.EnsureTag(LevelKit.PlaceholderTag);
            var go = new GameObject("Qilin Cauldron");
            go.transform.SetParent(markers, false);
            go.transform.position = furnace.Center;
            var c = go.AddComponent<QilinCauldron>();
            c.hangHeight = HangHeight;
            c.furnace = furnace;
            c.linkScale = 1.5f;
            Marker(go.transform, $"Placeholder · {CauldronId}（运行时程序方鼎）", Vector3.up * HangHeight);
            if (ShowcaseSceneBuilder.Prefab(ChainLinkId))
            {
                var link = ShowcaseSceneBuilder.Place(ChainLinkId, go.transform, new Vector3(0, -3, 0));
                if (link)
                {
                    link.name = "Chain Link Template";
                    foreach (var t in link.GetComponentsInChildren<Transform>(true)) GameObjectUtility.SetStaticEditorFlags(t.gameObject, 0);
                    link.SetActive(false);
                    c.linkTemplate = link;
                }
            }
            var locks = new QilinLock[furnace.QuadrantCount];
            for (int i = 0; i < locks.Length; i++)
            {
                float yaw = furnace.QuadrantYaw(i);
                var at = Ring(yaw, LockR, LockHeight);
                var lgo = new GameObject($"Qilin Lock {i} ({Compass(yaw)})");
                lgo.transform.SetParent(markers, false);
                lgo.transform.SetPositionAndRotation(at, Quaternion.LookRotation(Flat(-at)));
                var l = lgo.AddComponent<QilinLock>();
                l.index = i;
                Marker(lgo.transform, $"Placeholder · {LockId}（运行时程序锁扣）", Vector3.zero);
                locks[i] = l;
            }
            c.locks = locks;
            return c;
        }

        static void Marker(Transform parent, string name, Vector3 local)
        {
            var m = new GameObject(name);
            m.transform.SetParent(parent, false);
            m.transform.localPosition = local;
            m.tag = LevelKit.PlaceholderTag;
        }

        static string Compass(float yaw) => (Mathf.RoundToInt(Mathf.Repeat(yaw, 360f) / 90f) % 4) switch { 0 => "N", 1 => "E", 2 => "S", _ => "W" };

        /// <summary>首领关流程：走过门楼进殿 → 熔铁闸升起封门 → 登场预警 2.5 s → 火麒麟从熔池跃出；拴绳 6 m；倒下 → 溃散 → 结算 → 最后一关：胜利链</summary>
        static void BuildEncounter(Transform markers, BossArena arena, GameObject gate, Transform exitPoint, Transform rewardPoint)
        {
            var go = new GameObject("Boss Encounter · 火麒麟");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2.5f;
            enc.gates = gate ? new[] { gate } : System.Array.Empty<GameObject>();
            enc.gateRise = 0.9f;
            enc.warnSeconds = 2.5f;
            enc.warnText = "熔池翻涌、熔铁闸落——火麒麟自炉心跃出！";
            enc.tetherSlack = 6f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
        }

        /// <summary>铸神前殿补给营（B2 / R3）：前殿东侧，正面朝西（玩家从西南的出生点走来），商店弧排在中心东边 6.4 m；安全区半径 10 m</summary>
        static SupplyCamp BuildCamp(LevelKit.TerrainSet set, Transform markers)
        {
            var go = new GameObject("SupplyCamp");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(set.OnGround(Camp.x, Camp.y), Quaternion.Euler(0, -90f, 0));
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 10f;
            zone.height = 6f;
            var camp = go.AddComponent<SupplyCamp>();
            camp.label = "铸神前殿 · 补给营";
            camp.safeRadius = 10f;
            camp.openShop = true;
            camp.restoreOnArrive = false;
            return camp;
        }

        /// <summary>熔池上一盏橙色点光（照亮鼎底和柱脚）、两座炉口各一盏；都不投影</summary>
        static void BuildLights(Transform env, QilinFurnace furnace)
        {
            void Add(string name, Vector3 at, float range, float intensity)
            {
                var l = new GameObject(name).AddComponent<Light>();
                l.transform.SetParent(env, false);
                l.transform.position = at;
                l.type = LightType.Point;
                l.color = new Color(1f, 0.5f, 0.2f);
                l.range = range;
                l.intensity = intensity;
                l.shadows = LightShadows.None;
            }
            Add("Pool Glow", furnace.Center + Vector3.up * 2f, 22f, 4f);
            foreach (var m in furnace.mouths)
                if (m)
                    Add($"Furnace Glow {m.name}", m.position + Vector3.up * 2f, 10f, 3f);
        }

        // ───────────── 验收 ─────────────

        /// <summary>
        /// 白盒自查：关键高度（殿内 0、池心 −1、渠床 −2.4、桥面 0、祭台 2.8、前殿 0）；熔岩渠与地面齐平、窄桥上没有熔岩；
        /// 外环跑道（半径 18.5 / 20.8 / 23）与熔池边（7.5–9.5）没有任何碰撞体；八根柱子在半径 13；
        /// 锁扣可见：殿内一圈采样点（半径 10 / 16 / 21，每 30°）各自至少看得到两个锁扣；殿墙、炉口、门楼、熔铁闸门、门楣
        /// </summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, LavaSet lava, HallSet hall, QilinFurnace furnace, QilinCauldron cauldron, GameObject gate, SupplyCamp camp)
        {
            rep.Section("地形与熔岩");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("殿内地面（东象限）", Y(new Vector2(16, 0)), 0, 0.3f);
            var trackSW = Ring(-160f, 20f);
            Near("外环跑道（西南偏南）", Y(new Vector2(trackSW.x, trackSW.z)), 0, 0.3f);
            Near("熔池心", Y(Vector2.zero), -PoolBed, 0.3f);
            Near("护城渠床", Y(new Vector2(-18, -37)), -MoatBed, 0.4f);
            Near("护城渠桥面", Y(new Vector2(0, -37)), 0, 0.3f);
            Near("门楼门洞", Y(new Vector2(0, GateZ)), 0, 0.3f);
            Near("神龛西祭台", Y(new Vector2(-PlatC.x, PlatC.y)), PlatH, 0.35f);
            Near("前殿（补给营）", Y(Camp), 0, 0.5f);
            float rockE = Y(new Vector2(30, 0)), rockS = Y(new Vector2(-20, -105));
            if (rockE < 15f || rockS < 15f) rep.Fail($"岩壁不够高：殿外（30, 0）y = {rockE:F1}，前殿南崖线外 6 m（−20, −105）y = {rockS:F1}（应 ≥ 15，地形本身是边界）");
            else rep.Line($"✓ 岩壁：殿外 y = {rockE:F1}，前殿南 y = {rockS:F1}");
            rep.Line($"熔岩：熔池 r {PoolR}（熔岩面 {PoolLava}）、护城渠桥两侧 {lava.moat.Count} 片 {(lava.moat.Count > 0 && lava.moat[0] ? $"{lava.moat[0].size.x:F0} × {lava.moat[0].size.y:F1}" : "?")} m（熔岩面 {MoatLava}）、" +
                     $"熔岩渠 {lava.channels.Count} 段（宽 {ChannelHalf * 2} m，齐地，岸壳 {ChannelShoreWidth} m）");
            if (lava.moat.Count != 2) rep.Fail($"护城渠应为桥两侧 2 片熔岩，现在 {lava.moat.Count}");
            foreach (var m in lava.moat)
                if (m && m.Body.Contains(0, (MoatZ0 + MoatZ1) * 0.5f))
                    rep.Fail($"{m.name} 盖到了桥面上");
            if (lava.channels.Count != 8) rep.Fail($"熔岩渠应为 8 段（4 条 × 内外两段），现在 {lava.channels.Count}");
            // 窄桥（半径 12 m）上没有熔岩、渠上有
            int bridgeLava = 0, channelDry = 0;
            foreach (float yaw in ChannelYaws)
            {
                var b = Ring(yaw, (BridgeIn + BridgeOut) * 0.5f);
                foreach (var v in lava.channels)
                    if (v && v.Body.Contains(b.x, b.z))
                        bridgeLava++;
                var o = Ring(yaw, 19f);
                if (!lava.channels.Any(v => v && v.Body.Contains(o.x, o.z))) channelDry++;
            }
            if (bridgeLava > 0) rep.Fail($"{bridgeLava} 座窄桥（半径 12 m）上有熔岩");
            if (channelDry > 0) rep.Fail($"{channelDry} 条熔岩渠的外段（半径 19 m）没有熔岩");
            if (bridgeLava == 0 && channelDry == 0) rep.Line("✓ 四条熔岩渠：池边到半径 9.2 m、14.8 m 到殿墙是熔岩，半径 10–14 m 的窄桥没有");

            rep.Section("圆殿 / 跑道 / 锁扣");
            rep.Line($"殿墙板 {hall.walls.Count} 块、扶壁 {hall.buttresses.Count} 个、炉口 {hall.furnaces.Count} 座、门楣 {hall.lintels.Count} 段（白盒），门楼 {(hall.gateway ? hall.gateway.name : "（没有）")}");
            if (hall.furnaces.Count != 2) rep.Fail($"炉口应为 2 座，现在 {hall.furnaces.Count}");
            if (!hall.gateway) rep.Fail("南门楼没有摆出来");
            // 外环跑道与熔池边：竖直胶囊探一圈，打到任何碰撞体（地形以外）都不合格
            var blocked = new List<string>();
            foreach (var (r, radius) in new[] { (18.5f, 0.5f), (TrackR, 1.2f), (23f, 0.5f), (7.6f, 0.5f), (8.6f, 0.5f), (9.5f, 0.5f) })
                for (float yaw = 0; yaw < 360f; yaw += 4f)
                {
                    var p = Ring(yaw, r);
                    p.y = Y(new Vector2(p.x, p.z));
                    var hits = Physics.OverlapCapsule(p + Vector3.up * (radius + 0.25f), p + Vector3.up * 3f, radius, Layers.WorldMask, QueryTriggerInteraction.Ignore);
                    foreach (var h in hits)
                        if (h && !(h is TerrainCollider))
                        {
                            blocked.Add($"r {r:F1} @ {yaw:F0}°：{h.name}");
                            break;
                        }
                }
            if (blocked.Count > 0) rep.Fail($"外环跑道 / 熔池边有 {blocked.Count} 处被挡：{string.Join("；", blocked.Take(8))}");
            else rep.Line("✓ 外环跑道（半径 18.5–23 m）与熔池边（7.6–9.5 m）一圈没有任何碰撞体");
            // 锁扣可见：殿内采样点（眼高）到每个锁扣，世界层射线不被挡（柱子会挡一些）
            var locks = cauldron ? cauldron.locks : System.Array.Empty<QilinLock>();
            int worst = int.MaxValue;
            string worstAt = null;
            int samples = 0;
            foreach (float r in new[] { 10f, 16f, 21f })
                for (float yaw = 0; yaw < 360f; yaw += 30f)
                {
                    var p = Ring(yaw + 15f, r);
                    var eye = new Vector3(p.x, Y(new Vector2(p.x, p.z)) + 1.62f, p.z);
                    int seen = 0;
                    foreach (var l in locks)
                    {
                        if (!l) continue;
                        var to = l.transform.position - eye;
                        if (!Physics.Raycast(eye, to.normalized, to.magnitude - 1.0f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) seen++;
                    }
                    samples++;
                    if (seen >= worst) continue;
                    worst = seen;
                    worstAt = $"r {r:F0} @ {yaw + 15f:F0}°";
                }
            if (locks.Length != 4 || locks.Any(l => !l)) rep.Fail($"锁扣应为 4 个，现在 {locks.Count(l => l)}");
            if (worst < 2) rep.Fail($"有采样点只看得到 {worst} 个锁扣（{worstAt}）：环台任何位置都应至少看得到两个");
            else rep.Line($"✓ 锁扣（离地 {LockHeight} m）：殿内 {samples} 个采样点每处至少看得到 {worst} 个");
            if (!cauldron) rep.Fail("没有吊鼎");
            else rep.Line($"吊鼎：鼎身中心离地 {cauldron.hangHeight} m，链环模板 {(cauldron.linkTemplate ? cauldron.linkTemplate.name : "（没有：运行时程序链环）")}，锁扣 {string.Join(" / ", locks.Where(l => l).Select(l => l.name))}");
            if (!gate) rep.Fail("没有熔铁闸门");
            else rep.Line($"{(gate.CompareTag(LevelKit.PlaceholderTag) ? "⚠ 白盒" : "✓ 正式件")} 熔铁闸门 {gate.name}（BossEncounter 的门，开战升起）");
            if (!camp) rep.Fail("没有补给营");
            else rep.Line($"✓ 补给营「{camp.label}」安全区 {camp.safeRadius} m");
            if (!furnace) rep.Fail("没有炉心殿几何（QilinFurnace）");
            else rep.Line($"✓ 炉心殿：熔池 {furnace.poolRadius} m、殿墙 {furnace.wallRadius} m、跑道 {furnace.trackRadius} m、窄桥 {furnace.bridgeInner}–{furnace.bridgeOuter} m，" +
                          $"象限中线 {string.Join(" / ", Enumerable.Range(0, furnace.QuadrantCount).Select(i => $"{furnace.QuadrantYaw(i):F0}°"))}，炉口 {furnace.mouths.Length}、排烟口 {furnace.vents.Length}");
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查 3-4 自己的件（BossArena + QilinFurnace、BossEncounter、SupplyCamp 各 1，吊鼎 1、锁扣 4，没有 ExitPortal）。顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), arenas = Count<BossArena>(), furnaces = Count<QilinFurnace>(), encounters = Count<BossEncounter>(),
                camps = Count<SupplyCamp>(), cauldrons = Count<QilinCauldron>(), locks = Count<QilinLock>(), portals = Count<ExitPortal>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (arenas != 1 || furnaces != 1 || encounters != 1 || camps != 1) rep.Fail($"BossArena {arenas} / QilinFurnace {furnaces} / BossEncounter {encounters} / SupplyCamp {camps}（各应为 1）");
            if (cauldrons != 1 || locks != 4) rep.Fail($"吊鼎 {cauldrons}（应 1）、锁扣 {locks}（应 4）");
            // 最后一关：打完走胜利链，不立出口；场景里也不放 ExitPortal（没有目标的出口开局就会自己开着）
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（首领关的去向由 BossEncounter 结算后决定）");
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
            var stage = RunPlan.ForScene(ScenePath);
            rep.Line($"RunPlan：{(stage != null ? $"{stage.code} {stage.Label}，最后一关 {(RunPlan.IsFinal(stage) ? "✓（打完走胜利链）" : "✗")}" : "（不在 RunPlan 里）")}");
            if (stage == null || !RunPlan.IsFinal(stage)) rep.Warn("3-4 不是 RunPlan 的最后一关：BossEncounter 打完会立出口（Boss Exit 点在神龛前）");
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1、BossArena / QilinFurnace / BossEncounter / SupplyCamp 各 1、吊鼎 1、锁扣 4，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给 L5 规则集的声明：主线 出生 → 补给营 → 前殿北 → 桥中 → 门楼 → 入场点 → 东柱旁 → 神龛西祭台（坡道上去）→ 神龛前；
        /// 坡度（两条祭台坡道、祝融像祭台）；地标视线（前殿望门楼、入场点望巨鼎 / 神龛、东象限隔熔池望西锁扣）；
        /// 场地：补给营（缓冲）、炉心殿（≥ 4 处掩体、两层、要有坡道上得去的俯射层）；炉口召唤点按炭童查净空 / 有路；补给营的 7 个摊位按 ShopLayout 声明成交互点。
        /// 可玩区 = 开阔区往岩壁里 2 m，岩壁 3–6 m 内升到 30 m（escapeMargin 3 m）；第三章新模型暂缓，占位只提醒
        /// </summary>
        static LevelSpec Spec(LevelKit.TerrainSet set)
        {
            Vector3 G(Vector2 q, float dy = 0) => set.OnGround(q.x, q.y, dy);
            var spec = new LevelSpec
                {
                    id = "3-4", title = "祝融炉心", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = 3f, placeholders = PlaceholderPolicy.Warn,
                    slopePaths =
                    {
                        new SlopePath { name = "神龛西祭台坡道", points = new[] { new Vector2(-RampFoot.x, RampFoot.y), new Vector2(-RampTop.x, RampTop.y) } },
                        new SlopePath { name = "神龛东祭台坡道", points = new[] { RampFoot, RampTop } },
                        new SlopePath { name = "祝融像祭台", points = new[] { new Vector2(0, DaisC.y + DaisHalf.y + DaisSkirt + 0.5f), DaisC } },
                    },
                    sites =
                    {
                        new SiteSpec { name = "铸神前殿补给营（缓冲）", center = G(Camp), size = 24, combat = false },
                        new SiteSpec { name = "祝融炉心殿（首领场）", center = G(new Vector2(0, 2)), size = 60, minCover = 4, minLayers = 2, overlook = true },
                    },
                }
                .Route("出生 · 前殿", G(Spawn)).Route("补给营", G(Camp + new Vector2(-4, 0))).Route("前殿北 · 桥头", G(ForecourtN))
                .Route("护城渠桥", G(new Vector2(0, -37))).Route("门楼", G(new Vector2(0, -24))).Route("入场点", G(PlayerEntry))
                .Route("东柱旁", G(new Vector2(15.5f, 6))).Route("神龛西祭台", G(new Vector2(-PlatC.x, PlatC.y))).Route("神龛前", G(ExitAt))
                .Sight("前殿 → 门楼", G(ForecourtN + new Vector2(0, -4), 1.62f), new Vector3(0, 6f, -24.9f), 4, GatewayId)
                .Sight("入场点 → 巨鼎", G(PlayerEntry, 1.62f), new Vector3(0, HangHeight, 0), 3)
                .Sight("入场点 → 神龛", G(PlayerEntry, 1.62f), G(ShrineAt, 6f), 5, ShrineId)
                .Sight("东南象限 → 西锁扣（隔着熔池、从巨鼎旁边）", G(new Vector2(17, -8.5f), 1.62f), new Vector3(-LockR + 0.8f, LockHeight, 0), 3)
                .Sight("东祭台观台 → 熔池（隔着北口）", G(BalconyC + new Vector2(-0.6f, -0.6f), 1.62f), new Vector3(0, 0.5f, PoolR - 1f), 2)
                .Sight("西祭台观台 → 熔池（隔着北口）", G(new Vector2(-BalconyC.x + 0.6f, BalconyC.y - 0.6f), 1.62f), new Vector3(0, 0.5f, PoolR - 1f), 2);
            for (int i = 0; i < 2; i++)
            {
                var m = Ring((i == 0 ? -1 : 1) * FurnaceYaw, MouthR);
                spec.anchors.Add(new AnchorSpec { name = $"炉口召唤点 {(i == 0 ? "西" : "东")}（炭童）", pos = G(new Vector2(m.x, m.z)), enemies = new[] { "tantong" } });
            }
            var center = G(Camp);
            var stations = ShopLayout.Build(center, -90f, 7, 3);
            for (int i = 0; i < stations.Count; i++)
                spec.interactables.Add(new InteractSpec
                {
                    name = $"补给营摊位 {i + 1}", kind = "ShopStall", focus = stations[i].position + Vector3.up * (i == 3 ? 0.95f : 1.15f), radius = 2.3f,
                    footprint = new Vector3(ShopLayout.StallHalfWidth, 0.55f, 0.5f),
                });
            return spec;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-6f ? v.normalized : Vector3.forward;
        }
    }
}
