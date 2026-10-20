using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一档加成的倍率（伤害 / 攻速 / 移速 / 承伤；承伤 &lt; 1 = 减伤）</summary>
    [Serializable]
    public struct BuffMods
    {
        public float damage, rate, speed, taken;

        public BuffMods(float damage, float rate, float speed, float taken)
        {
            this.damage = damage;
            this.rate = rate;
            this.speed = speed;
            this.taken = taken;
        }

        public static readonly BuffMods Identity = new(1, 1, 1, 1);

        /// <summary>强度（同一通道多个来源时取最强的一个）：输出越高、承伤越低越强</summary>
        public float Strength => damage * rate * speed / Mathf.Max(0.01f, taken);

        public static BuffMods operator *(in BuffMods a, in BuffMods b) =>
            new(a.damage * b.damage, a.rate * b.rate, a.speed * b.speed, a.taken * b.taken);

        public bool IsIdentity => damage == 1 && rate == 1 && speed == 1 && taken == 1;

        public override string ToString() => $"伤害 ×{damage:0.##} 攻速 ×{rate:0.##} 移速 ×{speed:0.##} 承伤 ×{taken:0.##}";
    }

    /// <summary>能失效的加成来源（辅助怪）：死亡、被沉默（琴碎）时 BuffActive = false，它给出的加成立刻撤掉</summary>
    public interface IBuffSource
    {
        bool BuffActive { get; }
    }

    /// <summary>同一通道里多个来源怎么合：取最强的一个（光环、赐福：多个来源不叠加）/ 全部相乘</summary>
    public enum BuffStack { Strongest, Multiply }

    /// <summary>
    /// 一只敌人身上的加成登记（Three.js 版 src/enemies/SupportBuffs.ts 的 BuffRegistry，扩成多通道）：
    ///   通道：一种加成（邪飞天光环、邪飞天赐福、狐巫霜甲、傩面…），同一通道的多个来源按 <see cref="BuffStack"/> 合并（默认取最强、不叠加），
    ///         不同通道相乘——光环 × 赐福 = 伤害 1.35 × 1.6。
    ///   限时：每条来源带到期时间（光环由来源每 0.25 s 续一次，离开范围就撤；赐福 10 s）；来源死亡 / 销毁 / 被沉默（<see cref="IBuffSource"/>）时立刻失效。
    ///   结果写回敌人：<see cref="EnemyAI.auraDamage"/> / auraAttackRate / auraSpeed 与 <see cref="Damageable.damageTakenMult"/>（只在变化时写）。
    /// 由 <see cref="EnemyAI"/> 每帧 <see cref="Tick"/>；不分配内存（来源条目复用一张表）。
    /// </summary>
    public sealed class EnemyBuffs
    {
        /// <summary>邪飞天光环：16 m 内 伤害 / 攻速 ×1.35、移速 ×1.2、承伤 ×0.75（多只不叠加）</summary>
        public const string ApsaraAura = "apsara.aura";
        /// <summary>邪飞天赐福：伤害 ×1.6、攻速 ×1.5、移速 ×1.15、承伤 ×0.5，10 s（同一时间只认一个来源）</summary>
        public const string ApsaraBless = "apsara.bless";

        struct Entry
        {
            public string channel;
            public object source;
            public BuffMods mods;
            public float until;
        }

        static readonly Dictionary<string, BuffStack> stacking = new();

        /// <summary>声明一个通道的合并方式（不声明 = <see cref="BuffStack.Strongest"/>）</summary>
        public static void DefineChannel(string channel, BuffStack mode)
        {
            if (!string.IsNullOrEmpty(channel)) stacking[channel] = mode;
        }

        public static BuffStack StackingOf(string channel) => channel != null && stacking.TryGetValue(channel, out var m) ? m : BuffStack.Strongest;

        readonly List<Entry> entries = new();
        // 按通道合并时的临时表（通道 → 合并后的倍率）
        readonly List<(string channel, BuffMods mods, float best)> merge = new();

        /// <summary>当前合计（各通道相乘）</summary>
        public BuffMods Total { get; private set; } = BuffMods.Identity;
        /// <summary>合计变了（EnemyAI 据此写回字段）</summary>
        public event Action<BuffMods> Changed;
        /// <summary>某条来源结束了（到期、来源失效、被撤）：通道、来源。用于收起赐福金莲之类的提示</summary>
        public event Action<string, object> Ended;

        public int Count => entries.Count;

        /// <summary>登记 / 续期一条加成：同一通道同一来源只有一条（再登记就覆盖倍率与到期时间）。duration ≤ 0 或无穷 = 不限时</summary>
        public void Set(string channel, object source, in BuffMods mods, float duration = float.PositiveInfinity) =>
            SetUntil(channel, source, mods, duration > 0 && !float.IsPositiveInfinity(duration) ? Time.time + duration : float.PositiveInfinity);

        /// <summary>登记 / 续期一条加成，until 为 Time.time 的到期时刻</summary>
        public void SetUntil(string channel, object source, in BuffMods mods, float until)
        {
            if (string.IsNullOrEmpty(channel)) return;
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                if (e.channel != channel || !Equals(e.source, source)) continue;
                e.mods = mods;
                e.until = until;
                entries[i] = e;
                Recompute(Time.time);
                return;
            }
            entries.Add(new Entry { channel = channel, source = source, mods = mods, until = until });
            Recompute(Time.time);
        }

        /// <summary>撤掉一条（来源离开范围等）；返回是否有这条</summary>
        public bool Remove(string channel, object source)
        {
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                if (e.channel != channel || !Equals(e.source, source)) continue;
                entries.RemoveAt(i);
                Recompute(Time.time);
                RaiseEnded(e);
                return true;
            }
            return false;
        }

        /// <summary>撤掉某个来源给的全部加成（来源死亡 / 被沉默 / 被清理）；返回撤掉的条数</summary>
        public int RemoveSource(object source)
        {
            int n = 0;
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                var e = entries[i];
                if (!Equals(e.source, source)) continue;
                entries.RemoveAt(i);
                n++;
                RaiseEnded(e);
            }
            if (n > 0) Recompute(Time.time);
            return n;
        }

        /// <summary>撤掉一个通道的全部来源</summary>
        public int RemoveChannel(string channel)
        {
            int n = 0;
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                var e = entries[i];
                if (e.channel != channel) continue;
                entries.RemoveAt(i);
                n++;
                RaiseEnded(e);
            }
            if (n > 0) Recompute(Time.time);
            return n;
        }

        /// <summary>全部撤掉（死亡、复活）</summary>
        public void Clear()
        {
            if (entries.Count == 0) return;
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                var e = entries[i];
                entries.RemoveAt(i);
                RaiseEnded(e);
            }
            Recompute(Time.time);
        }

        /// <summary>这个通道现在有生效的加成（到期 / 来源失效的不算，即使还没 Tick 掉）</summary>
        public bool Has(string channel)
        {
            float now = Time.time;
            for (int i = 0; i < entries.Count; i++)
                if (entries[i].channel == channel && Valid(entries[i], now)) return true;
            return false;
        }

        /// <summary>这个来源在这个通道上有生效的加成</summary>
        public bool HasFrom(string channel, object source)
        {
            float now = Time.time;
            for (int i = 0; i < entries.Count; i++)
                if (entries[i].channel == channel && Equals(entries[i].source, source) && Valid(entries[i], now)) return true;
            return false;
        }

        /// <summary>这个通道当前起作用的来源（Strongest：最强的那个；没有为 null）</summary>
        public object SourceOf(string channel)
        {
            float now = Time.time, best = float.NegativeInfinity;
            object src = null;
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                if (e.channel != channel || !Valid(e, now)) continue;
                float s = e.mods.Strength;
                if (s > best)
                {
                    best = s;
                    src = e.source;
                }
            }
            return src;
        }

        /// <summary>这一条的到期时刻（没有这条为 −∞）</summary>
        public float Until(string channel, object source)
        {
            for (int i = 0; i < entries.Count; i++)
                if (entries[i].channel == channel && Equals(entries[i].source, source)) return entries[i].until;
            return float.NegativeInfinity;
        }

        /// <summary>清掉到期 / 来源失效的条目；有变化时重算合计。每帧调用，不分配</summary>
        public void Tick(float now)
        {
            bool changed = false;
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                var e = entries[i];
                if (Valid(e, now)) continue;
                entries.RemoveAt(i);
                changed = true;
                RaiseEnded(e);
            }
            if (changed) Recompute(now);
        }

        static bool Valid(in Entry e, float now) => now < e.until && SourceAlive(e.source);

        /// <summary>来源还能给加成：没有来源（环境、秘卷）总是有效；Unity 物体被销毁即失效；<see cref="IBuffSource"/> 看 BuffActive</summary>
        static bool SourceAlive(object s)
        {
            if (s == null) return true;
            if (s is UnityEngine.Object o && !o) return false;
            return s is not IBuffSource b || b.BuffActive;
        }

        void Recompute(float now)
        {
            merge.Clear();
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                if (!Valid(e, now)) continue;
                int at = -1;
                for (int j = 0; j < merge.Count; j++)
                    if (merge[j].channel == e.channel) { at = j; break; }
                if (at < 0)
                {
                    merge.Add((e.channel, e.mods, e.mods.Strength));
                    continue;
                }
                var m = merge[at];
                if (StackingOf(e.channel) == BuffStack.Multiply) m.mods = m.mods * e.mods;
                else if (e.mods.Strength > m.best)
                {
                    m.mods = e.mods;
                    m.best = e.mods.Strength;
                }
                merge[at] = m;
            }
            var total = BuffMods.Identity;
            for (int j = 0; j < merge.Count; j++) total = total * merge[j].mods;
            merge.Clear();
            if (total.damage == Total.damage && total.rate == Total.rate && total.speed == Total.speed && total.taken == Total.taken) return;
            Total = total;
            try
            {
                Changed?.Invoke(total);
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
            }
        }

        void RaiseEnded(in Entry e)
        {
            if (Ended == null) return;
            try
            {
                Ended(e.channel, e.source);
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
            }
        }
    }
}
