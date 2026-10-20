namespace Spiritfire.Game
{
    /// <summary>
    /// 传说「天命」（TS lg_nth）：任何武器。数值 = 第 N 发：每秒射击 ≥ 8 → 6，≥ 2.5 → 5，否则 4（按定义射速，点射按每发算）。
    /// 生效：这把枪累计第 N、2N、3N… 次射击（光束每跳、齐射每轮算一次）必定暴击——开火钩子 <see cref="IAffixEffect.OnFire"/> 给本发 forceCrit，
    /// 霰弹整发、齐射整轮都暴击。碎刃（WC5–WC7 接上）按斩击段数计。
    /// </summary>
    [Defs(1000)]
    public sealed class Legendary_Nth : LegendaryDef
    {
        public const string Id = "lg_nth";

        public Legendary_Nth() : base(Id, "天命") { }

        public override float Value(WeaponDef weapon)
        {
            float sps = weapon.ShotsPerSecond();
            return sps >= 8 ? 6 : sps >= 2.5f ? 5 : 4;
        }

        public override string Text(WeaponDef weapon, float v)
        {
            int n = WeaponStatsResolver.RoundHalfUp(v);
            return weapon != null && weapon.IsBlade ? $"每第 {n} 段斩击必定暴击" : $"每第 {n} {AffixText.ShotUnit(weapon)}必定暴击";
        }

        public override IAffixEffect Effect => effect;

        static readonly NthEffect effect = new();

        sealed class NthEffect : AffixEffect
        {
            public override void OnFire(in AffixHook h, ref FireShot s)
            {
                int n = WeaponStatsResolver.RoundHalfUp(h.value);
                if (n > 0 && s.shots % n == 0) s.forceCrit = true;
            }
        }
    }
}
