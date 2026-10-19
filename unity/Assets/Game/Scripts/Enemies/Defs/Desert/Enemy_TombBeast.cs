using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>三彩镇墓兽（TS tomb_beast）：重甲冲锋，弱点是背上的龟裂</summary>
    [Defs(130)]
    public sealed class Enemy_TombBeast : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "tomb_beast", prefab = "SK_Enemy_TombBeast", name = "三彩镇墓兽", scale = 1.7f, hp = 640, armor = 160, speed = 2.2f, damage = 42,
                knockbackResist = 1f, weakBone = "crack", weakRadius = 0.42f, ai = typeof(TombBeastAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true, charger = true,
                coins = new Vector2Int(8, 12), essence = 3, color = Hex.Rgb(0xc9a25a),
                radius = 0.9f, height = 1.9f, weakHeight = 1.45f,
            };
        }
    }
}
