using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 元素秘卷（S2，Three.js 版 src/progression/scrolls/defsElement.ts，10 卷）：数据与 TS 一致；燃弹 / 雷弹 / 蚀弹的附着条件与强度口径、
    /// 状态跟踪（身上有 / 持续时间内施加过，叠层重装后记录不丢）、野火燎原的蔓延与深度、静电弧的弹射与冷却、蚀爆的爆炸。
    /// EditMode：附着走 <see cref="ElementKit.TestApply"/> 记录（不建反应系统 / 状态光晕物体），附近敌人走 <see cref="ElementKit.TestTargets"/>，
    /// 概率走 <see cref="OffenseKit.TestChance"/>；「施加了状态」用 <see cref="GameEvents.RaiseStatusApplied"/> 直接派发，击杀可以直接派发 KillEvent。
    /// </summary>
    public sealed class ScrollElementTests
    {
        const float Eps = 1e-3f;
        static readonly Vector3 Far = new(-7000, -4000, 7000);

        StatSheet savedStats, sheet;
        RunState savedRun;
        ScrollInventory inv;
        readonly List<GameObject> made = new();
        readonly List<(Damageable d, Element e, float power, int depth)> applied = new();
        readonly List<float> chances = new();
        bool roll;

        [SetUp]
        public void SetUp()
        {
            savedStats = Combat.playerStats;
            savedRun = RunState.Current;
            RunState.Current = null;
            ScrollTicker.ResetForTests();
            OffenseKit.ResetTestHooks();
            ElementKit.ResetStatics();
            sheet = StatSheet.Default();
            sheet.SetBase(Stat.CritChance, 0);
            Combat.playerStats = sheet;
            inv = new ScrollInventory();
            applied.Clear();
            chances.Clear();
            roll = true;
            ElementKit.TestApply = (d, e, p, depth) => applied.Add((d, e, p, depth));
            ElementKit.TestTargets = new List<Damageable>();
            OffenseKit.TestChance = p =>
            {
                chances.Add(p);
                return roll;
            };
        }

        [TearDown]
        public void TearDown()
        {
            inv.Clear();
            Combat.playerStats = savedStats;
            RunState.Current = savedRun;
            ScrollTicker.ResetForTests();
            OffenseKit.ResetTestHooks();
            ElementKit.ResetStatics();
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        // ───────────── 工具 ─────────────

        /// <summary>测试敌人（身体中心 = Far + at + 1 m），登记到附近查询的名单里</summary>
        Damageable Enemy(Vector3 at, float maxHp = 1e6f, Rank rank = Rank.Normal, float radius = 0.4f)
        {
            var go = new GameObject("ScrollElementTests Enemy");
            made.Add(go);
            go.transform.position = Far + at;
            var cap = go.AddComponent<CapsuleCollider>();
            cap.center = Vector3.up;
            cap.height = 2;
            cap.radius = radius;
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.rank = rank;
            d.ResetVitals();
            go.AddComponent<Hitbox>().owner = d;
            Physics.SyncTransforms();
            ElementKit.TestTargets.Add(d);
            return d;
        }

        ScrollDef Def(string id)
        {
            var d = ScrollLibrary.Get(id);
            Assert.IsNotNull(d, $"秘卷 {id} 没有登记");
            return d;
        }

        void Give(string id, int n)
        {
            var d = Def(id);
            for (int i = 0; i < n; i++) Assert.IsTrue(inv.Gain(d, sheet), $"{id} 第 {i + 1} 层");
        }

        static DamageInfo Weapon(Damageable d, float amount = 100, DamageSource source = DamageSource.Weapon, int depth = 0)
        {
            var i = DamageInfo.Simple(amount, source, ScrollKit.BodyCenter(d), Vector3.forward);
            i.noCrit = true;
            i.depth = depth;
            return i;
        }

        static DamageResult Hit(Damageable d, float amount = 100, DamageSource source = DamageSource.Weapon, int depth = 0) =>
            Combat.DamageEnemy(d, Weapon(d, amount, source, depth));

        /// <summary>直接派发一次「打死了」（不经过伤害管线）</summary>
        static void Killed(Damageable d, int depth = 0, bool purge = false)
        {
            var info = Weapon(d, 100, DamageSource.Weapon, depth);
            if (purge) info.tags |= DamageTag.Purge;
            var k = new KillEvent { enemy = d, info = info, result = new DamageResult { killed = true, total = 100 } };
            GameEvents.RaiseEnemyKilled(in k);
        }

        static List<IncomingHit> Probe(Damageable d, bool swallow)
        {
            var list = new List<IncomingHit>();
            d.Incoming.Add((in IncomingHit h) =>
            {
                if (!h.info.Has(DamageTag.Proc)) return 1f;
                list.Add(h);
                return swallow ? 0f : 1f;
            });
            return list;
        }

        // ───────────── 数据 ─────────────

        static readonly (string id, string name, int rarity, int max)[] Table =
        {
            ("ember_heart", "炎心", 0, 4), ("thunder_heart", "雷心", 0, 4), ("venom_heart", "蚀心", 0, 4), ("five_elements", "五行共鸣", 2, 3),
            ("ignite_rounds", "燃弹", 1, 3), ("storm_rounds", "雷弹", 1, 3), ("acid_rounds", "蚀弹", 1, 3),
            ("wildfire", "野火燎原", 2, 3), ("static_arc", "静电弧", 2, 3), ("acid_burst", "蚀爆", 2, 3),
        };

        [Test]
        public void All10ElementScrollsAreRegisteredWithTsData()
        {
            foreach (var (id, name, rarity, max) in Table)
            {
                var d = Def(id);
                Assert.AreEqual(name, d.name, $"{id} 名字");
                Assert.AreEqual(rarity, d.rarity, $"{id} 稀有度");
                Assert.AreEqual(max, d.maxStacks, $"{id} 层数上限");
                Assert.IsTrue(d.HasTag(ScrollRoll.ElementTag), $"{id} 带「元素」标签（元素来源判定）");
            }
            Assert.AreEqual("武器命中时每层 5% 概率额外附着灼烧。", Def("ignite_rounds").description);
            Assert.AreEqual("武器命中时每层 5% 概率额外附着雷殛。", Def("storm_rounds").description);
            CollectionAssert.AreEqual(new[] { "元素", "蚀化", "命中" }, Def("acid_rounds").tags);
            var errors = ScrollLibrary.Validate(Table.Select(t => Def(t.id)), out _);
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void HeartsAndFiveElementsAreStatScrolls()
        {
            Give("ember_heart", 4);
            Give("thunder_heart", 2);
            Give("venom_heart", 1);
            Give("five_elements", 3);
            Assert.AreEqual(0.6f, sheet.Get(Stat.FireDamagePct), Eps);
            Assert.AreEqual(0.3f, sheet.Get(Stat.ShockDamagePct), Eps);
            Assert.AreEqual(0.15f, sheet.Get(Stat.CorrodeDamagePct), Eps);
            Assert.AreEqual(0.3f, sheet.Get(Stat.ElementDamagePct), Eps);
            Assert.AreEqual(0.03f * 7 + 0.15f, sheet.Get(Stat.ElementChancePct), Eps);
            // 火属性命中：× 元素 1.3 × 灼烧 1.6（打生命层另有 ×1.25）
            var e = Enemy(Vector3.zero);
            var fire = Weapon(e);
            fire.element = Element.Fire;
            Assert.AreEqual(100 * 1.3f * 1.6f * 1.25f, Combat.DamageEnemy(e, MuteElement(fire)).total, 0.01f);
        }

        /// <summary>带元素但不附着（附着几率压到负数：EditMode 下挂状态会建光晕物体）</summary>
        static DamageInfo MuteElement(DamageInfo i)
        {
            i.statusChance = -10;
            return i;
        }

        // ───────────── 燃弹 / 雷弹 / 蚀弹 ─────────────

        [Test]
        public void ElementalRoundsAttachOnLiveDirectHits()
        {
            Give("ignite_rounds", 3);
            var e = Enemy(Vector3.zero);
            Hit(e, 100);
            Assert.AreEqual(0.15f, chances.Single(), Eps, "每层 5%");
            Assert.AreEqual(1, applied.Count);
            Assert.AreSame(e, applied[0].d);
            Assert.AreEqual(Element.Fire, applied[0].e);
            Assert.AreEqual(100f, applied[0].power, Eps, "强度 = 实际伤害（无元素加成可除）");
            Assert.AreEqual(0, applied[0].depth);

            Hit(e, 100, DamageSource.Skill);
            Hit(e, 100, DamageSource.Weapon, 1);
            Assert.AreEqual(1, applied.Count, "技能、衍生伤害不触发");
            roll = false;
            Hit(e, 100);
            Assert.AreEqual(1, applied.Count, "没掷中");
            roll = true;
            var weak = Enemy(new Vector3(3, 0, 0), 50);
            Hit(weak, 100);
            Assert.AreEqual(1, applied.Count, "打死了不附着");

            // 这一击自己已经附着了灼烧：不再掷；雷弹照常
            Give("storm_rounds", 1);
            var hit = new HitEvent { enemy = e, info = Weapon(e), result = new DamageResult { total = 50, statusApplied = Element.Fire } };
            int rolls = chances.Count;
            GameEvents.RaiseEnemyDamaged(in hit);
            Assert.AreEqual(rolls + 1, chances.Count, "燃弹跳过、雷弹掷一次");
            Assert.AreEqual(Element.Shock, applied.Last().e);
            Assert.AreEqual(2, applied.Count);
        }

        [Test]
        public void ElementalRoundsPowerDividesOutPerTickMultipliers()
        {
            sheet.Add("test", Stat.EliteDamagePct, 0.5f);
            sheet.Add("test", Stat.FireDamagePct, 0.2f);
            Give("acid_rounds", 1);
            var elite = Enemy(Vector3.zero, 1e6f, Rank.Elite);
            var info = Weapon(elite);
            info.element = Element.Fire;
            var hit = new HitEvent { enemy = elite, info = info, result = new DamageResult { total = 120 } };
            GameEvents.RaiseEnemyDamaged(in hit);
            Assert.AreEqual(Element.Corrode, applied.Single().e);
            Assert.AreEqual(120f / (1.2f * 1.5f), applied.Single().power, Eps, "按这一击的元素（火）与级别除掉加成，同 TS statusPowerFrom");

            var small = Enemy(new Vector3(3, 0, 0), 100);
            var cap = new HitEvent { enemy = small, info = Weapon(small), result = new DamageResult { total = 90 } };
            GameEvents.RaiseEnemyDamaged(in cap);
            Assert.AreEqual(50f, applied.Last().power, Eps, "上限最大生命一半");
        }

        // ───────────── 野火燎原 ─────────────

        [Test]
        public void WildfireSpreadsFromBurningCorpsesWithDerivedDepth()
        {
            Give("wildfire", 2);
            var victim = Enemy(Vector3.zero, 1000);
            var near = Enemy(new Vector3(3, 0, 0), 1e6f);
            var small = Enemy(new Vector3(0, 0, 4), 100);
            var far = Enemy(new Vector3(7, 0, 0), 1e6f);

            Killed(victim);
            Assert.AreEqual(0, applied.Count, "没在灼烧：不蔓延");

            GameEvents.RaiseStatusApplied(victim, StatusId.Burn, 1);
            Killed(victim);
            Assert.AreEqual(2, applied.Count, "5 米内的两个，7 米外的不算，死者自己不算");
            var toNear = applied.Single(a => a.d == near);
            Assert.AreEqual(Element.Fire, toNear.e);
            Assert.AreEqual(200f, toNear.power, Eps, "死者最大生命 × 每层 10% × 2");
            Assert.AreEqual(1, toNear.depth, "直接击杀 → 深度 1");
            Assert.AreEqual(50f, applied.Single(a => a.d == small).power, Eps, "不超过目标自己最大生命的一半");
            Assert.IsFalse(applied.Any(a => a.d == far));

            applied.Clear();
            Killed(victim, depth: 1);
            Assert.AreEqual(2, applied.Single(a => a.d == near).depth, "反应 / 持续伤害的击杀 → 深度 2");
            applied.Clear();
            Killed(victim, depth: 5);
            Assert.AreEqual(2, applied.Single(a => a.d == near).depth, "封顶 2");
            applied.Clear();
            Killed(victim, purge: true);
            Assert.AreEqual(0, applied.Count, "静默处决不触发");

            // 叠层重装后，之前记下的施加时间还在（模块级记录）
            Give("wildfire", 1);
            Killed(victim);
            Assert.AreEqual(2, applied.Count);
            Assert.AreEqual(300f, applied.Single(a => a.d == near).power, Eps, "3 层");

            // 超过灼烧持续时间 4 秒：不再算「灼烧中」
            applied.Clear();
            ScrollTicker.Step(4.05f);
            Killed(victim);
            Assert.AreEqual(0, applied.Count);
        }

        // ───────────── 静电弧 ─────────────

        [Test]
        public void StaticArcJumpsFromShockedTargetsToTheNearestOther()
        {
            Give("static_arc", 3);
            var a = Enemy(Vector3.zero);
            var b = Enemy(new Vector3(4, 0, 0));
            var c = Enemy(new Vector3(-6, 0, 0));
            var plain = Enemy(new Vector3(0, 0, 30));
            var toB = Probe(b, false);
            var toC = Probe(c, false);

            Hit(plain, 100);
            Assert.AreEqual(0, chances.Count, "没被雷殛的敌人不掷");

            GameEvents.RaiseStatusApplied(a, StatusId.Shock, 1);
            Hit(a, 100);
            Assert.AreEqual(0.36f, chances.Last(), Eps, "每层 12%");
            Assert.AreEqual(1, toB.Count, "弹到最近的 b");
            Assert.AreEqual(0, toC.Count);
            Assert.AreEqual(60f, toB[0].amount, Eps, "该次伤害 60%");
            Assert.AreEqual(Element.Shock, toB[0].info.element);
            Assert.AreEqual(1, toB[0].info.depth);
            Assert.AreEqual(DamageSource.Scroll, toB[0].info.source);

            Hit(a, 100);
            Assert.AreEqual(1, toB.Count, "内置冷却 0.08 秒");
            ScrollTicker.Step(0.09f);
            Hit(a, 100, DamageSource.Skill);
            Assert.AreEqual(1, toB.Count, "技能命中不触发");
            Hit(a, 100);
            Assert.AreEqual(2, toB.Count);

            ScrollTicker.Step(3f);
            Hit(a, 100);
            Assert.AreEqual(2, toB.Count, "雷殛 3 秒的宽限窗口过了");
        }

        // ───────────── 蚀爆 ─────────────

        [Test]
        public void AcidBurstExplodesCorrodedCorpses()
        {
            Give("acid_burst", 2);
            var victim = Enemy(Vector3.zero, 500);
            var near = Enemy(Vector3.zero, 1e6f, Rank.Normal, 0.6f);
            var hits = Probe(near, true);

            GameEvents.RaiseStatusApplied(victim, StatusId.Corrode, 1);
            Hit(victim, 1e4f);
            Assert.IsTrue(victim.Dead);
            Assert.AreEqual(1, hits.Count);
            var h = hits[0];
            Assert.AreEqual(120f, h.amount, Eps, "最大生命 × 每层 12% × 2");
            Assert.AreEqual(Element.Corrode, h.info.element);
            Assert.AreEqual(1f, h.info.statusChance, Eps, "必定附着蚀化");
            Assert.AreEqual(1, h.info.depth);
            Assert.AreEqual(DamageSource.Scroll, h.info.source);

            var deep = Enemy(Vector3.zero, 500);
            GameEvents.RaiseStatusApplied(deep, StatusId.Corrode, 1);
            Hit(deep, 1e4f, DamageSource.Weapon, 2);
            Assert.AreEqual(1, hits.Count, "深度 2 的击杀不引爆");

            var clean = Enemy(Vector3.zero, 500);
            Hit(clean, 1e4f);
            Assert.AreEqual(1, hits.Count, "没蚀化不引爆");

            var stale = Enemy(Vector3.zero, 500);
            GameEvents.RaiseStatusApplied(stale, StatusId.Corrode, 1);
            ScrollTicker.Step(5.05f);
            Hit(stale, 1e4f);
            Assert.AreEqual(1, hits.Count, "蚀化 5 秒后不算");
        }

        // ───────────── 卸载 ─────────────

        [Test]
        public void ElementScrollsLeaveNoResidueWhenRemoved()
        {
            int tasks0 = ScrollTicker.TaskCount, out0 = Combat.Outgoing.Count;
            foreach (var (id, _, _, max) in Table) Give(id, max);
            inv.Clear();
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount);
            Assert.AreEqual(out0, Combat.Outgoing.Count);
            foreach (var (id, _, _, _) in Table) Assert.IsFalse(sheet.HasSource(ScrollScope.SourceOf(id)), id);
            var e = Enemy(Vector3.zero);
            GameEvents.RaiseStatusApplied(e, StatusId.Burn, 1);
            Hit(e, 100);
            Killed(e);
            Assert.AreEqual(0, applied.Count, "卸载后不再响应");
            Assert.AreEqual(0, chances.Count);
        }
    }
}
