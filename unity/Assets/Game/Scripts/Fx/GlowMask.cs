using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 发光遮罩（FX3，docs/unity-parity.md：青鸟 / 河豚 / 豪彘 / 狐巫 / 镜）。Three.js 版在材质着色器里按贴图颜色 × 资产空间区域现算冰光
    /// （FrostSkirmishFx.applyFrostGlow），不加任何外壳网格——发光的就是模型本身画好的那块冰。Unity 版把「哪里亮」离线烘成 _E 遮罩
    /// （art/pipeline/tools/emission_mask.py → Resources/Fx/GlowMasks/&lt;贴图名&gt;_E.png，R / G / B = 发光层 0 / 1 / 2），
    /// 这里每帧按敌人的发光通道（<see cref="EnemyBody.GlowLevel"/>）和状态算三层强度，把「层色 × 强度」写进 SF_StylizedLit 的 _GlowMaskColor0..2
    /// （MaterialPropertyBlock；遮罩贴图也走 MPB，不改共享材质）。强度公式照 Three.js 各敌人的 glow.strength。
    /// 同一只敌人身上的挂件（狐巫的铜镜）按各自贴图找各自的遮罩和配色。
    /// 挂法：敌人 AI 在 Awake 里 <see cref="Attach"/>；没有登记配色、找不到遮罩贴图时什么都不做。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GlowMask : MonoBehaviour
    {
        public const string ResourcesDir = "Fx/GlowMasks";

        static readonly int MaskId = Shader.PropertyToID("_GlowMask");
        static readonly int Color0Id = Shader.PropertyToID("_GlowMaskColor0");
        static readonly int Color1Id = Shader.PropertyToID("_GlowMaskColor1");
        static readonly int Color2Id = Shader.PropertyToID("_GlowMaskColor2");
        static readonly int ShimmerId = Shader.PropertyToID("_GlowMaskShimmer");
        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        static readonly Dictionary<string, Texture2D> maskCache = new();

        /// <summary>一张遮罩的配色：三层颜色、闪烁幅度、强度公式（返回三层强度）</summary>
        public sealed class Layers
        {
            public readonly Color c0, c1, c2;
            public readonly Vector3 shimmer;
            public readonly Func<GlowMask, Vector3> strength;

            public Layers(Color c0, Color c1, Color c2, Vector3 shimmer, Func<GlowMask, Vector3> strength)
            {
                this.c0 = c0;
                this.c1 = c1;
                this.c2 = c2;
                this.shimmer = shimmer;
                this.strength = strength;
            }
        }

        /// <summary>贴图名（BC 去掉 _BC）→ 配色。新加敌人：emission_mask.py 加一条规则，这里加一条配色，AI 里 Attach</summary>
        public static readonly Dictionary<string, Layers> Profiles = new()
        {
            // 三青鸟：0 胸口霜晶常亮、随呼吸起伏、前摇更亮；1 羽尖冰刃在扇射前摇时亮起；2 尾羽冰羽（尖啸时亮一下）
            ["T_Enemy_Qingniao"] = new Layers(Hex.Rgb(0x5ff0ff), Hex.Rgb(0x9feaff), Hex.Rgb(0x9feaff), new Vector3(0.35f, 0.6f, 0.6f), m =>
            {
                float breathe = 0.85f + 0.15f * Mathf.Sin(m.age * 2.4f);
                return new Vector3((0.9f + 0.9f * m.Level(0)) * breathe, 0.12f + 1.6f * m.Level(1) + 0.3f * m.screech, 0.15f + 0.3f * m.screech) * m.Alive(0.2f);
            }),
            // 冰河豚：0 冰刺随鼓气越来越亮（鼓满前闪烁）；1 鼓满前最后一下整个身体泛冷光
            ["T_Enemy_IcePuffer"] = new Layers(Hex.Rgb(0x6ff0ff), Hex.Rgb(0x6ff0ff), Color.black, new Vector3(0.5f, 0.3f, 0), m =>
            {
                float k = m.ai is IcePufferAI p ? p.Inflation : m.Level(0);
                float flick = k > 0.75f ? (Mathf.Sin(m.age * 40f) > 0 ? 1 : 0.55f) : 1;
                return new Vector3((0.12f + 1.6f * k * flick) * m.Alive(0.3f), 0.5f * Mathf.Max(0, k - 0.5f) * 2 * flick * m.Alive(0), 0);
            }),
            // 冰棘豪彘：0 刺根随蓄刺越来越亮（最后闪烁）、冲锋时微亮；1 眼睛常亮、冲锋时更亮
            ["T_Enemy_Haozhi"] = new Layers(Hex.Rgb(0x9a7bff), Hex.Rgb(0x7ff4ff), Color.black, new Vector3(0.5f, 0.1f, 0), m =>
            {
                float b = m.bristle;
                float flick = b > 0.7f ? (Mathf.Sin(m.age * 45f) > 0 ? 1 : 0.6f) : 1;
                return new Vector3((0.18f + 0.25f * m.charge + 1.8f * b * flick) * m.Alive(0.3f), (0.8f + 0.8f * m.charge) * m.Alive(0), 0);
            }),
            // 九尾狐巫本体：0 天蓝狐火（施法前摇越来越亮）；1 翠玉饰件（常亮微光）
            ["T_Enemy_FoxWitch"] = new Layers(Hex.Rgb(0x7fd8ff), Hex.Rgb(0x6fffd0), Color.black, new Vector3(0.5f, 0.2f, 0), m =>
                new Vector3((0.2f + 1.4f * m.Level(0)) * m.Alive(0), (0.45f + 0.8f * m.Level(0)) * m.Alive(0), 0)),
            // 铜镜：0 青玉镶嵌（同 Three.js 玉钮：常亮、前摇更亮）；1 镜面蓄光（照妖镜聚光时亮起，同 Three.js mirrorGlow）
            ["T_EnemyPart_FoxWitchMirror"] = new Layers(Hex.Rgb(0x5ff6e8), Hex.Rgb(0xeaffff), Color.black, new Vector3(0.3f, 0.45f, 0), m =>
                new Vector3((0.5f + 1.2f * m.Level(0)) * m.Alive(0), 1.9f * m.Level(1) * m.Alive(0), 0)),
        };

        sealed class Entry
        {
            public Renderer r;
            public Layers layers;
            public Texture2D mask;
        }

        readonly List<Entry> entries = new();
        readonly List<Renderer> scratch = new();
        MaterialPropertyBlock block;
        EnemyBody body;
        internal EnemyAI ai;
        internal float age, screech, bristle, charge;
        float rescanAt;
        int rendererCount = -1;

        /// <summary>这只敌人身上挂了几张遮罩（测试用）</summary>
        public int Masked => entries.Count;

        /// <summary>此刻某张遮罩第 layer 层的强度（测试用；没有返回 -1）</summary>
        public float StrengthOf(string texture, int layer)
        {
            foreach (var e in entries)
                if (e.mask && e.mask.name.StartsWith(texture, StringComparison.Ordinal))
                {
                    var s = e.layers.strength(this);
                    return layer == 0 ? s.x : layer == 1 ? s.y : s.z;
                }
            return -1;
        }

        /// <summary>给敌人挂发光遮罩（已有就返回原来的）</summary>
        public static GlowMask Attach(EnemyAI ai)
        {
            if (!ai) return null;
            if (ai.TryGetComponent(out GlowMask g)) return g;
            g = ai.gameObject.AddComponent<GlowMask>();
            g.ai = ai;
            return g;
        }

        void Awake()
        {
            body = GetComponent<EnemyBody>();
            block = new MaterialPropertyBlock();
            if (!ai) ai = GetComponent<EnemyAI>();
        }

        void Start() => Scan();

        /// <summary>按渲染器材质的 _BaseMap 找遮罩（挂件可能晚一点挂上来：开头 2 s 里渲染器数变了就重找一次）</summary>
        void Scan()
        {
            entries.Clear();
            scratch.Clear();
            GetComponentsInChildren(true, scratch);
            rendererCount = scratch.Count;
            foreach (var r in scratch)
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer || r.name.Contains("GlowShell")) continue;
                var m = r.sharedMaterial;
                if (!m || !m.HasProperty(MaskId) || !m.HasProperty(BaseMapId)) continue;
                var bc = m.GetTexture(BaseMapId);
                if (!bc) continue;
                string key = bc.name.EndsWith("_BC", StringComparison.Ordinal) ? bc.name[..^3] : bc.name;
                if (!Profiles.TryGetValue(key, out var layers)) continue;
                var mask = Mask(key);
                if (!mask) continue;
                entries.Add(new Entry { r = r, layers = layers, mask = mask });
            }
            rescanAt = age + 0.5f;
        }

        static Texture2D Mask(string key)
        {
            if (maskCache.TryGetValue(key, out var t) && t) return t;
            t = Resources.Load<Texture2D>($"{ResourcesDir}/{key}_E");
            if (!t) Debug.LogWarning($"[Fx] 没有发光遮罩 {ResourcesDir}/{key}_E（先跑 art/pipeline/tools/emission_mask.py）");
            maskCache[key] = t;
            return t;
        }

        /// <summary>发光通道 c 的亮度（EnemyBody 每帧过渡）</summary>
        internal float Level(int c) => body ? body.GlowLevel(c) : 0;

        /// <summary>活着 1；死了 dead（Three.js：死后霜晶还剩一点余光）</summary>
        internal float Alive(float dead) => ai && ai.Dead ? dead : 1;

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (age < 2f && age >= rescanAt)
            {
                rescanAt = age + 0.5f;
                scratch.Clear();
                GetComponentsInChildren(true, scratch);
                if (scratch.Count != rendererCount) Scan();
            }
            string st = ai ? ai.State : null;
            screech = Damp(screech, st == "screech" ? 1 : 0, 12, dt);
            bristle = Damp(bristle, st == "bristle" ? 1 : 0, 20, dt);
            charge = Damp(charge, st == "charge" ? 1 : st == "scrape" ? 0.6f : 0, 10, dt);
            foreach (var e in entries)
            {
                if (!e.r) continue;
                var s = e.layers.strength(this);
                e.r.GetPropertyBlock(block);
                block.SetTexture(MaskId, e.mask);
                // 层色转线性后再乘强度、按向量写（SetColor 会把 > 1 的值也做一遍伽马换算，强度就不是线性的了）
                block.SetVector(Color0Id, (Vector4)(e.layers.c0.linear * Mathf.Max(0, s.x)));
                block.SetVector(Color1Id, (Vector4)(e.layers.c1.linear * Mathf.Max(0, s.y)));
                block.SetVector(Color2Id, (Vector4)(e.layers.c2.linear * Mathf.Max(0, s.z)));
                block.SetVector(ShimmerId, new Vector4(e.layers.shimmer.x, e.layers.shimmer.y, e.layers.shimmer.z, 9f));
                e.r.SetPropertyBlock(block);
            }
        }

        static float Damp(float x, float target, float rate, float dt) => Mathf.Lerp(x, target, 1 - Mathf.Exp(-rate * dt));
    }
}
