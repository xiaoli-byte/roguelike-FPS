using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 裂风步枪的持握与换弹（W4，TS WeaponHandling.rifle）：弹匣：同冲锋枪，收尾拉左侧机柄。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(20)]
    public sealed class HandlingProfile_Rifle : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("rifle", LoadingAction.Magazine, ReloadStyle.Magazine);
            p.weight = 1f;
            yield return p;
        }
    }
}
