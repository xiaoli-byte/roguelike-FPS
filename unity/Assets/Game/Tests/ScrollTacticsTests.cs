using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 清掉上一次 Play 模式留在静态里的订阅与修饰器。本项目进 Play 模式时重载域（静态由各类型 SubsystemRegistration 的重置方法清零），
    /// <b>退出</b> Play 模式时不重载：试玩里装上的秘卷作用域（LootDirector 的持有表随场景销毁，但从不 Clear）在 GameEvents /
    /// Combat.Outgoing / PlayerVitals.Incoming 上登记的回调一直挂到下一次编译。共用编辑器里试玩（机器人选卷、flow / menu / scrolls 套件授卷）
    /// 和 EditMode 测试交替跑，这些残余会接到测试派发的事件：<see cref="TacticsKit.Host"/> 是静态的，残留的 1 层「换位掩护」照样往
    /// 假接缝的护盾上加 8（16 → 24），残留的 1 层「双诀相生」多返还一次冷却（1.5 / 4.5）——结果取决于之前跑过哪个试玩、抽到了哪卷。
    /// 这里照 Play 模式开始时的做法，调用这几个类型上标了 [RuntimeInitializeOnLoadMethod(SubsystemRegistration)] 的静态重置方法
    /// （GameEvents 的各个 partial 各有一个，按特性找，新加的 partial 自动覆盖）。编辑模式下没有别的订阅者（编辑器程序集不订阅这些事件）。
    /// </summary>
    internal static class PlayModeLeftovers
    {
        static readonly System.Type[] Owners = { typeof(GameEvents), typeof(Combat), typeof(PlayerVitals) };

        public static void Reset()
        {
            foreach (var t in Owners)
                foreach (var m in t.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                {
                    var a = m.GetCustomAttribute<RuntimeInitializeOnLoadMethodAttribute>();
                    if (a != null && a.loadType == RuntimeInitializeLoadType.SubsystemRegistration && m.GetParameters().Length == 0) m.Invoke(null, null);
                }
        }
    }

    /// <summary>
    /// 秘卷测试用的假接缝（<see cref="IScrollHost"/>）：玩家、武器、技能冷却、范围查询、概率、反应系统、爆炸与投射物都换成可观察的替身。
    /// 爆炸替身按身体中心距离判定范围、不做距离衰减（<see cref="walled"/> 里的敌人当作被墙挡住），对范围内的敌人走真实的 <see cref="Combat.DamageEnemy"/>。
    /// </summary>
    internal sealed class FakeScrollHost : IScrollHost
    {
        public StatSheet sheet;
        public bool alive = true;
        public Vector3 position;
        public float shield;
        public readonly List<(float seconds, SkillSlot? slot)> cooldowns = new();

        public WeaponInstance active;
        public bool reloading, melee;
        public int magCapacity = 10;

        public bool chance = true;
        public readonly List<float> chances = new();
        public readonly List<Damageable> enemies = new();
        public readonly HashSet<Damageable> walled = new();
        public Damageable aim;

        public bool explodeDamages = true;
        public readonly List<ExplosionOptions> explosions = new();
        public readonly List<PlayerProjectileSpec> projectiles = new();
        public readonly List<(Damageable d, Element e, float power, StatusApplyOpts opts)> applied = new();
        public readonly List<(Damageable d, DetonateOpts opts)> detonations = new();
        public DetonateOutcome? detonateResult = DetonateOutcome.Collapse;
        public readonly List<(Damageable d, Reaction id, TriggerOpts opts)> triggers = new();
        public bool triggerAccepts = true;
        public readonly List<(Damageable d, float seconds)> stuns = new();

        public bool Alive => alive;
        public Vector3 Position => position;
        public float Shield => shield;
        public float MaxShield => sheet != null ? sheet.Get(Stat.MaxShield) : 50;

        public float AddShield(float amount)
        {
            float d = Mathf.Max(0, Mathf.Min(amount, MaxShield - shield));
            shield += d;
            return d;
        }

        public void ReduceCooldowns(float seconds, SkillSlot? slot) => cooldowns.Add((seconds, slot));

        public WeaponInstance ActiveWeapon => active;
        public bool Reloading => reloading;
        public int MagCapacity(WeaponInstance w) => magCapacity;
        public bool IsMelee(WeaponInstance w) => melee;

        public int Near(Vector3 center, float radius, Damageable exclude, List<Damageable> results)
        {
            results.Clear();
            foreach (var e in enemies)
                if (e && !e.Dead && !e.untargetable && e != exclude && (ScrollKit.BodyCenter(e) - center).sqrMagnitude <= radius * radius)
                    results.Add(e);
            return results.Count;
        }

        public bool Blocked(Vector3 from, Damageable target) => walled.Contains(target);
        public Damageable AimTarget(float range, float fallbackRange) => aim;

        /// <summary>敌人身上的元素状态（只记在这里，不碰 EnemyStatus：EditMode 下状态光晕的 Destroy 会报错）</summary>
        public readonly Dictionary<Damageable, HashSet<Element>> statuses = new();

        public bool HasStatus(Damageable target, Element element) => target && statuses.TryGetValue(target, out var set) && set.Contains(element);

        public void Give(Damageable target, params Element[] elements)
        {
            if (!statuses.TryGetValue(target, out var set)) statuses[target] = set = new HashSet<Element>();
            foreach (var e in elements) set.Add(e);
        }

        public bool Chance(float p)
        {
            chances.Add(p);
            return chance;
        }

        public int Explode(in ExplosionOptions o)
        {
            explosions.Add(o);
            if (!explodeDamages) return 0;
            int hits = 0;
            foreach (var e in enemies.ToArray())
            {
                if (!e || e.Dead || e.untargetable || e == o.excludeOne || walled.Contains(e)) continue;
                if ((ScrollKit.BodyCenter(e) - o.center).magnitude > o.radius) continue;
                var info = o.info;
                info.tags |= DamageTag.Explosion;
                info.weakpoint = false;
                if (Combat.DamageEnemy(e, info).total > 0) hits++;
            }
            return hits;
        }

        public void SpawnProjectile(in PlayerProjectileSpec spec) => projectiles.Add(spec);

        public Reaction? ApplyStatus(Damageable target, Element element, float power, in StatusApplyOpts opts)
        {
            applied.Add((target, element, power, opts));
            return null;
        }

        public DetonateOutcome? Detonate(Damageable target, in DetonateOpts opts)
        {
            detonations.Add((target, opts));
            return detonateResult;
        }

        public Reaction? Trigger(Damageable target, Reaction id, in TriggerOpts opts)
        {
            triggers.Add((target, id, opts));
            return triggerAccepts ? id : null;
        }

        public bool Stun(Damageable target, float seconds)
        {
            stuns.Add((target, seconds));
            return true;
        }
    }

    /// <summary>
    /// 秘卷钩子测试的共用夹具：真实的 <see cref="ScrollInventory"/> / <see cref="StatSheet"/> / <see cref="GameEvents"/> / <see cref="Combat.DamageEnemy"/> /
    /// <see cref="PlayerVitals.Incoming"/>，秘卷时钟手动推进（<see cref="ScrollTicker.Step"/>，EditMode 下每次 Step 算新的一帧），外界换成 <see cref="FakeScrollHost"/>。
    /// 玩家受伤按 PlayerVitals.TakeDamage 的顺序模拟：无敌 → × (1 − 减伤) → 受伤修饰器（乘到 0 即停）。
    /// 每个用例开始前先清掉 Play 模式留下的静态残余（<see cref="PlayModeLeftovers"/>），结果不取决于编辑器里之前跑过什么。
    /// </summary>
    public abstract class ScrollHostFixture
    {
        protected const float Eps = 1e-3f;
        protected StatSheet sheet;
        internal FakeScrollHost host;
        protected ScrollInventory inv;
        protected WeaponInstance a, b;
        /// <summary>模拟的玩家生命（TS 夹具同为 50）</summary>
        protected float hp;
        readonly List<GameObject> made = new();
        StatSheet savedStats;
        RunState savedRun;

        [SetUp]
        public void SetUpHost()
        {
            PlayModeLeftovers.Reset();
            ScrollTicker.ResetForTests();
            savedStats = Combat.playerStats;
            savedRun = RunState.Current;
            RunState.Current = null;
            sheet = StatSheet.Default();
            Combat.playerStats = sheet;
            a = Gun();
            b = Gun();
            host = new FakeScrollHost { sheet = sheet, active = a };
            TacticsKit.Host = host;
            inv = new ScrollInventory();
            hp = 50;
        }

        [TearDown]
        public void TearDownHost()
        {
            inv?.Clear();
            TacticsKit.Host = null;
            Combat.playerStats = savedStats;
            RunState.Current = savedRun;
            ScrollTicker.ResetForTests();
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        protected static WeaponInstance Gun() => new(new WeaponDef { id = "t_scroll_gun", name = "测试枪", mag = 3, reserve = 40 });

        protected Damageable Enemy(float x = 1, float maxHp = 10000, Rank rank = Rank.Normal, float armor = 0, float shield = 0)
        {
            var go = new GameObject("scroll test enemy");
            made.Add(go);
            go.transform.position = new Vector3(x, 0, 0);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.maxArmor = armor;
            d.maxShield = shield;
            d.rank = rank;
            d.ResetVitals();
            host.enemies.Add(d);
            return d;
        }

        protected ScrollDef Def(string id)
        {
            var d = ScrollLibrary.Get(id);
            Assert.IsNotNull(d, $"秘卷 {id} 没有登记");
            return d;
        }

        protected void Gain(string id, int n = 1)
        {
            var d = Def(id);
            for (int i = 0; i < n; i++) inv.Gain(d, sheet);
        }

        protected static void Step(float dt) => ScrollTicker.Step(dt);

        /// <summary>一击（默认：手上武器的直接命中，100 无属性，不随机暴击）</summary>
        protected DamageResult Hit(Damageable e, float amount = 100, DamageSource source = DamageSource.Weapon, int depth = 0, bool crit = false,
            bool weak = false, int? uid = null, DamageTag tags = DamageTag.None, Element element = Element.None, float statusChance = 0)
        {
            var i = DamageInfo.Simple(amount, source, ScrollKit.BodyCenter(e), Vector3.forward);
            i.noCrit = true;
            i.forceCrit = crit;
            i.weakpoint = weak;
            i.depth = depth;
            i.tags = tags;
            i.element = element;
            i.statusChance = statusChance;
            i.weaponUid = uid ?? host.active?.uid ?? 0;
            return Combat.DamageEnemy(e, i);
        }

        /// <summary>某种反应的伤害（Status 来源、反应标签、只吃反应伤害）：深度为引发它的附着深度（伤害本身 +1）</summary>
        protected DamageResult ReactionHit(Damageable e, Reaction id, float amount = 100, int depth = 0, Element element = Element.None) =>
            Combat.DamageEnemy(e, ReactionSystem.ReactionHit(amount, element, depth, ScrollKit.BodyCenter(e), id, host.active?.uid ?? 0));

        protected static void Reacted(Reaction id, int depth = 0, Damageable enemy = null, Vector3 point = default, float B = 100,
            ReactionOrigin origin = ReactionOrigin.Status, bool stunned = false)
        {
            var ev = new ReactionEvent { enemy = enemy, id = id, depth = depth, point = point, B = B, origin = origin, stunned = stunned };
            GameEvents.RaiseReacted(in ev);
        }

        protected void Switch(WeaponInstance next)
        {
            var prev = host.active;
            host.active = next;
            GameEvents.RaiseWeaponSwitched(prev, next);
        }

        protected static void Use(SkillSlot slot) => GameEvents.RaiseSkillUsed(slot, "test");
        protected static void Dash() => GameEvents.RaisePlayerDashed(Vector3.forward);
        protected static void Landed(float fall) => GameEvents.RaisePlayerLanded(fall);
        protected static void StageLoaded() => GameEvents.RaiseStageLoaded(null);
        protected static void Died() => GameEvents.RaisePlayerDied();

        /// <summary>回复生命（同 TS 夹具的 heal：只在实际回复 &gt; 0 时发 PlayerHealed）</summary>
        protected float Heal(float amount)
        {
            float d = Mathf.Max(0, Mathf.Min(amount, sheet.Get(Stat.MaxHp) - hp));
            hp += d;
            if (d > 0) GameEvents.RaisePlayerHealed(d);
            return d;
        }

        struct IncomingCall : IModifierCall<Incoming>
        {
            public IncomingHit h;

            public float Invoke(Incoming fn, float current)
            {
                h.amount = current;
                return fn(in h);
            }
        }

        /// <summary>玩家受伤（按 PlayerVitals.TakeDamage 的顺序：无敌时不扣、受伤修饰器不求值）：返回扣掉的量</summary>
        protected float DamagePlayer(float amount, bool invulnerable = false)
        {
            if (invulnerable) return 0;
            amount *= 1 - Mathf.Clamp(sheet.Get(Stat.DamageReduction), 0, 0.8f);
            var call = new IncomingCall { h = new IncomingHit { amount = amount } };
            amount = PlayerVitals.Incoming.Apply(amount, ref call, stopAtZero: true);
            hp -= amount;
            return amount;
        }

        protected static void Close(float expected, float actual, string message = null) => Assert.AreEqual(expected, actual, Eps, message);

        /// <summary>接缝收到的概率依次是 expected（容差比较）</summary>
        protected void AssertChances(params float[] expected)
        {
            Assert.AreEqual(expected.Length, host.chances.Count, "掷骰次数");
            for (int i = 0; i < expected.Length; i++) Close(expected[i], host.chances[i], $"第 {i + 1} 次掷骰的概率");
        }
    }

    /// <summary>
    /// 战术秘卷（S6）：移植 tests/scroll-tactics.test.mjs 里属于战术组的用例（连击心法 / 流星 / 聚宝盆是 S1 / S3b 的卷，由它们的单元移植），
    /// 数值对照 src/progression/scrolls/defsTactics.ts 与 docs/scroll-tactics.md。真实的属性表、事件、伤害管线与玩家受伤修饰器；
    /// 玩家 / 武器 / 技能 / 爆炸经 <see cref="FakeScrollHost"/>。
    /// </summary>
    public sealed class ScrollTacticsTests : ScrollHostFixture
    {
        static readonly string[] TacticIds =
        {
            "tac_crossfire", "tac_cover_change", "tac_reload_guard", "tac_loaded_focus", "tac_dash_load", "tac_dash_wave", "tac_landing_wave",
            "tac_battle_mage", "tac_spell_ward", "tac_alternating_arts", "tac_pristine_shield", "tac_emergency_reload", "tac_healing_barrier",
            "tac_crit_insight", "tac_focused_prey", "tac_reaction_ward", "tac_reaction_stride", "tac_stagger_hunter", "tac_dash_capstone",
            "tac_spellgun_cycle",
        };

        static List<ScrollDef> Tactics => TacticIds.Select(ScrollLibrary.Get).ToList();

        [Test]
        public void AllTwentyTacticsRollWithNormalRarityExclusionsAndStackCaps()
        {
            var tactics = Tactics;
            Assert.IsTrue(tactics.All(d => d != null), "20 卷战术都登记了");
            CollectionAssert.AreEqual(TacticIds, Registry<ScrollDef>.All.Where(d => d.id.StartsWith("tac_")).Select(d => d.id).ToArray(), "按 TS 顺序登记");
            var all = Registry<ScrollDef>.All;
            Assert.AreEqual(all.Count, all.Select(d => d.id).Distinct().Count(), "id 不重复");
            Assert.AreEqual(all.Count, all.Select(d => d.name).Distinct().Count(), "名字不重复");
            var byRarity = new int[5];
            foreach (var d in tactics) byRarity[d.rarity]++;
            CollectionAssert.AreEqual(new[] { 2, 6, 8, 2, 2 }, byRarity, "稀有度分布同 TS");
            Assert.IsEmpty(ScrollLibrary.Validate(tactics, out _), "数据校验");
            Assert.AreEqual(2, Def("tac_reaction_stride").maxStacks);
            Assert.AreEqual(1, Def("tac_dash_capstone").maxStacks);
            Assert.IsTrue(Def("tac_spellgun_cycle").HasTag("风险"));

            var rng = new RunRng(1234);
            var rolled = ScrollRoll.Roll(all, 200, new ScrollRoll.Context { heroId = "fox" }, rng).Select(d => d.id).ToList();
            foreach (var id in TacticIds) CollectionAssert.Contains(rolled, id, $"{id} 进卡池");

            Gain("tac_crossfire", 3);
            Assert.IsFalse(inv.Gain(Def("tac_crossfire"), sheet), "满层再加返回 false");
            Assert.AreEqual(3, inv.Stacks("tac_crossfire"));
            var ctx = new ScrollRoll.Context { heroId = "fox", stacks = inv.All };
            Assert.IsFalse(ScrollRoll.Roll(all, 200, ctx, rng).Any(d => d.id == "tac_crossfire"), "满层不再进卡池");
            var high = new ScrollRoll.Context { heroId = "fox", stacks = inv.All, minRarity = 3, exclude = new[] { "tac_dash_capstone" } };
            Assert.IsTrue(ScrollRoll.Roll(all, 200, high, rng).All(d => d.rarity >= 3 && d.id != "tac_dash_capstone"));
        }

        [Test]
        public void SwitchEffectsRequireADifferentWeaponEnforceCooldownAndExpireWithoutStacking()
        {
            Gain("tac_crossfire", 2);
            Gain("tac_cover_change", 2);
            var e = Enemy();
            Switch(a);
            Close(100, Hit(e).total, "同一把枪不算切枪");
            Close(0, host.shield);
            Switch(b);
            Close(124, Hit(e).total);
            Close(16, host.shield);
            Switch(a);
            Close(16, host.shield, "护盾冷却 5 秒");
            Step(4);
            Close(100, Hit(e).total, "4 秒到期");
            Switch(b);
            Close(124, Hit(e).total, "伤害冷却 4 秒已过");
            Close(16, host.shield);
            Step(1);
            Switch(a);
            Close(32, host.shield);
            StageLoaded();
            Close(100, Hit(e).total, "换关清空");
            GameEvents.RaiseWeaponSwitched(null, a);
            Close(32, host.shield, "初始化 / 换关恢复（没有前一把）不算切枪");
        }

        [Test]
        public void LeftoverScopesFromAnEarlierPlaySessionDoNotReachTheFixture()
        {
            // 模拟试玩留下的残余：另一份持有表里装着 1 层换位掩护，持有者销毁了却没卸载（LootDirector 退出 Play 模式时的样子）
            var leaked = new ScrollInventory();
            leaked.Gain(Def("tac_cover_change"), StatSheet.Default());
            Gain("tac_cover_change", 2);
            Switch(b);
            Close(24, host.shield, "残余的 1 层也接到切枪事件（复现：16 + 8）");
            PlayModeLeftovers.Reset();
            inv.Clear();
            Step(5);
            host.shield = 0;
            Gain("tac_cover_change", 2);
            Switch(a);
            Close(16, host.shield, "清掉残余后只剩本用例装的 2 层");
        }

        [Test]
        public void ReloadDefenseUsesActualReloadStateAndCompletedReloadGrantsTimedHitDamage()
        {
            Gain("tac_reload_guard", 3);
            Gain("tac_loaded_focus", 2);
            DamagePlayer(10);
            Close(40, hp);
            host.reloading = true;
            DamagePlayer(10);
            Close(32.4f, hp);
            host.reloading = false;
            GameEvents.RaiseReloaded(a);
            Close(300, Hit(Enemy(), crit: true).total);
            Step(8);
            Close(200, Hit(Enemy(), crit: true).total);
        }

        [Test]
        public void DashLoadConservesAmmunitionCapsCapacityIgnoresMeleeAndNeverEmitsReload()
        {
            Gain("tac_dash_load", 3);
            int reloads = 0;
            System.Action<WeaponInstance> onReload = _ => reloads++;
            GameEvents.Reloaded += onReload;
            try
            {
                Dash();
                Assert.AreEqual((9, 34), (a.mag, a.reserve));
                Dash();
                Assert.AreEqual((9, 34), (a.mag, a.reserve), "冷却 2 秒");
                Step(2);
                Dash();
                Assert.AreEqual((10, 33), (a.mag, a.reserve), "不超过弹匣容量");
                Step(2);
                a.mag = 0;
                a.reserve = 1;
                Dash();
                Assert.AreEqual((1, 0), (a.mag, a.reserve), "只搬得出剩下的备弹");
                Step(2);
                a.reserve = 10;
                host.melee = true;
                Dash();
                Assert.AreEqual((1, 10), (a.mag, a.reserve), "碎刃近战形态不装填");
                host.melee = false;
                a.reserve = 0;
                Dash();
                Assert.AreEqual((1, 0), (a.mag, a.reserve));
                a.reserve = 5;
                Dash();
                Assert.AreEqual((6, 0), (a.mag, a.reserve), "装不进去时（近战 / 没备弹）不消耗冷却");
                Assert.AreEqual(0, reloads, "不发换弹事件");
            }
            finally
            {
                GameEvents.Reloaded -= onReload;
            }
        }

        [Test]
        public void DashAndLandingWavesUseDifficultyAndRadiusScalingAndOcclusion()
        {
            Gain("tac_dash_wave", 2);
            Gain("tac_landing_wave");
            RunState.Current = new RunState { difficulty = 2 };
            sheet.Add("test", Stat.ExplosionRadiusPct, 0.5f);
            var e = Enemy(0.5f);
            var far = Enemy(20);
            Dash();
            Close(48 * 1.85f, 10000 - e.health);
            Close(10000, far.health);
            Assert.AreEqual(1, host.explosions.Count);
            var o = host.explosions[0];
            Close(4.5f, o.radius);
            Assert.AreEqual(1, o.info.depth);
            Assert.AreEqual(DamageSource.Scroll, o.info.source);
            Assert.IsTrue(o.info.noCrit && o.info.Has(DamageTag.Proc));
            Close(8, o.info.knockback);
            Close(0, o.playerDamage, "不伤玩家");
            Assert.IsTrue(o.noFx, "不播爆炸特效，改画地面波纹");
            Close(0.9f, o.center.y);
            Dash();
            Assert.AreEqual(1, host.explosions.Count, "冷却 3 秒");
            Landed(5.99f);
            Assert.AreEqual(1, host.explosions.Count, "下落速度不到 6");
            host.walled.Add(e);
            float before = e.health;
            Landed(6);
            Close(before, e.health, "墙后不受伤");
            Assert.AreEqual(2, host.explosions.Count);
            Close(6, host.explosions[1].radius);
            Close(28 * 1.85f, host.explosions[1].info.amount);
        }

        [Test]
        public void SkillAndCriticalCooldownRefundsExcludeZeroDamageDerivedDamageAndPurge()
        {
            Gain("tac_battle_mage", 2);
            Gain("tac_crit_insight", 3);
            var e = Enemy();
            Hit(e, source: DamageSource.Skill, depth: 1);
            Hit(e, source: DamageSource.Skill, tags: DamageTag.Reaction);
            Hit(e, 0, DamageSource.Skill);
            Hit(e, source: DamageSource.Skill, tags: DamageTag.Purge);
            Assert.AreEqual(0, host.cooldowns.Count);
            Hit(e, source: DamageSource.Skill);
            Hit(e, source: DamageSource.Skill);
            CollectionAssert.AreEqual(new (float, SkillSlot?)[] { (0.5f, SkillSlot.Primary) }, host.cooldowns);
            Hit(e, crit: true, depth: 1);
            Hit(e, crit: true, tags: DamageTag.Purge);
            Hit(e, source: DamageSource.Skill, crit: true);
            Assert.AreEqual(1, host.cooldowns.Count);
            Hit(e, crit: true);
            Hit(e, crit: true);
            Assert.AreEqual(2, host.cooldowns.Count);
            Close(0.6f, host.cooldowns[1].seconds);
            Assert.AreEqual(SkillSlot.Secondary, host.cooldowns[1].slot);
            Step(0.75f);
            Hit(e, crit: true);
            Assert.AreEqual(3, host.cooldowns.Count);
            Hit(e);
            Step(0.75f);
            Hit(e);
            Assert.AreEqual(3, host.cooldowns.Count, "没暴击不触发");
        }

        [Test]
        public void SkillWardAndAlternatingSkillsHandleCooldownOrderExpiredWindowsAndStageReset()
        {
            Gain("tac_spell_ward", 2);
            Gain("tac_alternating_arts", 2);
            Use(SkillSlot.Primary);
            Use(SkillSlot.Primary);
            Close(12, host.shield);
            Close(0, sheet.Get(Stat.SkillDamagePct));
            Use(SkillSlot.Secondary);
            Close(0.4f, sheet.Get(Stat.SkillDamagePct));
            CollectionAssert.AreEqual(new (float, SkillSlot?)[] { (3f, SkillSlot.Primary) }, host.cooldowns);
            Step(6);
            Close(0, sheet.Get(Stat.SkillDamagePct));
            StageLoaded();
            Use(SkillSlot.Primary);
            Close(0, sheet.Get(Stat.SkillDamagePct), "换关清掉上一个技能");
            Step(6.01f);
            Use(SkillSlot.Secondary);
            Close(0, sheet.Get(Stat.SkillDamagePct), "超过 6 秒不联动");
        }

        [Test]
        public void ShieldThresholdNeverBenefitsZeroShieldCapacityAndOnlyBuffsWeaponDamage()
        {
            Gain("tac_pristine_shield", 2);
            var e = Enemy();
            host.shield = 47.5f;
            Close(120, Hit(e).total);
            Close(100, Hit(e, source: DamageSource.Skill).total);
            host.shield = 47.49f;
            Close(100, Hit(e).total);
            sheet.SetBase(Stat.MaxShield, 0);
            host.shield = 0;
            Close(100, Hit(e).total);
        }

        [Test]
        public void ShieldBreakSpeedAndActualHealingConversionExpireAndRespectShieldCap()
        {
            Gain("tac_emergency_reload", 2);
            Gain("tac_healing_barrier", 2);
            GameEvents.RaisePlayerShieldBroken();
            Close(0.4f, sheet.Get(Stat.ReloadSpeedPct));
            Heal(100);
            Close(25, host.shield);
            Heal(100);
            Close(25, host.shield, "满生命回复 0，不转盾");
            hp = 0;
            Heal(100);
            Close(50, host.shield, "不超过护盾上限");
            Step(5);
            Close(0, sheet.Get(Stat.ReloadSpeedPct));
        }

        [Test]
        public void PreyMarksAreTargetSpecificBoundedDeduplicatePelletsExpireAndIgnoreDerivedOrPurgeHits()
        {
            Gain("tac_focused_prey", 3);
            var e = Enemy();
            var other = Enemy(2);
            Close(100, Hit(e).total);
            Close(109, Hit(e).total, "同帧只累计一次");
            Step(0.01f);
            Close(109, Hit(e).total);
            for (int i = 0; i < 10; i++)
            {
                Step(0.01f);
                Hit(e);
            }
            Close(145, Hit(e).total, "最多 5 次");
            Close(100, Hit(other, source: DamageSource.Scroll).total);
            Hit(other, depth: 1);
            Hit(other, tags: DamageTag.Purge);
            Close(100, Hit(other).total, "衍生 / 静默处决不累计");
            Step(4);
            Close(100, Hit(e).total, "4 秒到期");
            StageLoaded();
            Close(100, Hit(e).total, "换关清空");
        }

        [Test]
        public void ReactionBenefitsAcceptOnlyRootReactionsAndRefreshWithoutAddingDuplicateStats()
        {
            Gain("tac_reaction_ward", 2);
            Gain("tac_reaction_stride", 2);
            Reacted(Reaction.Thunderfire, 1);
            Close(0, sheet.Get(Stat.ReactionHaste), "衍生反应不触发");
            Reacted(Reaction.Thunderfire);
            Reacted(Reaction.Thunderfire);
            Close(0, host.shield, "化应为盾不再直接回盾");
            Close(0.1f, sheet.Get(Stat.ReactionHaste));
            Close(8.3f, sheet.Get(Stat.MoveSpeed));
            Step(0.8f);
            Reacted(Reaction.Meltdown);
            Close(0.1f, sheet.Get(Stat.ReactionHaste), "刷新不叠加");
            Step(3.5f);
            Close(0.1f, sheet.Get(Stat.ReactionHaste));
            Step(0.55f);
            Close(0, sheet.Get(Stat.ReactionHaste));
            Close(7.5f, sheet.Get(Stat.MoveSpeed));
        }

        [Test]
        public void ControlDamageOnlyAcceptsLivingStunOrSlowStatesAndWeaponRequests()
        {
            Gain("tac_stagger_hunter", 2);
            var e = Enemy();
            EnemyStatus.Slow(e, 0.3f, 1);
            Close(124, Hit(e).total);
            Close(100, Hit(e, source: DamageSource.Status).total);
            Close(100, Hit(e, source: DamageSource.Skill).total);
            EnemyStatus.Of(e).Instance<SlowInstance>(StatusId.Slow).Tick(1.1f);
            Close(100, Hit(e).total, "减速到期");
            EnemyStatus.Stun(e, 1);
            Close(124, Hit(e).total);
        }

        [Test]
        public void DashCapstoneConsumesOnceBeforeNestedDamageRespectsExpiryAndProcDepth()
        {
            Gain("tac_dash_capstone");
            var e = Enemy();
            Dash();
            Hit(e, depth: 1);
            Assert.AreEqual(0, host.explosions.Count, "衍生命中不触发");
            float before = e.health;
            Hit(e);
            Close(170, before - e.health, "100 + 爆炸 70");
            Assert.AreEqual(1, host.explosions.Count);
            var o = host.explosions[0];
            Assert.AreEqual(1, o.info.depth);
            Assert.IsTrue(o.info.noCrit);
            Close(3, o.radius);
            Hit(e);
            Assert.AreEqual(1, host.explosions.Count, "蓄能只用一次");
            Step(4);
            Dash();
            Step(3);
            Hit(e);
            Assert.AreEqual(1, host.explosions.Count, "3 秒到期");
            Step(1);
            Dash();
            StageLoaded();
            Hit(e);
            Assert.AreEqual(1, host.explosions.Count, "换关清空蓄能");
            Step(4);
            Dash();
            Died();
            Hit(e);
            Assert.AreEqual(1, host.explosions.Count, "阵亡清空蓄能");
        }

        [Test]
        public void SpellgunCycleUsesDamageSourcesRefreshesWithoutStackingAndAppliesRisk()
        {
            Gain("tac_spellgun_cycle");
            var e = Enemy();
            Hit(e, source: DamageSource.Scroll);
            Close(0, sheet.Get(Stat.SkillDamagePct));
            Use(SkillSlot.Primary);
            Close(125, Hit(e).total);
            Close(135, Hit(e, source: DamageSource.Skill).total);
            Use(SkillSlot.Secondary);
            Close(125, Hit(e).total);
            DamagePlayer(10);
            Close(38.5f, hp);
            Step(5);
            Close(0, sheet.Get(Stat.DamagePct));
            Close(0, sheet.Get(Stat.SkillDamagePct));
        }

        [Test]
        public void StackUpgradesAndResetRemoveOldModifiersTasksListenersAndCombatState()
        {
            int out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count, tasks0 = ScrollTicker.TaskCount;
            var e = Enemy();
            foreach (var d in Tactics) inv.Gain(d, sheet);
            Switch(b);
            Use(SkillSlot.Primary);
            Dash();
            Hit(e);
            Gain("tac_crossfire");
            Close(0.25f, sheet.Get(Stat.DamagePct), "叠层重装结束旧的切枪增益，技能增益保留");
            Step(4);
            Switch(a);
            Close(0.49f, sheet.Get(Stat.DamagePct));

            inv.Clear();
            Step(0);
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount, "任务全部撤掉");
            Assert.AreEqual(out0, Combat.Outgoing.Count, "输出修饰器全部撤掉");
            Assert.AreEqual(in0, PlayerVitals.Incoming.Count, "受伤修饰器全部撤掉");
            Assert.AreEqual(0, inv.Count);
            Close(0, sheet.Get(Stat.DamagePct));
            Close(0, sheet.Get(Stat.SkillDamagePct));
            foreach (var id in TacticIds)
                foreach (var suffix in new[] { "", "#buff0", "#buff1" })
                    Assert.IsFalse(sheet.HasSource(ScrollScope.SourceOf(id) + suffix), $"{id}{suffix} 的属性来源没撤掉");

            float shield = host.shield;
            int refunds = host.cooldowns.Count, blasts = host.explosions.Count;
            Switch(b);
            Dash();
            Hit(e, crit: true);
            Use(SkillSlot.Secondary);
            Reacted(Reaction.Thunderfire);
            Close(shield, host.shield);
            Assert.AreEqual(refunds, host.cooldowns.Count);
            Assert.AreEqual(blasts, host.explosions.Count);
            Close(100, Hit(e).total);
        }

        [Test]
        public void LoadedFocusSharesThreeChargesAcrossSameFramePelletsAndBoostsHeadshots()
        {
            Gain("tac_loaded_focus", 3);
            var e = Enemy();
            GameEvents.RaiseReloaded(a);
            Close(100, Hit(e, source: DamageSource.Scroll).total);
            Close(100, Hit(e, depth: 1).total);
            Close(100, Hit(e, uid: b.uid).total);
            Close(0, Hit(e, 0).total);
            for (int round = 0; round < 3; round++)
            {
                Step(0.01f);
                for (int pellet = 0; pellet < 8; pellet++) Close(175, Hit(e).total);
                // 弱点命中在 Combat 里另算暴击：两份加成各算一次
                Close(440, Hit(e, weak: true).total);
            }
            Step(0.01f);
            Close(100, Hit(e).total, "三次用完");
            GameEvents.RaiseReloaded(a);
            Switch(b);
            Switch(a);
            Close(100, Hit(e).total, "切枪清空");
            GameEvents.RaiseReloaded(a);
            StageLoaded();
            Close(100, Hit(e).total, "换关清空");
            GameEvents.RaiseReloaded(a);
            Died();
            Close(100, Hit(e).total, "阵亡清空");
            GameEvents.RaiseReloaded(a);
            Step(8);
            Close(100, Hit(e).total, "8 秒到期");
        }

        [Test]
        public void AlternatingArtsRefundsThePreviousSkillThrottlesPairsAndNeverDuplicatesBuffs()
        {
            Gain("tac_alternating_arts", 3);
            var e = Enemy();
            Use(SkillSlot.Primary);
            Use(SkillSlot.Secondary);
            Close(160, Hit(e, source: DamageSource.Skill).total);
            Use(SkillSlot.Primary);
            Use(SkillSlot.Secondary);
            Assert.AreEqual(1, host.cooldowns.Count, "联动冷却 3 秒");
            Step(3);
            Use(SkillSlot.Primary);
            CollectionAssert.AreEqual(new (float, SkillSlot?)[] { (4.5f, SkillSlot.Primary), (4.5f, SkillSlot.Secondary) }, host.cooldowns);
            Close(0.6f, sheet.Get(Stat.SkillDamagePct));
            Step(6);
            Use(SkillSlot.Secondary);
            Assert.AreEqual(2, host.cooldowns.Count, "超时不联动");
            Close(0, sheet.Get(Stat.SkillDamagePct));
            Use(SkillSlot.Primary);
            Assert.AreEqual(3, host.cooldowns.Count);
            Died();
            Close(0, sheet.Get(Stat.SkillDamagePct), "阵亡清空增益");
            host.alive = false;
            Use(SkillSlot.Secondary);
            Assert.AreEqual(3, host.cooldowns.Count, "阵亡时不触发");
        }

        [Test]
        public void ReactionWardStoresTwoHitsPreservesInvulnerableChargesAndExpiresOrResets()
        {
            Gain("tac_reaction_ward", 3);
            void Rx(int depth) => Reacted(Reaction.Veinseal, depth);
            void Damage(float expected, bool invulnerable = false)
            {
                float before = hp;
                DamagePlayer(10, invulnerable);
                Close(expected, before - hp);
            }

            Rx(1);
            Damage(10);
            Rx(0);
            Rx(0);
            Damage(0, invulnerable: true);
            Damage(4);
            Damage(10);
            Step(0.8f);
            Rx(0);
            Step(0.8f);
            Rx(0);
            Step(0.8f);
            Rx(0);
            Damage(4);
            Damage(4);
            Damage(10); // 第三次蓄积只刷新时长，不超过 2 枚
            Step(0.8f);
            Rx(0);
            Step(6.01f);
            Damage(10);
            Rx(0);
            StageLoaded();
            Damage(10);
            Step(0.8f);
            Rx(0);
            Died();
            Damage(10);
        }

        [Test]
        public void ReactionWardRefreshesTheEntireReserveAndCombinesWithOrdinaryReduction()
        {
            Gain("tac_reaction_ward", 2);
            sheet.Add("test", Stat.DamageReduction, 0.25f);
            Reacted(Reaction.Thunderfire);
            Step(5.9f);
            Reacted(Reaction.Thunderfire);
            Step(0.2f);
            float before = hp;
            DamagePlayer(10);
            DamagePlayer(10);
            Close(9, before - hp);
        }

        [Test]
        public void EveryTacticInstallsAndUninstallsAtEveryStackCleanly()
        {
            int out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count, tasks0 = ScrollTicker.TaskCount;
            foreach (var d in Tactics)
            {
                for (int n = 1; n <= d.maxStacks; n++) Assert.IsTrue(inv.Gain(d, sheet));
                Assert.IsNotEmpty(d.Describe(d.maxStacks));
                CollectionAssert.IsEmpty(d.PreviewStats(d.maxStacks), $"{d.id} 没有常驻属性");
                inv.Remove(d.id);
                Assert.AreEqual(out0, Combat.Outgoing.Count, d.id);
                Assert.AreEqual(in0, PlayerVitals.Incoming.Count, d.id);
                Assert.AreEqual(tasks0, ScrollTicker.TaskCount, d.id);
            }
        }
    }
}
