namespace Spiritfire.Game
{
    /// <summary>
    /// 按武器定义选开火模式：projectile.count &gt; 1 的是齐射（TS 里齐射不是一种 FireMode，而是 semi 扣扳机 + 弹体序列，这里独立成一个模式），
    /// 其余按 <see cref="WeaponDef.mode"/>。碎刃之类由 <see cref="IWeaponTakeover"/> 接管，不走这里的模式（仍会建一个 Semi 占位）。
    /// </summary>
    public static class FireModes
    {
        public static IFireMode Create(WeaponDef def)
        {
            if (def.projectile != null && def.projectile.count > 1) return new VolleyMode(def);
            return def.mode switch
            {
                FireMode.Auto => new AutoMode(def),
                FireMode.Beam => new BeamMode(def),
                FireMode.Burst => new BurstMode(def),
                FireMode.Spinup => new SpinupMode(def),
                FireMode.Charge => new ChargeMode(def),
                _ => new SemiMode(def),
            };
        }

        /// <summary>按住就持续开火的模式（打空时按住扳机也算请求换弹 / 空仓音）</summary>
        public static bool IsHold(IFireMode m) => m is AutoMode || m is BeamMode || m is SpinupMode;
    }
}
