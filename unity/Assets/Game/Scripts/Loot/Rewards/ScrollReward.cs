using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"scroll"：排队弹一次秘卷三选一</summary>
    [Defs]
    public sealed class ScrollReward : RewardHandler
    {
        public override string Key => "scroll";

        public override void Grant(in RewardContext ctx)
        {
            var loot = ctx.loot ? ctx.loot : LootDirector.Instance;
            if (loot) loot.OfferScrolls(3);
        }

        public override string Hint(string[] args) => "秘卷";
        public override Color Color(string[] args) => new(0.55f, 0.75f, 1f);
    }
}
