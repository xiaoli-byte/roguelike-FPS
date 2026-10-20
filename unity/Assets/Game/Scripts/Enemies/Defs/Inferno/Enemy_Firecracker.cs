using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炮仗傀儡（TS firecracker，第三章炮击怪）：保持 12–22 m 一窝蜂齐射，近身撒地老鼠，引信烧着时打火药仓哑炸，死时连环爆。
    /// 弱点 = 腹部铜火药仓（挂在 chest 骨上，AI 在第一帧按模型空间的火药仓位置重新摆）。
    /// 不随机「爆裂」词缀：死亡爆炸本来就是它的机制（同 TS 对爆骸虫的排除）。
    /// </summary>
    [Defs(370)]
    public sealed class Enemy_Firecracker : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "firecracker", prefab = "SK_Enemy_Firecracker", name = "炮仗傀儡", scale = 1.2f, hp = 160, speed = 2.5f, damage = 16,
                knockbackResist = 0.3f, weakBone = "chest", weakRadius = 0.2f, ai = typeof(FirecrackerAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Artillery,
                coins = new Vector2Int(3, 6), essence = 1, color = Hex.Rgb(0xff5a2a), element = Element.Fire,
                affixExclusions = new[] { "volatile" },
                radius = 0.42f, height = 1.9f, weakHeight = 0.76f,
            };
        }
    }
}
