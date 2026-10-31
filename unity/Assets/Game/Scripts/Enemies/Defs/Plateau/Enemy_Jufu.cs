using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 举父（网页 jufu，第四章远程·炮击）：《西山经》崇吾山「其状如禺而文臂，豹虎而善投」。开战先抢高，再抛物线远投；雷暴时投雷石，
    /// 落地留电场；举石的 1 s 里打它手里的石头，石头在它手里炸开。弱点 = 胸口掌印（举石时手里的石头另算）。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(430)]
    public sealed class Enemy_Jufu : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "jufu", prefab = "SK_Enemy_Jufu", name = "举父", scale = 1f, hp = 240, speed = 5f, damage = 18,
                knockbackResist = 0.3f, weakBone = "palm", weakRadius = 0.22f, ai = typeof(JufuAI), role = AttackTokens.Kind.Ranged,
                placementRole = EnemyPlacement.Artillery, element = Element.Shock,
                poise = 60, staggerSeconds = 0.6f,
                coins = new Vector2Int(3, 5), essence = 2, color = Hex.Rgb(0xa08868),
                radius = 0.45f, height = 1.9f, weakHeight = 1.25f,
            };
        }
    }
}
