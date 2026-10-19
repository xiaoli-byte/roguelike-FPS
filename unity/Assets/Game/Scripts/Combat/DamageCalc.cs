using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 伤害计算的纯函数部分（Three.js 版 src/combat/DamageCalc.ts）：按标签算属性乘区、持续伤害与反应的强度换算、层倍率。
    /// 不产生副作用，Combat、UI 预览、EditMode 测试共用。stats 为 null（没有玩家）时一律按 1 算。
    /// </summary>
    public static class DamageCalc
    {
        /// <summary>「处决」：基础伤害达到这个值，或带 <see cref="DamageTag.Purge"/></summary>
        public const float ExecuteBase = 1e6f;

        /// <summary>请求的全部标签：显式写的 + 来源隐含的（武器 → Weapon、技能 → Skill、爆炸 → Explosion、灵宠 → Pet）+ reaction 字段</summary>
        public static DamageTag EffectiveTags(in DamageInfo i)
        {
            var t = i.tags;
            switch (i.source)
            {
                case DamageSource.Weapon: t |= DamageTag.Weapon; break;
                case DamageSource.Skill: t |= DamageTag.Skill; break;
                case DamageSource.Explosion: t |= DamageTag.Explosion; break;
                case DamageSource.Pet: t |= DamageTag.Pet; break;
            }
            if (i.reaction) t |= DamageTag.Reaction;
            return t;
        }

        public static bool IsReaction(in DamageInfo i) => i.reaction || (i.tags & DamageTag.Reaction) != 0;

        /// <summary>
        /// 持续伤害跳伤（灼烧 / 蚀化 / 熔池）：来源 Status，不是雷殛弹射，也不是反应伤害（熔池跳伤带 Dot 的除外）。
        /// 同 Three.js isDot。
        /// </summary>
        public static bool IsDot(in DamageInfo i) =>
            i.source == DamageSource.Status && (i.tags & DamageTag.Chain) == 0 && (!IsReaction(i) || (i.tags & DamageTag.Dot) != 0);

        /// <summary>处决：不弹伤害数字、命中火花与命中音（静默处决另外不算玩家战果）</summary>
        public static bool IsExecute(in DamageInfo i) => !(i.amount < ExecuteBase) || (i.tags & DamageTag.Purge) != 0;

        public static float StatMultiplier(in DamageInfo i, Damageable t) => StatMultiplier(Combat.playerStats, i, t);

        /// <summary>
        /// 属性带来的输出倍率（不含暴击、修饰器、分层）：
        ///   · 反应伤害：只乘「反应伤害」——威力取自附着强度，已含下面这些加成，避免二次相乘
        ///   · 灵宠：只乘「灵宠伤害」（不吃武器 / 技能 / 爆炸伤害）
        ///   · 非持续伤害：武器 / 近战 × 武器伤害，技能 × 技能伤害，爆炸 × 爆炸伤害（武器投射物的爆炸两个都吃）
        ///   · 带元素：× 元素伤害 × 对应元素伤害（持续伤害也吃：状态强度附着时已除掉，见 <see cref="StatusPowerFromDealt"/>）
        ///   · 精英 × 精英伤害，首领 × 首领伤害
        /// </summary>
        public static float StatMultiplier(StatSheet s, in DamageInfo i, Damageable t)
        {
            if (s == null) return 1f;
            if (IsReaction(i)) return s.Mult(Stat.ReactionDamagePct);
            var tags = EffectiveTags(i);
            float m = 1f;
            if (i.source != DamageSource.Status)
            {
                if ((tags & DamageTag.Pet) != 0) m *= s.Mult(Stat.PetDamagePct);
                else
                {
                    if ((tags & (DamageTag.Weapon | DamageTag.Melee)) != 0) m *= s.Mult(Stat.DamagePct);
                    if ((tags & DamageTag.Skill) != 0) m *= s.Mult(Stat.SkillDamagePct);
                    if ((tags & DamageTag.Explosion) != 0) m *= s.Mult(Stat.ExplosionDamagePct);
                }
            }
            if (i.element != Element.None) m *= s.Mult(Stat.ElementDamagePct) * s.Mult(ElementStat(i.element));
            if (t)
            {
                if (t.rank == Rank.Elite) m *= s.Mult(Stat.EliteDamagePct);
                else if (t.rank == Rank.Boss) m *= s.Mult(Stat.BossDamagePct);
            }
            return m;
        }

        public static float DotStatMultiplier(Damageable t, Element e) => DotStatMultiplier(Combat.playerStats, t, e);

        /// <summary>
        /// 持续伤害（灼烧 / 雷殛弹射 / 蚀化）每一跳会吃到的属性倍率：元素类 × 精英 / 首领。
        /// 状态强度取自触发那一击的实际伤害，其中已经含有这些倍率：附着时先除掉、每一跳再乘回，同一份加成只算一次。
        /// </summary>
        public static float DotStatMultiplier(StatSheet s, Damageable t, Element e)
        {
            if (s == null) return 1f;
            float m = 1f;
            if (e != Element.None) m *= s.Mult(Stat.ElementDamagePct) * s.Mult(ElementStat(e));
            if (t)
            {
                if (t.rank == Rank.Elite) m *= s.Mult(Stat.EliteDamagePct);
                else if (t.rank == Rank.Boss) m *= s.Mult(Stat.BossDamagePct);
            }
            return m > 0 && !float.IsInfinity(m) ? m : 1f;
        }

        /// <summary>把「已含元素 / 精英 / 首领加成」的伤害折算成状态强度：先钳到最大生命 × 0.5，再除掉每一跳会乘回的倍率</summary>
        public static float StatusPowerFromDealt(Damageable t, Element e, float dealt)
        {
            if (!t) return 0;
            float p = Mathf.Min(Mathf.Max(0, dealt), t.maxHealth * 0.5f) / DotStatMultiplier(t, e);
            return float.IsNaN(p) || float.IsInfinity(p) ? 0 : p;
        }

        /// <summary>状态强度（不含加成）对应的反应强度：乘回属性倍率</summary>
        public static float ReactionPowerFromStatus(Damageable t, Element e, float power)
        {
            float p = power * DotStatMultiplier(t, e);
            return float.IsNaN(p) || float.IsInfinity(p) ? 0 : Mathf.Max(0, p);
        }

        /// <summary>某元素打在某层上的最终倍率：元素 × 层（<see cref="DamageTable"/>）× 玩家「对护盾 / 护甲伤害」</summary>
        public static float LayerMultiplier(Element e, DamageLayer layer)
        {
            float m = DamageTable.LayerMult(e, layer);
            var s = Combat.playerStats;
            if (s == null) return m;
            if (layer == DamageLayer.Shield) m *= s.Mult(Stat.ShieldDamagePct);
            else if (layer == DamageLayer.Armor) m *= s.Mult(Stat.ArmorDamagePct);
            return m;
        }

        /// <summary>元素 → 专属伤害属性</summary>
        public static Stat ElementStat(Element e) => e switch
        {
            Element.Fire => Stat.FireDamagePct,
            Element.Shock => Stat.ShockDamagePct,
            _ => Stat.CorrodeDamagePct,
        };
    }
}
