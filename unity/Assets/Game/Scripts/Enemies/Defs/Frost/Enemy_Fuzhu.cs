using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 夫诸（TS fuzhu）：精准远程。13–24 m 踱步，蓄力 1.2 s 射出直线冰光（前 70% 跟踪、后 30% 锁死），光束下的地面结冰 4 s 打滑；
    /// 玩家逼近到 6.5 m 内时后跳约 10 m。弱点 = 胸口冰晶（gem 骨）；胸、臀、颈、头另有命中盒（布娃娃胶囊）。只站地面（跳跃要留空地）
    /// </summary>
    [Defs(290)]
    public sealed class Enemy_Fuzhu : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "fuzhu", prefab = "SK_Enemy_Fuzhu", name = "夫诸", scale = 1.25f, hp = 95, speed = 4.4f, damage = 28,
                knockbackResist = 0.35f, weakBone = "gem", weakRadius = 0.16f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(FuzhuAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Precision, groundOnly = true,
                coins = new Vector2Int(2, 4), essence = 1, color = Hex.Rgb(0x9fe8ff),
                radius = 0.42f, height = 1.5f, weakHeight = 0.9f,
            };
        }
    }
}
