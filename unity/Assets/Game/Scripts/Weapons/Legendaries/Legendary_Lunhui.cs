namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「轮回」（TS lg_lunhui）：不出现在元素轮转武器上。数值 = 间隔 0.6 s。
    /// 生效：本武器直接命中仍存活的敌人时，每隔值秒依次附加灼烧 → 雷殛 → 蚀化（下一帧附着，强度同副元素；轮转进度跟着枪走）；
    /// 本武器引发的「归墟」伤害 × 1.5（输出修饰）。
    /// </summary>
    [Defs(1070)]
    public sealed class Legendary_Lunhui : LegendaryDef
    {
        public const string Id = "lg_lunhui";
        /// <summary>本武器引发的归墟的伤害倍率</summary>
        public const float AbyssMult = 1.5f;
        /// <summary>附着顺序</summary>
        public static readonly Element[] Order = { Element.Fire, Element.Shock, Element.Corrode };

        public Legendary_Lunhui() : base(Id, "轮回") { }

        public override bool Allow(in AffixContext c) => c.def.cycle == null || c.def.cycle.Length == 0;

        public override float Value(WeaponDef weapon) => 0.6f;

        public override string Text(WeaponDef weapon, float v) =>
            $"命中时依次附加灼烧、雷殛、蚀化（每 {AffixText.Num(v)} 秒一次）；本武器引发的「归墟」伤害 +50%";

        public override IAffixEffect Effect => effect;

        static readonly LunhuiEffect effect = new();

        sealed class LunhuiEffect : AffixEffect
        {
            public override void OnHit(in AffixHook h, in HitEvent e)
            {
                if (h.effects == null || !AffixEffects.Live(in e)) return;
                var rt = h.Runtime;
                if (h.now < rt.lunhuiAt) return;
                rt.lunhuiAt = h.now + h.value;
                var el = Order[rt.lunhuiIdx++ % Order.Length];
                h.effects.QueueSub(in h, e.enemy, el, e.result.total);
            }

            public override float Modifier(in AffixHook h, in HitContext c) =>
                DamageCalc.IsReaction(c.info) && c.info.Has(DamageTag.Abyss) ? AbyssMult : 1;
        }
    }
}
