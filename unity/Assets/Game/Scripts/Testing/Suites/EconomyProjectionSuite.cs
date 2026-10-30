using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 经济与难度投影（I3 平衡，docs/balance.md 第 4–6 节；bridge.sh playtest economy；从 1-1 开，SceneFlow.GoTo 依次进 12 关，只扫场景、不打）：
    ///   · 每关扫场景里的编排：<see cref="EncounterSite"/> 的波次（只数、精英、升格）、场地宝箱 / 预摆的宝箱 / 支路藏宝点的奖励串、首领；
    ///     按 <see cref="EconomyConfig"/> 的公式算期望收入：击杀灵石 = 定义 coins 中点 × 精英 3 × (1 + 0.15 × 章)，宝箱灵石 = 90 × (1 + 0.35 × 章) × 精英场 1.4，
    ///     首领 = 定义的灵石中点 × 章节系数；魂晶 = 定义的 essence（精英 ×5、首领 60）+ 每关 10，通关另 +200。
    ///     两个口径：「全清」= 全部场地（含支路、藏宝点守军），「必经」= 不算标了 optional 的场地。
    ///   · 商店（补给营 1-3 / 2-4 / 3-4）：到店时手上的灵石 = 上一家店之后各关的收入（首领关的营地在首领前，不算这一关的首领灵石），
    ///     对比「核心篮子」（稀有秘卷 + 一次强化 + 战备药剂）和「整店」（两把枪按章节稀有度表的期望价 + 1.5 张秘卷 + 药剂 + 弹药 + 一次强化）：
    ///     只走必经的玩家买得起篮子、买不下整店（要取舍）；全清的玩家最多买下一整店（再多的钱去强化台，可以反复强化）。
    ///   · 魂晶：一局全清 / 死在各章首领的魂晶，对比天赋总价（10 项 × 5 级）。
    ///   · 逐关难度：每关敌人总耐久（三层 × 难度 × 精英 2.6）、普通 / 精英平均耐久，按 <see cref="Power"/> 的玩家成长折成击杀秒数。
    /// 判定（不合格）：<see cref="BasketRange"/>、<see cref="ShopRange"/>、<see cref="FullShopRange"/>、<see cref="ClearsRange"/> 之外，扫不到敌人 / 换关失败 / 运行时报错。
    /// 结果另写 CSV（结果文件同目录的 economy_projection.csv）。
    /// </summary>
    public sealed class EconomyProjectionSuite : PlaytestSuite
    {
        public override string Id => "economy";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";
        public const string CsvName = "economy_projection.csv";

        /// <summary>只走必经：到店灵石 ÷ 核心篮子——买得起核心三样，再多一两样</summary>
        public static readonly Vector2 BasketRange = new(1.0f, 2.5f);
        /// <summary>只走必经：到店灵石 ÷ 整店——买不下整店（要取舍），但也不是只能看</summary>
        public static readonly Vector2 ShopRange = new(0.4f, 0.9f);
        /// <summary>全清（支路、藏宝点都拿）：到店灵石 ÷ 整店——最多买下一整店，探索有回报但不至于钱多到没处花</summary>
        public static readonly Vector2 FullShopRange = new(0.6f, 1.15f);
        /// <summary>天赋总价 ÷ 一局全清的魂晶：点满全部天赋要几次全清</summary>
        public static readonly Vector2 ClearsRange = new(8f, 15f);

        /// <summary>
        /// 玩家成长模型（逐关难度用，docs/balance.md 6.1）：每关开打时手上那把枪的稀有度 / 强化、增伤秘卷的倍率。
        /// 依据：宝箱 / 商店的品质表与保底（第一章首领保底史诗、第二章起保底传说）、强化台每章一两次、三选一里约三成是增伤卷
        /// </summary>
        public static readonly Dictionary<string, (int rarity, int level, float scrolls)> Power = new()
        {
            ["1-1"] = (Rarity.Common, 0, 1.00f), ["1-2"] = (Rarity.Common, 1, 1.06f), ["1-3"] = (Rarity.Uncommon, 1, 1.10f), ["1-4"] = (Rarity.Uncommon, 1, 1.14f),
            ["2-1"] = (Rarity.Epic, 0, 1.17f), ["2-2"] = (Rarity.Epic, 1, 1.20f), ["2-3"] = (Rarity.Epic, 2, 1.23f), ["2-4"] = (Rarity.Epic, 2, 1.26f),
            ["3-1"] = (Rarity.Legendary, 0, 1.29f), ["3-2"] = (Rarity.Legendary, 1, 1.32f), ["3-3"] = (Rarity.Legendary, 1, 1.35f), ["3-4"] = (Rarity.Legendary, 2, 1.38f),
        };
        /// <summary>成长模型的基础秒伤（裂风步枪的裸秒伤，秒伤带中位）</summary>
        public const float BaseDps = 90f;

        sealed class Scan
        {
            public StageSpec stage;
            public int sites, optionalSites, normals, elites, normalsReq, elitesReq, caches;
            public float killCoins, killCoinsReq, essence, essenceReq, ehp, ehpNormal, ehpElite;
            public float chestCoins, chestCoinsReq;
            public int coinChests;
            public string bossId;
            public float bossCoins, bossEssence;
            public readonly SortedDictionary<string, int> rewards = new();
            public float Income => killCoins + chestCoins + bossCoins;
            public float IncomeReq => killCoinsReq + chestCoinsReq + bossCoins;
            public float FieldIncome => killCoins + chestCoins;
            public float Essence => essence + bossEssence + EconomyConfig.EssencePerStage;
            public float EssenceReq => essenceReq + bossEssence + EconomyConfig.EssencePerStage;
        }

        readonly List<Scan> scans = new();
        readonly List<string> csv = new();
        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            Application.logMessageReceived += OnLog;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            try
            {
                foreach (var stage in RunPlan.Stages)
                {
                    yield return Visit(stage);
                    if (scans.Count == 0 || scans[^1].stage != stage) yield break;
                }
                Report();
                WriteCsv();
                if (logErrors > 0) Fail($"期间有 {logErrors} 条运行时报错（最后一条：{lastError}）");
            }
            finally
            {
                Application.logMessageReceived -= OnLog;
            }
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 扫一关 ─────────────

        IEnumerator Visit(StageSpec stage)
        {
            float w0 = Time.realtimeSinceStartup;
            while ((!SceneFlow.Instance || SceneFlow.Instance.Busy || SceneFlow.Instance.Player == null) && Time.realtimeSinceStartup - w0 < 30f) yield return null;
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("SceneFlow / 玩家没就绪");
                yield break;
            }
            if (flow.Current != stage)
            {
                if (!flow.GoTo(stage))
                {
                    Fail($"去不了 {stage.Label}（场景 {stage.scene}）");
                    yield break;
                }
                yield return null;
                w0 = Time.realtimeSinceStartup;
                while ((flow.Busy || flow.Player == null || flow.Current != stage) && Time.realtimeSinceStartup - w0 < 120f) yield return null;
                if (flow.Busy || flow.Player == null || flow.Current != stage)
                {
                    Fail($"换到 {stage.Label} 超时（当前 {flow.Current?.Label}）");
                    yield break;
                }
            }
            if (flow.Player.vitals) flow.Player.vitals.invulnerableUntil = Time.time + 1e5f;
            yield return new WaitForSecondsRealtime(0.3f);
            var s = ScanStage(stage);
            scans.Add(s);
            Line($"{stage.Label}（难度 {stage.difficulty:F2}）：场地 {s.sites}（支路 {s.optionalSites}、藏宝点 {s.caches}），敌人 {s.normals} + 精英 {s.elites}（必经 {s.normalsReq} + {s.elitesReq}），" +
                 $"击杀灵石 {s.killCoins:F0}（必经 {s.killCoinsReq:F0}），宝箱灵石 {s.chestCoins:F0}（{s.coinChests} 箱），首领灵石 {s.bossCoins:F0}，" +
                 $"合计 {s.Income:F0}（必经 {s.IncomeReq:F0}）；魂晶 {s.Essence:F0}；奖励 {string.Join("、", s.rewards.Select(kv => $"{kv.Key}×{kv.Value}"))}");
            if (s.normals + s.elites == 0 && !stage.IsBoss) Fail($"{stage.Label}：场景里一只敌人都没扫到");
        }

        Scan ScanStage(StageSpec stage)
        {
            var s = new Scan { stage = stage };
            int ch = stage.chapter - 1;
            float killMult = EconomyConfig.KillChapterMult(ch), rewardMult = EconomyConfig.RewardChapterMult(ch);
            float chestAvg = (EconomyConfig.ChestCoinsMin + EconomyConfig.ChestCoinsMax) * 0.5f * rewardMult;
            var cacheGuards = new HashSet<EncounterSite>();
            foreach (var poi in FindObjectsByType<CachePOI>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (!poi) continue;
                s.caches++;
                if (poi.guard) cacheGuards.Add(poi.guard);
                AddReward(s, poi.reward, ChestTier.Normal, chestAvg, false);
            }
            foreach (var site in FindObjectsByType<EncounterSite>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (!site) continue;
                bool req = !site.optional && !cacheGuards.Contains(site);
                s.sites++;
                if (!req) s.optionalSites++;
                var squads = site.squads;
                int promote = site.spec != null && !site.spec.IsEmpty ? Mathf.Max(0, site.spec.promote) : 0;
                bool eliteSite = promote > 0;
                // 升格从普通单位里挑：按耐久最高的先升（只影响期望值的近似）
                var units = new List<(EnemyDef def, bool elite)>();
                foreach (var q in squads)
                {
                    if (q == null || q.count <= 0) continue;
                    var def = EnemyRoster.Get(q.enemy);
                    if (def == null) continue;
                    if (q.elite) eliteSite = true;
                    for (int i = 0; i < q.count; i++) units.Add((def, q.elite));
                }
                foreach (var idx in units.Select((u, i) => (u, i)).Where(x => !x.u.elite && x.u.def.rank == Rank.Normal)
                             .OrderByDescending(x => x.u.def.hp + x.u.def.armor + x.u.def.shield).Take(promote).Select(x => x.i).ToList())
                    units[idx] = (units[idx].def, true);
                foreach (var (def, elite) in units)
                {
                    var rank = elite ? Rank.Elite : def.rank;
                    float coins = def.coins.y > 0 ? (def.coins.x + def.coins.y) * 0.5f * (elite ? EconomyConfig.EliteKillCoinMult : 1) * killMult : 0;
                    float essence = KillResolver.EssenceFor(def, rank);
                    float ehp = (def.hp + def.armor + def.shield) * stage.difficulty * (elite ? 2.6f : 1f);
                    s.ehp += ehp;
                    if (elite) { s.elites++; s.ehpElite += ehp; }
                    else { s.normals++; s.ehpNormal += ehp; }
                    s.killCoins += coins;
                    s.essence += essence;
                    if (!req) continue;
                    if (elite) s.elitesReq++;
                    else s.normalsReq++;
                    s.killCoinsReq += coins;
                    s.essenceReq += essence;
                }
                if (!string.IsNullOrEmpty(site.reward))
                    AddReward(s, site.reward, stage.IsBoss ? ChestTier.Boss : eliteSite ? ChestTier.Elite : ChestTier.Normal, chestAvg, req);
            }
            foreach (var chest in FindObjectsByType<Chest>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (chest && !chest.Opened)
                    AddReward(s, chest.reward, chest.tier, chestAvg, true);
            // 清关宝箱（出口前；首领关的出口不落，首领宝箱代替，见 BossEncounter）
            if (!stage.IsBoss && !string.IsNullOrEmpty(stage.clearReward)) AddReward(s, stage.clearReward, stage.IsBoss ? ChestTier.Boss : ChestTier.Normal, chestAvg, true);
            var enc = FindObjectsByType<BossEncounter>(FindObjectsInactive.Include, FindObjectsSortMode.None).FirstOrDefault(e => e);
            var boss = enc ? Bosses.Get(enc.bossId) : null;
            if (boss != null)
            {
                s.bossId = boss.id;
                var r = boss.rewards;
                var range = r != null ? r.coins : new Vector2Int(EconomyConfig.BossCoinsMin, EconomyConfig.BossCoinsMax);
                s.bossCoins = (range.x + range.y) * 0.5f * killMult;
                s.bossEssence = r?.essence ?? KillResolver.BossEssence;
                if (r != null && !string.IsNullOrEmpty(r.chest)) AddReward(s, r.chest, r.chestTier, chestAvg, true);
            }
            return s;
        }

        static void AddReward(Scan s, string reward, ChestTier tier, float chestAvg, bool required)
        {
            if (string.IsNullOrEmpty(reward)) return;
            var key = RewardRegistry.Split(reward)[0];
            s.rewards.TryGetValue(key, out var n);
            s.rewards[key] = n + 1;
            if (key != "coins") return;
            if (reward.Contains("tier=elite")) tier = ChestTier.Elite;
            float v = chestAvg * (tier == ChestTier.Elite ? EconomyConfig.EliteChestCoinMult : 1f);
            s.coinChests++;
            s.chestCoins += v;
            if (required) s.chestCoinsReq += v;
        }

        // ───────────── 汇总 ─────────────

        static float Factor(int ch) => EconomyConfig.ShopChapterMult(ch);

        /// <summary>一把武器在第 ch 章商店的期望价（按章节稀有度表 × 保底）</summary>
        static float ExpectedWeaponPrice(int ch, int minRarity)
        {
            var w = WeaponRoller.ChapterRarity[Mathf.Clamp(ch, 0, WeaponRoller.ChapterRarity.Length - 1)];
            float sum = 0, p = 0;
            for (int r = 0; r < w.Length; r++)
            {
                float wt = r < minRarity ? 0 : w[r];
                sum += wt;
                p += wt * ShopPricing.Weapon(r, ch);
            }
            return sum > 0 ? p / sum : ShopPricing.Weapon(minRarity, ch);
        }

        /// <summary>到店时典型的强化等级（第一章 +1 → +2，第二章 +2 → +3，第三章传说 +1 → +2）</summary>
        static int TypicalLevel(int ch) => ch switch { 0 => 1, 1 => 2, _ => 1 };

        static float UpgradePrice(int ch) => WeaponLibrary.UpgradeCost(new WeaponInstance(WeaponLibrary.All[0]) { level = TypicalLevel(ch) }, ch) ?? 0;

        static float Basket(int ch) => ShopPricing.Scroll(Rarity.Rare, ch) + UpgradePrice(ch) + ShopPricing.Potion(ch);

        static float FullShop(int ch) =>
            ExpectedWeaponPrice(ch, 0) + ExpectedWeaponPrice(ch, ch >= 1 ? Rarity.Rare : Rarity.Uncommon) + 1.5f * ShopPricing.Scroll(Rarity.Rare, ch) +
            ShopPricing.Potion(ch) + ShopPricing.Ammo(ch) + UpgradePrice(ch);

        void Report()
        {
            csv.Add("stage,difficulty,sites,optional,normals,elites,kill_coins,kill_coins_req,chest_coins,boss_coins,income,income_req,essence,essence_req,ehp,ehp_normal_avg,ehp_elite_avg,dps_model,ttk_normal,ttk_elite,clear_seconds");
            // ── 逐关 ──
            Line("── 逐关收入与难度（期望值；击杀秒数 = 耐久 ÷ 成长模型秒伤）──");
            Line("关 | 难度 | 敌人 | 精英 | 收入（全清 / 必经） | 魂晶 | 总耐久 | 普通 / 精英平均耐久 | 模型秒伤 | 普通 / 精英击杀 s | 全清输出 s");
            foreach (var s in scans)
            {
                var pw = Power.TryGetValue(s.stage.code, out var v) ? v : (Rarity.Common, 0, 1f);
                float dps = BaseDps * WeaponLibrary.RarityDamage[pw.Item1] * (1 + WeaponLibrary.UpgradeStep * pw.Item2) * pw.Item3;
                float avgN = s.normals > 0 ? s.ehpNormal / s.normals : 0, avgE = s.elites > 0 ? s.ehpElite / s.elites : 0;
                Line($"{s.stage.code} | {s.stage.difficulty:F2} | {s.normals} | {s.elites} | {s.Income:F0} / {s.IncomeReq:F0} | {s.Essence:F0} | {s.ehp:F0} | {avgN:F0} / {avgE:F0} | {dps:F0} | " +
                     $"{avgN / dps:F2} / {avgE / dps:F1} | {s.ehp / dps:F0}");
                csv.Add(string.Join(",", s.stage.code, F(s.stage.difficulty), s.sites, s.optionalSites, s.normals, s.elites, F(s.killCoins), F(s.killCoinsReq), F(s.chestCoins),
                    F(s.bossCoins), F(s.Income), F(s.IncomeReq), F(s.Essence), F(s.EssenceReq), F(s.ehp), F(avgN), F(avgE), F(dps), F(avgN / dps), F(avgE / dps), F(s.ehp / dps)));
            }

            // ── 每章 ──
            Line("── 每章收入 ──");
            Line("章 | 关数 | 击杀灵石 | 宝箱灵石 | 首领灵石 | 合计（全清 / 必经） | 魂晶 | 稀有武器价 | 可买稀有武器");
            foreach (var g in scans.GroupBy(x => x.stage.chapter))
            {
                int ch = g.Key - 1;
                float total = g.Sum(x => x.Income), req = g.Sum(x => x.IncomeReq);
                float rare = ShopPricing.Weapon(Rarity.Rare, ch);
                Line($"{g.Key} | {g.Count()} | {g.Sum(x => x.killCoins):F0} | {g.Sum(x => x.chestCoins):F0} | {g.Sum(x => x.bossCoins):F0} | {total:F0} / {req:F0} | {g.Sum(x => x.Essence):F0} | {rare:F0} | {total / rare:F1}");
            }

            // ── 商店 ──
            Line("── 到店灵石 vs 商店价格（上一家店之后的收入；首领关营地在首领前）──");
            Line("店 | 章 | 到店灵石（全清 / 必经） | 核心篮子 | 整店 | 必经 ÷ 篮子 | 必经 ÷ 整店 | 全清 ÷ 整店");
            float since = 0, sinceReq = 0;
            foreach (var s in scans)
            {
                int ch = s.stage.chapter - 1;
                if (s.stage.supplyCamp)
                {
                    float coins = since + (s.stage.IsBoss ? s.FieldIncome : s.Income);
                    float coinsReq = sinceReq + (s.stage.IsBoss ? s.killCoinsReq + s.chestCoinsReq : s.IncomeReq);
                    float basket = Basket(ch), full = FullShop(ch);
                    float rb = coinsReq / basket, rf = coinsReq / full, rff = coins / full;
                    bool okB = rb >= BasketRange.x && rb <= BasketRange.y, okF = rf >= ShopRange.x && rf <= ShopRange.y, okFF = rff >= FullShopRange.x && rff <= FullShopRange.y;
                    Line($"{s.stage.code} | {s.stage.chapter} | {coins:F0} / {coinsReq:F0} | {basket:F0}（稀有秘卷 {ShopPricing.Scroll(Rarity.Rare, ch)} + 强化 {UpgradePrice(ch):F0} + 药剂 {ShopPricing.Potion(ch)}） | " +
                         $"{full:F0} | {rb:F2} {(okB ? "✓" : "✗")} | {rf:F2} {(okF ? "✓" : "✗")} | {rff:F2} {(okFF ? "✓" : "✗")}");
                    if (!okB) Fail($"{s.stage.code} 商店：必经到店灵石 {coinsReq:F0} ÷ 核心篮子 {basket:F0} = {rb:F2}，不在 {BasketRange.x}–{BasketRange.y}");
                    if (!okF) Fail($"{s.stage.code} 商店：必经到店灵石 {coinsReq:F0} ÷ 整店 {full:F0} = {rf:F2}，不在 {ShopRange.x}–{ShopRange.y}");
                    if (!okFF) Fail($"{s.stage.code} 商店：全清到店灵石 {coins:F0} ÷ 整店 {full:F0} = {rff:F2}，不在 {FullShopRange.x}–{FullShopRange.y}");
                    csv.Add($"shop_{s.stage.code},{ch},{F(coins)},{F(coinsReq)},{F(basket)},{F(full)},{F(rb)},{F(rf)},{F(rff)}");
                    since = s.stage.IsBoss ? s.bossCoins : 0;
                    sinceReq = since;
                }
                else
                {
                    since += s.Income;
                    sinceReq += s.IncomeReq;
                }
            }

            // ── 魂晶 ──
            int talentTotal = Registry<TalentDef>.All.Sum(t => t.TotalCost);
            float full1 = 0, fullReq = 0;
            var deathAt = new List<string>();
            foreach (var s in scans)
            {
                if (s.stage.IsBoss) deathAt.Add($"死在 {s.stage.code} 首领 {full1 + s.essence:F0}");
                full1 += s.Essence;
                fullReq += s.EssenceReq;
            }
            float clear = full1 + EconomyConfig.EssenceVictory, clearReq = fullReq + EconomyConfig.EssenceVictory;
            float clears = talentTotal / Mathf.Max(1, clear), clearsReq = talentTotal / Mathf.Max(1, clearReq);
            bool okC = clears >= ClearsRange.x && clears <= ClearsRange.y;
            Line("── 魂晶 vs 天赋 ──");
            Line($"天赋总价 {talentTotal}（{Registry<TalentDef>.All.Count} 项 × {string.Join(" / ", TalentDef.Costs)}）；一局全清 {clear:F0}（必经 {clearReq:F0}，含通关 +{EconomyConfig.EssenceVictory}）→ 点满要 {clears:F1} 次全清 {(okC ? "✓" : "✗")}（必经 {clearsReq:F1} 次）；" +
                 string.Join("、", deathAt) + $"；第一级全部 10 项 {Registry<TalentDef>.All.Count * TalentDef.Costs[0]}");
            if (!okC) Fail($"点满天赋要 {clears:F1} 次全清，不在 {ClearsRange.x}–{ClearsRange.y}");
            csv.Add($"essence,{talentTotal},{F(clear)},{F(clearReq)},{F(clears)},{F(clearsReq)}");

            // ── 回填 EconomyConfig.ProjectionInputs 的参考 ──
            var fields = scans.Where(x => !x.stage.IsBoss && x.stage.chapter == 1).ToList();
            if (fields.Count > 0)
                Line($"第一章大图平均（回填 ProjectionInputs）：击杀 {fields.Average(x => x.normals + x.elites):F1}、精英 {fields.Average(x => x.elites):F1}、灵石宝箱 {fields.Average(x => x.coinChests):F2}");
            var bossFields = scans.Where(x => x.stage.IsBoss).ToList();
            if (bossFields.Count > 0) Line($"首领关的杂兵（不算首领召唤）：平均 {bossFields.Average(x => x.normals + x.elites):F1} 只");
            var p = EconomyConfig.ProjectionInputs.Default;
            float model = EconomyConfig.Project(p).Sum(r => r.Total), scanned = scans.Sum(x => x.Income);
            Line($"EconomyConfig.Project() 缺省投影整局 {model:F0} 灵石 vs 扫场景 {scanned:F0}（×{scanned / Mathf.Max(1, model):F2}）");
        }

        static string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);

        void WriteCsv()
        {
            if (string.IsNullOrEmpty(ResultPath)) return;
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", CsvName);
                File.WriteAllText(path, string.Join("\n", csv) + "\n", new UTF8Encoding(true));
                Line($"CSV：{path}（{csv.Count - 1} 行）");
            }
            catch (IOException e)
            {
                Fail($"CSV 写不出来：{e.Message}");
            }
        }
    }
}
