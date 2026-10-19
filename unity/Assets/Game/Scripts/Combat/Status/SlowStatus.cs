using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 减速（Three.js 版 src/combat/Status.ts slow）：最多 4 条，各自计时，取最强的一条（单条上限 90%）；
    /// 满 4 条时替换「强度 × 剩余时间」最小的一条。和蚀化的 ×0.8 一起由宿主取最小值。
    /// </summary>
    [Defs]
    public sealed class SlowStatus : IStatusEffect
    {
        public const float DefaultSeconds = 2f, Max = 0.9f;
        public const int MaxEntries = 4;

        public string Id => "slow";
        public StatusId Status => StatusId.Slow;
        public string Name => "减速";
        public Color Color => new(0.55f, 0.8f, 1f);
        public StatusHosts Hosts => StatusHosts.Enemy;
        public Element Element => Element.None;
        public StatusInstance Create(IStatusHost host) => new SlowInstance(host as EnemyStatus);

        /// <summary>减速比例的口径：&gt; 1 按百分数解释（30 = 30%），钳到 [0, 0.9]</summary>
        public static float Strength(float power)
        {
            float s = float.IsNaN(power) ? 0 : power;
            if (s > 1) s /= 100f;
            return Mathf.Clamp(s, 0, Max);
        }
    }

    /// <summary>挂在敌人身上的减速条目</summary>
    public sealed class SlowInstance : EnemyStatusInstance
    {
        struct Entry
        {
            public float power, remaining;
        }

        readonly List<Entry> entries = new();
        float strongest;

        public SlowInstance(EnemyStatus host) : base(host) { }

        public override StatusId Id => StatusId.Slow;
        public override bool Active => entries.Count > 0;
        public override float SpeedMult => entries.Count > 0 ? 1 - strongest : 1f;

        public override bool Apply(in StatusApply a)
        {
            float s = SlowStatus.Strength(a.power);
            if (s <= 0) return false;
            var e = new Entry { power = s, remaining = a.duration > 0 ? a.duration : SlowStatus.DefaultSeconds };
            if (entries.Count < SlowStatus.MaxEntries) entries.Add(e);
            else
            {
                int weakest = 0;
                for (int i = 1; i < entries.Count; i++)
                    if (entries[i].power * entries[i].remaining < entries[weakest].power * entries[weakest].remaining) weakest = i;
                entries[weakest] = e;
            }
            Recompute();
            Notify(entries.Count);
            return true;
        }

        public override void Tick(float dt)
        {
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                var e = entries[i];
                e.remaining -= dt;
                if (e.remaining <= 0) entries.RemoveAt(i);
                else entries[i] = e;
            }
            Recompute();
        }

        void Recompute()
        {
            strongest = 0;
            foreach (var e in entries) strongest = Mathf.Max(strongest, e.power);
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Slow };
            if (entries.Count == 0) return false;
            view.stacks = entries.Count;
            foreach (var e in entries)
            {
                view.power = Mathf.Max(view.power, e.power);
                view.remaining = Mathf.Max(view.remaining, e.remaining);
            }
            return true;
        }

        public override void Clear()
        {
            entries.Clear();
            strongest = 0;
        }
    }
}
