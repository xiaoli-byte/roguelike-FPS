using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"weapon:&lt;id&gt;[:稀有度]"：在宝箱前抛出一把地上的枪（缺省赤铜左轮、普通）。随机掷骰（W2 WeaponRoller）之后改成按章节权重</summary>
    [Defs]
    public sealed class WeaponReward : RewardHandler
    {
        public override string Key => "weapon";

        public override void Grant(in RewardContext ctx)
        {
            var args = ctx.args;
            var def = WeaponLibrary.Get(args.Length > 1 ? args[1] : "revolver");
            if (def == null) return;
            int rarity = args.Length > 2 && int.TryParse(args[2], out var r) ? r : 0;
            WeaponPickup.Drop(new WeaponInstance(def, rarity), ctx.position + Vector3.up * 0.4f, ctx.TowardPlayer * 1.6f + Vector3.up * 5f);
        }

        public override string Hint(string[] args) => "武器";
        public override Color Color(string[] args) => new(1f, 0.62f, 0.25f);
    }
}
