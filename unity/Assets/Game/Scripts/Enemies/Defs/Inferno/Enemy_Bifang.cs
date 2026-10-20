using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 毕方（TS bifang，第三章栖落狙击）：独脚火鹤，从不悬停——单足立在柱顶 / 高台上，或扇几下翅膀短滑翔换到另一处高点。
    /// 「毕—方」两声：第一声瞄准（细线跟踪后锁定），第二声射出快速火矛；腿累计吃到 25% 最大生命就从高处摔下来扑腾 2.5 秒。
    /// 弱点是喙里衔的炭火。美术冠顶 2.0 米，游戏里放大 1.2 倍。
    /// </summary>
    [Defs(320)]
    public sealed class Enemy_Bifang : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "bifang", prefab = "SK_Enemy_Bifang", name = "毕方", scale = 1.2f, hp = 90, speed = 7, damage = 20,
                knockbackResist = 0.5f, weakBone = "head", weakRadius = 0.09f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(BifangAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Precision, flying = true, element = Element.Fire,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0xff6a2a),
                radius = 0.3f, height = 1.4f, weakHeight = 1.445f,
            };
        }
    }
}
