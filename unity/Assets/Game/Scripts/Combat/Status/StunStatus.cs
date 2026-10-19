using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 眩晕规则（Three.js IEnemy.stunImmune）：挂在敌人身上的组件实现它（首领大脑：出招中、登场、转阶段时霸体）。
    /// 施加眩晕前询问，任一组件说免疫就直接忽略——不写状态、不播特效、不派发事件，也不开始首领的免疫计时。
    /// </summary>
    public interface IStunPolicy
    {
        /// <summary>此刻免疫眩晕</summary>
        bool StunImmune { get; }
    }

    /// <summary>
    /// 眩晕（Three.js 版 src/combat/Status.ts stun）：AI 停摆。
    ///   精英时长 ×0.75；首领时长 ×0.35 且不超过 0.35 s，成功眩晕后 6.1 s 内免疫（与首领自己的霸体规则一致，免得首领实际免疫时还播
    ///   「眩晕」反馈；多留 0.1 s 余量）。<see cref="IStunPolicy.StunImmune"/> 时直接忽略。
    /// </summary>
    [Defs]
    public sealed class StunStatus : IStatusEffect
    {
        public const float DefaultSeconds = 1f, EliteScale = 0.75f, BossScale = 0.35f, BossMax = 0.35f, BossImmunity = 6.1f;

        public string Id => "stun";
        public StatusId Status => StatusId.Stun;
        public string Name => "眩晕";
        public Color Color => new(1f, 0.89f, 0.48f);
        public StatusHosts Hosts => StatusHosts.Enemy;
        public Element Element => Element.None;
        public StatusInstance Create(IStatusHost host) => new StunInstance(host as EnemyStatus);

        /// <summary>按级别缩放后的眩晕时长（不含首领免疫期的判断）：精英 ×0.75，首领 ×0.35 且 ≤ 0.35 s</summary>
        public static float ScaledDuration(Rank rank, float seconds)
        {
            if (!(seconds > 0)) return 0;
            return rank switch
            {
                Rank.Boss => Mathf.Min(BossMax, seconds * BossScale),
                Rank.Elite => seconds * EliteScale,
                _ => seconds,
            };
        }

        /// <summary>此刻免疫眩晕：身上任一 <see cref="IStunPolicy"/> 组件说免疫（空引用视为免疫）</summary>
        public static bool Immune(Damageable d)
        {
            if (!d) return true;
            foreach (var p in d.GetComponents<IStunPolicy>())
                if (p is Object o && o && p.StunImmune) return true;
            return false;
        }
    }

    /// <summary>挂在敌人身上的眩晕：截止时间与首领的免疫期</summary>
    public sealed class StunInstance : EnemyStatusInstance
    {
        float until = -1, immuneUntil = -1;

        public StunInstance(EnemyStatus host) : base(host) { }

        public override StatusId Id => StatusId.Stun;
        public override bool Active => Time.time < until;
        /// <summary>首领的眩晕免疫期还剩多久（不是首领、或不在免疫期为 0）</summary>
        public float ImmuneRemaining => Mathf.Max(0, immuneUntil - Time.time);

        public override bool Apply(in StatusApply a)
        {
            var hp = Hp;
            if (hp && StunStatus.Immune(hp)) return false;
            float now = Time.time;
            var rank = hp ? hp.rank : Rank.Normal;
            if (rank == Rank.Boss && now < immuneUntil) return false;
            float dur = StunStatus.ScaledDuration(rank, a.duration > 0 ? a.duration : StunStatus.DefaultSeconds);
            if (!(dur > 0)) return false;
            if (rank == Rank.Boss) immuneUntil = now + StunStatus.BossImmunity;
            until = Mathf.Max(until, now + dur);
            if (host) ShotFx.Instance?.Impact(host.Center + Vector3.up * 0.5f, Vector3.up, false, 2f);
            Notify(1);
            return true;
        }

        public override void Tick(float dt) { }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Stun };
            if (!Active) return false;
            view.stacks = 1;
            view.remaining = until - Time.time;
            return true;
        }

        /// <summary>解除眩晕（首领的免疫期保留）</summary>
        public override void Clear() => until = -1;
    }
}
