using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜂鸣冲锋枪的持握与换弹（W4，TS WeaponHandling.smg）：弹匣：枪身右倾，左手拔下弹匣、换新匣拍进去，最后拉一下机柄。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(10)]
    public sealed class HandlingProfile_Smg : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("smg", LoadingAction.Magazine, ReloadStyle.Magazine);
            p.weight = 0.85f;
            p.swayScale = 1.1f;
            yield return p;
        }
    }
}
