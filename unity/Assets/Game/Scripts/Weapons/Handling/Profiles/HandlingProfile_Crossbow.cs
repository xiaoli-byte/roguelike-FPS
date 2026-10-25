using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 追魂连弩的持握与换弹（W4，TS WeaponHandling.crossbow）：顶置箭匣：箭匣向上提起，左手换一匣再压回去；弓弦与弩箭由 CrossbowString 摆。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(70)]
    public sealed class HandlingProfile_Crossbow : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("crossbow", LoadingAction.BoltClip, ReloadStyle.Magazine);
            p.weight = 1.05f;
            yield return p;
        }
    }
}
