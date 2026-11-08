using System;
using System.Collections.Generic;
using System.Text;

namespace Spiritfire.Game
{
    /// <summary>
    /// 每局路线（docs/level-design/run-variety.md §1）：这一局每个位置打哪张图。开局时按局种子排好，存进 <see cref="RunState.route"/>
    /// （续玩档 / 接力档 / 重来本关都带着它，读回来是同一条路线）。
    ///
    /// 规则：章的顺序不变（一章接一章，首领关永远是章末），每章的开放大图按种子洗牌——
    ///   带首领前补给营的开放图（<see cref="StageSpec.supplyCamp"/>，第一章 1-3 沉沙古城的寺院塔院）钉在本章最后一张开放图的位置，补给永远在首领之前；
    ///   场景还没建好的图（<see cref="RunPlan.Ready"/>）不进路线，后面的槽位往前补（第四章只建了 4-1、4-3 时，这一章是 4-1、4-2 两个槽位）；
    ///   每章的备选图（<see cref="RunPlan.Pool"/>，场景建好了的）和主图一起洗，抽满本章的开放图槽位——这一局可能见不到某张主图、却见到备选图。
    /// 槽位的编号 / 关序 / 难度按位置算（第 1 张开放图永远是难度 1.00 的「1-1」），场景 / 标题 / 首领 / 补给营跟着抽到的地图走（<see cref="StageSpec.map"/>）。
    /// 打乱用独立的随机流 <see cref="StreamName"/>（只由局种子决定，掉落 / 刷怪多掷几次不影响路线）。
    ///
    /// 不打乱（<c>shuffle = false</c>）= 规划表原顺序：生涯第一局（新手按设计顺序认识敌人）、调试局、测试。
    /// </summary>
    public sealed class RunRoute
    {
        /// <summary>打乱路线用的随机流名</summary>
        public const string StreamName = "route";

        readonly StageSpec[] slots;

        /// <summary>各槽位用的地图（规划表编号，按槽位顺序）：存档里存的就是它</summary>
        public readonly string[] maps;

        RunRoute(IReadOnlyList<StageSpec> picked)
        {
            int n = picked.Count;
            slots = new StageSpec[n];
            maps = new string[n];
            int chapter = int.MinValue, field = 0;
            for (int i = 0; i < n; i++)
            {
                var m = picked[i].map;
                if (m.chapter != chapter)
                {
                    chapter = m.chapter;
                    field = 0;
                }
                // 开放图按章内位置编号；首领关保留规划表的关序（章末 = 3，第四章还没建满时编号也不跳）
                int index = m.IsBoss ? m.index : field++;
                slots[i] = new StageSpec(m, this, i, index);
                maps[i] = m.code;
            }
        }

        /// <summary>
        /// 排一条路线：<paramref name="shuffle"/> 为真时按 <paramref name="seed"/> 洗每章的开放图（补给营那张钉在章内最后），否则按规划表原顺序。
        /// <paramref name="ready"/> = 哪些图的场景能进（缺省 <see cref="RunPlan.Ready"/>）；一张都进不了时退回规划表的最后一关（和原来一样能报错能测）
        /// </summary>
        public static RunRoute Build(int seed, bool shuffle = true, Func<StageSpec, bool> ready = null)
        {
            ready ??= RunPlan.Ready;
            var all = RunPlan.Stages;
            var picked = new List<StageSpec>(all.Count);
            var rng = RunRng.Stream(seed, StreamName);
            var free = new List<StageSpec>();
            var pinned = new List<StageSpec>();
            var bosses = new List<StageSpec>();
            for (int i = 0; i < all.Count;)
            {
                int chapter = all[i].chapter;
                free.Clear();
                pinned.Clear();
                bosses.Clear();
                for (; i < all.Count && all[i].chapter == chapter; i++)
                {
                    var s = all[i];
                    if (!ready(s)) continue;
                    if (s.IsBoss) bosses.Add(s);
                    else if (s.supplyCamp) pinned.Add(s);
                    else free.Add(s);
                }
                // 槽位数 = 本章建好的主图数（补给营那张占一个）；洗牌时备选图也进来抽，抽满为止
                int slots = free.Count;
                if (shuffle)
                    foreach (var a in RunPlan.Pool)
                        if (a.chapter == chapter && ready(a))
                            free.Add(a);
                // 每章各自派生一个子序列：某一章的图多了 / 少了，不改变别的章的顺序
                if (shuffle && free.Count > 1) rng.Fork(chapter).Shuffle(free);
                for (int k = 0; k < slots && k < free.Count; k++) picked.Add(free[k]);
                picked.AddRange(pinned);
                picked.AddRange(bosses);
            }
            if (picked.Count == 0) picked.Add(all[all.Count - 1]);
            return new RunRoute(picked);
        }

