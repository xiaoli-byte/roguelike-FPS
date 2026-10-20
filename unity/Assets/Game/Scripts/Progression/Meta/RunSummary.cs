using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一局的结算（Three.js 版 src/core/types.ts 的 RunSummary）：<see cref="MetaSave.BankRun"/> 从 <see cref="RunState"/> 生成，
    /// 随 <see cref="GameEvents.RunEnded"/> 发给结算界面（U5：计数滚动、秘卷 / 武器 chips）。
    /// 与 TS 的差别：章从 1 起（同 RunState）；秘卷 / 武器只给 id，名字和稀有度由界面查注册表；多记了「收集的魂晶 / 通关奖励」两项。
    /// </summary>
    [Serializable]
    public sealed class RunSummary
    {
        [Serializable]
        public struct ScrollEntry
        {
            public string id;
            public int stacks;
        }

        public bool victory;
        /// <summary>调试局（记进调试档）</summary>
        public bool dev;
        public string heroId;
        /// <summary>止步的章（1 起）、章内关序（0 起）、关卡编号（「1-3」）</summary>
        public int chapter, stage;
        public string stageCode;
        public int stagesCleared, kills, coins;
        /// <summary>用时（秒）、造成的伤害合计</summary>
        public float time, damageDealt;
        /// <summary>局内收集的魂晶、通关奖励（胜利 +<see cref="MetaSave.VictoryEssenceBonus"/>）、合计入账</summary>
        public int essenceCollected, victoryBonus, essenceEarned;
        public List<ScrollEntry> scrolls = new();
        /// <summary>结束时手上的武器（定义 id，按槽位顺序）</summary>
        public List<string> weapons = new();

        /// <summary>按 TS Game.endRun 生成：魂晶 = 局内收集 + 胜利奖励 200</summary>
        public static RunSummary From(RunState run, bool victory)
        {
            var s = new RunSummary
            {
                victory = victory,
                dev = run.dev,
                heroId = run.heroId,
                chapter = run.chapter,
                stage = run.stage,
                stageCode = run.stageCode,
                stagesCleared = run.stagesCleared,
                kills = run.kills,
                coins = run.coins,
                time = run.time,
                damageDealt = (float)Math.Round(run.damageDealt),
                essenceCollected = Math.Max(0, run.essence),
                victoryBonus = victory ? MetaSave.VictoryEssenceBonus : 0,
            };
            s.essenceEarned = s.essenceCollected + s.victoryBonus;
            if (run.scrolls != null)
                foreach (var (id, n) in run.scrolls)
                    if (n > 0)
                        s.scrolls.Add(new ScrollEntry { id = id, stacks = n });
            if (run.weapons != null)
                foreach (var w in run.weapons)
                    if (!string.IsNullOrEmpty(w.id))
                        s.weapons.Add(w.id);
            return s;
        }
    }
}
