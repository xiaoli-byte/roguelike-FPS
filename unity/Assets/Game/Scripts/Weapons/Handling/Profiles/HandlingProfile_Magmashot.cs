using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 赤蛟霰铳的持握与换弹（W4，TS WeaponHandling.magmashot）：折开：枪管组绕铰链下折（BreakAction），左手从弹药袋拿弹塞进膛口，收尾把枪管拍回去。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(130)]
    public sealed class HandlingProfile_Magmashot : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("magmashot", LoadingAction.Breech, ReloadStyle.Shell);
            p.weight = 1.1f;
            yield return p;
        }
    }
}
