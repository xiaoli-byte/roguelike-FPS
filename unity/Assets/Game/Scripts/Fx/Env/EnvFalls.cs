using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 2-1 冰瀑的流动感（D 路；<see cref="EnvFxHost"/> 找到场景里的「冰瀑」就挂上）：冰瀑是冻住的冰挂模型，这里给它加
    ///   · 几条贴着冰面往下淌的融水（Spiritfire/EnvFlow 窄带：一行行往冰面打射线，按命中点贴出网格，离冰面 0.12 m）；
    ///   · 瀑底的水雾（EnvMist，沿瀑底一线慢慢往外涌）和溅起的水滴；
    ///   · 冰面上一闪一闪的冰晶反光（往冰面随机打射线，命中点闪一下）；
    ///   · 从瀑顶簌簌往下落的冰粉。
    /// 相机 90 m 内才发粒子；融水带一直在（几十个三角形）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvIcefall : MonoBehaviour
    {
        public const float Reach = 90f, MistRate = 6f, GlintRate = 7f, PowderRate = 2.5f, DripRate = 5f;
        static Material flowMat;

        Bounds box;
        Vector3 face, side;
        float mistDebt, glintDebt, powderDebt, dripDebt;
        readonly List<MeshRenderer> streams = new();

        public int Streams => streams.Count;

        void OnDestroy()
        {
            foreach (var r in streams)
                if (r)
                    Destroy(r.gameObject);
        }

        public static EnvIcefall Attach(GameObject root)
        {
            if (!root) return null;
            var f = root.GetComponent<EnvIcefall>();
            if (f) return f;
            f = root.AddComponent<EnvIcefall>();
            f.Build();
            return f;
        }

        static Material FlowMaterial()
        {
            if (flowMat) return flowMat;
            var res = Resources.Load<Material>("Fx/Env/M_EnvFlow");
            if (res) return flowMat = res;
            var sh = Shader.Find("Spiritfire/EnvFlow");
            return flowMat = sh ? new Material(sh) { name = "M_EnvFlow (runtime)", hideFlags = HideFlags.DontSave } : null;
        }

        void Build()
        {
            var rs = GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return;
            box = rs[0].bounds;
            foreach (var r in rs) box.Encapsulate(r.bounds);
            // 冰瀑正面 = 冰瀑各段模型的前方（2-1：三段都转了 180°，朝南；根物体本身不转）
            face = transform.childCount > 0 ? transform.GetChild(0).forward : transform.forward;
            face.y = 0;
            face = face.sqrMagnitude > 1e-4f ? face.normalized : Vector3.back;
            side = new Vector3(face.z, 0, -face.x);
            var mat = FlowMaterial();
            if (!mat) return;
            // 五条融水：横向位置（占宽度比例）、起点高度比例、宽（米）
            var specs = new[] { (-0.3f, 0.92f, 1.8f), (-0.12f, 0.78f, 1.4f), (0.05f, 0.96f, 2.2f), (0.2f, 0.7f, 1.5f), (0.33f, 0.86f, 1.2f) };
            int seed = 0;
            foreach (var (u, top, width) in specs)
            {
                var mesh = StreamMesh(u, top, width, seed++);
                if (!mesh) continue;
                // 网格是世界坐标：物体放在原点、不挂父级（冰瀑根物体带旋转），挪进关卡场景，换关一起卸掉
                var go = new GameObject($"Env Meltwater {seed}", typeof(MeshFilter), typeof(MeshRenderer));
                if (gameObject.scene.IsValid()) UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(go, gameObject.scene);
                go.GetComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = ShadowCastingMode.Off;
                mr.receiveShadows = false;
                mr.lightProbeUsage = LightProbeUsage.Off;
                mr.reflectionProbeUsage = ReflectionProbeUsage.Off;
                streams.Add(mr);
            }
        }

        /// <summary>
        /// 一条融水带：从 top 高度往下每 1.2 m 一行，往冰面打射线贴点（世界坐标网格，挂在原点不缩放的物体上）。冰挂一层层往外凸：
        /// 相邻两行前后差太多、或者这一行没打到冰瀑，就断开另起一段（一条带可以是好几段，段与段之间不拉长三角）。
        /// uv0 = (横向 0..1, 从顶往下的累计长度)，uv1 = (种子, 段内长度, 段长)——着色器按段头段尾淡出
        /// </summary>
        Mesh StreamMesh(float u, float top, float width, int seed)
        {
            float w = box.size.x * Mathf.Abs(side.x) + box.size.z * Mathf.Abs(side.z);
            var c = box.center + side * (u * w);
            float y0 = box.min.y + 0.3f, y1 = box.min.y + box.size.y * top;
            var verts = new List<Vector3>();
            var uv = new List<Vector2>();
            var uv2 = new List<Vector4>();
            var tris = new List<int>();
            float along = 0, segLen = 0;
            int segFirst = 0, rowsInSeg = 0;
            Vector3 prev = default;
            void Close()
            {
                for (int i = segFirst; i < uv2.Count; i++) uv2[i] = new Vector4(uv2[i].x, uv2[i].y, segLen, 0);
                rowsInSeg = 0;
                segLen = 0;
            }
            var row = new Vector3[2];
            for (float y = y1; y >= y0; y -= 1.2f)
            {
                bool ok = true;
                for (int s = 0; s < 2; s++)
                {
                    float x = (s == 0 ? -0.5f : 0.5f) * width * (0.8f + 0.4f * Mathf.PerlinNoise(y * 0.15f, seed * 3.1f));
                    var o = c + side * x + face * (box.extents.magnitude + 5f);
                    o.y = y;
                    // 只认冰瀑自己的碰撞体（打到两边的崖壁不算）
                    if (!Physics.Raycast(o, -face, out var hit, box.extents.magnitude * 2f + 10f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ||
                        !hit.collider.transform.IsChildOf(transform))
                    {
                        ok = false;
                        break;
                    }
                    row[s] = hit.point + hit.normal * 0.12f;
                }
                var mid = (row[0] + row[1]) * 0.5f;
                if (!ok || rowsInSeg > 0 && Mathf.Abs(Vector3.Dot(mid - prev, face)) > 3f)
                {
                    if (rowsInSeg > 0) Close();
                    if (!ok) continue;
                    along += 1.2f;
                }
                if (rowsInSeg == 0) segFirst = verts.Count;
                else
                {
                    float d = Vector3.Distance(prev, mid);
                    along += d;
                    segLen += d;
                    int a = verts.Count - 2, b = a + 1, cc = a + 2, dd = a + 3;
                    tris.Add(a); tris.Add(cc); tris.Add(b);
                    tris.Add(b); tris.Add(cc); tris.Add(dd);
                }
                prev = mid;
                for (int s = 0; s < 2; s++)
                {
                    verts.Add(row[s]);
                    uv.Add(new Vector2(s, along));
                    uv2.Add(new Vector4(seed * 0.37f + 0.1f, segLen, 0, 0));
                }
                rowsInSeg++;
            }
            if (rowsInSeg > 0) Close();
            if (tris.Count < 6) return null;
            var mesh = new Mesh { name = $"EnvMeltwater_{seed}", hideFlags = HideFlags.DontSave };
            mesh.SetVertices(verts);
            mesh.SetUVs(0, uv);
            mesh.SetUVs(1, uv2);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            var cam = Camera.main;
            if (!cam || dt <= 0 || box.size.sqrMagnitude < 1) return;
            if (box.SqrDistance(cam.transform.position) > Reach * Reach) return;
            float k = Fx.Density * EnvParticles.Headroom * dt;
            float w = box.size.x * Mathf.Abs(side.x) + box.size.z * Mathf.Abs(side.z);
            var baseC = new Vector3(box.center.x, box.min.y, box.center.z) + face * (Mathf.Abs(Vector3.Dot(box.extents, new Vector3(Mathf.Abs(face.x), 0, Mathf.Abs(face.z)))) * 0.6f);

            // 瀑底水雾：沿瀑底一线往外涌
            int n = Take(ref mistDebt, MistRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = baseC + side * Random.Range(-0.45f, 0.45f) * w + face * Random.Range(0f, 3f) + Vector3.up * Random.Range(0.2f, 1.6f);
                EnvParticles.Emit("EnvMist", p, face * Random.Range(0.3f, 0.9f) + Vector3.up * Random.Range(0.05f, 0.25f), Random.Range(2.8f, 4.6f), Random.Range(3.5f, 5f),
                    new Color(0.86f, 0.93f, 1f, 0.45f));
            }
            // 溅起的水滴
            n = Take(ref dripDebt, DripRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = baseC + side * Random.Range(-0.4f, 0.4f) * w + Vector3.up * 0.3f;
                EnvParticles.Emit("Drop", p, face * Random.Range(0.5f, 1.5f) + Vector3.up * Random.Range(1.5f, 3f), Random.Range(0.06f, 0.1f), Random.Range(0.5f, 0.8f), EnvWater.Spray);
            }
            // 冰面反光点
            n = Take(ref glintDebt, GlintRate * k);
            for (int i = 0; i < n; i++)
            {
                var o = box.center + side * Random.Range(-0.45f, 0.45f) * w + face * (box.extents.magnitude + 5f);
                o.y = Random.Range(box.min.y + 1f, box.max.y - 1f);
                if (!Physics.Raycast(o, -face, out var hit, box.extents.magnitude * 2f + 10f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                EnvParticles.Emit("EnvGlint", hit.point + hit.normal * 0.15f, Vector3.zero, Random.Range(0.25f, 0.45f), Random.Range(0.5f, 0.9f), FxEnvStyles.Glint);
            }
            // 瀑顶簌簌落下的冰粉
            n = Take(ref powderDebt, PowderRate * k);
            for (int i = 0; i < n; i++)
            {
                var p = new Vector3(box.center.x, box.max.y - 0.5f, box.center.z) + side * Random.Range(-0.4f, 0.4f) * w + face * Random.Range(1f, 3f);
                EnvParticles.Emit("Powder", p, face * 0.4f + Vector3.down * Random.Range(1.5f, 3f), Random.Range(0.8f, 1.4f), Random.Range(1.5f, 2.2f),
                    new Color(0.93f, 0.97f, 1f, 0.45f));
            }
        }

        static int Take(ref float debt, float add)
        {
            debt = Mathf.Min(debt + add, 6f);
            int n = (int)debt;
            if (n <= 0) return 0;
            debt -= n;
            return FxBudget.Allow(n, false);
        }
    }

    /// <summary>
    /// 3-2 熔瀑的瀑底和瀑面（D 路；「Lava Fall」下的每条窄带一份）：流动本身在 Spiritfire/Lava 着色器里（快流向的纹理沿流向拉长、往下滚），
    /// 这里补：瀑底落进熔岩池的地方往上喷的火星和熔滴、慢慢升起的余烬和一缕缕黑烟；瀑面上偶尔一团熔滴顺着往下滑落。相机 50 m 内才发。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvLavaFall : MonoBehaviour
    {
        public const float Reach = 50f, SparkRate = 11f, DropRate = 3f, EmberRate = 4f, SootRate = 0.7f, GlobRate = 1.4f;

        Renderer band;
        float sparkDebt, dropDebt, emberDebt, sootDebt, globDebt;

        public static EnvLavaFall Attach(Renderer r)
        {
            if (!r) return null;
            var f = r.GetComponent<EnvLavaFall>();
            if (!f) f = r.gameObject.AddComponent<EnvLavaFall>();
            f.band = r;
            return f;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            var cam = Camera.main;
            if (!band || !cam || dt <= 0) return;
            var b = band.bounds;
            if (b.SqrDistance(cam.transform.position) > Reach * Reach) return;
            float k = Fx.Density * EnvParticles.Headroom * dt;
            float scale = Mathf.Clamp(Mathf.Max(b.size.x, b.size.z) / 3f, 0.5f, 1.5f);
            var foot = new Vector3(b.center.x, b.min.y + 0.25f, b.center.z);
            var top = new Vector3(b.center.x, b.max.y - 0.4f, b.center.z);
            int n = Take(ref sparkDebt, SparkRate * scale * k);
            for (int i = 0; i < n; i++)
            {
                var d = Random.insideUnitCircle * 2f;
                EnvParticles.Emit("EnvSpark", foot + new Vector3(d.x, 0, d.y) * 0.3f, new Vector3(d.x, Random.Range(3f, 6f), d.y), 0.045f, Random.Range(0.5f, 0.9f), FxEnvStyles.Spark);
            }
            n = Take(ref dropDebt, DropRate * scale * k);
            for (int i = 0; i < n; i++)
            {
                var d = Random.insideUnitCircle * 1.2f;
                EnvParticles.Emit("Molten", foot, new Vector3(d.x, Random.Range(2.5f, 4.2f), d.y), Random.Range(0.09f, 0.16f), Random.Range(0.5f, 0.8f), InfernoPalette.Molten);
            }
            n = Take(ref emberDebt, EmberRate * scale * k);
            for (int i = 0; i < n; i++)
            {
                var p = foot + new Vector3(Random.Range(-1f, 1f), Random.Range(0.2f, 1.5f), Random.Range(-1f, 1f));
                EnvParticles.Emit("EnvEmber", p, new Vector3(Random.Range(-0.3f, 0.3f), Random.Range(0.8f, 1.6f), Random.Range(-0.3f, 0.3f)), Random.Range(0.04f, 0.07f),
                    Random.Range(2f, 3.5f), FxEnvStyles.Ember);
            }
            n = Take(ref sootDebt, SootRate * scale * k);
            for (int i = 0; i < n; i++)
                EnvParticles.Emit("Soot", foot + Vector3.up * 0.6f, new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.8f, 1.3f), Random.Range(-0.2f, 0.2f)), Random.Range(0.7f, 1.1f),
                    Random.Range(1.8f, 2.6f), FxEnvStyles.InfernoSmoke);
            n = Take(ref globDebt, GlobRate * scale * k);
            for (int i = 0; i < n; i++)
            {
                var p = Vector3.Lerp(top, foot, Random.Range(0f, 0.4f));
                EnvParticles.Emit("Molten", p, Vector3.down * Random.Range(0.5f, 1.5f), Random.Range(0.14f, 0.22f), Random.Range(0.6f, 0.9f), InfernoPalette.MoltenHot);
            }
        }

        static int Take(ref float debt, float add)
        {
            debt = Mathf.Min(debt + add, 6f);
            int n = (int)debt;
            if (n <= 0) return 0;
            debt -= n;
            return FxBudget.Allow(n, false);
        }
    }
}
