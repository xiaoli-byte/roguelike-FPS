using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 预热（旋风机炮，同 TS updateMinigun）：按住先转管，spinup ÷ 射速倍率 秒转满后才按射速连发；松手 0.9 s 转停。
    /// 转满开火期间移速 −def.moveSlow（TS −2，见 <see cref="MoveSlow"/>；控制器登记成属性来源 weapon:minigun）。
    /// 冲刺中不开火，但转速保持（不用重新预热）。
    /// </summary>
    public sealed class SpinupMode : FireModeBase
    {
        float spin;
        bool spinning, firing;

        public SpinupMode(WeaponDef def) : base(def) { }

        public override string Id => "spinup";
        public override bool Firing => firing;
        public override float Spin => spin;
        public override float MoveSlow => firing ? Mathf.Max(0, def.moveSlow) : 0;
        /// <summary>转满所需秒数（未计射速倍率）</summary>
        public float SpinupTime => Mathf.Max(0.05f, def.spinup);

        public override void Tick(in FireInput input, IFireHost host)
        {
            bool want = input.down && input.ready;
            if (want)
            {
                if (!spinning)
                {
                    spinning = true;
                    host.Cue(FireCue.SpinUp);
                }
                spin = Mathf.Min(1, spin + input.dt * (input.rateMult > 0 ? input.rateMult : 1) / SpinupTime);
            }
            else
            {
                spinning = false;
                spin = Mathf.Max(0, spin - input.dt / WeaponTiming.SpinDown);
            }
            firing = want && !input.blocked && spin >= 1 && host.HasAmmo;
            if (firing) Repeat(in input, host);
        }

        public override void Cancel() => firing = false;

        public override void Stop(IFireHost host, bool flush)
        {
            spin = 0;
            spinning = false;
            firing = false;
        }
    }
}
