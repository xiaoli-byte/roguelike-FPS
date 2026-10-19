using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>火浣鼠（TS fire_rat）：滚成火球冲进来、死亡自爆，弱点罩住全身</summary>
    [Defs(150)]
    public sealed class Enemy_FireRat : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "fire_rat", prefab = "SK_Enemy_FireRat", name = "火浣鼠", scale = 1.6f, hp = 26, speed = 6, damage = 26,
                weakBone = "spine", weakRadius = 0.3f, ai = typeof(FireRatAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true, element = Element.Fire,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xff7a2a),
                radius = 0.26f, height = 0.46f, weakHeight = 0.24f,
            };
        }
    }
}
