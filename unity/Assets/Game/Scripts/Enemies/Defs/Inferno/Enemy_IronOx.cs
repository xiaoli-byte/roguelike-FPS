using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔炉铁牛（TS iron_ox，第三章坦克）：照唐代镇河铁牛铸的炉牛，胸口一扇青铜兽面炉门。铁甲到处只吃 20%，
    /// 炉门只在鼓风吸气 / 呛火跪倒时敞开，从正面打进炉膛 ×3（弱点在正面，只在它最危险的时候打开）。美术头顶 2.4 米，游戏里放大 1.4 倍。
    /// </summary>
    [Defs(310)]
    public sealed class Enemy_IronOx : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "iron_ox", prefab = "SK_Enemy_IronOx", name = "熔炉铁牛", scale = 1.4f, hp = 700, armor = 260, speed = 2.4f, damage = 40,
                knockbackResist = 1, weakBone = "chest", weakRadius = 0.2f, ai = typeof(IronOxAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Assault, groundOnly = true, element = Element.Fire,
                coins = new Vector2Int(9, 13), essence = 3, color = Hex.Rgb(0xff6a1a),
                radius = 0.95f, height = 2.3f, weakHeight = 0.84f,
            };
        }
    }
}
