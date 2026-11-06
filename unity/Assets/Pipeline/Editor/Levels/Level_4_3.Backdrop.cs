using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // 彩林海子 · 远景：谷口里的积雪尖峰群、左边一座大雪山、右后方的雪峰，外加一圈远山把地平线围满（顶点色烘光照与空气透视，不受光、不受雾）
    public static partial class Level_4_3
    {
        /// <summary>一座远景山：位置（世界 XZ）、高（山脚以上）、底半径、主山脊数、尖锐度、雪线（占高）、下半截林带比例、种子</summary>
        struct Peak
        {
            public Vector2 at;
            public float height, radius, sharp, snow, forest, seed;
            public int ridges;
        }

        /// <summary>谷口主峰（从出生点看正好在 V 形谷口里）</summary>
        static readonly Vector2 MainPeak = new(-170, 1240);

        static readonly Peak[] Peaks =
        {
            // 谷口雪峰群：主峰尖、左右两座陪峰（snow = 雪线占高的比例：越小雪越多）
            new() { at = MainPeak, height = 930, radius = 600, sharp = 1.9f, snow = 0.36f, forest = 0.18f, seed = 3.1f, ridges = 4 },
            new() { at = new(60, 1160), height = 740, radius = 470, sharp = 1.7f, snow = 0.38f, forest = 0.2f, seed = 4.7f, ridges = 3 },
            new() { at = new(-390, 1190), height = 700, radius = 500, sharp = 1.6f, snow = 0.4f, forest = 0.22f, seed = 6.2f, ridges = 4 },
            // 左边（西北）的大雪山：离得近、占画面左边一大块，下半截深色林带
            new() { at = new(-880, 780), height = 1020, radius = 760, sharp = 1.45f, snow = 0.42f, forest = 0.3f, seed = 8.4f, ridges = 4 },
            // 右后方（东北）的雪峰，大半被东岸大山挡住
            new() { at = new(620, 1120), height = 780, radius = 600, sharp = 1.6f, snow = 0.42f, forest = 0.22f, seed = 9.9f, ridges = 3 },
            // 身后（南）和两侧的远山，补满地平线
            new() { at = new(-1050, -300), height = 600, radius = 680, sharp = 1.3f, snow = 0.55f, forest = 0.4f, seed = 12.3f, ridges = 4 },
            new() { at = new(1080, -150), height = 640, radius = 680, sharp = 1.3f, snow = 0.52f, forest = 0.4f, seed = 13.8f, ridges = 4 },
            new() { at = new(-300, -1150), height = 500, radius = 720, sharp = 1.2f, snow = 0.62f, forest = 0.55f, seed = 15.1f, ridges = 5 },
            new() { at = new(450, -1100), height = 540, radius = 700, sharp = 1.25f, snow = 0.6f, forest = 0.5f, seed = 16.6f, ridges = 4 },
        };

        /// <summary>远山山脚的世界 y：统一埋到地面以下（山脚裙边要是比谷底高，会像一条彩带浮在半空）</summary>
        const float PeakBaseY = -60;

        static readonly Color GraniteLight = new(0.6f, 0.6f, 0.62f), GraniteDark = new(0.34f, 0.35f, 0.38f), SnowLit = new(0.97f, 0.98f, 1f),
            SnowShade = new(0.8f, 0.86f, 0.94f), ForestDark = new(0.1f, 0.19f, 0.13f), ForestGold = new(0.78f, 0.54f, 0.15f);

        /// <summary>远山上色：花岗岩（暗缝）→ 雪线以上积雪（陡面挂不住，露出岩脊）→ 下半截林带（墨绿夹金黄斑块）</summary>
        static Color PeakColor(float y, float slope, float snowLine, float forestLine, float n, float n2)
        {
            var c = Color.Lerp(GraniteLight, GraniteDark, Mathf.Clamp01(n * 1.3f - 0.15f));
            // 雪：雪线以上铺满，陡面只挂一部分；岩脊（噪声高处）在陡面上露出一道道暗肋
            float rib = S(0.62f, 0.74f, n2) * S(0.85f, 1.15f, slope);
            float snow = S(snowLine - 40, snowLine + 30, y + (n2 - 0.5f) * 140) * (1 - S(1.05f, 1.4f, slope) * 0.6f) * (1 - rib * 0.85f);
            c = Color.Lerp(c, slope > 0.85f ? SnowShade : SnowLit, snow);
            float forest = (1 - S(forestLine - 30, forestLine + 20, y + (n - 0.5f) * 60)) * (1 - S(0.8f, 1.05f, slope));
            var fc = Color.Lerp(ForestDark, ForestGold, S(0.55f, 0.72f, n2) * 0.8f);
            return Color.Lerp(c, fc, forest);
        }

        /// <summary>顶点色的光照与空气透视（同 LevelKit 远山）：朝光面亮、背光面压成冷暗色，按离出生点的距离往地平线色混</summary>
        static Color ShadeBackdrop(Color albedo, Vector3 normal, Vector3 toSun, float dist, Color horizon)
        {
            float lambert = Mathf.Clamp01(Vector3.Dot(normal, toSun));
            float lit = S(-0.05f, 0.25f, lambert);
            var c = albedo * (0.5f + 0.62f * lit);
            c = Color.Lerp(c, new Color(c.r * 0.78f, c.g * 0.86f, c.b * 1.12f), 1 - lit);
            float haze = S(700, 2200, dist) * 0.4f;
            c = Color.Lerp(c, horizon, haze);
            c.a = 1;
            return Lin(c);
        }

        static void BuildBackdrop(Transform env, Vector3 toSun, Color horizon)
        {
            var root = new GameObject("Backdrop · 远山").transform;
            root.SetParent(env, false);
            var mat = new Material(Shader.Find("Spiritfire/Backdrop")) { name = $"M_{Name}_Backdrop", enableInstancing = false };
            mat.SetColor("_Tint", Color.white);
            mat.SetFloat("_UseVertexColor", 1);
            LevelKit.SaveAsset(mat, $"{Dir}/M_{Name}_Backdrop.mat");
            var eye = new Vector2(spawnAt.x, spawnAt.z);
            int index = 0;
            foreach (var o in Peaks)
            {
                const int rings = 64, segs = 160;
                const float baseY = PeakBaseY;
                var v = new List<Vector3>();
                var col = new List<Color>();
                var t = new List<int>();
                float HAt(float tt, float a)
                {
                    float ridge = Mathf.Pow(Mathf.Abs(Mathf.Cos(a * o.ridges / 2 + o.seed)), 0.55f);
                    float k = Mathf.Min(1, tt * 3);
                    float prof = Mathf.Pow(Mathf.Max(0, 1 - tt), o.sharp) * (1 - 0.32f * (1 - ridge) * k);
                    float nx = Mathf.Cos(a) * tt * 3.2f + o.seed, nz = Mathf.Sin(a) * tt * 3.2f - o.seed;
                    float jag = Ridged(nx, nz, 5, (int)(o.seed * 10)) - 0.45f;
                    float fine = Ridged(nx * 3.1f, nz * 3.1f, 3, (int)(o.seed * 10) + 7) - 0.45f;
                    return o.height * prof * (1 + (0.42f * jag + 0.16f * fine) * k);
                }
                for (int r = 0; r <= rings; r++)
                {
                    float tt = Mathf.Pow(r / (float)rings, 1.15f);
                    float tn = Mathf.Pow(Mathf.Min(1, (r + 1) / (float)rings), 1.15f);
                    for (int s = 0; s < segs; s++)
                    {
                        float a = s / (float)segs * Mathf.PI * 2;
                        float y = HAt(tt, a);
                        var p = new Vector3(o.at.x + Mathf.Cos(a) * o.radius * tt, baseY + y, o.at.y + Mathf.Sin(a) * o.radius * tt);
                        v.Add(p);
                        float y2 = HAt(tn, a);
                        float slope = Mathf.Atan(Mathf.Abs(y - y2) / Mathf.Max(1, o.radius * (tn - tt)));
                        float n1 = Fbm(Mathf.Cos(a) * 5 * tt + o.seed, Mathf.Sin(a) * 5 * tt, 3, 801);
                        float n2 = Fbm(Mathf.Cos(a) * 9 * tt - o.seed, Mathf.Sin(a) * 9 * tt + 2, 3, 803);
                        col.Add(PeakColor(y, slope, o.height * o.snow, o.height * o.forest, n1, n2));
                    }
                }
                for (int r = 0; r < rings; r++)
                for (int s = 0; s < segs; s++)
                {
                    int a = r * segs + s, b = r * segs + (s + 1) % segs, cc = (r + 1) * segs + (s + 1) % segs, d = (r + 1) * segs + s;
                    t.AddRange(new[] { a, b, d, b, cc, d });
                }
                ShadeMesh(v, col, t, eye, toSun, horizon);
                MeshObject($"{Name}_Peak{index++}", root, v, col, t, mat);
            }
            BuildRing(root, mat, eye, toSun, horizon);
        }

        /// <summary>一圈远山（环心 = 地形中心，半径 1080–1420 m，相机远裁面 1500 m 以内）：北边高、带雪，南边低、林带多</summary>
        static void BuildRing(Transform root, Material mat, Vector2 eye, Vector3 toSun, Color horizon)
        {
            const int segs = 360, rows = 12;
            const float r0 = 1080, r1 = 1420;
            var v = new List<Vector3>();
            var col = new List<Color>();
            var t = new List<int>();
            float HAt(float a, float tt)
            {
                float north = Mathf.Max(0, Mathf.Sin(a));
                float amp = 220 + 330 * north;
                float n = Ridged(Mathf.Cos(a) * 7 + tt * 2, Mathf.Sin(a) * 7 + tt * 2, 5, 811);
                float swell = Mathf.Sin(tt * Mathf.PI) * 0.7f + tt * 0.4f;
                return amp * n * swell + 30 * Fbm(a * 9, tt * 5, 3, 813) - 40;
            }
            for (int r = 0; r <= rows; r++)
            {
                float tt = r / (float)rows;
                float R = Mathf.Lerp(r0, r1, Mathf.Pow(tt, 1.2f));
                for (int s = 0; s < segs; s++)
                {
                    float a = s / (float)segs * Mathf.PI * 2;
                    float y = HAt(a, tt);
                    v.Add(new Vector3(Mathf.Cos(a) * R, y, Mathf.Sin(a) * R));
                    float slope = Mathf.Atan(Mathf.Abs(y - HAt(a + 0.02f, tt)) / (R * 0.02f));
                    float north = Mathf.Max(0, Mathf.Sin(a));
                    col.Add(PeakColor(y, slope, 330 - 120 * north, 260, Fbm(a * 8, tt * 3, 2, 815), Fbm(a * 15, tt * 6, 2, 817)));
                }
            }
            for (int r = 0; r < rows; r++)
            for (int s = 0; s < segs; s++)
            {
                int a = r * segs + s, b = r * segs + (s + 1) % segs, cc = (r + 1) * segs + (s + 1) % segs, d = (r + 1) * segs + s;
                t.AddRange(new[] { a, d, b, b, d, cc });
            }
            ShadeMesh(v, col, t, eye, toSun, horizon);
            MeshObject($"{Name}_Ring", root, v, col, t, mat);
        }

        static void ShadeMesh(List<Vector3> v, List<Color> col, List<int> t, Vector2 eye, Vector3 toSun, Color horizon)
        {
            var nrm = new Vector3[v.Count];
            for (int i = 0; i < t.Count; i += 3)
            {
                var n = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                if (n.y < 0) n = -n;
                nrm[t[i]] += n;
                nrm[t[i + 1]] += n;
                nrm[t[i + 2]] += n;
            }
            for (int i = 0; i < v.Count; i++)
            {
                var n = nrm[i].sqrMagnitude > 1e-8f ? nrm[i].normalized : Vector3.up;
                float d = Vector2.Distance(new Vector2(v[i].x, v[i].z), eye);
                col[i] = ShadeBackdrop(col[i], n, toSun, d, horizon);
            }
        }

        static void MeshObject(string name, Transform parent, List<Vector3> v, List<Color> c, List<int> t, Material mat)
        {
            var mesh = new Mesh { name = name, indexFormat = v.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(v);
            mesh.SetColors(c);
            mesh.SetTriangles(t, 0);
            mesh.RecalculateBounds();
            LevelKit.SaveAsset(mesh, $"{Dir}/{name}.asset");
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.lightProbeUsage = LightProbeUsage.Off;
            mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
        }
    }
}
