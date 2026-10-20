using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// "upgrade"：当前武器免费强化一级（同 TS LootSystem.grant('upgrade')）。
    /// 手上没有枪或已满级（+5）时改为灵石：round(80 × (1 + 0.35 × 章))，灵石获取在捡起入账时乘（<see cref="EconomyConfig.CreditCoins"/>）。
    /// </summary>
    [Defs]
    public sealed class UpgradeReward : RewardHandler
    {
        /// <summary>改发灵石时的基数与每章加成（一次性奖励的章节系数，同 TS REWARD_CHAPTER_COIN）</summary>
        public const int FallbackCoins = 80;
        public const float ChapterCoinStep = 0.35f;

        public override string Key => "upgrade";

        public override void Grant(in RewardContext ctx)
        {
            var pv = ctx.Player;
            var wc = pv ? pv.GetComponent<WeaponController>() : null;
            var w = wc ? wc.Active : null;
            if (w != null && WeaponLibrary.Upgrade(w))
            {
                Hud.Instance?.Toast($"{WeaponLibrary.DisplayName(w)} 强化至 +{w.level}");
                GameAudio.Play("skill_buff", 0.7f);
                PetFx.Burst(pv.transform.position + Vector3.up, new Color(0.29f, 0.64f, 1f, 0.8f), 2.4f, 0.6f);
                return;
            }
            Hud.Instance?.Toast(w != null ? "当前武器已满级，改为灵石" : "没有可强化的武器，改为灵石");
            // 灵石获取加成在入账时乘（EconomyConfig.CreditCoins），这里只给基数
            int amount = WeaponStatsResolver.RoundHalfUp(FallbackCoins * (1 + ChapterCoinStep * WeaponRoller.CurrentChapter));
            LootDirector.DropCoins(ctx.position, amount, 1.5f, true);
        }

        public override string Hint(string[] args) => "当前武器免费强化一级";
        public override Color Color(string[] args) => Hex.Rgb(0x4aa3ff);
    }
}
