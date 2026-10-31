using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 反应判定读 / 改外部状态的接口：敌人身上的元素状态、关卡强度、玩家属性、归墟预警。
    /// 默认接 <see cref="EnemyStatus"/> / <see cref="Combat.playerStats"/> / <see cref="Telegraph"/>（<see cref="GameReactionEnv"/>）；
    /// EditMode 测试换成假的，就能在没有场景、没有 Time 的情况下验证判定、冷却、预算。
    /// </summary>
    public interface IReactionEnv
    {
        /// <summary>敌人身上有没有这个元素状态</summary>
        bool Has(Damageable d, StatusId id);
        /// <summary>雷殛强度（不含属性加成；没有雷殛为 0）</summary>
        float ShockPower(Damageable d);
        /// <summary>灼烧 / 蚀化剩下的跳伤总量（与强度同口径，不含属性倍率）</summary>
        float DotRemainingRaw(Damageable d, StatusId id);
        /// <summary>归墟消耗灼烧：清空并返回结清值</summary>
        float ConsumeBurn(Damageable d);
        /// <summary>归墟消耗雷殛：直接移除</summary>
        void ConsumeShock(Damageable d);
        /// <summary>关卡强度 S（敌人等级换算）</summary>
        float Strength(Damageable d);
        /// <summary>玩家「反应急速」</summary>
        float Haste { get; }
        /// <summary>持续伤害每一跳会乘的属性倍率（元素类 × 精英 / 首领）</summary>
        float DotStatMultiplier(Damageable d, Element e);
        /// <summary>归墟收束预警（地面紫圈，持续到劈下）</summary>
        void Windup(Damageable d, Vector3 point, float seconds);
    }

    /// <summary>运行时的 <see cref="IReactionEnv"/>：读 EnemyStatus、玩家属性表，预警画 Telegraph</summary>
    public sealed class GameReactionEnv : IReactionEnv
    {
        public static readonly GameReactionEnv Instance = new();

        public bool Has(Damageable d, StatusId id)
        {
            var s = EnemyStatus.Of(d);
            if (!s) return false;
            return id switch
            {
                StatusId.Burn => s.Burning,
                // 第四章：带电（Charge）就反应而言等同带雷殛
                StatusId.Shock => s.Shocked || Charge.IsCharged(d),
                StatusId.Corrode => s.Corroded,
                _ => s.TryGet(id, out _),
            };
        }

        public float ShockPower(Damageable d)
        {
            var s = EnemyStatus.Of(d);
            return s && s.Shocked ? s.ShockPower : 0;
        }

        public float DotRemainingRaw(Damageable d, StatusId id)
        {
            var s = EnemyStatus.Of(d);
            return s ? s.RemainingDotRaw(id) : 0;
        }

        public float ConsumeBurn(Damageable d)
        {
            var s = EnemyStatus.Of(d);
            return s ? s.ConsumeBurn() : 0;
        }

        public void ConsumeShock(Damageable d)
        {
            var s = EnemyStatus.Of(d);
            if (s) s.ConsumeShock();
        }

        public float Strength(Damageable d)
        {
            var ai = d ? d.GetComponent<EnemyAI>() : null;
            return ReactionMath.Strength(ai ? ai.level : 1);
        }

        public float Haste => Combat.playerStats?.Get(Stat.ReactionHaste) ?? 0;

        public float DotStatMultiplier(Damageable d, Element e) => DamageCalc.DotStatMultiplier(d, e);

        /// <summary>归墟收束：紫色预警圈 + 三色涡旋把光点卷进中心（FX2，<see cref="Fx.AbyssWindup"/>）</summary>
        public void Windup(Damageable d, Vector3 point, float seconds) =>
            Fx.AbyssWindup(ReactionSystem.Ground(point), CombatTuning.Abyss.WarnRadius, seconds);
    }
}
