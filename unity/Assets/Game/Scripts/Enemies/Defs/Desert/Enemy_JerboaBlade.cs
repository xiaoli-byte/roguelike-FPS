using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 跳鼠刀兵（TS jerboa_blade，第一章群怪）：3–5 只成群，扑斩 + 交叉斩，弱点是两耳之间的铜铃。
    /// [Defs(order)]：第一章 100 起（按旧名册顺序），第二章 200 起，第三章 300 起。
    /// </summary>
    [Defs(100)]
    public sealed class Enemy_JerboaBlade : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "jerboa_blade", prefab = "SK_Enemy_JerboaBlade", name = "跳鼠刀兵", scale = 1.3f, hp = 42, speed = 7, damage = 9,
                weakBone = "bell", weakRadius = 0.17f, ai = typeof(JerboaBladeAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xffb860),
                radius = 0.34f, height = 1.1f, weakHeight = 0.92f,
            };
        }
    }
}
