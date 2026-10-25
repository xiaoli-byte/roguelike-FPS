using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 焚城榴弹的持握与换弹（W4，TS WeaponHandling.launcher）：转鼓：枪口上抬，鼓向左甩出自转，左手往后面的鼓里塞榴弹；每发转 1/4 圈。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(60)]
    public sealed class HandlingProfile_Launcher : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("launcher", LoadingAction.Tube, ReloadStyle.Tube);
            p.cylinderSteps = 4;
            p.weight = 1.3f;
            yield return p;
        }
    }
}
