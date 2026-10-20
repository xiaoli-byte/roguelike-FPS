using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「万象」（TS lg_prism）：任何武器。数值 = 每次命中的附着几率，约每秒 1.6 次（对每种元素）：1.6 ÷ 每秒命中数，钳在 [5%, 75%]（<see cref="Chance"/>）。
    /// 生效：本武器直接命中仍存活的敌人时，灼烧 / 雷殛 / 蚀化各自独立掷骰（斩击 × meleeHitScale，封顶 75%），掷中的下一帧直接挂上：
    /// 强度 = 这一击的实际伤害折算成状态强度（命中时算好），由这次附着引发的反应威力 × 0.6。
    /// </summary>
    [Defs(1030)]
    public sealed class Legendary_Prism : LegendaryDef
    {
        public const string Id = "lg_prism";
        static readonly Element[] Elements = { Element.Fire, Element.Shock, Element.Corrode };

        public Legendary_Prism() : base(Id, "万象") { }

        /// <summary>每次命中的附着几率：1.6 ÷ max(0.1, 每秒射击 × 每发命中数)，钳在 [0.05, 0.75]（同 TS prismChance）</summary>
        public static float Chance(WeaponDef d) => Mathf.Min(0.75f, Mathf.Max(0.05f, 1.6f / Mathf.Max(0.1f, d.ShotsPerSecond() * d.HitsPerShot)));

        public override float Value(WeaponDef weapon) => Chance(weapon);

        public override string Text(WeaponDef weapon, float v) => $"命中时各有 {AffixText.Pct(v)} 几率附加灼烧、雷殛、蚀化";

        public override IAffixEffect Effect => effect;

        static readonly PrismEffect effect = new();

        sealed class PrismEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                var enemy = e.enemy;
                if (!(h.value > 0) || h.effects == null || !enemy || enemy.Dead) return;
                float chance = AffixEffects.IsSlash(in e.info) ? Mathf.Min(AffixEffects.PerHitCap, h.value * h.stats.meleeHitScale) : h.value;
                float power = -1;
                foreach (var el in Elements)
                {
                    if (h.effects.Random() >= chance) continue;
                    // 状态强度按命中元素 / 精英 / 首领倍率折算（附着时不含这些加成，每一跳再乘回）
                    if (power < 0) power = DamageCalc.StatusPowerFromDealt(enemy, e.info.element, e.result.total);
                    h.effects.QueueStatus(in h, enemy, el, power, AffixEffects.PrismReactionScale);
                }
            }
        }
    }
}
