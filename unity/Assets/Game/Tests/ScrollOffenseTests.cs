using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 攻击类秘卷（S1，Three.js 版 src/progression/scrolls/defsOffense.ts）：24 卷的数据与 TS 一致；每个钩子至少一条行为测试
    /// （写法参照 tests/scroll-tactics.test.mjs：真实 Combat 结算 + 手动推进的秘卷时钟 + 直接派发的事件）。
    /// EditMode：敌人是带胶囊碰撞体 + 命中盒的 Damageable（不跑 Awake，手动 ResetVitals），放在远离场景的 <see cref="Far"/>；
    /// 属性表的暴击率基础值清零（没有随机暴击），概率 / 弹匣走 <see cref="OffenseKit"/> 的测试钩子。
    /// 会附着元素状态的秘卷伤害（天雷引）用承伤修饰器「探针」记录请求并把伤害吃掉：EditMode 下挂状态会建光晕物体（只能在 Play 模式销毁）。
    /// </summary>
    public sealed class ScrollOffenseTests
    {
        const float Eps = 1e-3f;
        static readonly Vector3 Far = new(7000, -4000, 7000);

        StatSheet savedStats, sheet;
        RunState savedRun;
        ScrollInventory inv;
        readonly List<GameObject> made = new();

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

        /// <summary>一个测试敌人：脚下在 Far + at，身体胶囊（0–2 m，半径 radius），身体中心 = Far + at + 1 m</summary>
        Damageable Enemy(Vector3 at, float maxHp = 1e6f, Rank rank = Rank.Normal, float radius = 0.4f)
        {
            var go = new GameObject("ScrollOffenseTests Enemy");
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
            return d;
        }

        /// <summary>测试玩家（角色层：不挡爆炸的视线检查），脚下在 Far + at</summary>
        PlayerVitals Player(Vector3 at)
        {
            var go = new GameObject("ScrollOffenseTests Player");
            made.Add(go);
            go.layer = Layers.Character;
            go.transform.position = Far + at;
            var pv = go.AddComponent<PlayerVitals>();
            pv.stats = sheet;
            Physics.SyncTransforms();
            return pv;
        }

        ScrollDef Def(string id)
        {
            var d = ScrollLibrary.Get(id);
            Assert.IsNotNull(d, $"秘卷 {id} 没有登记");
            return d;
        }

        void Give(string id, int n, PlayerVitals pv = null)
        {
            var d = Def(id);
            for (int i = 0; i < n; i++) Assert.IsTrue(inv.Gain(d, sheet, pv), $"{id} 第 {i + 1} 层");
        }

        static DamageInfo Weapon(Damageable d, float amount = 100, bool crit = false, bool weak = false, DamageSource source = DamageSource.Weapon)
        {
            var i = DamageInfo.Simple(amount, source, ScrollKit.BodyCenter(d), Vector3.forward);
            i.noCrit = !crit;
            i.forceCrit = crit;
            i.weakpoint = weak;
            return i;
        }

        static float Hit(Damageable d, float amount = 100, bool crit = false, bool weak = false, DamageSource source = DamageSource.Weapon) =>
            Combat.DamageEnemy(d, Weapon(d, amount, crit, weak, source)).total;

        /// <summary>记录打到 d 身上的秘卷衍生伤害（Proc 标签）：探针返回 1 放行（swallow = true 时吃掉，不附着元素）</summary>
        static List<IncomingHit> Probe(Damageable d, bool swallow = false)
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

        /// <summary>id, 名字, 稀有度, 层数上限（TS defsOffense.ts 的顺序）</summary>
        static readonly (string id, string name, int rarity, int max)[] Table =
        {
            ("keen_blade", "利刃", 0, 5), ("giant_slayer", "屠巨", 1, 3), ("shield_breaker", "破盾", 0, 3), ("armor_piercer", "穿甲", 0, 3),
            ("first_blood", "先声夺人", 1, 3), ("executioner", "断命", 2, 3), ("close_combat", "近身搏杀", 0, 3), ("sharpshooter", "百步穿杨", 1, 3),
            ("hawk_eye", "鹰目", 0, 5), ("fatal_art", "致命诀", 1, 4), ("headsman", "断首", 2, 3), ("crit_streak", "连击心法", 2, 3),
            ("rapid_fire", "骤雨", 1, 4), ("swift_hands", "疾手", 0, 5), ("bottomless", "百宝囊", 0, 3), ("steady", "稳如磐石", 0, 3),
            ("meteor_shot", "流星", 0, 3), ("last_rounds", "背水弹匣", 1, 3), ("reload_rush", "装填激励", 1, 3), ("reload_nova", "换弹冲击", 2, 3),
            ("blast_master", "爆破专家", 0, 4), ("chain_blast", "连环爆", 2, 3), ("volatile_rounds", "爆裂弹", 3, 2), ("thunder_judgment", "天雷引", 3, 3),
        };

        [Test]
        public void All24OffenseScrollsAreRegisteredWithTsData()
        {
            Assert.AreEqual(24, Table.Length);
            foreach (var (id, name, rarity, max) in Table)
            {
                var d = Def(id);
                Assert.AreEqual(name, d.name, $"{id} 名字");
                Assert.AreEqual(rarity, d.rarity, $"{id} 稀有度");
                Assert.AreEqual(max, d.maxStacks, $"{id} 层数上限");
                Assert.IsNotEmpty(d.tags, $"{id} 标签");
                Assert.IsFalse(string.IsNullOrWhiteSpace(d.description), $"{id} 描述");
            }
            var errors = ScrollLibrary.Validate(Table.Select(t => Def(t.id)), out _);
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void StatOnlyScrollsStackLikeTs()
        {
            Give("giant_slayer", 3);
            Give("shield_breaker", 2);
            Give("armor_piercer", 3);
            Give("steady", 3);
            Give("blast_master", 4);
            Give("bottomless", 3);
            Assert.AreEqual(0.36f, sheet.Get(Stat.EliteDamagePct), Eps);
            Assert.AreEqual(0.36f, sheet.Get(Stat.BossDamagePct), Eps);
            Assert.AreEqual(0.4f, sheet.Get(Stat.ShieldDamagePct), Eps);
            Assert.AreEqual(0.6f, sheet.Get(Stat.ArmorDamagePct), Eps);
            Assert.AreEqual(-0.36f, sheet.Get(Stat.SpreadPct), Eps);
            Assert.AreEqual(-0.45f, sheet.Get(Stat.RecoilPct), Eps);
            Assert.AreEqual(0.4f, sheet.Get(Stat.ExplosionRadiusPct), Eps);
            Assert.AreEqual(0.48f, sheet.Get(Stat.ExplosionDamagePct), Eps);
            Assert.AreEqual(0.3f, sheet.Get(Stat.MagPct), Eps);
            Assert.AreEqual(0.6f, sheet.Get(Stat.AmmoReservePct), Eps, "百宝囊补上备弹上限");

            // 屠巨 / 破盾走 Combat 的乘区：精英 ×1.36，护盾层 ×1.4
            var elite = Enemy(Vector3.zero, 1e6f, Rank.Elite);
            Assert.AreEqual(136f, Hit(elite), Eps);
            var shielded = Enemy(new Vector3(3, 0, 0));
            shielded.maxShield = 1000;
            shielded.ResetVitals();
            Assert.AreEqual(140f, Hit(shielded), Eps);
        }

        // ───────────── 条件增伤 ─────────────

        [Test]
        public void FirstBloodReadsDurabilityBeforeTheHit()
        {
            Give("first_blood", 2);
            var e = Enemy(Vector3.zero, 1000);
            Assert.AreEqual(140f, Hit(e), Eps, "满耐久：×1.4");
            e.health = 900;
            Assert.AreEqual(100f, Hit(e), Eps, "90% 不算「高于 90%」");

            // 耐久 = 生命 + 护盾 + 护甲：生命满、护盾掉了一截，(1000 + 850) / 2000 = 92.5% 仍然触发
            var shielded = Enemy(new Vector3(3, 0, 0), 1000);
            shielded.maxShield = 1000;
            shielded.ResetVitals();
            shielded.shield = 850;
            Assert.AreEqual(140f, Hit(shielded), Eps);
            Assert.AreEqual(710f, shielded.shield, Eps, "这一击打在护盾上");
        }

        [Test]
        public void ExecutionerAppliesBelow35Percent()
        {
            Give("executioner", 3);
            var e = Enemy(Vector3.zero, 1000);
            e.health = 340;
            Assert.AreEqual(154f, Hit(e, 100), Eps, "34%：×1.54");
            e.health = 350;
            Assert.AreEqual(100f, Hit(e, 100), Eps, "35% 不算「低于 35%」");
        }

        [Test]
        public void CloseCombatAndSharpshooterUseHorizontalPlayerDistance()
        {
            var pv = Player(Vector3.zero);
            Give("close_combat", 3, pv);
            Give("sharpshooter", 3, pv);
            var near = Enemy(new Vector3(6.9f, 10, 0));
            var mid = Enemy(new Vector3(10, 0, 0));
            var far = Enemy(new Vector3(0, -5, 18.5f));
            Assert.AreEqual(130f, Hit(near), Eps, "7 米内（只算水平距离）×1.3");
            Assert.AreEqual(100f, Hit(mid), Eps);
            Assert.AreEqual(145f, Hit(far), Eps, "18 米外 ×1.45");

            inv.Clear();
            Give("close_combat", 3);
            Give("sharpshooter", 3);
            Assert.AreEqual(100f, Hit(near), Eps, "没有玩家：都不生效");
            Assert.AreEqual(100f, Hit(far), Eps);
        }

        // ───────────── 暴击 / 爆头 ─────────────

        [Test]
        public void HeadsmanBoostsWeakHitsAndRefundsShieldOnWeaponHeadshotKills()
        {
            var pv = Player(Vector3.zero);
            pv.shield = 0;
            Give("headsman", 2, pv);
            var e = Enemy(new Vector3(5, 0, 0));
            Assert.AreEqual(260f, Hit(e, 100, weak: true), Eps, "弱点必暴 ×2，再 ×1.3");
            Assert.AreEqual(100f, Hit(e), Eps);

            var a = Enemy(new Vector3(8, 0, 0), 50);
            Hit(a, 100);
            Assert.AreEqual(0f, pv.shield, Eps, "非爆头击杀不回盾");
            var b = Enemy(new Vector3(11, 0, 0), 50);
            Hit(b, 100, weak: true, source: DamageSource.Skill);
            Assert.AreEqual(0f, pv.shield, Eps, "技能爆头击杀不回盾");
            var c = Enemy(new Vector3(14, 0, 0), 50);
            Hit(c, 100, weak: true);
            Assert.AreEqual(8f, pv.shield, Eps, "武器爆头击杀：每层 4");
            var d = Enemy(new Vector3(17, 0, 0), 50);
            Hit(d, 100, weak: true, source: DamageSource.Melee);
            Assert.AreEqual(16f, pv.shield, Eps, "碎刃斩击算武器（TS source 'weapon'）");
        }

        [Test]
        public void CritStreakStacksOncePerFrameRefreshesAndExpires()
        {
            Give("crit_streak", 2);
            var e = Enemy(Vector3.zero);
            Hit(e, 10);
            Assert.AreEqual(0f, sheet.Get(Stat.CritDamagePct), Eps, "不暴击不得战意");
            Hit(e, 10, crit: true);
            Assert.AreEqual(0.12f, sheet.Get(Stat.CritDamagePct), Eps, "1 层战意 × 2 层秘卷");
            Assert.AreEqual(0.03f, sheet.Get(Stat.FireRatePct), Eps);
            Hit(e, 10, crit: true);
            Assert.AreEqual(0.12f, sheet.Get(Stat.CritDamagePct), Eps, "同一帧只累积一次");
            for (int i = 0; i < 6; i++)
            {
                ScrollTicker.Step(0.1f);
                Hit(e, 10, crit: true);
            }
            Assert.AreEqual(0.6f, sheet.Get(Stat.CritDamagePct), Eps, "最多 5 层");
            Assert.AreEqual(0.15f, sheet.Get(Stat.FireRatePct), Eps);

            // 衍生的暴击不算
            var proc = ScrollKit.ProcInfo("x", DamageSource.Weapon, 10, Element.None, 1, ScrollKit.BodyCenter(e), Vector3.forward);
            proc.forceCrit = true;
            ScrollTicker.Step(4.9f);
            Combat.DamageEnemy(e, proc);
            ScrollTicker.Step(0.15f);
            Assert.AreEqual(0f, sheet.Get(Stat.CritDamagePct), Eps, "5 秒到期全部结束（衍生暴击不刷新）");

            Hit(e, 10, crit: true);
            Assert.AreEqual(0.12f, sheet.Get(Stat.CritDamagePct), Eps, "过期后重新从 1 层算");
            GameEvents.RaiseStageLoaded(null);
            Assert.AreEqual(0f, sheet.Get(Stat.CritDamagePct), Eps, "换关清空");
            ScrollTicker.Step(0.1f);
            Hit(e, 10, crit: true);
            GameEvents.RaisePlayerDied();
            Assert.AreEqual(0f, sheet.Get(Stat.CritDamagePct), Eps, "阵亡清空");
        }

        // ───────────── 射速 / 换弹 / 弹匣 ─────────────

        [Test]
        public void MeteorShotStrikesLiveTargetsWithCooldownAndScaling()
        {
            RunState.Current = new RunState { difficulty = 2 };
            Give("meteor_shot", 2);
            Assert.AreEqual(0.4f, sheet.Get(Stat.ProjectileSpeedPct), Eps);
            var e = Enemy(Vector3.zero);
            var stars = Probe(e);
            Hit(e);
            Assert.AreEqual(1, stars.Count);
            Assert.AreEqual(24 * 1.85f, stars[0].amount, Eps, "每层 12 × 强度成长 1 + (2 − 1) × 0.85");
            Assert.AreEqual(DamageSource.Scroll, stars[0].info.source);
            Assert.AreEqual(1, stars[0].info.depth);
            Assert.IsFalse(stars[0].crit, "星芒不暴击");
            Assert.AreEqual("meteor_shot", stars[0].info.procId);
            Hit(e);
            Assert.AreEqual(1, stars.Count, "冷却 0.8 秒");
            ScrollTicker.Step(0.81f);
            Hit(e, 100, source: DamageSource.Skill);
            Assert.AreEqual(1, stars.Count, "技能命中不触发");
            Hit(e, 100, source: DamageSource.Melee);
            Assert.AreEqual(2, stars.Count, "近战可以触发");

            ScrollTicker.Step(0.81f);
            var weak = Enemy(new Vector3(4, 0, 0), 50);
            var weakStars = Probe(weak);
            Hit(weak, 100);
            Assert.IsTrue(weak.Dead);
            Assert.AreEqual(0, weakStars.Count, "打死了不追加");
        }

        [Test]
        public void LastRoundsNeedsMagAtOrBelowThirtyPercent()
        {
            Give("last_rounds", 3);
            var e = Enemy(Vector3.zero);
            OffenseKit.TestMag = () => (3, 10);
            Assert.AreEqual(145f, Hit(e), Eps, "3 / 10：×1.45");
            Assert.AreEqual(100f, Hit(e, 100, source: DamageSource.Skill), Eps, "只加武器伤害");
            OffenseKit.TestMag = () => (4, 10);
            Assert.AreEqual(100f, Hit(e), Eps);
            OffenseKit.TestMag = () => null;
            Assert.AreEqual(100f, Hit(e), Eps, "没拿武器不生效");
        }

        [Test]
        public void ReloadRushIsATimedFireRateBuff()
        {
            Give("reload_rush", 3);
            Assert.AreEqual(0f, sheet.Get(Stat.FireRatePct), Eps);
            GameEvents.RaiseReloaded(null);
            Assert.AreEqual(0.36f, sheet.Get(Stat.FireRatePct), Eps);
            ScrollTicker.Step(3.9f);
            Assert.AreEqual(0.36f, sheet.Get(Stat.FireRatePct), Eps);
            GameEvents.RaiseReloaded(null);
            ScrollTicker.Step(3.9f);
            Assert.AreEqual(0.36f, sheet.Get(Stat.FireRatePct), Eps, "再换弹刷新时长，不叠数值");
            ScrollTicker.Step(0.2f);
            Assert.AreEqual(0f, sheet.Get(Stat.FireRatePct), Eps);
        }

        [Test]
        public void ReloadNovaBlastsAroundThePlayerWithCooldown()
        {
            var pv = Player(Vector3.zero);
            Give("reload_nova", 2, pv);
            // 胶囊把爆心（脚下 + 0.9 m）包在里面：距离 0，吃满伤害
            var inside = Enemy(new Vector3(0.3f, 0, 0), 1e6f, Rank.Normal, 0.6f);
            var outside = Enemy(new Vector3(0, 0, 6f));
            var hits = Probe(inside);
            var missed = Probe(outside);
            GameEvents.RaiseReloadStarted(null);
            Assert.AreEqual(1, hits.Count);
            Assert.AreEqual(70f, hits[0].amount, Eps, "每层 35");
            Assert.AreEqual(9f, hits[0].info.knockback, Eps);
            Assert.IsTrue(hits[0].info.Has(DamageTag.Explosion));
            Assert.AreEqual(0, missed.Count, "5 米外不受伤");
            GameEvents.RaiseReloadStarted(null);
            Assert.AreEqual(1, hits.Count, "冷却 2 秒");
            ScrollTicker.Step(2.01f);
            GameEvents.RaiseReloadStarted(null);
            Assert.AreEqual(2, hits.Count);
        }

        // ───────────── 爆炸 ─────────────

        [Test]
        public void ChainBlastDetonatesNonBossCorpsesUpToDepthTwo()
        {
            var chances = new List<float>();
            bool roll = true;
            OffenseKit.TestChance = p =>
            {
                chances.Add(p);
                return roll;
            };
            Give("chain_blast", 2);
            var victim = Enemy(Vector3.zero, 200);
            var bystander = Enemy(Vector3.zero, 1e6f, Rank.Normal, 0.6f);
            var hits = Probe(bystander);
            Hit(victim, 1000);
            Assert.IsTrue(victim.Dead);
            Assert.AreEqual(0.2f, chances.Single(), Eps, "每层 10%");
            Assert.AreEqual(1, hits.Count);
            Assert.AreEqual(60f, hits[0].amount, Eps, "最大生命 30%");
            Assert.AreEqual(DamageSource.Explosion, hits[0].info.source);
            Assert.AreEqual(1, hits[0].info.depth);

            var boss = Enemy(Vector3.zero, 200, Rank.Boss);
            Hit(boss, 1000);
            Assert.AreEqual(1, hits.Count, "首领不引爆");

            var deep = Enemy(Vector3.zero, 200);
            var info = Weapon(deep, 1000);
            info.depth = 2;
            Combat.DamageEnemy(deep, info);
            Assert.AreEqual(1, hits.Count, "深度 2 的击杀不再引爆");

            roll = false;
            Hit(Enemy(Vector3.zero, 200), 1000);
            Assert.AreEqual(1, hits.Count, "没掷中");

            var purge = Enemy(Vector3.zero, 200);
            roll = true;
            Combat.Execute(purge, true);
            Assert.AreEqual(1, hits.Count, "静默处决不触发");
        }

        [Test]
        public void VolatileRoundsExplodeOnDirectCritsAtTheHitPoint()
        {
            Give("volatile_rounds", 2);
            var target = Enemy(Vector3.zero);
            var near = Enemy(Vector3.zero, 1e6f, Rank.Normal, 0.6f);
            var hits = Probe(near);
            Hit(target, 100);
            Assert.AreEqual(0, hits.Count, "不暴击不炸");
            Hit(target, 100, crit: true);
            Assert.AreEqual(1, hits.Count);
            Assert.AreEqual(120f, hits[0].amount, Eps, "实际伤害 200 × 每层 30% × 2 层");
            Assert.IsFalse(hits[0].crit);
            Hit(target, 100, crit: true);
            Assert.AreEqual(1, hits.Count, "内置冷却 0.12 秒");
            ScrollTicker.Step(0.13f);
            var proc = ScrollKit.ProcInfo("x", DamageSource.Weapon, 100, Element.None, 1, ScrollKit.BodyCenter(target), Vector3.forward);
            proc.forceCrit = true;
            Combat.DamageEnemy(target, proc);
            Assert.AreEqual(1, hits.Count, "衍生暴击不炸");
            Hit(target, 100, crit: true);
            Assert.AreEqual(2, hits.Count);
        }

        [Test]
        public void ThunderJudgmentStrikesOnTheSixteenthFrameAndAppliesShock()
        {
            Give("thunder_judgment", 2);
            var e = Enemy(Vector3.zero);
            var bolts = Probe(e, swallow: true);
            for (int i = 0; i < 15; i++)
            {
                Hit(e, 10);
                Hit(e, 10); // 同一帧的第二颗弹丸不计
                ScrollTicker.Step(0.02f);
            }
            Assert.AreEqual(0, bolts.Count, "15 次命中只攒数");
            Hit(e, 10, source: DamageSource.Skill);
            Assert.AreEqual(0, bolts.Count, "技能命中不计");
            Hit(e, 10);
            Assert.AreEqual(1, bolts.Count, "第 16 次召唤天雷");
            var b = bolts[0];
            Assert.AreEqual(90f, b.amount, Eps, "每层 45（难度 1）");
            Assert.AreEqual(Element.Shock, b.info.element);
            Assert.AreEqual(1f, b.info.statusChance, Eps, "必定附着雷殛");
            Assert.AreEqual(DamageSource.Scroll, b.info.source);
            Assert.AreEqual(1, b.info.depth);
            Assert.IsTrue(b.info.Has(DamageTag.Explosion));
            ScrollTicker.Step(0.02f);
            Hit(e, 10);
            Assert.AreEqual(1, bolts.Count, "计数清零重来");
        }

        // ───────────── 叠层 / 卸载 ─────────────

        [Test]
        public void HookScrollsLeaveNoResidueWhenRemoved()
        {
            var pv = Player(Vector3.zero);
            int out0 = Combat.Outgoing.Count, tasks0 = ScrollTicker.TaskCount;
            foreach (var (id, _, _, max) in Table) Give(id, max, pv);
            Assert.Greater(Combat.Outgoing.Count, out0);
            inv.Clear();
            Assert.AreEqual(out0, Combat.Outgoing.Count, "输出修饰器全部撤掉");
            Assert.AreEqual(tasks0, ScrollTicker.TaskCount, "限时增益的状态任务全部撤掉");
            foreach (var (id, _, _, _) in Table)
            {
                Assert.IsFalse(sheet.HasSource(ScrollScope.SourceOf(id)), $"{id} 的属性没撤掉");
                for (int i = 0; i < 6; i++) Assert.IsFalse(sheet.HasSource($"{ScrollScope.SourceOf(id)}#buff{i}"), $"{id} 的限时增益没撤掉");
            }
            Assert.AreEqual(0f, sheet.Get(Stat.FireRatePct), Eps);
            Assert.AreEqual(0f, sheet.Get(Stat.CritDamagePct), Eps);
        }
    }
}
