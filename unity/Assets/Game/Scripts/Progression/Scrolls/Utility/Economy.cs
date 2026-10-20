using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 功能·经济类秘卷（Three.js 版 defsUtility.ts「经济」段，数值同原版；灵引在 <see cref="UtilityStatScrolls"/>；局内货币叫灵石，D13）：
    ///   点金手 灵石获取（入账时乘，<see cref="EconomyConfig.CreditCoins"/>）· 招财符 幸运（抽武器 / 秘卷时提高高稀有度权重）·
    ///   悬赏令 击杀精英 / 首领额外掉灵石（掉成拾取物，捡起时照常乘灵石获取）· 聚宝盆 进新关给本金 + 利息（直接入账，不乘灵石获取，同 TS）。
    /// </summary>
    [Defs(331)]
    public sealed class EconomyStatScrolls : IDefSource<ScrollDef>
    {
        public IEnumerable<ScrollDef> Create() => new ScrollDef[]
        {
            new StatScroll
            {
                id = "golden_touch", name = "点金手", tags = new[] { "经济" }, rarity = Rarity.Common, maxStacks = 3,
                description = "灵石获取每层 +15%。", stats = new[] { (Stat.CoinGainPct, 0.15f) },
            },
            new StatScroll
            {
                id = "fortune_charm", name = "招财符", tags = new[] { "经济" }, rarity = Rarity.Uncommon, maxStacks = 3,
                description = "幸运每层 +1（更容易出现高稀有度的武器与秘卷）。", stats = new[] { (Stat.Luck, 1f) },
            },
        };
    }

    /// <summary>悬赏令：击杀精英时每层额外掉 12 灵石，击杀首领时每层额外掉 60 灵石。静默处决、分身等不给奖励的死亡不算</summary>
    [Defs(332)]
    public sealed class BountyScroll : ScrollDef
    {
        public const int ElitePerStack = 12, BossPerStack = 60;

        public BountyScroll()
        {
            id = "bounty";
            name = "悬赏令";
            rarity = Rarity.Uncommon;
            maxStacks = 3;
            tags = new[] { "经济", "击杀" };
            description = "击杀精英时每层额外掉落 12 灵石，击杀首领时每层额外掉落 60 灵石。";
        }

        /// <summary>一次击杀额外掉多少（普通敌人 0）</summary>
        public static int Payout(Rank rank, int stacks) => rank switch
        {
            Rank.Boss => BossPerStack * stacks,
            Rank.Elite => ElitePerStack * stacks,
            _ => 0,
        };

        public override void Install(ScrollScope s, int n)
        {
            s.OnKill((in KillEvent e) =>
            {
                var d = e.enemy;
                if (!d || d.noReward) return;
                int amount = Payout(d.rank, n);
                if (amount <= 0) return;
                ScrollKit.DropBonusCoins(ScrollKit.BodyCenter(d), amount);
                s.Proc();
            });
        }
    }

    /// <summary>
    /// 聚宝盆：每进入新关卡，得到本金 12 × 层 × 章节系数，另加持有灵石 × 5% × 层 的利息（上限 30 × 层 × 章节系数）；章节系数 = 1 + 0.35 × (章 − 1)。
    /// 本金与利息直接入账（不乘灵石获取，同 TS run.coins += gain）。玩家阵亡时不给。
    /// </summary>
    [Defs(333)]
    public sealed class TreasureBowlScroll : ScrollDef
    {
        public const int PrincipalPerStack = 12, InterestCapPerStack = 30;
        public const double InterestRatePerStack = 0.05, ChapterScalePerChapter = 0.35;
        static readonly Color Gold = Hex.Rgb(0xffd54a);

        public TreasureBowlScroll()
        {
            id = "treasure_bowl";
            name = "聚宝盆";
            rarity = Rarity.Rare;
            maxStacks = 2;
            tags = new[] { "经济" };
            description = "每进入新关卡，获得每层 12 灵石本金，另获得持有灵石每层 5% 的利息（利息每层上限 30）。本金与利息上限随章节提高；每层都增加本金和利率。";
        }

        /// <summary>
        /// 一次进关的（本金, 利息）：chapter 从 1 起（RunState / StageSpec 的章；TS 的章从 0 起，所以系数里减 1）。
        /// 取整同 TS：本金 / 上限四舍五入（.5 进位，Math.round），利息向下取整；用 double 算，与 JS 数值逐位一致
        /// </summary>
        public static (int principal, int interest) Payout(int coins, int stacks, int chapter)
        {
            double scale = 1 + ChapterScalePerChapter * Math.Max(0, chapter - 1);
            int principal = (int)Math.Floor(PrincipalPerStack * stacks * scale + 0.5);
            int cap = (int)Math.Floor(InterestCapPerStack * stacks * scale + 0.5);
            int interest = (int)Math.Min(cap, Math.Floor(Math.Max(0, coins) * InterestRatePerStack * stacks));
            return (principal, interest);
        }

        public override void Install(ScrollScope s, int n)
        {
            s.OnStageLoaded(stage =>
            {
                var run = RunState.Current;
                if (run == null || !s.Alive) return;
                var (principal, interest) = Payout(run.coins, n, stage != null ? stage.chapter : run.chapter);
                int gain = principal + interest;
                if (ScrollKit.CreditRunCoins(gain, id) <= 0) return;
                s.Proc();
                ScrollKit.Show.Toast($"聚宝盆：本金 {principal} + 利息 {interest} = {gain} 灵石", Gold);
            });
        }
    }
}
