using System.Collections.Generic;
using System.Text;
using UnityEngine;
#if UNITY_EDITOR || DEVELOPMENT_BUILD
using UnityEngine.InputSystem;
#endif

namespace Spiritfire.Game
{
    /// <summary>宝箱档位：普通场地 / 有精英的场地 / 首领场（决定保底品质、灵石加成与提示行）</summary>
    public enum ChestTier
    {
        Normal,
        Elite,
        Boss,
    }

    /// <summary>
    /// 经济数值表（docs/unity-parity.md D16 / D24：代码默认值，以后由编辑器单元生成 ScriptableObject 覆盖）。
    /// 数值照 Three.js src/progression/Loot.ts、loot/rewardRules.ts、DESIGN.md 4 / 11 节；章一律从 0 起（第一章 = 0，同 TS run.chapter）。
    ///   击杀灵石：EnemyDef.coins [lo, hi] 掷整数 × 精英 3 × (1 + 0.15 × 章)；首领没写时 60–100（首领包另加 2 弹药 + 2 生命）。
    ///   一次性奖励（宝箱灵石、强化 / 秘卷满层转灵石）：× (1 + 0.35 × 章)；宝箱灵石 60–120，精英场 × 1.4。
    ///   灵石获取（Stat.CoinGainPct）只在入账时乘一次（<see cref="CreditCoins"/>，小数部分累计到下一次，不因每颗取整而丢失）。
    /// 投影（<see cref="Project"/>）：按 RunPlan 的关卡数估每章收入，D24「按每章收入重调」的依据；调试命令 economy 打到日志。
    /// </summary>
    public static class EconomyConfig
    {
        // ───────────── 击杀 ─────────────

        /// <summary>击杀灵石的章节系数：× (1 + 0.15 × 章)（敌人数量本身已随章节增长，系数取小）</summary>
        public const float KillChapterCoin = 0.15f;
        /// <summary>精英击杀灵石倍数</summary>
        public const int EliteKillCoinMult = 3;
        /// <summary>首领定义没写灵石时的范围</summary>
        public const int BossCoinsMin = 60, BossCoinsMax = 100;
        /// <summary>首领包：额外掉的弹药 / 生命个数，以及抛撒力度</summary>
        public const int BossPackAmmo = 2, BossPackHealth = 2;
        public const float BossCoinToss = 2.2f, EliteCoinToss = 1.4f;
        /// <summary>击杀掉弹药：平时 30%，所有武器（弹匣 + 备弹）都低于 35% 时 50%；生命 10%。精英必掉两样</summary>
        public const float AmmoDropChance = 0.3f, AmmoDropChanceLow = 0.5f, LowAmmoFrac = 0.35f, HealthDropChance = 0.1f;
        /// <summary>掉落的弹药包补充每把枪备弹上限的比例；生命包缺省回复最大生命的比例</summary>
        public const float AmmoPickupFrac = 0.25f, HealthPickupFrac = 0.15f;
        /// <summary>精英掉灵兽封印的概率（Unity 独有，docs/pet-system.md）</summary>
        public const float ElitePetChance = 0.06f;

        // ───────────── 一次性奖励 ─────────────

        /// <summary>一次性奖励（宝箱灵石、强化 / 秘卷满层转灵石）的章节系数：× (1 + 0.35 × 章)</summary>
        public const float RewardChapterCoin = 0.35f;
        /// <summary>宝箱灵石范围、精英场倍数、抛撒力度</summary>
        public const int ChestCoinsMin = 60, ChestCoinsMax = 120;
        public const float EliteChestCoinMult = 1.4f, ChestCoinToss = 1.7f;
        /// <summary>强化台 / 强化奖励在武器满级时改发的灵石基数</summary>
        public const int UpgradeFallbackCoins = 80;
        /// <summary>秘卷全部满层时每张卡改发的灵石基数（× 张数）</summary>
        public const int ScrollFallbackCoinsPerCard = 40;
        /// <summary>每进入新的一关补给的备弹比例</summary>
        public const float StageAmmoRefill = 0.35f;

        // ───────────── 掉落物 ─────────────

