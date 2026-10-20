namespace Spiritfire.Game
{
    /// <summary>
    /// 光束（雷弧发射器）：按住持续放电，每秒 fireRate 跳，每跳伤害一次、耗 1 点能量（同 TS updateBeam）。
    /// 节奏走共用冷却（补发 ≤ 4），所以连点也快不过射速；刚按下时冷却已到就立即打出第一跳。
    /// 光束的绘制、持续音由控制器按每跳刷新（<see cref="BeamLine"/>）。
    /// </summary>
    public sealed class BeamMode : FireModeBase
    {
        bool on;

        public BeamMode(WeaponDef def) : base(def) { }

        public override string Id => "beam";
        public override bool Firing => on;

        public override void Tick(in FireInput input, IFireHost host)
        {
            on = input.down && input.CanShoot && host.HasAmmo;
            if (on) Repeat(in input, host);
        }

        public override void Cancel() => on = false;
    }
}
