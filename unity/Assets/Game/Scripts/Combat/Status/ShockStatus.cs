using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 雷殛（Three.js 版 src/combat/Status.ts shock）：雷属性命中附着。
    ///   标记 3 s（再附着刷新时长、层数 +1，强度取较大）；直接命中（深度 0）附着时向 8 m 内最多 3 个有视线的敌人弹射 强度 × 0.5 雷伤
    ///   （同一敌人两次弹射间隔 ≥ 0.2 s）；叠到 3 层清空并眩晕 0.8 s；带标记的敌人受到的雷电伤害 ×1.15（在 Combat 里乘）。
    /// </summary>
    [Defs]
    public sealed class ShockStatus : IStatusEffect
    {
        public const float Duration = 3f, ChainRange = 8f, ChainRatio = 0.5f, StunSeconds = 0.8f, MarkBonus = 1.15f, ChainCooldown = 0.2f;
        public const int ChainTargets = 3, StunStacks = 3;
        internal static readonly Color GlowColor = new(0.45f, 0.75f, 1f, 0.5f);

        public string Id => "shock";
        public StatusId Status => StatusId.Shock;
        public string Name => "雷殛";
        public Color Color => DamageTable.ElementColor(Element.Shock);
        public StatusHosts Hosts => StatusHosts.Enemy;
        public Element Element => Element.Shock;
        public StatusInstance Create(IStatusHost host) => new ShockInstance(host as EnemyStatus);

        /// <summary>
        /// 雷殛弹射：从 source 向 8 m 内最近的 3 个其他敌人放闪电（要有视线、可选中），强度 × 0.5 雷电伤害，深度 +1 不再弹射。
        /// source 已死时也可以调用（击杀那一击同样弹射）。打中至少一个才出声（节流见 <see cref="StatusAudio"/>）。
        /// </summary>
        public static void ChainFrom(Damageable source, float power, int depth)
        {
            if (!source || !(power > 0)) return;
            var from = ReactionSystem.CenterOf(source);
            var picked = ReactionSystem.Nearest(from, ChainRange, ChainTargets, source, true);
            int zapped = 0;
            foreach (var t in picked)
            {
                if (!t || t.Dead || t.untargetable) continue;
                var to = ReactionSystem.CenterOf(t);
                Lightning.Spawn(from, to, DamageTable.ElementColor(Element.Shock));
                var dir = to - from;
                var info = DamageInfo.Simple(power * ChainRatio, DamageSource.Status, to, dir.sqrMagnitude > 1e-8f ? dir.normalized : Vector3.up);
                info.element = Element.Shock;
                info.depth = depth + 1;
                info.tags = DamageTag.Chain;
                info.noCrit = true;
                zapped++;
                Combat.DamageEnemy(t, info);
            }
            if (zapped > 0) StatusAudio.Zap(from);
        }
    }

    /// <summary>挂在敌人身上的雷殛标记</summary>
    public sealed class ShockInstance : EnemyStatusInstance
    {
        int stacks;
        float remaining, power, chainReadyAt;
        Transform glow;

        public ShockInstance(EnemyStatus host) : base(host) { }

        public override StatusId Id => StatusId.Shock;
        public override bool Active => stacks > 0;
        public int Stacks => stacks;
        public float Power => stacks > 0 ? power : 0;

        public override bool Apply(in StatusApply a)
        {
            float p = Cap(a.power);
            stacks++;
            remaining = Mathf.Max(remaining, a.duration > 0 ? a.duration : ShockStatus.Duration);
            power = Mathf.Max(power, p);
            Glow(ref glow, ShockStatus.GlowColor, Vector3.up * 0.25f);
            Notify(stacks);
            var hp = Hp;
            if (a.depth == 0 && Time.time >= chainReadyAt)
            {
                chainReadyAt = Time.time + ShockStatus.ChainCooldown;
                if (hp) ShockStatus.ChainFrom(hp, p, a.depth);
            }
            // 叠满：清空层数并眩晕（弹射可能已经顺带打死了它，再检查一次）
            if (stacks >= ShockStatus.StunStacks && !(hp && hp.Dead))
            {
                Clear();
                if (hp) EnemyStatus.Stun(hp, ShockStatus.StunSeconds);
            }
            return true;
        }

        public override void Tick(float dt)
        {
            remaining -= dt;
            if (remaining <= 0) Clear();
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Shock };
            if (stacks <= 0) return false;
            view.stacks = stacks;
            view.remaining = remaining;
            view.power = power;
            return true;
        }

        /// <summary>清空（到期、叠满眩晕、归墟消耗）：强度一并归零，下次附着重新取值</summary>
        public override void Clear()
        {
            stacks = 0;
            remaining = 0;
            power = 0;
        }

        public override void UpdateVisual(float pulse)
        {
            if (!glow) return;
            glow.gameObject.SetActive(stacks > 0 || (host && host.Stunned));
            glow.localScale = Vector3.one * (1.4f + 0.35f * stacks + (Random.value < 0.3f ? 0.4f : 0));
        }
    }
}
