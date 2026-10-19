using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"coins"：在宝箱前撒 60–120 灵石</summary>
    [Defs]
    public sealed class CoinsReward : RewardHandler
    {
        public override string Key => "coins";

        public override void Grant(in RewardContext ctx) => LootDirector.DropCoins(ctx.position, Random.Range(60, 121), 1.7f);

        public override string Hint(string[] args) => "灵石";
        public override Color Color(string[] args) => new(1f, 0.85f, 0.35f);
    }
}
