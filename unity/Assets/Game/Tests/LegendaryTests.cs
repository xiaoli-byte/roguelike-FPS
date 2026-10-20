using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using static Spiritfire.Game.Tests.AffixTriggerTests;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// AF3：传说特性 10 条，对照 TS src/weapons/{Affixes,AffixEffects,WeaponSystem}.ts：注册与顺序、数值、文本（前缀）、准入、抽取规则，
    /// 开火钩子（天命 / 终焉 / 无尽，走真的 <see cref="WeaponStateMachine"/>）、射速钩子（狂热）、命中 / 击杀 / 反应类（假环境，见 <see cref="AffixTriggerTests"/>）、输出修饰（轮回 / 鼎沸）。
    /// </summary>
    public sealed class LegendaryTests
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
            WeaponRuntime.Random = () => UnityEngine.Random.value;
            foreach (var go in made)
                if (go) Object.DestroyImmediate(go);
            made.Clear();
        }

        Damageable Enemy(float maxHp = 1000)
        {
            var go = new GameObject("legendary test enemy");
            made.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.ResetVitals();
            return d;
        }

        static WeaponInstance Legend(FakeEnv env, string weapon, string legendary, Element element = Element.None)
        {
            var def = Def(weapon);
            var lg = (LegendaryDef)AffixLibrary.Get(legendary);
            var w = new WeaponInstance(def, Rarity.Legendary) { element = element };
            w.SetAffixes(new[] { new WeaponAffix(legendary, lg.Value(def)) });
            env?.weapons.Add(w);
            return w;
        }

        // ───────────── 定义 ─────────────

        static readonly (string id, string name)[] Ts =
        {
            ("lg_nth", "天命"), ("lg_nova", "殉爆"), ("lg_last", "终焉"), ("lg_prism", "万象"), ("lg_frenzy", "狂热"),
            ("lg_endless", "无尽"), ("lg_bond", "合璧"), ("lg_lunhui", "轮回"), ("lg_nirvana", "涅槃"), ("lg_boil", "鼎沸"),
        };

        [Test]
        public void TenLegendariesRegisteredInTsOrder()
        {
            var lgs = AffixLibrary.Legendaries();
            CollectionAssert.AreEqual(Ts.Select(t => t.id).ToArray(), lgs.Select(l => l.id).ToArray(), "顺序同 TS LEGENDARIES");
            CollectionAssert.AreEqual(Ts.Select(t => t.name).ToArray(), lgs.Select(l => l.name).ToArray());
            foreach (var l in lgs)
            {
                Assert.AreEqual(AffixKind.Legendary, l.Kind, l.id);
                Assert.IsTrue(AffixLibrary.IsLegendary(l.id));
                Assert.IsNotNull(l.Effect, $"{l.id} 有效果");
                Assert.AreEqual(l.name, AffixText.LegendaryName(l.id));
            }
            Assert.IsFalse(AffixLibrary.Rollable().Any(a => a is LegendaryDef), "传说不进普通词条池");
        }

        [Test]
        public void ValuesMatchTs()
        {
            float V(string id, string weapon) => ((LegendaryDef)AffixLibrary.Get(id)).Value(Def(weapon));
            float Vd(string id, WeaponDef d) => ((LegendaryDef)AffixLibrary.Get(id)).Value(d);
            // 天命：每秒射击 ≥ 8 → 6，≥ 2.5 → 5，否则 4（点射按每发）
            Assert.AreEqual(6, V("lg_nth", "smg"));
            Assert.AreEqual(6, V("lg_nth", "beam"));
            Assert.AreEqual(5, V("lg_nth", "revolver"));
            Assert.AreEqual(4, V("lg_nth", "shotgun"));
            Assert.AreEqual(4, V("lg_nth", "launcher"));
            Assert.AreEqual(6, Vd("lg_nth", new WeaponDef { fireRate = 8 }));
            Assert.AreEqual(5, Vd("lg_nth", new WeaponDef { fireRate = 7.99f }));
            Assert.AreEqual(5, Vd("lg_nth", new WeaponDef { fireRate = 2.5f }));
            Assert.AreEqual(4, Vd("lg_nth", new WeaponDef { fireRate = 2.49f }));
            Assert.AreEqual(5, Vd("lg_nth", new WeaponDef { fireRate = 1.6f, burstCount = 3 }), "点射 1.6 轮 × 3 发");
            // 万象：1.6 ÷ 每秒命中数，钳在 [5%, 75%]
            Assert.AreEqual(1.6f / 13, V("lg_prism", "smg"), Eps);
            Assert.AreEqual(1.6f / (1.4f * 9), V("lg_prism", "shotgun"), Eps, "霰弹按弹丸");
            Assert.AreEqual(0.16f, V("lg_prism", "beam"), Eps);
            Assert.AreEqual(0.75f, V("lg_prism", "launcher"), Eps, "上限");
            Assert.AreEqual(0.05f, Vd("lg_prism", new WeaponDef { fireRate = 20, pellets = 10 }), Eps, "下限");
            // 其余固定
            Assert.AreEqual(4, V("lg_nova", "smg"));
            Assert.AreEqual(3, V("lg_last", "revolver"));
            Assert.AreEqual(0.04f, V("lg_frenzy", "smg"), 1e-6f);
            Assert.AreEqual(0.3f, V("lg_endless", "smg"), 1e-6f);
            Assert.AreEqual(1, V("lg_bond", "beam"));
            Assert.AreEqual(0.6f, V("lg_lunhui", "smg"), 1e-6f);
            Assert.AreEqual(0.25f, V("lg_nirvana", "smg"), 1e-6f);
            Assert.AreEqual(0.06f, V("lg_boil", "smg"), 1e-6f);
            Assert.AreEqual(4.5f, AffixLibrary.Get("lg_nth").Round(4.5f), "特性数值不取整、不随稀有度放大");
        }

        [Test]
        public void TextsCarryLegendaryPrefix()
        {
            string T(string id, WeaponDef d) => AffixText.Describe(d, new WeaponAffix(id, ((LegendaryDef)AffixLibrary.Get(id)).Value(d)));
            var smg = Def("smg");
            Assert.AreEqual("【传说·天命】每第 6 发必定暴击", T("lg_nth", smg));
            Assert.AreEqual("【传说·天命】每第 6 跳必定暴击", T("lg_nth", Def("beam")));
            var swarm = new WeaponDef { id = "t_swarm", fireRate = 0.75f, projectile = new ProjectileSpec { count = 5 } };
            Assert.AreEqual("【传说·天命】每第 4 轮必定暴击", T("lg_nth", swarm));
            var blade = new WeaponDef { id = "t_blade", kind = WeaponKind.Blade, fireRate = 1, blade = new DemonBladeSpec() };
            Assert.AreEqual("【传说·天命】每第 4 段斩击必定暴击", T("lg_nth", blade));
            Assert.AreEqual("【传说·殉爆】击杀敌人时引发同元素爆炸（4 米），可连锁", T("lg_nova", smg));
            Assert.AreEqual("【传说·终焉】弹匣最后一发伤害 ×3", T("lg_last", smg));
            Assert.AreEqual("【传说·终焉】弹匣最后一轮伤害 ×3", T("lg_last", swarm));
            Assert.AreEqual("【传说·万象】命中时各有 12% 几率附加灼烧、雷殛、蚀化", T("lg_prism", smg));
            Assert.AreEqual("【传说·狂热】命中叠加 4% 射速（最多 10 层），2 秒未命中清空", T("lg_frenzy", smg));
            Assert.AreEqual("【传说·无尽】开火时 30% 几率不消耗弹药", T("lg_endless", smg));
            Assert.AreEqual("【传说·合璧】命中带有其他元素状态的敌人时，必定附加本武器的元素", T("lg_bond", smg));
            Assert.AreEqual("【传说·轮回】命中时依次附加灼烧、雷殛、蚀化（每 0.6 秒一次）；本武器引发的「归墟」伤害 +50%", T("lg_lunhui", smg));
            Assert.AreEqual("【传说·涅槃】击杀身负两种以上元素状态的敌人时，于其尸身引发对应反应（威力为其最大生命的 25%）", T("lg_nirvana", smg));
            Assert.AreEqual("【传说·鼎沸】本武器每引发一次元素反应，武器与反应伤害 +6%（最多 8 层，4 秒未触发则清空）", T("lg_boil", smg));

            var w = Legend(null, "smg", "lg_nth");
            Assert.AreEqual("天命·蜂鸣冲锋枪", WeaponLibrary.DisplayName(w), "武器名带传说前缀");
            w.level = 2;
            Assert.AreEqual("天命·蜂鸣冲锋枪 +2", w.Title);
            Assert.AreEqual("【传说·天命】每第 6 发必定暴击", AffixText.Traits(w).Last(), "特性行里传说排最后");
        }

        static HashSet<string> Allowed(WeaponDef def, Element element)
        {
            var ctx = new AffixContext(def, element, def.innate?.Select(a => a.id).ToList());
            return new HashSet<string>(AffixLibrary.Legendaries().Where(l => l.Allow(ctx)).Select(l => l.id));
        }

        [Test]
        public void EligibilityMatchesTs()
        {
            string[] all = Ts.Select(t => t.id).ToArray();
            string[] Without(params string[] ids) => all.Except(ids).ToArray();
            void Expect(WeaponDef d, Element e, string[] expected)
            {
                var got = Allowed(d, e);
                Assert.IsTrue(new HashSet<string>(expected).SetEquals(got),
                    $"{d.id}/{e}：期望 [{string.Join(",", expected.OrderBy(x => x))}] 实际 [{string.Join(",", got.OrderBy(x => x))}]");
            }
            // 物理弹没有可附加的元素：合璧只给带元素 / 元素轮转的
            Expect(Def("smg"), Element.None, Without("lg_bond"));
            Expect(Def("smg"), Element.Fire, all);
            // 光束：没有终焉
            Expect(Def("beam"), Element.Shock, Without("lg_last"));
            // 碎刃：没有终焉 / 无尽
            var blade = new WeaponDef { id = "t_blade", kind = WeaponKind.Blade, mode = FireMode.Semi, fireRate = 1, blade = new DemonBladeSpec() };
            Expect(blade, Element.None, Without("lg_last", "lg_endless", "lg_bond"));
            // 元素轮转：没有轮回，有合璧
            var trinity = new WeaponDef { id = "t_trinity", mode = FireMode.Semi, fireRate = 2, cycle = new[] { Element.Fire, Element.Shock, Element.Corrode } };
            Expect(trinity, Element.Fire, Without("lg_lunhui"));
        }

        [Test]
        public void LegendaryOnlyOnLegendaryRarityPickedUniformly()
        {
            var smg = Def("smg");
            var rng = new System.Random(11);
            var counts = new Dictionary<string, int>();
            const int n = 18000;
            for (int i = 0; i < n; i++)
            {
                var list = AffixRoll.Roll(smg, Rarity.Legendary, Element.None, rng);
                var lgs = list.Where(a => AffixLibrary.IsLegendary(a.id)).ToList();
                Assert.AreEqual(1, lgs.Count, "传说品质恰好一条特性");
                Assert.AreEqual(lgs[0].id, list.Last().id, "排最后");
                Assert.AreEqual(((LegendaryDef)AffixLibrary.Get(lgs[0].id)).Value(smg), lgs[0].value, "数值由武器决定");
                counts[lgs[0].id] = counts.TryGetValue(lgs[0].id, out var c) ? c + 1 : 1;
            }
            var allowed = Allowed(smg, Element.None);
            CollectionAssert.AreEquivalent(allowed, counts.Keys, "只抽准入的");
            foreach (var id in allowed) Assert.AreEqual(1f / allowed.Count, counts[id] / (float)n, 0.015f, $"{id} 等概率");
            for (int i = 0; i < 300; i++)
                Assert.IsFalse(AffixRoll.Roll(smg, Rarity.Epic, Element.Fire, rng).Any(a => AffixLibrary.IsLegendary(a.id)), "史诗没有特性");

            // WeaponRoller 整条链：传说品质的枪名带前缀，解析器记下特性
            for (int i = 0; i < 50; i++)
            {
                var w = WeaponRoller.Roll(new WeaponRoller.RollOptions { id = "revolver", rarity = Rarity.Legendary, useNoStats = true }, rng);
                var R = WeaponStatsResolver.Resolve(w, null);
                Assert.IsNotNull(R.legendary);
                Assert.IsTrue(WeaponLibrary.DisplayName(w).StartsWith(AffixText.LegendaryName(R.legendary) + "·"));
            }
        }

        // ───────────── 开火钩子（状态机）─────────────

        sealed class RecordFx : IWeaponEffects
        {
            public readonly List<ShotMods> mods = new();
            public void Shoot(WeaponInstance w, in ShotMods m, Element element) => mods.Add(m);
            public void VolleyProjectile(WeaponInstance w, int index, int count, bool feedback) { }
            public void Cue(WeaponInstance w, FireCue cue) { }
            public void Notify(WeaponNote note, WeaponInstance w, WeaponInstance other) { }
        }

        static (WeaponStateMachine sm, RecordFx fx) Machine(WeaponInstance w)
        {
            var fx = new RecordFx();
            return (new WeaponStateMachine(new[] { w, null }, fx, () => 0, x => WeaponStatsResolver.Resolve(x, null)), fx);
        }

        [Test]
        public void NthForcesEveryNthShotToCrit()
        {
            var w = Legend(null, "smg", "lg_nth");
            w.mag = 99;
            var (sm, fx) = Machine(w);
            for (int i = 0; i < 13; i++) sm.Shoot(in ShotMods.None);
            var crits = fx.mods.Select((m, i) => (m, i)).Where(x => x.m.forceCrit).Select(x => x.i + 1).ToArray();
            CollectionAssert.AreEqual(new[] { 6, 12 }, crits, "第 6、12 发必定暴击");
            Assert.AreEqual(13, WeaponRuntime.Of(w).shots);
            Assert.AreEqual(99 - 13, w.mag);

            // 弹道把它带进伤害请求
            var R = WeaponStatsResolver.Resolve(w, null);
            var ctx = new ShotContext { weapon = w, stats = R, element = Element.None, damage = R.damage, forceCrit = true };
            Assert.IsTrue(new Ballistics(null, null).HitInfo(ctx, 10, Vector3.zero, Vector3.forward).forceCrit);
            ctx.forceCrit = false;
            Assert.IsFalse(new Ballistics(null, null).HitInfo(ctx, 10, Vector3.zero, Vector3.forward).forceCrit);
        }

        [Test]
        public void LastRoundDealsTripleDamage()
        {
            var w = Legend(null, "revolver", "lg_last");
            w.mag = 3;
            var (sm, fx) = Machine(w);
            for (int i = 0; i < 3; i++) sm.Shoot(in ShotMods.None);
            CollectionAssert.AreEqual(new[] { 1f, 1f, 3f }, fx.mods.Select(m => m.mult).ToArray(), "只有最后一发 ×3");
            Assert.AreEqual(0, w.mag);

            // 无限弹药：不扣弹，没有「最后一发」
            w.mag = 1;
            var inf = new WeaponStateMachine(new[] { w, null }, fx, () => 0, x => WeaponStatsResolver.Resolve(x, null));
            inf.Tick(new WeaponFrame { dt = 0.01f, alive = true, canAct = true, infinite = true });
            inf.Shoot(in ShotMods.None);
            Assert.AreEqual(1f, fx.mods.Last().mult);
            Assert.AreEqual(1, w.mag);

            // 蓄力倍率照乘；齐射：开始那一发算好的倍率记下来，逐枚发射时用
            w.mag = 1;
            sm.Shoot(new ShotMods { mult = 0.5f, strength = 1 });
            Assert.AreEqual(1.5f, fx.mods.Last().mult, Eps);
            var swarmDef = new WeaponDef { id = "t_swarm", mode = FireMode.Semi, damage = 30, fireRate = 0.75f, mag = 4, projectile = new ProjectileSpec { count = 5 } };
            var swarm = new WeaponInstance(swarmDef, Rarity.Legendary) { mag = 1 };
            swarm.SetAffixes(new[] { new WeaponAffix("lg_last", 3) });
            var (vsm, _) = Machine(swarm);
            vsm.Shoot(in ShotMods.Volley);
            var volley = WeaponRuntime.Of(swarm).volley;
            Assert.IsTrue(volley.deferred);
            Assert.AreEqual(3f, volley.mult, Eps, "整轮 ×3");
        }

        [Test]
        public void EndlessSometimesKeepsTheRound()
        {
            var w = Legend(null, "smg", "lg_endless");
            w.mag = 10;
            var (sm, fx) = Machine(w);
            WeaponRuntime.Random = () => 0.29f;
            for (int i = 0; i < 5; i++) sm.Shoot(in ShotMods.None);
            Assert.AreEqual(10, w.mag, "掷中 30%：不扣");
            WeaponRuntime.Random = () => 0.3f;
            for (int i = 0; i < 5; i++) sm.Shoot(in ShotMods.None);
            Assert.AreEqual(5, w.mag);
            Assert.AreEqual(10, fx.mods.Count, "免耗也照常开火");

            // 免耗的那一发不算「最后一发」（同一把枪先结算无尽、再结算终焉）
            var both = new WeaponInstance(Def("revolver"), Rarity.Legendary) { mag = 1 };
            both.SetAffixes(new[] { new WeaponAffix("lg_endless", 0.3f), new WeaponAffix("lg_last", 3) });
            var (bsm, bfx) = Machine(both);
            WeaponRuntime.Random = () => 0;
            bsm.Shoot(in ShotMods.None);
            Assert.AreEqual(1f, bfx.mods.Last().mult);
            Assert.AreEqual(1, both.mag);
        }

        // ───────────── 射速 / 命中 / 击杀 / 反应 ─────────────

        [Test]
        public void FrenzyStacksPerShotAndDecays()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "smg", "lg_frenzy");
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            env.now = 1;
            for (int i = 0; i < 9; i++) fx.OnDamaged(Hit(e, w, 5));
            env.now = 1.04f;
            fx.OnDamaged(Hit(e, w, 5));
            Assert.AreEqual(1, WeaponRuntime.Of(w).frenzy, "同一发（0.05 s 内）只叠一层");
            for (int i = 0; i < 15; i++)
            {
                env.now += 0.1f;
                fx.OnDamaged(Hit(e, w, 5));
            }
            Assert.AreEqual(Legendary_Frenzy.MaxStacks, WeaponRuntime.Of(w).frenzy, "最多 10 层");
            Assert.AreEqual(1.4f, WeaponRuntime.RateMult(w, R, env.now + 1.9f), Eps, "射速 × (1 + 10 × 4%)");
            Assert.AreEqual(1f, WeaponRuntime.RateMult(w, R, env.now + 2.1f), Eps, "2 s 没命中清空");
            Assert.AreEqual(0, WeaponRuntime.Of(w).frenzy);
            // 别人的枪 / 衍生伤害不叠
            fx.OnDamaged(Hit(e, w, 5, depth: 1));
            Assert.AreEqual(0, WeaponRuntime.Of(w).frenzy);
        }

        [Test]
        public void BoilStacksOnOwnReactionsAndBoostsWeaponAndReactionDamage()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "revolver", "lg_boil", Element.Fire);
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            float M(DamageInfo info) => AffixRuntime.Apply(w, R, new HitContext { target = e, info = info }, fx);
            var weapon = new DamageInfo { source = DamageSource.Weapon, tags = DamageTag.Weapon, weaponUid = w.uid };
            var reaction = ReactionSystem.ReactionHit(20, Element.Fire, 0, Vector3.zero, Reaction.Thunderfire, w.uid);
            var skill = new DamageInfo { source = DamageSource.Skill, tags = DamageTag.Skill, weaponUid = w.uid };

            env.now = 10;
            Assert.AreEqual(1f, M(weapon), Eps, "还没叠层");
            fx.OnReaction(Rx(e, null));
            Assert.AreEqual(0, WeaponRuntime.Of(w).boil, "不是本武器的反应");
            for (int i = 0; i < 10; i++)
            {
                env.now += 0.5f;
                fx.OnReaction(Rx(e, w));
            }
            Assert.AreEqual(Legendary_Boil.MaxStacks, WeaponRuntime.Of(w).boil, "最多 8 层");
            Assert.AreEqual(1 + 8 * 0.06f, M(weapon), Eps, "武器伤害");
            Assert.AreEqual(1 + 8 * 0.06f, M(reaction), Eps, "本武器的反应伤害");
            Assert.AreEqual(1f, M(skill), Eps, "其他伤害不吃");
            env.now += 4.01f;
            Assert.AreEqual(1f, M(weapon), Eps, "4 s 没触发失效");
            fx.OnReaction(Rx(e, w));
            Assert.AreEqual(1, WeaponRuntime.Of(w).boil, "过了窗口从 0 重新叠");
        }

        [Test]
        public void LunhuiCyclesElementsAndBoostsAbyss()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "smg", "lg_lunhui");
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            foreach (var t in new[] { 0f, 0.3f, 0.61f, 0.62f, 1.22f, 1.83f })
            {
                env.now = t;
                fx.OnDamaged(Hit(e, w, 20));
                fx.Flush();
            }
            CollectionAssert.AreEqual(new[] { Element.Fire, Element.Shock, Element.Corrode, Element.Fire }, env.applied.Select(a => a.el).ToArray(),
                "每 0.6 s 依次 灼烧 → 雷殛 → 蚀化");
            Assert.AreEqual(20f, env.applied[0].power, Eps);
            env.now = 5;
            fx.OnDamaged(Hit(e, w, 20, killed: true));
            Assert.AreEqual(0, fx.Pending, "打死的不附着");

            float M(DamageInfo info) => AffixRuntime.Apply(w, R, new HitContext { target = e, info = info }, fx);
            Assert.AreEqual(1.5f, M(ReactionSystem.ReactionHit(20, Element.Fire, 0, Vector3.zero, Reaction.Abyss, w.uid)), Eps, "本武器的归墟 ×1.5");
            Assert.AreEqual(1f, M(ReactionSystem.ReactionHit(20, Element.Fire, 0, Vector3.zero, Reaction.Thunderfire, w.uid)), Eps);
            Assert.AreEqual(1f, M(new DamageInfo { source = DamageSource.Weapon, tags = DamageTag.Weapon, weaponUid = w.uid }), Eps);
        }

        [Test]
        public void BondForcesOwnElementOntoOtherStatusesWithGap()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "revolver", "lg_bond", Element.Fire);
            var e = Enemy();
            env.now = 1;
            env.statuses[e] = StatusMask.Burn;
            fx.OnDamaged(Hit(e, w, 30, element: Element.Fire));
            Assert.AreEqual(0, fx.Pending, "身上只有同种元素");
            env.statuses[e] = StatusMask.Shock;
            fx.OnDamaged(Hit(e, w, 30, element: Element.Fire, applied: Element.Fire));
            Assert.AreEqual(0, fx.Pending, "这一击已经附着上了");
            fx.OnDamaged(Hit(e, w, 30, element: Element.Fire));
            Assert.AreEqual(1, fx.Pending);
            fx.Flush();
            Assert.AreEqual(Element.Fire, env.applied.Single().el);
            env.now = 1.9f;
            fx.OnDamaged(Hit(e, w, 30, element: Element.Fire));
            Assert.AreEqual(0, fx.Pending, "同一敌人 1 s 一次");
            env.now = 2f;
            fx.OnDamaged(Hit(e, w, 30, element: Element.Fire));
            Assert.AreEqual(1, fx.Pending);
            Assert.AreEqual(0.5f, Legendary_Bond.GapFor(1f), Eps, "反应急速 +100% → 0.5 s");
            Assert.AreEqual(0.3f, Legendary_Bond.GapFor(5f), Eps, "下限 0.3 s");
        }

        [Test]
        public void PrismRollsEachElementIndependently()
        {
            var env = new FakeEnv { rand = 0 };
            var fx = new AffixEffects(env);
            var w = Legend(env, "smg", "lg_prism");
            var e = Enemy();
            fx.OnDamaged(Hit(e, w, 40, element: Element.Shock));
            fx.Flush();
            CollectionAssert.AreEqual(new[] { Element.Fire, Element.Shock, Element.Corrode }, env.applied.Select(a => a.el).ToArray());
            foreach (var a in env.applied)
            {
                Assert.AreEqual(40f, a.power, Eps, "强度 = 这一击伤害折算的状态强度");
                Assert.AreEqual(AffixEffects.PrismReactionScale, a.o.reactionScale, Eps, "引发的反应 ×0.6");
                Assert.AreEqual(w.uid, a.o.weaponUid);
            }
            env.rand = 0.5f;
            fx.OnDamaged(Hit(e, w, 40));
            Assert.AreEqual(0, fx.Pending, "12% 没掷中");
        }

        [Test]
        public void NovaExplodesOnKillsAndChainsTwoLevels()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "smg", "lg_nova");
            var R = WeaponStatsResolver.Resolve(w, null);
            var e = Enemy();
            fx.OnKilled(Kill(e, w, 0, Element.Fire));
            fx.OnKilled(Kill(e, w, 1));
            fx.OnKilled(Kill(e, w, 2));
            fx.Flush();
            Assert.AreEqual(2, env.blasts.Count, "直接击杀与第一级殉爆的击杀会炸，再往下不炸");
            var (o, ring) = env.blasts[0];
            Assert.IsTrue(ring);
            Assert.AreEqual(4f * R.blastMult, o.radius, Eps);
            Assert.AreEqual(Legendary_Nova.Damage(R), o.info.amount, Eps);
            Assert.AreEqual(Mathf.Clamp(0.35f * R.dps + 0.5f * R.perShot, 35, 220), o.info.amount, Eps);
            Assert.AreEqual(Element.Fire, o.info.element);
            Assert.AreEqual(1f, o.info.statusChance, "同元素必定附着");
            Assert.AreEqual(1, o.info.depth);
            Assert.AreEqual(Legendary_Nova.Knockback, o.info.knockback);
            Assert.AreEqual(0f, env.blasts[1].o.info.statusChance, "无元素不附着");
            Assert.AreEqual(2, env.blasts[1].o.info.depth);
            Assert.AreEqual(35f, Legendary_Nova.Damage(new ResolvedWeapon()), "下限 35");
            Assert.AreEqual(220f, Legendary_Nova.Damage(new ResolvedWeapon { dps = 1000, perShot = 100 }), "上限 220");
        }

        [Test]
        public void NirvanaTriggersTheStatusReactionOnTheCorpse()
        {
            var env = new FakeEnv();
            var fx = new AffixEffects(env);
            var w = Legend(env, "smg", "lg_nirvana");
            var e = Enemy(800);
            env.statuses[e] = StatusMask.Burn | StatusMask.Shock;
            fx.OnDamaged(Hit(e, w, 30));
            Assert.AreEqual(0, fx.Pending, "没打死");
            fx.OnDamaged(Hit(e, w, 30, killed: true));
            fx.Flush();
            var t = env.triggers.Single();
            Assert.AreEqual(Reaction.Thunderfire, t.id);
            Assert.AreEqual(200f, t.o.power, Eps, "最大生命 × 25%");
            Assert.IsTrue(t.o.ignoreIcd);
            Assert.AreEqual(DamageTag.Nirvana, t.o.tag);
            Assert.AreEqual(AffixEffects.NirvanaDepth, t.o.depth);
            Assert.IsTrue(t.o.point.HasValue, "尸身位置");

            env.statuses[e] = StatusMask.Burn;
            fx.OnDamaged(Hit(e, w, 30, killed: true));
            Assert.AreEqual(0, fx.Pending, "一种状态不够");
            env.statuses[e] = StatusMask.Burn | StatusMask.Shock | StatusMask.Corrode;
            fx.OnDamaged(Hit(e, w, 30, killed: true));
            fx.Flush();
            Assert.AreEqual(Reaction.Abyss, env.triggers.Last().id, "三种齐聚 → 归墟");
            Assert.AreEqual(Reaction.Meltdown, AffixEffects.ReactionOf(StatusMask.Burn | StatusMask.Corrode));
            Assert.AreEqual(Reaction.Veinseal, AffixEffects.ReactionOf(StatusMask.Shock | StatusMask.Corrode));
        }
    }
}
