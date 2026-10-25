using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 雷弧发射器的持握与换弹（W4，TS WeaponHandling.beam）：顶置能量罐：罐向上抽出（左手反掌握罐），换新罐插回。
    /// 握点 / 送弹口 / 收尾点是枪模 Prefab 的挂点（W3），见 <see cref="HandlingProfile"/>。
    /// </summary>
    [Defs(80)]
    public sealed class HandlingProfile_Beam : IDefSource<HandlingProfile>
    {
        public IEnumerable<HandlingProfile> Create()
        {
            var p = HandlingProfile.Make("beam", LoadingAction.CellTop, ReloadStyle.Cell);
            p.weight = 1.1f;
            yield return p;
        }
    }
}
