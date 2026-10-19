using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 伤害乘区与 Three.js 版逐项一致（docs/unity-parity.md 7.2「契约」）。TS 源：src/combat/DamageCalc.ts、src/combat/Combat.ts、src/core/Stats.ts。
    ///   · 元素 × 层倍率表（LAYER_MULT）；
    ///   · 属性乘区（statMultiplier）：TS 函数逐行移植成 <see cref="Ts"/>，对「来源 × 标签 × 元素 × 级别」的全部组合比对；
    ///     另外钉住几条按标签算的结论：武器 / 武器爆炸 / 纯爆炸 / 技能 / 持续伤害 / 反应 / 灵宠各吃哪些加成；
    ///   · 持续伤害判定（isDot）、DoT 属性倍率、状态强度与反应强度的换算、处决阈值；
    ///   · 分层结算（applyLayers）：护盾 → 护甲 → 生命，打穿后按下一层倍率折算，含「对护盾 / 护甲伤害」；
    ///   · 暴击与弱点：critMult × (1 + 暴伤%)，弱点必暴；持续伤害、反应不暴击；noCrit 只关随机暴击；灵宠不随机暴击。
    ///     Unity 多一个「弱点伤害%」（秘卷「破绽」），值为 0 时与 TS 完全一致；
    ///   · Mult 下限 0.05（逐项取下限，不是乘完再取）。
    /// 纯逻辑，不需要场景。要「级别」和「分层」的用例建一个隐藏的 Damageable（EditMode 下 Awake 不跑，手动 ResetVitals），测完销毁。
    /// 用到 Combat.playerStats 这个静态量：每个用例前后存取还原。
    /// </summary>
    public sealed class DamageCalcParityTests
    {
        const float Eps = 1e-4f;

        GameObject host;
        Damageable target;
        StatSheet savedStats;

        [OneTimeSetUp]
        public void CreateTarget()
        {
            host = new GameObject("DamageCalcParityTests Target") { hideFlags = HideFlags.HideAndDontSave };
            target = host.AddComponent<Damageable>();
        }

        [OneTimeTearDown]
        public void DestroyTarget()
        {
            if (host) Object.DestroyImmediate(host);
        }

        [SetUp]
        public void SaveStatics()
        {
            savedStats = Combat.playerStats;
            Combat.playerStats = null;
            Reset(target, 0, 0, 100, Rank.Normal);
        }

        [TearDown]
        public void RestoreStatics() => Combat.playerStats = savedStats;

        static void Reset(Damageable d, float shield, float armor, float health, Rank rank)
        {
            d.maxShield = shield;
            d.maxArmor = armor;
            d.maxHealth = health;
            d.rank = rank;
            d.untargetable = false;
            d.damageTakenMult = 1;
            d.statusTakenMult = 1;
            d.ResetVitals();
        }

        /// <summary>每项取不同的值，乘错一项就能看出来</summary>
        static StatSheet Sheet()
        {
            var s = new StatSheet();
            s.Add("t", Stat.DamagePct, 0.3f);
            s.Add("t", Stat.SkillDamagePct, 0.5f);
            s.Add("t", Stat.ExplosionDamagePct, 0.7f);
            s.Add("t", Stat.ReactionDamagePct, 0.9f);
            s.Add("t", Stat.PetDamagePct, 0.31f);
            s.Add("t", Stat.ElementDamagePct, 0.11f);
            s.Add("t", Stat.FireDamagePct, 0.13f);
            s.Add("t", Stat.ShockDamagePct, 0.17f);
            s.Add("t", Stat.CorrodeDamagePct, 0.19f);
            s.Add("t", Stat.EliteDamagePct, 0.23f);
            s.Add("t", Stat.BossDamagePct, 0.29f);
            s.Add("t", Stat.ShieldDamagePct, 0.25f);
            s.Add("t", Stat.ArmorDamagePct, -0.3f);
            return s;
        }

        static readonly Element[] Elements = { Element.None, Element.Fire, Element.Shock, Element.Corrode };
        static readonly DamageLayer[] LayersAll = { DamageLayer.Shield, DamageLayer.Armor, DamageLayer.Health };

        // ───────────── Three.js 版（逐行移植，不要「顺手改对」：这里就是对照组）─────────────

        static class Ts
        {
            /// <summary>LAYER_MULT（DamageCalc.ts）：[元素][shield, armor, health]</summary>
            public static readonly Dictionary<Element, float[]> LayerMult = new()
            {
                [Element.None] = new[] { 1.0f, 0.75f, 1.0f },
                [Element.Fire] = new[] { 0.8f, 1.0f, 1.25f },
                [Element.Shock] = new[] { 1.6f, 0.8f, 1.0f },
                [Element.Corrode] = new[] { 1.0f, 1.6f, 1.0f },
            };

            /// <summary>Stats.mult：Math.max(0.05, 1 + get(key))</summary>
            public static float Mult(StatSheet s, Stat k) => Math.Max(0.05f, 1 + s.Get(k));

            static Stat ElementStat(Element e) => e switch
            {
                Element.Fire => Stat.FireDamagePct,
                Element.Shock => Stat.ShockDamagePct,
                _ => Stat.CorrodeDamagePct,
            };

            public static float StatMultiplier(StatSheet s, string source, ICollection<string> tags, Element element, bool elite, bool boss)
            {
                if (tags.Contains("reaction")) return Mult(s, Stat.ReactionDamagePct);
                float m = 1;
                if (source != "status")
                {
                    if (source == "weapon" || source == "melee" || tags.Contains("weapon")) m *= Mult(s, Stat.DamagePct);
                    if (source == "skill" || tags.Contains("skill")) m *= Mult(s, Stat.SkillDamagePct);
                    if (source == "explosion" || tags.Contains("explosion")) m *= Mult(s, Stat.ExplosionDamagePct);
                }
                if (element != Element.None) m *= Mult(s, Stat.ElementDamagePct) * Mult(s, ElementStat(element));
                if (elite) m *= Mult(s, Stat.EliteDamagePct);
                if (boss) m *= Mult(s, Stat.BossDamagePct);
                return m;
            }

            public static bool IsDot(string source, ICollection<string> tags) =>
                source == "status" && !tags.Contains("chain") && (!tags.Contains("reaction") || tags.Contains("dot"));

            public static float DotStatMultiplier(StatSheet s, bool elite, bool boss, Element element)
            {
                float m = 1;
                if (element != Element.None) m *= Mult(s, Stat.ElementDamagePct) * Mult(s, ElementStat(element));
                if (elite) m *= Mult(s, Stat.EliteDamagePct);
                if (boss) m *= Mult(s, Stat.BossDamagePct);
                return m > 0 && !float.IsInfinity(m) ? m : 1;
            }

            public static float StatusPowerFromDealt(StatSheet s, float maxHp, bool elite, bool boss, Element e, float dealt)
            {
                float p = Math.Min(Math.Max(0, dealt), maxHp * 0.5f) / DotStatMultiplier(s, elite, boss, e);
                return float.IsNaN(p) || float.IsInfinity(p) ? 0 : p;
            }

            public static float ReactionPowerFromStatus(StatSheet s, bool elite, bool boss, Element e, float power)
            {
                float p = power * DotStatMultiplier(s, elite, boss, e);
                return float.IsNaN(p) || float.IsInfinity(p) ? 0 : Math.Max(0, p);
            }

            public static float LayerMultiplier(StatSheet s, Element e, DamageLayer layer)
            {
                float m = LayerMult[e][(int)layer];
                if (s == null) return m;
                if (layer == DamageLayer.Shield) m *= Mult(s, Stat.ShieldDamagePct);
                else if (layer == DamageLayer.Armor) m *= Mult(s, Stat.ArmorDamagePct);
                return m;
            }

            public struct Layers
            {
                public float shield, armor, hp, dealt, effective;
                public DamageLayer first;
                public bool shieldBroken, armorBroken;
            }

            /// <summary>applyLayers（DamageCalc.ts），enemy 的三层由参数传入、结果带回</summary>
            public static Layers ApplyLayers(StatSheet s, float shield, float armor, float hp, float raw, Element element, bool skipShield)
            {
                var o = new Layers { shield = shield, armor = armor, hp = hp };
                o.first = skipShield ? (armor > 0 ? DamageLayer.Armor : DamageLayer.Health)
                    : shield > 0 ? DamageLayer.Shield : armor > 0 ? DamageLayer.Armor : DamageLayer.Health;
                float remaining = raw;
                if (remaining > 0 && o.shield > 0 && !skipShield)
                {
                    float m = LayerMultiplier(s, element, DamageLayer.Shield);
                    float eff = remaining * m, took;
                    if (eff >= o.shield)
                    {
                        took = o.shield;
                        o.shield = 0;
                        o.shieldBroken = true;
                        remaining -= took / m;
                    }
                    else
                    {
                        took = eff;
                        o.shield -= eff;
                        remaining = 0;
                    }
                    o.dealt += took;
                    o.effective += took;
                }
                if (remaining > 1e-6f && o.armor > 0)
                {
                    float m = LayerMultiplier(s, element, DamageLayer.Armor);
                    float eff = remaining * m, took;
                    if (eff >= o.armor)
                    {
                        took = o.armor;
                        o.armor = 0;
                        o.armorBroken = true;
                        remaining -= took / m;
                    }
                    else
                    {
                        took = eff;
                        o.armor -= eff;
                        remaining = 0;
                    }
                    o.dealt += took;
                    o.effective += took;
                }
                if (remaining > 1e-6f)
                {
                    float m = LayerMultiplier(s, element, DamageLayer.Health);
                    float eff = remaining * m;
                    float took = Math.Min(eff, Math.Max(0, o.hp));
                    o.hp = Math.Max(0, o.hp - eff);
                    o.dealt += took;
                    o.effective += eff;
                }
                return o;
            }

            /// <summary>Combat.damageEnemy 第 1–2 步：暴击后的倍率 = critMult（缺省 2）× mult(critDamagePct)</summary>
            public static float CritMult(StatSheet s, float critMult) => critMult * Mult(s, Stat.CritDamagePct);

            public const float ExecuteBase = 1e6f;
            public const float StatusPowerCap = 0.5f;
        }

        // ───────────── 层倍率 ─────────────

        [Test]
        public void LayerTableMatchesThreeJs()
        {
            foreach (var e in Elements)
            foreach (var l in LayersAll)
                Assert.AreEqual(Ts.LayerMult[e][(int)l], DamageTable.LayerMult(e, l), Eps, $"LAYER_MULT[{e}][{l}]");
        }

        [Test]
        public void LayerMultiplierAppliesShieldAndArmorStats()
        {
            foreach (var stats in new[] { null, Sheet() })
            {
                Combat.playerStats = stats;
                foreach (var e in Elements)
                foreach (var l in LayersAll)
                    Assert.AreEqual(Ts.LayerMultiplier(stats, e, l), DamageCalc.LayerMultiplier(e, l), Eps, $"layerMultiplier({e}, {l})，属性表 {(stats == null ? "无" : "有")}");
            }
        }

        // ───────────── 属性乘区 ─────────────

        static readonly (DamageSource unity, string ts)[] Sources =
        {
            (DamageSource.Weapon, "weapon"), (DamageSource.Skill, "skill"), (DamageSource.Explosion, "explosion"),
            (DamageSource.Status, "status"), (DamageSource.Environment, "scroll"), // TS 的 scroll 来源：不吃任何来源加成
        };

        static readonly (DamageTag unity, string ts)[] TagMap =
        {
            (DamageTag.Weapon, "weapon"), (DamageTag.Skill, "skill"), (DamageTag.Explosion, "explosion"),
            (DamageTag.Reaction, "reaction"), (DamageTag.Dot, "dot"), (DamageTag.Chain, "chain"),
        };

        [Test]
        public void StatMultiplierMatchesThreeJsForAllCombinations()
        {
            var s = Sheet();
            int cases = 0;
            foreach (var (src, tsSrc) in Sources)
            for (int mask = 0; mask < 1 << TagMap.Length; mask++)
            foreach (var e in Elements)
            foreach (var rank in new[] { Rank.Normal, Rank.Elite, Rank.Boss })
            {
                var tags = DamageTag.None;
                var tsTags = new List<string>();
                for (int i = 0; i < TagMap.Length; i++)
                    if ((mask & (1 << i)) != 0)
                    {
                        tags |= TagMap[i].unity;
                        tsTags.Add(TagMap[i].ts);
                    }
                Reset(target, 0, 0, 100, rank);
                var info = new DamageInfo { amount = 100, source = src, tags = tags, element = e };
                float unity = DamageCalc.StatMultiplier(s, info, target);
                float ts = Ts.StatMultiplier(s, tsSrc, tsTags, e, rank == Rank.Elite, rank == Rank.Boss);
                Assert.AreEqual(ts, unity, Eps * ts, $"来源 {src} 标签 {tags} 元素 {e} 级别 {rank}");
                cases++;
            }
            Assert.AreEqual(Sources.Length * (1 << TagMap.Length) * Elements.Length * 3, cases);
        }

        [Test]
        public void ReactionFlagEqualsReactionTag()
        {
            var s = Sheet();
            foreach (var e in Elements)
            {
                var byFlag = new DamageInfo { source = DamageSource.Status, element = e, reaction = true };
                var byTag = new DamageInfo { source = DamageSource.Status, element = e, tags = DamageTag.Reaction };
                Assert.AreEqual(s.Mult(Stat.ReactionDamagePct), DamageCalc.StatMultiplier(s, byFlag, null), Eps, "reaction 字段 = Reaction 标签：只吃反应伤害");
                Assert.AreEqual(DamageCalc.StatMultiplier(s, byTag, null), DamageCalc.StatMultiplier(s, byFlag, null), Eps);
            }
        }

        [Test]
        public void TagDrivenStatMultipliers()
        {
            var s = Sheet();
            float dmg = s.Mult(Stat.DamagePct), skill = s.Mult(Stat.SkillDamagePct), blast = s.Mult(Stat.ExplosionDamagePct);
            float fire = s.Mult(Stat.ElementDamagePct) * s.Mult(Stat.FireDamagePct);
            float M(DamageSource src, DamageTag tags = DamageTag.None, Element e = Element.None, Damageable t = null) =>
                DamageCalc.StatMultiplier(s, new DamageInfo { source = src, tags = tags, element = e }, t);

            Assert.AreEqual(dmg, M(DamageSource.Weapon), Eps, "武器直接命中：只吃伤害%");
            Assert.AreEqual(dmg, M(DamageSource.Weapon, DamageTag.Melee), Eps, "近战（碎刃）同样只吃伤害%（TS source 'melee'）");
            Assert.AreEqual(Ts.StatMultiplier(s, "melee", new List<string>(), Element.None, false, false), M(DamageSource.Environment, DamageTag.Melee), Eps,
                "只带 Melee 标签 = TS 的 melee 来源");
            Assert.AreEqual(dmg * blast, M(DamageSource.Explosion, DamageTag.Weapon), Eps, "武器投射物的爆炸：伤害% 和爆炸伤害% 都吃");
            Assert.AreEqual(dmg * blast, M(DamageSource.Weapon, DamageTag.Explosion), Eps, "（来源 / 标签两种写法等价）");
            Assert.AreEqual(blast, M(DamageSource.Explosion), Eps, "纯爆炸（反应余波以外的环境爆炸）：只吃爆炸伤害%");
            Assert.AreEqual(skill, M(DamageSource.Skill), Eps, "技能：只吃技能伤害%");
            Assert.AreEqual(skill * blast, M(DamageSource.Skill, DamageTag.Explosion), Eps, "技能爆炸：技能% × 爆炸%");
            Assert.AreEqual(1f, M(DamageSource.Status, DamageTag.Dot), Eps, "无元素的持续伤害：不吃任何来源加成");
            Assert.AreEqual(1f, M(DamageSource.Status, DamageTag.Weapon | DamageTag.Skill | DamageTag.Explosion), Eps, "Status 来源连标签也不认");
            Assert.AreEqual(fire, M(DamageSource.Status, DamageTag.Dot, Element.Fire), Eps, "灼烧跳伤：只吃元素% × 火焰%");
            Assert.AreEqual(dmg * fire, M(DamageSource.Weapon, DamageTag.None, Element.Fire), Eps, "火属性武器：伤害% × 元素% × 火焰%");
            Assert.AreEqual(s.Mult(Stat.ReactionDamagePct), M(DamageSource.Status, DamageTag.Reaction | DamageTag.Weapon, Element.Fire), Eps,
                "反应伤害：只吃反应伤害%（Pin 已含其他加成）");
            Assert.AreEqual(s.Mult(Stat.PetDamagePct), M(DamageSource.Pet), Eps, "灵宠：只吃灵宠伤害%");
            Assert.AreEqual(s.Mult(Stat.PetDamagePct), M(DamageSource.Pet, DamageTag.Weapon | DamageTag.Explosion), Eps, "灵宠不吃武器 / 爆炸伤害%");
            Assert.AreEqual(s.Mult(Stat.PetDamagePct) * fire, M(DamageSource.Pet, DamageTag.None, Element.Fire), Eps, "灵宠的元素攻击照吃元素加成");

            Reset(target, 0, 0, 100, Rank.Elite);
            Assert.AreEqual(dmg * s.Mult(Stat.EliteDamagePct), M(DamageSource.Weapon, DamageTag.None, Element.None, target), Eps, "精英 × 精英伤害%");
            Reset(target, 0, 0, 100, Rank.Boss);
            Assert.AreEqual(dmg * s.Mult(Stat.BossDamagePct), M(DamageSource.Weapon, DamageTag.None, Element.None, target), Eps, "首领 × 首领伤害%");
            Assert.AreEqual(s.Mult(Stat.ReactionDamagePct), M(DamageSource.Status, DamageTag.Reaction, Element.Shock, target), Eps, "反应打首领也不再乘首领伤害%");
        }

        [Test]
        public void NoStatsMeansNoMultiplier()
        {
            Assert.AreEqual(1f, DamageCalc.StatMultiplier(null, new DamageInfo { source = DamageSource.Weapon, element = Element.Fire }, null), Eps);
            Assert.AreEqual(1f, DamageCalc.DotStatMultiplier(null, null, Element.Fire), Eps);
        }

        [Test]
        public void MultFloorIsPerStat()
        {
            Assert.AreEqual(0.05f, StatSheet.MinMult, 1e-7f, "Stats.mult 下限 0.05（TS Stats.ts）");
            var s = new StatSheet();
            s.Add("debuff", Stat.DamagePct, -3f);
            s.Add("debuff", Stat.ExplosionDamagePct, -0.99f);
            Assert.AreEqual(0.05f, s.Mult(Stat.DamagePct), 1e-6f, "1 + (−3) 钳到 0.05");
            Assert.AreEqual(0.05f, s.Mult(Stat.ExplosionDamagePct), 1e-6f, "1 − 0.99 = 0.01 也钳到 0.05");
            Assert.AreEqual(Ts.Mult(s, Stat.DamagePct), s.Mult(Stat.DamagePct), 1e-6f);
            var info = new DamageInfo { source = DamageSource.Explosion, tags = DamageTag.Weapon };
            Assert.AreEqual(0.05f * 0.05f, DamageCalc.StatMultiplier(s, info, null), 1e-6f, "每一项各自取下限，再相乘（不是乘完再钳）");
            Assert.AreEqual(Ts.StatMultiplier(s, "explosion", new[] { "weapon" }, Element.None, false, false), DamageCalc.StatMultiplier(s, info, null), 1e-6f);
            s.Add("buff", Stat.DamagePct, 5f);
            Assert.AreEqual(3f, s.Mult(Stat.DamagePct), 1e-5f, "正加成不封顶：1 + (−3 + 5)");
        }

        // ───────────── 持续伤害、状态强度、处决 ─────────────

        [Test]
        public void IsDotMatchesThreeJs()
        {
            foreach (var (src, tsSrc) in Sources)
            for (int mask = 0; mask < 1 << TagMap.Length; mask++)
            {
                var tags = DamageTag.None;
                var tsTags = new List<string>();
                for (int i = 0; i < TagMap.Length; i++)
                    if ((mask & (1 << i)) != 0)
                    {
                        tags |= TagMap[i].unity;
                        tsTags.Add(TagMap[i].ts);
                    }
                var info = new DamageInfo { source = src, tags = tags };
                Assert.AreEqual(Ts.IsDot(tsSrc, tsTags), DamageCalc.IsDot(info), $"isDot：来源 {src} 标签 {tags}");
            }
        }

        [Test]
        public void DotAndStatusPowerMatchThreeJs()
        {
            var s = Sheet();
            Combat.playerStats = s;
            foreach (var rank in new[] { Rank.Normal, Rank.Elite, Rank.Boss })
            foreach (var e in Elements)
            {
                Reset(target, 0, 0, 400, rank);
                bool elite = rank == Rank.Elite, boss = rank == Rank.Boss;
                Assert.AreEqual(Ts.DotStatMultiplier(s, elite, boss, e), DamageCalc.DotStatMultiplier(s, target, e), Eps, $"dotStatMultiplier {rank} {e}");
                foreach (var dealt in new[] { 0f, 35f, 150f, 199f, 200f, 260f, 5000f, -10f })
                {
                    Assert.AreEqual(Ts.StatusPowerFromDealt(s, 400, elite, boss, e, dealt), DamageCalc.StatusPowerFromDealt(target, e, dealt), Eps,
                        $"statusPowerFromDealt {rank} {e} dealt={dealt}（上限最大生命 × {Ts.StatusPowerCap}）");
                    Assert.AreEqual(Ts.ReactionPowerFromStatus(s, elite, boss, e, dealt), DamageCalc.ReactionPowerFromStatus(target, e, dealt), Eps,
                        $"reactionPowerFromStatus {rank} {e} power={dealt}");
                }
                // 附着时除掉、每跳乘回：同一份加成只算一次
                float power = DamageCalc.StatusPowerFromDealt(target, e, 120);
                Assert.AreEqual(Mathf.Min(120, 200), power * DamageCalc.DotStatMultiplier(target, e), 1e-3f, $"除掉再乘回 = 原伤害（{rank} {e}）");
            }
        }

        [Test]
        public void ExecuteThresholdMatchesThreeJs()
        {
            Assert.AreEqual(Ts.ExecuteBase, DamageCalc.ExecuteBase);
            Assert.IsTrue(DamageCalc.IsExecute(new DamageInfo { amount = 1e6f }));
            Assert.IsFalse(DamageCalc.IsExecute(new DamageInfo { amount = 999999f }));
            Assert.IsTrue(DamageCalc.IsExecute(new DamageInfo { amount = 1, tags = DamageTag.Purge }), "带 Purge 一律算处决");
            Assert.IsTrue(DamageCalc.IsExecute(new DamageInfo { amount = float.NaN }), "!(base < EXECUTE_BASE)：NaN 也算处决（同 TS）");
        }

        // ───────────── 分层结算 ─────────────

        [Test]
        public void ApplyLayersMatchesThreeJs()
        {
            var pools = new (float shield, float armor, float hp)[] { (0, 0, 100), (50, 0, 100), (0, 50, 100), (50, 50, 100), (30, 40, 20), (200, 0, 50) };
            var raws = new[] { 10f, 45f, 62.5f, 80f, 200f, 1000f };
            int cases = 0;
            foreach (var stats in new[] { null, Sheet() })
            {
                Combat.playerStats = stats;
                foreach (var (sh, ar, hp) in pools)
                foreach (var raw in raws)
                foreach (var e in Elements)
                foreach (bool skip in new[] { false, true })
                {
                    Reset(target, sh, ar, hp, Rank.Normal);
                    var info = new DamageInfo { amount = raw, source = DamageSource.Weapon, element = e, bypassShield = skip };
                    var r = target.ApplyLayers(info, raw, false);
                    var ts = Ts.ApplyLayers(stats, sh, ar, hp, raw, e, skip);
                    string at = $"盾 {sh} 甲 {ar} 血 {hp}，层前 {raw}，{e}，跳过护盾 {skip}，属性表 {(stats == null ? "无" : "有")}";
                    Assert.AreEqual(ts.dealt, r.total, 1e-3f, $"实际扣除：{at}");
                    Assert.AreEqual(ts.effective, r.effective, 1e-3f, $"展示总量（含溢出）：{at}");
                    Assert.AreEqual(ts.first, r.firstLayer, $"最先打到的层：{at}");
                    Assert.AreEqual(ts.shieldBroken, r.shieldBroken, $"破盾：{at}");
                    Assert.AreEqual(ts.armorBroken, r.armorBroken, $"破甲：{at}");
                    Assert.AreEqual(ts.shield, target.shield, 1e-3f, $"剩余护盾：{at}");
                    Assert.AreEqual(ts.armor, target.armor, 1e-3f, $"剩余护甲：{at}");
                    Assert.AreEqual(ts.hp, target.health, 1e-3f, $"剩余生命：{at}");
                    Assert.AreEqual(ts.hp <= 0, r.killed, $"击杀：{at}");
                    cases++;
                }
            }
            Assert.Greater(cases, 500);
        }

        // ───────────── 暴击与弱点（走 Combat.DamageEnemy）─────────────

        /// <summary>只有生命层、血很厚（不会死）；修饰器列表必须是空的，否则结果不可预期</summary>
        float Hit(DamageInfo info)
        {
            Assume.That(Combat.Outgoing.Count, Is.EqualTo(0), "Combat.Outgoing 里残留了修饰器（上一次 Play 没清？）");
            Assume.That(Combat.ForceWeakpoint.Count, Is.EqualTo(0), "Combat.ForceWeakpoint 里残留了判定");
            Reset(target, 0, 0, 1e7f, Rank.Normal);
            var r = Combat.DamageEnemy(target, info);
            lastCrit = r.crit;
            return r.total;
        }

        bool lastCrit;

        static DamageInfo Shot(float amount, DamageSource src = DamageSource.Weapon) => new()
        {
            amount = amount, source = src, point = Vector3.zero, direction = Vector3.forward,
        };

        [Test]
        public void WeakpointForcesCritWithCritMultAndCritDamage()
        {
            var s = new StatSheet();
            s.Add("t", Stat.DamagePct, 0.2f);
            s.Add("t", Stat.CritDamagePct, 0.5f);
            Combat.playerStats = s;
            float statMult = Ts.StatMultiplier(s, "weapon", new List<string>(), Element.None, false, false);

            var head = Shot(100);
            head.weakpoint = true;
            head.noCrit = true; // 弱点照样暴击
            head.critMult = 2.5f;
            Assert.AreEqual(100 * statMult * Ts.CritMult(s, 2.5f), Hit(head), 1e-2f, "爆头 = 基础 × 伤害% × critMult × (1 + 暴伤%)（TS headshot）");
            Assert.IsTrue(lastCrit, "命中弱点必定暴击");

            s.Add("scroll", Stat.WeakpointDamagePct, 0.15f);
            Assert.AreEqual(100 * statMult * Ts.CritMult(s, 2.5f) * 1.15f, Hit(head), 1e-2f, "Unity 另乘弱点伤害%（秘卷「破绽」）");
            s.Remove("scroll");

            var forced = Shot(100);
            forced.forceCrit = true; // critMult 没写（0）= 缺省 2
            Assert.AreEqual(100 * statMult * Ts.CritMult(s, 2f), Hit(forced), 1e-2f, "强制暴击、critMult 缺省 2");
            Assert.IsTrue(lastCrit);
        }

        [Test]
        public void CritRules()
        {
            var s = new StatSheet();
            s.Add("t", Stat.CritChance, 2f); // 必定掷中（Random.value 可能等于 1，所以不用 1）
            s.Add("t", Stat.CritDamagePct, 0.5f);
            s.Add("t", Stat.ReactionDamagePct, 0.4f);
            s.Add("t", Stat.PetDamagePct, 0.1f);
            Combat.playerStats = s;

            Assert.AreEqual(100 * 2 * 1.5f, Hit(Shot(100)), 1e-2f, "随机暴击：critMult 2 × (1 + 50%)");
            Assert.IsTrue(lastCrit);

            var noCrit = Shot(100);
            noCrit.noCrit = true;
            Assert.AreEqual(100f, Hit(noCrit), 1e-2f, "noCrit（TS canCrit = false）关掉随机暴击");
            Assert.IsFalse(lastCrit);

            var dot = Shot(100, DamageSource.Status);
            dot.weakpoint = true;
            dot.forceCrit = true;
            Assert.AreEqual(100f, Hit(dot), 1e-2f, "持续伤害（status）不暴击，弱点 / 强制暴击也不行");
            Assert.IsFalse(lastCrit);

            var rx = Shot(100, DamageSource.Status);
            rx.reaction = true;
            rx.forceCrit = true;
            Assert.AreEqual(100 * 1.4f, Hit(rx), 1e-2f, "反应伤害不暴击，只吃反应伤害%");
            Assert.IsFalse(lastCrit);

            Assert.AreEqual(100 * 1.1f, Hit(Shot(100, DamageSource.Pet)), 1e-2f, "灵宠不随机暴击（docs/pet-system.md）");
            Assert.IsFalse(lastCrit);
        }
    }
}
