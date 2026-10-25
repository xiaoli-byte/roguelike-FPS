using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// FX3 程序化冰的网格（SF_FxIce 用）：全部平直着色——每个三角形三个独立顶点，法线取面法线，顶点色 rgb = 重心坐标（着色器画棱边），
    /// uv.y = 归一化高度（0 底、1 顶，着色器按它「从下往上冻」）。确定性（哈希抖动，不用随机数），第一次用时建、全场共用。
    ///   <see cref="Shell"/>：霜甲壳——底在 y = 0、顶在 y = 1、水平半径 1 的多面冰壳（细分一次的二十面体，顶点径向抖动），上半身斜插七根小冰晶；
    ///   <see cref="Spike"/>：冰刺——底面半径 1、高 1 的五棱锥（底在原点，尖朝 +y）。
    /// </summary>
    public static class FxIceMeshes
    {
        static Mesh shell, spike;

        public static Mesh Shell => shell ? shell : shell = BuildShell();
        public static Mesh Spike => spike ? spike : spike = BuildSpike();

        static float Hash(int i, int seed)
        {
            unchecked
            {
                uint h = (uint)(i * 374761393 + seed * 668265263);
                h = (h ^ (h >> 13)) * 1274126177u;
                h ^= h >> 16;
                return (h & 0xFFFFFF) / 16777215f;
            }
        }

        static Mesh BuildShell()
        {
            // 二十面体
            float t = (1 + Mathf.Sqrt(5)) / 2;
            var v = new List<Vector3>
            {
                new(-1, t, 0), new(1, t, 0), new(-1, -t, 0), new(1, -t, 0), new(0, -1, t), new(0, 1, t), new(0, -1, -t), new(0, 1, -t),
                new(t, 0, -1), new(t, 0, 1), new(-t, 0, -1), new(-t, 0, 1),
            };
            for (int i = 0; i < v.Count; i++) v[i] = v[i].normalized;
            var f = new List<int>
            {
                0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
                3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
            };
            // 细分一次（中点缓存，共享顶点才能一起抖动、不裂缝）
            var mid = new Dictionary<long, int>();
            int Mid(int a, int b)
            {
                long key = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                if (mid.TryGetValue(key, out int m)) return m;
                v.Add(((v[a] + v[b]) * 0.5f).normalized);
                mid[key] = v.Count - 1;
                return v.Count - 1;
            }
            var f2 = new List<int>();
            for (int i = 0; i < f.Count; i += 3)
            {
                int a = f[i], b = f[i + 1], c = f[i + 2];
                int ab = Mid(a, b), bc = Mid(b, c), ca = Mid(c, a);
                f2.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
            }
            // 径向抖动 + 压成「底 0、顶 1、半径 1」：y 从 [-1, 1] 映射到 [0, 1]，最底下一点点压平（贴地）
            var p = new Vector3[v.Count];
            for (int i = 0; i < v.Count; i++)
            {
                float k = 0.86f + 0.22f * Hash(i, 7);
                var q = v[i] * k;
                p[i] = new Vector3(q.x, Mathf.Max(0.02f, (q.y + 1) * 0.5f), q.z);
            }
            var tris = new List<Vector3>(f2.Count + 7 * 15);
            var center = new Vector3(0, 0.5f, 0);
            for (int i = 0; i < f2.Count; i += 3)
            {
                // Unity：cross(b − a, c − a) 指向的那一面是正面——统一翻成朝外
                Vector3 a = p[f2[i]], b = p[f2[i + 1]], c = p[f2[i + 2]];
                if (Vector3.Dot(Vector3.Cross(b - a, c - a), (a + b + c) / 3f - center) < 0) (b, c) = (c, b);
                tris.Add(a);
                tris.Add(b);
                tris.Add(c);
            }
            // 上半身斜插几根小冰晶（五棱锥），从壳面往外顶出来
            for (int c = 0; c < 7; c++)
            {
                float az = c * 2.399f + Hash(c, 11) * 0.6f;
                float el = Mathf.Lerp(0.15f, 0.95f, Hash(c, 13));
                var dir = new Vector3(Mathf.Cos(az) * Mathf.Cos(el), Mathf.Sin(el), Mathf.Sin(az) * Mathf.Cos(el));
                var root = new Vector3(dir.x * 0.9f, (dir.y * 0.9f + 1) * 0.5f, dir.z * 0.9f);
                var axis = new Vector3(dir.x, dir.y * 0.5f + 0.25f, dir.z).normalized;
                AddCone(tris, root, axis, 0.09f + 0.05f * Hash(c, 17), 0.32f + 0.18f * Hash(c, 19), 5, c * 1.3f, false);
            }
            return Flat(tris, "FxIce Shell");
        }

        static Mesh BuildSpike()
        {
            var tris = new List<Vector3>(15);
            AddCone(tris, Vector3.zero, Vector3.up, 1f, 1f, 5, 0.3f, false);
            return Flat(tris, "FxIce Spike");
        }

        /// <summary>n 棱锥：底面中心 root、沿 axis 高 height、底半径 radius（cap = 封底）</summary>
        static void AddCone(List<Vector3> tris, Vector3 root, Vector3 axis, float radius, float height, int n, float twist, bool cap)
        {
            var rot = Quaternion.FromToRotation(Vector3.up, axis.normalized);
            var tip = root + axis.normalized * height;
            for (int i = 0; i < n; i++)
            {
                float a0 = twist + i * Mathf.PI * 2 / n, a1 = twist + (i + 1) * Mathf.PI * 2 / n;
                var b0 = root + rot * new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)) * radius;
                var b1 = root + rot * new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1)) * radius;
                tris.Add(b0);
                tris.Add(tip);
                tris.Add(b1);
                if (!cap) continue;
                tris.Add(root);
                tris.Add(b0);
                tris.Add(b1);
            }
        }

        /// <summary>三角形表 → 平直着色网格（面法线、重心坐标顶点色、归一化高度 uv.y）</summary>
        static Mesh Flat(List<Vector3> tris, string name)
        {
            float minY = float.MaxValue, maxY = float.MinValue;
            foreach (var q in tris)
            {
                minY = Mathf.Min(minY, q.y);
                maxY = Mathf.Max(maxY, q.y);
            }
            float span = Mathf.Max(1e-4f, maxY - minY);
            int n = tris.Count;
            var pos = new Vector3[n];
            var nrm = new Vector3[n];
            var col = new Color32[n];
            var uv = new Vector2[n];
            var idx = new int[n];
            var bary = new[] { new Color32(255, 0, 0, 255), new Color32(0, 255, 0, 255), new Color32(0, 0, 255, 255) };
            for (int i = 0; i < n; i += 3)
            {
                var fn = Vector3.Cross(tris[i + 1] - tris[i], tris[i + 2] - tris[i]).normalized;
                for (int k = 0; k < 3; k++)
                {
                    pos[i + k] = tris[i + k];
                    nrm[i + k] = fn;
                    col[i + k] = bary[k];
                    uv[i + k] = new Vector2(k * 0.5f, (tris[i + k].y - minY) / span);
                    idx[i + k] = i + k;
                }
            }
            var m = new Mesh { name = name };
            m.vertices = pos;
            m.normals = nrm;
            m.colors32 = col;
            m.uv = uv;
            m.triangles = idx;
            m.RecalculateBounds();
            m.UploadMeshData(true);
            return m;
        }
    }
}
