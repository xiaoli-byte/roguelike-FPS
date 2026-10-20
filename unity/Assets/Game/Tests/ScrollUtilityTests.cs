using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Spiritfire.Art;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 功能类秘卷（S3 技能与生存 / S3b 机动与经济）：数值与 Three.js 版 src/progression/scrolls/defsUtility.ts 一致，每个钩子至少一条
    /// （仿 tests/scroll-tactics.test.mjs：真的走 PlayerVitals.TakeDamage / Combat.DamageEnemy / GameEvents，聚宝盆逐条移植 TS 用例）。
    /// EditMode：<see cref="ScrollTicker"/> 手动时钟；玩家是手动调过 Awake 的 PlayerVitals（不进场景流程），放在远离场景的地方。
    /// 测试台 <see cref="Rig"/> 也给 <see cref="ScrollLegendTests"/> 用。
    /// </summary>
    public sealed class ScrollUtilityTests
    {
        const float Eps = 1e-4f;
        Rig rig;

        [SetUp]
        public void SetUp() => rig = new Rig();

        [TearDown]
        public void TearDown() => rig.Dispose();

        // ───────────── 测试台 ─────────────

        /// <summary>只实现「放出去」的测试技能（冷却 10 s、1 层充能、开局没充好）</summary>
        public sealed class DummySkill : Skill
        {
            public override bool Activate() => true;
        }

        /// <summary>
        /// 秘卷测试台：独立的持有表、按需建的玩家（PlayerVitals + PlayerMotor + HeroSkills，手动调 Awake：上限同步、Combat.playerStats、运动组件都接上）、
        /// 测试敌人、触发记录（GameEvents.ScrollProc）。Dispose 时清空持有表、销毁物体、还原静态状态（属性表、当前局、秘卷时钟、PlayerVitals.Instance）。
        /// </summary>
        public sealed class Rig : IDisposable
        {
            public static readonly Vector3 Far = new(-7000, 900, 7000);

            public readonly ScrollInventory inv = new();
            public readonly List<string> procs = new();
            readonly List<GameObject> made = new();
            readonly Action<string> onProc;
            readonly StatSheet savedStats;
            readonly RunState savedRun;
            PlayerVitals player;

            public PlayerMotor motor;
            public HeroSkills hero;

            public Rig()
            {
                savedStats = Combat.playerStats;
                savedRun = RunState.Current;
                RunState.Current = null;
                ScrollTicker.ResetForTests();
                onProc = id => procs.Add(id);
                GameEvents.ScrollProc += onProc;
            }

            /// <summary>玩家（第一次访问时建）：基础属性（100 生命 / 50 护盾 / 移速 7.5），站在地上，技能槽是两个冷却中的测试技能</summary>
            public PlayerVitals Player
            {
                get
                {
                    if (!player) MakePlayer();
                    return player;
                }
            }

            public StatSheet Sheet => Player.stats;

            void MakePlayer()
            {
                var go = new GameObject("test player") { layer = Layers.Character };
                go.transform.position = Far;
                made.Add(go);
                player = go.AddComponent<PlayerVitals>();
                player.stats = StatSheet.Default();
                // EditMode 不跑 Awake：手动调一次（同步当前生命 / 护盾、登记 Combat.playerStats、接上运动组件）
                typeof(PlayerVitals).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(player, null);
                motor = go.GetComponent<PlayerMotor>();
                motor.Core.touching = motor.Core.grounded = true;
                hero = go.AddComponent<HeroSkills>();
                hero.primary = new DummySkill { id = "test_q", cooldown = 10, maxCharges = 1 };
                hero.secondary = new DummySkill { id = "test_e", cooldown = 10, maxCharges = 1 };
                Physics.SyncTransforms();
            }

            public static ScrollDef Def(string id)
            {
                var d = ScrollLibrary.Get(id);
                Assert.IsNotNull(d, $"秘卷 {id} 没有登记");
                return d;
            }

            /// <summary>给玩家加 times 层</summary>
            public ScrollDef Gain(string id, int times = 1)
            {
                var d = Def(id);
                for (int i = 0; i < times; i++) Assert.IsTrue(inv.Gain(d, Player), $"{id} 第 {i + 1} 层");
                return d;
            }

            public int Procs(string id) => procs.Count(p => p == id);

            /// <summary>测试敌人：offset 相对玩家；body = 带一个身体胶囊（0–2 m，半径 0.4，爆炸查询用）</summary>
            public Damageable Enemy(Rank rank = Rank.Normal, float hp = 10000, Vector3? offset = null, bool body = false)
            {
                var go = new GameObject("test enemy");
                made.Add(go);
                go.transform.position = Far + (offset ?? new Vector3(0, 0, 8));
                if (body)
                {
                    var c = go.AddComponent<CapsuleCollider>();
                    c.center = Vector3.up;
                    c.height = 2;
                    c.radius = 0.4f;
                }
                var d = go.AddComponent<Damageable>();
                d.maxHealth = hp;
                d.rank = rank;
                d.ResetVitals();
                Physics.SyncTransforms();
                return d;
            }

            /// <summary>玩家受到 amount 伤害（走 PlayerVitals.TakeDamage：减伤、受伤修饰器、PlayerHit、破盾、死亡判定）；返回实际扣除量</summary>
            public float Hurt(float amount, Object source = null) =>
                Player.TakeDamage(amount, Player.transform.position + Vector3.forward * 3, Element.None, source);

            /// <summary>打一枪（不随机暴击；crit = 强制暴击）</summary>
            public static DamageResult Shoot(Damageable d, float amount, DamageSource source = DamageSource.Weapon, bool crit = false, int depth = 0)
            {
                var info = DamageInfo.Simple(amount, source, ScrollKit.BodyCenter(d), Vector3.forward);
                info.noCrit = true;
                info.forceCrit = crit;
                info.depth = depth;
                return Combat.DamageEnemy(d, info);
            }

            /// <summary>派发一次击杀事件（不经过伤害管线）</summary>
            public static void Kill(Damageable d, bool purge = false)
            {
                var info = DamageInfo.Simple(10, DamageSource.Weapon, ScrollKit.BodyCenter(d), Vector3.forward);
                if (purge) info.tags |= DamageTag.Purge;
                var k = new KillEvent { enemy = d, info = info, result = new DamageResult { killed = true, total = 10 } };
                GameEvents.RaiseEnemyKilled(in k);
            }

            public static void Step(float seconds) => ScrollTicker.Step(seconds);

            public void Dispose()
            {
                GameEvents.ScrollProc -= onProc;
                inv.Clear();
                ProjectilePools.Clear();
                foreach (var go in made)
                    if (go)
                        Object.DestroyImmediate(go);
                made.Clear();
                if (PlayerVitals.Instance == player || !PlayerVitals.Instance)
                    typeof(PlayerVitals).GetProperty(nameof(PlayerVitals.Instance)).GetSetMethod(true).Invoke(null, new object[] { null });
                Combat.playerStats = savedStats;
                RunState.Current = savedRun;
                ScrollTicker.ResetForTests();
            }
        }

        // ───────────── 登记与数值 ─────────────

        /// <summary>TS defsUtility.ts 的 30 卷：(id, 名字, 稀有度, 层数上限, 主标签)</summary>
        static readonly (string id, string name, int rarity, int max, string tag)[] TsUtility =
        {
            ("spirit_spring", "灵泉", 0, 5, "技能"), ("arcane_surge", "法力涌动", 1, 4, "技能"), ("extra_charge", "多重储备", 3, 1, "技能"),
            ("skill_echo", "回响", 1, 3, "技能"), ("soul_reap", "夺魂", 2, 3, "技能"),
            ("iron_bones", "铁骨", 0, 5, "生存"), ("spirit_ward", "灵盾", 0, 5, "护盾"), ("quick_recovery", "回春", 1, 3, "护盾"),
            ("blood_drinker", "噬血", 2, 3, "生存"), ("harvest", "收割", 1, 4, "击杀"), ("soul_siphon", "摄魂", 1, 4, "击杀"),
            ("stone_skin", "石肤", 1, 3, "生存"), ("regen", "生生不息", 1, 3, "生存"), ("last_stand", "背水一战", 2, 2, "生存"),
            ("shield_nova", "碎盾反击", 2, 3, "护盾"), ("thorns", "以牙还牙", 1, 3, "生存"), ("pain_to_power", "化痛为力", 1, 3, "伤害"),
            ("second_wind", "绝处逢生", 3, 1, "生存"), ("phoenix_feather", "凤羽", 3, 2, "护盾"),
            ("wind_walker", "踏风", 0, 3, "机动"), ("cloud_step", "凌云", 2, 1, "机动"), ("streamer", "流光", 2, 1, "机动"),
            ("phantom_step", "幻影步", 1, 3, "机动"), ("high_ground", "居高临下", 1, 3, "机动"), ("war_drum", "战鼓", 3, 2, "射速"),
            ("golden_touch", "点金手", 0, 3, "经济"), ("spirit_lure", "灵引", 0, 2, "经济"), ("fortune_charm", "招财符", 1, 3, "经济"),
            ("bounty", "悬赏令", 1, 3, "经济"), ("treasure_bowl", "聚宝盆", 2, 2, "经济"),
        };

        /// <summary>本单元新加的 21 卷 + 传说 / 英雄专属 10 卷</summary>
        public static readonly string[] OwnIds =
        {
            "spirit_spring", "arcane_surge", "extra_charge", "skill_echo", "soul_reap", "blood_drinker", "regen", "last_stand", "shield_nova",
            "thorns", "pain_to_power", "second_wind", "phoenix_feather", "cloud_step", "phantom_step", "high_ground", "war_drum",
            "golden_touch", "fortune_charm", "bounty", "treasure_bowl",
            "glass_cannon", "berserk_blood", "gambler", "thousand_blades", "midas_heart", "blood_pact", "overdrive",
            "fox_resonance", "falcon_sky", "bear_mountain",
        };

        [Test]
        public void AllThirtyUtilityScrollsAreRegisteredWithTsNumbers()
        {
            foreach (var (id, name, rarity, max, tag) in TsUtility)
            {
                var d = Rig.Def(id);
                Assert.AreEqual(name, d.name, id);
                Assert.AreEqual(rarity, d.rarity, $"{id} 稀有度");
                Assert.AreEqual(max, d.maxStacks, $"{id} 层数上限");
                Assert.IsTrue(d.HasTag(tag), $"{id} 应带标签 {tag}");
                Assert.IsNull(d.heroOnly, id);
                StringAssert.DoesNotContain("{", d.Describe(d.maxStacks), $"{id} 描述占位没解析");
                StringAssert.DoesNotContain("金币", d.description, $"{id}：局内货币叫灵石（D13）");
            }
            var errors = ScrollLibrary.Validate(OwnIds.Select(Rig.Def), out _);
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void StatScrollsStackLikeTs()
        {
            var cases = new (string id, Stat stat, float per)[]
            {
                ("spirit_spring", Stat.SkillHaste, 0.08f), ("arcane_surge", Stat.SkillDamagePct, 0.15f), ("extra_charge", Stat.SecondaryCharges, 1f),
                ("blood_drinker", Stat.Lifesteal, 0.015f), ("regen", Stat.HpRegen, 1.5f), ("cloud_step", Stat.ExtraJumps, 1f),
                ("golden_touch", Stat.CoinGainPct, 0.15f), ("fortune_charm", Stat.Luck, 1f), ("phantom_step", Stat.DashCooldown, -0.2f),
            };
            foreach (var (id, stat, per) in cases)
            {
                var sheet = StatSheet.Default();
                var inv = new ScrollInventory();
                var d = Rig.Def(id);
                float baseValue = sheet.Get(stat);
                inv.Gain(d, sheet);
                Assert.AreEqual(baseValue + per, sheet.Get(stat), Eps, $"{id} 1 层");
                while (inv.Gain(d, sheet)) { }
                Assert.AreEqual(baseValue + per * d.maxStacks, sheet.Get(stat), Eps, $"{id} 满层");
                Assert.AreEqual(per * d.maxStacks, d.PreviewStats(d.maxStacks).First(x => x.stat == stat).value, Eps, $"{id} 预览");
                inv.Clear();
                Assert.AreEqual(baseValue, sheet.Get(stat), Eps, $"{id} 移除");
            }
        }

        [Test]
        public void CloudStepGivesTheMotorAnAirJump()
        {
            Assert.AreEqual(0, rig.Player.GetComponent<PlayerMotor>().airJumps);
            rig.Gain("cloud_step");
            Assert.AreEqual(1, rig.motor.airJumps, "ExtraJumps 经 PlayerVitals 映射到 airJumps（H1）");
            rig.Gain("phantom_step", 3);
            Assert.AreEqual(1.0f, rig.motor.dashCooldown, Eps, "冲刺冷却 1.6 − 0.6");
        }

        // ───────────── 技能 ─────────────

        [Test]
        public void SkillEchoBuffsWeaponDamageAfterAnySkill()
        {
            rig.Gain("skill_echo", 2);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamagePct), Eps);
            GameEvents.RaiseSkillUsed(SkillSlot.Secondary, "test_e");
            Assert.AreEqual(0.2f, rig.Sheet.Get(Stat.DamagePct), Eps, "每层 +10%");
            Assert.AreEqual(1, rig.Procs("skill_echo"));
            Rig.Step(4);
            GameEvents.RaiseSkillUsed(SkillSlot.Primary, "test_q");
            Assert.AreEqual(1, rig.Procs("skill_echo"), "刷新时长不再弹字");
            Rig.Step(4.9f);
            Assert.AreEqual(0.2f, rig.Sheet.Get(Stat.DamagePct), Eps, "第二次释放刷新到 5 秒，不叠数值");
            Rig.Step(0.2f);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamagePct), Eps, "到期撤掉");
        }

        [Test]
        public void SoulReapRefundsBothCooldownsAndQuadruplesOnEliteAndBoss()
        {
            rig.Gain("soul_reap");
            var q = rig.hero.primary;
            var e = rig.hero.secondary;
            Rig.Kill(rig.Enemy());
            Assert.AreEqual(0.3f, q.recharge, Eps);
            Assert.AreEqual(0.3f, e.recharge, Eps, "两个槽都回");
            Rig.Kill(rig.Enemy(Rank.Elite));
            Assert.AreEqual(1.5f, q.recharge, Eps, "精英 ×4");
            Rig.Kill(rig.Enemy(Rank.Boss));
            Assert.AreEqual(2.7f, q.recharge, Eps, "首领 ×4");
            Rig.Kill(rig.Enemy(), purge: true);
            Assert.AreEqual(2.7f, q.recharge, Eps, "静默处决不算");
            rig.Gain("soul_reap", 2);
            Rig.Kill(rig.Enemy());
            Assert.AreEqual(3.6f, q.recharge, Eps, "3 层 0.9 秒");
            Assert.AreEqual(0.9f, SoulReapScroll.Seconds(Rank.Normal, 3), Eps);
            Assert.AreEqual(3.6f, SoulReapScroll.Seconds(Rank.Elite, 3), Eps);
        }

        // ───────────── 生存 ─────────────

        [Test]
        public void LastStandReducesDamageOnlyBelowThirtyFivePercent()
        {
            rig.Gain("last_stand", 2);
            var p = rig.Player;
            p.shield = 0;
            p.health = 80;
            Assert.AreEqual(10, rig.Hurt(10), Eps, "血量高时不减");
            p.health = 30;
            Assert.AreEqual(7, rig.Hurt(10), Eps, "低于 35%：2 层 −30%");
            p.stats.Add("test", Stat.DamageReduction, 0.5f);
            Assert.AreEqual(3.5f, rig.Hurt(10), Eps, "与减伤相乘");
        }

        [Test]
        public void ShieldNovaBlastsNearbyEnemiesWhenTheShieldBreaksWithCooldown()
        {
            rig.Gain("shield_nova", 2);
            var enemy = rig.Enemy(offset: new Vector3(2, 0, 0), body: true);
            var hits = new List<HitEvent>();
            InAction<HitEvent> spy = (in HitEvent e) =>
            {
                if (e.info.procId == "shield_nova") hits.Add(e);
            };
            GameEvents.EnemyDamaged += spy;
            try
            {
                rig.Hurt(30);
                Assert.AreEqual(0, hits.Count, "护盾没破不触发");
                rig.Hurt(30);
                Assert.AreEqual(1, hits.Count, "护盾被打空时释放冲击波");
                var info = hits[0].info;
                Assert.AreEqual(DamageSource.Scroll, info.source);
                Assert.AreEqual(1, info.depth);
                Assert.IsTrue(info.Has(DamageTag.Proc) && info.Has(DamageTag.Explosion));
                Assert.IsTrue(info.noCrit);
                // 爆心离地 0.9 m，敌人胶囊表面在 1.6 m 外：中心 100% → 6 m 处 50%
                float k = Mathf.Lerp(1, 0.5f, 1.6f / 6f);
                Assert.AreEqual(140 * k, info.amount, 0.05f, "每层 70，按距离衰减");
                Assert.AreEqual(10000 - 140 * k, enemy.health, 0.05f);
                Assert.AreEqual(1, rig.Procs("shield_nova"));

                rig.Player.shield = 50;
                rig.Hurt(60);
                Assert.AreEqual(1, hits.Count, "冷却 5 秒内不再触发");
                Rig.Step(5.01f);
                rig.Player.shield = 50;
                rig.Hurt(60);
                Assert.AreEqual(2, hits.Count, "冷却结束再次触发");
            }
            finally
            {
                GameEvents.EnemyDamaged -= spy;
            }
        }

        [Test]
        public void ThornsHitsTheAttackerThrottledAndSkipsUntargetable()
        {
            rig.Gain("thorns", 3);
            var enemy = rig.Enemy();
            rig.Hurt(5, enemy);
            Assert.AreEqual(10000 - 75, enemy.health, Eps, "每层 25（难度 1）");
            rig.Hurt(5, enemy);
            Assert.AreEqual(10000 - 75, enemy.health, Eps, "0.4 秒内最多一次");
            Rig.Step(0.41f);
            rig.Hurt(5, enemy.gameObject);
            Assert.AreEqual(10000 - 150, enemy.health, Eps, "出手者给的是 GameObject 也认得出");
            Rig.Step(0.41f);
            enemy.untargetable = true;
            rig.Hurt(5, enemy);
            Assert.AreEqual(10000 - 150, enemy.health, Eps, "不可选中的不反击");
            enemy.untargetable = false;
            rig.Hurt(5, enemy);
            Assert.AreEqual(10000 - 225, enemy.health, Eps, "不可选中时不占冷却");
            Rig.Step(0.41f);
            rig.Hurt(5);
            Assert.AreEqual(10000 - 225, enemy.health, Eps, "没有出手者不反击");

            RunState.Current = new RunState { difficulty = 2.28f };
            Rig.Step(0.41f);
            rig.Hurt(5, enemy);
            Assert.AreEqual(10000 - 225 - 75 * ScrollKit.ProcScale(2.28f), enemy.health, 0.01f, "随关卡强度成长");
        }

        [Test]
        public void PainToPowerBuffsWeaponDamageAfterTakingDamage()
        {
            rig.Gain("pain_to_power", 3);
            rig.Hurt(5);
            Assert.AreEqual(0.3f, rig.Sheet.Get(Stat.DamagePct), Eps);
            Rig.Step(5.01f);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamagePct), Eps);
        }

        [Test]
        public void SecondWindPreventsOneLethalHitPerStage()
        {
            rig.Gain("second_wind");
            var p = rig.Player;
            p.shield = 0;
            p.health = 20;
            Assert.AreEqual(0, rig.Hurt(100), Eps, "致命伤被免除");
            Assert.IsFalse(p.Dead);
            Assert.AreEqual(55, p.health, Eps, "回复 35% 生命");
            Assert.AreEqual(2, rig.motor.InvulnerableTime, Eps, "2 秒无敌");
            Assert.AreEqual(1, rig.Procs("second_wind"));
            Assert.AreEqual(0, rig.Hurt(100), Eps, "无敌期间不受伤");

            rig.motor.ClearInvulnerability();
            rig.Hurt(1000);
            Assert.IsTrue(p.Dead, "本关已经用过");

            p.Revive();
            GameEvents.RaiseStageLoaded(null);
            p.shield = 0;
            p.health = 10;
            rig.Hurt(1000);
            Assert.IsFalse(p.Dead, "进新关重新可用");
            Assert.AreEqual(45, p.health, Eps);
            Assert.AreEqual(2, rig.Procs("second_wind"));
        }

        [Test]
        public void SecondWindFallbackRestoresWhenALaterModifierMakesTheHitLethal()
        {
            rig.Gain("second_wind");
            var p = rig.Player;
            p.shield = 0;
            p.health = 50;
            using (PlayerVitals.Incoming.Add((in IncomingHit h) => 100f, ModifierPriority.FinalAmount + 100))
                rig.Hurt(1);
            Assert.IsFalse(p.Dead, "PlayerHit 里把扣掉的生命还回去");
            Assert.AreEqual(85, p.health, Eps, "还回 50，再回复 35");
            Assert.AreEqual(1, rig.Procs("second_wind"));
        }

        [Test]
        public void PhoenixFeatherRefillsShieldAndBuffsReductionOnEliteAndBossKills()
        {
            rig.Gain("phoenix_feather", 2);
            var p = rig.Player;
            p.shield = 5;
            Rig.Kill(rig.Enemy());
            Assert.AreEqual(5, p.shield, Eps, "普通敌人不触发");
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamageReduction), Eps);
            Rig.Kill(rig.Enemy(Rank.Elite));
            Assert.AreEqual(50, p.shield, Eps, "回满护盾");
            Assert.AreEqual(0.2f, rig.Sheet.Get(Stat.DamageReduction), Eps, "每层 +10%");
            Rig.Step(6.01f);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamageReduction), Eps, "6 秒后撤掉");
            Rig.Kill(rig.Enemy(Rank.Boss), purge: true);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamageReduction), Eps, "静默处决不算");
        }

        // ───────────── 机动 ─────────────

        [Test]
        public void PhantomStepBuffsWeaponDamageAfterADash()
        {
            rig.Gain("phantom_step", 3);
            GameEvents.RaisePlayerDashed(Vector3.forward);
            Assert.AreEqual(0.24f, rig.Sheet.Get(Stat.DamagePct), Eps, "每层 +8%");
            Rig.Step(2.01f);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.DamagePct), Eps);
        }

        [Test]
        public void HighGroundBoostsAllDamageOnlyWhileAirborne()
        {
            rig.Gain("high_ground", 2);
            var enemy = rig.Enemy();
            Assert.AreEqual(100, Rig.Shoot(enemy, 100).total, Eps, "站在地上不加");
            rig.motor.Core.touching = false;
            Assert.AreEqual(120, Rig.Shoot(enemy, 100).total, Eps, "滞空 2 层 +20%");
            Assert.AreEqual(120, Rig.Shoot(enemy, 100, DamageSource.Skill).total, Eps, "技能伤害同样吃（同 TS）");
        }

        [Test]
        public void WarDrumBuffsFireRateAndSpeedWhenAnEncounterStarts()
        {
            rig.Gain("war_drum", 2);
            GameEvents.RaiseEncounterStarted(null);
            Assert.AreEqual(0.3f, rig.Sheet.Get(Stat.FireRatePct), Eps);
            Assert.AreEqual(8.5f, rig.Sheet.Get(Stat.MoveSpeed), Eps);
            Assert.AreEqual(8.5f, rig.motor.walkSpeed, Eps, "移速经 PlayerVitals 同步到运动组件");
            Rig.Step(8.01f);
            Assert.AreEqual(0, rig.Sheet.Get(Stat.FireRatePct), Eps);
            Assert.AreEqual(7.5f, rig.Sheet.Get(Stat.MoveSpeed), Eps);
        }

        // ───────────── 经济 ─────────────

        [Test]
        public void BountyDropsBonusCoinsOnEliteAndBossKillsOnly()
        {
            Assert.AreEqual(0, BountyScroll.Payout(Rank.Normal, 3));
            Assert.AreEqual(36, BountyScroll.Payout(Rank.Elite, 3));
            Assert.AreEqual(180, BountyScroll.Payout(Rank.Boss, 3));
            // EditMode 没有掉落物：额外灵石直接入账（等于马上捡起，照常乘灵石获取）
            var run = RunState.Current = new RunState();
            rig.Gain("bounty", 2);
            Rig.Kill(rig.Enemy());
            Assert.AreEqual(0, run.coins, "普通敌人不给");
            Rig.Kill(rig.Enemy(Rank.Elite));
            Assert.AreEqual(24, run.coins, "精英每层 12");
            Rig.Step(0.2f);
            Rig.Kill(rig.Enemy(Rank.Boss));
            Assert.AreEqual(24 + 120, run.coins, "首领每层 60");
            var clone = rig.Enemy(Rank.Elite);
            clone.noReward = true;
            Rig.Kill(clone);
            Rig.Kill(rig.Enemy(Rank.Elite), purge: true);
            Assert.AreEqual(144, run.coins, "不给奖励的死亡、静默处决都不算");
            Assert.AreEqual(2, rig.Procs("bounty"));
            rig.Gain("golden_touch");
            Rig.Kill(rig.Enemy(Rank.Elite));
            Assert.AreEqual(144 + Mathf.FloorToInt(24 * 1.15f + 1e-4f), run.coins, "捡起时乘灵石获取");
        }

        [Test]
        public void TreasureBowlPaysPrincipalAtZeroCoinsAndScalesBothLayersCapsAndChapters()
        {
            // 同 tests/scroll-tactics.test.mjs 的 treasure bowl 用例（TS 章从 0 起 → 这里 +1）
            var run = RunState.Current = new RunState { coins = 0 };
            var changes = new List<(int delta, int total)>();
            Action<int, int> spy = (d, t) => changes.Add((d, t));
            GameEvents.CoinsChanged += spy;
            void Enter(int chapter) => GameEvents.RaiseStageLoaded(new StageSpec(0, chapter, 0, "测试", "测试", "", StageKind.Field, "calm", null));
            try
            {
                rig.Gain("treasure_bowl");
                Assert.AreEqual(0, run.coins, "获得时不给");
                Enter(1);
                Assert.AreEqual(12, run.coins);
                Assert.AreEqual((12, 12), changes.Last());
                run.coins = 200;
                Enter(1);
                Assert.AreEqual(22, changes.Last().delta, "本金 12 + 利息 10");
                rig.Gain("treasure_bowl");
                Assert.AreEqual(222, run.coins, "叠层时不给");
                run.coins = 200;
                Enter(1);
                Assert.AreEqual(44, changes.Last().delta, "2 层：本金 24 + 利息 20");
                run.coins = 10000;
                Enter(1);
                Assert.AreEqual(84, changes.Last().delta, "利息上限 60");
                run.coins = 10000;
                Enter(3);
                Assert.AreEqual(143, changes.Last().delta, "第三章 ×1.7：本金 41 + 上限 102");
                rig.Player.health = 1;
                rig.Player.shield = 0;
                rig.Hurt(1000);
                Assert.IsTrue(rig.Player.Dead);
                int coins = run.coins;
                Enter(3);
                Assert.AreEqual(coins, run.coins, "阵亡时不给");
                rig.Player.Revive();
                rig.inv.Clear();
                Enter(3);
                Assert.AreEqual(coins, run.coins, "移除后不给");
            }
            finally
            {
                GameEvents.CoinsChanged -= spy;
            }
            Assert.AreEqual((12, 0), TreasureBowlScroll.Payout(0, 1, 1));
            Assert.AreEqual((41, 102), TreasureBowlScroll.Payout(10000, 2, 3));
        }

        // ───────────── 装卸 ─────────────

        [Test]
        public void EveryOwnScrollInstallsAndUninstallsCleanlyWithAndWithoutAPlayer()
        {
            int out0 = Combat.Outgoing.Count, in0 = PlayerVitals.Incoming.Count, tasks0 = ScrollTicker.TaskCount;
            var bare = new ScrollInventory();
            foreach (var id in OwnIds)
            {
                var d = Rig.Def(id);
                for (int i = 0; i < d.maxStacks; i++)
                {
                    Assert.IsTrue(rig.inv.Gain(d, rig.Player), $"{id} 第 {i + 1} 层（有玩家）");
                    Assert.IsTrue(bare.Gain(d, (StatSheet)null), $"{id} 第 {i + 1} 层（没有玩家）");
                }
            }
            // 没有玩家的作用域也照常收发事件，不抛异常
            GameEvents.RaiseSkillUsed(SkillSlot.Secondary, "test_e");
            GameEvents.RaisePlayerDashed(Vector3.forward);
            GameEvents.RaiseEncounterStarted(null);
            GameEvents.RaisePlayerShieldBroken();
            var hit = new PlayerHitEvent { amount = 5, toHp = 5 };
            GameEvents.RaisePlayerHit(in hit);
            Rig.Kill(rig.Enemy(Rank.Elite));
            Rig.Shoot(rig.Enemy(), 10);
            Rig.Step(0.5f);
            bare.Clear();
            rig.inv.Clear();
            Assert.AreEqual(out0, Combat.Outgoing.Count, "输出修饰器全部撤掉");
            Assert.AreEqual(in0, PlayerVitals.Incoming.Count, "受伤修饰器全部撤掉");
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount, "任务全部撤掉");
            var fresh = StatSheet.Default();
            foreach (Stat s in Enum.GetValues(typeof(Stat)))
                Assert.AreEqual(fresh.Get(s), rig.Sheet.Get(s), Eps, $"属性 {s} 没还原");
        }
    }
}
