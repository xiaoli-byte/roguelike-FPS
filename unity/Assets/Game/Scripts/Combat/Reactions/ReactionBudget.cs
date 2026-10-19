using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 每帧限额（反应接受数、大特效、浮字）：帧号变了就清零。帧号由调用方传入（运行时 Time.frameCount，测试里手动推进）。
    /// Peak 记录历史上单帧用量的最大值（调试叠层核对「应 ≤ 限额」）。
    /// </summary>
    public sealed class FrameBudget
    {
        public readonly int limit;
        int frame = int.MinValue;

        public FrameBudget(int limit) => this.limit = limit;

        /// <summary>本帧已用</summary>
        public int Used { get; private set; }
        /// <summary>单帧用量的历史最大值</summary>
        public int Peak { get; private set; }
        /// <summary>因超额被拒绝的次数（累计）</summary>
        public int Denied { get; private set; }

        void Sync(int f)
        {
            if (f == frame) return;
            frame = f;
            Used = 0;
        }

        /// <summary>本帧还有没有余量（不占用）</summary>
        public bool Has(int f)
        {
            Sync(f);
            return Used < limit;
        }

        /// <summary>占用一份；超额返回 false 并计入 Denied</summary>
        public bool TryTake(int f)
        {
            Sync(f);
            if (Used >= limit)
            {
                Denied++;
                return false;
            }
            Used++;
            if (Used > Peak) Peak = Used;
            return true;
        }

        /// <summary>只计一次拒绝（别的原因，如队列满，也算在这份预算的拒绝里）</summary>
        public void Deny() => Denied++;

        public void Reset()
        {
            frame = int.MinValue;
            Used = Peak = Denied = 0;
        }
    }

    /// <summary>
    /// 反应浮字的节流（Three.js HitFeedback.reactionLabel）：每帧最多 <see cref="CombatTuning.LabelBudget"/> 条；
    /// 同一敌人 <see cref="CombatTuning.LabelGap"/> 秒一条，大号（归墟）不受逐敌节流，免得紧跟在两两反应后面的「归墟」被吞掉。
    /// </summary>
    public sealed class LabelThrottle
    {
        readonly FrameBudget budget = new(CombatTuning.LabelBudget);
        readonly Dictionary<Damageable, float> lastAt = new();
        readonly List<Damageable> dead = new();

        public FrameBudget Budget => budget;

        /// <summary>这条浮字能不能出（能的话记下时间、占一份预算）。key 为 null 时只看每帧预算</summary>
        public bool Allow(Damageable key, bool big, float now, int frame)
        {
            if (!budget.Has(frame))
            {
                budget.Deny();
                return false;
            }
            if (!big && !ReferenceEquals(key, null) && lastAt.TryGetValue(key, out var last) && now - last < CombatTuning.LabelGap && now >= last)
                return false;
            if (!ReferenceEquals(key, null)) lastAt[key] = now;
            return budget.TryTake(frame);
        }

        /// <summary>去掉已销毁敌人的记录</summary>
        public void Prune()
        {
            dead.Clear();
            foreach (var k in lastAt.Keys)
                if (!k) dead.Add(k);
            for (int i = 0; i < dead.Count; i++) lastAt.Remove(dead[i]);
            dead.Clear();
        }

        public void Clear()
        {
            lastAt.Clear();
            budget.Reset();
        }
    }
}
