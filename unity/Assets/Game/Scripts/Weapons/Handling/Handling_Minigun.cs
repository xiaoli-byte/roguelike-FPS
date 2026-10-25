using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旋风机炮的转管（WC2）：TS buildMinigun 的 spinner 分组（白模关节 j_4，W3 导出时改名 spinner；j_0 → muzzle、j_8 → mag），
    /// 预热 / 开火时按 spin × 42 rad/s 绕枪管轴转（<see cref="BarrelSpinner"/>）。
    /// 弹箱换弹手势（TS WeaponHandling.minigun 的 ammoBox load / finish）留给 W4；握持已在 <see cref="Weapon_Minigun"/>。
    /// </summary>
    [Defs(90)]
    public sealed class Handling_Minigun : IDefSource<WeaponSpinner>
    {
        public IEnumerable<WeaponSpinner> Create()
        {
            yield return new WeaponSpinner { weaponId = "minigun", bone = "spinner", rate = 42f };
        }
    }
}
