using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蜂群飞弹的持握与换弹（W4，TS WeaponHandling.swarm）：管式：枪口上抬，飞弹从后面塞进发射管（塞进去就隐藏）。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(100)]
    public sealed class HandlingProfile_Swarm : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("swarm", LoadingAction.Tube, ReloadStyle.Tube);
            p.weight = 1.35f;
            yield return p;
        }
    }
}
