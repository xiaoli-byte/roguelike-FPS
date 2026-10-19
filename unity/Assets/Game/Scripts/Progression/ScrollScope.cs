using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一卷秘卷某个层数的「安装」（Three.js 版 ScrollKit 的 setup 作用域，最小版本）：
    ///   属性：<see cref="Stat"/> 按来源 scroll:&lt;id&gt; 登记本层数下的总量；
    ///   卸载：<see cref="OnUninstall"/> / <see cref="Hook"/> 登记的回调在卸载时倒序执行（退订事件、清理生成物）。
    /// 叠层 = 旧作用域卸载 + 新作用域按新层数重装（<see cref="ScrollInventory.Gain(ScrollDef, PlayerVitals)"/>）。
    /// 属性按差量提交：同一来源只追加「新总量 − 旧总量」，不先撤后加——否则上限先降后升，PlayerVitals 会按升幅再补一次当前值
    /// （同 TS「卸载后重装，批处理，不重复送上限」）。整卷移除时才 <see cref="RemoveStats"/>。
    /// S0 会在这里补齐订阅、出伤 / 受伤修饰、任务、限时增益、条件属性、内置冷却。
    /// </summary>
    public sealed class ScrollScope : IDisposable
    {
        public readonly ScrollDef def;
        public readonly int stacks;
        /// <summary>玩家属性表（测试里可以是一张单独的表）</summary>
        public readonly StatSheet stats;
        /// <summary>玩家（测试 / 编辑器里可能为 null）</summary>
        public readonly PlayerVitals player;

        readonly List<(Stat stat, float value)> totals = new();
        readonly List<Action> undo = new();

        public bool Disposed { get; private set; }
        /// <summary>属性来源 id（同 TS：scroll:&lt;id&gt;）</summary>
        public string Source => SourceOf(def.id);
        public static string SourceOf(string scrollId) => "scroll:" + scrollId;

        public ScrollScope(ScrollDef def, int stacks, StatSheet stats, PlayerVitals player = null)
        {
            this.def = def;
            this.stacks = stacks;
            this.stats = stats;
            this.player = player;
        }

        /// <summary>登记本层数下某属性的总量（同一属性多次登记累加）。在 Install 里调用，装完后统一提交</summary>
        public void Stat(Stat stat, float value)
        {
            for (int i = 0; i < totals.Count; i++)
                if (totals[i].stat == stat)
                {
                    totals[i] = (stat, totals[i].value + value);
                    return;
                }
            totals.Add((stat, value));
        }

        /// <summary>本次安装登记的某属性总量</summary>
        public float StatTotal(Stat stat)
        {
            foreach (var (s, v) in totals)
                if (s == stat) return v;
            return 0;
        }

        /// <summary>卸载时执行（倒序）</summary>
        public void OnUninstall(Action action)
        {
            if (action != null) undo.Add(action);
        }

        /// <summary>立刻订阅，卸载时退订</summary>
        public void Hook(Action subscribe, Action unsubscribe)
        {
            subscribe?.Invoke();
            OnUninstall(unsubscribe);
        }

        /// <summary>把属性提交到属性表：只追加相对上一次安装（previous，可为 null）的差量，按登记顺序</summary>
        internal void CommitStats(ScrollScope previous)
        {
            if (stats == null) return;
            var source = Source;
            foreach (var (stat, value) in totals)
            {
                float delta = value - (previous != null ? previous.StatTotal(stat) : 0);
                if (delta != 0) stats.Add(source, stat, delta);
            }
            if (previous == null) return;
            // 新层数不再登记的属性：减回去
            foreach (var (stat, value) in previous.totals)
                if (value != 0 && !HasStat(stat)) stats.Add(source, stat, -value);
        }

        bool HasStat(Stat stat)
        {
            foreach (var (s, _) in totals)
                if (s == stat) return true;
            return false;
        }

        /// <summary>整卷移除：撤掉这卷的全部属性</summary>
        internal void RemoveStats() => stats?.Remove(Source);

        /// <summary>卸载：倒序执行卸载回调（属性不在这里撤，见类说明）</summary>
        public void Dispose()
        {
            if (Disposed) return;
            Disposed = true;
            for (int i = undo.Count - 1; i >= 0; i--)
            {
                try { undo[i](); }
                catch (Exception e) { Debug.LogException(e); }
            }
            undo.Clear();
        }
    }
}
