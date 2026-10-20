using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰灯水母（TS lantern_jelly）：漂浮的辅助。光触须连着 12 m 内最多 3 个同伴，每秒回它们 4% 最大生命；
    /// 玩家进 5.5 m 时放一圈冻电（伤害 + 寒意 40% 1 s）。弱点 = 伞盖下的灯芯（core 骨），打灯芯能把连线全部打断
    /// </summary>
    [Defs(280)]
    public sealed class Enemy_LanternJelly : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "lantern_jelly", prefab = "SK_Enemy_LanternJelly", name = "冰灯水母", scale = 1.1f, hp = 110, speed = 3.4f, damage = 10,
                knockbackResist = 0.4f, weakBone = "core", weakRadius = 0.2f,
                ai = typeof(LanternJellyAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Support, flying = true,
                coins = new Vector2Int(2, 4), essence = 1, color = Hex.Rgb(0x6fe8ff), element = Element.Shock,
                radius = 0.42f, height = 1.8f, weakHeight = 1.07f,
            };
        }
    }
}
