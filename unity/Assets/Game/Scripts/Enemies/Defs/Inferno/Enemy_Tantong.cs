using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炭童（TS tantong，第三章群怪）：一米来高的炭块小孩，成群扑抓、抛炭；死后碎成余烬炭堆（<see cref="Enemy_TantongEmber"/>），
    /// 不补刀 4 秒后复燃成 tantong_reborn（半血、不掉落、再死不留炭堆）。弱点是头顶的烛芯炭火苗。
    /// 美术按 1.0 米（含火苗）制作，游戏里放大 1.3 倍。
    /// </summary>
    [Defs(300)]
    public sealed class Enemy_Tantong : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return Tantong();
            // 复燃站起来的炭童：与本体共用美术和行为，半血（TantongAI 复燃时写）、不掉落
            var reborn = Tantong();
            reborn.id = TantongAI.RebornId;
            reborn.coins = Vector2Int.zero;
            reborn.essence = 0;
            yield return reborn;
        }

        internal static EnemyDef Tantong() => new()
        {
            id = "tantong", prefab = "SK_Enemy_Tantong", name = "炭童", scale = 1.3f, hp = 30, speed = 6.5f, damage = 9,
            knockbackResist = 0, weakBone = "head", weakRadius = 0.15f, ai = typeof(TantongAI), role = AttackTokens.Kind.Melee,
            placementRole = EnemyPlacement.Assault, groundOnly = true, element = Element.Fire,
            coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0xff6a1a),
            radius = 0.26f, height = 1.0f, weakHeight = 0.86f,
        };
    }
}
