using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>受击四层（第四章，combat 1.1）：受击（闪白 + 数字）→ 抖动（韧性未破）→ 硬直（韧性破）→ 眩晕（反制 / 破防 / 封脉）</summary>
    public enum HitLayer
    {
        /// <summary>每一枪：闪白 + 数字（EnemyBody），轻怪顿一下（<see cref="EnemyDef.hitch"/>）</summary>
        Flinch,
        /// <summary>韧性未破：按命中方向的小抖动（CreatureRig 受击弹簧）</summary>
        Jolt,
        /// <summary>韧性破：踉跄 0.4–0.9 s，打断招式（霸体除外）、撤预警</summary>
        Stagger,
        /// <summary>反制 / 破防 / 封脉：停 1.5–4 s，受伤 +25%</summary>
        Stun,
    }

    /// <summary>硬直 / 眩晕从哪来（AI 的表现可以按它分：被打下来的穷奇、手里炸石的举父…）</summary>
    public enum HitCause
    {
        /// <summary>韧性破（<see cref="Poise"/>）</summary>
        Poise,
        /// <summary>专属反制：举父手中炸石、獓狠雷球引爆、穷奇滑翔被打下来、飞廉撞冰脊</summary>
        Counter,
        /// <summary>破防（首领的破防条）</summary>
        Break,
        /// <summary>元素反应（封脉）</summary>
        Reaction,
        /// <summary>场地机关、剧本（回劈、落石）</summary>
        Script,
    }

    /// <summary>
    /// 受击四层的统一入口（第四章；docs/unity-ch4-port.md 第 2 节契约）。数值和韧性规则在这里，状态和表现在 <see cref="EnemyAI"/>：
    ///   · 硬直：<see cref="EnemyAI.HitStagger"/>(秒, 来向, 原因) —— 打断招式、撤预警、停摆 seconds 秒；霸体（<see cref="EnemyAI.SuperArmor"/>）时不进。
    ///   · 眩晕：<see cref="EnemyAI.HitStun"/>(秒, 原因) —— 走元素眩晕（头顶晕圈、AI 停摆，精英 ×0.75），期间受伤 × <see cref="StunTakenMult"/>。
    ///   · 顿一下：<see cref="EnemyAI.Hitch"/>(秒) —— 轻怪每挨一枪停一小下，不打断招式。
    ///   · 韧性：<see cref="Poise"/> 组件（<see cref="EnemyDef.poise"/> &gt; 0 的敌人生成时自动挂）按 <see cref="PoiseDamage"/> 累计，满了调硬直。
    /// 首领（BossBrain）把硬直 / 眩晕转成自己的 <see cref="BossBrain.Stagger"/>。
    /// 子类（第四章的 PlateauEnemyAI）只覆写表现：<c>OnHitStagger</c> / <c>OnHitStaggerEnd</c> / <c>OnHitStun</c> / <c>SuperArmor</c>。
    /// </summary>
    public static class HitReaction
    {
        /// <summary>韧性的累计窗口：每秒回落韧性值的一半（2 秒内累计超过韧性才硬直）</summary>
        public const float PoiseDecayPerSecond = 0.5f;
        /// <summary>韧性伤害倍率：弱点 ×2，爆炸 / 反应 ×3</summary>
        public const float WeakPoise = 2f, BlastPoise = 3f;
        /// <summary>眩晕期间受伤倍率（+25%）</summary>
        public const float StunTakenMult = 1.25f;

        /// <summary>一次伤害的韧性伤害（持续伤害 0；反应 / 爆炸 ×3；弱点 ×2；其余 ×1）</summary>
        public static float PoiseDamage(in DamageInfo info, float dealt)
        {
            if (!(dealt > 0)) return 0;
            bool reaction = info.reaction || (info.tags & DamageTag.Reaction) != 0;
            if (info.source == DamageSource.Status && !reaction) return 0;
            if (reaction || info.source == DamageSource.Explosion) return dealt * BlastPoise;
            if (info.weakpoint) return dealt * WeakPoise;
            return dealt;
        }

        /// <summary>对某个单位进硬直（找它的 EnemyAI；没有 / 死了返回 false）</summary>
        public static bool Stagger(Damageable target, float seconds, Vector3 from, HitCause cause = HitCause.Script)
        {
            var ai = target ? target.GetComponent<EnemyAI>() : null;
            return ai && ai.HitStagger(seconds, from, cause);
        }

        /// <summary>对某个单位进眩晕（找它的 EnemyAI；没有 / 死了返回 false）</summary>
        public static bool Stun(Damageable target, float seconds, HitCause cause = HitCause.Script, string why = null)
        {
            var ai = target ? target.GetComponent<EnemyAI>() : null;
            return ai && ai.HitStun(seconds, cause, why);
        }
    }
}
