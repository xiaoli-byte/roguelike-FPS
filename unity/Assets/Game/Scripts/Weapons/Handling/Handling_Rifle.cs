using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 裂风步枪使用 Gunfire 1001 自带的提把机械瞄具；不生成额外红点，开镜位置由 <see cref="Weapon_Rifle"/> 对准原枪照门。
    /// </summary>
    [Defs(20)]
    public sealed class Handling_Rifle : IDefSource<WeaponSight>
    {
        public IEnumerable<WeaponSight> Create()
        {
            yield return new WeaponSight { weaponId = "rifle", kind = SightKind.None };
        }
    }
}
