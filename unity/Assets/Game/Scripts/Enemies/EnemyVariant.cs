using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一种材质变体（docs/unity-parity.md 第 6 节「沙魇：材质变体（Shader 参数）」）：同一个美术 Prefab 换一层皮，不另做模型。
    ///   着色器参数（Spiritfire/StylizedLit 的 Variant 段，MaterialPropertyBlock 覆盖）：沙化程度 / 沙色、裂纹强度 / 密度 / 脉动、裂缝里透出的光；
    ///   边缘光换色（剪影一圈暖光，远处一眼认出「这只不一样」）；
    ///   EnemyBody 的着色通道：反照率乘色（_Tint）与一层淡淡的覆盖色（占位体、没有 Variant 段的材质也看得出来）；
    ///   名字前缀（「沙魇·」）；受击扬沙、倒下崩成一团沙（布娃娃倒地后很快散掉）。
    /// </summary>
    public sealed class EnemyVariantSpec
    {
        public string id, name;
        /// <summary>名字前缀（空 = 不改名）</summary>
        public string prefix = "";
        /// <summary>沙化 0..1、沙色</summary>
        public float sand;
        public Color sandColor = new(0.85f, 0.7f, 0.48f);
        /// <summary>裂纹 0..1、密度（每 UV 单位的格数）、脉动角频率、裂缝的光（HDR）</summary>
        public float crack, crackDensity = 14f, crackPulse = 3f;
        public Color crackColor = Color.black;
        /// <summary>边缘光（rimStrength &lt; 0 = 不覆盖材质的）</summary>
        public Color rimColor = Color.white;
        public float rimStrength = -1f;
        /// <summary>反照率乘色、覆盖色与强度（EnemyBody 着色通道）</summary>
        public Color tint = Color.white, overlay = Color.white;
        public float overlayAmount;
        /// <summary>受击扬起的尘、倒下崩成的沙（颜色）；crumble = 倒下后身体散成沙（隐藏），crumbleDelay 秒后</summary>
        public Color dust = new(0.85f, 0.7f, 0.48f);
        public bool hitPuff, crumble;
        public float crumbleDelay = 0.35f;
    }

    /// <summary>
    /// 敌人的材质变体（挂在敌人根节点上）：<see cref="Apply(EnemyAI, string, bool)"/> 按登记的 <see cref="EnemyVariantSpec"/> 换皮。
    ///   内置：<see cref="Sand"/>（「沙魇·」：旱魃把第一章的杂兵烧成沙魇——沙化 + 日火裂纹，旱魃召出的普通杂兵用它）、
    ///         <see cref="Wraith"/>（沙魇本体 <see cref="SandWraithAI"/> 的皮：同一套参数、不加前缀、裂纹更密更亮）。
    ///   <see cref="CrackBoost"/>：额外的裂纹亮度（0..1，招式前摇时 AI 拉高：裂缝越烧越亮 = 要出招了）。
    /// 着色器参数每 0.25 s 补写一次（别的脚本整块覆盖属性块时也能恢复），亮度变化时立刻写。发光壳、粒子、拖尾不参与。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EnemyVariant : MonoBehaviour
    {
        public const string SandId = "sand", WraithId = "sand_wraith";
        public const string TintChannel = "variant";

        static readonly int ParamsId = Shader.PropertyToID("_VariantParams");
        static readonly int SandColorId = Shader.PropertyToID("_VariantSandColor");
        static readonly int CrackColorId = Shader.PropertyToID("_VariantCrackColor");
        static readonly int RimColorId = Shader.PropertyToID("_RimColor");
        static readonly int RimStrengthId = Shader.PropertyToID("_RimStrength");

        /// <summary>沙魇·：沙化 0.85、日火裂纹（橙金）、暖边光，受击扬沙、倒下崩沙</summary>
        public static readonly EnemyVariantSpec Sand = new()
        {
            id = SandId, name = "沙魇", prefix = "沙魇·",
            sand = 0.85f, sandColor = new Color(0.8f, 0.68f, 0.52f),
            crack = 0.85f, crackDensity = 13f, crackPulse = 2.6f, crackColor = new Color(2.2f, 0.8f, 0.22f),
            rimColor = new Color(1f, 0.62f, 0.35f), rimStrength = 0.5f,
            tint = Color.white, overlay = new Color(0.85f, 0.66f, 0.4f), overlayAmount = 0.12f,
            dust = Hex.Rgb(0xd9b27a), hitPuff = true, crumble = true,
        };

        /// <summary>沙魇本体：同 <see cref="Sand"/>，不加前缀，沙化更彻底、裂纹更密更亮</summary>
        public static readonly EnemyVariantSpec Wraith = new()
        {
            id = WraithId, name = "沙魇",
            sand = 0.95f, sandColor = new Color(0.78f, 0.66f, 0.5f),
            crack = 1f, crackDensity = 15f, crackPulse = 3.4f, crackColor = new Color(2.6f, 0.9f, 0.25f),
            rimColor = new Color(1f, 0.6f, 0.32f), rimStrength = 0.6f,
            tint = Color.white, overlay = new Color(0.85f, 0.66f, 0.4f), overlayAmount = 0.1f,
            dust = Hex.Rgb(0xd9b27a), hitPuff = true, crumble = true, crumbleDelay = 0.2f,
        };

        static readonly Dictionary<string, EnemyVariantSpec> specs = new() { [SandId] = Sand, [WraithId] = Wraith };

        /// <summary>登记 / 覆盖一种变体</summary>
        public static void Register(EnemyVariantSpec s)
        {
            if (s != null && !string.IsNullOrEmpty(s.id)) specs[s.id] = s;
        }

        public static EnemyVariantSpec Get(string id) => id != null && specs.TryGetValue(id, out var s) ? s : null;

        /// <summary>按 id 换皮（没登记的 id 返回 null）</summary>
        public static EnemyVariant Apply(EnemyAI e, string id, bool rename = true) => Apply(e, Get(id), rename);

        /// <summary>换皮（可重复调用：同一种只换一次名字）；死了的、spec 为空的返回 null</summary>
        public static EnemyVariant Apply(EnemyAI e, EnemyVariantSpec spec, bool rename = true)
        {
            if (!e || e.Dead || spec == null) return null;
            var v = e.GetComponent<EnemyVariant>();
            if (!v) v = e.gameObject.AddComponent<EnemyVariant>();
            v.Bind(e, spec, rename);
            return v;
        }

        /// <summary>这只敌人换了这种皮（id 为空 = 任意变体）</summary>
        public static bool Is(EnemyAI e, string id = null)
        {
            if (!e) return false;
            var v = e.GetComponent<EnemyVariant>();
            return v && v.Spec != null && (id == null || v.Spec.id == id);
        }

        public EnemyVariantSpec Spec { get; private set; }
        /// <summary>着色器参数实际写进去的渲染器数（测试用）</summary>
        public int Renderers => targets.Count;
        /// <summary>倒下后已经散成沙（测试用）</summary>
        public bool Crumbled { get; private set; }
        /// <summary>受击扬沙次数（测试用）</summary>
        public int Puffs { get; private set; }

        float boost, written = -1, refreshAt;
        /// <summary>额外的裂纹亮度 0..1（前摇时拉高）</summary>
        public float CrackBoost
        {
            get => boost;
            set => boost = Mathf.Clamp01(value);
        }

        EnemyAI ai;
        EnemyBody body;
        Damageable hp;
        readonly List<Renderer> targets = new();
        MaterialPropertyBlock block;
        float puffAt;

        void Bind(EnemyAI e, EnemyVariantSpec spec, bool rename)
        {
            bool fresh = Spec != spec;
            ai = e;
            Spec = spec;
            if (!body) body = e.Body ? e.Body : GetComponent<EnemyBody>();
            if (!hp)
            {
                hp = e.Health ? e.Health : GetComponent<Damageable>();
                if (hp)
                {
                    hp.Damaged += OnDamaged;
                    hp.Died += OnDied;
                }
            }
            if (body)
            {
                if (spec.tint != Color.white) body.SetTint(TintChannel, spec.tint);
                else body.ClearTint(TintChannel);
                if (spec.overlayAmount > 0) body.SetOverlay(TintChannel, spec.overlay, spec.overlayAmount);
                else body.ClearOverlay(TintChannel);
            }
            if (rename && !string.IsNullOrEmpty(spec.prefix) && hp && (string.IsNullOrEmpty(hp.displayName) || !hp.displayName.StartsWith(spec.prefix)))
            {
                var def = EnemyRoster.Get(e.enemyId);
                hp.displayName = spec.prefix + (def != null ? def.name : string.IsNullOrEmpty(hp.displayName) ? e.enemyId : hp.displayName);
            }
            CollectTargets();
            written = -1;
            Write();
            if (fresh) Fx.Burst(transform.position + Vector3.up * 0.6f, spec.dust, 14, 3.5f, 0.8f, 0.3f, 2f);
        }

        /// <summary>收集要写着色器参数的渲染器：激活的、材质有 Variant 段的身体渲染器（不含发光壳、粒子、拖尾、连线）</summary>
        void CollectTargets()
        {
            targets.Clear();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer or TrailRenderer or LineRenderer || r.name.Contains("GlowShell")) continue;
                foreach (var m in r.sharedMaterials)
                    if (m && m.HasProperty(ParamsId) && !m.IsKeywordEnabled("_ADDITIVE"))
                    {
                        targets.Add(r);
                        break;
                    }
            }
        }

        void LateUpdate()
        {
            if (Spec == null) return;
            if (Mathf.Abs(boost - written) > 0.01f || Time.time >= refreshAt) Write();
        }

        void Write()
        {
            var s = Spec;
            if (s == null) return;
            block ??= new MaterialPropertyBlock();
            written = boost;
            refreshAt = Time.time + 0.25f;
            float crack = Mathf.Clamp01(s.crack + boost * 0.5f);
            var p = new Vector4(s.sand, crack, s.crackDensity, s.crackPulse * (1 + boost));
            var cc = s.crackColor * (1 + boost * 1.4f);
            foreach (var r in targets)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetVector(ParamsId, p);
                block.SetColor(SandColorId, s.sandColor);
                block.SetColor(CrackColorId, cc);
                if (s.rimStrength >= 0)
                {
                    block.SetColor(RimColorId, s.rimColor);
                    block.SetFloat(RimStrengthId, s.rimStrength);
                }
                r.SetPropertyBlock(block);
            }
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (Spec == null || !Spec.hitPuff || r.total <= 0 || info.source == DamageSource.Status) return;
            if (Time.time < puffAt) return;
            puffAt = Time.time + 0.06f;
            Puffs++;
            var p = Fx.Finite(info.point) && info.point != Vector3.zero ? info.point : transform.position + Vector3.up;
            float big = hp ? Mathf.Clamp01(r.total / Mathf.Max(1, hp.maxHealth) * 4f) : 0.3f;
            Fx.Burst(p, Spec.dust, 4 + Mathf.RoundToInt(8 * big), 1.6f + 2.4f * big, 0.5f, 0.12f + 0.12f * big, 4f);
        }

        void OnDied(DamageInfo info)
        {
            if (Spec == null || !Spec.crumble || Crumbled) return;
            Invoke(nameof(Crumble), Mathf.Max(0, Spec.crumbleDelay));
        }

        /// <summary>倒下的身体散成一团沙：隐藏渲染器，扬沙、落下一小堆沙痕</summary>
        void Crumble()
        {
            if (Crumbled) return;
            Crumbled = true;
            var c = transform.position + Vector3.up * 0.5f * transform.localScale.y;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (r) r.enabled = false;
            var dust = Spec != null ? Spec.dust : DesertKit.Sand;
            Fx.Burst(c, dust, 26, 4.5f, 1.1f, 0.35f * transform.localScale.x, 4f);
            Fx.Burst(c + Vector3.up * 0.3f, dust, 10, 1.2f, 1.4f, 0.5f * transform.localScale.x, -0.6f);
            if (Spec != null && Spec.crack > 0) Fx.Burst(c, DesertKit.Spark, 10, 3.5f, 0.6f, 0.06f, 3f);
            DesertKit.Furrow(transform.position, 0.9f * transform.localScale.x, 6f);
        }

        void OnDestroy()
        {
            if (hp)
            {
                hp.Damaged -= OnDamaged;
                hp.Died -= OnDied;
            }
        }
    }
}
