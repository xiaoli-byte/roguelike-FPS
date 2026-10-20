namespace Spiritfire.Game
{
    /// <summary>
    /// 化元（Three.js 版 defsReaction.ts rx_transmute）：引发元素反应时，两个技能的冷却每层减少 0.25 秒（每 0.5 秒至多一次）。
    /// </summary>
    [Defs(509)]
    public sealed class RxTransmute : ScrollDef
    {
        public RxTransmute()
        {
            id = "rx_transmute";
            name = "化元";
            rarity = 2;
            maxStacks = 3;
            tags = new[] { "反应", "技能" };
            description = "引发元素反应时，所有技能冷却每层减少 0.25 秒（每 0.5 秒至多一次）。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnReacted((in ReactionEvent e) =>
            {
                if (!s.Ready("cd", 0.5f)) return;
                TacticsKit.Host.ReduceCooldowns(0.25f * n, null);
                s.Proc();
            });
        }
    }
}
