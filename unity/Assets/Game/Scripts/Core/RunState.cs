using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一把枪的快照（跨关 / 存档）：定义 id、品质、强化、元素、弹药、词条</summary>
    [Serializable]
    public struct WeaponSave
    {
        public string id;
        public int rarity, level, mag, reserve;
        public Element element;
        /// <summary>手上那把（当前槽）</summary>
        public bool active;
        /// <summary>词条（固有 → 抽到的 → 传说特性，见 <see cref="AffixSave"/>）；null / 空 = 只有定义的固有词条</summary>
        public AffixSave[] affixes;
    }

    /// <summary>灵宠快照：定义 id、灵契等级 / 经验、灵技冷却剩余（秒）</summary>
    [Serializable]
    public sealed class PetSave
    {
        public string id;
        public int level;
        public float xp, cooldownLeft;
    }

    /// <summary>
    /// 跨关要带走状态的组件（武器、灵宠、秘卷、玩家生命…）：离开关卡前 Capture 写进 <see cref="RunState"/>，
    /// 新关卡的玩家组装好之后 Restore 读回来（L1 的 SceneFlow 调 <see cref="RunPersistence"/>）。
    /// </summary>
    public interface IRunPersistent
    {
        void Capture(RunState s);
        void Restore(RunState s);
    }

    /// <summary>IRunPersistent 登记表：组件 OnEnable 登记、OnDisable 注销；<see cref="CaptureAll"/> / <see cref="RestoreAll"/> 按登记顺序调用</summary>
    public static class RunPersistence
    {
        static readonly List<IRunPersistent> all = new();

        public static IReadOnlyList<IRunPersistent> All => all;
        public static void Register(IRunPersistent p) { if (p != null && !all.Contains(p)) all.Add(p); }
        public static void Unregister(IRunPersistent p) => all.Remove(p);

        public static void CaptureAll(RunState s)
        {
            if (s == null) return;
            foreach (var p in all.ToArray())
                try { p.Capture(s); }
                catch (Exception e) { Debug.LogException(e); }
        }

        public static void RestoreAll(RunState s)
        {
            if (s == null) return;
            foreach (var p in all.ToArray())
                try { p.Restore(s); }
                catch (Exception e) { Debug.LogException(e); }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();
    }

    /// <summary>
    /// 一局的状态（docs/unity-parity.md 4.6；同 Three.js RunState）：英雄、种子、当前关、难度、用时 / 伤害 / 击杀、
    /// 灵石（局内，D13）与魂晶（局外）、秘卷层数、武器、灵宠、生命 / 护盾、剧情 / 调试标记。
    /// 开局时 <see cref="Begin"/> 创建；直接打开关卡场景时 <see cref="GameSession"/> 用 <see cref="Ensure"/> 建一个调试局（dev = true）。
    /// 钱包：<see cref="Credit"/> / <see cref="TrySpend"/> 都发 <see cref="GameEvents.CoinsChanged"/>。
    /// 存档（R2 SaveService）按 JSON 序列化这个类；Dictionary 字段由 SaveService 自己转换（JsonUtility 不支持字典）。
    /// </summary>
    [Serializable]
    public sealed class RunState
    {
        /// <summary>当前局（没开局时为 null；<see cref="Ensure"/> 保证有一个）</summary>
        public static RunState Current;

        public string heroId = "fox";
        public int seed;
        /// <summary>当前关：章（1 起）、章内关序（0 起）、编号（「1-1」）</summary>
        public int chapter = 1, stage;
        public string stageCode = "1-1";
        public float difficulty = 1;
        /// <summary>整局用时（秒，游戏时间）、造成的伤害合计</summary>
        public float time, damageDealt;
        public int coins, essence, kills, stagesCleared;
        /// <summary>调试局：直接打开关卡场景时自动建的（不计生涯、不写正式存档）</summary>
        public bool dev;
        public Dictionary<string, int> flags = new();
        /// <summary>秘卷 id → 层数</summary>
        public Dictionary<string, int> scrolls = new();
        public List<WeaponSave> weapons = new();
        public PetSave pet;
        /// <summary>离开上一关时的生命 / 护盾（&lt; 0 = 满）</summary>
        public float hp = -1, shield = -1;
        /// <summary>
        /// 开局时锁定的天赋（天赋 id → 等级，只记 &gt; 0 的）：开局（<see cref="GameEvents.RunStarted"/>）由 <see cref="TalentHooks"/> 从这一局的档里拍下来，
        /// 之后整局（含暂离后继续征程）都按它生效，主菜单里新买的天赋下一局才生效。null = 没有快照（测试拼的局），按档里当前的天赋
        /// </summary>
        public Dictionary<string, int> talents;
        /// <summary>
        /// 这一局的关卡路线：每个槽位用哪张图（规划表编号，按槽位顺序；开局时按种子排好，见 <see cref="RunRoute"/>）。
        /// null = 规划表原顺序（调试局、测试拼的局、加这个字段之前的旧档）
        /// </summary>
        public string[] route;

        [NonSerialized] Dictionary<string, RunRng> streams;
        [NonSerialized] RunRoute routeCache;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Current = null;

        /// <summary>
        /// 开一局：设为 <see cref="Current"/>，进入第一关，发 <see cref="GameEvents.RunStarted"/>。
        /// <paramref name="route"/> = 这一局的关卡路线（正式开局用 <see cref="RunRoute.Build"/> 按同一个种子排；null = 规划表原顺序）；
        /// <paramref name="first"/> = 从哪一关开始（null = 路线的第一关；给的是规划表的关时换成路线上用同一张图的槽位）
        /// </summary>
        public static RunState Begin(string heroId, int seed, StageSpec first = null, bool dev = false, RunRoute route = null)
        {
            var s = new RunState { heroId = string.IsNullOrEmpty(heroId) ? "fox" : heroId, seed = seed, dev = dev };
            if (route != null) s.route = (string[])route.maps.Clone();
            var r = s.Route;
            if (r == null) s.EnterStage(first ?? RunPlan.Stages[0]);
            else s.EnterStage(first == null ? r.First : first.route == r ? first : r.ForMap(first) ?? r.First);
            Current = s;
            GameEvents.RaiseRunStarted(s);
            return s;
        }

        /// <summary>当前局；没有就开一个调试局（随机种子，从 stage 开始，缺省第一关）</summary>
        public static RunState Ensure(StageSpec stage = null, string heroId = null)
        {
            if (Current != null) return Current;
            return Begin(heroId, Environment.TickCount, stage, true);
        }

        /// <summary>进入某一关：记下章 / 关序 / 编号 / 难度</summary>
        public void EnterStage(StageSpec s)
        {
            if (s == null) return;
            chapter = s.chapter;
            stage = s.index;
            stageCode = s.code;
            difficulty = s.difficulty;
        }

        /// <summary>这一局的关卡路线（<see cref="route"/> 为空 = null：按规划表原顺序）</summary>
        public RunRoute Route
        {
            get
            {
                if (route == null || route.Length == 0) return null;
                if (routeCache == null || !routeCache.Matches(route)) routeCache = RunRoute.FromMaps(route);
                return routeCache;
            }
        }

        /// <summary>当前关：这一局路线上的槽位（没有路线时按规划表；都不在时为 null）</summary>
        public StageSpec Stage => Route?.Get(stageCode) ?? RunPlan.Canonical(stageCode);

        // ───────────── 钱包 ─────────────

        /// <summary>
        /// 进账灵石（拾取、奖励、调试…；source 只用于调试 / 统计）。灵石获取加成（Stat.CoinGainPct）由经济单元在调用前折算，这里原样入账
        /// </summary>
        public void Credit(int amount, string source = null)
        {
            if (amount <= 0) return;
            coins += amount;
            GameEvents.RaiseCoinsChanged(amount, coins);
        }

        /// <summary>花灵石：够就扣并返回 true（发 CoinsChanged，变化量为负），不够返回 false、什么都不变</summary>
        public bool TrySpend(int price)
        {
            if (price < 0) return false;
            if (coins < price) return false;
            if (price == 0) return true;
            coins -= price;
            GameEvents.RaiseCoinsChanged(-price, coins);
            return true;
        }

        /// <summary>进账魂晶（局外货币，D13），发 <see cref="GameEvents.EssenceChanged"/></summary>
        public void CreditEssence(int amount, string source = null)
        {
            if (amount <= 0) return;
            essence += amount;
            GameEvents.RaiseEssenceChanged(amount, essence);
        }

        // ───────────── 标记 / 随机流 ─────────────

        public int Flag(string key) => flags != null && key != null && flags.TryGetValue(key, out var v) ? v : 0;

        public void SetFlag(string key, int value)
        {
            if (key == null) return;
            flags ??= new Dictionary<string, int>();
            flags[key] = value;
        }

        /// <summary>
        /// 这一局的某个随机流（同局种子 + 当前关 + 流名 → 同一序列；同一关里多次取到的是同一个对象，接着往下掷）。
        /// 例：RunState.Current.Stream("loot").Chance(0.3f)
        /// </summary>
        public RunRng Stream(string name)
        {
            streams ??= new Dictionary<string, RunRng>();
            string key = stageCode + "/" + name;
            if (!streams.TryGetValue(key, out var r)) streams[key] = r = RunRng.Stream(seed, key);
            return r;
        }
    }
}
