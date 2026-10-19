using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 寒意（玩家减益，Three.js 版 FrostPackFx / FrostSupportFx 的 chillPlayer 合并）：移速降低，取此刻最强的一条，上限 70%。
    /// 每次命中各记一条（最多 4 条，各自计时；满了替换「比例 × 剩余时间」最小的一条），所以重复命中只刷新、不越叠越慢，
    /// 强的那条到期后回落到次强的。只影响走路速度（PlayerMotor.walkSpeed），不改属性表、不影响冲刺。
    /// 来源：猩猩冰块（35% 1.5 s）、狐巫镜像（70% 1.5 s）、灯水母电击（40% 1 s）…
    /// </summary>
    [Defs]
    public sealed class ChillStatus : IStatusEffect
    {
        public const float MaxSlow = 0.7f, DefaultSeconds = 1.5f;
        public const int MaxEntries = 4;

        public string Id => "chill";
        public StatusId Status => StatusId.Chill;
        public string Name => "寒意";
        public Color Color => new(0.62f, 0.86f, 1f);
        public StatusHosts Hosts => StatusHosts.Player;
        public Element Element => Element.None;
        public StatusInstance Create(IStatusHost host) => new ChillInstance(host as PlayerStatus);

        /// <summary>比例口径：&gt; 1 按百分数解释，钳到 [0, 1]（生效时再封顶 70%）</summary>
        public static float Fraction(float power)
        {
            float s = float.IsNaN(power) ? 0 : power;
            if (s > 1) s /= 100f;
            return Mathf.Clamp01(s);
        }
    }

    /// <summary>挂在玩家身上的寒意条目</summary>
    public sealed class ChillInstance : PlayerStatusInstance
    {
        struct Entry
        {
            public float frac, remaining;
        }

        readonly List<Entry> entries = new();
        float strongest;

        public ChillInstance(PlayerStatus host) : base(host) { }

        public override StatusId Id => StatusId.Chill;
        public override bool Active => entries.Count > 0;
        /// <summary>此刻的减速比例（最强的一条，封顶 70%）</summary>
        public float Slow => Mathf.Min(ChillStatus.MaxSlow, strongest);
        public override float SpeedMult => entries.Count > 0 ? 1 - Slow : 1f;

        public override bool Apply(in StatusApply a)
        {
            float f = ChillStatus.Fraction(a.power);
            if (f <= 0) return false;
            var e = new Entry { frac = f, remaining = a.duration > 0 ? a.duration : ChillStatus.DefaultSeconds };
            if (entries.Count < ChillStatus.MaxEntries) entries.Add(e);
            else
            {
                int weakest = 0;
                for (int i = 1; i < entries.Count; i++)
                    if (entries[i].frac * entries[i].remaining < entries[weakest].frac * entries[weakest].remaining) weakest = i;
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
            foreach (var e in entries) strongest = Mathf.Max(strongest, e.frac);
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Chill };
            if (entries.Count == 0) return false;
            view.stacks = entries.Count;
            view.power = Slow;
            foreach (var e in entries) view.remaining = Mathf.Max(view.remaining, e.remaining);
            return true;
        }

        public override void Clear()
        {
            entries.Clear();
            strongest = 0;
        }
    }
}
