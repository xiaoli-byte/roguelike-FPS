using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人身上的状态（Three.js 版 src/combat/Status.ts）：
    ///   灼烧：每层独立计时 4 s，最多 3 层（满层替换剩余最短的一层），每 0.5 s 跳 Σ层强度 × 0.16（一层烧满 = 强度 × 1.28）
    ///   雷殛：标记 3 s（再附着刷新时长、层数 +1）；直接命中（深度 0）附着时向 8 m 内最多 3 个敌人弹射 强度 × 0.5（间隔 ≥ 0.2 s）；
    ///         叠到 3 层清空并眩晕 0.8 s；带标记的敌人受到的雷电伤害 ×1.15（在 Combat 里乘）
    ///   蚀化：5 s，每 0.5 s 跳 强度 × 0.08；期间承伤 ×1.2、移速 ×0.8
    ///   眩晕：AI 停摆（精英时长 ×0.75）；减速：最多 4 条，取最强的一条
    /// 强度 = 附着那一下的实际伤害，上限为敌人最大生命的一半。持续伤害走 Combat.DamageEnemy（source Status，不暴击、不再附着）。
    /// 元素相遇的反应判定在 <see cref="ReactionSystem"/>（附着之前判定）。第一次附着时才挂到敌人身上。
    /// </summary>
    public sealed class EnemyStatus : MonoBehaviour
    {
        public const float BurnDuration = 4f, BurnTick = 0.5f, BurnRatio = 0.16f;
        public const int BurnMaxStacks = 3;
        public const float ShockDuration = 3f, ShockChainRange = 8f, ShockChainRatio = 0.5f, ShockStun = 0.8f, ShockMarkBonus = 1.15f;
        public const int ShockChainTargets = 3, ShockStunStacks = 3;
        public const float CorrodeDuration = 5f, CorrodeTick = 0.5f, CorrodeRatio = 0.08f, CorrodeTaken = 1.2f, CorrodeSlow = 0.8f;
        const float ChainCooldown = 0.2f, SlowMax = 0.9f;

        struct Stack
        {
            public float power, remaining;
        }

        readonly List<Stack> burn = new();
        readonly List<Stack> slows = new();
        Damageable hp;
        float burnTimer, corrodeTimer, chainReadyAt;
        float shockRemaining, shockPower;
        int shockStacks;
        float corrodeRemaining, corrodePower;
        float stunUntil = -1;
        Transform burnGlow, shockGlow, corrodeGlow;

        public bool Burning => burn.Count > 0;
        public int BurnStacks => burn.Count;
        public bool Shocked => shockStacks > 0;
        public int ShockStacks => shockStacks;
        public float ShockPower => shockPower;
        public bool Corroded => corrodeRemaining > 0;
        public bool Stunned => Time.time < stunUntil;
        /// <summary>移速倍率（蚀化 ×0.8、减速），AI 移动时乘上</summary>
        public float SlowMult { get; private set; } = 1f;

        public static EnemyStatus Of(Damageable d) => d ? d.GetComponent<EnemyStatus>() : null;

        static EnemyStatus Ensure(Damageable d)
        {
            var s = d.GetComponent<EnemyStatus>();
            return s ? s : d.gameObject.AddComponent<EnemyStatus>();
        }

        public static bool IsBurning(Damageable d)
        {
            var s = Of(d);
            return s && s.Burning;
        }

        public static bool Has(Damageable d, Element e)
        {
            var s = Of(d);
            if (!s) return false;
            return e switch
            {
                Element.Fire => s.Burning,
                Element.Shock => s.Shocked,
                Element.Corrode => s.Corroded,
                _ => false,
            };
        }

        /// <summary>
        /// 附着元素状态。killed = 这一击已经打死了它：只做雷殛弹射（深度 0），不再挂状态。
        /// 调用前由 <see cref="ReactionSystem.TryReact"/> 判定反应（反应不消耗两两状态，所以照常附着）。
        /// power = 状态强度（不含元素 / 精英 / 首领加成，每一跳结算时再乘）。返回是否挂上（击杀那一击的雷殛弹射也算）。
        /// </summary>
        public static bool Apply(Damageable d, Element e, float power, int depth, bool killed)
        {
            if (!d || e == Element.None || power <= 0) return false;
            power = Mathf.Min(power, d.maxHealth * 0.5f);
            if (killed || d.Dead)
            {
                if (e != Element.Shock || depth != 0) return false;
                ChainFrom(d, power, depth);
                return true;
            }
            if (d.untargetable) return false;
            var s = Ensure(d);
            switch (e)
            {
                case Element.Fire: s.AddBurn(power); break;
                case Element.Shock: s.AddShock(power, depth); break;
                case Element.Corrode: s.AddCorrode(power); break;
            }
            return true;
        }

        public static void Stun(Damageable d, float seconds)
        {
            if (!d || d.Dead || d.untargetable) return;
            var s = Ensure(d);
            if (d.elite) seconds *= 0.75f;
            s.stunUntil = Mathf.Max(s.stunUntil, Time.time + seconds);
            ShotFx.Instance?.Impact(s.Center + Vector3.up * 0.5f, Vector3.up, false, 2f);
        }

        public static void Slow(Damageable d, float strength, float seconds)
        {
            if (!d || d.Dead || strength <= 0) return;
            var s = Ensure(d);
            strength = Mathf.Clamp(strength, 0, SlowMax);
            if (s.slows.Count < 4) s.slows.Add(new Stack { power = strength, remaining = seconds });
            else
            {
                int weakest = 0;
                for (int i = 1; i < s.slows.Count; i++)
                    if (s.slows[i].power * s.slows[i].remaining < s.slows[weakest].power * s.slows[weakest].remaining) weakest = i;
                s.slows[weakest] = new Stack { power = strength, remaining = seconds };
            }
        }

        /// <summary>归墟消耗灼烧：清空并返回剩余伤害的结清值 Σ层强度 × 0.16 × 剩余跳数</summary>
        public float ConsumeBurn()
        {
            float cash = 0;
            foreach (var st in burn) cash += st.power * BurnRatio * Mathf.Ceil(st.remaining / BurnTick);
            burn.Clear();
            return cash;
        }

        public void ConsumeShock()
        {
            shockStacks = 0;
            shockRemaining = 0;
        }

        Vector3 Center
        {
            get
            {
                var col = GetComponent<Collider>();
                return col && col.enabled ? col.bounds.center : transform.position + Vector3.up;
            }
        }

        void Awake() => hp = GetComponent<Damageable>();

        void AddBurn(float power)
        {
            if (burn.Count == 0) burnTimer = BurnTick;
            if (burn.Count < BurnMaxStacks) burn.Add(new Stack { power = power, remaining = BurnDuration });
            else
            {
                int oldest = 0;
                for (int i = 1; i < burn.Count; i++)
                    if (burn[i].remaining < burn[oldest].remaining) oldest = i;
                burn[oldest] = new Stack { power = power, remaining = BurnDuration };
            }
            Glow(ref burnGlow, new Color(1f, 0.45f, 0.12f, 0.45f), Vector3.zero);
        }

        void AddShock(float power, int depth)
        {
            shockStacks++;
            shockRemaining = Mathf.Max(shockRemaining, ShockDuration);
            shockPower = Mathf.Max(shockPower, power);
            Glow(ref shockGlow, new Color(0.45f, 0.75f, 1f, 0.5f), Vector3.up * 0.25f);
            if (depth == 0 && Time.time >= chainReadyAt)
            {
                chainReadyAt = Time.time + ChainCooldown;
                ChainFrom(hp, power, depth);
            }
            if (shockStacks >= ShockStunStacks && !hp.Dead)
            {
                ConsumeShock();
                Stun(hp, ShockStun);
            }
        }

        void AddCorrode(float power)
        {
            if (corrodeRemaining <= 0) corrodeTimer = CorrodeTick;
            corrodeRemaining = Mathf.Max(corrodeRemaining, CorrodeDuration);
            corrodePower = Mathf.Max(corrodePower, power);
            Glow(ref corrodeGlow, new Color(0.55f, 0.95f, 0.3f, 0.45f), Vector3.down * 0.25f);
        }

        void Glow(ref Transform glow, Color c, Vector3 offset)
        {
            if (!glow)
            {
                var anchor = new GameObject("Status Glow").transform;
                anchor.SetParent(transform, false);
                anchor.position = Center + offset;
                glow = FxMaterials.GlowSprite(anchor, 2.2f, c);
            }
            glow.gameObject.SetActive(true);
        }

        /// <summary>雷殛弹射：从 source 向 8 m 内最近的 3 个其他敌人放闪电（要有视线），强度 × 0.5 雷电伤害，深度 +1 不再弹射</summary>
        public static void ChainFrom(Damageable source, float power, int depth)
        {
            if (!source || power <= 0) return;
            var from = ReactionSystem.CenterOf(source);
            GameAudio.PlayAt("shock_zap", from, 0.65f, 0.9f + Random.value * 0.25f);
            var picked = ReactionSystem.Nearest(from, ShockChainRange, ShockChainTargets, source, true);
            foreach (var t in picked)
            {
                var to = ReactionSystem.CenterOf(t);
                Lightning.Spawn(from, to, DamageTable.ElementColor(Element.Shock));
                var info = DamageInfo.Simple(power * ShockChainRatio, DamageSource.Status, to, (to - from).normalized);
                info.element = Element.Shock;
                info.depth = depth + 1;
                info.tags = DamageTag.Chain;
                Combat.DamageEnemy(t, info);
            }
        }

        void Update()
        {
            if (!hp || hp.Dead)
            {
                burn.Clear();
                shockStacks = 0;
                corrodeRemaining = 0;
                SetGlows();
                enabled = false;
                return;
            }
            float dt = Time.deltaTime;
            if (burn.Count > 0)
            {
                burnTimer -= dt;
                if (burnTimer <= 0)
                {
                    burnTimer += BurnTick;
                    float sum = 0;
                    foreach (var s in burn) sum += s.power * BurnRatio;
                    Dot(sum, Element.Fire);
                    GameAudio.PlayAt("burn_tick", transform.position + Vector3.up, 0.28f, 0.9f + Random.value * 0.2f);
                }
                for (int i = burn.Count - 1; i >= 0; i--)
                {
                    var s = burn[i];
                    s.remaining -= dt;
                    if (s.remaining <= 0) burn.RemoveAt(i);
                    else burn[i] = s;
                }
            }
            if (shockStacks > 0)
            {
                shockRemaining -= dt;
                if (shockRemaining <= 0) ConsumeShock();
            }
            if (corrodeRemaining > 0)
            {
                corrodeTimer -= dt;
                if (corrodeTimer <= 0)
                {
                    corrodeTimer += CorrodeTick;
                    Dot(corrodePower * CorrodeRatio, Element.Corrode);
                    GameAudio.PlayAt("corrode_tick", transform.position + Vector3.up, 0.28f, 0.9f + Random.value * 0.2f);
                }
                corrodeRemaining -= dt;
                if (corrodeRemaining <= 0) corrodePower = 0;
            }
            float slow = Corroded ? CorrodeSlow : 1f;
            for (int i = slows.Count - 1; i >= 0; i--)
            {
                var s = slows[i];
                s.remaining -= dt;
                if (s.remaining <= 0) { slows.RemoveAt(i); continue; }
                slows[i] = s;
                slow = Mathf.Min(slow, 1 - s.power);
            }
            SlowMult = slow;
            hp.statusTakenMult = Corroded ? CorrodeTaken : 1f;
            SetGlows();
        }

        void Dot(float amount, Element e)
        {
            if (amount <= 0) return;
            var c = Center;
            var info = DamageInfo.Simple(amount, DamageSource.Status, c, Vector3.up);
            info.element = e;
            info.depth = 1;
            info.tags = DamageTag.Dot;
            if (e == Element.Fire) ShotFx.Instance?.Impact(c + Random.insideUnitSphere * 0.3f, Vector3.up, true, 0.8f);
            Combat.DamageEnemy(hp, info);
        }

        void SetGlows()
        {
            float pulse = Mathf.Sin(Time.time * 13) * 0.15f;
            if (burnGlow)
            {
                burnGlow.gameObject.SetActive(burn.Count > 0);
                burnGlow.localScale = Vector3.one * (1.6f + 0.3f * burn.Count + pulse);
            }
            if (shockGlow)
            {
                shockGlow.gameObject.SetActive(shockStacks > 0 || Stunned);
                shockGlow.localScale = Vector3.one * (1.4f + 0.35f * shockStacks + (Random.value < 0.3f ? 0.4f : 0));
            }
            if (corrodeGlow) corrodeGlow.gameObject.SetActive(Corroded);
        }
    }
}
