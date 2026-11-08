using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 2-A 玄冰裂谷 · 打磨（2026-11-08，docs/level-design/maps/2-A.md §9）：
    ///   · 冰拱桥 / 雪拱桥（<see cref="ArchBridge"/>）：程序化外观网格——拱顶薄、拱脚厚、拱下缘一道弧，两头伸进缝壁；冰桥顶上一层薄雪、拱下挂冰溜，
    ///     雪桥是厚雪拱（雪檐垂边、底面露出老冰）。走行面照旧是显式碰撞盒（<see cref="LevelKit.Deck"/>），缝底从桥下穿过去还能走；
    ///   · 冰塔外壳（<see cref="SeracSkins"/>）：地形台（碰撞、站位、雪坡都不动）外面套一层多面体冰壳——噪声凹凸、底部外撇、顶沿雪檐；
    ///     不能上顶的冰塔再长几根歪斜的冰尖、顶上积雪帽，塔脚散碎冰；
    ///   · 冰瀑碎块（<see cref="IcefallBlocks"/>）：北面冰瀑坎上的大冰块（看得见走不到，程序化、不碰撞）；
    ///   · 低雾（<see cref="Mist"/>）：冰缝里冒的寒气、冰瀑脚、下游河谷、谷壁脚四处低雾带，把近 / 中 / 远三层切开；
    ///   · 本图光照（<see cref="LocalLook"/>）：太阳从西南偏南来（主视线朝北不再逆光）、环境光托亮暗部、渐变天（地平线最亮）、雾 / 远景地平线同色、
    ///     本图自己的后处理（LV_L2A_Look，优先级高于章节 VP_Frost，只改曝光和暗部，bridge.sh volumes 重写章节档时不受影响）。
    /// 网格全是平面着色（每个三角自己的顶点），存成 Dir 下的资产。
    /// </summary>
    public static partial class Level_2_A
    {
        static Material iceMat, iceDeepMat, snowMat, rockMat;
        const int SubIce = 0, SubDeep = 1, SubSnow = 2, SubRock = 3;

        static void PolishMaterials()
        {
            iceMat = Frosty("L2A_Ice", new Color(0.62f, 0.83f, 0.96f), 0.28f, 0.4f);
            iceDeepMat = Frosty("L2A_IceDeep", new Color(0.42f, 0.63f, 0.84f), 0.32f, 0.3f);
            snowMat = Frosty("L2A_Snow", new Color(0.93f, 0.96f, 1f), 0.95f, 0.15f);
            rockMat = Frosty("L2A_MoraineRock", new Color(0.47f, 0.49f, 0.54f), 0.9f, 0.12f);
        }

        static Material Frosty(string name, Color c, float roughness, float rim)
        {
            var m = LevelKit.Mat(Dir, name, c, roughness);
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Roughness", roughness);
            if (m.HasProperty("_ShadowTint")) m.SetColor("_ShadowTint", ShowcaseTheme.Frost.groundShadowTint);
            if (m.HasProperty("_RimStrength")) m.SetFloat("_RimStrength", rim);
            EditorUtility.SetDirty(m);
            return m;
        }

        static Material[] PolishMats => new[] { iceMat, iceDeepMat, snowMat, rockMat };

        // ───────────── 平面着色网格 ─────────────

        sealed class Facets
        {
            readonly List<Vector3> verts = new();
            readonly List<int>[] subs = { new(), new(), new(), new() };

            public int Triangles => verts.Count / 3;

            /// <summary>一个三角：按 outward 定朝向（法线和 outward 同侧）</summary>
            public void Tri(int sub, Vector3 a, Vector3 b, Vector3 c, Vector3 outward)
            {
                if (Vector3.Dot(Vector3.Cross(b - a, c - a), outward) < 0) (b, c) = (c, b);
                int i = verts.Count;
                verts.Add(a);
                verts.Add(b);
                verts.Add(c);
                subs[sub].Add(i);
                subs[sub].Add(i + 1);
                subs[sub].Add(i + 2);
            }

            /// <summary>四边形 a b c d（相邻顺序），按 outward 定朝向</summary>
            public void Quad(int sub, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 outward)
            {
                Tri(sub, a, b, c, outward);
                Tri(sub, a, c, d, outward);
            }

            public GameObject Build(string name, Transform parent, bool shadows = true)
            {
                var mesh = new Mesh { name = $"L2A_{name}", indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.SetVertices(verts);
                mesh.subMeshCount = subs.Length;
                for (int i = 0; i < subs.Length; i++) mesh.SetTriangles(subs[i], i);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                LevelKit.SaveAsset(mesh, $"{Dir}/Mesh_L2A_{name}.asset");
                var go = new GameObject(name);
                go.transform.SetParent(parent, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterials = PolishMats;
                r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                go.isStatic = true;
                return go;
            }
        }

        /// <summary>沿 a → b 的一圈截面放样：ring[i] 是第 i 站的一圈点（首尾相接），sub(i, j) 给第 i–i+1 站、第 j–j+1 边的子网格；center(i) 是该站的轴心（定朝外）</summary>
        static void Loft(Facets f, List<Vector3[]> rings, List<Vector3> centers, System.Func<int, int, int> sub, bool closeEnds)
        {
            int n = rings[0].Length;
            for (int i = 0; i + 1 < rings.Count; i++)
                for (int j = 0; j < n; j++)
                {
                    int k = (j + 1) % n;
                    var a = rings[i][j];
                    var b = rings[i + 1][j];
                    var c = rings[i + 1][k];
                    var d = rings[i][k];
                    var mid = (a + b + c + d) * 0.25f;
                    var axis = (centers[i] + centers[i + 1]) * 0.5f;
                    f.Quad(sub(i, j), a, b, c, d, mid - axis);
                }
            if (!closeEnds) return;
            foreach (int e in new[] { 0, rings.Count - 1 })
            {
                var ring = rings[e];
                var c0 = centers[e];
                var outDir = e == 0 ? centers[0] - centers[1] : centers[e] - centers[e - 1];
                var cap = Vector3.zero;
                foreach (var p in ring) cap += p;
                cap /= ring.Length;
                for (int j = 0; j < n; j++) f.Tri(sub(e == 0 ? 0 : rings.Count - 2, j), cap, ring[j], ring[(j + 1) % n], outDir);
            }
        }

        /// <summary>一块不规则冰块（12 面体近似：扭过的长方体每个角抖一下）：底面中心 at、尺寸、偏航 / 倾斜，顶面一层雪</summary>
        static void IceBlock(Facets f, Vector3 at, Vector3 size, float yaw, float tiltX, float tiltZ, int seed, bool snowTop, bool rock = false)
        {
            var rot = Quaternion.Euler(tiltX, yaw, tiltZ);
            var c = new Vector3[8];
            int k = 0;
            for (int y = 0; y < 2; y++)
                for (int z = 0; z < 2; z++)
                    for (int x = 0; x < 2; x++)
                    {
                        float shrink = y == 1 ? 0.62f + 0.25f * Hash(seed, k, 3) : 1f;
                        var lp = new Vector3((x - 0.5f) * size.x * shrink, y * size.y, (z - 0.5f) * size.z * shrink);
                        lp += new Vector3(Hash(seed, k, 5) - 0.5f, (Hash(seed, k, 7) - 0.5f) * 0.6f, Hash(seed, k, 9) - 0.5f) * Mathf.Min(size.x, size.z) * (rock ? 0.55f : 0.35f);
                        c[k++] = at + rot * lp;
                    }
            var center = at + rot * new Vector3(0, size.y * 0.5f, 0);
            // 六个面（索引：x + 2z + 4y）
            int[][] faces = { new[] { 0, 1, 3, 2 }, new[] { 4, 6, 7, 5 }, new[] { 0, 4, 5, 1 }, new[] { 2, 3, 7, 6 }, new[] { 0, 2, 6, 4 }, new[] { 1, 5, 7, 3 } };
            for (int i = 0; i < faces.Length; i++)
            {
                var q = faces[i];
                var mid = (c[q[0]] + c[q[1]] + c[q[2]] + c[q[3]]) * 0.25f;
                int sub = rock
                    ? (i == 1 && snowTop ? SubSnow : SubRock)
                    : i == 1 ? (snowTop ? SubSnow : SubIce) : i == 0 ? SubDeep : (Hash(seed, i, 11) < 0.35f ? SubDeep : SubIce);
                f.Quad(sub, c[q[0]], c[q[1]], c[q[2]], c[q[3]], mid - center);
            }
        }

        /// <summary>冰溜子：从 top 往下垂 length 米，底面半径 r 的四棱锥</summary>
        static void Icicle(Facets f, Vector3 top, float r, float length, int seed)
        {
            var tip = top + new Vector3((Hash(seed, 1, 1) - 0.5f) * 0.1f, -length, (Hash(seed, 2, 1) - 0.5f) * 0.1f);
            float a0 = Hash(seed, 3, 1) * 90f;
            var ring = new Vector3[4];
            for (int i = 0; i < 4; i++)
            {
                float a = (a0 + i * 90f) * Mathf.Deg2Rad;
                ring[i] = top + new Vector3(Mathf.Cos(a), 0.02f, Mathf.Sin(a)) * r;
            }
            for (int i = 0; i < 4; i++)
            {
                var a = ring[i];
                var b = ring[(i + 1) % 4];
                f.Tri(SubIce, a, b, tip, (a + b) * 0.5f - top + Vector3.down * 0.01f);
            }
        }

        // ───────────── 冰拱桥 / 雪拱桥 ─────────────

        enum ArchStyle { Ice, Snow }

        /// <summary>路线点：雪桥的桥面顶高（Spec 里雪桥路点用桥面高度，缝底挖通了）</summary>
        static readonly Dictionary<Vector2, float> archTops = new();

        /// <summary>
        /// 拱桥：c = 桥心（缝上），axis = 跨缝方向（单位向量），halfSpan = 桥心到桥面一头，width = 桥面宽（沿缝），depth = 缝深（拱脚往下伸进缝壁），
        /// crevHalf = 缝宽的一半（冰溜只挂在缝上方那段）。走行面是 Deck 盒子（顶面 = 两岸冰面较高那边 + 3 cm），网格只管外观。返回桥面顶高
        /// </summary>
        static float ArchBridge(string name, Transform parent, Vector2 c, Vector2 axis, float halfSpan, float width, float depth, float crevHalf, ArchStyle style,
            int seed, string meshKey)
        {
            var root = new GameObject(name).transform;
            root.SetParent(parent, false);
            var a2 = c - axis * halfSpan;
            var b2 = c + axis * halfSpan;
            float top = Mathf.Max(OnGround(a2 - axis * 0.5f).y, OnGround(b2 + axis * 0.5f).y) + 0.03f;
            LevelKit.Deck($"{name} 桥面 Collision", root, At(a2 - axis * 0.8f, top), At(b2 + axis * 0.8f, top), width, 1.2f);

            var tan = new Vector2(axis.y, -axis.x);
            Vector3 W(float x, float z, float y) => new(c.x + axis.x * x + tan.x * z, top + y, c.y + axis.y * x + tan.y * z);
            bool ice = style == ArchStyle.Ice;
            float capT = ice ? 0.22f : 0.5f, tMid = ice ? 1.05f : 1.7f, tEnd = depth * 1.05f, hw = width * 0.5f + 0.15f;
            float x0 = halfSpan + 1.2f;
            var f = new Facets();

            // 拱身：截面一圈 11 点（顶面两角 → 左侧 → 拱底 → 右侧），站距按拱脚加密
            const int stations = 26;
            var rings = new List<Vector3[]>();
            var centers = new List<Vector3>();
            float Jit(float x, int k, float amp) => Fbm(new Vector2(x * 0.85f + seed * 3.7f, k * 9.1f + seed), 1.6f, 2, seed) * amp;
            for (int i = 0; i <= stations; i++)
            {
                float s = (float)i / stations * 2 - 1;
                float x = Mathf.Sign(s) * Mathf.Pow(Mathf.Abs(s), 0.85f) * x0;
                float u = Mathf.Abs(x) / x0;
                float th = tMid + (tEnd - tMid) * Mathf.Pow(u, 2.6f);
                float sag = 0.18f * (1 - u);
                float body = th - capT;
                var pts = new (float z, float y)[]
                {
                    (-hw * 0.98f, -capT),
                    (-hw - 0.2f, -capT - body * 0.18f),
                    (-hw * 0.93f, -capT - body * 0.55f),
                    (-hw * 0.64f, -th * 0.93f),
                    (-hw * 0.26f, -th),
                    (0f, -th - sag),
                    (hw * 0.26f, -th),
                    (hw * 0.64f, -th * 0.93f),
                    (hw * 0.93f, -capT - body * 0.55f),
                    (hw + 0.2f, -capT - body * 0.18f),
                    (hw * 0.98f, -capT),
                };
                var ring = new Vector3[pts.Length];
                for (int k = 0; k < pts.Length; k++)
                {
                    float jz = k == 0 || k == pts.Length - 1 ? 0 : Jit(x, k, 0.16f);
                    float jy = k == 0 || k == pts.Length - 1 ? 0 : Jit(x + 17, k, k >= 3 && k <= 7 ? 0.14f : 0.1f);
                    ring[k] = W(x, pts[k].z + jz, pts[k].y + jy);
                }
                rings.Add(ring);
                centers.Add(W(x, 0, -capT - body * 0.5f));
            }
            // 子网格：两侧上半是冰（雪桥是雪檐），拱底一圈是深冰；顶面（被雪盖住）随便给冰
            Loft(f, rings, centers, (i, j) => j == 10 ? SubIce : j <= 1 || j >= 8 ? (ice ? SubIce : SubSnow) : !ice || j <= 2 || j >= 7 ? SubIce : SubDeep, true);

            // 雪盖：桥面平顶（= 碰撞盒顶），两边圆鼓的雪檐垂下去
            float ov = ice ? 0.3f : 0.55f, drop = ice ? 0.25f : 0.6f, xc = halfSpan + 0.45f;
            var caps = new List<Vector3[]>();
            var capC = new List<Vector3>();
            for (int i = 0; i <= 16; i++)
            {
                float x = ((float)i / 16 * 2 - 1) * xc;
                // 雪檐边逐段起伏（左右各自一份）：不是一块平板
                float lumpL = Fbm(new Vector2(x * 1.3f, seed * 5f), 1.4f, 2, seed + 7) * (ice ? 0.14f : 0.3f) + Hash(seed, i, 21) * (ice ? 0.1f : 0.22f);
                float lumpR = Fbm(new Vector2(x * 1.3f + 40f, seed * 5f), 1.4f, 2, seed + 9) * (ice ? 0.14f : 0.3f) + Hash(seed, i, 23) * (ice ? 0.1f : 0.22f);
                float ovL = ov * (0.8f + 0.4f * Hash(seed, i, 25)), ovR = ov * (0.8f + 0.4f * Hash(seed, i, 27));
                var pts = new (float z, float y)[]
                {
                    (-hw - ovL, -capT - drop - lumpL), (-hw - ovL * 0.92f, -capT * 0.45f - lumpL * 0.3f), (-hw - ovL * 0.35f, -0.03f), (-hw + 0.35f, 0f), (0f, 0f),
                    (hw - 0.35f, 0f), (hw + ovR * 0.35f, -0.03f), (hw + ovR * 0.92f, -capT * 0.45f - lumpR * 0.3f), (hw + ovR, -capT - drop - lumpR),
                };
                var ring = new Vector3[pts.Length];
                for (int k = 0; k < pts.Length; k++) ring[k] = W(x, pts[k].z, pts[k].y);
                caps.Add(ring);
                capC.Add(W(x, 0, -capT));
            }
            Loft(f, caps, capC, (i, j) => SubSnow, true);

            // 冰溜：拱底两道边、中线，缝上方那段（雪桥稀一些、短一些）
            int n = 0;
            foreach (float zf in new[] { -0.62f, -0.24f, 0.24f, 0.62f })
                for (float x = -crevHalf + 0.4f; x <= crevHalf - 0.4f; x += 0.55f)
                {
                    int h = seed * 1000 + n++;
                    if (Hash(h, 1, 31) > (ice ? 0.62f : 0.22f)) continue;
                    float u = Mathf.Abs(x) / x0;
                    float th = tMid + (tEnd - tMid) * Mathf.Pow(u, 2.6f);
                    float y = Mathf.Abs(zf) > 0.4f ? -th * 0.93f : -th;
                    float len = (0.35f + 1.2f * Hash(h, 2, 31)) * (1 - u * 0.8f) * (ice ? 1f : 0.6f);
                    Icicle(f, W(x, zf * hw, y + 0.05f), 0.1f + 0.1f * Hash(h, 3, 31), len, h);
                }

            var go = f.Build(meshKey, root);
            go.name = $"{name} 外观（程序化{(ice ? "冰" : "雪")}拱）";
            return top;
        }

        /// <summary>主裂谷冰桥：冰拱 + 桥头一对矮冰柱（远处认得出能过缝）；返回桥心上方的视线目标</summary>
        static Vector3 BuildIceBridge(Transform kit)
        {
            var (axis, tangent) = BridgeFrame(Great, BridgeAt);
            float halfSpan = Great.width * 0.5f + BridgeLand;
            float top = ArchBridge("主裂谷冰桥", kit, BridgeAt, axis, halfSpan, BridgeWidth, Great.depth, Great.width * 0.5f, ArchStyle.Ice, 11, "IceArch_Main");
            foreach (int side in new[] { -1, 1 })
            {
                var q = BridgeAt + axis * (side * (halfSpan + 1.6f)) + tangent * (side * (BridgeWidth * 0.5f + 1.6f));
                Put(PillarId, kit, q, side * 37 + 20, 0.85f, 0.3f);
            }
            return At(BridgeAt, top + 1.2f);
        }

        /// <summary>雪桥（缝上的非积雪坡跨段）：都做成雪拱，缝底挖通、从桥下能走过去</summary>
        static void BuildSnowArches(Transform kit)
        {
            archTops.Clear();
            int seed = 31;
            foreach (var cr in Crevasses)
                foreach (var span in cr.spans)
                {
                    if (span.drift) continue;
                    var (axis, _) = BridgeFrame(cr, span.at);
                    var at = Polyline(span.at, cr.path);
                    var on = PointOn(cr.path, at.t);
                    // 名字带坐标（主裂谷有两座雪桥）；网格资产用 ASCII 键，不能重名（重名会互相覆盖，前一座桥丢网格）
                    float top = ArchBridge($"{cr.name}雪桥 ({span.at.x:F0}, {span.at.y:F0})", kit, on, axis, cr.width * 0.5f + BridgeLand, span.half * 2f, cr.depth,
                        cr.width * 0.5f, ArchStyle.Snow, seed, $"SnowArch_{seed}");
                    seed++;
                    archTops[span.at] = top;
                }
        }

        /// <summary>缝上某点的跨缝方向 / 沿缝方向</summary>
        static (Vector2 axis, Vector2 tangent) BridgeFrame(Crevasse cr, Vector2 q)
        {
            var (_, t) = Polyline(q, cr.path);
            int i = Mathf.Clamp(Mathf.FloorToInt(t * (cr.path.Count - 1)), 0, cr.path.Count - 2);
            var tangent = (cr.path[i + 1] - cr.path[i]).normalized;
            return (new Vector2(-tangent.y, tangent.x), tangent);
        }

        /// <summary>折线上按参数 t（0–1，按点数等分）取点</summary>
        static Vector2 PointOn(List<Vector2> path, float t)
        {
            float f = Mathf.Clamp01(t) * (path.Count - 1);
            int i = Mathf.Clamp(Mathf.FloorToInt(f), 0, path.Count - 2);
            return Vector2.Lerp(path[i], path[i + 1], f - i);
        }

        // ───────────── 冰塔外壳 ─────────────

        /// <summary>
        /// 冰塔外壳：每座冰塔的地形台外面套一层多面体冰壳（圆角矩形截面 + 噪声凹凸、底部外撇、顶沿收紧），顶沿一圈雪檐；
        /// 不能上顶的冰塔（没有雪坡）整体略歪，顶上积雪帽 + 2–3 根歪斜冰尖；塔脚散碎冰。雪坡那一侧的壳往里收（不顶穿坡面）。外观件，不碰撞
        /// </summary>
        static void SeracSkins(Transform parent)
        {
            var f = new Facets();
            int si = 0;
            foreach (var (c, half, yaw, h, ramp) in Seracs)
            {
                int seed = 401 + si++ * 17;
                var (ax, az) = Axes(yaw);
                float top = OnGround(c).y;
                float ground = float.MaxValue;
                for (int k = 0; k < 8; k++)
                {
                    float a = k * Mathf.PI / 4;
                    var q = c + (ax * Mathf.Cos(a) * (half.x + 2.5f) + az * Mathf.Sin(a) * (half.y + 2.5f));
                    ground = Mathf.Min(ground, OnGround(q).y);
                }
                bool walkable = ramp != 0;
                var (rampAxis, rampExt) = walkable ? SeracAxis(yaw, half, ramp) : (Vector2.zero, 0f);
                var lean = walkable ? Vector2.zero : new Vector2(Hash(seed, 1, 41) - 0.5f, Hash(seed, 2, 41) - 0.5f).normalized * 0.07f;
                const int sides = 22;
                float[] lv = { -0.5f, 0.22f, 0.48f, 0.76f, 1f };
                float[] off = { 0.85f, 0.7f, 0.5f, 0.36f, 0.18f };
                var rings = new List<Vector3[]>();
                var centers = new List<Vector3>();
                for (int l = 0; l < lv.Length; l++)
                {
                    float y = l == 0 ? ground - 0.5f : l == lv.Length - 1 ? top - 0.06f : Mathf.Lerp(ground, top, lv[l]);
                    var shift = lean * (y - ground);
                    var ring = new Vector3[sides];
                    for (int j = 0; j < sides; j++)
                    {
                        float a = j * 2 * Mathf.PI / sides;
                        float ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                        // 圆角矩形（超椭圆 n = 5）
                        float ex = Mathf.Sign(ca) * Mathf.Pow(Mathf.Abs(ca), 0.4f), ez = Mathf.Sign(sa) * Mathf.Pow(Mathf.Abs(sa), 0.4f);
                        var dir = ax * ex * (half.x + off[l]) + az * ez * (half.y + off[l]);
                        var q = c + dir + shift;
                        // 大块凹凸（2.6 m 尺度）+ 每个顶点各自错一点：冰壳读成一块块崩出来的冰，不是光滑的筒
                        float bump = Fbm(q + Vector2.one * (seed + l * 3), 2.6f, 2, seed) * 0.75f + (Hash(seed, j * 7 + l, 43) - 0.5f) * 0.4f;
                        var radial = dir.normalized;
                        q += radial * bump;
                        if (walkable)
                        {
                            // 雪坡那一侧：坡宽之内往里收进地形台（不顶穿坡面）
                            var lq = q - c;
                            float along = Vector2.Dot(lq, rampAxis), lat = Mathf.Abs(Vector2.Dot(lq, new Vector2(-rampAxis.y, rampAxis.x)));
                            if (along > rampExt * 0.6f && lat < SeracRampW * 0.5f + 0.6f) q -= rampAxis * (along - rampExt + 0.7f);
                        }
                        float dy = l > 0 && l < lv.Length - 1 ? (Hash(seed, j, 47 + l) - 0.5f) * 1.1f
                            : l == lv.Length - 1 && !walkable ? (Hash(seed, j, 59) - 0.35f) * 1.6f : 0;
                        ring[j] = new Vector3(q.x, y + dy, q.y);
                    }
                    rings.Add(ring);
                    centers.Add(new Vector3(c.x + shift.x, y, c.y + shift.y));
                }
                Loft(f, rings, centers, (i, j) => i == 0 ? SubDeep : (Hash(seed, i * 31 + j, 49) < 0.22f ? SubDeep : SubIce), false);

                // 顶沿雪檐：内圈贴台面（离台沿 0.35 m），外圈挂在壳外 0.45 m、往下 0.35 m
                var topRing = rings[rings.Count - 1];
                var tc = centers[centers.Count - 1];
                var inner = new Vector3[sides];
                var outer = new Vector3[sides];
                for (int j = 0; j < sides; j++)
                {
                    var d = topRing[j] - tc;
                    d.y = 0;
                    var dn = d.normalized;
                    inner[j] = topRing[j] - dn * 0.55f + Vector3.up * 0.1f;
                    outer[j] = topRing[j] + dn * 0.45f + Vector3.down * (0.32f + Hash(seed, j, 51) * 0.18f);
                }
                if (walkable)
                {
                    for (int j = 0; j < sides; j++)
                    {
                        int k = (j + 1) % sides;
                        var mid = (inner[j] + inner[k] + outer[j] + outer[k]) * 0.25f;
                        var o = mid - tc;
                        o.y = Mathf.Max(o.y, 0.3f);
                        // 雪坡那一侧不铺（坡顶接台面，不要一道雪坎）
                        var lq = new Vector2(mid.x - c.x, mid.z - c.y);
                        if (Vector2.Dot(lq, rampAxis) > rampExt * 0.6f && Mathf.Abs(Vector2.Dot(lq, new Vector2(-rampAxis.y, rampAxis.x))) < SeracRampW * 0.5f + 0.8f)
                            continue;
                        f.Quad(SubSnow, inner[j], inner[k], outer[k], outer[j], o);
                    }
                }
                else
                {
                    // 积雪帽：外圈雪檐 + 隆起的顶
                    var crown = tc + Vector3.up * (0.45f + Hash(seed, 3, 53) * 0.3f);
                    for (int j = 0; j < sides; j++)
                    {
                        int k = (j + 1) % sides;
                        f.Quad(SubSnow, topRing[j] + Vector3.up * 0.05f, topRing[k] + Vector3.up * 0.05f, outer[k], outer[j], (topRing[j] + topRing[k]) * 0.5f - tc + Vector3.up * 0.2f);
                        f.Tri(SubSnow, topRing[j] + Vector3.up * 0.05f, topRing[k] + Vector3.up * 0.05f, crown, Vector3.up);
                    }
                    // 冰尖：2–3 根，歪着长在顶面边上（不能上顶的冰塔才有，顶上没人走）
                    int spires = 2 + (Hash(seed, 4, 55) > 0.5f ? 1 : 0);
                    for (int s = 0; s < spires; s++)
                    {
                        float a = (Hash(seed, 10 + s, 55) * 360f + s * 137f) * Mathf.Deg2Rad;
                        var lp = ax * Mathf.Cos(a) * half.x * 0.55f + az * Mathf.Sin(a) * half.y * 0.55f;
                        var basePt = new Vector3(c.x + lp.x, top - 0.4f, c.y + lp.y) + new Vector3(lean.x, 0, lean.y) * (top - ground);
                        Spire(f, basePt, 0.8f + 0.6f * Hash(seed, 20 + s, 55), 1.8f + 2.2f * Hash(seed, 30 + s, 55), new Vector3(lp.x, 0, lp.y).normalized,
                            8f + 8f * Hash(seed, 40 + s, 55), seed * 7 + s);
                    }
                }

                if (walkable)
                {
                    // 能上顶的冰塔：背离雪坡的两个角各靠一根冰尖（大半在台外、高出台面 1.5–2.5 m），轮廓不再是一块方台
                    var side = new Vector2(-rampAxis.y, rampAxis.x);
                    foreach (int sgn in new[] { -1, 1 })
                    {
                        var corner = c - rampAxis * rampExt + side * (sgn * (Vector2.Dot(side, ax) * half.x * Mathf.Sign(Vector2.Dot(side, ax)) +
                                                                                Mathf.Abs(Vector2.Dot(side, az)) * half.y) * 0.9f);
                        var outDir = (corner - c).normalized;
                        var basePt = At(corner + outDir * 0.55f, ground - 0.3f);
                        Spire(f, basePt, 0.75f + 0.25f * Hash(seed, 100 + sgn, 55), top - ground + 1.6f + Hash(seed, 110 + sgn, 55) * 1.1f,
                            new Vector3(outDir.x, 0, outDir.y), 5f + 5f * Hash(seed, 120 + sgn, 55), seed * 11 + sgn);
                    }
                }

                // 塔脚碎冰（雪坡那一侧不放）
                for (int k = 0; k < 7; k++)
                {
                    float a = (Hash(seed, 60 + k, 57) * 360f) * Mathf.Deg2Rad;
                    float r = 1.2f + Hash(seed, 70 + k, 57) * 2.4f;
                    var dir2 = ax * Mathf.Cos(a) * (half.x + r) + az * Mathf.Sin(a) * (half.y + r);
                    var q = c + dir2;
                    if (walkable && Vector2.Dot(dir2, rampAxis) > rampExt * 0.5f && Mathf.Abs(Vector2.Dot(dir2, new Vector2(-rampAxis.y, rampAxis.x))) < SeracRampW * 0.5f + 1.5f)
                        continue;
                    if (CrevasseCut(q, out _, out _) > 0.2f) continue;
                    float s = 0.35f + Hash(seed, 80 + k, 57) * 0.75f;
                    IceBlock(f, OnGround(q, -s * 0.3f), new Vector3(s * 1.3f, s, s * 1.1f), Hash(seed, 90 + k, 57) * 360f,
                        (Hash(seed, 91 + k, 57) - 0.5f) * 30f, (Hash(seed, 92 + k, 57) - 0.5f) * 30f, seed * 13 + k, Hash(seed, 93 + k, 57) > 0.5f);
                }
            }
            f.Build("SeracSkins", parent);
        }

        /// <summary>一根歪斜的冰尖：六棱、三段收分、断口平顶上一小团雪</summary>
        static void Spire(Facets f, Vector3 basePt, float r, float height, Vector3 leanDir, float leanDeg, int seed)
        {
            const int sides = 6;
            var tilt = Quaternion.AngleAxis(leanDeg, Vector3.Cross(Vector3.up, leanDir.sqrMagnitude > 0.01f ? leanDir : Vector3.right));
            float[] lv = { 0f, 0.45f, 0.8f, 1f };
            float[] rad = { 1f, 0.72f, 0.45f, 0.3f };
            var rings = new List<Vector3[]>();
            var centers = new List<Vector3>();
            for (int l = 0; l < lv.Length; l++)
            {
                var ring = new Vector3[sides];
                for (int j = 0; j < sides; j++)
                {
                    float a = (j * 60f + Hash(seed, j, 61) * 18f) * Mathf.Deg2Rad;
                    float rr = r * rad[l] * (0.85f + 0.3f * Hash(seed, j + l * 7, 63));
                    ring[j] = basePt + tilt * new Vector3(Mathf.Cos(a) * rr, lv[l] * height, Mathf.Sin(a) * rr);
                }
                rings.Add(ring);
                centers.Add(basePt + tilt * new Vector3(0, lv[l] * height, 0));
            }
            Loft(f, rings, centers, (i, j) => i == 0 && Hash(seed, j, 65) < 0.5f ? SubDeep : SubIce, false);
            var topRing = rings[rings.Count - 1];
            var tc = centers[centers.Count - 1];
            var cap = tc + Vector3.up * (0.25f + r * 0.15f);
            for (int j = 0; j < sides; j++) f.Tri(SubSnow, topRing[j], topRing[(j + 1) % sides], cap, Vector3.up);
        }

        // ───────────── 冰瀑碎块（北面，看得见走不到）─────────────

        /// <summary>
        /// 北面冰瀑坎上的大冰块：扇区里每隔几度一列，坎面上、坎顶、冰舌起点各一两块（3–8 m，歪斜、半埋），读成碎裂的冰瀑。外观件，不碰撞
        /// </summary>
        static void IcefallBlocks(Transform parent)
        {
            var f = new Facets();
            int n = 0;
            for (float az = NorthAz - NorthHalf - 4; az <= NorthAz + NorthHalf + 4; az += 3.2f)
            {
                foreach (float d in new[] { 3f, 7.5f, 12f, 19f, 28f })
                {
                    int h = 7000 + n++;
                    if (Hash(h, 1, 71) > 0.72f) continue;
                    float jaz = az + (Hash(h, 2, 71) - 0.5f) * 2.6f;
                    float dd = d + (Hash(h, 3, 71) - 0.5f) * 3f;
                    var q = RimPoint(jaz, dd);
                    float w = Sector(Azimuth(q), NorthAz, NorthHalf, NorthFade);
                    if (w < 0.35f) continue;
                    float s = (d < 15 ? 3.2f : 2.4f) + Hash(h, 4, 71) * (d < 15 ? 4.5f : 3f);
                    var size = new Vector3(s * (0.9f + Hash(h, 5, 71) * 0.6f), s * (0.7f + Hash(h, 6, 71) * 0.7f), s * (0.8f + Hash(h, 7, 71) * 0.5f));
                    IceBlock(f, OnGround(q, -size.y * 0.35f), size, Hash(h, 8, 71) * 360f, (Hash(h, 9, 71) - 0.5f) * 34f, (Hash(h, 10, 71) - 0.5f) * 34f, h,
                        Hash(h, 11, 71) > 0.35f);
                }
            }
            f.Build("IcefallBlocks", parent);
        }

        /// <summary>方位角 az（度，椭圆归一）方向、游玩区边界外 d 米处的点（沿外法线逼近）</summary>
        static Vector2 RimPoint(float az, float d)
        {
            float a = az * Mathf.Deg2Rad;
            var dir = new Vector2(Mathf.Cos(a) * EnvR.x, Mathf.Sin(a) * EnvR.y).normalized;
            var p = EnvC + new Vector2(Mathf.Cos(a) * EnvR.x, Mathf.Sin(a) * EnvR.y);
            for (int i = 0; i < 8; i++)
            {
                float err = -Inside(p) - d;
                p -= dir * err;
                if (Mathf.Abs(err) < 0.2f) break;
            }
            return p;
        }

        // ───────────── 北面远山（冰川源头）─────────────

        /// <summary>
        /// 北面远山：冰川上游方向的两道剪影带（前 430 m 一道山肩、后 580 m 两座大雪峰），中间一道垭口——冰舌从垭口里白着一路淌下来。
        /// 和远景环同一个不受光、不受雾的剪影着色器（几百米外雾早吃满了，受光材质看不见），顶色是雪，环脚是地平线色。看得见走不到，程序化
        /// </summary>
        static void FarMassif(Transform env)
        {
            var verts = new List<Vector3>();
            var cols = new List<Color>();
            var tris = new List<int>();
            Color Lin(Color c) => QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
            var horizon = Lin(LookFog);
            var rockC = new Color(0.34f, 0.4f, 0.5f);
            var snowC = new Color(0.94f, 0.97f, 1f);
            var iceC = new Color(0.82f, 0.9f, 0.98f);
            // (半径, 平均高, 雾化, 峰：方位偏移 / 高 / 半宽)
            var bands = new (float r, float baseH, float haze, (float off, float h, float w)[] peaks)[]
            {
                (430f, 30f, 0.16f, new[] { (-36f, 64f, 15f), (-23f, 46f, 9f), (22f, 60f, 13f), (36f, 44f, 10f) }),
                (580f, 52f, 0.26f, new[] { (-18f, 205f, 17f), (-7f, 118f, 9f), (14f, 180f, 15f), (29f, 128f, 13f), (-31f, 96f, 10f) }),
            };
            float[] rowFrac = { 0f, 0.06f, 0.3f, 0.5f, 0.64f, 0.77f, 0.89f, 1f };
            foreach (var band in bands)
            {
                int start = verts.Count;
                const int segs = 120;
                float a0 = NorthAz - 46f, a1 = NorthAz + 46f;
                for (int i = 0; i <= segs; i++)
                {
                    float az = Mathf.Lerp(a0, a1, i / (float)segs);
                    float off = Mathf.DeltaAngle(NorthAz, az);
                    float h = band.baseH + 6f * Fbm(new Vector2(az * 0.7f, band.r), 5f, 3, 17);
                    foreach (var (po, ph, pw) in band.peaks)
                    {
                        // 不对称：一边陡一边缓；山脊上再起一串小锯齿
                        float w = off < po ? pw : pw * 0.72f;
                        float t = 1 - Mathf.Abs(off - po) / w;
                        if (t <= 0) continue;
                        float jag = (Ridged(new Vector2(az * 2.4f, ph), 1.7f, 3, 23) - 0.45f) * 0.32f;
                        h = Mathf.Max(h, band.baseH + ph * Mathf.Pow(t, 1.25f) * (1 + jag * (1 - t * 0.6f)));
                    }
                    // 垭口：冰舌从这里下来（中间压低，整列涂成冰雪色）
                    float saddle = 1 - Smooth(4f, 11f, Mathf.Abs(off));
                    h = Mathf.Lerp(h, band.baseH * 0.7f, saddle * 0.85f);
                    // 两头没进地平线
                    h *= Smooth(0f, 8f, Mathf.Min(az - a0, a1 - az));
                    h = Mathf.Max(h, 2f);
                    float a = az * Mathf.Deg2Rad;
                    var xz = EnvC + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * band.r;
                    // 雪线随山脊起伏；垭口那几列整列是冰舌的冰雪色
                    float snowLine = band.baseH + 42f + 16f * Fbm(new Vector2(az * 1.3f, band.r), 3f, 2, 29);
                    for (int rr = 0; rr < rowFrac.Length; rr++)
                    {
                        float y = rr == 0 ? FarY - 120f : FarY + h * rowFrac[rr];
                        verts.Add(new Vector3(xz.x, y, xz.y));
                        var body = Color.Lerp(rockC, snowC, Smooth(snowLine - 6, snowLine + 6, y) * (rr == rowFrac.Length - 1 ? 1f : 0.92f));
                        body = Color.Lerp(body, iceC, saddle * Smooth(0.05f, 0.3f, rowFrac[rr]));
                        Color c = rr <= 1 ? horizon : Color.Lerp(Lin(body), horizon, band.haze * (rr == 2 ? 1.6f : 1f));
                        cols.Add(c);
                    }
                }
                for (int i = 0; i < segs; i++)
                    for (int rr = 0; rr + 1 < rowFrac.Length; rr++)
                    {
                        int q0 = start + i * rowFrac.Length + rr, q1 = q0 + 1, b0 = q0 + rowFrac.Length, b1 = b0 + 1;
                        tris.AddRange(new[] { q0, b0, b1, q0, b1, q1 });
                        tris.AddRange(new[] { q0, b1, b0, q0, q1, b1 });
                    }
            }
            var mesh = new Mesh { name = "L2A_FarMassif" };
            mesh.SetVertices(verts);
            mesh.SetColors(cols);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            LevelKit.SaveAsset(mesh, $"{Dir}/Mesh_L2A_FarMassif.asset");
            var shader = Shader.Find("Spiritfire/Backdrop") ?? Shader.Find("Universal Render Pipeline/Unlit");
            var mat = new Material(shader) { name = "M_L2A_FarMassif" };
            mat.SetColor("_Tint", Color.white);
            mat.SetFloat("_UseVertexColor", 1);
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", Color.white);
            LevelKit.SaveAsset(mat, $"{Dir}/M_L2A_FarMassif.mat");
            var go = new GameObject("北面远山（冰川源头）");
            go.transform.SetParent(env, false);
            go.isStatic = true;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.lightProbeUsage = LightProbeUsage.Off;
            mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
        }

        // ───────────── 南面终碛的漂砾 ─────────────

        /// <summary>终碛垄顶和外坡上一堆堆漂砾（1.5–4.5 m 的岩块、顶上积雪），碛垄读成碎石堆起来的垄，不是一道平顶岩墙。外观件，不碰撞</summary>
        static void MoraineBoulders(Transform env)
        {
            var f = new Facets();
            int n = 0;
            for (float az = SouthAz - SouthHalf - 6; az <= SouthAz + SouthHalf + 6; az += 2.2f)
                foreach (float d in new[] { 1.6f, 3.4f, 5.5f, 8f, 12f, 20f })
                {
                    int h = 9000 + n++;
                    if (Hash(h, 1, 81) > (d < 7 ? 0.3f : d < 13 ? 0.55f : 0.35f)) continue;
                    var q = RimPoint(az + (Hash(h, 2, 81) - 0.5f) * 2f, d + (Hash(h, 3, 81) - 0.5f) * 1.6f);
                    if (Sector(Azimuth(q), SouthAz, SouthHalf, SouthFade) < 0.3f) continue;
                    float sz = 0.9f + Hash(h, 4, 81) * (d < 7 ? 1.4f : d < 13 ? 3f : 2f);
                    IceBlock(f, OnGround(q, -sz * 0.3f), new Vector3(sz * (0.9f + Hash(h, 5, 81) * 0.5f), sz * (0.6f + Hash(h, 6, 81) * 0.5f), sz),
                        Hash(h, 7, 81) * 360f, (Hash(h, 8, 81) - 0.5f) * 24f, (Hash(h, 9, 81) - 0.5f) * 24f, h, Hash(h, 10, 81) > 0.3f, true);
                }
            f.Build("MoraineBoulders", env);
        }

        // ───────────── 低雾 ─────────────

        /// <summary>低雾带（Fx 预设 EnvMist 复制成常驻发射器）：主裂谷里冒的寒气、北面冰瀑脚、南面下游河谷、东西谷壁脚</summary>
        static void Mist(Transform parent, LevelKit.Report rep)
        {
            var root = new GameObject("Atmosphere").transform;
            root.SetParent(parent, false);
            var near = new Color(0.9f, 0.94f, 1f, 0.42f);
            var far = new Color(0.86f, 0.91f, 0.98f, 0.6f);
            int n = 0;
            // 主裂谷：缝底贴着冒寒气（四段），雾从缝里漫出来一点
            foreach (float t in new[] { 0.16f, 0.36f, 0.62f, 0.84f })
            {
                var q = PointOn(Great.path, t);
                var (_, tan) = BridgeFrame(Great, q);
                float yaw = Mathf.Atan2(tan.x, tan.y) * Mathf.Rad2Deg;
                n += Emitter(root, "EnvMist", $"crevasse {t:F2}", OnGround(q, 1.2f), yaw, new Vector3(Great.width * 0.8f, 34, 2.5f), 26, 16, (5, 10), (0.08f, 0.22f), -0.005f, near) ? 1 : 0;
            }
            // 北面冰瀑脚：把冰原（中景）和冰舌 / 雪峰（远景）切开
            var northFoot = RimPoint(NorthAz, 2f);
            n += Emitter(root, "EnvMist", "icefall foot", OnGround(northFoot, 2.5f), 0, new Vector3(150, 16, 4), 60, 22, (12, 22), (0.04f, 0.12f), -0.004f, far) ? 1 : 0;
            // 南面下游河谷：碛垄豁口外的低谷里一层雾
            var south = RimPoint(SouthAz, 60f);
            n += Emitter(root, "EnvMist", "outwash valley", At(south, OnGround(south).y + 3f), 0, new Vector3(220, 60, 5), 70, 26, (16, 28), (0.03f, 0.1f), -0.003f, far) ? 1 : 0;
            // 东西谷壁脚
            foreach (float az in new[] { 2f, 178f })
            {
                var q = RimPoint(az, 3f);
                n += Emitter(root, "EnvMist", $"wall foot {az:F0}", OnGround(q, 2f), 0, new Vector3(30, 150, 3.5f), 40, 22, (10, 18), (0.04f, 0.12f), -0.004f, far) ? 1 : 0;
            }
            rep.Line($"氛围：{n} 个低雾发射器（主裂谷寒气 ×4、冰瀑脚、下游河谷、东西谷壁脚）");
        }

        /// <summary>从 Fx 预设复制一个常驻发射器：盒形区域（宽 × 长 × 高，长沿 yaw 方向）里往上发，预热好（同 Level_ZhurongKit31.Emitter）</summary>
        static bool Emitter(Transform parent, string preset, string name, Vector3 center, float yaw, Vector3 box, int max, float life,
            (float, float) size, (float, float) speed, float gravity, Color color)
        {
            var src = Resources.Load<GameObject>($"Fx/Presets/{preset}");
            if (!src) return false;
            var go = Object.Instantiate(src, parent);
            go.name = $"Atmosphere · {name}";
            go.transform.SetPositionAndRotation(center, Quaternion.Euler(0, yaw, 0));
            go.transform.localScale = Vector3.one;
            var ps = go.GetComponent<ParticleSystem>();
            if (!ps)
            {
                Object.DestroyImmediate(go);
                return false;
            }
            var main = ps.main;
            main.loop = true;
            main.prewarm = true;
            main.playOnAwake = true;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.duration = Mathf.Max(5, life);
            main.maxParticles = max;
            main.startLifetime = new ParticleSystem.MinMaxCurve(life * 0.8f, life * 1.2f);
            main.startSize = new ParticleSystem.MinMaxCurve(size.Item1, size.Item2);
            main.startSpeed = new ParticleSystem.MinMaxCurve(speed.Item1, speed.Item2);
            if (gravity != 0) main.gravityModifier = gravity;
            main.startColor = color;
            var em = ps.emission;
            em.enabled = true;
            em.rateOverTime = max / life;
            var sh = ps.shape;
            sh.enabled = true;
            sh.shapeType = ParticleSystemShapeType.Box;
            sh.rotation = new Vector3(-90, 0, 0);
            sh.position = Vector3.zero;
            sh.scale = box;
            return true;
        }

        // ───────────── 本图光照 ─────────────

        /// <summary>本图的雾色 = 远景环的地平线色（雾里的远地面和远景环脚无缝）</summary>
        static readonly Color LookFog = new(0.8f, 0.87f, 0.94f);

        /// <summary>
        /// 在章节光照（ShowcaseSceneBuilder.BuildLighting）之上只改本图：太阳从西南偏南斜照（俯仰 30°，主视线朝北、冰瀑受光，冰塔林侧光），
        /// 三色环境光托亮暗部（雪地反弹），渐变天（天顶淡蓝、地平线最亮），雾色同地平线，反射稍强；
        /// 本图后处理 LV_L2A_Look（优先级 5）：曝光比章节档亮一点、暗部稍提，雪面亮部交给 Neutral 色调映射压住
        /// </summary>
        static void LocalLook()
        {
            var sun = RenderSettings.sun;
            if (sun)
            {
                sun.transform.rotation = Quaternion.Euler(30f, 32f, 0);
                sun.intensity = 1.3f;
                sun.color = new Color(1f, 0.97f, 0.92f);
            }
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.5f, 0.6f, 0.78f);
            RenderSettings.ambientEquatorColor = new Color(0.68f, 0.73f, 0.8f);
            RenderSettings.ambientGroundColor = new Color(0.64f, 0.69f, 0.78f);
            RenderSettings.reflectionIntensity = 0.85f;
            RenderSettings.fogColor = LookFog;

            var sky = new Material(Shader.Find("Spiritfire/SkyGradient"));
            sky.SetColor("_TopColor", new Color(0.32f, 0.5f, 0.8f));
            sky.SetColor("_HorizonColor", new Color(0.88f, 0.93f, 0.99f));
            sky.SetColor("_BottomColor", LookFog);
            sky.SetColor("_SunColor", new Color(1f, 0.96f, 0.88f));
            sky.SetFloat("_Exposure", 1f);
            sky.SetFloat("_HorizonSharpness", 3.2f);
            sky.SetFloat("_HorizonGlow", 0.45f);
            // _SunSize 是 1 − cos(日面半径)：0.00015 ≈ 1°（0.03 会画成十几度的大白盘）
            sky.SetFloat("_SunSize", 0.00015f);
            sky.SetFloat("_SunHalo", 0.28f);
            LevelKit.SaveAsset(sky, $"{Dir}/SKY_L2A.mat");
            RenderSettings.skybox = sky;

            string path = $"{Dir}/LV_L2A_Look.asset";
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            LevelKit.SaveAsset(profile, path);
            var color = profile.Add<ColorAdjustments>(true);
            color.postExposure.Override(-0.62f);
            color.contrast.Override(23f);
            var smh = profile.Add<ShadowsMidtonesHighlights>(true);
            smh.shadows.Override(new Vector4(1f, 1.02f, 1.06f, 0.06f));
            smh.highlights.Override(new Vector4(1f, 1f, 1f, -0.04f));
            ShowcaseSceneBuilder.PersistVolumeComponents(profile);
            var vol = new GameObject("Local Look Volume（2-A）").AddComponent<Volume>();
            vol.isGlobal = true;
            vol.priority = 5;
            vol.sharedProfile = profile;
        }
    }
}
