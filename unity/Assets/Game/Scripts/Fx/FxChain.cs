using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 程序化铁链（FX4「链」；Three.js InfernoRangedFx.ChainLinks）：马面狱卒的勾魂索——链环沿一条折线等距排开（间距 0.13 m × 体型），
    /// 相邻两环绕链子方向错开 90°，链尾一个带倒刺的铁钩；每环一个热度（顶点色 a，SF_FxChain 按「暗红 → 橙 → 黄白」发光：甩圈时从腕铐往外逐节烧红、
    /// 拖拽时整条一跳一跳地红）。所有链环 + 钩头合成一个动态网格，每次 <see cref="Layout"/> 重写顶点，一次绘制。
    /// 断链 / 缴械掉下来的那截用 <see cref="Drop"/>：链环崩开落地、滚一点，1.2 s 内冷却，最后慢慢沉下去。
    /// 链子物体不挂在敌人身上（顶点是世界坐标）：创建者负责销毁（敌人 OnDestroy），换关时随场景卸载。
    /// </summary>
    public sealed class FxChain : MonoBehaviour
    {
        const float Pitch = 0.13f;
        const int Ring = 8, Tube = 4;

        static Vector3[] linkV, linkN, hookV, hookN;
        static int[] linkT, hookT;
        static readonly Quaternion Q90 = Quaternion.AngleAxis(90, Vector3.up);

        Mesh mesh;
        MeshRenderer mr;
        Vector3[] verts, norms;
        Color32[] cols;
        int maxLinks, linkVerts;
        float size;
        bool hasHook;
        byte[] shade;

        /// <summary>这一帧摆出来的链环数（测试用）</summary>
        public int Links { get; private set; }

        public bool Visible
        {
            get => mr && mr.enabled;
            set
            {
                if (mr) mr.enabled = value;
            }
        }

        /// <summary>建一条链子：最多 maxLinks 环（够长的链子才用得完）、体型 size、要不要钩头</summary>
        public static FxChain Create(string name, int maxLinks, float size, bool hook = true)
        {
            BuildTemplates();
            var go = new GameObject(name);
            var c = go.AddComponent<FxChain>();
            c.maxLinks = Mathf.Max(1, maxLinks);
            c.size = Mathf.Max(0.2f, size);
            c.hasHook = hook;
            c.linkVerts = linkV.Length;
            int nv = c.maxLinks * linkV.Length + (hook ? hookV.Length : 0);
            c.verts = new Vector3[nv];
            c.norms = new Vector3[nv];
            c.cols = new Color32[nv];
            c.shade = new byte[c.maxLinks];
            for (int i = 0; i < c.maxLinks; i++) c.shade[i] = (byte)Random.Range(20, 32);
            var tris = new int[c.maxLinks * linkT.Length + (hook ? hookT.Length : 0)];
            for (int i = 0; i < c.maxLinks; i++)
                for (int k = 0; k < linkT.Length; k++)
                    tris[i * linkT.Length + k] = linkT[k] + i * linkV.Length;
            if (hook)
            {
                int vo = c.maxLinks * linkV.Length, to = c.maxLinks * linkT.Length;
                for (int k = 0; k < hookT.Length; k++) tris[to + k] = hookT[k] + vo;
            }
            c.mesh = new Mesh { name = name, indexFormat = nv > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            c.mesh.MarkDynamic();
            c.mesh.vertices = c.verts;
            c.mesh.normals = c.norms;
            c.mesh.colors32 = c.cols;
            c.mesh.triangles = tris;
            go.AddComponent<MeshFilter>().sharedMesh = c.mesh;
            c.mr = go.AddComponent<MeshRenderer>();
            c.mr.sharedMaterial = FxMaterials.Get(FxMaterialKind.Chain);
            c.mr.shadowCastingMode = ShadowCastingMode.Off;
            c.mr.receiveShadows = true;
            c.mr.enabled = false;
            return c;
        }

        /// <summary>
        /// 沿折线 pts（链根 → 钩头）摆放；环数按长度截取（多余的缩没）。heat(u) = 链长比例 u（0 = 链根）处的热度 0..1；hookHeat = 钩头热度
        /// </summary>
        public void Layout(IReadOnlyList<Vector3> pts, Func<float, float> heat, float hookHeat)
        {
            if (pts == null || pts.Count < 2 || !mesh) return;
            float total = 0;
            for (int i = 1; i < pts.Count; i++) total += Vector3.Distance(pts[i], pts[i - 1]);
            float pitch = Pitch * size;
            int n = Mathf.Min(maxLinks, Mathf.Max(1, Mathf.FloorToInt(total / pitch)));
            Links = n;
            int seg = 1;
            float segStart = 0, segLen = Vector3.Distance(pts[1], pts[0]);
            for (int i = 0; i < maxLinks; i++)
            {
                int vo = i * linkVerts;
                if (i >= n)
                {
                    for (int k = 0; k < linkVerts; k++) verts[vo + k] = pts[0];
                    continue;
                }
                float d = (i + 0.5f) * pitch;
                while (seg < pts.Count - 1 && d > segStart + segLen)
                {
                    segStart += segLen;
                    seg++;
                    segLen = Vector3.Distance(pts[seg], pts[seg - 1]);
                }
                float f = segLen > 1e-6f ? Mathf.Clamp01((d - segStart) / segLen) : 0;
                var p = Vector3.Lerp(pts[seg - 1], pts[seg], f);
                var dir = pts[seg] - pts[seg - 1];
                if (dir.sqrMagnitude < 1e-10f) dir = Vector3.up;
                dir.Normalize();
                // 环的长轴（模板 +y）顺着链子；绕链子方向交替转 90°
                var q = Quaternion.FromToRotation(Vector3.up, dir);
                if ((i & 1) == 1) q *= Q90;
                float h = heat != null ? Mathf.Clamp01(heat(d / Mathf.Max(1e-6f, total))) : 0;
                byte g = shade[i];
                var col = new Color32(g, (byte)(g * 0.92f), (byte)(g * 0.86f), (byte)(h * 255));
                for (int k = 0; k < linkVerts; k++)
                {
                    verts[vo + k] = p + q * (linkV[k] * size);
                    norms[vo + k] = q * linkN[k];
                    cols[vo + k] = col;
                }
            }
            if (hasHook)
            {
                int vo = maxLinks * linkVerts;
                var last = pts[pts.Count - 1];
                var dir = last - pts[pts.Count - 2];
                var q = dir.sqrMagnitude > 1e-10f ? Quaternion.LookRotation(dir.normalized) : Quaternion.identity;
                var col = new Color32(38, 34, 32, (byte)(Mathf.Clamp01(hookHeat) * 255));
                for (int k = 0; k < hookV.Length; k++)
                {
                    verts[vo + k] = last + q * (hookV[k] * size);
                    norms[vo + k] = q * hookN[k];
                    cols[vo + k] = col;
                }
            }
            mesh.vertices = verts;
            mesh.normals = norms;
            mesh.colors32 = cols;
            mesh.RecalculateBounds();
        }

        void OnDestroy()
        {
            if (mesh) Destroy(mesh);
        }

        // ───────────── 断链 ─────────────

        /// <summary>断掉的链子：沿 pts 那段的链环崩开落地、滚开一点，1.2 s 内冷却，duration 秒后沉下去消失（只是外观）</summary>
        public static FxChain Drop(IReadOnlyList<Vector3> pts, float size, float duration = 3f, float heat = 0.8f)
        {
            if (pts == null || pts.Count < 2 || !Application.isPlaying) return null;
            var c = Create("Dropped Chain", 36, size, false);
            var d = c.gameObject.AddComponent<DroppedChain>();
            d.Init(c, pts, duration, heat);
            c.Visible = true;
            return c;
        }

        sealed class DroppedChain : MonoBehaviour
        {
            FxChain chain;
            readonly List<Vector3> pos = new();
            readonly List<Vector3> vel = new();
            readonly List<float> floor = new();
            float t, duration, heat0;

            public void Init(FxChain c, IReadOnlyList<Vector3> pts, float dur, float heat)
            {
                chain = c;
                duration = Mathf.Max(0.8f, dur);
                heat0 = heat;
                // 折线加密到每 0.5 m 一个点，各自落地
                for (int i = 0; i < pts.Count - 1; i++)
                {
                    int sub = Mathf.Max(1, Mathf.CeilToInt(Vector3.Distance(pts[i], pts[i + 1]) / 0.5f));
                    for (int k = 0; k < sub; k++) Add(Vector3.Lerp(pts[i], pts[i + 1], k / (float)sub));
                }
                Add(pts[pts.Count - 1]);
            }

            void Add(Vector3 p)
            {
                pos.Add(p);
                vel.Add(new Vector3(Random.Range(-1f, 1f), Random.Range(2f, 4f), Random.Range(-1f, 1f)));
                float gy = Fx.GroundY(p + Vector3.up * 0.2f, 6f);
                floor.Add(!float.IsNegativeInfinity(gy) ? gy + 0.03f : p.y - 1f);
            }

            void Update()
            {
                float dt = Time.deltaTime;
                t += dt;
                for (int i = 0; i < pos.Count; i++)
                {
                    var p = pos[i];
                    var v = vel[i];
                    v.y -= 22 * dt;
                    p += v * dt;
                    if (p.y < floor[i])
                    {
                        p.y = floor[i];
                        v = new Vector3(v.x * 0.4f, 0, v.z * 0.4f);
                    }
                    if (t > duration - 0.6f) p.y -= dt * 0.25f;
                    pos[i] = p;
                    vel[i] = v;
                }
                float cool = Mathf.Clamp01(1 - t / 1.2f);
                chain.Layout(pos, _ => heat0 * cool, 0);
                if (t >= duration) Destroy(gameObject);
            }
        }

        // ───────────── 模板网格 ─────────────

        static void BuildTemplates()
        {
            if (linkV != null) return;
            // 链环：椭圆环面（中线半轴 0.055 × 0.085，管半径 0.016），长轴沿 +y，环面在 xy 平面
            var lv = new List<Vector3>();
            var ln = new List<Vector3>();
            var lt = new List<int>();
            const float ra = 0.055f, rb = 0.085f, tube = 0.016f;
            for (int i = 0; i < Ring; i++)
            {
                float a = i / (float)Ring * Mathf.PI * 2;
                var c = new Vector3(Mathf.Cos(a) * ra, Mathf.Sin(a) * rb, 0);
                var outward = new Vector3(Mathf.Cos(a) / ra, Mathf.Sin(a) / rb, 0).normalized;
                for (int k = 0; k < Tube; k++)
                {
                    float b = k / (float)Tube * Mathf.PI * 2;
                    var n = outward * Mathf.Cos(b) + Vector3.forward * Mathf.Sin(b);
                    lv.Add(c + n * tube);
                    ln.Add(n);
                }
            }
            for (int i = 0; i < Ring; i++)
                for (int k = 0; k < Tube; k++)
                {
                    int i1 = (i + 1) % Ring, k1 = (k + 1) % Tube;
                    AddQuad(lv, ln, lt, i * Tube + k, i1 * Tube + k, i1 * Tube + k1, i * Tube + k1);
                }
            linkV = lv.ToArray();
            linkN = ln.ToArray();
            linkT = lt.ToArray();

            // 钩头（局部 +z = 钩尖朝向）：3/4 圈的粗钩 + 一截柄 + 钩尖的倒刺
            var hv = new List<Vector3>();
            var hn = new List<Vector3>();
            var ht = new List<int>();
            AddArc(hv, hn, ht, new Vector3(0, -0.02f, 0.06f), 0.13f, 0.03f, -0.4f * Mathf.PI, 0.95f * Mathf.PI, 12, 5);
            AddCylinder(hv, hn, ht, new Vector3(0, 0.11f, -0.21f), new Vector3(0, 0.11f, 0.05f), 0.03f, 6);
            AddCone(hv, hn, ht, new Vector3(0, -0.13f, 0.04f), new Vector3(0, -0.06f, 0.18f), 0.035f, 4);
            hookV = hv.ToArray();
            hookN = hn.ToArray();
            hookT = ht.ToArray();
        }

        static void AddArc(List<Vector3> v, List<Vector3> n, List<int> t, Vector3 center, float radius, float tube, float a0, float a1, int segs, int sides)
        {
            // 圆弧在 yz 平面（绕 x 轴），钩尖往 +z
            int start = v.Count;
            for (int i = 0; i <= segs; i++)
            {
                float a = Mathf.Lerp(a0, a1, i / (float)segs);
                var c = center + new Vector3(0, Mathf.Sin(a) * radius, Mathf.Cos(a) * radius);
                var outward = new Vector3(0, Mathf.Sin(a), Mathf.Cos(a));
                for (int k = 0; k < sides; k++)
                {
                    float b = k / (float)sides * Mathf.PI * 2;
                    var nn = outward * Mathf.Cos(b) + Vector3.right * Mathf.Sin(b);
                    v.Add(c + nn * tube);
                    n.Add(nn);
                }
            }
            for (int i = 0; i < segs; i++)
                for (int k = 0; k < sides; k++)
                {
                    int k1 = (k + 1) % sides;
                    int a = start + i * sides + k, b = start + (i + 1) * sides + k, c = start + (i + 1) * sides + k1, d = start + i * sides + k1;
                    AddQuad(v, n, t, a, b, c, d);
                }
        }

        static void AddCylinder(List<Vector3> v, List<Vector3> n, List<int> t, Vector3 p0, Vector3 p1, float r, int sides)
        {
            var axis = (p1 - p0).normalized;
            var rot = Quaternion.FromToRotation(Vector3.up, axis);
            int start = v.Count;
            for (int e = 0; e < 2; e++)
                for (int k = 0; k < sides; k++)
                {
                    float b = k / (float)sides * Mathf.PI * 2;
                    var nn = rot * new Vector3(Mathf.Cos(b), 0, Mathf.Sin(b));
                    v.Add((e == 0 ? p0 : p1) + nn * r);
                    n.Add(nn);
                }
            for (int k = 0; k < sides; k++)
            {
                int k1 = (k + 1) % sides;
                AddQuad(v, n, t, start + k, start + sides + k, start + sides + k1, start + k1);
            }
        }

        static void AddCone(List<Vector3> v, List<Vector3> n, List<int> t, Vector3 p0, Vector3 tip, float r, int sides)
        {
            var axis = (tip - p0).normalized;
            var rot = Quaternion.FromToRotation(Vector3.up, axis);
            int start = v.Count;
            for (int k = 0; k < sides; k++)
            {
                float b = k / (float)sides * Mathf.PI * 2;
                var nn = rot * new Vector3(Mathf.Cos(b), 0, Mathf.Sin(b));
                v.Add(p0 + nn * r);
                n.Add((nn + axis * 0.3f).normalized);
            }
            v.Add(tip);
            n.Add(axis);
            int tipI = v.Count - 1;
            for (int k = 0; k < sides; k++)
            {
                int a = start + k, b = start + (k + 1) % sides;
                var nrm = Vector3.Cross(v[b] - v[a], v[tipI] - v[a]);
                var want = (n[a] + n[b]);
                if (Vector3.Dot(nrm, want) >= 0) t.AddRange(new[] { a, b, tipI });
                else t.AddRange(new[] { a, tipI, b });
            }
        }

        /// <summary>四边形 a-b-c-d，按顶点法线定绕序（法线朝外的一面是正面）</summary>
        static void AddQuad(List<Vector3> v, List<Vector3> n, List<int> t, int a, int b, int c, int d)
        {
            var nrm = Vector3.Cross(v[b] - v[a], v[c] - v[a]);
            var want = n[a] + n[b] + n[c];
            if (Vector3.Dot(nrm, want) >= 0) t.AddRange(new[] { a, b, c, a, c, d });
            else t.AddRange(new[] { a, c, b, a, d, c });
        }
    }
}
