using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 獓狠（网页 aoyin，第四章坦克）：《西山经》三危山「白身四角，其豪如披蓑」。蓑毛 7 片挡八成伤害、火能烧掉；领着雷牦群直线踩踏 40 m，
    /// 每冲一次角间雷球攒一份电，攒满人立砸地（前摇里打雷球反制）。弱点 = 四角之间的雷球（正面）。不吃击退。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(420)]
    public sealed class Enemy_Aoyin : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "aoyin", prefab = "SK_Enemy_Aoyin", name = "獓狠", scale = 1f, hp = 900, speed = 3.5f, damage = 24,
                knockbackResist = 1, weakBone = "orb", weakRadius = 0.45f, ai = typeof(AoyinAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true, charger = true, element = Element.Shock,
                poise = 220, staggerSeconds = 0.8f,
                coins = new Vector2Int(10, 14), essence = 3, color = Hex.Rgb(0xe8dcc8),
                affixExclusions = new[] { "shielded" },
                radius = 0.9f, height = 3f, weakHeight = 2.3f,
            };
        }
    }
}
