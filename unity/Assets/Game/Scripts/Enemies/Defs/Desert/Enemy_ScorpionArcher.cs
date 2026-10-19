using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>蝎尾弩卫（TS scorpion_archer）：远程压制，弱点是尾巴弧顶的毒囊</summary>
    [Defs(110)]
    public sealed class Enemy_ScorpionArcher : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "scorpion_archer", prefab = "SK_Enemy_ScorpionArcher", name = "蝎尾弩卫", scale = 1.8f, hp = 120, speed = 3.4f, damage = 11,
                knockbackResist = 0.5f, weakBone = "sac", weakRadius = 0.26f, ai = typeof(ScorpionArcherAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Ranged, groundOnly = true,
                coins = new Vector2Int(2, 4), essence = 1, color = Hex.Rgb(0xffd27a),
                radius = 0.85f, height = 2.0f, weakHeight = 1.6f,
            };
        }
    }
}
