using System.Linq;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// WC8：武器描述（同 TS src/weapons/Describe.ts）与拾取对比（同 TS weaponPrompt.ts 的 compareLine）。
    /// 属性表传 null = 没有任何加成（同 TS 的裸 resolveWeapon）。
    /// </summary>
    public sealed class WeaponDescriberTests
    {
        static WeaponInstance New(string id, int rarity = 0)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return new WeaponInstance(d, rarity);
        }

        static WeaponDescription Describe(string id, int rarity = 0) => WeaponDescriber.Describe(New(id, rarity), null);

        [Test]
        public void EveryWeaponAndRarityDescribes()
        {
            foreach (var def in WeaponLibrary.All)
            for (int r = 0; r < Rarity.Count; r++)
            {
                var d = WeaponDescriber.Describe(new WeaponInstance(def, r), null);
                Assert.IsNotNull(d, def.id);
                Assert.AreEqual(Rarity.Name(r), d.rarityName, def.id);
                StringAssert.EndsWith(def.name, d.name, def.id);
                Assert.IsNotNull(d.Stat("秒伤"), $"{def.id} 没有秒伤行");
                Assert.IsNotNull(d.Stat("暴击"), $"{def.id} 没有暴击行");
                Assert.AreEqual($"0/{WeaponLibrary.MaxUpgrade}", d.Stat("强化"), def.id);
                if (!def.IsBlade)
                    foreach (var label in new[] { "伤害", "射速", "弹匣", "备弹", "换弹", "元素" })
                        Assert.IsNotNull(d.Stat(label), $"{def.id} 没有「{label}」");
            }
        }

        [Test]
        public void SmgMatchesTsFormat()
        {
            var d = Describe("smg");
            Assert.AreEqual("蜂鸣冲锋枪", d.name);
            Assert.AreEqual("冲锋枪", d.category);
            Assert.AreEqual("11", d.Stat("伤害"));
            Assert.AreEqual("13.0 发/秒", d.Stat("射速"));
            Assert.AreEqual("约 143", d.Stat("秒伤"));
            Assert.AreEqual("36", d.Stat("弹匣"));
            Assert.AreEqual("252", d.Stat("备弹"));
            Assert.AreEqual("1.7 秒", d.Stat("换弹"));
            Assert.AreEqual("×2.0", d.Stat("暴击"));
            Assert.AreEqual("物理", d.Stat("元素"));
            Assert.IsNull(d.Stat("穿透"));
        }

        [Test]
        public void ModeSpecificLines()
        {
            var shotgun = Describe("shotgun");
            StringAssert.EndsWith(" ×9", shotgun.Stat("伤害"));
            StringAssert.EndsWith("秒/发", shotgun.Stat("换弹"), "逐发装填写每发耗时");

            StringAssert.Contains("连发）", Describe("burst").Stat("射速"));
            var beam = Describe("beam");
            StringAssert.EndsWith(" /跳", beam.Stat("伤害"));
            StringAssert.EndsWith("跳/秒", beam.Stat("射速"));
            StringAssert.EndsWith("能量", beam.Stat("弹匣"));

            var rail = Describe("railgun");
            StringAssert.Contains("–", rail.Stat("伤害"), "蓄力武器写伤害区间");
            StringAssert.StartsWith("蓄力 ", rail.Stat("射速"));

            var tri = Describe("trinity");
            Assert.AreEqual("三相", tri.elementLabel);
            StringAssert.StartsWith("三相轮转 ", tri.Stat("元素"));

            var blade = Describe("demon_blade");
            Assert.IsNotNull(blade.Stat("斩"));
            Assert.IsNotNull(blade.Stat("千刃出窍"));
            StringAssert.StartsWith("斩 约 ", blade.Stat("秒伤"));
            Assert.IsNotNull(blade.skill);
            Assert.IsTrue(blade.traits.Any(t => t.StartsWith("【武器技能·杀气爆发】")), "碎刃特性行写武器技能");
        }

        [Test]
        public void RarityScalesDamageAndDps()
        {
            var a = WeaponStatsResolver.Resolve(New("rifle", 0), null);
            var b = WeaponStatsResolver.Resolve(New("rifle", 4), null);
            Assert.AreEqual(WeaponLibrary.RarityDamage[4], b.dps / a.dps, 1e-3f);
            Assert.AreEqual($"约 {WeaponStatsResolver.RoundHalfUp(b.dps)}", Describe("rifle", 4).Stat("秒伤"));
        }

        [Test]
        public void NumberFormatsFollowTs()
        {
            Assert.AreEqual("8", WeaponDescriber.Num(8f));
            Assert.AreEqual("7.5", WeaponDescriber.Num(7.46f));
            Assert.AreEqual("13", WeaponDescriber.Num(12.5f));
            Assert.AreEqual("12%", WeaponDescriber.Pct(0.123f));
            Assert.AreEqual("13%", WeaponDescriber.Pct(0.125f));
        }

        [Test]
        public void CompareLineMarksBetterAndWorse()
        {
            Assert.AreEqual("伤害  23", WeaponDescriber.CompareLine("伤害", "23", null));
            Assert.AreEqual("伤害  23", WeaponDescriber.CompareLine("伤害", "23", "23"));
            Assert.AreEqual("伤害  23 ▲（当前 18）", WeaponDescriber.CompareLine("伤害", "23", "18"));
            Assert.AreEqual("伤害  12 ×9 ▼（当前 18 ×9）", WeaponDescriber.CompareLine("伤害", "12 ×9", "18 ×9"));
            Assert.AreEqual("换弹  1.5 秒 ▲（当前 2.0 秒）", WeaponDescriber.CompareLine("换弹", "1.5 秒", "2.0 秒"), "换弹越短越好");
            Assert.AreEqual("射速  蓄力 0.83 秒（当前 13.0 发/秒）", WeaponDescriber.CompareLine("射速", "蓄力 0.83 秒", "13.0 发/秒"), "格式不同不标记号");
            Assert.AreEqual("伤害  23（当前 12 ×9）", WeaponDescriber.CompareLine("伤害", "23", "12 ×9"), "单发对多弹丸不标记号");
        }

        [Test]
        public void CompareLinesAgainstHeldWeapon()
        {
            var better = Describe("smg", 3);
            var held = Describe("smg", 0);
            var lines = WeaponDescriber.CompareLines(better, held, true);
            Assert.IsTrue(lines.Any(l => l.StartsWith("伤害") && l.Contains("▲") && l.Contains("（当前 11）")), string.Join("\n", lines));
            Assert.IsFalse(lines.Any(l => l.StartsWith("强化")), "强化写在副标题里，不单列");
            Assert.IsFalse(lines.Any(l => l.StartsWith("元素")), "物理不列元素行");
            Assert.AreEqual("将替换当前武器：蜂鸣冲锋枪", lines[lines.Count - 1]);
            Assert.AreEqual("放入空槽位，保留蜂鸣冲锋枪", WeaponDescriber.CompareLines(better, held, false).Last());
            Assert.IsFalse(WeaponDescriber.CompareLines(better, null, true).Any(l => l.Contains("当前")), "没有手持武器时不对比");
        }

        [Test]
        public void DescriptionIsCachedUntilWeaponChanges()
        {
            var w = New("revolver");
            var a = WeaponDescriber.Describe(w, null);
            Assert.AreSame(a, WeaponDescriber.Describe(w, null));
            w.level = 2;
            var b = WeaponDescriber.Describe(w, null);
            Assert.AreNotSame(a, b);
            Assert.AreEqual("2/5", b.Stat("强化"));
        }
    }
}
