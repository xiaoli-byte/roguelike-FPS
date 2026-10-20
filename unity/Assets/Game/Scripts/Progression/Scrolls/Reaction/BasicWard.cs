namespace Spiritfire.Game
{
    /// <summary>
    /// 化劫（Three.js 版 defsReaction.ts rx_ward）：引发元素反应时每层回复 4 护盾（每秒至多 3 次：0.33 s 内置冷却）；「归墟」改为每层 12。
    /// 任何来源的反应都算（含衍生、强制）；玩家阵亡时不回。
    /// </summary>
    [Defs(508)]
    public sealed class RxWard : ScrollDef
    {
        public RxWard()
        {
            id = "rx_ward";
            name = "化劫";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "反应", "护盾", "生存" };
            description = "引发元素反应时每层回复 4 点护盾（每秒至多 3 次）；「归墟」改为每层 12 点。";
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnReacted((in ReactionEvent e) =>
            {
                if (!TacticsKit.Alive(s) || !s.Ready("w", 0.33f)) return;
                TacticsKit.Host.AddShield((e.id == Reaction.Abyss ? 12 : 4) * n);
                s.Proc();
            });
        }
    }
}
