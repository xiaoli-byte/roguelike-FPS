using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炭童余烬（TS tantong_ember）：炭童死后碎成的一堆冒烟炭块（不进阵容，只由 <see cref="TantongAI"/> 生成）。
    /// 一枪就散（8 点血），范围伤害照样打得到，玩家走进 0.75 m 踩散；4 秒内没散就复燃成半血的炭童；祸斗会来吃掉它。
    /// 没有美术 Prefab：按占位体的尺寸生成后由 <see cref="TantongEmberAI"/> 换成程序化的炭堆。
    /// </summary>
    [Defs(301)]
    public sealed class Enemy_TantongEmber : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = TantongAI.EmberId, prefab = "SK_Enemy_TantongEmber", name = "炭童余烬", scale = 1.3f, hp = 8, speed = 0, damage = 0,
                knockbackResist = 1, weakBone = "ember_core", weakRadius = 0.3f, ai = typeof(TantongEmberAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Assault, groundOnly = true, element = Element.Fire,
                coins = Vector2Int.zero, essence = 0, color = Hex.Rgb(0xff6a1a),
                // 碰撞半径很小（不把玩家顶开，好让玩家踩上去）；命中判定是炭堆上的球
                radius = 0.12f, height = 0.3f, weakHeight = 0.18f,
            };
        }
    }
}
