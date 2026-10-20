using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Spiritfire.Game
{
    /// <summary>
    /// 生涯统计（Three.js 版 Meta.ts 的 stats + recordRun）：存档文件里的「career」段，每个档各一份，由 <see cref="MetaSave.BankRun"/> 记录。
    /// 网页版有的五项同名同义：局数、胜场、最远章节（1 起，0 = 没开过局）、单局最多清关、总击杀。
    /// Unity 多记的：阵亡（含放弃）与各章阵亡数、最快通关、单局最多击杀、总用时、总伤害、累计魂晶、各英雄的局数 / 胜场——主菜单「生涯」页用。
    /// </summary>
    public sealed class CareerStats : ISaveSection
    {
        public const string SectionKey = "career";

        public string Key => SectionKey;
        public int Version => 1;

        // ── 网页版五项 ──
        public int Runs { get; private set; }
        public int Wins { get; private set; }
        /// <summary>到达过的最远章节（1 起；0 = 从没开过局）</summary>
        public int BestChapter { get; private set; }
        /// <summary>单局最多清关数</summary>
        public int BestStages { get; private set; }
        public int TotalKills { get; private set; }

        // ── Unity 补充 ──
        /// <summary>没通关就结束的局（阵亡、放弃）</summary>
        public int Deaths { get; private set; }
        /// <summary>单局最多击杀</summary>
        public int MostKills { get; private set; }
        /// <summary>最快通关用时（秒；0 = 还没通关过）</summary>
        public float FastestWin { get; private set; }
        /// <summary>累计游玩时间（秒）、累计伤害</summary>
        public double TotalTime { get; private set; }
        public double TotalDamage { get; private set; }
        /// <summary>累计获得的魂晶（含已经花掉的）</summary>
        public long TotalEssence { get; private set; }

        readonly List<int> deathsByChapter = new();
        readonly Dictionary<string, int> heroRuns = new(), heroWins = new();

        /// <summary>各章阵亡数（下标 = 章 − 1）</summary>
        public IReadOnlyList<int> DeathsByChapter => deathsByChapter;

        /// <summary>当前档（<see cref="SaveService.Profile"/>）的生涯</summary>
        public static CareerStats Current => SaveService.Profile.Section<CareerStats>();

        public int DeathsInChapter(int chapter) => chapter >= 1 && chapter <= deathsByChapter.Count ? deathsByChapter[chapter - 1] : 0;
        public int RunsAs(string heroId) => heroId != null && heroRuns.TryGetValue(heroId, out var n) ? n : 0;
        public int WinsAs(string heroId) => heroId != null && heroWins.TryGetValue(heroId, out var n) ? n : 0;
        public float WinRate => Runs > 0 ? (float)Wins / Runs : 0;

        /// <summary>记一局（同 TS recordRun，另加 Unity 的几项）。只改内存，由 <see cref="MetaSave.BankRun"/> 统一写盘</summary>
        public void Record(RunSummary s)
        {
            if (s == null) return;
            Runs++;
            int kills = Math.Max(0, s.kills);
            if (s.victory)
            {
                Wins++;
                if (s.time > 0 && (FastestWin <= 0 || s.time < FastestWin)) FastestWin = s.time;
                if (!string.IsNullOrEmpty(s.heroId)) heroWins[s.heroId] = WinsAs(s.heroId) + 1;
            }
            else
            {
                Deaths++;
                if (s.chapter >= 1)
                {
                    while (deathsByChapter.Count < s.chapter) deathsByChapter.Add(0);
                    deathsByChapter[s.chapter - 1]++;
                }
            }
            if (!string.IsNullOrEmpty(s.heroId)) heroRuns[s.heroId] = RunsAs(s.heroId) + 1;
            BestChapter = Math.Max(BestChapter, s.chapter);
            BestStages = Math.Max(BestStages, s.stagesCleared);
            TotalKills += kills;
            MostKills = Math.Max(MostKills, kills);
            TotalTime += Math.Max(0, s.time);
            TotalDamage += Math.Max(0, s.damageDealt);
            TotalEssence += Math.Max(0, s.essenceEarned);
        }

        public string Capture()
        {
            var deaths = new JArray();
            foreach (var d in deathsByChapter) deaths.Add(d);
            var o = new JObject
            {
                ["runs"] = Runs,
                ["wins"] = Wins,
                ["bestChapter"] = BestChapter,
                ["bestStages"] = BestStages,
                ["totalKills"] = TotalKills,
                ["deaths"] = Deaths,
                ["deathsByChapter"] = deaths,
                ["mostKills"] = MostKills,
                ["fastestWin"] = FastestWin,
                ["totalTime"] = TotalTime,
                ["totalDamage"] = TotalDamage,
                ["totalEssence"] = TotalEssence,
                ["heroRuns"] = MetaJson.ToJson(heroRuns),
                ["heroWins"] = MetaJson.ToJson(heroWins),
            };
            return o.ToString(Formatting.None);
        }

        /// <summary>
        /// v1 = 网页版 stats 的超集（网页版存档迁过来只有前五项，其余为 0）。宽容读取：坏字段当 0。
        /// 网页版没有「阵亡」：迁过来时按 局数 − 胜场 补上（各章阵亡数无从得知，留空）。
        /// </summary>
        public void Restore(string json, int version)
        {
            Runs = Wins = BestChapter = BestStages = TotalKills = Deaths = MostKills = 0;
            FastestWin = 0;
            TotalTime = TotalDamage = 0;
            TotalEssence = 0;
            deathsByChapter.Clear();
            heroRuns.Clear();
            heroWins.Clear();
            var o = MetaJson.Object(json);
            if (o == null) return;
            Runs = MetaJson.NonNegInt(o["runs"]);
            Wins = Math.Min(Runs, MetaJson.NonNegInt(o["wins"]));
            BestChapter = MetaJson.NonNegInt(o["bestChapter"]);
            BestStages = MetaJson.NonNegInt(o["bestStages"]);
            TotalKills = MetaJson.NonNegInt(o["totalKills"]);
            Deaths = o["deaths"] != null ? MetaJson.NonNegInt(o["deaths"]) : Runs - Wins;
            deathsByChapter.AddRange(MetaJson.IntList(o["deathsByChapter"]));
            MostKills = MetaJson.NonNegInt(o["mostKills"]);
            FastestWin = (float)MetaJson.NonNeg(o["fastestWin"]);
            TotalTime = MetaJson.NonNeg(o["totalTime"]);
            TotalDamage = MetaJson.NonNeg(o["totalDamage"]);
            TotalEssence = (long)MetaJson.NonNeg(o["totalEssence"]);
            foreach (var (k, v) in MetaJson.IntMap(o["heroRuns"])) heroRuns[k] = v;
            foreach (var (k, v) in MetaJson.IntMap(o["heroWins"])) heroWins[k] = v;
        }
    }
}
