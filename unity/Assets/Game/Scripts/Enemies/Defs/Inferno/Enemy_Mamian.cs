using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 马面狱卒（TS mamian，第三章远程钩拉）：马头狱卒，左腕铁铐里放出勾魂索——甩圈、掷钩、钩中就把玩家往身前拖（射断链子、跳起、冲刺能挣脱），
    /// 贴身抡链横扫；锁芯（弱点）累计吃到 30% 最大生命就缴械，改用双拳肉搏，弱点换成马头。美术官帽顶 2.1 米，游戏里放大 1.2 倍。
    /// </summary>
    [Defs(321)]
    public sealed class Enemy_Mamian : IDefSource<EnemyDef>
    {
        public IEnumerable<EnemyDef> Create()
        {
            yield return new EnemyDef
            {
                id = "mamian", prefab = "SK_Enemy_Mamian", name = "马面狱卒", scale = 1.2f, hp = 140, speed = 4, damage = 12,
                knockbackResist = 0.45f, weakBone = "forearm_L", weakRadius = 0.1f, hitboxes = HitboxMode.Ragdoll,
                ai = typeof(MamianAI), role = AttackTokens.Kind.Heavy,
                placementRole = EnemyPlacement.Ranged, groundOnly = true,
                coins = new Vector2Int(3, 6), essence = 1, color = Hex.Rgb(0xff5a2a),
                radius = 0.38f, height = 1.95f, weakHeight = 1.165f,
            };
        }
    }
}
