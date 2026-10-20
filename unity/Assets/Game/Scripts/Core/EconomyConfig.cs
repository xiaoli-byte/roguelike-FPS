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

        // ───────────── 商店参照（R3 落地商店时用）─────────────

        /// <summary>武器价格（按稀有度）× (1 + 0.25 × 章)，取整到 5</summary>
        public static readonly int[] WeaponPrice = { 60, 100, 160, 240, 360 };
        public const float ShopChapterPrice = 0.25f;
        public const int ScrollPriceMin = 80, ScrollPriceMax = 220, PotionPrice = 40, AmmoCratePrice = 20;

        // ───────────── 魂晶（局外，R2）─────────────

        /// <summary>每清一关 / 胜利额外的魂晶（击杀魂晶见 <see cref="KillResolver.EssenceFor"/>）</summary>
        public const int EssencePerStage = 10, EssenceVictory = 200;

        // ───────────── 公式 ─────────────

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

        /// <summary>投影的假设（缺省值来自 1-1：4 个据点约 32 只、2 只精英；第 4 批 I3 按实际地图回填）</summary>
        public struct ProjectionInputs
        {
            /// <summary>每张开放大图的击杀数（第一章）、其中精英数</summary>
            public float killsPerField, elitesPerField;
            /// <summary>每章敌人数量的增长（× (1 + 值 × 章)）</summary>
            public float killGrowthPerChapter;
            /// <summary>首领场里的杂兵击杀数</summary>
            public float killsPerBossStage;
            /// <summary>普通敌人击杀灵石的平均基数（缺省：按名册里普通敌人 coins 区间中点平均）</summary>
            public float avgKillCoins;
            /// <summary>每张开放大图的灵石宝箱数、其中精英场的比例</summary>
            public float coinChestsPerField, eliteChestShare;
            /// <summary>首领灵石中点</summary>
            public float bossCoins;
            /// <summary>灵石获取加成（0 = 无）</summary>
            public float coinGainPct;

            public static ProjectionInputs Default => new()
            {
                killsPerField = 32, elitesPerField = 2, killGrowthPerChapter = 0.25f, killsPerBossStage = 8,
                avgKillCoins = AverageRosterCoins(), coinChestsPerField = 0.5f, eliteChestShare = 0.3f,
                bossCoins = (BossCoinsMin + BossCoinsMax) * 0.5f, coinGainPct = 0,
            };
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

        /// <summary>名册里普通敌人 coins 区间中点的平均（没有名册时 3）</summary>
        public static float AverageRosterCoins()
        {
            float sum = 0;
            int n = 0;
            foreach (var d in Registry<EnemyDef>.All)
            {
                if (d.rank != Rank.Normal || d.coins.y <= 0) continue;
                sum += (d.coins.x + d.coins.y) * 0.5f;
                n++;
            }
            return n > 0 ? sum / n : 3f;
        }

        /// <summary>
        /// 按 RunPlan 的关卡表估每章收入（期望值，不含商店消费、灵宠、调试）：
        ///   击杀 = (普通 × 平均灵石 + 精英 × 平均灵石 × 3) × (1 + 0.15 × 章)；宝箱 = 灵石宝箱数 × 90 × (1 + 0.35 × 章) × 精英份额加成；
        ///   首领 = 中点 × (1 + 0.15 × 章)；魂晶 = 普通 1 / 精英 5 / 首领 60 + 每关 10。全部 × 灵石获取。
        /// </summary>
        public static List<ChapterIncome> Project(ProjectionInputs p)
        {
            var rows = new Dictionary<int, ChapterIncome>();
            foreach (var s in RunPlan.Stages)
            {
                int ch = s.chapter - 1;
                rows.TryGetValue(ch, out var r);
                r.chapter = ch;
                float grow = 1 + p.killGrowthPerChapter * ch;
                float gain = Mathf.Max(0.05f, 1 + p.coinGainPct);
                if (s.IsBoss)
                {
                    r.bossStages++;
                    float adds = p.killsPerBossStage * grow;
                    r.kills += adds + 1;
                    r.killCoins += adds * p.avgKillCoins * KillChapterMult(ch) * gain;
                    r.bossCoins += p.bossCoins * KillChapterMult(ch) * gain;
                    r.essence += adds * KillResolver.DefaultEssence + KillResolver.BossEssence;
                }
                else
                {
                    r.fieldStages++;
                    float elites = p.elitesPerField * grow;
                    float normals = Mathf.Max(0, p.killsPerField * grow - elites);
                    r.kills += normals + elites;
                    r.killCoins += (normals + elites * EliteKillCoinMult) * p.avgKillCoins * KillChapterMult(ch) * gain;
                    float chestAvg = (ChestCoinsMin + ChestCoinsMax) * 0.5f * RewardChapterMult(ch) * (1 + p.eliteChestShare * (EliteChestCoinMult - 1));
                    r.chestCoins += p.coinChestsPerField * chestAvg * gain;
                    r.essence += normals * KillResolver.DefaultEssence + elites * KillResolver.DefaultEssence * KillResolver.EliteEssenceMult;
                }
                r.essence += EssencePerStage;
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
            sb.AppendLine($"[Economy] 每章收入投影（每图 {p.killsPerField:0} 杀 / 精英 {p.elitesPerField:0}，每章敌人 +{p.killGrowthPerChapter:P0}，" +
                          $"平均击杀灵石 {p.avgKillCoins:0.0}，每图灵石宝箱 {p.coinChestsPerField:0.##}，灵石获取 +{p.coinGainPct:P0}）");
            sb.AppendLine("章 | 大图+首领 | 击杀 | 击杀灵石 | 宝箱灵石 | 首领灵石 | 合计 | 累计 | 稀有武器价 | 可买稀有武器 | 魂晶");
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
