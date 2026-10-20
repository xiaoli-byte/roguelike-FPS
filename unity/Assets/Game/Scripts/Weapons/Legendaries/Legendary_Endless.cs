namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「无尽」（TS lg_endless）：不出现在碎刃上。数值 = 30%。
    /// 生效：每次射击（光束每跳、点射每发、齐射每轮）有值的几率不消耗弹药——开火钩子在扣弹之前掷（<see cref="WeaponRuntime.Random"/>）；无限弹药期间不掷。
    /// 免耗的那一发不算「弹匣最后一发」。
    /// </summary>
    [Defs(1050)]
    public sealed class Legendary_Endless : LegendaryDef
    {
        public const string Id = "lg_endless";

        public Legendary_Endless() : base(Id, "无尽") { }

        public override bool Allow(in AffixContext c) => AffixRules.GunOnly(c.def);

        public override float Value(WeaponDef weapon) => 0.3f;

        public override string Text(WeaponDef weapon, float v) => $"开火时 {AffixText.Pct(v)} 几率不消耗弹药";

        public override IAffixEffect Effect => effect;

        static readonly EndlessEffect effect = new();

        sealed class EndlessEffect : AffixEffect
        {
            public override void OnFire(in AffixHook h, ref FireShot s)
            {
                if (!s.infinite && h.value > 0 && WeaponRuntime.Random() < h.value) s.free = true;
            }
        }
    }
}
