using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// H2 技能框架：撤销栈（逆序、异常隔离、不在会话中立即撤销）、被动装卸干净、每个英雄都能从 HeroDef 工厂装出完整的技能槽，燎的数值不变。
    /// </summary>
    public sealed class SkillFrameworkTests
    {
        [Test]
        public void SessionUndoesInReverseOrderAndReportsReason()
        {
            var log = new List<string>();
            SkillEnd? ended = null;
            var s = new SkillSession(r => ended = r);
            s.Begin();
            s.Track(() => log.Add("a"));
            s.Track(() => log.Add("b"));
            s.Track(new Disposer(() => log.Add("c")));
            Assert.IsTrue(s.Active);
            s.End(SkillEnd.Natural);
            CollectionAssert.AreEqual(new[] { "c", "b", "a" }, log);
            Assert.AreEqual(SkillEnd.Natural, ended);
            Assert.IsFalse(s.Active);
            s.End();
            Assert.AreEqual(3, log.Count, "重复结束不再撤销");
        }

        [Test]
        public void SessionIsolatesThrowingUndo()
        {
            var log = new List<string>();
            var s = new SkillSession();
            s.Begin();
            s.Track(() => log.Add("first"));
            s.Track(() => throw new System.InvalidOperationException("撤销失败"));
            s.Track(() => log.Add("last"));
            LogAssert.Expect(LogType.Exception, new Regex("撤销失败"));
            s.End(SkillEnd.Interrupted);
            CollectionAssert.AreEqual(new[] { "last", "first" }, log, "某条撤销抛异常不影响其余");
        }

        [Test]
        public void TrackOutsideSessionUndoesImmediately()
        {
            int n = 0;
            var s = new SkillSession();
            s.Track(() => n++);
            Assert.AreEqual(1, n, "不在会话中登记的撤销立刻执行，不会漏");
            s.Begin();
            s.Track(() => n++);
            s.Begin();
            Assert.AreEqual(2, n, "重新开始先按 Interrupted 结束上一次");
        }

        [Test]
        public void EmberPassiveInstallsAndRemovesItsModifier()
        {
            int before = Combat.Outgoing.Count;
            var p = new LiaoEmber();
            var handle = p.Apply(null);
            Assert.AreEqual(before + 1, Combat.Outgoing.Count);
            handle.Dispose();
            handle.Dispose();
            Assert.AreEqual(before, Combat.Outgoing.Count, "换英雄时被动撤销干净");
            StringAssert.Contains("20%", p.Description);
        }

        [Test]
        public void EveryHeroBuildsAFullSkillLoadout()
        {
            Assert.IsNotEmpty(HeroLibrary.All);
            foreach (var hero in HeroLibrary.All)
            {
                var q = hero.CreatePrimary();
                var e = hero.CreateSecondary();
                Assert.IsNotNull(q, $"{hero.id} 没有主技能");
                Assert.IsNotNull(e, $"{hero.id} 没有副技能");
                Assert.AreNotEqual(q.Id, e.Id);
                Assert.Greater(q.cooldown, 0);
                Assert.Greater(e.cooldown, 0);
                Assert.AreNotSame(q, hero.CreatePrimary(), "每次配置新建技能对象（技能带运行时状态）");
                var passive = hero.CreatePassive();
                Assert.IsFalse(string.IsNullOrEmpty(passive?.Name ?? hero.passiveName), $"{hero.id} 没有被动名");
            }
        }

        [Test]
        public void LiaoNumbersUnchanged()
        {
            var hero = HeroLibrary.Get("fox");
            Assert.IsNotNull(hero);
            var q = hero.CreatePrimary();
            var e = hero.CreateSecondary();
            Assert.AreEqual("fox_nine_tails", q.Id);
            Assert.AreEqual(20f, q.cooldown);
            Assert.AreEqual(1, q.maxCharges);
            Assert.IsInstanceOf<TimedSkill>(q, "尾焰火灵走撤销栈");
            Assert.AreEqual("fox_blaze_grenade", e.Id);
            Assert.AreEqual(8f, e.cooldown);
            Assert.AreEqual(2, e.maxCharges);
            Assert.AreEqual("余烬", hero.CreatePassive().Name);
            Assert.AreEqual(0.2f, LiaoSkills.EmberBonus);
        }

        sealed class Disposer : System.IDisposable
        {
            readonly System.Action a;
            public Disposer(System.Action a) => this.a = a;
            public void Dispose() => a();
        }
    }
}
