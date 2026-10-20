namespace Spiritfire.Game
{
    /// <summary>
    /// 半自动（左轮、霰弹、榴弹、雷蛊…）：扣一下打一发，冷却 = 1 / 射速（重置，不累加，同 TS 与改造前）。
    /// 「扣一下」= 开火缓冲里或按住但还没打出（见 <see cref="TriggerState"/>）。
    /// </summary>
    public sealed class SemiMode : FireModeBase
    {
        public SemiMode(WeaponDef def) : base(def) { }

        public override string Id => "semi";

        public override void Tick(in FireInput input, IFireHost host)
        {
            if (!input.pulled || !input.CanShoot || !host.HasAmmo || host.Cooldown > 0) return;
            host.ConsumeTrigger();
            host.Shoot(in ShotMods.None);
            host.Cooldown = Interval(input.rate);
        }
    }
}
