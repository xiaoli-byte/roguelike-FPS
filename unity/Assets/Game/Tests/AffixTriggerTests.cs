using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// AF2：触发 14 条与派发框架，对照 TS src/weapons/{Affixes,AffixEffects}.ts。
    /// 派发器接假环境（<see cref="FakeEnv"/>：记录爆炸 / 伤害 / 附着 / 引爆 / 强制反应 / 回填 / 护盾），事件直接手造，不依赖场景与物理：
    /// 只认本武器（weaponUid）、深度 0；效果排到下一次 Flush 才执行；同帧伤害合并成附着强度；内置冷却；蛊种传染；换关清空；词条跨关保存。
    /// </summary>
    public sealed class AffixTriggerTests
    {
        const float Eps = 1e-4f;
        readonly List<GameObject> made = new();
        StatSheet savedStats;

        [SetUp]
        public void SetUp()
        {
            savedStats = Combat.playerStats;
            Combat.playerStats = null;
        }

        [TearDown]
        public void TearDown()
        {
            Combat.playerStats = savedStats;
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        // ───────────── 假环境与工具 ─────────────

        sealed class FakeEnv : IAffixEnv
        {
            public float now, rand, haste;
            public bool triggerOk = true;
            public Damageable nearest;
            public readonly List<WeaponInstance> weapons = new();
            public readonly Dictionary<Damageable, StatusMask> statuses = new();
            public readonly List<(WeaponInstance w, int rounds)> refills = new();
            public readonly List<float> shields = new();
            public readonly List<(ExplosionOptions o, bool ring)> blasts = new();
            public readonly List<(Damageable t, DamageInfo info)> strikes = new();
            public readonly List<(Damageable e, Element el, float power, StatusApplyOpts o)> applied = new();
            public readonly List<(Damageable e, DetonateOpts o)> detonates = new();
            public readonly List<(Damageable e, Reaction id, TriggerOpts o)> triggers = new();
            public int beams;

            public float Now => now;
            public float Random() => rand;
            public WeaponInstance Find(int uid) => weapons.Find(w => w.uid == uid);
            public ResolvedWeapon Resolve(WeaponInstance w) => WeaponStatsResolver.Resolve(w, null);
            public StatusMask Statuses(Damageable e) => e && statuses.TryGetValue(e, out var m) ? m : StatusMask.None;
            public float ReactionHaste => haste;
            public Vector3 Center(Damageable e) => e ? e.transform.position : Vector3.zero;
            public Damageable Nearest(Vector3 from, float range, Damageable exclude) => nearest && nearest != exclude ? nearest : null;
            public void Refill(WeaponInstance w, int rounds) => refills.Add((w, rounds));
            public void AddShield(float amount) => shields.Add(amount);
            public void Explode(in ExplosionOptions o, bool ring) => blasts.Add((o, ring));
            public void Strike(Damageable target, in DamageInfo info, Vector3 from, Color tracer) => strikes.Add((target, info));
            public void ApplyStatus(Damageable e, Element element, float power, in StatusApplyOpts o) => applied.Add((e, element, power, o));
            public void Detonate(Damageable e, in DetonateOpts o) => detonates.Add((e, o));

            public bool Trigger(Damageable e, Reaction id, in TriggerOpts o)
            {
                triggers.Add((e, id, o));
                return triggerOk;
            }

            public void Beam(Vector3 from, Vector3 to, Color color) => beams++;
        }

        Damageable Enemy(float maxHp = 1000, Rank rank = Rank.Normal)
        {
            var go = new GameObject("affix test enemy");
            made.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.rank = rank;
            d.ResetVitals();
            return d;
        }

        static WeaponDef Def(string id)
        {
            var d = WeaponLibrary.Get(id);
            Assert.IsNotNull(d, $"武器表里没有 {id}");
            return d;
        }

        /// <summary>只带给定词条的枪（替换掉固有词条），登记进假环境的「玩家槽位」</summary>
        static WeaponInstance Gun(FakeEnv env, string weapon, params (string id, float v)[] affixes)
        {
            var w = new WeaponInstance(Def(weapon), Rarity.Rare);
            w.SetAffixes(affixes.Select(a => new WeaponAffix(a.id, a.v)));
            env?.weapons.Add(w);
            return w;
        }

        static HitEvent Hit(Damageable e, WeaponInstance w, float dealt, bool weak = false, bool crit = false, bool killed = false, int depth = 0,
            Element element = Element.None, Element applied = Element.None, DamageSource source = DamageSource.Weapon)
        {
            return new HitEvent
            {
                enemy = e,
                info = new DamageInfo
                {
                    amount = dealt, source = source, tags = DamageTag.Weapon, weaponUid = w?.uid ?? 0, weakpoint = weak, depth = depth, element = element,
                    point = e.transform.position + Vector3.up, critMult = 2,
                },
                result = new DamageResult { total = dealt, crit = crit, killed = killed, statusApplied = applied },
            };
        }

        static KillEvent Kill(Damageable e, WeaponInstance w, int depth = 0, Element element = Element.None) => new()
        {
            enemy = e,
            info = new DamageInfo { amount = 10, source = DamageSource.Weapon, tags = DamageTag.Weapon, weaponUid = w?.uid ?? 0, depth = depth, element = element },
            result = new DamageResult { total = 10, killed = true },
        };

        static ReactionEvent Rx(Damageable e, WeaponInstance w, Reaction id = Reaction.Thunderfire, float B = 40, int depth = 0, DamageTag tag = DamageTag.None) => new()
        {
            enemy = e, id = id, point = e.transform.position, B = B, depth = depth, weaponUid = w?.uid ?? 0, tag = tag,
        };

        // ───────────── 定义 ─────────────

        /// <summary>TS AFFIXES 里的触发 14 条：id、min、max、权重、perHit</summary>
        static readonly (string id, float min, float max, float weight, bool perHit)[] Ts =
        {
            ("headBlast", 0.5f, 0.8f, 5, false), ("killRefill", 0.12f, 0.25f, 6, false), ("hitShield", 0.03f, 0.06f, 6, false),
            ("ricochet", 0.25f, 0.45f, 5, false), ("subFire", 0.1f, 0.18f, 4, true), ("subShock", 0.1f, 0.18f, 4, true),
            ("subCorrode", 0.1f, 0.18f, 4, true), ("rxnDmg", 0.18f, 0.35f, 6, false), ("rxnRefill", 0.08f, 0.15f, 4, false),
            ("rxnHaste", 0.12f, 0.22f, 4, false), ("statusHunter", 0.05f, 0.09f, 5, false), ("rxnShield", 4f, 8f, 4, false),
            ("detonate", 0.6f, 0.9f, 4, false), ("seed", 0.3f, 0.45f, 2, false),
        };

        [Test]
        public void FourteenTriggerAffixesRegisteredInTsOrder()
        {
            var triggers = AffixLibrary.All.Where(a => a.Kind == AffixKind.Trigger).ToList();
            CollectionAssert.AreEqual(Ts.Select(t => t.id).ToArray(), triggers.Select(a => a.id).ToArray(), "触发 14 条，顺序同 TS AFFIXES");
            foreach (var t in Ts)
            {
                var a = AffixLibrary.Get(t.id);
                Assert.AreEqual(t.min, a.min, 1e-6f, t.id);
                Assert.AreEqual(t.max, a.max, 1e-6f, t.id);
                Assert.AreEqual(t.weight, a.weight, 1e-6f, t.id);
                Assert.AreEqual(t.perHit, a.perHit, t.id);
                Assert.IsFalse(a.isFixed, t.id);
                Assert.IsNotNull(a.Effect, $"{t.id} 有效果");
            }
            // 普通词条池整体顺序 = TS AFFIXES（数值与触发穿插）
            string[] tsOrder =
            {
                "dmg", "rate", "mag", "reload", "critDmg", "critChance", "elemChance", "spread", "recoil", "headBlast", "killRefill", "hitShield",
                "ricochet", "pierce", "blast", "projSpeed", "reserve", "hunter", "swift", "subFire", "subShock", "subCorrode", "rxnDmg", "rxnRefill",
                "rxnHaste", "statusHunter", "rxnShield", "detonate", "seed",
            };
            CollectionAssert.AreEqual(tsOrder, AffixLibrary.Rollable().Select(a => a.id).ToArray());
        }

        [Test]
        public void TextsMatchTs()
        {
            var w = Def("smg");
            string T(string id, float v) => AffixText.Describe(w, new WeaponAffix(id, v));
            Assert.AreEqual("爆头时引发小范围爆炸（65% 单发伤害）", T("headBlast", 0.65f));
            Assert.AreEqual("击杀时回填 20% 弹匣", T("killRefill", 0.2f));
            Assert.AreEqual("命中时将 5% 伤害转化为护盾", T("hitShield", 0.05f));
            Assert.AreEqual("命中时 30% 几率弹射至附近敌人（50% 伤害）", T("ricochet", 0.3f));
            Assert.AreEqual("命中时 12% 几率附加灼烧", T("subFire", 0.12f));
            Assert.AreEqual("命中时 40% 几率附加雷殛", T("subShock", 0.4f));
            Assert.AreEqual("命中时 3% 几率附加蚀化", T("subCorrode", 0.03f));
            Assert.AreEqual("本武器引发的元素反应伤害 +25%", T("rxnDmg", 0.25f));
            Assert.AreEqual("本武器引发元素反应时回填 10% 弹匣", T("rxnRefill", 0.1f));
            Assert.AreEqual("本武器引发元素反应后 3 秒内射速 +18%", T("rxnHaste", 0.18f));
            Assert.AreEqual("目标每带有一种元素状态，伤害 +7%", T("statusHunter", 0.07f));
            Assert.AreEqual("本武器引发元素反应时获得 6 点护盾", T("rxnShield", 6f));
            Assert.AreEqual("暴击或爆头时引爆目标的元素状态（强度 75%，每 1.5 秒一次）", T("detonate", 0.75f));
            Assert.AreEqual("命中种下蛊种：其发生元素反应时，以 40% 威力传染给附近 1 名敌人", T("seed", 0.4f));
        }

        static HashSet<string> Allowed(WeaponDef def, Element element, params string[] picked)
        {
            var ctx = new AffixContext(def, element, picked.ToList());
            return new HashSet<string>(AffixLibrary.All.Where(a => a.Kind == AffixKind.Trigger && a.Allow(ctx)).Select(a => a.id));
        }

        [Test]
        public void EligibilityMatchesTs()
        {
            void Expect(WeaponDef def, Element e, string[] picked, params string[] expected)
            {
                var got = Allowed(def, e, picked);
                Assert.IsTrue(new HashSet<string>(expected).SetEquals(got),
                    $"{def.id}/{e}：期望 [{string.Join(",", expected.OrderBy(x => x))}] 实际 [{string.Join(",", got.OrderBy(x => x))}]");
            }
            string[] none = { };
            string[] subs = { "subFire", "subShock", "subCorrode" };
            string[] always = { "killRefill", "hitShield", "statusHunter" };
            string[] react = { "rxnDmg", "rxnRefill", "rxnHaste", "rxnShield" };
            string[] Plus(params string[][] groups) => groups.SelectMany(g => g).ToArray();

            // 无元素的左轮：命中扫描（爆头 / 弹射 / 破势），三种副元素；不能自己引发反应
            Expect(Def("revolver"), Element.None, none, Plus(always, subs, new[] { "headBlast", "ricochet", "detonate" }));
            // 抽到副元素词条后解锁反应类
            Expect(Def("revolver"), Element.None, new[] { "subFire" }, Plus(always, subs, react, new[] { "headBlast", "ricochet", "detonate" }));
            // 火元素：没有副·焚，直接能反应
            Expect(Def("revolver"), Element.Fire, none, Plus(always, react, new[] { "subShock", "subCorrode", "headBlast", "ricochet", "detonate" }));
            // 光束：不是命中扫描，没有爆头 / 弹射 / 破势
            Expect(Def("beam"), Element.Shock, none, Plus(always, react, new[] { "subFire", "subCorrode" }));
            // 爆炸投射物：没有蛊种
            Expect(Def("launcher"), Element.Fire, none, Plus(always, react, new[] { "subShock", "subCorrode" }));
            // 非爆炸投射物的弩：蛊种 + 直接命中类
            var bolt = new WeaponDef { id = "t_bolt", kind = WeaponKind.Crossbow, mode = FireMode.Semi, fireRate = 1.2f, projectile = new ProjectileSpec() };
            Expect(bolt, Element.None, none, Plus(always, subs, new[] { "headBlast", "ricochet", "detonate", "seed" }));
            // 蓄力命中扫描（满蓄引爆）：能反应，但没有破势
            var rail = new WeaponDef { id = "t_rail", kind = WeaponKind.Sniper, mode = FireMode.Charge, fireRate = 2, chargeTime = 0.9f, chargeDetonate = true };
            Expect(rail, Element.None, none, Plus(always, subs, react, new[] { "headBlast", "ricochet" }));
            // 元素轮转：没有副元素，能反应
            var trinity = new WeaponDef { id = "t_trinity", kind = WeaponKind.Pistol, mode = FireMode.Semi, fireRate = 2, cycle = new[] { Element.Fire, Element.Shock, Element.Corrode } };
            Expect(trinity, Element.Fire, none, Plus(always, react, new[] { "headBlast", "ricochet", "detonate" }));
            // 碎刃：没有弹匣类与爆头，弹射 / 破势照常
            var blade = new WeaponDef { id = "t_blade", kind = WeaponKind.Blade, mode = FireMode.Semi, fireRate = 1, blade = new DemonBladeSpec() };
            Expect(blade, Element.None, none, new[] { "hitShield", "statusHunter", "ricochet", "detonate", "subFire", "subShock", "subCorrode" });
        }

        [Test]
        public void RolledValuesScaleAndRound()
        {
            var shield = AffixLibrary.Get("rxnShield");
            Assert.AreEqual(6f, shield.Round(5.5f), "化盾取整（.5 进位）");
            Assert.AreEqual(5f, shield.Round(5.49f));
            var rng = new System.Random(5);
            var revolver = Def("revolver");
            var pool = new[] { AffixLibrary.Get("rxnShield"), AffixLibrary.Get("subFire") };
            for (int i = 0; i < 300; i++)
                foreach (var a in AffixRoll.Roll(revolver, Rarity.Legendary, Element.Shock, rng, pool, null))
                    if (a.id == "rxnShield")
                    {
                        Assert.AreEqual(Mathf.Round(a.value), a.value, "整数");
                        Assert.That(a.value, Is.InRange(4 * 1.45f - 0.5f, 8 * 1.45f + 0.5f));
                    }
                    else
                    {
                        float lo = AffixRules.PerHitChance(revolver, 0.1f * 1.45f), hi = AffixRules.PerHitChance(revolver, 0.18f * 1.45f);
                        Assert.That(a.value, Is.InRange(lo - 0.0051f, hi + 0.0051f), "副元素：原始值 × 稀有度 × 3.5 ÷ 每秒命中数");
                    }
        }

        // ───────────── 派发框架 ─────────────

        [Test]
        public void ProcsWaitForFlushAndOnlyOwnWeaponDirectHitsCount()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "revolver", ("headBlast", 0.6f));
            var stranger = Gun(null, "revolver", ("headBlast", 0.6f)); // 不在玩家槽里
            var e = Enemy();
            var R = WeaponStatsResolver.Resolve(w, null);

            fx.OnDamaged(Hit(e, w, 50, weak: true));
            Assert.AreEqual(1, fx.Pending, "入队");
            Assert.AreEqual(0, env.blasts.Count, "派发时不执行（不在伤害结算里重入）");
            fx.Flush();
            Assert.AreEqual(1, env.blasts.Count, "下一次 Flush 执行");
            var o = env.blasts[0].o;
            Assert.AreEqual(R.perShot * 0.6f, o.info.amount, Eps, "单发总伤害 × 值");
            Assert.AreEqual(AffixEffects.HeadBlastRadius * R.blastMult, o.radius, Eps);
            Assert.AreEqual(w.uid, o.info.weaponUid);
            Assert.AreEqual(1, o.info.depth, "衍生深度 1");
            Assert.IsTrue(o.info.noCrit, "不暴击");
            Assert.IsTrue(o.info.Has(DamageTag.Proc));
            Assert.AreEqual(DamageSource.Weapon, o.info.source);
            Assert.AreEqual(0, fx.Pending);

            env.now = 1;
            fx.OnDamaged(Hit(e, stranger, 50, weak: true));
            fx.OnDamaged(Hit(e, w, 50, weak: true, depth: 1));
            fx.OnDamaged(Hit(e, w, 50, weak: true, source: DamageSource.Skill));
            var reaction = Hit(e, w, 50, weak: true);
            reaction.info.reaction = true;
            fx.OnDamaged(reaction);
            var immune = Hit(e, w, 0, weak: true);
            immune.result.immune = true;
            fx.OnDamaged(immune);
            Assert.AreEqual(0, fx.Pending, "别人的枪 / 衍生伤害 / 技能 / 反应伤害 / 免疫都不触发");
            fx.OnDamaged(Hit(e, w, 50, weak: false));
            Assert.AreEqual(0, fx.Pending, "不是爆头");
        }

        [Test]
        public void HeadBlastOncePerShotgunBlast()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "shotgun", ("headBlast", 0.5f));
            var e = Enemy();
            env.now = 5;
            for (int i = 0; i < 9; i++) fx.OnDamaged(Hit(e, w, 12, weak: true));
            env.now = 5.05f;
            fx.OnDamaged(Hit(e, w, 12, weak: true));
            fx.Flush();
            Assert.AreEqual(1, env.blasts.Count, "0.08 s 内只炸一次");
            env.now = 5.2f;
            fx.OnDamaged(Hit(e, w, 12, weak: true));
            fx.Flush();
            Assert.AreEqual(2, env.blasts.Count);
        }

        [Test]
        public void SubElementMergesSameFrameDamageAndQueuesOnce()
        {
            var env = new FakeEnv { rand = 0 };
            var fx = new AffixEffects(env);
            var w = Gun(env, "shotgun", ("subFire", 0.3f));
            var e = Enemy(1000);
            var other = Enemy(1000);
            for (int i = 0; i < 9; i++) fx.OnDamaged(Hit(e, w, 12));
            fx.OnDamaged(Hit(other, w, 20));
            Assert.AreEqual(2, fx.Pending, "同一把枪对同一敌人的同种附着只排一条");
            fx.Flush();
            Assert.AreEqual(2, env.applied.Count);
            var a = env.applied.Single(x => x.e == e);
            Assert.AreEqual(Element.Fire, a.el);
            Assert.AreEqual(108f, a.power, Eps, "强度 = 上一帧对它的合并伤害（9 × 12）");
            Assert.AreEqual(0, a.o.depth);
            Assert.AreEqual(w.uid, a.o.weaponUid);
            Assert.AreEqual(20f, env.applied.Single(x => x.e == other).power, Eps);

            // 上限：最大生命 × 0.5；这一击已附着同种状态 / 打死了 / 掷骰没中都不附着
            var small = Enemy(100);
            fx.OnDamaged(Hit(small, w, 80));
            fx.Flush();
            Assert.AreEqual(50f, env.applied.Last().power, Eps, "钳到最大生命一半");
            int before = env.applied.Count;
            fx.OnDamaged(Hit(e, w, 30, applied: Element.Fire));
            fx.OnDamaged(Hit(other, w, 30, killed: true));
            env.rand = 0.5f;
            fx.OnDamaged(Hit(small, w, 30));
            fx.Flush();
            Assert.AreEqual(before, env.applied.Count);
        }

        [Test]
        public void StormpodInnateSubShockGoesThroughAffixes()
        {
            var env = new FakeEnv { rand = 0.39f };
            var fx = new AffixEffects(env);
            var w = new WeaponInstance(Def("stormpod"));
            env.weapons.Add(w);
            Assert.AreEqual("subShock", w.affixes[0].id, "固有词条");
            var e = Enemy();
            fx.OnDamaged(Hit(e, w, 60, element: Element.Corrode));
            fx.Flush();
            Assert.AreEqual(Element.Shock, env.applied.Single().el, "固有「副·雷」40%");
            env.rand = 0.41f;
            fx.OnDamaged(Hit(e, w, 60, element: Element.Corrode));
            fx.Flush();
            Assert.AreEqual(1, env.applied.Count);
            // 子弹不再自带副元素（只由词条掷一次）
            var R = WeaponStatsResolver.Resolve(w, null);
            var info = new Ballistics(null, null).HitInfo(new ShotContext { weapon = w, stats = R, element = w.element, damage = R.damage }, 10, Vector3.zero, Vector3.forward);
            Assert.AreEqual(Element.None, info.subElement);
        }

        [Test]
        public void KillRefillOnlyOnDirectKills()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("killRefill", 0.2f));
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            fx.OnKilled(Kill(e, w));
            Assert.AreEqual(1, env.refills.Count);
            Assert.AreEqual(Mathf.Max(1, WeaponStatsResolver.RoundHalfUp(R.magCap * 0.2f)), env.refills[0].rounds, "round(容量 × 值)");
            fx.OnKilled(Kill(e, w, depth: 1));
            Assert.AreEqual(1, env.refills.Count, "衍生击杀（弹射、爆头爆炸）不回填");
            Assert.AreEqual(1, Affix_KillRefill.Rounds(2, 0.12f), "至少 1 发");
        }

        [Test]
        public void HitShieldConvertsDealtDamage()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("hitShield", 0.05f));
            var e = Enemy();
            fx.OnDamaged(Hit(e, w, 40));
            fx.OnDamaged(Hit(e, w, 0));
            Assert.AreEqual(1, env.shields.Count, "0 伤害不加");
            Assert.AreEqual(2f, env.shields[0], Eps, "实际伤害 × 值");
        }

        [Test]
        public void RicochetChanceScalesWithPelletsAndDoesNotChain()
        {
            Assert.AreEqual(0.3f, Affix_Ricochet.Chance(0.3f, Def("smg"), false), Eps);
            Assert.AreEqual(0.1f, Affix_Ricochet.Chance(0.3f, Def("shotgun"), false), Eps, "9 颗弹丸 ÷ 3");
            Assert.AreEqual(0.3f, Affix_Ricochet.Chance(0.3f, Def("shotgun"), true), Eps, "斩击不折算");

            var env = new FakeEnv { rand = 0.2f };
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("ricochet", 0.3f));
            var e = Enemy();
            env.nearest = Enemy();
            env.nearest.transform.position = new Vector3(3, 0, 0);
            fx.OnDamaged(Hit(e, w, 40));
            fx.Flush();
            var s = env.strikes.Single();
            Assert.AreEqual(env.nearest, s.t);
            Assert.AreEqual(20f, s.info.amount, Eps, "50% 基础伤害");
            Assert.AreEqual(1, s.info.depth);
            Assert.IsFalse(s.info.noCrit, "弹射可以暴击");
            Assert.AreEqual(w.uid, s.info.weaponUid);
            // 弹射的伤害是衍生（深度 1）：不会再弹
            fx.OnDamaged(new HitEvent { enemy = s.t, info = s.info, result = new DamageResult { total = 20 } });
            Assert.AreEqual(0, fx.Pending);
            // 霰弹：0.2 > 0.3 / 3，不弹
            var sg = Gun(env, "shotgun", ("ricochet", 0.3f));
            fx.OnDamaged(Hit(e, sg, 12));
            Assert.AreEqual(0, fx.Pending);
            // 周围没人：执行时什么都不做
            env.nearest = null;
            fx.OnDamaged(Hit(e, w, 40));
            fx.Flush();
            Assert.AreEqual(1, env.strikes.Count);
        }

        [Test]
        public void ReactionAffixesOnlyForOwnReactionsWithGaps()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("rxnRefill", 0.1f), ("rxnShield", 6f), ("rxnHaste", 0.2f));
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            env.now = 10;
            fx.OnReaction(Rx(e, null));
            Assert.AreEqual(0, env.refills.Count + env.shields.Count, "不是本武器引发的反应");
            fx.OnReaction(Rx(e, w));
            Assert.AreEqual(Affix_KillRefill.Rounds(R.magCap, 0.1f), env.refills.Single().rounds);
            Assert.AreEqual(6f, env.shields.Single(), Eps);
            Assert.AreEqual(13f, WeaponRuntime.Of(w).rxnHasteUntil, Eps, "疾化 3 s");
            env.now = 10.2f;
            fx.OnReaction(Rx(e, w));
            Assert.AreEqual(1, env.refills.Count, "回元 0.3 s 内最多一次");
            Assert.AreEqual(1, env.shields.Count, "化盾 0.3 s 内最多一次");
            Assert.AreEqual(13.2f, WeaponRuntime.Of(w).rxnHasteUntil, Eps, "疾化刷新");
            env.now = 10.4f;
            fx.OnReaction(Rx(e, w));
            Assert.AreEqual(2, env.refills.Count);
            Assert.AreEqual(2, env.shields.Count);
        }

        [Test]
        public void RxnHasteSpeedsUpTheWeaponForThreeSeconds()
        {
            var w = Gun(null, "smg", ("rxnHaste", 0.2f));
            var R = WeaponStatsResolver.Resolve(w, null);
            Assert.AreEqual(1f, WeaponRuntime.RateMult(w, R, 0), Eps);
            WeaponRuntime.Of(w).rxnHasteUntil = 3;
            Assert.AreEqual(1.2f, WeaponRuntime.RateMult(w, R, 2.9f), Eps);
            Assert.AreEqual(1f, WeaponRuntime.RateMult(w, R, 3f), Eps);

            // 状态机按加速后的射速连发：按住 2 s，冲锋枪 13 发 / 秒 × 1.2
            int Fire(float until)
            {
                var gun = Gun(null, "smg", ("rxnHaste", 0.2f));
                gun.mag = 999;
                WeaponRuntime.Of(gun).rxnHasteUntil = until;
                var rec = new RecordFx();
                float time = 0;
                var sm = new WeaponStateMachine(new[] { gun, null }, rec, () => time, x => WeaponStatsResolver.Resolve(x, null));
                for (int i = 0; i < 120; i++)
                {
                    time += 1 / 60f;
                    sm.Tick(new WeaponFrame { dt = 1 / 60f, alive = true, canAct = true, fireDown = true, firePressed = i == 0 });
                }
                Assert.AreSame(WeaponRuntime.Of(gun), sm.Runtime(gun), "状态机与词条共用一份运行时状态");
                return rec.shots;
            }
            int normal = Fire(-1), hasted = Fire(99);
            Assert.That(normal, Is.InRange(25, 27));
            Assert.That(hasted, Is.InRange(30, 33), "射速 × 1.2");
        }

        sealed class RecordFx : IWeaponEffects
        {
            public int shots;
            public readonly List<ShotMods> mods = new();

            public void Shoot(WeaponInstance w, in ShotMods m, Element element)
            {
                mods.Add(m);
                if (!m.deferred) shots++;
            }

            public void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback) { }
            public void Cue(WeaponInstance w, FireCue cue) { }
            public void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other) { }
        }

        [Test]
        public void StatusHunterAndRxnDmgModifiers()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("statusHunter", 0.08f), ("rxnDmg", 0.25f));
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            env.statuses[e] = StatusMask.Burn | StatusMask.Corrode | StatusMask.Slow;
            float M(DamageInfo info) => AffixRuntime.Apply(w, R, new HitContext { target = e, info = info }, fx);

            var weapon = new DamageInfo { source = DamageSource.Weapon, tags = DamageTag.Weapon, weaponUid = w.uid };
            Assert.AreEqual(1 + 0.08f * 2, M(weapon), Eps, "两种元素状态（减速不算）");
            var blast = weapon;
            blast.tags |= DamageTag.Explosion;
            blast.depth = 1;
            Assert.AreEqual(1 + 0.08f * 2, M(blast), Eps, "武器爆炸、衍生伤害也吃乘隙");
            var rx = ReactionSystem.ReactionHit(30, Element.Fire, 0, Vector3.zero, Reaction.Meltdown, w.uid);
            Assert.AreEqual(1.25f, M(rx), Eps, "反应伤害只吃化合");
            var dot = new DamageInfo { source = DamageSource.Status, tags = DamageTag.Dot, weaponUid = w.uid };
            Assert.AreEqual(1f, M(dot), Eps, "持续伤害都不吃");
            env.statuses[e] = StatusMask.None;
            Assert.AreEqual(1f, M(weapon), Eps);
            Assert.AreEqual(1 + 0.05f * 3, Affix_StatusHunter.Mult(0.05f, AffixEffects.ElementMask, weapon), Eps);
        }

        [Test]
        public void DetonateNeedsCritOrHeadshotAndStatusesWithCooldown()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "revolver", ("detonate", 0.8f));
            var e = Enemy();
            env.now = 1;
            fx.OnDamaged(Hit(e, w, 50, crit: true));
            Assert.AreEqual(0, fx.Pending, "身上没有元素状态");
            env.statuses[e] = StatusMask.Shock;
            fx.OnDamaged(Hit(e, w, 50));
            Assert.AreEqual(0, fx.Pending, "不暴击也没爆头");
            fx.OnDamaged(Hit(e, w, 50, crit: true));
            fx.OnDamaged(Hit(e, w, 30, weak: true));
            fx.Flush();
            var d = env.detonates.Single();
            Assert.AreEqual(50 + 50 + 50 + 30, d.o.power, Eps, "强度 = 上一帧本武器对它的全部直接伤害（同帧合并）");
            Assert.AreEqual(0.8f, d.o.mult, Eps);
            Assert.AreEqual(w.uid, d.o.weaponUid);
            env.now = 2.4f;
            fx.OnDamaged(Hit(e, w, 50, crit: true));
            Assert.AreEqual(0, fx.Pending, "1.5 s 内置冷却");
            env.now = 2.5f;
            fx.OnDamaged(Hit(e, w, 50, crit: true));
            Assert.AreEqual(1, fx.Pending);
        }

        [Test]
        public void SeedSpreadsOneReactionToANeighbour()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "smg", ("seed", 0.4f));
            var e = Enemy();
            var near = Enemy();
            env.nearest = near;
            env.now = 1;
            fx.OnDamaged(Hit(e, w, 30));
            Assert.IsTrue(fx.HasSeed(e), "命中种下蛊种");
            Assert.AreEqual(0, fx.Pending, "种蛊不入队");

            fx.OnReaction(Rx(e, null, Reaction.Veinseal, B: 50, tag: DamageTag.Echo));
            fx.OnReaction(Rx(e, null, Reaction.Veinseal, B: 50, depth: 1));
            Assert.AreEqual(0, fx.Pending, "传染出的反应、深度到顶的反应不再传染");
            fx.OnReaction(Rx(e, null, Reaction.Veinseal, B: 50));
            Assert.AreEqual(1, fx.Pending, "任何来源的反应都会传染");
            Assert.IsFalse(fx.HasSeed(e), "只传一次");
            fx.Flush();
            var t = env.triggers.Single();
            Assert.AreEqual(near, t.e);
            Assert.AreEqual(Reaction.Veinseal, t.id);
            Assert.AreEqual(20f, t.o.fixedBase.Value, Eps, "威力 × 值");
            Assert.AreEqual(DamageTag.Echo, t.o.tag);
            Assert.AreEqual(1, t.o.depth);
            Assert.AreEqual(w.uid, t.o.weaponUid, "归属种下它的枪");
            Assert.AreEqual(1, env.beams);

            env.now = 2;
            fx.OnDamaged(Hit(e, w, 30));
            env.now = 8.5f;
            fx.OnReaction(Rx(e, null));
            Assert.AreEqual(0, fx.Pending, "6 s 后蛊种消失");
        }

        [Test]
        public void ClearDropsPendingProcs()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Gun(env, "revolver", ("headBlast", 0.6f), ("seed", 0.4f));
            var e = Enemy();
            fx.OnDamaged(Hit(e, w, 50, weak: true));
            Assert.AreEqual(1, fx.Pending);
            fx.Clear();
            Assert.AreEqual(0, fx.Pending);
            Assert.IsFalse(fx.HasSeed(e));
            fx.Flush();
            Assert.AreEqual(0, env.blasts.Count, "换关丢弃");
        }

        [Test]
        public void ProcsQueuedDuringFlushRunNextFlush()
        {
            // 执行中再触发的效果（爆炸伤害又打出一次爆头命中 / 打死人引发殉爆）排到下一次 Flush，不在本次里连锁
            var inner = new FakeEnv();
            var env = new ReentrantEnv(inner);
            var fx = new AffixEffects(env);
            var w = Gun(inner, "revolver", ("headBlast", 0.6f));
            var e = Enemy();
            env.onExplode = () =>
            {
                inner.now += 1;
                fx.OnDamaged(Hit(e, w, 50, weak: true));
            };
            fx.OnDamaged(Hit(e, w, 50, weak: true));
            fx.Flush();
            Assert.AreEqual(1, inner.blasts.Count);
            Assert.AreEqual(1, fx.Pending, "执行中入队的留到下一次");
            fx.Flush();
            Assert.AreEqual(2, inner.blasts.Count);
        }

        /// <summary>爆炸时回调（模拟爆炸伤害在 Flush 途中引发新的命中事件），其余转给 <see cref="FakeEnv"/></summary>
        sealed class ReentrantEnv : IAffixEnv
        {
            readonly FakeEnv inner;
            public System.Action onExplode;

            public ReentrantEnv(FakeEnv inner) => this.inner = inner;

            public float Now => inner.now;
            public float Random() => inner.Random();
            public WeaponInstance Find(int uid) => inner.Find(uid);
            public ResolvedWeapon Resolve(WeaponInstance w) => inner.Resolve(w);
            public StatusMask Statuses(Damageable e) => inner.Statuses(e);
            public float ReactionHaste => inner.ReactionHaste;
            public Vector3 Center(Damageable e) => inner.Center(e);
            public Damageable Nearest(Vector3 from, float range, Damageable exclude) => inner.Nearest(from, range, exclude);
            public void Refill(WeaponInstance w, int rounds) => inner.Refill(w, rounds);
            public void AddShield(float amount) => inner.AddShield(amount);

            public void Explode(in ExplosionOptions o, bool ring)
            {
                inner.Explode(in o, ring);
                onExplode?.Invoke();
            }

            public void Strike(Damageable target, in DamageInfo info, Vector3 from, Color tracer) => inner.Strike(target, in info, from, tracer);
            public void ApplyStatus(Damageable e, Element element, float power, in StatusApplyOpts o) => inner.ApplyStatus(e, element, power, in o);
            public void Detonate(Damageable e, in DetonateOpts o) => inner.Detonate(e, in o);
            public bool Trigger(Damageable e, Reaction id, in TriggerOpts o) => inner.Trigger(e, id, in o);
            public void Beam(Vector3 from, Vector3 to, Color color) => inner.Beam(from, to, color);
        }

        // ───────────── 跨关保存 ─────────────

        [System.Serializable]
        public sealed class SaveHolder
        {
            public List<WeaponSave> weapons = new();
        }

        [Test]
        public void AffixesSurviveStageChange()
        {
            var w = new WeaponInstance(Def("stormpod"), Rarity.Legendary);
            w.SetAffixes(new[] { new WeaponAffix("subShock", 0.4f), new WeaponAffix("dmg", 0.13f), new WeaponAffix("rxnShield", 7f) });
            var saved = AffixSave.Capture(w);
            CollectionAssert.AreEqual(new[] { "subShock", "dmg", "rxnShield" }, saved.Select(s => s.id).ToArray());

            // JsonUtility 往返（存档）
            var holder = new SaveHolder();
            holder.weapons.Add(new WeaponSave { id = w.def.id, rarity = w.rarity, affixes = saved });
            var back = JsonUtility.FromJson<SaveHolder>(JsonUtility.ToJson(holder));
            var copy = new WeaponInstance(Def("stormpod"), back.weapons[0].rarity);
            AffixSave.Restore(copy, back.weapons[0].affixes);
            CollectionAssert.AreEqual(w.affixes.Select(a => a.ToString()).ToArray(), copy.affixes.Select(a => a.ToString()).ToArray());
            Assert.AreEqual(0.13f, WeaponStatsResolver.Resolve(copy, null).Total("dmg"), Eps, "解析器吃到读回的词条");

            // 旧快照没有词条：保留固有词条
            var old = new WeaponInstance(Def("stormpod"));
            AffixSave.Restore(old, null);
            AffixSave.Restore(old, new AffixSave[0]);
            Assert.AreEqual("subShock", old.affixes.Single().id);

            // 控制器的 Capture / Restore（L1 的跨关流程走这里）
            var go = new GameObject("affix save controller");
            made.Add(go);
            var wc = go.AddComponent<WeaponController>();
            wc.slots[0] = w;
            var run = new RunState();
            wc.Capture(run);
            var go2 = new GameObject("affix save controller 2");
            made.Add(go2);
            var wc2 = go2.AddComponent<WeaponController>();
            wc2.Restore(run);
            Assert.AreEqual("stormpod", wc2.slots[0].def.id);
            CollectionAssert.AreEqual(w.affixes.Select(a => a.ToString()).ToArray(), wc2.slots[0].affixes.Select(a => a.ToString()).ToArray(), "换关后词条还在");
        }
    }
}
