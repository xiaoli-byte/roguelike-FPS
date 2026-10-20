using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 反应秘卷共用的判定与小工具（Three.js 版 src/progression/scrolls/defsReaction.ts 顶部的私有辅助）：
    ///   武器 / 技能请求判定、身上元素状态种数、命中伤害 → 状态强度、按反应标签增伤、逐敌到期时刻。
    /// 与外界的交互（挂元素、引爆、强制反应、范围查询、爆炸、投射物、护盾、冷却）一律经 <see cref="TacticsKit.Host"/>，
    /// 对敌人的直接伤害走 <see cref="Combat.DamageEnemy"/>。
    /// 深度约定同 TS：武器 / 技能命中直接引出的附着沿用该击的深度（通常为 0，算「直接反应」，流派终卷对它们生效）；
    /// 由反应衍生的附着为深度 1，最多再连锁一级。
    /// </summary>
    public static class ReactionScrollKit
    {
        /// <summary>三种元素（灼烧 / 雷殛 / 蚀化 的来源），按 TS ELEM 的顺序</summary>
        public static readonly Element[] Trio = { Element.Fire, Element.Shock, Element.Corrode };

        /// <summary>
        /// 玩家武器伤害（同 TS isWeaponReq）：带 weaponUid，且是武器 / 近战来源或带武器标签（武器投射物的爆炸）；反应伤害不算
        /// </summary>
        public static bool IsWeaponReq(in DamageInfo i) =>
            i.weaponUid != 0 && (DamageCalc.EffectiveTags(i) & DamageTag.Weapon) != 0 && !DamageCalc.IsReaction(i);

        /// <summary>技能伤害（同 TS isSkillReq）：来源 Skill 或带技能标签（技能投射物的爆炸）；反应伤害不算</summary>
        public static bool IsSkillReq(in DamageInfo i) => (DamageCalc.EffectiveTags(i) & DamageTag.Skill) != 0 && !DamageCalc.IsReaction(i);

        /// <summary>敌人身上 灼烧 / 雷殛 / 蚀化 的种数（经接缝 <see cref="IScrollHost.HasStatus"/> 读）</summary>
        public static int StatusCount(IScrollHost h, Damageable d)
        {
            if (h == null || !d) return 0;
            int n = 0;
            for (int i = 0; i < Trio.Length; i++)
                if (h.HasStatus(d, Trio[i])) n++;
            return n;
        }

        /// <summary>按 灼烧 → 雷殛 → 蚀化 的顺序，第一个身上没有的元素；三种都有为 None</summary>
        public static Element FirstMissing(IScrollHost h, Damageable d)
        {
            for (int i = 0; i < Trio.Length; i++)
                if (!h.HasStatus(d, Trio[i])) return Trio[i];
            return Element.None;
        }

        /// <summary>
        /// 命中 / 反应伤害（已含元素 / 精英 / 首领加成）→ 挂元素的状态强度（同 TS asStatusPower）：
        /// 钳到最大生命 × 0.5 再除掉每一跳会乘回的属性倍率，同一份加成只算一次（引发的反应强度由 ApplyStatus 乘回）
        /// </summary>
        public static float StatusPower(Damageable d, Element e, float dealt) => DamageCalc.StatusPowerFromDealt(d, e, dealt);

        /// <summary>某种反应的伤害标签（不含通用的 Reaction）</summary>
        public static DamageTag TagOf(Reaction r) => r switch
        {
            Reaction.Thunderfire => DamageTag.Thunderfire,
            Reaction.Meltdown => DamageTag.Meltdown,
            Reaction.Veinseal => DamageTag.Veinseal,
            _ => DamageTag.Abyss,
        };

        /// <summary>带某反应标签的伤害 × mult（同 TS boostReaction）：含该反应的中心伤害、余波、熔池跳伤、强制引发的同种反应</summary>
        public static IDisposable Boost(ScrollScope s, Reaction r, float mult)
        {
            var tag = TagOf(r);
            return s.AddOutgoing((in HitContext c) => c.info.Has(tag) ? mult : 1f);
        }

        /// <summary>反应名（焚雷 / 熔金 / 封脉 / 归墟）</summary>
        public static string Name(Reaction r) => CombatTuning.ReactionNames[(int)r];

        /// <summary>元素状态名（灼烧 / 雷殛 / 蚀化）</summary>
        public static string StatusName(Element e) => e switch
        {
            Element.Fire => "灼烧",
            Element.Shock => "雷殛",
            Element.Corrode => "蚀化",
            _ => "无",
        };

        /// <summary>敌人的水平半径（碰撞体包围盒，没有碰撞体按 0.5）：火星的出生点推到身体之外</summary>
        public static float Radius(Damageable d)
        {
            if (!d) return 0;
            var c = d.GetComponent<Collider>();
            if (!c || !c.enabled) return 0.5f;
            var e = c.bounds.extents;
            return Mathf.Max(e.x, e.z);
        }

        /// <summary>半径内的敌人拷成数组（伤害 / 挂元素前先定名单：回调里可能改动敌人表或复用缓冲）</summary>
        public static Damageable[] NearArray(IScrollHost h, Vector3 center, float radius, Damageable exclude, List<Damageable> buffer)
        {
            if (h == null || buffer == null) return Array.Empty<Damageable>();
            h.Near(center, radius, exclude, buffer);
            var a = buffer.ToArray();
            buffer.Clear();
            return a;
        }
    }

    /// <summary>
    /// 逐敌到期时刻（锁灵、镇岳的首领易伤）：同 TS 的 WeakMap + 「最晚到期」捷径——全场都过期时不查表。
    /// 敌人销毁 / 到期的条目在表变大时顺手清掉。
    /// </summary>
    public sealed class EnemyTimers
    {
        readonly Dictionary<Damageable, float> until = new();
        readonly List<Damageable> stale = new();
        float latest = float.NegativeInfinity;

        public int Count => until.Count;

        /// <summary>记下 d 的到期时刻 t（覆盖旧值）</summary>
        public void Set(Damageable d, float t)
        {
            if (!d) return;
            if (until.Count > 64) Prune(ScrollTicker.Now);
            until[d] = t;
            if (t > latest) latest = t;
        }

        /// <summary>d 此刻（now）还没到期</summary>
        public bool Active(Damageable d, float now) => now < latest && d && until.TryGetValue(d, out var t) && now < t;

        public void Clear()
        {
            until.Clear();
            latest = float.NegativeInfinity;
        }

        void Prune(float now)
        {
            foreach (var kv in until)
                if (!kv.Key || kv.Value <= now) stale.Add(kv.Key);
            foreach (var k in stale) until.Remove(k);
            stale.Clear();
        }
    }
}
