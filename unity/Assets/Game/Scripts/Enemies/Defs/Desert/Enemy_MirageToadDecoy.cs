using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>蜃景（TS mirage_toad_decoy）：蜃楼蟾放出的分身，同一个 Prefab，血薄、没伤害、不掉落</summary>
    [Defs(121)]
    public sealed class Enemy_MirageToadDecoy : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            var d = Enemy_MirageToad.Toad();
            d.id = "mirage_toad_decoy";
            d.name = "蜃景";
            d.hp = 30;
            d.damage = 0;
            d.knockbackResist = 0.3f;
            d.element = Element.None;
            d.coins = Vector2Int.zero;
            d.essence = 0;
            yield return d;
        }
    }
}
