using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔铜匠（TS founder，第三章辅助）：躲在同伴身后往它们身上浇铜甲（先通红 ×2、后冷青铜 ×0.5），近身泼铜，背上坩埚被打裂就不再浇。
    /// 弱点 = 坩埚里的熔铜液面（bronze 骨）；正面被他自己的头挡住（AI 另挂一个头部命中区）。
    /// </summary>
    [Defs(380)]
    public sealed class Enemy_Founder : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "founder", prefab = "SK_Enemy_Founder", name = "熔铜匠", scale = 1.3f, hp = 150, speed = 3, damage = 10,
                knockbackResist = 0.55f, weakBone = "bronze", weakRadius = 0.18f, ai = typeof(FounderAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Support, groundOnly = true,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0xffa030), element = Element.Fire,
                radius = 0.36f, height = 1.55f, weakHeight = 1.21f,
            };
        }
    }
}
