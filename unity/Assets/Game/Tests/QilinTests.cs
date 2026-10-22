using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 火麒麟（BS4）的定义、定档与炉心殿几何（port tests/inferno-boss.test.mjs 里与渲染 / 场景无关的部分）：
    ///   定义自检、血条刻度（85% / 70% 饮熔线 + 55% 换形，D23）、两个形态与各自的招式、焚身占位招式；
    ///   定档：3-4 难度 3.08 下按模拟秒伤，锁扣砸中两次 / 一次 / 零次的击杀用时都落在 60–120 s（docs/unity-parity.md 7.4），锁扣一两秒打得碎；
    ///   炉心殿：象限中线（西 / 北 / 东 / 南）、点落在哪个象限、俯视顺时针的下一个象限（熔流轮转，BS5）、熔岩渠与窄桥。
    /// </summary>
    public sealed class QilinTests
    {
        [Test]
        public void Def_Validates_TicksFormsAndMoves()
        {
            var def = new QilinDef();
            var errs = def.Validate();
            Assert.IsEmpty(errs, string.Join("；", errs));
            Assert.AreEqual(QilinDef.Id, def.id);
            Assert.IsTrue(def.id.StartsWith("boss"));
            CollectionAssert.AreEqual(new[] { 0.85f, 0.7f, QilinDef.TransformAt }, def.BarTicks.ToArray(), "血条刻度 = 两道饮熔线 + 换形");
            Assert.AreEqual(2, def.PhaseCount);
            Assert.AreEqual(QilinDef.BurnForm, def.phases[0].form, "55% 换焚身");
            Assert.AreEqual(1.9f, def.phases[0].SwapAt, 1e-4f, "熔岩柱最浓时换模型");
            Assert.AreEqual(QilinDef.XuanPrefab, def.FirstForm.prefab);
            Assert.AreEqual(QilinDef.BurnPrefab, def.Form(QilinDef.BurnForm).prefab);
            Assert.AreEqual("pearl", def.FirstForm.weakBone, "角根火珠是弱点");
            Assert.AreEqual(Element.Fire, def.element);

            var moves = def.moves.Select(m => m()).ToList();
            foreach (var id in new[] { ScaleGallop.MoveId, ScaleBlades.MoveId, ScaleBreath.MoveId, ScaleDrink.MoveId })
            {
                var m = moves.Single(x => x.Id == id);
                CollectionAssert.AreEqual(new[] { QilinDef.XuanForm }, m.forms, $"{id} 只在玄鳞");
            }
            foreach (var id in new[] { BurnPlaceholderStomp.MoveId, BurnPlaceholderBreath.BurnMoveId })
                CollectionAssert.AreEqual(new[] { QilinDef.BurnForm }, moves.Single(x => x.Id == id).forms, $"{id} 只在焚身（BS5 之前的占位）");
            Assert.AreEqual(0f, moves.Single(x => x.Id == ScaleDrink.MoveId).weight, "饮熔只由血量线排上");
            Assert.AreEqual(BurnPlaceholderStomp.MoveId, def.Form(QilinDef.BurnForm).firstMove);
            var heart = def.hitZones.Single(z => z.id == "heart");
            Assert.IsTrue(heart.weak);
            Assert.AreEqual(QilinDef.BurnForm, heart.form, "胸口火心只在焚身");
            Assert.AreEqual(0.15f, def.enrageBelow, 1e-4f);
        }

        [Test]
        public void Balance_KillTimeWithinBand_AtStageDifficulty()
        {
            var def = new QilinDef();
            var v = def.VitalsAt(QilinDef.StageDifficulty);
            Assert.AreEqual(12500f, v.hp, 0.5f);
            Assert.AreEqual(2400f, v.armor, 0.5f);
            Assert.AreEqual(0f, v.shield, 1e-3f);
            float dps = QilinDef.ReferenceDps(QilinDef.StageDifficulty);
            Assert.AreEqual(190.8f, dps, 0.5f);
            float two = QilinDef.EstimateKillSeconds(v, dps, 2), one = QilinDef.EstimateKillSeconds(v, dps, 1), none = QilinDef.EstimateKillSeconds(v, dps, 0);
            Assert.That(two, Is.InRange(60f, 120f), $"砸中两次 {two:F0} s");
            Assert.That(one, Is.InRange(60f, 120f), $"砸中一次 {one:F0} s");
            Assert.That(none, Is.InRange(60f, 120f), $"一次都不打 {none:F0} s");
            Assert.Less(two, one, "打锁扣砸鼎要有收益");
            Assert.Less(one, none);
            // Three.js 原值（5000 + 1500 护甲 × 难度）两次都不打要将近 3 分钟：这就是定档的理由
            var ts = new BossVitals(5000, 0, 1500).Scaled(QilinDef.StageDifficulty);
            Assert.Greater(QilinDef.EstimateKillSeconds(ts, dps, 0), 150f);
            // 锁扣：110 × 难度，一两秒打得碎
            float lockHp = QilinLock.BaseHp * QilinDef.StageDifficulty;
            Assert.That(lockHp / dps, Is.InRange(1f, 3f), $"锁扣 {lockHp:F0} 血、{lockHp / dps:F1} s");
            // 旱魃那一档也用同一个模型校一下：1-4 的 6600 在 60–120 s 里
            float hanba = (4400 + 2200) / QilinDef.ReferenceDps(1.48f);
            Assert.That(hanba, Is.InRange(60f, 120f), $"旱魃 {hanba:F0} s");
        }

        [Test]
        public void Furnace_Quadrants_ClockwiseAndChannels()
        {
            var go = new GameObject("furnace");
            try
            {
                var f = go.AddComponent<QilinFurnace>();
                Assert.AreEqual(4, f.QuadrantCount);
                // 渠在对角线上（−135 / −45 / 45 / 135），象限中线 = 西 / 北 / 东 / 南
                Assert.AreEqual(-90f, f.QuadrantYaw(0), 1e-3f);
                Assert.AreEqual(0f, f.QuadrantYaw(1), 1e-3f);
                Assert.AreEqual(90f, f.QuadrantYaw(2), 1e-3f);
                Assert.AreEqual(180f, Mathf.Abs(f.QuadrantYaw(3)), 1e-3f);
                Assert.AreEqual(1, f.QuadrantOf(new Vector3(2, 0, 15)), "北");
                Assert.AreEqual(2, f.QuadrantOf(new Vector3(15, 0, -3)), "东");
                Assert.AreEqual(3, f.QuadrantOf(new Vector3(-1, 0, -15)), "南");
                Assert.AreEqual(0, f.QuadrantOf(new Vector3(-15, 0, 1)), "西");
                // 俯视（北朝上）顺时针：北 → 东 → 南 → 西 → 北
                Assert.AreEqual(2, f.ClockwiseNext(1));
                Assert.AreEqual(3, f.ClockwiseNext(2));
                Assert.AreEqual(0, f.ClockwiseNext(3));
                Assert.AreEqual(1, f.ClockwiseNext(0));
                // 熔岩渠：东北渠的外段（r 19）、内段（r 8）是熔岩，窄桥（r 12）不是；象限中线上不是
                Assert.IsTrue(f.OnChannel(f.Point(45, 19)));
                Assert.IsTrue(f.OnChannel(f.Point(45, 8)));
                Assert.IsFalse(f.OnChannel(f.Point(45, 12)), "窄桥");
                Assert.IsFalse(f.OnChannel(f.Point(0, 19)));
                Assert.IsFalse(f.OnChannel(f.Point(45, 5)), "熔池里不算渠");
                // 点 / 方位互逆
                var p = f.Point(-60f, 17f);
                Assert.AreEqual(-60f, f.YawOf(p), 1e-3f);
                Assert.AreEqual(17f, f.RadiusOf(p), 1e-3f);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void Moves_TimingMatchesThreeJs()
        {
            var blades = new ScaleBlades();
            Assert.AreEqual(1f, blades.windup, 1e-4f, "人立 1 s");
            Assert.AreEqual(36, ScaleBlades.Count);
            Assert.AreEqual(0.4f, ScaleBlades.SecondDelay, 1e-4f, "85% 以下 0.4 s 后第二圈");
            var breath = new ScaleBreath();
            Assert.AreEqual(0.8f, breath.windup, 1e-4f);
            Assert.AreEqual(1.6f, breath.active, 1e-4f);
            var gallop = new ScaleGallop();
            Assert.AreEqual(9f, gallop.cooldown, 1e-4f);
            var drink = new ScaleDrink();
            Assert.AreEqual(1f, drink.windup, 1e-4f, "1 s 跃向池边");
            var def = new QilinDef();
            Assert.AreEqual(4f, def.drinkSeconds, 1e-4f);
            Assert.AreEqual(4f, QilinDef.StunSeconds, 1e-4f);
            Assert.AreEqual(2f, QilinDef.CrackTakenMult, 1e-4f);
            Assert.AreEqual(5.2f, def.phases[0].seconds, 1e-4f, "换形演出 5.2 s");
        }
    }
}
