using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 点燃（玩家减益，Three.js 版 InfernoRangedFx.ignitePlayer）：每 0.5 s 一跳火伤，默认 2 s。
    /// 已在燃烧时只刷新时长（取更晚的到期）并取较大的跳伤，多只敌人同时点燃不叠加。跳伤经 Combat.DamagePlayer（无敌帧期间这一跳落空）。
    /// 来源：毕方火矛（2 s × 3 / 跳 × 敌人伤害倍率）…
    /// </summary>
    [Defs]
    public sealed class IgniteStatus : IStatusEffect
    {
        public const float DefaultSeconds = 2f, TickInterval = 0.5f;
        /// <summary>到期判定的余量（同 Three.js：到期后 0.05 s 内还能补上最后一跳）</summary>
        public const float EndGrace = 0.05f, LastTickGrace = 0.02f;

        public string Id => "ignite";
        public StatusId Status => StatusId.Ignite;
        public string Name => "点燃";
        public Color Color => DamageTable.ElementColor(Element.Fire);
        public StatusHosts Hosts => StatusHosts.Player;
        public Element Element => Element.Fire;
        public StatusInstance Create(IStatusHost host) => new IgniteInstance(host as PlayerStatus);
    }

    /// <summary>挂在玩家身上的点燃：到期时刻、下一跳时刻、每跳伤害（用状态自己的时钟，宿主为空的测试里也能推进）</summary>
    public sealed class IgniteInstance : PlayerStatusInstance
    {
        float clock, until, next, tick;
        bool running;

        public IgniteInstance(PlayerStatus host) : base(host) { }

        public override StatusId Id => StatusId.Ignite;
        public override bool Active => running;
        /// <summary>每跳伤害</summary>
        public float TickDamage => running ? tick : 0;

        public override bool Apply(in StatusApply a)
        {
            float seconds = a.duration > 0 ? a.duration : IgniteStatus.DefaultSeconds;
            float dmg = float.IsNaN(a.power) ? 0 : Mathf.Max(0, a.power);
            if (!running)
            {
                running = true;
                clock = 0;
                until = seconds;
                next = IgniteStatus.TickInterval;
                tick = dmg;
            }
            else
            {
                until = Mathf.Max(until, clock + seconds);
                tick = Mathf.Max(tick, dmg);
            }
            Notify(1);
            return true;
        }

        public override void Tick(float dt)
        {
            clock += dt;
            if (clock > until + IgniteStatus.EndGrace)
            {
                Clear();
                return;
            }
            if (clock >= next && next <= until + IgniteStatus.LastTickGrace)
            {
                next += IgniteStatus.TickInterval;
                if (tick > 0 && host)
                {
                    Hurt(tick, Element.Fire);
                    GameAudio.Play("burn_tick", 0.5f, 1.1f);
                }
            }
        }

        /// <summary>剩下还会跳的伤害（不含减伤与修饰器）</summary>
        public override float RemainingDotRaw
        {
            get
            {
                if (!running || !(tick > 0)) return 0;
                int n = 0;
                for (float t = next; t <= until + IgniteStatus.LastTickGrace; t += IgniteStatus.TickInterval) n++;
                return n * tick;
            }
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Ignite };
            if (!running) return false;
            view.stacks = 1;
            view.remaining = Mathf.Max(0, until - clock);
            view.power = tick;
            return true;
        }

        public override void Clear()
        {
            running = false;
            tick = 0;
        }
    }
}
