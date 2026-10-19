using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// C1 反应接口（docs/unity-parity.md 第 5 节 C1，数值对照 src/combat/Reactions.ts）：
    /// 判定纯函数（威力公式、冷却、附着 / 引爆的反应选择、崩解伤害、剩余跳数）、
    /// <see cref="ReactionScheduler"/> 的引爆 / 强制反应 / 附着入队（假的 <see cref="IReactionEnv"/>，时间与帧号手动推进）、
    /// 每帧预算与浮字节流、处理器注册表。不进 Play、不依赖场景。
    /// </summary>
    public sealed class ReactionTests
    {
        const float Eps = 1e-4f;

        /// <summary>假的外部状态：每个敌人身上有什么、剩余跳伤、雷殛强度；记录消耗与预警</summary>
        sealed class FakeEnv : IReactionEnv
        {
            public sealed class State
            {
                public bool burn, shock, corrode;
                public float burnRaw, corrodeRaw, shockPower, burnCash;
                public int burnConsumed, shockConsumed;
            }

            readonly Dictionary<Damageable, State> states = new();
            public float strength = 1, haste, dotMult = 1;
            public int windups;
            public float lastWindup;

            public State Of(Damageable d)
            {
                if (!states.TryGetValue(d, out var s)) states[d] = s = new State();
                return s;
            }

            public bool Has(Damageable d, StatusId id) =>
                states.TryGetValue(d, out var s) && (id switch
                {
                    StatusId.Burn => s.burn,
                    StatusId.Shock => s.shock,
                    StatusId.Corrode => s.corrode,
                    _ => false,
                });

            public float ShockPower(Damageable d) => states.TryGetValue(d, out var s) && s.shock ? s.shockPower : 0;

            public float DotRemainingRaw(Damageable d, StatusId id)
            {
                if (!states.TryGetValue(d, out var s)) return 0;
                return id == StatusId.Burn && s.burn ? s.burnRaw : id == StatusId.Corrode && s.corrode ? s.corrodeRaw : 0;
            }

            public float ConsumeBurn(Damageable d)
            {
                var s = Of(d);
                s.burnConsumed++;
                s.burn = false;
                return s.burnCash;
            }

            public void ConsumeShock(Damageable d)
            {
                var s = Of(d);
                s.shockConsumed++;
                s.shock = false;
            }

            public float Strength(Damageable d) => strength;
            public float Haste => haste;
            public float DotStatMultiplier(Damageable d, Element e) => dotMult;

            public void Windup(Damageable d, Vector3 point, float seconds)
            {
                windups++;
                lastWindup = seconds;
            }
        }

        readonly List<GameObject> spawned = new();
        FakeEnv env;
        ReactionStats stats;
        ReactionScheduler rx;

        [SetUp]
        public void SetUp()
        {
            env = new FakeEnv();
            stats = new ReactionStats();
            rx = new ReactionScheduler(env, stats);
        }

        [TearDown]
        public void TearDown()
        {
            rx.Clear();
            foreach (var go in spawned)
                if (go) Object.DestroyImmediate(go);
            spawned.Clear();
        }

        Damageable Enemy(float maxHp = 1000)
        {
            var go = new GameObject("ReactionTests Enemy");
            spawned.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.health = maxHp;
            return d;
        }

        Damageable Enemy(bool burn, bool shock, bool corrode, float maxHp = 1000)
        {
            var d = Enemy(maxHp);
            var s = env.Of(d);
            s.burn = burn;
            s.shock = shock;
            s.corrode = corrode;
            return d;
        }

        static DetonateOpts Det(float power, float mult = 0, int depth = 0) => new() { power = power, mult = mult, depth = depth };

        // ───────────── 纯函数 ─────────────

        [Test]
        public void TuningMatchesThreeJs()
        {
            float[,] expect = { { 1.0f, 14, 80, 1.0f }, { 1.0f, 14, 100, 1.2f }, { 1.0f, 14, 90, 1.2f }, { 1.5f, 40, 320, 6.0f } };
            for (int i = 0; i < 4; i++)
            {
                var t = CombatTuning.Of((Reaction)i);
                Assert.AreEqual(expect[i, 0], t.k, Eps, $"{(Reaction)i} k");
                Assert.AreEqual(expect[i, 1], t.floor, Eps, $"{(Reaction)i} floor");
                Assert.AreEqual(expect[i, 2], t.cap, Eps, $"{(Reaction)i} cap");
                Assert.AreEqual(expect[i, 3], t.icd, Eps, $"{(Reaction)i} icd");
            }
            Assert.AreEqual(8, CombatTuning.FrameBudget);
            Assert.AreEqual(32, CombatTuning.QueueCap);
            Assert.AreEqual(3, CombatTuning.BigFxBudget);
            Assert.AreEqual(4, CombatTuning.LabelBudget);
            Assert.AreEqual(0.5f, CombatTuning.DetonateIcd, Eps);
            Assert.AreEqual(0.3f, CombatTuning.Collapse.Burn, Eps);
            Assert.AreEqual(0.3f, CombatTuning.Collapse.Corrode, Eps);
            Assert.AreEqual(0.5f, CombatTuning.Collapse.Shock, Eps);
            Assert.AreEqual(30f, CombatTuning.Collapse.Cap, Eps);
            Assert.AreEqual(1.12f, CombatTuning.Veinseal.BossVuln, Eps);
        }

        [Test]
        public void BaseIsClampedBetweenFloorAndCapTimesStrength()
        {
            Assert.AreEqual(14f, ReactionMath.Base(Reaction.Thunderfire, 5, 1), Eps, "低于下限取 14S");
            Assert.AreEqual(50f, ReactionMath.Base(Reaction.Thunderfire, 50, 1), Eps, "k = 1");
            Assert.AreEqual(80f, ReactionMath.Base(Reaction.Thunderfire, 500, 1), Eps, "焚雷上限 80S");
            Assert.AreEqual(100f, ReactionMath.Base(Reaction.Meltdown, 500, 1), Eps, "熔金上限 100S");
            Assert.AreEqual(90f, ReactionMath.Base(Reaction.Veinseal, 500, 1), Eps, "封脉上限 90S");
            Assert.AreEqual(28f, ReactionMath.Base(Reaction.Thunderfire, 5, 2), Eps, "下限随 S");
            Assert.AreEqual(150f, ReactionMath.Base(Reaction.Abyss, 100, 1), Eps, "归墟 k = 1.5");
            Assert.AreEqual(40f, ReactionMath.Base(Reaction.Abyss, 10, 1), Eps);
            Assert.AreEqual(320f, ReactionMath.Base(Reaction.Abyss, 1000, 1), Eps);
            Assert.AreEqual(14f, ReactionMath.Base(Reaction.Meltdown, float.NaN, 1), Eps, "NaN 按 0");
            Assert.AreEqual(1f, ReactionMath.Strength(1), Eps);
            Assert.AreEqual(1.85f, ReactionMath.Strength(2), Eps);
            Assert.AreEqual(1f, ReactionMath.Strength(0.5f), Eps, "等级低于 1 不降");
        }

        [Test]
        public void CooldownDividesByHasteWithFloor()
        {
            Assert.AreEqual(1f, ReactionMath.Cooldown(Reaction.Thunderfire, 0), Eps);
            Assert.AreEqual(3f, ReactionMath.Cooldown(Reaction.Abyss, 1), Eps, "6 / (1 + 1)");
            Assert.AreEqual(0.3f, ReactionMath.Cooldown(Reaction.Thunderfire, 4), Eps, "1 / 5 = 0.2 → 下限 0.3");
            Assert.AreEqual(24f, ReactionMath.Cooldown(Reaction.Veinseal, -1), Eps, "1 + 急速 下限 0.05");
        }

        [Test]
        public void AttachPicksAbyssThenPairByPriority()
        {
            const int all = ReactionMath.AllReady;
            int noAbyss = all & ~ReactionMath.Bit(Reaction.Abyss);
            Assert.AreEqual(Reaction.Thunderfire, ReactionMath.PlanAttach(Element.Fire, false, true, false, false, all));
            Assert.AreEqual(Reaction.Meltdown, ReactionMath.PlanAttach(Element.Fire, false, false, true, false, all));
            Assert.AreEqual(Reaction.Veinseal, ReactionMath.PlanAttach(Element.Shock, false, false, true, false, all));
            Assert.AreEqual(Reaction.Abyss, ReactionMath.PlanAttach(Element.Corrode, true, true, false, false, all), "另外两种都在 → 归墟");
            Assert.AreEqual(Reaction.Meltdown, ReactionMath.PlanAttach(Element.Corrode, true, true, false, true, all), "击杀那一击不引发归墟，熔金 > 封脉");
            Assert.AreEqual(Reaction.Meltdown, ReactionMath.PlanAttach(Element.Corrode, true, true, false, false, noAbyss), "归墟冷却中 → 两两");
            Assert.AreEqual(Reaction.Thunderfire, ReactionMath.PlanAttach(Element.Fire, true, true, true, false, noAbyss), "incoming 自己的状态不算已有");
            Assert.AreEqual(Reaction.Abyss, ReactionMath.PlanAttach(Element.Fire, true, true, true, false, all));
            Assert.IsNull(ReactionMath.PlanAttach(Element.Fire, true, false, false, false, all), "同一状态不反应");
            Assert.IsNull(ReactionMath.PlanAttach(Element.None, true, true, true, false, all));
            Assert.IsNull(ReactionMath.PlanAttach(Element.Shock, true, false, false, false, all & ~ReactionMath.Bit(Reaction.Thunderfire)), "冷却中");
        }

        [Test]
        public void DetonatePlanByStatusCount()
        {
            const int all = ReactionMath.AllReady;
            int noAbyss = all & ~ReactionMath.Bit(Reaction.Abyss);
            Assert.AreEqual(DetonateOutcome.Abyss, ReactionMath.PlanDetonate(true, true, true, all), "三相 → 归墟");
            Assert.AreEqual(DetonateOutcome.Thunderfire, ReactionMath.PlanDetonate(true, true, true, noAbyss), "归墟冷却 → 按优先级");
            Assert.AreEqual(DetonateOutcome.Meltdown, ReactionMath.PlanDetonate(true, true, true, noAbyss & ~ReactionMath.Bit(Reaction.Thunderfire)));
            Assert.AreEqual(DetonateOutcome.Veinseal, ReactionMath.PlanDetonate(false, true, true, all), "两相");
            Assert.AreEqual(DetonateOutcome.Meltdown, ReactionMath.PlanDetonate(true, false, true, all));
            Assert.AreEqual(DetonateOutcome.Collapse, ReactionMath.PlanDetonate(false, true, true, all & ~ReactionMath.Bit(Reaction.Veinseal)), "组合都在冷却 → 崩解");
            Assert.AreEqual(DetonateOutcome.Collapse, ReactionMath.PlanDetonate(true, false, false, all), "单相 → 崩解");
            Assert.IsNull(ReactionMath.PlanDetonate(false, false, false, all));
            Assert.AreEqual(StatusId.Burn, ReactionMath.CollapseStatus(true, true, true), "灼烧 > 蚀化 > 雷殛");
            Assert.AreEqual(StatusId.Corrode, ReactionMath.CollapseStatus(false, true, true));
            Assert.AreEqual(StatusId.Shock, ReactionMath.CollapseStatus(false, true, false));
            Assert.AreEqual(Reaction.Veinseal, ReactionMath.PairOf(StatusId.Corrode, StatusId.Shock));
            Assert.IsNull(ReactionMath.PairOf(StatusId.Burn, StatusId.Stun));
        }

        [Test]
        public void CollapseDamageFormulaAndCap()
        {
            Assert.AreEqual(15f, ReactionMath.CollapseDamage(StatusId.Burn, 50, 0, 1), Eps, "灼烧剩余 × 0.3");
            Assert.AreEqual(12f, ReactionMath.CollapseDamage(StatusId.Corrode, 40, 0, 1), Eps, "蚀化剩余 × 0.3");
            Assert.AreEqual(20f, ReactionMath.CollapseDamage(StatusId.Shock, 999, 40, 1), Eps, "雷殛强度 × 0.5（不看剩余跳伤）");
            Assert.AreEqual(30f, ReactionMath.CollapseDamage(StatusId.Burn, 1000, 0, 1), Eps, "上限 30S");
            Assert.AreEqual(30f, ReactionMath.CollapseDamage(StatusId.Shock, 0, 100, 1), Eps);
            Assert.AreEqual(75f, ReactionMath.CollapseDamage(StatusId.Corrode, 1000, 0, 2.5f), Eps, "上限随 S");
            Assert.AreEqual(0f, ReactionMath.CollapseDamage(StatusId.Burn, -5, 0, 1), Eps);
        }

        [Test]
        public void TicksLeftAlignsToSharedTimer()
        {
            Assert.AreEqual(8, ReactionMath.TicksLeft(4f, 0.5f, 0.5f), "一层灼烧 4 s 正好 8 跳");
            Assert.AreEqual(10, ReactionMath.TicksLeft(5f, 0.5f, 0.5f), "蚀化 5 s 10 跳");
            Assert.AreEqual(1, ReactionMath.TicksLeft(0.5f, 0.5f, 0.5f), "最后一跳与到期同帧也算");
            Assert.AreEqual(0, ReactionMath.TicksLeft(0.3f, 0.5f, 0.5f), "下一跳之前就到期");
            Assert.AreEqual(3, ReactionMath.TicksLeft(1.2f, 0.2f, 0.5f), "0.2 / 0.7 / 1.2");
        }

        // ───────────── 引爆 ─────────────

        [Test]
        public void DetonateThreeStatusesIsAbyssAndConsumesBurnAndShock()
        {
            var e = Enemy(true, true, true);
            env.Of(e).burnCash = 12;
            var j = rx.Detonate(e, Det(100), 10f, 1);
            Assert.NotNull(j);
            Assert.AreEqual(DetonateOutcome.Abyss, j.kind);
            Assert.AreEqual(ReactionOrigin.Detonate, j.origin);
            Assert.AreEqual(100f, j.pin, Eps);
            Assert.AreEqual(12f, j.cash, Eps, "灼烧结清值");
            Assert.AreEqual(1, env.Of(e).burnConsumed);
            Assert.AreEqual(1, env.Of(e).shockConsumed);
            Assert.IsTrue(env.Of(e).corrode, "蚀化保留");
            Assert.AreEqual(10f + CombatTuning.DetonateMergeDelay + CombatTuning.AbyssWindup, j.at, Eps, "推迟一帧 + 0.35 s 收束");
            Assert.AreEqual(1, env.windups);
            Assert.IsFalse(rx.Ready(e, Reaction.Abyss, 10f), "记了归墟冷却");
            Assert.IsFalse(rx.DetonateReady(e, 10.49f), "引爆冷却 0.5 s");
            Assert.IsTrue(rx.DetonateReady(e, 10.5f));
        }

        [Test]
        public void DetonateTwoStatusesPicksPairAndArmsIt()
        {
            var e = Enemy(true, false, true);
            var j = rx.Detonate(e, Det(60, mult: 1.5f), 0f, 1);
            Assert.AreEqual(DetonateOutcome.Meltdown, j.kind);
            Assert.AreEqual(90f, j.pin, Eps, "强度 × 倍率");
            Assert.AreEqual(1.5f, j.mult, Eps);
            Assert.IsFalse(rx.Ready(e, Reaction.Meltdown, 1.19f));
            Assert.IsTrue(rx.Ready(e, Reaction.Meltdown, 1.2f));
            Assert.AreEqual(0, env.Of(e).burnConsumed, "两两反应不消耗状态");

            var big = Enemy(false, true, true, maxHp: 100);
            var k = rx.Detonate(big, Det(1000), 0f, 1);
            Assert.AreEqual(DetonateOutcome.Veinseal, k.kind);
            Assert.AreEqual(50f, k.pin, Eps, "强度钳到最大生命 × 0.5");
        }

        [Test]
        public void DetonateOneStatusCollapsesWithoutConsuming()
        {
            env.dotMult = 1.5f;
            var burn = Enemy(true, false, false);
            env.Of(burn).burnRaw = 40;
            var j = rx.Detonate(burn, Det(500, mult: 2), 0f, 1);
            Assert.AreEqual(DetonateOutcome.Collapse, j.kind);
            Assert.AreEqual(StatusId.Burn, j.collapse);
            Assert.AreEqual(0.3f * 40 * 1.5f * 2, j.fixedBase.Value, Eps, "0.3 × 剩余（含属性倍率）× 引爆倍率");
            Assert.AreEqual(0, env.Of(burn).burnConsumed, "崩解不消耗状态");
            Assert.IsTrue(env.Of(burn).burn);

            var shock = Enemy(false, true, false);
            env.Of(shock).shockPower = 20;
            var k = rx.Detonate(shock, Det(500), 0f, 1);
            Assert.AreEqual(StatusId.Shock, k.collapse);
            Assert.AreEqual(30f, k.pin, Eps, "雷殛强度按反应口径乘回属性倍率（重新弹射用）");
            Assert.AreEqual(15f, k.fixedBase.Value, Eps, "0.5 × 雷殛强度");

            env.strength = 2;
            var cor = Enemy(false, false, true);
            env.Of(cor).corrodeRaw = 1000;
            var c = rx.Detonate(cor, Det(500), 0f, 1);
            Assert.AreEqual(StatusId.Corrode, c.collapse);
            Assert.AreEqual(60f, c.fixedBase.Value, Eps, "上限 30 × S");
            Assert.AreEqual(3, stats.accepted[(int)DetonateOutcome.Collapse]);
        }

        [Test]
        public void DetonatePairOnCooldownFallsBackToCollapse()
        {
            var e = Enemy(true, true, false);
            env.Of(e).burnRaw = 10;
            Assert.AreEqual(DetonateOutcome.Thunderfire, rx.Detonate(e, Det(50), 0f, 1).kind);
            // 引爆冷却过了、焚雷还在冷却（1 s）→ 崩解（灼烧优先）
            var j = rx.Detonate(e, Det(50), 0.6f, 100);
            Assert.AreEqual(DetonateOutcome.Collapse, j.kind);
            Assert.AreEqual(StatusId.Burn, j.collapse);
        }

        [Test]
        public void DetonateWithinIcdMergesSameHitOtherwiseRejects()
        {
            var e = Enemy(true, true, false);
            var first = rx.Detonate(e, Det(50), 1f, 10);
            Assert.AreEqual(DetonateOutcome.Thunderfire, first.kind);
            var again = rx.Detonate(e, Det(80, mult: 1.25f), 1f, 10);
            Assert.AreSame(first, again, "同帧并入同一条");
            Assert.AreEqual(100f, first.pin, Eps, "取较高强度（80 × 1.25）");
            Assert.AreEqual(1.25f, first.mult, Eps);
            var next = rx.Detonate(e, Det(30), 1.01f, 11);
            Assert.AreSame(first, next, "下一帧（破势）也并入");
            Assert.AreEqual(100f, first.pin, Eps, "较弱的不降低强度");
            Assert.AreEqual(1, rx.Pending.Count);
            Assert.AreEqual(2, stats.merged);
            Assert.AreEqual(1, rx.AcceptBudget.Used, "并入不占帧预算");
            Assert.IsNull(rx.Detonate(e, Det(50), 1.2f, 13), "冷却内、没有可并入的 → 拒绝");

            var batch = new List<ReactionJob>();
            rx.TakeDue(1.1f, batch);
            Assert.AreEqual(1, batch.Count);
            rx.Release(batch[0]);
            Assert.IsNull(rx.Detonate(e, Det(50), 1.3f, 20), "执行掉之后冷却内也不能并入");
        }

        [Test]
        public void DetonateMergeOfCollapseRecomputesWithHigherMult()
        {
            var e = Enemy(true, false, false);
            env.Of(e).burnRaw = 20;
            var j = rx.Detonate(e, Det(10), 0f, 5);
            Assert.AreEqual(6f, j.fixedBase.Value, Eps);
            rx.Detonate(e, Det(10, mult: 3), 0f, 5);
            Assert.AreEqual(18f, j.fixedBase.Value, Eps, "按更高倍率重算");
        }

        [Test]
        public void DetonateRejects()
        {
            Assert.IsNull(rx.Detonate(Enemy(false, false, false), Det(50), 0f, 1), "身上没有元素状态");
            Assert.IsNull(rx.Detonate(Enemy(true, true, true), Det(50, depth: 2), 0f, 1), "深度 ≥ 2");
            var dead = Enemy(true, true, true);
            dead.Kill(default);
            Assert.IsNull(rx.Detonate(dead, Det(50), 0f, 1), "已死");
            var hidden = Enemy(true, true, true);
            hidden.untargetable = true;
            Assert.IsNull(rx.Detonate(hidden, Det(50), 0f, 1), "不可选中");
            Assert.AreEqual(0, rx.Pending.Count);
            var cascade = rx.Detonate(Enemy(true, false, false), Det(50, depth: 1), 0f, 1);
            Assert.AreEqual(CombatTuning.CascadeDelay, cascade.at, Eps, "连锁引爆延后 0.15 s");
        }

        // ───────────── 强制反应 ─────────────

        [Test]
        public void TriggerOptionsIcdFixedBaseScaleTag()
        {
            var e = Enemy();
            var t = rx.Trigger(e, Reaction.Thunderfire, new TriggerOpts { power = 30, tag = DamageTag.Kalpa, weaponUid = 4 }, 0f, 1);
            Assert.NotNull(t, "不需要元素状态");
            Assert.AreEqual(ReactionOrigin.Forced, t.origin);
            Assert.AreEqual(DamageTag.Kalpa, t.tag);
            Assert.AreEqual(30f, t.pin, Eps);
            Assert.AreEqual(1f, t.scale, Eps, "scale 未设视为 1");
            Assert.AreEqual(4, t.weaponUid);
            Assert.IsNull(t.fixedBase);
            Assert.IsNull(rx.Trigger(e, Reaction.Thunderfire, new TriggerOpts { power = 30 }, 0.5f, 2), "冷却中");
            var forced = rx.Trigger(e, Reaction.Thunderfire, new TriggerOpts { power = 30, ignoreIcd = true, fixedBase = 123, scale = 0.5f }, 0.5f, 2);
            Assert.NotNull(forced, "ignoreIcd 无视冷却");
            Assert.AreEqual(123f, forced.fixedBase.Value, Eps);
            Assert.AreEqual(0.5f, forced.scale, Eps);
            Assert.IsNull(rx.Trigger(e, Reaction.Meltdown, new TriggerOpts { power = 30, depth = 2 }, 0.5f, 2), "深度 ≥ 2");
            Assert.AreEqual(2, stats.byOrigin[(int)ReactionOrigin.Forced]);
        }

        [Test]
        public void TriggerOnDeadOrDestroyedEnemy()
        {
            var dead = Enemy();
            dead.Kill(default);
            var j = rx.Trigger(dead, Reaction.Meltdown, new TriggerOpts { power = 20 }, 0f, 1);
            Assert.NotNull(j, "敌人已死也可以强制反应（范围部分照常）");
            Assert.IsTrue(j.killed);
            Assert.IsTrue(rx.Ready(dead, Reaction.Meltdown, 0f), "死了不记冷却");

            var gone = Enemy();
            Object.DestroyImmediate(gone.gameObject);
            Assert.IsNull(rx.Trigger(gone, Reaction.Thunderfire, new TriggerOpts { power = 20 }, 0f, 1), "没了的敌人要给中心点");
            var p = new Vector3(1, 2, 3);
            var k = rx.Trigger(gone, Reaction.Abyss, new TriggerOpts { power = 20, point = p }, 0f, 1);
            Assert.NotNull(k);
            Assert.AreEqual(p, k.point);
            Assert.AreEqual(CombatTuning.AbyssWindup, k.at, Eps, "归墟同样 0.35 s 收束");
            Assert.AreEqual(1, env.windups);
        }

        // ───────────── 元素附着 ─────────────

        [Test]
        public void AttachCarriesReactionScaleOriginAndCascadeDelay()
        {
            var e = Enemy(false, false, true, maxHp: 100);
            var j = rx.TryReact(e, Element.Shock, 80, 0, false, 7, 0.6f, 5f, 1);
            Assert.AreEqual(DetonateOutcome.Veinseal, j.kind);
            Assert.AreEqual(ReactionOrigin.Status, j.origin);
            Assert.AreEqual(0.6f, j.scale, Eps, "reactionScale");
            Assert.AreEqual(7, j.weaponUid);
            Assert.AreEqual(50f, j.pin, Eps, "钳到最大生命 × 0.5");
            Assert.AreEqual(5f, j.at, Eps, "直接命中立即执行");

            var f = Enemy(true, false, false);
            var c = rx.TryReact(f, Element.Corrode, 10, 1, false, 0, 1, 5f, 1);
            Assert.AreEqual(5f + CombatTuning.CascadeDelay, c.at, Eps, "连锁延后 0.15 s");
            Assert.IsNull(rx.TryReact(Enemy(true, false, false), Element.Corrode, 10, 2, false, 0, 1, 5f, 1), "深度 ≥ 2 不反应");
        }

        [Test]
        public void AttachAbyssConsumesOnlyTheOtherTwo()
        {
            var a = Enemy(true, true, false);
            env.Of(a).burnCash = 7;
            var j = rx.TryReact(a, Element.Corrode, 50, 0, false, 0, 1, 0f, 1);
            Assert.AreEqual(DetonateOutcome.Abyss, j.kind);
            Assert.AreEqual(7f, j.cash, Eps);
            Assert.AreEqual(1, env.Of(a).burnConsumed);
            Assert.AreEqual(1, env.Of(a).shockConsumed);
            Assert.AreEqual(CombatTuning.AbyssWindup, j.at, Eps);

            var b = Enemy(true, true, true);
            var k = rx.TryReact(b, Element.Fire, 50, 0, false, 0, 1, 0f, 1);
            Assert.AreEqual(DetonateOutcome.Abyss, k.kind);
            Assert.AreEqual(0, env.Of(b).burnConsumed, "incoming 是火时，身上已有的灼烧不算「另外两种」，不消耗");
            Assert.AreEqual(1, env.Of(b).shockConsumed);
        }

        [Test]
        public void IcdIsPerEnemyPerReactionAndUsesHaste()
        {
            env.haste = 1;
            var e = Enemy(false, true, false);
            Assert.NotNull(rx.TryReact(e, Element.Fire, 20, 0, false, 0, 1, 0f, 1));
            Assert.IsNull(rx.TryReact(e, Element.Fire, 20, 0, false, 0, 1, 0.49f, 2), "急速 100%：冷却 0.5 s");
            Assert.NotNull(rx.TryReact(e, Element.Fire, 20, 0, false, 0, 1, 0.5f, 3));
            Assert.NotNull(rx.TryReact(Enemy(false, true, false), Element.Fire, 20, 0, false, 0, 1, 0.5f, 3), "别的敌人不受影响");
            Assert.IsTrue(rx.Ready(e, Reaction.Meltdown, 0.5f), "别的反应不受影响");
        }

        // ───────────── 预算 ─────────────

        [Test]
        public void EightReactionsPerFrameAndQueueCap()
        {
            for (int i = 0; i < 8; i++)
                Assert.NotNull(rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 0, false, 0, 1, 0f, 1), $"第 {i + 1} 个");
            Assert.IsNull(rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 0, false, 0, 1, 0f, 1), "本帧第 9 个被拒");
            Assert.IsNull(rx.Trigger(Enemy(), Reaction.Abyss, new TriggerOpts { power = 10 }, 0f, 1), "强制反应同样占预算");
            Assert.AreEqual(2, stats.dropped);
            Assert.AreEqual(8, stats.frameMax);

            // 队列上限 32：后面几帧继续塞（都延后执行，留在队列里）
            for (int f = 2; f <= 4; f++)
                for (int i = 0; i < 8; i++)
                    Assert.NotNull(rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 1, false, 0, 1, 0f, f));
            Assert.AreEqual(32, rx.Pending.Count);
            Assert.IsNull(rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 1, false, 0, 1, 0f, 5), "队列满");
        }

        [Test]
        public void TakeDueReturnsOnlyDueJobsInOrder()
        {
            var a = rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 1, false, 0, 1, 0f, 1); // 0.15
            var b = rx.TryReact(Enemy(true, false, false), Element.Shock, 20, 0, false, 0, 1, 0f, 1); // 0
            var c = rx.Trigger(Enemy(), Reaction.Abyss, new TriggerOpts { power = 10 }, 0f, 1);       // 0.35
            var batch = new List<ReactionJob>();
            rx.TakeDue(0.2f, batch);
            CollectionAssert.AreEqual(new[] { a, b }, batch);
            Assert.AreEqual(1, rx.Pending.Count);
            Assert.AreSame(c, rx.Pending[0]);
            foreach (var j in batch) rx.Release(j);
            Assert.IsNull(a.enemy, "归还后清空");
        }

        [Test]
        public void FrameBudgetResetsEachFrame()
        {
            var fx = new FrameBudget(CombatTuning.BigFxBudget);
            Assert.IsTrue(fx.TryTake(1));
            Assert.IsTrue(fx.TryTake(1));
            Assert.IsTrue(fx.TryTake(1));
            Assert.IsFalse(fx.TryTake(1), "大特效每帧 3 个");
            Assert.IsTrue(fx.TryTake(2), "下一帧清零");
            Assert.AreEqual(3, fx.Peak);
            Assert.AreEqual(1, fx.Denied);
        }

        [Test]
        public void LabelsFourPerFrameAndPerEnemyGap()
        {
            var t = new LabelThrottle();
            var e = new Damageable[5];
            for (int i = 0; i < e.Length; i++) e[i] = Enemy();
            for (int i = 0; i < 4; i++) Assert.IsTrue(t.Allow(e[i], false, 0f, 1), $"第 {i + 1} 条");
            Assert.IsFalse(t.Allow(e[4], false, 0f, 1), "每帧最多 4 条");
            Assert.IsFalse(t.Allow(e[4], true, 0f, 1), "大号也受每帧预算限制");
            Assert.IsFalse(t.Allow(e[0], false, 0.1f, 2), "同一敌人 0.3 s 一条");
            Assert.IsTrue(t.Allow(e[0], true, 0.1f, 2), "大号（归墟）不受逐敌节流");
            Assert.IsTrue(t.Allow(e[1], false, 0.31f, 3));
            Assert.AreEqual(4, t.Budget.Peak);
        }

        // ───────────── 封脉首领 / 眩晕冷却 ─────────────

        [Test]
        public void BossVulnAndSealStunCooldown()
        {
            var boss = Enemy();
            boss.rank = Rank.Boss;
            Incoming mod = (in IncomingHit h) => rx.VulnMult(h.target, 4f);
            rx.MarkVuln(boss, 5f, mod);
            rx.MarkVuln(boss, 5f, mod);
            Assert.AreEqual(1, boss.Incoming.Count, "修饰器只登记一次，之后只续时间");
            Assert.AreEqual(1.12f, rx.VulnMult(boss, 4.9f), Eps);
            Assert.AreEqual(1f, rx.VulnMult(boss, 5f), Eps, "到期恢复");
            Assert.AreEqual(1f, rx.VulnMult(Enemy(), 4f), Eps);

            var e = Enemy();
            Assert.IsTrue(rx.TryArmSealStun(e, 0f));
            Assert.IsFalse(rx.TryArmSealStun(e, 3.4f), "封脉眩晕 3.5 s 一次");
            Assert.IsTrue(rx.TryArmSealStun(e, 3.5f));

            rx.Clear();
            Assert.AreEqual(0, boss.Incoming.Count, "清场撤掉脉滞修饰器");
        }

        // ───────────── 处理器注册表 ─────────────

        [Test]
        public void EveryOutcomeHasExactlyOneHandler()
        {
            var table = ReactionHandlers.Table;
            Assert.AreEqual(5, table.Length);
            for (int i = 0; i < table.Length; i++)
            {
                Assert.NotNull(table[i], $"{(DetonateOutcome)i} 没有处理器");
                Assert.AreEqual((DetonateOutcome)i, table[i].Kind);
            }
            Assert.IsInstanceOf<ThunderfireHandler>(ReactionHandlers.Get(DetonateOutcome.Thunderfire));
            Assert.IsInstanceOf<MeltdownHandler>(ReactionHandlers.Get(DetonateOutcome.Meltdown));
            Assert.IsInstanceOf<VeinsealHandler>(ReactionHandlers.Get(DetonateOutcome.Veinseal));
            Assert.IsInstanceOf<AbyssHandler>(ReactionHandlers.Get(DetonateOutcome.Abyss));
            Assert.IsInstanceOf<CollapseHandler>(ReactionHandlers.Get(DetonateOutcome.Collapse));
        }
    }
}
