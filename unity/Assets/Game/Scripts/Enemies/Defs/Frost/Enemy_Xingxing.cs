using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>雪狌狌（TS xingxing，第二章群怪·昆仑）：四足狂奔、跳砸冰环、攀上高台、够不着就抛冰块；弱点是额头冰晶（判定球罩住整张脸）</summary>
    [Defs(210)]
    public sealed class Enemy_Xingxing : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "xingxing", prefab = "SK_Enemy_SnowXingxing", name = "雪狌狌", scale = 1.3f, hp = 55, speed = 6.5f, damage = 14,
                knockbackResist = 0, weakBone = "head", weakRadius = 0.2f, ai = typeof(XingxingAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Assault, groundOnly = true,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xbfe6ff),
                radius = 0.36f, height = 1.1f, weakHeight = 1.03f,
            };
        }
    }
}
