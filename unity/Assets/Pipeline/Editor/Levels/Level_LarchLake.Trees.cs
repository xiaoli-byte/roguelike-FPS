using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // 彩林海子 · 树：程序化的风格化落叶松（金黄）与云杉（墨绿），做成带两级 LOD 的 Prefab，按地貌种成地形树
    public static partial class Level_LarchLake
    {
        const string TreeDir = Dir + "/Trees";

        /// <summary>一种树的造型与配色（sRGB）。树高按 20 m 建，地形树实例再缩放</summary>
        sealed class TreeStyle
        {
            public string id;
            public bool larch;
            public Color leaf, tip, inner, trunk;
            /// <summary>树冠从多高开始（占树高）、最大半径（占树高）、层数、每层的枝团数、枝梢下垂（占层高）、轮廓指数（&lt;1 底部更宽）、层高系数（&lt; 1.3 层间露出树干）</summary>
            public float crownBase, radius, droop, profile, tierScale;
            public int tiers, lobes, seed;
        }

        static readonly TreeStyle[] Styles =
        {
            // 落叶松：细高、层与层之间露出深色树干，金黄 → 橙 → 浅黄几种，外加一种还带绿意的「转色中」
            new() { id = "LarchGold", larch = true, leaf = C3(0.93f, 0.63f, 0.12f), tip = C3(1.0f, 0.80f, 0.30f), inner = C3(0.52f, 0.28f, 0.06f), trunk = C3(0.27f, 0.2f, 0.15f),
                crownBase = 0.3f, radius = 0.14f, droop = 0.35f, profile = 0.95f, tierScale = 1.15f, tiers = 11, lobes = 9, seed = 11 },
            new() { id = "LarchAmber", larch = true, leaf = C3(0.86f, 0.47f, 0.09f), tip = C3(0.98f, 0.66f, 0.2f), inner = C3(0.46f, 0.21f, 0.05f), trunk = C3(0.25f, 0.18f, 0.13f),
                crownBase = 0.26f, radius = 0.15f, droop = 0.38f, profile = 0.9f, tierScale = 1.2f, tiers = 11, lobes = 9, seed = 23 },
            new() { id = "LarchYellow", larch = true, leaf = C3(0.95f, 0.75f, 0.24f), tip = C3(1.0f, 0.88f, 0.46f), inner = C3(0.58f, 0.40f, 0.11f), trunk = C3(0.3f, 0.23f, 0.17f),
                crownBase = 0.34f, radius = 0.13f, droop = 0.32f, profile = 1.0f, tierScale = 1.1f, tiers = 10, lobes = 8, seed = 37 },
            new() { id = "LarchTurning", larch = true, leaf = C3(0.72f, 0.62f, 0.2f), tip = C3(0.88f, 0.77f, 0.32f), inner = C3(0.36f, 0.32f, 0.1f), trunk = C3(0.26f, 0.2f, 0.15f),
                crownBase = 0.28f, radius = 0.14f, droop = 0.36f, profile = 0.95f, tierScale = 1.2f, tiers = 11, lobes = 9, seed = 41 },
            // 云杉 / 冷杉：塔形、枝层密、从低处就开始长，墨绿 → 蓝绿 → 橄榄绿
            new() { id = "SpruceDark", larch = false, leaf = C3(0.1f, 0.22f, 0.14f), tip = C3(0.17f, 0.32f, 0.19f), inner = C3(0.035f, 0.08f, 0.055f), trunk = C3(0.2f, 0.15f, 0.11f),
                crownBase = 0.1f, radius = 0.19f, droop = 0.45f, profile = 0.85f, tierScale = 1.55f, tiers = 15, lobes = 11, seed = 53 },
            new() { id = "SpruceBlue", larch = false, leaf = C3(0.09f, 0.2f, 0.18f), tip = C3(0.16f, 0.3f, 0.27f), inner = C3(0.03f, 0.075f, 0.065f), trunk = C3(0.2f, 0.15f, 0.11f),
                crownBase = 0.12f, radius = 0.17f, droop = 0.5f, profile = 0.8f, tierScale = 1.5f, tiers = 16, lobes = 11, seed = 67 },
            new() { id = "SpruceOlive", larch = false, leaf = C3(0.14f, 0.25f, 0.12f), tip = C3(0.22f, 0.36f, 0.16f), inner = C3(0.05f, 0.1f, 0.05f), trunk = C3(0.22f, 0.16f, 0.12f),
                crownBase = 0.08f, radius = 0.2f, droop = 0.42f, profile = 0.9f, tierScale = 1.5f, tiers = 14, lobes = 10, seed = 79 },
        };

        const float TreeHeight = 20;

        static Color Lin(Color c) => QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;

        /// <summary>
        /// 一棵树的网格。LOD0：六棱树干 + tiers 层「伞裙」（每层：中心顶点 → 内圈 → 外圈枝团，枝团尖往下垂、枝团之间的凹口收进去），
        /// LOD1：四棱树干 + 少几层、只有外圈。顶点色：层内中心暗外缘亮、下层暗上层亮；a = 摆动权重；法线是从树轴往外的「球形法线」
        /// </summary>
        static Mesh TreeMesh(TreeStyle st, bool lod1)
        {
            var rnd = new System.Random(st.seed * 7 + (lod1 ? 1 : 0));
            float R() => (float)rnd.NextDouble();
            var v = new List<Vector3>();
            var n = new List<Vector3>();
            var col = new List<Color>();
            var tri = new List<int>();
            float H = TreeHeight, Rmax = st.radius * H;
            float y0 = H * st.crownBase, y1 = H;
            float crownMid = (y0 + y1) * 0.5f, crownHalf = (y1 - y0) * 0.5f;

            // 树干：根部略粗、往上收尖
            int sides = lod1 ? 4 : 6;
            float rBase = 0.32f, rTop = 0.04f;
            var trunkRings = new[] { (-0.5f, rBase * 1.25f), (0.6f, rBase), (y0, Mathf.Lerp(rBase, rTop, y0 / H)), (H * 0.97f, rTop) };
            int t0 = v.Count;
            for (int r = 0; r < trunkRings.Length; r++)
            {
                var (y, rad) = trunkRings[r];
                float shade = Mathf.Lerp(0.65f, 1.05f, Mathf.Clamp01(y / H));
                for (int s = 0; s < sides; s++)
                {
                    float a = s / (float)sides * Mathf.PI * 2;
                    var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                    v.Add(dir * rad + Vector3.up * y);
                    n.Add(dir);
                    var c = Lin(st.trunk * shade);
                    c.a = Mathf.Clamp01(y / H) * 0.5f;
                    col.Add(c);
                }
            }
            for (int r = 0; r < trunkRings.Length - 1; r++)
            for (int s = 0; s < sides; s++)
            {
                int a = t0 + r * sides + s, b = t0 + r * sides + (s + 1) % sides, c = a + sides, d = b + sides;
                tri.AddRange(new[] { a, c, b, b, c, d });
            }

            Vector3 Sphere(Vector3 p)
            {
                var h = new Vector3(p.x / Rmax, 0, p.z / Rmax);
                return (h * 1.1f + Vector3.up * (0.45f + (p.y - crownMid) / crownHalf * 0.45f)).normalized;
            }

            int tiers = lod1 ? Mathf.Max(4, st.tiers / 2) : st.tiers;
            int lobes = lod1 ? 6 : st.lobes;
            float tierH = (y1 - y0) / tiers * (lod1 ? st.tierScale * 1.25f : st.tierScale);
            for (int k = 0; k < tiers; k++)
            {
                float f = k / (float)tiers;
                float yk = Mathf.Lerp(y0, y1 - tierH * 0.55f, Mathf.Pow(f, 0.95f)) + (R() - 0.5f) * tierH * 0.15f;
                float rk = Rmax * Mathf.Pow(1 - f, st.profile) * (0.85f + 0.3f * R()) + 0.35f;
                float rot = R() * Mathf.PI * 2;
                var lean = new Vector3((R() - 0.5f) * 0.25f, 0, (R() - 0.5f) * 0.25f);
                float shade = Mathf.Lerp(0.72f, 1.06f, Mathf.Pow(f, 0.8f));
                float hueJ = (R() - 0.5f) * 0.08f;
                Color Tone(Color baseC, float mul)
                {
                    var c = baseC * (shade * mul);
                    c.r += hueJ * (st.larch ? 1 : 0.3f);
                    c.g += hueJ * 0.5f;
                    c = Lin(c);
                    return c;
                }

                int apex = v.Count;
                var ap = new Vector3(0, yk + tierH, 0) + lean;
                v.Add(ap);
                n.Add(Vector3.up);
                var ca = Tone(st.leaf, 0.95f);
                ca.a = Mathf.Clamp01(ap.y / H);
                col.Add(ca);

                int ringN = lobes * 2;
                int inner = -1;
                if (!lod1)
                {
                    inner = v.Count;
                    for (int j = 0; j < ringN; j++)
                    {
                        float a = rot + j / (float)ringN * Mathf.PI * 2;
                        bool lobe = (j & 1) == 0;
                        float rr = rk * 0.48f * (lobe ? 1 : 0.8f);
                        var p = new Vector3(Mathf.Cos(a) * rr, yk + tierH * 0.5f, Mathf.Sin(a) * rr) + lean;
                        v.Add(p);
                        n.Add(Sphere(p));
                        var c = Tone(st.inner, 1.0f) * 0.5f + Tone(st.leaf, 1.0f) * 0.5f;
                        c.a = Mathf.Clamp01(p.y / H) * 0.8f;
                        col.Add(c);
                    }
                }
                int outer = v.Count;
                for (int j = 0; j < ringN; j++)
                {
                    float a = rot + (j + (R() - 0.5f) * 0.3f) / ringN * Mathf.PI * 2;
                    bool lobe = (j & 1) == 0;
                    float rr = rk * (lobe ? 1f + (R() - 0.5f) * 0.25f : 0.58f);
                    float y = yk + (lobe ? -st.droop * tierH * (0.8f + 0.4f * R()) : tierH * 0.12f);
                    var p = new Vector3(Mathf.Cos(a) * rr, y, Mathf.Sin(a) * rr) + lean;
                    v.Add(p);
                    n.Add(Sphere(p));
                    var c = lobe ? Tone(st.tip, 1.0f) : Tone(st.inner, 1.1f);
                    c.a = Mathf.Clamp01(p.y / H);
                    col.Add(c);
                }
                if (lod1)
                {
                    for (int j = 0; j < ringN; j++) tri.AddRange(new[] { apex, outer + (j + 1) % ringN, outer + j });
                }
                else
                {
                    for (int j = 0; j < ringN; j++)
                    {
                        int a = inner + j, b = inner + (j + 1) % ringN, c = outer + j, d = outer + (j + 1) % ringN;
                        tri.AddRange(new[] { apex, b, a });
                        tri.AddRange(new[] { a, b, c, b, d, c });
                    }
                }
            }

            var mesh = new Mesh { name = $"TR_{st.id}{(lod1 ? "_LOD1" : "")}" };
            mesh.SetVertices(v);
            mesh.SetNormals(n);
            mesh.SetColors(col);
            mesh.SetTriangles(tri, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        static Material foliageMat;

        static Material FoliageMaterial()
        {
            if (foliageMat) return foliageMat;
            var m = new Material(Shader.Find("Spiritfire/Foliage")) { name = "M_Foliage", enableInstancing = true };
            m.SetColor("_ShadowTint", new Color(0.55f, 0.62f, 0.88f));
            m.SetFloat("_RampThreshold", -0.05f);
            m.SetFloat("_RampSoftness", 0.32f);
            m.SetFloat("_ShadowLift", 0.42f);
            m.SetFloat("_Translucency", 0.7f);
            m.SetColor("_TranslucencyColor", new Color(1f, 0.78f, 0.38f));
            LevelKit.SaveAsset(m, $"{TreeDir}/M_Foliage.mat");
            return foliageMat = m;
        }

        /// <summary>树的 Prefab：根上 LODGroup + 树干胶囊碰撞（地形树碰撞），子物体 LOD0 / LOD1</summary>
        static GameObject TreePrefab(TreeStyle st)
        {
            Directory.CreateDirectory(TreeDir);
            var mat = FoliageMaterial();
            var root = new GameObject($"TR_{st.id}");
            var renderers = new Renderer[2];
            for (int l = 0; l < 2; l++)
            {
                var mesh = TreeMesh(st, l == 1);
                LevelKit.SaveAsset(mesh, $"{TreeDir}/{mesh.name}.asset");
                var go = new GameObject(l == 0 ? "LOD0" : "LOD1");
                go.transform.SetParent(root.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = ShadowCastingMode.On;
                mr.lightProbeUsage = LightProbeUsage.BlendProbes;
                mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
                renderers[l] = mr;
            }
            var lod = root.AddComponent<LODGroup>();
            lod.SetLODs(new[] { new LOD(0.07f, new[] { renderers[0] }), new LOD(0.0015f, new[] { renderers[1] }) });
            lod.fadeMode = LODFadeMode.None;
            lod.RecalculateBounds();
            var cap = root.AddComponent<CapsuleCollider>();
            cap.center = new Vector3(0, 3, 0);
            cap.radius = 0.4f;
            cap.height = 6;
            string path = $"{TreeDir}/TR_{st.id}.prefab";
            var prefab = PrefabUtility.SaveAsPrefabAsset(root, path);
            Object.DestroyImmediate(root);
            return prefab;
        }

        // ───────────── 种树 ─────────────

        /// <summary>
        /// 树的密度（0..1）：湖里、车路、出生点空地没有；陡崖（&gt; 40°）几乎没有、林线以上没有；谷底稀一些（人要走得开，林间有草甸空地），
        /// 两岸山坡密；紧挨湖岸一排稍密（照片里一线树站在水边）
        /// </summary>
        static float TreeDensity(float x, float z, out Ground g, out float slope)
        {
            g = Eval(x, z);
            slope = ts.Slope(new Vector2(x, z));
            if (g.lakeR < 1.06f) return 0;
            if (g.road > 0.01f || RoadDistance(new Vector2(x, z)) < 7.5f) return 0;
            float ds = Vector2.Distance(new Vector2(x, z), new Vector2(spawnAt.x, spawnAt.z));
            if (ds < 16) return 0;
            float cliff = 1 - S(40, 52, slope);
            float treeline = 285 + 50 * g.east + (Fbm(x * 0.008f, z * 0.008f, 3, 601) - 0.5f) * 70 - 35 * S(-100, -320, x);
            float alt = 1 - S(treeline - 60, treeline, g.y);
            if (alt <= 0) return 0;
            float onFloor = g.floorMask;
            float meadow = S(0.6f, 0.7f, Fbm(x * 0.011f, z * 0.011f, 3, 603)) * onFloor;
            float baseD = Mathf.Lerp(0.82f, 0.42f, onFloor) * (1 - meadow * 0.85f);
            float shore = S(1.06f, 1.1f, g.lakeR) * (1 - S(1.12f, 1.25f, g.lakeR));
            baseD = Mathf.Max(baseD, 0.62f * shore);
            float near = S(16, 30, ds);
            float strip = 0.3f * S(0.56f, 0.7f, Fbm(z * 0.03f, g.y * 0.012f, 3, 607)) * S(30, 40, slope) * (1 - S(62, 72, slope));
            return Mathf.Clamp01(baseD * (cliff + 0.06f + strip) * alt * near);
        }

        /// <summary>地形树：4.5 m 一格抖动取点，按密度抛硬币；落叶松的比例在谷底高、往林线降（成片的云杉林斑块按噪声）；返回各树种棵数</summary>
        static Dictionary<string, int> PlantTrees()
        {
            foliageMat = null;
            var prefabs = Styles.Select(TreePrefab).ToArray();
            var protos = prefabs.Select(p => new TreePrototype { prefab = p, bendFactor = 0 }).ToArray();
            var counts = Styles.ToDictionary(s => s.id, _ => 0);
            const float cell = 4.5f;
            var tileSize = ts.TileSize;
            foreach (var t in ts.tiles)
            {
                var td = t.terrainData;
                td.treePrototypes = protos;
                var o = new Vector2(t.transform.position.x, t.transform.position.z);
                int nx = Mathf.CeilToInt(tileSize.x / cell), nz = Mathf.CeilToInt(tileSize.y / cell);
                int bx = Mathf.RoundToInt((o.x - Origin.x) / cell), bz = Mathf.RoundToInt((o.y - Origin.y) / cell);
                var list = new List<TreeInstance>();
                var lockObj = new object();
                System.Threading.Tasks.Parallel.For(0, nz, j =>
                {
                    var local = new List<(TreeInstance inst, int style)>();
                    for (int i = 0; i < nx; i++)
                    {
                        int gx = bx + i, gz = bz + j;
                        float x = o.x + (i + Landform.Hash(gx, gz, 611)) * cell, z = o.y + (j + Landform.Hash(gx, gz, 613)) * cell;
                        if (x >= o.x + tileSize.x || z >= o.y + tileSize.y) continue;
                        float d = TreeDensity(x, z, out var g, out _);
                        if (d <= 0 || Landform.Hash(gx, gz, 617) > d) continue;
                        float larchP = Mathf.Lerp(0.8f, 0.22f, S(30, 230, g.y));
                        larchP = Mathf.Clamp01(larchP + (Fbm(x * 0.02f, z * 0.02f, 3, 619) - 0.5f) * 0.9f);
                        bool larch = Landform.Hash(gx, gz, 621) < larchP;
                        float pick = Landform.Hash(gx, gz, 623);
                        int style = larch ? (pick < 0.42f ? 0 : pick < 0.7f ? 1 : pick < 0.88f ? 2 : 3) : (pick < 0.5f ? 4 : pick < 0.8f ? 5 : 6);
                        float hs = Mathf.Lerp(0.72f, 1.22f, Landform.Hash(gx, gz, 627));
                        // 山坡上的树矮一点、谷底湖边的高一点
                        hs *= Mathf.Lerp(1.05f, 0.85f, S(40, 260, g.y));
                        float ws = hs * Mathf.Lerp(0.85f, 1.15f, Landform.Hash(gx, gz, 629));
                        var inst = new TreeInstance
                        {
                            position = new Vector3((x - o.x) / tileSize.x, 0, (z - o.y) / tileSize.y),
                            widthScale = ws, heightScale = hs, rotation = Landform.Hash(gx, gz, 631) * Mathf.PI * 2,
                            color = Color.white, lightmapColor = Color.white, prototypeIndex = style,
                        };
                        local.Add((inst, style));
                    }
                    lock (lockObj)
                    {
                        foreach (var (inst, style) in local)
                        {
                            list.Add(inst);
                            counts[Styles[style].id]++;
                        }
                    }
                });
                td.SetTreeInstances(list.ToArray(), true);
                t.treeDistance = 1500;
                t.treeBillboardDistance = 1500;
                t.treeCrossFadeLength = 0;
                t.treeMaximumFullLODCount = 100000;
                t.treeLODBiasMultiplier = 1;
                t.drawTreesAndFoliage = true;
                EditorUtility.SetDirty(td);
            }
            AssetDatabase.SaveAssets();
            return counts;
        }

        // ───────────── 地被细节 ─────────────

        /// <summary>
        /// 地被（Terrain 细节，只在游玩区附近）：林下一丛丛枯黄的草、湖岸和林缘的红褐 / 赭黄灌丛（照片里水边一溜红褐色的矮灌木）、
        /// 卵石滩上的碎石；路面、水里、陡坡没有
        /// </summary>
        static Dictionary<string, int> BuildDetails()
        {
            var grass = LevelKit.PlateauGrassPrefab("LarchGrassGold", new Color(0.8f, 0.65f, 0.33f), 6, 0.75f, 0.05f, 701);
            var grassDry = LevelKit.PlateauGrassPrefab("LarchGrassDry", new Color(0.66f, 0.55f, 0.36f), 5, 0.55f, 0.045f, 703);
            var shrubRed = LevelKit.PlateauBushPrefab("LarchShrubRed", new Color(0.58f, 0.27f, 0.15f), 707);
            var shrubOchre = LevelKit.PlateauBushPrefab("LarchShrubOchre", new Color(0.66f, 0.46f, 0.2f), 709);
            var pebbles = LevelKit.ScatterPrefab(new LevelKit.ScatterRule { name = "LarchShoreStones", placeholder = LevelKit.Placeholder.SnowRock, seed = 711 });
            bool Near(float x, float z) => Playable(new Vector2(x, z)) > 0.05f;
            float Floor(Vector2 p, out Ground g)
            {
                g = Eval(p.x, p.y);
                if (!Near(p.x, p.y) || g.lakeR < 1.04f || g.road > 0.05f) return 0;
                return 1 - S(28, 40, ts.Slope(p));
            }
            var layers = new List<LevelKit.PlateauDetailLayer>
            {
                new() { name = "LarchGrassGold", prefab = grass, perHundredSqm = 40, scale = new(0.6f, 1.1f), seed = 3,
                    density = p => { float f = Floor(p, out var g); return f * (1 - g.gravel) * (1 - g.snow) * S(0.35f, 0.6f, Fbm(p.x * 0.05f, p.y * 0.05f, 2, 721)); } },
                new() { name = "LarchGrassDry", prefab = grassDry, perHundredSqm = 25, scale = new(0.6f, 1.0f), seed = 5,
                    density = p => { float f = Floor(p, out var g); return f * (1 - g.snow * 0.7f) * (1 - g.gravel * 0.6f); } },
                new() { name = "LarchShrubRed", prefab = shrubRed, perHundredSqm = 3f, scale = new(0.6f, 1.25f), alignToGround = 0.3f, seed = 7,
                    density = p => { float f = Floor(p, out var g); float shore = S(1.05f, 1.1f, g.lakeR) * (1 - S(1.25f, 1.5f, g.lakeR)); return f * Mathf.Max(shore, 0.25f * S(0.55f, 0.7f, Fbm(p.x * 0.03f, p.y * 0.03f, 2, 723))); } },
                new() { name = "LarchShrubOchre", prefab = shrubOchre, perHundredSqm = 2f, scale = new(0.6f, 1.2f), alignToGround = 0.3f, seed = 9,
                    density = p => { float f = Floor(p, out var g); return f * S(0.5f, 0.68f, Fbm(p.x * 0.025f, p.y * 0.025f, 2, 725)) * (1 - g.gravel); } },
                new() { name = "LarchShoreStones", prefab = pebbles, perHundredSqm = 4f, scale = new(0.3f, 1.1f), seed = 11,
                    density = p => { var g = Eval(p.x, p.y); if (!Near(p.x, p.y)) return 0; return g.gravel * (1 - g.road) + 0.08f * S(30, 45, ts.Slope(p)); } },
            };
            return LevelKit.PlateauDetails(ts, layers, 1f, 120f);
        }
    }
}
