using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三叠点射枪的持握与换弹（W4，TS WeaponHandling.burst）：无托弹匣：弹匣在握把后面，左手绕到枪托下面换匣。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(30)]
    public sealed class HandlingProfile_Burst : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("burst", LoadingAction.Magazine, ReloadStyle.Magazine);
            p.weight = 1.05f;
            yield return p;
        }
    }
}
