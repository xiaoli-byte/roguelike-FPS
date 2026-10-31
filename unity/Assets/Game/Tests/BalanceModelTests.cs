using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// I3 平衡（docs/balance.md、<see cref="BalanceModel"/>）：
    ///   编制表与场景里的遭遇逐关一致；经济投影按实际编制；九张大图的战斗用时、四个首领的击杀用时都在参考秒伤曲线的目标带里；
    ///   装备计划贴着曲线、花钱的部分补给营买得起而整店买不下；通关一局的魂晶约要十局升满天赋；开放大图清关也发 +10 魂晶（只发一次）；
    ///   1-1 的武器奖励不会掷到随机元素（随机元素加入后 1-1 不变）。
    /// </summary>
    public sealed class BalanceModelTests
    {
        // ───────────── 编制表 ↔ 场景 ─────────────

        static readonly Regex Entry = new(@"- enemy: (\S+)\s*\n\s*count: (\d+)\s*\n\s*elite: (\d)", RegexOptions.Compiled);
        static readonly Regex Promote = new(@"\n\s+promote: (\d+)", RegexOptions.Compiled);
        static readonly Regex Reward = new(@"^  reward: (.*)$", RegexOptions.Compiled | RegexOptions.Multiline);

        /// <summary>场景里的遭遇：(编制合计, 升格, 灵石窖藏, 强化奖励, 全部奖励串)</summary>
        static (Dictionary<string, (int count, int elites)> squads, int promote, int caches, int upgrades, List<string> rewards) ScanScene(string scene)
        {
            string site = AssetDatabase.AssetPathToGUID("Assets/Game/Scripts/Encounters/EncounterSite.cs");
            string cache = AssetDatabase.AssetPathToGUID("Assets/Game/Scripts/Encounters/CachePOI.cs");
            var text = File.ReadAllText(Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, scene));
            Assume.That(!text.StartsWith("%TSD-Header"), $"{scene} 被透明加密（先跑 node scripts/unity/dlp-unity-fix.mjs）");
            var squads = new Dictionary<string, (int, int)>();
            var rewards = new List<string>();
            int promote = 0, caches = 0, upgrades = 0;
            foreach (var block in text.Split("\n--- !u!"))
            {
                bool isSite = block.Contains($"guid: {site}"), isCache = block.Contains($"guid: {cache}");
                if (!isSite && !isCache) continue;
                foreach (Match m in Reward.Matches(block))
                {
                    string r = m.Groups[1].Value.Trim();
                    if (r.Length == 0) continue;
                    rewards.Add(r);
                    if (r == "upgrade") upgrades++;
                    if (isCache && r == "coins") caches++;
                }
                if (!isSite) continue;
                var pm = Promote.Match(block);
                if (pm.Success) promote += int.Parse(pm.Groups[1].Value);
                foreach (Match m in Entry.Matches(block))
                {
                    string id = m.Groups[1].Value;
                    int n = int.Parse(m.Groups[2].Value);
                    squads.TryGetValue(id, out var q);
                    squads[id] = (q.Item1 + n, q.Item2 + (m.Groups[3].Value == "1" ? n : 0));
                }
            }
            return (squads, promote, caches, upgrades, rewards);
        }

        [Test]
        public void StageTable_MatchesSceneEncounters()
        {
            var fields = RunPlan.Stages.Where(s => !s.IsBoss).ToList();
            Assert.AreEqual(fields.Count, BalanceModel.Stages.Length, "每张开放大图一行");
            var problems = new List<string>();
            foreach (var s in fields)
            {
                var load = BalanceModel.Load(s.code);
                Assert.IsNotNull(load, $"编制表缺 {s.code}");
                if (!File.Exists(Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, s.scene)))
                {
                    TestContext.WriteLine($"{s.code} 的场景还没生成（第四章分期建），先按设计编制，生成后再对照");
                    continue;
                }
                var (squads, promote, caches, upgrades, _) = ScanScene(s.scene);
                var have = load.squads.ToDictionary(q => q.enemy, q => (q.count, q.elites));
                bool same = promote == load.promote && caches == load.coinCaches && upgrades == load.upgrades && squads.Count == have.Count &&
                            squads.All(kv => have.TryGetValue(kv.Key, out var h) && h == kv.Value);
                if (same) continue;
                string line = string.Join(", ", squads.Select(kv => kv.Value.Item2 > 0 ? $"S(\"{kv.Key}\", {kv.Value.Item1}, {kv.Value.Item2})" : $"S(\"{kv.Key}\", {kv.Value.Item1})"));
                problems.Add($"{s.code} 场景是 new(\"{s.code}\", {promote}, {caches}, {upgrades}, {line})");
            }
            Assert.IsEmpty(problems, "编制表和场景对不上（把下面的行贴进 BalanceModel.Stages，再看 docs/balance.md 的数字）：\n" + string.Join("\n", problems));
        }

        [Test]
        public void StageTable_EnemiesAreRegistered()
        {
            foreach (var load in BalanceModel.Stages)
            foreach (var q in load.squads)
            {
                // 第四章的雷魅由 E 路登记：登记前跳过（登记后同样要求全部在名册里）
                if (RunPlan.Get(load.code)?.chapter == 4 && EnemyRoster.Get(q.enemy) == null)
                {
                    TestContext.WriteLine($"{load.code} 的 {q.enemy} 还没登记（E 路）");
                    continue;
                }
                Assert.IsNotNull(EnemyRoster.Get(q.enemy), $"{load.code} 的 {q.enemy} 不在名册里");
                Assert.That(q.elites, Is.InRange(0, q.count), $"{load.code} {q}");
            }
        }

        // ───────────── 经济 ─────────────

        [Test]
        public void Projection_SumsStageEstimates()
        {
            var rows = EconomyConfig.Project();
            var stages = BalanceModel.EstimateRun();
            Assert.AreEqual(stages.Sum(e => e.Coins), rows.Sum(r => r.Total), 0.5f, "整局灵石 = 逐关估算之和");
            Assert.AreEqual(stages.Sum(e => e.essence), rows.Sum(r => r.essence), 0.5f, "整局魂晶 = 逐关估算之和");
            foreach (var r in rows)
                if (ChapterRosterReady(r.chapter))
                    Assert.Greater(r.kills, 100, $"第 {r.chapter + 1} 章击杀数按实际编制（三张大图 35–52 只 + 首领场；第四章两张大图）");
            TestContext.WriteLine(EconomyConfig.FormatProjection(rows, EconomyConfig.ProjectionInputs.Default));
        }

        /// <summary>这一章（0 起）的大图编制都已登记（第四章的雷魅登记前，按编制核对数量 / 收入的断言跳过这一章）</summary>
        static bool ChapterRosterReady(int ch) => BalanceModel.Stages.Where(l => RunPlan.Get(l.code)?.chapter - 1 == ch).All(BalanceModel.RosterReady);

        [Test]
        public void Camps_AffordThePlan_ButNotTheWholeShop()
        {
            foreach (var c in BalanceModel.Camps)
            {
                if (!ChapterRosterReady(c.Chapter))
                {
                    TestContext.WriteLine($"{c.at} 补给营：这一章的雷魅还没登记，跳过");
                    continue;
                }
                float budget = BalanceModel.CampBudget(c), shelf = BalanceModel.ShelfValue(c);
                int planned = BalanceModel.CampPlanned(c);
                TestContext.WriteLine($"{c.at} 补给营：预算 {budget:0}，计划花销 {planned}，整店 {shelf:0}（{budget / shelf:P0}）");
                Assert.GreaterOrEqual(budget, planned * 1.25f, $"{c.at}：计划里的强化 + 药剂之外还要剩钱挑一件");
                Assert.That(budget / shelf, Is.InRange(0.45f, 0.85f), $"{c.at}：能买大半、买不下整店（取舍才有意义）");
            }
        }

        [Test]
        public void GearPlan_TracksReferenceCurve()
        {
            foreach (var g in BalanceModel.Gear)
            {
                var stage = RunPlan.Get(g.before);
                Assert.IsNotNull(stage, g.before);
                float want = BalanceModel.GearMult(stage.difficulty), ratio = g.Mult / want;
                TestContext.WriteLine($"{g.before} 前 {Rarity.Name(g.rarity)} +{g.level}：×{g.Mult:0.00}，曲线 ×{want:0.00}（{ratio - 1:+0%;-0%}）");
                Assert.That(ratio, Is.InRange(1 - BalanceModel.GearTolerance, 1 + BalanceModel.GearTolerance), $"{g.before}：{g.why}");
                Assert.That(g.paidLevels, Is.InRange(0, g.level));
            }
            Assert.AreEqual(Rarity.Epic, BalanceModel.Gear[1].rarity, "2-4 前的史诗来自旱魃宝箱保底");
            Assert.AreEqual(Rarity.Epic, EconomyConfig.WeaponMinRarity(ChestTier.Boss, 0));
            Assert.AreEqual(Rarity.Legendary, EconomyConfig.WeaponMinRarity(ChestTier.Boss, 1), "3-x 的传说来自鲲鹏宝箱保底");
        }

        // ───────────── 武器秒伤带 ─────────────

        /// <summary>
        /// 秒伤带一律是裸口径（普通、身体、含换弹、不含暴击、不含元素克制 / 易伤 / 被动；榴弹的 Three.js 实测 111 已折成 88.8，见 WeaponDpsSuite.TsDps）。
        /// 这里离线核对整轮理论值 ±30%：理论值不含弹道下坠、散布脱靶、爆炸衰减、预热、第一发不用等，只拦明显的回归（定义改错、倍率漏乘）；
        /// 正式判定是 playtest weapon-dps 的实测裸秒伤 ±20%
        /// </summary>
        const float TheoryTolerance = 0.3f;

        [Test]
        public void Weapons_SustainedTheoryNearThreeJsBand()
        {
            var stats = StatSheet.Default();
            var off = new List<string>();
            var lines = new List<string>();
            float sum = 0;
            int n = 0;
            foreach (var def in WeaponLibrary.All)
            {
                var inst = new WeaponInstance(def);
                var r = WeaponStatsResolver.Resolve(inst, stats);
                bool melee = def.IsBlade || WeaponTakeovers.Find(inst) != null;
                // 裸口径：不乘元素打生命层的倍率（秒伤带也是裸的，同 weapon-dps 的判法）
                float theory = Testing.WeaponDpsSuite.SustainedTheory(def, r, melee);
                bool known = Testing.WeaponDpsSuite.TsDps.TryGetValue(def.id, out float ts);
                lines.Add($"{def.id}：整轮理论 {theory:0.0}{(known ? $"，Three.js {ts:0.#}（×{theory / ts:0.00}）" : "")}");
                Assert.Greater(theory, 0, def.id);
                if (known && (theory < ts * (1 - TheoryTolerance) || theory > ts * (1 + TheoryTolerance))) off.Add($"{def.id} {theory:0} / {ts:0.#}");
                sum += theory;
                n++;
            }
            float mean = sum / Mathf.Max(1, n);
            lines.Add($"平均 {mean:0.0}（参考曲线的基础 {BalanceModel.BaseDps}）");
            string table = "[Balance] 武器整轮理论秒伤（普通品质、身体、裸口径）\n" + string.Join("\n", lines);
            TestContext.WriteLine(table);
            Debug.Log(table);
            Assert.IsEmpty(off, $"整轮理论秒伤偏出 Three.js 秒伤带 ±{TheoryTolerance:P0}：" + string.Join("、", off));
            // 参考曲线的基础是主力武器裂风步枪的实测裸秒伤 90；18 把的整轮理论平均约 79（理论值不算第一发不用等，实测平均约 86）
            Assert.That(mean, Is.InRange(BalanceModel.BaseDps * 0.85f, BalanceModel.BaseDps * 1.15f), "武器平均秒伤和参考曲线的基础对得上");
        }

        // ───────────── 难度 ─────────────

        [Test]
        public void ReferenceCurve_MatchesQilinAnchor()
        {
            Assert.AreEqual(QilinDef.ReferenceDps(QilinDef.StageDifficulty), BalanceModel.ReferenceDps(QilinDef.StageDifficulty), 0.01f, "火麒麟的定档曲线就是参考曲线");
            Assert.AreEqual(BalanceModel.BaseDps * BalanceModel.KitMult * BalanceModel.Uptime, BalanceModel.ReferenceDps(1f), 1e-4f);
            Assert.AreEqual(BossBalance.Uptime, BalanceModel.Uptime, 1e-6f, "输出占比和首领浸泡的估算同一个数");
            for (float d = 1f; d < 3.2f; d += 0.16f)
                Assert.Greater(BalanceModel.GearMult(d) / d, 0.99f, $"难度 {d:0.00}：装备成长不落后于敌人耐久");
        }

        /// <summary>
        /// 参考曲线按首领浸泡校准（I3）：四个首领在代表配装下「可选中时」的实测秒伤（BossBalance.Soak，boss-soak 两次平均）
        /// 和曲线的 TargetableDps 差 ±15% 以内。改了武器 / 技能 / 秘卷 / 装备成长后先跑 boss-soak，再看这里
        /// </summary>
        [Test]
        public void ReferenceCurve_MatchesBossSoak()
        {
            foreach (var (stage, d, dps) in BossBalance.Soak)
            {
                Assert.AreEqual(RunPlan.Get(stage).difficulty, d, 1e-4f, $"{stage} 的难度");
                float ratio = BalanceModel.TargetableDps(d) / dps;
                TestContext.WriteLine($"{stage}：曲线 {BalanceModel.TargetableDps(d):0}，浸泡实测 {dps:0}（×{ratio:0.00}）");
                Assert.That(ratio, Is.InRange(0.85f, 1.15f), $"{stage}：参考曲线和首领浸泡的实测对不上");
            }
        }

        [Test]
        public void FieldStages_FightTimeWithinBand()
        {
            foreach (var e in BalanceModel.EstimateRun().Where(e => !e.stage.IsBoss && BalanceModel.RosterReady(BalanceModel.Load(e.stage.code))))
            {
                TestContext.WriteLine($"{e.stage.code}：{e.kills} 只（精英 {e.elites}），耐久 {e.fieldEhp:0}，参考秒伤 {BalanceModel.ReferenceDps(e.stage.difficulty):0}，约 {e.fieldSeconds:0} s");
                Assert.That(e.fieldSeconds, Is.InRange(BalanceModel.FieldMinSeconds, BalanceModel.FieldMaxSeconds), e.stage.Label);
            }
        }

        [Test]
        public void Bosses_KillTimeOnReferenceCurve()
        {
            foreach (var id in BalanceModel.BossIds)
            {
                float lo = BalanceModel.BossSeconds(id, 1 + BalanceModel.DpsSpread), mid = BalanceModel.BossSeconds(id), hi = BalanceModel.BossSeconds(id, 1 - BalanceModel.DpsSpread);
                TestContext.WriteLine($"{id}（难度 {BalanceModel.StageDifficultyOf(id):0.00}，参考秒伤 {BalanceModel.ReferenceDps(BalanceModel.StageDifficultyOf(id)):0}）：{lo:0} / {mid:0} / {hi:0} s");
                Assert.That(mid, Is.InRange(BalanceModel.BossMinSeconds, BalanceModel.BossMaxSeconds), $"{id} 参考秒伤");
                Assert.That(lo, Is.InRange(BalanceModel.BossMinSeconds * 0.9f, BalanceModel.BossMaxSeconds), $"{id} 秒伤 +15%");
                Assert.That(hi, Is.InRange(BalanceModel.BossMinSeconds, BalanceModel.BossMaxSeconds * 1.1f), $"{id} 秒伤 −15%");
            }
        }

        // ───────────── 魂晶 ─────────────

        [Test]
        public void Essence_TalentsTakeAboutTenWins()
        {
            Assert.AreEqual(11300, BalanceModel.TalentTotal, "10 项 × (60 + 120 + 200 + 300 + 450)");
            float win = BalanceModel.RunEssence(), die14 = BalanceModel.RunEssence("1-4");
            string report = BalanceModel.Report();
            TestContext.WriteLine(report);
            Debug.Log(report);
            Assert.That(win, Is.InRange(1000f, 1400f), "通关一局的魂晶");
            Assert.That(BalanceModel.TalentTotal / win, Is.InRange(7f, 12f), "约十次通关升满全部天赋");
            Assert.GreaterOrEqual(die14, TalentDef.Costs[0] * 3, "第一局死在旱魃也能点三个一级天赋");
            Assert.Greater(BalanceModel.RunEssence("2-4"), die14);
        }

        [Test]
        public void StageEssence_FieldClearCreditsOnce()
        {
            var run = new RunState { stageCode = "1-1" };
            Assert.IsTrue(EconomyConfig.CreditStageEssence(run, "stage_clear"));
            Assert.IsFalse(EconomyConfig.CreditStageEssence(run, "stage_clear"), "同一关只发一次");
            Assert.AreEqual(EconomyConfig.EssencePerStage, run.essence);
            run.stageCode = "1-4";
            Assert.IsTrue(EconomyConfig.CreditStageEssence(run, "boss_clear", true), "首领倒下时发");
            Assert.IsFalse(EconomyConfig.CreditStageEssence(run, "stage_clear"), "首领场出口不再发");
            Assert.AreEqual(EconomyConfig.EssencePerStage * 2, run.essence);
            var copy = SceneFlow.CloneRun(run);
            Assert.AreEqual(1, copy.Flag("stage_essence:1-4"), "进关快照带着标记");
        }

        // ───────────── 随机元素后的 1-1 ─────────────

        [Test]
        public void Stage11_WeaponRewardsCannotRollRandomElement()
        {
            var (_, _, _, _, rewards) = ScanScene(RunPlan.Get("1-1").scene);
            var weapons = rewards.Where(r => r.StartsWith("weapon")).ToList();
            Assert.IsNotEmpty(weapons);
            var rng = new System.Random(7);
            foreach (var r in weapons)
            {
                var spec = WeaponReward.Parse(r.Split(':'));
                Assert.IsNotNull(spec.id, $"1-1 的「{r}」是写死的武器");
                var def = WeaponLibrary.Get(spec.id);
                Assert.IsNotNull(def, r);
                int rarity = spec.rarity ?? spec.minRarity;
                for (int i = 0; i < 40; i++)
                    Assert.AreEqual(def.element, WeaponRoller.RollElement(def, rarity, rng), $"「{r}」（{Rarity.Name(rarity)}、定义元素 {def.element}）不该掷到随机元素");
            }
        }
    }
}
