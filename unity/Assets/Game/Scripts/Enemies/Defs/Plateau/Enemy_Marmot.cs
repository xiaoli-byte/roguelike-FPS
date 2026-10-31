using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 啸獭（网页 marmot，第四章群怪·哨兵）：高原旱獭成窝，哨兵一尖叫 60 m 内的兽群都醒；三只以上挤在一起连成电网（网里的都带电）。
    /// 弱点 = 头（尾尖静电球是发光点缀）；一窝 5–8 只，单只很脆。美术站立高 0.75 m，游戏里放大 1.3 倍。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(400)]
    public sealed class Enemy_Marmot : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "marmot", prefab = "SK_Enemy_Marmot", name = "啸獭", scale = 1.3f, hp = 40, speed = 6.5f, damage = 6,
                knockbackResist = 0, weakBone = "head", weakRadius = 0.16f, ai = typeof(MarmotAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Assault, groundOnly = true, element = Element.Shock,
                poise = 18, staggerSeconds = 0.4f, hitch = 0.12f,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xff4fd8),
                radius = 0.26f, height = 0.75f, weakHeight = 0.55f,
            };
        }
    }
}
