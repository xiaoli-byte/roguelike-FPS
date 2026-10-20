using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰棘豪彘（TS haozhi）：地面自爆怪。刨地冲锋，冲到 6 m 内急停竖刺，炸出一圈 16 根水平冰刺后自身死亡、留下残刺阵。
    /// 弱点 = 背上的刺冠（quill_2 骨）；身体是长条，命中用布娃娃胶囊（TS 挂在骨骼上的三颗球）。冲锋型：正面位从场地远端进场。
    /// </summary>
    [Defs(260)]
    public sealed class Enemy_Haozhi : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "haozhi", prefab = "SK_Enemy_Haozhi", name = "冰棘豪彘", scale = 1.4f, hp = 36, speed = 5.2f, damage = 18,
                knockbackResist = 0.25f, weakBone = "quill_2", weakRadius = 0.26f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(HaozhiAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Assault, groundOnly = true, charger = true,
                coins = new Vector2Int(1, 3), essence = 1, color = Hex.Rgb(0x9fd8ff),
                radius = 0.3f, height = 0.9f, weakHeight = 0.66f,
            };
        }
    }
}
