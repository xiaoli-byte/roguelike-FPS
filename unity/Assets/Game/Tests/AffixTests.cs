using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// AF1：词条框架（注册、准入、重新过滤、稀有度放大、perHit 归一、数量、传说特性位置、文本）与数值 15 条，对照 TS src/weapons/Affixes.ts。
    /// 触发 / 传说（AF2 / AF3）加进注册表后这些测试照样成立：只看数值类、或用自带的测试词条池。
    /// </summary>
    public sealed class AffixTests
    {
        /// <summary>TS AFFIXES 里的数值 15 条：id、min、max、权重、固定</summary>
        static readonly (string id, float min, float max, float weight, bool isFixed)[] Ts =
        {
            ("dmg", 0.08f, 0.15f, 12, false), ("rate", 0.08f, 0.15f, 10, false), ("mag", 0.2f, 0.4f, 9, false),
            ("reload", 0.15f, 0.3f, 9, false), ("critDmg", 0.15f, 0.35f, 8, false), ("critChance", 0.04f, 0.08f, 7, false),
            ("elemChance", 0.06f, 0.14f, 8, false), ("spread", 0.2f, 0.35f, 6, false), ("recoil", 0.25f, 0.4f, 5, false),
            ("pierce", 1f, 1f, 4, true), ("blast", 0.15f, 0.3f, 7, false), ("projSpeed", 0.2f, 0.4f, 5, false),
            ("reserve", 0.25f, 0.5f, 6, false), ("hunter", 0.12f, 0.25f, 6, false), ("swift", 0.4f, 0.8f, 4, false),
        };

        static WeaponDef Def(string id)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return d;
        }

        static List<AffixDef> Numeric() => AffixLibrary.All.Where(a => a.Kind == AffixKind.Numeric).ToList();

        [Test]
        public void FifteenNumericAffixesRegisteredInTsOrder()
        {
            var numeric = Numeric();
            CollectionAssert.AreEqual(Ts.Select(t => t.id).ToArray(), numeric.Select(a => a.id).ToArray(), "数值 15 条，顺序同 TS AFFIXES");
            foreach (var t in Ts)
            {
                var a = AffixLibrary.Get(t.id);
                Assert.AreEqual(t.min, a.min, 1e-6f, t.id);
                Assert.AreEqual(t.max, a.max, 1e-6f, t.id);
                Assert.AreEqual(t.weight, a.weight, 1e-6f, t.id);
                Assert.AreEqual(t.isFixed, a.isFixed, t.id);
                Assert.IsFalse(a.perHit, $"{t.id}：数值类不是 perHit");
                Assert.IsFalse(AffixLibrary.IsLegendary(t.id));
            }
            Assert.IsNotNull(AffixLibrary.Get("hunter").Effect, "猎首带输出修饰");
        }

        [Test]
        public void TextsMatchTs()
        {
            var w = Def("smg");
            Assert.AreEqual("伤害 +12%", AffixText.Describe(w, new WeaponAffix("dmg", 0.12f)));
            Assert.AreEqual("射速 +9%", AffixText.Describe(w, new WeaponAffix("rate", 0.09f)));
            Assert.AreEqual("弹匣容量 +35%", AffixText.Describe(w, new WeaponAffix("mag", 0.35f)));
            Assert.AreEqual("换弹速度 +20%", AffixText.Describe(w, new WeaponAffix("reload", 0.2f)));
            Assert.AreEqual("暴击伤害 +29%", AffixText.Describe(w, new WeaponAffix("critDmg", 0.29f)));
            Assert.AreEqual("暴击率 +6%", AffixText.Describe(w, new WeaponAffix("critChance", 0.06f)));
            Assert.AreEqual("元素触发率 +13%", AffixText.Describe(w, new WeaponAffix("elemChance", 0.13f)));
            Assert.AreEqual("散布 −30%", AffixText.Describe(w, new WeaponAffix("spread", 0.3f)));
            Assert.AreEqual("后坐力 −40%", AffixText.Describe(w, new WeaponAffix("recoil", 0.4f)));
            Assert.AreEqual("穿透 +1", AffixText.Describe(w, new WeaponAffix("pierce", 1f)));
            Assert.AreEqual("爆炸范围 +22%", AffixText.Describe(w, new WeaponAffix("blast", 0.22f)));
            Assert.AreEqual("弹速 +40%", AffixText.Describe(w, new WeaponAffix("projSpeed", 0.4f)));
            Assert.AreEqual("备弹上限 +50%", AffixText.Describe(w, new WeaponAffix("reserve", 0.5f)));
            Assert.AreEqual("对首领与精英伤害 +18%", AffixText.Describe(w, new WeaponAffix("hunter", 0.18f)));
            Assert.AreEqual("持握时移动速度 +0.6", AffixText.Describe(w, new WeaponAffix("swift", 0.6f)));
            Assert.AreEqual("持握时移动速度 +1.0", AffixText.Describe(w, new WeaponAffix("swift", 1f)));
            Assert.IsNull(AffixText.Describe(w, new WeaponAffix("no_such_affix", 1f)), "未知词条返回 null");
        }

        static HashSet<string> AllowedNumeric(string weapon, Element element)
        {
            var def = Def(weapon);
            var ctx = new AffixContext(def, element, def.innate.Select(a => a.id).ToList());
            return new HashSet<string>(Numeric().Where(a => a.Allow(ctx)).Select(a => a.id));
        }

        [Test]
        public void EligibilityMatchesTs()
        {
            string[] any = { "dmg", "rate", "critDmg", "critChance", "hunter", "swift" };
            string[] gun = { "mag", "reload", "reserve" };
            void Expect(string weapon, Element e, params string[] extra)
            {
                var expected = new HashSet<string>(any.Concat(gun).Concat(extra));
                var got = AllowedNumeric(weapon, e);
                Assert.IsTrue(expected.SetEquals(got), $"{weapon}/{e}：期望 [{string.Join(",", expected.OrderBy(x => x))}] 实际 [{string.Join(",", got.OrderBy(x => x))}]");
            }
            // 命中扫描：散布、后坐、穿透；有元素才有元素率
            Expect("revolver", Element.None, "spread", "recoil", "pierce");
            Expect("revolver", Element.Fire, "spread", "recoil", "pierce", "elemChance");
            Expect("smg", Element.None, "spread", "recoil", "pierce");
            Expect("shotgun", Element.Shock, "spread", "recoil", "pierce", "elemChance");
            // 光束：不是命中扫描（没有散布 / 穿透），也没有后坐
            Expect("beam", Element.Shock, "elemChance");
            // 爆炸投射物：爆炸范围、弹速、后坐；没有散布 / 穿透
            Expect("launcher", Element.Fire, "recoil", "blast", "projSpeed", "elemChance");
            Expect("stormpod", Element.Corrode, "recoil", "blast", "projSpeed", "elemChance");
        }

        [Test]
        public void CountByRarityInnateFirstNoDuplicates()
        {
            var rng = new System.Random(3);
            foreach (var weapon in new[] { "smg", "stormpod", "beam" })
            {
                var def = Def(weapon);
                for (int rarity = 0; rarity < Rarity.Count; rarity++)
                    for (int i = 0; i < 200; i++)
                    {
                        var list = AffixRoll.Roll(def, rarity, def.element, rng);
                        for (int k = 0; k < def.innate.Length; k++)
                        {
                            Assert.AreEqual(def.innate[k].id, list[k].id, $"{weapon}：固有词条排最前");
                            Assert.AreEqual(def.innate[k].value, list[k].value, $"{weapon}：固有词条原值，不放大");
                        }
                        int rolled = list.Skip(def.innate.Length).Count(a => !AffixLibrary.IsLegendary(a.id));
                        Assert.AreEqual(AffixRules.Count[rarity], rolled, $"{weapon} {Rarity.Name(rarity)}：词条数");
                        Assert.AreEqual(list.Count, list.Select(a => a.id).Distinct().Count(), $"{weapon}：同 id 不会抽两次");
                        int lg = list.Count(a => AffixLibrary.IsLegendary(a.id));
                        Assert.LessOrEqual(lg, rarity == Rarity.Legendary ? 1 : 0, "传说特性最多一条，且只在传说品质");
                        if (lg == 1) Assert.IsTrue(AffixLibrary.IsLegendary(list[list.Count - 1].id), "传说特性排最后");
                    }
            }
            CollectionAssert.AreEqual(new[] { 0, 1, 1, 2, 3 }, AffixRules.Count);
        }

        [Test]
        public void ValuesScaleWithRarityAndRound()
        {
            var rng = new System.Random(17);
            var def = Def("smg");
            for (int rarity = 1; rarity < Rarity.Count; rarity++)
            {
                float scale = AffixRules.RarityScale(rarity);
                for (int i = 0; i < 400; i++)
                    foreach (var a in AffixRoll.Roll(def, rarity, Element.Fire, rng))
                    {
                        var d = AffixLibrary.Get(a.id);
                        if (d == null || d.Kind != AffixKind.Numeric) continue;
                        if (d.isFixed)
                        {
                            Assert.AreEqual(d.min, a.value, $"{a.id}：固定值不放大");
                            continue;
                        }
                        float step = a.id == "swift" ? 0.1f : 0.01f;
                        Assert.GreaterOrEqual(a.value, d.min * scale - step * 0.51f, $"{a.id} {Rarity.Name(rarity)}");
                        Assert.LessOrEqual(a.value, d.max * scale + step * 0.51f, $"{a.id} {Rarity.Name(rarity)}");
                        float units = a.value / step;
                        Assert.AreEqual(Mathf.Round(units), units, 1e-3f, $"{a.id}：取整到 {step}");
                    }
            }
            Assert.AreEqual(1f, AffixRules.RarityScale(Rarity.Common));
            Assert.AreEqual(1f, AffixRules.RarityScale(Rarity.Uncommon));
            Assert.AreEqual(1.15f, AffixRules.RarityScale(Rarity.Rare), 1e-6f);
            Assert.AreEqual(1.3f, AffixRules.RarityScale(Rarity.Epic), 1e-6f);
            Assert.AreEqual(1.45f, AffixRules.RarityScale(Rarity.Legendary), 1e-6f);
        }

        [Test]
        public void FirstPickFollowsWeights()
        {
            var def = Def("smg");
            var ctx = new AffixContext(def, Element.None, def.innate.Select(a => a.id).ToList());
            var pool = AffixLibrary.Rollable().Where(a => a.Allow(ctx)).ToList();
            float total = pool.Sum(a => a.weight);
            const int n = 40000;
            var rng = new System.Random(21);
            var counts = new Dictionary<string, int>();
            for (int i = 0; i < n; i++)
            {
                var id = AffixRoll.Roll(def, Rarity.Uncommon, Element.None, rng).Last().id;
                counts[id] = counts.TryGetValue(id, out var c) ? c + 1 : 1;
            }
            foreach (var a in pool)
                Assert.AreEqual(a.weight / total, (counts.TryGetValue(a.id, out var c) ? c : 0) / (float)n, 0.01f, $"{a.id} 的出现率");
            Assert.IsFalse(counts.ContainsKey("blast"), "冲锋枪抽不到爆炸范围");
        }

        // ── 测试用词条（不在注册表里） ──

        sealed class TestPerHit : AffixDef
        {
            public TestPerHit() : base("subTest", 0.1f, 0.18f, 1, perHit: true) { }
            public override string Text(WeaponDef weapon, float v) => $"命中时 {AffixText.Pct(v)} 几率附加测试";
        }

        sealed class TestReactive : AffixDef
        {
            public TestReactive() : base("rxnTest", 0.1f, 0.2f, 1000) { }
            public override string Text(WeaponDef weapon, float v) => "反应";
            public override bool Allow(in AffixContext c) => AffixRules.CanReact(c);
        }

        sealed class TestLegendary : LegendaryDef
        {
            readonly bool allow;
            public TestLegendary(string id, string name, bool allow) : base(id, name) => this.allow = allow;
            public override float Value(WeaponDef weapon) => weapon.ShotsPerSecond() >= 8 ? 6 : 5;
            public override string Text(WeaponDef weapon, float v) => $"每第 {Mathf.RoundToInt(v)} {AffixText.ShotUnit(weapon)}必定暴击";
            public override bool Allow(in AffixContext c) => allow;
        }

        [Test]
        public void PerHitNormalisation()
        {
            var smg = Def("smg");
            Assert.AreEqual(13f, AffixRules.HitsPerSecond(smg), 1e-4f);
            Assert.AreEqual(1.4f * 9f, AffixRules.HitsPerSecond(Def("shotgun")), 1e-4f, "霰弹：每秒发数 × 弹丸");
            Assert.AreEqual(0.1f * 3.5f / 13f, AffixRules.PerHitChance(smg, 0.1f), 1e-6f);
            Assert.AreEqual(0.75f, AffixRules.PerHitChance(Def("launcher"), 0.261f), 1e-6f, "上限 75%");
            Assert.AreEqual(0.02f, AffixRules.PerHitChance(Def("beam"), 0.01f), 1e-6f, "下限 2%");

            var pool = new AffixDef[] { new TestPerHit() };
            var rng = new System.Random(8);
            var revolver = Def("revolver");
            for (int i = 0; i < 300; i++)
            {
                var a = AffixRoll.Roll(revolver, Rarity.Epic, Element.None, rng, pool, null).Single();
                float lo = AffixRules.PerHitChance(revolver, 0.1f * 1.3f), hi = AffixRules.PerHitChance(revolver, 0.18f * 1.3f);
                Assert.GreaterOrEqual(a.value, lo - 0.0051f);
                Assert.LessOrEqual(a.value, hi + 0.0051f, "原始值 × 稀有度 × 3.5 ÷ 每秒命中数");
            }
        }

        [Test]
        public void RefiltersAfterEachPick()
        {
            // 无元素的左轮：「反应」类一开始不准入；抽到 sub 开头的词条后解锁，下一条就抽到它（权重 1000）
            var pool = new AffixDef[] { new TestReactive(), new TestPerHit() };
            var list = AffixRoll.Roll(Def("revolver"), Rarity.Legendary, Element.None, new System.Random(1), pool, null);
            CollectionAssert.AreEqual(new[] { "subTest", "rxnTest" }, list.Select(a => a.id).ToArray());
            // 带元素时「反应」直接准入
            var fire = AffixRoll.Roll(Def("revolver"), Rarity.Uncommon, Element.Fire, new System.Random(1), pool, null);
            Assert.AreEqual("rxnTest", fire.Single().id);
        }

        [Test]
        public void LegendaryAppendedWithPrefix()
        {
            var lgs = new LegendaryDef[] { new TestLegendary("lg_test", "测试", true), new TestLegendary("lg_never", "不准", false) };
            var pool = AffixLibrary.Rollable();
            var smg = Def("smg");
            for (int i = 0; i < 50; i++)
            {
                var list = AffixRoll.Roll(smg, Rarity.Legendary, Element.None, new System.Random(i), pool, lgs);
                Assert.AreEqual("lg_test", list.Last().id, "传说特性在最后，不准入的不出现");
                Assert.AreEqual(6f, list.Last().value, "特性数值由武器决定（冲锋枪每秒 13 发 → 6）");
                Assert.AreEqual(AffixRules.Count[Rarity.Legendary], list.Count - 1);
                var epic = AffixRoll.Roll(smg, Rarity.Epic, Element.None, new System.Random(i), pool, lgs);
                Assert.IsFalse(epic.Any(a => a.id.StartsWith("lg_")), "史诗没有传说特性");
            }
            Assert.AreEqual("【传说·测试】每第 6 发必定暴击", AffixText.Format(lgs[0], smg, 6));
            Assert.AreEqual("每第 5 跳必定暴击", lgs[0].Text(Def("beam"), 5));
            Assert.AreEqual("测试·赤铜左轮", AffixText.DisplayName("赤铜左轮", "测试"));
            Assert.AreEqual("赤铜左轮", AffixText.DisplayName("赤铜左轮", null));
        }

        [Test]
        public void HunterOnlyOnBossAndEliteWeaponDamage()
        {
            var weapon = new DamageInfo { tags = DamageTag.Weapon, weaponUid = 1 };
            Assert.AreEqual(1.2f, Affix_Hunter.Mult(0.2f, Rank.Boss, weapon), 1e-6f);
            Assert.AreEqual(1.2f, Affix_Hunter.Mult(0.2f, Rank.Elite, weapon), 1e-6f);
            Assert.AreEqual(1f, Affix_Hunter.Mult(0.2f, Rank.Normal, weapon), "普通敌人不加");
            var blast = new DamageInfo { tags = DamageTag.Weapon | DamageTag.Explosion, weaponUid = 1 };
            Assert.AreEqual(1.2f, Affix_Hunter.Mult(0.2f, Rank.Boss, blast), 1e-6f, "武器投射物的爆炸也吃");
            var reaction = new DamageInfo { tags = DamageTag.Weapon | DamageTag.Reaction, weaponUid = 1 };
            Assert.AreEqual(1f, Affix_Hunter.Mult(0.2f, Rank.Boss, reaction), "反应伤害不吃");
            var dot = new DamageInfo { tags = DamageTag.Dot, weaponUid = 1 };
            Assert.AreEqual(1f, Affix_Hunter.Mult(0.2f, Rank.Boss, dot), "持续伤害不吃");
            var skill = new DamageInfo { tags = DamageTag.Skill };
            Assert.AreEqual(1f, Affix_Hunter.Mult(0.2f, Rank.Boss, skill), "技能伤害不吃");
        }

        [Test]
        public void RolledAffixesFeedTheResolver()
        {
            var rng = new System.Random(77);
            for (int i = 0; i < 300; i++)
            {
                var w = WeaponRoller.Roll(new WeaponRoller.RollOptions { rarity = Rarity.Legendary, useNoStats = true }, rng);
                var r = WeaponStatsResolver.Resolve(w, null);
                Assert.AreEqual(WeaponLibrary.RarityDamage[4] * (1 + w.AffixTotal("dmg")), r.damageMult, 1e-5f, w.def.id);
                Assert.AreEqual(w.def.fireRate * (1 + w.AffixTotal("rate")), r.fireRate, 1e-4f, w.def.id);
                Assert.AreEqual(w.def.critMult * (1 + w.AffixTotal("critDmg")), r.critMult, 1e-4f, w.def.id);
                Assert.AreEqual(w.AffixTotal("critChance"), r.critChance, 1e-6f);
                Assert.AreEqual(w.AffixTotal("hunter"), r.hunter, 1e-6f);
                Assert.AreEqual(w.AffixTotal("swift"), r.swift, 1e-6f);
                Assert.AreEqual(w.def.pierce + Mathf.RoundToInt(w.AffixTotal("pierce")), r.pierce);
                Assert.AreEqual(r.magCap, w.mag, "按含词条的容量装满");
                Assert.AreEqual(r.reserveCap, w.reserve);
                var name = WeaponLibrary.DisplayName(w);
                var lg = r.legendary != null ? AffixText.LegendaryName(r.legendary) : null;
                Assert.AreEqual(lg != null ? $"{lg}·{w.def.name}" : w.def.name, name, "传说前缀");
                Assert.IsTrue(w.Title.StartsWith(name));
            }
        }

        [Test]
        public void TraitsListNotesThenAffixes()
        {
            var w = new WeaponInstance(Def("stormpod"), Rarity.Epic);
            w.SetAffixes(new[] { new WeaponAffix("subShock", 0.4f), new WeaponAffix("dmg", 0.13f), new WeaponAffix("swift", 0.5f) });
            var traits = AffixText.Traits(w);
            var notes = w.def.notes;
            CollectionAssert.AreEqual(notes, traits.Take(notes.Length).ToArray(), "固有特性在最前");
            var rest = traits.Skip(notes.Length).ToList();
            CollectionAssert.IsSubsetOf(new[] { "伤害 +13%", "持握时移动速度 +0.5" }, rest);
            Assert.AreEqual("伤害 +13%", rest[rest.Count - 2]);
            Assert.AreEqual("持握时移动速度 +0.5", rest[rest.Count - 1]);
        }
    }
}
