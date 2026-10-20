using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 敌人框架（docs/unity-parity.md 3.7，E1 / E2）：出手名额按章节的上限、续期、合计上限、Reset；加成登记的通道合并与失效
    /// （邪飞天光环 × 赐福与迁移前的公式逐位一致）；生成难度的兜底与生命取整。
    /// </summary>
    public sealed class EnemyFrameworkTests
    {
        const float T0 = 1000f;

        [SetUp]
        public void SetUp() => AttackTokens.Reset();

        [TearDown]
        public void TearDown() => AttackTokens.Reset();

        // ───────────── 出手名额 ─────────────

        [Test]
        public void TokenCapsWidenWithChapter()
        {
            Assert.AreEqual(new[] { 4, 5, 6 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Melee, c)).ToArray());
            Assert.AreEqual(new[] { 2, 3, 4 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Ranged, c)).ToArray());
            Assert.AreEqual(new[] { 1, 2, 2 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Heavy, c)).ToArray());
            Assert.AreEqual(4, AttackTokens.Cap(AttackTokens.Kind.Melee, -3), "章序夹到 0..2");
            Assert.AreEqual(6, AttackTokens.Cap(AttackTokens.Kind.Melee, 9));
        }

        [Test]
        public void FirstChapterGrantsFourMeleeSpacedByGap()
        {
            var who = new object[6];
            for (int i = 0; i < who.Length; i++) who[i] = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[0], 5, T0, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Melee, who[1], 5, T0 + 0.05f, 0), "两次发放间隔 < 0.12 s");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[1], 5, T0 + 0.2f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[2], 5, T0 + 0.4f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[3], 5, T0 + 0.6f, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Melee, who[4], 5, T0 + 0.8f, 0), "第一章近战上限 4");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[4], 5, T0 + 0.8f, 1), "第二章近战上限 5");
        }

        [Test]
        public void HolderRenewsEvenWhenFull()
        {
            var a = new object();
            var b = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 1, T0, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 0.9f, 0), "第一章重击上限 1");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 1, T0 + 0.9f, 0), "已持有：续期");
            // 续期后到 T0 + 1.9 才过期：原来的 T0 + 1 之后仍然占着名额
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 1.5f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 2f, 0), "过期的名额自动回收");
            Assert.IsFalse(AttackTokens.Holding(a));
        }

        [Test]
        public void RangedAndHeavyShareACombinedCap()
        {
            // 第二章：远程 3、重击 2，两类合计 ≤ 4
            for (int i = 0; i < 3; i++) Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Ranged, new object(), 9, T0 + i, 1));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 4, 1));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 6, 1), "重击才 1 个，但合计已满 4");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, new object(), 9, T0 + 6, 1), "近战不算进远程合计");
        }

        [Test]
        public void ReleaseAndResetFreeSlots()
        {
            var a = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 9, T0, 0));
            AttackTokens.Release(a);
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 1, 0));
            AttackTokens.Reset();
            Assert.AreEqual(0, AttackTokens.Count(AttackTokens.Kind.Heavy));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 1.1f, 0), "Reset 也清掉了发放间隔");
        }

        // ───────────── 加成登记 ─────────────

        sealed class Source : IBuffSource
        {
            public bool active = true;
            public bool BuffActive => active;
        }

        [Test]
        public void ApsaraAuraAndBlessMatchTheOldFormula()
        {
            var b = new EnemyBuffs();
            var a1 = new Source();
            float far = Time.time + 100;
            b.SetUntil(EnemyBuffs.ApsaraAura, a1, ApsaraAI.AuraMods, far);
            Assert.AreEqual(1.35f, b.Total.damage);
            Assert.AreEqual(1.35f, b.Total.rate);
            Assert.AreEqual(1.2f, b.Total.speed);
            Assert.AreEqual(0.75f, b.Total.taken);
            b.SetUntil(EnemyBuffs.ApsaraBless, a1, ApsaraAI.BlessMods, far);
            // 迁移前：(aura ? 1.35 : 1) × (blessed ? 1.6 : 1)，逐位相同
            Assert.AreEqual(1.35f * 1.6f, b.Total.damage, 1e-6f);
            Assert.AreEqual(1.35f * 1.5f, b.Total.rate, 1e-6f);
            Assert.AreEqual(1.2f * 1.15f, b.Total.speed, 1e-6f);
            Assert.AreEqual(0.75f * 0.5f, b.Total.taken, 1e-6f);
        }

        [Test]
        public void SameChannelDoesNotStackAndDeadSourcesDrop()
        {
            var b = new EnemyBuffs();
            var a1 = new Source();
            var a2 = new Source();
            float far = Time.time + 100;
            b.SetUntil(EnemyBuffs.ApsaraAura, a1, ApsaraAI.AuraMods, far);
            b.SetUntil(EnemyBuffs.ApsaraAura, a2, ApsaraAI.AuraMods, far);
            Assert.AreEqual(1.35f, b.Total.damage, "两只邪飞天的光环不叠加");
            Assert.AreEqual(2, b.Count);
            string ended = null;
            b.Ended += (ch, src) => ended = ch;
            a1.active = false;
            b.Tick(Time.time);
            Assert.AreEqual(EnemyBuffs.ApsaraAura, ended, "来源失效（沉默 / 死亡）时撤掉并通知");
            Assert.AreEqual(1.35f, b.Total.damage, "另一只还在给");
            a2.active = false;
            Assert.IsFalse(b.Has(EnemyBuffs.ApsaraAura), "没 Tick 之前查询也按失效算");
            b.Tick(Time.time);
            Assert.AreEqual(BuffMods.Identity.damage, b.Total.damage);
            Assert.AreEqual(1f, b.Total.taken);
        }

        [Test]
        public void TimedEntriesExpireAndMultiplyChannelsStack()
        {
            var b = new EnemyBuffs();
            float now = Time.time;
            b.SetUntil("test.short", null, new BuffMods(2, 1, 1, 1), now + 1);
            b.SetUntil("test.long", null, new BuffMods(1.5f, 1, 1, 1), now + 10);
            Assert.AreEqual(3f, b.Total.damage, 1e-6f, "不同通道相乘");
            b.Tick(now + 2);
            Assert.AreEqual(1.5f, b.Total.damage, 1e-6f, "到期的那条撤掉");

            EnemyBuffs.DefineChannel("test.stack", BuffStack.Multiply);
            var c = new EnemyBuffs();
            c.SetUntil("test.stack", new object(), new BuffMods(1, 1, 1, 0.8f), now + 10);
            c.SetUntil("test.stack", new object(), new BuffMods(1, 1, 1, 0.8f), now + 10);
            Assert.AreEqual(0.64f, c.Total.taken, 1e-6f, "Multiply 通道：多个来源相乘");
            Assert.IsTrue(c.RemoveChannel("test.stack") == 2);
            Assert.AreEqual(1f, c.Total.taken);
        }

        // ───────────── 生成 ─────────────

        [Test]
        public void SpawnDifficultyFallsBackToTheRun()
        {
            var saved = RunState.Current;
            try
            {
                RunState.Current = null;
                Assert.AreEqual(1f, EnemyRoster.ResolveDifficulty(float.NaN));
                Assert.AreEqual(1.48f, EnemyRoster.ResolveDifficulty(1.48f), "浮点难度原样用");
                RunState.Current = new RunState { difficulty = 2.28f };
                Assert.AreEqual(2.28f, EnemyRoster.ResolveDifficulty(0));
                Assert.AreEqual(2.28f, EnemyRoster.ResolveDifficulty(-1));
                Assert.AreEqual(3.08f, EnemyRoster.ResolveDifficulty(3.08f));
            }
            finally
            {
                RunState.Current = saved;
            }
        }

        [Test]
        public void HpRoundsLikeMathRound()
        {
            Assert.AreEqual(442f, EnemyAI.RoundHp(170 * 2.6f));
            Assert.AreEqual(1f, EnemyAI.RoundHp(0.5f));
            Assert.AreEqual(3f, EnemyAI.RoundHp(2.5f), "JS Math.round：.5 进位（不是银行家舍入）");
            Assert.AreEqual(252f, EnemyAI.RoundHp(170 * 1.48f));
            Assert.AreEqual(0f, EnemyAI.RoundHp(float.NaN));
        }
    }
}
