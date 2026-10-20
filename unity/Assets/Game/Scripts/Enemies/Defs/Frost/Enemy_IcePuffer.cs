using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>冰河豚（TS ice_puffer，第二章自爆飞行怪·北冥）：飘近、俯冲、鼓气 0.8 s 炸开并留下减速冻雾；弱点是整个身体（鼓气时跟着变大）</summary>
    [Defs(250)]
    public sealed class Enemy_IcePuffer : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "ice_puffer", prefab = "SK_Enemy_IcePuffer", name = "冰河豚", scale = 1f, hp = 34, speed = 4.5f, damage = 24,
                knockbackResist = 0.1f, weakBone = "body", weakRadius = 0.34f, ai = typeof(IcePufferAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, flying = true,
                coins = new Vector2Int(1, 3), essence = 1, color = Hex.Rgb(0x7fe6ff),
                radius = 0.36f, height = 1.0f, weakHeight = 0.47f,
            };
        }
    }
}
