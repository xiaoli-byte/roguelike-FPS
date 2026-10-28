using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 场景火盆 / 火坛 / 香炉 / 灯笼的动态火焰（D 路；<see cref="EnvFxHost"/> 进关时按 ArtAssetInfo.assetId 自动挂上，不改关卡）：
    ///   模型自带的静态火焰上叠几片跳动的火舌（<see cref="FlameTongue"/>，SF_FxFlame），往上飘的火星，偶尔噼啪蹦一颗；
    ///   香炉只冒细烟；冰灯 / 鲸骨灯是冷蓝的小火苗。
    ///   闪烁的点光：全场只给离相机最近的几盏（画质 低 2 / 中 4 / 高 6，35 m 以内），换灯时淡入淡出不跳。
    ///   离相机 80 m 外火舌不画；火星只在 25 m 内发。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnvFlame : MonoBehaviour
    {
        public enum Kind
        {
            Brazier,
            Altar,
            Incense,
            IceLantern,
            BoneLantern,
        }

        struct Spec
        {
            /// <summary>火焰底部在模型高度的比例、火舌高（米）、几片</summary>
            public float anchor, height;
            public int tongues;
            public Color hot, mid, tip, light, halo;
            public float lightRange, lightIntensity, sparks, smoke, haloSize;
        }

        static Spec SpecOf(Kind k) => k switch
        {
            // 火盆：白天在亮蓝天空前，红色火尖叠上去会发紫——尖端用橙不用暗红
            Kind.Brazier => new Spec
            {
                anchor = 0.84f, height = 1f, tongues = 3, hot = new Color(1f, 0.92f, 0.6f), mid = new Color(1f, 0.6f, 0.14f), tip = new Color(1f, 0.46f, 0.08f),
                light = new Color(1f, 0.62f, 0.28f), lightRange = 8f, lightIntensity = 2.6f, sparks = 3f,
                halo = new Color(1f, 0.55f, 0.18f, 0.35f), haloSize = 1.6f,
            },
            Kind.Altar => new Spec
            {
                anchor = 0.86f, height = 0.85f, tongues = 3, hot = new Color(1f, 0.96f, 0.8f), mid = new Color(1f, 0.62f, 0.2f), tip = new Color(0.85f, 0.22f, 0.08f),
                light = new Color(1f, 0.55f, 0.22f), lightRange = 9f, lightIntensity = 3f, sparks = 4f,
                halo = new Color(1f, 0.5f, 0.15f, 0.4f), haloSize = 1.8f,
            },
            Kind.Incense => new Spec { anchor = 0.86f, height = 0, tongues = 0, smoke = 1.6f, sparks = 0.4f },
            // 灯笼：火苗在灯罩里看不见——灯头外一圈呼吸的冷光晕（光晕片穿过灯头，露在灯罩轮廓外的那圈就是光）+ 点光
            Kind.IceLantern => new Spec
            {
                anchor = 0.8f, light = new Color(0.55f, 0.82f, 1f), lightRange = 6.5f, lightIntensity = 1.8f,
                halo = new Color(0.55f, 0.85f, 1f, 0.5f), haloSize = 1.5f, mid = new Color(0.6f, 0.9f, 1f),
            },
            _ => new Spec
            {
                anchor = 0.78f, light = new Color(0.5f, 0.9f, 1f), lightRange = 6f, lightIntensity = 1.6f,
                halo = new Color(0.5f, 0.95f, 1f, 0.5f), haloSize = 1.4f, mid = new Color(0.55f, 0.95f, 1f),
            },
        };

        /// <summary>按模型 id 认火：火盆 / 火坛 / 香炉 / 冰灯 / 鲸骨灯；别的返回 false</summary>
        public static bool KindOf(string assetId, out Kind kind)
        {
            switch (assetId)
            {
                case "SM_Tripo_DesertBrazier": kind = Kind.Brazier; return true;
                case "SM_Tripo_InfernoFireAltar": kind = Kind.Altar; return true;
                case "SM_Prop_DesertIncenseBurner": kind = Kind.Incense; return true;
                case "SM_Tripo_FrostIceLantern": kind = Kind.IceLantern; return true;
                case "SM_Tripo_FrostSeaBoneLantern": kind = Kind.BoneLantern; return true;
                default: kind = default; return false;
            }
        }

        public const float FlameCull = 80f, SparkReach = 25f, LightReach = 35f;

        static readonly List<EnvFlame> live = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        /// <summary>场上的动态火焰</summary>
        public static IReadOnlyList<EnvFlame> Live => live;

        /// <summary>同时亮着的点光上限：画质 低 2 / 中 4 / 高 6</summary>
        public static int LightBudget => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 2,
            ArtQualityLevel.Medium => 4,
            _ => 6,
        };

        /// <summary>现在亮着的点光数（测试用）</summary>
        public static int LitCount
        {
            get
            {
                int n = 0;
                foreach (var f in live)
                    if (f && f.lamp && f.lamp.enabled)
                        n++;
                return n;
            }
        }

        public Kind FlameKind { get; private set; }
        /// <summary>火焰底部（世界）</summary>
        public Vector3 Anchor => transform.TransformPoint(anchorLocal);
        public bool WantsLight => wantLight;

        Spec spec;
        Vector3 anchorLocal;
        float worldHeight, seed, sparkDebt, smokeDebt, lightW;
        FlameTongue[] tongues = System.Array.Empty<FlameTongue>();
        Transform halo;
        Renderer haloR;
        Vector3[] tongueOffsets = System.Array.Empty<Vector3>();
        Light lamp;
        bool wantLight;

        /// <summary>给一个场景件挂上动态火焰（重复挂只挂一次）</summary>
        public static EnvFlame Attach(ArtAssetInfo prop, Kind kind)
        {
            if (!prop || !Application.isPlaying) return null;
            var f = prop.GetComponent<EnvFlame>();
            if (f) return f;
            f = prop.gameObject.AddComponent<EnvFlame>();
            f.Init(prop, kind);
            return f;
        }

        void Init(ArtAssetInfo prop, Kind kind)
        {
            FlameKind = kind;
            spec = SpecOf(kind);
            var b = prop.designBounds;
            if (b.size.y < 0.05f) b = new Bounds(Vector3.up * 1.2f, new Vector3(1, 2.4f, 1));
            anchorLocal = new Vector3(b.center.x, b.min.y + b.size.y * spec.anchor, b.center.z);
            worldHeight = b.size.y * Mathf.Abs(transform.lossyScale.y);
            seed = Random.value * 100f;
            float scale = Mathf.Clamp(Mathf.Abs(transform.lossyScale.y), 0.5f, 2.5f);
            if (spec.tongues > 0)
            {
                tongues = new FlameTongue[spec.tongues];
                tongueOffsets = new Vector3[spec.tongues];
                for (int i = 0; i < spec.tongues; i++)
                {
                    // 中间一片大的，两边各一片小的、略往外偏
                    float a = i * 2.4f + seed;
                    var off = i == 0 ? Vector3.zero : new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.13f / scale;
                    tongueOffsets[i] = off;
                    var t = FlameTongue.Attach(transform, anchorLocal + off, Vector3.one, spec.hot, spec.mid, spec.tip);
                    if (t) t.gameObject.name = $"Env Flame {i}";
                    tongues[i] = t;
                }
            }
            MakeHalo(scale);
        }

        void MakeHalo(float scale)
        {
            if (spec.haloSize <= 0) return;
            var holder = new GameObject("Env Flame Halo").transform;
            holder.SetParent(transform, false);
            holder.localPosition = anchorLocal + Vector3.up * (spec.height * 0.35f / Mathf.Max(0.01f, scale));
            halo = FxMaterials.GlowSprite(holder, spec.haloSize / Mathf.Max(0.01f, scale), spec.halo);
            haloR = halo ? halo.GetComponent<Renderer>() : null;
            if (haloR)
            {
                haloR.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                haloR.receiveShadows = false;
            }
        }

        void OnEnable()
        {
            if (!live.Contains(this)) live.Add(this);
        }

        void OnDisable()
        {
            live.Remove(this);
            if (lamp) lamp.enabled = false;
        }

        /// <summary>拆掉（<see cref="EnvFxHost.Strip"/>）：火舌、光晕、点光一起收掉</summary>
        void OnDestroy()
        {
            foreach (var t in tongues)
                if (t)
                    Destroy(t.gameObject);
            if (halo) Destroy(halo.parent ? halo.parent.gameObject : halo.gameObject);
            if (lamp) Destroy(lamp.gameObject);
        }

        /// <summary><see cref="EnvFxHost"/> 每 0.25 s 排一次：离相机最近的几盏给灯</summary>
        internal static void AssignLights(Vector3 eye)
        {
            int budget = LightBudget;
            // 简单选择：按距离取前 budget 个（场上火最多几十个，O(n·budget) 足够）
            for (int i = 0; i < live.Count; i++)
                if (live[i])
                    live[i].wantLight = false;
            for (int b = 0; b < budget; b++)
            {
                EnvFlame best = null;
                float bd = LightReach * LightReach;
                foreach (var f in live)
                {
                    if (!f || f.wantLight || f.spec.lightIntensity <= 0) continue;
                    float d = (f.Anchor - eye).sqrMagnitude;
                    if (d < bd)
                    {
                        bd = d;
                        best = f;
                    }
                }
                if (!best) break;
                best.wantLight = true;
            }
        }

        void Update()
        {
            float dt = Time.deltaTime;
            var cam = Camera.main;
            if (!cam || dt <= 0) return;
            float t = Time.time;
            var anchor = Anchor;
            float dist = Vector3.Distance(cam.transform.position, anchor);

            // 火舌：两层噪声让高度、宽度、亮度一起跳
            float flick = Mathf.PerlinNoise(t * 5.3f, seed) * 0.6f + Mathf.PerlinNoise(t * 11.7f, seed + 7.1f) * 0.4f;
            bool show = dist < FlameCull;
            for (int i = 0; i < tongues.Length; i++)
            {
                var tg = tongues[i];
                if (!tg) continue;
                if (!show)
                {
                    tg.Set(0);
                    continue;
                }
                float n = Mathf.PerlinNoise(t * (4.1f + i * 1.3f), seed + i * 3.7f);
                float h = spec.height * (i == 0 ? 1f : 0.62f) * (0.78f + 0.45f * n) * Mathf.Clamp(worldHeight / 2.4f, 0.6f, 2f);
                tg.Set(Mathf.Lerp(0.75f, 1f, flick), new Vector3(h * 0.95f, h, h * 0.95f));
            }

            // 光晕：跟着火苗呼吸
            if (haloR)
            {
                bool on = dist < FlameCull;
                if (haloR.enabled != on) haloR.enabled = on;
                if (on)
                {
                    var c = spec.halo;
                    c.a *= 0.75f + 0.4f * flick;
                    FxMaterials.Tint(haloR, c);
                }
            }

            // 点光
            float wantW = wantLight ? 1f : 0f;
            lightW = Mathf.MoveTowards(lightW, wantW, dt * 2.5f);
            if (lightW > 0.005f)
            {
                if (!lamp) MakeLamp();
                lamp.enabled = true;
                lamp.intensity = spec.lightIntensity * lightW * (0.78f + 0.35f * flick);
                lamp.transform.position = anchor + Vector3.up * (spec.height * 0.45f + 0.15f);
            }
            else if (lamp && lamp.enabled) lamp.enabled = false;

            if (dist > SparkReach) return;
            // 火星：慢慢往上飘的余烬 + 偶尔噼啪蹦起的一颗
            if (spec.sparks > 0)
            {
                sparkDebt = Mathf.Min(4f, sparkDebt + spec.sparks * Fx.Density * EnvParticles.Headroom * dt);
                while (sparkDebt >= 1f)
                {
                    sparkDebt -= 1f;
                    if (FxBudget.Allow(1, false) <= 0) break;
                    var p = anchor + new Vector3(Random.Range(-0.15f, 0.15f), spec.height * Random.Range(0.2f, 0.6f), Random.Range(-0.15f, 0.15f));
                    if (Random.value < 0.18f)
                        EnvParticles.Emit("EnvSpark", p, new Vector3(Random.Range(-1f, 1f), Random.Range(2.5f, 4.5f), Random.Range(-1f, 1f)), 0.04f, Random.Range(0.4f, 0.7f),
                            FxEnvStyles.Spark);
                    else
                        EnvParticles.Emit("EnvEmber", p, new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.6f, 1.3f), Random.Range(-0.2f, 0.2f)),
                            Random.Range(0.035f, 0.06f), Random.Range(1.2f, 2.2f), spec.mid.a > 0 ? Color.Lerp(spec.mid, spec.hot, Random.value * 0.5f) : FxEnvStyles.Ember);
                }
            }
            if (spec.smoke > 0)
            {
                smokeDebt = Mathf.Min(3f, smokeDebt + spec.smoke * Fx.Density * EnvParticles.Headroom * dt);
                while (smokeDebt >= 1f)
                {
                    smokeDebt -= 1f;
                    if (FxBudget.Allow(1, false) <= 0) break;
                    var p = anchor + new Vector3(Random.Range(-0.05f, 0.05f), 0, Random.Range(-0.05f, 0.05f));
                    EnvParticles.Emit("EnvSmoke", p, new Vector3(Random.Range(-0.08f, 0.08f), Random.Range(0.25f, 0.45f), Random.Range(-0.08f, 0.08f)),
                        Random.Range(0.1f, 0.18f), Random.Range(2.6f, 3.6f), FxEnvStyles.Smoke);
                }
            }
        }

        void MakeLamp()
        {
            var go = new GameObject("Env Flame Light");
            go.transform.SetParent(transform, false);
            lamp = go.AddComponent<Light>();
            lamp.type = LightType.Point;
            lamp.color = spec.light;
            lamp.range = spec.lightRange;
            lamp.shadows = LightShadows.None;
            lamp.intensity = 0;
            lamp.enabled = false;
        }
    }
}
