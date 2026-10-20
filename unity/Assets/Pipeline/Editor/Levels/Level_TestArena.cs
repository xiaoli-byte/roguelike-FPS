using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using Spiritfire.Game.Testing;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.Rendering;
using static Spiritfire.Art.Editor.Levels.Landform;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 测试场 TestArena（docs/unity-parity.md 4.9）：敌人、武器、首领、手感单元不等地图，先在这里验收。
    /// 关卡坐标 = 世界 XZ（米），平地 120 × 120 m（世界 y = 0），外圈一道 9 m 高的陡坡围堤当软边界（走不上去，没有空气墙）。
    ///
    ///   出生点 (0, −44) 面朝 +Z；左前方武器架（全部已登记的武器）；正前方 18 m 刷怪台 (0, −26)，<see cref="ArenaSpawner"/> 挂在台上
    ///   西侧坡度测试：15° / 30° / 45° 三条坡道上同一个 3 m 台面
    ///   东侧三座高台 2.5 / 4 / 6 m，南面各一条 20° 坡道
    ///   西北三根栖落柱 5 / 8 / 11 m（柱顶有 PerchPoint 标记）
    ///   北侧熔岩 / 冰面 / 水面占位条带（带 Lava / Ice / Water 标签的色块，地表系统落地后换成正式组件）
    ///   地面每 10 m 一条浅色网格线（量距离、看截图用，没有碰撞）
    ///
    /// 玩家、系统、敌人目录与 1-1 相同（PlayerRigBuilder + 燎）；没有遭遇战和出口，敌人全靠刷怪台按需生成。
    /// 生成：Spiritfire ▸ Levels ▸ Build Test Arena，或 bridge.sh level arena。冒烟套件 Testing/Suites/ArenaSuite.cs（bridge.sh playtest arena）。
    /// </summary>
    [LevelBuilder("arena", ScenePath)]
    public static class Level_TestArena
    {
        public const string Dir = "Assets/Levels/TestArena";
        public const string ScenePath = "Assets/Scenes/TestArena.unity";
        const string Name = "TestArena";

        /// <summary>平地半宽（米）</summary>
        const float Half = 60f;
        /// <summary>高度场里 Base 米 = 世界 y 0</summary>
        const float Base = 2f;
        const float BermHeight = 9f, BermStart = 61f, BermEnd = 69f;
        static readonly Vector2 Origin = new(-76, -76), Size = new(152, 152);

        // ── 场地件 ──
        static readonly Vector2 Spawn = new(0, -44), Pad = new(0, -26), Rack = new(-9, -36);
        const float PadRadius = 3.5f;
        /// <summary>坡度测试：台面（中心、尺寸、高度），坡道沿 +Z 上到台面南沿</summary>
        static readonly Vector2 DeckCenter = new(-36, -8), DeckSize = new(22, 8);
        const float DeckHeight = 3f;
        static readonly (float x, float angle)[] Slopes = { (-44, 15), (-36, 30), (-28, 45) };
        /// <summary>高台（中心、高度）：8 × 8 m，南面一条 20° 坡道</summary>
        static readonly (Vector2 c, float h)[] Platforms = { (new Vector2(22, -4), 2.5f), (new Vector2(34, -4), 4f), (new Vector2(46, -4), 6f) };
        const float PlatformSize = 8f, PlatformRampAngle = 20f, RampWidth = 3.5f;
        /// <summary>栖落柱（中心、高度、半径）</summary>
        static readonly (Vector2 c, float h, float r)[] Perches = { (new Vector2(-20, 18), 5f, 1.2f), (new Vector2(-31, 27), 8f, 1.2f), (new Vector2(-44, 16), 11f, 1.4f) };
        /// <summary>占位条带（标签、中心 z）：沿 X 24 m 长、6 m 宽</summary>
        static readonly (string tag, string title, float z)[] Strips = { ("Lava", "熔岩", 24), ("Ice", "冰面", 34), ("Water", "水面", 44) };
        const float StripLength = 24f, StripWidth = 6f, StripHeight = 0.06f;

        // ───────────── 地貌 ─────────────
        /// <summary>平地 + 外圈围堤（平地外 1 m 起 8 m 内升 9 m，最陡处约 59°，玩家和 NavMesh 都上不去）</summary>
        static LevelKit.Sample Eval(Vector2 p)
        {
            float edge = Mathf.Max(Mathf.Abs(p.x), Mathf.Abs(p.y));
            float berm = Smooth(BermStart, BermEnd, edge);
            return new LevelKit.Sample { h = Base + BermHeight * berm, packed = 1 - berm, sand = berm };
        }

        // ───────────── 构建 ─────────────
        [MenuItem("Spiritfire/Levels/Build Test Arena", priority = 80)]
        public static void BuildMenu() => Build(true);

        public static void BatchBuild()
        {
            int fails = Build(true);
            EditorApplication.Exit(fails > 0 ? 1 : 0);
        }

        /// <summary>生成场景 → 烘焙 NavMesh → 验收检查（报告 Assets/Art/_Review/level_arena_report.txt）→ 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            var theme = ShowcaseTheme.Desert;
            ShowcaseSceneBuilder.ConfigureProject();
            foreach (var (tag, _, _) in Strips) EnsureTag(tag);
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var env = new GameObject("Environment").transform;
            var wb = new GameObject("Whitebox").transform;
            var markers = new GameObject("Markers").transform;

            ShowcaseSceneBuilder.BuildLighting(theme, Dir);
            LevelKit.BuildTerrain(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = 16, heightRes = 513, splatRes = 512,
                layers = TerrainTextureGen.Desert(), eval = Eval, shadowTint = theme.groundShadowTint,
            }, env, out _);
            var m = new Materials();
            BuildGrid(wb, m);

            var spawner = new GameObject("Arena Spawner").AddComponent<ArenaSpawner>();
            spawner.transform.SetPositionAndRotation(G(Pad), Quaternion.LookRotation(Flat(Spawn - Pad)));
            spawner.radius = PadRadius;
            BuildPad(spawner.transform, m);
            spawner.playerSpawn = Marker(markers, "PlayerSpawn", G(Spawn));
            Marker(markers, "SpawnAnchor_Pad", G(Pad));

            BuildSlopeTest(wb, m, spawner);
            BuildPlatforms(wb, m, spawner);
            BuildPerches(wb, markers, m, spawner);
            BuildStrips(wb, m, spawner);

            // 可玩玩家：燎（第一人称 rig、血量护盾、全部武器的 rig、HUD、会话、掉落）
            var player = PlayerRigBuilder.Build(theme, PlayerRigBuilder.Liao, G(Spawn, 0.05f), Quaternion.LookRotation(Flat(Pad - Spawn)), "测试场", out var cam);
            var fpRig = player.GetComponentInChildren<FirstPersonViewmodel>(true).gameObject;
            BuildEnemyCatalog();
            // 武器架：全部已登记的武器，按 F 换着试
            var rack = new GameObject("Weapon Rack").AddComponent<WeaponRack>();
            rack.weapons = WeaponLibrary.All.Select(d => d.id).ToArray();
            rack.spacing = 1.4f;
            rack.transform.SetPositionAndRotation(G(Rack), Quaternion.LookRotation(Flat(Spawn - Rack)));
            spawner.weaponRack = rack.transform;

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);

            var rep = Validate(rack);
            rep.Save($"{LevelKit.ReviewDir}/level_arena_report.txt");

            if (review)
            {
                LevelKit.Capture(cam, fpRig, "level_arena", new[]
                {
                    ("Aerial", new Vector3(0, 70, -95), new Vector3(0, 0, -5), false),
                    ("Map", new Vector3(0, 190, 0.5f), Vector3.zero, false),
                    ("Spawn", G(Spawn, 1.62f), G(Pad, 1f), true),
                    ("Platforms", G(new Vector2(14, -30), 1.62f), G(new Vector2(34, -4), 3f), false),
                    ("SlopeTest", G(new Vector2(-24, -34), 1.62f), G(DeckCenter, 1.5f), false),
                    ("Perches", G(new Vector2(-14, 2), 1.62f), G(new Vector2(-32, 20), 6f), false),
                    ("Strips", G(new Vector2(0, 8), 2.2f), G(new Vector2(0, 36), 0), false),
                });
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        /// <summary>验收：台面实际高度、武器架与敌人目录、后处理 profile 存盘，再跑 L5 规则集（主线连通 出生点 → 刷怪台 → 坡度台面 → 三座台顶、锚点、越界…，见 <see cref="Spec"/>）</summary>
        static LevelKit.Report Validate(WeaponRack rack)
        {
            var rep = new LevelKit.Report();
            rep.Line("测试场 TestArena · 白盒验收");
            Physics.SyncTransforms();

            rep.Line("— 台面高度（自上而下射线）—");
            void Height(string what, Vector2 at, float expect)
            {
                if (!Physics.Raycast(G(at, expect + 20), Vector3.down, out var hit, 40, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    rep.Fail($"{what}：射线没打到东西");
                else if (Mathf.Abs(hit.point.y - expect) > 0.05f) rep.Fail($"{what}：台面 y = {hit.point.y:F2}，应为 {expect:F2}（打到 {hit.collider.name}）");
                else rep.Line($"✓ {what}：y = {hit.point.y:F2}");
            }
            Height("坡度台面", DeckCenter, DeckHeight);
            foreach (var (c, h) in Platforms) Height($"{h} m 高台", c, h);
            foreach (var (c, h, _) in Perches) Height($"{h} m 栖落柱", c, h);
            Height("平地", Vector2.zero, 0);
            Height("刷怪台", Pad, 0);

            rep.Line("— 内容 —");
            rep.Line($"武器架：{rack.weapons.Length} 把（{string.Join("、", rack.weapons)}）");
            if (rack.weapons.Length != WeaponLibrary.All.Count) rep.Fail($"武器架 {rack.weapons.Length} 把，注册表里有 {WeaponLibrary.All.Count} 把");
            var catalog = Object.FindAnyObjectByType<EnemyCatalog>();
            var missing = EnemyRoster.All.Where(d => !catalog || !catalog.prefabs.Any(p => p && p.name == d.prefab)).Select(d => d.id).ToList();
            rep.Line($"敌人目录：{(catalog ? catalog.prefabs.Length : 0)} 个 Prefab；名册 {EnemyRoster.All.Count} 种" +
                     (missing.Count > 0 ? $"，缺 Prefab（运行时用占位体）：{string.Join("、", missing)}" : "，都有 Prefab"));

            // P0 缺陷回归（docs/unity-parity.md 3.0）：后处理 profile 的组件要真的存进资产
            string vp = $"{Dir}/VP_{ShowcaseTheme.Desert.key}.asset";
            int comps = AssetDatabase.LoadAllAssetsAtPath(vp).OfType<VolumeComponent>().Count();
            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(vp);
            if (!profile || profile.components.Count == 0) rep.Fail($"{vp} 没有后处理组件");
            else if (comps != profile.components.Count) rep.Fail($"{vp}：profile 有 {profile.components.Count} 个组件，资产里只存下 {comps} 个（重开工程会丢）");
            else rep.Line($"✓ 后处理 profile：{comps} 个组件已存为子资产（{string.Join("、", profile.components.Select(c => c.GetType().Name))}）");
            LevelValidator.Run(Spec(), rep);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            return rep;
        }

        /// <summary>
        /// 交给验收规则集的声明：可玩区 = 围堤脚以内；刷怪台锚点按名册里最大的体型查净空；占位条带只列清单（Warn）。
        /// 东侧高台区当已知几何的回归样本：三座台都有 20° 坡道 → 俯射层不靠二段跳可达，台子侧壁算掩体。
        /// </summary>
        static LevelSpec Spec()
        {
            var spec = new LevelSpec
            {
                id = "arena", title = "测试场", playerSpawn = G(Spawn), bounds = new Rect(Origin, Size),
                playable = p => Mathf.Max(Mathf.Abs(p.x), Mathf.Abs(p.y)) <= BermStart ? 1 : 0,
                anchors = { new AnchorSpec { name = "SpawnAnchor_Pad（刷怪台）", pos = G(Pad) } },
                sites = { new SiteSpec { name = "东侧高台区", center = G(new Vector2(34, -10)), size = 40, minCover = 2, minLayers = 2, overlook = true } },
                placeholders = PlaceholderPolicy.Warn,
            };
            spec.Route("出生点", G(Spawn)).Route("刷怪台", G(Pad)).Route("坡度台面", G(DeckCenter, DeckHeight));
            foreach (var (c, h) in Platforms) spec.Route($"{h} m 台顶", G(c, h));
            return spec;
        }

        sealed class Materials
        {
            public readonly Material floor = LevelKit.Mat(Dir, "ArenaBlock", new Color(0.72f, 0.7f, 0.66f));
            public readonly Material accent = LevelKit.Mat(Dir, "ArenaAccent", new Color(0.55f, 0.6f, 0.68f));
            public readonly Material ramp = LevelKit.Mat(Dir, "ArenaRamp", new Color(0.8f, 0.74f, 0.6f));
            public readonly Material grid = LevelKit.Mat(Dir, "ArenaGrid", new Color(0.42f, 0.36f, 0.3f));
            public readonly Material pad = LevelKit.Mat(Dir, "ArenaPad", new Color(0.78f, 0.24f, 0.18f));
            public readonly Material pillar = LevelKit.Mat(Dir, "ArenaPillar", new Color(0.62f, 0.5f, 0.42f));
        }

        static Vector3 G(Vector2 p, float dy = 0) => new(p.x, dy, p.y);
        static Vector3 Flat(Vector2 d) => new(d.x, 0, d.y);

        static Transform Marker(Transform root, string name, Vector3 pos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.position = pos;
            return go.transform;
        }

        // ───────────── 场地件 ─────────────
        /// <summary>地面网格线：每 10 m 一条，贴地 3 cm，没有碰撞</summary>
        static void BuildGrid(Transform wb, Materials m)
        {
            var root = new GameObject("Grid").transform;
            root.SetParent(wb, false);
            for (float v = -Half; v <= Half + 0.01f; v += 10)
            {
                float w = Mathf.Approximately(v, 0) ? 0.16f : 0.07f;
                foreach (bool alongX in new[] { true, false })
                {
                    var size = alongX ? new Vector3(Half * 2, 0.03f, w) : new Vector3(w, 0.03f, Half * 2);
                    var go = LevelKit.Box(alongX ? $"Grid Z{v:0}" : $"Grid X{v:0}", root, alongX ? new Vector3(0, 0, v) : new Vector3(v, 0, 0), size, 0, m.grid, 0);
                    Object.DestroyImmediate(go.GetComponent<Collider>());
                    go.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
                }
            }
        }

        /// <summary>刷怪台：贴地的红色圆盘（没有碰撞，敌人站在地面上）</summary>
        static void BuildPad(Transform spawner, Materials m)
        {
            var disc = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            disc.name = "Spawn Pad";
            disc.transform.SetParent(spawner, false);
            disc.transform.localPosition = new Vector3(0, 0.02f, 0);
            disc.transform.localScale = new Vector3(PadRadius * 2, 0.02f, PadRadius * 2);
            disc.GetComponent<MeshRenderer>().sharedMaterial = m.pad;
            disc.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
            Object.DestroyImmediate(disc.GetComponent<Collider>());
            disc.isStatic = true;
        }

        /// <summary>
        /// 坡道：一块斜放的板，顶面从 foot（地面）直线升到 top（高 h），厚 0.6 m。两端的端面垂直于坡面：
        /// 坡顶的下角落在台子里面、坡脚的下角埋进地下，所以两头都没有缝也没有台阶。
        /// </summary>
        static GameObject RampBlock(string name, Transform parent, Vector2 foot, Vector2 top, float h, float width, Material mat)
        {
            const float thick = 0.6f;
            var a = G(foot);
            var b = G(top, h);
            var along = (b - a).normalized;
            var normal = Vector3.Cross(along, Vector3.Cross(Vector3.up, along)).normalized;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation((a + b) * 0.5f - normal * thick * 0.5f, Quaternion.LookRotation(along, normal));
            go.transform.localScale = new Vector3(width, thick, Vector3.Distance(a, b));
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            go.isStatic = true;
            return go;
        }

        static void BuildSlopeTest(Transform wb, Materials m, ArenaSpawner spawner)
        {
            var root = new GameObject("Slope Test").transform;
            root.SetParent(wb, false);
            var deck = LevelKit.Box("Slope Deck 3m", root, G(DeckCenter), new Vector3(DeckSize.x, DeckHeight, DeckSize.y), 0, m.floor, 0);
            spawner.slopeDeck = deck.transform;
            float south = DeckCenter.y - DeckSize.y * 0.5f;
            var slopes = new List<Transform>();
            foreach (var (x, angle) in Slopes)
            {
                float run = DeckHeight / Mathf.Tan(angle * Mathf.Deg2Rad);
                var ramp = RampBlock($"Slope {angle:0}°", root, new Vector2(x, south - run), new Vector2(x, south), DeckHeight, 4f, m.ramp);
                slopes.Add(ramp.transform);
            }
            spawner.slopes = slopes.ToArray();
            spawner.slopeAngles = Slopes.Select(s => s.angle).ToArray();
        }

        static void BuildPlatforms(Transform wb, Materials m, ArenaSpawner spawner)
        {
            var root = new GameObject("Platforms").transform;
            root.SetParent(wb, false);
            var list = new List<Transform>();
            foreach (var (c, h) in Platforms)
            {
                var block = LevelKit.Box($"Platform {h}m", root, G(c), new Vector3(PlatformSize, h, PlatformSize), 0, m.floor, 0);
                list.Add(block.transform);
                float south = c.y - PlatformSize * 0.5f;
                float run = h / Mathf.Tan(PlatformRampAngle * Mathf.Deg2Rad);
                RampBlock($"Platform {h}m Ramp", root, new Vector2(c.x, south - run), new Vector2(c.x, south), h, RampWidth, m.ramp);
            }
            spawner.platforms = list.ToArray();
            spawner.platformHeights = Platforms.Select(p => p.h).ToArray();
        }

        /// <summary>栖落柱：圆柱 + 网格碰撞（顶面是平的，胶囊碰撞的圆顶站不住），柱顶一个 PerchPoint 标记</summary>
        static void BuildPerches(Transform wb, Transform markers, Materials m, ArenaSpawner spawner)
        {
            var root = new GameObject("Perch Pillars").transform;
            root.SetParent(wb, false);
            var tops = new List<Transform>();
            for (int i = 0; i < Perches.Length; i++)
            {
                var (c, h, r) = Perches[i];
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                go.name = $"Perch Pillar {h}m";
                go.transform.SetParent(root, false);
                go.transform.position = G(c, h * 0.5f);
                go.transform.localScale = new Vector3(r * 2, h * 0.5f, r * 2);
                go.GetComponent<MeshRenderer>().sharedMaterial = m.pillar;
                Object.DestroyImmediate(go.GetComponent<Collider>());
                go.AddComponent<MeshCollider>().sharedMesh = go.GetComponent<MeshFilter>().sharedMesh;
                go.isStatic = true;
                tops.Add(Marker(markers, $"PerchPoint_{i + 1}", G(c, h)));
            }
            spawner.perches = tops.ToArray();
        }

        /// <summary>占位条带：带标签的色块（顶面高 6 cm，有碰撞，往下的射线能读到标签）</summary>
        static void BuildStrips(Transform wb, Materials m, ArenaSpawner spawner)
        {
            var root = new GameObject("Surface Strips (placeholder)").transform;
            root.SetParent(wb, false);
            foreach (var (tag, title, z) in Strips)
            {
                var mat = tag switch
                {
                    "Lava" => Glow(LevelKit.Mat(Dir, "LavaPlaceholder", new Color(0.95f, 0.36f, 0.1f)), new Color(2.6f, 0.85f, 0.2f)),
                    "Ice" => LevelKit.Mat(Dir, "IcePlaceholder", new Color(0.72f, 0.88f, 1f), 0.15f),
                    _ => LevelKit.Mat(Dir, "WaterPlaceholder", new Color(0.16f, 0.42f, 0.74f), 0.1f),
                };
                var go = LevelKit.Box($"{tag} Strip · {title}（占位）", root, new Vector3(0, 0, z), new Vector3(StripLength, StripHeight, StripWidth), 0, mat, 0);
                go.tag = tag;
                go.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
                if (tag == "Lava") spawner.lavaStrip = go.transform;
                else if (tag == "Ice") spawner.iceStrip = go.transform;
                else spawner.waterStrip = go.transform;
            }
        }

        static Material Glow(Material mat, Color emission)
        {
            mat.SetColor("_EmissionColor", emission);
            mat.EnableKeyword("_EMISSION");
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>场景里的敌人 Prefab 与挂件目录（运行时拿不到 AssetDatabase）：名册里每种敌人的 Prefab 都放进来，缺的运行时用占位体</summary>
        static void BuildEnemyCatalog()
        {
            var catalog = new GameObject("Enemy Catalog").AddComponent<EnemyCatalog>();
            var prefabs = new List<GameObject>();
            foreach (var def in EnemyRoster.All)
            {
                var prefab = ShowcaseSceneBuilder.Prefab(def.prefab);
                if (!prefab) Debug.LogWarning($"[Arena] 缺少敌人 Prefab {def.prefab}（{def.id} 运行时用占位体）");
                else if (!prefabs.Contains(prefab)) prefabs.Add(prefab);
            }
            catalog.prefabs = prefabs.ToArray();
            catalog.attachments = AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/Art/Prefabs/Attachments" })
                .Select(g => AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(g)))
                .Where(g => g && g.GetComponent<ArtAssetInfo>() && !string.IsNullOrEmpty(g.GetComponent<ArtAssetInfo>().bindAttachment))
                .ToArray();
        }

        /// <summary>没有就往 TagManager 里加一个标签（占位条带用；改的是 ProjectSettings/TagManager.asset，生成后要一起提交）</summary>
        static void EnsureTag(string tag)
        {
            if (System.Array.IndexOf(InternalEditorUtility.tags, tag) < 0) InternalEditorUtility.AddTag(tag);
        }
    }
}
