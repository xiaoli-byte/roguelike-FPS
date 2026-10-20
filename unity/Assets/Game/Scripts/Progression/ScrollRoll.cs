using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷抽取（Three.js 版 src/progression/Scrolls.ts 的 roll，纯函数，可单测）：
    ///   池子：稀有度 ≥ minRarity、未满层、英雄专属只给对应英雄、不在 exclude 里；不放回地抽 count 张。
    ///   权重：基础 [100, 52, 26, 11, 4]（按稀有度）
    ///         × (1 + 稀有度 × (0.1 × 幸运 + 0.18 × 章))      —— 幸运、章节提高高稀有度的权重（章从 0 起，同 TS）
    ///         × 1.3 已拥有（鼓励叠层）× 1.5 英雄专属
    ///         反应卷（标签「反应」）：非专属 × 1.4 有元素来源 / × 0.5 没有；未拥有且属于已投入的流派（焚雷 / 熔金 / 封脉 / 归墟）再 × 1.3。
    ///   元素来源：元素英雄（燎 fox / 鼯 falcon）、任一武器带元素或副元素 / 万象 / 轮回词条、已拥有任一「元素」标签的秘卷。
    /// 抽法同 TS rng.weighted：r = 随机 × 总权重，依次减去各项权重，减到 ≤ 0 取当前项。
    /// 精英 / 首领奖励的 min = 1、全满层转灵石由掉落系统（LootDirector）处理。
    /// </summary>
    public static class ScrollRoll
    {
        /// <summary>各稀有度的基础权重（普通 → 传说）</summary>
        public static readonly float[] RarityWeight = { 100, 52, 26, 11, 4 };
        public const float LuckPerRarity = 0.1f, ChapterPerRarity = 0.18f;
        public const float OwnedMult = 1.3f, HeroOnlyMult = 1.5f, ReactionWithSource = 1.4f, ReactionWithoutSource = 0.5f, FlowMult = 1.3f;
        /// <summary>反应秘卷 / 元素秘卷的标签</summary>
        public const string ReactionTag = "反应", ElementTag = "元素";
        /// <summary>反应流派标签</summary>
        public static readonly string[] FlowTags = { "焚雷", "熔金", "封脉", "归墟" };
        /// <summary>自带元素技能的英雄（HeroDef.id）</summary>
        public static readonly string[] ElementHeroes = { "fox", "falcon" };
        /// <summary>提供额外元素来源的武器词条 / 传说特性</summary>
        public static readonly string[] ElementAffixes = { "subFire", "subShock", "subCorrode", "lg_prism", "lg_lunhui" };

        /// <summary>一次抽取的条件</summary>
        public struct Context
        {
            public string heroId;
            /// <summary>幸运（≥ 0）</summary>
            public float luck;
            /// <summary>章（0 起，同 TS run.chapter）</summary>
            public int chapter;
            public int minRarity;
            /// <summary>已持有的层数（id → 层）；null = 什么都没有</summary>
            public IReadOnlyDictionary<string, int> stacks;
            public bool hasElementSource;
            /// <summary>已投入的反应流派（已拥有秘卷标签里出现过的流派）</summary>
            public ICollection<string> flows;
            /// <summary>不要的 id（商店已上架的…）</summary>
            public ICollection<string> exclude;

            public int Stacks(string id) => stacks != null && id != null && stacks.TryGetValue(id, out var n) ? n : 0;
            public bool Owned(string id) => Stacks(id) > 0;
        }

        /// <summary>这一卷能不能进池子</summary>
        public static bool Eligible(ScrollDef d, in Context c) =>
            d != null &&
            d.rarity >= c.minRarity &&
            c.Stacks(d.id) < d.maxStacks &&
            (d.heroOnly == null || d.heroOnly == c.heroId) &&
            !(c.exclude != null && c.exclude.Contains(d.id));

        /// <summary>这一卷的抽取权重（同 TS weight）</summary>
        public static float Weight(ScrollDef d, in Context c)
        {
            int r = Rarity.Clamp(d.rarity);
            float w = RarityWeight[r];
            w *= 1 + r * (LuckPerRarity * Mathf.Max(0, c.luck) + ChapterPerRarity * Mathf.Max(0, c.chapter));
            bool owned = c.Owned(d.id);
            if (owned) w *= OwnedMult;
            if (d.heroOnly != null) w *= HeroOnlyMult;
            if (d.HasTag(ReactionTag))
            {
                if (d.heroOnly == null) w *= c.hasElementSource ? ReactionWithSource : ReactionWithoutSource;
                if (!owned && c.flows != null && c.flows.Count > 0)
                    foreach (var t in d.tags)
                        if (c.flows.Contains(t))
                        {
                            w *= FlowMult;
                            break;
                        }
            }
            return w;
        }

        /// <summary>按条件过滤后的池子</summary>
        public static List<ScrollDef> Pool(IReadOnlyList<ScrollDef> all, in Context c)
        {
            var pool = new List<ScrollDef>();
            if (all == null) return pool;
            foreach (var d in all)
                if (Eligible(d, c)) pool.Add(d);
            return pool;
        }

        /// <summary>只抽一张时每卷被抽中的概率（权重 / 总权重）：测试按它比对抽样分布</summary>
        public static Dictionary<ScrollDef, double> Probabilities(IReadOnlyList<ScrollDef> all, in Context c)
        {
            var pool = Pool(all, c);
            var p = new Dictionary<ScrollDef, double>();
            double total = 0;
            foreach (var d in pool) total += Math.Max(0, Weight(d, c));
            foreach (var d in pool) p[d] = total > 0 ? Math.Max(0, Weight(d, c)) / total : 1.0 / pool.Count;
            return p;
        }

        /// <summary>不放回地按权重抽 count 张（池子不够就少给）</summary>
        public static List<ScrollDef> Roll(IReadOnlyList<ScrollDef> all, int count, in Context c, RunRng rng)
        {
            rng ??= Rng;
            var pool = Pool(all, c);
            var weights = new List<double>(pool.Count);
            foreach (var d in pool) weights.Add(Math.Max(0, Weight(d, c)));
            var picked = new List<ScrollDef>();
            int n = Mathf.Max(0, count);
            while (picked.Count < n && pool.Count > 0)
            {
                int i = Pick(weights, rng);
                picked.Add(pool[i]);
                pool.RemoveAt(i);
                weights.RemoveAt(i);
            }
            return picked;
        }

        /// <summary>同 TS rng.weighted：权重全 ≤ 0 时均匀挑</summary>
        static int Pick(List<double> weights, RunRng rng)
        {
            double total = 0;
            foreach (var w in weights) total += w;
            if (total <= 0) return (int)(rng.NextDouble() * weights.Count);
            double r = rng.NextDouble() * total;
            for (int i = 0; i < weights.Count; i++)
            {
                r -= weights[i];
                if (r <= 0) return i;
            }
            return weights.Count - 1;
        }

        // ───────────── 从当前局取条件 ─────────────

        static RunRng fallbackRng;

        /// <summary>抽卷用的随机流（局种子 + 当前关 + "scrolls"；没开局时按时钟播种）</summary>
        public static RunRng Rng => RunState.Current?.Stream("scrolls") ?? (fallbackRng ??= new RunRng(Environment.TickCount));

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallbackRng = null;

        /// <summary>当前章（0 起）：RunState 的章从 1 起</summary>
        public static int CurrentChapter => RunState.Current != null ? Mathf.Max(0, RunState.Current.chapter - 1) : 0;

        /// <summary>
        /// 按当前局 / 玩家生成抽取条件：英雄（参数 → 玩家的 HeroSkills → RunState）、幸运、章、持有层数、元素来源、流派
        /// </summary>
        public static Context ContextFor(ScrollInventory inv, PlayerVitals pv, string heroId = null, int minRarity = 0)
        {
            if (string.IsNullOrEmpty(heroId))
            {
                var hero = pv ? pv.GetComponent<HeroSkills>() : null;
                heroId = hero ? hero.heroId : RunState.Current?.heroId;
            }
            var stats = pv ? pv.stats : Combat.playerStats;
            var wc = pv ? pv.GetComponent<WeaponController>() : null;
            var owned = new List<ScrollDef>();
            if (inv != null)
                foreach (var kv in inv.All)
                    if (kv.Value > 0 && ScrollLibrary.Get(kv.Key) is { } d)
                        owned.Add(d);
            return new Context
            {
                heroId = heroId,
                luck = Mathf.Max(0, stats?.Get(Stat.Luck) ?? 0),
                chapter = CurrentChapter,
                minRarity = minRarity,
                stacks = inv?.All,
                hasElementSource = HasElementSource(heroId, wc ? wc.slots : null, owned),
                flows = Flows(owned),
            };
        }

        /// <summary>本局是否已有元素来源：元素英雄、任一武器带元素或元素词条、已拥有任一元素类秘卷</summary>
        public static bool HasElementSource(string heroId, IEnumerable<WeaponInstance> weapons, IEnumerable<ScrollDef> owned)
        {
            if (heroId != null && Array.IndexOf(ElementHeroes, heroId) >= 0) return true;
            if (weapons != null)
                foreach (var w in weapons)
                {
                    if (w == null) continue;
                    if (w.element != Element.None) return true;
                    foreach (var a in w.affixes)
                        if (Array.IndexOf(ElementAffixes, a.id) >= 0)
                            return true;
                }
            if (owned != null)
                foreach (var d in owned)
                    if (d != null && d.HasTag(ElementTag))
                        return true;
            return false;
        }

        /// <summary>已拥有秘卷的标签里出现过的反应流派</summary>
        public static HashSet<string> Flows(IEnumerable<ScrollDef> owned)
        {
            var set = new HashSet<string>();
            if (owned == null) return set;
            foreach (var d in owned)
            {
                if (d == null) continue;
                foreach (var t in d.tags)
                    if (Array.IndexOf(FlowTags, t) >= 0)
                        set.Add(t);
            }
            return set;
        }
    }
}
