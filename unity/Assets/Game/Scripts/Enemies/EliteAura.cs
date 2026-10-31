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
    /// 飞行 / 悬浮的精英（<see cref="FlyingEnemyAI"/>、定义里标了 flying 的，第二批收尾 D 路）：金环和纹样不跟着飞到半空，每帧从身上往下打一条射线，
    /// 贴着打到的地面（顺着地面法线）画——像它投在地上的影子；脚下 <see cref="GroundProbe"/> m 内没有地面就不画。
    /// 飞行体自己只留一圈小的金色悬浮标识（<see cref="HoverK"/> × 金环半径，离地不到 <see cref="HoverMin"/> m 时不画，和地上的金环重合）；
    /// 远处读「哪种精英」交给头顶印章（<see cref="EliteSeal"/>）。
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
        /// <summary>飞行精英：往下找地面的最远距离（米）、悬浮标识的大小（× 金环半径，夹在 0.22–0.45 m）、离地多高才画悬浮标识（米）</summary>
        public const float GroundProbe = 60f, HoverK = 0.4f, HoverMin = 0.8f;

        static Material ringMat;
        static readonly Material[] sigilMats = new Material[5];
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        Damageable hp;
        Renderer ring, accent, hoverMark;
        Transform ringT, accentT, hoverT;
        MaterialPropertyBlock block;
        float spin, sigilSpin, pulse, deadAt = -1, seed;
        Vector3 groundP, groundN = Vector3.up;

        /// <summary>飞行 / 悬浮的精英：金环投到地面（<see cref="Attach"/> 时按 AI 类型和定义认）</summary>
        public bool Hovering { get; private set; }
        /// <summary>飞行精英这一帧脚下找到了地面（金环画在地上）</summary>
        public bool GroundFound { get; private set; } = true;
        /// <summary>离脚下地面多高（米；不是飞行精英或没找到地面时为 0）</summary>
        public float Altitude { get; private set; }
        /// <summary>金环此刻的世界位置（测试 / 套件读）</summary>
        public Vector3 RingPosition => ringT ? ringT.position : transform.position;
        /// <summary>金环此刻画没画</summary>
        public bool RingVisible => ring && ring.enabled;
        /// <summary>飞行体上的小悬浮标识此刻画没画</summary>
        public bool HoverMarkVisible => hoverMark && hoverMark.enabled;

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
            a.Hovering = IsHover(ai);
            a.Build();
            return a;
        }

        /// <summary>飞行 / 悬浮的敌人：飞行 AI，或定义里标了 flying（邪飞天按导航偏移浮在半空）</summary>
        public static bool IsHover(EnemyAI ai) => ai && IsHover(ai is FlyingEnemyAI, ai.enemyId);

        public static bool IsHover(bool flyingAi, string enemyId) => flyingAi || EnemyRoster.Get(enemyId) is { flying: true };

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
            if (Hovering)
            {
                hoverMark = Quad("Elite Hover Mark", Mathf.Clamp(Radius * HoverK, 0.22f, 0.45f), 0.05f, RingMaterial);
                hoverT = hoverMark.transform;
            }
            Refresh();
        }

        /// <summary>飞行精英：从身上往下找地面（地形 / 建筑；角色不算）</summary>
        bool ProbeGround()
        {
            var p = transform.position;
            if (Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, out var hit, GroundProbe, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                groundP = hit.point;
                groundN = hit.normal.y > 0.2f ? hit.normal : Vector3.up;
                Altitude = Mathf.Max(0, p.y - hit.point.y);
                return true;
            }
            Altitude = 0;
            return false;
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
            // 飞行精英：金环画在脚下的地面上，找不到地面就不画；飞行体上只留小悬浮标识
            bool onGround = true;
            if (Hovering) GroundFound = onGround = show && ProbeGround();
            ring.enabled = show && onGround;
            bool sigilOn = show && onGround && accent && accent.gameObject.activeSelf;
            if (accent) accent.enabled = sigilOn;
            bool markOn = Hovering && show && (!onGround || Altitude > HoverMin);
            if (hoverMark) hoverMark.enabled = markOn;
            if (!show) return;
            bool lite = Fx.Density < 0.6f;
            pulse = Mathf.Max(0, pulse - dt * 3f);

            // 金环：慢转（菱形钉缓缓走动）、轻呼吸；死亡时收拢到 35% 并先亮一下再淡掉
            float shrink = collapse > 0 ? Mathf.Lerp(1f, 0.35f, collapse * collapse) : 1f;
            float flash = collapse > 0 ? Mathf.Sin(Mathf.Clamp01(collapse * 1.6f) * Mathf.PI) : 0f;
            if (!lite) spin += dt * 9f;
            // 贴地：顺着地面法线躺平（飞行精英每帧重新放；地上走的仍是根节点下的局部姿态）
            var tilt = Hovering ? Quaternion.FromToRotation(Vector3.up, groundN) : Quaternion.identity;
            if (Hovering) ringT.SetPositionAndRotation(groundP + groundN * 0.05f, tilt * Quaternion.Euler(90, seed + spin, 0));
            else ringT.localRotation = Quaternion.Euler(90, seed + spin, 0);
            ringT.localScale = new Vector3(Radius * 2 * shrink, Radius * 2 * shrink, 1);
            float breath = lite ? 1f : 0.88f + 0.12f * Mathf.Sin(t * 2.4f + seed);
            var g = new Color(Gold.r * GoldHdr, Gold.g * GoldHdr, Gold.b * GoldHdr, breath * (1f - collapse) + flash * 0.4f);
            g.r += flash;
            g.g += flash * 0.8f;
            g.b += flash * 0.5f;
            block.Clear();
            block.SetColor(BaseColorId, g);
            ring.SetPropertyBlock(block);
            if (markOn)
            {
                // 悬浮标识：飞行体脚下一圈小金环，水平（不跟着机身侧倾），同色同呼吸
                float hr = Mathf.Clamp(Radius * HoverK, 0.22f, 0.45f) * 2 * shrink;
                hoverT.SetPositionAndRotation(transform.position + Vector3.up * 0.05f, Quaternion.Euler(90, seed - spin * 2f, 0));
                hoverT.localScale = new Vector3(hr, hr, 1);
                hoverMark.SetPropertyBlock(block);
            }
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
            if (Hovering) accentT.SetPositionAndRotation(groundP + groundN * 0.06f, tilt * Quaternion.Euler(90, seed * 0.5f - sigilSpin, 0));
            else accentT.localRotation = Quaternion.Euler(90, seed * 0.5f - sigilSpin, 0);
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
