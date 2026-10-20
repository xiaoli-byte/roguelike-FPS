using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「鼎沸」（TS lg_boil）：任何武器。数值 = 每层 +6%。
    /// 生效：本武器每引发一次元素反应（反应执行时）叠一层，最多 8 层；距上次叠层超过 4 s 时从 0 重新叠。
    /// 层数生效期间（距上次叠层 ≤ 4 s），本武器的武器伤害与本武器引发的反应伤害 × (1 + 层数 × 值)（输出修饰）。
    /// </summary>
    [Defs(1090)]
    public sealed class Legendary_Boil : LegendaryDef
    {
        public const string Id = "lg_boil";
        public const int MaxStacks = 8;
        /// <summary>多久没再引发反应就清空</summary>
        public const float Window = 4f;

        public Legendary_Boil() : base(Id, "鼎沸") { }

        public override float Value(WeaponDef weapon) => 0.06f;

        public override string Text(WeaponDef weapon, float v) =>
            $"本武器每引发一次元素反应，武器与反应伤害 +{AffixText.Pct(v)}（最多 {MaxStacks} 层，4 秒未触发则清空）";

        /// <summary>当前倍率：窗口内 1 + 层数 × 值，否则 1</summary>
        public static float Mult(WeaponRuntime rt, float value, float now) => rt != null && now - rt.boilTime <= Window ? 1 + rt.boil * value : 1;

        public override IAffixEffect Effect => effect;

        static readonly BoilEffect effect = new();

        sealed class BoilEffect : AffixEffect
        {
            public override void OnReaction(in AffixHook h, in ReactionEvent e)
            {
                var rt = h.Runtime;
                rt.boil = Mathf.Min(MaxStacks, (h.now - rt.boilTime > Window ? 0 : rt.boil) + 1);
                rt.boilTime = h.now;
            }

            public override float Modifier(in AffixHook h, in HitContext c) =>
                h.value > 0 && (AffixEffects.IsWeaponHit(in c.info) || DamageCalc.IsReaction(c.info)) ? Mult(h.Runtime, h.value, h.now) : 1;
        }
    }
}
