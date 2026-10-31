using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蛮蛮（网页 manman，第四章远程·扫线）：《西山经》崇吾山「一翼一目，相得乃飞」。成对出现，两只之间一道电弧，盘旋后低空平行掠过横扫；
    /// 打死一只，另一只也飞不起来、落地追啄。弱点 = 独眼。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(440)]
    public sealed class Enemy_Manman : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "manman", prefab = "SK_Enemy_Manman", name = "蛮蛮", scale = 1.4f, hp = 70, speed = 9f, damage = 10,
                knockbackResist = 0.2f, weakBone = "eye", weakRadius = 0.15f, ai = typeof(ManmanAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Flank, flying = true, element = Element.Shock,
                poise = 25, staggerSeconds = 0.5f,
                coins = new Vector2Int(2, 3), essence = 1, color = Hex.Rgb(0xe9e4da),
                affixExclusions = new[] { "volatile" },
                radius = 0.35f, height = 0.9f, weakHeight = 0.62f,
            };
        }
    }
}