        /// <summary>场上掉落物上限：超出的灵石直接入账，弹药 / 生命丢弃</summary>
        public const int MaxPickups = 240;
        /// <summary>一笔灵石拆成几颗：每颗约 3，最多 14 颗（≥ 60 的大笔最多 22 颗）</summary>
        public const int CoinPieceValue = 3, MaxCoinPieces = 14, MaxCoinPiecesLarge = 22, LargeCoinAmount = 60;
        /// <summary>清场后吸取的延迟（秒，另加 0–0.4 s 随机）、已清场后才掉出的灵石落地展示的时间</summary>
        public const float VacuumDelay = 0.8f, LateVacuumDelay = 1.1f;
        /// <summary>首领倒下后多久把场上掉落物吸向玩家（秒，另加 0–0.4 s 随机；首领灵石抛撒 <see cref="BossCoinToss"/> 落地约 1 s）</summary>
        public const float BossVacuumDelay = 1.6f;

        // ───────────── 商店参照（R3 落地商店时用）─────────────

        /// <summary>武器价格（按稀有度）× (1 + 0.25 × 章)，取整到 5</summary>
        public static readonly int[] WeaponPrice = { 60, 100, 160, 240, 360 };
        public const float ShopChapterPrice = 0.25f;
        public const int ScrollPriceMin = 80, ScrollPriceMax = 220, PotionPrice = 40, AmmoCratePrice = 20;

        // ───────────── 魂晶（局外，R2）─────────────

        /// <summary>每清一关 / 胜利额外的魂晶（击杀魂晶见 <see cref="KillResolver.EssenceFor"/>）</summary>
        public const int EssencePerStage = 10, EssenceVictory = 200;

        // ───────────── 公式 ─────────────

        /// <summary>
        /// 清关魂晶 +<see cref="EssencePerStage"/>：首领倒下结算时发（<see cref="BossEncounter"/>，force，每场首领一次，3-3 的领主也是），
        /// 开放大图在出口结算时发（<see cref="GameSession.CompleteStage"/>）——本关已经发过（首领场 / 有领主的大图）就不再发。
        /// 发过的关记在本局标记上，重来本关从进关快照恢复时一起回滚。返回是否发了
        /// </summary>
        public static bool CreditStageEssence(RunState run, string source, bool force = false)
        {
            if (run == null) return false;
            string key = "stage_essence:" + run.stageCode;
            if (!force && run.Flag(key) != 0) return false;
            run.SetFlag(key, 1);
            run.CreditEssence(EssencePerStage, source);
            return true;
        }

        /// <summary>当前章（0 起；没开局按 0）</summary>
        public static int Chapter => RunState.Current != null ? Mathf.Max(0, RunState.Current.chapter - 1) : 0;

        /// <summary>击杀灵石章节系数 1 + 0.15 × 章</summary>
        public static float KillChapterMult(int chapter) => 1 + KillChapterCoin * Mathf.Max(0, chapter);

        /// <summary>一次性奖励章节系数 1 + 0.35 × 章</summary>
        public static float RewardChapterMult(int chapter) => 1 + RewardChapterCoin * Mathf.Max(0, chapter);

        /// <summary>商店价格章节系数 1 + 0.25 × 章</summary>
        public static float ShopChapterMult(int chapter) => 1 + ShopChapterPrice * Mathf.Max(0, chapter);

        /// <summary>某敌人这次掉多少灵石（灵石获取加成不在这里乘，入账时乘）：定义的 [lo, hi] 掷整数 × 精英 3 × 章节系数，四舍五入</summary>
        public static int KillCoins(Vector2Int range, Rank rank, int chapter, RunRng rng)
        {
            int lo = range.x, hi = range.y;
            if (rank == Rank.Boss && hi <= 0)
            {
                lo = BossCoinsMin;
                hi = BossCoinsMax;
            }
            if (hi <= 0) return 0;
            int baseValue = rng != null ? rng.Int(Mathf.Max(0, lo), Mathf.Max(0, hi)) : Random.Range(Mathf.Max(0, lo), Mathf.Max(0, hi) + 1);
            if (rank == Rank.Elite) baseValue *= EliteKillCoinMult;
            return Mathf.RoundToInt(baseValue * KillChapterMult(chapter));
        }

        /// <summary>宝箱灵石：60–120 × 章节系数 × 精英场 1.4（灵石获取入账时乘）</summary>
        public static int ChestCoins(ChestTier tier, int chapter, RunRng rng)
        {
            int baseValue = rng != null ? rng.Int(ChestCoinsMin, ChestCoinsMax) : Random.Range(ChestCoinsMin, ChestCoinsMax + 1);
            return Mathf.RoundToInt(baseValue * RewardChapterMult(chapter) * (tier == ChestTier.Elite ? EliteChestCoinMult : 1));
        }

