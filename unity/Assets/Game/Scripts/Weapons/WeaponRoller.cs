using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 随机生成武器（同 TS WeaponSystem.roll / rollRarity）：
    ///   1. 武器：指定 id 就用它，否则按 <see cref="WeaponDef.dropWeight"/> 加权抽（新机制武器略低）；
    ///   2. 品质：指定就用（夹到 0–4），否则按章节权重表 × 幸运抽，低于保底的权重为 0，抽完再抬到保底；
    ///   3. 元素：定义无元素、精良及以上时 35% 随机灼烧 / 雷殛 / 蚀化之一；
    ///   4. 词条：<see cref="AffixRoll"/>（固有词条最前、普通 0/1/1/2/3 条、传说再加一条特性）；
    ///   5. 弹匣、备弹按解析后的容量装满（计入玩家属性）。
    /// 章节从 0 起（0 = 第一章），超出表的按最后一章。局状态（W0-5 RunState）落地前章节取 <see cref="ChapterSource"/>（缺省 0）。
    /// 随机数：调用方可以传 System.Random（测试 / 种子局）；不传用 <see cref="Rng"/>（RunRng 落地后由它替换）。
    /// </summary>
    public static class WeaponRoller
    {
        /// <summary>各章稀有度权重（普通 / 精良 / 稀有 / 史诗 / 传说）：第一章以普通、精良为主，第三章常见史诗</summary>
        public static readonly float[][] ChapterRarity =
        {
            new[] { 58f, 32f, 8f, 2f, 0.4f },
            new[] { 28f, 36f, 24f, 9f, 3f },
            new[] { 10f, 26f, 32f, 22f, 10f },
        };

        /// <summary>精良及以上、定义无元素的武器获得随机元素的概率</summary>
        public const float RandomElementChance = 0.35f;
        /// <summary>随机元素的最低品质（精良）</summary>
        public const int RandomElementMinRarity = Rarity.Uncommon;
        public static readonly Element[] RandomElements = { Element.Fire, Element.Shock, Element.Corrode };

        /// <summary>幸运：普通的权重 ÷ (1 + 0.12 × 幸运)，其余 × (1 + 0.15 × 幸运 × 品质)</summary>
        public const float LuckCommonDiv = 0.12f, LuckRarityMul = 0.15f;

        /// <summary>当前章节（0 起）。RunState 落地后改成读 RunState.Current.chapter</summary>
        public static Func<int> ChapterSource;

        static System.Random shared;

        /// <summary>缺省随机源（没有传 rng 时用）。可以整体替换成种子局的随机源</summary>
        public static System.Random Rng
        {
            get => shared ??= new System.Random();
            set => shared = value;
        }

        public static int CurrentChapter => ChapterSource != null ? Mathf.Max(0, ChapterSource()) : 0;

        /// <summary>玩家当前幸运（没有玩家为 0；负数按 0）</summary>
        public static float CurrentLuck
        {
            get
            {
                var s = WeaponStatsResolver.PlayerStats;
                return s != null ? Mathf.Max(0, s.Get(Stat.Luck)) : 0;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            shared = null;
            ChapterSource = null;
        }

        /// <summary>按章节（0 起）、保底品质随机生成一把武器（id 为空 = 按掉落权重随机）。幸运与装弹用的属性取玩家当前；当前章节见 <see cref="CurrentChapter"/></summary>
        public static WeaponInstance Roll(int chapter, int minRarity = 0, string id = null, System.Random rng = null) =>
            Roll(new RollOptions { chapter = chapter, minRarity = minRarity, id = id }, rng);

        /// <summary>完整参数版（固定品质、指定幸运 / 属性表用这个）</summary>
        public static WeaponInstance Roll(in RollOptions o, System.Random rng = null)
        {
            rng ??= Rng;
            var def = !string.IsNullOrEmpty(o.id) ? WeaponLibrary.Get(o.id) : null;
            if (def == null)
            {
                if (!string.IsNullOrEmpty(o.id)) Debug.LogWarning($"[WeaponRoller] 没有武器「{o.id}」，改为随机");
                def = RollDef(rng);
            }
            if (def == null) return null;
            int min = Rarity.Clamp(o.minRarity);
            int rarity = o.rarity.HasValue ? Rarity.Clamp(o.rarity.Value) : RollRarity(o.chapter, min, o.luck ?? CurrentLuck, rng);
            if (rarity < min) rarity = min;
            var inst = new WeaponInstance(def, rarity);
            inst.element = RollElement(def, rarity, rng);
            // 词条：固有 → 按稀有度抽的普通词条（准入、重新过滤、perHit 归一）→ 传说特性
            inst.SetAffixes(AffixRoll.Roll(def, rarity, inst.element, rng));
            var r = WeaponStatsResolver.Resolve(inst, o.useNoStats ? null : o.stats ?? WeaponStatsResolver.PlayerStats);
            inst.mag = r.magCap;
            inst.reserve = r.reserveCap;
            return inst;
        }

        /// <summary><see cref="Roll(in RollOptions, System.Random)"/> 的参数</summary>
        public struct RollOptions
        {
            /// <summary>章节（0 起）</summary>
            public int chapter;
            /// <summary>保底品质</summary>
            public int minRarity;
            /// <summary>指定武器 id（空 = 随机）</summary>
            public string id;
            /// <summary>固定品质（不掷品质；仍会掷元素与词条）</summary>
            public int? rarity;
            /// <summary>幸运（缺省取玩家当前）</summary>
            public float? luck;
            /// <summary>装弹用的属性表（缺省取玩家当前）</summary>
            public StatSheet stats;
            /// <summary>装弹不计玩家属性（测试）</summary>
            public bool useNoStats;
        }

        /// <summary>按掉落权重抽一把武器定义</summary>
        public static WeaponDef RollDef(System.Random rng = null) =>
            Weighted(WeaponLibrary.All, d => d.dropWeight, rng ?? Rng);

        /// <summary>某章某品质的权重（含幸运、保底）；章节超出表按最后一章</summary>
        public static float RarityWeight(int chapter, int rarity, float luck, int minRarity = 0)
        {
            if (rarity < minRarity || rarity < 0 || rarity >= Rarity.Count) return 0;
            var row = ChapterRarity[Mathf.Clamp(chapter, 0, ChapterRarity.Length - 1)];
            float w = row[rarity];
            luck = Mathf.Max(0, luck);
            return rarity == 0 ? w / (1 + LuckCommonDiv * luck) : w * (1 + LuckRarityMul * luck * rarity);
        }

        /// <summary>按章节表 + 幸运抽品质（低于保底的不参与；全为 0 时返回保底）</summary>
        public static int RollRarity(int chapter, int minRarity, float luck, System.Random rng = null)
        {
            rng ??= Rng;
            minRarity = Rarity.Clamp(minRarity);
            float total = 0;
            for (int i = 0; i < Rarity.Count; i++) total += RarityWeight(chapter, i, luck, minRarity);
            if (!(total > 0)) return minRarity;
            double x = rng.NextDouble() * total;
            for (int i = 0; i < Rarity.Count; i++)
            {
                float w = RarityWeight(chapter, i, luck, minRarity);
                if (w <= 0) continue;
                if (x < w) return i;
                x -= w;
            }
            for (int i = Rarity.Count - 1; i >= minRarity; i--)
                if (RarityWeight(chapter, i, luck, minRarity) > 0) return i;
            return minRarity;
        }

        /// <summary>实例元素：定义有元素就用定义的；无元素且品质 ≥ 精良时 35% 随机一种</summary>
        public static Element RollElement(WeaponDef def, int rarity, System.Random rng = null)
        {
            if (def.element != Element.None || rarity < RandomElementMinRarity) return def.element;
            rng ??= Rng;
            if (rng.NextDouble() >= RandomElementChance) return Element.None;
            return RandomElements[rng.Next(RandomElements.Length)];
        }

        /// <summary>加权抽一项（权重 ≤ 0 的不参与；全为 0 时返回第一项，空表返回 default）</summary>
        public static T Weighted<T>(IReadOnlyList<T> items, Func<T, float> weight, System.Random rng)
        {
            if (items == null || items.Count == 0) return default;
            double total = 0;
            for (int i = 0; i < items.Count; i++) total += Math.Max(0, weight(items[i]));
            if (!(total > 0)) return items[0];
            double x = rng.NextDouble() * total;
            for (int i = 0; i < items.Count; i++)
            {
                float w = Math.Max(0, weight(items[i]));
                if (w <= 0) continue;
                if (x < w) return items[i];
                x -= w;
            }
            for (int i = items.Count - 1; i >= 0; i--)
                if (weight(items[i]) > 0) return items[i];
            return items[0];
        }

        /// <summary>[min, max) 均匀分布</summary>
        public static float Range(System.Random rng, float min, float max) => min + (float)rng.NextDouble() * (max - min);
    }
}
