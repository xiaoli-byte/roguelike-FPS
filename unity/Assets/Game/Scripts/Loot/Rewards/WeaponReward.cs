using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 武器奖励：在宝箱前朝玩家抛出一把地上的枪（<see cref="WeaponRoller.Roll(in WeaponRoller.RollOptions, System.Random)"/>）。奖励串：
    ///   "weapon"              按当前章节的稀有度表 + 幸运随机（同 TS grant('weapon') 不保底时）；
    ///   "weapon:min=N"        保底品质 N（0–4）：首领第一章 min=3、第二章起 min=4，精英 min=1（同 TS weaponRewardMinRarity）；
    ///   "weapon:&lt;id&gt;"          指定武器、普通品质（关卡里写死的教学奖励，旧写法照旧）；
    ///   "weapon:&lt;id&gt;:N"        指定武器、固定品质 N；
    ///   "weapon:&lt;id&gt;:min=N"    指定武器、按章节表掷品质且不低于 N。
    /// 元素和词条照常掷（指定 id 也一样）。参数顺序随意，未知参数忽略。
    /// </summary>
    [Defs]
    public sealed class WeaponReward : RewardHandler
    {
        public override string Key => "weapon";

        /// <summary>解析后的奖励参数</summary>
        public readonly struct Spec
        {
            public readonly string id;
            /// <summary>固定品质（null = 按章节表掷）</summary>
            public readonly int? rarity;
            public readonly int minRarity;

            public Spec(string id, int? rarity, int minRarity)
            {
                this.id = id;
                this.rarity = rarity;
                this.minRarity = minRarity;
            }
        }

        public static Spec Parse(string[] args)
        {
            string id = null;
            int? rarity = null;
            int min = 0;
            bool hasMin = false;
            for (int i = 1; args != null && i < args.Length; i++)
            {
                var a = args[i]?.Trim();
                if (string.IsNullOrEmpty(a)) continue;
                if (a.StartsWith("min=") && int.TryParse(a.Substring(4), out var m))
                {
                    min = Rarity.Clamp(m);
                    hasMin = true;
                }
                else if (int.TryParse(a, out var r)) rarity = Rarity.Clamp(r);
                else id ??= a;
            }
            // 旧写法 "weapon:<id>"：指定武器、普通品质
            if (id != null && !rarity.HasValue && !hasMin) rarity = Rarity.Common;
            return new Spec(id, rarity, min);
        }

        public override void Grant(in RewardContext ctx)
        {
            var spec = Parse(ctx.args);
            var w = WeaponRoller.Roll(new WeaponRoller.RollOptions
            {
                chapter = WeaponRoller.CurrentChapter, minRarity = spec.minRarity, id = spec.id, rarity = spec.rarity,
            });
            if (w == null) return;
            WeaponPickup.Drop(w, ctx.position + Vector3.up * 0.4f, ctx.TowardPlayer * 1.6f + Vector3.up * 5f);
        }

        /// <summary>宝箱提示（同 TS weaponRewardHint）：「一把随机武器」/「一把史诗及以上品质的武器」/「一把传说品质的武器」；指定武器显示名字</summary>
        public override string Hint(string[] args)
        {
            var spec = Parse(args);
            var def = spec.id != null ? WeaponLibrary.Get(spec.id) : null;
            if (def != null)
            {
                if (spec.rarity.HasValue) return spec.rarity.Value > 0 ? $"{Rarity.Name(spec.rarity.Value)} · {def.name}" : def.name;
                return spec.minRarity > 0 ? $"{def.name}（{Rarity.Name(spec.minRarity)}及以上）" : def.name;
            }
            int min = spec.rarity ?? spec.minRarity;
            if (min <= 0) return "一把随机武器";
            return min >= Rarity.Legendary || spec.rarity.HasValue ? $"一把{Rarity.Name(min)}品质的武器" : $"一把{Rarity.Name(min)}及以上品质的武器";
        }

        /// <summary>宝箱宝石 / 光柱：武器奖励一律橙色（同 TS REWARD_COLORS 按奖励种类取色）</summary>
        public override Color Color(string[] args) => new(1f, 0.62f, 0.25f);
    }
}
