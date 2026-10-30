using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领击杀用时的模拟（docs/unity-parity.md 7.4「用模拟秒伤算击杀用时，落在 60–120 s」；BS6 定档用，EditMode 测试 WarlordBalanceTests 守着它）。
    ///   参考秒伤：3-3 首领浸泡的实测（<see cref="BossBalance.Soak"/>：传说 +1 裂风步枪 + 典型增伤秘卷 + 技能，可选中时约 435），换难度时按难度等比——
    ///     敌人的耐久 × 难度，玩家的构筑（武器升级、稀有度、秘卷）跟着长。I3 之前是「1-4 按 100 秒伤、之后按难度等比」（3-3 约 197），只有实测的一半；
    ///   三层：护盾 → 护甲 → 生命依次吃，各层按元素倍率（<see cref="DamageTable.LayerMult"/>：无属性打护甲 75%、火克生命、雷克护盾、蚀克护甲）；
    ///   输出率 <see cref="Uptime"/>：躲招、换位、首领不可选中之外真正在打的比例；再加上阶段转换演出的不可选中时间。
    /// </summary>
    public static class WarlordBalance
    {
        public const float AnchorDifficulty = WarlordDef.StageDifficulty, Uptime = BossBalance.Uptime;
        /// <summary>锚点秒伤：3-3 浸泡实测（<see cref="BossBalance.Soak"/>）</summary>
        public static float AnchorDps => BossBalance.Dps("3-3");
        /// <summary>击杀用时的目标带（秒）</summary>
        public const float MinSeconds = BossBalance.MinSeconds, MaxSeconds = BossBalance.MaxSeconds;

        /// <summary>某个难度下的参考秒伤（首领可选中时；不打弱点，随机暴击、技能、持续伤害已在实测里；躲招由 <see cref="Uptime"/> 扣）</summary>
        public static float ReferenceDps(float difficulty) => AnchorDps * Mathf.Max(0.5f, difficulty) / AnchorDifficulty;

        /// <summary>纯输出时间：三层各自 ÷（秒伤 × 元素层倍率）之和</summary>
        public static float LayerSeconds(BossVitals v, float dps, Element element)
        {
            float d = Mathf.Max(1f, dps);
            return v.shield / (d * DamageTable.LayerMult(element, DamageLayer.Shield))
                   + v.armor / (d * DamageTable.LayerMult(element, DamageLayer.Armor))
                   + v.hp / (d * DamageTable.LayerMult(element, DamageLayer.Health));
        }

        /// <summary>阶段转换演出（不可选中）的总时长</summary>
        public static float Downtime(BossDef def)
        {
            float t = 0;
            if (def == null) return 0;
            foreach (var p in def.phases)
                if (p != null)
                    t += Mathf.Max(0, p.seconds);
            return t;
        }

        /// <summary>击杀用时（秒）：纯输出 ÷ 输出率 + 转换演出。dpsScale = 相对参考秒伤的倍率（构筑好坏）</summary>
        public static float KillSeconds(BossDef def, float difficulty, float dpsScale = 1f, Element element = Element.None, float uptime = Uptime)
        {
            if (def == null) return 0;
            float dps = ReferenceDps(difficulty) * Mathf.Max(0.05f, dpsScale);
            return LayerSeconds(def.VitalsAt(difficulty), dps, element) / Mathf.Clamp(uptime, 0.1f, 1f) + Downtime(def);
        }
    }
}
