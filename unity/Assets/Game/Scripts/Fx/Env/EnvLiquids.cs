using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一片水面的活气（D 路；<see cref="EnvFxHost"/> 给每块 Spiritfire/Water 水面挂一个，流沙的旋涡模式除外）：
    ///   相机 45 m 内隔一两秒在水面上随机荡一道小涟漪（<see cref="EnvWater.Ripple"/>：鱼吐泡、水滴），
    ///   冰原（2-3 冰窟窿、2-4 北冥海）水面再冒一缕缕寒气（EnvMist，贴水面、慢慢升起散开）。
    /// 只在水面渲染器显示时工作，位置取水体（WaterVolume）里的点——1-4 月牙泉被旱魃抽干时跟着水位往下走，水没了就停。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvWaterBody : MonoBehaviour
    {
        public const float Reach = 45f, MistRate = 2.4f;
        static readonly int ShoreDepthId = Shader.PropertyToID("_ShoreDepth");

        Renderer surface;
        bool cold;
        float nextRipple, mistDebt, draining, lastY = float.MinValue;

        public int Ripples { get; private set; }

        public static EnvWaterBody Attach(Renderer r, EnvTheme theme)
        {
            if (!r) return null;
            var w = r.GetComponent<EnvWaterBody>();
            if (!w) w = r.gameObject.AddComponent<EnvWaterBody>();
            w.surface = r;
            w.cold = theme == EnvTheme.Frost;
            // 鲲鹏的冰窟（北冥海）是很深的水：水下会有鲲的身子之类贴着水面的东西，岸边白沫只认真正冒出水面的那一线
            foreach (var hole in FindObjectsByType<IceHole>())
                if (hole && hole.WaterSurface == r)
                {
                    var mpb = new MaterialPropertyBlock();
                    r.GetPropertyBlock(mpb);
                    mpb.SetFloat(ShoreDepthId, 0.1f);
                    r.SetPropertyBlock(mpb);
                }
            return w;
        }

        void Update()
        {
            if (!surface || !surface.enabled || !surface.gameObject.activeInHierarchy || Time.deltaTime <= 0) return;
            var cam = Camera.main;
            if (!cam) return;
            var eye = cam.transform.position;
            var b = surface.bounds;
            if (b.SqrDistance(eye) > Reach * Reach) return;
            float now = Time.time;
            // 水位在往下掉（1-4 旱魃抽泉）：水面一阵阵乱颤、水珠被往上抽
            float y = b.max.y;
            float fall = lastY > float.MinValue ? (lastY - y) / Time.deltaTime : 0;
            lastY = y;
            draining = Mathf.MoveTowards(draining, fall > 0.03f ? 1f : 0f, Time.deltaTime * 2f);
            if (now >= nextRipple)
            {
                float area = Mathf.Max(4f, b.size.x * b.size.z);
                nextRipple = now + Random.Range(0.7f, 2f) * Mathf.Clamp(120f / area, 0.4f, 1.6f) * Mathf.Lerp(1f, 0.12f, draining);
                if (OnWater(b, eye, out var p))
                {
                    EnvWater.Ripple(p, Random.Range(0.8f, 1.6f) * (1f + draining), Random.Range(0.25f, 0.45f) * (1f + draining * 0.8f));
                    Ripples++;
                    if (draining > 0.3f && FxBudget.Allow(3, false) > 0)
                        for (int i = 0; i < 3; i++)
                            EnvParticles.Emit("Drop", p, new Vector3(Random.Range(-0.4f, 0.4f), Random.Range(2.5f, 4.5f), Random.Range(-0.4f, 0.4f)), Random.Range(0.06f, 0.1f),
                                Random.Range(0.5f, 0.8f), EnvWater.Spray);
                }
            }
            if (!cold) return;
            mistDebt = Mathf.Min(4f, mistDebt + MistRate * Fx.Density * EnvParticles.Headroom * Time.deltaTime);
            while (mistDebt >= 1f)
            {
                mistDebt -= 1f;
                if (FxBudget.Allow(1, false) <= 0 || !OnWater(b, eye, out var p)) break;
                EnvParticles.Emit("EnvMist", p + Vector3.up * 0.25f, new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.12f, 0.3f), Random.Range(-0.2f, 0.2f)),
                    Random.Range(1.2f, 2.4f), Random.Range(3.5f, 5f), FxEnvStyles.Mist);
            }
        }

        /// <summary>水面上随机一点（偏向相机附近：取相机周围 22 m 与水面包围盒的交集），要在某个水体里</summary>
        static bool OnWater(Bounds b, Vector3 eye, out Vector3 p)
        {
            float x0 = Mathf.Max(b.min.x, eye.x - 22f), x1 = Mathf.Min(b.max.x, eye.x + 22f);
            float z0 = Mathf.Max(b.min.z, eye.z - 22f), z1 = Mathf.Min(b.max.z, eye.z + 22f);
            if (x0 >= x1 || z0 >= z1)
            {
                x0 = b.min.x;
                x1 = b.max.x;
                z0 = b.min.z;
                z1 = b.max.z;
            }
            for (int i = 0; i < 6; i++)
            {
                var q = new Vector3(Random.Range(x0, x1), b.max.y - 0.05f, Random.Range(z0, z1));
                var w = WaterVolume.At(q, out _);
                if (!w) continue;
                p = new Vector3(q.x, w.Surface, q.z);
                return true;
            }
            p = default;
            return false;
        }
    }

    /// <summary>
    /// 流沙的沙流（D 路；1-2 雅丹）：表面一条条细沙线顺着螺旋往中心卷（切向为主、往里收，越靠里越快），芯里不时冒一小股沙尘。
    /// 配合 Spiritfire/Water 旋涡模式的螺旋沙纹，读成「沙在往中心流」。相机 35 m 内才发。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvQuicksand : MonoBehaviour
    {
        public const float Reach = 35f, GrainRate = 26f, PuffRate = 0.9f;
        static readonly Color Grain = new(0.6f, 0.45f, 0.3f, 0.85f), Puff = new(0.82f, 0.68f, 0.48f, 0.35f);

        Quicksand sand;
        float grainDebt, puffDebt;

        public static EnvQuicksand Attach(Quicksand q)
        {
            if (!q) return null;
            var e = q.GetComponent<EnvQuicksand>();
            if (!e) e = q.gameObject.AddComponent<EnvQuicksand>();
            e.sand = q;
            return e;
        }

        void Update()
        {
            if (!sand || !sand.isActiveAndEnabled || Time.deltaTime <= 0) return;
            var cam = Camera.main;
            if (!cam) return;
            var c = sand.transform.position;
            if ((cam.transform.position - c).sqrMagnitude > Reach * Reach) return;
            float R = Mathf.Max(0.5f, sand.radius), core = Mathf.Clamp(sand.coreRadius, 0.2f, R * 0.8f);
            float k = Fx.Density * EnvParticles.Headroom * Time.deltaTime * Mathf.Clamp(R / 4.5f, 0.5f, 1.8f);
            grainDebt = Mathf.Min(8f, grainDebt + GrainRate * k);
            int n = (int)grainDebt;
            grainDebt -= n;
            n = n > 0 ? FxBudget.Allow(n, false) : 0;
            for (int i = 0; i < n; i++)
            {
                float r = R * Mathf.Sqrt(Random.Range(0.08f, 0.95f));
                float th = Random.Range(0f, Mathf.PI * 2f);
                var d = new Vector3(Mathf.Cos(th), 0, Mathf.Sin(th));
                var p = c + d * r + Vector3.up * 0.05f;
                var tangent = new Vector3(d.z, 0, -d.x);
                float speed = 1.1f + 1.9f * (1f - r / R);
                EnvParticles.Emit("EnvGrain", p, (tangent + (-d) * 0.45f) * speed, Random.Range(0.045f, 0.075f), Random.Range(0.6f, 1f), Grain);
            }
            puffDebt = Mathf.Min(3f, puffDebt + PuffRate * Fx.Density * EnvParticles.Headroom * Time.deltaTime);
            if (puffDebt >= 1f && FxBudget.Allow(1, false) > 0)
            {
                puffDebt -= 1f;
                var q = Random.insideUnitCircle * core * 0.7f;
                EnvParticles.Emit("Dust", c + new Vector3(q.x, 0.1f, q.y), new Vector3(0, Random.Range(0.3f, 0.7f), 0), Random.Range(0.5f, 0.9f), Random.Range(1f, 1.6f), Puff);
            }
        }
    }

    /// <summary>
    /// 熔岩面上的冒泡溅火星（D 路；有熔岩的关卡一个，跟着相机）：相机 22 m 内的熔岩上隔零点几秒「啵」一下——溅起一小簇熔滴和拉丝火星，
    /// 有时带一缕黑烟（着色器里的亮泡是一直在鼓的，这里补上破开那一下的飞溅）。另外按画质（中 2 / 高 4 片）在相机前方的熔岩上立几片热浪扭曲面片
    /// （<see cref="EnvHeatHaze"/>，读相机不透明贴图，低画质不开）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvLavaFx : MonoBehaviour
    {
        public const float Reach = 22f;

        float nextPop;
        public int Pops { get; private set; }

        void Update()
        {
            if (!LavaField.Any || Time.deltaTime <= 0) return;
            var cam = Camera.main;
            if (!cam) return;
            float now = Time.time;
            if (now < nextPop) return;
            nextPop = now + Random.Range(0.22f, 0.55f) / Mathf.Max(0.3f, Fx.Density * EnvParticles.Headroom);
            var eye = cam.transform.position;
            var fwd = cam.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            for (int i = 0; i < 5; i++)
            {
                var q = eye + fwd * Random.Range(2f, Reach) + new Vector3(fwd.z, 0, -fwd.x) * Random.Range(-12f, 12f);
                if (!LavaField.IsLavaAt(q.x, q.z) || !LavaField.TrySurfaceHeight(q, out float y)) continue;
                if (y > eye.y + 3f) continue;
                Pop(new Vector3(q.x, y + 0.05f, q.z), Random.value < 0.2f ? 1.6f : 1f);
                Pops++;
                return;
            }
        }

        /// <summary>一下冒泡破开：熔滴 + 拉丝火星（+ 大泡带一缕黑烟）</summary>
        public static void Pop(Vector3 at, float size)
        {
            int drops = FxBudget.Allow(Mathf.RoundToInt(Random.Range(2, 4) * size), false);
            for (int i = 0; i < drops; i++)
            {
                var d = Random.insideUnitCircle * 0.8f;
                EnvParticles.Emit("Molten", at, new Vector3(d.x, Random.Range(2.2f, 3.8f) * Mathf.Sqrt(size), d.y), Random.Range(0.12f, 0.2f) * size, Random.Range(0.45f, 0.7f),
                    InfernoPalette.Molten);
            }
            int sparks = FxBudget.Allow(Mathf.RoundToInt(Random.Range(2, 4) * size), false);
            for (int i = 0; i < sparks; i++)
            {
                var d = Random.insideUnitCircle * 1.6f;
                EnvParticles.Emit("EnvSpark", at, new Vector3(d.x, Random.Range(2.5f, 5f) * Mathf.Sqrt(size), d.y), 0.06f, Random.Range(0.35f, 0.65f), FxEnvStyles.Spark);
            }
            if (size > 1.2f && FxBudget.Allow(1, false) > 0)
                EnvParticles.Emit("Soot", at + Vector3.up * 0.2f, new Vector3(0, 0.9f, 0), Random.Range(0.6f, 0.9f), Random.Range(1.2f, 1.8f), FxEnvStyles.InfernoSmoke);
        }
    }

    /// <summary>
    /// 热浪扭曲（D 路，可选、按画质）：竖直、绕 Y 轴朝相机的一片面片（Spiritfire/EnvHeatHaze：读相机不透明贴图，按往上走的噪声错开采样），
    /// 立在熔岩面上；<see cref="EnvLavaFx"/> 每 0.5 s 把它们挪到相机前方 6–20 m 的熔岩上。画质 低 0 / 中 2 / 高 4 片，远了淡掉。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvHeatHaze : MonoBehaviour
    {
        public const string ShaderName = "Spiritfire/EnvHeatHaze";
        static readonly int FadeId = Shader.PropertyToID("_Fade");
        static Material material;
        static Mesh quad;

        readonly Transform[] sheets = new Transform[4];
        readonly MeshRenderer[] rends = new MeshRenderer[4];
        readonly float[] fade = new float[4], want = new float[4];
        MaterialPropertyBlock block;
        float nextPlace;

        public static int Budget => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 0,
            ArtQualityLevel.Medium => 2,
            _ => 4,
        };

        /// <summary>正在显示的热浪片数（测试用）</summary>
        public int Shown
        {
            get
            {
                int n = 0;
                for (int i = 0; i < rends.Length; i++)
                    if (rends[i] && rends[i].enabled)
                        n++;
                return n;
            }
        }

        /// <summary>材质：Resources/Fx/Env/M_EnvHeatHaze（打包时着色器跟着材质进包），没有就现找着色器</summary>
        static Material Mat()
        {
            if (material) return material;
            var res = Resources.Load<Material>("Fx/Env/M_EnvHeatHaze");
            if (res) return material = res;
            var sh = Shader.Find(ShaderName);
            if (!sh) return null;
            material = new Material(sh) { name = "M_EnvHeatHaze (runtime)", hideFlags = HideFlags.DontSave };
            return material;
        }

        static Mesh Quad()
        {
            if (quad) return quad;
            quad = new Mesh { name = "EnvHeatHazeQuad", hideFlags = HideFlags.DontSave };
            quad.SetVertices(new[] { new Vector3(-0.5f, 0, 0), new Vector3(0.5f, 0, 0), new Vector3(-0.5f, 1, 0), new Vector3(0.5f, 1, 0) });
            quad.SetUVs(0, new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) });
            quad.SetTriangles(new[] { 0, 2, 1, 1, 2, 3 }, 0);
            quad.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(1, 1, 1));
            return quad;
        }

        void Update()
        {
            var cam = Camera.main;
            float dt = Time.deltaTime;
            if (!cam || dt <= 0) return;
            int budget = LavaField.Any ? Budget : 0;
            var eye = cam.transform.position;
            if (Time.time >= nextPlace)
            {
                nextPlace = Time.time + 0.5f;
                for (int i = 0; i < sheets.Length; i++) want[i] = 0;
                var fwd = cam.transform.forward;
                fwd.y = 0;
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
                var right = new Vector3(fwd.z, 0, -fwd.x);
                for (int i = 0; i < budget; i++)
                {
                    // 已经在熔岩上、还在前方的那片不挪（不闪）
                    if (sheets[i] && fade[i] > 0.05f)
                    {
                        var to = sheets[i].position - eye;
                        to.y = 0;
                        float along = Vector3.Dot(to, fwd);
                        if (along > 5f && along < 24f && Mathf.Abs(Vector3.Dot(to, right)) < along && LavaField.IsLavaAt(sheets[i].position))
                        {
                            want[i] = 1;
                            continue;
                        }
                    }
                    for (int tries = 0; tries < 4; tries++)
                    {
                        float d = Random.Range(6f, 20f);
                        var q = eye + fwd * d + right * Random.Range(-0.7f, 0.7f) * d;
                        if (!LavaField.IsLavaAt(q.x, q.z) || !LavaField.TrySurfaceHeight(q, out float y) || y > eye.y + 2f) continue;
                        if (!Ensure(i)) break;
                        sheets[i].position = new Vector3(q.x, y - 0.1f, q.z);
                        sheets[i].localScale = new Vector3(Random.Range(5f, 9f), Random.Range(1.8f, 2.8f), 1);
                        fade[i] = 0;
                        want[i] = 1;
                        break;
                    }
                }
            }
            for (int i = 0; i < sheets.Length; i++)
            {
                if (!sheets[i]) continue;
                fade[i] = Mathf.MoveTowards(fade[i], want[i], dt * 1.5f);
                bool on = fade[i] > 0.01f;
                if (rends[i].enabled != on) rends[i].enabled = on;
                if (!on) continue;
                // 绕 Y 轴朝相机
                var to = eye - sheets[i].position;
                to.y = 0;
                if (to.sqrMagnitude > 1e-4f) sheets[i].rotation = Quaternion.LookRotation(-to.normalized, Vector3.up);
                block ??= new MaterialPropertyBlock();
                block.SetFloat(FadeId, fade[i]);
                rends[i].SetPropertyBlock(block);
            }
        }

        bool Ensure(int i)
        {
            if (sheets[i]) return true;
            var mat = Mat();
            if (!mat) return false;
            var go = new GameObject($"Env Heat Haze {i}", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            go.GetComponent<MeshFilter>().sharedMesh = Quad();
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.enabled = false;
            sheets[i] = go.transform;
            rends[i] = r;
            return true;
        }
    }
}
