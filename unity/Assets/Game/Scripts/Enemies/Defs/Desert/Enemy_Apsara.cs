using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>邪飞天（TS apsara）：辅助，悬浮琵琶赐福友军，弱点是琵琶的琴轸。TS 标为飞行（flying 目前只是标记）</summary>
    [Defs(140)]
    public sealed class Enemy_Apsara : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "apsara", prefab = "SK_Enemy_Apsara", name = "邪飞天", scale = 1.3f, hp = 170, speed = 4.2f, damage = 0,
                knockbackResist = 0.3f, weakBone = "socket_pipa", weakRadius = 0.3f, ai = typeof(ApsaraAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Support, flying = true,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0xe0b060),
                radius = 0.42f, height = 1.9f, weakHeight = 1.35f,
            };
        }
    }
}
