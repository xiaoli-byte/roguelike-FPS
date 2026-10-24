using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 沙魇（sand_wraith，Unity 新增，unity-maps-v1 第 3 节「沙魇：第一章杂兵的沙化版」，docs/unity-parity.md 3.8）：
    /// 被旱魃的日火烧成沙的跳鼠兵——借跳鼠刀兵的美术与动作，换 <see cref="EnemyVariant.Wraith"/> 的皮（沙化 + 日火裂纹），行为是自己的 <see cref="SandWraithAI"/>：
    /// 潜沙逼近 → 破沙旋斩 → 硬直。旱魃一阶段召它（<see cref="HanbaDef.wraithRoster"/>），1-x 的遭遇编排也可以直接写它（侧翼、只站地面）。
    /// 数值按跳鼠刀兵（42 / 7 / 9）往「更耐打、更慢、出手更重」挪：55 生命、5.6 移速、12 伤害，体型 1.4。
    /// </summary>
    [Defs(160)]
    public sealed class Enemy_SandWraith : IDefSource<EnemyDef>
    {
        public const string Id = "sand_wraith";

        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = Id, prefab = "SK_Enemy_JerboaBlade", name = "沙魇", scale = 1.4f, hp = 55, speed = 5.6f, damage = 12,
                knockbackResist = 0.2f, weakBone = "bell", weakRadius = 0.19f, ai = typeof(SandWraithAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true,
                coins = new Vector2Int(1, 3), essence = 1, color = Hex.Rgb(0xd9b27a),
                radius = 0.34f, height = 1.1f, weakHeight = 0.92f,
            };
        }
    }
}
