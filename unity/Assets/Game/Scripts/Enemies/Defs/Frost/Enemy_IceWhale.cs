using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰鲸（TS ice_whale）：炮兵。喷气孔胀亮 1 s 后喷出 5 根冰柱（精英 7 根），落点长出挡路的冰棱阵 5 s；贴近 5.5 m 时昂身拍击 + 冰冲击波。
    /// 弱点 = 头顶喷气孔（blowhole 骨）。身长约 5.2 m：命中用布娃娃胶囊（头、胸、臀、尾干、前鳍），免疫击退。
    /// 导航仍用唯一的 Humanoid 代理类型（半径 0.5 烘焙），身长靠头尾探测盒避墙，见 <see cref="IceWhaleAI"/>
    /// </summary>
    [Defs(295)]
    public sealed class Enemy_IceWhale : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "ice_whale", prefab = "SK_Enemy_IceWhale", name = "冰鲸", scale = 1.1f, hp = 340, speed = 1.7f, damage = 22,
                knockbackResist = 1f, weakBone = "blowhole", weakRadius = 0.28f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(IceWhaleAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Artillery, groundOnly = true,
                coins = new Vector2Int(4, 7), essence = 2, color = Hex.Rgb(0x7fd8ff),
                radius = 1.05f, height = 2.0f, weakHeight = 2.2f,
            };
        }
    }
}
