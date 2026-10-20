using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 神火飞鸦（TS fire_crow，第三章飞行神风）：成群在 8–14 m 高处盘旋，轮流点火、沿锁定的直线俯冲撞地爆；空中打爆会炸到同伴。
    /// 弱点 = 肚子的火药鼓（body 骨）；一枪死（20 血）。不随机「爆裂」词缀（撞地爆就是它的机制）。
    /// </summary>
    [Defs(375)]
    public sealed class Enemy_FireCrow : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "fire_crow", prefab = "SK_Enemy_FireCrow", name = "神火飞鸦", scale = 1.2f, hp = 20, speed = 9, damage = 22,
                knockbackResist = 0.2f, weakBone = "body", weakRadius = 0.24f, ai = typeof(FireCrowAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Flank, flying = true,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xff7a2a), element = Element.Fire,
                affixExclusions = new[] { "volatile" },
                radius = 0.3f, height = 0.9f, weakHeight = 0.43f,
            };
        }
    }
}
