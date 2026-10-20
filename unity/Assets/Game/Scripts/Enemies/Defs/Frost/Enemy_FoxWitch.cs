using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 九尾狐巫（TS fox_witch）：辅助。躲在同伴身后立冰壁（<see cref="FoxIceWall"/>，可打碎、挡视线）、给同伴结霜甲（承伤 ×0.7）、
    /// 照妖镜冻结光束；铜镜（弱点，socket_mirror 挂点）累计吃到她最大生命 30% 就碎，此后沉默、改放追踪狐火，弱点挪到头上。
    /// 冰壁不是名册敌人（TS 的 fox_ice_wall 只由狐巫生成）：Unity 里是独立的可破坏掩体，不登记 EnemyDef
    /// </summary>
    [Defs(270)]
    public sealed class Enemy_FoxWitch : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "fox_witch", prefab = "SK_Enemy_FoxWitch", name = "九尾狐巫", scale = 1.15f, hp = 130, speed = 4.6f, damage = 12,
                knockbackResist = 0.25f, weakBone = "socket_mirror", weakRadius = 0.27f,
                ai = typeof(FoxWitchAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Support, groundOnly = true,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0x8fdcff),
                radius = 0.4f, height = 1.8f, weakHeight = 1.1f,
            };
        }
    }
}
