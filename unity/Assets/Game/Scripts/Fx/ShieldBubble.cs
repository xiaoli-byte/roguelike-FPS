using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 护盾球壳（特效打磨 B 路；原来破盾只是一圈六边形格从身体表面崩开）：
    ///   打在护盾上：身上罩起一层六边形能量壳（戈德堡多面体、按身体包围盒缩放成椭球），命中那一格闪白，一圈涟漪沿球面一格一格亮过去；
    ///     最后一次受击 1 s 后 0.35 s 淡出（不受击时不罩着，不挡视线）；同时最多记 4 个命中点；
    ///   破盾：整个球壳碎开——每一格沿格心方向飞出、缩小、下坠，先亮一下再淡掉（0.6 s）；之前没罩起来的当场罩起再碎。
    /// SF_FxShield，参数走 MaterialPropertyBlock；对象池挂在常驻的特效根下，换关清场。
    /// 同时显示的球壳数受画质限制（<see cref="Cap"/>：高 12 / 中 9 / 低 6，满了不再罩新的，破盾照常碎）。
    /// 由 <see cref="FxBlastDirector"/> 按战斗事件驱动。
    /// </summary>
    public sealed class ShieldBubble : MonoBehaviour
    {
        const float Hold = 1f, FadeOut = 0.35f, FadeIn = 0.06f, ShatterTime = 0.6f;

        static readonly Dictionary<Damageable, ShieldBubble> live = new();
        static readonly Stack<ShieldBubble> pool = new();
        static readonly List<Damageable> scratch = new();
        static Mesh mesh;
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int[] HitIds = { Shader.PropertyToID("_Hit0"), Shader.PropertyToID("_Hit1"), Shader.PropertyToID("_Hit2"), Shader.PropertyToID("_Hit3") };

        /// <summary>累计：涟漪 / 破碎（冒烟测试核对）</summary>
        public static int Ripples, Shatters;

        Damageable target, key;
        Collider col;
        MeshRenderer mr;
        MaterialPropertyBlock block;
        readonly Vector3[] hitDir = new Vector3[4];
        readonly float[] hitAt = { -99, -99, -99, -99 };
        int nextHit;
        float shownAt, lastHit, shatterAt = -1, seed, flash;
        Color color;

        /// <summary>此刻的可见度（测试用）</summary>
        public float Visible { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            pool.Clear();
            Ripples = Shatters = 0;
        }

        /// <summary>同时显示的球壳上限：高 12 / 中 9 / 低 6</summary>
        public static int Cap => Mathf.Max(4, Mathf.RoundToInt(12 * FxBudget.StyleCapScale));

        /// <summary>场上正在显示的球壳数</summary>
        public static int ActiveCount => live.Count;

        /// <summary>这个目标身上的球壳（没有返回 null）</summary>
        public static ShieldBubble Of(Damageable d) => d && live.TryGetValue(d, out var b) && b ? b : null;

        /// <summary>打在护盾上：罩起球壳（已有就刷新），记一个命中点</summary>
        public static void Hit(Damageable d, Vector3 point, Color? color = null)
        {
            var b = Get(d, false);
            if (!b || b.shatterAt >= 0) return;
            b.AddHit(point);
            if (color.HasValue) b.color = color.Value;
            Ripples++;
        }

        /// <summary>破盾：整个球壳碎开（没罩着的当场罩起再碎）</summary>
        public static void Shatter(Damageable d, Vector3? point = null)
        {
            var b = Get(d, true);
            if (!b || b.shatterAt >= 0) return;
            if (point.HasValue) b.AddHit(point.Value);
            b.shatterAt = Time.time;
            b.flash = 1;
            Shatters++;
        }

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            scratch.Clear();
            scratch.AddRange(live.Keys);
            foreach (var d in scratch)
                if (live.TryGetValue(d, out var b) && b)
                    b.Release();
            live.Clear();
        }

        static ShieldBubble Get(Damageable d, bool force)
        {
            if (!d || !Application.isPlaying) return null;
            if (live.TryGetValue(d, out var b) && b) return b;
            if (!force && live.Count >= Cap) return null;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            var mat = FxToon.Material(FxToon.Shield);
            if (!mat || mat.shader == null || mat.shader.name != FxToon.ShaderShield) return null;
            b = Take(rt.transform, mat);
            b.Begin(d);
            live[d] = b;
            return b;
        }

        static ShieldBubble Take(Transform parent, Material mat)
        {
            while (pool.Count > 0)
            {
                var p = pool.Pop();
                if (!p) continue;
                p.gameObject.SetActive(true);
                return p;
            }
            var go = new GameObject("Shield Bubble");
            go.transform.SetParent(parent, false);
            var b = go.AddComponent<ShieldBubble>();
            go.AddComponent<MeshFilter>().sharedMesh = Mesh;
            b.mr = go.AddComponent<MeshRenderer>();
            b.mr.sharedMaterial = mat;
            b.mr.shadowCastingMode = ShadowCastingMode.Off;
            b.mr.receiveShadows = false;
            b.mr.lightProbeUsage = LightProbeUsage.Off;
            b.mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
            b.block = new MaterialPropertyBlock();
            return b;
        }

        void Begin(Damageable d)
        {
            target = key = d;
            col = d.GetComponent<Collider>();
            shownAt = lastHit = Time.time;
            shatterAt = -1;
            flash = 0;
            seed = Random.value;
            color = new Color(0.3f, 0.85f, 2.2f, 1f);
            for (int i = 0; i < hitAt.Length; i++) hitAt[i] = -99;
            nextHit = 0;
            transform.rotation = Quaternion.identity;
            Place();
        }

        void AddHit(Vector3 point)
        {
            lastHit = Time.time;
            Place();
            var local = transform.InverseTransformPoint(point);
            if (local.sqrMagnitude < 1e-6f) local = Random.onUnitSphere;
            hitDir[nextHit] = local.normalized;
            hitAt[nextHit] = Time.time;
            nextHit = (nextHit + 1) % hitDir.Length;
        }

        void Place()
        {
            if (col && col.enabled)
            {
                var bb = col.bounds;
                float r = Mathf.Clamp(Mathf.Max(bb.extents.x, bb.extents.z) * 1.45f, 0.45f, 4f);
                float h = Mathf.Clamp(bb.extents.y * 1.18f, 0.5f, 6f);
                transform.position = bb.center;
                transform.localScale = new Vector3(r, Mathf.Max(h, r * 0.9f), r);
                return;
            }
            if (target)
            {
                transform.position = target.transform.position + Vector3.up;
                transform.localScale = new Vector3(0.7f, 1.1f, 0.7f);
            }
        }

        void Release()
        {
            if (key is not null && live.TryGetValue(key, out var b) && ReferenceEquals(b, this)) live.Remove(key);
            target = key = null;
            col = null;
            gameObject.SetActive(false);
            pool.Push(this);
        }

        void LateUpdate()
        {
            float now = Time.time;
            float vis, s = 0;
            if (shatterAt >= 0)
            {
                s = Mathf.Clamp01((now - shatterAt) / ShatterTime);
                if (s >= 1)
                {
                    Release();
                    return;
                }
                vis = 1;
            }
            else
            {
                // 目标死了 / 没了 / 护盾没了（不是被打穿，例如被别的效果清掉）：淡出
                if (!target || target.Dead || !target.isActiveAndEnabled) lastHit = Mathf.Min(lastHit, now - Hold);
                float idle = now - lastHit;
                // 淡出完了才收（刚罩起的那一帧淡入是 0，不能当成「淡没了」）
                if (idle >= Hold + FadeOut)
                {
                    Release();
                    return;
                }
                vis = Mathf.Clamp01((now - shownAt + Time.deltaTime) / FadeIn) * (idle < Hold ? 1 : 1 - (idle - Hold) / FadeOut);
            }
            if (target && shatterAt < 0) Place();
            Visible = vis;
            flash = Mathf.Max(0, flash - Time.deltaTime * 6f);
            mr.GetPropertyBlock(block);
            block.SetVector(ParamsId, new Vector4(vis, s, flash, seed));
            block.SetVector(ColorId, new Vector4(color.r, color.g, color.b, 1));
            for (int i = 0; i < HitIds.Length; i++)
            {
                var d = hitDir[i];
                block.SetVector(HitIds[i], new Vector4(d.x, d.y, d.z, hitAt[i] < 0 ? 99 : now - hitAt[i]));
            }
            mr.SetPropertyBlock(block);
        }

        // ───────────── 网格：戈德堡多面体（一次细分二十面体的对偶：30 个六边形 + 12 个五边形） ─────────────
        // 风格审查：原来二次细分（150 格）的格子太碎，读成科幻的细网格；一次细分的大格是中尺度的「龟甲纹」，格边也更粗

        public static Mesh Mesh => mesh ? mesh : mesh = Build(1, 0.9f);

        /// <summary>
        /// 单位球上的六边形格：每格一个扇形（格心 + 一圈角点），角点往格心收 inset 留出格缝。
        /// uv0 = (格内径向坐标 0 → 1, 每格随机数)，uv1 = 格心方向，法线 = 球面法线
        /// </summary>
        static Mesh Build(int subdiv, float inset)
        {
            // 二十面体
            float t = (1 + Mathf.Sqrt(5)) / 2;
            var verts = new List<Vector3>
            {
                new(-1, t, 0), new(1, t, 0), new(-1, -t, 0), new(1, -t, 0), new(0, -1, t), new(0, 1, t),
                new(0, -1, -t), new(0, 1, -t), new(t, 0, -1), new(t, 0, 1), new(-t, 0, -1), new(-t, 0, 1),
            };
            for (int i = 0; i < verts.Count; i++) verts[i] = verts[i].normalized;
            var faces = new List<int>
            {
                0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
                3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
            };
            var mid = new Dictionary<long, int>();
            int Mid(int a, int b)
            {
                long k = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                if (mid.TryGetValue(k, out int m)) return m;
                verts.Add(((verts[a] + verts[b]) * 0.5f).normalized);
                mid[k] = verts.Count - 1;
                return verts.Count - 1;
            }
            for (int s = 0; s < subdiv; s++)
            {
                var next = new List<int>(faces.Count * 4);
                for (int i = 0; i < faces.Count; i += 3)
                {
                    int a = faces[i], b = faces[i + 1], c = faces[i + 2];
                    int ab = Mid(a, b), bc = Mid(b, c), ca = Mid(c, a);
                    next.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
                }
                faces = next;
            }
            // 每个顶点（= 一格）周围的面
            var around = new List<int>[verts.Count];
            for (int i = 0; i < verts.Count; i++) around[i] = new List<int>(6);
            for (int f = 0; f < faces.Count / 3; f++)
                for (int k = 0; k < 3; k++)
                    around[faces[f * 3 + k]].Add(f);

            var pos = new List<Vector3>();
            var nrm = new List<Vector3>();
            var uv0 = new List<Vector2>();
            var uv1 = new List<Vector3>();
            var idx = new List<int>();
            var corners = new List<(float ang, Vector3 p)>(6);
            for (int v = 0; v < verts.Count; v++)
            {
                var c = verts[v];
                var tx = Vector3.Cross(c, Mathf.Abs(c.y) < 0.9f ? Vector3.up : Vector3.right).normalized;
                var ty = Vector3.Cross(c, tx);
                corners.Clear();
                foreach (int f in around[v])
                {
                    var cen = ((verts[faces[f * 3]] + verts[faces[f * 3 + 1]] + verts[faces[f * 3 + 2]]) / 3f).normalized;
                    var d = cen - c;
                    corners.Add((Mathf.Atan2(Vector3.Dot(d, ty), Vector3.Dot(d, tx)), cen));
                }
                corners.Sort((a, b) => a.ang.CompareTo(b.ang));
                float rnd = Hash(v);
                int baseIdx = pos.Count;
                pos.Add(c);
                nrm.Add(c);
                uv0.Add(new Vector2(0, rnd));
                uv1.Add(c);
                foreach (var (_, p) in corners)
                {
                    var q = (c + (p - c) * inset).normalized;
                    pos.Add(q);
                    nrm.Add(q);
                    uv0.Add(new Vector2(1, rnd));
                    uv1.Add(c);
                }
                int n = corners.Count;
                for (int i = 0; i < n; i++)
                {
                    idx.Add(baseIdx);
                    idx.Add(baseIdx + 1 + (i + 1) % n);
                    idx.Add(baseIdx + 1 + i);
                }
            }
            var m = new Mesh { name = "Shield Bubble (Goldberg)" };
            m.SetVertices(pos);
            m.SetNormals(nrm);
            m.SetUVs(0, uv0);
            m.SetUVs(1, uv1);
            m.SetTriangles(idx, 0);
            // 破碎时格子会飞出去：包围盒放大，免得被视锥剔掉
            m.bounds = new Bounds(Vector3.zero, Vector3.one * 7f);
            return m;
        }

        static float Hash(int i)
        {
            uint h = (uint)i * 2654435761u;
            h ^= h >> 15;
            h *= 2246822519u;
            h ^= h >> 13;
            return (h & 0xFFFF) / 65535f;
        }
    }
}
