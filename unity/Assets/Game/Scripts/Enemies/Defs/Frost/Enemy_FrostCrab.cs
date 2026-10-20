using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>玄冰巨蟹（TS frost_crab，第二章坦克·北冥）：巨钳竖在脸前当墙、横着走，夹击甩人、横扫冲击环，血量低于 35% 巨钳碎裂；弱点是背后的鳃缝</summary>
    [Defs(230)]
    public sealed class Enemy_FrostCrab : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "frost_crab", prefab = "SK_Enemy_FrostCrab", name = "玄冰巨蟹", scale = 1.5f, hp = 620, armor = 200, speed = 2.4f, damage = 40,
                knockbackResist = 1f, weakBone = "vent", weakRadius = 0.36f, ai = typeof(FrostCrabAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true,
                coins = new Vector2Int(8, 12), essence = 3, color = Hex.Rgb(0x5fe8e0),
                radius = 1.0f, height = 1.6f, weakHeight = 1.0f,
            };
        }
    }
}
