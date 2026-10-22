using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 1-4 干涸月牙泉 · 旱魃（docs/level-design/maps/1-4.md；unity-maps-v1.md 第 1 节 1-4、第 3 节场地）的首领场：沉沙古城之下的地下巨穴。
    /// 关卡坐标 = 世界 XZ（米），穴底 y = 0。地形 176 × 176 m，穴外岩层顶面 y ≈ 36（玩家看不到，只是让穴壁一直高过穴顶）。
    ///
    ///   出生 · 月牙泉入口岩台：穴东侧 8 m 高的岩台（Shelf），只是一块安全的起步台（安全区，不开店——补给营在上一关 1-3 的寺院塔院，
    ///   不让玩家连着撞见两家店）；台沿是俯瞰泉床的眺台（直落 8 m，可以跳下去当捷径）
    ///   → 转一次弯的下行坡（从岩台西南角起，贴着穴壁切出的坡槽绕到穴底，约 33 m、13°）
    ///   → 地下巨穴：80 × 70 m 椭圆碗底，穴壁 12 m 宽内陡升（60–70°，爬不上去，也不立空气墙）；
    ///     月牙泉床下沉 1.5 m（凸侧朝南、两角朝北），南半圈的泉床底还剩一圈 0.4 m 浅水；泉床内侧一块 3.2 m 岩岛（东北侧坡道可上，俯射层）；
    ///     月牙阁在泉的凸侧（南岸，SM_Tripo_DesertCrescentPavilion × 1.2，二层台 6 m）；四座沙丘环在碗底边缘（掩体 / 挡日轮）
    ///   → 穴顶：y = 24 的整片穴顶，只在月牙阁北上方留一道 40 × 9 m 的裂缝（两对 SM_Env_DesertCaveCeilingRift 相向悬垂），
    ///     场景主光（太阳，俯角 62°）只从裂缝照进来，真实阴影落成一条斜光柱，打在泉床南段与岩岛之间（日晒区）。
    ///
    /// 穴顶面片是 1 m 厚的无碰撞体块、放在 Character 层：
    ///   · 主光照不进来（投影照常，体块是闭合的，不靠双面投影）；
    ///   · 俯视地图相机（L5 / U7）不拍 Character 层，全图能看到穴底；
    ///   · 没有碰撞，不影响子弹、导航、可达性栅格——日晒判定由 <see cref="SunShaft"/> 标记声明开口（旱魃的 SunExposure 用）。
    /// 场景只放环境和标记（D17 / L1）：PlayerSpawn、自举标记、起步台安全区（<see cref="SafeZone"/>，没有 SupplyCamp / 商店）、首领场地（<see cref="BossArena"/>）、
    /// 首领关流程（<see cref="BossEncounter"/>，首领 boss_hanba；出口在打完后由它升起）、日光裂缝（<see cref="SunShaft"/>）。
    /// 生成：Spiritfire ▸ Levels ▸ Build 1-4 干涸月牙泉（或 bridge.sh level 1-4）。
    /// </summary>
    [LevelBuilder("1-4", ScenePath)]
    public static class Level_1_4
    {
        public const string Dir = "Assets/Levels/L1_4_Crescent";
        public const string ScenePath = "Assets/Scenes/L1_4_Crescent.unity";
        const string Name = "L1_4";
        /// <summary>首领（HanbaDef.Id；编辑器程序集也引用得到，这里写字面量免得构建器依赖首领单元的文件顺序）</summary>
        const string BossId = "boss_hanba";

        // ── 高度（世界 y）──
        /// <summary>高度场里 Base 米 = 世界 y 0（泉床挖到 −1.5 也还在范围内）</summary>
        const float Base = 10f;
        /// <summary>穴外岩层顶面、穴顶、岩台台面</summary>
        const float Top = 36f, CeilingY = 24f, ShelfFloor = 8f;
        static readonly Vector2 Origin = new(-80, -84), Size = new(176, 176);

        // ── 巨穴 ──
        static readonly Vector2 Bowl = Vector2.zero, BowlRadius = new(40, 35);
        const float BowlWall = 12f;
        static readonly Vector2 Shelf = new(54, -14), ShelfRadius = new(13, 10);
        const float ShelfWall = 9f;

        // ── 月牙泉 ──
        static readonly Vector2 Spring = new(0, -2);
        /// <summary>外圆半径、内圆偏移（朝北）、朝向（度，90 = +Z）、边坡宽、下沉</summary>
        const float SpringR = 20f, SpringOffset = 8f, SpringFacing = 90f, SpringFeather = 4f, SpringDepth = 1.5f;
        /// <summary>浅水：水深、只在平底宽 ≥ 这个值的那段铺（南半圈）、每段的角度</summary>
        const float WaterDepth = 0.4f, WaterMinWidth = 2.5f, WaterStepDeg = 11f;

        // ── 岩岛（泉床内侧）──
        static readonly Vector2 Island = new(0, 6);
        const float IslandHalfLen = 7f, IslandHalfWid = 5f, IslandAngle = 10f, IslandHeight = 3.2f, IslandEdge = 1.3f;
        static readonly Vector2 IslandRampFoot = new(13, 14), IslandRampTop = new(3.5f, 7.5f);

        // ── 月牙阁（泉的凸侧）──
        const string PavilionId = "SM_Tripo_DesertCrescentPavilion";
        static readonly Vector2 Pavilion = new(0, -27.5f);
        const float PavilionYaw = 0f, PavilionScale = 1.2f;
        /// <summary>设计包围盒 × 1.2（没有 Prefab 时的白盒尺寸）、二层台高</summary>
        static readonly Vector3 PavilionSize = new(10.2f, 13.2f, 9.2f);
        const float PavilionTerrace = 6f;

        // ── 沙丘（碗底边缘：中心、半轴、高、长轴角度）──
        static readonly (Vector2 c, Vector2 r, float h, float angle)[] Dunes =
        {
            (new Vector2(-29, 4), new Vector2(9, 7), 3.0f, 70), (new Vector2(29, 12), new Vector2(8, 6), 2.6f, -20),
            (new Vector2(-20, -24), new Vector2(8, 6), 2.2f, 30), (new Vector2(-22, 22), new Vector2(8, 6), 2.4f, 45),
        };

        // ── 下行坡（岩台 → 穴底，转一次弯）──
        static readonly Vector2[] RampCtrl = { new(46, -20), new(42, -29), new(35, -33), new(28, -30), new(23, -25) };
        static readonly float[] RampHeights = { ShelfFloor, 6.2f, 4f, 1.8f, 0f };
        const float RampHalfWidth = 3.5f, RampShoulder = 3f;
        static readonly PathSpline RampPath = new PathSpline(RampCtrl, 6).WithHeights(RampHeights, 4);

        // ── 标记 ──
        static readonly Vector2 PlayerSpawnAt = new(62, -13), CampAt = new(53, -14), Balcony = new(42, -11);
        static readonly Vector2 BossSpawn = new(0, 24), PlayerEntry = new(20, -21), RewardAt = new(8, -6), ExitAt = new(0, 31);
        const float ArenaRadius = 33f;
        static readonly Vector2[] SummonPoints = { new(-24, -8), new(24, -2), new(-10, 27), new(12, 27) };

        // ── 太阳与裂缝 ──
        /// <summary>主光俯角 / 方位（度）；光柱落点中心（穴底）；裂缝长轴方向（度）、缝宽、穴顶开口半宽</summary>
        const float SunPitch = 62f, SunYaw = 15f, RiftYaw = 0f, RiftGap = 7f;
        static readonly Vector2 ShaftPatch = new(-2, -13);
        static readonly Vector2 ApertureHalf = new(20f, 4.5f);
        const string RiftId = "SM_Env_DesertCaveCeilingRift";
        static readonly Vector3 RiftSize = new(20.09f, 9f, 9.04f);

        static Quaternion SunRotation => Quaternion.Euler(SunPitch, SunYaw, 0);
        static Vector3 ToSun => -(SunRotation * Vector3.forward);

        /// <summary>穴顶开口中心（世界 XZ）：从光柱落点沿日光来向回溯到穴顶高度</summary>
        static Vector2 Aperture
        {
            get
            {
                var d = ToSun;
                float t = CeilingY / d.y;
                return new Vector2(ShaftPatch.x + d.x * t, ShaftPatch.y + d.z * t);
            }
        }

        // ───────────── 地貌 ─────────────

        static float Dune(Vector2 p, Vector2 c, Vector2 r, float h, float angle)
        {
            float a = angle * Mathf.Deg2Rad;
            var d = p - c;
            float lx = d.x * Mathf.Cos(a) + d.y * Mathf.Sin(a), lz = -d.x * Mathf.Sin(a) + d.y * Mathf.Cos(a);
            float q = Mathf.Sqrt(lx * lx / (r.x * r.x) + lz * lz / (r.y * r.y));
            float wob = 1 + Fbm(p, 7, 2, 31) * 0.12f;
            return h * Mathf.Pow(1 - Smooth(0, 1, q * wob), 1.2f);
        }

        /// <summary>穴底的轻微起伏（泉床里压平，水深才一致）</summary>
        static float FloorNoise(Vector2 p) => Fbm(p, 26, 3, 4) * 0.22f;

        /// <summary>可玩区（防越界 / 俯视图）：碗底往穴壁里 4 m、岩台往壁里 3 m、坡槽两侧 3 m 以内算界内</summary>
        static float Playable(Vector2 p)
        {
            float Ellipse(Vector2 c, Vector2 r, float grow)
            {
                var d = p - c;
                float rr = Mathf.Sqrt(d.x * d.x / (r.x * r.x) + d.y * d.y / (r.y * r.y));
                return 1 - Smooth(1, 1 + grow / Mathf.Min(r.x, r.y), rr);
            }
            float v = Mathf.Max(Ellipse(Bowl, BowlRadius, 4), Ellipse(Shelf, ShelfRadius, 3));
            var (d, _) = RampPath.Nearest(p, RampHalfWidth + 8);
            return Mathf.Max(v, 1 - Smooth(RampHalfWidth + 2, RampHalfWidth + 4, d));
        }

        static LevelKit.Sample Eval(Vector2 p)
        {
            var s = new LevelKit.Sample();
            float top = Top + Fbm(p, 40, 3, 1) * 1.5f;
            // 巨穴与岩台各是一个洞穴碗（口沿 0）：碗底 0 → 1 = 穴壁顶，在各自的底面高度与岩层顶面之间插值，底面不随岩层的噪声起伏
            float bowl = CaveBowl(p, Bowl, BowlRadius, Top, BowlWall, 0, 1, 5, out float floor, out float wallA);
            float shelf = CaveBowl(p, Shelf, ShelfRadius, Top - ShelfFloor, ShelfWall, 0, 1, 7, out float shelfFloor, out float wallB);
            float spring = Crescent(p, Spring, SpringR, SpringOffset, SpringFacing, SpringFeather) * floor;
            float floorY = FloorNoise(p) * (1 - 0.85f * spring);
            float hA = Mathf.Lerp(floorY, top, (bowl + Top) / Top);
            float hB = Mathf.Lerp(ShelfFloor + FloorNoise(p) * 0.5f, top, (shelf + Top - ShelfFloor) / (Top - ShelfFloor));
            float h = Mathf.Min(hA, hB);
            bool onShelf = hB < hA;

            // 月牙泉床
            h -= SpringDepth * spring;
            // 岩岛 + 东北侧坡道：坡道走廊里把岩岛的陡边换成直坡（坡顶压进平顶 3 m），中线一路 16° 上去，不会在岛沿撞上一道陡坎
            float isl = Mesa(p, Island, IslandHalfLen, IslandHalfWid, IslandAngle, IslandHeight, IslandEdge, 21) * floor;
            var (rt, rmask) = Ramp(p, IslandRampFoot, IslandRampTop, 4.5f, 2f);
            float islRamp = rmask * floor;
            h += Mathf.Lerp(isl, IslandHeight * rt, islRamp);
            // 碗底边缘的沙丘
            float dunes = 0;
            foreach (var (c, r, dh, ang) in Dunes) dunes += Dune(p, c, r, dh, ang);
            dunes *= floor * (1 - spring);
            h += dunes;
            // 下行坡：沿纵断面压平（又挖又填），坡槽两侧是切开的岩壁
            h = RampPath.Flatten(p, h, RampHalfWidth, RampShoulder, PathSpline.Mode.Both, out float rampMask);
            s.h = h + Base;

            // ── 分层倾向 ──
            float islBody = Smooth(0.3f, 1.2f, isl);
            float islTop = Smooth(IslandHeight - 0.5f, IslandHeight - 0.1f, Mathf.Max(isl, IslandHeight * rt * islRamp));
            s.fluid = Smooth(0.35f, 0.9f, spring);
            s.packed = Mathf.Max(Mathf.Max(rampMask, islTop * 0.8f), Mathf.Max(onShelf ? 0.7f * shelfFloor : 0, islRamp * 0.8f));
            float sandPatches = Smooth(0.1f, 0.5f, Fbm(p, 18, 3, 9)) * 0.6f;
            s.sand = Mathf.Max(Smooth(0.2f, 1.2f, dunes), sandPatches * floor * (1 - spring)) * (1 - rampMask);
            s.rock = Mathf.Max(Mathf.Max(wallA, wallB), islBody * (1 - islTop)) * (1 - rampMask) * (1 - spring);
            return s;
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build 1-4 干涸月牙泉", priority = 63)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh → 验收检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var props = new GameObject("Props").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            var sun = CaveLighting(theme);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = 50, heightRes = 513, splatRes = 512,
                ground = LevelKit.Ground.Desert, eval = Eval,
            }, env);
            var terrain = set.First;
            var m = new Materials();

            var ceiling = BuildCeiling(env, m);
            var shaft = BuildShaft(markers);
            var waters = BuildSpring(terrain, env, props);
            var pavilion = LevelKit.PlaceOrBox(PavilionId, props, terrain, Pavilion.x, Pavilion.y, PavilionYaw, PavilionSize);
            if (pavilion && pavilion.name.StartsWith(PavilionId)) pavilion.transform.localScale = Vector3.one * PavilionScale;
            BuildArenaProps(terrain, props);
            var start = BuildShelf(terrain, props, markers);
            var arena = BuildArena(terrain, markers, out var exitPoint, out var rewardPoint);
            BuildEncounter(markers, arena, exitPoint, rewardPoint);

            // 玩家在 Core 场景（L1）：这里只放出生标记（燎、冲锋枪起手，SceneFlow 带着上一关的局状态组装）+ 自举标记
            var spawnAt = LevelKit.OnGround(terrain, PlayerSpawnAt.x, PlayerSpawnAt.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(new Vector3(Balcony.x - PlayerSpawnAt.x, 0, Balcony.y - PlayerSpawnAt.y));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            if (!EditorBuildSettings.scenes.Any(s => s.path == ScenePath))
                EditorBuildSettings.scenes = EditorBuildSettings.scenes.Append(new EditorBuildSettingsScene(ScenePath, true)).ToArray();

            var rep = new LevelKit.Report();
            rep.Line("1-4 干涸月牙泉 · 白盒验收");
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            CheckGeometry(rep, set, sun, shaft, ceiling, waters, pavilion, start);
            LevelValidator.Run(Spec(terrain), rep); // 主线、坡度、视线 + L5 规则集（含防越界：没有空气墙，穴壁本身是边界）
            CheckSceneContents(rep, scene);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_1-4_report.txt");

            if (review)
            {
                Vector3 E(Vector2 q, float dy = 1.62f) => G(q, dy);
                var preview = PlayerRigBuilder.BuildPreview(PlayerRigBuilder.Liao, spawnAt, spawnRot, out var cam, out var fpRig);
                try
                {
                    // 高空机位先把穴顶收起来（否则只拍到一块岩板），穴里的机位再放回去
                    ceiling.gameObject.SetActive(false);
                    LevelKit.Capture(cam, fpRig, "level_1-4", new[]
                    {
                        ("Aerial", new Vector3(70, 95, -95), new Vector3(0, 0, -2), false),
                    });
                    ceiling.gameObject.SetActive(true);
                    LevelKit.Capture(cam, fpRig, "level_1-4", new[]
                    {
                        ("Spawn", E(PlayerSpawnAt), E(Balcony, 1f), true),
                        ("Balcony", E(Balcony + new Vector2(2, 0)), G(Island, 2f), false),
                        ("Ramp", E(new Vector2(40, -31)), G(RampCtrl[^1], 1f), false),
                        ("Entry", E(PlayerEntry), G(BossSpawn, 3f), true),
                        ("Shaft", E(new Vector2(16, -20)), G(ShaftPatch, 0.5f), false),
                        ("SpringBed", E(new Vector2(-14, -13), 0.2f), G(new Vector2(14, -12), 0f), false),
                        ("IslandTop", E(Island, IslandHeight + 1.62f), G(Pavilion, 5f), false),
                        ("Pavilion", E(new Vector2(-10, -16)), G(Pavilion, 6f), false),
                        ("LookUp", E(new Vector2(-6, -13)), new Vector3(Aperture.x, CeilingY + 6, Aperture.y), false),
                        ("BossSide", E(new Vector2(0, 20)), G(Pavilion, 4f), false),
                    });
                }
                finally
                {
                    ceiling.gameObject.SetActive(true);
                    Object.DestroyImmediate(preview);
                }
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        sealed class Materials
        {
            public readonly Material ceiling = LevelKit.Mat(Dir, "CaveCeiling", new Color(0.3f, 0.24f, 0.2f), 0.98f);
            public readonly Material earth = LevelKit.Mat(Dir, "RammedEarth", new Color(0.74f, 0.58f, 0.42f));
        }

        /// <summary>
        /// 穴里的光：主光转到「从南偏西斜上方照进裂缝」（俯角 62°、方位 15°），亮一点好让光柱在暗处炸开；
        /// 环境光 / 反射压暗到四成多，雾换成偏暖的暗色——穴里除了光柱都在阴影里，暗部靠环境光读形。返回主光
        /// </summary>
        static Light CaveLighting(ShowcaseTheme theme)
        {
            var sun = RenderSettings.sun;
            if (sun)
            {
                sun.transform.rotation = SunRotation;
                sun.intensity = theme.sunIntensity * 1.6f;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 1f;
            }
            RenderSettings.ambientSkyColor = theme.ambientSky * 0.45f;
            RenderSettings.ambientEquatorColor = theme.ambientEquator * 0.42f;
            RenderSettings.ambientGroundColor = theme.ambientGround * 0.4f;
            RenderSettings.reflectionIntensity = 0.3f;
            RenderSettings.fogColor = Color.Lerp(theme.fogColor, new Color(0.16f, 0.11f, 0.08f), 0.6f);
            RenderSettings.fogStartDistance = 35f;
            RenderSettings.fogEndDistance = 170f;
            return sun;
        }

        /// <summary>
        /// 穴顶：开口坐标系（中心 = 裂缝中心、绕 Y 转 RiftYaw）里四块 1 m 厚的岩板围出 40 × 9 m 的洞，铺满整张地形外再多 40 m；
        /// 没有碰撞、放 Character 层（见类注释）。两对裂缝岩体相向悬垂在洞的两条长边下（顶面高出穴顶 1.5 m，底面垂到穴顶下 7.5 m），
        /// 留 7 m 的缝——它们有碰撞，真实挡光，也挡日晒判定的射线
        /// </summary>
        static Transform BuildCeiling(Transform env, Materials m)
        {
            var root = new GameObject("Cave Ceiling").transform;
            root.SetParent(env, false);
            var a = Aperture;
            root.SetPositionAndRotation(new Vector3(a.x, CeilingY, a.y), Quaternion.Euler(0, RiftYaw, 0));
            float hx = ApertureHalf.x, hz = ApertureHalf.y, L = 160f;
            var slabs = new[]
            {
                ("West", new Vector2(-(L + hx) * 0.5f, 0), new Vector2(L - hx, 2 * L)),
                ("East", new Vector2((L + hx) * 0.5f, 0), new Vector2(L - hx, 2 * L)),
                ("North", new Vector2(0, (L + hz) * 0.5f), new Vector2(2 * hx, L - hz)),
                ("South", new Vector2(0, -(L + hz) * 0.5f), new Vector2(2 * hx, L - hz)),
            };
            foreach (var (n, c, sz) in slabs)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = $"Ceiling Slab {n}";
                Object.DestroyImmediate(go.GetComponent<Collider>());
                go.transform.SetParent(root, false);
                go.transform.localPosition = new Vector3(c.x, 0.5f, c.y);
                go.transform.localRotation = Quaternion.identity;
                go.transform.localScale = new Vector3(sz.x, 1f, sz.y);
                var r = go.GetComponent<MeshRenderer>();
                r.sharedMaterial = m.ceiling;
                r.shadowCastingMode = ShadowCastingMode.On;
                go.layer = Layers.Character;
                go.isStatic = true;
            }
            // 岩体挂在世界原点下（PlaceOrBox 摆 Prefab 时按父节点本地坐标摆，白盒按世界坐标——父节点在原点两者才一致）
            var rift = new GameObject("Ceiling Rift").transform;
            rift.SetParent(env, false);
            foreach (float along in new[] { -ApertureHalf.x * 0.5f, ApertureHalf.x * 0.5f })
            foreach (int side in new[] { -1, 1 })
            {
                var local = new Vector3(along, 1.5f - RiftSize.y, side * (RiftGap * 0.5f + RiftSize.z * 0.5f));
                // 正面（+Z）是裂缝口的悬挑边：缝南侧的那块朝北，缝北侧的朝南
                float yaw = RiftYaw + (side < 0 ? 0 : 180);
                var piece = LevelKit.PlaceOrBox(RiftId, rift, root.TransformPoint(local), RiftSize, yaw);
                if (piece) piece.name = $"{(piece.name.StartsWith(RiftId) ? "Rift" : piece.name)} {(side < 0 ? "S" : "N")}{(along < 0 ? "W" : "E")}";
            }
            return root;
        }

        /// <summary>日光裂缝标记（穴顶高度、开口半宽）：日晒判定 + 光柱外观（运行时生成）</summary>
        static SunShaft BuildShaft(Transform markers)
        {
            var a = Aperture;
            var go = new GameObject("Sun Shaft");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(new Vector3(a.x, CeilingY, a.y), Quaternion.Euler(0, RiftYaw, 0));
            var s = go.AddComponent<SunShaft>();
            s.halfSize = ApertureHalf;
            s.beamCount = 7;
            return s;
        }

        /// <summary>
        /// 泉床：南半圈平底宽够的那一段，每 11° 一段 0.4 m 深的浅水（L8 WaterVolume，踩水减灼烧）；整条泉床铺龟裂泉床贴花（随机转向，水下也看得见）
        /// </summary>
        static List<WaterVolume> BuildSpring(Terrain t, Transform env, Transform props)
        {
            var root = new GameObject("Crescent Spring").transform;
            root.SetParent(env, false);
            var waters = new List<WaterVolume>();
            float ri = SpringR * 0.86f, flatOuter = SpringR - SpringFeather;
            var inner = Spring + new Vector2(Mathf.Cos(SpringFacing * Mathf.Deg2Rad), Mathf.Sin(SpringFacing * Mathf.Deg2Rad)) * SpringOffset;
            float waterY = -SpringDepth + WaterDepth;
            int seg = 0;
            for (float deg = -180; deg < 180; deg += WaterStepDeg)
            {
                float a = deg * Mathf.Deg2Rad;
                var u = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                // 沿 u 从泉心出发：平底从内圆边界（离内圆心 ri）到外圆边坡起点（离泉心 r − feather）
                var o = inner - Spring;
                float b = Vector2.Dot(u, o), disc = b * b - o.sqrMagnitude + ri * ri;
                if (disc < 0) continue;
                float tIn = b + Mathf.Sqrt(disc);
                float width = flatOuter - tIn;
                if (width < WaterMinWidth) continue;
                float tm = (tIn + flatOuter) * 0.5f;
                var c = Spring + u * tm;
                var tangent = new Vector2(-u.y, u.x);
                float len = tm * WaterStepDeg * Mathf.Deg2Rad * 1.12f;
                float yaw = Mathf.Atan2(tangent.x, tangent.y) * Mathf.Rad2Deg;
                var block = LevelKit.Box($"Spring Water {++seg:00}", root, new Vector3(c.x, -SpringDepth, c.y), new Vector3(width - 0.6f, WaterDepth, len), yaw, null, 0);
                // 相邻两段错开 2 mm，重叠处的水面不打架
                var w = LevelKit.WaterBody(block, -SpringDepth, WaterDepth + (seg % 2) * 0.002f);
                w.shallow = 0.15f;
                w.deep = 1.3f;
                waters.Add(w);
            }
            // 龟裂泉床贴花：沿泉床中线每 14°
            var rng = new System.Random(14);
            for (float deg = -180; deg < 180; deg += 14)
            {
                float a = deg * Mathf.Deg2Rad;
                var u = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                var o = inner - Spring;
                float b = Vector2.Dot(u, o), disc = b * b - o.sqrMagnitude + ri * ri;
                float tIn = disc >= 0 ? b + Mathf.Sqrt(disc) : 0;
                if (flatOuter - tIn < 1f) continue;
                var c = Spring + u * ((tIn + flatOuter) * 0.5f);
                var go = ShowcaseSceneBuilder.Place("SM_Decal_DesertCrackedBed", props, LevelKit.OnGround(t, c.x, c.y, 0.02f), (float)rng.NextDouble() * 360f);
                if (go) go.isStatic = true;
            }
            return waters;
        }

        /// <summary>碗底的散件：巨砾（2 m 上下的掩体）、月牙阁前的残柱与碑</summary>
        static void BuildArenaProps(Terrain t, Transform props)
        {
            var rng = new System.Random(4);
            foreach (var (p, h) in new[]
                     {
                         (new Vector2(-9, -31), 1.6f), (new Vector2(11, -31), 1.4f), (new Vector2(-33, -10), 2.2f), (new Vector2(-30, 19), 1.8f),
                         (new Vector2(26, 25), 2.0f), (new Vector2(8, 19), 1.5f), (new Vector2(-20, 6), 1.3f), (new Vector2(33, -6), 1.9f),
                     })
                LevelKit.Prop("SM_Env_DesertSandstone", props, t, p.x, p.y, (float)rng.NextDouble() * 360f, h, 0.3f);
            LevelKit.Prop("SM_Tripo_DesertColumnRuin", props, t, -8, -24.5f, 15);
            LevelKit.Prop("SM_Tripo_DesertColumnRuin", props, t, 8, -24.5f, -20);
            LevelKit.Prop("SM_Prop_DesertStele", props, t, 7, -32, 200);
        }

        /// <summary>
        /// 月牙泉入口岩台：一块安全的起步台——只有安全区（<see cref="SafeZone"/>，半径 11 m：敌人进不来，首领关门槛在台上不触发），
        /// 不开店（补给营在 1-3 寺院塔院，刚买完补给，不再连着来一家店）。两只火盆、陶罐、半截残墙；火盆间一盏不投影的暖色点光
        /// </summary>
        static SafeZone BuildShelf(Terrain t, Transform props, Transform markers)
        {
            var at = LevelKit.OnGround(t, CampAt.x, CampAt.y);
            var go = new GameObject("Start Platform");
            go.transform.SetParent(markers, false);
            go.transform.SetPositionAndRotation(at, Quaternion.LookRotation(new Vector3(PlayerSpawnAt.x - CampAt.x, 0, PlayerSpawnAt.y - CampAt.y)));
            var zone = go.AddComponent<SafeZone>();
            zone.radius = 11f;
            LevelKit.Prop("SM_Tripo_DesertBrazier", props, t, 58, -6, 0);
            LevelKit.Prop("SM_Tripo_DesertBrazier", props, t, 58, -22, 0);
            LevelKit.Prop("SM_Prop_DesertUrns", props, t, 64, -7, 40);
            LevelKit.Prop("SM_Env_DesertRuin", props, t, 66, -15, 95);
            var light = new GameObject("Brazier Light").AddComponent<Light>();
            light.transform.SetParent(props, false);
            light.transform.position = at + Vector3.up * 3f;
            light.type = LightType.Point;
            light.color = new Color(1f, 0.62f, 0.32f);
            light.intensity = 3f;
            light.range = 16f;
            light.shadows = LightShadows.None;
            return zone;
        }

        /// <summary>
        /// 首领场地（<see cref="BossArena"/>，只给 boss_hanba）：圆心 (0, 0)、半径 33 m（碗底椭圆 40 × 35 里面）。
        /// 出生点在岩岛北侧、面朝南；玩家入场点在坡脚西北（东南方进场）；召唤点四个避开泉床；掩体点 = 月牙阁敞廊、岩岛南北、两座大沙丘背后；
        /// 栖落点 = 岩岛顶、月牙阁二层台；边缘点一圈 8 个。另给出口点（北壁下）与宝箱落点
        /// </summary>
        static BossArena BuildArena(Terrain t, Transform markers, out Transform exitPoint, out Transform rewardPoint)
        {
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(t, q.x, q.y, dy);
            var root = new GameObject("BossArena").transform;
            root.SetParent(markers, false);
            root.position = new Vector3(Bowl.x, 0, Bowl.y);
            var arena = root.gameObject.AddComponent<BossArena>();
            arena.bossId = BossId;
            arena.shape = BossArenaShape.Circle;
            arena.radius = ArenaRadius;
            Transform Point(string name, Vector3 pos, Vector2 facing)
            {
                var p = new GameObject(name).transform;
                p.SetParent(root, false);
                p.position = pos;
                if (facing.sqrMagnitude > 1e-4f) p.rotation = Quaternion.LookRotation(new Vector3(facing.x, 0, facing.y));
                return p;
            }
            arena.bossSpawn = Point("BossSpawn", G(BossSpawn), new Vector2(0, -1));
            arena.playerEntry = Point("PlayerEntry", G(PlayerEntry), Island - PlayerEntry);
            arena.summonPoints = SummonPoints.Select((q, i) => Point($"Summon_{i + 1}", G(q), -q)).ToArray();
            arena.coverPoints = new[]
            {
                Point("Cover_Pavilion", G(Pavilion + new Vector2(0, -1.5f)), Vector2.up), Point("Cover_IslandS", G(Island + new Vector2(0, -6.5f)), Vector2.down),
                Point("Cover_IslandN", G(Island + new Vector2(0, 6.5f)), Vector2.up), Point("Cover_DuneW", G(Dunes[0].c + new Vector2(-6, 0)), Vector2.left),
                Point("Cover_DuneE", G(Dunes[1].c + new Vector2(5, 3)), Vector2.right),
            };
            arena.perchPoints = new[]
            {
                Point("Perch_IslandTop", G(Island), Vector2.down), Point("Perch_Pavilion", G(Pavilion) + Vector3.up * PavilionTerrace, Vector2.up),
            };
            arena.edgePoints = Enumerable.Range(0, 8).Select(i =>
            {
                float a = i * 45f * Mathf.Deg2Rad;
                var off = new Vector2(Mathf.Sin(a), Mathf.Cos(a)) * (ArenaRadius - 2f);
                return Point($"Edge_{i + 1}", G(Bowl + off), -off);
            }).ToArray();
            exitPoint = Point("Boss Exit", G(ExitAt), new Vector2(0, 1));
            exitPoint.SetParent(markers, true);
            rewardPoint = Point("Boss Reward", G(RewardAt), PlayerEntry - RewardAt);
            rewardPoint.SetParent(markers, true);
            return arena;
        }

        /// <summary>首领关流程：走进场地 → 登场预警 2.5 s → 旱魃登场；拴绳 8 m；倒下 → 溃散 → 结算宝箱落在岩岛南侧 → 北壁下升起出口（下一关 2-1）</summary>
        static void BuildEncounter(Transform markers, BossArena arena, Transform exitPoint, Transform rewardPoint)
        {
            var go = new GameObject("Boss Encounter · 旱魃");
            go.transform.SetParent(markers, false);
            go.transform.position = arena.transform.position;
            var enc = go.AddComponent<BossEncounter>();
            enc.bossId = BossId;
            enc.arena = arena;
            enc.difficulty = 0;
            enc.thresholdInset = 2f;
            enc.warnSeconds = 2.5f;
            enc.warnText = "泉床龟裂作响——旱魃自沉睡中苏醒！";
            enc.tetherSlack = 8f;
            enc.exitPoint = exitPoint;
            enc.rewardPoint = rewardPoint;
        }

        /// <summary>白盒自查：关键点高度、裂缝光柱真的落在设计的位置（从落点朝太阳打射线：落点进光、偏出缝外一侧进影）、浅水段数、月牙阁、补给营</summary>
        static void CheckGeometry(LevelKit.Report rep, LevelKit.TerrainSet set, Light sun, SunShaft shaft, Transform ceiling, List<WaterVolume> waters, GameObject pavilion,
                                  SafeZone start)
        {
            rep.Section("地形与光柱");
            Physics.SyncTransforms();
            float Y(Vector2 q) => set.GroundY(q.x, q.y);
            void Near(string what, float got, float want, float tol)
            {
                if (Mathf.Abs(got - want) > tol) rep.Fail($"{what}：y = {got:F2}，应为 {want:F2}（±{tol}）");
                else rep.Line($"✓ {what}：y = {got:F2}");
            }
            Near("穴底中心", Y(Bowl + new Vector2(-6, -4)), 0, 0.5f);
            Near("岩台（起步台）", Y(CampAt), ShelfFloor, 0.5f);
            Near("泉床南段", Y(Spring + new Vector2(0, -12.6f)), -SpringDepth, 0.4f);
            Near("岩岛顶", Y(Island), IslandHeight, 0.5f);
            Near("下行坡脚", Y(RampCtrl[^1]), 0, 0.6f);
            float rampWorst = 0;
            for (int i = 0; i + 1 < RampPath.points.Count; i++)
            {
                var a = RampPath.points[i];
                var b = RampPath.points[i + 1];
                float d = Vector2.Distance(a, b);
                if (d < 0.05f) continue;
                rampWorst = Mathf.Max(rampWorst, Mathf.Atan(Mathf.Abs(Y(b) - Y(a)) / d) * Mathf.Rad2Deg);
            }
            if (rampWorst > 24f) rep.Fail($"下行坡最陡 {rampWorst:F0}°（> 24°），纵断面 {RampPath.MaxGrade():F0}°");
            else rep.Line($"✓ 下行坡长 {RampPath.length:F0} m、落差 {ShelfFloor:F0} m，最陡 {rampWorst:F0}°（纵断面 {RampPath.MaxGrade():F0}°）");

            // 光柱：落点中心朝太阳的射线穿过裂缝（没被岩体挡住），落点往南 9 m（缝外）被挡。
            // 日晒判定走运行时同一条 SunShaft.SkyOpen，但开口直接用场景里这个标记——编辑器不进 Play 模式，标记不会登记到 SunShaft.All，
            // 用静态登记表会当成「没有穴顶 = 露天」，岩岛就被判成晒得到（穴顶面片没有碰撞，物理射线挡不住它）
            if (!sun) rep.Fail("场景里没有主方向光（RenderSettings.sun）");
            var toSun = sun ? -sun.transform.forward : ToSun;
            var shafts = shaft ? new[] { shaft } : new SunShaft[0];
            var slabs = ceiling ? ceiling.GetComponentsInChildren<MeshRenderer>().Where(r => r.name.StartsWith("Ceiling Slab")).ToArray() : new MeshRenderer[0];
            // 穴顶面片（单位立方体缩放）在穴顶高度盖住 q：真实投影会挡住
            bool SlabCovers(Vector3 q) => slabs.Any(r =>
            {
                var l = r.transform.InverseTransformPoint(new Vector3(q.x, r.transform.position.y, q.z));
                return Mathf.Abs(l.x) <= 0.5f && Mathf.Abs(l.z) <= 0.5f;
            });
            int mismatch = 0;
            string firstMismatch = null;
            bool Lit(Vector2 q)
            {
                var p = set.OnGround(q.x, q.y, 1.2f);
                bool open = SunShaft.SkyOpen(shafts, p, toSun, out float dist);
                // 声明和真几何要一致：判定说开着的，射线在穴顶高度不能落在面片上；判定说挡着的，那里得真有面片（否则真实光照会漏进来）
                if (shaft && toSun.y > 0.02f && p.y < shaft.CeilingY)
                {
                    var cross = p + toSun * ((shaft.CeilingY - p.y) / toSun.y);
                    bool covered = SlabCovers(cross);
                    if (covered == open)
                    {
                        mismatch++;
                        firstMismatch ??= $"{q}：判定{(open ? "开" : "挡")}、面片{(covered ? "有" : "无")}（穴顶落点 {cross.x:F1}, {cross.z:F1}）";
                    }
                }
                if (!open) return false;
                return !Physics.Raycast(p, toSun, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            }
            bool litCenter = Lit(ShaftPatch), litOff = Lit(ShaftPatch + new Vector2(0, -9)), litIsland = Lit(Island);
            // 再沿穴底撒一圈点核对「声明的开口 = 穴顶面片留的洞」
            for (float x = -36; x <= 36; x += 6)
            for (float z = -32; z <= 32; z += 4)
                Lit(new Vector2(x, z));
            if (!shaft || slabs.Length == 0) rep.Fail($"没有日光裂缝标记或穴顶面片（标记 {(shaft ? 1 : 0)}、面片 {slabs.Length}）");
            else if (mismatch > 0) rep.Fail($"穴顶开口声明和面片留的洞对不上：{mismatch} 处（例 {firstMismatch}）");
            else rep.Line($"✓ 穴顶开口声明（{ApertureHalf.x * 2:F0} × {ApertureHalf.y * 2:F0} m）与面片留的洞一致（穴底 {13 * 17} 个采样点）");
            if (!litCenter) rep.Fail($"光柱落点 {ShaftPatch} 照不到太阳（裂缝 / 太阳方向没对上）");
            if (litOff || litIsland) rep.Fail($"缝外也照得到太阳（落点南 9 m {litOff}、岩岛 {litIsland}）——穴顶开口声明比实际大？");
            if (litCenter && !litOff && !litIsland) rep.Line($"✓ 日光只从裂缝进来：落点 {ShaftPatch} 进光，缝外与岩岛在影子里（太阳俯角 {SunPitch}°、方位 {SunYaw}°，裂缝中心 {Aperture}）");
            int litWater = waters.Count(w => w && Lit(new Vector2(w.transform.position.x, w.transform.position.z)));
            rep.Line($"浅水 {waters.Count} 段（水深 {WaterDepth} m），其中 {litWater} 段落在光柱里（踩水减灼烧）");
            if (waters.Count < 6) rep.Fail($"浅水只有 {waters.Count} 段（泉床南半圈应有一圈）");
            if (!shaft) rep.Fail("没有日光裂缝标记（SunShaft）");

            rep.Section("月牙阁 / 起步台");
            if (!pavilion) rep.Fail("月牙阁没有摆出来");
            else rep.Line($"{(pavilion.tag == LevelKit.PlaceholderTag ? "⚠ 白盒" : "✓ 正式件")} 月牙阁 {pavilion.name} × {pavilion.transform.localScale.x:F1}，二层台设计 {PavilionTerrace} m");
            if (!start) rep.Fail("岩台上没有起步安全区");
            else rep.Line($"✓ 起步台安全区 {start.radius} m，不开店（补给营在 1-3 寺院塔院）");
        }

        /// <summary>L1 规则（同 1-1）：关卡场景只有环境和标记，没有玩家 / 相机 / HUD / 会话 / 敌人目录；顺带重新生成 GameDatabase</summary>
        static void CheckSceneContents(LevelKit.Report rep, UnityEngine.SceneManagement.Scene scene)
        {
            rep.Line("— 场景内容（L1：只有环境和标记，玩家在 Core 场景）—");
            int Count<T>() where T : Component =>
                Object.FindObjectsByType<T>(FindObjectsInactive.Include).Count(c => c.gameObject.scene == scene);
            int spawns = Count<PlayerSpawn>(), boots = Count<LevelBootstrap>(), arenas = Count<BossArena>(), encounters = Count<BossEncounter>(),
                camps = Count<SupplyCamp>(), zones = Count<SafeZone>(), portals = Count<ExitPortal>();
            if (spawns != 1) rep.Fail($"PlayerSpawn 有 {spawns} 个（应为 1）");
            if (boots != 1) rep.Fail($"LevelBootstrap 有 {boots} 个（应为 1）");
            if (arenas != 1 || encounters != 1 || zones != 1) rep.Fail($"BossArena {arenas} / BossEncounter {encounters} / SafeZone {zones}（各应为 1）");
            // 补给营在 1-3 结尾（寺院塔院）：1-4 不再摆店，免得连着两家
            if (camps != 0) rep.Fail($"场景里有 {camps} 个 SupplyCamp（1-4 起步台不开店，补给营在 1-3）");
            // 场景里不放 ExitPortal：没有目标的出口开局就会自己开着，首领关的出口由 BossEncounter 打完后立
            if (portals != 0) rep.Fail($"场景里有 {portals} 个 ExitPortal（首领关的出口由 BossEncounter 结算后立）");
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
            if (spawns == 1 && boots == 1) rep.Line("✓ PlayerSpawn ×1、LevelBootstrap ×1、BossArena / BossEncounter / 起步台 SafeZone 各 1、没有 SupplyCamp，没有玩家 / 相机 / HUD / 会话");
            CoreSceneBuilder.BuildDatabase(rep);
        }

        /// <summary>
        /// 交给 L5 规则集的声明：主线 出生 → 起步台 → 下行坡 → 入场点 → 岩岛顶 → 泉床 → 月牙阁前 → 首领出生点；坡度（下行坡、岩岛坡道）；
        /// 地标视线（眺台看月牙阁、坡脚看岩岛、入场点看光柱与首领出生点）；场地：起步台（缓冲）、月牙泉擂台（≥ 3 处掩体、两层以上、要有坡道上得去的俯射层）；
        /// 召唤点当刷怪锚点查净空 / 有路（跳鼠刀兵、蝎尾弩卫）。可玩区遮罩 = 碗底 + 岩台 + 坡槽，穴壁 60–70° 爬不上去，没有空气墙（escapeMargin 3 m）
        /// </summary>
        static LevelSpec Spec(Terrain terrain)
        {
            Vector3 G(Vector2 q, float dy = 0) => LevelKit.OnGround(terrain, q.x, q.y, dy);
            var summonEnemies = new[] { "jerboa_blade", "scorpion_archer" };
            var spec = new LevelSpec
                {
                    id = "1-4", title = "干涸月牙泉", playerSpawn = G(PlayerSpawnAt), bounds = new Rect(Origin, Size),
                    playable = Playable, escapeMargin = 3f,
                    slopePaths =
                    {
                        new SlopePath { name = "下行坡", points = RampPath.points },
                        new SlopePath { name = "岩岛坡道", points = new[] { IslandRampFoot + (IslandRampFoot - IslandRampTop).normalized * 1.5f, IslandRampTop } },
                    },
                    sites =
                    {
                        new SiteSpec { name = "月牙泉入口岩台（缓冲）", center = G(CampAt), size = 22, combat = false },
                        new SiteSpec { name = "干涸月牙泉（首领场）", center = G(Bowl), size = 70, minCover = 3, minLayers = 2, overlook = true },
                    },
                }
                .Route("出生 · 岩台", G(PlayerSpawnAt)).Route("起步台", G(CampAt)).Route("下行坡顶", G(RampCtrl[0]))
                .Route("下行坡弯", G(RampCtrl[2])).Route("坡脚", G(RampCtrl[^1])).Route("入场点", G(PlayerEntry))
                .Route("岩岛顶", G(Island)).Route("泉床", G(Spring + new Vector2(-6, -12))).Route("月牙阁前", G(Pavilion + new Vector2(0, 6)))
                .Route("首领出生点", G(BossSpawn))
                .Sight("眺台 → 月牙阁", G(Balcony, 1.62f), G(Pavilion, PavilionTerrace + 1f), 7, PavilionId)
                .Sight("坡脚 → 岩岛", G(RampCtrl[^1], 1.62f), G(Island, IslandHeight + 0.5f), 6)
                .Sight("入场点 → 光柱落点", G(PlayerEntry, 1.62f), G(ShaftPatch, 0.5f), 5)
                .Sight("入场点 → 首领出生点", G(PlayerEntry, 1.62f), G(BossSpawn, 6f), 6);
            for (int i = 0; i < SummonPoints.Length; i++)
                spec.anchors.Add(new AnchorSpec { name = $"Summon_{i + 1}（沙魇召唤点）", pos = G(SummonPoints[i]), enemies = summonEnemies });
            return spec;
        }
    }
}
