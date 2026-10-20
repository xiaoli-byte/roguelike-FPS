using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蓄力（贯虹灵炮，同 TS updateCharge）：按住蓄力（chargeTime ÷ 射速倍率 秒蓄满），松手发射。
    /// 伤害倍率 = chargeMinMult + (1 − chargeMinMult) × t²（0.2 + 0.8·t²）；蓄满（t = 1）额外穿透 chargeFullPierce、命中引爆元素状态（chargeDetonate）；
    /// 反馈强度 0.4 + 0.6·t。松手后冷却 1 / 射速。
    /// 被换弹 / 切枪 / 打空打断，或没有输入权时（暂停、弹窗）松开：作废，不开火。冲刺不打断蓄力（Unity：冲刺照样能松手）。
    /// TestMode（<see cref="FireInput.testAuto"/>）：按住到蓄满自动松手。
    /// </summary>
    public sealed class ChargeMode : FireModeBase
    {
        float charge, coil;
        bool charging, full;

        public ChargeMode(WeaponDef def) : base(def) { }

        public override string Id => "charge";
        public override bool Firing => charging;
        public override float Charge => charging ? charge : 0;
        /// <summary>已经蓄满（满蓄提示音已响）</summary>
        public bool Full => charging && full;
        /// <summary>线圈转速：蓄力中 = 蓄力进度，松手后 0.6 s 转停</summary>
        public override float Spin => coil;
        public float ChargeTime => Mathf.Max(0.05f, def.chargeTime);

        /// <summary>按蓄力进度 t 得到的射击修饰（满蓄判定 t ≥ 1）</summary>
        public static ShotMods Shot(WeaponDef def, float t)
        {
            bool isFull = t >= 1;
            return new ShotMods
            {
                mult = WeaponTiming.ChargeMult(def.chargeMinMult, t),
                pierceBonus = isFull ? def.chargeFullPierce : 0,
                full = isFull,
                strength = 0.4f + 0.6f * Mathf.Clamp01(t),
            };
        }

        public override void Tick(in FireInput input, IFireHost host)
        {
            bool can = input.ready && host.HasAmmo && host.Cooldown <= 0;
            bool release = !input.down || (input.testAuto && charging && charge >= 1);
            if (input.down && can && !release)
            {
                if (!charging)
                {
                    charging = true;
                    charge = 0;
                    full = false;
                    host.Cue(FireCue.ChargeStart);
                }
                charge = Mathf.Min(1, charge + input.dt * (input.rateMult > 0 ? input.rateMult : 1) / ChargeTime);
                if (charge >= 1 && !full)
                {
                    full = true;
                    host.Cue(FireCue.ChargeFull);
                }
            }
            else if (charging)
            {
                if (release && can && input.inputOk)
                {
                    var shot = Shot(def, charge);
                    host.ConsumeTrigger();
                    host.Shoot(in shot);
                    host.Cooldown = Interval(input.rate);
                }
                ResetCharge();
            }
            coil = charging ? charge : Mathf.Max(0, coil - input.dt / WeaponTiming.CoilDown);
        }

        void ResetCharge()
        {
            charging = false;
            charge = 0;
            full = false;
        }

        public override void Cancel() => ResetCharge();

        public override void Stop(IFireHost host, bool flush)
        {
            ResetCharge();
            coil = 0;
        }
    }
}
