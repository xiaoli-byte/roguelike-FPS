using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>"pet"（按权重抽）/ "pet:&lt;id&gt;" / "pet:rarity=&lt;0–2&gt;"：灵兽封印，落在宝箱前方，朝玩家抛一点</summary>
    [Defs]
    public sealed class PetReward : RewardHandler
    {
        public override string Key => "pet";

        public override void Grant(in RewardContext ctx)
        {
            var toss = ctx.TowardPlayer * 1.4f + Vector3.up * 4.5f;
            var at = ctx.position + Vector3.up * 0.4f;
            var arg = ctx.args.Length > 1 ? ctx.args[1] : "";
            if (arg.StartsWith("rarity=") && int.TryParse(arg.Substring(7), out var tier))
                PetSeal.DropRandom(at, (PetRarity)Mathf.Clamp(tier, 0, 2), true, toss);
            else if (PetLibrary.Get(arg) is { } petDef) PetSeal.Drop(petDef, at, toss, announce: true);
            else PetSeal.DropRandom(at, null, true, toss);
        }

        public override string Hint(string[] args) => "灵宠";
        public override Color Color(string[] args) => new(1f, 0.55f, 0.85f);
    }
}
