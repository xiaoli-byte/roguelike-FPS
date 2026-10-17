using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Unity.AI.Navigation;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 关卡构建的通用部件：从地貌函数生成 Unity Terrain（高度 + 分层图），白盒体块，NavMesh 烘焙，
    /// 以及验收检查（主线连通、地标可见、坡度）与审核截图。每张图的具体布局写在各自的 Level_x_y 里。
    /// </summary>
    public static class LevelKit
    {
        public const string ReviewDir = "Assets/Art/_Review";

        /// <summary>地貌求值结果：高度（米）+ 分层规则要用的各个分量（都由同一个纯函数给出，高度图与分层图严格对齐）</summary>
        public struct Sample
        {
            public float h;
            /// <summary>各层的原始倾向 0–1（分层规则在 <see cref="Splat"/> 里合成）</summary>
            public float sand, packed, gravelBias;
            /// <summary>强制岩石（雅丹、台地侧壁之外的岩体，如远景岩丘）</summary>
            public float rock;
        }

        // ───────────── 地形 ─────────────
        public sealed class TerrainSpec
        {
            public string dir, name;
            public Vector2 size;
            /// <summary>地形左下角的世界 XZ（关卡坐标 = 世界坐标）</summary>
            public Vector2 origin;
            /// <summary>高度场里的 0 对应世界 y = -baseHeight（让挖下去的河床、盆地也在 0 以上）</summary>
            public float baseHeight, heightRange = 48;
            public int heightRes = 1025, splatRes = 1024;
            public TerrainLayer[] layers;
            public Func<Vector2, Sample> eval;
            public Color shadowTint = new(0.7f, 0.64f, 0.82f);
        }

        public static Terrain BuildTerrain(TerrainSpec s, Transform parent, out HeightField hf)
        {
            int res = s.heightRes;
            hf = new HeightField(s.size, res);
            var samples = new Sample[res, res];
            var field = hf;
            Parallel.For(0, res, z =>
            {
                for (int x = 0; x < res; x++)
                {
                    var smp = s.eval(field.Pos(x, z) + s.origin);
                    samples[z, x] = smp;
                    field.h[z, x] = smp.h;
                }
            });

            var heights = new float[res, res];
            for (int z = 0; z < res; z++)
            for (int x = 0; x < res; x++)
                heights[z, x] = Mathf.Clamp01(hf.h[z, x] / s.heightRange);

            // 先建资产再写数据：分层图纹理是 TerrainData 的子资产，在资产创建之前写进去的像素不会落盘
            Directory.CreateDirectory(s.dir);
            string tdPath = $"{s.dir}/TD_{s.name}.asset";
            AssetDatabase.DeleteAsset(tdPath);
            var td = new TerrainData();
            AssetDatabase.CreateAsset(td, tdPath);
            td.heightmapResolution = res;
            td.size = new Vector3(s.size.x, s.heightRange, s.size.y);
            td.SetHeights(0, 0, heights);
            td.terrainLayers = s.layers;
            td.alphamapResolution = s.splatRes;
            td.baseMapResolution = 1024;

            // 分层图：每个分层像素取最近的高度采样的分量，坡度用高度场差分
            int n = s.splatRes;
            var alpha = new float[n, n, s.layers.Length];
            Parallel.For(0, n, z =>
            {
                for (int x = 0; x < n; x++)
                {
                    int hx = Mathf.Clamp(Mathf.RoundToInt((x + 0.5f) / n * (res - 1)), 0, res - 1);
                    int hz = Mathf.Clamp(Mathf.RoundToInt((z + 0.5f) / n * (res - 1)), 0, res - 1);
                    var w = Splat(samples[hz, hx], field.Slope(hx, hz));
                    for (int l = 0; l < s.layers.Length && l < 4; l++) alpha[z, x, l] = w[l];
                }
            });
            td.SetAlphamaps(0, 0, alpha);
            EditorUtility.SetDirty(td);
            AssetDatabase.SaveAssets();

            var material = TerrainMaterial(s.dir, s.name, s.shadowTint, td, s.layers);
            var go = Terrain.CreateTerrainGameObject(td);
            go.name = $"Terrain_{s.name}";
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(s.origin.x, -s.baseHeight, s.origin.y);
            go.isStatic = true;
            var t = go.GetComponent<Terrain>();
            t.materialTemplate = material;
            t.drawInstanced = false;       // 风格化地形着色器直接读顶点法线
            t.basemapDistance = 2000;      // 始终走本着色器，不切到远处的 basemap
            t.heightmapPixelError = 3;
            t.shadowCastingMode = ShadowCastingMode.On;
            t.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return t;
        }

        /// <summary>
        /// 分层规则（0 沙 / 1 黑戈壁砾石 / 2 夯土·干河床 / 3 赭红层理岩），按优先级逐层「占掉剩余份额」：
        /// 陡坡与岩体 → 岩；路、河床、台顶 → 夯土；沙丘、沙坡、盆地 → 沙；剩下的是砾石戈壁。
        /// </summary>
        static Vector4 Splat(Sample s, float slope)
        {
            // 陡坡变岩石，但沙丘（沙的倾向强）再陡也还是沙——沙丘背风坡本来就在 30° 上下
            float rock = Mathf.Max(Landform.Smooth(30, 42, slope) * (1 - Landform.Smooth(0.35f, 0.7f, s.sand)), s.rock);
            float left = 1 - rock;
            float packed = Mathf.Clamp01(s.packed) * left;
            left -= packed;
            // 沙丘背风坡（30° 上下）仍是沙，不被坡度规则吃成岩石：沙的倾向强时把岩石份额让回来
            float sand = Mathf.Clamp01(s.sand) * left;
            left -= sand;
            float gravel = left;
            return new Vector4(sand, gravel, packed, rock);
        }

        /// <summary>地形材质：显式绑定 TerrainData 的分层图（alphamap 纹理）与各层贴图、平铺尺寸</summary>
        static Material TerrainMaterial(string dir, string name, Color shadowTint, TerrainData td, TerrainLayer[] layers)
        {
            var m = new Material(Shader.Find("Spiritfire/StylizedTerrain")) { name = $"M_Terrain_{name}" };
            m.SetTexture("_ControlMap", td.alphamapTextures[0]);
            var tile = Vector4.one * 8;
            for (int i = 0; i < 4 && i < layers.Length; i++)
            {
                m.SetTexture($"_Layer{i}", layers[i].diffuseTexture);
                tile[i] = layers[i].tileSize.x;
            }
            m.SetVector("_LayerTile", tile);
            m.SetTexture("_MacroTex", TerrainTextureGen.Macro(5));
            m.SetFloat("_MacroScale", 70);
            m.SetFloat("_MacroStrength", 0.2f);
            m.SetFloat("_RockScale", 8);
            m.SetColor("_ShadowTint", shadowTint);
            SaveAsset(m, $"{dir}/M_Terrain_{name}.mat");
            return m;
        }

        // ───────────── 白盒 ─────────────
        static readonly Dictionary<string, Material> mats = new();

        public static Material Mat(string dir, string name, Color c, float roughness = 0.92f)
        {
            string path = $"{dir}/M_WB_{name}.mat";
            if (mats.TryGetValue(path, out var cached) && cached) return cached;
            var m = new Material(Shader.Find("Spiritfire/StylizedLit")) { name = $"M_WB_{name}" };
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Metallic", 0);
            m.SetFloat("_Roughness", roughness);
            m.SetFloat("_RimStrength", 0.15f);
            SaveAsset(m, path);
            mats[path] = m;
            return m;
        }

        public static void ResetCache() => mats.Clear();

        /// <summary>白盒方块：center = 底面中心（世界坐标），沿 yaw 旋转；sink = 往地下多埋的深度（坡地上不露缝）</summary>
        public static GameObject Box(string name, Transform parent, Vector3 baseCenter, Vector3 size, float yaw, Material m, float sink = 0.4f)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(baseCenter + Vector3.up * (size.y * 0.5f - sink), Quaternion.Euler(0, yaw, 0));
            go.transform.localScale = new Vector3(size.x, size.y + sink, size.z);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            go.isStatic = true;
            return go;
        }

        public static GameObject Cylinder(string name, Transform parent, Vector3 center, float radius, float length, Quaternion rot, Material m)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(center, rot);
            go.transform.localScale = new Vector3(radius * 2, length * 0.5f, radius * 2);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.AddComponent<CapsuleCollider>();
            go.isStatic = true;
            return go;
        }

        public static float GroundY(Terrain t, float x, float z) => t.SampleHeight(new Vector3(x, 0, z)) + t.transform.position.y;
        public static Vector3 OnGround(Terrain t, float x, float z, float dy = 0) => new(x, GroundY(t, x, z) + dy, z);

        /// <summary>摆现有资产到地面上：按设计包围盒缩放到目标高度（targetHeight ≤ 0 时不缩放）</summary>
        public static GameObject Prop(string id, Transform parent, Terrain t, float x, float z, float yaw, float targetHeight = 0, float sink = 0.15f)
        {
            float scale = 1;
            if (targetHeight > 0)
            {
                var b = ShowcaseSceneBuilder.DesignBounds(id);
                scale = targetHeight / Mathf.Max(0.1f, b.size.y);
            }
            var go = ShowcaseSceneBuilder.Place(id, parent, OnGround(t, x, z, -sink), yaw, scale);
            if (go) go.isStatic = true;
            return go;
        }

        public static void SaveAsset(Object obj, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(obj, path);
        }

        // ───────────── 烟柱（烽燧狼烟）─────────────
        public static ParticleSystem Smoke(string dir, Transform parent, Vector3 pos, Color color)
        {
            string texPath = $"{dir}/T_SoftPuff.png";
            if (!File.Exists(texPath))
            {
                const int n = 64;
                var tex = new Texture2D(n, n, TextureFormat.RGBA32, false);
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                    float a = Landform.Smooth(1f, 0.35f, d);
                    tex.SetPixel(x, y, new Color(1, 1, 1, a));
                }
                File.WriteAllBytes(texPath, tex.EncodeToPNG());
                Object.DestroyImmediate(tex);
                AssetDatabase.ImportAsset(texPath);
                var ti = (TextureImporter)AssetImporter.GetAtPath(texPath);
                ti.alphaIsTransparency = true;
                ti.wrapMode = TextureWrapMode.Clamp;
                ti.SaveAndReimport();
            }
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = "M_Smoke" };
            m.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(texPath));
            m.SetColor("_BaseColor", color);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 0);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent;
            SaveAsset(m, $"{dir}/M_Smoke.mat");

            var go = new GameObject("Beacon Smoke");
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(pos, Quaternion.Euler(-90, 0, 0));
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.duration = 10;
            main.loop = true;
            main.prewarm = true;
            main.startLifetime = 11;
            main.startSpeed = 2.4f;
            main.startSize = new ParticleSystem.MinMaxCurve(2.5f, 4f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0, Mathf.PI * 2);
            main.maxParticles = 200;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = ps.emission;
            em.rateOverTime = 7;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 6;
            shape.radius = 0.8f;
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            // 高空风把烟柱往西南吹弯（与沙丘、雅丹同一主风向）
            vel.x = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, -1.6f));
            vel.y = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, 0));
            vel.z = new ParticleSystem.MinMaxCurve(0, AnimationCurve.Linear(0, 0, 1, -1.1f));
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1, AnimationCurve.EaseInOut(0, 0.6f, 1, 3.2f));
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(0.6f, 0), new GradientAlphaKey(1, 0.05f), new GradientAlphaKey(0.7f, 0.6f), new GradientAlphaKey(0, 1) });
            col.color = g;
            var rot = ps.rotationOverLifetime;
            rot.enabled = true;
            rot.z = new ParticleSystem.MinMaxCurve(-0.3f, 0.3f);
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.sortMode = ParticleSystemSortMode.Distance;
            return ps;
        }

        // ───────────── 边界 ─────────────
        /// <summary>
        /// 不可见边界：对「游玩区遮罩」做 marching squares，取 threshold 等值线，沿线立一圈竖直的碰撞面（双面）。
        /// 地形本身给视觉边界（沙丘、崖），这圈墙只保证翻不出去；NavMesh 也把它当障碍。
        /// </summary>
        public static GameObject Boundary(string dir, string name, Transform parent, Func<Vector2, float> inside, Rect area,
            float cell = 2f, float threshold = 0.2f, float bottom = -30f, float top = 80f)
        {
            int nx = Mathf.CeilToInt(area.width / cell), nz = Mathf.CeilToInt(area.height / cell);
            var v = new float[nz + 1, nx + 1];
            Parallel.For(0, nz + 1, z =>
            {
                for (int x = 0; x <= nx; x++) v[z, x] = inside(new Vector2(area.xMin + x * cell, area.yMin + z * cell)) - threshold;
            });
            Vector2 P(int x, int z) => new(area.xMin + x * cell, area.yMin + z * cell);
            Vector2 Cross(Vector2 a, Vector2 b, float va, float vb) => Vector2.Lerp(a, b, va / (va - vb));
            var segs = new List<(Vector2 a, Vector2 b)>();
            var pts = new List<Vector2>(4);
            for (int z = 0; z < nz; z++)
            for (int x = 0; x < nx; x++)
            {
                float v00 = v[z, x], v10 = v[z, x + 1], v11 = v[z + 1, x + 1], v01 = v[z + 1, x];
                pts.Clear();
                if ((v00 > 0) != (v10 > 0)) pts.Add(Cross(P(x, z), P(x + 1, z), v00, v10));
                if ((v10 > 0) != (v11 > 0)) pts.Add(Cross(P(x + 1, z), P(x + 1, z + 1), v10, v11));
                if ((v11 > 0) != (v01 > 0)) pts.Add(Cross(P(x + 1, z + 1), P(x, z + 1), v11, v01));
                if ((v01 > 0) != (v00 > 0)) pts.Add(Cross(P(x, z + 1), P(x, z), v01, v00));
                for (int i = 0; i + 1 < pts.Count; i += 2) segs.Add((pts[i], pts[i + 1]));
            }
            var verts = new List<Vector3>(segs.Count * 4);
            var tris = new List<int>(segs.Count * 12);
            foreach (var (a, b) in segs)
            {
                int i0 = verts.Count;
                verts.Add(new Vector3(a.x, bottom, a.y));
                verts.Add(new Vector3(b.x, bottom, b.y));
                verts.Add(new Vector3(b.x, top, b.y));
                verts.Add(new Vector3(a.x, top, a.y));
                tris.AddRange(new[] { i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2 });
            }
            var mesh = new Mesh { name = $"Boundary_{name}", indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            SaveAsset(mesh, $"{dir}/Boundary_{name}.asset");
            // Ignore Raycast 层：玩家与 NavMesh 会撞到它，子弹 / 视线射线穿过去
            var go = new GameObject("Boundary") { layer = 2 };
            go.transform.SetParent(parent, false);
            go.isStatic = true;
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
            Debug.Log($"[Level] 边界：{segs.Count} 段，约 {segs.Sum(sg => Vector2.Distance(sg.a, sg.b)):F0} m");
            return go;
        }

        // ───────────── 导航与验收 ─────────────
        public static NavMeshSurface BakeNavMesh(string dir, string name, Transform parent)
        {
            var go = new GameObject("NavMesh");
            go.transform.SetParent(parent, false);
            var nav = go.AddComponent<NavMeshSurface>();
            nav.collectObjects = CollectObjects.All;
            nav.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer), ch = LayerMask.NameToLayer(ShowcaseSceneBuilder.CharacterLayer);
            nav.layerMask = ~((fp >= 0 ? 1 << fp : 0) | (ch >= 0 ? 1 << ch : 0));
            nav.BuildNavMesh();
            if (nav.navMeshData) SaveAsset(nav.navMeshData, $"{dir}/NavMesh_{name}.asset");
            return nav;
        }

        public sealed class Report
        {
            readonly StringBuilder sb = new();
            public int failures;

            public void Line(string s)
            {
                sb.AppendLine(s);
                Debug.Log($"[Level] {s}");
            }

            public void Fail(string s)
            {
                failures++;
                Line($"✗ {s}");
            }

            public void Save(string path)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, sb.ToString());
            }
        }

        /// <summary>主线连通：相邻路点两两求 NavMesh 路径，必须完整（PathComplete），并报告路径长度与「绕路系数」</summary>
        public static void CheckPath(Report rep, (string name, Vector3 pos)[] waypoints)
        {
            float total = 0;
            for (int i = 0; i + 1 < waypoints.Length; i++)
            {
                var (an, a) = waypoints[i];
                var (bn, b) = waypoints[i + 1];
                if (!NavMesh.SamplePosition(a, out var ha, 4, NavMesh.AllAreas) || !NavMesh.SamplePosition(b, out var hb, 4, NavMesh.AllAreas))
                {
                    rep.Fail($"路点不在 NavMesh 上：{an} 或 {bn}");
                    continue;
                }
                var path = new NavMeshPath();
                NavMesh.CalculatePath(ha.position, hb.position, NavMesh.AllAreas, path);
                float len = 0;
                for (int k = 0; k + 1 < path.corners.Length; k++) len += Vector3.Distance(path.corners[k], path.corners[k + 1]);
                float straight = Vector3.Distance(ha.position, hb.position);
                if (path.status != NavMeshPathStatus.PathComplete) rep.Fail($"{an} → {bn} 不连通（{path.status}）");
                else rep.Line($"✓ {an} → {bn}：路径 {len:F0} m（直线 {straight:F0} m，绕路 ×{len / Mathf.Max(1, straight):F2}），约 {len / 7.5f:F0} 秒");
                total += len;
            }
            rep.Line($"主线总长 {total:F0} m，约 {total / 7.5f:F0} 秒（不含战斗）");
        }

        /// <summary>地标可见：从入口眼高向地标连线，中途没有被地形 / 体块挡住（终点附近 tolerance 米内的命中算看到了地标本身）</summary>
        /// <param name="landmark">地标资产 ID：视线先打到它（任一实例）也算看到了地标</param>
        public static void CheckSight(Report rep, string what, Vector3 eye, Vector3 target, float tolerance = 4f, string landmark = null)
        {
            int mask = ~(1 << 2);
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer);
            if (fp >= 0) mask &= ~(1 << fp);
            Physics.SyncTransforms();
            bool blocked = Physics.Linecast(eye, target, out var hit, mask, QueryTriggerInteraction.Ignore) && Vector3.Distance(hit.point, target) > tolerance;
            if (blocked && landmark != null && hit.collider.name.StartsWith(landmark))
                rep.Line($"✓ {what}：可见（视线落在 {landmark} 上，{hit.distance:F0} m）");
            else if (blocked)
                rep.Fail($"{what}：看不到（被 {hit.collider.name} 挡住，距起点 {hit.distance:F0} m，地标 {Vector3.Distance(eye, target):F0} m）");
            else rep.Line($"✓ {what}：可见（{Vector3.Distance(eye, target):F0} m）");
        }

        /// <summary>沿主线采样坡度：超过 maxSlope 的路段算不合格（玩家走不上去、NavMesh 也会断）</summary>
        public static void CheckRoadSlope(Report rep, Terrain t, IReadOnlyList<Vector2> road, float maxSlope = 24f)
        {
            int bad = 0, n = 0;
            float worst = 0;
            Vector2 worstAt = default;
            for (int i = 0; i + 1 < road.Count; i++)
            {
                var a = road[i];
                var b = road[i + 1];
                float len = Vector2.Distance(a, b);
                for (float s = 0; s < len; s += 1f)
                {
                    var p = Vector2.Lerp(a, b, s / len);
                    var q = Vector2.Lerp(a, b, Mathf.Min(1, (s + 1f) / len));
                    float dh = GroundY(t, q.x, q.y) - GroundY(t, p.x, p.y);
                    float run = Vector2.Distance(p, q);
                    if (run < 0.3f) continue;
                    float slope = Mathf.Atan(Mathf.Abs(dh) / run) * Mathf.Rad2Deg;
                    n++;
                    if (slope > maxSlope) bad++;
                    if (slope > worst) { worst = slope; worstAt = p; }
                }
            }
            if (bad > 0) rep.Fail($"古道有 {bad}/{n} m 坡度超过 {maxSlope}°（最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})）");
            else rep.Line($"✓ 古道坡度：最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})，全程 ≤ {maxSlope}°");
        }

        // ───────────── 审核截图 ─────────────
        /// <summary>按机位截图；名字以 "Map" / "Aerial" 开头的高空机位临时关雾（否则几百米外全被雾吞掉）</summary>
        public static void Capture(Camera cam, GameObject fpRig, string prefix, (string name, Vector3 pos, Vector3 target, bool firstPerson)[] views)
        {
            Directory.CreateDirectory(ReviewDir);
            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var shot = new Texture2D(1920, 1080, TextureFormat.RGB24, false);
            var parent = cam.transform.parent;
            var local = (cam.transform.localPosition, cam.transform.localRotation);
            bool fpWas = fpRig && fpRig.activeSelf, fogWas = RenderSettings.fog;
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            foreach (var ps in Object.FindObjectsByType<ParticleSystem>()) ps.Simulate(14f, true, true);
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.transform.SetParent(null, true);
                cam.targetTexture = rt;
                for (int pass = 0; pass < 2; pass++)
                for (int i = 0; i < views.Length; i++)
                {
                    var (name, pos, target, fp) = views[i];
                    if (fpRig) fpRig.SetActive(fp);
                    RenderSettings.fog = fogWas && !(name.StartsWith("Map") || name.StartsWith("Aerial"));
                    cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(target - pos));
                    cam.Render();
                    if (pass == 0) continue;
                    RenderTexture.active = rt;
                    shot.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                    shot.Apply();
                    RenderTexture.active = null;
                    string path = $"{ReviewDir}/{prefix}_{i + 1}_{name}.png";
                    File.WriteAllBytes(path, shot.EncodeToPNG());
                    Debug.Log($"[Review] {path}");
                }
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = wasAsync;
                RenderSettings.fog = fogWas;
                cam.targetTexture = null;
                cam.transform.SetParent(parent, false);
                cam.transform.SetLocalPositionAndRotation(local.localPosition, local.localRotation);
                if (fpRig) fpRig.SetActive(fpWas);
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(shot);
            }
        }
    }
}
