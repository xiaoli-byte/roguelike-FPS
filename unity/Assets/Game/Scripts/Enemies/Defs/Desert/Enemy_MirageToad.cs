using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>蜃楼蟾（TS mirage_toad）：在岩丘后吊射火球、放蜃景分身，弱点是下颌的喉囊</summary>
    [Defs(120)]
    public sealed class Enemy_MirageToad : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return Toad();
        }

        /// <summary>本体定义（分身 <see cref="Enemy_MirageToadDecoy"/> 在它的基础上改几项，同 TS 的 {...MIRAGE_TOAD_DEF}）</summary>
        internal static EnemyDef Toad() => new()
        {
            id = "mirage_toad", prefab = "SK_Enemy_MirageToad", name = "蜃楼蟾", hp = 170, speed = 2.6f, damage = 24,
            knockbackResist = 0.7f, weakBone = "sac", weakRadius = 0.42f, ai = typeof(MirageToadAI), role = AttackTokens.Kind.Heavy,
            placementRole = EnemyPlacement.Artillery, groundOnly = true, element = Element.Fire,
            coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0xffd27a),
            radius = 1.0f, height = 3.0f, weakHeight = 0.78f,
        };
    }
}
