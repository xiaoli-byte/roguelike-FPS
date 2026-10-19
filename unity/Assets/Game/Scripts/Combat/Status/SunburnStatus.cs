using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 日晒灼烧（玩家减益，旱魃「烈日」，docs/level-design/unity-maps-v1.md 1-4；Three.js 版没有）：
    ///   暴露在日光柱 / 日轮直射下持续叠层——每暴露 0.5 s 叠一层，最多 10 层；每 0.5 s 跳 层数 × 0.6 火伤（满层 12 / s）。
    ///   离开日晒（0.3 s 内没有再暴露）后每秒消退 3 层，躲进影子约 3 s 清空。踩浅水时由调用方把增益调低（gain &lt; 1）。
    /// 由首领的 SunExposure（BS1，每 0.1 s 做一次射线 + 阴影判定）调用 <see cref="PlayerStatus.SunExposure"/>；数值待 BS1 实战调。
    /// </summary>
    [Defs]
    public sealed class SunburnStatus : IStatusEffect
    {
        public const float StackSeconds = 0.5f, TickInterval = 0.5f, DamagePerStack = 0.6f, DecayDelay = 0.3f, DecayPerSecond = 3f;
        public const int MaxStacks = 10;

        public string Id => "sunburn";
        public StatusId Status => StatusId.Sunburn;
        public string Name => "日晒";
        public Color Color => new(1f, 0.86f, 0.45f);
        public StatusHosts Hosts => StatusHosts.Player;
        public Element Element => Element.Fire;
        public StatusInstance Create(IStatusHost host) => new SunburnInstance(host as PlayerStatus);
    }

    /// <summary>挂在玩家身上的日晒：层数（连续量，取整生效）、跳伤计时、最近一次暴露的时刻与日光来向</summary>
    public sealed class SunburnInstance : PlayerStatusInstance
    {
        float level, clock, lastExposed, tickTimer = SunburnStatus.TickInterval;
        /// <summary>每层每跳的伤害（首领按难度改）</summary>
        public float damagePerStack = SunburnStatus.DamagePerStack;
        /// <summary>日光来自哪里（受击方向；null = 玩家自己的位置）</summary>
        public Vector3? sun;

        public SunburnInstance(PlayerStatus host) : base(host) { }

        public override StatusId Id => StatusId.Sunburn;
        public override bool Active => level > 0;
        /// <summary>生效的层数</summary>
        public int Stacks => Mathf.Min(SunburnStatus.MaxStacks, Mathf.FloorToInt(level + StatusTiming.TickEps));
        /// <summary>此刻每跳伤害</summary>
        public float TickDamage => Stacks * damagePerStack;

        /// <summary>暴露了 a.power 秒（已乘增益）：叠层并重置消退</summary>
        public override bool Apply(in StatusApply a)
        {
            float seconds = float.IsNaN(a.power) ? 0 : a.power;
            if (seconds <= 0) return false;
            int before = Stacks;
            if (level <= 0) tickTimer = SunburnStatus.TickInterval;
            level = Mathf.Min(SunburnStatus.MaxStacks, level + seconds / SunburnStatus.StackSeconds);
            lastExposed = clock;
            int now = Stacks;
            if (now != before) Notify(now);
            return true;
        }

        public override void Tick(float dt)
        {
            clock += dt;
            if (clock - lastExposed > SunburnStatus.DecayDelay)
            {
                level -= SunburnStatus.DecayPerSecond * dt;
                if (level <= 0)
                {
                    Clear();
                    return;
                }
            }
            if (Stacks <= 0)
            {
                tickTimer = SunburnStatus.TickInterval;
                return;
            }
            tickTimer -= dt;
            if (tickTimer > StatusTiming.TickEps) return;
            tickTimer = Mathf.Max(tickTimer + SunburnStatus.TickInterval, StatusTiming.TickEps * 2);
            float dmg = TickDamage;
            if (dmg > 0 && host) Hurt(dmg, Element.Fire, sun);
        }

        public override bool TryGet(out StatusView view)
        {
            view = new StatusView { id = StatusId.Sunburn };
            if (level <= 0) return false;
            view.stacks = Stacks;
            view.power = TickDamage;
            // 不再暴露时还要多久消退完
            view.remaining = SunburnStatus.DecayDelay + level / SunburnStatus.DecayPerSecond;
            return true;
        }

        public override void Clear()
        {
            level = 0;
            tickTimer = SunburnStatus.TickInterval;
        }
    }
}