        /// <summary>一次性奖励的灵石（基数 × 章节系数）：强化满级转灵石、秘卷全满层转灵石</summary>
        public static int RewardCoins(int baseAmount, int chapter) => Mathf.RoundToInt(baseAmount * RewardChapterMult(chapter));

        /// <summary>武器奖励的保底品质（同 TS weaponRewardMinRarity）：首领第一章史诗、第二章起传说；精英精良；其余不保底（0）</summary>
        public static int WeaponMinRarity(ChestTier tier, int chapter) =>
            tier == ChestTier.Boss ? (chapter >= 1 ? Rarity.Legendary : Rarity.Epic) : tier == ChestTier.Elite ? Rarity.Uncommon : Rarity.Common;

        /// <summary>秘卷奖励的保底稀有度：精英 / 首领 1（精良），其余 0</summary>
        public static int ScrollMinRarity(ChestTier tier) => tier == ChestTier.Normal ? Rarity.Common : Rarity.Uncommon;

        /// <summary>
        /// 把宝箱档位写进奖励串（发放和提示共用，保证提示与实际一致）：
        ///   "weapon"（没指定 id / 品质 / 保底）→ "weapon:min=N"；"scroll"（没写 min）→ "scroll:min=1"；"coins" → "coins:tier=elite"。
        /// 关卡里写死的奖励（指定了武器 id、品质或保底）原样保留。
        /// </summary>
        public static string ApplyTier(string reward, ChestTier tier, int chapter)
        {
            if (string.IsNullOrEmpty(reward) || tier == ChestTier.Normal) return reward;
            var args = RewardRegistry.Split(reward);
            switch (args[0])
            {
                case "weapon":
                    if (args.Length > 1) return reward;
                    int min = WeaponMinRarity(tier, chapter);
                    return min > 0 ? $"weapon:min={min}" : reward;
                case "scroll":
                    foreach (var a in args)
                        if (a.StartsWith("min="))
                            return reward;
                    return reward + ":min=" + ScrollMinRarity(tier);
                case "coins":
                    foreach (var a in args)
                        if (a.StartsWith("tier="))
                            return reward;
                    return reward + ":tier=" + (tier == ChestTier.Boss ? "boss" : "elite");
                default:
                    return reward;
            }
        }

        /// <summary>奖励串里的 tier=…（没有为 Normal）</summary>
        public static ChestTier TierOf(string[] args)
        {
            if (args != null)
                foreach (var a in args)
                    if (a == "tier=elite") return ChestTier.Elite;
                    else if (a == "tier=boss") return ChestTier.Boss;
            return ChestTier.Normal;
        }

        /// <summary>奖励串里的整数参数 key=N（没有为 fallback）</summary>
        public static int IntArg(string[] args, string key, int fallback)
        {
            if (args == null) return fallback;
            var prefix = key + "=";
            foreach (var a in args)
                if (a != null && a.StartsWith(prefix) && int.TryParse(a.Substring(prefix.Length), out var v))
                    return v;
            return fallback;
        }

        // ───────────── 入账 ─────────────

        static float carry;
        static RunState carryRun;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            carry = 0;
            carryRun = null;
        }

        /// <summary>当前灵石获取倍率（1 + CoinGainPct，下限 0.05）</summary>
        public static float CoinGain => Combat.playerStats?.Mult(Stat.CoinGainPct) ?? 1f;

        /// <summary>
        /// 灵石入账（拾取、溢出、掉出世界）：× 灵石获取，只在这里乘一次。小数部分留到下一次（同一局内），
        /// 一颗 1 灵石 × 1.08 不会因为四舍五入白白丢掉加成。返回实际入账数
        /// </summary>
        public static int CreditCoins(int baseAmount, string source = "pickup")
        {
            if (baseAmount <= 0) return 0;
            var run = RunState.Ensure();
            if (run != carryRun)
            {
                carryRun = run;
                carry = 0;
            }
            carry += baseAmount * CoinGain;
            int whole = Mathf.FloorToInt(carry + 1e-4f);
            carry = Mathf.Max(0, carry - whole);
            if (whole > 0) run.Credit(whole, source);
            return whole;
        }

        // ───────────── 投影 ─────────────

        /// <summary>
        /// 投影的可调假设：编制按各关实际遭遇（<see cref="BalanceModel.Stages"/>），这里只留表里没有的。
        /// （R1 原来按 1-1 外推「每图 32 只、每章 +25%、每图 0.5 个灵石宝箱」，比扫场景多约两成；I3 改成逐关实际编制，
        /// 和 EconomyProjectionSuite 直接扫 12 关场景的结果差 2% 以内，docs/balance.md 第五节）
        /// </summary>
        public struct ProjectionInputs
        {
            /// <summary>首领场里随首领出来的杂兵击杀数</summary>
            public int killsPerBossStage;
            /// <summary>灵石获取加成（0 = 无）</summary>
            public float coinGainPct;

