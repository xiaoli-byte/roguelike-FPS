using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 天狗（网页 tiangou，第四章群怪·包抄）：《西山经》阴山「其状如狸而白首」。12–18 m 外绕到玩家两侧和身后，
    /// 一只雷吠给玩家打雷标（定格 0.6 s 后落雷），一只只从视野外扑咬；3 m 内落雷就衔雷带电。弱点 = 白首额心的雷纹。
    /// 数值照网页版 src/world/plateau/play/foes.ts（docs/level-design/chuanzang-combat-v1.md 第 3 节）；设计单 docs/art/vfx/foes-ch4.md。
    /// </summary>
    [Defs(410)]
    public sealed class Enemy_Tiangou : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "tiangou", prefab = "SK_Enemy_Tiangou", name = "天狗", scale = 1.1f, hp = 80, speed = 9.5f, damage = 9,
                knockbackResist = 0.1f, weakBone = "rune", weakRadius = 0.18f, ai = typeof(TiangouAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Flank, groundOnly = true, element = Element.Shock,
                poise = 30, staggerSeconds = 0.45f,
                coins = new Vector2Int(2, 3), essence = 1, color = Hex.Rgb(0xff4fd8),
                radius = 0.35f, height = 1.4f, weakHeight = 1.15f,
            };
        }
    }
}
