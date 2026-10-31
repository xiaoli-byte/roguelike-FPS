using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 雷牦（网页 leiyak，第四章小坦克）：复用獓狠的模型 ×0.72、毛色暗一些，没有雷球和蓑毛；跟着獓狠领群踩踏（两侧平行排开），
    /// 没有獓狠带队时自己冲；贴脸四角挑。弱点 = 头。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(421)]
    public sealed class Enemy_Leiyak : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "leiyak", prefab = "SK_Enemy_Aoyin", name = "雷牦", scale = 0.72f, hp = 260, speed = 4.5f, damage = 16,
                knockbackResist = 0.8f, weakBone = "head", weakRadius = 0.32f, ai = typeof(AoyinAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true, charger = true, element = Element.Shock,
                poise = 90, staggerSeconds = 0.6f,
                coins = new Vector2Int(4, 6), essence = 2, color = Hex.Rgb(0x9a8a7a),
                radius = 0.9f, height = 3f, weakHeight = 2.2f,
            };
        }
    }
}
