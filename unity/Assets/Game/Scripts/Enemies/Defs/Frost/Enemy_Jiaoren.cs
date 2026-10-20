using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>冻鲛人（TS jiaoren，第二章群怪·北冥）：先远投骨矛、再成群突刺，弱点是额头鲛珠（判定球罩住整张鱼脸），死后掉鲛珠小回复</summary>
    [Defs(200)]
    public sealed class Enemy_Jiaoren : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "jiaoren", prefab = "SK_Enemy_Jiaoren", name = "冻鲛人", scale = 1.15f, hp = 40, speed = 5.2f, damage = 11,
                knockbackResist = 0, weakBone = "head", weakRadius = 0.21f, ai = typeof(JiaorenAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true,
                coins = new Vector2Int(1, 2), essence = 1, color = Hex.Rgb(0x7fd8ff),
                radius = 0.3f, height = 1.2f, weakHeight = 1.02f,
            };
        }
    }
}
