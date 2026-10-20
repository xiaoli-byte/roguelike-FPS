using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;
using Rig = Spiritfire.Game.Tests.ScrollUtilityTests.Rig;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 传说 + 英雄专属秘卷（S4）：数值与 Three.js 版 src/progression/scrolls/defsLegend.ts 一致；高风险卷带「高风险」标签和红色代价行；
    /// 每个钩子至少一条（真的走 Combat.DamageEnemy / PlayerVitals.TakeDamage / GameEvents）。测试台见 <see cref="ScrollUtilityTests.Rig"/>。
    /// </summary>
    public sealed class ScrollLegendTests
    {
        const float Eps = 1e-4f;
        Rig rig;

        [SetUp]
        public void SetUp() => rig = new Rig();

        [TearDown]
        public void TearDown() => rig.Dispose();

        static readonly string[] Legendaries = { "glass_cannon", "berserk_blood", "gambler", "thousand_blades", "midas_heart", "blood_pact", "overdrive" };
        static readonly string[] Risky = { "glass_cannon", "berserk_blood", "gambler", "midas_heart", "blood_pact", "overdrive" };

        // ───────────── 定义 ─────────────

        [Test]
        public void LegendariesAreUniqueAndRiskyOnesShowARedDownsideLine()
        {
            foreach (var id in Legendaries)
            {
                var d = Rig.Def(id);
                Assert.AreEqual(Rarity.Legendary, d.rarity, id);
                Assert.AreEqual(1, d.maxStacks, id);
                Assert.AreEqual(LegendScroll.LegendTag, d.tag, $"{id} 卡面主标签");
                Assert.IsNull(d.heroOnly);
                var legend = d as LegendScroll;
                Assert.IsNotNull(legend, id);
                bool risky = Risky.Contains(id);
                Assert.AreEqual(risky, legend.HighRisk, $"{id} 有没有代价");
                Assert.AreEqual(risky, d.HasTag(LegendScroll.RiskTag), $"{id} 高风险标签");
                Assert.AreEqual(risky, LegendScroll.HasDownside(d), id);
                Assert.AreEqual(d.description, d.Describe(1), $"{id} 描述没有占位");
                StringAssert.StartsWith(legend.upside, d.description);
                if (risky)
                {
                    var line = LegendScroll.DownsideLine(legend.downside);
                    StringAssert.EndsWith("\n" + line, d.description, $"{id} 代价另起一行");
                    StringAssert.StartsWith("<color=#ff6a50>代价：", line);
                    StringAssert.DoesNotContain("但", d.description, $"{id}：代价不再用「但」接在收益后面");
                }
                else Assert.AreEqual(legend.upside, d.description);
            }
            Assert.IsFalse(LegendScroll.HasDownside(Rig.Def("keen_blade")));
            Assert.AreEqual("武器伤害 +55%。\n<color=#ff6a50>代价：受到的伤害 +35%。</color>", Rig.Def("glass_cannon").description);
        }

        [Test]
        public void HeroScrollsOnlyRollForTheirHero()
        {
            var cases = new (string id, string hero)[] { ("fox_resonance", "fox"), ("falcon_sky", "falcon"), ("bear_mountain", "bear") };
            foreach (var (id, hero) in cases)
            {
                var d = Rig.Def(id);
                Assert.AreEqual(hero, d.heroOnly, id);
                Assert.AreEqual(Rarity.Rare, d.rarity, id);
                Assert.AreEqual(3, d.maxStacks, id);
                Assert.AreEqual("英雄", d.tag, id);
                foreach (var (_, other) in cases)
                {
                    var c = new ScrollRoll.Context { heroId = other };
                    Assert.AreEqual(other == hero, ScrollRoll.Eligible(d, c), $"{id} 在 {other} 的卡池里");
                }
                Assert.AreEqual(26f * ScrollRoll.HeroOnlyMult, ScrollRoll.Weight(d, new ScrollRoll.Context { heroId = hero }), Eps, "专属 ×1.5");
            }
        }

        // ───────────── 传说 ─────────────

        [Test]
        public void GlassCannonTradesDamageTakenForWeaponDamage()
        {
            rig.Gain("glass_cannon");
            Assert.AreEqual(0.55f, rig.Sheet.Get(Stat.DamagePct), Eps);
            Assert.AreEqual(13.5f, rig.Hurt(10), Eps, "受到的伤害 ×1.35");
            Assert.AreEqual(50 - 13.5f, rig.Player.shield, Eps);
        }

        [Test]
        public void BerserkBloodScalesWithMissingHealthAndDelaysShield()
        {
            Assert.AreEqual(1f, BerserkBloodScroll.Mult(1), Eps);
            Assert.AreEqual(1.35f, BerserkBloodScroll.Mult(0.5f), Eps);
            Assert.AreEqual(1.63f, BerserkBloodScroll.Mult(0.05f), Eps, "封顶 +63%");
            Assert.AreEqual(1.63f, BerserkBloodScroll.Mult(0), Eps);
            rig.Gain("berserk_blood");
            Assert.AreEqual(5, rig.Sheet.Get(Stat.ShieldRegenDelay), Eps, "护盾恢复延迟 3 + 2");
            var enemy = rig.Enemy();
            Assert.AreEqual(100, Rig.Shoot(enemy, 100).total, Eps, "满血不加");
            rig.Player.health = 50;
            Assert.AreEqual(135, Rig.Shoot(enemy, 100).total, Eps, "损失 50% → +35%");
            Assert.AreEqual(135, Rig.Shoot(enemy, 100, DamageSource.Skill).total, Eps, "所有伤害都吃（同 TS）");
        }

        [Test]
        public void GamblerPunishesOnlyNonCritWeaponHits()
        {
            rig.Gain("gambler");
            Assert.AreEqual(0.30f, rig.Sheet.Get(Stat.CritChance), Eps);
            Assert.AreEqual(0.5f, rig.Sheet.Get(Stat.CritDamagePct), Eps);
            var enemy = rig.Enemy();
            Assert.AreEqual(70, Rig.Shoot(enemy, 100).total, Eps, "武器非暴击 −30%");
            Assert.AreEqual(300, Rig.Shoot(enemy, 100, crit: true).total, Eps, "暴击 ×2 × 1.5，不打折");
            Assert.AreEqual(100, Rig.Shoot(enemy, 100, DamageSource.Skill).total, Eps, "技能不受影响");
        }

        static List<PlayerProjectile> Blades() =>
            Object.FindObjectsByType<PlayerProjectile>(FindObjectsInactive.Exclude)
                .Where(p => p.Alive && p.damage.procId == ThousandBladesScroll.ScrollId).ToList();

        [Test]
        public void ThousandBladesFiresHomingSwordsOnAboutFifteenPercentOfDirectHits()
        {
            RunState.Current = new RunState { seed = 20261021 };
            rig.Gain("thousand_blades");
            var enemy = rig.Enemy(hp: 1e8f);
            const int N = 400;
            for (int i = 0; i < N; i++)
            {
                Rig.Step(0.13f);
                Rig.Shoot(enemy, 100);
            }
            var blades = Blades();
            // 期望 60，标准差约 7：给 ±4.5σ 的余量
            Assert.That(blades.Count, Is.InRange(28, 92), "15% 概率");
            Assert.AreEqual(blades.Count, rig.Procs("thousand_blades"));
            foreach (var b in blades)
            {
                Assert.AreEqual(120, b.damage.amount, Eps, "该次伤害的 120%");
                Assert.AreEqual(DamageSource.Scroll, b.damage.source);
                Assert.AreEqual(1, b.damage.depth);
                Assert.IsTrue(b.damage.Has(DamageTag.Proc) && b.damage.noCrit);
                Assert.AreEqual(enemy, b.target);
                Assert.AreEqual(10, b.homing, Eps);
                Assert.AreEqual(30, b.velocity.magnitude, 1e-3f);
            }

            int before = blades.Count;
            for (int i = 0; i < 100; i++)
            {
                Rig.Step(0.13f);
                Rig.Shoot(enemy, 100, depth: 1);
                Rig.Shoot(enemy, 100, DamageSource.Skill);
            }
            for (int i = 0; i < 30; i++)
            {
                Rig.Step(0.13f);
                Rig.Shoot(rig.Enemy(hp: 50), 100);
            }
            Assert.AreEqual(before, Blades().Count, "衍生伤害、技能、击杀的那一击都不触发");

            for (int i = 0; i < 100; i++) Rig.Shoot(enemy, 100);
            Assert.LessOrEqual(Blades().Count, before + 1, "两柄之间至少隔 0.12 秒");
        }

        [Test]
        public void ThousandBladeDamagesItsTargetAsAScrollProc()
        {
            var enemy = rig.Enemy(hp: 1000, offset: new Vector3(0, 0, 3), body: true);
            var blade = ThousandBladesScroll.Fire(Rig.Far + Vector3.up * 1.6f, enemy, 120);
            for (int i = 0; i < 30 && blade.Alive; i++) blade.Step(0.02f);
            Assert.AreEqual(1000 - 120, enemy.health, Eps, "命中目标，秘卷伤害不吃武器加成");
        }

        [Test]
        public void MidasHeartScalesWeaponDamageWithCoinsAndBleedsCoinsWhenHurt()
        {
            Assert.AreEqual(1f, MidasHeartScroll.WeaponMult(99), Eps);
            Assert.AreEqual(1.04f, MidasHeartScroll.WeaponMult(100), Eps);
            Assert.AreEqual(1.36f, MidasHeartScroll.WeaponMult(999), Eps);
            Assert.AreEqual(1.4f, MidasHeartScroll.WeaponMult(5000), Eps, "封顶 +40%");
            var run = RunState.Current = new RunState { coins = 250 };
            rig.Gain("midas_heart");
            Assert.AreEqual(0.5f, rig.Sheet.Get(Stat.CoinGainPct), Eps);
            var enemy = rig.Enemy();
            Assert.AreEqual(108, Rig.Shoot(enemy, 100).total, Eps);
            Assert.AreEqual(100, Rig.Shoot(enemy, 100, DamageSource.Skill).total, Eps, "只加武器伤害");
            rig.Hurt(5);
            Assert.AreEqual(247, run.coins, "受伤损失 3 灵石");
            rig.Hurt(5);
            Assert.AreEqual(247, run.coins, "0.5 秒内最多一次");
            Rig.Step(0.51f);
            rig.Hurt(5);
            Assert.AreEqual(244, run.coins);
            run.coins = 2;
            Rig.Step(0.51f);
            rig.Hurt(5);
            Assert.AreEqual(0, run.coins, "不够就扣光");
            Rig.Step(0.51f);
            rig.Hurt(5);
            Assert.AreEqual(0, run.coins, "不会扣成负数");
            Assert.AreEqual(3, rig.Procs("midas_heart"), "扣到灵石才弹字");
        }

        [Test]
        public void BloodPactAndOverdriveAreStatTradeoffs()
        {
            rig.Gain("blood_pact");
            Assert.AreEqual(0.04f, rig.Sheet.Get(Stat.Lifesteal), Eps);
            Assert.AreEqual(6, rig.Sheet.Get(Stat.KillHeal), Eps);
            Assert.AreEqual(10, rig.Player.MaxShield, Eps, "护盾上限 50 − 40");
            Assert.AreEqual(10, rig.Player.shield, Eps, "当前护盾截到新上限");
            rig.Gain("overdrive");
            Assert.AreEqual(0.35f, rig.Sheet.Get(Stat.FireRatePct), Eps);
            Assert.AreEqual(0.5f, rig.Sheet.Get(Stat.MagPct), Eps);
            Assert.AreEqual(-0.3f, rig.Sheet.Get(Stat.ReloadSpeedPct), Eps);
            var preview = Rig.Def("overdrive").PreviewStats(1);
            CollectionAssert.AreEquivalent(new[] { Stat.FireRatePct, Stat.MagPct, Stat.ReloadSpeedPct }, preview.Select(p => p.stat));
            rig.inv.Remove("blood_pact");
            Assert.AreEqual(50, rig.Player.MaxShield, Eps);
        }

        // ───────────── 英雄专属 ─────────────

        [Test]
        public void FoxResonanceRefundsTheTailAfterTheGrenade()
        {
            rig.Gain("fox_resonance", 2);
            Assert.AreEqual(0.2f, rig.Sheet.Get(Stat.FireDamagePct), Eps);
            GameEvents.RaiseSkillUsed(SkillSlot.Secondary, "fox_blaze_grenade");
            Assert.AreEqual(3f, rig.hero.primary.recharge, Eps, "Q 每层回 1.5 秒");
            Assert.AreEqual(0f, rig.hero.secondary.recharge, Eps, "E 自己不回");
            GameEvents.RaiseSkillUsed(SkillSlot.Primary, "fox_nine_tails");
            Assert.AreEqual(3f, rig.hero.primary.recharge, Eps, "放 Q 不触发");
            Assert.AreEqual(1, rig.Procs("fox_resonance"));
        }

        [Test]
        public void FalconSkyAddsCritOnlyWhileAirborne()
        {
            rig.Gain("falcon_sky", 3);
            Assert.AreEqual(0.3f, rig.Sheet.Get(Stat.ShockDamagePct), Eps);
            Rig.Step(0.02f);
            Assert.AreEqual(0.05f, rig.Sheet.Get(Stat.CritChance), Eps, "站在地上不加");
            rig.motor.Core.touching = false;
            Rig.Step(0.02f);
            Assert.AreEqual(0.05f + 0.18f, rig.Sheet.Get(Stat.CritChance), Eps, "滞空每层 +6%");
            rig.motor.Core.touching = true;
            Rig.Step(0.02f);
            Assert.AreEqual(0.05f, rig.Sheet.Get(Stat.CritChance), Eps, "落地撤掉");
        }

        [Test]
        public void BearMountainAddsShieldAndReducesDamageWhileItHolds()
        {
            var p = rig.Player;
            rig.Gain("bear_mountain");
            Assert.AreEqual(65, p.MaxShield, Eps);
            Assert.AreEqual(65, p.shield, Eps, "获得时补充 15 护盾");
            Assert.AreEqual(9.4f, rig.Hurt(10), Eps, "护盾在：−6%");
            p.shield = 0;
            Assert.AreEqual(10, rig.Hurt(10), Eps, "护盾破了不减");
            rig.Gain("bear_mountain");
            Assert.AreEqual(15, p.shield, Eps, "第二层只补这一层的 15");
            Assert.AreEqual(8.8f, rig.Hurt(10), Eps, "2 层 −12%");
        }
    }
}
