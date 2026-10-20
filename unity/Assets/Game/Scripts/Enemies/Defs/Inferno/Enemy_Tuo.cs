using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火鼍（TS tuo，第三章坦克）：熔岩河里的巨鳄。潜熔游动、岸边鼓泡扑咬；背上 8 块玄武岩甲（×0.25，碎了露出熔肉 ×2），
    /// 碎够 3 块就爬回熔岩重新长甲；甩尾把人扫向熔岩；生命低于 40% 鼍鸣一次。弱点是脊背的熔岩接缝（×0.5 + 暴击）。
    /// 美术高 1.9 米、长 4.3 米，游戏里放大 1.3 倍。没有熔岩的房间当陆上坦克打。
    /// </summary>
    [Defs(311)]
    public sealed class Enemy_Tuo : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "tuo", prefab = "SK_Enemy_Tuo", name = "火鼍", scale = 1.3f, hp = 650, armor = 120, speed = 2, damage = 38,
                knockbackResist = 1, weakBone = "spine", weakRadius = 0.3f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(TuoAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true,
                coins = new Vector2Int(9, 13), essence = 3, color = Hex.Rgb(0xff5a1a),
                radius = 0.9f, height = 1.5f, weakHeight = 1.55f,
            };
        }
    }
}
