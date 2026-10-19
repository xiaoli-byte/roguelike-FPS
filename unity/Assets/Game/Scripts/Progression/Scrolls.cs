using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷定义（Three.js 版 src/core/types.ts 的 ScrollDef）：稀有度 0–4（<see cref="Rarity"/>）、层数上限、标签、英雄专属、描述模板，
    /// 效果写在 <see cref="Install"/> 里——每次获得一层都按新层数重装（旧作用域先卸载，见 <see cref="ScrollScope"/>）。
    /// 纯属性的卷用 <see cref="StatScroll"/> 写成组文件（Progression/Scrolls/&lt;组&gt;/*StatScrolls.cs，<see cref="IDefSource{T}"/>）；
    /// 带行为的卷继承本类 + [Defs]，一卷一个文件。都由 <see cref="Registry{T}"/> 收集。
    /// </summary>
    public abstract class ScrollDef : IDef
    {
        public string id, name;
        /// <summary>描述模板：可以写 {n} 占位，<see cref="Describe"/> 换成层数；不带占位的原样显示</summary>
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
        public string tag => tags.Length > 0 ? tags[0] : "";

        public bool HasTag(string t) => Array.IndexOf(tags, t) >= 0;

        public string Describe(int stacks) => description == null ? "" : description.Replace("{n}", stacks.ToString());

        /// <summary>按层数安装效果：属性走 scope.Stat，订阅走 scope.Hook / OnUninstall（卸载时自动撤掉）</summary>
        public virtual void Install(ScrollScope scope, int stacks) { }
    }

    /// <summary>纯属性秘卷：每层同样的加成（总量 = 每层 × 层数）</summary>
    public sealed class StatScroll : ScrollDef
    {
        public (Stat stat, float perStack)[] stats = Array.Empty<(Stat, float)>();

        public override void Install(ScrollScope scope, int stacks)
        {
            foreach (var (stat, per) in stats) scope.Stat(stat, per * stacks);
        }
    }

    /// <summary>
    /// 秘卷表门面：读 <see cref="Registry{T}"/>，外部调用（三选一界面、掉落、测试）不用改。
    /// 稀有度 4 档 → 5 档（D10）的映射：普通 0 → 0、精良 1 → 1、稀有 2 → 2、旧「传说」3 → 4，新增的「史诗」3 暂时没有秘卷。
    /// 出卡权重沿用旧表 60 / 30 / 9 / 1（史诗插 3），所以现有 16 卷的出卡概率与改动前完全一致；
    /// S0（ScrollRoll）换成 Three.js 的 [100, 52, 26, 11, 4] + 幸运 / 章节 / 已有 / 专属 / 元素源 / 流派加权。
    /// </summary>
    public static class ScrollLibrary
    {
        public static readonly string[] RarityName = Rarity.Names;
        public static readonly Color[] RarityColor = Rarity.Colors;
        static readonly float[] RarityWeight = { 60, 30, 9, 3, 1 };

        public static IReadOnlyList<ScrollDef> All => Registry<ScrollDef>.All;

        public static ScrollDef Get(string id) => Registry<ScrollDef>.Get(id);

        /// <summary>按稀有度权重抽 count 张不重复、未满层的秘卷；英雄专属卷只给对应英雄（heroId 为空时不出）</summary>
        public static List<ScrollDef> Roll(ScrollInventory inv, int count, int minRarity = 0, string heroId = null)
        {
            var pool = All.Where(d => d.rarity >= minRarity && inv.Stacks(d.id) < d.maxStacks && (d.heroOnly == null || d.heroOnly == heroId)).ToList();
            var picked = new List<ScrollDef>();
            while (picked.Count < count && pool.Count > 0)
            {
                float total = pool.Sum(Weight);
                float r = UnityEngine.Random.value * total;
                var choice = pool[^1];
                foreach (var d in pool)
                {
                    r -= Weight(d);
                    if (r <= 0) { choice = d; break; }
                }
                picked.Add(choice);
                pool.Remove(choice);
            }
            return picked;
        }

        static float Weight(ScrollDef d) => RarityWeight[Rarity.Clamp(d.rarity)];
    }

    /// <summary>
    /// 本局持有的秘卷（层数 + 每卷当前的安装作用域）。
    /// 获得一层：旧作用域卸载 → 按新层数 Install → 属性按差量提交（来源 scroll:&lt;id&gt;）。已满层时什么都不做并返回 false
    /// （以前会按满层重新登记一遍、再发一次获得事件）。
    /// </summary>
    public sealed class ScrollInventory
    {
        readonly Dictionary<string, int> stacks = new();
        readonly Dictionary<string, ScrollScope> scopes = new();
        public event Action<ScrollDef, int> Gained;
        public IReadOnlyDictionary<string, int> All => stacks;

        public int Stacks(string id) => stacks.TryGetValue(id, out var n) ? n : 0;
        public bool IsMaxed(ScrollDef def) => def != null && Stacks(def.id) >= def.maxStacks;

        /// <summary>给玩家加一层；已满层返回 false</summary>
        public bool Gain(ScrollDef def, PlayerVitals vitals) => Gain(def, vitals ? vitals.stats : null, vitals);

        /// <summary>给一张属性表加一层（测试可以不带玩家）；已满层返回 false</summary>
        public bool Gain(ScrollDef def, StatSheet sheet, PlayerVitals vitals = null)
        {
            if (def == null || IsMaxed(def)) return false;
            int n = Stacks(def.id) + 1;
            scopes.TryGetValue(def.id, out var old);
            old?.Dispose();
            var scope = new ScrollScope(def, n, sheet, vitals);
            try { def.Install(scope, n); }
            catch (Exception e) { Debug.LogException(e); }
            scope.CommitStats(old);
            scopes[def.id] = scope;
            stacks[def.id] = n;
            Gained?.Invoke(def, n);
            GameEvents.RaiseScrollAcquired(def, n);
            return true;
        }

        /// <summary>整卷移除（卸载回调 + 撤属性）</summary>
        public void Remove(string id)
        {
            if (scopes.TryGetValue(id, out var scope))
            {
                scope.Dispose();
                scope.RemoveStats();
                scopes.Remove(id);
            }
            stacks.Remove(id);
        }

        /// <summary>全部移除（新开一局）</summary>
        public void Clear()
        {
            foreach (var id in stacks.Keys.ToList()) Remove(id);
        }
    }
}
