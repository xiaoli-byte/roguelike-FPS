using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // 3-3 构建流程、摆放工具、熔岩、熔瀑、桥（布局常数与地形见 Level_3_3.cs）
    public static partial class Level_3_3
    {
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
            ConfigureFireGodSky();
            // 火山口壁 24 m：主题默认的低角度太阳会把半个铸坊压在壁影里，抬到 52°
            if (RenderSettings.sun) RenderSettings.sun.transform.rotation = Quaternion.Euler(52, 35, 0);
            var set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
            {
                dir = Dir, name = Name, size = Size, origin = Origin, baseHeight = Base, heightRange = HeightRange,
                ground = LevelKit.Ground.Inferno, eval = Eval,
            }, env);

            // 三层锯齿岩峰渐隐在暗紫烟雾里；远景地面用本关暗色，不改章节主题
            var backdrop = LevelKit.BackdropFor(theme, Dir, Name, new Vector2(100, 107), FarY - 0.5f, 760, 5);
            ConfigureFireGodBackdrop(backdrop);
            LevelKit.Backdrop(backdrop, env);
            LevelKit.FarGround(Dir, Name, env, new Rect(Origin, Size), FarY - 0.05f, new Color(0.11f, 0.08f, 0.12f));

            // 软边界（没有空气墙）：火山口壁本身翻不上去，等值线外热风推回 + 兜底环
            LevelKit.Boundary(Dir, Name, env, Playable, new Rect(Origin, Size), Bounds);
            LevelKit.Weather(env, theme, Wind, 0.2f);

            var lava = BuildLava(env);
            var decks = BuildBridges(arch);
            BuildCascades(env);
            BuildGate(set, arch, props);
            BuildFanYard(set, arch, props, markers);
            BuildRoadside(set, props, markers);
            BuildLadleYard(set, arch, props);
            BuildMidTerrace(set, props);
            var hall = BuildHall(set, arch, props, markers);
            BuildForecourt(set, arch, props, markers);
            BuildScrapNiche(set, props);
            BuildSluiceHead(arch, props);
            var arenaProps = BuildArenaProps(set, arch, props);
            var throne = BuildFireGodThrone(set, arch);
            BuildFoundryDirection(set, arch);
            BuildScatter(set, env);
            BuildMarkers(set, markers);

            // 玩家在 Core 场景（L1）：这里只放出生标记 + 自举标记。出生朝北略偏东：正对熔铜瀑，王座在右上方
            var spawnAt = set.OnGround(Spawn.x, Spawn.y, 0.05f);
            var spawnRot = Quaternion.LookRotation(new Vector3(0.12f, 0, 1f));
            var playerSpawn = new GameObject("PlayerSpawn").AddComponent<PlayerSpawn>();
            playerSpawn.transform.SetParent(markers, false);
            playerSpawn.transform.SetPositionAndRotation(spawnAt, spawnRot);
            new GameObject("Level Bootstrap").AddComponent<LevelBootstrap>();

            var sites = BuildEncounters(set, markers);
            var gate = BuildWindGate(set, markers, props, sites, hall, lava.tides);
            BuildCaches(set, markers, sites);
            var sluices = BuildSluices(props);
            var lord = BuildLord(set, markers, sites.objective, arenaProps, lava.surge);
            throne.GetComponent<FireGodThrone>().channels = lord.channels;

            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(theme, Dir);
            LevelKit.BakeNavMesh(Dir, Name, env);
            LevelKit.BakeLavaNavMesh(Dir, Name, env);
            EditorSceneManager.SaveScene(scene, ScenePath);
            LevelBuilders.SyncBuildSettings();

            var rep = new LevelKit.Report();
            rep.Line("3-3 铸范大坊 · 铸范梯坊与火神王座 · 验收");
            CheckGeometry(rep, set, lava, decks, hall, gate, lord, sluices);
            CheckFireGodThrone(rep, throne);
            var spec = Spec(set);
            LevelValidator.Run(spec, rep); // 主线、坡度、视线 + L5 规则集，见 Level_3_3.Checks.cs 的 Spec
            LevelKit.ValidateLava(rep);
            CheckSceneContents(rep, scene, sites, gate, lord, sluices);
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/level_3-3_report.txt");

            if (review) Capture(set, spawnAt, spawnRot);
            EditorSceneManager.SaveScene(scene, ScenePath);
            return rep.failures;
        }

        // ───────────── 摆放 ─────────────

        /// <summary>按 id 摆到地形上（底面往下埋 sink × scale）；缺 Prefab 时放 size × scale 的占位白盒（验收会列出来）</summary>
        static GameObject Put(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, float scale = 1, float sink = 0.15f, Vector3? size = null, float dy = 0)
        {
            var basePos = set.OnGround(at.x, at.y, dy - sink * scale);
            var sz = (size ?? new Vector3(3, 3, 3)) * scale;
            var go = FitIds.Contains(id) ? PlaceFit(id, parent, basePos, yaw, sz) : LevelKit.PlaceOrBox(id, parent, basePos, sz, yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        /// <summary>按设计占地非等比缩放的第三章件（ch3-kit 第 1 节：铸范 X ×1.37 Z ×1.76、铸床 X ×1.5 Z ×2.4、闸板按门洞宽、工棚）</summary>
        static readonly HashSet<string> FitIds = new() { MouldId, BedId, GateId };

        /// <summary>
        /// 摆一件第三章件：有 Prefab 时按设计包围盒把它非等比缩放到 size（底面中心 = baseCenter，父节点要在原点：Place 按父节点本地坐标）；
        /// 没有时放 size 的白盒（同 PlaceOrBox）
        /// </summary>
        static GameObject PlaceFit(string id, Transform parent, Vector3 baseCenter, float yaw, Vector3 size)
        {
            if (!ShowcaseSceneBuilder.Prefab(id)) return LevelKit.PlaceOrBox(id, parent, baseCenter, size, yaw);
            var go = ShowcaseSceneBuilder.Place(id, parent, baseCenter, yaw, 1f);
            if (!go) return null;
            var b = ShowcaseSceneBuilder.DesignBounds(id);
            go.transform.localScale = new Vector3(size.x / Mathf.Max(0.1f, b.size.x), size.y / Mathf.Max(0.1f, b.size.y), size.z / Mathf.Max(0.1f, b.size.z));
            go.isStatic = true;
            return go;
        }

        /// <summary>程序铁板（吊车 / 吊梁的走道：正式吊车件的横梁只有 1.75 m 宽，走道由构建器补，ch3-kit 第 2 节）：暗铁 + 两侧 1.1 m 栏杆（不挡头尾）</summary>
        static GameObject IronDeck(string name, Transform parent, Vector3 baseCenter, Vector3 size, float yaw, bool rails = true)
        {
            var iron = LevelKit.Mat(Dir, "FoundryIronDeck", new Color(0.16f, 0.13f, 0.13f), 0.8f);
            var go = LevelKit.Box(name, parent, baseCenter, size, yaw, iron, 0.1f);
            if (!rails) return go;
            var rot = Quaternion.Euler(0, yaw, 0);
            bool longX = size.x >= size.z;
            foreach (float side in new[] { -1f, 1f })
            {
                var off = longX ? new Vector3(0, 0, side * (size.z * 0.5f - 0.1f)) : new Vector3(side * (size.x * 0.5f - 0.1f), 0, 0);
                var railSize = longX ? new Vector3(size.x, 1.1f, 0.15f) : new Vector3(0.15f, 1.1f, size.z);
                LevelKit.Box($"{name} · 栏杆", go.transform.parent, baseCenter + rot * off + Vector3.up * (size.y - 0.05f), railSize, yaw, iron, 0f);
            }
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
                if (r) r.sharedMaterial = PlaceholderMat;
            }
            else if (go) go.name = $"{go.name} · {what}";
        }

        static Material PlaceholderMat => LevelKit.Mat(Dir, "Ch3Placeholder", new Color(0.36f, 0.3f, 0.27f), 0.85f);

        static GameObject PutLabeled(string id, Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw, Vector3 size, string what, float scale = 1, float sink = 0.15f)
        {
            var go = Put(id, parent, set, at, yaw, scale, sink, size);
            Label(go, id, what);
            return go;
        }

        static bool IsPlaceholder(GameObject go) => go && go.CompareTag(LevelKit.PlaceholderTag);

        static Transform Marker(Transform parent, string name, Vector3 pos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            return go.transform;
        }

        // ───────────── 熔岩 ─────────────

        sealed class LavaSet
        {
            /// <summary>风闸拉开后自动涨落的（主渠、横渠东段、熔铜瀑各级、瀑池、熔铜潭）</summary>
            public readonly List<LavaVolume> tides = new();
            /// <summary>领主战漫溢的（只有神范台的十字浅渠和中央熔池，风险 5）</summary>
            public readonly List<LavaVolume> surge = new();
            /// <summary>静止的（桥下、① 溢流槽、废铜池、炉前熔池）</summary>
            public readonly List<LavaVolume> still = new();
            public IEnumerable<LavaVolume> All => tides.Concat(surge).Concat(still);
        }

        static LavaTide Tide(int phase) => new() { enabled = false, height = TideHeight, lowHold = 9, warn = 1.5f, rise = 2.5f, highHold = 4, fall = 3, offset = (phase % 4) * 4.1f };

        /// <summary>
        /// 熔岩：神范台块的直渠按桥切段（同原来）；熔铜瀑同一级台面上的折线逐段一块（按桥切开，拐角处多盖一点，相邻两块错开 1.5 cm 免得面打架），
        /// 瀑口那一小段没有熔岩判定（画熔瀑）；瀑池 / 熔铜潭是圆；桥面下面另放一小段静止熔岩（桥上永远是干的）。
        ///   铸坊的渠 / 瀑：自动涨落参数写好但先关着（风闸拉开后打开），几段错开相位；
        ///   神范台的十字浅渠：盒宽 = 渠宽 + 两侧各 3 m 渠岸，平时熔岩只在渠里，魔将引动时漫上渠岸（<see cref="FoundryChannels"/> 只碰这些）；中央熔池同理
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
                    var spec = new LevelKit.LavaSpec
                    {
                        name = $"{c.name} {++n}", center = new Vector3(mid.x, c.lava, mid.y), shape = LavaShape.Box, size = new Vector2(width, s1 - s0), yaw = c.Yaw,
                        depth = c.arena ? 1f : 1.6f, depthShore = !c.arena, flow = new Vector2(0, (c.arena ? 0.25f : 0.45f) * c.flow),
                    };
                    if (!c.arena) spec.tide = Tide(phase++);
                    var v = LevelKit.PlaceLava(Dir, spec, root);
                    (c.arena ? set.surge : set.tides).Add(v);
                }
            }
            // 中央熔池（漫溢圈 10 m）
            set.surge.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "神范熔池", center = new Vector3(Basin.x, ArenaLava, Basin.y), shape = LavaShape.Disc, size = new Vector2(BasinR + BankStrip, 0), depth = 1f, depthShore = false,
            }, root));

            // 熔铜瀑：同一级台面的每一段折线一块（按桥切开），往下游流
            int alt = 0, fn = 0;
            for (int i = 0; i + 1 < Falls.Length; i++)
            {
                var (a, la) = Falls[i];
                var (b, lb) = Falls[i + 1];
                if (Mathf.Abs(la - lb) > 0.01f) continue;
                float len = Vector2.Distance(a, b);
                var dir = (b - a) / len;
                bool prevSame = i > 0 && Mathf.Abs(Falls[i - 1].level - la) < 0.01f, nextSame = i + 2 < Falls.Length && Mathf.Abs(Falls[i + 2].level - la) < 0.01f;
                float pad0 = prevSame ? FieldHalf * 0.4f : 0, pad1 = nextSame ? FieldHalf * 0.4f : 0;
                var cuts = new List<(float, float)>();
                foreach (var br in Bridges.Where(x => x.ch == null))
                {
                    float sAt = Vector2.Dot(br.center - a, dir);
                    float off = Mathf.Abs(Vector2.Dot(br.center - a, new Vector2(-dir.y, dir.x)));
                    if (off < 2f && sAt > -br.width && sAt < len + br.width) cuts.Add((sAt - br.width * 0.5f - 1f, sAt + br.width * 0.5f + 1f));
                }
                foreach (var (s0, s1) in Spans(-pad0, len + pad1, cuts))
                {
                    if (s1 - s0 < 1f) continue;
                    var mid = a + dir * ((s0 + s1) * 0.5f);
                    var v = LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                    {
                        name = $"熔铜瀑 {++fn}", center = new Vector3(mid.x, la + FieldLava + 0.015f * (alt++ % 2), mid.y), shape = LavaShape.Box,
                        size = new Vector2(FieldHalf * 2f, s1 - s0), yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg, depth = 1.6f, depthShore = true,
                        flow = new Vector2(0, 0.6f), tide = Tide(phase++),
                    }, root);
                    set.tides.Add(v);
                }
            }
            foreach (var (name, c, r, level) in Pools)
                set.tides.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = name, center = new Vector3(c.x, level + FieldLava + 0.03f, c.y), shape = LavaShape.Disc, size = new Vector2(r, 0), depth = 1.6f, depthShore = true,
                    tide = Tide(phase++),
                }, root));

            // ① 溢流槽 + 废铜池、炉前熔池：静止
            for (int i = 0; i + 1 < Spill.Length; i++)
            {
                var a = Spill[i];
                var b = Spill[i + 1];
                float len = Vector2.Distance(a, b);
                var dir = (b - a) / len;
                float pad = i > 0 ? SpillHalf * 0.4f : 0;
                var mid = a + dir * ((len - pad) * 0.5f);
                set.still.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                {
                    name = $"溢流槽 {i + 1}", center = new Vector3(mid.x, T1 + FieldLava + 0.015f * (i % 2), mid.y), shape = LavaShape.Box,
                    size = new Vector2(SpillHalf * 2f, len + pad), yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg, depth = 1.6f, depthShore = true, flow = new Vector2(0, 0.35f),
                }, root));
            }
            set.still.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "废铜池", center = new Vector3(SpillPit.x, T1 + FieldLava + 0.03f, SpillPit.y), shape = LavaShape.Disc, size = new Vector2(SpillPitR, 0), depth = 1.6f,
            }, root));
            set.still.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
            {
                name = "炉前熔池", center = new Vector3(FurnacePit.x, T2 - 0.8f, FurnacePit.y), shape = LavaShape.Disc, size = new Vector2(FurnacePitR, 0), depth = 0.9f,
            }, root));

            // 桥下的静止熔岩。铸坊 / 熔铜瀑的桥：整段垫在桥下（桥底离渠底 1.6 m，桥下的渠底也有导航网格）；
            // 神范台的浅渠桥底离渠底只有 0.25 m，桥下没有导航网格——改成桥两侧各一小段（从桥面下 0.5 m 接到涨落段的端头）
            foreach (var b in Bridges)
            {
                var axis = b.ch != null ? (b.ch.NS ? Vector2.up : Vector2.right) : new Vector2(-b.along.y, b.along.x);
                float lavaY = b.ch != null ? b.ch.lava : b.level + FieldLava + 0.03f;
                float half = b.ch?.half ?? FieldHalf;
                bool shallow = b.arena;
                var spans = shallow
                    ? new[] { (-b.width * 0.5f - 1f, -b.width * 0.5f + 0.5f, "侧"), (b.width * 0.5f - 0.5f, b.width * 0.5f + 1f, "侧") }
                    : new[] { (-b.width * 0.5f - 1f, b.width * 0.5f + 1f, "") };
                int k = 0;
                foreach (var (s0, s1, tag) in spans)
                {
                    var c = b.center + axis * ((s0 + s1) * 0.5f);
                    set.still.Add(LevelKit.PlaceLava(Dir, new LevelKit.LavaSpec
                    {
                        name = $"桥下 · {b.name}{(tag.Length > 0 ? $" {tag}{++k}" : "")}", center = new Vector3(c.x, lavaY, c.y), shape = LavaShape.Box,
                        size = new Vector2(half * 2f, s1 - s0), yaw = Mathf.Atan2(axis.x, axis.y) * Mathf.Rad2Deg,
                        depth = shallow ? 1f : 1.6f, depthShore = !shallow, flow = new Vector2(0, 0.3f),
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

        /// <summary>
        /// 熔瀑（三处瀑口）：一片沿抛物线落下去的熔岩面（只有画面，没有判定、没有碰撞），从上一级熔岩面往前 1 m 接到下一级熔岩面往后 1.5 m；
        /// 材质同王座熔岩柱的调法（「兽首熔流口」锦上添花件到货前就靠它）
        /// </summary>
        static void BuildCascades(Transform env)
        {
            var root = new GameObject("Molten Cascades · 熔铜瀑").transform;
            root.SetParent(env, false);
            var mat = new Material(LevelKit.LavaMaterial()) { name = "M_FoundryCascade" };
            mat.SetColor("_DeepColor", new Color(0.7f, 0.08f, 0.01f));
            mat.SetColor("_HotColor", new Color(1f, 0.28f, 0.02f));
            mat.SetColor("_CoreColor", new Color(1f, 0.85f, 0.5f));
            mat.SetFloat("_Emission", 2f);
            mat.SetFloat("_MoltenAmount", 0.85f);
            mat.SetFloat("_ShoreWidth", 0f);
            mat.SetFloat("_ShoreDepth", 0f);
            LevelKit.SaveAsset(mat, $"{Dir}/M_WB_FoundryCascade.mat");
            int n = 0;
            for (int i = 0; i + 1 < Falls.Length; i++)
            {
                var (a, la) = Falls[i];
                var (b, lb) = Falls[i + 1];
                if (Mathf.Abs(la - lb) < 0.01f) continue;
                var dir = (b - a).normalized;
                float top = la + FieldLava, bottom = lb + FieldLava;
                var mesh = CascadeMesh(Vector2.Distance(a, b), top - bottom, FieldHalf - 0.4f);
                var go = NewMeshObject($"熔瀑 {++n}（{la:0} → {lb:0}）", root, mesh, mat, $"{Dir}/Lava/Mesh_FoundryCascade_{n}.asset");
                go.transform.SetPositionAndRotation(new Vector3(a.x, top, a.y), Quaternion.LookRotation(new Vector3(dir.x, 0, dir.y)));
            }
        }

        /// <summary>
        /// 熔瀑网格（本地：+Z 顺流、+Y 向上，原点 = 瀑口熔岩面中心）：先平流 1 m 到瀑口，沿抛物线落下 drop 米（水平走 run 米），再平流 1.5 m 进下一级；
        /// 宽 2 × half，双面；uv 按熔岩着色器的约定（uv0 = 横向 × 沿程米、uv1 = 半宽 / 很长 / 盒 / 不按深度、uv2 = 沿 +v 流）
        /// </summary>
        static Mesh CascadeMesh(float run, float drop, float half)
        {
            var path = new List<Vector3> { new(0, 0.02f, -1f) };
            const int Steps = 10;
            for (int j = 0; j <= Steps; j++)
            {
                float t = j / (float)Steps;
                path.Add(new Vector3(0, -drop * t * t + 0.02f, run * Mathf.Sqrt(t) * 0.85f + run * 0.15f * t));
            }
            path.Add(new Vector3(0, -drop + 0.04f, run + 1.5f));
            var verts = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector4>();
            var uv2 = new List<Vector4>();
            var tris = new List<int>();
            float arc = 0;
            for (int j = 0; j < path.Count; j++)
            {
                if (j > 0) arc += Vector3.Distance(path[j - 1], path[j]);
                for (int i = 0; i <= 2; i++)
                {
                    float x = (i - 1) * half;
                    verts.Add(path[j] + new Vector3(x, 0, 0));
                    uv0.Add(new Vector2(x, arc));
                    uv1.Add(new Vector4(half, 1000f, 0, 0));
                    uv2.Add(new Vector4(0, 2.6f, 0.61f, 0));
                }
            }
            for (int j = 0; j + 1 < path.Count; j++)
            for (int i = 0; i < 2; i++)
            {
                int a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1;
                tris.AddRange(new[] { a, c, b, b, c, d, b, c, a, d, c, b });
            }
            var mesh = new Mesh();
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uv0);
            mesh.SetUVs(1, uv1);
            mesh.SetUVs(2, uv2);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // ───────────── 桥 ─────────────

        /// <summary>铁桥（v2 SM_Tripo_InfernoIronBridge，到货前白盒）：桥面顶 = 台面 + 5 cm，两头各压 2 m 台面；铸坊的桥 0.8 m 厚，神范台的 0.4 m</summary>
        static List<GameObject> BuildBridges(Transform arch)
        {
            var root = new GameObject("Iron Bridges").transform;
            root.SetParent(arch, false);
            var list = new List<GameObject>();
            foreach (var b in Bridges)
            {
                var c = b.center;
                bool alongX = Mathf.Abs(b.along.x) > 0.5f;
                var size = alongX ? new Vector3(b.span, b.Thick, b.width) : new Vector3(b.width, b.Thick, b.span);
                // 白盒的顶 = 底面中心 y + 尺寸 y − 0.05（PlaceOrBox 往下埋 0.1 m）
                GameObject go;
                if (ShowcaseSceneBuilder.Prefab(BridgeId))
                    go = PlaceFit(BridgeId, root, new Vector3(c.x, b.DeckY - BridgeDeckOnPrefab, c.y), alongX ? 0 : 90, new Vector3(b.span, BridgePrefabH, b.width));
                else go = LevelKit.PlaceOrBox(BridgeId, root, new Vector3(c.x, b.DeckY - b.Thick + 0.05f, c.y), size, 0);
                Label(go, BridgeId, $"{b.id} {b.name}");
                list.Add(go);
            }
            return list;
        }
    }
}