            public static ProjectionInputs Default => new() { killsPerBossStage = BalanceModel.BossStageAdds, coinGainPct = 0 };
        }

        /// <summary>一章的收入估算</summary>
        public struct ChapterIncome
        {
            public int chapter, fieldStages, bossStages;
            public float kills, killCoins, chestCoins, bossCoins, essence;
            public float Total => killCoins + chestCoins + bossCoins;
            /// <summary>这一章的收入够买几把稀有武器（商店价 × 章节系数）</summary>
            public float RareWeapons => Total / (WeaponPrice[Rarity.Rare] * ShopChapterMult(chapter));
        }

        /// <summary>
        /// 按 RunPlan 的关卡表估每章收入（期望值，不含商店消费、灵宠、调试）：逐关用 <see cref="BalanceModel.Estimate"/>——
        ///   击杀 = 各关实际编制的灵石区间中点（精英 × 3）× (1 + 0.15 × 章)；窖藏 = 灵石窖藏数 × 90 × (1 + 0.35 × 章)；
        ///   首领（含 3-3 的领主）= 灵石中点 × (1 + 0.15 × 章)；魂晶 = 各敌人定义（精英 × 5）+ 首领 60 + 每关 10。灵石 × 灵石获取。
        /// </summary>
        public static List<ChapterIncome> Project(ProjectionInputs p)
        {
            var rows = new Dictionary<int, ChapterIncome>();
            float gain = Mathf.Max(0.05f, 1 + p.coinGainPct);
            foreach (var s in RunPlan.Stages)
            {
                int ch = s.chapter - 1;
                rows.TryGetValue(ch, out var r);
                r.chapter = ch;
                var e = BalanceModel.Estimate(s, p.killsPerBossStage);
                if (s.IsBoss) r.bossStages++;
                else r.fieldStages++;
                r.kills += e.kills;
                r.killCoins += e.killCoins * gain;
                r.chestCoins += e.cacheCoins * gain;
                r.bossCoins += e.bossCoins * gain;
                r.essence += e.essence;
                rows[ch] = r;
            }
            var list = new List<ChapterIncome>(rows.Values);
            list.Sort((a, b) => a.chapter.CompareTo(b.chapter));
            return list;
        }

        public static List<ChapterIncome> Project() => Project(ProjectionInputs.Default);

        /// <summary>投影表（日志 / 调试面板）</summary>
        public static string FormatProjection(List<ChapterIncome> rows, ProjectionInputs p)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"[Economy] 每章收入投影（各关实际编制，首领场杂兵 {p.killsPerBossStage} 只，灵石获取 +{p.coinGainPct:P0}）");
            sb.AppendLine("章 | 大图+首领 | 击杀 | 击杀灵石 | 窖藏灵石 | 首领灵石 | 合计 | 累计 | 稀有武器价 | 可买稀有武器 | 魂晶");
            float cumulative = 0;
            foreach (var r in rows)
            {
                cumulative += r.Total;
                int price = Mathf.RoundToInt(WeaponPrice[Rarity.Rare] * ShopChapterMult(r.chapter) / 5f) * 5;
                sb.AppendLine($"{r.chapter + 1} | {r.fieldStages}+{r.bossStages} | {r.kills:0} | {r.killCoins:0} | {r.chestCoins:0} | {r.bossCoins:0} | " +
                              $"{r.Total:0} | {cumulative:0} | {price} | {r.RareWeapons:0.0} | {r.essence:0}");
            }
            return sb.ToString();
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>把每章收入投影打到日志（D24 调经济用）。没有热键（F10 归战斗调试叠层清零），用 DevCommands.Run("economy")</summary>
    [Defs]
    public sealed class EconomyProjectionCommand : DevCommand
    {
        public override string Id => "economy";
        public override string Label => "经济投影";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var p = EconomyConfig.ProjectionInputs.Default;
            p.coinGainPct = Combat.playerStats?.Get(Stat.CoinGainPct) ?? 0;
            var rows = EconomyConfig.Project(p);
            Debug.Log(EconomyConfig.FormatProjection(rows, p));
            float total = 0;
            foreach (var r in rows) total += r.Total;
            DevCommands.Say($"经济投影已写入日志：整局约 {total:0} 灵石");
        }
    }
#endif
}
