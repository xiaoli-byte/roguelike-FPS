using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 反应秘卷（S5a 基础 12 + S5b 进阶 12）：每个钩子至少一条用例，数值对照 src/progression/scrolls/defsReaction.ts。
    /// 真实的属性表、事件、伤害管线（反应伤害按标签增伤、破甲、击杀）；挂元素 / 引爆 / 强制反应 / 范围查询 / 爆炸 / 投射物 / 敌人身上的状态
    /// 经 <see cref="FakeScrollHost"/> 记录（反应系统本身由 ReactionTests 覆盖）。反应事件按 ReactionSystem 的口径直接派发。
    /// </summary>
    public sealed class ScrollReactionTests : ScrollHostFixture
    {
        static readonly string[] ReactionIds =
        {
            "rx_catalyst", "rx_haste", "rx_tf_charm", "rx_mg_charm", "rx_vs_charm", "rx_lead_shock", "rx_lead_fire", "rx_lead_corrode",
            "rx_ward", "rx_transmute", "rx_acupoint", "rx_tf_scatter", "rx_mg_shatter", "rx_vs_lock", "rx_ab_mark",
            "fox_thunderfire", "falcon_veinseal", "bear_magma", "rx_tf_capstone", "rx_mg_capstone", "rx_vs_capstone", "rx_ab_amp",
            "rx_hunyuan", "rx_kalpa",
        };

        static List<ScrollDef> ReactionDefs => ReactionIds.Select(ScrollLibrary.Get).ToList();

        // ───────────── 数据 ─────────────

        [Test]
        public void AllTwentyFourReactionScrollsAreRegisteredInTsOrderWithTsData()
        {
            var defs = ReactionDefs;
            Assert.IsTrue(defs.All(d => d != null), "24 卷反应都登记了");
            var registered = Registry<ScrollDef>.All.Where(d => ReactionIds.Contains(d.id)).Select(d => d.id).ToArray();
            CollectionAssert.AreEqual(ReactionIds, registered, "按 TS 顺序登记");
            var byRarity = new int[5];
            foreach (var d in defs) byRarity[d.rarity]++;
            CollectionAssert.AreEqual(new[] { 5, 4, 9, 4, 2 }, byRarity, "稀有度分布同 TS");
            Assert.IsTrue(defs.All(d => d.HasTag("反应")), "都带「反应」标签（参与元素来源 / 流派加权）");
            Assert.IsEmpty(ScrollLibrary.Validate(defs, out _), "数据校验");
            Assert.AreEqual(5, Def("rx_catalyst").maxStacks);
            Assert.AreEqual(4, Def("rx_haste").maxStacks);
            Assert.AreEqual(4, Def("rx_vs_charm").maxStacks);
            foreach (var id in new[] { "rx_tf_capstone", "rx_mg_capstone", "rx_vs_capstone", "rx_ab_amp" }) Assert.AreEqual(2, Def(id).maxStacks, id);
            Assert.AreEqual(1, Def("rx_kalpa").maxStacks);
            Assert.AreEqual("fox", Def("fox_thunderfire").heroOnly);
            Assert.AreEqual("falcon", Def("falcon_veinseal").heroOnly);
            Assert.AreEqual("bear", Def("bear_magma").heroOnly);
            Assert.AreEqual("武器命中灼烧中的敌人时，每层 8% 概率附加雷殛（引发「焚雷」）。", Def("rx_lead_shock").description);
            CollectionAssert.AreEqual(new[] { "元素", "反应", "熔金", "灼烧", "命中" }, Def("rx_lead_fire").tags);
            Assert.IsTrue(Def("rx_hunyuan").HasTag("风险") && Def("rx_kalpa").HasTag("风险"));
        }

        [Test]
        public void EveryReactionScrollInstallsAndUninstallsAtEveryStackCleanly()
        {
            int out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count, tasks0 = ScrollTicker.TaskCount;
            foreach (var d in ReactionDefs)
            {
                for (int n = 1; n <= d.maxStacks; n++) Assert.IsTrue(inv.Gain(d, sheet));
                Assert.IsNotEmpty(d.Describe(d.maxStacks));
                inv.Remove(d.id);
                Assert.AreEqual(out0, Combat.Outgoing.Count, d.id);
                Assert.AreEqual(in0, PlayerVitals.Incoming.Count, d.id);
                Assert.AreEqual(tasks0, ScrollTicker.TaskCount, d.id);
                Assert.IsFalse(sheet.HasSource(ScrollScope.SourceOf(d.id)), d.id);
            }
            Close(0, sheet.Get(Stat.ReactionDamagePct));
            Close(50, sheet.Get(Stat.MaxShield));
        }

        // ───────────── 纯属性 / 流派符 ─────────────

        [Test]
        public void CatalystAndHasteAreFlatReactionStats()
        {
            Gain("rx_catalyst", 5);
            Gain("rx_haste", 4);
            Close(0.4f, sheet.Get(Stat.ReactionDamagePct));
            Close(0.4f, sheet.Get(Stat.ReactionHaste));
            var e = Enemy();
            Close(140, ReactionHit(e, Reaction.Meltdown).total, "反应伤害只吃反应伤害");
            Close(100, Hit(e).total);
        }

        [Test]
        public void CharmsBoostTheirOwnReactionTagAndAddTheirStats()
        {
            Gain("rx_tf_charm", 2);
            Gain("rx_mg_charm", 3);
            Gain("rx_vs_charm", 4);
            Close(0.08f, sheet.Get(Stat.FireDamagePct));
            Close(0.08f, sheet.Get(Stat.ShockDamagePct));
            Close(0.18f, sheet.Get(Stat.ArmorDamagePct));
            Close(0.24f, sheet.Get(Stat.ShieldDamagePct));
            var e = Enemy();
            Close(124, ReactionHit(e, Reaction.Thunderfire).total);
            Close(136, ReactionHit(e, Reaction.Meltdown).total);
            Close(148, ReactionHit(e, Reaction.Veinseal).total);
            Close(100, ReactionHit(e, Reaction.Abyss).total);
            Close(100, Hit(e).total, "普通命中不吃流派加成");
            var preview = Def("rx_tf_charm").PreviewStats(4);
            Assert.AreEqual(2, preview.Count);
            Close(0.16f, preview[0].value);
        }

        // ───────────── 引雷 / 引火 / 引蚀 ─────────────

        [TestCase("rx_lead_shock", Element.Fire, Element.Shock)]
        [TestCase("rx_lead_fire", Element.Corrode, Element.Fire)]
        [TestCase("rx_lead_corrode", Element.Shock, Element.Corrode)]
        public void LeadScrollsNeedTheStatusRollPerEnemyAndApplyAtDepthZero(string id, Element need, Element give)
        {
            Gain(id, 3);
            var e = Enemy();
            host.Give(e, need);
            Hit(e);
            Assert.AreEqual(1, host.applied.Count);
            var ap = host.applied[0];
            Assert.AreEqual(e, ap.d);
            Assert.AreEqual(give, ap.e);
            Close(100, ap.power, "状态强度 = 实际伤害除掉每跳会乘回的倍率");
            Assert.AreEqual(0, ap.opts.depth, "沿用这一击的深度 0：直接反应");
            Assert.AreEqual(a.uid, ap.opts.weaponUid);
            AssertChances(0.24f); // 每层 8%
            Hit(e);
            Assert.AreEqual(1, host.chances.Count, "逐敌 0.4 s 冷却在概率之前");
            Step(0.4f);
            Hit(e);
            Assert.AreEqual(2, host.applied.Count);

            var bare = Enemy(2);
            Hit(bare);
            Assert.AreEqual(2, host.applied.Count, "身上没有前置状态");
            var other = Enemy(3);
            host.Give(other, need);
            Hit(other, depth: 1);
            Hit(other, source: DamageSource.Skill);
            Hit(other, source: DamageSource.Scroll);
            Hit(other, uid: 0);
            Assert.AreEqual(2, host.applied.Count, "只认武器的直接命中");
            host.chance = false;
            Hit(other);
            host.chance = true;
            Hit(other);
            Assert.AreEqual(2, host.applied.Count, "没掷中也算冷却");
            var doomed = Enemy(4, maxHp: 50);
            host.Give(doomed, need);
            Hit(doomed);
            Assert.IsTrue(doomed.Dead);
            Assert.AreEqual(2, host.applied.Count, "致死一击不触发");
            var melee = Enemy(5);
            host.Give(melee, need);
            Hit(melee, source: DamageSource.Melee);
            Assert.AreEqual(3, host.applied.Count, "碎刃近战同样算武器");
        }

        // ───────────── 化劫 / 化元 ─────────────

        [Test]
        public void WardRefundsShieldPerReactionThrottledAndMoreForAbyss()
        {
            Gain("rx_ward", 3);
            Reacted(Reaction.Thunderfire);
            Close(12, host.shield);
            Reacted(Reaction.Meltdown, 1);
            Close(12, host.shield, "0.33 s 内只一次");
            Step(0.33f);
            Reacted(Reaction.Abyss, origin: ReactionOrigin.Forced);
            Close(48, host.shield, "归墟每层 12，强制反应也算");
            Step(0.33f);
            host.alive = false;
            Reacted(Reaction.Veinseal);
            Close(48, host.shield, "阵亡不回");
        }

        [Test]
        public void TransmuteReducesBothCooldownsAtMostEveryHalfSecond()
        {
            Gain("rx_transmute", 3);
            Reacted(Reaction.Thunderfire);
            Reacted(Reaction.Abyss);
            Assert.AreEqual(1, host.cooldowns.Count);
            Close(0.75f, host.cooldowns[0].seconds);
            Assert.IsNull(host.cooldowns[0].slot, "两个技能都回");
            Step(0.5f);
            Reacted(Reaction.Meltdown, 1);
            Assert.AreEqual(2, host.cooldowns.Count);
        }

        // ───────────── 点穴 ─────────────

        [Test]
        public void AcupointDetonatesOnWeakpointHitsAgainstStatusesWithCooldown()
        {
            Gain("rx_acupoint", 2);
            var e = Enemy();
            host.Give(e, Element.Fire);
            Hit(e);
            Assert.AreEqual(0, host.detonations.Count, "要命中弱点");
            Hit(e, weak: true);
            Assert.AreEqual(1, host.detonations.Count);
            var (d, o) = host.detonations[0];
            Assert.AreEqual(e, d);
            Close(200, o.power, "这一击的实际伤害（弱点暴击 ×2）");
            Close(0.8f, o.mult, "每层 40%");
            Assert.AreEqual(a.uid, o.weaponUid);
            Assert.AreEqual(0, o.depth);
            Assert.IsTrue(o.point.HasValue);
            Hit(e, weak: true);
            Assert.AreEqual(1, host.detonations.Count, "冷却 1.2 秒");
            Step(1.2f);
            var bare = Enemy(2);
            Hit(bare, weak: true);
            Assert.AreEqual(1, host.detonations.Count, "身上没有元素状态");
            Hit(e, weak: true, depth: 1);
            Hit(e, weak: true, source: DamageSource.Skill);
            Assert.AreEqual(1, host.detonations.Count, "只认武器直接命中");
            host.detonateResult = null;
            Hit(e, weak: true);
            Hit(e, weak: true);
            Assert.AreEqual(3, host.detonations.Count, "被反应系统拒绝时不计冷却");
            host.detonateResult = DetonateOutcome.Collapse;
            Hit(e, weak: true);
            Hit(e, weak: true);
            Assert.AreEqual(4, host.detonations.Count);
        }

        // ───────────── 爆焰 ─────────────

        [Test]
        public void TfScatterLaunchesThreeFireSparksFromDirectThunderfire()
        {
            Gain("rx_tf_scatter", 2);
            RunState.Current = new RunState { difficulty = 2 };
            var e = Enemy();
            var p = ScrollKit.BodyCenter(e);
            Reacted(Reaction.Thunderfire, 0, e, p);
            Assert.AreEqual(3, host.projectiles.Count);
            foreach (var s in host.projectiles)
            {
                Close(18 * 2 * 1.85f, s.damage.amount);
                Assert.AreEqual(Element.Fire, s.damage.element);
                Assert.AreEqual(DamageSource.Scroll, s.damage.source);
                Close(0.5f, s.damage.statusChance);
                Assert.AreEqual(1, s.damage.depth);
                Assert.IsTrue(s.damage.noCrit && s.damage.Has(DamageTag.Proc));
                Assert.AreEqual("rx_tf_scatter", s.damage.procId);
                Close(2, s.explosionRadius);
                Close(16, s.gravity);
                Close(1.2f, s.lifetime);
                Close(p.y + 0.3f, s.position.y);
                Close(0.75f, new Vector2(s.position.x - p.x, s.position.z - p.z).magnitude, "推到身体之外（半径 0.5 + 0.25）");
                Assert.That(s.velocity.y, Is.InRange(6f, 8f));
                Assert.That(new Vector2(s.velocity.x, s.velocity.z).magnitude, Is.InRange(4f - Eps, 6f + Eps));
            }
            Reacted(Reaction.Thunderfire, 0, e, p);
            Assert.AreEqual(3, host.projectiles.Count, "0.3 s 冷却");
            Step(0.3f);
            Reacted(Reaction.Thunderfire, 1, e, p);
            Reacted(Reaction.Meltdown, 0, e, p);
            Assert.AreEqual(3, host.projectiles.Count, "只认直接焚雷");
            Reacted(Reaction.Thunderfire, 0, null, p);
            Assert.AreEqual(6, host.projectiles.Count, "中心敌人没了照样溅");
        }

        // ───────────── 熔铸 ─────────────

        [Test]
        public void MgShatterSplashesCorrodeShardsWhenMeltdownBreaksArmor()
        {
            Gain("rx_mg_shatter", 2);
            sheet.Add("test", Stat.ElementChancePct, -1); // 只看请求，不让 Combat 真的挂蚀化
            var shards = new List<DamageInfo>();
            InAction<HitEvent> listen = (in HitEvent h) =>
            {
                if (h.info.procId == "rx_mg_shatter") shards.Add(h.info);
            };
            GameEvents.EnemyDamaged += listen;
            try
            {
                var broken = Enemy(0, armor: 100);
                var near = Enemy(2);
                var far = Enemy(10);
                var tough = Enemy(1, armor: 100000);
                Assert.IsTrue(ReactionHit(broken, Reaction.Meltdown, 1000).armorBroken);
                Assert.AreEqual(0, shards.Count, "下一次任务阶段才结算");
                Step(0);
                Assert.AreEqual(2, shards.Count, "5 米内除被击碎者以外的敌人");
                Close(9970, near.health, "min(护甲上限 × 每层 15%, 每层 60 × 强度) = 30");
                Close(10000, far.health);
                var s = shards[0];
                Assert.AreEqual(Element.Corrode, s.element);
                Close(1, s.statusChance);
                Assert.AreEqual(2, s.depth, "熔金伤害深度 1 → 碎片深度 2");
                Assert.AreEqual(DamageSource.Scroll, s.source);
                Assert.IsTrue(s.noCrit);

                ReactionHit(tough, Reaction.Meltdown, 1000);
                var weaponBreak = Enemy(30, armor: 10);
                Hit(weaponBreak, 1000);
                var deep = Enemy(40, armor: 10);
                ReactionHit(deep, Reaction.Meltdown, 1000, depth: 1);
                Step(0);
                Assert.AreEqual(2, shards.Count, "没破甲 / 不是熔金 / 深度 2 的熔金都不触发");
            }
            finally
            {
                GameEvents.EnemyDamaged -= listen;
            }
        }

        // ───────────── 锁灵 ─────────────

        [Test]
        public void VsLockMarksVeinsealedEnemiesForElementalDamageOnly()
        {
            Gain("rx_vs_lock", 3);
            var e = Enemy();
            var other = Enemy(2);
            Reacted(Reaction.Veinseal, 1, e);
            Close(136, Hit(e, element: Element.Corrode).total);
            Close(100, Hit(e).total, "无属性不吃");
            Close(136, ReactionHit(e, Reaction.Meltdown, element: Element.Corrode).total, "反应伤害带元素也吃");
            Close(100, Hit(other, element: Element.Corrode).total, "按敌人分开");
            Reacted(Reaction.Thunderfire, 0, other);
            Close(100, Hit(other, element: Element.Corrode).total, "只认封脉");
            Step(4);
            Close(100, Hit(e, element: Element.Corrode).total, "4 秒到期");
        }

        // ───────────── 三才印 ─────────────

        [Test]
        public void AbMarkCompletesTheMissingThirdElementOnTwoStatusEnemies()
        {
            Gain("rx_ab_mark", 3);
            var e = Enemy();
            host.Give(e, Element.Fire, Element.Shock);
            Hit(e);
            Assert.AreEqual(1, host.applied.Count);
            Assert.AreEqual(Element.Corrode, host.applied[0].e);
            Assert.AreEqual(0, host.applied[0].opts.depth);
            Assert.AreEqual(a.uid, host.applied[0].opts.weaponUid);
            AssertChances(0.36f);
            Hit(e);
            Assert.AreEqual(1, host.applied.Count, "0.1 s 内置冷却");
            Step(0.1f);
            var one = Enemy(2);
            host.Give(one, Element.Fire);
            var three = Enemy(3);
            host.Give(three, Element.Fire, Element.Shock, Element.Corrode);
            Hit(one);
            Hit(three);
            Assert.AreEqual(1, host.applied.Count, "恰好两种才补");
            var sc = Enemy(4);
            host.Give(sc, Element.Shock, Element.Corrode);
            Hit(sc, depth: 1);
            Assert.AreEqual(1, host.applied.Count, "衍生命中不算");
            Hit(sc);
            Assert.AreEqual(2, host.applied.Count);
            Assert.AreEqual(Element.Fire, host.applied[1].e);
        }

        // ───────────── 英雄专属 ─────────────

        static void SkillAttach(Damageable e, Element applied, float dealt = 125, int depth = 0, DamageSource source = DamageSource.Skill, bool killed = false)
        {
            var info = DamageInfo.Simple(dealt, source, ScrollKit.BodyCenter(e), Vector3.forward);
            info.depth = depth;
            info.element = applied;
            var hit = new HitEvent { enemy = e, info = info, result = new DamageResult { total = dealt, statusApplied = applied, killed = killed } };
            GameEvents.RaiseEnemyDamaged(in hit);
        }

        [Test]
        public void FoxThunderfireAddsShockWhenSkillsAttachBurn()
        {
            Gain("fox_thunderfire", 2);
            var e = Enemy();
            SkillAttach(e, Element.Shock);
            SkillAttach(e, Element.Fire, source: DamageSource.Weapon);
            SkillAttach(e, Element.Fire, killed: true);
            Assert.AreEqual(0, host.applied.Count, "只认技能附上灼烧、没打死");
            SkillAttach(e, Element.Fire);
            Assert.AreEqual(1, host.applied.Count);
            Assert.AreEqual(Element.Shock, host.applied[0].e);
            Close(125, host.applied[0].power);
            Assert.AreEqual(0, host.applied[0].opts.depth);
            AssertChances(0.6f); // 每层 30%
            SkillAttach(e, Element.Fire);
            Assert.AreEqual(1, host.applied.Count, "逐敌 0.3 s 冷却");
            Step(0.3f);
            SkillAttach(e, Element.Fire, depth: 1);
            Assert.AreEqual(2, host.applied.Count);
            Assert.AreEqual(1, host.applied[1].opts.depth, "沿用技能命中的深度");
            Close(120, ReactionHit(e, Reaction.Thunderfire).total, "焚雷每层 +10%");
        }

        [Test]
        public void FalconVeinsealNeedsTheShockToStillBeThere()
        {
            Gain("falcon_veinseal");
            var e = Enemy();
            SkillAttach(e, Element.Shock);
            Assert.AreEqual(0, host.applied.Count, "雷殛叠满自删（身上已经没有）时不触发");
            host.Give(e, Element.Shock);
            SkillAttach(e, Element.Shock);
            Assert.AreEqual(1, host.applied.Count);
            Assert.AreEqual(Element.Corrode, host.applied[0].e);
            AssertChances(0.3f);
            Close(110, ReactionHit(e, Reaction.Veinseal).total);
        }

        [Test]
        public void BearMagmaCoatsOneGroundSlamWindowWithBurnAndCorrode()
        {
            Gain("bear_magma");
            var e1 = Enemy();
            var e2 = Enemy(2);
            Hit(e1, source: DamageSource.Skill);
            Assert.AreEqual(0, host.applied.Count, "没放 E");
            Use(SkillSlot.Primary);
            Hit(e1, source: DamageSource.Skill);
            Assert.AreEqual(0, host.applied.Count, "Q 不算");
            Use(SkillSlot.Secondary);
            Hit(e1, source: DamageSource.Skill, element: Element.Fire);
            Hit(e1);
            Assert.AreEqual(0, host.applied.Count, "只认无属性的技能命中");
            Step(1.5f);
            Hit(e1, source: DamageSource.Skill);
            Hit(e2, source: DamageSource.Skill);
            Assert.AreEqual(4, host.applied.Count, "同一次砸地的全部命中");
            Assert.AreEqual(Element.Fire, host.applied[0].e);
            Assert.AreEqual(Element.Corrode, host.applied[1].e);
            Close(40, host.applied[0].power, "该次伤害的 40%");
            Assert.AreEqual(0, host.applied[0].opts.depth);
            Step(0.06f);
            Hit(e1, source: DamageSource.Skill);
            Step(0.01f);
            Hit(e1, source: DamageSource.Skill);
            Assert.AreEqual(4, host.applied.Count, "窗口过后解除");
            Use(SkillSlot.Secondary);
            Step(2.2f);
            Hit(e1, source: DamageSource.Skill);
            Assert.AreEqual(4, host.applied.Count, "2.2 秒没砸到就作废");
            Close(110, ReactionHit(e1, Reaction.Meltdown).total);
        }

        // ───────────── 焚天雷狱 ─────────────

        [Test]
        public void TfCapstoneShocksEnemiesAroundADirectThunderfire()
        {
            Gain("rx_tf_capstone", 2);
            var center = Enemy(0);
            var near = Enemy(2);
            var far = Enemy(5);
            var p = ScrollKit.BodyCenter(center);
            Reacted(Reaction.Thunderfire, 0, center, p, 100);
            Assert.AreEqual(1, host.applied.Count, "3 米内、不含中心");
            Assert.AreEqual(near, host.applied[0].d);
            Assert.AreEqual(Element.Shock, host.applied[0].e);
            Close(30, host.applied[0].power, "0.3B");
            Assert.AreEqual(1, host.applied[0].opts.depth);
            Reacted(Reaction.Thunderfire, 1, center, p, 100);
            Reacted(Reaction.Meltdown, 0, center, p, 100);
            Assert.AreEqual(1, host.applied.Count, "只认直接焚雷");
            sheet.Add("test", Stat.ExplosionRadiusPct, 1);
            Reacted(Reaction.Thunderfire, 0, center, p, 100);
            Assert.AreEqual(3, host.applied.Count, "范围吃爆炸范围");
            Assert.IsTrue(host.applied.Any(x => x.d == far));
            Close(140, ReactionHit(center, Reaction.Thunderfire).total, "焚雷每层 +20%");
        }

        // ───────────── 金乌坠 ─────────────

        [Test]
        public void MgCapstoneCollapsesMeltdownPoolsAfterADelay()
        {
            Gain("rx_mg_capstone", 2);
            host.explodeDamages = false;
            var p = new Vector3(0, 1, 0);
            Reacted(Reaction.Meltdown, 0, null, p, 100);
            Step(1.4f);
            Assert.AreEqual(0, host.explosions.Count);
            Step(0.2f);
            Assert.AreEqual(1, host.explosions.Count);
            var o = host.explosions[0];
            Assert.AreEqual(p, o.center);
            Close(3.5f, o.radius);
            Close(120, o.info.amount, "B × 每层 60%");
            Assert.AreEqual(Element.Fire, o.info.element);
            Assert.AreEqual(1, o.info.depth);
            Assert.AreEqual(DamageSource.Scroll, o.info.source);
            Assert.IsTrue(o.info.noCrit && o.info.Has(DamageTag.Proc));
            Reacted(Reaction.Meltdown, 1, null, p, 100);
            Step(2);
            Assert.AreEqual(1, host.explosions.Count, "只认直接熔金");
            Reacted(Reaction.Meltdown, 0, null, p, 100);
            StageLoaded();
            Step(2);
            Assert.AreEqual(1, host.explosions.Count, "换关取消还没坍缩的熔池");

            var bare = Enemy(20);
            var armored = Enemy(30, armor: 100000);
            Close(150, ReactionHit(bare, Reaction.Meltdown).total, "无护甲敌人每层 +25%");
            Close(75, ReactionHit(armored, Reaction.Meltdown).total, "有护甲不吃（无属性打护甲 75%）");
            Close(100, ReactionHit(bare, Reaction.Thunderfire).total);
        }

        // ───────────── 镇岳 ─────────────

        [Test]
        public void VsCapstoneExtendsStunMarksBossesAndArcsToVisibleEnemies()
        {
            Gain("rx_vs_capstone", 2);
            var center = Enemy(0);
            var n1 = Enemy(2);
            var n2 = Enemy(3);
            var walled = Enemy(4);
            host.walled.Add(walled);
            var far = Enemy(20);
            var p = ScrollKit.BodyCenter(center);
            Reacted(Reaction.Veinseal, 0, center, p, 100, stunned: true);
            Assert.AreEqual(1, host.stuns.Count);
            Assert.AreEqual(center, host.stuns[0].d);
            Close(1.5f, host.stuns[0].seconds, "0.7 + 每层 0.4");
            Close(9970, n1.health, "0.3B 雷伤");
            Close(9970, n2.health);
            Close(10000, walled.health, "要有视线");
            Close(10000, far.health, "8 米外");
            Close(10000, center.health);
            Assert.AreEqual(2, host.applied.Count, "每层一道电弧");
            Assert.IsTrue(host.applied.All(x => x.e == Element.Corrode && x.opts.depth == 1));
            Close(35, host.applied[0].power, "附蚀 0.35B");

            Reacted(Reaction.Veinseal, 0, center, p, 100);
            Assert.AreEqual(1, host.stuns.Count, "没眩晕就不延长");
            Reacted(Reaction.Veinseal, 1, center, p, 100, stunned: true);
            Assert.AreEqual(1, host.stuns.Count, "只认直接封脉");

            var boss = Enemy(100, rank: Rank.Boss);
            Reacted(Reaction.Veinseal, 0, boss, ScrollKit.BodyCenter(boss), 100, stunned: true);
            Assert.AreEqual(1, host.stuns.Count, "首领不眩晕");
            Close(116, Hit(boss).total, "首领 6 秒内受伤每层 +8%");
            Close(100, Hit(center).total);
            Step(6);
            Close(100, Hit(boss).total);
        }

        // ───────────── 归真 ─────────────

        [Test]
        public void AbAmpSpreadsTwoElementsToTheTwoNearestOnAbyssKills()
        {
            Gain("rx_ab_amp", 2);
            var victim = Enemy(0, maxHp: 50);
            var n1 = Enemy(2);
            var n2 = Enemy(3);
            var n3 = Enemy(6);
            Enemy(20);
            Assert.IsTrue(ReactionHit(victim, Reaction.Abyss, 500).killed);
            Reacted(Reaction.Abyss, 0, victim, ScrollKit.BodyCenter(victim), 200);
            Assert.AreEqual(0, host.applied.Count, "推迟到任务阶段（归墟事件晚于击杀）");
            Step(0);
            Assert.AreEqual(4, host.applied.Count);
            Assert.AreEqual(2, host.applied.Count(x => x.d == n1));
            Assert.AreEqual(2, host.applied.Count(x => x.d == n2));
            Assert.AreEqual(0, host.applied.Count(x => x.d == n3), "只给最近的 2 名");
            Assert.AreNotEqual(host.applied[0].e, host.applied[1].e, "两种不同的元素");
            Close(60, host.applied[0].power, "B × 每层 15%");
            Assert.AreEqual(1, host.applied[0].opts.depth, "沿用击杀那一击的深度");

            inv.Remove("rx_ab_amp");
            Gain("rx_ab_amp", 2);
            host.applied.Clear();
            var v2 = Enemy(1, maxHp: 50);
            ReactionHit(v2, Reaction.Abyss, 500);
            Step(0);
            Assert.AreEqual(4, host.applied.Count);
            Close(450, host.applied[0].power, "没有归墟事件时按那一击 × 3");

            host.applied.Clear();
            var v3 = Enemy(1.5f, maxHp: 50);
            ReactionHit(v3, Reaction.Meltdown, 500);
            var v4 = Enemy(2.5f, maxHp: 50);
            ReactionHit(v4, Reaction.Abyss, 500, depth: 1);
            Step(0);
            Assert.AreEqual(0, host.applied.Count, "不是归墟 / 深度 2 的归墟不触发");
            Close(160, ReactionHit(n1, Reaction.Abyss).total, "归墟每层 +30%");
        }

        // ───────────── 混元 / 劫火 ─────────────

        [Test]
        public void HunyuanTradesShieldAndIncomingDamageForReactions()
        {
            Gain("rx_hunyuan");
            Close(0.6f, sheet.Get(Stat.ReactionDamagePct));
            Close(0.4f, sheet.Get(Stat.ReactionHaste));
            Close(20, sheet.Get(Stat.MaxShield));
            DamagePlayer(10);
            Close(37.5f, hp, "受到的伤害 +25%");
            Assert.AreEqual(3, Def("rx_hunyuan").PreviewStats(1).Count);
        }

        [Test]
        public void KalpaCallsDownAnAbyssEveryTenNaturalReactions()
        {
            Gain("rx_kalpa");
            Close(-0.08f, sheet.Get(Stat.ElementChancePct));
            var e = Enemy();
            host.aim = e;
            for (int i = 0; i < 9; i++) Reacted(Reaction.Thunderfire, i % 2);
            Reacted(Reaction.Abyss, origin: ReactionOrigin.Forced);
            Assert.AreEqual(0, host.triggers.Count, "强制反应不计数");
            Reacted(Reaction.Meltdown, origin: ReactionOrigin.Detonate);
            Assert.AreEqual(1, host.triggers.Count);
            var (d, id, o) = host.triggers[0];
            Assert.AreEqual(e, d);
            Assert.AreEqual(Reaction.Abyss, id);
            Close(100, o.power, "100 × 强度成长");
            Assert.IsTrue(o.ignoreIcd);
            Assert.AreEqual(0, o.depth);
            Assert.AreEqual(DamageTag.Kalpa, o.tag);

            host.aim = null;
            for (int i = 0; i < 10; i++) Reacted(Reaction.Veinseal);
            Assert.AreEqual(1, host.triggers.Count, "没有目标：保留计数");
            host.aim = e;
            Reacted(Reaction.Veinseal);
            Assert.AreEqual(2, host.triggers.Count, "下次反应再降");

            host.triggerAccepts = false;
            for (int i = 0; i < 10; i++) Reacted(Reaction.Veinseal);
            Assert.AreEqual(3, host.triggers.Count);
            host.triggerAccepts = true;
            Reacted(Reaction.Veinseal);
            Assert.AreEqual(4, host.triggers.Count, "被预算拒绝：保留计数");
            for (int i = 0; i < 9; i++) Reacted(Reaction.Veinseal);
            Assert.AreEqual(4, host.triggers.Count, "成功后计数清零");

            host.alive = false;
            Reacted(Reaction.Veinseal);
            Assert.AreEqual(4, host.triggers.Count, "阵亡不降");
            host.alive = true;
            Reacted(Reaction.Veinseal);
            Assert.AreEqual(5, host.triggers.Count);
        }
    }
}
