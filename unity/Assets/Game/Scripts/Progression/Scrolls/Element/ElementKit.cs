using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 元素秘卷（S2）的小工具（Three.js 版 defsElement.ts 的 trackStatus 等）：
    ///   · <see cref="Track"/>：敌人「带着某状态」的判定——此刻身上有 / 死亡瞬间身上有 / 在该状态的持续时间内被施加过
    ///     （雷殛叠满 3 层会被清空，持续时间当作「刚被雷殛」的宽限窗口）。记录放在模块级弱表里：秘卷叠层时作用域重建，已记的数据不丢，敌人回收后自动释放；
    ///   · <see cref="ApplyStatus"/>：秘卷直接挂元素（先判定反应再附着，同 TS combat.applyStatus）；
    ///   · <see cref="ForEachNear"/> / <see cref="NearestOther"/>：附近敌人（<see cref="ScrollKit"/> 同名函数的转发）。
    /// 测试钩子：<see cref="TestTargets"/>（代替场上敌人）、<see cref="TestApply"/>（记录附着而不走反应系统）——EditMode 没有 EnemyAI、也不该建反应系统物体。
    /// </summary>
    public static class ElementKit
    {
        /// <summary>测试用：设了就用这张表代替场上的敌人（附近查询按身体中心距离过滤）</summary>
        public static List<Damageable> TestTargets;

        /// <summary>测试用：设了就代替真实附着（目标, 元素, 状态强度, 深度）</summary>
        public static Action<Damageable, Element, float, int> TestApply;

        sealed class Stamp
        {
            public float at;
        }

        // 按状态（灼烧 / 雷殛 / 蚀化）分开的弱表：最近一次施加的秘卷时钟、致命一击结算时身上带着该状态
        static ConditionalWeakTable<Damageable, Stamp>[] lastApplied = NewApplied();
        static ConditionalWeakTable<Damageable, object>[] diedWith = NewDied();
        static readonly object Mark = new();

        static ConditionalWeakTable<Damageable, Stamp>[] NewApplied() =>
            new[] { new ConditionalWeakTable<Damageable, Stamp>(), new ConditionalWeakTable<Damageable, Stamp>(), new ConditionalWeakTable<Damageable, Stamp>() };

        static ConditionalWeakTable<Damageable, object>[] NewDied() =>
            new[] { new ConditionalWeakTable<Damageable, object>(), new ConditionalWeakTable<Damageable, object>(), new ConditionalWeakTable<Damageable, object>() };

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        public static void ResetStatics()
        {
            TestTargets = null;
            TestApply = null;
            lastApplied = NewApplied();
            diedWith = NewDied();
        }

        /// <summary>元素状态在弱表里的序号（不是元素状态为 −1）</summary>
        static int Slot(StatusId id) => id switch
        {
            StatusId.Burn => 0,
            StatusId.Shock => 1,
            StatusId.Corrode => 2,
            _ => -1,
        };

        /// <summary>各状态的持续时间（同 TS STATUS_DURATION：灼烧 4、雷殛 3、蚀化 5）</summary>
        public static float Duration(StatusId id) => id switch
        {
            StatusId.Burn => EnemyStatus.BurnDuration,
            StatusId.Shock => EnemyStatus.ShockDuration,
            StatusId.Corrode => EnemyStatus.CorrodeDuration,
            _ => 0,
        };

        /// <summary>
        /// 在作用域上登记状态跟踪（施加时间、致命一击时的状态快照），返回查询函数：
        /// 敌人此刻带着该状态 ∨ 死亡瞬间带着 ∨ 距上次施加不到该状态的持续时间。同 TS trackStatus
        /// </summary>
        public static Func<Damageable, bool> Track(ScrollScope s, StatusId id)
        {
            int slot = Slot(id);
            if (slot < 0) throw new ArgumentException($"{id} 不是元素状态", nameof(id));
            var element = EnemyStatus.ElementOf(id);
            var mask = (StatusMask)(1 << (int)id);
            float dur = Duration(id);
            s.OnStatusApplied((d, sid, _) =>
            {
                if (sid != id || !d) return;
                lastApplied[slot].GetOrCreateValue(d).at = ScrollTicker.Now;
            });
            s.OnEnemyDamaged((in HitEvent e) =>
            {
                if (e.result.killed && e.enemy && EnemyStatus.Has(e.enemy, element)) Remember(diedWith[slot], e.enemy);
            });
            return d =>
            {
                if (!d) return false;
                if (EnemyStatus.Has(d, element) || (EnemyStatus.DeathStatuses(d) & mask) != 0) return true;
                if (diedWith[slot].TryGetValue(d, out _)) return true;
                return lastApplied[slot].TryGetValue(d, out var st) && ScrollTicker.Now - st.at < dur;
            };
        }

        static void Remember(ConditionalWeakTable<Damageable, object> table, Damageable d)
        {
            if (!table.TryGetValue(d, out _)) table.Add(d, Mark);
        }

        /// <summary>
        /// 秘卷直接挂元素状态（不经过伤害）：先判定反应、再附着（<see cref="ReactionSystem.ApplyStatus"/>，同 TS combat.applyStatus）。
        /// power = 状态强度（不含元素 / 精英 / 首领加成），depth = 衍生深度（≥ 2 不再引发反应）。
        /// </summary>
        public static void ApplyStatus(Damageable target, Element element, float power, int depth = 0)
        {
            if (!target || target.Dead || target.untargetable || element == Element.None || !(power > 0)) return;
            if (TestApply != null)
            {
                TestApply(target, element, power, depth);
                return;
            }
            ReactionSystem.ApplyStatus(target, element, power, new StatusApplyOpts { depth = depth });
        }

        static bool Targetable(Damageable d) => d && !d.Dead && !d.untargetable;

        /// <summary>对 center 半径内所有活着、可选中的敌人（除 exclude）执行 fn；返回执行次数</summary>
        public static int ForEachNear(Vector3 center, float radius, Damageable exclude, Action<Damageable> fn)
        {
            if (TestTargets == null) return ScrollKit.ForEachNear(center, radius, exclude, fn);
            if (fn == null) return 0;
            float r2 = radius * radius;
            int n = 0;
            foreach (var d in TestTargets.ToArray())
            {
                if (d == exclude || !Targetable(d) || (ScrollKit.BodyCenter(d) - center).sqrMagnitude > r2) continue;
                fn(d);
                n++;
            }
            return n;
        }

        /// <summary>center 半径内离 center 最近、且不是 exclude 的活着的敌人；没有为 null</summary>
        public static Damageable NearestOther(Vector3 center, float radius, Damageable exclude)
        {
            if (TestTargets == null) return ScrollKit.NearestOther(center, radius, exclude);
            Damageable best = null;
            float bestD = radius * radius;
            foreach (var d in TestTargets)
            {
                if (d == exclude || !Targetable(d)) continue;
                float sq = (ScrollKit.BodyCenter(d) - center).sqrMagnitude;
                if (sq > bestD) continue;
                bestD = sq;
                best = d;
            }
            return best;
        }
    }
}
