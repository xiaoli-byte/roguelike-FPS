using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蚀蛊灯的持握与换弹（W4，TS WeaponHandling.lantern）：灯芯：左手从灯笼里抽出灯芯换新；灯笼本体轻，晃得多一点。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(160)]
    public sealed class HandlingProfile_Lantern : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("lantern", LoadingAction.Wick, ReloadStyle.Cell);
            p.weight = 0.9f;
            p.swayScale = 1.2f;
            yield return p;
        }
    }
}
