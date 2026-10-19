using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"heal"：生命上限 +10，回复 50% 生命</summary>
    [Defs]
    public sealed class HealReward : RewardHandler
    {
        public override string Key => "heal";

        public override void Grant(in RewardContext ctx)
        {
            var pv = ctx.Player;
            if (!pv) return;
            pv.stats.Add("reward", Stat.MaxHp, 10);
            pv.Heal(pv.MaxHealth * 0.5f);
            Hud.Instance?.Toast("生命上限 +10，回复 50% 生命");
        }

        public override string Hint(string[] args) => "生命";
        public override Color Color(string[] args) => new(0.4f, 1f, 0.55f);
    }
}
