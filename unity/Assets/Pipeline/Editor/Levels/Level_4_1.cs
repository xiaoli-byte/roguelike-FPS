using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 4-1 折多垭口·天路草甸（docs/level-design/maps/4-1.md；docs/level-design/chuanzang-v1.md 第 2 节；docs/unity-ch4-port.md M1）：
    /// 网页 src/world/plateau/ 的开放盆地移植。关卡坐标 = 世界 XZ（米；x 向东、z 向北），网页 z 向南，换算一律 Unity (x, z) = 网页 (x, −z)，高程不变。
    ///   盆地约 620 × 510 m，地形 768 × 768 m（3 × 3 块，0.5 m 格），高度场是网页 terrain.ts 的逐式移植（Level_4_1.Field.cs）；
    ///   出生 · 道班 (−262, −214) → 6 个据点任意顺序：① 碉楼寨 ② 白塔溪谷 ③ 牧民营地（清守卫后点灵火）、④ 圣湖 ⑤ 冰川口 ⑥ 经幡山头
    ///   （领主据点：化蛇 / 飞廉 / 夔，BossEncounter 据点模式，打败领主自动点亮灵火）→ 点亮任意 3 处灵火，⑦ 垭口经幡门 (272, 187) 里的出口升起。
    /// 边界（没有空气墙）：离盆地轮廓 24 m 起风雪软边界（冰原主题白化），环山主坡挡在外面。
    /// 第四章场景件只有夔的残鼓有模型，其余地标都是带 Placeholder 标签的白盒（Level_4_1.Landmarks.cs，资产 id 见 maps/4-1.md 第 9 节）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 4-1 折多垭口（或 bridge.sh level 4-1）。冒烟：bridge.sh playtest map-4-1（Map41Suite）。
    /// </summary>
    [LevelBuilder("4-1", ScenePath)]
    public static partial class Level_4_1
    {
        public const string Dir = "Assets/Levels/L4_1_Zheduo";
        public const string ScenePath = "Assets/Scenes/L4_1_Zheduo.unity";
        const string Name = "L4_1";

        // ───────────── 尺度 ─────────────
        static readonly Vector2 Origin = new(-384, -384), Size = new(768, 768);
        const double Step = 0.5;
        const float Eye = 1.62f;
        /// <summary>离盆地轮廓多远起风雪（网页 MAP.softBoundary）：软边界的等值线就在这条线上</summary>
        const float SoftBoundary = 24f;
        /// <summary>垭口出口在盆地轮廓外 21 m：等值线在垭口另外让出一个圆（半径 30 m）</summary>
        const double PassDiscX = 262, PassDiscZ = -186, PassDiscR = 30;

        // ───────────── 遇敌（combat 5.1，网页 spec.ENCOUNTERS）─────────────
        sealed class Enc
        {
            public string id, site, title, hint;
            public double x, z, r;
            public (string kind, double x, double y, double z, bool sentinel)[] units;
        }

        static readonly Enc[] Encounters =
        {
            new()
            {
                id = "e1", site = "s1", title = "碉楼寨兽群", x = -180, z = -28, r = 42, hint = "连鼓灵给同伴上护盾——先打它，再上屋顶打举父，最后收拾天狗",
                units = new (string kind, double x, double y, double z, bool sentinel)[] { ("jufu", -181, 6.9, -27, false), ("jufu", -206, 6.9, -24, false), ("tiangou", -160, 0, -6, false), ("tiangou", -152, 0, -14, false), ("tiangou", -166, 0, -20, false), ("liangu", -192, 3.2, -40, false) },
            },
            new()
            {
                id = "e2", site = "s2", title = "白塔溪谷兽群", x = -8, z = 50, r = 36, hint = "先点巨石上的哨兵，别让它尖啸叫醒附近；电网里点火能连环焚雷",
                units = new (string kind, double x, double y, double z, bool sentinel)[]
                {
                    ("marmot", -12, 2.4, 46, true), ("marmot", -16, 0, 38, false), ("marmot", -6, 0, 33, false), ("marmot", 3, 0, 39, false), ("marmot", -20, 0, 45, false), ("marmot", 7, 0, 49, false),
                    ("dijiang", 6, 0, 74, false), ("dijiang", 12, 0, 80, false), ("dijiang", 1, 0, 82, false),
                },
            },
            new()
            {
                id = "e3", site = "s3", title = "牧民营地兽群", x = 150, z = 108, r = 46, hint = "獓狠冲锋前有冲撞线——横移让开，帐篷是掩体",
                units = new (string kind, double x, double y, double z, bool sentinel)[] { ("aoyin", 168, 0, 92, false), ("leiyak", 178, 0, 100, false), ("leiyak", 160, 0, 82, false), ("dijiang", 118, 0, 140, false), ("dijiang", 124, 0, 148, false) },
            },
            new()
            {
                id = "e4", site = "s4", title = "圣湖岸兽群", x = -132, z = -146, r = 60, hint = "先清岸上，再去湖边——化蛇在湖里",
                units = new (string kind, double x, double y, double z, bool sentinel)[] { ("manman", -140, 9, -150, false), ("manman", -130, 13, -158, false), ("tiangou", -100, 0, -118, false), ("tiangou", -94, 0, -112, false), ("tiangou", -106, 0, -110, false), ("liangu", -172, 3.4, -122, false) },
            },
            new()
            {
                id = "e5", site = "s5", title = "冰川口兽群", x = 40, z = -190, r = 40, hint = "冰碛垄上的举父最难缠：先上垄",
                units = new (string kind, double x, double y, double z, bool sentinel)[]
                {
                    ("jufu", 6, 0.2, -212, false), ("jufu", 76, 0.2, -212, false), ("marmot", 28, 1.6, -168, true), ("marmot", 22, 0, -156, false), ("marmot", 34, 0, -154, false),
                    ("marmot", 30, 0, -162, false), ("manman", 42, 10, -188, false),
                },
            },
            new()
            {
                id = "e6", site = "s6", title = "经幡山头兽群", x = 92, z = -64, r = 34, hint = "山坡上打；落雷时站到经幡杆旁",
                units = new (string kind, double x, double y, double z, bool sentinel)[]
                {
                    ("liangu", 86, 3.2, -76, false), ("tiangou", 104, 0, -50, false), ("tiangou", 110, 0, -58, false), ("tiangou", 98, 0, -44, false), ("tiangou", 112, 0, -46, false),
                    ("dijiang", 70, 0, -58, false), ("dijiang", 74, 0, -50, false),
                },
            },
            new()
            {
                id = "e7", site = "pass", title = "垭口守卫", x = 250, z = -172, r = 30, hint = "出口前的考试：避风屋顶上有举父",
                units = new (string kind, double x, double y, double z, bool sentinel)[] { ("aoyin", 242, 0, -158, false), ("leiyak", 232, 0, -150, false), ("jufu", 266, 2.7, -194, false) },
            },
        };

        /// <summary>穷奇巡视线（网页 spec.ROAMER）：10 个路点 + 巢穴，5 m/s</summary>
        static readonly (double x, double z)[] RoamerPath = { (-60, -95), (10, -30), (70, 20), (178, 40), (178, 165), (20, 158), (-100, 168), (-172, 148), (-248, 40), (-150, -60) };
        static readonly (double x, double z) RoamerLair = (-212, -196);

        static StationRole RoleOf(string kind) => kind switch
        {
            "tiangou" => StationRole.Flank,
            "jufu" => StationRole.Artillery,
            "manman" => StationRole.Ranged,
            "liangu" => StationRole.Support,
            _ => StationRole.Assault,
        };

        // ───────────── 构建期 ─────────────
        static Basin field;
        static LevelKit.TerrainSet ts;
        static float baseHeight;

        static Vector2 U(double x, double z) => new((float)x, (float)-z);
        static Vector3 G(Vector2 u, float dy = 0) => new(u.x, GroundY(u) + dy, u.y);
        static Vector3 GW(double x, double z, float dy = 0) => G(U(x, z), dy);
        static float YawZ(Vector2 d) => Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg;

        static int Cell(Vector2 u)
        {
            int i = Mathf.Clamp(field.I(u.x), 0, field.nx - 1), j = Mathf.Clamp(field.J(-u.y), 0, field.nz - 1);
            return field.Idx(i, j);
        }

        /// <summary>地形取样（Unity XZ）：地形格点和高度场格点重合，直接取格点</summary>
        static LevelKit.Sample Eval(Vector2 p)
        {
            int k = Cell(p);
            return new LevelKit.Sample
            {
                h = field.h[k] + baseHeight, gravelBias = field.wGrass[k], packed = field.wSoil[k], sand = field.wSnow[k], rock = field.wRock[k],
                fluid = field.fluid[k], shore = field.shore[k],
            };
        }

        /// <summary>离游玩区边界的距离（界内为正，米）：离盆地轮廓 24 m 的线 + 垭口一个圆</summary>
        static float Inside(Vector2 u)
        {
            float d = SoftBoundary - field.basin[Cell(u)];
            float pass = (float)(PassDiscR - Math.Sqrt((u.x - PassDiscX) * (u.x - PassDiscX) + (-u.y - PassDiscZ) * (-u.y - PassDiscZ)));
            return Mathf.Max(d, pass);
        }

        /// <summary>可玩区遮罩（软边界与 L5 共用）：0.5 = 等值线</summary>
        static float Playable(Vector2 u) => Landform.Smooth(-4, 4, Inside(u));

        static LevelKit.BoundarySpec boundary;

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 4-1 折多垭口", priority = 81)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成高度场 → 地形 → 远景 → 水 → 软边界 / 天气 → 地标白盒 → 经幡 / 导体 → 散布 → 灵火坛、遇敌、领主擂台、出口 → 烘焙 → 验收 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = LevelKit.PlateauTheme;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            LevelKit.ResetPlateauCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var arch = new GameObject("Architecture").transform;
            var props = new GameObject("Props").transform;
            var world = new GameObject("World").transform;
            var markers = new GameObject("Markers").transform;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            field = new Basin(Origin.x, Origin.x + Size.x, Step);
            field.Generate();
            var (lo, hi) = field.Range();
            baseHeight = Mathf.Ceil(-lo + 2);
            float heightRange = Mathf.Ceil(hi + baseHeight + 4);
            Debug.Log($"[Level] 4-1 高度场 {field.nx} × {field.nz}（{Step} m）{sw.Elapsed.TotalSeconds:F1} s：y {lo:F1}…{hi:F1}，湖面 {string.Join(" / ", field.lakeLevel.Select(v => v.ToString("F2")))}，" +
                      $"天路 {field.road[^1].s:F0} m，挡土墙段 {field.walls.Count}，木桥 {field.bridges.Count}");
            flags = new LevelKit.PrayerFlags { wind = new Vector2(1, -0.35f).normalized };
            poles = new List<(Vector3, float, bool)>();
            roofs = new List<(Vector2, float, float, Vector3)>();
            conductors = new List<(string, Vector3, float)>();
            hotPools = new List<(Vector3, float)>();
            sangSmoke = null;
            boundary = LevelKit.BoundarySpec.Default;
            boundary.theme = "Frost";
            boundary.wallBottom = lo - 30;
            boundary.wallTop = hi + 40;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            RenderSettings.fogStartDistance = theme.fogStart;
            RenderSettings.fogEndDistance = theme.fogEnd;
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = baseHeight, heightRange = heightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(3, 3), ground = LevelKit.PlateauGround, eval = Eval,
            }, env);
            try
            {
                var sun = Quaternion.Euler(theme.sunEuler) * Vector3.forward;
                BuildBackdrop(env, -sun, theme.fogColor);
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), boundary);
                var weather = LevelKit.Weather(env, theme, new Vector2(1, -0.35f), 0.3f);
                weather.whiteoutProfile = WeatherProfiles.WhiteoutFrost;

                BuildLandmarks(arch, props);
                var water = BuildWater(world);
                var walls = BuildRetainingWalls(arch);
                BuildBridges(arch);
                var conductorRoot = new GameObject("Conductors · 导体").transform;
                conductorRoot.SetParent(world, false);
                int poleCount = BuildPoles(props, conductorRoot);
                var flagsGo = flags.Build(Dir, Name, props);
                if (sangSmoke is { } smoke) LevelKit.Smoke(Dir, env, smoke, new Color(0.96f, 0.96f, 0.94f, 0.9f));
                BuildScatter(env);

                // 玩家在 Core 场景（L1）：这里只放出生标记（面朝经幡山头的拉则）+ 自举标记
                var spawnAt = GW(-262, 214, 0.05f);
                var look = lhatseTop - spawnAt;
                look.y = 0;
                var spawnRot = Quaternion.LookRotation(look.normalized);
                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

                Physics.SyncTransforms();
                var sites = BuildEncounters(markers);
                var altars = BuildAltars(markers, sites);
                var objective = BuildObjective(markers, sites, altars);
                var lords = BuildLords(markers, sites, altars, water);
                BuildWindAndRoamer(markers, sites, lords);
                var portal = BuildExit(markers, objective);
                BuildMarkers(markers);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
                LevelKit.BakeNavMesh(Dir, Name, env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                var rep = new LevelKit.Report();
                rep.Line("4-1 折多垭口·天路草甸 · 验收");
                rep.Line($"高度场 {field.nx} × {field.nz}（{Step} m），y {lo:F1}…{hi:F1}，地形 3 × 3 块（基准 {baseHeight} m、量程 {heightRange} m），生成 {sw.Elapsed.TotalSeconds:F0} s");
                rep.Line($"高度：出生 {GW(-262, 214).y:F1}，① {GW(-185, -32).y:F1}，② {GW(-30, 64).y:F1}，③ {GW(140, 125).y:F1}，④ 圣湖水面 {field.lakeLevel[0]:F2}，⑤ {GW(42, -186).y:F1}，" +
                         $"⑥ 拉则 {GW(90, -70).y:F1}，⑦ 垭口 {GW(252, -178).y:F1}，飞廉擂台 {GW(40, -228).y:F1}");
                CheckWebHeights(rep);
                CheckOpenness(rep);
                CheckRoadAndWater(rep, water, walls, poleCount, flagsGo);
                CheckLords(rep, lords);
                CheckSceneContents(rep, scene, portal, objective, altars, sites);
                LevelValidator.Run(Spec(), rep);
                rep.Section("资产缺口（白盒，maps/4-1.md 第 9 节）");
                foreach (var kv in LevelKit.PlateauPlaceholders.OrderByDescending(kv => kv.Value)) rep.Line($"    · {kv.Key} ×{kv.Value}");
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_4-1_report.txt");

                if (review) Review(spawnAt, spawnRot);
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
                field = null;
                flags = null;
                poles = null;
            }
        }

        // ───────────── 远景 ─────────────

        /// <summary>
        /// 远景：网页 backdrop.ts 的贡嘎主峰 + 九座雪峰 / 绿丘 + 一圈远山 + 外围地形。网页的远山在 1.1–3 km 外，Unity 相机远裁面 1500 m：
        /// 每座峰沿原方向缩到 ≤ 1050 m（高、底半径等比缩，角大小不变）；远山环 950–1450 m；外围地形 1.4 km
        /// </summary>
        static void BuildBackdrop(Transform env, Vector3 toSun, Color horizon)
        {
            var src = new (double x, double z, double h, double r, int ridges, double sharp, double seed, double snow, double green)[]
            {
                (GonggaX, GonggaZ, GonggaH, GonggaR, 3, 1.55, 1.3, 0.38, 0), (230, -1560, 430, 560, 4, 1.3, 2.1, 0.45, 0.2), (720, -1880, 520, 640, 3, 1.4, 3.7, 0.42, 0),
                (940, -1460, 380, 560, 4, 1.2, 4.4, 0.5, 0.2), (40, -1760, 360, 600, 3, 1.25, 5.2, 0.5, 0.2), (580, -1360, 250, 460, 5, 1.15, 6.6, 0.6, 0.35),
                (1350, -760, 300, 560, 4, 1.3, 7.9, 0.5, 0.2), (-950, -1050, 260, 620, 4, 1.15, 8.3, 0.6, 0.4), (-1150, 560, 170, 700, 5, 1.0, 9.1, 1.4, 1),
                (220, 1300, 150, 760, 5, 1.0, 10.4, 1.4, 1),
            };
            var peaks = src.Select(s =>
            {
                double d = Math.Sqrt(s.x * s.x + s.z * s.z), k = Math.Min(1, GonggaDistance / d), ks = k * (k < 1 ? 1.12 : 1);
                return new LevelKit.PlateauPeak
                {
                    at = U(s.x * k, s.z * k), height = (float)(s.h * ks), radius = (float)(s.r * ks), ridges = s.ridges, sharp = (float)s.sharp, seed = (float)s.seed,
                    snow = (float)s.snow, green = (float)s.green,
                };
            }).ToList();
            LevelKit.PlateauMountains(Dir, Name, env, Vector2.zero, 0, peaks, 950, 1450, (x, z) => (float)GonggaWindow(x, -z), toSun, horizon);
            LevelKit.PlateauFarTerrain(Dir, Name, env, new Rect(Origin, Size), (x, z) => GroundY(new Vector2(x, z)), EdgeColor,
                (x, z) => (float)Math.Max(GonggaWindow(x, -z), PassWindow(x, -z)), toSun, horizon);
        }

        /// <summary>远景里贡嘎离地图中心的距离（网页 1608 m 缩到 1050 m，系数 0.653）</summary>
        const double GonggaDistance = 1050;
        static double GonggaScale => GonggaDistance / Math.Sqrt(GonggaX * GonggaX + GonggaZ * GonggaZ);
        /// <summary>远景贡嘎主峰上的视线目标（网页 GONGGA.height − 260 按比例换算）</summary>
        static Vector3 GonggaTarget => new((float)(GonggaX * GonggaScale), (float)((GonggaH - 260) * GonggaScale - 60), (float)(-GonggaZ * GonggaScale));

        /// <summary>地形边缘的地表色（外围地形接缝用）：四层权重 × 四层的代表色</summary>
        static Color EdgeColor(float x, float z)
        {
            int k = Cell(new Vector2(x, z));
            var c = new Color(0.36f, 0.58f, 0.21f) * field.wGrass[k] + new Color(0.6f, 0.5f, 0.37f) * field.wSoil[k] + new Color(0.9f, 0.93f, 0.96f) * field.wSnow[k]
                    + new Color(0.5f, 0.48f, 0.45f) * field.wRock[k];
            float s = field.wGrass[k] + field.wSoil[k] + field.wSnow[k] + field.wRock[k];
            return s > 0.01f ? c / s : c;
        }

        // ───────────── 水 ─────────────

        sealed class Water
        {
            public WaterVolume holyLake, glacialLake;
            public List<WaterVolume> river = new(), springs = new();
            public GameObject riverSurface;
        }

        /// <summary>
        /// 水体（L8 WaterVolume）：圣湖、冰湖是深水（湖心深于 1.3 m 托回）；冰川河按河段切成一串水体（每段 4 个采样点约 8 m，水面取这段上游端，
        /// 涉水减速、能走过去），外观是一条沿河的水面带（一个网格）；温泉三个浅池
        /// </summary>
        static Water BuildWater(Transform world)
        {
            LevelKit.EnsureWorldMaterials();
            var mat = AssetDatabase.LoadAssetAtPath<Material>($"{LevelKit.WorldMaterialDir}/{WorldMaterials.AssetName(WorldMaterialKind.Water)}.mat");
            var w = new Water();
            // 圣湖的水体盒子水平尺寸正好是湖的椭圆（2 rx × 2 rz，朝向 = 网页 rot）：化蛇（B1 HuasheLake）拿它当湖的椭圆，游线 = 椭圆 × 0.62（网页 swimPos）；
            // 椭圆外的盒角都在湖岸地面下面（湖岸 r > 1 的地面高于水面），水只在湖里。冰湖不读，照旧放宽到 2.3 倍
            WaterVolume Lake(string name, int n, double span)
            {
                var L = Lakes[n];
                double level = field.lakeLevel[n];
                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = name;
                block.transform.SetParent(world, false);
                var c = U(L.x, L.z);
                block.transform.SetPositionAndRotation(new Vector3(c.x, 0, c.y), Quaternion.Euler(0, (float)(L.rot * Mathf.Rad2Deg), 0));
                block.transform.localScale = new Vector3((float)(L.rx * span), 1, (float)(L.rz * span));
                float depth = (float)L.depth + 1.5f;
                return LevelKit.WaterBody(block, (float)level - depth, depth);
            }
            w.holyLake = Lake("Water_HolyLake", 0, 2.0);
            w.glacialLake = Lake("Water_GlacialLake", 1, 2.3);

            var river = new GameObject("Water_GlacialRiver · 冰川河").transform;
            river.SetParent(world, false);
            var S = field.river;
            // 河段：最长 4 个采样点（约 8 m），段内水面落差超过 0.2 m 就断开（陡的河段切得更碎，段尾不会因为水面取上游端而变成深水）
            for (int i = 0, idx = 0; i + 1 < S.Count; idx++)
            {
                int j = i + 1;
                while (j < S.Count - 1 && j - i < 4 && field.riverWater[i] - field.riverWater[j + 1] <= 0.2) j++;
                var a = U(S[i].x, S[i].z);
                var b = U(S[j].x, S[j].z);
                float top = (float)field.riverWater[i], bed = (float)Enumerable.Range(i, j - i + 1).Min(k => field.riverBed[k]);
                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = $"River_{idx}";
                block.transform.SetParent(river, false);
                var mid = (a + b) * 0.5f;
                block.transform.SetPositionAndRotation(new Vector3(mid.x, 0, mid.y), Quaternion.Euler(0, YawZ(b - a), 0));
                block.transform.localScale = new Vector3((float)(ChannelHalf + 2.2) * 2, 1, Vector2.Distance(a, b) + 1.5f);
                var v = LevelKit.WaterBody(block, bed - 0.3f, top - bed + 0.3f);
                // 河是涉水的（网页：水深 0.85 m 能蹚过去）：急弯处相邻两段的水体叠在一起，局部能到 1.4 m，深水线放到 1.8 m（只减速，不托回）
                v.deep = 1.8f;
                Object.DestroyImmediate(block.GetComponent<MeshRenderer>());
                Object.DestroyImmediate(block.GetComponent<MeshFilter>());
                w.river.Add(v);
                i = j;
            }
            // 水面带：河槽两岸各 ChannelHalf + 1.6 m，水面高 = 采样点的水面
            var verts = new List<Vector3>();
            var tris = new List<int>();
            float half = (float)ChannelHalf + 1.6f;
            for (int i = 0; i < S.Count; i++)
            {
                var c = U(S[i].x, S[i].z);
                var n = new Vector2((float)S[i].tz, (float)S[i].tx); // 网页法线 (−tz, tx) 换到 Unity（z 取反）
                float y = (float)field.riverWater[i];
                verts.Add(new Vector3(c.x - n.x * half, y, c.y - n.y * half));
                verts.Add(new Vector3(c.x + n.x * half, y, c.y + n.y * half));
                if (i == 0) continue;
                int o = (i - 1) * 2;
                tris.AddRange(new[] { o, o + 2, o + 1, o + 1, o + 2, o + 3 });
            }
            // 两面都画（法线方向不确定时），水面着色器按世界坐标起涟漪
            int nv = tris.Count;
            for (int t = 0; t < nv; t += 3) tris.AddRange(new[] { tris[t], tris[t + 2], tris[t + 1] });
            var mesh = new Mesh { name = $"RiverSurface_{Name}", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(verts);
            mesh.SetNormals(verts.Select(_ => Vector3.up).ToList());
            mesh.SetUVs(0, verts.Select(p => new Vector2(p.x, p.z)).ToList());
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            LevelKit.SaveAsset(mesh, $"{Dir}/RiverSurface_{Name}.asset");
            var surf = new GameObject("River Surface · 水面");
            surf.transform.SetParent(river, false);
            surf.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = surf.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            w.riverSurface = surf;

            int s = 0;
            foreach (var (surface, r) in hotPools)
            {
                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = $"Water_HotSpring_{++s}";
                block.transform.SetParent(world, false);
                block.transform.position = new Vector3(surface.x, 0, surface.z);
                block.transform.localScale = new Vector3(r * 1.7f, 1, r * 1.7f);
                w.springs.Add(LevelKit.WaterBody(block, surface.y - 0.45f, 0.45f));
            }
            return w;
        }

        // ───────────── 散布 ─────────────

        /// <summary>
        /// 散布（Terrain 细节，网页 scatter.ts 的规则）：草丛按长草程度（草甸权重 × 陡坡淡出，盆地外 40 m 内淡出）、野花成片、
        /// 高山杜鹃在盆地边缘的山脚和丘坡上成丛、碎石在陡坡和环山；路面、水里、建筑底下都没有（土石层权重高的地方长草少）
        /// </summary>
        static void BuildScatter(Transform env)
        {
            float Fade(int k)
            {
                float d = field.basin[k];
                return d > 45 ? 0 : d <= 0 ? 1 : 1 - Landform.Smooth(0, 40, d) + 0.05f;
            }
            float Slope(Vector2 u) => (float)field.SlopeAt(u.x, -u.y);
            var grass = LevelKit.PlateauGrassPrefab("PlateauGrass", new Color(0.47f, 0.6f, 0.28f), 5, 0.9f, 0.05f, 31);
            var grassDark = LevelKit.PlateauGrassPrefab("PlateauGrassDeep", new Color(0.34f, 0.5f, 0.23f), 7, 1.1f, 0.06f, 37);
            var flowerPink = LevelKit.PlateauFlowerPrefab("PlateauFlowerPink", new Color(0.78f, 0.47f, 0.68f), 41);
            var flowerYellow = LevelKit.PlateauFlowerPrefab("PlateauFlowerYellow", new Color(0.9f, 0.78f, 0.32f), 43);
            var bush = LevelKit.PlateauBushPrefab("PlateauRhododendron", new Color(0.23f, 0.39f, 0.19f), 47);
            var bloom = LevelKit.PlateauBushPrefab("PlateauRhododendronBloom", new Color(0.66f, 0.35f, 0.48f), 53);
            var scree = LevelKit.ScatterPrefab(new LevelKit.ScatterRule { name = "PlateauScree", placeholder = LevelKit.Placeholder.SnowRock, seed = 61 });
            float Patch(Vector2 u, int seed) => (float)LevelKit.PlateauNoise.Fbm(u.x * 0.04 + 7, -u.y * 0.04 - 3, 2, seed);
            float BushP(Vector2 u)
            {
                int k = Cell(u);
                float d = field.basin[k], sl = Slope(u);
                if (field.wGrass[k] < 0.3f || sl > 0.65f || field.fluid[k] > 0) return 0;
                return (d > -25 && d < 30 ? 1 : 0.16f) * Landform.Smooth(0.1f, 0.35f, sl + 0.15f);
            }
            var layers = new List<LevelKit.PlateauDetailLayer>
            {
                new() { name = "PlateauGrass", prefab = grass, perHundredSqm = 90, scale = new(0.45f, 0.85f), seed = 3,
                    density = u => { int k = Cell(u); return field.fluid[k] > 0 ? 0 : field.grassDensity[k] * Fade(k); } },
                new() { name = "PlateauGrassDeep", prefab = grassDark, perHundredSqm = 18, scale = new(0.7f, 1.1f), seed = 5,
                    density = u => { int k = Cell(u); return field.fluid[k] > 0 ? 0 : field.grassDensity[k] * Fade(k) * Landform.Smooth(0.45f, 0.7f, Patch(u, 29)); } },
                new() { name = "PlateauFlowerPink", prefab = flowerPink, perHundredSqm = 30, scale = new(0.7f, 1.2f), seed = 7,
                    density = u => { int k = Cell(u); return field.grassDensity[k] > 0.5f && field.basin[k] < 20 ? Landform.Smooth(0.58f, 0.8f, Patch(u, 31)) : 0; } },
                new() { name = "PlateauFlowerYellow", prefab = flowerYellow, perHundredSqm = 30, scale = new(0.7f, 1.2f), seed = 9,
                    density = u => { int k = Cell(u); return field.grassDensity[k] > 0.5f && field.basin[k] < 20 ? Landform.Smooth(0.6f, 0.82f, Patch(u, 32)) : 0; } },
                new() { name = "PlateauRhododendron", prefab = bush, perHundredSqm = 3f, scale = new(0.55f, 1.2f), alignToGround = 0.3f, seed = 11, density = BushP },
                new() { name = "PlateauRhododendronBloom", prefab = bloom, perHundredSqm = 0.9f, scale = new(0.55f, 1.1f), alignToGround = 0.3f, seed = 13, density = BushP },
                new() { name = "PlateauScree", prefab = scree, perHundredSqm = 1.2f, scale = new(0.4f, 1.5f), seed = 17,
                    density = u => { int k = Cell(u); if (field.fluid[k] > 0 || field.basin[k] > 70) return 0; float sl = Slope(u); return (sl > 0.6f ? 1 : 0.2f) + (field.basin[k] > 8 ? 0.3f : 0); } },
            };
            var counts = LevelKit.PlateauDetails(ts, layers, 1f, 90f);
            Debug.Log($"[Level] 4-1 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}");
            scatterCounts = counts;
        }

        static Dictionary<string, int> scatterCounts;

        // ───────────── 遇敌、灵火坛、目标 ─────────────

        /// <summary>在不在湖的椭圆里（含湖心岛：岛四面是深水，导航网格上是孤岛）</summary>
        static bool InLake(double x, double z)
        {
            foreach (var L in Lakes)
            {
                double dx = x - L.x, dz = z - L.z, c = Math.Cos(L.rot), sn = Math.Sin(L.rot);
                if (Math.Sqrt(Math.Pow((dx * c + dz * sn) / L.rx, 2) + Math.Pow((-dx * sn + dz * c) / L.rz, 2)) < 1.25) return true;
            }
            return false;
        }

        /// <summary>
        /// 离 (x, z)（网页坐标）最近的一处能站的地面：没水、不在湖里（湖心岛是孤岛）、坡度 ≤ 20°、放得下第四章最大的雷魅（连鼓灵半径 1.2 m、高 2.4 m），
        /// 螺旋往外找 20 m
        /// </summary>
        static Vector3 DryNear(double x, double z)
        {
            for (float r = 0; r <= 20; r += 1.5f)
            {
                int n = r < 0.1f ? 1 : Mathf.Max(6, Mathf.RoundToInt(r * 2.5f));
                for (int i = 0; i < n; i++)
                {
                    double a = i * Math.PI * 2 / n;
                    double px = x + Math.Cos(a) * r, pz = z + Math.Sin(a) * r;
                    if (field.WaterDepthAt(px, pz) > 0.05 || field.SlopeAt(px, pz) > 20 * Mathf.Deg2Rad || InLake(px, pz)) continue;
                    var g = GW(px, pz);
                    if (Physics.CheckCapsule(g + Vector3.up * 1.6f, g + Vector3.up * 2.4f, 1.2f, ~0, QueryTriggerInteraction.Ignore)) continue;
                    return g;
                }
            }
            return GW(x, z);
        }

        /// <summary>
        /// 七处遇敌（combat 5.1）：每处一个 EncounterSite，兽群一波（网页是整片领地一起醒）；触发圈 = 领地半径 × 0.75，场地半径 = 领地半径。
        /// 都是可选场地（目标只看灵火）；①②③ 的守卫场地肃清后才能点灵火，④⑤⑥ 暂时也由岸上兽群守（B1 的据点模式接上后改成只由领主点亮）。
        /// 站位照网页每只怪的位置：举父的屋顶站位贴到民居 / 避风屋的屋顶（石梯上得去），其余贴到附近能站的干地上（飞行的蛮蛮、连鼓灵出生后自己升空）
        /// </summary>
        static Dictionary<string, EncounterSite> BuildEncounters(Transform markers)
        {
            var root = new GameObject("Encounters").transform;
            var result = new Dictionary<string, EncounterSite>();
            foreach (var e in Encounters)
            {
                var c = U(e.x, e.z);
                var site = new GameObject($"Site {e.id} · {e.title}").AddComponent<EncounterSite>();
                site.transform.SetParent(root, false);
                site.transform.position = G(c);
                site.title = e.title;
                site.triggerRadius = (float)e.r * 0.75f;
                site.arenaRadius = (float)e.r;
                site.optional = true;
                site.requires = Array.Empty<EncounterSite>();
                site.reward = e.site switch { "s1" => "weapon", "s2" => "scroll", "s3" => "upgrade", "pass" => "", _ => "scroll" };
                // 肃清宝箱落在灵火坛旁边（领地中心常常在房子 / 白塔底下）
                var ss = SiteById(e.site);
                if (ss.altar is { } al)
                {
                    var aU = U(al.x, al.z);
                    var toC = (c - aU).normalized;
                    var chest = DryNear(al.x + toC.x * 3.5, al.z - toC.y * 3.5);
                    site.chestOffset = chest - site.transform.position;
                }
                var entries = e.units.GroupBy(u => u.kind).Select(g => EncounterSpec.E(g.Key, g.Count())).ToArray();
                site.spec = EncounterSpec.Of(EncounterSpec.Wave(e.title, entries).Hint(e.hint)).Gather(0.4f).Distance(6, (float)e.r + 10);
                var anchors = new List<Transform>();
                int k = 0;
                foreach (var u in e.units)
                {
                    var uu = U(u.x, u.z);
                    Vector3 at;
                    bool elevated = false;
                    var roof = roofs.Where(r => Vector2.Distance(r.xz, uu) < r.radius).Select(r => ((Vector2, float, float, Vector3)?)r).FirstOrDefault();
                    if (u.kind == "jufu" && u.y > 2 && roof is { } rf)
                    {
                        // 屋顶站位：让开屋顶小经堂（网页局部 (2.5, 2.0)），落在楼梯口这一侧
                        at = rf.Item4;
                        elevated = true;
                    }
                    else at = DryNear(u.x, u.z);
                    var go = new GameObject($"Enemy_{e.id}_{++k}_{u.kind}{(u.sentinel ? "_sentinel" : "")}");
                    go.transform.SetParent(markers, false);
                    go.transform.position = at;
                    var sa = go.AddComponent<SpawnAnchor>();
                    float ang = Mathf.Atan2(at.z - c.y, at.x - c.x);
                    sa.role = u.sentinel ? StationRole.Precision : RoleOf(u.kind);
                    sa.lane = Mathf.FloorToInt(Mathf.Repeat(ang + Mathf.PI, Mathf.PI * 2) / (Mathf.PI * 2 / 3)) % 3;
                    sa.elevated = elevated;
                    sa.spread = elevated ? 1.2f : 2f;
                    anchors.Add(go.transform);
                }
                site.anchors = anchors.ToArray();
                result[e.site] = site;
            }
            return result;
        }

        /// <summary>领主据点（④ 化蛇 ⑤ 飞廉 ⑥ 夔）：灵火坛只由领主点亮，岸上 / 坡上的兽群是可选遇敌，不当守卫</summary>
        static readonly HashSet<string> LordSites = new() { "s4", "s5", "s6" };

        /// <summary>
        /// 六座灵火坛（SpiritAltar：按住 1.2 s 点亮，点亮回满血 + 复活点），面朝据点中心。
        /// ①②③ 守卫肃清前点不着；④⑤⑥ 不挂守卫，由 ZheduoLevel 封着（打败领主、据点结算时 BossEncounter 点亮）
        /// </summary>
        static Dictionary<string, SpiritAltar> BuildAltars(Transform markers, Dictionary<string, EncounterSite> sites)
        {
            var root = new GameObject("Spirit Altars · 灵火坛").transform;
            root.SetParent(markers, false);
            var result = new Dictionary<string, SpiritAltar>();
            int i = 0;
            foreach (var s in Sites.Where(s => s.altar.HasValue))
            {
                var (ax, az) = s.altar.Value;
                var at = GW(ax, az);
                var face = U(s.x, s.z) - U(ax, az);
                var alt = new GameObject($"Altar_{++i}_{s.id}").AddComponent<SpiritAltar>();
                alt.transform.SetParent(root, false);
                alt.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(face.x, 0, face.y).normalized));
                alt.title = $"灵火坛 · {s.name}";
                alt.guard = !LordSites.Contains(s.id) && sites.TryGetValue(s.id, out var g) ? g : null;
                alt.lightOnGuardCleared = false;
                // 四根小石柱挂竖幡（网页 altar 的四角）：只做外观，不挡交互
                var posts = LevelKit.PlateauPiece(Dir, IdAltarPosts, "altarPosts", alt.transform, at, alt.transform.eulerAngles.y, 0, b =>
                {
                    for (int k = 0; k < 4; k++)
                    {
                        float a = k / 4f * Mathf.PI * 2 + Mathf.PI / 4;
                        b.Box("stoneDark", new Vector3(Mathf.Cos(a) * 2.2f, -0.2f, Mathf.Sin(a) * 2.2f), new Vector3(0.35f, 1.3f, 0.35f));
                    }
                }, "灵火坛四角石柱");
                for (int k = 0; k < 4; k++)
                {
                    float a = k / 4f * Mathf.PI * 2 + Mathf.PI / 4;
                    flags.Banner(at + new Vector3(Mathf.Cos(a) * 2.2f, 1.6f, Mathf.Sin(a) * 2.2f), 0.9f, 0.35f, k, a * Mathf.Rad2Deg);
                }
                result[s.id] = alt;
                _ = posts;
            }
            return result;
        }

        static LevelObjective BuildObjective(Transform markers, Dictionary<string, EncounterSite> sites, Dictionary<string, SpiritAltar> altars)
        {
            var objective = new GameObject("Level Objective").AddComponent<LevelObjective>();
            objective.transform.SetParent(markers, false);
            objective.title = "点亮三处灵火 · 开垭口";
            objective.required = Array.Empty<EncounterSite>();
            objective.optional = sites.Values.ToArray();
            objective.altars = altars.Values.ToArray();
            objective.altarsNeeded = FiresToUnlock;
            objective.autoCollect = false;
            return objective;
        }

        // ───────────── 领主擂台（场地机制归 B1，这里只摆锚点和场地件）─────────────

        sealed class Lord
        {
            public string id, name;
            public BossArena arena;
            public BossEncounter encounter;
            public SpiritAltar altar;
            public GameObject drum;
            public int ridges, boulders, covers;
            /// <summary>门槛（ZheduoLevel 判）：圆心、半径、脚的高度范围</summary>
            public Transform thresholdCenter;
            public float thresholdRadius, minY, maxY;
        }

        /// <summary>门槛圆里地面的最低 / 最高（每 2 m 一圈、每圈 36 个点）</summary>
        static (float lo, float hi) GroundRange(Vector3 center, float radius)
        {
            float lo = float.MaxValue, hi = float.MinValue;
            var c = new Vector2(center.x, center.z);
            for (float r = 0; r <= radius + 0.01f; r += 2f)
            for (int i = 0; i < (r < 0.1f ? 1 : 36); i++)
            {
                float a = i * Mathf.PI * 2 / 36;
                float y = GroundY(c + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r);
                lo = Mathf.Min(lo, y);
                hi = Mathf.Max(hi, y);
            }
            return (lo, hi);
        }

        static Transform Point(Transform root, string name, Vector3 pos, Vector3 facing)
        {
            var p = new GameObject(name).transform;
            p.SetParent(root, false);
            p.position = pos;
            facing.y = 0;
            if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(facing.normalized);
            return p;
        }

        static List<Lord> BuildLords(Transform markers, Dictionary<string, EncounterSite> sites, Dictionary<string, SpiritAltar> altars, Water water)
        {
            var list = new List<Lord>();
            BossArena Arena(string id, string label, Vector3 center, float radius)
            {
                var root = new GameObject($"BossArena · {label}").transform;
                root.SetParent(markers, false);
                root.position = center;
                var a = root.gameObject.AddComponent<BossArena>();
                a.bossId = id;
                a.shape = BossArenaShape.Circle;
                a.radius = radius;
                return a;
            }
            // 据点模式（B1 b4fc36b2）：倒下 → 死亡演出放完 → 点亮本据点的灵火坛、出「X · 平息」横幅，不立出口（出口归 LevelObjective 的灵火计数）。
            // 门槛由 ZheduoLevel 按圆判（Lord.threshold*）：BossEncounter 自己的触发体按包围盒判（球会变成方块），场地内缩判法以场地中心为圆心
            // （夔的门槛圆心在残鼓、不在拉则），所以把它自己的门槛关掉——不给触发体、内缩大于场地半径
            BossEncounter Encounter(string id, string label, BossArena arena, string warn, SpiritAltar altar)
            {
                var go = new GameObject($"Boss Encounter · {label}");
                go.transform.SetParent(markers, false);
                go.transform.position = arena.transform.position;
                var enc = go.AddComponent<BossEncounter>();
                enc.bossId = id;
                enc.arena = arena;
                enc.difficulty = 0;
                enc.threshold = null;
                enc.thresholdInset = arena.radius + 1f;
                enc.warnSeconds = 2.5f;
                enc.warnText = warn;
                enc.tetherSlack = 30f;
                enc.rewardPoint = altar ? Point(go.transform, "Lord Reward", altar.transform.position + altar.transform.forward * 3f, -altar.transform.forward) : null;
                enc.stronghold = true;
                enc.altar = altar;
                enc.enabled = true;
                return enc;
            }
            Lord Threshold(Lord l, Transform center, float radius)
            {
                var (lo, hi) = GroundRange(center.position, radius);
                l.thresholdCenter = center;
                l.thresholdRadius = radius;
                l.minY = lo - 3f;
                l.maxY = hi + 5f;
                return l;
            }
            void Edges(BossArena a, float r)
            {
                var pts = new List<Transform>();
                for (int i = 0; i < 8; i++)
                {
                    float ang = (22.5f + i * 45f) * Mathf.Deg2Rad;
                    var off = new Vector2(Mathf.Sin(ang), Mathf.Cos(ang)) * r;
                    var c = new Vector2(a.transform.position.x, a.transform.position.z) + off;
                    pts.Add(Point(a.transform, $"Edge_{i + 1}", G(c), new Vector3(-off.x, 0, -off.y)));
                }
                a.edgePoints = pts.ToArray();
            }

            // ── 夔 · ⑥ 经幡山头：拉则为中心 32 m，残鼓在东南 27 m ──
            {
                var c = U(90, -70);
                var arena = Arena("boss_kui", "夔 · 经幡山头", G(c), 32);
                var drumXZ = U(115, -61);
                var toCenter = G(c) - G(drumXZ);
                arena.bossSpawn = Point(arena.transform, "BossSpawn", G(drumXZ), toCenter);
                var entryDir = (U(62, -36) - c).normalized;
                arena.playerEntry = Point(arena.transform, "PlayerEntry", G(c + entryDir * 24), -new Vector3(entryDir.x, 0, entryDir.y));
                var toDrum = (drumXZ - c).normalized;
                var perch = Point(arena.transform, "Perch_Lartse", G(c + toDrum * 2.6f, 2.4f), new Vector3(toDrum.x, 0, toDrum.y));
                arena.perchPoints = new[] { perch };
                float da = Mathf.Atan2(toDrum.y, toDrum.x);
                arena.summonPoints = new[] { 1, -1 }.Select((s, i) =>
                {
                    float a = da + s * 1.75f;
                    var at = c + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * 30;
                    return Point(arena.transform, $"Summon_{i + 1}", G(at), G(c) - G(at));
                }).ToArray();
                Edges(arena, 30);
                // 残鼓：放倒（鼓面朝天斜躺），量渲染包围盒贴地
                GameObject drum = null;
                if (ShowcaseSceneBuilder.Prefab(KuiDrumId))
                {
                    drum = ShowcaseSceneBuilder.Place(KuiDrumId, arena.transform, G(drumXZ), 0, 1.4f);
                    if (drum)
                    {
                        drum.name = "KuiDrum";
                        drum.transform.rotation = Quaternion.Euler(0, YawZ(new Vector2(toCenter.x, toCenter.z)), 0) * Quaternion.Euler(78, 0, 12);
                        var rs = drum.GetComponentsInChildren<Renderer>();
                        if (rs.Length > 0)
                        {
                            var bb = rs[0].bounds;
                            foreach (var r in rs) bb.Encapsulate(r.bounds);
                            drum.transform.position += Vector3.up * (G(drumXZ).y - 0.25f - bb.min.y);
                        }
                        drum.isStatic = true;
                    }
                }
                else Debug.LogWarning($"[Level] 4-1 缺少 {KuiDrumId}");
                // 门槛：残鼓 22 m 内（圆心标记，ZheduoLevel 判）
                var th = new GameObject("Threshold · 残鼓 22 m").transform;
                th.SetParent(arena.transform, false);
                th.position = G(drumXZ);
                altars.TryGetValue("s6", out var alt);
                var enc = Encounter("boss_kui", "夔", arena, "乌云从经幡山头压了过来——残鼓在震！", alt);
                list.Add(Threshold(new Lord { id = "boss_kui", name = "夔", arena = arena, encounter = enc, altar = alt, drum = drum }, th, 22));
            }

            // ── 飞廉 · ⑤ 冰川口：冰舌顶 34 m，风涡柱在擂台中心；风蚀冰脊 / 冰碛巨石（碰撞体名 IceRidge_* / Boulder_*）+ 背风面掩体点 ──
            {
                var c = U(40, -228);
                var arena = Arena("boss_feilian", "飞廉 · 冰舌顶", G(c), 34);
                arena.bossSpawn = Point(arena.transform, "BossSpawn", G(c), Vector3.back);
                arena.playerEntry = Point(arena.transform, "PlayerEntry", G(new Vector2(66, 218)), G(c) - G(new Vector2(66, 218)));
                Point(arena.transform, "WindVortex", G(c), Vector3.forward);
                var covers = new List<Transform>();
                var ridgeSpots = new (float ang, float r)[] { (20, 16), (60, 22), (105, 14), (150, 21), (200, 17), (340, 22) };
                int k = 0;
                foreach (var (ang, r) in ridgeSpots)
                {
                    var dir = new Vector2(Mathf.Cos(ang * Mathf.Deg2Rad), Mathf.Sin(ang * Mathf.Deg2Rad));
                    var at = c + dir * r;
                    float yaw = YawZ(dir);
                    var go = LevelKit.PlateauPiece(Dir, IdIceRidge, "iceRidge", arena.transform, G(at, -0.3f), yaw, 0, b =>
                    {
                        b.mirrorX = false;
                        b.Frustum("ice", Vector3.zero, new Vector2(2.4f, 7.5f), new Vector2(0.9f, 5.5f), 2.1f);
                        b.Frustum("iceBlue", new Vector3(0, 0, 3.4f), new Vector2(1.6f, 1.2f), new Vector2(0.2f, 0.2f), 1.6f);
                        b.ColBox(Vector3.zero, new Vector3(2.4f, 2.1f, 7.5f));
                    }, $"IceRidge_{++k}");
                    foreach (Transform col in go.transform) col.name = $"IceRidge_{k}";
                    covers.Add(Point(arena.transform, $"Cover_IceRidge_{k}", G(at + dir * 5.4f), new Vector3(-dir.x, 0, -dir.y)));
                }
                int nb = 0;
                foreach (var (ang, r) in new (float, float)[] { (40, 27), (125, 27), (170, 25) })
                {
                    var dir = new Vector2(Mathf.Cos(ang * Mathf.Deg2Rad), Mathf.Sin(ang * Mathf.Deg2Rad));
                    var at = c + dir * r;
                    var go = LevelKit.PlateauPiece(Dir, IdBoulder, "moraineBoulder", arena.transform, G(at, -0.2f), ang * 7, 0, b =>
                    {
                        b.Rock("rockDark", Vector3.zero, 1.7f, 0.75f, 77);
                        b.Rock("rock", new Vector3(1.4f, 0, 0.6f), 0.7f, 0.6f, 78);
                        b.ColCyl(new Vector3(0, -0.5f, 0), 1.45f, 3.0f);
                    }, $"Boulder_{++nb}");
                    foreach (Transform col in go.transform) col.name = $"Boulder_{nb}";
                    covers.Add(Point(arena.transform, $"Cover_Boulder_{nb}", G(at + dir * 3.2f), new Vector3(-dir.x, 0, -dir.y)));
                }
                arena.coverPoints = covers.ToArray();
                Edges(arena, 31);
                altars.TryGetValue("s5", out var alt);
                var enc = Encounter("boss_feilian", "飞廉", arena, "冰舌顶上的风涡收紧了——风伯飞廉！", alt);
                // 门槛：上到冰舌顶 32 m 内（场地 34 m 往里 2 m）
                list.Add(Threshold(new Lord { id = "boss_feilian", name = "飞廉", arena = arena, encounter = enc, altar = alt, ridges = k, boulders = nb, covers = covers.Count },
                    arena.transform, arena.radius - 2));
            }

            // ── 化蛇 · ④ 圣湖海子：湖面 + 一圈湖岸 52 m；场地中心取在湖面高度 ──
            {
                var c = U(-140, -150);
                float level = (float)field.lakeLevel[0];
                var arena = Arena("boss_huashe", "化蛇 · 圣湖", new Vector3(c.x, level, c.y), 52);
                if (water.holyLake) water.holyLake.transform.SetParent(arena.transform, true);
                var isl = Lakes[0].island.Value;
                Point(arena.transform, "Island", GW(isl.x, isl.z), Vector3.forward);
                arena.bossSpawn = Point(arena.transform, "BossSpawn", new Vector3(-138, level, 140), Vector3.left);
                arena.playerEntry = Point(arena.transform, "PlayerEntry", DryNear(-100, -146), Vector3.left);
                var covers = new List<Transform>
                {
                    Point(arena.transform, "Cover_ChortenRow", chortenRowTop, Vector3.left),
                    Point(arena.transform, "Cover_Boulder_E", GW(-114, -112, 1.8f), Vector3.left),
                    Point(arena.transform, "Cover_Boulder_W", GW(-192, -150, 2.0f), Vector3.right),
                    Point(arena.transform, "Cover_ManiPile_E", GW(-96, -122, 1.7f), Vector3.left),
                    Point(arena.transform, "Cover_ManiPile_W", GW(-186, -124, 2.0f), Vector3.right),
                    Point(arena.transform, "Cover_ManiPile_S", GW(-92, -182, 1.4f), Vector3.left),
                };
                arena.coverPoints = covers.ToArray();
                Edges(arena, 50);
                altars.TryGetValue("s4", out var alt);
                var enc = Encounter("boss_huashe", "化蛇", arena, "圣湖的水面起了涟漪，一道长长的黑影在水下游过……", alt);
                // 门槛：走进湖岸擂台（场地 52 m 往里 2 m）
                list.Add(Threshold(new Lord { id = "boss_huashe", name = "化蛇", arena = arena, encounter = enc, altar = alt, covers = covers.Count },
                    arena.transform, arena.radius - 2));
            }
            return list;
        }

        /// <summary>风场锚点（WindField 是静态的，飞廉的吸引点由 B1 运行时加，这里留位置）+ 穷奇巡视线（E 路的穷奇 AI 读这些标记）</summary>
        static void BuildWindAndRoamer(Transform markers, Dictionary<string, EncounterSite> sites, List<Lord> lords)
        {
            var wind = new GameObject("WindField_Attractor · 飞廉");
            wind.transform.SetParent(markers, false);
            wind.transform.position = GW(WindLx, WindLz);
            var roam = new GameObject("Roamer · 穷奇").transform;
            roam.SetParent(markers, false);
            for (int i = 0; i < RoamerPath.Length; i++)
            {
                var p = new GameObject($"Roamer_Qiongqi_{i}").transform;
                p.SetParent(roam, false);
                p.position = DryNear(RoamerPath[i].x, RoamerPath[i].z);
            }
            var lair = new GameObject("Roamer_Qiongqi_Lair").transform;
            lair.SetParent(roam, false);
            lair.position = DryNear(RoamerLair.x, RoamerLair.z);

            // 关卡运行时：开局刷穷奇、交给它巡视线和巢穴；两窝啸獭刷出来时换成网页的洞口
            var level = roam.gameObject.AddComponent<ZheduoLevel>();
            level.roamerRoute = Enumerable.Range(0, RoamerPath.Length).Select(i => roam.Find($"Roamer_Qiongqi_{i}")).ToArray();
            level.roamerLair = lair;
            var holes = new List<ZheduoLevel.Burrows>();
            foreach (var (siteId, pts) in new[]
                     {
                         ("s2", new (double x, double z)[] { (-18, 36), (-4, 30), (6, 40), (-22, 48), (10, 52) }),
                         ("s5", new (double x, double z)[] { (20, -160), (32, -158), (24, -150), (36, -166) }),
                     })
            {
                var root = new GameObject($"Burrows · {siteId}").transform;
                root.SetParent(roam.parent, false);
                var list = new List<Transform>();
                for (int i = 0; i < pts.Length; i++)
                {
                    var h = new GameObject($"Burrow_{siteId}_{i + 1}").transform;
                    h.SetParent(root, false);
                    h.position = GW(pts[i].x, pts[i].z);
                    list.Add(h);
                }
                holes.Add(new ZheduoLevel.Burrows { site = sites[siteId], holes = list.ToArray() });
            }
            level.burrows = holes.ToArray();
            // 三处领主据点：门槛（圆）+ 灵火坛封着
            level.strongholds = lords.Select(l => new ZheduoLevel.Stronghold
            {
                encounter = l.encounter, center = l.thresholdCenter, radius = l.thresholdRadius, minY = l.minY, maxY = l.maxY,
            }).ToArray();
        }

        /// <summary>出口传送门：立在经幡门的两根杆之间（门洞 5.6 × 5.2 m），目标完成（3 处灵火）后升起；下一关读 RunPlan</summary>
        static ExitPortal BuildExit(Transform markers, LevelObjective objective)
        {
            var portal = new GameObject("Exit Portal").AddComponent<ExitPortal>();
            portal.transform.SetParent(markers, false);
            var toPlayer = (U(250, -178) - new Vector2(gateCenter.x, gateCenter.z)).normalized;
            portal.transform.SetPositionAndRotation(gateCenter, Quaternion.LookRotation(-new Vector3(toPlayer.x, 0, toPlayer.y)));
            portal.objective = objective;
            portal.doorSize = new Vector2(5.6f, 5.2f);
            portal.buildFrame = false;
            return portal;
        }

        static void BuildMarkers(Transform root)
        {
            void Mk(string name, Vector3 p)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root, false);
                go.transform.position = p;
            }
            foreach (var s in Sites) Mk($"Site_{s.id}", GW(s.x, s.z));
            Mk("Landmark_Diaolou", diaolouTop);
            Mk("Landmark_Lhatse", lhatseTop);
            Mk("Landmark_Gongga", GonggaTarget);
            Mk("Route_Gate", gateCenter);
            foreach (var poi in Pois) Mk($"POI_{poi.name}", GW(poi.x, poi.z));
            // 软边界冲刺测试的五个方向（Map41Suite）：盆地中心往外
            var dirs = new (string name, double x, double z)[] { ("North", 20, -300), ("East", 340, 20), ("South", 40, 300), ("West", -340, 40), ("SouthWest", -320, 260) };
            foreach (var (name, x, z) in dirs) Mk($"Escape_{name}", GW(x, z));
            // 天路标记（Map41Suite 沿它走）：路面中线，每 15 m 一个
            var R = field.road;
            int n = 0;
            double next = 0;
            for (int i = 0; i < R.Count; i++)
            {
                if (R[i].s < next && i != R.Count - 1) continue;
                Mk($"Route_Road_{n++:000}", GW(R[i].x, R[i].z));
                next = R[i].s + 15;
            }
        }

        // ───────────── 本关的检查 ─────────────

        /// <summary>网页导出的高度场对照点（node 跑 terrain.ts 导出，网页坐标 x, z, y；冰川区不在里面——那一段 Unity 故意放缓了）</summary>
        static readonly (double x, double z, float y)[] WebProbes =
        {
            (-118, -253, 29.386f), (141, -253, 26.251f), (-44, -216, 20.922f), (215, -216, 39.814f), (-81, -179, 17.359f), (104, -179, 26.479f), (-266, -142, 8.193f),
            (-81, -142, 12.053f), (104, -142, 24.433f), (-303, -105, 12.771f), (-118, -105, 13.828f), (67, -105, 35.759f), (252, -105, 34.383f), (-192, -68, 26.247f),
            (-7, -68, 9.187f), (178, -68, 25.598f), (-266, -31, 9.725f), (-81, -31, 10.319f), (104, -31, 36.357f), (289, -31, 28.704f), (-155, 6, 24.773f), (30, 6, 11.917f),
            (215, 6, 23.425f), (-229, 43, 13.325f), (-44, 43, -0.007f), (141, 43, 17.729f), (-303, 80, 4.853f), (-118, 80, 4.09f), (67, 80, 10.738f), (252, 80, 25.912f),
            (-192, 117, -5.463f), (-7, 117, 10.397f), (178, 117, 14.058f), (-266, 154, -4.907f), (-81, 154, 7.692f), (104, 154, 10.964f), (289, 154, 16.378f),
            (-155, 191, -0.315f), (30, 191, 10.64f), (215, 191, 10.624f), (-155, 228, -4.604f), (30, 228, 7.628f), (215, 228, 15.743f), (-7, 265, 9.811f),
        };

        static void CheckWebHeights(LevelKit.Report rep)
        {
            rep.Section("高度对照网页（terrain.ts 导出的 44 个点）");
            var diffs = WebProbes.Select(p => (p, d: Mathf.Abs(ts.GroundY((float)p.x, (float)-p.z) - p.y))).OrderBy(x => x.d).ToList();
            float med = diffs[diffs.Count / 2].d, max = diffs[^1].d;
            var worst = diffs[^1].p;
            string msg = $"Unity 地形与网页高度差：中位 {med:F3} m、最大 {max:F2} m（网页 ({worst.x}, {worst.z})）";
            if (max > 0.6f) rep.Fail($"{msg}——移植走样了");
            else rep.Line($"✓ {msg}");
            rep.Line($"湖面：圣湖 {field.lakeLevel[0]:F2}（网页 9.96）、冰湖 {field.lakeLevel[1]:F2}（网页 19.30）；天路 {field.road[^1].s:F0} m（网页 997）；挡土墙段 {field.walls.Count}（网页 79）；木桥 {field.bridges.Count}（网页 1）");
            if (Math.Abs(field.lakeLevel[0] - 9.965) > 0.15 || Math.Abs(field.lakeLevel[1] - 19.302) > 0.15) rep.Fail("湖面和网页差 0.15 m 以上");
        }

        /// <summary>
        /// 网页验收的下限（plateauLab openness）：2 m 网格上坡度 ≤ 40° 且水深 ≤ 1.1 m、离盆地 ≤ 24 m 的格子算能走，从出生点连通搜索。
        /// 盆地可走 ≥ 90%、全部据点 / 灵火坛 / 出口走得到；领主擂台：夔、飞廉擂台 60% 以上的格子走得到，化蛇只看湖岸
        /// </summary>
        static void CheckOpenness(LevelKit.Report rep)
        {
            rep.Section("网页验收下限（开放度、可达、擂台）");
            const double S = 2, minX = -345, maxX = 350, minZ = -295, maxZ = 295;
            int W = (int)((maxX - minX) / S), H = (int)((maxZ - minZ) / S);
            var walk = new bool[W * H];
            var inBasin = new bool[W * H];
            var seen = new bool[W * H];
            double lim = 40 * Math.PI / 180;
            for (int j = 0; j < H; j++)
            for (int i = 0; i < W; i++)
            {
                double x = minX + (i + 0.5) * S, z = minZ + (j + 0.5) * S;
                float d = field.basin[field.Idx(field.I(x), field.J(z))];
                if (d <= 0) inBasin[j * W + i] = true;
                bool passDisc = Math.Sqrt((x - PassDiscX) * (x - PassDiscX) + (z - PassDiscZ) * (z - PassDiscZ)) < PassDiscR;
                if ((d <= SoftBoundary || passDisc) && field.SlopeAt(x, z) <= lim && field.WaterDepthAt(x, z) <= 1.1) walk[j * W + i] = true;
            }
            int si = (int)((-262 - minX) / S), sj = (int)((214 - minZ) / S);
            var stack = new Stack<int>();
            stack.Push(sj * W + si);
            seen[sj * W + si] = true;
            while (stack.Count > 0)
            {
                int c = stack.Pop(), ci = c % W, cj = c / W;
                for (int dj = -1; dj <= 1; dj++)
                for (int di = -1; di <= 1; di++)
                {
                    int ni = ci + di, nj = cj + dj;
                    if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
                    int n = nj * W + ni;
                    if (seen[n] || !walk[n]) continue;
                    seen[n] = true;
                    stack.Push(n);
                }
            }
            int basin = 0, walkable = 0, reach = 0;
            for (int k = 0; k < W * H; k++)
                if (inBasin[k])
                {
                    basin++;
                    if (walk[k]) walkable++;
                    if (seen[k]) reach++;
                }
            bool Reached(double x, double z)
            {
                int ci = (int)((x - minX) / S), cj = (int)((z - minZ) / S);
                for (int r = 0; r <= 3; r++)
                for (int dj = -r; dj <= r; dj++)
                for (int di = -r; di <= r; di++)
                {
                    int ni = ci + di, nj = cj + dj;
                    if (ni >= 0 && nj >= 0 && ni < W && nj < H && seen[nj * W + ni]) return true;
                }
                return false;
            }
            float wf = walkable / (float)basin, rf = reach / (float)basin;
            string head = $"盆地 {basin * S * S / 10000:F1} 公顷：可走 {wf * 100:F0}%，从出生点走得到 {rf * 100:F0}%（网页 96% / 96%）";
            if (wf < 0.9f) rep.Fail($"{head}——要求盆地可走 ≥ 90%");
            else rep.Line($"✓ {head}");
            var miss = Sites.Where(s => !Reached(s.altar?.x ?? s.x, s.altar?.z ?? s.z)).Select(s => s.name).ToList();
            if (!Reached(272, -187)) miss.Add("经幡门（出口）");
            if (miss.Count > 0) rep.Fail($"走不到：{string.Join("、", miss)}");
            else rep.Line("✓ 全部据点、6 座灵火坛和经幡门都走得到");
            foreach (var (name, x, z, r, inWater) in new[] { ("夔", 92.0, -74.0, 32.0, false), ("飞廉", 40.0, -228.0, 34.0, false), ("化蛇", -140.0, -150.0, 52.0, true) })
            {
                int n = 0, hit = 0;
                for (double dz = -r; dz <= r; dz += 4)
                for (double dx = -r; dx <= r; dx += 4)
                {
                    if (dx * dx + dz * dz > r * r) continue;
                    n++;
                    if (Reached(x + dx, z + dz)) hit++;
                }
                bool center = inWater || Reached(x, z);
                string m = $"领主 · {name}擂台：{(inWater ? "中心在湖里，湖岸" : center ? "中心可达，" : "中心走不到，")}可走 {hit * 100f / n:F0}%";
                if (!center || (!inWater && hit / (float)n < 0.6f) || (inWater && hit / (float)n < 0.3f)) rep.Fail(m);
                else rep.Line($"✓ {m}");
            }
            // 冲刺不出盆地（网页行走测试：五个方向都停在离盆地 25–29 m 的山脚）：能走的格子离盆地最远多少
            float far = 0;
            for (int k = 0; k < W * H; k++)
                if (seen[k])
                {
                    double x = minX + (k % W + 0.5) * S, z = minZ + (k / W + 0.5) * S;
                    far = Mathf.Max(far, field.basin[field.Idx(field.I(x), field.J(z))]);
                }
            rep.Line($"从出生点走得到的地方离盆地轮廓最远 {far:F0} m（软边界从 {SoftBoundary} m 起风雪；垭口出口在轮廓外约 21 m）");
        }

        static void CheckRoadAndWater(LevelKit.Report rep, Water w, GameObject walls, int poleCount, GameObject flagsGo)
        {
            rep.Section("天路、水体、经幡");
            var R = field.road;
            double maxGrade = 0;
            for (int i = 0; i + 1 < R.Count; i++)
            {
                double ds = R[i + 1].s - R[i].s;
                if (ds > 0.3) maxGrade = Math.Max(maxGrade, Math.Atan(Math.Abs(R[i + 1].e - R[i].e) / ds) * 180 / Math.PI);
            }
            string m = $"天路 {R[^1].s:F0} m，纵坡最陡 {maxGrade:F1}°（≤ 10% = 5.7°），跑完约 {R[^1].s / 7.5 / 60:F1} 分钟；盘山挡土墙 {field.walls.Count(x => x.cut)} 段内侧 + {field.walls.Count(x => !x.cut)} 段外侧护墙（合并成 {walls?.transform.childCount ?? 0} 个碰撞盒）";
            if (maxGrade > 6) rep.Fail(m);
            else rep.Line($"✓ {m}");
            // 沿河每个采样点（河槽中线）：脚下最深的那片水的深度
            float deepest = 0;
            foreach (var p in field.river)
            {
                var g = new Vector3((float)p.x, ts.GroundY((float)p.x, (float)-p.z), (float)-p.z);
                float d = 0;
                foreach (var v in w.river) d = Mathf.Max(d, v.DepthAt(g));
                deepest = Mathf.Max(deepest, d);
            }
            string wm = $"冰川河 {w.river.Count} 段水体，河心最深 {deepest:F2} m（深于 {w.river[0].deep} m 才托回）；圣湖水面 {w.holyLake.Surface:F2}、冰湖 {w.glacialLake.Surface:F2}；温泉 {w.springs.Count} 池";
            if (deepest >= w.river[0].deep) rep.Fail($"{wm}——河要能涉水");
            else rep.Line($"✓ {wm}");
            var mesh = flagsGo.GetComponent<MeshFilter>().sharedMesh;
            rep.Line($"经幡 {flags.Count} 面（{flags.Lines} 条绳，{mesh.triangles.Length / 3} 个三角形，一个网格）；经幡杆 {poleCount} 根带碰撞，导体 {Object.FindObjectsByType<Conductor>(FindObjectsInactive.Include).Length} 个");
            if (scatterCounts != null) rep.Line($"散布：{string.Join("、", scatterCounts.Select(kv => $"{kv.Key} {kv.Value}"))}");
        }

        static void CheckLords(LevelKit.Report rep, List<Lord> lords)
        {
            rep.Section("领主据点（锚点给 B1；BossEncounter 据点模式）");
            foreach (var l in lords)
            {
                var a = l.arena;
                var names = a.GetComponentsInChildren<Transform>(true).Select(t => t.name).ToHashSet();
                var need = l.id switch
                {
                    "boss_kui" => new[] { "BossSpawn", "PlayerEntry", "KuiDrum", "Perch_Lartse", "Summon_1", "Summon_2" },
                    "boss_feilian" => new[] { "BossSpawn", "PlayerEntry", "WindVortex", "IceRidge_1", "Boulder_1", "Cover_IceRidge_1" },
                    _ => new[] { "BossSpawn", "PlayerEntry", "Island", "Water_HolyLake", "Cover_ChortenRow" },
                };
                var missing = need.Where(n => !names.Contains(n)).ToList();
                string extra = l.id switch
                {
                    "boss_kui" => $"，擂台内导体 {Object.FindObjectsByType<Conductor>(FindObjectsInactive.Include).Count(c => Vector3.Distance(c.transform.position, a.transform.position) < a.radius)} 个",
                    "boss_feilian" => $"，冰脊 {l.ridges}、巨石 {l.boulders}、掩体点 {l.covers}",
                    _ => $"，掩体点 {l.covers}",
                };
                var e = l.encounter;
                string m = $"{l.name}（{l.id}）：半径 {a.radius:F0} m，灵火坛 {(l.altar ? l.altar.name : "无")}，门槛 {l.thresholdCenter?.name} {l.thresholdRadius:F0} m（脚 y {l.minY:F1}…{l.maxY:F1}）{extra}";
                var bad = new List<string>();
                if (missing.Count > 0) bad.Add($"缺锚点 {string.Join("、", missing)}");
                if (!e.enabled || !e.stronghold) bad.Add($"BossEncounter 应开着、据点模式（enabled={e.enabled} stronghold={e.stronghold}）");
                if (!l.altar || e.altar != l.altar) bad.Add("BossEncounter.altar 不是本据点的灵火坛");
                else if (l.altar.guard) bad.Add($"{l.altar.title} 还挂着守卫 {l.altar.guard.title}（应只由领主点亮）");
                if (e.threshold || e.thresholdInset <= a.radius) bad.Add("BossEncounter 自己的门槛没关（门槛由 ZheduoLevel 按圆判）");
                if (!l.thresholdCenter || l.thresholdRadius <= 0) bad.Add("没有门槛圆");
                if (bad.Count > 0) rep.Fail($"{m}——{string.Join("；", bad)}");
                else rep.Line($"✓ {m}");
            }
            var kui = lords.First(l => l.id == "boss_kui");
            if (kui.drum)
            {
                var poles = Object.FindObjectsByType<Conductor>(FindObjectsInactive.Include).Where(c => c.name.StartsWith("Conductor_Pole")).Select(c => Vector3.Distance(c.transform.position, kui.arena.transform.position))
                    .Where(d => d < 30).ToList();
                string m = $"夔的经幡杆一圈：{poles.Count} 根，离拉则 {(poles.Count > 0 ? $"{poles.Min():F0}–{poles.Max():F0}" : "—")} m（要求 14–23 m）";
                if (poles.Count < 5 || poles.Any(d => d < 14 || d > 23)) rep.Fail(m);
                else rep.Line($"✓ {m}");
            }
            else rep.Fail("夔的残鼓（SM_Prop_KuiBrokenDrum）没摆上");
            var level = Object.FindAnyObjectByType<ZheduoLevel>();
            int wired = level ? level.strongholds.Count(s => s != null && lords.Any(l => l.encounter == s.encounter && l.thresholdCenter == s.center)) : 0;
            if (wired != lords.Count) rep.Fail($"ZheduoLevel 的领主据点只接上 {wired} / {lords.Count} 个（门槛、灵火坛封印都在它那里）");
            else rep.Line($"✓ ZheduoLevel 接上 {wired} 个领主据点：门槛按圆判，灵火坛领主没平前不能手点");
            // 化蛇读的湖：水体盒子的水平尺寸 = 湖的椭圆（游线 = 椭圆 × 0.62）
            var hl = lords.First(l => l.id == "boss_huashe").arena.GetComponentsInChildren<WaterVolume>(true).FirstOrDefault(w => w.name.StartsWith("Water_HolyLake"));
            if (!hl) rep.Fail("化蛇的擂台下面没有 Water_HolyLake");
            else
            {
                var sc = hl.transform.lossyScale;
                string m = $"圣湖（化蛇读的湖）：椭圆半轴 {sc.x * 0.5f:F1} × {sc.z * 0.5f:F1} m、朝向 {hl.transform.eulerAngles.y:F1}°（网页 {Lakes[0].rx} × {Lakes[0].rz}、{Lakes[0].rot * Mathf.Rad2Deg:F1}°），水面 {hl.Surface:F2}";
                if (Mathf.Abs(sc.x * 0.5f - (float)Lakes[0].rx) > 0.05f || Mathf.Abs(sc.z * 0.5f - (float)Lakes[0].rz) > 0.05f) rep.Fail(m);
                else rep.Line($"✓ {m}");
            }
        }

        /// <summary>L1 规则：关卡场景只有环境和标记；另查本关的件（灵火坛、目标、遭遇、出口），顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene, ExitPortal portal, LevelObjective objective,
            Dictionary<string, SpiritAltar> altars, Dictionary<string, EncounterSite> sites)
        {
            rep.Section("场景内容（L1：只有环境和标记，玩家在 Core 场景）");
            int Count<T>() where T : Component => Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1，没有玩家 / 相机 / HUD / 会话");
            int nAltars = Count<SpiritAltar>(), nSites = Count<EncounterSite>(), nArenas = Count<BossArena>(), nEnc = Count<BossEncounter>(), nWater = Count<WaterVolume>();
            rep.Line($"灵火坛 {nAltars}（要点亮 {objective.AltarsNeeded}），遇敌 {nSites}（全部可选），领主擂台 {nArenas} / 首领流程 {nEnc}，水体 {nWater}");
            if (nAltars != 6 || objective.AltarsNeeded != FiresToUnlock || objective.altars.Length != 6) rep.Fail("灵火坛应 6 座、要点亮 3 座");
            if (nSites != 7 || objective.RequiredTotal != 0) rep.Fail("遇敌应 7 处、都不是必清（目标只看灵火）");
            if (nArenas != 3 || nEnc != 3) rep.Fail("领主擂台 / 首领流程应各 3 个");
            foreach (var id in new[] { "s1", "s2", "s3" })
                if (!altars[id].guard || altars[id].guard != sites[id]) rep.Fail($"{altars[id].title} 的守卫不是本据点的遇敌");
            foreach (var id in LordSites)
                if (altars[id].guard) rep.Fail($"{altars[id].title} 是领主据点，不该挂守卫（由领主点亮）");
            if (!portal || portal.objective != objective) rep.Fail("出口传送门没接上 LevelObjective");
            else
            {
                var stage = RunPlan.Get("4-1");
                rep.Line(stage != null ? $"✓ 出口在经幡门里；RunPlan：{stage.Label} → 下一关 {RunPlan.Next(stage)?.Label ?? "无"}" : "✓ 出口在经幡门里（RunPlan 里还没有 4-1：F 路加第四章条目）");
            }
            CoreSceneBuilder.BuildDatabase(rep);
        }

        // ───────────── 验收声明 ─────────────

        /// <summary>
        /// 交给 L5 规则集的声明：主线路点走天路 + 牧道（出生 → ② → ① → ④ 东岸 → ⑤ → ⑥ → ③ → 垭口 → 经幡门），坡度路径（天路 ≤ 10°、牧道 ≤ 30°），
        /// 10 条视线（网页 SIGHT_CHECKS），场地尺寸取网页据点半径；可玩区遮罩与软边界同一个，越界按兜底环算；占位件白盒阶段只列清单
        /// </summary>
        static LevelSpec Spec()
        {
            SiteSpec Site(string id, float size, bool combat = true)
            {
                var s = SiteById(id);
                return new SiteSpec { name = s.name, center = GW(s.x, s.z), size = size, combat = combat };
            }
            Vector3 EyeAt(double x, double z) => GW(x, z, Eye);
            var lhatseMark = GW(90, -70, 9);
            var spec = new LevelSpec
                {
                    id = "4-1", title = "折多垭口·天路草甸", playerSpawn = GW(-262, 214), bounds = new Rect(Origin, Size),
                    playable = Playable, playableThreshold = 0.2f, escapeMargin = boundary.EscapeMargin, placeholders = PlaceholderPolicy.Warn,
                    sites =
                    {
                        Site("spawn", 36, false), Site("s1", 90), Site("s2", 80), Site("s3", 90), Site("s4", 124), Site("s5", 80), Site("s6", 70), Site("pass", 60),
                    },
                }
                .Route("出生 · 道班", GW(-262, 214)).Route("② 白塔溪谷", GW(-18, 64)).Route("木桥", GW(-56, 58)).Route("① 碉楼寨", GW(-188, -38))
                .Route("④ 圣湖东岸", GW(-100, -140)).Route("⑤ 冰川口", GW(52, -172)).Route("⑥ 经幡山头", GW(82, -60)).Route("③ 牧民营地", GW(136, 118))
                .Route("天路盘山段", GW(222, -38)).Route("⑦ 垭口", GW(248, -176)).Route("经幡门", GW(266, -184))
                .Sight("出生 → 碉楼", EyeAt(-262, 214), diaolouTop, 4, IdDiaolou)
                .Sight("出生 → 经幡山头", EyeAt(-262, 214), lhatseMark, 4, IdLhatse)
                .Sight("出生 → 贡嘎", EyeAt(-262, 214), GonggaTarget, 20)
                .Sight("⑦ 垭口 → 贡嘎", EyeAt(258, -182), GonggaTarget, 20)
                .Sight("⑥ 经幡山头 → 垭口", EyeAt(94, -62), GW(272, -186, 7), 5);
            // 据点的眼位：网页取据点中心（① 在民居里、② 在白塔台基里、④ 在湖心水下），Unity 取据点里一处站得住、看得见经幡山头的空地
            var eyes = new Dictionary<string, (double x, double z)> { ["s1"] = (-170, -30), ["s4"] = (-112, -184) };
            foreach (var s in Sites.Where(s => !s.spawn && !s.exit && s.id != "s6"))
            {
                var (ex, ez) = eyes.TryGetValue(s.id, out var e) ? e : s.altar.Value;
                spec.Sight($"{s.name} → 经幡山头", EyeAt(ex, ez), lhatseMark, 4, IdLhatse);
            }
            spec.slopePaths.Add(new SlopePath { name = "天路", points = field.road.Where((_, i) => i % 3 == 0).Select(p => U(p.x, p.z)).ToList(), maxSlope = 10f });
            foreach (var (t, pts) in Trails.Zip(field.trails, (a, b) => (a, b)))
                spec.slopePaths.Add(new SlopePath { name = $"牧道 {t.id}", points = pts.Where((_, i) => i % 3 == 0).Select(p => U(p.x, p.z)).ToList(), maxSlope = 45f });
            return spec;
        }

        // ───────────── 截图 ─────────────

        /// <summary>
        /// 审核截图：网页检视页的十个机位（spec.VIEWPOINTS，同位置、同朝向、竖直视角 72°）+ 俯视。
        /// 网页的行走机位 = 地面 + 眼高 1.62，look 是世界坐标
        /// </summary>
        static void Review(Vector3 spawnAt, Quaternion spawnRot)
        {
            Vector3 E(double x, double z) => GW(x, z, Eye);
            Vector3 A(double x, double y, double z) => new((float)x, (float)y, (float)-z);
            var gongga = A(GonggaX * GonggaScale, 420 * GonggaScale, GonggaZ * GonggaScale);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                cam.fieldOfView = 72;
                LevelKit.Capture(cam, fpRig, "level_4-1", new[]
                {
                    ("Spawn", E(-255, 205), A(90, 60, -70), false),
                    ("Diaolou", E(-148, 8), A(-200, 30, -52), false),
                    ("Chorten", E(-10, 82), A(-32, 8, 56), false),
                    ("Camp", E(128, 172), A(148, 6, 118), false),
                    ("HolyLake", E(-90, -128), A(-160, 4, -165), false),
                    ("Glacier", E(58, -150), A(40, 30, -215), false),
                    ("FlagHill", E(94, -56), A(-120, -10, 120), false),
                    ("PassGongga", E(258, -182), gongga, false),
                    ("Aerial", A(-330, 230, 330), A(20, 0, -30), false),
                    ("KuiArena", A(100, 72, 0), A(98, 50, -60), false),
                    ("Map", new Vector3(0, 700, 1), Vector3.zero, false),
                    ("SpawnFP", E(-262, 214), lhatseTop, true),
                });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }
    }
}
