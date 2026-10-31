using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 穷奇（网页 qiongqi，第四章游猎·精英）：《海内北经》「其状如虎，有翼」、《西山经》「猬毛」，四凶之一。每张图一只，沿路线游猎、雷暴时主动来找；
    /// 先上脊再滑翔扑杀，滑翔中打翼根让它坠地；吞雷后带电。名册直接是精英级：生命按精英 ×2.6 折算（1100 / 2.6），体型按精英 ×1.25 折算（1.25 / 1.25）。
    /// 弱点 = 背上的猬毛雷冠（头 ×1.6、翼根只在滑翔 / 旋斩时露出来）。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(470)]
    public sealed class Enemy_Qiongqi : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "qiongqi", prefab = "SK_Enemy_Qiongqi", name = "穷奇", scale = 1f, hp = 423, speed = 5.5f, damage = 22, rank = Rank.Elite,
                knockbackResist = 0.5f, weakBone = "crown", weakRadius = 0.3f, ai = typeof(QiongqiAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Flank, groundOnly = true, element = Element.Shock,
                poise = 150, staggerSeconds = 0.7f,
                coins = new Vector2Int(18, 24), essence = 5, color = Hex.Rgb(0xff4fd8),
                radius = 0.9f, height = 2f, weakHeight = 1.5f,
            };
        }
    }
}
