using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 远景与氛围：远景环（远山 / 台地 / 火山剪影）、远景地面、远景地标剪影替身、远处看得见的地标效果（烽燧狼烟）。归 L4。
    public static partial class LevelKit
    {
        // ───────────── 远景环 ─────────────

        /// <summary>远景一圈的轮廓风格</summary>
        public enum BackdropStyle { Dunes, Mesas, Peaks, SnowPeaks, Ridges, Volcanoes }

        /// <summary>远景的一圈：半径、平均高、雾化程度（0 = 剪影本色，1 = 完全是地平线色）、一圈里的起伏个数</summary>
        public sealed class BackdropRing
        {
            public BackdropStyle style;
            public float radius, height, haze;
            public float freq = 9;
            public int seed;
        }

        public sealed class BackdropSpec
        {
            public string dir, name;
            /// <summary>环心（世界 XZ，一般取游玩区中心）</summary>
            public Vector2 center;
            /// <summary>环脚（地平线）的世界 y；每圈都往下延到 baseY − 120，地形外缘怎么起伏都不会露缝</summary>
            public float baseY;
            /// <summary>剪影本色、受光的顶色（雪 / 台顶）、地平线色（= 雾色，环脚就是它）</summary>
            public Color silhouette, top, horizon;
            /// <summary>雪线（相对该圈平均高的比例）：SnowPeaks 高过它的峰顶戴雪</summary>
            public float snowLine = 0.6f;
            public BackdropRing[] rings;
            public int segments = 720;
            /// <summary>朝某个方向（度，0 = +X）压低一道缺口，露出下一张图的地标；NaN = 不开</summary>
            public float gapAngle = float.NaN, gapWidth = 24;
        }

        /// <summary>
        /// 各章默认远景：戈壁 = 近处沙丘 + 两圈赭红台地；冰原 = 近处岩脊 + 两圈雪峰；火狱 = 近处玄武岩脊 + 两圈火山锥。
        /// 地平线色取主题雾色。radius = 最近一圈的半径（要在雾的终点之外，玩家相机远裁面 1500 m 之内）。
        /// </summary>
        public static BackdropSpec BackdropFor(ShowcaseTheme theme, string dir, string name, Vector2 center, float baseY, float radius = 760, int seed = 1)
        {
            var s = new BackdropSpec { dir = dir, name = name, center = center, baseY = baseY, horizon = theme.fogColor };
            switch (theme.key)
            {
                case "Frost":
                    s.silhouette = new Color(0.40f, 0.46f, 0.57f);
                    s.top = new Color(0.93f, 0.96f, 1f);
                    s.snowLine = 0.55f;
                    s.rings = new[]
                    {
                        new BackdropRing { style = BackdropStyle.Ridges, radius = radius, height = 70, haze = 0.3f, freq = 11, seed = seed },
                        new BackdropRing { style = BackdropStyle.SnowPeaks, radius = radius + 200, height = 170, haze = 0.45f, freq = 8, seed = seed + 1 },
                        new BackdropRing { style = BackdropStyle.SnowPeaks, radius = radius + 400, height = 270, haze = 0.6f, freq = 6, seed = seed + 2 },
                    };
                    break;
                case "Inferno":
                    s.silhouette = new Color(0.12f, 0.07f, 0.09f);
                    s.top = new Color(0.26f, 0.13f, 0.12f);
                    s.rings = new[]
                    {
                        new BackdropRing { style = BackdropStyle.Ridges, radius = radius, height = 60, haze = 0.25f, freq = 13, seed = seed },
                        new BackdropRing { style = BackdropStyle.Volcanoes, radius = radius + 200, height = 150, haze = 0.4f, freq = 9, seed = seed + 1 },
                        new BackdropRing { style = BackdropStyle.Volcanoes, radius = radius + 400, height = 240, haze = 0.55f, freq = 6, seed = seed + 2 },
                    };
                    break;
                default:
                    s.silhouette = new Color(0.64f, 0.40f, 0.29f);
                    s.top = new Color(0.80f, 0.56f, 0.38f);
                    s.rings = new[]
                    {
                        new BackdropRing { style = BackdropStyle.Dunes, radius = radius, height = 38, haze = 0.35f, freq = 14, seed = seed },
                        new BackdropRing { style = BackdropStyle.Mesas, radius = radius + 200, height = 110, haze = 0.5f, freq = 9, seed = seed + 1 },
                        new BackdropRing { style = BackdropStyle.Mesas, radius = radius + 400, height = 165, haze = 0.65f, freq = 7, seed = seed + 2 },
                    };
                    break;
            }
            return s;
        }

        /// <summary>某圈在方位角 a（弧度）处的轮廓高（相对该圈平均高，0–约 1.2）</summary>
        static float BackdropProfile(BackdropStyle style, float a, float freq, int seed)
        {
            switch (style)
            {
                case BackdropStyle.Dunes:
                    return Mathf.Clamp(0.5f + 0.4f * Landform.Loop(a, freq, 3, seed) + 0.15f * Landform.Loop(a, freq * 3, 2, seed + 1), 0.12f, 1.1f);
                case BackdropStyle.Mesas:
                {
                    // 低矮的戈壁地平线上，一座座顶平壁陡的台地（各座高度不同，顶面只有轻微起伏）
                    float low = 0.16f + 0.1f * Landform.Loop(a, freq * 0.7f, 2, seed);
                    float m = Landform.Smooth(0.06f, 0.13f, Landform.Loop(a, freq, 3, seed + 3));
                    float level = 0.7f + 0.3f * Landform.Loop(a, freq * 0.4f, 2, seed + 5) + 0.03f * Landform.Loop(a, freq * 6, 2, seed + 7);
                    return Mathf.Lerp(low, level, m);
                }
                case BackdropStyle.Peaks:
                case BackdropStyle.SnowPeaks:
                    return 0.2f + 0.95f * Mathf.Pow(Landform.LoopRidged(a, freq, 4, seed), 1.6f);
                case BackdropStyle.Ridges:
                    return 0.3f + 0.55f * Landform.LoopRidged(a, freq * 1.5f, 4, seed) + 0.15f * Landform.Loop(a, freq * 0.5f, 2, seed + 2);
                default: // Volcanoes：几座孤立的锥（顶上一道火山口缺口）+ 低矮的熔岩台地
                {
                    float h = 0.15f + 0.12f * Landform.LoopRidged(a, freq * 2, 3, seed);
                    int cones = Mathf.Max(2, Mathf.RoundToInt(freq * 0.5f));
                    for (int i = 0; i < cones; i++)
                    {
                        float c = Landform.Hash(i, 1, seed) * 360f;
                        float w = (0.07f + 0.06f * Landform.Hash(i, 2, seed)) * Mathf.Rad2Deg;
                        float dd = Mathf.Abs(Mathf.DeltaAngle(a * Mathf.Rad2Deg, c)) / w;
                        if (dd >= 1) continue;
                        float ch = 0.6f + 0.6f * Landform.Hash(i, 3, seed);
                        float crater = ch * 0.1f * (1 - Landform.Smooth(0, 0.16f, dd));
                        h = Mathf.Max(h, Mathf.Min(ch * Mathf.Pow(1 - dd, 1.25f), ch * 0.9f) - crater);
                    }
                    return h;
                }
            }
        }

        static Color Linear(Color c) => QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;

        /// <summary>
        /// 远景环：每圈一条竖直的剪影带（segments 列 × 5 行），所有圈合成一个网格，用 Spiritfire/Backdrop（不受雾、不受光）。
        /// 每列自下而上：环脚两行是地平线色（= 雾色，与雾里的远地面无缝），往上渐变到雾化后的剪影色，峰顶是受光色或雪；
        /// 越远的一圈越高、越接近雾色（空气透视）。没有碰撞、不投影。返回远景物体。
        /// </summary>
        public static GameObject Backdrop(BackdropSpec s, Transform parent)
        {
            var verts = new List<Vector3>();
            var cols = new List<Color>();
            var tris = new List<int>();
            float[] rowFrac = { 0, 0.1f, 0.5f, 0.8f, 1f };
            int rows = rowFrac.Length, segs = Mathf.Max(32, s.segments);
            var horizon = Linear(s.horizon);
            foreach (var ring in s.rings)
            {
                int start = verts.Count;
                var hazed = Color.Lerp(Linear(s.silhouette), horizon, ring.haze);
                var lowHazed = Color.Lerp(Linear(s.silhouette), horizon, Mathf.Lerp(ring.haze, 1, 0.45f));
                var topHazed = Color.Lerp(Linear(s.top), horizon, ring.haze);
                for (int i = 0; i <= segs; i++)
                {
                    float a = i / (float)segs * Mathf.PI * 2;
                    float h01 = BackdropProfile(ring.style, a, ring.freq, ring.seed);
                    if (!float.IsNaN(s.gapAngle))
                        h01 *= Mathf.Lerp(0.12f, 1, Landform.Smooth(s.gapWidth * 0.5f, s.gapWidth, Mathf.Abs(Mathf.DeltaAngle(a * Mathf.Rad2Deg, s.gapAngle))));
                    float h = Mathf.Max(2, h01 * ring.height);
                    var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                    var xz = s.center + dir * ring.radius;
                    for (int r = 0; r < rows; r++)
                    {
                        float y = r == 0 ? s.baseY - 120 : s.baseY + h * rowFrac[r];
                        verts.Add(new Vector3(xz.x, y, xz.y));
                        float abs01 = rowFrac[r] * h01; // 该行相对本圈平均高的绝对高度
                        Color c = r switch
                        {
                            0 or 1 => horizon,
                            2 => lowHazed,
                            _ => ring.style == BackdropStyle.SnowPeaks
                                ? Color.Lerp(hazed, topHazed, Landform.Smooth(s.snowLine, s.snowLine + 0.08f, abs01))
                                : Color.Lerp(hazed, topHazed, r == rows - 1 ? 0.35f + 0.25f * Mathf.Clamp01(h01) : 0.1f),
                        };
                        cols.Add(c);
                    }
                }
                for (int i = 0; i < segs; i++)
                for (int r = 0; r + 1 < rows; r++)
                {
                    int a0 = start + i * rows + r, a1 = a0 + 1, b0 = a0 + rows, b1 = b0 + 1;
                    tris.AddRange(new[] { a0, b0, b1, a0, b1, a1 });
                }
            }
            var mesh = new Mesh { name = $"Backdrop_{s.name}", indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(verts);
            mesh.SetColors(cols);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            SaveAsset(mesh, $"{s.dir}/Backdrop_{s.name}.asset");

            var go = new GameObject("Backdrop");
            go.transform.SetParent(parent, false);
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = BackdropMaterial(s.dir, $"M_Backdrop_{s.name}", Color.white, true);
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.lightProbeUsage = LightProbeUsage.Off;
            mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return go;
        }

        static Material BackdropMaterial(string dir, string name, Color tint, bool vertexColor)
        {
            var shader = Shader.Find("Spiritfire/Backdrop");
            if (!shader)
            {
                Debug.LogWarning("[Level] 找不到 Spiritfire/Backdrop（A/Art/Shaders/SF_Backdrop.shader 还没导入？），远景先用 URP Unlit");
                shader = Shader.Find("Universal Render Pipeline/Unlit");
            }
            var m = new Material(shader) { name = name, enableInstancing = true };
            m.SetColor("_Tint", tint);
            m.SetFloat("_UseVertexColor", vertexColor ? 1 : 0);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", tint);
            SaveAsset(m, $"{dir}/{name}.mat");
            return m;
        }

        /// <summary>
        /// 远景地标剪影替身：把现成模型（巨像、雅丹舰队、炉塔…）摆到远处，换成剪影材质（雾化后的剪影色，不受雾、不受光、不投影），
        /// 拆掉碰撞——几百米外只读轮廓，比原材质被雾吞成一片强。haze 同远景环。
        /// </summary>
        public static GameObject BackdropImpostor(BackdropSpec s, string id, Transform parent, Vector3 pos, float yaw, float scale, float haze)
        {
            var go = ShowcaseSceneBuilder.Place(id, parent, pos, yaw, scale);
            if (!go) return null;
            PrefabUtility.UnpackPrefabInstance(go, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            go.name = $"{id} (Silhouette)";
            var tint = Color.Lerp(s.silhouette, s.horizon, haze);
            var mat = BackdropMaterial(s.dir, $"M_Silhouette_{s.name}_{Mathf.RoundToInt(haze * 100)}", tint, false);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                var ms = new Material[r.sharedMaterials.Length];
                for (int i = 0; i < ms.Length; i++) ms[i] = mat;
                r.sharedMaterials = ms;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            foreach (var c in go.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
            go.isStatic = true;
            return go;
        }

        /// <summary>
        /// 远景地面：地形矩形外的一圈平地（矩形洞 + 外沿 extent 米的正方形），世界 y，章节地面色、受光受雾——
        /// 雾终点之外就是雾色，和远景环的环脚接上。没有碰撞。地形外缘要落回这个高度（1-1 的做法：外缘 40 m 内渐变）。
        /// </summary>
        public static GameObject FarGround(string dir, string name, Transform parent, Rect terrain, float y, Color color, float extent = 3000)
        {
            var inner = new Rect(terrain.xMin + 0.5f, terrain.yMin + 0.5f, terrain.width - 1, terrain.height - 1);
            var c = inner.center;
            Vector3 V(float x, float z) => new(x, y, z);
            var verts = new[]
            {
                V(inner.xMin, inner.yMin), V(inner.xMax, inner.yMin), V(inner.xMax, inner.yMax), V(inner.xMin, inner.yMax),
                V(c.x - extent, c.y - extent), V(c.x + extent, c.y - extent), V(c.x + extent, c.y + extent), V(c.x - extent, c.y + extent),
            };
            // 四个梯形（内角 i、外角 i+4），从上往下看顺时针 = 朝上
            var tris = new List<int>();
            for (int i = 0; i < 4; i++)
            {
                int j = (i + 1) % 4;
                tris.AddRange(new[] { i, j + 4, i + 4, i, j, j + 4 });
            }
            var mesh = new Mesh { name = $"FarGround_{name}" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetNormals(new[] { Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up });
            mesh.RecalculateBounds();
            SaveAsset(mesh, $"{dir}/FarGround_{name}.asset");
            var go = new GameObject("Far Ground");
            go.transform.SetParent(parent, false);
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Mat(dir, $"FarGround_{name}", color);
            mr.shadowCastingMode = ShadowCastingMode.Off;
            return go;
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
    }
}
