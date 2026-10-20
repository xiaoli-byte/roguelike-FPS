using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 精英词缀（docs/unity-parity.md 3.7、EN4；对照 src/enemies/Affixes.ts、EnemyManager.spawn）：登记了 TS 的四种（迅捷 / 坚盾 / 爆裂 / 狂暴）、
    /// 随机均匀且避开排除表、写死的可用就用、名字前缀；各词缀的数值（迅捷 ×1.5、坚盾 60% 护盾 + 脱战 4 s 回盾、爆裂死后 1 s 爆、狂暴 40% 以下触发一次）；
    /// 接线（遭遇的词缀来源、头顶血条的词缀标签）。金环、外观要场景，放在 TestArena 冒烟里看。
    /// </summary>
    public sealed class EliteAffixTests
    {
        readonly List<GameObject> spawned = new();

        [SetUp]
        public void SetUp() => HazardClock.ResetForTests();

        [TearDown]
        public void TearDown()
        {
            HazardClock.ResetForTests();
            SquadAffixes.Source = null;
            EnemyBars.AffixOf = null;
            foreach (var go in spawned)
                if (go)
                    Object.DestroyImmediate(go);
            spawned.Clear();
        }

        EliteHost Host(float maxHp, float health = -1)
        {
            var go = new GameObject("Elite");
            go.transform.position = new Vector3(0, -700, 0);
            spawned.Add(go);
            var hp = go.AddComponent<Damageable>();
            hp.maxHealth = maxHp;
            hp.health = health < 0 ? maxHp : health;
            return new EliteHost { hp = hp, buffs = new EnemyBuffs(), transform = go.transform, radius = 0.4f, height = 1.8f };
        }

        static EnemyDef Def(params string[] exclude) => new() { id = "test_enemy", name = "测试怪", affixExclusions = exclude };

        // ───────────── 登记与取词 ─────────────

        [Test]
        public void RegistryHasTheFourThreeJsAffixes()
        {
            Assert.AreEqual(new[] { "swift", "shielded", "volatile", "frenzied" }, EliteAffixes.All.Select(a => a.Id).ToArray());
            Assert.AreEqual(new[] { "迅捷", "坚盾", "爆裂", "狂暴" }, EliteAffixes.All.Select(a => a.Name).ToArray());
            Assert.AreEqual(Hex.Rgb(0x49d8ff), EliteAffixes.Get("swift").Color);
            Assert.AreEqual(Hex.Rgb(0x4f8dff), EliteAffixes.Get("shielded").Color);
            Assert.AreEqual(Hex.Rgb(0xff6a1f), EliteAffixes.Get("volatile").Color);
            Assert.AreEqual(Hex.Rgb(0xff2a18), EliteAffixes.Get("frenzied").Color);
            foreach (var a in EliteAffixes.All) Assert.IsTrue(EnemyBars.AffixLabels.ContainsKey(a.Id), $"头顶血条有 {a.Id} 的标签");
            Assert.IsTrue(EliteAffixes.Exists("swift"));
            Assert.IsFalse(EliteAffixes.Exists("bogus"));
            Assert.IsFalse(EliteAffixes.Exists(null));
        }

        [Test]
        public void RollIsUniformOverTheAffixesNotExcluded()
        {
            var rng = new RunRng(7);
            var counts = new Dictionary<string, int>();
            var def = Def("volatile");
            for (int i = 0; i < 3000; i++)
            {
                var id = EliteAffixes.Roll(def, rng);
                counts[id] = counts.TryGetValue(id, out int n) ? n + 1 : 1;
            }
            Assert.IsFalse(counts.ContainsKey("volatile"), "排除表里的不随机给");
            Assert.AreEqual(3, counts.Count);
            foreach (var kv in counts) Assert.That(kv.Value, Is.InRange(850, 1150), $"{kv.Key} 均匀（约 1000）");
            Assert.IsNull(EliteAffixes.Roll(Def("swift", "shielded", "volatile", "frenzied"), rng), "全被排除：不给词缀");
        }

        [Test]
        public void ResolveTakesTheRequestedAffixWhenAllowed()
        {
            var rng = new RunRng(3);
            var def = Def("volatile");
            Assert.AreEqual("frenzied", EliteAffixes.Resolve(def, true, "frenzied", rng));
            for (int i = 0; i < 50; i++)
            {
                var id = EliteAffixes.Resolve(def, true, "volatile", rng);
                Assert.IsTrue(EliteAffixes.Exists(id) && id != "volatile", "写死的在排除表里：改为随机");
                Assert.IsTrue(EliteAffixes.Exists(EliteAffixes.Resolve(def, true, "bogus", rng)), "无法识别的词缀：随机一个（同 TS）");
                Assert.IsTrue(EliteAffixes.Exists(EliteAffixes.Resolve(def, true, null, rng)), "精英没写词缀：随机一个");
            }
            Assert.IsNull(EliteAffixes.Resolve(def, false, "swift", rng), "普通单位不带词缀");
            Assert.IsNull(EliteAffixes.Resolve(new EnemyDef { id = "boss", rank = Rank.Boss }, true, "swift", rng), "首领不带词缀");
        }

        [Test]
        public void GunpowderEnemiesNeverRollVolatileThroughTheSquadSource()
        {
            SquadAffixes.Source = EliteAffixes.Source;
            var rng = new RunRng(11);
            foreach (var id in new[] { "firecracker", "fire_crow" })
            {
                var def = Registry<EnemyDef>.Get(id);
                for (int i = 0; i < 200; i++) Assert.AreNotEqual("volatile", SquadAffixes.Resolve(def, true, "", "", rng), id);
                Assert.AreNotEqual("volatile", SquadAffixes.Resolve(def, true, "volatile", "", rng), "写死的也要过排除表");
            }
        }

        [Test]
        public void ElitesGetANamePrefix()
        {
            Assert.AreEqual("精英·迅捷 跳鼠刀兵", EliteAffixes.DisplayName("跳鼠刀兵", true, "swift"));
            Assert.AreEqual("精英·跳鼠刀兵", EliteAffixes.DisplayName("跳鼠刀兵", true, null), "精英没有词缀");
            Assert.AreEqual("跳鼠刀兵", EliteAffixes.DisplayName("跳鼠刀兵", false, "swift"));
        }

        [Test]
        public void InstallWiresTheSquadSourceAndHeadBars()
        {
            EliteAffixes.Install();
            Assert.AreSame(EliteAffixes.Source, SquadAffixes.Source);
            Assert.IsNotNull(EnemyBars.AffixOf);
            Assert.IsNull(EnemyBars.AffixOf(null));
            Assert.IsTrue(SquadAffixes.Source.Exists("shielded"));
        }

        [Test]
        public void EliteRingIsGoldAndSizedOnTheBody()
        {
            Assert.AreEqual(1.6f, EliteAura.RadiusMult, "金环半径 = 1.6 × 身体半径（TS def.radius × 1.6）");
            Assert.Greater(EliteAura.Gold.r, 0.9f);
            Assert.Greater(EliteAura.Gold.g, 0.7f);
            Assert.Less(EliteAura.Gold.b, 0.3f);
        }

        // ───────────── 各词缀 ─────────────

        [Test]
        public void SwiftSpeedsUpMoveAndAttack()
        {
            var h = Host(100);
            var c = EliteAffixes.Attach(h, "swift");
            Assert.IsNotNull(c);
            Assert.AreEqual(new BuffMods(1, 1.5f, 1.5f, 1), h.buffs.Total, "移速、攻速 ×1.5");
            c.Tick(0.1f, 1);
            c.Dispose();
            Assert.IsTrue(h.buffs.Total.IsIdentity, "回收时撤掉");
        }

        [Test]
        public void ShieldedAddsSixtyPercentShieldAndRegensOutOfCombat()
        {
            var h = Host(260);
            var c = (EliteAffix_Shielded.Controller)EliteAffixes.Attach(h, "shielded");
            Assert.AreEqual(156f, c.Extra, "额外护盾 = 最大生命 60%");
            Assert.AreEqual((156f, 156f), (h.hp.maxShield, h.hp.shield));
            h.hp.shield = 50;
            c.OnDamaged(DamageInfo.Simple(106, DamageSource.Weapon, Vector3.zero, Vector3.forward), new DamageResult { total = 106, shield = 106 }, 10);
            c.Tick(1, 13.9f);
            Assert.AreEqual(50f, h.hp.shield, "挨打后 4 s 内不回");
            Assert.IsFalse(c.Regenerating);
            c.Tick(1, 14.1f);
            Assert.IsTrue(c.Regenerating);
            Assert.AreEqual(50f + 156f * EliteAffix_Shielded.RegenRate, h.hp.shield, 1e-3f, "每秒 22% 护盾上限");
            c.Tick(10, 30);
            Assert.AreEqual(156f, h.hp.shield, "回满为止");
            c.Dispose();
        }

        [Test]
        public void VolatileBlowsUpOneSecondAfterDeath()
        {
            var h = Host(100);
            h.damageMult = 1.5f;
            var c = (EliteAffix_Volatile.Controller)EliteAffixes.Attach(h, "volatile");
            c.Tick(0.5f, 1);
            Assert.IsFalse(c.Armed);
            c.OnDeath(DamageInfo.Simple(100, DamageSource.Weapon, Vector3.zero, Vector3.forward));
            Assert.IsTrue(c.Armed);
            Assert.AreEqual(EliteAffix_Volatile.BaseDamage * 1.5f, c.BlastDamage, 1e-4f, "26 × 伤害倍率（按死亡那一刻）");
            Assert.AreEqual(1, HazardClock.Pending, "1 s 引信");
            HazardClock.Step(0.9f);
            Assert.AreEqual(1, HazardClock.Pending);
            HazardClock.Step(0.2f);
            Assert.AreEqual(0, HazardClock.Pending, "炸了（没有玩家时不出错）");
            c.OnDeath(default);
            Assert.AreEqual(0, HazardClock.Pending, "只炸一次");
            c.Dispose();
        }

        [Test]
        public void FrenziedTriggersOnceBelowFortyPercent()
        {
            var h = Host(100);
            var c = (EliteAffix_Frenzied.Controller)EliteAffixes.Attach(h, "frenzied");
            c.Tick(0.1f, 1);
            Assert.IsFalse(c.Frenzied);
            Assert.IsTrue(h.buffs.Total.IsIdentity);
            h.hp.health = 41;
            c.Tick(0.1f, 2);
            Assert.IsFalse(c.Frenzied, "41%：还没");
            h.hp.health = 40;
            c.Tick(0.1f, 3);
            Assert.IsTrue(c.Frenzied, "40% 及以下狂暴");
            Assert.AreEqual(new BuffMods(1.2f, 1.6f, 1.35f, 1), h.buffs.Total, "伤害 ×1.2、攻速 ×1.6、移速 ×1.35");
            h.hp.health = 100;
            c.Tick(0.1f, 4);
            Assert.IsTrue(c.Frenzied, "回血也不退出（只触发一次）");
            c.Dispose();
            Assert.IsTrue(h.buffs.Total.IsIdentity);
        }
    }
}
