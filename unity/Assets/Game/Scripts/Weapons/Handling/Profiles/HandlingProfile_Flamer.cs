using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 朱雀吐息的持握与换弹（W4，TS WeaponHandling.flamer）：燃料罐：枪身下方的罐向下卸出，左手托上新罐。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(110)]
    public sealed class HandlingProfile_Flamer : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("flamer", LoadingAction.CellBottom, ReloadStyle.Cell);
            p.weight = 1.3f;
            yield return p;
        }
    }
}
