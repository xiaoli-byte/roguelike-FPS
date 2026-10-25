using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 青冥雷蛊的持握与换弹（W4，TS WeaponHandling.stormpod）：蛊罐转鼓：鼓向左甩出自转，左手把蛊罐按进鼓里；每发转 1/5 圈。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(120)]
    public sealed class HandlingProfile_Stormpod : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("stormpod", LoadingAction.Drum, ReloadStyle.Cylinder);
            p.cylinderSteps = 5;
            p.weight = 1.2f;
            yield return p;
        }
    }
}
