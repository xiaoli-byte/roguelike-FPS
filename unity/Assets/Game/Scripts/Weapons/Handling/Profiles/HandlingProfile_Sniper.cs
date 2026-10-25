using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹰隼狙击的持握与换弹（W4，TS WeaponHandling.sniper）：弹匣：收尾左手伸到右侧拉枪栓。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(50)]
    public sealed class HandlingProfile_Sniper : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("sniper", LoadingAction.Magazine, ReloadStyle.Magazine);
            p.weight = 1.25f;
            p.swayScale = 0.85f;
            p.bobScale = 0.85f;
            yield return p;
        }
    }
}
