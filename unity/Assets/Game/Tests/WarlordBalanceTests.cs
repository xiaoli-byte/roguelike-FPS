using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 熔心魔将（BS6）的定义与击杀用时（docs/unity-parity.md 7.4「用模拟秒伤算击杀用时，落在 60–120 s」）：
    /// 3-3 难度 2.92 的定档、四种元素构筑、参考秒伤 ±15–20% 的构筑都落在 60–120 s；血条刻度 = 两道阶段阈值，20% 狂怒，二阶段第一招是熔铜渠涨落；
    /// 招式清单是 B1 的五个参考招式 + 熔铜渠涨落，定义自检通过。
    /// </summary>
    public sealed class WarlordBalanceTests
    {
        static readonly WarlordDef Def = new();

        [Test]
        public void Definition_ValidatesAndUsesReferenceMoves()
        {
            var errs = Def.Validate();
            Assert.IsEmpty(errs, string.Join("；", errs));
            var ids = Def.moves.Select(m => m().Id).ToArray();
            CollectionAssert.AreEqual(new[] { "warlord_charge", "warlord_sweep", "warlord_meteor", "warlord_leap", "warlord_combo", WarlordChannelSurge.MoveId }, ids);
            Assert.IsFalse(Def.moves.Any(m => m().Id == "warlord_lava"), "方场熔岩涌动在 3-3 改成了熔铜渠涨落（D5）");
            Assert.IsTrue(Def.moves.Take(5).All(m => m().windupAnim == null), "参考招式的前摇动作名是样机的，魔将的动作由 WarlordBrain 触发");
            Assert.AreEqual(WarlordDef.Id, Def.id);
            Assert.AreEqual("SK_Boss_Warlord", Def.FirstForm.prefab);
        }

        [Test]
        public void Phases_TicksAndFury()
        {
            CollectionAssert.AreEqual(new[] { 0.5f, 0.2f }, Def.BarTicks.ToArray());
            Assert.AreEqual(0.2f, Def.enrageBelow, 1e-5f, "20% 狂怒");
            Assert.AreEqual(0f, Def.enrageAfter);
            Assert.AreEqual(WarlordChannelSurge.MoveId, Def.phases[0].firstMove, "越过 50% 后第一招是熔铜渠涨落");
            Assert.AreEqual("warlord_meteor", Def.phases[1].firstMove);
            // 三阶段喘息 ≈ TS 的 0.6（阶段 × 狂怒）
            Assert.AreEqual(0.6f, Def.phases[1].restScale * Def.enrageRestScale, 0.02f);
            Assert.AreEqual(0, Def.summonCap);
        }

        [Test]
        public void Vitals_TierAtStageDifficulty()
        {
            var v = Def.VitalsAt(WarlordDef.StageDifficulty);
            Assert.AreEqual(WarlordDef.TierHp, v.hp, 0.5f);
            Assert.AreEqual(WarlordDef.TierShield, v.shield, 0.5f);
            Assert.AreEqual(WarlordDef.TierArmor, v.armor, 0.5f);
            // 难度 1 的参考值 ≈ 定档 ÷ 2.92（没有定档表时同样的比例）
            Assert.AreEqual(WarlordDef.TierHp / WarlordDef.StageDifficulty, Def.vitals.hp, 15f);
            Assert.AreEqual(WarlordDef.TierShield / WarlordDef.StageDifficulty, Def.vitals.shield, 15f);
            Assert.AreEqual(WarlordDef.TierArmor / WarlordDef.StageDifficulty, Def.vitals.armor, 15f);
        }

        [Test]
        public void KillTime_NominalBuild_Within60To120()
        {
            float t = WarlordBalance.KillSeconds(Def, WarlordDef.StageDifficulty);
            TestContext.WriteLine($"参考秒伤 {WarlordBalance.ReferenceDps(WarlordDef.StageDifficulty):F0}，无属性构筑击杀用时 {t:F1} s");
            Assert.That(t, Is.InRange(WarlordBalance.MinSeconds, WarlordBalance.MaxSeconds));
            Assert.That(t, Is.InRange(80f, 110f), "领主战按中段定档（85–100 s 左右）");
        }

        [TestCase(Element.None)]
        [TestCase(Element.Fire)]
        [TestCase(Element.Shock)]
        [TestCase(Element.Corrode)]
        public void KillTime_EachElement_Within60To120(Element e)
        {
            float t = WarlordBalance.KillSeconds(Def, WarlordDef.StageDifficulty, 1f, e);
            TestContext.WriteLine($"{e}：{t:F1} s");
            Assert.That(t, Is.InRange(WarlordBalance.MinSeconds, WarlordBalance.MaxSeconds));
        }

        [TestCase(0.85f, Element.None)]
        [TestCase(0.85f, Element.Fire)]
        [TestCase(1.2f, Element.None)]
        [TestCase(1.2f, Element.Fire)]
        [TestCase(1.2f, Element.Shock)]
        public void KillTime_WeakAndStrongBuilds_StayInBand(float dpsScale, Element e)
        {
            float t = WarlordBalance.KillSeconds(Def, WarlordDef.StageDifficulty, dpsScale, e);
            TestContext.WriteLine($"秒伤 × {dpsScale}、{e}：{t:F1} s");
            Assert.That(t, Is.InRange(WarlordBalance.MinSeconds, WarlordBalance.MaxSeconds));
        }

        [Test]
        public void KillTime_TsValuesTimesDifficulty_WouldUndershoot()
        {
            // 不定档、直接用 TS 原值 × 难度：按 I3 浸泡实测的秒伤不到 60 s（BS6 按「约 200 秒伤」估时会超过 120 s，所以当时往下定档）——重定档的理由
            var raw = new BossDef { id = "boss_warlord_raw", name = "魔将（TS 原值）", vitals = new BossVitals(4000, 1000, 1100) };
            raw.phases.AddRange(Def.phases);
            float t = WarlordBalance.KillSeconds(raw, WarlordDef.StageDifficulty);
            TestContext.WriteLine($"TS 原值 × 2.92：{t:F1} s");
            Assert.Less(t, WarlordBalance.MinSeconds);
        }

        [Test]
        public void ReferenceDps_ScalesWithDifficulty()
        {
            // 锚在 3-3 的浸泡实测（BossBalance.Soak），换难度等比
            Assert.AreEqual(BossBalance.Dps("3-3"), WarlordBalance.ReferenceDps(WarlordDef.StageDifficulty), 0.01f);
            Assert.AreEqual(BossBalance.Dps("3-3") * 1.48f / 2.92f, WarlordBalance.ReferenceDps(1.48f), 0.01f);
            // 三层依次：只有生命层时就是 hp ÷ (秒伤 × 层倍率)
            Assert.AreEqual(10f, WarlordBalance.LayerSeconds(new BossVitals(1000), 100f, Element.None), 1e-3f);
            Assert.AreEqual(1000f / (100f * 0.75f), WarlordBalance.LayerSeconds(new BossVitals(0, 0, 1000), 100f, Element.None), 1e-3f);
        }

        [Test]
        public void SurgeHold_LongerInFury()
        {
            Assert.Greater(Def.SurgeHoldAt(2), Def.SurgeHoldAt(1));
            Assert.AreEqual(Def.SurgeHoldAt(9), Def.SurgeHoldAt(2));
        }
    }
}