        /// <summary>规划表原顺序（跳过没建好的图）</summary>
        public static RunRoute Canonical(Func<StageSpec, bool> ready = null) => Build(0, false, ready);

        /// <summary>按存档里的地图编号恢复路线（不再检查场景在不在：开局时查过了；进不去的关由 SceneFlow 报错）。有编号不在规划表里 → null（坏档）</summary>
        public static RunRoute FromMaps(IReadOnlyList<string> codes)
        {
            if (codes == null || codes.Count == 0) return null;
            var picked = new List<StageSpec>(codes.Count);
            foreach (var c in codes)
            {
                var s = RunPlan.Canonical(c);
                if (s == null) return null;
                picked.Add(s);
            }
            return new RunRoute(picked);
        }

        /// <summary>这条路线的地图顺序是不是 <paramref name="codes"/></summary>
        public bool Matches(IReadOnlyList<string> codes)
        {
            if (codes == null || codes.Count != maps.Length) return false;
            for (int i = 0; i < maps.Length; i++)
                if (!string.Equals(codes[i], maps[i], StringComparison.Ordinal))
                    return false;
            return true;
        }

        /// <summary>全部槽位（按顺序，不受试玩开关影响）</summary>
        public IReadOnlyList<StageSpec> Slots => slots;
        public int Count => slots.Length;
        public StageSpec First => slots[0];
        /// <summary>完整版的最后一关（路线的最后一个槽位）</summary>
        public StageSpec Last => slots[slots.Length - 1];

        /// <summary>这一局的最后一关：试玩开关（<see cref="RunPlan.DemoEnd"/>）指向路线里更早的槽位时是它，否则 <see cref="Last"/></summary>
        public StageSpec Final => DemoSlot ?? Last;

        /// <summary>试玩开关开着（DemoEnd 是路线里最后一关之前的某个槽位）</summary>
        public bool IsDemo => DemoSlot != null;

        StageSpec DemoSlot => Get(RunPlan.DemoEnd) is { } s && s.order < Last.order ? s : null;

        /// <summary>按槽位编号取（「1-2」）；没有则 null</summary>
        public StageSpec Get(string code)
        {
            if (string.IsNullOrEmpty(code)) return null;
            foreach (var s in slots)
                if (s.code == code) return s;
            return null;
        }

        /// <summary>按场景路径取（不区分大小写，斜杠方向不限）；不在路线里则 null</summary>
        public StageSpec ForScene(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath)) return null;
            var p = scenePath.Replace('\\', '/');
            foreach (var s in slots)
                if (string.Equals(s.scene, p, StringComparison.OrdinalIgnoreCase)) return s;
            return null;
        }

        /// <summary>用地图 <paramref name="map"/>（规划表的关或别的路线的槽位都行）的那个槽位；不在路线里则 null</summary>
        public StageSpec ForMap(StageSpec map)
        {
            if (map == null) return null;
            foreach (var s in slots)
                if (s.map == map.map) return s;
            return null;
        }

        /// <summary><paramref name="s"/> 是这条路线上的槽位（别的路线 / 规划表的关按地图换成这条路线的槽位）</summary>
        StageSpec Own(StageSpec s) => s == null ? null : s.route == this ? s : ForMap(s);

        /// <summary>下一关；这一局的最后一关（<see cref="Final"/>）之后返回 null</summary>
        public StageSpec Next(StageSpec s)
        {
            s = Own(s);
            if (s == null || IsFinal(s)) return null;
            return s.order + 1 < slots.Length ? slots[s.order + 1] : null;
        }

        /// <summary>打完它 = 胜利结算（试玩版 = DemoEnd）</summary>
        public bool IsFinal(StageSpec s) => Own(s) is { } o && o.order >= Final.order;

        /// <summary>完整版的最后一关（击败全部首领）</summary>
        public bool IsLast(StageSpec s) => Own(s) is { } o && o.order >= Last.order;

        /// <summary>在这一局要走的路线上（试玩版 DemoEnd 之后的不算）</summary>
        public bool InPlay(StageSpec s) => Own(s) is { } o && o.order <= Final.order;

        /// <summary>这一局要走的关卡（第一关 … <see cref="Final"/>）</summary>
        public IReadOnlyList<StageSpec> Playable
        {
            get
            {
                int end = Final.order;
                var list = new List<StageSpec>(end + 1);
                for (int i = 0; i <= end; i++) list.Add(slots[i]);
                return list;
            }
        }

        /// <summary>日志 / 调试用：「1-1 雅丹迷城 → 1-2 古道穿越戈壁 → 1-3 沉沙古城 → 1-4 …」</summary>
        public string Describe()
        {
            var sb = new StringBuilder();
            foreach (var s in slots)
            {
                if (sb.Length > 0) sb.Append(" → ");
                sb.Append(s.code).Append(' ').Append(s.title);
            }
            return sb.ToString();
        }

        public override string ToString() => string.Join(",", maps);
    }
}
