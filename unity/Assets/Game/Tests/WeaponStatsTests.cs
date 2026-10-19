using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// W2：武器数值解析（WeaponStatsResolver）、掷骰（WeaponRoller）、强化费用、武器奖励串。
    /// 回归基准：W2 之前 WeaponController 内联的公式（Legacy*），现有 6 把在今天的品质 / 强化下必须一分不差。
    /// </summary>
    public sealed class WeaponStatsTests
    {
        static readonly string[] Current = { "revolver", "smg", "shotgun", "launcher", "beam", "stormpod" };

        static WeaponDef Def(string id)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return d;
        }

        // ── W2 之前 WeaponController 的内联公式 ──
        static float LegacyDamage(WeaponInstance w) => w.def.damage * w.DamageMult;
        static float LegacyFireRate(WeaponDef d, StatSheet s) => d.fireRate * (s?.Mult(Stat.FireRatePct) ?? 1);
        /// <summary>
        /// 弹匣：W2 之前是 Mathf.RoundToInt（银行家舍入），W2 改成 TS 的 Math.round（.5 进位）——只在恰好 .5 时不同，
        /// 例如青冥雷蛊 5 × 百宝囊 3 层 1.3 = 6.5：以前 6，现在 7（同 Three.js）。没有弹匣加成时两者完全一样
        /// </summary>
        static int LegacyMag(WeaponDef d, StatSheet s) => WeaponStatsResolver.RoundHalfUp(d.mag * (s?.Mult(Stat.MagPct) ?? 1));
        static float LegacyReload(WeaponDef d, StatSheet s) => d.reloadTime / (s?.Mult(Stat.ReloadSpeedPct) ?? 1);
        static float LegacyShell(WeaponDef d, StatSheet s) => d.shellTime / (s?.Mult(Stat.ReloadSpeedPct) ?? 1);
        static float LegacyReloadStart(WeaponDef d, StatSheet s) => d.reloadStart / (s?.Mult(Stat.ReloadSpeedPct) ?? 1);
        static float LegacyElementChance(WeaponDef d) => d.element != Element.None ? d.elementChance : 0;

        /// <summary>「一分不差」：只容许 float 中间精度带来的相对 1e-6 误差</summary>
        static void Same(float expected, float actual, string msg) => Assert.AreEqual(expected, actual, Mathf.Max(1e-6f, Mathf.Abs(expected) * 1e-6f), msg);

        static StatSheet Sheet(float rate, float mag, float reload)
        {
            var s = StatSheet.Default();
            if (rate != 0) s.Add("test", Stat.FireRatePct, rate);
            if (mag != 0) s.Add("test", Stat.MagPct, mag);
            if (reload != 0) s.Add("test", Stat.ReloadSpeedPct, reload);
            return s;
        }

        [Test]
        public void CurrentSixWeaponsMatchLegacyNumbers()
        {
            var sheets = new[] { null, StatSheet.Default(), Sheet(0.07f, 0.1f, 0.1f), Sheet(0.21f, 0.3f, 0.5f), Sheet(0.28f, 0.2f, 0.3f) };
            foreach (var id in Current)
            {
                var def = Def(id);
                foreach (var s in sheets)
                    for (int rarity = 0; rarity < Rarity.Count; rarity++)
                        for (int level = 0; level <= WeaponLibrary.MaxUpgrade; level++)
                        {
                            var w = new WeaponInstance(def, rarity) { level = level };
                            var r = WeaponStatsResolver.Resolve(w, s);
                            string at = $"{id} 品质 {rarity} +{level} 属性 {(s == null ? "无" : s.Version.ToString())}";
                            Same(LegacyDamage(w), r.damage, $"{at}：伤害");
                            Same(LegacyFireRate(def, s), r.fireRate, $"{at}：射速");
                            Assert.AreEqual(LegacyMag(def, s), r.magCap, $"{at}：弹匣");
                            Assert.AreEqual(def.reserve, r.reserveCap, $"{at}：备弹");
                            Same(LegacyReload(def, s), r.reloadTime, $"{at}：换弹");
                            Same(LegacyShell(def, s), r.shellTime, $"{at}：逐发");
                            Same(LegacyReloadStart(def, s), r.reloadStart, $"{at}：逐发准备");
                            Same(def.critMult, r.critMult, $"{at}：暴击倍率");
                            Assert.AreEqual(0f, r.critChance, $"{at}：词条暴击率");
                            Same(LegacyElementChance(def), r.elementChance, $"{at}：元素率");
                            Assert.AreEqual(def.element, r.element, $"{at}：元素");
                            Same(1f, r.spreadMult, $"{at}：散布");
                            Same(1f, r.recoilMult, $"{at}：后坐");
                            Assert.AreEqual(def.pierce, r.pierce, $"{at}：穿透");
                            Same(def.projectile?.explosionRadius ?? 0, r.explosionRadius, $"{at}：爆炸半径");
                            Same(def.projectile?.speed ?? 0, r.projectileSpeed, $"{at}：弹速");
                            Assert.IsNull(r.legendary, $"{at}：传说");
                        }
            }
        }

        [Test]
        public void MagRoundingIsTsMathRound()
        {
            var s = StatSheet.Default();
            s.Add("bottomless", Stat.MagPct, 0.3f);
            Assert.AreEqual(7, WeaponStatsResolver.Resolve(new WeaponInstance(Def("stormpod")), s).magCap, "5 × 1.3 = 6.5 → 7（Math.round）");
            foreach (var id in Current)
                Assert.AreEqual(Def(id).mag, WeaponStatsResolver.Resolve(new WeaponInstance(Def(id)), StatSheet.Default()).magCap, $"{id}：没有加成时弹匣 = 定义");
        }

        [Test]
        public void FreshInstanceIsFullAndKeepsInnate()
        {
            foreach (var id in Current)
            {
                var def = Def(id);
                var w = new WeaponInstance(def);
                var r = WeaponStatsResolver.Resolve(w, null);
                Assert.AreEqual(r.magCap, w.mag, id);
                Assert.AreEqual(r.reserveCap, w.reserve, id);
                Assert.AreEqual(def.innate.Length, w.affixes.Count, $"{id}：固有词条原样放进实例");
            }
        }

        [Test]
        public void DpsMatchesTsFormula()
        {
            // TS：perShot = 伤害 × 弹丸 × 弹体；dps = perShot × 射速 × 点射数
            var shotgun = WeaponStatsResolver.Resolve(new WeaponInstance(Def("shotgun")), null);
            Assert.AreEqual(12f * 9f, shotgun.perShot, 1e-4f);
            Assert.AreEqual(12f * 9f * 1.4f, shotgun.dps, 1e-3f);
            var smg = WeaponStatsResolver.Resolve(new WeaponInstance(Def("smg"), Rarity.Rare) { level = 2 }, null);
            Assert.AreEqual(11f * 1.35f * 1.24f * 13f, smg.dps, 1e-2f);
        }

        [Test]
        public void AffixTotalsFollowTsFormulas()
        {
            var def = Def("smg");
            var w = new WeaponInstance(def, Rarity.Epic);
            w.SetAffixes(new[]
            {
                new WeaponAffix(AffixIds.Dmg, 0.1f), new WeaponAffix(AffixIds.Dmg, 0.05f), new WeaponAffix(AffixIds.Rate, 0.12f),
                new WeaponAffix(AffixIds.Mag, 0.3f), new WeaponAffix(AffixIds.Reload, 0.2f), new WeaponAffix(AffixIds.CritDmg, 0.25f),
                new WeaponAffix(AffixIds.CritChance, 0.06f), new WeaponAffix(AffixIds.Spread, 0.3f), new WeaponAffix(AffixIds.Recoil, 0.4f),
                new WeaponAffix(AffixIds.Pierce, 1f), new WeaponAffix(AffixIds.Reserve, 0.5f), new WeaponAffix(AffixIds.Hunter, 0.2f),
                new WeaponAffix(AffixIds.Swift, 0.6f), new WeaponAffix("lg_nth", 6f),
            });
            var r = WeaponStatsResolver.Resolve(w, null);
            Assert.AreEqual(1.6f * 1.15f, r.damageMult, 1e-5f, "伤害倍率 = 品质 × (1 + 词条之和)");
            Assert.AreEqual(def.damage * 1.6f * 1.15f, r.damage, 1e-4f);
            Assert.AreEqual(def.fireRate * 1.12f, r.fireRate, 1e-4f);
            Assert.AreEqual(WeaponStatsResolver.RoundHalfUp(def.mag * 1.3f), r.magCap);
            Assert.AreEqual(def.reloadTime / 1.2f, r.reloadTime, 1e-5f);
            Assert.AreEqual(def.critMult * 1.25f, r.critMult, 1e-5f);
            Assert.AreEqual(0.06f, r.critChance, 1e-6f);
            Assert.AreEqual(0.7f, r.spreadMult, 1e-5f);
            Assert.AreEqual(0.6f, r.recoilMult, 1e-5f);
            Assert.AreEqual(def.pierce + 1, r.pierce);
            Assert.AreEqual(WeaponStatsResolver.RoundHalfUp(def.reserve * 1.5f), r.reserveCap);
            Assert.AreEqual(0.2f, r.hunter, 1e-6f);
            Assert.AreEqual(0.6f, r.swift, 1e-6f);
            Assert.AreEqual("lg_nth", r.legendary);
            Assert.AreEqual(6f, r.legendaryValue);
            Assert.AreEqual(0f, r.elementChance, "无元素实例的元素率是 0（元素率词条也不起作用）");

            // 元素率：有元素时 = 定义 + 词条，上限 1
            w.element = Element.Fire;
            w.AddAffix(new WeaponAffix(AffixIds.ElemChance, 0.1f));
            r = WeaponStatsResolver.Resolve(w, null);
            Assert.AreEqual(Mathf.Min(1, def.elementChance + 0.1f), r.elementChance, 1e-6f);

            // 爆炸武器：半径吃玩家爆炸范围与词条；弹速吃玩家弹速与词条
            var launcher = new WeaponInstance(Def("launcher"));
            launcher.SetAffixes(new[] { new WeaponAffix(AffixIds.Blast, 0.2f), new WeaponAffix(AffixIds.ProjSpeed, 0.3f) });
            var s = StatSheet.Default();
            s.Add("test", Stat.ExplosionRadiusPct, 0.25f);
            s.Add("test", Stat.ProjectileSpeedPct, 0.1f);
            var lr = WeaponStatsResolver.Resolve(launcher, s);
            Assert.AreEqual(4f * 1.25f * 1.2f, lr.explosionRadius, 1e-4f);
            Assert.AreEqual(34f * 1.1f * 1.3f, lr.projectileSpeed, 1e-3f);
        }

        [Test]
        public void ClampsFollowTs()
        {
            var w = new WeaponInstance(Def("revolver"));
            w.SetAffixes(new[] { new WeaponAffix(AffixIds.Spread, 0.95f), new WeaponAffix(AffixIds.Recoil, 1.5f) });
            var s = StatSheet.Default();
            s.Add("test", Stat.ReloadSpeedPct, -0.9f);
            var r = WeaponStatsResolver.Resolve(w, s);
            Assert.AreEqual(WeaponStatsResolver.MinSpreadMult, r.spreadMult, 1e-6f, "散布倍率下限 0.1");
            Assert.AreEqual(0f, r.recoilMult, 1e-6f, "后坐倍率下限 0");
            Assert.AreEqual(1.6f / WeaponStatsResolver.MinReloadMult, r.reloadTime, 1e-5f, "换弹倍率下限 0.25");
        }

        [Test]
        public void CacheInvalidatesOnInstanceAndStatChanges()
        {
            var w = new WeaponInstance(Def("revolver"));
            var s = StatSheet.Default();
            var a = WeaponStatsResolver.Resolve(w, s);
            Assert.AreSame(a, WeaponStatsResolver.Resolve(w, s), "没变化时返回同一份缓存");
            float d0 = a.damage;
            w.level = 2;
            Assert.AreEqual(d0 * 1.24f, WeaponStatsResolver.Resolve(w, s).damage, 1e-4f, "强化后重算");
            float r0 = WeaponStatsResolver.Resolve(w, s).fireRate;
            s.Add("scroll", Stat.FireRatePct, 0.5f);
            Assert.AreEqual(r0 * 1.5f, WeaponStatsResolver.Resolve(w, s).fireRate, 1e-4f, "属性版本变了重算");
            w.rarity = Rarity.Legendary;
            Assert.AreEqual(3.5f * 1.5f, WeaponStatsResolver.Resolve(w, s).fireRate, 1e-4f);
            Assert.AreEqual(38f * 1.9f * 1.24f, WeaponStatsResolver.Resolve(w, s).damage, 1e-3f, "改品质后重算");
            Assert.AreEqual(3.5f, WeaponStatsResolver.Resolve(w, null).fireRate, 1e-5f, "换一张属性表（null）也重算");
        }

        [Test]
        public void UpgradeCostMatchesTs()
        {
            var w = new WeaponInstance(Def("smg"));
            Assert.AreEqual(50, WeaponLibrary.UpgradeCost(w, 0));
            Assert.AreEqual(80, WeaponLibrary.UpgradeCost(w, 2));
            w.level = 1;
            Assert.AreEqual(130, WeaponLibrary.UpgradeCost(w, 1));
            w.level = 4;
            Assert.AreEqual(250, WeaponLibrary.UpgradeCost(w, 0));
            Assert.AreEqual(250, WeaponLibrary.UpgradeCost(w, -3), "负章节按 0");
            Assert.IsTrue(WeaponLibrary.Upgrade(w));
            Assert.AreEqual(WeaponLibrary.MaxUpgrade, w.level);
            Assert.IsNull(WeaponLibrary.UpgradeCost(w, 0), "满级没有费用");
            Assert.IsFalse(WeaponLibrary.Upgrade(w), "满级不再升");
            Assert.AreEqual(WeaponLibrary.MaxUpgrade, w.level);
        }

        // ── 掷骰 ──

        static int[] RarityHistogram(int chapter, int min, float luck, int n, int seed)
        {
            var rng = new System.Random(seed);
            var h = new int[Rarity.Count];
            for (int i = 0; i < n; i++) h[WeaponRoller.RollRarity(chapter, min, luck, rng)]++;
            return h;
        }

        [Test]
        public void RarityDistributionMatchesChapterTables()
        {
            const int n = 100000;
            for (int ch = 0; ch < WeaponRoller.ChapterRarity.Length; ch++)
            {
                var row = WeaponRoller.ChapterRarity[ch];
                float total = 0;
                foreach (var x in row) total += x;
                var h = RarityHistogram(ch, 0, 0, n, 1234 + ch);
                for (int r = 0; r < Rarity.Count; r++)
                    Assert.AreEqual(row[r] / total, h[r] / (float)n, 0.01f, $"第 {ch + 1} 章 {Rarity.Name(r)}");
            }
            // 超出表的章节按最后一章
            Assert.AreEqual(WeaponRoller.RarityWeight(2, 3, 0), WeaponRoller.RarityWeight(7, 3, 0));
        }

        [Test]
        public void MinRarityAndLuck()
        {
            var h = RarityHistogram(0, Rarity.Epic, 0, 20000, 7);
            Assert.AreEqual(0, h[0] + h[1] + h[2], "保底史诗：不会出更低的");
            Assert.AreEqual(2f / 2.4f, h[3] / 20000f, 0.015f, "保底后按剩余权重分（史诗 2 : 传说 0.4）");

            Assert.AreEqual(Rarity.Legendary, WeaponRoller.RollRarity(0, Rarity.Legendary, 0, new System.Random(1)));

            double Mean(int[] hist)
            {
                double sum = 0, cnt = 0;
                for (int i = 0; i < hist.Length; i++)
                {
                    sum += i * hist[i];
                    cnt += hist[i];
                }
                return sum / cnt;
            }
            var noLuck = RarityHistogram(0, 0, 0, 20000, 11);
            var luck5 = RarityHistogram(0, 0, 5, 20000, 11);
            Assert.Greater(Mean(luck5), Mean(noLuck) + 0.2, "幸运提高平均品质");
            Assert.Less(luck5[0], noLuck[0], "幸运压低普通");
            // 权重公式：普通 ÷ (1 + 0.12L)，其余 × (1 + 0.15·L·品质)
            Assert.AreEqual(58f / 1.6f, WeaponRoller.RarityWeight(0, 0, 5), 1e-4f);
            Assert.AreEqual(9f * (1 + 0.15f * 5 * 3), WeaponRoller.RarityWeight(1, 3, 5), 1e-4f);
        }

        [Test]
        public void RandomElementOnlyForUncommonPlusElementless()
        {
            var rng = new System.Random(99);
            var revolver = Def("revolver");
            for (int i = 0; i < 2000; i++) Assert.AreEqual(Element.None, WeaponRoller.RollElement(revolver, Rarity.Common, rng), "普通不掷随机元素");
            var launcher = Def("launcher");
            for (int i = 0; i < 200; i++) Assert.AreEqual(Element.Fire, WeaponRoller.RollElement(launcher, Rarity.Legendary, rng), "有元素的武器保持定义元素");

            const int n = 60000;
            var counts = new Dictionary<Element, int>();
            for (int i = 0; i < n; i++)
            {
                var e = WeaponRoller.RollElement(revolver, Rarity.Rare, rng);
                counts[e] = counts.TryGetValue(e, out var c) ? c + 1 : 1;
            }
            int withElement = n - (counts.TryGetValue(Element.None, out var none) ? none : 0);
            Assert.AreEqual(WeaponRoller.RandomElementChance, withElement / (float)n, 0.01f, "精良以上 35% 随机元素");
            foreach (var e in WeaponRoller.RandomElements)
                Assert.AreEqual(1f / 3f, counts[e] / (float)withElement, 0.02f, $"{e} 均分");
        }

        [Test]
        public void RollProducesValidFullInstances()
        {
            var rng = new System.Random(5);
            var seen = new HashSet<string>();
            for (int i = 0; i < 500; i++)
            {
                var w = WeaponRoller.Roll(new WeaponRoller.RollOptions { chapter = 1, minRarity = Rarity.Uncommon, useNoStats = true }, rng);
                Assert.IsNotNull(w);
                Assert.GreaterOrEqual(w.rarity, Rarity.Uncommon);
                var r = WeaponStatsResolver.Resolve(w, null);
                Assert.AreEqual(r.magCap, w.mag, "弹匣装满");
                Assert.AreEqual(r.reserveCap, w.reserve, "备弹装满");
                if (w.def.element != Element.None) Assert.AreEqual(w.def.element, w.element);
                Assert.GreaterOrEqual(w.affixes.Count, w.def.innate.Length);
                for (int k = 0; k < w.def.innate.Length; k++) Assert.AreEqual(w.def.innate[k].id, w.affixes[k].id, "固有词条排最前");
                seen.Add(w.def.id);
            }
            Assert.AreEqual(WeaponLibrary.All.Count, seen.Count, "500 次里每把都出现过（按掉落权重）");

            var fixedRoll = WeaponRoller.Roll(new WeaponRoller.RollOptions { id = "stormpod", rarity = 1, useNoStats = true }, rng);
            Assert.AreEqual("stormpod", fixedRoll.def.id);
            Assert.AreEqual(1, fixedRoll.rarity);
            Assert.AreEqual(Element.Corrode, fixedRoll.element);
        }

        // ── 奖励串 ──

        [Test]
        public void WeaponRewardStringsParse()
        {
            var a = WeaponReward.Parse(RewardRegistry.Split("weapon"));
            Assert.IsNull(a.id);
            Assert.IsFalse(a.rarity.HasValue);
            Assert.AreEqual(0, a.minRarity);

            var b = WeaponReward.Parse(RewardRegistry.Split("weapon:min=3"));
            Assert.IsNull(b.id);
            Assert.IsFalse(b.rarity.HasValue);
            Assert.AreEqual(3, b.minRarity);

            var c = WeaponReward.Parse(RewardRegistry.Split("weapon:beam"));
            Assert.AreEqual("beam", c.id);
            Assert.AreEqual(0, c.rarity, "旧写法：指定武器 = 普通品质");

            var d = WeaponReward.Parse(RewardRegistry.Split("weapon:stormpod:1"));
            Assert.AreEqual("stormpod", d.id);
            Assert.AreEqual(1, d.rarity);

            var e = WeaponReward.Parse(RewardRegistry.Split("weapon:revolver:min=2"));
            Assert.AreEqual("revolver", e.id);
            Assert.IsFalse(e.rarity.HasValue);
            Assert.AreEqual(2, e.minRarity);

            Assert.AreEqual(4, WeaponReward.Parse(RewardRegistry.Split("weapon:min=9")).minRarity, "保底夹到传说");

            var h = new WeaponReward();
            Assert.AreEqual("一把随机武器", h.Hint(RewardRegistry.Split("weapon")));
            Assert.AreEqual("一把史诗及以上品质的武器", h.Hint(RewardRegistry.Split("weapon:min=3")));
            Assert.AreEqual("一把传说品质的武器", h.Hint(RewardRegistry.Split("weapon:min=4")));
            Assert.IsNotNull(RewardRegistry.Get("upgrade"), "upgrade 奖励已注册");
            Assert.IsNotNull(RewardRegistry.Get("weapon"));
        }
    }
}
