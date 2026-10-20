using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 祸斗（TS huodou，第三章群怪）：食火吐火的黑犬（细犬原型）。三四只包抄扑咬，吃掉地上的火（炭堆、地火、熔岩边）变大变亮，
    /// 吃过火才吐扇形火。弱点是两侧肋间裂开的熔火腹（从侧面打，吃过火后更大）。美术头高 1.1 米，游戏里放大 1.2 倍。
    /// </summary>
    [Defs(302)]
    public sealed class Enemy_Huodou : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "huodou", prefab = "SK_Enemy_Huodou", name = "祸斗", scale = 1.2f, hp = 70, speed = 8, damage = 12,
                knockbackResist = 0, weakBone = "chest", weakRadius = 0.11f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(HuodouAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true, element = Element.Fire,
                coins = new Vector2Int(1, 3), essence = 1, color = Hex.Rgb(0xff6a1a),
                radius = 0.32f, height = 0.95f, weakHeight = 0.56f,
            };
        }
    }
}
