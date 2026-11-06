using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 4-3 彩林海子（docs/level-design/maps/4-3.md）：川西深秋的高山海子——近景一汪镜面静水，中景满谷金黄的落叶松夹着墨绿云杉，
    /// 右岸一整面花岗岩大山（下半截林坡、上半截裸岩），远处 V 形谷口里是积雪的尖峰，湖面倒映雪山、金林和天上的云。
    /// 开放区域（open-level-design）：湖岸、林下、东岸山脚车路、北边谷地都能走，没有空气墙，边界靠两岸陡坡 + 风雪软边界。
    /// 关卡坐标 = 世界 XZ（米；x 向东、z 向北），湖面 y = 0。地形 1536 × 1536 m（3 × 3 块，1 m 格），地貌函数见 Level_4_3.Field.cs；
    /// 树是程序化的落叶松 / 云杉（Level_4_3.Trees.cs，着色器 Spiritfire/Foliage，地形树）；远景雪峰见 Level_4_3.Backdrop.cs；
    /// 湖面 = Spiritfire/MirrorLake + PlanarReflection（平面反射）。
    /// 玩法（Level_4_3.Play.cs）：五处据点任意顺序（各一座灵火坛，守卫肃清后才点得着）+ 谷口守卫，点亮任意三处灵火，谷口经幡门里的出口升起（同 4-1 的开放图规则，没有领主）。
    /// 整局路线：4-2 大渡河 → 4-3 彩林海子 → 4-4 神山海子（RunPlan）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 4-3 彩林海子（或 bridge.sh level 4-3）。
    /// </summary>
    [LevelBuilder("4-3", ScenePath)]
    public static partial class Level_4_3
    {
        public const string Dir = "Assets/Levels/L4_3_Cailin";
        public const string ScenePath = "Assets/Scenes/L4_3_Cailin.unity";
        const string Name = "L4_3";
        const string Title = "彩林海子";

        // ───────────── 尺度 ─────────────
        static readonly Vector2 Origin = new(-768, -768), Size = new(1536, 1536);
        /// <summary>高度场 0 = 世界 y −BaseHeight（湖底约 −7 m 也在 0 以上）</summary>
        const float BaseHeight = 20;
        const float HeightRange = 760;
        const float Eye = 1.62f;

        // ───────────── 湖 ─────────────
        static readonly Vector2 LakeCenter = new(5, -45), LakeRadius = new(175, 66);
        const float LakeYaw = -0.08f;

        // ───────────── 主题：川西深秋晴天 ─────────────
        /// <summary>
        /// 晴空深蓝、团团白云；太阳在西南（玩家看向北边谷口时在左后方）偏高：东岸大山的西坡、雪峰的西面受光，西岸林坡背光。
        /// 雾很远很淡（远处雪峰保持清楚）；后处理略提饱和、略暖，金林和蓝天的冷暖对比是这张图的主色
        /// </summary>
        static readonly ShowcaseTheme Theme = new()
        {
            key = "LarchLake", title = Title,
            sunColor = new(1f, 0.95f, 0.86f), sunIntensity = 1.55f, sunEuler = new(40, 52, 0),
            gradientSky = true, skyTop = new(0.07f, 0.31f, 0.80f), skyHorizon = new(0.58f, 0.77f, 0.95f), skyBottom = new(0.42f, 0.47f, 0.46f), skyExposure = 1f,
            skyHorizonSharpness = 2.4f, skyHorizonGlow = 0.18f, skySunSize = 0.02f, skySunHalo = 0.45f,
            ambientSky = new(0.44f, 0.58f, 0.86f), ambientEquator = new(0.62f, 0.64f, 0.62f), ambientGround = new(0.34f, 0.29f, 0.2f),
            fogColor = new(0.64f, 0.78f, 0.94f), fogStart = 380, fogEnd = 3200,
            fireColor = new(1f, 0.7f, 0.35f), fireIntensity = 5f,
            postExposure = -0.2f, contrast = 16, saturation = 8, temperature = 3, tint = 0, bloomTint = new(1f, 0.97f, 0.92f),
            bloomIntensity = 0.35f, bloomThreshold = 1.1f, vignette = 0.16f,
            groundA = new(0.55f, 0.45f, 0.26f), groundB = new(0.66f, 0.55f, 0.3f), groundShadowTint = new(0.55f, 0.62f, 0.86f),
            groundPattern = ShowcaseTheme.GroundPattern.Drifts,
        };

        static readonly LevelKit.Ground LarchGround = new()
        {
            key = "LarchLake", layers = Layers, rule = Splat, shadowTint = new Color(0.55f, 0.62f, 0.86f), macroStrength = 0.3f,
            rockScale = 18f, steepTriplanar = true, rockWarp = 0.3f, rockDetile = 0.45f, lightNormalRadius = 4f, lightNormalBlend = 0.75f,
        };

        static Color C3(float r, float g, float b) => new(r, g, b, 1);

        /// <summary>四层：0 林下地被（枯草 + 落叶松针，赭黄）· 1 卵石滩 / 车路（灰米）· 2 雪与霜（青白）· 3 花岗岩（浅灰带暗缝，三平面投影）</summary>
        static TerrainLayer[] Layers() => new[]
        {
            TerrainTextureGen.Layer("LarchFloor", TerrainTextureGen.Kind.Snow,
                new TerrainTextureGen.Palette { a = C3(0.56f, 0.44f, 0.25f), b = C3(0.69f, 0.55f, 0.29f), accent = C3(0.78f, 0.58f, 0.24f), dark = C3(0.32f, 0.25f, 0.16f) }, 8f, 301),
            TerrainTextureGen.Layer("LarchGravel", TerrainTextureGen.Kind.Gravel,
                new TerrainTextureGen.Palette { a = C3(0.58f, 0.56f, 0.52f), b = C3(0.70f, 0.68f, 0.63f), accent = C3(0.82f, 0.80f, 0.76f), dark = C3(0.36f, 0.35f, 0.33f) }, 5f, 303),
            TerrainTextureGen.Layer("LarchSnow", TerrainTextureGen.Kind.Snow,
                new TerrainTextureGen.Palette { a = C3(0.86f, 0.90f, 0.95f), b = C3(0.97f, 0.98f, 1.0f), accent = C3(0.70f, 0.80f, 0.90f), dark = C3(0.62f, 0.68f, 0.78f) }, 10f, 305),
            TerrainTextureGen.Layer("LarchGranite", TerrainTextureGen.Kind.DarkRock,
                new TerrainTextureGen.Palette { a = C3(0.42f, 0.42f, 0.43f), b = C3(0.55f, 0.55f, 0.56f), accent = C3(0.68f, 0.68f, 0.69f), dark = C3(0.2f, 0.2f, 0.22f) }, 18f, 307, 1024),
        };

        // ───────────── 构建期 ─────────────
        static LevelKit.TerrainSet ts;
        static Vector3 spawnAt;
        static Quaternion spawnRot;
        static LevelKit.BoundarySpec boundary;

        [MenuItem("Spiritfire/Levels/Build 4-3 彩林海子", priority = 83)]
        public static void BuildMenu() => Build(true);

        /// <summary>地形 → 天空 / 远景雪峰 → 镜面湖 → 据点掩体 → 树 → 地被细节 → 出生点 → 软边界 / 天气 → 遇敌、灵火坛、目标、出口 → 烘焙 → 验收 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            LevelKit.ResetPlateauCache();
            road = Landform.Spline(RoadCtrl, 8);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var world = new GameObject("World").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            ShowcaseSceneBuilder.BuildLighting(Theme, Dir);
            BuildSky();
            ts = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = BaseHeight, heightRange = HeightRange,
                heightRes = 513, splatRes = 1024, tiles = new Vector2Int(3, 3), ground = LarchGround, eval = Sample,
            }, env);
            float tTerrain = (float)sw.Elapsed.TotalSeconds;
            try
            {
                var toSun = -(Quaternion.Euler(Theme.sunEuler) * Vector3.forward);
                FindSpawn();
                BuildBackdrop(env, toSun.normalized, Theme.fogColor);
                var lake = BuildLake(world);
                BuildSiteProps(props);
                Physics.SyncTransforms();
                var trees = PlantTrees();
                var details = BuildDetails();

                var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
                playerSpawn.transform.SetParent(markers, false);
                playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
                var boot = new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();
                boot.stageTitle = Title;

                boundary = LevelKit.BoundarySpec.Default;
                boundary.theme = "Frost";
                boundary.wallBottom = -30;
                boundary.wallTop = 400;
                LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), boundary);
                var weather = LevelKit.Weather(env, Theme, new Vector2(0.85f, 0.5f), 0.22f);
                weather.whiteoutProfile = WeatherProfiles.WhiteoutFrost;

                Physics.SyncTransforms();
                var sites = BuildEncounters(markers);
                var altars = BuildAltars(markers, sites);
                var objective = BuildObjective(markers, sites, altars);
                var portal = BuildExit(markers, objective);
                BuildMarkers(markers);
                flags.Build(Dir, Name, props);

                EditorSceneManager.SaveScene(scene, ScenePath);
                ShowcaseSceneBuilder.BakeEnvironmentLighting(Theme, Dir);
                BakeNav(env);
                EditorSceneManager.SaveScene(scene, ScenePath);
                LevelBuilders.SyncBuildSettings();

                var rep = new LevelKit.Report();
                rep.Line($"{Title} · 验收");
                var (lo, hi) = ts.hf.Range();
                rep.Line($"地形 3 × 3 块 {Size.x:F0} × {Size.y:F0} m（1 m 格），高度场 {lo - BaseHeight:F1}…{hi - BaseHeight:F1} m，生成 {tTerrain:F0} s，全部 {sw.Elapsed.TotalSeconds:F0} s");
                rep.Line($"出生点 {spawnAt}（湖岸），湖 {LakeRadius.x * 2:F0} × {LakeRadius.y * 2:F0} m，最深 {lake.deepest:F1} m，水面网格 {lake.surfaceSize}");
                rep.Line($"树：{string.Join("、", trees.Select(kv => $"{kv.Key} {kv.Value}"))}，共 {trees.Values.Sum()} 棵");
                rep.Line($"地被：{string.Join("、", details.Select(kv => $"{kv.Key} {kv.Value}"))}");
                CheckWalk(rep);
                CheckSceneContents(rep, scene, portal, objective, altars, sites);
                LevelValidator.Run(Spec(), rep);
                rep.Section("资产缺口（白盒）");
                foreach (var kv in LevelKit.PlateauPlaceholders.OrderByDescending(kv => kv.Value)) rep.Line($"    · {kv.Key} ×{kv.Value}");
                rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
                rep.Save($"{LevelKit.ReviewDir}/level_4-3_report.txt");

                if (review) Review();
                EditorSceneManager.SaveScene(scene, ScenePath);
                return rep.failures;
            }
            finally
            {
                ts = null;
                flags = null;
            }
        }

        // ───────────── 天空 ─────────────

        /// <summary>天空换成带云的渐变天（Spiritfire/SkyClouds）：颜色照主题，云团偏在西北（从出生点看，画面左上一大团、右边晴空）</summary>
        static void BuildSky()
        {
            var sky = new Material(Shader.Find("Spiritfire/SkyClouds")) { name = $"SKY_{Theme.key}" };
            sky.SetColor("_TopColor", Theme.skyTop);
            sky.SetColor("_HorizonColor", Theme.skyHorizon);
            sky.SetColor("_BottomColor", Theme.skyBottom);
            sky.SetColor("_SunColor", Theme.sunColor);
            sky.SetFloat("_Exposure", Theme.skyExposure);
            sky.SetFloat("_HorizonSharpness", Theme.skyHorizonSharpness);
            sky.SetFloat("_HorizonGlow", Theme.skyHorizonGlow);
            sky.SetFloat("_SunSize", Theme.skySunSize);
            sky.SetFloat("_SunHalo", Theme.skySunHalo);
            sky.SetFloat("_CloudCover", 0.37f);
            sky.SetFloat("_CloudSoftness", 0.035f);
            sky.SetFloat("_CloudScale", 0.85f);
            sky.SetVector("_CloudRegion", new Vector4(-0.75f, 0.65f, 0.22f, 0));
            sky.SetVector("_CloudWind", new Vector4(1f, 0.25f, 0.004f, 0));
            sky.SetColor("_CloudShadow", new Color(0.64f, 0.72f, 0.87f));
            LevelKit.SaveAsset(sky, $"{Dir}/SKY_{Theme.key}.mat");
            RenderSettings.skybox = sky;
        }

        // ───────────── 出生点 ─────────────

        /// <summary>出生点：南岸卵石滩、离水边两三米，面朝北边谷口的雪峰（照片的机位：贴着水面望过湖去）</summary>
        static void FindSpawn()
        {
            const float x = -30;
            float z = LakeCenter.y - LakeRadius.y * 0.8f;
            while (z > LakeCenter.y - LakeRadius.y * 2.5f && Eval(x, z).lakeR < 1.03f) z -= 0.5f;
            z -= 1.5f;
            spawnAt = new Vector3(x, GroundY(x, z) + 0.05f, z);
            var look = PeakTarget - spawnAt;
            look.y = 0;
            spawnRot = Quaternion.LookRotation(look.normalized);
        }

        // ───────────── 湖 ─────────────

        sealed class Lake
        {
            public float deepest;
            public Vector2 surfaceSize;
        }

        /// <summary>
        /// 湖：WaterVolume（深水托回、涉水减速；盒子 = 湖的外接椭圆 × 1.1，盒角都在岸上的地面下面）+ 一整片水面网格（Water 层，镜面湖材质 + 平面反射）。
        /// 水面网格只是一块大矩形：岸上的地形比水面高，水面在那里被地形挡住
        /// </summary>
        static Lake BuildLake(Transform world)
        {
            var lake = new Lake();
            float deepest = 0;
            for (float a = 0; a < 1; a += 0.05f)
                deepest = Mathf.Min(deepest, GroundY(LakeCenter.x + Mathf.Lerp(-120, 120, a), LakeCenter.y));
            lake.deepest = -deepest;

            var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
            block.name = "Water_Lake · 海子";
            block.transform.SetParent(world, false);
            block.transform.SetPositionAndRotation(new Vector3(LakeCenter.x, 0, LakeCenter.y), Quaternion.Euler(0, -LakeYaw * Mathf.Rad2Deg, 0));
            block.transform.localScale = new Vector3(LakeRadius.x * 2.2f, 1, LakeRadius.y * 2.2f);
            float depth = lake.deepest + 1.5f;
            LevelKit.WaterBody(block, -depth, depth);
            Object.DestroyImmediate(block.GetComponent<MeshRenderer>());
            Object.DestroyImmediate(block.GetComponent<MeshFilter>());

            // 水面：外接矩形再放宽 30 m，Water 层
            var shader = Shader.Find("Spiritfire/MirrorLake");
            var mat = new Material(shader) { name = "M_MirrorLake", enableInstancing = false };
            // 照片里近处的水是透着湖底的墨绿，倒影比实物暗一点、偏绿
            mat.SetFloat("_FresnelBase", 0.24f);
            mat.SetColor("_DeepColor", new Color(0.03f, 0.12f, 0.09f));
            mat.SetColor("_ShallowColor", new Color(0.26f, 0.34f, 0.24f));
            mat.SetColor("_ReflectionTint", new Color(0.8f, 0.88f, 0.8f));
            LevelKit.SaveAsset(mat, $"{Dir}/M_MirrorLake.mat");
            float hx = LakeRadius.x * 1.35f + 30, hz = LakeRadius.y * 1.6f + 30;
            const int n = 8;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int j = 0; j <= n; j++)
            for (int i = 0; i <= n; i++)
                verts.Add(new Vector3(Mathf.Lerp(-hx, hx, i / (float)n), 0, Mathf.Lerp(-hz, hz, j / (float)n)));
            for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
            {
                int a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
                tris.AddRange(new[] { a, c, b, b, c, d });
            }
            var mesh = new Mesh { name = $"LakeSurface_{Name}" };
            mesh.SetVertices(verts);
            mesh.SetNormals(verts.Select(_ => Vector3.up).ToList());
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            mesh.bounds = new Bounds(mesh.bounds.center, mesh.bounds.size + new Vector3(0, 1, 0));
            LevelKit.SaveAsset(mesh, $"{Dir}/LakeSurface_{Name}.asset");
            var surf = new GameObject("Lake Surface · 镜面") { layer = LayerMask.NameToLayer("Water") };
            surf.transform.SetParent(world, false);
            surf.transform.position = new Vector3(LakeCenter.x, 0, LakeCenter.y);
            surf.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = surf.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var refl = surf.AddComponent<PlanarReflection>();
            refl.surface = mr;
            refl.resolutionScale = 0.5f;
            lake.surfaceSize = new Vector2(hx * 2, hz * 2);
            return lake;
        }

        // ───────────── 软边界 ─────────────

        /// <summary>游玩区遮罩（0..1，≥ 0.2 算界内）：谷底两侧各让出 70 m 林坡、南北到地形边缘内 140 m，再高出谷底 90 m 以上的山坡不算</summary>
        static float Playable(Vector2 p)
        {
            float W = HalfWidth(p.y), u = p.x - AxisX(p.y);
            var g = Eval(p.x, p.y);
            float d = Mathf.Min(Mathf.Min(W + 70 - Mathf.Abs(u), p.y + 560), 600 - p.y);
            d = Mathf.Min(d, (90 - (g.y - FloorY(p.y))) * 2);
            return Landform.Smooth(-4, 4, d);
        }

        // ───────────── 导航 ─────────────

        /// <summary>
        /// 导航网格只烘游玩区那一块（谷底 + 两岸让出的林坡，约 700 × 1200 m）：整张 1.5 km 地形连同两岸大山一起体素化又慢又吃内存，
        /// 软边界外反正不可走
        /// </summary>
        static void BakeNav(Transform parent)
        {
            var go = new GameObject("NavMesh");
            go.transform.SetParent(parent, false);
            var nav = go.AddComponent<NavMeshSurface>();
            nav.collectObjects = CollectObjects.Volume;
            nav.center = new Vector3(-40, 90, 20);
            nav.size = new Vector3(720, 300, 1220);
            nav.useGeometry = UnityEngine.AI.NavMeshCollectGeometry.PhysicsColliders;
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            nav.layerMask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
            nav.BuildNavMesh();
            if (nav.navMeshData) LevelKit.SaveAsset(nav.navMeshData, $"{Dir}/NavMesh_{Name}.asset");
        }

        // ───────────── 检查 ─────────────

        /// <summary>能走：出生点到北岸林地、东岸车路、西岸霜滩都在导航网格上连得通（地形坡度 + 树干碰撞之后）</summary>
        static void CheckWalk(LevelKit.Report rep)
        {
            rep.Section("连通");
            Vector3 P(float x, float z) => new(x, GroundY(x, z), z);
            LevelKit.CheckPath(rep, new[]
            {
                ("出生点", spawnAt),
                ("东岸车路", P(200, -60)),
                ("北岸林地", P(20, 90)),
                ("西岸霜滩", P(-170, -30)),
                ("北边谷地", P(-60, 360)),
            });
        }

        // ───────────── 截图 ─────────────

        /// <summary>雪峰视线目标：谷口主峰的峰顶附近</summary>
        static Vector3 PeakTarget => new(MainPeak.x, 520, MainPeak.y);

        static void Review()
        {
            Vector3 E(float x, float z, float up = Eye) => new(x, GroundY(x, z) + up, z);
            var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
            try
            {
                var hero = spawnAt + Vector3.up * Eye;
                var heroLook = new Vector3(-90, 150, 900);
                cam.fieldOfView = 60;
                LevelKit.Capture(cam, fpRig, "level_4-3", new[]
                {
                    ("Hero", hero, heroLook, false),
                    ("HeroLow", new Vector3(spawnAt.x + 6, 0.9f, spawnAt.z + 7), heroLook + new Vector3(0, -60, 0), false),
                    ("EastRoad", E(196, -170), E(170, 240, 30), false),
                    ("Forest", E(-10, 70), E(40, 140, 6), false),
                    ("WestFrost", E(-175, -40), E(200, 0, 60), false),
                    ("Valley", E(-60, 330), PeakTarget, false),
                    ("Aerial", new Vector3(-40, 180, -420), new Vector3(-40, 60, 200), false),
                    ("Ruins", E(-95, 300, 2.2f), G(-75, 330, 1.5f), false),
                    ("Gate", E(-112, 500, 2), gateCenter + Vector3.up * 3, false),
                });
                cam.fieldOfView = 72;
                LevelKit.Capture(cam, fpRig, "level_4-3_fp", new[] { ("SpawnFP", hero, heroLook, true) });
            }
            finally
            {
                Object.DestroyImmediate(preview);
            }
        }
    }
}
