using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 敌人框架（docs/unity-parity.md 3.7，E1 / E2）：出手名额按章节的上限、续期、合计上限、Reset；加成登记的通道合并与失效
    /// （邪飞天光环 × 赐福与迁移前的公式逐位一致）；生成难度的兜底与生命取整；
    /// 命中区按命中点分区、弱点优先、朝向门、倍率、半径缩放、计数触发，Hitbox.weakpoint 跟着命中区走，blocksSight 挡视线。
    /// </summary>
    public sealed class EnemyFrameworkTests
    {
        const float T0 = 1000f;
        readonly List<GameObject> spawned = new();

        [SetUp]
        public void SetUp() => AttackTokens.Reset();

        [TearDown]
        public void TearDown()
        {
            AttackTokens.Reset();
            foreach (var go in spawned)
                if (go) Object.DestroyImmediate(go);
            spawned.Clear();
        }

        // ───────────── 出手名额 ─────────────

        [Test]
        public void TokenCapsWidenWithChapter()
        {
            Assert.AreEqual(new[] { 4, 5, 6 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Melee, c)).ToArray());
            Assert.AreEqual(new[] { 2, 3, 4 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Ranged, c)).ToArray());
            Assert.AreEqual(new[] { 1, 2, 2 }, new[] { 0, 1, 2 }.Select(c => AttackTokens.Cap(AttackTokens.Kind.Heavy, c)).ToArray());
            Assert.AreEqual(4, AttackTokens.Cap(AttackTokens.Kind.Melee, -3), "章序夹到 0..2");
            Assert.AreEqual(6, AttackTokens.Cap(AttackTokens.Kind.Melee, 9));
        }

        [Test]
        public void FirstChapterGrantsFourMeleeSpacedByGap()
        {
            var who = new object[6];
            for (int i = 0; i < who.Length; i++) who[i] = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[0], 5, T0, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Melee, who[1], 5, T0 + 0.05f, 0), "两次发放间隔 < 0.12 s");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[1], 5, T0 + 0.2f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[2], 5, T0 + 0.4f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[3], 5, T0 + 0.6f, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Melee, who[4], 5, T0 + 0.8f, 0), "第一章近战上限 4");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, who[4], 5, T0 + 0.8f, 1), "第二章近战上限 5");
        }

        [Test]
        public void HolderRenewsEvenWhenFull()
        {
            var a = new object();
            var b = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 1, T0, 0));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 0.9f, 0), "第一章重击上限 1");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 1, T0 + 0.9f, 0), "已持有：续期");
            // 续期后到 T0 + 1.9 才过期：原来的 T0 + 1 之后仍然占着名额
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 1.5f, 0));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, b, 1, T0 + 2f, 0), "过期的名额自动回收");
            Assert.IsFalse(AttackTokens.Holding(a));
        }

        [Test]
        public void RangedAndHeavyShareACombinedCap()
        {
            // 第二章：远程 3、重击 2，两类合计 ≤ 4
            for (int i = 0; i < 3; i++) Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Ranged, new object(), 9, T0 + i, 1));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 4, 1));
            Assert.IsFalse(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 6, 1), "重击才 1 个，但合计已满 4");
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Melee, new object(), 9, T0 + 6, 1), "近战不算进远程合计");
        }

        [Test]
        public void ReleaseAndResetFreeSlots()
        {
            var a = new object();
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, a, 9, T0, 0));
            AttackTokens.Release(a);
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 1, 0));
            AttackTokens.Reset();
            Assert.AreEqual(0, AttackTokens.Count(AttackTokens.Kind.Heavy));
            Assert.IsTrue(AttackTokens.Request(AttackTokens.Kind.Heavy, new object(), 9, T0 + 1.1f, 0), "Reset 也清掉了发放间隔");
        }

        // ───────────── 加成登记 ─────────────

        sealed class Source : IBuffSource
        {
            public bool active = true;
            public bool BuffActive => active;
        }

        [Test]
        public void ApsaraAuraAndBlessMatchTheOldFormula()
        {
            var b = new EnemyBuffs();
            var a1 = new Source();
            float far = Time.time + 100;
            b.SetUntil(EnemyBuffs.ApsaraAura, a1, ApsaraAI.AuraMods, far);
            Assert.AreEqual(1.35f, b.Total.damage);
            Assert.AreEqual(1.35f, b.Total.rate);
            Assert.AreEqual(1.2f, b.Total.speed);
            Assert.AreEqual(0.75f, b.Total.taken);
            b.SetUntil(EnemyBuffs.ApsaraBless, a1, ApsaraAI.BlessMods, far);
            // 迁移前：(aura ? 1.35 : 1) × (blessed ? 1.6 : 1)，逐位相同
            Assert.AreEqual(1.35f * 1.6f, b.Total.damage, 1e-6f);
            Assert.AreEqual(1.35f * 1.5f, b.Total.rate, 1e-6f);
            Assert.AreEqual(1.2f * 1.15f, b.Total.speed, 1e-6f);
            Assert.AreEqual(0.75f * 0.5f, b.Total.taken, 1e-6f);
        }

        [Test]
        public void SameChannelDoesNotStackAndDeadSourcesDrop()
        {
            var b = new EnemyBuffs();
            var a1 = new Source();
            var a2 = new Source();
            float far = Time.time + 100;
            b.SetUntil(EnemyBuffs.ApsaraAura, a1, ApsaraAI.AuraMods, far);
            b.SetUntil(EnemyBuffs.ApsaraAura, a2, ApsaraAI.AuraMods, far);
            Assert.AreEqual(1.35f, b.Total.damage, "两只邪飞天的光环不叠加");
            Assert.AreEqual(2, b.Count);
            string ended = null;
            b.Ended += (ch, src) => ended = ch;
            a1.active = false;
            b.Tick(Time.time);
            Assert.AreEqual(EnemyBuffs.ApsaraAura, ended, "来源失效（沉默 / 死亡）时撤掉并通知");
            Assert.AreEqual(1.35f, b.Total.damage, "另一只还在给");
            a2.active = false;
            Assert.IsFalse(b.Has(EnemyBuffs.ApsaraAura), "没 Tick 之前查询也按失效算");
            b.Tick(Time.time);
            Assert.AreEqual(BuffMods.Identity.damage, b.Total.damage);
            Assert.AreEqual(1f, b.Total.taken);
        }

        [Test]
        public void TimedEntriesExpireAndMultiplyChannelsStack()
        {
            var b = new EnemyBuffs();
            float now = Time.time;
            b.SetUntil("test.short", null, new BuffMods(2, 1, 1, 1), now + 1);
            b.SetUntil("test.long", null, new BuffMods(1.5f, 1, 1, 1), now + 10);
            Assert.AreEqual(3f, b.Total.damage, 1e-6f, "不同通道相乘");
            b.Tick(now + 2);
            Assert.AreEqual(1.5f, b.Total.damage, 1e-6f, "到期的那条撤掉");

            EnemyBuffs.DefineChannel("test.stack", BuffStack.Multiply);
            var c = new EnemyBuffs();
            c.SetUntil("test.stack", new object(), new BuffMods(1, 1, 1, 0.8f), now + 10);
            c.SetUntil("test.stack", new object(), new BuffMods(1, 1, 1, 0.8f), now + 10);
            Assert.AreEqual(0.64f, c.Total.taken, 1e-6f, "Multiply 通道：多个来源相乘");
            Assert.IsTrue(c.RemoveChannel("test.stack") == 2);
            Assert.AreEqual(1f, c.Total.taken);
        }

        // ───────────── 生成 ─────────────

        [Test]
        public void SpawnDifficultyFallsBackToTheRun()
        {
            var saved = RunState.Current;
            try
            {
                RunState.Current = null;
                Assert.AreEqual(1f, EnemyRoster.ResolveDifficulty(float.NaN));
                Assert.AreEqual(1.48f, EnemyRoster.ResolveDifficulty(1.48f), "浮点难度原样用");
                RunState.Current = new RunState { difficulty = 2.28f };
                Assert.AreEqual(2.28f, EnemyRoster.ResolveDifficulty(0));
                Assert.AreEqual(2.28f, EnemyRoster.ResolveDifficulty(-1));
                Assert.AreEqual(3.08f, EnemyRoster.ResolveDifficulty(3.08f));
            }
            finally
            {
                RunState.Current = saved;
            }
        }

        [Test]
        public void HpRoundsLikeMathRound()
        {
            Assert.AreEqual(442f, EnemyAI.RoundHp(170 * 2.6f));
            Assert.AreEqual(1f, EnemyAI.RoundHp(0.5f));
            Assert.AreEqual(3f, EnemyAI.RoundHp(2.5f), "JS Math.round：.5 进位（不是银行家舍入）");
            Assert.AreEqual(252f, EnemyAI.RoundHp(170 * 1.48f));
            Assert.AreEqual(0f, EnemyAI.RoundHp(float.NaN));
        }

        // ───────────── 命中区（E2）─────────────

        /// <summary>远离原点的测试场位置（不和别的测试的物理物体重叠）</summary>
        static readonly Vector3 Far = new(-4000, 500, 4000);

        GameObject New(string name, Transform parent = null)
        {
            var go = new GameObject(name);
            if (!parent) spawned.Add(go);
            go.transform.SetParent(parent, false);
            return go;
        }

        /// <summary>
        /// 测试敌人（没跑 Awake 的 EnemyBody，只拿来登记命中区）：身体胶囊 0–2 m 半径 0.4（区 body）、
        /// 包在胶囊顶部的弱点球 1.75 m 半径 0.25（区 weak）、正面一块甲 1 m 高、贴着胶囊前面（区 plate，×0.2，只挡正面）
        /// </summary>
        (EnemyBody body, HitZone bodyZone, HitZone weak, HitZone plate) Enemy()
        {
            var go = New("TestEnemy");
            go.transform.position = Far;
            var cap = go.AddComponent<CapsuleCollider>();
            cap.center = Vector3.up;
            cap.height = 2;
            cap.radius = 0.4f;
            var d = go.AddComponent<Damageable>();
            var body = go.AddComponent<EnemyBody>();
            var bz = HitZone.Create(cap, d, body, "body");
            var head = New("Weak", go.transform);
            head.transform.localPosition = new Vector3(0, 1.75f, 0);
            var sphere = head.AddComponent<SphereCollider>();
            sphere.radius = 0.25f;
            var wz = HitZone.Create(sphere, d, body, "weak", 1f, true, 10);
            var plateGo = New("Plate", go.transform);
            plateGo.transform.localPosition = new Vector3(0, 1f, 0.5f);
            var box = plateGo.AddComponent<BoxCollider>();
            box.size = new Vector3(0.6f, 0.6f, 0.2f);
            var pz = HitZone.Create(box, d, body, "plate", 0.2f, false, 5);
            pz.facing = ZoneFacing.Front;
            Physics.SyncTransforms();
            return (body, bz, wz, pz);
        }

        static DamageInfo Hit(Vector3 point, Vector3 dir, bool weak = false, DamageSource source = DamageSource.Weapon)
        {
            var i = DamageInfo.Simple(10, source, point, dir);
            i.weakpoint = weak;
            return i;
        }

        [Test]
        public void ZoneAtPicksByHitPoint()
        {
            var (body, bz, wz, pz) = Enemy();
            Assert.AreEqual(3, body.Zones.Count);
            Assert.AreSame(wz, body.ZoneAt(Hit(Far + new Vector3(0, 2.0f, 0), Vector3.down, true)), "弱点命中落在弱点区");
            Assert.AreSame(bz, body.ZoneAt(Hit(Far + new Vector3(0, 1.75f, -0.4f), Vector3.forward)),
                "非弱点命中不落在弱点区（命中点在胶囊表面，也在弱点球附近）");
            Assert.AreSame(bz, body.ZoneAt(Hit(Far + new Vector3(0.4f, 0.5f, 0), Vector3.left)));
            Assert.AreSame(pz, body.ZoneAt(Hit(Far + new Vector3(0, 1f, 0.6f), Vector3.back)), "甲片在胶囊外的部分：甲片");
            Assert.AreSame(pz, body.ZoneAt(Hit(Far + new Vector3(0, 1f, 0.42f), Vector3.back)), "甲片和胶囊重叠处：优先级高的甲片");
            Assert.AreSame(bz, body.ZoneAt(Hit(Far + new Vector3(0, 0.5f, 0.4f), Vector3.back, true)), "标了弱点却不在弱点区：按普通部位");
            Assert.IsNull(body.ZoneAt(Hit(Far + new Vector3(0, 1f, 0), Vector3.back, false, DamageSource.Status)), "持续伤害不算区");
            Assert.AreSame(bz, body.ZoneAt(Hit(Far + new Vector3(0.7f, 0.5f, 0), Vector3.left)), "容差外 0.5 m 内退而取最近的普通区");
            Assert.IsNull(body.ZoneAt(Hit(Far + new Vector3(3f, 0.5f, 0), Vector3.left)));
        }

        [Test]
        public void FacingGateLimitsArmourToTheFront()
        {
            var (_, _, _, pz) = Enemy();
            var front = Far + new Vector3(0, 1f, 0.6f);
            Assert.AreEqual(0.2f, pz.MultiplierFor(Hit(front, Vector3.back)), "从正面打来（飞行方向 −z）：甲片 ×0.2");
            Assert.AreEqual(1f, pz.MultiplierFor(Hit(front, Vector3.forward)), "从背后打来：门外按普通部位");
            Assert.AreEqual(1f, pz.MultiplierFor(Hit(front, Vector3.left)), "正侧面（cos 0 < 0.34）不算正面");
            Assert.AreEqual(1f, pz.MultiplierFor(Hit(front, Vector3.zero)), "方向退化：有门的不生效");
            pz.facing = ZoneFacing.Back;
            Assert.AreEqual(0.2f, pz.MultiplierFor(Hit(front, Vector3.forward)));
            pz.facing = ZoneFacing.Any;
            Assert.AreEqual(0.2f, pz.MultiplierFor(Hit(front, Vector3.left)));
        }

        [Test]
        public void HitboxWeakpointFollowsTheZone()
        {
            var (_, bz, wz, _) = Enemy();
            Assert.IsTrue(wz.Hitbox.weakpoint);
            Assert.IsFalse(bz.Hitbox.weakpoint);
            wz.SetWeakPoint(false);
            Assert.IsFalse(wz.Hitbox.weakpoint, "运行时关掉弱点");
            wz.Hitbox.weakpoint = true;
            Assert.IsTrue(wz.weakpoint, "旧写法（写 Hitbox.weakpoint）转给命中区");
            wz.SetActive(false);
            Assert.IsFalse(wz.Hitbox.weakpoint, "停用的区不算弱点");
            Assert.IsFalse(wz.Collider.enabled);
            wz.SetActive(true);
            Assert.IsTrue(wz.Hitbox.weakpoint);
        }

        [Test]
        public void RadiusScaleIsRelativeToCreation()
        {
            var (_, bz, wz, pz) = Enemy();
            wz.SetRadiusScale(2f);
            Assert.AreEqual(0.5f, ((SphereCollider)wz.Collider).radius, 1e-6f);
            wz.SetRadiusScale(0.5f);
            Assert.AreEqual(0.125f, ((SphereCollider)wz.Collider).radius, 1e-6f, "按创建时的尺寸，不累乘");
            bz.SetRadiusScale(1.5f);
            Assert.AreEqual(0.6f, ((CapsuleCollider)bz.Collider).radius, 1e-6f);
            Assert.AreEqual(3f, ((CapsuleCollider)bz.Collider).height, 1e-6f);
            pz.SetRadiusScale(2f);
            Assert.AreEqual(new Vector3(1.2f, 1.2f, 0.4f), ((BoxCollider)pz.Collider).size);
        }

        [Test]
        public void ZoneCountBreaksOnceAndRaisesEvents()
        {
            var (_, _, wz, _) = Enemy();
            wz.breakAt = 30;
            int broke = 0, hits = 0, global = 0;
            wz.Broke += _ => broke++;
            wz.Damaged += (_, _, _) => hits++;
            InAction<ZoneHitEvent> onZone = (in ZoneHitEvent e) =>
            {
                if (e.zone == wz) global++;
            };
            HitZone.ZoneDamaged += onZone;
            try
            {
                var info = Hit(Far + new Vector3(0, 2f, 0), Vector3.down, true);
                wz.Record(info, new DamageResult { total = 20 });
                Assert.AreEqual(0, broke);
                wz.Record(info, new DamageResult { total = 15 });
                Assert.AreEqual(1, broke, "累计 35 ≥ 30：碎一次");
                wz.Record(info, new DamageResult { total = 15 });
                Assert.AreEqual(1, broke, "碎过之后不再发，直到 ResetCount");
                Assert.AreEqual(50f, wz.damageTaken);
                Assert.AreEqual(3, hits);
                Assert.AreEqual(3, global, "全局 ZoneDamaged");
                wz.ResetCount();
                Assert.IsFalse(wz.Broken);
                Assert.AreEqual(0f, wz.damageTaken);
            }
            finally
            {
                HitZone.ZoneDamaged -= onZone;
            }
        }

        [Test]
        public void HitboxesBlockSightOnlyWhenMarked()
        {
            var wall = New("Wall");
            wall.transform.position = Far + new Vector3(10, 1, 0);
            wall.AddComponent<BoxCollider>().size = new Vector3(0.5f, 3, 3);
            var hb = wall.AddComponent<Hitbox>();
            Physics.SyncTransforms();
            var a = Far + new Vector3(5, 1, 0);
            var b = Far + new Vector3(15, 1, 0);
            Assert.IsFalse(Combat.Blocked(a, b, null), "命中盒默认不挡视线");
            hb.blocksSight = true;
            Assert.IsTrue(Combat.Blocked(a, b, null), "冰壁之类：挡视线");
            Assert.IsFalse(Combat.Blocked(a, b, wall.GetComponent<Collider>()), "目标自身不算遮挡");
        }
    }
}
