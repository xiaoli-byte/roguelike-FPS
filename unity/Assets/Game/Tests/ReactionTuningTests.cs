using System;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 元素反应与元素状态的调参和 Three.js 版一致（docs/unity-parity.md 7.2「契约」）。对照值抄自代码，不抄文档：
    ///   src/combat/Reactions.ts（REACTION_TUNING、总则常量、reactionBase）、src/combat/Status.ts（灼烧 / 雷殛 / 蚀化）、
    ///   src/combat/DamageCalc.ts（SHOCK_MARK_BONUS）；名字和颜色对 docs/arsenal-expansion.md 2.3 / 2.9。
    ///   （文档 2.2 的「灼烧结清 × 0.22」是旧值，代码里结清按 BURN_RATIO 0.16 算，以代码为准。）
    /// Unity 侧的调参大多是 ReactionSystem 的私有常量，这里用反射读——C1 把它们搬进 CombatTuning 时，改 <see cref="Rx"/> 一处即可。
    /// 只断言「本来就该相等」的数；Unity 还没有的（引爆冷却 0.5 s、大特效 / 浮字预算）等 C1 落地后再加。
    /// </summary>
    public sealed class ReactionTuningTests
    {
        const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;

        /// <summary>Unity 侧调参的读取口：C1 之后都在 <see cref="CombatTuning"/> / <see cref="ReactionMath"/> 里（单一来源）</summary>
        static class Rx
        {
            static readonly System.Collections.Generic.Dictionary<string, object> Consts = new()
            {
                ["MaxDepth"] = CombatTuning.MaxReactionDepth,
                ["FrameBudget"] = CombatTuning.FrameBudget,
                ["QueueCap"] = CombatTuning.QueueCap,
                ["MaxPools"] = CombatTuning.Meltdown.MaxPools,
                ["CascadeDelay"] = CombatTuning.CascadeDelay,
                ["AbyssWindup"] = CombatTuning.AbyssWindup,
                ["IcdFloor"] = CombatTuning.IcdFloor,
                ["SealStunIcd"] = CombatTuning.Veinseal.StunIcd,
            };

            public static T Const<T>(string name) =>
                Consts.TryGetValue(name, out var v) ? (T)v : throw new AssertionException($"CombatTuning 里没有对应 {name} 的常量");

            /// <summary>反应调参的 (k, floor, cap, icd)</summary>
            public static (float k, float floor, float cap, float icd) Tune(Reaction id)
            {
                var t = CombatTuning.Of(id);
                return (t.k, t.floor, t.cap, t.icd);
            }

            public static float Base(Reaction id, float pin, float s) => ReactionMath.Base(id, pin, s);

            public static float LevelScale(Damageable d) => new GameReactionEnv().Strength(d);
        }

        /// <summary>REACTION_TUNING（Reactions.ts）</summary>
        static readonly (Reaction id, float k, float floor, float cap, float icd)[] TsTuning =
        {
            (Reaction.Thunderfire, 1.0f, 14, 80, 1.0f),
            (Reaction.Meltdown, 1.0f, 14, 100, 1.2f),
            (Reaction.Veinseal, 1.0f, 14, 90, 1.2f),
            (Reaction.Abyss, 1.5f, 40, 320, 6.0f),
        };

        /// <summary>reactionBase（Reactions.ts）：clamp(k × pin, floor × S, cap × S)，pin 非有限时按 0</summary>
        static float TsBase(Reaction id, float pin, float s)
        {
            var t = Array.Find(TsTuning, x => x.id == id);
            float p = float.IsNaN(pin) || float.IsInfinity(pin) ? 0 : Math.Max(0, pin);
            return Math.Min(Math.Max(t.k * p, t.floor * s), t.cap * s);
        }

        [Test]
        public void TuningTableMatchesThreeJs()
        {
            Assert.AreEqual(4, Enum.GetValues(typeof(Reaction)).Length, "反应种类");
            foreach (var (id, k, floor, cap, icd) in TsTuning)
            {
                var u = Rx.Tune(id);
                Assert.AreEqual(k, u.k, 1e-5f, $"{id}.k");
                Assert.AreEqual(floor, u.floor, 1e-5f, $"{id} 下限（× S）");
                Assert.AreEqual(cap, u.cap, 1e-5f, $"{id} 上限（× S）");
                Assert.AreEqual(icd, u.icd, 1e-5f, $"{id} 基础冷却");
            }
        }

        [Test]
        public void GeneralConstantsMatchThreeJs()
        {
            Assert.AreEqual(2, Rx.Const<int>("MaxDepth"), "MAX_REACTION_DEPTH");
            Assert.AreEqual(8, Rx.Const<int>("FrameBudget"), "FRAME_BUDGET");
            Assert.AreEqual(32, Rx.Const<int>("QueueCap"), "QUEUE_CAP");
            Assert.AreEqual(4, Rx.Const<int>("MaxPools"), "MAX_POOLS");
            Assert.AreEqual(0.15f, Rx.Const<float>("CascadeDelay"), 1e-6f, "CASCADE_DELAY");
            Assert.AreEqual(0.35f, Rx.Const<float>("AbyssWindup"), 1e-6f, "ABYSS_WINDUP");
            Assert.AreEqual(0.3f, Rx.Const<float>("IcdFloor"), 1e-6f, "ICD_FLOOR");
            Assert.AreEqual(3.5f, Rx.Const<float>("SealStunIcd"), 1e-6f, "SEAL_STUN_ICD");
        }

        [Test]
        public void ReactionBaseMatchesThreeJs()
        {
            var pins = new[] { 0f, -5f, 5f, 13.9f, 14f, 40f, 79f, 80f, 100f, 213.3f, 320f, 1000f, 1e6f };
            var scales = new[] { 1f, 1.41f, 1.77f, 2.94f };
            foreach (var (id, _, _, _, _) in TsTuning)
            foreach (var s in scales)
            foreach (var pin in pins)
                Assert.AreEqual(TsBase(id, pin, s), Rx.Base(id, pin, s), 1e-3f, $"B({id}, pin {pin}, S {s})");
        }

        [Test]
        public void LevelScaleIsOnePlusPoint85PerLevel()
        {
            Assert.AreEqual(1f, Rx.LevelScale(null), 1e-6f, "没有敌人：S = 1");
            // 停用状态下挂组件：EditMode 里不跑 Awake / OnEnable，NavMeshAgent 不会去找导航网格
            var go = new GameObject("ReactionTuningTests Enemy") { hideFlags = HideFlags.HideAndDontSave };
            go.SetActive(false);
            try
            {
                var d = go.AddComponent<Damageable>();
                var aiType = Registry<EnemyDef>.All.Count > 0 ? Registry<EnemyDef>.All[0].ai : null;
                Assume.That(aiType, Is.Not.Null, "名册里没有敌人，测不了按等级的 S");
                var ai = (EnemyAI)go.AddComponent(aiType);
                foreach (var (level, s) in new[] { (1f, 1f), (0.5f, 1f), (1.48f, 1.408f), (2.2f, 2.02f), (3.4f, 3.04f) })
                {
                    ai.level = level;
                    Assert.AreEqual(s, Rx.LevelScale(d), 1e-4f, $"S = 1 + max(0, 难度 − 1) × 0.85，难度 {level}（docs/arsenal-expansion.md 1.2）");
                }
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void NamesColorsAndTagsMatchDesign()
        {
            Assert.AreEqual(new[] { "焚雷", "熔金", "封脉", "归墟" }, ReactionSystem.Names);
            var hex = new[] { 0xffd84a, 0xff7a1a, 0x5affd0, 0xc89bff };
            for (int i = 0; i < hex.Length; i++)
            {
                var want = Hex.Rgb(hex[i]);
                var got = ReactionSystem.Colors[i];
                Assert.AreEqual(want.r, got.r, 0.006f, $"{ReactionSystem.Names[i]} 颜色 R（#{hex[i]:x6}）");
                Assert.AreEqual(want.g, got.g, 0.006f, $"{ReactionSystem.Names[i]} 颜色 G（#{hex[i]:x6}）");
                Assert.AreEqual(want.b, got.b, 0.006f, $"{ReactionSystem.Names[i]} 颜色 B（#{hex[i]:x6}）");
            }
            // TS TAGS：[REACTION_TAG, <反应 id>]
            Assert.AreEqual(DamageTag.Reaction | DamageTag.Thunderfire, ReactionSystem.TagOf(Reaction.Thunderfire));
            Assert.AreEqual(DamageTag.Reaction | DamageTag.Meltdown, ReactionSystem.TagOf(Reaction.Meltdown));
            Assert.AreEqual(DamageTag.Reaction | DamageTag.Veinseal, ReactionSystem.TagOf(Reaction.Veinseal));
            Assert.AreEqual(DamageTag.Reaction | DamageTag.Abyss, ReactionSystem.TagOf(Reaction.Abyss));
        }

        [Test]
        public void StatusConstantsMatchThreeJs()
        {
            // 灼烧（Status.ts BURN_*）
            Assert.AreEqual(4f, EnemyStatus.BurnDuration, 1e-6f, "BURN_DURATION");
            Assert.AreEqual(0.5f, EnemyStatus.BurnTick, 1e-6f, "BURN_TICK");
            Assert.AreEqual(0.16f, EnemyStatus.BurnRatio, 1e-6f, "BURN_RATIO");
            Assert.AreEqual(3, EnemyStatus.BurnMaxStacks, "BURN_MAX_STACKS");
            // 雷殛（SHOCK_*）
            Assert.AreEqual(3f, EnemyStatus.ShockDuration, 1e-6f, "SHOCK_MARK_DURATION");
            Assert.AreEqual(8f, EnemyStatus.ShockChainRange, 1e-6f, "SHOCK_CHAIN_RANGE");
            Assert.AreEqual(3, EnemyStatus.ShockChainTargets, "SHOCK_CHAIN_TARGETS");
            Assert.AreEqual(0.5f, EnemyStatus.ShockChainRatio, 1e-6f, "SHOCK_CHAIN_RATIO");
            Assert.AreEqual(3, EnemyStatus.ShockStunStacks, "SHOCK_STUN_STACKS");
            Assert.AreEqual(0.8f, EnemyStatus.ShockStun, 1e-6f, "SHOCK_STUN_DURATION");
            Assert.AreEqual(1.15f, EnemyStatus.ShockMarkBonus, 1e-6f, "SHOCK_MARK_BONUS（DamageCalc.ts）");
            // 蚀化（CORRODE_*）
            Assert.AreEqual(5f, EnemyStatus.CorrodeDuration, 1e-6f, "CORRODE_DURATION");
            Assert.AreEqual(0.5f, EnemyStatus.CorrodeTick, 1e-6f, "CORRODE_TICK");
            Assert.AreEqual(0.08f, EnemyStatus.CorrodeRatio, 1e-6f, "CORRODE_RATIO");
            Assert.AreEqual(1.2f, EnemyStatus.CorrodeTaken, 1e-6f, "CORRODE_DAMAGE_TAKEN");
            Assert.AreEqual(0.8f, EnemyStatus.CorrodeSlow, 1e-6f, "CORRODE_SLOW");
        }

        [Test]
        public void BurnTotalPerApplicationIsPowerTimes128()
        {
            // Status.ts：一层完整烧完 8 跳 = power × 1.28（每次附着的总灼烧伤害固定）
            float ticks = EnemyStatus.BurnDuration / EnemyStatus.BurnTick;
            Assert.AreEqual(8f, ticks, 1e-5f);
            Assert.AreEqual(1.28f, EnemyStatus.BurnRatio * ticks, 1e-5f);
        }
    }
}
