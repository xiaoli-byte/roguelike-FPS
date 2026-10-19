using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 边界：游玩区遮罩的等值线 → 一圈不可见的碰撞面（视觉边界由地形给）。归 L3。
    public static partial class LevelKit
    {
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
    }
}
