using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旋风机炮的持握与换弹（W4，TS WeaponHandling.minigun）：弹箱：左侧弹箱向下卸掉，左手托上新箱；枪重，晃动慢、落地沉。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(90)]
    public sealed class HandlingProfile_Minigun : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("minigun", LoadingAction.AmmoBox, ReloadStyle.Box);
            p.weight = 1.6f;
            p.swayScale = 0.8f;
            p.bobScale = 1.15f;
            yield return p;
        }
    }
}
