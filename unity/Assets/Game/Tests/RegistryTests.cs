using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 内容注册表的契约（docs/unity-parity.md 4.3、7.2）：第 0 批迁完后武器 6、敌人 7、秘卷 16、英雄 1；id 非空、唯一（大小写不同也算重复）；
    /// 按 id 取得到的就是 All 里那一条；每条定义能被生成器直接用（武器有 Prefab id，敌人有 Prefab 和 AI 类型，英雄的初始武器已登记）。
    /// <b>加内容的单元</b>（武器 WC、敌人 EN、秘卷 S1–S7、英雄 HC）在 <see cref="Expected"/> 里同步改数量，提交说明里写一句。
    /// </summary>
    public sealed class RegistryTests
    {
        /// <summary>各注册表应有的条数（W0 契约）</summary>
        static readonly Dictionary<Type, int> Expected = new()
        {
            [typeof(WeaponDef)] = 6,
            [typeof(EnemyDef)] = 7,
            [typeof(ScrollDef)] = 119, // 16 + S1 攻击 18 + S2 元素 10 + S3/S4 功能 · 传说 · 英雄 31 + S5 反应 24 + S6 战术 20（TS 118 + 破绽）
            [typeof(HeroDef)] = 3,
        };

        static IReadOnlyList<IDef> All(Type t) =>
            t == typeof(WeaponDef) ? Registry<WeaponDef>.All
            : t == typeof(EnemyDef) ? Registry<EnemyDef>.All
            : t == typeof(ScrollDef) ? Registry<ScrollDef>.All
            : t == typeof(HeroDef) ? (IReadOnlyList<IDef>)Registry<HeroDef>.All
            : throw new ArgumentException(t.Name);

        static IDef Get(Type t, string id) =>
            t == typeof(WeaponDef) ? (IDef)Registry<WeaponDef>.Get(id)
            : t == typeof(EnemyDef) ? (IDef)Registry<EnemyDef>.Get(id)
            : t == typeof(ScrollDef) ? (IDef)Registry<ScrollDef>.Get(id)
            : t == typeof(HeroDef) ? (IDef)Registry<HeroDef>.Get(id)
            : throw new ArgumentException(t.Name);

        static IEnumerable<Type> Kinds => Expected.Keys;

        [TestCaseSource(nameof(Kinds))]
        public void Count(Type kind)
        {
            var all = All(kind);
            Assert.AreEqual(Expected[kind], all.Count, $"{kind.Name} 注册了 {all.Count} 条：{string.Join("、", all.Select(d => d.Id))}");
        }

        [TestCaseSource(nameof(Kinds))]
        public void IdsAreNonEmptyAndUnique(Type kind)
        {
            var ids = All(kind).Select(d => d.Id).ToList();
            foreach (var id in ids) Assert.IsFalse(string.IsNullOrWhiteSpace(id), $"{kind.Name} 有空 id");
            var dup = ids.GroupBy(i => i, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            Assert.IsEmpty(dup, $"{kind.Name} 的 id 重复（不区分大小写）：{string.Join("、", dup)}");
            foreach (var id in ids) Assert.AreEqual(id.Trim(), id, $"{kind.Name} 的 id「{id}」首尾有空白");
        }

        [TestCaseSource(nameof(Kinds))]
        public void GetReturnsTheListedDef(Type kind)
        {
            foreach (var def in All(kind)) Assert.AreSame(def, Get(kind, def.Id), $"{kind.Name}.Get(\"{def.Id}\")");
            Assert.IsNull(Get(kind, null));
            Assert.IsNull(Get(kind, ""));
            Assert.IsNull(Get(kind, "__no_such_def__"));
        }

        [Test]
        public void EveryWeaponHasPrefabAndName()
        {
            foreach (var w in Registry<WeaponDef>.All)
            {
                Assert.IsFalse(string.IsNullOrWhiteSpace(w.prefab), $"武器 {w.id} 没有 prefab id（第一人称 rig 和地上的枪都靠它）");
                Assert.IsFalse(string.IsNullOrWhiteSpace(w.name), $"武器 {w.id} 没有显示名");
            }
        }

        [Test]
        public void EveryEnemyCanBeSpawned()
        {
            foreach (var e in Registry<EnemyDef>.All)
            {
                Assert.IsFalse(string.IsNullOrWhiteSpace(e.prefab), $"敌人 {e.id} 没有 prefab id");
                Assert.IsFalse(string.IsNullOrWhiteSpace(e.name), $"敌人 {e.id} 没有显示名");
                Assert.IsNotNull(e.ai, $"敌人 {e.id} 没有 AI 类型");
                Assert.IsTrue(typeof(EnemyAI).IsAssignableFrom(e.ai) && !e.ai.IsAbstract, $"敌人 {e.id} 的 AI {e.ai} 不是可实例化的 EnemyAI");
                Assert.Greater(e.hp, 0, $"敌人 {e.id} 生命 ≤ 0");
                Assert.Greater(e.scale, 0, $"敌人 {e.id} 体型倍率 ≤ 0");
            }
        }

        [Test]
        public void HeroStartWeaponsAreRegistered()
        {
            foreach (var h in Registry<HeroDef>.All)
                Assert.IsNotNull(Registry<WeaponDef>.Get(h.startWeapon), $"英雄 {h.id} 的初始武器 {h.startWeapon} 没有登记");
            Assert.IsNotNull(Registry<HeroDef>.Get("fox"), "燎（fox）没有登记：PlayerRigBuilder.Liao 取不到");
        }

        [Test]
        public void ScrollRaritiesAndStacksAreSane()
        {
            foreach (var s in Registry<ScrollDef>.All)
            {
                Assert.That(s.rarity, Is.InRange(0, Rarity.Names.Length - 1), $"秘卷 {s.id} 稀有度 {s.rarity}");
                Assert.GreaterOrEqual(s.maxStacks, 1, $"秘卷 {s.id} 最大层数 {s.maxStacks}");
                Assert.IsFalse(string.IsNullOrWhiteSpace(s.name), $"秘卷 {s.id} 没有名字");
            }
        }
    }
}
