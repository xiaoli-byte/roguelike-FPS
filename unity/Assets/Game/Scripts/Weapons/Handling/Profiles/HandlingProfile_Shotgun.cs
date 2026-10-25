using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎岩霰弹的持握与换弹（W4，TS WeaponHandling.shotgun）：逐发装填：枪身左倾，左手从弹药袋拿弹压进装填口；开枪后与装填结束各推一次泵（行程 7.5 cm）。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(40)]
    public sealed class HandlingProfile_Shotgun : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("shotgun", LoadingAction.Shell, ReloadStyle.Shell);
            p.pumpStroke = 0.075f;
            p.weight = 1.15f;
            yield return p;
        }
    }
}
