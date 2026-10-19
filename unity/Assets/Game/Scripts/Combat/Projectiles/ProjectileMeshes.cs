using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 投射物外观用的程序网格（同 Three.js 版 ProjectileVisuals 的几何体约定，方便照抄缩放值）：
    ///   Sphere / SphereLow / Octa 半径 1；CylZ / CylZThin 半径 1、沿 Z 长 1、居中；ConeZ 底半径 1、尖端朝 +Z、长 1、居中；
    ///   Box 边长 1；Torus 主半径 1、管半径 0.22、在 XY 平面；Cross 两片正交面片（YZ 与 XZ，z ∈ [−0.5, 0.5]）。
    /// 每种只建一次、永不释放。三角形按给定的外法线自动定绕向（Unity 顺时针为正面）。
    /// </summary>
    public static class ProjectileMeshes
    {
        static Mesh sphere, sphereLow, octa, cylZ, cylZThin, coneZ, box, torus, cross;

        public static Mesh Sphere => sphere ? sphere : sphere = BuildSphere("PJ_Sphere", 12, 8);
        public static Mesh SphereLow => sphereLow ? sphereLow : sphereLow = BuildSphere("PJ_SphereLow", 8, 5);
        public static Mesh Octa => octa ? octa : octa = BuildOcta();
        public static Mesh CylZ => cylZ ? cylZ : cylZ = BuildCylZ("PJ_CylZ", 10);
        public static Mesh CylZThin => cylZThin ? cylZThin : cylZThin = BuildCylZ("PJ_CylZThin", 6);
        public static Mesh ConeZ => coneZ ? coneZ : coneZ = BuildConeZ(10);
        public static Mesh Box => box ? box : box = BuildBox();
        public static Mesh Torus => torus ? torus : torus = BuildTorus(18, 6, 0.22f);
        public static Mesh Cross => cross ? cross : cross = BuildCross();

        /// <summary>按三角形收集顶点（每个三角形独立顶点：平直着色，或按给定的逐顶点法线平滑）</summary>
        sealed class Builder
        {
            readonly List<Vector3> v = new();
            readonly List<Vector3> n = new();
            readonly List<int> t = new();

            /// <summary>三角形 abc，outward = 期望的外法线方向（决定绕向）；na/nb/nc = 平滑法线（null = 平直）</summary>
            public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 outward, Func<Vector3, Vector3> smooth = null)
            {
                var face = Vector3.Cross(b - a, c - a);
                if (Vector3.Dot(face, outward) < 0) (b, c) = (c, b);
                var flat = face.sqrMagnitude > 1e-12f ? Vector3.Cross(b - a, c - a).normalized : outward.normalized;
                int i = v.Count;
                v.Add(a);
                v.Add(b);
                v.Add(c);
                n.Add(smooth != null ? smooth(a) : flat);
                n.Add(smooth != null ? smooth(b) : flat);
                n.Add(smooth != null ? smooth(c) : flat);
                t.Add(i);
                t.Add(i + 1);
                t.Add(i + 2);
            }

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 outward, Func<Vector3, Vector3> smooth = null)
            {
                Tri(a, b, c, outward, smooth);
                Tri(a, c, d, outward, smooth);
            }

            public Mesh Build(string name)
            {
                var m = new Mesh { name = name, hideFlags = HideFlags.DontSave };
                m.SetVertices(v);
                m.SetNormals(n);
                // 白色顶点色：加色材质（粒子着色器）乘顶点色
                var white = new List<Color32>(v.Count);
                for (int i = 0; i < v.Count; i++) white.Add(new Color32(255, 255, 255, 255));
                m.SetColors(white);
                m.SetTriangles(t, 0);
                m.RecalculateBounds();
                return m;
            }
        }

        static Mesh BuildSphere(string name, int lon, int lat)
        {
            var b = new Builder();
            Vector3 P(int i, int j)
            {
                float th = Mathf.PI * j / lat, ph = 2 * Mathf.PI * i / lon;
                return new Vector3(Mathf.Sin(th) * Mathf.Cos(ph), Mathf.Cos(th), Mathf.Sin(th) * Mathf.Sin(ph));
            }
            for (int j = 0; j < lat; j++)
            for (int i = 0; i < lon; i++)
            {
                Vector3 a = P(i, j), c = P(i + 1, j), d = P(i + 1, j + 1), e = P(i, j + 1);
                var mid = (a + c + d + e).normalized;
                if (j > 0) b.Tri(a, c, d, mid, x => x.normalized);
                if (j < lat - 1) b.Tri(a, d, e, mid, x => x.normalized);
            }
            return b.Build(name);
        }

        static Mesh BuildOcta()
        {
            var b = new Builder();
            Vector3[] ax = { Vector3.right, Vector3.left };
            Vector3[] ay = { Vector3.up, Vector3.down };
            Vector3[] az = { Vector3.forward, Vector3.back };
            foreach (var x in ax)
            foreach (var y in ay)
            foreach (var z in az)
                b.Tri(x, y, z, x + y + z);
            return b.Build("PJ_Octa");
        }

        static Mesh BuildCylZ(string name, int seg)
        {
            var b = new Builder();
            for (int i = 0; i < seg; i++)
            {
                float a0 = 2 * Mathf.PI * i / seg, a1 = 2 * Mathf.PI * (i + 1) / seg;
                var p0 = new Vector3(Mathf.Cos(a0), Mathf.Sin(a0), 0);
                var p1 = new Vector3(Mathf.Cos(a1), Mathf.Sin(a1), 0);
                var h = new Vector3(0, 0, 0.5f);
                b.Quad(p0 - h, p1 - h, p1 + h, p0 + h, p0 + p1);
                b.Tri(h, p0 + h, p1 + h, Vector3.forward);
                b.Tri(-h, p1 - h, p0 - h, Vector3.back);
            }
            return b.Build(name);
        }

        static Mesh BuildConeZ(int seg)
        {
            var b = new Builder();
            var tip = new Vector3(0, 0, 0.5f);
            var baseC = new Vector3(0, 0, -0.5f);
            for (int i = 0; i < seg; i++)
            {
                float a0 = 2 * Mathf.PI * i / seg, a1 = 2 * Mathf.PI * (i + 1) / seg;
                var p0 = new Vector3(Mathf.Cos(a0), Mathf.Sin(a0), -0.5f);
                var p1 = new Vector3(Mathf.Cos(a1), Mathf.Sin(a1), -0.5f);
                var side = new Vector3(p0.x + p1.x, p0.y + p1.y, 0).normalized + Vector3.forward * 0.5f;
                b.Tri(tip, p0, p1, side);
                b.Tri(baseC, p1, p0, Vector3.back);
            }
            return b.Build("PJ_ConeZ");
        }

        static Mesh BuildBox()
        {
            var b = new Builder();
            for (int axis = 0; axis < 3; axis++)
            for (int sign = -1; sign <= 1; sign += 2)
            {
                var n = Vector3.zero;
                n[axis] = sign;
                var u = Vector3.zero;
                u[(axis + 1) % 3] = 0.5f;
                var w = Vector3.zero;
                w[(axis + 2) % 3] = 0.5f;
                var c = n * 0.5f;
                b.Quad(c - u - w, c + u - w, c + u + w, c - u + w, n);
            }
            return b.Build("PJ_Box");
        }

        static Mesh BuildTorus(int seg, int tube, float r)
        {
            var b = new Builder();
            Vector3 P(int i, int j)
            {
                float u = 2 * Mathf.PI * i / seg, w = 2 * Mathf.PI * j / tube;
                float k = 1 + r * Mathf.Cos(w);
                return new Vector3(k * Mathf.Cos(u), k * Mathf.Sin(u), r * Mathf.Sin(w));
            }
            Vector3 N(Vector3 p)
            {
                var ring = new Vector3(p.x, p.y, 0).normalized;
                return (p - ring).normalized;
            }
            for (int i = 0; i < seg; i++)
            for (int j = 0; j < tube; j++)
            {
                Vector3 a = P(i, j), c = P(i + 1, j), d = P(i + 1, j + 1), e = P(i, j + 1);
                var outward = N((a + c + d + e) * 0.25f);
                b.Tri(a, c, d, outward, N);
                b.Tri(a, d, e, outward, N);
            }
            return b.Build("PJ_Torus");
        }

        static Mesh BuildCross()
        {
            // 加色材质不剔背面：两片各一面即可
            var b = new Builder();
            b.Quad(new Vector3(0, -0.5f, -0.5f), new Vector3(0, 0.5f, -0.5f), new Vector3(0, 0.5f, 0.5f), new Vector3(0, -0.5f, 0.5f), Vector3.right);
            b.Quad(new Vector3(-0.5f, 0, -0.5f), new Vector3(0.5f, 0, -0.5f), new Vector3(0.5f, 0, 0.5f), new Vector3(-0.5f, 0, 0.5f), Vector3.up);
            return b.Build("PJ_Cross");
        }
    }
}
