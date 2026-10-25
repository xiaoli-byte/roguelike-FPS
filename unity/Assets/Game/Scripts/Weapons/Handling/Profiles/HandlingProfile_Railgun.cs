using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 贯虹灵炮的持握与换弹（W4，TS WeaponHandling.railgun）：电容：顶置电容向上抽出换新。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(150)]
    public sealed class HandlingProfile_Railgun : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("railgun", LoadingAction.CellTop, ReloadStyle.Cell);
            p.weight = 1.3f;
            p.swayScale = 0.9f;
            yield return p;
        }
    }
}
