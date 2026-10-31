using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 帝江（网页 dijiang，第四章近战·自爆）：《西山经》天山「浑敦无面目，是识歌舞」。一边转圈一边蹦过来，鼓点越来越快，能跃过矮掩体；
    /// 贴身胀成球雷自爆；被打死也炸（爆囊），6 m 内的帝江一个接一个引爆。弱点 = 四翼根部最亮处。不硬直（太轻）。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(460)]
    public sealed class Enemy_Dijiang : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "dijiang", prefab = "SK_Enemy_Dijiang", name = "帝江", scale = 1.2f, hp = 50, speed = 8f, damage = 22,
                knockbackResist = 0, weakBone = "core", weakRadius = 0.22f, ai = typeof(DijiangAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Assault, groundOnly = true, element = Element.Shock,
                poise = float.PositiveInfinity, staggerSeconds = 0, hitch = 0.12f,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xc0402a),
                affixExclusions = new[] { "volatile" },
                radius = 0.45f, height = 1f, weakHeight = 0.6f,
            };
        }
    }
}
