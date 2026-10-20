using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 变脸傩巫（TS nuo，第三章辅助）：跳火傩给 16 m 内的同伴加三张脸之一的光环（赤 / 黑 / 金，见 <see cref="NuoAI.Faces"/>），约 8 s 变一次脸，
    /// 当前这张脸被打碎就永远撤掉；近身吐火扫半圈。弱点 = 傩面（mask 骨），只能从正面打。
    /// </summary>
    [Defs(385)]
    public sealed class Enemy_Nuo : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "nuo", prefab = "SK_Enemy_Nuo", name = "变脸傩巫", scale = 1.2f, hp = 130, speed = 4, damage = 9,
                knockbackResist = 0.25f, weakBone = "mask", weakRadius = 0.15f, ai = typeof(NuoAI), role = AttackTokens.Kind.Melee,
                placementRole = EnemyPlacement.Support, groundOnly = true,
                coins = new Vector2Int(3, 5), essence = 1, color = Hex.Rgb(0xff3a1a), element = Element.Fire,
                radius = 0.32f, height = 1.75f, weakHeight = 1.36f,
            };
        }
    }
}
