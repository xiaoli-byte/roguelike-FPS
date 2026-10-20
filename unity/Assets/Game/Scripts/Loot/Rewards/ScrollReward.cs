using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// "scroll[:min=N][:count=N]"：排队弹一次秘卷 N 选一（缺省三选一）。min = 保底稀有度：精英 / 首领宝箱由
    /// <see cref="EconomyConfig.ApplyTier"/> 写成 min=1（同 TS grant('scroll') 在精英 / 首领关传 minRarity 1）。
    /// 保底池抽空时放宽、全部满层时改发灵石，都在 <see cref="LootDirector"/> 的队列里处理。
    /// </summary>
    [Defs]
    public sealed class ScrollReward : RewardHandler
    {
        public const int DefaultCount = 3;

        public override string Key => "scroll";

        public static int MinRarity(string[] args) => Rarity.Clamp(EconomyConfig.IntArg(args, "min", 0));
        public static int Count(string[] args) => Mathf.Clamp(EconomyConfig.IntArg(args, "count", DefaultCount), 1, 5);

        public override void Grant(in RewardContext ctx)
        {
            var loot = ctx.loot ? ctx.loot : LootDirector.Instance;
            if (loot) loot.OfferScrolls(Count(ctx.args), MinRarity(ctx.args));
        }

        public override string Hint(string[] args) => "秘卷";

        /// <summary>宝箱说明行（同 TS hint）：「从三个秘卷中选择一个」/「从三个精良及以上的秘卷中选择一个」</summary>
        public static string Line(string[] args)
        {
            int count = Count(args), min = MinRarity(args);
            string what = min > 0 ? $"{Rarity.Name(min)}及以上的秘卷" : "秘卷";
            if (count == 1) return $"获得一个{what}";
            string n = count switch { 2 => "两", 3 => "三", 4 => "四", 5 => "五", _ => count.ToString() };
            return $"从{n}个{what}中选择一个";
        }

        public override Color Color(string[] args) => new(0.55f, 0.75f, 1f);
    }
}
