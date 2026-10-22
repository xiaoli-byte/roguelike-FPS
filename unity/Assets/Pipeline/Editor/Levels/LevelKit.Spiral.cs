using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 螺旋井（M32 3-2 铸神井新增；吊链 3-3 悬炉、3-4 吊鼎也能用）：
    //   1. 鹦鹉螺式螺旋岩台（SpiralWell*）：井壁是一圈圈「岩台 + 陡坎」，岩台随方位角连续下降，每绕一圈正好降一级。
    //      和 HeightField.SpiralCrater（圆形坑口、首圈从 0 宽展开、坑外是平地）不同：这里最上一圈从开端起就是整宽，
    //      外沿跟着螺旋一路往里收（r = 开端外沿 − 周期 × 圈数），外沿以外就是火山口内壁——没有「坑外地面」，边界就是岩壁。
    //      开端处有一道径向的「接缝」：缝的一侧是最上一圈的开端（井口栈台），另一侧是绕了一圈回来、低一级的岩台上方的岩壁。
    //   2. 井壁衬里（WellLining）：地形洞没有侧面，洞口一圈竖直的岩壁网格（双面），从地面下一点一直伸到熔岩面以下。
    //   3. 吊链（Chain）：SM_Prop_InfernoChainLink 链环按节距 0.68 m、每隔一节转 90° 沿下垂的曲线排开，合并成一个网格
    //      （unity-parity 第 6 节「链条程序生成」）；没有链环 Prefab 时退回一根细圆柱（占位，验收会列出来）。
    public static partial class LevelKit
    {
        /// <summary>鹦鹉螺式螺旋岩台的布局（关卡坐标 = 世界 XZ，高度相对井底）</summary>
        public struct SpiralWellSpec
        {
            public Vector2 center;
            /// <summary>开端方位（度，0 = +X）；螺旋沿方位角增大的方向（从上往下看逆时针）下行</summary>
            public float startAngle;
            /// <summary>每圈下降（米）、从开端到井底一共绕几圈（可以不是整数）</summary>
            public float step, turns;
            /// <summary>岩台宽、陡坎水平宽（米）</summary>
            public float ledge, riser;
            /// <summary>开端处最上一圈岩台的内缘半径（米）</summary>
            public float startRadius;
            /// <summary>陡坎线的噪声摆动（米）与种子：岩台内缘不是一条正圆弧</summary>
            public float wobble;
            public int seed;

            /// <summary>井深 = 开端岩台高出井底多少</summary>
            public readonly float Depth => step * turns;
            /// <summary>一圈岩台 + 陡坎的径向宽（每绕一圈往里收这么多）</summary>
            public readonly float Period => ledge + riser;
        }

        /// <summary>螺旋上一点的采样</summary>
        public struct SpiralWellSample
        {
            /// <summary>所在那一圈的展开圈数 t（0 = 开端，turns = 井底）；外沿以外为负</summary>
            public float turn;
            /// <summary>陡坎遮罩：0 = 岩台面，1 = 陡坎（上沿到坡脚）</summary>
            public float riser;
            /// <summary>到螺旋外沿（含开端接缝）的有符号距离：界内为正（米）</summary>
            public float inside;
        }

        /// <summary>方位分数 φ ∈ [0, 1)：从开端方位起沿下行方向绕了几分之一圈</summary>
        public static float SpiralPhi(in SpiralWellSpec s, Vector2 p)
        {
            var d = p - s.center;
            float a = Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg;
            return Mathf.Repeat((a - s.startAngle) / 360f, 1f);
        }

        /// <summary>展开圈数 t 处岩台面高度（相对井底，已截到 ≥ 0：t ≥ turns 是井底）</summary>
        public static float SpiralLevel(in SpiralWellSpec s, float t) => Mathf.Max(0, s.Depth - s.step * t);

        /// <summary>展开圈数 t 处岩台内缘（陡坎上沿）半径</summary>
        public static float SpiralInner(in SpiralWellSpec s, float t) => s.startRadius - s.Period * t;

        /// <summary>方位 φ 处螺旋外沿（最上一圈岩台的外缘 = 内壁坡脚）半径</summary>
        public static float SpiralOuter(in SpiralWellSpec s, float phi) => s.startRadius + s.ledge - s.Period * phi;

        /// <summary>方位分数 φ（可以超出 0–1：按圈数展开）、半径 r 处的世界 XZ</summary>
        public static Vector2 SpiralPoint(in SpiralWellSpec s, float phi, float r)
        {
            float a = (s.startAngle + 360f * phi) * Mathf.Deg2Rad;
            return s.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * r;
        }

        /// <summary>φ 处的径向（朝外）单位向量</summary>
        public static Vector2 SpiralRadial(in SpiralWellSpec s, float phi)
        {
            float a = (s.startAngle + 360f * phi) * Mathf.Deg2Rad;
            return new Vector2(Mathf.Cos(a), Mathf.Sin(a));
        }

        /// <summary>φ 处的切向（螺旋下行方向）单位向量</summary>
        public static Vector2 SpiralTangent(in SpiralWellSpec s, float phi)
        {
            float a = (s.startAngle + 360f * phi) * Mathf.Deg2Rad;
            return new Vector2(-Mathf.Sin(a), Mathf.Cos(a));
        }

        /// <summary>
        /// 螺旋岩台高度（相对井底，≥ 0）：r 先按 wobble 摆一下，再看落在哪一圈——岩台面是该圈的高度，陡坎按 smoothstep 从上沿落到下一圈；
        /// 低于 0 的部分截平成井底。外沿以外（o.inside &lt; 0）返回最上一圈的高度，岩壁由调用方叠上去（各关的内壁高、坡面不同）。
        /// calm（0–1）压掉 wobble：升降台、熔瀑、眺台这些要和摆件对齐的地方陡坎线不摆。
        /// </summary>
        public static float SpiralWell(Vector2 p, in SpiralWellSpec s, out SpiralWellSample o, float calm = 0)
        {
            o = default;
            var d = p - s.center;
            float r = d.magnitude;
            if (s.wobble > 0) r += Landform.Fbm(p, 25f, 2, s.seed) * s.wobble * (1 - Mathf.Clamp01(calm));
            float phi = SpiralPhi(s, p);
            float P = Mathf.Max(0.01f, s.Period);
            float w = (s.startRadius + s.ledge - r) / P - phi;
            float n = Mathf.Floor(w), fr = w - n;
            float t = phi + n;
            o.turn = t;
            o.inside = SpiralInside(s, p);
            float lv = s.Depth - s.step * t;
            float ledgeFrac = s.ledge / P;
            float h;
            if (n < 0)
            {
                // 外沿以外：最上一圈在这个方位的高度（岩壁的坡脚）
                h = s.Depth - s.step * phi;
                o.riser = 0;
            }
            else if (fr < ledgeFrac)
            {
                h = lv;
                o.riser = 0;
            }
            else
            {
                float x = (fr - ledgeFrac) / Mathf.Max(0.01f, s.riser / P);
                h = lv - s.step * Landform.Smooth(0, 1, x);
                // 井底那一圈的陡坎只有岩台本身那么高（下面截平了）：矮于 0.5 m 的不算陡坎
                o.riser = lv > 0.5f ? 1 : 0;
            }
            return Mathf.Max(0, h);
        }

        /// <summary>
        /// 到螺旋外沿的有符号距离（界内为正，米）：外沿是 r = SpiralOuter(φ)；开端接缝处，外沿以外、开端最上一圈半径范围内的点
        /// 隔着接缝就是开端岩台，所以取切向距离（缝的「开端」一侧在界内、缝的另一侧在界外）。
        /// </summary>
        public static float SpiralInside(in SpiralWellSpec s, Vector2 p)
        {
            var dv = p - s.center;
            float r = dv.magnitude;
            float phi = SpiralPhi(s, p);
            float d = SpiralOuter(s, phi) - r;
            float lowOuter = SpiralOuter(s, 1f), highOuter = SpiralOuter(s, 0f);
            if (r <= lowOuter) return d;
            float after = phi * 2 * Mathf.PI * r, before = (1 - phi) * 2 * Mathf.PI * r;
            if (d > 0) return Mathf.Min(d, after);
            return r <= highOuter ? Mathf.Max(d, -before) : Mathf.Max(d, -Mathf.Sqrt(before * before + (r - highOuter) * (r - highOuter)));
        }

        /// <summary>沿螺旋取一条折线（展开圈数 t0 → t1，离该圈内缘 offset 米），验收坡度、摆路标用</summary>
        public static List<Vector2> SpiralPath(in SpiralWellSpec s, float t0, float t1, float offset, float stepDeg = 3f)
        {
            var o = new List<Vector2>();
            float dt = stepDeg / 360f * Mathf.Sign(t1 - t0);
            for (float t = t0; dt > 0 ? t <= t1 : t >= t1; t += dt) o.Add(SpiralPoint(s, t, SpiralInner(s, t) + offset));
            return o;
        }

        // ───────────── 井壁衬里 ─────────────

        /// <summary>
        /// 地形洞一圈竖直的岩壁（双面网格，存成 {dir}/{name}.asset，不投影，有网格碰撞——掉进井的东西不会从侧面漏到地形下面）。
        /// loop = 洞口轮廓（世界 XZ，首尾相接），top / bottom = 壁顶 / 壁底的世界 y
        /// </summary>
        public static GameObject WellLining(string dir, string name, Transform parent, IReadOnlyList<Vector2> loop, float top, float bottom, Material mat)
        {
            int n = loop.Count;
            var verts = new List<Vector3>(n * 4);
            var uvs = new List<Vector2>(n * 4);
            var tris = new List<int>(n * 12);
            float u = 0;
            for (int i = 0; i < n; i++)
            {
                var a = loop[i];
                var b = loop[(i + 1) % n];
                float len = Vector2.Distance(a, b);
                int k = verts.Count;
                verts.Add(new Vector3(a.x, top, a.y));
                verts.Add(new Vector3(b.x, top, b.y));
                verts.Add(new Vector3(a.x, bottom, a.y));
                verts.Add(new Vector3(b.x, bottom, b.y));
                uvs.Add(new Vector2(u, top * 0.25f));
                uvs.Add(new Vector2(u + len * 0.25f, top * 0.25f));
                uvs.Add(new Vector2(u, bottom * 0.25f));
                uvs.Add(new Vector2(u + len * 0.25f, bottom * 0.25f));
                u += len * 0.25f;
                // 两面都画（洞是从里往外看，轮廓顺逆时针都行）
                tris.AddRange(new[] { k, k + 1, k + 2, k + 1, k + 3, k + 2 });
                tris.AddRange(new[] { k, k + 2, k + 1, k + 1, k + 2, k + 3 });
            }
            var mesh = new Mesh { name = $"Mesh_{name}" };
            if (verts.Count > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(verts);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            SaveAsset(mesh, $"{dir}/{name}.asset");
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            go.AddComponent<MeshCollider>().sharedMesh = mesh;
            go.isStatic = true;
            return go;
        }

        /// <summary>自发光的白盒材质（StylizedLit + _EMISSION）：熔岩光带、炉口、灯</summary>
        public static Material GlowMat(string dir, string name, Color baseColor, Color emission)
        {
            var m = Mat(dir, name, baseColor);
            m.SetColor("_EmissionColor", emission);
            m.EnableKeyword("_EMISSION");
            EditorUtility.SetDirty(m);
            return m;
        }

        // ───────────── 吊链 ─────────────

        /// <summary>链环资产 ID（ART6 唯一做完的第三章件：单个链环，节距 0.68 m，沿 +Y 叠放）</summary>
        public const string ChainLinkId = "SM_Prop_InfernoChainLink";
        public const float ChainPitch = 0.68f;
        static Mesh chainLinkMesh;
        static Material chainLinkMat;

        /// <summary>
        /// 一条吊链：从 a 到 b，中点下垂 sag 米（抛物线近似悬链），链环每隔一节绕自身长轴转 90°；全部链环合并成一个网格
        /// 存成 {dir}/Chains/Mesh_Chain_{name}.asset，没有碰撞（玩家、子弹、导航都不认它）。scale = 链环放大倍数。
        /// 没有链环 Prefab 时退回一根细圆柱，名字带 Placeholder（验收会列出来）。
        /// </summary>
        public static GameObject Chain(string dir, string name, Transform parent, Vector3 a, Vector3 b, float sag, float scale = 1f)
        {
            if (!chainLinkMesh)
            {
                var prefab = ShowcaseSceneBuilder.Prefab(ChainLinkId);
                if (prefab && BakePrefabMesh(prefab, 0, out var m, out var mat))
                {
                    chainLinkMesh = m;
                    chainLinkMat = mat;
                }
            }
            if (!chainLinkMesh)
            {
                EnsureTag(PlaceholderTag);
                var len = Vector3.Distance(a, b);
                var cyl = Cylinder($"Placeholder · Chain {name}", parent, (a + b) * 0.5f, 0.18f * scale, len,
                    Quaternion.FromToRotation(Vector3.up, (b - a).normalized), Mat(PlaceholderDir, "Placeholder", new Color(0.93f, 0.93f, 0.9f)));
                Object.DestroyImmediate(cyl.GetComponent<Collider>());
                cyl.tag = PlaceholderTag;
                Debug.LogWarning($"[Level] 缺少 Prefab {ChainLinkId}，吊链 {name} 放了占位圆柱");
                return cyl;
            }

            // 曲线：直线 + 抛物线下垂；按弧长等距取链环
            const int Samples = 96;
            var pts = new Vector3[Samples + 1];
            var acc = new float[Samples + 1];
            for (int i = 0; i <= Samples; i++)
            {
                float u = i / (float)Samples;
                pts[i] = Vector3.Lerp(a, b, u) + Vector3.down * (sag * 4 * u * (1 - u));
                if (i > 0) acc[i] = acc[i - 1] + Vector3.Distance(pts[i - 1], pts[i]);
            }
            float total = acc[Samples], pitch = ChainPitch * scale;
            int links = Mathf.Max(1, Mathf.FloorToInt(total / pitch));
            Vector3 At(float s)
            {
                s = Mathf.Clamp(s, 0, total);
                int i = 1;
                while (i < Samples && acc[i] < s) i++;
                float seg = acc[i] - acc[i - 1];
                return Vector3.Lerp(pts[i - 1], pts[i], seg > 1e-5f ? (s - acc[i - 1]) / seg : 0);
            }
            var combine = new List<CombineInstance>(links);
            for (int k = 0; k < links; k++)
            {
                float s0 = k * pitch;
                var p0 = At(s0);
                var dirv = At(s0 + pitch) - p0;
                if (dirv.sqrMagnitude < 1e-8f) dirv = b - a;
                var rot = Quaternion.FromToRotation(Vector3.up, dirv.normalized) * Quaternion.Euler(0, (k & 1) * 90f, 0);
                combine.Add(new CombineInstance { mesh = chainLinkMesh, transform = Matrix4x4.TRS(p0 - a, rot, Vector3.one * scale) });
            }
            var mesh = new Mesh { name = $"Mesh_Chain_{name}", indexFormat = chainLinkMesh.vertexCount * links > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.CombineMeshes(combine.ToArray(), true, true);
            mesh.RecalculateBounds();
            Directory.CreateDirectory($"{dir}/Chains");
            SaveAsset(mesh, $"{dir}/Chains/Mesh_Chain_{SafeName(name)}.asset");
            var go = new GameObject($"Chain · {name}");
            go.transform.SetParent(parent, false);
            go.transform.position = a;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = chainLinkMat;
            mr.shadowCastingMode = ShadowCastingMode.On;
            go.isStatic = true;
            return go;
        }

        /// <summary>换场景前清掉链环缓存（链环 Prefab 重导后要重新烘）</summary>
        public static void ResetChainCache()
        {
            chainLinkMesh = null;
            chainLinkMat = null;
        }
    }
}
