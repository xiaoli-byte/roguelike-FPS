using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹰隼狙击的瞄具（WC1）：瞄准镜。镜身在美术网格里（TS buildSniper 的镜筒不在 PROCEDURAL_PARTS），所以没有占位零件；
    /// 开镜（视角层 &lt; −30°）时由 <see cref="ScopeOverlay"/> 画镜内遮罩、<see cref="SightPart"/> 隐藏枪模，控制器把散布归零。
    /// 换弹手势（TS WeaponHandling.sniper 的 load / finish）留给 W4；握持已在 <see cref="Weapon_Sniper"/>。
    /// </summary>
    [Defs(50)]
    public sealed class Handling_Sniper : IDefSource<WeaponSight>
    {
        public IEnumerable<WeaponSight> Create()
        {
            yield return new WeaponSight { weaponId = "sniper", kind = SightKind.Scope, frameColor = Hex.Rgb(0x1d211c) };
        }
    }
}
