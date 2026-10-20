using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第三章敌人（二）：炮仗傀儡、神火飞鸦、熔铜匠、变脸傩巫（docs/unity-parity.md EN3d / EN3e，对照 tests/inferno-blasters.test.mjs、inferno-support.test.mjs）。
    /// 不用场景的部分：定义数值与 TS DEF 一致、木偶步态、一窝蜂落点 / 落地时刻 / 排队、哑炸判定、地老鼠寿命、俯冲速度与整群轮次、
    /// 铜甲的阶段（通红 ×2 → 冷青铜 ×0.5 → 剥落 / 打碎、护甲层收回）、浇铸抛物线、头挡坩埚、躲后排站位、三张脸的光环 / 轮换 / 火柱扫向与判定。
    /// 整只敌人跑起来（状态都到达、片段都在）由 TestArena 的冒烟套件验收。
    /// </summary>
    public sealed class InfernoEnemyTests2
    {
        readonly List<GameObject> spawned = new();

        [SetUp]
        public void SetUp()
        {
            HazardClock.ResetForTests();
            FireCrowAI.ResetFlock();
        }

        [TearDown]
        public void TearDown()
        {
            HazardClock.ResetForTests();
            FireCrowAI.ResetFlock();
            foreach (var go in spawned)
                if (go)
                    Object.DestroyImmediate(go);
            spawned.Clear();
        }

        // ───────────── 定义 ─────────────

        static EnemyDef Def(string id)
        {
            var d = Registry<EnemyDef>.Get(id);
            Assert.IsNotNull(d, $"名册里没有 {id}");
            return d;
        }

        [Test]
        public void DefsMatchThreeJs()
        {
            var fc = Def("firecracker");
            Assert.AreEqual(("炮仗傀儡", "SK_Enemy_Firecracker", typeof(FirecrackerAI)), (fc.name, fc.prefab, fc.ai));
            Assert.AreEqual(new[] { 160f, 2.5f, 16f, 1.2f, 0.42f, 1.9f, 0.76f, 0.3f }, new[] { fc.hp, fc.speed, fc.damage, fc.scale, fc.radius, fc.height, fc.weakHeight, fc.knockbackResist });
            Assert.AreEqual(new Vector2Int(3, 6), fc.coins);
            Assert.AreEqual(EnemyPlacement.Artillery, fc.placementRole);
            Assert.IsFalse(fc.groundOnly, "炮仗傀儡可以站高台");

            var crow = Def("fire_crow");
            Assert.AreEqual(("神火飞鸦", "SK_Enemy_FireCrow", typeof(FireCrowAI)), (crow.name, crow.prefab, crow.ai));
            Assert.AreEqual(new[] { 20f, 9f, 22f, 1.2f, 0.3f, 0.9f, 0.43f, 0.24f, 0.2f }, new[] { crow.hp, crow.speed, crow.damage, crow.scale, crow.radius, crow.height, crow.weakHeight, crow.weakRadius, crow.knockbackResist });
            Assert.IsTrue(crow.flying);
            Assert.AreEqual(EnemyPlacement.Flank, crow.placementRole);
            Assert.AreEqual(new Vector2Int(1, 2), crow.coins);

            var fo = Def("founder");
            Assert.AreEqual(("熔铜匠", "SK_Enemy_Founder", typeof(FounderAI)), (fo.name, fo.prefab, fo.ai));
            Assert.AreEqual(new[] { 150f, 3f, 10f, 1.3f, 0.36f, 1.55f, 1.21f, 0.18f, 0.55f }, new[] { fo.hp, fo.speed, fo.damage, fo.scale, fo.radius, fo.height, fo.weakHeight, fo.weakRadius, fo.knockbackResist });
            Assert.AreEqual(EnemyPlacement.Support, fo.placementRole);
            Assert.AreEqual("bronze", fo.weakBone);

            var nuo = Def("nuo");
            Assert.AreEqual(("变脸傩巫", "SK_Enemy_Nuo", typeof(NuoAI)), (nuo.name, nuo.prefab, nuo.ai));
            Assert.AreEqual(new[] { 130f, 4f, 9f, 1.2f, 0.32f, 1.75f, 1.36f, 0.15f, 0.25f }, new[] { nuo.hp, nuo.speed, nuo.damage, nuo.scale, nuo.radius, nuo.height, nuo.weakHeight, nuo.weakRadius, nuo.knockbackResist });
            Assert.AreEqual(EnemyPlacement.Support, nuo.placementRole);
            Assert.AreEqual("mask", nuo.weakBone);

            foreach (var d in new[] { fc, crow, fo, nuo })
            {
                Assert.AreEqual(1, d.essence, d.id);
                Assert.AreEqual(Element.Fire, d.element, d.id);
                Assert.IsTrue(typeof(EnemyAI).IsAssignableFrom(d.ai) && !d.ai.IsAbstract, d.id);
            }
        }

        [Test]
        public void GunpowderEnemiesAreChainKinAndSkipVolatile()
        {
            Assert.IsTrue(typeof(IExplosiveKin).IsAssignableFrom(typeof(FirecrackerAI)));
            Assert.IsTrue(typeof(IExplosiveKin).IsAssignableFrom(typeof(FireCrowAI)));
            Assert.IsTrue(typeof(FlyingEnemyAI).IsAssignableFrom(typeof(FireCrowAI)), "神火飞鸦走飞行基类");
            Assert.IsTrue(typeof(ISelfDestruct).IsAssignableFrom(typeof(FireCrowAI)), "撞地自爆不算玩家击杀：冒烟套件据此豁免");
            Assert.IsFalse(typeof(IExplosiveKin).IsAssignableFrom(typeof(FounderAI)));
            CollectionAssert.Contains(Def("firecracker").affixExclusions, "volatile", "死亡爆炸本来就是它的机制");
            CollectionAssert.Contains(Def("fire_crow").affixExclusions, "volatile");
            Assert.IsEmpty(Def("founder").affixExclusions);
            Assert.IsEmpty(Def("nuo").affixExclusions);
        }

        // ───────────── 炮仗傀儡 ─────────────

        [Test]
        public void PuppetGaitAveragesToTheDefSpeed()
        {
            Assert.AreEqual(1f, FirecrackerAI.PuppetGaitAverage, 0.01f, "整步平均 ≈ 定义移速");
            Assert.AreEqual(FirecrackerAI.SwingSpeed, FirecrackerAI.PuppetGait(0.1f));
            Assert.AreEqual(FirecrackerAI.HoldSpeed, FirecrackerAI.PuppetGait(0.5f));
        }

        [Test]
        public void VolleyTargetsLeadThePlayerAndKeepTheirSpacing()
        {
            var res = new List<Vector3>();
            var player = new Vector3(0, 0, 0);
            var self = new Vector3(15, 0, 0);
            int n = FirecrackerAI.PickTargets(player, new Vector3(2, 0, 0), self, 0.5f, FirecrackerAI.Rockets, 0, () => 0, null, res);
            Assert.AreEqual(8, n, "8 支火箭");
            Assert.AreEqual(1.2f, res[0].x, 1e-4f, "第一处是玩家 0.6 s 后的预判位置");
            for (int i = 0; i < res.Count; i++)
            {
                Assert.LessOrEqual(Flat(res[i], player), FirecrackerAI.Spread + 0.3f + 1e-4f, "都在玩家周围 6 m 内");
                Assert.GreaterOrEqual(Flat(res[i], self), 3.5f - 1e-4f, "离傀儡至少 3 m + 身体半径");
                for (int j = 0; j < i; j++) Assert.GreaterOrEqual(Flat(res[i], res[j]), FirecrackerAI.RocketGap - 1e-4f, "落点彼此至少 1.7 m");
            }
            int elite = FirecrackerAI.PickTargets(player, Vector3.zero, self, 0.5f, FirecrackerAI.RocketsElite, 2, () => 0, null, res);
            Assert.That(elite, Is.InRange(10, 12), "精英 12 支（候选不够时少几支，同 TS）");
            // 投影到地面：落点跟着投影走
            FirecrackerAI.PickTargets(player, Vector3.zero, self, 0.5f, 4, 0, () => 0, p => p + Vector3.up * 2, res);
            Assert.IsTrue(res.All(p => Mathf.Approximately(p.y, 2)));
        }

        static float Flat(Vector3 a, Vector3 b) => new Vector2(a.x - b.x, a.z - b.z).magnitude;

        [Test]
        public void VolleyLandsFrom1_3sEvery0_09sInShuffledOrder()
        {
            var t = FirecrackerAI.VolleyTimes(8, i => 0);
            Assert.AreEqual(8, t.Length);
            CollectionAssert.AreEquivalent(Enumerable.Range(0, 8).Select(i => FirecrackerAI.RocketFirst + i * FirecrackerAI.RocketStagger).ToArray(), t);
            Assert.AreNotEqual(FirecrackerAI.RocketFirst, t[0], "洗过牌：第一支（玩家脚下）不总是最先落地");
            Assert.IsEmpty(FirecrackerAI.VolleyTimes(0, null));
        }

        [Test]
        public void VolleyQueuesRiseFallAndImpactPerRocket()
        {
            var spec = new FirecrackerAI.Volley
            {
                from = new[] { new Vector3(0, -800, 0) },
                targets = new[] { new Vector3(4, -800, 0), new Vector3(-4, -800, 0), new Vector3(0, -800, 4) },
                times = new[] { 1.3f, 1.39f, 1.48f }, radius = 1.6f, damage = 16, fire = true, fireRadius = 1, fireTime = 2.5f, fireDamage = 2,
                enemyBase = 30, knockback = 6,
            };
            FirecrackerAI.LaunchVolley(spec);
            Assert.AreEqual(9, HazardClock.Pending, "每支火箭：上升外观、下落外观、落地结算");
            HazardClock.Step(0.5f);
            Assert.AreEqual(6, HazardClock.Pending, "0.5 s：上升外观都发了，剩下落外观（落地前 0.32 s）和落地结算");
            HazardClock.Step(1.5f);
            // 落地结算里排的顺带伤敌（0.02 s 后）按「排队那一刻的时钟」算：一步跨到 2.0 s 时它们排在 2.02 s，下一步才跑
            Assert.AreEqual(3, HazardClock.Pending, "全部落地；每支火箭的顺带伤敌结算排在落地之后 0.02 s");
            HazardClock.Step(0.05f);
            Assert.AreEqual(0, HazardClock.Pending, "顺带伤敌的结算也跑完了（没有玩家 / 敌人时不出错）");
        }

        [Test]
        public void DudNeedsAShotOnTheBurningPowderChamber()
        {
            Assert.IsTrue(FirecrackerAI.DudHit(true, 0.44f, 1), "弱点命中离火药仓 0.45 m 内");
            Assert.IsFalse(FirecrackerAI.DudHit(true, 0.5f, 1));
            Assert.IsTrue(FirecrackerAI.DudHit(false, 0.27f, 1), "任何命中点离火药仓 0.28 m 内（投射物）");
            Assert.IsFalse(FirecrackerAI.DudHit(false, 0.3f, 1));
            Assert.IsTrue(FirecrackerAI.DudHit(false, 0.3f, 1.2f), "判定随体型放大");
        }

        [Test]
        public void FuseSparkRunsAlongTheWireByLength()
        {
            var pts = new[] { Vector3.zero, new Vector3(1, 0, 0), new Vector3(1, 3, 0) };
            Assert.AreEqual(Vector3.zero, FirecrackerAI.AlongPath(pts, 0));
            Assert.AreEqual(new Vector3(1, 3, 0), FirecrackerAI.AlongPath(pts, 1));
            Assert.That(Vector3.Distance(new Vector3(1, 1, 0), FirecrackerAI.AlongPath(pts, 0.5f)), Is.LessThan(1e-4f), "按长度：总长 4，一半在第二段的 1 m 处");
        }

        [Test]
        public void GroundRatsBlowUpWhenTheirFuseRunsOut()
        {
            var rats = FirecrackerRats.Spawn(new Vector3(0, -900, 0), FirecrackerAI.Rats, FirecrackerAI.RatLife, FirecrackerAI.RatSpeed, FirecrackerAI.RatRadius, 10, null, 0);
            spawned.Add(rats.gameObject);
            Assert.AreEqual(4, rats.Alive);
            for (int i = 0; i < 24; i++) rats.Step(0.1f);
            Assert.AreEqual(4, rats.Alive, "2.4 s：还在跑");
            for (int i = 0; i < 3; i++) rats.Step(0.1f);
            Assert.AreEqual(0, rats.Alive, "2.5 s 寿命到了就炸");
        }

        // ───────────── 神火飞鸦 ─────────────

        [Test]
        public void DiveIsAStraightLineCappedAt13VerticalAnd20Total()
        {
            var steep = FireCrowAI.DiveVelocity(new Vector3(0, 10.25f, 0), new Vector3(0, 0, 10));
            Assert.AreEqual(-13f, steep.y, 1e-3f, "陡的俯冲：竖直分量正好 13 m/s");
            Assert.Less(steep.magnitude, 20f);
            var flat = FireCrowAI.DiveVelocity(new Vector3(0, 2.25f, 0), new Vector3(0, 0, 30));
            Assert.AreEqual(20f, flat.magnitude, 1e-3f, "平缓的俯冲：20 m/s");
            Assert.Greater(flat.z, 0);
            var dir = (new Vector3(0, 0.25f, 30) - new Vector3(0, 2.25f, 0)).normalized;
            Assert.Greater(Vector3.Dot(flat.normalized, dir), 0.9999f, "指向锁定点上方 0.25 m（不追踪）");
        }

        [Test]
        public void FlockTakesTurnsIgniting()
        {
            Assert.IsTrue(FireCrowAI.FlockReady(10));
            FireCrowAI.FlockTaken(10, 1.5f);
            Assert.IsFalse(FireCrowAI.FlockReady(11.4f), "下一只至少 1.5 s 之后");
            Assert.IsTrue(FireCrowAI.FlockReady(11.5f));
        }

        [Test]
        public void OrbitPointCirclesTheCentre()
        {
            var c = new Vector3(3, 1, -2);
            for (int i = 0; i < 8; i++)
            {
                var p = FireCrowAI.OrbitPoint(c, 0.7f, FireCrowAI.OrbitW, i * 1.3f, 8f);
                Assert.AreEqual(8f, Flat(p, c), 1e-4f);
            }
            Assert.AreNotEqual(FireCrowAI.OrbitPoint(c, 0, 0.5f, 0, 8), FireCrowAI.OrbitPoint(c, 0, 0.5f, 1, 8), "随时间转");
        }

        // ───────────── 熔铜匠 ─────────────

        Damageable Ally(float maxHp, float armor = 0)
        {
            var go = new GameObject("Ally");
            spawned.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = maxHp;
            d.health = maxHp;
            d.maxArmor = armor;
            d.armor = armor;
            return d;
        }

        [Test]
        public void BronzeIsRedHotThenColdThenPeelsOff()
        {
            var hp = Ally(200);
            var buffs = new EnemyBuffs();
            var b = FounderAI.Bronze.Grant(hp, buffs, 1, 100);
            Assert.IsNotNull(b);
            Assert.AreEqual(120, b.Pool, "护甲层 = 最大生命 60%");
            Assert.AreEqual((120f, 120f), (hp.armor, hp.maxArmor));
            Assert.AreEqual(FounderAI.HotTaken, buffs.Total.taken, "通红：受伤 ×2");
            Assert.AreSame(b, FounderAI.Bronze.On(hp));
            Assert.IsNull(FounderAI.Bronze.Grant(hp, buffs, 1, 100), "已有铜甲不叠加");
            Assert.AreEqual(FounderAI.Bronze.Step.None, b.Tick(101));
            Assert.AreEqual(FounderAI.Bronze.Step.Cooled, b.Tick(102.5f));
            Assert.AreEqual(FounderAI.ColdTaken, buffs.Total.taken, "冷青铜：受伤 ×0.5");
            Assert.AreEqual(0f, b.Heat(103.5f), 1e-4f, "冷却后 0.9 s 内退红");
            Assert.AreEqual(FounderAI.Bronze.Step.None, b.Tick(114));
            Assert.AreEqual(FounderAI.Bronze.Step.Peeled, b.Tick(114.5f), "2.5 + 12 s 后剥落");
            Assert.AreEqual(1f, buffs.Total.taken, "倍率撤掉");
            Assert.AreEqual((0f, 0f), (hp.armor, hp.maxArmor), "剩下的甲收回");
            Assert.IsNull(FounderAI.Bronze.On(hp));
            Assert.IsNotNull(FounderAI.Bronze.Grant(hp, buffs, 1, 120), "剥落后可以再浇");
        }

        [Test]
        public void BronzeShattersWhenItsLayerIsShotThroughAndKeepsTheAllysOwnArmour()
        {
            var hp = Ally(200, 50);
            var buffs = new EnemyBuffs();
            var b = FounderAI.Bronze.Grant(hp, buffs, 1.3f, 0);
            Assert.AreEqual(156, b.Pool, "精英熔铜匠 ×1.3");
            Assert.AreEqual((206f, 206f), (hp.armor, hp.maxArmor), "叠在原有护甲上");
            hp.armor = 50.3f;
            Assert.AreEqual(FounderAI.Bronze.Step.Shattered, b.Tick(0.5f), "这副铜甲的部分打穿了（原有护甲还在）");
            Assert.IsTrue(b.Shattered);
            Assert.AreEqual(1f, buffs.Total.taken);
            Assert.AreEqual(50f, hp.maxArmor, 1e-4f, "上限回到原来的");
            Assert.AreEqual(50f, hp.armor, 1e-4f, "收回的只是这副铜甲剩下的部分，原有护甲不动");
            Assert.AreEqual(FounderAI.Bronze.Step.None, b.Tick(1), "结束后不再推进");
        }

        [Test]
        public void BronzeIsDroppedWhenTheAllyDies()
        {
            var hp = Ally(100);
            var buffs = new EnemyBuffs();
            var b = FounderAI.Bronze.Grant(hp, buffs, 1, 0);
            hp.Kill(DamageInfo.Simple(1, DamageSource.Status, Vector3.zero, Vector3.up));
            Assert.AreEqual(FounderAI.Bronze.Step.Peeled, b.Tick(0.1f));
            Assert.IsNull(FounderAI.Bronze.On(hp));
            Assert.IsNull(FounderAI.Bronze.Grant(hp, new EnemyBuffs(), 1, 1), "死了的不浇");
        }

        [Test]
        public void PourArcRunsSpoutToHeadAndRisesByApex()
        {
            var a = new Vector3(0, 2, 0);
            var b = new Vector3(8, 1, 0);
            Assert.AreEqual(a, FounderAI.PourArc(a, b, 1.5f, 0));
            Assert.AreEqual(b, FounderAI.PourArc(a, b, 1.5f, 1));
            Assert.AreEqual(1.5f + 1.5f, FounderAI.PourArc(a, b, 1.5f, 0.5f).y, 1e-4f, "中点抬高 apex");
        }

        [Test]
        public void HeadShieldsTheCrucibleFromTheFrontOnly()
        {
            // 熔铜匠面朝 +Z：头在前上方，坩埚在背上
            var crucible = new Vector3(0, 1.57f, -0.17f);
            var head = new Vector3(0, 1.56f, 0.22f);
            const float r = 0.26f;
            Assert.IsTrue(FounderAI.HeadShields(new Vector3(0, 1.62f, 10), crucible, head, r), "正面平视：被头挡住");
            Assert.IsFalse(FounderAI.HeadShields(new Vector3(0, 1.62f, -10), crucible, head, r), "从背后：打得到");
            Assert.IsFalse(FounderAI.HeadShields(new Vector3(0, 9f, 4), crucible, head, r), "从高处往下打：打得到");
            Assert.IsFalse(FounderAI.HeadShields(new Vector3(10, 1.62f, 0), crucible, head, r), "从侧面：打得到");
        }

        [Test]
        public void SupportsHideBehindTheirAllies()
        {
            var player = Vector3.zero;
            var spot = FounderAI.BehindSpot(new[] { new Vector3(-2, 0, 12), new Vector3(2, 0, 12) }, player, 10, 3);
            Assert.IsTrue(spot.HasValue);
            Assert.AreEqual(15f, spot.Value.z, 1e-4f, "重心再往远离玩家的方向退 3 m");
            Assert.AreEqual(0f, spot.Value.x, 1e-4f);
            var near = FounderAI.BehindSpot(new[] { new Vector3(0, 0, 3) }, player, 10, 3);
            Assert.AreEqual(10f, Flat(near.Value, player), 1e-4f, "离玩家不到 10 m 时推到 10 m");
            Assert.IsNull(FounderAI.BehindSpot(new Vector3[0], player, 10, 3), "没有同伴：交给保持距离");
        }

        // ───────────── 变脸傩巫 ─────────────

        [Test]
        public void ThreeFacesWithTheirAuras()
        {
            Assert.AreEqual(new[] { "red", "black", "gold" }, NuoAI.Faces.Select(f => f.id).ToArray());
            Assert.AreEqual(new BuffMods(1.35f, 1.25f, 1, 1), NuoAI.Faces[0].aura, "赤面：伤害 ×1.35、攻速 ×1.25");
            Assert.AreEqual(new BuffMods(1, 1, 1, 0.6f), NuoAI.Faces[1].aura, "黑面：受伤 ×0.6");
            Assert.AreEqual(new BuffMods(1, 1, 1.3f, 1), NuoAI.Faces[2].aura, "金面：移速 ×1.3");
            Assert.AreEqual(0.02f, NuoAI.Faces[2].regen, "金面每秒回 2% 最大生命");
            Assert.AreEqual(3, NuoAI.Faces.Select(f => f.Channel).Distinct().Count(), "每张脸一个加成通道（同脸不叠加、不同脸相乘）");
            Assert.Greater(NuoAI.Faces[1].Readable.r + NuoAI.Faces[1].Readable.b, 0.5f, "黑面的贴地光环用紫边，读得出");
        }

        [Test]
        public void FaceChangeSkipsBrokenFaces()
        {
            Assert.AreEqual(1, NuoAI.NextFace(0, new[] { false, false, false }));
            Assert.AreEqual(0, NuoAI.NextFace(2, new[] { false, false, false }));
            Assert.AreEqual(2, NuoAI.NextFace(0, new[] { false, true, false }), "碎掉的脸不再换回来");
            Assert.AreEqual(0, NuoAI.NextFace(1, new[] { false, true, true }), "只剩当前以外的一张");
            Assert.AreEqual(1, NuoAI.NextFace(1, new[] { true, true, true }), "全碎了留在原地");
        }

        [Test]
        public void FireSpitSweepsHalfACircleAcrossThePlayer()
        {
            Assert.AreEqual(-Mathf.PI / 2, NuoAI.JetYaw(0, 1, 0), 1e-4f, "从一侧起");
            Assert.AreEqual(0, NuoAI.JetYaw(0, 1, 0.5f), 1e-4f, "中点正前方");
            Assert.AreEqual(Mathf.PI / 2, NuoAI.JetYaw(0, 1, 1), 1e-4f, "扫到另一侧");
            Assert.AreEqual(Mathf.PI / 2, NuoAI.JetYaw(0, -1, 0), 1e-4f, "反向扫");
            var self = Vector3.zero;
            Assert.IsTrue(NuoAI.JetCovers(self, 0, 6, new Vector3(0, 0, 4)), "火柱正对玩家");
            Assert.IsFalse(NuoAI.JetCovers(self, Mathf.PI / 2, 6, new Vector3(0, 0, 4)), "火柱扫到别处");
            Assert.IsFalse(NuoAI.JetCovers(self, 0, 3, new Vector3(0, 0, 5)), "被墙截短的火柱够不着");
            Assert.IsFalse(NuoAI.JetCovers(self, 0, 6, new Vector3(0, 3, 4)), "高差 > 2.5");
            Assert.IsTrue(NuoAI.JetCovers(self, 0.3f, 6, new Vector3(0, 0, 4)), "判定角宽 0.3 弧度");
        }
    }
}
