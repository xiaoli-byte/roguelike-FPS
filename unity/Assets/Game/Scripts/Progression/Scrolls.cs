using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷定义（Three.js 版 src/core/types.ts 的 ScrollDef）：稀有度 0–4（<see cref="Rarity"/>）、层数上限、标签、英雄专属、描述模板，
    /// 效果写在 <see cref="Install"/> 里——每次获得一层都按新层数重装（旧作用域先卸载，见 <see cref="ScrollScope"/>）。
    /// 纯属性的卷用 <see cref="StatScroll"/> 写成组文件（Progression/Scrolls/&lt;组&gt;/*StatScrolls.cs，<see cref="IDefSource{T}"/>）；
    /// 带行为的卷继承本类 + [Defs]，一卷一个文件。都由 <see cref="Registry{T}"/> 收集，<see cref="ScrollLibrary"/> 第一次访问时校验。
    /// 描述模板（<see cref="Describe"/>）：{n} 当前层数、{max} 层数上限、{n*6} 层数 × 6（数字照写，如「+{n*6}%」）；
    /// 子类可以覆盖 <see cref="TryTemplate"/> 加自己的占位（<see cref="StatScroll"/> 的 {s0} / {t0}）。占位解析不了就原样显示，校验会报出来。
    /// </summary>
    public abstract class ScrollDef : IDef
    {
        public string id, name;
        /// <summary>描述模板（见类说明）；不带占位的原样显示</summary>
        public string description;
        /// <summary>稀有度 0–4：普通 / 精良 / 稀有 / 史诗 / 传说</summary>
        public int rarity;
        public int maxStacks = 3;
        /// <summary>标签（第一个是卡面上显示的主标签；反应 / 元素 / 流派标签参与出卡加权）</summary>
        public string[] tags = Array.Empty<string>();
        /// <summary>英雄专属：只在这个英雄（HeroDef.id）的卡池里出现；null = 通用</summary>
        public string heroOnly;

        string IDef.Id => id;

        /// <summary>卡面上显示的主标签</summary>
        public string tag => tags != null && tags.Length > 0 ? tags[0] : "";

        public bool HasTag(string t) => tags != null && Array.IndexOf(tags, t) >= 0;

        /// <summary>按层数安装效果：属性走 scope.Stat，订阅走 scope.OnXxx / Hook，修饰器 / 任务走 scope.AddXxx / Task（卸载时自动撤掉）</summary>
        public virtual void Install(ScrollScope scope, int stacks) { }

        /// <summary>按层数生成描述（解析模板占位）</summary>
        public string Describe(int stacks)
        {
            if (string.IsNullOrEmpty(description)) return "";
            if (description.IndexOf('{') < 0) return description;
            var sb = new StringBuilder(description.Length + 8);
            int i = 0;
            while (i < description.Length)
            {
                char c = description[i];
                int close = c == '{' ? description.IndexOf('}', i + 1) : -1;
                if (close < 0)
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                var key = description.Substring(i + 1, close - i - 1);
                sb.Append(TryTemplate(key, stacks, out var text) ? text : description.Substring(i, close - i + 1));
                i = close + 1;
            }
            return sb.ToString();
        }

        /// <summary>模板占位 → 文本：{n}、{max}、{n*系数}；子类覆盖时先处理自己的 key，其余交给 base</summary>
        public virtual bool TryTemplate(string key, int stacks, out string text)
        {
            text = null;
            if (string.IsNullOrEmpty(key)) return false;
            key = key.Trim();
            if (key == "n")
            {
                text = stacks.ToString(CultureInfo.InvariantCulture);
                return true;
            }
            if (key == "max")
            {
                text = maxStacks.ToString(CultureInfo.InvariantCulture);
                return true;
            }
            if (key.StartsWith("n*", StringComparison.Ordinal) &&
                float.TryParse(key.Substring(2), NumberStyles.Float, CultureInfo.InvariantCulture, out var k))
            {
                text = FormatNumber(stacks * k);
                return true;
            }
            return false;
        }

        /// <summary>描述里的数字：最多两位小数，去掉末尾的 0</summary>
        public static string FormatNumber(float v) => (Mathf.Round(v * 100) / 100).ToString("0.##", CultureInfo.InvariantCulture);

        /// <summary>描述模板里出现的全部占位 key（校验用）；花括号不成对时 unbalanced = true</summary>
        public static List<string> TemplateKeys(string template, out bool unbalanced)
        {
            var keys = new List<string>();
            unbalanced = false;
            if (string.IsNullOrEmpty(template)) return keys;
            int i = 0;
            while (i < template.Length)
            {
                int open = template.IndexOf('{', i);
                int stray = template.IndexOf('}', i);
                if (stray >= 0 && (open < 0 || stray < open)) unbalanced = true;
                if (open < 0) break;
                int close = template.IndexOf('}', open + 1);
                int nested = template.IndexOf('{', open + 1);
                if (close < 0 || (nested >= 0 && nested < close))
                {
                    unbalanced = true;
                    break;
                }
                keys.Add(template.Substring(open + 1, close - open - 1));
                i = close + 1;
            }
            return keys;
        }

        /// <summary>
        /// 这一卷在某个层数下登记的属性总量（不碰任何全局状态：用 <see cref="ScrollScope.DryRun"/> 作用域装一遍）。
        /// 三选一卡面的「下一层数值预览」、属性面板用
        /// </summary>
        public IReadOnlyList<(Stat stat, float value)> PreviewStats(int stacks)
        {
            var scope = new ScrollScope(this, stacks, null, null, null, dryRun: true);
            try { Install(scope, scope.stacks); }
            catch (Exception e) { Debug.LogException(e); }
            return scope.StatTotals;
        }
    }

    /// <summary>纯属性秘卷：每层同样的加成（总量 = 每层 × 层数）。模板占位：{s0} 第 0 条每层值（「+6%」）、{t0} 第 0 条在当前层数下的总量</summary>
    public sealed class StatScroll : ScrollDef
    {
        public (Stat stat, float perStack)[] stats = Array.Empty<(Stat, float)>();

        public override void Install(ScrollScope scope, int stacks)
        {
            foreach (var (stat, per) in stats) scope.Stat(stat, per * stacks);
        }

        public override bool TryTemplate(string key, int stacks, out string text)
        {
            key = key?.Trim();
            if (key != null && key.Length >= 2 && (key[0] == 's' || key[0] == 't') &&
                int.TryParse(key.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) && i >= 0 && i < stats.Length)
            {
                var (stat, per) = stats[i];
                text = StatInfo.Format(stat, key[0] == 's' ? per : per * stacks);
                return true;
            }
            return base.TryTemplate(key, stacks, out text);
        }
    }

    /// <summary>
    /// 秘卷表门面：读 <see cref="Registry{T}"/>，外部调用（三选一界面、掉落、测试）不用改。
    /// 第一次访问时跑一遍 <see cref="Validate"/>，有问题按条打 LogError（不抛异常：一卷写错不该让整局起不来）。
    /// 抽取走 <see cref="ScrollRoll"/>（Three.js 的 [100, 52, 26, 11, 4] + 幸运 / 章节 / 已有 / 专属 / 元素源 / 流派加权）。
    /// </summary>
    public static class ScrollLibrary
    {
        public static readonly string[] RarityName = Rarity.Names;
        public static readonly Color[] RarityColor = Rarity.Colors;

        static bool validated;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => validated = false;

        public static IReadOnlyList<ScrollDef> All
        {
            get
            {
                var all = Registry<ScrollDef>.All;
                if (!validated)
                {
                    validated = true;
                    var errors = Validate(all, out var warnings);
                    foreach (var e in errors) Debug.LogError("[Scrolls] " + e);
                    foreach (var w in warnings) Debug.LogWarning("[Scrolls] " + w);
                }
                return all;
            }
        }

        public static ScrollDef Get(string id) => Registry<ScrollDef>.Get(id);

        /// <summary>按当前局的条件抽 count 张不重复、未满层的秘卷（英雄专属卷只给对应英雄；heroId 为空时取玩家 / 当前局的英雄）</summary>
        public static List<ScrollDef> Roll(ScrollInventory inv, int count, int minRarity = 0, string heroId = null)
        {
            var ctx = ScrollRoll.ContextFor(inv, PlayerVitals.Instance, heroId, minRarity);
            return ScrollRoll.Roll(All, count, ctx, ScrollRoll.Rng);
        }

        /// <summary>
        /// 数据校验：id 非空、唯一（不区分大小写）、首尾无空白；名字非空；稀有度 0–4；层数上限 ≥ 1；标签不为 null 且无空项；
        /// 描述非空、花括号成对、每个占位在 1 层和满层都解析得了。英雄专属指向未登记的英雄只算警告（英雄单元还没落地时）。
        /// </summary>
        public static List<string> Validate(IEnumerable<ScrollDef> defs, out List<string> warnings)
        {
            var errors = new List<string>();
            warnings = new List<string>();
            var seen = new Dictionary<string, ScrollDef>(StringComparer.OrdinalIgnoreCase);
            if (defs == null) return errors;
            foreach (var d in defs)
            {
                if (d == null)
                {
                    errors.Add("有一条秘卷定义是 null");
                    continue;
                }
                string who = string.IsNullOrEmpty(d.id) ? $"（{d.GetType().Name}）" : d.id;
                if (string.IsNullOrWhiteSpace(d.id)) errors.Add($"{who}：id 为空");
                else
                {
                    if (d.id.Trim() != d.id) errors.Add($"{who}：id 首尾有空白");
                    if (seen.TryGetValue(d.id, out var other)) errors.Add($"{who}：id 与 {other.id}（{other.GetType().Name}）重复");
                    else seen[d.id] = d;
                }
                if (string.IsNullOrWhiteSpace(d.name)) errors.Add($"{who}：没有名字");
                if (d.rarity < Rarity.Common || d.rarity > Rarity.Legendary) errors.Add($"{who}：稀有度 {d.rarity} 不在 0–4");
                if (d.maxStacks < 1) errors.Add($"{who}：层数上限 {d.maxStacks} < 1");
                if (d.tags == null) errors.Add($"{who}：tags 为 null");
                else
                    foreach (var t in d.tags)
                        if (string.IsNullOrWhiteSpace(t))
                            errors.Add($"{who}：有空标签");
                if (string.IsNullOrWhiteSpace(d.description)) errors.Add($"{who}：没有描述");
                else
                {
                    var keys = ScrollDef.TemplateKeys(d.description, out bool unbalanced);
                    if (unbalanced) errors.Add($"{who}：描述的花括号不成对「{d.description}」");
                    foreach (var k in keys)
                        foreach (int n in new[] { 1, Mathf.Max(1, d.maxStacks) })
                            if (!d.TryTemplate(k, n, out _))
                            {
                                errors.Add($"{who}：描述占位 {{{k}}} 在 {n} 层时解析不了");
                                break;
                            }
                }
                if (d.heroOnly != null && Registry<HeroDef>.Get(d.heroOnly) == null)
                    warnings.Add($"{who}：英雄专属 {d.heroOnly} 还没有登记 HeroDef");
            }
            return errors;
        }
    }

    /// <summary>
    /// 本局持有的秘卷（层数、获得顺序、每卷当前的安装作用域、跨叠层保留的状态）。
    /// 获得一层（<see cref="Gain(ScrollDef, StatSheet, PlayerVitals)"/>）：属性表批处理开始 → 旧作用域卸载（撤属性、退订、撤修饰器 / 任务）
    /// → 按新层数 Install → 批处理结束（只发一次 Changed：上限只按净增量补当前值，不会先降后升再白送一次）→ 发获得事件。
    /// 已满层返回 false、什么都不做。跨关（L1）：<see cref="Capture"/> / <see cref="Restore"/>；换了玩家实例用 <see cref="Rebind"/>。
    /// </summary>
    public sealed class ScrollInventory
    {
        readonly Dictionary<string, int> stacks = new();
        readonly List<string> order = new();
        readonly Dictionary<string, ScrollScope> scopes = new();
        readonly Dictionary<string, Dictionary<string, object>> memory = new();

        /// <summary>得到一层（秘卷, 现在的层数）：<see cref="Gain(ScrollDef, StatSheet, PlayerVitals)"/> 才发，Restore / SetStacks 不发</summary>
        public event Action<ScrollDef, int> Gained;
        /// <summary>整卷移除</summary>
        public event Action<ScrollDef> Removed;

        public IReadOnlyDictionary<string, int> All => stacks;
        /// <summary>按获得顺序的 id（已获得面板、结算）</summary>
        public IReadOnlyList<string> Order => order;
        public int Count => order.Count;
        /// <summary>全部层数之和</summary>
        public int TotalStacks
        {
            get
            {
                int n = 0;
                foreach (var v in stacks.Values) n += v;
                return n;
            }
        }

        public int Stacks(string id) => id != null && stacks.TryGetValue(id, out var n) ? n : 0;
        public bool Has(string id) => Stacks(id) > 0;
        public bool IsMaxed(ScrollDef def) => def != null && Stacks(def.id) >= def.maxStacks;
        /// <summary>某卷当前的安装作用域（没有为 null）</summary>
        public ScrollScope ScopeOf(string id) => id != null && scopes.TryGetValue(id, out var s) ? s : null;

        /// <summary>按获得顺序列出（定义, 层数）；注册表里找不到的 id 跳过</summary>
        public List<(ScrollDef def, int stacks)> Owned()
        {
            var list = new List<(ScrollDef, int)>(order.Count);
            foreach (var id in order)
                if (ScrollLibrary.Get(id) is { } d)
                    list.Add((d, Stacks(id)));
            return list;
        }

        /// <summary>给玩家加一层；已满层返回 false</summary>
        public bool Gain(ScrollDef def, PlayerVitals vitals) => Gain(def, vitals ? vitals.stats : null, vitals);

        /// <summary>给一张属性表加一层（测试可以不带玩家）；已满层返回 false</summary>
        public bool Gain(ScrollDef def, StatSheet sheet, PlayerVitals vitals = null)
        {
            if (def == null || IsMaxed(def)) return false;
            int n = Stacks(def.id) + 1;
            Install(def, n, sheet, vitals);
            try { Gained?.Invoke(def, n); }
            catch (Exception e) { Debug.LogException(e); }
            GameEvents.RaiseScrollAcquired(def, n);
            return true;
        }

        /// <summary>直接设成 n 层（夹到 0–上限；0 = 移除）。沙盒、读档用：不发获得事件。返回实际层数</summary>
        public int SetStacks(ScrollDef def, int n, StatSheet sheet, PlayerVitals vitals = null)
        {
            if (def == null) return 0;
            n = Mathf.Clamp(n, 0, Mathf.Max(1, def.maxStacks));
            if (n == 0)
            {
                Remove(def.id);
                return 0;
            }
            if (Stacks(def.id) == n && scopes.ContainsKey(def.id)) return n;
            Install(def, n, sheet, vitals);
            return n;
        }

        void Install(ScrollDef def, int n, StatSheet sheet, PlayerVitals vitals)
        {
            scopes.TryGetValue(def.id, out var old);
            // 旧作用域可能装在另一张表上（换了玩家）：两张表都包进批处理
            var oldSheet = old?.stats;
            sheet?.BeginBatch();
            if (oldSheet != null && oldSheet != sheet) oldSheet.BeginBatch();
            try
            {
                old?.Dispose();
                var scope = new ScrollScope(def, n, sheet, vitals, this);
                try { def.Install(scope, scope.stacks); }
                catch (Exception e) { Debug.LogException(e); }
                scopes[def.id] = scope;
                if (!stacks.ContainsKey(def.id)) order.Add(def.id);
                stacks[def.id] = n;
            }
            finally
            {
                if (oldSheet != null && oldSheet != sheet) oldSheet.EndBatch();
                sheet?.EndBatch();
            }
        }

        /// <summary>整卷移除（卸载回调 + 撤属性 + 清掉跨叠层状态）</summary>
        public void Remove(string id)
        {
            if (id == null || !stacks.ContainsKey(id)) return;
            if (scopes.TryGetValue(id, out var scope))
            {
                scopes.Remove(id);
                scope.Dispose();
            }
            stacks.Remove(id);
            order.Remove(id);
            memory.Remove(id);
            var def = ScrollLibrary.Get(id) ?? scope?.def;
            if (def != null)
                try { Removed?.Invoke(def); }
                catch (Exception e) { Debug.LogException(e); }
        }

        /// <summary>全部移除（新开一局）</summary>
        public void Clear()
        {
            for (int i = order.Count - 1; i >= 0; i--) Remove(order[i]);
            memory.Clear();
        }

        /// <summary>换了玩家实例（跨关重建玩家）：按现有层数把每卷重装到新玩家上</summary>
        public void Rebind(PlayerVitals vitals)
        {
            var sheet = vitals ? vitals.stats : null;
            sheet?.BeginBatch();
            try
            {
                foreach (var id in order.ToArray())
                    if (scopes.TryGetValue(id, out var s))
                        Install(s.def, Stacks(id), sheet, vitals);
            }
            finally
            {
                sheet?.EndBatch();
            }
        }

        /// <summary>写进局状态（id → 层数，按获得顺序）</summary>
        public void Capture(RunState s)
        {
            if (s == null) return;
            s.scrolls ??= new Dictionary<string, int>();
            s.scrolls.Clear();
            foreach (var id in order) s.scrolls[id] = Stacks(id);
        }

        /// <summary>从局状态恢复（先清空；注册表里没有的 id 打警告跳过），整批只发一次 Changed、不发获得事件</summary>
        public void Restore(RunState s, PlayerVitals vitals) => Restore(s, vitals ? vitals.stats : null, vitals);

        /// <summary>同上，指定属性表（测试可以不带玩家）</summary>
        public void Restore(RunState s, StatSheet sheet, PlayerVitals vitals = null)
        {
            Clear();
            if (s?.scrolls == null) return;
            sheet?.BeginBatch();
            try
            {
                foreach (var kv in s.scrolls)
                {
                    var def = ScrollLibrary.Get(kv.Key);
                    if (def == null)
                    {
                        Debug.LogWarning($"[Scrolls] 读档：未知秘卷 {kv.Key}，跳过");
                        continue;
                    }
                    SetStacks(def, kv.Value, sheet, vitals);
                }
            }
            finally
            {
                sheet?.EndBatch();
            }
        }

        /// <summary>某卷跨叠层保留的状态表（<see cref="ScrollScope.Keep{T}"/>）</summary>
        internal Dictionary<string, object> Memory(string id)
        {
            if (!memory.TryGetValue(id, out var m)) memory[id] = m = new Dictionary<string, object>();
            return m;
        }
    }
}
