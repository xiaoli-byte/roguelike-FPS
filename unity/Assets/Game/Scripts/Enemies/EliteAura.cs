using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英的金环（Three.js 版 EnemyBase.addEliteAura：脚下一圈金环，半径 1.6 × 身体半径，随体型放大）：一眼认出「这只是精英」；
    /// 带词缀时环里再套一圈词缀纹样（<see cref="SetSigil"/>：迅捷卷云钩、坚盾六角甲、爆裂火药星、狂暴锯齿牙，各自的颜色和转法）。
    /// Q 路（2026-10-31，设计单 docs/art/vfx/elite-affixes.md）：原来是两道加色细线（亮沙、雪地上发白看不见，熔岩上又和橙光混成一片），
    /// 改成「墨底 + 鎏金粗带 + 菱形钉 / 刻度」的中尺度纹样，普通透明混合、墨边托底，三章的地面都读得出来；
    /// 金环慢转、呼吸，词缀纹样按自己的节奏转 / 跳（控制器可以改亮度 <see cref="Level"/>、加转速 <see cref="SpinBoost"/>、打一下 <see cref="Pulse"/>）；
    /// 死亡时金环收拢、闪一下再消失（0.3 s），不是一下子没了。
    /// 环是根节点下两块贴地面片（不投影、没有碰撞体），材质全场共用、颜色走 MaterialPropertyBlock。只在 Play 里建面片；EditMode 里组件照常挂上（记下半径与词缀）。
    /// 低画质档（粒子密度 &lt; 0.6）不转、不呼吸（静止的纹样一样读得出来），省掉每帧写属性块。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class EliteAura : MonoBehaviour
    {
        /// <summary>金环颜色（TS 0xffc233）与半径（× 身体半径，设计尺寸）</summary>
        public static readonly Color Gold = new(1f, 0.76f, 0.2f, 0.85f);
        public const float RadiusMult = 1.6f;
        /// <summary>词缀纹样的外半径（× 金环半径：落在金环的内圈里）</summary>
        public const float SigilK = 0.74f;
        /// <summary>金环的 HDR 亮度（略过 1，泛光轻轻吃到一点；不刷白）</summary>
        const float GoldHdr = 1.35f, SigilHdr = 1.45f;
        /// <summary>死亡收拢的时长（秒）</summary>
        const float CollapseTime = 0.3f;

        static Material ringMat;
        static readonly Material[] sigilMats = new Material[5];
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        Damageable hp;
        Renderer ring, accent;
        Transform ringT, accentT;
        MaterialPropertyBlock block;
        float spin, sigilSpin, pulse, deadAt = -1, seed;

        /// <summary>环半径（设计尺寸，根节点的缩放会再乘上去）</summary>
        public float Radius { get; private set; }
        /// <summary>词缀色（没有词缀为 null）</summary>
        public Color? Accent { get; private set; }
        /// <summary>词缀纹样</summary>
        public EliteSigil Sigil { get; private set; }
        /// <summary>纹样亮度（0..1.5；坚盾跟护盾比例、狂暴前 0.45 / 狂暴后 1.2）</summary>
        public float Level { get; set; } = 1f;
        /// <summary>纹样额外转速（度 / 秒，狂暴后加速）</summary>
        public float SpinBoost { get; set; }

        /// <summary>给敌人挂金环（已挂过返回原来的）；bodyRadius = 定义里的身体半径（设计尺寸）</summary>
        public static EliteAura Attach(EnemyAI ai, float bodyRadius)
        {
            if (!ai) return null;
            if (ai.TryGetComponent<EliteAura>(out var a)) return a;
            a = ai.gameObject.AddComponent<EliteAura>();
            a.hp = ai.Health;
            a.Radius = Mathf.Max(0.2f, bodyRadius) * RadiusMult;
            a.Build();
            return a;
        }

        /// <summary>词缀色（null = 去掉内圈）。纹样由 <see cref="SetSigil(string, Color)"/> 定；只给了颜色、没定纹样时先用六角框占位</summary>
        public void SetAccent(Color? c)
        {
            Accent = c;
            if (!c.HasValue) SetSigil(EliteSigil.None, null);
            else if (Sigil == EliteSigil.None) SetSigil(EliteSigil.Shielded, c);
            else Refresh();
        }

        /// <summary>按词缀 id 换纹样（swift / shielded / volatile / frenzied；认不出的 id 用六角框占位）</summary>
        public void SetSigil(string affixId, Color c) => SetSigil(SigilOf(affixId), c);

        public static EliteSigil SigilOf(string affixId) => affixId switch
        {
            "swift" => EliteSigil.Swift,
            "shielded" => EliteSigil.Shielded,
            "volatile" => EliteSigil.Volatile,
            "frenzied" => EliteSigil.Frenzied,
            null or "" => EliteSigil.None,
            _ => EliteSigil.Shielded,
        };

        public void SetSigil(EliteSigil s, Color? c)
        {
            Sigil = s;
            if (c.HasValue) Accent = c;
            if (s == EliteSigil.None) Accent = null;
            Level = s == EliteSigil.Frenzied ? 0.45f : 1f;
            Refresh();
        }

        /// <summary>纹样打一下（放大一圈再弹回、亮一下）：狂暴触发、坚盾破盾 / 回满</summary>
        public void Pulse(float strength = 1f) => pulse = Mathf.Max(pulse, Mathf.Clamp01(strength));

        void Refresh()
        {
            if (!accent) return;
            bool on = Sigil != EliteSigil.None && Accent.HasValue;
            accent.gameObject.SetActive(on);
            if (on) accent.sharedMaterial = SigilMaterial(Sigil);
        }

        void Build()
        {
            if (!Application.isPlaying) return;
            block = new MaterialPropertyBlock();
            seed = Random.value * 360f;
            ring = Quad("Elite Ring", Radius, 0.05f, RingMaterial);
            ringT = ring.transform;
            accent = Quad("Elite Affix Sigil", Radius * SigilK, 0.06f, null);
            accentT = accent.transform;
            Refresh();
        }

        Renderer Quad(string quadName, float radius, float lift, Material mat)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            var col = q.GetComponent<Collider>();
            col.enabled = false;
            Destroy(col);
            q.name = quadName;
            q.layer = Layers.IgnoreRaycast;
            q.transform.SetParent(transform, false);
            q.transform.localPosition = new Vector3(0, lift, 0);
            q.transform.localRotation = Quaternion.Euler(90, 0, 0);
            q.transform.localScale = new Vector3(radius * 2, radius * 2, 1);
            var r = q.GetComponent<Renderer>();
            if (mat) r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return r;
        }

        void LateUpdate()
        {
            if (!ring) return;
            float dt = Time.deltaTime, t = Time.time;
            bool dead = hp && hp.Dead;
            if (dead && deadAt < 0) deadAt = t;
            float collapse = deadAt >= 0 ? Mathf.Clamp01((t - deadAt) / CollapseTime) : 0f;
            bool show = collapse < 1f;
            ring.enabled = show;
            bool sigilOn = show && accent && accent.gameObject.activeSelf;
            if (accent) accent.enabled = sigilOn;
            if (!show) return;
            bool lite = Fx.Density < 0.6f;
            pulse = Mathf.Max(0, pulse - dt * 3f);

            // 金环：慢转（菱形钉缓缓走动）、轻呼吸；死亡时收拢到 35% 并先亮一下再淡掉
            float shrink = collapse > 0 ? Mathf.Lerp(1f, 0.35f, collapse * collapse) : 1f;
            float flash = collapse > 0 ? Mathf.Sin(Mathf.Clamp01(collapse * 1.6f) * Mathf.PI) : 0f;
            if (!lite) spin += dt * 9f;
            ringT.localRotation = Quaternion.Euler(90, seed + spin, 0);
            ringT.localScale = new Vector3(Radius * 2 * shrink, Radius * 2 * shrink, 1);
            float breath = lite ? 1f : 0.88f + 0.12f * Mathf.Sin(t * 2.4f + seed);
            var g = new Color(Gold.r * GoldHdr, Gold.g * GoldHdr, Gold.b * GoldHdr, breath * (1f - collapse) + flash * 0.4f);
            g.r += flash;
            g.g += flash * 0.8f;
            g.b += flash * 0.5f;
            block.Clear();
            block.SetColor(BaseColorId, g);
            ring.SetPropertyBlock(block);
            if (!sigilOn || !Accent.HasValue) return;

            // 词缀纹样：各自的转法（形状语言 + 节奏，见设计单）
            float rate, scale = 1f, glow = 1f;
            switch (Sigil)
            {
                case EliteSigil.Swift:
                    // 风：逆时针快转，亮度平稳
                    rate = 170f;
                    break;
                case EliteSigil.Shielded:
                    // 甲：几乎不动，亮度跟护盾（控制器写 Level）
                    rate = 8f;
                    break;
                case EliteSigil.Volatile:
                {
                    // 火药：不转，2.2 Hz 一胀一缩、亮度闪烁（像引信在嗤嗤冒火）
                    rate = 0f;
                    float beat = Mathf.Pow(0.5f + 0.5f * Mathf.Sin(t * 13.8f + seed), 3f);
                    scale = 0.95f + 0.07f * beat;
                    glow = 0.8f + 0.45f * beat;
                    break;
                }
                default:
                {
                    // 狂暴：狂暴前慢转、暗；狂暴后高速转 + 心跳（咚—咚、停）
                    rate = 30f;
                    if (Level > 0.8f)
                    {
                        float ph = Mathf.Repeat(t * 1.9f, 1f);
                        float beat = Mathf.Exp(-ph * 14f) + 0.6f * Mathf.Exp(-Mathf.Max(0, ph - 0.22f) * 14f) * (ph > 0.22f ? 1f : 0f);
                        scale = 1f + 0.09f * beat;
                        glow = 0.85f + 0.5f * beat;
                    }
                    break;
                }
            }
            if (!lite) sigilSpin += dt * (rate + SpinBoost);
            float s = Radius * SigilK * 2f * shrink * scale * (1f + 0.22f * pulse);
            accentT.localRotation = Quaternion.Euler(90, seed * 0.5f - sigilSpin, 0);
            accentT.localScale = new Vector3(s, s, 1);
            var c = Accent.Value;
            float k = SigilHdr * Mathf.Max(0.2f, Level) * glow * (1f + pulse);
            var cc = new Color(c.r * k + pulse, c.g * k + pulse * 0.8f, c.b * k + pulse * 0.6f, Mathf.Clamp01(0.55f + 0.45f * Mathf.Min(1f, Level)) * (1f - collapse));
            block.Clear();
            block.SetColor(BaseColorId, cc);
            accent.SetPropertyBlock(block);
        }

        // ───────────── 材质（全场共用，从 FxMaterials 的透明模板派生，不运行时 Shader.Find）─────────────

        static Material RingMaterial
        {
            get
            {
                if (ringMat) return ringMat;
                ringMat = FxMaterials.MakeAlpha(EliteSigilTextures.Ring);
                ringMat.name = "Elite Ring (runtime)";
                Prep(ringMat, -12);
                return ringMat;
            }
        }

        /// <summary>词缀纹样的共用材质（爆裂引信演出也用它）</summary>
        internal static Material SigilMaterialFor(EliteSigil s) => SigilMaterial(s);

        static Material SigilMaterial(EliteSigil s)
        {
            int i = (int)s;
            if (sigilMats[i]) return sigilMats[i];
            var m = FxMaterials.MakeAlpha(EliteSigilTextures.Sigil(s));
            m.name = $"Elite Sigil {s} (runtime)";
            Prep(m, -11);
            return sigilMats[i] = m;
        }

        /// <summary>贴地面片：两面都画（俯视 / 斜看都在）、排在一般透明物前面（预警贴花、火焰压在它上面）</summary>
        static void Prep(Material m, int queueOffset)
        {
            m.renderQueue = (int)RenderQueue.Transparent + queueOffset;
            if (m.HasProperty("_Cull")) m.SetFloat("_Cull", 0f);
            if (m.HasProperty("_CameraFadingEnabled")) m.SetFloat("_CameraFadingEnabled", 0f);
            m.DisableKeyword("_FADING_ON");
            m.DisableKeyword("_SOFTPARTICLES_ON");
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            ringMat = null;
            for (int i = 0; i < sigilMats.Length; i++) sigilMats[i] = null;
        }
    }
}
