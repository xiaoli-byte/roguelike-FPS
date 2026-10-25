using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 赤铜左轮的持握与换弹（W4，TS WeaponHandling.revolver）：快装器：转轮向左甩出（−0.045 m）并自转，左手托着快装器送进转轮；每发转轮转 1/8 圈。双手包握（没有前握）。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(0)]
    public sealed class HandlingProfile_Revolver : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("revolver", LoadingAction.Speedloader, ReloadStyle.Cylinder);
            p.cylinderSteps = 8;
            p.weight = 0.7f;
            yield return p;
        }
    }
}
