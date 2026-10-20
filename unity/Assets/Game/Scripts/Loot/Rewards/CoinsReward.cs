using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// "coins[:tier=elite]"：在宝箱前撒一大堆灵石（同 TS grant('coins')）：60–120 × (1 + 0.35 × 章)，精英场 × 1.4，
    /// 落地展示一下再自动吸向玩家；灵石获取加成在入账时乘（<see cref="EconomyConfig.CreditCoins"/>）。
    /// </summary>
    [Defs]
    public sealed class CoinsReward : RewardHandler
    {
        public override string Key => "coins";

        public override void Grant(in RewardContext ctx)
        {
            var tier = EconomyConfig.TierOf(ctx.args);
            int amount = EconomyConfig.ChestCoins(tier, EconomyConfig.Chapter, RunState.Ensure().Stream("loot"));
            LootDirector.DropCoins(ctx.position, amount, EconomyConfig.ChestCoinToss, true);
        }

        public override string Hint(string[] args) => "灵石";

        /// <summary>宝箱说明行</summary>
        public static string Line(string[] args) => EconomyConfig.TierOf(args) == ChestTier.Normal ? "一大堆灵石" : "一大堆灵石（精英加成）";

        public override Color Color(string[] args) => new(1f, 0.85f, 0.35f);
    }
}
