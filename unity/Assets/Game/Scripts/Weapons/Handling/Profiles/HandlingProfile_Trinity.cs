using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三才转轮的持握与换弹（W4，TS WeaponHandling.trinity）：快装器：同赤铜左轮；转轮对准下一发由 TrinityCycle 负责（这里不转）。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(140)]
    public sealed class HandlingProfile_Trinity : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("trinity", LoadingAction.Speedloader, ReloadStyle.Cylinder);
            p.weight = 0.7f;
            yield return p;
        }
    }
}
