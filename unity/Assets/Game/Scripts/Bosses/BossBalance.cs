using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领战的平衡口径（I3，docs/balance.md 第 3 节）：击杀用时目标 60–120 s；参考秒伤 = 首领浸泡（Testing/Suites/BossSoakSuite，bridge.sh playtest boss-soak）里
    /// 代表配装打首领、首领可选中时的实测秒伤（武器 + 技能 + 灼烧等持续伤害 + 英雄被动，含随机暴击，不打弱点）。
    /// 各首领的定档模型（<see cref="HanbaBalance"/> / <see cref="KunPengBalance"/> / <see cref="WarlordBalance"/> / <see cref="QilinDef.EstimateKillSeconds"/>）
    /// 都从这里取参考秒伤，再按自己的机制折算（输出率、空中命中、饮熔回甲、护体……），EditMode 测试守着 60–120 s。
    /// 改了配装、武器 / 技能 / 秘卷数值后：跑 boss-soak，把每个首领「可选中时秒伤」抄回 <see cref="Soak"/>，再看各模型的测试。
    /// 定档之前的模型按 Three.js 秒伤带中位 75 × 装备倍率估秒伤（旱魃约 100、魔将约 200），不算技能、持续伤害、增伤秘卷和英雄被动，
    /// 比实测低一半：四个首领在代表配装下都只要 35–40 s（估算 42–48 s），I3 按实测把定档耐久提到约 1.75–2.7 倍。
    /// </summary>
    public static class BossBalance
    {
        /// <summary>击杀用时的目标带（秒）</summary>
        public const float MinSeconds = 60f, MaxSeconds = 120f;

        /// <summary>输出率：真正在打首领的时间比例（躲招、换位、转火扣掉）。估算实际用时 = 可选中秒数 ÷ 输出率 + 不可选中秒数</summary>
        public const float Uptime = 0.8f;

        /// <summary>
        /// 首领浸泡实测（2026-10-30 两次，燎、裂风步枪，配装见 BossSoakSuite.Cases）：首领可选中时的秒伤，两次平均、取整到 5。
        /// 旱魃 1-4（精良 +1，利刃 ×2、鹰目）201 / 239 → 220；鲲鹏 2-4（史诗 +2，利刃 ×3、鹰目 ×2、屠巨）413 / 393 → 405；
        /// 熔心魔将 3-3（传说 +1，利刃 ×4、鹰目 ×2、屠巨、致命诀）435 / 439 → 435；火麒麟 3-4（传说 +2，利刃 ×5、鹰目 ×2、屠巨、致命诀）442 / 644，
        /// 扣掉砸鼎崩裂（4 s 受伤 ×2）约 390 / 580 → 480。
        /// 武器只占 66–76%，其余是燃爆雷 / 尾焰火灵和灼烧跳伤；首领烧着时燎的余烬让所有伤害再 +20%，所以燃爆雷砸没砸中差得多（火麒麟两次 92% / 75%）
        /// </summary>
        public static readonly (string stage, float difficulty, float dps)[] Soak =
        {
            ("1-4", 1.48f, 220f),
            ("2-4", 2.28f, 405f),
            ("3-3", 2.92f, 435f),
            ("3-4", 3.08f, 480f),
        };

        /// <summary>某一关首领的参考秒伤（可选中时、未乘输出率）；不在表里时按难度取最近一档等比折算</summary>
        public static float Dps(string stage)
        {
            foreach (var s in Soak)
                if (s.stage == stage)
                    return s.dps;
            return 0;
        }

        /// <summary>按难度：取难度最接近的一档，再按难度等比折算（定档模型换难度时用）</summary>
        public static float DpsAt(float difficulty)
        {
            var best = Soak[0];
            foreach (var s in Soak)
                if (Mathf.Abs(s.difficulty - difficulty) < Mathf.Abs(best.difficulty - difficulty))
                    best = s;
            return best.dps * Mathf.Max(0.5f, difficulty) / best.difficulty;
        }
    }
}
