using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 连鼓灵（网页 liangu，第四章辅助）：夔鼓的碎片——六面鼓绕雷心转、骨槌依次敲鼓，给同伴加静电护盾（红鼓加速）；
    /// 鼓一面面打碎，最后雷心掉到地上。没有骨架：雷心 SM_EnemyPart_LianguCore + 6 面鼓 + 骨槌由 LianguAI 组装。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(450)]
    public sealed class Enemy_Liangu : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "liangu", prefab = "SM_EnemyPart_LianguCore", name = "连鼓灵", scale = 1f, hp = 220, speed = 4f, damage = 10,
                knockbackResist = 0.6f, weakBone = null, weakRadius = 0.3f, ai = typeof(LianguAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Support, flying = true, element = Element.Shock,
                poise = 80, staggerSeconds = 0.5f,
                coins = new Vector2Int(4, 6), essence = 2, color = Hex.Rgb(0xc79bff),
                affixExclusions = new[] { "shielded" },
                radius = 1.2f, height = 1f, weakHeight = 0.5f,
            };
        }
    }
}
