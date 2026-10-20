using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局外成长（Three.js 版 src/progression/Meta.ts 的 MetaProgress）：魂晶余额（D13）、天赋等级、已解锁英雄。
    /// 是存档文件里的「meta」段：每个档（正式 / 调试）各一份，<see cref="Current"/> 取当前档的，<see cref="For"/> 取某一局该用的。
    /// 改动（买天赋、解锁英雄、结算入账）立即写盘并发 <see cref="GameEvents.MetaChanged"/>。
    /// 英雄（D8）：燎 / 鼯 / 磐默认全开；HeroDef.unlockCost 为 0 的也算解锁。
    /// 一局结束调 <see cref="BankRun"/>：魂晶入账 + 记生涯 + 写盘 + 发 <see cref="GameEvents.RunEnded"/>。
    /// TODO(L1 / U5)：SceneFlow / RunEnd（阵亡慢动作之后、放弃、最终首领倒下）必须调 BankRun，现在还没有地方调。
    /// </summary>
    public sealed class MetaSave : ISaveSection, ISaveFileBound
    {
        public const string SectionKey = "meta";
        /// <summary>天赋在属性表里的来源名（同 TS TALENT_SOURCE）</summary>
        public const string TalentSource = "talent";
        /// <summary>通关额外给的魂晶（TS Game.endRun：victory ? 200 : 0；经济单元按 D24 复核）</summary>
        public const int VictoryEssenceBonus = 200;
        /// <summary>默认解锁的英雄（D8：三人全开）</summary>
        public static readonly string[] DefaultHeroes = { "fox", "falcon", "bear" };
        /// <summary>RunState 上的标记：这一局已经结算过（防止阵亡和放弃各结一次）</summary>
        public const string BankedFlag = "meta.banked";

        int essence;
        readonly Dictionary<string, int> talents = new();
        readonly List<string> unlockedHeroes = new();

        public string Key => SectionKey;
        public int Version => 1;

        /// <summary>所属文件（正式档 / 调试档）</summary>
        public SaveFile File { get; private set; }

        void ISaveFileBound.Bind(SaveFile file) => File = file;

        /// <summary>当前档（<see cref="SaveService.Profile"/>）的局外存档</summary>
        public static MetaSave Current => SaveService.Profile.Section<MetaSave>();

        /// <summary>某一局该用的局外存档（调试局 → 调试档）</summary>
        public static MetaSave For(RunState run) => SaveService.ProfileFor(run).Section<MetaSave>();

        // ───────────── 魂晶 ─────────────

        /// <summary>魂晶余额</summary>
        public int Essence => essence;

        /// <summary>加魂晶（结算、调试）；save = false 时只改内存，由调用方统一写盘</summary>
        public void AddEssence(int amount, bool save = true)
        {
            if (amount <= 0) return;
            essence = (int)Math.Min(int.MaxValue, (long)essence + amount);
            if (save) Commit();
        }

        bool Spend(int price)
        {
            if (price < 0 || essence < price) return false;
            essence -= price;
            return true;
        }

        // ───────────── 天赋 ─────────────

        /// <summary>某项天赋的等级（夹在 0..满级；不认识的 id 为 0）</summary>
        public int TalentLevel(string id)
        {
            if (id == null || !talents.TryGetValue(id, out var lv)) return 0;
            var def = TalentLibrary.Get(id);
            return def != null ? Mathf.Clamp(lv, 0, def.maxLevel) : 0;
        }

        /// <summary>下一级价格；满级或不认识返回 -1</summary>
        public int NextTalentCost(string id)
        {
            var def = TalentLibrary.Get(id);
            return def != null ? def.NextCost(TalentLevel(id)) : -1;
        }

        /// <summary>升一级：魂晶够、没满级就扣钱、写盘，返回 true</summary>
        public bool BuyTalent(string id)
        {
            var def = TalentLibrary.Get(id);
            if (def == null) return false;
            int lv = TalentLevel(id);
            if (lv >= def.maxLevel) return false;
            if (!Spend(def.Cost(lv))) return false;
            talents[id] = lv + 1;
            Commit();
            return true;
        }

        /// <summary>直接设等级（调试、测试；不花魂晶）</summary>
        public void SetTalentLevel(string id, int level, bool save = true)
        {
            var def = TalentLibrary.Get(id);
            if (def == null) return;
            level = Mathf.Clamp(level, 0, def.maxLevel);
            if (level == 0) talents.Remove(id);
            else talents[id] = level;
            if (save) Commit();
        }

        /// <summary>已点亮的总级数 / 总级数（天赋面板「已点亮 n / 50」）</summary>
        public int TalentLevelsOwned
        {
            get
            {
                int n = 0;
                foreach (var t in TalentLibrary.All) n += TalentLevel(t.id);
                return n;
            }
        }

        public static int TalentLevelsTotal
        {
            get
            {
                int n = 0;
                foreach (var t in TalentLibrary.All) n += t.maxLevel;
                return n;
            }
        }

        /// <summary>当前等级下全部天赋的属性修正（按注册顺序）</summary>
        public List<(Stat stat, float value)> TalentMods()
        {
            var mods = new List<(Stat, float)>();
            foreach (var t in TalentLibrary.All) t.Collect(mods, TalentLevel(t.id));
            return mods;
        }

        /// <summary>
        /// 把天赋写进属性表（来源 <see cref="TalentSource"/>，先整体撤掉旧的再加；同 TS applyTalents）。
        /// 和属性表里现有的完全一样时什么都不做，返回 false：重复调用不会触发 Changed（PlayerVitals 撤上限再加回会白送生命）。
        /// </summary>
        public bool ApplyTalents(StatSheet stats)
        {
            if (stats == null) return false;
            var want = TalentMods();
            if (Same(stats.ModsFrom(TalentSource), want) && (want.Count > 0) == stats.HasSource(TalentSource)) return false;
            stats.BeginBatch();
            try
            {
                stats.Remove(TalentSource);
                foreach (var (stat, value) in want) stats.Add(TalentSource, stat, value);
            }
            finally
            {
                stats.EndBatch();
            }
            return true;
        }

        static bool Same(IReadOnlyList<(Stat stat, float value)> a, List<(Stat stat, float value)> b)
        {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++)
                if (a[i].stat != b[i].stat || Math.Abs(a[i].value - b[i].value) > 1e-6f)
                    return false;
            return true;
        }

        // ───────────── 英雄 ─────────────

        public IReadOnlyList<string> UnlockedHeroes => unlockedHeroes;

        /// <summary>解锁了没有：在解锁表里，或者定义里解锁价为 0（D8）</summary>
        public bool IsHeroUnlocked(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            if (unlockedHeroes.Contains(id)) return true;
            var def = HeroLibrary.Get(id);
            return def != null && def.unlockCost <= 0;
        }

        /// <summary>花魂晶解锁英雄（已解锁直接返回 true）</summary>
        public bool UnlockHero(string id, int cost)
        {
            if (string.IsNullOrEmpty(id)) return false;
            if (IsHeroUnlocked(id))
            {
                if (!unlockedHeroes.Contains(id)) unlockedHeroes.Add(id);
                return true;
            }
            if (!Spend(Math.Max(0, cost))) return false;
            unlockedHeroes.Add(id);
            Commit();
            return true;
        }

        // ───────────── 结算 ─────────────

        /// <summary>
        /// 一局结束（阵亡 / 放弃 = false，最终首领倒下 = true）：生成结算 → 魂晶入账（局内收集 + 胜利奖励）→ 记生涯 → 写盘 →
        /// 发 <see cref="GameEvents.MetaChanged"/> 和 <see cref="GameEvents.RunEnded"/>。调试局记进调试档，永远不碰正式档。
        /// run 是当前局时先 <see cref="RunPersistence.CaptureAll"/>，结算里才有最新的武器 / 秘卷。
        /// 同一局只结算一次（RunState 上记 <see cref="BankedFlag"/>）：已经结算过返回 null。
        /// </summary>
        public static RunSummary BankRun(RunState run, bool victory)
        {
            if (run == null || run.Flag(BankedFlag) != 0) return null;
            if (run == RunState.Current) RunPersistence.CaptureAll(run);
            run.SetFlag(BankedFlag, 1);
            var summary = RunSummary.From(run, victory);
            var file = SaveService.ProfileFor(run);
            var meta = file.Section<MetaSave>();
            var career = file.Section<CareerStats>();
            meta.AddEssence(summary.essenceEarned, false);
            career.Record(summary);
            file.Save();
            GameEvents.RaiseMetaChanged(meta);
            GameEvents.RaiseRunEnded(summary);
            return summary;
        }

        /// <summary>写盘 + 发 MetaChanged</summary>
        void Commit()
        {
            File?.Save();
            GameEvents.RaiseMetaChanged(this);
        }

        // ───────────── 存档段 ─────────────

        public string Capture()
        {
            var heroes = new JArray();
            foreach (var h in unlockedHeroes) heroes.Add(h);
            var o = new JObject
            {
                ["essence"] = essence,
                ["talents"] = MetaJson.ToJson(talents),
                ["unlockedHeroes"] = heroes,
            };
            return o.ToString(Formatting.None);
        }

        /// <summary>
        /// v1：{ essence, talents: { id: 等级 }, unlockedHeroes: [id…] }（与网页版同名，迁移直接搬过来）。
        /// 宽容读取：坏字段当 0 / 空；默认英雄总在表里；不认识的天赋 id 原样保留（新版本加的天赋，降级再升级不丢）。
        /// </summary>
        public void Restore(string json, int version)
        {
            essence = 0;
            talents.Clear();
            unlockedHeroes.Clear();
            unlockedHeroes.AddRange(DefaultHeroes);
            var o = MetaJson.Object(json);
            if (o == null) return;
            essence = MetaJson.NonNegInt(o["essence"]);
            foreach (var (id, lv) in MetaJson.IntMap(o["talents"]))
            {
                var def = TalentLibrary.Get(id);
                talents[id] = def != null ? Math.Min(def.maxLevel, lv) : lv;
            }
            foreach (var h in MetaJson.StringList(o["unlockedHeroes"]))
                if (!unlockedHeroes.Contains(h))
                    unlockedHeroes.Add(h);
        }
    }
}
