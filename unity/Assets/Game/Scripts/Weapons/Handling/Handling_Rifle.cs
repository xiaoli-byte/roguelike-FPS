using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 裂风步枪的瞄具（WC1）：红点（TS buildRifle 的 redDot(sight, 0.1, −0.03, dark, 0.08)），机匣暗色 #23252a。
    /// 开镜位置 viewAim.y = −0.1 × 0.76 正好把准心点（枪模 y 0.1 × 0.76）放在屏幕中央。
    /// 换弹手势（TS WeaponHandling.rifle 的 load / finish）留给 W4 的 HandlingProfile；握持已在 <see cref="Weapon_Rifle"/>。
    /// </summary>
    [Defs(20)]
    public sealed class Handling_Rifle : IDefSource<WeaponSight>
    {
        public IEnumerable<WeaponSight> Create()
        {
            yield return WeaponSight.RedDot("rifle", 0.1f, -0.03f, 0.08f, Hex.Rgb(0x23252a));
        }
    }
}
