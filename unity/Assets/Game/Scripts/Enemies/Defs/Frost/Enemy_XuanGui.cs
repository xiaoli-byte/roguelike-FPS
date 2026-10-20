using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>冰甲旋龟（TS xuangui，第二章坦克）：正面冰壳格挡、缩壳旋转撞墙反弹、过热翻倒露出散热孔；平时弱点是身后的蛇头</summary>
    [Defs(220)]
    public sealed class Enemy_XuanGui : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "xuangui", prefab = "SK_Enemy_XuanGui", name = "冰甲旋龟", scale = 1.5f, hp = 560, armor = 220, speed = 1.8f, damage = 36,
                knockbackResist = 1f, weakBone = "snake", weakRadius = 0.32f, ai = typeof(XuanGuiAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true, charger = true,
                coins = new Vector2Int(8, 12), essence = 3, color = Hex.Rgb(0x8fd8ff),
                radius = 1.0f, height = 1.2f, weakHeight = 1.5f,
            };
        }
    }
}
