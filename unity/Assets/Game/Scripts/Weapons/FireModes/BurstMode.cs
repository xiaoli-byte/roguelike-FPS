namespace Spiritfire.Game
{
    /// <summary>
    /// 点射（三叠点射枪，同 TS updateBurst）：扣一下打 burstCount 发，轮内间隔 burstInterval ÷ 射速倍率；
    /// 轮与轮之间冷却 1 / 射速（射速 = 每秒轮数），从这一轮开始时算。
    /// 轮中被切枪 / 换弹 / 打空打断就作废剩下的；冲刺中暂停（冲刺完接着打完这一轮）。
    /// </summary>
    public sealed class BurstMode : FireModeBase
    {
        int left;
        float timer;

        public BurstMode(WeaponDef def) : base(def) { }

        public override string Id => "burst";
        public override bool Busy => left > 0;
        /// <summary>这一轮还剩几发</summary>
        public int Left => left;

        public override void Tick(in FireInput input, IFireHost host)
        {
            if (left == 0 && (input.pulled || (input.testAuto && input.down)) && input.CanShoot && host.HasAmmo && host.Cooldown <= 0)
            {
                host.ConsumeTrigger();
                left = def.burstCount < 1 ? 1 : def.burstCount;
                timer = 0;
                host.Cooldown = Interval(input.rate);
            }
            if (left <= 0) return;
            if (!input.ready)
            {
                left = 0;
                return;
            }
            if (input.blocked) return;
            timer -= input.dt;
            float step = def.burstInterval / (input.rateMult > 0 ? input.rateMult : 1);
            while (left > 0 && timer <= 0)
            {
                if (!host.HasAmmo)
                {
                    left = 0;
                    break;
                }
                host.Shoot(in ShotMods.None);
                left--;
                timer += step;
            }
        }

        public override void Cancel() => left = 0;
    }
}
