namespace Spiritfire.Game
{
    /// <summary>换位掩护（Three.js 版 defsTactics.ts tac_cover_change）：切到另一把武器时每层回复 8 护盾（不超过实际上限）；冷却 5 秒。</summary>
    [Defs(601)]
    public sealed class TacCoverChange : ScrollDef
    {
        public TacCoverChange()
        {
            id = "tac_cover_change";
            name = "换位掩护";
            rarity = 1;
            maxStacks = 3;
            tags = new[] { "切枪", "护盾" };
            description = "切换到另一把武器时每层回复 8 护盾；冷却 5 秒。";
        }

        public override void Install(ScrollScope s, int n)
        {
            TacticsKit.OnSwitch(s, () =>
            {
                if (!s.Ready("shield", 5)) return;
                TacticsKit.Host.AddShield(8 * n);
                s.Proc();
            });
        }
    }
}
