using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 冒烟：属性表的加减法（基础值 + 各来源修正之和，按来源整体撤销）。只用 SetBase / Add / Remove / Get，
    /// 不碰默认值、Mult 的下限、Changed 事件（W0-1 在改），保证测试程序集非空、bridge.sh tests 有东西可跑。
    /// </summary>
    public sealed class StatSheetTests
    {
        [Test]
        public void AddAndRemoveBySource()
        {
            var s = new StatSheet();
            s.SetBase(Stat.MaxHp, 100);
            s.Add("scroll", Stat.MaxHp, 50);
            s.Add("hero", Stat.MaxHp, 25);
            s.Add("hero", Stat.MaxShield, 10);
            Assert.AreEqual(175f, s.Get(Stat.MaxHp), 1e-4f);
            Assert.AreEqual(10f, s.Get(Stat.MaxShield), 1e-4f);

            s.Remove("scroll");
            Assert.AreEqual(125f, s.Get(Stat.MaxHp), 1e-4f, "撤销一个来源只去掉它自己的修正");

            s.Remove("hero");
            Assert.AreEqual(100f, s.Get(Stat.MaxHp), 1e-4f);
            Assert.AreEqual(0f, s.Get(Stat.MaxShield), 1e-4f, "没有基础值的属性修正撤完是 0");
        }

        [Test]
        public void SameSourceStacksAndRemovesTogether()
        {
            var s = new StatSheet();
            s.Add("playtest", Stat.DamagePct, 0.1f);
            s.Add("playtest", Stat.DamagePct, 0.15f);
            Assert.AreEqual(0.25f, s.Get(Stat.DamagePct), 1e-5f);
            s.Remove("playtest");
            s.Remove("playtest"); // 重复撤销不出错
            Assert.AreEqual(0f, s.Get(Stat.DamagePct), 1e-5f);
        }
    }
}
