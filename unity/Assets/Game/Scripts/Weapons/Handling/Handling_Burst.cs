using System.Collections.Generic;
using static Spiritfire.Game.WeaponSight;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三叠点射枪的瞄具（WC1）：筒式瞄具（TS buildBurst 的 sight 分组）——长 0.14 的镜筒、物镜端加粗的镜圈、
    /// 前缘一圈稀有度色发光环、镜座，以及筒内前端的准心点。筒轴在枪模 y 0.132，开镜 viewAim.y = −0.132 让视线从筒中间穿过。
    /// 换弹手势（TS WeaponHandling.burst 的 load / finish）留给 W4；握持已在 <see cref="Weapon_Burst"/>。
    /// </summary>
    [Defs(30)]
    public sealed class Handling_Burst : IDefSource<WeaponSight>
    {
        public IEnumerable<WeaponSight> Create()
        {
            yield return new WeaponSight
            {
                weaponId = "burst", kind = SightKind.Tube, frameColor = Hex.Rgb(0x1b1f2a),
                parts = new[]
                {
                    Tube(SightPaint.Frame, 0.02f, 0.14f, 0, 0.132f, -0.06f),
                    Tube(SightPaint.Frame, 0.024f, 0.02f, 0, 0.132f, -0.13f),
                    Tube(SightPaint.Rarity, 0.0215f, 0.006f, 0, 0.132f, -0.141f),
                    Box(SightPaint.Frame, 0.012f, 0.018f, 0.03f, 0, 0.113f, -0.06f),
                    Box(SightPaint.Reticle, 0.003f, 0.003f, 0.002f, 0, 0.132f, -0.128f),
                },
            };
        }
    }
}
