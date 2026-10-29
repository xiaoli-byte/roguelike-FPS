using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰爆的主形（特效打磨收尾一轮，docs/art/fx-style.md §三「冰」：块面清楚的低多边形冰晶，亮面白、暗面冰蓝、暗边蓝灰）：
    /// 一簇冰晶从爆心往外「长」出来（蓄，0.08 s，带一点过冲）→ 0.1 s 时整簇崩开、和一把碎冰一起往外翻飞（爆）→ 落地弹一下，
    /// 最后四成寿命里一面一面地碎掉（余韵，0.65 s 内全部退场）。
    /// 冰晶是不透明的卡通冰（SF_FxCrystal，材质 <see cref="FxToon.Crystal"/>），三种程序网格（长六棱、粗五棱、扁四棱，确定性抖动）。
    /// 预算：块数乘画质密度（<see cref="Fx.Density"/>）、过同屏粒子预算（<see cref="FxBudget.Allow"/>，一块冰晶算一颗），
    /// 全场同时存在的上限按画质（高 64 / 中 48 / 低 32，<see cref="FxBudget.StyleCapScale"/>），满了不再生成。池化，换关清场。
    /// 入口：<see cref="Fx.FrostNova(Vector3, float, Color)"/>。
    /// </summary>
    public sealed class FrostBurst : MonoBehaviour
    {
        const int BaseCap = 64;
        const float GrowTime = 0.08f, PopAt = 0.1f, Gravity = 18f;

        static readonly int ParamsId = Shader.PropertyToID("_Params");

        sealed class Shard
        {
            public GameObject go;
            public Transform t;
            public MeshRenderer r;
            public MeshFilter f;
            public Vector3 pos, vel, spinAxis, dir;
            public Quaternion rot;
            public float age, delay, life, size, length, spin, groundY, seed;
            /// <summary>爆心那一簇：先原地长出来，PopAt 时再飞出去</summary>
            public bool cluster;
            public bool flying;
        }

        static FrostBurst instance;
        static Mesh[] meshes;
        static Material material;
        readonly List<Shard> live = new();
        readonly Stack<Shard> pool = new();
        MaterialPropertyBlock block;

        /// <summary>对照开关（性能开 / 关对照用）：true = 冰爆不生成冰晶，只剩粒子</summary>
        public static bool Off;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            Off = false;
        }

        /// <summary>场上的冰晶块数（测试 / 性能统计用）</summary>
        public static int ActiveCount => instance ? instance.live.Count : 0;

        /// <summary>全场同时存在的上限（按画质）</summary>
        public static int Cap => Mathf.Max(8, Mathf.RoundToInt(BaseCap * FxBudget.StyleCapScale));

        static FrostBurst Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<FrostBurst>();
            return instance;
        }

        void Awake()
        {
            block = new MaterialPropertyBlock();
            SceneManager.sceneUnloaded += OnUnloaded;
        }

        void OnDestroy() => SceneManager.sceneUnloaded -= OnUnloaded;

        void OnUnloaded(Scene _) => ClearAll();

        /// <summary>全部收起（换关清场）</summary>
        public static void ClearAll()
        {
            if (!instance) return;
            foreach (var s in instance.live) instance.Release(s, false);
            instance.live.Clear();
        }

        /// <summary>
        /// 一次冰爆的冰晶：center = 爆心，radius = 冰爆半径（0.6–8 m）。返回实际生成的块数（预算 / 上限砍掉的不算）。
        /// 爆心一簇 5–8 根（规模越大越多，长 0.56 r、≤ 2.9 m）+ 碎冰 5 + 1.5 r 块（≤ 16），都乘画质密度
        /// </summary>
        public static int Spawn(Vector3 center, float radius)
        {
            if (Off || !Fx.Finite(center) || !(radius > 0) || !Application.isPlaying) return 0;
            var self = Get();
            if (!self) return 0;
            if (!EnsureAssets()) return 0;
            radius = Mathf.Clamp(radius, 0.6f, 8f);
            float dens = Fx.Density;
            int nCluster = Mathf.Clamp(Mathf.RoundToInt((5 + radius * 0.4f) * dens), 3, 8);
            int nShards = Mathf.Clamp(Mathf.RoundToInt((5 + radius * 1.5f) * dens), 2, 16);
            int room = Cap - self.live.Count;
            int want = Mathf.Min(nCluster + nShards, Mathf.Max(0, room));
            want = FxBudget.Allow(want, false);
            if (want <= 0) return 0;
            nCluster = Mathf.Min(nCluster, want);
            nShards = want - nCluster;

            float gy = Fx.GroundY(center + Vector3.up * 0.5f, radius * 1.5f + 2f);
            if (float.IsNegativeInfinity(gy)) gy = center.y - 50f;
            float sizeK = Mathf.Clamp(Mathf.Sqrt(radius / 3f), 0.6f, 1.7f);
            // 冰晶的个头跟着爆炸半径走（3 m 的冰爆一簇将近 2 m 高，远处也读得出「这一下炸了多大」）
            float spikeLen = Mathf.Clamp(radius * 0.56f, 0.4f, 2.9f);
            float az0 = Random.value * Mathf.PI * 2;

            // 爆心一簇：往上半球张开的冰晶，从爆心长出来
            for (int i = 0; i < nCluster; i++)
            {
                float az = az0 + i * Mathf.PI * 2 / nCluster + Random.Range(-0.3f, 0.3f);
                float el = Random.Range(0.25f, 1.05f);
                var dir = new Vector3(Mathf.Cos(az) * Mathf.Cos(el), Mathf.Sin(el), Mathf.Sin(az) * Mathf.Cos(el));
                var s = self.Take(i % 3 == 1 ? 1 : 0);
                s.cluster = true;
                s.flying = false;
                s.dir = dir;
                s.pos = center;
                s.length = spikeLen * Random.Range(0.75f, 1.15f);
                s.size = s.length * Random.Range(0.4f, 0.5f);
                s.rot = Quaternion.FromToRotation(Vector3.up, dir) * Quaternion.Euler(0, Random.value * 360f, 0);
                // 崩开时沿自己的方向飞出去（贴地的少飞一点，往上的多翻一点）
                s.vel = dir * Random.Range(3.5f, 6.5f) * sizeK + Vector3.up * Random.Range(1.5f, 3f);
                s.spin = Random.Range(240f, 520f);
                s.spinAxis = Random.onUnitSphere;
                s.delay = 0;
                s.life = PopAt + Random.Range(0.42f, 0.52f);
                s.groundY = gy;
                self.Begin(s);
            }
            // 碎冰：崩开那一刻一起往外翻
            for (int i = 0; i < nShards; i++)
            {
                var d = Random.onUnitSphere;
                d.y = Mathf.Abs(d.y) * 0.8f + 0.2f;
                d.Normalize();
                var s = self.Take(i % 3);
                s.cluster = false;
                s.flying = true;
                s.dir = d;
                s.pos = center + d * (radius * 0.12f);
                s.size = Random.Range(0.2f, 0.42f) * sizeK;
                s.length = s.size * Random.Range(1.5f, 2.3f);
                s.rot = Random.rotationUniform;
                s.vel = d * Random.Range(5f, 10f) * sizeK + Vector3.up * Random.Range(1.5f, 3.5f);
                s.spin = Random.Range(360f, 760f);
                s.spinAxis = Random.onUnitSphere;
                s.delay = PopAt - 0.02f;
                s.life = Random.Range(0.42f, 0.55f);
                s.groundY = gy;
                self.Begin(s);
            }
            return want;
        }

        static bool EnsureAssets()
        {
            if (!material)
            {
                var m = FxToon.Material(FxToon.Crystal);
                // 着色器缺失（兜底成普通粒子材质）时不画：普通粒子材质画实心网格是一块块白板
                if (!m || !m.shader || m.shader.name != FxToon.ShaderCrystal) return false;
                material = m;
            }
            if (meshes == null) meshes = new[] { BuildCrystal(0), BuildCrystal(1), BuildCrystal(2) };
            return true;
        }

        Shard Take(int variant)
        {
            var s = pool.Count > 0 ? pool.Pop() : null;
            if (s == null)
            {
                var go = new GameObject("Frost Crystal");
                go.transform.SetParent(transform, false);
                s = new Shard { go = go, t = go.transform, f = go.AddComponent<MeshFilter>(), r = go.AddComponent<MeshRenderer>() };
                s.r.sharedMaterial = material;
                s.r.shadowCastingMode = ShadowCastingMode.Off;
                s.r.receiveShadows = false;
                s.r.lightProbeUsage = LightProbeUsage.Off;
                s.r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            }
            s.f.sharedMesh = meshes[Mathf.Clamp(variant, 0, meshes.Length - 1)];
            s.age = 0;
            s.seed = Random.value * 40f;
            return s;
        }

        void Begin(Shard s)
        {
            live.Add(s);
            s.go.SetActive(s.delay <= 0);
            Place(s, 0);
        }

        void Release(Shard s, bool remove = true)
        {
            if (s.go) s.go.SetActive(false);
            pool.Push(s);
            if (remove) live.Remove(s);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var s = live[i];
                if (!s.go)
                {
                    live.RemoveAt(i);
                    continue;
                }
                s.age += dt;
                if (s.age < s.delay) continue;
                if (!s.go.activeSelf) s.go.SetActive(true);
                float a = s.age - s.delay;
                if (a >= s.life)
                {
                    s.go.SetActive(false);
                    pool.Push(s);
                    live.RemoveAt(i);
                    continue;
                }
                if (s.cluster && !s.flying && a >= PopAt)
                {
                    // 整簇崩开：从「长在爆心的冰晶」变成往外飞的一块（位置挪到冰晶中段，免得一下跳到爆心）
                    s.flying = true;
                    s.pos += s.dir * s.length * 0.5f;
                }
                if (s.flying)
                {
                    s.vel.y -= Gravity * dt;
                    s.vel *= Mathf.Exp(-0.8f * dt);
                    s.pos += s.vel * dt;
                    s.rot = Quaternion.AngleAxis(s.spin * dt, s.spinAxis) * s.rot;
                    float floor = s.groundY + s.size * 0.35f;
                    if (s.pos.y < floor)
                    {
                        // 落地弹一下、就地打转减慢
                        s.pos.y = floor;
                        if (s.vel.y < 0) s.vel.y = -s.vel.y * 0.3f;
                        s.vel.x *= 0.55f;
                        s.vel.z *= 0.55f;
                        s.spin *= 0.6f;
                    }
                }
                Place(s, a);
            }
        }

        void Place(Shard s, float a)
        {
            float k = s.life > 0 ? a / s.life : 0;
            // 余韵：最后四成寿命里一面一面地碎掉，同时缩一点
            float shatter = Mathf.Clamp01((k - 0.6f) / 0.4f);
            float shrink = 1 - 0.35f * shatter;
            // 刚崩开的那一下亮一点（往亮面推），0.12 s 内退掉
            float flash = s.cluster ? Mathf.Clamp01(1 - Mathf.Abs(a - PopAt) / 0.1f) * 0.45f : Mathf.Clamp01(1 - a / 0.1f) * 0.3f;
            if (s.cluster && !s.flying)
            {
                // 蓄：从爆心长出来（缓出 + 一点过冲），根部钉在爆心
                float u = Mathf.Clamp01(a / GrowTime);
                float grow = u * (2 - u) * (1 + 0.12f * Mathf.Sin(u * Mathf.PI));
                float len = Mathf.Max(0.02f, s.length * grow);
                s.t.SetPositionAndRotation(s.pos + s.dir * len * 0.5f, s.rot);
                s.t.localScale = new Vector3(s.size * Mathf.Max(0.15f, grow), len, s.size * Mathf.Max(0.15f, grow));
            }
            else
            {
                s.t.SetPositionAndRotation(s.pos, s.rot);
                float len = s.length * shrink, w = s.size * shrink;
                s.t.localScale = new Vector3(w, len, w);
            }
            block.SetVector(ParamsId, new Vector4(shatter, flash, s.seed, 0));
            s.r.SetPropertyBlock(block);
        }

        // ───────────── 网格 ─────────────

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

        /// <summary>
        /// 冰晶网格（中心在原点、沿 y 长 1、截面半径约 0.5）：0 = 长六棱双尖、1 = 粗五棱（顶尖歪一点）、2 = 扁四棱碎片。
        /// 侧面是四边形（两个三角形，对角线那条棱不画），上下各收成一个尖。每个三角形独立顶点 + 面法线，顶点色 = 到棱的距离
        /// </summary>
        public static Mesh BuildCrystal(int variant)
        {
            int n = variant switch { 1 => 5, 2 => 4, _ => 6 };
            float yA = variant == 1 ? -0.22f : -0.3f, yB = variant == 1 ? 0.14f : 0.22f;
            var ringA = new Vector3[n];
            var ringB = new Vector3[n];
            for (int i = 0; i < n; i++)
            {
                float ang = (i + Hash(i, 3 + variant) * 0.35f) * Mathf.PI * 2 / n;
                float ra = 0.5f * (0.82f + 0.3f * Hash(i, 11 + variant));
                float rb = ra * (0.78f + 0.2f * Hash(i, 17 + variant));
                float sx = variant == 2 ? 1.25f : 1f, sz = variant == 2 ? 0.45f : 1f;
                ringA[i] = new Vector3(Mathf.Cos(ang) * ra * sx, yA + 0.06f * (Hash(i, 23 + variant) - 0.5f), Mathf.Sin(ang) * ra * sz);
                ringB[i] = new Vector3(Mathf.Cos(ang) * rb * sx, yB + 0.08f * (Hash(i, 29 + variant) - 0.5f), Mathf.Sin(ang) * rb * sz);
            }
            var top = new Vector3(variant == 1 ? 0.12f : 0.03f, 0.5f, variant == 1 ? -0.06f : 0.02f);
            var bottom = new Vector3(-0.02f, variant == 1 ? -0.4f : -0.5f, 0.03f);
            var tris = new List<Vector3>();
            var hide = new List<int>();
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                // 侧面四边形 A_i, A_j, B_j, B_i（对角线 A_i–B_j 不画）
                AddTri(tris, hide, ringA[i], ringB[j], ringA[j], 2);
                AddTri(tris, hide, ringA[i], ringB[i], ringB[j], 1);
                // 顶尖、底尖
                AddTri(tris, hide, ringB[i], top, ringB[j], -1);
                AddTri(tris, hide, ringA[j], bottom, ringA[i], -1);
            }
            return Flat(tris, hide, $"FxCrystal {variant}");
        }

        /// <summary>加一个三角形（朝外：叉积指向远离中心的一侧）；hideEdge = 不画的那条棱对着的顶点序号（−1 = 三条都画）</summary>
        static void AddTri(List<Vector3> tris, List<int> hide, Vector3 a, Vector3 b, Vector3 c, int hideEdge)
        {
            var center = (a + b + c) / 3f;
            if (Vector3.Dot(Vector3.Cross(b - a, c - a), center) < 0)
            {
                (b, c) = (c, b);
                if (hideEdge == 1) hideEdge = 2;
                else if (hideEdge == 2) hideEdge = 1;
            }
            tris.Add(a);
            tris.Add(b);
            tris.Add(c);
            hide.Add(hideEdge);
        }

        static Mesh Flat(List<Vector3> tris, List<int> hide, string name)
        {
            int n = tris.Count;
            var pos = new Vector3[n];
            var nrm = new Vector3[n];
            var col = new Color32[n];
            var idx = new int[n];
            for (int t = 0; t < n; t += 3)
            {
                var fn = Vector3.Cross(tris[t + 1] - tris[t], tris[t + 2] - tris[t]).normalized;
                int h = hide[t / 3];
                for (int k = 0; k < 3; k++)
                {
                    pos[t + k] = tris[t + k];
                    nrm[t + k] = fn;
                    // 重心坐标：第 k 个分量 = 到第 k 个顶点对边的距离；不画的棱把那一维整体抬到 1
                    byte r = (byte)(k == 0 || h == 0 ? 255 : 0), g = (byte)(k == 1 || h == 1 ? 255 : 0), b = (byte)(k == 2 || h == 2 ? 255 : 0);
                    col[t + k] = new Color32(r, g, b, 255);
                    idx[t + k] = t + k;
                }
            }
            var m = new Mesh { name = name, vertices = pos, normals = nrm, colors32 = col, triangles = idx };
            m.RecalculateBounds();
            m.UploadMeshData(true);
            return m;
        }
    }
}
