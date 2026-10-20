using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三青鸟（TS qingniao，第二章远程飞行怪）：8–11 m 高处盘旋、冰羽横排扇射、掉血俯冲换位、飞满约 12 s 落到柱顶歇脚；
    /// 弱点是胸口霜晶。翼展 3.4 m，竖直胶囊包不住：存活时用布娃娃胶囊做命中盒（同 TS 挂在骨骼上的几颗命中球）
    /// </summary>
    [Defs(240)]
    public sealed class Enemy_Qingniao : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "qingniao", prefab = "SK_Enemy_Qingniao", name = "三青鸟", scale = 1.2f, hp = 80, speed = 6f, damage = 9,
                knockbackResist = 0.4f, weakBone = "chest", weakRadius = 0.17f, hitboxes = HitboxMode.Ragdoll, ai = typeof(QingniaoAI),
                role = AttackTokens.Kind.Ranged, placementRole = EnemyPlacement.Ranged, flying = true,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0x5fc8ff),
                radius = 0.42f, height = 1.5f, weakHeight = 0.8f,
            };
        }
    }
}
