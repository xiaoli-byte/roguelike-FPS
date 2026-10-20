using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 祭台用的程序网格与贴图（U6；Three.js src/ui/heroPreview/altar.ts、textures.ts 的几何体 / 符文贴图）：
    /// 低多边形八边形台层（平直着色：每个面单独的顶点）、八面体菱钉、平放的圆环、只有半圈的光柱壁、符文环贴图。
    /// 运行时现建（几毫秒），场景里不存网格 / 贴图资产（worktree 里不生成二进制资产，换图只改代码）。
    /// 绕序：按「期望朝向」自动选，三角形法线一律朝外（Unity 左手系顺时针为正面）。
    /// </summary>
    public static class StageMeshes
    {
        sealed class Builder
        {
            public readonly List<Vector3> v = new();
            public readonly List<Vector2> uv = new();
            public readonly List<int> t = new();

            /// <summary>一个三角形（不共用顶点：平直着色）；expected = 期望的朝外方向，绕序按它定</summary>
            public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 expected, Vector2 ua = default, Vector2 ub = default, Vector2 uc = default)
            {
                if (Vector3.Dot(Vector3.Cross(b - a, c - a), expected) < 0)
                {
                    (b, c) = (c, b);
                    (ub, uc) = (uc, ub);
                }
                int i = v.Count;
                v.Add(a);
                v.Add(b);
                v.Add(c);
                uv.Add(ua);
                uv.Add(ub);
                uv.Add(uc);
                t.Add(i);
                t.Add(i + 1);
                t.Add(i + 2);
            }

            public Mesh Mesh(string name, bool recalcNormals = true)
            {
                var m = new Mesh { name = name, hideFlags = HideFlags.DontSave };
                m.SetVertices(v);
                m.SetUVs(0, uv);
                m.SetTriangles(t, 0);
                if (recalcNormals) m.RecalculateNormals();
                else
                {
                    var n = new Vector3[v.Count];
                    for (int i = 0; i < n.Length; i++) n[i] = Vector3.up;
                    m.normals = n;
                }
                m.RecalculateBounds();
                return m;
            }
        }

        static Vector3 Ring(float r, float a, float y) => new(Mathf.Sin(a) * r, y, Mathf.Cos(a) * r);

        /// <summary>
        /// 台层（截锥）：上半径 / 下半径 / 高，顶面在 y = 0（往下长），sides 条棱（八边形 = 8），phase = 第一条棱的角度（弧度）；
        /// open = 不要顶盖（嵌线）。底面不封（看不到）
        /// </summary>
        public static Mesh Frustum(float rTop, float rBot, float height, int sides, float phase, bool open, string name)
        {
            var b = new Builder();
            float yt = 0, yb = -height;
            for (int i = 0; i < sides; i++)
            {
                float a0 = phase + i * Mathf.PI * 2 / sides, a1 = phase + (i + 1) * Mathf.PI * 2 / sides, am = (a0 + a1) * 0.5f;
                var outward = new Vector3(Mathf.Sin(am), 0, Mathf.Cos(am));
                Vector3 t0 = Ring(rTop, a0, yt), t1 = Ring(rTop, a1, yt), b0 = Ring(rBot, a0, yb), b1 = Ring(rBot, a1, yb);
                b.Tri(b0, t0, t1, outward);
                b.Tri(b0, t1, b1, outward);
                if (!open) b.Tri(new Vector3(0, yt, 0), t0, t1, Vector3.up);
            }
            return b.Mesh(name);
        }

        /// <summary>八面体（菱钉），半径 1</summary>
        public static Mesh Octahedron(string name)
        {
            var b = new Builder();
            var pts = new[] { Vector3.right, Vector3.left, Vector3.up, Vector3.down, Vector3.forward, Vector3.back };
            foreach (int y in new[] { 2, 3 })
            foreach (int x in new[] { 0, 1 })
            foreach (int z in new[] { 4, 5 })
                b.Tri(pts[x], pts[y], pts[z], pts[x] + pts[y] + pts[z]);
            return b.Mesh(name);
        }

        /// <summary>平放的圆环（法线朝上；uv 按 xz 平面铺 0–1）</summary>
        public static Mesh Annulus(float inner, float outer, int segments, string name)
        {
            var b = new Builder();
            for (int i = 0; i < segments; i++)
            {
                float a0 = i * Mathf.PI * 2 / segments, a1 = (i + 1) * Mathf.PI * 2 / segments;
                Vector3 i0 = Ring(inner, a0, 0), i1 = Ring(inner, a1, 0), o0 = Ring(outer, a0, 0), o1 = Ring(outer, a1, 0);
                b.Tri(i0, o0, o1, Vector3.up, Uv(i0, outer), Uv(o0, outer), Uv(o1, outer));
                b.Tri(i0, o1, i1, Vector3.up, Uv(i0, outer), Uv(o1, outer), Uv(i1, outer));
            }
            return b.Mesh(name, false);
        }

        static Vector2 Uv(Vector3 p, float r) => new(p.x / (2 * r) + 0.5f, p.z / (2 * r) + 0.5f);

        /// <summary>
        /// 光柱壁：一段圆柱侧面（下半径 / 上半径 / 高，从 y = 0 往上），只取 [from, to] 弧度这一段；uv.x 沿弧、uv.y 自下（0）而上（1）。
        /// 法线朝里（从柱外看是背面——光柱材质双面，法线只影响排序）
        /// </summary>
        public static Mesh Wall(float rBot, float rTop, float height, float from, float to, int segments, string name)
        {
            var b = new Builder();
            for (int i = 0; i < segments; i++)
            {
                float k0 = i / (float)segments, k1 = (i + 1) / (float)segments;
                float a0 = Mathf.Lerp(from, to, k0), a1 = Mathf.Lerp(from, to, k1), am = (a0 + a1) * 0.5f;
                var inward = -new Vector3(Mathf.Sin(am), 0, Mathf.Cos(am));
                Vector3 b0 = Ring(rBot, a0, 0), b1 = Ring(rBot, a1, 0), t0 = Ring(rTop, a0, height), t1 = Ring(rTop, a1, height);
                b.Tri(b0, t0, t1, inward, new Vector2(k0, 0), new Vector2(k0, 1), new Vector2(k1, 1));
                b.Tri(b0, t1, b1, inward, new Vector2(k0, 0), new Vector2(k1, 1), new Vector2(k1, 0));
            }
            return b.Mesh(name);
        }

        /// <summary>平放的方片（法线朝上，uv 0–1），边长 size</summary>
        public static Mesh FlatQuad(float size, string name)
        {
            var b = new Builder();
            float h = size * 0.5f;
            Vector3 p00 = new(-h, 0, -h), p10 = new(h, 0, -h), p01 = new(-h, 0, h), p11 = new(h, 0, h);
            b.Tri(p00, p01, p11, Vector3.up, new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1));
            b.Tri(p00, p11, p10, Vector3.up, new Vector2(0, 0), new Vector2(1, 1), new Vector2(1, 0));
            return b.Mesh(name, false);
        }

        // ───────────── 贴图 ─────────────

        static Texture2D rune;

        /// <summary>
        /// 符文环（白 + alpha，按英雄色上色）：外圈两道细环、外环带里 24 格程序「符文」（短竖、横、点按格子哈希组合）、
        /// 中圈 36 道刻度、内圈 12 颗点和一道细环。256 × 256
        /// </summary>
        public static Texture2D Rune
        {
            get
            {
                if (rune) return rune;
                const int n = 256;
                var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { name = "Stage Rune", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Trilinear, anisoLevel = 4, hideFlags = HideFlags.HideAndDontSave };
                var px = new Color32[n * n];
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x + 0.5f) / n * 2 - 1, dy = (y + 0.5f) / n * 2 - 1;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    float th = Mathf.Atan2(dy, dx);
                    if (th < 0) th += Mathf.PI * 2;
                    float a = 0;
                    a = Mathf.Max(a, Line(r, 0.955f, 0.011f));
                    a = Mathf.Max(a, Line(r, 0.80f, 0.008f));
                    a = Mathf.Max(a, Line(r, 0.56f, 0.009f) * 0.85f);
                    a = Mathf.Max(a, Line(r, 0.46f, 0.006f) * 0.6f);
                    // 外环带的符文：24 格，每格按哈希选笔画
                    if (r > 0.82f && r < 0.935f)
                    {
                        const int cells = 24;
                        float u = th / (Mathf.PI * 2) * cells;
                        int cell = Mathf.FloorToInt(u);
                        float cu = u - cell, cr = (r - 0.82f) / 0.115f;
                        uint h = Hash((uint)cell * 2654435761u + 17u);
                        float g = 0;
                        if ((h & 1) != 0) g = Mathf.Max(g, Box(cu, cr, 0.5f, 0.5f, 0.06f, 0.36f));
                        if ((h & 2) != 0) g = Mathf.Max(g, Box(cu, cr, 0.5f, 0.78f, 0.28f, 0.05f));
                        if ((h & 4) != 0) g = Mathf.Max(g, Box(cu, cr, 0.5f, 0.24f, 0.28f, 0.05f));
                        if ((h & 8) != 0) g = Mathf.Max(g, Box(cu, cr, 0.28f, 0.5f, 0.05f, 0.22f));
                        if ((h & 16) != 0) g = Mathf.Max(g, Box(cu, cr, 0.72f, 0.5f, 0.05f, 0.22f));
                        if ((h & 96) == 96) g = Mathf.Max(g, Box(cu, cr, 0.5f, 0.5f, 0.09f, 0.09f));
                        if (g == 0) g = Box(cu, cr, 0.5f, 0.5f, 0.08f, 0.08f);
                        a = Mathf.Max(a, g * 0.9f);
                    }
                    // 刻度
                    if (r > 0.6f && r < 0.68f)
                    {
                        float u = th / (Mathf.PI * 2) * 36;
                        float d = Mathf.Abs(u - Mathf.Round(u));
                        a = Mathf.Max(a, Mathf.Clamp01(1 - d / 0.07f) * 0.75f);
                    }
                    // 点
                    if (r > 0.68f && r < 0.76f)
                    {
                        float u = th / (Mathf.PI * 2) * 12;
                        float cu = (u - Mathf.Floor(u) - 0.5f) * (Mathf.PI * 2 * 0.72f / 12);
                        float cr = r - 0.72f;
                        float dd = Mathf.Sqrt(cu * cu + cr * cr);
                        a = Mathf.Max(a, Mathf.Clamp01(1 - dd / 0.022f) * 0.8f);
                    }
                    if (r > 0.99f) a = 0;
                    px[y * n + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(a) * 255));
                }
                tex.SetPixels32(px);
                tex.Apply(true, true);
                return rune = tex;
            }
        }

        static float Line(float r, float c, float w) => Mathf.Clamp01(1 - Mathf.Abs(r - c) / w);

        static float Box(float x, float y, float cx, float cy, float hw, float hh)
        {
            float dx = Mathf.Abs(x - cx) - hw, dy = Mathf.Abs(y - cy) - hh;
            float d = Mathf.Max(dx, dy);
            return Mathf.Clamp01(1 - d / 0.04f) * (d < 0.04f ? 1 : 0);
        }

        static uint Hash(uint x)
        {
            x ^= x >> 16;
            x *= 0x7feb352d;
            x ^= x >> 15;
            x *= 0x846ca68b;
            x ^= x >> 16;
            return x;
        }
    }
}
